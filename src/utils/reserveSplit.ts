// ============================================================================
// CASE AND IBNR — A PRESENTATION, DERIVED, READ BY NOTHING ECONOMIC.
//
// Claims book at full cost, so the engine treats every claim as reported on the
// day it happens. There is no unreported inventory anywhere in the model and no
// quantity in it moves when this file changes. What a reader still expects to
// see on an actuarial exhibit is a reserve divided into claims on the books and
// development yet to emerge, and that division is what this file derives, from
// the recorded patterns at each accident year's age.
//
// ⚠ IT IS A PRESENTATION AND MUST STAY ONE. Nothing here may be read by
// pricing, surplus, required capital, satisfaction, the tower, or any other
// path that changes a number. reserve-split-check asserts that directly: it
// re-derives the split with the two halves deliberately swapped and requires
// every economic field to come back bit-identical. If this file ever acquires a
// reader that matters, that gate goes red, which is the point of it.
//
// ---------------------------------------------------------------------------
// THE DEFINITION
//
//   case = ultimate x (1 / incurred LDF - 1 / paid LDF)   on the books, unpaid
//   ibnr = ultimate x (1 - 1 / incurred LDF)              yet to emerge
//   sum  = ultimate x (1 - 1 / paid LDF)                  the unpaid reserve
//
// ⚠ AND IT IS APPLIED AS SHARES OF THE BALANCE ACTUALLY HELD, NOT COMPUTED
// FROM ULTIMATE INDEPENDENTLY. Those two are the same number whenever a cohort
// sits exactly on its pattern, and they are NOT the same number otherwise —
// measured, not assumed:
//
//   - Property cohorts CLOSE before their pattern runs out. A played year at 84
//     months held 0.00 unpaid where the pattern still says 1.3% of ultimate is
//     outstanding. Computed from ultimate, that cohort would be presented with
//     $113k of case and IBNR it does not have.
//   - cohorts AGE PAST THE PATTERN. A long game takes an accident year past
//     its table (it was the bulk cohorts, now retired, that did it first: a WC
//     one opened at 444 months reached 456). Read from ultimate, the lookup throws.
//
// So the pattern supplies the RATIO and the cohort supplies the DOLLARS. The
// sum is then the held unpaid by construction rather than by coincidence, which
// is the identity the gate asserts and the only version of it that survives a
// cohort being anywhere other than exactly on its curve.
//
// ---------------------------------------------------------------------------
// GROSS, NET AND CEDED. The same pattern shares are applied to the gross
// balance and to the net one, and ceded is gross minus net. The shares are a
// property of the LINE's development, not of the reinsurance, so applying one
// set of ratios to both bases is what keeps ceded case plus ceded IBNR equal to
// ceded unpaid.
//
// ⚠ (RETIRED WITH THE BULK COHORTS — the pool's history begins in 2021, and
// every cohort now carries its own gross ledger. Kept for the record:) BULK
// COHORTS WERE HELD NET AND SO THEIR CEDED SPLIT WAS ZERO, which was
// correct rather than missing. The set opening (commit 5(b)) holds accident
// years older than PRIOR_HISTORY_YEARS net of the reinsurance their own year
// bought, because the recoveries on those years were collected before the game
// began and are already inside the figure. Their grossUnpaid equals their
// netUnpaid, so gross case equals net case, gross IBNR equals net IBNR, and the
// ceded column reads zero on every one of them. Nothing is being dropped: there
// is no gross basis for those years for the game to show.
// ============================================================================

import {
  INCURRED_DEVELOPMENT_PATTERN, PAID_DEVELOPMENT_PATTERN, incurredLdfAt, paidLdfAt,
} from '../data/paidDevelopmentPatterns';
import type { AccidentYearSplit, CoverageLine, ReserveCohort } from '../types/simulation';

export type { AccidentYearSplit };

/**
 * The valuation age in months for a cohort, clamped to the pattern's reach.
 *
 * ⚠ THE CONVENTION IS THE LEDGER'S: `cohort.age = a` is the valuation at
 * (a + 1) x 12 months, so a brand-new cohort at age 0 is the 12-month figure.
 *
 * ⚠ CLAMPING IS NOT HIDING. A cohort past the end of its table is a cohort
 * whose pattern has nothing left to say; the last age's shares are the closest
 * honest answer and the flag says it happened. The alternative — throwing — is
 * what the old reserveSplitAt did, and a presentation that throws on the years
 * it presents is not a presentation.
 */
export function splitAgeMonths(line: CoverageLine, cohortAge: number): {
  ageMonths: number; beyondPattern: boolean;
} {
  const paid = PAID_DEVELOPMENT_PATTERN[line];
  const incurred = INCURRED_DEVELOPMENT_PATTERN[line];
  const last = Math.min(paid[paid.length - 1].ageMonths, incurred[incurred.length - 1].ageMonths);
  const raw = (cohortAge + 1) * 12;
  return raw > last ? { ageMonths: last, beyondPattern: true } : { ageMonths: raw, beyondPattern: false };
}

/**
 * The IBNR share OF THE UNPAID BALANCE at an age — the ratio the dollars are
 * apportioned by. `(1 - 1/incurred) / (1 - 1/paid)`.
 *
 * Returns 0 where the pattern says nothing is outstanding. A balance still held
 * at the end of a pattern is on claims already known, so it belongs entirely to
 * case; nothing can still be unreported once development has run out.
 */
export function ibnrShareOfUnpaid(line: CoverageLine, ageMonths: number): number {
  const unpaidShare = 1 - 1 / paidLdfAt(line, ageMonths);
  if (!(unpaidShare > 0)) return 0;
  const ibnrShare = 1 - 1 / incurredLdfAt(line, ageMonths);
  const r = ibnrShare / unpaidShare;
  const clamped = r < 0 ? 0 : r > 1 ? 1 : r;
  return SPLIT_PRESENTATION.invert ? 1 - clamped : clamped;
}

/**
 * ⚠ A SEAM THAT EXISTS SO THE INERTNESS CLAIM CAN BE TESTED, and for nothing
 * else. `invert` swaps case and IBNR — a change that is drastic on the exhibit
 * and must be invisible everywhere else. reserve-split-check plays identical
 * games with it off and on and requires every economic field to come back
 * bit-identical; if this file ever grows a reader that matters, that gate goes
 * red instead of the claim quietly becoming false.
 *
 * Inverting preserves the sum — case + IBNR is still the unpaid balance — so
 * the gate's first assertion holds in both arms and only the split moves. It
 * is FALSE in every build; nothing but the gate ever sets it.
 */
export const SPLIT_PRESENTATION = { invert: false };

/** One cohort's split. `case = unpaid - ibnr`, so the two sum exactly. */
export function splitCohort(line: CoverageLine, c: ReserveCohort): AccidentYearSplit {
  const { ageMonths, beyondPattern } = splitAgeMonths(line, c.age);
  const share = ibnrShareOfUnpaid(line, ageMonths);

  const unpaidNet = c.netUnpaid;
  const ibnrNet = unpaidNet * share;
  // ⚠ SUBTRACTED, NOT COMPUTED. `unpaid - ibnr` is exact in floating point in a
  // way that `unpaid x caseShare` is not, and the gate asserts an exact sum.
  const caseNet = unpaidNet - ibnrNet;

  // A cohort with no gross basis of its own falls back to net (ceded zero).
  // None does since the bulk cohorts were retired; see the header.
  const unpaidGross = c.grossUnpaid ?? c.netUnpaid;
  const ibnrGross = unpaidGross * share;
  const caseGross = unpaidGross - ibnrGross;

  return {
    yearNumber: c.yearNumber,
    calendarYear: c.calendarYear,
    ageMonths,
    beyondPattern,
    caseNet, ibnrNet, unpaidNet,
    caseGross, ibnrGross, unpaidGross,
    caseCeded: caseGross - caseNet,
    ibnrCeded: ibnrGross - ibnrNet,
    unpaidCeded: unpaidGross - unpaidNet,
  };
}

/** Every cohort's split, newest accident year first. */
export function splitCohorts(line: CoverageLine, cohorts: readonly ReserveCohort[]): AccidentYearSplit[] {
  return cohorts.map(c => splitCohort(line, c)).sort((a, b) => b.yearNumber - a.yearNumber);
}

/**
 * Several lines' per-year rows merged onto accident year, for the pool scope.
 *
 * Dollars add. `ageMonths` is taken from the newest contributing row, which is
 * the same age on every line that opened in that accident year, and
 * `beyondPattern` is true if it is true for ANY contributing line — a pool row
 * is flagged when any line under it has outlived its pattern.
 */
export function combineSplitRows(perLine: readonly (readonly AccidentYearSplit[])[]): AccidentYearSplit[] {
  const byYear = new Map<number, AccidentYearSplit>();
  for (const rows of perLine) {
    for (const r of rows) {
      const prev = byYear.get(r.yearNumber);
      if (!prev) { byYear.set(r.yearNumber, { ...r }); continue; }
      prev.caseNet += r.caseNet; prev.ibnrNet += r.ibnrNet; prev.unpaidNet += r.unpaidNet;
      prev.caseGross += r.caseGross; prev.ibnrGross += r.ibnrGross; prev.unpaidGross += r.unpaidGross;
      prev.caseCeded += r.caseCeded; prev.ibnrCeded += r.ibnrCeded; prev.unpaidCeded += r.unpaidCeded;
      prev.beyondPattern = prev.beyondPattern || r.beyondPattern;
    }
  }
  return [...byYear.values()].sort((a, b) => b.yearNumber - a.yearNumber);
}

/** The line totals, summed from the per-year rows so the two can never disagree. */
export function splitTotals(rows: readonly AccidentYearSplit[]): {
  caseNet: number; ibnrNet: number; caseGross: number; ibnrGross: number;
  caseCeded: number; ibnrCeded: number;
} {
  return rows.reduce((a, r) => ({
    caseNet: a.caseNet + r.caseNet,
    ibnrNet: a.ibnrNet + r.ibnrNet,
    caseGross: a.caseGross + r.caseGross,
    ibnrGross: a.ibnrGross + r.ibnrGross,
    caseCeded: a.caseCeded + r.caseCeded,
    ibnrCeded: a.ibnrCeded + r.ibnrCeded,
  }), { caseNet: 0, ibnrNet: 0, caseGross: 0, ibnrGross: 0, caseCeded: 0, ibnrCeded: 0 });
}
