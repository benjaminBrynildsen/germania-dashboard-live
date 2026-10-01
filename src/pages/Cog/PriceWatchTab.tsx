import { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useCanEdit, inputStyle, labelStyle } from './ui';

// Price Watch — an AI shopper that compares the staples we buy retail
// (milks, cream, eggs…) across Schnucks / Walmart / Costco and flags
// who's cheapest right now. "Check" runs the agent (Claude + web
// search) server-side; any cell can also be typed in by hand after a
// store run. Quotes age visibly so nobody trusts last month's number.

interface Quote {
  id: number;
  store: string;
  product: string | null;
  package_size: string | null;
  price: number | null;
  unit_price: number | null;
  unit: string | null;
  url: string | null;
  confidence: string | null;
  note: string | null;
  source: string;
  fetched_at: string;
}

interface Item {
  id: number;
  name: string;
  query: string;
  quotes: Record<string, Quote | null>;
  cheapest_store: string | null;
}

interface WatchData {
  agent_available: boolean;
  stores: string[];
  items: Item[];
}

function age(ts: string): { label: string; stale: boolean } {
  const t = new Date(ts.replace(' ', 'T') + (ts.includes('Z') || ts.includes('+') ? '' : 'Z')).getTime();
  const hrs = (Date.now() - t) / 3_600_000;
  if (!Number.isFinite(hrs)) return { label: '', stale: false };
  if (hrs < 1) return { label: 'just now', stale: false };
  if (hrs < 24) return { label: `${Math.round(hrs)}h ago`, stale: false };
  const days = Math.round(hrs / 24);
  return { label: `${days}d ago`, stale: days > 7 };
}

export default function PriceWatchTab() {
  const isMobile = useIsMobile();
  const canEdit = useCanEdit();
  const [data, setData] = useState<WatchData | null>(null);
  const [checking, setChecking] = useState<Set<number>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQuery, setNewQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await api.get('/api/cog/price-watch')); }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const checkOne = async (id: number) => {
    setChecking((s) => new Set(s).add(id));
    setError(null);
    try {
      const r = await api.post(`/api/cog/price-watch/items/${id}/check`, {});
      setData({ agent_available: r.agent_available, stores: r.stores, items: r.items });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setChecking((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };

  const checkAll = async () => {
    if (!data) return;
    setCheckingAll(true);
    for (const it of data.items) {
      await checkOne(it.id);
    }
    setCheckingAll(false);
  };

  const manualEntry = async (item: Item, store: string) => {
    const current = item.quotes[store];
    const v = window.prompt(
      `${item.name} @ ${store} — enter the shelf price in $ (blank to cancel):`,
      current?.price != null ? String(current.price) : '',
    );
    if (v == null || v.trim() === '') return;
    const p = parseFloat(v.replace(/[$,]/g, ''));
    if (!Number.isFinite(p)) { alert('Not a number'); return; }
    try {
      const r = await api.post(`/api/cog/price-watch/items/${item.id}/manual`, { store, price: p });
      setData({ agent_available: r.agent_available, stores: r.stores, items: r.items });
    } catch (e: any) { alert(`Save failed: ${e.message}`); }
  };

  const addItem = async () => {
    if (!newName.trim()) return;
    try {
      await api.post('/api/cog/price-watch/items', { name: newName.trim(), query: newQuery.trim() || newName.trim() });
      setNewName(''); setNewQuery(''); setAdding(false);
      load();
    } catch (e: any) { alert(`Add failed: ${e.message}`); }
  };

  const removeItem = async (it: Item) => {
    if (!confirm(`Stop watching "${it.name}"? Its price history goes too.`)) return;
    try { await api.delete(`/api/cog/price-watch/items/${it.id}`); load(); }
    catch (e: any) { alert(`Delete failed: ${e.message}`); }
  };

  if (!data) return <div style={{ color: 'rgba(0,0,0,0.3)', padding: 40 }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13, maxWidth: 560 }}>
          Retail staples compared across {data.stores.join(' / ')} — the cheapest current price is highlighted.
          The AI shopper checks store sites daily at 5:10 AM and on demand; click any cell to type in a shelf price you saw yourself.
        </p>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setAdding(true)}>+ Watch an item</button>
            <button className="btn btn-primary" onClick={checkAll} disabled={checkingAll || !data.agent_available}>
              {checkingAll ? 'Checking…' : '⟳ Check all now'}
            </button>
          </div>
        )}
      </div>

      {!data.agent_available && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13,
          background: 'rgba(202,138,4,0.10)', border: '1px solid rgba(202,138,4,0.3)', color: '#854d0e',
        }}>
          <strong>Automatic checks are off:</strong> the server has no <code>ANTHROPIC_API_KEY</code>.
          Add one in Render → Environment to turn on the AI shopper. Manual price entry (click a cell) works either way.
        </div>
      )}
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 13, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#b91c1c' }}>
          {error}
        </div>
      )}

      {adding && canEdit && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px' }}>
              <label style={labelStyle}>Name</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} style={inputStyle} placeholder="2% Milk (gallon)" autoFocus />
            </div>
            <div style={{ flex: '2 1 240px' }}>
              <label style={labelStyle}>What to search for (brand/size helps)</label>
              <input value={newQuery} onChange={(e) => setNewQuery(e.target.value)} style={inputStyle} placeholder="2% reduced fat milk 1 gallon" />
            </div>
            <button className="btn btn-primary btn-sm" onClick={addItem} disabled={!newName.trim()} style={{ marginBottom: 2 }}>Add</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setAdding(false)} style={{ marginBottom: 2 }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto', padding: isMobile ? 8 : undefined }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 680 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: 'rgba(0,0,0,0.4)' }}>Item</th>
              {data.stores.map((s) => (
                <th key={s} style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 600, color: 'rgba(0,0,0,0.4)' }}>{s}</th>
              ))}
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {it.name}
                  <div style={{ fontSize: 10.5, color: 'rgba(0,0,0,0.35)', fontWeight: 400, maxWidth: 180, whiteSpace: 'normal' }}>{it.query}</div>
                </td>
                {data.stores.map((s) => {
                  const q = it.quotes[s];
                  const best = it.cheapest_store === s;
                  const a = q ? age(q.fetched_at) : null;
                  return (
                    <td key={s}
                      onClick={canEdit ? () => manualEntry(it, s) : undefined}
                      title={q ? [q.product, q.package_size, q.note, q.source === 'manual' ? 'entered by hand' : `agent (${q.confidence ?? '?'} confidence)`].filter(Boolean).join(' · ') : 'Click to enter a price'}
                      style={{
                        padding: '10px 12px', textAlign: 'center', cursor: canEdit ? 'pointer' : undefined,
                        background: best ? 'rgba(34,197,94,0.10)' : undefined,
                        borderLeft: '1px solid rgba(0,0,0,0.04)',
                      }}>
                      {q && q.price != null ? (
                        <>
                          <div style={{ fontWeight: 700, fontSize: 15, color: best ? '#15803d' : '#1a1a1a' }}>
                            ${q.price.toFixed(2)}{best && ' ✓'}
                          </div>
                          <div style={{ fontSize: 10.5, color: 'rgba(0,0,0,0.4)' }}>
                            {q.package_size ?? ''}{q.unit_price != null ? ` · $${q.unit_price.toFixed(3)}/${q.unit ?? 'oz'}` : ''}
                          </div>
                          <div style={{ fontSize: 10, color: a?.stale ? '#b45309' : 'rgba(0,0,0,0.3)' }}>
                            {q.source === 'manual' ? '✍ ' : ''}{a?.label}{a?.stale ? ' — stale' : ''}
                          </div>
                        </>
                      ) : q ? (
                        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)' }} title={q.note ?? ''}>not found<br />{a?.label}</div>
                      ) : (
                        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.25)' }}>—</div>
                      )}
                    </td>
                  );
                })}
                {canEdit && (
                  <td style={{ padding: '10px 8px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => checkOne(it.id)}
                      disabled={checking.has(it.id) || !data.agent_available}
                      title={data.agent_available ? 'Ask the AI shopper to re-check this item now' : 'Needs ANTHROPIC_API_KEY on the server'}
                      style={{ marginRight: 6 }}>
                      {checking.has(it.id) ? '…' : '⟳'}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => removeItem(it)} aria-label={`Stop watching ${it.name}`}>🗑</button>
                  </td>
                )}
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><td colSpan={data.stores.length + 2} style={{ padding: 30, textAlign: 'center', color: 'rgba(0,0,0,0.3)' }}>
                Nothing watched yet — add the staples you buy retail.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11.5, color: 'rgba(0,0,0,0.35)', marginTop: 10, lineHeight: 1.5 }}>
        Agent prices come from store websites and can lag the shelf (Costco warehouse prices especially; delivery-service
        prices are marked up and avoided where possible). Hover a price for what was actually quoted; the ✍ mark means
        someone typed it in from the store. Treat it as "who to check first," and click a cell to correct it from the aisle.
      </p>
    </div>
  );
}
