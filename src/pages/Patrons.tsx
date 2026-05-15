import { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

interface FunnelMonth {
  yearMonth: string;
  label: string;
  total: number;
  oneOnly: number;
  twoPlus: number;
  exactlyTwo: number;
  threePlus: number;
  exactlyThree: number;
  fourPlus: number;
  pct2Plus: number | null;
  pct3Plus: number | null;
  pct4Plus: number | null;
  immature: boolean;
}

interface FunnelChain {
  total: number;
  twoPlus: number;
  threePlus: number;
  fourPlus: number;
  pct2Plus: number | null;
  pct3Plus: number | null;
  pct4Plus: number | null;
}

interface FunnelReport {
  uploadedAt: number | null;
  uploadedBy: string | null;
  rowCount: number;
  filename: string | null;
  chain: FunnelChain;
  monthly: FunnelMonth[];
}

const TAFFER = { pct2Plus: 40, pct3Plus: 42, pct4Plus: 70 };

/** Tint a % cell against the Taffer benchmark — green at-or-above,
 *  yellow within 5pp below, red worse than 5pp below. Null = grey. */
function bandColor(value: number | null, target: number): {
  bg: string; fg: string;
} {
  if (value == null) return { bg: 'rgba(0,0,0,0.03)', fg: 'rgba(0,0,0,0.3)' };
  const delta = value - target;
  if (delta >= 0) return { bg: 'rgba(22, 101, 52, 0.10)', fg: '#15803d' };
  if (delta >= -5) return { bg: 'rgba(202, 138, 4, 0.10)', fg: '#a16207' };
  return { bg: 'rgba(220, 38, 38, 0.10)', fg: '#b91c1c' };
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v.toFixed(1)}%`;
}
function fmtDelta(v: number | null, target: number): string {
  if (v == null) return '';
  const d = v - target;
  const sign = d >= 0 ? '+' : '';
  return ` (${sign}${d.toFixed(1)}pp)`;
}

export default function Patrons() {
  const isMobile = useIsMobile();
  const [report, setReport] = useState<FunnelReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/patrons/funnel', { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || body.error || 'Failed to load funnel');
      setReport(body.report);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const text = await file.text();
      const r = await fetch(`/api/patrons/upload?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'content-type': 'text/csv' },
        body: text,
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || body.error || 'Upload failed');
      setReport(body.report);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Patrons</h1>
        <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
          Loyalty-program retention funnel. Conversion rates compared to Taffer benchmarks
          (40% / 42% / 70% for 1→2, 2→3, 3→4 visits with a "flawless" first experience).
          Upload the latest Dripos All Patrons CSV export whenever you want fresh data.
        </p>
      </div>

      {/* Upload + metadata row */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12,
        background: '#fff', borderRadius: 12,
        border: '1px solid rgba(0,0,0,0.06)',
        padding: '14px 18px', marginBottom: 20,
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}>
        <input ref={fileInput} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
          }}
        />
        <button onClick={() => fileInput.current?.click()} disabled={uploading}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 0, cursor: 'pointer',
            background: '#1a1a1a', color: '#fff',
            fontSize: 13, fontWeight: 700, letterSpacing: 0.3,
            opacity: uploading ? 0.5 : 1,
          }}>
          {uploading ? 'Uploading…' : 'Upload CSV'}
        </button>
        {report?.uploadedAt ? (
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
            <strong>{report.rowCount.toLocaleString()}</strong> patrons · last upload{' '}
            {new Date(report.uploadedAt).toLocaleString([], {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })}
            {report.uploadedBy && <span> by {report.uploadedBy}</span>}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
            No CSV uploaded yet. Export "All Patrons" from dashboard.dripos.com → Loyalty.
          </span>
        )}
      </div>

      {error && (
        <div style={{
          background: '#fee2e2', color: '#b91c1c', padding: '10px 14px',
          borderRadius: 8, marginBottom: 14, fontSize: 13,
        }}>{error}</div>
      )}

      {loading && !report && (
        <div style={{ color: 'rgba(0,0,0,0.4)', padding: 24 }}>Loading…</div>
      )}

      {report && report.chain.total === 0 && (
        <div style={{
          background: '#fff', borderRadius: 14,
          border: '1px solid rgba(0,0,0,0.06)',
          padding: '40px 24px', textAlign: 'center', color: 'rgba(0,0,0,0.45)',
        }}>
          No patron data yet. Upload a CSV to see the funnel.
        </div>
      )}

      {report && report.chain.total > 0 && (
        <>
          <ChainSummary chain={report.chain} isMobile={isMobile} />
          <MonthlyTable months={report.monthly} isMobile={isMobile} />
        </>
      )}
    </div>
  );
}

function ChainSummary({ chain, isMobile }: { chain: FunnelChain; isMobile: boolean }) {
  const stages: Array<{ label: string; value: number; pct: number | null; target: number | null }> = [
    { label: '1st-time visit', value: chain.total, pct: 100, target: null },
    { label: 'Came back (2+)', value: chain.twoPlus, pct: chain.pct2Plus, target: TAFFER.pct2Plus },
    { label: '3rd visit (3+)', value: chain.threePlus, pct: chain.pct3Plus, target: TAFFER.pct3Plus },
    { label: 'Regular (4+)',   value: chain.fourPlus, pct: chain.pct4Plus, target: TAFFER.pct4Plus },
  ];

  return (
    <div style={{
      background: '#fff', borderRadius: 14,
      border: '1px solid rgba(0,0,0,0.06)',
      padding: '18px 22px', marginBottom: 24,
      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.5)',
        textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 14,
      }}>
        Chain funnel · loyalty-program signups, all time
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
        gap: 14,
      }}>
        {stages.map((s, i) => {
          const tone = s.target != null ? bandColor(s.pct, s.target) : { bg: 'transparent', fg: '#1a1a1a' };
          const targetLine = s.target != null ? `Taffer ${s.target}%${fmtDelta(s.pct, s.target)}` : null;
          return (
            <div key={s.label} style={{
              padding: '12px 14px', borderRadius: 10,
              background: i === 0 ? 'rgba(0,0,0,0.03)' : tone.bg,
              border: i === 0 ? '1px solid rgba(0,0,0,0.06)' : `1px solid ${tone.bg}`,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.5)',
                textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4,
              }}>{s.label}</div>
              <div style={{
                fontSize: 22, fontWeight: 700, color: '#1a1a1a',
                fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
              }}>{s.value.toLocaleString()}</div>
              <div style={{
                fontSize: 13, fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: tone.fg, marginTop: 2,
              }}>{i === 0 ? '100%' : fmtPct(s.pct)}</div>
              {targetLine && (
                <div style={{
                  fontSize: 10, marginTop: 4, color: 'rgba(0,0,0,0.4)',
                  letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 600,
                }}>{targetLine}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthlyTable({ months, isMobile }: { months: FunnelMonth[]; isMobile: boolean }) {
  if (months.length === 0) return null;
  return (
    <div style={{
      background: '#fff', borderRadius: 14,
      border: '1px solid rgba(0,0,0,0.06)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 22px',
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
      }}>
        <span style={{
          fontSize: 14, fontWeight: 700, letterSpacing: -0.2,
        }}>Monthly funnel</span>
        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
          By "First Seen" month · most recent first
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontSize: 13, fontFamily: 'var(--font-body)',
        }}>
          <thead>
            <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
              <Th>Month</Th>
              <Th align="right">1st-time</Th>
              {!isMobile && <Th align="right">1-only</Th>}
              <Th align="right">% 2+</Th>
              {!isMobile && <Th align="right">2</Th>}
              <Th align="right">% 3+</Th>
              {!isMobile && <Th align="right">3</Th>}
              <Th align="right">% 4+</Th>
              {!isMobile && <Th align="right">4+</Th>}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const pct2Tone = bandColor(m.pct2Plus, TAFFER.pct2Plus);
              const pct3Tone = bandColor(m.pct3Plus, TAFFER.pct3Plus);
              const pct4Tone = bandColor(m.pct4Plus, TAFFER.pct4Plus);
              return (
                <tr key={m.yearMonth} style={{
                  borderTop: '1px solid rgba(0,0,0,0.05)',
                  opacity: m.immature ? 0.65 : 1,
                }}>
                  <Td>
                    <strong>{m.label}</strong>
                    {m.immature && (
                      <span title="Patrons haven't had enough time to make all return visits yet — partial signal" style={{
                        marginLeft: 8, fontSize: 9, fontWeight: 700,
                        color: 'rgba(0,0,0,0.45)', letterSpacing: 0.6,
                        textTransform: 'uppercase',
                        padding: '2px 6px', borderRadius: 4,
                        background: 'rgba(0,0,0,0.05)',
                      }}>too recent</span>
                    )}
                  </Td>
                  <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{m.total}</Td>
                  {!isMobile && <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>{m.oneOnly}</Td>}
                  <Td align="right">
                    <PctChip pct={m.pct2Plus} tone={pct2Tone} />
                  </Td>
                  {!isMobile && <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>{m.exactlyTwo}</Td>}
                  <Td align="right">
                    <PctChip pct={m.pct3Plus} tone={pct3Tone} />
                  </Td>
                  {!isMobile && <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>{m.exactlyThree}</Td>}
                  <Td align="right">
                    <PctChip pct={m.pct4Plus} tone={pct4Tone} />
                  </Td>
                  {!isMobile && <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,0.5)' }}>{m.fourPlus}</Td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{
        padding: '10px 22px', borderTop: '1px solid rgba(0,0,0,0.05)',
        fontSize: 11, color: 'rgba(0,0,0,0.4)',
      }}>
        Conversion-rate columns compare to the Taffer benchmark
        ({TAFFER.pct2Plus}% / {TAFFER.pct3Plus}% / {TAFFER.pct4Plus}%) for a flawless first experience.
        Green = at-or-above target, yellow = within 5 pp below, red = more than 5 pp below.
      </div>
    </div>
  );
}

function PctChip({ pct, tone }: { pct: number | null; tone: { bg: string; fg: string } }) {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 999,
      background: tone.bg, color: tone.fg,
      fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
    }}>{fmtPct(pct)}</span>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align ?? 'left',
      padding: '10px 14px', fontSize: 10, textTransform: 'uppercase',
      letterSpacing: 0.5, fontWeight: 700, color: 'rgba(0,0,0,0.5)',
      whiteSpace: 'nowrap',
    }}>{children ?? ''}</th>
  );
}

function Td({
  children, align, style,
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
  style?: React.CSSProperties;
}) {
  return (
    <td style={{
      textAlign: align ?? 'left',
      padding: '10px 14px', whiteSpace: 'nowrap',
      ...style,
    }}>{children}</td>
  );
}
