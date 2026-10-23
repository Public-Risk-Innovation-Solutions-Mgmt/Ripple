// ============================================================================
// A GAME'S HISTORY — every year it has played, oldest first.
//
// It lived in investmentIncomeCredit.ts, which read last year's return off it
// for the investment income credit. The credit is gone (investment income does
// not touch the rate; it flows into surplus only), and this stays for its
// other readers.
// ============================================================================
import type { GameState, ResultSet } from '../types/simulation';

/** Every year a game has played, oldest first: the pre-game's, then the game's. */
export function gameHistory(gs: Pick<GameState, 'earlyPreGameHistory' | 'priorHistory' | 'lockedResults'>): ResultSet[] {
  return [...(gs.earlyPreGameHistory ?? []), ...(gs.priorHistory ?? []), ...gs.lockedResults];
}
