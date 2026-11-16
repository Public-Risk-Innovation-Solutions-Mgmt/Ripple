// ============================================================================
// THE TWENTY SCENARIOS — what a game's seed may be (stable-scenarios commit 9;
// fixed seeds, wip/fixed-seed-scenarios).
//
// A game is set up as Scenario 1 to 20, and that number is all a player or a
// host ever sees or types: the setup menu, the room's seed field, the header
// chip, the export file names. Behind it each scenario plays ONE FIXED SEED
// (SCENARIO_SEEDS), chosen once for the opening it produces and never re-picked:
// the engine's game identity is that seed's own text ("9719" for scenario 7),
// its numeric seed that text's hash (seedFromInstanceId), and the instance
// carries the scenario number as `scenario`. So the market, the book, the
// pre-game, the shocks drawn for single player and the worlds all follow from
// the fixed seed, in single player, Test player and a hosted room alike.
//
// Solo setup and the host's room offer exactly SCENARIO_OPTIONS, with a random
// pick among them; the session's handler refuses any other seed.
//
// ⚠ A HARNESS'S BARE ID ("BUORD", "MAMC6EA4") IS NOT A SCENARIO. It plays its
// own id as its seed and carries no scenario number — nothing maps it onto one
// of the twenty (the fallback that did, scenarioOfId, is retired).
// ============================================================================
import { SCENARIO_COUNT, SCENARIO_SEEDS } from '../data/pricingParameters';
import { ROOM_SEEDS } from '../session/contract';
import { seedFromInstanceId } from '../seedHash';

/** The seeds a game may be set up with: "1" to "20" — the rooms' own (contract's ROOM_SEEDS). */
export const SCENARIO_OPTIONS: readonly string[] = ROOM_SEEDS;

/** True only for "1" to "20", exactly as offered — no padding, no spaces. */
export const isScenarioId = (id: string): boolean => SCENARIO_OPTIONS.includes(id);

/** A random one of the twenty — the setup screens' "random" option. */
export const randomScenarioId = (): string => SCENARIO_OPTIONS[Math.floor(Math.random() * SCENARIO_COUNT)];

/**
 * THE GAME'S IDENTITY FOR A SETUP ID. A scenario id plays its fixed seed: the
 * seed's own text is the game id every draw keys on, its hash the numeric
 * seed. Any other id (a harness's) plays itself, with no scenario.
 */
export function gameIdentity(id: string): { gameId: string; seed: number; scenario?: number } {
  if (!isScenarioId(id)) return { gameId: id, seed: seedFromInstanceId(id) };
  const scenario = Number(id);
  const gameId = String(SCENARIO_SEEDS[scenario]);
  return { gameId, seed: seedFromInstanceId(gameId), scenario };
}
