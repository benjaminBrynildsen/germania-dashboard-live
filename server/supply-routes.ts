import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from './auth.js';
import { STORES } from './dripos.js';
import { emailConfigured, sendEmail } from './email.js';
import {
  isVendor, VENDORS, VendorKey, listItems, createItem, updateItem, getItem,
  getWeekCart, setLine, setNote, getSettings, saveSettings, parseEmailList,
  buildOrderEmail, isUpdateSend, recordSubmission, listSubmissions, getSubmissionHtml,
  importProduct,
} from './supply-orders.js';

const router = Router();

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

function vendorOf(req: AuthRequest, res: Response): VendorKey | null {
  const v = req.params.vendor;
  if (!isVendor(v)) { res.status(404).json({ error: 'unknown_vendor' }); return null; }
  return v;
}

function weekOf(raw: unknown, res: Response): string | null {
  const w = String(raw ?? '').trim();
  if (!WEEK_RE.test(w)) { res.status(400).json({ error: 'invalid_week' }); return null; }
  return w;
}

function storeOf(raw: unknown, res: Response): string | null {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!STORES.some((x) => x.label === s)) { res.status(400).json({ error: 'invalid_store' }); return null; }
  return s;
}

/** Who's sending — a real login, never a bot's synthetic identity. */
function senderEmail(req: AuthRequest): string | null {
  const e = req.user?.email ?? '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !e.startsWith('api-key:') ? e : null;
}

router.get('/supply/:vendor/items', requireAuth, (req: AuthRequest, res: Response) => {
  const v = vendorOf(req, res); if (!v) return;
  res.json({ vendor: VENDORS[v], items: listItems(v, req.query.all === '1') });
});

router.post('/supply/:vendor/items', requireAuth, (req: AuthRequest, res: Response) => {
  const v = vendorOf(req, res); if (!v) return;
  try { res.json(createItem(v, req.body ?? {})); }
  catch (e: any) { res.status(400).json({ error: e.message }); }
});

router.put('/supply/items/:id', requireAuth, (req: AuthRequest, res: Response) => {
  try {
    const it = updateItem(Number(req.params.id), req.body ?? {});
    if (!it) { res.status(404).json({ error: 'not_found' }); return; }
    res.json(it);
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

router.post('/supply/:vendor/import', requireAuth, async (req: AuthRequest, res: Response) => {
  const v = vendorOf(req, res); if (!v) return;
  try { res.json(await importProduct(v, String(req.body?.url ?? ''))); }
  catch (e: any) { res.status(400).json({ error: e.message || 'Import failed' }); }
});

router.get('/supply/:vendor/week', requireAuth, (req: AuthRequest, res: Response) => {
  const v = vendorOf(req, res); if (!v) return;
  const w = weekOf(req.query.week, res); if (!w) return;
  res.set('Cache-Control', 'no-store');
  res.json(getWeekCart(v, w));
});

router.put('/supply/:vendor/line', requireAuth, (req: AuthRequest, res: Response) => {
  const v = vendorOf(req, res); if (!v) return;
  const w = weekOf(req.body?.week, res); if (!w) return;
  const s = storeOf(req.body?.store, res); if (!s) return;
  const item = getItem(Number(req.body?.itemId));
  if (!item || item.vendor !== v) { res.status(400).json({ error: 'invalid_item' }); return; }
  const qty = Number(req.body?.qty);
  if (!Number.isFinite(qty) || qty < 0 || qty > 10000) {
    res.status(400).json({ error: 'Quantity must be between 0 and 10,000.' }); return;
  }
  let onHand: number | null | undefined;
  if (req.body && 'onHand' in req.body) {
    if (req.body.onHand === null) onHand = null;
    else {
      const n = Number(req.body.onHand);
      if (!Number.isFinite(n) || n < 0 || n > 10000) { res.status(400).json({ error: 'On-hand count must be between 0 and 10,000.' }); return; }
      onHand = n;
    }
  }
  setLine({ vendor: v, week: w, store: s, itemId: item.id, qty, onHand });
  res.json({ ok: true });
});

router.put('/supply/:vendor/note', requireAuth, (req: AuthRequest, res: Response) => {
  const v = vendorOf(req, res); if (!v) return;
  const w = weekOf(req.body?.week, res); if (!w) return;
  const s = storeOf(req.body?.store, res); if (!s) return;
  setNote(v, w, s, String(req.body?.note ?? ''));
  res.json({ ok: true });
});

router.get('/supply/:vendor/settings', requireAuth, (req: AuthRequest, res: Response) => {
  const v = vendorOf(req, res); if (!v) return;
  res.json({ ...getSettings(v), emailConfigured: emailConfigured(), stores: STORES.map((s) => ({ label: s.label, city: s.city })) });
});

router.put('/supply/:vendor/settings', requireAuth, (req: AuthRequest, res: Response) => {
  const v = vendorOf(req, res); if (!v) return;
  try { res.json(saveSettings(v, req.body ?? {})); }
  catch (e: any) { res.status(400).json({ error: e.message }); }
});

/** What Submit would send, built by the same code that sends it. */
router.get('/supply/:vendor/preview', requireAuth, (req: AuthRequest, res: Response) => {
  const v = vendorOf(req, res); if (!v) return;
  const w = weekOf(req.query.week, res); if (!w) return;
  const settings = getSettings(v);
  const isUpdate = isUpdateSend(v, w);
  const built = buildOrderEmail(v, w, { isUpdate, isTest: false, submittedBy: senderEmail(req) });
  const to = parseEmailList(settings.orderEmails).ok;
  const cc = parseEmailList(settings.ccEmails).ok;
  const problems: string[] = [];
  if (!emailConfigured()) problems.push('Outgoing email isn\'t set up on the server yet.');
  if (to.length === 0) problems.push(`Add ${VENDORS[v].shortName}'s order email in Settings.`);
  if (built.totalUnits === 0) problems.push('The order is empty.');
  res.set('Cache-Control', 'no-store');
  res.json({
    subject: built.subject, html: built.html, to, cc, isUpdate,
    totalUnits: built.totalUnits, storeCount: built.storeCount, problems,
    testRecipient: senderEmail(req),
  });
});

router.post('/supply/:vendor/submit', requireAuth, async (req: AuthRequest, res: Response) => {
  const v = vendorOf(req, res); if (!v) return;
  const w = weekOf(req.body?.week, res); if (!w) return;
  const isTest = req.body?.test === true;
  const settings = getSettings(v);
  const sender = senderEmail(req);

  let to: string[];
  let cc: string[] = [];
  if (isTest) {
    if (!sender) { res.status(400).json({ error: 'Test sends go to your login email, and this login has none.' }); return; }
    to = [sender];
  } else {
    to = parseEmailList(settings.orderEmails).ok;
    cc = parseEmailList(settings.ccEmails).ok;
    if (to.length === 0) { res.status(400).json({ error: `Add ${VENDORS[v].shortName}'s order email in Settings first.` }); return; }
  }

  const isUpdate = isUpdateSend(v, w);
  const built = buildOrderEmail(v, w, { isUpdate, isTest, submittedBy: sender });
  if (built.totalUnits === 0) { res.status(400).json({ error: 'The order is empty — add quantities first.' }); return; }

  try {
    await sendEmail({ to, cc, replyTo: cc, subject: built.subject, html: built.html, text: built.text });
  } catch (e: any) {
    console.error('[supply] send failed:', e);
    res.status(502).json({ error: `Email didn't send: ${e.message || 'unknown error'}` });
    return;
  }
  const summary = recordSubmission(v, w, built, { submittedBy: sender, recipients: [...to, ...cc], isUpdate, isTest });
  console.log(`[supply] ${isTest ? 'test ' : ''}order sent: ${built.subject} -> ${[...to, ...cc].join(', ')}`);
  res.json({ ok: true, submission: summary });
});

router.get('/supply/:vendor/submissions', requireAuth, (req: AuthRequest, res: Response) => {
  const v = vendorOf(req, res); if (!v) return;
  res.set('Cache-Control', 'no-store');
  res.json({ submissions: listSubmissions(v) });
});

router.get('/supply/submissions/:id/html', requireAuth, (req: AuthRequest, res: Response) => {
  const html = getSubmissionHtml(Number(req.params.id));
  if (!html) { res.status(404).send('Not found'); return; }
  // Rendered inside a sandboxed iframe in the app.
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
});

export default router;
