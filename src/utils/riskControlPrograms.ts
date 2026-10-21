// ============================================================================
// RISK CONTROL PROGRAMS — THE TWO THAT REACH THE ENGINE.
//
// riskControlCategories.ts describes five programs. TWO of them are wired:
// `gl-law-enforcement-analytics` reduces GL CLAIM FREQUENCY on a three-year
// ramp, and `wc-safety-rtw` cuts WC frequency and converts lost-time claims to
// medical-only (see its own section below). The other three are still
// description only, and the catalog's header says which is which.
//
// The GL sections that follow were written for the GL program and are about
// GL; the WC program's reasoning is in its own section.
//
// ============================================================================
// ⚠ FREQUENCY, NOT SEVERITY, AND THE REASON IS WHAT THE PROGRAM DOES.
//
// Early-intervention analytics identifies officers generating repeated
// complaints and intervenes before the next incident. It PREVENTS INCIDENTS. An
// incident that does not happen produces no claim at all — it is not a cheaper
// claim. So the program removes claims from the draw rather than shrinking the
// ones drawn, and it enters lambda, not the severity distribution.
//
// ⚠ AND IT IS FLAT ACROSS THE SEVERITY DISTRIBUTION, WHICH IS A FIRST
// APPROXIMATION AND IS WRONG IN A KNOWN DIRECTION. The real program targets the
// small number of officers who generate a disproportionate share of liability —
// the repeat-complaint tail — and those officers are exactly the ones whose
// incidents become large claims. A real early-intervention program should
// therefore remove LARGE claims preferentially, and this one removes a claim of
// every size with equal probability.
//
// The consequence is that this UNDERSTATES the program at equal cost: dollars
// saved per claim removed is the book's average severity here, where the real
// program's would be above average. Sizing the reduction to a dollar target (see
// below) therefore buys a LARGER frequency cut than the real program would need.
//
// ⚠ IT CANNOT CURRENTLY BE DONE BETTER, AND THAT IS A PROPERTY OF GL'S MODEL
// RATHER THAN A SHORTCUT. WC carries named components and a shock can target
// one — `componentFreqMultiplier` exists for exactly that. GL's severity
// components are STATISTICAL TIERS drawn per claim from a tilted categorical,
// not sub-coverages with their own exposure, and shockCatalog's own validator
// rejects a GL `freqMultiplier` that names a `sub` for that reason. There is no
// law-enforcement exposure to target and no large-claim tier that means
// "police". Targeting the tail would mean giving GL a severity-tier frequency
// channel, which is a change to GL's loss model and not to this program.
//
// ============================================================================
// ⚠ HOW A PROGRAM AND A SHOCK COMPOSE, RECORDED BEFORE BOTH EXIST ON ONE LINE.
//
// Both are whole-line frequency multipliers on GL and both reach the same
// lambda. The rule is:
//
//   lambda = ... * gPool * rcFactor * shockMult * programMult
//
// MULTIPLICATIVE, INDEPENDENT, AND ORDER-FREE. A 1.217x frequency shock and a
// 0.95x program give 1.156x, and neither is clamped against the other: a shock
// year is a year the program made less bad, which is what a risk control
// program does. Nothing caps the product, because there is no floor a
// frequency multiplier must respect — lambda only has to stay non-negative and
// both factors are positive.
//
// ⚠ BUT THEY MUST NOT SHARE A RECORD, AND THE TEMPTATION IS REAL. The shock
// system already carries `freqMultipliers: Record<string, number>` keyed by
// WHOLE_LINE, and writing the program's factor into that record would have been
// one line. It is wrong twice over, and both are load-bearing:
//
//   1. THE MARKETPLACE READS THE SHOCK RECORD AND MUST NOT READ THE PROGRAM.
//      simulationEngine draws prospects with `freqMultipliers:
//      ctx.shock?.freqMultipliers` and `riskControlEffectiveness: 0` — a shock
//      is weather and falls on everyone, the pool's risk control is the pool's
//      alone. A program is the pool's. Sharing the record would hand the
//      marketplace a program it did not buy, and would do it silently.
//   2. IT WOULD CORRUPT THE SHOCK'S OWN COST ATTRIBUTION. `shockExpectedAdded`
//      answers "what did THIS event add" per firing. A program folded into the
//      same record makes that question unanswerable from it.
//
// So the mechanism is shared and the CHANNEL is separate. That is the same
// distinction the market cycle needed: one number, two writers, and the rule
// written down before the second writer arrives rather than after they
// disagree.
//
// ============================================================================
// ⚠ DRAW ONLY, LIKE RISK CONTROL AND SHOCKS, AND THIS IS A REAL CHOICE.
//
// The program does NOT enter the pricing expectation. It therefore shows up as
// lower losses against unchanged premium — it moves the loss ratio rather than
// cancelling out of it — which is what makes it worth buying at all.
//
// The argument the other way is genuine and is recorded rather than dismissed:
// unlike a shock, a program is KNOWN IN ADVANCE, so an actuary pricing next
// year could reflect it, and a pool that priced for it would hand the saving to
// its members as lower contributions instead of keeping it as surplus. That is
// a pricing policy question — who gets the benefit — and it is not settled
// here. What settles the CURRENT behaviour is that riskControlEffectiveness,
// the existing risk-control channel, is already draw-only, and a second risk
// control mechanism that priced differently from the first would be two rules
// for one idea. If pricing is ever taught to see programs, both should move.
// ============================================================================

import type { CoverageLine } from '../types/simulation';

/** The programs wired to the engine. The other three are description only. */
export const WIRED_PROGRAM_IDS = ['gl-law-enforcement-analytics', 'wc-safety-rtw', 'claims-management-system'] as const;

/**
 * The programs a player can COMMIT from the tiles. A SUBSET of the wired ones.
 *
 * ⚠ WIRED IS NOT BUYABLE, AND THE MERGE OF THE WC PROGRAM IS WHERE THAT SPLIT
 * HAD TO BE MADE. A tile needs a program's STANDING (tenure, lapse decay, the
 * label) and its CHARGE, and only GL has either: glAnalyticsStanding and
 * programAnnualCost are GL's. The tiles used to read WIRED_PROGRAM_IDS, so
 * wiring WC would have made its tile a button that showed GL's standing and
 * GL's $1M build charge, switched on WC's engine effect, and charged WC
 * nothing — a free program under another program's label. Git merged it
 * cleanly; nothing flagged it.
 *
 * WC JOINED IT AT THE SPEND COMMIT, with its own standing (wcSafetyRtwStanding)
 * and charge — see standingFor, which is what the tiles read now instead of
 * GL's standing for every tile. A program may be added here only once it has
 * both.
 */
export const BUYABLE_PROGRAM_IDS: readonly string[] = [
  'gl-law-enforcement-analytics', 'wc-safety-rtw', 'claims-management-system',
];

// ============================================================================
// ⚠ THE MAGNITUDE. SIZED AGAINST THE $1,000,000 PLACEHOLDER COST, DELIBERATELY
// SMALL, AND MEANT TO BE RAISED RATHER THAN ARGUED DOWN.
//
// GL's gross ultimate loss measured $25.42M a year averaged over five years at
// defaults (8 games, identical in GL-only and three-line — GL is
// config-independent). So each 1% of frequency is worth about $0.254M of GROSS
// loss a year, and $1M of gross saving would need a 3.93% cut.
//
// ⚠ GROSS IS NOT WHAT THE POOL KEEPS, WHICH IS WHY THIS IS NOT 3.93%. The
// reinsurance tower cedes part of every large claim, so removing a claim
// returns the pool only its RETAINED share. The figure that matters is the
// change in ending surplus, and it is MEASURED rather than derived — see the
// commit and gl-program-value.ts.
//
// 5% AT FULL RAMP is the shipped value. It is a starting point chosen to be on
// the low side of a real decision rather than a calibration to break-even: the
// brief asked for an effect that could be raised, and a program that obviously
// pays for itself is not a decision, it is a button.
export const GL_ANALYTICS_FREQUENCY_REDUCTION = 0.05;

// ⚠ THE RAMP IS INDEXED BY YEARS COMPLETED, NOT BY COMMITMENT YEAR, so a
// program held past its three-year term stays at full effect rather than
// falling off the end of the array. Year 1 of the commitment buys NOTHING —
// analytics has to accumulate a baseline before it can flag anyone — year 2
// buys half, year 3 and after buy all of it. This is the catalog's `ramped`
// benefit shape made numeric; the catalog says WHICH shape, this says how much.
export const PROGRAM_RAMP: readonly number[] = [0, 0.5, 1];

/** The ramp fraction for a program in its `tenure`-th year (1-based). */
export function rampFraction(tenure: number): number {
  if (tenure <= 0) return 0;
  const i = Math.min(tenure, PROGRAM_RAMP.length) - 1;
  return PROGRAM_RAMP[i];
}

/**
 * CONSECUTIVE years this program has been committed, counting the year being
 * processed. 0 when it is not committed this year.
 *
 * ⚠ CONSECUTIVE, SO DROPPING A PROGRAM RESETS ITS RAMP. Stopping in year two
 * and restarting later starts again at nothing, which is the catalog's own
 * statement that "stopping a three-year program in year two should cost the
 * years already spent" — the cost being that the ramp is not banked.
 *
 * ⚠ DERIVED FROM THE PLAYED YEARS RATHER THAN STORED. Every locked result
 * carries the decisions it was played with, so tenure is a function of history
 * that is already persisted. Storing a counter in poolState would be a second
 * source for the same fact, free to disagree with the decisions after a reload.
 */
export function programTenure(
  programId: string,
  currentIds: readonly string[] | undefined,
  priorIds: readonly (readonly string[] | undefined)[],
): number {
  if (!currentIds?.includes(programId)) return 0;
  let tenure = 1;
  for (let i = priorIds.length - 1; i >= 0; i--) {
    if (!priorIds[i]?.includes(programId)) break;
    tenure++;
  }
  return tenure;
}

// ============================================================================
// ⚠ THE COST SHAPE: BUILT, THEN MAINTAINED. NOT RE-BOUGHT ANNUALLY.
//
//   years 1-3 of the commitment   $1,000,000 a year   the build
//   year 4 onward                 $100,000 a year     the maintenance
//
// An analytics platform is bought once and kept running. Re-charging the full
// build every year would describe a consultant on retainer, which is a
// different product. It is also the only shape under which a LONGER GAME MAKES
// THE PROGRAM BETTER: at $1M a year forever the program loses $290k every year
// after the ramp and can never pay, whichever horizon you pick.
//
// ⚠ THIS SHAPE IS THIS PROGRAM'S, NOT A RULE FOR THE OTHER FOUR. Property
// Mitigation is a roof: once it is hardened the benefit persists with no
// maintenance at all, and a maintenance charge there would be a fee attached to
// nothing. Claims Management is a platform and probably shares this shape;
// Member Services is a yearly service and probably does not. NOTHING HERE
// GENERALISES — each program's cost shape is a separate decision and the other
// four are still undecided.
export const GL_ANALYTICS_BUILD_YEARS = 3;
export const GL_ANALYTICS_BUILD_ANNUAL_COST = 1_000_000;
export const GL_ANALYTICS_MAINTENANCE_ANNUAL_COST = 100_000;

// ============================================================================
// ⚠ DECLINING THE MAINTENANCE ENDS THE BENEFIT, AND IT DECAYS RATHER THAN
// STOPPING DEAD. THE RULING, AND WHY IT IS NOT A CLIFF.
//
// The maintenance charge only means anything if declining it costs something.
// If the benefit persisted unmaintained, stopping would be strictly correct and
// the $100k would be a fee with no decision attached. So it ends. The system
// goes dark, nobody reviews the flags, the interventions stop.
//
// ⚠ BUT NOT ON THE 1st OF JANUARY. Two things outlive the platform by a while:
// the officers already flagged and already through an intervention do not
// un-intervene — behaviour change has inertia — and the supervisory practice the
// platform installed (a review cadence, a threshold, the habit of looking)
// survives the software. Both erode: nobody new is flagged, the risk list goes
// stale, and drift returns.
//
// There is also a MECHANICAL reason a cliff is wrong. A cliff means one missed
// payment destroys a three-year investment outright, which punishes a liquidity
// squeeze out of all proportion and makes the decision brittle rather than
// interesting. A decay makes lapsing cost something real and recoverable.
//
// HALF EACH YEAR, AND GONE ONCE IT FALLS BELOW AN EIGHTH. A pool that stops for
// one year keeps half the effect; two years, a quarter; three years, an eighth;
// the fourth lapsed year takes it to zero.
//
// ⚠ THE FLOOR WAS 0.05 AND THE SENTENCE ABOVE SAID "by the fourth it is gone",
// AND THOSE TWO DISAGREED. 0.5^4 is 0.0625, which is above 0.05, so the rule as
// written ran a year longer than the rule as described. gl-program-check caught
// it on its first run. The floor is the eighth because that is what makes the
// stated behaviour true; the alternative was to reword the sentence, and a
// constant chosen to match its own description is the better of the two.
export const BENEFIT_DECAY_PER_LAPSED_YEAR = 0.5;
const BENEFIT_FLOOR = 0.125;

// ============================================================================
// ⚠ EVERYTHING BELOW IS DERIVED BY WALKING THE DECISION HISTORY. THERE IS NO
// COMMITMENT COUNTER ANYWHERE, AND THAT IS DELIBERATE.
//
// This repository has twice shipped a defect of one shape: a fact that needed a
// HISTORY was kept in a single slot. Decisions were one slot until they became
// per-year; results were one slot until they became per-year. The session layer
// posts decisions per team per year, so a new FIELD on the decision set travels
// in that payload for free — and a counter kept beside the decisions would not.
// It would have to be posted, merged and reconciled separately, and it would be
// free to disagree with the decisions after any reload.
//
// So `riskControlProgramIds` is the only stored thing, and tenure, the ramp
// level, the lapse decay and the cost are all functions of the sequence of
// those lists. Nothing to keep in step, and a replay of the decisions
// reproduces the standing exactly.
export interface ProgramStanding {
  /** Committed for the year being evaluated. */
  committed: boolean;
  /** Consecutive committed years INCLUDING this one. 0 when not committed. */
  tenure: number;
  /** 0..1 — the share of the full effect in force this year. */
  benefitFraction: number;
  /** Dollars charged this year. 0 when not committed. */
  annualCost: number;
  /** True once the build is paid for and the charge is the maintenance. */
  maintaining: boolean;
  /** The commitment term the tile counts against ("Year 2 of 3"). DISPLAY. */
  termYears: number;
}

/**
 * Walk the committed/not sequence and return the standing in the FINAL year.
 *
 * The level RISES along the ramp while committed and cannot fall while the pool
 * is paying; it HALVES for each lapsed year. A restart therefore resumes from
 * whatever is left rather than from nothing, which is both the honest behaviour
 * for a platform that was only briefly dark and the thing that makes an
 * interruption a recoverable mistake instead of a total loss.
 */
export function programStanding(
  programId: string,
  currentIds: readonly string[] | undefined,
  priorIds: readonly (readonly string[] | undefined)[],
): ProgramStanding {
  const seq = [...priorIds, currentIds];
  let level = 0;
  let tenure = 0;
  for (const ids of seq) {
    if (ids?.includes(programId)) {
      tenure += 1;
      level = Math.max(level, rampFraction(tenure));
    } else {
      tenure = 0;
      level *= BENEFIT_DECAY_PER_LAPSED_YEAR;
      if (level < BENEFIT_FLOOR) level = 0;
    }
  }
  const committed = tenure > 0;
  const maintaining = tenure > GL_ANALYTICS_BUILD_YEARS;
  return {
    committed,
    tenure,
    benefitFraction: level,
    maintaining,
    termYears: GL_ANALYTICS_BUILD_YEARS,
    annualCost: !committed ? 0
      : maintaining ? GL_ANALYTICS_MAINTENANCE_ANNUAL_COST : GL_ANALYTICS_BUILD_ANNUAL_COST,
  };
}

/** The GL program's standing, by the only id that is wired. */
export const glAnalyticsStanding = (
  currentIds: readonly string[] | undefined,
  priorIds: readonly (readonly string[] | undefined)[],
): ProgramStanding => programStanding('gl-law-enforcement-analytics', currentIds, priorIds);

/**
 * What this line is charged for committed programs this year.
 *
 * ⚠ activeLineCount IS REQUIRED AND IS NOT A CONVENIENCE. The claims system is
 * the first POOL-SCOPED program: its charge is tiered by how many lines the pool
 * writes, and the engine bills per line, so the pool charge has to be divided
 * somewhere. It is divided EVENLY here. Value-weighting it would make Property
 * carry most of it — Property is 56.5% of the below-retention dollars — and a
 * pool would then be billed by how much it was about to benefit, which is a
 * different product. An even split leaves the unevenness between pools visible,
 * which is the point.
 *
 * Defaulting the count would silently bill a three-line pool at the one-line
 * tier, so there is no default.
 */
export function programAnnualCost(
  line: CoverageLine,
  currentIds: readonly string[] | undefined,
  priorIds: readonly (readonly string[] | undefined)[],
  activeLineCount: number,
): number {
  const n = Math.max(1, Math.round(activeLineCount));
  const claims = claimsSystemStanding(currentIds, priorIds, n).poolAnnualCost / n;
  const own = line === 'WC' ? wcSafetyRtwStanding(currentIds, priorIds).annualCost
    : line === 'GL' ? glAnalyticsStanding(currentIds, priorIds).annualCost
    : 0;
  return own + claims;
}

/**
 * A buyable program's standing, by id — what a tile shows. Each program's own
 * standing function; there is no generic one, because the cost shape and the
 * lapse rule are each program's own decision.
 */
export function standingFor(
  programId: string,
  currentIds: readonly string[] | undefined,
  priorIds: readonly (readonly string[] | undefined)[],
): ProgramStanding | undefined {
  if (programId === 'gl-law-enforcement-analytics') return glAnalyticsStanding(currentIds, priorIds);
  if (programId === CLAIMS_SYSTEM_ID) {
    // ⚠ THE TILE ASKS WITHOUT KNOWING THE LINE COUNT, so the cost it shows is
    // the ONE-LINE tier. A pool-scoped tile cannot be line-aware here without
    // threading setup through every caller; the Decisions page passes the real
    // count where it has one. See claimsSystemPoolCost.
    const st = claimsSystemStanding(currentIds, priorIds, 1);
    return {
      committed: st.committed, tenure: st.tenure, annualCost: st.poolAnnualCost,
      maintaining: false, termYears: CLAIMS_SYSTEM_TERM_YEARS, benefitFraction: st.level,
    };
  }
  if (programId === 'wc-safety-rtw') {
    const st = wcSafetyRtwStanding(currentIds, priorIds);
    return {
      committed: st.committed, tenure: st.tenure, annualCost: st.annualCost, maintaining: false,
      termYears: WC_SAFETY_RTW_TERM_YEARS,
      // A lapsed WC program is "Lapsing" while SAFETY still carries a residual;
      // RTW has none by rule, so the safety level is the one that says so.
      benefitFraction: Math.max(st.safetyLevel, st.rtwLevel),
    };
  }
  return undefined;
}

/**
 * The program frequency multiplier for one line — 1 when nothing applies.
 *
 * Returned as a SCALAR rather than a Record keyed by WHOLE_LINE, deliberately:
 * the record shape is the shock channel's, and the header above says why these
 * two must not be mistaken for one another at the type level either.
 */
export function programFreqMultiplier(
  line: CoverageLine,
  currentIds: readonly string[] | undefined,
  priorIds: readonly (readonly string[] | undefined)[],
): number {
  if (line === 'WC') {
    // THE LEVEL, NOT THE TENURE — for GL's reason: a lapsed safety program
    // carries a decaying residual, which tenure 0 would throw away.
    const level = wcSafetyRtwStanding(currentIds, priorIds).safetyLevel;
    if (level <= 0) return 1;
    return 1 - WC_SAFETY_FREQUENCY_REDUCTION * level;
  }
  if (line !== 'GL') return 1;
  // ⚠ THE LEVEL, NOT THE TENURE. A lapsed program still carries a decaying
  // residual, so this cannot read `rampFraction(tenure)` — tenure is 0 in a
  // lapsed year and the residual would vanish, which is the cliff the ruling
  // above rejects.
  const level = glAnalyticsStanding(currentIds, priorIds).benefitFraction;
  if (level <= 0) return 1;
  return 1 - GL_ANALYTICS_FREQUENCY_REDUCTION * level;
}

// ============================================================================
// THE WC SAFETY & RETURN-TO-WORK PROGRAM — TWO LEVERS, ONE COMMITMENT.
//
// SAFETY is a FREQUENCY cut: fewer injuries. It enters WC's lambda through the
// same scalar channel as GL's program (programFreqMultiplier above), and for the
// same reasons it is not the shock record.
//
// RETURN TO WORK is a CONVERSION, NOT A SEVERITY SCALE. Modified duty brings the
// worker back before the waiting period ends, so the claim stays MEDICAL-ONLY
// and its indemnity never exists. In this model that is a lost-time claim
// (component medium, large or schoolsMedium) re-drawn from `small` — the fitted
// component whose median is $308 — one for one, so the COUNT is unchanged and
// the MIX is cheaper.
//
// ⚠ WHY CONVERSION AND NOT A SEVERITY SCALE — THREE REASONS, EACH MEASURED.
//
//   1. IT IS WHAT RETURN TO WORK DOES. The worker is back on light duty before
//      the indemnity waiting period ends, so the claim never becomes lost-time.
//      That is a change of KIND, not of size, and conversion models a change of
//      kind. A scale shrinks every lost-time claim a little, which no RTW program
//      does.
//
//   2. IT KEEPS THE WHOLE SAVING WITH THE POOL. Scaling every lost-time claim by
//      x% hands ~41% of the saving to the tower (measured at 5/10/15%, 96 games
//      x 5 years), because a percentage cut on a claim already above the $1M
//      retention comes entirely out of the layer. Conversion under the ceiling
//      leaves the tower's cession exactly unchanged on the ultimate basis.
//
//   3. THE REAL MECHANISM — INDEMNITY DURATION — WAS EXPLORED AND REJECTED. A WC
//      claim is one amount drawn from a mixture fitted to TOTAL cost; there is no
//      indemnity leg for a duration cut to act on. Adding one reverses a
//      deliberate retirement: the medical/indemnity split was removed in 3181b18
//      as ~65 authored parameters calibrated only to each other
//      (CALIBRATION_FINDINGS §30). And it buys nothing here. Measured on 249,656
//      drawn claims, a duration-only RTW under $1M keeps 100% for the pool and
//      moves the experience-rated primary layer 0.78-0.92 per unit of gross —
//      the same economics as conversion (0.73-0.89). Its one distinct finding is
//      a bound: cutting indemnity alone cannot pass -27.5% of gross, so the top
//      of the Texas 10-30% range needs medical and frequency savings too.
//
//   ⚠ AND DO NOT BUILD DURATION BY SHORTENING CLOSURE. The booked path climbs
//      back to the drawn value by a deterministic drift that grows with closure
//      age (1.26x at age 2, 1.68x at 4, 2.32x at 8). Closing a claim earlier
//      without changing its drawn amount cuts BOOKED loss while the ultimate is
//      unchanged — a free lunch in the reserves and the pricing triangle. Cost
//      has to live in the drawn amount; the revision law is mean-one and cannot
//      carry it.
//
// ⚠ WHY NOT THE SHOCK RECORD, AND WHY IT IS NOT A MULTIPLIER AT ALL. Keeping the
// count one-for-one would need a different boost to `small` per rating group —
// 1 + c x 0.82 schools, 1.27 county, 1.37 lowSafety, 1.96 highSafety — and the
// risk-quality tilt moves it again per member. componentFreqMultipliers holds
// one number per component for the whole pool and cannot say that. And the
// marketplace reads that record, so a program written into it would reach
// prospects who never bought it.
//
// ⚠ CLAIMS UNDER WC_RTW_CONVERSION_CEILING ONLY, AND THAT IS A JUDGEMENT. A
// catastrophic injury does not come back on light duty. It is also what keeps
// the tower out of it: a claim under the $1M retention that converts to a
// smaller one never touched a layer, so the pool keeps 100% of the saving
// (measured 0.0% tower share; the unrestricted version gave the tower ~25%).
// The restriction needs the amount, so conversion is a step AFTER the draw —
// see generateWcClaims.
//
// ⚠ THE SIZES, AND WHERE THEY COME FROM.
//   RTW 12.5% of WC gross loss at full effect. The Texas State Office of Risk
//     Management says a return-to-work program should cut overall WC losses by
//     at least 10% and as much as 30%; IRMI gives 25-35% for self-insured
//     employers. 12.5% sits near the bottom of the more conservative source.
//     It was 10% — SORM's floor — until the engine charged the program and the
//     five-year net read -$1.01M, five SE behind: a decision with one right
//     answer. 12.5% is where the CHARGED net breaks even at year 5, measured;
//     see WC_RTW_TARGET_REDUCTION. The EFFECT moved rather than the cost because
//     the cost is a placeholder with no basis and the effect has a source. The
//     conversion RATE that delivers it is solved, below.
//   SAFETY 5%. Not sourced. The low end of an ordinary safety-program claim,
//     and the same size as the GL program's.
//
// ⚠ THE RAMPS DIFFER IN THE RIGHT DIRECTION, NOT IN MEASURED AMOUNTS. Safety is
// a culture build — committees, training, habits — small in year 1 and real by
// year 3. RTW is a policy change: adopt modified duty and the next injured worker
// is back in weeks, so it is near-full at once. Both are indexed by TENURE,
// exactly as GL's ramp is. Stopping does NOT reset both — they lapse
// differently (safety decays, RTW is a cliff); see wcSafetyRtwStanding.
//
// ⚠ AND NEITHER RAMP STARTS AT ZERO, WHICH IS WHERE THIS DIFFERS FROM GL. GL's
// year 1 is a free negative control because its ramp is 0 there. WC's is not:
// the program acts from its first year. wc-program-check's exact control is
// therefore a game that commits from year 2, whose year 1 is at tenure 0.
//
// ⚠ DRAW ONLY, like GL's program: it does not enter the pricing expectation. But
// the pool prices off its own experience (PRICING_TRIANGLE), so about a fifth of
// the saving returns to members as lower premium a year or two later. That is
// not a leak in this program; it is the experience channel doing its job.
// ============================================================================

/** Full-effect WC frequency reduction from the safety lever. */
export const WC_SAFETY_FREQUENCY_REDUCTION = 0.05;

/** Safety ramp by tenure: a culture build. */
export const WC_SAFETY_RAMP: readonly number[] = [0.25, 0.60, 1];

/** RTW ramp by tenure: a policy change, near-full at once. */
export const WC_RTW_RAMP: readonly number[] = [0.75, 1, 1];

/**
 * The share of WC gross loss RTW is sized to remove at full effect. The TARGET;
 * the rate below is what delivers it.
 *
 * ⚠ WHAT THE PROGRAM IS WORTH AT THESE SIZES, CHARGED. Safety 5% and RTW 12.5%,
 * both ramps, $1M/yr flat (WC_SAFETY_RTW_ANNUAL_COST), 96 games x 5 years WC
 * solo, paired on seeds (wc-program-value.ts). The engine CHARGES, so this is
 * NET — benefit, charge, premium feedback and the investment income the spent
 * money no longer earns, together:
 *
 *   year                      1      2      3      4      5
 *   NET surplus, cum       -0.31  -0.33  -0.15  +0.04  -0.10   ($M)
 *   charge, cum             1.00   2.00   3.00   4.00   5.00
 *
 *   year-5 net -$0.10M, SE $0.21M, t = -0.5 — BREAK-EVEN within the noise
 *   pool keeps over the claims' full life (ultimate basis) $11.01M = 2.20x
 *   the charge, of which ~$1.75M (16%) returns to members as lower premium
 *
 * Behind in the early game, even by year 4-5, and well ahead over the claims'
 * life is DELIBERATE: it is the size at which committing is a judgement about
 * horizon rather than an obvious yes or no. A LOWER cost or a HIGHER effect makes
 * it an obvious yes; either moved the other way makes it an obvious no.
 *
 * ⚠ HOW IT GOT HERE — 10% FIRST, AND WHY THAT WAS WRONG. At RTW 10% the uncharged
 * probe read +$4.53M against $5M of hand-subtracted cost: -$0.47M, which looked
 * close. Once the engine charged, the same 96 games read -$1.01M (t = -5.1). The
 * -$0.54M gap was the investment income the $5M no longer earned, which the
 * arithmetic did not carry — the same omission GL's did. The scaled estimate for
 * break-even was "RTW near 12.5-13%"; measured, 12.5% lands on it.
 */
export const WC_RTW_TARGET_REDUCTION = 0.125;

/**
 * The probability that an eligible lost-time claim converts to medical-only, at
 * full effect. SOLVED, NOT CHOSEN, against WC_RTW_TARGET_REDUCTION.
 *
 * Eligible lost-time claims under the ceiling are 56.8% of WC gross, and a
 * converted claim keeps only a `small` draw (mean $489), so a rate c removes
 * about 0.57c of gross. SOLVED on the enrolled book by wc-program-value.ts part
 * 1 — every played WC year of 96 games x 5 redrawn with this lever alone:
 *
 *   c = 0.176   removed 10.05%     (the 10% sizing, solved from c = 0.179)
 *   c = 0.220   removed 12.42%     trial, 0.176 x 1.25
 *   c = 0.221   removed 12.47%     SHIPPED — 12.5% needs c = 0.2215
 *
 * ⚠ IT IS LINEAR IN c, and the ceiling does not make it otherwise. Each eligible
 * claim converts on its own fixed uniform, so the claims converted at 0.22 are a
 * superset of those at 0.176 and the expected saving is c x (the eligible
 * dollars' excess over a `small` draw). The $1M ceiling sets the SLOPE (~0.57
 * rather than ~0.99 unrestricted), not a curve. 0.571 and 0.565 per unit of c
 * at the two sizes differ by sampling in the added band. Re-solve with that
 * script if the WC severity mixture or the ceiling moves.
 */
export const WC_RTW_CONVERSION_RATE = 0.221;

/**
 * Lost-time claims at or above this drawn amount never convert — a catastrophic
 * injury does not come back on light duty. NOMINAL, and deliberately equal to
 * the WC tower's retention, which is what makes the tower's share of the saving
 * exactly zero while every layer is placed.
 *
 * ⚠ "EXACTLY ZERO" HOLDS ON TWO BASES AND NOT A THIRD. Measured with RTW alone
 * in the engine (a copy with WC_SAFETY_FREQUENCY_REDUCTION set to 0), 24 games x
 * 5 years WC solo, 120 line-years:
 *
 *   ULTIMATE basis — the tower on the drawn claims     unchanged in 120 of 120
 *   INCEPTION recovery — the tower on the booked claims unchanged in 120 of 120
 *   DEVELOPMENT cession as booked reserves develop      MOVED in 68 of 120,
 *                                                       net +$0.17M over the run
 *
 * The third is 0.09% of the $187M gross the run avoided, and it moved in the
 * pool's favour. RE-MEASURED AT 12.5% (c = 0.221), same 120 line-years: ultimate
 * and inception unchanged in 120 of 120 again; development moved in the SAME 68,
 * net +$0.03M, 0.014% of $233M avoided — the same line-years, a smaller and
 * different net, which is what a tracked-set reselection would do and a
 * size-proportional leak would not. THE CAUSE IS A READING, NOT A PROOF: development is a
 * cohort-level amount (IBNER on the cohort's net unpaid) spread across a TRACKED
 * set of claims chosen by developmentAllocation's reselection, and conversion
 * changes which claims are in that set, so a share of the cohort's movement
 * lands on a different claim — occasionally one that crosses the retention. No
 * per-claim trace was run to confirm it. If this ever needs to be exactly zero
 * too, that trace is the first step.
 *
 * The inception result is structural, not lucky: the booked first estimate is
 * A x drawn^k (TRIANGLE_INITIAL_CONTRACTION), which for any drawn amount under
 * $1M is at most $0.39M, so an eligible claim cannot pierce at inception.
 *
 * And it assumes every layer is placed. A pool that declines the first layer
 * retains up to $5M, and conversion then touches the tower even less.
 */
export const WC_RTW_CONVERSION_CEILING = 1_000_000;

/** The WC components RTW converts FROM. `small` is the medical-only target. */
export const WC_RTW_LOST_TIME_COMPONENTS: readonly string[] = ['medium', 'large', 'schoolsMedium'];

/** A ramp's fraction at `tenure` (1-based), held at its last value past its end. */
export function rampAt(ramp: readonly number[], tenure: number): number {
  if (tenure <= 0) return 0;
  return ramp[Math.min(tenure, ramp.length) - 1];
}

/**
 * The RTW conversion rate for one line — 0 when nothing applies. A separate
 * scalar channel from the frequency multiplier, for the same reason that one is
 * separate from the shock record: one number, one writer.
 */
export function programRtwConversion(
  line: CoverageLine,
  currentIds: readonly string[] | undefined,
  priorIds: readonly (readonly string[] | undefined)[],
): number {
  if (line !== 'WC') return 0;
  const level = wcSafetyRtwStanding(currentIds, priorIds).rtwLevel;
  if (level <= 0) return 0;
  return WC_RTW_CONVERSION_RATE * level;
}

// ============================================================================
// THE WC PROGRAM'S COST AND ITS LAPSE RULE — WHERE IT DIFFERS FROM GL, AND WHY.
//
// ⚠ THE COST IS FLAT: $1M A YEAR FOR AS LONG AS IT RUNS. NOT GL'S BUILD-THEN-
// MAINTAIN. GL's program is a platform — bought once, then kept running at a
// tenth of the price. WC's is PEOPLE: safety consultants, a return-to-work
// coordinator, training, a safety committee's time. That is a salary line, and
// it does not get cheaper in year four. So there is no maintenance tier and no
// maintenance decision: the pool funds it or it does not.
//
// ⚠ AND $1M IS A PLACEHOLDER WITH NO BASIS. It is RISK_CONTROL_PLACEHOLDER_ANNUAL
// _COST, the same number every tile showed before any program was costed, and
// nobody chose it for WC. It was kept because the program was SIZED against it
// (see WC_RTW_TARGET_REDUCTION): at $1M the program is a real decision, and a
// different figure is a different game. A real number would be a coordinator's
// loaded salary plus consultant and training spend, scaled to the book — the
// flat-versus-scaling question the placeholder's own note leaves open.
//
// ============================================================================
// ⚠ THE TWO LEVERS LAPSE DIFFERENTLY. THIS IS ONE MORE DECISION THAN GL NEEDED,
// AND THE NEXT READER WILL ASSUME THEY MATCH. THEY DO NOT.
//
// The rule: A THING THAT RAMPS FAST LAPSES FAST. Each lever's lapse mirrors the
// mechanism that built it.
//
//   SAFETY decays, on GL's curve: HALF each unfunded year, gone below an eighth
//     (0.500 / 0.250 / 0.125 / 0.000 from full). It ramps 25/60/100 because
//     habits build slowly — committees, training, the reflex to fix a hazard
//     before it hurts someone. Stop funding it and those habits persist, then
//     erode as people turn over and the committee stops meeting. Slow in, slow
//     out. GL's curve is reused rather than a new one invented, because it
//     expresses the same thing — practice that outlives its funding for a while
//     — and a second decay constant with no better basis would be a number
//     wearing a distinction.
//
//   RETURN TO WORK is a CLIFF: ZERO in the first unfunded year. It ramps
//     75/100/100 because it is a policy — adopt modified duty and the next
//     injured worker is back in weeks. It lapses the same way. Stop paying the
//     coordinator and nobody finds the next worker a light-duty placement; the
//     claim goes lost-time exactly as it would have without the program. There
//     is no residual habit to decay, because the mechanism is a person doing a
//     job each time, not a practice that persists.
//
// A RESTART follows from the same rule. Safety resumes from whatever residual
// is left (the level cannot fall while funded, exactly as GL's). RTW starts its
// ramp again at 75%, because there is nothing left to resume from.
//
// The cliff is the stronger claim of the two and the one to revisit if anyone
// has data: a supervisor who learned to offer modified duty may keep doing it
// for a while. If so, RTW takes a short tail — one year at a quarter, say — and
// WC_RTW_LAPSE_RESIDUAL is where it goes. Today it is 0.
// ============================================================================

/** The WC program's annual cost, every committed year. A PLACEHOLDER — see above. */
export const WC_SAFETY_RTW_ANNUAL_COST = 1_000_000;

/** The commitment term the tile counts ("Year 2 of 3"); matches the catalog. DISPLAY. */
export const WC_SAFETY_RTW_TERM_YEARS = 3;

/** RTW's share of its level that survives one unfunded year. 0 is the cliff. */
export const WC_RTW_LAPSE_RESIDUAL = 0;

export interface WcSafetyRtwStanding {
  committed: boolean;
  /** Consecutive committed years including this one; 0 when not committed. */
  tenure: number;
  /** 0..1 — the safety lever's share of full effect this year. */
  safetyLevel: number;
  /** 0..1 — the RTW lever's share of full effect this year. */
  rtwLevel: number;
  /** Dollars charged this year: WC_SAFETY_RTW_ANNUAL_COST when committed, else 0. */
  annualCost: number;
}

/**
 * Walk the committed/not sequence and return the WC program's standing in the
 * FINAL year. Derived from the decision history, like GL's — there is no
 * counter. Safety rises along its ramp while funded and halves each unfunded
 * year; RTW follows its ramp while funded and falls by WC_RTW_LAPSE_RESIDUAL
 * (to zero) when not.
 */
export function wcSafetyRtwStanding(
  currentIds: readonly string[] | undefined,
  priorIds: readonly (readonly string[] | undefined)[],
): WcSafetyRtwStanding {
  const seq = [...priorIds, currentIds];
  let tenure = 0, safety = 0, rtw = 0;
  for (const ids of seq) {
    if (ids?.includes('wc-safety-rtw')) {
      tenure += 1;
      safety = Math.max(safety, rampAt(WC_SAFETY_RAMP, tenure));
      rtw = Math.max(rtw, rampAt(WC_RTW_RAMP, tenure));
    } else {
      tenure = 0;
      safety *= BENEFIT_DECAY_PER_LAPSED_YEAR;
      if (safety < BENEFIT_FLOOR) safety = 0;
      rtw *= WC_RTW_LAPSE_RESIDUAL;
    }
  }
  const committed = tenure > 0;
  return {
    committed, tenure, safetyLevel: safety, rtwLevel: rtw,
    annualCost: committed ? WC_SAFETY_RTW_ANNUAL_COST : 0,
  };
}

// ============================================================================
// THE CLAIMS MANAGEMENT SYSTEM — ONE RATE, THREE LINES, BELOW A FIXED THRESHOLD.
//
// A flat severity reduction on claims BELOW a fixed threshold per line. Not
// leakage: this model does not overpay claims, and building an overpayment so a
// program could remove it would invent a defect to sell a cure — the baseline
// would be a pool paying more than it owes for no reason, and DECLINING would
// mean accepting that. This is better handling on a correct baseline: the files
// that would have cost more cost less.
//
// ⚠ BELOW A FIXED THRESHOLD, SET DIRECTLY AND READ FROM NO TOWER. It used to be
// each line's first layer attachment, read at module load, so the claims system
// acted below whatever the retention happened to be — and a reinsurance redesign
// offering packages with different retentions ($1M on some, $2M on others) would
// have moved the claims system silently with every choice a player made. The
// thresholds are now their own constants:
//
//     WC  $2M        GL  $2M        Property  $5M
//
// Property stays at $5M: it is where the claims system pays most. Its
// below-$5M claims are over half of the whole saving (51.5% of $532M gross
// saved over 24 games x 5 years), and every one is retained in full.
//
// ⚠ THE LEAK, ACCEPTED, AND WHERE THE MONEY GOES. While WC and GL retain $1M, a
// $2M threshold also cuts claims drawn between $1M and $2M, and the reinsurer
// covers everything above the retention. Those savings go to the reinsurer, not
// the pool: a programme does not reach the tower's price, and the pool's own
// experience is net. MEASURED, 24 games x 5 years, default decisions, the rate
// at full effect, the tower's own cession read against the same claims:
//
//     line        saving to the reinsurer     share of the line's saving
//     WC               $0.17M a year                  15.31%
//     GL               $0.22M a year                  21.11%
//     Property         $0.00M a year                   0.21%
//     three lines      $0.40M a year                   8.93% of $4.44M
//
// THE POOL LOSES NOTHING TO IT. The pool keeps $4.04M a year against $4.01M
// under the old rule, a shade MORE: a claim drawn just above $1M that is cut
// below it stops paying the retention in full. The leak is dollars saved that
// nobody in the game receives, not dollars taken from the pool. Property's 0.21%
// is the unchanged multi-claim catastrophe case below.
//
// IT CLOSES ON ANY PACKAGE THAT RETAINS $2M, where the threshold sits at the
// retention again. claims-system-check asserts the leak by BAND (the tower takes
// exactly min(claim - retention, rate x claim) of each claim drawn between the
// retention and the threshold, and nothing else) and asserts that against a $2M
// retention the share falls back inside its 2% bound.
//
// ⚠ ON PROPERTY, WHERE THE THRESHOLD IS STILL THE RETENTION, THE OLD ARGUMENT
// STANDS: a claim drawn AT the retention books at `A x drawn^k` on first
// estimate, which is 75.9% of $5M, so an eligible Property claim cannot pierce
// at inception. It no longer holds on WC (38.9% of $1M) or GL (31.4% of $1M)
// above $1M, which is the band above.
//
// ⚠ AND THE TOWER ATTACHES PER OCCURRENCE, NOT PER CLAIM, SO THAT ARGUMENT WAS
// NOT ENOUGH ON ITS OWN. A Property catastrophe is ONE occurrence carrying many
// claims, so a below-threshold CLAIM can sit inside an occurrence that pierces
// and leak to the tower anyway. Measured over 80 line-years: 0.0% of
// below-threshold dollars sit in a piercing occurrence at defaults (2
// multi-claim occurrences in 7,068), and 0.6% with an earthquake SCHEDULED into
// every game. Real, tested, negligible — but it is the number to re-read if the
// catastrophe model ever emits larger multi-claim events.
//
// ⚠ 10% IS CHOSEN, NOT SOURCED, AND THIS RECORDS IT THE WAY
// WC_RTW_TARGET_REDUCTION IS RECORDED. There is no defensible published figure
// for claims-handling savings — the widely quoted ones are poorly sourced and
// none is reproduced here. What IS establishable is internal: RTW already
// removes about 22.5% of WC's below-retention dollars and is shipped and
// accepted, so 10% is CONSERVATIVE within this model, at a bit under half the
// effect of a mechanism already in the game.
//
// ⚠ IT WAS EXPECTED TO READ NEGATIVE ON A QUIET BOOK AND IT DOES NOT. IT PAYS,
// CLEARLY, AND THE PREDICTION THAT IT WOULD NOT WAS AN ARITHMETIC MISTAKE WORTH
// RECORDING. The earlier sizing measured break-even for this mechanism at 14.2%
// pooled over five years AGAINST A FLAT $1M PER LINE — $15M for a three-line
// pool over five years. This program charges a TIERED $2M for THREE years, $6M
// in total: two and a half times cheaper. A cheaper program has a LOWER hurdle,
// so being cheaper than the thing that needed 14.2% is what makes 10% enough.
// The expectation that "cheaper and a lower rate" would read negative treated
// the cost reduction as if it raised the bar.
//
// MEASURED, paired on seeds, committed every year against never, defaults, no
// shocks scheduled, 24 games x 5 years — AT THE OLD, RETENTION-COUPLED
// THRESHOLDS. The fixed ones leave the pool's own saving 0.8% higher ($4.04M a
// year against $4.01M), so these figures are very slightly conservative:
//
//   three-line pool   $2M/yr x 3 = $6M    year-5 surplus +$2.329M   t = 10.5
//   Property-only     $1M/yr x 3 = $3M    year-5 surplus +$2.899M   t = 16.3
//
//   gross avoided, three-line pool, by year: 0 / $2.32M / $3.90M / $4.08M /
//   $4.08M — year one is the ramp, and the charge stops after year three while
//   the benefit does not, which is where the surplus is made.
//
// ⚠ SO IT IS NOT A JUDGEMENT CALL, AND THAT IS A REAL DEPARTURE FROM THE OTHER
// TWO. WC_RTW_TARGET_REDUCTION was deliberately sized so that committing is "a
// judgement about horizon rather than an obvious yes or no". At t = 10.5 this is
// an obvious yes on a quiet book: a player who declines it is simply wrong. If
// that matters it is fixed by RAISING THE COST or SHORTENING THE FREE TAIL, not
// by cutting the 10% — the rate is the conservative part of this design.
//
// ⚠ AND THE SHOCK CASE IS STILL THE UNTESTED HALF, which is what this mechanism
// was chosen FOR. A winter storm is ~100 Property claims, each its own
// occurrence, none near the retention. A water-contamination event is 2-5 GL
// claims, all below it. Those are exactly the dollars this program cuts and the
// pool retains in full, and NO measurement here covers them: every figure above
// is from a book with no events in it. Expect a shocked book to read better
// still, and say by how much when someone measures it.
//
// WHAT WOULD REPLACE THE 10%: a measurement on a shocked book, or a sourced
// figure if one is ever found. Raising it is a one-line change here; the gate
// asserts the mechanism, not the magnitude.
// ============================================================================

export const CLAIMS_SYSTEM_ID = 'claims-management-system';

/**
 * The flat severity cut on eligible claims at full effect. CHOSEN — see above.
 */
export const CLAIMS_SYSTEM_SEVERITY_REDUCTION = 0.10;

/**
 * ⚠ FIXED, SET DIRECTLY, AND READ FROM NO TOWER — see the header above. WC and GL
 * cut at $2M and Property at $5M. While WC and GL retain $1M the $1M-$2M band
 * leaks to the reinsurer: 8.93% of the saving across a three-line pool, $0.40M a
 * year at full effect, measured at the header and accepted, with the pool's own
 * saving unreduced. It closes on any package that retains $2M.
 *
 * Do not re-derive these from REINSURANCE_TOWER. Writing them here is the point:
 * choosing a package must not move the claims system.
 */
export const CLAIMS_SYSTEM_THRESHOLD: Record<CoverageLine, number> = {
  WC: 2_000_000,
  GL: 2_000_000,
  Property: 5_000_000,
};

/**
 * ⚠ YEAR ONE BUYS NOTHING, WHICH IS HARSHER THAN GL'S AND MUCH HARSHER THAN
 * WC'S. Implementing a claims system is a year of migration before a single
 * file is handled better. GL's PROGRAM_RAMP is also 0 in year one, so this is
 * not new; WC's two levers start at 0.25 and 0.75, so this is the harshest
 * first year of the three. Year two buys 0.60 rather than GL's 0.50.
 */
export const CLAIMS_SYSTEM_RAMP: readonly number[] = [0, 0.60, 1.00];

/** The build term. Paid for three years, then nothing — the system is owned. */
export const CLAIMS_SYSTEM_TERM_YEARS = 3;

/**
 * ⚠ TIERED BY LINES WRITTEN, NOT A PER-LINE MULTIPLE, BECAUSE THAT IS HOW
 * SOFTWARE IS SOLD. A three-line pool gets more out of one claims system than a
 * one-line pool does, but it does not cost three times as much to licence and
 * implement. A flat charge would make a Property-only pool pay full price for
 * part of the benefit; a strict per-line charge would price a three-line pool
 * out of a product whose marginal cost per line is small. The tier is the
 * middle, and the unevenness that remains is a real difference between pools.
 */
export const CLAIMS_SYSTEM_TIER_COST: Record<number, number> = {
  1: 1_000_000,
  2: 1_500_000,
  3: 2_000_000,
};

/** The pool's whole annual charge for this program at `lineCount` lines. */
export function claimsSystemPoolCost(lineCount: number): number {
  const n = Math.max(1, Math.min(3, Math.round(lineCount)));
  return CLAIMS_SYSTEM_TIER_COST[n];
}

export interface ClaimsSystemStanding {
  committed: boolean;
  /** Consecutive committed years including this one; 0 when not committed. */
  tenure: number;
  /** 0..1 — the share of CLAIMS_SYSTEM_SEVERITY_REDUCTION in force this year. */
  level: number;
  /** The POOL's dollars this year — 0 once the build term is paid. */
  poolAnnualCost: number;
}

/**
 * Walk the committed/not sequence and return the standing in the FINAL year.
 * Same derivation as the other two: nothing is stored but the decision lists.
 *
 * ⚠ THE CHARGE STOPS AT THE TERM AND THE BENEFIT DOES NOT. Three years buys the
 * system outright, so year four onward is free while it stays committed. That
 * makes the decision "spend this for three years to own it", which is the
 * decision a claims platform actually is — unlike GL's analytics, which carries
 * a maintenance charge because declining it has to cost something.
 *
 * Lapsing halves the level, as GL's does: a system switched off is not instantly
 * worthless, and an interruption should be recoverable rather than total.
 */
export function claimsSystemStanding(
  currentIds: readonly string[] | undefined,
  priorIds: readonly (readonly string[] | undefined)[],
  lineCount: number,
): ClaimsSystemStanding {
  const seq = [...priorIds, currentIds];
  let tenure = 0, level = 0;
  for (const ids of seq) {
    if (ids?.includes(CLAIMS_SYSTEM_ID)) {
      tenure += 1;
      level = Math.max(level, rampAt(CLAIMS_SYSTEM_RAMP, tenure));
    } else {
      tenure = 0;
      level *= BENEFIT_DECAY_PER_LAPSED_YEAR;
      if (level < BENEFIT_FLOOR) level = 0;
    }
  }
  const committed = tenure > 0;
  return {
    committed,
    tenure,
    level,
    poolAnnualCost: committed && tenure <= CLAIMS_SYSTEM_TERM_YEARS ? claimsSystemPoolCost(lineCount) : 0,
  };
}

/**
 * The severity reduction in force for one line — 0 when nothing applies.
 *
 * ONE RATE ACROSS THE THREE LINES. The THRESHOLD differs by line because the
 * retentions differ; the rate does not, because one claims department handles
 * all three and there is no reason it would be better at one of them.
 *
 * ⚠ THE LEVEL, NOT THE TENURE — a lapsed program carries a decaying residual,
 * and reading the tenure would throw it away. The same trap the other two carry.
 */
export function claimsSystemSeverityReduction(
  currentIds: readonly string[] | undefined,
  priorIds: readonly (readonly string[] | undefined)[],
): number {
  const level = claimsSystemStanding(currentIds, priorIds, 1).level;
  return level <= 0 ? 0 : CLAIMS_SYSTEM_SEVERITY_REDUCTION * level;
}

/**
 * One claim's amount after the claims system, given the reduction in force.
 *
 * ⚠ THE ONLY PLACE THE RULE IS WRITTEN. The three generators call this at the
 * point a claim's amount is finalised; nothing else may re-implement it. It is
 * applied to the DRAW, before occurrence totals, member loss results and the
 * line's gross are derived from the claims, so every downstream figure follows
 * automatically rather than needing its own adjustment.
 *
 * ⚠ STRICTLY BELOW, NEVER AT. A claim drawn exactly at the threshold is
 * untouched. On Property the threshold is also the retention, so the eligible
 * set can never include a claim the tower takes a share of; on WC and GL the
 * band between the retention and the threshold is the accepted leak (see the
 * constant). The transform is monotone and shrinking, so a reduced claim stays
 * below the threshold it qualified under — it cannot move across a boundary in
 * either direction.
 *
 * ⚠ IT CONSUMES NO RANDOMNESS. The draw happens first and is unchanged; this
 * scales the number afterwards. A pool that has not bought the program draws
 * bit-identical claims, which is what makes the null arm provable rather than
 * merely likely.
 */
export function claimsSystemAdjusted(line: CoverageLine, drawn: number, reduction: number): number {
  if (!(reduction > 0)) return drawn;
  if (!(drawn < CLAIMS_SYSTEM_THRESHOLD[line])) return drawn;
  return drawn * (1 - reduction);
}

// ============================================================================
// PROPERTY LOSS PREVENTION & MITIGATION — THE FOURTH PROGRAM, AND THE FIRST ONE
// THAT IS A DIAL RATHER THAN A TILE.
//
// ⚠ IT IS NOT A NEW MECHANISM. IT IS WHAT riskControlPct ALREADY BOUGHT, GIVEN
// PROPERTY'S MEANING. The pool-wide risk-control dial — 0 to 8% of each line's
// own pool premium, in 1% steps, charged through riskControlInvestment, taken
// FROM the loss fund rather than added to the member's bill — has always
// multiplied Property's ATTRITIONAL lambda through
// `rcFactor = 1 - riskControlEffectiveness`. It has been pinned at 0 with no UI
// since before the tiles existed.
//
// So nothing here invents a spend channel, a cost basis or a frequency channel.
// What it adds is the three things that make that multiplier MEAN "mitigation"
// rather than "a generic discount on Property":
//
//   1. IT IS A BUILDING PROGRAM, SO IT IS SCALED TO BUILDINGS (below).
//   2. IT REACHES SCHEDULED WINTER STORMS, which no program has ever reached.
//   3. IT DOES NOT REACH CATASTROPHES, which is structural rather than enforced.
//
// ⚠ AND THE DIAL STAYS POOL-WIDE. riskControlPct is projected into every line at
// processYear entry, so a pool that sets it to 3% spends 3% of EACH line's
// premium and gets each line's own interpretation. This commit changes what
// Property does with it and leaves WC and GL exactly as they were. The catalog's
// `property-mitigation` row is therefore NOT added to BUYABLE_PROGRAM_IDS: a
// tile commits a program at one intensity, and this program's whole decision IS
// its intensity. It is the first of the five to take the slider form the other
// four are headed for.
//
// ============================================================================
// ⚠ 1. ON BUILDINGS, NOT ON THE LINE — AND THE GENERATOR HAS NO SPLIT TO HANG
// THAT ON, SO THE SCALING IS WHERE THE DISTINCTION LIVES. READ THIS BEFORE
// CHANGING THE CONSTANT.
//
// Property covers buildings AND the fleet; there is no separate auto line.
// Sprinklers, roof inspections, water detection and wind bracing cannot reduce a
// collision or a theft. propertyClaimEngine has recorded that as an accepted
// simplification since vehicles were folded in: ONE lambda generates both, and
// `rcFactor` discounted all of it indiscriminately.
//
// THE TWO FACTS, AND THEY COME FROM DIFFERENT WINDOWS — stated because a reader
// will otherwise assume one source:
//
//   BY COUNT, from the frequency RE-CALIBRATION (three developed and trended
//     years): buildings-only frequency 0.00281 per $1M TIV against the
//     vehicle-inclusive 0.00502, so vehicles are (5.02-2.81)/5.02 = 44.0% of
//     claims and buildings are 56.0%.
//   BY DOLLARS, from the nine-year FIT provenance (1,822 claims, 2015-16 to
//     2023-24): "VCL is auto physical damage: 51% of claims but 5.5% of
//     dollars". So buildings are 94.5% of dollars.
//
// The count shares disagree between the windows (44% and 51%) and that is a real
// difference between two samples, not an error in either. ONLY THE DOLLAR SHARE
// IS USED BELOW, so the disagreement does not propagate — but a later reader
// deriving the dollar share FROM the count share would be mixing the windows,
// and the number they got would be wrong.
//
// ⚠ WHY A DOLLAR SCALING AND NOT A COUNT ONE. The model cannot remove a BUILDING
// claim, because it cannot tell one from a vehicle claim: the recalibration
// collapsed both into a single mixture by shifting every mu by the same amount.
// What it CAN do is remove the right number of DOLLARS. A program that cuts
// building frequency by e removes e x 94.5% of Property's dollars in the real
// book, so the multiplier on the blended lambda is
//
//     1 - e x PROPERTY_MITIGATION_BUILDING_DOLLAR_SHARE
//
// and e means WHAT IT SAYS: the reduction in BUILDING claim frequency.
//
// ⚠ THE TWO WAYS OF GETTING THIS WRONG, BOTH MEASURED, BECAUSE BOTH LOOK
// REASONABLE. Applying e to the whole lambda unscaled over-credits the program
// by 1/0.945 = 5.8% — small, and it is the error this scaling removes. Applying
// e x 0.560 (the COUNT share, "only 56% of claims are reachable") under-credits
// it by 0.945/0.560 = 1.69x, which at the sizing measured for this program is
// the difference between clearing its cost and losing by a third. The count
// share is the intuitive answer and it is the badly wrong one, because the
// vehicle claims it protects are 44% of the model's COUNT but 5.5% of the real
// book's DOLLARS.
//
// ⚠ WHAT IS STILL WRONG, IN A KNOWN DIRECTION AND SMALL. The dollars removed are
// right; the claims removed are drawn from the BLENDED severity mixture, so the
// program removes a claim of every size with equal probability where a real
// building program would remove building claims, whose mean is about 13x a
// vehicle claim's ($0.712M against $0.053M, implied by the two shares above).
// The TOTAL is right and the MIX is not. It cannot be fixed here: fixing it
// needs a real auto/building split in the generator, which is the same thing
// propertyClaimEngine's note has been asking for.
// ============================================================================

// ============================================================================
// ⚠ WHAT IT IS WORTH, MEASURED, AND THE STORM IS THE WHOLE ANSWER.
//
// property-mitigation-value.ts, 40 games x 5 years, Property SOLO (the dial is
// pool-wide, so a three-line game would read two other programs at once),
// paired on seeds, the dial set against the dial at zero. The engine CHARGES,
// so these are NET: benefit, charge, premium feedback and the investment income
// the spent money no longer earns, together.
//
//   NET ENDING SURPLUS vs a pool that spent nothing, $M
//
//   spend    QUIET BOOK          BOOK WITH ONE STORM      ... AND AN AGGREGATE
//            yr 3     yr 5       yr 3     yr 5            yr 3     yr 5
//     1%    -0.44   -0.20       +0.01   +0.17            -0.67   -0.40
//     3%    -1.03   +0.06       +0.27   +1.23  t=2.2     -1.33   -0.07
//     5%    -1.74   -0.15       +0.45   +1.86  t=2.5     -2.19   -0.32
//
// THREE YEARS IT DOES NOT PAY. FIVE YEARS IT PAYS, AND ONLY IF A STORM COMES.
// That shape is the one WC_RTW_TARGET_REDUCTION was deliberately sized for and
// the claims system failed to reach: committing is a judgement about horizon and
// about exposure, not an obvious yes. Nobody tuned it to land there — the rate
// comes from RISK_CONTROL_PARAMS, which is older than this program, and the
// building share comes from the fit. It is where the existing curve happens to
// sit, which is worth saying because a sized-to-taste program would be less
// defensible than one that was measured and left alone.
//
// WHERE THE MONEY GOES, 5 years at 5%, storm book, per game:
//   gross avoided $13.97M -> pool keeps $12.14M (the tower took 13.1%, diluted
//   from the attritional band's 24.75% by the storm's 0%) -> members are charged
//   $1.94M less through the experience triangle -> $8.21M spent -> +$1.86M net.
//   The premium giveback is NOT a leak; it is the experience channel doing its
//   job, exactly as WC's program records.
//
// ⚠ AND THE AGGREGATE STOP CANCELS IT ALMOST EXACTLY. This is intended and it is
// the sharpest thing about the design, so it is measured rather than described.
// The aggregate attaches to a multiple of the PRICED expected retained loss and
// this program is draw-only, so mitigation lowers the DRAW and leaves the
// ATTACHMENT where it was: in any year the aggregate is in the money and below
// its limit, a retained dollar removed is a recovery dollar not received.
// Measured in the storm year, 1.49x level:
//
//   spend     storm gross   attritional   AGGREGATE RECOVERY
//     0%      $30.441M      $38.449M      $8.353M
//     3%      $29.050M      $37.503M      $6.756M
//     5%      $28.087M      $36.652M      $5.709M
//
// At 5% the year loses $4.15M of gross and $2.64M of aggregate recovery with it
// — 64% of the gross saving, and essentially 100% of the RETAINED saving, since
// that is the quantity the aggregate sits on. $2.64M against a program worth
// $1.86M over the whole game: a pool holding the upper aggregate gives the
// entire mitigation benefit to the reinsurer and a little more.
//
// THAT IS THE RIGHT ANSWER, NOT A DEFECT. A pool that hardens its buildings
// needs less aggregate cover, and the two are substitutes a real risk manager
// would recognise. What the engine does NOT do is tell the player, because the
// attachment is priced off an expectation the program never enters — so the
// pool pays the unmitigated price for a layer it has made less useful. If that
// ever needs fixing, the fix is to let pricing see the program, and that moves
// all four: riskControlEffectiveness has been draw-only since before any of them
// existed (see the GL header's "DRAW ONLY, LIKE RISK CONTROL AND SHOCKS").
// ============================================================================

/**
 * Buildings' share of Property's loss DOLLARS. The scaling that makes the
 * mitigation rate mean "a cut in BUILDING claim frequency" on a generator that
 * cannot tell a building claim from a vehicle one. See the header — in
 * particular, do NOT replace this with the 56% count share.
 */
export const PROPERTY_MITIGATION_BUILDING_DOLLAR_SHARE = 0.945;

/**
 * The multipliers Property's generator applies for a mitigation rate `e`
 * (riskControlEffectiveness on this line).
 *
 * ⚠ TWO MULTIPLIERS FROM ONE RATE, AND THE DIFFERENCE IS NOT A FUDGE. The
 * attritional band is 44% vehicles by count; a scheduled winter storm is ice,
 * snow load and burst pipes, which is 0% vehicles. The same program therefore
 * removes a DIFFERENT share of each band's dollars, and a single multiplier
 * across both would have to be wrong on one of them. A hardened roof does not
 * leak, so the storm takes the full rate.
 *
 * ⚠ THE CATASTROPHE BAND TAKES NEITHER, AND NOT BY OMISSION. The cat band, the
 * forced-catastrophe path and their per-member hit draws never read any
 * mitigation factor, so there is nothing to exclude them from. That is the
 * measurement behind the decision: the pool keeps 6.37% of a catastrophe saving
 * and the tower takes 93.63%, so a seismic retrofit is a gift to the reinsurer.
 * (Attritional: pool keeps 75.25%. Scheduled weather: pool keeps 100.00% —
 * every claim is its own occurrence and none reaches the $5M retention.)
 * property-mitigation-check asserts the cat band is untouched rather than
 * trusting that no future edit will wire it in.
 */
export function propertyMitigation(effectiveness: number): {
  attritionalMultiplier: number;
  weatherMultiplier: number;
} {
  const e = Math.max(0, Math.min(1, effectiveness));
  return {
    attritionalMultiplier: Math.max(0, 1 - e * PROPERTY_MITIGATION_BUILDING_DOLLAR_SHARE),
    weatherMultiplier: Math.max(0, 1 - e),
  };
}
