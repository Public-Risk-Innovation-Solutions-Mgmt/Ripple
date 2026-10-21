// ============================================================================
// THE POOL'S PER-OCCURRENCE LIMIT, APPLIED — one explicit step between the
// draw and everything downstream of it.
//
// The pool covers GL to $25M per claim. Above that the loss is the MEMBER'S:
// reported so a team can see it happened, and counted in nothing the pool
// owns. See POOL_LIMIT_PER_OCCURRENCE for the ruling and for the measurement
// of what the error used to cost.
//
// ⚠ IT IS A SEPARATE STEP ON PURPOSE, NOT A LINE IN THE CLAIM ENGINE. A claim
// engine models how large losses ARE; a limit is a term of the coverage. Fold
// the second into the first and the drawn severity distribution stops being
// observable — every diagnostic that checks the GL severity fit against
// GL_LOSS_MODEL would start measuring the policy instead of the physics, and
// would still look green. Keeping it here means the draw is unchanged, the
// excess is a quantity with a name, and exactly one function decides what the
// pool keeps.
//
// ⚠ THE MEMBER'S OWN LOSS RECORD IS NOT CAPPED, AND THAT IS THE WHOLE POINT
// OF THE LIMIT RATHER THAN AN OMISSION. The excess does not vanish — the
// MEMBER PAYS IT. Their loss for the year is still the full amount, and
// `MemberLossResult.simulatedLoss` goes on saying so. What changes is who
// carries it: the pool's figures are built from the capped CLAIMS, the
// member's record from their actual experience, and the difference between
// the two is `memberShareAboveLimit` by construction.
//
// Reducing the member's record as well was tried first and was wrong twice
// over. It would have said a member with a $40M claim had a $25M year, which
// is false and would have flattered them at renewal; and it broke
// member-experience-mod-check's invariant 1, which compares the DRAWN share
// of loss sitting in the primary layer against the ANALYTIC share from the
// severity distribution — a limited numerator over a capped denominator read
// 1.12pp against a 1pp bound. That invariant is about the shape of the
// severity curve, and a coverage limit does not change the curve.
//
// `simulatedLoss` reaches no live pool total: the one place it is summed into
// `aggregateMemberLoss` is the `!isClaimLine` branch, dead on all three lines.
//
// ⚠ IT MUTATES THE CLAIMS IT IS GIVEN, and that is deliberate rather than
// sloppy. `Claim.grossUltimate` is written once at generation and never moves
// afterwards (the one exception is wcClaimEngine's own assembly, before this
// runs). Everything downstream — the register, the reserve cohorts, the
// development ledger the rate is priced from, the financial statements —
// reads that field. Returning a capped COPY would leave the engine holding
// two claim arrays that disagree, and the first consumer handed the wrong one
// would be a defect nothing in the suite would catch. There is one array and
// it is capped before anyone sees it.
// ============================================================================

import { POOL_LIMIT_PER_OCCURRENCE } from '../data/pricingParameters';
import type { Claim, CoverageLine } from '../types/simulation';

export interface PoolLimitResult {
  /** The pool's gross ultimate AFTER the limit — what it is on the hook for. */
  grossUltimateLoss: number;
  /** The members' share: what fell above the limit. Reported, never charged. */
  memberShareAboveLimit: number;
  /** How many claims pierced it, for the report. */
  claimsAboveLimit: number;
}

/**
 * Cap every claim on `line` at the pool's per-occurrence limit, move the
 * excess to the members, and return both figures.
 *
 * A line with no limit is a no-op that still returns its own gross, so the
 * caller has one code path rather than a branch.
 *
 * ⚠ OCCURRENCE == CLAIM ON GL, which is why capping the claim is capping the
 * occurrence. occurrenceTotals sums one claim per occurrence on WC and GL
 * (the multi-claimant abuse batches went with the sub-coverage rebuild), so
 * the two are the same number today. IF A MULTI-CLAIM OCCURRENCE EVER RETURNS
 * this must cap the occurrence total and apportion the excess back across its
 * claims — the limit is per occurrence, and capping each claim separately
 * would then let one occurrence cost the pool more than the limit allows.
 * The assertion below is what makes that a failure rather than a silent
 * overcharge.
 */
export function applyPoolLimit(
  line: CoverageLine,
  claims: Claim[],
  occurrenceClaimCounts?: ReadonlyMap<string, number>,
): PoolLimitResult {
  const limit = POOL_LIMIT_PER_OCCURRENCE[line];

  if (limit === null) {
    return {
      grossUltimateLoss: claims.reduce((s, c) => s + c.grossUltimate, 0),
      memberShareAboveLimit: 0,
      claimsAboveLimit: 0,
    };
  }

  // ⚠ THE GUARD DESCRIBED ABOVE. Cheap, and it turns a future modelling change
  // into a thrown error instead of a pool paying more than its limit.
  if (occurrenceClaimCounts !== undefined) {
    for (const [id, n] of occurrenceClaimCounts) {
      if (n > 1) {
        throw new Error(`applyPoolLimit: occurrence ${id} on ${line} has ${n} claims, and this `
          + 'limit is PER OCCURRENCE. Capping each claim separately would let the occurrence cost '
          + 'the pool more than the limit. Apportion the excess across the occurrence instead.');
      }
    }
  }

  let memberShareAboveLimit = 0;
  let claimsAboveLimit = 0;
  let grossUltimateLoss = 0;

  for (const c of claims) {
    const excess = c.grossUltimate - limit;
    if (excess > 0) {
      c.grossUltimate = limit;
      // The case reserve is the unpaid estimate on the claim, and the pool
      // does not reserve for money it will not pay. It is set to the full
      // amount at generation, so it is capped with it; a partially paid claim
      // cannot exist yet at this point in the year.
      c.caseReserve = Math.min(c.caseReserve, limit);
      memberShareAboveLimit += excess;
      claimsAboveLimit += 1;
    }
    grossUltimateLoss += c.grossUltimate;
  }

  return { grossUltimateLoss, memberShareAboveLimit, claimsAboveLimit };
}
