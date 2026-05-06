import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useIsMobile } from '../hooks/useIsMobile';

const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];

export default function NewLaunch() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [form, setForm] = useState({
    name: '',
    season: 'Summer',
    year: new Date().getFullYear(),
    launch_date: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const launch = await api.post('/api/launches', form);
      navigate(`/launch/${launch.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 32, letterSpacing: -0.5 }}>New Menu Launch</h1>

      <form onSubmit={handleSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <label>Launch Name</label>
          <input
            type="text"
            placeholder="e.g. Summer 2026 Menu"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
          <div>
            <label>Season</label>
            <select value={form.season} onChange={e => setForm({ ...form, season: e.target.value })}>
              {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label>Year</label>
            <input
              type="number"
              value={form.year}
              onChange={e => setForm({ ...form, year: parseInt(e.target.value) })}
              required
            />
          </div>
        </div>

        <div>
          <label>Target Launch Date (Thursday recommended)</label>
          <input
            type="date"
            value={form.launch_date}
            onChange={e => setForm({ ...form, launch_date: e.target.value })}
          />
          <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.25)', marginTop: 6 }}>
            Pre-launch tasks will be auto-generated based on this date
          </p>
        </div>

        {error && (
          <div style={{
            color: '#d32f2f',
            fontSize: 13,
            padding: '10px 14px',
            background: 'rgba(210,50,50,0.05)',
            borderRadius: 10,
          }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ flex: 1 }}>
            {submitting ? 'Creating...' : 'Create Launch'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/')}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
