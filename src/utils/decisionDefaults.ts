import { defaultReinsuranceOption } from './reinsuranceOptions';
import { NEW_MEMBERS_SLIDER, NON_RENEWAL_SLIDER, PLAY_DEFAULTS } from '../data/pricingParameters';
import { aggregateCoverOptionIds } from './aggregateCover';
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
    // ⚠ 65% ON THE LINE'S OWN TABLE, NOT EXPECTED (pr/pregame-65; PLAY_DEFAULTS):
    // the prior board's level (PRIOR_BOARD), carried into year 1 and every year
    // after until the team moves it, so the first played year continues the
    // history's margin rather than dropping it. Was "fund exactly at expected
    // loss" on every line.
    fundingConfidenceLevel: PLAY_DEFAULTS.fundingLevel,
    fundingAtExpected: false,
    // Renew everyone, add no one. A pool that moves its book by default would
    // be making an underwriting decision nobody took — so, unlike uw-hybrid's
    // 0% rejection, the book stands still unless the team moves it.
    nonRenewal: NON_RENEWAL_SLIDER.default,
    newMembers: NEW_MEMBERS_SLIDER.default,
    dividendAmount: SLIDER_RANGES.dividendAmount.default,
    assessmentAmount: SLIDER_RANGES.assessmentAmount.default,
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
    // Spend nothing on incentives. The field is STORED AND UNREAD — see
    // LineDecisionSet.riskControlIncentivePct — so this is what the slider
    // opens on, not a value the engine consumes.
    riskControlIncentivePct: SLIDER_RANGES.riskControlIncentivePct.default,
    // The default covers — the prior board's, carried (PLAY_DEFAULTS): per-claim
    // $19M xs $1M (REINSURANCE_DEFAULT_OPTION) and the aggregate cover 125% / 50%.
    // The pre-game's prior board plays these too, so the opening is built on them.
    // ⚠ NONE WHERE A COVER IS NOT OFFERED (COVERS_IN_EVERY_GAME off, shocks off).
    reinsuranceOption: defaultReinsuranceOption(line, shocks),
    aggregateCover: aggregateCoverOptionIds(shocks).includes(PLAY_DEFAULTS.aggregateCover) ? PLAY_DEFAULTS.aggregateCover : 'none',
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

/**
 * THE OPENING'S MEASURE: the defaults at EXPECTED with no cover — the basis the
 * scenarios' opening premium to surplus is stated and their seeds were chosen
 * on (SCENARIO_SEEDS), kept as it was when Expected and None were the
 * defaults. Read by openingYear1Premium and the scenario gates; a team never
 * holds it unless it chooses it.
 */
export function atExpectedDecisionSet(yearNumber: number, shocks = true): DecisionSet {
  const d = defaultDecisionSet(yearNumber, shocks);
  for (const line of Object.keys(d.byLine) as CoverageLine[]) {
    d.byLine[line].fundingAtExpected = true;
    d.byLine[line].reinsuranceOption = 'none';
    d.byLine[line].aggregateCover = 'none';
  }
  return d;
}
