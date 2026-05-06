/**
 * Dripos private API client (Node) — first-party use of the Germania
 * shops' own data. Ported from /home/wolfgang/dripos/dripos.py.
 */
import db from './db.js';

const BASE_URL = 'https://api.dripos.com';

// G1-G4 → numeric Dripos LOCATION_IDs. (Loc 1082 is a separate site that
// doesn't appear in the weekly G1-G4 report, so we exclude it here.)
export const STORES: Array<{ label: string; locationId: number }> = [
  { label: 'G1', locationId: 131 },
  { label: 'G2', locationId: 132 },
  { label: 'G3', locationId: 133 },
  { label: 'G4', locationId: 134 },
];

export const BAKE_HAUS_CATEGORY = 'BAKE HAUS FOOD';

// Dripos signals auth failures with HTTP 200 + success:false + error:SESSION_INVALID.
const AUTH_ERRORS = new Set(['SESSION_INVALID', 'AUTH_INVALID', 'TOKEN_EXPIRED', 'FORBIDDEN']);

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
    headers.location = String(opts.locationId);
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

  const r = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (r.status === 401 || r.status === 403) {
    throw new AuthExpired(`HTTP ${r.status}`);
  }

  let body: DriposResponse<T>;
  try {
    body = (await r.json()) as DriposResponse<T>;
  } catch {
    throw new Error(`Non-JSON response from Dripos: HTTP ${r.status}`);
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
  // JS: Sunday=0, Mon=1, ..., Sat=6. Days since most recent Saturday:
  const daysSinceSat = (t.getDay() + 1) % 7;
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

// ── Endpoint helpers ──────────────────────────────────────────────────────
interface DashboardSalesData {
  STATS?: {
    GROSS_SALES?: number;
    TICKET_COUNT?: number;
    AVERAGE_TICKET?: number;
    AMOUNT_REFUNDED?: number;
    TICKETS_REFUNDED?: number;
  };
  SALES_BY_PLATFORM?: Record<string, number>;
  SALES_BY_ORDER_TYPE?: Record<string, number>;
  SALES_BY_PAYMENT_TYPE?: Record<string, number>;
}

export async function fetchDashboardSales(
  locationId: number,
  sun: Date,
  sat: Date,
): Promise<DashboardSalesData> {
  const start = startOfDayMs(sun);
  const end = endOfDayMs(sat);
  const body = await callApi<DashboardSalesData>('/dashboard/sales', {
    locationId,
    query: { DATE_START: start, DATE_END: end },
  });
  const data = (body.data ?? {}) as DashboardSalesData;
  // TEMP: unconditional one-line debug to trace prod-zero issue. Removed
  // once we identify whether Dripos returns empty STATS or our extraction
  // misses the values.
  const stats = data.STATS ?? {};
  console.log(
    `[dripos:dashboard/sales] loc=${locationId} ${new Date(start).toISOString().slice(0,10)}..${new Date(end).toISOString().slice(0,10)} ` +
    `success=${(body as { success?: boolean }).success} ` +
    `gross=${stats.GROSS_SALES ?? '∅'} tickets=${stats.TICKET_COUNT ?? '∅'} ` +
    `body_keys=${Object.keys((body as object) ?? {}).join(',')}`,
  );
  return data;
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
  const body = await callApi<unknown>('/login/complete', {
    method: 'POST',
    body: {
      TOKEN: args.code,
      UNIQUE: args.unique,
      CLIENT: {
        NAME: 'dashboard.dripos.com',
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
  laborCents: number;
  grossSalesCents: number;
  laborPct: number | null;
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
}

const DRINK_EXCLUDE_CATEGORIES = new Set(['BAKE HAUS FOOD', 'PETS']);

async function fetchProductSales(
  locationIds: number[],
  startMs: number,
  endMs: number,
): Promise<ProductSalesRow[]> {
  // The /report/productsales endpoint requires the location header (numeric
  // string accepted) but accepts a multi-location LOCATION_ID_ARRAY in the
  // body, so a single call covers all 4 stores.
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
        SELECTED_PLATFORMS_ARRAY: [
          { PLATFORM: 'MOBILE', THIRD: false },
          { PLATFORM: 'WEB', THIRD: false },
          { PLATFORM: 'POS', THIRD: false },
          { PLATFORM: 'KIOSK', THIRD: false },
          { PLATFORM: 'READER', THIRD: false },
          { PLATFORM: 'THIRD', THIRD: true },
        ],
        SELECTED_TAGS_ARRAY: [],
      },
    },
  );
  return body.data?.LINE_ITEM_RECORDS ?? [];
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
  laborTotals: { laborCents: number; grossSalesCents: number; laborPct: number | null };
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
    const total = Object.values(entry.perStore).reduce((a, b) => a + b, 0);
    const m = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    trend.unshift({
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
      byPlatform: sales.current[s.label]?.SALES_BY_PLATFORM ?? {},
      wowPct: pctChange(cur.GROSS_SALES ?? 0, prev.GROSS_SALES ?? 0),
      yoyPct: pctChange(cur.GROSS_SALES ?? 0, yoy.GROSS_SALES ?? 0),
    };
  });

  const sumGross = (b: Bucket) =>
    Object.values(sales[b]).reduce((acc, s) => acc + (s.STATS?.GROSS_SALES ?? 0), 0);
  const sumTickets = (b: Bucket) =>
    Object.values(sales[b]).reduce((acc, s) => acc + (s.STATS?.TICKET_COUNT ?? 0), 0);

  const curTotal = sumGross('current');
  const prevTotal = sumGross('prev');
  const yoyTotal = sumGross('yoy');
  const curTickets = sumTickets('current');
  const prevTickets = sumTickets('prev');
  const curAvg = curTickets > 0 ? Math.round(curTotal / curTickets) : 0;
  const prevAvg = prevTickets > 0 ? Math.round(prevTotal / prevTickets) : 0;

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
  } catch (err) {
    console.error('[buildReport] productsales failed:', err);
  }

  let laborByStore: LaborRow[] = [];
  try {
    const laborResults = await Promise.all(
      STORES.map(async (s) => {
        try {
          const { laborCents, grossSalesCents } = await fetchLaborVsSales(
            s.locationId,
            startMs,
            endMs,
          );
          return {
            label: s.label,
            locationId: s.locationId,
            laborCents,
            grossSalesCents,
            laborPct: grossSalesCents > 0 ? (laborCents / grossSalesCents) * 100 : null,
          } as LaborRow;
        } catch (err) {
          console.error(`[buildReport] laborvssales ${s.label} failed:`, err);
          return null;
        }
      }),
    );
    laborByStore = laborResults.filter((r): r is LaborRow => r !== null);
  } catch (err) {
    console.error('[buildReport] labor failed:', err);
  }

  const totalLaborCents = laborByStore.reduce((a, r) => a + r.laborCents, 0);
  const totalLaborSalesCents = laborByStore.reduce((a, r) => a + r.grossSalesCents, 0);
  const laborTotals = {
    laborCents: totalLaborCents,
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
  };
}
