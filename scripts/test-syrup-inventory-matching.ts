/**
 * Unit test for cross-store syrup/sauce inventory matching.
 * Run: DB_PATH=/tmp/syrup-match-test.db npx tsx scripts/test-syrup-inventory-matching.ts
 *
 * Regression: syrup catalog rows store a Dripos product ID captured from
 * G1's product list, but Dripos IDs are per-location — so the ID-only
 * lookup meant only G1 ever subtracted syrup/sauce inventory. These
 * tests cover the name-fallback path that makes G2-G4 resolve their own
 * product rows (and their own sales, for as-of-last-night lock
 * reconstruction).
 */
import { findProductForSyrup, netQtyForRow, syrupUnitsFromSales } from '../server/bake-haus.js';

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

const SYRUP = {
  driposProductId: 5001, // a G1 product ID
  driposProductName: 'Bottle - Vanilla Syrup',
  displayName: 'Vanilla Syrup',
};

// ── findProductForSyrup ─────────────────────────────────────────────

// G1: the stored ID matches directly.
const g1 = [
  { ID: 5001, NAME: 'Bottle - Vanilla Syrup', INVENTORY: 7 },
  { ID: 5002, NAME: 'Bottle - Caramel Sauce', INVENTORY: 3 },
];
check('G1: exact ID match wins', findProductForSyrup(SYRUP, g1)?.INVENTORY, 7);

// G2: same product, different per-location ID → name fallback.
const g2 = [
  { ID: 6101, NAME: 'Bottle - Vanilla Syrup', INVENTORY: 4 },
  { ID: 6102, NAME: 'Bottle - Caramel Sauce', INVENTORY: 9 },
];
check('G2: name fallback finds the local row', findProductForSyrup(SYRUP, g2)?.ID, 6101);

// Name match is normalized: "&" vs "and", punctuation, case.
const g3 = [{ ID: 7301, NAME: 'BOTTLE — Vanilla  Syrup', INVENTORY: 2 }];
check('G3: normalized name match (punctuation/case)', findProductForSyrup(SYRUP, g3)?.ID, 7301);

// Display-name fallback when the Dripos name drifted.
const renamed = [{ ID: 8401, NAME: 'Vanilla Syrup', INVENTORY: 5 }];
check('display-name fallback', findProductForSyrup(SYRUP, renamed)?.ID, 8401);

// Duplicate rows for the same name → prefer the one with numeric inventory.
const dupes = [
  { ID: 9001, NAME: 'Bottle - Vanilla Syrup', INVENTORY: null },
  { ID: 9002, NAME: 'Bottle - Vanilla Syrup', INVENTORY: 6 },
];
check('duplicate rows: numeric inventory preferred', findProductForSyrup(SYRUP, dupes)?.ID, 9002);

// ID matches a row with null inventory but a name-duplicate carries a
// real count → the numeric row wins.
const idNullDupe = [
  { ID: 5001, NAME: 'Bottle - Vanilla Syrup', INVENTORY: null },
  { ID: 5009, NAME: 'Bottle - Vanilla Syrup', INVENTORY: 11 },
];
check('ID hit with null inventory defers to numeric name-dupe', findProductForSyrup(SYRUP, idNullDupe)?.ID, 5009);

// No ID and no name match anywhere → null (item reads 0 on hand).
const unrelated = [{ ID: 1, NAME: 'Croffle - Buffalo Chicken', INVENTORY: 12 }];
check('no match → null', findProductForSyrup(SYRUP, unrelated), null);

// ── syrupUnitsFromSales ─────────────────────────────────────────────

// G1: PRODUCT_ID path.
check(
  'sales: ID match wins',
  syrupUnitsFromSales(SYRUP, new Map([[5001, 8]]), new Map([['Bottle - Vanilla Syrup', 99]])),
  8,
);

// G2: ID misses (different per-location ID) → line-item-name fallback.
check(
  'sales: line-name fallback when ID misses',
  syrupUnitsFromSales(SYRUP, new Map([[6101, 8]]), new Map([['Bottle - Vanilla Syrup', 8]])),
  8,
);

// Fallback aggregates across name variants that normalize together.
check(
  'sales: fallback sums normalized name variants',
  syrupUnitsFromSales(SYRUP, new Map(), new Map([['Bottle - Vanilla Syrup', 3], ['BOTTLE - VANILLA SYRUP!', 2]])),
  5,
);

// Nothing sold → 0.
check('sales: no match → 0', syrupUnitsFromSales(SYRUP, new Map(), new Map()), 0);

// ── netQtyForRow ────────────────────────────────────────────────────
// Syrups/sauces deliver the ordered qty as-is; on-hand only deducts
// for food (and ad-hoc custom items).

check('net: food deducts on-hand', netQtyForRow('food', 21, 4), 17);
check('net: food never goes negative', netQtyForRow('food', 3, 10), 0);
check('net: custom deducts on-hand', netQtyForRow('custom', 10, 2), 8);
check('net: syrup ignores on-hand', netQtyForRow('syrup-sauce', 15, 6), 15);
check('net: syrup with zero on-hand unchanged', netQtyForRow('syrup-sauce', 5, 0), 5);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
