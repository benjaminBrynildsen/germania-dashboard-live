/**
 * REST routes for Bake Haus order management. Mounted under /api/bake-haus.
 */
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from './auth.js';
import { STORES } from './dripos.js';
import {
  BAKE_HAUS_ITEMS,
  deleteOrderItem,
  getCatalogImageMap,
  getWeekReport,
  listSavedOrders,
  markOrderSaved,
  mondayOfWeek,
  unmarkOrderSaved,
  upsertOrderItem,
} from './bake-haus.js';

const router = Router();

router.get('/bake-haus/catalog', requireAuth, async (_req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  const imageMap = await getCatalogImageMap();
  res.json({
    ok: true,
    items: BAKE_HAUS_ITEMS.map(({ name, sort }) => ({
      name,
      sort,
      imageUrl: imageMap[name] ?? null,
    })),
  });
});

router.get('/bake-haus/week', requireAuth, async (req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  const weekParam = String(req.query.week ?? '').trim();
  const week = weekParam || mondayOfWeek();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    res.status(400).json({ error: 'invalid_week', message: 'Expected YYYY-MM-DD.' });
    return;
  }
  const report = await getWeekReport(week);
  res.json({ ok: true, report, stores: STORES.map((s) => s.label) });
});

router.put('/bake-haus/item', requireAuth, (req: AuthRequest, res: Response) => {
  const week = String(req.body?.week ?? '').trim();
  const store = String(req.body?.store ?? '').trim().toUpperCase();
  const item = String(req.body?.item ?? '').trim();
  const rawQty = req.body?.weeklyQty;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    res.status(400).json({ error: 'invalid_week' });
    return;
  }
  if (!STORES.some((s) => s.label === store)) {
    res.status(400).json({ error: 'invalid_store' });
    return;
  }
  if (!item) {
    res.status(400).json({ error: 'invalid_item' });
    return;
  }
  const weeklyQty = Number(rawQty);
  if (!Number.isFinite(weeklyQty) || weeklyQty < 0 || weeklyQty > 100000) {
    res.status(400).json({ error: 'invalid_qty', message: 'Must be a non-negative number under 100000.' });
    return;
  }
  upsertOrderItem({
    weekStartIso: week,
    storeLabel: store,
    itemName: item,
    weeklyQty,
    notes: typeof req.body?.notes === 'string' ? req.body.notes : null,
  });
  res.json({ ok: true });
});

router.get('/bake-haus/saved', requireAuth, (_req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  const orders = listSavedOrders();
  res.json({ ok: true, orders });
});

router.post('/bake-haus/save', requireAuth, (req: AuthRequest, res: Response) => {
  const week = String(req.body?.week ?? '').trim();
  const store = String(req.body?.store ?? '').trim().toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    res.status(400).json({ error: 'invalid_week' });
    return;
  }
  if (!STORES.some((s) => s.label === store)) {
    res.status(400).json({ error: 'invalid_store' });
    return;
  }
  const savedBy = req.user?.name ?? null;
  markOrderSaved(week, store, savedBy);
  res.json({ ok: true, savedAt: Date.now() });
});

router.delete('/bake-haus/save', requireAuth, (req: AuthRequest, res: Response) => {
  const week = String(req.body?.week ?? '').trim();
  const store = String(req.body?.store ?? '').trim().toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    res.status(400).json({ error: 'invalid_week' });
    return;
  }
  if (!STORES.some((s) => s.label === store)) {
    res.status(400).json({ error: 'invalid_store' });
    return;
  }
  unmarkOrderSaved(week, store);
  res.json({ ok: true });
});

router.delete('/bake-haus/item', requireAuth, (req: AuthRequest, res: Response) => {
  const week = String(req.body?.week ?? '').trim();
  const store = String(req.body?.store ?? '').trim().toUpperCase();
  const item = String(req.body?.item ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !STORES.some((s) => s.label === store) || !item) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  deleteOrderItem(week, store, item);
  res.json({ ok: true });
});

export default router;
