// Per-store colors and city names shared by the ordering pages (Bake Haus,
// supply ordering) so each store looks the same everywhere.

export const STORE_CITIES: Record<string, string> = {
  G1: 'Alton',
  G2: 'Godfrey',
  G3: 'East Gate',
  G4: 'Jerseyville',
};

export const STORE_THEMES: Record<string, {
  bg: string;       // Card body tint
  border: string;   // Card border
  headerBg: string; // Header band
  headerFg: string; // Header text
  accent: string;   // Header metadata color
  rowAlt: string;   // Inactive-row tint (on top of bg)
}> = {
  G1: { bg: '#fdf4f5', border: '#e8c5c8', headerBg: '#7f1d1d', headerFg: '#fde68a', accent: 'rgba(253, 230, 138, 0.7)', rowAlt: 'rgba(127, 29, 29, 0.035)' },
  G2: { bg: '#eff6fc', border: '#c5d6e8', headerBg: '#1e3a5f', headerFg: '#e6c89f', accent: 'rgba(230, 200, 159, 0.75)', rowAlt: 'rgba(30, 58, 95, 0.035)' },
  G3: { bg: '#eef6f0', border: '#bfdac9', headerBg: '#14532d', headerFg: '#e5e7eb', accent: 'rgba(229, 231, 235, 0.7)', rowAlt: 'rgba(20, 83, 45, 0.035)' },
  G4: { bg: '#fefae0', border: '#e6d8a3', headerBg: '#a16207', headerFg: '#fefce8', accent: 'rgba(254, 252, 232, 0.7)', rowAlt: 'rgba(161, 98, 7, 0.04)' },
};

export function getTheme(store: string) {
  return STORE_THEMES[store] ?? {
    bg: '#fff', border: 'rgba(0,0,0,0.07)',
    headerBg: '#1a1a1a', headerFg: '#fff', accent: 'rgba(255,255,255,0.6)',
    rowAlt: 'rgba(0,0,0,0.015)',
  };
}
