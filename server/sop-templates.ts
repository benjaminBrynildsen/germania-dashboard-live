import type { Database } from 'better-sqlite3';
import type { Sop, SopRow, SopVariant, Temperature } from '../src/lib/sop-types.js';

// Bundled drink-shape starter templates. Each template defines the
// variants + ordered rows that match a common Germania drink pattern;
// users can then drop into the editor and adjust amounts or swap one
// preset for another rather than rebuilding from scratch each time.
//
// Rows reference presets by slug — the server resolves the preset at
// expand time and copies its name, default_modifier, and per-temperature
// default cells. Override `name` / `modifier` / `cells` on a row to
// take literal values instead.

type TemplateRow = {
  presetSlug?: string;
  name?: string;
  modifier?: string | null;
  cells?: string[]; // fixed cells; otherwise pulled from preset defaults for the temperature
};

type TemplateVariant = {
  temperature: Temperature;
  sizeLabels: string[];
  rows: TemplateRow[];
};

export type DrinkTemplate = {
  slug: string;
  name: string;
  description: string;
  variants: TemplateVariant[];
};

const SIZES_ICED: string[] = ['Kids', 'R', 'L'];
const SIZES_HOT: string[] = ['S', 'R', 'L'];
const SIZES_CORTADO: string[] = ['8 oz ripple cup'];

export const TEMPLATES: DrinkTemplate[] = [
  // ── Lattes ────────────────────────────────────────────────────────
  {
    slug: 'iced-latte',
    name: 'Iced Latte',
    description: 'Espresso (not cold brew) + milk + syrup + ice. Kids · R · L.',
    variants: [
      {
        temperature: 'iced',
        sizeLabels: SIZES_ICED,
        rows: [
          { presetSlug: 'espresso-not-cold-brew' },
          { presetSlug: 'milk' },
          { name: 'Haus Syrup', modifier: '(swap to chosen syrup)', cells: ['', '', ''] },
          { presetSlug: 'ice-fill-to-top' },
        ],
      },
    ],
  },
  {
    slug: 'hot-latte',
    name: 'Hot Latte',
    description: 'Espresso + syrup + steamed milk. S · R · L.',
    variants: [
      {
        temperature: 'hot',
        sizeLabels: SIZES_HOT,
        rows: [
          { presetSlug: 'espresso' },
          { name: 'Haus Syrup', modifier: '(swap to chosen syrup)', cells: ['', '', ''] },
          { presetSlug: 'steamed-milk' },
        ],
      },
    ],
  },
  {
    slug: 'frozen-latte',
    name: 'Frozen Latte',
    description: 'Polar powder + cold brew + milk + syrup + ice. Kids · R · L.',
    variants: [
      {
        temperature: 'frozen',
        sizeLabels: SIZES_ICED,
        rows: [
          { presetSlug: 'polar-powder' },
          { presetSlug: 'cold-brew' },
          { presetSlug: 'milk' },
          { name: 'Haus Syrup', modifier: '(swap to chosen syrup)', cells: ['', '', ''] },
          { presetSlug: 'ice-heaping-cup' },
        ],
      },
    ],
  },
  {
    slug: 'full-latte-set',
    name: 'Full Latte Set (Iced + Frozen + Hot)',
    description: 'All three temperature variants in one go — matches drinks like Sunshine Latte or Lemon White Mocha.',
    variants: [
      {
        temperature: 'iced',
        sizeLabels: SIZES_ICED,
        rows: [
          { presetSlug: 'cold-brew' },
          { presetSlug: 'milk' },
          { name: 'Haus Syrup', modifier: '(swap to chosen syrup)', cells: ['', '', ''] },
          { presetSlug: 'ice-fill-cup' },
        ],
      },
      {
        temperature: 'frozen',
        sizeLabels: SIZES_ICED,
        rows: [
          { presetSlug: 'polar-powder' },
          { presetSlug: 'cold-brew' },
          { presetSlug: 'milk' },
          { name: 'Haus Syrup', modifier: '(swap to chosen syrup)', cells: ['', '', ''] },
          { presetSlug: 'ice-heaping-cup' },
        ],
      },
      {
        temperature: 'hot',
        sizeLabels: SIZES_HOT,
        rows: [
          { presetSlug: 'espresso' },
          { name: 'Haus Syrup', modifier: '(swap to chosen syrup)', cells: ['', '', ''] },
          { presetSlug: 'steamed-milk' },
        ],
      },
    ],
  },

  // ── Frozen shakes / milkshakes ────────────────────────────────────
  {
    slug: 'frozen-milkshake',
    name: 'Frozen Milkshake',
    description: 'Polar powder + half & half + syrup + ice + topping. Kids · R · L. No espresso.',
    variants: [
      {
        temperature: 'frozen',
        sizeLabels: SIZES_ICED,
        rows: [
          { presetSlug: 'polar-powder' },
          { presetSlug: 'half-and-half' },
          { name: 'Haus Syrup', modifier: '(swap to chosen syrup)', cells: ['', '', ''] },
          { presetSlug: 'ice-heaping-cup' },
          { name: 'Topping', modifier: '(optional)', cells: ['', '', ''] },
        ],
      },
    ],
  },

  // ── Tea ───────────────────────────────────────────────────────────
  {
    slug: 'iced-tea',
    name: 'Iced Tea / Tea Concentrate',
    description: 'Tea + concentrate + ice. Kids · R · L.',
    variants: [
      {
        temperature: 'iced',
        sizeLabels: SIZES_ICED,
        rows: [
          { name: 'Concentrate', modifier: '(e.g. Watermelon-Mint)', cells: ['½ Small Bell', '1 Small Bell', '1 Large Bell'] },
          { presetSlug: 'black-tea' },
          { presetSlug: 'ice-fill-to-top-after-stirring' },
        ],
      },
    ],
  },
  {
    slug: 'hot-chai',
    name: 'Hot Chai',
    description: 'Steam chai + milk together, add sauce or sweetener.',
    variants: [
      {
        temperature: 'hot',
        sizeLabels: SIZES_HOT,
        rows: [
          { presetSlug: 'oregon-spiced-chai' },
          { presetSlug: 'milk' },
          { name: 'Sauce / Sweetener', modifier: '(optional — e.g. Haus Pumpkin Sauce)', cells: ['', '', ''] },
          { name: 'Spice', modifier: '(optional dust on top)', cells: ['', '', ''] },
        ],
      },
    ],
  },

  // ── Single-size hot drinks ────────────────────────────────────────
  {
    slug: 'cortado',
    name: 'Cortado (single 8oz)',
    description: '2 shots espresso + syrup + steamed milk in one 8oz ripple cup.',
    variants: [
      {
        temperature: 'hot',
        sizeLabels: SIZES_CORTADO,
        rows: [
          { presetSlug: 'espresso', cells: ['2 shots'] },
          { name: 'Haus Syrup', modifier: '(swap to chosen syrup)', cells: [''] },
          { presetSlug: 'steamed-milk', modifier: '(aerate like flat white; between latte & cappuccino)', cells: ['Fill to top'] },
        ],
      },
    ],
  },

  // ── Cold brew based ──────────────────────────────────────────────
  {
    slug: 'cold-brew-syrup',
    name: 'Sweetened Cold Brew',
    description: 'Cold brew + milk + syrup + ice. Kids · R · L.',
    variants: [
      {
        temperature: 'iced',
        sizeLabels: SIZES_ICED,
        rows: [
          { presetSlug: 'cold-brew' },
          { presetSlug: 'milk' },
          { name: 'Haus Syrup', modifier: '(swap to chosen syrup)', cells: ['', '', ''] },
          { presetSlug: 'ice-fill-cup' },
          { name: 'Cold Foam', modifier: '(optional)', cells: ['', '', ''] },
        ],
      },
    ],
  },
];

type PresetLookup = { name: string; default_modifier: string | null; default_cells_json: string | null };

export function expandTemplate(db: Database, slug: string): Sop['variants'] | null {
  const tpl = TEMPLATES.find((t) => t.slug === slug);
  if (!tpl) return null;
  const presetStmt = db.prepare('SELECT name, default_modifier, default_cells_json FROM sop_presets WHERE slug = ?');
  return tpl.variants.map((v, vi) => {
    const variant: SopVariant = {
      temperature: v.temperature,
      position: vi,
      sizeLabels: [...v.sizeLabels],
      footnotes: [],
      rows: v.rows.map((row): SopRow => {
        let name = row.name ?? '';
        let modifier: string | null = row.modifier ?? null;
        let cells = row.cells ? [...row.cells] : new Array(v.sizeLabels.length).fill('');
        if (row.presetSlug) {
          const p = presetStmt.get(row.presetSlug) as PresetLookup | undefined;
          if (p) {
            if (!name) name = p.name;
            // Row-level modifier wins; otherwise fall through to preset default.
            if (modifier === null) modifier = p.default_modifier;
            if (!row.cells && p.default_cells_json) {
              try {
                const defaults = JSON.parse(p.default_cells_json) as Record<string, string[]>;
                const fromTemp = defaults[v.temperature] || defaults['any'];
                if (fromTemp) {
                  cells = v.sizeLabels.map((_, i) => fromTemp[i] ?? '');
                }
              } catch { /* malformed preset defaults — silently fall back to blanks */ }
            }
          }
        }
        // Ensure cell count matches the variant's size column count
        cells = v.sizeLabels.map((_, i) => cells[i] ?? '');
        return { presetId: null, name, modifier, cells };
      }),
    };
    return variant;
  });
}

export function listTemplates() {
  return TEMPLATES.map((t) => ({
    slug: t.slug,
    name: t.name,
    description: t.description,
    temperatures: t.variants.map((v) => v.temperature),
  }));
}
