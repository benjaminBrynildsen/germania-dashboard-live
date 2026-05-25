import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';

interface Props {
  user: { name: string; email: string; role: string };
  onLogout: () => void;
  children: ReactNode;
}

/** Primary nav items shown in the top bar (desktop) and drawer top
 *  (mobile). */
const NAV_ITEMS: Array<{ to: string; label: string; exact?: boolean }> = [
  { to: '/', label: 'Dashboard' },
  { to: '/locations', label: 'Locations', exact: false },
  { to: '/ticket-time', label: 'Ticket Time' },
  { to: '/bake-haus', label: 'Bake Haus' },
  { to: '/applicants', label: 'Applicants' },
];

/** Less-frequently-used pages tucked into a "More ▾" dropdown on
 *  desktop. On mobile they render flat at the bottom of the drawer. */
const MORE_ITEMS: Array<{ to: string; label: string; exact?: boolean }> = [
  { to: '/staffing', label: 'Staffing', exact: false },
  { to: '/patrons', label: 'Patrons' },
  { to: '/launches', label: 'Launches', exact: false },
  { to: '/holidays', label: 'Holidays' },
  { to: '/pairings', label: 'Pairings' },
  { to: '/cog', label: 'COG Manager' },
  { to: '/menu-team', label: 'Menu Team', exact: false },
  { to: '/weather-closure', label: 'Weather' },
  { to: '/anomalies', label: 'Anomalies' },
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
      background: '#ffffff',
    }}>
      <header style={{
        background: scrolled ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.60)',
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        padding: isMobile ? '10px 14px' : '0 40px',
        minHeight: isMobile ? 56 : 64,
        display: isMobile ? 'flex' : 'grid',
        gridTemplateColumns: isMobile ? undefined : '1fr auto 1fr',
        alignItems: 'center',
        justifyContent: isMobile ? 'space-between' : undefined,
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
            {/* Desktop: 3-column grid — nav | hanging logo | user.
                Each lives in its own column so the logo can never overlap
                the rightmost nav links regardless of viewport width. */}
            <nav style={{
              display: 'flex', gap: 2, whiteSpace: 'nowrap',
              overflowX: 'auto',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              minWidth: 0,
            }}>
              {NAV_ITEMS.map((it) => (
                <NavLink key={it.to} to={it.to} current={location.pathname} exact={it.exact !== false}>
                  {it.label}
                </NavLink>
              ))}
              <MoreMenu current={location.pathname} />
            </nav>
            <Link
              to="/"
              style={{
                position: 'relative',
                display: 'flex',
                justifyContent: 'center',
                alignSelf: 'start',
                marginTop: scrolled ? 14 : 10,
                marginBottom: scrolled ? -10 : -66,
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
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              justifySelf: 'end',
            }}>
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
              <div style={{
                fontSize: 10, textTransform: 'uppercase', letterSpacing: 1,
                color: 'rgba(0,0,0,0.35)', fontWeight: 700,
                padding: '14px 16px 4px',
              }}>More</div>
              {MORE_ITEMS.map((it) => (
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
  const all = [...NAV_ITEMS, ...MORE_ITEMS];
  const item = all.find((it) =>
    (it.exact !== false ? pathname === it.to : pathname.startsWith(it.to)),
  );
  return item?.label ?? '';
}

function MoreMenu({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const activeItem = MORE_ITEMS.find((it) =>
    (it.exact !== false ? current === it.to : current.startsWith(it.to)),
  );
  const active = !!activeItem;

  // Recompute position whenever it opens (the nav has overflow:auto so the
  // dropdown has to be rendered via a portal to escape the clipping;
  // position is computed from the button's bounding rect).
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: '8px 14px',
          borderRadius: 10,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-body)',
          background: open || active ? 'rgba(0,0,0,0.07)' : 'transparent',
          color: open || active ? '#1a1a1a' : 'rgba(0,0,0,0.45)',
          border: 0, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          transition: 'all 0.2s',
          whiteSpace: 'nowrap',
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {activeItem ? activeItem.label : 'More'}
        <span style={{ fontSize: 9, opacity: 0.7, letterSpacing: 0 }}>▾</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed', top: pos.top, left: pos.left,
            minWidth: 170, background: 'rgba(255,255,255,0.98)',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 10, padding: 4, zIndex: 100,
            boxShadow: '0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.05)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          {MORE_ITEMS.map((it) => {
            const isActive = it.exact !== false ? current === it.to : current.startsWith(it.to);
            return (
              <Link
                key={it.to}
                to={it.to}
                onClick={() => setOpen(false)}
                role="menuitem"
                style={{
                  display: 'block',
                  padding: '10px 14px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 600,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontFamily: 'var(--font-body)',
                  color: isActive ? '#1a1a1a' : 'rgba(0,0,0,0.65)',
                  background: isActive ? 'rgba(0,0,0,0.05)' : 'transparent',
                }}
              >
                {it.label}
              </Link>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

function NavLink({ to, current, children, exact = true }: {
  to: string; current: string; children: ReactNode; exact?: boolean;
}) {
  const active = exact ? current === to : current.startsWith(to);
  return (
    <Link to={to} style={{
      padding: '8px 14px',
      borderRadius: 10,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      fontFamily: 'var(--font-body)',
      background: active ? 'rgba(0,0,0,0.07)' : 'transparent',
      color: active ? '#1a1a1a' : 'rgba(0,0,0,0.45)',
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
      fontSize: 12,
      fontWeight: active ? 700 : 600,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      fontFamily: 'var(--font-body)',
      background: active ? 'rgba(0,0,0,0.06)' : 'transparent',
      color: active ? '#1a1a1a' : 'rgba(0,0,0,0.65)',
      transition: 'background 0.15s',
    }}>
      {children}
    </Link>
  );
}
