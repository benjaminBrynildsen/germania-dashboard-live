import { Router, Response } from 'express';
import db from './db.js';
import { requireAuth, requireRole, AuthRequest } from './auth.js';
import { createIdeaForm, createVotingForm, getFormResponses, createDriveFolder } from './google.js';
import { fetchPlaceReviews, syncAllReviews } from './places.js';
import { seedCogData } from './seed-cog.js';

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

  res.json({
    location: {
      id: loc.id,
      name: loc.name,
      address: loc.address,
      googleRating: loc.google_rating,
      reviewCount: loc.review_count,
      googleMapsUrl: loc.google_maps_url,
    },
    reviews,
    distribution,
    monthlyAvg,
    source: dbReviews.length > 0 ? 'google_places_api' : 'demo',
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
router.post('/cog/seed', requireAuth, requireRole('admin', 'manager'), (_req: AuthRequest, res: Response) => {
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
router.post('/cog/recipes', requireAuth, requireRole('admin', 'manager', 'menu_team'), (req: AuthRequest, res: Response) => {
  const { name, season, category, total_yield, yield_unit, labor_time_hrs, labor_quantity, labor_cook_rate, labor_cost_per_unit } = req.body;
  
  const result = db.prepare(`
    INSERT INTO cog_recipes (name, season, category, total_yield, yield_unit, labor_time_hrs, labor_quantity, labor_cook_rate, labor_cost_per_unit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, season, category, total_yield, yield_unit, labor_time_hrs, labor_quantity, labor_cook_rate, labor_cost_per_unit);

  const recipe = db.prepare('SELECT * FROM cog_recipes WHERE id = ?').get(result.lastInsertRowid);
  res.json(recipe);
});

// Update recipe
router.put('/cog/recipes/:id', requireAuth, requireRole('admin', 'manager', 'menu_team'), (req: AuthRequest, res: Response) => {
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

// Delete recipe
router.delete('/cog/recipes/:id', requireAuth, requireRole('admin', 'manager'), (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM cog_recipes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Add ingredient to recipe
router.post('/cog/recipes/:id/ingredients', requireAuth, requireRole('admin', 'manager', 'menu_team'), (req: AuthRequest, res: Response) => {
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
router.put('/cog/ingredients/:id', requireAuth, requireRole('admin', 'manager', 'menu_team'), (req: AuthRequest, res: Response) => {
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
router.delete('/cog/ingredients/:id', requireAuth, requireRole('admin', 'manager', 'menu_team'), (req: AuthRequest, res: Response) => {
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
router.put('/cog/ingredients/master/:id', requireAuth, requireRole('admin', 'manager'), (req: AuthRequest, res: Response) => {
  const { ap_pack_cost, pack_size, pack_unit, supplier } = req.body;
  
  db.prepare(`
    UPDATE cog_ingredient_master
    SET ap_pack_cost = ?, pack_size = ?, pack_unit = ?, supplier = ?, last_updated = datetime('now')
    WHERE id = ?
  `).run(ap_pack_cost, pack_size, pack_unit, supplier, req.params.id);

  const ingredient = db.prepare('SELECT * FROM cog_ingredient_master WHERE id = ?').get(req.params.id);
  res.json(ingredient);
});

export default router;
