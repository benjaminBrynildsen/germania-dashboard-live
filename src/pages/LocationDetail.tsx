import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../hooks/useAuth';
import { TICKET_WEEKS } from '../data/ticketData';

const TICKET_HOURS = ['6AM','7AM','8AM','9AM','10AM','11AM','12PM','1PM','2PM','3PM','4PM','5PM'];

function getLocationAvgTicketTime(locId: string): number | null {
  const latest = TICKET_WEEKS[0];
  if (!latest) return null;
  const d = latest.data[locId.toUpperCase()];
  if (!d) return null;
  const vals: number[] = [];
  TICKET_HOURS.forEach(h => ((d.hours || {})[h] || []).forEach((v: number | null) => { if (v !== null && v <= 20) vals.push(v); }));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

interface Location {
  id: string;
  name: string;
  address: string;
  googleRating: number;
  reviewCount: number;
  weeklyRevenue: number;
  revenueChange: number;
  avgTicketTime: number | null;
  status: string;
}

const TABS = ['Overview', 'Sales', 'Reviews', 'Staff'];

const FAKE_REVIEWS = [
  { author: 'Sarah M.', rating: 5, text: 'Best coffee in the area hands down. The Haus Vanilla Latte is incredible.', date: '2 days ago' },
  { author: 'Mike T.', rating: 5, text: 'Friendly staff, fast service, and great atmosphere. We come here every weekend.', date: '5 days ago' },
  { author: 'Jessica L.', rating: 4, text: 'Really good cold brew. Gets busy on weekend mornings but worth the wait.', date: '1 week ago' },
];

const WEEKLY_DATA = [
  { day: 'Mon', value: 65 },
  { day: 'Tue', value: 72 },
  { day: 'Wed', value: 68 },
  { day: 'Thu', value: 80 },
  { day: 'Fri', value: 95 },
  { day: 'Sat', value: 100 },
  { day: 'Sun', value: 78 },
];

function KPICard({ label, value, sub, clickable }: { label: string; value: string; sub?: string; clickable?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => clickable && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.80)',
        border: `1px solid ${hovered ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.07)'}`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 16,
        padding: '20px 22px',
        boxShadow: hovered ? '0 6px 20px rgba(0,0,0,0.08)' : '0 2px 12px rgba(0,0,0,0.05)',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
        transform: hovered ? 'translateY(-2px)' : 'none',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(0,0,0,0.35)', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {label}
        {clickable && <span style={{ fontSize: 11, opacity: hovered ? 0.5 : 0.25, transition: 'opacity 0.2s' }}>→</span>}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#111', letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function BarChart() {
  const max = Math.max(...WEEKLY_DATA.map(d => d.value));
  return (
    <div style={{
      background: 'rgba(255,255,255,0.80)',
      border: '1px solid rgba(0,0,0,0.07)',
      backdropFilter: 'blur(20px)',
      borderRadius: 16,
      padding: '24px 28px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(0,0,0,0.35)', marginBottom: 20 }}>Weekly Sales Trend</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 80 }}>
        {WEEKLY_DATA.map(d => (
          <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: '100%',
              height: `${(d.value / max) * 68}px`,
              background: d.day === 'Sat' ? '#1a1a1a' : 'rgba(0,0,0,0.12)',
              borderRadius: 5,
              transition: 'all 0.3s',
            }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.3)', letterSpacing: '0.05em' }}>{d.day}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LocationDetail() {
  const isMobile = useIsMobile();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [location, setLocation] = useState<Location | null>(null);
  const [tab, setTab] = useState('Overview');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/locations').then((locs: Location[]) => {
      setLocation(locs.find(l => l.id === id) || null);
    }).finally(() => setLoading(false));
  }, [id]);

  if (loading || !location) {
    return (
      <div style={pageWrap}>
        <div style={{ color: 'rgba(0,0,0,0.3)', padding: 60, textAlign: 'center', fontSize: 14 }}>
          {loading ? 'Loading...' : 'Location not found'}
        </div>
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: isMobile ? '20px 12px' : '48px 32px' }}>

        {/* Back */}
        <button
          onClick={() => navigate('/locations')}
          style={{ background: 'none', border: 'none', color: 'rgba(0,0,0,0.4)', fontSize: 13, cursor: 'pointer', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 6, padding: 0, fontWeight: 600, fontFamily: 'inherit' }}
        >
          ← All Locations
        </button>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0, marginBottom: 24 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: '#1a1a1a', padding: '3px 9px', borderRadius: 6, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {location.id}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#166534', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
                Open
              </span>
            </div>
            <h1 style={{ fontSize: 30, fontWeight: 800, color: '#111', letterSpacing: -0.6 }}>{location.name}</h1>
            <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>{location.address}</p>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid rgba(0,0,0,0.08)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none',
                border: 'none',
                color: tab === t ? '#111' : 'rgba(0,0,0,0.38)',
                fontSize: 14,
                fontWeight: tab === t ? 700 : 500,
                padding: '10px 18px',
                cursor: 'pointer',
                borderBottom: `2px solid ${tab === t ? '#111' : 'transparent'}`,
                marginBottom: -1,
                transition: 'all 0.15s',
                fontFamily: 'inherit',
                letterSpacing: tab === t ? '-0.01em' : '0',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Overview */}
        {tab === 'Overview' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
              <KPICard
                label="Weekly Sales"
                value={`$${(location.weeklyRevenue / 1000).toFixed(1)}k`}
                sub={`${location.revenueChange >= 0 ? '+' : ''}${location.revenueChange}% vs last week`}
              />
              <Link to={`/locations/${location.id}/reviews`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <KPICard label="Google Rating" value={`${location.googleRating}★`} sub={`${location.reviewCount} reviews`} clickable />
              </Link>
              <Link to={`/ticket-time?loc=${location.id.toUpperCase()}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <KPICard
                  label="Avg Ticket Time"
                  value={(() => { const avg = getLocationAvgTicketTime(location.id); return avg !== null ? `${avg.toFixed(1)} min` : '—'; })()}
                  sub={`Week ${TICKET_WEEKS[0]?.weekNum ?? '?'} · View Details →`}
                  clickable
                />
              </Link>
              <KPICard label="Open Items" value="0" sub="No flagged issues" />
            </div>

            <div style={{ marginBottom: 20 }}>
              <BarChart />
            </div>

            {/* Reviews */}
            <Link to={`/locations/${location.id}/reviews`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div style={{
              background: 'rgba(255,255,255,0.80)',
              border: '1px solid rgba(0,0,0,0.07)',
              backdropFilter: 'blur(20px)',
              borderRadius: 16,
              padding: '24px 28px',
              boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(0,0,0,0.35)', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Recent Google Reviews
                <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0, textTransform: 'none', opacity: 0.6 }}>View All →</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {FAKE_REVIEWS.map((r, i) => (
                  <div key={i} style={{
                    padding: '16px 0',
                    borderBottom: i < FAKE_REVIEWS.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{r.author}</span>
                      <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.25)', fontWeight: 500 }}>{r.date}</span>
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      {[1,2,3,4,5].map(s => (
                        <span key={s} style={{ fontSize: 12, color: s <= r.rating ? '#1a1a1a' : 'rgba(0,0,0,0.12)' }}>★</span>
                      ))}
                    </div>
                    <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', lineHeight: 1.6 }}>{r.text}</p>
                  </div>
                ))}
              </div>
            </div>
            </Link>
          </div>
        )}

        {tab === 'Sales' && <SalesTab locId={location.id} />}
        {tab === 'Reviews' && <ReviewsTab locId={location.id} />}
        {tab === 'Staff' && <StaffTab locId={location.id} />}
      </div>
    </div>
  );
}

// ── Sales tab ────────────────────────────────────────────────────────────
// Daily sales + avg ticket time from Dripos, last 28 days. Bars are sized
// to the max non-zero day so a single big Saturday doesn't flatten everything.

interface DailySalesPoint {
  date: string;            // YYYY-MM-DD
  avgTicketMin: number | null;
  ticketCount: number;
  salesCents: number;
}

function SalesTab({ locId }: { locId: string }) {
  const [series, setSeries] = useState<DailySalesPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/dripos/ticket-vs-sales/${locId.toUpperCase()}?days=28`, { cache: 'no-store' })
      .then(async r => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.message || j.error || 'Failed to load sales');
        setSeries(j.series || []);
      })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [locId]);

  if (loading) return <SectionLoading label="Loading sales…" />;
  if (error) return <SectionError msg={error} />;
  if (!series || series.length === 0) return <SectionEmpty label="No sales data yet." />;

  // Compute current vs prior 7-day windows. Today is excluded server-side
  // already, so the most recent point is yesterday. Use the last 7 vs the
  // 7 before that.
  const last7 = series.slice(-7);
  const prev7 = series.slice(-14, -7);
  const sum = (arr: DailySalesPoint[]) => arr.reduce((a, p) => a + p.salesCents, 0);
  const last7Total = sum(last7);
  const prev7Total = sum(prev7);
  const change = prev7Total > 0 ? ((last7Total - prev7Total) / prev7Total) * 100 : null;
  const ticketsLast7 = last7.reduce((a, p) => a + p.ticketCount, 0);
  const avgTktLast7 = (() => {
    const w = last7.filter(p => p.avgTicketMin !== null && p.ticketCount > 0);
    const total = w.reduce((acc, p) => acc + (p.avgTicketMin || 0) * p.ticketCount, 0);
    const ct = w.reduce((acc, p) => acc + p.ticketCount, 0);
    return ct > 0 ? total / ct : null;
  })();

  const maxSales = Math.max(1, ...series.map(p => p.salesCents));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <KPICard label="Last 7 days" value={fmtMoney(last7Total)} sub={change !== null ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs prior 7` : '—'} />
        <KPICard label="Tickets" value={ticketsLast7.toLocaleString()} sub="last 7 days" />
        <KPICard label="Avg Ticket Time" value={avgTktLast7 !== null ? `${avgTktLast7.toFixed(1)} min` : '—'} sub="weighted, last 7 days" />
      </div>

      {/* Daily bar chart — 28 days */}
      <div style={{
        background: 'rgba(255,255,255,0.80)',
        border: '1px solid rgba(0,0,0,0.07)',
        backdropFilter: 'blur(20px)',
        borderRadius: 16,
        padding: '24px 28px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(0,0,0,0.35)', marginBottom: 20 }}>
          Daily Sales · Last {series.length} days
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140 }}>
          {series.map((p, i) => {
            const h = (p.salesCents / maxSales) * 130;
            const dow = new Date(p.date + 'T00:00:00').getDay(); // 0=Sun
            const isWeekend = dow === 0 || dow === 6;
            return (
              <div key={p.date} title={`${p.date}: ${fmtMoney(p.salesCents)} · ${p.ticketCount} tickets`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <div style={{
                  width: '100%',
                  height: `${Math.max(2, h)}px`,
                  background: isWeekend ? '#1a1a1a' : 'rgba(0,0,0,0.18)',
                  borderRadius: 4,
                  transition: 'all 0.2s',
                }} />
                {i % Math.ceil(series.length / 7) === 0 && (
                  <span style={{ fontSize: 9, color: 'rgba(0,0,0,0.3)' }}>{p.date.slice(5)}</span>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>
          Weekend days highlighted. Today is excluded (incomplete).
        </div>
      </div>
    </div>
  );
}

// ── Reviews tab ──────────────────────────────────────────────────────────
// Mirrors the full GoogleReviews page in compact form. Shows aggregate rating,
// star distribution, and the 5 most recent reviews with a link to the full feed.

interface ReviewRow {
  id: number;
  author: string;
  rating: number;
  text: string;
  date: string;
  relativeDate: string;
  replied?: boolean;
  replyText?: string;
}
interface ReviewsResponse {
  reviews: ReviewRow[];
  distribution: { stars: number; count: number }[];
  source?: string;
  lastSyncedAt?: string | null;
  location?: { googlePlaceId?: string | null };
}

function ReviewsTab({ locId }: { locId: string }) {
  const { user } = useAuth();
  const canSync = user?.role === 'admin' || user?.role === 'manager';
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const loadReviews = () => {
    setLoading(true);
    setError(null);
    fetch(`/api/locations/${locId}/reviews`, { cache: 'no-store' })
      .then(async r => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.message || j.error || 'Failed to load reviews');
        setData(j);
      })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(loadReviews, [locId]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch(`/api/locations/${locId}/sync-reviews`, {
        method: 'POST',
        cache: 'no-store',
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
      // Server returns { synced: N, error?: string }
      if (j.error) {
        setSyncMsg(`Sync error: ${j.error}`);
      } else {
        setSyncMsg(`Synced ${j.synced} review${j.synced === 1 ? '' : 's'} from Google.`);
      }
      // Reload the reviews list whether or not the sync wrote new rows —
      // lastSyncedAt always updates if at least one upsert touched the table.
      loadReviews();
    } catch (e: any) {
      setSyncMsg(`Sync failed: ${e.message || String(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <SectionLoading label="Loading reviews…" />;
  if (error) return <SectionError msg={error} />;
  if (!data) return <SectionEmpty label="No reviews yet." />;

  const total = data.distribution.reduce((a, b) => a + b.count, 0);
  const recent = data.reviews.slice(0, 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Sync status + manual trigger (admin-only) */}
      <div style={{
        background: 'rgba(255,255,255,0.80)',
        border: '1px solid rgba(0,0,0,0.07)',
        backdropFilter: 'blur(20px)',
        borderRadius: 12,
        padding: '12px 18px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
            {data.lastSyncedAt ? (
              <>Last synced from Google: <strong style={{ color: '#111' }}>{fmtTimeAgo(data.lastSyncedAt)}</strong></>
            ) : (
              <span style={{ color: 'rgba(0,0,0,0.4)' }}>Never synced from Google (demo data)</span>
            )}
            {data.location?.googlePlaceId == null && (
              <span style={{ marginLeft: 10, padding: '2px 8px', borderRadius: 6, background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 700 }}>NO PLACE_ID</span>
            )}
          </div>
          {canSync && (
            <button
              onClick={handleSync}
              disabled={syncing}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.12)',
                background: syncing ? 'rgba(0,0,0,0.04)' : '#111',
                color: syncing ? 'rgba(0,0,0,0.4)' : '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: syncing ? 'wait' : 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
        {syncMsg && (
          <div style={{ fontSize: 12, color: syncMsg.startsWith('Sync error') || syncMsg.startsWith('Sync failed') ? '#b91c1c' : '#166534' }}>
            {syncMsg}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', lineHeight: 1.5 }}>
          Google Places API returns the <strong>5 most recent reviews</strong> per location per call (hard cap). New reviews append to the DB on each sync; old ones are kept.
        </div>
      </div>

      {/* Distribution */}
      <div style={{
        background: 'rgba(255,255,255,0.80)',
        border: '1px solid rgba(0,0,0,0.07)',
        backdropFilter: 'blur(20px)',
        borderRadius: 16,
        padding: '24px 28px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(0,0,0,0.35)', marginBottom: 16 }}>
          Star Distribution · {total} reviews
          {data.source === 'demo' && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.3)' }}>(demo data)</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.distribution.map(d => {
            const pct = total > 0 ? (d.count / total) * 100 : 0;
            return (
              <div key={d.stars} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600, width: 30, color: 'rgba(0,0,0,0.5)' }}>{d.stars}★</span>
                <div style={{ flex: 1, background: 'rgba(0,0,0,0.06)', borderRadius: 4, height: 10, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: '#1a1a1a', borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
                <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', width: 36, textAlign: 'right' }}>{d.count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent reviews */}
      <div style={{
        background: 'rgba(255,255,255,0.80)',
        border: '1px solid rgba(0,0,0,0.07)',
        backdropFilter: 'blur(20px)',
        borderRadius: 16,
        padding: '24px 28px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(0,0,0,0.35)' }}>
            Recent Reviews
          </div>
          <Link to={`/locations/${locId}/reviews`} style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', textDecoration: 'none' }}>
            View all →
          </Link>
        </div>
        {recent.length === 0 ? (
          <div style={{ color: 'rgba(0,0,0,0.3)', fontSize: 13, padding: 16 }}>No reviews yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {recent.map((r, i) => (
              <div key={r.id} style={{ padding: '14px 0', borderBottom: i < recent.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{r.author}</span>
                  <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)' }}>{r.relativeDate || r.date}</span>
                </div>
                <div style={{ marginBottom: 6 }}>
                  {[1,2,3,4,5].map(s => (
                    <span key={s} style={{ fontSize: 12, color: s <= r.rating ? '#1a1a1a' : 'rgba(0,0,0,0.12)' }}>★</span>
                  ))}
                </div>
                <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', lineHeight: 1.5, margin: 0 }}>{r.text}</p>
                {r.replied && r.replyText && (
                  <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: '2px solid rgba(0,0,0,0.1)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Owner replied</div>
                    <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', lineHeight: 1.5, margin: 0 }}>{r.replyText}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Staff tab ────────────────────────────────────────────────────────────
// Filters the chain-wide employee-hours report down to this location and
// shows tenure + recent weekly hours. Useful for the manager who wants to
// see who's on this store's roster and how busy they've been.

interface EmployeeRow {
  employeeId: number;
  fullName: string;
  primaryStore: string;
  weeklyHours: number[];
  totalHours: number;
  rollingAvg: number;
  last4WkAvg: number;
  last13WkAvg: number;
  dateStartedMs: number | null;
  weeksSinceHire: number | null;
}

function StaffTab({ locId }: { locId: string }) {
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch('/api/dripos/employee-hours', { cache: 'no-store' })
      .then(async r => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.message || j.error || 'Failed to load staff');
        const filtered = (j.report?.employees || []).filter(
          (e: EmployeeRow) => e.primaryStore.toUpperCase() === locId.toUpperCase()
        );
        setEmployees(filtered);
      })
      .catch(e => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [locId]);

  if (loading) return <SectionLoading label="Loading staff (this can take ~10s on first load)…" />;
  if (error) return <SectionError msg={error} />;
  if (!employees || employees.length === 0) return <SectionEmpty label="No staff records found for this location." />;

  // Sort by last 4-week avg, descending.
  const rows = [...employees].sort((a, b) => b.last4WkAvg - a.last4WkAvg);
  const totalLast4 = rows.reduce((acc, r) => acc + r.last4WkAvg, 0);
  const activeCount = rows.filter(r => r.last4WkAvg > 0).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <KPICard label="On Roster" value={rows.length.toString()} sub={`${activeCount} active last 4 wks`} />
        <KPICard label="Team Hours" value={`${totalLast4.toFixed(0)} h`} sub="weekly avg, last 4 wks" />
        <KPICard label="Avg per Employee" value={activeCount > 0 ? `${(totalLast4 / activeCount).toFixed(1)} h` : '—'} sub="weekly avg, active only" />
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.80)',
        border: '1px solid rgba(0,0,0,0.07)',
        backdropFilter: 'blur(20px)',
        borderRadius: 16,
        padding: '24px 28px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
        overflowX: 'auto',
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(0,0,0,0.35)', marginBottom: 16 }}>
          Roster · sorted by last 4-wk avg
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Tenure</th>
              <th style={thStyleRight}>Last 4 wk</th>
              <th style={thStyleRight}>Last 13 wk</th>
              <th style={thStyleRight}>52-wk total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.employeeId} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                <td style={tdStyle}>{r.fullName}</td>
                <td style={{ ...tdStyle, color: 'rgba(0,0,0,0.4)' }}>{fmtTenure(r.weeksSinceHire)}</td>
                <td style={tdStyleRight}>{r.last4WkAvg.toFixed(1)} h</td>
                <td style={tdStyleRight}>{r.last13WkAvg.toFixed(1)} h</td>
                <td style={tdStyleRight}>{r.totalHours.toFixed(0)} h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Shared section helpers ──────────────────────────────────────────────

function SectionLoading({ label }: { label: string }) {
  return (
    <div style={sectionEmptyStyle}>
      <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>{label}</div>
    </div>
  );
}
function SectionError({ msg }: { msg: string }) {
  return (
    <div style={{ ...sectionEmptyStyle, background: '#fef2f2', border: '1px solid #fecaca' }}>
      <div style={{ color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>Error loading: {msg}</div>
    </div>
  );
}
function SectionEmpty({ label }: { label: string }) {
  return (
    <div style={sectionEmptyStyle}>
      <div style={{ color: 'rgba(0,0,0,0.3)', fontSize: 13 }}>{label}</div>
    </div>
  );
}

const sectionEmptyStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.80)',
  border: '1px solid rgba(0,0,0,0.07)',
  borderRadius: 16,
  padding: '40px 24px',
  textAlign: 'center',
};

const thStyle: React.CSSProperties = {
  padding: '10px 8px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'rgba(0,0,0,0.4)',
};
const thStyleRight: React.CSSProperties = { ...thStyle, textAlign: 'right' };
const tdStyle: React.CSSProperties = { padding: '10px 8px', fontSize: 13 };
const tdStyleRight: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtTimeAgo(dateStr: string): string {
  // The fetched_at column is SQLite's CURRENT_TIMESTAMP, stored without a
  // timezone marker — it's UTC by sqlite default. Parse defensively so older
  // rows that may have been written with various formats still work.
  const ts = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr.replace(' ', 'T') + 'Z');
  const ms = Date.now() - ts.getTime();
  if (!Number.isFinite(ms) || ms < 0) return dateStr;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return ts.toLocaleDateString();
}

function fmtTenure(weeks: number | null): string {
  if (weeks === null || weeks <= 0) return '—';
  if (weeks < 52) return `${weeks}w`;
  const years = Math.floor(weeks / 52);
  const rem = weeks % 52;
  return rem > 0 ? `${years}y ${rem}w` : `${years}y`;
}

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  background: '#ffffff',
  marginLeft: -32,
  marginRight: -32,
  marginTop: -32,
};

