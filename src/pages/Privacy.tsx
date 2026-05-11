export default function Privacy() {
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
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>Privacy Policy</h1>
        <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 13, marginBottom: 28 }}>
          Germania Dashboard · Last updated May 7, 2026
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
          Who this applies to
        </h2>
        <p>
          The Germania Dashboard is an internal staff tool for Germania Brew Haus
          (Alton, IL). Access is restricted to verified
          <code> @germaniabrewhaus.com </code> Google Workspace accounts. We do
          not collect data from the general public.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
          What we collect
        </h2>
        <ul style={{ paddingLeft: 20 }}>
          <li>
            <strong>Google account info</strong> — your name, email, and profile
            picture, returned by Google when you sign in.
          </li>
          <li>
            <strong>Authentication tokens</strong> — Google access/refresh
            tokens are stored server-side so the dashboard can read sales,
            scheduling, and reviews data on your behalf.
          </li>
          <li>
            <strong>Operational data from connected services</strong> — sales,
            labor, scheduling, and customer-review data fetched from Dripos,
            Google Reviews, and similar tools used by the business.
          </li>
        </ul>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
          How we use it
        </h2>
        <p>
          Solely to display the staff dashboard. Data is not sold, shared with
          third parties, used for advertising, or used to train AI models. It is
          used only to render reports and tools to authenticated Germania Brew
          Haus employees.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
          Where it's stored
        </h2>
        <p>
          Data is stored on a private SQLite database on a Render-hosted server
          and a persistent disk in the same environment. We do not maintain
          backups outside that environment.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
          Retention &amp; deletion
        </h2>
        <p>
          Operational data is retained as long as the account exists. To delete
          your account or any data tied to it, email{' '}
          <a href="mailto:ben@germaniabrewhaus.com" style={{ color: '#2563eb' }}>
            ben@germaniabrewhaus.com
          </a>{' '}
          and we will remove it within 30 days. You can also revoke the
          dashboard's access to your Google account at{' '}
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
          Google API disclosure
        </h2>
        <p>
          Use of information received from Google APIs adheres to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#2563eb' }}
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
          Contact
        </h2>
        <p style={{ marginBottom: 0 }}>
          Questions? Email{' '}
          <a href="mailto:ben@germaniabrewhaus.com" style={{ color: '#2563eb' }}>
            ben@germaniabrewhaus.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}
