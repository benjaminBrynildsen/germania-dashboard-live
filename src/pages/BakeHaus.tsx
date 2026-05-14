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
  byStore: Record<string, OrderRow[]>;
  deliverySummary: {
    mon: Record<string, Record<string, number>>;
    wed: Record<string, Record<string, number>>;
    fri: Record<string, Record<string, number>>;
  };
}

interface CatalogItem { name: string; sort: number }

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
  const [weekIso, setWeekIso] = useState<string>(isoMondayOf(new Date()));
  const [report, setReport] = useState<WeekReport | null>(null);
  const [stores, setStores] = useState<string[]>(['G1', 'G2', 'G3', 'G4']);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Bake Haus</h1>
        <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
          Weekly food orders to Chef Maggie, auto-split into the three Mon/Wed/Fri deliveries
          (3–5pm). Each delivery gets a share weighted by how many days it covers
          — 2/7 for Mon and Wed, 3/7 for Fri (covers the weekend). Syrups + sauces
          are tracked separately on the chef's prep schedule.
        </p>
      </div>

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

      {error && (
        <div style={{
          background: '#fee2e2', color: '#b91c1c', padding: '10px 14px',
          borderRadius: 8, marginBottom: 14, fontSize: 13,
        }}>{error}</div>
      )}

      {loading && !report && (
        <div style={{ color: 'rgba(0,0,0,0.4)', padding: 24 }}>Loading…</div>
      )}

      {report && (
        <>
          {/* Per-store order cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
            gap: 16, marginBottom: 32,
          }}>
            {stores.map((store) => (
              <StoreOrderCard key={store}
                store={store}
                rows={report.byStore[store] ?? []}
                catalog={catalog}
                onSave={(item, qty) => saveItem(store, item, qty)}
                onDelete={(item) => deleteItem(store, item)}
              />
            ))}
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
    </div>
  );
}

function StoreOrderCard({
  store, rows, catalog, onSave, onDelete,
}: {
  store: string;
  rows: OrderRow[];
  catalog: CatalogItem[];
  onSave: (item: string, qty: number) => void;
  onDelete: (item: string) => void;
}) {
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
    const cart: Array<{ name: string; row: OrderRow | null; sort: number; custom: boolean }> = catalog.map((c) => ({
      name: c.name,
      row: rowByName.get(c.name) ?? null,
      sort: c.sort,
      custom: false,
    }));
    // Append any rows whose item isn't in the catalog — these are ad-hoc
    // additions and live at the bottom so they don't break the catalog
    // ordering.
    for (const r of rows) {
      if (!catalogNames.has(r.itemName)) {
        cart.push({ name: r.itemName, row: r, sort: 9999, custom: true });
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
      background: '#fff', borderRadius: 14,
      border: '1px solid rgba(0,0,0,0.07)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
      padding: 0, overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.05)',
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: 16, fontWeight: 700, letterSpacing: -0.2,
        }}>{store}</span>
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
          {orderedRows.length} items · {total} total
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
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
              row={it.row}
              isCustom={it.custom}
              onSave={(qty) => onSave(it.name, qty)}
              onDelete={() => onDelete(it.name)}
            />
          ))}
        </tbody>
      </table>
      <div style={{ padding: '10px 18px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
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
              }}
            />
            <button onClick={() => {
              const name = newName.trim();
              if (!name) { setAdding(false); return; }
              // Save a 1 so it appears in the cart with a real value;
              // user can edit from there.
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
            fontSize: 11, color: 'rgba(0,0,0,0.45)',
          }}>+ Add custom item</button>
        )}
      </div>
    </div>
  );
}

function CartRowEditor({
  itemName, row, isCustom, onSave, onDelete,
}: {
  itemName: string;
  row: OrderRow | null;
  isCustom: boolean;
  onSave: (qty: number) => void;
  onDelete: () => void;
}) {
  const currentQty = row?.weeklyQty ?? 0;
  const [qtyText, setQtyText] = useState<string>(currentQty > 0 ? currentQty.toString() : '');

  useEffect(() => {
    setQtyText(currentQty > 0 ? currentQty.toString() : '');
  }, [currentQty]);

  const active = currentQty > 0;
  return (
    <tr style={{
      borderTop: '1px solid rgba(0,0,0,0.05)',
      background: active ? 'transparent' : 'rgba(0,0,0,0.015)',
    }}>
      <Td>
        <span style={{
          color: active ? '#1a1a1a' : 'rgba(0,0,0,0.45)',
          fontWeight: active ? 500 : 400,
        }}>
          {itemName}
          {isCustom && (
            <span style={{
              marginLeft: 6, fontSize: 9, fontWeight: 700,
              color: 'rgba(0,0,0,0.35)', letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}>custom</span>
          )}
        </span>
      </Td>
      <Td align="right">
        <input type="number" min={0} max={100000} step={0.5}
          value={qtyText}
          placeholder="0"
          onChange={(e) => setQtyText(e.target.value)}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            const next = raw === '' ? 0 : Number(raw);
            if (!Number.isFinite(next) || next < 0) {
              setQtyText(currentQty > 0 ? currentQty.toString() : '');
              return;
            }
            if (next === currentQty) return;
            if (next <= 0 && currentQty > 0) onDelete();
            else if (next > 0) onSave(next);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          style={{
            width: 64, padding: '3px 8px', borderRadius: 6,
            border: '1px solid rgba(0,0,0,0.15)', fontSize: 13,
            fontVariantNumeric: 'tabular-nums', textAlign: 'right',
            background: active ? '#fff' : 'rgba(0,0,0,0.02)',
            color: active ? '#1a1a1a' : 'rgba(0,0,0,0.5)',
          }}
        />
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
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
            <Th>Item</Th>
            {stores.map((s) => <Th key={s} align="right">{s}</Th>)}
          </tr>
        </thead>
        <tbody>
          {itemNames.map((name) => (
            <tr key={name} style={{ borderTop: '1px solid rgba(0,0,0,0.04)' }}>
              <Td>{name}</Td>
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
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
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
