import { Fragment, useEffect, useMemo, useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

interface EmployeeWeekHours {
  employeeId: number;
  fullName: string;
  primaryStore: string;
  weeklyHours: number[];
  totalHours: number;
  weeksWithHours: number;
  rollingAvg: number;
  last4WkAvg: number;
  last13WkAvg: number;
  dateStartedMs: number | null;
  weeksSinceHire: number | null;
}

interface EmployeeHoursReport {
  generatedAt: number;
  windowStartMs: number;
  windowEndMs: number;
  weekStartsMs: number[];
  weeksFetched: number;
  weeksFailed: number;
  employees: EmployeeWeekHours[];
}

interface DerivedRow {
  employeeId: number;
  fullName: string;
  primaryStore: string;
  weeklyHours: number[];     // sliced to current window
  weekStartsMs: number[];    // matching weeks
  totalHours: number;
  rollingAvg: number;        // total / min(window weeks, weeks since hire)
  last4WkAvg: number;
  last13WkAvg: number;
  weeksWithHours: number;
  windowWeeks: number;
  weeksSinceHire: number | null;
  dateStartedMs: number | null;
}

const STORES = ['G1', 'G2', 'G3', 'G4'];
const THRESHOLD_HARD = 30;
const THRESHOLD_DANGER = 28;
const THRESHOLD_WATCH = 25;
type WindowMode = '52w' | 'ytd';

function band(avg: number): { label: string; color: string; bg: string } {
  if (avg >= THRESHOLD_HARD) return { label: 'OVER',    color: '#991b1b', bg: '#fee2e2' };
  if (avg >= THRESHOLD_DANGER) return { label: 'DANGER', color: '#9a3412', bg: '#ffedd5' };
  if (avg >= THRESHOLD_WATCH)  return { label: 'WATCH',  color: '#854d0e', bg: '#fef9c3' };
  return { label: 'SAFE', color: '#166534', bg: '#dcfce7' };
}

function deriveRows(
  report: EmployeeHoursReport,
  windowMode: WindowMode,
): DerivedRow[] {
  // Pick the slice of weeks that match the selected window.
  let startIdx = 0;
  if (windowMode === 'ytd') {
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    startIdx = report.weekStartsMs.findIndex((ms) => ms >= yearStart);
    if (startIdx < 0) startIdx = 0;
  }
  const slicedWeekStarts = report.weekStartsMs.slice(startIdx);
  const windowWeeks = Math.max(1, slicedWeekStarts.length);

  return report.employees.map((e) => {
    const wh = e.weeklyHours.slice(startIdx);
    const total = wh.reduce((a, b) => a + b, 0);
    // Denominator is the smaller of the window size and the number of
    // weeks since this employee was hired (capped at window size). For a
    // hire who started inside the window we further cap at how many of
    // the windowed weeks fell on or after their hire date.
    let weeksInWindowSinceHire = windowWeeks;
    if (e.dateStartedMs != null) {
      weeksInWindowSinceHire = slicedWeekStarts.filter(
        (ms) => ms + 6 * 24 * 60 * 60 * 1000 >= e.dateStartedMs!,
      ).length;
      if (weeksInWindowSinceHire < 1) weeksInWindowSinceHire = 1;
    }
    const rollingDenom = Math.min(windowWeeks, weeksInWindowSinceHire);
    const last4 = wh.slice(-4);
    const last4Denom = Math.max(1, Math.min(4, weeksInWindowSinceHire));
    const last4Avg = last4.reduce((a, b) => a + b, 0) / last4Denom;
    const last13 = wh.slice(-13);
    const last13Denom = Math.max(1, Math.min(13, weeksInWindowSinceHire));
    const last13Avg = last13.reduce((a, b) => a + b, 0) / last13Denom;
    return {
      employeeId: e.employeeId,
      fullName: e.fullName,
      primaryStore: e.primaryStore,
      weeklyHours: wh,
      weekStartsMs: slicedWeekStarts,
      totalHours: Math.round(total * 100) / 100,
      rollingAvg: Math.round((total / rollingDenom) * 100) / 100,
      last4WkAvg: Math.round(last4Avg * 100) / 100,
      last13WkAvg: Math.round(last13Avg * 100) / 100,
      weeksWithHours: wh.filter((h) => h > 0).length,
      windowWeeks: rollingDenom,
      weeksSinceHire: e.weeksSinceHire,
      dateStartedMs: e.dateStartedMs,
    };
  });
}

function tenureLabel(weeksSinceHire: number | null): string {
  if (weeksSinceHire == null) return '—';
  if (weeksSinceHire < 52) return `${weeksSinceHire}w`;
  const years = Math.floor(weeksSinceHire / 52);
  const remWeeks = weeksSinceHire - years * 52;
  return remWeeks === 0 ? `${years}y` : `${years}y ${remWeeks}w`;
}

/**
 * Project the rolling average N weeks into the future at a given weekly
 * rate. Slides the window forward — oldest N weeks roll off in rolling
 * mode (no drop in YTD mode since YTD just keeps growing). Denominator
 * still caps at min(window length, weeks since hire) so projections for
 * new hires honor tenure.
 */
function projectAvg(
  row: DerivedRow,
  projHrs: number,
  projWeeks: number,
  windowMode: WindowMode,
): number {
  if (projWeeks <= 0) return row.rollingAvg;
  let droppedHours = 0;
  if (windowMode === '52w') {
    const droppedCount = Math.min(projWeeks, row.weeklyHours.length);
    for (let i = 0; i < droppedCount; i++) droppedHours += row.weeklyHours[i];
  }
  const keptHours = row.totalHours - droppedHours;
  const newHours = projWeeks * projHrs;

  let newDenom: number;
  if (windowMode === '52w') {
    const newWeeksSinceHire = (row.weeksSinceHire ?? 52) + projWeeks;
    newDenom = Math.min(52, newWeeksSinceHire);
  } else {
    // YTD: window grows by the projected weeks, capped by tenure
    const newWindow = row.windowWeeks + projWeeks;
    const newWeeksSinceHire = (row.weeksSinceHire ?? newWindow) + projWeeks;
    newDenom = Math.min(newWindow, newWeeksSinceHire);
  }
  if (newDenom < 1) newDenom = 1;
  return (keptHours + newHours) / newDenom;
}

export default function HoursWatch() {
  const isMobile = useIsMobile();
  const [report, setReport] = useState<EmployeeHoursReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<Set<string>>(new Set(STORES));
  const [hideInactive, setHideInactive] = useState(true);
  const [windowMode, setWindowMode] = useState<WindowMode>('52w');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // Projection: blank = off. Typing a number turns on the Projected column.
  // Default to 13 weeks (≈ 3 months) but let the user override.
  const [projHrsText, setProjHrsText] = useState('');
  const [projWeeksText, setProjWeeksText] = useState('13');
  const projHrs = projHrsText.trim() === '' ? null : Number(projHrsText);
  const projWeeks = Math.max(0, Math.min(52, parseInt(projWeeksText, 10) || 0));
  const projectionOn = projHrs != null && !Number.isNaN(projHrs) && projWeeks > 0;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch('/api/dripos/employee-hours', { cache: 'no-store' });
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(body.message || body.error || 'Failed to load hours report');
        setReport(body.report);
      } catch (err: any) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const derived = useMemo(() => (report ? deriveRows(report, windowMode) : []), [report, windowMode]);

  const filtered = useMemo(() => {
    const rows = derived
      .filter((e) => {
        if (!storeFilter.has(e.primaryStore)) return false;
        if (hideInactive && e.last4WkAvg <= 0) return false;
        return true;
      })
      .map((e) => {
        const projected = projectionOn
          ? Math.round(projectAvg(e, projHrs!, projWeeks, windowMode) * 100) / 100
          : null;
        return { ...e, projected };
      });
    rows.sort((a, b) => {
      // When projection is on, ranking by projected makes the table
      // immediately useful — riskiest projected outcome at the top.
      const av = projectionOn && a.projected != null ? a.projected : a.rollingAvg;
      const bv = projectionOn && b.projected != null ? b.projected : b.rollingAvg;
      return bv - av;
    });
    return rows;
  }, [derived, storeFilter, hideInactive, projectionOn, projHrs, projWeeks, windowMode]);

  const bandCounts = useMemo(() => {
    const counts = { over: 0, danger: 0, watch: 0, safe: 0 };
    for (const e of filtered) {
      // If projection is on, the summary cards reflect the projected
      // distribution — that's the whole point of running the what-if.
      const v = projectionOn && e.projected != null ? e.projected : e.rollingAvg;
      if (v >= THRESHOLD_HARD) counts.over++;
      else if (v >= THRESHOLD_DANGER) counts.danger++;
      else if (v >= THRESHOLD_WATCH) counts.watch++;
      else counts.safe++;
    }
    return counts;
  }, [filtered, projectionOn]);

  const toggleStore = (s: string) => {
    setStoreFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      if (next.size === 0) return new Set(STORES);
      return next;
    });
  };

  const avgColLabel = windowMode === 'ytd' ? 'YTD avg' : '52-wk avg';

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Hours Watch</h1>
        <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
          Rolling average weekly hours per employee. Goal: keep under 30 hr/wk for QSEHRA eligibility.
          Training and pure-management hours are excluded. For employees hired in the last 52 weeks
          the average is divided by weeks-since-hire, not 52, so new hires aren't diluted by pre-hire
          zero weeks. The <strong>13 wk avg</strong> column is the closer proxy for QSEHRA's
          "customary weekly employment" test.
        </p>
      </div>

      {error && (
        <div style={{
          background: '#fee2e2', color: '#b91c1c', padding: '10px 14px',
          borderRadius: 8, marginBottom: 14, fontSize: 13,
        }}>{error}</div>
      )}

      {loading && !report && (
        <div style={{ color: 'rgba(0,0,0,0.4)', padding: 24 }}>
          Loading hours report… (first load can take ~30s as 52 weeks are pulled)
        </div>
      )}

      {report && (
        <>
          {/* Band summary */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: 12, marginBottom: 20,
          }}>
            {[
              { lbl: 'OVER (≥30)',     n: bandCounts.over,   bg: '#fee2e2', fg: '#991b1b' },
              { lbl: 'DANGER (28-30)', n: bandCounts.danger, bg: '#ffedd5', fg: '#9a3412' },
              { lbl: 'WATCH (25-28)',  n: bandCounts.watch,  bg: '#fef9c3', fg: '#854d0e' },
              { lbl: 'SAFE (<25)',     n: bandCounts.safe,   bg: '#dcfce7', fg: '#166534' },
            ].map((b) => (
              <div key={b.lbl} style={{
                background: b.bg, borderRadius: 14, padding: '14px 18px',
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: b.fg,
                  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
                }}>{b.lbl}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: b.fg }}>{b.n}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8,
            alignItems: 'center', marginBottom: 14,
          }}>
            <span style={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5,
              color: 'rgba(0,0,0,0.4)', marginRight: 4, fontWeight: 600,
            }}>Stores:</span>
            {STORES.map((s) => {
              const on = storeFilter.has(s);
              return (
                <button key={s} onClick={() => toggleStore(s)}
                  style={{
                    padding: '6px 12px', borderRadius: 999,
                    border: '1px solid', borderColor: on ? '#1a1a1a' : 'rgba(0,0,0,0.12)',
                    background: on ? '#1a1a1a' : '#fff',
                    color: on ? '#fff' : 'rgba(0,0,0,0.6)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}>{s}</button>
              );
            })}

            {/* Window toggle (segmented control) */}
            <div style={{
              display: 'inline-flex', alignItems: 'center',
              border: '1px solid rgba(0,0,0,0.12)', borderRadius: 999,
              marginLeft: 12, overflow: 'hidden',
            }}>
              {(['52w', 'ytd'] as WindowMode[]).map((m) => {
                const on = windowMode === m;
                const label = m === 'ytd' ? `YTD ${new Date().getFullYear()}` : '52 wk rolling';
                return (
                  <button key={m} onClick={() => setWindowMode(m)}
                    style={{
                      padding: '6px 12px', border: 0, cursor: 'pointer',
                      background: on ? '#1a1a1a' : '#fff',
                      color: on ? '#fff' : 'rgba(0,0,0,0.6)',
                      fontSize: 12, fontWeight: 600,
                    }}>{label}</button>
                );
              })}
            </div>

            <label style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, color: 'rgba(0,0,0,0.6)', marginLeft: 12, cursor: 'pointer',
            }}>
              <input type="checkbox" checked={hideInactive}
                onChange={(e) => setHideInactive(e.target.checked)} />
              Hide inactive (no hours in last 4 wks)
            </label>
          </div>

          {/* What-if projector */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
            background: projectionOn ? 'rgba(245, 158, 11, 0.08)' : 'rgba(0,0,0,0.02)',
            border: `1px solid ${projectionOn ? 'rgba(245, 158, 11, 0.25)' : 'rgba(0,0,0,0.06)'}`,
            borderRadius: 10, padding: '10px 14px', marginBottom: 14,
            transition: 'background 0.15s, border 0.15s',
          }}>
            <span style={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5,
              color: projectionOn ? '#92400e' : 'rgba(0,0,0,0.45)', fontWeight: 700,
            }}>What-if:</span>
            <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.7)' }}>If everyone works</span>
            <input
              type="number" min={0} max={80} step={1}
              value={projHrsText}
              onChange={(e) => setProjHrsText(e.target.value)}
              placeholder="35"
              style={{
                width: 64, padding: '4px 8px', borderRadius: 6,
                border: '1px solid rgba(0,0,0,0.15)', fontSize: 13,
                fontVariantNumeric: 'tabular-nums', textAlign: 'right',
              }}
            />
            <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.7)' }}>hr / week for the next</span>
            <input
              type="number" min={1} max={52} step={1}
              value={projWeeksText}
              onChange={(e) => setProjWeeksText(e.target.value)}
              style={{
                width: 52, padding: '4px 8px', borderRadius: 6,
                border: '1px solid rgba(0,0,0,0.15)', fontSize: 13,
                fontVariantNumeric: 'tabular-nums', textAlign: 'right',
              }}
            />
            <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.7)' }}>
              weeks{projectionOn ? ' — projected column shows the new rolling avg.' : ''}
            </span>
            {projectionOn && (
              <button onClick={() => setProjHrsText('')}
                style={{
                  marginLeft: 'auto', padding: '4px 10px',
                  borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)',
                  background: '#fff', cursor: 'pointer',
                  fontSize: 12, color: 'rgba(0,0,0,0.6)',
                }}>Clear</button>
            )}
          </div>

          {/* Main table */}
          <div style={{
            background: '#fff', borderRadius: 14, padding: 0,
            border: '1px solid rgba(0,0,0,0.06)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
            overflow: 'hidden',
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%', borderCollapse: 'collapse', fontSize: 13,
              }}>
                <thead>
                  <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                    <Th>Name</Th>
                    <Th>Store</Th>
                    <Th align="right">Tenure</Th>
                    <Th align="right">{avgColLabel}</Th>
                    {projectionOn && (
                      <Th align="right">Projected</Th>
                    )}
                    <Th align="right">13 wk avg</Th>
                    <Th align="right">Last 4 wk</Th>
                    <Th align="right">Total hrs</Th>
                    <Th align="right">Wks worked</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const statusAvg = projectionOn && e.projected != null ? e.projected : e.rollingAvg;
                    const b = band(statusAvg);
                    const expanded = expandedId === e.employeeId;
                    const projDelta = projectionOn && e.projected != null
                      ? e.projected - e.rollingAvg : 0;
                    const projBand = projectionOn && e.projected != null
                      ? band(e.projected) : null;
                    return (
                      <Fragment key={e.employeeId}>
                        <tr onClick={() => setExpandedId(expanded ? null : e.employeeId)}
                          style={{
                            borderTop: '1px solid rgba(0,0,0,0.05)',
                            cursor: 'pointer',
                            background: expanded ? 'rgba(0,0,0,0.02)' : 'transparent',
                          }}>
                          <Td>
                            <span style={{
                              display: 'inline-block', width: 12,
                              color: 'rgba(0,0,0,0.3)', marginRight: 6,
                              transition: 'transform 0.15s',
                              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                            }}>▸</span>
                            <strong>{e.fullName}</strong>
                          </Td>
                          <Td>{e.primaryStore}</Td>
                          <Td align="right" style={{
                            fontVariantNumeric: 'tabular-nums',
                            color: e.weeksSinceHire != null && e.weeksSinceHire < 52 ? '#9a3412' : 'rgba(0,0,0,0.5)',
                          }} title={e.dateStartedMs ? `Hired ${new Date(e.dateStartedMs).toLocaleDateString()}` : 'Hire date unknown'}>
                            {tenureLabel(e.weeksSinceHire)}
                          </Td>
                          <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                            {e.rollingAvg.toFixed(1)}
                          </Td>
                          {projectionOn && e.projected != null && projBand && (
                            <Td align="right" style={{
                              fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                              color: projBand.color,
                            }}>
                              {e.projected.toFixed(1)}
                              <span style={{
                                marginLeft: 6, fontWeight: 500, fontSize: 11,
                                color: projDelta >= 0 ? '#9a3412' : '#166534',
                              }}>
                                {projDelta >= 0 ? '+' : ''}{projDelta.toFixed(1)}
                              </span>
                            </Td>
                          )}
                          <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {e.last13WkAvg.toFixed(1)}
                          </Td>
                          <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>
                            {e.last4WkAvg.toFixed(1)}
                          </Td>
                          <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>
                            {e.totalHours.toFixed(0)}
                          </Td>
                          <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>
                            {e.weeksWithHours}/{e.windowWeeks}
                          </Td>
                          <Td>
                            <span style={{
                              display: 'inline-block', padding: '2px 8px',
                              borderRadius: 6, background: b.bg, color: b.color,
                              fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                            }}>{b.label}</span>
                          </Td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={projectionOn ? 10 : 9} style={{
                              padding: '8px 0 18px',
                              background: 'rgba(0,0,0,0.015)',
                              borderTop: '1px solid rgba(0,0,0,0.04)',
                              borderBottom: '1px solid rgba(0,0,0,0.04)',
                            }}>
                              <WeeklyBreakdown row={e} isMobile={isMobile} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><Td colSpan={projectionOn ? 10 : 9} style={{ textAlign: 'center', padding: 32, color: 'rgba(0,0,0,0.4)' }}>
                      No employees match the filters.
                    </Td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{
            marginTop: 16, fontSize: 11, color: 'rgba(0,0,0,0.4)',
          }}>
            Window: {new Date(report.windowStartMs).toLocaleDateString()} —{' '}
            {new Date(report.windowEndMs).toLocaleDateString()} ·{' '}
            Generated {new Date(report.generatedAt).toLocaleString()}
            {report.weeksFailed > 0 && (
              <span style={{ color: '#9a3412', marginLeft: 8 }}>
                · {report.weeksFailed} of {report.weeksFetched + report.weeksFailed} weeks failed to load — refresh to retry
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function WeeklyBreakdown({ row, isMobile }: { row: DerivedRow; isMobile: boolean }) {
  // Per-row projection state. Independent of the chain-wide projector at
  // the top — this is for "what if THIS person works X hrs?"
  const [hrsText, setHrsText] = useState('');
  const [weeksText, setWeeksText] = useState('13');
  const projHrs = hrsText.trim() === '' ? null : Number(hrsText);
  const projWeeks = Math.max(0, Math.min(52, parseInt(weeksText, 10) || 0));
  const projOn = projHrs != null && !Number.isNaN(projHrs) && projWeeks > 0;
  const projectedAvg = projOn ? projectAvg(row, projHrs!, projWeeks, '52w') : null;
  const projectedBand = projectedAvg != null ? band(projectedAvg) : null;
  const currentBand = band(row.rollingAvg);
  const projDelta = projectedAvg != null ? projectedAvg - row.rollingAvg : 0;

  const max = Math.max(THRESHOLD_HARD + 5, ...row.weeklyHours, projHrs ?? 0);
  const fmtDate = (ms: number) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const barColor = (h: number) => {
    if (h >= THRESHOLD_HARD) return '#dc2626';
    if (h >= THRESHOLD_DANGER) return '#ea580c';
    if (h >= THRESHOLD_WATCH) return '#ca8a04';
    if (h > 0) return '#16a34a';
    return 'rgba(0,0,0,0.08)';
  };
  const numBars = row.weeklyHours.length;
  const projectedBars = projOn ? projWeeks : 0;
  const totalBars = numBars + projectedBars;
  const containerPad = isMobile ? 12 : 24;
  const barWidth = isMobile ? 12 : Math.max(6, Math.min(20, 600 / totalBars));
  const barGap = isMobile ? 2 : 3;
  const chartHeight = 110;

  // Build the projected week-start dates so labels read continuously past
  // the actual data. Each projected bar is 7 days after the previous.
  const projectedWeekStarts: number[] = [];
  if (projOn) {
    let lastMs = row.weekStartsMs[row.weekStartsMs.length - 1] ?? Date.now();
    for (let i = 0; i < projWeeks; i++) {
      lastMs += 7 * 24 * 60 * 60 * 1000;
      projectedWeekStarts.push(lastMs);
    }
  }

  return (
    <div style={{ padding: `0 ${containerPad}px` }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 8, flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.55)',
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>Weekly hours · {row.fullName}</div>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>
          {row.windowWeeks} weeks · 30-hr line shown for reference
        </div>
      </div>

      {/* Per-row what-if projector */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
        background: projOn ? 'rgba(245, 158, 11, 0.08)' : '#fff',
        border: `1px solid ${projOn ? 'rgba(245, 158, 11, 0.25)' : 'rgba(0,0,0,0.08)'}`,
        borderRadius: 8, padding: '8px 12px', marginBottom: 12,
      }}>
        <span style={{
          fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5,
          color: projOn ? '#92400e' : 'rgba(0,0,0,0.45)', fontWeight: 700,
        }}>What if:</span>
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.7)' }}>{row.fullName} works</span>
        <input
          type="number" min={0} max={80} step={1}
          value={hrsText}
          onChange={(e) => setHrsText(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          placeholder="35"
          style={{
            width: 60, padding: '3px 8px', borderRadius: 6,
            border: '1px solid rgba(0,0,0,0.15)', fontSize: 13,
            fontVariantNumeric: 'tabular-nums', textAlign: 'right',
          }}
        />
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.7)' }}>hr / week for the next</span>
        <input
          type="number" min={1} max={52} step={1}
          value={weeksText}
          onChange={(e) => setWeeksText(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 50, padding: '3px 8px', borderRadius: 6,
            border: '1px solid rgba(0,0,0,0.15)', fontSize: 13,
            fontVariantNumeric: 'tabular-nums', textAlign: 'right',
          }}
        />
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.7)' }}>weeks</span>

        {/* Current → Projected pill on the right */}
        <div style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            fontSize: 11, color: 'rgba(0,0,0,0.45)', fontWeight: 600,
          }}>Rolling avg:</span>
          <span style={{
            display: 'inline-block', padding: '2px 8px', borderRadius: 6,
            background: currentBand.bg, color: currentBand.color,
            fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          }}>{row.rollingAvg.toFixed(1)}</span>
          {projectedAvg != null && projectedBand && (
            <>
              <span style={{ color: 'rgba(0,0,0,0.3)', fontSize: 14 }}>→</span>
              <span style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 6,
                background: projectedBand.bg, color: projectedBand.color,
                fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              }}>{projectedAvg.toFixed(1)}</span>
              <span style={{
                fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                color: projDelta >= 0 ? '#9a3412' : '#166534',
              }}>{projDelta >= 0 ? '+' : ''}{projDelta.toFixed(1)}</span>
            </>
          )}
          {projOn && (
            <button onClick={(e) => { e.stopPropagation(); setHrsText(''); }}
              style={{
                marginLeft: 4, padding: '3px 8px',
                borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)',
                background: '#fff', cursor: 'pointer',
                fontSize: 11, color: 'rgba(0,0,0,0.6)',
              }}>Clear</button>
          )}
        </div>
      </div>

      {/* Chart */}
      <div style={{
        position: 'relative',
        overflowX: isMobile ? 'auto' : 'visible',
        paddingBottom: 4,
      }}>
        <div style={{
          position: 'relative',
          height: chartHeight,
          display: 'flex',
          alignItems: 'flex-end',
          gap: barGap,
          paddingRight: 36,
        }}>
          {/* 30-hr reference line */}
          <div style={{
            position: 'absolute', left: 0, right: 36,
            top: chartHeight - (THRESHOLD_HARD / max) * chartHeight,
            borderTop: '1px dashed rgba(220, 38, 38, 0.6)',
            pointerEvents: 'none',
          }}>
            <span style={{
              position: 'absolute', right: -36, top: -8, fontSize: 9,
              color: '#dc2626', fontWeight: 600,
            }}>30 hr</span>
          </div>
          {/* 25-hr ref line */}
          <div style={{
            position: 'absolute', left: 0, right: 36,
            top: chartHeight - (THRESHOLD_WATCH / max) * chartHeight,
            borderTop: '1px dashed rgba(0,0,0,0.12)',
            pointerEvents: 'none',
          }}>
            <span style={{
              position: 'absolute', right: -36, top: -7, fontSize: 9,
              color: 'rgba(0,0,0,0.35)',
            }}>25 hr</span>
          </div>

          {row.weeklyHours.map((h, i) => {
            const ms = row.weekStartsMs[i];
            const heightPct = max > 0 ? (h / max) * 100 : 0;
            return (
              <div key={ms}
                title={`Week of ${new Date(ms).toLocaleDateString()}: ${h.toFixed(1)} hr`}
                style={{
                  width: barWidth,
                  flexShrink: 0,
                  height: `${heightPct}%`,
                  minHeight: h > 0 ? 1 : 0,
                  background: barColor(h),
                  borderRadius: '2px 2px 0 0',
                  position: 'relative',
                }}
              />
            );
          })}

          {/* Projected bars — same color rules, hatched fill to distinguish
              from actuals */}
          {projOn && projectedWeekStarts.map((ms, i) => {
            const heightPct = max > 0 ? (projHrs! / max) * 100 : 0;
            const c = barColor(projHrs!);
            return (
              <div key={`proj-${i}`}
                title={`Projected week of ${new Date(ms).toLocaleDateString()}: ${projHrs!.toFixed(1)} hr`}
                style={{
                  width: barWidth,
                  flexShrink: 0,
                  height: `${heightPct}%`,
                  minHeight: 1,
                  background: `repeating-linear-gradient(45deg, ${c}, ${c} 3px, ${c}88 3px, ${c}88 6px)`,
                  borderRadius: '2px 2px 0 0',
                  position: 'relative',
                  opacity: 0.85,
                }}
              />
            );
          })}
        </div>
        {/* X-axis labels */}
        <div style={{
          display: 'flex', gap: barGap, marginTop: 4,
          paddingRight: 36, fontVariantNumeric: 'tabular-nums',
        }}>
          {row.weekStartsMs.map((ms, i) => {
            const everyN = Math.max(1, Math.floor(totalBars / (isMobile ? 6 : 12)));
            const show = i % everyN === 0 || i === numBars - 1;
            return (
              <div key={ms} style={{
                width: barWidth, flexShrink: 0, fontSize: 9,
                color: 'rgba(0,0,0,0.35)', textAlign: 'center',
                whiteSpace: 'nowrap',
                visibility: show ? 'visible' : 'hidden',
              }}>{fmtDate(ms)}</div>
            );
          })}
          {projOn && projectedWeekStarts.map((ms, i) => {
            const everyN = Math.max(1, Math.floor(totalBars / (isMobile ? 6 : 12)));
            const show = (numBars + i) % everyN === 0 || i === projectedBars - 1;
            return (
              <div key={`proj-l-${i}`} style={{
                width: barWidth, flexShrink: 0, fontSize: 9,
                color: '#92400e', textAlign: 'center',
                whiteSpace: 'nowrap', fontStyle: 'italic',
                visibility: show ? 'visible' : 'hidden',
              }}>{fmtDate(ms)}</div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align ?? 'left',
      padding: '12px 16px', fontSize: 10, textTransform: 'uppercase',
      letterSpacing: 0.5, fontWeight: 700, color: 'rgba(0,0,0,0.5)',
      whiteSpace: 'nowrap',
    }}>{children}</th>
  );
}

function Td({
  children, align, style, colSpan, title,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  style?: React.CSSProperties;
  colSpan?: number;
  title?: string;
}) {
  return (
    <td colSpan={colSpan} title={title} style={{
      textAlign: align ?? 'left',
      padding: '10px 16px', whiteSpace: 'nowrap',
      ...style,
    }}>{children}</td>
  );
}
