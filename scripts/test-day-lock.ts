/**
 * Integration smoke test for per-day delivery locks.
 * Run: DB_PATH=/tmp/daylock-test.db npx tsx scripts/test-day-lock.ts
 *
 * Uses a throwaway DB (set DB_PATH to a temp file). Seeds a fake week,
 * locks Monday, and verifies:
 *   1. Monday reads as locked; Wed/Fri stay live.
 *   2. Editing weekly_qty redistributes to Wed/Fri only — Mon frozen.
 *   3. getItemLockInfo / lockedFloorForRow report Monday's frozen qty.
 *   4. Locking Wed on top keeps both frozen; report shows both.
 *   5. unlockDay('mon') reopens Monday.
 *   6. A whole-week lock supersedes per-day; unlockWeek clears everything.
 */
import {
  upsertOrderItem, getWeekReport, lockDay, unlockDay, getDayLockState,
  isDayLocked, getItemLockInfo, lockedFloorForRow, lockWeek, unlockWeek,
} from '../server/bake-haus.js';

const WEEK = '2099-01-05'; // a Monday far in the future — no real data
const STORE = 'G1';
const ITEM = 'Bacon, Egg & Cheese'; // includeMonday=true food item

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

function rowFor(report: Awaited<ReturnType<typeof getWeekReport>>) {
  return report.byStore[STORE].find((r) => r.itemName === ITEM)!;
}

async function main() {
  // NOTE: locally there's no Dripos token, so onHand=0 → the split uses
  // the out-of-stock "prioritize earliest" path. Exact numbers therefore
  // differ from the in-stock case, so this test asserts INVARIANTS (a
  // locked day never moves; unlocked days absorb edits) rather than
  // hardcoded splits — which makes it inventory-independent.
  upsertOrderItem({ weekStartIso: WEEK, storeLabel: STORE, itemName: ITEM, weeklyQty: 21 });

  let report = await getWeekReport(WEEK);
  const seedSplit = rowFor(report).delivery;
  check('split sums to weekly_qty (21)', seedSplit.mon + seedSplit.wed + seedSplit.fri, 21);
  check('no locks initially', report.dayLocks, { mon: null, wed: null, fri: null });

  // 1. Lock Monday (live). Capture the frozen Mon value.
  await lockDay(WEEK, 'mon', 'Tester', 'manual', null);
  const FROZEN_MON = rowFor(await getWeekReport(WEEK)).delivery.mon;
  check('isDayLocked mon', isDayLocked(WEEK, 'mon'), true);
  check('isDayLocked wed', isDayLocked(WEEK, 'wed'), false);
  report = await getWeekReport(WEEK);
  check('mon dayLock present after lock', report.dayLocks.mon !== null, true);
  check('wed/fri still live', [report.dayLocks.wed, report.dayLocks.fri], [null, null]);
  check('weekLocked false (per-day only)', report.weekLocked, false);
  check('Mon unchanged right after lock', rowFor(report).delivery.mon, FROZEN_MON);

  // 1b. DRIFT REGRESSION (the G3 / East Alton bug): once Monday is
  // locked, its delivery must stay at the snapshot even if netQty later
  // drops BELOW the frozen value. Live inventory rising does this in
  // prod; here we reproduce it by dropping weekly_qty under FROZEN_MON.
  // The old code clamped the locked day down to netQty → numbers drifted
  // and the lock looked like it "didn't take" for that store.
  upsertOrderItem({ weekStartIso: WEEK, storeLabel: STORE, itemName: ITEM, weeklyQty: Math.max(1, FROZEN_MON - 5) });
  check('locked Mon holds snapshot even when netQty < snapshot',
    rowFor(await getWeekReport(WEEK)).delivery.mon, FROZEN_MON);
  // Restore the baseline so the later steps behave as written.
  upsertOrderItem({ weekStartIso: WEEK, storeLabel: STORE, itemName: ITEM, weeklyQty: 21 });

  // 2. Bump weekly_qty 21 → 31. Mon stays frozen; Wed+Fri absorb the +10.
  upsertOrderItem({ weekStartIso: WEEK, storeLabel: STORE, itemName: ITEM, weeklyQty: 31 });
  report = await getWeekReport(WEEK);
  const afterBump = rowFor(report).delivery;
  check('post-lock bump keeps Mon frozen', afterBump.mon, FROZEN_MON);
  check('post-lock bump: Wed+Fri grew to cover remainder', afterBump.wed + afterBump.fri, 31 - FROZEN_MON);

  // 3. Lock info + floor.
  check('getItemLockInfo: only mon locked, not fully',
    getItemLockInfo(WEEK, ITEM), { activeDays: ['mon', 'wed', 'fri'], lockedDays: ['mon'], fullyLocked: false });
  check('lockedFloorForRow = frozen Mon qty', lockedFloorForRow(WEEK, STORE, ITEM), FROZEN_MON);

  // 4. Lock Wednesday too at its current value.
  const FROZEN_WED = afterBump.wed;
  await lockDay(WEEK, 'wed', 'Tester', 'manual', null);
  report = await getWeekReport(WEEK);
  check('mon+wed locked, fri live',
    [report.dayLocks.mon !== null, report.dayLocks.wed !== null, report.dayLocks.fri],
    [true, true, null]);
  const afterWedLock = rowFor(report).delivery;
  check('Mon+Wed both frozen after wed lock', [afterWedLock.mon, afterWedLock.wed], [FROZEN_MON, FROZEN_WED]);
  check('floor now mon+wed', lockedFloorForRow(WEEK, STORE, ITEM), FROZEN_MON + FROZEN_WED);
  // Bump 31 → 41: only Fri grows (mon+wed pinned).
  upsertOrderItem({ weekStartIso: WEEK, storeLabel: STORE, itemName: ITEM, weeklyQty: 41 });
  report = await getWeekReport(WEEK);
  const afterBump2 = rowFor(report).delivery;
  check('bump 31→41 with mon+wed locked: mon+wed unchanged',
    [afterBump2.mon, afterBump2.wed], [FROZEN_MON, FROZEN_WED]);
  check('bump 31→41: Fri absorbs all remainder', afterBump2.fri, 41 - FROZEN_MON - FROZEN_WED);

  // 5. Unlock Monday — reopens; Wed stays locked.
  unlockDay(WEEK, 'mon');
  check('mon unlocked', isDayLocked(WEEK, 'mon'), false);
  check('wed still locked', isDayLocked(WEEK, 'wed'), true);

  // 6. Whole-week lock supersedes; then full unlock clears all.
  await lockWeek(WEEK, 'Tester', 'manual', null);
  check('week lock → all days locked', getItemLockInfo(WEEK, ITEM).fullyLocked, true);
  unlockWeek(WEEK);
  check('unlockWeek clears every day', getDayLockState(WEEK), { mon: null, wed: null, fri: null });
  report = await getWeekReport(WEEK);
  const finalSplit = rowFor(report).delivery;
  check('after full unlock, split recomputes live & sums to 41',
    finalSplit.mon + finalSplit.wed + finalSplit.fri, 41);

  // Cleanup handled by throwaway DB file.
  console.log('');
  if (failures > 0) { console.error(`✗ ${failures} test(s) failed`); process.exit(1); }
  console.log('✓ all per-day lock tests passed');
}

main().catch((err) => { console.error(err); process.exit(1); });
