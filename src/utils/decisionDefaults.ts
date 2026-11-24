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

/**
 * THE RESET: what every decision returns to at the start of each new round —
 * single player, Test player and hosted teams alike — so a team sets them again
 * each year rather than carrying the last year's into it. Funding at Expected;
 * no cover (per-occurrence none, aggregate none); New Members 0%, Non-Renewal
 * 0%, risk control 0%, no dividend or assessment, no risk-control program; the
 * default asset mix (20% cash / 75% bonds / 5% equities); loan repayment at its
 * default.
 *
 * ⚠ YEAR 1 TOO: the first round opens on the reset as well, not on
 * defaultDecisionSet (the prior board's 65% and covers, PLAY_DEFAULTS), which
 * now only the pre-game plays — so the opening position is unchanged, and the
 * year-1 rate drops from 2026's (at Expected with no cover, against the prior
 * board's 65% with its covers).
 *
 * ⚠ A HOSTED TEAM THAT DOES NOT LOCK A YEAR PLAYS THE RESET FOR IT
 * (session/client/decisions.ts decisionsForYear), and the market counts it at
 * the rate the reset strikes. Its last locked set no longer carries.
 *
 * Spelled out field by field rather than derived from atExpectedDecisionSet:
 * that is the scenarios' opening measure, and a change to it must not move the
 * reset.
 */
export function resetDecisionSet(yearNumber: number, shocks = true): DecisionSet {
  const d = defaultDecisionSet(yearNumber, shocks);
  for (const line of Object.keys(d.byLine) as CoverageLine[]) {
    const l = d.byLine[line];
    l.fundingAtExpected = true;
    l.reinsuranceOption = 'none';
    l.aggregateCover = 'none';
    l.nonRenewal = 0;
    l.newMembers = 0;
    l.riskControlPct = 0;
    l.riskControlIncentivePct = 0;
    l.dividendAmount = 0;
    l.assessmentAmount = 0;
    l.assetAllocation = { cashPct: 20, bondsPct: 75, equitiesPct: 5 };
  }
  d.assetAllocation = { cashPct: 20, bondsPct: 75, equitiesPct: 5 };
  d.riskControlPct = 0;
  d.riskControlProgramIds = [];
  return d;
}

/** What round `yearNumber` opens on: the reset, every round, year 1 included. */
export function roundStartDecisions(yearNumber: number, shocks = true): DecisionSet {
  return resetDecisionSet(yearNumber, shocks);
}
