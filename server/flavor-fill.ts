/**
 * Propagate a drink's flavor components (haus syrups/sauces, flavor
 * ingredients) across all of its size variants at the house standard
 * pump amounts. Used when someone hand-adds a flavor to one size (say
 * 1 oz of Bourbon Butterscotch on Hot Small) and wants the rest of the
 * sizes filled in to match, instead of typing eight more rows.
 *
 * House standards (per Ben, 2026-09):
 *   hot  S/R/L — sauces 1 / 1.5 / 2 oz, syrups 0.75 / 1.25 / 1.75 oz
 *   iced + frozen K/R/L — 0.5 / 1 / 1.5 oz (both)
 *
 * Sizes that already carry the flavor are left exactly as entered —
 * only missing sizes are filled — and the drink is flagged
 * needs_confirm so a human signs off on the result.
 */
import db from './db.js';

const HOT_SAUCE_OZ: Record<string, number> = { S: 1, R: 1.5, L: 2 };
const HOT_SYRUP_OZ: Record<string, number> = { S: 0.75, R: 1.25, L: 1.75 };
const COLD_FLAVOR_OZ: Record<string, number> = { K: 0.5, R: 1, L: 1.5 };

export function flavorOzFor(temp: string | null, size: string | null, isSauce: boolean): number | null {
  if (!temp || !size) return null;
  if (temp === 'hot') return (isSauce ? HOT_SAUCE_OZ : HOT_SYRUP_OZ)[size] ?? null;
  if (temp === 'iced' || temp === 'frozen') return COLD_FLAVOR_OZ[size] ?? null;
  return null;
}

interface FlavorRow {
  variant_id: number | null;
  component_type: 'ingredient' | 'recipe';
  ingredient_id: number | null;
  recipe_id: number | null;
  src_name: string | null;
  src_category: string | null;
}

const FLAVOR_CATEGORIES = new Set(['syrup', 'sauce', 'mixer', 'powder']);

function isFlavor(row: FlavorRow): boolean {
  const cat = (row.src_category || '').toLowerCase();
  if (FLAVOR_CATEGORIES.has(cat)) return true;
  return /syrup|sauce/i.test(row.src_name || '');
}

function isSauce(row: FlavorRow): boolean {
  return (row.src_category || '').toLowerCase() === 'sauce' || /sauce/i.test(row.src_name || '');
}

export interface FillResult {
  added: Array<{ flavor: string; variant: string; quantity: number }>;
  flavors: string[];
}

/** Fill every size variant that's missing a flavor another size already
 *  has. Returns what was added; throws if the drink doesn't exist. */
export function fillFlavorSizes(drinkId: number): FillResult {
  const drink = db.prepare('SELECT id, name, notes FROM cog_drinks WHERE id = ? AND archived = 0').get(drinkId) as
    | { id: number; name: string; notes: string | null }
    | undefined;
  if (!drink) throw new Error('drink not found');

  const variants = db.prepare(
    'SELECT id, label, temp, size FROM cog_drink_variants WHERE drink_id = ? ORDER BY sort_order',
  ).all(drinkId) as Array<{ id: number; label: string; temp: string | null; size: string | null }>;

  const rows = db.prepare(`
    SELECT c.variant_id, c.component_type, c.ingredient_id, c.recipe_id,
           COALESCE(r.name, m.name) AS src_name,
           r.category AS src_category
    FROM cog_drink_components c
    LEFT JOIN cog_recipes r ON r.id = c.recipe_id
    LEFT JOIN cog_ingredient_master m ON m.id = c.ingredient_id
    WHERE c.drink_id = ?
  `).all(drinkId) as FlavorRow[];

  // Group the flavor components by their source; remember which variants
  // already carry each one.
  const flavors = new Map<string, { row: FlavorRow; onVariants: Set<number> }>();
  for (const row of rows) {
    if (!isFlavor(row)) continue;
    const key = `${row.component_type}:${row.ingredient_id ?? row.recipe_id}`;
    let entry = flavors.get(key);
    if (!entry) {
      entry = { row, onVariants: new Set() };
      flavors.set(key, entry);
    }
    if (row.variant_id != null) entry.onVariants.add(row.variant_id);
  }

  const result: FillResult = { added: [], flavors: [] };
  if (flavors.size === 0) return result;

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM cog_drink_components WHERE variant_id = ?',
  );
  const insert = db.prepare(`
    INSERT INTO cog_drink_components (drink_id, variant_id, component_type, ingredient_id, recipe_id, quantity, unit, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, 'oz', ?)
  `);

  const txn = db.transaction(() => {
    for (const { row, onVariants } of flavors.values()) {
      result.flavors.push(row.src_name || '?');
      const sauce = isSauce(row);
      for (const v of variants) {
        if (onVariants.has(v.id)) continue;
        const qty = flavorOzFor(v.temp, v.size, sauce);
        if (qty == null) continue;
        const order = ((maxOrder.get(v.id) as any).m as number) + 1;
        insert.run(drinkId, v.id, row.component_type, row.ingredient_id, row.recipe_id, qty, order);
        result.added.push({ flavor: row.src_name || '?', variant: v.label, quantity: qty });
      }
    }
    if (result.added.length > 0) {
      const note = `[auto] Filled ${result.flavors.join(', ')} across ${result.added.length} size(s) at house pump amounts on ${new Date().toISOString().slice(0, 10)}. Review before trusting the COG.`;
      db.prepare("UPDATE cog_drinks SET needs_confirm = 1, notes = ?, updated_at = datetime('now') WHERE id = ?")
        .run(drink.notes ? `${drink.notes}\n${note}` : note, drinkId);
    }
  });
  txn();
  return result;
}
