import { useEffect, useMemo, useRef, useState } from 'react';

interface Applicant {
  id: string;
  row: number;
  submittedAt: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  resumeFileId: string | null;
  resumeUrl: string | null;
  storeLabels: string[];
  storeText: string | null;
  fields: Record<string, string>;
}

const STORE_COLORS: Record<string, string> = {
  G1: '#2c5f8d', G2: '#c97a3f', G3: '#5a9a4a', G4: '#a04ea0',
};
const STORE_CITIES: Record<string, string> = {
  G1: 'Alton', G2: 'Godfrey', G3: 'East Alton', G4: 'Jerseyville',
};

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

// A "New" pill is shown only when the submission is recent AND the user
// hasn't moved it out of the default status yet. Tighter than 7 days could
// be a per-store toggle later if hiring volume warrants it.
const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isRecentSubmission(submittedAt: string | null): boolean {
  if (!submittedAt) return false;
  const t = Date.parse(submittedAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < NEW_WINDOW_MS;
}

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
  // Empty set = no filter (show all). Otherwise, applicant passes if ANY
  // of its store labels is in the set, OR if 'unknown' is selected and
  // the applicant has no labels.
  const [filterStores, setFilterStores] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<'date-desc' | 'date-asc' | 'name-asc' | 'rating-desc'>(
    'date-desc',
  );
  const [viewMode, setViewMode] = useState<'grid' | 'swipe'>('grid');

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
      if (filterStatus !== 'all') {
        // "New" filter = unprocessed AND submitted within last week, matching
        // the pill visibility rule on cards. Other filters are strict status.
        if (filterStatus === 'new') {
          if (!(s === 'new' && isRecentSubmission(a.submittedAt))) return false;
        } else if (s !== filterStatus) {
          return false;
        }
      }
      if (filterStores.size > 0) {
        const hasUnknown = filterStores.has('unknown');
        const labelMatch = a.storeLabels.some((l) => filterStores.has(l));
        const unknownMatch = hasUnknown && a.storeLabels.length === 0;
        if (!labelMatch && !unknownMatch) return false;
      }
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
  }, [data, query, filterStatus, filterStores, statuses, sortKey, ratings]);

  const counts = useMemo(() => {
    if (!data) return { all: 0, new: 0, shortlist: 0, reject: 0, hired: 0 };
    const c = { all: data.applicants.length, new: 0, shortlist: 0, reject: 0, hired: 0 };
    for (const a of data.applicants) {
      const s = statuses[a.id] ?? 'new';
      if (s === 'new') {
        if (isRecentSubmission(a.submittedAt)) c.new++;
      } else {
        c[s]++;
      }
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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <div style={{
            display: 'inline-flex', borderRadius: 999, padding: 3,
            background: '#f3f3f3', border: '1px solid rgba(0,0,0,0.06)',
          }}>
            <button
              onClick={() => setViewMode('grid')}
              style={{
                padding: '5px 12px', borderRadius: 999, border: 0, cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: viewMode === 'grid' ? '#1a1a1a' : 'transparent',
                color: viewMode === 'grid' ? '#fff' : 'rgba(0,0,0,0.55)',
              }}
            >Grid</button>
            <button
              onClick={() => setViewMode('swipe')}
              style={{
                padding: '5px 12px', borderRadius: 999, border: 0, cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: viewMode === 'swipe' ? '#1a1a1a' : 'transparent',
                color: viewMode === 'swipe' ? '#fff' : 'rgba(0,0,0,0.55)',
              }}
            >Swipe</button>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={fetchData}
            disabled={loading}
          >{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
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

          {/* Per-store filter — multi-select. Click multiple to union
              (an applicant who picked any of the selected stores is
              included). "All stores" clears the selection. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            flexWrap: 'wrap', marginBottom: 16,
          }}>
            <button
              onClick={() => setFilterStores(new Set())}
              style={{
                padding: '5px 12px', borderRadius: 999,
                border: filterStores.size === 0 ? '1px solid #1a1a1a' : '1px solid #ddd',
                background: filterStores.size === 0 ? '#1a1a1a' : '#fff',
                color: filterStores.size === 0 ? '#fff' : '#444',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              All stores
              <span style={{ marginLeft: 6, opacity: 0.6 }}>{data.applicants.length}</span>
            </button>
            {(['G1', 'G2', 'G3', 'G4', 'unknown'] as const).map((store) => {
              const active = filterStores.has(store);
              const color = store !== 'unknown' ? STORE_COLORS[store] : '#888';
              const label =
                store === 'unknown' ? 'No store' : `${store} · ${STORE_CITIES[store]}`;
              const count =
                store === 'unknown'
                  ? data.applicants.filter((a) => a.storeLabels.length === 0).length
                  : data.applicants.filter((a) => a.storeLabels.includes(store)).length;
              return (
                <button
                  key={store}
                  onClick={() => setFilterStores((prev) => {
                    const next = new Set(prev);
                    if (next.has(store)) next.delete(store);
                    else next.add(store);
                    return next;
                  })}
                  style={{
                    padding: '5px 12px', borderRadius: 999,
                    border: active ? `1px solid ${color}` : '1px solid #ddd',
                    background: active ? color : '#fff',
                    color: active ? '#fff' : '#444',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {label}
                  <span style={{ marginLeft: 6, opacity: 0.6 }}>{count}</span>
                </button>
              );
            })}
            {filterStores.size > 1 && (
              <span style={{ fontSize: 11, color: '#888' }}>
                Showing applicants who picked any of {filterStores.size} selected
              </span>
            )}
          </div>

          {/* Cards or swipe deck */}
          {viewMode === 'grid' ? (
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
          ) : (
            <SwipeDeck
              applicants={filtered}
              statuses={statuses}
              ratings={ratings}
              onStatus={setStatus}
              onRating={setRating}
              onOpen={setOpenId}
            />
          )}

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
  // "New" is the default for unprocessed applicants, but showing it on every
  // card is noise. Only display the pill when (a) the user has explicitly
  // moved the card to a non-new status, or (b) the application is fresh
  // (last week). Truly new + recent gets a brighter accent.
  const recent = isRecentSubmission(a.submittedAt);
  const showPill = status !== 'new' || recent;
  const pillStyle =
    status === 'new' && recent
      ? { bg: '#dcefff', fg: '#1a5db4' } // fresh "New"
      : sc;
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
        {showPill && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 8px',
            borderRadius: 999, background: pillStyle.bg, color: pillStyle.fg,
            flexShrink: 0,
          }}>{STATUS_LABELS[status]}</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {a.storeLabels.length > 0
          ? a.storeLabels.map((label) => (
              <span
                key={label}
                title={STORE_CITIES[label] ?? label}
                style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 6px',
                  borderRadius: 4, color: '#fff',
                  background: STORE_COLORS[label] ?? '#888',
                  letterSpacing: 0.5,
                }}
              >{label}</span>
            ))
          : a.storeText
          ? (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px',
                borderRadius: 4, color: '#555', background: '#eee',
                letterSpacing: 0.3,
              }} title={a.storeText}>{a.storeText.slice(0, 24)}{a.storeText.length > 24 ? '…' : ''}</span>
          )
          : null}
        {a.submittedAt && (
          <span style={{ fontSize: 11, color: '#aaa', marginLeft: 2 }}>
            {a.submittedAt}
          </span>
        )}
      </div>

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
  // Esc closes the full-screen view
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // HEAD-probe the resume so we can render an inline error if Drive returns
  // 4xx/5xx instead of letting the iframe show raw JSON.
  const [resumeStatus, setResumeStatus] = useState<'loading' | 'ok' | 'fail'>('loading');
  const [resumeErr, setResumeErr] = useState<string | null>(null);
  useEffect(() => {
    if (!a.resumeFileId) return;
    let cancelled = false;
    setResumeStatus('loading');
    setResumeErr(null);
    // GET with Range: bytes=0-0 — tiny probe that won't actually download
    // the file, but Drive returns the real status code.
    fetch(`/api/applicants/resume/${a.resumeFileId}`, {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
    })
      .then(async (r) => {
        if (cancelled) return;
        if (r.ok || r.status === 206) {
          setResumeStatus('ok');
          return;
        }
        let msg = `HTTP ${r.status}`;
        try {
          const j = await r.json();
          msg = j.message || j.error || msg;
        } catch { /* leave default */ }
        setResumeErr(msg);
        setResumeStatus('fail');
      })
      .catch((e) => {
        if (cancelled) return;
        setResumeErr(String(e));
        setResumeStatus('fail');
      });
    return () => { cancelled = true; };
  }, [a.resumeFileId]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: '#fff',
        zIndex: 50, display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Sticky top bar with Back */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 1,
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(0,0,0,0.08)',
        padding: '10px 20px',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <button
          onClick={onClose}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 12px', borderRadius: 8,
            border: '1px solid #ddd', background: '#fff',
            cursor: 'pointer', fontSize: 13, fontWeight: 600,
            color: '#1a1a1a',
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>‹</span>
          Back to applicants
        </button>
        <div style={{
          flex: 1, fontSize: 13, color: '#888',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {a.name ?? '(no name)'}
          {a.email ? ` · ${a.email}` : ''}
        </div>
        <span style={{ fontSize: 11, color: '#bbb' }}>Esc</span>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '24px max(20px, calc((100vw - 1100px) / 2))',
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          marginBottom: 20, paddingBottom: 16,
          borderBottom: '1px solid #eee',
        }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>
              {a.name ?? '(no name)'}
            </h2>
            <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
              {a.email}{a.email && a.phone ? ' · ' : ''}{a.phone}
              {a.submittedAt && ` · submitted ${a.submittedAt}`}
            </div>
          </div>
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
              <div style={{ display: 'flex', gap: 12 }}>
                {a.resumeUrl && (
                  <a
                    href={a.resumeUrl}
                    target="_blank" rel="noreferrer"
                    style={{ fontSize: 12, color: '#2563eb' }}
                  >Open in Drive ↗</a>
                )}
                {resumeStatus === 'ok' && (
                  <a
                    href={`/api/applicants/resume/${a.resumeFileId}`}
                    target="_blank" rel="noreferrer"
                    style={{ fontSize: 12, color: '#2563eb' }}
                  >Open in new tab ↗</a>
                )}
              </div>
            </div>
            {resumeStatus === 'loading' && (
              <div style={{
                padding: '24px', textAlign: 'center',
                background: '#fafafa', borderRadius: 8,
                border: '1px solid #eee', color: '#888', fontSize: 13,
              }}>Loading resume…</div>
            )}
            {resumeStatus === 'fail' && (
              <div style={{
                padding: '16px 20px', background: '#fffbe6',
                border: '1px solid #f0d97b', borderRadius: 8,
                color: '#6b5500', fontSize: 13, lineHeight: 1.5,
              }}>
                <strong>Couldn't load this resume.</strong>{' '}
                {/^File not found|insufficient.*scope/i.test(resumeErr ?? '')
                  ? "Sign out and back in — Google needs to grant the dashboard a broader Drive read permission so it can fetch applicant uploads."
                  : (resumeErr ?? 'Unknown error.')}
                {' '}
                {a.resumeUrl && (
                  <a
                    href={a.resumeUrl}
                    target="_blank" rel="noreferrer"
                    style={{ color: '#2563eb', marginLeft: 4 }}
                  >Open in Drive instead ↗</a>
                )}
              </div>
            )}
            {resumeStatus === 'ok' && (
              <iframe
                src={`/api/applicants/resume/${a.resumeFileId}`}
                style={{
                  width: '100%', height: 'calc(100vh - 320px)',
                  minHeight: 600,
                  border: '1px solid #eee', borderRadius: 8,
                }}
                title="Resume"
              />
            )}
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

// ── Tinder-style swipe deck ─────────────────────────────────────────────
// Right-swipe → Shortlist · Left-swipe → Reject · Down-swipe → Skip.
// Buttons under the card mirror the gestures for desktop / accessibility.
// The deck shows the top 3 cards stacked so you get visual depth while
// flicking through them.
function SwipeDeck({
  applicants, statuses, ratings, onStatus, onRating, onOpen,
}: {
  applicants: Applicant[];
  statuses: Record<string, Status>;
  ratings: Record<string, number>;
  onStatus: (id: string, s: Status) => void;
  onRating: (id: string, n: number) => void;
  onOpen: (id: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [exiting, setExiting] = useState<null | { dx: number; dy: number; rot: number }>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Reset index when filtered list changes (e.g., filter pills clicked)
  useEffect(() => { setIndex(0); }, [applicants.length]);

  // Keyboard shortcuts — arrows for swipe direction
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') swipe('right');
      else if (e.key === 'ArrowLeft') swipe('left');
      else if (e.key === 'ArrowDown') swipe('down');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const current = applicants[index];
  const next1 = applicants[index + 1];
  const next2 = applicants[index + 2];

  if (!current) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
            All caught up
          </div>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
            You've reviewed every applicant matching the current filter.
          </div>
          <button
            onClick={() => setIndex(0)}
            className="btn btn-secondary btn-sm"
          >Start over</button>
        </div>
      </Card>
    );
  }

  const finishSwipe = (action: 'shortlist' | 'reject' | 'skip') => {
    if (action === 'shortlist') onStatus(current.id, 'shortlist');
    else if (action === 'reject') onStatus(current.id, 'reject');
    // skip: leave status alone
    setDrag({ x: 0, y: 0 });
    setExiting(null);
    setIndex((i) => i + 1);
  };

  const swipe = (dir: 'right' | 'left' | 'down') => {
    const off = window.innerWidth + 200;
    if (dir === 'right') {
      setExiting({ dx: off, dy: 0, rot: 25 });
      setTimeout(() => finishSwipe('shortlist'), 220);
    } else if (dir === 'left') {
      setExiting({ dx: -off, dy: 0, rot: -25 });
      setTimeout(() => finishSwipe('reject'), 220);
    } else {
      setExiting({ dx: 0, dy: window.innerHeight, rot: 0 });
      setTimeout(() => finishSwipe('skip'), 220);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (exiting) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!startRef.current || exiting) return;
    setDrag({ x: e.clientX - startRef.current.x, y: e.clientY - startRef.current.y });
  };
  const onPointerUp = () => {
    if (!startRef.current || exiting) return;
    startRef.current = null;
    const { x, y } = drag;
    const THRESH = 110;
    if (x > THRESH) swipe('right');
    else if (x < -THRESH) swipe('left');
    else if (y > THRESH) swipe('down');
    else setDrag({ x: 0, y: 0 });
  };

  const transform = exiting
    ? `translate(${exiting.dx}px, ${exiting.dy}px) rotate(${exiting.rot}deg)`
    : `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x * 0.04}deg)`;

  const rightTint = Math.max(0, Math.min(1, drag.x / 150));
  const leftTint = Math.max(0, Math.min(1, -drag.x / 150));

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 18, paddingTop: 4,
    }}>
      <div style={{ fontSize: 12, color: '#888' }}>
        Card {index + 1} of {applicants.length}
      </div>

      <div style={{ position: 'relative', width: '100%', maxWidth: 560, minHeight: 540 }}>
        {next2 && (
          <CardShell
            key={next2.id + '-back'}
            scale={0.92}
            offsetY={20}
            opacity={0.5}
          >
            <CardSummary applicant={next2} muted />
          </CardShell>
        )}
        {next1 && (
          <CardShell
            key={next1.id + '-mid'}
            scale={0.96}
            offsetY={10}
            opacity={0.8}
          >
            <CardSummary applicant={next1} muted />
          </CardShell>
        )}
        <div
          ref={cardRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            position: 'relative',
            background: '#fff',
            borderRadius: 16,
            border: '1px solid rgba(0,0,0,0.08)',
            boxShadow: '0 10px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.04)',
            padding: 24,
            transform,
            transition: startRef.current || exiting ? 'none' : 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            touchAction: 'none',
            cursor: 'grab',
            userSelect: 'none',
            minHeight: 540,
          }}
        >
          {/* Tint overlays for visual swipe affordance */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 16,
            background: '#1f8a3b', opacity: rightTint * 0.18,
            pointerEvents: 'none', transition: 'opacity 0.1s',
          }} />
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 16,
            background: '#c0392b', opacity: leftTint * 0.18,
            pointerEvents: 'none', transition: 'opacity 0.1s',
          }} />
          {/* Decision labels */}
          {drag.x > 40 && (
            <div style={{
              position: 'absolute', top: 28, left: 28,
              padding: '6px 14px', border: '3px solid #1f8a3b',
              color: '#1f8a3b', fontWeight: 800, fontSize: 18,
              borderRadius: 8, transform: 'rotate(-12deg)',
              letterSpacing: 1, pointerEvents: 'none',
              opacity: rightTint,
            }}>SHORTLIST</div>
          )}
          {drag.x < -40 && (
            <div style={{
              position: 'absolute', top: 28, right: 28,
              padding: '6px 14px', border: '3px solid #c0392b',
              color: '#c0392b', fontWeight: 800, fontSize: 18,
              borderRadius: 8, transform: 'rotate(12deg)',
              letterSpacing: 1, pointerEvents: 'none',
              opacity: leftTint,
            }}>REJECT</div>
          )}
          <CardFullContent
            applicant={current}
            rating={ratings[current.id] ?? 0}
            onRating={(n) => onRating(current.id, n)}
            onOpen={() => onOpen(current.id)}
          />
        </div>
      </div>

      {/* Action buttons under the deck */}
      <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
        <SwipeActionBtn label="Reject" sub="←" color="#c0392b" onClick={() => swipe('left')} />
        <SwipeActionBtn label="Skip" sub="↓" color="#888" onClick={() => swipe('down')} />
        <SwipeActionBtn label="Shortlist" sub="→" color="#1f8a3b" onClick={() => swipe('right')} />
      </div>
      <div style={{ fontSize: 11, color: '#aaa' }}>
        Drag the card or use ← / ↓ / → arrow keys
      </div>
    </div>
  );
}

function CardShell({ children, scale, offsetY, opacity }: {
  children: React.ReactNode; scale: number; offsetY: number; opacity: number;
}) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      transform: `translateY(${offsetY}px) scale(${scale})`,
      transformOrigin: 'top center',
      background: '#fff',
      borderRadius: 16,
      border: '1px solid rgba(0,0,0,0.06)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
      padding: 24,
      opacity,
      pointerEvents: 'none',
    }}>{children}</div>
  );
}

function CardSummary({ applicant: a, muted }: { applicant: Applicant; muted?: boolean }) {
  return (
    <div style={{ opacity: muted ? 0.7 : 1 }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{a.name ?? '(no name)'}</div>
      {(a.email || a.phone) && (
        <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
          {a.email}{a.email && a.phone ? ' · ' : ''}{a.phone}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 10, flexWrap: 'wrap' }}>
        {a.storeLabels.map((label) => (
          <span key={label} style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px',
            borderRadius: 4, color: '#fff',
            background: STORE_COLORS[label] ?? '#888',
            letterSpacing: 0.5,
          }}>{label}</span>
        ))}
      </div>
    </div>
  );
}

/** Pick a small subset of likely-most-relevant fields to highlight in
 *  the top section, then dump the rest in a scrollable lower area so
 *  the reviewer can read everything without leaving the card. */
function CardFullContent({
  applicant: a, rating, onRating, onOpen,
}: {
  applicant: Applicant;
  rating: number;
  onRating: (n: number) => void;
  onOpen: () => void;
}) {
  // Pull just the qualitative answer fields onto the card. Everything else
  // (name parts, contact info, location checkboxes — all already shown
  // elsewhere) stays in the full-view drawer.
  const HIGHLIGHT_PATTERNS = [
    /availability/i, /experience/i, /previous/i,
    /why/i, /tell us about/i, /interest/i, /strength/i,
  ];
  const highlights = Object.entries(a.fields).filter(
    ([k, v]) => v && v.length > 0 && HIGHLIGHT_PATTERNS.some((p) => p.test(k)),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, height: '100%' }}>
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>
          {a.name ?? '(no name)'}
        </div>
        {(a.email || a.phone) && (
          <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
            {a.email}{a.email && a.phone ? ' · ' : ''}{a.phone}
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {a.storeLabels.map((label) => (
            <span key={label} style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px',
              borderRadius: 4, color: '#fff',
              background: STORE_COLORS[label] ?? '#888',
              letterSpacing: 0.5,
            }}>{label} · {STORE_CITIES[label] ?? ''}</span>
          ))}
          {a.submittedAt && (
            <span style={{ fontSize: 11, color: '#aaa', marginLeft: 4 }}>{a.submittedAt}</span>
          )}
        </div>
      </div>

      {/* Star rating */}
      <div style={{ display: 'flex', gap: 4 }} onPointerDown={(e) => e.stopPropagation()}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onRating(n === rating ? 0 : n)}
            style={{
              border: 0, background: 'transparent', cursor: 'pointer',
              padding: 2, color: n <= rating ? '#f5b400' : '#ddd',
              fontSize: 20, lineHeight: 1,
            }}
          >★</button>
        ))}
      </div>

      {/* Highlights — the only fields shown on the card itself. Rest
          available via "Open full view". */}
      {highlights.length > 0 && (
        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: 12,
            flex: 1, overflowY: 'auto', minHeight: 0,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {highlights.map(([k, v]) => (
            <div key={k}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.55)',
                textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4,
              }}>{k}</div>
              <div style={{ fontSize: 13, color: '#1a1a1a', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {v}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Resume link + open full view */}
      <div style={{
        display: 'flex', gap: 10, justifyContent: 'space-between',
        alignItems: 'center', marginTop: 'auto', paddingTop: 8,
        borderTop: '1px solid rgba(0,0,0,0.06)',
      }} onPointerDown={(e) => e.stopPropagation()}>
        {a.resumeFileId ? (
          <a
            href={`/api/applicants/resume/${a.resumeFileId}`}
            target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: '#2563eb' }}
          >📄 Open resume ↗</a>
        ) : <span style={{ fontSize: 12, color: '#bbb' }}>No resume attached</span>}
        <button
          onClick={onOpen}
          style={{
            padding: '6px 12px', borderRadius: 8,
            border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >Open full view</button>
      </div>
    </div>
  );
}

function SwipeActionBtn({ label, sub, color, onClick }: {
  label: string; sub: string; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 92, padding: '10px 0', borderRadius: 12, cursor: 'pointer',
        border: `1px solid ${color}`, background: '#fff', color,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        fontFamily: 'inherit',
      }}
    >
      <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1 }}>{sub}</span>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {label}
      </span>
    </button>
  );
}
