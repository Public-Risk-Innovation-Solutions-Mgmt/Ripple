// ============================================================================
// THE RATE INDICATION — each line's rate for the coming year, laid out the way
// an actuary indicates it: the experience, the expenses as shares of the rate,
// the indication at Expected and at other funding levels, and each cover's
// price. Display only.
//
// ⚠ EVERY FIGURE IS THE ENGINE'S OWN PRICING, NEVER A SECOND CALCULATION. The
// rates come from computeFundingConsequence on the Decisions panel's own input
// (fundingConsequenceInput), and the experience from the same pure premium
// result that input carries. So the indicated rate at Expected plus a cover's
// price is the rate the panel charges, at every funding position; the
// rate-indication driver holds that on every line.
//
// ⚠ THE PERMISSIBLE LOSS RATIO IS PER FUNDING POSITION. Admin is charged in
// dollars, not as a share of the rate — fixed per year plus per $100 of
// exposure — and the CLF does not scale it: the rate is (pure premium x CLF +
// admin) / (1 - risk control - contingency). So admin's share of the rate, and
// the permissible loss ratio with it, is that position's own; with it, rate =
// pure premium x CLF / permissible loss ratio exactly, at every position.
// ============================================================================
import {
  ADMIN_FIXED_PER_YEAR, AGGREGATE_STOP_OPTIONS, PROFIT_AND_CONTINGENCY_OF_RATE, RATE_INDICATION_FUNDING_LEVELS,
} from '../data/pricingParameters';
import { computeFundingConsequence } from './fundingConsequence';
import { effectiveRiskControlIncentivePct } from './linePricing';
import { lossCostTrendPerYear } from './newPurePremium';
import { reinsuranceOptionIds } from './reinsuranceOptions';
import { gameShocksOn } from './shockLosses';
import { fundingConsequenceInput } from '../game/derivations';
import type { CoverageLine, DecisionSet, GameState, LineResultSet } from '../types/simulation';

export interface RateIndication {
  line: CoverageLine;
  /** The year being priced, and its calendar year. */
  yearNumber: number;
  calendarYear: number;
  /** The five-year average of the program years in the pricing window; null before the ledger has one. */
  experience: {
    years: number;
    /** Developed to ultimate as pricing develops it, with ALAE and ULAE — the window's average, dollars. */
    lossAndLae: number;
    /** The window's average, $M. */
    exposure: number;
    /** Loss & LAE / exposure, per $100. */
    purePremiumPer100: number;
    /** The loss-cost trend a year (1.04 is +4%). */
    annualTrend: number;
    /** Projected / pure premium: the trend to the coming year, as pricing applies it year by year. */
    trendFactor: number;
    /** Pricing's own figure — the rate's pure premium. */
    projectedPer100: number;
  } | null;
  /** The pure premium the rate is struck on (before reinsurance), per $100. */
  purePremiumPer100: number;
  expenses: {
    fixedAdmin: number; perExposureAdmin: number; riskControl: number; contingency: number;
    totalAdmin: number; permissibleLossRatio: number;
  };
  atExpected: { indicatedPer100: number; currentPer100: number | null; change: number | null };
  positions: { level: number; clf: number; permissibleLossRatio: number; indicatedPer100: number; change: number | null }[];
  reinsurance: { id: string; name: string; pricePer100: number }[];
}

/** Last year's struck rate before its cover's price — the rate in force, before reinsurance. */
function currentRateBeforeReinsurance(gs: GameState, line: CoverageLine): number | null {
  const last: LineResultSet | undefined = gs.lockedResults.length > 0
    ? gs.lockedResults[gs.lockedResults.length - 1].byLine[line]
    : gs.priorHistory[gs.priorHistory.length - 1]?.byLine[line];
  if (!last || last.finalRatePer100 === undefined || !(last.activeExposure > 0)) return null;
  // The cover is struck at one rate per $100 for the team-year, so the averaged
  // cost over the averaged exposure is that rate.
  return last.finalRatePer100 - last.reinsuranceCost / (last.activeExposure * 10_000);
}

export function buildRateIndication(gs: GameState, line: CoverageLine, decisions: DecisionSet): RateIndication | null {
  const d = decisions.byLine[line];
  const prior = gs.poolState.lines[line].ratePer100;
  const at = (level: number, atExpected: boolean, option: string) =>
    computeFundingConsequence(level, prior, line, atExpected, fundingConsequenceInput(gs, line, decisions, option).book);
  const { book, purePremium } = fundingConsequenceInput(gs, line, decisions, 'none');
  const expected = at(d.fundingConfidenceLevel, true, 'none').newStack;
  if (!expected || !purePremium) return null;

  // THE EXPENSES, as shares of the rate at Expected.
  const pp = expected.purePremiumRetained;
  const rateAtExpected = expected.finalRatePer100;
  const fixedPer100 = ADMIN_FIXED_PER_YEAR[line] / Math.max(book.exposure * 10_000, 1);
  const perExposurePer100 = expected.adminRatePer100 - fixedPer100;
  const riskControl = effectiveRiskControlIncentivePct(d);
  const contingency = PROFIT_AND_CONTINGENCY_OF_RATE;
  const share = (per100: number, rate: number) => per100 / rate;
  const totalAt = (rate: number) => share(expected.adminRatePer100, rate) + riskControl + contingency;
  const totalAdmin = totalAt(rateAtExpected);

  // THE EXPERIENCE: the window's averages, and pricing's projected figure.
  const pts = purePremium.points;
  const lae = purePremium.lossCostPer100 > 0 ? purePremium.purePremiumPer100 / purePremium.lossCostPer100 : 1;
  const experience = pts.length === 0 ? null : (() => {
    const lossAndLae = pts.reduce((a, p) => a + p.developed, 0) / pts.length * lae;
    const exposure = pts.reduce((a, p) => a + p.exposure, 0) / pts.length;
    const ppPer100 = lossAndLae / (exposure * 10_000);
    return {
      years: pts.length, lossAndLae, exposure, purePremiumPer100: ppPer100,
      annualTrend: lossCostTrendPerYear(line), trendFactor: purePremium.purePremiumPer100 / ppPer100,
      projectedPer100: purePremium.purePremiumPer100,
    };
  })();

  const current = currentRateBeforeReinsurance(gs, line);
  const change = (rate: number) => (current && current > 0 ? rate / current - 1 : null);

  const positions = RATE_INDICATION_FUNDING_LEVELS.map(level => {
    const q = at(level, false, 'none');
    const rate = q.newStack!.finalRatePer100;
    const permissible = 1 - totalAt(rate);
    return { level, clf: q.clf, permissibleLossRatio: permissible, indicatedPer100: pp * q.clf / permissible, change: change(pp * q.clf / permissible) };
  });

  const shocks = gameShocksOn(gs.setup, gs.instance);
  const reinsurance = reinsuranceOptionIds(line, shocks).map(id => ({
    id,
    name: AGGREGATE_STOP_OPTIONS.find(o => o.id === id)?.name ?? id,
    pricePer100: at(d.fundingConfidenceLevel, d.fundingAtExpected, id).newStack!.reinsRatePer100,
  }));

  const indicated = pp / (1 - totalAdmin);
  return {
    line,
    yearNumber: gs.currentYearNumber,
    calendarYear: gs.setup.startingYear + gs.currentYearNumber - 1,
    experience,
    purePremiumPer100: pp,
    expenses: {
      fixedAdmin: share(fixedPer100, rateAtExpected),
      perExposureAdmin: share(perExposurePer100, rateAtExpected),
      riskControl, contingency, totalAdmin, permissibleLossRatio: 1 - totalAdmin,
    },
    atExpected: { indicatedPer100: indicated, currentPer100: current, change: change(indicated) },
    positions,
    reinsurance,
  };
}
