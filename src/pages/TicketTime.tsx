import { useState, useMemo } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import { useSearchParams } from 'react-router-dom';
import { TICKET_WEEKS } from '../data/ticketData';

const LOC_NAMES: Record<string, string> = {
  G1: 'G1 - Alton', G2: 'G2 - Godfrey', G3: 'G3 - East Gate', G4: 'G4 - Jerseyville',
};
const HOURS = ['6AM','7AM','8AM','9AM','10AM','11AM','12PM','1PM','2PM','3PM','4PM','5PM'];
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const LOCS = ['G1','G2','G3','G4'];

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

function getWeekAvg(weekData: any, loc: string): number | null {
  const d = weekData.data[loc];
  if (!d) return null;
  const vals: number[] = [];
  HOURS.forEach(h => ((d.hours || {})[h] || []).forEach((v: number | null) => { if (v !== null && v <= 20) vals.push(v); }));
  return avg(vals);
}

export default function TicketTime() {
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const initialLoc = LOCS.includes(searchParams.get('loc') || '') ? searchParams.get('loc')! : 'G1';
  const [activeLoc, setActiveLoc] = useState(initialLoc);
  const [weekIdx, setWeekIdx] = useState(0);

  const week = TICKET_WEEKS[weekIdx];
  const locData = week.data[activeLoc] || { hours: {} };
  const prevWeek = TICKET_WEEKS[weekIdx + 1] || null;

  const summaries = useMemo(() => {
    return LOCS.map(loc => {
      const weekAvg = getWeekAvg(week, loc);
      const prevAvg = prevWeek ? getWeekAvg(prevWeek, loc) : null;
      const diff = weekAvg !== null && prevAvg !== null ? weekAvg - prevAvg : null;
      return { loc, weekAvg, diff };
    });
  }, [weekIdx]);

  const dailyTotals = useMemo(() => {
    return DAYS.map((_, i) => {
      const vals: number[] = [];
      HOURS.forEach(h => { const v = ((locData.hours || {})[h] || [])[i]; if (v !== null && v !== undefined) vals.push(v); });
      return vals;
    });
  }, [activeLoc, weekIdx]);

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
        <select
          value={weekIdx}
          onChange={e => setWeekIdx(Number(e.target.value))}
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
          {TICKET_WEEKS.map((w, i) => (
            <option key={w.weekNum} value={i}>
              Week {w.weekNum} — {w.dates[0]} to {w.dates[6]}
            </option>
          ))}
        </select>
      </div>

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
              {HOURS.map(hour => {
                const vals = (locData.hours || {})[hour] || [];
                const hourAvg = avg(vals);
                return (
                  <tr key={hour} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <td style={{ padding: '8px 16px', fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.45)' }}>{hour}</td>
                    {Array.from({ length: 7 }, (_, i) => {
                      const v = i < vals.length ? vals[i] : null;
                      return (
                        <td key={i} style={{ padding: 4, textAlign: 'center' }}>
                          <div style={{ borderRadius: 8, padding: '8px 4px', fontSize: 14, ...cellStyle(v), transition: 'transform 0.15s' }}>
                            {fmt(v)}
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
    </div>
  );
}
