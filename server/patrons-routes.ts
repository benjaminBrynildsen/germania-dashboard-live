/**
 * Patron dashboard endpoints. Mounted under /api/patrons.
 */
import { Router, Response } from 'express';
import { AuthExpired, NoToken } from './dripos.js';
import { requireAuth, AuthRequest } from './auth.js';
import {
  buildBleedReport,
  buildFunnelReport,
  buildOverview,
  syncAllPatrons,
} from './patrons.js';

const router = Router();

router.get('/patrons/overview', requireAuth, (_req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json({ ok: true, report: buildOverview() });
  } catch (err) {
    console.error('[patrons-overview]', err);
    res.status(500).json({ error: 'overview_failed', message: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/patrons/funnel', requireAuth, (_req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json({ ok: true, report: buildFunnelReport() });
  } catch (err) {
    console.error('[patrons-funnel]', err);
    res.status(500).json({ error: 'funnel_failed', message: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/patrons/bleed', requireAuth, (_req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json({ ok: true, report: buildBleedReport() });
  } catch (err) {
    console.error('[patrons-bleed]', err);
    res.status(500).json({ error: 'bleed_failed', message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Force a sync from Dripos. Returns when the sync completes so the
 * client can show the fresh report immediately. ~60-90s on cold sync
 * for ~50k patrons.
 */
router.post('/patrons/sync', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await syncAllPatrons();
    if (!result.ok) {
      res.status(500).json({ error: 'sync_failed', message: result.error, result });
      return;
    }
    res.json({ ok: true, result });
  } catch (err) {
    if (err instanceof NoToken || err instanceof AuthExpired) {
      res.status(401).json({ error: 'dripos_auth_required', message: err.message });
      return;
    }
    console.error('[patrons-sync]', err);
    res.status(500).json({ error: 'sync_failed', message: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
