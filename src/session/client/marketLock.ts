// ============================================================================
// WHAT A TEAM SENDS WITH ITS LOCK IN A ROOM WITH MARKET COMPETITION
// (contract MarketLockInput) — the one part of a lock the server reads.
//
// Per line: the year's whole rate exactly as the team's game will charge it
// (worlds.ts strikeRates — the same call playWorldsYear makes, on the same
// book, so the rate the market compares is the rate the year plays at), the
// book at the start of the year, and the two market decisions.
// ============================================================================

import type { DecisionSet, GameState } from '../../types/simulation';
import { newMembersShare, nonRenewalShare } from '../../utils/bookUnderwriting';
import { strikeRates } from '../../utils/worlds';
import type { MarketLockInput, MarketLockLine } from '../contract';

/** Null when the game is not on the year being locked, or a line has no struck rate (nothing to send). */
export function marketLockInputFor(gs: GameState, decisions: DecisionSet, yearNumber: number): MarketLockInput | null {
  if (gs.currentYearNumber !== yearNumber) return null;
  const struck = strikeRates(gs, decisions);
  const byLine: Partial<Record<keyof typeof struck, MarketLockLine>> = {};
  for (const line of gs.setup.activeLines) {
    const s = struck[line];
    const book = gs.poolState.lines[line]?.bookExposure ?? 0;
    const d = decisions.byLine[line];
    if (!s || !d || !(book > 0)) return null;
    byLine[line] = {
      rate: s.quote.finalRatePer100,
      book,
      newMembers: newMembersShare(d.newMembers),
      nonRenewal: nonRenewalShare(d.nonRenewal),
    };
  }
  return { byLine };
}
