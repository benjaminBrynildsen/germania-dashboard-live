// Shared types between Menu Team frontend and backend SOP routes/PDF renderer.

export type Temperature = 'iced' | 'frozen' | 'hot';

export type SopFootnote = {
  marker: string; // "*" by default; "**", "*=" etc. also fine
  text: string;
};

export type SopRow = {
  id?: number;
  presetId?: number | null;
  name: string;
  modifier?: string | null;
  cells: string[]; // one per size column; multi-line allowed via "\n"
};

export type SopVariant = {
  id?: number;
  temperature: Temperature;
  position: number;
  sizeLabels: string[];          // e.g. ["Kids","R","L"] or ["8 oz ripple cup"]
  footnotes: SopFootnote[];
  assemblyBigIdea?: string | null;
  assemblySteps?: string[] | null;
  rows: SopRow[];
};

export type Availability = 'All-Season' | '1st Half Only' | '2nd Half Only';

export type SopCategory = {
  key: string;        // stable id stored in DB
  name: string;       // full label used on divider page and editor
  shortName: string;  // shorter prefix used on the cover ("Sweet - Latte")
};

// Order matters — drives the order of category dividers + cover sections.
export const SOP_CATEGORIES: SopCategory[] = [
  { key: 'sweet', name: 'Sweet Coffee', shortName: 'Sweet' },
  { key: 'bridge', name: 'Bridge Coffee', shortName: 'Bridge' },
  { key: 'artisanal', name: 'Artisanal Coffee', shortName: 'Artisanal' },
  { key: 'tsm', name: 'Tea, Smoothies, & More', shortName: 'TSM' },
];

export const AVAILABILITY_OPTIONS: Availability[] = ['All-Season', '1st Half Only', '2nd Half Only'];

export type Sop = {
  id?: number;
  slug: string;
  name: string;
  collection?: string | null;
  dietaryTags?: string | null;
  syrupDietaryTags?: string | null;
  drinkContains?: string | null;
  refrigerationNote?: string | null;
  category?: string | null;          // SOP_CATEGORIES key
  availability?: Availability | null;
  sopRequired?: boolean;             // false → parens on cover, no SOP page
  subtitle?: string | null;          // e.g. The "Amar-tado"
  availabilityNote?: string | null;  // e.g. "This drink will be available ONLY through early January 2026."
  variants: SopVariant[];
  createdAt?: number;
  updatedAt?: number;
};

export type CollectionMeta = {
  collection: string;
  transitionNote?: string | null;
};

export type SopPreset = {
  id: number;
  slug: string;
  category: string;
  name: string;
  defaultModifier?: string | null;
  // Default per-size cells keyed by temperature (or "any").
  defaultCells?: Partial<Record<Temperature | 'any', string[]>> | null;
  isSeeded: boolean;
  sort: number;
};

export const TEMP_ORDER: Temperature[] = ['iced', 'frozen', 'hot'];

export const TEMP_LABEL: Record<Temperature, string> = {
  iced: 'Iced',
  frozen: 'Frozen',
  hot: 'Hot',
};

export const DEFAULT_SIZE_LABELS: Record<Temperature, string[]> = {
  iced: ['Kids', 'R', 'L'],
  frozen: ['Kids', 'R', 'L'],
  hot: ['S', 'R', 'L'],
};

// Germania's house pump standard — iced and frozen share the
// quantities; hot gets +1 pump per size. Falls back when a syrup or
// sauce preset doesn't carry per-temperature defaults of its own.
//   Syrups: 2 / 4 / 6 (iced+frozen), 3 / 5 / 7 (hot)
//   Sauces: 1 / 2 / 3 (iced+frozen), 2 / 3 / 4 (hot)
// Only applies to the standard 3-size table profile (Kids/R/L or S/R/L);
// cortado-style single-column drinks bypass.
const SYRUP_CATEGORIES = new Set(['syrup-haus', 'syrup-monin']);
const SAUCE_CATEGORIES = new Set(['sauce']);

export function standardPumpCells(category: string | null | undefined, temperature: Temperature, sizeCount: number): string[] | null {
  if (sizeCount !== 3) return null;
  const isSyrup = category ? SYRUP_CATEGORIES.has(category) : false;
  const isSauce = category ? SAUCE_CATEGORIES.has(category) : false;
  if (!isSyrup && !isSauce) return null;
  if (isSyrup) {
    return temperature === 'hot' ? ['3 pumps', '5 pumps', '7 pumps'] : ['2 pumps', '4 pumps', '6 pumps'];
  }
  // sauce
  return temperature === 'hot' ? ['2 pumps', '3 pumps', '4 pumps'] : ['1 pump', '2 pumps', '3 pumps'];
}
