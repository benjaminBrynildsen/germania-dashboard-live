import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { TEMP_LABEL, type Temperature } from '../lib/sop-types';

type SopListItem = {
  id: number;
  slug: string;
  name: string;
  collection: string | null;
  dietaryTags: string | null;
  refrigerationNote: string | null;
  temperatures: Temperature[];
  updatedAt: number;
};

export default function MenuTeam() {
  const navigate = useNavigate();
  const [sops, setSops] = useState<SopListItem[]>([]);
  const [collections, setCollections] = useState<Array<{ collection: string; count: number }>>([]);
  const [collectionFilter, setCollectionFilter] = useState<string>('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCollection, setNewCollection] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [list, colls] = await Promise.all([
        api.get(`/api/sops${collectionFilter ? `?collection=${encodeURIComponent(collectionFilter)}` : ''}`),
        api.get('/api/sop-collections'),
      ]);
      setSops(list.sops);
      setCollections(colls.collections);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [collectionFilter]);

  const filteredCount = sops.length;
  const selectedCount = selected.size;

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    if (selectedCount === filteredCount) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sops.map((s) => s.id)));
    }
  }

  function bundleUrl(): string {
    const ids = Array.from(selected).join(',');
    return `/api/sops/bundle.pdf?ids=${ids}`;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const body = {
        name: newName.trim(),
        collection: newCollection.trim() || null,
        // Default to iced as the first variant; the editor lets you add others.
        variants: [
          {
            temperature: 'iced',
            position: 0,
            sizeLabels: ['Kids', 'R', 'L'],
            footnotes: [],
            rows: [],
          },
        ],
      };
      const out = await api.post('/api/sops', body);
      navigate(`/menu-team/${out.sop.slug}`);
    } catch (err: any) {
      alert(err.message || 'Failed to create');
      setCreating(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>Menu Team — SOPs</h1>
          <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13, margin: '6px 0 0' }}>Build, edit, and print drink SOPs for every seasonal drop.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/menu-team/presets" className="btn btn-secondary">Presets</Link>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label>New SOP name</label>
            <input
              type="text"
              placeholder="e.g. Vanilla Cloud Latte"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div>
            <label>Collection / Drop (optional)</label>
            <input
              type="text"
              list="collections-datalist"
              placeholder="e.g. Spring 2026 Drop"
              value={newCollection}
              onChange={(e) => setNewCollection(e.target.value)}
            />
            <datalist id="collections-datalist">
              {collections.map((c) => <option key={c.collection} value={c.collection} />)}
            </datalist>
          </div>
          <button type="submit" className="btn btn-primary" disabled={creating || !newName.trim()}>
            {creating ? 'Creating…' : '+ New SOP'}
          </button>
        </form>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>Collection:</label>
          <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} style={{ minWidth: 200 }}>
            <option value="">All collections ({sops.length})</option>
            {collections.map((c) => (
              <option key={c.collection} value={c.collection}>{c.collection} ({c.count})</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {selectedCount > 0 && (
            <a className="btn btn-primary" href={bundleUrl()} target="_blank" rel="noreferrer">
              Export Bundle ({selectedCount}) PDF
            </a>
          )}
          {collectionFilter && (
            <a className="btn btn-secondary" href={`/api/sops/bundle.pdf?collection=${encodeURIComponent(collectionFilter)}`} target="_blank" rel="noreferrer">
              Print whole "{collectionFilter}"
            </a>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
        ) : sops.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
            No SOPs yet. Create your first one above.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.025)', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(0,0,0,0.55)' }}>
                <th style={{ padding: '12px 14px', width: 40 }}>
                  <input type="checkbox" checked={selectedCount > 0 && selectedCount === filteredCount} onChange={selectAllVisible} />
                </th>
                <th style={{ padding: '12px 14px' }}>Drink</th>
                <th style={{ padding: '12px 14px' }}>Collection</th>
                <th style={{ padding: '12px 14px' }}>Temps</th>
                <th style={{ padding: '12px 14px' }}>Dietary</th>
                <th style={{ padding: '12px 14px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sops.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <td style={{ padding: '12px 14px' }}>
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} />
                  </td>
                  <td style={{ padding: '12px 14px', fontWeight: 600 }}>
                    <Link to={`/menu-team/${s.slug}`} style={{ color: '#1a1a1a' }}>{s.name}</Link>
                  </td>
                  <td style={{ padding: '12px 14px', color: 'rgba(0,0,0,0.6)', fontSize: 13 }}>{s.collection || '—'}</td>
                  <td style={{ padding: '12px 14px' }}>
                    {s.temperatures.length === 0 ? <span style={{ color: 'rgba(0,0,0,0.3)', fontSize: 12 }}>none</span> : s.temperatures.map((t) => (
                      <span key={t} style={{ display: 'inline-block', padding: '2px 8px', marginRight: 4, fontSize: 11, borderRadius: 4, background: tempColor(t), color: '#3a2f25' }}>{TEMP_LABEL[t]}</span>
                    ))}
                  </td>
                  <td style={{ padding: '12px 14px', color: 'rgba(0,0,0,0.6)', fontSize: 13 }}>{s.dietaryTags || '—'}</td>
                  <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                    <a href={`/api/sops/${s.slug}/pdf`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ marginRight: 6 }}>PDF</a>
                    <Link to={`/menu-team/${s.slug}`} className="btn btn-primary btn-sm">Edit</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function tempColor(t: Temperature): string {
  if (t === 'iced') return '#e6efe1';
  if (t === 'frozen') return '#dfeaf2';
  return '#f4d8c8';
}
