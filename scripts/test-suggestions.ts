/**
 * Tests for order suggestions + the Sunday auto-draft.
 * Run: DB_PATH=/tmp/suggest-test.db npx tsx scripts/test-suggestions.ts
 *
 * NOTE: no Dripos token locally, so sales-based (food) suggestions are
 * empty here — those paths are covered by the pure-math checks; the
 * auto-draft integration runs on syrup order-history suggestions.
 */
import {
  suggestFromSales, suggestFromOrders, computeSuggestionsForWeek,
  autoDraftWeek, createSyrup, upsertOrderItem, markOrderSaved, getWeekReport,
} from '../server/bake-haus.js';
import db from '../server/db.js';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    failures++;
  }
}

const LABELS = ['Jul 6', 'Jul 13', 'Jul 20'];

// ── suggestFromSales (food) ─────────────────────────────────────────
// (62+55+70 + best week 70) / 4 = 64.25 → ×1.1 = 70.675 → ceil 71.
check('sales: [62,55,70] → 71', suggestFromSales([62, 55, 70], LABELS)?.qty, 71);
// Best-week weighting cushions a stockout week:
// (40+0+38 + 40) / 4 = 29.5 → ×1.1 = 32.45 → 33 (plain avg would say 26).
check('sales: stockout week cushioned → 33', suggestFromSales([40, 0, 38], LABELS)?.qty, 33);
check('sales: all-zero → null', suggestFromSales([0, 0, 0], LABELS), null);
check('sales: detail mentions weighting', suggestFromSales([10, 10, 10], LABELS)!.detail.some((l) => l.includes('best week')), true);
check('sales: basis tag', suggestFromSales([5, 5, 5], LABELS)?.basis, 'sales');

// ── suggestFromOrders (syrups) ──────────────────────────────────────
check('orders: [12,10,14] → 12', suggestFromOrders([12, 10, 14], LABELS)?.qty, 12);
check('orders: missing weeks skipped, [null,7,null] → 7', suggestFromOrders([null, 7, null], LABELS)?.qty, 7);
check('orders: no history → null', suggestFromOrders([null, null, null], LABELS), null);
check('orders: basis tag', suggestFromOrders([3, 3, 3], LABELS)?.basis, 'orders');

// ── auto-draft integration (order-history basis) ────────────────────
async function main() {
  const syrup = createSyrup({
    displayName: 'Test Draft Syrup',
    driposProductId: 7001,
    driposProductName: 'Bottle - Test Draft Syrup',
  });
  check('fixture syrup created', syrup.category, 'syrup-sauce');

  const WEEK = '2099-03-29';
  const PRIOR = ['2099-03-22', '2099-03-15', '2099-03-08'];
  for (const [i, w] of PRIOR.entries()) {
    // G1 history: 12, 10, 14 → suggestion 12.
    upsertOrderItem({ weekStartIso: w, storeLabel: 'G1', itemName: syrup.displayName, weeklyQty: [12, 10, 14][i] });
    // G2 + G3 history too (same numbers).
    upsertOrderItem({ weekStartIso: w, storeLabel: 'G2', itemName: syrup.displayName, weeklyQty: [12, 10, 14][i] });
    upsertOrderItem({ weekStartIso: w, storeLabel: 'G3', itemName: syrup.displayName, weeklyQty: [12, 10, 14][i] });
  }
  // G2 already saved its target-week order → auto-draft must skip it.
  await markOrderSaved(WEEK, 'G2', 'Tester');
  // G3 already typed a qty for the item → must NOT be overwritten.
  upsertOrderItem({ weekStartIso: WEEK, storeLabel: 'G3', itemName: syrup.displayName, weeklyQty: 99 });

  const sug = await computeSuggestionsForWeek(WEEK);
  check('suggestion computed for G1 syrup', sug['G1']?.[syrup.displayName]?.qty, 12);

  const result = await autoDraftWeek(WEEK);
  const draftedStores = result.drafted.map((d) => d.store).sort();
  check('drafted G1 only (G2 saved, G3 row exists, G4 no history)', draftedStores, ['G1']);

  const rowQty = (store: string) => (db.prepare(
    'SELECT weekly_qty FROM bake_haus_orders WHERE week_start_iso = ? AND store_label = ? AND item_name = ?',
  ).get(WEEK, store, syrup.displayName) as { weekly_qty: number } | undefined)?.weekly_qty ?? null;

  check('G1 drafted at suggested qty', rowQty('G1'), 12);
  check('G2 untouched (saved)', rowQty('G2'), null);
  check('G3 existing qty preserved', rowQty('G3'), 99);

  const report = await getWeekReport(WEEK);
  check('report flags G1 as auto-drafted', report.autoDraftByStore['G1'] != null, true);
  check('report: G3 not flagged', report.autoDraftByStore['G3'], null);

  // Idempotent: second run drafts nothing new.
  const again = await autoDraftWeek(WEEK);
  check('second run is a no-op', again.drafted, []);

  console.log('');
  if (failures > 0) { console.error(`✗ ${failures} test(s) failed`); process.exit(1); }
  console.log('✓ all suggestion tests passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
