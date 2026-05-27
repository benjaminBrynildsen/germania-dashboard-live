import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { TEMP_LABEL, type Temperature } from '../lib/sop-types';
import SeasonYearPicker, { buildCollection, defaultCollection } from './MenuTeam/SeasonYearPicker';

type SopListItem = {
  id: number;
  slug: string;
  name: string;
  kind?: 'drink' | 'recipe';
  collection: string | null;
  dietaryTags: string | null;
  refrigerationNote: string | null;
  temperatures: Temperature[];
  updatedAt: number;
};

type DrinkTemplateMeta = {
  slug: string;
  name: string;
  description: string;
  temperatures: Temperature[];
};

export default function MenuTeam() {
  const navigate = useNavigate();
  const [sops, setSops] = useState<SopListItem[]>([]);
  const [collections, setCollections] = useState<Array<{ collection: string; count: number }>>([]);
  const [templates, setTemplates] = useState<DrinkTemplateMeta[]>([]);
  const [collectionFilter, setCollectionFilter] = useState<string>('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState<string>('');
  const [newKind, setNewKind] = useState<'drink' | 'recipe'>('drink');
  const [newCraftedBy, setNewCraftedBy] = useState<string>('');
  const [newCollection, setNewCollection] = useState<string | null>(() => {
    const d = defaultCollection();
    return buildCollection(d.season, d.year);
  });

  async function load() {
    setLoading(true);
    try {
      const [list, colls, tpls] = await Promise.all([
        api.get(`/api/sops${collectionFilter ? `?collection=${encodeURIComponent(collectionFilter)}` : ''}`),
        api.get('/api/sop-collections'),
        api.get('/api/sop-templates'),
      ]);
      setSops(list.sops);
      setCollections(colls.collections);
      setTemplates(tpls.templates);
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

  async function handleDuplicate(s: SopListItem) {
    try {
      const out = await api.post(`/api/sops/${s.id}/duplicate`);
      navigate(`/menu-team/${out.sop.slug}`);
    } catch (err: any) {
      alert(err.message || 'Failed to duplicate');
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const body: any = {
        name: newName.trim(),
        kind: newKind,
        craftedBy: newCraftedBy.trim() || null,
        collection: newCollection,
      };
      if (newKind === 'drink' && newTemplate) {
        // Server resolves the template into variants + rows; client just
        // forwards the slug.
        body.templateSlug = newTemplate;
      } else if (newKind === 'recipe') {
        // Recipes get a single section with one yield column to start.
        body.variants = [{ temperature: 'hot', position: 0, sizeLabels: ['1 Batch'], footnotes: [], rows: [] }];
      } else {
        // Drink empty starter: one iced variant, no rows.
        body.variants = [{ temperature: 'iced', position: 0, sizeLabels: ['Kids', 'R', 'L'], footnotes: [], rows: [] }];
      }
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
        <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: 'auto 2fr 1.5fr 1.5fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label>Kind</label>
            <select value={newKind} onChange={(e) => setNewKind(e.target.value as 'drink' | 'recipe')}>
              <option value="drink">Drink</option>
              <option value="recipe">Recipe / Add-on</option>
            </select>
          </div>
          <div>
            <label>{newKind === 'recipe' ? 'Recipe name' : 'New SOP name'}</label>
            <input
              type="text"
              placeholder={newKind === 'recipe' ? 'e.g. Lavender Cold Foam' : 'e.g. Vanilla Cloud Latte'}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div>
            <label>{newKind === 'recipe' ? 'Template' : 'Start from template'}</label>
            <select value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)} disabled={newKind === 'recipe'} title={templates.find((t) => t.slug === newTemplate)?.description || ''}>
              <option value="">— Empty —</option>
              {templates.map((t) => (
                <option key={t.slug} value={t.slug}>{t.name}</option>
              ))}
            </select>
            {newTemplate && newKind === 'drink' && (
              <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', marginTop: 4 }}>{templates.find((t) => t.slug === newTemplate)?.description}</p>
            )}
          </div>
          <div>
            <label>Season &amp; year</label>
            <SeasonYearPicker value={newCollection} onChange={setNewCollection} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={creating || !newName.trim()}>
            {creating ? 'Creating…' : newKind === 'recipe' ? '+ New Recipe' : '+ New SOP'}
          </button>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Crafted by (shown on the printed SOP)</label>
            <input
              type="text"
              placeholder="e.g. Ben &amp; the Menu Team"
              value={newCraftedBy}
              onChange={(e) => setNewCraftedBy(e.target.value)}
            />
          </div>
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
          {collectionFilter && <CollectionMetaEditor collection={collectionFilter} />}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {selectedCount > 0 && (
            <DownloadDropdown
              label={`Download (${selectedCount}) ▾`}
              packetUrl={`/api/sops/packet.pdf?ids=${Array.from(selected).join(',')}`}
              zipUrl={`/api/sops/packet.zip?ids=${Array.from(selected).join(',')}`}
              bundleUrl={bundleUrl()}
            />
          )}
          {collectionFilter && (
            <DownloadDropdown
              label={`Download "${collectionFilter}" ▾`}
              packetUrl={`/api/sops/packet.pdf?collection=${encodeURIComponent(collectionFilter)}`}
              zipUrl={`/api/sops/packet.zip?collection=${encodeURIComponent(collectionFilter)}`}
              bundleUrl={`/api/sops/bundle.pdf?collection=${encodeURIComponent(collectionFilter)}`}
            />
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
                    {s.kind === 'recipe' && (
                      <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', background: 'rgba(0,0,0,0.07)', borderRadius: 4, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Recipe</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 14px', color: 'rgba(0,0,0,0.6)', fontSize: 13 }}>{s.collection || '—'}</td>
                  <td style={{ padding: '12px 14px' }}>
                    {s.kind === 'recipe' ? <span style={{ color: 'rgba(0,0,0,0.3)', fontSize: 12 }}>—</span> : s.temperatures.length === 0 ? <span style={{ color: 'rgba(0,0,0,0.3)', fontSize: 12 }}>none</span> : s.temperatures.map((t) => (
                      <span key={t} style={{ display: 'inline-block', padding: '2px 8px', marginRight: 4, fontSize: 11, borderRadius: 4, background: tempColor(t), color: '#3a2f25' }}>{TEMP_LABEL[t]}</span>
                    ))}
                  </td>
                  <td style={{ padding: '12px 14px', color: 'rgba(0,0,0,0.6)', fontSize: 13 }}>{s.dietaryTags || '—'}</td>
                  <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                    <a href={`/api/sops/${s.slug}/pdf`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ marginRight: 6 }}>PDF</a>
                    <button onClick={() => handleDuplicate(s)} className="btn btn-secondary btn-sm" style={{ marginRight: 6 }}>Duplicate</button>
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

function DownloadDropdown({ label, packetUrl, zipUrl, bundleUrl }: { label: string; packetUrl: string; zipUrl: string; bundleUrl: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="btn btn-primary" onClick={() => setOpen((o) => !o)}>{label}</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
          <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, minWidth: 280, background: '#fff', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 10, padding: 4, zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.10)' }}>
            <a href={zipUrl} onClick={() => setOpen(false)} style={menuItemStyle}>
              <div style={{ fontWeight: 600 }}>Packet + individuals (ZIP)</div>
              <div style={menuItemHint}>Cover + dividers + all SOPs as one PDF, plus each drink as its own PDF.</div>
            </a>
            <a href={packetUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} style={menuItemStyle}>
              <div style={{ fontWeight: 600 }}>Launch packet only (PDF)</div>
              <div style={menuItemHint}>Single PDF: cover + dividers + all SOPs.</div>
            </a>
            <a href={bundleUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} style={menuItemStyle}>
              <div style={{ fontWeight: 600 }}>Bundle SOPs only (PDF)</div>
              <div style={menuItemHint}>SOPs concatenated, no cover or dividers.</div>
            </a>
          </div>
        </>
      )}
    </div>
  );
}

const menuItemStyle: React.CSSProperties = { display: 'block', padding: '10px 12px', textDecoration: 'none', color: '#1a1a1a', fontSize: 13, borderRadius: 6 };
const menuItemHint: React.CSSProperties = { fontSize: 11, color: 'rgba(0,0,0,0.5)', marginTop: 2 };

type TransitionItem = { name: string; tag: string };

function parseTransitionNote(note: string): { leaving: TransitionItem[]; coming: TransitionItem[] } {
  const leaving: TransitionItem[] = [];
  const coming: TransitionItem[] = [];
  const lines = note.split('\n').map((l) => l.trim()).filter(Boolean);

  let currentList: TransitionItem[] | null = null;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('leaving')) {
      currentList = leaving;
      const rest = line.replace(/^leaving[:\s]*/i, '').trim();
      if (rest) parseItemsInto(rest, leaving);
      continue;
    }
    if (lower.startsWith('coming in') || lower.startsWith('coming:')) {
      currentList = coming;
      const rest = line.replace(/^coming\s*in?[:\s]*/i, '').trim();
      if (rest) parseItemsInto(rest, coming);
      continue;
    }
    if (currentList) parseItemsInto(line, currentList);
  }
  return { leaving, coming };
}

function parseItemsInto(text: string, out: TransitionItem[]) {
  const parts = text.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(.+?)\s*[(\|]\s*(.+?)\s*\)?$/);
    if (m) {
      out.push({ name: m[1].trim(), tag: m[2].trim() });
    } else if (part) {
      out.push({ name: part, tag: '' });
    }
  }
}

function serializeTransitionNote(leaving: TransitionItem[], coming: TransitionItem[]): string {
  const parts: string[] = [];
  if (leaving.length > 0) {
    const items = leaving.map((it) => it.tag ? `${it.name} (${it.tag})` : it.name).join(', ');
    parts.push(`Leaving:\n${items}`);
  }
  if (coming.length > 0) {
    const items = coming.map((it) => it.tag ? `${it.name} (${it.tag})` : it.name).join(', ');
    parts.push(`Coming in:\n${items}`);
  }
  return parts.join('\n');
}

function CollectionMetaEditor({ collection }: { collection: string }) {
  const [meta, setMeta] = useState<{ transitionNote: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [rawDraft, setRawDraft] = useState('');
  const [leaving, setLeaving] = useState<TransitionItem[]>([]);
  const [coming, setComing] = useState<TransitionItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/api/sop-collections/${encodeURIComponent(collection)}/meta`).then((r) => {
      setMeta(r.meta);
      const note = r.meta.transitionNote || '';
      setRawDraft(note);
      const parsed = parseTransitionNote(note);
      setLeaving(parsed.leaving);
      setComing(parsed.coming);
    });
  }, [collection]);

  function openEditor() {
    const note = meta?.transitionNote || '';
    setRawDraft(note);
    const parsed = parseTransitionNote(note);
    setLeaving(parsed.leaving);
    setComing(parsed.coming);
    setTextMode(false);
    setEditing(true);
  }

  function switchToText() {
    setRawDraft(serializeTransitionNote(leaving, coming));
    setTextMode(true);
  }

  function switchToStructured() {
    const parsed = parseTransitionNote(rawDraft);
    setLeaving(parsed.leaving);
    setComing(parsed.coming);
    setTextMode(false);
  }

  async function save() {
    setSaving(true);
    try {
      const note = textMode ? rawDraft : serializeTransitionNote(leaving, coming);
      await api.put(`/api/sop-collections/${encodeURIComponent(collection)}/meta`, { transitionNote: note || null });
      setMeta({ transitionNote: note || null });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function updateItem(list: TransitionItem[], setList: React.Dispatch<React.SetStateAction<TransitionItem[]>>, idx: number, field: 'name' | 'tag', value: string) {
    setList(list.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  }

  function removeItem(list: TransitionItem[], setList: React.Dispatch<React.SetStateAction<TransitionItem[]>>, idx: number) {
    setList(list.filter((_, i) => i !== idx));
  }

  function addItem(setList: React.Dispatch<React.SetStateAction<TransitionItem[]>>) {
    setList((prev) => [...prev, { name: '', tag: '' }]);
  }

  if (!editing) {
    return (
      <button type="button" className="btn btn-secondary btn-sm" onClick={openEditor} title="Edit cover transition note">
        {meta?.transitionNote ? 'Edit transition note' : '+ Transition note'}
      </button>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }} onClick={() => setEditing(false)}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 680, maxWidth: '95vw', maxHeight: '85vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Bottles &amp; Inventory -- Transition Note</h3>
          <button
            type="button"
            onClick={() => textMode ? switchToStructured() : switchToText()}
            style={{ background: 'none', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: 'rgba(0,0,0,0.55)' }}
          >
            {textMode ? 'Structured editor' : 'Edit as text'}
          </button>
        </div>

        {textMode ? (
          <textarea
            value={rawDraft}
            onChange={(e) => setRawDraft(e.target.value)}
            rows={8}
            style={{ width: '100%', fontSize: 13, fontFamily: 'monospace', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', padding: 12, resize: 'vertical' }}
            placeholder={'Leaving:\nPeppermint syrup (winter rotation)\nComing in:\nHaus Ube syrup (new -- ambient)'}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {/* Leaving column */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 16 }}>{'<-'}</span>
                <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#c0392b' }}>Leaving</span>
              </div>
              {leaving.length === 0 && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '8px 0' }}>No items</div>
              )}
              {leaving.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => updateItem(leaving, setLeaving, i, 'name', e.target.value)}
                    placeholder="Item name"
                    style={{ flex: 2, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)' }}
                  />
                  <input
                    type="text"
                    value={item.tag}
                    onChange={(e) => updateItem(leaving, setLeaving, i, 'tag', e.target.value)}
                    placeholder="Tag"
                    style={{ flex: 1, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', color: 'rgba(0,0,0,0.6)' }}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(leaving, setLeaving, i)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(0,0,0,0.3)', fontSize: 16, padding: '2px 6px', lineHeight: 1 }}
                    title="Remove"
                  >
                    x
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addItem(setLeaving)}
                style={{ background: 'none', border: '1px dashed rgba(0,0,0,0.2)', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer', color: 'rgba(0,0,0,0.5)', marginTop: 4, width: '100%' }}
              >
                + Add
              </button>
            </div>

            {/* Coming In column */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 16 }}>{'->'}</span>
                <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#27ae60' }}>Coming In</span>
              </div>
              {coming.length === 0 && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '8px 0' }}>No items</div>
              )}
              {coming.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => updateItem(coming, setComing, i, 'name', e.target.value)}
                    placeholder="Item name"
                    style={{ flex: 2, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)' }}
                  />
                  <input
                    type="text"
                    value={item.tag}
                    onChange={(e) => updateItem(coming, setComing, i, 'tag', e.target.value)}
                    placeholder="Tag"
                    style={{ flex: 1, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)', color: 'rgba(0,0,0,0.6)' }}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(coming, setComing, i)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(0,0,0,0.3)', fontSize: 16, padding: '2px 6px', lineHeight: 1 }}
                    title="Remove"
                  >
                    x
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addItem(setComing)}
                style={{ background: 'none', border: '1px dashed rgba(0,0,0,0.2)', borderRadius: 6, padding: '5px 12px', fontSize: 11, cursor: 'pointer', color: 'rgba(0,0,0,0.5)', marginTop: 4, width: '100%' }}
              >
                + Add
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
