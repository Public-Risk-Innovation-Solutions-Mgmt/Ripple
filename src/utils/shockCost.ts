// ============================================================================
// THE SHOCK COST FACTOR (wip/shocks) — how a year's T claim sizes and T cover
// prices grow from their tables: the line's trend from the base year, times the
// book's exposure against the base year's. See SHOCK_COST_BASE_YEAR in
// pricingParameters.ts for the rule and the reason. One function, read by the
// draw, the expectation, the covers' price and the Decisions panel alike.
// ============================================================================

import { SHOCK_COST_FOLLOWS_EXPOSURE, SHOCK_COST_TREND } from '../data/pricingParameters';
import type { CoverageLine } from '../types/simulation';

/** (1 + trend)^(years since year 1) — the base year is the game's year 1. */
export const shockTrendFactor = (line: CoverageLine, yearNumber: number): number =>
  Math.pow(1 + SHOCK_COST_TREND[line], Math.max(1, yearNumber) - 1);

/**
 * The whole factor. `exposure` is the book as quoted for the year, `base` year
 * 1's (LinePoolState.shockCostBaseExposure); with no base — a harness, or a
 * year before it is known — the exposure term is 1.
 */
export function shockCostFactor(line: CoverageLine, yearNumber: number, exposure?: number, base?: number): number {
  const ratio = SHOCK_COST_FOLLOWS_EXPOSURE.enabled && exposure !== undefined && base !== undefined && base > 0
    ? exposure / base : 1;
  return shockTrendFactor(line, yearNumber) * ratio;
}
