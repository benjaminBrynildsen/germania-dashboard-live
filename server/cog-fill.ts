import db from './db.js';

// Auto-fill "standard recipe structure" onto uncosted drinks.
//
// Three passes, all idempotent (a drink with any component is never touched):
//  1. LINK   — curated + exact-name links between the spreadsheet-imported
//              costed drinks and their Dripos product rows (absorbing the empty
//              duplicate row the sync created, same rules as link-dripos).
//  2. RECIPE — food items that map 1:1 to a per-"each" batch recipe get a
//              single Regular variant with that recipe as the only component.
//  3. CLONE  — drinks get the full per-size variant structure copied from an
//              archetype template drink (latte, chai, matcha, milkshake, ...),
//              with the template's flavor line swapped for the flavor the
//              drink is named after when one exists in the catalog.
//
// Every filled drink gets a provenance note so nobody mistakes an auto-fill
// for a hand-verified recipe.

interface FillReport {
  linked: Array<{ drink: string; product: string }>;
  recipe_filled: Array<{ drink: string; recipe: string }>;
  cloned: Array<{ drink: string; template: string; flavor: string | null }>;
  skipped: Array<{ drink: string; reason: string }>;
}

// ── name normalization ────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'seasonal', 'limited', 'special', 'time', 'edition', 'the', 'a', 'an', 'and',
  'of', 'with', 'infused', 'single', 'origin', 'haus',
]);
const ALIASES: Record<string, string[]> = {
  pb: ['peanut', 'butter'],
  psl: ['pumpkin', 'spice'],
  chocoalte: ['chocolate'], // catalog typo
  smores: ['smores'],
};

function tokens(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .replace(/\*[^*]*\*/g, ' ')      // *SEASONAL* markers
    .replace(/\([^)]*\)/g, ' ')      // parentheticals
    .replace(/['’]/g, '')            // s'mores -> smores
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const out: string[] = [];
  for (const t of cleaned.split(/\s+/)) {
    if (!t || STOPWORDS.has(t)) continue;
    if (ALIASES[t]) out.push(...ALIASES[t]);
    else out.push(t);
  }
  return out;
}

// ── pass 1: linking ───────────────────────────────────────────────────────

// spreadsheet drink name -> Dripos product name (both matched loosely).
const LINK_MAP: Array<[string, string]> = [
  ['vanilla latte', 'haus vanilla latte'],
  ['fruit smoothie', 'fruit smoothies'],
  ['milkshake', 'milk shakes'],
  ['tea - hot', 'hot tea'],
  ['tea - iced', 'iced tea'],
  ['haus drip', 'haus drip coffee'],
  ['milk', 'plain milk'],
  ['matcha', 'matcha tea'],
  ['freddo', 'freddo cappuccino'],
  ['espresso shots', 'espresso'],
];

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Link `drink` to the Dripos product identified by (id, name, category):
// absorb the empty duplicate row if the sync created one, refuse if a costed
// drink already owns the product. Mirrors POST /cog/drinks/:id/link-dripos.
function linkDrink(drinkId: number, productId: number, productName: string, productCategory: string | null): string | null {
  const dup = db.prepare('SELECT * FROM cog_drinks WHERE dripos_product_id = ? AND id != ?').get(productId, drinkId) as any;
  if (dup) {
    const compCount = (db.prepare('SELECT COUNT(*) AS c FROM cog_drink_components WHERE drink_id = ?').get(dup.id) as any).c;
    if (compCount > 0) return `product already owned by costed drink "${dup.name}"`;
  }
  const run = db.transaction(() => {
    if (dup) db.prepare('DELETE FROM cog_drinks WHERE id = ?').run(dup.id);
    db.prepare("UPDATE cog_drinks SET dripos_product_id = ?, name = ?, category = ?, updated_at = datetime('now') WHERE id = ?")
      .run(productId, productName, productCategory, drinkId);
  });
  run();
  return null;
}

// ── flavor matching ───────────────────────────────────────────────────────

// Master-ingredient names that are flavorings — the swappable line in a
// template. Everything else (espresso, milk, ice, cups...) is structure.
const FLAVOR_INGREDIENTS = new Set([
  'vanilla', 'vanilla (sf)', 'caramel', 'caramel - zero', 'dark chocolate',
  'white chocolate', 'white chocolate (sf)', 'chocolate - zero', 'lavender',
  'strawberry', 'strawberry banana', 'hazelnut', 'raspberry', 'raspberry - zero',
  'mango', 'sea salt caramel toffee', 'pb chocoalte sauce',
  'lemon white chocolate sauce', 'cinnamon honey', 'apple butter', 'honey',
]);

interface FlavorSource { type: 'ingredient' | 'recipe'; id: number; name: string }

// Find the flavoring the drink is named after: a master ingredient or batch
// recipe whose (normalized) name tokens ALL appear in the drink name. Most
// tokens wins, ties broken by longer name.
function matchFlavor(drinkName: string): FlavorSource | null {
  const drinkToks = new Set(tokens(drinkName));
  const candTokens = (name: string) =>
    tokens(name).filter((t) => !['syrup', 'sauce', 'concentrate'].includes(t));

  let best: (FlavorSource & { score: number }) | null = null;
  const consider = (c: FlavorSource) => {
    const toks = candTokens(c.name);
    if (toks.length === 0 || !toks.every((t) => drinkToks.has(t))) return;
    if (!best || toks.length > best.score || (toks.length === best.score && c.name.length > best.name.length)) {
      best = { ...c, score: toks.length };
    }
  };
  // Ingredient candidates are restricted to actual flavorings — otherwise raw
  // pantry items ("sugar", "cinnamon", "basil") hijack the match.
  for (const m of db.prepare('SELECT id, name FROM cog_ingredient_master').all() as any[]) {
    const lname = m.name.toLowerCase();
    if (!FLAVOR_INGREDIENTS.has(lname) && !lname.includes('concentrate')) continue;
    consider({ type: 'ingredient', id: m.id, name: m.name });
  }
  for (const r of db.prepare('SELECT id, name FROM cog_recipes').all() as any[]) {
    consider({ type: 'recipe', id: r.id, name: r.name });
  }
  return best;
}

function masterByName(name: string): FlavorSource | null {
  const m = db.prepare('SELECT id, name FROM cog_ingredient_master WHERE LOWER(name) = ?').get(name.toLowerCase()) as any;
  return m ? { type: 'ingredient', id: m.id, name: m.name } : null;
}

// ── pass 3: archetype templates ───────────────────────────────────────────

interface Archetype {
  match: (n: string) => boolean;
  templates: string[];           // costed drink to clone, first found wins
  variantFilter?: (v: any) => boolean;
  dropFlavor?: boolean;          // plain espresso drinks: no syrup line at all
  swapFlavor?: boolean;          // replace template flavor line(s) with matched flavor
}

const ARCHETYPES: Archetype[] = [
  { match: (n) => /milk ?shake/.test(n), templates: ['Milkshake', 'Milk Shakes'], swapFlavor: true },
  { match: (n) => n.includes('smoothie'), templates: ['Fruit Smoothie', 'Fruit Smoothies'], swapFlavor: true },
  { match: (n) => n.includes('chai'), templates: ['Chai Latte', 'Haus Chai Latte'], swapFlavor: true },
  { match: (n) => n.includes('matcha'), templates: ['Matcha', 'Matcha Tea'], swapFlavor: true },
  { match: (n) => n.includes('hot chocolate') || n.includes('butterbeer') || n.includes('witches brew'), templates: ['Hot Chocolate'], swapFlavor: true },
  { match: (n) => n.includes('steamer'), templates: ['Steamer'], swapFlavor: true },
  { match: (n) => n.includes('americano'), templates: ['Americano'], swapFlavor: true },
  { match: (n) => n.includes('cappuccino'), templates: ['Caffe Latte'], variantFilter: (v) => v.temp === 'hot', dropFlavor: true },
  { match: (n) => n.includes('cortado') || n.includes('flat white'), templates: ['Caffe Latte'], variantFilter: (v) => v.temp === 'hot' && v.size === 'S', dropFlavor: true },
  { match: (n) => n.includes('cold brew'), templates: ['Cold Brew'], swapFlavor: true },
  { match: (n) => n.includes('espresso buck') || n.includes('espresso soda') || n.includes('espresso sunrise') || n.includes('cherry lime espresso'), templates: ['Spring - Espresso Buck'], swapFlavor: true },
  { match: (n) => /\bcola\b/.test(n), templates: ['Spring - CB Cola'], swapFlavor: true },
  { match: (n) => /\btea\b/.test(n), templates: ['Tea - Iced', 'Iced Tea'], swapFlavor: true },
  { match: (n) => n.includes('au lait') || n.includes('drip'), templates: ['Haus Drip Coffee', 'Haus Drip'], swapFlavor: true },
  { match: (n) => /\bmilk\b/.test(n), templates: ['Plain Milk', 'Milk'], swapFlavor: true },
  // catch-all for the latte/mocha families — must stay last
  { match: (n) => n.includes('latte') || n.includes('mocha') || n.includes('haze') || n.includes('coffee') || n.includes('golden eagle') || n.includes('moonlight') || n.includes('chocolate covered strawberry'), templates: ['Vanilla Latte', 'Haus Vanilla Latte', 'Caffe Latte'], swapFlavor: true },
];

// Food items -> per-"each" batch recipe (curated; token matching is too loose
// for kitchen names like BEC).
const FOOD_RECIPE_MAP: Array<[RegExp, string]> = [
  [/bacon,? egg,? & cheese strudel/, 'BEC'],
  [/ham & cheese croffle/, 'Ham and Swiss Croffle'],
  [/strawberry & nutella croffle/, 'nutella croffle'],
  [/turkey club/, 'turkey club'],
  [/chicken salad croissant/, 'chicken salad croissant'],
  [/apple cider donut/, 'Apple Cider Donut'],
  [/overnight oats/, 'overnight oats'],
  [/energy bites/, 'energy bites'],
  [/maple & brown sugar scone/, 'Maple Brown Sugar Scones'],
  [/snickerdoodle cookie/, 'Chai Spiced Snickerdoodles'],
  [/candied pecans/, 'candied pecans'],
  [/jalapeno sausage biscuit/, 'Jalapeno Cheddar Biscuit Sandwich'],
  [/waffle wedge/, 'Leige Waffles'],
  [/christmas cookie|halloween cookie/, 'Sugar Cookies'],
];

const SKIP_PATTERNS: Array<[RegExp, string]> = [
  [/free water/, 'no cost to track'],
  [/upcharge/, 'price modifier, not a drink'],
  [/potato chips|coffee bark/, 'purchased finished goods — enter by hand'],
];

function findTemplateDrink(names: string[]): { id: number; name: string } | null {
  for (const n of names) {
    const d = db.prepare(`
      SELECT d.id, d.name FROM cog_drinks d
      JOIN cog_drink_components c ON c.drink_id = d.id
      WHERE LOWER(d.name) = ? GROUP BY d.id HAVING COUNT(c.id) > 0
    `).get(n.toLowerCase()) as any;
    if (d) return d;
  }
  return null;
}

function isFlavorLine(c: any): boolean {
  if (c.component_type === 'recipe') {
    const r = db.prepare('SELECT name FROM cog_recipes WHERE id = ?').get(c.recipe_id) as any;
    return !!r && /syrup|sauce|mocha|cream/i.test(r.name);
  }
  const m = db.prepare('SELECT name FROM cog_ingredient_master WHERE id = ?').get(c.ingredient_id) as any;
  return !!m && FLAVOR_INGREDIENTS.has(m.name.toLowerCase());
}

// Copy the template's variants + components onto the target drink, applying
// the flavor policy. Returns the flavor description used (or null).
function cloneTemplate(targetId: number, templateId: number, opts: {
  variantFilter?: (v: any) => boolean;
  dropFlavor?: boolean;
  flavor?: FlavorSource | null;      // swap-in for the template's flavor line(s)
  addDarkChocolate?: boolean;        // mocha targets on a latte template
}): string | null {
  const variants = (db.prepare('SELECT * FROM cog_drink_variants WHERE drink_id = ? ORDER BY sort_order, id').all(templateId) as any[])
    .filter(opts.variantFilter ?? (() => true));
  const insVariant = db.prepare('INSERT INTO cog_drink_variants (drink_id, label, temp, size, sort_order) VALUES (?, ?, ?, ?, ?)');
  const insComp = db.prepare(`
    INSERT INTO cog_drink_components (drink_id, variant_id, component_type, ingredient_id, recipe_id, quantity, unit, yield_percent, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const darkChoc = opts.addDarkChocolate ? masterByName('Dark Chocolate') : null;

  let flavorUsed: string | null = null;
  const run = db.transaction(() => {
    // Wipe the target's (empty) default variants so the clone is the whole structure.
    db.prepare('DELETE FROM cog_drink_variants WHERE drink_id = ?').run(targetId);
    for (const v of variants) {
      const vid = insVariant.run(targetId, v.label, v.temp, v.size, v.sort_order).lastInsertRowid as number;
      const comps = db.prepare('SELECT * FROM cog_drink_components WHERE variant_id = ? ORDER BY sort_order, id').all(v.id) as any[];
      let order = 0;
      for (const c of comps) {
        const flavor = isFlavorLine(c);
        if (flavor && opts.dropFlavor) continue;
        let type = c.component_type, ingId = c.ingredient_id, recId = c.recipe_id;
        if (flavor && opts.flavor) {
          type = opts.flavor.type;
          ingId = opts.flavor.type === 'ingredient' ? opts.flavor.id : null;
          recId = opts.flavor.type === 'recipe' ? opts.flavor.id : null;
          flavorUsed = opts.flavor.name;
        } else if (flavor && darkChoc) {
          type = 'ingredient'; ingId = darkChoc.id; recId = null;
          flavorUsed = flavorUsed ?? darkChoc.name;
        } else if (flavor) {
          flavorUsed = flavorUsed ?? '(template flavor kept)';
        }
        insComp.run(targetId, vid, type, ingId, recId, c.quantity, c.unit, c.yield_percent, order++);
      }
    }
  });
  run();
  return flavorUsed;
}

// ── the whole pass ────────────────────────────────────────────────────────

export function fillStandardRecipes(products: Array<{ ID: number; NAME: string; CATEGORY_NAME: string | null }>): FillReport {
  const report: FillReport = { linked: [], recipe_filled: [], cloned: [], skipped: [] };
  const productByName = new Map(products.map((p) => [norm(p.NAME), p]));

  const uncosted = () => db.prepare(`
    SELECT d.* FROM cog_drinks d
    LEFT JOIN cog_drink_components c ON c.drink_id = d.id
    WHERE d.archived = 0 GROUP BY d.id HAVING COUNT(c.id) = 0
  `).all() as any[];
  const costedUnlinked = db.prepare(`
    SELECT d.* FROM cog_drinks d
    JOIN cog_drink_components c ON c.drink_id = d.id
    WHERE d.dripos_product_id IS NULL GROUP BY d.id
  `).all() as any[];

  // 1. LINK — curated map + exact product-name matches for costed drinks.
  for (const d of costedUnlinked) {
    const mapped = LINK_MAP.find(([from]) => norm(d.name) === from)?.[1];
    const product = (mapped && productByName.get(mapped)) || productByName.get(norm(d.name));
    if (!product) continue;
    const err = linkDrink(d.id, product.ID, product.NAME, product.CATEGORY_NAME ?? null);
    if (err) report.skipped.push({ drink: d.name, reason: `link failed: ${err}` });
    else report.linked.push({ drink: d.name, product: product.NAME });
  }

  // 2 + 3. Fill every remaining uncosted drink.
  for (const d of uncosted()) {
    const n = norm(d.name);

    const skip = SKIP_PATTERNS.find(([re]) => re.test(n));
    if (skip) { report.skipped.push({ drink: d.name, reason: skip[1] }); continue; }

    // Food → direct recipe component.
    const foodRecipeName = FOOD_RECIPE_MAP.find(([re]) => re.test(n))?.[1];
    if (foodRecipeName) {
      const r = db.prepare('SELECT id, name, yield_unit FROM cog_recipes WHERE LOWER(name) = ?').get(foodRecipeName.toLowerCase()) as any;
      if (!r) { report.skipped.push({ drink: d.name, reason: `recipe "${foodRecipeName}" not found` }); continue; }
      const run = db.transaction(() => {
        db.prepare('DELETE FROM cog_drink_variants WHERE drink_id = ?').run(d.id);
        const vid = db.prepare("INSERT INTO cog_drink_variants (drink_id, label, sort_order) VALUES (?, 'Regular', 0)").run(d.id).lastInsertRowid;
        db.prepare(`INSERT INTO cog_drink_components (drink_id, variant_id, component_type, recipe_id, quantity, unit, sort_order)
                    VALUES (?, ?, 'recipe', ?, 1, ?, 0)`).run(d.id, vid, r.id, r.yield_unit);
        db.prepare("UPDATE cog_drinks SET notes = ?, updated_at = datetime('now') WHERE id = ?")
          .run(`Auto-filled from batch recipe "${r.name}" — verify.`, d.id);
      });
      run();
      report.recipe_filled.push({ drink: d.name, recipe: r.name });
      continue;
    }

    // Drinks → archetype clone.
    const arch = ARCHETYPES.find((a) => a.match(n));
    if (!arch) { report.skipped.push({ drink: d.name, reason: 'no matching template archetype' }); continue; }
    const template = findTemplateDrink(arch.templates);
    if (!template) { report.skipped.push({ drink: d.name, reason: `template "${arch.templates[0]}" has no recipe yet` }); continue; }
    if (template.id === d.id) continue;

    const isWhiteMocha = n.includes('white mocha');
    const isMocha = !isWhiteMocha && n.includes('mocha');
    const matched = arch.swapFlavor ? matchFlavor(d.name) : null;
    const flavor = matched ?? (isWhiteMocha ? masterByName('White Chocolate') : null);
    // Mochas on the latte template need chocolate unless the matched flavor already is one.
    const addDarkChocolate = isMocha && !(flavor && /chocolate|mocha/i.test(flavor.name));

    const flavorUsed = cloneTemplate(d.id, template.id, {
      variantFilter: arch.variantFilter,
      dropFlavor: arch.dropFlavor,
      flavor,
      addDarkChocolate,
    });
    db.prepare("UPDATE cog_drinks SET notes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(`Auto-filled from template "${template.name}"${flavorUsed ? ` (flavor: ${flavorUsed})` : ''} — verify quantities.`, d.id);
    report.cloned.push({ drink: d.name, template: template.name, flavor: flavorUsed });
  }

  return report;
}
