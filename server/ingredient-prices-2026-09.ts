/**
 * One-time ingredient price refresh from the Sysco order sheet dated
 * Sep 24 2026 (photo from Ben, 2026-09-29). Updates cog_ingredient_master
 * rows by (case-insensitive) name where the numbers differ and inserts the
 * items that aren't in the catalog yet.
 *
 * Changed/inserted rows are left UNCONFIRMED (confirmed_at/by cleared) so
 * the team re-verifies them against the invoice — that's the point of the
 * confirm column. Pack counts partially cut off in the photo use the
 * standard Sysco case format and are called out in the boot log; a few
 * unreadable lines (yeast, croissants, puff dough, sausage patties) are
 * deliberately skipped rather than guessed.
 *
 * Flag-gated: runs once per database, re-boots are no-ops.
 */
import type { Database } from 'better-sqlite3';

const FLAG = 'ingredient-prices-2026-09-24';

interface PriceRow {
  /** Dashboard ingredient name; `aliases` also match existing rows. */
  name: string;
  aliases?: string[];
  cost: number;
  size: number;
  unit: string;
  supplier: string;
  /** True when the case count was cut off in the photo and the standard
   *  Sysco pack was assumed — surfaced in the log for double-checking. */
  assumedPack?: boolean;
}

const ROWS: PriceRow[] = [
  // Clearly readable pack sizes.
  { name: 'Granulated Sugar', aliases: ['Sugar', 'Pure Cane Sugar'], cost: 43.55, size: 50, unit: 'lbs', supplier: 'Sysco' },
  { name: 'All Purpose Flour', aliases: ['Flour'], cost: 19.99, size: 50, unit: 'lbs', supplier: 'Sysco' },
  { name: 'Butter', cost: 95.95, size: 36, unit: 'lbs', supplier: 'Sysco' },              // 36/1LB solid unsalted
  { name: 'Cheddar Cheese (Shredded)', aliases: ['Cheddar Cheese', 'Shredded Cheddar'], cost: 16.75, size: 5, unit: 'lbs', supplier: 'Sysco' },
  { name: 'Swiss Cheese (Shredded)', aliases: ['Swiss Cheese'], cost: 27.85, size: 5, unit: 'lbs', supplier: 'Sysco' },
  { name: 'Eggs', aliases: ['Egg'], cost: 19.75, size: 15, unit: 'dozen', supplier: 'Sysco' },
  { name: 'Cinnamon (Ground)', aliases: ['Cinnamon', 'Ground Cinnamon'], cost: 11.75, size: 18, unit: 'oz', supplier: 'Sysco' },
  { name: 'Ranch Dressing', aliases: ['Ranch'], cost: 18.95, size: 1, unit: 'gal', supplier: 'Sysco' },
  { name: 'Canned Pumpkin', aliases: ['Pumpkin'], cost: 69.99, size: 636.5, unit: 'oz', supplier: 'Sysco' }, // 6/#10 — matches existing 636.5oz pack

  // Standard Sysco case format assumed where the photo cut the count off.
  { name: 'Oat Milk', cost: 32.84, size: 384, unit: 'oz', supplier: 'Sysco', assumedPack: true },          // Oatly Barista 12/32oz
  { name: 'Brown Sugar', aliases: ['Light Brown Sugar'], cost: 30.99, size: 24, unit: 'lbs', supplier: 'Sysco', assumedPack: true }, // 12/2LB
  { name: 'Honey', cost: 133.69, size: 30, unit: 'lbs', supplier: 'Sysco', assumedPack: true },            // 6/5LB
  { name: 'Cream Cheese', cost: 75.89, size: 30, unit: 'lbs', supplier: 'Sysco', assumedPack: true },      // 10/3LB loaf
  { name: 'Mayonnaise', aliases: ['Mayo'], cost: 45.85, size: 4, unit: 'gal', supplier: 'Sysco', assumedPack: true }, // 4/1GAL
  { name: 'Apple Cider', cost: 35.43, size: 512, unit: 'oz', supplier: "Langer's via Sysco", assumedPack: true }, // 8/64oz
];

export function applyIngredientPrices20260924(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_flags (
      key TEXT PRIMARY KEY,
      done_at INTEGER NOT NULL
    )
  `);
  if (db.prepare('SELECT 1 FROM migration_flags WHERE key = ?').get(FLAG)) return;

  const findByName = db.prepare('SELECT * FROM cog_ingredient_master WHERE LOWER(name) = LOWER(?)');
  const update = db.prepare(`
    UPDATE cog_ingredient_master
    SET ap_pack_cost = ?, pack_size = ?, pack_unit = ?, supplier = ?,
        confirmed_at = NULL, confirmed_by = NULL, last_updated = datetime('now')
    WHERE id = ?
  `);
  const insert = db.prepare(`
    INSERT INTO cog_ingredient_master (name, ap_pack_cost, pack_size, pack_unit, supplier)
    VALUES (?, ?, ?, ?, ?)
  `);

  let updated = 0;
  let inserted = 0;
  let unchanged = 0;
  const run = db.transaction(() => {
    for (const r of ROWS) {
      let existing: any = null;
      for (const candidate of [r.name, ...(r.aliases ?? [])]) {
        existing = findByName.get(candidate);
        if (existing) break;
      }
      const flagNote = r.assumedPack ? ' [pack count assumed — double-check]' : '';
      if (existing) {
        const same = existing.ap_pack_cost === r.cost && existing.pack_size === r.size
          && existing.pack_unit === r.unit;
        if (same) { unchanged++; continue; }
        update.run(r.cost, r.size, r.unit, r.supplier, existing.id);
        updated++;
        console.log(`[ingredient-prices] updated "${existing.name}": $${existing.ap_pack_cost}/${existing.pack_size}${existing.pack_unit ?? ''} -> $${r.cost}/${r.size}${r.unit}${flagNote}`);
      } else {
        insert.run(r.name, r.cost, r.size, r.unit, r.supplier);
        inserted++;
        console.log(`[ingredient-prices] added "${r.name}": $${r.cost}/${r.size}${r.unit}${flagNote}`);
      }
    }
    db.prepare('INSERT INTO migration_flags (key, done_at) VALUES (?, ?)').run(FLAG, Date.now());
  });
  run();
  console.log(`[ingredient-prices] Sep 24 2026 sheet applied: ${updated} updated, ${inserted} added, ${unchanged} already matching. Skipped (unreadable pack): yeast, croissant butter curved, puff dough squares, sausage patties.`);
}
