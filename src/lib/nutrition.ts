// Shared nutrition math for the COGS Nutrition tab. Pure functions so the
// drink-facts computation is testable outside the UI.

export interface NutritionVec {
  calories: number;
  fat_g: number;
  sat_fat_g: number;
  carbs_g: number;
  sugar_g: number;
  protein_g: number;
  sodium_mg: number;
}

export const ZERO_NUTRITION: NutritionVec = {
  calories: 0, fat_g: 0, sat_fat_g: 0, carbs_g: 0, sugar_g: 0, protein_g: 0, sodium_mg: 0,
};

export const NUTRITION_FIELDS: Array<{ key: keyof NutritionVec; label: string; unit: string }> = [
  { key: 'calories', label: 'Calories', unit: '' },
  { key: 'fat_g', label: 'Total Fat', unit: 'g' },
  { key: 'sat_fat_g', label: 'Saturated Fat', unit: 'g' },
  { key: 'carbs_g', label: 'Total Carbs', unit: 'g' },
  { key: 'sugar_g', label: 'Sugars', unit: 'g' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
];

export function addNutrition(a: NutritionVec, b: NutritionVec): NutritionVec {
  const out = { ...ZERO_NUTRITION };
  for (const f of NUTRITION_FIELDS) out[f.key] = (a[f.key] || 0) + (b[f.key] || 0);
  return out;
}

export function scaleNutrition(v: NutritionVec, factor: number): NutritionVec {
  const out = { ...ZERO_NUTRITION };
  for (const f of NUTRITION_FIELDS) out[f.key] = (v[f.key] || 0) * factor;
  return out;
}

/** Pump volume in fluid oz by recipe kind and pump size. House standard:
 *  1 oz for either kind; an extra pump is 1.5 oz of sauce, 1.25 oz of syrup. */
export const PUMP_OZ: Record<'syrup' | 'sauce', { standard: number; extra: number }> = {
  syrup: { standard: 1.0, extra: 1.25 },
  sauce: { standard: 1.0, extra: 1.5 },
};

/** Running batch cost: each line's $ per unit × its quantity, summed.
 *  Lines without a cost contribute 0; `complete` says whether every
 *  costed conclusion can be trusted (all lines have both qty and cost). */
export function batchCost(items: Array<{ qty: number | null; cost_per_unit?: number | null }>): {
  total: number;
  complete: boolean;
} {
  let total = 0;
  let complete = true;
  for (const it of items) {
    if (it.qty != null && it.cost_per_unit != null) total += it.qty * it.cost_per_unit;
    else complete = false;
  }
  return { total, complete };
}

/** Batch totals: each line's per-unit nutrition × its quantity, summed. */
export function batchTotals(items: Array<NutritionVec & { qty: number | null }>): NutritionVec {
  return items.reduce(
    (acc, it) => addNutrition(acc, scaleNutrition(it, it.qty || 0)),
    { ...ZERO_NUTRITION },
  );
}

/** Per-fluid-oz nutrition of a finished batch. null when yield is unusable. */
export function perOz(totals: NutritionVec, yieldOz: number | null | undefined): NutritionVec | null {
  if (!yieldOz || yieldOz <= 0) return null;
  return scaleNutrition(totals, 1 / yieldOz);
}

/** Full drink build: coffee + milk + one pump of the syrup/sauce.
 *  All inputs are per-fluid-oz vectors; oz amounts scale each. */
export function drinkFacts(opts: {
  coffeePerOz: NutritionVec; coffeeOz: number;
  milkPerOz: NutritionVec; milkOz: number;
  recipePerOz: NutritionVec;
  kind: 'syrup' | 'sauce';
  pump: 'standard' | 'extra';
}): { total: NutritionVec; pumpOz: number } {
  const pumpOz = PUMP_OZ[opts.kind][opts.pump];
  const total = addNutrition(
    addNutrition(
      scaleNutrition(opts.coffeePerOz, opts.coffeeOz),
      scaleNutrition(opts.milkPerOz, opts.milkOz),
    ),
    scaleNutrition(opts.recipePerOz, pumpOz),
  );
  return { total, pumpOz };
}

/** Display rounding: calories to the nearest 5 (label convention),
 *  grams to 1 decimal, sodium to whole mg. */
export function fmtNutrient(key: keyof NutritionVec, value: number): string {
  if (key === 'calories') return String(Math.round(value / 5) * 5);
  if (key === 'sodium_mg') return String(Math.round(value));
  return (Math.round(value * 10) / 10).toString();
}

// ── Anomaly screening ─────────────────────────────────────────────
// Born from the salty-drink incident: a sauce with ~5× a Gatorade's
// sodium made it into a launched drink before anyone tasted the math.
// Two screens: what ONE pump adds (catches a broken recipe on its own),
// and the finished drink against familiar benchmarks.

export interface NutritionFlag {
  key: keyof NutritionVec;
  level: 'warn' | 'alert';
  message: string;
}

const GATORADE_12OZ_SODIUM_MG = 160; // classic Gatorade Thirst Quencher
const COKE_12OZ_SUGAR_G = 39;

/** Screen what a single standard pump contributes. Thresholds are set so
 *  a normal house syrup (~80-100 cal, ~20g sugar, trace sodium per oz)
 *  passes clean and genuinely broken batches light up. */
export function screenPump(perOzVec: NutritionVec, kind: 'syrup' | 'sauce'): NutritionFlag[] {
  const pumpOz = PUMP_OZ[kind].standard;
  const pump = scaleNutrition(perOzVec, pumpOz);
  const flags: NutritionFlag[] = [];
  const push = (key: keyof NutritionVec, level: 'warn' | 'alert', message: string) =>
    flags.push({ key, level, message });

  if (pump.sodium_mg > 250) {
    push('sodium_mg', 'alert', `One pump carries ${Math.round(pump.sodium_mg)}mg sodium — more than a whole 12-oz Gatorade (${GATORADE_12OZ_SODIUM_MG}mg). Double-check the salt quantity and units.`);
  } else if (pump.sodium_mg > 120) {
    push('sodium_mg', 'warn', `One pump carries ${Math.round(pump.sodium_mg)}mg sodium — most of a 12-oz Gatorade (${GATORADE_12OZ_SODIUM_MG}mg). Worth a taste test.`);
  }
  if (pump.sugar_g > 28) {
    push('sugar_g', 'alert', `One pump carries ${Math.round(pump.sugar_g)}g sugar (~${Math.round(pump.sugar_g / 4)} tsp). Check the sugar quantity and yield.`);
  } else if (pump.sugar_g > 20) {
    push('sugar_g', 'warn', `One pump carries ${Math.round(pump.sugar_g)}g sugar (~${Math.round(pump.sugar_g / 4)} tsp) — on the heavy side for a single pump.`);
  }
  if (pump.calories > 200) {
    push('calories', 'alert', `One pump adds ${Math.round(pump.calories)} calories. Typical house syrups run 80-100 per pump — check quantities and yield.`);
  } else if (pump.calories > 120) {
    push('calories', 'warn', `One pump adds ${Math.round(pump.calories)} calories — rich for a single pump.`);
  }
  if (pump.sat_fat_g > 7) {
    push('sat_fat_g', 'alert', `One pump carries ${(Math.round(pump.sat_fat_g * 10) / 10)}g saturated fat — about a third of a day's worth.`);
  } else if (pump.sat_fat_g > 4) {
    push('sat_fat_g', 'warn', `One pump carries ${(Math.round(pump.sat_fat_g * 10) / 10)}g saturated fat.`);
  }
  return flags;
}

/** Screen the finished drink against familiar drink benchmarks. */
export function screenDrink(total: NutritionVec): NutritionFlag[] {
  const flags: NutritionFlag[] = [];
  const push = (key: keyof NutritionVec, level: 'warn' | 'alert', message: string) =>
    flags.push({ key, level, message });

  if (total.sodium_mg > 400) {
    const x = Math.round((total.sodium_mg / GATORADE_12OZ_SODIUM_MG) * 10) / 10;
    push('sodium_mg', 'alert', `${Math.round(total.sodium_mg)}mg sodium — ${x}× a 12-oz Gatorade. Customers will taste this.`);
  } else if (total.sodium_mg > 250) {
    push('sodium_mg', 'warn', `${Math.round(total.sodium_mg)}mg sodium — saltier than most coffee drinks (a 12-oz Gatorade is ${GATORADE_12OZ_SODIUM_MG}mg).`);
  }
  if (total.sugar_g > 45) {
    push('sugar_g', 'alert', `${Math.round(total.sugar_g)}g sugar — more than a 12-oz Coke (${COKE_12OZ_SUGAR_G}g).`);
  } else if (total.sugar_g > 32) {
    push('sugar_g', 'warn', `${Math.round(total.sugar_g)}g sugar — approaching a 12-oz Coke (${COKE_12OZ_SUGAR_G}g).`);
  }
  if (total.calories > 550) {
    push('calories', 'alert', `${Math.round(total.calories)} calories — meal territory for a single drink.`);
  } else if (total.calories > 400) {
    push('calories', 'warn', `${Math.round(total.calories)} calories — on the indulgent end.`);
  }
  if (total.sat_fat_g > 10) {
    push('sat_fat_g', 'alert', `${Math.round(total.sat_fat_g * 10) / 10}g saturated fat — half a day's worth in one drink.`);
  } else if (total.sat_fat_g > 7) {
    push('sat_fat_g', 'warn', `${Math.round(total.sat_fat_g * 10) / 10}g saturated fat.`);
  }
  return flags;
}
