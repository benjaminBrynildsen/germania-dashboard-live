import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';

interface Props {
  user: { name: string; email: string; role: string };
  onLogout: () => void;
  children: ReactNode;
}

const NAV_ITEMS: Array<{ to: string; label: string; exact?: boolean }> = [
  { to: '/', label: 'Launches' },
  { to: '/weekly-sales', label: 'Weekly Sales' },
  { to: '/locations', label: 'Locations', exact: false },
  { to: '/cog', label: 'COG Manager' },
  { to: '/ticket-time', label: 'Ticket Time' },
  { to: '/anomalies', label: 'Anomalies' },
  { to: '/weather-closure', label: 'Weather' },
  { to: '/applicants', label: 'Applicants' },
];

export default function Layout({ user, onLogout, children }: Props) {
  const location = useLocation();
  const isMobile = useIsMobile();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close drawer on route change.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // Lock background scroll while drawer is open.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [menuOpen]);

  const desktopLogoSize = scrolled ? 36 : 120;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'linear-gradient(135deg, #f0f0f3 0%, #e8e8ee 50%, #f0f0f3 100%)',
    }}>
      <header style={{
        background: scrolled ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.60)',
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        padding: isMobile ? '10px 14px' : '0 40px',
        minHeight: isMobile ? 56 : 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        position: 'sticky',
        top: 0,
        zIndex: 40,
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        overflow: 'visible',
        transition: 'background 0.3s ease',
      }}>
        {isMobile ? (
          <>
            {/* Mobile: logo left, page title center, hamburger right */}
            <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img
                src={`${import.meta.env.BASE_URL}logo.png`}
                alt="Germania Brew Haus"
                style={{ width: 32, height: 32, objectFit: 'contain' }}
              />
            </Link>
            <div style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 14,
              fontWeight: 600,
              color: '#1a1a1a',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{currentPageLabel(location.pathname)}</div>
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              style={{
                width: 40, height: 40,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 4,
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: 0,
              }}
            >
              <span style={{ width: 20, height: 2, background: '#1a1a1a', borderRadius: 2 }} />
              <span style={{ width: 20, height: 2, background: '#1a1a1a', borderRadius: 2 }} />
              <span style={{ width: 20, height: 2, background: '#1a1a1a', borderRadius: 2 }} />
            </button>
          </>
        ) : (
          <>
            {/* Desktop: nav left, hanging logo center, user right */}
            <nav style={{ display: 'flex', gap: 4, whiteSpace: 'nowrap' }}>
              {NAV_ITEMS.map((it) => (
                <NavLink key={it.to} to={it.to} current={location.pathname} exact={it.exact !== false}>
                  {it.label}
                </NavLink>
              ))}
            </nav>
            <Link
              to="/"
              style={{
                position: 'absolute',
                left: '50%',
                top: scrolled ? 14 : 10,
                transform: 'translateX(-50%)',
                zIndex: 60,
                transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <img
                src={`${import.meta.env.BASE_URL}logo.png`}
                alt="Germania Brew Haus"
                style={{
                  width: desktopLogoSize,
                  height: desktopLogoSize,
                  objectFit: 'contain',
                  filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.12))',
                  transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              />
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{user.name}</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', textTransform: 'capitalize' }}>{user.role}</div>
              </div>
              <button onClick={onLogout} className="btn btn-secondary btn-sm">Logout</button>
            </div>
          </>
        )}
      </header>

      {/* Mobile drawer (rendered always so transitions work) */}
      {isMobile && (
        <>
          <div
            onClick={() => setMenuOpen(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.35)',
              opacity: menuOpen ? 1 : 0,
              pointerEvents: menuOpen ? 'auto' : 'none',
              transition: 'opacity 0.2s',
              zIndex: 80,
              backdropFilter: 'blur(2px)',
            }}
          />
          <aside
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0,
              width: 'min(82vw, 320px)',
              background: 'rgba(255,255,255,0.96)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              boxShadow: '-8px 0 24px rgba(0,0,0,0.12)',
              transform: menuOpen ? 'translateX(0)' : 'translateX(100%)',
              transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              zIndex: 90,
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{
              padding: '14px 18px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderBottom: '1px solid rgba(0,0,0,0.06)',
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{user.name}</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', textTransform: 'capitalize' }}>{user.role}</div>
              </div>
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                style={{
                  width: 36, height: 36,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 22, color: '#888', padding: 0,
                }}
              >×</button>
            </div>
            <nav style={{ display: 'flex', flexDirection: 'column', padding: 8, flex: 1, overflowY: 'auto' }}>
              {NAV_ITEMS.map((it) => (
                <DrawerNavLink
                  key={it.to}
                  to={it.to}
                  current={location.pathname}
                  exact={it.exact !== false}
                >
                  {it.label}
                </DrawerNavLink>
              ))}
            </nav>
            <div style={{ padding: 14, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
              <button
                onClick={() => { setMenuOpen(false); onLogout(); }}
                className="btn btn-secondary"
                style={{ width: '100%', padding: '12px' }}
              >Logout</button>
            </div>
          </aside>
        </>
      )}

      <main style={{
        flex: 1,
        padding: isMobile ? 14 : 32,
        maxWidth: 1200,
        margin: '0 auto',
        width: '100%',
        paddingTop: isMobile ? 16 : 48,
      }}>
        {children}
      </main>
    </div>
  );
}

function currentPageLabel(pathname: string): string {
  const item = NAV_ITEMS.find((it) =>
    (it.exact !== false ? pathname === it.to : pathname.startsWith(it.to)),
  );
  return item?.label ?? '';
}

function NavLink({ to, current, children, exact = true }: {
  to: string; current: string; children: ReactNode; exact?: boolean;
}) {
  const active = exact ? current === to : current.startsWith(to);
  return (
    <Link to={to} style={{
      padding: '8px 18px',
      borderRadius: 10,
      fontSize: 14,
      fontWeight: 500,
      background: active ? 'rgba(0,0,0,0.07)' : 'transparent',
      color: active ? '#1a1a1a' : 'rgba(0,0,0,0.4)',
      transition: 'all 0.2s',
    }}>
      {children}
    </Link>
  );
}

function DrawerNavLink({ to, current, children, exact = true }: {
  to: string; current: string; children: ReactNode; exact?: boolean;
}) {
  const active = exact ? current === to : current.startsWith(to);
  return (
    <Link to={to} style={{
      padding: '14px 16px',
      borderRadius: 10,
      fontSize: 16,
      fontWeight: active ? 600 : 500,
      background: active ? 'rgba(0,0,0,0.06)' : 'transparent',
      color: active ? '#1a1a1a' : 'rgba(0,0,0,0.65)',
      transition: 'background 0.15s',
    }}>
      {children}
    </Link>
  );
}
