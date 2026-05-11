import { useState } from 'react';

const IS_GH_PAGES = window.location.hostname.endsWith('github.io');
const IS_LOCALHOST =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const DEMO_USER_KEY = 'germania_demo_user';

const params = new URLSearchParams(window.location.search);
const deniedEmail = params.get('denied');

export default function Login() {
  const [name, setName] = useState('');
  const [signing, setSigning] = useState(false);

  const devLogin = async () => {
    setSigning(true);

    if (IS_GH_PAGES) {
      localStorage.setItem(
        DEMO_USER_KEY,
        JSON.stringify({
          id: 1,
          name: name.trim() || 'Demo User',
          email: 'demo@germaniabrewhaus.com',
          role: 'admin',
        })
      );
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
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f0f0f3 0%, #e4e4ea 50%, #f0f0f3 100%)',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          maxWidth: 380,
          padding: 48,
          background: 'rgba(255,255,255,0.55)',
          borderRadius: 24,
          border: '1px solid rgba(255,255,255,0.7)',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.06)',
        }}
      >
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt="Germania Brew Haus"
          style={{ height: 80, marginBottom: 28 }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: '#1a1a1a',
            marginBottom: 4,
            letterSpacing: -0.3,
          }}
        >
          Germania Dashboard
        </h1>
        <p
          style={{
            color: 'rgba(0,0,0,0.35)',
            marginBottom: 28,
            fontSize: 14,
          }}
        >
          Staff sign-in
        </p>

        {deniedEmail && (
          <div
            style={{
              marginBottom: 20,
              padding: '12px 14px',
              borderRadius: 12,
              background: 'rgba(220, 38, 38, 0.08)',
              border: '1px solid rgba(220, 38, 38, 0.2)',
              color: '#991b1b',
              fontSize: 13,
              textAlign: 'left',
              lineHeight: 1.4,
            }}
          >
            <strong>Access denied.</strong> {deniedEmail} is not a Germania
            Brew Haus account. Sign in with your @germaniabrewhaus.com email.
          </div>
        )}

        {!IS_GH_PAGES && (
          <a
            href="/api/auth/google"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              width: '100%',
              padding: '14px 24px',
              fontSize: 15,
              fontWeight: 500,
              borderRadius: 14,
              background: '#fff',
              color: '#1a1a1a',
              border: '1px solid rgba(0,0,0,0.12)',
              textDecoration: 'none',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              transition: 'background 120ms',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = '#fafafa';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = '#fff';
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
              />
              <path
                fill="#FBBC05"
                d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
              />
            </svg>
            {signing ? 'Signing in…' : 'Sign in with Google'}
          </a>
        )}

        <p
          style={{
            marginTop: 16,
            fontSize: 12,
            color: 'rgba(0,0,0,0.4)',
          }}
        >
          Restricted to @germaniabrewhaus.com accounts
        </p>

        <p
          style={{
            marginTop: 18,
            fontSize: 12,
            color: 'rgba(0,0,0,0.35)',
          }}
        >
          <a href="/terms" style={{ color: 'inherit', textDecoration: 'underline' }}>
            Terms of Service
          </a>
          {' · '}
          <a href="/privacy" style={{ color: 'inherit', textDecoration: 'underline' }}>
            Privacy Policy
          </a>
        </p>

        {(IS_GH_PAGES || IS_LOCALHOST) && (
          <div
            style={{
              marginTop: 28,
              paddingTop: 20,
              borderTop: '1px solid rgba(0,0,0,0.06)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', margin: 0 }}>
              {IS_GH_PAGES ? 'Demo login' : 'Local dev login'}
            </p>
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ textAlign: 'center' }}
            />
            <button
              onClick={devLogin}
              disabled={signing || !name.trim()}
              className="btn"
              style={{ width: '100%', padding: '10px 24px', fontSize: 13, borderRadius: 12 }}
            >
              {signing ? 'Signing in…' : 'Continue without Google'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
