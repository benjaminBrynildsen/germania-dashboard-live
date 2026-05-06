import { useState, useEffect, useMemo } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

interface ClosureDecision {
  id: number;
  date: string;
  decision: string;
  score: number;
  road_conditions: number;
  temperature: number;
  school_closures: number;
  wind_speed: number;
  ice_severity: number;
  weather_duration: number;
  emergency_services: number;
  notes?: string;
  decided_by?: string;
  created_at: string;
}

interface ForecastData {
  date: string;
  raw: {
    tempMinF: number | null;
    tempMaxF: number | null;
    snowInches: number;
    windMph: number;
    precipMm: number;
    lastSnowHour: number;
  };
  suggested: {
    road_conditions: number;
    temperature: number;
    wind_speed: number;
    ice_severity: number;
    weather_duration: number;
    school_closures: number;
    emergency_services: number;
  };
  summary: string;
}

const DECISION_MAP: Record<string, { label: string; color: string; emoji: string }> = {
  open: { label: 'Stay Open ✅', color: '#15803d', emoji: '✅' },
  delay: { label: 'Delay Opening ⚠️', color: '#a16207', emoji: '⚠️' },
  close: { label: 'Close ❌', color: '#dc2626', emoji: '❌' },
  early_close: { label: 'Early Close 🕐', color: '#c2410c', emoji: '🕐' },
};

export default function WeatherClosure() {
  const isMobile = useIsMobile();
  const [decisions, setDecisions] = useState<ClosureDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecast, setForecast] = useState<ForecastData | null>(null);

  // Calculator form state
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [roadConditions, setRoadConditions] = useState(0);
  const [temperature, setTemperature] = useState(0);
  const [schoolClosures, setSchoolClosures] = useState(0);
  const [windSpeed, setWindSpeed] = useState(0);
  const [iceSeverity, setIceSeverity] = useState(0);
  const [weatherDuration, setWeatherDuration] = useState(0);
  const [emergencyServices, setEmergencyServices] = useState(0);
  const [notes, setNotes] = useState('');

  useEffect(() => { fetchDecisions(); }, []);

  const fetchDecisions = async () => {
    try {
      const res = await fetch('/api/closures');
      const data = await res.json();
      setDecisions(data);
    } catch (error) {
      console.error('Error fetching closure decisions:', error);
    } finally {
      setLoading(false);
    }
  };

  const pullForecast = async (targetDate?: string) => {
    const d = targetDate || date;
    setForecastLoading(true);
    setForecast(null);
    try {
      const res = await fetch(`/api/forecast/${d}`);
      if (!res.ok) throw new Error('Failed to fetch forecast');
      const data: ForecastData = await res.json();
      setForecast(data);
      // Auto-fill the form
      setRoadConditions(data.suggested.road_conditions);
      setTemperature(data.suggested.temperature);
      setWindSpeed(data.suggested.wind_speed);
      setIceSeverity(data.suggested.ice_severity);
      setWeatherDuration(data.suggested.weather_duration);
      // Don't override manual inputs
      // setSchoolClosures(data.suggested.school_closures);
      // setEmergencyServices(data.suggested.emergency_services);
    } catch (error) {
      console.error('Error fetching forecast:', error);
      alert('Could not fetch forecast data for this date');
    } finally {
      setForecastLoading(false);
    }
  };

  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    setForecast(null);
  };

  // Quick date buttons
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const dayAfter = new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0];

  const totalScore = useMemo(() => {
    return roadConditions + temperature + schoolClosures + windSpeed + iceSeverity + weatherDuration + emergencyServices;
  }, [roadConditions, temperature, schoolClosures, windSpeed, iceSeverity, weatherDuration, emergencyServices]);

  const recommendedDecision = useMemo(() => {
    if (totalScore <= 5) return 'open';
    if (totalScore <= 9) return 'delay';
    return 'close';
  }, [totalScore]);

  const getScoreColor = (score: number) => {
    if (score <= 5) return '#15803d';
    if (score <= 9) return '#a16207';
    return '#dc2626';
  };

  const getScoreBackground = (score: number) => {
    if (score <= 5) return '#dcfce7';
    if (score <= 9) return '#fef9c3';
    return '#fee2e2';
  };

  const handleLogDecision = async () => {
    if (!date) { alert('Please select a date'); return; }
    try {
      const res = await fetch('/api/closures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date, decision: recommendedDecision,
          road_conditions: roadConditions, temperature, school_closures: schoolClosures,
          wind_speed: windSpeed, ice_severity: iceSeverity,
          weather_duration: weatherDuration, emergency_services: emergencyServices, notes,
        }),
      });
      if (res.ok) {
        alert('✅ Decision logged successfully!');
        resetForm();
        fetchDecisions();
      } else { alert('Error logging decision'); }
    } catch (error) { alert('Error logging decision'); }
  };

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setRoadConditions(0); setTemperature(0); setSchoolClosures(0);
    setWindSpeed(0); setIceSeverity(0); setWeatherDuration(0);
    setEmergencyServices(0); setNotes(''); setForecast(null);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Weather Closure Calculator</h1>
        <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
          Point-based decision system for weather closures
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 24 }}>
        {/* Calculator Card */}
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(0,0,0,0.08)', padding: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Calculate Score</h2>

          {/* Date + Quick Buttons */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Date</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              {[
                { label: 'Today', value: today },
                { label: 'Tomorrow', value: tomorrow },
                { label: new Date(dayAfter).toLocaleDateString('en-US', { weekday: 'short' }), value: dayAfter },
              ].map(btn => (
                <button key={btn.value} onClick={() => { handleDateChange(btn.value); }}
                  style={{
                    padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: 'none',
                    background: date === btn.value ? '#1a1a1a' : 'rgba(0,0,0,0.06)',
                    color: date === btn.value ? '#fff' : 'rgba(0,0,0,0.5)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                  {btn.label}
                </button>
              ))}
            </div>
            <input type="date" value={date} onChange={(e) => handleDateChange(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.12)', fontSize: 14 }}
            />
          </div>

          {/* Pull Forecast Button */}
          <button onClick={() => pullForecast()} disabled={forecastLoading}
            style={{
              width: '100%', padding: '12px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600,
              border: '2px solid #3b82f6', background: forecastLoading ? '#eff6ff' : '#fff',
              color: '#3b82f6', cursor: forecastLoading ? 'wait' : 'pointer', marginBottom: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            {forecastLoading ? '⏳ Fetching...' : '🌤️ Pull Forecast Data'}
          </button>

          {/* Forecast Summary Card */}
          {forecast && (
            <div style={{
              padding: '14px 18px', borderRadius: 10, marginBottom: 16,
              background: '#eff6ff', border: '1px solid #bfdbfe',
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Forecast for {new Date(forecast.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12, fontSize: 13 }}>
                <div>
                  <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 11 }}>Temp</div>
                  <div style={{ fontWeight: 700 }}>{forecast.raw.tempMinF}°F – {forecast.raw.tempMaxF}°F</div>
                </div>
                <div>
                  <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 11 }}>Snow</div>
                  <div style={{ fontWeight: 700 }}>{forecast.raw.snowInches}"</div>
                </div>
                <div>
                  <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 11 }}>Wind</div>
                  <div style={{ fontWeight: 700 }}>{forecast.raw.windMph} mph</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 8 }}>
                ✅ Form auto-filled from forecast • Adjust school closures & advisories manually
              </div>
            </div>
          )}

          {/* Factor Inputs */}
          <FactorInput label="Road Conditions" value={roadConditions} onChange={setRoadConditions}
            options={[
              { value: 0, label: 'Clear (0)' }, { value: 1, label: 'Light snow (1)' },
              { value: 2, label: 'Moderate 2-4" (2)' }, { value: 3, label: 'Heavy 4-8" (3)' },
              { value: 4, label: 'Severe ice/closures (4)' },
            ]} />
          <FactorInput label="Temperature" value={temperature} onChange={setTemperature}
            options={[
              { value: 0, label: 'Above 32°F (0)' }, { value: 3, label: '20-32°F — highest ice risk (3)' },
              { value: 2, label: '0-20°F (2)' },
            ]} />
          <FactorInput label="School Closures" value={schoolClosures} onChange={setSchoolClosures}
            highlight={!forecast}
            options={[
              { value: 0, label: 'Open (0)' }, { value: 1, label: 'Some delayed (1)' },
              { value: 2, label: 'Most closed (2)' }, { value: 3, label: 'All closed + govt (3)' },
            ]} />
          <FactorInput label="Wind Speed" value={windSpeed} onChange={setWindSpeed}
            options={[
              { value: 0, label: 'Under 20mph (0)' }, { value: 1, label: '20-30mph (1)' },
            ]} />
          <FactorInput label="Ice Severity" value={iceSeverity} onChange={setIceSeverity}
            options={[
              { value: 0, label: 'No ice (0)' }, { value: 2, label: 'Light ice (2)' },
              { value: 4, label: 'Heavy ice (4)' },
            ]} />
          <FactorInput label="Weather Duration" value={weatherDuration} onChange={setWeatherDuration}
            options={[
              { value: 0, label: 'No snow (0)' }, { value: 1, label: 'Ends before 7AM (1)' },
              { value: 2, label: 'Ends 7AM-noon (2)' }, { value: 3, label: 'Past noon (3)' },
              { value: 4, label: 'All day + evening (4)' },
            ]} />
          <FactorInput label="Emergency Services" value={emergencyServices} onChange={setEmergencyServices}
            highlight={!forecast}
            options={[
              { value: 0, label: 'No advisories (0)' }, { value: 1, label: 'Advisory issued (1)' },
            ]} />

          {/* Notes */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional context..."
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.12)', fontSize: 14, minHeight: 80, fontFamily: 'inherit',
              }} />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleLogDecision}
              style={{
                flex: 1, padding: '12px 24px', borderRadius: 10, fontSize: 15, fontWeight: 600,
                border: 'none', background: '#1a1a1a', color: '#fff', cursor: 'pointer',
              }}>
              📝 Log Decision
            </button>
            <button onClick={resetForm}
              style={{
                padding: '12px 18px', borderRadius: 10, fontSize: 14, fontWeight: 600,
                border: '1px solid rgba(0,0,0,0.12)', background: '#fff', color: 'rgba(0,0,0,0.5)', cursor: 'pointer',
              }}>
              Reset
            </button>
          </div>
        </div>

        {/* Score Display Card */}
        <div>
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(0,0,0,0.08)', padding: 28, marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>Current Score</h2>

            {/* Score Gauge */}
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{
                display: 'inline-block', padding: '20px 40px', borderRadius: 14,
                background: getScoreBackground(totalScore),
              }}>
                <div style={{ fontSize: 64, fontWeight: 800, color: getScoreColor(totalScore) }}>{totalScore}</div>
              </div>
            </div>

            {/* Scale Bar */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ flex: 6, background: '#dcfce7' }} />
                <div style={{ flex: 4, background: '#fef9c3' }} />
                <div style={{ flex: 10, background: '#fee2e2' }} />
              </div>
              <div style={{ position: 'relative', height: 20 }}>
                <div style={{
                  position: 'absolute',
                  left: `${Math.min(totalScore / 20 * 100, 100)}%`,
                  transform: 'translateX(-50%)',
                  fontSize: 16,
                }}>▲</div>
              </div>
            </div>

            {/* Decision */}
            <div style={{
              padding: '16px 20px', borderRadius: 10, background: getScoreBackground(totalScore),
              border: `2px solid ${getScoreColor(totalScore)}`, textAlign: 'center', marginBottom: 24,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Recommended Decision
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: getScoreColor(totalScore) }}>
                {DECISION_MAP[recommendedDecision].label}
              </div>
            </div>

            {/* Scoring Guide */}
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', lineHeight: 1.8 }}>
              <div style={{ marginBottom: 8, fontWeight: 600, color: '#15803d' }}>✅ 0-5: Stay Open</div>
              <div style={{ marginBottom: 8, fontWeight: 600, color: '#a16207' }}>⚠️ 6-9: Delay Opening</div>
              <div style={{ fontWeight: 600, color: '#dc2626' }}>❌ 10+: Close</div>
            </div>
          </div>

          {/* Score Breakdown */}
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(0,0,0,0.08)', padding: '20px 24px' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Score Breakdown</h3>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ScoreRow label="Road Conditions" value={roadConditions} max={4} />
              <ScoreRow label="Temperature" value={temperature} max={3} />
              <ScoreRow label="School Closures" value={schoolClosures} max={3} />
              <ScoreRow label="Wind Speed" value={windSpeed} max={1} />
              <ScoreRow label="Ice Severity" value={iceSeverity} max={4} />
              <ScoreRow label="Weather Duration" value={weatherDuration} max={4} />
              <ScoreRow label="Emergency Services" value={emergencyServices} max={1} />
            </div>
          </div>
        </div>
      </div>

      {/* Historical Decisions */}
      <div style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Historical Decisions</h2>
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)', background: 'rgba(0,0,0,0.02)' }}>
                  {['Date', 'Score', 'Decision', 'Breakdown', 'Notes'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Score' ? 'center' : 'left', padding: '12px 20px', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.3)' }}>Loading...</td></tr>
                ) : decisions.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.3)' }}>No decisions logged yet</td></tr>
                ) : decisions.map((d) => (
                  <tr key={d.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                    <td style={{ padding: '14px 20px', fontWeight: 500 }}>
                      {new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '14px 20px', textAlign: 'center' }}>
                      <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 6, fontSize: 13, fontWeight: 700, background: getScoreBackground(d.score), color: getScoreColor(d.score) }}>
                        {d.score}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: DECISION_MAP[d.decision]?.color || '#6b7280' }}>
                        {DECISION_MAP[d.decision]?.emoji} {DECISION_MAP[d.decision]?.label || d.decision}
                      </span>
                    </td>
                    <td style={{ padding: '14px 20px', fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>
                      Road {d.road_conditions} · Temp {d.temperature} · School {d.school_closures} · Wind {d.wind_speed} · Ice {d.ice_severity} · Duration {d.weather_duration} · Emergency {d.emergency_services}
                    </td>
                    <td style={{ padding: '14px 20px', fontSize: 13, color: 'rgba(0,0,0,0.5)', maxWidth: 250 }}>
                      {d.notes || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function FactorInput({ label, value, onChange, options, highlight }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: { value: number; label: string }[];
  highlight?: boolean;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        {label}
        {highlight && <span style={{ fontSize: 10, color: '#3b82f6', fontWeight: 500 }}>manual</span>}
      </label>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: '100%', padding: '10px 14px', borderRadius: 8,
          border: `1px solid ${value > 0 ? 'rgba(220,38,38,0.3)' : 'rgba(0,0,0,0.12)'}`,
          fontSize: 14, background: value > 0 ? 'rgba(254,226,226,0.3)' : '#fff',
        }}>
        {options.map((opt, i) => (
          <option key={i} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function ScoreRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <span style={{ flex: 1 }}>{label}</span>
      <div style={{ width: 80, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{
          width: `${max > 0 ? (value / max) * 100 : 0}%`, height: '100%', borderRadius: 3,
          background: value === 0 ? 'transparent' : value >= max * 0.75 ? '#dc2626' : value >= max * 0.5 ? '#f59e0b' : '#15803d',
          transition: 'width 0.2s',
        }} />
      </div>
      <span style={{ fontWeight: 700, color: value > 0 ? '#1a1a1a' : 'rgba(0,0,0,0.3)', width: 20, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
