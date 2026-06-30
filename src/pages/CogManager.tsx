import { useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import DrinksTab from './Cog/DrinksTab';
import IngredientsTab from './Cog/IngredientsTab';
import RecipesTab from './Cog/RecipesTab';
import SettingsTab from './Cog/SettingsTab';

type Tab = 'drinks' | 'ingredients' | 'recipes' | 'settings';

const TABS: Array<{ id: Tab; label: string; short: string }> = [
  { id: 'drinks', label: 'Drinks', short: 'Drinks' },
  { id: 'ingredients', label: 'Ingredients', short: 'Ingred.' },
  { id: 'recipes', label: 'Batch Recipes', short: 'Recipes' },
  { id: 'settings', label: 'Settings', short: 'Settings' },
];

export default function CogManager() {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('drinks');
  // Bumped after a settings save so the Drinks tab re-pulls recommended prices.
  const [settingsRev, setSettingsRev] = useState(0);

  return (
    <div>
      <div style={{ marginBottom: isMobile ? 14 : 18 }}>
        <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, letterSpacing: -0.5, margin: 0 }}>COGS</h1>
        {!isMobile && (
          <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
            Drink cost of goods, ingredient costs, and recommended pricing
          </p>
        )}
      </div>

      {/* Underline tab bar — matches the Bake Haus page. */}
      <div style={{
        display: 'flex',
        gap: isMobile ? 0 : 4,
        marginBottom: isMobile ? 16 : 22,
        borderBottom: '1px solid rgba(0,0,0,0.08)',
        overflowX: 'auto',
      }}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: isMobile ? '10px 12px' : '10px 18px',
                background: 'transparent',
                border: 0,
                borderBottom: `2px solid ${active ? '#1a1a1a' : 'transparent'}`,
                color: active ? '#1a1a1a' : 'rgba(0,0,0,0.45)',
                fontSize: isMobile ? 12 : 13,
                fontWeight: 600,
                letterSpacing: isMobile ? '0.04em' : '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                marginBottom: -1,
                flex: isMobile ? 1 : '0 0 auto',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
              }}
            >
              {isMobile ? t.short : t.label}
            </button>
          );
        })}
      </div>

      {tab === 'drinks' && <DrinksTab key={settingsRev} />}
      {tab === 'ingredients' && <IngredientsTab />}
      {tab === 'recipes' && <RecipesTab />}
      {tab === 'settings' && <SettingsTab onChanged={() => setSettingsRev((r) => r + 1)} />}
    </div>
  );
}
