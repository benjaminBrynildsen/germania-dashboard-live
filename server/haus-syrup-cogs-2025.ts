/**
 * One-time refresh of the Haus syrup/sauce batch recipes from the four
 * seasonal COGS workbooks (Spring/Summer/Fall/Winter 2025-26, from Ben,
 * 2026-09-29), parsed into germania-haus-syrup-cogs-2025.json.
 *
 * The existing batch recipes showed $0.00/oz because their ingredient
 * lines had no quantities — these sheets carry the full AP/EP pricing,
 * Recipe Quantity per line, batch yield, AND the labor section
 * (time × cook rate ÷ batches), so every recipe costs out. Parsed batch
 * totals were verified against each sheet's own "Total Cost" cell.
 *
 * Matching is by canonical name or alias (case/punctuation-insensitive):
 * an existing recipe is renamed to the canonical name and its lines are
 * rebuilt; missing recipes are inserted. Flag-gated — runs once, later
 * hand edits survive reboots.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Database } from 'better-sqlite3';

const FLAG = 'haus-syrup-cogs-2025';

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
  season: string;
  category: string;
  total_yield: number | null;
  yield_unit: string | null;
  labor_time_hrs?: number | null;
  labor_quantity?: number | null;
  labor_cook_rate?: number | null;
  labor_cost_per_unit?: number | null;
  ingredients: JsonIngredient[];
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function applyHausSyrupCogs2025(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_flags (
      key TEXT PRIMARY KEY,
      done_at INTEGER NOT NULL
    )
  `);
  if (db.prepare('SELECT 1 FROM migration_flags WHERE key = ?').get(FLAG)) return;

  const dataPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'germania-haus-syrup-cogs-2025.json');
  if (!fs.existsSync(dataPath)) {
    console.warn('[haus-syrup-cogs] data file missing — skipping');
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
        inserted++;
      }
      deleteLines.run(recipeId);
      r.ingredients.forEach((ing, i) => {
        insertLine.run(
          recipeId, ing.name, ing.ap_pack_cost, ing.pack_size, ing.pack_unit, ing.unit_conversion,
          ing.ap_price, ing.ap_price_unit, ing.yield_percent, ing.ep_price, ing.ep_price_unit, ing.quantity_used, i,
        );
      });
      const batch = r.ingredients.reduce((s, i) => s + (i.ep_price || 0) * (i.quantity_used || 0), 0);
      const perOz = r.total_yield ? (batch + (r.labor_cost_per_unit || 0)) / r.total_yield : 0;
      console.log(`[haus-syrup-cogs] ${match ? 'updated' : 'added'} "${r.name}" (${r.season}): $${batch.toFixed(2)} batch → $${perOz.toFixed(3)}/${r.yield_unit} incl. labor`);
    }
    db.prepare('INSERT INTO migration_flags (key, done_at) VALUES (?, ?)').run(FLAG, Date.now());
  });
  run();
  console.log(`[haus-syrup-cogs] 2025 seasonal workbooks applied: ${updated} recipes updated, ${inserted} added.`);
}
