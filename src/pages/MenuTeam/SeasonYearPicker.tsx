const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'] as const;
type Season = (typeof SEASONS)[number];

// Year range: current year ±2 covers the practical edit/printing
// window. If the team needs older or further-out collections they can
// edit the DB directly — rare and out of scope for the picker.
function yearRange(): number[] {
  const now = new Date().getFullYear();
  const out: number[] = [];
  for (let y = now - 2; y <= now + 2; y++) out.push(y);
  return out;
}

function currentSeason(): Season {
  const m = new Date().getMonth();
  if (m <= 1 || m === 11) return 'Winter';
  if (m <= 4) return 'Spring';
  if (m <= 7) return 'Summer';
  return 'Fall';
}

export function parseCollection(value: string | null | undefined): { season: Season | ''; year: number } {
  if (!value) return { season: '', year: new Date().getFullYear() };
  const m = value.match(/^(Spring|Summer|Fall|Winter)\s+(\d{4})/i);
  if (m) {
    return {
      season: ((m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as Season),
      year: parseInt(m[2], 10),
    };
  }
  return { season: '', year: new Date().getFullYear() };
}

export function buildCollection(season: Season | '', year: number): string | null {
  if (!season) return null;
  return `${season} ${year}`;
}

export function defaultCollection(): { season: Season; year: number } {
  return { season: currentSeason(), year: new Date().getFullYear() };
}

export default function SeasonYearPicker({ value, onChange }: { value: string | null | undefined; onChange: (next: string | null) => void }) {
  const parsed = parseCollection(value);
  const years = yearRange();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
      <select
        value={parsed.season}
        onChange={(e) => onChange(buildCollection(e.target.value as Season | '', parsed.year))}
      >
        <option value="">— No season —</option>
        {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select
        value={parsed.year}
        onChange={(e) => onChange(buildCollection(parsed.season, parseInt(e.target.value, 10)))}
        disabled={!parsed.season}
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
