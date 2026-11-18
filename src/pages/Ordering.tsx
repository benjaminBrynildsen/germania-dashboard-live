import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useIsMobile } from '../hooks/useIsMobile';
import { STORE_CITIES, getTheme } from '../lib/store-themes';

// Supply ordering — the vendor side of the Ordering tab. Each store fills a
// weekly cart (in cases), then one Review & send emails the vendor a single
// detailed order covering every store. Bake Haus is the other half of
// ordering and keeps its own page; it's linked from the vendor switcher.

const VENDOR = 'meridian';
const VENDOR_NAME = 'Meridian';

interface Item {
  id: number;
  name: string;
  sku: string | null;
  packLabel: string | null;
  orderUnit: string;
  price: number | null;
  imageUrl: string | null;
  productUrl: string | null;
  category: string;
  par: number | null;
  sort: number;
  active: boolean;
}

interface CartLine { itemId: number; qty: number; onHand: number | null; onHandCountedAt: number | null }

interface Submission {
  id: number; week: string; submittedAt: number; submittedBy: string | null;
  recipients: string; subject: string; isUpdate: boolean; isTest: boolean; totalUnits: number;
}

interface WeekCart {
  week: string;
  stores: string[];
  lines: Record<string, CartLine[]>;
  notes: Record<string, string>;
  prevWeek: Record<string, Record<string, number>>;
  lastSubmission: Submission | null;
  changedSinceSubmit: boolean;
}

interface Settings {
  orderEmails: string; ccEmails: string; accountNumber: string; deliveryNote: string;
  storeAddresses: Record<string, string>;
  emailConfigured?: boolean;
  stores?: Array<{ label: string; city: string }>;
}

// ── week helpers (Monday-start, local time — same as Bake Haus) ─────────

function isoMondayOf(d: Date): string {
  const local = new Date(d);
  const day = local.getDay();
  local.setDate(local.getDate() + (day === 0 ? -6 : 1 - day));
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}
function shiftWeeks(weekIso: string, weeks: number): string {
  const d = new Date(`${weekIso}T00:00:00`);
  d.setDate(d.getDate() + weeks * 7);
  return isoMondayOf(d);
}
function fmtWeek(weekIso: string): string {
  const s = new Date(`${weekIso}T00:00:00`);
  const e = new Date(s); e.setDate(e.getDate() + 6);
  return `Mon ${s.getMonth() + 1}/${s.getDate()} – Sun ${e.getMonth() + 1}/${e.getDate()}`;
}
function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const money = (n: number) => `$${n.toFixed(2)}`;
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const plural = (unit: string, n: number) => (n === 1 ? unit : unit.endsWith('s') ? unit : unit === 'box' ? 'boxes' : `${unit}s`);

const ORDER_UNITS = ['case', 'box', 'pack', 'sleeve', 'each'];

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16,
};
const pillBtn = (on: boolean): React.CSSProperties => ({
  padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
  fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
  border: on ? '1px solid #1a1a1a' : '1px solid rgba(0,0,0,0.12)',
  background: on ? '#1a1a1a' : '#fff', color: on ? '#fff' : 'rgba(0,0,0,0.6)',
});
const primaryBtn: React.CSSProperties = {
  padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
  background: '#1a1a1a', color: '#fff', fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
};
const secondaryBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
  border: '1px solid rgba(0,0,0,0.15)', background: '#fff', color: '#1a1a1a', fontWeight: 600, fontSize: 13,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)',
  fontSize: 14, fontFamily: 'inherit', background: '#fff', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
  color: 'rgba(0,0,0,0.5)', marginBottom: 4,
};

export default function Ordering() {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<'order' | 'sent' | 'items' | 'settings'>('order');

  return (
    <div>
      <div style={{ marginBottom: isMobile ? 14 : 18 }}>
        <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, letterSpacing: -0.5, margin: 0 }}>Ordering</h1>
        <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 14, margin: '6px 0 0', maxWidth: 760 }}>
          Weekly supply orders for every store. Fill each store's cart, then send {VENDOR_NAME} one order email that covers them all.
        </p>
      </div>

      {/* Vendor switcher. Bake Haus is the other ordering line and lives on its own page. */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ ...card, padding: '12px 16px', borderColor: '#1a1a1a', borderWidth: 2 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Meridian</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>Cups, lids & disposables</div>
        </div>
        <Link to="/bake-haus" style={{ ...card, padding: '12px 16px', textDecoration: 'none', color: 'inherit' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Bake Haus →</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>Food, syrups & sauces</div>
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(0,0,0,0.1)', marginBottom: 20, overflowX: 'auto' }}>
        {([['order', 'Current order'], ['sent', 'Sent orders'], ['items', 'Manage items'], ['settings', 'Settings']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 13, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap',
            color: tab === k ? '#1a1a1a' : 'rgba(0,0,0,0.45)',
            borderBottom: tab === k ? '2px solid #1a1a1a' : '2px solid transparent', marginBottom: -1,
          }}>{label}</button>
        ))}
      </div>

      {tab === 'order' && <CurrentOrder isMobile={isMobile} onGoSettings={() => setTab('settings')} onGoItems={() => setTab('items')} />}
      {tab === 'sent' && <SentOrders isMobile={isMobile} />}
      {tab === 'items' && <ManageItems isMobile={isMobile} />}
      {tab === 'settings' && <SettingsPanel isMobile={isMobile} />}
    </div>
  );
}

// ── Current order ──────────────────────────────────────────────────────

function CurrentOrder({ isMobile, onGoSettings, onGoItems }: { isMobile: boolean; onGoSettings: () => void; onGoItems: () => void }) {
  const [week, setWeek] = useState(() => isoMondayOf(new Date()));
  const [items, setItems] = useState<Item[]>([]);
  const [cart, setCart] = useState<WeekCart | null>(null);
  const [store, setStore] = useState('G1');
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [i, c] = await Promise.all([
        api.get(`/api/supply/${VENDOR}/items`),
        api.get(`/api/supply/${VENDOR}/week?week=${week}`),
      ]);
      setItems(i.items);
      setCart(c);
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, [week]);

  useEffect(() => { load(); }, [load]);

  const saveLine = async (itemId: number, qty: number, onHand?: number | null) => {
    try {
      await api.put(`/api/supply/${VENDOR}/line`, { week, store, itemId, qty, ...(onHand !== undefined ? { onHand } : {}) });
      await load();
    } catch (e: any) { setError(e.message); }
  };
  const saveNote = async (note: string) => {
    try { await api.put(`/api/supply/${VENDOR}/note`, { week, store, note }); await load(); }
    catch (e: any) { setError(e.message); }
  };

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Week totals across all stores — the footer and the Review button.
  const totals = useMemo(() => {
    let units = 0, cost = 0, priced = true;
    const perStore: Record<string, number> = {};
    for (const [st, ls] of Object.entries(cart?.lines ?? {})) {
      for (const l of ls) {
        if (l.qty <= 0) continue;
        units += l.qty;
        perStore[st] = (perStore[st] ?? 0) + l.qty;
        const it = itemsById.get(l.itemId);
        if (it?.price != null) cost += it.price * l.qty; else priced = false;
      }
    }
    return { units, cost, priced, perStore };
  }, [cart, itemsById]);

  const last = cart?.lastSubmission ?? null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <button style={secondaryBtn} onClick={() => setWeek(shiftWeeks(week, -1))}>‹ Prev wk</button>
        <button style={secondaryBtn} onClick={() => setWeek(isoMondayOf(new Date()))}>This week</button>
        <button style={secondaryBtn} onClick={() => setWeek(shiftWeeks(week, 1))}>Next wk ›</button>
        <span style={{ fontSize: 14, fontWeight: 600, marginLeft: 6 }}>{fmtWeek(week)}</span>
      </div>

      {/* Where this week's order stands with the vendor. */}
      {cart && (
        <div style={{
          padding: '10px 14px', borderRadius: 12, marginBottom: 14, fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          ...(last == null
            ? { background: 'rgba(0,0,0,0.035)', color: 'rgba(0,0,0,0.6)' }
            : cart.changedSinceSubmit
              ? { background: 'rgba(202,138,4,0.10)', color: '#854d0e', border: '1px solid rgba(202,138,4,0.3)' }
              : { background: 'rgba(22,163,74,0.08)', color: '#166534', border: '1px solid rgba(22,163,74,0.25)' }),
        }}>
          {last == null && <span>Not sent to {VENDOR_NAME} yet for this week.</span>}
          {last != null && !cart.changedSinceSubmit && (
            <span>✓ Sent to {VENDOR_NAME} {fmtWhen(last.submittedAt)}{last.submittedBy ? ` by ${last.submittedBy}` : ''}. Nothing has changed since.</span>
          )}
          {last != null && cart.changedSinceSubmit && (
            <span><strong>Changed since it was sent</strong> ({fmtWhen(last.submittedAt)}). Send again so {VENDOR_NAME} gets the updated order.</span>
          )}
        </div>
      )}

      {error && <div style={{ padding: 12, borderRadius: 10, background: 'rgba(220,38,38,0.08)', color: '#b91c1c', marginBottom: 14, fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {(cart?.stores ?? ['G1', 'G2', 'G3', 'G4']).map((st) => {
          const theme = getTheme(st);
          const on = st === store;
          const count = totals.perStore[st] ?? 0;
          return (
            <button key={st} onClick={() => setStore(st)} style={{
              padding: '10px 18px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
              border: on ? `2px solid ${theme.headerBg}` : '1px solid rgba(0,0,0,0.12)',
              background: on ? theme.headerBg : '#fff', color: on ? theme.headerFg : 'rgba(0,0,0,0.6)',
              fontSize: 13, fontWeight: 700, letterSpacing: 0.3,
            }}>
              {st}
              {STORE_CITIES[st] && <span style={{ marginLeft: 6, fontWeight: 500, opacity: on ? 0.85 : 0.55, textTransform: 'uppercase', fontSize: 11 }}>· {STORE_CITIES[st]}</span>}
              {count > 0 && <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.8 }}>{fmtQty(count)}</span>}
            </button>
          );
        })}
      </div>

      {cart && (
        <StoreCart
          // Keyed by store + week so nothing typed for one store survives a
          // switch to another (the Bake Haus count-bleed bug).
          key={`${store}:${week}`}
          store={store}
          items={items}
          lines={cart.lines[store] ?? []}
          prevWeek={cart.prevWeek[store] ?? {}}
          note={cart.notes[store] ?? ''}
          isMobile={isMobile}
          onSave={saveLine}
          onSaveNote={saveNote}
          onGoItems={onGoItems}
        />
      )}

      {/* Sticky send bar */}
      <div style={{
        position: 'sticky', bottom: 12, marginTop: 18, zIndex: 10,
        ...card, padding: '12px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)' }}>
          <strong style={{ color: '#1a1a1a', fontSize: 15 }}>{fmtQty(totals.units)}</strong> total units across {Object.keys(totals.perStore).length} store{Object.keys(totals.perStore).length === 1 ? '' : 's'}
          {totals.units > 0 && totals.cost > 0 && (
            <span> · est. {money(totals.cost)}{totals.priced ? '' : '+'}</span>
          )}
        </div>
        <button style={{ ...primaryBtn, opacity: totals.units > 0 ? 1 : 0.4 }} disabled={totals.units === 0} onClick={() => setReviewing(true)}>
          {last ? 'Review & send update' : `Review & send to ${VENDOR_NAME}`}
        </button>
      </div>

      {reviewing && (
        <ReviewModal week={week} onClose={() => setReviewing(false)} onSent={() => { setReviewing(false); load(); }} onGoSettings={() => { setReviewing(false); onGoSettings(); }} />
      )}
    </div>
  );
}

function StoreCart({ store, items, lines, prevWeek, note, isMobile, onSave, onSaveNote, onGoItems }: {
  store: string; items: Item[]; lines: CartLine[]; prevWeek: Record<string, number>; note: string;
  isMobile: boolean;
  onSave: (itemId: number, qty: number, onHand?: number | null) => void;
  onSaveNote: (note: string) => void;
  onGoItems: () => void;
}) {
  const theme = getTheme(store);
  const lineByItem = new Map(lines.map((l) => [l.itemId, l]));
  const [noteText, setNoteText] = useState(note);
  useEffect(() => setNoteText(note), [note]);

  const groups: Array<{ category: string; items: Item[] }> = [];
  for (const it of items) {
    const g = groups.find((x) => x.category === it.category);
    if (g) g.items.push(it); else groups.push({ category: it.category, items: [it] });
  }

  const storeUnits = lines.reduce((a, l) => a + (l.qty > 0 ? l.qty : 0), 0);
  const storeCost = lines.reduce((a, l) => {
    const it = items.find((i) => i.id === l.itemId);
    return a + (it?.price != null && l.qty > 0 ? it.price * l.qty : 0);
  }, 0);

  return (
    <div style={{ background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 18, overflow: 'hidden' }}>
      <div style={{ background: theme.headerBg, color: theme.headerFg, padding: isMobile ? '14px 16px' : '16px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{store}{STORE_CITIES[store] && <span style={{ fontWeight: 400 }}> — {STORE_CITIES[store]}</span>}</div>
        <div style={{ fontSize: 12, color: theme.accent }}>
          {fmtQty(storeUnits)} units{storeCost > 0 ? ` · est. ${money(storeCost)}` : ''}
        </div>
      </div>

      {items.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: 'rgba(0,0,0,0.5)', fontSize: 14 }}>
          No items yet. <button style={{ ...secondaryBtn, marginLeft: 8 }} onClick={onGoItems}>Add items</button>
        </div>
      )}

      {groups.map((g) => (
        <Fragment key={g.category}>
          <div style={{
            padding: isMobile ? '10px 16px' : '10px 22px', fontSize: 11, fontWeight: 700, letterSpacing: 1.1,
            textTransform: 'uppercase', color: 'rgba(0,0,0,0.5)', background: theme.rowAlt,
            borderTop: '1px solid rgba(0,0,0,0.05)',
          }}>{g.category}</div>
          {g.items.map((it) => (
            <CartRow
              key={`${store}:${it.id}`}
              item={it}
              line={lineByItem.get(it.id) ?? null}
              lastWeek={prevWeek[String(it.id)] ?? null}
              isMobile={isMobile}
              onSave={(qty, onHand) => onSave(it.id, qty, onHand)}
            />
          ))}
        </Fragment>
      ))}

      <div style={{ padding: isMobile ? '12px 16px 16px' : '14px 22px 18px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
        <label style={labelStyle}>Note for {VENDOR_NAME} ({store})</label>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onBlur={() => { if (noteText !== note) onSaveNote(noteText); }}
          placeholder="Delivery instructions, substitutions okay, etc. — included in the email."
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </div>
    </div>
  );
}

function ItemThumb({ item, size }: { item: Item; size: number }) {
  const [broken, setBroken] = useState(false);
  if (item.imageUrl && !broken) {
    return (
      <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)}
        style={{ width: size, height: size, objectFit: 'contain', borderRadius: 12, background: '#fff', border: '1px solid rgba(0,0,0,0.06)', flexShrink: 0 }} />
    );
  }
  return (
    <span title="No photo yet — add the Meridian link in Manage items" style={{
      width: size, height: size, borderRadius: 12, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.04)', color: 'rgba(0,0,0,0.22)',
    }}>
      <svg width={size * 0.46} height={size * 0.46} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
        <path d="M3 7.5 12 12l9-4.5M12 12v9" />
      </svg>
    </span>
  );
}

function CartRow({ item, line, lastWeek, isMobile, onSave }: {
  item: Item; line: CartLine | null; lastWeek: number | null; isMobile: boolean;
  onSave: (qty: number, onHand?: number | null) => void;
}) {
  const qty = line?.qty ?? 0;
  const [qtyText, setQtyText] = useState(qty > 0 ? fmtQty(qty) : '');
  useEffect(() => setQtyText(qty > 0 ? fmtQty(qty) : ''), [qty]);

  const usesPar = item.par != null && item.par > 0;
  const storedOnHand = line?.onHand ?? null;
  const [countText, setCountText] = useState(storedOnHand != null ? fmtQty(storedOnHand) : '');
  useEffect(() => setCountText(storedOnHand != null ? fmtQty(storedOnHand) : ''), [storedOnHand]);

  const commitQty = (raw: string) => {
    const n = raw.trim() === '' ? 0 : Number(raw);
    if (!Number.isFinite(n) || n < 0) { setQtyText(qty > 0 ? fmtQty(qty) : ''); return; }
    const rounded = Math.round(n * 100) / 100;
    if (rounded !== qty) onSave(rounded);
  };
  const step = (d: number) => {
    const base = Number(qtyText) || 0;
    const next = Math.max(0, Math.round((base + d) * 100) / 100);
    setQtyText(next > 0 ? fmtQty(next) : '');
    if (next !== qty) onSave(next);
  };
  const commitCount = () => {
    if (!usesPar || countText.trim() === '') return;
    const n = Number(countText);
    if (!Number.isFinite(n) || n < 0) return;
    const target = Math.max(0, Math.round(((item.par as number) - n) * 100) / 100);
    if (n === storedOnHand && target === qty) return;
    setQtyText(target > 0 ? fmtQty(target) : '');
    onSave(target, n);
  };

  const countAge = (() => {
    const at = line?.onHandCountedAt;
    if (storedOnHand == null || at == null) return null;
    const hrs = (Date.now() - at) / 3_600_000;
    if (hrs < 1) return { label: 'counted just now', stale: false };
    if (hrs < 24) return { label: `counted ${Math.round(hrs)}h ago`, stale: false };
    return { label: `counted ${Math.round(hrs / 24)}d ago — recount?`, stale: true };
  })();

  const active = qty > 0;
  const chip: React.CSSProperties = { padding: '2px 8px', borderRadius: 999, background: 'rgba(0,0,0,0.05)', color: 'rgba(0,0,0,0.55)', whiteSpace: 'nowrap' };

  return (
    <div style={{
      display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? 12 : 18,
      padding: isMobile ? '12px 16px' : '14px 22px', borderTop: '1px solid rgba(0,0,0,0.05)',
      flexDirection: isMobile ? 'column' : 'row',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
        <ItemThumb item={item} size={isMobile ? 52 : 64} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 600, color: active ? '#1a1a1a' : 'rgba(0,0,0,0.55)', overflowWrap: 'anywhere' }}>
            {item.name}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 5, fontSize: 11, fontWeight: 600, alignItems: 'center' }}>
            {item.sku && <span style={{ ...chip, fontFamily: 'ui-monospace, Menlo, monospace' }}>#{item.sku}</span>}
            {item.packLabel && <span style={chip}>{item.packLabel}</span>}
            {item.price != null && <span style={chip}>{money(item.price)}/{item.orderUnit}</span>}
            {usesPar && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'rgba(0,0,0,0.5)' }}>ON HAND</span>
                <input
                  type="number" inputMode="decimal" min={0} value={countText} placeholder="count"
                  onChange={(e) => setCountText(e.target.value)} onBlur={commitCount}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  title={`Count what's on the shelf — the order fills itself up to the par of ${item.par}`}
                  style={{ width: 62, padding: '3px 6px', borderRadius: 7, border: '1.5px solid rgba(37,99,235,0.4)', fontSize: 13, fontWeight: 700, textAlign: 'center', fontFamily: 'inherit' }}
                />
                <span style={{ ...chip, background: 'rgba(37,99,235,0.07)', color: '#1d4ed8' }}>par {fmtQty(item.par as number)}</span>
                {countAge && (
                  <span style={countAge.stale
                    ? { ...chip, background: 'rgba(202,138,4,0.12)', color: '#a16207', border: '1px solid rgba(202,138,4,0.35)' }
                    : { color: 'rgba(0,0,0,0.35)' }}>{countAge.label}</span>
                )}
              </span>
            )}
            {lastWeek != null && (
              <button onClick={() => { setQtyText(fmtQty(lastWeek)); onSave(lastWeek); }} disabled={qty === lastWeek}
                title={qty === lastWeek ? "Matches last week's order" : `Use last week's ${fmtQty(lastWeek)}`}
                style={{ ...chip, border: 'none', cursor: qty === lastWeek ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600, opacity: qty === lastWeek ? 0.6 : 1 }}>
                {qty === lastWeek ? '✓ ' : '↺ '}last wk {fmtQty(lastWeek)}
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, alignSelf: isMobile ? 'stretch' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 10, background: '#fff', overflow: 'hidden' }}>
          <button onClick={() => step(-1)} style={{ width: 36, height: 38, border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(0,0,0,0.6)' }}>−</button>
          <input
            type="number" inputMode="decimal" min={0} value={qtyText} placeholder="0"
            onChange={(e) => setQtyText(e.target.value)}
            onBlur={(e) => commitQty(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            style={{ width: 54, height: 38, border: 'none', borderLeft: '1px solid rgba(0,0,0,0.08)', borderRight: '1px solid rgba(0,0,0,0.08)', textAlign: 'center', fontSize: 16, fontWeight: 700, fontFamily: 'inherit' }}
          />
          <button onClick={() => step(1)} style={{ width: 36, height: 38, border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(0,0,0,0.6)' }}>+</button>
        </div>
        <div style={{ width: 86, textAlign: 'right', fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
          {plural(item.orderUnit, qty || 2)}
          {active && item.price != null && <div style={{ fontWeight: 700, color: '#1a1a1a', fontSize: 13 }}>{money(item.price * qty)}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Review & send ──────────────────────────────────────────────────────

interface Preview {
  subject: string; html: string; to: string[]; cc: string[]; isUpdate: boolean;
  totalUnits: number; storeCount: number; problems: string[]; testRecipient: string | null;
}

function ReviewModal({ week, onClose, onSent, onGoSettings }: { week: string; onClose: () => void; onSent: () => void; onGoSettings: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<null | 'test' | 'real'>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api.get(`/api/supply/${VENDOR}/preview?week=${week}`).then(setPreview).catch((e) => setError(e.message));
  }, [week]);

  const send = async (test: boolean) => {
    if (!test && !confirm(`Email this order to ${VENDOR_NAME} now?\n\nTo: ${preview?.to.join(', ')}`)) return;
    setSending(test ? 'test' : 'real');
    setError(null);
    try {
      await api.post(`/api/supply/${VENDOR}/submit`, { week, test });
      if (test) setNotice(`Test sent to ${preview?.testRecipient}. Check your inbox — ${VENDOR_NAME} did not get it.`);
      else onSent();
    } catch (e: any) { setError(e.message); }
    finally { setSending(null); }
  };

  const blocking = (preview?.problems ?? []).filter((p) => !p.startsWith('Outgoing email'));
  const emailDown = (preview?.problems ?? []).some((p) => p.startsWith('Outgoing email'));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(760px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{preview?.isUpdate ? 'Send updated order' : `Send order to ${VENDOR_NAME}`}</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>This is exactly the email {VENDOR_NAME} will receive.</div>
          </div>
          <button onClick={onClose} style={{ ...secondaryBtn, padding: '6px 12px' }}>✕</button>
        </div>

        {preview && (
          <div style={{ padding: '12px 20px', fontSize: 13, borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
            <span style={{ color: 'rgba(0,0,0,0.45)' }}>To</span><span style={{ fontWeight: 600 }}>{preview.to.join(', ') || '— not set —'}</span>
            {preview.cc.length > 0 && (<><span style={{ color: 'rgba(0,0,0,0.45)' }}>CC</span><span>{preview.cc.join(', ')}</span></>)}
            <span style={{ color: 'rgba(0,0,0,0.45)' }}>Subject</span><span>{preview.subject}</span>
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', background: '#f4f1ea', minHeight: 240 }}>
          {!preview && !error && <div style={{ padding: 30, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Building the email…</div>}
          {preview && <iframe title="Order email preview" srcDoc={preview.html} sandbox="" style={{ width: '100%', height: '60vh', border: 'none', display: 'block' }} />}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
          {error && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{error}</div>}
          {notice && <div style={{ color: '#166534', fontSize: 13, marginBottom: 10 }}>{notice}</div>}
          {blocking.length > 0 && (
            <div style={{ fontSize: 13, color: '#854d0e', marginBottom: 10 }}>
              {blocking.map((p) => <div key={p}>• {p}</div>)}
              {blocking.some((p) => p.includes('Settings')) && <button style={{ ...secondaryBtn, marginTop: 8 }} onClick={onGoSettings}>Open Settings</button>}
            </div>
          )}
          {emailDown && (
            <div style={{ fontSize: 13, color: '#854d0e', marginBottom: 10 }}>
              • Outgoing email isn't set up on the server yet, so sending will fail until it is.
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button style={secondaryBtn} disabled={!preview?.testRecipient || sending != null || (preview?.totalUnits ?? 0) === 0}
              onClick={() => send(true)} title={preview?.testRecipient ? `Sends only to ${preview.testRecipient}` : ''}>
              {sending === 'test' ? 'Sending…' : 'Send test to me'}
            </button>
            <button style={{ ...primaryBtn, opacity: blocking.length || sending ? 0.45 : 1 }} disabled={blocking.length > 0 || sending != null} onClick={() => send(false)}>
              {sending === 'real' ? 'Sending…' : preview?.isUpdate ? `Send update to ${VENDOR_NAME}` : `Send to ${VENDOR_NAME}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sent orders ────────────────────────────────────────────────────────

function SentOrders({ isMobile }: { isMobile: boolean }) {
  const [subs, setSubs] = useState<Submission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Submission | null>(null);
  useEffect(() => {
    api.get(`/api/supply/${VENDOR}/submissions`).then((r) => setSubs(r.submissions)).catch((e) => setError(e.message));
  }, []);

  if (error) return <div style={{ color: '#b91c1c' }}>{error}</div>;
  if (!subs) return <div style={{ color: 'rgba(0,0,0,0.4)' }}>Loading…</div>;
  if (subs.length === 0) return <div style={{ ...card, padding: 24, color: 'rgba(0,0,0,0.5)', textAlign: 'center' }}>No orders sent yet.</div>;

  const badge = (text: string, bg: string, fg: string) => (
    <span style={{ padding: '2px 8px', borderRadius: 999, background: bg, color: fg, fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>{text}</span>
  );

  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      {subs.map((s, i) => (
        <div key={s.id} style={{
          display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', gap: 12, padding: '14px 18px',
          borderTop: i === 0 ? 'none' : '1px solid rgba(0,0,0,0.06)', flexDirection: isMobile ? 'column' : 'row',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Week of {fmtWeek(s.week)}</span>
              {s.isTest && badge('TEST', 'rgba(0,0,0,0.07)', 'rgba(0,0,0,0.6)')}
              {s.isUpdate && badge('UPDATE', 'rgba(202,138,4,0.12)', '#a16207')}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginTop: 3 }}>
              {fmtWhen(s.submittedAt)}{s.submittedBy ? ` · ${s.submittedBy}` : ''} · {fmtQty(s.totalUnits)} units · to {s.recipients}
            </div>
          </div>
          <button style={secondaryBtn} onClick={() => setViewing(s)}>View email</button>
        </div>
      ))}
      {viewing && (
        <div onClick={() => setViewing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(760px, 100%)', height: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{viewing.subject}</span>
              <button style={{ ...secondaryBtn, padding: '6px 12px' }} onClick={() => setViewing(null)}>✕</button>
            </div>
            <iframe title="Sent email" src={`/api/supply/submissions/${viewing.id}/html`} sandbox="" style={{ flex: 1, border: 'none', background: '#f4f1ea' }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Manage items ───────────────────────────────────────────────────────

function ManageItems({ isMobile }: { isMobile: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems((await api.get(`/api/supply/${VENDOR}/items?all=1`)).items); }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);

  const move = async (idx: number, dir: -1 | 1) => {
    const a = items[idx], b = items[idx + dir];
    if (!a || !b) return;
    try {
      await api.put(`/api/supply/items/${a.id}`, { sort: b.sort });
      await api.put(`/api/supply/items/${b.id}`, { sort: a.sort === b.sort ? a.sort + dir : a.sort });
      await load();
    } catch (e: any) { setError(e.message); }
  };

  const missingLinks = items.filter((i) => i.active && !i.productUrl).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', maxWidth: 620 }}>
          Paste an item's {VENDOR_NAME} product link into its form to pull in the photo, item number, price, and case size automatically.
          {missingLinks > 0 && <strong style={{ color: '#a16207' }}> {missingLinks} item{missingLinks === 1 ? '' : 's'} still need a link.</strong>}
        </div>
        <button style={primaryBtn} onClick={() => setEditing('new')}>+ Add item</button>
      </div>
      {error && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{error}</div>}

      {editing === 'new' && (
        <ItemForm categories={categories} isMobile={isMobile} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}

      <div style={{ ...card, overflow: 'hidden' }}>
        {items.map((it, idx) => (
          <Fragment key={it.id}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
              borderTop: idx === 0 ? 'none' : '1px solid rgba(0,0,0,0.06)', opacity: it.active ? 1 : 0.5,
            }}>
              <ItemThumb item={it} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {it.name}
                  {!it.active && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.45)' }}>HIDDEN</span>}
                  {it.active && !it.productUrl && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#a16207', background: 'rgba(202,138,4,0.12)', padding: '2px 6px', borderRadius: 999 }}>NEEDS LINK</span>}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>
                  {[it.category, it.sku ? `#${it.sku}` : null, it.packLabel, it.price != null ? `${money(it.price)}/${it.orderUnit}` : null, it.par != null ? `par ${fmtQty(it.par)}` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              {!isMobile && (
                <>
                  <button style={{ ...secondaryBtn, padding: '4px 9px' }} disabled={idx === 0} onClick={() => move(idx, -1)} title="Move up">↑</button>
                  <button style={{ ...secondaryBtn, padding: '4px 9px' }} disabled={idx === items.length - 1} onClick={() => move(idx, 1)} title="Move down">↓</button>
                </>
              )}
              <button style={secondaryBtn} onClick={() => setEditing(editing === it.id ? null : it.id)}>{editing === it.id ? 'Close' : 'Edit'}</button>
            </div>
            {editing === it.id && (
              <div style={{ padding: '0 16px 14px' }}>
                <ItemForm item={it} categories={categories} isMobile={isMobile} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function ItemForm({ item, categories, isMobile, onCancel, onSaved }: {
  item?: Item; categories: string[]; isMobile: boolean; onCancel: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: item?.name ?? '', category: item?.category ?? (categories[0] ?? 'Other'), sku: item?.sku ?? '',
    packLabel: item?.packLabel ?? '', orderUnit: item?.orderUnit ?? 'case',
    price: item?.price != null ? String(item.price) : '', par: item?.par != null ? String(item.par) : '',
    imageUrl: item?.imageUrl ?? '', productUrl: item?.productUrl ?? '', active: item?.active ?? true,
  });
  const [link, setLink] = useState(item?.productUrl ?? '');
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [newCategory, setNewCategory] = useState(false);
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  const doImport = async () => {
    if (!link.trim()) return;
    setImporting(true); setMsg(null);
    try {
      const p = await api.post(`/api/supply/${VENDOR}/import`, { url: link.trim() });
      setF((prev) => ({
        ...prev,
        // Keep a hand-typed name if there is one; vendor titles are often SHOUTY.
        name: prev.name.trim() ? prev.name : (p.name ?? ''),
        sku: p.sku ?? prev.sku,
        packLabel: p.packLabel ?? prev.packLabel,
        price: p.price != null ? String(p.price) : prev.price,
        imageUrl: p.imageUrl ?? prev.imageUrl,
        productUrl: p.productUrl,
      }));
      const got = [p.imageUrl && 'photo', p.sku && 'item #', p.price != null && 'price', p.packLabel && 'case size'].filter(Boolean);
      setMsg({ ok: true, text: `Pulled ${got.length ? got.join(', ') : 'the page'}${p.name ? ` from "${p.name}"` : ''}. Check it, then Save.` });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    finally { setImporting(false); }
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    const body = {
      name: f.name, category: f.category, sku: f.sku, packLabel: f.packLabel, orderUnit: f.orderUnit,
      price: f.price === '' ? null : Number(f.price), par: f.par === '' ? null : Number(f.par),
      imageUrl: f.imageUrl, productUrl: f.productUrl, active: f.active,
    };
    try {
      if (item) await api.put(`/api/supply/items/${item.id}`, body);
      else await api.post(`/api/supply/${VENDOR}/items`, body);
      onSaved();
    } catch (e: any) { setMsg({ ok: false, text: e.message }); setSaving(false); }
  };

  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)', gap: 12 };

  return (
    <div style={{ ...card, padding: 16, background: 'rgba(0,0,0,0.02)', marginBottom: 14 }}>
      <label style={labelStyle}>{VENDOR_NAME} product link</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://meridianrs.com/…" style={inputStyle}
          onKeyDown={(e) => { if (e.key === 'Enter') doImport(); }} />
        <button style={{ ...secondaryBtn, whiteSpace: 'nowrap' }} onClick={doImport} disabled={importing || !link.trim()}>{importing ? 'Pulling…' : 'Pull details'}</button>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: msg.ok ? '#166534' : '#b91c1c', marginBottom: 8 }}>{msg.text}</div>}

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginTop: 10 }}>
        <ItemThumb item={{ ...(item ?? ({} as Item)), name: f.name || '?', imageUrl: f.imageUrl || null }} size={84} />
        <div style={{ flex: 1, display: 'grid', gap: 12 }}>
          <div style={grid}>
            <div style={{ gridColumn: isMobile ? 'auto' : 'span 2' }}>
              <label style={labelStyle}>Name</label>
              <input value={f.name} onChange={(e) => set('name', e.target.value)} style={inputStyle} placeholder="e.g. Hot Cup 16 oz" />
            </div>
            <div style={{ gridColumn: isMobile ? 'auto' : 'span 2' }}>
              <label style={labelStyle}>Category</label>
              {newCategory || categories.length === 0 ? (
                <input value={f.category} onChange={(e) => set('category', e.target.value)} style={inputStyle} placeholder="New category" autoFocus={newCategory} />
              ) : (
                <select value={f.category} onChange={(e) => { if (e.target.value === '__new') { setNewCategory(true); set('category', ''); } else set('category', e.target.value); }} style={inputStyle}>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value="__new">New category…</option>
                </select>
              )}
            </div>
          </div>
          <div style={grid}>
            <div><label style={labelStyle}>Item #</label><input value={f.sku} onChange={(e) => set('sku', e.target.value)} style={inputStyle} /></div>
            <div><label style={labelStyle}>Pack</label><input value={f.packLabel} onChange={(e) => set('packLabel', e.target.value)} style={inputStyle} placeholder="1000/case" /></div>
            <div>
              <label style={labelStyle}>Order by</label>
              <select value={f.orderUnit} onChange={(e) => set('orderUnit', e.target.value)} style={inputStyle}>
                {[...new Set([...ORDER_UNITS, f.orderUnit])].map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div><label style={labelStyle}>Price / {f.orderUnit}</label><input type="number" min={0} step="0.01" value={f.price} onChange={(e) => set('price', e.target.value)} style={inputStyle} placeholder="est." /></div>
          </div>
          <div style={grid}>
            <div>
              <label style={labelStyle}>Par (optional)</label>
              <input type="number" min={0} step="0.5" value={f.par} onChange={(e) => set('par', e.target.value)} style={inputStyle} placeholder="none" title="With a par, stores type their shelf count and the order fills itself up to the par" />
            </div>
            <div style={{ gridColumn: isMobile ? 'auto' : 'span 3' }}>
              <label style={labelStyle}>Photo URL</label>
              <input value={f.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} style={inputStyle} placeholder="filled in by Pull details" />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', margin: 0, flexShrink: 0 }}>
          <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} style={{ width: 'auto', margin: 0 }} />
          Show on the order form
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={secondaryBtn} onClick={onCancel}>Cancel</button>
          <button style={{ ...primaryBtn, opacity: saving || !f.name.trim() ? 0.5 : 1 }} disabled={saving || !f.name.trim()} onClick={save}>{saving ? 'Saving…' : item ? 'Save' : 'Add item'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Settings ───────────────────────────────────────────────────────────

function SettingsPanel({ isMobile }: { isMobile: boolean }) {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get(`/api/supply/${VENDOR}/settings`).then(setS).catch((e) => setMsg({ ok: false, text: e.message }));
  }, []);

  if (!s) return <div style={{ color: 'rgba(0,0,0,0.4)' }}>{msg?.text ?? 'Loading…'}</div>;

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const next = await api.put(`/api/supply/${VENDOR}/settings`, {
        orderEmails: s.orderEmails, ccEmails: s.ccEmails, accountNumber: s.accountNumber,
        deliveryNote: s.deliveryNote, storeAddresses: s.storeAddresses,
      });
      setS({ ...s, ...next });
      setMsg({ ok: true, text: 'Saved.' });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    finally { setSaving(false); }
  };

  const stores = s.stores ?? ['G1', 'G2', 'G3', 'G4'].map((l) => ({ label: l, city: STORE_CITIES[l] ?? '' }));

  return (
    <div style={{ ...card, padding: isMobile ? 16 : 22, maxWidth: 820 }}>
      {s.emailConfigured === false && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(202,138,4,0.10)', color: '#854d0e', fontSize: 13, marginBottom: 16 }}>
          Outgoing email isn't set up on the server yet (the same Gmail settings Bake Haus uses). Orders can be built and previewed, but sending will fail until it is.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
        <div>
          <label style={labelStyle}>{VENDOR_NAME} order email(s)</label>
          <input value={s.orderEmails} onChange={(e) => setS({ ...s, orderEmails: e.target.value })} style={inputStyle} placeholder="orders@…, rep@…" />
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>Where orders go. Separate several with commas.</div>
        </div>
        <div>
          <label style={labelStyle}>Copy us at</label>
          <input value={s.ccEmails} onChange={(e) => setS({ ...s, ccEmails: e.target.value })} style={inputStyle} placeholder="ops@…" />
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>Gets a copy of every order, and {VENDOR_NAME}'s replies come here.</div>
        </div>
        <div>
          <label style={labelStyle}>Account #</label>
          <input value={s.accountNumber} onChange={(e) => setS({ ...s, accountNumber: e.target.value })} style={inputStyle} placeholder="optional" />
        </div>
        <div>
          <label style={labelStyle}>Delivery instructions</label>
          <input value={s.deliveryNote} onChange={(e) => setS({ ...s, deliveryNote: e.target.value })} style={inputStyle} placeholder="e.g. Thursday mornings, before 10am" />
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <label style={labelStyle}>Delivery addresses</label>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
          {stores.map((st) => (
            <div key={st.label}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{st.label} — {STORE_CITIES[st.label] ?? st.city}</div>
              <textarea rows={2} value={s.storeAddresses[st.label] ?? ''} placeholder="Street, city"
                onChange={(e) => setS({ ...s, storeAddresses: { ...s.storeAddresses, [st.label]: e.target.value } })}
                style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
        <button style={primaryBtn} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        {msg && <span style={{ fontSize: 13, color: msg.ok ? '#166534' : '#b91c1c' }}>{msg.text}</span>}
      </div>
    </div>
  );
}
