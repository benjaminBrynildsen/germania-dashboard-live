import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useIsMobile } from '../hooks/useIsMobile';
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

            <TicketVsSalesCard locId={location.id.toUpperCase()} isMobile={isMobile} />
          </div>
        )}

        {/* Other tabs */}
        {tab !== 'Overview' && (
          <div style={{
            background: 'rgba(255,255,255,0.80)',
            border: '1px solid rgba(0,0,0,0.07)',
            borderRadius: 16,
            padding: '60px 24px',
            textAlign: 'center',
            boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>🔧</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'rgba(0,0,0,0.4)' }}>{tab} — Coming Soon</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.3)', marginTop: 6 }}>
              {tab === 'Sales' && 'Live sales data from Dripos once connected'}
              {tab === 'Reviews' && 'Full Google Reviews feed with sentiment analysis'}
              {tab === 'Staff' && 'Staff scheduling, performance, and attendance'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  background: 'linear-gradient(145deg, #f5f5f7 0%, #ebebef 50%, #f0f0f5 100%)',
  marginLeft: -32,
  marginRight: -32,
  marginTop: -32,
};

// ── Ticket time vs sales correlation chart ──────────────────────────────
interface DailyPoint {
  date: string;
  avgTicketMin: number | null;
  ticketCount: number;
  salesCents: number;
}

const RANGE_PRESETS: Array<{ label: string; days: number }> = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
];

function TicketVsSalesCard({ locId, isMobile }: { locId: string; isMobile: boolean }) {
  const [days, setDays] = useState(90);
  const [customMode, setCustomMode] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [series, setSeries] = useState<DailyPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/dripos/ticket-vs-sales/${locId}?days=${days}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.ok) {
          setError(j.message || j.error || 'Failed to load');
          return;
        }
        let s: DailyPoint[] = j.series ?? [];
        if (customMode && customStart && customEnd) {
          s = s.filter((p) => p.date >= customStart && p.date <= customEnd);
        }
        setSeries(s);
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [locId, days, customMode, customStart, customEnd]);

  // Pearson correlation between same-day ticket time and sales — quick
  // gut check for the hypothesis. Only counted days where both metrics exist.
  const stats = useMemo(() => {
    const paired = series.filter((p) => p.avgTicketMin != null && p.salesCents > 0) as Array<DailyPoint & { avgTicketMin: number }>;
    if (paired.length < 3) return { r: null as number | null, n: paired.length };
    const xs = paired.map((p) => p.avgTicketMin);
    const ys = paired.map((p) => p.salesCents);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const mx = mean(xs), my = mean(ys);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < paired.length; i++) {
      const a = xs[i] - mx, b = ys[i] - my;
      num += a * b; dx += a * a; dy += b * b;
    }
    const denom = Math.sqrt(dx * dy);
    return { r: denom > 0 ? num / denom : null, n: paired.length };
  }, [series]);

  return (
    <div style={{
      background: 'rgba(255,255,255,0.85)',
      border: '1px solid rgba(0,0,0,0.07)',
      borderRadius: 16,
      padding: isMobile ? 16 : 24,
      marginTop: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        flexWrap: 'wrap', gap: 12, marginBottom: 14,
      }}>
        <div>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
            Ticket time vs daily sales
          </h3>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
            Hypothesis check: do slower days hurt same-day or next-week sales?
            {stats.r != null && ` · Pearson r = ${stats.r.toFixed(2)} (n=${stats.n})`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {RANGE_PRESETS.map((p) => {
            const active = !customMode && days === p.days;
            return (
              <button
                key={p.label}
                onClick={() => { setCustomMode(false); setDays(p.days); }}
                style={{
                  padding: '5px 12px', borderRadius: 999,
                  border: active ? '1px solid #1a1a1a' : '1px solid rgba(0,0,0,0.12)',
                  background: active ? '#1a1a1a' : '#fff',
                  color: active ? '#fff' : 'rgba(0,0,0,0.65)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >{p.label}</button>
            );
          })}
          <button
            onClick={() => { setCustomMode(true); setDays(365); }}
            style={{
              padding: '5px 12px', borderRadius: 999,
              border: customMode ? '1px solid #1a1a1a' : '1px solid rgba(0,0,0,0.12)',
              background: customMode ? '#1a1a1a' : '#fff',
              color: customMode ? '#fff' : 'rgba(0,0,0,0.65)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >Custom</button>
        </div>
      </div>

      {customMode && (
        <div style={{
          display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap',
          alignItems: 'center', fontSize: 13,
        }}>
          <label>From <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ marginLeft: 4 }} /></label>
          <label>To <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ marginLeft: 4 }} /></label>
        </div>
      )}

      {loading && <div style={{ color: 'rgba(0,0,0,0.4)', padding: '24px 0', fontSize: 13 }}>Loading… (first load over a long range can take 20-40s while we hydrate the cache)</div>}
      {error && <div style={{ color: '#c0392b', padding: '12px 0', fontSize: 13 }}>{error}</div>}
      {!loading && !error && series.length > 0 && (
        <DualSeriesChart series={series} isMobile={isMobile} />
      )}
    </div>
  );
}

function DualSeriesChart({ series, isMobile }: { series: DailyPoint[]; isMobile: boolean }) {
  // Two stacked bar charts sharing an x-axis. Top: avg ticket time
  // (minutes), bottom: daily sales ($). Same date order so visual
  // correlation is easy to spot.
  const W = 760;
  const H_TIME = 110;
  const H_SALES = 110;
  const PAD = { left: 44, right: 12, top: 12, bottom: 22 };
  const innerW = W - PAD.left - PAD.right;
  const n = series.length;
  const bw = n > 0 ? innerW / n : innerW;

  const maxTime = Math.max(0.1, ...series.map((p) => p.avgTicketMin ?? 0));
  const maxSales = Math.max(1, ...series.map((p) => p.salesCents));

  const timeY = (v: number) => PAD.top + (H_TIME - PAD.top - PAD.bottom) * (1 - v / maxTime);
  const salesY = (v: number) => PAD.top + (H_SALES - PAD.top - PAD.bottom) * (1 - v / maxSales);

  // Tick labels — show 6 evenly spaced dates so x-axis doesn't drown.
  const tickIdx = Array.from({ length: 6 }, (_, i) => Math.round((i * (n - 1)) / 5));

  const renderChart = (
    height: number,
    yFn: (v: number) => number,
    color: string,
    max: number,
    valueFn: (p: DailyPoint) => number | null,
    yLabel: (v: number) => string,
    title: string,
  ) => (
    <div style={{ overflowX: isMobile ? 'auto' : 'visible' }}>
      <svg viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height, minWidth: isMobile ? 600 : 0 }}>
        <text x={PAD.left} y={10} fontSize="10" fill="#888" fontWeight="700">{title}</text>
        {[0, 0.5, 1].map((f, i) => {
          const v = max * (1 - f);
          const y = PAD.top + (height - PAD.top - PAD.bottom) * f;
          return (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="#eee" />
              <text x={PAD.left - 4} y={y + 3} fontSize="9" fill="#aaa" textAnchor="end">{yLabel(v)}</text>
            </g>
          );
        })}
        {series.map((p, i) => {
          const v = valueFn(p);
          if (v == null) return null;
          const x = PAD.left + i * bw;
          const y = yFn(v);
          return (
            <rect
              key={p.date}
              x={x + 0.5}
              y={y}
              width={Math.max(1, bw - 1)}
              height={Math.max(0, height - PAD.bottom - y)}
              fill={color}
              opacity={0.85}
            />
          );
        })}
        {tickIdx.map((i) => {
          if (i < 0 || i >= n) return null;
          const p = series[i];
          const x = PAD.left + i * bw + bw / 2;
          const label = p.date.slice(5); // MM-DD
          return (
            <text key={i} x={x} y={height - 6} fontSize="9" fill="#888" textAnchor="middle">{label}</text>
          );
        })}
      </svg>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {renderChart(
        H_TIME, timeY, '#c97a3f', maxTime,
        (p) => p.avgTicketMin,
        (v) => `${v.toFixed(1)}m`,
        'AVG TICKET TIME (min)',
      )}
      {renderChart(
        H_SALES, salesY, '#2c5f8d', maxSales,
        (p) => p.salesCents > 0 ? p.salesCents : null,
        (v) => `$${(v / 100 / 1000).toFixed(1)}k`,
        'DAILY SALES',
      )}
    </div>
  );
}
