export default function Terms() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f0f0f3',
        padding: '40px 20px',
      }}
    >
      <div
        style={{
          maxWidth: 760,
          margin: '0 auto',
          background: '#fff',
          borderRadius: 16,
          padding: '40px 44px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
          border: '1px solid rgba(0,0,0,0.06)',
          color: '#1a1a1a',
          lineHeight: 1.6,
          fontSize: 15,
        }}
      >
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Terms of Service</h1>
        <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 13, marginBottom: 28 }}>
          Germania Dashboard · Last updated May 11, 2026
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
          Who this applies to
        </h2>
        <p>
          The Germania Dashboard is an internal staff tool for Germania Brew Haus
          (Sioux Falls, SD). By signing in with your{' '}
          <code>@germaniabrewhaus.com</code> account you agree to these terms.
          The dashboard is not offered to the general public.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
          Acceptable use
        </h2>
        <ul style={{ paddingLeft: 20 }}>
          <li>Use the dashboard only for legitimate Germania Brew Haus work.</li>
          <li>
            Don't share your account, export data outside the company, or attempt
            to access locations, reports, or settings you aren't authorized for.
          </li>
          <li>
            Don't probe, reverse-engineer, scrape, or otherwise interfere with
            the dashboard or the connected services (Dripos, Google, etc.).
          </li>
        </ul>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
          Your account
        </h2>
        <p>
          You're responsible for activity on your account. If you suspect it's
          been compromised, email{' '}
          <a href="mailto:ben@germaniabrewhaus.com" style={{ color: '#2563eb' }}>
            ben@germaniabrewhaus.com
          </a>{' '}
          immediately so we can revoke sessions.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
          Data &amp; privacy
        </h2>
        <p>
          Data handling is described in our{' '}
          <a href="/privacy" style={{ color: '#2563eb' }}>
            Privacy Policy
          </a>
          . Operational data shown in the dashboard (sales, labor, reviews) is
          confidential to Germania Brew Haus and may not be redistributed.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
          Availability &amp; changes
        </h2>
        <p>
          The dashboard is provided "as is" with no uptime guarantee. We may
          modify, restrict, or discontinue features at any time. Connected
          third-party services can go down or change behavior outside our
          control.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
          Termination
        </h2>
        <p>
          We can suspend or revoke access at any time — typically when an
          employee leaves the company or for violation of these terms. You can
          stop using the dashboard at any time and revoke its Google access at{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#2563eb' }}
          >
            myaccount.google.com/permissions
          </a>
          .
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
          Contact
        </h2>
        <p style={{ marginBottom: 0 }}>
          Questions about these terms? Email{' '}
          <a href="mailto:ben@germaniabrewhaus.com" style={{ color: '#2563eb' }}>
            ben@germaniabrewhaus.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}
