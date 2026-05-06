import { useState, useEffect, useMemo } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

interface Anomaly {
  id: number;
  date: string;
  location_id: number;
  location_name: string;
  actual: number;
  expected: number;
  deviation_pct: number;
  tags: string[];
  snowfall?: number;
  temp_min?: number;
}

interface Summary {
  total_anomalies: number;
  biggest_spike: number;
  biggest_drop: number;
}

const LOCATIONS = [
  { id: 131, name: 'G1 - Alton' },
  { id: 132, name: 'G2 - Godfrey' },
  { id: 133, name: 'G3 - East Gate' },
  { id: 134, name: 'G4 - Jerseyville' },
];

const TAG_STYLES: Record<string, { bg: string; color: string; emoji: string }> = {
  snow: { bg: '#e0f2fe', color: '#0369a1', emoji: '🌨️' },
  school: { bg: '#fef9c3', color: '#a16207', emoji: '🏫' },
  holiday: { bg: '#fce7f3', color: '#be185d', emoji: '🎄' },
  weather: { bg: '#dbeafe', color: '#1e40af', emoji: '🌡️' },
  unknown: { bg: '#f3f4f6', color: '#6b7280', emoji: '❓' },
};

export default function SalesAnomaly() {
  const isMobile = useIsMobile();
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [startDate, setStartDate] = useState('2025-01-01');
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedLocation, setSelectedLocation] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<'deviation' | 'date'>('deviation');

  useEffect(() => {
    fetchData();
  }, [startDate, endDate, selectedLocation]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (selectedLocation) params.append('locationId', selectedLocation.toString());

      const [anomaliesRes, summaryRes] = await Promise.all([
        fetch(`/api/anomalies?${params}`),
        fetch(`/api/anomalies/summary?${params}`),
      ]);

      const anomaliesData = await anomaliesRes.json();
      const summaryData = await summaryRes.json();

      setAnomalies(anomaliesData);
      setSummary(summaryData);
    } catch (error) {
      console.error('Error fetching anomaly data:', error);
    } finally {
      setLoading(false);
    }
  };

  const sortedAnomalies = useMemo(() => {
    const sorted = [...anomalies];
    if (sortBy === 'deviation') {
      sorted.sort((a, b) => Math.abs(b.deviation_pct) - Math.abs(a.deviation_pct));
    } else {
      sorted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    return sorted;
  }, [anomalies, sortBy]);

  const formatCurrency = (val: number) => `$${val.toFixed(0)}`;
  const formatPercent = (val: number) => `${val > 0 ? '+' : ''}${val.toFixed(1)}%`;

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.3)' }}>Loading anomaly data...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Sales Anomalies</h1>
        <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
          Track unusual sales patterns and their causes
        </p>
      </div>

      {/* Filters */}
      <div style={{
        background: '#fff',
        borderRadius: 14,
        border: '1px solid rgba(0,0,0,0.08)',
        padding: '20px 24px',
        marginBottom: 20,
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 6 }}>
            Start Date
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid rgba(0,0,0,0.12)',
              fontSize: 14,
            }}
          />
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 6 }}>
            End Date
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid rgba(0,0,0,0.12)',
              fontSize: 14,
            }}
          />
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.5)', marginBottom: 6 }}>
            Location
          </label>
          <select
            value={selectedLocation || ''}
            onChange={(e) => setSelectedLocation(e.target.value ? Number(e.target.value) : null)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid rgba(0,0,0,0.12)',
              fontSize: 14,
              background: '#fff',
            }}
          >
            <option value="">All Locations</option>
            {LOCATIONS.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
          <div style={{
            background: '#fff',
            borderRadius: 14,
            border: '1px solid rgba(0,0,0,0.08)',
            padding: '20px 24px',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Total Anomalies
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#1a1a1a' }}>
              {summary.total_anomalies}
            </div>
          </div>

          <div style={{
            background: '#fff',
            borderRadius: 14,
            border: '1px solid rgba(0,0,0,0.08)',
            padding: '20px 24px',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Biggest Spike
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#15803d' }}>
              {formatPercent(summary.biggest_spike || 0)}
            </div>
          </div>

          <div style={{
            background: '#fff',
            borderRadius: 14,
            border: '1px solid rgba(0,0,0,0.08)',
            padding: '20px 24px',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.4)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Biggest Drop
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#dc2626' }}>
              {formatPercent(summary.biggest_drop || 0)}
            </div>
          </div>
        </div>
      )}

      {/* Anomalies Table */}
      <div style={{
        background: '#fff',
        borderRadius: 14,
        border: '1px solid rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Detected Anomalies</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setSortBy('deviation')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                border: '1px solid rgba(0,0,0,0.12)',
                background: sortBy === 'deviation' ? '#1a1a1a' : '#fff',
                color: sortBy === 'deviation' ? '#fff' : '#1a1a1a',
                cursor: 'pointer',
              }}
            >
              By Deviation
            </button>
            <button
              onClick={() => setSortBy('date')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                border: '1px solid rgba(0,0,0,0.12)',
                background: sortBy === 'date' ? '#1a1a1a' : '#fff',
                color: sortBy === 'date' ? '#fff' : '#1a1a1a',
                cursor: 'pointer',
              }}
            >
              By Date
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)', background: 'rgba(0,0,0,0.02)' }}>
                <th style={{ textAlign: 'left', padding: '12px 24px', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Date</th>
                <th style={{ textAlign: 'left', padding: '12px 24px', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Location</th>
                <th style={{ textAlign: 'right', padding: '12px 24px', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Actual</th>
                <th style={{ textAlign: 'right', padding: '12px 24px', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Avg Day</th>
                <th style={{ textAlign: 'right', padding: '12px 24px', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Deviation</th>
                <th style={{ textAlign: 'left', padding: '12px 24px', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Tags</th>
              </tr>
            </thead>
            <tbody>
              {sortedAnomalies.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.3)' }}>
                    No anomalies detected in this date range
                  </td>
                </tr>
              ) : (
                sortedAnomalies.map((anomaly) => (
                  <tr key={anomaly.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <td style={{ padding: '14px 24px', fontSize: 14, fontWeight: 500 }}>
                      {new Date(anomaly.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '14px 24px', fontSize: 14, color: 'rgba(0,0,0,0.6)' }}>
                      {anomaly.location_name}
                    </td>
                    <td style={{ padding: '14px 24px', fontSize: 14, fontWeight: 600, textAlign: 'right' }}>
                      {formatCurrency(anomaly.actual)}
                    </td>
                    <td style={{ padding: '14px 24px', fontSize: 14, color: 'rgba(0,0,0,0.5)', textAlign: 'right' }}>
                      {formatCurrency(anomaly.expected)}
                    </td>
                    <td style={{
                      padding: '14px 24px',
                      fontSize: 14,
                      fontWeight: 700,
                      textAlign: 'right',
                      color: anomaly.deviation_pct > 0 ? '#15803d' : '#dc2626',
                    }}>
                      {anomaly.deviation_pct > 0 ? '↑' : '↓'} {formatPercent(anomaly.deviation_pct)}
                    </td>
                    <td style={{ padding: '14px 24px' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {anomaly.tags.map(tag => {
                          const style = TAG_STYLES[tag] || TAG_STYLES.unknown;
                          return (
                            <span
                              key={tag}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '4px 10px',
                                borderRadius: 6,
                                fontSize: 12,
                                fontWeight: 600,
                                background: style.bg,
                                color: style.color,
                              }}
                            >
                              {style.emoji} {tag}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pattern Insights */}
      <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? 220 : 300}px, 1fr))`, gap: 14 }}>
        <div style={{
          background: '#fff',
          borderRadius: 14,
          border: '1px solid rgba(0,0,0,0.08)',
          padding: '20px 24px',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>💡 Weather Impact</div>
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)', lineHeight: 1.6 }}>
            Snow and extreme cold significantly impact sales. Days with 4+ inches of snow show 60-80% sales drops.
          </div>
        </div>

        <div style={{
          background: '#fff',
          borderRadius: 14,
          border: '1px solid rgba(0,0,0,0.08)',
          padding: '20px 24px',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>📈 Holiday Boost</div>
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)', lineHeight: 1.6 }}>
            Major holidays (Memorial Day, July 4th) drive 50-70% sales increases across all locations.
          </div>
        </div>

        <div style={{
          background: '#fff',
          borderRadius: 14,
          border: '1px solid rgba(0,0,0,0.08)',
          padding: '20px 24px',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>🏫 School Closures</div>
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)', lineHeight: 1.6 }}>
            School closures correlate with lower sales, especially when combined with poor weather.
          </div>
        </div>
      </div>
    </div>
  );
}
