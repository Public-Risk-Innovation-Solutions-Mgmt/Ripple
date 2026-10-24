// ============================================================================
// ADVERSE DEVELOPMENT (wip/adverse-development) — each played year, every open
// prior accident year's outstanding grows by its own λ, drawn uniformly in its
// line's level's range. See ADVERSE_DEVELOPMENT in pricingParameters.ts for the
// rule and the reason; the engine applies it in processIbner, on the route
// reserve inflation used.
//
// ⚠ EVERY DRAW IS THE GAME SEED'S, on its own labelled stream, keyed on the
// line, the valuation year and the accident year: one uniform per (line,
// valuation year, accident year), so every world shares the same λ and no
// other stream moves.
// ============================================================================

import {
  ADVERSE_DEVELOPMENT_DEFAULT_LEVEL, ADVERSE_DEVELOPMENT_RANGE, DEVELOPMENT_LEVELS, type DevelopmentLevel,
} from '../data/pricingParameters';
import { deriveSubRng } from './random';
import { seedFromInstanceId } from '../seedHash';
import type { CoverageLine, GameSetupSettings } from '../types/simulation';

/** The uniform behind one λ — exported so the gate can hold the engine to it. */
export const adverseDevelopmentUniform = (gameSeed: number, line: CoverageLine, valuationYear: number, accidentYear: number): number =>
  deriveSubRng(gameSeed, valuationYear, `adverse_dev_${line}_${accidentYear}`).next();

/** One open prior accident year's λ this valuation year. */
export function adverseDevelopmentRate(
  gameSeed: number, line: CoverageLine, level: DevelopmentLevel, valuationYear: number, accidentYear: number,
): number {
  const [lo, hi] = ADVERSE_DEVELOPMENT_RANGE[level];
  return lo + adverseDevelopmentUniform(gameSeed, line, valuationYear, accidentYear) * (hi - lo);
}

/** The level a game develops a line at: the setup's, or the default. */
export const developmentLevelOf = (setup: Pick<GameSetupSettings, 'developmentLevels'>, line: CoverageLine): DevelopmentLevel =>
  setup.developmentLevels?.[line] ?? ADVERSE_DEVELOPMENT_DEFAULT_LEVEL;

/**
 * SINGLE PLAYER'S LEVELS, drawn once at the start from the seed string on
 * their own stream: each line Low, Mid or High, equally likely.
 */
export function drawDevelopmentLevels(seed: string): Record<CoverageLine, DevelopmentLevel> {
  const rng = deriveSubRng(seedFromInstanceId(seed), 0, 'solo_development_levels');
  const pick = () => DEVELOPMENT_LEVELS[Math.min(DEVELOPMENT_LEVELS.length - 1, Math.floor(rng.next() * DEVELOPMENT_LEVELS.length))];
  return { WC: pick(), GL: pick(), Property: pick() };
}
