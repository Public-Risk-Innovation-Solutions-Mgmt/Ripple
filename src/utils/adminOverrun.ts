// ============================================================================
// THE YEAR'S ADMIN OVERRUN — actual admin comes in above the admin the rate
// priced, by a share drawn once per line and year, uniformly in
// ADMIN_OVERRUN_RANGE (pricingParameters.ts), from the GAME's seed on its own
// labelled stream.
//
// ⚠ PRICING IS UNTOUCHED: the rate still charges the expected trended admin
// (adminExpense); only the admin BOOKED (operatingExpense) and the year's
// result carry the overrun.
//
// ⚠ THE GAME'S SEED, NOT THE WORLD'S, as the ALAE ratio's (alaeRatio.ts):
// marketSeedOf(instance) is shared by every world and every pre-game attempt,
// so all hundred worlds book the same overrun for a year and a replay draws it
// again identically. Its own label (admin_overrun_<line>) leaves every other
// stream where it was.
// ============================================================================
import { ADMIN_OVERRUN_RANGE } from '../data/pricingParameters';
import { deriveSubRng } from './random';
import type { CoverageLine } from '../types/simulation';

export function adminOverrunFor(gameSeed: number, yearNumber: number, line: CoverageLine): number {
  const { min, max } = ADMIN_OVERRUN_RANGE;
  return min + (max - min) * deriveSubRng(gameSeed, yearNumber, `admin_overrun_${line}`).next();
}
