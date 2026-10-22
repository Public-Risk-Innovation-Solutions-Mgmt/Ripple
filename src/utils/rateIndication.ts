// ============================================================================
// THE RATE INDICATION — each line's rate for a program year, laid out the way
// an actuary indicates it: the pure premium, the expenses as shares of the
// rate, and the indication at Expected and at other funding levels, with each
// cover's price below. Display only.
//
// ⚠ EVERY FIGURE IS THE ENGINE'S OWN PRICING, NEVER A SECOND CALCULATION.
//   The coming year   computeFundingConsequence on the Decisions panel's own
//                     input (fundingConsequenceInput), so each indicated rate
//                     is the rate the panel charges at that level.
//   A played year     quoteNewRateStack — the call strikeBookRate makes — on
//                     what that year was struck on: its pure premium and book
//                     (newPurePremiumPer100, ratedExposure), its decisions as
//                     echoed on the row, and its rateBasis (the book's risk and
//                     the window), stored when the year settled. So the
//                     indicated rate at the level chosen plus the cover bought
//                     is the rate charged that year.
//   The rate-indication driver holds both, on every line, solo and hosted.
//
// ⚠ TRENDED AVERAGE LOSSES ARE THE AVERAGE EXPOSURE x THE AVERAGE TRENDED LOSS
// COST (Loss & LAE per $100, each window year trended to the latest one).
// Pricing averages each year's loss cost with equal weight, so this is what
// reproduces it exactly whether or not the book has moved; the plain average
// of the dollars would miss it by up to ~0.1% once a renewal cut moves the
// book. With the window ending the year before the one priced, the average
// trended to the latest year is the projected pure premium over one year's
// trend. (The catastrophe load is off; were it on, it would sit in this figure.)
//
// ⚠ THE PERMISSIBLE LOSS RATIO IS AT EXPECTED. Admin is charged in dollars and
// the CLF does not scale it, so each funding level has its own share; every
// indicated rate is the quote's own, not pure premium / one permissible ratio.
//
// ⚠ NOTHING HERE IS SHOWN AS METHOD. The page prints labels and figures only
// (docs/PENDING_MULTIPLAYER.md: players never see how the engine works).
// ============================================================================
import {
  ADMIN_FIXED_PER_YEAR, AGGREGATE_STOP_OPTIONS, PROFIT_AND_CONTINGENCY_OF_RATE, RATE_INDICATION_FUNDING_LEVELS,
} from '../data/pricingParameters';
import { computeFundingConsequence } from './fundingConsequence';
import { effectiveRiskControlIncentivePct, quoteNewRateStack } from './linePricing';
import { lossCostTrendPerYear } from './newPurePremium';
import { AGGREGATE_NOT_OFFERED, placementFor, reinsuranceOptionIds } from './reinsuranceOptions';
import { gameShocksOn } from './shockLosses';
import { selectedClfFor } from './simulationEngine';
import { fundingConsequenceInput } from '../game/derivations';
import type { CoverageLine, DecisionSet, GameState, LineDecisionSet, LineResultSet } from '../types/simulation';

/** A funding position: Expected, or a confidence level. */
export type FundingPosition = 'expected' | number;

/** What a year's pricing gives at one position and cover. */
interface Priced { finalRatePer100: number; adminRatePer100: number; reinsRatePer100: number }

export interface RateIndication {
  line: CoverageLine;
  yearNumber: number;
  calendarYear: number;
  pure: {
    /** Window years; fewer than five labels the row with the count. 0: none (no figures). */
    windowYears: number;
    trendedAverageLosses: number;
    /** $M. */
    exposure: number;
    purePremiumPer100: number;
    /** 1.04 is +4%. */
    annualTrend: number;
    projectedPer100: number;
  };
  /** Shares of the rate at Expected. */
  expenses: {
    fixedAdmin: number; perExposureAdmin: number; riskControl: number; contingency: number;
    totalAdmin: number; permissibleLossRatio: number;
  };
  currentPer100: number | null;
  positions: { position: FundingPosition; ratePer100: number; change: number | null }[];
  reinsurance: { id: string; name: string; pricePer100: number }[];
}

export interface IndicationYear { yearNumber: number; calendarYear: number }

const calendarOf = (gs: GameState, y: number) => gs.setup.startingYear + y - 1;

/** A played year can be rebuilt when every active line stored its basis. */
function rebuildable(gs: GameState, y: number): boolean {
  const r = gs.lockedResults.find(x => x.yearNumber === y);
  return !!r && gs.setup.activeLines.every(l => {
    const lr = r.byLine[l];
    return !!lr?.rateBasis && lr.ratedExposure !== undefined && lr.newPurePremiumPer100 !== undefined;
  });
}

/** The dropdown: every played year from year 1, then the coming year. */
export function rateIndicationYears(gs: GameState): IndicationYear[] {
  const out: IndicationYear[] = [];
  for (const r of gs.lockedResults) {
    if (r.yearNumber >= 1 && rebuildable(gs, r.yearNumber)) out.push({ yearNumber: r.yearNumber, calendarYear: calendarOf(gs, r.yearNumber) });
  }
  if (!gs.isComplete) out.push({ yearNumber: gs.currentYearNumber, calendarYear: calendarOf(gs, gs.currentYearNumber) });
  return out;
}

const asDecision = (d: LineDecisionSet, p: FundingPosition): LineDecisionSet => ({
  ...d,
  fundingCushion: undefined,
  fundingAtExpected: p === 'expected',
  fundingConfidenceLevel: p === 'expected' ? d.fundingConfidenceLevel : p,
});

/** A played year's pricing, rebuilt: the engine's quote on what the year was struck on. */
function pastPricer(gs: GameState, line: CoverageLine, yearNumber: number) {
  const lr = gs.lockedResults.find(x => x.yearNumber === yearNumber)?.byLine[line];
  if (!lr?.rateBasis || lr.ratedExposure === undefined || lr.newPurePremiumPer100 === undefined) return null;
  const { rateBasis, ratedExposure, newPurePremiumPer100, decisions: d } = lr;
  const shocks = gameShocksOn(gs.setup, gs.instance);
  const price = (p: FundingPosition, option: string): Priced => quoteNewRateStack({
    line,
    yearNumber,
    members: { exposure: ratedExposure, ...(rateBasis.risk !== undefined ? { risk: rateBasis.risk } : {}) },
    exposure: ratedExposure,
    groundUpPurePremiumPer100: newPurePremiumPer100,
    clf: selectedClfFor(line, asDecision(d, p)),
    riskControlPct: effectiveRiskControlIncentivePct(d),
    layersPlaced: placementFor(line, option),
    aggregateStopLevel: AGGREGATE_NOT_OFFERED,
    reinsuranceOption: option,
    shocks,
  });
  const chosen: FundingPosition = d.fundingAtExpected ? 'expected' : d.fundingConfidenceLevel;
  return { lr, rateBasis, ratedExposure, newPurePremiumPer100, d, price, chosen };
}

/**
 * The rate in force for `yearNumber` before reinsurance: last year's rate, at
 * the level chosen then, without its cover — rebuilt exactly when last year was
 * played; for year 1, the last pre-game year's struck rate less its cover's
 * cost over the exposure it was charged on (one book, one world).
 */
function currentRate(gs: GameState, line: CoverageLine, yearNumber: number): number | null {
  const past = yearNumber - 1 >= 1 ? pastPricer(gs, line, yearNumber - 1) : null;
  if (past) return past.price(past.chosen, 'none').finalRatePer100;
  const r: LineResultSet | undefined = [...gs.priorHistory, ...gs.lockedResults].find(x => x.yearNumber === yearNumber - 1)?.byLine[line];
  if (!r || r.finalRatePer100 === undefined || !(r.activeExposure > 0)) return null;
  return r.finalRatePer100 - r.reinsuranceCost / (r.activeExposure * 10_000);
}

export function buildRateIndication(
  gs: GameState, line: CoverageLine, decisions: DecisionSet, yearNumber: number = gs.currentYearNumber,
): RateIndication | null {
  const shocks = gameShocksOn(gs.setup, gs.instance);
  const coming = yearNumber === gs.currentYearNumber && !gs.isComplete;

  let price: (p: FundingPosition, option: string) => Priced | null;
  let projected: number;
  let exposure: number;
  let windowYears: number;
  let windowExposure: number;
  let reinsuranceAt: FundingPosition;

  if (coming) {
    const d = decisions.byLine[line];
    const prior = gs.poolState.lines[line].ratePer100;
    price = (p, option) => computeFundingConsequence(
      p === 'expected' ? d.fundingConfidenceLevel : p, prior, line, p === 'expected',
      fundingConsequenceInput(gs, line, decisions, option).book,
    ).newStack ?? null;
    const { book, purePremium } = fundingConsequenceInput(gs, line, decisions, 'none');
    if (!purePremium) return null;
    projected = purePremium.purePremiumPer100;
    exposure = book.exposure;
    windowYears = purePremium.points.length;
    windowExposure = windowYears > 0 ? purePremium.points.reduce((a, p) => a + p.exposure, 0) / windowYears : 0;
    reinsuranceAt = d.fundingAtExpected ? 'expected' : d.fundingConfidenceLevel;
  } else {
    const past = pastPricer(gs, line, yearNumber);
    if (!past) return null;
    price = past.price;
    projected = past.newPurePremiumPer100;
    exposure = past.ratedExposure;
    windowYears = past.rateBasis.windowYears;
    windowExposure = past.rateBasis.windowExposure;
    reinsuranceAt = past.chosen;
  }

  const atExpected = price('expected', 'none');
  if (!atExpected) return null;

  // THE PURE PREMIUM: the projected figure is pricing's; the rest follow from it.
  const annualTrend = lossCostTrendPerYear(line);
  const purePremiumPer100 = projected / annualTrend;

  // THE EXPENSES, as shares of the rate at Expected.
  const rateE = atExpected.finalRatePer100;
  const fixedPer100 = ADMIN_FIXED_PER_YEAR[line] / Math.max(exposure * 10_000, 1);
  const riskControl = effectiveRiskControlIncentivePct(coming ? decisions.byLine[line]
    : gs.lockedResults.find(x => x.yearNumber === yearNumber)!.byLine[line]!.decisions);
  const contingency = PROFIT_AND_CONTINGENCY_OF_RATE;
  const totalAdmin = atExpected.adminRatePer100 / rateE + riskControl + contingency;

  const currentPer100 = currentRate(gs, line, yearNumber);
  const change = (rate: number) => (currentPer100 && currentPer100 > 0 ? rate / currentPer100 - 1 : null);

  const positions = (['expected', ...RATE_INDICATION_FUNDING_LEVELS] as FundingPosition[]).map(position => {
    const rate = (position === 'expected' ? atExpected : price(position, 'none'))!.finalRatePer100;
    return { position, ratePer100: rate, change: change(rate) };
  });

  const reinsurance = reinsuranceOptionIds(line, shocks).map(id => ({
    id,
    name: AGGREGATE_STOP_OPTIONS.find(o => o.id === id)?.name ?? id,
    pricePer100: price(reinsuranceAt, id)?.reinsRatePer100 ?? 0,
  }));

  return {
    line,
    yearNumber,
    calendarYear: calendarOf(gs, yearNumber),
    pure: {
      windowYears,
      trendedAverageLosses: purePremiumPer100 * windowExposure * 10_000,
      exposure: windowExposure,
      purePremiumPer100,
      annualTrend,
      projectedPer100: projected,
    },
    expenses: {
      fixedAdmin: fixedPer100 / rateE,
      perExposureAdmin: (atExpected.adminRatePer100 - fixedPer100) / rateE,
      riskControl, contingency, totalAdmin, permissibleLossRatio: 1 - totalAdmin,
    },
    currentPer100,
    positions,
    reinsurance,
  };
}
