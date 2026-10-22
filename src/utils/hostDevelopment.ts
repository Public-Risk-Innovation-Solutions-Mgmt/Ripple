// ============================================================================
// THE HOST'S DEVELOPMENT % — a lifetime total, emerging with the payments.
//
// Each accident year develops by its line's percentage of a BASE OUTSTANDING,
// IN TOTAL over its remaining lifetime. It is not a rate per year, and the
// distinction is the whole reason this module exists rather than one
// multiplication in the engine: read as a yearly rate, the same percentages
// compound to roughly +54% on GL and +171% on WC. See
// DEVELOPMENT_IS_LIFETIME_TOTAL in pricingParameters.ts.
//
//   THE BASE          pre-game years: their outstanding at game start.
//                     Played years: their outstanding at the end
//                     of their first year. Both are the same rule — the
//                     cohort's outstanding at the first valuation it is
//                     subject to — which is why one function sets both.
//   THE TOTAL         the line's signed % of that base. Positive is adverse.
//   THE PACE          each year's share is that year's INCREMENT IN PAID SHARE
//                     divided by the share still unpaid at the base.
//
// ⚠ WHY THAT PACE AND NOT A STRAIGHT LINE: development is news about claims,
// and news arrives when claims are settled. A year that pays a third of its
// remaining balance has learned about a third of what it has left to learn.
//
// ⚠ AND IT SUMS TO EXACTLY ONE, BY CONSTRUCTION RATHER THAN BY TUNING. With
// u(t) the unpaid share at pattern age t and the base struck at age a0, each
// step contributes [u(a) - u(a+1)] / u(a0), and the steps from a0 to run-off
// telescope to [u(a0) - u(infinity)] / u(a0) = 1, because u goes to zero. So
// by run-off exactly the stated percentage has emerged — which is what
// development-emergence-check asserts, per accident year, to the cent.
//
// ============================================================================
// ⚠ THE BASIS IS THE COHORT'S OWN.
//
// A played year has a claim register and a gross ledger beside its net one, so
// its base is its GROSS outstanding and the development lands on the register
// as a gross movement — the tower then answers it, and adverse development
// makes the reinsurance worth more, as excess cover does.
//
// Every year has one since the pool's history begins in 2021: the bulk and
// seed years that had no register — and developed net, `grossUnpaid ??
// netUnpaid` resolving to the net figure — are retired. The fallback stays as
// the general form; nothing reaches it now.
// ============================================================================

import { LINE_PAYOUT_PATTERN } from '../data/defaultAssumptions';
import { unpaidShare } from './payoutPattern';
import type { CoverageLine, ReserveCohort } from '../types/simulation';

/**
 * The outstanding a cohort's development is struck on, on the cohort's own
 * basis — gross where a register exists, net where one does not.
 */
export const developmentBaseOf = (c: ReserveCohort): number => c.grossUnpaid ?? c.netUnpaid;

/**
 * Give a cohort its lifetime development, once, at the first valuation it will
 * be subject to.
 *
 * ⚠ IT IS SET ONCE AND NEVER RE-STRUCK. A cohort that re-based each year would
 * develop by the percentage of a balance that its own development had already
 * moved — compounding, which is precisely the reading this mechanism is
 * defined against. `developmentTotal` being already present is therefore not
 * an error to overwrite but a cohort that has been here before, and it is left
 * alone.
 *
 * ⚠ AGE CONVENTION: `age` counts STEPS TAKEN and pattern age counts YEARS
 * SINCE THE ACCIDENT YEAR STARTED, so a cohort at age `a` sits at pattern age
 * a + 1. A played cohort is created at age 0 having already taken its first
 * year's payments, so its base open share is u(1) — which is exactly the
 * `openFraction` the engine books it with. The two agree by derivation, not by
 * coincidence, and reserve-emergence would be off by a year if they did not.
 */
export function withLifetimeDevelopment(
  c: ReserveCohort, line: CoverageLine, pct: number,
): ReserveCohort {
  if (c.developmentTotal !== undefined) return c;
  const base = developmentBaseOf(c);
  const openShare = unpaidShare(LINE_PAYOUT_PATTERN[line], c.age + 1);
  // A cohort with nothing outstanding, or one already fully paid at the base,
  // has nothing to develop and no denominator to divide by. Zero rather than a
  // guard at every read site.
  if (!(base > 0) || !(openShare > 0) || pct === 0) {
    return { ...c, developmentBase: base, developmentTotal: 0, developmentEmerged: 0, developmentBaseOpenShare: openShare };
  }
  return {
    ...c,
    developmentBase: base,
    developmentTotal: base * pct,
    developmentEmerged: 0,
    developmentBaseOpenShare: openShare,
  };
}

/**
 * What emerges at the step that carries a cohort from `age` to `age + 1`.
 *
 * Returns a SIGNED amount on the cohort's own basis: positive is adverse (the
 * year is costing more than booked), negative favourable.
 *
 * ⚠ THE LAST STEP TAKES THE REMAINDER. The payout tables are finite, so the
 * telescoping sum reaches 1 only in the limit; past the end of the table the
 * increments are zero and a cohort would carry a few cents of development it
 * could never emerge. Once the unpaid share reaches zero the balance is
 * released in full, which is what makes "by run-off, exactly the full
 * percentage" true to the cent rather than approximately.
 */
export function developmentEmergingAtStep(c: ReserveCohort, line: CoverageLine): number {
  const total = c.developmentTotal ?? 0;
  const emerged = c.developmentEmerged ?? 0;
  const openAtBase = c.developmentBaseOpenShare ?? 0;
  const remaining = total - emerged;
  if (total === 0 || remaining === 0 || !(openAtBase > 0)) return 0;

  const pattern = LINE_PAYOUT_PATTERN[line];
  const before = unpaidShare(pattern, c.age + 1);
  const after = unpaidShare(pattern, c.age + 2);
  if (!(after > 0)) return remaining;
  const share = (before - after) / openAtBase;
  if (!(share > 0)) return 0;
  // Never emerge more than is left, which the telescoping sum respects anyway
  // and float arithmetic does not quite.
  return Math.abs(total * share) > Math.abs(remaining) ? remaining : total * share;
}
