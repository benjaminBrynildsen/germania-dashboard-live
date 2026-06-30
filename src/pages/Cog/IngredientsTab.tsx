import { useState, useEffect, useMemo } from 'react';
import { api } from '../../lib/api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useCanEdit, inputStyle, labelStyle, money, Modal } from './ui';

export interface MasterIngredient {
  id: number;
  name: string;
  ap_pack_cost: number | null;
  pack_size: number | null;
  pack_unit: string | null;
  supplier: string | null;
  last_updated: string;
}

function unitCost(i: MasterIngredient): number | null {
  if (!i.pack_size || i.pack_size <= 0) return null;
  return (i.ap_pack_cost || 0) / i.pack_size;
}

export default function IngredientsTab() {
  const isMobile = useIsMobile();
  const canEdit = useCanEdit();
  const [items, setItems] = useState<MasterIngredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<MasterIngredient | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      setItems(await api.get('/api/cog/ingredients/master'));
    } catch (e) {
      console.error('Failed to load ingredients:', e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => items.filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase())),
    [items, search],
  );

  const remove = async (i: MasterIngredient) => {
    if (!confirm(`Delete "${i.name}"? Drinks using it will show the line as missing until you fix them.`)) return;
    try {
      await api.delete(`/api/cog/ingredients/master/${i.id}`);
      load();
    } catch (e: any) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  if (loading) return <div style={{ color: 'rgba(0,0,0,0.3)', padding: 40 }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          placeholder="Search ingredients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, maxWidth: 280 }}
        />
        {canEdit && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Add ingredient</button>}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <th style={th('left')}>Name</th>
              <th style={th('right')}>Pack cost</th>
              <th style={th('right')}>Pack size</th>
              <th style={th('right')}>Cost / unit</th>
              <th style={th('left')}>Supplier</th>
              {canEdit && <th style={th('right')}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={canEdit ? 6 : 5} style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.3)' }}>No ingredients</td></tr>
            )}
            {filtered.map((i) => (
              <tr key={i.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '10px 12px', fontWeight: 600 }}>{i.name}</td>
                <td style={td('right')}>{money(i.ap_pack_cost)}</td>
                <td style={td('right')}>{i.pack_size ?? '—'} {i.pack_unit ?? ''}</td>
                <td style={{ ...td('right'), fontWeight: 600, color: '#1a1a1a' }}>
                  {unitCost(i) != null ? `${money(unitCost(i), 4)}/${i.pack_unit || 'unit'}` : '—'}
                </td>
                <td style={td('left')}>{i.supplier || '—'}</td>
                {canEdit && (
                  <td style={{ ...td('right'), whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditing(i)}>Edit</button>{' '}
                    <button className="btn btn-danger btn-sm" onClick={() => remove(i)}>Del</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <IngredientModal
          isMobile={isMobile}
          editing={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function IngredientModal({ editing, onClose, onSaved, isMobile }: {
  editing: MasterIngredient | null;
  onClose: () => void;
  onSaved: () => void;
  isMobile: boolean;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [packCost, setPackCost] = useState(editing?.ap_pack_cost?.toString() ?? '');
  const [packSize, setPackSize] = useState(editing?.pack_size?.toString() ?? '');
  const [packUnit, setPackUnit] = useState(editing?.pack_unit ?? '');
  const [supplier, setSupplier] = useState(editing?.supplier ?? '');
  const [saving, setSaving] = useState(false);

  const num = (s: string) => (s === '' ? null : parseFloat(s));
  const canSave = name.trim().length > 0;
  const liveUnitCost = num(packSize) && num(packSize)! > 0 ? (num(packCost) || 0) / num(packSize)! : null;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const body = { name: name.trim(), ap_pack_cost: num(packCost), pack_size: num(packSize), pack_unit: packUnit.trim() || null, supplier: supplier.trim() || null };
      if (editing) await api.put(`/api/cog/ingredients/master/${editing.id}`, body);
      else await api.post('/api/cog/ingredients/master', body);
      onSaved();
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
      setSaving(false);
    }
  };

  return (
    <Modal title={editing ? 'Edit ingredient' : 'Add ingredient'} onClose={onClose}>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus placeholder="Whole milk" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Pack cost ($)</label>
          <input type="number" step="0.01" value={packCost} onChange={(e) => setPackCost(e.target.value)} style={inputStyle} placeholder="3.20" />
        </div>
        <div>
          <label style={labelStyle}>Pack size</label>
          <input type="number" step="any" value={packSize} onChange={(e) => setPackSize(e.target.value)} style={inputStyle} placeholder="128" />
        </div>
        <div>
          <label style={labelStyle}>Pack unit</label>
          <input value={packUnit} onChange={(e) => setPackUnit(e.target.value)} style={inputStyle} placeholder="oz" />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Supplier</label>
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)} style={inputStyle} placeholder="Sysco" />
      </div>
      <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 18 }}>
        Cost per unit: <strong>{liveUnitCost != null ? `${money(liveUnitCost, 4)}/${packUnit || 'unit'}` : '— (set pack size)'}</strong>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!canSave || saving}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </Modal>
  );
}

const th = (align: 'left' | 'right'): React.CSSProperties => ({ textAlign: align, padding: '8px 12px', fontWeight: 600, color: 'rgba(0,0,0,0.4)', whiteSpace: 'nowrap' });
const td = (align: 'left' | 'right'): React.CSSProperties => ({ padding: '10px 12px', textAlign: align, color: 'rgba(0,0,0,0.6)' });
