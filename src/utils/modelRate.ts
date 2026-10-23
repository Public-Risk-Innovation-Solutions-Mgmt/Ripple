// ============================================================================
// THE MODEL TAB'S FIGURES — every input to a year's rate, in order, and every
// year's expected figures against what the simulation produced. Solo only
// (src/game/tabs.tsx). Display only.
//
// ⚠ EVERY FIGURE IS THE ENGINE'S, NEVER A SECOND CALCULATION. Section A calls
// the functions the engine prices with — bookPurePremium on the line's ledger
// at the year's own book risk and exposure (its rateBasis), then
// quoteNewRateStack on the year's decisions, credit and shock switch, exactly
// as strikeBookRate and processLineYear do — and states the rate charged
// beside it from the year's row; the Model driver holds the two equal on every
// priced year. The steps between are the engine's own intermediate figures
// (the window's points, the loads, the credit, the CLF, admin, the cover's
// price), shown so each can be recomputed with a calculator.
// Section B reads each year's row: the expected loss the engine priced the
// year's claims on, the LAE shares it books at (laeShares), the expected
// market return net of fees (expectedMarketReturns), and the year's booked
// figures; the combined ratio is the Annual Statement's own.
// ============================================================================
import {
  ADMIN_BASE_YEAR, ADMIN_FIXED_PER_YEAR, ADMIN_PER_EXPOSURE_PER_100, ADMIN_TREND_PER_YEAR, PRICING_DATA_LAG_YEARS,
} from '../data/pricingParameters';
import { bookPurePremium, lossCostTrendPerYear, type NewPurePremiumResult } from './newPurePremium';
import { adminRatePer100For, adminTrendFactor, effectiveRiskControlIncentivePct, expenseDivisor, quoteNewRateStack } from './linePricing';
import { AGGREGATE_NOT_OFFERED, placementFor } from './reinsuranceOptions';
import { gameShocksOn } from './shockLosses';
import { selectedClfFor } from './simulationEngine';
import { gameHistory } from './investmentIncomeCredit';
import { laeShares } from './lossExpense';
import { blendInvestmentReturn, expectedMarketReturns } from './investmentEngine';
import { buildAnnualStatement, COMBINED_RATIO_LABEL } from './resultsStatement';
import { fundingConsequenceInput } from '../game/derivations';
import type { CoverageLine, DecisionSet, GameState, LineDecisionSet, LineResultSet } from '../types/simulation';

const calendarOf = (gs: GameState, y: number) => gs.setup.startingYear + y - 1;

/** The priced years, first pre-game year to the coming year. */
export function modelYears(gs: GameState): { yearNumber: number; calendarYear: number }[] {
  const ys = gameHistory(gs).map(r => r.yearNumber);
  if (!gs.isComplete) ys.push(gs.currentYearNumber);
  return ys.map(y => ({ yearNumber: y, calendarYear: calendarOf(gs, y) }));
}

export interface ModelWindowRow {
  accidentYear: number;
  valuationDate: string;
  paid: number;
  shockPaid: number;
  ageMonths: number;
  ldf: number;
  developed: number;
  /** $M. */
  exposure: number;
  lossCostPer100: number;
  yearsToLatest: number;
  trendToLatest: number;
  trendedToLatestPer100: number;
  /** The accident year's drawn ALAE ratio. */
  alaeRatio: number;
}

export interface ModelRate {
  line: CoverageLine;
  yearNumber: number;
  calendarYear: number;
  latestDataYear: number;
  window: ModelWindowRow[];
  /** With no usable history: the starting expected loss cost the rate is struck on. */
  noHistory: { lossCostPer100: number } | null;
  averageTrendedToLatestPer100: number | null;
  bookRisk: number;
  annualTrend: number;
  trendYears: number;
  trendToPriced: number;
  catastropheLoadPer100: number;
  projectedLossCostPer100: number;
  alaeShare: number;
  ulaeShare: number;
  alaePer100: number;
  ulaePer100: number;
  projectedPurePremiumPer100: number;
  credit: number;
  afterCreditPer100: number;
  /** The parameters as set, at the base year. */
  adminFixed: number;
  adminPerExposurePer100: number;
  /** (1 + trend)^(year - base year), and the two parts trended to the year. */
  adminTrend: { perYear: number; baseYear: number; years: number; factor: number };
  adminFixedTrended: number;
  adminPerExposureTrendedPer100: number;
  /** $M — the exposure the rate is quoted on. */
  quotedExposure: number;
  adminPer100: number;
  funding: { label: string; clf: number };
  riskControl: number;
  divisor: number;
  reinsurancePer100: number;
  ratePer100: number;
  /** $M — the exposure charged (the year's book; a played year's mean over worlds). */
  chargedExposure: number;
  premium: number;
  /** What the game charged — the row's; null for the coming year, which is charged when locked. */
  charged: { ratePer100: number; premium: number } | null;
  /** The coming year's: what the Decisions panel quotes now. */
  panelRatePer100: number | null;
}

const fundingLabel = (d: LineDecisionSet): string =>
  d.fundingCushion !== undefined
    ? `Prior board's margin ${(d.fundingCushion * 100).toFixed(4)}%`
    : d.fundingAtExpected ? 'Expected' : `${Math.round(d.fundingConfidenceLevel * 100)}% confidence`;

export function buildModelRate(gs: GameState, line: CoverageLine, decisions: DecisionSet, yearNumber: number): ModelRate | null {
  const shocks = gameShocksOn(gs.setup, gs.instance);
  const coming = yearNumber === gs.currentYearNumber && !gs.isComplete;
  const row: LineResultSet | undefined = gameHistory(gs).find(r => r.yearNumber === yearNumber)?.byLine[line];
  const ledger = gs.poolState.lines[line]?.reserveDevelopment ?? [];
  const basis = { rows: ledger, allMarketMembers: gs.poolState.allMarketMembers, membershipHistory: gs.poolState.membershipHistory };

  let pp: NewPurePremiumResult | null;
  let d: LineDecisionSet;
  let risk: number;
  // The book the cover is priced on: a one-world year's after movement.
  let quoteRisk: number | undefined;
  let quotedExposure: number;
  let chargedExposure: number;
  let credit: number;
  let panelRatePer100: number | null = null;
  if (coming) {
    const input = fundingConsequenceInput(gs, line, decisions);
    pp = input.purePremium;
    d = decisions.byLine[line];
    const members = input.book.members as { exposure: number; risk?: number };
    risk = members.risk ?? 1;
    quoteRisk = members.risk;
    quotedExposure = input.book.exposure;
    chargedExposure = input.book.exposure;
    credit = input.book.investmentIncomeCredit;
  } else {
    if (!row?.rateBasis || row.newPurePremiumPer100 === undefined || row.finalRatePer100 === undefined) return null;
    d = row.decisions;
    risk = row.rateBasis.risk ?? 1;
    quoteRisk = row.rateBasis.billedRisk ?? row.rateBasis.risk;
    // A played year is struck once on the averaged book (ratedExposure); a
    // one-world year — the pre-game — on its own book after movement.
    quotedExposure = row.ratedExposure ?? row.billedExposure ?? row.activeExposure;
    chargedExposure = row.billedExposure ?? row.activeExposure;
    credit = row.investmentIncomeCredit ?? 0;
    pp = bookPurePremium(line, yearNumber, basis, row.rateBasis.pricedExposure ?? quotedExposure, risk);
  }
  if (!pp) return null;

  const latestDataYear = yearNumber - 1 - PRICING_DATA_LAG_YEARS;
  const annualTrend = lossCostTrendPerYear(line);
  const trendYears = 1 + PRICING_DATA_LAG_YEARS;
  const valuationDate = `12/31/${calendarOf(gs, latestDataYear)}`;
  const window: ModelWindowRow[] = pp.points.map((p, i) => {
    const yearsToLatest = latestDataYear - p.accidentYear;
    const trendToLatest = Math.pow(annualTrend, yearsToLatest);
    return {
      accidentYear: calendarOf(gs, p.accidentYear), valuationDate, paid: p.groundUpPaid, shockPaid: p.shockPaid,
      ageMonths: p.ageMonths, ldf: p.ldf, developed: p.developed, exposure: p.exposure, lossCostPer100: p.lossCostPer100,
      yearsToLatest, trendToLatest, trendedToLatestPer100: p.lossCostPer100 * trendToLatest,
      alaeRatio: pp!.alaeRatios[i],
    };
  });
  const average = window.length > 0 ? window.reduce((a, w) => a + w.trendedToLatestPer100, 0) / window.length : null;
  // ULAE's share; ALAE's is the pure premium's own load (the window's mean drawn ratio).
  const lae = laeShares(line, pp.alaeRatio);

  const quote = quoteNewRateStack({
    line, yearNumber,
    members: { exposure: quotedExposure, ...(quoteRisk !== undefined ? { risk: quoteRisk } : {}) },
    exposure: quotedExposure,
    groundUpPurePremiumPer100: pp.purePremiumPer100,
    clf: selectedClfFor(line, d),
    riskControlPct: effectiveRiskControlIncentivePct(d),
    layersPlaced: placementFor(line, d.reinsuranceOption),
    aggregateStopLevel: AGGREGATE_NOT_OFFERED,
    reinsuranceOption: d.reinsuranceOption,
    shocks,
    investmentIncomeCredit: credit,
  });
  if (coming) panelRatePer100 = quote.finalRatePer100;

  // ⚠ HOW THE YEAR WAS BILLED. A struck year — played, or the coming one — is
  // charged the quote's rate exactly. A one-world year (the pre-game) is billed
  // in dollars on its own book — the pool premium and admin off this quote, and
  // its cover at the price the engine placed it for, the row's — and its rate
  // read back off those dollars over its exposure (processLineYear), so it is
  // rebuilt the same way.
  const oneWorld = !coming && row!.ratedExposure === undefined;
  const reinsuranceDollars = oneWorld ? row!.reinsuranceCost : quote.reinsRatePer100 * chargedExposure * 10_000;
  const premium = oneWorld
    ? chargedExposure * (quote.retainedPurePremiumPer100 * quote.clf / quote.divisor) * 10_000
      + chargedExposure * (quote.adminRatePer100 / quote.divisor) * 10_000 + reinsuranceDollars
    : quote.finalRatePer100 * chargedExposure * 10_000;
  const ratePer100 = oneWorld ? premium / Math.max(chargedExposure * 10_000, 1) : quote.finalRatePer100;

  return {
    line, yearNumber, calendarYear: calendarOf(gs, yearNumber), latestDataYear: calendarOf(gs, latestDataYear),
    window,
    noHistory: window.length === 0 ? { lossCostPer100: pp.lossCostPer100 - pp.catastropheLoadPer100 } : null,
    averageTrendedToLatestPer100: average,
    bookRisk: risk,
    annualTrend, trendYears, trendToPriced: Math.pow(annualTrend, trendYears),
    catastropheLoadPer100: pp.catastropheLoadPer100,
    projectedLossCostPer100: pp.lossCostPer100,
    alaeShare: lae.alae, ulaeShare: lae.ulae, alaePer100: pp.alaePer100, ulaePer100: pp.ulaePer100,
    projectedPurePremiumPer100: pp.purePremiumPer100,
    credit, afterCreditPer100: quote.creditedPurePremiumPer100,
    adminFixed: ADMIN_FIXED_PER_YEAR[line], adminPerExposurePer100: ADMIN_PER_EXPOSURE_PER_100[line],
    adminTrend: {
      perYear: ADMIN_TREND_PER_YEAR, baseYear: calendarOf(gs, ADMIN_BASE_YEAR),
      years: yearNumber - ADMIN_BASE_YEAR, factor: adminTrendFactor(yearNumber),
    },
    adminFixedTrended: ADMIN_FIXED_PER_YEAR[line] * adminTrendFactor(yearNumber),
    adminPerExposureTrendedPer100: ADMIN_PER_EXPOSURE_PER_100[line] * adminTrendFactor(yearNumber),
    quotedExposure, adminPer100: adminRatePer100For(line, quotedExposure, yearNumber),
    funding: { label: fundingLabel(d), clf: quote.clf },
    riskControl: effectiveRiskControlIncentivePct(d), divisor: expenseDivisor(effectiveRiskControlIncentivePct(d)),
    reinsurancePer100: oneWorld ? reinsuranceDollars / Math.max(chargedExposure * 10_000, 1) : quote.reinsRatePer100,
    ratePer100,
    chargedExposure,
    premium,
    charged: row && !coming ? { ratePer100: row.finalRatePer100!, premium: row.totalMemberCharge } : null,
    panelRatePer100,
  };
}

// ---------------------------------------------------------------- section B
export interface ModelVarianceYear {
  yearNumber: number;
  calendarYear: number;
  /** [expected, simulated] — the difference is simulated - expected. */
  claims: [number, number];
  alae: [number, number];
  ulae: [number, number];
  lossAndLae: [number, number];
  /** [what the rate charged for admin, admin incurred]. */
  admin: [number, number];
  /** [the cover's price, its recovery]. */
  reinsurance: [number, number];
  investmentIncome: [number, number];
  combinedRatio: [number, number | null];
  /** [the ALAE load the year's rate carried, the ratio the year drew and booked]. */
  alaeRatio: [number, number];
  surplus: [number, number];
}

/** The Annual Statement's own combined ratio for one year and line: its first row's cell for that year. */
function statementCombinedRatio(gs: GameState, line: CoverageLine, yearNumber: number): number | null {
  const st = buildAnnualStatement(gs, line, yearNumber);
  const r = st.sections.find(s => s.key === 'operating')?.rows.find(x => x.label === COMBINED_RATIO_LABEL);
  // The asOf year is the last column before Total.
  const c = r?.cells[r.cells.length - 2];
  return c?.kind === 'value' ? c.v : null;
}

export function buildModelVariance(gs: GameState, line: CoverageLine): ModelVarianceYear[] {
  const lae = laeShares(line);
  return gameHistory(gs).flatMap(res => {
    const r = res.byLine[line];
    if (!r) return [];
    const claims = r.bookedGrossUltimate ?? r.grossUltimateLoss;
    // ALAE expected at the load the year's rate carried; booked at the year's drawn ratio.
    const pricedAlae = r.pricingAlaeRatio ?? lae.alae;
    const expAlae = r.expectedLoss * pricedAlae, expUlae = r.expectedLoss * lae.ulae;
    const expInvest = blendInvestmentReturn(r.investedAssets, r.assetAllocation, expectedMarketReturns()).income;
    const expRecovery = r.expectedReinsuranceRecovery ?? 0;
    const recovery = r.reinsuranceRecovery + (r.aggregateRecovery ?? 0);
    // On the Annual Statement's basis: losses net of the cover's recovery, LAE,
    // admin, risk control and the cover's price, over the member charge.
    const actualCosts = r.netIncurredLoss + r.laeIncurred + r.operatingExpense + r.riskControlInvestment + r.reinsuranceCost;
    const expCosts = r.expectedLoss - expRecovery + expAlae + expUlae + r.adminExpense + r.riskControlInvestment + r.reinsuranceCost;
    const expectedCr = r.totalMemberCharge > 0 ? expCosts / r.totalMemberCharge : 0;
    // The year-end had costs and investment income come in at expected —
    // everything else (assessments, dividends, loans) as it happened.
    const expSurplus = r.endingSurplus + (actualCosts - expCosts) + (expInvest - r.investmentIncome);
    return [{
      yearNumber: res.yearNumber, calendarYear: calendarOf(gs, res.yearNumber),
      claims: [r.expectedLoss, claims],
      alae: [expAlae, r.alaeIncurred],
      alaeRatio: [pricedAlae, r.alaeRatio ?? lae.alae],
      ulae: [expUlae, r.ulaeIncurred],
      lossAndLae: [r.expectedLoss + expAlae + expUlae, claims + r.alaeIncurred + r.ulaeIncurred],
      admin: [r.adminExpense, r.operatingExpense],
      reinsurance: [r.reinsuranceCost, recovery],
      investmentIncome: [expInvest, r.investmentIncome],
      combinedRatio: [expectedCr, statementCombinedRatio(gs, line, res.yearNumber)],
      surplus: [expSurplus, r.endingSurplus],
    }];
  });
}
