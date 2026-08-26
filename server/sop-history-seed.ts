import type { Database } from 'better-sqlite3';

// Historical seasonal drink SOPs (Fall 2022 / 2023 / 2024), translated
// from the Menu Team's Google Docs into the SOP system so every past
// drink is browsable, printable, and duplicable as the starting point
// for a new season. Fall 2025 is NOT seeded here — those SOPs already
// live in the dashboard (entered by hand).
//
// Seeding is strictly ADDITIVE and idempotent: a drink is inserted only
// if its slug doesn't exist yet, so edits made in the UI afterwards are
// never clobbered by a redeploy. Deleting a seeded SOP in the UI will
// bring it back on next boot — deactivate/edit instead, or remove it
// from this list.

type SeedRow = {
  name: string;
  modifier?: string | null;
  cells: string[];
};

type SeedVariant = {
  temperature: 'iced' | 'frozen' | 'hot';
  sizeLabels: string[];
  footnotes?: string[];
  rows: SeedRow[];
};

type SeedSop = {
  slug: string;
  name: string;
  collection: string;
  dietaryTags?: string | null;
  drinkContains?: string | null;
  refrigerationNote?: string | null;
  subtitle?: string | null;
  availability?: string | null;
  availabilityNote?: string | null;
  variants: SeedVariant[];
};

// ── Row shorthands (the house standard builds) ──────────────────────
const same = (v: string): string[] => [v, v, v];
const ESPRESSO_HOT: SeedRow = { name: 'Espresso', cells: ['1 Shot', '2 Shots', '3 Shots'] };
const COLD_BREW_ICED: SeedRow = { name: 'Cold Brew', cells: ['0.5 small bell', '1 small bell', '1 large bell'] };
const MILK_ICED: SeedRow = { name: 'Milk', cells: ['1.5 small bells', '3 small bells', '2.5 large bells'] };
const MILK_FROZEN: SeedRow = { name: 'Milk', cells: ['0.5 small bell', '1 small bell', '1 large bell'] };
const POLAR: SeedRow = { name: 'Polar Powder', cells: ['1 red scoop', '2 red scoops', '2 white scoops'] };
const STEAMED_MILK: SeedRow = { name: 'Steamed Milk', cells: same('Stir & fill') };
const ICE_HEAP: SeedRow = { name: 'Ice', cells: same('Heaping cup') };
const ICE_FILL_STIR: SeedRow = { name: 'Ice', cells: same('After stirring, fill to top') };
const ICE_FILL: SeedRow = { name: 'Ice', cells: same('Fill Cup') };
const BSC_DUST: SeedRow = { name: 'Brown Sugar & Cinnamon', cells: same('Dust on top') };
const HH_FROZEN: SeedRow = { name: 'Half & Half', cells: ['1 small bell', '2 small bells', '2 large bells'] };

const SIZES_HOT = ['S', 'R', 'L'];
const SIZES_ICED = ['Kids', 'R', 'L'];

/** Footnotes are stored as {marker, text} objects (the PDF renders
 *  "{marker} {text}"). Seed data keeps plain strings for readability;
 *  this splits a leading run of asterisks into the marker and falls
 *  back to a bullet for un-starred notes. */
function toFootnote(s: string): { marker: string; text: string } {
  const m = s.match(/^(\*+)\s*(.*)$/s);
  if (m) return { marker: m[1], text: m[2] };
  return { marker: '•', text: s };
}

/** One-time fixup: earlier versions of this seed wrote footnotes as
 *  plain string arrays, which render as "undefined undefined" in the
 *  editor/PDF. Rewrite any string entries into {marker, text} objects.
 *  Idempotent — object entries pass through untouched. */
export function fixLegacyStringFootnotes(db: Database) {
  const rows = db.prepare('SELECT id, footnotes_json FROM sop_variants').all() as Array<{ id: number; footnotes_json: string }>;
  let fixed = 0;
  for (const r of rows) {
    let parsed: unknown;
    try { parsed = JSON.parse(r.footnotes_json); } catch { continue; }
    if (!Array.isArray(parsed) || !parsed.some((f) => typeof f === 'string')) continue;
    const converted = parsed.map((f) => (typeof f === 'string' ? toFootnote(f) : f));
    db.prepare('UPDATE sop_variants SET footnotes_json = ? WHERE id = ?').run(JSON.stringify(converted), r.id);
    fixed++;
  }
  if (fixed > 0) console.log(`[sop-history-seed] fixed ${fixed} legacy string footnote list(s)`);
}

const CB_FOOTNOTE = '* = If the customer asks for half & half (etc), reduce the water by that amount.';
const RED_SCOOP_FOOTNOTE = '* = Red Polar Powder scoop';
const STEAM_TOGETHER_FOOTNOTE = '* — steam chai and milk together';

const SOPS: SeedSop[] = [
  // ═══════════════════ FALL 2022 ═══════════════════
  {
    slug: 'apple-butter-latte-fall-2022',
    name: 'Apple Butter Latte',
    collection: 'Fall 2022',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Haus Apple Butter Syrup', cells: ['3 pumps', '5 pumps', '7 pumps'] }, STEAMED_MILK, BSC_DUST],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [COLD_BREW_ICED, MILK_ICED, { name: 'Haus Apple Butter Syrup', cells: ['2 pumps', '4 pumps', '6 pumps'] }, ICE_FILL_STIR, BSC_DUST],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [POLAR, COLD_BREW_ICED, MILK_FROZEN, { name: 'Haus Apple Butter Syrup', cells: ['2 pumps', '4 pumps', '6 pumps'] }, ICE_HEAP, BSC_DUST],
      },
    ],
  },
  {
    slug: 'breakfast-latte-fall-2022',
    name: 'Breakfast Latte',
    collection: 'Fall 2022',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Monin Maple Pancake', cells: ['1.5 Pumps', '2.5 Pumps', '3.5 Pumps'] }, { name: 'Monin Brown Sugar', cells: ['1.5 Pumps', '2.5 Pumps', '3.5 Pumps'] }, STEAMED_MILK, BSC_DUST],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [COLD_BREW_ICED, MILK_ICED, { name: 'Monin Maple Pancake', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, { name: 'Monin Brown Sugar', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, ICE_FILL, BSC_DUST],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [POLAR, COLD_BREW_ICED, MILK_FROZEN, { name: 'Monin Maple Pancake', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, { name: 'Monin Brown Sugar', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, ICE_HEAP, BSC_DUST],
      },
    ],
  },
  {
    slug: 'butterbeer-fall-2022',
    name: 'Butterbeer',
    collection: 'Fall 2022',
    variants: [
      {
        temperature: 'iced', sizeLabels: ['R'],
        footnotes: [
          'After adding flavors — stir *lightly* so as to preserve carbonation as much as possible.',
          'Serve with SIP lid, not a dome lid.',
        ],
        rows: [
          { name: "Fitz's Cream Soda", cells: ['Entire Bottle'] },
          { name: 'Monin Caramel', cells: ['1 pump'] },
          { name: 'Monin Toffee Nut', cells: ['2 pumps'] },
          { name: 'Ice', cells: ['NONE'] },
          { name: 'Whipped Cream', cells: ['Always'] },
          { name: 'Caramel Drizzle', cells: ['Always'] },
        ],
      },
    ],
  },
  {
    slug: 'cinnamon-apple-chai-fall-2022',
    name: 'Cinnamon Apple Chai',
    collection: 'Fall 2022',
    subtitle: 'When the Oregon Extra Spicy Chai returns, this SOP will need to be modified.',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        footnotes: [STEAM_TOGETHER_FOOTNOTE],
        rows: [
          { name: '*Oregon Spiced Chai', cells: ['1 small bell', '0.75 large bells', '1 large bell'] },
          { name: '*Milk', cells: ['3 small bells', '2.25 large bells', '3 large bells'] },
          { name: 'Haus Apple Butter Syrup', cells: ['2 pumps', '3 pumps', '4 pumps'] },
          BSC_DUST,
        ],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [
          { name: 'Oregon Spiced Chai', cells: ['0.5 small bell', '1 small bell', '1 large bell'] },
          { name: 'Milk', cells: ['1.5 small bells', '3 small bells', '2.5 large bells'] },
          { name: 'Haus Apple Butter Syrup', cells: ['1.5 pumps', '2.5 pumps', '3.5 pumps'] },
          { name: 'Ice', cells: same('Fill to top after stirring') },
          BSC_DUST,
        ],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [
          POLAR,
          { name: 'Oregon Spiced Chai', cells: ['0.5 small bell', '1 small bell', '1 large bell'] },
          MILK_FROZEN,
          { name: 'Haus Apple Butter Syrup', cells: ['1.5 pumps', '2.5 pumps', '3.5 pumps'] },
          ICE_HEAP,
          { name: 'Brown Sugar & Cinnamon', cells: same('Dust on top after blending') },
        ],
      },
    ],
  },
  {
    slug: 'rosa-mego-cold-brew-fall-2022',
    name: 'Rosa Mego Cold Brew',
    collection: 'Fall 2022',
    subtitle: 'Goshen collab',
    variants: [
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        footnotes: [CB_FOOTNOTE],
        rows: [
          { name: 'Rosa Mego CB', cells: ['1 small bell', '2 small bells', '1.75 large bells'] },
          { name: 'Water', cells: ['*1 small bell', '*2 small bells', '*1.75 large bells'] },
          { name: 'Half & Half (or other milk)', modifier: '(optional)', cells: ['*0.25 small bell', '*0.5 small bell', '*0.5 large bell'] },
        ],
      },
    ],
  },
  {
    slug: 'maple-cinnamon-cold-brew-fall-2022',
    name: 'Maple Cinnamon Cold Brew',
    collection: 'Fall 2022',
    variants: [
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        footnotes: [CB_FOOTNOTE],
        rows: [
          { name: 'Maple Cinnamon CB', cells: ['1 small bell', '2 small bells', '1.75 large bells'] },
          { name: 'Water', cells: ['*1 small bell', '*2 small bells', '*1.75 large bells'] },
          { name: 'Half & Half (or other milk)', modifier: '(optional)', cells: ['*0.25 small bell', '*0.5 small bell', '*0.5 large bell'] },
        ],
      },
    ],
  },
  {
    slug: 'count-chocula-milkshake-fall-2022',
    name: 'Count Chocula Milkshake',
    collection: 'Fall 2022',
    subtitle: 'Frozen only — Halloween special',
    variants: [
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        footnotes: [RED_SCOOP_FOOTNOTE],
        rows: [
          { name: 'HC Powder', modifier: '(NOT Polar Powder)', cells: ['1 red', '2 red', '3 red'] },
          HH_FROZEN,
          { name: 'Monin Dark Chocolate', cells: ['0.5 pump', '1 pump', '1.5 pumps'] },
          { name: 'Monin Toasted Marshmallow', cells: ['1 pump', '2 pumps', '3 pumps'] },
          { name: '*Count Chocula Cereal', modifier: '(double from normal)', cells: ['2 red scoops', '4 red scoops', '6 red scoops'] },
          { name: 'Ice', cells: same('Heaping Cup') },
          { name: 'Chocolate Drizzle', cells: same('Yes') },
          { name: 'Count Chocula Cereal', cells: same('Sprinkle on top with red scoop') },
        ],
      },
    ],
  },
  {
    slug: 'boo-berry-milkshake-fall-2022',
    name: 'Boo Berry Milkshake',
    collection: 'Fall 2022',
    subtitle: 'Frozen only — Halloween special',
    variants: [
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        footnotes: [RED_SCOOP_FOOTNOTE],
        rows: [
          { name: 'Polar Powder', cells: ['1 red', '2 red', '2 white'] },
          HH_FROZEN,
          { name: 'Monin Blueberry', cells: ['1 pump', '2 pumps', '3 pumps'] },
          { name: 'Torani Vanilla', cells: ['1 pump', '2 pumps', '3 pumps'] },
          { name: '*Boo Berry Cereal', modifier: '(double from normal)', cells: ['2 red scoops', '4 red scoops', '6 red scoops'] },
          { name: 'Ice', cells: same('Heaping Cup') },
          { name: 'Boo Berry Cereal', cells: same('Sprinkle on top with red scoop') },
        ],
      },
    ],
  },
  {
    slug: 'obb-porter-latte-fall-2022',
    name: 'OBB Porter Latte',
    collection: 'Fall 2022',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Haus Porter Syrup', modifier: '(extra pump)', cells: ['4 pumps', '6 pumps', '8 pumps'] }, STEAMED_MILK],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [COLD_BREW_ICED, MILK_ICED, { name: 'Haus Porter Syrup', modifier: '(extra pump)', cells: ['3 pumps', '5 pumps', '7 pumps'] }, ICE_FILL_STIR],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [POLAR, COLD_BREW_ICED, MILK_FROZEN, { name: 'Haus Porter Syrup', modifier: '(extra pump)', cells: ['3 pumps', '5 pumps', '7 pumps'] }, ICE_HEAP],
      },
    ],
  },
  {
    slug: 'pumpkin-spice-latte-fall-2022',
    name: 'Pumpkin Spice Latte',
    collection: 'Fall 2022',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'DaVinci Pumpkin Pie Sauce', cells: ['1 Pump', '1.5 Pumps', '2 Pumps'] }, { name: 'Monin Brown Sugar', cells: ['1.5 Pumps', '2.5 Pumps', '3.5 Pumps'] }, STEAMED_MILK, { name: 'Pumpkin Spice', cells: same('Dust on top') }],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [COLD_BREW_ICED, MILK_ICED, { name: 'DaVinci Pumpkin Pie Sauce', cells: ['0.5 Pump', '1 Pump', '1.5 Pumps'] }, { name: 'Monin Brown Sugar', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, ICE_FILL, { name: 'Pumpkin Spice', cells: same('Dust on top') }],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [POLAR, COLD_BREW_ICED, MILK_FROZEN, { name: 'DaVinci Pumpkin Pie Sauce', cells: ['0.5 Pump', '1 Pump', '1.5 Pumps'] }, { name: 'Monin Brown Sugar', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, ICE_HEAP, { name: 'Pumpkin Spice', cells: same('Dust on top') }],
      },
    ],
  },
  {
    slug: 'smores-pop-tart-milkshake-fall-2022',
    name: "S'mores Pop Tart Milkshake",
    collection: 'Fall 2022',
    subtitle: 'Frozen only',
    variants: [
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        footnotes: [RED_SCOOP_FOOTNOTE],
        rows: [
          { name: 'Polar Powder', modifier: '(NOT HC Powder)', cells: ['1 red', '2 red', '2 white'] },
          HH_FROZEN,
          { name: 'Monin Dark Chocolate', cells: ['0.5 pump', '1 pump', '1.5 pumps'] },
          { name: 'Monin Toasted Marshmallow', cells: ['1 pump', '2 pumps', '3 pumps'] },
          { name: "*S'mores Pop Tart", modifier: '(crumbled)', cells: ['1 red scoop', '2 red scoops', '3 red scoops'] },
          { name: 'Ice', cells: same('Heaping Cup') },
          { name: 'Chocolate Drizzle', cells: same('Yes') },
          { name: "*S'mores Pop Tart", modifier: '(crumbled, on top)', cells: same('Sprinkle on top with red scoop') },
        ],
      },
    ],
  },

  // ═══════════════════ FALL 2023 ═══════════════════
  {
    slug: 'apple-butter-latte-fall-2023',
    name: 'Apple Butter Latte',
    collection: 'Fall 2023',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Haus Apple Butter Sauce', cells: ['2 pumps', '3 pumps', '4 pumps'] }, STEAMED_MILK, BSC_DUST],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [COLD_BREW_ICED, MILK_ICED, { name: 'Haus Apple Butter Sauce', cells: ['1 pump', '2 pumps', '3 pumps'] }, ICE_FILL_STIR, BSC_DUST],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [POLAR, COLD_BREW_ICED, MILK_FROZEN, { name: 'Haus Apple Butter Sauce', cells: ['1 pump', '2 pumps', '3 pumps'] }, ICE_HEAP, BSC_DUST],
      },
    ],
  },
  {
    slug: 'apple-jacks-milkshake-fall-2023',
    name: 'Apple Jacks Milkshake',
    collection: 'Fall 2023',
    subtitle: 'Frozen only',
    variants: [
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        footnotes: [
          '* Pre-mix the syrup in a syrup bottle: Monin Cinnamon 18 oz (6 small bells) + Monin Caramel Apple Butter 6 oz (2 small bells) = 24 oz total. Fits either size syrup bottle.',
          '** = Red Polar Powder scoop',
        ],
        rows: [
          { name: 'Polar Powder', cells: ['1 red', '2 red', '2 white'] },
          HH_FROZEN,
          { name: 'Cinnamon & Apple Butter Syrup', modifier: '(pre-mixed — see note *)', cells: ['2 pumps', '4 pumps', '6 pumps'] },
          { name: '**Apple Jacks', modifier: '(extra scoop vs. normal)', cells: ['2 scoops', '3 scoops', '4 scoops'] },
          { name: 'Ice', cells: same('Heaping Cup') },
        ],
      },
    ],
  },
  {
    slug: 'breakfast-latte-fall-2023',
    name: 'Breakfast Latte',
    collection: 'Fall 2023',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Monin Maple Pancake', cells: ['1.5 Pumps', '2.5 Pumps', '3.5 Pumps'] }, { name: 'Monin Brown Sugar', cells: ['1.5 Pumps', '2.5 Pumps', '3.5 Pumps'] }, STEAMED_MILK, BSC_DUST],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [COLD_BREW_ICED, MILK_ICED, { name: 'Monin Maple Pancake', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, { name: 'Monin Brown Sugar', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, ICE_FILL, BSC_DUST],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [POLAR, COLD_BREW_ICED, MILK_FROZEN, { name: 'Monin Maple Pancake', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, { name: 'Monin Brown Sugar', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, ICE_HEAP, BSC_DUST],
      },
    ],
  },
  {
    slug: 'cinnamon-apple-chai-fall-2023',
    name: 'Cinnamon Apple Chai',
    collection: 'Fall 2023',
    subtitle: 'NOTE: not our normal chai (white jug) — Oregon "Spiced Chai," red carton.',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        footnotes: [STEAM_TOGETHER_FOOTNOTE],
        rows: [
          { name: '*Oregon Spiced Chai', modifier: '(red carton)', cells: ['1 small bell', '0.75 large bells', '1 large bell'] },
          { name: '*Milk', cells: ['3 small bells', '2.25 large bells', '3 large bells'] },
          { name: 'Haus Apple Butter Sauce', cells: ['1 pump', '1.5 pumps', '2 pumps'] },
          BSC_DUST,
        ],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [
          { name: 'Oregon Spiced Chai', modifier: '(red carton)', cells: ['0.5 small bell', '1 small bell', '1 large bell'] },
          { name: 'Milk', cells: ['1.5 small bells', '3 small bells', '2.5 large bells'] },
          { name: 'Haus Apple Butter Sauce', cells: ['1 pump', '1.5 pumps', '2 pumps'] },
          { name: 'Ice', cells: same('Fill to top after stirring') },
          BSC_DUST,
        ],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [
          POLAR,
          { name: 'Oregon Spiced Chai', modifier: '(red carton)', cells: ['0.5 small bell', '1 small bell', '1 large bell'] },
          MILK_FROZEN,
          { name: 'Haus Apple Butter Sauce', cells: ['1 pump', '1.5 pumps', '2 pumps'] },
          ICE_HEAP,
          { name: 'Brown Sugar & Cinnamon', cells: same('Dust on top after blending') },
        ],
      },
    ],
  },
  {
    slug: 'golden-flat-white-fall-2023',
    name: 'Golden Flat White',
    collection: 'Fall 2023',
    subtitle: 'Hot Small only',
    variants: [
      {
        temperature: 'hot', sizeLabels: ['S'],
        footnotes: ['Steaming: more aeration than a typical latte — aim between latte & cappuccino. SUBTLE aeration, not aggressive.'],
        rows: [
          { name: 'Espresso', cells: ['TWO shots'] },
          { name: 'Haus Golden Syrup', cells: ['3 pumps'] },
          { name: 'Steamed Milk', cells: ['Stir & fill'] },
        ],
      },
    ],
  },
  {
    slug: 'horchata-fall-2023',
    name: 'Horchata',
    collection: 'Fall 2023',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [
          { name: 'Haus Horchata', modifier: '(steamed)', cells: ['4 small bells', '3 large bells', '4 large bells'] },
          { name: 'Cinnamon Dust', cells: same('On top') },
        ],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_HOT,
        rows: [
          { name: 'Haus Horchata', cells: ['2 small bells', '4 small bells', '3.5 large bells'] },
          { name: 'Ice', cells: same('Fill to top') },
          { name: 'Cinnamon Dust', cells: same('On top') },
        ],
      },
    ],
  },
  {
    slug: 'pumpkin-spice-latte-fall-2023',
    name: 'Pumpkin Spice Latte',
    collection: 'Fall 2023',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Haus Pumpkin Sauce', cells: ['3 Pumps', '4 Pumps', '5 Pumps'] }, STEAMED_MILK, { name: 'Pumpkin Spice', cells: same('Dust on top') }],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [COLD_BREW_ICED, MILK_ICED, { name: 'Haus Pumpkin Sauce', cells: ['2 Pumps', '3 Pumps', '4 Pumps'] }, ICE_FILL, { name: 'Pumpkin Spice', cells: same('Dust on top') }],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [POLAR, COLD_BREW_ICED, MILK_FROZEN, { name: 'Haus Pumpkin Sauce', cells: ['2 Pumps', '3 Pumps', '4 Pumps'] }, ICE_HEAP, { name: 'Pumpkin Spice', cells: same('Dust on top') }],
      },
    ],
  },
  {
    slug: 'smores-latte-fall-2023',
    name: "S'mores Latte",
    collection: 'Fall 2023',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Haus Recipe Smores Sauce', cells: ['2 pumps', '3 pumps', '4 pumps'] }, STEAMED_MILK, { name: 'Dark Chocolate Drizzle', cells: same('On top') }, { name: 'Mini Mallows', cells: same('Sprinkle on top') }],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [COLD_BREW_ICED, MILK_ICED, { name: 'Haus Recipe Smores Sauce', cells: ['1 pump', '2 pumps', '3 pumps'] }, ICE_FILL_STIR, { name: 'Dark Chocolate Drizzle', cells: same('On top') }, { name: 'Mini Mallows', cells: same('Sprinkle on top') }],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [POLAR, COLD_BREW_ICED, MILK_FROZEN, { name: 'Haus Recipe Smores Sauce', cells: ['1 pump', '2 pumps', '3 pumps'] }, ICE_HEAP, { name: 'Dark Chocolate Drizzle', cells: same('Sides & Top') }, { name: 'Mini Mallows', cells: same('Sprinkle on top') }],
      },
    ],
  },

  // ═══════════════════ FALL 2024 ═══════════════════
  {
    slug: 'apple-butter-latte-fall-2024',
    name: 'Apple Butter Latte',
    collection: 'Fall 2024',
    dietaryTags: 'DF, GF, Vegan',
    refrigerationNote: 'Refrigerate',
    availability: '1st Half Only',
    availabilityNote: 'Not featured on-menu after mid-October 2024, but the Apple Butter Sauce stays on-hand (Cinnamon Apple Chai) so it can still be made on request.',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Haus Apple Butter Sauce', cells: ['2 pumps', '3 pumps', '4 pumps'] }, STEAMED_MILK, BSC_DUST],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [COLD_BREW_ICED, MILK_ICED, { name: 'Haus Apple Butter Sauce', cells: ['1 pump', '2 pumps', '3 pumps'] }, ICE_FILL_STIR, BSC_DUST],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [POLAR, COLD_BREW_ICED, MILK_FROZEN, { name: 'Haus Apple Butter Sauce', cells: ['1 pump', '2 pumps', '3 pumps'] }, ICE_HEAP, BSC_DUST],
      },
    ],
  },
  {
    slug: 'bourbon-butterscotch-latte-fall-2024',
    name: 'Bourbon Butterscotch Latte',
    collection: 'Fall 2024',
    dietaryTags: 'GF',
    drinkContains: 'Dairy, Soy',
    refrigerationNote: 'Refrigerate or On Ice',
    subtitle: 'Alcohol is reduced during the cooking process.',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Haus Made Bourbon Butterscotch', cells: ['2 pumps', '3 pumps', '4 pumps'] }, STEAMED_MILK],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [
          { name: 'Cold Brew', cells: ['½ 3-oz bell', '1 3-oz bell', '1 5-oz bell'] },
          { name: 'Milk', cells: ['1½ 3-oz bells', '3 3-oz bells', '2½ 5-oz bells'] },
          { name: 'Haus Made Bourbon Butterscotch', cells: ['1 pump', '2 pumps', '3 pumps'] },
          { name: 'Ice', cells: same('Fill to top after stirring') },
        ],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [
          POLAR,
          { name: 'Cold Brew', cells: ['½ 3-oz bell', '1 3-oz bell', '1 5-oz bell'] },
          { name: 'Milk', cells: ['½ 3-oz bell', '1 3-oz bell', '1 5-oz bell'] },
          { name: 'Haus Made Bourbon Butterscotch', cells: ['1 pump', '2 pumps', '3 pumps'] },
          ICE_HEAP,
        ],
      },
    ],
  },
  {
    slug: 'breakfast-latte-fall-2024',
    name: 'Breakfast Latte',
    collection: 'Fall 2024',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Monin Maple Pancake', cells: ['1.5 Pumps', '2.5 Pumps', '3.5 Pumps'] }, { name: 'Monin Brown Sugar', cells: ['1.5 Pumps', '2.5 Pumps', '3.5 Pumps'] }, STEAMED_MILK, BSC_DUST],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [COLD_BREW_ICED, MILK_ICED, { name: 'Monin Maple Pancake', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, { name: 'Monin Brown Sugar', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, ICE_FILL, BSC_DUST],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [POLAR, COLD_BREW_ICED, MILK_FROZEN, { name: 'Monin Maple Pancake', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, { name: 'Monin Brown Sugar', cells: ['1 Pump', '2 Pumps', '3 Pumps'] }, ICE_HEAP, BSC_DUST],
      },
    ],
  },
  {
    slug: 'butterbeer-fall-2024',
    name: 'Butterbeer',
    collection: 'Fall 2024',
    availability: '2nd Half Only',
    availabilityNote: 'Not available until mid-October 2024.',
    variants: [
      {
        temperature: 'iced', sizeLabels: ['R'],
        footnotes: [
          'After adding flavors — stir *lightly* so as to preserve carbonation as much as possible.',
          'Serve with SIP lid, not a dome lid.',
        ],
        rows: [
          { name: 'Cream Soda', cells: ['Entire Bottle'] },
          { name: 'Bourbon Butterscotch', cells: ['1 pump'] },
          { name: 'Ice', cells: ['NONE'] },
          { name: 'Whipped Cream', cells: ['Always'] },
          { name: 'Caramel Drizzle', cells: ['Always'] },
        ],
      },
    ],
  },
  {
    slug: 'chocolate-covered-pomegranate-latte-fall-2024',
    name: 'Chocolate Covered Pomegranate Latte',
    collection: 'Fall 2024',
    dietaryTags: 'DF, GF, Vegan',
    refrigerationNote: 'Refrigerate',
    availability: '2nd Half Only',
    availabilityNote: 'Not available until mid-October 2024.',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Chocolate Covered Pomegranate Sauce', cells: ['2 pumps', '3 pumps', '4 pumps'] }, STEAMED_MILK],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [
          { name: 'Cold Brew', cells: ['½ 3-oz bell', '1 3-oz bell', '1 5-oz bell'] },
          { name: 'Milk', cells: ['1½ 3-oz bells', '3 3-oz bells', '2½ 5-oz bells'] },
          { name: 'Chocolate Covered Pomegranate Sauce', cells: ['1 pump', '2 pumps', '3 pumps'] },
          { name: 'Ice', cells: same('Fill to top after stirring') },
        ],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [
          POLAR,
          { name: 'Cold Brew', cells: ['½ 3-oz bell', '1 3-oz bell', '1 5-oz bell'] },
          { name: 'Milk', cells: ['½ 3-oz bell', '1 3-oz bell', '1 5-oz bell'] },
          { name: 'Chocolate Covered Pomegranate Sauce', cells: ['1 pump', '2 pumps', '3 pumps'] },
          ICE_HEAP,
        ],
      },
    ],
  },
  {
    slug: 'cinnamon-apple-chai-fall-2024',
    name: 'Cinnamon Apple Chai',
    collection: 'Fall 2024',
    dietaryTags: 'DF, GF, Vegan',
    refrigerationNote: 'Refrigerate',
    availability: '2nd Half Only',
    availabilityNote: 'Not featured on-menu until mid-October 2024, but the Apple Butter Sauce is on-hand (Apple Butter Latte) so it can still be made on request.',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        footnotes: [STEAM_TOGETHER_FOOTNOTE],
        rows: [
          { name: '*Oregon Spiced Chai', modifier: '(red carton)', cells: ['½ large bell', '1 small bell', '¾ large bell'] },
          { name: '*Milk', cells: ['1½ large bells', '3 small bells', '2¼ large bells'] },
          { name: 'Haus Apple Butter Sauce', cells: ['1 pump', '1.5 pumps', '2 pumps'] },
          BSC_DUST,
        ],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [
          { name: 'Oregon Spiced Chai', modifier: '(red carton)', cells: ['½ small bell', '1 small bell', '1 large bell'] },
          { name: 'Milk', cells: ['1½ small bells', '3 small bells', '2½ large bells'] },
          { name: 'Haus Apple Butter Sauce', cells: ['1 pump', '1.5 pumps', '2 pumps'] },
          { name: 'Ice', cells: same('Fill to top after stirring') },
          BSC_DUST,
        ],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [
          POLAR,
          { name: 'Oregon Spiced Chai', modifier: '(red carton)', cells: ['½ small bell', '1 small bell', '1 large bell'] },
          { name: 'Milk', cells: ['½ small bell', '1 small bell', '1 large bell'] },
          { name: 'Haus Apple Butter Sauce', cells: ['1 pump', '1.5 pumps', '2 pumps'] },
          ICE_HEAP,
          { name: 'Brown Sugar & Cinnamon', cells: same('Dust on top after blending') },
        ],
      },
    ],
  },
  {
    slug: 'cinnamon-toast-crunch-milkshake-fall-2024',
    name: 'Cinnamon Toast Crunch Milkshake',
    collection: 'Fall 2024',
    subtitle: 'Frozen only',
    variants: [
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        footnotes: [RED_SCOOP_FOOTNOTE],
        rows: [
          { name: 'Polar Powder', cells: ['1 red', '2 red', '2 white'] },
          HH_FROZEN,
          { name: 'Torani Vanilla', cells: ['1 pump', '2 pumps', '3 pumps'] },
          { name: 'Monin Honey', cells: ['1 pump', '2 pumps', '3 pumps'] },
          { name: '*CTC Cereal', cells: ['1 red scoop', '2 red scoops', '3 red scoops'] },
          { name: 'Ice', cells: same('Heaping Cup') },
          { name: 'Cinnamon', cells: same('Dust on top after pouring') },
        ],
      },
    ],
  },
  {
    slug: 'horchata-fall-2024',
    name: 'Horchata',
    collection: 'Fall 2024',
    dietaryTags: 'DF, GF, Vegan',
    refrigerationNote: 'Refrigerate',
    subtitle: 'ALWAYS shake the gallon container well before preparing this drink.',
    availability: '1st Half Only',
    availabilityNote: 'Available ONLY through mid-October 2024.',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [
          { name: 'Haus Horchata', modifier: '(steamed)', cells: ['4 small bells', '3 large bells', '4 large bells'] },
          { name: 'Cinnamon Dust', cells: same('On top') },
        ],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_HOT,
        rows: [
          { name: 'Haus Horchata', cells: ['2 small bells', '4 small bells', '3.5 large bells'] },
          { name: 'Ice', cells: same('Fill to top') },
          { name: 'Cinnamon Dust', cells: same('On top') },
        ],
      },
    ],
  },
  {
    slug: 'pecan-pie-latte-fall-2024',
    name: 'Pecan Pie Latte',
    collection: 'Fall 2024',
    dietaryTags: 'DF, GF, Vegan',
    drinkContains: 'Nuts',
    refrigerationNote: 'Refrigerate',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Haus Pecan Sauce', modifier: '(EXTRA PUMP)', cells: ['3 Pumps', '4 Pumps', '5 Pumps'] }, STEAMED_MILK, BSC_DUST],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [COLD_BREW_ICED, MILK_ICED, { name: 'Haus Pecan Sauce', modifier: '(EXTRA PUMP)', cells: ['2 Pumps', '3 Pumps', '4 Pumps'] }, ICE_FILL, BSC_DUST],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [POLAR, COLD_BREW_ICED, MILK_FROZEN, { name: 'Haus Pecan Sauce', modifier: '(EXTRA PUMP)', cells: ['2 Pumps', '3 Pumps', '4 Pumps'] }, ICE_HEAP, BSC_DUST],
      },
    ],
  },
  {
    slug: 'pumpkin-spice-latte-fall-2024',
    name: 'Pumpkin Spice Latte',
    collection: 'Fall 2024',
    dietaryTags: 'DF, GF, Vegan',
    refrigerationNote: 'Refrigerate',
    availability: '1st Half Only',
    availabilityNote: 'Available ONLY through mid-October 2024.',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Haus Pumpkin Sauce', modifier: '(EXTRA PUMP)', cells: ['3 Pumps', '4 Pumps', '5 Pumps'] }, STEAMED_MILK, { name: 'Pumpkin Spice', cells: same('Dust on top') }],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [COLD_BREW_ICED, MILK_ICED, { name: 'Haus Pumpkin Sauce', modifier: '(EXTRA PUMP)', cells: ['2 Pumps', '3 Pumps', '4 Pumps'] }, ICE_FILL, { name: 'Pumpkin Spice', cells: same('Dust on top') }],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [POLAR, COLD_BREW_ICED, MILK_FROZEN, { name: 'Haus Pumpkin Sauce', modifier: '(EXTRA PUMP)', cells: ['2 Pumps', '3 Pumps', '4 Pumps'] }, ICE_HEAP, { name: 'Pumpkin Spice', cells: same('Dust on top') }],
      },
    ],
  },
  {
    slug: 'rumbutter-cortado-fall-2024',
    name: 'Rumbutter Cortado',
    collection: 'Fall 2024',
    dietaryTags: 'GF',
    drinkContains: 'Dairy, Soy',
    refrigerationNote: 'Refrigerate or On Ice',
    subtitle: 'Alcohol is reduced during the cooking process.',
    variants: [
      {
        temperature: 'hot', sizeLabels: ['S'],
        rows: [
          { name: 'Espresso', cells: ['2 shots'] },
          { name: 'Haus Rumbutter', cells: ['1.5 pumps (NOT 2)'] },
          { name: 'Steamed Milk', modifier: '(aerate like flat white; between latte & cappuccino)', cells: ['Fill to top'] },
          { name: 'Brown Sugar & Cinnamon', cells: ['Dust on top'] },
        ],
      },
    ],
  },
  {
    slug: 'smores-latte-fall-2024',
    name: "S'mores Latte",
    collection: 'Fall 2024',
    dietaryTags: 'DF, GF',
    refrigerationNote: 'Room Temp',
    availability: '2nd Half Only',
    availabilityNote: 'Not available until mid-October 2024.',
    variants: [
      {
        temperature: 'hot', sizeLabels: SIZES_HOT,
        rows: [ESPRESSO_HOT, { name: 'Haus Recipe Smores Sauce', cells: ['2 pumps', '3 pumps', '4 pumps'] }, STEAMED_MILK, { name: 'Dark Chocolate Drizzle', cells: same('On top') }, { name: 'Mini Mallows', cells: same('Sprinkle on top') }],
      },
      {
        temperature: 'iced', sizeLabels: SIZES_ICED,
        rows: [COLD_BREW_ICED, MILK_ICED, { name: 'Haus Recipe Smores Sauce', cells: ['1 pump', '2 pumps', '3 pumps'] }, ICE_FILL_STIR, { name: 'Dark Chocolate Drizzle', cells: same('On top') }, { name: 'Mini Mallows', cells: same('Sprinkle on top') }],
      },
      {
        temperature: 'frozen', sizeLabels: SIZES_ICED,
        rows: [POLAR, COLD_BREW_ICED, MILK_FROZEN, { name: 'Haus Recipe Smores Sauce', cells: ['1 pump', '2 pumps', '3 pumps'] }, ICE_HEAP, { name: 'Dark Chocolate Drizzle', cells: same('Sides & Top') }, { name: 'Mini Mallows', cells: same('Sprinkle on top') }],
      },
    ],
  },
];

export function seedSopHistory(db: Database) {
  const exists = db.prepare('SELECT 1 FROM sops WHERE slug = ?');
  const existsByNameCollection = db.prepare('SELECT 1 FROM sops WHERE name = ? AND collection = ?');
  const insertSop = db.prepare(`
    INSERT INTO sops (slug, name, collection, dietary_tags, drink_contains, refrigeration_note, subtitle, availability, availability_note, kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'drink')
  `);
  const insertVariant = db.prepare(`
    INSERT INTO sop_variants (sop_id, temperature, position, size_labels_json, footnotes_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertRow = db.prepare(`
    INSERT INTO sop_rows (variant_id, position, name, modifier, cells_json)
    VALUES (?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  const tx = db.transaction(() => {
    for (const sop of SOPS) {
      if (exists.get(sop.slug)) continue;
      // Someone may have entered the same drink+collection by hand
      // with a different slug — don't duplicate it.
      if (existsByNameCollection.get(sop.name, sop.collection)) continue;
      const info = insertSop.run(
        sop.slug, sop.name, sop.collection,
        sop.dietaryTags ?? null, sop.drinkContains ?? null, sop.refrigerationNote ?? null,
        sop.subtitle ?? null, sop.availability ?? null, sop.availabilityNote ?? null,
      );
      const sopId = info.lastInsertRowid as number;
      sop.variants.forEach((v, vi) => {
        const vinfo = insertVariant.run(
          sopId, v.temperature, vi,
          JSON.stringify(v.sizeLabels), JSON.stringify((v.footnotes ?? []).map(toFootnote)),
        );
        const variantId = vinfo.lastInsertRowid as number;
        v.rows.forEach((r, ri) => {
          insertRow.run(variantId, ri, r.name, r.modifier ?? null, JSON.stringify(r.cells));
        });
      });
      inserted++;
    }
  });
  tx();
  if (inserted > 0) console.log(`[sop-history-seed] inserted ${inserted} historical SOP(s)`);
  fixLegacyStringFootnotes(db);
}
