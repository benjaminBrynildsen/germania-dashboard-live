/**
 * Patron data — pulled from Dripos's /patrons/dumb/v2 endpoint on a
 * schedule + on demand. Drives the Patrons dashboard:
 *
 *   - Overview: new-patron counts, top customers by spend / visits,
 *     top customer of the week
 *   - Funnel:   Jon Taffer-style retention funnel (1→2, 2→3, 3→4)
 *   - By Location: same metrics split G1/G2/G3/G4
 *
 * Sync replaces the local table wholesale on each run — the Dripos
 * patron list is the source of truth, and Dripos provides stable IDs.
 */
import db from './db.js';
import { callApi, STORES, AuthExpired, NoToken } from './dripos.js';

interface RawPatron {
  ID: number;
  UNIQUE_ID?: string | null;
  FULL_NAME?: string | null;
  EMAIL?: string | null;
  PHONE?: string | null;
  LOCATION_ID?: number | null;
  DATE_CREATED?: number | null;
  LAST_SEEN?: number | null;
  LIFETIME?: number | null;
  TICKETS?: number | null;
  TOTAL_SPEND?: number | null;        // cents
  TOTAL_TIPS?: number | null;         // cents
  AVERAGE_TICKET?: number | null;     // cents
  AVERAGE_TIP?: number | null;        // cents
  POINTS?: number | null;
  TEXT_SUBSCRIBED?: number | boolean | null;
  EMAIL_SUBSCRIBED?: number | boolean | null;
  BIRTH_MONTH?: number | null;
  BIRTH_DAY?: number | null;
  BIRTH_YEAR?: number | null;
  DATE_ARCHIVED?: number | null;
}

interface PatronPageResponse {
  data?: RawPatron[];
  page?: number;
  limit?: number;
  totalCount?: number;
  hasMore?: boolean;
}

const PAGE_SIZE = 1000; // limit per Dripos call; tested up to 2000 safely

async function fetchPatronPage(page: number): Promise<PatronPageResponse> {
  const body = await callApi<PatronPageResponse>(
    `/patrons/dumb/v2?search=&page=${page}&limit=${PAGE_SIZE}&includeTotalCount=true`,
    { locationId: STORES[0].locationId },
  );
  return body.data ?? {};
}

export interface SyncResult {
  ok: boolean;
  count: number;
  totalInDripos: number;
  elapsedMs: number;
  error?: string;
}

let syncInFlight: Promise<SyncResult> | null = null;

/**
 * Pull every patron from Dripos and replace the local table. Cached
 * in-flight so concurrent calls share a single sync. ~50k patrons at
 * 1000/page = ~50 sequential calls. With Dripos's per-call overhead
 * (~1-2s) it's a one-shot operation taking ~60-90s on cold sync;
 * subsequent calls just refresh.
 */
export async function syncAllPatrons(): Promise<SyncResult> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async (): Promise<SyncResult> => {
    const startedAt = Date.now();
    let totalInDripos = 0;
    const all: RawPatron[] = [];
    try {
      // First page tells us the total, then we sequence the rest. We
      // could parallelize but Dripos's per-call overhead seems linear
      // with size — better to keep pages large + sequential than fan
      // out 50 small requests.
      let page = 1;
      const first = await fetchPatronPage(page);
      totalInDripos = first.totalCount ?? 0;
      if (first.data) all.push(...first.data);
      while (first.hasMore && all.length < totalInDripos) {
        page += 1;
        const next = await fetchPatronPage(page);
        if (!next.data || next.data.length === 0) break;
        all.push(...next.data);
        if (!next.hasMore) break;
        if (page > 500) break; // safety stop
      }

      // Replace the table in a single transaction.
      const insert = db.prepare(
        `INSERT INTO patrons (
           dripos_id, unique_id, full_name, email, phone,
           location_id, date_created_ms, last_seen_ms,
           lifetime, tickets,
           total_spend_cents, total_tips_cents,
           average_ticket_cents, average_tip_cents,
           points, text_subscribed, email_subscribed,
           birth_month, birth_day, birth_year, date_archived_ms
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      const replaceAll = db.transaction((rows: RawPatron[]) => {
        db.prepare('DELETE FROM patrons').run();
        for (const r of rows) {
          if (r.ID == null) continue;
          insert.run(
            r.ID,
            r.UNIQUE_ID ?? null,
            r.FULL_NAME ?? null,
            r.EMAIL ?? null,
            r.PHONE ?? null,
            r.LOCATION_ID ?? null,
            r.DATE_CREATED ?? null,
            r.LAST_SEEN ?? null,
            r.LIFETIME ?? 0,
            r.TICKETS ?? 0,
            r.TOTAL_SPEND ?? null,
            r.TOTAL_TIPS ?? null,
            r.AVERAGE_TICKET ?? null,
            r.AVERAGE_TIP ?? null,
            r.POINTS ?? null,
            toBool01(r.TEXT_SUBSCRIBED),
            toBool01(r.EMAIL_SUBSCRIBED),
            r.BIRTH_MONTH ?? null,
            r.BIRTH_DAY ?? null,
            r.BIRTH_YEAR ?? null,
            r.DATE_ARCHIVED ?? null,
          );
        }
        db.prepare(
          `UPDATE patrons_sync_meta SET
             last_synced_at = ?,
             last_sync_count = ?,
             last_sync_total_in_dripos = ?,
             last_sync_status = 'ok',
             last_sync_error = NULL
           WHERE id = 1`,
        ).run(Date.now(), rows.length, totalInDripos);
      });
      replaceAll(all);

      return {
        ok: true,
        count: all.length,
        totalInDripos,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAuth = err instanceof AuthExpired || err instanceof NoToken;
      db.prepare(
        `UPDATE patrons_sync_meta SET
           last_sync_status = ?,
           last_sync_error = ?
         WHERE id = 1`,
      ).run(isAuth ? 'auth' : 'error', msg);
      return {
        ok: false,
        count: 0,
        totalInDripos,
        elapsedMs: Date.now() - startedAt,
        error: msg,
      };
    } finally {
      syncInFlight = null;
    }
  })();
  return syncInFlight;
}

function toBool01(v: unknown): number {
  if (v === true || v === 1 || v === '1') return 1;
  return 0;
}

// ─── Reports ────────────────────────────────────────────────────────

const STORE_LABEL_BY_ID: Record<number, string> = Object.fromEntries(
  STORES.map((s) => [s.locationId, s.label]),
);

export interface SyncMeta {
  lastSyncedAt: number | null;
  lastSyncCount: number | null;
  lastSyncTotalInDripos: number | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
}

export function getSyncMeta(): SyncMeta {
  const row = db.prepare(
    `SELECT last_synced_at, last_sync_count, last_sync_total_in_dripos,
            last_sync_status, last_sync_error
       FROM patrons_sync_meta WHERE id = 1`,
  ).get() as any;
  return {
    lastSyncedAt: row?.last_synced_at ?? null,
    lastSyncCount: row?.last_sync_count ?? null,
    lastSyncTotalInDripos: row?.last_sync_total_in_dripos ?? null,
    lastSyncStatus: row?.last_sync_status ?? null,
    lastSyncError: row?.last_sync_error ?? null,
  };
}

export interface TopPatron {
  driposId: number;
  uniqueId: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  primaryStore: string | null;
  lifetime: number;
  totalSpendCents: number;
  averageTicketCents: number | null;
  lastSeenMs: number | null;
  dateCreatedMs: number | null;
}

export interface OverviewReport {
  sync: SyncMeta;
  totalPatrons: number;
  totalArchived: number;
  totalActive: number;            // not archived
  textSubscribed: number;
  emailSubscribed: number;

  // New patron counts
  newThisWeek: number;
  newThisMonth: number;
  newThisYear: number;
  newLifetime: number;            // = totalActive

  // Per-store first-seen breakdown
  byLocation: Array<{
    storeLabel: string;
    totalPatrons: number;
    newThisWeek: number;
    newThisMonth: number;
    activeThisWeek: number;       // last_seen within past 7 days
    topByVisits: TopPatron | null;
    topBySpend: TopPatron | null;
  }>;

  // Top tens (chain-wide)
  topByVisits: TopPatron[];
  topBySpend: TopPatron[];

  // Top customer this week (highest lifetime spend among those seen this week)
  topThisWeek: TopPatron | null;
  seenThisWeek: number;
}

interface PatronRow {
  dripos_id: number;
  unique_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location_id: number | null;
  date_created_ms: number | null;
  last_seen_ms: number | null;
  lifetime: number;
  tickets: number;
  total_spend_cents: number | null;
  average_ticket_cents: number | null;
  text_subscribed: number;
  email_subscribed: number;
  date_archived_ms: number | null;
}

function rowToTop(r: PatronRow): TopPatron {
  return {
    driposId: r.dripos_id,
    uniqueId: r.unique_id,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    primaryStore: r.location_id != null ? STORE_LABEL_BY_ID[r.location_id] ?? null : null,
    lifetime: r.lifetime,
    totalSpendCents: r.total_spend_cents ?? 0,
    averageTicketCents: r.average_ticket_cents,
    lastSeenMs: r.last_seen_ms,
    dateCreatedMs: r.date_created_ms,
  };
}

function startOfWeek(d: Date): Date {
  const local = new Date(d);
  local.setHours(0, 0, 0, 0);
  const day = local.getDay();
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  local.setDate(local.getDate() + diff);
  return local;
}

export function buildOverview(): OverviewReport {
  const now = new Date();
  const weekStart = startOfWeek(now).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();

  const all = db.prepare(
    `SELECT dripos_id, unique_id, full_name, email, phone,
            location_id, date_created_ms, last_seen_ms,
            lifetime, tickets, total_spend_cents, average_ticket_cents,
            text_subscribed, email_subscribed, date_archived_ms
       FROM patrons`,
  ).all() as PatronRow[];

  const active = all.filter((r) => r.date_archived_ms == null);

  const newThisWeek = active.filter((r) => (r.date_created_ms ?? 0) >= weekStart).length;
  const newThisMonth = active.filter((r) => (r.date_created_ms ?? 0) >= monthStart).length;
  const newThisYear = active.filter((r) => (r.date_created_ms ?? 0) >= yearStart).length;

  // Top tens — by lifetime visits + by total spend (active only).
  const byVisits = [...active]
    .sort((a, b) => b.lifetime - a.lifetime)
    .slice(0, 10)
    .map(rowToTop);
  const bySpend = [...active]
    .sort((a, b) => (b.total_spend_cents ?? 0) - (a.total_spend_cents ?? 0))
    .slice(0, 10)
    .map(rowToTop);

  // Top customer of the week: highest lifetime spend among patrons
  // seen this week. "Top" here is whoever's still our most valuable
  // customer that visited this week, not just whoever spent most this
  // week (we don't have per-week per-patron spend from this endpoint).
  const seenThisWeekRows = active.filter((r) => (r.last_seen_ms ?? 0) >= weekStart);
  const topThisWeek = seenThisWeekRows.length > 0
    ? rowToTop(seenThisWeekRows.reduce((best, cur) =>
        (cur.total_spend_cents ?? 0) > (best.total_spend_cents ?? 0) ? cur : best,
      ))
    : null;

  // Per-store breakdown.
  const byLocation = STORES.map((store) => {
    const here = active.filter((r) => r.location_id === store.locationId);
    const newWk = here.filter((r) => (r.date_created_ms ?? 0) >= weekStart).length;
    const newMo = here.filter((r) => (r.date_created_ms ?? 0) >= monthStart).length;
    const activeWk = here.filter((r) => (r.last_seen_ms ?? 0) >= weekStart).length;
    const topV = here.length > 0
      ? rowToTop(here.reduce((b, c) => c.lifetime > b.lifetime ? c : b))
      : null;
    const topS = here.length > 0
      ? rowToTop(here.reduce((b, c) => (c.total_spend_cents ?? 0) > (b.total_spend_cents ?? 0) ? c : b))
      : null;
    return {
      storeLabel: store.label,
      totalPatrons: here.length,
      newThisWeek: newWk,
      newThisMonth: newMo,
      activeThisWeek: activeWk,
      topByVisits: topV,
      topBySpend: topS,
    };
  });

  return {
    sync: getSyncMeta(),
    totalPatrons: all.length,
    totalArchived: all.length - active.length,
    totalActive: active.length,
    textSubscribed: active.filter((r) => r.text_subscribed === 1).length,
    emailSubscribed: active.filter((r) => r.email_subscribed === 1).length,
    newThisWeek,
    newThisMonth,
    newThisYear,
    newLifetime: active.length,
    byLocation,
    topByVisits: byVisits,
    topBySpend: bySpend,
    topThisWeek,
    seenThisWeek: seenThisWeekRows.length,
  };
}

// ─── Funnel (Taffer retention) ────────────────────────────────────

export interface FunnelMonth {
  yearMonth: string;
  label: string;
  total: number;
  oneOnly: number;
  twoPlus: number;
  exactlyTwo: number;
  threePlus: number;
  exactlyThree: number;
  fourPlus: number;
  pct2Plus: number | null;
  pct3Plus: number | null;
  pct4Plus: number | null;
  immature: boolean;
}

export interface FunnelChainSummary {
  total: number;
  twoPlus: number;
  threePlus: number;
  fourPlus: number;
  pct2Plus: number | null;
  pct3Plus: number | null;
  pct4Plus: number | null;
}

export interface PatronFunnelReport {
  sync: SyncMeta;
  chain: FunnelChainSummary;
  monthly: FunnelMonth[];
}

export const TAFFER_BENCHMARKS = { pct2Plus: 40, pct3Plus: 42, pct4Plus: 70 };

function pct(num: number, denom: number): number | null {
  if (denom <= 0) return null;
  return Math.round((num / denom) * 1000) / 10;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1)
    .toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

export function buildFunnelReport(): PatronFunnelReport {
  const rows = db.prepare(
    `SELECT date_created_ms, lifetime FROM patrons
      WHERE date_created_ms IS NOT NULL
        AND date_archived_ms IS NULL`,
  ).all() as Array<{ date_created_ms: number; lifetime: number }>;

  const chain: FunnelChainSummary = {
    total: rows.length,
    twoPlus: rows.filter((r) => r.lifetime >= 2).length,
    threePlus: rows.filter((r) => r.lifetime >= 3).length,
    fourPlus: rows.filter((r) => r.lifetime >= 4).length,
    pct2Plus: null, pct3Plus: null, pct4Plus: null,
  };
  chain.pct2Plus = pct(chain.twoPlus, chain.total);
  chain.pct3Plus = pct(chain.threePlus, chain.twoPlus);
  chain.pct4Plus = pct(chain.fourPlus, chain.threePlus);

  const buckets = new Map<string, FunnelMonth>();
  for (const r of rows) {
    const d = new Date(r.date_created_ms);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let b = buckets.get(ym);
    if (!b) {
      b = {
        yearMonth: ym,
        label: monthLabel(ym),
        total: 0, oneOnly: 0, twoPlus: 0, exactlyTwo: 0,
        threePlus: 0, exactlyThree: 0, fourPlus: 0,
        pct2Plus: null, pct3Plus: null, pct4Plus: null,
        immature: false,
      };
      buckets.set(ym, b);
    }
    b.total++;
    if (r.lifetime === 1) b.oneOnly++;
    if (r.lifetime >= 2) b.twoPlus++;
    if (r.lifetime === 2) b.exactlyTwo++;
    if (r.lifetime >= 3) b.threePlus++;
    if (r.lifetime === 3) b.exactlyThree++;
    if (r.lifetime >= 4) b.fourPlus++;
  }

  const now = new Date();
  const threeAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const cutoff = `${threeAgo.getFullYear()}-${String(threeAgo.getMonth() + 1).padStart(2, '0')}`;

  const monthly = Array.from(buckets.values()).map((b) => ({
    ...b,
    pct2Plus: pct(b.twoPlus, b.total),
    pct3Plus: pct(b.threePlus, b.twoPlus),
    pct4Plus: pct(b.fourPlus, b.threePlus),
    immature: b.yearMonth >= cutoff,
  })).sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

  return { sync: getSyncMeta(), chain, monthly };
}

/** Background-friendly entry point used by the boot hook + the 6h cron. */
export function prewarmPatronsSync(): Promise<void> {
  return syncAllPatrons()
    .then((r) => {
      if (r.ok) {
        console.log(`[patrons-sync] ${r.count}/${r.totalInDripos} patrons in ${(r.elapsedMs / 1000).toFixed(1)}s`);
      } else {
        console.warn(`[patrons-sync] failed (${r.elapsedMs}ms): ${r.error}`);
      }
    })
    .catch((err) => {
      console.warn('[patrons-sync] exception:', err instanceof Error ? err.message : err);
    });
}
