import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

interface OrderRow {
  weekStartIso: string;
  storeLabel: string;
  itemName: string;
  weeklyQty: number;
  notes: string | null;
  delivery: { mon: number; wed: number; fri: number };
}

interface WeekReport {
  weekStartIso: string;
  savedAtByStore: Record<string, number | null>;
  byStore: Record<string, OrderRow[]>;
  deliverySummary: {
    mon: Record<string, Record<string, number>>;
    wed: Record<string, Record<string, number>>;
    fri: Record<string, Record<string, number>>;
  };
}

interface CatalogItem { name: string; sort: number; imageUrl?: string | null }

/** Per-store city labels shown next to the G1/G2/G3/G4 code. */
const STORE_CITIES: Record<string, string> = {
  G1: 'Alton',
  G2: 'Godfrey',
  G3: 'East Gate',
  G4: 'Jerseyville',
};

interface SavedOrder {
  weekStartIso: string;
  storeLabel: string;
  savedAt: number;
  savedBy: string | null;
  itemCount: number;
  totalQty: number;
}

type Tab = 'current' | 'saved';

function fmtDateRange(weekStartIso: string): string {
  const start = new Date(weekStartIso + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `Mon ${fmt(start)} – Sun ${fmt(end)}`;
}

function isoMondayOf(d: Date): string {
  const local = new Date(d);
  const day = local.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  local.setDate(local.getDate() + diff);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, '0');
  const dd = String(local.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function shiftWeeks(weekIso: string, weeks: number): string {
  const d = new Date(weekIso + 'T00:00:00');
  d.setDate(d.getDate() + weeks * 7);
  return isoMondayOf(d);
}

export default function BakeHaus() {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('current');
  const [weekIso, setWeekIso] = useState<string>(isoMondayOf(new Date()));
  const [report, setReport] = useState<WeekReport | null>(null);
  const [stores, setStores] = useState<string[]>(['G1', 'G2', 'G3', 'G4']);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [savedOrders, setSavedOrders] = useState<SavedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-store saving state so multiple cards could save in parallel.
  const [savingStores, setSavingStores] = useState<Set<string>>(new Set());
  const [activeStore, setActiveStore] = useState<string>('G1');

  const loadWeek = useCallback(async (iso: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/bake-haus/week?week=${iso}`, { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || body.error || 'Failed to load week');
      setReport(body.report);
      if (Array.isArray(body.stores)) setStores(body.stores);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/bake-haus/catalog', { cache: 'no-store' });
        const body = await r.json();
        if (!cancelled && r.ok) setCatalog(body.items ?? []);
      } catch {/* non-fatal */}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { loadWeek(weekIso); }, [weekIso, loadWeek]);

  const loadSavedOrders = useCallback(async () => {
    try {
      const r = await fetch('/api/bake-haus/saved', { cache: 'no-store' });
      const body = await r.json();
      if (r.ok) setSavedOrders(body.orders ?? []);
    } catch {/* non-fatal */}
  }, []);

  useEffect(() => {
    if (tab === 'saved') loadSavedOrders();
  }, [tab, loadSavedOrders]);

  const saveStore = async (store: string) => {
    setSavingStores((prev) => new Set(prev).add(store));
    setError(null);
    try {
      const r = await fetch('/api/bake-haus/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ week: weekIso, store }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || body.error || 'Save failed');
      }
      await loadWeek(weekIso);
      await loadSavedOrders();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSavingStores((prev) => {
        const next = new Set(prev);
        next.delete(store);
        return next;
      });
    }
  };

  const saveItem = async (store: string, item: string, weeklyQty: number) => {
    try {
      const r = await fetch('/api/bake-haus/item', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ week: weekIso, store, item, weeklyQty }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || body.error || 'Save failed');
      }
      await loadWeek(weekIso);
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  const deleteItem = async (store: string, item: string) => {
    try {
      const r = await fetch('/api/bake-haus/item', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ week: weekIso, store, item }),
      });
      if (!r.ok) throw new Error('delete_failed');
      await loadWeek(weekIso);
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Bake Haus</h1>
        <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
          Weekly food orders to Chef Maggie, auto-split into the three Mon/Wed/Fri deliveries
          (3–5pm). Each delivery gets a share weighted by how many days it covers
          — 2/7 for Mon and Wed, 3/7 for Fri (covers the weekend). Syrups + sauces
          are tracked separately on the chef's prep schedule.
        </p>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 22,
        borderBottom: '1px solid rgba(0,0,0,0.08)',
      }}>
        {([
          { id: 'current', label: 'Current Order' },
          { id: 'saved', label: 'Saved Orders' },
        ] as Array<{ id: Tab; label: string }>).map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '10px 18px',
                background: 'transparent',
                border: 0,
                borderBottom: `2px solid ${active ? '#1a1a1a' : 'transparent'}`,
                color: active ? '#1a1a1a' : 'rgba(0,0,0,0.45)',
                fontSize: 13, fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                marginBottom: -1,
              }}>{t.label}</button>
          );
        })}
      </div>

      {error && (
        <div style={{
          background: '#fee2e2', color: '#b91c1c', padding: '10px 14px',
          borderRadius: 8, marginBottom: 14, fontSize: 13,
        }}>{error}</div>
      )}

      {tab === 'current' && (
        <>
          {/* Week selector */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 18,
          }}>
            <button onClick={() => setWeekIso(shiftWeeks(weekIso, -1))}
              style={pillBtn}>‹ Prev wk</button>
            <button onClick={() => setWeekIso(isoMondayOf(new Date()))}
              style={pillBtn}>This week</button>
            <button onClick={() => setWeekIso(shiftWeeks(weekIso, 1))}
              style={pillBtn}>Next wk ›</button>
            <span style={{
              marginLeft: 12, fontSize: 13, color: 'rgba(0,0,0,0.7)', fontWeight: 600,
            }}>{fmtDateRange(weekIso)}</span>
          </div>

          {loading && !report && (
            <div style={{ color: 'rgba(0,0,0,0.4)', padding: 24 }}>Loading…</div>
          )}

          {report && (
            <>
              {/* Store selector — pills colored by house theme so the
                  currently-selected store is unmistakable. */}
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18,
              }}>
                {stores.map((store) => {
                  const theme = getTheme(store);
                  const on = activeStore === store;
                  const city = STORE_CITIES[store];
                  return (
                    <button key={store} onClick={() => setActiveStore(store)}
                      style={{
                        padding: '10px 18px', borderRadius: 12,
                        border: on ? `2px solid ${theme.headerBg}` : '1px solid rgba(0,0,0,0.12)',
                        background: on ? theme.headerBg : '#fff',
                        color: on ? theme.headerFg : 'rgba(0,0,0,0.6)',
                        fontSize: 13, fontWeight: 700, letterSpacing: 0.3,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}>
                      {store}{city && (<>
                        <span style={{
                          marginLeft: 6, fontWeight: 500, opacity: on ? 0.85 : 0.55,
                          textTransform: 'uppercase', fontSize: 11,
                        }}>· {city}</span>
                      </>)}
                    </button>
                  );
                })}
              </div>

              {/* Single full-width store order card */}
              <div style={{ marginBottom: 32 }}>
                <StoreOrderCard
                  store={activeStore}
                  rows={report.byStore[activeStore] ?? []}
                  catalog={catalog}
                  savedAt={report.savedAtByStore[activeStore] ?? null}
                  saving={savingStores.has(activeStore)}
                  isMobile={isMobile}
                  onSaveOrder={() => saveStore(activeStore)}
                  onSave={(item, qty) => saveItem(activeStore, item, qty)}
                  onDelete={(item) => deleteItem(activeStore, item)}
                />
              </div>

              {/* Cross-store delivery summary */}
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
                Delivery summary
              </h2>
              <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13, marginBottom: 14 }}>
                What goes on each truck. Empty cells mean that store didn't order the item this week.
              </p>
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
                gap: 12,
              }}>
                <DeliveryCard day="Monday"    items={report.deliverySummary.mon} stores={stores} catalog={catalog} />
                <DeliveryCard day="Wednesday" items={report.deliverySummary.wed} stores={stores} catalog={catalog} />
                <DeliveryCard day="Friday"    items={report.deliverySummary.fri} stores={stores} catalog={catalog} />
              </div>
            </>
          )}
        </>
      )}

      {tab === 'saved' && (
        <SavedOrdersList
          orders={savedOrders}
          onOpen={(iso) => { setWeekIso(iso); setTab('current'); }}
        />
      )}
    </div>
  );
}

function SavedOrdersList({
  orders, onOpen,
}: {
  orders: SavedOrder[];
  onOpen: (weekIso: string) => void;
}) {
  if (orders.length === 0) {
    return (
      <div style={{
        background: '#fff', borderRadius: 14,
        border: '1px solid rgba(0,0,0,0.07)',
        padding: '40px 24px', textAlign: 'center',
        color: 'rgba(0,0,0,0.45)', fontSize: 14,
      }}>
        No saved orders yet. Fill out a store's order on the Current Order tab and hit Save on
        that store's card — it'll show up here for future reference.
      </div>
    );
  }
  return (
    <div style={{
      background: '#fff', borderRadius: 14,
      border: '1px solid rgba(0,0,0,0.07)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
      overflow: 'hidden',
    }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        fontSize: 14, fontFamily: 'var(--font-body)',
      }}>
        <thead>
          <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
            <Th>Store</Th>
            <Th>Week</Th>
            <Th align="right">Items</Th>
            <Th align="right">Total qty</Th>
            <Th>Saved</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const theme = getTheme(o.storeLabel);
            return (
              <tr key={`${o.weekStartIso}|${o.storeLabel}`}
                onClick={() => onOpen(o.weekStartIso)}
                style={{
                  borderTop: '1px solid rgba(0,0,0,0.05)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.02)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Td>
                  <span style={{
                    display: 'inline-block', padding: '3px 10px', borderRadius: 6,
                    background: theme.headerBg, color: theme.headerFg,
                    fontSize: 12, fontWeight: 700, letterSpacing: 0.4,
                  }}>{o.storeLabel}</span>
                  {STORE_CITIES[o.storeLabel] && (
                    <span style={{
                      marginLeft: 8, fontSize: 12, color: 'rgba(0,0,0,0.55)',
                      textTransform: 'uppercase', letterSpacing: 0.4,
                    }}>{STORE_CITIES[o.storeLabel]}</span>
                  )}
                </Td>
                <Td><strong>{fmtDateRange(o.weekStartIso)}</strong></Td>
                <Td align="right" style={{
                  fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.6)',
                }}>{o.itemCount}</Td>
                <Td align="right" style={{
                  fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                }}>{Math.round(o.totalQty)}</Td>
                <Td style={{ color: 'rgba(0,0,0,0.55)', fontSize: 12 }}>
                  {new Date(o.savedAt).toLocaleString([], {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                  })}
                  {o.savedBy && (
                    <span style={{ marginLeft: 6, color: 'rgba(0,0,0,0.4)' }}>by {o.savedBy}</span>
                  )}
                </Td>
                <Td align="right" style={{ color: 'rgba(0,0,0,0.3)' }}>›</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Harry Potter house palettes for each store. Tuned for dashboard
 *  legibility — pale tinted body, deep header band, accent-colored
 *  metadata. The 4 stores map: G1=Gryffindor (scarlet + gold),
 *  G2=Ravenclaw (navy + bronze), G3=Slytherin (emerald + silver),
 *  G4=Hufflepuff (gold + black). */
const STORE_THEMES: Record<string, {
  bg: string;       // Card body tint
  border: string;   // Card border
  headerBg: string; // Header band
  headerFg: string; // Header text
  accent: string;   // Header metadata color
  rowAlt: string;   // Inactive-row tint (on top of bg)
}> = {
  G1: { bg: '#fdf4f5', border: '#e8c5c8', headerBg: '#7f1d1d', headerFg: '#fde68a', accent: 'rgba(253, 230, 138, 0.7)', rowAlt: 'rgba(127, 29, 29, 0.035)' },
  G2: { bg: '#eff6fc', border: '#c5d6e8', headerBg: '#1e3a5f', headerFg: '#e6c89f', accent: 'rgba(230, 200, 159, 0.75)', rowAlt: 'rgba(30, 58, 95, 0.035)' },
  G3: { bg: '#eef6f0', border: '#bfdac9', headerBg: '#14532d', headerFg: '#e5e7eb', accent: 'rgba(229, 231, 235, 0.7)', rowAlt: 'rgba(20, 83, 45, 0.035)' },
  G4: { bg: '#fefae0', border: '#e6d8a3', headerBg: '#a16207', headerFg: '#fefce8', accent: 'rgba(254, 252, 232, 0.7)', rowAlt: 'rgba(161, 98, 7, 0.04)' },
};

function getTheme(store: string) {
  return STORE_THEMES[store] ?? {
    bg: '#fff', border: 'rgba(0,0,0,0.07)',
    headerBg: '#1a1a1a', headerFg: '#fff', accent: 'rgba(255,255,255,0.6)',
    rowAlt: 'rgba(0,0,0,0.015)',
  };
}

function StoreOrderCard({
  store, rows, catalog, savedAt, saving, isMobile, onSaveOrder, onSave, onDelete,
}: {
  store: string;
  rows: OrderRow[];
  catalog: CatalogItem[];
  savedAt: number | null;
  saving: boolean;
  isMobile: boolean;
  onSaveOrder: () => void;
  onSave: (item: string, qty: number) => void;
  onDelete: (item: string) => void;
}) {
  const theme = getTheme(store);
  // Cart-style: render every catalog item by default, with the qty pre-
  // filled from an existing order row if there is one. Items the user
  // typed in ad-hoc that aren't in the catalog get appended at the end.
  const rowByName = useMemo(() => {
    const m = new Map<string, OrderRow>();
    for (const r of rows) m.set(r.itemName, r);
    return m;
  }, [rows]);
  const renderItems = useMemo(() => {
    const catalogNames = new Set(catalog.map((c) => c.name));
    const cart: Array<{
      name: string;
      row: OrderRow | null;
      sort: number;
      custom: boolean;
      imageUrl: string | null;
    }> = catalog.map((c) => ({
      name: c.name,
      row: rowByName.get(c.name) ?? null,
      sort: c.sort,
      custom: false,
      imageUrl: c.imageUrl ?? null,
    }));
    // Append any rows whose item isn't in the catalog — these are ad-hoc
    // additions and live at the bottom so they don't break the catalog
    // ordering.
    for (const r of rows) {
      if (!catalogNames.has(r.itemName)) {
        cart.push({ name: r.itemName, row: r, sort: 9999, custom: true, imageUrl: null });
      }
    }
    return cart;
  }, [catalog, rows, rowByName]);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const orderedRows = rows.filter((r) => r.weeklyQty > 0);
  const total = orderedRows.reduce((sum, r) => sum + r.weeklyQty, 0);

  return (
    <div style={{
      background: theme.bg, borderRadius: 14,
      border: `1px solid ${theme.border}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      padding: 0, overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 18px',
        background: theme.headerBg, color: theme.headerFg,
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.2 }}>
          {store}
          {STORE_CITIES[store] && (
            <span style={{
              fontWeight: 500, letterSpacing: 0.5, marginLeft: 8, opacity: 0.85,
              textTransform: 'uppercase', fontSize: 13,
            }}>— {STORE_CITIES[store]}</span>
          )}
        </span>
        <span style={{ fontSize: 12, color: theme.accent }}>
          {orderedRows.length} items · {total} total
        </span>
      </div>
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        fontSize: 14, fontFamily: 'var(--font-body)',
      }}>
        <thead>
          <tr style={{ background: theme.rowAlt }}>
            <Th>Item</Th>
            <Th align="right">Week</Th>
            <Th align="right">Mon</Th>
            <Th align="right">Wed</Th>
            <Th align="right">Fri</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {renderItems.map((it) => (
            <CartRowEditor key={it.name}
              itemName={it.name}
              imageUrl={it.imageUrl}
              row={it.row}
              isCustom={it.custom}
              inactiveBg={theme.rowAlt}
              onSave={(qty) => onSave(it.name, qty)}
              onDelete={() => onDelete(it.name)}
            />
          ))}
        </tbody>
      </table>
      <div style={{
        padding: '10px 18px',
        borderTop: `1px solid ${theme.border}`,
        display: 'flex', flexWrap: 'wrap',
        alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          {adding ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Custom item name"
                autoFocus
                style={{
                  flex: 1, minWidth: 140, padding: '6px 10px', borderRadius: 6,
                  border: '1px solid rgba(0,0,0,0.15)', fontSize: 13,
                  background: '#fff',
                }}
              />
              <button onClick={() => {
                const name = newName.trim();
                if (!name) { setAdding(false); return; }
                onSave(name, 1);
                setNewName('');
                setAdding(false);
              }} style={primaryBtn}>Add</button>
              <button onClick={() => { setNewName(''); setAdding(false); }}
                style={pillBtn}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} style={{
              ...pillBtn,
              fontSize: 11, color: 'rgba(0,0,0,0.5)',
              background: 'rgba(255,255,255,0.7)',
            }}>+ Add custom item</button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {savedAt && (
            <span style={{
              fontSize: 10, color: '#166534', fontWeight: 700, letterSpacing: 0.5,
              padding: '3px 8px', borderRadius: 6,
              background: 'rgba(22, 101, 52, 0.1)',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>
              ✓ Saved {new Date(savedAt).toLocaleString([], {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
            </span>
          )}
          <button onClick={onSaveOrder} disabled={saving}
            style={{
              padding: '7px 16px', borderRadius: 8, border: 0,
              cursor: saving ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700,
              letterSpacing: 0.4, textTransform: 'uppercase',
              background: theme.headerBg, color: theme.headerFg,
              opacity: saving ? 0.6 : 1,
              whiteSpace: 'nowrap',
            }}>
            {saving ? 'Saving…' : savedAt ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CartRowEditor({
  itemName, imageUrl, row, isCustom, inactiveBg, onSave, onDelete,
}: {
  itemName: string;
  imageUrl?: string | null;
  row: OrderRow | null;
  isCustom: boolean;
  inactiveBg: string;
  onSave: (qty: number) => void;
  onDelete: () => void;
}) {
  const currentQty = row?.weeklyQty ?? 0;
  const [qtyText, setQtyText] = useState<string>(currentQty > 0 ? currentQty.toString() : '');

  useEffect(() => {
    setQtyText(currentQty > 0 ? currentQty.toString() : '');
  }, [currentQty]);

  const active = currentQty > 0;

  const commit = (next: number) => {
    if (!Number.isFinite(next) || next < 0) return;
    if (next === currentQty) return;
    if (next <= 0 && currentQty > 0) onDelete();
    else if (next > 0) onSave(next);
  };

  const step = (delta: number) => {
    const cur = Number.parseInt(qtyText, 10);
    const base = Number.isFinite(cur) && cur > 0 ? cur : currentQty;
    const next = Math.max(0, base + delta);
    setQtyText(next > 0 ? next.toString() : '');
    commit(next);
  };

  return (
    <tr style={{
      borderTop: '1px solid rgba(0,0,0,0.05)',
      background: active ? 'transparent' : inactiveBg,
    }}>
      <Td>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 12,
          color: active ? '#1a1a1a' : 'rgba(0,0,0,0.45)',
          fontWeight: active ? 500 : 400,
          fontSize: 16,
          fontFamily: 'var(--font-body)',
        }}>
          {imageUrl ? (
            <img src={imageUrl} alt="" loading="lazy"
              style={{
                width: 128, height: 128, borderRadius: 14,
                objectFit: 'cover', flexShrink: 0,
                opacity: active ? 1 : 0.55,
                background: 'rgba(0,0,0,0.04)',
              }}
            />
          ) : (
            <span style={{
              display: 'inline-block', width: 96, height: 96,
              borderRadius: 12, flexShrink: 0,
              background: 'rgba(0,0,0,0.04)',
            }} />
          )}
          <span>
            {itemName}
            {isCustom && (
              <span style={{
                marginLeft: 6, fontSize: 9, fontWeight: 700,
                color: 'rgba(0,0,0,0.35)', letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}>custom</span>
            )}
          </span>
        </span>
      </Td>
      <Td align="right">
        <div style={{
          display: 'inline-flex', alignItems: 'stretch',
          border: '1px solid rgba(0,0,0,0.15)', borderRadius: 8,
          background: active ? '#fff' : 'rgba(255,255,255,0.65)',
          overflow: 'hidden',
        }}>
          <button onClick={() => step(-1)} aria-label="Decrease"
            style={{
              width: 28, padding: 0, border: 0, cursor: 'pointer',
              background: 'transparent', color: 'rgba(0,0,0,0.55)',
              fontSize: 16, fontWeight: 600, lineHeight: 1,
              borderRight: '1px solid rgba(0,0,0,0.08)',
            }}>−</button>
          <input type="text" inputMode="numeric" pattern="[0-9]*"
            value={qtyText}
            placeholder="0"
            onChange={(e) => {
              // Allow only digits (no decimals, no negatives).
              const cleaned = e.target.value.replace(/[^0-9]/g, '');
              setQtyText(cleaned);
            }}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const next = raw === '' ? 0 : Number.parseInt(raw, 10);
              commit(Number.isFinite(next) ? next : 0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              else if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
            }}
            style={{
              width: 48, padding: '6px 4px', border: 0,
              fontSize: 14, fontVariantNumeric: 'tabular-nums',
              textAlign: 'center', background: 'transparent',
              color: active ? '#1a1a1a' : 'rgba(0,0,0,0.5)',
              outline: 'none',
            }}
          />
          <button onClick={() => step(1)} aria-label="Increase"
            style={{
              width: 28, padding: 0, border: 0, cursor: 'pointer',
              background: 'transparent', color: 'rgba(0,0,0,0.55)',
              fontSize: 16, fontWeight: 600, lineHeight: 1,
              borderLeft: '1px solid rgba(0,0,0,0.08)',
            }}>+</button>
        </div>
      </Td>
      <Td align="right" style={{
        ...delivCell,
        color: active ? delivCell.color : 'rgba(0,0,0,0.18)',
      }}>{active ? fmtNum(row!.delivery.mon) : '—'}</Td>
      <Td align="right" style={{
        ...delivCell,
        color: active ? delivCell.color : 'rgba(0,0,0,0.18)',
      }}>{active ? fmtNum(row!.delivery.wed) : '—'}</Td>
      <Td align="right" style={{
        ...delivCell,
        color: active ? delivCell.color : 'rgba(0,0,0,0.18)',
      }}>{active ? fmtNum(row!.delivery.fri) : '—'}</Td>
      <Td align="right">
        {isCustom && active && (
          <button onClick={() => {
            if (confirm(`Remove ${itemName} from this order?`)) onDelete();
          }} style={iconBtn} title="Remove">×</button>
        )}
      </Td>
    </tr>
  );
}

function DeliveryCard({
  day, items, stores, catalog,
}: {
  day: string;
  items: Record<string, Record<string, number>>;
  stores: string[];
  catalog: CatalogItem[];
}) {
  const itemNames = useMemo(() => {
    return Object.keys(items).sort((a, b) => {
      const ai = catalog.find((c) => c.name === a)?.sort ?? 1000;
      const bi = catalog.find((c) => c.name === b)?.sort ?? 1000;
      return ai - bi || a.localeCompare(b);
    });
  }, [items, catalog]);

  const totalsByStore: Record<string, number> = {};
  let grandTotal = 0;
  for (const item of itemNames) {
    for (const [store, qty] of Object.entries(items[item] ?? {})) {
      totalsByStore[store] = (totalsByStore[store] ?? 0) + qty;
      grandTotal += qty;
    }
  }

  return (
    <div style={{
      background: '#fff', borderRadius: 14,
      border: '1px solid rgba(0,0,0,0.07)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.05)',
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.2 }}>{day}</span>
        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>{grandTotal} units</span>
      </div>
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        fontSize: 13, fontFamily: 'var(--font-body)',
      }}>
        <thead>
          <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
            <Th>Item</Th>
            {stores.map((s) => <Th key={s} align="right">{s}</Th>)}
          </tr>
        </thead>
        <tbody>
          {itemNames.map((name) => (
            <tr key={name} style={{ borderTop: '1px solid rgba(0,0,0,0.04)' }}>
              <Td style={{ fontSize: 14 }}>{name}</Td>
              {stores.map((s) => {
                const q = items[name]?.[s];
                return (
                  <Td key={s} align="right" style={delivCell}>
                    {q ? fmtNum(q) : <span style={{ color: 'rgba(0,0,0,0.18)' }}>—</span>}
                  </Td>
                );
              })}
            </tr>
          ))}
          {itemNames.length === 0 && (
            <tr><Td colSpan={1 + stores.length} style={{
              textAlign: 'center', padding: 18, color: 'rgba(0,0,0,0.4)', fontSize: 12,
            }}>
              No deliveries for {day}.
            </Td></tr>
          )}
          {itemNames.length > 0 && (
            <tr style={{
              borderTop: '2px solid rgba(0,0,0,0.08)',
              background: 'rgba(0,0,0,0.02)',
              fontWeight: 700,
            }}>
              <Td>Total</Td>
              {stores.map((s) => (
                <Td key={s} align="right" style={delivCell}>
                  {totalsByStore[s] ? fmtNum(totalsByStore[s]) : <span style={{ color: 'rgba(0,0,0,0.18)' }}>—</span>}
                </Td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function fmtNum(n: number): string {
  // Orders are whole-item counts (sandwiches, scones, etc.) — never
  // show decimals even if the underlying value picked up a 0.0.
  return Math.round(n).toString();
}

const pillBtn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 999,
  border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
  color: 'rgba(0,0,0,0.7)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const primaryBtn: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 999,
  border: '1px solid #1a1a1a', background: '#1a1a1a',
  color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const iconBtn: React.CSSProperties = {
  width: 22, height: 22, border: 0, padding: 0, cursor: 'pointer',
  background: 'transparent', color: 'rgba(0,0,0,0.4)',
  fontSize: 18, lineHeight: 1,
};
const delivCell: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.7)',
};

function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align ?? 'left',
      padding: '10px 14px', fontSize: 10, textTransform: 'uppercase',
      letterSpacing: 0.5, fontWeight: 700, color: 'rgba(0,0,0,0.5)',
      whiteSpace: 'nowrap',
    }}>{children ?? ''}</th>
  );
}

function Td({
  children, align, style, colSpan,
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
  style?: React.CSSProperties;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} style={{
      textAlign: align ?? 'left',
      padding: '8px 14px', whiteSpace: 'nowrap',
      ...style,
    }}>{children}</td>
  );
}
