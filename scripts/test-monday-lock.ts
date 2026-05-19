/**
 * Smoke test for the Monday-lock split logic + inventory subtraction.
 * Run: npx tsx scripts/test-monday-lock.ts
 *
 * Verifies:
 *   1. Unlocked split still produces the 2/7-2/7-3/7 distribution.
 *   2. Locked split keeps Mon at the snapshot value, redistributes
 *      remaining to Wed:Fri at 2:3.
 *   3. Inventory subtraction (netQty = max(0, weeklyQty - onHand))
 *      is applied BEFORE the split — so on-hand reduces the split
 *      total, never the locked Mon value alone.
 *   4. Increasing weekly qty after lock only grows Wed + Fri.
 *   5. Reducing weekly qty below the locked Mon caps Mon at the
 *      new total (doesn't go negative on Wed/Fri).
 */
import { splitForDeliveries } from '../server/bake-haus.js';

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

// 1. Unlocked baseline — sanity that we didn't break the existing math.
check(
  'unlocked weeklyQty=21 → 6/6/9',
  splitForDeliveries(21),
  { mon: 6, wed: 6, fri: 9 },
);
check(
  'unlocked weeklyQty=14 → 4/4/6',
  splitForDeliveries(14),
  { mon: 4, wed: 4, fri: 6 },
);
check(
  'unlocked weeklyQty=0 → 0/0/0',
  splitForDeliveries(0),
  { mon: 0, wed: 0, fri: 0 },
);
check(
  'unlocked weeklyQty=7 → 2/2/3',
  splitForDeliveries(7),
  { mon: 2, wed: 2, fri: 3 },
);

// 2. Locked — Mon is frozen, Wed:Fri get the rest at 2:3.
check(
  'locked mon=6, weeklyQty=21 → 6 + 6/9 (wed:fri 2:3 of remaining 15)',
  splitForDeliveries(21, 6),
  { mon: 6, wed: 6, fri: 9 },
);
check(
  'locked mon=6, weeklyQty=26 → 6 + 8/12 (wed:fri 2:3 of remaining 20)',
  splitForDeliveries(26, 6),
  { mon: 6, wed: 8, fri: 12 },
);

// 3. Inventory subtraction happens upstream (in getWeekReport); the
//    split takes the already-netted qty. Simulate that here.
const onHand = 4;
const weeklyQty = 21;
const netQty = Math.max(0, weeklyQty - onHand);
check(
  'inventory: onHand=4 reduces 21→17 before split (unlocked)',
  splitForDeliveries(netQty),
  { mon: 5, wed: 5, fri: 7 },
);
check(
  'inventory + lock: onHand=4, lockedMon=6 (was 6 before inv subtraction) → 6 + (17-6=11 → 4/7)',
  splitForDeliveries(netQty, 6),
  { mon: 6, wed: 4, fri: 7 },
);

// 4. Bump qty post-lock — Mon should stay at 6, Wed/Fri absorb +10.
const original = splitForDeliveries(21, 6); // 6/6/9
const bumped = splitForDeliveries(31, 6);   // expected 6/10/15 (Wed:Fri 2:3 of 25)
check(
  'post-lock bump 21→31 keeps Mon=6, Wed+Fri grow',
  bumped,
  { mon: 6, wed: 10, fri: 15 },
);
check(
  'post-lock bump: Mon unchanged from original',
  bumped.mon,
  original.mon,
);

// 5. Reduce qty below locked Mon — Mon caps at total, Wed/Fri are 0.
check(
  'locked mon=20, weeklyQty=5 → mon caps at 5, wed/fri=0',
  splitForDeliveries(5, 20),
  { mon: 5, wed: 0, fri: 0 },
);

// 6. Locked mon=0 (row added post-lock) → all qty flows to Wed/Fri.
check(
  'locked mon=0, weeklyQty=10 → 0 + 4/6 (Wed:Fri 2:3)',
  splitForDeliveries(10, 0),
  { mon: 0, wed: 4, fri: 6 },
);

// 7. monLockedQty=null behaves identically to unlocked.
check(
  'null lock is identical to undefined',
  splitForDeliveries(21, null),
  splitForDeliveries(21),
);

// 8. includeMonday=false (syrup behavior) — Mon always 0, Wed/Fri at 2:3.
check(
  'syrup split: qty=15, includeMonday=false → 0/6/9',
  splitForDeliveries(15, null, false),
  { mon: 0, wed: 6, fri: 9 },
);
check(
  'syrup split: qty=10, includeMonday=false → 0/4/6',
  splitForDeliveries(10, null, false),
  { mon: 0, wed: 4, fri: 6 },
);
check(
  'syrup split: lock arg ignored when includeMonday=false',
  splitForDeliveries(20, 5, false),
  { mon: 0, wed: 8, fri: 12 },
);
check(
  'syrup split: qty=0 still 0/0/0',
  splitForDeliveries(0, null, false),
  { mon: 0, wed: 0, fri: 0 },
);

// 9. includeMonday=true (default for food + Haus Vanilla) unchanged.
check(
  'food split with includeMonday=true matches old behavior',
  splitForDeliveries(21, null, true),
  splitForDeliveries(21),
);

console.log('');
if (failures > 0) {
  console.error(`✗ ${failures} test(s) failed`);
  process.exit(1);
}
console.log('✓ all monday-lock split tests passed');
