import { Router, Response } from 'express';
import db from './db.js';
import { requireAuth, AuthRequest } from './auth.js';

const router = Router();

type SeasonRow = { id: number; name: string; created_at: number; updated_at: number };
type CategoryRow = { id: number; season_id: number; name: string; subtitle: string | null; position: number; side: string };
type ItemRow = { id: number; category_id: number; name: string; description: string | null; kind: string; position: number; size_labels_json: string | null; prices_json: string | null; temps: string | null; has_spotify: number; frozen_note: string | null; layout: string; pair_position: string | null; food_price: string | null; food_subtitle: string | null; is_new: number };
type ItemLocationRow = { item_id: number; location: string; price_override: string | null };
type ListRow = { id: number; season_id: number; name: string; position: number; side: string };
type ListItemRow = { id: number; list_id: number; name: string; position: number };

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function assembleItem(r: ItemRow, locations: ItemLocationRow[]): any {
  return {
    id: r.id,
    categoryId: r.category_id,
    name: r.name,
    description: r.description,
    kind: r.kind,
    position: r.position,
    sizeLabels: safeJson<string[] | null>(r.size_labels_json, null),
    prices: safeJson<string[] | null>(r.prices_json, null),
    temps: r.temps,
    hasSpotify: r.has_spotify === 1,
    frozenNote: r.frozen_note,
    layout: r.layout,
    pairPosition: r.pair_position,
    foodPrice: r.food_price,
    foodSubtitle: r.food_subtitle,
    isNew: r.is_new === 1,
    locations: locations.map((l) => ({ location: l.location, priceOverride: l.price_override })),
  };
}

function assembleSeason(id: number) {
  const season = db.prepare('SELECT * FROM menu_seasons WHERE id = ?').get(id) as SeasonRow | undefined;
  if (!season) return null;

  const categories = db.prepare('SELECT * FROM menu_categories WHERE season_id = ? ORDER BY position, id').all(season.id) as CategoryRow[];
  const catIds = categories.map((c) => c.id);

  let itemsByCategory = new Map<number, any[]>();
  if (catIds.length > 0) {
    const items = db.prepare(`SELECT * FROM menu_items WHERE category_id IN (${catIds.map(() => '?').join(',')}) ORDER BY position, id`).all(...catIds) as ItemRow[];
    const itemIds = items.map((i) => i.id);
    let locsByItem = new Map<number, ItemLocationRow[]>();
    if (itemIds.length > 0) {
      const locs = db.prepare(`SELECT * FROM menu_item_locations WHERE item_id IN (${itemIds.map(() => '?').join(',')}) ORDER BY location`).all(...itemIds) as ItemLocationRow[];
      for (const l of locs) {
        const arr = locsByItem.get(l.item_id) ?? [];
        arr.push(l);
        locsByItem.set(l.item_id, arr);
      }
    }
    for (const item of items) {
      const arr = itemsByCategory.get(item.category_id) ?? [];
      arr.push(assembleItem(item, locsByItem.get(item.id) ?? []));
      itemsByCategory.set(item.category_id, arr);
    }
  }

  const lists = db.prepare('SELECT * FROM menu_lists WHERE season_id = ? ORDER BY position, id').all(season.id) as ListRow[];
  const listIds = lists.map((l) => l.id);
  let listItemsByList = new Map<number, ListItemRow[]>();
  if (listIds.length > 0) {
    const listItems = db.prepare(`SELECT * FROM menu_list_items WHERE list_id IN (${listIds.map(() => '?').join(',')}) ORDER BY position, id`).all(...listIds) as ListItemRow[];
    for (const li of listItems) {
      const arr = listItemsByList.get(li.list_id) ?? [];
      arr.push(li);
      listItemsByList.set(li.list_id, arr);
    }
  }

  return {
    id: season.id,
    name: season.name,
    createdAt: season.created_at,
    updatedAt: season.updated_at,
    categories: categories.map((c) => ({
      id: c.id,
      seasonId: c.season_id,
      name: c.name,
      subtitle: c.subtitle,
      position: c.position,
      side: c.side,
      items: itemsByCategory.get(c.id) ?? [],
    })),
    lists: lists.map((l) => ({
      id: l.id,
      seasonId: l.season_id,
      name: l.name,
      position: l.position,
      side: l.side,
      items: (listItemsByList.get(l.id) ?? []).map((li) => ({
        id: li.id,
        listId: li.list_id,
        name: li.name,
        position: li.position,
      })),
    })),
  };
}

// ---- Season CRUD ----

router.get('/menu-seasons', requireAuth, (_req, res: Response) => {
  const rows = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id WHERE mc.season_id = s.id) AS item_count
    FROM menu_seasons s ORDER BY s.updated_at DESC
  `).all() as (SeasonRow & { item_count: number })[];
  res.json({
    seasons: rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      itemCount: r.item_count,
    })),
  });
});

router.post('/menu-seasons', requireAuth, (req: AuthRequest, res: Response) => {
  const { name, copyFromId } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) { res.status(400).json({ error: 'name_required' }); return; }

  const now = Date.now();

  if (copyFromId) {
    const source = assembleSeason(Number(copyFromId));
    if (!source) { res.status(404).json({ error: 'source_season_not_found' }); return; }

    const tx = db.transaction(() => {
      const result = db.prepare('INSERT INTO menu_seasons (name, created_at, updated_at) VALUES (?, ?, ?)').run(name.trim(), now, now);
      const newSeasonId = Number(result.lastInsertRowid);

      const insertCat = db.prepare('INSERT INTO menu_categories (season_id, name, subtitle, position, side) VALUES (?, ?, ?, ?, ?)');
      const insertItem = db.prepare('INSERT INTO menu_items (category_id, name, description, kind, position, size_labels_json, prices_json, temps, has_spotify, frozen_note, layout, pair_position, food_price, food_subtitle, is_new) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const insertLoc = db.prepare('INSERT INTO menu_item_locations (item_id, location, price_override) VALUES (?, ?, ?)');
      const insertList = db.prepare('INSERT INTO menu_lists (season_id, name, position, side) VALUES (?, ?, ?, ?)');
      const insertListItem = db.prepare('INSERT INTO menu_list_items (list_id, name, position) VALUES (?, ?, ?)');

      for (const cat of source.categories) {
        const catResult = insertCat.run(newSeasonId, cat.name, cat.subtitle, cat.position, cat.side);
        const newCatId = Number(catResult.lastInsertRowid);
        for (const item of cat.items) {
          const itemResult = insertItem.run(newCatId, item.name, item.description, item.kind, item.position, item.sizeLabels ? JSON.stringify(item.sizeLabels) : null, item.prices ? JSON.stringify(item.prices) : null, item.temps, item.hasSpotify ? 1 : 0, item.frozenNote, item.layout, item.pairPosition, item.foodPrice, item.foodSubtitle, item.isNew ? 1 : 0);
          const newItemId = Number(itemResult.lastInsertRowid);
          for (const loc of item.locations) {
            insertLoc.run(newItemId, loc.location, loc.priceOverride);
          }
        }
      }

      for (const list of source.lists) {
        const listResult = insertList.run(newSeasonId, list.name, list.position, list.side);
        const newListId = Number(listResult.lastInsertRowid);
        for (const li of list.items) {
          insertListItem.run(newListId, li.name, li.position);
        }
      }

      return newSeasonId;
    });

    const newId = tx();
    const season = assembleSeason(newId);
    res.status(201).json({ season });
    return;
  }

  const result = db.prepare('INSERT INTO menu_seasons (name, created_at, updated_at) VALUES (?, ?, ?)').run(name.trim(), now, now);
  const season = assembleSeason(Number(result.lastInsertRowid));
  res.status(201).json({ season });
});

router.get('/menu-seasons/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const season = assembleSeason(Number(req.params.id));
  if (!season) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ season });
});

router.put('/menu-seasons/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) { res.status(400).json({ error: 'name_required' }); return; }
  db.prepare('UPDATE menu_seasons SET name = ?, updated_at = ? WHERE id = ?').run(name.trim(), Date.now(), id);
  res.json({ ok: true });
});

router.delete('/menu-seasons/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  db.prepare('DELETE FROM menu_seasons WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---- Category CRUD ----

router.post('/menu-categories', requireAuth, (req: AuthRequest, res: Response) => {
  const { seasonId, name, subtitle, side, position } = req.body || {};
  if (!seasonId || typeof name !== 'string' || !name.trim()) { res.status(400).json({ error: 'seasonId_and_name_required' }); return; }
  const pos = typeof position === 'number' ? position : (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM menu_categories WHERE season_id = ?').get(seasonId) as { p: number }).p;
  const result = db.prepare('INSERT INTO menu_categories (season_id, name, subtitle, position, side) VALUES (?, ?, ?, ?, ?)').run(seasonId, name.trim(), subtitle ?? null, pos, side || 'front');
  db.prepare('UPDATE menu_seasons SET updated_at = ? WHERE id = ?').run(Date.now(), seasonId);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.put('/menu-categories/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  const { name, subtitle, position, side } = req.body || {};
  const sets: string[] = [];
  const args: any[] = [];
  if (typeof name === 'string' && name.trim()) { sets.push('name = ?'); args.push(name.trim()); }
  if (subtitle !== undefined) { sets.push('subtitle = ?'); args.push(subtitle || null); }
  if (typeof position === 'number') { sets.push('position = ?'); args.push(position); }
  if (side) { sets.push('side = ?'); args.push(side); }
  if (!sets.length) { res.status(400).json({ error: 'nothing_to_update' }); return; }
  args.push(id);
  db.prepare(`UPDATE menu_categories SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  const cat = db.prepare('SELECT season_id FROM menu_categories WHERE id = ?').get(id) as { season_id: number } | undefined;
  if (cat) db.prepare('UPDATE menu_seasons SET updated_at = ? WHERE id = ?').run(Date.now(), cat.season_id);
  res.json({ ok: true });
});

router.delete('/menu-categories/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  const cat = db.prepare('SELECT season_id FROM menu_categories WHERE id = ?').get(id) as { season_id: number } | undefined;
  db.prepare('DELETE FROM menu_categories WHERE id = ?').run(id);
  if (cat) db.prepare('UPDATE menu_seasons SET updated_at = ? WHERE id = ?').run(Date.now(), cat.season_id);
  res.json({ ok: true });
});

// ---- Item CRUD ----

router.post('/menu-items', requireAuth, (req: AuthRequest, res: Response) => {
  const b = req.body || {};
  if (!b.categoryId || typeof b.name !== 'string' || !b.name.trim()) { res.status(400).json({ error: 'categoryId_and_name_required' }); return; }
  const pos = typeof b.position === 'number' ? b.position : (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM menu_items WHERE category_id = ?').get(b.categoryId) as { p: number }).p;
  const result = db.prepare(`INSERT INTO menu_items (category_id, name, kind, description, position, size_labels_json, prices_json, temps, has_spotify, frozen_note, layout, pair_position, food_price, food_subtitle, is_new) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    b.categoryId, b.name.trim(), b.kind || 'drink', b.description ?? null, pos,
    b.sizeLabels ? JSON.stringify(b.sizeLabels) : null,
    b.prices ? JSON.stringify(b.prices) : null,
    b.temps ?? null, b.hasSpotify ? 1 : 0, b.frozenNote ?? null,
    b.layout || 'full', b.pairPosition ?? null, b.foodPrice ?? null, b.foodSubtitle ?? null, b.isNew ? 1 : 0,
  );
  const newId = Number(result.lastInsertRowid);

  if (Array.isArray(b.locations)) {
    const ins = db.prepare('INSERT INTO menu_item_locations (item_id, location, price_override) VALUES (?, ?, ?)');
    for (const loc of b.locations) {
      if (loc && typeof loc.location === 'string') ins.run(newId, loc.location, loc.priceOverride ?? null);
    }
  }

  const cat = db.prepare('SELECT season_id FROM menu_categories WHERE id = ?').get(b.categoryId) as { season_id: number } | undefined;
  if (cat) db.prepare('UPDATE menu_seasons SET updated_at = ? WHERE id = ?').run(Date.now(), cat.season_id);
  res.status(201).json({ id: newId });
});

router.put('/menu-items/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  const b = req.body || {};
  const sets: string[] = [];
  const args: any[] = [];
  const stringFields: Array<[string, string]> = [
    ['name', 'name'], ['description', 'description'], ['kind', 'kind'],
    ['temps', 'temps'], ['frozenNote', 'frozen_note'], ['layout', 'layout'],
    ['pairPosition', 'pair_position'], ['foodPrice', 'food_price'], ['foodSubtitle', 'food_subtitle'],
  ];
  for (const [jsKey, dbCol] of stringFields) {
    if (b[jsKey] !== undefined) { sets.push(`${dbCol} = ?`); args.push(b[jsKey] ?? null); }
  }
  if (typeof b.position === 'number') { sets.push('position = ?'); args.push(b.position); }
  if (b.sizeLabels !== undefined) { sets.push('size_labels_json = ?'); args.push(b.sizeLabels ? JSON.stringify(b.sizeLabels) : null); }
  if (b.prices !== undefined) { sets.push('prices_json = ?'); args.push(b.prices ? JSON.stringify(b.prices) : null); }
  if (b.hasSpotify !== undefined) { sets.push('has_spotify = ?'); args.push(b.hasSpotify ? 1 : 0); }
  if (b.isNew !== undefined) { sets.push('is_new = ?'); args.push(b.isNew ? 1 : 0); }
  if (b.categoryId !== undefined) { sets.push('category_id = ?'); args.push(b.categoryId); }
  if (!sets.length) { res.status(400).json({ error: 'nothing_to_update' }); return; }
  args.push(id);
  db.prepare(`UPDATE menu_items SET ${sets.join(', ')} WHERE id = ?`).run(...args);

  const item = db.prepare('SELECT category_id FROM menu_items WHERE id = ?').get(id) as { category_id: number } | undefined;
  if (item) {
    const cat = db.prepare('SELECT season_id FROM menu_categories WHERE id = ?').get(item.category_id) as { season_id: number } | undefined;
    if (cat) db.prepare('UPDATE menu_seasons SET updated_at = ? WHERE id = ?').run(Date.now(), cat.season_id);
  }
  res.json({ ok: true });
});

router.delete('/menu-items/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  const item = db.prepare('SELECT mi.category_id, mc.season_id FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id WHERE mi.id = ?').get(id) as { category_id: number; season_id: number } | undefined;
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
  if (item) db.prepare('UPDATE menu_seasons SET updated_at = ? WHERE id = ?').run(Date.now(), item.season_id);
  res.json({ ok: true });
});

router.put('/menu-items/:id/locations', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  const { locations } = req.body || {};
  if (!Array.isArray(locations)) { res.status(400).json({ error: 'locations_array_required' }); return; }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM menu_item_locations WHERE item_id = ?').run(id);
    const ins = db.prepare('INSERT INTO menu_item_locations (item_id, location, price_override) VALUES (?, ?, ?)');
    for (const loc of locations) {
      if (loc && typeof loc.location === 'string') ins.run(id, loc.location, loc.priceOverride ?? null);
    }
  });
  tx();
  res.json({ ok: true });
});

// ---- List CRUD ----

router.post('/menu-lists', requireAuth, (req: AuthRequest, res: Response) => {
  const { seasonId, name, side, position } = req.body || {};
  if (!seasonId || typeof name !== 'string' || !name.trim()) { res.status(400).json({ error: 'seasonId_and_name_required' }); return; }
  const pos = typeof position === 'number' ? position : (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM menu_lists WHERE season_id = ?').get(seasonId) as { p: number }).p;
  const result = db.prepare('INSERT INTO menu_lists (season_id, name, position, side) VALUES (?, ?, ?, ?)').run(seasonId, name.trim(), pos, side || 'front');
  db.prepare('UPDATE menu_seasons SET updated_at = ? WHERE id = ?').run(Date.now(), seasonId);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.put('/menu-lists/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  const b = req.body || {};
  const sets: string[] = [];
  const args: any[] = [];
  if (typeof b.name === 'string' && b.name.trim()) { sets.push('name = ?'); args.push(b.name.trim()); }
  if (typeof b.position === 'number') { sets.push('position = ?'); args.push(b.position); }
  if (b.side) { sets.push('side = ?'); args.push(b.side); }
  if (sets.length) {
    args.push(id);
    db.prepare(`UPDATE menu_lists SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  }

  // Replace list items if provided
  if (Array.isArray(b.items)) {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM menu_list_items WHERE list_id = ?').run(id);
      const ins = db.prepare('INSERT INTO menu_list_items (list_id, name, position) VALUES (?, ?, ?)');
      for (const item of b.items) {
        if (item && typeof item.name === 'string' && item.name.trim()) {
          ins.run(id, item.name.trim(), typeof item.position === 'number' ? item.position : 0);
        }
      }
    });
    tx();
  }

  const list = db.prepare('SELECT season_id FROM menu_lists WHERE id = ?').get(id) as { season_id: number } | undefined;
  if (list) db.prepare('UPDATE menu_seasons SET updated_at = ? WHERE id = ?').run(Date.now(), list.season_id);
  res.json({ ok: true });
});

router.delete('/menu-lists/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  const list = db.prepare('SELECT season_id FROM menu_lists WHERE id = ?').get(id) as { season_id: number } | undefined;
  db.prepare('DELETE FROM menu_lists WHERE id = ?').run(id);
  if (list) db.prepare('UPDATE menu_seasons SET updated_at = ? WHERE id = ?').run(Date.now(), list.season_id);
  res.json({ ok: true });
});

// ---- Bulk reorder ----

router.put('/menu-categories/reorder', requireAuth, (req: AuthRequest, res: Response) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) { res.status(400).json({ error: 'ids_array_required' }); return; }
  const tx = db.transaction(() => {
    const stmt = db.prepare('UPDATE menu_categories SET position = ? WHERE id = ?');
    ids.forEach((id: number, i: number) => stmt.run(i, id));
  });
  tx();
  res.json({ ok: true });
});

router.put('/menu-items/reorder', requireAuth, (req: AuthRequest, res: Response) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) { res.status(400).json({ error: 'ids_array_required' }); return; }
  const tx = db.transaction(() => {
    const stmt = db.prepare('UPDATE menu_items SET position = ? WHERE id = ?');
    ids.forEach((id: number, i: number) => stmt.run(i, id));
  });
  tx();
  res.json({ ok: true });
});

// ---- PDF export (placeholder) ----

router.get('/menu-seasons/:id/pdf', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  const season = db.prepare('SELECT id FROM menu_seasons WHERE id = ?').get(id);
  if (!season) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ status: 'pdf_not_implemented', seasonId: id, location: req.query.location || null });
});

export default router;
