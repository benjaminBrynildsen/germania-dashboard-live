import { useState, useMemo, useEffect, useRef } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import { useSearchParams } from 'react-router-dom';
import TicketVsSalesCard from '../components/TicketVsSalesCard';

const LOC_NAMES: Record<string, string> = {
  G1: 'G1 - Alton', G2: 'G2 - Godfrey', G3: 'G3 - East Gate', G4: 'G4 - Jerseyville',
};
const HOURS = ['6AM','7AM','8AM','9AM','10AM','11AM','12PM','1PM','2PM','3PM','4PM','5PM'];
// Server returns days indexed Sun..Sat (JS getDay() order); display Sun-first
// to stay consistent with the rest of the dashboard.
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const LOCS = ['G1','G2','G3','G4'];

interface TicketWeek {
  weekNum: number;
  dates: string[];
  data: Record<string, {
    hours: Record<string, (number | null)[]>;
    tickets?: Record<string, (number | null)[]>;
    salesCents?: Record<string, (number | null)[]>;
  }>;
}

type ViewMode = 'time' | 'transactions' | 'sales';

function fmtMoneyShort(cents: number | null): string {
  if (cents === null || cents === undefined) return '—';
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  return `$${Math.round(dollars)}`;
}

function avg(arr: (number | null)[]): number | null {
  const valid = arr.filter((v): v is number => v !== null);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function sum(arr: (number | null)[]): number | null {
  const valid = arr.filter((v): v is number => v !== null);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0);
}

function cellStyle(val: number | null): React.CSSProperties {
  if (val === null) return { background: 'rgba(0,0,0,0.03)', color: 'rgba(0,0,0,0.2)' };
  if (val > 20) return { background: '#f3e8ff', color: '#7c3aed', fontWeight: 700 };
  if (val >= 8) return { background: '#fee2e2', color: '#dc2626', fontWeight: 700 };
  if (val >= 5) return { background: '#fef9c3', color: '#a16207', fontWeight: 600 };
  return { background: '#dcfce7', color: '#15803d', fontWeight: 600 };
}

// Heatmap for transactions/sales: ramps blue→orange based on intensity.
// `t` is 0..1; null returns the muted empty-cell style.
function heatStyle(val: number | null, max: number): React.CSSProperties {
  if (val === null || val === 0) return { background: 'rgba(0,0,0,0.03)', color: 'rgba(0,0,0,0.2)' };
  const t = max > 0 ? Math.min(1, val / max) : 0;
  // Low = cool blue, mid = green, high = warm orange. Keep text dark enough.
  if (t >= 0.75) return { background: '#fde68a', color: '#92400e', fontWeight: 700 };
  if (t >= 0.5)  return { background: '#dcfce7', color: '#15803d', fontWeight: 700 };
  if (t >= 0.25) return { background: '#e0f2fe', color: '#0369a1', fontWeight: 600 };
  return { background: '#f1f5f9', color: '#475569', fontWeight: 500 };
}

function fmt(val: number | null): string {
  if (val === null) return '—';
  if (val > 20) return `${val.toFixed(0)}⚠`;
  return val.toFixed(1);
}

function fmtInt(val: number | null): string {
  if (val === null || val === 0) return '—';
  return String(Math.round(val));
}

function getWeekAvg(week: TicketWeek | null, loc: string): number | null {
  if (!week) return null;
  const d = week.data[loc];
  if (!d) return null;
  const vals: number[] = [];
  HOURS.forEach((h) =>
    ((d.hours || {})[h] || []).forEach((v) => { if (v !== null && v <= 20) vals.push(v); }),
  );
  return avg(vals);
}

export default function TicketTime() {
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const initialLoc = LOCS.includes(searchParams.get('loc') || '') ? searchParams.get('loc')! : 'G1';
  const [activeLoc, setActiveLoc] = useState(initialLoc);
  // -1 = current in-progress week (default), 0 = last completed week, 1+ = older.
  const [weekOffset, setWeekOffset] = useState(-1);

  const [week, setWeek] = useState<TicketWeek | null>(null);
  const [prevWeek, setPrevWeek] = useState<TicketWeek | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('time');
  // Rectangle selection: hour-index pair × day-index pair.
  // null = no selection; both corners equal = single-cell selection.
  const [selection, setSelection] = useState<{
    startHour: number;
    startDay: number;
    endHour: number;
    endDay: number;
  } | null>(null);
  const draggingRef = useRef(false);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);

  // Reset selection whenever the underlying data the grid is showing
  // changes — selection coordinates are meaningless against a different
  // location or week.
  useEffect(() => { setSelection(null); }, [activeLoc, weekOffset]);

  // Release the drag state on mouseup anywhere on the page (so a drag
  // that ends outside the grid still commits cleanly) and clear the
  // selection on Escape.
  useEffect(() => {
    const onUp = () => { draggingRef.current = false; };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Click outside the grid container clears the selection. mousedown
  // listener so a fresh drag inside the grid doesn't immediately fire
  // this and wipe its own freshly-set selection.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = gridContainerRef.current;
      if (!root) return;
      if (e.target instanceof Node && root.contains(e.target)) return;
      setSelection(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const [curRes, prevRes] = await Promise.all([
          fetch(`/api/dripos/ticket-time?weekOffset=${weekOffset}`, { cache: 'no-store' }),
          fetch(`/api/dripos/ticket-time?weekOffset=${weekOffset + 1}`, { cache: 'no-store' }),
        ]);
        const cur = await curRes.json();
        const prev = await prevRes.json();
        if (cancelled) return;
        if (!curRes.ok) throw new Error(cur.message || cur.error || 'Ticket time failed');
        setWeek(cur.week);
        setPrevWeek(prevRes.ok ? prev.week : null);
      } catch (err: any) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [weekOffset]);

  const weekOptions = useMemo(() => {
    const fmtDate = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    const today = new Date();
    // Anchor offset 0 on the most-recently-completed Sun-Sat — must match
    // the server's weekBounds() in server/dripos.ts, otherwise the label
    // says one week and the data is from a different week. `|| 7` keeps
    // Saturday from anchoring on the in-progress week.
    const daysSinceSat = ((today.getDay() + 1) % 7) || 7;
    const sun0 = new Date(today);
    sun0.setDate(today.getDate() - daysSinceSat - 6);
    const opts: Array<{ offset: number; label: string }> = [];

    // Offset -1 = in-progress week (Sunday after sun0). Partial data through
    // today; server keys the cache on the actual date range, so refreshes
    // through the day pull whatever new hours have arrived from Dripos.
    const thisWeekSun = new Date(sun0);
    thisWeekSun.setDate(sun0.getDate() + 7);
    const thisWeekSat = new Date(thisWeekSun);
    thisWeekSat.setDate(thisWeekSun.getDate() + 6);
    opts.push({
      offset: -1,
      label: `This week · ${fmtDate(thisWeekSun)}–${fmtDate(thisWeekSat)}`,
    });

    for (let i = 0; i < 12; i++) {
      const sun = new Date(sun0);
      sun.setDate(sun0.getDate() - 7 * i);
      const sat = new Date(sun);
      sat.setDate(sun.getDate() + 6);
      const range = `${fmtDate(sun)}–${fmtDate(sat)}`;
      opts.push({ offset: i, label: i === 0 ? `Last week · ${range}` : range });
    }
    return opts;
  }, []);

  const summaries = useMemo(() => {
    return LOCS.map((loc) => {
      const weekAvg = getWeekAvg(week, loc);
      const prevAvg = getWeekAvg(prevWeek, loc);
      const diff = weekAvg !== null && prevAvg !== null ? weekAvg - prevAvg : null;
      return { loc, weekAvg, diff };
    });
  }, [week, prevWeek]);

  const locData = week?.data[activeLoc] ?? { hours: {} };

  // Per-mode pull of the right grid. Time mode keeps the original
  // `hours` (avg completion minutes). Transactions/Sales use the new
  // tickets/salesCents grids the server now ships.
  const modeGrid = useMemo(() => {
    if (viewMode === 'transactions') return locData.tickets || {};
    if (viewMode === 'sales') return locData.salesCents || {};
    return locData.hours || {};
  }, [locData, viewMode]);

  // For the heatmap modes (transactions/sales) we color cells by
  // intensity against the week's peak hour. Time mode keeps the
  // fixed 0–4 / 5–7 / 8+ thresholds.
  const maxCellVal = useMemo(() => {
    if (viewMode === 'time') return 0;
    let m = 0;
    for (const h of HOURS) {
      for (const v of modeGrid[h] || []) {
        if (typeof v === 'number' && v > m) m = v;
      }
    }
    return m;
  }, [modeGrid, viewMode]);

  // Per-day arrays of cell values, used for the bottom totals row.
  const dailyTotals = useMemo(() => {
    return DAYS.map((_, i) => {
      const vals: number[] = [];
      HOURS.forEach((h) => {
        const v = (modeGrid[h] || [])[i];
        if (v !== null && v !== undefined) vals.push(v);
      });
      return vals;
    });
  }, [modeGrid]);

  const renderCell = (v: number | null) => {
    if (viewMode === 'time') return { text: fmt(v), style: cellStyle(v) };
    if (viewMode === 'transactions') return { text: fmtInt(v), style: heatStyle(v, maxCellVal) };
    return { text: fmtMoneyShort(v), style: heatStyle(v, maxCellVal) };
  };

  const rowSummary = (vals: (number | null)[]): number | null =>
    viewMode === 'time' ? avg(vals) : sum(vals);

  const summaryLabel = viewMode === 'time' ? 'Avg/Hr' : 'Total';
  const dayLabel = viewMode === 'time' ? 'Avg/Day' : 'Day Total';
  const subhead =
    viewMode === 'transactions' ? 'Tickets by hour'
    : viewMode === 'sales' ? 'Gross sales by hour'
    : 'Average drink completion times by hour';

  const selectionBounds = useMemo(() => {
    if (!selection) return null;
    return {
      minH: Math.min(selection.startHour, selection.endHour),
      maxH: Math.max(selection.startHour, selection.endHour),
      minD: Math.min(selection.startDay, selection.endDay),
      maxD: Math.max(selection.startDay, selection.endDay),
    };
  }, [selection]);

  // Aggregate the cells inside the selection rectangle. Time → avg,
  // transactions/sales → sum. `dataCells` counts cells that actually
  // had data so we can show "of N" when the box is mostly empty.
  const selectionStats = useMemo(() => {
    if (!selectionBounds) return null;
    const { minH, maxH, minD, maxD } = selectionBounds;
    const vals: number[] = [];
    for (let h = minH; h <= maxH; h++) {
      const arr = modeGrid[HOURS[h]] || [];
      for (let d = minD; d <= maxD; d++) {
        const v = arr[d];
        if (typeof v === 'number') vals.push(v);
      }
    }
    const cellCount = (maxH - minH + 1) * (maxD - minD + 1);
    const value = viewMode === 'time' ? avg(vals) : sum(vals);
    return { value, cellCount, dataCells: vals.length };
  }, [selectionBounds, modeGrid, viewMode]);

  // Format the active card's central value for any of the three modes.
  const formatCardValue = (val: number | null): { num: string; unit: string } => {
    if (val === null || val === undefined) return { num: '—', unit: '' };
    if (viewMode === 'time') return { num: val.toFixed(1), unit: 'min' };
    if (viewMode === 'transactions') return { num: String(Math.round(val)), unit: 'tickets' };
    const dollars = val / 100;
    if (dollars >= 1000) return { num: `$${(dollars / 1000).toFixed(1)}k`, unit: '' };
    return { num: `$${Math.round(dollars)}`, unit: '' };
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Ticket Time</h1>
          <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
            {subhead}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setWeekOffset((o) => Math.min(11, o + 1))}
            disabled={loading || weekOffset === 11}
            title="Previous week"
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', cursor: weekOffset === 11 ? 'default' : 'pointer', fontSize: 16, opacity: weekOffset === 11 ? 0.4 : 1 }}
          >‹</button>
          <select
            value={weekOffset}
            onChange={(e) => setWeekOffset(parseInt(e.target.value, 10))}
            disabled={loading}
            style={{
              padding: '10px 36px 10px 16px',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              border: '1px solid rgba(0,0,0,0.12)',
              background: '#fff',
              color: '#1a1a1a',
              cursor: 'pointer',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' stroke='%23666' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
            }}
          >
            {weekOptions.map((o) => (
              <option key={o.offset} value={o.offset}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => setWeekOffset((o) => Math.max(-1, o - 1))}
            disabled={weekOffset === -1 || loading}
            title="Next week"
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', cursor: weekOffset === -1 ? 'default' : 'pointer', fontSize: 16, opacity: weekOffset === -1 ? 0.4 : 1 }}
          >›</button>
          {weekOffset > -1 && (
            <button
              onClick={() => setWeekOffset(-1)}
              disabled={loading}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >This week</button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {!week && loading && (
        <div style={{ color: 'rgba(0,0,0,0.4)', padding: 24 }}>Loading ticket times…</div>
      )}

      {week && (
        <>
          {/* Location summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
            {summaries.map(({ loc, weekAvg, diff }) => {
              const isActive = activeLoc === loc;
              const showSelection = isActive && selectionStats !== null;
              const cardValue = showSelection
                ? formatCardValue(selectionStats!.value)
                : (weekAvg !== null
                    ? { num: weekAvg.toFixed(1), unit: 'min' }
                    : { num: '—', unit: '' });
              return (
                <div key={loc} onClick={() => setActiveLoc(loc)}
                  style={{
                    background: '#fff', borderRadius: 14, padding: '18px 20px', cursor: 'pointer',
                    border: isActive ? '2px solid #1a1a1a' : '1px solid rgba(0,0,0,0.08)',
                    boxShadow: isActive ? '0 2px 12px rgba(0,0,0,0.08)' : '0 1px 4px rgba(0,0,0,0.04)',
                    transition: 'all 0.2s',
                  }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {LOC_NAMES[loc]}
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a1a' }}>
                    {cardValue.num}
                    {cardValue.unit && (
                      <span style={{ fontSize: 14, fontWeight: 400, color: 'rgba(0,0,0,0.35)', marginLeft: 4 }}>{cardValue.unit}</span>
                    )}
                  </div>
                  {showSelection ? (
                    <div style={{ fontSize: 12, marginTop: 4, color: '#2563eb', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>Selection · {selectionStats!.dataCells}/{selectionStats!.cellCount} cells</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelection(null); }}
                        style={{ border: 'none', background: 'transparent', color: '#2563eb', cursor: 'pointer', fontSize: 12, padding: 0, textDecoration: 'underline' }}
                      >Clear</button>
                    </div>
                  ) : (
                    diff !== null && (
                      <div style={{ fontSize: 12, marginTop: 4, color: diff < 0 ? '#15803d' : '#dc2626', fontWeight: 600 }}>
                        {diff < 0 ? '↓' : '↑'} {Math.abs(diff).toFixed(1)} min vs prev week
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>

          {/* Date range + view-mode toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.35)' }}>
              Week {week.weekNum} — {week.dates[0]} to {week.dates[6]} · {LOC_NAMES[activeLoc]}
            </div>
            <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 10, padding: 3, gap: 2 }}>
              {([
                { id: 'time' as ViewMode, label: 'Time' },
                { id: 'transactions' as ViewMode, label: 'Transactions' },
                { id: 'sales' as ViewMode, label: 'Sales' },
              ]).map((opt) => {
                const active = viewMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setViewMode(opt.id)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 8,
                      border: 'none',
                      background: active ? '#fff' : 'transparent',
                      color: active ? '#1a1a1a' : 'rgba(0,0,0,0.55)',
                      fontWeight: active ? 700 : 500,
                      fontSize: 13,
                      cursor: 'pointer',
                      boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                      transition: 'all 0.15s',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Grid */}
          <div
            ref={gridContainerRef}
            style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', userSelect: 'none' }}
          >
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                    <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: 0.5, width: 70 }}>Hour</th>
                    {DAYS.map((d, i) => (
                      <th key={d} style={{ textAlign: 'center', padding: '12px 8px', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {d}<br /><span style={{ fontWeight: 400, fontSize: 10, opacity: 0.6 }}>{week.dates[i]}</span>
                      </th>
                    ))}
                    <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{summaryLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {HOURS.map((hour, hIdx) => {
                    const vals = (modeGrid[hour] || []) as (number | null)[];
                    const rowTotal = rowSummary(vals);
                    const rowCell = renderCell(rowTotal);
                    return (
                      <tr key={hour} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                        <td style={{ padding: '8px 16px', fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>{hour}</td>
                        {Array.from({ length: 7 }, (_, i) => {
                          const v = i < vals.length ? vals[i] : null;
                          const { text, style } = renderCell(v);
                          const selected = selectionBounds
                            ? hIdx >= selectionBounds.minH && hIdx <= selectionBounds.maxH
                              && i >= selectionBounds.minD && i <= selectionBounds.maxD
                            : false;
                          return (
                            <td key={i} style={{ padding: 4, textAlign: 'center' }}>
                              <div
                                onMouseDown={(e) => {
                                  // Prevent native text-selection during a drag.
                                  e.preventDefault();
                                  draggingRef.current = true;
                                  setSelection({ startHour: hIdx, startDay: i, endHour: hIdx, endDay: i });
                                }}
                                onMouseEnter={() => {
                                  if (!draggingRef.current) return;
                                  setSelection((s) => (s ? { ...s, endHour: hIdx, endDay: i } : s));
                                }}
                                style={{
                                  borderRadius: 8,
                                  padding: '8px 4px',
                                  fontSize: 14,
                                  ...style,
                                  transition: 'transform 0.15s',
                                  whiteSpace: 'nowrap',
                                  cursor: 'crosshair',
                                  boxShadow: selected ? 'inset 0 0 0 2px #1a1a1a' : undefined,
                                }}
                              >
                                {text}
                              </div>
                            </td>
                          );
                        })}
                        <td style={{ padding: 4, textAlign: 'center' }}>
                          <div style={{ borderRadius: 8, padding: '8px 4px', fontSize: 14, fontWeight: 700, ...rowCell.style, whiteSpace: 'nowrap' }}>
                            {rowCell.text}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                    <td style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#1a1a1a', textTransform: 'uppercase', letterSpacing: 0.5 }}>{dayLabel}</td>
                    {dailyTotals.map((arr, i) => {
                      const dayTotal = viewMode === 'time' ? avg(arr) : sum(arr);
                      // Day-total row gets neutral styling — we don't recolor
                      // by the same heatmap (totals would dominate the scale).
                      const text =
                        viewMode === 'time' ? fmt(dayTotal)
                        : viewMode === 'transactions' ? fmtInt(dayTotal)
                        : fmtMoneyShort(dayTotal);
                      return (
                        <td key={i} style={{ padding: 4, textAlign: 'center' }}>
                          <div style={{ borderRadius: 8, padding: '8px 4px', fontSize: 14, fontWeight: 700, background: 'rgba(0,0,0,0.06)', color: '#1a1a1a', whiteSpace: 'nowrap' }}>
                            {text}
                          </div>
                        </td>
                      );
                    })}
                    <td style={{ padding: 4, textAlign: 'center' }}>
                      {(() => {
                        const flat = dailyTotals.flat();
                        const grand = viewMode === 'time' ? avg(flat) : sum(flat);
                        const text =
                          viewMode === 'time' ? fmt(grand)
                          : viewMode === 'transactions' ? fmtInt(grand)
                          : fmtMoneyShort(grand);
                        return (
                          <div style={{ borderRadius: 8, padding: '8px 4px', fontSize: 14, fontWeight: 700, background: 'rgba(0,0,0,0.06)', whiteSpace: 'nowrap' }}>
                            {text}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16, fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
            {viewMode === 'time' ? (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#dcfce7', display: 'inline-block' }} /> ≤4 min</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#fef9c3', display: 'inline-block' }} /> 5–7 min</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#fee2e2', display: 'inline-block' }} /> 8+ min</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#f3e8ff', display: 'inline-block' }} /> ⚠ Not swiped (20+)</span>
              </>
            ) : (
              <>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#f1f5f9', display: 'inline-block' }} /> Low</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#e0f2fe', display: 'inline-block' }} /> </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#dcfce7', display: 'inline-block' }} /> </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#fde68a', display: 'inline-block' }} /> Peak</span>
                <span style={{ opacity: 0.7 }}>Shaded against the busiest hour this week</span>
              </>
            )}
          </div>

          {/* Long-range ticket time vs daily sales correlation for the
              selected location. */}
          <TicketVsSalesCard locId={activeLoc} isMobile={isMobile} />
        </>
      )}
    </div>
  );
}

