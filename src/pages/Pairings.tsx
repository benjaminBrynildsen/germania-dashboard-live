/**
 * Pastry → drink pairing analysis. For each Bake Haus food item, which
 * other items show up on the same ticket most often? Drives marketing
 * decisions like "people who buy MBS Scones also love a Caramel
 * Macchiato → suggest the latte upsell when scones are added to cart."
 *
 * Data source: server-side co-occurrence query over the `ticket_items`
 * table, populated by the per-ticket Dripos sync. Backfill + daily
 * cron live in server/dripos-tickets.ts.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../hooks/useAuth';

interface Pairing {
  name: string;
  coTickets: number;
  pct: number;
}
interface PastryRow {
  pastry: string;
  totalTickets: number;
  topPairings: Pairing[];
}
interface PairingsResponse {
  ok: boolean;
  days: number;
  location: string | null;
  fromMs: number;
  toMs: number;
  pastryCount: number;
  pastries: PastryRow[];
}

interface SyncStatus {
  inProgress: boolean;
  startedAt: number | null;
  progressPct: number;
  message: string | null;
  lastSyncedAt: number | null;
  lastSyncCount: number | null;
  lastSyncStatus: string | null;
  totalTickets: number;
  withDetails: number;
}

interface WeekStatus {
  weekStartIso: string;
  ticketCount: number;
  detailCount: number;
  failedCount: number;
}

const STORE_OPTIONS = ['All', 'G1', 'G2', 'G3', 'G4'];
const DAY_OPTIONS = [
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
  { value: 180, label: '6 months' },
  { value: 365, label: '1 year' },
];

export default function Pairings() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [data, setData] = useState<PairingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const [store, setStore] = useState('All');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [backfillingDays, setBackfillingDays] = useState<number | null>(null);
  const [weeks, setWeeks] = useState<WeekStatus[]>([]);
  const [showWeekPicker, setShowWeekPicker] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('days', String(days));
      if (store !== 'All') params.set('location', store);
      const r = await fetch('/api/pairings/pastry?' + params.toString(), { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || body.error || 'Failed to load pairings');
      setData(body);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [days, store]);

  useEffect(() => { load(); }, [load]);

  const fetchWeeks = useCallback(async () => {
    try {
      const r = await fetch('/api/tickets/weeks?weeks=26', { cache: 'no-store' });
      const body = await r.json();
      if (r.ok) setWeeks(body.weeks ?? []);
    } catch { /* non-fatal */ }
  }, []);

  // Poll sync status while a backfill is running so the page reflects
  // progress without a manual refresh.
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const r = await fetch('/api/tickets/sync-status', { cache: 'no-store' });
        const body = await r.json();
        if (r.ok) setStatus(body.status);
      } catch { /* non-fatal */ }
    };
    fetchStatus();
    fetchWeeks();
    const id = setInterval(() => {
      fetchStatus();
      // Only re-fetch the per-week table while a sync is running (or
      // the week-picker is open) — otherwise the counts don't change.
      if (status?.inProgress || showWeekPicker) fetchWeeks();
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.inProgress, showWeekPicker]);

  // Auto-reload data when a backfill finishes so new pairings show up.
  useEffect(() => {
    if (status?.inProgress) return;
    if (!data) return;
    // After backfill completes the dataset changes; refresh.
    if (status?.lastSyncedAt && status.lastSyncedAt > data.toMs - 60_000) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.inProgress, status?.lastSyncedAt]);

  const startBackfill = async (n: number) => {
    setBackfillingDays(n);
    try {
      const r = await fetch('/api/tickets/backfill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: n }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || body.error || 'Backfill failed');
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setBackfillingDays(null);
    }
  };

  const syncWeek = async (weekStartIso: string) => {
    try {
      const r = await fetch('/api/tickets/sync-week', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ week: weekStartIso }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || body.error || 'Week sync failed');
      // Trigger an immediate status fetch so the badge flips fast.
      await fetchWeeks();
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  const totalTickets = useMemo(
    () => (data?.pastries ?? []).reduce((acc, p) => acc + p.totalTickets, 0),
    [data],
  );

  return (
    <div>
      <div style={{ marginBottom: isMobile ? 14 : 18 }}>
        <h1 style={{
          fontSize: isMobile ? 22 : 28,
          fontWeight: 700, letterSpacing: -0.5, margin: 0,
        }}>Pairings</h1>
        {!isMobile && (
          <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
            What customers buy with each pastry. Click any pastry to see its top co-occurring items + percentage. Use it to drive cross-sell + marketing decisions.
          </p>
        )}
      </div>

      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 14,
          background: '#fef2f2', border: '1px solid #fecaca',
          color: '#b91c1c', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* Filters + sync status */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 12,
        marginBottom: 16, alignItems: 'center',
      }}>
        <Select value={String(days)} onChange={(v) => setDays(Number(v))} options={DAY_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))} />
        <Select value={store} onChange={setStore} options={STORE_OPTIONS.map((s) => ({ value: s, label: s }))} />
        <div style={{ flex: 1 }} />
        <SyncBadge status={status} />
        {isAdmin && (
          <>
            <button
              onClick={() => startBackfill(30)}
              disabled={!!backfillingDays || status?.inProgress}
              style={{
                padding: '7px 12px', borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.12)',
                background: status?.inProgress ? 'rgba(0,0,0,0.05)' : '#1a1a1a',
                color: status?.inProgress ? 'rgba(0,0,0,0.4)' : '#fff',
                fontSize: 12, fontWeight: 600,
                cursor: status?.inProgress ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {status?.inProgress ? 'Syncing…' : 'Backfill 30 days'}
            </button>
            <button
              onClick={() => setShowWeekPicker((v) => !v)}
              style={{
                padding: '7px 12px', borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.12)',
                background: '#fff', color: '#1a1a1a',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {showWeekPicker ? 'Hide weeks' : 'Pull historical week →'}
            </button>
          </>
        )}
      </div>

      {isAdmin && showWeekPicker && (
        <WeekPicker
          weeks={weeks}
          syncing={!!status?.inProgress}
          onSync={syncWeek}
        />
      )}

      {loading && !data && (
        <div style={{ color: 'rgba(0,0,0,0.3)', padding: 40, textAlign: 'center' }}>Loading pairings…</div>
      )}

      {data && data.pastries.length === 0 && !status?.inProgress && (
        <div style={{
          padding: 32, textAlign: 'center', color: 'rgba(0,0,0,0.4)', fontSize: 14,
          background: 'rgba(0,0,0,0.02)', borderRadius: 12,
        }}>
          No pairing data yet.{' '}
          {isAdmin
            ? <button onClick={() => startBackfill(90)} style={{ background: 'none', border: 0, color: '#1a1a1a', textDecoration: 'underline', cursor: 'pointer' }}>Run a backfill →</button>
            : 'Ask an admin to run the backfill from this page.'}
        </div>
      )}

      {data && (
        <div style={{ marginBottom: 12, color: 'rgba(0,0,0,0.5)', fontSize: 12 }}>
          {totalTickets.toLocaleString()} pastry-tickets analyzed across {data.pastryCount} item{data.pastryCount === 1 ? '' : 's'} · last {data.days} days{data.location ? ` · ${data.location}` : ''}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {(data?.pastries ?? []).map((p) => (
          <PastryCard key={p.pastry} pastry={p} />
        ))}
      </div>
    </div>
  );
}

function PastryCard({ pastry }: { pastry: PastryRow }) {
  const [expanded, setExpanded] = useState(false);
  const top = pastry.topPairings.slice(0, expanded ? 25 : 8);
  const max = top[0]?.pct ?? 1;
  return (
    <div style={{
      background: '#fff',
      border: '1px solid rgba(0,0,0,0.08)',
      borderRadius: 12,
      padding: '16px 18px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#111' }}>{pastry.pastry}</div>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
            on {pastry.totalTickets.toLocaleString()} ticket{pastry.totalTickets === 1 ? '' : 's'}
          </div>
        </div>
      </div>
      {top.length === 0 ? (
        <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13, padding: '8px 0' }}>
          No co-occurring items yet — needs more ticket history.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {top.map((p) => {
            const pct = Math.round(p.pct * 100);
            const barPct = (p.pct / max) * 100;
            return (
              <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                <div style={{ flex: '0 0 220px', fontSize: 13, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.name}
                </div>
                <div style={{ flex: 1, background: 'rgba(0,0,0,0.04)', borderRadius: 4, height: 14, overflow: 'hidden' }}>
                  <div style={{
                    width: `${barPct}%`, height: '100%',
                    background: 'linear-gradient(90deg, #1a1a1a, #444)',
                    transition: 'width 0.3s',
                  }} />
                </div>
                <div style={{ flex: '0 0 88px', textAlign: 'right', fontSize: 12, color: 'rgba(0,0,0,0.55)', fontVariantNumeric: 'tabular-nums' }}>
                  {pct}% <span style={{ color: 'rgba(0,0,0,0.3)' }}>· {p.coTickets.toLocaleString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {pastry.topPairings.length > 8 && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            marginTop: 10, padding: '4px 10px', borderRadius: 6,
            border: '1px solid rgba(0,0,0,0.1)', background: '#fff',
            color: 'rgba(0,0,0,0.6)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {expanded ? 'Show top 8' : `Show all ${pastry.topPairings.length}`}
        </button>
      )}
    </div>
  );
}

function WeekPicker({
  weeks, syncing, onSync,
}: {
  weeks: WeekStatus[];
  syncing: boolean;
  onSync: (weekStartIso: string) => void;
}) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid rgba(0,0,0,0.08)',
      borderRadius: 12,
      padding: '14px 18px',
      marginBottom: 16,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Historical week sync</div>
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 12 }}>
        Each week is Mon-Sun. Pulling a week adds those tickets to the DB; they accumulate over time and feed the analysis above. ~4 min per week.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {weeks.map((w) => {
          const range = formatWeekRange(w.weekStartIso);
          const hasData = w.ticketCount > 0;
          const hasDetails = w.detailCount > 0;
          const allDetails = hasData && w.detailCount === w.ticketCount;
          return (
            <div key={w.weekStartIso} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.04)',
            }}>
              <div style={{ flex: '0 0 180px', fontSize: 13 }}>
                {range}
              </div>
              <div style={{ flex: 1, fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                {hasData ? (
                  <>
                    <strong style={{ color: '#1a1a1a' }}>{w.ticketCount.toLocaleString()}</strong> tickets
                    {hasDetails && (
                      <> · <span style={{ color: allDetails ? '#166534' : '#a16207' }}>
                        {w.detailCount.toLocaleString()} with items
                      </span></>
                    )}
                    {w.failedCount > 0 && (
                      <> · <span style={{ color: '#b91c1c' }}>{w.failedCount} failed</span></>
                    )}
                  </>
                ) : (
                  <span style={{ color: 'rgba(0,0,0,0.3)' }}>—</span>
                )}
              </div>
              <button
                onClick={() => onSync(w.weekStartIso)}
                disabled={syncing}
                style={{
                  padding: '4px 10px', borderRadius: 6,
                  border: '1px solid rgba(0,0,0,0.12)',
                  background: syncing ? 'rgba(0,0,0,0.04)' : '#fff',
                  color: syncing ? 'rgba(0,0,0,0.4)' : '#1a1a1a',
                  fontSize: 11, fontWeight: 600,
                  cursor: syncing ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {hasData ? 'Re-pull' : 'Pull'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatWeekRange(weekStartIso: string): string {
  const mon = new Date(weekStartIso + 'T00:00:00');
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const year = sun.getFullYear() !== new Date().getFullYear() ? `, ${sun.getFullYear()}` : '';
  return `${fmt(mon)} – ${fmt(sun)}${year}`;
}

function SyncBadge({ status }: { status: SyncStatus | null }) {
  if (!status) return null;
  if (status.inProgress) {
    return (
      <span style={badge('#fef3c7', '#92400e')}>
        Backfilling: {status.message || '...'}
      </span>
    );
  }
  if (status.totalTickets === 0) {
    return <span style={badge('#fee2e2', '#b91c1c')}>No tickets yet — backfill needed</span>;
  }
  return (
    <span style={badge('rgba(0,0,0,0.04)', 'rgba(0,0,0,0.55)')}>
      {status.totalTickets.toLocaleString()} tickets · {status.withDetails.toLocaleString()} with items
    </span>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '7px 10px', borderRadius: 8,
        border: '1px solid rgba(0,0,0,0.12)',
        background: '#fff', fontSize: 13, fontWeight: 500,
        fontFamily: 'inherit', cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function badge(bg: string, color: string): React.CSSProperties {
  return {
    padding: '5px 10px', borderRadius: 999,
    background: bg, color,
    fontSize: 11, fontWeight: 600, letterSpacing: 0.2,
  };
}
