/**
 * Patron funnel — parse Dripos's "All Patrons" CSV export and aggregate
 * by First Seen month into a Jon Taffer-style retention funnel.
 *
 * Conversion-rate columns (matching Ben's spreadsheet):
 *   % 2+ Visits  = (≥2 visits) / total      → 1→2 conversion  (Taffer: 40–42%)
 *   % 3+ Visits  = (≥3 visits) / (≥2 visits) → 2→3 conversion  (Taffer: 42–47%)
 *   % 4+ Visits  = (≥4 visits) / (≥3 visits) → 3→4 conversion  (Taffer: ≥70%)
 */
import db from './db.js';

/** Minimal CSV parser — handles quoted fields with embedded commas/quotes.
 *  Not RFC-compliant in every edge case but solid enough for Dripos exports. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cell += c; }
    } else {
      if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') {
        row.push(cell); cell = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      }
      else if (c === '"' && cell === '') { inQuotes = true; }
      else { cell += c; }
    }
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** Parse "$24.73" / "24.73" / "" → cents. NaN-safe (returns null). */
function dollarToCents(input: string | undefined): number | null {
  if (!input) return null;
  const cleaned = input.replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Parse "MM/DD/YY" → "YYYY-MM-DD". Dripos uses 2-digit years. We assume
 *  years 00-79 → 2000s and 80-99 → 1900s (matching Dripos's behavior). */
function mmddyyToIso(input: string | undefined): string | null {
  if (!input) return null;
  const m = input.trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (!m) return null;
  const mo = parseInt(m[1], 10);
  const dy = parseInt(m[2], 10);
  let yr = parseInt(m[3], 10);
  if (yr < 100) yr += yr <= 79 ? 2000 : 1900;
  if (mo < 1 || mo > 12 || dy < 1 || dy > 31) return null;
  return `${yr}-${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')}`;
}

/** Header normalization so column order changes in the export don't
 *  break us. Each canonical key maps to one or more header aliases. */
const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', 'full name'],
  phone: ['phone', 'phone number'],
  email: ['email', 'email address'],
  total_tickets: ['total tickets', 'tickets', 'total visits', 'visits'],
  first_seen: ['first seen', 'first visit', 'first ticket'],
  last_seen: ['last seen', 'last visit', 'last ticket'],
  total_spend: ['total spend', 'lifetime spend'],
  total_tips: ['total tips'],
  average_ticket: ['average ticket', 'avg ticket'],
  current_points: ['current points', 'points'],
  text_subscribed: ['text subscribed', 'sms subscribed'],
  email_subscribed: ['email subscribed'],
};

function indexHeaders(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    const lower = h.trim().toLowerCase();
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(lower) && map[canonical] === undefined) {
        map[canonical] = i;
      }
    }
  });
  return map;
}

export interface ParsedPatron {
  name: string | null;
  phone: string | null;
  email: string | null;
  totalTickets: number;
  firstSeenIso: string | null;
  lastSeenIso: string | null;
  totalSpendCents: number | null;
  totalTipsCents: number | null;
  averageTicketCents: number | null;
  currentPoints: number | null;
  textSubscribed: boolean;
  emailSubscribed: boolean;
}

export function parsePatronsCsv(text: string): ParsedPatron[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headerIdx = indexHeaders(rows[0]);
  const out: ParsedPatron[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (k: string): string | undefined => {
      const idx = headerIdx[k];
      return idx === undefined ? undefined : (r[idx] ?? '').trim();
    };
    const tickets = parseInt(get('total_tickets') ?? '0', 10);
    const firstSeen = mmddyyToIso(get('first_seen'));
    if (!firstSeen) continue; // Patron with no first-seen is useless for the funnel
    out.push({
      name: get('name') || null,
      phone: get('phone') || null,
      email: get('email') || null,
      totalTickets: Number.isFinite(tickets) ? tickets : 0,
      firstSeenIso: firstSeen,
      lastSeenIso: mmddyyToIso(get('last_seen')),
      totalSpendCents: dollarToCents(get('total_spend')),
      totalTipsCents: dollarToCents(get('total_tips')),
      averageTicketCents: dollarToCents(get('average_ticket')),
      currentPoints: Number.parseFloat((get('current_points') || '').replace(/[$,]/g, '')) || null,
      textSubscribed: /^y(es)?$|^true$|^1$/i.test(get('text_subscribed') || ''),
      emailSubscribed: /^y(es)?$|^true$|^1$/i.test(get('email_subscribed') || ''),
    });
  }
  return out;
}

export function replacePatrons(parsed: ParsedPatron[], opts: { uploadedBy: string | null; filename: string | null }): { rowCount: number } {
  const ins = db.transaction((rows: ParsedPatron[]) => {
    db.prepare('DELETE FROM patrons').run();
    const stmt = db.prepare(
      `INSERT INTO patrons (
         name, phone, email, total_tickets,
         first_seen_iso, last_seen_iso,
         total_spend_cents, total_tips_cents, average_ticket_cents,
         current_points, text_subscribed, email_subscribed
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const p of rows) {
      stmt.run(
        p.name, p.phone, p.email, p.totalTickets,
        p.firstSeenIso, p.lastSeenIso,
        p.totalSpendCents, p.totalTipsCents, p.averageTicketCents,
        p.currentPoints, p.textSubscribed ? 1 : 0, p.emailSubscribed ? 1 : 0,
      );
    }
    db.prepare(
      `UPDATE patrons_upload_meta SET
         uploaded_at = ?, uploaded_by = ?, row_count = ?, filename = ?
       WHERE id = 1`,
    ).run(Date.now(), opts.uploadedBy, rows.length, opts.filename);
  });
  ins(parsed);
  return { rowCount: parsed.length };
}

export interface FunnelMonth {
  yearMonth: string;       // 'YYYY-MM'
  label: string;           // 'Apr 2026'
  total: number;           // 1st-time customers
  oneOnly: number;         // total_tickets === 1
  twoPlus: number;         // total_tickets >= 2 (the 1→2 cohort)
  exactlyTwo: number;
  threePlus: number;       // total_tickets >= 3 (the 2→3 cohort)
  exactlyThree: number;
  fourPlus: number;        // total_tickets >= 4 (the 3→4 cohort)
  pct2Plus: number | null; // 1→2 conversion
  pct3Plus: number | null; // 2→3 conversion (relative to ≥2)
  pct4Plus: number | null; // 3→4 conversion (relative to ≥3)
  /** True when this month is too recent for the funnel to be mature
   *  (a patron whose first visit was last week can't be a 4-visit
   *  regular yet). Set when month is within the last ~3 months. */
  immature: boolean;
}

export interface FunnelChainSummary {
  total: number;
  twoPlus: number;
  threePlus: number;
  fourPlus: number;
  pct2Plus: number | null;
  pct3Plus: number | null;
  pct4Plus: number | null;
}

export interface PatronFunnelReport {
  uploadedAt: number | null;
  uploadedBy: string | null;
  rowCount: number;
  filename: string | null;
  chain: FunnelChainSummary;
  monthly: FunnelMonth[];
}

const TAFFER = { pct2Plus: 40, pct3Plus: 42, pct4Plus: 70 };
export const TAFFER_BENCHMARKS = TAFFER;

function monthLabel(yearMonth: string): string {
  // 'YYYY-MM' → 'Apr 2026'
  const [y, m] = yearMonth.split('-');
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return date.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

function pct(num: number, denom: number): number | null {
  if (denom <= 0) return null;
  return Math.round((num / denom) * 1000) / 10;
}

export function buildFunnelReport(): PatronFunnelReport {
  const meta = db.prepare(
    'SELECT uploaded_at, uploaded_by, row_count, filename FROM patrons_upload_meta WHERE id = 1',
  ).get() as { uploaded_at: number | null; uploaded_by: string | null; row_count: number | null; filename: string | null } | undefined;

  const rows = db.prepare(
    'SELECT first_seen_iso, total_tickets FROM patrons WHERE first_seen_iso IS NOT NULL',
  ).all() as Array<{ first_seen_iso: string; total_tickets: number }>;

  // Chain summary (across all patrons regardless of month).
  const chain: FunnelChainSummary = {
    total: rows.length,
    twoPlus: rows.filter((r) => r.total_tickets >= 2).length,
    threePlus: rows.filter((r) => r.total_tickets >= 3).length,
    fourPlus: rows.filter((r) => r.total_tickets >= 4).length,
    pct2Plus: null, pct3Plus: null, pct4Plus: null,
  };
  chain.pct2Plus = pct(chain.twoPlus, chain.total);
  chain.pct3Plus = pct(chain.threePlus, chain.twoPlus);
  chain.pct4Plus = pct(chain.fourPlus, chain.threePlus);

  // Monthly buckets.
  const buckets = new Map<string, FunnelMonth>();
  for (const r of rows) {
    const ym = r.first_seen_iso.slice(0, 7);
    let b = buckets.get(ym);
    if (!b) {
      b = {
        yearMonth: ym,
        label: monthLabel(ym),
        total: 0, oneOnly: 0, twoPlus: 0, exactlyTwo: 0,
        threePlus: 0, exactlyThree: 0, fourPlus: 0,
        pct2Plus: null, pct3Plus: null, pct4Plus: null,
        immature: false,
      };
      buckets.set(ym, b);
    }
    b.total++;
    if (r.total_tickets === 1) b.oneOnly++;
    if (r.total_tickets >= 2) b.twoPlus++;
    if (r.total_tickets === 2) b.exactlyTwo++;
    if (r.total_tickets >= 3) b.threePlus++;
    if (r.total_tickets === 3) b.exactlyThree++;
    if (r.total_tickets >= 4) b.fourPlus++;
  }

  // Maturity threshold: anything within the last 3 calendar months is
  // flagged as "patrons haven't had time to make a 4th visit yet."
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const immatureCutoff = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}`;

  const monthly: FunnelMonth[] = Array.from(buckets.values()).map((b) => ({
    ...b,
    pct2Plus: pct(b.twoPlus, b.total),
    pct3Plus: pct(b.threePlus, b.twoPlus),
    pct4Plus: pct(b.fourPlus, b.threePlus),
    immature: b.yearMonth >= immatureCutoff,
  })).sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

  return {
    uploadedAt: meta?.uploaded_at ?? null,
    uploadedBy: meta?.uploaded_by ?? null,
    rowCount: meta?.row_count ?? rows.length,
    filename: meta?.filename ?? null,
    chain,
    monthly,
  };
}
