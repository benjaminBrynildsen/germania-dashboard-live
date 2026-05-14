/**
 * Bake Haus order management — Joe/Tristan's weekly per-store food orders
 * to Chef Maggie. The dashboard auto-splits each weekly qty across the
 * Mon/Wed/Fri deliveries.
 *
 * Sauces/syrups are intentionally out of scope here — those are broken
 * down by the chef on prep days and handled outside this system.
 */
import db from './db.js';
import { STORES } from './dripos.js';

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

export const BAKE_HAUS_ITEMS: BakeHausItem[] = [
  { name: 'Bacon, Egg & Cheese',           aliases: ['bec', 'b.e.c.', 'bacon egg & cheese', 'bacon egg cheese', 'bacon, egg and cheese'], sort: 10 },
  { name: 'Jalapeno Sausage Biscuit',      aliases: ['jalapeno sausage biscuit', 'jalapeno biscuit', 'sausage biscuit'], sort: 20 },
  { name: 'Biscuit',                       aliases: ['biscuit'], sort: 25 },
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
export function splitForDeliveries(weeklyQty: number): {
  mon: number;
  wed: number;
  fri: number;
} {
  if (!Number.isFinite(weeklyQty) || weeklyQty <= 0) {
    return { mon: 0, wed: 0, fri: 0 };
  }
  const total = Math.round(weeklyQty);
  if (total <= 0) return { mon: 0, wed: 0, fri: 0 };
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
  /** Computed Mon/Wed/Fri split. */
  delivery: { mon: number; wed: number; fri: number };
}

export interface BakeHausWeekReport {
  weekStartIso: string;
  /** Per-store rows, sorted by the canonical item catalog order. */
  byStore: Record<string, BakeHausOrderRow[]>;
  /** Cross-store summary: for each delivery day (mon/wed/fri), a map of
   *  item -> per-store qty. Useful for the chef's day-of pull sheet. */
  deliverySummary: {
    mon: Record<string, Record<string, number>>;
    wed: Record<string, Record<string, number>>;
    fri: Record<string, Record<string, number>>;
  };
}

interface DbRow {
  week_start_iso: string;
  store_label: string;
  item_name: string;
  weekly_qty: number;
  notes: string | null;
}

/** Sort items by the catalog order; unknown items go to the bottom. */
function itemSortKey(name: string): number {
  const found = BAKE_HAUS_ITEMS.find((i) => i.name === name);
  return found?.sort ?? 1000;
}

export function getWeekReport(weekStartIso: string): BakeHausWeekReport {
  const rows = db.prepare(
    `SELECT week_start_iso, store_label, item_name, weekly_qty, notes
     FROM bake_haus_orders
     WHERE week_start_iso = ?`,
  ).all(weekStartIso) as DbRow[];

  const byStore: Record<string, BakeHausOrderRow[]> = {};
  for (const store of STORES) byStore[store.label] = [];

  const deliverySummary = {
    mon: {} as Record<string, Record<string, number>>,
    wed: {} as Record<string, Record<string, number>>,
    fri: {} as Record<string, Record<string, number>>,
  };

  for (const r of rows) {
    const split = splitForDeliveries(r.weekly_qty);
    const row: BakeHausOrderRow = {
      weekStartIso: r.week_start_iso,
      storeLabel: r.store_label,
      itemName: r.item_name,
      weeklyQty: r.weekly_qty,
      notes: r.notes,
      delivery: split,
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

  return { weekStartIso, byStore, deliverySummary };
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
