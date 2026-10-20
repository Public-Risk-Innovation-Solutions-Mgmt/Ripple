// ============================================================================
// DEVELOPMENT PATTERNS — THE SHAPE CHECK, PAID AND INCURRED.
//
//   npx tsx scripts/diagnostics/paid-development-check.ts
//
// src/data/paidDevelopmentPatterns.ts is RECORDED AND NOT WIRED: no engine path
// reads it, so no value baseline would notice if a factor were mistyped. A
// table nothing reads is a table nothing checks, and it will sit there until
// the simplified multiplayer model picks it up — at which point a transposed
// digit becomes a payout curve rather than a typo. This gate is what stands in
// for the engine until then.
//
// WHAT IT ASSERTS, per line, on BOTH bases:
//   1. EVERY LDF IS AT LEAST 1. An age-to-ultimate factor below 1 says more has
//      been paid (or reported) than will ultimately be paid.
//   2. LDFs NEVER RISE WITH AGE. Paid-to-date is 1/LDF and only ever grows, so
//      the factor can only fall. A rise is a row out of order or a figure from
//      the wrong column.
//   3. PCT UNPAID STAYS IN [0, 1]. Implied by (1) and (2) for a well-formed
//      table, asserted separately because it is the quantity a consumer will
//      actually multiply by and the one a reader will sanity-check.
//   4. THE LOOKUP THROWS PAST THE LAST ROW. Not "returns the last factor", not
//      "returns 1" — a longer game must announce the gap rather than silently
//      stop paying. Asserted by calling it and requiring the throw.
//   5. INCURRED IS AT OR BELOW PAID AT EVERY AGE WHERE BOTH EXIST. Reported can
//      never be behind paid: money cannot leave before the claim it pays is on
//      the books. This is the assertion that retired the GL "Total" pattern.
//   6. THE CASE / IBNR SPLIT THROWS WHERE INCURRED DOES NOT REACH. WC paid runs
//      to 444 months and WC incurred stops at 264; past that the split is
//      undefined rather than zero.
//
// ⚠ IT ALSO ASSERTS THE AGE GRID, which is not decoration. The whole table is
// read against "months from the START of the accident year, in steps of 12",
// and the RETIRED GL TABLE recorded in the data file was wrong in exactly this
// way in an earlier form — the right factors against ages a year early. A gate
// that checks the factors but not the ages would have passed it.
//
// ============================================================================
// ⚠ ASSERTION 5 IS CONFIRMED AGAINST THE RETIRED PATTERN, IN THIS FILE, EVERY
// RUN. A positive control rather than a claim: RETIRED_GL_TOTAL_PAID_DEVELOPMENT
// is run through the same comparison the live patterns take, and the gate FAILS
// if it does NOT produce violations. So the rule cannot quietly stop detecting
// the exact defect it was written for — a comparison accidentally made
// tolerant, or reduced to comparing a pattern with itself, turns this red.
//
// It reports eight violating ages, 108 through 192 months. Assertions 1, 2, 3,
// 4 and 5 were each confirmed red against a deliberately broken copy (an LDF
// below 1, a row raised above its predecessor, an age grid shifted by a year,
// the lookup made to default, and GL paid pointed at the retired pattern —
// which produced exactly the eight ages); see the commit message.
//
// ⚠ ASSERTION 6 CHANGED MEANING AT PRICING COMMIT 5(c) AND IS STILL TRUE.
// It used to say that the split throws past WC's 264 months, where the incurred
// pattern stopped while paid ran on to 444; that gap is GONE, because 5(c)
// projected WC's incurred table to 444 so a derived case/IBNR presentation
// would have a factor at every age a game reaches. All three lines' incurred
// patterns now end exactly where their paid patterns do.
//
// What the assertion asserts is unchanged — the split throws exactly where
// incurred stops, and resolves everywhere before it — and it still passes. Only
// the age moved, from 276 to 456 on WC, and the gate reads it from the table
// rather than from a literal, which is why it needed no edit.
//
// It also could not be made to fail alone, which was worth stating when
// reserveSplitAt carried its own "the split is UNDEFINED" guard on top of
// incurredLdfAt's end-of-pattern throw. THAT GUARD IS NOW REMOVED: with no gap
// left to guard it only duplicated the lookup's own range check, and a
// duplicate guard is the kind that goes stale when one table moves. The throw
// this assertion sees is incurredLdfAt's, and it is load-bearing.
// ============================================================================

import {
  PAID_DEVELOPMENT_PATTERN, INCURRED_DEVELOPMENT_PATTERN, RETIRED_GL_TOTAL_PAID_DEVELOPMENT,
  compressPattern, paidLdfAt, incurredLdfAt, pctUnpaid, reserveSplitAt, type DevelopmentRow,
} from '../../src/data/paidDevelopmentPatterns';
import { DEVELOPMENT_SPEED } from '../../src/data/pricingParameters';
import type { CoverageLine } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const AGE_STEP_MONTHS = 12;
const EPS = 1e-12;

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

/** (1), (2), (3) and the age grid, for one pattern on one basis. */
function checkShape(line: CoverageLine, basis: string, rows: readonly DevelopmentRow[]): void {
  if (rows.length === 0) { fail(`${line} ${basis}: the pattern is empty`); return; }

  rows.forEach((row, i) => {
    if (!(row.ldf >= 1)) {
      fail(`${line} ${basis} @ ${row.ageMonths}mo: LDF ${row.ldf} is below 1 — more settled than ultimate`);
    }
    if (i > 0) {
      const prev = rows[i - 1];
      if (row.ldf > prev.ldf + EPS) {
        fail(`${line} ${basis} @ ${row.ageMonths}mo: LDF RISES, ${prev.ldf} (@${prev.ageMonths}) -> ${row.ldf}`);
      }
      if (row.ageMonths - prev.ageMonths !== AGE_STEP_MONTHS) {
        fail(`${line} ${basis} @ ${row.ageMonths}mo: age step is ${row.ageMonths - prev.ageMonths}, `
          + `not ${AGE_STEP_MONTHS} (previous row ${prev.ageMonths})`);
      }
    } else if (row.ageMonths !== AGE_STEP_MONTHS) {
      fail(`${line} ${basis}: first row is at ${row.ageMonths}mo, not ${AGE_STEP_MONTHS} — `
        + 'ages are months from the START of the accident year');
    }
    const unpaid = pctUnpaid(row.ldf);
    if (!(unpaid >= 0 && unpaid <= 1)) {
      fail(`${line} ${basis} @ ${row.ageMonths}mo: 1 - 1/LDF is ${unpaid}, outside [0, 1] (LDF ${row.ldf})`);
    }
  });
}

/** (4), for one pattern on one basis. */
function checkLookupThrows(
  line: CoverageLine, basis: string, rows: readonly DevelopmentRow[],
  lookup: (l: CoverageLine, a: number) => number,
): void {
  const last = rows[rows.length - 1];
  let threw = false;
  try { lookup(line, last.ageMonths + AGE_STEP_MONTHS); } catch { threw = true; }
  if (!threw) {
    fail(`${line} ${basis}: lookup at ${last.ageMonths + AGE_STEP_MONTHS}mo did NOT throw — the pattern `
      + `ends at ${last.ageMonths} and a lookup past it must announce the gap, not default`);
  }
  // and it RESOLVES on every age it does cover — a lookup that threw everywhere
  // would pass the assertion above for the wrong reason.
  for (const row of rows) {
    try {
      const got = lookup(line, row.ageMonths);
      if (got !== row.ldf) fail(`${line} ${basis} @ ${row.ageMonths}mo: lookup returned ${got}, table holds ${row.ldf}`);
    } catch (e) {
      fail(`${line} ${basis} @ ${row.ageMonths}mo: lookup THREW on a covered age — ${(e as Error).message}`);
    }
  }
}

/**
 * (5) INCURRED AT OR BELOW PAID. Returns the violating ages rather than failing
 * directly, so the same function can be run as a POSITIVE CONTROL against the
 * retired pattern, where violations are the expected result.
 */
function incurredAbovePaidAges(
  paid: readonly DevelopmentRow[], incurred: readonly DevelopmentRow[],
): { ageMonths: number; paid: number; incurred: number; excess: number }[] {
  const paidBy = new Map(paid.map(r => [r.ageMonths, r.ldf]));
  const out = [];
  for (const row of incurred) {
    const p = paidBy.get(row.ageMonths);
    if (p === undefined) continue; // no paid row at this age; nothing to compare
    if (row.ldf > p + EPS) {
      out.push({ ageMonths: row.ageMonths, paid: p, incurred: row.ldf, excess: 1 / p - 1 / row.ldf });
    }
  }
  return out;
}

for (const line of LINES) {
  const paid = PAID_DEVELOPMENT_PATTERN[line];
  const incurred = INCURRED_DEVELOPMENT_PATTERN[line];

  checkShape(line, 'paid', paid);
  checkShape(line, 'incurred', incurred);
  checkLookupThrows(line, 'paid', paid, paidLdfAt);
  checkLookupThrows(line, 'incurred', incurred, incurredLdfAt);

  // (5)
  for (const v of incurredAbovePaidAges(paid, incurred)) {
    fail(`${line} @ ${v.ageMonths}mo: INCURRED ${v.incurred} EXCEEDS PAID ${v.paid} — that is `
      + `${(v.excess * 100).toFixed(2)}% of ultimate paid but not reported, which cannot happen`);
  }

  // (6) the split throws exactly where incurred stops, and resolves before it
  const lastIncurred = incurred[incurred.length - 1];
  let splitThrew = false;
  try { reserveSplitAt(line, lastIncurred.ageMonths + AGE_STEP_MONTHS); } catch { splitThrew = true; }
  if (!splitThrew) {
    fail(`${line}: reserveSplitAt(${lastIncurred.ageMonths + AGE_STEP_MONTHS}) did NOT throw — past the `
      + 'incurred pattern the case/IBNR split is undefined, not zero');
  }
  for (const row of incurred) {
    try {
      const s = reserveSplitAt(line, row.ageMonths);
      if (s.caseReserves < -EPS) {
        fail(`${line} @ ${row.ageMonths}mo: case reserves ${s.caseReserves} are negative`);
      }
      if (s.ibnr < -EPS) fail(`${line} @ ${row.ageMonths}mo: IBNR ${s.ibnr} is negative`);
      if (Math.abs(s.caseReserves + s.ibnr - s.totalUnpaid) > 1e-9) {
        fail(`${line} @ ${row.ageMonths}mo: case ${s.caseReserves} + IBNR ${s.ibnr} does not equal `
          + `total unpaid ${s.totalUnpaid}`);
      }
    } catch (e) {
      fail(`${line} @ ${row.ageMonths}mo: reserveSplitAt THREW on a covered age — ${(e as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------- the control
// ⚠ ASSERTION 5 MUST STILL CATCH THE PATTERN IT WAS WRITTEN FOR. If this
// produces no violations, the comparison has gone tolerant and the gate says so
// rather than reporting green on a rule that has stopped working.
// ⚠ COMPRESSED BY GL'S DEVELOPMENT SPEED, as the incurred pattern it is held
// against is: compared on the recorded grid it would meet the incurred pattern
// at the wrong ages. Its eight recorded violations (108-192 months) land on
// the compressed grid at 72-120 months at GL's 1.5.
const control = incurredAbovePaidAges(
  compressPattern(RETIRED_GL_TOTAL_PAID_DEVELOPMENT, DEVELOPMENT_SPEED.GL), INCURRED_DEVELOPMENT_PATTERN.GL,
);
if (control.length === 0) {
  fail('POSITIVE CONTROL FAILED: the retired GL "Total" paid pattern produced NO '
    + 'incurred-above-paid violations. That pattern is incoherent with GL incurred at eight ages — '
    + 'if the comparison no longer sees them it no longer works.');
}

// ---------------------------------------------------------------- report
for (const line of LINES) {
  const paid = PAID_DEVELOPMENT_PATTERN[line];
  const incurred = INCURRED_DEVELOPMENT_PATTERN[line];
  const projected = paid.filter(r => r.projected).length;
  const adjusted = incurred.filter(r => r.adjusted).length;
  console.log(
    `  ${line.padEnd(8)} paid ${String(paid.length).padStart(2)} rows to ${paid[paid.length - 1].ageMonths}mo`
    + `${projected ? ` (${projected} projected)` : ''}`
    + `   incurred ${String(incurred.length).padStart(2)} rows to ${incurred[incurred.length - 1].ageMonths}mo`
    + `${adjusted ? ` (${adjusted} adjusted)` : ''}`,
  );
}
console.log(`\n  positive control: the retired GL "Total" pattern violates incurred<=paid at `
  + `${control.length} ages (${control.map(c => c.ageMonths).join(', ')})`);
console.log();

if (failures.length > 0) {
  console.log(`DEVELOPMENT PATTERN CHECK FAILED — ${failures.length} finding(s):\n`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}

console.log('DEVELOPMENT PATTERNS WELL FORMED — on both bases every LDF >= 1, none rises with age,');
console.log('1 - 1/LDF within [0, 1] throughout, incurred at or below paid at every shared age,');
console.log('and both the LDF lookup and the case/IBNR split throw past their last row.');
