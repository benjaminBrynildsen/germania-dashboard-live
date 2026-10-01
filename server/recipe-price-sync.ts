/**
 * Keeps batch-recipe ingredient lines following the master ingredient
 * catalog (the Ingredients tab). Historically a recipe line was a frozen
 * snapshot of pack cost/size, so updating "eggs" in the catalog changed
 * nothing downstream — the chef's updates silently didn't reach recipes.
 *
 * Lines carry a nullable master_id. A line is linked when its name
 * matches a catalog entry (case/punctuation-insensitive) AND the pack
 * units agree AND it has a usable unit conversion — those are the lines
 * whose EP math can be rebuilt safely from the catalog's pack price.
 * Linked lines recompute as:
 *   ap = pack_cost / (pack_size × unit_conversion),  ep = ap / (yield%/100)
 * preserving the line's own conversion, yield and quantity.
 *
 * Propagation runs automatically whenever a master ingredient is saved,
 * and the whole catalog can be re-applied per recipe (or globally) via
 * syncRecipeToMaster / a boot-time backfill.
 */
import type { Database } from 'better-sqlite3';

const normName = (s: string | null | undefined) =>
  (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const UNIT_ALIASES: Record<string, string> = {
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  g: 'g', gram: 'g', grams: 'g', kg: 'kg',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  qt: 'qt', qts: 'qt', quart: 'qt', quarts: 'qt',
  pt: 'pt', pint: 'pt', pints: 'pt',
  c: 'c', cup: 'c', cups: 'c',
  ml: 'ml', l: 'l', liter: 'l', liters: 'l',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  each: 'each', ea: 'each',
  dozen: 'dozen',
};
const normUnit = (u: string | null | undefined) => {
  const k = (u || '').trim().toLowerCase();
  return UNIT_ALIASES[k] ?? k;
};

// Same-kind pack-unit conversion (mirrors src/lib/units.ts): lets a line
// priced per gallon follow a catalog entry priced per oz, or a per-each
// egg line follow a per-dozen catalog pack. "oz" lives in both tables;
// identical units short-circuit to 1 so it never misconverts.
const VOLUME_FLOZ: Record<string, number> = { tsp: 1 / 6, tbsp: 0.5, oz: 1, c: 8, pt: 16, qt: 32, gal: 128, ml: 0.033814, l: 33.814 };
const WEIGHT_OZ: Record<string, number> = { g: 1 / 28.3495, kg: 35.274, oz: 1, lb: 16 };
const COUNT: Record<string, number> = { each: 1, dozen: 12 };

/** How many of the line's pack units make one of the master's pack
 *  units — or null when the pair doesn't convert cleanly. */
function packUnitFactor(masterUnit: string | null | undefined, lineUnit: string | null | undefined): number | null {
  const m = normUnit(masterUnit);
  const l = normUnit(lineUnit);
  if (!m || !l) return null;
  if (m === l) return 1;
  if (m in VOLUME_FLOZ && l in VOLUME_FLOZ) return VOLUME_FLOZ[m] / VOLUME_FLOZ[l];
  if (m in WEIGHT_OZ && l in WEIGHT_OZ) return WEIGHT_OZ[m] / WEIGHT_OZ[l];
  if (m in COUNT && l in COUNT) return COUNT[m] / COUNT[l];
  return null;
}

interface MasterRow {
  id: number;
  name: string;
  ap_pack_cost: number | null;
  pack_size: number | null;
  pack_unit: string | null;
}

interface LineRow {
  id: number;
  recipe_id: number;
  name: string;
  master_id: number | null;
  pack_unit: string | null;
  unit_conversion: number | null;
  yield_percent: number | null;
}

/** Recompute one linked line from its master's pack price. Returns true
 *  when the line changed. Units must still agree — a catalog entry whose
 *  pack unit moved out from under the line is skipped, not corrupted. */
function recomputeLine(db: Database, line: LineRow, m: MasterRow): boolean {
  if (m.ap_pack_cost == null || !(m.pack_size != null && m.pack_size > 0)) return false;
  const factor = packUnitFactor(m.pack_unit, line.pack_unit);
  if (factor == null) return false;
  const conv = line.unit_conversion != null && line.unit_conversion > 0 ? line.unit_conversion : null;
  if (conv == null) return false;
  // Express the master's pack in the LINE's pack unit, so the line's own
  // unit_conversion (EP units per ITS pack unit) stays valid.
  const packSizeInLineUnits = m.pack_size * factor;
  const ap = m.ap_pack_cost / (packSizeInLineUnits * conv);
  const yf = (line.yield_percent ?? 100) > 0 ? (line.yield_percent ?? 100) / 100 : 1;
  const ep = ap / yf;
  const r = db.prepare(`
    UPDATE cog_ingredients
    SET ap_pack_cost = ?, pack_size = ?, ap_price = ?, ep_price = ?
    WHERE id = ? AND (ap_pack_cost IS NOT ? OR pack_size IS NOT ? OR ap_price IS NOT ? OR ep_price IS NOT ?)
  `).run(m.ap_pack_cost, packSizeInLineUnits, ap, ep, line.id, m.ap_pack_cost, packSizeInLineUnits, ap, ep);
  return r.changes > 0;
}

/** After a master ingredient is saved: push its new price into every
 *  recipe line linked to it. Returns how many lines moved. */
export function propagateMasterPrice(db: Database, masterId: number): number {
  const m = db.prepare('SELECT id, name, ap_pack_cost, pack_size, pack_unit FROM cog_ingredient_master WHERE id = ?')
    .get(masterId) as MasterRow | undefined;
  if (!m) return 0;
  const lines = db.prepare(
    'SELECT id, recipe_id, name, master_id, pack_unit, unit_conversion, yield_percent FROM cog_ingredients WHERE master_id = ?',
  ).all(masterId) as LineRow[];
  let changed = 0;
  for (const line of lines) if (recomputeLine(db, line, m)) changed++;
  return changed;
}

export interface SyncResult {
  linked: number;    // newly linked lines
  updated: number;   // lines whose prices moved
  skipped: string[]; // line names present in the catalog but not safely linkable
  unmatched: string[]; // line names with no catalog entry
}

/** Link a recipe's lines to the catalog by name (where the math is safe)
 *  and re-apply catalog prices to every linked line. */
export function syncRecipeToMaster(db: Database, recipeId: number): SyncResult {
  const masters = db.prepare('SELECT id, name, ap_pack_cost, pack_size, pack_unit FROM cog_ingredient_master').all() as MasterRow[];
  const byNorm = new Map(masters.map((m) => [normName(m.name), m]));
  const byId = new Map(masters.map((m) => [m.id, m]));
  const lines = db.prepare(
    'SELECT id, recipe_id, name, master_id, pack_unit, unit_conversion, yield_percent FROM cog_ingredients WHERE recipe_id = ?',
  ).all(recipeId) as LineRow[];

  const result: SyncResult = { linked: 0, updated: 0, skipped: [], unmatched: [] };
  const txn = (db as any).transaction(() => {
    for (const line of lines) {
      let m = line.master_id != null ? byId.get(line.master_id) ?? null : null;
      if (!m) {
        m = byNorm.get(normName(line.name)) ?? null;
        if (!m) { result.unmatched.push(line.name); continue; }
        const conv = line.unit_conversion != null && line.unit_conversion > 0;
        if (!conv || packUnitFactor(m.pack_unit, line.pack_unit) == null) {
          result.skipped.push(line.name);
          continue;
        }
        db.prepare('UPDATE cog_ingredients SET master_id = ? WHERE id = ?').run(m.id, line.id);
        line.master_id = m.id;
        result.linked++;
      }
      if (recomputeLine(db, line, m)) result.updated++;
    }
  });
  txn();
  return result;
}

/** Boot-time backfill: add the master_id column and link+resync every
 *  recipe once, so catalog prices Maggie already entered reach the
 *  recipes without her pressing anything. Flag-gated. */
export function applyRecipeMasterLinks(db: Database) {
  const cols = db.prepare('PRAGMA table_info(cog_ingredients)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'master_id')) {
    console.log('[recipe-price-sync] adding master_id to cog_ingredients');
    db.exec('ALTER TABLE cog_ingredients ADD COLUMN master_id INTEGER REFERENCES cog_ingredient_master(id) ON DELETE SET NULL');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_flags (
      key TEXT PRIMARY KEY,
      done_at INTEGER NOT NULL
    )
  `);
  const FLAG = 'recipe-master-links-2026-10';
  if (db.prepare('SELECT 1 FROM migration_flags WHERE key = ?').get(FLAG)) return;
  const recipes = db.prepare('SELECT id, name FROM cog_recipes').all() as Array<{ id: number; name: string }>;
  let linked = 0;
  let updated = 0;
  for (const r of recipes) {
    const s = syncRecipeToMaster(db, r.id);
    linked += s.linked;
    updated += s.updated;
  }
  db.prepare('INSERT INTO migration_flags (key, done_at) VALUES (?, ?)').run(FLAG, Date.now());
  console.log(`[recipe-price-sync] backfill: linked ${linked} recipe lines to the catalog, ${updated} prices refreshed.`);
}
