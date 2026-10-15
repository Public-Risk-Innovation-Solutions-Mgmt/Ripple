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
}

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

/** Wage inflation, the exposure base's own trend. */
export const WAGE_INFLATION_PER_YEAR_PARAM = 0.0363;

/** WC severity trend. WCIRB blended: 52% medical @ 3.70%, 48% indemnity @ 3.63%. */
export const WC_SEVERITY_TREND_PER_YEAR_PARAM = 0.0367;

/** WC frequency trend — a DECLINE. */
export const WC_FREQUENCY_TREND_PER_YEAR = -0.015;

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
    title: 'Trend',
    blurb: 'Read by the HELD pricing path only. The experience path applies no trend at all.',
    entries: [
      ['WC frequency trend', {
        value: WC_FREQUENCY_TREND_PER_YEAR, unit: 'per year',
        what: 'A decline. Multiplies WC\'s held pure premium.', basis: 'SOURCED',
        note: 'Pairs with the severity trend and wage inflation; together the rate trend is ~-1.46%/yr.',
      }],
      ['WC severity trend', {
        value: WC_SEVERITY_TREND_PER_YEAR_PARAM, unit: 'per year',
        what: 'Trends WC claim severity.', basis: 'SOURCED',
        note: 'WCIRB blended: 52% medical @ 3.70%, 48% indemnity @ 3.63%.',
      }],
      ['Wage inflation', {
        value: WAGE_INFLATION_PER_YEAR_PARAM, unit: 'per year',
        what: 'Grows the exposure base. Applies to WC and GL, not Property.', basis: 'SOURCED',
      }],
      ['GL severity trend', {
        value: 'derived from the GL severity mix', unit: 'per year',
        what: 'glCappedSeverityTrend — the capped expected severity relative to year 1.', basis: 'SOURCED',
        note: 'Computed in glClaimEngine.ts rather than held as a scalar, so it is registered and not moved.',
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
];
