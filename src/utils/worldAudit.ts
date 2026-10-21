// ============================================================================
// WHAT THE AVERAGE CARRIES OF ITS WORLDS — the surplus spread and the audit's
// per-world figures, struck when a year settles (stable-scenarios commit 10).
//
// The averaged row is all a game keeps of a year: no world keeps its rows past
// the next year (worlds.ts), and the save keeps the averages only. So what the
// screens read off the worlds is computed here, once, while every world's row
// is in hand, and stored on the averaged row (ResultSet.worldSummary):
//
//   - the ending-surplus range — minimum, median and maximum across the worlds,
//     at pool scope and per line (the host's range, the Results spread);
//   - per line, the audit's cash sweep averaged over the worlds' own sweeps
//     (each world sweeps against its own floors) and the dividend and
//     assessment basis averaged over the worlds' own opening surplus.
//
// reconstructSweep and averageSweeps moved here from CalculationAuditPage,
// unchanged, so the page and the settle read one definition.
// ============================================================================
import { OPERATING_CASH_PCT_OF_PREMIUM } from '../data/defaultAssumptions';
import { dividendAssessmentBasis } from './dividendAssessment';
import { blendInvestmentReturn, type MarketReturns } from './investmentEngine';
import type { CoverageLine, LineResultSet, ResultSet, WorldSummary } from '../types/simulation';

/** Below this a gap is rounding, not a floor binding. */
export const SWEEP_CHECK_TOLERANCE = 0.01;

// Reconstructs one line's year-end cash/investment sweep exactly as the engine
// performs it: the year's flows accumulate to a pre-sweep cash total, then cash
// above the operating-cash target is swept into investments, or a shortfall is
// drawn back out of investments (limited to what is actually there). Both
// floors are reported so a genuine liquidity or wipe-out event is
// distinguishable from a reconciliation gap.
export function reconstructSweep(x: LineResultSet) {
  const preSweepCash =
    x.beginningCash + x.totalMemberCharge + x.assessments - x.netPaidLosses - x.laePaid -
    x.operatingExpense - x.riskControlInvestment - x.reinsuranceCost - x.dividends;
  const rawInvestments = x.beginningInvestments + x.investmentIncome;
  const investmentsBeforeSweep = Math.max(0, rawInvestments);
  const investmentsFloorBound = rawInvestments < -SWEEP_CHECK_TOLERANCE;
  const operatingCashTarget = x.totalMemberCharge * OPERATING_CASH_PCT_OF_PREMIUM;

  let cash: number;
  let investments: number;
  let liquidityFloorBound = false;
  if (preSweepCash >= operatingCashTarget) {
    cash = operatingCashTarget;
    investments = investmentsBeforeSweep + (preSweepCash - operatingCashTarget);
  } else {
    const shortfall = operatingCashTarget - preSweepCash;
    const drawn = Math.min(shortfall, investmentsBeforeSweep);
    cash = preSweepCash + drawn;
    investments = investmentsBeforeSweep - drawn;
    liquidityFloorBound = drawn < shortfall - SWEEP_CHECK_TOLERANCE;
  }
  return {
    cash,
    investments,
    preSweepCash,
    operatingCashTarget,
    investmentsBeforeSweep,
    sweepTransfer: investments - investmentsBeforeSweep,
    liquidityFloorBound,
    investmentsFloorBound,
  };
}
export type Sweep = ReturnType<typeof reconstructSweep>;

/** The worlds' own sweeps, averaged — a floor that bound in any world is reported. */
export function averageSweeps(parts: Sweep[]): Sweep {
  const n = parts.length;
  const m = (k: 'cash' | 'investments' | 'preSweepCash' | 'operatingCashTarget' | 'investmentsBeforeSweep' | 'sweepTransfer') =>
    parts.reduce((a, p) => a + p[k], 0) / n;
  return {
    cash: m('cash'), investments: m('investments'), preSweepCash: m('preSweepCash'),
    operatingCashTarget: m('operatingCashTarget'), investmentsBeforeSweep: m('investmentsBeforeSweep'),
    sweepTransfer: m('sweepTransfer'),
    liquidityFloorBound: parts.some(p => p.liquidityFloorBound),
    investmentsFloorBound: parts.some(p => p.investmentsFloorBound),
  };
}

export interface SurplusRange { min: number; median: number; max: number; worlds: number }

export function rangeOf(vals: number[]): SurplusRange {
  const s = [...vals].sort((a, b) => a - b);
  const n = s.length;
  const median = n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { min: s[0], median, max: s[n - 1], worlds: n };
}

/**
 * What the averaged row keeps of its worlds' rows for one settled year.
 * `marketOf(i)` is world i's market that year — its own draw, with the year's
 * Investment Loss taken off equities — for the audit's re-derived income.
 */
export function summarizeWorlds(
  rows: ResultSet[], lines: readonly CoverageLine[], marketOf: (i: number) => MarketReturns,
): WorldSummary {
  const surplusRange: WorldSummary['surplusRange'] = { pool: rangeOf(rows.map(r => r.endingSurplus)) };
  const audit: WorldSummary['audit'] = {};
  for (const l of lines) {
    const ls = rows.map(r => r.byLine[l]);
    surplusRange[l] = rangeOf(ls.map(x => x?.endingSurplus ?? 0));
    const n = ls.length;
    audit[l] = {
      sweep: averageSweeps(ls.map(reconstructSweep)),
      assessmentBasis: ls.reduce((a, x) => a + dividendAssessmentBasis(x.beginingSurplus), 0) / n,
      dividendBasis: ls.reduce((a, x) => a + (x.dividendBlocked ? 0 : dividendAssessmentBasis(x.beginingSurplus)), 0) / n,
      // Each world's own market on its own assets, averaged — no single draw
      // produced the averaged row (the audit's investment check).
      investmentIncome: ls.reduce((a, x, i) => a + blendInvestmentReturn(x.investedAssets, x.assetAllocation, marketOf(i)).income, 0) / n,
      worlds: n,
    };
  }
  return { surplusRange, audit };
}
