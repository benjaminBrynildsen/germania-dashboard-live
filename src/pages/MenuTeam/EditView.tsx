import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { DEFAULT_SIZE_LABELS, TEMP_LABEL, TEMP_ORDER, type Sop, type SopFootnote, type SopPreset, type SopRow, type SopVariant, type Temperature } from '../../lib/sop-types';
import SeasonYearPicker from './SeasonYearPicker';
import ChipPicker from './ChipPicker';

const DIETARY_TAG_OPTIONS = ['DF', 'GF', 'Vegan', 'Vegetarian'];
const ALLERGEN_OPTIONS = ['Dairy', 'Soy', 'Gluten', 'Nuts', 'Eggs'];
const REFRIG_OPTIONS_CHIPS = [
  'Room Temp',
  'Refrigerate',
  'Refrigerate or On Ice',
  'Does NOT need refrigeration',
  'Syrup does NOT need refrigeration',
];

type SopFull = Sop & { id: number };

export default function EditView() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [sop, setSop] = useState<SopFull | null>(null);
  const [presets, setPresets] = useState<SopPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  // When on, editing an ingredient name or modifier in one temperature
  // variant rewrites the matching row in the other variants too — saves
  // the "type the syrup name three times" tax for drinks like Sunshine
  // Latte that have iced/frozen/hot all sharing the same syrup.
  // Matched by current row name; cells stay independent because per-size
  // quantities differ between iced and hot.
  const [syncAcrossTemps, setSyncAcrossTemps] = useState(true);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    (async () => {
      try {
        const [one, p] = await Promise.all([
          api.get(`/api/sops/${slug}`),
          api.get('/api/sop-presets'),
        ]);
        if (!alive) return;
        setSop(one.sop);
        setPresets(p.presets);
      } catch (err: any) {
        if (alive) setError(err.message || 'load_failed');
      }
    })();
    return () => { alive = false; };
  }, [slug]);

  function mutate(updater: (s: SopFull) => SopFull) {
    setSop((cur) => (cur ? updater({ ...cur, variants: cur.variants.map((v) => ({ ...v, rows: v.rows.map((r) => ({ ...r })) })) }) : cur));
    setDirty(true);
  }

  function setField<K extends keyof Sop>(key: K, value: Sop[K]) {
    mutate((s) => ({ ...s, [key]: value }) as SopFull);
  }

  function toggleTemperature(temp: Temperature) {
    mutate((s) => {
      const exists = s.variants.find((v) => v.temperature === temp);
      if (exists) {
        return { ...s, variants: s.variants.filter((v) => v.temperature !== temp) };
      }
      const newVariant: SopVariant = {
        temperature: temp,
        position: TEMP_ORDER.indexOf(temp),
        sizeLabels: [...DEFAULT_SIZE_LABELS[temp]],
        footnotes: [],
        rows: [],
        assemblyBigIdea: null,
        assemblySteps: null,
      };
      const variants = [...s.variants, newVariant].sort((a, b) => TEMP_ORDER.indexOf(a.temperature) - TEMP_ORDER.indexOf(b.temperature));
      return { ...s, variants };
    });
  }

  function updateVariant(temp: Temperature, updater: (v: SopVariant) => SopVariant) {
    mutate((s) => ({
      ...s,
      variants: s.variants.map((v) => (v.temperature === temp ? updater(v) : v)),
    }));
  }

  // Row-level name/modifier edit that optionally syncs the change to the
  // matching row(s) in other temperature variants. `oldName` is the name
  // BEFORE the edit so we can find the right rows to mirror it onto;
  // matching is case-insensitive to tolerate casing drift.
  function updateRowField(temp: Temperature, idx: number, oldName: string, patch: { name?: string; modifier?: string | null }) {
    mutate((s) => {
      const targetVariantIdx = s.variants.findIndex((v) => v.temperature === temp);
      if (targetVariantIdx === -1) return s;
      const variants = s.variants.map((v, vi) => {
        if (vi === targetVariantIdx) {
          return {
            ...v,
            rows: v.rows.map((r, ri) => (ri === idx ? { ...r, ...patch } : r)),
          };
        }
        if (!syncAcrossTemps) return v;
        // Blank old name → no identity to match on; would otherwise sync
        // every unnamed custom row to the new value all at once.
        if (!oldName.trim()) return v;
        return {
          ...v,
          rows: v.rows.map((r) => (r.name.trim().toLowerCase() === oldName.trim().toLowerCase() ? { ...r, ...patch } : r)),
        };
      });
      return { ...s, variants };
    });
  }

  async function handleSave(thenPreview = false) {
    if (!sop) return;
    setSaving(true);
    setError('');
    try {
      const body = {
        name: sop.name,
        collection: sop.collection,
        dietaryTags: sop.dietaryTags,
        syrupDietaryTags: sop.syrupDietaryTags,
        drinkContains: sop.drinkContains,
        refrigerationNote: sop.refrigerationNote,
        variants: sop.variants.map((v, i) => ({
          temperature: v.temperature,
          position: i,
          sizeLabels: v.sizeLabels,
          footnotes: v.footnotes,
          assemblyBigIdea: v.assemblyBigIdea,
          assemblySteps: v.assemblySteps,
          rows: v.rows.map((r) => ({
            presetId: r.presetId ?? null,
            name: r.name,
            modifier: r.modifier ?? null,
            cells: r.cells,
          })),
        })),
      };
      const out = await api.put(`/api/sops/${sop.id}`, body);
      setSop(out.sop);
      setDirty(false);
      if (thenPreview) {
        window.open(`/api/sops/${out.sop.slug}/pdf`, '_blank');
      }
    } catch (err: any) {
      setError(err.message || 'save_failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!sop) return;
    if (!confirm(`Delete SOP "${sop.name}"? This can't be undone.`)) return;
    try {
      await api.delete(`/api/sops/${sop.id}`);
      navigate('/menu-team');
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleDuplicate() {
    if (!sop) return;
    if (dirty) {
      if (!confirm('You have unsaved changes — duplicating will use the last-saved version. Continue?')) return;
    }
    try {
      const out = await api.post(`/api/sops/${sop.id}/duplicate`);
      navigate(`/menu-team/${out.sop.slug}`);
    } catch (err: any) {
      alert(err.message || 'Failed to duplicate');
    }
  }

  if (error && !sop) {
    return (
      <div style={{ maxWidth: 700, margin: '0 auto', padding: 20 }}>
        <Link to="/menu-team" style={{ fontSize: 13 }}>← Back to Menu Team</Link>
        <div className="card" style={{ marginTop: 16, color: '#d32f2f' }}>Failed to load SOP: {error}</div>
      </div>
    );
  }

  if (!sop) {
    return <div style={{ padding: 30, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>;
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <Link to="/menu-team" style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)' }}>← All SOPs</Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={handleDelete}>Delete</button>
          <button className="btn btn-secondary" onClick={handleDuplicate}>Duplicate</button>
          <a className="btn btn-secondary" href={`/api/sops/${sop.slug}/pdf`} target="_blank" rel="noreferrer">Open PDF</a>
          <button className="btn btn-secondary" disabled={saving} onClick={() => handleSave(true)}>Save & Preview</button>
          <button className="btn btn-primary" disabled={saving || !dirty} onClick={() => handleSave(false)}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: '#d32f2f', fontSize: 13, padding: '10px 14px', background: 'rgba(210,50,50,0.05)', borderRadius: 10, marginBottom: 12 }}>{error}</div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Header</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12 }}>
          <div>
            <label>Drink name</label>
            <input type="text" value={sop.name} onChange={(e) => setField('name', e.target.value)} />
          </div>
          <div>
            <label>Season &amp; year</label>
            <SeasonYearPicker value={sop.collection} onChange={(next) => setField('collection', next)} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label>Dietary tags</label>
          <ChipPicker presets={DIETARY_TAG_OPTIONS} value={sop.dietaryTags} onChange={(v) => setField('dietaryTags', v)} placeholder="Custom tag (e.g. Keto)" />
          <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 4 }}>Picked chips form a single line. Use Syrup vs Drink below if you need to split.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <div>
            <label>Syrup dietary tags (optional split-line)</label>
            <ChipPicker presets={DIETARY_TAG_OPTIONS} value={sop.syrupDietaryTags} onChange={(v) => setField('syrupDietaryTags', v)} placeholder="Custom" />
          </div>
          <div>
            <label>Drink contains (allergens)</label>
            <ChipPicker presets={ALLERGEN_OPTIONS} value={sop.drinkContains} onChange={(v) => setField('drinkContains', v)} placeholder="Custom allergen" />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label>Refrigeration note</label>
          <ChipPicker presets={REFRIG_OPTIONS_CHIPS} value={sop.refrigerationNote} onChange={(v) => setField('refrigerationNote', v)} placeholder="Custom refrigeration note" />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Temperatures</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          {TEMP_ORDER.map((t) => {
            const on = !!sop.variants.find((v) => v.temperature === t);
            return (
              <label key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: on ? 'rgba(0,0,0,0.07)' : 'transparent', border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer' }}>
                <input type="checkbox" checked={on} onChange={() => toggleTemperature(t)} />
                {TEMP_LABEL[t]}
              </label>
            );
          })}
        </div>
        {sop.variants.length === 0 && (
          <p style={{ marginTop: 12, color: 'rgba(0,0,0,0.5)', fontSize: 13 }}>Pick at least one temperature to start building the recipe.</p>
        )}
        {sop.variants.length > 1 && (
          <label style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(0,0,0,0.7)' }}>
            <input type="checkbox" checked={syncAcrossTemps} onChange={(e) => setSyncAcrossTemps(e.target.checked)} />
            Sync ingredient names + modifiers across temperatures
            <span style={{ color: 'rgba(0,0,0,0.4)', fontSize: 11 }}>(per-size cells stay independent)</span>
          </label>
        )}
      </div>

      {sop.variants.map((v) => (
        <VariantEditor
          key={v.temperature}
          variant={v}
          presets={presets}
          onChange={(updater) => updateVariant(v.temperature, updater)}
          onRowField={(idx, oldName, patch) => updateRowField(v.temperature, idx, oldName, patch)}
        />
      ))}
    </div>
  );
}

function VariantEditor({ variant, presets, onChange, onRowField }: { variant: SopVariant; presets: SopPreset[]; onChange: (updater: (v: SopVariant) => SopVariant) => void; onRowField: (idx: number, oldName: string, patch: { name?: string; modifier?: string | null }) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function setSizeLabel(i: number, label: string) {
    onChange((v) => {
      const labels = [...v.sizeLabels];
      labels[i] = label;
      return { ...v, sizeLabels: labels };
    });
  }

  function addSizeColumn() {
    onChange((v) => ({
      ...v,
      sizeLabels: [...v.sizeLabels, ''],
      rows: v.rows.map((r) => ({ ...r, cells: [...r.cells, ''] })),
    }));
  }

  function removeSizeColumn(i: number) {
    onChange((v) => ({
      ...v,
      sizeLabels: v.sizeLabels.filter((_, idx) => idx !== i),
      rows: v.rows.map((r) => ({ ...r, cells: r.cells.filter((_, idx) => idx !== i) })),
    }));
  }

  function applySizeProfile(profile: 'iced' | 'hot' | 'single') {
    if (profile === 'iced') {
      onChange((v) => alignCells({ ...v, sizeLabels: ['Kids', 'R', 'L'] }));
    } else if (profile === 'hot') {
      onChange((v) => alignCells({ ...v, sizeLabels: ['S', 'R', 'L'] }));
    } else {
      onChange((v) => alignCells({ ...v, sizeLabels: ['8 oz ripple cup'] }));
    }
  }

  function alignCells(v: SopVariant): SopVariant {
    const n = v.sizeLabels.length;
    return {
      ...v,
      rows: v.rows.map((r) => {
        const cells: string[] = [];
        for (let i = 0; i < n; i++) cells.push(r.cells[i] ?? '');
        return { ...r, cells };
      }),
    };
  }

  function addPresetRow(preset: SopPreset) {
    const sizeCount = variant.sizeLabels.length;
    const tempKey = variant.temperature;
    const defaults = preset.defaultCells || {};
    const fromPreset = defaults[tempKey] || defaults['any'] || [];
    const cells: string[] = [];
    for (let i = 0; i < sizeCount; i++) cells.push(fromPreset[i] ?? '');
    onChange((v) => ({
      ...v,
      rows: [...v.rows, { presetId: preset.id, name: preset.name, modifier: preset.defaultModifier ?? null, cells }],
    }));
    setPickerOpen(false);
  }

  function addCustomRow() {
    const sizeCount = variant.sizeLabels.length;
    const cells: string[] = [];
    for (let i = 0; i < sizeCount; i++) cells.push('');
    onChange((v) => ({
      ...v,
      rows: [...v.rows, { presetId: null, name: '', modifier: null, cells }],
    }));
  }

  function updateRow(idx: number, patch: Partial<SopRow>) {
    onChange((v) => ({
      ...v,
      rows: v.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  }

  function updateRowCell(rowIdx: number, cellIdx: number, value: string) {
    onChange((v) => ({
      ...v,
      rows: v.rows.map((r, i) => {
        if (i !== rowIdx) return r;
        const cells = [...r.cells];
        cells[cellIdx] = value;
        return { ...r, cells };
      }),
    }));
  }

  function removeRow(idx: number) {
    onChange((v) => ({ ...v, rows: v.rows.filter((_, i) => i !== idx) }));
  }

  function moveRow(idx: number, dir: -1 | 1) {
    onChange((v) => {
      const target = idx + dir;
      if (target < 0 || target >= v.rows.length) return v;
      const rows = [...v.rows];
      const [moved] = rows.splice(idx, 1);
      rows.splice(target, 0, moved);
      return { ...v, rows };
    });
  }

  function addFootnote() {
    onChange((v) => ({ ...v, footnotes: [...v.footnotes, { marker: '*', text: '' }] }));
  }

  function updateFootnote(i: number, patch: Partial<SopFootnote>) {
    onChange((v) => ({ ...v, footnotes: v.footnotes.map((fn, idx) => (idx === i ? { ...fn, ...patch } : fn)) }));
  }

  function removeFootnote(i: number) {
    onChange((v) => ({ ...v, footnotes: v.footnotes.filter((_, idx) => idx !== i) }));
  }

  function toggleAssembly() {
    onChange((v) => {
      if (v.assemblySteps && v.assemblySteps.length > 0) {
        return { ...v, assemblyBigIdea: null, assemblySteps: null };
      }
      return { ...v, assemblySteps: [''] };
    });
  }

  function updateAssemblyStep(i: number, text: string) {
    onChange((v) => ({ ...v, assemblySteps: (v.assemblySteps || []).map((s, idx) => (idx === i ? text : s)) }));
  }

  function addAssemblyStep() {
    onChange((v) => ({ ...v, assemblySteps: [...(v.assemblySteps || []), ''] }));
  }

  function removeAssemblyStep(i: number) {
    onChange((v) => ({ ...v, assemblySteps: (v.assemblySteps || []).filter((_, idx) => idx !== i) }));
  }

  const grouped = useMemo(() => {
    const m = new Map<string, SopPreset[]>();
    for (const p of presets) {
      const arr = m.get(p.category) ?? [];
      arr.push(p);
      m.set(p.category, arr);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [presets]);

  return (
    <div className="card" style={{ marginBottom: 16, borderTop: `4px solid ${tempBorder(variant.temperature)}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>{TEMP_LABEL[variant.temperature]}</h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>Size preset:</span>
          <button className="btn btn-secondary btn-sm" onClick={() => applySizeProfile('iced')}>Kids · R · L</button>
          <button className="btn btn-secondary btn-sm" onClick={() => applySizeProfile('hot')}>S · R · L</button>
          <button className="btn btn-secondary btn-sm" onClick={() => applySizeProfile('single')}>Single 8oz</button>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Size columns</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {variant.sizeLabels.map((label, i) => (
            <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'rgba(0,0,0,0.04)', borderRadius: 6 }}>
              <input value={label} onChange={(e) => setSizeLabel(i, e.target.value)} style={{ width: 110, padding: '4px 6px', fontSize: 12 }} />
              <button onClick={() => removeSizeColumn(i)} style={btnGhost} title="Remove">×</button>
            </div>
          ))}
          <button className="btn btn-secondary btn-sm" onClick={addSizeColumn}>+ Size</button>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <label>Build steps (top → bottom is the build order)</label>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.04)' }}>
                <th style={th}>#</th>
                <th style={th}>Ingredient</th>
                <th style={th}>Modifier</th>
                {variant.sizeLabels.map((label, i) => (
                  <th key={i} style={{ ...th, textAlign: 'center' }}>{label || '—'}</th>
                ))}
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {variant.rows.map((r, idx) => (
                <tr key={idx} style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
                  <td style={tdCenter}>
                    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
                      <button onClick={() => moveRow(idx, -1)} style={btnGhost} disabled={idx === 0}>▲</button>
                      <button onClick={() => moveRow(idx, 1)} style={btnGhost} disabled={idx === variant.rows.length - 1}>▼</button>
                    </div>
                  </td>
                  <td style={td}>
                    <input value={r.name} onChange={(e) => onRowField(idx, r.name, { name: e.target.value })} style={inputCell} />
                  </td>
                  <td style={td}>
                    <input value={r.modifier || ''} placeholder="(Extra Pump)" onChange={(e) => onRowField(idx, r.name, { modifier: e.target.value || null })} style={inputCell} />
                  </td>
                  {variant.sizeLabels.map((_, ci) => (
                    <td key={ci} style={td}>
                      <textarea
                        value={r.cells[ci] ?? ''}
                        onChange={(e) => updateRowCell(idx, ci, e.target.value)}
                        rows={2}
                        style={{ ...inputCell, resize: 'vertical', minHeight: 32, fontFamily: 'inherit' }}
                      />
                    </td>
                  ))}
                  <td style={tdCenter}>
                    <button onClick={() => removeRow(idx)} style={btnGhost} title="Remove row">🗑</button>
                  </td>
                </tr>
              ))}
              {variant.rows.length === 0 && (
                <tr><td colSpan={3 + variant.sizeLabels.length + 1} style={{ ...td, textAlign: 'center', color: 'rgba(0,0,0,0.4)', padding: 14 }}>No rows yet — add one below.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn btn-secondary" onClick={() => setPickerOpen((o) => !o)}>{pickerOpen ? 'Hide presets' : '+ From preset'}</button>
          <button className="btn btn-secondary" onClick={addCustomRow}>+ Custom row</button>
        </div>
        {pickerOpen && (
          <div style={{ marginTop: 10, padding: 12, background: 'rgba(0,0,0,0.025)', borderRadius: 8 }}>
            {grouped.map(([cat, items]) => (
              <div key={cat} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>{cat}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {items.map((p) => (
                    <button key={p.id} onClick={() => addPresetRow(p)} style={chip} title={p.defaultModifier || ''}>
                      {p.name}{p.defaultModifier ? ` ${p.defaultModifier}` : ''}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Footnotes
          <button className="btn btn-secondary btn-sm" onClick={addFootnote}>+ Footnote</button>
        </label>
        {variant.footnotes.length === 0 && <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', margin: '4px 0' }}>Optional asterisk notes that appear below the table.</p>}
        {variant.footnotes.map((fn, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 1fr 40px', gap: 6, marginTop: 6 }}>
            <input value={fn.marker} onChange={(e) => updateFootnote(i, { marker: e.target.value })} placeholder="*" style={{ fontSize: 13 }} />
            <input value={fn.text} onChange={(e) => updateFootnote(i, { text: e.target.value })} placeholder="steam chai and milk together" style={{ fontSize: 13 }} />
            <button onClick={() => removeFootnote(i)} style={btnGhost}>×</button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18 }}>
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Drink Assembly notes
          <button className="btn btn-secondary btn-sm" onClick={toggleAssembly}>
            {(variant.assemblySteps && variant.assemblySteps.length > 0) ? 'Remove' : '+ Add'}
          </button>
        </label>
        {variant.assemblySteps && variant.assemblySteps.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <input
              placeholder="Big Idea: e.g. Cold brew assembled macchiato-style"
              value={variant.assemblyBigIdea || ''}
              onChange={(e) => onChange((v) => ({ ...v, assemblyBigIdea: e.target.value || null }))}
              style={{ marginBottom: 8 }}
            />
            {variant.assemblySteps.map((s, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '32px 1fr 40px', gap: 6, marginTop: 4 }}>
                <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', alignSelf: 'center' }}>{i + 1}.</div>
                <input value={s} onChange={(e) => updateAssemblyStep(i, e.target.value)} placeholder="To cup, add water, sweetened condensed milk…" style={{ fontSize: 13 }} />
                <button onClick={() => removeAssemblyStep(i)} style={btnGhost}>×</button>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={addAssemblyStep}>+ Step</button>
          </div>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '8px 6px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(0,0,0,0.55)' };
const td: React.CSSProperties = { padding: '6px 4px', verticalAlign: 'top' };
const tdCenter: React.CSSProperties = { ...td, textAlign: 'center', verticalAlign: 'middle' };
const inputCell: React.CSSProperties = { width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid rgba(0,0,0,0.1)', borderRadius: 6, background: '#fff' };
const btnGhost: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(0,0,0,0.5)', fontSize: 12, padding: 2 };
const chip: React.CSSProperties = { padding: '4px 10px', background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 999, fontSize: 12, cursor: 'pointer' };

function tempBorder(t: Temperature): string {
  if (t === 'iced') return '#9bc69a';
  if (t === 'frozen') return '#9cbed9';
  return '#e2a07c';
}
