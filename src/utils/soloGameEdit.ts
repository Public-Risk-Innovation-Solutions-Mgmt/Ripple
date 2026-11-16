// ============================================================================
// TEST PLAYER'S MID-GAME EDITS (wip/mid-game-edits) — the host's "Edit game"
// rules, applied to a game played solo: the same applyGameEdit, on the game's
// own setup (its levels by year) and instance (its shock schedule), so Test
// player tests exactly what a hosted room does. The save carries both, and a
// reload replays each year on what was in force in it.
// ============================================================================

import { applyGameEdit, type GameEdit, type YearSettings } from './gameEdits';
import { scheduleWithRegions } from './instanceGenerator';
import type { GameState } from '../types/simulation';

export function editSoloGame(gs: GameState, years: Record<string, YearSettings>, now: number): { gameState: GameState; edits: GameEdit[] } {
  const schedule = gs.instance.scheduledShocks ?? [];
  const out = applyGameEdit(
    {
      developmentLevels: gs.setup.developmentLevels ?? {},
      developmentLevelsByYear: gs.setup.developmentLevelsByYear,
      shocks: schedule.map(s => ({ shockId: s.shockId, yearNumber: s.yearNumber })),
    },
    years,
    { firstEditable: gs.currentYearNumber, yearCount: gs.setup.gameLength, lines: gs.setup.activeLines, by: 'Test player', now },
  );
  if (out.edits.length === 0) return { gameState: gs, edits: [] };
  // Each kept entry keeps its region: matched on (event, year, ordinal), the key it was resolved on.
  const regionOf = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const s of schedule) {
    const k = `${s.shockId}_${s.yearNumber}`;
    const o = seen.get(k) ?? 0; seen.set(k, o + 1);
    if (s.region) regionOf.set(`${k}_${o}`, s.region);
  }
  const seen2 = new Map<string, number>();
  const next = out.settings.shocks.map(s => {
    const k = `${s.shockId}_${s.yearNumber}`;
    const o = seen2.get(k) ?? 0; seen2.set(k, o + 1);
    const region = regionOf.get(`${k}_${o}`);
    return region ? { ...s, region } : { ...s };
  });
  const scheduledShocks = scheduleWithRegions(gs.instance.seed, next as never);
  const { scheduledShocks: _drop, ...rest } = gs.instance;
  void _drop;
  return {
    gameState: {
      ...gs,
      setup: {
        ...gs.setup,
        ...(out.settings.developmentLevelsByYear ? { developmentLevelsByYear: out.settings.developmentLevelsByYear } : {}),
        // Pinned from the schedule as it stood before the first edit.
        shocksOn: gs.setup.shocksOn ?? schedule.length > 0,
        gameEdits: [...(gs.setup.gameEdits ?? []), ...out.edits],
      },
      instance: scheduledShocks.length > 0 ? { ...rest, scheduledShocks } : rest,
    },
    edits: out.edits,
  };
}
