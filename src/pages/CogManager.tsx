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
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>COGS</h1>
        <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
          Drink cost of goods, ingredient costs, and recommended pricing
        </p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 22, flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: isMobile ? '8px 14px' : '9px 18px',
                borderRadius: 9,
                fontSize: 14,
                fontWeight: 600,
                border: 'none',
                background: active ? '#1a1a1a' : 'rgba(0,0,0,0.06)',
                color: active ? '#fff' : 'rgba(0,0,0,0.55)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.2s',
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
