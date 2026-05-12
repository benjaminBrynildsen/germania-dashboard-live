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

