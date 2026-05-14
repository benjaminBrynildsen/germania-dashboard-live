/**
 * REST routes for the Dripos integration. Mounted under /api/dripos.
 * All endpoints require an authenticated germania-dashboard user.
 */
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from './auth.js';
import {
  AuthExpired,
  NoToken,
  buildEmployeeHoursReport,
  buildHiringNeedsReport,
  buildReport,
  buildTicketTimeReport,
  clearToken,
  clearWeekCache,
  clearWeeklyCache,
  fetchDailyTicketAndSales,
  loginComplete,
  loginInitiate,
  prewarmEmployeeHours,
  readToken,
  setEmployeePreference,
  STORES,
  syncDailySales,
  writeToken,
} from './dripos.js';

const router = Router();

router.get('/dripos/status', requireAuth, (_req: AuthRequest, res: Response) => {
  const token = readToken();
  res.json({
    hasToken: !!token,
    tokenPreview: token ? `${token.slice(0, 6)}…${token.slice(-4)}` : null,
  });
});

router.get('/dripos/report', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const weekOffset = Math.max(0, parseInt(String(req.query.weekOffset ?? '0'), 10) || 0);
    const referenceDate = new Date();
    if (weekOffset > 0) referenceDate.setDate(referenceDate.getDate() - 7 * weekOffset);
    if (req.query.force === '1') {
      // Nuke current-week (TTL'd) entries chain-wide, plus the requested
      // week's forever-cached entries. Other navigated weeks keep their
      // cache so the trend chart stays cheap.
      const { default: db } = await import('./db.js');
      db.prepare('DELETE FROM dripos_cache WHERE expires_at IS NOT NULL').run();
      clearWeekCache(referenceDate);
    }
    const report = await buildReport(referenceDate);
    res.json({ ok: true, report, weekOffset });
  } catch (err) {
    if (err instanceof NoToken || err instanceof AuthExpired) {
      res.status(401).json({ error: 'dripos_auth_required', message: err.message });
      return;
    }
    console.error('[dripos-report] failed:', err);
    res.status(500).json({
      error: 'report_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get('/dripos/ticket-time', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (req.query.force === '1') {
      const { default: db } = await import('./db.js');
      db.prepare('DELETE FROM dripos_cache WHERE expires_at IS NOT NULL').run();
    }
    const weekOffset = Math.max(0, parseInt(String(req.query.weekOffset ?? '0'), 10) || 0);
    const referenceDate = new Date();
    if (weekOffset > 0) referenceDate.setDate(referenceDate.getDate() - 7 * weekOffset);
    const week = await buildTicketTimeReport(referenceDate);
    res.json({ ok: true, week, weekOffset });
  } catch (err) {
    if (err instanceof NoToken || err instanceof AuthExpired) {
      res.status(401).json({ error: 'dripos_auth_required', message: err.message });
      return;
    }
    console.error('[dripos-ticket-time] failed:', err);
    res.status(500).json({
      error: 'ticket_time_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// Fire-and-forget pre-warm. Kicks off the 52-wk × 4-store pull in the
// background and returns 202 immediately. Useful when /employee-hours is
// taking too long on cold cache — you hit /prewarm, walk away, and come
// back when the table is filled in.
router.post('/dripos/employee-hours/prewarm', requireAuth, (_req: AuthRequest, res: Response) => {
  prewarmEmployeeHours();
  res.status(202).json({ ok: true, message: 'Pre-warm started in background. Check server logs for [prewarm-hours] completion.' });
});

router.get('/dripos/hiring-needs', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const report = await buildHiringNeedsReport();
    res.json({ ok: true, report });
  } catch (err) {
    if (err instanceof NoToken || err instanceof AuthExpired) {
      res.status(401).json({ error: 'dripos_auth_required', message: err.message });
      return;
    }
    console.error('[dripos-hiring-needs] failed:', err);
    res.status(500).json({
      error: 'hiring_needs_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.put('/dripos/preferences/:employeeId', requireAuth, (req: AuthRequest, res: Response) => {
  const employeeId = parseInt(String(req.params.employeeId), 10);
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    res.status(400).json({ error: 'invalid_employee_id' });
    return;
  }
  const body = req.body ?? {};
  const rawHrs = body.preferredHours;
  const preferredHours = rawHrs === null || rawHrs === undefined || rawHrs === ''
    ? null
    : Number(rawHrs);
  if (preferredHours !== null && (!Number.isFinite(preferredHours) || preferredHours < 0 || preferredHours > 80)) {
    res.status(400).json({ error: 'invalid_preferred_hours', message: 'Must be between 0 and 80.' });
    return;
  }
  const notes = typeof body.notes === 'string' ? body.notes : null;
  setEmployeePreference(employeeId, preferredHours, notes);
  res.json({ ok: true });
});

router.get('/dripos/employee-hours', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    if (req.query.force === '1') {
      const { default: db } = await import('./db.js');
      // Drop only the timesheets cache (per-week rows) so completed weeks
      // get re-fetched. We don't want to nuke the whole dripos_cache table.
      db.prepare("DELETE FROM dripos_cache WHERE key LIKE 'report/timesheets|%'").run();
    }
    const report = await buildEmployeeHoursReport();
    res.json({ ok: true, report });
  } catch (err) {
    if (err instanceof NoToken || err instanceof AuthExpired) {
      res.status(401).json({ error: 'dripos_auth_required', message: err.message });
      return;
    }
    console.error('[dripos-employee-hours] failed:', err);
    res.status(500).json({
      error: 'employee_hours_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/dripos/login/initiate', requireAuth, async (req: AuthRequest, res: Response) => {
  const phone = (req.body?.phone ?? '').toString().trim();
  if (!phone) {
    res.status(400).json({ error: 'phone_required' });
    return;
  }
  try {
    const { unique } = await loginInitiate(phone);
    res.json({ ok: true, unique, phone });
  } catch (err) {
    res.status(400).json({
      error: 'login_initiate_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/dripos/login/complete', requireAuth, async (req: AuthRequest, res: Response) => {
  const code = (req.body?.code ?? '').toString().trim();
  const unique = (req.body?.unique ?? '').toString().trim();
  const phone = (req.body?.phone ?? '').toString().trim() || undefined;
  if (!code || !unique) {
    res.status(400).json({ error: 'code_and_unique_required' });
    return;
  }
  try {
    await loginComplete({ code, unique, phone });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({
      error: 'login_complete_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// Fallback for SMS-login tokens that come back with INSUFFICIENT_PERMISSIONS
// (Dripos limits phone-login token scope; only dashboard browser tokens can
// hit /dashboard/sales + /report/*). User pastes the `authentication`
// header from a logged-in dashboard.dripos.com DevTools call.
router.post('/dripos/set-token', requireAuth, (req: AuthRequest, res: Response) => {
  const token = (req.body?.token ?? '').toString().trim();
  if (!token || token.length < 10) {
    res.status(400).json({ error: 'token_required' });
    return;
  }
  writeToken(token, null);
  clearWeeklyCache();
  res.json({ ok: true });
});

router.post('/dripos/logout', requireAuth, (_req: AuthRequest, res: Response) => {
  clearToken();
  clearWeeklyCache();
  res.json({ ok: true });
});

router.get('/dripos/ticket-vs-sales/:locId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    res.set('Cache-Control', 'no-store');
    const param = String(req.params.locId).toUpperCase();
    const store = STORES.find(
      (s) => s.label === param || String(s.locationId) === req.params.locId,
    );
    if (!store) {
      res.status(404).json({ error: 'unknown_store', message: `No store named "${req.params.locId}"` });
      return;
    }
    const days = Math.min(Math.max(parseInt(String(req.query.days ?? '90'), 10) || 90, 7), 730);
    const series = await fetchDailyTicketAndSales(store.locationId, days);
    res.json({ ok: true, store: store.label, days, series });
  } catch (err) {
    if (err instanceof NoToken || err instanceof AuthExpired) {
      res.status(401).json({ error: 'dripos_auth_required', message: err.message });
      return;
    }
    console.error('[ticket-vs-sales] failed:', err);
    res.status(500).json({
      error: 'ticket_vs_sales_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/dripos/sync-daily', requireAuth, async (req: AuthRequest, res: Response) => {
  const days = Math.min(Math.max(parseInt(req.body?.days ?? '30', 10) || 30, 1), 90);
  try {
    const summary = await syncDailySales(days);
    res.json({ ok: true, summary });
  } catch (err) {
    if (err instanceof NoToken || err instanceof AuthExpired) {
      res.status(401).json({ error: 'dripos_auth_required', message: err.message });
      return;
    }
    console.error('[dripos-sync-daily] failed:', err);
    res.status(500).json({
      error: 'sync_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
