import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from './auth.js';
import { fetchApplicants, fetchTokenScopes } from './applicants.js';

const router = Router();

router.get('/applicants', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const data = await fetchApplicants(req.user!.id);
    res.json({ ok: true, ...data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status =
      /insufficient.*scope|invalid_grant|unauthorized/i.test(msg) ? 401 : 500;
    if (status === 401) {
      res.status(401).json({
        error: 'google_reauth_required',
        message:
          "Couldn't read the applicants sheet — sign out and back in to grant the Google Sheets permission.",
      });
      return;
    }
    console.error('[applicants] fetch failed:', err);
    res.status(500).json({ error: 'fetch_failed', message: msg });
  }
});

// NOTE: the /applicants/resume/:fileId streaming route (and its debug
// meta probe) were removed 2026-09 along with the drive.readonly scope.
// Resumes render via Drive's own /preview embed in the browser, which
// uses the viewer's Google session instead of the app's token.

router.get('/applicants/scopes', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const scopes = await fetchTokenScopes(req.user!.id);
    res.json({ ok: true, scopes });
  } catch (err) {
    res.status(500).json({
      error: 'scopes_fetch_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
