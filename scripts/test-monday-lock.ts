/**
 * Smoke test for the delivery split logic + inventory subtraction.
 * Run: npx tsx scripts/test-monday-lock.ts
 *
 * Allocation under test (July 2026, per Joe + Chef Maggie):
 *   Food + Haus Vanilla:  Mon 25% / Wed 30% / Fri 45%
 *   Wed/Fri-only syrups:  Wed 30% / Fri 70%
 *
 * Verifies:
 *   1. Unlocked split produces the 25/30/45 (or 30/70) distribution,
 *      with rounding leftovers/ties resolved toward the later day.
 *   2. Locked split keeps Mon at the snapshot value, redistributes
 *      remaining to Wed:Fri at their 30:45 ratio.
 *   3. Inventory subtraction (netQty) applies BEFORE the split — so
 *      on-hand reduces the split total, never the locked Mon alone.
 *   4. Increasing weekly qty after lock only grows Wed + Fri.
 *   5. Reducing weekly qty below the locked Mon caps Mon at the
 *      new total (doesn't go negative on Wed/Fri).
 *   6. On-hand no longer changes the weighting — the old out-of-stock
 *      "prioritize early" override is gone.
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

// 1. Unlocked baseline — 25/30/45 with largest-remainder rounding.
check(
  'unlocked weeklyQty=100 → exactly 25/30/45',
  splitForDeliveries(100),
  { mon: 25, wed: 30, fri: 45 },
);
check(
  'unlocked weeklyQty=20 → 5/6/9 (exact)',
  splitForDeliveries(20),
  { mon: 5, wed: 6, fri: 9 },
);
check(
  'unlocked weeklyQty=21 → 5/6/10 (leftover to Fri, biggest remainder)',
  splitForDeliveries(21),
  { mon: 5, wed: 6, fri: 10 },
);
check(
  'unlocked weeklyQty=14 → 4/4/6 (Mon has biggest remainder)',
  splitForDeliveries(14),
  { mon: 4, wed: 4, fri: 6 },
);
check(
  'unlocked weeklyQty=7 → 2/2/3',
  splitForDeliveries(7),
  { mon: 2, wed: 2, fri: 3 },
);
check(
  'unlocked weeklyQty=0 → 0/0/0',
  splitForDeliveries(0),
  { mon: 0, wed: 0, fri: 0 },
);

// 2. Locked — Mon is frozen, Wed:Fri get the rest at 30:45 (= 2:3).
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
  { mon: 4, wed: 5, fri: 8 },
);
check(
  'inventory + lock: onHand=4, lockedMon=6 → 6 + (17-6=11 → 4/7)',
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

// 8. includeMonday=false (syrup behavior) — Mon always 0, Wed/Fri 30:70.
check(
  'syrup split: qty=10 → 0/3/7 (exact 30/70)',
  splitForDeliveries(10, null, false),
  { mon: 0, wed: 3, fri: 7 },
);
check(
  'syrup split: qty=15 → 0/4/11 (rounding tie goes to Fri)',
  splitForDeliveries(15, null, false),
  { mon: 0, wed: 4, fri: 11 },
);
check(
  'syrup split: qty=5 → 0/1/4 (rounding tie goes to Fri)',
  splitForDeliveries(5, null, false),
  { mon: 0, wed: 1, fri: 4 },
);
check(
  'syrup split: qty=1 → single unit lands on Fri (70%)',
  splitForDeliveries(1, null, false),
  { mon: 0, wed: 0, fri: 1 },
);
check(
  'syrup split: lock arg ignored when includeMonday=false',
  splitForDeliveries(20, 5, false),
  { mon: 0, wed: 6, fri: 14 },
);
check(
  'syrup split: qty=0 still 0/0/0',
  splitForDeliveries(0, null, false),
  { mon: 0, wed: 0, fri: 0 },
);

// 9. includeMonday=true (default for food + Haus Vanilla).
check(
  'food split with includeMonday=true matches the default',
  splitForDeliveries(21, null, true),
  splitForDeliveries(21),
);

// 10. The out-of-stock "prioritize early" override is GONE — the split
//     never front-loads the week regardless of on-hand. (On-hand only
//     nets the total for food, upstream of the split.)
check(
  'no front-loading: food qty=14 stays 4/4/6',
  splitForDeliveries(Math.max(0, 14 - 0), null, true),
  { mon: 4, wed: 4, fri: 6 },
);
check(
  'no front-loading: syrup qty=10 stays 0/3/7',
  splitForDeliveries(10, null, false),
  { mon: 0, wed: 3, fri: 7 },
);

console.log('');
if (failures > 0) {
  console.error(`✗ ${failures} test(s) failed`);
  process.exit(1);
}
console.log('✓ all delivery-split tests passed');
