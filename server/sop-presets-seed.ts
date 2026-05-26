import type { Database } from 'better-sqlite3';

// Default per-size cell values are stored as a JSON object keyed by
// temperature so the picker can fill in size-appropriate quantities
// when a preset is dropped into an iced vs. hot vs. frozen variant.
// Cells line up with the variant's size_labels array (typically
// 3 entries: Kids/R/L for iced+frozen, S/R/L for hot).
type PresetDefaults = Partial<Record<'iced' | 'frozen' | 'hot' | 'any', string[]>>;

type SeedPreset = {
  slug: string;
  category:
    | 'espresso'
    | 'cold-brew'
    | 'milk'
    | 'powder'
    | 'syrup-haus'
    | 'syrup-monin'
    | 'sauce'
    | 'foam'
    | 'garnish'
    | 'ice'
    | 'topping'
    | 'tea';
  name: string;
  default_modifier?: string;
  defaults?: PresetDefaults;
  sort?: number;
};

const PRESETS: SeedPreset[] = [
  // Espresso / cold brew
  { slug: 'espresso', category: 'espresso', name: 'Espresso', defaults: { hot: ['1 Shot', '2 Shots', '3 Shots'], iced: ['0.5 shot', '1 shot', '2 shots'] } },
  { slug: 'espresso-not-cold-brew', category: 'espresso', name: 'Espresso', default_modifier: '(NOT COLD BREW)', defaults: { iced: ['0.5 shot', '1 shot', '2 shots'], frozen: ['0.5 shot', '1 shot', '2 shots'] } },
  { slug: 'cold-brew', category: 'cold-brew', name: 'Cold Brew', defaults: { iced: ['0.5 small bell', '1 small bell', '1 large bell'], frozen: ['0.5 small bell', '1 small bell', '1 large bell'] } },
  { slug: 'sumatra-dark-roast-cold-brew', category: 'cold-brew', name: 'Sumatra Dark Roast Cold Brew', default_modifier: '(NOT standard cold brew)', defaults: { iced: ['1 small bell', '2 small bells', '1.75 large bells'] } },

  // Milks
  { slug: 'milk', category: 'milk', name: 'Milk', defaults: { iced: ['1.5 small bells', '3 small bells', '2.5 large bells'], frozen: ['0.5 small bell', '1 small bell', '1 large bell'] } },
  { slug: 'steamed-milk', category: 'milk', name: 'Steamed Milk', defaults: { hot: ['Stir & Fill', 'Stir & Fill', 'Stir & Fill'] } },
  { slug: 'half-and-half', category: 'milk', name: 'Half & Half', defaults: { frozen: ['1 small bell', '2 small bells', '2 large bells'] } },
  { slug: 'oat-milk', category: 'milk', name: 'Oat Milk' },
  { slug: 'almond-milk', category: 'milk', name: 'Almond Milk' },
  { slug: 'coconut-milk', category: 'milk', name: 'Coconut Milk' },

  // Powders / bases
  { slug: 'polar-powder', category: 'powder', name: 'Polar Powder', defaults: { frozen: ['1 Red Scoop', '2 Red Scoops', '2 White Scoops'] } },
  { slug: 'matcha-powder', category: 'powder', name: 'Matcha Powder', defaults: { hot: ['0.5 teaspoons', '1 teaspoons', '1.5 Teaspoons'], frozen: ['0.5 Teaspoon', '1 Teaspoon', '1.5 Teaspoon'] } },
  { slug: 'matcha-concentrate', category: 'powder', name: 'Matcha Concentrate', defaults: { iced: ['0.5 small bell', '1 small bell', '1 large bell'] } },
  { slug: 'oregon-spiced-chai', category: 'tea', name: 'Oregon Spiced Chai', defaults: { iced: ['1 small bell', '2 small bells', '1.75 large bells'], hot: ['1 large bell', '2 small bells', '1.5 large bells'] } },
  { slug: 'black-tea', category: 'tea', name: 'Black Tea', defaults: { iced: ['1.5 small bells', '3 small bells', '2.5 large bells'] } },
  { slug: 'hot-water', category: 'powder', name: 'Hot Water', defaults: { hot: ['0.5 small bell', '1 small bell', '1 large bell'] } },
  { slug: 'filtered-water', category: 'powder', name: 'Filtered Water', defaults: { iced: ['1 small bell', '2 small bells', '1.75 large bells'] } },

  // Haus syrups
  { slug: 'haus-vanilla', category: 'syrup-haus', name: 'Haus Vanilla Syrup', defaults: { iced: ['1 Pump', '2 Pumps', '3 Pumps'], hot: ['1.5 Pumps', '2.5 Pumps', '3.5 Pumps'] } },
  { slug: 'haus-white-chocolate', category: 'syrup-haus', name: 'Haus White Chocolate', default_modifier: '(Extra Pump)', defaults: { iced: ['2 Pumps', '3 Pumps', '4 Pumps'], hot: ['3 Pumps', '4 Pumps', '5 Pumps'] } },
  { slug: 'haus-lemon-syrup', category: 'syrup-haus', name: 'Haus Lemon Syrup', default_modifier: '(Standard Pumps)', defaults: { iced: ['1 Pump', '2 Pumps', '3 Pumps'], hot: ['1.5 Pumps', '2.5 pumps', '3 Pumps'] } },
  { slug: 'cinnamon-honey-syrup', category: 'syrup-haus', name: 'Cinnamon Honey Syrup', defaults: { iced: ['2 pumps', '4 pumps', '6 pumps'], hot: ['3 pumps', '5 pumps', '7 pumps'] } },
  { slug: 'haus-peach', category: 'syrup-haus', name: 'Haus Peach Syrup', defaults: { iced: ['2 pumps', '4 pumps', '6 pumps'], hot: ['3 pumps', '5 pumps', '7 pumps'] } },
  { slug: 'haus-lavender', category: 'syrup-haus', name: 'Haus Lavender Syrup' },
  { slug: 'haus-horchata', category: 'syrup-haus', name: 'Haus Horchata Syrup', defaults: { hot: ['3 pumps'] } },
  { slug: 'haus-key-lime', category: 'syrup-haus', name: 'Key Lime Syrup', default_modifier: '(EXTRA PUMP)', defaults: { frozen: ['3 pumps', '5 pumps', '7 pumps'] } },
  { slug: 'haus-pumpkin-sauce', category: 'sauce', name: 'Haus Pumpkin Sauce', defaults: { iced: ['1 pump', '1.5 pumps', '2 pumps'], hot: ['1.5 pumps', '2 pumps', '2.5 pumps'] } },
  { slug: 'haus-green-apple', category: 'syrup-haus', name: 'Green Apple Syrup (Haus)', defaults: { iced: ['2 pumps', '4 pumps', '6 pumps'] } },
  { slug: 'haus-ube', category: 'syrup-haus', name: 'Ube Haus Syrup', defaults: { iced: ['1 Pump', '2 Pumps', '3 Pumps'], hot: ['1.5 Pumps', '2.5 Pumps', '3.5 Pumps'] } },
  { slug: 'haus-coconut', category: 'syrup-haus', name: 'Coconut Syrup' },
  { slug: 'haus-made-syrup-extra', category: 'syrup-haus', name: 'Haus-Made Syrup', default_modifier: '(extra pump)', defaults: { iced: ['3 pumps', '5 pumps', '7 pumps'], hot: ['4 pumps', '6 pumps', '8 pumps'] } },

  // Monin syrups
  { slug: 'monin-honey', category: 'syrup-monin', name: 'Monin Honey', defaults: { iced: ['1 Pump', '2 Pumps', '3 Pumps'], hot: ['1.5 Pumps', '2.5 Pumps', '3.5 Pumps'] } },
  { slug: 'monin-almond', category: 'syrup-monin', name: 'Monin Almond', defaults: { iced: ['1 Pump', '2 Pumps', '3 Pumps'], hot: ['1.5 Pumps', '2.5 Pumps', '3.5 Pumps'] } },
  { slug: 'monin-vanilla', category: 'syrup-monin', name: 'Monin Vanilla' },
  { slug: 'monin-caramel', category: 'syrup-monin', name: 'Monin Caramel' },
  { slug: 'vanilla-torani', category: 'syrup-monin', name: 'Vanilla Torani', defaults: { iced: ['1 Pump', '2 Pumps', '3 Pumps'], hot: ['1.5 Pumps', '2.5 Pumps', '3.5 Pumps'] } },

  // Sauces
  { slug: 'sea-salt-caramel-sauce', category: 'sauce', name: 'Sea Salt Caramel Sauce' },
  { slug: 'sweetened-condensed-milk', category: 'sauce', name: 'Sweetened Condensed Milk', defaults: { iced: ['1 pump\n(20g)', '2 pumps\n(40g)', '3 pumps\n(60g)'] } },

  // Foams
  { slug: 'cold-foam', category: 'foam', name: 'Cold Foam', default_modifier: '(swap to flavor of choice; base latte is half-sweet)', defaults: { iced: ['0.5 bell', '1 small bell', '1 Large Bell'], hot: ['0.5 bell', '1 small bell', '1 Large Bell'] } },
  { slug: 'lavender-cold-foam', category: 'foam', name: 'Lavender Cold Foam', defaults: { iced: ['0.5 bell', '1 small bell', '1 Large Bell'] } },
  { slug: 'haus-vanilla-cold-foam', category: 'foam', name: 'Haus Vanilla Cold Foam', defaults: { iced: ['0.5 small bell', '1 small bell', '1 large bell'] } },

  // Ice — three common fills surface as separate presets so you don't
  // retype the cell text each time
  { slug: 'ice-fill-cup', category: 'ice', name: 'Ice', defaults: { iced: ['Fill Cup', 'Fill Cup', 'Fill Cup'] } },
  { slug: 'ice-fill-to-top', category: 'ice', name: 'Ice', defaults: { iced: ['Fill to top', 'Fill to top', 'Fill to top'] } },
  { slug: 'ice-fill-to-top-after-stirring', category: 'ice', name: 'Ice', defaults: { iced: ['Fill to top\nafter stirring', 'Fill to top\nafter stirring', 'Fill to top\nafter stirring'] } },
  { slug: 'ice-heaping-cup', category: 'ice', name: 'Ice', defaults: { frozen: ['Heaping Cup', 'Heaping Cup', 'Heaping Cup'] } },
  { slug: 'ice-leave-room', category: 'ice', name: 'Ice', defaults: { iced: ['Leave room', 'Leave room', 'Leave room'] } },

  // Toppings / garnishes
  { slug: 'honey-drizzle-on-top', category: 'garnish', name: 'Honey Drizzle', defaults: { iced: ['On top', 'On top', 'On top'] } },
  { slug: 'honey-drizzle-sides-and-top', category: 'garnish', name: 'Honey Drizzle', defaults: { frozen: ['Sides & top', 'Sides & top', 'Sides & top'] } },
  { slug: 'caramel-drizzle', category: 'garnish', name: 'Caramel', defaults: { iced: ['Drizzle on top', 'Drizzle on top', 'Drizzle on top'] } },
  { slug: 'graham-cracker-crumbs', category: 'topping', name: 'Graham Cracker Crumbs', defaults: { frozen: ['Sprinkle on top\nafter pouring', 'Sprinkle on top\nafter pouring', 'Sprinkle on top\nafter pouring'] } },
  { slug: 'pumpkin-pie-spice', category: 'topping', name: 'Pumpkin Pie Spice', defaults: { iced: ['Dust on top', 'Dust on top', 'Dust on top'], hot: ['Dust on top', 'Dust on top', 'Dust on top'], frozen: ['Dust on top\nafter blending', 'Dust on top\nafter blending', 'Dust on top\nafter blending'] } },
  { slug: 'cookies', category: 'topping', name: 'Cookies', defaults: { frozen: ['2 cookies', '4 cookies', '6 cookies'] } },
];

export function seedSopPresets(db: Database) {
  const upsert = db.prepare(`
    INSERT INTO sop_presets (slug, category, name, default_modifier, default_cells_json, is_seeded, sort)
    VALUES (@slug, @category, @name, @default_modifier, @default_cells_json, 1, @sort)
    ON CONFLICT(slug) DO UPDATE SET
      category = excluded.category,
      name = excluded.name,
      default_modifier = excluded.default_modifier,
      default_cells_json = excluded.default_cells_json,
      sort = excluded.sort,
      is_seeded = 1
  `);
  const tx = db.transaction((rows: SeedPreset[]) => {
    rows.forEach((p, i) => {
      upsert.run({
        slug: p.slug,
        category: p.category,
        name: p.name,
        default_modifier: p.default_modifier ?? null,
        default_cells_json: p.defaults ? JSON.stringify(p.defaults) : null,
        sort: p.sort ?? i,
      });
    });
  });
  tx(PRESETS);
}
