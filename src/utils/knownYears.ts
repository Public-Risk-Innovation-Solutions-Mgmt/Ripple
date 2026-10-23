// ============================================================================
// RESULTS RUN ONE YEAR BEHIND THE YEAR IN PROGRESS.
//
// The pool sits in a year while the board prices the next (the top bar's
// current year is the program year less one). What anyone can SEE of results
// stops at the LATEST KNOWN YEAR — the current year less one: in 2026, pricing
// 2027, the newest result is 2025; after one advance, in 2027, it is 2026. A
// year's results first appear at the advance after it completes. When the game
// ends the final year is shown, since it is complete.
//
// In game-year numbers: with the board pricing year N (currentYearNumber), the
// latest known year is N - 2 — year -1 (2025) before year 1, year 0 (2026,
// the opening) after the first advance. Pricing is unchanged: it already reads
// data through the year before the current one (PRICING_DATA_LAG_YEARS).
//
// ⚠ DISPLAY ONLY. Nothing here reaches the engine: the game state keeps every
// year; screens and exports that show results read the KNOWN view of it.
// Decisions, Decision History, the Rate Indication and the Model tab's rate are
// about pricing and read the whole state, as before.
// ============================================================================
import type { CoverageLine, GameState, PoolState, ResultSet } from '../types/simulation';

/** The newest game year whose results are known: N - 2 while the game runs, every year once it is over. */
export function latestKnownYearNumber(gs: Pick<GameState, 'currentYearNumber' | 'isComplete'>): number {
  return gs.isComplete ? Number.POSITIVE_INFINITY : gs.currentYearNumber - 2;
}

/** The same rule for a hosted room: its current year is the year being decided. */
export function latestKnownRoomYear(room: { currentYear: number; yearCount: number }): number {
  return room.currentYear > room.yearCount ? Number.POSITIVE_INFINITY : room.currentYear - 2;
}

// Each known view's full game, for the few readers that must know where the
// game really stands (the opening's balances and reserve cohorts are the pool
// state's own only before year 1). A WeakMap, so nothing is added to GameState
// and nothing reaches a save.
const FULL = new WeakMap<GameState, GameState>();

/** The full game a known view was cut from — the state itself when it is not one. */
export function realStateOf(gs: GameState): GameState {
  return FULL.get(gs) ?? gs;
}

const upTo = <T extends { yearNumber: number }>(rows: readonly T[] | undefined, k: number): T[] =>
  (rows ?? []).filter(r => r.yearNumber <= k);

/**
 * THE GAME AS ITS PLAYERS KNOW IT: every result list cut at the latest known
 * year — the pre-game histories, the played years and world 1's rows (its
 * claims). The pool's ledgers are left whole; a reader of them takes the
 * valuation at the newest known year (see resultsStatement's programYearsOf and
 * the claims export), so the trimmed lists are what fix "as of".
 */
export function knownGameState(gs: GameState): GameState {
  const k = latestKnownYearNumber(gs);
  if (k === Number.POSITIVE_INFINITY) return gs;
  const known: GameState = {
    ...gs,
    earlyPreGameHistory: gs.earlyPreGameHistory ? upTo(gs.earlyPreGameHistory, k) : gs.earlyPreGameHistory,
    priorHistory: upTo(gs.priorHistory, k),
    lockedResults: upTo(gs.lockedResults, k),
    worlds: gs.worlds?.map(w => ({ ...w, lockedResults: upTo(w.lockedResults, k) })),
  };
  FULL.set(known, gs);
  return known;
}

/** One list of results, cut at the latest known year. */
export function knownResults<T extends { yearNumber: number }>(gs: Pick<GameState, 'currentYearNumber' | 'isComplete'>, rows: readonly T[]): T[] {
  return upTo(rows, latestKnownYearNumber(gs));
}


/**
 * THE POOL'S RESERVE COHORTS AS THEY STOOD AT THE LATEST KNOWN YEAR — for the
 * claims workbook, which reads the live cohorts. Only what the workbook reads is
 * rebuilt, each from a record the engine keeps by valuation:
 *
 *   the cohorts       accident years up to the latest known year only;
 *   gross paid        the ledger's gross paid at that valuation
 *                     (reserveDevelopment.grossPaidByValuation);
 *   gross unpaid      that year's own reserve split (reserveSplitByYear);
 *   development       each occurrence's movements up to that valuation, and its
 *                     current figure less the movements after it.
 *
 * Every other cohort field is left as it is now and must not be read off this.
 * `results` are the rows that go with `poolState` — the game's, or world 1's
 * for its claims — and `k` the latest known year; at game end (k infinite) the
 * pool state comes back as it is.
 */
export function claimsPoolStateAsOf(poolState: PoolState, results: readonly ResultSet[], k: number): PoolState {
  if (k === Number.POSITIVE_INFINITY) return poolState;
  const asOf = results.filter(r => r.yearNumber <= k).at(-1);
  const lines = { ...poolState.lines };
  for (const line of Object.keys(lines) as CoverageLine[]) {
    const ls = lines[line];
    if (!ls) continue;
    const ledger = new Map((ls.reserveDevelopment ?? []).map(r => [r.yearNumber, r]));
    const split = new Map((asOf?.byLine[line]?.reserveSplitByYear ?? []).map(s => [s.yearNumber, s]));
    const reserveCohorts = (ls.reserveCohorts ?? []).filter(c => c.yearNumber <= k).map(c => {
      const row = ledger.get(c.yearNumber);
      const at = row?.grossPaidByValuation;
      const v = k - (row?.firstValuationYear ?? c.yearNumber);
      const grossPaid = c.grossPaid === undefined || !at || at.length === 0 || v < 0 ? c.grossPaid : at[Math.min(v, at.length - 1)];
      const s = split.get(c.yearNumber);
      const grossUnpaid = c.grossUnpaid === undefined ? undefined : s?.unpaidGross;
      // Index i of movementByStep belongs to valuation year yearNumber + i + 1.
      const keep = Math.max(0, k - c.yearNumber);
      const developingClaims = c.developingClaims?.map(d => {
        const steps = d.movementByStep ?? [];
        const later = steps.slice(keep).reduce((a, x) => a + x, 0);
        return { ...d, movementByStep: steps.slice(0, keep), current: d.current - later };
      });
      return { ...c, grossPaid, grossUnpaid, developingClaims };
    });
    lines[line] = { ...ls, reserveCohorts };
  }
  return { ...poolState, lines };
}
