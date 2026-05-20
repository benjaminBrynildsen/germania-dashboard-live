/**
 * Holiday Calendar — shared special-hours tracker so every manager sees
 * the same schedule. Card stack sorted by date; click a card to open
 * the detail modal with last year's hourly traffic per store so they
 * can staff this year accordingly. Edits gated to admin + manager.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../hooks/useAuth';

type HolidayStatus = 'normal' | 'closed' | 'custom';

interface Holiday {
  id: number;
  date: string;          // YYYY-MM-DD
  name: string;
  status: HolidayStatus;
  openTime: string | null;   // "HH:MM"
  closeTime: string | null;  // "HH:MM"
  notes: string | null;
  createdBy: number | null;
  createdAt: number;
  updatedAt: number;
}

interface HourSample {
  hour: string;             // "6AM" / "7AM" / "12PM" / ...
  ticketCount: number;
  avgCompletionMin: number;
}

interface PriorYearData {
  year: number;
  date: string;
  name: string;
  byStore: Record<string, HourSample[]>;
}

const STORES = ['G1', 'G2', 'G3', 'G4'];
const STORE_LABELS: Record<string, string> = {
  G1: 'Alton',
  G2: 'Godfrey',
  G3: 'E. Alton',
  G4: 'Jerseyville',
};

// Hour columns we render in the historical table — matches the
// TicketTime page's grid so visualization is consistent.
const HOUR_COLS = ['6AM', '7AM', '8AM', '9AM', '10AM', '11AM', '12PM', '1PM', '2PM', '3PM', '4PM', '5PM'];

export default function HolidayCalendar() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailHoliday, setDetailHoliday] = useState<Holiday | null>(null);

  const loadHolidays = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/holidays', { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || body.error || 'Failed to load holidays');
      setHolidays(body.holidays || []);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadHolidays(); }, [loadHolidays]);

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const upcoming = useMemo(() => holidays.filter((h) => h.date >= today), [holidays, today]);
  const past = useMemo(() => holidays.filter((h) => h.date < today), [holidays, today]);

  const onSave = async (patch: Partial<Holiday> & { date: string; name: string; status: HolidayStatus }) => {
    try {
      const isUpdate = editing != null;
      const url = isUpdate ? `/api/holidays/${editing!.id}` : '/api/holidays';
      const r = await fetch(url, {
        method: isUpdate ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || body.error || 'Save failed');
      setEditing(null);
      setCreating(false);
      await loadHolidays();
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  const onDelete = async (id: number) => {
    if (!confirm('Delete this holiday?')) return;
    try {
      const r = await fetch(`/api/holidays/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || body.error || 'Delete failed');
      }
      setEditing(null);
      await loadHolidays();
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  return (
    <div>
      <div style={{ marginBottom: isMobile ? 14 : 18 }}>
        <h1 style={{
          fontSize: isMobile ? 22 : 28,
          fontWeight: 700, letterSpacing: -0.5, margin: 0,
        }}>Holiday Calendar</h1>
        {!isMobile && (
          <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
            Shared schedule of special hours per holiday. Click a card to see last year's hourly traffic per store.
          </p>
        )}
      </div>

      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 14,
          background: '#fef2f2', border: '1px solid #fecaca',
          color: '#b91c1c', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 12, marginBottom: 14, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {canEdit && (
            <button
              onClick={() => { setEditing(null); setCreating(true); }}
              style={primaryBtn}
            >+ Add Holiday</button>
          )}
        </div>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 13, color: 'rgba(0,0,0,0.55)', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={showPast}
            onChange={(e) => setShowPast(e.target.checked)}
          />
          Show past
        </label>
      </div>

      {loading && holidays.length === 0 && (
        <div style={{ color: 'rgba(0,0,0,0.3)', padding: 40, textAlign: 'center' }}>Loading holidays…</div>
      )}

      {!loading && holidays.length === 0 && (
        <div style={{
          textAlign: 'center', padding: 60,
          color: 'rgba(0,0,0,0.4)', fontSize: 14,
        }}>
          No holidays yet.
          {canEdit && <> <button onClick={() => { setEditing(null); setCreating(true); }} style={{ background: 'none', border: 0, color: '#1a1a1a', textDecoration: 'underline', cursor: 'pointer' }}>Add the first one →</button></>}
        </div>
      )}

      {showPast && past.length > 0 && (
        <>
          <div style={sectionLabel}>Past</div>
          <CardList holidays={past} canEdit={canEdit} onCardClick={setDetailHoliday} onEdit={setEditing} onDelete={onDelete} />
          <div style={{ height: 20 }} />
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <div style={sectionLabel}>Upcoming</div>
          <CardList holidays={upcoming} canEdit={canEdit} onCardClick={setDetailHoliday} onEdit={setEditing} onDelete={onDelete} />
        </>
      )}

      {(editing || creating) && (
        <HolidayFormModal
          initial={editing}
          onSave={onSave}
          onCancel={() => { setEditing(null); setCreating(false); }}
          onDelete={editing ? () => onDelete(editing.id) : undefined}
        />
      )}

      {detailHoliday && (
        <HolidayDetailModal
          holiday={detailHoliday}
          onClose={() => setDetailHoliday(null)}
        />
      )}
    </div>
  );
}

// ─── List + card ──────────────────────────────────────────────────────

function CardList({
  holidays, canEdit, onCardClick, onEdit, onDelete,
}: {
  holidays: Holiday[];
  canEdit: boolean;
  onCardClick: (h: Holiday) => void;
  onEdit: (h: Holiday) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {holidays.map((h) => (
        <HolidayCard
          key={h.id}
          holiday={h}
          canEdit={canEdit}
          onClick={() => onCardClick(h)}
          onEdit={() => onEdit(h)}
          onDelete={() => onDelete(h.id)}
        />
      ))}
    </div>
  );
}

function HolidayCard({
  holiday, canEdit, onClick, onEdit, onDelete,
}: {
  holiday: Holiday;
  canEdit: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const dateObj = new Date(holiday.date + 'T00:00:00');
  const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
  const monthDay = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 12,
        padding: '16px 18px',
        cursor: 'pointer',
        transition: 'box-shadow 0.15s, transform 0.1s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {weekday}, {monthDay}, {dateObj.getFullYear()}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{holiday.name}</div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              style={cardBtn}
              title="Edit"
            >Edit</button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              style={{ ...cardBtn, color: '#b91c1c' }}
              title="Delete"
            >×</button>
          </div>
        )}
      </div>
      <div style={{ marginTop: 10 }}>
        <StatusPill holiday={holiday} />
      </div>
      {holiday.notes && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 8,
          background: 'rgba(0,0,0,0.03)',
          fontSize: 13, color: 'rgba(0,0,0,0.6)', lineHeight: 1.4,
        }}>
          {holiday.notes}
        </div>
      )}
    </div>
  );
}

function StatusPill({ holiday }: { holiday: Holiday }) {
  if (holiday.status === 'closed') {
    return (
      <span style={pill('#fee2e2', '#b91c1c')}>
        CLOSED ALL DAY
      </span>
    );
  }
  if (holiday.status === 'custom' && holiday.openTime && holiday.closeTime) {
    return (
      <span style={pill('#dbeafe', '#1e40af')}>
        {fmt12(holiday.openTime)} – {fmt12(holiday.closeTime)}
      </span>
    );
  }
  return (
    <span style={pill('#dcfce7', '#166534')}>
      NORMAL HOURS
    </span>
  );
}

// ─── Form modal ──────────────────────────────────────────────────────

const PRESETS: Array<{ label: string; status: HolidayStatus; openTime?: string; closeTime?: string }> = [
  { label: 'Normal hours', status: 'normal' },
  { label: 'Closed all day', status: 'closed' },
  { label: '8–4', status: 'custom', openTime: '08:00', closeTime: '16:00' },
  { label: '8–3', status: 'custom', openTime: '08:00', closeTime: '15:00' },
  { label: 'Custom', status: 'custom' },
];

function HolidayFormModal({
  initial, onSave, onCancel, onDelete,
}: {
  initial: Holiday | null;
  onSave: (h: Partial<Holiday> & { date: string; name: string; status: HolidayStatus }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const isMobile = useIsMobile();
  const [date, setDate] = useState(initial?.date || '');
  const [name, setName] = useState(initial?.name || '');
  const [status, setStatus] = useState<HolidayStatus>(initial?.status || 'normal');
  const [openTime, setOpenTime] = useState(initial?.openTime || '');
  const [closeTime, setCloseTime] = useState(initial?.closeTime || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [presetLabel, setPresetLabel] = useState<string>(() => detectPreset(initial));

  const applyPreset = (p: typeof PRESETS[number]) => {
    setPresetLabel(p.label);
    setStatus(p.status);
    if (p.status === 'custom' && p.openTime && p.closeTime) {
      setOpenTime(p.openTime);
      setCloseTime(p.closeTime);
    } else if (p.status !== 'custom') {
      // Clearing the times on Normal/Closed avoids stale "ghost" hours
      // showing up the next time someone flips back to Custom.
      setOpenTime('');
      setCloseTime('');
    }
  };

  const canSave = !!date && !!name && (status !== 'custom' || (!!openTime && !!closeTime && openTime < closeTime));

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: isMobile ? '14px 14px 0 0' : 14,
          padding: '20px 22px',
          width: '100%',
          maxWidth: 520,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
          {initial ? 'Edit Holiday' : 'Add Holiday'}
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={input}
            />
          </Field>
          <Field label="Holiday">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Christmas Day"
              style={input}
            />
          </Field>

          <Field label="Hours">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PRESETS.map((p) => {
                const active = presetLabel === p.label;
                return (
                  <button
                    key={p.label}
                    onClick={() => applyPreset(p)}
                    style={{
                      padding: '7px 12px', borderRadius: 8,
                      border: active ? '2px solid #1a1a1a' : '1px solid rgba(0,0,0,0.15)',
                      background: active ? '#1a1a1a' : '#fff',
                      color: active ? '#fff' : '#1a1a1a',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}
                  >{p.label}</button>
                );
              })}
            </div>
            {status === 'custom' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                <input
                  type="time"
                  value={openTime}
                  onChange={(e) => setOpenTime(e.target.value)}
                  style={{ ...input, width: 130 }}
                />
                <span style={{ color: 'rgba(0,0,0,0.4)' }}>–</span>
                <input
                  type="time"
                  value={closeTime}
                  onChange={(e) => setCloseTime(e.target.value)}
                  style={{ ...input, width: 130 }}
                />
              </div>
            )}
            {status === 'custom' && openTime && closeTime && openTime >= closeTime && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}>
                Open time must be before close time.
              </div>
            )}
          </Field>

          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Drive-thru only at G3. Re-open Tue at 6."
              style={{ ...input, minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, gap: 10 }}>
          <div>
            {onDelete && (
              <button onClick={onDelete} style={{ ...cardBtn, color: '#b91c1c', padding: '8px 12px' }}>
                Delete
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onCancel} style={{ ...cardBtn, padding: '8px 14px' }}>Cancel</button>
            <button
              onClick={() => canSave && onSave({
                date, name, status,
                openTime: status === 'custom' ? openTime : null,
                closeTime: status === 'custom' ? closeTime : null,
                notes: notes.trim() || null,
              })}
              disabled={!canSave}
              style={{
                ...primaryBtn,
                opacity: canSave ? 1 : 0.5,
                cursor: canSave ? 'pointer' : 'not-allowed',
              }}
            >Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function detectPreset(h: Holiday | null): string {
  if (!h) return 'Normal hours';
  if (h.status === 'normal') return 'Normal hours';
  if (h.status === 'closed') return 'Closed all day';
  if (h.status === 'custom' && h.openTime === '08:00' && h.closeTime === '16:00') return '8–4';
  if (h.status === 'custom' && h.openTime === '08:00' && h.closeTime === '15:00') return '8–3';
  return 'Custom';
}

// ─── Detail modal — prior-year hourly traffic ─────────────────────────

function HolidayDetailModal({
  holiday, onClose,
}: {
  holiday: Holiday;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const [data, setData] = useState<{ priorYears: PriorYearData[]; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/holidays/${holiday.id}/historical?years=2`, { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.message || body.error || 'Failed');
        setData({ priorYears: body.priorYears || [], note: body.note });
      })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, [holiday.id]);

  const dateObj = new Date(holiday.date + 'T00:00:00');
  const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: isMobile ? '14px 14px 0 0' : 14,
          padding: '22px 24px',
          width: '100%',
          maxWidth: 820,
          maxHeight: '92vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {weekday}, {monthDay}, {dateObj.getFullYear()}
            </div>
            <h3 style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 700 }}>{holiday.name}</h3>
          </div>
          <button
            onClick={onClose}
            style={{ ...cardBtn, padding: '6px 12px' }}
          >Close</button>
        </div>

        <div style={{ marginTop: 14 }}>
          <StatusPill holiday={holiday} />
        </div>

        {holiday.notes && (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 8,
            background: 'rgba(0,0,0,0.03)',
            fontSize: 13, color: 'rgba(0,0,0,0.65)', lineHeight: 1.5,
          }}>
            {holiday.notes}
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
            color: 'rgba(0,0,0,0.4)', marginBottom: 10,
          }}>
            Prior-year hourly traffic
          </div>
          {loading && <div style={{ color: 'rgba(0,0,0,0.4)', padding: 24, textAlign: 'center' }}>Loading… (first open can take ~10s)</div>}
          {error && <div style={{ color: '#b91c1c', padding: 12, fontSize: 13 }}>Error: {error}</div>}
          {data && data.note === 'no_prior_data' && (
            <div style={{
              padding: 20, textAlign: 'center', color: 'rgba(0,0,0,0.5)', fontSize: 13,
              background: 'rgba(0,0,0,0.02)', borderRadius: 10,
            }}>
              No prior-year data yet — we'll have last year's numbers next time this comes around.
            </div>
          )}
          {data && data.priorYears.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {data.priorYears.map((py) => (
                <HistoricalTable key={py.date} year={py} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoricalTable({ year }: { year: PriorYearData }) {
  // Build hourly-by-store map for quick lookup + find chart max so we
  // can size the heatmap shade. Each cell shows ticketCount with a
  // background color whose darkness scales with the ratio to max.
  const lookup: Record<string, Record<string, number>> = {};
  let max = 0;
  for (const store of STORES) {
    lookup[store] = {};
    for (const h of year.byStore[store] || []) {
      lookup[store][h.hour] = h.ticketCount;
      if (h.ticketCount > max) max = h.ticketCount;
    }
  }
  const dateObj = new Date(year.date + 'T00:00:00');
  const label = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
        {year.name} {year.year} <span style={{ color: 'rgba(0,0,0,0.4)', fontWeight: 400 }}>· {label}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%', minWidth: 480 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              <th style={th}>Store</th>
              {HOUR_COLS.map((h) => (
                <th key={h} style={{ ...th, textAlign: 'center', width: 44 }}>{h}</th>
              ))}
              <th style={{ ...th, textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {STORES.map((store) => {
              const total = HOUR_COLS.reduce((acc, h) => acc + (lookup[store][h] || 0), 0);
              return (
                <tr key={store} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {store} <span style={{ color: 'rgba(0,0,0,0.4)', fontWeight: 400 }}>{STORE_LABELS[store]}</span>
                  </td>
                  {HOUR_COLS.map((h) => {
                    const v = lookup[store][h] || 0;
                    const intensity = max > 0 ? v / max : 0;
                    const bg = intensity > 0 ? `rgba(220, 38, 38, ${intensity * 0.55})` : 'transparent';
                    const color = intensity > 0.4 ? '#fff' : 'rgba(0,0,0,0.7)';
                    return (
                      <td key={h} style={{ ...td, textAlign: 'center', background: bg, color, fontVariantNumeric: 'tabular-nums' }}>
                        {v || '·'}
                      </td>
                    );
                  })}
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {total || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>
        Drink ticket count per hour (from Dripos /report/completion). Heatmap shade scales to the busiest hour in this view.
      </div>
    </div>
  );
}

// ─── Shared helpers ──────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'rgba(0,0,0,0.5)', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function fmt12(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  if (!Number.isFinite(h)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mStr} ${period}`;
}

function pill(bg: string, color: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '5px 10px',
    borderRadius: 999,
    background: bg, color,
    fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
  };
}

const primaryBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 0,
  background: '#1a1a1a',
  color: '#fff',
  fontSize: 13, fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const cardBtn: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.12)',
  background: '#fff',
  color: 'rgba(0,0,0,0.7)',
  fontSize: 12, fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.15)',
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
  color: 'rgba(0,0,0,0.4)', marginBottom: 10,
};

const th: React.CSSProperties = {
  padding: '6px 4px',
  textAlign: 'left',
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
  color: 'rgba(0,0,0,0.5)',
};

const td: React.CSSProperties = {
  padding: '6px 4px',
  fontSize: 12,
};
