/**
 * SOP → COGS sync. The SOP library already holds every drink build as
 * structured tables (rows × sizes, in bells/pumps/shots/scoops), so this
 * converts them straight into costed drink recipes instead of anyone
 * re-typing them.
 *
 * For each drink SOP (newest collection wins when a drink appears across
 * seasons), the matching Dripos-synced cog_drink gets per-temp/size
 * variants with components resolved against the batch-recipe list
 * (haus syrups/sauces) and the master ingredient catalog. House measure
 * conventions — taken from the hand-costed spreadsheet drinks (GBH,
 * Vanilla Latte, Chai) so synced drinks cost out identically:
 *   bells: small 3 oz, large 5 oz
 *   pumps: 1 oz standard; extra pump = 1.25 oz syrup / 1.5 oz sauce
 *   espresso: 8.5 g per shot
 *   Polar Powder: red scoop 45 g, white scoop 56.25 g
 *   hot "stir & fill" milk: 7 / 9 / 11 oz (S/R/L)
 *   ice: iced 3.5/5/5 oz, frozen 10/18/24 oz (K/R/L)
 *   packaging: hot cup 12/16/20 + hot lid + sleeve + stopper;
 *              cold cup 10/16/24, Kids lid + ½ straw vs Sip lid + straw
 *
 * A baseline pass then fills still-uncosted drinks in the coffee
 * categories whose name matches a flavor (syrup/sauce recipe or flavor
 * ingredient) using the standard house build (3 oz cold brew + 9 oz milk
 * + 1 oz flavor on iced regular, scaled per size — the Vanilla Latte
 * archetype).
 *
 * Everything filled here is marked needs_confirm=1 with a provenance
 * note; the Drinks tab shows a Confirm button. Idempotent: drinks that
 * already have components are never touched.
 */
import db from './db.js';

// ── house measure conventions ─────────────────────────────────────
const SMALL_BELL_OZ = 3;
const LARGE_BELL_OZ = 5;
const ESPRESSO_G_PER_SHOT = 8.5;
const RED_SCOOP_G = 45;
const WHITE_SCOOP_G = 56.25;
const HOT_MILK_FILL_OZ: Record<string, number> = { S: 7, R: 9, L: 11 };
const ICED_ICE_OZ: Record<string, number> = { K: 3.5, R: 5, L: 5 };
const FROZEN_ICE_OZ: Record<string, number> = { K: 10, R: 18, L: 24 };

const HOT_PACKAGING: Record<string, Array<[string, number]>> = {
  S: [['Cup - Hot - 12', 1], ['Lid - Hot', 1], ['Sleeve', 1], ['Stopper', 1]],
  R: [['Cup - Hot - 16', 1], ['Lid - Hot', 1], ['Sleeve', 1], ['Stopper', 1]],
  L: [['Cup - Hot - 20', 1], ['Lid - Hot', 1], ['Sleeve', 1], ['Stopper', 1]],
};
const COLD_PACKAGING: Record<string, Array<[string, number]>> = {
  K: [['Cup - Cold - 10', 1], ['Lid - Kids', 1], ['Straw', 0.5]],
  R: [['Cup - Cold - 16', 1], ['Lid - Sip', 1], ['Straw', 1]],
  L: [['Cup - Cold - 24', 1], ['Lid - Sip', 1], ['Straw', 1]],
};

// Ingredient-name aliases: SOP row name (normalized) → master catalog name.
const INGREDIENT_ALIASES: Record<string, string> = {
  'milk': 'Whole Milk',
  'steamed milk': 'Whole Milk',
  'whole milk': 'Whole Milk',
  'cold brew': 'Cold Brew',
  'espresso': 'Espresso',
  'polar powder': 'Polar Powder',
  'ice': 'Ice',
  'half half': 'Half & Half',
  'half and half': 'Half & Half',
  'chai': 'Chai - Spiced Chai (red carton)',
  'spiced chai': 'Chai - Spiced Chai (red carton)',
  'oregon spiced chai': 'Chai - Spiced Chai (red carton)',
  'oregon chai': 'Chai - Spiced Chai (red carton)',
};

// ── name normalization ────────────────────────────────────────────
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/['’&]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** For flavor resolution: also drop haus/monin branding + syrup/sauce suffixes. */
function flavorNorm(s: string): string {
  return norm(s).replace(/\b(haus|monin|torani|syrup|sauce|concentrate)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── source resolution (batch recipe or master ingredient) ─────────
interface ResolvedSource { type: 'ingredient' | 'recipe'; id: number; name: string }

function buildResolver() {
  const recipes = db.prepare('SELECT id, name FROM cog_recipes').all() as Array<{ id: number; name: string }>;
  const ingredients = db.prepare('SELECT id, name FROM cog_ingredient_master').all() as Array<{ id: number; name: string }>;
  const recipeByNorm = new Map<string, ResolvedSource>();
  const ingByNorm = new Map<string, ResolvedSource>();
  for (const r of recipes) {
    recipeByNorm.set(norm(r.name), { type: 'recipe', id: r.id, name: r.name });
    recipeByNorm.set(flavorNorm(r.name), { type: 'recipe', id: r.id, name: r.name });
  }
  for (const i of ingredients) {
    ingByNorm.set(norm(i.name), { type: 'ingredient', id: i.id, name: i.name });
    if (!ingByNorm.has(flavorNorm(i.name))) ingByNorm.set(flavorNorm(i.name), { type: 'ingredient', id: i.id, name: i.name });
  }
  const ingByExactName = new Map(ingredients.map((i) => [i.name, { type: 'ingredient' as const, id: i.id, name: i.name }]));

  return (rowName: string): ResolvedSource | null => {
    const n = norm(rowName);
    const alias = INGREDIENT_ALIASES[n];
    if (alias && ingByExactName.has(alias)) return ingByExactName.get(alias)!;
    // Batch recipes first: that's where haus syrup/sauce per-oz cost lives.
    return recipeByNorm.get(n) ?? ingByNorm.get(n)
      ?? recipeByNorm.get(flavorNorm(rowName)) ?? ingByNorm.get(flavorNorm(rowName)) ?? null;
  };
}

// ── cell parsing ──────────────────────────────────────────────────
interface ParsedQty { quantity: number; unit: string }
type CellResult =
  | { kind: 'qty'; qty: ParsedQty }
  | { kind: 'skip'; reason: string }
  | { kind: 'fill-milk' }
  | { kind: 'fill-ice' };

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75 };

function parseNumber(s: string): number | null {
  const m = s.match(/(\d+(?:\.\d+)?)\s*([½¼¾])?|([½¼¾])/);
  if (!m) return null;
  if (m[3]) return FRACTIONS[m[3]];
  let v = parseFloat(m[1]);
  if (m[2]) v += FRACTIONS[m[2]];
  return Number.isFinite(v) ? v : null;
}

/** Pump volume for a row: 1 oz standard; extra-pump rows use 1.25 oz for
 *  syrups, 1.5 oz for sauces (house rule). */
function pumpOz(rowText: string, isSauce: boolean): number {
  const extra = /extra\s*pump/i.test(rowText);
  if (!extra) return 1.0;
  return isSauce ? 1.5 : 1.25;
}

function parseCell(cellRaw: string, rowName: string, modifier: string | null): CellResult {
  const cell = cellRaw.trim();
  const low = cell.toLowerCase();
  if (!cell || low === 'none' || low === '-' || low === '—') return { kind: 'skip', reason: 'none' };

  const rowFull = `${rowName} ${modifier ?? ''}`;
  const isGarnish = /dust|sprinkle|drizzle|garnish|rim|top with|on top|whip/i.test(low)
    || /dust|sprinkle|drizzle|garnish|whipped/i.test(rowName);
  if (isGarnish) return { kind: 'skip', reason: 'garnish' };

  const n = parseNumber(low);

  if (/bell/.test(low) && n != null) {
    const per = /large/.test(low) ? LARGE_BELL_OZ : SMALL_BELL_OZ;
    return { kind: 'qty', qty: { quantity: n * per, unit: 'oz' } };
  }
  if (/pump/.test(low) && n != null) {
    const isSauce = /sauce/i.test(rowFull);
    return { kind: 'qty', qty: { quantity: n * pumpOz(`${rowFull} ${low}`, isSauce), unit: 'oz' } };
  }
  if (/shot/.test(low) && n != null) {
    return { kind: 'qty', qty: { quantity: n * ESPRESSO_G_PER_SHOT, unit: 'g' } };
  }
  if (/scoop/.test(low) && n != null) {
    const per = /white/.test(low) ? WHITE_SCOOP_G : RED_SCOOP_G;
    return { kind: 'qty', qty: { quantity: n * per, unit: 'g' } };
  }
  if (/\boz\b|ounce/.test(low) && n != null) {
    return { kind: 'qty', qty: { quantity: n, unit: 'oz' } };
  }
  if (/\bg\b|gram/.test(low) && n != null) {
    return { kind: 'qty', qty: { quantity: n, unit: 'g' } };
  }

  const isFillish = /fill|stir|heaping|top/i.test(low);
  if (isFillish) {
    if (/ice/i.test(rowName)) return { kind: 'fill-ice' };
    if (/milk/i.test(rowName)) return { kind: 'fill-milk' };
    return { kind: 'skip', reason: `unmeasured ("${cell}")` };
  }
  // Bare number: assume oz (2026 SOPs are oz-canonical).
  if (n != null && /^[\d.½¼¾\s]+$/.test(low)) {
    return { kind: 'qty', qty: { quantity: n, unit: 'oz' } };
  }
  return { kind: 'skip', reason: `unparseable ("${cell}")` };
}

// ── size mapping ──────────────────────────────────────────────────
function mapSize(label: string): 'S' | 'R' | 'L' | 'K' | null {
  const l = label.trim().toLowerCase();
  if (l === 's' || l.startsWith('small')) return 'S';
  if (l === 'r' || l.startsWith('reg')) return 'R';
  if (l === 'l' || l.startsWith('large')) return 'L';
  if (l.startsWith('kid')) return 'K';
  return null;
}

const SIZE_WORD: Record<string, string> = { S: 'Small', R: 'Regular', L: 'Large', K: 'Kids' };
const TEMP_WORD: Record<string, string> = { hot: 'Hot', iced: 'Iced', frozen: 'Frozen' };

// ── variant + component writers ───────────────────────────────────
function ensureVariant(drinkId: number, temp: string, size: string, sortOrder: number): number {
  const existing = db.prepare(
    'SELECT id FROM cog_drink_variants WHERE drink_id = ? AND temp = ? AND size = ?',
  ).get(drinkId, temp, size) as any;
  if (existing) return existing.id;
  const r = db.prepare(
    'INSERT INTO cog_drink_variants (drink_id, label, temp, size, sort_order) VALUES (?, ?, ?, ?, ?)',
  ).run(drinkId, `${TEMP_WORD[temp]} ${SIZE_WORD[size]}`, temp, size, sortOrder);
  return r.lastInsertRowid as number;
}

function addComponent(drinkId: number, variantId: number, src: ResolvedSource, qty: ParsedQty, order: number) {
  db.prepare(`
    INSERT INTO cog_drink_components (drink_id, variant_id, component_type, ingredient_id, recipe_id, quantity, unit, yield_percent, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, 100, ?)
  `).run(
    drinkId, variantId, src.type,
    src.type === 'ingredient' ? src.id : null,
    src.type === 'recipe' ? src.id : null,
    Math.round(qty.quantity * 1000) / 1000, qty.unit, order,
  );
}

// ── main sync ─────────────────────────────────────────────────────
export interface SopCogSyncReport {
  filled: Array<{ drink: string; sop: string; collection: string; variants: number; skippedLines: string[] }>;
  baseline: Array<{ drink: string; flavor: string }>;
  skipped: Array<{ name: string; reason: string }>;
  unresolved: string[];
}

function collectionYear(c: string | null): number {
  const years = (c ?? '').match(/20\d\d/g);
  return years ? Math.max(...years.map(Number)) : 0;
}

export function syncSopsToCog(): SopCogSyncReport {
  const report: SopCogSyncReport = { filled: [], baseline: [], skipped: [], unresolved: [] };
  const unresolvedSet = new Set<string>();
  const resolve = buildResolver();

  // Newest SOP per normalized drink name.
  const sops = db.prepare(`
    SELECT id, slug, name, collection FROM sops
    WHERE kind = 'drink' AND sop_required = 1
  `).all() as Array<{ id: number; slug: string; name: string; collection: string | null }>;
  const bestByName = new Map<string, typeof sops[number]>();
  for (const s of sops) {
    const key = norm(s.name);
    const cur = bestByName.get(key);
    if (!cur || collectionYear(s.collection) > collectionYear(cur.collection)
      || (collectionYear(s.collection) === collectionYear(cur.collection) && s.id > cur.id)) {
      bestByName.set(key, s);
    }
  }

  const drinks = db.prepare('SELECT id, name FROM cog_drinks WHERE archived = 0').all() as Array<{ id: number; name: string }>;
  const drinkByNorm = new Map(drinks.map((d) => [norm(d.name), d]));
  const componentCount = db.prepare('SELECT COUNT(*) AS c FROM cog_drink_components WHERE drink_id = ?');

  const markFilled = db.prepare(`
    UPDATE cog_drinks SET needs_confirm = 1,
      notes = COALESCE(notes || char(10), '') || ?,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  const txn = db.transaction(() => {
    // ── pass 1: SOP-derived recipes ──────────────────────────────
    for (const sop of bestByName.values()) {
      const drink = drinkByNorm.get(norm(sop.name));
      if (!drink) {
        report.skipped.push({ name: sop.name, reason: `no matching drink in the COGS catalog (${sop.collection ?? 'no collection'})` });
        continue;
      }
      if ((componentCount.get(drink.id) as any).c > 0) {
        report.skipped.push({ name: sop.name, reason: 'drink already has a recipe — not touched' });
        continue;
      }

      const variants = db.prepare(
        'SELECT id, temperature, size_labels_json FROM sop_variants WHERE sop_id = ? ORDER BY position',
      ).all(sop.id) as Array<{ id: number; temperature: string; size_labels_json: string }>;
      if (variants.length === 0) {
        report.skipped.push({ name: sop.name, reason: 'SOP has no variants' });
        continue;
      }

      const skippedLines = new Set<string>();
      let variantCount = 0;
      let sortOrder = 0;
      for (const v of variants) {
        let sizeLabels: string[] = [];
        try { sizeLabels = JSON.parse(v.size_labels_json); } catch { /* default below */ }
        const sizes = sizeLabels.map(mapSize);
        const rows = db.prepare(
          'SELECT name, modifier, cells_json FROM sop_rows WHERE variant_id = ? ORDER BY position',
        ).all(v.id) as Array<{ name: string; modifier: string | null; cells_json: string }>;

        for (let si = 0; si < sizes.length; si++) {
          const size = sizes[si];
          if (!size) continue;
          const variantId = ensureVariant(drink.id, v.temperature, size, sortOrder++);
          // Rebuild components for this variant from scratch (drink was uncosted).
          db.prepare('DELETE FROM cog_drink_components WHERE variant_id = ?').run(variantId);
          variantCount++;
          let order = 0;
          for (const row of rows) {
            let cells: string[] = [];
            try { cells = JSON.parse(row.cells_json); } catch { /* skip */ }
            const cell = cells[si] ?? '';
            const parsed = parseCell(String(cell), row.name, row.modifier);
            let qty: ParsedQty | null = null;
            if (parsed.kind === 'qty') qty = parsed.qty;
            else if (parsed.kind === 'fill-milk' && v.temperature === 'hot') qty = { quantity: HOT_MILK_FILL_OZ[size] ?? 9, unit: 'oz' };
            else if (parsed.kind === 'fill-ice') {
              const iceOz = v.temperature === 'frozen' ? FROZEN_ICE_OZ[size] : ICED_ICE_OZ[size];
              if (iceOz != null) qty = { quantity: iceOz, unit: 'oz' };
            } else if (parsed.kind === 'skip' && parsed.reason !== 'none' && parsed.reason !== 'garnish') {
              skippedLines.add(`${row.name}: ${parsed.reason}`);
            } else if (parsed.kind === 'skip' && parsed.reason === 'garnish') {
              skippedLines.add(`${row.name} (garnish — not costed)`);
            }
            if (!qty || qty.quantity <= 0) continue;
            const src = resolve(row.name);
            if (!src) {
              unresolvedSet.add(row.name);
              skippedLines.add(`${row.name}: not in ingredient catalog or batch recipes`);
              continue;
            }
            addComponent(drink.id, variantId, src, qty, order++);
          }
          // Packaging by temp/size — same items the hand-costed drinks carry.
          const pack = v.temperature === 'hot' ? HOT_PACKAGING[size] : COLD_PACKAGING[size];
          for (const [packName, packQty] of pack ?? []) {
            const src = resolve(packName);
            if (src) addComponent(drink.id, variantId, src, { quantity: packQty, unit: 'item' }, order++);
          }
        }
      }

      const note = `[auto] Recipe filled from SOP "${sop.name}" (${sop.collection ?? 'uncollected'}) on ${new Date().toISOString().slice(0, 10)}.`
        + (skippedLines.size > 0 ? ` Not costed: ${[...skippedLines].join('; ')}.` : '');
      markFilled.run(note, drink.id);
      report.filled.push({
        drink: drink.name, sop: sop.name, collection: sop.collection ?? '',
        variants: variantCount, skippedLines: [...skippedLines],
      });
    }

    // ── pass 2: baseline house build for flavored drinks ─────────
    // 3 oz cold brew + 9 oz milk + 1 oz flavor on iced R (Vanilla Latte
    // archetype), hot uses espresso shots + steamed-milk fill.
    // Flavors come from batch recipes (haus syrups/sauces) plus master
    // ingredients, minus structural ones (milk, espresso, packaging...).
    const STRUCTURAL = /^(whole milk|oat milk|almond milk|milk|cold brew|espresso|polar powder|ice|half half|water|sugar)$|^(cup|lid|straw|sleeve|stopper)\b|chai/;
    const flavorSources: ResolvedSource[] = [
      ...(db.prepare('SELECT id, name FROM cog_recipes').all() as Array<{ id: number; name: string }>)
        .map((r) => ({ type: 'recipe' as const, id: r.id, name: r.name })),
      ...(db.prepare('SELECT id, name FROM cog_ingredient_master').all() as Array<{ id: number; name: string }>)
        .filter((i) => !STRUCTURAL.test(norm(i.name)))
        .map((i) => ({ type: 'ingredient' as const, id: i.id, name: i.name })),
    ];
    const coffeeCategories = new Set(['SWEET COFFEE', 'BRIDGE COFFEE', 'ARTISANAL COFFEE', 'TRADITIONAL COFFEE']);
    const uncosted = db.prepare('SELECT id, name, category FROM cog_drinks WHERE archived = 0').all() as Array<{ id: number; name: string; category: string | null }>;

    const BASELINE = {
      hot: { sizes: ['S', 'R', 'L'], espressoShots: [1, 2, 3], milkOz: [7, 9, 11], flavorOz: [0.75, 1.25, 1.75] },
      iced: { sizes: ['K', 'R', 'L'], coldBrewOz: [1.5, 3, 5], milkOz: [4.5, 9, 12.5], iceOz: [3.5, 5, 5], flavorOz: [0.5, 1, 1.5] },
    };

    for (const d of uncosted) {
      if (!d.category || !coffeeCategories.has(d.category)) continue;
      if ((componentCount.get(d.id) as any).c > 0) continue;
      const dToks = new Set(flavorNorm(d.name).split(' ').filter(Boolean));
      let flavor: ResolvedSource | null = null;
      let flavorScore = 0;
      for (const f of flavorSources) {
        const toks = flavorNorm(f.name).split(' ').filter(Boolean);
        if (toks.length === 0 || !toks.every((t) => dToks.has(t))) continue;
        if (toks.length > flavorScore) { flavor = f; flavorScore = toks.length; }
      }
      if (!flavor) continue;

      const espresso = resolve('Espresso');
      const coldBrew = resolve('Cold Brew');
      const milk = resolve('Milk');
      const ice = resolve('Ice');
      if (!espresso || !coldBrew || !milk) continue;

      let sortOrder = 0;
      for (const temp of ['hot', 'iced'] as const) {
        const t = BASELINE[temp];
        t.sizes.forEach((size, i) => {
          const variantId = ensureVariant(d.id, temp, size, sortOrder++);
          db.prepare('DELETE FROM cog_drink_components WHERE variant_id = ?').run(variantId);
          let order = 0;
          if (temp === 'hot') {
            addComponent(d.id, variantId, espresso, { quantity: (BASELINE.hot.espressoShots[i]) * ESPRESSO_G_PER_SHOT, unit: 'g' }, order++);
            addComponent(d.id, variantId, milk, { quantity: BASELINE.hot.milkOz[i], unit: 'oz' }, order++);
          } else {
            addComponent(d.id, variantId, coldBrew, { quantity: BASELINE.iced.coldBrewOz[i], unit: 'oz' }, order++);
            if (ice) addComponent(d.id, variantId, ice, { quantity: BASELINE.iced.iceOz[i], unit: 'oz' }, order++);
            addComponent(d.id, variantId, milk, { quantity: BASELINE.iced.milkOz[i], unit: 'oz' }, order++);
          }
          addComponent(d.id, variantId, flavor!, { quantity: t.flavorOz[i], unit: 'oz' }, order++);
          const pack = temp === 'hot' ? HOT_PACKAGING[size] : COLD_PACKAGING[size];
          for (const [packName, packQty] of pack ?? []) {
            const src = resolve(packName);
            if (src) addComponent(d.id, variantId, src, { quantity: packQty, unit: 'item' }, order++);
          }
        });
      }
      markFilled.run(
        `[auto] Baseline house build (3oz cold brew / 9oz milk / 1oz flavor @ iced R) with "${flavor.name}" on ${new Date().toISOString().slice(0, 10)}. Review before trusting the COG.`,
        d.id,
      );
      report.baseline.push({ drink: d.name, flavor: flavor.name });
    }
  });
  txn();

  report.unresolved = [...unresolvedSet].sort();
  return report;
}
