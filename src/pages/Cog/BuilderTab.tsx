import { useState, useMemo, useEffect } from 'react';
import { api } from '../../lib/api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useCanEdit, inputStyle, labelStyle, NumInput, SelectWithOther } from './ui';
import { MasterPicker, masterUnitCost } from './RecipesTab';
import type { MasterIngredient } from './IngredientsTab';
import { unitsPerPackUnit, normalizeUnit, MEASURE_UNITS, YIELD_UNITS, PACK_UNITS, seasonOptions } from '../../lib/units';

// Recipe Builder — a full-page workbench where the chef assembles a
// syrup / sauce / food batch recipe straight from the ingredient
// catalog and watches the cost move with every line. Cups, TBSP, oz
// etc. auto-convert against the pack unit where the math is unambiguous;
// weight↔volume pairs (a cup of flour from a 50 lb bag) ask for the
// one factor only the kitchen knows. Saving writes a normal batch
// recipe, so it shows up in Batch Recipes and can go straight into
// drinks as a component.

interface Row {
  key: number;
  kind: 'master' | 'custom';
  m: MasterIngredient | null;       // kind=master
  customName: string;               // kind=custom
  customPackCost: string;
  customPackSize: string;
  customPackUnit: string;
  qty: string;
  unit: string;                     // measuring unit for qty
  manualConv: string;               // used when auto conversion is impossible
  yieldPct: string;
}

interface RowCost {
  perUse: number | null;            // EP $ per measuring unit
  conv: number | null;              // measuring units per pack unit
  needsConv: boolean;               // cross-kind pair waiting on a factor
  lineCost: number | null;
}

let nextKey = 1;

function packOf(r: Row): { cost: number | null; size: number | null; unit: string } {
  if (r.kind === 'master' && r.m) {
    return { cost: r.m.ap_pack_cost, size: r.m.pack_size, unit: r.m.pack_unit || '' };
  }
  return {
    cost: r.customPackCost === '' ? null : parseFloat(r.customPackCost),
    size: r.customPackSize === '' ? null : parseFloat(r.customPackSize),
    unit: r.customPackUnit,
  };
}

function rowName(r: Row): string {
  return r.kind === 'master' ? (r.m?.name ?? '') : r.customName;
}

function costRow(r: Row): RowCost {
  const pack = packOf(r);
  if (pack.cost == null || !(pack.size != null && pack.size > 0)) {
    return { perUse: null, conv: null, needsConv: false, lineCost: null };
  }
  const perPackUnit = pack.cost / pack.size;
  const auto = unitsPerPackUnit(pack.unit, r.unit);
  const manual = r.manualConv === '' ? null : parseFloat(r.manualConv);
  const conv = auto ?? (manual != null && manual > 0 ? manual : null);
  if (conv == null) return { perUse: null, conv: null, needsConv: auto == null, lineCost: null };
  const yieldPct = parseFloat(r.yieldPct);
  const yf = yieldPct > 0 ? yieldPct / 100 : 1;
  const perUse = perPackUnit / conv / yf;
  const qty = r.qty === '' ? null : parseFloat(r.qty);
  return { perUse, conv, needsConv: false, lineCost: qty != null ? perUse * qty : null };
}

const CATEGORY_CHIPS = ['Syrup', 'Sauce', 'Food'];

export default function BuilderTab({ onSaved }: { onSaved?: (recipeId: number) => void }) {
  const isMobile = useIsMobile();
  const canEdit = useCanEdit();
  const [masterList, setMasterList] = useState<MasterIngredient[]>([]);
  const [seasonChoices, setSeasonChoices] = useState<string[]>(() => seasonOptions());
  useEffect(() => {
    api.get('/api/cog/ingredients/master').then(setMasterList).catch(() => {});
    // Seasons already on recipes join the generated list, so the picker
    // always matches what the Batch Recipes filters know about.
    api.get('/api/cog/recipes')
      .then((rs: Array<{ season: string | null }>) => setSeasonChoices(seasonOptions(rs.map((r) => r.season))))
      .catch(() => {});
  }, []);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('Food');
  const [season, setSeason] = useState('');
  const [totalYield, setTotalYield] = useState('');
  const [yieldUnit, setYieldUnit] = useState('each');
  const [rows, setRows] = useState<Row[]>([]);
  const [pendingPick, setPendingPick] = useState<MasterIngredient | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [laborTime, setLaborTime] = useState('');
  const [laborRate, setLaborRate] = useState('17');
  const [laborBatches, setLaborBatches] = useState('1');
  const [menuPrice, setMenuPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const addMasterRow = (m: MasterIngredient) => {
    // Measure in the pack unit by default — always a clean 1:1 start.
    setRows((rs) => [...rs, {
      key: nextKey++, kind: 'master', m,
      customName: '', customPackCost: '', customPackSize: '', customPackUnit: '',
      qty: '', unit: normalizeUnit(m.pack_unit) || 'each', manualConv: '', yieldPct: '100',
    }]);
    setPendingPick(null);
    setPickerKey((k) => k + 1);
    setSavedNote(null);
  };

  const addCustomRow = () => {
    setRows((rs) => [...rs, {
      key: nextKey++, kind: 'custom', m: null,
      customName: '', customPackCost: '', customPackSize: '', customPackUnit: 'oz',
      qty: '', unit: 'oz', manualConv: '', yieldPct: '100',
    }]);
    setSavedNote(null);
  };

  const patchRow = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const costs = useMemo(() => rows.map(costRow), [rows]);
  const ingredientTotal = useMemo(
    () => costs.reduce((s, c) => s + (c.lineCost ?? 0), 0),
    [costs],
  );
  const incomplete = useMemo(
    () => rows.filter((r, i) => rowName(r).trim() && (costs[i].lineCost == null)).length,
    [rows, costs],
  );

  // House labor convention (matches the COG workbooks): time × rate ÷
  // batches is the labor figure added on top of one batch's ingredients.
  const laborCost = useMemo(() => {
    const t = parseFloat(laborTime), r = parseFloat(laborRate), b = parseFloat(laborBatches);
    if (!(t > 0) || !(r > 0) || !(b > 0)) return null;
    return (t * r) / b;
  }, [laborTime, laborRate, laborBatches]);

  const yieldNum = totalYield === '' ? null : parseFloat(totalYield);
  const batchTotal = ingredientTotal + (laborCost ?? 0);
  const perUnit = yieldNum != null && yieldNum > 0 ? batchTotal / yieldNum : null;
  const price = menuPrice === '' ? null : parseFloat(menuPrice);
  const marginPct = price != null && price > 0 && perUnit != null ? ((price - perUnit) / price) * 100 : null;

  const readyToSave = name.trim() !== '' && yieldNum != null && yieldNum > 0 && yieldUnit.trim() !== ''
    && rows.some((_, i) => costs[i].lineCost != null) && incomplete === 0;

  const reset = () => {
    setName(''); setSeason(''); setTotalYield(''); setYieldUnit('each');
    setRows([]); setLaborTime(''); setLaborRate('17'); setLaborBatches('1'); setMenuPrice('');
  };

  const save = async () => {
    if (!readyToSave || saving) return;
    setSaving(true);
    try {
      const r = await api.post('/api/cog/recipes', {
        name: name.trim(),
        season: season.trim() || null,
        category,
        total_yield: yieldNum,
        yield_unit: yieldUnit.trim(),
        labor_time_hrs: laborTime === '' ? null : parseFloat(laborTime),
        labor_quantity: laborCost != null ? parseFloat(laborBatches) : null,
        labor_cook_rate: laborCost != null ? parseFloat(laborRate) : null,
        labor_cost_per_unit: laborCost,
      });
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!rowName(row).trim()) continue;
        const c = costs[i];
        const pack = packOf(row);
        const yp = parseFloat(row.yieldPct);
        const ap = c.perUse != null ? c.perUse * ((yp > 0 ? yp : 100) / 100) : null;
        await api.post(`/api/cog/recipes/${r.id}/ingredients`, {
          name: rowName(row).trim(),
          ap_pack_cost: pack.cost,
          pack_size: pack.size,
          pack_unit: pack.unit || null,
          unit_conversion: c.conv,
          ap_price: ap,
          ap_price_unit: row.unit || null,
          yield_percent: yp > 0 ? yp : 100,
          ep_price: c.perUse,
          ep_price_unit: row.unit || null,
          quantity_used: row.qty === '' ? null : parseFloat(row.qty),
        });
      }
      setSavedNote(`"${name.trim()}" saved — $${(perUnit ?? 0).toFixed(3)}/${yieldUnit}. It's in Batch Recipes now and can be used inside drinks.`);
      reset();
      onSaved?.(r.id);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return <div className="card" style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
      The recipe builder needs edit access. Recipes already built are on the Batch Recipes tab.
    </div>;
  }

  const costPanel = (
    <div className="card" style={{
      position: isMobile ? 'static' : 'sticky', top: 16,
      background: 'rgba(255,255,255,0.97)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>
        Running cost
      </div>
      <div style={{ display: 'grid', gap: 8, fontSize: 13.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'rgba(0,0,0,0.55)' }}>Ingredients ({rows.filter((r) => rowName(r).trim()).length})</span>
          <strong>${ingredientTotal.toFixed(2)}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'rgba(0,0,0,0.55)' }}>Labor</span>
          <strong>{laborCost != null ? `$${laborCost.toFixed(2)}` : '—'}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 8 }}>
          <span style={{ color: 'rgba(0,0,0,0.55)' }}>Batch total</span>
          <strong>${batchTotal.toFixed(2)}</strong>
        </div>
      </div>
      <div style={{ padding: '14px 16px', background: 'rgba(0,0,0,0.04)', borderRadius: 10, margin: '14px 0' }}>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 2 }}>
          Cost per {yieldUnit || 'unit'}{yieldNum ? ` (yield ${yieldNum})` : ''}
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5 }}>
          {perUnit != null ? `$${perUnit.toFixed(3)}` : '—'}
        </div>
        {perUnit == null && <div style={{ fontSize: 11.5, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>enter the batch yield to see this</div>}
      </div>
      <div>
        <label style={labelStyle}>Selling price (optional)</label>
        <NumInput value={menuPrice} onChange={setMenuPrice} step={0.25} placeholder="4.50" />
        {marginPct != null && (
          <div style={{
            marginTop: 8, padding: '10px 12px', borderRadius: 8, fontSize: 13,
            background: marginPct > 70 ? 'rgba(34,197,94,0.12)' : marginPct > 55 ? 'rgba(234,179,8,0.12)' : 'rgba(239,68,68,0.12)',
            color: marginPct > 70 ? '#15803d' : marginPct > 55 ? '#a16207' : '#b91c1c', fontWeight: 700,
          }}>
            {marginPct.toFixed(1)}% margin · COG {(100 - marginPct).toFixed(1)}%
          </div>
        )}
      </div>
      {incomplete > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#b45309' }}>
          {incomplete} line{incomplete > 1 ? 's' : ''} still need{incomplete === 1 ? 's' : ''} a quantity or conversion before saving.
        </div>
      )}
      <button className="btn btn-primary" onClick={save} disabled={!readyToSave || saving}
        style={{ width: '100%', marginTop: 14 }}>
        {saving ? 'Saving…' : 'Save recipe'}
      </button>
    </div>
  );

  return (
    <div>
      {savedNote && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13.5,
          background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.3)', color: '#166534',
        }}>
          ✓ {savedNote}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 300px', gap: 18, alignItems: 'start' }}>
        <div>
          {/* Recipe basics */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Recipe name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Pumpkin Scone" autoFocus />
              </div>
              <div>
                <label style={labelStyle}>Season (optional)</label>
                <SelectWithOther value={season} onChange={setSeason} options={seasonChoices} noneLabel="— year-round —" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={labelStyle}>Type</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {CATEGORY_CHIPS.map((c) => (
                    <button key={c} onClick={() => setCategory(c)} style={{
                      padding: '7px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      border: category === c ? '2px solid #1a1a1a' : '1px solid rgba(0,0,0,0.12)',
                      background: category === c ? '#1a1a1a' : '#fff', color: category === c ? '#fff' : 'rgba(0,0,0,0.6)',
                    }}>{c}</button>
                  ))}
                </div>
              </div>
              <div style={{ width: 110 }}>
                <label style={labelStyle}>Batch yield</label>
                <NumInput value={totalYield} onChange={setTotalYield} step={1} placeholder="12" />
              </div>
              <div style={{ width: 130 }}>
                <label style={labelStyle}>Yield unit</label>
                <SelectWithOther value={yieldUnit} onChange={setYieldUnit} options={YIELD_UNITS} />
              </div>
            </div>
          </div>

          {isMobile && <div style={{ marginBottom: 14 }}>{costPanel}</div>}

          {/* Ingredient lines */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>
              Ingredients
            </div>
            {rows.length === 0 && (
              <div style={{ padding: '18px 0 22px', color: 'rgba(0,0,0,0.35)', fontSize: 13.5 }}>
                Search the ingredient list below — each one you add shows its cost as you set the amount.
              </div>
            )}
            {rows.map((r, i) => {
              const c = costs[i];
              const pack = packOf(r);
              return (
                <div key={r.key} style={{ padding: '12px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: '2 1 160px', minWidth: 150 }}>
                      {r.kind === 'master' ? (
                        <>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{r.m?.name}</div>
                          <div style={{ fontSize: 11.5, color: 'rgba(0,0,0,0.4)' }}>
                            {pack.cost != null && pack.size ? `$${pack.cost.toFixed(2)} / ${pack.size} ${pack.unit}` : 'no pack price in catalog'}
                          </div>
                        </>
                      ) : (
                        <>
                          <label style={labelStyle}>Custom ingredient</label>
                          <input value={r.customName} onChange={(e) => patchRow(r.key, { customName: e.target.value })}
                            style={inputStyle} placeholder="pearl sugar" />
                        </>
                      )}
                    </div>
                    {r.kind === 'custom' && (
                      <>
                        <div style={{ width: 90 }}>
                          <label style={labelStyle}>Pack $</label>
                          <NumInput value={r.customPackCost} onChange={(v) => patchRow(r.key, { customPackCost: v })} step={1} placeholder="46.90" />
                        </div>
                        <div style={{ width: 80 }}>
                          <label style={labelStyle}>Pack size</label>
                          <NumInput value={r.customPackSize} onChange={(v) => patchRow(r.key, { customPackSize: v })} step={1} placeholder="96" />
                        </div>
                        <div style={{ width: 92 }}>
                          <label style={labelStyle}>Unit</label>
                          <SelectWithOther value={r.customPackUnit}
                            onChange={(v) => patchRow(r.key, { customPackUnit: v, manualConv: '' })}
                            options={PACK_UNITS} />
                        </div>
                      </>
                    )}
                    <div style={{ width: 84 }}>
                      <label style={labelStyle}>Amount</label>
                      <NumInput value={r.qty} onChange={(v) => patchRow(r.key, { qty: v })} step={0.25} placeholder="2" />
                    </div>
                    <div style={{ width: 86 }}>
                      <label style={labelStyle}>Unit</label>
                      <select value={r.unit} onChange={(e) => patchRow(r.key, { unit: e.target.value, manualConv: '' })} style={inputStyle}>
                        {[...new Set([normalizeUnit(pack.unit), ...MEASURE_UNITS].filter(Boolean))].map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ width: 92, textAlign: 'right', paddingBottom: 6 }}>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>
                        {c.perUse != null ? `$${c.perUse.toFixed(3)}/${r.unit}` : ''}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        {c.lineCost != null ? `$${c.lineCost.toFixed(2)}` : '—'}
                      </div>
                    </div>
                    <button className="btn btn-danger btn-sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                      aria-label="Remove line" style={{ marginBottom: 4 }}>🗑</button>
                  </div>
                  {c.needsConv && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, padding: '8px 12px', background: 'rgba(202,138,4,0.08)', borderRadius: 8, fontSize: 12.5, color: '#854d0e', flexWrap: 'wrap' }}>
                      <span>Can't auto-convert {r.unit} from {pack.unit || '?'} — how many <strong>{r.unit}</strong> per <strong>{pack.unit || 'pack unit'}</strong>?
                        {' '}(e.g. flour ≈ 4 c per lb)</span>
                      <NumInput value={r.manualConv} onChange={(v) => patchRow(r.key, { manualConv: v })} step={1} width={90} placeholder="4" />
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add row */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 14 }}>
              <div style={{ flex: '2 1 220px', minWidth: 200 }}>
                <label style={labelStyle}>Add from ingredient list</label>
                <MasterPicker key={pickerKey} masterList={masterList} picked={pendingPick}
                  onPick={(m) => { if (m) addMasterRow(m); else setPendingPick(null); }}
                  placeholder="Search ingredient list…" />
              </div>
              <button className="btn btn-secondary btn-sm" onClick={addCustomRow} style={{ marginBottom: 2 }}
                title="Something that isn't in the catalog yet">+ Custom</button>
            </div>
          </div>

          {/* Labor */}
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>
              Labor (optional)
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ width: 110 }}>
                <label style={labelStyle}>Time (hrs)</label>
                <NumInput value={laborTime} onChange={setLaborTime} step={0.25} placeholder="0.5" />
              </div>
              <div style={{ width: 110 }}>
                <label style={labelStyle}>Rate $/hr</label>
                <NumInput value={laborRate} onChange={setLaborRate} step={0.5} />
              </div>
              <div style={{ width: 110 }}>
                <label style={labelStyle}>Batches made</label>
                <NumInput value={laborBatches} onChange={setLaborBatches} step={1} min={1} />
              </div>
              <div style={{ flex: 1, minWidth: 160, alignSelf: 'flex-end', fontSize: 12.5, color: 'rgba(0,0,0,0.5)', paddingBottom: 8 }}>
                {laborCost != null
                  ? <>adds <strong>${laborCost.toFixed(2)}</strong> to the batch (time × rate ÷ batches)</>
                  : 'time in the kitchen × hourly rate, split across the batches made in that time'}
              </div>
            </div>
          </div>
        </div>

        {!isMobile && costPanel}
      </div>
    </div>
  );
}
