/**
 * Fundraiser totals across all four stores.
 *
 * Dripos's dashboard (dashboard.dripos.com/fundraisers) is location-scoped,
 * so it never shows a chain-wide total — that's the whole reason this exists.
 * We pull the fundraiser data once per store and sum.
 *
 * The exact API path behind that dashboard page isn't documented, so this
 * module probes a short list of candidates that follow Dripos's known
 * conventions (plain GET resources like /products, "dumb" list endpoints
 * like /tickets/dumb and /patrons/dumb/v2) and remembers the first one that
 * answers. Every response is normalized defensively (case-insensitive field
 * lookup across the names Dripos plausibly uses) and the winning path +
 * field names are logged so a mismatch is easy to correct from prod logs.
 *
 * Fallback: fundraiser donations ring up as ticket line items, and we sync
 * tickets nightly. When the Dripos API yields nothing (no token, or none of
 * the candidate paths answer), totals are derived from ticket_items rows
 * whose type/name looks like a donation. That source is labeled so the UI
 * can say where the number came from.
 */
import db from './db.js';
import { callApi, STORES, NoToken, AuthExpired } from './dripos.js';

export interface FundraiserPerStore {
  label: string;
  totalCents: number | null;
}

export interface FundraiserSummary {
  key: string;
  name: string;
  active: boolean;
  totalCents: number;
  goalCents: number | null;
  startMs: number | null;
  endMs: number | null;
  perStore: FundraiserPerStore[];
}

export interface FundraiserReport {
  available: boolean;
  source: 'dripos' | 'tickets' | null;
  path: string | null;
  reason: string | null;
  fundraisers: FundraiserSummary[];
  fetchedAt: number;
}

// ── Candidate endpoints ───────────────────────────────────────────
const LIST_BODY = {
  SEARCH: null,
  FILTERS: [],
  CURSOR: { KEY: 'BEFORE', VALUE: null },
  SORT_DESC: true,
  SORT: null,
  OFFSET: 0,
  RETURN_COUNT: false,
  ROWS: 100,
};

interface Candidate {
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
}

const CANDIDATES: Candidate[] = [
  { path: '/fundraisers', method: 'GET' },
  { path: '/fundraiser', method: 'GET' },
  { path: '/fundraisers/dumb', method: 'POST', body: LIST_BODY },
  { path: '/fundraiser/dumb', method: 'POST', body: LIST_BODY },
];

// Remember the candidate that answered so subsequent refreshes skip the probe.
let workingCandidate: Candidate | null = null;

// ── Normalization helpers ─────────────────────────────────────────

/** Case-insensitive field lookup: first present, non-null value wins. */
function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), obj[k]]));
  for (const k of keys) {
    const v = lower.get(k.toLowerCase());
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** Dig the fundraiser array out of whatever envelope the endpoint uses. */
function extractArray(data: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    // Common envelopes: { data: [...] } (dumb lists), { FUNDRAISERS: [...] }.
    for (const key of ['data', 'FUNDRAISERS', 'fundraisers', 'RECORDS']) {
      if (Array.isArray(obj[key])) return obj[key] as Array<Record<string, unknown>>;
    }
    // A single fundraiser object (has a name-ish field) counts as a 1-list.
    if (pick(obj, 'NAME', 'TITLE', 'FUNDRAISER_NAME') !== undefined) return [obj];
  }
  return null;
}

interface NormalizedEntry {
  key: string;
  name: string;
  active: boolean;
  amountCents: number | null;
  goalCents: number | null;
  startMs: number | null;
  endMs: number | null;
}

function normalizeEntry(raw: Record<string, unknown>): NormalizedEntry {
  const name = String(pick(raw, 'NAME', 'TITLE', 'FUNDRAISER_NAME') ?? 'Fundraiser');
  const key = String(pick(raw, 'UNIQUE_ID', 'ID') ?? name);
  const amountCents = asNumber(pick(
    raw,
    'AMOUNT_RAISED', 'TOTAL_RAISED', 'TOTAL_COLLECTED', 'TOTAL_DONATED',
    'TOTAL_DONATIONS', 'DONATION_TOTAL', 'AMOUNT_COLLECTED', 'RAISED', 'TOTAL',
  ));
  const goalCents = asNumber(pick(raw, 'GOAL', 'GOAL_AMOUNT', 'TARGET', 'TARGET_AMOUNT', 'AMOUNT_GOAL'));
  const startMs = asNumber(pick(raw, 'DATE_START', 'START_EPOCH', 'DATE_CREATED'));
  const endMs = asNumber(pick(raw, 'DATE_END', 'END_EPOCH', 'DATE_ARCHIVED'));

  const enabled = pick(raw, 'ENABLED', 'ACTIVE', 'IS_ACTIVE');
  const status = pick(raw, 'STATUS');
  let active: boolean;
  if (enabled !== undefined) {
    active = enabled === true || enabled === 1 || enabled === '1';
  } else if (typeof status === 'string') {
    active = /active|live|running|open/i.test(status);
  } else {
    active = endMs == null || endMs > Date.now();
  }
  return { key, name, active, amountCents, goalCents, startMs, endMs };
}

// ── Dripos source ─────────────────────────────────────────────────

async function tryCandidate(c: Candidate, locationId: number): Promise<Array<Record<string, unknown>> | null> {
  try {
    const r = await callApi<unknown>(c.path, {
      method: c.method,
      locationId,
      body: c.body,
    });
    if (r.success === false) return null;
    return extractArray(r.data);
  } catch (err) {
    // Auth problems apply to every candidate — bail out entirely.
    if (err instanceof NoToken || err instanceof AuthExpired) throw err;
    return null;
  }
}

async function fetchFromDripos(): Promise<{ path: string; fundraisers: FundraiserSummary[] } | null> {
  // Find (or reuse) the candidate path that answers.
  let candidate = workingCandidate;
  let firstStoreEntries: Array<Record<string, unknown>> | null = null;
  if (candidate) {
    firstStoreEntries = await tryCandidate(candidate, STORES[0].locationId);
    if (firstStoreEntries == null) candidate = workingCandidate = null; // path stopped answering — reprobe
  }
  if (!candidate) {
    for (const c of CANDIDATES) {
      const entries = await tryCandidate(c, STORES[0].locationId);
      if (entries != null) {
        candidate = c;
        workingCandidate = c;
        firstStoreEntries = entries;
        console.log(`[fundraisers] Dripos path ${c.method} ${c.path} answered with ${entries.length} entries`);
        if (entries[0]) console.log(`[fundraisers] first entry fields: ${Object.keys(entries[0]).join(', ')}`);
        break;
      }
    }
  }
  if (!candidate) return null;

  // Pull per-store, keyed by fundraiser identity, then sum across stores.
  const byKey = new Map<string, { meta: NormalizedEntry; perStore: Map<string, number | null> }>();
  for (const store of STORES) {
    const entries = store.locationId === STORES[0].locationId && firstStoreEntries != null
      ? firstStoreEntries
      : await tryCandidate(candidate, store.locationId);
    for (const raw of entries ?? []) {
      const e = normalizeEntry(raw);
      let slot = byKey.get(e.key);
      if (!slot) {
        slot = { meta: e, perStore: new Map() };
        byKey.set(e.key, slot);
      }
      slot.perStore.set(store.label, e.amountCents);
    }
  }
  if (byKey.size === 0) return { path: candidate.path, fundraisers: [] };

  const fundraisers: FundraiserSummary[] = [...byKey.values()].map(({ meta, perStore }) => ({
    key: meta.key,
    name: meta.name,
    active: meta.active,
    totalCents: STORES.reduce((sum, s) => sum + (perStore.get(s.label) ?? 0), 0),
    goalCents: meta.goalCents,
    startMs: meta.startMs,
    endMs: meta.endMs,
    perStore: STORES.map((s) => ({ label: s.label, totalCents: perStore.get(s.label) ?? null })),
  }));
  fundraisers.sort((a, b) => Number(b.active) - Number(a.active) || (b.startMs ?? 0) - (a.startMs ?? 0));
  return { path: candidate.path, fundraisers };
}

// ── Ticket-derived fallback ───────────────────────────────────────
// Donations ring up as line items; sum anything donation-shaped from the
// nightly ticket sync. Covers only days the sync has pulled, so it's the
// backup, not the primary.

function fetchFromTickets(): FundraiserSummary[] {
  const rows = db.prepare(`
    SELECT t.location_id AS location_id, ti.name AS name,
           SUM(COALESCE(ti.total_cents, ti.amount_cents, 0)) AS cents,
           MIN(t.date_created_ms) AS first_ms,
           MAX(t.date_created_ms) AS last_ms
    FROM ticket_items ti
    JOIN tickets t ON t.id = ti.ticket_id
    WHERE UPPER(COALESCE(ti.type, '')) LIKE '%FUNDRAIS%'
       OR UPPER(COALESCE(ti.type, '')) LIKE '%DONAT%'
       OR UPPER(ti.name) LIKE '%FUNDRAIS%'
       OR UPPER(ti.name) LIKE '%DONAT%'
       OR UPPER(ti.name) LIKE '%ROUND UP%'
       OR UPPER(ti.name) LIKE '%ROUND-UP%'
    GROUP BY t.location_id, ti.name
  `).all() as Array<{ location_id: number; name: string; cents: number; first_ms: number; last_ms: number }>;
  if (rows.length === 0) return [];

  const byName = new Map<string, { perStore: Map<string, number>; firstMs: number; lastMs: number }>();
  const labelByLocation = new Map(STORES.map((s) => [s.locationId, s.label]));
  for (const r of rows) {
    const label = labelByLocation.get(r.location_id);
    if (!label) continue;
    let slot = byName.get(r.name);
    if (!slot) {
      slot = { perStore: new Map(), firstMs: r.first_ms, lastMs: r.last_ms };
      byName.set(r.name, slot);
    }
    slot.perStore.set(label, (slot.perStore.get(label) ?? 0) + r.cents);
    slot.firstMs = Math.min(slot.firstMs, r.first_ms);
    slot.lastMs = Math.max(slot.lastMs, r.last_ms);
  }
  const WEEK_MS = 7 * 86_400_000;
  const out: FundraiserSummary[] = [...byName.entries()].map(([name, slot]) => ({
    key: name,
    name,
    active: Date.now() - slot.lastMs < WEEK_MS,
    totalCents: STORES.reduce((sum, s) => sum + (slot.perStore.get(s.label) ?? 0), 0),
    goalCents: null,
    startMs: slot.firstMs,
    endMs: null,
    perStore: STORES.map((s) => ({ label: s.label, totalCents: slot.perStore.get(s.label) ?? null })),
  }));
  out.sort((a, b) => Number(b.active) - Number(a.active) || (b.startMs ?? 0) - (a.startMs ?? 0));
  return out;
}

// ── Public entry point ────────────────────────────────────────────

let cache: { report: FundraiserReport; ts: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getFundraiserReport(force = false): Promise<FundraiserReport> {
  if (!force && cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.report;

  let report: FundraiserReport;
  try {
    const dripos = await fetchFromDripos();
    if (dripos && dripos.fundraisers.length > 0) {
      report = {
        available: true, source: 'dripos', path: dripos.path, reason: null,
        fundraisers: dripos.fundraisers, fetchedAt: Date.now(),
      };
    } else {
      const tickets = fetchFromTickets();
      report = {
        available: tickets.length > 0,
        source: tickets.length > 0 ? 'tickets' : null,
        path: dripos?.path ?? null,
        reason: tickets.length > 0
          ? null
          : (dripos ? 'Dripos returned no fundraisers and none found in synced tickets' : 'No Dripos fundraiser endpoint answered and none found in synced tickets'),
        fundraisers: tickets,
        fetchedAt: Date.now(),
      };
    }
  } catch (err) {
    const isAuth = err instanceof NoToken || err instanceof AuthExpired;
    const tickets = fetchFromTickets();
    report = {
      available: tickets.length > 0,
      source: tickets.length > 0 ? 'tickets' : null,
      path: null,
      reason: tickets.length > 0
        ? null
        : (isAuth ? 'Dripos not connected — log in via the Weekly Sales tab' : (err instanceof Error ? err.message : 'fundraiser lookup failed')),
      fundraisers: tickets,
      fetchedAt: Date.now(),
    };
  }
  cache = { report, ts: Date.now() };
  return report;
}
