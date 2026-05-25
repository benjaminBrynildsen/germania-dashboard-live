import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { SopPreset } from '../../lib/sop-types';

const CATEGORIES = [
  'espresso', 'cold-brew', 'tea', 'milk', 'powder',
  'syrup-haus', 'syrup-monin', 'sauce', 'foam', 'garnish', 'ice', 'topping',
];

export default function PresetsView() {
  const [presets, setPresets] = useState<SopPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'syrup-haus', defaultModifier: '' });

  async function load() {
    setLoading(true);
    try {
      const r = await api.get('/api/sop-presets');
      setPresets(r.presets);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, SopPreset[]>();
    for (const p of presets) {
      const arr = m.get(p.category) ?? [];
      arr.push(p);
      m.set(p.category, arr);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [presets]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setAdding(true);
    try {
      await api.post('/api/sop-presets', {
        name: form.name.trim(),
        category: form.category,
        defaultModifier: form.defaultModifier.trim() || null,
      });
      setForm({ name: '', category: form.category, defaultModifier: '' });
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRename(p: SopPreset) {
    const next = prompt('Rename preset:', p.name);
    if (!next || next === p.name) return;
    try {
      await api.put(`/api/sop-presets/${p.id}`, { name: next });
      await load();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleDelete(p: SopPreset) {
    if (p.isSeeded) {
      if (!confirm(`"${p.name}" is a seeded preset and will be re-added on the next server boot. Delete anyway?`)) return;
    } else {
      if (!confirm(`Delete preset "${p.name}"?`)) return;
    }
    try {
      await api.delete(`/api/sop-presets/${p.id}`);
      await load();
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <Link to="/menu-team" style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)' }}>← Menu Team</Link>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '8px 0 0', letterSpacing: -0.3 }}>Preset Library</h1>
          <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13, margin: '4px 0 0' }}>Reusable ingredients and building blocks. Defaults pre-fill cells when you drop them into a recipe.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={handleAdd} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.4fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Haus Strawberry" />
          </div>
          <div>
            <label>Category</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label>Default modifier (optional)</label>
            <input value={form.defaultModifier} onChange={(e) => setForm({ ...form, defaultModifier: e.target.value })} placeholder="(Extra Pump)" />
          </div>
          <button type="submit" className="btn btn-primary" disabled={adding || !form.name.trim()}>+ Add</button>
        </form>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : (
        grouped.map(([cat, items]) => (
          <div key={cat} className="card" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 10px', color: 'rgba(0,0,0,0.6)' }}>{cat}</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {items.map((p) => (
                <div key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8 }}>
                  <span style={{ fontSize: 13 }}>{p.name}{p.defaultModifier ? <span style={{ color: 'rgba(0,0,0,0.4)' }}> {p.defaultModifier}</span> : null}</span>
                  {p.isSeeded && <span style={{ fontSize: 10, padding: '1px 6px', background: 'rgba(0,0,0,0.06)', borderRadius: 4, color: 'rgba(0,0,0,0.4)' }}>seeded</span>}
                  <button onClick={() => handleRename(p)} style={btnGhost}>✎</button>
                  <button onClick={() => handleDelete(p)} style={btnGhost}>×</button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

const btnGhost: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(0,0,0,0.4)', fontSize: 12, padding: 2 };
