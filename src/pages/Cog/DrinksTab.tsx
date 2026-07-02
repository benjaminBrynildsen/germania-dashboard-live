import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../../lib/api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useCanEdit, inputStyle, labelStyle, money, SummaryCard, Modal } from './ui';

interface DrinkRow {
  id: number;
  name: string;
  category: string | null;
  target_cogs_pct: number | null;
  dripos_product_id: number | null;
  effective_target_cogs_pct: number;
  variant_count: number;
  min_cog: number | null;
  max_cog: number | null;
  min_recommended: number | null;
  max_recommended: number | null;
}

interface Component {
  id: number;
  variant_id: number;
  component_type: 'ingredient' | 'recipe';
  ingredient_id: number | null;
  recipe_id: number | null;
  quantity: number | null;
  unit: string | null;
  component_name: string;
  source_unit: string | null;
  unit_cost: number;
  line_cost: number;
  unit_mismatch: boolean;
  missing_source: boolean;
}

interface Variant {
  id: number;
  label: string;
  temp: string | null;
  size: string | null;
  menu_price: number | null;
  target_cogs_pct: number | null;
  components: Component[];
  variant_cog: number;
  effective_target_cogs_pct: number;
  recommended_price: number | null;
  current_margin_pct: number | null;
}

interface DrinkDetail extends DrinkRow {
  variants: Variant[];
}

interface PickIngredient { id: number; name: string; pack_unit: string | null }
interface PickRecipe { id: number; name: string; yield_unit: string; cog_per_unit: number }
interface DriposProduct { id: number; name: string; category: string | null }

const TEMP_OPTIONS = [
  { value: '', label: '—' },
  { value: 'hot', label: 'Hot' },
  { value: 'iced', label: 'Iced' },
  { value: 'frozen', label: 'Frozen' },
];
const SIZE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'S', label: 'Small' },
  { value: 'R', label: 'Regular' },
  { value: 'L', label: 'Large' },
  { value: 'K', label: "Kid's" },
];

function range(min: number | null, max: number | null, dp = 2): string {
  if (min == null || max == null) return '—';
  if (Math.abs(min - max) < 1e-9) return money(min, dp);
  return `${money(min, dp)}–${money(max, dp)}`;
}

export default function DrinksTab() {
  const isMobile = useIsMobile();
  const canEdit = useCanEdit();
  const [drinks, setDrinks] = useState<DrinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<DrinkDetail | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [ingredients, setIngredients] = useState<PickIngredient[]>([]);
  const [recipes, setRecipes] = useState<PickRecipe[]>([]);
  // Live Dripos product list for the "Link to Dripos" picker (empty when not connected).
  const [products, setProducts] = useState<DriposProduct[]>([]);
  // Live Dripos menu prices: variant_id -> price, plus per-drink min/max.
  const [driposPrices, setDriposPrices] = useState<Record<number, number>>({});
  const [driposDrinkPrices, setDriposDrinkPrices] = useState<Record<number, { min: number; max: number }>>({});

  const loadDrinks = useCallback(async () => {
    try { setDrinks(await api.get('/api/cog/drinks')); }
    catch (e) { console.error('Failed to load drinks:', e); }
    finally { setLoading(false); }
  }, []);

  const loadDriposPrices = useCallback(async () => {
    try {
      const r = await api.get('/api/cog/drinks/dripos-prices');
      if (r.available) { setDriposPrices(r.prices || {}); setDriposDrinkPrices(r.drink_prices || {}); }
    } catch (e) { /* non-fatal: column just stays blank */ }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    try { setDetail(await api.get(`/api/cog/drinks/${id}`)); }
    catch (e) { console.error('Failed to load drink detail:', e); }
  }, []);

  useEffect(() => {
    loadDrinks();
    loadDriposPrices();
    api.get('/api/cog/ingredients/master').then(setIngredients).catch(() => {});
    api.get('/api/cog/recipes').then(setRecipes).catch(() => {});
    api.get('/api/cog/dripos-products').then((r) => { if (r.available) setProducts(r.products || []); }).catch(() => {});
  }, [loadDrinks, loadDriposPrices]);

  useEffect(() => {
    if (expanded) loadDetail(expanded); else setDetail(null);
  }, [expanded, loadDetail]);

  const refresh = async () => {
    if (expanded) await loadDetail(expanded);
    await loadDrinks();
    await loadDriposPrices();
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.post('/api/cog/drinks/sync-dripos', {});
      alert(`Synced from Dripos: ${r.inserted} new, ${r.updated} updated (${r.total} drinks).`);
      loadDrinks();
      loadDriposPrices();
    } catch (e: any) { alert(`Sync failed: ${e.message}`); }
    finally { setSyncing(false); }
  };

  const importRecipes = async () => {
    if (!confirm('Import drink recipes from the Cost-of-Goods spreadsheet? Each drink is matched to the synced catalog by name and its variants are rebuilt from the sheet. Run the ingredient import first.')) return;
    setImporting(true);
    try {
      const r = await api.post('/api/cog/drinks/import-recipes', {});
      const warn = r.unresolved_ingredients?.length ? `\n\nUnmatched ingredients (skipped): ${r.unresolved_ingredients.join(', ')}` : '';
      alert(`Imported recipes: ${r.drinks_matched_to_existing} matched, ${r.drinks_created} created, ${r.variants} variants, ${r.components} lines.${warn}`);
      refresh();
    } catch (e: any) { alert(`Import failed: ${e.message}`); }
    finally { setImporting(false); }
  };

  const removeDrink = async (d: DrinkRow) => {
    if (!confirm(`Delete "${d.name}" and all its variants? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/cog/drinks/${d.id}`);
      if (expanded === d.id) setExpanded(null);
      loadDrinks();
    } catch (e: any) { alert(`Delete failed: ${e.message}`); }
  };

  // Dripos menu categories present in the catalog (null -> "Uncategorized").
  const categories = useMemo(() => {
    const unique = new Set(drinks.map((d) => d.category || 'Uncategorized'));
    return ['All', ...Array.from(unique).sort()];
  }, [drinks]);

  const filtered = useMemo(
    () => drinks.filter((d) => {
      if (category !== 'All' && (d.category || 'Uncategorized') !== category) return false;
      return !search ||
        d.name.toLowerCase().includes(search.toLowerCase()) ||
        (d.category || '').toLowerCase().includes(search.toLowerCase());
    }),
    [drinks, search, category],
  );

  // Group by category for display; the server already orders by category, name.
  const grouped = useMemo(() => {
    const groups: Array<{ category: string; drinks: DrinkRow[] }> = [];
    for (const d of filtered) {
      const cat = d.category || 'Uncategorized';
      const last = groups[groups.length - 1];
      if (last && last.category === cat) last.drinks.push(d);
      else groups.push({ category: cat, drinks: [d] });
    }
    return groups;
  }, [filtered]);

  const stats = useMemo(() => {
    const costed = filtered.filter((d) => d.min_cog != null);
    return { total: filtered.length, costed: costed.length };
  }, [filtered]);

  if (loading) return <div style={{ color: 'rgba(0,0,0,0.3)', padding: 40 }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
        <SummaryCard label="Drinks" value={String(stats.total)} />
        <SummaryCard label="With a recipe" value={String(stats.costed)} />
        <SummaryCard label="Not yet costed" value={String(stats.total - stats.costed)} sub="add components to cost them" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <input placeholder="Search drinks..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 260 }} />
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={sync} disabled={syncing}>{syncing ? 'Syncing...' : '⟳ Sync from Dripos'}</button>
            <button className="btn btn-secondary" onClick={importRecipes} disabled={importing}>{importing ? 'Importing...' : '↓ Import recipes'}</button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Add drink</button>
          </div>
        )}
      </div>

      {/* Dripos menu category filter */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {categories.map((c) => (
          <button key={c} onClick={() => setCategory(c)}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none',
              background: category === c ? '#1a1a1a' : 'rgba(0,0,0,0.06)', color: category === c ? '#fff' : 'rgba(0,0,0,0.5)',
              cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'inherit',
            }}>{c}</button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {filtered.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 60, color: 'rgba(0,0,0,0.3)' }}>
            No drinks yet. {canEdit ? 'Sync from Dripos or add one manually.' : ''}
          </div>
        )}
        {grouped.map((g) => (
          <div key={g.category}>
            <div
              onClick={() => setCategory(category === g.category ? 'All' : g.category)}
              title={category === g.category ? 'Show all categories' : `Show only ${g.category}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none',
                margin: '14px 2px 8px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.1em', color: 'rgba(0,0,0,0.45)',
              }}>
              {g.category}
              <span style={{ fontWeight: 600, color: 'rgba(0,0,0,0.3)', textTransform: 'none', letterSpacing: 0 }}>
                {g.drinks.length}
              </span>
              <span style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.08)' }} />
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {g.drinks.map((d) => (
                <div key={d.id}>
                  <div className="card" onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                    style={{ cursor: 'pointer', background: expanded === d.id ? 'rgba(255,255,255,0.97)' : 'rgba(255,255,255,0.8)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <h3 style={{ fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>{d.name}</h3>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                          {d.dripos_product_id != null
                            ? <span className="badge badge-blue">Dripos</span>
                            : <span className="badge badge-gold" title="Not linked to a Dripos product — no live price. Open the drink to link it.">not linked</span>}
                          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.3)' }}>• {d.variant_count} size{d.variant_count === 1 ? '' : 's'}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: isMobile ? 14 : 22, alignItems: 'center' }}>
                        <Metric label="COG" value={range(d.min_cog, d.max_cog, 3)} />
                        <Metric label={`Rec. @ ${d.effective_target_cogs_pct}%`} value={range(d.min_recommended, d.max_recommended)} accent />
                        {driposDrinkPrices[d.id] && (
                          <Metric label="Dripos" value={range(driposDrinkPrices[d.id].min, driposDrinkPrices[d.id].max)} color="#2563eb" />
                        )}
                      </div>
                    </div>
                  </div>

                  {expanded === d.id && detail && (
                    <DrinkEditor
                      detail={detail} isMobile={isMobile} canEdit={canEdit}
                      ingredients={ingredients} recipes={recipes} driposPrices={driposPrices} products={products}
                      onChanged={refresh} onDelete={() => removeDrink(d)}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {creating && (
        <DrinkModal isMobile={isMobile} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); loadDrinks(); setExpanded(id); }} />
      )}
    </div>
  );
}

function Metric({ label, value, accent, color }: { label: string; value: string; accent?: boolean; color?: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color ?? (accent ? '#16a34a' : '#1a1a1a') }}>{value}</div>
      <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function DrinkEditor({ detail, isMobile, canEdit, ingredients, recipes, driposPrices, products, onChanged, onDelete }: {
  detail: DrinkDetail; isMobile: boolean; canEdit: boolean;
  ingredients: PickIngredient[]; recipes: PickRecipe[]; driposPrices: Record<number, number>; products: DriposProduct[];
  onChanged: () => void; onDelete: () => void;
}) {
  const [targetOverride, setTargetOverride] = useState(detail.target_cogs_pct?.toString() ?? '');
  const [activeVariant, setActiveVariant] = useState<number | null>(detail.variants[0]?.id ?? null);
  const [addingVariant, setAddingVariant] = useState(false);

  const saveTarget = async () => {
    try {
      await api.put(`/api/cog/drinks/${detail.id}`, {
        name: detail.name, category: detail.category,
        target_cogs_pct: targetOverride === '' ? null : parseFloat(targetOverride),
      });
      onChanged();
    } catch (e: any) { alert(`Save failed: ${e.message}`); }
  };

  const current = detail.variants.find((v) => v.id === activeVariant) ?? detail.variants[0];

  const delVariant = async (vid: number) => {
    if (!confirm('Delete this size variant and its recipe?')) return;
    try { await api.delete(`/api/cog/variants/${vid}`); onChanged(); }
    catch (e: any) { alert(`Delete failed: ${e.message}`); }
  };

  return (
    <div className="card" style={{ marginTop: 8, background: 'rgba(255,255,255,0.97)' }}>
      <DriposLinkRow detail={detail} canEdit={canEdit} products={products} onChanged={onChanged} />

      {/* Variant selector */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        {detail.variants.map((v) => {
          const on = v.id === current?.id;
          return (
            <button key={v.id} onClick={() => setActiveVariant(v.id)}
              style={{
                padding: '6px 12px', borderRadius: 999,
                border: on ? '2px solid #1a1a1a' : '1px solid rgba(0,0,0,0.12)',
                background: on ? '#1a1a1a' : '#fff', color: on ? '#fff' : 'rgba(0,0,0,0.65)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {v.label}
              <span style={{ marginLeft: 6, opacity: on ? 0.85 : 0.5 }}>{v.components.length ? money(v.variant_cog, 2) : '—'}</span>
            </button>
          );
        })}
        {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => setAddingVariant(true)}>+ Size</button>}
      </div>

      {addingVariant && canEdit && (
        <AddVariantRow drinkId={detail.id} onClose={() => setAddingVariant(false)} onAdded={() => { setAddingVariant(false); onChanged(); }} />
      )}

      {current ? (
        <VariantBlock
          key={current.id} variant={current} isMobile={isMobile} canEdit={canEdit}
          ingredients={ingredients} recipes={recipes} driposPrice={driposPrices[current.id] ?? null}
          onChanged={onChanged} onDelete={() => delVariant(current.id)} canDeleteVariant={detail.variants.length > 1}
        />
      ) : (
        <div style={{ color: 'rgba(0,0,0,0.4)', padding: 16 }}>No sizes yet. {canEdit ? 'Add one above.' : ''}</div>
      )}

      {/* Drink-level target override + delete */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)' }}>Target COG % for this drink:</span>
          <input type="number" step="0.5" value={targetOverride} disabled={!canEdit}
            onChange={(e) => setTargetOverride(e.target.value)} onBlur={saveTarget}
            placeholder={String(detail.effective_target_cogs_pct)} style={{ ...inputStyle, width: 90 }} />
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>{targetOverride === '' ? '(global default)' : ''}</span>
        </div>
        {canEdit && <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete drink</button>}
      </div>
    </div>
  );
}

// Link/unlink a drink to its Dripos product. Linking adopts the product's real
// name + category and gives the drink live per-size prices; the picker is how
// spreadsheet-named drinks ("GBH", "7 Shot Richard") get reconciled to the menu.
function DriposLinkRow({ detail, canEdit, products, onChanged }: {
  detail: DrinkDetail; canEdit: boolean; products: DriposProduct[]; onChanged: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [pickId, setPickId] = useState('');
  const [saving, setSaving] = useState(false);

  const linked = detail.dripos_product_id != null;
  const linkedProduct = linked ? products.find((p) => p.id === detail.dripos_product_id) : null;

  const save = async (id: number | null) => {
    setSaving(true);
    try {
      const r = await api.post(`/api/cog/drinks/${detail.id}/link-dripos`, { dripos_product_id: id });
      if (r.absorbed) alert(`Linked. The empty duplicate row "${r.absorbed}" from the Dripos sync was merged into this drink.`);
      setPicking(false); setPickId('');
      onChanged();
    } catch (e: any) { alert(`Link failed: ${e.message}`); }
    finally { setSaving(false); }
  };

  // Group the picker options by Dripos category (the list arrives category-sorted).
  const byCategory = useMemo(() => {
    const groups: Array<{ category: string; items: DriposProduct[] }> = [];
    for (const p of products) {
      const cat = p.category || 'Uncategorized';
      const last = groups[groups.length - 1];
      if (last && last.category === cat) last.items.push(p);
      else groups.push({ category: cat, items: [p] });
    }
    return groups;
  }, [products]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', background: linked ? 'rgba(37,99,235,0.06)' : 'rgba(234,179,8,0.08)', borderRadius: 10, marginBottom: 16 }}>
      {linked ? (
        <>
          <span className="badge badge-blue">Dripos</span>
          <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)' }}>
            Linked to {linkedProduct ? `${linkedProduct.name} (${linkedProduct.category || 'Uncategorized'})` : `product #${detail.dripos_product_id}`} — live prices on
          </span>
          {canEdit && <button className="btn btn-secondary btn-sm" disabled={saving} onClick={() => { if (confirm('Unlink from Dripos? Live prices for this drink turn off.')) save(null); }}>Unlink</button>}
        </>
      ) : picking ? (
        <>
          <select value={pickId} onChange={(e) => setPickId(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 220, width: 'auto' }} autoFocus>
            <option value="">Select Dripos product...</option>
            {byCategory.map((g) => (
              <optgroup key={g.category} label={g.category}>
                {g.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" disabled={!pickId || saving} onClick={() => save(Number(pickId))}>{saving ? '...' : 'Link'}</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { setPicking(false); setPickId(''); }}>Cancel</button>
        </>
      ) : (
        <>
          <span className="badge badge-gold">not linked</span>
          <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)' }}>Not linked to a Dripos product, so no live menu price.</span>
          {canEdit && (products.length > 0
            ? <button className="btn btn-secondary btn-sm" onClick={() => setPicking(true)}>Link to Dripos</button>
            : <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>(connect Dripos via the Weekly Sales tab to link)</span>)}
        </>
      )}
    </div>
  );
}

function VariantBlock({ variant, isMobile, canEdit, ingredients, recipes, driposPrice, onChanged, onDelete, canDeleteVariant }: {
  variant: Variant; isMobile: boolean; canEdit: boolean;
  ingredients: PickIngredient[]; recipes: PickRecipe[]; driposPrice: number | null;
  onChanged: () => void; onDelete: () => void; canDeleteVariant: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  // Live Dripos price wins; fall back to the price stored from the spreadsheet import.
  const price = driposPrice ?? variant.menu_price;
  const priceLabel = driposPrice != null ? 'Dripos price (live)' : 'Menu price';
  const margin = price && price > 0 ? ((price - variant.variant_cog) / price) * 100 : null;

  const delComponent = async (cid: number) => {
    try { await api.delete(`/api/cog/components/${cid}`); onChanged(); }
    catch (e: any) { alert(`Delete failed: ${e.message}`); }
  };
  const setQty = async (c: Component, quantity: string) => {
    try {
      await api.put(`/api/cog/components/${c.id}`, { quantity: quantity === '' ? null : parseFloat(quantity), unit: c.unit });
      onChanged();
    } catch (e: any) { alert(`Update failed: ${e.message}`); }
  };

  return (
    <div>
      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 540 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <th style={th('left')}>Component</th>
              <th style={th('right')}>Qty</th>
              <th style={th('right')}>Unit cost</th>
              <th style={th('right')}>Line cost</th>
              {canEdit && <th style={th('right')}></th>}
            </tr>
          </thead>
          <tbody>
            {variant.components.length === 0 && (
              <tr><td colSpan={canEdit ? 5 : 4} style={{ padding: 20, textAlign: 'center', color: 'rgba(0,0,0,0.3)' }}>No components yet</td></tr>
            )}
            {variant.components.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                  {c.component_name}
                  {c.component_type === 'recipe' && <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginLeft: 6 }}>(recipe)</span>}
                  {c.missing_source && <span className="badge badge-red" style={{ marginLeft: 6 }}>missing</span>}
                  {c.unit_mismatch && <span title={`Quantity is in "${c.unit}" but cost is per "${c.source_unit}"`} className="badge badge-gold" style={{ marginLeft: 6 }}>unit?</span>}
                </td>
                <td style={td('right')}>
                  {canEdit ? (
                    <input type="number" step="any" defaultValue={c.quantity ?? ''}
                      onBlur={(e) => { if (e.target.value !== String(c.quantity ?? '')) setQty(c, e.target.value); }}
                      style={{ ...inputStyle, width: 72, padding: '5px 8px', textAlign: 'right' }} />
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

      {canEdit && !adding && <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)} style={{ marginBottom: 14 }}>+ Add component</button>}
      {canEdit && adding && (
        <AddComponentRow variantId={variant.id} isMobile={isMobile} ingredients={ingredients} recipes={recipes}
          onClose={() => setAdding(false)} onAdded={() => { setAdding(false); onChanged(); }} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12 }}>
        <Total label="COG" value={money(variant.variant_cog, 3)} />
        <Total label={`Recommended @ ${variant.effective_target_cogs_pct}%`} value={variant.recommended_price != null ? money(variant.recommended_price) : '—'} accent />
        <Total label={priceLabel} value={price != null ? money(price) : '—'} color={driposPrice != null ? '#2563eb' : undefined} />
        <Total label="Margin" value={margin != null ? `${margin.toFixed(1)}%` : '—'}
          color={margin == null ? undefined : margin >= 70 ? '#16a34a' : margin >= 60 ? '#ca8a04' : '#dc2626'} />
      </div>

      {canEdit && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {!editing && <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit this size</button>}
          {canDeleteVariant && <button className="btn btn-secondary btn-sm" onClick={onDelete}>Delete this size</button>}
        </div>
      )}
      {canEdit && editing && (
        <EditVariantRow variant={variant} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />
      )}
    </div>
  );
}

// Edit a size's label, temp/size (the join keys for live Dripos per-size prices)
// and fallback menu price. Sends every field: the PUT clears omitted ones.
function EditVariantRow({ variant, onClose, onSaved }: { variant: Variant; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(variant.label);
  const [temp, setTemp] = useState(variant.temp ?? '');
  const [size, setSize] = useState(variant.size ?? '');
  const [menuPrice, setMenuPrice] = useState(variant.menu_price?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!label.trim()) return;
    setSaving(true);
    try {
      await api.put(`/api/cog/variants/${variant.id}`, {
        label: label.trim(),
        temp: temp || null,
        size: size || null,
        menu_price: menuPrice === '' ? null : parseFloat(menuPrice),
        target_cogs_pct: variant.target_cogs_pct,
      });
      onSaved();
    } catch (e: any) { alert(`Save failed: ${e.message}`); setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', padding: '12px 14px', background: 'rgba(0,0,0,0.03)', borderRadius: 10, marginTop: 12 }}>
      <div style={{ flex: 1, minWidth: 150 }}>
        <label style={labelStyle}>Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ width: 110 }}>
        <label style={labelStyle}>Temp</label>
        <select value={temp} onChange={(e) => setTemp(e.target.value)} style={inputStyle}>
          {TEMP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div style={{ width: 110 }}>
        <label style={labelStyle}>Size</label>
        <select value={size} onChange={(e) => setSize(e.target.value)} style={inputStyle}>
          {SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div style={{ width: 110 }}>
        <label style={labelStyle}>Menu price</label>
        <input type="number" step="0.01" value={menuPrice} onChange={(e) => setMenuPrice(e.target.value)} style={inputStyle} />
      </div>
      <button className="btn btn-primary btn-sm" onClick={save} disabled={!label.trim() || saving}>{saving ? '...' : 'Save'}</button>
      <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
    </div>
  );
}

function Total({ label, value, accent, color }: { label: string; value: string; accent?: boolean; color?: string }) {
  return (
    <div style={{ padding: '12px 14px', background: accent ? 'rgba(34,197,94,0.1)' : 'rgba(0,0,0,0.03)', borderRadius: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color ?? (accent ? '#16a34a' : '#1a1a1a') }}>{value}</div>
    </div>
  );
}

function AddVariantRow({ drinkId, onClose, onAdded }: { drinkId: number; onClose: () => void; onAdded: () => void }) {
  const [label, setLabel] = useState('');
  const [temp, setTemp] = useState('');
  const [size, setSize] = useState('');
  const [menuPrice, setMenuPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const add = async () => {
    if (!label.trim()) return;
    setSaving(true);
    try {
      await api.post(`/api/cog/drinks/${drinkId}/variants`, {
        label: label.trim(),
        temp: temp || null,
        size: size || null,
        menu_price: menuPrice === '' ? null : parseFloat(menuPrice),
      });
      onAdded();
    } catch (e: any) { alert(`Add failed: ${e.message}`); setSaving(false); }
  };
  // Default the label from temp+size so "Hot" + "Large" types itself.
  const pickTemp = (t: string) => { setTemp(t); autoLabel(t, size); };
  const pickSize = (s: string) => { setSize(s); autoLabel(temp, s); };
  const autoLabel = (t: string, s: string) => {
    if (label.trim() && label !== composed(temp, size)) return; // hand-edited: leave it alone
    setLabel(composed(t, s));
  };
  const composed = (t: string, s: string) => {
    const tl = TEMP_OPTIONS.find((o) => o.value === t)?.label;
    const sl = SIZE_OPTIONS.find((o) => o.value === s)?.label;
    return [t ? tl : null, s ? sl : null].filter(Boolean).join(' - ');
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', padding: '12px 14px', background: 'rgba(0,0,0,0.03)', borderRadius: 10, marginBottom: 16 }}>
      <div style={{ width: 110 }}>
        <label style={labelStyle}>Temp</label>
        <select value={temp} onChange={(e) => pickTemp(e.target.value)} style={inputStyle} autoFocus>
          {TEMP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div style={{ width: 110 }}>
        <label style={labelStyle}>Size</label>
        <select value={size} onChange={(e) => pickSize(e.target.value)} style={inputStyle}>
          {SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div style={{ flex: 1, minWidth: 150 }}>
        <label style={labelStyle}>Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} style={inputStyle} placeholder="Hot - Large" />
      </div>
      <div style={{ width: 110 }}>
        <label style={labelStyle}>Menu price</label>
        <input type="number" step="0.01" value={menuPrice} onChange={(e) => setMenuPrice(e.target.value)} style={inputStyle} />
      </div>
      <button className="btn btn-primary btn-sm" onClick={add} disabled={!label.trim() || saving}>{saving ? '...' : 'Add'}</button>
      <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
    </div>
  );
}

function AddComponentRow({ variantId, isMobile, ingredients, recipes, onClose, onAdded }: {
  variantId: number; isMobile: boolean; ingredients: PickIngredient[]; recipes: PickRecipe[];
  onClose: () => void; onAdded: () => void;
}) {
  const [type, setType] = useState<'ingredient' | 'recipe'>('ingredient');
  const [refId, setRefId] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [saving, setSaving] = useState(false);

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
      await api.post(`/api/cog/variants/${variantId}/components`, {
        component_type: type,
        ingredient_id: type === 'ingredient' ? Number(refId) : null,
        recipe_id: type === 'recipe' ? Number(refId) : null,
        quantity: qty === '' ? null : parseFloat(qty),
        unit: unit || null,
      });
      onAdded();
    } catch (e: any) { alert(`Add failed: ${e.message}`); setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', padding: '12px 14px', background: 'rgba(0,0,0,0.03)', borderRadius: 10, marginBottom: 14 }}>
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
      <div style={{ width: 84 }}>
        <label style={labelStyle}>Qty</label>
        <input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ width: 76 }}>
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
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const d = await api.post('/api/cog/drinks', { name: name.trim(), category: category.trim() || null });
      onSaved(d.id);
    } catch (e: any) { alert(`Save failed: ${e.message}`); setSaving(false); }
  };
  return (
    <Modal title="Add drink" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 12, marginBottom: 18 }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus placeholder="Vanilla Latte" />
        </div>
        <div>
          <label style={labelStyle}>Category</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} placeholder="Espresso" />
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 16 }}>A "Regular" size is created automatically — add more sizes after.</div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!name.trim() || saving}>{saving ? 'Saving...' : 'Create'}</button>
      </div>
    </Modal>
  );
}

const th = (align: 'left' | 'right'): React.CSSProperties => ({ textAlign: align, padding: '8px 12px', fontWeight: 600, color: 'rgba(0,0,0,0.4)', whiteSpace: 'nowrap' });
const td = (align: 'left' | 'right'): React.CSSProperties => ({ padding: '8px 12px', textAlign: align, color: 'rgba(0,0,0,0.6)' });
