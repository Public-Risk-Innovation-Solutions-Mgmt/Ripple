// ============================================================================
// THE TWENTY SCENARIOS — what a game's seed may be (stable-scenarios commit 9).
//
// The scenario number, 1 to 20, is the game's ONLY seed. A game's instance id
// is the number as text ("7"), its numeric seed is that text's hash
// (seedFromInstanceId), and it carries the number as `scenario` — so the
// market, the book, the pre-game and the worlds all follow from it, in a solo
// game and a hosted room alike (a room's seed field holds the same text).
//
// Solo setup and the host's room offer exactly SCENARIO_OPTIONS, with a random
// pick among them; the session's handler refuses any other seed.
//
// ⚠ A HARNESS'S BARE ID ("BUORD", "MAMC6EA4") IS NOT A SCENARIO, and the
// engine still accepts it so the gates keep their fixtures: it plays the
// scenario its seed falls on (scenarioOfId), which no game the app makes does.
// ============================================================================
import { SCENARIO_COUNT } from '../data/pricingParameters';
import { ROOM_SEEDS } from '../session/contract';

/** The seeds a game may be set up with: "1" to "20" — the rooms' own (contract's ROOM_SEEDS). */
export const SCENARIO_OPTIONS: readonly string[] = ROOM_SEEDS;

/** True only for "1" to "20", exactly as offered — no padding, no spaces. */
export const isScenarioId = (id: string): boolean => SCENARIO_OPTIONS.includes(id);

/** A random one of the twenty — the setup screens' "random" option. */
export const randomScenarioId = (): string => SCENARIO_OPTIONS[Math.floor(Math.random() * SCENARIO_COUNT)];

/** The scenario a game plays: its id's number, or for a harness's bare id the one its seed falls on. */
export const scenarioOfId = (instanceId: string, seed: number): number =>
  isScenarioId(instanceId) ? Number(instanceId) : (seed % SCENARIO_COUNT) + 1;

/** The scenario an instance plays. Every instance carries it from generateGameInstance. */
export const scenarioOf = (instance: { scenario?: number; instanceId: string; seed: number; marketSeed?: number }): number =>
  instance.scenario ?? scenarioOfId(instance.instanceId, instance.marketSeed ?? instance.seed);
