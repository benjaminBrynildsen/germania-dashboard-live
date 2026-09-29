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
