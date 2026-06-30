import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useCanEdit, inputStyle, labelStyle } from './ui';

interface Settings {
  default_target_cogs_pct: number;
  drink_location_id: number;
}

const STORE_OPTIONS = [
  { id: 131, label: 'G1 Alton' },
  { id: 132, label: 'G2 Godfrey' },
  { id: 133, label: 'G3 East Alton' },
  { id: 134, label: 'G4 Jerseyville' },
];

export default function SettingsTab({ onChanged }: { onChanged?: () => void }) {
  const canEdit = useCanEdit();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [target, setTarget] = useState('');
  const [locationId, setLocationId] = useState(131);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/api/cog/settings').then((s) => {
      setSettings(s);
      setTarget(String(s.default_target_cogs_pct ?? 25));
      setLocationId(s.drink_location_id ?? 131);
    }).catch((e) => console.error('Failed to load settings:', e));
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const updated = await api.put('/api/cog/settings', {
        default_target_cogs_pct: target === '' ? null : parseFloat(target),
        drink_location_id: locationId,
      });
      setSettings(updated);
      setSaved(true);
      onChanged?.();
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div style={{ color: 'rgba(0,0,0,0.3)', padding: 40 }}>Loading...</div>;

  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>COGS Settings</h3>
      <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13, marginBottom: 20 }}>
        The default target COG % drives the recommended price for every drink
        (recommended price = cost ÷ target%). A drink can override it individually.
      </p>

      <div style={{ marginBottom: 18 }}>
        <label style={labelStyle}>Default target COG %</label>
        <input
          type="number" step="0.5" min="1" max="100"
          value={target}
          disabled={!canEdit}
          onChange={(e) => setTarget(e.target.value)}
          style={{ ...inputStyle, maxWidth: 160 }}
        />
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginTop: 6 }}>
          e.g. 25 means ingredients should be 25% of the menu price → a $1.00 drink is priced at $4.00.
        </div>
      </div>

      <div style={{ marginBottom: 22 }}>
        <label style={labelStyle}>Dripos store for catalog sync</label>
        <select
          value={locationId}
          disabled={!canEdit}
          onChange={(e) => setLocationId(Number(e.target.value))}
          style={{ ...inputStyle, maxWidth: 240 }}
        >
          {STORE_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginTop: 6 }}>
          The menu is shared across stores; sync pulls the drink list from this one.
        </div>
      </div>

      {canEdit ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save settings'}
          </button>
          {saved && <span style={{ color: '#16a34a', fontSize: 13, fontWeight: 600 }}>Saved ✓</span>}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>You don't have permission to change these.</div>
      )}
    </div>
  );
}
