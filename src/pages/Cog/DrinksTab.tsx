import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../../lib/api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useCanEdit, inputStyle, labelStyle, money, SummaryCard, Modal } from './ui';

interface DrinkRow {
  id: number;
  name: string;
  category: string | null;
  season: string | null;
  target_cogs_pct: number | null;
  notes: string | null;
  dripos_product_id: number | null;
  component_count: number;
  drink_cog: number;
  effective_target_cogs_pct: number;
  recommended_price: number | null;
}

interface Component {
  id: number;
  component_type: 'ingredient' | 'recipe';
  ingredient_id: number | null;
  recipe_id: number | null;
  quantity: number | null;
  unit: string | null;
  yield_percent: number | null;
  component_name: string;
  source_unit: string | null;
  unit_cost: number;
  line_cost: number;
  unit_mismatch: boolean;
  missing_source: boolean;
}

interface DrinkDetail extends DrinkRow {
  components: Component[];
}

interface PickIngredient { id: number; name: string; pack_unit: string | null }
interface PickRecipe { id: number; name: string; yield_unit: string; cog_per_unit: number }

export default function DrinksTab() {
  const isMobile = useIsMobile();
  const canEdit = useCanEdit();
  const [drinks, setDrinks] = useState<DrinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<DrinkDetail | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [ingredients, setIngredients] = useState<PickIngredient[]>([]);
  const [recipes, setRecipes] = useState<PickRecipe[]>([]);

  const loadDrinks = useCallback(async () => {
    try {
      setDrinks(await api.get('/api/cog/drinks'));
    } catch (e) {
      console.error('Failed to load drinks:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    try {
      setDetail(await api.get(`/api/cog/drinks/${id}`));
    } catch (e) {
      console.error('Failed to load drink detail:', e);
    }
  }, []);

  useEffect(() => {
    loadDrinks();
    api.get('/api/cog/ingredients/master').then(setIngredients).catch(() => {});
    api.get('/api/cog/recipes').then(setRecipes).catch(() => {});
  }, [loadDrinks]);

  useEffect(() => {
    if (expanded) loadDetail(expanded);
    else setDetail(null);
  }, [expanded, loadDetail]);

  // Reload both the expanded detail and the list row (COG changes ripple up).
  const refresh = async () => {
    if (expanded) await loadDetail(expanded);
    await loadDrinks();
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.post('/api/cog/drinks/sync-dripos', {});
      alert(`Synced from Dripos: ${r.inserted} new, ${r.updated} updated (${r.total} drinks).`);
      loadDrinks();
    } catch (e: any) {
      alert(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const removeDrink = async (d: DrinkRow) => {
    if (!confirm(`Delete "${d.name}" and its recipe? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/cog/drinks/${d.id}`);
      if (expanded === d.id) setExpanded(null);
      loadDrinks();
    } catch (e: any) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  const filtered = useMemo(
    () => drinks.filter((d) => !search ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      (d.category || '').toLowerCase().includes(search.toLowerCase())),
    [drinks, search],
  );

  const stats = useMemo(() => {
    const costed = filtered.filter((d) => d.component_count > 0);
    const avgCog = costed.length ? costed.reduce((s, d) => s + d.drink_cog, 0) / costed.length : 0;
    return { total: filtered.length, costed: costed.length, avgCog };
  }, [filtered]);

  if (loading) return <div style={{ color: 'rgba(0,0,0,0.3)', padding: 40 }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
        <SummaryCard label="Drinks" value={String(stats.total)} sub={`${stats.costed} with a recipe`} />
        <SummaryCard label="Avg COG (costed)" value={money(stats.avgCog)} />
        <SummaryCard label="Not yet costed" value={String(stats.total - stats.costed)} sub="add components to cost them" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input placeholder="Search drinks..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 280 }} />
        {canEdit && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={sync} disabled={syncing}>{syncing ? 'Syncing...' : '⟳ Sync from Dripos'}</button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Add drink</button>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {filtered.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 60, color: 'rgba(0,0,0,0.3)' }}>
            No drinks yet. {canEdit ? 'Sync from Dripos or add one manually.' : ''}
          </div>
        )}
        {filtered.map((d) => (
          <div key={d.id}>
            <div
              className="card"
              onClick={() => setExpanded(expanded === d.id ? null : d.id)}
              style={{ cursor: 'pointer', background: expanded === d.id ? 'rgba(255,255,255,0.97)' : 'rgba(255,255,255,0.8)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>{d.name}</h3>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                    {d.category && <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>{d.category}</span>}
                    {d.dripos_product_id && <span className="badge badge-blue">Dripos</span>}
                    <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.3)' }}>• {d.component_count} components</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
                  <Metric label="COG" value={d.component_count ? money(d.drink_cog, 3) : '—'} />
                  <Metric label={`Rec. @ ${d.effective_target_cogs_pct}%`} value={d.recommended_price != null && d.component_count ? money(d.recommended_price) : '—'} accent />
                </div>
              </div>
            </div>

            {expanded === d.id && detail && (
              <DrinkEditor
                detail={detail}
                isMobile={isMobile}
                canEdit={canEdit}
                ingredients={ingredients}
                recipes={recipes}
                onChanged={refresh}
                onDelete={() => removeDrink(d)}
              />
            )}
          </div>
        ))}
      </div>

      {creating && (
        <DrinkModal isMobile={isMobile} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); loadDrinks(); setExpanded(id); }} />
      )}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent ? '#16a34a' : '#1a1a1a' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function DrinkEditor({ detail, isMobile, canEdit, ingredients, recipes, onChanged, onDelete }: {
  detail: DrinkDetail;
  isMobile: boolean;
  canEdit: boolean;
  ingredients: PickIngredient[];
  recipes: PickRecipe[];
  onChanged: () => void;
  onDelete: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [targetOverride, setTargetOverride] = useState(detail.target_cogs_pct?.toString() ?? '');

  const saveTarget = async () => {
    try {
      await api.put(`/api/cog/drinks/${detail.id}`, {
        name: detail.name, category: detail.category, season: detail.season,
        notes: detail.notes,
        target_cogs_pct: targetOverride === '' ? null : parseFloat(targetOverride),
      });
      onChanged();
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    }
  };

  const delComponent = async (cid: number) => {
    try { await api.delete(`/api/cog/components/${cid}`); onChanged(); }
    catch (e: any) { alert(`Delete failed: ${e.message}`); }
  };

  const setQty = async (c: Component, quantity: string) => {
    try {
      await api.put(`/api/cog/components/${c.id}`, { quantity: quantity === '' ? null : parseFloat(quantity), unit: c.unit, yield_percent: c.yield_percent });
      onChanged();
    } catch (e: any) { alert(`Update failed: ${e.message}`); }
  };

  return (
    <div className="card" style={{ marginTop: 8, background: 'rgba(255,255,255,0.97)' }}>
      <h4 style={sectionHead}>Recipe</h4>
      <div style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 560 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <th style={th('left')}>Component</th>
              <th style={th('left')}>Type</th>
              <th style={th('right')}>Qty</th>
              <th style={th('right')}>Unit cost</th>
              <th style={th('right')}>Line cost</th>
              {canEdit && <th style={th('right')}></th>}
            </tr>
          </thead>
          <tbody>
            {detail.components.length === 0 && (
              <tr><td colSpan={canEdit ? 6 : 5} style={{ padding: 24, textAlign: 'center', color: 'rgba(0,0,0,0.3)' }}>No components yet</td></tr>
            )}
            {detail.components.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                  {c.component_name}
                  {c.missing_source && <span className="badge badge-red" style={{ marginLeft: 6 }}>missing</span>}
                  {c.unit_mismatch && <span title={`Quantity is in "${c.unit}" but cost is per "${c.source_unit}"`} className="badge badge-gold" style={{ marginLeft: 6 }}>unit?</span>}
                </td>
                <td style={td('left')}>{c.component_type === 'recipe' ? 'Batch recipe' : 'Ingredient'}</td>
                <td style={td('right')}>
                  {canEdit ? (
                    <input
                      type="number" step="any" defaultValue={c.quantity ?? ''}
                      onBlur={(e) => { if (e.target.value !== String(c.quantity ?? '')) setQty(c, e.target.value); }}
                      style={{ ...inputStyle, width: 80, padding: '5px 8px', textAlign: 'right' }}
                    />
                  ) : (c.quantity ?? '—')}
                  <span style={{ color: 'rgba(0,0,0,0.4)', marginLeft: 4 }}>{c.unit || c.source_unit || ''}</span>
                </td>
                <td style={td('right')}>{money(c.unit_cost, 4)}{c.source_unit ? `/${c.source_unit}` : ''}</td>
                <td style={{ ...td('right'), fontWeight: 600, color: '#1a1a1a' }}>{money(c.line_cost, 3)}</td>
                {canEdit && <td style={td('right')}><button className="btn btn-danger btn-sm" onClick={() => delComponent(c.id)}>✕</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && !adding && <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)} style={{ marginBottom: 16 }}>+ Add component</button>}
      {canEdit && adding && (
        <AddComponentRow
          drinkId={detail.id} isMobile={isMobile} ingredients={ingredients} recipes={recipes}
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); onChanged(); }}
        />
      )}

      {/* Totals */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12, marginTop: 8 }}>
        <div style={totalBox}>
          <div style={totalLabel}>Total COG</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{money(detail.drink_cog, 3)}</div>
        </div>
        <div style={totalBox}>
          <div style={totalLabel}>Target COG %</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="number" step="0.5" value={targetOverride} disabled={!canEdit}
              onChange={(e) => setTargetOverride(e.target.value)} onBlur={saveTarget}
              placeholder={String(detail.effective_target_cogs_pct)}
              style={{ ...inputStyle, width: 90, fontSize: 18, fontWeight: 700 }}
            />
            <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>{targetOverride === '' ? '(default)' : ''}</span>
          </div>
        </div>
        <div style={{ ...totalBox, background: 'rgba(34,197,94,0.1)' }}>
          <div style={totalLabel}>Recommended price</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#16a34a' }}>{detail.recommended_price != null ? money(detail.recommended_price) : '—'}</div>
        </div>
      </div>

      {canEdit && (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete drink</button>
        </div>
      )}
    </div>
  );
}

function AddComponentRow({ drinkId, isMobile, ingredients, recipes, onClose, onAdded }: {
  drinkId: number;
  isMobile: boolean;
  ingredients: PickIngredient[];
  recipes: PickRecipe[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [type, setType] = useState<'ingredient' | 'recipe'>('ingredient');
  const [refId, setRefId] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [saving, setSaving] = useState(false);

  // Default the unit to the picked source's natural unit.
  const onPick = (id: string) => {
    setRefId(id);
    if (type === 'ingredient') setUnit(ingredients.find((i) => i.id === Number(id))?.pack_unit ?? '');
    else setUnit(recipes.find((r) => r.id === Number(id))?.yield_unit ?? '');
  };
  const onType = (t: 'ingredient' | 'recipe') => { setType(t); setRefId(''); setUnit(''); };

  const add = async () => {
    if (!refId) return;
    setSaving(true);
    try {
      await api.post(`/api/cog/drinks/${drinkId}/components`, {
        component_type: type,
        ingredient_id: type === 'ingredient' ? Number(refId) : null,
        recipe_id: type === 'recipe' ? Number(refId) : null,
        quantity: qty === '' ? null : parseFloat(qty),
        unit: unit || null,
      });
      onAdded();
    } catch (e: any) {
      alert(`Add failed: ${e.message}`);
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', padding: '12px 14px', background: 'rgba(0,0,0,0.03)', borderRadius: 10, marginBottom: 16 }}>
      <div style={{ minWidth: 120 }}>
        <label style={labelStyle}>Type</label>
        <select value={type} onChange={(e) => onType(e.target.value as any)} style={inputStyle}>
          <option value="ingredient">Ingredient</option>
          <option value="recipe">Batch recipe</option>
        </select>
      </div>
      <div style={{ flex: 1, minWidth: isMobile ? 140 : 200 }}>
        <label style={labelStyle}>{type === 'ingredient' ? 'Ingredient' : 'Recipe'}</label>
        <select value={refId} onChange={(e) => onPick(e.target.value)} style={inputStyle}>
          <option value="">Select...</option>
          {type === 'ingredient'
            ? ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)
            : recipes.map((r) => <option key={r.id} value={r.id}>{r.name} ({money(r.cog_per_unit, 3)}/{r.yield_unit})</option>)}
        </select>
      </div>
      <div style={{ width: 90 }}>
        <label style={labelStyle}>Qty</label>
        <input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ width: 80 }}>
        <label style={labelStyle}>Unit</label>
        <input value={unit} onChange={(e) => setUnit(e.target.value)} style={inputStyle} />
      </div>
      <button className="btn btn-primary btn-sm" onClick={add} disabled={!refId || saving}>{saving ? '...' : 'Add'}</button>
      <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
    </div>
  );
}

function DrinkModal({ isMobile, onClose, onSaved }: { isMobile: boolean; onClose: () => void; onSaved: (id: number) => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [season, setSeason] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const d = await api.post('/api/cog/drinks', { name: name.trim(), category: category.trim() || null, season: season.trim() || null });
      onSaved(d.id);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
      setSaving(false);
    }
  };

  return (
    <Modal title="Add drink" onClose={onClose}>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus placeholder="Vanilla Latte" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 18 }}>
        <div>
          <label style={labelStyle}>Category</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} placeholder="Espresso" />
        </div>
        <div>
          <label style={labelStyle}>Season</label>
          <input value={season} onChange={(e) => setSeason(e.target.value)} style={inputStyle} placeholder="optional" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!name.trim() || saving}>{saving ? 'Saving...' : 'Create'}</button>
      </div>
    </Modal>
  );
}

const sectionHead: React.CSSProperties = { fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(0,0,0,0.4)', marginBottom: 12 };
const totalBox: React.CSSProperties = { padding: '14px 18px', background: 'rgba(0,0,0,0.03)', borderRadius: 10 };
const totalLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 };
const th = (align: 'left' | 'right'): React.CSSProperties => ({ textAlign: align, padding: '8px 12px', fontWeight: 600, color: 'rgba(0,0,0,0.4)', whiteSpace: 'nowrap' });
const td = (align: 'left' | 'right'): React.CSSProperties => ({ padding: '8px 12px', textAlign: align, color: 'rgba(0,0,0,0.6)' });
