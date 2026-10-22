// ============================================================================
// THE INVESTMENT INCOME CREDIT — what a rate takes off the pure premium for
// the investment income the pool earns on claim money before paying it
// (INVESTMENT_INCOME_CREDIT in pricingParameters.ts).
//
// ⚠ ONE READING, CALLED WHEREVER A RATE IS STRUCK: the pre-game and played
// years (processYear), the worlds' struck rate (strikeRates), the opening's
// year-1 premium, and the Decisions panel. Each passes the history it has and
// the year it prices, so none can credit a different year's return.
//
// The credit is LAST YEAR'S ACTUAL RETURN: the result of the year before the
// one priced, its investment income over its invested assets summed over its
// lines — net of fees, since every class's return is drawn net of its fee.
// With no such year (the first pre-game year) it is the parameter's
// `beforeHistory`. The line's factor (`byLine`, 1 on every line today) scales
// it, so a payout-length weighting is one change to the parameter.
// ============================================================================
import { INVESTMENT_INCOME_CREDIT } from '../data/pricingParameters';
import type { CoverageLine, GameState, LineResultSet, ResultSet } from '../types/simulation';

/** A year's realised return on the pool's invested assets: its lines' income over their assets. Null with no assets. */
export function poolReturnOf(result: ResultSet): number | null {
  let income = 0, assets = 0;
  for (const r of Object.values(result.byLine)) {
    if (!r) continue;
    income += r.investmentIncome;
    assets += r.investedAssets;
  }
  return assets > 0 ? income / assets : null;
}

/** Every year a game has played, oldest first: the pre-game's, then the game's. */
export function gameHistory(gs: Pick<GameState, 'earlyPreGameHistory' | 'priorHistory' | 'lockedResults'>): ResultSet[] {
  return [...(gs.earlyPreGameHistory ?? []), ...(gs.priorHistory ?? []), ...gs.lockedResults];
}

/** The rate before the line's factor: last year's realised return, or the parameter's before any history. */
export function investmentIncomeCreditRate(history: readonly ResultSet[], yearNumber: number): number {
  const last = history.find(r => r.yearNumber === yearNumber - 1);
  return (last ? poolReturnOf(last) : null) ?? INVESTMENT_INCOME_CREDIT.beforeHistory;
}

/** The credit `line`'s rate for `yearNumber` takes off its pure premium; 0 with the credit off. */
export function investmentIncomeCredit(line: CoverageLine, history: readonly ResultSet[], yearNumber: number): number {
  if (!INVESTMENT_INCOME_CREDIT.enabled) return 0;
  return investmentIncomeCreditRate(history, yearNumber) * INVESTMENT_INCOME_CREDIT.byLine[line];
}

/**
 * The credit from one line's last year — for the opening's year-1 premium,
 * struck inside a line's own pre-game where that line is the pool. Every line's
 * pre-game holds the same allocation on the same market, so it is the pool's.
 */
export function investmentIncomeCreditFromLine(line: CoverageLine, last: LineResultSet | undefined): number {
  if (!INVESTMENT_INCOME_CREDIT.enabled) return 0;
  const rate = last && last.investedAssets > 0 ? last.investmentIncome / last.investedAssets : INVESTMENT_INCOME_CREDIT.beforeHistory;
  return rate * INVESTMENT_INCOME_CREDIT.byLine[line];
}
