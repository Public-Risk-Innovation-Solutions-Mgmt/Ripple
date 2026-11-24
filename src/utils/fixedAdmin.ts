// ============================================================================
// THE FIXED ADMIN — New-version market rooms only (pr/market-new-version;
// MARKET_NEW_FIXED_ADMIN). One formula, read by the engine, which books it
// (simulationEngine processLineYear), and by the Annual Statement, which splits
// General Admin Expense into its Fixed and Variable parts (annualStatementTemplate).
//
// FIXED, in a year with a market result: `share` × the line's year-1 admin
// dollars (the admin charged, before the overrun), grown `trend` a year. The
// engine books (fixed + (1 − share) × this year's admin) × (1 + the overrun);
// the statement shows this fixed figure as Fixed and the rest of the admin
// booked as Variable, so the two add to General Admin Expense exactly.
//
// ⚠ READ FROM THE RESULTS, NOT STORED: the statement works the fixed part out
// from the setup and the year-1 result's admin, so no result or save changed
// with the split, and a game saved before it shows the same split.
// ============================================================================
import { MARKET_NEW_FIXED_ADMIN } from '../data/pricingParameters';
import type { CoverageLine, GameState, LineView, ResultSet } from '../types/simulation';

/** The fixed admin in year `yearNumber` (1 or later) on a year-1 admin of `base` dollars. */
export const fixedAdminDollars = (base: number, yearNumber: number): number =>
  MARKET_NEW_FIXED_ADMIN.share * base * (1 + MARKET_NEW_FIXED_ADMIN.trend) ** (yearNumber - 1);

/**
 * WHETHER THE ANNUAL STATEMENT SPLITS GENERAL ADMIN EXPENSE: a New-version
 * room's game (setup.marketVersion), which a team game carries only with the
 * market on (session/client/buildGame). Current rooms, single player and Test
 * player keep the single line.
 */
export const showsAdminSplit = (gs: GameState): boolean => gs.setup.marketVersion === 'new';

/**
 * A year's fixed admin at a scope, in dollars: the line's, or the lines' sum at
 * the pool. 0 in a history year, and in any year without the line's market
 * result — the engine books all its admin as a share of premium there.
 * `all` is the game's results, for year 1's admin (each line's base).
 */
export function fixedAdminOf(gs: GameState, r: ResultSet, scope: LineView, all: readonly ResultSet[]): number {
  if (!showsAdminSplit(gs) || r.yearNumber < 1) return 0;
  const lines = (scope === 'pool' ? Object.keys(r.byLine) : [scope]) as CoverageLine[];
  const year1 = all.find(x => x.yearNumber === 1);
  let total = 0;
  for (const line of lines) {
    const x = r.byLine[line];
    if (!x || gs.setup.marketByYear?.[String(r.yearNumber)]?.[line] === undefined) continue;
    // A line with no year-1 result takes this year's admin as its base, as the engine does.
    total += fixedAdminDollars(year1?.byLine[line]?.adminExpense ?? x.adminExpense, r.yearNumber);
  }
  return total;
}
