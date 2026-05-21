/**
 * Pastry → drink pairing analysis. For each item in the BAKE HAUS FOOD
 * catalog, find every ticket that included it, count what else was on
 * those tickets, and rank by frequency.
 *
 * The point (per Ben 2026-05-20): figure out marketing pairings — when
 * someone buys a Maple Brown Sugar Scone, which drink do they actually
 * pair it with? Then we can recommend that drink to people who like
 * scones, or vice versa.
 */
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from './auth.js';
import db from './db.js';
import { BAKE_HAUS_ITEMS } from './bake-haus.js';
import { STORES } from './dripos.js';

const router = Router();

interface PairingRow {
  pasteName: string;
  pairedName: string;
  coTickets: number;
}

router.get('/pairings/pastry', requireAuth, (req: AuthRequest, res: Response) => {
  // Filter by store + date range. Defaults: all stores, last 90 days.
  const days = Math.max(7, Math.min(365, Number(req.query.days) || 90));
  const locationLabel = typeof req.query.location === 'string' ? req.query.location : null;
  const locationId = locationLabel
    ? STORES.find((s) => s.label === locationLabel)?.locationId ?? null
    : null;

  const fromMs = Date.now() - days * 86400_000;

  // The set of "pastry" names is BAKE_HAUS_ITEMS + their aliases. We
  // match against ticket_items.name (string) since OBJECT_ID isn't
  // populated on every line item type (modifiers, fees, etc.).
  const pastryNames = new Set<string>();
  for (const item of BAKE_HAUS_ITEMS) {
    pastryNames.add(item.name);
    for (const a of item.aliases ?? []) pastryNames.add(a);
  }
  const pastryNamesList = Array.from(pastryNames);
  if (pastryNamesList.length === 0) {
    res.json({ ok: true, days, location: locationLabel, pastries: [] });
    return;
  }

  // Step 1: find every ticket_id that contains at least one pastry-name
  // line item in the date window. Bind the IN list dynamically since
  // sqlite needs explicit placeholders. We'll need this twice — once
  // to count "tickets per pastry" and once to find co-items.
  const placeholders = pastryNamesList.map(() => '?').join(',');
  const dateClause = 'AND t.date_created_ms >= ?';
  const locClause = locationId ? 'AND t.location_id = ?' : '';
  const baseParams = [...pastryNamesList, fromMs, ...(locationId ? [locationId] : [])];

  // Tickets per pastry (denominator for the % calc): how many tickets
  // included this pastry name?
  const perPastryRows = db.prepare(`
    SELECT ti.name AS pastryName, COUNT(DISTINCT ti.ticket_id) AS ticketCount
      FROM ticket_items ti
      JOIN tickets t ON t.id = ti.ticket_id
     WHERE ti.name IN (${placeholders})
       ${dateClause}
       ${locClause}
     GROUP BY ti.name
     ORDER BY ticketCount DESC
  `).all(...baseParams) as Array<{ pastryName: string; ticketCount: number }>;

  // Co-occurrence: for each pastry name, every other line item on the
  // same ticket — count occurrences, group by (pastry, paired_item).
  // The self-join `ti_co.ticket_id = ti.ticket_id AND ti_co.name != ti.name`
  // is the co-occurrence pivot. detail_status='full' filters out
  // tickets whose items we haven't fetched yet.
  const pairingRows = db.prepare(`
    SELECT ti.name AS pasteName,
           ti_co.name AS pairedName,
           COUNT(DISTINCT ti.ticket_id) AS coTickets
      FROM ticket_items ti
      JOIN tickets t ON t.id = ti.ticket_id
      JOIN ticket_items ti_co ON ti_co.ticket_id = ti.ticket_id
                              AND ti_co.name != ti.name
     WHERE ti.name IN (${placeholders})
       AND t.detail_status = 'full'
       ${dateClause}
       ${locClause}
     GROUP BY ti.name, ti_co.name
     ORDER BY ti.name, coTickets DESC
  `).all(...baseParams) as PairingRow[];

  // Map pastryName → array of {pairedName, count, pct}. Pct = coTickets / pastryTotalTickets.
  const totalByPastry: Record<string, number> = {};
  for (const r of perPastryRows) totalByPastry[r.pastryName] = r.ticketCount;

  const byPastry = new Map<string, Array<{ name: string; coTickets: number; pct: number }>>();
  for (const r of pairingRows) {
    const denom = totalByPastry[r.pasteName] || 0;
    if (denom === 0) continue;
    const arr = byPastry.get(r.pasteName) ?? [];
    arr.push({ name: r.pairedName, coTickets: r.coTickets, pct: r.coTickets / denom });
    byPastry.set(r.pasteName, arr);
  }

  // Final shape: one entry per pastry catalog name, with all pair rows
  // sorted by count desc. Aliases collapse into their canonical name
  // (since BAKE_HAUS_ITEMS has both forms, we'd otherwise show "MBS
  // Scone" and "Maple Brown Sugar Scone" as separate rows).
  const aliasToCanon = new Map<string, string>();
  for (const item of BAKE_HAUS_ITEMS) {
    aliasToCanon.set(item.name, item.name);
    for (const a of item.aliases ?? []) aliasToCanon.set(a, item.name);
  }
  const collapsed = new Map<string, { totalTickets: number; pairings: Map<string, number> }>();
  for (const row of perPastryRows) {
    const canon = aliasToCanon.get(row.pastryName) ?? row.pastryName;
    const e = collapsed.get(canon) ?? { totalTickets: 0, pairings: new Map() };
    e.totalTickets += row.ticketCount;
    collapsed.set(canon, e);
  }
  for (const row of pairingRows) {
    const canon = aliasToCanon.get(row.pasteName) ?? row.pasteName;
    const e = collapsed.get(canon) ?? { totalTickets: 0, pairings: new Map() };
    e.pairings.set(row.pairedName, (e.pairings.get(row.pairedName) ?? 0) + row.coTickets);
    collapsed.set(canon, e);
  }

  const pastries = Array.from(collapsed.entries())
    .map(([pastry, e]) => ({
      pastry,
      totalTickets: e.totalTickets,
      topPairings: Array.from(e.pairings.entries())
        .map(([name, coTickets]) => ({
          name,
          coTickets,
          pct: e.totalTickets > 0 ? coTickets / e.totalTickets : 0,
        }))
        .sort((a, b) => b.coTickets - a.coTickets)
        .slice(0, 25),
    }))
    .sort((a, b) => b.totalTickets - a.totalTickets);

  res.json({
    ok: true,
    days,
    location: locationLabel,
    fromMs,
    toMs: Date.now(),
    pastryCount: pastries.length,
    pastries,
  });
});

export default router;
