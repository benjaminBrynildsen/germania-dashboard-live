import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useCanEdit, NumInput, inputStyle, labelStyle } from './ui';

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
        <NumInput value={target} onChange={setTarget} step={0.5} min={1} width={160} disabled={!canEdit} />
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

      {canEdit && <ApiKeysCard />}
    </div>
  );
}

interface ApiKeyRow {
  id: number;
  name: string;
  prefix: string;
  scope: 'read' | 'write';
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

// Keys for bots and integrations (Grok, GPT, scripts…). The full key is
// shown exactly once at creation — only a hash is stored server-side.
function ApiKeysCard() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/api/api-keys').then(setKeys).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api.post('/api/api-keys', { name: name.trim(), scope });
      setFreshKey(r.key);
      setName('');
      load();
    } catch (e: any) { alert(`Create failed: ${e.message}`); }
    finally { setBusy(false); }
  };

  const revoke = async (k: ApiKeyRow) => {
    if (!confirm(`Revoke "${k.name}" (${k.prefix}…)? Anything using it stops working immediately.`)) return;
    try { await api.delete(`/api/api-keys/${k.id}`); load(); }
    catch (e: any) { alert(`Revoke failed: ${e.message}`); }
  };

  return (
    <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Bot / API access</h3>
      <p style={{ fontSize: 12.5, color: 'rgba(0,0,0,0.45)', marginBottom: 12, lineHeight: 1.5 }}>
        Keys let a bot (Grok, GPT, a script) use the dashboard API with its own identity —
        never share your login. <strong>Read</strong> keys can only look; <strong>write</strong> keys can
        also update. Instructions for the bot live at <code>/api/bot-docs</code>. Every change a key
        makes is stamped with its name.
      </p>

      {freshKey && (
        <div style={{
          padding: '12px 14px', borderRadius: 10, marginBottom: 12,
          background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 6 }}>
            Copy this key now — it won't be shown again.
          </div>
          <code style={{ fontSize: 13, wordBreak: 'break-all', userSelect: 'all' }}>{freshKey}</code>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm"
              onClick={() => { navigator.clipboard?.writeText(freshKey).catch(() => {}); }}>Copy</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setFreshKey(null)}>Done</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: '1 1 160px' }}>
          <label style={labelStyle}>Key name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="grokbot" />
        </div>
        <div>
          <label style={labelStyle}>Scope</label>
          <select value={scope} onChange={(e) => setScope(e.target.value as 'read' | 'write')} style={inputStyle}>
            <option value="read">read — look only</option>
            <option value="write">write — can update</option>
          </select>
        </div>
        <button className="btn btn-primary btn-sm" onClick={create} disabled={!name.trim() || busy} style={{ marginBottom: 2 }}>
          {busy ? '…' : 'Create key'}
        </button>
      </div>

      {keys.length > 0 && (
        <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)', color: 'rgba(0,0,0,0.4)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Name</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Key</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Scope</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)', opacity: k.revoked_at ? 0.45 : 1 }}>
                <td style={{ padding: '7px 8px', fontWeight: 600 }}>{k.name}</td>
                <td style={{ padding: '7px 8px', fontFamily: 'monospace' }}>{k.prefix}…</td>
                <td style={{ padding: '7px 8px' }}>{k.scope}</td>
                <td style={{ padding: '7px 8px', color: 'rgba(0,0,0,0.5)' }}>
                  {k.revoked_at ? 'revoked' : k.last_used_at ? new Date(k.last_used_at.replace(' ', 'T') + 'Z').toLocaleString() : 'never'}
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                  {!k.revoked_at && (
                    <button className="btn btn-danger btn-sm" onClick={() => revoke(k)}>Revoke</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
