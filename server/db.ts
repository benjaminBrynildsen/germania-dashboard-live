import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

// bake_haus_orders.mon_locked_qty migration — adds the Mon-delivery
// snapshot column to existing tables that pre-date the lock feature.
// CREATE TABLE IF NOT EXISTS below won't backfill columns on its own.
{
  const tbl = db.prepare("PRAGMA table_info(bake_haus_orders)").all() as Array<{ name: string }>;
  if (tbl.length > 0 && !tbl.some((c) => c.name === 'mon_locked_qty')) {
    console.log('[migration] adding mon_locked_qty to bake_haus_orders');
    db.exec('ALTER TABLE bake_haus_orders ADD COLUMN mon_locked_qty REAL');
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
    -- Snapshot of this row's Monday delivery qty at the moment the
    -- week was locked. NULL = not locked. When set, the split logic
    -- uses this value for mon and redistributes the rest to wed/fri
    -- so post-Monday qty edits don't retroactively change what
    -- already left the kitchen.
    mon_locked_qty REAL,
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

  -- Marks a week as "Monday delivery already went out". When a row
  -- exists for a given week_start_iso, the Monday qty for each order
  -- row in that week is frozen to its mon_locked_qty snapshot.
  CREATE TABLE IF NOT EXISTS bake_haus_week_locks (
    week_start_iso TEXT NOT NULL,
    mon_locked_at INTEGER NOT NULL,
    locked_by TEXT,
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
`);

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
