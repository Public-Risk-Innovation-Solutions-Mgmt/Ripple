// THE RATE STACK — ONE definition, called by the engine and by the Decisions
// panel that explains it.
//
// ============================================================================
// WHY THIS MODULE EXISTS. The panel used to re-derive the price from its own
// formulas and claimed, in a comment, to use "the SAME formulas
// simulationEngine.ts actually prices with". That claim decayed silently twice:
//
//   NET FUNDING       the engine subtracts expected ceded before the CLF; the
//                     panel did not. GL's pool premium rate read $5.63 on the
//                     Decisions screen against the engine's $3.26 — 73% high,
//                     on the screen where the decision is made.
//   TOWER PRICING     the engine prices WC/GL per layer off measured expected
//                     ceded loss; the panel charged the (now-retired)
//                     REINSURANCE_PROGRAMS' percentage of premium, a
//                     structure those lines left.
//
// Both were invisible for the worst possible reason: the panel's combined ratio
// was internally consistent ON ITS OWN GROSS BASIS and read 100.0%, and when
// the engine's own combined-ratio basis was fixed it also became 100.0%. The
// two agreed on the single summary number anyone would have checked while every
// component underneath differed.
//
// So the fix is not a third parallel definition kept in step by discipline. The
// engine and the panel now call THIS function, and parity is structural rather
// than asserted. scripts/diagnostics/panel-engine-parity-check.ts still asserts
// it component by component — never on the combined ratio, which is exactly the
// check that would have passed throughout.
// ============================================================================
//
// ⚠ THE CLF IS AN INPUT, DELIBERATELY. Resolving it needs lookupCLF, which
// lives in simulationEngine, and importing that here would make a cycle. Both
// callers already resolve it the same way — the engine via its selectedFundingCLF
// dispatch, the panel via fundingConsequence's clfFor — and the parity harness
// covers the pair, so passing it in costs nothing and keeps this module a leaf.
//
// ⚠ THIS IS THE PRE-MOVEMENT QUOTE. It answers "what would this year cost on
// the book as it stands", which is the question the panel asks and the same one
// the engine asks to build the price signal members respond to. The engine's
// FINAL premium re-runs the same arithmetic on the POST-movement book, so it
// differs by whoever joins or leaves — see the parity harness, which measures
// that residual rather than pretending it is zero.

import { ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM, DECLINED_COVER_MARGIN_ENABLED } from '../data/defaultAssumptions';
import {
  ADMIN_FIXED_PER_YEAR, ADMIN_PER_EXPOSURE_PER_100, PROFIT_AND_CONTINGENCY_OF_RATE,
} from '../data/pricingParameters';
import { FULL_OCCURRENCE_PLACEMENT } from '../data/reinsuranceTower';
import { normalizeAggregateStopLevel, normalizeLayersPlaced, occurrenceProgramCost, quoteAggregate } from './reinsuranceTower';
import type { TowerLine } from '../data/reinsuranceTower';
import type { CoverageLine, Member } from '../types/simulation';

export interface LineRateInputs {
  line: CoverageLine;
  yearNumber: number;
  /** The line's ACTIVE book, pre-movement. The tower prices off the members
   *  themselves, so this is not interchangeable with an exposure total. */
  members: Member[];
  /** Sum of getMemberExposure over `members` for this line and year. Passed
   *  rather than recomputed so the caller's own exposure figure is the one
   *  priced against. */
  exposure: number;
  /** GROSS pure premium per $100, for THIS year. Not last year's stored value:
   *  WC and GL re-derive it from held constants times the year's trends. */
  purePremiumPer100: number;
  clf: number;
  /** rateLevel / 100. Permanently 1 today; carried so the identity survives if
   *  the rate level ever moves again. */
  pricingAdjustment: number;
  layersPlaced: boolean[];
  aggregateStopLevel: number;
  /** The agreed aggregate terms — see CessionBasis's field of the same name.
   *  Undefined on the held path. It has to be here as well as on the basis
   *  because the SUBTRACTION below builds its own basis, and a subtraction that
   *  used different terms than the gross-up solved against would stop being its
   *  inverse. */
  aggregateTermsRetainedPer100?: number;
}

/**
 * The book-and-decision inputs the CESSION depends on — everything
 * `expectedCededPer100For` needs that is not the rate itself.
 *
 * ⚠ `members` AND `exposure` ARE SEPARATE ON PURPOSE. The engine's final pass
 * hands the COVERED book (post-movement, joiners in, leavers out — see
 * `towerQuote` in simulationEngine) and the post-movement exposure, so the two
 * describe the same members there. A caller quoting ahead of movement (the
 * Decisions panel, the engine's price signal) passes the book as it stands,
 * which is the only book that exists when it asks.
 */
export interface CessionBasis {
  /** The book the TOWER prices off. */
  members: Member[];
  /** The exposure the per-$100 rate is denominated in. */
  exposure: number;
  layersPlaced: boolean[];
  aggregateStopLevel: number;
  /**
   * THE RETAINED RATE THE AGGREGATE'S TERMS ARE AGREED AGAINST, per $100 —
   * undefined on the held path.
   *
   * ⚠ THE ATTACHMENT MUST NOT DEPEND ON THE RATE BEING SOLVED. A real tower is
   * negotiated before the year on figures already in hand; one that re-prices
   * itself while the rate is being calculated is a modelling artefact. When this
   * is set, the aggregate's attachment and limit come off
   * `exposure * this * 10_000` and stay put; only the loss distribution the
   * treaty sits on moves with the rate.
   *
   * ⚠ IT IS SET ONLY WHERE THE RATE IS UNKNOWN. On the held path the rate IS a
   * figure in hand, so terms derived from it are already agreed in advance and
   * there is nothing to break — those callers leave this undefined and get
   * arithmetic bit-identical to what shipped.
   *
   * ⚠ AND IT MUST REACH THE SUBTRACTION, NOT ONLY THE SOLVE. `quoteLineRates`
   * subtracts what the gross-up added; if the two disagreed about the treaty
   * they would stop being inverse and the double deduction would come back in a
   * form no gate names. It rides on this basis for exactly that reason.
   */
  aggregateTermsRetainedPer100?: number;
}

export interface CessionQuote {
  towerQuote: ReturnType<typeof occurrenceProgramCost> | null;
  aggregateQuote: ReturnType<typeof quoteAggregate> | null;
  expectedCededPer100: number;
}

/**
 * THE ONE DEFINITION OF EXPECTED CESSION, in rate terms, at a given GROSS rate.
 *
 * ⚠ EXTRACTED FROM quoteLineRates VERBATIM, OPERATION ORDER INCLUDED, and it is
 * extracted rather than duplicated for a specific reason: the gross-up below
 * has to remove exactly what the net-funding subtraction will put back. Two
 * expressions of "expected ceded" that merely agree today would drift, and the
 * drift would land as a member charged the wrong price with every gate green.
 * There is one expression and both directions call it.
 */
export function expectedCededPer100For(
  line: CoverageLine,
  yearNumber: number,
  grossPurePremiumPer100: number,
  cession: CessionBasis,
): CessionQuote {
  const { members, exposure, layersPlaced, aggregateStopLevel, aggregateTermsRetainedPer100 } = cession;

  const isWcClaimLine = line === 'WC';
  const isPropertyClaimLine = line === 'Property';
  const isAggregateLine = isWcClaimLine || isPropertyClaimLine;
  const isClaimLine = isWcClaimLine || line === 'GL' || isPropertyClaimLine;

  const placedForCost = isClaimLine
    ? normalizeLayersPlaced(line as TowerLine, layersPlaced)
    : null;
  const towerQuote = isClaimLine && placedForCost
    ? occurrenceProgramCost(line as TowerLine, placedForCost, members, yearNumber)
    : null;

  // Read through the same normalizer the engine uses — see its header. Keeps
  // the panel and the engine agreeing about whether an aggregate exists at all,
  // which is the parity property this module exists to guarantee.
  const aggLevel = placedForCost
    ? normalizeAggregateStopLevel(line as TowerLine, placedForCost, aggregateStopLevel)
    : -1;
  // The agreed treaty basis in DOLLARS, on this call's own exposure — the same
  // denominator the rate itself is quoted in, so the terms and the price
  // describe one book. Undefined here means "set the terms from the rate", which
  // is what the held path wants and what this function always did.
  const termsRetained = aggregateTermsRetainedPer100 === undefined
    ? undefined
    : exposure * aggregateTermsRetainedPer100 * 10_000;
  const aggregateQuote = isAggregateLine && placedForCost && aggLevel >= 0
    ? quoteAggregate(
        line as 'WC' | 'Property', placedForCost, members,
        exposure * grossPurePremiumPer100 * 10_000,
        aggLevel, yearNumber, termsRetained,
      )
    : null;

  const expectedCededDollars =
    (towerQuote?.expectedCeded ?? 0) + (aggregateQuote?.expectedCeded ?? 0);
  const expectedCededPer100 =
    expectedCededDollars / Math.max(exposure * 10_000, 1);

  return { towerQuote, aggregateQuote, expectedCededPer100 };
}

// ============================================================================
// THE GROSS-UP — turning a RETAINED loss cost into the GROSS rate this module's
// contract requires.
//
// ⚠ WHY IT EXISTS. `purePremiumPer100` is documented GROSS and every consumer
// depends on that: `expectedLoss` (the aggregate's own attachment basis and the
// reserve basis), the admin base, and the net-funding subtraction below. The
// held rate satisfies that contract. The EXPERIENCE rate does not: it is
// chain-laddered off ReserveDevelopmentRow, whose `ultimateByValuation` and
// `paidByValuation` are BOTH NET of reinsurance (see the ⚠ at paidByValuation),
// so it is already a retained rate. Handing it to the subtraction unconverted
// removed cession a SECOND time.
//
// ⚠ WHY A FIXED POINT RATHER THAN A SKIPPED SUBTRACTION. Skipping the
// subtraction on the experience path would leave two pricing paths differing by
// basis — the class of defect that produced this one — and would leave
// `expectedLoss` net while its own comment says it stays gross, which is the
// aggregate stop-loss's attachment basis. Grossing up keeps ONE path: the rate
// is gross wherever it is read, and the subtraction happens exactly once, in
// the place it always did.
//
// ⚠ THE FACTOR IS NOT A CONSTANT AND IS NOT FITTED. It is the solution of
//     g - expectedCededPer100For(g) = retained
// solved against the very function the subtraction calls, so the two are
// inverse by construction and cannot drift apart. The occurrence tower's ceded
// does not depend on the rate at all (occurrenceProgramCost reads only the book
// and the year), so on GL — which has no aggregate — this lands on the exact
// additive answer g = retained + ceded immediately. WC and Property need a solve
// because their aggregate sits on the year's retained LOSS DISTRIBUTION, whose
// mean is the gross rate less what the occurrence layers cede — so what the
// aggregate expects to pay moves with the rate even though its terms do not.
//
// ============================================================================
// ⚠⚠ AND THE EQUATION ONLY HAS A ROOT BECAUSE THE TOWER IS AGREED IN ADVANCE.
// THIS TOOK THREE ATTEMPTS AND THE FIRST TWO DIAGNOSES WERE BOTH WRONG. THE
// MEASUREMENTS ARE KEPT BECAUSE THE WRONG ONES ARE THE INSTRUCTIVE PART.
//
// ATTEMPT 1 — "linear with a small slope, so the map is a contraction." Linear
// was right. SMALL was never checked. The aggregate attaches at a multiple of
// expected RETAINED loss, so raising the gross rate raises the attachment and
// the aggregate cedes less, and the old solver was a fixed-point iteration
// `g <- retained + ceded(g)` that threw at twenty passes. That throw is the only
// reason any of this was found rather than shipped.
//
// ATTEMPT 2 — "the slope is -0.9995, so the iteration is a REFLECTION and needs
// a root-find rather than a fixed point." Measured on Property year 1 from a
// retained rate of 0.075812, the iterates orbit between 0.124334 and 0.126335,
// and across that cycle
//
//     d(ceded)/d(gross) = (0.048523 - 0.050523) / (0.126335 - 0.124334) = -0.9995
//
// ⚠ THAT NUMBER IS A CHORD ACROSS A DISCONTINUITY, NOT A DERIVATIVE, AND THE
// CONCLUSION DRAWN FROM IT WAS WRONG. Sampling h(g) = g - ceded(g) - retained on
// a fine grid through the same region shows what the two-cycle was really doing:
//
//     g=0.124331  ceded=0.050521  h=-0.002002
//     g=0.125848  ceded=0.051621  h=-0.001585
//     g=0.127364  ceded=0.049239  h=+0.002313    <-- h JUMPED THE ZERO
//
// ceded(g) was a SAWTOOTH — rising at about +0.72 and dropping ~0.0024 every
// 0.0075812 of g — so h was a rising staircase that stepped OVER zero and
// h(g) = 0 HAD NO ROOT AT ALL. The local behaviour was +0.72 with periodic
// drops; -0.9995 was the chord over one of the drops. No solver fixes a missing
// root, and the fixed-point was orbiting the gap rather than a reflection.
//
// ⚠ THE DROPS WERE THE CIRCULARITY. The aggregate's attachment was being
// recomputed from the very rate the solve was looking for, and
// propertyAggregate rounds it to whole millions (`Math.round(x / 1e6) * 1e6`,
// which is how attachments are actually written — BIN at $25k was chosen against
// exactly that convention). So each million the rounded attachment stepped, the
// treaty re-priced itself mid-solve and ceded fell off a cliff.
//
// ATTEMPT 3, AND THE ONE IN THE CODE — THE TOWER IS AGREED BEFORE THE YEAR.
// The attachment and the limit are set from what the pool already knows, the
// triangle's own estimate of RETAINED loss, and the rate is then solved once
// against fixed terms. That is what a real treaty is; an attachment that
// re-prices itself while the rate is being calculated is a modelling artefact.
// See `aggregateTermsRetainedPer100` on CessionBasis above, and quoteAggregate's
// header in reinsuranceTower.
//
// With the terms fixed, the drops are gone and only the +0.72 remains: ceded now
// rises CONTINUOUSLY and MONOTONICALLY with g, because a higher gross rate means
// a bigger loss distribution under an unchanged layer. So
//
//     h'(g) = 1 - ceded'(g) ~ +0.28
//
// h is continuous and strictly increasing, and the root exists and is unique.
//
// ⚠ THE $1M ROUNDING STAYS AND SO DOES BIN. Rounding to $25k would have shrunk
// the gap 40x and left the loop in place to return on a tower change, a
// different rate level, or another line. The circularity was the defect; the
// rounding was only where it bit.
//
// ⚠ SO THE SOLVER IS A SECANT ROOT-FIND ON h, AND IT IS KEPT EVEN THOUGH THE MAP
// WAS NEVER THE PROBLEM. It is the right solver for a continuous map, it needs
// no constant, and it is BIT-IDENTICAL to the old fixed-point iteration — max
// relative difference 0.000e+0 across 2844 solves — everywhere that one
// converged.
//
// ⚠ DAMPING WAS THE OBVIOUS FIX AND WAS ALWAYS THE WRONG ONE. Averaging
// successive iterates turns a slope of -1 into 0 and would have passed on the
// day, but it is tuned to a slope that was not even real, and it would have
// buried a discontinuity instead of removing it.
//
// The convergence assertion STAYS and still throws. A solver that quietly
// returns a rate nobody solved for is the failure this whole block exists to
// prevent.
// ============================================================================

/** Relative tolerance on the RESIDUAL h(g) = g - ceded(g) - retained. Tight
 *  enough that gross-then-subtract returns the retained rate to float noise at
 *  the magnitudes involved, loose enough that the solve always terminates. */
const GROSS_UP_TOL = 1e-12;
/** The secant is superlinear (order ~1.618) and the map is very nearly linear,
 *  so it lands in a handful of steps from either starting point. Twenty is far
 *  past that; exhausting them means the root is not where the secant can reach
 *  it, and that throws rather than returning a rate nobody solved for. */
const GROSS_UP_MAX_ITER = 20;
/** Below this the secant's denominator carries no information — h has not moved
 *  between the two iterates — and stepping on it would divide into noise. */
const SECANT_MIN_DENOM = 1e-15;

export function grossUpRetainedPurePremium(
  line: CoverageLine,
  yearNumber: number,
  retainedPurePremiumPer100: number,
  cession: CessionBasis,
): number {
  // ⚠ THE AGREED TERMS ARE REQUIRED, NOT DEFAULTED, AND THE CHECK IS THE WHOLE
  // GUARANTEE. This function could set the basis from its own argument and
  // always solve — but then a caller that forgot to put it on the cession would
  // subtract with terms the solve never used, the two directions would stop
  // being inverse, and the double deduction this module exists to prevent would
  // come back silently. Refusing to solve is what forces solve and subtraction
  // onto one agreement.
  if (cession.aggregateTermsRetainedPer100 !== retainedPurePremiumPer100) {
    throw new Error(
      `grossUpRetainedPurePremium: ${line} year ${yearNumber} was asked to solve from a `
      + `retained rate of ${retainedPurePremiumPer100} against a cession basis whose agreed `
      + `aggregate terms are ${cession.aggregateTermsRetainedPer100}. The tower is agreed in `
      + 'advance and the subtraction must use the same agreement — set '
      + 'aggregateTermsRetainedPer100 on the basis to the rate being grossed up.',
    );
  }

  const h = (g: number) =>
    g - expectedCededPer100For(line, yearNumber, g, cession).expectedCededPer100 - retainedPurePremiumPer100;

  // Two starting points. The first is the retained rate — h there is minus the
  // whole cession, so it is well below the root. The second is ONE fixed-point
  // step off it, which is the old solver's first pass; with the terms agreed the
  // map is a genuine contraction (ceded'(g) ~ +0.72 < 1) so that step lands close
  // to the root from the same side, and the secant closes the rest in a few
  // passes. Neither point has to bracket: h is continuous and strictly
  // increasing here, so the secant converges from either side.
  let g0 = retainedPurePremiumPer100;
  let h0 = h(g0);
  if (Math.abs(h0) <= GROSS_UP_TOL * Math.max(1, Math.abs(g0))) return g0;
  let g1 = retainedPurePremiumPer100
    + expectedCededPer100For(line, yearNumber, g0, cession).expectedCededPer100;
  let h1 = h(g1);

  for (let i = 0; i < GROSS_UP_MAX_ITER; i++) {
    if (Math.abs(h1) <= GROSS_UP_TOL * Math.max(1, Math.abs(g1))) return g1;
    const denom = h1 - h0;
    if (!Number.isFinite(denom) || Math.abs(denom) < SECANT_MIN_DENOM) break;
    const g2 = g1 - h1 * (g1 - g0) / denom;
    if (!Number.isFinite(g2)) break;
    g0 = g1; h0 = h1;
    g1 = g2; h1 = h(g1);
  }
  throw new Error(
    `grossUpRetainedPurePremium: ${line} year ${yearNumber} did not converge in `
    + `${GROSS_UP_MAX_ITER} secant steps from a retained rate of ${retainedPurePremiumPer100} `
    + `(last iterate ${g1}, residual ${h1}). With the aggregate's terms agreed in advance `
    + 'h is continuous and strictly increasing and this should not happen — see this '
    + "function's header for the discontinuity that used to make it happen, and check "
    + 'whether something has put the attachment back on the rate under solve.',
  );
}

export interface LineRateQuote {
  purePremiumPer100: number;
  expectedCededPer100: number;
  netPurePremiumPer100: number;
  poolPremiumRatePer100: number;
  adminRatePer100: number;
  reinsuranceCost: number;
  reinsRatePer100: number;
  /** The price of the occurrence layers the pool DECLINED, still charged and
   *  kept — the engine's retainedCoverMargin, on the same book and year. 0
   *  whenever every purchasable layer is placed, which is the shipped default. */
  retainedCoverMargin: number;
  retainedCoverMarginRatePer100: number;
  totalMemberChargeRatePer100: number;
  poolPremium: number;
  /** Returned so the engine can REUSE the quote for its post-movement pass
   *  instead of pricing the tower twice — the same "return it rather than
   *  recompute it" rule the net-funding change was built on. */
  towerQuote: ReturnType<typeof occurrenceProgramCost> | null;
  aggregateQuote: ReturnType<typeof quoteAggregate> | null;
}

// ⚠ OPERATION ORDER IS LOAD-BEARING AND MATCHES simulationEngine's estimate
// block STATEMENT FOR STATEMENT. This was extracted from it verbatim, not
// rewritten to taste: reassociating any of these float operations would move
// engine values, and both export gates would (correctly) go red.
export function quoteLineRates(input: LineRateInputs): LineRateQuote {
  const {
    line, yearNumber, members, exposure, purePremiumPer100, clf,
    pricingAdjustment, layersPlaced, aggregateStopLevel, aggregateTermsRetainedPer100,
  } = input;

  // ADMIN STAYS ON THE GROSS PURE PREMIUM, matching the engine. The pool
  // adjusts, reserves and pays a ceded claim in full and only then recovers, so
  // ceding transfers the loss and not the handling cost.
  const adminRatePer100 = purePremiumPer100 * ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM;

  // ⚠ THE CESSION BLOCK THAT USED TO SIT INLINE HERE IS NOW
  // expectedCededPer100For ABOVE, CALLED RATHER THAN COPIED. It moved out
  // unchanged — same statements, same order — so that the gross-up can invert
  // exactly this arithmetic instead of a second copy of it. See that function's
  // header for why one definition is the whole point.
  const { towerQuote, aggregateQuote, expectedCededPer100 } = expectedCededPer100For(
    line, yearNumber, purePremiumPer100,
    { members, exposure, layersPlaced, aggregateStopLevel, aggregateTermsRetainedPer100 },
  );
  const netPurePremiumPer100 =
    Math.max(0, purePremiumPer100 - expectedCededPer100);

  const poolPremiumRatePer100 =
    netPurePremiumPer100 * clf * pricingAdjustment;

  const poolPremium =
    exposure * poolPremiumRatePer100 * 10_000;

  // WC/GL/Property: the placed layers' premiums plus the aggregate (WC and
  // Property only), priced at runtime off the book. `isClaimLine` is
  // exhaustive over CoverageLine, so towerQuote is never actually null —
  // thrown rather than silently defaulted, so a future line without one
  // fails here instead of billing nothing for reinsurance.
  if (towerQuote === null) {
    throw new Error(`quoteLineRates: no tower quote for line ${line}`);
  }
  const reinsuranceCost = towerQuote.premium + (aggregateQuote?.premium ?? 0);

  const reinsRatePer100 = reinsuranceCost / Math.max(exposure * 10_000, 1);

  // ============================================================================
  // ⚠ THE FOURTH TERM, WHICH THE QUOTE USED TO LEAVE OUT. The engine's realised
  // charge is poolPremium + admin + reinsurance + retainedCoverMargin; this quote
  // built the same charge from the first three. On a pool that declined its
  // tower the quote therefore came out short by the whole declined price, and
  // every reader of it saw a rate CUT that the bill never carried — measured as
  // a phantom 46-point cut, every year, on a fully declined pool. Five readers:
  // the engine's rateChangePct and rateLoad (retention and departure), the
  // funding-consequence panel's charge, load and derived rate change, the
  // Decisions page, and panel-engine-parity-check.
  //
  // SAME ARITHMETIC AS THE ENGINE'S, on the same book: the full tower's price
  // minus the placed tower's, floored at zero, behind the same flag. It is only
  // COMPUTED when a layer is actually declined, because the full-tower walk is
  // the expensive part of a quote and is identically the placed one otherwise.
  // When nothing is declined the term is an exact 0 and `x + 0` is `x`, so a
  // fully placed pool — the shipped default — is bit-identical across this fix.
  // ============================================================================
  const towerLine = line as TowerLine;
  const placedNow = normalizeLayersPlaced(towerLine, layersPlaced);
  const anyDeclined = FULL_OCCURRENCE_PLACEMENT[towerLine].some((full, i) => full && !placedNow[i]);
  const retainedCoverMargin = DECLINED_COVER_MARGIN_ENABLED && anyDeclined
    ? Math.max(0, occurrenceProgramCost(towerLine, FULL_OCCURRENCE_PLACEMENT[towerLine], members, yearNumber).premium
      - towerQuote.premium)
    : 0;
  const retainedCoverMarginRatePer100 = retainedCoverMargin / Math.max(exposure * 10_000, 1);

  const totalMemberChargeRatePer100 =
    poolPremiumRatePer100
    + adminRatePer100
    + reinsRatePer100
    + retainedCoverMarginRatePer100;

  return {
    purePremiumPer100,
    expectedCededPer100,
    netPurePremiumPer100,
    poolPremiumRatePer100,
    adminRatePer100,
    reinsuranceCost,
    reinsRatePer100,
    retainedCoverMargin,
    retainedCoverMarginRatePer100,
    totalMemberChargeRatePer100,
    poolPremium,
    towerQuote,
    aggregateQuote,
  };
}

// ============================================================================
// THE NEW RATE STACK — COMMIT 3, BEHIND NEW_RATE_STACK, OFF BY DEFAULT.
//
// ⚠ IT IS A SECOND STACK BESIDE THE OLD ONE, NOT A REWRITE OF IT, and that is
// deliberate. With the flag off, nothing below runs and `quoteLineRates` above
// is untouched, so every value baseline holds for its presence alone. The
// alternative — rewriting quoteLineRates to branch internally — would have put
// the two stacks in one function where a reader could not tell which lines
// belonged to which, and where a careless edit would move the live rate.
//
// WHY IT IS OFF. Measured at three severity trends: the new stack prices
// correctly and today's underprices (WC by about half at 5%), but on TODAY'S
// losses the new pure premium swings 3-5x between identical games. See
// NEW_RATE_STACK's own note and docs/PENDING_MULTIPLAYER.md.
//
// THE TWO FIGURES, per $100 of exposure:
//
//   FIRST INDICATION   at expected, self-funded, no reinsurance
//     (ground-up pure premium + admin) / (1 - risk control - profit & cont.)
//
//   FINAL RATE         at the team's funding level, with its reinsurance
//     (retained pure premium x CLF + admin) / (1 - rc - p&c) + reinsurance
//
// ⚠ THREE PROPERTIES OF THAT ARITHMETIC THAT ARE EASY TO GET WRONG, each one a
// thing the old stack did differently:
//
//   CLF APPLIES TO THE PURE PREMIUM ONLY. Not to admin, and not to the loaded
//   total. Funding confidence is a margin on the LOSS estimate; loading admin
//   by it would charge a confidence margin on a known expense.
//
//   REINSURANCE IS ADDED AFTER THE DIVISOR, NEVER GROSSED UP BY IT. The tower's
//   price is a price, not a loss cost: dividing it by (1 - rc - p&c) would levy
//   the pool's own profit provision on the reinsurer's premium.
//
//   THE PURE PREMIUM IS RETAINED, NOT GROUND-UP. Charging the ground-up figure
//   AND the tower's price would bill members for the ceded layers twice. This
//   is the same reason the old stack subtracted expected ceded before the CLF;
//   what retires is the SECANT SOLVE that used to put a retained rate back on a
//   gross basis, because the new pure premium is ground-up at source.
//
// WHAT THIS RETIRES WHEN THE FLAG IS ON: the 15% admin load
// (ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM), the gross-up step
// (grossUpRetainedPurePremium) and the retained-cover margin. Declining a layer
// now simply means self-funding it — the retained pure premium rises because
// less is ceded, which is the whole and only effect it should have.
// ============================================================================

/** Admin per $100: the line's fixed amount spread over exposure, plus the rate. */
export function adminRatePer100For(line: CoverageLine, exposure: number): number {
  return ADMIN_FIXED_PER_YEAR[line] / Math.max(exposure * 10_000, 1)
    + ADMIN_PER_EXPOSURE_PER_100[line];
}

/**
 * The expense divisor, `1 - risk control - profit & contingency`.
 *
 * ⚠ RISK CONTROL IS CHARGED IN THE RATE HERE, AND IT DID NOT HAVE TO BE. The
 * alternative readings are that the spend comes out of SURPLUS — the pool
 * funds prevention from accumulated capital — or out of the CONTINGENCY
 * provision already in this divisor. Charging it in the rate says prevention is
 * a cost of the year's cover, which is the reading the slider's own screen
 * implies; the other two are defensible and would each change who pays for it.
 * Recorded because the choice is invisible in the arithmetic.
 *
 * ⚠ IT IS riskControlIncentivePct, THE PER-LINE SLIDER — not the pool-wide
 * `riskControlPct`, which is ALREADY spent as riskControlInvestment and would
 * be charged twice if it appeared here as well.
 */
export function expenseDivisor(riskControlPct: number): number {
  return 1 - riskControlPct - PROFIT_AND_CONTINGENCY_OF_RATE;
}

export interface NewStackInputs {
  line: CoverageLine;
  yearNumber: number;
  members: Member[];
  exposure: number;
  /** GROUND-UP pure premium per $100 — newPurePremium.ts's figure. */
  groundUpPurePremiumPer100: number;
  clf: number;
  /** The per-line risk control incentive slider. */
  riskControlPct: number;
  layersPlaced: boolean[];
  aggregateStopLevel: number;
}

export interface NewStackQuote {
  /** Carried so the adapter below can split the loading without re-deriving it. */
  clf: number;
  groundUpPurePremiumPer100: number;
  expectedCededPer100: number;
  retainedPurePremiumPer100: number;
  adminRatePer100: number;
  divisor: number;
  /** (ground-up + admin) / divisor. At expected, self-funded, no reinsurance. */
  firstIndicationPer100: number;
  /** (retained x CLF + admin) / divisor + reinsurance. What members pay. */
  finalRatePer100: number;
  reinsRatePer100: number;
  reinsuranceCost: number;
  /** The loading the divisor adds to the final rate, as a rate — for the panel. */
  riskControlAndContingencyPer100: number;
  /** The CLF-margin plus the contingency provision, in DOLLARS. */
  expectedToSurplus: number;
  towerQuote: ReturnType<typeof occurrenceProgramCost> | null;
  aggregateQuote: ReturnType<typeof quoteAggregate> | null;
}

export function quoteNewRateStack(input: NewStackInputs): NewStackQuote {
  const {
    line, yearNumber, members, exposure, groundUpPurePremiumPer100, clf,
    riskControlPct, layersPlaced, aggregateStopLevel,
  } = input;

  const adminRatePer100 = adminRatePer100For(line, exposure);
  const divisor = expenseDivisor(riskControlPct);

  const firstIndicationPer100 = (groundUpPurePremiumPer100 + adminRatePer100) / divisor;

  // The SAME cession function the old stack uses, on the ground-up figure.
  const { towerQuote, aggregateQuote, expectedCededPer100 } = expectedCededPer100For(
    line, yearNumber, groundUpPurePremiumPer100,
    { members, exposure, layersPlaced, aggregateStopLevel },
  );
  const retainedPurePremiumPer100 = Math.max(0, groundUpPurePremiumPer100 - expectedCededPer100);

  if (towerQuote === null) {
    throw new Error(`quoteNewRateStack: no tower quote for line ${line}`);
  }
  const reinsuranceCost = towerQuote.premium + (aggregateQuote?.premium ?? 0);
  const reinsRatePer100 = reinsuranceCost / Math.max(exposure * 10_000, 1);

  const loadedBase = (retainedPurePremiumPer100 * clf + adminRatePer100) / divisor;
  const finalRatePer100 = loadedBase + reinsRatePer100;

  // What the divisor ADDED, which is what the panel's third row shows: the
  // loaded base less the two things that went into it.
  const riskControlAndContingencyPer100 =
    loadedBase - (retainedPurePremiumPer100 * clf + adminRatePer100);

  // ⚠ UNDERWRITING ONLY, AND IN DOLLARS RATHER THAN A RATE, because the
  // question it answers is "what does this year add to surplus if claims come
  // in at expected" and that is a dollar question. Two terms and no others:
  //
  //   THE FUNDING CUSHION  retained x (CLF - 1). At expected, claims cost the
  //                        retained pure premium and the pool charged CLF times
  //                        it; the difference is what is left over.
  //   THE CONTINGENCY      the profit and contingency provision, which is the
  //                        part of the divisor's loading that is NOT spent.
  //
  // Risk control is deliberately NOT here: it is charged in the rate and then
  // SPENT, so it adds nothing to surplus. Reinsurance is not here either — at
  // expected the tower's price exceeds its expected recovery by the risk load,
  // so including it would make buying cover look like a surplus gain.
  const cushionPer100 = retainedPurePremiumPer100 * (clf - 1);
  const contingencyPer100 = loadedBase * PROFIT_AND_CONTINGENCY_OF_RATE;
  const expectedToSurplus = (cushionPer100 + contingencyPer100) * exposure * 10_000;

  return {
    clf,
    groundUpPurePremiumPer100,
    expectedCededPer100,
    retainedPurePremiumPer100,
    adminRatePer100,
    divisor,
    firstIndicationPer100,
    finalRatePer100,
    reinsRatePer100,
    reinsuranceCost,
    riskControlAndContingencyPer100,
    expectedToSurplus,
    towerQuote,
    aggregateQuote,
  };
}

/**
 * The new stack expressed in `LineRateQuote`'s shape, so the engine can take
 * either without a second set of call sites.
 *
 * ⚠ THE LOADING IS SPLIT ACROSS THE TWO COMPONENTS RATHER THAN CARRIED
 * SEPARATELY, and that is what keeps the quote ADDITIVE. Downstream readers —
 * the engine's charge, the price signal, the parity gate — all assume
 * `pool + admin + reinsurance + margin === total`. Since
 * `(retained x CLF + admin) / d` is exactly `retained x CLF / d + admin / d`,
 * loading each component by the divisor preserves the identity to the bit
 * while the sum stays the designed rate. The UNLOADED components are on the
 * NewStackQuote for the panel, which has to show them separately.
 *
 * `retainedCoverMargin` is 0: it is retired under this stack. Declining a
 * layer raises the retained pure premium, which is the whole effect.
 */
export function newStackAsLineRateQuote(q: NewStackQuote, exposure: number): LineRateQuote {
  const adminRatePer100 = q.adminRatePer100 / q.divisor;
  const poolPremiumRatePer100 = q.retainedPurePremiumPer100 * q.clf / q.divisor;
  return {
    purePremiumPer100: q.groundUpPurePremiumPer100,
    expectedCededPer100: q.expectedCededPer100,
    netPurePremiumPer100: q.retainedPurePremiumPer100,
    poolPremiumRatePer100,
    adminRatePer100,
    reinsuranceCost: q.reinsuranceCost,
    reinsRatePer100: q.reinsRatePer100,
    retainedCoverMargin: 0,
    retainedCoverMarginRatePer100: 0,
    totalMemberChargeRatePer100: poolPremiumRatePer100 + adminRatePer100 + q.reinsRatePer100,
    poolPremium: exposure * poolPremiumRatePer100 * 10_000,
    towerQuote: q.towerQuote,
    aggregateQuote: q.aggregateQuote,
  };
}
