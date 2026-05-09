import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useIsMobile } from '../hooks/useIsMobile';

// Ticket time data
const TICKET_HOURS = ['6AM','7AM','8AM','9AM','10AM','11AM','12PM','1PM','2PM','3PM','4PM','5PM'];
const TICKET_WEEK13: Record<string, Record<string, (number|null)[]>> = {
  g1: { '6AM':[5,1,5,3,5,null,null],'7AM':[3,3,6,6,3,4,3],'8AM':[5,4,4,4,4,3,4],'9AM':[4,4,9,3,4,5,3],'10AM':[6,5,5,4,5,3,3],'11AM':[4,4,5,5,7,3,6],'12PM':[3,4,3,2,3,4,3],'1PM':[2,6,3,6,3,2,3],'2PM':[4,4,3,5,3,3,3],'3PM':[2,4,3,4,4,4,3],'4PM':[3,6,4,4,3,4,6],'5PM':[null,null,null,null,null,6,null] },
  g2: { '6AM':[8,7,5,5,4,null,null],'7AM':[5,3,5,6,7,6,3],'8AM':[3,7,7,8,5,7,4],'9AM':[4,5,9,6,5,7,4],'10AM':[8,5,5,4,7,7,4],'11AM':[4,5,5,6,5,8,3],'12PM':[3,7,7,5,4,3,4],'1PM':[4,5,6,5,5,4,3],'2PM':[3,5,4,3,4,3,7],'3PM':[10,5,4,3,5,4,6],'4PM':[0,4,6,2,6,7,11],'5PM':[33,4,10,4,6,8,8] },
  g3: { '6AM':[5,2,3,3,3,6,null],'7AM':[5,3,3,3,5,4,4],'8AM':[3,3,3,3,3,4,5],'9AM':[5,5,3,4,4,4,5],'10AM':[3,2,112,2,4,4,4],'11AM':[3,2,15,2,3,5,7],'12PM':[3,2,17,4,3,5,5],'1PM':[3,3,8,4,2,5,3],'2PM':[3,2,3,4,4,3,3],'3PM':[4,3,3,4,3,3,3],'4PM':[3,3,3,3,4,4,3],'5PM':[3,3,22,2,2,4,3] },
  g4: { '6AM':[3,4,2,123,3,null,null],'7AM':[5,3,3,4,5,4,3],'8AM':[4,6,7,6,6,3,3],'9AM':[4,5,4,4,6,3,6],'10AM':[4,3,11,5,3,4,4],'11AM':[3,3,28,3,5,4,5],'12PM':[5,3,8,4,3,3,3],'1PM':[3,3,7,4,4,3,4],'2PM':[3,21,37,3,3,5,3],'3PM':[3,5,11,4,3,8,6],'4PM':[4,6,5,4,5,4,6],'5PM':[5,19,6,2,3,4,6] },
};
function getAvgTicket(locId: string): number | null {
  const data = TICKET_WEEK13[locId.toLowerCase()];
  if (!data) return null;
  const vals: number[] = [];
  TICKET_HOURS.forEach(h => (data[h] || []).forEach(v => { if (v !== null && v <= 20) vals.push(v); }));
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

function Stars({ rating }: { rating: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      {[1,2,3,4,5].map(i => (
        <span key={i} style={{ fontSize: 14, color: i <= Math.round(rating) ? '#1a1a1a' : 'rgba(0,0,0,0.15)' }}>★</span>
      ))}
      <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginLeft: 4, fontWeight: 600 }}>{rating}</span>
    </div>
  );
}

function ChangeBadge({ change }: { change: number }) {
  const up = change >= 0;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      fontSize: 12,
      fontWeight: 700,
      color: up ? '#166534' : '#991b1b',
      background: up ? 'rgba(22,101,52,0.08)' : 'rgba(153,27,27,0.08)',
      padding: '3px 10px',
      borderRadius: 20,
      letterSpacing: '0.02em',
    }}>
      {up ? '↑' : '↓'} {Math.abs(change)}%
    </span>
  );
}

export default function Locations() {
  const isMobile = useIsMobile();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/api/locations').then(setLocations).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={pageWrap}>
        <div style={{ color: 'rgba(0,0,0,0.3)', padding: 60, textAlign: 'center', fontSize: 14 }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: isMobile ? '20px 12px' : '48px 32px' }}>

        {/* Header */}
        <div style={{ marginBottom: 44 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>
            Germania Brew Haus
          </p>
          <h1 style={{ fontSize: 34, fontWeight: 800, color: '#111', letterSpacing: -0.8, lineHeight: 1.1 }}>
            Location Overview
          </h1>
          <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 8 }}>
            Performance across all four stores
          </p>
        </div>

        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(480px, 1fr))', gap: 20 }}>
          {locations.map(loc => (
            <LocationCard key={loc.id} loc={loc} isMobile={isMobile} onClick={() => navigate(`/locations/${loc.id}`)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LocationCard({ loc, isMobile, onClick }: { loc: any; isMobile: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered
          ? 'rgba(255,255,255,0.95)'
          : 'rgba(255,255,255,0.75)',
        border: `1px solid ${hovered ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.07)'}`,
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRadius: 20,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: hovered
          ? '0 12px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)'
          : '0 4px 20px rgba(0,0,0,0.05), 0 1px 4px rgba(0,0,0,0.04)',
        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
      }}
    >
      {/* Hero photo from Google Maps (server proxies Places photo bytes). */}
      <PhotoHero locId={loc.id} />

      <div style={{ padding: '20px 30px 24px' }}>
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.14em',
              color: '#fff',
              background: '#1a1a1a',
              padding: '3px 9px',
              borderRadius: 6,
              textTransform: 'uppercase',
            }}>
              {loc.id}
            </span>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: loc.status === 'open' ? '#166534' : 'rgba(0,0,0,0.35)',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: loc.status === 'open' ? '#16a34a' : 'rgba(0,0,0,0.25)',
                display: 'inline-block',
              }} />
              {loc.status === 'open' ? 'Open' : 'Closed'}
            </span>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111', letterSpacing: -0.4 }}>{loc.name}</h2>
          <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>{loc.address}</p>
        </div>
        <ChangeBadge change={loc.revenueChange} />
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '0 0 20px' }} />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(0,0,0,0.35)', marginBottom: 6 }}>Weekly Sales</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#111', letterSpacing: -0.5 }}>${(loc.weeklyRevenue / 1000).toFixed(1)}k</div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(0,0,0,0.35)', marginBottom: 6 }}>Google Rating</div>
          <Stars rating={loc.googleRating} />
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 3 }}>{loc.reviewCount} reviews</div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(0,0,0,0.35)', marginBottom: 6 }}>Ticket Time</div>
          {(() => {
            const avg = getAvgTicket(loc.id);
            const color = avg === null ? 'rgba(0,0,0,0.18)' : avg <= 4 ? '#15803d' : avg <= 7 ? '#a16207' : '#dc2626';
            return (
              <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: -0.5 }}>
                {avg !== null ? `${avg.toFixed(1)}m` : '—'}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.3)', letterSpacing: '0.02em' }}>
          View Details →
        </span>
      </div>
      </div>
    </div>
  );
}

function PhotoHero({ locId }: { locId: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) return null;
  return (
    <div style={{
      width: '100%',
      height: 160,
      background: '#e9e9ec',
      borderBottom: '1px solid rgba(0,0,0,0.06)',
      overflow: 'hidden',
    }}>
      <img
        src={`/api/locations/${locId}/photo`}
        alt=""
        loading="lazy"
        onError={() => setErrored(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
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
