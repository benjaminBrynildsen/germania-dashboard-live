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

  -- Patron funnel — snapshots of the dashboard.dripos.com All Patrons
  -- export. Replaced wholesale on every upload (no incremental diff;
  -- Dripos doesn't give us stable patron IDs in the CSV anyway, just
  -- name/phone/email). The first_seen_iso field is what the funnel
  -- aggregator groups by.
  CREATE TABLE IF NOT EXISTS patrons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT,
    email TEXT,
    total_tickets INTEGER NOT NULL DEFAULT 0,
    first_seen_iso TEXT,           -- YYYY-MM-DD
    last_seen_iso TEXT,            -- YYYY-MM-DD
    total_spend_cents INTEGER,
    total_tips_cents INTEGER,
    average_ticket_cents INTEGER,
    current_points REAL,
    text_subscribed INTEGER DEFAULT 0,
    email_subscribed INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_patrons_first_seen ON patrons (first_seen_iso);
  CREATE INDEX IF NOT EXISTS idx_patrons_tickets ON patrons (total_tickets);

  -- Single-row metadata about the most recent patron upload so the UI
  -- can show "Last upload: 12:38 PM today by Ben · 5,841 patrons".
  CREATE TABLE IF NOT EXISTS patrons_upload_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    uploaded_at INTEGER,
    uploaded_by TEXT,
    row_count INTEGER,
    filename TEXT
  );
  INSERT OR IGNORE INTO patrons_upload_meta (id) VALUES (1);

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
