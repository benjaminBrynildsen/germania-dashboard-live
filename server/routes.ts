import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { requireAuth, requireRole, AuthRequest } from './auth.js';
import { createIdeaForm, createVotingForm, getFormResponses, createDriveFolder } from './google.js';
import { fetchLocationPhoto, fetchPlaceReviews, syncAllReviews } from './places.js';
import { seedCogData } from './seed-cog.js';
import { drinkVariants, drinkCogRange, recommendedPrice, defaultTargetPct } from './cog-cost.js';
import { fetchAllProducts, COG_CATEGORIES, getDriposPrices } from './dripos.js';

const router = Router();

// --- Launches ---

router.get('/launches', requireAuth, (_req: AuthRequest, res: Response) => {
  const launches = db.prepare('SELECT * FROM launches ORDER BY created_at DESC').all();
  res.json(launches);
});

router.get('/launches/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(req.params.id);
  if (!launch) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(launch);
});

router.post('/launches', requireAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, season, year, launch_date } = req.body;
    const userId = req.user!.id;

    let folderId = null;
    try {
      folderId = await createDriveFolder(userId, name, season, year);
    } catch {
      // Google not connected — skip Drive folder creation
    }

    const result = db.prepare(
      'INSERT INTO launches (name, season, year, launch_date, drive_folder_id, created_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, season, year, launch_date, folderId, userId);

    const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(result.lastInsertRowid);

    // Auto-generate pre-launch tasks based on launch date
    if (launch_date) {
      generateLaunchTasks(result.lastInsertRowid as number, launch_date);
    }

    res.json(launch);
  } catch (err: any) {
    console.error('Create launch error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/launches/:id', requireAuth, requireRole('admin', 'manager'), (req: AuthRequest, res: Response) => {
  const { status, launch_date } = req.body;
  const updates: string[] = [];
  const values: any[] = [];
  if (status) { updates.push('status = ?'); values.push(status); }
  if (launch_date) { updates.push('launch_date = ?'); values.push(launch_date); }
  values.push(req.params.id);
  db.prepare(`UPDATE launches SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(req.params.id);
  res.json(launch);
});

// --- Google Forms ---

router.post('/launches/:id/idea-form', requireAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(req.params.id) as any;
    if (!launch) { res.status(404).json({ error: 'Not found' }); return; }

    const { formId, responderUri } = await createIdeaForm(req.user!.id, launch.name, launch.season, launch.year);
    db.prepare('UPDATE launches SET idea_form_id = ? WHERE id = ?').run(formId, launch.id);

    res.json({ formId, responderUri });
  } catch (err: any) {
    console.error('Create idea form error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/launches/:id/voting-form', requireAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  try {
    const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(req.params.id) as any;
    if (!launch) { res.status(404).json({ error: 'Not found' }); return; }

    const drinks = db.prepare('SELECT name, description FROM drinks WHERE launch_id = ? AND status = ?').all(launch.id, 'idea') as any[];
    const { formId, responderUri } = await createVotingForm(req.user!.id, launch.name, drinks);
    db.prepare('UPDATE launches SET voting_form_id = ? WHERE id = ?').run(formId, launch.id);

    res.json({ formId, responderUri });
  } catch (err: any) {
    console.error('Create voting form error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/launches/:id/responses/:formType', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(req.params.id) as any;
    if (!launch) { res.status(404).json({ error: 'Not found' }); return; }

    const formId = req.params.formType === 'ideas' ? launch.idea_form_id : launch.voting_form_id;
    if (!formId) { res.status(404).json({ error: 'Form not created yet' }); return; }

    const responses = await getFormResponses(req.user!.id, formId);
    res.json(responses);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Drinks ---

router.get('/launches/:id/drinks', requireAuth, (req: AuthRequest, res: Response) => {
  const drinks = db.prepare(`
    SELECT d.*, u.name as assigned_to_name
    FROM drinks d
    LEFT JOIN users u ON d.assigned_to = u.id
    WHERE d.launch_id = ?
    ORDER BY d.votes_yes DESC
  `).all(req.params.id);
  res.json(drinks);
});

router.post('/launches/:id/drinks', requireAuth, (req: AuthRequest, res: Response) => {
  const { name, description, submitted_by } = req.body;
  const result = db.prepare(
    'INSERT INTO drinks (launch_id, name, description, submitted_by) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, name, description, submitted_by);
  const drink = db.prepare('SELECT * FROM drinks WHERE id = ?').get(result.lastInsertRowid);
  res.json(drink);
});

router.patch('/drinks/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const { status, assigned_to, votes_yes, votes_no } = req.body;
  const updates: string[] = [];
  const values: any[] = [];
  if (status) { updates.push('status = ?'); values.push(status); }
  if (assigned_to !== undefined) { updates.push('assigned_to = ?'); values.push(assigned_to); }
  if (votes_yes !== undefined) { updates.push('votes_yes = ?'); values.push(votes_yes); }
  if (votes_no !== undefined) { updates.push('votes_no = ?'); values.push(votes_no); }
  values.push(req.params.id);
  db.prepare(`UPDATE drinks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const drink = db.prepare('SELECT * FROM drinks WHERE id = ?').get(req.params.id);
  res.json(drink);
});

// --- Recipe Iterations ---

router.get('/drinks/:id/iterations', requireAuth, (req: AuthRequest, res: Response) => {
  const iterations = db.prepare(
    'SELECT ri.*, u.name as created_by_name FROM recipe_iterations ri LEFT JOIN users u ON ri.created_by = u.id WHERE ri.drink_id = ? ORDER BY ri.iteration_number'
  ).all(req.params.id);
  res.json(iterations);
});

router.post('/drinks/:id/iterations', requireAuth, (req: AuthRequest, res: Response) => {
  const { date, notes } = req.body;
  const lastIteration = db.prepare(
    'SELECT MAX(iteration_number) as max_num FROM recipe_iterations WHERE drink_id = ?'
  ).get(req.params.id) as any;
  const iterationNumber = (lastIteration?.max_num || 0) + 1;

  const result = db.prepare(
    'INSERT INTO recipe_iterations (drink_id, iteration_number, date, notes, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(req.params.id, iterationNumber, date, notes, req.user!.id);
  const iteration = db.prepare('SELECT * FROM recipe_iterations WHERE id = ?').get(result.lastInsertRowid);
  res.json(iteration);
});

// --- Launch Tasks ---

router.get('/launches/:id/tasks', requireAuth, (req: AuthRequest, res: Response) => {
  const tasks = db.prepare(`
    SELECT lt.*, u.name as assigned_to_name
    FROM launch_tasks lt
    LEFT JOIN users u ON lt.assigned_to = u.id
    WHERE lt.launch_id = ?
    ORDER BY lt.due_date
  `).all(req.params.id);
  res.json(tasks);
});

router.patch('/tasks/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const { completed, assigned_to, notes } = req.body;
  const updates: string[] = [];
  const values: any[] = [];
  if (completed !== undefined) { updates.push('completed = ?'); values.push(completed ? 1 : 0); }
  if (assigned_to !== undefined) { updates.push('assigned_to = ?'); values.push(assigned_to); }
  if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
  values.push(req.params.id);
  db.prepare(`UPDATE launch_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const task = db.prepare('SELECT * FROM launch_tasks WHERE id = ?').get(req.params.id);
  res.json(task);
});

// --- Quiz ---

router.get('/launches/:id/quiz', requireAuth, (req: AuthRequest, res: Response) => {
  const questions = db.prepare('SELECT * FROM quiz_questions WHERE launch_id = ?').all(req.params.id);
  res.json(questions);
});

router.post('/launches/:id/quiz', requireAuth, requireRole('admin', 'manager'), (req: AuthRequest, res: Response) => {
  const { questions } = req.body;
  const stmt = db.prepare(
    'INSERT INTO quiz_questions (launch_id, question, correct_answer, options) VALUES (?, ?, ?, ?)'
  );
  for (const q of questions) {
    stmt.run(req.params.id, q.question, q.correct_answer, JSON.stringify(q.options));
  }
  res.json({ ok: true });
});

router.post('/launches/:id/quiz/submit', requireAuth, (req: AuthRequest, res: Response) => {
  const { answers } = req.body;
  const questions = db.prepare('SELECT * FROM quiz_questions WHERE launch_id = ?').all(req.params.id) as any[];

  let score = 0;
  questions.forEach((q, i) => {
    if (answers[i] === q.correct_answer) score++;
  });

  db.prepare(
    'INSERT INTO quiz_results (launch_id, user_id, score, total) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, req.user!.id, score, questions.length);

  res.json({ score, total: questions.length });
});

// --- Users ---

router.get('/users', requireAuth, (_req: AuthRequest, res: Response) => {
  const users = db.prepare('SELECT id, email, name, picture, role FROM users').all();
  res.json(users);
});

router.patch('/users/:id/role', requireAuth, requireRole('admin'), (req: AuthRequest, res: Response) => {
  const { role } = req.body;
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  const user = db.prepare('SELECT id, email, name, picture, role FROM users WHERE id = ?').get(req.params.id);
  res.json(user);
});

// --- Locations ---

// Map germania location IDs (g1..g4) to Dripos numeric LOCATION_IDs.
const DRIPOS_LOC_ID: Record<string, number> = { g1: 131, g2: 132, g3: 133, g4: 134 };

router.get('/locations', requireAuth, async (_req: AuthRequest, res: Response) => {
  const rows = db.prepare('SELECT * FROM locations ORDER BY id').all() as any[];

  // Try to overlay live Dripos weekly metrics (5-min cached). If the token
  // is missing/expired or any individual call fails, fall back silently to
  // the seeded values — locations rendering must never break.
  let liveByLoc: Record<string, { weeklyRevenue: number; revenueChange: number | null }> = {};
  try {
    const { getWeeklyMetrics } = await import('./dripos.js');
    const pairs = await Promise.all(
      Object.entries(DRIPOS_LOC_ID).map(async ([gid, dripId]) => {
        try {
          const m = await getWeeklyMetrics(dripId);
          return [gid, { weeklyRevenue: m.weeklyRevenueCents / 100, revenueChange: m.revenueChangePct }] as const;
        } catch {
          return null;
        }
      }),
    );
    liveByLoc = Object.fromEntries(pairs.filter(Boolean) as Array<readonly [string, any]>);
  } catch {
    // dripos module errored at the top level — fall through to seed values.
  }

  const locations = rows.map(r => {
    const live = liveByLoc[r.id];
    return {
      id: r.id,
      name: r.name,
      address: r.address,
      googleRating: r.google_rating,
      reviewCount: r.review_count,
      weeklyRevenue: live ? Math.round(live.weeklyRevenue) : r.weekly_revenue,
      revenueChange: live && live.revenueChange != null
        ? Math.round(live.revenueChange * 10) / 10
        : r.revenue_change,
      avgTicketTime: r.avg_ticket_time,
      status: r.status,
      googleMapsUrl: r.google_maps_url,
      live: !!live, // flag so the UI can show a "live" indicator
    };
  });
  res.json(locations);
});

router.get('/locations/:id/photo', requireAuth, async (req: AuthRequest, res: Response) => {
  const loc = db.prepare('SELECT google_place_id FROM locations WHERE id = ?').get(req.params.id) as any;
  if (!loc?.google_place_id) {
    res.status(404).json({ error: 'no_place_id' });
    return;
  }
  try {
    const photo = await fetchLocationPhoto(loc.google_place_id);
    if (!photo) {
      res.status(404).json({ error: 'no_photo' });
      return;
    }
    res.set('Content-Type', photo.contentType);
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.send(photo.bytes);
  } catch (err) {
    console.error(`[locations/${req.params.id}/photo] failed:`, err);
    res.status(502).json({ error: 'photo_fetch_failed' });
  }
});

router.get('/locations/:id/reviews', requireAuth, (req: AuthRequest, res: Response) => {
  const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(req.params.id) as any;
  if (!loc) { res.status(404).json({ error: 'Location not found' }); return; }

  // Try DB reviews first, fall back to demo data
  const dbReviews = db.prepare(
    'SELECT * FROM google_reviews WHERE location_id = ? ORDER BY date DESC'
  ).all(req.params.id) as any[];

  const reviews = dbReviews.length > 0
    ? dbReviews.map(r => ({
        id: r.id,
        author: r.author,
        authorPhoto: r.author_photo,
        rating: r.rating,
        text: r.text,
        date: r.date,
        relativeDate: r.relative_date || '',
        helpful: r.helpful,
        replied: !!r.replied,
        replyText: r.reply_text,
      }))
    : getDemoReviews(req.params.id);

  // Distribution from reviews
  const distMap: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  reviews.forEach((r: any) => { distMap[r.rating] = (distMap[r.rating] || 0) + 1; });
  const distribution = [5,4,3,2,1].map(s => ({ stars: s, count: distMap[s] }));

  const rating = loc.google_rating;
  const monthlyAvg = [
    { month: 'Oct', avg: Math.round((rating - 0.15) * 10) / 10, count: 18 },
    { month: 'Nov', avg: Math.round((rating - 0.05) * 10) / 10, count: 22 },
    { month: 'Dec', avg: Math.round((rating + 0.05) * 10) / 10, count: 28 },
    { month: 'Jan', avg: Math.round((rating - 0.1) * 10) / 10, count: 20 },
    { month: 'Feb', avg: Math.round((rating + 0.05) * 10) / 10, count: 24 },
    { month: 'Mar', avg: Math.round((rating + 0.1) * 10) / 10, count: 12 },
  ];

  // Most-recent fetched_at across this location's review rows tells us when
  // the daily sync last successfully touched any of these. NULL means demo
  // mode or the row never had a sync timestamp written (legacy).
  const lastSync = db.prepare(
    'SELECT MAX(fetched_at) as ts FROM google_reviews WHERE location_id = ?'
  ).get(req.params.id) as { ts: string | null } | undefined;

  res.json({
    location: {
      id: loc.id,
      name: loc.name,
      address: loc.address,
      googleRating: loc.google_rating,
      reviewCount: loc.review_count,
      googleMapsUrl: loc.google_maps_url,
      googlePlaceId: loc.google_place_id,
    },
    reviews,
    distribution,
    monthlyAvg,
    source: dbReviews.length > 0 ? 'google_places_api' : 'demo',
    lastSyncedAt: lastSync?.ts ?? null,
  });
});

// Manual sync trigger
router.post('/locations/sync-reviews', requireAuth, requireRole('admin', 'manager'), async (_req: AuthRequest, res: Response) => {
  const results = await syncAllReviews();
  res.json(results);
});

router.post('/locations/:id/sync-reviews', requireAuth, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
  const result = await fetchPlaceReviews(req.params.id);
  res.json(result);
});

// Bulk-import reviews from an Apify Google Maps Reviews Scraper export.
// Body:
//   { locationId: "g1", reviews: [...apify-export-array] }
// Expected per-review shape (Apify "compass/google-maps-reviews-scraper" output):
//   { reviewId, reviewerName, reviewerPhotoUrl, stars, text,
//     publishedAtDate, publishAt,
//     responseFromOwnerText, responseFromOwnerDate }
// Tolerates missing/null fields. Upserts on (location_id, google_review_id).
router.post('/locations/:id/import-reviews', requireAuth, requireRole('admin', 'manager'), (req: AuthRequest, res: Response) => {
  const locationId = req.params.id;
  const loc = db.prepare('SELECT id FROM locations WHERE id = ?').get(locationId) as any;
  if (!loc) { res.status(404).json({ error: 'Location not found' }); return; }

  const payload = req.body || {};
  const reviews: any[] = Array.isArray(payload) ? payload : (Array.isArray(payload.reviews) ? payload.reviews : []);
  if (!Array.isArray(reviews) || reviews.length === 0) {
    res.status(400).json({ error: 'Body must be an array of reviews, or { reviews: [...] }' });
    return;
  }

  const upsert = db.prepare(`
    INSERT INTO google_reviews (location_id, google_review_id, author, author_photo, rating, text, date, relative_date, replied, reply_text, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(location_id, google_review_id) DO UPDATE SET
      author = excluded.author,
      author_photo = excluded.author_photo,
      rating = excluded.rating,
      text = excluded.text,
      date = excluded.date,
      relative_date = excluded.relative_date,
      replied = excluded.replied,
      reply_text = excluded.reply_text,
      fetched_at = CURRENT_TIMESTAMP
  `);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Drizzle's better-sqlite3 doesn't expose row.changes vs row.lastInsertRowid
  // in a way that distinguishes insert from update reliably. Pre-check existing
  // ids so we can report accurate inserted/updated counts.
  const existing = new Set(
    (db.prepare('SELECT google_review_id FROM google_reviews WHERE location_id = ?')
      .all(locationId) as any[])
      .map((r) => r.google_review_id),
  );

  const txn = db.transaction(() => {
    for (const r of reviews) {
      const reviewId = String(r.reviewId ?? r.id ?? '').trim();
      if (!reviewId) { skipped++; continue; }
      const stars = Number(r.stars ?? r.rating ?? 0);
      if (!Number.isFinite(stars) || stars < 1 || stars > 5) { skipped++; continue; }

      const author = String(r.reviewerName ?? r.author ?? 'Anonymous').slice(0, 200);
      const photo = r.reviewerPhotoUrl ?? r.authorPhoto ?? null;
      const text = String(r.text ?? '').slice(0, 5000);
      const date = String(r.publishedAtDate ?? r.date ?? new Date().toISOString());
      const relative = String(r.publishAt ?? r.relativeDate ?? '').slice(0, 80);
      const replyText = r.responseFromOwnerText ?? r.replyText ?? null;
      const replied = replyText ? 1 : 0;

      try {
        upsert.run(locationId, reviewId, author, photo, stars, text, date, relative, replied, replyText);
        if (existing.has(reviewId)) updated++; else { inserted++; existing.add(reviewId); }
      } catch (e: any) {
        errors.push(`${reviewId}: ${e.message || String(e)}`);
      }
    }
  });
  txn();

  res.json({ ok: true, inserted, updated, skipped, errorCount: errors.length, errors: errors.slice(0, 10) });
});

// Update location's google_place_id
router.patch('/locations/:id', requireAuth, requireRole('admin'), (req: AuthRequest, res: Response) => {
  const { google_place_id, google_maps_url } = req.body;
  const updates: string[] = [];
  const values: any[] = [];
  if (google_place_id !== undefined) { updates.push('google_place_id = ?'); values.push(google_place_id); }
  if (google_maps_url !== undefined) { updates.push('google_maps_url = ?'); values.push(google_maps_url); }
  if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  values.push(req.params.id);
  db.prepare(`UPDATE locations SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

function getDemoReviews(locationId: string) {
  const sets: Record<string, any[]> = {
    g1: [
      { id: 1, author: 'Sarah M.', rating: 5, text: 'Best coffee in the area hands down. The Haus Vanilla Latte is incredible. We drive 20 minutes just to come here.', date: '2026-03-10', relativeDate: '2 days ago', helpful: 4, replied: true, replyText: 'Thank you Sarah! So glad you love the Haus Vanilla Latte — it\'s one of our favorites too!' },
      { id: 2, author: 'Mike T.', rating: 5, text: 'Friendly staff, fast service, and great atmosphere. We come here every weekend with the kids.', date: '2026-03-07', relativeDate: '5 days ago', helpful: 2, replied: true, replyText: 'Thanks Mike! Love seeing your family every weekend. See you soon!' },
      { id: 3, author: 'Jessica L.', rating: 4, text: 'Really good cold brew. Gets busy on weekend mornings but worth the wait. The pastries are fresh too.', date: '2026-03-05', relativeDate: '1 week ago', helpful: 1, replied: false },
      { id: 4, author: 'David R.', rating: 5, text: 'This place is a gem. The seasonal menu keeps things exciting and the baristas clearly know their craft.', date: '2026-03-03', relativeDate: '9 days ago', helpful: 3, replied: true, replyText: 'Appreciate the kind words David! Wait until you see what we have planned for spring.' },
      { id: 5, author: 'Amanda K.', rating: 5, text: 'Stopped in on a road trip and was blown away. Better than any coffee shop in St. Louis honestly.', date: '2026-02-28', relativeDate: '2 weeks ago', helpful: 7, replied: true, replyText: 'Wow, that means a lot Amanda! Hope you swing by again next time you\'re passing through.' },
      { id: 6, author: 'Chris P.', rating: 4, text: 'Great vibes, good music, solid espresso. The oat milk latte is my go-to. Only wish they had more food options.', date: '2026-02-25', relativeDate: '2 weeks ago', helpful: 1, replied: false },
      { id: 7, author: 'Rachel W.', rating: 5, text: 'The Lavender Honey Latte was life changing. Staff remembered my name on my second visit.', date: '2026-02-22', relativeDate: '3 weeks ago', helpful: 5, replied: true, replyText: 'Rachel! Of course we remember you. Come back for our new spring lavender cold brew!' },
      { id: 8, author: 'Tom B.', rating: 3, text: 'Coffee is good but had to wait almost 15 minutes on a Tuesday. Not great when you\'re trying to get to work.', date: '2026-02-20', relativeDate: '3 weeks ago', helpful: 2, replied: true, replyText: 'Sorry about the wait Tom. We\'ve been working on our morning rush flow — hope your next visit is faster.' },
      { id: 9, author: 'Emily S.', rating: 5, text: 'Hosted a small birthday gathering here and they were so accommodating. The space is beautiful and the drinks are top notch.', date: '2026-02-18', relativeDate: '3 weeks ago', helpful: 3, replied: false },
      { id: 10, author: 'Jason H.', rating: 5, text: 'Best local coffee spot, period. I\'ve tried them all and Germania is in a league of its own.', date: '2026-02-15', relativeDate: '4 weeks ago', helpful: 6, replied: false },
      { id: 11, author: 'Nicole F.', rating: 4, text: 'Delicious chai latte and the atmosphere is perfect for studying. WiFi is reliable too.', date: '2026-02-12', relativeDate: '1 month ago', helpful: 0, replied: false },
      { id: 12, author: 'Brian D.', rating: 2, text: 'Was excited to try this place but my drink was lukewarm and the barista seemed annoyed when I asked for a remake.', date: '2026-02-10', relativeDate: '1 month ago', helpful: 1, replied: true, replyText: 'We\'re sorry about that experience Brian. That\'s not the standard we hold ourselves to. Please reach out to us directly so we can make it right.' },
      { id: 13, author: 'Karen L.', rating: 5, text: 'I bring all my out-of-town guests here. It always impresses. The seasonal menu is creative and delicious.', date: '2026-02-05', relativeDate: '1 month ago', helpful: 2, replied: false },
      { id: 14, author: 'Steve M.', rating: 5, text: 'Phenomenal espresso. You can tell they take sourcing and roasting seriously. A cut above everything else in the area.', date: '2026-01-30', relativeDate: '6 weeks ago', helpful: 4, replied: false },
      { id: 15, author: 'Lisa G.', rating: 4, text: 'Really charming spot. The decor is on point and the drinks are consistently good. Parking can be tricky on weekends.', date: '2026-01-25', relativeDate: '7 weeks ago', helpful: 1, replied: false },
    ],
    g2: [
      { id: 1, author: 'Megan R.', rating: 5, text: 'The Godfrey location is my happy place. Perfect study spot with amazing drinks and the friendliest baristas.', date: '2026-03-11', relativeDate: '1 day ago', helpful: 2, replied: true, replyText: 'You\'re the best Megan! We love having you here.' },
      { id: 2, author: 'Tyler J.', rating: 5, text: 'Consistently the best coffee experience. Never had a bad drink here in probably 50+ visits.', date: '2026-03-09', relativeDate: '3 days ago', helpful: 5, replied: false },
      { id: 3, author: 'Brittany H.', rating: 5, text: 'Love love LOVE this place. The new winter menu was incredible. Can\'t wait for spring drinks!', date: '2026-03-06', relativeDate: '6 days ago', helpful: 3, replied: true, replyText: 'Spring menu drops soon Brittany — you won\'t be disappointed!' },
      { id: 4, author: 'Marcus W.', rating: 4, text: 'Great coffee, cool interior. Would love to see more dairy-free pastry options but the drinks are unmatched.', date: '2026-03-02', relativeDate: '10 days ago', helpful: 1, replied: false },
      { id: 5, author: 'Hannah C.', rating: 5, text: 'Drove past three Starbucks to get here. Worth every mile. The Haus Mocha is perfection.', date: '2026-02-27', relativeDate: '2 weeks ago', helpful: 8, replied: true, replyText: 'That\'s the ultimate compliment Hannah! The Haus Mocha loves you back.' },
      { id: 6, author: 'Daniel P.', rating: 5, text: 'This is what a local coffee shop should be. Great product, great people, great community space.', date: '2026-02-23', relativeDate: '2 weeks ago', helpful: 4, replied: false },
      { id: 7, author: 'Olivia S.', rating: 4, text: 'Beautiful space and delicious drinks. Wish the hours were a bit later on weekdays.', date: '2026-02-20', relativeDate: '3 weeks ago', helpful: 2, replied: true, replyText: 'Thanks Olivia! We hear you on the hours — stay tuned.' },
      { id: 8, author: 'Jake M.', rating: 5, text: 'The baristas here actually care about making good coffee. You can taste the difference.', date: '2026-02-17', relativeDate: '3 weeks ago', helpful: 3, replied: false },
      { id: 9, author: 'Samantha D.', rating: 3, text: 'Good coffee but the music was way too loud last time I visited. Hard to have a conversation.', date: '2026-02-14', relativeDate: '4 weeks ago', helpful: 1, replied: true, replyText: 'Appreciate the feedback Samantha — we\'ll keep an eye on the volume levels!' },
      { id: 10, author: 'Ryan K.', rating: 5, text: 'Five stars isn\'t enough. This place elevated my coffee standards permanently.', date: '2026-02-10', relativeDate: '1 month ago', helpful: 6, replied: false },
      { id: 11, author: 'Allison T.', rating: 5, text: 'Perfect matcha latte every single time. The consistency here is impressive.', date: '2026-02-05', relativeDate: '1 month ago', helpful: 2, replied: false },
      { id: 12, author: 'Kevin B.', rating: 4, text: 'Solid spot. Good coffee, nice atmosphere. A little pricey but you get what you pay for.', date: '2026-01-30', relativeDate: '6 weeks ago', helpful: 0, replied: false },
    ],
    g3: [
      { id: 1, author: 'Ashley N.', rating: 5, text: 'The East Alton location has such a cozy feel. Perfect for a rainy day coffee run.', date: '2026-03-10', relativeDate: '2 days ago', helpful: 2, replied: true, replyText: 'Thanks Ashley! Rainy days are our favorite here too.' },
      { id: 2, author: 'Brandon F.', rating: 4, text: 'Really solid coffee. Not as spacious as the other locations but the drinks are just as good.', date: '2026-03-07', relativeDate: '5 days ago', helpful: 1, replied: false },
      { id: 3, author: 'Courtney M.', rating: 5, text: 'Hidden gem! Just found this place and I\'m obsessed. The caramel cold brew is insane.', date: '2026-03-04', relativeDate: '8 days ago', helpful: 4, replied: true, replyText: 'Welcome to the family Courtney! The caramel cold brew is a fan favorite.' },
      { id: 4, author: 'Derek A.', rating: 4, text: 'Good vibes, good people, good coffee. What more could you want? Maybe slightly bigger portions.', date: '2026-03-01', relativeDate: '11 days ago', helpful: 0, replied: false },
      { id: 5, author: 'Erica T.', rating: 5, text: 'Staff is incredible here. They made my complicated custom order without batting an eye.', date: '2026-02-26', relativeDate: '2 weeks ago', helpful: 3, replied: false },
      { id: 6, author: 'Greg S.', rating: 3, text: 'Decent coffee but took forever to get my drink. Maybe understaffed during the morning rush?', date: '2026-02-22', relativeDate: '3 weeks ago', helpful: 2, replied: true, replyText: 'Sorry about the wait Greg. We\'re actively hiring to better handle the morning rush.' },
      { id: 7, author: 'Holly R.', rating: 5, text: 'This is my daily stop and it never disappoints. Best americano in the metro east.', date: '2026-02-18', relativeDate: '3 weeks ago', helpful: 5, replied: false },
      { id: 8, author: 'Ian W.', rating: 4, text: 'Clean, well-designed space with consistently good drinks. Recommend the honey oat latte.', date: '2026-02-13', relativeDate: '4 weeks ago', helpful: 1, replied: false },
      { id: 9, author: 'Julia C.', rating: 2, text: 'My order was wrong twice in a row. Frustrating when you\'re paying premium prices.', date: '2026-02-08', relativeDate: '1 month ago', helpful: 1, replied: true, replyText: 'We\'re really sorry Julia. That\'s not acceptable. We\'d love a chance to make it up to you — please DM us.' },
      { id: 10, author: 'Keith N.', rating: 5, text: 'Best local business in East Alton. Period. Support these guys!', date: '2026-02-02', relativeDate: '1 month ago', helpful: 7, replied: true, replyText: 'Keith, you\'re amazing! Thanks for the support and the kind words.' },
    ],
    g4: [
      { id: 1, author: 'Laura B.', rating: 5, text: 'The Jerseyville location is absolutely perfect. Small town charm with big city coffee quality. We are so lucky to have this.', date: '2026-03-11', relativeDate: '1 day ago', helpful: 6, replied: true, replyText: 'We\'re lucky to have customers like you Laura! Thank you!' },
      { id: 2, author: 'Nathan G.', rating: 5, text: 'Jerseyville needed a place like this. The quality is unreal for our little town.', date: '2026-03-08', relativeDate: '4 days ago', helpful: 4, replied: false },
      { id: 3, author: 'Paige V.', rating: 5, text: 'Every single drink I\'ve tried has been amazing. The seasonal menus are so creative and fun.', date: '2026-03-05', relativeDate: '1 week ago', helpful: 3, replied: true, replyText: 'Thanks Paige! Spring menu is going to be our best yet!' },
      { id: 4, author: 'Quinn R.', rating: 5, text: 'Drove from Springfield just to try this place based on a friend\'s recommendation. Did not disappoint whatsoever.', date: '2026-03-02', relativeDate: '10 days ago', helpful: 5, replied: true, replyText: 'That\'s a serious drive Quinn! We\'re honored. Tell your friend thanks for us!' },
      { id: 5, author: 'Rebecca H.', rating: 4, text: 'Great coffee and cute space. Would love to see them add some outdoor seating for summer.', date: '2026-02-27', relativeDate: '2 weeks ago', helpful: 2, replied: false },
      { id: 6, author: 'Scott L.', rating: 5, text: 'I\'ve been to coffee shops in Chicago, Nashville, Austin — Germania holds its own against all of them. Seriously impressive.', date: '2026-02-23', relativeDate: '2 weeks ago', helpful: 9, replied: true, replyText: 'Scott, that is the highest praise we could ask for. Thank you!' },
      { id: 7, author: 'Tina D.', rating: 5, text: 'My kids love the hot chocolate and I love the lattes. Win-win for the whole family.', date: '2026-02-20', relativeDate: '3 weeks ago', helpful: 3, replied: false },
      { id: 8, author: 'Victor M.', rating: 5, text: 'Impeccable service every time. These baristas are the real deal.', date: '2026-02-16', relativeDate: '3 weeks ago', helpful: 2, replied: false },
      { id: 9, author: 'Wendy F.', rating: 4, text: 'Love this place. Only minor note is the WiFi can be spotty sometimes. But the coffee more than makes up for it.', date: '2026-02-12', relativeDate: '1 month ago', helpful: 1, replied: true, replyText: 'Thanks for the heads up on WiFi Wendy! We\'re looking into upgrading.' },
      { id: 10, author: 'Xavier K.', rating: 5, text: 'This place single-handedly put Jerseyville on the map. Outstanding in every way.', date: '2026-02-08', relativeDate: '1 month ago', helpful: 8, replied: false },
    ],
  };
  return sets[locationId] || [];
}

// --- Helper ---

function generateLaunchTasks(launchId: number, launchDate: string) {
  const launch = new Date(launchDate);
  const daysBefore = (days: number) => {
    const d = new Date(launch);
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  };

  const tasks = [
    { title: 'Schedule photo shoot for new drinks', category: 'photo_shoot', due: daysBefore(21) },
    { title: 'Complete photo shoot', category: 'photo_shoot', due: daysBefore(14) },
    { title: 'Create social media launch content', category: 'social_media', due: daysBefore(10) },
    { title: 'Create Eventbrite event for menu tasting', category: 'eventbrite', due: daysBefore(28) },
    { title: 'Eventbrite tickets go live', category: 'eventbrite', due: daysBefore(21) },
    { title: 'Menu tasting event', category: 'menu_tasting', due: daysBefore(3) },
    { title: 'Gather and create SOPs for all new drinks', category: 'sops', due: daysBefore(7) },
    { title: 'Create drink buttons on Dripos', category: 'dripos_buttons', due: daysBefore(3) },
    { title: 'Send menu panel designs to Schwartzkopf Printing', category: 'menu_panels', due: daysBefore(10) },
    { title: 'Pick up printed menu panels', category: 'menu_panels', due: daysBefore(2) },
    { title: 'Prepare all sauces for new menu', category: 'sauces', due: daysBefore(1) },
    { title: 'Verify delivery schedule alignment (Mon/Wed/Fri)', category: 'delivery', due: daysBefore(7) },
    { title: 'Sauces delivered', category: 'sauces', due: daysBefore(0) },
    { title: 'Staff quiz created and distributed', category: 'other', due: daysBefore(5) },
  ];

  const stmt = db.prepare(
    'INSERT INTO launch_tasks (launch_id, title, category, due_date) VALUES (?, ?, ?, ?)'
  );
  for (const task of tasks) {
    stmt.run(launchId, task.title, task.category, task.due);
  }
}

// --- COG Manager ---

// Seed COG data from JSON
router.post('/cog/seed', requireAuth, (_req: AuthRequest, res: Response) => {
  try {
    const result = seedCogData();
    res.json(result);
  } catch (err: any) {
    console.error('Seed COG error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List all recipes with calculated totals
router.get('/cog/recipes', requireAuth, (_req: AuthRequest, res: Response) => {
  const recipes = db.prepare(`
    SELECT 
      r.*,
      COUNT(i.id) as ingredient_count,
      COALESCE(SUM(i.ep_price * COALESCE(i.quantity_used, 0)), 0) as total_ingredient_cost
    FROM cog_recipes r
    LEFT JOIN cog_ingredients i ON r.id = i.recipe_id
    GROUP BY r.id
    ORDER BY r.season DESC, r.name
  `).all() as any[];

  // Calculate COG per unit
  const enriched = recipes.map(r => {
    const ingredientCost = r.total_ingredient_cost || 0;
    const laborCost = r.labor_cost_per_unit || 0;
    const cogPerUnit = r.total_yield > 0 ? (ingredientCost + laborCost) / r.total_yield : 0;
    
    return {
      ...r,
      cog_per_unit: cogPerUnit,
    };
  });

  res.json(enriched);
});

// Get single recipe with ingredients
router.get('/cog/recipes/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const recipe = db.prepare(`
    SELECT 
      r.*,
      COUNT(i.id) as ingredient_count,
      COALESCE(SUM(i.ep_price * COALESCE(i.quantity_used, 0)), 0) as total_ingredient_cost
    FROM cog_recipes r
    LEFT JOIN cog_ingredients i ON r.id = i.recipe_id
    WHERE r.id = ?
    GROUP BY r.id
  `).get(req.params.id) as any;
  if (!recipe) {
    res.status(404).json({ error: 'Recipe not found' });
    return;
  }

  const ingredients = db.prepare(`
    SELECT * FROM cog_ingredients
    WHERE recipe_id = ?
    ORDER BY sort_order
  `).all(req.params.id);

  const ingredientCost = recipe.total_ingredient_cost || 0;
  const laborCost = recipe.labor_cost_per_unit || 0;
  const cogPerUnit = recipe.total_yield > 0 ? (ingredientCost + laborCost) / recipe.total_yield : 0;

  res.json({ ...recipe, cog_per_unit: cogPerUnit, ingredients });
});

// Create recipe
router.post('/cog/recipes', requireAuth, (req: AuthRequest, res: Response) => {
  const { name, season, category, total_yield, yield_unit, labor_time_hrs, labor_quantity, labor_cook_rate, labor_cost_per_unit } = req.body;
  
  const result = db.prepare(`
    INSERT INTO cog_recipes (name, season, category, total_yield, yield_unit, labor_time_hrs, labor_quantity, labor_cook_rate, labor_cost_per_unit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, season, category, total_yield, yield_unit, labor_time_hrs, labor_quantity, labor_cook_rate, labor_cost_per_unit);

  const recipe = db.prepare('SELECT * FROM cog_recipes WHERE id = ?').get(result.lastInsertRowid);
  res.json(recipe);
});

// Update recipe
router.put('/cog/recipes/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const { name, season, category, total_yield, yield_unit, labor_time_hrs, labor_quantity, labor_cook_rate, labor_cost_per_unit } = req.body;
  
  db.prepare(`
    UPDATE cog_recipes
    SET name = ?, season = ?, category = ?, total_yield = ?, yield_unit = ?,
        labor_time_hrs = ?, labor_quantity = ?, labor_cook_rate = ?, labor_cost_per_unit = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(name, season, category, total_yield, yield_unit, labor_time_hrs, labor_quantity, labor_cook_rate, labor_cost_per_unit, req.params.id);

  const recipe = db.prepare('SELECT * FROM cog_recipes WHERE id = ?').get(req.params.id);
  res.json(recipe);
});

// Delete recipe. Drinks can reference a recipe as a component (recipe_id is
// ON DELETE SET NULL, so their lines survive but show as "missing") — surface
// that as a 409 with the drink names unless the caller passes ?force=1.
router.delete('/cog/recipes/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const usedBy = db.prepare(`
    SELECT DISTINCT d.name FROM cog_drink_components c
    JOIN cog_drinks d ON d.id = c.drink_id
    WHERE c.component_type = 'recipe' AND c.recipe_id = ?
  `).all(req.params.id) as Array<{ name: string }>;
  if (usedBy.length > 0 && req.query.force !== '1') {
    res.status(409).json({
      error: 'Recipe is used as a component',
      used_by: usedBy.map((r) => r.name),
    });
    return;
  }
  db.prepare('DELETE FROM cog_recipes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Add ingredient to recipe
router.post('/cog/recipes/:id/ingredients', requireAuth, (req: AuthRequest, res: Response) => {
  const { name, ap_pack_cost, pack_size, pack_unit, unit_conversion, ap_price, ap_price_unit, yield_percent, ep_price, ep_price_unit, quantity_used } = req.body;
  
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM cog_ingredients WHERE recipe_id = ?').get(req.params.id) as any;
  const sortOrder = (maxOrder?.max ?? -1) + 1;

  const result = db.prepare(`
    INSERT INTO cog_ingredients (
      recipe_id, name, ap_pack_cost, pack_size, pack_unit, unit_conversion,
      ap_price, ap_price_unit, yield_percent, ep_price, ep_price_unit, quantity_used, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, name, ap_pack_cost, pack_size, pack_unit, unit_conversion, ap_price, ap_price_unit, yield_percent, ep_price, ep_price_unit, quantity_used, sortOrder);

  const ingredient = db.prepare('SELECT * FROM cog_ingredients WHERE id = ?').get(result.lastInsertRowid);
  res.json(ingredient);
});

// Update ingredient
router.put('/cog/ingredients/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const { name, ap_pack_cost, pack_size, pack_unit, unit_conversion, ap_price, ap_price_unit, yield_percent, ep_price, ep_price_unit, quantity_used } = req.body;
  
  db.prepare(`
    UPDATE cog_ingredients
    SET name = ?, ap_pack_cost = ?, pack_size = ?, pack_unit = ?, unit_conversion = ?,
        ap_price = ?, ap_price_unit = ?, yield_percent = ?, ep_price = ?, ep_price_unit = ?, quantity_used = ?
    WHERE id = ?
  `).run(name, ap_pack_cost, pack_size, pack_unit, unit_conversion, ap_price, ap_price_unit, yield_percent, ep_price, ep_price_unit, quantity_used, req.params.id);

  const ingredient = db.prepare('SELECT * FROM cog_ingredients WHERE id = ?').get(req.params.id);
  res.json(ingredient);
});

// Delete ingredient
router.delete('/cog/ingredients/:id', requireAuth, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM cog_ingredients WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Get master ingredient list
router.get('/cog/ingredients/master', requireAuth, (_req: AuthRequest, res: Response) => {
  const ingredients = db.prepare(`
    SELECT * FROM cog_ingredient_master
    ORDER BY name
  `).all();
  res.json(ingredients);
});

// Update master ingredient
router.put('/cog/ingredients/master/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const { ap_pack_cost, pack_size, pack_unit, supplier } = req.body;

  db.prepare(`
    UPDATE cog_ingredient_master
    SET ap_pack_cost = ?, pack_size = ?, pack_unit = ?, supplier = ?, last_updated = datetime('now')
    WHERE id = ?
  `).run(ap_pack_cost, pack_size, pack_unit, supplier, req.params.id);

  const ingredient = db.prepare('SELECT * FROM cog_ingredient_master WHERE id = ?').get(req.params.id);
  res.json(ingredient);
});

// Create master ingredient
router.post('/cog/ingredients/master', requireAuth, (req: AuthRequest, res: Response) => {
  const { name, ap_pack_cost, pack_size, pack_unit, supplier } = req.body;
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }
  try {
    const result = db.prepare(`
      INSERT INTO cog_ingredient_master (name, ap_pack_cost, pack_size, pack_unit, supplier)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(name).trim(), ap_pack_cost ?? null, pack_size ?? null, pack_unit ?? null, supplier ?? null);
    res.json(db.prepare('SELECT * FROM cog_ingredient_master WHERE id = ?').get(result.lastInsertRowid));
  } catch (err: any) {
    // name has a UNIQUE constraint
    if (String(err.message).includes('UNIQUE')) {
      res.status(409).json({ error: 'An ingredient with that name already exists' });
      return;
    }
    throw err;
  }
});

// Delete master ingredient
router.delete('/cog/ingredients/master/:id', requireAuth, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM cog_ingredient_master WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Import the master ingredient catalog from the bundled Cost-of-Goods export
// (server/germania-cog-ingredients.json, parsed from the GOODS sheet). Idempotent:
// upserts by name, so re-running just refreshes prices. Safe to click repeatedly.
const __routesDir = path.dirname(fileURLToPath(import.meta.url));
router.post('/cog/ingredients/import', requireAuth, (_req: AuthRequest, res: Response) => {
  try {
    const dataPath = path.join(__routesDir, 'germania-cog-ingredients.json');
    if (!fs.existsSync(dataPath)) { res.status(404).json({ error: 'Ingredient catalog file not found on server' }); return; }
    const items = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as Array<{
      name: string; ap_pack_cost: number | null; pack_size: number | null; pack_unit: string | null; supplier: string | null;
    }>;

    const exists = db.prepare('SELECT 1 FROM cog_ingredient_master WHERE name = ?');
    const upsert = db.prepare(`
      INSERT INTO cog_ingredient_master (name, ap_pack_cost, pack_size, pack_unit, supplier)
      VALUES (@name, @ap_pack_cost, @pack_size, @pack_unit, @supplier)
      ON CONFLICT(name) DO UPDATE SET
        ap_pack_cost = excluded.ap_pack_cost,
        pack_size = excluded.pack_size,
        pack_unit = excluded.pack_unit,
        supplier = excluded.supplier,
        last_updated = datetime('now')
    `);
    let inserted = 0, updated = 0;
    const run = db.transaction(() => {
      for (const it of items) {
        if (!it.name) continue;
        if (exists.get(it.name)) updated++; else inserted++;
        upsert.run({
          name: it.name,
          ap_pack_cost: it.ap_pack_cost ?? null,
          pack_size: it.pack_size ?? null,
          pack_unit: it.pack_unit ?? null,
          supplier: it.supplier ?? null,
        });
      }
    });
    run();
    res.json({ success: true, total: items.length, inserted, updated });
  } catch (err: any) {
    console.error('Ingredient import error:', err);
    res.status(500).json({ error: err.message || 'Import failed' });
  }
});

// --- COG: finished drinks + recommended pricing ---

// Global COGS settings (single row). Default target COG % drives recommended price.
router.get('/cog/settings', requireAuth, (_req: AuthRequest, res: Response) => {
  const settings = db.prepare('SELECT * FROM cog_settings WHERE id = 1').get();
  res.json(settings);
});

router.put('/cog/settings', requireAuth, (req: AuthRequest, res: Response) => {
  const { default_target_cogs_pct, drink_location_id } = req.body;
  db.prepare(`
    UPDATE cog_settings
    SET default_target_cogs_pct = COALESCE(?, default_target_cogs_pct),
        drink_location_id = COALESCE(?, drink_location_id),
        updated_at = datetime('now')
    WHERE id = 1
  `).run(default_target_cogs_pct ?? null, drink_location_id ?? null);
  res.json(db.prepare('SELECT * FROM cog_settings WHERE id = 1').get());
});

// List drinks with a COG range across their size variants.
router.get('/cog/drinks', requireAuth, (req: AuthRequest, res: Response) => {
  const includeArchived = req.query.archived === '1';
  const drinks = db.prepare(`
    SELECT * FROM cog_drinks
    ${includeArchived ? '' : 'WHERE archived = 0'}
    ORDER BY category, name
  `).all() as any[];

  const fallback = defaultTargetPct();
  const enriched = drinks.map((d) => {
    const range = drinkCogRange(d.id, d.target_cogs_pct);
    return {
      ...d,
      effective_target_cogs_pct: d.target_cogs_pct ?? fallback,
      ...range,
    };
  });
  res.json(enriched);
});

// Live current menu price per variant, straight from Dripos /products. Matches
// drinks to Dripos products by dripos_product_id when linked (the sturdy join),
// falling back to name for unlinked drinks; variants match by temp+size to the
// product's Size customization options (falling back to the base price). Returns
// prices keyed by variant_id so the UI can show live price + margin. Degrades to
// { available:false } when Dripos isn't connected. Registered BEFORE /:id so the
// literal path isn't swallowed by the :id route.
router.get('/cog/drinks/dripos-prices', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = db.prepare('SELECT drink_location_id FROM cog_settings WHERE id = 1').get() as any;
    const { byId, byName } = await getDriposPrices(settings?.drink_location_id ?? 131);

    const variants = db.prepare(`
      SELECT v.id, v.temp, v.size, d.id AS drink_id, d.name AS drink_name, d.dripos_product_id
      FROM cog_drink_variants v JOIN cog_drinks d ON d.id = v.drink_id
    `).all() as Array<{ id: number; temp: string | null; size: string | null; drink_id: number; drink_name: string; dripos_product_id: number | null }>;

    const prices: Record<number, number> = {};               // variant_id -> price
    const drinkPrices: Record<number, { min: number; max: number }> = {};
    let matched = 0;
    for (const v of variants) {
      const info = (v.dripos_product_id != null ? byId.get(v.dripos_product_id) : undefined)
        ?? byName.get(v.drink_name.toLowerCase());
      if (!info) continue;
      const key = v.temp && v.size ? `${v.temp}|${v.size}` : null;
      const price = (key && info.sizes[key] != null) ? info.sizes[key] : (info.base > 0 ? info.base : null);
      if (price == null) continue;
      prices[v.id] = price;
      matched++;
      const dp = drinkPrices[v.drink_id];
      if (!dp) drinkPrices[v.drink_id] = { min: price, max: price };
      else { dp.min = Math.min(dp.min, price); dp.max = Math.max(dp.max, price); }
    }
    res.json({ available: true, matched, prices, drink_prices: drinkPrices });
  } catch (err: any) {
    const isAuth = err?.name === 'NoToken' || err?.name === 'AuthExpired';
    res.json({ available: false, reason: isAuth ? 'Dripos not connected — log in via the Weekly Sales tab' : (err.message || 'failed'), prices: {} });
  }
});

// Single drink with its fully-costed variants.
router.get('/cog/drinks/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const drink = db.prepare('SELECT * FROM cog_drinks WHERE id = ?').get(req.params.id) as any;
  if (!drink) { res.status(404).json({ error: 'Drink not found' }); return; }
  res.json({
    ...drink,
    effective_target_cogs_pct: drink.target_cogs_pct ?? defaultTargetPct(),
    variants: drinkVariants(drink.id, drink.target_cogs_pct),
  });
});

// Create drink. Optionally seed an initial variant so the builder isn't empty.
router.post('/cog/drinks', requireAuth, (req: AuthRequest, res: Response) => {
  const { name, category, season, target_cogs_pct, notes, dripos_product_id } = req.body;
  if (!name || !String(name).trim()) { res.status(400).json({ error: 'Name is required' }); return; }
  const result = db.prepare(`
    INSERT INTO cog_drinks (name, category, season, target_cogs_pct, notes, dripos_product_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(String(name).trim(), category ?? null, season ?? null, target_cogs_pct ?? null, notes ?? null, dripos_product_id ?? null);
  const drinkId = result.lastInsertRowid;
  // Seed a single default variant so a freshly-created drink is immediately editable.
  db.prepare("INSERT INTO cog_drink_variants (drink_id, label, sort_order) VALUES (?, 'Regular', 0)").run(drinkId);
  res.json(db.prepare('SELECT * FROM cog_drinks WHERE id = ?').get(drinkId));
});

// Update drink (metadata only)
router.put('/cog/drinks/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const { name, category, season, target_cogs_pct, notes, archived } = req.body;
  db.prepare(`
    UPDATE cog_drinks
    SET name = ?, category = ?, season = ?, target_cogs_pct = ?, notes = ?,
        archived = COALESCE(?, archived), updated_at = datetime('now')
    WHERE id = ?
  `).run(name, category ?? null, season ?? null, target_cogs_pct ?? null, notes ?? null,
         archived == null ? null : (archived ? 1 : 0), req.params.id);
  res.json(db.prepare('SELECT * FROM cog_drinks WHERE id = ?').get(req.params.id));
});

router.delete('/cog/drinks/:id', requireAuth, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM cog_drinks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Live Dripos product list for the "Link to Dripos" picker (id/name/category,
// drinks only). Degrades to { available:false } when Dripos isn't connected.
router.get('/cog/dripos-products', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = db.prepare('SELECT drink_location_id FROM cog_settings WHERE id = 1').get() as any;
    const products = await fetchAllProducts(settings?.drink_location_id ?? 131);
    const list = products
      .filter((p) => COG_CATEGORIES.has(p.CATEGORY_NAME))
      .map((p) => ({ id: p.ID, name: p.NAME, category: p.CATEGORY_NAME ?? null }))
      .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name));
    res.json({ available: true, products: list });
  } catch (err: any) {
    const isAuth = err?.name === 'NoToken' || err?.name === 'AuthExpired';
    res.json({ available: false, reason: isAuth ? 'Dripos not connected — log in via the Weekly Sales tab' : (err.message || 'failed'), products: [] });
  }
});

// Link (or unlink, with dripos_product_id: null) a drink to a Dripos product.
// This is how spreadsheet-named drinks ("GBH", "7 Shot Richard") get live prices:
// linking adopts the Dripos product's real name + category, and if the Dripos
// sync already created a separate empty row for that product, that duplicate is
// absorbed (deleted) so the catalog has one row per product. Refuses to steal a
// product that another *costed* drink already owns.
router.post('/cog/drinks/:id/link-dripos', requireAuth, async (req: AuthRequest, res: Response) => {
  const drink = db.prepare('SELECT * FROM cog_drinks WHERE id = ?').get(req.params.id) as any;
  if (!drink) { res.status(404).json({ error: 'Drink not found' }); return; }
  const { dripos_product_id } = req.body;

  if (dripos_product_id == null) {
    db.prepare("UPDATE cog_drinks SET dripos_product_id = NULL, updated_at = datetime('now') WHERE id = ?").run(drink.id);
    res.json({ drink: db.prepare('SELECT * FROM cog_drinks WHERE id = ?').get(drink.id), absorbed: null });
    return;
  }

  try {
    const settings = db.prepare('SELECT drink_location_id FROM cog_settings WHERE id = 1').get() as any;
    const products = await fetchAllProducts(settings?.drink_location_id ?? 131);
    const product = products.find((p) => p.ID === Number(dripos_product_id));
    if (!product) { res.status(404).json({ error: 'That product was not found in Dripos' }); return; }

    const dup = db.prepare('SELECT * FROM cog_drinks WHERE dripos_product_id = ? AND id != ?').get(product.ID, drink.id) as any;
    if (dup) {
      const compCount = (db.prepare('SELECT COUNT(*) AS c FROM cog_drink_components WHERE drink_id = ?').get(dup.id) as any).c;
      if (compCount > 0) {
        res.status(409).json({ error: `"${dup.name}" is already linked to that Dripos product and has a recipe. Unlink or delete it first.` });
        return;
      }
    }
    // Delete the empty duplicate before setting the id (dripos_product_id is UNIQUE).
    const run = db.transaction(() => {
      if (dup) db.prepare('DELETE FROM cog_drinks WHERE id = ?').run(dup.id);
      db.prepare(`
        UPDATE cog_drinks SET dripos_product_id = ?, name = ?, category = ?, updated_at = datetime('now') WHERE id = ?
      `).run(product.ID, product.NAME, product.CATEGORY_NAME ?? null, drink.id);
    });
    run();
    res.json({ drink: db.prepare('SELECT * FROM cog_drinks WHERE id = ?').get(drink.id), absorbed: dup ? dup.name : null });
  } catch (err: any) {
    console.error('Dripos link error:', err);
    res.status(500).json({ error: err.message || 'Link failed' });
  }
});

// --- Variants ---

router.post('/cog/drinks/:id/variants', requireAuth, (req: AuthRequest, res: Response) => {
  const { label, temp, size, menu_price, target_cogs_pct } = req.body;
  if (!label || !String(label).trim()) { res.status(400).json({ error: 'Variant label is required' }); return; }
  const maxOrder = db.prepare('SELECT MAX(sort_order) AS max FROM cog_drink_variants WHERE drink_id = ?').get(req.params.id) as any;
  const result = db.prepare(`
    INSERT INTO cog_drink_variants (drink_id, label, temp, size, menu_price, target_cogs_pct, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, String(label).trim(), temp ?? null, size ?? null, menu_price ?? null, target_cogs_pct ?? null, (maxOrder?.max ?? -1) + 1);
  res.json(db.prepare('SELECT * FROM cog_drink_variants WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/cog/variants/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const { label, temp, size, menu_price, target_cogs_pct } = req.body;
  db.prepare(`
    UPDATE cog_drink_variants
    SET label = COALESCE(?, label), temp = ?, size = ?, menu_price = ?, target_cogs_pct = ?
    WHERE id = ?
  `).run(label ?? null, temp ?? null, size ?? null, menu_price ?? null, target_cogs_pct ?? null, req.params.id);
  res.json(db.prepare('SELECT * FROM cog_drink_variants WHERE id = ?').get(req.params.id));
});

router.delete('/cog/variants/:id', requireAuth, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM cog_drink_variants WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// --- Components (belong to a variant) ---

router.post('/cog/variants/:id/components', requireAuth, (req: AuthRequest, res: Response) => {
  const { component_type, ingredient_id, recipe_id, quantity, unit, yield_percent } = req.body;
  if (component_type !== 'ingredient' && component_type !== 'recipe') {
    res.status(400).json({ error: "component_type must be 'ingredient' or 'recipe'" });
    return;
  }
  if (component_type === 'ingredient' && !ingredient_id) {
    res.status(400).json({ error: 'ingredient_id is required for an ingredient component' });
    return;
  }
  if (component_type === 'recipe' && !recipe_id) {
    res.status(400).json({ error: 'recipe_id is required for a recipe component' });
    return;
  }
  const variant = db.prepare('SELECT drink_id FROM cog_drink_variants WHERE id = ?').get(req.params.id) as any;
  if (!variant) { res.status(404).json({ error: 'Variant not found' }); return; }
  const maxOrder = db.prepare('SELECT MAX(sort_order) AS max FROM cog_drink_components WHERE variant_id = ?').get(req.params.id) as any;
  const result = db.prepare(`
    INSERT INTO cog_drink_components (drink_id, variant_id, component_type, ingredient_id, recipe_id, quantity, unit, yield_percent, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    variant.drink_id,
    req.params.id,
    component_type,
    component_type === 'ingredient' ? ingredient_id : null,
    component_type === 'recipe' ? recipe_id : null,
    quantity ?? null, unit ?? null, yield_percent ?? 100, (maxOrder?.max ?? -1) + 1,
  );
  res.json(db.prepare('SELECT * FROM cog_drink_components WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/cog/components/:id', requireAuth, (req: AuthRequest, res: Response) => {
  const { quantity, unit, yield_percent, ingredient_id, recipe_id } = req.body;
  db.prepare(`
    UPDATE cog_drink_components
    SET quantity = ?, unit = ?, yield_percent = ?,
        ingredient_id = COALESCE(?, ingredient_id),
        recipe_id = COALESCE(?, recipe_id)
    WHERE id = ?
  `).run(quantity ?? null, unit ?? null, yield_percent ?? 100, ingredient_id ?? null, recipe_id ?? null, req.params.id);
  res.json(db.prepare('SELECT * FROM cog_drink_components WHERE id = ?').get(req.params.id));
});

router.delete('/cog/components/:id', requireAuth, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM cog_drink_components WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Sync the drink catalog from Dripos. Upserts by dripos_product_id: inserts new
// products, refreshes name/category on existing ones, and NEVER clobbers a
// drink's components or its target_cogs_pct override. Only COG_CATEGORIES
// products come in (the 5 drink categories + Bake Haus food); previously-synced
// rows outside those categories are pruned unless they carry a recipe.
router.post('/cog/drinks/sync-dripos', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const settings = db.prepare('SELECT drink_location_id FROM cog_settings WHERE id = 1').get() as any;
    const locationId = settings?.drink_location_id ?? 131;
    const products = await fetchAllProducts(locationId); // already drops ARCHIVED
    const drinks = products.filter((p) => COG_CATEGORIES.has(p.CATEGORY_NAME));

    const findStmt = db.prepare('SELECT id FROM cog_drinks WHERE dripos_product_id = ?');
    const insertStmt = db.prepare(
      'INSERT INTO cog_drinks (dripos_product_id, name, category) VALUES (?, ?, ?)',
    );
    const updateStmt = db.prepare(
      "UPDATE cog_drinks SET name = ?, category = ?, updated_at = datetime('now') WHERE dripos_product_id = ?",
    );

    let inserted = 0;
    let updated = 0;
    let pruned = 0;
    const run = db.transaction(() => {
      for (const p of drinks) {
        const existing = findStmt.get(p.ID) as any;
        if (existing) {
          updateStmt.run(p.NAME, p.CATEGORY_NAME, p.ID);
          updated++;
        } else {
          insertStmt.run(p.ID, p.NAME, p.CATEGORY_NAME);
          inserted++;
        }
      }
      // Drop rows synced before the category allowlist existed — but never a
      // row someone has costed (components) — those need a human decision.
      const cats = [...COG_CATEGORIES];
      pruned = db.prepare(`
        DELETE FROM cog_drinks WHERE id IN (
          SELECT d.id FROM cog_drinks d
          LEFT JOIN cog_drink_components c ON c.drink_id = d.id
          WHERE d.category IS NOT NULL
            AND d.category NOT IN (${cats.map(() => '?').join(',')})
          GROUP BY d.id
          HAVING COUNT(c.id) = 0
        )
      `).run(...cats).changes;
    });
    run();

    res.json({ success: true, total: drinks.length, inserted, updated, pruned, location_id: locationId });
  } catch (err: any) {
    console.error('Dripos drink sync error:', err);
    res.status(500).json({ error: err.message || 'Sync failed' });
  }
});

// Import drink recipes from the bundled Cost-of-Goods export
// (server/germania-cog-drinks.json — parsed from the per-drink sheets, each
// drink with size/temp variants and ingredient-name components). Idempotent:
// matches each drink to an existing one by name (case-insensitive) so it links
// to the Dripos-synced catalog instead of duplicating; rebuilds that drink's
// variants from the sheet each run. Components are resolved ingredient name ->
// cog_ingredient_master; unresolved names are skipped and reported back so the
// catalog can be filled in. Run the ingredient import first.
router.post('/cog/drinks/import-recipes', requireAuth, (_req: AuthRequest, res: Response) => {
  try {
    const dataPath = path.join(__routesDir, 'germania-cog-drinks.json');
    if (!fs.existsSync(dataPath)) { res.status(404).json({ error: 'Drink recipe file not found on server' }); return; }
    const drinks = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as Array<{
      name: string; category: string | null;
      variants: Array<{ label: string; temp: string | null; size: string | null; menu_price: number | null;
        components: Array<{ ingredient_name: string; quantity: number | null; unit: string | null }> }>;
    }>;

    // ingredient name -> id (case-insensitive)
    const ingRows = db.prepare('SELECT id, name FROM cog_ingredient_master').all() as Array<{ id: number; name: string }>;
    const ingByName = new Map(ingRows.map((r) => [r.name.toLowerCase(), r.id]));

    const findDrinkByName = db.prepare('SELECT id FROM cog_drinks WHERE LOWER(name) = LOWER(?)');
    const insertDrink = db.prepare('INSERT INTO cog_drinks (name, category) VALUES (?, ?)');
    const clearVariants = db.prepare('DELETE FROM cog_drink_variants WHERE drink_id = ?');
    const insertVariant = db.prepare('INSERT INTO cog_drink_variants (drink_id, label, temp, size, menu_price, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    const insertComp = db.prepare(`INSERT INTO cog_drink_components (drink_id, variant_id, component_type, ingredient_id, quantity, unit, sort_order)
      VALUES (?, ?, 'ingredient', ?, ?, ?, ?)`);

    let drinksCreated = 0, drinksMatched = 0, variantCount = 0, compCount = 0;
    const unresolved = new Set<string>();

    const run = db.transaction(() => {
      for (const d of drinks) {
        let row = findDrinkByName.get(d.name) as any;
        let drinkId: number;
        if (row) { drinkId = row.id; drinksMatched++; }
        else { drinkId = insertDrink.run(d.name, d.category ?? null).lastInsertRowid as number; drinksCreated++; }

        clearVariants.run(drinkId); // cascade clears old components
        d.variants.forEach((v, vi) => {
          const variantId = insertVariant.run(drinkId, v.label, v.temp ?? null, v.size ?? null, v.menu_price ?? null, vi).lastInsertRowid as number;
          variantCount++;
          v.components.forEach((c, ci) => {
            const ingId = ingByName.get((c.ingredient_name || '').toLowerCase());
            if (!ingId) { unresolved.add(c.ingredient_name); return; }
            insertComp.run(drinkId, variantId, ingId, c.quantity ?? null, c.unit ?? null, ci);
            compCount++;
          });
        });
      }
    });
    run();

    res.json({
      success: true,
      drinks_in_file: drinks.length,
      drinks_created: drinksCreated,
      drinks_matched_to_existing: drinksMatched,
      variants: variantCount,
      components: compCount,
      unresolved_ingredients: [...unresolved].sort(),
    });
  } catch (err: any) {
    console.error('Drink recipe import error:', err);
    res.status(500).json({ error: err.message || 'Import failed' });
  }
});

export default router;
