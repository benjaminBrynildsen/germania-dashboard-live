import { useCallback, useEffect, useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

type Tab = 'overview' | 'funnel' | 'by-location';

interface SyncMeta {
  lastSyncedAt: number | null;
  lastSyncCount: number | null;
  lastSyncTotalInDripos: number | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
}

interface TopPatron {
  driposId: number;
  uniqueId: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  primaryStore: string | null;
  lifetime: number;
  totalSpendCents: number;
  averageTicketCents: number | null;
  lastSeenMs: number | null;
  dateCreatedMs: number | null;
}

interface OverviewReport {
  sync: SyncMeta;
  totalPatrons: number;
  totalActive: number;
  totalArchived: number;
  textSubscribed: number;
  emailSubscribed: number;
  newThisWeek: number;
  newThisMonth: number;
  newThisYear: number;
  newLifetime: number;
  byLocation: Array<{
    storeLabel: string;
    totalPatrons: number;
    newThisWeek: number;
    newThisMonth: number;
    activeThisWeek: number;
    topByVisits: TopPatron | null;
    topBySpend: TopPatron | null;
  }>;
  topByVisits: TopPatron[];
  topBySpend: TopPatron[];
  topThisWeek: TopPatron | null;
  seenThisWeek: number;
}

interface FunnelMonth {
  yearMonth: string;
  label: string;
  total: number;
  oneOnly: number;
  twoPlus: number;
  exactlyTwo: number;
  threePlus: number;
  exactlyThree: number;
  fourPlus: number;
  exactlyFour: number;
  fivePlus: number;
  pct2Plus: number | null;
  pct3Plus: number | null;
  pct4Plus: number | null;
  pct5Plus: number | null;
  immature: boolean;
}

interface FunnelChain {
  total: number;
  twoPlus: number;
  threePlus: number;
  fourPlus: number;
  fivePlus: number;
  pct2Plus: number | null;
  pct3Plus: number | null;
  pct4Plus: number | null;
  pct5Plus: number | null;
}

interface FunnelReport {
  sync: SyncMeta;
  chain: FunnelChain;
  monthly: FunnelMonth[];
}

const TAFFER = { pct2Plus: 40, pct3Plus: 42, pct4Plus: 70 };
const STORE_THEMES: Record<string, { bg: string; fg: string }> = {
  G1: { bg: '#7f1d1d', fg: '#fde68a' },
  G2: { bg: '#1e3a5f', fg: '#e6c89f' },
  G3: { bg: '#14532d', fg: '#e5e7eb' },
  G4: { bg: '#a16207', fg: '#fefce8' },
};

function fmtMoney(cents: number | null | undefined): string {
  if (cents == null) return '$—';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v.toFixed(1)}%`;
}
function bandColor(value: number | null, target: number): { bg: string; fg: string } {
  if (value == null) return { bg: 'rgba(0,0,0,0.03)', fg: 'rgba(0,0,0,0.3)' };
  const delta = value - target;
  if (delta >= 0) return { bg: 'rgba(22, 101, 52, 0.10)', fg: '#15803d' };
  if (delta >= -5) return { bg: 'rgba(202, 138, 4, 0.10)', fg: '#a16207' };
  return { bg: 'rgba(220, 38, 38, 0.10)', fg: '#b91c1c' };
}

export default function Patrons() {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<OverviewReport | null>(null);
  const [funnel, setFunnel] = useState<FunnelReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [oRes, fRes] = await Promise.all([
        fetch('/api/patrons/overview', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/patrons/funnel', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (oRes.ok) setOverview(oRes.report);
      if (fRes.ok) setFunnel(fRes.report);
      if (!oRes.ok) throw new Error(oRes.message || oRes.error || 'Overview failed');
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const syncNow = async () => {
    setSyncing(true);
    setError(null);
    try {
      const r = await fetch('/api/patrons/sync', { method: 'POST' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || body.error || 'Sync failed');
      await loadAll();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Patrons</h1>
        <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
          Loyalty-program members synced from Dripos. New patrons, retention funnel,
          top customers, per-location breakdown.
        </p>
      </div>

      {/* Sync row */}
      {overview?.sync && <SyncBar sync={overview.sync} syncing={syncing} onSync={syncNow} />}

      {error && (
        <div style={{
          background: '#fee2e2', color: '#b91c1c', padding: '10px 14px',
          borderRadius: 8, marginBottom: 14, fontSize: 13,
        }}>{error}</div>
      )}

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 22,
        borderBottom: '1px solid rgba(0,0,0,0.08)',
      }}>
        {([
          { id: 'overview', label: 'Overview' },
          { id: 'funnel', label: 'Retention funnel' },
          { id: 'by-location', label: 'By location' },
        ] as Array<{ id: Tab; label: string }>).map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '10px 18px', background: 'transparent',
                border: 0,
                borderBottom: `2px solid ${active ? '#1a1a1a' : 'transparent'}`,
                color: active ? '#1a1a1a' : 'rgba(0,0,0,0.45)',
                fontSize: 13, fontWeight: 600,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                cursor: 'pointer', marginBottom: -1,
              }}>{t.label}</button>
          );
        })}
      </div>

      {loading && !overview && (
        <div style={{ color: 'rgba(0,0,0,0.4)', padding: 24 }}>
          Loading patrons…
        </div>
      )}

      {overview && overview.totalActive === 0 && (
        <div style={{
          background: '#fff', borderRadius: 14,
          border: '1px solid rgba(0,0,0,0.06)',
          padding: '40px 24px', textAlign: 'center', color: 'rgba(0,0,0,0.45)',
        }}>
          No patron data yet. Click <strong>Sync from Dripos</strong> to pull the patron list.
        </div>
      )}

      {overview && overview.totalActive > 0 && (
        <>
          {tab === 'overview' && <OverviewView report={overview} isMobile={isMobile} />}
          {tab === 'funnel' && funnel && <FunnelView report={funnel} isMobile={isMobile} />}
          {tab === 'by-location' && <ByLocationView report={overview} isMobile={isMobile} />}
        </>
      )}
    </div>
  );
}

function SyncBar({ sync, syncing, onSync }: {
  sync: SyncMeta; syncing: boolean; onSync: () => void;
}) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
      background: '#fff', borderRadius: 12,
      border: '1px solid rgba(0,0,0,0.06)',
      padding: '12px 16px', marginBottom: 18,
      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
    }}>
      <button onClick={onSync} disabled={syncing}
        style={{
          padding: '8px 16px', borderRadius: 8, border: 0, cursor: 'pointer',
          background: '#1a1a1a', color: '#fff',
          fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
          opacity: syncing ? 0.55 : 1,
        }}>
        {syncing ? 'Syncing… (~60s)' : 'Sync from Dripos'}
      </button>
      {sync.lastSyncedAt ? (
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
          Last sync{' '}
          <strong>{new Date(sync.lastSyncedAt).toLocaleString([], {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          })}</strong>
          {sync.lastSyncCount != null && (
            <span> · {sync.lastSyncCount.toLocaleString()} patrons</span>
          )}
          {sync.lastSyncStatus && sync.lastSyncStatus !== 'ok' && (
            <span style={{ color: '#b91c1c', marginLeft: 8 }}>
              · last attempt failed{sync.lastSyncError ? `: ${sync.lastSyncError}` : ''}
            </span>
          )}
        </span>
      ) : (
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
          Never synced. Boot job runs ~1 min after deploy; manual sync available anytime.
        </span>
      )}
    </div>
  );
}

// ─── Overview Tab ───────────────────────────────────────────────────

function OverviewView({ report, isMobile }: { report: OverviewReport; isMobile: boolean }) {
  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
        gap: 12, marginBottom: 24,
      }}>
        <StatCard label="New this week" value={report.newThisWeek.toLocaleString()} />
        <StatCard label="New this month" value={report.newThisMonth.toLocaleString()} />
        <StatCard label="New this year" value={report.newThisYear.toLocaleString()} />
        <StatCard label="All patrons" value={report.totalActive.toLocaleString()} />
      </div>

      {report.topThisWeek && (
        <TopOfWeekCard patron={report.topThisWeek} seenThisWeek={report.seenThisWeek} />
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
        gap: 14, marginBottom: 24,
      }}>
        <TopList title="Top 10 by lifetime spend" patrons={report.topBySpend} metric="spend" />
        <TopList title="Top 10 by visits" patrons={report.topByVisits} metric="visits" />
      </div>

      {/* Subscribed counts */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
        gap: 12, marginBottom: 24,
      }}>
        <StatCard label="Text-subscribed"  value={report.textSubscribed.toLocaleString()}  dim />
        <StatCard label="Email-subscribed" value={report.emailSubscribed.toLocaleString()} dim />
        <StatCard label="Active patrons (not archived)" value={report.totalActive.toLocaleString()} dim />
      </div>
    </>
  );
}

function StatCard({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: '14px 18px',
      border: '1px solid rgba(0,0,0,0.07)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.45)',
        textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontSize: dim ? 20 : 28, fontWeight: 700, color: '#1a1a1a',
        fontVariantNumeric: 'tabular-nums', lineHeight: 1.05,
      }}>{value}</div>
    </div>
  );
}

function TopOfWeekCard({ patron, seenThisWeek }: { patron: TopPatron; seenThisWeek: number }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
      borderRadius: 14, padding: '18px 22px', marginBottom: 24,
      border: '1px solid rgba(161, 98, 7, 0.2)',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#854d0e',
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6,
      }}>★ Top customer this week</div>
      <div style={{
        fontSize: 24, fontWeight: 700, color: '#1a1a1a', letterSpacing: -0.3,
        fontFamily: 'var(--font-display)',
      }}>{patron.fullName || 'Unnamed customer'}</div>
      <div style={{
        marginTop: 4, fontSize: 12, color: '#5a4500',
      }}>
        Lifetime: <strong>{patron.lifetime} visits</strong> · <strong>{fmtMoney(patron.totalSpendCents)} spend</strong>
        {patron.primaryStore && <> · <strong>{patron.primaryStore}</strong></>}
        {patron.lastSeenMs && (
          <> · last seen {new Date(patron.lastSeenMs).toLocaleDateString()}</>
        )}
        <> · of {seenThisWeek} patrons seen this week</>
      </div>
    </div>
  );
}

function TopList({ title, patrons, metric }: {
  title: string; patrons: TopPatron[]; metric: 'spend' | 'visits';
}) {
  return (
    <div style={{
      background: '#fff', borderRadius: 14,
      border: '1px solid rgba(0,0,0,0.07)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 18px', borderBottom: '1px solid rgba(0,0,0,0.05)',
        fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.6)',
        textTransform: 'uppercase', letterSpacing: 0.6,
      }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: 'var(--font-body)' }}>
        <tbody>
          {patrons.map((p, i) => {
            const theme = p.primaryStore ? STORE_THEMES[p.primaryStore] : null;
            return (
              <tr key={p.driposId} style={{ borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                <td style={{ padding: '8px 14px', color: '#888', width: 28, textAlign: 'right' }}>{i + 1}</td>
                <td style={{ padding: '8px 14px' }}>
                  <div style={{ fontWeight: 500 }}>{p.fullName || 'Unnamed customer'}</div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                    {p.primaryStore && theme && (
                      <span style={{
                        display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                        background: theme.bg, color: theme.fg,
                        fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                        marginRight: 6, verticalAlign: 'middle',
                      }}>{p.primaryStore}</span>
                    )}
                    {p.lifetime} visits · avg ticket {fmtMoney(p.averageTicketCents)}
                  </div>
                </td>
                <td style={{
                  padding: '8px 14px', textAlign: 'right', whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                }}>
                  {metric === 'spend' ? fmtMoney(p.totalSpendCents) : p.lifetime}
                </td>
              </tr>
            );
          })}
          {patrons.length === 0 && (
            <tr><td colSpan={3} style={{ padding: 18, textAlign: 'center', color: 'rgba(0,0,0,0.4)', fontSize: 12 }}>
              No data yet.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Funnel Tab ─────────────────────────────────────────────────────

function FunnelView({ report, isMobile }: { report: FunnelReport; isMobile: boolean }) {
  return (
    <>
      <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 13, marginTop: -8, marginBottom: 18 }}>
        Jon Taffer benchmarks: <strong>40%</strong> of first-time guests come back, <strong>42%</strong> of return guests come a third time, <strong>70%</strong> of three-time guests become regulars. Cells tint green at-or-above, yellow within 5pp, red below.
      </p>

      <ChainSummaryCard chain={report.chain} />
      <MonthlyFunnelTable months={report.monthly} isMobile={isMobile} />
    </>
  );
}

function ChainSummaryCard({ chain }: { chain: FunnelChain }) {
  const stages = [
    { label: '1st-time visit', value: chain.total, pct: 100, target: null as number | null },
    { label: 'Came back (2+)', value: chain.twoPlus, pct: chain.pct2Plus, target: TAFFER.pct2Plus },
    { label: '3rd visit (3+)', value: chain.threePlus, pct: chain.pct3Plus, target: TAFFER.pct3Plus },
    { label: 'Regular (4+)',   value: chain.fourPlus, pct: chain.pct4Plus, target: TAFFER.pct4Plus },
    { label: 'Loyal (5+)',     value: chain.fivePlus, pct: chain.pct5Plus, target: null as number | null },
  ];

  return (
    <div style={{
      background: '#fff', borderRadius: 14,
      border: '1px solid rgba(0,0,0,0.06)',
      padding: '18px 22px', marginBottom: 22,
      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.5)',
        textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 14,
      }}>Chain funnel · all time</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
        {stages.map((s, i) => {
          // First stage has its own neutral look; subsequent stages with
          // a Taffer target are tinted against it; the 5+ stage has no
          // benchmark so it stays neutral too.
          const hasTarget = s.target != null;
          const tone = hasTarget ? bandColor(s.pct, s.target!) : { bg: 'rgba(0,0,0,0.03)', fg: '#1a1a1a' };
          return (
            <div key={s.label} style={{
              padding: '12px 14px', borderRadius: 10,
              background: i === 0 || !hasTarget ? 'rgba(0,0,0,0.03)' : tone.bg,
              border: i === 0 || !hasTarget
                ? '1px solid rgba(0,0,0,0.06)'
                : `1px solid ${tone.bg}`,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.5)',
                textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4,
              }}>{s.label}</div>
              <div style={{
                fontSize: 22, fontWeight: 700, color: '#1a1a1a',
                fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
              }}>{s.value.toLocaleString()}</div>
              <div style={{
                fontSize: 13, fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: tone.fg, marginTop: 2,
              }}>{i === 0 ? '100%' : fmtPct(s.pct)}</div>
              {hasTarget && s.pct != null && (
                <div style={{
                  fontSize: 10, marginTop: 4, color: 'rgba(0,0,0,0.4)',
                  letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 600,
                }}>
                  Taffer {s.target}% ({s.pct >= s.target! ? '+' : ''}{(s.pct - s.target!).toFixed(1)}pp)
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthlyFunnelTable({ months, isMobile }: { months: FunnelMonth[]; isMobile: boolean }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 14,
      border: '1px solid rgba(0,0,0,0.06)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 22px',
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
      }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Monthly funnel</span>
        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
          By first-visit month · most recent first
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontSize: 13, fontFamily: 'var(--font-body)',
        }}>
          <thead>
            <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
              <Th>Month</Th>
              <Th align="right">1st-time</Th>
              {!isMobile && <Th align="right">1-only</Th>}
              <Th align="right">% 2+</Th>
              {!isMobile && <Th align="right">2</Th>}
              <Th align="right">% 3+</Th>
              {!isMobile && <Th align="right">3</Th>}
              <Th align="right">% 4+</Th>
              {!isMobile && <Th align="right">4</Th>}
              <Th align="right">% 5+</Th>
              {!isMobile && <Th align="right">5+</Th>}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const t2 = bandColor(m.pct2Plus, TAFFER.pct2Plus);
              const t3 = bandColor(m.pct3Plus, TAFFER.pct3Plus);
              const t4 = bandColor(m.pct4Plus, TAFFER.pct4Plus);
              // 5+ has no Taffer benchmark, so use a neutral tone
              // (light grey background, plain dark text).
              const t5 = { bg: 'rgba(0,0,0,0.04)', fg: 'rgba(0,0,0,0.7)' };
              return (
                <tr key={m.yearMonth} style={{
                  borderTop: '1px solid rgba(0,0,0,0.05)',
                  opacity: m.immature ? 0.65 : 1,
                }}>
                  <Td>
                    <strong>{m.label}</strong>
                    {m.immature && (
                      <span title="Patrons haven't had time to make all return visits yet" style={{
                        marginLeft: 8, fontSize: 9, fontWeight: 700,
                        color: 'rgba(0,0,0,0.45)', letterSpacing: 0.6,
                        textTransform: 'uppercase',
                        padding: '2px 6px', borderRadius: 4,
                        background: 'rgba(0,0,0,0.05)',
                      }}>too recent</span>
                    )}
                  </Td>
                  <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{m.total}</Td>
                  {!isMobile && <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>{m.oneOnly}</Td>}
                  <Td align="right"><PctChip pct={m.pct2Plus} tone={t2} /></Td>
                  {!isMobile && <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>{m.exactlyTwo}</Td>}
                  <Td align="right"><PctChip pct={m.pct3Plus} tone={t3} /></Td>
                  {!isMobile && <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>{m.exactlyThree}</Td>}
                  <Td align="right"><PctChip pct={m.pct4Plus} tone={t4} /></Td>
                  {!isMobile && <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>{m.exactlyFour}</Td>}
                  <Td align="right"><PctChip pct={m.pct5Plus} tone={t5} /></Td>
                  {!isMobile && <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>{m.fivePlus}</Td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PctChip({ pct, tone }: { pct: number | null; tone: { bg: string; fg: string } }) {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 999,
      background: tone.bg, color: tone.fg,
      fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
    }}>{fmtPct(pct)}</span>
  );
}

// ─── By Location Tab ────────────────────────────────────────────────

function ByLocationView({ report, isMobile }: { report: OverviewReport; isMobile: boolean }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
      gap: 14,
    }}>
      {report.byLocation.map((loc) => {
        const theme = STORE_THEMES[loc.storeLabel] ?? { bg: '#1a1a1a', fg: '#fff' };
        return (
          <div key={loc.storeLabel} style={{
            background: '#fff', borderRadius: 14,
            border: '1px solid rgba(0,0,0,0.07)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '14px 18px',
              background: theme.bg, color: theme.fg,
              fontSize: 15, fontWeight: 700,
            }}>{loc.storeLabel}</div>
            <div style={{ padding: '14px 18px' }}>
              <Row k="Total patrons (first-seen here)" v={loc.totalPatrons.toLocaleString()} />
              <Row k="New this week" v={loc.newThisWeek.toLocaleString()} />
              <Row k="New this month" v={loc.newThisMonth.toLocaleString()} />
              <Row k="Active this week" v={`${loc.activeThisWeek.toLocaleString()} seen`} />
              <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '10px 0' }} />
              {loc.topBySpend && (
                <Row k="Top spender (lifetime)" v={
                  <>
                    <strong>{loc.topBySpend.fullName || 'Unnamed'}</strong>
                    <span style={{ color: 'rgba(0,0,0,0.5)', marginLeft: 6 }}>
                      {fmtMoney(loc.topBySpend.totalSpendCents)}
                    </span>
                  </>
                } />
              )}
              {loc.topByVisits && (
                <Row k="Most visits (lifetime)" v={
                  <>
                    <strong>{loc.topByVisits.fullName || 'Unnamed'}</strong>
                    <span style={{ color: 'rgba(0,0,0,0.5)', marginLeft: 6 }}>
                      {loc.topByVisits.lifetime} visits
                    </span>
                  </>
                } />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      fontSize: 13, padding: '4px 0',
      fontVariantNumeric: 'tabular-nums',
    }}>
      <span style={{ color: 'rgba(0,0,0,0.55)' }}>{k}</span>
      <span style={{ color: '#1a1a1a' }}>{v}</span>
    </div>
  );
}

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
function Td({ children, align, style }: { children?: React.ReactNode; align?: 'left' | 'right'; style?: React.CSSProperties }) {
  return (
    <td style={{
      textAlign: align ?? 'left',
      padding: '10px 14px', whiteSpace: 'nowrap',
      ...style,
    }}>{children}</td>
  );
}
