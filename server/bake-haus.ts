/**
 * Bake Haus order management — Joe/Tristan's weekly per-store food orders
 * to Chef Maggie. The dashboard auto-splits each weekly qty across the
 * Mon/Wed/Fri deliveries.
 *
 * Sauces/syrups are intentionally out of scope here — those are broken
 * down by the chef on prep days and handled outside this system.
 */
import db from './db.js';
import { BAKE_HAUS_CATEGORY, fetchAllProducts, fetchInventory, fetchProductSales, STORES } from './dripos.js';

/** CDN base for Dripos product images. The /products endpoint returns
 *  each item's LOGO field as either:
 *    - a full `http(s)://...` URL (Dripos default product images), or
 *    - a bare filename like `1758634796887-P1082.jpg` for custom uploads.
 *  Custom-upload filenames resolve under this CloudFront distribution. */
const DRIPOS_IMAGE_CDN = 'https://d3ahdv1y47pkz0.cloudfront.net';

function resolveImageUrl(logo: string | null | undefined): string | null {
  if (!logo) return null;
  if (logo.startsWith('http://') || logo.startsWith('https://')) return logo;
  return `${DRIPOS_IMAGE_CDN}/${logo}`;
}

/** Master catalog of food items the kitchen produces. Seeded from the
 *  four order sheets Ben shared (May 4 & May 11, 2026). Aliases let
 *  variations across stores ("MBS Scone" vs "Maple Brown Sugar Scone"
 *  vs "Scones") resolve to one canonical name. */
export interface BakeHausItem {
  /** Canonical display name. */
  name: string;
  /** Lowercased aliases checked for fuzzy match before adding a new item. */
  aliases: string[];
  /** Sort order on the entry form. */
  sort: number;
  /** Optional Dripos product-name phrase to fuzzy-match inventory/image
   *  against, when the canonical display name doesn't share enough tokens
   *  with the Dripos name. E.g. we show "Waffles" but Dripos calls the
   *  product "Waffle Wedge" — the singular/extra-word difference means the
   *  display name matches 0 tokens and inventory reads 0 everywhere. */
  driposMatch?: string;
}

/** Unified catalog item — covers both the hardcoded food list AND
 *  the DB-backed editable syrup catalog. `category` distinguishes
 *  them; the order card renders food + syrup as two sections.
 *  `includeMonday` controls the delivery split: true → 2/7-2/7-3/7,
 *  false → 0 / Wed:Fri at 2:3. */
export interface BakeHausCatalogItem {
  name: string;            // canonical item_name stored in bake_haus_orders
  sort: number;
  category: 'food' | 'syrup-sauce';
  includeMonday: boolean;
  /** Dripos product ID for inventory lookup. null for food (we use
   *  fuzzy name matching for those). */
  driposProductId: number | null;
  /** Dripos product name — used as a fallback inventory match key
   *  and for showing the underlying Dripos name in the manage UI. */
  driposProductName: string | null;
}

export const BAKE_HAUS_ITEMS: BakeHausItem[] = [
  { name: 'Bacon, Egg & Cheese',           aliases: ['bec', 'b.e.c.', 'bacon egg & cheese', 'bacon egg cheese', 'bacon, egg and cheese'], sort: 10 },
  { name: 'Jalapeno Sausage Biscuit',      aliases: ['jalapeno sausage biscuit', 'jalapeno biscuit', 'sausage biscuit', 'biscuit', 'biscuits'], sort: 20 },
  { name: 'Croffle - Ham & Cheese',        aliases: ['ham & cheese croffle', 'ham&cheese croffle', 'ham and cheese croffle', 'h&c croffle'], sort: 30 },
  { name: 'Croffle - Buffalo Chicken',     aliases: ['buffalo croffle', 'buffalo chicken croffle'], sort: 40 },
  { name: 'Croffle - Strawberry Nutella',  aliases: ['nutella croffle', 'strawberry nutella croffle', 'strawberry croffle'], sort: 50 },
  { name: 'Energy Bites',                  aliases: ['energy bites', 'energy bite'], sort: 60 },
  { name: 'Overnight Oats',                aliases: ['overnight oats', 'overnite oats'], sort: 70 },
  { name: 'Maple Brown Sugar Scone',       aliases: ['mbs scone', 'maple brown sugar scone', 'maple scone', 'scones', 'scone'], sort: 80 },
  { name: 'Waffles',                       aliases: ['waffles', 'waffle'], sort: 90, driposMatch: 'Waffle Wedge' },
];

/** Normalize an incoming item name to its canonical form if we recognize
 *  it (case-insensitive alias match). Unknown names pass through
 *  unchanged so users can type ad-hoc items without us blocking them. */
export function canonicalizeItemName(input: string): string {
  const lower = input.trim().toLowerCase();
  for (const item of BAKE_HAUS_ITEMS) {
    if (item.name.toLowerCase() === lower) return item.name;
    if (item.aliases.some((a) => a === lower)) return item.name;
  }
  return input.trim();
}

/** Strip punctuation + lowercase + collapse whitespace so fuzzy-matching
 *  catalog names against Dripos product names is forgiving of "&" vs
 *  "and", trailing tags like "(GF, DF)", etc. */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resolve a catalog item's image URL by matching against the Dripos
 *  Bake Haus product list. Match is "does the Dripos product name
 *  contain every meaningful token of the catalog name?" — handles
 *  variations like "Bacon, Egg, & Cheese Strudel" ↔ "Bacon, Egg & Cheese". */
function findImageForCatalogItem(
  item: BakeHausItem,
  products: Array<{ NAME: string; LOGO?: string | null }>,
): string | null {
  const wantTokens = new Set(normalizeForMatch(item.driposMatch ?? item.name).split(' ').filter(Boolean));
  // Aliases give us more match surface (e.g., "BEC" should match
  // "Bacon, Egg, & Cheese Strudel" via the BEC alias if we ever add it
  // to the product side, but the canonical token-set match is the
  // primary path).
  const candidates: Array<{ logo: string; score: number }> = [];
  for (const p of products) {
    const have = new Set(normalizeForMatch(p.NAME).split(' ').filter(Boolean));
    const wantArray = Array.from(wantTokens);
    const hits = wantArray.filter((t) => have.has(t));
    if (hits.length === 0) continue;
    // Require at least 60% of catalog tokens to appear in the product
    // name. Score = hit ratio, with archived/no-logo products excluded.
    const score = hits.length / wantArray.length;
    if (score >= 0.6 && p.LOGO) {
      candidates.push({ logo: p.LOGO, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? resolveImageUrl(candidates[0].logo) : null;
}

interface CachedImageMap {
  map: Record<string, string | null>;
  fetchedAt: number;
}
let imageMapCache: CachedImageMap | null = null;
const IMAGE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Build a map from catalog item name -> resolved image URL by joining
 *  our static catalog against Dripos /products. Cached for an hour
 *  since menu photos rarely change. Returns an empty map (no images
 *  rendered, no crash) if Dripos is unavailable. */
export async function getCatalogImageMap(): Promise<Record<string, string | null>> {
  if (imageMapCache && Date.now() - imageMapCache.fetchedAt < IMAGE_CACHE_TTL_MS) {
    return imageMapCache.map;
  }
  try {
    const products = await fetchInventory(STORES[0].locationId);
    const map: Record<string, string | null> = {};
    for (const item of BAKE_HAUS_ITEMS) {
      map[item.name] = findImageForCatalogItem(item, products);
    }
    imageMapCache = { map, fetchedAt: Date.now() };
    return map;
  } catch (err) {
    console.warn('[bake-haus] image map fetch failed:', err instanceof Error ? err.message : err);
    return imageMapCache?.map ?? {};
  }
}

/** Per-store, per-catalog-item current on-hand inventory from Dripos.
 *  Inventory moves fast (sells through the day), so cached for only
 *  2 minutes — refresh per page load is too much, stale-by-an-hour
 *  is misleading. Missing items / null inventory show as 0. */
interface CachedInventoryMap {
  map: Record<string, Record<string, number>>;
  fetchedAt: number;
}
let inventoryMapCache: CachedInventoryMap | null = null;
const INVENTORY_CACHE_TTL_MS = 2 * 60 * 1000;

export async function getBakeHausInventoryByStore(): Promise<Record<string, Record<string, number>>> {
  if (inventoryMapCache && Date.now() - inventoryMapCache.fetchedAt < INVENTORY_CACHE_TTL_MS) {
    return inventoryMapCache.map;
  }
  const map: Record<string, Record<string, number>> = {};
  for (const store of STORES) map[store.label] = {};

  // Syrups are linked by Dripos product ID (set in the catalog admin
  // tab). Food items are matched by fuzzy name search since their
  // canonical name lives in code, not in Dripos.
  const syrups = listSyrups(false);

  await Promise.all(STORES.map(async (store) => {
    try {
      // Use the unfiltered product list — syrups live outside the
      // BAKE HAUS FOOD category (Dripos puts "Bottle - ..." items in
      // their own category), so the food-only fetchInventory would
      // miss them. We filter to food in-place for the fuzzy match.
      const allProducts = await fetchAllProducts(store.locationId);
      const foodProducts = allProducts.filter((p) => p.CATEGORY_NAME === BAKE_HAUS_CATEGORY);
      // Food: fuzzy name match into the food-category subset.
      for (const item of BAKE_HAUS_ITEMS) {
        const found = findProductForCatalogItem(item, foodProducts);
        if (found && typeof found.INVENTORY === 'number') {
          map[store.label][item.name] = found.INVENTORY;
        }
      }
      // Syrups: ID-based exact match across the full product list.
      const byId = new Map<number, typeof allProducts[number]>();
      for (const p of allProducts) byId.set(p.ID, p);
      for (const s of syrups) {
        const found = byId.get(s.driposProductId);
        if (found && typeof found.INVENTORY === 'number') {
          map[store.label][s.displayName] = found.INVENTORY;
        }
      }
    } catch (err) {
      console.warn(`[bake-haus] inventory fetch for ${store.label} failed:`, err instanceof Error ? err.message : err);
    }
  }));

  inventoryMapCache = { map, fetchedAt: Date.now() };
  return map;
}

/** Token-set fuzzy match. Used by both image and inventory lookups —
 *  same matching logic, different field on the matched product. */
function findProductForCatalogItem(
  item: BakeHausItem,
  products: Array<{ NAME: string; INVENTORY?: number | null; LOGO?: string | null; ARCHIVED?: number }>,
): { NAME: string; INVENTORY?: number | null; LOGO?: string | null } | null {
  const wantTokens = new Set(normalizeForMatch(item.driposMatch ?? item.name).split(' ').filter(Boolean));
  const candidates: Array<{ p: typeof products[number]; score: number }> = [];
  for (const p of products) {
    if (p.ARCHIVED) continue;
    const have = new Set(normalizeForMatch(p.NAME).split(' ').filter(Boolean));
    const wantArray = Array.from(wantTokens);
    const hits = wantArray.filter((t) => have.has(t));
    if (hits.length === 0) continue;
    const score = hits.length / wantArray.length;
    if (score >= 0.6) candidates.push({ p, score });
  }
  // Highest score wins; on a tie prefer a product carrying real numeric
  // inventory. A store can hold duplicate products with the same name
  // (e.g. G4 has two "Waffle Wedge" rows, one with INVENTORY=null) — if
  // the null duplicate sorted first the item would still read 0.
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aNum = typeof a.p.INVENTORY === 'number' ? 0 : 1;
    const bNum = typeof b.p.INVENTORY === 'number' ? 0 : 1;
    return aNum - bNum;
  });
  return candidates[0]?.p ?? null;
}

/**
 * Split a weekly qty across the three deliveries (Mon/Wed/Fri).
 *
 * Coverage windows:
 *   Mon delivery covers Mon + Tue (2 days)
 *   Wed delivery covers Wed + Thu (2 days)
 *   Fri delivery covers Fri + Sat + Sun (3 days)
 *
 * Weights: 2/7, 2/7, 3/7. Always returns whole integers — these orders
 * are counts of sandwiches/scones/etc., not weight measurements.
 * Fractional inputs are rounded to the nearest whole before splitting.
 * Rounding leftovers go to Fri so the three components always sum back
 * to the original weekly qty exactly.
 */
/** Per-delivery-day lock snapshot. Any day set to a finite number is
 *  frozen — splitForDeliveries returns that value verbatim. NULL/undefined
 *  for unlocked days, which then divide the remaining qty using the
 *  baseline 2/7-2/7-3/7 ratio (or 3/2/2 when prioritizing early). */
export interface DayLocks {
  mon?: number | null;
  wed?: number | null;
  fri?: number | null;
}

export function splitForDeliveries(
  weeklyQty: number,
  /** Per-day locks. When a day's value is a finite number, it's frozen
   *  to that value and unlocked days split the remainder using their
   *  relative weights from the 2/2/3 (or 3/2/2 when prioritizeEarly)
   *  baseline. Pass an empty object (or omit) for the unlocked split.
   *  Backwards-compatible with a bare `number` (legacy Monday-lock arg). */
  locks: DayLocks | number | null = null,
  /** When false, this item skips Monday entirely (Mon=0, Wed/Fri at
   *  2:3). Used for most syrups + sauces which are made Tue/Thu and
   *  only delivered Wed/Fri. Defaults to true. */
  includeMonday: boolean = true,
  /** When true, weight the earliest delivery day more heavily — used
   *  when the store is fully out of stock and needs the next shipment
   *  ASAP. Flips Wed:Fri from 2:3 → 3:2 (no-Monday syrups), and
   *  Mon:Wed:Fri from 2:2:3 → 3:2:2 (food / Haus Vanilla). */
  prioritizeEarly: boolean = false,
): {
  mon: number;
  wed: number;
  fri: number;
} {
  // Normalize the legacy `monLockedQty: number | null` calling
  // convention into the new DayLocks object so callers don't have to
  // change all at once.
  const normalizedLocks: DayLocks = typeof locks === 'number'
    ? { mon: locks }
    : (locks ?? {});
  const monLocked = isFiniteNum(normalizedLocks.mon) ? normalizedLocks.mon! : null;
  const wedLocked = isFiniteNum(normalizedLocks.wed) ? normalizedLocks.wed! : null;
  const friLocked = isFiniteNum(normalizedLocks.fri) ? normalizedLocks.fri! : null;

  if (!Number.isFinite(weeklyQty) || weeklyQty <= 0) {
    return { mon: 0, wed: 0, fri: 0 };
  }
  const total = Math.round(weeklyQty);
  if (total <= 0) return { mon: 0, wed: 0, fri: 0 };

  // Baseline weights (sum to 1) used for both the unlocked split and
  // the redistribution of remainder when some days are locked.
  // includeMonday=false forces the Mon weight to 0; the rest is
  // renormalized to 1 across wed/fri.
  const w = baselineWeights(includeMonday, prioritizeEarly);

  // ── Fast path: nothing locked ─────────────────────────────────────
  // The historical no-lock branches do exact integer balancing with
  // remainder-to-Fri (or Wed when prioritizeEarly) so we preserve the
  // pre-existing test expectations verbatim instead of routing
  // through the generic redistribution code.
  if (monLocked === null && wedLocked === null && friLocked === null) {
    if (!includeMonday) {
      const wed = Math.round(total * w.wed / (w.wed + w.fri));
      const fri = Math.max(0, total - wed);
      return { mon: 0, wed, fri };
    }
    if (prioritizeEarly) {
      let mon = Math.round(total * (3 / 7));
      let wed = Math.round(total * (2 / 7));
      let fri = total - mon - wed;
      if (mon < 0) mon = 0;
      if (wed < 0) wed = 0;
      if (fri < 0) fri = 0;
      return { mon, wed, fri };
    }
    let mon = Math.round(total * (2 / 7));
    let wed = Math.round(total * (2 / 7));
    let fri = total - mon - wed;
    if (fri < wed) {
      const diff = wed - fri;
      const give = Math.ceil(diff / 2);
      wed -= give;
      fri += give;
    }
    if (mon < 0) mon = 0;
    if (wed < 0) wed = 0;
    if (fri < 0) fri = 0;
    return { mon, wed, fri };
  }

  // ── Locked path: clamp each locked day to <= total, distribute
  // the remainder across unlocked days using their relative weights. ──
  let usedTotal = 0;
  const out: { mon: number; wed: number; fri: number } = { mon: 0, wed: 0, fri: 0 };

  // includeMonday=false zeros Mon regardless of lock — those items
  // genuinely don't deliver Mon, even if a stale lock value exists.
  const monActive = includeMonday;
  if (monLocked !== null && monActive) {
    out.mon = Math.max(0, Math.min(Math.round(monLocked), total));
    usedTotal += out.mon;
  }
  if (wedLocked !== null) {
    const room = Math.max(0, total - usedTotal);
    out.wed = Math.max(0, Math.min(Math.round(wedLocked), room));
    usedTotal += out.wed;
  }
  if (friLocked !== null) {
    const room = Math.max(0, total - usedTotal);
    out.fri = Math.max(0, Math.min(Math.round(friLocked), room));
    usedTotal += out.fri;
  }

  // Distribute remainder across whatever days are still unlocked.
  const remaining = Math.max(0, total - usedTotal);
  const unlocked = {
    mon: monLocked === null && monActive ? w.mon : 0,
    wed: wedLocked === null ? w.wed : 0,
    fri: friLocked === null ? w.fri : 0,
  };
  const weightSum = unlocked.mon + unlocked.wed + unlocked.fri;
  if (remaining > 0 && weightSum > 0) {
    // Round Mon and Wed; send the leftover to whichever unlocked day
    // sits later in the week so cumulative rounding error doesn't
    // double-bill the early trucks.
    if (unlocked.mon > 0) out.mon += Math.round(remaining * (unlocked.mon / weightSum));
    if (unlocked.wed > 0) out.wed += Math.round(remaining * (unlocked.wed / weightSum));
    const used = (unlocked.mon > 0 ? Math.round(remaining * (unlocked.mon / weightSum)) : 0)
               + (unlocked.wed > 0 ? Math.round(remaining * (unlocked.wed / weightSum)) : 0);
    const leftover = remaining - used;
    // Drop the leftover on the latest unlocked day, or wed if fri is
    // locked, or mon if wed+fri are both locked.
    if (unlocked.fri > 0) out.fri += leftover;
    else if (unlocked.wed > 0) out.wed += leftover;
    else if (unlocked.mon > 0) out.mon += leftover;
  }

  if (out.mon < 0) out.mon = 0;
  if (out.wed < 0) out.wed = 0;
  if (out.fri < 0) out.fri = 0;
  return out;
}

function isFiniteNum(v: any): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

function baselineWeights(includeMonday: boolean, prioritizeEarly: boolean): { mon: number; wed: number; fri: number } {
  if (!includeMonday) {
    // Wed/Fri only — 2/5 vs 3/5 normally, flipped when prioritizing early.
    return prioritizeEarly
      ? { mon: 0, wed: 3, fri: 2 }
      : { mon: 0, wed: 2, fri: 3 };
  }
  return prioritizeEarly
    ? { mon: 3, wed: 2, fri: 2 }
    : { mon: 2, wed: 2, fri: 3 };
}

export interface BakeHausOrderRow {
  weekStartIso: string;
  storeLabel: string;
  itemName: string;
  weeklyQty: number;
  notes: string | null;
  /** Current Dripos on-hand inventory for this (store, item). 0 if no
   *  inventory tracking or no Dripos product match. */
  onHand: number;
  /** Net qty to deliver = max(0, weeklyQty - onHand). */
  netQty: number;
  /** Mon/Wed/Fri split of netQty. */
  delivery: { mon: number; wed: number; fri: number };
  /** Per-day frozen qty for this row when the week is locked. null
   *  for unlocked days OR rows that pre-date the lock. */
  monLockedQty: number | null;
  wedLockedQty: number | null;
  friLockedQty: number | null;
  /** 'food' or 'syrup-sauce', for the order card's section grouping. */
  category: 'food' | 'syrup-sauce' | 'custom';
  /** Whether this item delivers on Monday. false → Wed/Fri only. */
  includeMonday: boolean;
}

/** Metadata for a single locked delivery day. */
export interface DayLockMeta {
  lockedAt: number;
  lockedBy: string | null;
  source: 'manual' | 'auto';
}

export interface BakeHausWeekReport {
  weekStartIso: string;
  /** When each store's order was last saved (ms epoch). null = never
   *  explicitly saved (only auto-saved per-item edits). */
  savedAtByStore: Record<string, number | null>;
  /** Per-store rows, sorted by the canonical item catalog order. */
  byStore: Record<string, BakeHausOrderRow[]>;
  /** Cross-store summary: for each delivery day (mon/wed/fri), a map of
   *  item -> per-store qty. Reflects the NET split (i.e., already
   *  accounts for on-hand inventory). */
  deliverySummary: {
    mon: Record<string, Record<string, number>>;
    wed: Record<string, Record<string, number>>;
    fri: Record<string, Record<string, number>>;
  };
  /** Per-store, per-item current Dripos on-hand inventory. Surfaced so
   *  the order card can show it inline ("on hand: 8") even when the
   *  store has no order row yet. */
  inventoryByStore: Record<string, Record<string, number>>;
  /** When the inventory snapshot was fetched (ms epoch). */
  inventoryFetchedAt: number;
  /** Set when the week's Monday delivery has been locked. Preserved
   *  for backwards compatibility with clients that haven't migrated
   *  to `weekLocked`/`dayLocks` yet. New code should use `weekLocked`. */
  monLock: {
    lockedAt: number;
    lockedBy: string | null;
  } | null;
  /** True when all three delivery days are frozen (the week-wide lock
   *  introduced Wed 2026-05-20 for Chef Maggie's bake-target stability).
   *  When true, the save endpoint rejects edits from non-allowlist users
   *  and the UI shows 🔒 on every delivery cell. */
  weekLocked: boolean;
  /** Per-day lock metadata. Each day is independently lockable: the
   *  kitchen can freeze Monday's delivery (cut off Mon orders) while
   *  Wed/Fri stay live & editable. A whole-week lock sets all three to
   *  the same value. `lockedAt` is when the day's snapshot was captured,
   *  `lockedBy` the user who triggered it (null for auto-cron), `source`
   *  distinguishes a manual cutoff from the Monday auto-lock. */
  dayLocks: {
    mon: DayLockMeta | null;
    wed: DayLockMeta | null;
    fri: DayLockMeta | null;
  };
  /** 'manual' (someone pressed Lock) or 'auto' (Mon 23:59 cron fired).
   *  Null when no lock exists. Surfaced in the UI so a manual unlock
   *  doesn't kick the auto-cron-fired lock back on the next Monday. */
  lockSource: 'manual' | 'auto' | null;
}

interface DbRow {
  week_start_iso: string;
  store_label: string;
  item_name: string;
  weekly_qty: number;
  notes: string | null;
  mon_locked_qty: number | null;
  wed_locked_qty: number | null;
  fri_locked_qty: number | null;
}

/** Sort items by the catalog order; unknown items go to the bottom. */
function itemSortKey(name: string): number {
  const found = BAKE_HAUS_ITEMS.find((i) => i.name === name);
  return found?.sort ?? 1000;
}

export async function getWeekReport(weekStartIso: string): Promise<BakeHausWeekReport> {
  const rows = db.prepare(
    `SELECT week_start_iso, store_label, item_name, weekly_qty, notes,
            mon_locked_qty, wed_locked_qty, fri_locked_qty
     FROM bake_haus_orders
     WHERE week_start_iso = ?`,
  ).all(weekStartIso) as DbRow[];

  // Week-level lock state. When present, the per-row *_locked_qty
  // snapshots are authoritative for every delivery day where they're
  // non-null. The `lock_source` distinguishes manual locks from the
  // Mon 23:59 cron-fired auto-lock.
  const lockRow = db.prepare(
    'SELECT mon_locked_at, locked_by, lock_source FROM bake_haus_week_locks WHERE week_start_iso = ?',
  ).get(weekStartIso) as { mon_locked_at: number; locked_by: string | null; lock_source: string | null } | undefined;
  const weekLocked = !!lockRow;
  const monLock = lockRow
    ? { lockedAt: lockRow.mon_locked_at, lockedBy: lockRow.locked_by ?? null }
    : null;
  const lockSource = (lockRow?.lock_source === 'auto' || lockRow?.lock_source === 'manual')
    ? lockRow.lock_source as 'manual' | 'auto'
    : (lockRow ? 'manual' : null);
  // Per-day lock state — a whole-week lock reads as all three days
  // locked; otherwise individual day locks apply. Drives both the split
  // (which days freeze) and the dayLocks metadata returned below.
  const dayLockState = getDayLockState(weekStartIso);

  // Pull current Dripos inventory in parallel with everything else. Cache
  // protects us if Dripos is slow/down — falls back to empty map.
  const inventoryByStore = await getBakeHausInventoryByStore().catch(() => ({} as Record<string, Record<string, number>>));

  const byStore: Record<string, BakeHausOrderRow[]> = {};
  for (const store of STORES) byStore[store.label] = [];

  const deliverySummary = {
    mon: {} as Record<string, Record<string, number>>,
    wed: {} as Record<string, Record<string, number>>,
    fri: {} as Record<string, Record<string, number>>,
  };

  // Resolve per-item category + includeMonday from the merged
  // catalog. Food items + Haus-Vanilla-style syrups → includeMonday
  // true; other syrups → false. Items not in the catalog (legacy
  // custom items) default to category='custom', includeMonday=true.
  const catalog = getMergedCatalog();
  const catalogByName = new Map<string, BakeHausCatalogItem>();
  for (const c of catalog) catalogByName.set(c.name, c);

  for (const r of rows) {
    const onHand = inventoryByStore[r.store_label]?.[r.item_name] ?? 0;
    const netQty = Math.max(0, r.weekly_qty - onHand);
    const catEntry = catalogByName.get(r.item_name);
    const includeMonday = catEntry?.includeMonday ?? true;
    const category: 'food' | 'syrup-sauce' | 'custom' =
      catEntry?.category ?? 'custom';
    // Out-of-stock at this store → prioritize the earliest delivery
    // so the next truck gets the bigger chunk.
    const prioritizeEarly = onHand === 0 && netQty > 0;
    // Lock semantics: each delivery day freezes independently. For a
    // locked day, the per-row *_locked_qty snapshot is authoritative;
    // if it's NULL (legacy row predating the column, or a row added
    // after the lock) we fall back to the unlocked split for that day.
    // Unlocked days stay null so they recompute from the remainder.
    const lockMon = dayLockState.mon !== null && includeMonday;
    const lockWed = dayLockState.wed !== null;
    const lockFri = dayLockState.fri !== null;
    let monLockedQty: number | null = null;
    let wedLockedQty: number | null = null;
    let friLockedQty: number | null = null;
    if (lockMon || lockWed || lockFri) {
      const unlockedSplit = splitForDeliveries(netQty, null, includeMonday, prioritizeEarly);
      if (lockMon) monLockedQty = r.mon_locked_qty != null ? r.mon_locked_qty : unlockedSplit.mon;
      if (lockWed) wedLockedQty = r.wed_locked_qty != null ? r.wed_locked_qty : unlockedSplit.wed;
      if (lockFri) friLockedQty = r.fri_locked_qty != null ? r.fri_locked_qty : unlockedSplit.fri;
    }
    const split = splitForDeliveries(
      netQty,
      { mon: monLockedQty, wed: wedLockedQty, fri: friLockedQty },
      includeMonday,
      prioritizeEarly,
    );
    // A locked day must show its frozen snapshot EXACTLY — once a day is
    // locked, live inventory is irrelevant (the snapshot already had
    // inventory subtracted at lock time). splitForDeliveries clamps a
    // locked day down to the live netQty, which is right pre-lock but
    // wrong after: a store whose on-hand rises (or whose netQty otherwise
    // dips below the snapshot — e.g. East Alton/G3) would see its
    // "locked" numbers keep drifting down instead of staying put. Pin
    // locked days back to their snapshot here so the freeze actually holds.
    if (lockMon && monLockedQty != null) split.mon = Math.max(0, Math.round(monLockedQty));
    if (lockWed && wedLockedQty != null) split.wed = Math.max(0, Math.round(wedLockedQty));
    if (lockFri && friLockedQty != null) split.fri = Math.max(0, Math.round(friLockedQty));
    const row: BakeHausOrderRow = {
      weekStartIso: r.week_start_iso,
      storeLabel: r.store_label,
      itemName: r.item_name,
      weeklyQty: r.weekly_qty,
      notes: r.notes,
      onHand,
      netQty,
      delivery: split,
      monLockedQty,
      wedLockedQty,
      friLockedQty,
      category,
      includeMonday,
    };
    if (!byStore[r.store_label]) byStore[r.store_label] = [];
    byStore[r.store_label].push(row);

    for (const day of ['mon', 'wed', 'fri'] as const) {
      const dayMap = deliverySummary[day];
      if (!dayMap[r.item_name]) dayMap[r.item_name] = {};
      const qty = split[day];
      if (qty > 0) dayMap[r.item_name][r.store_label] = qty;
    }
  }

  for (const store of Object.keys(byStore)) {
    byStore[store].sort((a, b) =>
      itemSortKey(a.itemName) - itemSortKey(b.itemName)
      || a.itemName.localeCompare(b.itemName),
    );
  }

  const savedRows = db.prepare(
    'SELECT store_label, saved_at FROM bake_haus_saved_orders WHERE week_start_iso = ?',
  ).all(weekStartIso) as Array<{ store_label: string; saved_at: number }>;
  const savedAtByStore: Record<string, number | null> = {};
  for (const store of STORES) savedAtByStore[store.label] = null;
  for (const r of savedRows) savedAtByStore[r.store_label] = r.saved_at;

  return {
    weekStartIso,
    savedAtByStore,
    byStore,
    deliverySummary,
    inventoryByStore,
    inventoryFetchedAt: inventoryMapCache?.fetchedAt ?? Date.now(),
    monLock,
    weekLocked,
    dayLocks: dayLockState,
    lockSource,
  };
}

/** Lock all three delivery days for the week — snapshots each row's
 *  current Mon/Wed/Fri split into the per-day `*_locked_qty` columns
 *  and creates/updates the `bake_haus_week_locks` row. After this,
 *  inventory drift and qty edits leave the locked qtys untouched
 *  (subject to the save-endpoint allowlist gate enforced in routes).
 *
 *  When `asOfMs` is provided, the onHand used to compute the lock
 *  snapshot is reconstructed to that past timestamp by adding back
 *  any sales that occurred between then and now. This is how the
 *  current-week "Lock now using last night's data" flow avoids
 *  capturing mid-Wednesday inventory drift in the Wed/Fri snapshots. */
export async function lockWeek(
  weekStartIso: string,
  lockedBy: string | null = null,
  source: 'manual' | 'auto' = 'manual',
  asOfMs?: number | null,
): Promise<{ rowsSnapshotted: number; mode: 'live' | 'reconstructed' }> {
  const rows = db.prepare(
    `SELECT week_start_iso, store_label, item_name, weekly_qty, notes,
            mon_locked_qty, wed_locked_qty, fri_locked_qty
     FROM bake_haus_orders
     WHERE week_start_iso = ?`,
  ).all(weekStartIso) as DbRow[];

  // Pick the onHand source: live Dripos inventory, OR a reconstructed
  // snapshot from `asOfMs`. Reconstruction adds back any units sold
  // between asOfMs and now so the result reflects yesterday-night state.
  const useReconstruction = asOfMs != null && Number.isFinite(asOfMs) && asOfMs < Date.now() - 60_000;
  const inventoryByStore = useReconstruction
    ? await reconstructOnHandAt(asOfMs!).catch(async () => {
        console.warn('[bake-haus] reconstructOnHandAt failed; falling back to live inventory for lock');
        return getBakeHausInventoryByStore().catch(() => ({} as Record<string, Record<string, number>>));
      })
    : await getBakeHausInventoryByStore().catch(() => ({} as Record<string, Record<string, number>>));

  // Catalog lookup so we know which items skip Monday — locked Mon
  // qty stays 0 for those items even after the lock action runs.
  const catalogByName = new Map<string, BakeHausCatalogItem>();
  for (const c of getMergedCatalog()) catalogByName.set(c.name, c);

  const updateRow = db.prepare(
    `UPDATE bake_haus_orders SET
       mon_locked_qty = ?,
       wed_locked_qty = ?,
       fri_locked_qty = ?
     WHERE week_start_iso = ? AND store_label = ? AND item_name = ?`,
  );
  const insertLock = db.prepare(
    `INSERT INTO bake_haus_week_locks (week_start_iso, mon_locked_at, locked_by, lock_source)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(week_start_iso) DO UPDATE SET
       mon_locked_at = excluded.mon_locked_at,
       locked_by = COALESCE(excluded.locked_by, bake_haus_week_locks.locked_by),
       lock_source = excluded.lock_source`,
  );

  const lockedAt = Date.now();
  const txn = db.transaction(() => {
    for (const r of rows) {
      const onHand = inventoryByStore[r.store_label]?.[r.item_name] ?? 0;
      const netQty = Math.max(0, r.weekly_qty - onHand);
      const catEntry = catalogByName.get(r.item_name);
      const includeMonday = catEntry?.includeMonday ?? true;
      const prioritizeEarly = onHand === 0 && netQty > 0;
      // Preserve any value that's already been snapshotted — locks
      // are additive, not destructive. A Mon-only legacy lock keeps
      // its Mon qty when the week-wide lock fires.
      const split = splitForDeliveries(netQty, null, includeMonday, prioritizeEarly);
      const monSnap = r.mon_locked_qty != null
        ? r.mon_locked_qty
        : (includeMonday ? split.mon : 0);
      const wedSnap = r.wed_locked_qty != null ? r.wed_locked_qty : split.wed;
      const friSnap = r.fri_locked_qty != null ? r.fri_locked_qty : split.fri;
      updateRow.run(monSnap, wedSnap, friSnap, r.week_start_iso, r.store_label, r.item_name);
    }
    insertLock.run(weekStartIso, lockedAt, lockedBy, source);
  });
  txn();

  return { rowsSnapshotted: rows.length, mode: useReconstruction ? 'reconstructed' : 'live' };
}

export function unlockWeek(weekStartIso: string): void {
  db.prepare('DELETE FROM bake_haus_week_locks WHERE week_start_iso = ?').run(weekStartIso);
  // Also clear any individual day locks — otherwise a per-day lock row
  // would keep that day frozen after a full unlock (the day-lock state
  // is an OR of week + per-day rows).
  db.prepare('DELETE FROM bake_haus_day_locks WHERE week_start_iso = ?').run(weekStartIso);
  // Clear per-row snapshots so the next lock captures fresh values
  // (otherwise stale Wed/Fri qtys from an earlier lock would carry
  // forward and we'd snapshot pre-lock state on the next freeze).
  db.prepare(
    `UPDATE bake_haus_orders
        SET mon_locked_qty = NULL,
            wed_locked_qty = NULL,
            fri_locked_qty = NULL
      WHERE week_start_iso = ?`,
  ).run(weekStartIso);
}

/** Returns true when the week is fully locked. Cheap — single index lookup. */
export function isWeekLocked(weekStartIso: string): boolean {
  const row = db.prepare(
    'SELECT 1 FROM bake_haus_week_locks WHERE week_start_iso = ? LIMIT 1',
  ).get(weekStartIso);
  return !!row;
}

export type DeliveryDay = 'mon' | 'wed' | 'fri';
const LOCK_COL: Record<DeliveryDay, 'mon_locked_qty' | 'wed_locked_qty' | 'fri_locked_qty'> = {
  mon: 'mon_locked_qty', wed: 'wed_locked_qty', fri: 'fri_locked_qty',
};

/** Combined per-day lock state for a week. A day reads as locked when
 *  the whole-week lock is set (it dominates and wins on metadata) OR an
 *  individual day-lock row exists for it. */
export function getDayLockState(weekStartIso: string): {
  mon: DayLockMeta | null; wed: DayLockMeta | null; fri: DayLockMeta | null;
} {
  const weekRow = db.prepare(
    'SELECT mon_locked_at, locked_by, lock_source FROM bake_haus_week_locks WHERE week_start_iso = ?',
  ).get(weekStartIso) as { mon_locked_at: number; locked_by: string | null; lock_source: string | null } | undefined;
  const weekMeta: DayLockMeta | null = weekRow
    ? {
        lockedAt: weekRow.mon_locked_at,
        lockedBy: weekRow.locked_by ?? null,
        source: weekRow.lock_source === 'auto' ? 'auto' : 'manual',
      }
    : null;
  const dayRows = db.prepare(
    'SELECT day, locked_at, locked_by, lock_source FROM bake_haus_day_locks WHERE week_start_iso = ?',
  ).all(weekStartIso) as Array<{ day: string; locked_at: number; locked_by: string | null; lock_source: string | null }>;
  const byDay = new Map<string, DayLockMeta>();
  for (const r of dayRows) {
    byDay.set(r.day, {
      lockedAt: r.locked_at,
      lockedBy: r.locked_by ?? null,
      source: r.lock_source === 'auto' ? 'auto' : 'manual',
    });
  }
  const pick = (day: DeliveryDay): DayLockMeta | null => weekMeta ?? byDay.get(day) ?? null;
  return { mon: pick('mon'), wed: pick('wed'), fri: pick('fri') };
}

/** True when the given delivery day is frozen for the week. */
export function isDayLocked(weekStartIso: string, day: DeliveryDay): boolean {
  return getDayLockState(weekStartIso)[day] !== null;
}

/** Lock-status summary for one item: which of its active delivery days
 *  are frozen, and whether *every* active day is locked (in which case
 *  the item is fully frozen — no qty edits possible for non-allowlist
 *  users). Items that skip Monday have only Wed/Fri as active days. */
export function getItemLockInfo(weekStartIso: string, itemName: string): {
  activeDays: DeliveryDay[];
  lockedDays: DeliveryDay[];
  fullyLocked: boolean;
} {
  const catEntry = getMergedCatalog().find((c) => c.name === itemName);
  const includeMonday = catEntry?.includeMonday ?? true;
  const activeDays: DeliveryDay[] = includeMonday ? ['mon', 'wed', 'fri'] : ['wed', 'fri'];
  const state = getDayLockState(weekStartIso);
  const lockedDays = activeDays.filter((d) => state[d] !== null);
  return { activeDays, lockedDays, fullyLocked: lockedDays.length === activeDays.length };
}

/** Floor qty for one (week, store, item): the sum of frozen delivery
 *  qtys across that item's locked days. A qty edit may not drop below
 *  this, since doing so would shrink an already-locked day's delivery.
 *  Returns 0 when no day is locked or no snapshot exists yet. */
export function lockedFloorForRow(weekStartIso: string, storeLabel: string, itemName: string): number {
  const { lockedDays } = getItemLockInfo(weekStartIso, itemName);
  if (lockedDays.length === 0) return 0;
  const row = db.prepare(
    `SELECT mon_locked_qty, wed_locked_qty, fri_locked_qty
       FROM bake_haus_orders
      WHERE week_start_iso = ? AND store_label = ? AND item_name = ?`,
  ).get(weekStartIso, storeLabel, itemName) as
    | { mon_locked_qty: number | null; wed_locked_qty: number | null; fri_locked_qty: number | null }
    | undefined;
  if (!row) return 0;
  let floor = 0;
  for (const d of lockedDays) {
    const v = row[LOCK_COL[d]];
    if (v != null && Number.isFinite(v)) floor += v;
  }
  return floor;
}

/** Lock a single delivery day for the week — snapshots each row's
 *  current split value for that day into the matching *_locked_qty
 *  column and writes a `bake_haus_day_locks` row. The other days stay
 *  live & editable. The snapshot honors days already locked, so locking
 *  Wed after Mon captures the Wed qty as currently shown. Idempotent:
 *  re-locking preserves the existing snapshot (locks are additive). */
export async function lockDay(
  weekStartIso: string,
  day: DeliveryDay,
  lockedBy: string | null = null,
  source: 'manual' | 'auto' = 'manual',
  asOfMs?: number | null,
): Promise<{ rowsSnapshotted: number; mode: 'live' | 'reconstructed' }> {
  const rows = db.prepare(
    `SELECT week_start_iso, store_label, item_name, weekly_qty, notes,
            mon_locked_qty, wed_locked_qty, fri_locked_qty
     FROM bake_haus_orders
     WHERE week_start_iso = ?`,
  ).all(weekStartIso) as DbRow[];

  const useReconstruction = asOfMs != null && Number.isFinite(asOfMs) && asOfMs < Date.now() - 60_000;
  const inventoryByStore = useReconstruction
    ? await reconstructOnHandAt(asOfMs!).catch(async () => {
        console.warn('[bake-haus] reconstructOnHandAt failed; falling back to live inventory for day-lock');
        return getBakeHausInventoryByStore().catch(() => ({} as Record<string, Record<string, number>>));
      })
    : await getBakeHausInventoryByStore().catch(() => ({} as Record<string, Record<string, number>>));

  const catalogByName = new Map<string, BakeHausCatalogItem>();
  for (const c of getMergedCatalog()) catalogByName.set(c.name, c);

  // Other days already locked — their frozen qty must feed the split so
  // the day we're locking now snapshots the value currently shown.
  const otherState = getDayLockState(weekStartIso);
  const col = LOCK_COL[day];

  const updateRow = db.prepare(
    `UPDATE bake_haus_orders SET ${col} = ?
       WHERE week_start_iso = ? AND store_label = ? AND item_name = ?`,
  );
  const insertLock = db.prepare(
    `INSERT INTO bake_haus_day_locks (week_start_iso, day, locked_at, locked_by, lock_source)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(week_start_iso, day) DO UPDATE SET
       locked_at = excluded.locked_at,
       locked_by = COALESCE(excluded.locked_by, bake_haus_day_locks.locked_by),
       lock_source = excluded.lock_source`,
  );

  const lockedAt = Date.now();
  const txn = db.transaction(() => {
    for (const r of rows) {
      const onHand = inventoryByStore[r.store_label]?.[r.item_name] ?? 0;
      const netQty = Math.max(0, r.weekly_qty - onHand);
      const catEntry = catalogByName.get(r.item_name);
      const includeMonday = catEntry?.includeMonday ?? true;
      const prioritizeEarly = onHand === 0 && netQty > 0;

      // Items that skip Monday never freeze a Mon qty.
      if (day === 'mon' && !includeMonday) {
        updateRow.run(0, r.week_start_iso, r.store_label, r.item_name);
        continue;
      }
      // Preserve an existing snapshot — re-lock is additive.
      const existing = r[col];
      if (existing != null) continue;

      // Build the split with the OTHER already-locked days pinned so the
      // value we capture matches what the report currently shows.
      const unlockedSplit = splitForDeliveries(netQty, null, includeMonday, prioritizeEarly);
      const locks: DayLocks = {};
      if (day !== 'mon' && otherState.mon && includeMonday) {
        locks.mon = r.mon_locked_qty != null ? r.mon_locked_qty : unlockedSplit.mon;
      }
      if (day !== 'wed' && otherState.wed) {
        locks.wed = r.wed_locked_qty != null ? r.wed_locked_qty : unlockedSplit.wed;
      }
      if (day !== 'fri' && otherState.fri) {
        locks.fri = r.fri_locked_qty != null ? r.fri_locked_qty : unlockedSplit.fri;
      }
      const split = splitForDeliveries(netQty, locks, includeMonday, prioritizeEarly);
      updateRow.run(split[day], r.week_start_iso, r.store_label, r.item_name);
    }
    insertLock.run(weekStartIso, day, lockedAt, lockedBy, source);
  });
  txn();

  return { rowsSnapshotted: rows.length, mode: useReconstruction ? 'reconstructed' : 'live' };
}

/** Clear a single day's lock — removes the day-lock row and nulls that
 *  day's snapshot column so it recomputes live. No-op on the whole-week
 *  lock (use `unlockWeek` for that); a day that's locked only via the
 *  week lock can't be individually unlocked. */
export function unlockDay(weekStartIso: string, day: DeliveryDay): void {
  db.prepare('DELETE FROM bake_haus_day_locks WHERE week_start_iso = ? AND day = ?').run(weekStartIso, day);
  const col = LOCK_COL[day];
  db.prepare(
    `UPDATE bake_haus_orders SET ${col} = NULL WHERE week_start_iso = ?`,
  ).run(weekStartIso);
}

/** Emails that always have bakery lock/unlock powers, regardless of
 *  env config. Lowercase. Keep this short — env (BAKE_HAUS_UNLOCK_EMAILS)
 *  is the real source of truth; this is a hardcoded fallback. */
const BUILTIN_BAKE_HAUS_UNLOCK_EMAILS = ['ben@germaniabrewhaus.com'];

/** Allowlist gate for unlock + post-lock edits. Reads
 *  BAKE_HAUS_UNLOCK_EMAILS (comma-separated) and accepts admins listed
 *  in ADMIN_EMAILS as a backstop. Comparison is case-insensitive
 *  because email entry in the wild is inconsistent. */
export function isUserAllowedToUnlock(email: string | null | undefined): boolean {
  if (!email) return false;
  const target = email.trim().toLowerCase();
  if (!target) return false;
  // Built-in bakery allowlist — works even when the Render
  // BAKE_HAUS_UNLOCK_EMAILS env var isn't set or is mid-update. Ben is
  // here so he can test bakery lock/unlock without an env round-trip.
  if (BUILTIN_BAKE_HAUS_UNLOCK_EMAILS.includes(target)) return true;
  const allowlist = (process.env.BAKE_HAUS_UNLOCK_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.includes(target)) return true;
  const adminBackstop = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return adminBackstop.includes(target);
}

/** Per-store, per-item inventory at a past timestamp, reconstructed
 *  from current Dripos on-hand + units sold between `asOfMs` and now.
 *  Used by `lockWeek` so a mid-week manual lock captures last-night's
 *  state instead of today's (post-customer-traffic) state.
 *
 *  Sales data comes from Dripos /report/productsales for the
 *  [asOfMs, now] window. Item-name matching mirrors the live
 *  inventory map: fuzzy token match for food (LINE_ITEM_NAME →
 *  canonical name from BAKE_HAUS_ITEMS), exact ID match for syrups
 *  (PRODUCT_ID → dripos_product_id). The returned shape is
 *  API-compatible with `getBakeHausInventoryByStore`. */
export async function reconstructOnHandAt(
  asOfMs: number,
): Promise<Record<string, Record<string, number>>> {
  const live = await getBakeHausInventoryByStore();
  const sales = await getBakeHausSalesByStoreSince(asOfMs);
  const reconstructed: Record<string, Record<string, number>> = {};
  for (const [storeLabel, byItem] of Object.entries(live)) {
    reconstructed[storeLabel] = {};
    for (const [itemName, currentOnHand] of Object.entries(byItem)) {
      const soldSince = sales[storeLabel]?.[itemName] ?? 0;
      reconstructed[storeLabel][itemName] = currentOnHand + soldSince;
    }
  }
  return reconstructed;
}

/** Pull units sold per (store, canonical item name) for the time
 *  window [sinceMs, now]. Aggregates across all platforms (POS,
 *  Mobile, Web, Kiosk, etc.) and translates Dripos product names
 *  to bake-haus catalog names using the same matchers as the
 *  inventory map. Falls back to an empty map on Dripos failure
 *  (no token, API error) — caller decides how to degrade. */
async function getBakeHausSalesByStoreSince(
  sinceMs: number,
): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {};
  for (const store of STORES) out[store.label] = {};

  const syrups = listSyrups(false);
  const syrupByDriposId = new Map<number, SyrupRow>();
  for (const s of syrups) syrupByDriposId.set(s.driposProductId, s);

  await Promise.all(
    STORES.map(async (store) => {
      try {
        const rows = await fetchProductSales([store.locationId], sinceMs, Date.now());
        // Aggregate ORDER_COUNT per LINE_ITEM_NAME for food and
        // per PRODUCT_ID for syrups. Then map both into canonical
        // bake-haus catalog names.
        const byLineName = new Map<string, number>();
        const byProductId = new Map<number, number>();
        for (const r of rows) {
          if (!Number.isFinite(r.ORDER_COUNT) || r.ORDER_COUNT <= 0) continue;
          const lineKey = String(r.LINE_ITEM_NAME || '').trim();
          if (lineKey) byLineName.set(lineKey, (byLineName.get(lineKey) ?? 0) + r.ORDER_COUNT);
          const pid = Number(r.PRODUCT_ID);
          if (Number.isFinite(pid)) byProductId.set(pid, (byProductId.get(pid) ?? 0) + r.ORDER_COUNT);
        }

        // Food items: fuzzy match LINE_ITEM_NAME → catalog item name.
        const lineCandidates = Array.from(byLineName.keys()).map((name) => ({ NAME: name, ARCHIVED: 0 }));
        for (const item of BAKE_HAUS_ITEMS) {
          const matched = findProductForCatalogItem(item, lineCandidates);
          if (matched) {
            const units = byLineName.get(matched.NAME) ?? 0;
            if (units > 0) out[store.label][item.name] = (out[store.label][item.name] ?? 0) + units;
          }
        }
        // Syrups: exact PRODUCT_ID match.
        for (const [pid, units] of byProductId.entries()) {
          const syrup = syrupByDriposId.get(pid);
          if (!syrup) continue;
          out[store.label][syrup.displayName] = (out[store.label][syrup.displayName] ?? 0) + units;
        }
      } catch (err) {
        console.warn(
          `[bake-haus] sales-since-${sinceMs} fetch for ${store.label} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );
  return out;
}

// ── Backwards-compat shims for the existing Mon-only lock routes ─────
// `lockWeekMonday` and `unlockWeekMonday` delegate to the new week-wide
// functions so the existing `/lock-monday` endpoint keeps working until
// the frontend deploys. New code should call `lockWeek` / `unlockWeek`
// directly.
export async function lockWeekMonday(
  weekStartIso: string,
  lockedBy: string | null = null,
): Promise<void> {
  await lockWeek(weekStartIso, lockedBy, 'manual', null);
}
export function unlockWeekMonday(weekStartIso: string): void {
  unlockWeek(weekStartIso);
}

/** Snapshot each row's current Mon qty into mon_locked_qty for one
 *  (week, store). Called from the save endpoint when the user does a
 *  baseline-establishing save (initial save or "update everything").
 *  When the user later picks "Lock Mon," we use this snapshot rather
 *  than re-computing from the (possibly post-edit) weekly_qty. */
export async function snapshotMonForStoreWeek(
  weekStartIso: string,
  storeLabel: string,
): Promise<void> {
  const rows = db.prepare(
    `SELECT week_start_iso, store_label, item_name, weekly_qty, notes, mon_locked_qty
     FROM bake_haus_orders
     WHERE week_start_iso = ? AND store_label = ?`,
  ).all(weekStartIso, storeLabel) as DbRow[];

  const inventoryByStore = await getBakeHausInventoryByStore().catch(() => ({} as Record<string, Record<string, number>>));

  const updateRow = db.prepare(
    `UPDATE bake_haus_orders SET mon_locked_qty = ?
      WHERE week_start_iso = ? AND store_label = ? AND item_name = ?`,
  );

  const txn = db.transaction(() => {
    for (const r of rows) {
      const onHand = inventoryByStore[r.store_label]?.[r.item_name] ?? 0;
      const netQty = Math.max(0, r.weekly_qty - onHand);
      const split = splitForDeliveries(netQty, null);
      updateRow.run(split.mon, r.week_start_iso, r.store_label, r.item_name);
    }
  });
  txn();
}

export function upsertOrderItem(args: {
  weekStartIso: string;
  storeLabel: string;
  itemName: string;
  weeklyQty: number;
  notes?: string | null;
}): void {
  const canonical = canonicalizeItemName(args.itemName);
  db.prepare(
    `INSERT INTO bake_haus_orders (week_start_iso, store_label, item_name, weekly_qty, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(week_start_iso, store_label, item_name) DO UPDATE SET
       weekly_qty = excluded.weekly_qty,
       notes = excluded.notes,
       updated_at = excluded.updated_at`,
  ).run(args.weekStartIso, args.storeLabel, canonical, args.weeklyQty, args.notes ?? null, Date.now());
}

export function deleteOrderItem(
  weekStartIso: string,
  storeLabel: string,
  itemName: string,
): void {
  db.prepare(
    `DELETE FROM bake_haus_orders
     WHERE week_start_iso = ? AND store_label = ? AND item_name = ?`,
  ).run(weekStartIso, storeLabel, canonicalizeItemName(itemName));
}

export interface SavedOrderSummary {
  weekStartIso: string;
  storeLabel: string;
  savedAt: number;
  savedBy: string | null;
  itemCount: number;
  totalQty: number;
}

export async function markOrderSaved(
  weekStartIso: string,
  storeLabel: string,
  savedBy: string | null = null,
): Promise<void> {
  db.prepare(
    `INSERT INTO bake_haus_saved_orders (week_start_iso, store_label, saved_at, saved_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(week_start_iso, store_label) DO UPDATE SET
       saved_at = excluded.saved_at,
       saved_by = COALESCE(excluded.saved_by, bake_haus_saved_orders.saved_by)`,
  ).run(weekStartIso, storeLabel, Date.now(), savedBy);
  // After the 4th store saves we have the full picture of what's
  // headed where. Capture a snapshot of the delivery schedule so it's
  // retrievable later from the Saved Orders tab even if someone edits
  // a qty after the fact.
  await maybeSnapshotDeliverySchedule(weekStartIso, savedBy).catch((err) => {
    console.warn('[bake-haus snapshot] failed:', err instanceof Error ? err.message : err);
  });
}

/** Create a delivery-schedule snapshot for the week once ALL stores
 *  have saved their orders. Idempotent: if a snapshot already exists
 *  for the week, this is a no-op. The snapshot payload is a JSON
 *  serialization of the per-day delivery summary + store list + week
 *  totals — same shape the printable schedule consumes. */
async function maybeSnapshotDeliverySchedule(
  weekStartIso: string,
  savedBy: string | null,
): Promise<void> {
  const existing = db.prepare(
    'SELECT week_start_iso FROM bake_haus_delivery_snapshots WHERE week_start_iso = ?',
  ).get(weekStartIso);
  if (existing) return;

  const savedRow = db.prepare(
    'SELECT COUNT(DISTINCT store_label) AS storeCount FROM bake_haus_saved_orders WHERE week_start_iso = ?',
  ).get(weekStartIso) as { storeCount: number };
  if ((savedRow?.storeCount ?? 0) < STORES.length) return;

  // Pull the current report — this captures the live delivery split at
  // the moment all 4 stores finalized. Subsequent edits don't touch
  // the snapshot.
  const report = await getWeekReport(weekStartIso);
  let weekTotal = 0;
  for (const day of ['mon', 'wed', 'fri'] as const) {
    const dayMap = report.deliverySummary[day] ?? {};
    for (const perStore of Object.values(dayMap)) {
      for (const q of Object.values(perStore)) weekTotal += q;
    }
  }
  const payload = JSON.stringify({
    weekStartIso,
    deliverySummary: report.deliverySummary,
    stores: STORES.map((s) => s.label),
    inventoryFetchedAt: report.inventoryFetchedAt,
    snapshotAt: Date.now(),
  });
  db.prepare(
    `INSERT INTO bake_haus_delivery_snapshots (week_start_iso, payload, week_total, saved_at, saved_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(week_start_iso) DO NOTHING`,
  ).run(weekStartIso, payload, weekTotal, Date.now(), savedBy);
}

export interface DeliverySnapshotSummary {
  weekStartIso: string;
  weekTotal: number;
  savedAt: number;
  savedBy: string | null;
}

export function listDeliverySnapshots(limit = 52): DeliverySnapshotSummary[] {
  return db.prepare(
    `SELECT week_start_iso AS weekStartIso,
            week_total      AS weekTotal,
            saved_at        AS savedAt,
            saved_by        AS savedBy
       FROM bake_haus_delivery_snapshots
      ORDER BY saved_at DESC
      LIMIT ?`,
  ).all(limit) as DeliverySnapshotSummary[];
}

export function getDeliverySnapshot(weekStartIso: string): {
  weekStartIso: string;
  weekTotal: number;
  savedAt: number;
  savedBy: string | null;
  payload: any;
} | null {
  const row = db.prepare(
    `SELECT week_start_iso AS weekStartIso, week_total AS weekTotal,
            saved_at AS savedAt, saved_by AS savedBy, payload
       FROM bake_haus_delivery_snapshots
      WHERE week_start_iso = ?`,
  ).get(weekStartIso) as any;
  if (!row) return null;
  let payload: any = null;
  try { payload = JSON.parse(row.payload); } catch { /* malformed row */ }
  return {
    weekStartIso: row.weekStartIso,
    weekTotal: row.weekTotal,
    savedAt: row.savedAt,
    savedBy: row.savedBy,
    payload,
  };
}

export function unmarkOrderSaved(weekStartIso: string, storeLabel: string): void {
  db.prepare(
    'DELETE FROM bake_haus_saved_orders WHERE week_start_iso = ? AND store_label = ?',
  ).run(weekStartIso, storeLabel);
}

export function listSavedOrders(): SavedOrderSummary[] {
  // Join saved_orders with aggregated order totals per (week, store)
  // so the UI doesn't have to make follow-up requests for each summary.
  const rows = db.prepare(
    `SELECT
        s.week_start_iso AS weekStartIso,
        s.store_label    AS storeLabel,
        s.saved_at       AS savedAt,
        s.saved_by       AS savedBy,
        COALESCE(o.itemCount, 0)  AS itemCount,
        COALESCE(o.totalQty, 0)   AS totalQty
     FROM bake_haus_saved_orders s
     LEFT JOIN (
       SELECT week_start_iso, store_label,
              COUNT(*) AS itemCount,
              SUM(weekly_qty) AS totalQty
         FROM bake_haus_orders
         WHERE weekly_qty > 0
        GROUP BY week_start_iso, store_label
     ) o ON o.week_start_iso = s.week_start_iso AND o.store_label = s.store_label
     ORDER BY s.saved_at DESC`,
  ).all() as SavedOrderSummary[];
  return rows;
}

// ─── Syrup catalog (DB-backed, editable) ──────────────────────────

export interface SyrupRow {
  id: number;
  displayName: string;
  driposProductId: number;
  driposProductName: string;
  sort: number;
  includeMonday: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

interface SyrupDbRow {
  id: number;
  display_name: string;
  dripos_product_id: number;
  dripos_product_name: string;
  sort: number;
  include_monday: number;
  active: number;
  created_at: number;
  updated_at: number;
}

function rowToSyrup(r: SyrupDbRow): SyrupRow {
  return {
    id: r.id,
    displayName: r.display_name,
    driposProductId: r.dripos_product_id,
    driposProductName: r.dripos_product_name,
    sort: r.sort,
    includeMonday: r.include_monday === 1,
    active: r.active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listSyrups(includeInactive = false): SyrupRow[] {
  const rows = (includeInactive
    ? db.prepare('SELECT * FROM bake_haus_syrups ORDER BY sort, display_name').all()
    : db.prepare('SELECT * FROM bake_haus_syrups WHERE active = 1 ORDER BY sort, display_name').all()
  ) as SyrupDbRow[];
  return rows.map(rowToSyrup);
}

export function getSyrup(id: number): SyrupRow | null {
  const r = db.prepare('SELECT * FROM bake_haus_syrups WHERE id = ?').get(id) as SyrupDbRow | undefined;
  return r ? rowToSyrup(r) : null;
}

export function createSyrup(args: {
  displayName: string;
  driposProductId: number;
  driposProductName: string;
  sort?: number;
  includeMonday?: boolean;
}): SyrupRow {
  const now = Date.now();
  const sort = args.sort ?? 100;
  const include = args.includeMonday ? 1 : 0;
  const info = db.prepare(
    `INSERT INTO bake_haus_syrups
       (display_name, dripos_product_id, dripos_product_name, sort, include_monday, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(args.displayName, args.driposProductId, args.driposProductName, sort, include, now, now);
  return getSyrup(info.lastInsertRowid as number)!;
}

export function updateSyrup(
  id: number,
  args: Partial<{
    displayName: string;
    driposProductId: number;
    driposProductName: string;
    sort: number;
    includeMonday: boolean;
    active: boolean;
  }>,
): SyrupRow | null {
  const cur = getSyrup(id);
  if (!cur) return null;
  const next = {
    displayName: args.displayName ?? cur.displayName,
    driposProductId: args.driposProductId ?? cur.driposProductId,
    driposProductName: args.driposProductName ?? cur.driposProductName,
    sort: args.sort ?? cur.sort,
    includeMonday: args.includeMonday ?? cur.includeMonday,
    active: args.active ?? cur.active,
  };
  db.prepare(
    `UPDATE bake_haus_syrups SET
       display_name = ?, dripos_product_id = ?, dripos_product_name = ?,
       sort = ?, include_monday = ?, active = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.displayName, next.driposProductId, next.driposProductName,
    next.sort, next.includeMonday ? 1 : 0, next.active ? 1 : 0,
    Date.now(), id,
  );
  return getSyrup(id);
}

export function deleteSyrup(id: number): boolean {
  const info = db.prepare('DELETE FROM bake_haus_syrups WHERE id = ?').run(id);
  return info.changes > 0;
}

/** Merged catalog: hardcoded food items + active syrups. Stable item
 *  identity comes from `name` (food canonical name OR syrup display
 *  name). Order pages and getWeekReport both consume this. */
export function getMergedCatalog(): BakeHausCatalogItem[] {
  const food: BakeHausCatalogItem[] = BAKE_HAUS_ITEMS.map((i) => ({
    name: i.name,
    sort: i.sort,
    category: 'food',
    includeMonday: true,
    driposProductId: null,
    driposProductName: null,
  }));
  const syrups: BakeHausCatalogItem[] = listSyrups(false).map((s) => ({
    name: s.displayName,
    // Syrups sort below food. Base at 1000 + per-row sort so adding
    // a new food item with sort < 1000 still slots above all syrups.
    sort: 1000 + s.sort,
    category: 'syrup-sauce',
    includeMonday: s.includeMonday,
    driposProductId: s.driposProductId,
    driposProductName: s.driposProductName,
  }));
  return [...food, ...syrups].sort((a, b) =>
    a.sort - b.sort || a.name.localeCompare(b.name),
  );
}

// ─── Week / report helpers ────────────────────────────────────────

/** Returns the ISO date (YYYY-MM-DD) of the Monday of the week containing
 *  the given date. Uses local time so "this week" matches a manager's
 *  intuition rather than UTC. */
export function mondayOfWeek(d: Date = new Date()): string {
  const local = new Date(d);
  const day = local.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  local.setDate(local.getDate() + diff);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, '0');
  const dd = String(local.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
