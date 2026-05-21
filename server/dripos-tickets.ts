/**
 * Per-ticket data sync from Dripos. Powers the pastry/drink pairing
 * analysis where we need to know which items appeared on the same
 * customer transaction (co-occurrence). Dripos's /report/productsales
 * gives aggregated totals — useful for everything else but useless for
 * "what drinks pair with each pastry."
 *
 * Two endpoints we lean on (discovered 2026-05-21):
 *   POST /tickets/dumb  → paginated list of ticket HEADERS (no items)
 *   GET  /ticket/:UID   → single ticket with full ITEMS array
 *
 * Both work with our stored SMS-login token + the loc_xxx location
 * header. The list is cursor-paginated newest-first; we walk backward
 * until we cross the target date.
 *
 * Sync strategy:
 *   1. For each store, POST /tickets/dumb with SORT_DESC=true paginated
 *      via CURSOR until we cross `fromMs`. Insert ticket headers.
 *   2. For each newly-inserted ticket (detail_status='pending'), GET
 *      /ticket/:UID to pull line items. Concurrency-capped by callApi's
 *      built-in driposInFlight limiter so we don't trip Dripos's rate
 *      limits.
 *
 * Tickets stay in 'pending' state if the detail fetch fails — they're
 * retried on the next sync. Past tickets never change so a successful
 * fetch is permanent.
 */
import db from './db.js';
import { callApi, STORES } from './dripos.js';

const PAGE_ROWS = 200; // tickets per list page; Dripos accepts up to ~500

interface TicketHeader {
  ID: number;
  UNIQUE_ID: string;
  LOCATION_ID: number;
  DATE_CREATED: number;
  DATE_CLOSED?: number | null;
  NAME?: string | null;
  PHONE?: string | null;
  EMAIL?: string | null;
  TICKET_NUMBER?: number | null;
  STATUS?: string | null;
  PLATFORM?: string | null;
  TICKET_TYPE_NAME?: string | null;
  EMPLOYEE_FULL_NAME?: string | null;
  PAYMENT_INTENT?: { TOTAL?: number; AMOUNT_TIP?: number } | null;
}

interface TicketItem {
  ID: number;
  TICKET_ID: number;
  OBJECT_ID?: string | null;
  NAME: string;
  TYPE?: string | null;
  QUANTITY?: number | null;
  AMOUNT?: number | null;
  TOTAL?: number | null;
}

interface TicketDetail extends TicketHeader {
  ITEMS?: TicketItem[];
}

interface ListResponse {
  hasMore: boolean;
  hasPrevious: boolean;
  count: number;
  data: TicketHeader[];
  start: number;
  end: number;
}

interface ListRequest {
  SEARCH: null;
  FILTERS: unknown[];
  CURSOR: { KEY: 'BEFORE' | 'AFTER'; VALUE: unknown };
  SORT_DESC: boolean;
  SORT: string | null;
  OFFSET: number;
  RETURN_COUNT: boolean;
  ROWS: number;
}

/** One page of ticket headers for a location, newest-first. */
async function fetchTicketListPage(
  locationId: number,
  cursorValue: unknown | null,
): Promise<ListResponse> {
  const body: ListRequest = {
    SEARCH: null,
    FILTERS: [],
    CURSOR: { KEY: 'BEFORE', VALUE: cursorValue },
    SORT_DESC: true,
    SORT: null,
    OFFSET: 0,
    RETURN_COUNT: false,
    ROWS: PAGE_ROWS,
  };
  const r = await callApi<ListResponse>('/tickets/dumb', {
    method: 'POST',
    locationId,
    body,
  });
  if (!r.success || !r.data) {
    throw new Error(`tickets list failed: ${JSON.stringify(r).slice(0, 300)}`);
  }
  return r.data;
}

/** Single ticket with full ITEMS array. */
async function fetchTicketDetail(uniqueId: string, locationId: number): Promise<TicketDetail | null> {
  const r = await callApi<TicketDetail>(`/ticket/${uniqueId}`, { locationId });
  if (!r.success || !r.data) return null;
  return r.data;
}

const insertHeader = () => db.prepare(`
  INSERT INTO tickets (
    id, unique_id, location_id, date_created_ms, date_closed_ms,
    customer_name, customer_phone, customer_email,
    ticket_number, status, platform, ticket_type_name, employee_full_name,
    total_cents, tip_cents,
    detail_status, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  ON CONFLICT(id) DO UPDATE SET
    date_closed_ms = excluded.date_closed_ms,
    customer_name = excluded.customer_name,
    customer_phone = excluded.customer_phone,
    customer_email = excluded.customer_email,
    status = excluded.status,
    total_cents = excluded.total_cents,
    tip_cents = excluded.tip_cents,
    synced_at = excluded.synced_at
`);

const markFull = db.prepare(`
  UPDATE tickets SET detail_status = 'full', detail_fetched_at = ? WHERE id = ?
`);
const markFailed = db.prepare(`
  UPDATE tickets SET detail_status = 'failed', detail_fetched_at = ? WHERE id = ?
`);
const deleteItems = db.prepare(`DELETE FROM ticket_items WHERE ticket_id = ?`);
const insertItem = db.prepare(`
  INSERT INTO ticket_items (id, ticket_id, ticket_unique_id, object_id, name, type, quantity, amount_cents, total_cents)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * Sync ticket HEADERS for one location between [fromMs, toMs]. Walks
 * the list cursor-paginated newest-first until DATE_CREATED < fromMs.
 * Returns the count of headers inserted/updated; per-ticket detail is
 * fetched separately by fetchPendingTicketDetails().
 */
export async function syncTicketHeaders(
  locationId: number,
  fromMs: number,
  toMs: number,
  onProgress?: (msg: string) => void,
): Promise<{ scanned: number; upserted: number }> {
  const stmt = insertHeader();
  let cursor: unknown = null;
  let scanned = 0;
  let upserted = 0;
  const now = Date.now();
  // Bound iteration to avoid an accidental infinite walk on a misbehaving cursor.
  for (let safety = 0; safety < 2000; safety++) {
    const page = await fetchTicketListPage(locationId, cursor);
    if (page.data.length === 0) break;
    let crossedFrom = false;
    const txn = db.transaction((rows: TicketHeader[]) => {
      for (const t of rows) {
        scanned++;
        if (t.DATE_CREATED < fromMs) { crossedFrom = true; continue; }
        if (t.DATE_CREATED > toMs) continue;
        const r = stmt.run(
          t.ID,
          t.UNIQUE_ID,
          t.LOCATION_ID,
          t.DATE_CREATED,
          t.DATE_CLOSED ?? null,
          t.NAME ?? null,
          t.PHONE ?? null,
          t.EMAIL ?? null,
          t.TICKET_NUMBER ?? null,
          t.STATUS ?? null,
          t.PLATFORM ?? null,
          t.TICKET_TYPE_NAME ?? null,
          t.EMPLOYEE_FULL_NAME ?? null,
          t.PAYMENT_INTENT?.TOTAL ?? null,
          t.PAYMENT_INTENT?.AMOUNT_TIP ?? null,
          now,
        );
        if (r.changes > 0) upserted++;
      }
    });
    txn(page.data);
    if (crossedFrom || !page.hasMore) break;
    // Cursor for "BEFORE" pagination is the last ticket's ID (the lowest
    // ID on this page since we're newest-first). We tried VALUE: <ID>
    // and that paginates correctly in Dripos's web UI.
    const last = page.data[page.data.length - 1];
    cursor = last.ID;
    if (onProgress && scanned % 500 < page.data.length) {
      onProgress(`loc=${locationId} scanned=${scanned} upserted=${upserted}`);
    }
  }
  return { scanned, upserted };
}

/**
 * For every ticket with detail_status='pending' or 'failed', fetch the
 * full detail and insert its line items. Concurrency is bounded by
 * callApi's internal driposInFlight slot (6 in-flight).
 */
export async function fetchPendingTicketDetails(
  locationId?: number,
  limit = 5000,
  onProgress?: (done: number, total: number) => void,
): Promise<{ fetched: number; failed: number }> {
  const params: any[] = ['pending'];
  let where = "WHERE detail_status IN ('pending','failed')";
  if (locationId) {
    where += ' AND location_id = ?';
    params.push(locationId);
  }
  // Pending first, oldest first. Cap by limit so a giant backfill
  // doesn't try to fetch 296k tickets in one tick.
  const rows = db.prepare(
    `SELECT id, unique_id, location_id FROM tickets ${where} ORDER BY date_created_ms DESC LIMIT ?`,
  ).all(...params, limit) as Array<{ id: number; unique_id: string; location_id: number }>;
  let fetched = 0;
  let failed = 0;
  let done = 0;
  // Fire in batches of 6 (matching callApi's concurrency cap) so we
  // saturate the slot without blasting the API.
  const BATCH = 6;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (row) => {
        try {
          const detail = await fetchTicketDetail(row.unique_id, row.location_id);
          if (!detail) {
            markFailed.run(Date.now(), row.id);
            failed++;
            return;
          }
          const items = detail.ITEMS ?? [];
          const insertItemsTxn = db.transaction(() => {
            deleteItems.run(row.id);
            for (const it of items) {
              insertItem.run(
                it.ID,
                row.id,
                row.unique_id,
                it.OBJECT_ID ?? null,
                it.NAME,
                it.TYPE ?? null,
                it.QUANTITY ?? null,
                it.AMOUNT ?? null,
                it.TOTAL ?? null,
              );
            }
            markFull.run(Date.now(), row.id);
          });
          insertItemsTxn();
          fetched++;
        } catch (err) {
          console.warn(`[tickets] detail ${row.unique_id} failed:`, err instanceof Error ? err.message : err);
          markFailed.run(Date.now(), row.id);
          failed++;
        } finally {
          done++;
        }
      }),
    );
    if (onProgress) onProgress(done, rows.length);
  }
  return { fetched, failed };
}

/**
 * One-shot sync: pull headers + details for the date range across all
 * stores. Used by both the nightly cron (for yesterday) and the admin
 * backfill (for the last N days).
 */
export async function syncTicketsForRange(
  fromMs: number,
  toMs: number,
  onProgress?: (msg: string) => void,
): Promise<{ scanned: number; upserted: number; fetched: number; failed: number }> {
  let scanned = 0;
  let upserted = 0;
  for (const store of STORES) {
    onProgress?.(`Pulling headers for ${store.label}...`);
    const r = await syncTicketHeaders(store.locationId, fromMs, toMs, onProgress);
    scanned += r.scanned;
    upserted += r.upserted;
    onProgress?.(`${store.label}: scanned ${r.scanned}, upserted ${r.upserted}`);
  }
  onProgress?.(`Fetching item details for ${upserted} new tickets...`);
  const detail = await fetchPendingTicketDetails(
    undefined,
    100_000,
    (done, total) => {
      if (done % 100 === 0 || done === total) {
        onProgress?.(`Items: ${done}/${total}`);
      }
    },
  );
  // Update sync meta so the admin UI can show last-sync status.
  db.prepare(`
    UPDATE tickets_sync_meta
       SET last_synced_at = ?, last_sync_count = ?, last_sync_status = 'ok', last_sync_error = NULL
     WHERE id = 1
  `).run(Date.now(), detail.fetched);
  return { scanned, upserted, ...detail };
}

/** Convenience for the daily cron: sync yesterday's tickets. */
export async function syncYesterday(): Promise<{ scanned: number; upserted: number; fetched: number; failed: number }> {
  // Use UTC ms but anchor "yesterday" against America/Chicago so that
  // the cron firing at 3 AM CT pulls the calendar day that just ended.
  const now = new Date();
  const ctNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const start = new Date(ctNow);
  start.setDate(start.getDate() - 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(ctNow);
  end.setHours(0, 0, 0, 0);
  return syncTicketsForRange(start.getTime(), end.getTime());
}

/**
 * Admin-triggered backfill. Sets the in_progress flag so the UI can
 * show progress; fires-and-forgets the sync so the HTTP request
 * returns immediately.
 */
export function startBackfill(daysBack: number): void {
  const meta = db.prepare('SELECT backfill_in_progress FROM tickets_sync_meta WHERE id = 1').get() as any;
  if (meta?.backfill_in_progress) {
    throw new Error('Backfill already in progress');
  }
  db.prepare(`
    UPDATE tickets_sync_meta
       SET backfill_in_progress = 1,
           backfill_started_at = ?,
           backfill_progress_pct = 0,
           backfill_message = 'Starting...'
     WHERE id = 1
  `).run(Date.now());
  const now = Date.now();
  const fromMs = now - daysBack * 86400_000;
  void (async () => {
    try {
      await syncTicketsForRange(fromMs, now, (msg) => {
        db.prepare(`UPDATE tickets_sync_meta SET backfill_message = ? WHERE id = 1`).run(msg);
      });
      db.prepare(`
        UPDATE tickets_sync_meta
           SET backfill_in_progress = 0,
               backfill_progress_pct = 100,
               backfill_message = 'Complete'
         WHERE id = 1
      `).run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[tickets-backfill] failed:', err);
      db.prepare(`
        UPDATE tickets_sync_meta
           SET backfill_in_progress = 0,
               last_sync_status = 'failed',
               last_sync_error = ?,
               backfill_message = ?
         WHERE id = 1
      `).run(msg, `Failed: ${msg}`);
    }
  })();
}

export function getBackfillStatus(): {
  inProgress: boolean;
  startedAt: number | null;
  progressPct: number;
  message: string | null;
  lastSyncedAt: number | null;
  lastSyncCount: number | null;
  lastSyncStatus: string | null;
  totalTickets: number;
  withDetails: number;
} {
  const meta = db.prepare('SELECT * FROM tickets_sync_meta WHERE id = 1').get() as any;
  const totals = db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN detail_status = 'full' THEN 1 ELSE 0 END) AS withDetails
     FROM tickets`,
  ).get() as { total: number; withDetails: number };
  return {
    inProgress: !!meta?.backfill_in_progress,
    startedAt: meta?.backfill_started_at ?? null,
    progressPct: meta?.backfill_progress_pct ?? 0,
    message: meta?.backfill_message ?? null,
    lastSyncedAt: meta?.last_synced_at ?? null,
    lastSyncCount: meta?.last_sync_count ?? null,
    lastSyncStatus: meta?.last_sync_status ?? null,
    totalTickets: totals.total ?? 0,
    withDetails: totals.withDetails ?? 0,
  };
}
