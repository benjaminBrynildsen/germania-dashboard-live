import db from './db.js';

// Cost-of-goods math for finished drinks and their size/temp variants.
// Everything here is computed on read (nothing denormalized), so a price change
// to a master ingredient or a batch recipe flows through to every drink/variant
// that uses it the next time it's loaded.
//
// No rounding anywhere — callers round only at display. (Standing rule: humans
// round for speed, automated calcs stay exact.)

export interface ResolvedComponent {
  id: number;
  variant_id: number | null;
  component_type: 'ingredient' | 'recipe';
  ingredient_id: number | null;
  recipe_id: number | null;
  quantity: number | null;
  unit: string | null;
  yield_percent: number | null;
  sort_order: number;
  // resolved/derived:
  component_name: string;
  source_unit: string | null;   // pack_unit (ingredient) or yield_unit (recipe)
  unit_cost: number;            // cost of one source_unit
  line_cost: number;            // unit_cost * quantity / yield, contribution to the variant
  unit_mismatch: boolean;       // component.unit set and differs from source_unit
  missing_source: boolean;      // referenced ingredient/recipe no longer exists
}

export interface ResolvedVariant {
  id: number;
  drink_id: number;
  label: string;
  temp: string | null;
  size: string | null;
  menu_price: number | null;
  target_cogs_pct: number | null;
  sort_order: number;
  components: ResolvedComponent[];
  variant_cog: number;
  effective_target_cogs_pct: number;
  recommended_price: number | null;
  // margin vs the recorded menu_price, if present
  current_margin_pct: number | null;
}

// Per-unit cost of a batch recipe == the existing COG Manager formula
// (ingredient cost + labor) / yield. Mirrors the /cog/recipes route — single source.
export function recipeCogPerUnit(recipeId: number): number {
  const r = db
    .prepare(
      `SELECT r.total_yield, r.labor_cost_per_unit,
         COALESCE(SUM(i.ep_price * COALESCE(i.quantity_used, 0)), 0) AS total_ingredient_cost
       FROM cog_recipes r
       LEFT JOIN cog_ingredients i ON r.id = i.recipe_id
       WHERE r.id = ?
       GROUP BY r.id`,
    )
    .get(recipeId) as any;
  if (!r) return 0;
  const ingredientCost = r.total_ingredient_cost || 0;
  const laborCost = r.labor_cost_per_unit || 0;
  return r.total_yield > 0 ? (ingredientCost + laborCost) / r.total_yield : 0;
}

// Cost of one pack_unit of a master ingredient (ap_pack_cost / pack_size).
function ingredientUnitCost(ingredientId: number): { unit_cost: number; pack_unit: string | null; name: string } | null {
  const m = db
    .prepare('SELECT name, ap_pack_cost, pack_size, pack_unit FROM cog_ingredient_master WHERE id = ?')
    .get(ingredientId) as any;
  if (!m) return null;
  const unitCost = m.pack_size > 0 ? (m.ap_pack_cost || 0) / m.pack_size : 0;
  return { unit_cost: unitCost, pack_unit: m.pack_unit ?? null, name: m.name };
}

function resolveComponentRow(c: any): ResolvedComponent {
  const qty = c.quantity || 0;
  const yieldPct = c.yield_percent == null ? 100 : c.yield_percent;
  const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;

  let name = '(unknown)';
  let sourceUnit: string | null = null;
  let unitCost = 0;
  let missingSource = false;

  if (c.component_type === 'recipe') {
    const recipe = db.prepare('SELECT name, yield_unit FROM cog_recipes WHERE id = ?').get(c.recipe_id) as any;
    if (recipe) {
      name = recipe.name;
      sourceUnit = recipe.yield_unit ?? null;
      unitCost = recipeCogPerUnit(c.recipe_id);
    } else {
      missingSource = true;
    }
  } else {
    const ing = c.ingredient_id != null ? ingredientUnitCost(c.ingredient_id) : null;
    if (ing) {
      name = ing.name;
      sourceUnit = ing.pack_unit;
      unitCost = ing.unit_cost;
    } else {
      missingSource = true;
    }
  }

  const lineCost = (unitCost * qty) / yieldFactor;
  const unitMismatch =
    !missingSource &&
    !!c.unit &&
    !!sourceUnit &&
    String(c.unit).trim().toLowerCase() !== String(sourceUnit).trim().toLowerCase();

  return {
    id: c.id,
    variant_id: c.variant_id,
    component_type: c.component_type,
    ingredient_id: c.ingredient_id,
    recipe_id: c.recipe_id,
    quantity: c.quantity,
    unit: c.unit,
    yield_percent: c.yield_percent,
    sort_order: c.sort_order,
    component_name: name,
    source_unit: sourceUnit,
    unit_cost: unitCost,
    line_cost: lineCost,
    unit_mismatch: unitMismatch,
    missing_source: missingSource,
  };
}

export function resolveVariantComponents(variantId: number): ResolvedComponent[] {
  const rows = db
    .prepare('SELECT * FROM cog_drink_components WHERE variant_id = ? ORDER BY sort_order, id')
    .all(variantId) as any[];
  return rows.map(resolveComponentRow);
}

export function defaultTargetPct(): number {
  const s = db.prepare('SELECT default_target_cogs_pct FROM cog_settings WHERE id = 1').get() as any;
  return s?.default_target_cogs_pct ?? 25;
}

// recommended_price = cog / (target%/100). Returns null when target is non-positive.
export function recommendedPrice(cog: number, targetPct: number | null | undefined): number | null {
  const t = targetPct == null ? defaultTargetPct() : targetPct;
  if (!t || t <= 0) return null;
  return cog / (t / 100);
}

// All variants of a drink, each fully costed. drinkTargetPct is the drink-level
// override (null => global default); a variant can further override it.
export function drinkVariants(drinkId: number, drinkTargetPct: number | null): ResolvedVariant[] {
  const fallback = defaultTargetPct();
  const variants = db
    .prepare('SELECT * FROM cog_drink_variants WHERE drink_id = ? ORDER BY sort_order, id')
    .all(drinkId) as any[];

  return variants.map((v) => {
    const components = resolveVariantComponents(v.id);
    const cog = components.reduce((sum, c) => sum + c.line_cost, 0);
    const effectiveTarget = v.target_cogs_pct ?? drinkTargetPct ?? fallback;
    const rec = recommendedPrice(cog, v.target_cogs_pct ?? drinkTargetPct);
    const currentMargin = v.menu_price && v.menu_price > 0 ? ((v.menu_price - cog) / v.menu_price) * 100 : null;
    return {
      id: v.id,
      drink_id: v.drink_id,
      label: v.label,
      temp: v.temp,
      size: v.size,
      menu_price: v.menu_price,
      target_cogs_pct: v.target_cogs_pct,
      sort_order: v.sort_order,
      components,
      variant_cog: cog,
      effective_target_cogs_pct: effectiveTarget,
      recommended_price: rec,
      current_margin_pct: currentMargin,
    };
  });
}

// Compact COG range across a drink's variants, for list views.
export function drinkCogRange(drinkId: number, drinkTargetPct: number | null): {
  variant_count: number;
  min_cog: number | null;
  max_cog: number | null;
  min_recommended: number | null;
  max_recommended: number | null;
} {
  const variants = drinkVariants(drinkId, drinkTargetPct);
  const costed = variants.filter((v) => v.components.length > 0);
  if (costed.length === 0) {
    return { variant_count: variants.length, min_cog: null, max_cog: null, min_recommended: null, max_recommended: null };
  }
  const cogs = costed.map((v) => v.variant_cog);
  const recs = costed.map((v) => v.recommended_price).filter((x): x is number => x != null);
  return {
    variant_count: variants.length,
    min_cog: Math.min(...cogs),
    max_cog: Math.max(...cogs),
    min_recommended: recs.length ? Math.min(...recs) : null,
    max_recommended: recs.length ? Math.max(...recs) : null,
  };
}
