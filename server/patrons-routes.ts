/**
 * Patron CSV upload + funnel endpoints. Mounted under /api/patrons.
 */
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from './auth.js';
import { buildFunnelReport, parsePatronsCsv, replacePatrons } from './patrons.js';

const router = Router();

router.get('/patrons/funnel', requireAuth, (_req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, report: buildFunnelReport() });
});

router.post('/patrons/upload', requireAuth, (req: AuthRequest, res: Response) => {
  const body = req.body;
  const csv = typeof body === 'string' ? body : (body?.csv ?? '');
  if (!csv || typeof csv !== 'string' || csv.length < 20) {
    res.status(400).json({ error: 'empty_or_invalid_csv' });
    return;
  }
  if (csv.length > 20 * 1024 * 1024) {
    res.status(413).json({ error: 'csv_too_large', message: 'Max 20MB.' });
    return;
  }
  try {
    const parsed = parsePatronsCsv(csv);
    if (parsed.length === 0) {
      res.status(400).json({
        error: 'no_rows_parsed',
        message: 'No rows parsed. Make sure the file is the Dripos All Patrons CSV export.',
      });
      return;
    }
    const filename = typeof req.query.filename === 'string' ? req.query.filename : null;
    const { rowCount } = replacePatrons(parsed, {
      uploadedBy: req.user?.name ?? null,
      filename,
    });
    res.json({ ok: true, rowCount, report: buildFunnelReport() });
  } catch (err) {
    console.error('[patrons-upload] failed:', err);
    res.status(500).json({
      error: 'parse_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
