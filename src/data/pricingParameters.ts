// ============================================================================
// THE PRICING PARAMETERS — ONE PLACE, SO THE REBUILD CAN BE TUNED BY NUMBER.
//
// ⚠ COMMIT 1 OF THE PRICING REBUILD, AND IT CHANGES NO GAME RESULT. Everything
// under MOVED below was already in the engine at the value it has here; this
// file is now where it is DEFINED, and its old home re-exports it so every
// existing import keeps resolving. Everything under NEW is declared and read by
// nothing — it is tuned and wired from commit 2 onward.
//
// ⚠ VALUE-NEUTRALITY IS THE WHOLE CLAIM OF THIS COMMIT and both value baselines
// are the evidence. A moved constant that changed by an ulp would show up
// there, which is why the move was done as re-export rather than as retyping
// the literals at a second site.
//
// ============================================================================
// WHAT EACH ENTRY CARRIES, AND WHY `basis` IS NOT DECORATION.
//
//   value        the number the engine uses
//   unit         what the number is OF — a rate per $100, a share, dollars,
//                years, a multiplier
//   what         what it does, in one line
//   basis        SOURCED: measured from the pool's own data or an external
//                         source named in `note`. Changing it is a re-fit.
//                CHOSEN:  picked. Changing it is a decision, not a re-fit.
//
// The distinction is the point of the file. A reader tuning the model needs to
// know which numbers they are allowed to move, and this project has repeatedly
// found constants whose provenance had been forgotten — a CHOSEN number
// defended as if it were measured, or a SOURCED one nudged to make a gate pass.
//
// ⚠ TWO THINGS DELIBERATELY NOT MOVED HERE, and the page says so where they
// appear. THE CLF TABLES and THE OPENING SURPLUS BANDS stay in clfTables.ts and
// defaultAssumptions.ts, because each is a derived table whose fitting method,
// controls and rejected alternatives are recorded beside it at length. Moving
// the numbers and leaving the derivation behind is how a table ends up tuned by
// somebody who never read what it was fitted to. They are REGISTERED here — the
// page lists them, read from their own modules — rather than relocated.
// ============================================================================

import { CoverageLine } from '../types/simulation';

export type ParameterBasis = 'SOURCED' | 'CHOSEN';

export interface ParameterEntry {
  readonly value: number | string;
  readonly unit: string;
  readonly what: string;
  readonly basis: ParameterBasis;
  /** Where it came from, or what tuning it would mean. Optional. */
  readonly note?: string;
  /** TRUE while nothing reads it. Commit 2 onward clears these as they wire. */
  readonly notYetUsed?: true;
  /**
   * What the game did with an EXTERNAL model's parameter. Set only in the
   * R model section; a union rather than a string so a typo is a compile
   * error instead of a new category nobody notices on the page.
   */
  readonly status?: RModelStatus;
}

/** The five, and no others. See the R model section's header. */
export type RModelStatus =
  | 'ADOPTED'          // used as given
  | 'ADOPTED, SCALED'  // used after scaling
  | 'ADAPTED'          // changed to fit the game
  | 'SUPERSEDED'       // replaced by a game decision
  | 'NOT USED';        // no game equivalent

export type PerLine<T> = Readonly<Record<CoverageLine, T>>;

// ============================================================================
// MOVED — read by the engine today, at exactly the value it already had.
// ============================================================================

/** Admin load. Applied to GROSS EXPECTED LOSS, not to premium — see the page. */
export const ADMIN_LOAD_OF_EXPECTED_LOSS = 0.15;

/** How many accident years the pricing window keeps. */
export const PRICING_WINDOW_YEARS = 10;

/**
 * The reinsurance risk load lambda: premium = E[ceded] + lambda x SD[ceded].
 * ⚠ IT IS ZERO TODAY. The tower therefore charges its expected cession and no
 * margin. Several comments elsewhere in the repo still say 0.60; they are stale.
 */
export const REINSURANCE_RISK_LOAD_LAMBDA = 0;

// ============================================================================
// TREND AND EXPOSURE — ONE SEVERITY RATE PER LINE, NO FREQUENCY TREND, AND A
// LEVEL EXPOSURE BASE.
//
// ⚠ THIS REPLACES A THREE-PART ARRANGEMENT AND ALL THREE PARTS HAD TO GO
// TOGETHER. What was here: WC severity +3.67% with frequency -1.5%, GL severity
// +5.7026%, Property zero, and an exposure base growing at wage inflation
// 3.63% on WC and GL but not on Property. The rate trend was then the quotient
// — WC -1.462%/yr, GL +2.00%/yr, Property flat — and the three lines were on
// three different footings for reasons that were individually sourced and
// jointly impossible to price off.
//
// Removing the exposure trend ALONE would have made WC's rate rise 2.115%/yr
// and GL's 5.70%/yr, because each line's severity was paired with it by
// construction; that pairing is exactly what exposureTrend.ts warned about at
// length. So the pair is replaced, not half of it.
//
// ⚠ THE 3.63% / 3.67% CANCELLATION IS NOT LOST, IT IS EXPRESSED DIFFERENTLY.
// WCIRB's indemnity trend tracks wages because benefits are a statutory share
// of wage, and with a level exposure base that relationship no longer has a
// denominator to cancel against: the full severity trend now reaches the rate.
// 5% is a CHOSEN round figure for all three lines, deliberately above WC's
// measured 3.67%, and is the number to tune first if the rate moves too fast.
// ============================================================================

/**
 * ACCIDENT-YEAR SEVERITY TREND — one rate per line, applied at the DRAW.
 * Each claim in accident year n costs (1 + rate)^(n-1) of its year-1 amount.
 */
export const SEVERITY_TREND_PER_YEAR: PerLine<number> = { WC: 0.05, GL: 0.05, Property: 0.05 };

/**
 * ACCIDENT-YEAR FREQUENCY TREND — ZERO on all three lines.
 *
 * ⚠ A NAMED ZERO, NOT A DELETION. WC carried -1.5%/yr, sourced, and the
 * mechanism that applies it is still wired and still reads this. Giving a line
 * a frequency trend again is a one-number edit here; deleting the parameter
 * would make it a code change.
 */
export const FREQUENCY_TREND_PER_YEAR: PerLine<number> = { WC: 0, GL: 0, Property: 0 };

/**
 * EXPOSURE BASE GROWTH — ZERO. Payroll and insured value are LEVEL.
 *
 * ⚠ THE BASE NOW MOVES ONLY THROUGH UNDERWRITING, which is the point: a pool
 * whose exposure grew 3.63% a year on its own made every per-$100 figure a
 * quotient of two trends, and a member joining or leaving was the smaller term.
 * The frozen roster carries year-1 dollars and nothing rides on top of them.
 */
export const EXPOSURE_GROWTH_PER_YEAR = 0;

/** The funding confidence level the slider opens on. */
export const DEFAULT_FUNDING_CONFIDENCE_LEVEL = 0.60;

/** The reserve margin's fixed confidence level. */
export const RESERVE_MARGIN_CONFIDENCE_PARAM = 0.90;

/** The combined dividend / assessment control: negative is an assessment. */
export const DIVIDEND_ASSESSMENT_RANGE = { min: -0.15, max: 0.15, step: 0.01, default: 0 };

/** Pool-wide risk control intensity, as a share of each line's own premium. */
export const RISK_CONTROL_PCT_RANGE = { min: 0, max: 0.08, step: 0.01, default: 0 };

/** Per-line risk control incentives. Stored and not read by the engine. */
export const RISK_CONTROL_INCENTIVE_RANGE = { min: 0, max: 0.05, step: 0.01, default: 0 };

/** Per-line prior development the host screen offers. Stored, not read. */
export const PRIOR_DEVELOPMENT_DEFAULTS: PerLine<number> = {
  WC: 0.03,
  GL: 0.10,
  Property: -0.02,
};

// ============================================================================
// NEW — NOT YET USED. Read from commit 2 onward. Every one is CHOSEN and is a
// STARTING VALUE TO BE TUNED.
// ============================================================================

/**
 * ALAE — allocated loss adjustment expense, as a share of loss cost.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const ALAE_OF_LOSS_COST: PerLine<number> = { WC: 0.083, GL: 0.083, Property: 0.083 };

/**
 * ULAE — unallocated loss adjustment expense, as a share of loss cost.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const ULAE_OF_LOSS_COST: PerLine<number> = { WC: 0.083, GL: 0.083, Property: 0.083 };

/**
 * ADMIN, FIXED — dollars a year, per line.
 *
 * ⚠ CALIBRATED SO THE OPENING ADMIN EQUALS TODAY'S 15% LOAD, HALF OF IT FIXED.
 * Measured over 12 games at year 1 on default decisions: admin today is
 * `expectedLoss x 0.15`, so half of that is the fixed figure and the other half
 * is the per-exposure rate below. Means: WC admin $2,157,173 on $392.90M of
 * exposure at a 3.6685 pure premium; GL $3,502,043 on $382.30M at 6.1243;
 * Property $6,797,634 on $18,639.78M at 0.2431.
 *
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const ADMIN_FIXED_PER_YEAR: PerLine<number> = {
  WC: 1_078_586,
  GL: 1_751_022,
  Property: 3_398_817,
};

/**
 * ADMIN, PER EXPOSURE — dollars per $100 of exposure, per line.
 *
 * ⚠ THE OTHER HALF OF THE SAME CALIBRATION, and it is an identity rather than a
 * second measurement: half the load as a RATE is
 * `0.5 x 0.15 x openingPurePremiumPer100`, so WC is 0.075 x 3.6685 = 0.275138,
 * GL 0.075 x 6.1243 = 0.459324, Property 0.075 x 0.2431 = 0.018236. Multiplied
 * back by the opening exposure each lands within 0.3% of half the measured
 * admin — the residual is the spread of pure premium across the 12 games, not
 * an error in the split.
 *
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const ADMIN_PER_EXPOSURE_PER_100: PerLine<number> = {
  WC: 0.275138,
  GL: 0.459324,
  Property: 0.018236,
};

/**
 * PROFIT AND CONTINGENCY — a share of the rate. May be set to 0.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const PROFIT_AND_CONTINGENCY_OF_RATE = 0.05;

/**
 * THE REINSURANCE LOAD — the line's CLF-table multiplier at 70%, applied to a
 * LAYER'S EXPECTED LOSS.
 *
 * ⚠ IT IS NOT THE 70TH PERCENTILE OF THE LAYER'S OWN LOSSES, and the difference
 * is the reason this is a named parameter rather than a lookup at the call
 * site. A layer that is rarely hit has a loss distribution with a large atom at
 * zero, so its own 70th percentile is often ZERO — or, where it is not, below
 * its own mean. Pricing off that would charge nothing for the layers that most
 * need a margin. The pool-level CLF at 70% is a multiplier on an EXPECTED loss
 * and behaves properly at any hit rate.
 *
 * Values are each line's own static CLF table at 0.70, read at this commit:
 * WC 1.1400, GL 1.1350, Property 1.1471. The generic FUNDING_CLF_TABLE reads
 * 1.217 at the same stop and is NOT what these are.
 *
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const REINSURANCE_LOAD_CLF_AT_70: PerLine<number> = {
  WC: 1.1400,
  GL: 1.1350,
  Property: 1.1471,
};

/**
 * HOW MANY YEARS OF PRIOR HISTORY THE PRE-GAME SIMULATES, with real claims
 * behind them. Everything OLDER, out to the end of the line's recorded paid
 * pattern, opens as a BULK cohort — see openingReserves.ts.
 *
 * ⚠ FIVE SINCE COMMIT 3, AND IT DROPPED WHETHER OR NOT THE NEW RATE IS ON.
 * It used to read ten, with a note saying five would STARVE the old ten-year
 * experience window — "a rate priced off half the history it expects is not a
 * smaller sample, it is a different estimator". That is still true, and the
 * drop was ruled anyway: five prior years is the setting going forward, the
 * new window is five, and running the opening on ten while the rate that
 * replaces it wants five would mean moving the opening twice.
 *
 * ⚠ SO THE OLD RATE IS NOW READING A SHORTER HISTORY THAN IT WAS BUILT FOR,
 * while NEW_RATE_STACK is off. That is a known and accepted cost of landing
 * the opening change once rather than twice; it is why all three baselines
 * move at this commit with the flag still off, and every row of that move is
 * attributable to this one parameter.
 */
export const PRIOR_HISTORY_YEARS = 5;

/**
 * THE NEW RATE STACK — OFF, AND IT STAYS OFF UNTIL THE NEW LOSS ENGINE LANDS.
 *
 * ⚠ THE RATE IS RIGHT AND THE ENGINE UNDER IT IS NOT, WHICH IS THE WHOLE
 * REASON THIS IS A FLAG. Measured at three severity trends over six games:
 * today's rate UNDERPRICES — WC by about half at the 5% trend, GL by a third,
 * Property by a quarter — because the engine's held expected figure does not
 * keep pace with trending losses. The new stack prices that correctly. But on
 * TODAY'S losses the new pure premium swings 3-5x between otherwise identical
 * games, because the old engine's losses are that lumpy, and a rate that moves
 * 3x between two runs of the same game reads as broken in a way that steady
 * underpricing does not.
 *
 * So: off. The new loss engine makes ordinary losses stable AND makes them
 * average to their expected figure by construction, which removes both halves
 * of the problem at once. This turns on with it. See the trend findings
 * recorded in docs/PENDING_MULTIPLAYER.md.
 *
 * WHAT THE FLAG GOVERNS: the rate members are charged, the two indications,
 * the Decisions panel, and the retirement of the 15% admin load, the gross-up
 * step and the retained-cover margin. PRIOR_HISTORY_YEARS is NOT behind it.
 */
export const NEW_RATE_STACK = { enabled: false };

/**
 * OPENING SURPLUS, as a multiple of each line's OWN REQUIRED CAPITAL.
 *
 * ⚠ THE DENOMINATOR, STATED EXPLICITLY, because "required capital" names three
 * different quantities elsewhere in this engine and the wrong one is a silent
 * factor of several:
 *
 *   required capital = expectedNetUnpaidLoss x (staticClf(line, 0.90) - 1)
 *
 * — the RESERVE RISK MARGIN, which is what priorHistoryEngine's 'required'
 * band basis already divides by. It is NOT premium, NOT the net reserve
 * itself, and NOT the funding CLF's margin on the coming year's loss.
 *
 * 2.28 is today's figure carried over unchanged: it is the midpoint every
 * line's OPENING_SURPLUS_BAND was re-translated onto, and each line's
 * FROZEN_CAPITAL_J equals it by construction. Starting here means the set
 * opening lands where the search was aiming, so the change is the MECHANISM
 * and not a re-levelling hidden inside it.
 *
 * ⚠ NOT YET USED — commit (b) of the opening rebuild reads it.
 */
export const OPENING_SURPLUS_MULTIPLE_OF_REQUIRED = 2.28;

/**
 * How many years of prior history the new pricing reads.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const PRIOR_HISTORY_YEARS_NEW = 5;

/**
 * The new pricing window: 5 years, EQUAL WEIGHTS.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const PRICING_WINDOW_YEARS_NEW = 5;
export const PRICING_WINDOW_WEIGHTING_NEW = 'equal';

/**
 * Cap on how far the rate may move in a year. NONE.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const RATE_CHANGE_CAP_NEW: number | null = null;

/**
 * The basis reserves are held on under the new pricing.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const RESERVE_BASIS_NEW = 'expected';

// ============================================================================
// THE R MODEL — THE DATA SCIENTIST'S PARAMETERS, RECORDED AND NOT READ.
//
// ⚠ NOTHING IN HERE IS WIRED TO ANYTHING. Every entry is marked `notYetUsed`
// and the new loss engine is what will read the ones it keeps. It is recorded
// now, before that engine exists, because the alternative is a build that
// quietly diverges from its own source and nobody able to say where.
//
// ⚠ ONE FROZEN OBJECT, NOT SIXTY EXPORTED CONSTANTS, and the namespacing is
// the point. These are an EXTERNAL MODEL'S inputs, not this game's: a loose
// `BASE_PREMIUM` next to the game's own constants is an import waiting to
// happen. `R_MODEL.basePremium` cannot be mistaken for ours at a call site.
// The registry below points AT these, so the page and the record cannot
// disagree about a number — the same rule the rest of this file follows.
//
// ⚠ EVERY ENTRY IS CHOSEN, NOT SOURCED, INCLUDING THE ONES THAT LOOK FITTED.
// The data scientist states plainly that the payout patterns, the routine
// reserve development and the A/T/R shock assumptions are ILLUSTRATIVE and not
// fitted to claims data. Nothing else in the model is presented as fitted to
// this pool either. A SOURCED mark anywhere in this section would be exactly
// the "CHOSEN number defended as if it were measured" this file's header was
// written to prevent.
//
// THE STATUS COLUMN is what the game did with each one. Five values, no others:
//   ADOPTED          used as given
//   ADOPTED, SCALED  used after scaling
//   ADAPTED          changed to fit the game
//   SUPERSEDED       replaced by a game decision
//   NOT USED         no game equivalent
// ============================================================================

export const R_MODEL = {
  // General
  years: '2020-2026 (seven)',
  preGeneratedScenarios: 10_000,
  backgroundSimulations: 100,
  initialMembers: 100,
  prospects: 100,
  prospectsPerYear: 5,
  regions: 'North 25% · South 30% · Central 25% · East 20%',
  premiumGrowthPerYear: 0.03,
  initialSurplus: 12_000_000,
  expenseRatio: 0.08,
  seeds: '42, 142, 1000+s, 2000+s, 3000+s, 5000+s',

  // Variance. The two CVs carry the data scientist's OWN revision: the earlier
  // 0.12 and 0.20 were superseded by 0.02 and 0.10 in the model as supplied.
  baselineCV: 0.02,
  baselineCVEarlier: 0.12,
  memberLossCV: 0.10,
  memberLossCVEarlier: 0.20,
  memberRiskCV: 0.30,
  memberSizeCV: 0.40,

  // Shock effects
  shockDecayRate: 0.65,
  economicInflationInitialRate: 0.12,
  investmentLossAdjustment: -0.20,
  memberWithdrawalReduction: 0.25,
  newBusinessPenalty: 0.20,

  // Investment
  investableSurplusRatio: 0.20,
  defaultEquityAllocation: 0.40,
  expectedEquityReturn: 0.07,
  equityReturnSD: 0.15,
  fixedIncomeReturn: 0.03,
  investmentPeriodYears: 1,
  generalInitialInvestments: 25_000_000,
  generalLegacyInvestmentReturn: 0.045,
  generalLegacyInvestmentReturnSD: 0.025,

  // Lines
  basePremium: { GL: 7_000_000, WC: 6_500_000, Property: 4_500_000 },
  targetLossRatio: { GL: 0.70, WC: 0.72, Property: 0.65 },

  // A — proportional increase on the year's ordinary losses, drawn uniformly.
  aShock: {
    GL: { Low: [0.05, 0.15], Mid: [0.15, 0.35], High: [0.35, 0.70] },
    WC: { Low: [0.05, 0.15], Mid: [0.15, 0.35], High: [0.35, 0.75] },
    Property: { Low: [0.10, 0.25], Mid: [0.25, 0.50], High: [0.50, 1.00] },
  },
  // T — aggregate shock loss at the event's start, drawn uniformly.
  tShock: {
    GL: { Low: [1e6, 3e6], Mid: [3e6, 7e6], High: [7e6, 15e6] },
    WC: { Low: [1e6, 3e6], Mid: [3e6, 6e6], High: [6e6, 12e6] },
    Property: { Low: [2e6, 5e6], Mid: [5e6, 12e6], High: [12e6, 25e6] },
  },
  // R — extra adverse rate on outstanding prior-year reserves, drawn uniformly.
  rShock: { Low: [0.02, 0.05], Mid: [0.05, 0.12], High: [0.12, 0.25] },

  // Catalogue: annual probability, duration in years, regional.
  catalogue: [
    ['Earthquake', 0.002, 1, true], ['Winterstorm', 0.06, 1, true],
    ['Wildfire', 0.035, 1, true], ['Legislation', 0.015, 3, false],
    ['WC Reform', 0.02, 3, false], ['Recession', 0.06, 2, false],
    ['Nuclear Verdict', 0.025, 1, false], ['Social Inflation', 0.045, 3, false],
    ['Pandemic', 0.01, 2, false], ['Economic Inflation', 0.10, 3, false],
    ['Investment Loss', 0.04, 1, false], ['Member Withdrawal', 0.02, 2, false],
  ],
  // Map: event, line, A level, T level, R level.
  shockMap: [
    ['Earthquake', 'GL', 'Mid', 'None', 'None'],
    ['Earthquake', 'WC', 'High', 'None', 'None'],
    ['Earthquake', 'Property', 'High', 'High', 'None'],
    ['Winterstorm', 'Property', 'High', 'Low', 'None'],
    ['Wildfire', 'Property', 'Low', 'High', 'None'],
    ['Legislation', 'GL', 'Mid', 'None', 'High'],
    ['WC Reform', 'WC', 'High', 'None', 'Mid'],
    ['Recession', 'GL', 'Low', 'None', 'None'],
    ['Recession', 'WC', 'Low', 'None', 'None'],
    ['Nuclear Verdict', 'GL', 'None', 'High', 'Mid'],
    ['Social Inflation', 'GL', 'High', 'Low', 'Mid'],
    ['Pandemic', 'GL', 'None', 'Mid', 'None'],
    ['Pandemic', 'WC', 'High', 'High', 'None'],
  ],

  // Reinsurance: an AGGREGATE stop on the line's annual loss.
  reinsurance: {
    GL: { attachment: 5_000_000, limit: 5_000_000, rateOnLine: 0.15 },
    WC: { attachment: 4_500_000, limit: 4_000_000, rateOnLine: 0.13 },
    Property: { attachment: 3_500_000, limit: 7_000_000, rateOnLine: 0.16 },
  },

  // Cumulative paid share by development year.
  paidCumulative: {
    GL: [0.15, 0.30, 0.43, 0.55, 0.65, 0.73, 0.80, 0.86, 0.90, 0.94, 0.97, 0.99, 1.00],
    WC: [0.10, 0.20, 0.30, 0.38, 0.45, 0.51, 0.57, 0.62, 0.67, 0.70,
         0.73, 0.76, 0.78, 0.80, 0.82, 0.84, 0.86, 0.88, 0.94, 1.00],
    Property: [0.55, 0.75, 0.87, 0.94, 0.98, 1.00],
  },
  routineDevelopmentMean: 0.00,
  routineDevelopmentSD: 0.07,
} as const;

const rRange = (r: readonly [number, number] | readonly number[], pct = true) =>
  pct ? `${(r[0] * 100).toFixed(0)}%-${(r[1] * 100).toFixed(0)}%`
      : `$${(r[0] / 1e6).toFixed(0)}M-$${(r[1] / 1e6).toFixed(0)}M`;

const rLevels = (l: { Low: readonly number[]; Mid: readonly number[]; High: readonly number[] }, pct = true) =>
  `Low ${rRange(l.Low, pct)} · Mid ${rRange(l.Mid, pct)} · High ${rRange(l.High, pct)}`;

// ============================================================================
// THE REGISTRY — what the page is generated from.
//
// ⚠ IT IS A SECOND DESCRIPTION OF THE CONSTANTS ABOVE AND THAT IS THE ONE PLACE
// THIS FILE ALLOWS IT. The alternative — one object holding value, unit, what
// and basis, with the engine reading `P.adminLoad.value` — makes every call
// site read a wrapper and makes a typo in a key a runtime error instead of a
// compile error. So the constants stay plain and the registry points AT them:
// every `value` below is the constant itself, never a retyped literal, so the
// two cannot disagree about a number. Only the prose can drift, and the page
// check is what holds that still.
// ============================================================================

export interface ParameterSection {
  readonly title: string;
  readonly blurb?: string;
  readonly entries: ReadonlyArray<readonly [string, ParameterEntry]>;
}

const perLine = (v: PerLine<number>, dp = 6) =>
  `WC ${v.WC.toFixed(dp)} · GL ${v.GL.toFixed(dp)} · Property ${v.Property.toFixed(dp)}`;

export const PRICING_PARAMETER_SECTIONS: ReadonlyArray<ParameterSection> = [
  {
    title: 'Trend and exposure',
    blurb: 'Applied at the DRAW, and on the held pricing path so the two cannot diverge. '
      + 'The experience path applies no trend at all.',
    entries: [
      ['Severity trend', {
        value: perLine(SEVERITY_TREND_PER_YEAR, 3), unit: 'per year',
        what: 'Accident-year severity growth. One rate, all three lines.', basis: 'CHOSEN',
        note: 'Replaces WC 3.67% / GL 5.7026% / Property 0. A round figure above WC\'s measured 3.67%, '
          + 'and the first number to tune if the rate moves too fast.',
      }],
      ['Frequency trend', {
        value: perLine(FREQUENCY_TREND_PER_YEAR, 3), unit: 'per year',
        what: 'Zero on all three lines.', basis: 'CHOSEN',
        note: 'A named zero, not a deletion — WC carried -1.5%/yr and the mechanism still reads this.',
      }],
      ['Exposure growth', {
        value: EXPOSURE_GROWTH_PER_YEAR, unit: 'per year',
        what: 'Payroll and insured value are LEVEL; the base moves only through underwriting.', basis: 'CHOSEN',
        note: 'Replaces wage inflation at 3.63% on WC and GL. Removing it alone would have made the rate '
          + 'climb at the full severity trend, which is why the severity rates were replaced with it.',
      }],
      ['Settlement inflation', {
        value: 'per line, in defaultAssumptions.ts', unit: 'per year over a claim\'s life',
        what: 'The dollar-vintage convention applied between accident year and settlement.', basis: 'SOURCED',
        note: 'REGISTERED, NOT MOVED, AND NOT CHANGED IN THIS COMMIT. Distinct from the accident-year '
          + 'severity trend above; see PAYOUT_TREND_FACTOR for the double-count this separation prevents.',
      }],
    ],
  },
  {
    title: 'The pricing window',
    entries: [
      ['Pricing window length', {
        value: PRICING_WINDOW_YEARS, unit: 'accident years',
        what: 'How many accident years the experience rate averages.', basis: 'CHOSEN',
        note: 'The mean is UNWEIGHTED — each year counts the same regardless of exposure or age.',
      }],
    ],
  },
  {
    title: 'Expenses and loads',
    entries: [
      ['Admin load', {
        value: ADMIN_LOAD_OF_EXPECTED_LOSS, unit: 'share of gross expected loss',
        what: 'The pool\'s administration charge.', basis: 'CHOSEN',
        note: 'Applied to EXPECTED LOSS, not to premium, so it does not move with the funding level.',
      }],
      ['Reinsurance risk load (lambda)', {
        value: REINSURANCE_RISK_LOAD_LAMBDA, unit: 'multiplier on SD[ceded]',
        what: 'premium = E[ceded] + lambda x SD[ceded].', basis: 'CHOSEN',
        note: 'ZERO today: the tower charges its expected cession and no margin. Comments elsewhere saying 0.60 are stale.',
      }],
    ],
  },
  {
    title: 'Funding and reserves',
    entries: [
      ['Default funding confidence level', {
        value: DEFAULT_FUNDING_CONFIDENCE_LEVEL, unit: 'confidence',
        what: 'Where the funding slider opens.', basis: 'CHOSEN',
        note: 'The default decision is fundingAtExpected, which bypasses the level and prices at CLF exactly 1.000.',
      }],
      ['Reserve margin confidence', {
        value: RESERVE_MARGIN_CONFIDENCE_PARAM, unit: 'confidence',
        what: 'The fixed confidence the reserve margin is held at.', basis: 'CHOSEN',
      }],
      ['CLF tables', {
        value: 'per line, in clfTables.ts', unit: 'multiplier on expected loss',
        what: 'Confidence level factors by line and confidence stop.', basis: 'SOURCED',
        note: 'REGISTERED, NOT MOVED — each table is a fit whose method, controls and rejected alternatives are recorded beside it.',
      }],
    ],
  },
  {
    title: 'Player controls',
    entries: [
      ['Dividend / assessment range', {
        value: `${DIVIDEND_ASSESSMENT_RANGE.min} to ${DIVIDEND_ASSESSMENT_RANGE.max}, step ${DIVIDEND_ASSESSMENT_RANGE.step}`,
        unit: 'share of opening surplus',
        what: 'Negative is an assessment, positive a dividend.', basis: 'CHOSEN',
      }],
      ['Risk control range', {
        value: `${RISK_CONTROL_PCT_RANGE.min} to ${RISK_CONTROL_PCT_RANGE.max}, step ${RISK_CONTROL_PCT_RANGE.step}`,
        unit: 'share of the line\'s premium',
        what: 'Pool-wide risk control intensity.', basis: 'CHOSEN',
        note: 'The control is retired from the screen; the field is pinned at its default of 0.',
      }],
      ['Risk control incentives range', {
        value: `${RISK_CONTROL_INCENTIVE_RANGE.min} to ${RISK_CONTROL_INCENTIVE_RANGE.max}, step ${RISK_CONTROL_INCENTIVE_RANGE.step}`,
        unit: 'share of the line\'s premium',
        what: 'Per-line risk control incentives.', basis: 'CHOSEN',
        note: 'Stored and not read by the engine; awaiting the new rate indication.',
      }],
    ],
  },
  {
    title: 'Opening position',
    entries: [
      ['Prior development defaults', {
        value: perLine(PRIOR_DEVELOPMENT_DEFAULTS, 2), unit: 'share',
        what: 'What the host setup screen offers per line.', basis: 'CHOSEN',
        note: 'Stored on the room and NOT read by the engine.',
      }],
      ['Opening surplus bands', {
        value: 'per line, in defaultAssumptions.ts', unit: 'band on a per-line basis',
        what: 'The band each line\'s opening surplus is drawn inside.', basis: 'SOURCED',
        note: 'REGISTERED, NOT MOVED — the bands carry their own re-translation rule and a standing prohibition on re-deriving them casually.',
      }],
    ],
  },
  {
    title: 'The opening',
    blurb: 'The SET opening — no acceptance band, no pin, no search. '
      + 'NOT YET USED: commit (a) records them, commit (b) reads them.',
    entries: [
      ['Prior history years', {
        value: PRIOR_HISTORY_YEARS, unit: 'accident years',
        what: 'How many pre-game years are simulated with real claims behind them.', basis: 'CHOSEN',
        note: 'Ten while the old ten-year experience path is live; drops to the new window of five at '
          + 'commit 3, and the two move together. Everything older opens as a bulk cohort.',
      }],
      ['Opening surplus multiple', {
        value: OPENING_SURPLUS_MULTIPLE_OF_REQUIRED, unit: 'x the line\'s own required capital',
        what: 'Sets opening surplus directly, replacing the band and the pin.', basis: 'CHOSEN',
        notYetUsed: true,
        note: 'REQUIRED CAPITAL IS expectedNetUnpaidLoss x (staticClf(line, 0.90) - 1), the reserve risk '
          + 'margin — not premium, not the reserve itself. 2.28 is today\'s band midpoint carried over, '
          + 'so the set opening lands where the search was aiming.',
      }],
      ['Bulk cohort horizon', {
        value: 'each line\'s own recorded paid pattern', unit: 'accident years',
        what: 'How far back the opening runoff reaches: WC 37 years, GL 21, Property 11.', basis: 'SOURCED',
        note: 'The full pattern length. WC is still 9.04% unpaid at 37 years, and its newest 25 accident '
          + 'years hold only 95% of its steady-state reserve, so truncating discards real reserve.',
      }],
    ],
  },
  {
    title: 'The new pricing parameters',
    blurb: 'NOT YET USED — read from commit 2 onward. Every one is CHOSEN and is a starting value to be tuned.',
    entries: [
      ['ALAE', {
        value: perLine(ALAE_OF_LOSS_COST, 3), unit: 'share of loss cost',
        what: 'Allocated loss adjustment expense.', basis: 'CHOSEN', notYetUsed: true,
      }],
      ['ULAE', {
        value: perLine(ULAE_OF_LOSS_COST, 3), unit: 'share of loss cost',
        what: 'Unallocated loss adjustment expense.', basis: 'CHOSEN', notYetUsed: true,
      }],
      ['Admin, fixed', {
        value: perLine(ADMIN_FIXED_PER_YEAR, 0), unit: 'dollars per year',
        what: 'The fixed half of administration.', basis: 'CHOSEN', notYetUsed: true,
        note: 'Calibrated so opening admin equals today\'s 15% load, half of it fixed. Measured over 12 games at year 1.',
      }],
      ['Admin, per exposure', {
        value: perLine(ADMIN_PER_EXPOSURE_PER_100), unit: 'dollars per $100 of exposure',
        what: 'The variable half of administration.', basis: 'CHOSEN', notYetUsed: true,
        note: 'The same calibration: 0.5 x 0.15 x the opening pure premium per $100.',
      }],
      ['Profit and contingency', {
        value: PROFIT_AND_CONTINGENCY_OF_RATE, unit: 'share of rate',
        what: 'May be set to 0.', basis: 'CHOSEN', notYetUsed: true,
      }],
      ['Reinsurance load', {
        value: perLine(REINSURANCE_LOAD_CLF_AT_70, 4), unit: 'multiplier on a layer\'s EXPECTED loss',
        what: 'The line\'s CLF-table multiplier at 70%.', basis: 'CHOSEN', notYetUsed: true,
        note: 'NOT the 70th percentile of the layer\'s own losses — for a rarely hit layer that is often zero, or below its own mean.',
      }],
      ['Prior history years', {
        value: PRIOR_HISTORY_YEARS_NEW, unit: 'years',
        what: 'How many years of prior history the new pricing reads.', basis: 'CHOSEN', notYetUsed: true,
      }],
      ['Pricing window (new)', {
        value: `${PRICING_WINDOW_YEARS_NEW} years, ${PRICING_WINDOW_WEIGHTING_NEW} weights`, unit: 'years',
        what: 'The new window and its weighting.', basis: 'CHOSEN', notYetUsed: true,
      }],
      ['Rate change cap', {
        value: RATE_CHANGE_CAP_NEW === null ? 'none' : RATE_CHANGE_CAP_NEW, unit: '—',
        what: 'Limit on how far the rate may move in a year.', basis: 'CHOSEN', notYetUsed: true,
      }],
      ['Reserve basis', {
        value: RESERVE_BASIS_NEW, unit: '—',
        what: 'The basis reserves are held on.', basis: 'CHOSEN', notYetUsed: true,
      }],
    ],
  },
  {
    title: 'R model (data scientist)',
    blurb: 'The data scientist\'s R model, recorded in full. **Nothing here is read by the engine** — '
      + 'every entry is *not yet used*, and the new loss engine is what will read the ones it keeps. '
      + 'The Status column says what the game did with each: ADOPTED (as given), ADOPTED, SCALED, '
      + 'ADAPTED (changed to fit), SUPERSEDED (replaced by a game decision) or NOT USED. '
      + 'Every entry is CHOSEN rather than SOURCED: the data scientist states that the payout patterns, '
      + 'the routine reserve development and the A/T/R shock assumptions are illustrative and not fitted '
      + 'to claims data, and nothing else in the model is presented as fitted to this pool either.',
    entries: [
      // ---- general ----
      ['Selected line', {
        value: 'one of GL / WC / Property', unit: '—', basis: 'CHOSEN', notYetUsed: true,
        status: 'NOT USED',
        what: 'The administrator picks ONE line for the whole session.',
        note: 'The host picks one or more lines, and a team plays the room\'s whole set.',
      }],
      ['Years', {
        value: R_MODEL.years, unit: 'years', basis: 'CHOSEN', notYetUsed: true, status: 'NOT USED',
        what: 'The model\'s fixed seven-year span.',
        note: 'The game\'s years are the host\'s, 3 to 10 from a chosen starting year.',
      }],
      ['Pre-generated scenarios', {
        value: R_MODEL.preGeneratedScenarios, unit: 'scenarios', basis: 'CHOSEN', notYetUsed: true,
        status: 'NOT USED',
        what: 'How many scenarios the model generates up front.',
        note: 'The game generates on demand from the seed, so there is no pre-generated pool to size.',
      }],
      ['Background simulations', {
        value: R_MODEL.backgroundSimulations, unit: 'simulations', basis: 'CHOSEN', notYetUsed: true,
        status: 'ADAPTED',
        what: 'How many scenarios each displayed figure averages.',
        note: 'The game averages 10, and the count is a parameter — 100 in a browser, per team per year, '
          + 'is the cost the game cannot pay.',
      }],
      ['Members, prospects, offers', {
        value: `${R_MODEL.initialMembers} members · ${R_MODEL.prospects} prospects · `
          + `${R_MODEL.prospectsPerYear} offered a year`,
        unit: 'members', basis: 'CHOSEN', notYetUsed: true, status: 'SUPERSEDED',
        what: 'The model\'s individual member population and its new-business pipeline.',
        note: 'No individual members. Exposure is the unit, and underwriting moves it in and out.',
      }],
      ['Regions', {
        value: R_MODEL.regions, unit: 'share of members', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'Four regions, with a membership share each, for regional shocks.',
        note: 'The game has three — North, Central, South — already in the type system.',
      }],
      ['Premium growth', {
        value: R_MODEL.premiumGrowthPerYear, unit: 'per year', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'Renewal premium growth per member.',
        note: 'The game trends severity at 5% on a level exposure base; see Trend and exposure above.',
      }],
      ['Initial surplus', {
        value: R_MODEL.initialSurplus, unit: 'dollars', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'The opening surplus every player starts with.',
        note: 'The set opening: 2.28 x the line\'s own required capital. See The opening above.',
      }],
      ['Expense ratio', {
        value: R_MODEL.expenseRatio, unit: 'of premium', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'Operating expense as a flat share of premium.',
        note: 'The game charges a fixed amount plus a per-exposure admin load.',
      }],
      ['Random seeds', {
        value: R_MODEL.seeds, unit: '—', basis: 'CHOSEN', notYetUsed: true, status: 'NOT USED',
        what: 'The literal seeds the model sets before each draw.',
        note: 'The game uses labelled sub-streams off one instance seed.',
      }],

      // ---- variance ----
      ['Baseline (year-wide) CV', {
        value: R_MODEL.baselineCV, unit: 'coefficient of variation', basis: 'CHOSEN', notYetUsed: true,
        status: 'ADAPTED',
        what: 'The year-wide ordinary-loss factor\'s CV, shared by every member.',
        note: `The data scientist's own revision — ${R_MODEL.baselineCVEarlier} earlier, superseded in the `
          + 'model as supplied. Folded into one CV per line in the game.',
      }],
      ['Member loss CV', {
        value: R_MODEL.memberLossCV, unit: 'coefficient of variation', basis: 'CHOSEN', notYetUsed: true,
        status: 'ADAPTED',
        what: 'The per-member, per-year loss factor\'s CV.',
        note: `The data scientist's own revision — ${R_MODEL.memberLossCVEarlier} earlier, superseded in `
          + 'the model as supplied. Folded into one CV per line. ⚠ NOT a straight carry-over: this CV '
          + 'is averaged over 100 members, so it contributes about CV/sqrt(100) to the line. Applied to a '
          + 'handful of exposure buckets it would contribute far more, and the line would be lumpier '
          + 'than the model it came from.',
      }],
      ['Member risk CV', {
        value: R_MODEL.memberRiskCV, unit: 'coefficient of variation', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'Spread of the fixed per-member risk score.',
        note: 'No members, so no risk scores. The game has no per-member quality in the new engine.',
      }],
      ['Member size CV', {
        value: R_MODEL.memberSizeCV, unit: 'coefficient of variation', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'Spread of the fixed per-member size factor.',
        note: 'No members, so no size factors.',
      }],

      // ---- shock effects ----
      ['Shock decay rate', {
        value: R_MODEL.shockDecayRate, unit: 'per year', basis: 'CHOSEN', notYetUsed: true,
        status: 'ADOPTED',
        what: 'A and R decay by this factor each year of an event\'s duration. T fires only at onset.',
      }],
      ['Economic inflation, initial', {
        value: R_MODEL.economicInflationInitialRate, unit: 'on ordinary losses', basis: 'CHOSEN',
        notYetUsed: true, status: 'ADOPTED',
        what: 'The Economic Inflation event\'s first-year uplift, decaying at the decay rate.',
      }],
      ['Investment loss adjustment', {
        value: R_MODEL.investmentLossAdjustment, unit: 'added to the equity return', basis: 'CHOSEN',
        notYetUsed: true, status: 'ADOPTED',
        what: 'The Investment Loss event\'s hit to the equity return in the event year.',
      }],
      ['Member withdrawal reduction', {
        value: R_MODEL.memberWithdrawalReduction, unit: 'of exposure', basis: 'CHOSEN', notYetUsed: true,
        status: 'ADOPTED',
        what: 'The Member Withdrawal event cuts exposure by this much from the FOLLOWING year.',
      }],
      ['New-business penalty', {
        value: R_MODEL.newBusinessPenalty, unit: 'on first-year expected loss', basis: 'CHOSEN',
        notYetUsed: true, status: 'ADAPTED',
        what: 'New business costs more in its first year than its price implies.',
        note: 'Kept as a parameter and set to 0 for now, so the mechanism exists before the calibration does.',
      }],

      // ---- investment ----
      ['Investable surplus ratio', {
        value: R_MODEL.investableSurplusRatio, unit: 'of positive beginning surplus', basis: 'CHOSEN',
        notYetUsed: true, status: 'SUPERSEDED',
        what: 'The share of surplus that earns a return.',
        note: 'The game invests its own assets on its own model; see the investment parameters elsewhere.',
      }],
      ['Default equity allocation', {
        value: R_MODEL.defaultEquityAllocation, unit: 'of investable assets', basis: 'CHOSEN',
        notYetUsed: true, status: 'SUPERSEDED', what: 'The default equity share.',
        note: 'The game\'s allocation is a player decision across cash, bonds and equities.',
      }],
      ['Expected equity return', {
        value: R_MODEL.expectedEquityReturn, unit: 'per year', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED', what: 'Mean equity return.', note: 'The game\'s investment model sets its own.',
      }],
      ['Equity return SD', {
        value: R_MODEL.equityReturnSD, unit: 'per year', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED', what: 'Equity return standard deviation.',
        note: 'The game\'s investment model sets its own.',
      }],
      ['Fixed income return', {
        value: R_MODEL.fixedIncomeReturn, unit: 'per year', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED', what: 'The fixed-income leg\'s flat return.',
        note: 'The game\'s investment model sets its own.',
      }],
      ['Investment period', {
        value: R_MODEL.investmentPeriodYears, unit: 'years', basis: 'CHOSEN', notYetUsed: true,
        status: 'NOT USED', what: 'How long each year\'s investment is held.',
      }],
      ['General-tab legacy fields', {
        value: `$${(R_MODEL.generalInitialInvestments / 1e6).toFixed(0)}M · `
          + `${(R_MODEL.generalLegacyInvestmentReturn * 100).toFixed(1)}% · `
          + `${(R_MODEL.generalLegacyInvestmentReturnSD * 100).toFixed(1)}% SD`,
        unit: 'dollars, per year', basis: 'CHOSEN', notYetUsed: true, status: 'NOT USED',
        what: 'Initial investments and a legacy return, from the workbook\'s General tab.',
        note: 'The R model itself marks these unused — superseded there by its Investment Return tab.',
      }],

      // ---- lines ----
      ['Base premium', {
        value: `GL $${(R_MODEL.basePremium.GL / 1e6).toFixed(1)}M · `
          + `WC $${(R_MODEL.basePremium.WC / 1e6).toFixed(1)}M · `
          + `Property $${(R_MODEL.basePremium.Property / 1e6).toFixed(1)}M`,
        unit: 'dollars', basis: 'CHOSEN', notYetUsed: true, status: 'ADOPTED',
        what: 'The model\'s premium for each line.',
        note: 'Kept for ONE job: the denominator that scales T per line. See the T shocks row.',
      }],
      ['Target loss ratio', {
        value: `GL ${R_MODEL.targetLossRatio.GL} · WC ${R_MODEL.targetLossRatio.WC} · `
          + `Property ${R_MODEL.targetLossRatio.Property}`,
        unit: 'of premium', basis: 'CHOSEN', notYetUsed: true, status: 'NOT USED',
        what: 'Expected loss as a share of premium, per line.',
        note: 'The game derives expected loss from its own exposure and pure premium, not from a target.',
      }],

      // ---- A / T / R ----
      ['A shocks — GL', {
        value: rLevels(R_MODEL.aShock.GL), unit: 'increase on ordinary losses', basis: 'CHOSEN',
        notYetUsed: true, status: 'ADOPTED',
        what: 'Drawn uniformly within the level\'s range, then decayed over the event\'s duration.',
        note: 'Illustrative, says the data scientist — not fitted to claims data.',
      }],
      ['A shocks — WC', {
        value: rLevels(R_MODEL.aShock.WC), unit: 'increase on ordinary losses', basis: 'CHOSEN',
        notYetUsed: true, status: 'ADOPTED', what: 'As GL, with WC\'s own High range.',
      }],
      ['A shocks — Property', {
        value: rLevels(R_MODEL.aShock.Property), unit: 'increase on ordinary losses', basis: 'CHOSEN',
        notYetUsed: true, status: 'ADOPTED', what: 'The widest of the three, up to a doubling.',
      }],
      ['T shocks — GL', {
        value: rLevels(R_MODEL.tShock.GL, false), unit: 'dollars at onset', basis: 'CHOSEN',
        notYetUsed: true, status: 'ADOPTED, SCALED',
        what: 'An aggregate shock loss at the event\'s start, drawn uniformly.',
        note: '⚠ SCALED PER LINE, by that line\'s own premium ratio — the game\'s premium for the line '
          + 'against the R model\'s base premium for the SAME line, never one pool-wide factor. The '
          + 'model\'s Property book is $4.5M and its GL book $7M, so a single factor would scale them '
          + 'unevenly. In the game T also arrives as large INDIVIDUAL losses, not a lump sum, so '
          + 'occurrence reinsurance can respond to it.',
      }],
      ['T shocks — WC', {
        value: rLevels(R_MODEL.tShock.WC, false), unit: 'dollars at onset', basis: 'CHOSEN',
        notYetUsed: true, status: 'ADOPTED, SCALED', what: 'As GL, scaled by WC\'s own premium ratio.',
      }],
      ['T shocks — Property', {
        value: rLevels(R_MODEL.tShock.Property, false), unit: 'dollars at onset', basis: 'CHOSEN',
        notYetUsed: true, status: 'ADOPTED, SCALED',
        what: 'The largest of the three, scaled by Property\'s own premium ratio.',
      }],
      ['R shocks', {
        value: rLevels(R_MODEL.rShock), unit: 'on outstanding prior-year reserves', basis: 'CHOSEN',
        notYetUsed: true, status: 'ADOPTED',
        what: 'An extra adverse rate on prior years\' outstanding reserves, drawn uniformly and decayed.',
        note: 'Illustrative, says the data scientist — not fitted to claims data.',
      }],

      // ---- catalogue and map ----
      ['Shock catalogue', {
        value: `${R_MODEL.catalogue.length} events`, unit: 'probability, duration, regional',
        basis: 'CHOSEN', notYetUsed: true, status: 'ADOPTED',
        what: 'Earthquake 0.2%/1y regional · Winterstorm 6%/1y regional · Wildfire 3.5%/1y regional · '
          + 'Legislation 1.5%/3y · WC Reform 2%/3y · Recession 6%/2y · Nuclear Verdict 2.5%/1y · '
          + 'Social Inflation 4.5%/3y · Pandemic 1%/2y · Economic Inflation 10%/3y · '
          + 'Investment Loss 4%/1y · Member Withdrawal 2%/2y.',
        note: 'Probabilities are ADOPTED for SINGLEPLAYER draws only — in multiplayer the host schedules '
          + 'events and no probability is consulted. Durations and regional flags adopted throughout.',
      }],
      ['Shock map', {
        value: `${R_MODEL.shockMap.length} event-line pairs`, unit: 'A / T / R level', basis: 'CHOSEN',
        notYetUsed: true, status: 'ADOPTED',
        what: 'Earthquake: GL Mid/–/– · WC High/–/– · Property High/High/–. Winterstorm: Property '
          + 'High/Low/–. Wildfire: Property Low/High/–. Legislation: GL Mid/–/High. WC Reform: WC '
          + 'High/–/Mid. Recession: GL Low/–/– · WC Low/–/–. Nuclear Verdict: GL –/High/Mid. '
          + 'Social Inflation: GL High/Low/Mid. Pandemic: GL –/Mid/– · WC High/High/–.',
        note: 'Which line each event touches, and at what level on each of the three channels.',
      }],

      // ---- superseded structure ----
      ['Reinsurance terms', {
        value: 'GL $5M xs $5M @ 15% · WC $4M xs $4.5M @ 13% · Property $7M xs $3.5M @ 16%',
        unit: 'limit xs attachment, rate on line', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'A single AGGREGATE stop on each line\'s annual loss, priced at a rate on line.',
        note: 'The game prices OCCURRENCE layers at expected layer loss x CLF at 70%, which is why T '
          + 'has to arrive as individual losses rather than one aggregate number.',
      }],
      ['Payout patterns', {
        value: `GL ${R_MODEL.paidCumulative.GL.length}y · WC ${R_MODEL.paidCumulative.WC.length}y · `
          + `Property ${R_MODEL.paidCumulative.Property.length}y`,
        unit: 'cumulative paid share by development year', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'GL 15/30/43/55/65/73/80/86/90/94/97/99/100%. '
          + 'WC 10/20/30/38/45/51/57/62/67/70/73/76/78/80/82/84/86/88/94/100%. '
          + 'Property 55/75/87/94/98/100%.',
        note: 'Illustrative, says the data scientist — not fitted to claims data. The game uses the '
          + 'RECORDED paid and incurred patterns, which are: WC 37 years, GL 21, Property 11.',
      }],
      ['Routine reserve development', {
        value: `mean ${R_MODEL.routineDevelopmentMean.toFixed(2)} · SD ${R_MODEL.routineDevelopmentSD}`,
        unit: 'on beginning outstanding reserves', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'A normal draw applied each year to each prior year\'s outstanding reserves.',
        note: 'Illustrative, says the data scientist — not fitted to claims data. Removed: development '
          + 'comes from the host\'s development setting and from the R-type reserve shocks, and from '
          + 'nothing else.',
      }],
    ],
  },
];
