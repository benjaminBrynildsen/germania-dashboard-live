/**
 * REST routes for the Dripos integration. Mounted under /api/dripos.
 * All endpoints require an authenticated germania-dashboard user.
 */
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from './auth.js';
import {
  AuthExpired,
  NoToken,
  buildReport,
  clearToken,
  clearWeeklyCache,
  loginComplete,
  loginInitiate,
  readToken,
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

router.get('/dripos/report', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const report = await buildReport();
    res.json({ ok: true, report });
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
