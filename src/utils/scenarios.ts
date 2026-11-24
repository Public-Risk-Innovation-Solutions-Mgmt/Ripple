// ============================================================================
// THE SCENARIOS — what a game's seed may be (stable-scenarios commit 9; fixed
// seeds, wip/fixed-seed-scenarios; named scenarios, pr/named-scenarios).
//
// A game is set up as Scenario 1 to 20, or one of the NAMED SCENARIOS (Staff
// Retreat, Test Seed). A player or host sees the number or the name — the setup
// menu, the room's scenario, the header chip, the walkthrough — and never the
// seed (Test player's walkthrough aside). Behind each, ONE FIXED SEED
// (SCENARIO_SEEDS for the twenty, NAMED_SCENARIOS for the named), chosen once
// and never re-picked: the engine's game identity is that seed's own text, its
// numeric seed that text's hash (seedFromInstanceId), and the instance carries
// the scenario's number as `scenario` — 21 and 22 for the named, which are
// internal ids, shown by name (scenarioName). So the market, the book, the
// pre-game, the shocks drawn for single player and the worlds all follow from
// the fixed seed, in single player, Test player and a hosted room alike.
//
// Solo setup and the host's room offer exactly SCENARIO_OPTIONS, with a random
// pick among the TWENTY (never a named one); the session's handler refuses any
// other seed.
//
// ⚠ A HARNESS'S BARE ID ("BUORD", "MAMC6EA4") IS NOT A SCENARIO. It plays its
// own id as its seed and carries no scenario number — nothing maps it onto one
// of the scenarios (the fallback that did, scenarioOfId, is retired).
// ============================================================================
import { NAMED_SCENARIOS, SCENARIO_COUNT, SCENARIO_SEEDS } from '../data/pricingParameters';
import { ROOM_SEEDS } from '../session/contract';
import { seedFromInstanceId } from '../seedHash';

/** The seeds a game may be set up with: "1" to "20", then the named "21" and "22" — the rooms' own (contract's ROOM_SEEDS). */
export const SCENARIO_OPTIONS: readonly string[] = ROOM_SEEDS;

/** True only for an offered id, exactly as offered — no padding, no spaces. */
export const isScenarioId = (id: string): boolean => SCENARIO_OPTIONS.includes(id);

/** A random one of the TWENTY designed slots — the setup screens' "random" option; never a named scenario. */
export const randomScenarioId = (): string => String(1 + Math.floor(Math.random() * SCENARIO_COUNT));

/** The scenario's fixed seed: a slot's (SCENARIO_SEEDS) or a named scenario's (NAMED_SCENARIOS). */
export const scenarioSeed = (scenario: number): number => NAMED_SCENARIOS[scenario]?.seed ?? SCENARIO_SEEDS[scenario];

/**
 * A SCENARIO AS A PLAYER OR HOST SEES IT: a named scenario's name ("Staff
 * Retreat"), else the slot's number ("7"). Takes the number or its id text.
 */
export function scenarioName(scenario: number | string): string {
  const n = typeof scenario === 'number' ? scenario : Number(scenario);
  return NAMED_SCENARIOS[n]?.name ?? String(scenario);
}

/** A setup menu's label: "Scenario 7", or a named scenario's name alone. */
export const scenarioOptionLabel = (id: string): string => (NAMED_SCENARIOS[Number(id)] ? scenarioName(id) : `Scenario ${id}`);

/**
 * THE GAME'S IDENTITY FOR A SETUP ID. A scenario id plays its fixed seed: the
 * seed's own text is the game id every draw keys on, its hash the numeric
 * seed. Any other id (a harness's) plays itself, with no scenario.
 */
export function gameIdentity(id: string): { gameId: string; seed: number; scenario?: number } {
  if (!isScenarioId(id)) return { gameId: id, seed: seedFromInstanceId(id) };
  const scenario = Number(id);
  const gameId = String(scenarioSeed(scenario));
  return { gameId, seed: seedFromInstanceId(gameId), scenario };
}
