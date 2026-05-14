import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import HoursWatch from './HoursWatch';
import HiringNeeds from './HiringNeeds';

type Tab = 'hours' | 'hiring';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'hours', label: 'Hours Watch' },
  { id: 'hiring', label: 'Hiring Needs' },
];

export default function Staffing() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial: Tab = searchParams.get('tab') === 'hiring' ? 'hiring' : 'hours';
  const [tab, setTab] = useState<Tab>(initial);

  // Keep the URL in sync so refreshes / shared links land on the same tab.
  useEffect(() => {
    const cur = searchParams.get('tab');
    if (tab === 'hours' && cur) {
      const next = new URLSearchParams(searchParams);
      next.delete('tab');
      setSearchParams(next, { replace: true });
    } else if (tab !== 'hours' && cur !== tab) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', tab);
      setSearchParams(next, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Staffing</h1>
        <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
          Hours compliance and capacity planning across the chain.
        </p>
      </div>

      <div style={{
        display: 'flex', gap: 4, marginBottom: 24,
        borderBottom: '1px solid rgba(0,0,0,0.08)',
      }}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '10px 18px',
                background: 'transparent',
                border: 0,
                borderBottom: `2px solid ${active ? '#1a1a1a' : 'transparent'}`,
                color: active ? '#1a1a1a' : 'rgba(0,0,0,0.45)',
                fontSize: 13, fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                marginBottom: -1,
              }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'hours' && <HoursWatch embedded />}
      {tab === 'hiring' && <HiringNeeds />}
    </div>
  );
}
