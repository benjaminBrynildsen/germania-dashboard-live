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
