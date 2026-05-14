import { useEffect, useMemo, useState } from 'react';
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

const STORES = ['G1', 'G2', 'G3', 'G4'];
const THRESHOLD_HARD = 30;
const THRESHOLD_DANGER = 28;
const THRESHOLD_WATCH = 25;

function band(avg: number): { label: string; color: string; bg: string } {
  if (avg >= THRESHOLD_HARD) return { label: 'OVER',    color: '#991b1b', bg: '#fee2e2' };
  if (avg >= THRESHOLD_DANGER) return { label: 'DANGER', color: '#9a3412', bg: '#ffedd5' };
  if (avg >= THRESHOLD_WATCH)  return { label: 'WATCH',  color: '#854d0e', bg: '#fef9c3' };
  return { label: 'SAFE', color: '#166534', bg: '#dcfce7' };
}

export default function HoursWatch() {
  const isMobile = useIsMobile();
  const [report, setReport] = useState<EmployeeHoursReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<Set<string>>(new Set(STORES));
  const [hideInactive, setHideInactive] = useState(true);

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

  const filtered = useMemo(() => {
    if (!report) return [];
    return report.employees.filter((e) => {
      if (!storeFilter.has(e.primaryStore)) return false;
      if (hideInactive && e.last4WkAvg <= 0) return false;
      return true;
    });
  }, [report, storeFilter, hideInactive]);

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
      if (next.size === 0) return new Set(STORES); // never empty
      return next;
    });
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Hours Watch</h1>
        <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
          Rolling 52-week average weekly hours per employee. Goal: keep under 30 hr/wk for QSEHRA eligibility.
          Training and pure-management hours are excluded.
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
                    <Th align="right">52-wk avg</Th>
                    <Th align="right">Last 4 wk</Th>
                    <Th align="right">Total hrs</Th>
                    <Th align="right">Wks worked</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const b = band(e.rollingAvg);
                    return (
                      <tr key={e.employeeId} style={{
                        borderTop: '1px solid rgba(0,0,0,0.05)',
                      }}>
                        <Td><strong>{e.fullName}</strong></Td>
                        <Td>{e.primaryStore}</Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {e.rollingAvg.toFixed(1)}
                        </Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {e.last4WkAvg.toFixed(1)}
                        </Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>
                          {e.totalHours.toFixed(0)}
                        </Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>
                          {e.weeksWithHours}/52
                        </Td>
                        <Td>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px',
                            borderRadius: 6, background: b.bg, color: b.color,
                            fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                          }}>{b.label}</span>
                        </Td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><Td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'rgba(0,0,0,0.4)' }}>
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
  children, align, style, colSpan,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  style?: React.CSSProperties;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} style={{
      textAlign: align ?? 'left',
      padding: '10px 16px', whiteSpace: 'nowrap',
      ...style,
    }}>{children}</td>
  );
}
