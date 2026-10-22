import { defaultReinsuranceOption } from './reinsuranceOptions';
import { NEW_BUSINESS_REJECTION_SLIDER, RENEWALS_DECLINED_SLIDER } from '../data/pricingParameters';
// Single source of truth for default decisions. Used by the App (new game /
// next year), the Decisions page (per-line reset), and the Stage 2.10 pre-game
// history simulation — so the "steadily managed before the player took over"
// pre-game years can never drift from the in-game defaults.
import { SLIDER_RANGES, ASSET_ALLOCATION_DEFAULT } from '../data/defaultAssumptions';
import type { CoverageLine, DecisionSet, LineDecisionSet } from '../types/simulation';

// Fresh object per call (allocation is nested, so lines must not share a reference).
/** `shocks`: the game's shock switch (shockLosses.gameShocksOn) — the default cover follows it. Absent is on. */
export function defaultLineDecisionSet(line: CoverageLine, shocks = true): LineDecisionSet {
  return {
    fundingConfidenceLevel: SLIDER_RANGES.fundingConfidenceLevel.default,
    // Default TRUE for every line, and no longer inert on any of them: all
    // three now default to "fund exactly at expected loss", the same CONCEPT on
    // each, rather than a per-line percentage stop (WC at 60%, GL at 65% — two
    // numbers that meant two different, both wrong, things before their own
    // derived tables existed). Property was the last line for which this flag
    // did nothing; its derived table crosses at 52.8%, not 60%, so it now
    // carries the same meaning here as on WC and GL.
    fundingAtExpected: true,
    // Renew everyone. A pool that declines by default would be making an
    // underwriting decision nobody took.
    renewalsDeclined: RENEWALS_DECLINED_SLIDER.default,
    /**
     * ⚠ REJECT NOBODY — AND SO, UNLIKE THE INTAKE POSITIONS THIS REPLACES, THE
     * BOOK GROWS BY DEFAULT. Applicants arrive at NEW_BUSINESS_APPLICATIONS of
     * the book a year whatever the team decides; the slider only turns a share
     * of them away. At 0% every applicant joins and carries the full 20%
     * first-year penalty. The old default wrote nobody, so a player who touched
     * nothing played a frozen book; on uw-hybrid they play a growing one.
     * The pre-game is unaffected: it moves nothing (freezeMembership).
     */
    newBusinessRejection: NEW_BUSINESS_REJECTION_SLIDER.default,
    dividendPct: SLIDER_RANGES.dividendPct.default,
    assessmentPct: SLIDER_RANGES.assessmentPct.default,
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
    // Spend nothing on incentives. The field is STORED AND UNREAD — see
    // LineDecisionSet.riskControlIncentivePct — so this is what the slider
    // opens on, not a value the engine consumes.
    riskControlIncentivePct: SLIDER_RANGES.riskControlIncentivePct.default,
    // The default reinsurance package — the middle option, a chosen parameter
    // (REINSURANCE_DEFAULT_OPTION). The pre-game's prior board plays these
    // decisions, so the opening is built on it too.
    // ⚠ NONE WHILE THE GAME'S SHOCKS ARE OFF (AGGREGATE_STOP_DEFAULT_SHOCKS_OFF).
    reinsuranceOption: defaultReinsuranceOption(line, shocks),
    assetAllocation: { ...ASSET_ALLOCATION_DEFAULT },
    loanRepaymentAggressiveness: 0.5,
  };
}

/** `shocks`: the game's shock switch (shockLosses.gameShocksOn) — the default cover follows it. Absent is on. */
export function defaultDecisionSet(yearNumber: number, shocks = true): DecisionSet {
  return {
    yearNumber,
    byLine: {
      WC: defaultLineDecisionSet('WC', shocks),
      GL: defaultLineDecisionSet('GL', shocks),
      Property: defaultLineDecisionSet('Property', shocks),
    },
    // Pool-wide decisions (projected into every line at processYear entry).
    assetAllocation: { ...ASSET_ALLOCATION_DEFAULT },
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
    // ⚠ NO PROGRAM IS COMMITTED BY DEFAULT, AND THAT IS WHY THE BASELINES DO NOT
    // MOVE. An opt-in program that changed the default game would be an uncaused
    // change to every figure in the pool. The pre-game runs at these defaults
    // too, so the opening book is untouched by the program's existence.
    riskControlProgramIds: [],
  };
}
