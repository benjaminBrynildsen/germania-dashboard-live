import { useState, useMemo, useEffect } from 'react';
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

function cellStyle(val: number | null): React.CSSProperties {
  if (val === null) return { background: 'rgba(0,0,0,0.03)', color: 'rgba(0,0,0,0.2)' };
  if (val > 20) return { background: '#f3e8ff', color: '#7c3aed', fontWeight: 700 };
  if (val >= 8) return { background: '#fee2e2', color: '#dc2626', fontWeight: 700 };
  if (val >= 5) return { background: '#fef9c3', color: '#a16207', fontWeight: 600 };
  return { background: '#dcfce7', color: '#15803d', fontWeight: 600 };
}

function fmt(val: number | null): string {
  if (val === null) return '—';
  if (val > 20) return `${val.toFixed(0)}⚠`;
  return val.toFixed(1);
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
  const [hoverCell, setHoverCell] = useState<{ hour: string; day: number } | null>(null);

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

  const dailyTotals = useMemo(() => {
    return DAYS.map((_, i) => {
      const vals: number[] = [];
      HOURS.forEach((h) => {
        const v = ((locData.hours || {})[h] || [])[i];
        if (v !== null && v !== undefined) vals.push(v);
      });
      return vals;
    });
  }, [locData]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Ticket Time</h1>
          <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
            Average drink completion times by hour
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
            {summaries.map(({ loc, weekAvg, diff }) => (
              <div key={loc} onClick={() => setActiveLoc(loc)}
                style={{
                  background: '#fff', borderRadius: 14, padding: '18px 20px', cursor: 'pointer',
                  border: activeLoc === loc ? '2px solid #1a1a1a' : '1px solid rgba(0,0,0,0.08)',
                  boxShadow: activeLoc === loc ? '0 2px 12px rgba(0,0,0,0.08)' : '0 1px 4px rgba(0,0,0,0.04)',
                  transition: 'all 0.2s',
                }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.4)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {LOC_NAMES[loc]}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a1a' }}>
                  {weekAvg !== null ? weekAvg.toFixed(1) : '—'}
                  <span style={{ fontSize: 14, fontWeight: 400, color: 'rgba(0,0,0,0.35)', marginLeft: 4 }}>min</span>
                </div>
                {diff !== null && (
                  <div style={{ fontSize: 12, marginTop: 4, color: diff < 0 ? '#15803d' : '#dc2626', fontWeight: 600 }}>
                    {diff < 0 ? '↓' : '↑'} {Math.abs(diff).toFixed(1)} min vs prev week
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Date range */}
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.35)', marginBottom: 14 }}>
            Week {week.weekNum} — {week.dates[0]} to {week.dates[6]} · {LOC_NAMES[activeLoc]}
          </div>

          {/* Grid */}
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
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
                    <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Avg/Hr</th>
                  </tr>
                </thead>
                <tbody>
                  {HOURS.map((hour) => {
                    const vals = (locData.hours || {})[hour] || [];
                    const tickVals = (locData.tickets || {})[hour] || [];
                    const salesVals = (locData.salesCents || {})[hour] || [];
                    const hourAvg = avg(vals);
                    return (
                      <tr key={hour} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                        <td style={{ padding: '8px 16px', fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>{hour}</td>
                        {Array.from({ length: 7 }, (_, i) => {
                          const v = i < vals.length ? vals[i] : null;
                          const tc = i < tickVals.length ? tickVals[i] : null;
                          const sc = i < salesVals.length ? salesVals[i] : null;
                          const hovered = hoverCell?.hour === hour && hoverCell?.day === i;
                          const showSwap = hovered && v !== null && (tc !== null || sc !== null);
                          return (
                            <td key={i} style={{ padding: 4, textAlign: 'center' }}>
                              <div
                                onMouseEnter={() => setHoverCell({ hour, day: i })}
                                onMouseLeave={() => setHoverCell((c) => (c?.hour === hour && c?.day === i ? null : c))}
                                style={{
                                  borderRadius: 8,
                                  padding: '8px 4px',
                                  fontSize: showSwap ? 12 : 14,
                                  ...cellStyle(v),
                                  transition: 'transform 0.15s',
                                  cursor: v !== null ? 'default' : undefined,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {showSwap ? `${fmtMoneyShort(sc)} · ${tc ?? 0}` : fmt(v)}
                              </div>
                            </td>
                          );
                        })}
                        <td style={{ padding: 4, textAlign: 'center' }}>
                          <div style={{ borderRadius: 8, padding: '8px 4px', fontSize: 14, fontWeight: 700, ...cellStyle(hourAvg) }}>
                            {fmt(hourAvg)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                    <td style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#1a1a1a', textTransform: 'uppercase', letterSpacing: 0.5 }}>Avg/Day</td>
                    {dailyTotals.map((arr, i) => {
                      const a = avg(arr);
                      return (
                        <td key={i} style={{ padding: 4, textAlign: 'center' }}>
                          <div style={{ borderRadius: 8, padding: '8px 4px', fontSize: 14, fontWeight: 700, ...cellStyle(a) }}>
                            {fmt(a)}
                          </div>
                        </td>
                      );
                    })}
                    <td style={{ padding: 4, textAlign: 'center' }}>
                      <div style={{ borderRadius: 8, padding: '8px 4px', fontSize: 14, fontWeight: 700, background: 'rgba(0,0,0,0.06)' }}>
                        {fmt(avg(dailyTotals.flat()))}
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16, fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#dcfce7', display: 'inline-block' }} /> ≤4 min</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#fef9c3', display: 'inline-block' }} /> 5–7 min</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#fee2e2', display: 'inline-block' }} /> 8+ min</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 4, background: '#f3e8ff', display: 'inline-block' }} /> ⚠ Not swiped (20+)</span>
          </div>

          {/* Long-range ticket time vs daily sales correlation for the
              selected location. */}
          <TicketVsSalesCard locId={activeLoc} isMobile={isMobile} />
        </>
      )}
    </div>
  );
}

