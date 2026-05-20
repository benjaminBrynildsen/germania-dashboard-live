/**
 * Holiday Calendar API — chain-wide special-hours decisions per date.
 * See server/holidays.ts for the seed list + date-resolution rules.
 *
 * Auth model:
 *   - GET endpoints require auth (any role can read).
 *   - POST/PATCH/DELETE require admin or manager — store-staff can see
 *     the schedule but not change it.
 *   - The historical-sales endpoint (read-only) is open to any authed
 *     user since seeing last year's traffic helps everyone plan shifts.
 */
import { Router, Response } from 'express';
import db from './db.js';
import { requireAuth, requireRole, AuthRequest } from './auth.js';
import { GERMANIA_HOLIDAYS, seedHolidaysForYear } from './holidays.js';
import { fetchCompletion, STORES } from './dripos.js';

const router = Router();

interface HolidayRow {
  id: number;
  date: string;
  name: string;
  status: 'normal' | 'closed' | 'custom';
  open_time: string | null;
  close_time: string | null;
  notes: string | null;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}

function rowToApi(r: HolidayRow) {
  return {
    id: r.id,
    date: r.date,
    name: r.name,
    status: r.status,
    openTime: r.open_time,
    closeTime: r.close_time,
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const STATUSES = new Set(['normal', 'closed', 'custom']);

function validateBody(b: any, partial = false): { ok: true; clean: { date?: string; name?: string; status?: string; openTime?: string | null; closeTime?: string | null; notes?: string | null } } | { ok: false; error: string } {
  const out: any = {};
  if (b.date !== undefined) {
    if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return { ok: false, error: 'invalid_date' };
    out.date = b.date;
  } else if (!partial) {
    return { ok: false, error: 'date_required' };
  }
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim()) return { ok: false, error: 'name_required' };
    out.name = b.name.trim().slice(0, 100);
  } else if (!partial) {
    return { ok: false, error: 'name_required' };
  }
  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !STATUSES.has(b.status)) return { ok: false, error: 'invalid_status' };
    out.status = b.status;
  } else if (!partial) {
    out.status = 'normal';
  }
  // Time fields — only meaningful when status='custom', but we accept
  // them on PATCH so a manager can pre-set times before flipping status.
  const isCustom = (out.status ?? null) === 'custom' || b.status === 'custom';
  if (b.openTime !== undefined) {
    if (b.openTime === null || b.openTime === '') {
      out.openTime = null;
    } else if (typeof b.openTime !== 'string' || !/^\d{2}:\d{2}$/.test(b.openTime)) {
      return { ok: false, error: 'invalid_open_time' };
    } else {
      out.openTime = b.openTime;
    }
  }
  if (b.closeTime !== undefined) {
    if (b.closeTime === null || b.closeTime === '') {
      out.closeTime = null;
    } else if (typeof b.closeTime !== 'string' || !/^\d{2}:\d{2}$/.test(b.closeTime)) {
      return { ok: false, error: 'invalid_close_time' };
    } else {
      out.closeTime = b.closeTime;
    }
  }
  // Custom status requires both times in proper order. Validate against
  // either the new value (if provided) or the previous value the caller
  // already left in place; for POST partial=false we have both in `out`.
  if (!partial && isCustom) {
    const o = out.openTime ?? null;
    const c = out.closeTime ?? null;
    if (!o || !c) return { ok: false, error: 'custom_requires_times' };
    if (o >= c) return { ok: false, error: 'open_must_be_before_close' };
  }
  if (b.notes !== undefined) {
    if (b.notes === null) out.notes = null;
    else if (typeof b.notes !== 'string') return { ok: false, error: 'invalid_notes' };
    else out.notes = b.notes.slice(0, 2000);
  }
  return { ok: true, clean: out };
}

// ── List ────────────────────────────────────────────────────────────
router.get('/holidays', requireAuth, (req: AuthRequest, res: Response) => {
  const from = typeof req.query.from === 'string' ? req.query.from : null;
  const to = typeof req.query.to === 'string' ? req.query.to : null;
  let rows: HolidayRow[];
  if (from && to) {
    rows = db.prepare('SELECT * FROM holidays WHERE date >= ? AND date <= ? ORDER BY date ASC').all(from, to) as HolidayRow[];
  } else if (from) {
    rows = db.prepare('SELECT * FROM holidays WHERE date >= ? ORDER BY date ASC').all(from) as HolidayRow[];
  } else {
    rows = db.prepare('SELECT * FROM holidays ORDER BY date ASC').all() as HolidayRow[];
  }
  res.json({ ok: true, holidays: rows.map(rowToApi) });
});

// ── Create ──────────────────────────────────────────────────────────
router.post('/holidays', requireAuth, requireRole('admin', 'manager'), (req: AuthRequest, res: Response) => {
  const v = validateBody(req.body, false);
  if (!v.ok) { res.status(400).json({ error: v.error }); return; }
  const c = v.clean;
  const now = Date.now();
  try {
    const result = db.prepare(
      `INSERT INTO holidays (date, name, status, open_time, close_time, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      c.date, c.name, c.status ?? 'normal',
      c.openTime ?? null, c.closeTime ?? null, c.notes ?? null,
      req.user?.id ?? null, now, now,
    );
    const row = db.prepare('SELECT * FROM holidays WHERE id = ?').get(result.lastInsertRowid) as HolidayRow;
    res.json({ ok: true, holiday: rowToApi(row) });
  } catch (err: any) {
    // The unique (date, name) index returns SQLITE_CONSTRAINT here —
    // surface a friendly message so the form can highlight the dup.
    if (String(err?.message || '').includes('UNIQUE')) {
      res.status(409).json({ error: 'duplicate', message: 'A holiday with that date + name already exists.' });
      return;
    }
    console.error('[holidays] create failed:', err);
    res.status(500).json({ error: 'create_failed', message: err?.message || String(err) });
  }
});

// ── Update ──────────────────────────────────────────────────────────
router.patch('/holidays/:id', requireAuth, requireRole('admin', 'manager'), (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: 'invalid_id' }); return; }
  const existing = db.prepare('SELECT * FROM holidays WHERE id = ?').get(id) as HolidayRow | undefined;
  if (!existing) { res.status(404).json({ error: 'not_found' }); return; }
  const v = validateBody(req.body, true);
  if (!v.ok) { res.status(400).json({ error: v.error }); return; }
  const c = v.clean;
  // If the resulting status is 'custom', both times must be present in
  // either the patch or the existing row, and open < close.
  const finalStatus = c.status ?? existing.status;
  if (finalStatus === 'custom') {
    const o = c.openTime !== undefined ? c.openTime : existing.open_time;
    const cl = c.closeTime !== undefined ? c.closeTime : existing.close_time;
    if (!o || !cl) { res.status(400).json({ error: 'custom_requires_times' }); return; }
    if (o >= cl) { res.status(400).json({ error: 'open_must_be_before_close' }); return; }
  }
  const sets: string[] = [];
  const vals: any[] = [];
  if (c.date !== undefined)      { sets.push('date = ?');       vals.push(c.date); }
  if (c.name !== undefined)      { sets.push('name = ?');       vals.push(c.name); }
  if (c.status !== undefined)    { sets.push('status = ?');     vals.push(c.status); }
  if (c.openTime !== undefined)  { sets.push('open_time = ?');  vals.push(c.openTime); }
  if (c.closeTime !== undefined) { sets.push('close_time = ?'); vals.push(c.closeTime); }
  if (c.notes !== undefined)     { sets.push('notes = ?');      vals.push(c.notes); }
  // Side-effect: when flipping AWAY from custom, clear the time
  // fields so they don't linger as misleading "ghost" hours next time
  // the row gets re-flipped to custom.
  if (c.status !== undefined && c.status !== 'custom' && c.openTime === undefined && c.closeTime === undefined) {
    sets.push('open_time = NULL');
    sets.push('close_time = NULL');
  }
  if (sets.length === 0) { res.status(400).json({ error: 'nothing_to_update' }); return; }
  sets.push('updated_at = ?'); vals.push(Date.now());
  vals.push(id);
  try {
    db.prepare(`UPDATE holidays SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    const row = db.prepare('SELECT * FROM holidays WHERE id = ?').get(id) as HolidayRow;
    res.json({ ok: true, holiday: rowToApi(row) });
  } catch (err: any) {
    if (String(err?.message || '').includes('UNIQUE')) {
      res.status(409).json({ error: 'duplicate', message: 'A holiday with that date + name already exists.' });
      return;
    }
    console.error('[holidays] update failed:', err);
    res.status(500).json({ error: 'update_failed', message: err?.message || String(err) });
  }
});

// ── Delete ──────────────────────────────────────────────────────────
router.delete('/holidays/:id', requireAuth, requireRole('admin', 'manager'), (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: 'invalid_id' }); return; }
  const result = db.prepare('DELETE FROM holidays WHERE id = ?').run(id);
  if (result.changes === 0) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ ok: true });
});

// ── Seed for a year ────────────────────────────────────────────────
router.post('/holidays/seed-year', requireAuth, requireRole('admin', 'manager'), (req: AuthRequest, res: Response) => {
  const year = Number(req.body?.year);
  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    res.status(400).json({ error: 'invalid_year', message: 'Year must be between 2020 and 2100.' });
    return;
  }
  const { inserted, skipped } = seedHolidaysForYear(year);
  res.json({ ok: true, year, inserted, skipped, totalDefs: GERMANIA_HOLIDAYS.length });
});

// ── Historical hourly sales for prior years of the same holiday ────
// Returns the last N occurrences of this holiday's NAME (where
// date < this holiday's date) with per-store hourly ticket counts
// pulled from Dripos's /report/completion endpoint. Caches forever
// for past dates via the existing dripos cached() wrapper, so first
// open is ~5–15s cold; subsequent opens are instant.
//
// Note: ticket counts (not revenue) — Dripos doesn't expose a single
// hourly-revenue endpoint, and stitching it from /report/productsales
// per hour would be 12+ API calls per store per holiday. Ticket count
// is the better signal for staff scheduling anyway (rush hours = lots
// of tickets, regardless of order size).
router.get('/holidays/:id/historical', requireAuth, async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: 'invalid_id' }); return; }
  const yearsBack = Math.max(1, Math.min(5, Number(req.query.years) || 2));
  try {
    const holiday = db.prepare('SELECT * FROM holidays WHERE id = ?').get(id) as HolidayRow | undefined;
    if (!holiday) { res.status(404).json({ error: 'not_found' }); return; }
    // Pull the last N occurrences of the same NAME before this date.
    const priorRows = db.prepare(
      `SELECT id, date, name FROM holidays
        WHERE name = ? AND date < ?
        ORDER BY date DESC
        LIMIT ?`,
    ).all(holiday.name, holiday.date, yearsBack) as Array<{ id: number; date: string; name: string }>;
    if (priorRows.length === 0) {
      res.json({ ok: true, holiday: rowToApi(holiday), priorYears: [], note: 'no_prior_data' });
      return;
    }
    // For each prior date, fetch hourly completion data per store.
    // fetchCompletion expects sun/sat Date objects but accepts any
    // start/end — we pass the same date as both since we want a
    // single-day window. The function's cache key uses
    // startOfDayMs(sun) + endOfDayMs(sat), so a single-day call is
    // well-formed.
    const priorYears = await Promise.all(
      priorRows.map(async (pr) => {
        const start = new Date(pr.date + 'T00:00:00');
        const end = new Date(pr.date + 'T23:59:59');
        const byStore: Record<string, Array<{ hour: string; ticketCount: number; avgCompletionMin: number }>> = {};
        await Promise.all(
          STORES.map(async (store) => {
            try {
              const hours = await fetchCompletion(store.locationId, start, end);
              byStore[store.label] = hours.map((h) => ({
                hour: hourLabelFromEpoch(h.HOUR),
                ticketCount: h.TICKET_COUNT,
                avgCompletionMin: h.AVG_COMPLETION_TIME,
              }));
            } catch (err) {
              console.warn(`[holiday-historical] ${pr.date} ${store.label} fetch failed:`, err instanceof Error ? err.message : err);
              byStore[store.label] = [];
            }
          }),
        );
        return {
          year: Number(pr.date.slice(0, 4)),
          date: pr.date,
          name: pr.name,
          byStore,
        };
      }),
    );
    res.json({ ok: true, holiday: rowToApi(holiday), priorYears });
  } catch (err: any) {
    console.error('[holidays] historical failed:', err);
    res.status(500).json({ error: 'historical_failed', message: err?.message || String(err) });
  }
});

/** "6AM" / "12PM" / "3PM" style label in America/Chicago for an epoch-ms.
 *  Matches the TICKET_HOUR_LABELS convention used by the TicketTime
 *  page so visualizations across the dashboard line up. */
function hourLabelFromEpoch(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: true,
    timeZone: 'America/Chicago',
  }).formatToParts(new Date(epochMs));
  const hour = parts.find((p) => p.type === 'hour')?.value || '?';
  const period = parts.find((p) => p.type === 'dayPeriod')?.value || '';
  return `${hour}${period.toUpperCase()}`;
}

export default router;
