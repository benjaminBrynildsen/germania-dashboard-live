/**
 * Menu Team SOP builder API — CRUD on drink SOPs + PDF export.
 *
 * Auth: read endpoints require auth (any role can browse the binder
 * of seasonal SOPs); write/delete require admin, manager, or menu_team
 * since the menu team owns recipe authority.
 */
import { Router, Response } from 'express';
import db from './db.js';
import { requireAuth, AuthRequest } from './auth.js';
import type { Sop, SopVariant, SopRow, SopFootnote, Temperature, Availability } from '../src/lib/sop-types.js';
import { AVAILABILITY_OPTIONS, SOP_CATEGORIES } from '../src/lib/sop-types.js';
import JSZip from 'jszip';
import { renderSopsToPdfBuffer } from './sop-pdf.js';
import { renderPacketPdfBuffer } from './sop-packet-pdf.js';
import { expandTemplate, listTemplates } from './sop-templates.js';

const router = Router();

// Menu Team SOP tooling is internal to Germania — auth alone (any
// Germania-domain account) is enough; we don't gate writes by role
// because the whole team contributes to recipes.
const TEMPS: Temperature[] = ['iced', 'frozen', 'hot'];

type SopRowDb = { id: number; sop_id: number; slug: string; name: string; collection: string | null; dietary_tags: string | null; syrup_dietary_tags: string | null; drink_contains: string | null; refrigeration_note: string | null; category: string | null; availability: string | null; sop_required: number; subtitle: string | null; availability_note: string | null; created_at: number; updated_at: number };
type VariantRowDb = { id: number; sop_id: number; temperature: Temperature; position: number; size_labels_json: string; footnotes_json: string; assembly_big_idea: string | null; assembly_steps_json: string | null };
type RowRowDb = { id: number; variant_id: number; position: number; preset_id: number | null; name: string; modifier: string | null; cells_json: string };

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'sop';
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function loadSop(slug: string): Sop | null {
  const row = db.prepare('SELECT * FROM sops WHERE slug = ?').get(slug) as SopRowDb | undefined;
  if (!row) return null;
  return assembleSop(row);
}

function loadSopById(id: number): Sop | null {
  const row = db.prepare('SELECT * FROM sops WHERE id = ?').get(id) as SopRowDb | undefined;
  if (!row) return null;
  return assembleSop(row);
}

function assembleSop(row: SopRowDb): Sop {
  const variants = db.prepare('SELECT * FROM sop_variants WHERE sop_id = ? ORDER BY position, id').all(row.id) as VariantRowDb[];
  const out: Sop = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    collection: row.collection,
    dietaryTags: row.dietary_tags,
    syrupDietaryTags: row.syrup_dietary_tags,
    drinkContains: row.drink_contains,
    refrigerationNote: row.refrigeration_note,
    category: row.category,
    availability: (row.availability as Availability | null),
    sopRequired: row.sop_required !== 0,
    subtitle: row.subtitle,
    availabilityNote: row.availability_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    variants: variants.map((v) => {
      const rows = db.prepare('SELECT * FROM sop_rows WHERE variant_id = ? ORDER BY position, id').all(v.id) as RowRowDb[];
      return {
        id: v.id,
        temperature: v.temperature,
        position: v.position,
        sizeLabels: safeJson<string[]>(v.size_labels_json, ['Kids', 'R', 'L']),
        footnotes: safeJson<SopFootnote[]>(v.footnotes_json, []),
        assemblyBigIdea: v.assembly_big_idea,
        assemblySteps: safeJson<string[] | null>(v.assembly_steps_json, null),
        rows: rows.map((r) => ({
          id: r.id,
          presetId: r.preset_id,
          name: r.name,
          modifier: r.modifier,
          cells: safeJson<string[]>(r.cells_json, []),
        })),
      } satisfies SopVariant;
    }),
  };
  return out;
}

function ensureUniqueSlug(base: string, excludeId?: number): string {
  let slug = base;
  let n = 1;
  // Lookup conflict and bump suffix until free. Caps at 50 attempts so a
  // pathological collision storm can't spin.
  while (n < 50) {
    const hit = db.prepare('SELECT id FROM sops WHERE slug = ?').get(slug) as { id: number } | undefined;
    if (!hit || hit.id === excludeId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

function validatePayload(body: any, requireName: boolean): { ok: true; clean: Partial<Sop> } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'body_required' };
  const out: Partial<Sop> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { ok: false, error: 'name_required' };
    out.name = body.name.trim().slice(0, 120);
  } else if (requireName) {
    return { ok: false, error: 'name_required' };
  }
  for (const k of ['collection', 'dietaryTags', 'syrupDietaryTags', 'drinkContains', 'refrigerationNote', 'subtitle', 'availabilityNote'] as const) {
    if (body[k] !== undefined) {
      if (body[k] === null || body[k] === '') (out as any)[k] = null;
      else if (typeof body[k] !== 'string') return { ok: false, error: `invalid_${k}` };
      else (out as any)[k] = body[k].slice(0, 500);
    }
  }
  if (body.category !== undefined) {
    if (body.category === null || body.category === '') (out as any).category = null;
    else if (typeof body.category !== 'string' || !SOP_CATEGORIES.find((c) => c.key === body.category)) return { ok: false, error: 'invalid_category' };
    else (out as any).category = body.category;
  }
  if (body.availability !== undefined) {
    if (body.availability === null || body.availability === '') (out as any).availability = null;
    else if (typeof body.availability !== 'string' || !AVAILABILITY_OPTIONS.includes(body.availability as Availability)) return { ok: false, error: 'invalid_availability' };
    else (out as any).availability = body.availability;
  }
  if (body.sopRequired !== undefined) {
    (out as any).sopRequired = !!body.sopRequired;
  }
  if (body.slug !== undefined) {
    if (typeof body.slug !== 'string') return { ok: false, error: 'invalid_slug' };
    out.slug = slugify(body.slug);
  }
  if (body.variants !== undefined) {
    if (!Array.isArray(body.variants)) return { ok: false, error: 'variants_must_be_array' };
    const seen = new Set<string>();
    const variants: SopVariant[] = [];
    for (const v of body.variants) {
      if (!v || typeof v !== 'object') return { ok: false, error: 'invalid_variant' };
      if (!TEMPS.includes(v.temperature)) return { ok: false, error: 'invalid_temperature' };
      if (seen.has(v.temperature)) return { ok: false, error: 'duplicate_temperature' };
      seen.add(v.temperature);
      if (!Array.isArray(v.sizeLabels) || v.sizeLabels.length === 0) return { ok: false, error: 'size_labels_required' };
      const sizeCount = v.sizeLabels.length;
      const rows: SopRow[] = [];
      if (!Array.isArray(v.rows)) return { ok: false, error: 'rows_must_be_array' };
      for (const r of v.rows) {
        if (!r || typeof r !== 'object') return { ok: false, error: 'invalid_row' };
        if (typeof r.name !== 'string' || !r.name.trim()) return { ok: false, error: 'row_name_required' };
        if (!Array.isArray(r.cells)) return { ok: false, error: 'cells_must_be_array' };
        // Pad / truncate cells to match sizeLabels length so the table
        // can't go ragged after a size-column edit.
        const cells: string[] = [];
        for (let i = 0; i < sizeCount; i++) cells.push(typeof r.cells[i] === 'string' ? r.cells[i] : '');
        rows.push({
          id: typeof r.id === 'number' ? r.id : undefined,
          presetId: typeof r.presetId === 'number' ? r.presetId : null,
          name: r.name.trim().slice(0, 200),
          modifier: typeof r.modifier === 'string' && r.modifier.trim() ? r.modifier.trim().slice(0, 200) : null,
          cells,
        });
      }
      const footnotes: SopFootnote[] = Array.isArray(v.footnotes)
        ? v.footnotes
            .filter((f: any) => f && typeof f.text === 'string' && f.text.trim())
            .map((f: any) => ({ marker: typeof f.marker === 'string' && f.marker ? f.marker.slice(0, 5) : '*', text: f.text.trim().slice(0, 500) }))
        : [];
      variants.push({
        id: typeof v.id === 'number' ? v.id : undefined,
        temperature: v.temperature,
        position: typeof v.position === 'number' ? v.position : TEMPS.indexOf(v.temperature),
        sizeLabels: v.sizeLabels.map((s: any) => String(s).slice(0, 40)),
        footnotes,
        assemblyBigIdea: typeof v.assemblyBigIdea === 'string' && v.assemblyBigIdea.trim() ? v.assemblyBigIdea.trim().slice(0, 500) : null,
        assemblySteps: Array.isArray(v.assemblySteps) && v.assemblySteps.length > 0
          ? v.assemblySteps.filter((s: any) => typeof s === 'string' && s.trim()).map((s: string) => s.trim().slice(0, 500))
          : null,
        rows,
      });
    }
    out.variants = variants;
  }
  return { ok: true, clean: out };
}

function writeSop(id: number, payload: Partial<Sop>) {
  const tx = db.transaction(() => {
    const setCols: string[] = [];
    const args: any[] = [];
    const fields: Array<[keyof Sop, string]> = [
      ['name', 'name'],
      ['slug', 'slug'],
      ['collection', 'collection'],
      ['dietaryTags', 'dietary_tags'],
      ['syrupDietaryTags', 'syrup_dietary_tags'],
      ['drinkContains', 'drink_contains'],
      ['refrigerationNote', 'refrigeration_note'],
      ['category', 'category'],
      ['availability', 'availability'],
      ['subtitle', 'subtitle'],
      ['availabilityNote', 'availability_note'],
    ];
    for (const [k, col] of fields) {
      if (payload[k] !== undefined) {
        setCols.push(`${col} = ?`);
        args.push((payload as any)[k]);
      }
    }
    if (payload.sopRequired !== undefined) {
      setCols.push('sop_required = ?');
      args.push(payload.sopRequired ? 1 : 0);
    }
    if (setCols.length > 0) {
      setCols.push('updated_at = ?');
      args.push(Date.now());
      args.push(id);
      db.prepare(`UPDATE sops SET ${setCols.join(', ')} WHERE id = ?`).run(...args);
    }
    if (payload.variants !== undefined) {
      // Replace strategy: simpler than diffing, and CASCADE on
      // sop_rows means the old rows go with it. The page editor's
      // contract is "PUT replaces the entire SOP body."
      db.prepare('DELETE FROM sop_variants WHERE sop_id = ?').run(id);
      const insertVariant = db.prepare(`INSERT INTO sop_variants (sop_id, temperature, position, size_labels_json, footnotes_json, assembly_big_idea, assembly_steps_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const insertRow = db.prepare(`INSERT INTO sop_rows (variant_id, position, preset_id, name, modifier, cells_json) VALUES (?, ?, ?, ?, ?, ?)`);
      payload.variants!.forEach((v, vi) => {
        const result = insertVariant.run(id, v.temperature, v.position ?? vi, JSON.stringify(v.sizeLabels), JSON.stringify(v.footnotes ?? []), v.assemblyBigIdea ?? null, v.assemblySteps ? JSON.stringify(v.assemblySteps) : null);
        const variantId = Number(result.lastInsertRowid);
        v.rows.forEach((r, ri) => {
          insertRow.run(variantId, ri, r.presetId ?? null, r.name, r.modifier ?? null, JSON.stringify(r.cells));
        });
      });
    }
  });
  tx();
}

// ---------- list / read ----------
router.get('/sops', requireAuth, (req: AuthRequest, res: Response) => {
  const collection = typeof req.query.collection === 'string' ? req.query.collection : null;
  const rows = collection
    ? db.prepare('SELECT * FROM sops WHERE collection = ? ORDER BY name').all(collection) as SopRowDb[]
    : db.prepare('SELECT * FROM sops ORDER BY collection, name').all() as SopRowDb[];
  // Include variant temperatures so the library view can show which
  // temps each SOP covers without N+1 fetching.
  const variantTemps = db.prepare('SELECT sop_id, temperature FROM sop_variants ORDER BY position').all() as Array<{ sop_id: number; temperature: Temperature }>;
  const byId = new Map<number, Temperature[]>();
  for (const r of variantTemps) {
    const arr = byId.get(r.sop_id) ?? [];
    arr.push(r.temperature);
    byId.set(r.sop_id, arr);
  }
  res.json({
    sops: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      collection: r.collection,
      dietaryTags: r.dietary_tags,
      refrigerationNote: r.refrigeration_note,
      category: r.category,
      availability: r.availability,
      sopRequired: r.sop_required !== 0,
      temperatures: byId.get(r.id) ?? [],
      updatedAt: r.updated_at,
    })),
  });
});

// ---------- collection metadata ----------
router.get('/sop-collections/:name/meta', requireAuth, (req: AuthRequest, res: Response) => {
  const name = String(req.params.name);
  const r = db.prepare('SELECT collection, transition_note FROM sop_collection_meta WHERE collection = ?').get(name) as { collection: string; transition_note: string | null } | undefined;
  res.json({ meta: r ? { collection: r.collection, transitionNote: r.transition_note } : { collection: name, transitionNote: null } });
});

router.put('/sop-collections/:name/meta', requireAuth, (req: AuthRequest, res: Response) => {
  const name = String(req.params.name);
  const note = typeof req.body?.transitionNote === 'string' ? req.body.transitionNote.slice(0, 500) : null;
  db.prepare(`INSERT INTO sop_collection_meta (collection, transition_note, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(collection) DO UPDATE SET transition_note = excluded.transition_note, updated_at = excluded.updated_at`).run(name, note, Date.now());
  res.json({ ok: true });
});

router.get('/sop-collections', requireAuth, (_req, res: Response) => {
  const rows = db.prepare("SELECT collection, COUNT(*) as count FROM sops WHERE collection IS NOT NULL AND collection != '' GROUP BY collection ORDER BY collection DESC").all() as Array<{ collection: string; count: number }>;
  res.json({ collections: rows });
});

router.get('/sops/:slug', requireAuth, (req: AuthRequest, res: Response) => {
  const sop = loadSop(String(req.params.slug));
  if (!sop) { res.status(404).json({ error: 'not_found' }); return; }
  res.json({ sop });
});

// ---------- create ----------
router.post('/sops', requireAuth, (req: AuthRequest, res: Response) => {
  const v = validatePayload(req.body, true);
  if (!v.ok) { res.status(400).json({ error: v.error }); return; }
  const clean = v.clean;
  const slug = ensureUniqueSlug(clean.slug || slugify(clean.name!));
  const now = Date.now();
  const result = db.prepare(`INSERT INTO sops (slug, name, collection, dietary_tags, syrup_dietary_tags, drink_contains, refrigeration_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    slug,
    clean.name!,
    clean.collection ?? null,
    clean.dietaryTags ?? null,
    clean.syrupDietaryTags ?? null,
    clean.drinkContains ?? null,
    clean.refrigerationNote ?? null,
    now,
    now,
  );
  const id = Number(result.lastInsertRowid);
  // Template wins over an explicit empty variants array — that's how the
  // "start from template" picker on the New SOP form works.
  let variants = clean.variants;
  if (typeof req.body?.templateSlug === 'string' && req.body.templateSlug) {
    const expanded = expandTemplate(db, req.body.templateSlug, clean.name);
    if (expanded) variants = expanded;
  }
  if (variants !== undefined) {
    writeSop(id, { variants });
  }
  const sop = loadSopById(id);
  res.status(201).json({ sop });
});

// ---------- duplicate ----------
router.post('/sops/:id/duplicate', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  const source = loadSopById(id);
  if (!source) { res.status(404).json({ error: 'not_found' }); return; }
  const newName = `${source.name} (copy)`;
  const newSlug = ensureUniqueSlug(slugify(newName));
  const now = Date.now();
  const result = db.prepare(`INSERT INTO sops (slug, name, collection, dietary_tags, syrup_dietary_tags, drink_contains, refrigeration_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    newSlug,
    newName,
    source.collection ?? null,
    source.dietaryTags ?? null,
    source.syrupDietaryTags ?? null,
    source.drinkContains ?? null,
    source.refrigerationNote ?? null,
    now,
    now,
  );
  const newId = Number(result.lastInsertRowid);
  // Strip ids from the source so writeSop creates fresh rows for the copy.
  const variants = source.variants.map((v) => ({
    temperature: v.temperature,
    position: v.position,
    sizeLabels: [...v.sizeLabels],
    footnotes: v.footnotes.map((fn) => ({ ...fn })),
    assemblyBigIdea: v.assemblyBigIdea,
    assemblySteps: v.assemblySteps ? [...v.assemblySteps] : null,
    rows: v.rows.map((r) => ({ presetId: r.presetId ?? null, name: r.name, modifier: r.modifier ?? null, cells: [...r.cells] })),
  }));
  writeSop(newId, { variants });
  const sop = loadSopById(newId);
  res.status(201).json({ sop });
});

// ---------- templates ----------
router.get('/sop-templates', requireAuth, (_req, res: Response) => {
  res.json({ templates: listTemplates() });
});

// ---------- update ----------
router.put('/sops/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  const existing = db.prepare('SELECT id FROM sops WHERE id = ?').get(id) as { id: number } | undefined;
  if (!existing) { res.status(404).json({ error: 'not_found' }); return; }
  const v = validatePayload(req.body, false);
  if (!v.ok) { res.status(400).json({ error: v.error }); return; }
  const clean = v.clean;
  if (clean.slug) clean.slug = ensureUniqueSlug(clean.slug, id);
  writeSop(id, clean);
  const sop = loadSopById(id);
  res.json({ sop });
});

// ---------- delete ----------
router.delete('/sops/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  db.prepare('DELETE FROM sops WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- presets ----------
router.get('/sop-presets', requireAuth, (_req, res: Response) => {
  const rows = db.prepare('SELECT * FROM sop_presets ORDER BY category, sort, name').all() as Array<any>;
  res.json({
    presets: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      category: r.category,
      name: r.name,
      defaultModifier: r.default_modifier,
      defaultCells: r.default_cells_json ? safeJson(r.default_cells_json, null) : null,
      isSeeded: !!r.is_seeded,
      sort: r.sort,
    })),
  });
});

router.post('/sop-presets', requireAuth, (req: AuthRequest, res: Response) => {
  const { name, category, defaultModifier, defaultCells } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) { res.status(400).json({ error: 'name_required' }); return; }
  if (typeof category !== 'string' || !category.trim()) { res.status(400).json({ error: 'category_required' }); return; }
  const base = slugify(`${category}-${name}`);
  let slug = base;
  let n = 1;
  while (db.prepare('SELECT id FROM sop_presets WHERE slug = ?').get(slug)) {
    n += 1; slug = `${base}-${n}`;
    if (n > 50) { slug = `${base}-${Date.now()}`; break; }
  }
  const result = db.prepare(`INSERT INTO sop_presets (slug, category, name, default_modifier, default_cells_json, is_seeded, sort) VALUES (?, ?, ?, ?, ?, 0, 999)`).run(
    slug, category.trim(), name.trim(), defaultModifier ? String(defaultModifier).slice(0, 200) : null, defaultCells ? JSON.stringify(defaultCells) : null,
  );
  res.status(201).json({ id: Number(result.lastInsertRowid), slug });
});

router.put('/sop-presets/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  const { name, category, defaultModifier, defaultCells } = req.body || {};
  const sets: string[] = [];
  const args: any[] = [];
  if (typeof name === 'string' && name.trim()) { sets.push('name = ?'); args.push(name.trim()); }
  if (typeof category === 'string' && category.trim()) { sets.push('category = ?'); args.push(category.trim()); }
  if (defaultModifier !== undefined) { sets.push('default_modifier = ?'); args.push(defaultModifier ? String(defaultModifier) : null); }
  if (defaultCells !== undefined) { sets.push('default_cells_json = ?'); args.push(defaultCells ? JSON.stringify(defaultCells) : null); }
  if (!sets.length) { res.status(400).json({ error: 'nothing_to_update' }); return; }
  args.push(id);
  db.prepare(`UPDATE sop_presets SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  res.json({ ok: true });
});

router.delete('/sop-presets/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: 'invalid_id' }); return; }
  db.prepare('DELETE FROM sop_presets WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- PDF export ----------
router.get('/sops/:slug/pdf', requireAuth, async (req: AuthRequest, res: Response) => {
  const sop = loadSop(String(req.params.slug));
  if (!sop) { res.status(404).json({ error: 'not_found' }); return; }
  try {
    const buf = await renderSopsToPdfBuffer([sop]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sop.slug}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[sop-pdf]', err);
    res.status(500).json({ error: 'pdf_render_failed' });
  }
});

// Resolve the same id/collection query shape used by bundle + packet routes.
function resolveSopsFromQuery(req: AuthRequest): { sops: Sop[]; collection: string | null } {
  const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
  const collectionParam = typeof req.query.collection === 'string' ? req.query.collection : null;
  let sops: Sop[] = [];
  let collection: string | null = null;
  if (idsParam) {
    const ids = idsParam.split(',').map((s) => parseInt(s, 10)).filter(Boolean);
    sops = ids.map((id) => loadSopById(id)).filter((s): s is Sop => !!s);
    // If every sop shares a collection, surface it for the packet title.
    const collections = new Set(sops.map((s) => s.collection || '').filter(Boolean));
    if (collections.size === 1) collection = [...collections][0];
  } else if (collectionParam) {
    const rows = db.prepare('SELECT id FROM sops WHERE collection = ? ORDER BY name').all(collectionParam) as Array<{ id: number }>;
    sops = rows.map((r) => loadSopById(r.id)).filter((s): s is Sop => !!s);
    collection = collectionParam;
  }
  return { sops, collection };
}

router.get('/sops/packet.pdf', requireAuth, async (req: AuthRequest, res: Response) => {
  const { sops, collection } = resolveSopsFromQuery(req);
  if (sops.length === 0) { res.status(404).json({ error: 'no_sops' }); return; }
  const meta = collection
    ? db.prepare('SELECT transition_note FROM sop_collection_meta WHERE collection = ?').get(collection) as { transition_note: string | null } | undefined
    : undefined;
  try {
    const buf = await renderPacketPdfBuffer(sops, collection, meta?.transition_note ?? null);
    const name = collection ? slugify(collection) : `packet-${sops.length}-sops`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}-packet.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[sop-packet-pdf]', err);
    res.status(500).json({ error: 'pdf_render_failed' });
  }
});

router.get('/sops/packet.zip', requireAuth, async (req: AuthRequest, res: Response) => {
  const { sops, collection } = resolveSopsFromQuery(req);
  if (sops.length === 0) { res.status(404).json({ error: 'no_sops' }); return; }
  const meta = collection
    ? db.prepare('SELECT transition_note FROM sop_collection_meta WHERE collection = ?').get(collection) as { transition_note: string | null } | undefined
    : undefined;
  try {
    const packetBuf = await renderPacketPdfBuffer(sops, collection, meta?.transition_note ?? null);
    // Individual SOPs in parallel — each one is a small render.
    const individuals = await Promise.all(
      sops.filter((s) => s.sopRequired !== false).map(async (s) => ({ slug: s.slug, buf: await renderSopsToPdfBuffer([s]) }))
    );
    const zip = new JSZip();
    const base = collection ? slugify(collection) : `packet-${sops.length}-sops`;
    zip.file(`${base}-packet.pdf`, packetBuf);
    const indivFolder = zip.folder('individual-sops');
    for (const { slug: s, buf } of individuals) {
      indivFolder?.file(`${s}.pdf`, buf);
    }
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${base}-packet.zip"`);
    res.send(zipBuf);
  } catch (err) {
    console.error('[sop-packet-zip]', err);
    res.status(500).json({ error: 'zip_render_failed' });
  }
});

router.get('/sops/bundle.pdf', requireAuth, async (req: AuthRequest, res: Response) => {
  const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
  const collectionParam = typeof req.query.collection === 'string' ? req.query.collection : null;
  let sops: Sop[] = [];
  if (idsParam) {
    const ids = idsParam.split(',').map((s) => parseInt(s, 10)).filter(Boolean);
    sops = ids.map((id) => loadSopById(id)).filter((s): s is Sop => !!s);
  } else if (collectionParam) {
    const rows = db.prepare('SELECT id FROM sops WHERE collection = ? ORDER BY name').all(collectionParam) as Array<{ id: number }>;
    sops = rows.map((r) => loadSopById(r.id)).filter((s): s is Sop => !!s);
  } else {
    res.status(400).json({ error: 'ids_or_collection_required' }); return;
  }
  if (sops.length === 0) { res.status(404).json({ error: 'no_sops' }); return; }
  try {
    const buf = await renderSopsToPdfBuffer(sops);
    const name = collectionParam ? slugify(collectionParam) : `bundle-${sops.length}-sops`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[sop-pdf-bundle]', err);
    res.status(500).json({ error: 'pdf_render_failed' });
  }
});

export default router;
