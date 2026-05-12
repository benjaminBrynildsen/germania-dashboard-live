import { useEffect, useMemo, useState } from 'react';

interface DailyPoint {
  date: string;
  avgTicketMin: number | null;
  ticketCount: number;
  salesCents: number;
}

const RANGE_PRESETS: Array<{ label: string; days: number }> = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
];

const ANOMALY_SIGMA = 2.5;

function detectAnomalies(values: Array<number | null | undefined>): boolean[] {
  // True at indices where the value is more than ANOMALY_SIGMA stddevs
  // from the mean. POS glitches and one-off slow days that drag the
  // y-axis hostage end up in here. We only flag positive outliers
  // (way slower / way higher) since those are the ones that distort
  // the chart most; the rare zero days are already filtered as nulls.
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < 5) return values.map(() => false);
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, v) => a + (v - mean) ** 2, 0) / nums.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return values.map(() => false);
  return values.map((v) => typeof v === 'number' && (v - mean) > ANOMALY_SIGMA * sd);
}

export default function TicketVsSalesCard({
  locId, isMobile,
}: { locId: string; isMobile: boolean }) {
  const [days, setDays] = useState(90);
  const [customMode, setCustomMode] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [series, setSeries] = useState<DailyPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/dripos/ticket-vs-sales/${locId}?days=${days}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.ok) {
          setError(j.message || j.error || 'Failed to load');
          return;
        }
        let s: DailyPoint[] = j.series ?? [];
        if (customMode && customStart && customEnd) {
          s = s.filter((p) => p.date >= customStart && p.date <= customEnd);
        }
        setSeries(s);
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [locId, days, customMode, customStart, customEnd]);

  // Pearson correlation between same-day ticket time and sales — quick
  // gut check for the hypothesis. Days that are >2.5σ outliers on either
  // metric (POS glitches, holiday spikes) are dropped so a single bad
  // day can't dominate the coefficient.
  const stats = useMemo(() => {
    const paired = series.filter((p) => p.avgTicketMin != null && p.salesCents > 0) as Array<DailyPoint & { avgTicketMin: number }>;
    if (paired.length < 3) return { r: null as number | null, n: paired.length, dropped: 0 };
    const tFlag = detectAnomalies(paired.map((p) => p.avgTicketMin));
    const sFlag = detectAnomalies(paired.map((p) => p.salesCents));
    const clean = paired.filter((_, i) => !tFlag[i] && !sFlag[i]);
    if (clean.length < 3) return { r: null as number | null, n: clean.length, dropped: paired.length - clean.length };
    const xs = clean.map((p) => p.avgTicketMin);
    const ys = clean.map((p) => p.salesCents);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const mx = mean(xs), my = mean(ys);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < clean.length; i++) {
      const a = xs[i] - mx, b = ys[i] - my;
      num += a * b; dx += a * a; dy += b * b;
    }
    const denom = Math.sqrt(dx * dy);
    return {
      r: denom > 0 ? num / denom : null,
      n: clean.length,
      dropped: paired.length - clean.length,
    };
  }, [series]);

  return (
    <div style={{
      background: 'rgba(255,255,255,0.85)',
      border: '1px solid rgba(0,0,0,0.07)',
      borderRadius: 16,
      padding: isMobile ? 16 : 24,
      marginTop: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        flexWrap: 'wrap', gap: 12, marginBottom: 14,
      }}>
        <div>
          <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
            Ticket time vs daily sales · {locId}
          </h3>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
            Hypothesis check: do slower days hurt same-day or next-week sales?
            {stats.r != null && ` · Pearson r = ${stats.r.toFixed(2)} (n=${stats.n}${stats.dropped ? `, ${stats.dropped} anomalies dropped` : ''})`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {RANGE_PRESETS.map((p) => {
            const active = !customMode && days === p.days;
            return (
              <button
                key={p.label}
                onClick={() => { setCustomMode(false); setDays(p.days); }}
                style={{
                  padding: '5px 12px', borderRadius: 999,
                  border: active ? '1px solid #1a1a1a' : '1px solid rgba(0,0,0,0.12)',
                  background: active ? '#1a1a1a' : '#fff',
                  color: active ? '#fff' : 'rgba(0,0,0,0.65)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >{p.label}</button>
            );
          })}
          <button
            onClick={() => { setCustomMode(true); setDays(365); }}
            style={{
              padding: '5px 12px', borderRadius: 999,
              border: customMode ? '1px solid #1a1a1a' : '1px solid rgba(0,0,0,0.12)',
              background: customMode ? '#1a1a1a' : '#fff',
              color: customMode ? '#fff' : 'rgba(0,0,0,0.65)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >Custom</button>
        </div>
      </div>

      {customMode && (
        <div style={{
          display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap',
          alignItems: 'center', fontSize: 13,
        }}>
          <label>From <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ marginLeft: 4 }} /></label>
          <label>To <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ marginLeft: 4 }} /></label>
        </div>
      )}

      {loading && <div style={{ color: 'rgba(0,0,0,0.4)', padding: '24px 0', fontSize: 13 }}>Loading… (first load over a long range can take 20-40s while we hydrate the cache)</div>}
      {error && <div style={{ color: '#c0392b', padding: '12px 0', fontSize: 13 }}>{error}</div>}
      {!loading && !error && series.length > 0 && (
        <DualSeriesChart series={series} isMobile={isMobile} />
      )}
    </div>
  );
}

function DualSeriesChart({ series, isMobile }: { series: DailyPoint[]; isMobile: boolean }) {
  const [smooth, setSmooth] = useState(true);
  const [view, setView] = useState<'line' | 'bars'>('line');
  const [hideAnomalies, setHideAnomalies] = useState(true);

  // 7-day moving average smooths daily noise.
  const smoothed = useMemo(() => {
    if (!smooth) return series.map((p) => ({
      ...p, smoothedTime: p.avgTicketMin, smoothedSales: p.salesCents,
    }));
    const W = 7;
    return series.map((_, i) => {
      const slice = series.slice(Math.max(0, i - W + 1), i + 1);
      const tVals = slice.map((s) => s.avgTicketMin).filter((v): v is number => v != null);
      const sVals = slice.map((s) => s.salesCents).filter((v) => v > 0);
      return {
        ...series[i],
        smoothedTime: tVals.length ? tVals.reduce((a, b) => a + b, 0) / tVals.length : null,
        smoothedSales: sVals.length ? sVals.reduce((a, b) => a + b, 0) / sVals.length : 0,
      };
    });
  }, [series, smooth]);

  const annotated = useMemo(() => {
    const timeAnomalies = detectAnomalies(smoothed.map((p) => p.smoothedTime));
    const salesAnomalies = detectAnomalies(smoothed.map((p) => p.smoothedSales));
    return smoothed.map((p, i) => ({
      ...p,
      timeAnomaly: timeAnomalies[i],
      salesAnomaly: salesAnomalies[i],
    }));
  }, [smoothed]);

  const anomalyCount = useMemo(
    () => annotated.filter((p) => p.timeAnomaly || p.salesAnomaly).length,
    [annotated],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <ToggleBtn active={view === 'line'} onClick={() => setView('line')}>Line</ToggleBtn>
        <ToggleBtn active={view === 'bars'} onClick={() => setView('bars')}>Bars</ToggleBtn>
        <ToggleBtn active={smooth} onClick={() => setSmooth((s) => !s)}>
          {smooth ? '✓ 7-day smoothing' : '7-day smoothing'}
        </ToggleBtn>
        <ToggleBtn active={hideAnomalies} onClick={() => setHideAnomalies((a) => !a)}>
          {hideAnomalies ? '✓ Hide anomalies' : 'Hide anomalies'}
        </ToggleBtn>
        {anomalyCount > 0 && (
          <span style={{ fontSize: 11, color: '#a04ea0', fontWeight: 600 }}>
            ⚠ {anomalyCount} day{anomalyCount === 1 ? '' : 's'} flagged ({'>'}{ANOMALY_SIGMA}σ from mean)
          </span>
        )}
      </div>
      {view === 'line' ? (
        <DualLineChart series={annotated} isMobile={isMobile} hideAnomalies={hideAnomalies} />
      ) : (
        <DualBarChart series={annotated} isMobile={isMobile} hideAnomalies={hideAnomalies} />
      )}
    </div>
  );
}

function ToggleBtn({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
        border: active ? '1px solid #1a1a1a' : '1px solid rgba(0,0,0,0.15)',
        background: active ? '#1a1a1a' : '#fff',
        color: active ? '#fff' : 'rgba(0,0,0,0.65)',
        cursor: 'pointer',
      }}
    >{children}</button>
  );
}

interface SmoothedPoint extends DailyPoint {
  smoothedTime: number | null;
  smoothedSales: number;
  timeAnomaly: boolean;
  salesAnomaly: boolean;
}

/** "5 min" — y-axis ticks always read as integer minutes. */
function fmtMinAxis(v: number): string {
  return `${Math.round(v)} min`;
}

function DualLineChart({ series, isMobile, hideAnomalies }: {
  series: SmoothedPoint[]; isMobile: boolean; hideAnomalies: boolean;
}) {
  const W = 760;
  const H = 280;
  const PAD = { left: 60, right: 60, top: 18, bottom: 28 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const n = series.length;
  if (n < 2) return <div style={{ color: '#888', fontSize: 13 }}>Not enough data yet.</div>;

  const timeForScale = series
    .filter((p) => p.smoothedTime != null && (!hideAnomalies || !p.timeAnomaly))
    .map((p) => p.smoothedTime as number);
  const salesForScale = series
    .filter((p) => p.smoothedSales > 0 && (!hideAnomalies || !p.salesAnomaly))
    .map((p) => p.smoothedSales);
  // Round the upper bound up to the next integer minute so the axis ticks
  // read as 1, 2, 3, ... not 1.2, 2.4, 3.6.
  const maxTime = Math.max(1, Math.ceil(Math.max(0.5, ...timeForScale) * 1.08));
  const maxSales = Math.max(1, ...salesForScale);
  const minSales = (salesForScale.length ? Math.min(...salesForScale) : 0) * 0.85;

  const x = (i: number) => PAD.left + (i / (n - 1)) * innerW;
  const yTime = (v: number) => PAD.top + innerH * (1 - v / maxTime);
  const yS = (v: number) => PAD.top + innerH * (1 - (v - minSales) / (maxSales * 1.05 - minSales));

  const isTimeOk = (p: SmoothedPoint) =>
    p.smoothedTime != null && (!hideAnomalies || !p.timeAnomaly);
  const isSalesOk = (p: SmoothedPoint) =>
    p.smoothedSales > 0 && (!hideAnomalies || !p.salesAnomaly);

  const timePath = series
    .map((p, i) => !isTimeOk(p) ? null : `${i === 0 || !isTimeOk(series[i - 1]) ? 'M' : 'L'} ${x(i)} ${yTime(p.smoothedTime as number)}`)
    .filter(Boolean)
    .join(' ');
  const salesPath = series
    .map((p, i) => !isSalesOk(p) ? null : `${i === 0 || !isSalesOk(series[i - 1]) ? 'M' : 'L'} ${x(i)} ${yS(p.smoothedSales)}`)
    .filter(Boolean)
    .join(' ');

  const tickIdx = Array.from({ length: 6 }, (_, i) => Math.round((i * (n - 1)) / 5));

  // Integer-minute ticks (every 1 or 2 mins depending on range)
  const tickStep = maxTime <= 6 ? 1 : maxTime <= 12 ? 2 : Math.ceil(maxTime / 6);
  const timeTicks: number[] = [];
  for (let v = 0; v <= maxTime; v += tickStep) timeTicks.push(v);

  return (
    <div style={{ overflowX: isMobile ? 'auto' : 'visible', minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, minWidth: 0 }}>
        {timeTicks.map((v, i) => {
          const y = yTime(v);
          return (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="#eee" />
              <text x={PAD.left - 6} y={y + 3} fontSize="10" fill="#c97a3f" textAnchor="end" fontWeight="600">
                {fmtMinAxis(v)}
              </text>
            </g>
          );
        })}
        {[0, 0.5, 1].map((f, i) => {
          const v = (maxSales * 1.05 - minSales) * (1 - f) + minSales;
          const y = PAD.top + innerH * f;
          return (
            <text key={i} x={W - PAD.right + 6} y={y + 3} fontSize="10" fill="#2c5f8d" textAnchor="start" fontWeight="600">
              ${(v / 100 / 1000).toFixed(1)}k
            </text>
          );
        })}
        {tickIdx.map((i) => {
          if (i < 0 || i >= n) return null;
          return (
            <text key={i} x={x(i)} y={H - 6} fontSize="9" fill="#888" textAnchor="middle">
              {series[i].date.slice(5)}
            </text>
          );
        })}
        <path d={salesPath} fill="none" stroke="#2c5f8d" strokeWidth="2" strokeLinejoin="round" />
        <path d={timePath} fill="none" stroke="#c97a3f" strokeWidth="2" strokeLinejoin="round" />
        {hideAnomalies && series.map((p, i) => {
          if (!p.timeAnomaly && !p.salesAnomaly) return null;
          const xc = x(i);
          return (
            <g key={`a-${i}`}>
              <line x1={xc} x2={xc} y1={PAD.top} y2={PAD.top + innerH}
                    stroke="#c08a4a" strokeWidth="1" strokeDasharray="2 3" opacity="0.45" />
              <text x={xc} y={PAD.top - 2} fontSize="9" fill="#a04ea0" textAnchor="middle">⚠</text>
            </g>
          );
        })}
        <g transform={`translate(${PAD.left}, ${PAD.top - 6})`}>
          <line x1="0" x2="18" y1="0" y2="0" stroke="#c97a3f" strokeWidth="2" />
          <text x="22" y="3" fontSize="10" fill="#666" fontWeight="600">Ticket time</text>
          <line x1="92" x2="110" y1="0" y2="0" stroke="#2c5f8d" strokeWidth="2" />
          <text x="114" y="3" fontSize="10" fill="#666" fontWeight="600">Sales</text>
        </g>
      </svg>
    </div>
  );
}

function DualBarChart({ series, isMobile, hideAnomalies }: {
  series: SmoothedPoint[]; isMobile: boolean; hideAnomalies: boolean;
}) {
  const W = 760;
  const H_TIME = 110;
  const H_SALES = 110;
  const PAD = { left: 56, right: 12, top: 12, bottom: 22 };
  const innerW = W - PAD.left - PAD.right;
  const n = series.length;
  const bw = n > 0 ? innerW / n : innerW;

  const maxTime = Math.max(1, Math.ceil(Math.max(0.5, ...series
    .filter((p) => p.smoothedTime != null && (!hideAnomalies || !p.timeAnomaly))
    .map((p) => p.smoothedTime as number))));
  const maxSales = Math.max(1, ...series
    .filter((p) => p.smoothedSales > 0 && (!hideAnomalies || !p.salesAnomaly))
    .map((p) => p.smoothedSales));

  const timeY = (v: number) => PAD.top + (H_TIME - PAD.top - PAD.bottom) * (1 - v / maxTime);
  const salesY = (v: number) => PAD.top + (H_SALES - PAD.top - PAD.bottom) * (1 - v / maxSales);

  const tickIdx = Array.from({ length: 6 }, (_, i) => Math.round((i * (n - 1)) / 5));

  const renderChart = (
    height: number,
    yFn: (v: number) => number,
    color: string,
    max: number,
    valueFn: (p: SmoothedPoint) => number | null,
    isAnomaly: (p: SmoothedPoint) => boolean,
    yLabel: (v: number) => string,
    title: string,
  ) => (
    <div style={{ overflowX: isMobile ? 'auto' : 'visible', minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height, minWidth: 0 }}>
        <text x={PAD.left} y={10} fontSize="10" fill="#888" fontWeight="700">{title}</text>
        {[0, 0.5, 1].map((f, i) => {
          const v = max * (1 - f);
          const y = PAD.top + (height - PAD.top - PAD.bottom) * f;
          return (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="#eee" />
              <text x={PAD.left - 4} y={y + 3} fontSize="9" fill="#aaa" textAnchor="end">{yLabel(v)}</text>
            </g>
          );
        })}
        {series.map((p, i) => {
          const v = valueFn(p);
          if (v == null) return null;
          const anomaly = isAnomaly(p);
          if (hideAnomalies && anomaly) {
            const xc = PAD.left + i * bw + bw / 2;
            return (
              <text key={p.date} x={xc} y={PAD.top + 8} fontSize="11"
                    fill="#a04ea0" textAnchor="middle">⚠</text>
            );
          }
          const drawV = Math.min(v, max);
          const xc = PAD.left + i * bw;
          const yc = yFn(drawV);
          return (
            <rect
              key={p.date}
              x={xc + 0.5}
              y={yc}
              width={Math.max(1, bw - 1)}
              height={Math.max(0, height - PAD.bottom - yc)}
              fill={anomaly ? '#a04ea0' : color}
              opacity={anomaly ? 0.6 : 0.85}
            />
          );
        })}
        {tickIdx.map((i) => {
          if (i < 0 || i >= n) return null;
          const p = series[i];
          const xc = PAD.left + i * bw + bw / 2;
          return (
            <text key={i} x={xc} y={height - 6} fontSize="9" fill="#888" textAnchor="middle">{p.date.slice(5)}</text>
          );
        })}
      </svg>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {renderChart(
        H_TIME, timeY, '#c97a3f', maxTime,
        (p) => p.smoothedTime,
        (p) => p.timeAnomaly,
        fmtMinAxis,
        'AVG TICKET TIME',
      )}
      {renderChart(
        H_SALES, salesY, '#2c5f8d', maxSales,
        (p) => p.smoothedSales > 0 ? p.smoothedSales : null,
        (p) => p.salesAnomaly,
        (v) => `$${(v / 100 / 1000).toFixed(1)}k`,
        'DAILY SALES',
      )}
    </div>
  );
}
