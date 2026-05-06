import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';

interface Props {
  user: { name: string; email: string; role: string };
  onLogout: () => void;
  children: ReactNode;
}

export default function Layout({ user, onLogout, children }: Props) {
  const location = useLocation();
  const isMobile = useIsMobile();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Logo transitions: large hanging vs compact in bar
  const logoImgSize = isMobile ? 34 : (scrolled ? 36 : 120);
  const logoTop = scrolled ? 14 : 10;

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
        padding: isMobile ? '10px 12px' : '0 40px',
        minHeight: isMobile ? 92 : 64,
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'space-between',
        gap: isMobile ? 8 : 0,
        position: 'sticky',
        top: 0,
        zIndex: 40,
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        overflow: 'visible',
        transition: 'background 0.3s ease',
      }}>

        {/* Left nav */}
        <nav style={{ display: 'flex', gap: 4, overflowX: 'auto', whiteSpace: 'nowrap', width: isMobile ? '100%' : 'auto', order: isMobile ? 2 : 1 }}>
          <NavLink to="/" current={location.pathname} compact={isMobile}>Launches</NavLink>
          <NavLink to="/weekly-sales" current={location.pathname} compact={isMobile}>Weekly Sales</NavLink>
          <NavLink to="/locations" current={location.pathname.startsWith('/locations') ? '/locations' : location.pathname} exact={false} compact={isMobile}>Locations</NavLink>
          <NavLink to="/cog" current={location.pathname} compact={isMobile}>COG Manager</NavLink>
          <NavLink to="/ticket-time" current={location.pathname} compact={isMobile}>Ticket Time</NavLink>
          <NavLink to="/anomalies" current={location.pathname} compact={isMobile}>Anomalies</NavLink>
          <NavLink to="/weather-closure" current={location.pathname} compact={isMobile}>Weather</NavLink>
        </nav>

        {/* Centered logo — hangs when at top, tucks in when scrolled */}
        <Link
          to="/"
          style={{
            position: isMobile ? 'static' : 'absolute',
            left: '50%',
            top: logoTop,
            transform: isMobile ? 'none' : 'translateX(-50%)',
            zIndex: 60,
            alignSelf: isMobile ? 'center' : undefined,
            order: isMobile ? 1 : undefined,
            transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Germania Brew Haus"
            style={{
              width: logoImgSize,
              height: logoImgSize,
              objectFit: 'contain',
              filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.12))',
              transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        </Link>

        {/* Right: user + logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: isMobile ? 'space-between' : 'flex-end', width: isMobile ? '100%' : 'auto', order: isMobile ? 3 : 2 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{user.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', textTransform: 'capitalize' }}>{user.role}</div>
          </div>
          <button onClick={onLogout} className="btn btn-secondary btn-sm">Logout</button>
        </div>
      </header>

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

function NavLink({ to, current, children, exact = true, compact = false }: { to: string; current: string; children: ReactNode; exact?: boolean; compact?: boolean }) {
  const active = exact ? current === to : current.startsWith(to);
  return (
    <Link to={to} style={{
      padding: compact ? '7px 12px' : '8px 18px',
      borderRadius: 10,
      fontSize: compact ? 13 : 14,
      fontWeight: 500,
      background: active ? 'rgba(0,0,0,0.07)' : 'transparent',
      color: active ? '#1a1a1a' : 'rgba(0,0,0,0.4)',
      transition: 'all 0.2s',
    }}>
      {children}
    </Link>
  );
}
