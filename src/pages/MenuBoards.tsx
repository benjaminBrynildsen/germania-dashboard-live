import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type {
  MenuSeason, MenuCategory, MenuItem, MenuList, MenuListItem,
  Location, LOCATIONS,
} from '../lib/menu-types';

const LOCATIONS_LIST: Array<{ key: string; name: string; format: string }> = [
  { key: 'G1', name: 'Alton', format: '24x36' },
  { key: 'G2', name: 'Godfrey', format: '24x36' },
  { key: 'G3', name: 'East Alton', format: '24x36' },
  { key: 'G4', name: 'Jerseyville', format: '18x48' },
];

export default function MenuBoards() {
  const { id } = useParams<{ id: string }>();
  return id ? <SeasonEditor seasonId={Number(id)} /> : <SeasonList />;
}

// ─── Season List ─────────────────────────────────────────────

function SeasonList() {
  const [seasons, setSeasons] = useState<Array<{ id: number; name: string; itemCount: number }>>([]);
  const [newName, setNewName] = useState('');
  const [copyFrom, setCopyFrom] = useState<number | ''>('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/menu-seasons').then((r) => setSeasons(r.seasons));
  }, []);

  async function create() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const r = await api.post('/api/menu-seasons', {
        name: newName.trim(),
        copyFromId: copyFrom || undefined,
      });
      navigate(`/menu-boards/${r.season.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <h2>Menu Boards</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New season name (e.g. Summer 2026)"
          style={{ flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', fontSize: 14 }}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        {seasons.length > 0 && (
          <select
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value ? Number(e.target.value) : '')}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }}
          >
            <option value="">Start blank</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>Copy from {s.name}</option>
            ))}
          </select>
        )}
        <button className="btn btn-primary" onClick={create} disabled={creating || !newName.trim()}>
          {creating ? 'Creating...' : '+ New Season'}
        </button>
      </div>

      {seasons.length === 0 && (
        <p style={{ color: 'rgba(0,0,0,0.5)' }}>No menu seasons yet. Create one above.</p>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {seasons.map((s) => (
          <div
            key={s.id}
            onClick={() => navigate(`/menu-boards/${s.id}`)}
            style={{
              padding: '16px 20px', borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              transition: 'box-shadow 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>
                {s.itemCount} items
              </div>
            </div>
            <span style={{ fontSize: 20, color: 'rgba(0,0,0,0.3)' }}>→</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Season Editor ───────────────────────────────────────────

function SeasonEditor({ seasonId }: { seasonId: number }) {
  const [season, setSeason] = useState<MenuSeason | null>(null);
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  function reload() {
    api.get(`/api/menu-seasons/${seasonId}`).then((r) => {
      setSeason(r.season);
      setLoading(false);
    });
  }

  useEffect(() => { reload(); }, [seasonId]);

  if (loading || !season) return <div>Loading...</div>;

  const sideCategories = season.categories.filter((c) => c.side === side);
  const sideLists = season.lists.filter((l) => l.side === side);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/menu-boards')}>← Back</button>
        <h2 style={{ margin: 0 }}>{season.name}</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <ExportDropdown seasonId={seasonId} />
        </div>
      </div>

      {/* Side toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {(['front', 'back'] as const).map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${side === s ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setSide(s)}
          >
            {s === 'front' ? 'Front (Drinks)' : 'Back (Tea + Food)'}
          </button>
        ))}
      </div>

      {/* Categories */}
      {sideCategories.map((cat) => (
        <CategorySection key={cat.id} category={cat} onUpdate={reload} />
      ))}

      <AddCategoryButton seasonId={seasonId} side={side} position={sideCategories.length} onCreated={reload} />

      {/* Bottom lists */}
      <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid rgba(0,0,0,0.1)' }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: 'rgba(0,0,0,0.5)' }}>
          Bottom Lists ({side === 'front' ? 'More Coffee / Cold Foam / Add-Ons' : 'More Flavors / More Drinks'})
        </h4>
        {sideLists.map((list) => (
          <ListEditor key={list.id} list={list} onUpdate={reload} />
        ))}
        <AddListButton seasonId={seasonId} side={side} position={sideLists.length} onCreated={reload} />
      </div>
    </div>
  );
}

// ─── Category Section ────────────────────────────────────────

function CategorySection({ category, onUpdate }: { category: MenuCategory; onUpdate: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [subtitle, setSubtitle] = useState(category.subtitle || '');

  async function save() {
    await api.put(`/api/menu-categories/${category.id}`, { name, subtitle: subtitle || null });
    setEditing(false);
    onUpdate();
  }

  async function remove() {
    if (!confirm(`Delete "${category.name}" and all its items?`)) return;
    await api.delete(`/api/menu-categories/${category.id}`);
    onUpdate();
  }

  return (
    <div style={{ marginBottom: 24, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, overflow: 'hidden' }}>
      {/* Category header */}
      <div
        style={{
          padding: '12px 16px', background: 'rgba(0,0,0,0.03)',
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span style={{ fontSize: 12, transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>▼</span>
        {editing ? (
          <div style={{ display: 'flex', gap: 8, flex: 1 }} onClick={(e) => e.stopPropagation()}>
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, fontSize: 14, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)' }} />
            <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Subtitle" style={{ flex: 1, fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)' }} />
            <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        ) : (
          <>
            <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>
              {category.name}
              {category.subtitle && <span style={{ fontWeight: 400, fontSize: 12, color: 'rgba(0,0,0,0.5)', marginLeft: 8 }}>{category.subtitle}</span>}
            </span>
            <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>{category.items.length} items</span>
            <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); setEditing(true); }}>Edit</button>
            <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); remove(); }} style={{ color: '#c0392b' }}>×</button>
          </>
        )}
      </div>

      {/* Items */}
      {!collapsed && (
        <div style={{ padding: '8px 16px 16px' }}>
          {category.items.map((item) => (
            <ItemRow key={item.id} item={item} onUpdate={onUpdate} />
          ))}
          <AddItemButton categoryId={category.id} kind={category.side === 'back' && category.name.toLowerCase().includes('bake') ? 'food' : 'drink'} position={category.items.length} onCreated={onUpdate} />
        </div>
      )}
    </div>
  );
}

// ─── Item Row ────────────────────────────────────────────────

function ItemRow({ item, onUpdate }: { item: MenuItem; onUpdate: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...item });

  function set(key: string, val: any) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function save() {
    const body: any = {
      name: form.name,
      description: form.description || null,
      temps: form.temps || null,
      hasSpotify: form.hasSpotify,
      frozenNote: form.frozenNote || null,
      layout: form.layout,
      pairPosition: form.pairPosition || null,
      isNew: form.isNew,
    };
    if (item.kind === 'drink') {
      body.sizeLabels = form.sizeLabels;
      body.prices = form.prices;
    } else {
      body.foodPrice = form.foodPrice;
      body.foodSubtitle = form.foodSubtitle || null;
    }
    await api.put(`/api/menu-items/${item.id}`, body);
    setEditing(false);
    onUpdate();
  }

  async function remove() {
    if (!confirm(`Delete "${item.name}"?`)) return;
    await api.delete(`/api/menu-items/${item.id}`);
    onUpdate();
  }

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.05)', fontSize: 13 }}>
        <span style={{ fontWeight: 600, flex: 1 }}>
          {item.isNew && <span style={{ color: '#e74c3c', fontSize: 10, fontWeight: 700, marginRight: 6 }}>NEW</span>}
          {item.name}
        </span>
        {item.kind === 'drink' && item.prices && (
          <span style={{ color: 'rgba(0,0,0,0.5)', fontSize: 12 }}>
            {item.prices.join(' / ')}
          </span>
        )}
        {item.kind === 'food' && item.foodPrice && (
          <span style={{ color: 'rgba(0,0,0,0.5)', fontSize: 12 }}>{item.foodPrice}</span>
        )}
        {item.temps && <span style={{ color: 'rgba(0,0,0,0.4)', fontSize: 11 }}>{item.temps}</span>}
        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)} style={{ fontSize: 11 }}>Edit</button>
        <button className="btn btn-secondary btn-sm" onClick={remove} style={{ color: '#c0392b', fontSize: 11 }}>×</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px', marginBottom: 8, background: 'rgba(0,0,0,0.02)', borderRadius: 8, fontSize: 13 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Name</label>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Description</label>
          <input value={form.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="e.g. HAUS PEPPERMINT MOCHA SAUCE" style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }} />
        </div>
      </div>

      {item.kind === 'drink' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Sizes (comma-sep)</label>
              <input
                value={(form.sizeLabels || []).join(', ')}
                onChange={(e) => set('sizeLabels', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                placeholder="Small, Regular, Large"
                style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Prices (comma-sep)</label>
              <input
                value={(form.prices || []).join(', ')}
                onChange={(e) => set('prices', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                placeholder="5.56, 6.15, 6.70"
                style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Temps</label>
              <input value={form.temps || ''} onChange={(e) => set('temps', e.target.value)} placeholder="ICED · FROZEN · HOT" style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 8, fontSize: 12 }}>
            <label><input type="checkbox" checked={form.hasSpotify} onChange={(e) => set('hasSpotify', e.target.checked)} /> Spotify icon</label>
            <div>
              <label style={{ marginRight: 4 }}>Layout:</label>
              <select value={form.layout} onChange={(e) => set('layout', e.target.value)} style={{ fontSize: 12, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.15)' }}>
                <option value="full">Full width</option>
                <option value="half">Half (paired)</option>
              </select>
            </div>
            {form.layout === 'half' && (
              <select value={form.pairPosition || 'left'} onChange={(e) => set('pairPosition', e.target.value)} style={{ fontSize: 12, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.15)' }}>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            )}
            <input value={form.frozenNote || ''} onChange={(e) => set('frozenNote', e.target.value)} placeholder="Frozen note" style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', flex: 1 }} />
          </div>
        </>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Price</label>
            <input value={form.foodPrice || ''} onChange={(e) => set('foodPrice', e.target.value)} placeholder="7.00" style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 2 }}>Subtitle</label>
            <input value={form.foodSubtitle || ''} onChange={(e) => set('foodSubtitle', e.target.value)} placeholder="(WITH APPLE BUTTER JAM)" style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }} />
          </div>
          <div>
            <label><input type="checkbox" checked={form.isNew} onChange={(e) => set('isNew', e.target.checked)} /> NEW badge</label>
          </div>
        </div>
      )}

      {/* Location visibility for food items */}
      {item.kind === 'food' && (
        <div style={{ marginBottom: 8, fontSize: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Available at:</label>
          <div style={{ display: 'flex', gap: 12 }}>
            {LOCATIONS_LIST.map((loc) => {
              const active = item.locations.some((l) => l.location === loc.key);
              return (
                <label key={loc.key} style={{ opacity: active ? 1 : 0.5 }}>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={async (e) => {
                      const locs = e.target.checked
                        ? [...item.locations.map((l) => ({ location: l.location })), { location: loc.key }]
                        : item.locations.filter((l) => l.location !== loc.key).map((l) => ({ location: l.location }));
                      await api.put(`/api/menu-items/${item.id}/locations`, { locations: locs });
                      onUpdate();
                    }}
                  /> {loc.key} ({loc.name})
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
      </div>
    </div>
  );
}

// ─── Add buttons ─────────────────────────────────────────────

function AddCategoryButton({ seasonId, side, position, onCreated }: { seasonId: number; side: string; position: number; onCreated: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [subtitle, setSubtitle] = useState('');

  async function create() {
    if (!name.trim()) return;
    await api.post('/api/menu-categories', { seasonId, name: name.trim(), subtitle: subtitle.trim() || null, side, position });
    setName('');
    setSubtitle('');
    setAdding(false);
    onCreated();
  }

  if (!adding) {
    return (
      <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)} style={{ marginTop: 8 }}>
        + Add Category
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name" style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }} onKeyDown={(e) => e.key === 'Enter' && create()} />
      <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Subtitle" style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }} />
      <button className="btn btn-primary btn-sm" onClick={create}>Add</button>
      <button className="btn btn-secondary btn-sm" onClick={() => setAdding(false)}>Cancel</button>
    </div>
  );
}

function AddItemButton({ categoryId, kind, position, onCreated }: { categoryId: number; kind: 'drink' | 'food'; position: number; onCreated: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  async function create() {
    if (!name.trim()) return;
    const body: any = { categoryId, name: name.trim(), kind, position };
    if (kind === 'drink') {
      body.sizeLabels = ['Small', 'Regular', 'Large'];
      body.prices = ['0.00', '0.00', '0.00'];
      body.temps = 'ICED · FROZEN · HOT';
    }
    await api.post('/api/menu-items', body);
    setName('');
    setAdding(false);
    onCreated();
  }

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        style={{ background: 'none', border: '1px dashed rgba(0,0,0,0.15)', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: 'rgba(0,0,0,0.5)', marginTop: 8, width: '100%' }}
      >
        + Add {kind === 'drink' ? 'Drink' : 'Food Item'}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'drink' ? 'Drink name' : 'Food item name'} style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }} onKeyDown={(e) => e.key === 'Enter' && create()} autoFocus />
      <button className="btn btn-primary btn-sm" onClick={create}>Add</button>
      <button className="btn btn-secondary btn-sm" onClick={() => setAdding(false)}>×</button>
    </div>
  );
}

function AddListButton({ seasonId, side, position, onCreated }: { seasonId: number; side: string; position: number; onCreated: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  async function create() {
    if (!name.trim()) return;
    await api.post('/api/menu-lists', { seasonId, name: name.trim(), side, position });
    setName('');
    setAdding(false);
    onCreated();
  }

  if (!adding) {
    return <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)} style={{ marginTop: 8 }}>+ Add List</button>;
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="List name" style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }} onKeyDown={(e) => e.key === 'Enter' && create()} autoFocus />
      <button className="btn btn-primary btn-sm" onClick={create}>Add</button>
      <button className="btn btn-secondary btn-sm" onClick={() => setAdding(false)}>×</button>
    </div>
  );
}

// ─── List Editor ─────────────────────────────────────────────

function ListEditor({ list, onUpdate }: { list: MenuList; onUpdate: () => void }) {
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState(list.items.map((i) => i.name));
  const [newItem, setNewItem] = useState('');

  async function save() {
    await api.put(`/api/menu-lists/${list.id}`, {
      items: items.filter(Boolean).map((name, i) => ({ name, position: i })),
    });
    setEditing(false);
    onUpdate();
  }

  async function remove() {
    if (!confirm(`Delete list "${list.name}"?`)) return;
    await api.delete(`/api/menu-lists/${list.id}`);
    onUpdate();
  }

  return (
    <div style={{ marginBottom: 12, padding: '10px 14px', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: editing ? 8 : 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{list.name}</span>
        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>{list.items.length} items</span>
        <button className="btn btn-secondary btn-sm" onClick={() => { setItems(list.items.map((i) => i.name)); setEditing(!editing); }} style={{ fontSize: 11 }}>
          {editing ? 'Cancel' : 'Edit'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={remove} style={{ color: '#c0392b', fontSize: 11 }}>×</button>
      </div>
      {editing && (
        <div>
          {items.map((name, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <input
                value={name}
                onChange={(e) => setItems(items.map((n, j) => j === i ? e.target.value : n))}
                style={{ flex: 1, padding: '4px 8px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.12)', fontSize: 12 }}
              />
              <button onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(0,0,0,0.3)', fontSize: 14 }}>×</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="Add item"
              style={{ flex: 1, padding: '4px 8px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.12)', fontSize: 12 }}
              onKeyDown={(e) => { if (e.key === 'Enter' && newItem.trim()) { setItems([...items, newItem.trim()]); setNewItem(''); } }}
            />
            <button className="btn btn-primary btn-sm" onClick={save} style={{ fontSize: 11 }}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Export Dropdown ──────────────────────────────────────────

function ExportDropdown({ seasonId }: { seasonId: number }) {
  const [open, setOpen] = useState(false);

  function download(location: string) {
    window.open(`/api/menu-seasons/${seasonId}/pdf?location=${location}`, '_blank');
    setOpen(false);
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-primary btn-sm" onClick={() => setOpen(!open)}>
        Download PDF ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 4,
          background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 180,
          padding: 4,
        }}>
          {LOCATIONS_LIST.map((loc) => (
            <button
              key={loc.key}
              onClick={() => download(loc.key)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 12px', background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 13, borderRadius: 6,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <strong>{loc.key}</strong> — {loc.name} <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>({loc.format})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
