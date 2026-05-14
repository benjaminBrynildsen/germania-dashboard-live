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

export default function HoursWatch() {
  const isMobile = useIsMobile();
  const [report, setReport] = useState<EmployeeHoursReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<Set<string>>(new Set(STORES));
  const [hideInactive, setHideInactive] = useState(true);
  const [windowMode, setWindowMode] = useState<WindowMode>('52w');
  const [expandedId, setExpandedId] = useState<number | null>(null);

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
    return derived
      .filter((e) => {
        if (!storeFilter.has(e.primaryStore)) return false;
        if (hideInactive && e.last4WkAvg <= 0) return false;
        return true;
      })
      .sort((a, b) => b.rollingAvg - a.rollingAvg);
  }, [derived, storeFilter, hideInactive]);

  const bandCounts = useMemo(() => {
    const counts = { over: 0, danger: 0, watch: 0, safe: 0 };
    for (const e of filtered) {
      if (e.rollingAvg >= THRESHOLD_HARD) counts.over++;
      else if (e.rollingAvg >= THRESHOLD_DANGER) counts.danger++;
      else if (e.rollingAvg >= THRESHOLD_WATCH) counts.watch++;
      else counts.safe++;
    }
    return counts;
  }, [filtered]);

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
                    <Th align="right">13 wk avg</Th>
                    <Th align="right">Last 4 wk</Th>
                    <Th align="right">Total hrs</Th>
                    <Th align="right">Wks worked</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const b = band(e.rollingAvg);
                    const expanded = expandedId === e.employeeId;
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
                            <td colSpan={9} style={{
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
                    <tr><Td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'rgba(0,0,0,0.4)' }}>
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
  const max = Math.max(THRESHOLD_HARD + 5, ...row.weeklyHours);
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
  // Bar width: scale chart so all bars fit in the row width with a min/max.
  const numBars = row.weeklyHours.length;
  const containerPad = isMobile ? 12 : 24;
  // For mobile we let the chart scroll horizontally; for desktop we fill.
  const barWidth = isMobile ? 12 : Math.max(6, Math.min(20, 600 / numBars));
  const barGap = isMobile ? 2 : 3;
  const chartHeight = 110;

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
          // Reserve room on the right for the y-axis labels
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
        </div>
        {/* X-axis labels: show every ~Nth week so they don't overlap */}
        <div style={{
          display: 'flex', gap: barGap, marginTop: 4,
          paddingRight: 36, fontVariantNumeric: 'tabular-nums',
        }}>
          {row.weekStartsMs.map((ms, i) => {
            const everyN = Math.max(1, Math.floor(numBars / (isMobile ? 6 : 12)));
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
