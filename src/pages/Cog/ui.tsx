import { useAuth } from '../../hooks/useAuth';

// COGS editing is open to any authenticated employee (login is already
// restricted to the company Google domain). The `role` column defaults to
// 'staff' and is only promoted by hand, so role-gating here would lock out
// most real users — including the owner — so we gate on being logged in only.
export function useCanEdit(): boolean {
  const { user } = useAuth();
  return !!user;
}

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.12)',
  fontSize: 14,
  fontFamily: 'inherit',
  background: 'rgba(255,255,255,0.7)',
  boxSizing: 'border-box',
};

export const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'rgba(0,0,0,0.45)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  display: 'block',
  marginBottom: 6,
};

// Money: keep full precision in math, round only here at display.
export function money(n: number | null | undefined, dp = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `$${n.toFixed(dp)}`;
}

export function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: '18px 20px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#1a1a1a', letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>{value}</div>
    </div>
  );
}

// Number input with real +/- buttons. The native spinner arrows are ~8px and
// nearly unclickable; these are proper 28px hit targets. Typing still works —
// the buttons just step by `step` (clamped at `min`).
export function NumInput({ value, onChange, step = 1, min = 0, width, placeholder, disabled, autoFocus, onCommit }: {
  value: string;
  onChange: (v: string) => void;
  step?: number;
  min?: number | null;
  width?: number | string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onCommit?: (v: string) => void;   // fired on blur and after +/- clicks
}) {
  const decimals = (String(step).split('.')[1] || '').length;
  const bump = (dir: 1 | -1) => {
    const cur = parseFloat(value);
    let next = (Number.isFinite(cur) ? cur : 0) + dir * step;
    if (min != null && next < min) next = min;
    const v = String(parseFloat(next.toFixed(Math.max(decimals, 6))));
    onChange(v);
    onCommit?.(v);
  };
  const btn: React.CSSProperties = {
    width: 28, minWidth: 28, border: '1px solid rgba(0,0,0,0.12)', background: 'rgba(0,0,0,0.04)',
    color: 'rgba(0,0,0,0.6)', fontSize: 15, fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'inherit', padding: 0, lineHeight: 1,
  };
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', width, borderRadius: 8, overflow: 'hidden' }}>
      <button type="button" tabIndex={-1} disabled={disabled} onClick={() => bump(-1)}
        style={{ ...btn, borderRadius: '8px 0 0 8px', borderRight: 'none' }} aria-label="decrease">−</button>
      <input
        type="number" step="any" className="no-spinner"
        value={value} placeholder={placeholder} disabled={disabled} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit?.(e.target.value)}
        style={{ ...inputStyle, borderRadius: 0, textAlign: 'center', flex: 1, minWidth: 0, padding: '9px 4px' }}
      />
      <button type="button" tabIndex={-1} disabled={disabled} onClick={() => bump(1)}
        style={{ ...btn, borderRadius: '0 8px 8px 0', borderLeft: 'none' }} aria-label="increase">+</button>
    </div>
  );
}

// Simple centered modal shell (matches the app's inline-style aesthetic).
export function Modal({ title, onClose, children, width = 560 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', zIndex: 1000, overflowY: 'auto' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: '100%', maxWidth: width, background: '#fff', cursor: 'default' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ fontSize: 19, fontWeight: 700, letterSpacing: -0.3 }}>{title}</h3>
          <button onClick={onClose} className="btn btn-secondary btn-sm" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
