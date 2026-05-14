/**
 * Dripos private API client (Node) — first-party use of the Germania
 * shops' own data. Ported from /home/wolfgang/dripos/dripos.py.
 */
import db from './db.js';

const BASE_URL = 'https://api.dripos.com';

// G1-G4 → numeric Dripos LOCATION_IDs + the loc_ UNIQUE_IDs. (Loc 1082 is a
// separate site that doesn't appear in the weekly G1-G4 report, so we
// exclude it here.) The location HEADER must use the UNIQUE_ID (loc_xxx)
// form for SMS-login tokens — numeric works for browser-session tokens but
// returns INSUFFICIENT_PERMISSIONS for SMS-login tokens. The numeric ID
// still goes in request bodies (LOCATION_ID_ARRAY etc.).
export interface Store {
  label: string;
  locationId: number;
  uniqueId: string;
  /** Human-readable city name shown to staff (badges, tooltips). */
  city: string;
  /**
   * Substrings (case-insensitive) that, if found in an application form's
   * "which store?" answer, route the applicant to this store. Order matters
   * only inasmuch as longer/more-specific strings should come first to
   * avoid e.g. "East Alton" matching the G1 "Alton" alias.
   */
  applicantAliases: string[];
}

export const STORES: Store[] = [
  // NOTE: If the city → store mapping is wrong (e.g. G1 isn't actually
  // Alton), edit these — applicant routing is the only thing that uses
  // city/applicantAliases, so it's safe to change without touching reports.
  { label: 'G1', locationId: 131, uniqueId: 'loc_b4nrdvOjLT8cfE63X7m6QRsP',
    city: 'Alton',      applicantAliases: ['alton'] },
  { label: 'G2', locationId: 132, uniqueId: 'loc_2FqRNPdfcLEg521EOOFCgetj',
    city: 'Godfrey',    applicantAliases: ['godfrey'] },
  { label: 'G3', locationId: 133, uniqueId: 'loc_zWkTy2JGaXcBRWc5miKaKUjC',
    city: 'East Alton', applicantAliases: ['east alton', 'east-alton', 'eastalton'] },
  { label: 'G4', locationId: 134, uniqueId: 'loc_62xj8uJ7xZHQ4yCTQjRU2ZWB',
    city: 'Jerseyville', applicantAliases: ['jerseyville', 'jersey ville'] },
];

/**
 * Salaried-manager pool per WEEK, in cents.
 *
 * Dripos's /report/laborvssales only counts clocked-in hourly labor;
 * salaried managers never punch in so they're invisible there. The
 * accountant pools salaries chain-wide and allocates by sales share.
 *
 * Seeded at $6,500/wk — solved from the manual labor % anchors for
 * week 18 (G1 32%, G4 31%) which gave pool=$6,519 + kitchen=$1,736.
 * Refine when payroll changes.
 */
export const SALARIED_POOL_CENTS_PER_WEEK = 650_000;

/**
 * G4's kitchen feeds the chain. The kitchen labor cost is embedded in
 * G4's Dripos hourly number but really belongs to chain overhead, so
 * we extract this amount from G4's hourly and pool it with salaries
 * before allocating by sales share. Solved from the same week-18
 * anchors as SALARIED_POOL_CENTS_PER_WEEK.
 */
export const G4_KITCHEN_OFFLOAD_CENTS_PER_WEEK = 175_000;

/**
 * Best-effort: extract every store the applicant ticked. Multi-checkbox form
 * answers come in as "Alton, Godfrey" or similar; we have to find ALL matches,
 * not just the first. Longer-alias stores are matched first AND their matches
 * are stripped from the haystack so e.g. "East Alton, Godfrey" doesn't double-
 * count to G2 + G1.
 */
export function matchStoreLabels(text: string | null | undefined): string[] {
  if (!text) return [];
  let haystack = text.toLowerCase();
  const ordered = [...STORES].sort((a, b) => {
    const maxLen = (s: Store) => Math.max(...s.applicantAliases.map((a) => a.length));
    return maxLen(b) - maxLen(a);
  });
  const found: string[] = [];
  for (const s of ordered) {
    for (const al of s.applicantAliases) {
      if (haystack.includes(al)) {
        if (!found.includes(s.label)) found.push(s.label);
        // Strip every occurrence so a later (shorter) alias can't re-match.
        haystack = haystack.split(al).join(' '.repeat(al.length));
        break;
      }
    }
  }
  // Return in canonical G1-G4 order regardless of which one matched first.
  return STORES.filter((s) => found.includes(s.label)).map((s) => s.label);
}

/** Deprecated single-match version kept for callers that haven't migrated. */
export function matchStoreLabel(text: string | null | undefined): string | null {
  return matchStoreLabels(text)[0] ?? null;
}

const UNIQUE_BY_LOCATION_ID: Record<number, string> = Object.fromEntries(
  STORES.map((s) => [s.locationId, s.uniqueId]),
);

export const BAKE_HAUS_CATEGORY = 'BAKE HAUS FOOD';

// Dripos signals auth failures with HTTP 200 + success:false + error:SESSION_INVALID.
// Errors that mean "the stored token is no good for this call" — surfacing
// these as AuthExpired makes the UI prompt for re-login instead of rendering
// silent zeros. INSUFFICIENT_PERMISSIONS specifically fires when an SMS-login
// token tries to read /dashboard/sales: that scope only opens for tokens
// minted by the dashboard.dripos.com browser session.
const AUTH_ERRORS = new Set([
  'SESSION_INVALID',
  'AUTH_INVALID',
  'TOKEN_EXPIRED',
  'FORBIDDEN',
  'INSUFFICIENT_PERMISSIONS',
]);

export class AuthExpired extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'AuthExpired';
  }
}

export class NoToken extends Error {
  constructor() {
    super('No Dripos token configured. Log in via /api/dripos/login/initiate.');
    this.name = 'NoToken';
  }
}

export function readToken(): string | null {
  // Env-var override beats the DB. DRIPOS_TOKEN holds a dashboard-scoped
  // token; SMS-login tokens lack /report/* permissions, so the env var
  // is the source of truth in prod.
  const override = process.env.DRIPOS_TOKEN?.trim();
  if (override) return override;
  const row = db.prepare('SELECT session_token FROM dripos_settings WHERE id = 1').get() as
    | { session_token: string | null }
    | undefined;
  return row?.session_token ?? null;
}

export function writeToken(token: string, phone?: string | null): void {
  db.prepare(
    `UPDATE dripos_settings
     SET session_token = ?, last_login_phone = COALESCE(?, last_login_phone),
         last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`
  ).run(token, phone ?? null);
}

export function clearToken(): void {
  db.prepare(
    `UPDATE dripos_settings SET session_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
  ).run();
}

interface DriposResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: unknown;
  message?: string;
  code?: number;
}

interface ApiOptions {
  locationId?: number | string;
  query?: Record<string, string | number>;
  method?: 'GET' | 'POST';
  body?: unknown;
  // For login endpoints we don't want to require an existing session token.
  noAuth?: boolean;
}

// Cap concurrent in-flight Dripos requests. buildReport schedules ~36 parallel
// /report/salessummary calls (3 sales-bucket weeks × 4 stores + 6-week trend ×
// 4 stores), and Dripos's API returns connection timeouts at that volume.
// 6 in flight is enough to keep total wall-time low without tripping the rate
// limit.
const DRIPOS_MAX_CONCURRENT = 6;
let driposInFlight = 0;
const driposWaiters: Array<() => void> = [];

async function acquireDriposSlot(): Promise<void> {
  if (driposInFlight < DRIPOS_MAX_CONCURRENT) {
    driposInFlight++;
    return;
  }
  await new Promise<void>((resolve) => driposWaiters.push(resolve));
  driposInFlight++;
}

function releaseDriposSlot(): void {
  driposInFlight--;
  const next = driposWaiters.shift();
  if (next) next();
}

async function callApi<T = unknown>(path: string, opts: ApiOptions = {}): Promise<DriposResponse<T>> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    origin: 'https://dashboard.dripos.com',
    referer: 'https://dashboard.dripos.com/',
  };

  if (!opts.noAuth) {
    const token = readToken();
    if (!token) throw new NoToken();
    headers.authentication = token;
  }

  if (opts.locationId !== undefined) {
    // Prefer the UNIQUE_ID (loc_xxx) form for the location header — that's
    // what dashboard.dripos.com sends, and SMS-login tokens reject the
    // bare numeric form with INSUFFICIENT_PERMISSIONS.
    const numeric = typeof opts.locationId === 'number' ? opts.locationId : Number(opts.locationId);
    const uniq = !Number.isNaN(numeric) ? UNIQUE_BY_LOCATION_ID[numeric] : undefined;
    headers.location = uniq ?? String(opts.locationId);
  }

  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  let url = BASE_URL + (path.startsWith('/') ? path : '/' + path);
  if (opts.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) params.set(k, String(v));
    url += (url.includes('?') ? '&' : '?') + params.toString();
  }

  await acquireDriposSlot();
  let r: globalThis.Response;
  let body: DriposResponse<T>;
  try {
    r = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (r.status === 401 || r.status === 403) {
      throw new AuthExpired(`HTTP ${r.status}`);
    }

    try {
      body = (await r.json()) as DriposResponse<T>;
    } catch {
      throw new Error(`Non-JSON response from Dripos: HTTP ${r.status}`);
    }
  } finally {
    releaseDriposSlot();
  }

  if (body && body.success === false) {
    if (typeof body.error === 'string' && AUTH_ERRORS.has(body.error)) {
      throw new AuthExpired(body.error);
    }
  }

  return body;
}

// ── Date helpers ──────────────────────────────────────────────────────────
const MS_PER_DAY = 86_400_000;

function startOfDayMs(d: Date): number {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  return x.getTime();
}

function endOfDayMs(d: Date): number {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return x.getTime();
}

function addDays(d: Date, n: number): Date {
  // Use setDate so DST transitions (which shift wall-clock time by ±1h)
  // don't drift dates that straddle a DST boundary.
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function dateOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Sunday of the most-recently-completed Sun-Sat week relative to `today`. */
export function latestCompleteSun(today: Date = new Date()): Date {
  const t = dateOnly(today);
  // JS: Sunday=0, Mon=1, ..., Sat=6. Days since most recent COMPLETED Saturday.
  // `|| 7` is the Saturday case: today itself is a Saturday whose week isn't
  // done yet, so step back a full week instead of anchoring on today.
  const daysSinceSat = ((t.getDay() + 1) % 7) || 7;
  const lastSat = addDays(t, -daysSinceSat);
  return addDays(lastSat, -6);
}

export function weekBounds(today: Date = new Date(), weeksBack = 0): [Date, Date] {
  const sun = addDays(latestCompleteSun(today), -7 * weeksBack);
  const sat = addDays(sun, 6);
  return [sun, sat];
}

function daysBetween(a: Date, b: Date): number {
  // Calendar-day count, immune to DST shifts (which would offset
  // millisecond arithmetic by ±1 hour across spring/fall transitions).
  const aUtc = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bUtc = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bUtc - aUtc) / MS_PER_DAY);
}

/** Sunday-anchored, year-anchored week number (Dripos convention; differs from ISO). */
export function sundayWeekNumber(d: Date): number {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const firstSun = addDays(jan1, -((jan1.getDay()) % 7));
  return Math.floor(daysBetween(firstSun, d) / 7) + 1;
}

export function fmtMoney(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtRange(sun: Date, sat: Date): string {
  const m = (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
  return `${m(sun)}–${m(sat)}, ${sat.getFullYear()}`;
}

// ── Cache layer ───────────────────────────────────────────────────────────
// Past-week date ranges never change → cache forever. Current week (range end
// is in the future or today) → 5-minute TTL so refreshes feel live without
// hammering Dripos.
const CACHE_CURRENT_WEEK_TTL_MS = 5 * 60 * 1000;

// In-flight dedupe: when two callers ask for the same cache key at the
// same time and there's a miss, they share the single Dripos call instead
// of both firing it. Critical when the boot pre-warm and a user page-load
// race for the same 208 cells — without this they'd double-pull every
// cell, doubling Dripos load and slowing both. The map is keyed by the
// SAME string we use for the DB cache key.
const inFlightFetches = new Map<string, Promise<unknown>>();

async function cached<T>(
  key: string,
  rangeEndMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const row = db
    .prepare('SELECT value, expires_at FROM dripos_cache WHERE key = ?')
    .get(key) as { value: string; expires_at: number | null } | undefined;
  if (row && (row.expires_at == null || row.expires_at > now)) {
    try { return JSON.parse(row.value) as T; } catch { /* fallthrough to refetch */ }
  }

  // If another call is already fetching this key, ride on its promise.
  const inFlight = inFlightFetches.get(key);
  if (inFlight) return inFlight as Promise<T>;

  const p = (async (): Promise<T> => {
    try {
      const fresh = await fetcher();
      // Range ends before today's start → past data, cache forever. Else short TTL.
      const todayStart = startOfDayMs(new Date());
      const expires = rangeEndMs < todayStart ? null : now + CACHE_CURRENT_WEEK_TTL_MS;
      db.prepare(
        'INSERT INTO dripos_cache (key, value, created_at, expires_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at, expires_at = excluded.expires_at',
      ).run(key, JSON.stringify(fresh), now, expires);
      return fresh;
    } catch (err) {
      // Auth failures should always surface — the user needs to re-login.
      if (err instanceof AuthExpired || err instanceof NoToken) throw err;
      // For everything else (Dripos 5xx, "OK" text response, network timeout),
      // fall back to the stale cached value if we have one. This keeps the
      // dashboard usable when Dripos is having a bad day.
      if (row) {
        try {
          const stale = JSON.parse(row.value) as T;
          console.warn(
            `[cache] ${key}: Dripos fetch failed (${err instanceof Error ? err.message : err}); serving stale value`,
          );
          return stale;
        } catch {
          /* malformed cache row → throw original error */
        }
      }
      throw err;
    } finally {
      // Clear the in-flight slot regardless of outcome so the next request
      // gets a fresh attempt.
      inFlightFetches.delete(key);
    }
  })();
  inFlightFetches.set(key, p);
  return p;
}

export function clearDriposCache(): void {
  db.prepare('DELETE FROM dripos_cache').run();
}

/**
 * Drop every cached Dripos response for the Sun-Sat week containing
 * `referenceDate`. Past weeks cache forever for the trend chart, but Dripos
 * back-fills tips / late batches for a day or two after a week closes — so
 * the user's "Refresh" needs an escape hatch to re-pull a specific week.
 *
 * All four cache key shapes (salessummary, productsales, completion,
 * laborvssales) end with `|${startMs}|${endMs}`, so a LIKE suffix match hits
 * every one for that week without touching other weeks.
 */
export function clearWeekCache(referenceDate: Date = new Date()): number {
  const [sun, sat] = weekBounds(referenceDate, 0);
  const startMs = sun.getTime();
  const endMs = endOfDayMs(sat);
  const info = db
    .prepare('DELETE FROM dripos_cache WHERE key LIKE ?')
    .run(`%|${startMs}|${endMs}`);
  return info.changes ?? 0;
}

// ── Endpoint helpers ──────────────────────────────────────────────────────
// Sourced from /report/salessummary's TIMESPAN[0] — that's what Dripos's own
// "Gross Sales" report uses. /dashboard/sales returns a GROSS_SALES that
// silently includes taxes, so the chain total there reads ~7% high vs
// dashboard.dripos.com.
interface DashboardSalesData {
  STATS?: {
    GROSS_SALES?: number;
    TICKET_COUNT?: number;
    AVERAGE_TICKET?: number;
  };
}

interface SalesSummaryRow {
  TICKET_COUNT?: number;
  GROSS_SALES?: number;
  NET_SALES?: number;
  PRODUCT_SALES?: number;
  REFUNDS?: number;
  DISCOUNTS?: number;
  TAXES?: number;
  TIPS?: number;
}

export async function fetchDashboardSales(
  locationId: number,
  sun: Date,
  sat: Date,
): Promise<DashboardSalesData> {
  const start = startOfDayMs(sun);
  const end = endOfDayMs(sat);
  return cached(
    `report/salessummary|${locationId}|${start}|${end}`,
    end,
    async () => {
      const body = await callApi<{ TIMESPAN?: SalesSummaryRow[] }>(
        '/report/salessummary',
        {
          method: 'POST',
          locationId,
          body: {
            START_EPOCH: start,
            END_EPOCH: end,
            LOCATION_ID_ARRAY: [locationId],
            EXECUTE_REPORTS: ['HOUR'],
            POPULATE_MISSING_DATES: false,
          },
        },
      );
      const row = body.data?.TIMESPAN?.[0];
      const tickets = row?.TICKET_COUNT ?? 0;
      const gross = row?.GROSS_SALES ?? 0;
      return {
        STATS: {
          GROSS_SALES: gross,
          TICKET_COUNT: tickets,
          AVERAGE_TICKET: tickets > 0 ? Math.round(gross / tickets) : 0,
        },
      };
    },
  );
}

/**
 * Chain-wide /report/salessummary call (all locations in one POST). Dripos's
 * own "Sales Summary" report does this — calling per-location and summing
 * misses cross-location adjustments (refunds processed at a different store,
 * shared gift-card redemptions) and reads a few tenths of a percent low.
 * Used for the headline KPI tiles so they exactly match dashboard.dripos.com.
 * Per-store breakdown rows still use fetchDashboardSales per location.
 */
export async function fetchChainSales(
  locationIds: number[],
  sun: Date,
  sat: Date,
): Promise<DashboardSalesData> {
  const start = startOfDayMs(sun);
  const end = endOfDayMs(sat);
  const ids = [...locationIds].sort((a, b) => a - b).join(',');
  return cached(
    `report/salessummary-chain|${ids}|${start}|${end}`,
    end,
    async () => {
      const body = await callApi<{ TIMESPAN?: SalesSummaryRow[] }>(
        '/report/salessummary',
        {
          method: 'POST',
          locationId: locationIds[0],
          body: {
            START_EPOCH: start,
            END_EPOCH: end,
            LOCATION_ID_ARRAY: locationIds,
            EXECUTE_REPORTS: ['HOUR'],
            POPULATE_MISSING_DATES: false,
          },
        },
      );
      const row = body.data?.TIMESPAN?.[0];
      const tickets = row?.TICKET_COUNT ?? 0;
      const gross = row?.GROSS_SALES ?? 0;
      return {
        STATS: {
          GROSS_SALES: gross,
          TICKET_COUNT: tickets,
          AVERAGE_TICKET: tickets > 0 ? Math.round(gross / tickets) : 0,
        },
      };
    },
  );
}

interface DriposProduct {
  ID: number;
  NAME: string;
  CATEGORY_NAME: string;
  CATEGORY_ID: number;
  ARCHIVED?: number;
  INVENTORY?: number | null;
}

/**
 * Live weekly-metrics cache used by /api/locations (and other tabs that
 * just need the current/prev gross sales per store). 5-minute TTL keeps
 * page loads cheap without going stale on a 7-day report.
 */
interface WeeklyMetrics {
  weeklyRevenueCents: number;
  prevWeeklyRevenueCents: number;
  revenueChangePct: number | null;
  ticketCount: number;
  avgTicketCents: number;
}
const WEEKLY_TTL_MS = 5 * 60 * 1000;
const weeklyCache = new Map<number, { at: number; metrics: WeeklyMetrics }>();

export async function getWeeklyMetrics(locationId: number): Promise<WeeklyMetrics> {
  const cached = weeklyCache.get(locationId);
  if (cached && Date.now() - cached.at < WEEKLY_TTL_MS) return cached.metrics;

  const [curSun, curSat] = weekBounds(new Date(), 0);
  const [prevSun, prevSat] = weekBounds(new Date(), 1);
  const [cur, prev] = await Promise.all([
    fetchDashboardSales(locationId, curSun, curSat),
    fetchDashboardSales(locationId, prevSun, prevSat),
  ]);
  const curStats = cur.STATS ?? {};
  const prevStats = prev.STATS ?? {};
  const cents = curStats.GROSS_SALES ?? 0;
  const prevCents = prevStats.GROSS_SALES ?? 0;
  const metrics: WeeklyMetrics = {
    weeklyRevenueCents: cents,
    prevWeeklyRevenueCents: prevCents,
    revenueChangePct: pctChange(cents, prevCents),
    ticketCount: curStats.TICKET_COUNT ?? 0,
    avgTicketCents: curStats.AVERAGE_TICKET ?? 0,
  };
  weeklyCache.set(locationId, { at: Date.now(), metrics });
  return metrics;
}

export function clearWeeklyCache(): void {
  weeklyCache.clear();
}

// ── Daily sales sync (powers Sales Anomaly via the sales_daily table) ────
export interface DailySales {
  date: string; // YYYY-MM-DD
  locationId: number;
  totalSales: number; // cents
  ticketCount: number;
  avgTicketCents: number;
}

export async function fetchDailySales(locationId: number, day: Date): Promise<DailySales> {
  const data = await fetchDashboardSales(locationId, day, day);
  const stats = data.STATS ?? {};
  return {
    date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
    locationId,
    totalSales: stats.GROSS_SALES ?? 0,
    ticketCount: stats.TICKET_COUNT ?? 0,
    avgTicketCents: stats.AVERAGE_TICKET ?? 0,
  };
}

export interface SyncSummary {
  rowsWritten: number;
  rowsUpdated: number;
  daysSynced: number;
  errors: Array<{ date: string; locationId: number; error: string }>;
  startDate: string;
  endDate: string;
}

/**
 * Backfill the `sales_daily` SQLite table with the last `days` days of
 * gross sales / ticket count / avg ticket per store. Existing rows for the
 * same (date, location_id) are upserted. Used by the Sales Anomaly tab.
 */
export async function syncDailySales(days = 30): Promise<SyncSummary> {
  // Lazy import to avoid circular dep at module load time.
  const { default: db } = await import('./db.js');
  const upsert = db.prepare(`
    INSERT INTO sales_daily (date, location_id, location_name, total_sales, transaction_count, avg_ticket)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, location_id) DO UPDATE SET
      total_sales = excluded.total_sales,
      transaction_count = excluded.transaction_count,
      avg_ticket = excluded.avg_ticket
  `);

  const today = dateOnly(new Date());
  // Don't sync today (incomplete day); start from yesterday.
  const lastDay = addDays(today, -1);
  const firstDay = addDays(lastDay, -(days - 1));

  const summary: SyncSummary = {
    rowsWritten: 0,
    rowsUpdated: 0,
    daysSynced: 0,
    errors: [],
    startDate: `${firstDay.getFullYear()}-${String(firstDay.getMonth() + 1).padStart(2, '0')}-${String(firstDay.getDate()).padStart(2, '0')}`,
    endDate: `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`,
  };

  // Build job list
  const jobs: Array<{ day: Date; store: { label: string; locationId: number } }> = [];
  for (let d = new Date(firstDay); d <= lastDay; d = addDays(d, 1)) {
    for (const store of STORES) jobs.push({ day: new Date(d), store });
  }

  // Cap parallelism at 6 to avoid hammering Dripos
  const CHUNK = 6;
  for (let i = 0; i < jobs.length; i += CHUNK) {
    const slice = jobs.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      slice.map(async ({ day, store }) => {
        const ds = await fetchDailySales(store.locationId, day);
        return { ds, store };
      }),
    );
    for (const [j, r] of results.entries()) {
      const { day, store } = slice[j];
      if (r.status === 'fulfilled') {
        const { ds } = r.value;
        const info = upsert.run(
          ds.date,
          store.locationId,
          store.label,
          ds.totalSales / 100, // sales_daily.total_sales is REAL (dollars) in the existing schema
          ds.ticketCount,
          ds.avgTicketCents / 100,
        );
        if (info.changes > 0) {
          summary.rowsWritten += 1;
        }
      } else {
        const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        summary.errors.push({
          date: dateStr,
          locationId: store.locationId,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  }
  summary.daysSynced = days;
  return summary;
}

export async function fetchInventory(locationId: number): Promise<DriposProduct[]> {
  const body = await callApi<DriposProduct[]>('/products', { locationId });
  const all = (body.data ?? []) as DriposProduct[];
  return all.filter((p) => p.CATEGORY_NAME === BAKE_HAUS_CATEGORY && !p.ARCHIVED);
}

// ── Login flow ────────────────────────────────────────────────────────────
export async function loginInitiate(phone: string): Promise<{ unique: string }> {
  const body = await callApi<unknown>('/login/initiate', {
    method: 'POST',
    body: { PHONE: phone },
    noAuth: true,
  });
  // Dripos has shipped three shapes for this response over time:
  //   { UNIQUE: "..." }            — flat
  //   { data: { UNIQUE: "..." } }  — wrapped object
  //   { data: "..." }              — plain string (current as of 2026-05)
  type LoginInitiateBody = DriposResponse<string | { UNIQUE?: string }> & { UNIQUE?: string };
  const direct = body as LoginInitiateBody;
  const unique =
    typeof direct.data === 'string'
      ? direct.data
      : direct.UNIQUE ?? direct.data?.UNIQUE ?? null;
  if (!unique) {
    let err: string | undefined;
    if (typeof body.message === 'string') err = body.message;
    if (Array.isArray(body.error) && body.error[0] && typeof body.error[0] === 'object') {
      const first = body.error[0] as { message?: string };
      if (first.message) err = first.message;
    } else if (typeof body.error === 'string') {
      err = body.error;
    }
    throw new Error(err ?? 'Login initiate did not return UNIQUE');
  }
  return { unique };
}

export async function loginComplete(args: {
  unique: string;
  code: string;
  phone?: string;
}): Promise<{ token: string }> {
  // CLIENT.NAME is case-sensitive — Dripos's own bundle sends the
  // uppercase form, and the resulting token is fully scoped for
  // /dashboard/sales + /report/*. Lowercase (which we sent before)
  // returned a token whose calls all came back INSUFFICIENT_PERMISSIONS.
  const body = await callApi<unknown>('/login/complete', {
    method: 'POST',
    body: {
      TOKEN: args.code.replaceAll(' ', ''),
      UNIQUE: args.unique,
      CLIENT: {
        NAME: 'DASHBOARD.DRIPOS.COM',
        INFO: 'Website',
        TYPE: 2,
      },
    },
    noAuth: true,
  });
  // Token may live at root, nested under data, or be data itself (matches the
  // /login/initiate string-form response shape Dripos rolled out in 2026-05).
  type LoginCompleteBody = DriposResponse<string | { AUTH?: string; token?: string }> & {
    AUTH?: string;
    token?: string;
  };
  const direct = body as LoginCompleteBody;
  const token =
    direct.AUTH ??
    direct.token ??
    (typeof direct.data === 'string' ? direct.data : direct.data?.AUTH ?? direct.data?.token);
  if (!token) {
    throw new Error(typeof body.message === 'string' ? body.message : 'No AUTH token returned');
  }
  writeToken(token, args.phone);
  return { token };
}

// ── Report assembly ────────────────────────────────────────────────────────
export interface StoreRow {
  label: string;
  locationId: number;
  grossSales: number;
  ticketCount: number;
  averageTicket: number;
  byPlatform: Record<string, number>;
  wowPct: number | null;
  yoyPct: number | null;
}

export interface InventoryRow {
  name: string;
  byStore: Record<string, number | null>;
  total: number;
}

export interface ItemSalesRow {
  name: string;
  unitsByStore: Record<string, number>;
  totalUnits: number;
  avgPerStore: number;
  totalRevenueCents: number;
}

export interface LaborRow {
  label: string;
  locationId: number;
  /** Total labor = hourly + salaried. What the labor % reads against. */
  laborCents: number;
  /** Just the clocked-in / Dripos number. */
  hourlyCents: number;
  /** Salaried-manager overhead added on top (from SALARIED_OVERHEAD_CENTS_PER_WEEK). */
  salariedCents: number;
  grossSalesCents: number;
  laborPct: number | null;
}

export interface PlatformSalesRow {
  label: string;
  mobileCents: number;
  webCents: number;
  thirdCents: number;
  posCents: number;
  otherCents: number; // KIOSK + READER, usually 0
  totalCents: number;
  nonPosCents: number; // mobile + web + third
  nonPosPct: number | null;
}

interface ProductSalesRow {
  LINE_ITEM_TYPE: string;
  LINE_ITEM_NAME: string;
  LOCATION_ID: number;
  PRODUCT_ID: string;
  CATEGORY_NAME: string;
  ORDER_COUNT: number;
  GROSS_SALES: number;
  NET_SALES: number;
  PLATFORM_NAME: string;
}

const DRINK_EXCLUDE_CATEGORIES = new Set(['BAKE HAUS FOOD', 'PETS']);

const PRODUCT_SALES_PLATFORMS: Array<{ name: string; third: boolean }> = [
  { name: 'MOBILE', third: false },
  { name: 'WEB', third: false },
  { name: 'POS', third: false },
  { name: 'KIOSK', third: false },
  { name: 'READER', third: false },
  { name: 'THIRD', third: true },
];

async function fetchProductSales(
  locationIds: number[],
  startMs: number,
  endMs: number,
): Promise<ProductSalesRow[]> {
  return cached(
    `report/productsales|${locationIds.join(',')}|${startMs}|${endMs}`,
    endMs,
    async () => {
      // Dripos /report/productsales mis-attributes PLATFORM_NAME when
      // SELECTED_PLATFORMS_ARRAY has multiple entries — most MOBILE rows
      // come back tagged WEB. Call once per platform; per-row attribution
      // is then correct and totals match.
      const perPlatform = await Promise.all(
        PRODUCT_SALES_PLATFORMS.map(async (p) => {
          const body = await callApi<{ LINE_ITEM_RECORDS: ProductSalesRow[] }>(
            '/report/productsales',
            {
              method: 'POST',
              locationId: locationIds[0],
              body: {
                START_EPOCH: startMs,
                END_EPOCH: endMs,
                EXCLUDE_THIRD_PARTY: false,
                LOCATION_ID_ARRAY: locationIds,
                SELECTED_PLATFORMS_ARRAY: [{ PLATFORM: p.name, THIRD: p.third }],
                SELECTED_TAGS_ARRAY: [],
              },
            },
          );
          return body.data?.LINE_ITEM_RECORDS ?? [];
        }),
      );
      return perPlatform.flat();
    },
  );
}

// ── Ticket completion (drink-time) ───────────────────────────────────────
// AVG_COMPLETION_TIME from /report/completion is already in MINUTES, rounded.
// HOUR is the epoch-ms of the bucket start expressed in Eastern; we relabel
// it in America/Chicago (where the brewery operates) so the grid hours match
// what baristas actually see on the clock.
interface CompletionHour {
  HOUR: number;
  TICKET_COUNT: number;
  TICKET_SECONDS: number;
  AVG_COMPLETION_TIME: number;
}

async function fetchCompletion(
  locationId: number,
  sun: Date,
  sat: Date,
): Promise<CompletionHour[]> {
  const start = startOfDayMs(sun);
  const end = endOfDayMs(sat);
  return cached(
    `report/completion|${locationId}|${start}|${end}`,
    end,
    async () => {
      const body = await callApi<{ HOUR?: CompletionHour[] }>(
        '/report/completion',
        {
          method: 'POST',
          locationId,
          body: { START_EPOCH: start, END_EPOCH: end, LOCATION_ID_ARRAY: [locationId] },
        },
      );
      return body.data?.HOUR ?? [];
    },
  );
}

const TICKET_HOUR_LABELS = [
  '6AM','7AM','8AM','9AM','10AM','11AM',
  '12PM','1PM','2PM','3PM','4PM','5PM',
];
const TICKET_DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function chicagoHourLabel(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: true,
    timeZone: 'America/Chicago',
  }).formatToParts(new Date(epochMs));
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  return `${hour}${period}`;
}

function chicagoDayIndex(epochMs: number): number {
  const wd = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'America/Chicago',
  }).format(new Date(epochMs));
  return TICKET_DAYS.indexOf(wd);
}

function bucketCompletions(
  hours: CompletionHour[],
): Record<string, (number | null)[]> {
  const grid: Record<string, (number | null)[]> = {};
  for (const lbl of TICKET_HOUR_LABELS) {
    grid[lbl] = [null, null, null, null, null, null, null];
  }
  for (const h of hours) {
    if (!h.TICKET_COUNT) continue;
    const lbl = chicagoHourLabel(h.HOUR);
    const di = chicagoDayIndex(h.HOUR);
    if (!grid[lbl] || di < 0) continue;
    grid[lbl][di] = h.AVG_COMPLETION_TIME;
  }
  return grid;
}

export interface TicketTimeWeek {
  weekNum: number;
  dates: string[];
  data: Record<string, { hours: Record<string, (number | null)[]> }>;
}

export async function buildTicketTimeReport(
  referenceDate: Date = new Date(),
): Promise<TicketTimeWeek> {
  const [sun, sat] = weekBounds(referenceDate, 0);
  const perStore = await Promise.all(
    STORES.map(async (s) => {
      const hours = await fetchCompletion(s.locationId, sun, sat);
      return [s.label, { hours: bucketCompletions(hours) }] as const;
    }),
  );
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(sun, i);
    dates.push(`${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`);
  }
  return {
    weekNum: sundayWeekNumber(sun),
    dates,
    data: Object.fromEntries(perStore),
  };
}

// ── Daily ticket time + sales correlation ────────────────────────────────
/**
 * Convert an epoch-ms to YYYY-MM-DD in America/Chicago — the brewery's
 * operating timezone. Needed to bucket hourly completion data by day
 * without UTC drift.
 */
function chicagoDateKey(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    timeZone: 'America/Chicago',
  }).format(new Date(epochMs));
  return parts; // en-CA gives YYYY-MM-DD natively
}

export interface DailyTicketAndSales {
  date: string;        // YYYY-MM-DD
  avgTicketMin: number | null;
  ticketCount: number;
  salesCents: number;
}

/**
 * For one location, return [days] of per-day avg ticket completion time
 * (weighted by ticket count) alongside that day's gross sales. Used by
 * the Location detail page's correlation chart.
 *
 * Today is excluded (incomplete day). Ticket-time data is fetched a week
 * at a time (via fetchCompletion, cached forever for past weeks), then
 * the hourly entries are aggregated to days. Daily sales come from
 * fetchDailySales (cached forever for past days at the salessummary
 * level). First call for a long range can be slow; subsequent loads
 * are instant.
 */
export async function fetchDailyTicketAndSales(
  locationId: number,
  days: number,
): Promise<DailyTicketAndSales[]> {
  const today = dateOnly(new Date());
  const lastDay = addDays(today, -1);          // skip today (incomplete)
  const firstDay = addDays(lastDay, -(days - 1));

  // Step back to the Sunday of firstDay's week so we don't miss data.
  const firstSun = addDays(firstDay, -((firstDay.getDay()) % 7));
  // Walk forward by 7 days at a time, capturing every week that touches
  // the range; fetchCompletion is cached so weeks already fetched are free.
  const weekJobs: Promise<CompletionHour[]>[] = [];
  for (let s = new Date(firstSun); s <= lastDay; s = addDays(s, 7)) {
    const sat = addDays(s, 6);
    weekJobs.push(fetchCompletion(locationId, new Date(s), sat));
  }
  const weeks = await Promise.all(weekJobs);

  // AVG_COMPLETION_TIME is in minutes (matches the values shown in the
  // existing Ticket Time grid). Compute a count-weighted average per day
  // across all hourly buckets that fall on that day.
  const byDate: Record<string, { weighted: number; count: number }> = {};
  for (const hours of weeks) {
    for (const h of hours) {
      if (!h.TICKET_COUNT) continue;
      const key = chicagoDateKey(h.HOUR);
      const row = byDate[key] ?? (byDate[key] = { weighted: 0, count: 0 });
      row.weighted += h.AVG_COMPLETION_TIME * h.TICKET_COUNT;
      row.count += h.TICKET_COUNT;
    }
  }

  // Pull daily sales for every day in the range (cached).
  const dayList: Date[] = [];
  for (let d = new Date(firstDay); d <= lastDay; d = addDays(d, 1)) {
    dayList.push(new Date(d));
  }

  // Cap parallelism so we don't hammer Dripos on first load.
  const CHUNK = 6;
  const salesByDate: Record<string, DailySales> = {};
  for (let i = 0; i < dayList.length; i += CHUNK) {
    const slice = dayList.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      slice.map((d) => fetchDailySales(locationId, d)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') salesByDate[r.value.date] = r.value;
    }
  }

  const out: DailyTicketAndSales[] = [];
  for (const d of dayList) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const tt = byDate[key];
    const sales = salesByDate[key];
    out.push({
      date: key,
      avgTicketMin: tt && tt.count > 0 ? tt.weighted / tt.count : null,
      ticketCount: tt?.count ?? 0,
      salesCents: sales?.totalSales ?? 0,
    });
  }
  return out;
}

interface LaborVsSalesData {
  breakdown: Array<{
    label: string;
    laborCost: number;
    grossSales: number;
    laborVsSalesPercentage: number;
  }>;
}

async function fetchLaborVsSales(
  locationId: number,
  startMs: number,
  endMs: number,
): Promise<{ laborCents: number; grossSalesCents: number }> {
  return cached(
    `report/laborvssales|${locationId}|${startMs}|${endMs}`,
    endMs,
    async () => {
      const body = await callApi<LaborVsSalesData>('/report/laborvssales', {
        method: 'POST',
        locationId,
        body: { START_EPOCH: startMs, END_EPOCH: endMs },
      });
      let labor = 0;
      let sales = 0;
      for (const r of body.data?.breakdown ?? []) {
        labor += r.laborCost ?? 0;
        sales += r.grossSales ?? 0;
      }
      return { laborCents: labor, grossSalesCents: sales };
    },
  );
}

function aggregateItems(
  rows: ProductSalesRow[],
  storeByLocId: Record<number, string>,
  predicate: (row: ProductSalesRow) => boolean,
): ItemSalesRow[] {
  const byName = new Map<string, ItemSalesRow>();
  for (const r of rows) {
    if (r.LINE_ITEM_TYPE !== 'PRODUCT') continue;
    if (!predicate(r)) continue;
    const storeLabel = storeByLocId[r.LOCATION_ID];
    if (!storeLabel) continue;
    let agg = byName.get(r.LINE_ITEM_NAME);
    if (!agg) {
      agg = {
        name: r.LINE_ITEM_NAME,
        unitsByStore: {},
        totalUnits: 0,
        avgPerStore: 0,
        totalRevenueCents: 0,
      };
      byName.set(r.LINE_ITEM_NAME, agg);
    }
    agg.totalUnits += r.ORDER_COUNT;
    agg.totalRevenueCents += r.GROSS_SALES;
    agg.unitsByStore[storeLabel] = (agg.unitsByStore[storeLabel] ?? 0) + r.ORDER_COUNT;
  }
  const storeCount = Object.keys(storeByLocId).length || 1;
  for (const v of byName.values()) v.avgPerStore = v.totalUnits / storeCount;
  return [...byName.values()];
}

export interface TrendPoint {
  label: string;
  weekNum: number;
  year: number;
  total: number;
  perStore: Record<string, number>;
}

export interface ReportData {
  generatedAt: string;
  currentWeek: { label: string; weekNum: number; year: number; sun: string; sat: string };
  prevWeek: { label: string };
  yoyWeek: { label: string };
  totals: {
    current: number;
    prev: number;
    yoy: number;
    wowPct: number | null;
    yoyPct: number | null;
    ticketsCurrent: number;
    ticketsPrev: number;
    ticketsDelta: number;
    avgTicketCurrent: number;
    avgTicketPrev: number;
    avgTicketDelta: number;
  };
  stores: StoreRow[];
  platformTotals: Record<string, number>;
  trend: TrendPoint[];
  bakeHausItemSales: ItemSalesRow[];
  topDrinks: ItemSalesRow[];
  laborByStore: LaborRow[];
  laborTotals: {
    laborCents: number;
    hourlyCents: number;
    salariedCents: number;
    grossSalesCents: number;
    laborPct: number | null;
  };
  platformSalesByStore: PlatformSalesRow[];
  platformSalesTotals: PlatformSalesRow;
  /** chain-level adjustments (custom fees + penny rounding) for current week. */
  pennyRounding: {
    /** Dripos UI chain gross - sum of per-store gross. Positive = Dripos shows more. */
    diffCents: number;
    /** Per-store-summed gross sales (validated exact vs Dripos Platform Sales). */
    storeSumCents: number;
    /** Chain-level gross from /report/salessummary multi-location call. */
    chainGrossCents: number;
    /** False if the chain call failed or returned a value we couldn't trust. */
    available: boolean;
  };
  /** Per-week manual override (applied when a week had POS issues etc.). */
  weekOverride?: {
    sun: string;
    reason: string;
    forcedGrossCents: number;
    forcedTickets: number;
  } | null;
}

/**
 * Manual weekly overrides. Keyed by the Sunday of the affected Sun-Sat week
 * (YYYY-MM-DD in local time). When set, headline gross + tickets are replaced
 * with the override values regardless of which bucket the week falls into
 * (current / prev / yoy) and the trend chart entry is bumped to match. The
 * UI surfaces `reason` so it's clear the number isn't computed from store
 * data normally.
 */
const WEEK_OVERRIDES: Record<string, {
  forcedGrossCents: number;
  forcedTickets: number;
  reason: string;
}> = {
  '2026-05-03': {
    forcedGrossCents: 5_261_109, // $52,611.09 from Dripos Sales Summary
    forcedTickets: 5403,
    reason:
      "POS errors on Saturday 5/9 caused per-store sums to read low. " +
      "Headline overridden to match Dripos's chain Sales Summary report. " +
      "Per-store breakdown rows below remain from the raw per-store API.",
  },
};

function isoLocalDate(d: Date): string {
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getDate()).padStart(2, '0')}`
  );
}

function overrideForWeek(sun: Date) {
  return WEEK_OVERRIDES[isoLocalDate(sun)] ?? null;
}

function pctChange(now: number, prior: number): number | null {
  if (!prior) return null;
  return ((now - prior) / prior) * 100;
}

const TREND_WEEKS = 6;

export async function buildReport(referenceDate: Date = new Date()): Promise<ReportData> {
  const [curSun, curSat] = weekBounds(referenceDate, 0);
  const [prevSun, prevSat] = weekBounds(referenceDate, 1);
  // 52-week shift preserves Sun-Sat alignment vs replace-year drift.
  const yoySun = addDays(curSun, -52 * 7);
  const yoySat = addDays(curSat, -52 * 7);

  type Bucket = 'current' | 'prev' | 'yoy';
  const buckets: Record<Bucket, [Date, Date]> = {
    current: [curSun, curSat],
    prev: [prevSun, prevSat],
    yoy: [yoySun, yoySat],
  };

  // Pull all (store × bucket) sales in parallel
  const salesJobs: Array<Promise<{ bucket: Bucket; label: string; data: DashboardSalesData }>> = [];
  for (const bucket of ['current', 'prev', 'yoy'] as Bucket[]) {
    const [sun, sat] = buckets[bucket];
    for (const s of STORES) {
      salesJobs.push(
        fetchDashboardSales(s.locationId, sun, sat).then((data) => ({ bucket, label: s.label, data })),
      );
    }
  }
  const salesResults = await Promise.all(salesJobs);
  const sales: Record<Bucket, Record<string, DashboardSalesData>> = {
    current: {},
    prev: {},
    yoy: {},
  };
  for (const { bucket, label, data } of salesResults) sales[bucket][label] = data;

  // Chain-aggregate /report/salessummary call for CURRENT WEEK ONLY. Dripos
  // UI's "Gross Sales" headline is larger than our sum-of-per-store totals
  // because cash registers round-down to nickels and a few non-product
  // line items (custom fees) appear only in the chain-level response.
  // Previous attempts to use this for prev/yoy returned wildly inconsistent
  // values (off by $15k on one prev-wk fetch), so we don't trust it there.
  const locationIds = STORES.map((s) => s.locationId);
  let chainCurrent: DashboardSalesData = {};
  try {
    chainCurrent = await fetchChainSales(locationIds, curSun, curSat);
  } catch (err) {
    console.error('[buildReport] chain salessummary failed:', err);
  }

  // 6-week trend (oldest-first)
  const trendJobs: Array<Promise<{ w: number; sun: Date; sat: Date; label: string; data: DashboardSalesData }>> = [];
  for (let w = TREND_WEEKS - 1; w >= 0; w--) {
    const [sun, sat] = weekBounds(referenceDate, w);
    for (const s of STORES) {
      trendJobs.push(
        fetchDashboardSales(s.locationId, sun, sat).then((data) => ({
          w,
          sun,
          sat,
          label: s.label,
          data,
        })),
      );
    }
  }
  const trendResults = await Promise.all(trendJobs);
  const byWeek: Record<number, { sun: Date; sat: Date; perStore: Record<string, number> }> = {};
  for (const { w, sun, sat, label, data } of trendResults) {
    const stats = data.STATS ?? {};
    byWeek[w] = byWeek[w] ?? { sun, sat, perStore: {} };
    byWeek[w].perStore[label] = stats.GROSS_SALES ?? 0;
  }
  const trend: TrendPoint[] = [];
  for (let w = TREND_WEEKS - 1; w >= 0; w--) {
    const entry = byWeek[w];
    const sumTotal = Object.values(entry.perStore).reduce((a, b) => a + b, 0);
    // Apply per-week override so the trend chart agrees with the headline.
    const trendOverride = overrideForWeek(entry.sun);
    const total = trendOverride ? trendOverride.forcedGrossCents : sumTotal;
    const m = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    trend.push({
      label: `${m(entry.sun)}-${m(entry.sat)}`,
      year: entry.sun.getFullYear(),
      weekNum: sundayWeekNumber(entry.sun),
      total,
      perStore: entry.perStore,
    });
  }

  // Per-store rows
  const stores: StoreRow[] = STORES.map((s) => {
    const cur = sales.current[s.label]?.STATS ?? {};
    const prev = sales.prev[s.label]?.STATS ?? {};
    const yoy = sales.yoy[s.label]?.STATS ?? {};
    return {
      label: s.label,
      locationId: s.locationId,
      grossSales: cur.GROSS_SALES ?? 0,
      ticketCount: cur.TICKET_COUNT ?? 0,
      averageTicket: cur.AVERAGE_TICKET ?? 0,
      byPlatform: {},
      wowPct: pctChange(cur.GROSS_SALES ?? 0, prev.GROSS_SALES ?? 0),
      yoyPct: pctChange(cur.GROSS_SALES ?? 0, yoy.GROSS_SALES ?? 0),
    };
  });

  const sumGross = (b: Bucket) =>
    Object.values(sales[b]).reduce((acc, s) => acc + (s.STATS?.GROSS_SALES ?? 0), 0);
  const sumTickets = (b: Bucket) =>
    Object.values(sales[b]).reduce((acc, s) => acc + (s.STATS?.TICKET_COUNT ?? 0), 0);

  // Per-store sums (validated exactly against Dripos's Platform Sales report).
  const sumCurTotal = sumGross('current');
  const sumPrevTotal = sumGross('prev');
  const sumYoyTotal = sumGross('yoy');
  const sumCurTickets = sumTickets('current');
  const sumPrevTickets = sumTickets('prev');

  // Headline uses Dripos's chain-level gross if it came back and looks sane
  // (>= our sum, within +1% — guard against the multi-location glitch where
  // the response is wildly wrong). The diff vs the per-store sum is what we
  // surface as penny-rounding / non-product adjustments.
  const chainGross = chainCurrent.STATS?.GROSS_SALES ?? 0;
  const chainTickets = chainCurrent.STATS?.TICKET_COUNT ?? 0;
  const chainGrossUsable =
    chainGross >= sumCurTotal && chainGross <= sumCurTotal * 1.01;
  const chainTicketsUsable =
    chainTickets >= sumCurTickets && chainTickets <= sumCurTickets * 1.01;

  // Manual per-week overrides — applied to whichever bucket the affected week
  // falls into, so the same headline number is shown regardless of whether
  // you're viewing the affected week as "current" or scrolled forward and
  // it's now "prev".
  const curOverride = overrideForWeek(curSun);
  const prevOverride = overrideForWeek(prevSun);
  const yoyOverride = overrideForWeek(yoySun);

  const curTotal = curOverride
    ? curOverride.forcedGrossCents
    : chainGrossUsable
    ? chainGross
    : sumCurTotal;
  const curTickets = curOverride
    ? curOverride.forcedTickets
    : chainTicketsUsable
    ? chainTickets
    : sumCurTickets;
  const prevTotal = prevOverride ? prevOverride.forcedGrossCents : sumPrevTotal;
  const yoyTotal = yoyOverride ? yoyOverride.forcedGrossCents : sumYoyTotal;
  const prevTickets = prevOverride ? prevOverride.forcedTickets : sumPrevTickets;
  const curAvg = curTickets > 0 ? Math.round(curTotal / curTickets) : 0;
  const prevAvg = prevTickets > 0 ? Math.round(prevTotal / prevTickets) : 0;

  // The diff that lives between "what registers collected" and "what Dripos
  // shows on its Sales Summary dashboard". Negative side is the cash rounding
  // loss (registers round to nickels); positive side is custom fees and other
  // chain-level adjustments. Only meaningful for current week. Suppress when
  // a manual override is in play — the override card explains the gap instead.
  const pennyRoundingCents =
    !curOverride && chainGrossUsable ? chainGross - sumCurTotal : 0;

  const platformTotals: Record<string, number> = {
    POS: 0,
    MOBILE: 0,
    WEB: 0,
    THIRD: 0,
    KIOSK: 0,
    READER: 0,
  };
  for (const s of stores) {
    for (const [k, v] of Object.entries(s.byPlatform)) {
      platformTotals[k] = (platformTotals[k] ?? 0) + (typeof v === 'number' ? v : 0);
    }
  }

  // Per-product sales for the current week, plus per-store labor cost.
  // Both are best-effort — if either Dripos call fails we degrade to empty
  // collections rather than failing the whole report.
  const startMs = curSun.getTime();
  const endMs = endOfDayMs(curSat);
  const storeByLocId: Record<number, string> = Object.fromEntries(
    STORES.map((s) => [s.locationId, s.label]),
  );

  let bakeHausItemSales: ItemSalesRow[] = [];
  let topDrinks: ItemSalesRow[] = [];
  let platformSalesByStore: PlatformSalesRow[] = [];
  let platformSalesTotals: PlatformSalesRow = emptyPlatformRow('Chain');
  try {
    const productRows = await fetchProductSales(
      STORES.map((s) => s.locationId),
      startMs,
      endMs,
    );
    bakeHausItemSales = aggregateItems(
      productRows,
      storeByLocId,
      (r) => r.CATEGORY_NAME === 'BAKE HAUS FOOD',
    ).sort((a, b) => b.totalRevenueCents - a.totalRevenueCents);
    topDrinks = aggregateItems(
      productRows,
      storeByLocId,
      (r) => !DRINK_EXCLUDE_CATEGORIES.has(r.CATEGORY_NAME),
    )
      .sort((a, b) => b.totalRevenueCents - a.totalRevenueCents)
      .slice(0, 10);
    ({ platformSalesByStore, platformSalesTotals } = aggregatePlatformSales(productRows, storeByLocId));
  } catch (err) {
    console.error('[buildReport] productsales failed:', err);
  }

  let laborByStore: LaborRow[] = [];
  try {
    const hourlyResults = await Promise.all(
      STORES.map(async (s) => {
        try {
          const { laborCents: hourlyCents, grossSalesCents } = await fetchLaborVsSales(
            s.locationId,
            startMs,
            endMs,
          );
          return { label: s.label, locationId: s.locationId, hourlyCents, grossSalesCents };
        } catch (err) {
          console.error(`[buildReport] laborvssales ${s.label} failed:`, err);
          return null;
        }
      }),
    );
    const successful = hourlyResults.filter(
      (r): r is { label: string; locationId: number; hourlyCents: number; grossSalesCents: number } =>
        r !== null,
    );

    // Extract G4's kitchen labor from its hourly (the kitchen feeds the
    // whole chain), pool it with the salary pool, then allocate the
    // combined pool to every store by sales share. G4 keeps its FOH
    // hourly + gets its sales-share slice of the pool back.
    const chainGross = successful.reduce((a, r) => a + r.grossSalesCents, 0);
    const combinedPool =
      SALARIED_POOL_CENTS_PER_WEEK + G4_KITCHEN_OFFLOAD_CENTS_PER_WEEK;

    laborByStore = successful.map((r) => {
      const isG4 = r.label === 'G4';
      const effectiveHourly = isG4
        ? Math.max(0, r.hourlyCents - G4_KITCHEN_OFFLOAD_CENTS_PER_WEEK)
        : r.hourlyCents;
      const share = chainGross > 0 ? r.grossSalesCents / chainGross : 0;
      const salariedCents = Math.round(combinedPool * share);
      const totalLabor = effectiveHourly + salariedCents;
      return {
        label: r.label,
        locationId: r.locationId,
        laborCents: totalLabor,
        // The displayed hourly is post-kitchen-offload so the row's
        // hourly + salaried = total math actually adds up. The raw
        // Dripos number for G4 is `effectiveHourly + offload`.
        hourlyCents: effectiveHourly,
        salariedCents,
        grossSalesCents: r.grossSalesCents,
        laborPct: r.grossSalesCents > 0 ? (totalLabor / r.grossSalesCents) * 100 : null,
      };
    });
  } catch (err) {
    console.error('[buildReport] labor failed:', err);
  }

  const totalLaborCents = laborByStore.reduce((a, r) => a + r.laborCents, 0);
  const totalHourlyCents = laborByStore.reduce((a, r) => a + r.hourlyCents, 0);
  const totalSalariedCents = laborByStore.reduce((a, r) => a + r.salariedCents, 0);
  const totalLaborSalesCents = laborByStore.reduce((a, r) => a + r.grossSalesCents, 0);
  const laborTotals = {
    laborCents: totalLaborCents,
    hourlyCents: totalHourlyCents,
    salariedCents: totalSalariedCents,
    grossSalesCents: totalLaborSalesCents,
    laborPct: totalLaborSalesCents > 0 ? (totalLaborCents / totalLaborSalesCents) * 100 : null,
  };

  return {
    generatedAt: new Date().toISOString(),
    currentWeek: {
      label: fmtRange(curSun, curSat),
      year: curSun.getFullYear(),
      weekNum: sundayWeekNumber(curSun),
      sun: curSun.toISOString().slice(0, 10),
      sat: curSat.toISOString().slice(0, 10),
    },
    prevWeek: { label: fmtRange(prevSun, prevSat) },
    yoyWeek: { label: fmtRange(yoySun, yoySat) },
    totals: {
      current: curTotal,
      prev: prevTotal,
      yoy: yoyTotal,
      wowPct: pctChange(curTotal, prevTotal),
      yoyPct: pctChange(curTotal, yoyTotal),
      ticketsCurrent: curTickets,
      ticketsPrev: prevTickets,
      ticketsDelta: curTickets - prevTickets,
      avgTicketCurrent: curAvg,
      avgTicketPrev: prevAvg,
      avgTicketDelta: curAvg - prevAvg,
    },
    stores,
    platformTotals,
    trend,
    bakeHausItemSales,
    topDrinks,
    laborByStore,
    laborTotals,
    platformSalesByStore,
    platformSalesTotals,
    pennyRounding: {
      diffCents: pennyRoundingCents,
      storeSumCents: sumCurTotal,
      chainGrossCents: chainGross,
      available: chainGrossUsable,
    },
    weekOverride: curOverride
      ? {
          sun: isoLocalDate(curSun),
          reason: curOverride.reason,
          forcedGrossCents: curOverride.forcedGrossCents,
          forcedTickets: curOverride.forcedTickets,
        }
      : null,
  };
}

function emptyPlatformRow(label: string): PlatformSalesRow {
  return {
    label,
    mobileCents: 0,
    webCents: 0,
    thirdCents: 0,
    posCents: 0,
    otherCents: 0,
    totalCents: 0,
    nonPosCents: 0,
    nonPosPct: null,
  };
}

function aggregatePlatformSales(
  rows: ProductSalesRow[],
  storeByLocId: Record<number, string>,
): { platformSalesByStore: PlatformSalesRow[]; platformSalesTotals: PlatformSalesRow } {
  // GROSS_SALES on each productsales row is in cents. Group by (store, platform).
  // PLATFORM_NAME values seen: MOBILE, WEB, POS, THIRD (and KIOSK/READER if used).
  const byStore: Record<string, PlatformSalesRow> = {};
  for (const label of Object.values(storeByLocId)) byStore[label] = emptyPlatformRow(label);

  for (const r of rows) {
    if (r.LINE_ITEM_TYPE !== 'PRODUCT') continue;
    const label = storeByLocId[r.LOCATION_ID];
    if (!label) continue;
    const cents = r.GROSS_SALES ?? 0;
    const row = byStore[label];
    switch (r.PLATFORM_NAME) {
      case 'MOBILE': row.mobileCents += cents; break;
      case 'WEB': row.webCents += cents; break;
      case 'THIRD': row.thirdCents += cents; break;
      case 'POS': row.posCents += cents; break;
      default: row.otherCents += cents; break;
    }
  }

  const finalize = (row: PlatformSalesRow): PlatformSalesRow => {
    row.nonPosCents = row.mobileCents + row.webCents + row.thirdCents;
    row.totalCents = row.nonPosCents + row.posCents + row.otherCents;
    row.nonPosPct = row.totalCents > 0 ? (row.nonPosCents / row.totalCents) * 100 : null;
    return row;
  };

  const platformSalesByStore = Object.values(byStore).map(finalize);
  const totals = emptyPlatformRow('Chain');
  for (const r of platformSalesByStore) {
    totals.mobileCents += r.mobileCents;
    totals.webCents += r.webCents;
    totals.thirdCents += r.thirdCents;
    totals.posCents += r.posCents;
    totals.otherCents += r.otherCents;
  }
  return { platformSalesByStore, platformSalesTotals: finalize(totals) };
}

// ── Hours Watch: rolling 12-month per-employee hours ──────────────────────
// /report/timesheets returns each clocked shift with its ROLE_NAME tagged.
// We pull it week-by-week (52 weeks), filter out training / pure-management
// roles per QSEHRA tracking rules, and roll up per-employee weekly hours.

interface RawTimesheet {
  EMPLOYEE_ID: number;
  FULL_NAME: string;
  ROLE_NAME: string | null;
  LOCATION_ID: number;
  AMOUNT_TOTAL_MINUTES: number;
  SHIFT_DATE_START?: number | null;
  DATE_START?: number | null;
}

/**
 * Should this shift's role be counted toward the 30-hr/wk QSEHRA threshold?
 * Excludes training, admin/owner, and non-shift management roles. Everything
 * else (Barista, Shift Manager, Baker, Kitchen, Delivery Driver, etc.)
 * counts.
 */
export function isCountedRole(roleName: string | null | undefined): boolean {
  if (!roleName) return false;
  const lower = roleName.toLowerCase();
  if (lower.includes('training')) return false;
  if (lower.includes('admin')) return false;
  if (lower.includes('owner')) return false;
  // "Shift Manager" counts; "General Manager" / "Manager" alone does not.
  if (lower.includes('manager') && !lower.includes('shift')) return false;
  return true;
}

interface RawEmployee {
  ID: number;
  FULL_NAME?: string | null;
  DATE_STARTED?: number | null;
  ACTIVE?: number;
}

/**
 * Pull the full employee directory. Used to look up each person's hire
 * date so the rolling-avg denominator can be capped to weeks-since-hire
 * (a new hire averaging 40 hr/wk for 6 months reads as 40, not 20). Cached
 * for an hour — employee records don't change that often.
 */
export async function fetchEmployeeDirectory(): Promise<Map<number, { fullName: string; dateStartedMs: number | null }>> {
  const oneHourFromNow = Date.now() + 60 * 60 * 1000;
  const rows = await cached<RawEmployee[]>(
    'employees|directory',
    oneHourFromNow,
    async () => {
      // Header location is required by callApi; the /employees endpoint
      // returns the full chain-wide directory regardless of which store
      // we pass.
      const body = await callApi<RawEmployee[]>('/employees', {
        locationId: STORES[0].locationId,
      });
      return (body.data ?? []) as RawEmployee[];
    },
  );
  const map = new Map<number, { fullName: string; dateStartedMs: number | null }>();
  for (const r of rows) {
    if (r.ID == null) continue;
    map.set(r.ID, {
      fullName: r.FULL_NAME ?? `Employee ${r.ID}`,
      dateStartedMs: r.DATE_STARTED ?? null,
    });
  }
  return map;
}

interface TimesheetsCell {
  shifts: RawTimesheet[];
  /** From the TOTALS object on /report/timesheets — what the schedule
   *  called for this week at this location. Used as the "scheduled
   *  hours" demand baseline for Hiring Needs. */
  scheduledMinutes: number;
}

async function fetchTimesheetsRaw(
  startMs: number,
  endMs: number,
  locationId: number,
): Promise<RawTimesheet[]> {
  const cell = await fetchTimesheetsCell(startMs, endMs, locationId);
  return cell.shifts;
}

async function fetchTimesheetsCell(
  startMs: number,
  endMs: number,
  locationId: number,
): Promise<TimesheetsCell> {
  // v2 cache key: previous rows only stored shifts; we now also persist
  // scheduledMinutes from TOTALS so Hiring Needs has a demand baseline
  // without a second Dripos call.
  return cached(
    `report/timesheets|v2|${locationId}|${startMs}|${endMs}`,
    endMs,
    async () => {
      const body = await callApi<{
        ALL_TIMESHEETS?: RawTimesheet[];
        TOTALS?: { AMOUNT_MINUTES_SCHEDULED?: number };
      }>(
        '/report/timesheets',
        {
          method: 'POST',
          locationId,
          body: {
            START_EPOCH: startMs,
            END_EPOCH: endMs,
            LOCATION_ID_ARRAY: [locationId],
            TIP_CALCULATION_METHOD: 'DAILY',
          },
        },
      );
      const rows = body.data?.ALL_TIMESHEETS ?? [];
      const scheduledMinutes = body.data?.TOTALS?.AMOUNT_MINUTES_SCHEDULED ?? 0;
      return {
        shifts: rows.map((r) => ({
          EMPLOYEE_ID: r.EMPLOYEE_ID,
          FULL_NAME: r.FULL_NAME,
          ROLE_NAME: r.ROLE_NAME ?? null,
          LOCATION_ID: r.LOCATION_ID,
          AMOUNT_TOTAL_MINUTES: r.AMOUNT_TOTAL_MINUTES ?? 0,
          SHIFT_DATE_START: r.SHIFT_DATE_START ?? r.DATE_START ?? null,
        })),
        scheduledMinutes,
      };
    },
  );
}

export interface EmployeeWeekHours {
  employeeId: number;
  fullName: string;
  primaryStore: string;
  weeklyHours: number[];  // length 52, oldest → newest
  totalHours: number;
  weeksWithHours: number;
  rollingAvg: number;     // total / min(52, weeksSinceHire)
  last4WkAvg: number;
  last13WkAvg: number;
  /** Epoch ms of the hire date per Dripos /employees DATE_STARTED, if known. */
  dateStartedMs: number | null;
  /** Weeks elapsed between hire date and the end of the window. Capped at 52
   *  for the rolling-avg denominator but reported uncapped here so the UI
   *  can show "1y 4w" type tenure strings. */
  weeksSinceHire: number | null;
}

export interface EmployeeHoursReport {
  generatedAt: number;
  windowStartMs: number;
  windowEndMs: number;
  weekStartsMs: number[]; // length 52, oldest Sun → newest Sun
  weeksFetched: number;
  weeksFailed: number;
  employees: EmployeeWeekHours[];
}

const STORE_BY_LOCATION_ID: Record<number, string> = Object.fromEntries(
  STORES.map((s) => [s.locationId, s.label]),
);

/**
 * Build a rolling 52-week per-employee hours report. Pulls each Sun–Sat
 * week one at a time so the per-week response stays under Dripos's 60s
 * timeout, and so completed weeks cache forever (only the current week
 * has a short TTL).
 */
export async function buildEmployeeHoursReport(
  referenceDate: Date = new Date(),
): Promise<EmployeeHoursReport> {
  const NUM_WEEKS = 52;
  // Anchor on the most-recently-completed Sun, then walk back 51 more
  // weeks. The current in-progress week is week-index 52 (1 extra) so we
  // can show partial in-progress hours alongside the rolling history.
  const weekStarts: Date[] = [];
  for (let i = NUM_WEEKS - 1; i >= 0; i--) {
    const [sun] = weekBounds(referenceDate, i);
    weekStarts.push(sun);
  }

  const perEmpWeek = new Map<number, { name: string; storeCounts: Record<string, number>; hours: number[] }>();

  // Kick off the employee directory pull in parallel with the timesheets —
  // it's a single cheap call so it'll finish first, but starting it now
  // saves a round trip at the end.
  const directoryPromise = fetchEmployeeDirectory().catch((err) => {
    console.warn('[employee-hours] directory fetch failed:', err instanceof Error ? err.message : err);
    return new Map<number, { fullName: string; dateStartedMs: number | null }>();
  });

  // Fan out as 52 weeks × 4 stores = 208 small calls. Each single-week-
  // single-store request returns in ~2s; bundling weeks or stores together
  // scales linearly with data volume (a 4-week-4-store request took 58s in
  // testing) so MANY SMALL CALLS WIN. The cached() layer dedupes inside a
  // request and persists each cell forever once successful, so subsequent
  // page loads pull from SQLite (~ms) instead of Dripos. allSettled keeps
  // one bad cell from tanking the whole report.
  const cells: Array<{ weekIdx: number; locationId: number }> = [];
  for (let i = 0; i < weekStarts.length; i++) {
    for (const store of STORES) {
      cells.push({ weekIdx: i, locationId: store.locationId });
    }
  }
  const cellResults = await Promise.allSettled(
    cells.map(({ weekIdx, locationId }) => {
      const sun = weekStarts[weekIdx];
      const sat = new Date(sun);
      sat.setDate(sun.getDate() + 6);
      sat.setHours(23, 59, 59, 999);
      return fetchTimesheetsCell(sun.getTime(), sat.getTime(), locationId);
    }),
  );
  const weekShifts: RawTimesheet[][] = Array.from({ length: NUM_WEEKS }, () => []);
  const weekStatus: Array<{ ok: number; failed: number }> = Array.from(
    { length: NUM_WEEKS }, () => ({ ok: 0, failed: 0 }),
  );
  // Per-week × per-store scheduled minutes (for Hiring Needs demand baseline)
  const scheduledByLoc = new Map<number, number[]>();
  for (const store of STORES) {
    scheduledByLoc.set(store.locationId, new Array(NUM_WEEKS).fill(0));
  }
  for (let i = 0; i < cells.length; i++) {
    const r = cellResults[i];
    const { weekIdx, locationId } = cells[i];
    if (r.status === 'fulfilled') {
      weekShifts[weekIdx].push(...r.value.shifts);
      scheduledByLoc.get(locationId)![weekIdx] = r.value.scheduledMinutes;
      weekStatus[weekIdx].ok++;
    } else {
      weekStatus[weekIdx].failed++;
    }
  }
  // A week is "fetched" only if all 4 stores returned (so the rolling avg
  // for that week is complete). One bad store turns the whole week into a
  // failed week for accounting purposes.
  const weeksFetched = weekStatus.filter((w) => w.failed === 0).length;
  const weeksFailed = NUM_WEEKS - weeksFetched;
  if (weeksFailed > 0) {
    console.warn(`[employee-hours] ${weeksFailed}/${NUM_WEEKS} weeks had at least one store fail`);
  }

  for (let i = 0; i < weekShifts.length; i++) {
    for (const s of weekShifts[i]) {
      if (!isCountedRole(s.ROLE_NAME)) continue;
      const mins = s.AMOUNT_TOTAL_MINUTES || 0;
      if (mins <= 0) continue;
      let row = perEmpWeek.get(s.EMPLOYEE_ID);
      if (!row) {
        row = { name: s.FULL_NAME, storeCounts: {}, hours: new Array(NUM_WEEKS).fill(0) };
        perEmpWeek.set(s.EMPLOYEE_ID, row);
      }
      row.hours[i] += mins / 60;
      const storeLabel = STORE_BY_LOCATION_ID[s.LOCATION_ID];
      if (storeLabel) {
        row.storeCounts[storeLabel] = (row.storeCounts[storeLabel] ?? 0) + mins;
      }
    }
  }

  const directory = await directoryPromise;
  // Anchor "now" at the END of the most-recent week we're tracking so
  // weeksSinceHire is stable across cache refreshes on the same window.
  const windowEndMs = weekStarts[weekStarts.length - 1].getTime() + 7 * 24 * 60 * 60 * 1000 - 1;
  const employees: EmployeeWeekHours[] = [];
  for (const [empId, row] of perEmpWeek) {
    const totalHours = row.hours.reduce((a, b) => a + b, 0);
    const weeksWithHours = row.hours.filter((h) => h > 0).length;
    const dirEntry = directory.get(empId);
    const dateStartedMs = dirEntry?.dateStartedMs ?? null;
    const weeksSinceHire = dateStartedMs != null
      ? Math.max(1, Math.floor((windowEndMs - dateStartedMs) / (7 * 24 * 60 * 60 * 1000)))
      : null;
    // Denominator: weeks elapsed since hire, capped at the rolling window
    // length. New hires with < 52 weeks of tenure don't get diluted by
    // pre-hire zero weeks — matches how QSEHRA's "customary weekly
    // employment" is read in practice.
    const rollingDenom = weeksSinceHire != null
      ? Math.min(NUM_WEEKS, weeksSinceHire)
      : NUM_WEEKS;
    const rollingAvg = totalHours / rollingDenom;
    const last4 = row.hours.slice(-4);
    const last4Denom = weeksSinceHire != null ? Math.min(4, weeksSinceHire) : 4;
    const last4WkAvg = last4.reduce((a, b) => a + b, 0) / last4Denom;
    const last13 = row.hours.slice(-13);
    const last13Denom = weeksSinceHire != null ? Math.min(13, weeksSinceHire) : 13;
    const last13WkAvg = last13.reduce((a, b) => a + b, 0) / last13Denom;
    const primaryStore = Object.entries(row.storeCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
    employees.push({
      employeeId: empId,
      fullName: dirEntry?.fullName ?? row.name,
      primaryStore,
      weeklyHours: row.hours.map((h) => Math.round(h * 100) / 100),
      totalHours: Math.round(totalHours * 100) / 100,
      weeksWithHours,
      rollingAvg: Math.round(rollingAvg * 100) / 100,
      last4WkAvg: Math.round(last4WkAvg * 100) / 100,
      last13WkAvg: Math.round(last13WkAvg * 100) / 100,
      dateStartedMs,
      weeksSinceHire,
    });
  }

  employees.sort((a, b) => b.rollingAvg - a.rollingAvg);

  return {
    generatedAt: Date.now(),
    windowStartMs: weekStarts[0].getTime(),
    windowEndMs: weekStarts[weekStarts.length - 1].getTime() + 7 * 24 * 60 * 60 * 1000 - 1,
    weekStartsMs: weekStarts.map((d) => d.getTime()),
    weeksFetched,
    weeksFailed,
    employees,
  };
}

/**
 * Kick off a full 52-week pull in the background and discard the result.
 * The act of running it populates dripos_cache with every (week × store)
 * cell, so the next HTTP request to /api/dripos/employee-hours reads from
 * SQLite in milliseconds. Safe to call multiple times — already-cached
 * cells short-circuit instantly. Errors are logged but never thrown so
 * this won't crash the process when called fire-and-forget.
 */
// ── Hiring Needs (capacity planning) ─────────────────────────────────────
// Per-store: average scheduled hr/wk × 1.15 buffer (call-off factor)
// minus sum of barista preferred hours = gap. Divided by 30 hr/wk to
// estimate hires needed.

export const HIRING_BUFFER = 1.1;
export const HIRES_TARGET_HRS_PER_WK = 30;

interface PrefRow {
  employee_id: number;
  preferred_hours_per_week: number | null;
  notes: string | null;
}

export interface StaffingBarista {
  employeeId: number;
  fullName: string;
  primaryStore: string;
  tenureWeeks: number | null;
  last4WkAvg: number;
  last6WkAvg: number;
  last13WkAvg: number;
  /** User-set preferred hours from DB. null = never set; UI falls back to
   *  last6WkAvg as the suggested default. */
  preferredHours: number | null;
  notes: string | null;
}

export interface StaffingStoreSummary {
  storeLabel: string;
  /** Scheduled hours per week, averaged over last 4 weeks (from
   *  AMOUNT_MINUTES_SCHEDULED in /report/timesheets totals). */
  scheduledHoursPerWk: number;
  /** scheduledHoursPerWk × 1.15 — the "true demand" once call-offs and
   *  shift swaps are factored in. */
  targetWithBuffer: number;
  /** Sum of preferred (or suggested) hours across baristas tagged to
   *  this store. Suggested = last 6 wk avg when no preference is set. */
  sumPreferredHours: number;
  gapHours: number;
  hiresNeeded: number;
  baristaCount: number;
}

export interface StaffingHiringNeedsReport {
  generatedAt: number;
  buffer: number;
  hiresTargetHrsPerWk: number;
  baristas: StaffingBarista[];
  byStore: StaffingStoreSummary[];
}

/**
 * Aggregate per-store hiring-needs report. Reuses the same per-week
 * Dripos cache as Hours Watch, so this is fast once the cache is warm.
 */
export async function buildHiringNeedsReport(
  referenceDate: Date = new Date(),
): Promise<StaffingHiringNeedsReport> {
  // Pull the full 52-week report (cached) so we get last-4 / last-6 /
  // last-13 averages and the primary-store assignment for free.
  const hoursReport = await buildEmployeeHoursReport(referenceDate);

  // Re-pull just the last 4 weeks of demand per store. The cells are
  // already cached from buildEmployeeHoursReport. We compute demand from
  // per-shift minutes filtered by isCountedRole, NOT from the gross
  // AMOUNT_MINUTES_SCHEDULED total (which would lump training and
  // pure-management shifts into the demand baseline — those aren't
  // shifts we're trying to staff baristas for).
  const SCHED_LOOKBACK_WEEKS = 4;
  const scheduledByStore: Record<string, number[]> = {};
  for (const store of STORES) scheduledByStore[store.label] = [];
  const lookbackPromises: Array<Promise<void>> = [];
  for (let i = 0; i < SCHED_LOOKBACK_WEEKS; i++) {
    const [sun] = weekBounds(referenceDate, i);
    const sat = new Date(sun);
    sat.setDate(sun.getDate() + 6);
    sat.setHours(23, 59, 59, 999);
    for (const store of STORES) {
      lookbackPromises.push(
        fetchTimesheetsCell(sun.getTime(), sat.getTime(), store.locationId)
          .then((cell) => {
            const countedMinutes = cell.shifts
              .filter((s) => isCountedRole(s.ROLE_NAME))
              .reduce((sum, s) => sum + (s.AMOUNT_TOTAL_MINUTES ?? 0), 0);
            scheduledByStore[store.label].push(countedMinutes);
          })
          .catch(() => { scheduledByStore[store.label].push(0); }),
      );
    }
  }
  await Promise.all(lookbackPromises);

  // Load saved preferences from SQLite.
  const prefRows = db.prepare(
    'SELECT employee_id, preferred_hours_per_week, notes FROM employee_preferences',
  ).all() as PrefRow[];
  const prefMap = new Map<number, PrefRow>();
  for (const r of prefRows) prefMap.set(r.employee_id, r);

  // Build per-barista rows. last6WkAvg is computed from the weekly hours
  // array we already have — slice the last 6 and average with the tenure
  // cap.
  const baristas: StaffingBarista[] = hoursReport.employees.map((e) => {
    const last6 = e.weeklyHours.slice(-6);
    const last6Denom = e.weeksSinceHire != null ? Math.min(6, e.weeksSinceHire) : 6;
    const last6WkAvg = last6.reduce((a, b) => a + b, 0) / Math.max(1, last6Denom);
    const pref = prefMap.get(e.employeeId);
    return {
      employeeId: e.employeeId,
      fullName: e.fullName,
      primaryStore: e.primaryStore,
      tenureWeeks: e.weeksSinceHire,
      last4WkAvg: e.last4WkAvg,
      last6WkAvg: Math.round(last6WkAvg * 100) / 100,
      last13WkAvg: e.last13WkAvg,
      preferredHours: pref?.preferred_hours_per_week ?? null,
      notes: pref?.notes ?? null,
    };
  });

  // Per-store summary.
  const byStore: StaffingStoreSummary[] = STORES.map((store) => {
    const sched = scheduledByStore[store.label] ?? [];
    const validSched = sched.filter((s) => s > 0);
    const scheduledHoursPerWk = validSched.length > 0
      ? validSched.reduce((a, b) => a + b, 0) / validSched.length / 60
      : 0;
    const targetWithBuffer = scheduledHoursPerWk * HIRING_BUFFER;
    // For employees with no explicit preference, use last 6 wk avg as the
    // suggested baseline (matches Ben's "pre-seed with 6-wk avg" call).
    const here = baristas.filter((b) => b.primaryStore === store.label);
    const sumPreferredHours = here.reduce(
      (sum, b) => sum + (b.preferredHours ?? b.last6WkAvg),
      0,
    );
    const gapHours = targetWithBuffer - sumPreferredHours;
    const hiresNeeded = gapHours > 0
      ? Math.ceil(gapHours / HIRES_TARGET_HRS_PER_WK)
      : 0;
    return {
      storeLabel: store.label,
      scheduledHoursPerWk: Math.round(scheduledHoursPerWk * 10) / 10,
      targetWithBuffer: Math.round(targetWithBuffer * 10) / 10,
      sumPreferredHours: Math.round(sumPreferredHours * 10) / 10,
      gapHours: Math.round(gapHours * 10) / 10,
      hiresNeeded,
      baristaCount: here.length,
    };
  });

  return {
    generatedAt: Date.now(),
    buffer: HIRING_BUFFER,
    hiresTargetHrsPerWk: HIRES_TARGET_HRS_PER_WK,
    baristas,
    byStore,
  };
}

export function setEmployeePreference(
  employeeId: number,
  preferredHours: number | null,
  notes: string | null = null,
): void {
  db.prepare(
    `INSERT INTO employee_preferences (employee_id, preferred_hours_per_week, notes, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(employee_id) DO UPDATE SET
       preferred_hours_per_week = excluded.preferred_hours_per_week,
       notes = COALESCE(excluded.notes, employee_preferences.notes),
       updated_at = excluded.updated_at`,
  ).run(employeeId, preferredHours, notes, Date.now());
}

let prewarmInFlight: Promise<void> | null = null;
export function prewarmEmployeeHours(): Promise<void> {
  if (prewarmInFlight) return prewarmInFlight;
  prewarmInFlight = (async () => {
    const startedAt = Date.now();
    try {
      const report = await buildEmployeeHoursReport();
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `[prewarm-hours] done in ${elapsed}s — ${report.weeksFetched}/${report.weeksFetched + report.weeksFailed} weeks, ${report.employees.length} employees`,
      );
    } catch (err) {
      console.warn('[prewarm-hours] failed:', err instanceof Error ? err.message : err);
    } finally {
      prewarmInFlight = null;
    }
  })();
  return prewarmInFlight;
}
