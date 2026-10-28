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
// ⚠ THE PURE PREMIUM IS STATED AT THE CURRENT YEAR'S RATE LEVEL — the year in
// progress, the one before the year priced (2026 when 2027 is priced). Trended
// average losses are that year's exposure x the average trended loss cost (Loss
// & LAE per $100, each window year trended to the current year): pricing
// averages each year's loss cost with equal weight, so the average loss COST is
// what reproduces it exactly whether or not the book has moved. Divided by that
// exposure it is the indicated pure premium at the current year's level, and x
// one year's annual trend it is the projected pure premium for the program year
// — pricing's own figure, shown as pricing struck it.
//
// ⚠ THE RATE IS THE PROJECTED PURE PREMIUM / THE PERMISSIBLE LOSS RATIO, the
// permissible loss ratio being 100% less the total expense ratio — admin at its
// share of premium (ADMIN_SHARE_OF_PREMIUM, 20%, the same every year) and risk
// control (off). At Expected with no cover the two are the same figure exactly.
// NO INVESTMENT INCOME LINE: investment income does not touch the rate. Other
// funding levels scale the claims by their CLF, and admin stays its share of
// the rate that results, so each is the quote's own rate.
//
// ⚠ NOTHING HERE IS SHOWN AS METHOD. The page prints labels and figures only
// (docs/PENDING_MULTIPLAYER.md: players never see how the engine works).
// ============================================================================
import { ADMIN_SHARE_OF_PREMIUM, AGGREGATE_STOP_OPTIONS, RATE_INDICATION_FUNDING_LEVELS } from '../data/pricingParameters';
import { gameHistory } from './gameHistory';
import { computeFundingConsequence } from './fundingConsequence';
import { effectiveRiskControlIncentivePct, quoteNewRateStack } from './linePricing';
import { lossCostTrendPerYear } from './newPurePremium';
import { AGGREGATE_NOT_OFFERED, placementFor, reinsuranceOptionIds } from './reinsuranceOptions';
import { gameShocksOn } from './shockLosses';
import { selectedClfFor } from './simulationEngine';
import { fundingConsequenceInput } from '../game/derivations';
import type { CoverageLine, DecisionSet, GameState, LineDecisionSet, LineResultSet } from '../types/simulation';
import { eventLikelihoods } from './eventLikelihoods';
import { pricedGrowthFactor } from './reinsuranceTower';
import type { Book } from './lineHelpers';
import type { TowerLine } from '../data/reinsuranceTower';

/** A funding position: Expected, or a confidence level. */
export type FundingPosition = 'expected' | number;

/** What a year's pricing gives at one position and cover. */
interface Priced { finalRatePer100: number; adminRatePer100: number; reinsRatePer100: number }

export interface RateIndication {
  line: CoverageLine;
  yearNumber: number;
  calendarYear: number;
  pure: {
    /** Window years — the row's count. 0: none (no figures). */
    windowYears: number;
    /** The current year, a calendar year: the rate level the losses are stated at (2026 for 2027). */
    rateLevelYear: number;
    /** The window's losses trended to the current year, at the current year's exposure. */
    trendedAverageLosses: number;
    /** The current year's exposure, $M. */
    exposure: number;
    /** At the current year's rate level: trended average losses / exposure, per $100. */
    purePremiumPer100: number;
    /** 1.04 is +4%. */
    annualTrend: number;
    /** Pricing's own projected pure premium for the priced year: the above x one year's trend. */
    projectedPer100: number;
  };
  /** The rate at Expected (projected pure premium / permissible loss ratio) over the current year's rate, - 1; null with none. */
  indicatedRateChange: number | null;
  /** The rate at Expected, self-funded: projected pure premium / permissible loss ratio. */
  indicatedRatePer100: number;
  /** Shares of the rate at Expected. */
  expenses: {
    admin: number; riskControl: number;
    totalAdmin: number; permissibleLossRatio: number;
  };
  currentPer100: number | null;
  positions: { position: FundingPosition; ratePer100: number; change: number | null }[];
  reinsurance: { id: string; name: string; pricePer100: number }[];
  /**
   * EVENT LIKELIHOODS (utils/eventLikelihoods): the size of a single large (T)
   * claim at 1 in 10 to 1 in 200 years for the year priced, at the growth
   * factor its cover prices use; null when the game's shocks are off.
   */
  eventLikelihoods: { years: number; size: number | null }[] | null;
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
    members: { exposure: ratedExposure, ...(rateBasis.risk !== undefined ? { risk: rateBasis.risk } : {}) } as Book,
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
  const members: Book = { exposure: ratedExposure, ...(rateBasis.risk !== undefined ? { risk: rateBasis.risk } : {}) };
  return { lr, rateBasis, ratedExposure, newPurePremiumPer100, d, price, chosen, members };
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
  let windowYears: number;
  let reinsuranceAt: FundingPosition;
  // The book the cover prices are quoted on, so the likelihoods grow by its factor.
  let coverBook: Book;

  if (coming) {
    const d = decisions.byLine[line];
    const prior = gs.poolState.lines[line].ratePer100;
    price = (p, option) => computeFundingConsequence(
      p === 'expected' ? d.fundingConfidenceLevel : p, prior, line, p === 'expected',
      fundingConsequenceInput(gs, line, decisions, option).book,
    ).newStack ?? null;
    const { purePremium } = fundingConsequenceInput(gs, line, decisions, 'none');
    if (!purePremium) return null;
    projected = purePremium.purePremiumPer100;
    windowYears = purePremium.points.length;
    reinsuranceAt = d.fundingAtExpected ? 'expected' : d.fundingConfidenceLevel;
    coverBook = fundingConsequenceInput(gs, line, decisions, 'none').book;
  } else {
    const past = pastPricer(gs, line, yearNumber);
    if (!past) return null;
    price = past.price;
    projected = past.newPurePremiumPer100;
    windowYears = past.rateBasis.windowYears;
    reinsuranceAt = past.chosen;
    coverBook = past.members;
  }

  const atExpected = price('expected', 'none');
  if (!atExpected) return null;

  // THE PURE PREMIUM: the projected figure is pricing's; the rest follow from
  // it, at the current year's rate level, one year of trend before the priced
  // year, on the current year's exposure (its row).
  const annualTrend = lossCostTrendPerYear(line);
  const purePremiumPer100 = projected / annualTrend;
  const currentRow = gameHistory(gs).find(x => x.yearNumber === yearNumber - 1)?.byLine[line];
  const currentExposure = currentRow ? (currentRow.billedExposure ?? currentRow.activeExposure) : 0;

  // THE EXPENSES, as shares of the rate at Expected: admin's share of premium —
  // the parameter itself, the same every year — and risk control.
  const admin = ADMIN_SHARE_OF_PREMIUM[line];
  const riskControl = effectiveRiskControlIncentivePct(coming ? decisions.byLine[line]
    : gs.lockedResults.find(x => x.yearNumber === yearNumber)!.byLine[line]!.decisions);
  const totalAdmin = admin + riskControl;

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
      rateLevelYear: calendarOf(gs, yearNumber) - 1,
      trendedAverageLosses: purePremiumPer100 * currentExposure * 10_000,
      exposure: currentExposure,
      purePremiumPer100,
      annualTrend,
      projectedPer100: projected,
    },
    indicatedRateChange: positions[0].change,
    indicatedRatePer100: projected / (1 - totalAdmin),
    expenses: {
      admin, riskControl, totalAdmin, permissibleLossRatio: 1 - totalAdmin,
    },
    currentPer100,
    positions,
    reinsurance,
    eventLikelihoods: shocks ? eventLikelihoods(line, pricedGrowthFactor(line as TowerLine, coverBook, yearNumber)) : null,
  };
}
