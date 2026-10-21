// ============================================================================
// A RELOAD, BY REPLAY (stable-scenarios commit 10).
//
// The save keeps the averages only (gameSave.ts). A game is a pure function of
// its instance and the decisions played on it, so a reload rebuilds the opening
// from the saved setup and instance — the pre-game and the worlds, exactly as
// at the start — and replays each played year on its saved decisions and loan
// choices. Every world comes back as it was, and so does every averaged row.
//
// ⚠ IT IS CHECKED, NOT ASSUMED. The replay's averaged rows and world 1's claim
// rows, serialised as the save serialises them, must equal the saved ones; a
// mismatch is reported (`matches: false`) rather than hidden.
// save-round-trip-check holds it, solo; the session drivers hold it hosted,
// where the same replay rebuilds a team's game from the room.
//
// ⚠ IT YIELDS BETWEEN YEARS, so the page can say "Restoring year 3 of 7…":
// a ten-year replay at a hundred worlds is seconds of work.
// ============================================================================
import { runPriorHistory } from './priorHistoryEngine';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from './worlds';
import { openingRoster } from '../game/openingRoster';
import { serialiseSave, type SavedGame } from './gameSave';
import type { DecisionSet, GameInstance, GameSetupSettings, GameState, Member, PlayedYear, StartingFinancials } from '../types/simulation';

export interface RestoredGame {
  gameState: GameState;
  startingFinancials: StartingFinancials;
  initialMembers: Member[];
  currentDecisions: DecisionSet;
  /** The replay reproduced every saved averaged row and world 1's claim rows. */
  matches: boolean;
}

const nextTick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** What the replay is checked against — the averaged rows and world 1's claim rows — as a save holds them. */
function checked(g: SavedGame): string {
  return JSON.stringify([g.lockedResults, g.world1Claims]);
}
/** A replayed game as its save would hold it. */
function asSaved(gs: GameState): SavedGame {
  return (JSON.parse(serialiseSave({ gameState: gs, startingFinancials: null, initialMembers: null, currentDecisions: null })) as
    { gameState: SavedGame }).gameState;
}

export async function restoreSavedGame(
  saved: SavedGame,
  currentDecisions: DecisionSet | null,
  onProgress?: (yearNumber: number, of: number) => void,
  yieldBetweenYears: () => Promise<void> = nextTick,
): Promise<RestoredGame> {
  const setup = saved.setup as GameSetupSettings;
  const instance = saved.instance as GameInstance;
  const played = saved.playedYears as PlayedYear[];
  const { poolState, startingFinancials, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({
    setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState,
    lockedResults: [], currentDecisions: (played[0]?.decisions ?? saved.currentDecisions) as DecisionSet,
    priorHistory, earlyPreGameHistory,
  });
  const last = played.length > 0 ? played[played.length - 1].yearNumber : 0;
  for (const year of played) {
    onProgress?.(year.yearNumber, last);
    await yieldBetweenYears();
    const settled = settleWorldsYear(gs, playWorldsYear(gs, year.decisions), year.authorizedLines);
    const next = year.yearNumber + 1;
    gs = { ...gs, ...commitSettledYear(gs, settled), currentYearNumber: next, isComplete: next > setup.gameLength };
  }
  gs = { ...gs, currentYearNumber: saved.currentYearNumber, isComplete: saved.isComplete, currentDecisions: saved.currentDecisions as DecisionSet };
  return {
    gameState: gs,
    startingFinancials,
    initialMembers: openingRoster(poolState, setup.activeLines),
    currentDecisions: currentDecisions ?? (saved.currentDecisions as DecisionSet),
    matches: checked(asSaved(gs)) === checked(saved),
  };
}
