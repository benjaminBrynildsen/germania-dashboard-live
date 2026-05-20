/**
 * Germania holiday calendar — the 26 observed dates Ben + the manager
 * trio vote on each year. List + names are pulled verbatim from the
 * existing voting spreadsheet (verified 2026-05-20) so the dashboard
 * page lines up with what they're already tracking.
 *
 * Three kinds of rules:
 *   - fixed  → same month/day every year (e.g. Christmas Dec 25)
 *   - nthWeekday → "3rd Monday of January" style; covers federal holidays
 *                  + Mother's/Father's Day. We also support the
 *                  "last weekday of month" case via n=-1.
 *   - easterOffset → days relative to Western Easter Sunday; covers
 *                    Mardi Gras / Ash Wednesday / Good Friday / Easter.
 *   - lunarLookup → Chinese New Year — small hand-maintained map of
 *                   year → MM-DD; comment in the table flags when it
 *                   needs to be extended.
 */
import db from './db.js';

export type HolidayRule =
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'nthWeekday'; month: number; weekday: number; n: number }  // n = 1..5 or -1 for "last"
  | { kind: 'easterOffset'; offset: number }                            // 0 = Easter, -2 = Good Friday, etc.
  | { kind: 'lunarLookup'; table: Record<number, [number, number]> };  // year → [month, day]

export interface HolidayDef {
  name: string;
  rule: HolidayRule;
}

// Chinese New Year dates 2024–2030. Re-extend this table around 2029.
const CHINESE_NEW_YEAR: Record<number, [number, number]> = {
  2024: [2, 10],
  2025: [1, 29],
  2026: [2, 17],
  2027: [2, 6],
  2028: [1, 26],
  2029: [2, 13],
  2030: [2, 3],
};

// JS weekday convention: 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
const SUN = 0;
const MON = 1;
const THU = 4;

/**
 * The full Germania-observed holiday list. Order here matches the
 * spreadsheet so debugging diffs stays sane; the actual page sort is
 * by date.
 */
export const GERMANIA_HOLIDAYS: HolidayDef[] = [
  { name: "New Year's Day",       rule: { kind: 'fixed', month: 1, day: 1 } },
  { name: 'Martin Luther King Jr. Day', rule: { kind: 'nthWeekday', month: 1, weekday: MON, n: 3 } },
  { name: 'Groundhog Day',        rule: { kind: 'fixed', month: 2, day: 2 } },
  { name: 'Chinese New Year',     rule: { kind: 'lunarLookup', table: CHINESE_NEW_YEAR } },
  { name: 'Mardi Gras',           rule: { kind: 'easterOffset', offset: -47 } },
  { name: "Valentine's Day",      rule: { kind: 'fixed', month: 2, day: 14 } },
  { name: 'Ash Wednesday',        rule: { kind: 'easterOffset', offset: -46 } },
  { name: "Washington's Birthday / Presidents Day", rule: { kind: 'nthWeekday', month: 2, weekday: MON, n: 3 } },
  { name: "St. Patrick's Day",    rule: { kind: 'fixed', month: 3, day: 17 } },
  { name: 'Good Friday',          rule: { kind: 'easterOffset', offset: -2 } },
  { name: 'Easter Sunday',        rule: { kind: 'easterOffset', offset: 0 } },
  { name: 'Cinco de Mayo',        rule: { kind: 'fixed', month: 5, day: 5 } },
  { name: "Mother's Day",         rule: { kind: 'nthWeekday', month: 5, weekday: SUN, n: 2 } },
  { name: 'Memorial Day',         rule: { kind: 'nthWeekday', month: 5, weekday: MON, n: -1 } },
  { name: 'Flag Day',             rule: { kind: 'fixed', month: 6, day: 14 } },
  { name: "Father's Day",         rule: { kind: 'nthWeekday', month: 6, weekday: SUN, n: 3 } },
  { name: 'Juneteenth',           rule: { kind: 'fixed', month: 6, day: 19 } },
  { name: 'Independence Day',     rule: { kind: 'fixed', month: 7, day: 4 } },
  { name: 'Labor Day',            rule: { kind: 'nthWeekday', month: 9, weekday: MON, n: 1 } },
  { name: 'Columbus Day / Indigenous Peoples Day', rule: { kind: 'nthWeekday', month: 10, weekday: MON, n: 2 } },
  { name: 'Halloween',            rule: { kind: 'fixed', month: 10, day: 31 } },
  { name: 'Veterans Day',         rule: { kind: 'fixed', month: 11, day: 11 } },
  { name: 'Thanksgiving',         rule: { kind: 'nthWeekday', month: 11, weekday: THU, n: 4 } },
  { name: 'Christmas Eve',        rule: { kind: 'fixed', month: 12, day: 24 } },
  { name: 'Christmas Day',        rule: { kind: 'fixed', month: 12, day: 25 } },
  { name: "New Year's Eve",       rule: { kind: 'fixed', month: 12, day: 31 } },
];

// ── Date helpers ────────────────────────────────────────────────────

function toIso(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

/** Nth weekday of a given month. n=1..5 picks the Nth, n=-1 picks the LAST. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string | null {
  // First day of the month — find the first occurrence of `weekday`.
  const first = new Date(year, month - 1, 1);
  const firstWeekdayOffset = (weekday - first.getDay() + 7) % 7;
  const firstOccurrenceDay = 1 + firstWeekdayOffset;
  if (n === -1) {
    // Walk forward in 7-day strides until we'd land in next month, then
    // back off one stride. Robust across all months without thinking
    // about how many days they have.
    let day = firstOccurrenceDay;
    while (true) {
      const probe = new Date(year, month - 1, day + 7);
      if (probe.getMonth() !== month - 1) break;
      day += 7;
    }
    return toIso(year, month, day);
  }
  const day = firstOccurrenceDay + (n - 1) * 7;
  // If n=5 was requested but the 5th doesn't exist this month, return null.
  const probe = new Date(year, month - 1, day);
  if (probe.getMonth() !== month - 1) return null;
  return toIso(year, month, day);
}

/**
 * Western (Gregorian) Easter Sunday — Anonymous Gregorian algorithm
 * (Meeus / Jones / Butcher). Returns a Date at midnight local time.
 */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDaysToDate(d: Date, days: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

function dateToIso(d: Date): string {
  return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Resolve a single rule to a concrete YYYY-MM-DD for one year. */
export function resolveRuleForYear(rule: HolidayRule, year: number): string | null {
  switch (rule.kind) {
    case 'fixed':
      return toIso(year, rule.month, rule.day);
    case 'nthWeekday':
      return nthWeekdayOfMonth(year, rule.month, rule.weekday, rule.n);
    case 'easterOffset': {
      const easter = easterSunday(year);
      return dateToIso(addDaysToDate(easter, rule.offset));
    }
    case 'lunarLookup': {
      const entry = rule.table[year];
      if (!entry) return null; // year outside the hand-maintained range
      return toIso(year, entry[0], entry[1]);
    }
  }
}

/** All Germania-observed holidays for one year, in calendar order. */
export function resolveHolidaysForYear(year: number): Array<{ date: string; name: string }> {
  const out: Array<{ date: string; name: string }> = [];
  for (const h of GERMANIA_HOLIDAYS) {
    const date = resolveRuleForYear(h.rule, year);
    if (date) out.push({ date, name: h.name });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * INSERT OR IGNORE every Germania holiday for the given year. Returns
 * `inserted` + `skipped` counts. The unique (date, name) index makes
 * this safe to call on every boot; managers' edits (status, hours,
 * notes) survive because INSERT OR IGNORE doesn't touch existing rows.
 */
export function seedHolidaysForYear(year: number): { inserted: number; skipped: number } {
  const entries = resolveHolidaysForYear(year);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO holidays (date, name, status, created_at, updated_at)
     VALUES (?, ?, 'normal', ?, ?)`,
  );
  let inserted = 0;
  let skipped = 0;
  const now = Date.now();
  const txn = db.transaction(() => {
    for (const e of entries) {
      const result = insert.run(e.date, e.name, now, now);
      if (result.changes > 0) inserted++;
      else skipped++;
    }
  });
  txn();
  return { inserted, skipped };
}
