import { useEffect, useMemo, useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

interface Barista {
  employeeId: number;
  fullName: string;
  primaryStore: string;
  tenureWeeks: number | null;
  last4WkAvg: number;
  last6WkAvg: number;
  last13WkAvg: number;
  preferredHours: number | null;
  notes: string | null;
}

interface StoreSummary {
  storeLabel: string;
  scheduledHoursPerWk: number;
  targetWithBuffer: number;
  sumPreferredHours: number;
  gapHours: number;
  hiresNeeded: number;
  baristaCount: number;
}

interface Report {
  generatedAt: number;
  buffer: number;
  hiresTargetHrsPerWk: number;
  baristas: Barista[];
  byStore: StoreSummary[];
}

const STORES = ['G1', 'G2', 'G3', 'G4'];

export default function HiringNeeds() {
  const isMobile = useIsMobile();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Local edit buffer: empId -> typed value (string while editing).
  const [edits, setEdits] = useState<Record<number, string>>({});
  // Track save state per row so we can show a saving indicator.
  const [saving, setSaving] = useState<Set<number>>(new Set());
  const [hideInactive, setHideInactive] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch('/api/dripos/hiring-needs', { cache: 'no-store' });
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(body.message || body.error || 'Failed to load hiring needs');
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

  const filteredBaristas = useMemo(() => {
    if (!report) return [];
    return report.baristas
      .filter((b) => STORES.includes(b.primaryStore))
      .filter((b) => !hideInactive || b.last4WkAvg > 0)
      .sort((a, b) => {
        // Group by store, then by name within store.
        if (a.primaryStore !== b.primaryStore) {
          return a.primaryStore.localeCompare(b.primaryStore);
        }
        return a.fullName.localeCompare(b.fullName);
      });
  }, [report, hideInactive]);

  /** Persist a preferred-hours value for one employee. The summary cards
   *  reload from the server so the gap recomputes. */
  const savePreference = async (empId: number, raw: string) => {
    setSaving((s) => new Set(s).add(empId));
    try {
      const num = raw.trim() === '' ? null : Number(raw);
      const r = await fetch(`/api/dripos/preferences/${empId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preferredHours: num }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || body.error || 'Save failed');
      }
      // Refresh just to recompute the summary — cheap, cache is warm.
      const fresh = await fetch('/api/dripos/hiring-needs', { cache: 'no-store' });
      const body = await fresh.json();
      if (fresh.ok) setReport(body.report);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSaving((s) => {
        const next = new Set(s);
        next.delete(empId);
        return next;
      });
    }
  };

  if (loading && !report) {
    return (
      <div style={{ color: 'rgba(0,0,0,0.4)', padding: 24 }}>
        Loading hiring needs…
      </div>
    );
  }

  return (
    <div>
      <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13, marginTop: -8, marginBottom: 18 }}>
        Sums each store's preferred barista hours against actual schedule demand with a{' '}
        <strong>×{report?.buffer.toFixed(2)}</strong> buffer to cover call-offs and swaps.
        Preferred values default to each barista's last 6-wk average — type a new number to
        override and it'll save automatically.
      </p>

      {error && (
        <div style={{
          background: '#fee2e2', color: '#b91c1c', padding: '10px 14px',
          borderRadius: 8, marginBottom: 14, fontSize: 13,
        }}>{error}</div>
      )}

      {report && (
        <>
          {/* Per-store summary cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: 12, marginBottom: 24,
          }}>
            {report.byStore.map((s) => <StoreCard key={s.storeLabel} s={s} buffer={report.buffer} />)}
          </div>

          {/* Filter row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, color: 'rgba(0,0,0,0.6)', cursor: 'pointer',
            }}>
              <input type="checkbox" checked={hideInactive}
                onChange={(e) => setHideInactive(e.target.checked)} />
              Hide inactive (no hours in last 4 wks)
            </label>
            <div style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>
              {filteredBaristas.length} baristas · generated{' '}
              {new Date(report.generatedAt).toLocaleString()}
            </div>
          </div>

          {/* Barista list */}
          <div style={{
            background: '#fff', borderRadius: 14,
            border: '1px solid rgba(0,0,0,0.06)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
            overflow: 'hidden',
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                    <Th>Name</Th>
                    <Th>Store</Th>
                    <Th align="right">Tenure</Th>
                    <Th align="right">Last 4 wk</Th>
                    <Th align="right">Last 6 wk (suggested)</Th>
                    <Th align="right">Preferred hr/wk</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBaristas.map((b) => {
                    const editing = edits[b.employeeId];
                    const baseValue = b.preferredHours != null
                      ? b.preferredHours.toString()
                      : '';
                    const placeholder = b.last6WkAvg > 0 ? b.last6WkAvg.toFixed(1) : '—';
                    const isSaving = saving.has(b.employeeId);
                    const isSuggested = b.preferredHours == null;
                    return (
                      <tr key={b.employeeId} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                        <Td><strong>{b.fullName}</strong></Td>
                        <Td>{b.primaryStore}</Td>
                        <Td align="right" style={{
                          fontVariantNumeric: 'tabular-nums',
                          color: b.tenureWeeks != null && b.tenureWeeks < 52 ? '#9a3412' : 'rgba(0,0,0,0.5)',
                        }}>{tenureLabel(b.tenureWeeks)}</Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {b.last4WkAvg.toFixed(1)}
                        </Td>
                        <Td align="right" style={{
                          fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)',
                        }}>
                          {b.last6WkAvg.toFixed(1)}
                        </Td>
                        <Td align="right">
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <input type="number" min={0} max={80} step={0.5}
                              value={editing ?? baseValue}
                              placeholder={placeholder}
                              onChange={(e) => setEdits((prev) => ({
                                ...prev, [b.employeeId]: e.target.value,
                              }))}
                              onBlur={(e) => {
                                const raw = e.target.value;
                                if (raw !== baseValue) {
                                  savePreference(b.employeeId, raw);
                                }
                                setEdits((prev) => {
                                  const next = { ...prev };
                                  delete next[b.employeeId];
                                  return next;
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                if (e.key === 'Escape') {
                                  setEdits((prev) => {
                                    const next = { ...prev };
                                    delete next[b.employeeId];
                                    return next;
                                  });
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                              style={{
                                width: 76, padding: '4px 8px', borderRadius: 6,
                                border: '1px solid rgba(0,0,0,0.15)', fontSize: 13,
                                fontVariantNumeric: 'tabular-nums', textAlign: 'right',
                                background: isSuggested ? 'rgba(0,0,0,0.02)' : '#fff',
                                color: isSuggested ? 'rgba(0,0,0,0.55)' : '#1a1a1a',
                              }}
                            />
                            {isSaving && (
                              <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)' }}>saving…</span>
                            )}
                            {!isSaving && isSuggested && (
                              <span title="Defaulting to last-6-wk avg until you confirm" style={{
                                fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                                color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase',
                              }}>auto</span>
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                  {filteredBaristas.length === 0 && (
                    <tr><Td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'rgba(0,0,0,0.4)' }}>
                      No baristas to show.
                    </Td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StoreCard({ s, buffer }: { s: StoreSummary; buffer: number }) {
  const gapColor = s.gapHours > 0 ? '#9a3412' : '#166534';
  const hiresColor = s.hiresNeeded > 0 ? '#9a3412' : '#166534';
  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: '14px 16px',
      border: '1px solid rgba(0,0,0,0.07)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.5)',
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
      }}>
        {s.storeLabel} · {s.baristaCount} baristas
      </div>
      <Row k="Actual sched" v={`${s.scheduledHoursPerWk.toFixed(1)} hr/wk`} dim />
      <Row k={`×${buffer.toFixed(2)} target`} v={`${s.targetWithBuffer.toFixed(1)} hr/wk`} bold />
      <Row k="Preferred sum" v={`${s.sumPreferredHours.toFixed(1)} hr/wk`} dim />
      <div style={{
        height: 1, background: 'rgba(0,0,0,0.06)', margin: '6px 0',
      }} />
      <Row k="Gap" v={
        <span style={{ color: gapColor, fontWeight: 700 }}>
          {s.gapHours >= 0 ? '+' : ''}{s.gapHours.toFixed(1)} hr/wk
        </span>
      } />
      <Row k="Hires needed" v={
        <span style={{ color: hiresColor, fontWeight: 700, fontSize: 18 }}>
          {s.hiresNeeded}
        </span>
      } />
    </div>
  );
}

function Row({ k, v, dim, bold }: {
  k: string;
  v: React.ReactNode;
  dim?: boolean;
  bold?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      fontSize: 12, padding: '3px 0',
      color: dim ? 'rgba(0,0,0,0.5)' : '#1a1a1a',
      fontWeight: bold ? 600 : 400,
      fontVariantNumeric: 'tabular-nums',
    }}>
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}

function tenureLabel(weeksSinceHire: number | null): string {
  if (weeksSinceHire == null) return '—';
  if (weeksSinceHire < 52) return `${weeksSinceHire}w`;
  const years = Math.floor(weeksSinceHire / 52);
  const remWeeks = weeksSinceHire - years * 52;
  return remWeeks === 0 ? `${years}y` : `${years}y ${remWeeks}w`;
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
