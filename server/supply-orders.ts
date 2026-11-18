import db from './db.js';
import { STORES } from './dripos.js';

// Supply ordering (cups, lids, straws…) from outside vendors, starting with
// Meridian Restaurant Supply. Same shape as Bake Haus — each store fills a
// weekly cart — but simpler: no delivery split, no locks. Quantities are in
// the vendor's selling unit (usually cases). Submitting emails the vendor one
// detailed order covering every store for the week.

export const VENDORS = {
  meridian: { key: 'meridian', name: 'Meridian Restaurant Supply', shortName: 'Meridian', site: 'meridianrs.com' },
} as const;
export type VendorKey = keyof typeof VENDORS;

export function isVendor(v: unknown): v is VendorKey {
  return typeof v === 'string' && v in VENDORS;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS supply_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor TEXT NOT NULL,
    name TEXT NOT NULL,
    sku TEXT,
    pack_label TEXT,                 -- e.g. "1000/case"
    order_unit TEXT NOT NULL DEFAULT 'case',
    price REAL,                      -- vendor's listed price per order unit (estimate only)
    image_url TEXT,
    product_url TEXT,
    category TEXT NOT NULL DEFAULT 'Other',
    par REAL,                        -- build-to target in order units; null = no count box
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_supply_items_vendor ON supply_items(vendor);

  -- One cart line per (vendor, week, store, item). on_hand is the shelf count
  -- the store typed for par items; counted_at only moves when the count does.
  CREATE TABLE IF NOT EXISTS supply_order_lines (
    vendor TEXT NOT NULL,
    week_start_iso TEXT NOT NULL,
    store_label TEXT NOT NULL,
    item_id INTEGER NOT NULL REFERENCES supply_items(id) ON DELETE CASCADE,
    qty REAL NOT NULL DEFAULT 0,
    on_hand REAL,
    on_hand_counted_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (vendor, week_start_iso, store_label, item_id)
  );

  CREATE TABLE IF NOT EXISTS supply_order_notes (
    vendor TEXT NOT NULL,
    week_start_iso TEXT NOT NULL,
    store_label TEXT NOT NULL,
    note TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (vendor, week_start_iso, store_label)
  );

  -- Every email that went out (tests included), with the exact lines sent so
  -- the UI can tell what changed since the last real submission.
  CREATE TABLE IF NOT EXISTS supply_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor TEXT NOT NULL,
    week_start_iso TEXT NOT NULL,
    submitted_at INTEGER NOT NULL,
    submitted_by TEXT,
    recipients TEXT NOT NULL,
    subject TEXT NOT NULL,
    is_update INTEGER NOT NULL DEFAULT 0,
    is_test INTEGER NOT NULL DEFAULT 0,
    total_units REAL NOT NULL DEFAULT 0,
    snapshot_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_supply_submissions_week ON supply_submissions(vendor, week_start_iso);

  CREATE TABLE IF NOT EXISTS supply_vendor_settings (
    vendor TEXT PRIMARY KEY,
    order_emails TEXT NOT NULL DEFAULT '',   -- comma-separated vendor recipients
    cc_emails TEXT NOT NULL DEFAULT '',      -- our own copies; also used as reply-to
    account_number TEXT NOT NULL DEFAULT '',
    delivery_note TEXT NOT NULL DEFAULT '',  -- e.g. "Deliver Thursday mornings, back door"
    store_addresses_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL DEFAULT 0
  );
`);

// Starter catalog: the disposables the COGS drink builds already use, so the
// cart matches what the stores actually go through. SKU, price, and photo
// come from pasting each item's Meridian product link in Manage items.
const SEED_FLAG = 'supply-meridian-seed-2026-11';
const SEED_ITEMS: Array<{ name: string; category: string }> = [
  { name: 'Hot Cup 12 oz', category: 'Hot cups & lids' },
  { name: 'Hot Cup 16 oz', category: 'Hot cups & lids' },
  { name: 'Hot Cup 20 oz', category: 'Hot cups & lids' },
  { name: 'Hot Cup Lid', category: 'Hot cups & lids' },
  { name: 'Cup Sleeve', category: 'Hot cups & lids' },
  { name: 'Splash Stopper', category: 'Hot cups & lids' },
  { name: 'Cold Cup 10 oz (Kids)', category: 'Cold cups & lids' },
  { name: 'Cold Cup 16 oz', category: 'Cold cups & lids' },
  { name: 'Cold Cup 24 oz', category: 'Cold cups & lids' },
  { name: 'Sip Lid', category: 'Cold cups & lids' },
  { name: 'Kids Lid', category: 'Cold cups & lids' },
  { name: 'Straws', category: 'Cold cups & lids' },
  { name: 'Napkins', category: 'Counter & to-go' },
  { name: 'Drink Carriers', category: 'Counter & to-go' },
  { name: 'Pastry Bags', category: 'Counter & to-go' },
];

(function seedOnce() {
  const done = db.prepare('SELECT 1 FROM migration_flags WHERE key = ?').get(SEED_FLAG);
  if (done) return;
  const has = db.prepare("SELECT COUNT(*) AS n FROM supply_items WHERE vendor = 'meridian'").get() as { n: number };
  if (has.n === 0) {
    const ins = db.prepare('INSERT INTO supply_items (vendor, name, category, sort) VALUES (?, ?, ?, ?)');
    db.transaction(() => SEED_ITEMS.forEach((it, i) => ins.run('meridian', it.name, it.category, (i + 1) * 10)))();
    console.log(`[supply] seeded ${SEED_ITEMS.length} Meridian starter items`);
  }
  db.prepare("INSERT INTO migration_flags (key, done_at) VALUES (?, datetime('now'))").run(SEED_FLAG);
})();

// ── items ──────────────────────────────────────────────────────────────

export interface SupplyItem {
  id: number;
  vendor: VendorKey;
  name: string;
  sku: string | null;
  packLabel: string | null;
  orderUnit: string;
  price: number | null;
  imageUrl: string | null;
  productUrl: string | null;
  category: string;
  par: number | null;
  sort: number;
  active: boolean;
}

function rowToItem(r: any): SupplyItem {
  return {
    id: r.id, vendor: r.vendor, name: r.name, sku: r.sku, packLabel: r.pack_label,
    orderUnit: r.order_unit, price: r.price, imageUrl: r.image_url, productUrl: r.product_url,
    category: r.category, par: r.par, sort: r.sort, active: r.active === 1,
  };
}

export function listItems(vendor: VendorKey, includeInactive = false): SupplyItem[] {
  const rows = db.prepare(
    `SELECT * FROM supply_items WHERE vendor = ? ${includeInactive ? '' : 'AND active = 1'} ORDER BY sort, name`,
  ).all(vendor);
  return rows.map(rowToItem);
}

export function getItem(id: number): SupplyItem | null {
  const r = db.prepare('SELECT * FROM supply_items WHERE id = ?').get(id);
  return r ? rowToItem(r) : null;
}

export type ItemInput = Partial<Omit<SupplyItem, 'id' | 'vendor'>>;

const trimOrNull = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const numOrNull = (v: unknown) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function createItem(vendor: VendorKey, input: ItemInput): SupplyItem {
  const name = trimOrNull(input.name);
  if (!name) throw new Error('Name is required');
  const maxSort = db.prepare('SELECT MAX(sort) AS m FROM supply_items WHERE vendor = ?').get(vendor) as { m: number | null };
  const r = db.prepare(`
    INSERT INTO supply_items (vendor, name, sku, pack_label, order_unit, price, image_url, product_url, category, par, sort, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    vendor, name, trimOrNull(input.sku), trimOrNull(input.packLabel), trimOrNull(input.orderUnit) ?? 'case',
    numOrNull(input.price), trimOrNull(input.imageUrl), trimOrNull(input.productUrl),
    trimOrNull(input.category) ?? 'Other', numOrNull(input.par), (maxSort.m ?? 0) + 10,
  );
  return getItem(Number(r.lastInsertRowid))!;
}

export function updateItem(id: number, input: ItemInput): SupplyItem | null {
  const cur = getItem(id);
  if (!cur) return null;
  const pick = <K extends keyof ItemInput>(k: K, conv: (v: unknown) => unknown) =>
    (k in input ? conv(input[k]) : (cur as any)[k]);
  const name = pick('name', trimOrNull) as string | null;
  if (!name) throw new Error('Name is required');
  db.prepare(`
    UPDATE supply_items SET name = ?, sku = ?, pack_label = ?, order_unit = ?, price = ?, image_url = ?,
      product_url = ?, category = ?, par = ?, sort = ?, active = ?,
      updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
    WHERE id = ?
  `).run(
    name, pick('sku', trimOrNull), pick('packLabel', trimOrNull), (pick('orderUnit', trimOrNull) as string | null) ?? 'case',
    pick('price', numOrNull), pick('imageUrl', trimOrNull), pick('productUrl', trimOrNull),
    (pick('category', trimOrNull) as string | null) ?? 'Other', pick('par', numOrNull),
    'sort' in input ? Number(input.sort) || 0 : cur.sort,
    ('active' in input ? !!input.active : cur.active) ? 1 : 0,
    id,
  );
  return getItem(id);
}

// ── carts ──────────────────────────────────────────────────────────────

export interface CartLine {
  itemId: number;
  qty: number;
  onHand: number | null;
  onHandCountedAt: number | null;
}

export interface WeekCart {
  week: string;
  stores: string[];
  lines: Record<string, CartLine[]>;   // by store
  notes: Record<string, string>;       // by store
  prevWeek: Record<string, Record<number, number>>; // store → itemId → qty last week
  lastSubmission: SubmissionSummary | null;
  /** True when the cart differs from what the last real (non-test) email said. */
  changedSinceSubmit: boolean;
}

export function shiftWeekIso(week: string, weeks: number): string {
  const d = new Date(`${week}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function linesFor(vendor: VendorKey, week: string): Record<string, CartLine[]> {
  const out: Record<string, CartLine[]> = {};
  for (const s of STORES) out[s.label] = [];
  const rows = db.prepare(`
    SELECT l.store_label, l.item_id, l.qty, l.on_hand, l.on_hand_counted_at
    FROM supply_order_lines l JOIN supply_items i ON i.id = l.item_id
    WHERE l.vendor = ? AND l.week_start_iso = ?
  `).all(vendor, week) as any[];
  for (const r of rows) {
    (out[r.store_label] ??= []).push({ itemId: r.item_id, qty: r.qty, onHand: r.on_hand, onHandCountedAt: r.on_hand_counted_at });
  }
  return out;
}

/** The order as it would go out: positive quantities only, by store. */
function orderSnapshot(vendor: VendorKey, week: string): Record<string, Record<number, number>> {
  const snap: Record<string, Record<number, number>> = {};
  for (const [store, lines] of Object.entries(linesFor(vendor, week))) {
    for (const l of lines) if (l.qty > 0) (snap[store] ??= {})[l.itemId] = l.qty;
  }
  return snap;
}

function snapshotsEqual(a: Record<string, Record<number, number>>, b: Record<string, Record<number, number>>): boolean {
  const flat = (s: Record<string, Record<number, number>>) =>
    Object.entries(s).flatMap(([st, m]) => Object.entries(m).map(([id, q]) => `${st}:${id}:${q}`)).sort().join('|');
  return flat(a) === flat(b);
}

export function getWeekCart(vendor: VendorKey, week: string): WeekCart {
  const lines = linesFor(vendor, week);
  const notes: Record<string, string> = {};
  for (const r of db.prepare('SELECT store_label, note FROM supply_order_notes WHERE vendor = ? AND week_start_iso = ?').all(vendor, week) as any[]) {
    notes[r.store_label] = r.note;
  }
  const prevWeek: Record<string, Record<number, number>> = {};
  for (const [store, ls] of Object.entries(linesFor(vendor, shiftWeekIso(week, -1)))) {
    prevWeek[store] = {};
    for (const l of ls) if (l.qty > 0) prevWeek[store][l.itemId] = l.qty;
  }
  const last = lastRealSubmission(vendor, week);
  const changedSinceSubmit = last
    ? !snapshotsEqual(JSON.parse(last.snapshot_json).lines ?? {}, orderSnapshot(vendor, week))
    : false;
  return {
    week, stores: STORES.map((s) => s.label), lines, notes, prevWeek,
    lastSubmission: last ? toSummary(last) : null,
    changedSinceSubmit,
  };
}

export function setLine(args: {
  vendor: VendorKey; week: string; store: string; itemId: number; qty: number;
  /** undefined = keep the stored count; null = clear; number = set. */
  onHand?: number | null;
}): void {
  const has = args.onHand !== undefined ? 1 : 0;
  const now = Date.now();
  db.prepare(`
    INSERT INTO supply_order_lines (vendor, week_start_iso, store_label, item_id, qty, on_hand, on_hand_counted_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(vendor, week_start_iso, store_label, item_id) DO UPDATE SET
      qty = excluded.qty,
      on_hand = CASE WHEN ? = 1 THEN excluded.on_hand ELSE supply_order_lines.on_hand END,
      on_hand_counted_at = CASE WHEN ? = 1 THEN excluded.on_hand_counted_at ELSE supply_order_lines.on_hand_counted_at END,
      updated_at = excluded.updated_at
  `).run(args.vendor, args.week, args.store, args.itemId, args.qty, args.onHand ?? null,
    args.onHand != null ? now : null, now, has, has);
}

export function setNote(vendor: VendorKey, week: string, store: string, note: string): void {
  const t = note.trim();
  if (!t) {
    db.prepare('DELETE FROM supply_order_notes WHERE vendor = ? AND week_start_iso = ? AND store_label = ?').run(vendor, week, store);
    return;
  }
  db.prepare(`
    INSERT INTO supply_order_notes (vendor, week_start_iso, store_label, note, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(vendor, week_start_iso, store_label) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at
  `).run(vendor, week, store, t.slice(0, 2000), Date.now());
}

// ── settings ───────────────────────────────────────────────────────────

export interface VendorSettings {
  orderEmails: string;
  ccEmails: string;
  accountNumber: string;
  deliveryNote: string;
  storeAddresses: Record<string, string>;
}

export function getSettings(vendor: VendorKey): VendorSettings {
  const r = db.prepare('SELECT * FROM supply_vendor_settings WHERE vendor = ?').get(vendor) as any;
  let storeAddresses: Record<string, string> = {};
  try { storeAddresses = JSON.parse(r?.store_addresses_json ?? '{}'); } catch { /* keep empty */ }
  return {
    orderEmails: r?.order_emails ?? '',
    ccEmails: r?.cc_emails ?? '',
    accountNumber: r?.account_number ?? '',
    deliveryNote: r?.delivery_note ?? '',
    storeAddresses,
  };
}

export function parseEmailList(s: string): { ok: string[]; bad: string[] } {
  const parts = s.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return { ok: parts.filter((p) => re.test(p)), bad: parts.filter((p) => !re.test(p)) };
}

export function saveSettings(vendor: VendorKey, s: Partial<VendorSettings>): VendorSettings {
  const cur = getSettings(vendor);
  const next: VendorSettings = {
    orderEmails: s.orderEmails ?? cur.orderEmails,
    ccEmails: s.ccEmails ?? cur.ccEmails,
    accountNumber: s.accountNumber ?? cur.accountNumber,
    deliveryNote: s.deliveryNote ?? cur.deliveryNote,
    storeAddresses: s.storeAddresses ?? cur.storeAddresses,
  };
  for (const [label, field] of [['Order emails', next.orderEmails], ['CC emails', next.ccEmails]] as const) {
    const { bad } = parseEmailList(field);
    if (bad.length) throw new Error(`${label}: "${bad[0]}" isn't a valid email address`);
  }
  db.prepare(`
    INSERT INTO supply_vendor_settings (vendor, order_emails, cc_emails, account_number, delivery_note, store_addresses_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(vendor) DO UPDATE SET order_emails = excluded.order_emails, cc_emails = excluded.cc_emails,
      account_number = excluded.account_number, delivery_note = excluded.delivery_note,
      store_addresses_json = excluded.store_addresses_json, updated_at = excluded.updated_at
  `).run(vendor, next.orderEmails.trim(), next.ccEmails.trim(), next.accountNumber.trim(),
    next.deliveryNote.trim(), JSON.stringify(next.storeAddresses), Date.now());
  return getSettings(vendor);
}

// ── submissions & the order email ──────────────────────────────────────

export interface SubmissionSummary {
  id: number;
  week: string;
  submittedAt: number;
  submittedBy: string | null;
  recipients: string;
  subject: string;
  isUpdate: boolean;
  isTest: boolean;
  totalUnits: number;
}

function toSummary(r: any): SubmissionSummary {
  return {
    id: r.id, week: r.week_start_iso, submittedAt: r.submitted_at, submittedBy: r.submitted_by,
    recipients: r.recipients, subject: r.subject, isUpdate: r.is_update === 1, isTest: r.is_test === 1,
    totalUnits: r.total_units,
  };
}

function lastRealSubmission(vendor: VendorKey, week: string): any | null {
  return db.prepare(`
    SELECT * FROM supply_submissions WHERE vendor = ? AND week_start_iso = ? AND is_test = 0
    ORDER BY submitted_at DESC LIMIT 1
  `).get(vendor, week) ?? null;
}

export function listSubmissions(vendor: VendorKey, limit = 50): SubmissionSummary[] {
  return (db.prepare('SELECT * FROM supply_submissions WHERE vendor = ? ORDER BY submitted_at DESC LIMIT ?')
    .all(vendor, limit) as any[]).map(toSummary);
}

export function getSubmissionHtml(id: number): string | null {
  const r = db.prepare('SELECT snapshot_json FROM supply_submissions WHERE id = ?').get(id) as any;
  if (!r) return null;
  try { return JSON.parse(r.snapshot_json).html ?? null; } catch { return null; }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

function unitWord(unit: string, qty: number): string {
  if (qty === 1) return unit;
  return unit.endsWith('s') ? unit : unit === 'box' ? 'boxes' : `${unit}s`;
}

export interface BuiltOrderEmail {
  subject: string;
  html: string;
  text: string;
  totalUnits: number;
  storeCount: number;
  snapshot: Record<string, Record<number, number>>;
}

/** Build the vendor email from the live carts. The same builder feeds the
 *  in-app preview, so what the manager reviews is exactly what gets sent. */
export function buildOrderEmail(vendor: VendorKey, week: string, opts: { isUpdate: boolean; isTest: boolean; submittedBy: string | null }): BuiltOrderEmail {
  const v = VENDORS[vendor];
  const settings = getSettings(vendor);
  const items = new Map(listItems(vendor, true).map((i) => [i.id, i]));
  const snapshot = orderSnapshot(vendor, week);
  const notes = getWeekCart(vendor, week).notes;

  const weekDate = new Date(`${week}T12:00:00Z`);
  const weekLabel = weekDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const prefix = opts.isTest ? '[TEST] ' : '';
  const subject = `${prefix}${opts.isUpdate ? 'UPDATED order' : 'Order'} — Germania Brew Haus, week of ${weekLabel}`;

  const storesWithLines = STORES.filter((s) => snapshot[s.label] && Object.keys(snapshot[s.label]).length > 0);
  const sortedLines = (store: string) => Object.entries(snapshot[store] ?? {})
    .map(([id, qty]) => ({ item: items.get(Number(id))!, qty }))
    .filter((l) => l.item)
    .sort((a, b) => a.item.sort - b.item.sort || a.item.name.localeCompare(b.item.name));

  // Totals across stores, so the warehouse can pull in one pass.
  const totals = new Map<number, number>();
  for (const s of storesWithLines) for (const l of sortedLines(s.label)) totals.set(l.item.id, (totals.get(l.item.id) ?? 0) + l.qty);
  const totalUnits = [...totals.values()].reduce((a, b) => a + b, 0);

  const th = 'padding:8px 10px;text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6b6b6b;border-bottom:2px solid #1a1a1a;';
  const td = 'padding:9px 10px;border-bottom:1px solid #e8e4dc;font-size:14px;vertical-align:top;';
  const lineTable = (lines: Array<{ item: SupplyItem; qty: number }>) => `
    <table role="presentation" style="border-collapse:collapse;width:100%;">
      <thead><tr>
        <th style="${th}">Item</th><th style="${th}">Item #</th><th style="${th}">Pack</th>
        <th style="${th}text-align:right;">Qty</th>
      </tr></thead>
      <tbody>${lines.map((l) => `
        <tr>
          <td style="${td}font-weight:600;">${esc(l.item.name)}</td>
          <td style="${td}font-family:Menlo,Consolas,monospace;font-size:13px;">${esc(l.item.sku ?? '—')}</td>
          <td style="${td}color:#555;">${esc(l.item.packLabel ?? '')}</td>
          <td style="${td}text-align:right;font-weight:700;white-space:nowrap;">${fmtQty(l.qty)} ${esc(unitWord(l.item.orderUnit, l.qty))}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  const storeLabelFull = (label: string) => {
    const st = STORES.find((s) => s.label === label);
    return `${label}${st ? ` — ${st.city}` : ''}`;
  };

  const storeSections = storesWithLines.map((s) => {
    const addr = settings.storeAddresses[s.label]?.trim();
    const note = notes[s.label]?.trim();
    return `
      <div style="margin:0 0 26px;">
        <div style="background:#1a1a1a;color:#fff;padding:10px 14px;border-radius:6px 6px 0 0;">
          <div style="font-size:16px;font-weight:700;">Deliver to: ${esc(storeLabelFull(s.label))}</div>
          ${addr ? `<div style="font-size:13px;color:#d6d3cd;margin-top:2px;white-space:pre-line;">${esc(addr)}</div>` : ''}
        </div>
        ${lineTable(sortedLines(s.label))}
        ${note ? `<div style="margin-top:8px;padding:10px 12px;background:#faf6ec;border-left:3px solid #c9a227;font-size:13px;color:#4a4a4a;"><strong>Note:</strong> ${esc(note)}</div>` : ''}
      </div>`;
  }).join('');

  const totalRows = [...totals.entries()]
    .map(([id, qty]) => ({ item: items.get(id)!, qty }))
    .sort((a, b) => a.item.sort - b.item.sort || a.item.name.localeCompare(b.item.name));

  const metaRows = [
    ['Week of', weekLabel],
    settings.accountNumber ? ['Account #', settings.accountNumber] : null,
    ['Locations', storesWithLines.map((s) => storeLabelFull(s.label)).join(', ') || '—'],
    settings.deliveryNote ? ['Delivery', settings.deliveryNote] : null,
    opts.submittedBy ? ['Placed by', opts.submittedBy] : null,
  ].filter(Boolean) as string[][];

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f1ea;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
    ${opts.isTest ? `<div style="margin:0 0 14px;padding:10px 14px;background:#fff4d6;border:1px solid #e6c870;border-radius:6px;font-size:13px;color:#7a5b00;"><strong>Test send.</strong> This preview went only to you, not to ${esc(v.shortName)}.</div>` : ''}
    <div style="background:#fff;border:1px solid #e8e4dc;border-radius:10px;padding:26px 26px 18px;">
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8a8478;">Germania Brew Haus · Supply order</div>
      <h1 style="margin:6px 0 4px;font-size:24px;line-height:1.2;">${opts.isUpdate ? 'Updated order' : 'Weekly order'} for ${esc(v.name)}</h1>
      ${opts.isUpdate ? `<p style="margin:6px 0 0;font-size:14px;color:#9a3412;font-weight:600;">This replaces our earlier order for this week — please use these quantities.</p>` : ''}
      <table role="presentation" style="border-collapse:collapse;margin:16px 0 22px;font-size:14px;">
        ${metaRows.map(([k, val]) => `<tr><td style="padding:3px 16px 3px 0;color:#8a8478;white-space:nowrap;">${esc(k)}</td><td style="padding:3px 0;font-weight:600;">${esc(val)}</td></tr>`).join('')}
      </table>
      ${storesWithLines.length === 0 ? '<p style="color:#999;">No items on this order.</p>' : storeSections}
      ${storesWithLines.length > 1 ? `
        <h2 style="margin:8px 0 8px;font-size:15px;letter-spacing:.04em;text-transform:uppercase;">Totals — all locations</h2>
        ${lineTable(totalRows)}` : ''}
      <p style="margin:22px 0 0;font-size:14px;color:#333;">Thank you! Please reply to this email to confirm the order or let us know about substitutions or backorders.</p>
    </div>
    <p style="margin:12px 4px 0;font-size:11px;color:#9a948a;">Sent from the Germania Brew Haus ordering dashboard.</p>
  </div></body></html>`;

  const text = [
    `${opts.isUpdate ? 'UPDATED ORDER' : 'ORDER'} — Germania Brew Haus`,
    ...metaRows.map(([k, val]) => `${k}: ${val}`),
    '',
    ...storesWithLines.flatMap((s) => [
      `DELIVER TO: ${storeLabelFull(s.label)}`,
      ...(settings.storeAddresses[s.label]?.trim() ? [settings.storeAddresses[s.label].trim()] : []),
      ...sortedLines(s.label).map((l) => `  ${fmtQty(l.qty)} ${unitWord(l.item.orderUnit, l.qty)}  ${l.item.name}${l.item.sku ? `  (#${l.item.sku})` : ''}${l.item.packLabel ? `  [${l.item.packLabel}]` : ''}`),
      ...(notes[s.label]?.trim() ? [`  Note: ${notes[s.label].trim()}`] : []),
      '',
    ]),
    'Please reply to confirm, or to flag substitutions or backorders. Thank you!',
  ].join('\n');

  return { subject, html, text, totalUnits, storeCount: storesWithLines.length, snapshot };
}

export function isUpdateSend(vendor: VendorKey, week: string): boolean {
  return !!lastRealSubmission(vendor, week);
}

export function recordSubmission(vendor: VendorKey, week: string, built: BuiltOrderEmail, opts: {
  submittedBy: string | null; recipients: string[]; isUpdate: boolean; isTest: boolean;
}): SubmissionSummary {
  const r = db.prepare(`
    INSERT INTO supply_submissions (vendor, week_start_iso, submitted_at, submitted_by, recipients, subject, is_update, is_test, total_units, snapshot_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(vendor, week, Date.now(), opts.submittedBy, opts.recipients.join(', '), built.subject,
    opts.isUpdate ? 1 : 0, opts.isTest ? 1 : 0, built.totalUnits,
    JSON.stringify({ lines: built.snapshot, html: built.html }));
  return toSummary(db.prepare('SELECT * FROM supply_submissions WHERE id = ?').get(r.lastInsertRowid));
}

// ── import an item from its vendor product page ────────────────────────

export interface ImportedProduct {
  name: string | null;
  sku: string | null;
  price: number | null;
  imageUrl: string | null;
  packLabel: string | null;
  productUrl: string;
}

const decodeEntities = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function metaContent(html: string, attr: 'property' | 'name' | 'itemprop', key: string): string | null {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const a = new RegExp(`<meta[^>]+${attr}=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html);
  if (a) return decodeEntities(a[1]).trim() || null;
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${k}["']`, 'i').exec(html);
  return b ? decodeEntities(b[1]).trim() || null : null;
}

/** Pull name / SKU / price / photo out of a product page. Tries Open Graph
 *  and schema.org first (present on most storefronts, including Magento —
 *  which Meridian's site is), then Magento's own markup. Pure function so
 *  it can be tested without the network. */
export function parseProductPage(html: string, pageUrl: string): ImportedProduct {
  let name = metaContent(html, 'property', 'og:title');
  if (!name) {
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    if (h1) name = decodeEntities(h1[1].replace(/<[^>]+>/g, '')).trim() || null;
  }
  if (!name) {
    const t = /<title>([\s\S]*?)<\/title>/i.exec(html);
    if (t) name = decodeEntities(t[1]).split('|')[0].trim() || null;
  }

  let imageUrl = metaContent(html, 'property', 'og:image') ?? metaContent(html, 'itemprop', 'image');
  if (!imageUrl) {
    const m = /<img[^>]+src=["']([^"']*\/media\/catalog\/product\/[^"']+)["']/i.exec(html);
    if (m) imageUrl = m[1];
  }
  if (imageUrl) {
    try { imageUrl = new URL(decodeEntities(imageUrl), pageUrl).toString(); } catch { imageUrl = null; }
  }

  let price: number | null = null;
  const priceStr = metaContent(html, 'property', 'product:price:amount')
    ?? metaContent(html, 'itemprop', 'price')
    ?? (/data-price-amount=["']([\d.]+)["']/i.exec(html)?.[1] ?? null)
    ?? (/"price"\s*:\s*"?([\d.]+)"?/i.exec(html)?.[1] ?? null);
  if (priceStr) {
    const n = Number(priceStr.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n) && n > 0) price = n;
  }

  let sku: string | null = null;
  const skuMatch = /itemprop=["']sku["'][^>]*>([^<]+)</i.exec(html)
    ?? /<meta[^>]+itemprop=["']sku["'][^>]*content=["']([^"']+)["']/i.exec(html)
    ?? /"sku"\s*:\s*"([^"]+)"/i.exec(html)
    ?? /data-product-sku=["']([^"']+)["']/i.exec(html);
  if (skuMatch) sku = decodeEntities(skuMatch[1]).trim() || null;

  // Case count from the listing title, e.g. "16OZ WHITE PAPER HOT CUP (1000)".
  let packLabel: string | null = null;
  const pack = name ? /\((\d[\d,]*)\s*(?:ct|count|pk|\/cs|\/case)?\s*\)\s*$/i.exec(name) : null;
  if (pack) packLabel = `${pack[1].replace(/,/g, '')}/case`;

  return { name, sku, price, imageUrl, packLabel, productUrl: pageUrl };
}

const ALLOWED_IMPORT_HOSTS: Record<VendorKey, string[]> = {
  meridian: ['meridianrs.com', 'www.meridianrs.com'],
};

export async function importProduct(vendor: VendorKey, rawUrl: string): Promise<ImportedProduct> {
  let url: URL;
  try { url = new URL(rawUrl.trim()); } catch { throw new Error('That doesn\'t look like a link — paste the full product page address.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only web links can be imported.');
  // Only the vendor's own site: the server fetches this URL, so an open
  // fetcher would let anyone make it request arbitrary hosts.
  if (!ALLOWED_IMPORT_HOSTS[vendor].includes(url.hostname.toLowerCase())) {
    throw new Error(`Paste a link from ${VENDORS[vendor].site}.`);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GermaniaDashboard/1.0)', Accept: 'text/html' },
    });
    if (!res.ok) throw new Error(`${VENDORS[vendor].shortName}'s site answered ${res.status} for that link.`);
    const finalHost = new URL(res.url || url.toString()).hostname.toLowerCase();
    if (!ALLOWED_IMPORT_HOSTS[vendor].includes(finalHost)) throw new Error('That link redirected off the vendor\'s site.');
    const html = (await res.text()).slice(0, 3_000_000);
    const parsed = parseProductPage(html, res.url || url.toString());
    if (!parsed.name && !parsed.imageUrl) throw new Error('Couldn\'t find a product on that page — is it a single product\'s page?');
    return parsed;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`${VENDORS[vendor].shortName}'s site took too long to answer.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
