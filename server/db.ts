import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { seedSopPresets } from './sop-presets-seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In prod the SQLite file lives on a Render persistent disk (DB_PATH=/var/data/germania.db).
// Locally it sits in the repo root for convenience.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'germania.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Patron schema migration: the v0 schema (CSV-upload era) used a
// different shape for `patrons`. The new schema below is keyed on
// dripos_id and has date_created_ms/last_seen_ms columns; if the v0
// shape exists, drop it BEFORE the main exec so the IF NOT EXISTS
// below sees a clean slate and the indexes can attach to the new
// columns. Patron data is sourced from Dripos so a wipe is safe.
{
  const cols = db.prepare("PRAGMA table_info(patrons)").all() as Array<{ name: string }>;
  const hasV0Column = cols.some((c) => c.name === 'first_seen_iso');
  if (hasV0Column) {
    console.log('[migration] dropping v0 patrons table for Dripos-shaped schema');
    db.exec('DROP TABLE patrons');
  }
}

// Menu Team SOP packet metadata — adds the cover/category fields used
// to render seasonal launch packets. Pre-dates only the v1 SOP schema;
// these are no-ops on a fresh DB because CREATE TABLE IF NOT EXISTS
// below will create the columns from scratch.
{
  const tbl = db.prepare("PRAGMA table_info(sops)").all() as Array<{ name: string }>;
  if (tbl.length > 0) {
    const cols = new Set(tbl.map((c) => c.name));
    const adds: Array<[string, string]> = [
      ['category', 'TEXT'],
      ['availability', 'TEXT'],
      ['sop_required', 'INTEGER NOT NULL DEFAULT 1'],
      ['subtitle', 'TEXT'],
      ['availability_note', 'TEXT'],
      // 'drink' (default) or 'recipe'. Recipes are non-drink SOPs like
      // cold foam batches or syrup procedures — no temperature variants,
      // size columns become yields.
      ['kind', "TEXT NOT NULL DEFAULT 'drink'"],
    ];
    for (const [name, type] of adds) {
      if (!cols.has(name)) {
        console.log(`[migration] adding ${name} to sops`);
        db.exec(`ALTER TABLE sops ADD COLUMN ${name} ${type}`);
      }
    }
  }
}
// sop_rows.sync_locked — per-row opt-out from the cross-temperature
// sync. When 1, edits to this row's name/modifier in another variant
// don't propagate into this one (and vice versa from this row).
{
  const tbl = db.prepare("PRAGMA table_info(sop_rows)").all() as Array<{ name: string }>;
  if (tbl.length > 0 && !tbl.some((c) => c.name === 'sync_locked')) {
    console.log('[migration] adding sync_locked to sop_rows');
    db.exec('ALTER TABLE sop_rows ADD COLUMN sync_locked INTEGER NOT NULL DEFAULT 0');
  }
}

// bake_haus_orders.mon_locked_qty migration — adds the Mon-delivery
// snapshot column to existing tables that pre-date the lock feature.
// CREATE TABLE IF NOT EXISTS below won't backfill columns on its own.
{
  const tbl = db.prepare("PRAGMA table_info(bake_haus_orders)").all() as Array<{ name: string }>;
  if (tbl.length > 0 && !tbl.some((c) => c.name === 'mon_locked_qty')) {
    console.log('[migration] adding mon_locked_qty to bake_haus_orders');
    db.exec('ALTER TABLE bake_haus_orders ADD COLUMN mon_locked_qty REAL');
  }
  // Week-wide lock — extends the Mon-only freeze to Wed + Fri so Chef
  // Maggie has stable production targets for every delivery day. NULL
  // on each column means that day is not locked; splitForDeliveries
  // recomputes those days normally.
  if (tbl.length > 0 && !tbl.some((c) => c.name === 'wed_locked_qty')) {
    console.log('[migration] adding wed_locked_qty to bake_haus_orders');
    db.exec('ALTER TABLE bake_haus_orders ADD COLUMN wed_locked_qty REAL');
  }
  if (tbl.length > 0 && !tbl.some((c) => c.name === 'fri_locked_qty')) {
    console.log('[migration] adding fri_locked_qty to bake_haus_orders');
    db.exec('ALTER TABLE bake_haus_orders ADD COLUMN fri_locked_qty REAL');
  }
}
// bake_haus_week_locks.lock_source migration — distinguishes manual
// locks (Maggie/admin pressed "Lock this week") from auto-locks fired
// by the Monday 11:59pm cron. Used for diagnostic / audit display.
{
  const tbl = db.prepare("PRAGMA table_info(bake_haus_week_locks)").all() as Array<{ name: string }>;
  if (tbl.length > 0 && !tbl.some((c) => c.name === 'lock_source')) {
    console.log("[migration] adding lock_source to bake_haus_week_locks");
    db.exec("ALTER TABLE bake_haus_week_locks ADD COLUMN lock_source TEXT NOT NULL DEFAULT 'manual'");
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    picture TEXT,
    role TEXT DEFAULT 'staff' CHECK(role IN ('admin', 'manager', 'menu_team', 'staff')),
    google_access_token TEXT,
    google_refresh_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS launches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    season TEXT NOT NULL,
    year INTEGER NOT NULL,
    launch_date DATE,
    status TEXT DEFAULT 'idea_collection' CHECK(status IN (
      'idea_collection', 'voting', 'finalization', 'recipe_development',
      'pre_launch', 'launch', 'completed'
    )),
    idea_form_id TEXT,
    voting_form_id TEXT,
    drive_folder_id TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS drinks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    launch_id INTEGER REFERENCES launches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    submitted_by TEXT,
    assigned_to INTEGER REFERENCES users(id),
    status TEXT DEFAULT 'idea' CHECK(status IN (
      'idea', 'voting', 'approved', 'in_development', 'finalized'
    )),
    votes_yes INTEGER DEFAULT 0,
    votes_no INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS recipe_iterations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drink_id INTEGER REFERENCES drinks(id) ON DELETE CASCADE,
    iteration_number INTEGER NOT NULL,
    date DATE NOT NULL,
    notes TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS launch_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    launch_id INTEGER REFERENCES launches(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN (
      'photo_shoot', 'social_media', 'eventbrite', 'menu_tasting',
      'sops', 'dripos_buttons', 'menu_panels', 'sauces', 'delivery', 'other'
    )),
    due_date DATE,
    assigned_to INTEGER REFERENCES users(id),
    completed INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS quiz_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    launch_id INTEGER REFERENCES launches(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    options TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS quiz_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    launch_id INTEGER REFERENCES launches(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    google_place_id TEXT,
    google_maps_url TEXT,
    google_rating REAL DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    weekly_revenue REAL DEFAULT 0,
    revenue_change REAL DEFAULT 0,
    avg_ticket_time REAL,
    status TEXT DEFAULT 'open',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS google_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id TEXT NOT NULL REFERENCES locations(id),
    google_review_id TEXT,
    author TEXT NOT NULL,
    author_photo TEXT,
    rating INTEGER NOT NULL,
    text TEXT,
    date TEXT NOT NULL,
    relative_date TEXT,
    helpful INTEGER DEFAULT 0,
    replied INTEGER DEFAULT 0,
    reply_text TEXT,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(location_id, google_review_id)
  );

  CREATE TABLE IF NOT EXISTS cog_recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    season TEXT,
    category TEXT,
    total_yield REAL,
    yield_unit TEXT,
    labor_time_hrs REAL,
    labor_quantity INTEGER,
    labor_cook_rate REAL,
    labor_cost_per_unit REAL,
    sheet_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cog_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER REFERENCES cog_recipes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    ap_pack_cost REAL,
    pack_size REAL,
    pack_unit TEXT,
    unit_conversion REAL,
    ap_price REAL,
    ap_price_unit TEXT,
    yield_percent REAL,
    ep_price REAL,
    ep_price_unit TEXT,
    quantity_used REAL,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS cog_ingredient_master (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    ap_pack_cost REAL,
    pack_size REAL,
    pack_unit TEXT,
    supplier TEXT,
    last_updated TEXT DEFAULT (datetime('now'))
  );

  -- Single-row settings table for Dripos integration. The id is always 1;
  -- session_token is the value to send in the authentication header on
  -- api.dripos.com calls. Lasts until the user re-auths via /login flow.
  CREATE TABLE IF NOT EXISTS dripos_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    session_token TEXT,
    last_login_phone TEXT,
    last_login_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO dripos_settings (id) VALUES (1);

  -- Manager-entered preferences for capacity planning. Keyed by the
  -- Dripos EMPLOYEE_ID so we don't worry about employee renames. NULL
  -- preferred_hours = "not set yet" (treated as 0 in gap calcs but
  -- surfaced in the UI as missing).
  CREATE TABLE IF NOT EXISTS employee_preferences (
    employee_id INTEGER PRIMARY KEY,
    preferred_hours_per_week REAL,
    notes TEXT,
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
  );

  -- Bake Haus weekly orders. One row per (week × store × item). The
  -- week_start_iso is the Monday of the week (YYYY-MM-DD). Weekly qty
  -- is what Joe/Tristan are ordering from Chef Maggie; the Mon/Wed/Fri
  -- split is computed on the fly (2/7-2/7-3/7 by default) rather than
  -- persisted, so changes to the split formula don't require migration.
  CREATE TABLE IF NOT EXISTS bake_haus_orders (
    week_start_iso TEXT NOT NULL,
    store_label TEXT NOT NULL,
    item_name TEXT NOT NULL,
    weekly_qty REAL NOT NULL,
    notes TEXT,
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
    -- Per-delivery-day snapshots captured at lock time. NULL = that
    -- day is not locked; splitForDeliveries recomputes it normally.
    -- When set, the day's qty is frozen and the remainder splits
    -- across whatever days remain unlocked so post-lock qty edits
    -- don't retroactively change what already left the kitchen.
    mon_locked_qty REAL,
    wed_locked_qty REAL,
    fri_locked_qty REAL,
    PRIMARY KEY (week_start_iso, store_label, item_name)
  );

  -- "This store's order for this week is finalized / sent to chef."
  -- Joe/Tristan auto-save edits on blur, but explicit Save adds a row
  -- here so the Saved Orders tab has a list of submitted (week, store)
  -- entries. Re-saving the same (week, store) just bumps the timestamp.
  CREATE TABLE IF NOT EXISTS bake_haus_saved_orders (
    week_start_iso TEXT NOT NULL,
    store_label TEXT NOT NULL,
    saved_at INTEGER NOT NULL,
    saved_by TEXT,
    PRIMARY KEY (week_start_iso, store_label)
  );

  -- Marks a week as "deliveries are locked for the week". When a row
  -- exists for a given week_start_iso, mon/wed/fri qtys per order are
  -- frozen to their *_locked_qty snapshots and the save endpoint
  -- rejects writes from users not on the unlock allowlist. The column
  -- name mon_locked_at predates the week-wide lock and is preserved
  -- to avoid touching every consumer; semantically it is now "week
  -- locked at" (the timestamp the snapshot was captured).
  CREATE TABLE IF NOT EXISTS bake_haus_week_locks (
    week_start_iso TEXT NOT NULL,
    mon_locked_at INTEGER NOT NULL,
    locked_by TEXT,
    -- 'manual' = pressed Lock; 'auto' = Mon 23:59 CT cron fired
    lock_source TEXT NOT NULL DEFAULT 'manual',
    PRIMARY KEY (week_start_iso)
  );

  -- Editable syrup/sauce catalog. Unlike the hardcoded food list in
  -- BAKE_HAUS_ITEMS, syrups rotate seasonally — Chef Maggie can
  -- add/remove/rename and toggle active without a deploy. Each entry
  -- is linked to a Dripos product ID for inventory tracking, but uses
  -- a separate display_name on the ordering UI (Dripos's "BOTTLE-
  -- Haus Vanilla" → "Haus Vanilla" on the order page).
  CREATE TABLE IF NOT EXISTS bake_haus_syrups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT NOT NULL,
    dripos_product_id INTEGER NOT NULL,
    dripos_product_name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 100,
    -- Most syrups skip Monday (made Tue/Thu, delivered Wed/Fri only).
    -- Haus Vanilla is the exception — set this to 1 for items that
    -- should follow the food 2/7-2/7-3/7 split.
    include_monday INTEGER NOT NULL DEFAULT 0,
    -- Soft delete / seasonal toggle. Inactive items hide from the
    -- ordering UI but stay in the DB so historical orders still
    -- resolve their display name.
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_bake_haus_syrups_active ON bake_haus_syrups(active);

  -- Patron snapshots from Dripos's /patrons/dumb/v2 endpoint. Pulled
  -- automatically on boot + every 6h (refresh button also available in
  -- the UI). dripos_id is the upstream PK; the table is replaced
  -- wholesale on every sync — patron-level upstream changes (name/email
  -- edits, archives) follow the latest Dripos state.
  CREATE TABLE IF NOT EXISTS patrons (
    dripos_id INTEGER PRIMARY KEY,
    unique_id TEXT,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    location_id INTEGER,                 -- first-seen-at store
    date_created_ms INTEGER,             -- ≈ first seen
    last_seen_ms INTEGER,
    lifetime INTEGER NOT NULL DEFAULT 0, -- total visits
    tickets INTEGER NOT NULL DEFAULT 0,  -- total tickets (incl. deleted)
    total_spend_cents INTEGER,
    total_tips_cents INTEGER,
    average_ticket_cents INTEGER,
    average_tip_cents INTEGER,
    points REAL,
    text_subscribed INTEGER DEFAULT 0,
    email_subscribed INTEGER DEFAULT 0,
    birth_month INTEGER,
    birth_day INTEGER,
    birth_year INTEGER,
    date_archived_ms INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_patrons_date_created ON patrons (date_created_ms);
  CREATE INDEX IF NOT EXISTS idx_patrons_location ON patrons (location_id);
  CREATE INDEX IF NOT EXISTS idx_patrons_lifetime ON patrons (lifetime);
  CREATE INDEX IF NOT EXISTS idx_patrons_spend ON patrons (total_spend_cents);
  CREATE INDEX IF NOT EXISTS idx_patrons_last_seen ON patrons (last_seen_ms);

  CREATE TABLE IF NOT EXISTS patrons_sync_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_synced_at INTEGER,
    last_sync_count INTEGER,
    last_sync_total_in_dripos INTEGER,
    last_sync_status TEXT,
    last_sync_error TEXT
  );
  INSERT OR IGNORE INTO patrons_sync_meta (id) VALUES (1);

  -- Migration: the v0 schema used a different patrons shape + a
  -- patrons_upload_meta table for CSV-upload era. Drop both — the
  -- auto-sync replaces them. New rows below will recreate clean.
  DROP TABLE IF EXISTS patrons_upload_meta;

  -- Predecessor table that briefly tracked save state per-week. Dropped
  -- in favor of bake_haus_saved_orders (per-week-per-store). Safe to
  -- drop because the feature was only live for a few hours and never
  -- had production rows worth migrating.
  DROP TABLE IF EXISTS bake_haus_saved_weeks;

  -- Snapshot of the delivery schedule (per-day, per-store, per-item
  -- map) taken when all 4 stores have saved their weekly orders. This
  -- captures the schedule as-of-that-moment so even if someone edits
  -- a qty later, Maggie can still reference the "as ordered" version.
  -- Auto-created in markOrderSaved when the 4th store saves; surfaced
  -- in the Saved Orders tab with a "View / Print" action.
  CREATE TABLE IF NOT EXISTS bake_haus_delivery_snapshots (
    week_start_iso TEXT PRIMARY KEY,
    payload TEXT NOT NULL,                   -- JSON: deliverySummary + week totals + stores list
    week_total INTEGER NOT NULL,             -- denormalized for the list view
    saved_at INTEGER NOT NULL,
    saved_by TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_bake_haus_delivery_snapshots_date ON bake_haus_delivery_snapshots(saved_at);

  -- Per-ticket transaction data from Dripos. Powers the pastry/drink
  -- pairing analysis: we need to know which items appeared on the same
  -- customer transaction. /report/productsales aggregates across
  -- transactions and gives us totals only — useless for co-occurrence.
  --
  -- Each ticket is one customer order; each ticket_items row is one
  -- line item on that order. unique_id is Dripos's "tick_..." string
  -- ID (string) and is also stored on the ticket row for round-trip
  -- lookups against the /ticket/{uid} endpoint.
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY,
    unique_id TEXT UNIQUE NOT NULL,
    location_id INTEGER NOT NULL,
    date_created_ms INTEGER NOT NULL,
    date_closed_ms INTEGER,
    customer_name TEXT,
    customer_phone TEXT,
    customer_email TEXT,
    ticket_number INTEGER,
    status TEXT,
    platform TEXT,
    ticket_type_name TEXT,
    employee_full_name TEXT,
    total_cents INTEGER,
    tip_cents INTEGER,
    -- Status of the per-ticket detail fetch. 'pending' = list-only
    -- (header), 'full' = items fetched, 'failed' = detail fetch errored
    -- and we should retry on next sync.
    detail_status TEXT NOT NULL DEFAULT 'pending',
    detail_fetched_at INTEGER,
    synced_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_date ON tickets(date_created_ms);
  CREATE INDEX IF NOT EXISTS idx_tickets_location_date ON tickets(location_id, date_created_ms);
  CREATE INDEX IF NOT EXISTS idx_tickets_detail_status ON tickets(detail_status);

  CREATE TABLE IF NOT EXISTS ticket_items (
    id INTEGER PRIMARY KEY,
    ticket_id INTEGER NOT NULL,
    ticket_unique_id TEXT NOT NULL,
    object_id TEXT,
    name TEXT NOT NULL,
    type TEXT,
    quantity INTEGER,
    amount_cents INTEGER,
    total_cents INTEGER,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_ticket_items_ticket ON ticket_items(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_ticket_items_name ON ticket_items(name);
  CREATE INDEX IF NOT EXISTS idx_ticket_items_object_id ON ticket_items(object_id);

  -- Sync state for the tickets backfill / nightly cron. Single row.
  CREATE TABLE IF NOT EXISTS tickets_sync_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_synced_at INTEGER,
    last_sync_count INTEGER,
    last_sync_status TEXT,
    last_sync_error TEXT,
    backfill_in_progress INTEGER NOT NULL DEFAULT 0,
    backfill_started_at INTEGER,
    backfill_progress_pct INTEGER NOT NULL DEFAULT 0,
    backfill_message TEXT
  );
  INSERT OR IGNORE INTO tickets_sync_meta (id) VALUES (1);

  -- Holiday calendar — Germania-wide special-hours decisions per date.
  -- Chain-wide (one row per holiday, not per store) matching how the
  -- existing voting spreadsheet works. Per-store divergences go in the
  -- notes field as free text (e.g., "Drive-thru only at G3").
  CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    -- 'normal' = open at store-default hours, 'closed' = fully closed,
    -- 'custom' = explicit open/close times stored below.
    status TEXT NOT NULL DEFAULT 'normal',
    open_time TEXT,
    close_time TEXT,
    notes TEXT,
    created_by INTEGER,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
  -- Unique (date, name) makes the seed idempotent — every boot can
  -- safely re-run seedHolidaysForYear without producing duplicates.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_date_name ON holidays(date, name);

  -- Menu Team SOP builder. Mirrors the legacy Word-doc layout: a drink
  -- has 1–3 temperature variants (iced/frozen/hot); each variant has a
  -- size-column header + an ordered list of ingredient rows where every
  -- cell is free text (matches today's flexibility — "Sprinkle on top
  -- after pouring", "Fill Cup", "1 pump (20g)"). Footnotes + an optional
  -- prose Assembly block cover the procedurally complex drinks (Witch's
  -- Brew, Vietnamese Iced Coffee).
  CREATE TABLE IF NOT EXISTS sops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    collection TEXT,
    dietary_tags TEXT,
    syrup_dietary_tags TEXT,
    drink_contains TEXT,
    refrigeration_note TEXT,
    -- Packet metadata. category groups drinks on the cover and selects
    -- which divider page they print under; availability fills the
    -- All-Season / 1st Half Only / 2nd Half Only cover section;
    -- sop_required=0 puts the drink in parens on the cover and skips
    -- its individual SOP page (used for "no SOP needed because of
    -- familiarity" entries). subtitle + availability_note are
    -- per-drink notes shown on the SOP page itself.
    category TEXT,
    availability TEXT,
    sop_required INTEGER NOT NULL DEFAULT 1,
    subtitle TEXT,
    availability_note TEXT,
    kind TEXT NOT NULL DEFAULT 'drink' CHECK (kind IN ('drink', 'recipe')),
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_sops_collection ON sops(collection);
  CREATE INDEX IF NOT EXISTS idx_sops_category ON sops(category);

  -- Per-collection metadata for the launch packet cover. Keyed by the
  -- collection string (e.g. "Spring 2026"). transition_note is the
  -- italic intro line on the cover. Idempotent — upserted on edit.
  CREATE TABLE IF NOT EXISTS sop_collection_meta (
    collection TEXT PRIMARY KEY,
    transition_note TEXT,
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
  );

  CREATE TABLE IF NOT EXISTS sop_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sop_id INTEGER NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
    temperature TEXT NOT NULL CHECK (temperature IN ('iced','frozen','hot')),
    position INTEGER NOT NULL DEFAULT 0,
    size_labels_json TEXT NOT NULL DEFAULT '["Kids","R","L"]',
    footnotes_json TEXT NOT NULL DEFAULT '[]',
    assembly_big_idea TEXT,
    assembly_steps_json TEXT,
    UNIQUE(sop_id, temperature)
  );
  CREATE INDEX IF NOT EXISTS idx_sop_variants_sop ON sop_variants(sop_id);

  CREATE TABLE IF NOT EXISTS sop_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    variant_id INTEGER NOT NULL REFERENCES sop_variants(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    preset_id INTEGER,
    name TEXT NOT NULL,
    modifier TEXT,
    cells_json TEXT NOT NULL DEFAULT '[]',
    sync_locked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sop_rows_variant ON sop_rows(variant_id);

  CREATE TABLE IF NOT EXISTS sop_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    default_modifier TEXT,
    -- Per-size-profile defaults the user can override per row. Shape:
    -- {"iced":["1 pump","2 pumps","3 pumps"], "hot":["1.5","2.5","3.5"]}
    default_cells_json TEXT,
    is_seeded INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 100
  );
  CREATE INDEX IF NOT EXISTS idx_sop_presets_category ON sop_presets(category);
`);

// Seed SOP presets on boot (idempotent — keyed by slug).
seedSopPresets(db);

// Apply additional schema (sales_daily, weather_daily, closure_decisions)
// kept in a separate .sql file. Used by Sales Anomaly + Weather Closure tabs;
// missing on a fresh prod DB without this exec.
const extPath = path.join(__dirname, 'db-schema-extension.sql');
if (fs.existsSync(extPath)) {
  db.exec(fs.readFileSync(extPath, 'utf8'));
}

// Seed locations if empty
const locCount = (db.prepare('SELECT COUNT(*) as c FROM locations').get() as any).c;
if (locCount === 0) {
  const seed = db.prepare('INSERT INTO locations (id, name, address, google_place_id, google_maps_url, google_rating, review_count, weekly_revenue, revenue_change, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  seed.run('g1', 'G1 Alton', 'Alton, IL', null, 'https://www.google.com/maps/place/?q=place_id:PLACE_ID_G1', 4.7, 312, 18400, 3.2, 'open');
  seed.run('g2', 'G2 Godfrey', 'Godfrey, IL', null, 'https://www.google.com/maps/place/?q=place_id:PLACE_ID_G2', 4.8, 287, 15200, -1.1, 'open');
  seed.run('g3', 'G3 East Alton', 'East Alton, IL', null, 'https://www.google.com/maps/place/?q=place_id:PLACE_ID_G3', 4.6, 198, 12800, 5.4, 'open');
  seed.run('g4', 'G4 Jerseyville', 'Jerseyville, IL', null, 'https://www.google.com/maps/place/?q=place_id:PLACE_ID_G4', 4.9, 143, 9600, 2.1, 'open');
}

export default db;
