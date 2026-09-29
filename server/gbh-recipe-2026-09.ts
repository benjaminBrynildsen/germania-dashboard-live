/**
 * One-time fill of the GBH drink recipe (Ben, 2026-10): GBH is the
 * standard white-mocha build — espresso (hot) / cold brew (iced, frozen)
 * + milk + standard pumps of Monin White Chocolate sauce, finished with
 * a caramel drizzle. The hand-costed spreadsheet export
 * (germania-cog-drinks.json) carries exactly that structure with real
 * per-size quantities, so this lifts the GBH entry from it and applies
 * it to the catalog drink.
 *
 * Safe by construction: only fills when GBH currently has no components
 * (never clobbers a costed recipe), merges into existing price-synced
 * variants by temp+size, resolves component names against the master
 * ingredient catalog (unresolved lines are noted, not guessed), and
 * lands needs_confirm=1 so it awaits a human sign-off. If the GBH drink
 * isn't in the catalog yet (Dripos sync hasn't run), it retries on the
 * next boot instead of burning its flag.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Database } from 'better-sqlite3';

const FLAG = 'gbh-recipe-2026-09';

const TEMP_WORD: Record<string, string> = { hot: 'Hot', iced: 'Iced', frozen: 'Frozen' };
const SIZE_WORD: Record<string, string> = { S: 'Small', R: 'Regular', L: 'Large', K: 'Kids' };

export function applyGbhRecipe(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_flags (
      key TEXT PRIMARY KEY,
      done_at INTEGER NOT NULL
    )
  `);
  if (db.prepare('SELECT 1 FROM migration_flags WHERE key = ?').get(FLAG)) return;

  const drink = db.prepare(
    "SELECT id, name FROM cog_drinks WHERE LOWER(REPLACE(name, '.', '')) = 'gbh' AND archived = 0",
  ).get() as { id: number; name: string } | undefined;
  if (!drink) {
    // Catalog not synced yet — try again next boot.
    console.log('[gbh-recipe] no GBH drink in the catalog yet — will retry next boot');
    return;
  }

  const setFlag = () => db.prepare('INSERT INTO migration_flags (key, done_at) VALUES (?, ?)').run(FLAG, Date.now());

  const compCount = (db.prepare('SELECT COUNT(*) AS c FROM cog_drink_components WHERE drink_id = ?').get(drink.id) as any).c;
  if (compCount > 0) {
    console.log('[gbh-recipe] GBH already has a recipe — leaving it alone');
    setFlag();
    return;
  }

  const dataPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'germania-cog-drinks.json');
  if (!fs.existsSync(dataPath)) { console.warn('[gbh-recipe] germania-cog-drinks.json missing — skipping'); setFlag(); return; }
  const drinks = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as Array<{
    name: string;
    variants: Array<{ label: string; temp: string | null; size: string | null; menu_price: number | null;
      components: Array<{ ingredient_name: string; quantity: number | null; unit: string | null }> }>;
  }>;
  const gbh = drinks.find((d) => d.name.toLowerCase() === 'gbh');
  if (!gbh) { console.warn('[gbh-recipe] no GBH entry in the spreadsheet export — skipping'); setFlag(); return; }

  const ings = db.prepare('SELECT id, name FROM cog_ingredient_master').all() as Array<{ id: number; name: string }>;
  const ingByName = new Map(ings.map((i) => [i.name.toLowerCase(), i.id]));

  const findVariant = db.prepare('SELECT id FROM cog_drink_variants WHERE drink_id = ? AND temp IS ? AND size IS ?');
  const insVariant = db.prepare(
    'INSERT INTO cog_drink_variants (drink_id, label, temp, size, menu_price, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insComp = db.prepare(`
    INSERT INTO cog_drink_components (drink_id, variant_id, component_type, ingredient_id, quantity, unit, yield_percent, sort_order)
    VALUES (?, ?, 'ingredient', ?, ?, ?, 100, ?)
  `);

  const unresolved = new Set<string>();
  let variantCount = 0;
  const run = db.transaction(() => {
    gbh.variants.forEach((v, vi) => {
      const existing = findVariant.get(drink.id, v.temp ?? null, v.size ?? null) as any;
      const label = v.temp && v.size
        ? `${TEMP_WORD[v.temp] ?? v.temp} ${SIZE_WORD[v.size] ?? v.size}`
        : v.label;
      const variantId = existing?.id
        ?? (insVariant.run(drink.id, label, v.temp ?? null, v.size ?? null, v.menu_price ?? null, vi).lastInsertRowid as number);
      db.prepare('DELETE FROM cog_drink_components WHERE variant_id = ?').run(variantId);
      variantCount++;
      let order = 0;
      for (const c of v.components) {
        const ingId = ingByName.get(c.ingredient_name.toLowerCase());
        if (!ingId) { unresolved.add(c.ingredient_name); continue; }
        insComp.run(drink.id, variantId, ingId, c.quantity, c.unit, order++);
      }
    });
    const note = `[auto] GBH filled with the standard white-mocha build (Monin White Chocolate standard pumps + caramel drizzle) from the hand-costed spreadsheet on ${new Date().toISOString().slice(0, 10)}.`
      + (unresolved.size > 0 ? ` Not costed (missing from ingredient catalog): ${[...unresolved].join(', ')}.` : '');
    db.prepare(`
      UPDATE cog_drinks SET needs_confirm = 1,
        notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(note, drink.id);
    setFlag();
  });
  run();
  console.log(`[gbh-recipe] filled "${drink.name}" with ${variantCount} variants (white chocolate + caramel drizzle build).`
    + (unresolved.size > 0 ? ` Unresolved: ${[...unresolved].join(', ')}` : ''));
}
