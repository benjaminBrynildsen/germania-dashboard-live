import { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { useIsMobile } from '../hooks/useIsMobile';

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

export default function CogManager() {
  const isMobile = useIsMobile();
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

  useEffect(() => {
    loadRecipes();
  }, []);

  useEffect(() => {
    if (expandedRecipe) {
      loadRecipeDetail(expandedRecipe);
    }
  }, [expandedRecipe]);

  const loadRecipes = async () => {
    try {
      const data = await api.get('/api/cog/recipes');
      setRecipes(data);
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

  const handleSeedData = async () => {
    if (!confirm('This will reset all COG data and import from the JSON file. Continue?')) {
      return;
    }
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
    const highest = sorted[0];
    const lowest = sorted[sorted.length - 1];

    return { totalRecipes, avgCog, highest, lowest };
  }, [filteredRecipes]);

  const margin = useMemo(() => {
    if (!recipeDetail || !menuPrice || parseFloat(menuPrice) <= 0) return null;
    const price = parseFloat(menuPrice);
    const cog = recipeDetail.cog_per_unit;
    const marginPercent = ((price - cog) / price) * 100;
    return { price, cog, marginPercent };
  }, [recipeDetail, menuPrice]);

  if (loading) {
    return <div style={{ color: 'rgba(0,0,0,0.3)', padding: 40 }}>Loading...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>COG Manager</h1>
          <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
            Cost of Goods calculator and ingredient price manager
          </p>
        </div>
        <button
          onClick={handleSeedData}
          disabled={seeding}
          className="btn btn-secondary"
        >
          {seeding ? 'Seeding...' : 'Seed from JSON'}
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        <SummaryCard label="Total Recipes" value={stats.totalRecipes.toString()} />
        <SummaryCard label="Avg COG/Unit" value={`$${stats.avgCog.toFixed(2)}`} />
        <SummaryCard label="Highest COG" value={stats.highest ? `$${stats.highest.cog_per_unit.toFixed(2)}` : '—'} sub={stats.highest?.name} />
        <SummaryCard label="Lowest COG" value={stats.lowest ? `$${stats.lowest.cog_per_unit.toFixed(2)}` : '—'} sub={stats.lowest?.name} />
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12, marginBottom: 16 }}>
          {/* Season Filter */}
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Season</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {seasons.map(s => (
                <button
                  key={s}
                  onClick={() => setSelectedSeason(s)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    border: 'none',
                    background: selectedSeason === s ? '#1a1a1a' : 'rgba(0,0,0,0.06)',
                    color: selectedSeason === s ? '#fff' : 'rgba(0,0,0,0.5)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    fontFamily: 'inherit',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Category Filter */}
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Category</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {categories.map(c => (
                <button
                  key={c}
                  onClick={() => setSelectedCategory(c)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    border: 'none',
                    background: selectedCategory === c ? '#1a1a1a' : 'rgba(0,0,0,0.06)',
                    color: selectedCategory === c ? '#fff' : 'rgba(0,0,0,0.5)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    fontFamily: 'inherit',
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search recipes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid rgba(0,0,0,0.1)',
            fontSize: 14,
            fontFamily: 'inherit',
            background: 'rgba(255,255,255,0.5)',
          }}
        />
      </div>

      {/* Recipe List */}
      <div style={{ display: 'grid', gap: 12 }}>
        {filteredRecipes.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 60, color: 'rgba(0,0,0,0.3)' }}>
            No recipes found
          </div>
        )}
        
        {filteredRecipes.map(recipe => (
          <div key={recipe.id}>
            <div
              className="card"
              onClick={() => setExpandedRecipe(expandedRecipe === recipe.id ? null : recipe.id)}
              style={{
                cursor: 'pointer',
                transition: 'all 0.2s',
                background: expandedRecipe === recipe.id ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.8)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 10 : 0 }}>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.2, marginBottom: 4 }}>{recipe.name}</h3>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {recipe.season && (
                      <span className={`badge ${STATUS_COLORS[recipe.season] || 'badge-blue'}`}>
                        {recipe.season}
                      </span>
                    )}
                    {recipe.category && (
                      <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
                        {recipe.category}
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.3)' }}>
                      • {recipe.ingredient_count} ingredients
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: isMobile ? 'left' : 'right' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a' }}>
                    ${(recipe.cog_per_unit || 0).toFixed(3)}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginTop: 2 }}>
                    per {recipe.yield_unit}
                  </div>
                </div>
              </div>
            </div>

            {/* Expanded Detail */}
            {expandedRecipe === recipe.id && recipeDetail && (
              <div className="card" style={{ marginTop: 8, background: 'rgba(255,255,255,0.95)' }}>
                {/* Recipe Info */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
                    <InfoBox label="Total Yield" value={`${recipeDetail.total_yield} ${recipeDetail.yield_unit}`} />
                    <InfoBox label="Ingredient Cost" value={`$${(recipeDetail.total_ingredient_cost || 0).toFixed(2)}`} />
                    <InfoBox label="Labor Cost" value={`$${(recipeDetail.labor_cost_per_unit || 0).toFixed(2)}`} />
                  </div>
                </div>

                {/* Ingredients Table */}
                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>Ingredients</h4>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                          <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: 'rgba(0,0,0,0.4)' }}>Name</th>
                          <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: 'rgba(0,0,0,0.4)' }}>Pack Cost</th>
                          <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: 'rgba(0,0,0,0.4)' }}>Pack Size</th>
                          <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: 'rgba(0,0,0,0.4)' }}>AP Price</th>
                          <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: 'rgba(0,0,0,0.4)' }}>Yield %</th>
                          <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: 'rgba(0,0,0,0.4)' }}>EP Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipeDetail.ingredients.map(ing => (
                          <tr key={ing.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 500 }}>{ing.name}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', color: 'rgba(0,0,0,0.5)' }}>
                              ${(ing.ap_pack_cost || 0).toFixed(2)}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', color: 'rgba(0,0,0,0.5)' }}>
                              {ing.pack_size || 0} {ing.pack_unit || ''}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', color: 'rgba(0,0,0,0.5)' }}>
                              ${(ing.ap_price || 0).toFixed(3)}/{ing.ap_price_unit || ''}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', color: 'rgba(0,0,0,0.5)' }}>
                              {ing.yield_percent || 0}%
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>
                              ${(ing.ep_price || 0).toFixed(3)}/{ing.ep_price_unit || ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Labor */}
                {recipeDetail.labor_time_hrs && (
                  <div style={{ marginBottom: 24 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>Labor</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)', gap: 12 }}>
                      <InfoBox label="Time" value={`${recipeDetail.labor_time_hrs} hrs`} />
                      <InfoBox label="Quantity" value={recipeDetail.labor_quantity?.toString() || '—'} />
                      <InfoBox label="Cook Rate" value={recipeDetail.labor_cook_rate ? `$${recipeDetail.labor_cook_rate}/hr` : '—'} />
                      <InfoBox label="Cost/Unit" value={`$${(recipeDetail.labor_cost_per_unit || 0).toFixed(2)}`} />
                    </div>
                  </div>
                )}

                {/* Total COG */}
                <div style={{ padding: '16px 20px', background: 'rgba(0,0,0,0.03)', borderRadius: 10, marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Total COG per {recipeDetail.yield_unit}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#1a1a1a' }}>${(recipeDetail.cog_per_unit || 0).toFixed(3)}</div>
                </div>

                {/* Margin Calculator */}
                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>Margin Calculator</h4>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexDirection: isMobile ? 'column' : 'row' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', display: 'block', marginBottom: 6 }}>Menu Price</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="5.00"
                        value={menuPrice}
                        onChange={(e) => setMenuPrice(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px 14px',
                          borderRadius: 8,
                          border: '1px solid rgba(0,0,0,0.1)',
                          fontSize: 16,
                          fontFamily: 'inherit',
                        }}
                      />
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

                {/* Batch Scaler */}
                <div>
                  <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>Batch Scaler</h4>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexDirection: isMobile ? 'column' : 'row' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', display: 'block', marginBottom: 6 }}>Multiplier</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.1"
                        placeholder="1"
                        value={batchMultiplier}
                        onChange={(e) => setBatchMultiplier(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px 14px',
                          borderRadius: 8,
                          border: '1px solid rgba(0,0,0,0.1)',
                          fontSize: 16,
                          fontFamily: 'inherit',
                        }}
                      />
                    </div>
                    <div style={{ flex: 2, padding: '14px 18px', background: 'rgba(0,0,0,0.03)', borderRadius: 10 }}>
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 2 }}>Scaled Yield</div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>
                        {(recipeDetail.total_yield * parseFloat(batchMultiplier || '1')).toFixed(1)} {recipeDetail.yield_unit}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#1a1a1a', letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>{value}</div>
    </div>
  );
}
