import { useEffect, useMemo, useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

// ── Types (mirror server/dripos.ts ReportData) ───────────────────────────
interface StoreRow {
  label: string;
  locationId: number;
  grossSales: number;
  ticketCount: number;
  averageTicket: number;
  byPlatform: Record<string, number>;
  wowPct: number | null;
  yoyPct: number | null;
}
interface ItemSalesRow {
  name: string;
  logo?: string | null;
  unitsByStore: Record<string, number>;
  totalUnits: number;
  avgPerStore: number;
  totalRevenueCents: number;
}
interface LaborRow {
  label: string;
  locationId: number;
  laborCents: number;
  hourlyCents: number;
  salariedCents: number;
  grossSalesCents: number;
  laborPct: number | null;
}
interface TrendPoint {
  label: string;
  weekNum: number;
  year: number;
  total: number;
  perStore: Record<string, number>;
}
interface ReportData {
  generatedAt: string;
  currentWeek: { label: string; weekNum: number; year: number; sun: string; sat: string };
  prevWeek: { label: string };
  yoyWeek: { label: string };
  totals: {
    current: number; prev: number; yoy: number;
    wowPct: number | null; yoyPct: number | null;
    ticketsCurrent: number; ticketsPrev: number; ticketsDelta: number;
    avgTicketCurrent: number; avgTicketPrev: number; avgTicketDelta: number;
  };
  stores: StoreRow[];
  platformTotals: Record<string, number>;
  trend: TrendPoint[];
  bakeHausItemSales: ItemSalesRow[];
  topDrinks: ItemSalesRow[];
  laborByStore: LaborRow[];
  laborTotals: { laborCents: number; hourlyCents: number; salariedCents: number; grossSalesCents: number; laborPct: number | null };
  platformSalesByStore: PlatformSalesRow[];
  platformSalesTotals: PlatformSalesRow;
  pennyRounding?: {
    diffCents: number;
    storeSumCents: number;
    chainGrossCents: number;
    available: boolean;
  };
  weekOverride?: {
    sun: string;
    reason: string;
    forcedGrossCents: number;
    forcedTickets: number;
  } | null;
}
interface PlatformSalesRow {
  label: string;
  mobileCents: number;
  webCents: number;
  thirdCents: number;
  posCents: number;
  otherCents: number;
  totalCents: number;
  nonPosCents: number;
  nonPosPct: number | null;
}

const STORE_COLORS: Record<string, string> = {
  G1: '#2c5f8d', G2: '#c97a3f', G3: '#5a9a4a', G4: '#a04ea0',
};

function fmtMoney(cents: number | null | undefined) {
  if (cents == null) return '—';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtPct(p: number | null | undefined, signed = true) {
  if (p == null) return '—';
  return `${signed && p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}
function pctClass(p: number | null | undefined): 'up' | 'down' | 'flat' {
  if (p == null) return 'flat';
  if (p > 0.5) return 'up';
  if (p < -0.5) return 'down';
  return 'flat';
}
function pctColor(p: number | null | undefined) {
  const c = pctClass(p);
  return c === 'up' ? '#1f8a3b' : c === 'down' ? '#c0392b' : '#666';
}

// ── Login modal ──────────────────────────────────────────────────────────
function LoginModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'phone' | 'code' | 'paste'>('phone');
  const [phone, setPhone] = useState('');
  const [unique, setUnique] = useState('');
  const [code, setCode] = useState('');
  const [pasteToken, setPasteToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitPaste = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/dripos/set-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: pasteToken.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || 'Token rejected');
      onClose();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const submitPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/dripos/login/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || 'Failed to send SMS');
      setUnique(j.unique);
      setStep('code');
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/dripos/login/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, unique, phone }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || 'Code rejected');
      // Sanity-check: confirm the new token actually opens /dripos/report
      // before closing. If the report still 401s, surface that here instead
      // of silently popping the modal back to step 1.
      const probe = await fetch('/api/dripos/report');
      if (probe.status === 401) {
        const pj = await probe.json().catch(() => ({}));
        throw new Error(
          pj.message ||
          'Code accepted, but the new token can\'t read sales reports. Try again — if it keeps failing, contact Ben.'
        );
      }
      onClose();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16,
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: '28px 32px', width: 380, maxWidth: '100%',
        boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
      }}>
        <div style={{ fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' }}>
          {step === 'paste' ? 'Manual token' : `Step ${step === 'code' ? '2' : '1'} of 2`}
        </div>
        <h2 style={{ margin: '4px 0 6px', fontSize: 20 }}>Sign in to Dripos</h2>
        <p style={{ margin: '0 0 20px', color: '#666', fontSize: 13, lineHeight: 1.4 }}>
          {step === 'code' && 'Enter the 6-digit code we just texted you.'}
          {step === 'phone' && 'Enter the phone number associated with your Dripos account. We\'ll send a one-time code by SMS.'}
          {step === 'paste' && (
            <>Paste the <code>authentication</code> header value from a logged-in <code>dashboard.dripos.com</code> tab (DevTools → Network → any <code>api.dripos.com</code> call → Headers).</>
          )}
        </p>

        {step === 'phone' && (
          <form onSubmit={submitPhone}>
            <label style={labelStyle}>Phone number</label>
            <input
              type="tel" autoFocus required style={inputStyle}
              value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="+15551234567" disabled={loading}
            />
            <button type="submit" style={primaryBtn} disabled={loading || !phone.trim()}>
              {loading ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}
        {step === 'code' && (
          <form onSubmit={submitCode}>
            <label style={labelStyle}>Verification code</label>
            <input
              type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
              autoFocus required style={inputStyle}
              value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="123456" disabled={loading}
            />
            <button type="submit" style={primaryBtn} disabled={loading || code.length < 4}>
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button" style={secondaryBtn}
              onClick={() => { setStep('phone'); setCode(''); setError(null); }}
              disabled={loading}
            >← Back to phone entry</button>
          </form>
        )}
        {step === 'paste' && (
          <form onSubmit={submitPaste}>
            <label style={labelStyle}>Session token</label>
            <input
              type="text" autoFocus required style={inputStyle}
              value={pasteToken} onChange={(e) => setPasteToken(e.target.value)}
              placeholder="qbR8Y8YaAtmQOEHapaOLSizR1xM4zxdX"
              disabled={loading}
            />
            <button type="submit" style={primaryBtn} disabled={loading || pasteToken.trim().length < 10}>
              {loading ? 'Saving…' : 'Save token'}
            </button>
            <button
              type="button" style={secondaryBtn}
              onClick={() => { setStep('phone'); setPasteToken(''); setError(null); }}
              disabled={loading}
            >← Back to SMS sign-in</button>
          </form>
        )}

        {error && (
          <div style={{
            marginTop: 14, padding: '8px 12px',
            background: '#fce8e6', color: '#c0392b',
            borderRadius: 6, fontSize: 13,
          }}>{error}</div>
        )}

        <button
          onClick={onClose}
          style={{ ...secondaryBtn, marginTop: 14, color: '#888' }}
        >Cancel</button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', marginTop: 4, marginBottom: 6,
  fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666', fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 12px', fontSize: 16,
  border: '1px solid #d4d4d4', borderRadius: 6, background: '#fafafa',
  boxSizing: 'border-box',
};
const primaryBtn: React.CSSProperties = {
  width: '100%', marginTop: 14, padding: 12, fontSize: 15, fontWeight: 600,
  border: 0, borderRadius: 6, background: '#1a1a1a', color: '#fff', cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  width: '100%', marginTop: 6, padding: 10, fontSize: 13,
  border: 0, borderRadius: 6, background: 'transparent', color: '#666', cursor: 'pointer',
};

// ── Inline SVG line chart ────────────────────────────────────────────────
function TrendChart({ trend, isMobile }: { trend: TrendPoint[]; isMobile?: boolean }) {
  const W = 760;
  const H = 260;
  const PAD = { top: 24, right: 16, bottom: 36, left: 60 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const totals = trend.map((t) => t.total);
  const yMax = Math.max(...totals, 1) * 1.10;
  const yMin = Math.min(...totals) * 0.88;
  const xStep = trend.length > 1 ? innerW / (trend.length - 1) : innerW;

  const x = (i: number) => PAD.left + i * xStep;
  const y = (v: number) => PAD.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const totalPath = trend.map((t, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(t.total)}`).join(' ');
  // Filled area path under the total line — gradient fill
  const areaPath = `${totalPath} L ${x(trend.length - 1)} ${PAD.top + innerH} L ${x(0)} ${PAD.top + innerH} Z`;

  // Per-store dashed lines
  const storeLines = ['G1', 'G2', 'G3', 'G4'].map((label) => {
    const points = trend.map((t) => t.perStore[label] ?? 0);
    const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ');
    return { label, path, color: STORE_COLORS[label] };
  });

  // Y-axis ticks (3 evenly-spaced)
  const yTicks = [yMin, (yMin + yMax) / 2, yMax];

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, minWidth: isMobile ? 0 : 600 }}>
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a1a1a" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#1a1a1a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid + y labels */}
        {yTicks.map((tv, i) => (
          <g key={i}>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={y(tv)} y2={y(tv)}
              stroke="#eee" strokeWidth="1"
            />
            <text
              x={PAD.left - 8} y={y(tv) + 4}
              fontSize="11" fill="#bbb" textAnchor="end"
            >${(tv / 100 / 1000).toFixed(0)}k</text>
          </g>
        ))}

        {/* X-axis labels */}
        {trend.map((t, i) => (
          <text
            key={i} x={x(i)} y={H - 10}
            fontSize="11" fill="#999" textAnchor="middle"
          >{t.label}</text>
        ))}

        {/* Filled area under total */}
        <path d={areaPath} fill="url(#trendGrad)" />

        {/* Per-store dashed lines */}
        {storeLines.map((s) => (
          <path key={s.label} d={s.path} fill="none" stroke={s.color} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.55" />
        ))}

        {/* Total line */}
        <path d={totalPath} fill="none" stroke="#1a1a1a" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* Total points + value labels */}
        {trend.map((t, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(t.total)} r="4" fill="#fff" stroke="#1a1a1a" strokeWidth="2" />
            <text
              x={x(i)} y={y(t.total) - 11}
              fontSize="11" fill="#1a1a1a" textAnchor="middle" fontWeight="700"
            >${(t.total / 100 / 1000).toFixed(1)}k</text>
          </g>
        ))}
      </svg>

      <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <Legend label="TOTAL" color="#1a1a1a" />
        {Object.entries(STORE_COLORS).map(([k, c]) => (
          <Legend key={k} label={k} color={c} dashed />
        ))}
      </div>
    </div>
  );
}

function Legend({ label, color, dashed = false }: { label: string; color: string; dashed?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#666' }}>
      <div style={{
        width: 18, height: 2, background: dashed ? `repeating-linear-gradient(to right, ${color} 0 4px, transparent 4px 7px)` : color,
        opacity: dashed ? 0.7 : 1,
      }} />
      {label}
    </div>
  );
}

// ── Top items pie chart ─────────────────────────────────────────────────
// 5 distinct hues for the top 5 items; everything else folds into a grey
// "Other" slice. Picked to print well and stay distinguishable on small
// favicon-sized renders.
const TOP_ITEM_COLORS = ['#1a1a1a', '#2c5f8d', '#c97a3f', '#5a9a4a', '#a04ea0'];
const OTHER_COLOR = '#bbb';

function TopItemsPieChart({
  items,
  topN = 5,
}: {
  items: ItemSalesRow[];
  topN?: number;
}) {
  // items are pre-sorted by revenue (descending) by the server.
  const sorted = [...items].filter((i) => i.totalRevenueCents > 0);
  if (sorted.length === 0) return null;

  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const restTotal = rest.reduce((a, b) => a + b.totalRevenueCents, 0);

  const segments = [
    ...top.map((it, i) => ({
      label: it.name,
      value: it.totalRevenueCents,
      units: it.totalUnits,
      color: TOP_ITEM_COLORS[i % TOP_ITEM_COLORS.length],
    })),
    ...(restTotal > 0
      ? [{
          label: `Other (${rest.length} items)`,
          value: restTotal,
          units: rest.reduce((a, b) => a + b.totalUnits, 0),
          color: OTHER_COLOR,
        }]
      : []),
  ];

  const total = segments.reduce((a, b) => a + b.value, 0);
  const cx = 110;
  const cy = 110;
  const r = 90;
  const innerR = 56;

  let cursor = -Math.PI / 2;
  const slices = segments.map((s) => {
    const angle = (s.value / total) * Math.PI * 2;
    const start = cursor;
    const end = cursor + angle;
    cursor = end;
    const large = angle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const xi1 = cx + innerR * Math.cos(start);
    const yi1 = cy + innerR * Math.sin(start);
    const xi2 = cx + innerR * Math.cos(end);
    const yi2 = cy + innerR * Math.sin(end);
    const d =
      `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} ` +
      `L ${xi2} ${yi2} A ${innerR} ${innerR} 0 ${large} 0 ${xi1} ${yi1} Z`;
    const midAngle = (start + end) / 2;
    const labelR = (r + innerR) / 2;
    return {
      ...s,
      d,
      pct: (s.value / total) * 100,
      labelX: cx + labelR * Math.cos(midAngle),
      labelY: cy + labelR * Math.sin(midAngle),
    };
  });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 28,
      flexWrap: 'wrap', justifyContent: 'center',
      marginBottom: 18, paddingBottom: 14,
      borderBottom: '1px solid #eee',
    }}>
      <svg viewBox="0 0 220 220" style={{ width: 220, height: 220, flexShrink: 0 }}>
        {slices.map((s) => (
          <g key={s.label}>
            <path d={s.d} fill={s.color} stroke="#fff" strokeWidth="2" />
            {s.pct >= 8 && (
              <text
                x={s.labelX} y={s.labelY}
                fontSize="12" fontWeight="700" fill="#fff"
                textAnchor="middle" dominantBaseline="central"
              >{s.pct.toFixed(0)}%</text>
            )}
          </g>
        ))}
        <text x={cx} y={cy - 8} fontSize="10" fill="#888" textAnchor="middle" fontWeight="600"
              letterSpacing="1" style={{ textTransform: 'uppercase' }}>Top {topN}</text>
        <text x={cx} y={cy + 12} fontSize="15" fontWeight="700" fill="#1a1a1a" textAnchor="middle">
          {fmtMoney(total)}
        </text>
      </svg>
      <div style={{ minWidth: 220, flex: 1, maxWidth: 360 }}>
        {slices.map((s) => (
          <div key={s.label} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '6px 0', fontSize: 13,
            borderBottom: '1px solid #f4f4f4',
          }}>
            <div style={{
              width: 12, height: 12, borderRadius: 3,
              background: s.color, flexShrink: 0,
            }} />
            <div style={{
              flex: 1, fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }} title={s.label}>{s.label}</div>
            <div style={{
              color: '#888', fontSize: 11, fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}>
              {s.units} units
            </div>
            <div style={{
              minWidth: 64, textAlign: 'right',
              color: '#666', fontSize: 12, fontVariantNumeric: 'tabular-nums',
            }}>
              {fmtMoney(s.value)}
            </div>
            <div style={{
              minWidth: 44, textAlign: 'right',
              color: '#888', fontSize: 12, fontVariantNumeric: 'tabular-nums',
            }}>
              {s.pct.toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Reusable Card ───────────────────────────────────────────────────────
function Card({ title, subtitle, children }: { title?: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="dripos-card" style={{
      background: '#fff', borderRadius: 10,
      border: '1px solid rgba(0,0,0,0.07)', padding: '18px 22px',
      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
    }}>
      {title && (
        <h2 style={{
          margin: 0, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1,
          color: '#888', fontWeight: 600, marginBottom: subtitle ? 4 : 14,
        }}>{title}</h2>
      )}
      {subtitle && (
        <p style={{ margin: '0 0 12px', color: '#999', fontSize: 12 }}>{subtitle}</p>
      )}
      {children}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────
export default function WeeklySales() {
  const isMobile = useIsMobile();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);

  const fetchReport = async (refresh = false, offset = weekOffset) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (refresh) {
        params.set('force', '1');
        params.set('_', String(Date.now()));
      }
      if (offset > 0) params.set('weekOffset', String(offset));
      const qs = params.toString();
      const url = '/api/dripos/report' + (qs ? `?${qs}` : '');
      const r = await fetch(url, { cache: 'no-store' });
      if (r.status === 401) {
        const j = await r.json().catch(() => ({}));
        if (j.error === 'dripos_auth_required') {
          setShowLogin(true);
          setError(null);
          return;
        }
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || 'Report failed');
      setData(j.report);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchReport(false, weekOffset);
  }, [weekOffset]);

  const weekOptions = useMemo(() => {
    const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    const today = new Date();
    // Anchor offset 0 on the most-recently-completed Sun-Sat — must match the
    // server's weekBounds() in server/dripos.ts, otherwise labels and data
    // disagree by a full week. `|| 7` keeps Saturday from anchoring on the
    // in-progress week (which has no completed sales yet).
    const daysSinceSat = ((today.getDay() + 1) % 7) || 7;
    const sun0 = new Date(today);
    sun0.setDate(today.getDate() - daysSinceSat - 6);
    const opts: Array<{ offset: number; label: string }> = [];
    for (let i = 0; i < 12; i++) {
      const sun = new Date(sun0);
      sun.setDate(sun0.getDate() - 7 * i);
      const sat = new Date(sun);
      sat.setDate(sun.getDate() + 6);
      const range = `${fmt(sun)}–${fmt(sat)}`;
      opts.push({ offset: i, label: i === 0 ? `Last week · ${range}` : range });
    }
    return opts;
  }, []);

  const onLoginClose = () => {
    setShowLogin(false);
    fetchReport(true);
  };

  const onLogout = async () => {
    if (!confirm('Sign out of Dripos? You\'ll need to re-enter your phone next time.')) return;
    await fetch('/api/dripos/logout', { method: 'POST' });
    setData(null);
    setShowLogin(true);
  };

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const onSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch('/api/dripos/sync-daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 60 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || 'Sync failed');
      const s = j.summary;
      setSyncMsg(`Synced ${s.rowsWritten} rows (${s.startDate} → ${s.endDate})${s.errors.length ? `, ${s.errors.length} errors` : ''}.`);
    } catch (err: any) {
      setSyncMsg(`Sync failed: ${err.message || err}`);
    } finally {
      setSyncing(false);
    }
  };

  const ticketsTotal = useMemo(() => {
    if (!data) return 0;
    return Object.values(data.platformTotals).reduce((a, b) => a + b, 0);
  }, [data]);

  return (
    <div>
      {/* Header strip */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'baseline',
        gap: isMobile ? 6 : 16,
        flexWrap: 'wrap',
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: isMobile ? 22 : 26, fontWeight: 700 }}>Dashboard</h1>
          {data && (
            <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setWeekOffset((o) => o + 1)}
                disabled={loading || refreshing}
                title="Previous week"
                style={{ padding: '2px 8px' }}
              >‹</button>
              <select
                value={weekOffset}
                onChange={(e) => setWeekOffset(parseInt(e.target.value, 10))}
                disabled={loading || refreshing}
                style={{
                  fontSize: 13,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid #ccc',
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                {weekOptions.map((o) => (
                  <option key={o.offset} value={o.offset}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setWeekOffset((o) => Math.max(0, o - 1))}
                disabled={weekOffset === 0 || loading || refreshing}
                title="Next week"
                style={{ padding: '2px 8px' }}
              >›</button>
              {weekOffset > 0 && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setWeekOffset(0)}
                  disabled={loading || refreshing}
                  style={{ marginLeft: 4 }}
                >Today</button>
              )}
            </div>
          )}
          {data && (
            <span className="print-only" style={{ fontSize: 13, color: '#888' }}>
              Week {data.currentWeek.weekNum} · {data.currentWeek.label}
            </span>
          )}
        </div>
        {data && (
          <>
            {!isMobile && (
              <span style={{ fontSize: 12, color: '#bbb', marginLeft: 'auto' }}>
                Updated {new Date(data.generatedAt).toLocaleString()}
              </span>
            )}
            <div style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              marginLeft: isMobile ? 0 : undefined,
            }}>
              <button
                className="btn btn-secondary btn-sm no-print"
                onClick={() => fetchReport(true)}
                disabled={refreshing}
                style={isMobile ? { flex: 1 } : undefined}
              >{refreshing ? 'Refreshing…' : 'Refresh'}</button>
              <button
                className="btn btn-secondary btn-sm no-print"
                onClick={onSync}
                disabled={syncing}
                title="Pulls the last 60 days of daily sales into germania.db so the Locations + Sales Anomaly tabs have data."
                style={isMobile ? { flex: 1 } : undefined}
              >{syncing ? 'Syncing…' : 'Sync 60d'}</button>
              <button
                className="btn btn-secondary btn-sm no-print"
                onClick={() => window.print()}
                title="Print or save as PDF (use the browser's print dialog → 'Save as PDF')."
                style={isMobile ? { flex: 1 } : undefined}
              >PDF</button>
              <button
                className="btn btn-secondary btn-sm no-print"
                onClick={onLogout}
                style={isMobile ? { flex: 1 } : undefined}
              >Sign out</button>
            </div>
            {isMobile && (
              <span style={{ fontSize: 11, color: '#bbb' }}>
                Updated {new Date(data.generatedAt).toLocaleString()}
              </span>
            )}
          </>
        )}
      </div>

      {syncMsg && (
        <div style={{
          padding: '8px 14px', borderRadius: 6, marginBottom: 12,
          background: syncMsg.startsWith('Sync failed') ? '#fce8e6' : '#e6f4ea',
          color: syncMsg.startsWith('Sync failed') ? '#c0392b' : '#1f8a3b',
          fontSize: 13,
        }}>{syncMsg}</div>
      )}

      {error && !showLogin && (
        <Card>
          <div style={{ color: '#c0392b' }}>
            <strong>Error:</strong> {error}{' '}
            <button onClick={() => fetchReport(true)} className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }}>
              Retry
            </button>
          </div>
        </Card>
      )}

      {!data && (loading || showLogin) && (
        <Card>
          <div style={{ color: '#888' }}>
            {showLogin ? 'Sign in to Dripos to load this report…' : 'Loading…'}
          </div>
        </Card>
      )}

      {data && (
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Hero KPIs — 2x2 on mobile (hero spans both cols),
              4-across on desktop. No wrapper div around the hero so
              all four tiles share the grid row's stretched height. */}
          <div style={{
            display: 'grid', gap: 12,
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
          }}>
            <KpiTile
              label="Gross sales"
              value={fmtMoney(data.totals.current)}
              delta={data.totals.wowPct}
              deltaLabel="vs prev wk"
              hero
              style={isMobile ? { gridColumn: 'span 2' } : undefined}
            />
            <KpiTile
              label="vs same wk last yr"
              value={fmtPct(data.totals.yoyPct)}
              valueColor={pctColor(data.totals.yoyPct)}
              sub={`${fmtMoney(data.totals.yoy)} last yr`}
            />
            <KpiTile
              label="Tickets"
              value={data.totals.ticketsCurrent.toLocaleString()}
              delta={data.totals.ticketsCurrent && data.totals.ticketsPrev
                ? ((data.totals.ticketsCurrent - data.totals.ticketsPrev) / data.totals.ticketsPrev) * 100
                : null}
              deltaLabel="vs prev wk"
              sub={`${data.totals.ticketsDelta >= 0 ? '+' : ''}${data.totals.ticketsDelta} fm last week`}
            />
            <KpiTile
              label="Avg ticket"
              value={fmtMoney(data.totals.avgTicketCurrent)}
              sub={`${data.totals.avgTicketDelta >= 0 ? '+' : ''}$${(data.totals.avgTicketDelta / 100).toFixed(2)} fm last week`}
              subColor={pctColor(data.totals.avgTicketDelta)}
            />
          </div>

          {/* Manual override notice — replaces the penny-rounding card when
              this week's headline was forced to a Dripos-side value. */}
          {data.weekOverride && (
            <WeekOverrideCard ov={data.weekOverride} />
          )}
          {/* Penny rounding reconciliation — only shows when we got a chain
              gross from Dripos that's higher than our per-store sum AND no
              manual override is masking the diff for this week. */}
          {!data.weekOverride && data.pennyRounding?.available && data.pennyRounding.diffCents > 0 && (
            <PennyRoundingCard p={data.pennyRounding} />
          )}

          {/* Per-store visual tiles */}
          <div style={{
            display: 'grid', gap: 12,
            gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)',
          }}>
            {data.stores.map((s) => (
              <StoreTile key={s.label} store={s} chainTotal={data.totals.current} />
            ))}
          </div>

          {/* Trend chart */}
          <Card title={`Last ${data.trend.length} weeks`}>
            <TrendChart trend={data.trend} isMobile={isMobile} />
          </Card>

          {/* Per-store + Platform mix side by side on desktop */}
          <div className="stack-on-print" style={{ display: 'grid', gap: 16, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
            <Card title="Per-store week-over-week">
              <div className="dripos-scroll"><table className="dripos-table">
                <thead>
                  <tr><th>Store</th><th>Sales</th><th>vs prev</th><th>vs LY</th></tr>
                </thead>
                <tbody>
                  {data.stores.map((s) => (
                    <tr key={s.label}>
                      <td><strong>{s.label}</strong> <span style={chipStyle}>loc {s.locationId}</span></td>
                      <td>{fmtMoney(s.grossSales)}</td>
                      <td style={{ color: pctColor(s.wowPct) }}>{fmtPct(s.wowPct)}</td>
                      <td style={{ color: pctColor(s.yoyPct) }}>{fmtPct(s.yoyPct)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td>{fmtMoney(data.totals.current)}</td>
                    <td style={{ color: pctColor(data.totals.wowPct) }}>{fmtPct(data.totals.wowPct)}</td>
                    <td style={{ color: pctColor(data.totals.yoyPct) }}>{fmtPct(data.totals.yoyPct)}</td>
                  </tr>
                </tfoot>
              </table></div>
            </Card>

            <Card title="Platform sales · this week" subtitle="Product sales by platform per store (matches Dripos's Platform Sales report exactly for Mobile/Web/3rd Party). 'All' = Mobile + Web + 3rd Party. 'Total' is products only — excludes custom fees / cash rounding, so it reads a few cents under the headline Gross Sales.">
              <div className="dripos-scroll"><table className="dripos-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Store</th>
                    {!isMobile && <th>Mobile</th>}
                    {!isMobile && <th>Web</th>}
                    {!isMobile && <th>3rd Party</th>}
                    <th>All non-POS</th>
                    <th>Total</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {data.platformSalesByStore.map((row) => (
                    <tr key={row.label}>
                      <td style={{ textAlign: 'left' }}><strong>{row.label}</strong></td>
                      {!isMobile && <td>{fmtMoney(row.mobileCents)}</td>}
                      {!isMobile && <td>{fmtMoney(row.webCents)}</td>}
                      {!isMobile && <td>{fmtMoney(row.thirdCents)}</td>}
                      <td><strong>{fmtMoney(row.nonPosCents)}</strong></td>
                      <td>{fmtMoney(row.totalCents)}</td>
                      <td>{row.nonPosPct == null ? '—' : `${row.nonPosPct.toFixed(1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Chain</td>
                    {!isMobile && <td>{fmtMoney(data.platformSalesTotals.mobileCents)}</td>}
                    {!isMobile && <td>{fmtMoney(data.platformSalesTotals.webCents)}</td>}
                    {!isMobile && <td>{fmtMoney(data.platformSalesTotals.thirdCents)}</td>}
                    <td><strong>{fmtMoney(data.platformSalesTotals.nonPosCents)}</strong></td>
                    <td>{fmtMoney(data.platformSalesTotals.totalCents)}</td>
                    <td>
                      {data.platformSalesTotals.nonPosPct == null
                        ? '—'
                        : `${data.platformSalesTotals.nonPosPct.toFixed(1)}%`}
                    </td>
                  </tr>
                </tfoot>
              </table></div>
            </Card>
          </div>

          <Card title="Bake Haus item sales · this week">
            {data.bakeHausItemSales.length === 0 ? (
              <Stub>No Bake Haus sales recorded this week.</Stub>
            ) : (
              <>
              <TopItemsPieChart items={data.bakeHausItemSales} />
              <div className="dripos-scroll"><table className="dripos-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Item</th>
                    {!isMobile && data.stores.map((s) => <th key={s.label}>{s.label}</th>)}
                    <th>Total units</th>
                    {!isMobile && <th>Avg/store</th>}
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bakeHausItemSales.map((row) => (
                    <tr key={row.name}>
                      <td style={{ textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <ProductImage logo={row.logo} name={row.name} size={36} />
                          <span>{row.name}</span>
                        </div>
                      </td>
                      {!isMobile && data.stores.map((s) => (
                        <td key={s.label} style={{ textAlign: 'center' }}>
                          {row.unitsByStore[s.label] ?? '–'}
                        </td>
                      ))}
                      <td><strong>{row.totalUnits}</strong></td>
                      {!isMobile && <td>{row.avgPerStore.toFixed(1)}</td>}
                      <td>{fmtMoney(row.totalRevenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              </>
            )}
          </Card>

          <Card title="Top 10 drinks · this week (by revenue)">
            {data.topDrinks.length === 0 ? (
              <Stub>No drink sales recorded this week.</Stub>
            ) : (
              <>
              <TopItemsPieChart items={data.topDrinks} />
              <div className="dripos-scroll"><table className="dripos-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>#</th>
                    <th style={{ textAlign: 'left' }}>Drink</th>
                    {!isMobile && data.stores.map((s) => <th key={s.label}>{s.label}</th>)}
                    <th>Total units</th>
                    <th>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topDrinks.map((row, i) => (
                    <tr key={row.name}>
                      <td style={{ textAlign: 'left', color: '#888' }}>{i + 1}</td>
                      <td style={{ textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <ProductImage logo={row.logo} name={row.name} size={36} />
                          <span>{row.name}</span>
                        </div>
                      </td>
                      {!isMobile && data.stores.map((s) => (
                        <td key={s.label} style={{ textAlign: 'center' }}>
                          {row.unitsByStore[s.label] ?? '–'}
                        </td>
                      ))}
                      <td><strong>{row.totalUnits}</strong></td>
                      <td>{fmtMoney(row.totalRevenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              </>
            )}
          </Card>

          <Card
            title="Labor · % of sales (target ≤ 35%)"
            subtitle={
              isMobile
                ? "Total includes hourly + salaried + G4 kitchen offload."
                : "Hourly from Dripos minus G4's kitchen labor (≈$1,750/wk, the kitchen feeds every store), pooled with the $6,500/wk salaried-manager budget, then allocated to each store by sales share — same allocation the accountant runs on the bi-weekly contribution sheets."
            }
          >
            {data.laborByStore.length === 0 ? (
              <Stub>Labor data unavailable.</Stub>
            ) : (
              <div className="dripos-scroll"><table className="dripos-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Store</th>
                    {!isMobile && <th>Hourly</th>}
                    {!isMobile && <th>Salaried</th>}
                    <th>Total labor</th>
                    {!isMobile && <th>Gross sales</th>}
                    <th>Labor %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.laborByStore.map((row) => {
                    const over = row.laborPct != null && row.laborPct > 35;
                    return (
                      <tr key={row.label}>
                        <td style={{ textAlign: 'left', fontWeight: 600 }}>{row.label}</td>
                        {!isMobile && <td>{fmtMoney(row.hourlyCents)}</td>}
                        {!isMobile && (
                          <td style={{ color: row.salariedCents > 0 ? '#1a1a1a' : '#bbb' }}>
                            {row.salariedCents > 0 ? fmtMoney(row.salariedCents) : '—'}
                          </td>
                        )}
                        <td><strong>{fmtMoney(row.laborCents)}</strong></td>
                        {!isMobile && <td>{fmtMoney(row.grossSalesCents)}</td>}
                        <td style={{ color: over ? '#c0392b' : '#1f8a3b', fontWeight: 600 }}>
                          {row.laborPct == null ? '—' : `${row.laborPct.toFixed(1)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Chain</td>
                    {!isMobile && <td>{fmtMoney(data.laborTotals.hourlyCents)}</td>}
                    {!isMobile && <td>{fmtMoney(data.laborTotals.salariedCents)}</td>}
                    <td>{fmtMoney(data.laborTotals.laborCents)}</td>
                    {!isMobile && <td>{fmtMoney(data.laborTotals.grossSalesCents)}</td>}
                    <td style={{
                      color: data.laborTotals.laborPct != null && data.laborTotals.laborPct > 35
                        ? '#c0392b' : '#1f8a3b',
                      fontWeight: 700,
                    }}>
                      {data.laborTotals.laborPct == null ? '—' : `${data.laborTotals.laborPct.toFixed(1)}%`}
                    </td>
                  </tr>
                </tfoot>
              </table></div>
            )}
          </Card>
        </div>
      )}

      {showLogin && <LoginModal onClose={onLoginClose} />}

      <style>{`
        .dripos-scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          margin: 0 -8px;
        }
        .dripos-table {
          width: 100%;
          border-collapse: collapse;
          font-variant-numeric: tabular-nums;
          min-width: 480px;
        }
        @media (max-width: 768px) {
          .dripos-table {
            min-width: 0;
          }
          .dripos-table th, .dripos-table td {
            padding: 6px 6px;
            font-size: 12px;
          }
        }
        .dripos-table th, .dripos-table td {
          padding: 8px 10px;
          text-align: right;
          border-bottom: 1px solid #eee;
          font-size: 13px;
        }
        .dripos-table th {
          color: #888;
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .dripos-table th:first-child, .dripos-table td:first-child { text-align: left; }
        .dripos-table tbody tr:last-child td { border-bottom: 0; }
        .dripos-table tfoot td {
          font-weight: 700;
          border-top: 2px solid #1a1a1a;
          padding-top: 10px;
          border-bottom: 0;
        }
        .print-only { display: none; }
        @media print {
          @page {
            size: letter;
            margin: 0.55in 0.5in 0.7in;
            @bottom-center {
              content: "Germania Dashboard · Weekly Sales · Page " counter(page) " of " counter(pages);
              font-size: 9pt;
              color: #888;
            }
          }
          html, body { background: #fff !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          header, .no-print, .dripos-scroll { overflow: visible !important; }
          header, .no-print { display: none !important; }
          .print-only { display: inline !important; }

          /* Keep cards intact across page breaks */
          .react-card, .dripos-card, [class*="Card"], div[style*="background: #fff"][style*="border-radius"] {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          /* Tighter typography for print */
          h1 { font-size: 22pt !important; margin: 0 0 4pt !important; }
          h2 { break-after: avoid; page-break-after: avoid; }
          .dripos-table { font-size: 9pt; min-width: 0 !important; }
          .dripos-table th, .dripos-table td { padding: 3pt 5pt; }
          .dripos-table th { font-size: 7pt; }

          /* Force side-by-side cards to stack vertically on print so
             nothing gets clipped */
          .stack-on-print { display: block !important; }
          .stack-on-print > * { margin-bottom: 12pt; }

          /* Hide the "Updated" timestamp twice — show once via print-only */
          h1 + span + span { display: none; }

          /* Snug pie chart and trend chart in print */
          svg { max-width: 100% !important; }
        }
      `}</style>
    </div>
  );
}

function KpiTile({
  label, value, sub, delta, deltaLabel, valueColor, subColor, hero, style,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  deltaLabel?: string;
  valueColor?: string;
  subColor?: string;
  hero?: boolean;
  /** Extra grid/positioning styles merged onto the tile's wrapper.
   *  Used to make the hero span 2 cols on mobile without an extra
   *  div that would break grid row-stretching. */
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: hero
        ? 'linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)'
        : '#fff',
      color: hero ? '#fff' : '#1a1a1a',
      borderRadius: 12,
      border: hero ? 'none' : '1px solid rgba(0,0,0,0.07)',
      padding: '18px 20px',
      boxShadow: hero ? '0 4px 12px rgba(0,0,0,0.12)' : '0 1px 2px rgba(0,0,0,0.03)',
      display: 'flex', flexDirection: 'column', gap: 6,
      minHeight: 100,
      ...style,
    }}>
      <div style={{
        fontSize: 11, textTransform: 'uppercase', letterSpacing: 1,
        color: hero ? 'rgba(255,255,255,0.6)' : '#888',
        fontWeight: 600,
      }}>{label}</div>
      <div style={{
        fontSize: 28, fontWeight: 700, letterSpacing: -0.5,
        color: valueColor ?? (hero ? '#fff' : '#1a1a1a'),
        lineHeight: 1.1,
      }}>{value}</div>
      {(delta != null || sub) && (
        <div style={{
          marginTop: 'auto', fontSize: 12,
          color: hero ? 'rgba(255,255,255,0.6)' : '#888',
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        }}>
          {delta != null && (
            <span style={{
              fontSize: 12, fontWeight: 700,
              padding: '2px 8px', borderRadius: 4,
              background: hero ? 'rgba(255,255,255,0.12)' : pctClass(delta) === 'up' ? '#e6f4ea' : pctClass(delta) === 'down' ? '#fce8e6' : '#f1f1f1',
              color: hero ? (pctClass(delta) === 'up' ? '#74e08c' : pctClass(delta) === 'down' ? '#ff8b8b' : '#fff')
                          : pctClass(delta) === 'up' ? '#1f8a3b' : pctClass(delta) === 'down' ? '#c0392b' : '#666',
            }}>
              {pctClass(delta) === 'up' ? '▲' : pctClass(delta) === 'down' ? '▼' : '—'} {fmtPct(delta)}
            </span>
          )}
          {deltaLabel && <span>{deltaLabel}</span>}
          {sub && <span style={{ color: subColor ?? (hero ? 'rgba(255,255,255,0.6)' : '#888') }}>{sub}</span>}
        </div>
      )}
    </div>
  );
}

function StoreTile({ store, chainTotal }: { store: StoreRow; chainTotal: number }) {
  const sharePct = chainTotal > 0 ? (store.grossSales / chainTotal) * 100 : 0;
  const accent = STORE_COLORS[store.label] ?? '#1a1a1a';
  return (
    <div style={{
      background: '#fff', borderRadius: 12,
      border: '1px solid rgba(0,0,0,0.07)',
      padding: '16px 18px',
      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      display: 'flex', flexDirection: 'column', gap: 6,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Color bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: accent,
      }} />
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#888', fontWeight: 600,
      }}>
        <span>{store.label}</span>
        <span style={{ color: accent, fontWeight: 700 }}>{sharePct.toFixed(0)}%</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.3 }}>{fmtMoney(store.grossSales)}</div>
      <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#888', flexWrap: 'wrap', marginTop: 2 }}>
        <span style={{ color: pctColor(store.wowPct), fontWeight: 600 }}>
          {pctClass(store.wowPct) === 'up' ? '▲' : pctClass(store.wowPct) === 'down' ? '▼' : '—'} {fmtPct(store.wowPct)}
        </span>
        <span>{store.ticketCount.toLocaleString()} tix</span>
        <span>avg {fmtMoney(store.averageTicket)}</span>
      </div>
    </div>
  );
}

/**
 * Lazy product image loader with placeholder fallback. The Dripos image
 * CDN URL pattern hasn't been identified yet via black-box probing — when
 * captured from DevTools, edit `productImageUrl()` and every consumer of
 * <ProductImage> instantly gets real images.
 */
function productImageUrl(_logo: string | null | undefined): string | null {
  // TODO: set to e.g. `https://<cdn>/${logo}` once we have the CDN base.
  return null;
}

function ProductImage({ logo, name, size = 56 }: { logo?: string | null; name: string; size?: number }) {
  const url = productImageUrl(logo);
  const initial = name.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '?';
  // Stable color from name hash so same item always renders same tile color.
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  const bg = `hsl(${hue}, 45%, 88%)`;
  const fg = `hsl(${hue}, 45%, 32%)`;
  const common: React.CSSProperties = {
    width: size, height: size, borderRadius: 10,
    flexShrink: 0,
    objectFit: 'cover' as const,
  };
  if (url) {
    return <img src={url} alt={name} style={common} loading="lazy" />;
  }
  return (
    <div style={{
      ...common,
      background: bg, color: fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, fontWeight: 700, fontFamily: 'Georgia, serif',
    }}>
      {initial}
    </div>
  );
}

function DeltaBadge({ value, suffix, subtle }: { value: number | null; suffix: string; subtle: string }) {
  const cls = pctClass(value);
  const bg = cls === 'up' ? '#e6f4ea' : cls === 'down' ? '#fce8e6' : '#f1f1f1';
  const fg = cls === 'up' ? '#1f8a3b' : cls === 'down' ? '#c0392b' : '#666';
  const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '—';
  return (
    <div style={{
      fontSize: 13, fontWeight: 600,
      padding: '4px 10px', borderRadius: 4,
      background: bg, color: fg,
    }}>
      {arrow} {fmtPct(value)} {suffix}
      <span style={{ opacity: 0.6, marginLeft: 4, fontWeight: 500 }}>({subtle})</span>
    </div>
  );
}

function WeekOverrideCard({
  ov,
}: {
  ov: { sun: string; reason: string; forcedGrossCents: number; forcedTickets: number };
}) {
  return (
    <div style={{
      background: '#fff7e6',
      border: '1px solid #f0c36d',
      borderLeft: '4px solid #d4a843',
      borderRadius: 10,
      padding: '12px 16px',
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }}>
      <div style={{
        fontSize: 20, lineHeight: 1, color: '#b06d00',
        flexShrink: 0, marginTop: 1,
      }}>⚠</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11, textTransform: 'uppercase', letterSpacing: 1,
          color: '#7a5a00', fontWeight: 700,
        }}>Headline override · {ov.sun}</div>
        <div style={{ fontSize: 12, color: '#5a4500', marginTop: 4 }}>
          Showing <strong>{fmtMoney(ov.forcedGrossCents)}</strong> /{' '}
          <strong>{ov.forcedTickets.toLocaleString()} tix</strong> (Dripos chain Sales Summary).
        </div>
        <div style={{
          fontSize: 13, color: '#5a4500', lineHeight: 1.5, marginTop: 8,
        }}>{ov.reason}</div>
      </div>
    </div>
  );
}

function PennyRoundingCard({
  p,
}: {
  p: { diffCents: number; storeSumCents: number; chainGrossCents: number };
}) {
  // Per-ticket-cents loss is computed by callers if they have ticket counts;
  // here we just present the absolute gap and its share of gross.
  const pct = p.chainGrossCents > 0 ? (p.diffCents / p.chainGrossCents) * 100 : 0;
  return (
    <div style={{
      background: '#fff', borderRadius: 10,
      border: '1px solid rgba(0,0,0,0.07)', padding: '14px 22px',
      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, flexWrap: 'wrap',
    }}>
      <div>
        <div style={{
          fontSize: 11, textTransform: 'uppercase', letterSpacing: 1,
          color: '#888', fontWeight: 600, marginBottom: 4,
        }}>Penny rounding & chain adjustments</div>
        <div style={{ fontSize: 13, color: '#555', lineHeight: 1.4 }}>
          Dripos's chain gross is <strong>{fmtMoney(p.chainGrossCents)}</strong> vs
          our per-store sum of <strong>{fmtMoney(p.storeSumCents)}</strong>.
          The gap is cash penny-rounding plus custom fees.
        </div>
      </div>
      <div style={{
        fontSize: 22, fontWeight: 700, color: '#c0392b',
        whiteSpace: 'nowrap',
      }}>
        −{fmtMoney(p.diffCents)}
        <span style={{ fontSize: 12, color: '#888', fontWeight: 500, marginLeft: 6 }}>
          ({pct.toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}

function Stub({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: '#fffbe6', border: '1px dashed #d4a843',
      color: '#6b4d00', padding: '12px 16px', borderRadius: 6, fontSize: 13, lineHeight: 1.5,
    }}>{children}</div>
  );
}

const chipStyle: React.CSSProperties = {
  display: 'inline-block', padding: '1px 7px', background: '#f0f0f0',
  borderRadius: 999, fontSize: 11, color: '#888', marginLeft: 6, fontWeight: 400,
};
