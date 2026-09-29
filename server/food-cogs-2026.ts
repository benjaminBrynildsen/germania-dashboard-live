/**
 * One-time load of the food batch recipes from the "Food COGS" Drive
 * folder (24 workbooks, from Ben, 2026-09-29), parsed into
 * germania-food-cogs.json. Parsed batch totals were verified against
 * each sheet's own "Total Cost" cell (all within $0.03).
 *
 * Beyond the batch recipes, food items that are sold as-is (Bake Haus
 * order-sheet items, lunch sandwiches/wraps) also get a cog_drinks
 * entry — one "Regular" variant holding the recipe at its per-unit
 * quantity — because that's what the Bake Haus monthly report joins on
 * (LOWER(name) match, components required) to fill its Cost $ column.
 * Drinks that already have components are never touched, and every
 * drink this creates or fills lands with needs_confirm=1.
 *
 * Recipe matching is by canonical name or alias (case/punctuation-
 * insensitive): an existing recipe is renamed and its lines rebuilt;
 * missing recipes are inserted. Flag-gated — runs once, later hand
 * edits survive reboots.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Database } from 'better-sqlite3';

const FLAG = 'food-cogs-2026-09';

interface JsonIngredient {
  name: string;
  ap_pack_cost: number | null;
  pack_size: number | null;
  pack_unit: string | null;
  unit_conversion: number | null;
  ap_price: number | null;
  ap_price_unit: string | null;
  yield_percent: number;
  ep_price: number | null;
  ep_price_unit: string | null;
  quantity_used: number | null;
}

interface JsonRecipe {
  name: string;
  aliases: string[];
  season: string | null;
  category: string;
  total_yield: number | null;
  yield_unit: string | null;
  labor_time_hrs?: number | null;
  labor_quantity?: number | null;
  labor_cook_rate?: number | null;
  labor_cost_per_unit?: number | null;
  ingredients: JsonIngredient[];
  drink?: { name: string; quantity: number; unit: string };
  note?: string;
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function applyFoodCogs2026(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_flags (
      key TEXT PRIMARY KEY,
      done_at INTEGER NOT NULL
    )
  `);
  if (db.prepare('SELECT 1 FROM migration_flags WHERE key = ?').get(FLAG)) return;

  const dataPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'germania-food-cogs.json');
  if (!fs.existsSync(dataPath)) {
    console.warn('[food-cogs] data file missing — skipping');
    return;
  }
  const recipes = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as JsonRecipe[];

  const existing = db.prepare('SELECT id, name FROM cog_recipes').all() as Array<{ id: number; name: string }>;
  const byNorm = new Map(existing.map((r) => [normName(r.name), r]));

  const updateRecipe = db.prepare(`
    UPDATE cog_recipes
    SET name = ?, season = ?, category = ?, total_yield = ?, yield_unit = ?,
        labor_time_hrs = ?, labor_quantity = ?, labor_cook_rate = ?, labor_cost_per_unit = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `);
  const insertRecipe = db.prepare(`
    INSERT INTO cog_recipes (name, season, category, total_yield, yield_unit, labor_time_hrs, labor_quantity, labor_cook_rate, labor_cost_per_unit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteLines = db.prepare('DELETE FROM cog_ingredients WHERE recipe_id = ?');
  const insertLine = db.prepare(`
    INSERT INTO cog_ingredients (recipe_id, name, ap_pack_cost, pack_size, pack_unit, unit_conversion, ap_price, ap_price_unit, yield_percent, ep_price, ep_price_unit, quantity_used, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let updated = 0;
  let inserted = 0;
  let drinksMade = 0;
  let drinksFilled = 0;
  let drinksSkipped = 0;
  const today = new Date().toISOString().slice(0, 10);

  const run = db.transaction(() => {
    for (const r of recipes) {
      let match: { id: number; name: string } | undefined;
      for (const candidate of [r.name, ...r.aliases]) {
        match = byNorm.get(normName(candidate));
        if (match) break;
      }
      let recipeId: number;
      if (match) {
        updateRecipe.run(
          r.name, r.season, r.category, r.total_yield, r.yield_unit,
          r.labor_time_hrs ?? null, r.labor_quantity ?? null, r.labor_cook_rate ?? null, r.labor_cost_per_unit ?? null,
          match.id,
        );
        recipeId = match.id;
        updated++;
      } else {
        recipeId = insertRecipe.run(
          r.name, r.season, r.category, r.total_yield, r.yield_unit,
          r.labor_time_hrs ?? null, r.labor_quantity ?? null, r.labor_cook_rate ?? null, r.labor_cost_per_unit ?? null,
        ).lastInsertRowid as number;
        byNorm.set(normName(r.name), { id: recipeId, name: r.name });
        inserted++;
      }
      deleteLines.run(recipeId);
      r.ingredients.forEach((ing, i) => {
        insertLine.run(
          recipeId, ing.name, ing.ap_pack_cost, ing.pack_size, ing.pack_unit, ing.unit_conversion,
          ing.ap_price, ing.ap_price_unit, ing.yield_percent, ing.ep_price, ing.ep_price_unit, ing.quantity_used, i,
        );
      });

      // ── sellable item → cog_drinks entry the Bake Haus report can join on ──
      if (r.drink) {
        const d = db.prepare(
          'SELECT id, name, notes FROM cog_drinks WHERE LOWER(name) = LOWER(?) AND archived = 0',
        ).get(r.drink.name) as { id: number; name: string; notes: string | null } | undefined;
        const note = `[auto] Costed from Food COGS workbook "${r.name}" on ${today} (${r.drink.quantity} ${r.drink.unit} of the batch recipe). Review before trusting the COG.`;
        let drinkId: number;
        if (d) {
          const hasComponents = db.prepare(
            'SELECT 1 FROM cog_drink_components WHERE drink_id = ? LIMIT 1',
          ).get(d.id);
          if (hasComponents) {
            drinksSkipped++;
            continue; // someone already costed it — hands off
          }
          drinkId = d.id;
          db.prepare(
            "UPDATE cog_drinks SET needs_confirm = 1, notes = ?, updated_at = datetime('now') WHERE id = ?",
          ).run(d.notes ? `${d.notes}\n${note}` : note, drinkId);
          drinksFilled++;
        } else {
          drinkId = db.prepare(
            'INSERT INTO cog_drinks (name, category, needs_confirm, notes) VALUES (?, ?, 1, ?)',
          ).run(r.drink.name, 'FOOD', note).lastInsertRowid as number;
          drinksMade++;
        }
        let variant = db.prepare(
          'SELECT id FROM cog_drink_variants WHERE drink_id = ? ORDER BY sort_order LIMIT 1',
        ).get(drinkId) as { id: number } | undefined;
        if (!variant) {
          variant = {
            id: db.prepare(
              "INSERT INTO cog_drink_variants (drink_id, label, temp, size, sort_order) VALUES (?, 'Regular', NULL, 'R', 0)",
            ).run(drinkId).lastInsertRowid as number,
          };
        }
        db.prepare(`
          INSERT INTO cog_drink_components (drink_id, variant_id, component_type, recipe_id, quantity, unit, sort_order)
          VALUES (?, ?, 'recipe', ?, ?, ?, 0)
        `).run(drinkId, variant.id, recipeId, r.drink.quantity, r.drink.unit);
      }
    }
    db.prepare('INSERT INTO migration_flags (key, done_at) VALUES (?, ?)').run(FLAG, Date.now());
  });
  run();
  console.log(
    `[food-cogs] Food COGS workbooks applied: ${updated} recipes updated, ${inserted} added; ` +
    `drinks: ${drinksMade} created, ${drinksFilled} filled, ${drinksSkipped} left alone (already costed).`,
  );
}
