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
  // gut check for the hypothesis. Days that are >2.5σ outliers on either
  // metric (POS glitches, holiday spikes) are dropped so a single bad
  // day can't dominate the coefficient.
  const stats = useMemo(() => {
    const paired = series.filter((p) => p.avgTicketMin != null && p.salesCents > 0) as Array<DailyPoint & { avgTicketMin: number }>;
    if (paired.length < 3) return { r: null as number | null, n: paired.length, dropped: 0 };
    const tFlag = detectAnomalies(paired.map((p) => p.avgTicketMin));
    const sFlag = detectAnomalies(paired.map((p) => p.salesCents));
    const clean = paired.filter((_, i) => !tFlag[i] && !sFlag[i]);
    if (clean.length < 3) return { r: null as number | null, n: clean.length, dropped: paired.length - clean.length };
    const xs = clean.map((p) => p.avgTicketMin);
    const ys = clean.map((p) => p.salesCents);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const mx = mean(xs), my = mean(ys);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < clean.length; i++) {
      const a = xs[i] - mx, b = ys[i] - my;
      num += a * b; dx += a * a; dy += b * b;
    }
    const denom = Math.sqrt(dx * dy);
    return {
      r: denom > 0 ? num / denom : null,
      n: clean.length,
      dropped: paired.length - clean.length,
    };
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
            {stats.r != null && ` · Pearson r = ${stats.r.toFixed(2)} (n=${stats.n}${stats.dropped ? `, ${stats.dropped} anomalies dropped` : ''})`}
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

const ANOMALY_SIGMA = 2.5;

function detectAnomalies(values: Array<number | null | undefined>): boolean[] {
  // True at indices where the value is more than ANOMALY_SIGMA stddevs
  // from the mean. POS glitches and one-off slow days that drag the
  // y-axis hostage end up in here. We only flag positive outliers
  // (way slower / way higher) since those are the ones that distort
  // the chart most; the rare zero days are already filtered as nulls.
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < 5) return values.map(() => false);
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance =
    nums.reduce((a, v) => a + (v - mean) ** 2, 0) / nums.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return values.map(() => false);
  return values.map((v) => typeof v === 'number' && (v - mean) > ANOMALY_SIGMA * sd);
}

function DualSeriesChart({ series, isMobile }: { series: DailyPoint[]; isMobile: boolean }) {
  const [smooth, setSmooth] = useState(true);
  const [view, setView] = useState<'line' | 'bars'>('line');
  const [hideAnomalies, setHideAnomalies] = useState(true);

  // 7-day moving average smooths daily noise so the underlying trend is
  // visible — restaurant data is too lumpy day-to-day for raw lines to
  // reveal correlation. Toggleable.
  const smoothed = useMemo(() => {
    if (!smooth) return series.map((p) => ({
      ...p, smoothedTime: p.avgTicketMin, smoothedSales: p.salesCents,
    }));
    const W = 7;
    return series.map((_, i) => {
      const slice = series.slice(Math.max(0, i - W + 1), i + 1);
      const tVals = slice.map((s) => s.avgTicketMin).filter((v): v is number => v != null);
      const sVals = slice.map((s) => s.salesCents).filter((v) => v > 0);
      return {
        ...series[i],
        smoothedTime: tVals.length ? tVals.reduce((a, b) => a + b, 0) / tVals.length : null,
        smoothedSales: sVals.length ? sVals.reduce((a, b) => a + b, 0) / sVals.length : 0,
      };
    });
  }, [series, smooth]);

  // Anomaly detection runs on the smoothed series so 7-day spikes also
  // get caught when smoothing is on.
  const annotated = useMemo(() => {
    const timeAnomalies = detectAnomalies(smoothed.map((p) => p.smoothedTime));
    const salesAnomalies = detectAnomalies(smoothed.map((p) => p.smoothedSales));
    return smoothed.map((p, i) => ({
      ...p,
      timeAnomaly: timeAnomalies[i],
      salesAnomaly: salesAnomalies[i],
    }));
  }, [smoothed]);

  const anomalyCount = useMemo(
    () => annotated.filter((p) => p.timeAnomaly || p.salesAnomaly).length,
    [annotated],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <ToggleBtn active={view === 'line'} onClick={() => setView('line')}>Line</ToggleBtn>
        <ToggleBtn active={view === 'bars'} onClick={() => setView('bars')}>Bars</ToggleBtn>
        <ToggleBtn active={smooth} onClick={() => setSmooth((s) => !s)}>
          {smooth ? '✓ 7-day smoothing' : '7-day smoothing'}
        </ToggleBtn>
        <ToggleBtn active={hideAnomalies} onClick={() => setHideAnomalies((a) => !a)}>
          {hideAnomalies ? '✓ Hide anomalies' : 'Hide anomalies'}
        </ToggleBtn>
        {anomalyCount > 0 && (
          <span style={{ fontSize: 11, color: '#a04ea0', fontWeight: 600 }}>
            ⚠ {anomalyCount} day{anomalyCount === 1 ? '' : 's'} flagged ({'>'}{ANOMALY_SIGMA}σ from mean)
          </span>
        )}
      </div>
      {view === 'line' ? (
        <DualLineChart series={annotated} isMobile={isMobile} hideAnomalies={hideAnomalies} />
      ) : (
        <DualBarChart series={annotated} isMobile={isMobile} hideAnomalies={hideAnomalies} />
      )}
    </div>
  );
}

function ToggleBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
        border: active ? '1px solid #1a1a1a' : '1px solid rgba(0,0,0,0.15)',
        background: active ? '#1a1a1a' : '#fff',
        color: active ? '#fff' : 'rgba(0,0,0,0.65)',
        cursor: 'pointer',
      }}
    >{children}</button>
  );
}

interface SmoothedPoint extends DailyPoint {
  smoothedTime: number | null;
  smoothedSales: number;
  timeAnomaly: boolean;
  salesAnomaly: boolean;
}

function DualLineChart({ series, isMobile, hideAnomalies }: {
  series: SmoothedPoint[]; isMobile: boolean; hideAnomalies: boolean;
}) {
  // Dual y-axis line chart: left axis for ticket time (orange), right
  // axis for sales ($, blue). Same x. Visual correlation is immediate
  // — when one line moves, the other's response is right there.
  const W = 760;
  const H = 280;
  const PAD = { left: 50, right: 56, top: 18, bottom: 28 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const n = series.length;
  if (n < 2) return <div style={{ color: '#888', fontSize: 13 }}>Not enough data yet.</div>;

  // Y-axis is sized from NON-anomaly values when hideAnomalies is on, so
  // a single 4x spike doesn't crush the rest of the line into a flatline.
  const timeForScale = series
    .filter((p) => p.smoothedTime != null && (!hideAnomalies || !p.timeAnomaly))
    .map((p) => p.smoothedTime as number);
  const salesForScale = series
    .filter((p) => p.smoothedSales > 0 && (!hideAnomalies || !p.salesAnomaly))
    .map((p) => p.smoothedSales);
  const maxTime = Math.max(0.1, ...timeForScale);
  const maxSales = Math.max(1, ...salesForScale);
  const minSales = (salesForScale.length ? Math.min(...salesForScale) : 0) * 0.85;

  const x = (i: number) => PAD.left + (i / (n - 1)) * innerW;
  const yTime = (v: number) => PAD.top + innerH * (1 - v / (maxTime * 1.08));
  const yS = (v: number) => PAD.top + innerH * (1 - (v - minSales) / (maxSales * 1.05 - minSales));

  // Treat anomalies as nulls when hiding so the path breaks (or
  // interpolates over) them rather than stretching.
  const isTimeOk = (p: SmoothedPoint) =>
    p.smoothedTime != null && (!hideAnomalies || !p.timeAnomaly);
  const isSalesOk = (p: SmoothedPoint) =>
    p.smoothedSales > 0 && (!hideAnomalies || !p.salesAnomaly);

  const timePath = series
    .map((p, i) => !isTimeOk(p) ? null : `${i === 0 || !isTimeOk(series[i - 1]) ? 'M' : 'L'} ${x(i)} ${yTime(p.smoothedTime as number)}`)
    .filter(Boolean)
    .join(' ');
  const salesPath = series
    .map((p, i) => !isSalesOk(p) ? null : `${i === 0 || !isSalesOk(series[i - 1]) ? 'M' : 'L'} ${x(i)} ${yS(p.smoothedSales)}`)
    .filter(Boolean)
    .join(' ');

  const tickIdx = Array.from({ length: 6 }, (_, i) => Math.round((i * (n - 1)) / 5));

  return (
    <div style={{ overflowX: isMobile ? 'auto' : 'visible', minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, minWidth: 0 }}>
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
          const y = PAD.top + innerH * f;
          return <line key={i} x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="#eee" />;
        })}
        {/* Left axis labels (ticket time) */}
        {[0, 0.5, 1].map((f, i) => {
          const v = maxTime * 1.08 * (1 - f);
          const y = PAD.top + innerH * f;
          return (
            <text key={i} x={PAD.left - 6} y={y + 3} fontSize="10" fill="#c97a3f" textAnchor="end" fontWeight="600">
              {v.toFixed(1)}m
            </text>
          );
        })}
        {/* Right axis labels (sales) */}
        {[0, 0.5, 1].map((f, i) => {
          const v = (maxSales * 1.05 - minSales) * (1 - f) + minSales;
          const y = PAD.top + innerH * f;
          return (
            <text key={i} x={W - PAD.right + 6} y={y + 3} fontSize="10" fill="#2c5f8d" textAnchor="start" fontWeight="600">
              ${(v / 100 / 1000).toFixed(1)}k
            </text>
          );
        })}
        {/* X labels */}
        {tickIdx.map((i) => {
          if (i < 0 || i >= n) return null;
          return (
            <text key={i} x={x(i)} y={H - 6} fontSize="9" fill="#888" textAnchor="middle">
              {series[i].date.slice(5)}
            </text>
          );
        })}
        {/* Sales line (drawn first so ticket time sits on top) */}
        <path d={salesPath} fill="none" stroke="#2c5f8d" strokeWidth="2" strokeLinejoin="round" />
        {/* Ticket time line */}
        <path d={timePath} fill="none" stroke="#c97a3f" strokeWidth="2" strokeLinejoin="round" />
        {/* Anomaly markers — tiny dashed verticals at flagged x positions
            with a ⚠ glyph in the top margin. */}
        {hideAnomalies && series.map((p, i) => {
          if (!p.timeAnomaly && !p.salesAnomaly) return null;
          const xc = x(i);
          return (
            <g key={`a-${i}`}>
              <line x1={xc} x2={xc} y1={PAD.top} y2={PAD.top + innerH}
                    stroke="#c08a4a" strokeWidth="1" strokeDasharray="2 3" opacity="0.45" />
              <text x={xc} y={PAD.top - 2} fontSize="9" fill="#a04ea0" textAnchor="middle">⚠</text>
            </g>
          );
        })}
        {/* Legend */}
        <g transform={`translate(${PAD.left}, ${PAD.top - 6})`}>
          <line x1="0" x2="18" y1="0" y2="0" stroke="#c97a3f" strokeWidth="2" />
          <text x="22" y="3" fontSize="10" fill="#666" fontWeight="600">Ticket time</text>
          <line x1="92" x2="110" y1="0" y2="0" stroke="#2c5f8d" strokeWidth="2" />
          <text x="114" y="3" fontSize="10" fill="#666" fontWeight="600">Sales</text>
        </g>
      </svg>
    </div>
  );
}

function DualBarChart({ series, isMobile, hideAnomalies }: {
  series: SmoothedPoint[]; isMobile: boolean; hideAnomalies: boolean;
}) {
  const W = 760;
  const H_TIME = 110;
  const H_SALES = 110;
  const PAD = { left: 44, right: 12, top: 12, bottom: 22 };
  const innerW = W - PAD.left - PAD.right;
  const n = series.length;
  const bw = n > 0 ? innerW / n : innerW;

  // Y-axis sized from non-anomaly values so spikes don't crush the chart.
  const maxTime = Math.max(0.1, ...series
    .filter((p) => p.smoothedTime != null && (!hideAnomalies || !p.timeAnomaly))
    .map((p) => p.smoothedTime as number));
  const maxSales = Math.max(1, ...series
    .filter((p) => p.smoothedSales > 0 && (!hideAnomalies || !p.salesAnomaly))
    .map((p) => p.smoothedSales));

  const timeY = (v: number) => PAD.top + (H_TIME - PAD.top - PAD.bottom) * (1 - v / maxTime);
  const salesY = (v: number) => PAD.top + (H_SALES - PAD.top - PAD.bottom) * (1 - v / maxSales);

  const tickIdx = Array.from({ length: 6 }, (_, i) => Math.round((i * (n - 1)) / 5));

  const renderChart = (
    height: number,
    yFn: (v: number) => number,
    color: string,
    max: number,
    valueFn: (p: SmoothedPoint) => number | null,
    isAnomaly: (p: SmoothedPoint) => boolean,
    yLabel: (v: number) => string,
    title: string,
  ) => (
    <div style={{ overflowX: isMobile ? 'auto' : 'visible', minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height, minWidth: 0 }}>
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
          const anomaly = isAnomaly(p);
          if (hideAnomalies && anomaly) {
            // Render a small ⚠ marker at the top of the chart so the day
            // isn't invisible, just visually demoted.
            const xc = PAD.left + i * bw + bw / 2;
            return (
              <text key={p.date} x={xc} y={PAD.top + 8} fontSize="11"
                    fill="#a04ea0" textAnchor="middle">⚠</text>
            );
          }
          // If anomaly but not hiding, render it capped at max so it
          // doesn't blow out the scale even when shown.
          const drawV = Math.min(v, max);
          const xc = PAD.left + i * bw;
          const yc = yFn(drawV);
          return (
            <rect
              key={p.date}
              x={xc + 0.5}
              y={yc}
              width={Math.max(1, bw - 1)}
              height={Math.max(0, height - PAD.bottom - yc)}
              fill={anomaly ? '#a04ea0' : color}
              opacity={anomaly ? 0.6 : 0.85}
            />
          );
        })}
        {tickIdx.map((i) => {
          if (i < 0 || i >= n) return null;
          const p = series[i];
          const xc = PAD.left + i * bw + bw / 2;
          return (
            <text key={i} x={xc} y={height - 6} fontSize="9" fill="#888" textAnchor="middle">{p.date.slice(5)}</text>
          );
        })}
      </svg>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {renderChart(
        H_TIME, timeY, '#c97a3f', maxTime,
        (p) => p.smoothedTime,
        (p) => p.timeAnomaly,
        (v) => `${v.toFixed(1)}m`,
        'AVG TICKET TIME (min)',
      )}
      {renderChart(
        H_SALES, salesY, '#2c5f8d', maxSales,
        (p) => p.smoothedSales > 0 ? p.smoothedSales : null,
        (p) => p.salesAnomaly,
        (v) => `$${(v / 100 / 1000).toFixed(1)}k`,
        'DAILY SALES',
      )}
    </div>
  );
}
