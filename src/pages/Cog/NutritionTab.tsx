import { useState, useEffect, useMemo } from 'react';
import { api } from '../../lib/api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useCanEdit, inputStyle, labelStyle } from './ui';
import {
  NutritionVec, NutritionFlag, NUTRITION_FIELDS, ZERO_NUTRITION, PUMP_OZ,
  batchTotals, batchCost, perOz, drinkFacts, fmtNutrient, screenPump, screenDrink,
} from '../../lib/nutrition';

interface RecipeItem extends NutritionVec {
  id?: number;
  name: string;
  unit: string | null;
  qty: number | null;
  cost_per_unit: number | null;
}

interface NutritionRecipe {
  id: number;
  name: string;
  kind: 'syrup' | 'sauce';
  yield_oz: number | null;
  notes: string | null;
  items: RecipeItem[];
}

interface NutritionBase extends NutritionVec {
  id: number;
  name: string;
  role: 'coffee' | 'milk';
}

// ── Draft shapes: every numeric field is a string while editing ──
interface DraftItem {
  name: string; unit: string; qty: string; cost: string;
  calories: string; fat_g: string; sat_fat_g: string;
  carbs_g: string; sugar_g: string; protein_g: string; sodium_mg: string;
}

interface Draft {
  id: number | null;
  name: string;
  kind: 'syrup' | 'sauce';
  yieldOz: string;
  items: DraftItem[];
}

const BLANK_ITEM: DraftItem = {
  name: '', unit: 'oz', qty: '', cost: '',
  calories: '', fat_g: '', sat_fat_g: '', carbs_g: '', sugar_g: '', protein_g: '', sodium_mg: '',
};

const num = (s: string): number => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

function draftFromRecipe(r: NutritionRecipe): Draft {
  return {
    id: r.id, name: r.name, kind: r.kind,
    yieldOz: r.yield_oz != null ? String(r.yield_oz) : '',
    items: r.items.map((it) => ({
      name: it.name, unit: it.unit ?? '', qty: it.qty != null ? String(it.qty) : '',
      cost: it.cost_per_unit != null ? String(it.cost_per_unit) : '',
      calories: it.calories != null ? String(it.calories) : '',
      fat_g: it.fat_g != null ? String(it.fat_g) : '',
      sat_fat_g: it.sat_fat_g != null ? String(it.sat_fat_g) : '',
      carbs_g: it.carbs_g != null ? String(it.carbs_g) : '',
      sugar_g: it.sugar_g != null ? String(it.sugar_g) : '',
      protein_g: it.protein_g != null ? String(it.protein_g) : '',
      sodium_mg: it.sodium_mg != null ? String(it.sodium_mg) : '',
    })),
  };
}

function draftItemVec(it: DraftItem): NutritionVec & { qty: number } {
  return {
    qty: num(it.qty),
    calories: num(it.calories), fat_g: num(it.fat_g), sat_fat_g: num(it.sat_fat_g),
    carbs_g: num(it.carbs_g), sugar_g: num(it.sugar_g), protein_g: num(it.protein_g),
    sodium_mg: num(it.sodium_mg),
  };
}

export default function NutritionTab() {
  const isMobile = useIsMobile();
  const canEdit = useCanEdit();
  const [recipes, setRecipes] = useState<NutritionRecipe[]>([]);
  const [bases, setBases] = useState<NutritionBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showBases, setShowBases] = useState(false);

  const load = async () => {
    try {
      const r = await api.get('/api/cog/nutrition');
      setRecipes(r.recipes ?? []);
      setBases(r.bases ?? []);
    } catch (e) {
      console.error('Failed to load nutrition data:', e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    const body = {
      name: draft.name.trim(),
      kind: draft.kind,
      yield_oz: draft.yieldOz === '' ? null : num(draft.yieldOz),
      items: draft.items
        .filter((it) => it.name.trim())
        .map((it) => ({
          name: it.name.trim(),
          unit: it.unit.trim() || null,
          cost_per_unit: it.cost === '' ? null : num(it.cost),
          ...draftItemVec(it),
        })),
    };
    try {
      const r = draft.id != null
        ? await api.put(`/api/cog/nutrition/recipes/${draft.id}`, body)
        : await api.post('/api/cog/nutrition/recipes', body);
      setDraft(null);
      await load();
      setExpanded(r.id);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: NutritionRecipe) => {
    if (!confirm(`Delete "${r.name}" and its nutrition data?`)) return;
    try {
      await api.delete(`/api/cog/nutrition/recipes/${r.id}`);
      if (expanded === r.id) setExpanded(null);
      load();
    } catch (e: any) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  if (loading) return <div style={{ color: 'rgba(0,0,0,0.3)', padding: 40 }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0, marginBottom: 20 }}>
        <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13, maxWidth: 640 }}>
          Nutrition recipes for sauces &amp; syrups. Enter each ingredient's label
          nutrition <strong>per one unit</strong> (e.g. per 1 cup), the quantity used,
          and the batch yield in fluid oz — the drink calculator applies the pump
          ratio on top of the 3&nbsp;oz cold brew + 9&nbsp;oz milk build.
        </p>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => setShowBases((s) => !s)}>
              {showBases ? 'Hide drink bases' : 'Edit drink bases'}
            </button>
            <button className="btn btn-primary" onClick={() => { setExpanded(null); setDraft({ id: null, name: '', kind: 'syrup', yieldOz: '', items: [{ ...BLANK_ITEM }] }); }}>
              + New nutrition recipe
            </button>
          </div>
        )}
      </div>

      {showBases && <BasesEditor bases={bases} canEdit={canEdit} onChanged={load} />}

      {draft && draft.id == null && (
        <RecipeEditor draft={draft} setDraft={setDraft} saving={saving} isMobile={isMobile}
          onSave={save} onCancel={() => setDraft(null)} />
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {recipes.length === 0 && !draft && (
          <div className="card" style={{ textAlign: 'center', padding: 60, color: 'rgba(0,0,0,0.3)' }}>
            No nutrition recipes yet{canEdit ? ' — hit "+ New nutrition recipe" to build the first one.' : '.'}
          </div>
        )}
        {recipes.map((r) => {
          const totals = batchTotals(r.items.map((it) => ({ ...it, qty: it.qty })));
          const po = perOz(totals, r.yield_oz);
          const pumpFlags = po ? screenPump(po, r.kind) : [];
          const worstFlag = pumpFlags.find((f) => f.level === 'alert') ?? pumpFlags[0] ?? null;
          const isOpen = expanded === r.id;
          const editingThis = draft?.id === r.id;
          return (
            <div key={r.id}>
              <div className="card" onClick={() => { setExpanded(isOpen ? null : r.id); setDraft(null); }}
                style={{ cursor: 'pointer', background: isOpen ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.8)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <h3 style={{ fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>{r.name}</h3>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                      <span className={`badge ${r.kind === 'sauce' ? 'badge-gold' : 'badge-blue'}`}>{r.kind === 'sauce' ? 'Sauce' : 'Syrup'}</span>
                      <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>
                        {r.items.length} ingredient{r.items.length === 1 ? '' : 's'}
                        {r.yield_oz ? ` · yields ${r.yield_oz} oz` : ' · yield not set'}
                      </span>
                      {worstFlag && (
                        <span title={worstFlag.message} style={{
                          fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
                          padding: '2px 8px', borderRadius: 999,
                          background: worstFlag.level === 'alert' ? 'rgba(220,38,38,0.12)' : 'rgba(202,138,4,0.14)',
                          color: worstFlag.level === 'alert' ? '#b91c1c' : '#a16207',
                        }}>
                          ⚠ {worstFlag.level === 'alert' ? 'Check recipe' : 'Review'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>
                      {po ? fmtNutrient('calories', po.calories) : '—'}
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', marginLeft: 4 }}>cal/oz</span>
                    </div>
                    {po && (
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>
                        {fmtNutrient('sugar_g', po.sugar_g)}g sugar · {fmtNutrient('fat_g', po.fat_g)}g fat per oz
                        {(() => {
                          const c = batchCost(r.items);
                          return r.yield_oz && c.total > 0 ? <> · ${(c.total / r.yield_oz).toFixed(3)}/oz</> : null;
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {isOpen && !editingThis && (
                <div className="card" style={{ marginTop: 8, background: 'rgba(255,255,255,0.95)' }}>
                  <IngredientTable items={r.items} yieldOz={r.yield_oz} kind={r.kind} />
                  {po && <FlagList flags={screenPump(po, r.kind)} title="Recipe screening — one standard pump" clean="One pump looks normal — nothing unusual in salt, sugar, fat, or calories." />}
                  <DrinkFactsPanel recipe={r} perOzVec={po} bases={bases} isMobile={isMobile} />
                  {canEdit && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setDraft(draftFromRecipe(r))}>Edit recipe</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(r)}>Delete</button>
                    </div>
                  )}
                </div>
              )}

              {editingThis && draft && (
                <RecipeEditor draft={draft} setDraft={setDraft} saving={saving} isMobile={isMobile}
                  onSave={save} onCancel={() => setDraft(null)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Read-only ingredient table with batch totals + per-oz row ─────
function IngredientTable({ items, yieldOz, kind }: { items: RecipeItem[]; yieldOz: number | null; kind: 'syrup' | 'sauce' }) {
  const totals = batchTotals(items.map((it) => ({ ...it, qty: it.qty })));
  const po = perOz(totals, yieldOz);
  const cost = batchCost(items);
  const costPerOz = yieldOz && yieldOz > 0 ? cost.total / yieldOz : null;
  return (
    <div style={{ overflowX: 'auto', marginBottom: 20 }}>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', minWidth: 820 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
            <th style={th('left')}>Ingredient</th>
            <th style={th('right')}>Qty</th>
            <th style={th('left')}>Unit</th>
            <th style={th('right')}>Cost</th>
            {NUTRITION_FIELDS.map((f) => <th key={f.key} style={th('right')}>{f.label}{f.unit ? ` (${f.unit})` : ''}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id ?? i} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <td style={{ padding: '8px 10px', fontWeight: 600 }}>{it.name}</td>
              <td style={td('right')}>{it.qty ?? '—'}</td>
              <td style={td('left')}>{it.unit ?? ''}</td>
              <td style={td('right')}>
                {it.qty != null && it.cost_per_unit != null ? `$${(it.qty * it.cost_per_unit).toFixed(2)}` : '—'}
              </td>
              {NUTRITION_FIELDS.map((f) => (
                <td key={f.key} style={td('right')} title={`per 1 ${it.unit || 'unit'}`}>
                  {(it[f.key] ?? 0) * (it.qty ?? 0) ? fmtNutrient(f.key, (it[f.key] || 0) * (it.qty || 0)) : '0'}
                </td>
              ))}
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid rgba(0,0,0,0.15)', fontWeight: 700 }}>
            <td style={{ padding: '8px 10px' }} colSpan={3}>Batch total{!cost.complete && cost.total > 0 ? ' (some lines uncosted)' : ''}</td>
            <td style={td('right')}>{cost.total > 0 ? `$${cost.total.toFixed(2)}` : '—'}</td>
            {NUTRITION_FIELDS.map((f) => <td key={f.key} style={td('right')}>{fmtNutrient(f.key, totals[f.key])}</td>)}
          </tr>
          <tr style={{ fontWeight: 700, color: '#1a1a1a', background: 'rgba(0,0,0,0.03)' }}>
            <td style={{ padding: '8px 10px' }} colSpan={3}>
              Per fluid oz {yieldOz ? `(÷ ${yieldOz} oz yield)` : '(set the yield!)'}
            </td>
            <td style={td('right')}>{costPerOz != null && cost.total > 0 ? `$${costPerOz.toFixed(3)}` : '—'}</td>
            {NUTRITION_FIELDS.map((f) => <td key={f.key} style={td('right')}>{po ? fmtNutrient(f.key, po[f.key]) : '—'}</td>)}
          </tr>
        </tbody>
      </table>
      {costPerOz != null && cost.total > 0 && (
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginTop: 8 }}>
          Cost per pump: <strong>${(costPerOz * PUMP_OZ[kind].standard).toFixed(3)}</strong> standard
          {' · '}<strong>${(costPerOz * PUMP_OZ[kind].extra).toFixed(3)}</strong> extra
          {!cost.complete && ' (some ingredient lines have no cost yet)'}
        </div>
      )}
    </div>
  );
}

// ── Editor (new + edit share it) ──────────────────────────────────
function RecipeEditor({ draft, setDraft, saving, isMobile, onSave, onCancel }: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  saving: boolean;
  isMobile: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const setItem = (i: number, patch: Partial<DraftItem>) =>
    setDraft({ ...draft, items: draft.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });

  const totals = batchTotals(draft.items.map(draftItemVec));
  const po = perOz(totals, num(draft.yieldOz) || null);
  const cost = batchCost(draft.items.map((it) => ({
    qty: it.qty === '' ? null : num(it.qty),
    cost_per_unit: it.cost === '' ? null : num(it.cost),
  })));
  const yieldNum = num(draft.yieldOz);
  const costPerOz = yieldNum > 0 && cost.total > 0 ? cost.total / yieldNum : null;

  const numCell: React.CSSProperties = { ...inputStyle, width: 68, padding: '6px 6px', fontSize: 12, textAlign: 'right' };

  return (
    <div className="card" style={{ marginTop: 8, marginBottom: 12, background: 'rgba(255,255,255,0.97)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '2fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div style={{ gridColumn: isMobile ? '1 / -1' : 'auto' }}>
          <label style={labelStyle}>Name</label>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle} autoFocus={draft.id == null} placeholder="Haus Caramel Sauce" />
        </div>
        <div>
          <label style={labelStyle}>Kind</label>
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value === 'sauce' ? 'sauce' : 'syrup' })} style={inputStyle}>
            <option value="syrup">Syrup (extra pump 1.25 oz)</option>
            <option value="sauce">Sauce (extra pump 1.5 oz)</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Batch yield (fl oz)</label>
          <input type="number" step="any" value={draft.yieldOz} onChange={(e) => setDraft({ ...draft, yieldOz: e.target.value })} style={inputStyle} placeholder="64" />
        </div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(0,0,0,0.45)', marginBottom: 8 }}>
        Ingredients — nutrition per ONE unit, straight off the label
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              <th style={th('left')}>Ingredient</th>
              <th style={th('right')}>Qty</th>
              <th style={th('left')}>Unit</th>
              <th style={th('right')}>$ / unit</th>
              {NUTRITION_FIELDS.map((f) => <th key={f.key} style={th('right')}>{f.label}{f.unit ? ` (${f.unit})` : ''}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.items.map((it, i) => (
              <tr key={i}>
                <td style={{ padding: 3 }}>
                  <input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} style={{ ...inputStyle, minWidth: 140, padding: '6px 8px', fontSize: 12 }} placeholder="Granulated sugar" />
                </td>
                <td style={{ padding: 3 }}>
                  <input type="number" step="any" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} style={numCell} placeholder="2" />
                </td>
                <td style={{ padding: 3 }}>
                  <input value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} style={{ ...inputStyle, width: 62, padding: '6px 6px', fontSize: 12 }} placeholder="cup" />
                </td>
                <td style={{ padding: 3 }}>
                  <input type="number" step="any" value={it.cost} onChange={(e) => setItem(i, { cost: e.target.value })} style={numCell} placeholder="0.42" />
                </td>
                {NUTRITION_FIELDS.map((f) => (
                  <td key={f.key} style={{ padding: 3 }}>
                    <input type="number" step="any" value={it[f.key]} onChange={(e) => setItem(i, { [f.key]: e.target.value } as Partial<DraftItem>)} style={numCell} />
                  </td>
                ))}
                <td style={{ padding: 3 }}>
                  <button className="btn btn-danger btn-sm" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn btn-secondary btn-sm" onClick={() => setDraft({ ...draft, items: [...draft.items, { ...BLANK_ITEM }] })} style={{ marginTop: 8 }}>
        + Add ingredient
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
          Batch: <strong>{fmtNutrient('calories', totals.calories)} cal</strong>, {fmtNutrient('sugar_g', totals.sugar_g)}g sugar
          {cost.total > 0 && <>, <strong>${cost.total.toFixed(2)}</strong>{!cost.complete && '*'}</>}
          {po && <> · per oz: <strong>{fmtNutrient('calories', po.calories)} cal</strong>, {fmtNutrient('sugar_g', po.sugar_g)}g sugar{costPerOz != null && <>, <strong>${costPerOz.toFixed(3)}</strong></>}</>}
          {costPerOz != null && <> · per pump ~<strong>${(costPerOz * PUMP_OZ[draft.kind].standard).toFixed(3)}</strong></>}
          {cost.total > 0 && !cost.complete && <span style={{ color: 'rgba(0,0,0,0.35)' }}> · *some lines uncosted</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave} disabled={!draft.name.trim() || saving}>
            {saving ? 'Saving...' : (draft.id != null ? 'Save recipe' : 'Create recipe')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Anomaly flag list ─────────────────────────────────────────────
function FlagList({ flags, title, clean }: { flags: NutritionFlag[]; title: string; clean?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(0,0,0,0.4)', marginBottom: 6 }}>
        {title}
      </div>
      {flags.length === 0 ? (
        clean ? (
          <div style={{ fontSize: 12, color: '#166534', background: 'rgba(22,101,52,0.07)', padding: '8px 12px', borderRadius: 8 }}>
            ✓ {clean}
          </div>
        ) : null
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {flags.map((f, i) => (
            <div key={i} style={{
              fontSize: 12.5, padding: '8px 12px', borderRadius: 8, lineHeight: 1.45,
              background: f.level === 'alert' ? 'rgba(220,38,38,0.08)' : 'rgba(202,138,4,0.10)',
              color: f.level === 'alert' ? '#991b1b' : '#854d0e',
              border: `1px solid ${f.level === 'alert' ? 'rgba(220,38,38,0.2)' : 'rgba(202,138,4,0.25)'}`,
            }}>
              {f.level === 'alert' ? '🚨' : '⚠️'} {f.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drink facts: 3oz cold brew + 9oz milk + one pump ──────────────
function DrinkFactsPanel({ recipe, perOzVec, bases, isMobile }: {
  recipe: NutritionRecipe;
  perOzVec: NutritionVec | null;
  bases: NutritionBase[];
  isMobile: boolean;
}) {
  const coffees = bases.filter((b) => b.role === 'coffee');
  const milks = bases.filter((b) => b.role === 'milk');
  const [coffeeId, setCoffeeId] = useState<number | null>(coffees[0]?.id ?? null);
  const [milkId, setMilkId] = useState<number | null>(milks[0]?.id ?? null);
  const [coffeeOz, setCoffeeOz] = useState('3');
  const [milkOz, setMilkOz] = useState('9');
  const [pump, setPump] = useState<'standard' | 'extra'>('standard');

  const coffee = coffees.find((b) => b.id === coffeeId) ?? null;
  const milk = milks.find((b) => b.id === milkId) ?? null;

  const facts = useMemo(() => {
    if (!perOzVec) return null;
    return drinkFacts({
      coffeePerOz: coffee ?? ZERO_NUTRITION,
      coffeeOz: num(coffeeOz),
      milkPerOz: milk ?? ZERO_NUTRITION,
      milkOz: num(milkOz),
      recipePerOz: perOzVec,
      kind: recipe.kind,
      pump,
    });
  }, [perOzVec, coffee, milk, coffeeOz, milkOz, recipe.kind, pump]);

  if (!perOzVec) {
    return (
      <div style={{ padding: '12px 16px', background: 'rgba(202,138,4,0.08)', borderRadius: 10, fontSize: 13, color: '#a16207' }}>
        Set the batch yield (fl oz) to unlock the drink nutrition calculator.
      </div>
    );
  }

  const totalOz = num(coffeeOz) + num(milkOz) + (facts?.pumpOz ?? 0);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 260px', gap: 18, alignItems: 'start' }}>
      <div>
        <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>
          Drink Builder
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(2, 1fr)', gap: 10, maxWidth: 460 }}>
          <div>
            <label style={labelStyle}>Coffee base</label>
            <select value={coffeeId ?? ''} onChange={(e) => setCoffeeId(e.target.value ? Number(e.target.value) : null)} style={inputStyle}>
              <option value="">None</option>
              {coffees.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Coffee oz</label>
            <input type="number" step="any" value={coffeeOz} onChange={(e) => setCoffeeOz(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Milk</label>
            <select value={milkId ?? ''} onChange={(e) => setMilkId(e.target.value ? Number(e.target.value) : null)} style={inputStyle}>
              <option value="">None</option>
              {milks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Milk oz</label>
            <input type="number" step="any" value={milkOz} onChange={(e) => setMilkOz(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>{recipe.kind === 'sauce' ? 'Sauce' : 'Syrup'} pump</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['standard', 'extra'] as const).map((p) => (
                <button key={p} onClick={() => setPump(p)} style={{
                  flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: pump === p ? '#1a1a1a' : 'rgba(0,0,0,0.06)',
                  color: pump === p ? '#fff' : 'rgba(0,0,0,0.55)',
                }}>
                  {p === 'standard' ? 'Standard' : 'Extra'} · {PUMP_OZ[recipe.kind][p]} oz
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', margin: '10px 0 14px' }}>
          {num(coffeeOz)} oz coffee + {num(milkOz)} oz milk + {facts?.pumpOz} oz {recipe.name} = ~{Math.round(totalOz * 10) / 10} oz drink
        </div>
        {facts && (
          <FlagList flags={screenDrink(facts.total)} title="Drink screening"
            clean="This drink screens normal for sodium, sugar, fat, and calories." />
        )}
      </div>

      {/* Nutrition-facts style panel */}
      {facts && (
        <div style={{ border: '2px solid #1a1a1a', borderRadius: 6, padding: '10px 12px', background: '#fff', fontFamily: 'var(--font-body, inherit)' }}>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: -0.5, borderBottom: '8px solid #1a1a1a', paddingBottom: 4 }}>
            Nutrition Facts
          </div>
          <div style={{ fontSize: 11, padding: '4px 0', borderBottom: '4px solid #1a1a1a' }}>
            One drink (~{Math.round(totalOz * 10) / 10} fl oz)
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '4px 0', borderBottom: '4px solid #1a1a1a' }}>
            <span style={{ fontSize: 14, fontWeight: 800 }}>Calories</span>
            <span style={{ fontSize: 26, fontWeight: 900 }}>{fmtNutrient('calories', facts.total.calories)}</span>
          </div>
          {NUTRITION_FIELDS.filter((f) => f.key !== 'calories').map((f, i, arr) => (
            <div key={f.key} style={{
              display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12,
              borderBottom: i === arr.length - 1 ? 'none' : '1px solid rgba(0,0,0,0.25)',
              paddingLeft: f.key === 'sat_fat_g' || f.key === 'sugar_g' ? 14 : 0,
            }}>
              <span style={{ fontWeight: f.key === 'sat_fat_g' || f.key === 'sugar_g' ? 400 : 700 }}>{f.label}</span>
              <span>{fmtNutrient(f.key, facts.total[f.key])}{f.unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Base (cold brew / milk) per-oz nutrition editor ───────────────
function BasesEditor({ bases, canEdit, onChanged }: { bases: NutritionBase[]; canEdit: boolean; onChanged: () => void }) {
  const [drafts, setDrafts] = useState<Record<number, Record<string, string>>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const cell = (b: NutritionBase, key: keyof NutritionVec) =>
    drafts[b.id]?.[key] ?? (b[key] != null ? String(b[key]) : '');

  const setCell = (id: number, key: string, v: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [key]: v } }));

  const saveRow = async (b: NutritionBase) => {
    const d = drafts[b.id];
    if (!d) return;
    setBusy(b.id);
    try {
      const body: Record<string, unknown> = {};
      for (const f of NUTRITION_FIELDS) if (d[f.key] !== undefined) body[f.key] = d[f.key] === '' ? null : parseFloat(d[f.key]);
      await api.put(`/api/cog/nutrition/bases/${b.id}`, body);
      setDrafts((cur) => { const next = { ...cur }; delete next[b.id]; return next; });
      onChanged();
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16, overflowX: 'auto' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Drink bases — nutrition per fluid oz</div>
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 10 }}>
        Seeded from standard label values; adjust to match your actual suppliers.
      </div>
      <table style={{ borderCollapse: 'collapse', minWidth: 820, fontSize: 12 }}>
        <thead>
          <tr>
            <th style={th('left')}>Base</th>
            {NUTRITION_FIELDS.map((f) => <th key={f.key} style={th('right')}>{f.label}{f.unit ? ` (${f.unit})` : ''}</th>)}
            {canEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {bases.map((b) => (
            <tr key={b.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <td style={{ padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {b.name} <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)' }}>{b.role}</span>
              </td>
              {NUTRITION_FIELDS.map((f) => (
                <td key={f.key} style={{ padding: 3 }}>
                  {canEdit ? (
                    <input type="number" step="any" value={cell(b, f.key)}
                      onChange={(e) => setCell(b.id, f.key, e.target.value)}
                      style={{ ...inputStyle, width: 70, padding: '5px 6px', fontSize: 12, textAlign: 'right' }} />
                  ) : (
                    <span style={{ display: 'block', textAlign: 'right', padding: '5px 6px' }}>{b[f.key] ?? '—'}</span>
                  )}
                </td>
              ))}
              {canEdit && (
                <td style={{ padding: 3 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => saveRow(b)} disabled={!drafts[b.id] || busy === b.id}>
                    {busy === b.id ? '...' : 'Save'}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th = (align: 'left' | 'right'): React.CSSProperties => ({ textAlign: align, padding: '6px 10px', fontWeight: 600, color: 'rgba(0,0,0,0.4)', whiteSpace: 'nowrap', fontSize: 11 });
const td = (align: 'left' | 'right'): React.CSSProperties => ({ padding: '8px 10px', textAlign: align, color: 'rgba(0,0,0,0.6)' });
