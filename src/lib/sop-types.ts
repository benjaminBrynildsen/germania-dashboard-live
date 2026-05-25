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

export type Sop = {
  id?: number;
  slug: string;
  name: string;
  collection?: string | null;
  dietaryTags?: string | null;
  syrupDietaryTags?: string | null;
  drinkContains?: string | null;
  refrigerationNote?: string | null;
  variants: SopVariant[];
  createdAt?: number;
  updatedAt?: number;
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
