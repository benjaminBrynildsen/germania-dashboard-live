import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useIsMobile } from '../hooks/useIsMobile';

interface Location {
  id: string;
  name: string;
  address: string;
  googleRating: number;
  reviewCount: number;
  googleMapsUrl?: string;
}

interface Review {
  id: number;
  author: string;
  rating: number;
  text: string;
  date: string;
  relativeDate: string;
  helpful: number;
  replied: boolean;
  replyText?: string;
}

interface ReviewData {
  location: Location;
  reviews: Review[];
  distribution: { stars: number; count: number }[];
  monthlyAvg: { month: string; avg: number; count: number }[];
}

type SortKey = 'newest' | 'oldest' | 'highest' | 'lowest';
type FilterKey = 'all' | '5' | '4' | '3' | '2' | '1';

export default function GoogleReviews() {
  const isMobile = useIsMobile();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('newest');
  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => {
    api.get(`/api/locations/${id}/reviews`).then(setData).finally(() => setLoading(false));
  }, [id]);

  if (loading || !data) {
    return (
      <div style={pageWrap}>
        <div style={{ color: 'rgba(0,0,0,0.3)', padding: 60, textAlign: 'center', fontSize: 14 }}>
          {loading ? 'Loading...' : 'Location not found'}
        </div>
      </div>
    );
  }

  const { location, reviews, distribution, monthlyAvg } = data;
  const totalReviews = distribution.reduce((s, d) => s + d.count, 0);
  const mapsUrl = location.googleMapsUrl;

  let filtered = filter === 'all' ? reviews : reviews.filter(r => r.rating === Number(filter));
  filtered = [...filtered].sort((a, b) => {
    if (sort === 'newest') return new Date(b.date).getTime() - new Date(a.date).getTime();
    if (sort === 'oldest') return new Date(a.date).getTime() - new Date(b.date).getTime();
    if (sort === 'highest') return b.rating - a.rating;
    return a.rating - b.rating;
  });

  return (
    <div style={pageWrap}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '48px 32px' }}>

        {/* Back */}
        <button
          onClick={() => navigate(`/locations/${id}`)}
          style={{ background: 'none', border: 'none', color: 'rgba(0,0,0,0.4)', fontSize: 13, cursor: 'pointer', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 6, padding: 0, fontWeight: 600, fontFamily: 'inherit' }}
        >
          ← {location.name}
        </button>

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: '#1a1a1a', padding: '3px 9px', borderRadius: 6, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {location.id}
            </span>
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: '#111', letterSpacing: -0.6 }}>Google Reviews</h1>
          <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>{location.name} — {location.address}</p>
        </div>

        {/* Top cards: rating summary + distribution + trend */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '220px 1fr 1fr', gap: 16, marginBottom: 28 }}>

          {/* Big rating */}
          <div style={card}>
            <div style={{ fontSize: 56, fontWeight: 800, color: '#111', letterSpacing: -2, lineHeight: 1 }}>{location.googleRating}</div>
            <div style={{ display: 'flex', gap: 2, margin: '10px 0 6px' }}>
              {[1,2,3,4,5].map(s => (
                <span key={s} style={{ fontSize: 18, color: s <= Math.round(location.googleRating) ? '#1a1a1a' : 'rgba(0,0,0,0.12)' }}>★</span>
              ))}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)', fontWeight: 500 }}>{totalReviews} reviews</div>
          </div>

          {/* Distribution bars */}
          <div style={card}>
            <div style={cardLabel}>Rating Distribution</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 4 }}>
              {[5,4,3,2,1].map(stars => {
                const d = distribution.find(x => x.stars === stars);
                const count = d?.count || 0;
                const pct = totalReviews > 0 ? (count / totalReviews) * 100 : 0;
                return (
                  <button
                    key={stars}
                    onClick={() => setFilter(filter === String(stars) ? 'all' : String(stars) as FilterKey)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1fr 36px',
                      alignItems: 'center',
                      gap: 8,
                      background: filter === String(stars) ? 'rgba(0,0,0,0.04)' : 'transparent',
                      border: 'none',
                      borderRadius: 6,
                      padding: '3px 6px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      transition: 'background 0.15s',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', textAlign: 'left' }}>{stars}★</span>
                    <div style={{ height: 8, background: 'rgba(0,0,0,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: '#1a1a1a', borderRadius: 4, transition: 'width 0.4s ease' }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.35)', textAlign: 'right' }}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Monthly trend */}
          <div style={card}>
            <div style={cardLabel}>Monthly Average</div>
            {(() => {
              const vals = monthlyAvg.map(m => m.avg);
              const min = Math.min(...vals);
              const max = Math.max(...vals);
              const range = max - min || 0.1;
              return (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 130, marginTop: 16 }}>
                  {monthlyAvg.map(m => {
                    const pct = (m.avg - min) / range;
                    const barH = 30 + pct * 60;
                    return (
                      <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.5)' }}>{m.avg.toFixed(1)}</span>
                        <div style={{
                          width: '100%',
                          maxWidth: 40,
                          height: barH,
                          background: m.avg >= max - 0.05 ? '#1a1a1a' : 'rgba(0,0,0,0.14)',
                          borderRadius: 6,
                          transition: 'all 0.3s',
                        }} />
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.3)', letterSpacing: '0.03em' }}>{m.month}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 10 : 0, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.4)' }}>
            {filter === 'all' ? `All reviews (${filtered.length})` : `${filter}-star reviews (${filtered.length})`}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['newest', 'oldest', 'highest', 'lowest'] as SortKey[]).map(s => (
              <button
                key={s}
                onClick={() => setSort(s)}
                style={{
                  background: sort === s ? '#1a1a1a' : 'rgba(0,0,0,0.05)',
                  color: sort === s ? '#fff' : 'rgba(0,0,0,0.45)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                  textTransform: 'capitalize',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Reviews list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(r => (
            <a
              key={r.id}
              href={mapsUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              onClick={e => { if (!mapsUrl) e.preventDefault(); }}
            >
            <div style={{
              ...card,
              padding: '22px 26px',
              cursor: mapsUrl ? 'pointer' : 'default',
              transition: 'all 0.2s ease',
            }}
              onMouseEnter={e => { if (mapsUrl) { e.currentTarget.style.background = 'rgba(255,255,255,0.95)'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)'; }}}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.80)'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.05)'; }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* Avatar circle */}
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'rgba(0,0,0,0.4)',
                  }}>
                    {r.author.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{r.author}</div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 1 }}>{r.relativeDate}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 1 }}>
                    {[1,2,3,4,5].map(s => (
                      <span key={s} style={{ fontSize: 13, color: s <= r.rating ? '#1a1a1a' : 'rgba(0,0,0,0.12)' }}>★</span>
                    ))}
                  </div>
                  {r.replied && (
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#166534',
                      background: 'rgba(22,101,52,0.08)',
                      padding: '2px 8px',
                      borderRadius: 10,
                      letterSpacing: '0.04em',
                    }}>
                      Replied
                    </span>
                  )}
                  {mapsUrl && (
                    <span style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: 'rgba(0,0,0,0.25)',
                      marginLeft: 4,
                    }}>
                      View on Google ↗
                    </span>
                  )}
                </div>
              </div>

              <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.55)', lineHeight: 1.7, margin: '12px 0 0 48px' }}>{r.text}</p>

              {r.replied && r.replyText && (
                <div style={{
                  margin: '14px 0 0 48px',
                  padding: '14px 18px',
                  background: 'rgba(0,0,0,0.025)',
                  borderRadius: 12,
                  borderLeft: '3px solid rgba(0,0,0,0.1)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.35)', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Owner Response</div>
                  <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', lineHeight: 1.6, margin: 0 }}>{r.replyText}</p>
                </div>
              )}

              <div style={{ margin: '12px 0 0 48px', display: 'flex', alignItems: 'center', gap: 12 }}>
                {!r.replied && mapsUrl && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: '#1a1a1a',
                      background: 'rgba(0,0,0,0.06)',
                      padding: '5px 14px',
                      borderRadius: 10,
                      letterSpacing: '0.02em',
                    }}
                  >
                    Reply on Google ↗
                  </span>
                )}
                {r.helpful > 0 && (
                  <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)', fontWeight: 500 }}>
                    {r.helpful} {r.helpful === 1 ? 'person' : 'people'} found this helpful
                  </span>
                )}
              </div>
            </div>
            </a>
          ))}

          {filtered.length === 0 && (
            <div style={{ ...card, padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.3)' }}>No {filter}-star reviews</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.80)',
  border: '1px solid rgba(0,0,0,0.07)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  borderRadius: 16,
  padding: '24px 28px',
  boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
};

const cardLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: 'rgba(0,0,0,0.35)',
};

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  background: 'linear-gradient(145deg, #f5f5f7 0%, #ebebef 50%, #f0f0f5 100%)',
  marginLeft: -32,
  marginRight: -32,
  marginTop: -32,
};
