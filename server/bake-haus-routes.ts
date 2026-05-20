/**
 * REST routes for Bake Haus order management. Mounted under /api/bake-haus.
 */
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from './auth.js';
import { STORES } from './dripos.js';
import { fetchAllProducts, STORES as DRIPOS_STORES } from './dripos.js';
import {
  BAKE_HAUS_ITEMS,
  createSyrup,
  deleteOrderItem,
  deleteSyrup,
  getCatalogImageMap,
  getMergedCatalog,
  getWeekReport,
  isUserAllowedToUnlock,
  isWeekLocked,
  listSavedOrders,
  listSyrups,
  lockWeek,
  lockWeekMonday,
  markOrderSaved,
  mondayOfWeek,
  snapshotMonForStoreWeek,
  unlockWeek,
  unlockWeekMonday,
  unmarkOrderSaved,
  updateSyrup,
  upsertOrderItem,
} from './bake-haus.js';

const router = Router();

router.get('/bake-haus/catalog', requireAuth, async (_req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  const imageMap = await getCatalogImageMap();
  const merged = getMergedCatalog();
  res.json({
    ok: true,
    items: merged.map((c) => ({
      name: c.name,
      sort: c.sort,
      category: c.category,
      includeMonday: c.includeMonday,
      imageUrl: imageMap[c.name] ?? null,
    })),
  });
});

// ─── Syrup catalog management ─────────────────────────────────────

router.get('/bake-haus/syrups', requireAuth, (_req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  // Always include inactive — the manage UI needs to see the toggle.
  res.json({ ok: true, syrups: listSyrups(true) });
});

/** Returns the Dripos product list (one call, first store's catalog
 *  — products are chain-shared) so Maggie can pick from a dropdown
 *  when adding a syrup. Filtered to a syrup-like candidate set
 *  (BOTTLE- prefix, sauce category, etc.) is up to the UI to filter
 *  further; we ship the raw list so future categories don't need a
 *  backend change. */
router.get('/bake-haus/dripos-products', requireAuth, async (_req: AuthRequest, res: Response) => {
  res.set('Cache-Control', 'no-store');
  try {
    // Use the unfiltered product list — bottles + sauces sit in their
    // own Dripos categories outside BAKE HAUS FOOD. The UI search
    // filter narrows down from there.
    const products = await fetchAllProducts(DRIPOS_STORES[0].locationId);
    // Build a category breakdown so we can spot when Dripos returns
    // fewer items than expected (e.g., paginated response, missing
    // category, etc.). Shipped alongside the list so it's visible
    // both in the UI dropdown footer and in the Network panel.
    const categories: Record<string, number> = {};
    for (const p of products) {
      categories[p.CATEGORY_NAME] = (categories[p.CATEGORY_NAME] ?? 0) + 1;
    }
    res.json({
      ok: true,
      totalCount: products.length,
      categories,
      products: products.map((p) => ({
        id: p.ID, name: p.NAME, categoryName: p.CATEGORY_NAME,
      })),
    });
  } catch (err) {
    console.error('[bake-haus-dripos-products]', err);
    res.status(500).json({ error: 'fetch_failed', message: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/bake-haus/syrups', requireAuth, (req: AuthRequest, res: Response) => {
  const displayName = String(req.body?.displayName ?? '').trim();
  const driposProductId = Number(req.body?.driposProductId);
  const driposProductName = String(req.body?.driposProductName ?? '').trim();
  const sort = req.body?.sort != null ? Number(req.body.sort) : 100;
  const includeMonday = req.body?.includeMonday === true;
  if (!displayName) {
    res.status(400).json({ error: 'invalid_display_name' });
    return;
  }
  if (!Number.isFinite(driposProductId) || driposProductId <= 0) {
    res.status(400).json({ error: 'invalid_dripos_id' });
    return;
  }
  if (!driposProductName) {
    res.status(400).json({ error: 'invalid_dripos_name' });
    return;
  }
  const syrup = createSyrup({ displayName, driposProductId, driposProductName, sort, includeMonday });
  res.json({ ok: true, syrup });
});

router.put('/bake-haus/syrups/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const patch: Parameters<typeof updateSyrup>[1] = {};
  if (typeof req.body?.displayName === 'string')        patch.displayName = req.body.displayName.trim();
  if (typeof req.body?.driposProductId === 'number')    patch.driposProductId = req.body.driposProductId;
  if (typeof req.body?.driposProductName === 'string')  patch.driposProductName = req.body.driposProductName.trim();
  if (typeof req.body?.sort === 'number')               patch.sort = req.body.sort;
  if (typeof req.body?.includeMonday === 'boolean')     patch.includeMonday = req.body.includeMonday;
  if (typeof req.body?.active === 'boolean')            patch.active = req.body.active;
  const updated = updateSyrup(id, patch);
  if (!updated) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true, syrup: updated });
});

router.delete('/bake-haus/syrups/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const ok = deleteSyrup(id);
  if (!ok) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ ok: true });
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
  // Locked-week gate: once the week is locked, only Chef Maggie (and
  // emails listed in BAKE_HAUS_UNLOCK_EMAILS / ADMIN_EMAILS) can edit
  // quantities. Everyone else gets a 403 with the user-facing message
  // the frontend turns into a modal.
  if (isWeekLocked(week) && !isUserAllowedToUnlock(req.user?.email ?? null)) {
    res.status(403).json({
      error: 'week_locked',
      message: 'Bake quantities for this week were locked Monday night. Contact Chef Maggie to request a change.',
    });
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

router.post('/bake-haus/save', requireAuth, async (req: AuthRequest, res: Response) => {
  const week = String(req.body?.week ?? '').trim();
  const store = String(req.body?.store ?? '').trim().toUpperCase();
  const snapshotMon = req.body?.snapshotMon === true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    res.status(400).json({ error: 'invalid_week' });
    return;
  }
  if (!STORES.some((s) => s.label === store)) {
    res.status(400).json({ error: 'invalid_store' });
    return;
  }
  // The "saved" marker is a per-store finalization signal that doesn't
  // touch qtys, so the lock allowlist is enforced at the per-item PUT
  // (where edits actually happen) rather than here. Saving an unchanged
  // order after lock is harmless and keeps the saved-orders tab accurate.
  const savedBy = req.user?.name ?? null;
  // Snapshot the per-row Mon qty before marking saved, so future
  // "Lock Mon" picks have this baseline to fall back to. Only fired
  // on baseline saves (initial save + "update everything") — not
  // when the user is actively asking to LOCK Mon at the current value.
  // Skip the snapshot when the week is already locked — the per-row
  // *_locked_qty values are authoritative and shouldn't be overwritten.
  if (snapshotMon && !isWeekLocked(week)) {
    await snapshotMonForStoreWeek(week, store);
  }
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

/**
 * Lock the week's deliveries — snapshots each row's current Mon/Wed/Fri
 * split into the per-day `*_locked_qty` columns. After this, edits are
 * blocked for users not on the unlock allowlist (BAKE_HAUS_UNLOCK_EMAILS).
 *
 * Body params:
 *   week: YYYY-MM-DD (required) — Monday of the week to lock
 *   asOfMs: number (optional) — when set and in the past, reconstructs
 *           inventory at that timestamp using Dripos sales between asOfMs
 *           and now, so a mid-week lock captures last-night's state
 *           instead of post-customer-traffic state. Omit for live lock.
 *   source: 'manual' | 'auto' (default 'manual')
 *
 * Idempotent: re-locking a locked week is safe and updates the lock
 * timestamp. Per-row snapshots are preserved on re-lock.
 */
router.post('/bake-haus/lock-week', requireAuth, async (req: AuthRequest, res: Response) => {
  const week = String(req.body?.week ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    res.status(400).json({ error: 'invalid_week' });
    return;
  }
  const asOfMs = req.body?.asOfMs;
  const asOf = (typeof asOfMs === 'number' && Number.isFinite(asOfMs) && asOfMs > 0) ? asOfMs : null;
  const source = req.body?.source === 'auto' ? 'auto' : 'manual';
  try {
    const result = await lockWeek(week, req.user?.name ?? null, source, asOf);
    res.json({ ok: true, lockedAt: Date.now(), ...result });
  } catch (err) {
    console.error('[bake-haus-lock-week] failed:', err);
    res.status(500).json({
      error: 'lock_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.delete('/bake-haus/lock-week', requireAuth, (req: AuthRequest, res: Response) => {
  const week = String(req.body?.week ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    res.status(400).json({ error: 'invalid_week' });
    return;
  }
  if (!isUserAllowedToUnlock(req.user?.email ?? null)) {
    res.status(403).json({
      error: 'unlock_not_allowed',
      message: 'Only the bakery email can unlock a week. Contact Chef Maggie if you need a change.',
    });
    return;
  }
  unlockWeek(week);
  res.json({ ok: true });
});

/**
 * Legacy Mon-only lock — preserved so existing frontends keep working
 * during deploy. New code should call /lock-week instead. Delegates
 * to lockWeek under the hood (snapshots all three days, not just Mon).
 */
router.post('/bake-haus/lock-monday', requireAuth, async (req: AuthRequest, res: Response) => {
  const week = String(req.body?.week ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    res.status(400).json({ error: 'invalid_week' });
    return;
  }
  await lockWeekMonday(week, req.user?.name ?? null);
  res.json({ ok: true, lockedAt: Date.now() });
});

router.delete('/bake-haus/lock-monday', requireAuth, (req: AuthRequest, res: Response) => {
  const week = String(req.body?.week ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    res.status(400).json({ error: 'invalid_week' });
    return;
  }
  if (!isUserAllowedToUnlock(req.user?.email ?? null)) {
    res.status(403).json({
      error: 'unlock_not_allowed',
      message: 'Only the bakery email can unlock a week.',
    });
    return;
  }
  unlockWeekMonday(week);
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
  if (isWeekLocked(week) && !isUserAllowedToUnlock(req.user?.email ?? null)) {
    res.status(403).json({
      error: 'week_locked',
      message: 'Bake quantities for this week were locked Monday night. Contact Chef Maggie to request a change.',
    });
    return;
  }
  deleteOrderItem(week, store, item);
  res.json({ ok: true });
});

export default router;
