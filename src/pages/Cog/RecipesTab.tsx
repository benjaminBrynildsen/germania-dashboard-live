import { useState, useEffect, useMemo } from 'react';
import { api } from '../../lib/api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useCanEdit, SummaryCard, InfoBox, Modal, NumInput, inputStyle, labelStyle } from './ui';

interface Recipe {
  id: number;
  name: string;
  season: string;
  category: string | null;
  total_yield: number;
  yield_unit: string;
  labor_time_hrs: number | null;
  labor_quantity: number | null;
  labor_cook_rate: number | null;
  labor_cost_per_unit: number | null;
  ingredient_count: number;
  total_ingredient_cost: number;
  cog_per_unit: number;
}

interface Ingredient {
  id: number;
  recipe_id: number;
  name: string;
  ap_pack_cost: number;
  pack_size: number;
  pack_unit: string;
  unit_conversion: number;
  ap_price: number;
  ap_price_unit: string;
  yield_percent: number;
  ep_price: number;
  ep_price_unit: string;
  quantity_used: number | null;
  sort_order: number;
}

interface RecipeDetail extends Recipe {
  ingredients: Ingredient[];
}

const STATUS_COLORS: Record<string, string> = {
  'SPRING 2026': 'badge-green',
  'WINTER 2025-26': 'badge-blue',
  'FALL 2025': 'badge-gold',
  'SUMMER 2025': 'badge-red',
};

export default function RecipesTab() {
  const isMobile = useIsMobile();
  const canEdit = useCanEdit();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState<string>('All');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRecipe, setExpandedRecipe] = useState<number | null>(null);
  const [recipeDetail, setRecipeDetail] = useState<RecipeDetail | null>(null);
  const [menuPrice, setMenuPrice] = useState<string>('');
  const [batchMultiplier, setBatchMultiplier] = useState<string>('1');
  const [seeding, setSeeding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(false);

  useEffect(() => { loadRecipes(); }, []);
  useEffect(() => { if (expandedRecipe) loadRecipeDetail(expandedRecipe); }, [expandedRecipe]);

  const loadRecipes = async () => {
    try {
      setRecipes(await api.get('/api/cog/recipes'));
    } catch (err) {
      console.error('Failed to load recipes:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadRecipeDetail = async (id: number) => {
    try {
      const data = await api.get(`/api/cog/recipes/${id}`);
      setRecipeDetail(data);
      setMenuPrice('');
      setBatchMultiplier('1');
    } catch (err) {
      console.error('Failed to load recipe detail:', err);
    }
  };

  const refresh = async () => {
    await loadRecipes();
    if (expandedRecipe) {
      const data = await api.get(`/api/cog/recipes/${expandedRecipe}`).catch(() => null);
      if (data) setRecipeDetail(data);
    }
  };

  const handleSeedData = async () => {
    if (!confirm('This will reset all batch-recipe COG data and import from the JSON file. Continue?')) return;
    setSeeding(true);
    try {
      await api.post('/api/cog/seed');
      alert('COG data seeded successfully!');
      loadRecipes();
    } catch (err: any) {
      alert(`Seed failed: ${err.message}`);
    } finally {
      setSeeding(false);
    }
  };

  const deleteRecipe = async (r: RecipeDetail) => {
    if (!confirm(`Delete "${r.name}" and its ingredient lines?`)) return;
    try {
      await api.delete(`/api/cog/recipes/${r.id}`);
    } catch (err: any) {
      // 409: the recipe is used inside drinks — confirm the forced delete.
      const usedBy: string[] = err?.body?.used_by ?? [];
      if (usedBy.length > 0) {
        if (!confirm(`"${r.name}" is used as a component in: ${usedBy.join(', ')}.\n\nDelete anyway? Those drink lines will show as "missing" until replaced.`)) return;
        try { await api.delete(`/api/cog/recipes/${r.id}?force=1`); }
        catch (e2: any) { alert(`Delete failed: ${e2.message}`); return; }
      } else {
        alert(`Delete failed: ${err.message}`);
        return;
      }
    }
    setExpandedRecipe(null);
    setRecipeDetail(null);
    loadRecipes();
  };

  const seasons = useMemo(() => {
    const unique = new Set(recipes.map(r => r.season).filter(Boolean));
    return ['All', ...Array.from(unique).sort().reverse()];
  }, [recipes]);

  const categories = useMemo(() => {
    const unique = new Set(recipes.map(r => r.category).filter(Boolean));
    return ['All', ...Array.from(unique).sort()];
  }, [recipes]);

  const filteredRecipes = useMemo(() => {
    return recipes.filter(r => {
      if (selectedSeason !== 'All' && r.season !== selectedSeason) return false;
      if (selectedCategory !== 'All' && r.category !== selectedCategory) return false;
      if (searchQuery && !r.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [recipes, selectedSeason, selectedCategory, searchQuery]);

  const stats = useMemo(() => {
    const totalRecipes = filteredRecipes.length;
    const avgCog = filteredRecipes.length > 0
      ? filteredRecipes.reduce((sum, r) => sum + r.cog_per_unit, 0) / filteredRecipes.length
      : 0;
    const sorted = [...filteredRecipes].sort((a, b) => b.cog_per_unit - a.cog_per_unit);
    return { totalRecipes, avgCog, highest: sorted[0], lowest: sorted[sorted.length - 1] };
  }, [filteredRecipes]);

  const margin = useMemo(() => {
    if (!recipeDetail || !menuPrice || parseFloat(menuPrice) <= 0) return null;
    const price = parseFloat(menuPrice);
    const cog = recipeDetail.cog_per_unit;
    return { price, cog, marginPercent: ((price - cog) / price) * 100 };
  }, [recipeDetail, menuPrice]);

  if (loading) return <div style={{ color: 'rgba(0,0,0,0.3)', padding: 40 }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0, marginBottom: 20 }}>
        <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13 }}>
          Batch recipes (syrups, sauces) and their cost per unit. These can be used as components inside a drink.
        </p>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={handleSeedData} disabled={seeding} className="btn btn-secondary">
              {seeding ? 'Seeding...' : 'Seed from JSON'}
            </button>
            <button onClick={() => setCreating(true)} className="btn btn-primary">+ New recipe</button>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        <SummaryCard label="Total Recipes" value={stats.totalRecipes.toString()} />
        <SummaryCard label="Avg COG/Unit" value={`$${stats.avgCog.toFixed(2)}`} />
        <SummaryCard label="Highest COG" value={stats.highest ? `$${stats.highest.cog_per_unit.toFixed(2)}` : '—'} sub={stats.highest?.name} />
        <SummaryCard label="Lowest COG" value={stats.lowest ? `$${stats.lowest.cog_per_unit.toFixed(2)}` : '—'} sub={stats.lowest?.name} />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Season</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {seasons.map(s => (
                <button key={s} onClick={() => setSelectedSeason(s)} style={filterBtn(selectedSeason === s)}>{s}</button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Category</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {categories.map(c => (
                <button key={c} onClick={() => setSelectedCategory(c ?? 'All')} style={filterBtn(selectedCategory === c)}>{c}</button>
              ))}
            </div>
          </div>
        </div>
        <input
          type="text" placeholder="Search recipes..." value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', fontSize: 14, fontFamily: 'inherit', background: 'rgba(255,255,255,0.5)' }}
        />
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {filteredRecipes.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 60, color: 'rgba(0,0,0,0.3)' }}>No recipes found</div>
        )}
        {filteredRecipes.map(recipe => (
          <div key={recipe.id}>
            <div className="card" onClick={() => setExpandedRecipe(expandedRecipe === recipe.id ? null : recipe.id)}
              style={{ cursor: 'pointer', background: expandedRecipe === recipe.id ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.8)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 10 : 0 }}>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.2, marginBottom: 4 }}>{recipe.name}</h3>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {recipe.season && <span className={`badge ${STATUS_COLORS[recipe.season] || 'badge-blue'}`}>{recipe.season}</span>}
                    {recipe.category && <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>{recipe.category}</span>}
                    <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.3)' }}>• {recipe.ingredient_count} ingredients</span>
                  </div>
                </div>
                <div style={{ textAlign: isMobile ? 'left' : 'right' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a' }}>${(recipe.cog_per_unit || 0).toFixed(3)}</div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginTop: 2 }}>per {recipe.yield_unit}</div>
                </div>
              </div>
            </div>

            {expandedRecipe === recipe.id && recipeDetail && (
              <div className="card" style={{ marginTop: 8, background: 'rgba(255,255,255,0.95)' }}>
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
                    <InfoBox label="Total Yield" value={`${recipeDetail.total_yield} ${recipeDetail.yield_unit}`} />
                    <InfoBox label="Ingredient Cost" value={`$${(recipeDetail.total_ingredient_cost || 0).toFixed(2)}`} />
                    <InfoBox label="Labor Cost" value={`$${(recipeDetail.labor_cost_per_unit || 0).toFixed(2)}`} />
                  </div>
                </div>

                <IngredientsSection detail={recipeDetail} canEdit={canEdit} isMobile={isMobile} onChanged={refresh} />

                {recipeDetail.labor_time_hrs && (
                  <div style={{ marginBottom: 24 }}>
                    <h4 style={sectionHead}>Labor</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)', gap: 12 }}>
                      <InfoBox label="Time" value={`${recipeDetail.labor_time_hrs} hrs`} />
                      <InfoBox label="Quantity" value={recipeDetail.labor_quantity?.toString() || '—'} />
                      <InfoBox label="Cook Rate" value={recipeDetail.labor_cook_rate ? `$${recipeDetail.labor_cook_rate}/hr` : '—'} />
                      <InfoBox label="Cost/Unit" value={`$${(recipeDetail.labor_cost_per_unit || 0).toFixed(2)}`} />
                    </div>
                  </div>
                )}

                <div style={{ padding: '16px 20px', background: 'rgba(0,0,0,0.03)', borderRadius: 10, marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Total COG per {recipeDetail.yield_unit}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#1a1a1a' }}>${(recipeDetail.cog_per_unit || 0).toFixed(3)}</div>
                </div>

                <div style={{ marginBottom: 24 }}>
                  <h4 style={sectionHead}>Margin Calculator</h4>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexDirection: isMobile ? 'column' : 'row' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', display: 'block', marginBottom: 6 }}>Menu Price</label>
                      <NumInput value={menuPrice} onChange={setMenuPrice} step={0.25} placeholder="5.00" />
                    </div>
                    {margin && (
                      <div style={{ flex: 2, padding: '14px 18px', background: margin.marginPercent > 70 ? 'rgba(34,197,94,0.1)' : margin.marginPercent > 60 ? 'rgba(234,179,8,0.1)' : 'rgba(239,68,68,0.1)', borderRadius: 10 }}>
                        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 2 }}>
                          ${margin.price.toFixed(2)} - ${margin.cog.toFixed(3)} = ${(margin.price - margin.cog).toFixed(3)}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: margin.marginPercent > 70 ? '#16a34a' : margin.marginPercent > 60 ? '#ca8a04' : '#dc2626' }}>
                          {margin.marginPercent.toFixed(1)}% margin
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ marginBottom: canEdit ? 24 : 0 }}>
                  <h4 style={sectionHead}>Batch Scaler</h4>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexDirection: isMobile ? 'column' : 'row' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', display: 'block', marginBottom: 6 }}>Multiplier</label>
                      <NumInput value={batchMultiplier} onChange={setBatchMultiplier} step={0.5} min={0.1} placeholder="1" />
                    </div>
                    <div style={{ flex: 2, padding: '14px 18px', background: 'rgba(0,0,0,0.03)', borderRadius: 10 }}>
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 2 }}>Scaled Yield</div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>
                        {(recipeDetail.total_yield * parseFloat(batchMultiplier || '1')).toFixed(1)} {recipeDetail.yield_unit}
                      </div>
                    </div>
                  </div>
                </div>

                {canEdit && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingRecipe(true)}>Edit recipe</button>
                    <button className="btn btn-danger btn-sm" onClick={() => deleteRecipe(recipeDetail)}>Delete recipe</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {creating && (
        <RecipeModal isMobile={isMobile} onClose={() => setCreating(false)}
          onSaved={(id) => { setCreating(false); loadRecipes(); setExpandedRecipe(id); }} />
      )}
      {editingRecipe && recipeDetail && (
        <RecipeModal isMobile={isMobile} recipe={recipeDetail} onClose={() => setEditingRecipe(false)}
          onSaved={() => { setEditingRecipe(false); refresh(); }} />
      )}
    </div>
  );
}

// Ingredient table + row editor. Cost per recipe unit = ep_price × quantity_used,
// so quantity_used gets its own column. AP/EP are derived here (the server stores
// what it's sent): ap = pack cost / (pack size × conversion), ep = ap / (yield/100);
// AP can also be typed directly for items bought by the unit (no pack info).
function IngredientsSection({ detail, canEdit, isMobile, onChanged }: {
  detail: RecipeDetail; canEdit: boolean; isMobile: boolean; onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const remove = async (ing: Ingredient) => {
    if (!confirm(`Remove "${ing.name}" from this recipe?`)) return;
    try { await api.delete(`/api/cog/ingredients/${ing.id}`); onChanged(); }
    catch (e: any) { alert(`Delete failed: ${e.message}`); }
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <h4 style={sectionHead}>Ingredients</h4>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <th style={th('left')}>Name</th>
              <th style={th('right')}>Pack Cost</th>
              <th style={th('right')}>Pack Size</th>
              <th style={th('right')}>AP Price</th>
              <th style={th('right')}>Yield %</th>
              <th style={th('right')}>EP Price</th>
              <th style={th('right')}>Qty Used</th>
              <th style={th('right')}>Line Cost</th>
              {canEdit && <th style={th('right')}></th>}
            </tr>
          </thead>
          <tbody>
            {detail.ingredients.length === 0 && (
              <tr><td colSpan={canEdit ? 9 : 8} style={{ padding: 20, textAlign: 'center', color: 'rgba(0,0,0,0.3)' }}>No ingredients yet</td></tr>
            )}
            {detail.ingredients.map(ing => (
              <tr key={ing.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '10px 12px', fontWeight: 500 }}>{ing.name}</td>
                <td style={td('right')}>${(ing.ap_pack_cost || 0).toFixed(2)}</td>
                <td style={td('right')}>{ing.pack_size || 0} {ing.pack_unit || ''}</td>
                <td style={td('right')}>${(ing.ap_price || 0).toFixed(3)}/{ing.ap_price_unit || ''}</td>
                <td style={td('right')}>{ing.yield_percent || 0}%</td>
                <td style={{ ...td('right'), fontWeight: 600 }}>${(ing.ep_price || 0).toFixed(3)}/{ing.ep_price_unit || ''}</td>
                <td style={td('right')}>{ing.quantity_used ?? '—'} {ing.quantity_used != null ? (ing.ep_price_unit || '') : ''}</td>
                <td style={{ ...td('right'), fontWeight: 600, color: '#1a1a1a' }}>${((ing.ep_price || 0) * (ing.quantity_used || 0)).toFixed(3)}</td>
                {canEdit && (
                  <td style={{ ...td('right'), whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setEditingId(ing.id); setAdding(false); }} style={{ marginRight: 6 }}>✎</button>
                    <button className="btn btn-danger btn-sm" onClick={() => remove(ing)}>✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && editingId != null && (() => {
        const ing = detail.ingredients.find(i => i.id === editingId);
        return ing ? (
          <IngredientForm key={ing.id} ingredient={ing} recipeId={detail.id} isMobile={isMobile}
            onClose={() => setEditingId(null)} onSaved={() => { setEditingId(null); onChanged(); }} />
        ) : null;
      })()}

      {canEdit && !adding && editingId == null && (
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)} style={{ marginTop: 10 }}>+ Add ingredient</button>
      )}
      {canEdit && adding && (
        <IngredientForm recipeId={detail.id} isMobile={isMobile}
          onClose={() => setAdding(false)} onSaved={() => { setAdding(false); onChanged(); }} />
      )}
    </div>
  );
}

function IngredientForm({ ingredient, recipeId, isMobile, onClose, onSaved }: {
  ingredient?: Ingredient; recipeId: number; isMobile: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(ingredient?.name ?? '');
  const [packCost, setPackCost] = useState(ingredient?.ap_pack_cost?.toString() ?? '');
  const [packSize, setPackSize] = useState(ingredient?.pack_size?.toString() ?? '');
  const [packUnit, setPackUnit] = useState(ingredient?.pack_unit ?? '');
  const [conversion, setConversion] = useState(ingredient?.unit_conversion?.toString() ?? '1');
  const [priceUnit, setPriceUnit] = useState(ingredient?.ap_price_unit ?? '');
  const [apPrice, setApPrice] = useState(ingredient?.ap_price?.toString() ?? '');
  const [apTouched, setApTouched] = useState(false);
  const [yieldPct, setYieldPct] = useState(ingredient?.yield_percent?.toString() ?? '100');
  const [qtyUsed, setQtyUsed] = useState(ingredient?.quantity_used?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  const computedAp = useMemo(() => {
    const cost = parseFloat(packCost), size = parseFloat(packSize), conv = parseFloat(conversion);
    if (!(cost >= 0) || !(size > 0) || !(conv > 0)) return null;
    return cost / (size * conv);
  }, [packCost, packSize, conversion]);

  // Auto-fill AP from the pack math unless the user typed AP directly.
  useEffect(() => {
    if (!apTouched && computedAp != null) setApPrice(String(computedAp));
  }, [computedAp, apTouched]);

  const ap = apPrice === '' ? null : parseFloat(apPrice);
  const yieldNum = parseFloat(yieldPct);
  const ep = ap != null && yieldNum > 0 ? ap / (yieldNum / 100) : ap;
  const qty = qtyUsed === '' ? null : parseFloat(qtyUsed);
  const lineCost = ep != null && qty != null ? ep * qty : null;

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const body = {
      name: name.trim(),
      ap_pack_cost: packCost === '' ? null : parseFloat(packCost),
      pack_size: packSize === '' ? null : parseFloat(packSize),
      pack_unit: packUnit || null,
      unit_conversion: conversion === '' ? null : parseFloat(conversion),
      ap_price: ap,
      ap_price_unit: priceUnit || null,
      yield_percent: Number.isFinite(yieldNum) ? yieldNum : 100,
      ep_price: ep,
      ep_price_unit: priceUnit || null,
      quantity_used: qty,
    };
    try {
      if (ingredient) await api.put(`/api/cog/ingredients/${ingredient.id}`, body);
      else await api.post(`/api/cog/recipes/${recipeId}/ingredients`, body);
      onSaved();
    } catch (e: any) { alert(`Save failed: ${e.message}`); setSaving(false); }
  };

  return (
    <div style={{ padding: '14px 16px', background: 'rgba(0,0,0,0.03)', borderRadius: 10, marginTop: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
        <div style={{ gridColumn: isMobile ? '1 / -1' : 'auto' }}>
          <label style={labelStyle}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus={!ingredient} placeholder="vanilla syrup" />
        </div>
        <div>
          <label style={labelStyle}>Pack cost $</label>
          <NumInput value={packCost} onChange={setPackCost} step={1} placeholder="39.98" />
        </div>
        <div>
          <label style={labelStyle}>Pack size</label>
          <NumInput value={packSize} onChange={setPackSize} step={1} placeholder="50" />
        </div>
        <div>
          <label style={labelStyle}>Pack unit</label>
          <input value={packUnit} onChange={(e) => setPackUnit(e.target.value)} style={inputStyle} placeholder="lbs" />
        </div>
        <div>
          <label style={labelStyle}>Units per pack unit</label>
          <NumInput value={conversion} onChange={setConversion} step={1} placeholder="454" />
        </div>
        <div>
          <label style={labelStyle}>Usage unit</label>
          <input value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} style={inputStyle} placeholder="g" />
        </div>
        <div>
          <label style={labelStyle}>AP price / unit</label>
          <NumInput value={apPrice} onChange={(v) => { setApTouched(true); setApPrice(v); }} step={0.01} />
        </div>
        <div>
          <label style={labelStyle}>Yield %</label>
          <NumInput value={yieldPct} onChange={setYieldPct} step={5} />
        </div>
        <div>
          <label style={labelStyle}>Qty used</label>
          <NumInput value={qtyUsed} onChange={setQtyUsed} step={0.25} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
          EP {ep != null ? `$${ep.toFixed(4)}/${priceUnit || 'unit'}` : '—'}
          {lineCost != null && <> · line cost <strong>${lineCost.toFixed(4)}</strong></>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={!name.trim() || saving}>{saving ? '...' : (ingredient ? 'Save' : 'Add')}</button>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// Create/edit recipe metadata. Labor cost per unit auto-computes from
// time × rate ÷ quantity unless typed directly (same pattern as AP price).
function RecipeModal({ recipe, isMobile, onClose, onSaved }: {
  recipe?: RecipeDetail; isMobile: boolean; onClose: () => void; onSaved: (id: number) => void;
}) {
  const [name, setName] = useState(recipe?.name ?? '');
  const [season, setSeason] = useState(recipe?.season ?? '');
  const [category, setCategory] = useState(recipe?.category ?? '');
  const [totalYield, setTotalYield] = useState(recipe?.total_yield?.toString() ?? '');
  const [yieldUnit, setYieldUnit] = useState(recipe?.yield_unit ?? '');
  const [laborTime, setLaborTime] = useState(recipe?.labor_time_hrs?.toString() ?? '');
  const [laborQty, setLaborQty] = useState(recipe?.labor_quantity?.toString() ?? '');
  const [laborRate, setLaborRate] = useState(recipe?.labor_cook_rate?.toString() ?? '');
  const [laborCost, setLaborCost] = useState(recipe?.labor_cost_per_unit?.toString() ?? '');
  const [laborTouched, setLaborTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const computedLabor = useMemo(() => {
    const t = parseFloat(laborTime), q = parseFloat(laborQty), r = parseFloat(laborRate);
    if (!(t > 0) || !(q > 0) || !(r > 0)) return null;
    return (t * r) / q;
  }, [laborTime, laborQty, laborRate]);

  useEffect(() => {
    if (!laborTouched && computedLabor != null) setLaborCost(String(computedLabor));
  }, [computedLabor, laborTouched]);

  const save = async () => {
    if (!name.trim() || totalYield === '' || !yieldUnit.trim()) return;
    setSaving(true);
    const body = {
      name: name.trim(),
      season: season.trim() || null,
      category: category.trim() || null,
      total_yield: parseFloat(totalYield),
      yield_unit: yieldUnit.trim(),
      labor_time_hrs: laborTime === '' ? null : parseFloat(laborTime),
      labor_quantity: laborQty === '' ? null : parseFloat(laborQty),
      labor_cook_rate: laborRate === '' ? null : parseFloat(laborRate),
      labor_cost_per_unit: laborCost === '' ? null : parseFloat(laborCost),
    };
    try {
      const r = recipe
        ? await api.put(`/api/cog/recipes/${recipe.id}`, body)
        : await api.post('/api/cog/recipes', body);
      onSaved(r.id);
    } catch (e: any) { alert(`Save failed: ${e.message}`); setSaving(false); }
  };

  return (
    <Modal title={recipe ? 'Edit recipe' : 'New batch recipe'} onClose={onClose} width={640}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus={!recipe} placeholder="Vanilla Syrup" />
        </div>
        <div>
          <label style={labelStyle}>Season</label>
          <input value={season} onChange={(e) => setSeason(e.target.value)} style={inputStyle} placeholder="SPRING 2026" />
        </div>
        <div>
          <label style={labelStyle}>Category</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} placeholder="Syrup" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Total yield</label>
          <NumInput value={totalYield} onChange={setTotalYield} step={1} placeholder="1000" />
        </div>
        <div>
          <label style={labelStyle}>Yield unit</label>
          <input value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} style={inputStyle} placeholder="ml" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12, marginBottom: 6 }}>
        <div>
          <label style={labelStyle}>Labor time (hrs)</label>
          <NumInput value={laborTime} onChange={setLaborTime} step={0.25} />
        </div>
        <div>
          <label style={labelStyle}>Batches made</label>
          <NumInput value={laborQty} onChange={setLaborQty} step={1} />
        </div>
        <div>
          <label style={labelStyle}>Cook rate $/hr</label>
          <NumInput value={laborRate} onChange={setLaborRate} step={0.5} />
        </div>
        <div>
          <label style={labelStyle}>Labor $/unit</label>
          <NumInput value={laborCost} onChange={(v) => { setLaborTouched(true); setLaborCost(v); }} step={0.25} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 16 }}>
        Labor is optional. Cost per unit fills itself from time × rate ÷ batches; type it directly to override.
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!name.trim() || totalYield === '' || !yieldUnit.trim() || saving}>
          {saving ? 'Saving...' : (recipe ? 'Save' : 'Create')}
        </button>
      </div>
    </Modal>
  );
}

function filterBtn(active: boolean): React.CSSProperties {
  return {
    padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none',
    background: active ? '#1a1a1a' : 'rgba(0,0,0,0.06)', color: active ? '#fff' : 'rgba(0,0,0,0.5)',
    cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'inherit',
  };
}
const sectionHead: React.CSSProperties = { fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(0,0,0,0.4)', marginBottom: 12 };
const th = (align: 'left' | 'right'): React.CSSProperties => ({ textAlign: align, padding: '8px 12px', fontWeight: 600, color: 'rgba(0,0,0,0.4)' });
const td = (align: 'left' | 'right'): React.CSSProperties => ({ padding: '10px 12px', textAlign: align, color: 'rgba(0,0,0,0.5)' });
