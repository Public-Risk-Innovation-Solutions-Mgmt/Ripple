// ============================================================================
// THE HOST'S RANDOMISED SHOCK SCHEDULE — drawn ONCE, at room creation, by the
// host's client, and written into the room as concrete entries.
//
// ⚠ HostCreateScreen CALLS THIS; NO OTHER SESSION CODE MAY. Not a player's
// client, not the engine, not per year. The room record carries the result as
// a plain list and every team's build reads THAT list (buildGame.ts ->
// generateGameInstance), so every team faces the same schedule because they all
// read the same record — not because they all ran the same draw.
//
// The rule itself lives in utils/shockSchedule, because a solo game draws its
// schedule by the same rule at its start, on its own stream. This is the host's
// binding of it, on the host's stream — unchanged since the rule moved.
// ============================================================================

import { drawShockSchedule as drawOnStream, HOST_SHOCK_STREAM } from '../utils/shockSchedule';
import type { ScheduledShockSpec } from './contract';

export { drawableShocks, shockDrawCount, shockDrawRange, type DrawableShock } from '../utils/shockSchedule';

export function drawShockSchedule(roomSeed: string, yearCount: number): ScheduledShockSpec[] {
  return drawOnStream(roomSeed, yearCount, HOST_SHOCK_STREAM);
}
