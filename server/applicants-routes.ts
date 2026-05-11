import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from './auth.js';
import { fetchApplicants, fetchTokenScopes, streamResume } from './applicants.js';

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

router.get('/applicants/resume/:fileId', requireAuth, async (req: AuthRequest, res: Response) => {
  const fileId = String(req.params.fileId);
  try {
    const { stream, mimeType, name } = await streamResume(req.user!.id, fileId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${name.replace(/"/g, '')}"`,
    );
    stream.pipe(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const insufficientScope = /insufficient.*scope|unauthorized|invalid_grant/i.test(msg);
    const notFound = /not found|404|file not found/i.test(msg);
    console.error('[applicants] resume stream failed:', { fileId, msg });

    // Probe the user's actual granted scopes so we can tell them whether
    // they need to re-auth or whether the file genuinely isn't accessible.
    let scopes: string[] = [];
    try { scopes = await fetchTokenScopes(req.user!.id); } catch {}
    const hasDriveRead =
      scopes.includes('https://www.googleapis.com/auth/drive.readonly') ||
      scopes.includes('https://www.googleapis.com/auth/drive');

    if (insufficientScope || (notFound && !hasDriveRead)) {
      res.status(403).json({
        error: 'resume_scope_missing',
        message:
          "The dashboard's Google sign-in doesn't have permission to read this resume. " +
          'Sign out and back in to grant Drive read access.',
        scopes,
      });
      return;
    }
    if (notFound) {
      res.status(404).json({
        error: 'resume_not_found',
        message:
          "Drive says this file doesn't exist or isn't shared with the signed-in account. " +
          "Open the original URL in Drive — if you can't see it there, the form owner needs to share it.",
        scopes,
      });
      return;
    }
    res.status(500).json({
      error: 'resume_fetch_failed',
      message: msg,
      scopes,
    });
  }
});

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
