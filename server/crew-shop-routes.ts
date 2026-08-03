/**
 * Crew Shop API.
 *
 * Auth model:
 *   - GET /public/crew-shop/products is UNAUTHENTICATED + CORS-open:
 *     it feeds the merch page on germaniabrewhaus.com (Squarespace),
 *     which fetches it cross-origin from the browser. It serves only
 *     the public lineup — nothing sensitive.
 *   - Everything else requires auth: manual sync trigger, status for
 *     debugging the scraper, and per-product overrides (hide an item,
 *     pin a badge, swap in our own photo).
 */
import { Router, Response } from 'express';
import db from './db.js';
import { requireAuth, AuthRequest } from './auth.js';
import { syncCrewShop, getPublicProducts, getSyncStatus } from './crew-shop.js';

const router = Router();

router.get('/public/crew-shop/products', (_req, res: Response) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    // Squarespace visitors don't need a fresh scrape per pageview; five
    // minutes keeps the page snappy and the server bored.
    'Cache-Control': 'public, max-age=300',
  });
  res.json(getPublicProducts());
});

router.post('/crew-shop/sync', requireAuth, async (_req: AuthRequest, res: Response) => {
  const result = await syncCrewShop();
  res.status(result.ok ? 200 : 502).json(result);
});

router.get('/crew-shop/status', requireAuth, (_req: AuthRequest, res: Response) => {
  res.json(getSyncStatus());
});

router.put('/crew-shop/products/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id FROM crew_shop_products WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'No such product' });

  const { hidden, badge_override, img_override } = req.body ?? {};
  db.prepare(`
    UPDATE crew_shop_products SET
      hidden = COALESCE(?, hidden),
      badge_override = CASE WHEN ? THEN ? ELSE badge_override END,
      img_override = CASE WHEN ? THEN ? ELSE img_override END
    WHERE id = ?
  `).run(
    typeof hidden === 'boolean' ? (hidden ? 1 : 0) : null,
    'badge_override' in (req.body ?? {}) ? 1 : 0, badge_override ?? null,
    'img_override' in (req.body ?? {}) ? 1 : 0, img_override ?? null,
    id,
  );
  res.json({ ok: true });
});

export default router;
