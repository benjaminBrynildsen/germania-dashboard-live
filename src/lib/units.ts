// Kitchen unit conversions for the recipe builder. Converts between
// units of the same kind (volume↔volume, weight↔weight) so a chef can
// measure in cups against an ingredient bought by the gallon. Cross-kind
// (a cup of flour from a 50 lb bag) needs an ingredient-specific factor —
// density — so the builder asks for it instead of guessing.
//
// "oz" is genuinely ambiguous in a kitchen (fluid oz vs weight oz); the
// sheets this app mirrors use it both ways. It lives in both tables, and
// same-unit always resolves to 1 first, so oz→oz never misconverts.

const ALIASES: Record<string, string> = {
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz', floz: 'oz', 'fl oz': 'oz',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  c: 'c', cup: 'c', cups: 'c',
  pt: 'pt', pint: 'pt', pints: 'pt',
  qt: 'qt', qts: 'qt', quart: 'qt', quarts: 'qt',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  ml: 'ml', l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  each: 'each', ea: 'each',
  slice: 'slices', slices: 'slices',
  scoop: 'scoops', scoops: 'scoops',
  dozen: 'dozen',
  pack: 'packs', packs: 'packs',
  stalk: 'stalks', stalks: 'stalks',
};

export function normalizeUnit(u: string | null | undefined): string {
  return ALIASES[(u || '').trim().toLowerCase()] ?? (u || '').trim().toLowerCase();
}

// Sizes in fluid oz / weight oz respectively.
const VOLUME_FLOZ: Record<string, number> = {
  tsp: 1 / 6, tbsp: 0.5, oz: 1, c: 8, pt: 16, qt: 32, gal: 128, ml: 0.033814, l: 33.814,
};
const WEIGHT_OZ: Record<string, number> = {
  g: 1 / 28.3495, kg: 35.274, oz: 1, lb: 16,
};
const COUNT: Record<string, number> = { each: 1, dozen: 12 };

/** How many `useUnit` fit in one `packUnit` — or null when the pair needs
 *  an ingredient-specific factor (weight↔volume, or unknown units). */
export function unitsPerPackUnit(packUnit: string | null | undefined, useUnit: string | null | undefined): number | null {
  const p = normalizeUnit(packUnit);
  const u = normalizeUnit(useUnit);
  if (!p || !u) return null;
  if (p === u) return 1;
  if (p in VOLUME_FLOZ && u in VOLUME_FLOZ) return VOLUME_FLOZ[p] / VOLUME_FLOZ[u];
  if (p in WEIGHT_OZ && u in WEIGHT_OZ) return WEIGHT_OZ[p] / WEIGHT_OZ[u];
  if (p in COUNT && u in COUNT) return COUNT[p] / COUNT[u];
  return null;
}

/** Measuring units offered in the builder's dropdown (the ingredient's own
 *  pack unit is always offered too). */
export const MEASURE_UNITS = ['tsp', 'tbsp', 'oz', 'c', 'pt', 'qt', 'gal', 'ml', 'l', 'g', 'kg', 'lb', 'each', 'slices', 'scoops'];

/** Canonical batch yield units — matches what the existing recipes use. */
export const YIELD_UNITS = ['each', 'oz', 'lbs', 'packs', 'dozen', 'slices', 'gallon', 'qt', 'liter'];

/** Canonical pack units for custom/one-off ingredient lines. */
export const PACK_UNITS = ['oz', 'lbs', 'gal', 'qt', 'pt', 'c', 'each', 'dozen', 'g', 'kg', 'ml', 'l', 'slices', 'packs', 'stalks'];

/** Season choices: every season already used on a recipe plus the generated
 *  set around today, newest first — same spelling the workbooks use
 *  (SPRING 2026, WINTER 2025-26, …) so filters never split. */
export function seasonOptions(existing: Array<string | null | undefined> = []): string[] {
  const y = new Date().getFullYear();
  const set = new Set<string>();
  for (const s of existing) if (s && s.trim()) set.add(s.trim().toUpperCase());
  for (const yr of [y - 1, y, y + 1]) {
    set.add(`SPRING ${yr}`);
    set.add(`SUMMER ${yr}`);
    set.add(`FALL ${yr}`);
    set.add(`WINTER ${yr}-${String((yr + 1) % 100).padStart(2, '0')}`);
  }
  const order: Record<string, number> = { WINTER: 3, FALL: 2, SUMMER: 1, SPRING: 0 };
  return [...set].sort((a, b) => {
    const ya = parseInt(a.match(/\d{4}/)?.[0] ?? '0', 10);
    const yb = parseInt(b.match(/\d{4}/)?.[0] ?? '0', 10);
    if (ya !== yb) return yb - ya;
    return (order[b.split(' ')[0]] ?? -1) - (order[a.split(' ')[0]] ?? -1);
  });
}
