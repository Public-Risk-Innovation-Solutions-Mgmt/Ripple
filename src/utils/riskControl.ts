// ============================================================================
// THE RISK CONTROL CUT — what a year of the Risk Control slider takes off the
// year's normal losses (wip/risk-control; RISK_CONTROL_CHARGE and
// RISK_CONTROL_CUT in pricingParameters.ts).
//
//   m    = the charge / (expected normal losses x (1 + expected ALAE + ULAE))
//   cut  = max(0, m x (1 + sdOfMean x z)),  z ~ N(0, 1)
//
// ⚠ z IS THE SCENARIO'S, m IS THE PLAYER'S. z is drawn once per year per line
// off the GAME's seed (marketSeedOf), so every world and every player in a
// scenario shares the year's luck. m follows the player's own slider, charge
// and book; across the worlds of one game it is the same, because the charge is
// the struck rate on the book and the expected normal losses are the book's.
//
// ⚠ THE CUT NEVER REACHES A SHOCK, A LARGE CLAIM OR AN OLDER YEAR. The engine
// takes it off the ordinary year before the shocks' uplift is added and before
// any large claim is drawn, and only in the year it is bought. LAE follows the
// losses: it is booked as shares of each cohort's gross ultimate, so the cut
// year books less ALAE and ULAE at the year's own drawn ALAE ratio.
// ============================================================================

import type { CoverageLine } from '../types/simulation';
import { RISK_CONTROL_CUT } from '../data/pricingParameters';
import { deriveSubRng } from './random';
import { laeShares } from './lossExpense';

/** One line-year of risk control, as the engine applies and records it. */
export interface RiskControlYear {
  /** m: the mean cut — the share of normal losses that saves, on average, exactly the charge. */
  meanCut: number;
  /** z: the year's standard normal draw, the same for every world and player in the scenario. */
  draw: number;
  /** The cut applied to this year's normal losses: max(floor, m x (1 + sdOfMean x z)). */
  cut: number;
}

/** z for a line-year: the game's stream, its own label, so no other draw moves. */
export function riskControlDraw(gameSeed: number, yearNumber: number, line: CoverageLine): number {
  return deriveSubRng(gameSeed, yearNumber, `${RISK_CONTROL_CUT.label}_${line}`).normal(0, 1);
}

/**
 * m: the charge over the expected normal losses and their expected LAE. The
 * expected ALAE is the line's parameter (laeShares with no drawn ratio), not the
 * year's draw — the cut is sized before the year happens.
 */
export function riskControlMeanCut(line: CoverageLine, charge: number, expectedNormalLoss: number): number {
  if (!(charge > 0) || !(expectedNormalLoss > 0)) return 0;
  return charge / (expectedNormalLoss * (1 + laeShares(line).total));
}

/**
 * The year's cut for a line, given the charge and the ordinary year. The
 * expected normal losses are the ordinary year's expectation with underwriting's
 * loss factor in it (the draw's mean), so the saving is neutral on the book the
 * year actually covers.
 */
export function riskControlCutFor(
  line: CoverageLine, yearNumber: number, gameSeed: number, charge: number,
  ordinary: { expected: number; lossFactor?: number },
): RiskControlYear {
  const meanCut = riskControlMeanCut(line, charge, ordinary.expected * (ordinary.lossFactor ?? 1));
  const draw = riskControlDraw(gameSeed, yearNumber, line);
  const cut = Math.max(RISK_CONTROL_CUT.floor, meanCut * (1 + RISK_CONTROL_CUT.sdOfMean * draw));
  return { meanCut, draw, cut };
}
