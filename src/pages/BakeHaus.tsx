import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

interface OrderRow {
  weekStartIso: string;
  storeLabel: string;
  itemName: string;
  weeklyQty: number;
  notes: string | null;
  onHand: number;
  netQty: number;
  delivery: { mon: number; wed: number; fri: number };
  monLockedQty: number | null;
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
  inventoryByStore: Record<string, Record<string, number>>;
  inventoryFetchedAt: number;
  monLock: { lockedAt: number; lockedBy: string | null } | null;
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

type Tab = 'current' | 'schedule' | 'saved';

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
  const [printPrevReport, setPrintPrevReport] = useState<WeekReport | null>(null);
  const [printing, setPrinting] = useState(false);

  const exportPdf = useCallback(async () => {
    if (!report) return;
    setPrinting(true);
    try {
      // Fetch the prior week so the print summary can show a
      // this-week vs. last-week comparison column. Best-effort —
      // if last week has no data we just skip the comparison
      // column and still print.
      const prevIso = shiftWeeks(weekIso, -1);
      try {
        const r = await fetch(`/api/bake-haus/week?week=${prevIso}`, { cache: 'no-store' });
        if (r.ok) {
          const body = await r.json();
          setPrintPrevReport(body.report ?? null);
        } else {
          setPrintPrevReport(null);
        }
      } catch {
        setPrintPrevReport(null);
      }
      // Let React paint the print-only container before the dialog
      // grabs the page snapshot.
      await new Promise((r) => setTimeout(r, 60));
      window.print();
    } finally {
      setPrinting(false);
    }
  }, [report, weekIso]);

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

  const [lockBusy, setLockBusy] = useState(false);
  const toggleMondayLock = async () => {
    if (!report) return;
    const isLocked = !!report.monLock;
    const verb = isLocked ? 'Unlock' : 'Lock';
    const confirmMsg = isLocked
      ? "Unlock Monday delivery? Mon quantities will go back to recomputing from each item's weekly qty."
      : "Lock Monday delivery? After this, edits to weekly qty will only affect Wed + Fri (Monday stays frozen).";
    if (!window.confirm(confirmMsg)) return;
    setLockBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/bake-haus/lock-monday', {
        method: isLocked ? 'DELETE' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ week: weekIso }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || body.error || `${verb} failed`);
      }
      await loadWeek(weekIso);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLockBusy(false);
    }
  };

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
          { id: 'schedule', label: 'Delivery Schedule' },
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

      {(tab === 'current' || tab === 'schedule') && (
        <>
          {/* Week selector — shared by Current Order + Delivery Schedule
              since both views read off the same weekly report. */}
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
        </>
      )}

      {tab === 'current' && report && (
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
              inventory={report.inventoryByStore[activeStore] ?? {}}
              inventoryFetchedAt={report.inventoryFetchedAt}
              savedAt={report.savedAtByStore[activeStore] ?? null}
              saving={savingStores.has(activeStore)}
              isMobile={isMobile}
              onSaveOrder={() => saveStore(activeStore)}
              onSave={(item, qty) => saveItem(activeStore, item, qty)}
              onDelete={(item) => deleteItem(activeStore, item)}
            />
          </div>
        </>
      )}

      {tab === 'schedule' && report && (
        <>
          {/* Weekly production totals — what the kitchen needs to make
              this week, summed across all stores + all delivery days.
              Drives raw-ingredient ordering and prep scheduling. */}
          <WeeklyTotalsCard
            deliverySummary={report.deliverySummary}
            catalog={catalog}
          />

          {/* Monday lock state — Maggie hits "Lock" once the Monday
              truck has rolled. After that, qty edits flow into Wed+Fri
              only and Mon stays frozen. */}
          <MondayLockBar
            monLock={report.monLock}
            busy={lockBusy}
            onToggle={toggleMondayLock}
          />

          {/* Per-day delivery breakdown — what goes on each truck. */}
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            gap: 12, marginTop: 28, marginBottom: 12, flexWrap: 'wrap',
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
              Delivery schedule
            </h2>
            <button onClick={exportPdf} disabled={printing}
              style={{
                ...primaryBtn,
                opacity: printing ? 0.6 : 1,
                cursor: printing ? 'wait' : 'pointer',
              }}>
              {printing ? 'Preparing…' : 'Export PDF'}
            </button>
          </div>
          <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13, marginBottom: 14 }}>
            What goes on each truck. Empty cells mean that store didn't order the item this week.
          </p>
          <div style={{
            display: 'grid',
            // auto-fit + minmax lets the grid stack to 2-up (or 1-up)
            // on narrower screens (Chromebooks ~1366px) instead of
            // squeezing 3 cards into the row and clipping columns.
            // 540px floor accounts for Item + 4 stores + Total = 6
            // columns; below that, the card stacks vertically.
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(540px, 1fr))',
            gap: 12,
          }}>
            <DeliveryCard day="Monday"    items={report.deliverySummary.mon} stores={stores} catalog={catalog} />
            <DeliveryCard day="Wednesday" items={report.deliverySummary.wed} stores={stores} catalog={catalog} />
            <DeliveryCard day="Friday"    items={report.deliverySummary.fri} stores={stores} catalog={catalog} />
          </div>
        </>
      )}

      {tab === 'saved' && (
        <SavedOrdersList
          orders={savedOrders}
          onOpen={(iso, store) => {
            setWeekIso(iso);
            setActiveStore(store);
            setTab('current');
          }}
        />
      )}

      {/* Print-only layout. Hidden on screen, rendered when the user
          hits Export PDF and the browser print dialog kicks in. */}
      {report && (
        <PrintableSchedule
          weekIso={weekIso}
          report={report}
          prevReport={printPrevReport}
          stores={stores}
          catalog={catalog}
        />
      )}
    </div>
  );
}

function SavedOrdersList({
  orders, onOpen,
}: {
  orders: SavedOrder[];
  onOpen: (weekIso: string, storeLabel: string) => void;
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
                onClick={() => onOpen(o.weekStartIso, o.storeLabel)}
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
  store, rows, catalog, inventory, inventoryFetchedAt, savedAt, saving, isMobile, onSaveOrder, onSave, onDelete,
}: {
  store: string;
  rows: OrderRow[];
  catalog: CatalogItem[];
  inventory: Record<string, number>;
  inventoryFetchedAt: number;
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
        flexWrap: 'wrap', gap: 8,
      }}>
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.3 }}>
          {store}
          {STORE_CITIES[store] && (
            <span style={{
              fontWeight: 500, letterSpacing: 0.6, marginLeft: 10, opacity: 0.85,
              textTransform: 'uppercase', fontSize: 17,
            }}>— {STORE_CITIES[store]}</span>
          )}
        </span>
        <span style={{ fontSize: 12, color: theme.accent }}>
          {orderedRows.length} items · {total} ordered ·{' '}
          Inventory @ {new Date(inventoryFetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>
      {/* Subtle column-header strip — no harsh table chrome, just light
          labels above the rows. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 150px 200px 56px',
        gap: 28, padding: '10px 24px',
        background: theme.rowAlt,
        fontSize: 10, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: 1,
        color: 'rgba(0,0,0,0.42)',
        fontFamily: 'var(--font-body)',
      }}>
        <span>Item</span>
        <span style={{ textAlign: 'center' }}>Order</span>
        <span style={{ textAlign: 'center' }}>Delivery · Mon / Wed / Fri</span>
        <span />
      </div>
      <div>
        {renderItems.map((it, i) => (
          <CartRowEditor key={it.name}
            itemName={it.name}
            imageUrl={it.imageUrl}
            row={it.row}
            onHand={inventory[it.name] ?? 0}
            isCustom={it.custom}
            theme={theme}
            isLast={i === renderItems.length - 1}
            onSave={(qty) => onSave(it.name, qty)}
            onDelete={() => onDelete(it.name)}
          />
        ))}
      </div>
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
  itemName, imageUrl, row, onHand, isCustom, theme, isLast, onSave, onDelete,
}: {
  itemName: string;
  imageUrl?: string | null;
  row: OrderRow | null;
  onHand: number;
  isCustom: boolean;
  theme: ReturnType<typeof getTheme>;
  isLast: boolean;
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

  const dayCell = (label: string, qty: number, locked?: boolean) => (
    <div style={{
      flex: 1, textAlign: 'center',
      padding: '6px 4px', borderRadius: 8,
      background: locked
        ? 'rgba(202, 138, 4, 0.10)'
        : active && qty > 0 ? 'rgba(255,255,255,0.75)' : 'transparent',
      border: locked
        ? '1px solid rgba(202, 138, 4, 0.25)'
        : active && qty > 0 ? '1px solid rgba(0,0,0,0.06)' : '1px solid transparent',
      transition: 'background 0.15s',
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 1,
        textTransform: 'uppercase',
        color: locked ? '#a16207' : 'rgba(0,0,0,0.4)',
        marginBottom: 2, fontFamily: 'var(--font-body)',
      }}>{label}{locked && ' 🔒'}</div>
      <div style={{
        fontSize: 20, fontWeight: 600,
        fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        color: locked
          ? '#a16207'
          : active && qty > 0 ? '#1a1a1a' : 'rgba(0,0,0,0.2)',
        fontFamily: 'var(--font-body)',
      }}>{active && qty > 0 ? qty : '—'}</div>
    </div>
  );

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 150px 200px 56px',
      alignItems: 'center', gap: 28,
      padding: '14px 24px',
      borderBottom: isLast ? 'none' : '1px solid rgba(0,0,0,0.04)',
      background: active ? 'transparent' : theme.rowAlt,
      opacity: active ? 1 : 0.92,
      transition: 'background 0.15s',
    }}>
      {/* Item: photo + name (display font) + on-hand subtitle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy"
            style={{
              width: 96, height: 96, borderRadius: 14,
              objectFit: 'cover', flexShrink: 0,
              opacity: active ? 1 : 0.55,
              background: 'rgba(0,0,0,0.04)',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          />
        ) : (
          <span style={{
            display: 'inline-block', width: 96, height: 96,
            borderRadius: 14, flexShrink: 0,
            background: 'rgba(0,0,0,0.04)',
          }} />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22, fontWeight: 500,
            color: active ? '#1a1a1a' : 'rgba(0,0,0,0.5)',
            letterSpacing: -0.2, lineHeight: 1.15,
            overflowWrap: 'anywhere',
          }}>
            {itemName}
            {isCustom && (
              <span style={{
                marginLeft: 8, fontSize: 9, fontWeight: 700,
                color: 'rgba(0,0,0,0.4)', letterSpacing: 0.6,
                textTransform: 'uppercase',
                fontFamily: 'var(--font-body)',
                verticalAlign: 'middle',
                padding: '2px 6px', borderRadius: 4,
                background: 'rgba(0,0,0,0.05)',
              }}>custom</span>
            )}
          </div>
          <div style={{
            marginTop: 6, display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 11, color: 'rgba(0,0,0,0.45)',
            fontFamily: 'var(--font-body)',
            textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600,
          }}>
            <span style={{
              padding: '2px 8px', borderRadius: 999,
              background: onHand > 0 ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.02)',
              color: onHand > 0 ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.3)',
            }}>{onHand} on hand</span>
            {active && row && row.netQty !== row.weeklyQty && (
              <span style={{ color: 'rgba(0,0,0,0.4)' }}>
                Net {row.netQty}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Order qty stepper */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'stretch',
          border: `1px solid ${active ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.1)'}`,
          borderRadius: 10,
          background: '#fff',
          overflow: 'hidden',
          boxShadow: active ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
        }}>
          <button onClick={() => step(-1)} aria-label="Decrease"
            style={{
              width: 34, padding: 0, border: 0, cursor: 'pointer',
              background: 'transparent', color: 'rgba(0,0,0,0.55)',
              fontSize: 18, fontWeight: 500, lineHeight: 1,
              borderRight: '1px solid rgba(0,0,0,0.06)',
              fontFamily: 'var(--font-body)',
            }}>−</button>
          <input type="text" inputMode="numeric" pattern="[0-9]*"
            data-qty-input
            value={qtyText}
            placeholder="0"
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^0-9]/g, '');
              setQtyText(cleaned);
            }}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const next = raw === '' ? 0 : Number.parseInt(raw, 10);
              commit(Number.isFinite(next) ? next : 0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                // Jump focus to the next quantity input in the order
                // card so you can tab through the whole list with just
                // the keyboard. Resolves before blur so the save fires
                // for the row we just left.
                const inputs = Array.from(
                  document.querySelectorAll<HTMLInputElement>('[data-qty-input]'),
                );
                const idx = inputs.indexOf(e.currentTarget);
                e.currentTarget.blur();
                if (idx >= 0 && idx + 1 < inputs.length) {
                  const next = inputs[idx + 1];
                  next.focus();
                  next.select();
                }
              } else if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
            }}
            style={{
              width: 50, padding: '8px 4px', border: 0,
              fontSize: 16, fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'center', background: 'transparent',
              color: active ? '#1a1a1a' : 'rgba(0,0,0,0.4)',
              outline: 'none',
              fontFamily: 'var(--font-body)',
            }}
          />
          <button onClick={() => step(1)} aria-label="Increase"
            style={{
              width: 34, padding: 0, border: 0, cursor: 'pointer',
              background: 'transparent', color: 'rgba(0,0,0,0.55)',
              fontSize: 18, fontWeight: 500, lineHeight: 1,
              borderLeft: '1px solid rgba(0,0,0,0.06)',
              fontFamily: 'var(--font-body)',
            }}>+</button>
        </div>
      </div>

      {/* Delivery slots — Mon / Wed / Fri */}
      <div style={{ display: 'flex', gap: 10 }}>
        {dayCell('Mon', row?.delivery.mon ?? 0, row?.monLockedQty != null)}
        {dayCell('Wed', row?.delivery.wed ?? 0)}
        {dayCell('Fri', row?.delivery.fri ?? 0)}
      </div>

      {/* Trailing action (delete custom item) */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {isCustom && active && (
          <button onClick={() => {
            if (confirm(`Remove ${itemName} from this order?`)) onDelete();
          }} style={iconBtn} title="Remove">×</button>
        )}
      </div>
    </div>
  );
}

function MondayLockBar({
  monLock, busy, onToggle,
}: {
  monLock: { lockedAt: number; lockedBy: string | null } | null;
  busy: boolean;
  onToggle: () => void;
}) {
  const isLocked = monLock != null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, flexWrap: 'wrap',
      padding: '10px 14px', borderRadius: 10, marginTop: 14,
      background: isLocked ? 'rgba(202, 138, 4, 0.07)' : 'rgba(0,0,0,0.025)',
      border: `1px solid ${isLocked ? 'rgba(202, 138, 4, 0.25)' : 'rgba(0,0,0,0.08)'}`,
    }}>
      <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.75)' }}>
        {isLocked ? (
          <>
            <strong style={{ color: '#a16207' }}>🔒 Monday delivery locked</strong>
            <span style={{ color: 'rgba(0,0,0,0.55)' }}>
              {' '}— locked {new Date(monLock!.lockedAt).toLocaleString([], {
                month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit',
              })}
              {monLock!.lockedBy && <> by {monLock!.lockedBy}</>}
              . Edits to weekly qty now flow into <strong>Wed + Fri</strong> only.
            </span>
          </>
        ) : (
          <>
            <strong>Monday delivery is unlocked.</strong>
            <span style={{ color: 'rgba(0,0,0,0.55)' }}>
              {' '}Lock it after the Monday truck rolls so later qty edits don't shuffle Mon's numbers.
            </span>
          </>
        )}
      </div>
      <button onClick={onToggle} disabled={busy}
        style={{
          ...(isLocked ? pillBtn : primaryBtn),
          opacity: busy ? 0.6 : 1,
          cursor: busy ? 'wait' : 'pointer',
        }}>
        {busy ? '…' : isLocked ? 'Unlock Monday' : 'Lock Monday delivery'}
      </button>
    </div>
  );
}

/** Weekly production totals — rolls Mon/Wed/Fri × all stores into a
 *  single item-level table. Drives raw-ingredient planning ("we need
 *  to bake 270 Bacon Egg & Cheese this week") which the per-day cards
 *  don't surface at a glance. */
function WeeklyTotalsCard({
  deliverySummary, catalog,
}: {
  deliverySummary: {
    mon: Record<string, Record<string, number>>;
    wed: Record<string, Record<string, number>>;
    fri: Record<string, Record<string, number>>;
  };
  catalog: CatalogItem[];
}) {
  const days = [
    { key: 'mon' as const, label: 'Mon' },
    { key: 'wed' as const, label: 'Wed' },
    { key: 'fri' as const, label: 'Fri' },
  ];

  // Build the item list (union of items across all days), then
  // compute per-day-total and week-total per item.
  const byItem = useMemo(() => {
    const sums = new Map<string, { mon: number; wed: number; fri: number; total: number }>();
    for (const day of days) {
      const dayMap = deliverySummary[day.key] ?? {};
      for (const [item, perStore] of Object.entries(dayMap)) {
        let s = sums.get(item);
        if (!s) {
          s = { mon: 0, wed: 0, fri: 0, total: 0 };
          sums.set(item, s);
        }
        for (const qty of Object.values(perStore)) {
          s[day.key] += qty;
          s.total += qty;
        }
      }
    }
    const arr = Array.from(sums.entries()).map(([name, v]) => ({ name, ...v }));
    arr.sort((a, b) => {
      const ai = catalog.find((c) => c.name === a.name)?.sort ?? 1000;
      const bi = catalog.find((c) => c.name === b.name)?.sort ?? 1000;
      return ai - bi || a.name.localeCompare(b.name);
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverySummary, catalog]);

  const dayTotals = { mon: 0, wed: 0, fri: 0 };
  let weekTotal = 0;
  for (const r of byItem) {
    dayTotals.mon += r.mon;
    dayTotals.wed += r.wed;
    dayTotals.fri += r.fri;
    weekTotal += r.total;
  }

  return (
    <div style={{
      background: '#fff', borderRadius: 14,
      border: '1px solid rgba(0,0,0,0.07)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.05)',
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.2 }}>
            This week's production
          </div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>
            Total units to bake across all stores and delivery days.
          </div>
        </div>
        <span style={{
          fontSize: 13, fontWeight: 700, color: '#1a1a1a',
          background: 'rgba(0,0,0,0.05)', padding: '4px 10px', borderRadius: 999,
          fontVariantNumeric: 'tabular-nums',
        }}>{weekTotal.toLocaleString()} units total</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontSize: 13, fontFamily: 'var(--font-body)',
          minWidth: 460,
        }}>
          <thead>
            <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
              <Th>Item</Th>
              <Th align="right">Mon</Th>
              <Th align="right">Wed</Th>
              <Th align="right">Fri</Th>
              <Th align="right">Week total</Th>
            </tr>
          </thead>
          <tbody>
            {byItem.map((r) => (
              <tr key={r.name} style={{ borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                <Td style={{ fontSize: 14 }}>{r.name}</Td>
                <Td align="right" style={delivCell}>
                  {r.mon ? fmtNum(r.mon) : <span style={{ color: 'rgba(0,0,0,0.18)' }}>—</span>}
                </Td>
                <Td align="right" style={delivCell}>
                  {r.wed ? fmtNum(r.wed) : <span style={{ color: 'rgba(0,0,0,0.18)' }}>—</span>}
                </Td>
                <Td align="right" style={delivCell}>
                  {r.fri ? fmtNum(r.fri) : <span style={{ color: 'rgba(0,0,0,0.18)' }}>—</span>}
                </Td>
                <Td align="right" style={delivRowTotalCell}>
                  {r.total ? fmtNum(r.total) : <span style={{ color: 'rgba(0,0,0,0.18)' }}>—</span>}
                </Td>
              </tr>
            ))}
            {byItem.length === 0 && (
              <tr><Td colSpan={5} style={{
                textAlign: 'center', padding: 18, color: 'rgba(0,0,0,0.4)', fontSize: 12,
              }}>No orders placed for this week yet.</Td></tr>
            )}
            {byItem.length > 0 && (
              <tr style={{
                borderTop: '2px solid rgba(0,0,0,0.08)',
                background: 'rgba(0,0,0,0.02)',
                fontWeight: 700,
              }}>
                <Td>Total</Td>
                <Td align="right" style={delivCell}>
                  {dayTotals.mon ? fmtNum(dayTotals.mon) : <span style={{ color: 'rgba(0,0,0,0.18)' }}>—</span>}
                </Td>
                <Td align="right" style={delivCell}>
                  {dayTotals.wed ? fmtNum(dayTotals.wed) : <span style={{ color: 'rgba(0,0,0,0.18)' }}>—</span>}
                </Td>
                <Td align="right" style={delivCell}>
                  {dayTotals.fri ? fmtNum(dayTotals.fri) : <span style={{ color: 'rgba(0,0,0,0.18)' }}>—</span>}
                </Td>
                <Td align="right" style={delivRowTotalCell}>
                  {weekTotal > 0 ? fmtNum(weekTotal) : <span style={{ color: 'rgba(0,0,0,0.18)' }}>—</span>}
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Printable view (PDF export) ────────────────────────────────────

/** Off-screen container that renders the delivery schedule in a
 *  print-friendly layout. Hidden during normal browsing; the
 *  @media print rules in the embedded <style> tag take over the
 *  page when the user triggers window.print(), giving Maggie a
 *  one-day-per-page PDF with a summary cover page on top. */
function PrintableSchedule({
  weekIso, report, prevReport, stores, catalog,
}: {
  weekIso: string;
  report: WeekReport;
  prevReport: WeekReport | null;
  stores: string[];
  catalog: CatalogItem[];
}) {
  // Aggregate this week + last week into per-item totals so the
  // cover page can show a comparison column.
  const summary = useMemo(() => {
    const sum = (ds: WeekReport['deliverySummary']) => {
      const m = new Map<string, number>();
      let grand = 0;
      for (const day of ['mon', 'wed', 'fri'] as const) {
        const dayMap = ds[day] ?? {};
        for (const [item, perStore] of Object.entries(dayMap)) {
          for (const q of Object.values(perStore)) {
            m.set(item, (m.get(item) ?? 0) + q);
            grand += q;
          }
        }
      }
      return { byItem: m, grand };
    };
    const cur = sum(report.deliverySummary);
    const prev = prevReport ? sum(prevReport.deliverySummary) : null;
    const itemSet = new Set<string>([
      ...cur.byItem.keys(),
      ...(prev ? Array.from(prev.byItem.keys()) : []),
    ]);
    const rows = Array.from(itemSet).map((name) => ({
      name,
      cur:  cur.byItem.get(name)  ?? 0,
      prev: prev?.byItem.get(name) ?? 0,
    }));
    rows.sort((a, b) => {
      const ai = catalog.find((c) => c.name === a.name)?.sort ?? 1000;
      const bi = catalog.find((c) => c.name === b.name)?.sort ?? 1000;
      return ai - bi || a.name.localeCompare(b.name);
    });
    return { rows, curTotal: cur.grand, prevTotal: prev?.grand ?? 0, hasPrev: prev != null };
  }, [report, prevReport, catalog]);

  const curRange = fmtDateRange(weekIso);
  const prevRange = fmtDateRange(shiftWeeks(weekIso, -1));
  const deltaTotal = summary.curTotal - summary.prevTotal;
  const deltaTotalPct = summary.prevTotal > 0
    ? Math.round((deltaTotal / summary.prevTotal) * 100)
    : null;

  return (
    <div className="bh-print-root">
      {/* Embedded print CSS. Scoping all rules under @media print
          means the screen view is unaffected; only the print stylesheet
          flips visibility + page-break behavior. */}
      <style>{`
        @media screen {
          .bh-print-root { display: none; }
        }
        @media print {
          @page { size: letter portrait; margin: 0.5in; }
          body { background: #fff; }
          /* Hide everything that isn't part of the print root. */
          body * { visibility: hidden; }
          .bh-print-root, .bh-print-root * { visibility: visible; }
          .bh-print-root {
            position: absolute; top: 0; left: 0; width: 100%;
            font-family: var(--font-body), Inter, system-ui, sans-serif;
            color: #1a1a1a;
          }
          .bh-print-page {
            page-break-after: always;
            padding: 0 0 12pt 0;
          }
          .bh-print-page:last-child { page-break-after: auto; }
          .bh-print-title { font-size: 22pt; font-weight: 700; margin: 0 0 4pt; letter-spacing: -0.3pt; }
          .bh-print-sub   { font-size: 11pt; color: #555; margin: 0 0 14pt; }
          .bh-print-pillrow { display: flex; gap: 10pt; margin: 0 0 16pt; flex-wrap: wrap; }
          .bh-print-pill {
            border: 1pt solid #ddd; border-radius: 6pt;
            padding: 6pt 12pt; font-size: 10pt;
          }
          .bh-print-pill strong { font-size: 14pt; display: block; margin-top: 2pt; }
          .bh-print-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
          .bh-print-table th, .bh-print-table td {
            border-bottom: 0.5pt solid #ddd;
            padding: 6pt 10pt; text-align: left;
          }
          .bh-print-table th {
            font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5pt;
            color: #555; background: #f3f3f3;
          }
          .bh-print-table td.num,
          .bh-print-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
          .bh-print-table tr.total td {
            border-top: 1pt solid #333; font-weight: 700; background: #f7f7f7;
          }
          .bh-delta-up   { color: #15803d; font-weight: 700; }
          .bh-delta-down { color: #b91c1c; font-weight: 700; }
          .bh-delta-flat { color: #888; }
        }
      `}</style>

      {/* Cover page: summary + comparison */}
      <div className="bh-print-page">
        <div style={{ fontSize: '9pt', color: '#888', letterSpacing: '0.5pt', textTransform: 'uppercase' }}>
          Bake Haus · Delivery schedule
        </div>
        <h1 className="bh-print-title">Week of {curRange}</h1>
        <p className="bh-print-sub">
          Production totals across all four stores and three delivery days.
          {summary.hasPrev && <> Last week ({prevRange}) shown for comparison.</>}
        </p>

        <div className="bh-print-pillrow">
          <div className="bh-print-pill">
            This week
            <strong>{summary.curTotal.toLocaleString()} units</strong>
          </div>
          {summary.hasPrev && (
            <>
              <div className="bh-print-pill">
                Last week
                <strong>{summary.prevTotal.toLocaleString()} units</strong>
              </div>
              <div className="bh-print-pill">
                Δ vs last week
                <strong className={
                  deltaTotal > 0 ? 'bh-delta-up'
                  : deltaTotal < 0 ? 'bh-delta-down'
                  : 'bh-delta-flat'
                }>
                  {deltaTotal > 0 ? '+' : ''}{deltaTotal.toLocaleString()}
                  {deltaTotalPct != null && (
                    <> ({deltaTotal > 0 ? '+' : ''}{deltaTotalPct}%)</>
                  )}
                </strong>
              </div>
            </>
          )}
        </div>

        <table className="bh-print-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">This week</th>
              {summary.hasPrev && <th className="num">Last week</th>}
              {summary.hasPrev && <th className="num">Δ</th>}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => {
              const delta = r.cur - r.prev;
              const cls = delta > 0 ? 'bh-delta-up' : delta < 0 ? 'bh-delta-down' : 'bh-delta-flat';
              return (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="num">{r.cur > 0 ? r.cur.toLocaleString() : '—'}</td>
                  {summary.hasPrev && (
                    <td className="num" style={{ color: '#888' }}>
                      {r.prev > 0 ? r.prev.toLocaleString() : '—'}
                    </td>
                  )}
                  {summary.hasPrev && (
                    <td className={`num ${cls}`}>
                      {delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${delta}`}
                    </td>
                  )}
                </tr>
              );
            })}
            <tr className="total">
              <td>Total</td>
              <td className="num">{summary.curTotal.toLocaleString()}</td>
              {summary.hasPrev && <td className="num">{summary.prevTotal.toLocaleString()}</td>}
              {summary.hasPrev && (
                <td className={`num ${deltaTotal > 0 ? 'bh-delta-up' : deltaTotal < 0 ? 'bh-delta-down' : 'bh-delta-flat'}`}>
                  {deltaTotal === 0 ? '—' : `${deltaTotal > 0 ? '+' : ''}${deltaTotal}`}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {/* One page per delivery day. */}
      {([
        { label: 'Monday',    data: report.deliverySummary.mon },
        { label: 'Wednesday', data: report.deliverySummary.wed },
        { label: 'Friday',    data: report.deliverySummary.fri },
      ] as const).map((day) => (
        <PrintableDayPage
          key={day.label}
          day={day.label}
          items={day.data}
          stores={stores}
          catalog={catalog}
          weekRange={curRange}
        />
      ))}
    </div>
  );
}

function PrintableDayPage({
  day, items, stores, catalog, weekRange,
}: {
  day: string;
  items: Record<string, Record<string, number>>;
  stores: string[];
  catalog: CatalogItem[];
  weekRange: string;
}) {
  const sortedItems = Object.keys(items).sort((a, b) => {
    const ai = catalog.find((c) => c.name === a)?.sort ?? 1000;
    const bi = catalog.find((c) => c.name === b)?.sort ?? 1000;
    return ai - bi || a.localeCompare(b);
  });

  const storeTotals: Record<string, number> = {};
  const itemTotals: Record<string, number> = {};
  let grand = 0;
  for (const item of sortedItems) {
    for (const s of stores) {
      const q = items[item]?.[s] ?? 0;
      storeTotals[s] = (storeTotals[s] ?? 0) + q;
      itemTotals[item] = (itemTotals[item] ?? 0) + q;
      grand += q;
    }
  }

  return (
    <div className="bh-print-page">
      <div style={{ fontSize: '9pt', color: '#888', letterSpacing: '0.5pt', textTransform: 'uppercase' }}>
        Bake Haus · {weekRange}
      </div>
      <h1 className="bh-print-title">{day} delivery</h1>
      <p className="bh-print-sub">{grand.toLocaleString()} units total · {sortedItems.length} item{sortedItems.length === 1 ? '' : 's'}</p>

      {sortedItems.length === 0 ? (
        <p style={{ fontSize: '11pt', color: '#888', marginTop: '20pt' }}>
          No deliveries scheduled for {day}.
        </p>
      ) : (
        <table className="bh-print-table">
          <thead>
            <tr>
              <th>Item</th>
              {stores.map((s) => <th key={s} className="num">{s}</th>)}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((name) => (
              <tr key={name}>
                <td>{name}</td>
                {stores.map((s) => (
                  <td key={s} className="num">
                    {items[name]?.[s] ? items[name][s] : '—'}
                  </td>
                ))}
                <td className="num"><strong>{itemTotals[name] || '—'}</strong></td>
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              {stores.map((s) => (
                <td key={s} className="num">{storeTotals[s] || '—'}</td>
              ))}
              <td className="num">{grand || '—'}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
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
  const totalsByItem: Record<string, number> = {};
  let grandTotal = 0;
  for (const item of itemNames) {
    for (const [store, qty] of Object.entries(items[item] ?? {})) {
      totalsByStore[store] = (totalsByStore[store] ?? 0) + qty;
      totalsByItem[item] = (totalsByItem[item] ?? 0) + qty;
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
      {/* overflow-x: auto so on narrow viewports (chromebooks/tablets)
          the table can scroll horizontally inside the card instead of
          getting clipped by the outer card's overflow:hidden. */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontSize: 13, fontFamily: 'var(--font-body)',
          minWidth: 460,
        }}>
          <thead>
            <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
              <Th>Item</Th>
              {stores.map((s) => <Th key={s} align="right">{s}</Th>)}
              <Th align="right">Total</Th>
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
                <Td align="right" style={delivRowTotalCell}>
                  {totalsByItem[name] ? fmtNum(totalsByItem[name]) : <span style={{ color: 'rgba(0,0,0,0.18)' }}>—</span>}
                </Td>
              </tr>
            ))}
            {itemNames.length === 0 && (
              <tr><Td colSpan={2 + stores.length} style={{
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
                <Td align="right" style={delivRowTotalCell}>
                  {grandTotal > 0 ? fmtNum(grandTotal) : <span style={{ color: 'rgba(0,0,0,0.18)' }}>—</span>}
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
  // Override the default Td padding (8px 14px) so 6-column tables
  // (Item + G1-G4 + Total) get more horizontal breathing room and
  // numbers don't crowd up against G4's right edge.
  padding: '8px 18px',
};
const delivRowTotalCell: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums', color: '#1a1a1a',
  fontWeight: 700,
  padding: '8px 18px',
  borderLeft: '1px solid rgba(0,0,0,0.06)',
  background: 'rgba(0,0,0,0.02)',
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
