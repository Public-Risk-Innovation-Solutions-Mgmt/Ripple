// ============================================================================
// THE YEAR'S ALAE RATIO — drawn once per line and accident year, uniformly in
// the line's range (ALAE_RATIO_RANGE in pricingParameters.ts), from the GAME's
// seed on its own labelled stream.
//
// ⚠ THE GAME'S SEED, NOT THE WORLD'S: marketSeedOf(instance) is the seed every
// world and every pre-game attempt shares, so all hundred worlds book the same
// ratio for a year and the averaged result shows the year's variation; a replay
// draws it again identically. Its own label (alae_ratio_<line>) leaves every
// other stream where it was.
// ============================================================================
import { ALAE_RATIO_RANGE } from '../data/pricingParameters';
import { deriveSubRng } from './random';
import type { CoverageLine } from '../types/simulation';

export function alaeRatioFor(gameSeed: number, yearNumber: number, line: CoverageLine): number {
  const { min, max } = ALAE_RATIO_RANGE[line];
  return min + (max - min) * deriveSubRng(gameSeed, yearNumber, `alae_ratio_${line}`).next();
}
