import { useEffect, useMemo, useState } from 'react';

interface Applicant {
  id: string;
  row: number;
  submittedAt: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  resumeFileId: string | null;
  resumeUrl: string | null;
  fields: Record<string, string>;
}

interface ApplicantsResp {
  ok: boolean;
  sheetId: string;
  sheetTitle: string | null;
  headers: string[];
  applicants: Applicant[];
}

const STATUS_KEY = 'germania_applicant_status';
const NOTE_KEY = 'germania_applicant_notes';
const RATING_KEY = 'germania_applicant_ratings';

type Status = 'new' | 'shortlist' | 'reject' | 'hired';
const STATUS_LABELS: Record<Status, string> = {
  new: 'New',
  shortlist: 'Shortlist',
  reject: 'Reject',
  hired: 'Hired',
};
const STATUS_COLORS: Record<Status, { bg: string; fg: string }> = {
  new: { bg: '#eef2f7', fg: '#3a4a5c' },
  shortlist: { bg: '#e6f4ea', fg: '#1f8a3b' },
  reject: { bg: '#fce8e6', fg: '#c0392b' },
  hired: { bg: '#fff4d6', fg: '#8a6a00' },
};

function loadMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveMap<T>(key: string, m: Record<string, T>) {
  localStorage.setItem(key, JSON.stringify(m));
}

export default function Applicants() {
  const [data, setData] = useState<ApplicantsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, Status>>(() => loadMap<Status>(STATUS_KEY));
  const [notes, setNotes] = useState<Record<string, string>>(() => loadMap<string>(NOTE_KEY));
  const [ratings, setRatings] = useState<Record<string, number>>(() => loadMap<number>(RATING_KEY));
  const [openId, setOpenId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<Status | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<'date-desc' | 'date-asc' | 'name-asc' | 'rating-desc'>(
    'date-desc',
  );

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    setReauth(false);
    try {
      const r = await fetch('/api/applicants', { cache: 'no-store' });
      const j = await r.json();
      if (r.status === 401 && j.error === 'google_reauth_required') {
        setReauth(true);
        return;
      }
      if (!r.ok) throw new Error(j.message || j.error || 'Failed to fetch');
      setData(j);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const setStatus = (id: string, s: Status) => {
    const next = { ...statuses, [id]: s };
    setStatuses(next);
    saveMap(STATUS_KEY, next);
  };
  const setNote = (id: string, text: string) => {
    const next = { ...notes, [id]: text };
    setNotes(next);
    saveMap(NOTE_KEY, next);
  };
  const setRating = (id: string, stars: number) => {
    const next = { ...ratings, [id]: stars };
    setRatings(next);
    saveMap(RATING_KEY, next);
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const matched = data.applicants.filter((a) => {
      const s = statuses[a.id] ?? 'new';
      if (filterStatus !== 'all' && s !== filterStatus) return false;
      if (!q) return true;
      const hay = [
        a.name,
        a.email,
        a.phone,
        ...Object.values(a.fields),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });

    // Date.parse handles the Sheets default "5/11/2026 8:30:15" format and
    // ISO 8601 alike; rows with no parseable timestamp sort to the bottom.
    const ts = (a: Applicant) => {
      const t = a.submittedAt ? Date.parse(a.submittedAt) : NaN;
      return Number.isNaN(t) ? -Infinity : t;
    };

    const sorted = [...matched];
    switch (sortKey) {
      case 'date-desc':
        sorted.sort((a, b) => ts(b) - ts(a));
        break;
      case 'date-asc':
        sorted.sort((a, b) => ts(a) - ts(b));
        break;
      case 'name-asc':
        sorted.sort((a, b) => (a.name ?? '￿').localeCompare(b.name ?? '￿'));
        break;
      case 'rating-desc':
        sorted.sort((a, b) => (ratings[b.id] ?? 0) - (ratings[a.id] ?? 0));
        break;
    }
    return sorted;
  }, [data, query, filterStatus, statuses, sortKey, ratings]);

  const counts = useMemo(() => {
    if (!data) return { all: 0, new: 0, shortlist: 0, reject: 0, hired: 0 };
    const c = { all: data.applicants.length, new: 0, shortlist: 0, reject: 0, hired: 0 };
    for (const a of data.applicants) {
      const s = statuses[a.id] ?? 'new';
      c[s]++;
    }
    return c;
  }, [data, statuses]);

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
        marginBottom: 20,
      }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Applicants</h1>
        {data && (
          <span style={{ fontSize: 13, color: '#888' }}>
            {data.applicants.length} total · sheet "{data.sheetTitle ?? 'Unknown'}"
          </span>
        )}
        <button
          className="btn btn-secondary btn-sm"
          onClick={fetchData}
          disabled={loading}
          style={{ marginLeft: 'auto' }}
        >{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      {reauth && (
        <Card>
          <strong>Re-authentication needed.</strong> The dashboard now requires
          a new Google permission to read Sheets. Sign out and back in to grant
          it.{' '}
          <a href="/api/auth/google" style={{ color: '#2563eb', marginLeft: 8 }}>
            Sign in again →
          </a>
        </Card>
      )}

      {error && !reauth && (
        <Card>
          <div style={{ color: '#c0392b' }}>
            <strong>Error:</strong> {error}
          </div>
        </Card>
      )}

      {data && (
        <>
          {/* Filters */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            flexWrap: 'wrap', marginBottom: 16,
          }}>
            {(['all', 'new', 'shortlist', 'reject', 'hired'] as const).map((s) => {
              const active = filterStatus === s;
              const count = (counts as any)[s];
              return (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  style={{
                    padding: '6px 14px', borderRadius: 999,
                    border: active ? '1px solid #1a1a1a' : '1px solid #ddd',
                    background: active ? '#1a1a1a' : '#fff',
                    color: active ? '#fff' : '#333',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {s === 'all' ? 'All' : STATUS_LABELS[s as Status]}
                  <span style={{ marginLeft: 6, opacity: 0.6 }}>{count}</span>
                </button>
              );
            })}
            <input
              type="text"
              placeholder="Search name, email, role…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                flex: 1, minWidth: 200, maxWidth: 360,
                padding: '8px 12px', borderRadius: 8,
                border: '1px solid #ddd', fontSize: 13,
              }}
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
              style={{
                padding: '8px 10px', borderRadius: 8,
                border: '1px solid #ddd', fontSize: 13,
                background: '#fff', cursor: 'pointer',
              }}
              aria-label="Sort applicants"
            >
              <option value="date-desc">Newest first</option>
              <option value="date-asc">Oldest first</option>
              <option value="name-asc">Name A–Z</option>
              <option value="rating-desc">Highest rated</option>
            </select>
          </div>

          {/* Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 14,
          }}>
            {filtered.map((a) => (
              <ApplicantCard
                key={a.id}
                applicant={a}
                status={statuses[a.id] ?? 'new'}
                rating={ratings[a.id] ?? 0}
                note={notes[a.id] ?? ''}
                onStatus={(s) => setStatus(a.id, s)}
                onRating={(n) => setRating(a.id, n)}
                onOpen={() => setOpenId(a.id)}
              />
            ))}
          </div>

          {filtered.length === 0 && (
            <Card>
              <div style={{ color: '#888' }}>No applicants match the current filter.</div>
            </Card>
          )}
        </>
      )}

      {openId && data && (
        <ApplicantDrawer
          applicant={data.applicants.find((a) => a.id === openId)!}
          status={statuses[openId] ?? 'new'}
          rating={ratings[openId] ?? 0}
          note={notes[openId] ?? ''}
          onClose={() => setOpenId(null)}
          onStatus={(s) => setStatus(openId, s)}
          onRating={(n) => setRating(openId, n)}
          onNote={(t) => setNote(openId, t)}
        />
      )}
    </div>
  );
}

function ApplicantCard({
  applicant: a, status, rating, note, onStatus, onRating, onOpen,
}: {
  applicant: Applicant;
  status: Status;
  rating: number;
  note: string;
  onStatus: (s: Status) => void;
  onRating: (n: number) => void;
  onOpen: () => void;
}) {
  const sc = STATUS_COLORS[status];
  return (
    <div
      onClick={onOpen}
      style={{
        background: '#fff', borderRadius: 10, padding: '14px 16px',
        border: '1px solid rgba(0,0,0,0.07)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: 8,
        transition: 'box-shadow 100ms',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16, fontWeight: 700, color: '#1a1a1a',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{a.name ?? '(no name)'}</div>
          {(a.email || a.phone) && (
            <div style={{
              fontSize: 12, color: '#888', marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{a.email}{a.email && a.phone ? ' · ' : ''}{a.phone}</div>
          )}
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 8px',
          borderRadius: 999, background: sc.bg, color: sc.fg,
          flexShrink: 0,
        }}>{STATUS_LABELS[status]}</span>
      </div>

      {a.submittedAt && (
        <div style={{ fontSize: 11, color: '#aaa' }}>
          Submitted {a.submittedAt}
        </div>
      )}

      {/* Star rating */}
      <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onRating(n === rating ? 0 : n)}
            style={{
              border: 0, background: 'transparent', cursor: 'pointer',
              padding: 2, color: n <= rating ? '#f5b400' : '#ddd',
              fontSize: 18, lineHeight: 1,
            }}
            aria-label={`Rate ${n}`}
          >★</button>
        ))}
      </div>

      {note && (
        <div style={{
          fontSize: 12, color: '#555', background: '#fafaf6',
          padding: '6px 8px', borderRadius: 6, fontStyle: 'italic',
          maxHeight: 60, overflow: 'hidden',
        }}>{note}</div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }} onClick={(e) => e.stopPropagation()}>
        {(['shortlist', 'reject', 'hired'] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => onStatus(s === status ? 'new' : s)}
            style={{
              flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 600,
              border: status === s ? `1px solid ${STATUS_COLORS[s].fg}` : '1px solid #ddd',
              borderRadius: 6, cursor: 'pointer',
              background: status === s ? STATUS_COLORS[s].bg : '#fff',
              color: status === s ? STATUS_COLORS[s].fg : '#666',
            }}
          >{STATUS_LABELS[s]}</button>
        ))}
        {a.resumeFileId && (
          <span style={{
            padding: '5px 8px', fontSize: 11, fontWeight: 600,
            borderRadius: 6, background: '#eef2ff', color: '#3a3aa0',
          }}>📄</span>
        )}
      </div>
    </div>
  );
}

function ApplicantDrawer({
  applicant: a, status, rating, note,
  onClose, onStatus, onRating, onNote,
}: {
  applicant: Applicant;
  status: Status;
  rating: number;
  note: string;
  onClose: () => void;
  onStatus: (s: Status) => void;
  onRating: (n: number) => void;
  onNote: (t: string) => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'flex-end',
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', width: 'min(960px, 100%)', height: '100%',
          overflowY: 'auto', padding: '24px 28px',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          marginBottom: 20, paddingBottom: 16,
          borderBottom: '1px solid #eee',
        }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
              {a.name ?? '(no name)'}
            </h2>
            <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
              {a.email}{a.email && a.phone ? ' · ' : ''}{a.phone}
              {a.submittedAt && ` · submitted ${a.submittedAt}`}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 0, background: 'transparent', fontSize: 22,
              cursor: 'pointer', color: '#999', padding: 4,
            }}
            aria-label="Close"
          >×</button>
        </div>

        {/* Status pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {(['new', 'shortlist', 'reject', 'hired'] as Status[]).map((s) => (
            <button
              key={s}
              onClick={() => onStatus(s)}
              style={{
                padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                border: status === s ? `1px solid ${STATUS_COLORS[s].fg}` : '1px solid #ddd',
                background: status === s ? STATUS_COLORS[s].bg : '#fff',
                color: status === s ? STATUS_COLORS[s].fg : '#666',
                cursor: 'pointer',
              }}
            >{STATUS_LABELS[s]}</button>
          ))}
        </div>

        {/* Stars + note */}
        <div style={{
          display: 'grid', gap: 14,
          gridTemplateColumns: '1fr 2fr',
          marginBottom: 20,
        }}>
          <div>
            <div style={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: 1,
              color: '#888', fontWeight: 600, marginBottom: 6,
            }}>Rating</div>
            <div style={{ display: 'flex', gap: 2 }}>
              {[1,2,3,4,5].map((n) => (
                <button
                  key={n}
                  onClick={() => onRating(n === rating ? 0 : n)}
                  style={{
                    border: 0, background: 'transparent', cursor: 'pointer',
                    padding: 2, color: n <= rating ? '#f5b400' : '#ddd',
                    fontSize: 24, lineHeight: 1,
                  }}
                >★</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: 1,
              color: '#888', fontWeight: 600, marginBottom: 6,
            }}>Notes</div>
            <textarea
              value={note}
              onChange={(e) => onNote(e.target.value)}
              placeholder="Notes about this applicant…"
              style={{
                width: '100%', minHeight: 60,
                padding: '8px 10px', fontSize: 13,
                border: '1px solid #ddd', borderRadius: 6,
                resize: 'vertical', fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        {/* Resume embed */}
        {a.resumeFileId && (
          <div style={{ marginBottom: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8,
            }}>
              <div style={{
                fontSize: 11, textTransform: 'uppercase', letterSpacing: 1,
                color: '#888', fontWeight: 600,
              }}>Resume</div>
              <a
                href={`/api/applicants/resume/${a.resumeFileId}`}
                target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: '#2563eb' }}
              >Open in new tab ↗</a>
            </div>
            <iframe
              src={`/api/applicants/resume/${a.resumeFileId}`}
              style={{
                width: '100%', height: 600,
                border: '1px solid #eee', borderRadius: 8,
              }}
              title="Resume"
            />
          </div>
        )}

        {/* All sheet fields */}
        <div>
          <div style={{
            fontSize: 11, textTransform: 'uppercase', letterSpacing: 1,
            color: '#888', fontWeight: 600, marginBottom: 10,
          }}>Application responses</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {Object.entries(a.fields)
              .filter(([, v]) => v && v.length > 0)
              .map(([k, v]) => (
                <div key={k} style={{
                  padding: '10px 12px', background: '#fafafa',
                  borderRadius: 6, border: '1px solid #f0f0f0',
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: '#888',
                    marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>{k}</div>
                  <div style={{ fontSize: 14, color: '#1a1a1a', whiteSpace: 'pre-wrap' }}>
                    {v}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 10, padding: '18px 22px',
      border: '1px solid rgba(0,0,0,0.07)',
      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
    }}>
      {children}
    </div>
  );
}
