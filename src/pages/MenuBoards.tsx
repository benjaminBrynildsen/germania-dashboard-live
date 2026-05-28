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

const SEASON_OPTIONS = ['Spring', 'Summer', 'Fall', 'Winter'];
const YEAR_OPTIONS = [2025, 2026, 2027, 2028];

function SeasonList() {
  const [seasons, setSeasons] = useState<Array<{ id: number; name: string; itemCount: number }>>([]);
  const [seasonPick, setSeasonPick] = useState('Summer');
  const [yearPick, setYearPick] = useState(2026);
  const [copyFrom, setCopyFrom] = useState<number | ''>('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/menu-seasons').then((r) => setSeasons(r.seasons));
  }, []);

  const newName = `${seasonPick} ${yearPick}`;
  const alreadyExists = seasons.some((s) => s.name === newName);

  async function create() {
    if (alreadyExists) return;
    setCreating(true);
    try {
      const r = await api.post('/api/menu-seasons', {
        name: newName,
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
        <select value={seasonPick} onChange={(e) => setSeasonPick(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', fontSize: 14 }}>
          {SEASON_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={yearPick} onChange={(e) => setYearPick(Number(e.target.value))} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', fontSize: 14 }}>
          {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {seasons.length > 0 && (
          <select
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value ? Number(e.target.value) : '')}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }}
          >
            <option value="">Start with defaults</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>Copy from {s.name}</option>
            ))}
          </select>
        )}
        <button className="btn btn-primary" onClick={create} disabled={creating || alreadyExists}>
          {alreadyExists ? `${newName} exists` : creating ? 'Creating...' : `+ ${newName}`}
        </button>
      </div>

      {seasons.length === 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ color: 'rgba(0,0,0,0.5)', marginBottom: 8 }}>No menu seasons yet. Create one above, or seed demo data:</p>
          <button className="btn btn-secondary btn-sm" onClick={async () => {
            await api.post('/api/menu-seasons/seed-winter-2025');
            api.get('/api/menu-seasons').then((r) => setSeasons(r.seasons));
          }}>Seed Winter 2025 Demo</button>
        </div>
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
        <SeasonNameEditor season={season} onRenamed={reload} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <ImportFromSops seasonId={seasonId} onImported={reload} />
          {season.name.toLowerCase().includes('summer') && season.name.includes('2026') && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                const r = await api.post('/api/menu-seasons/apply-summer-2026-descriptions', {});
                alert(`Updated ${r.updated.length} drinks.\n\nNot found: ${r.not_found_patterns.join(', ') || 'none'}\n\nDrinks in season:\n${r.all_drinks_in_season.join('\n')}`);
                reload();
              }}
            >
              Apply S26 Descriptions
            </button>
          )}
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

function SeasonNameEditor({ season, onRenamed }: { season: MenuSeason; onRenamed: () => void }) {
  const [editing, setEditing] = useState(false);
  const parsed = parseSeasonName(season.name);
  const [seasonPick, setSeasonPick] = useState(parsed.season);
  const [yearPick, setYearPick] = useState(parsed.year);

  async function save() {
    const newName = `${seasonPick} ${yearPick}`;
    if (newName === season.name) { setEditing(false); return; }
    await api.put(`/api/menu-seasons/${season.id}`, { name: newName });
    setEditing(false);
    onRenamed();
  }

  if (!editing) {
    return (
      <h2 style={{ margin: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => setEditing(true)}>
        {season.name}
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', fontWeight: 400 }}>(click to rename)</span>
      </h2>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <select value={seasonPick} onChange={(e) => setSeasonPick(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 14 }}>
        {['Spring', 'Summer', 'Fall', 'Winter'].map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={yearPick} onChange={(e) => setYearPick(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 14 }}>
        {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
      <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
    </div>
  );
}

function parseSeasonName(name: string): { season: string; year: number } {
  const m = name.match(/^(Spring|Summer|Fall|Winter)\s+(\d{4})$/i);
  if (m) return { season: m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase(), year: Number(m[2]) };
  return { season: 'Summer', year: 2026 };
}

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
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Sizes & Prices</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {Array.from({ length: Math.max((form.sizeLabels || []).length, (form.prices || []).length, 3) }).map((_, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <input
                    value={(form.sizeLabels || [])[i] || ''}
                    onChange={(e) => {
                      const next = [...(form.sizeLabels || [])];
                      next[i] = e.target.value;
                      set('sizeLabels', next);
                    }}
                    placeholder={['Small','Regular','Large'][i] || 'Size'}
                    style={{ width: '100%', padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 12, textAlign: 'center' }}
                  />
                  <input
                    value={(form.prices || [])[i] || ''}
                    onChange={(e) => {
                      const next = [...(form.prices || [])];
                      next[i] = e.target.value;
                      set('prices', next);
                    }}
                    placeholder="0.00"
                    style={{ width: '100%', padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 12, textAlign: 'center' }}
                  />
                </div>
              ))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={() => { set('sizeLabels', [...(form.sizeLabels || []), '']); set('prices', [...(form.prices || []), '']); }}
                  style={{ background: 'none', border: '1px dashed rgba(0,0,0,0.15)', borderRadius: 4, padding: '2px 8px', fontSize: 14, cursor: 'pointer', color: 'rgba(0,0,0,0.5)' }}
                  title="Add column"
                >+</button>
                {(form.sizeLabels || []).length > 1 && (
                  <button
                    type="button"
                    onClick={() => { set('sizeLabels', (form.sizeLabels || []).slice(0, -1)); set('prices', (form.prices || []).slice(0, -1)); }}
                    style={{ background: 'none', border: '1px dashed rgba(0,0,0,0.15)', borderRadius: 4, padding: '2px 8px', fontSize: 14, cursor: 'pointer', color: 'rgba(0,0,0,0.5)' }}
                    title="Remove last column"
                  >−</button>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: 8 }}>
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
  const [price, setPrice] = useState('');

  async function create() {
    if (!name.trim()) return;
    const body: any = { categoryId, name: name.trim(), kind, position };
    if (kind === 'drink') {
      body.sizeLabels = ['Small', 'Regular', 'Large'];
      body.prices = ['0.00', '0.00', '0.00'];
      body.temps = 'ICED · FROZEN · HOT';
    } else {
      body.foodPrice = price.trim() || '0.00';
    }
    await api.post('/api/menu-items', body);
    setName('');
    setPrice('');
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
      {kind === 'food' && (
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price" style={{ width: 80, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }} onKeyDown={(e) => e.key === 'Enter' && create()} />
      )}
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

  async function flipSide() {
    const newSide = list.side === 'front' ? 'back' : 'front';
    await api.put(`/api/menu-lists/${list.id}`, { side: newSide });
    onUpdate();
  }

  return (
    <div style={{ marginBottom: 12, padding: '10px 14px', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: editing ? 8 : 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{list.name}</span>
        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>{list.items.length} items</span>
        <button className="btn btn-secondary btn-sm" onClick={flipSide} style={{ fontSize: 11 }} title={`Move to ${list.side === 'front' ? 'back' : 'front'}`}>
          → {list.side === 'front' ? 'Back' : 'Front'}
        </button>
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

// ─── Import from SOPs ────────────────────────────────────────

function ImportFromSops({ seasonId, onImported }: { seasonId: number; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [sops, setSops] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [importing, setImporting] = useState(false);

  function openModal() {
    setOpen(true);
    api.get(`/api/menu-seasons/${seasonId}/available-sops`).then((r) => setSops(r.sops));
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll(filtered: any[]) {
    setSelected(new Set(filtered.filter((s) => !s.alreadyImported).map((s) => s.id)));
  }

  async function doImport() {
    setImporting(true);
    try {
      await api.post(`/api/menu-seasons/${seasonId}/import-sops`, { sopIds: [...selected] });
      setOpen(false);
      setSelected(new Set());
      onImported();
    } finally {
      setImporting(false);
    }
  }

  const [collectionFilter, setCollectionFilter] = useState('');

  const filtered = sops.filter((s) => {
    if (collectionFilter && s.collection !== collectionFilter) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.category || '').toLowerCase().includes(q);
  });

  const collections = [...new Set(sops.map((s) => s.collection).filter(Boolean))];

  if (!open) {
    return (
      <button className="btn btn-secondary btn-sm" onClick={openModal}>
        Import from SOPs
      </button>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }} onClick={() => setOpen(false)}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 700, maxWidth: '95vw', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Import Drinks from Menu Team SOPs</h3>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }}>
            <option value="">All seasons</option>
            {collections.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search drinks..."
            style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', fontSize: 13 }}
          />
          <button className="btn btn-secondary btn-sm" onClick={() => selectAll(filtered)} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>Select all</button>
        </div>

        <div style={{ maxHeight: 400, overflow: 'auto', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8 }}>
          {(() => {
            const catLabels: Record<string, string> = { sweet: 'Sweet Coffee (Front)', bridge: 'Bridge Coffee (Front)', artisanal: 'Artisanal Coffee (Front)', tsm: 'Tea, Smoothies & More (Back)' };
            const catOrder = ['sweet', 'bridge', 'artisanal', 'tsm', ''];
            const grouped = new Map<string, any[]>();
            for (const sop of filtered) {
              const key = sop.category || '';
              const arr = grouped.get(key) ?? [];
              arr.push(sop);
              grouped.set(key, arr);
            }
            const sortedKeys = [...grouped.keys()].sort((a, b) => catOrder.indexOf(a || '') - catOrder.indexOf(b || ''));
            return sortedKeys.map((catKey) => (
              <div key={catKey}>
                <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.04)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'rgba(0,0,0,0.5)', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                  {catLabels[catKey] || 'Uncategorized → Sweet Coffee'}
                </div>
                {(grouped.get(catKey) ?? []).map((sop: any) => (
                  <label
                    key={sop.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                      borderBottom: '1px solid rgba(0,0,0,0.05)', cursor: sop.alreadyImported ? 'default' : 'pointer',
                      opacity: sop.alreadyImported ? 0.4 : 1,
                    }}
                  >
                    <input type="checkbox" checked={selected.has(sop.id)} onChange={() => toggle(sop.id)} disabled={sop.alreadyImported} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{sop.name}</span>
                      {sop.alreadyImported && <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginLeft: 8 }}>already imported</span>}
                    </div>
                    <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)' }}>{sop.temps}</span>
                    <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{sop.collection}</span>
                  </label>
                ))}
              </div>
            ));
          })()}
          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>No SOPs found</div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
            {selected.size} selected — will import with default prices, auto-mapped to categories
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={doImport} disabled={importing || selected.size === 0}>
              {importing ? 'Importing...' : `Import ${selected.size} drink${selected.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Export Dropdown ──────────────────────────────────────────

function ExportDropdown({ seasonId }: { seasonId: number }) {
  const [open, setOpen] = useState(false);

  function download(location: string) {
    window.open(`/api/menu-seasons/${seasonId}/pdf?location=${location}&t=${Date.now()}`, '_blank');
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
