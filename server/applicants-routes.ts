import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from './auth.js';
import { fetchApplicants, streamResume } from './applicants.js';

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
  try {
    const fileId = String(req.params.fileId);
    const { stream, mimeType, name } = await streamResume(req.user!.id, fileId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${name.replace(/"/g, '')}"`,
    );
    stream.pipe(res);
  } catch (err) {
    console.error('[applicants] resume stream failed:', err);
    res.status(500).json({
      error: 'resume_fetch_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
