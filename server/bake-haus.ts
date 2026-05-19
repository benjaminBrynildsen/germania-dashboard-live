/**
 * Bake Haus order management — Joe/Tristan's weekly per-store food orders
 * to Chef Maggie. The dashboard auto-splits each weekly qty across the
 * Mon/Wed/Fri deliveries.
 *
 * Sauces/syrups are intentionally out of scope here — those are broken
 * down by the chef on prep days and handled outside this system.
 */
import db from './db.js';
import { BAKE_HAUS_CATEGORY, fetchAllProducts, fetchInventory, STORES } from './dripos.js';

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
  { name: 'Waffles',                       aliases: ['waffles', 'waffle'], sort: 90 },
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
  const wantTokens = new Set(normalizeForMatch(item.name).split(' ').filter(Boolean));
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
  const wantTokens = new Set(normalizeForMatch(item.name).split(' ').filter(Boolean));
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
  candidates.sort((a, b) => b.score - a.score);
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
export function splitForDeliveries(
  weeklyQty: number,
  /** When non-null, Monday's qty is frozen to this value (set when the
   *  week is locked after the kitchen starts baking off Monday's
   *  count). Wed/Fri then split
   *  the remaining qty 2:3. Pass null/undefined for the normal 2/7
   *  2/7 3/7 split. */
  monLockedQty?: number | null,
  /** When false, this item skips Monday entirely (Mon=0, Wed/Fri at
   *  2:3). Used for most syrups + sauces which are made Tue/Thu and
   *  only delivered Wed/Fri. Defaults to true. */
  includeMonday: boolean = true,
): {
  mon: number;
  wed: number;
  fri: number;
} {
  if (!Number.isFinite(weeklyQty) || weeklyQty <= 0) {
    return { mon: 0, wed: 0, fri: 0 };
  }
  const total = Math.round(weeklyQty);
  if (total <= 0) return { mon: 0, wed: 0, fri: 0 };

  // No-Monday branch (most syrups/sauces): split across Wed/Fri at
  // 2:3. Lock state is moot — Mon is always 0 here.
  if (!includeMonday) {
    const wed = Math.round(total * (2 / 5));
    const fri = Math.max(0, total - wed);
    return { mon: 0, wed, fri };
  }

  if (monLockedQty != null && Number.isFinite(monLockedQty)) {
    // Locked branch: mon is fixed. Anything left goes to wed/fri at
    // 2:3 (matching the 2-day vs 3-day delivery coverage). If the new
    // weekly qty has been *reduced* below the locked Mon qty (very
    // unusual — would mean the store is unordering items already
    // delivered), cap mon at total and zero out the rest.
    const mon = Math.max(0, Math.min(Math.round(monLockedQty), total));
    const remaining = Math.max(0, total - mon);
    let wed = Math.round(remaining * (2 / 5));
    let fri = remaining - wed;
    if (fri < 0) { fri = 0; }
    return { mon, wed, fri };
  }

  let mon = Math.round(total * (2 / 7));
  let wed = Math.round(total * (2 / 7));
  let fri = total - mon - wed;
  // Guard against rounding driving fri below the other two (e.g. for
  // very small weekly qty): if fri < wed, redistribute one unit.
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
  /** When the week is locked, the frozen Mon qty for this row. null
   *  when the week isn't locked or this row was added after lock. */
  monLockedQty: number | null;
  /** 'food' or 'syrup-sauce', for the order card's section grouping. */
  category: 'food' | 'syrup-sauce' | 'custom';
  /** Whether this item delivers on Monday. false → Wed/Fri only. */
  includeMonday: boolean;
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
  /** Set when the week's Monday delivery has been locked. After this,
   *  any qty edits flow into Wed/Fri only — Mon stays frozen at the
   *  per-row mon_locked_qty snapshot taken at lock time. */
  monLock: {
    lockedAt: number;
    lockedBy: string | null;
  } | null;
}

interface DbRow {
  week_start_iso: string;
  store_label: string;
  item_name: string;
  weekly_qty: number;
  notes: string | null;
  mon_locked_qty: number | null;
}

/** Sort items by the catalog order; unknown items go to the bottom. */
function itemSortKey(name: string): number {
  const found = BAKE_HAUS_ITEMS.find((i) => i.name === name);
  return found?.sort ?? 1000;
}

export async function getWeekReport(weekStartIso: string): Promise<BakeHausWeekReport> {
  const rows = db.prepare(
    `SELECT week_start_iso, store_label, item_name, weekly_qty, notes, mon_locked_qty
     FROM bake_haus_orders
     WHERE week_start_iso = ?`,
  ).all(weekStartIso) as DbRow[];

  // Week-level Mon lock state. When present, the per-row mon_locked_qty
  // snapshots are authoritative for Monday's delivery.
  const lockRow = db.prepare(
    'SELECT mon_locked_at, locked_by FROM bake_haus_week_locks WHERE week_start_iso = ?',
  ).get(weekStartIso) as { mon_locked_at: number; locked_by: string | null } | undefined;
  const monLock = lockRow
    ? { lockedAt: lockRow.mon_locked_at, lockedBy: lockRow.locked_by ?? null }
    : null;

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
    // Lock semantics: when the week is locked AND this item gets a
    // Monday delivery, use the row's snapshot (or the unlocked
    // computed Mon as a fallback if snapshot is NULL). For items
    // that skip Monday (most syrups), the lock is irrelevant.
    let lockedMonQty: number | null = null;
    if (monLock && includeMonday) {
      lockedMonQty = r.mon_locked_qty != null
        ? r.mon_locked_qty
        : splitForDeliveries(netQty, null, true).mon;
    }
    const split = splitForDeliveries(netQty, lockedMonQty, includeMonday);
    const row: BakeHausOrderRow = {
      weekStartIso: r.week_start_iso,
      storeLabel: r.store_label,
      itemName: r.item_name,
      weeklyQty: r.weekly_qty,
      notes: r.notes,
      onHand,
      netQty,
      delivery: split,
      monLockedQty: lockedMonQty,
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
  };
}

/** Lock the week's Monday delivery — flips the week-lock flag, and
 *  backfills mon_locked_qty for any row that doesn't have a baseline
 *  snapshot yet. Rows that DO have a snapshot are preserved as-is
 *  (they were captured at the last "update everything" save and
 *  represent the user's intended freeze point). */
export async function lockWeekMonday(
  weekStartIso: string,
  lockedBy: string | null = null,
): Promise<void> {
  const rows = db.prepare(
    `SELECT week_start_iso, store_label, item_name, weekly_qty, notes, mon_locked_qty
     FROM bake_haus_orders
     WHERE week_start_iso = ? AND mon_locked_qty IS NULL`,
  ).all(weekStartIso) as DbRow[];

  // Only fetch inventory if we have rows to backfill (saves a network
  // call when every row already has a snapshot).
  const inventoryByStore = rows.length > 0
    ? await getBakeHausInventoryByStore().catch(() => ({} as Record<string, Record<string, number>>))
    : {};

  const updateRow = db.prepare(
    `UPDATE bake_haus_orders SET mon_locked_qty = ?
      WHERE week_start_iso = ? AND store_label = ? AND item_name = ?`,
  );
  const insertLock = db.prepare(
    `INSERT INTO bake_haus_week_locks (week_start_iso, mon_locked_at, locked_by)
     VALUES (?, ?, ?)
     ON CONFLICT(week_start_iso) DO UPDATE SET
       mon_locked_at = excluded.mon_locked_at,
       locked_by = COALESCE(excluded.locked_by, bake_haus_week_locks.locked_by)`,
  );

  const txn = db.transaction(() => {
    for (const r of rows) {
      const onHand = inventoryByStore[r.store_label]?.[r.item_name] ?? 0;
      const netQty = Math.max(0, r.weekly_qty - onHand);
      const split = splitForDeliveries(netQty, null);
      updateRow.run(split.mon, r.week_start_iso, r.store_label, r.item_name);
    }
    insertLock.run(weekStartIso, Date.now(), lockedBy);
  });
  txn();
}

export function unlockWeekMonday(weekStartIso: string): void {
  db.prepare('DELETE FROM bake_haus_week_locks WHERE week_start_iso = ?').run(weekStartIso);
  // Note: mon_locked_qty per-row snapshots are intentionally NOT
  // cleared on unlock. They represent the baseline at the last
  // non-locking save; they'll be refreshed on the next non-locking
  // save (via snapshotMonForStoreWeek).
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

export function markOrderSaved(
  weekStartIso: string,
  storeLabel: string,
  savedBy: string | null = null,
): void {
  db.prepare(
    `INSERT INTO bake_haus_saved_orders (week_start_iso, store_label, saved_at, saved_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(week_start_iso, store_label) DO UPDATE SET
       saved_at = excluded.saved_at,
       saved_by = COALESCE(excluded.saved_by, bake_haus_saved_orders.saved_by)`,
  ).run(weekStartIso, storeLabel, Date.now(), savedBy);
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
