import { useState } from 'react';

const IS_GH_PAGES = window.location.hostname.endsWith('github.io');
const DEMO_USER_KEY = 'germania_demo_user';

export default function Login() {
  const [name, setName] = useState('');
  const [signing, setSigning] = useState(false);

  const devLogin = async () => {
    setSigning(true);

    if (IS_GH_PAGES) {
      localStorage.setItem(DEMO_USER_KEY, JSON.stringify({
        id: 1,
        name: name.trim() || 'Demo User',
        email: 'demo@germaniabrewhaus.com',
        role: 'admin',
      }));
      window.location.reload();
      return;
    }

    try {
      await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      window.location.reload();
    } catch {
      setSigning(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #f0f0f3 0%, #e4e4ea 50%, #f0f0f3 100%)',
    }}>
      <div style={{
        textAlign: 'center',
        maxWidth: 380,
        padding: 48,
        background: 'rgba(255,255,255,0.55)',
        borderRadius: 24,
        border: '1px solid rgba(255,255,255,0.7)',
        backdropFilter: 'blur(24px)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.06)',
      }}>
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt="Germania Brew Haus"
          style={{ height: 80, marginBottom: 28 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <h1 style={{
          fontSize: 24,
          fontWeight: 700,
          color: '#1a1a1a',
          marginBottom: 4,
          letterSpacing: -0.3,
        }}>
          Germania Dashboard
        </h1>
        <p style={{
          color: 'rgba(0,0,0,0.35)',
          marginBottom: 32,
          fontSize: 14,
        }}>
          Menu launch management
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ textAlign: 'center' }}
          />
          <button
            onClick={devLogin}
            disabled={signing || !name.trim()}
            className="btn btn-primary"
            style={{ width: '100%', padding: '14px 24px', fontSize: 15, borderRadius: 14 }}
          >
            {signing ? 'Signing in...' : 'Sign In'}
          </button>
        </div>

        {!IS_GH_PAGES && (
          <div style={{
            marginTop: 28,
            paddingTop: 20,
            borderTop: '1px solid rgba(0,0,0,0.06)',
          }}>
            <a
              href="/api/auth/google"
              style={{
                fontSize: 13,
                color: 'rgba(0,0,0,0.3)',
              }}
            >
              Sign in with Google instead
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
