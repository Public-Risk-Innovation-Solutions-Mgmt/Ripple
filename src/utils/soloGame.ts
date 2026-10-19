// THE SOLO GAME'S INSTANCE — what App builds at Start, and what the gates build
// to play a solo game as the app does.
//
// ⚠ THE SHOCK SCHEDULE IS DRAWN HERE, ONCE (utils/shockSchedule, on the solo
// stream), by the same rule as the host's Randomise, and it rides on the
// instance — so the save carries it and every world reads the same list. Each
// world's instance is this one with its own seed (worlds.worldInstance), so the
// events and their years are shared and only each firing's severity is drawn per
// world. Before this, a solo game drew its timing per world, per year, by the
// catalogue's probabilities ('nle_fire'); the engine keeps that path for
// harnesses that build a bare instance, and no game the app makes takes it.
import { generateGameInstance } from './instanceGenerator';
import { drawShockSchedule, SOLO_SHOCK_STREAM } from './shockSchedule';
import { seedFromInstanceId } from '../seedHash';
import type { GameInstance, GameSetupSettings } from '../types/simulation';

export function openSoloInstance(settings: GameSetupSettings): { setup: GameSetupSettings; instance: GameInstance } {
  const schedule = drawShockSchedule(settings.instanceId, settings.gameLength, SOLO_SHOCK_STREAM);
  return {
    setup: { ...settings, shockTiming: 'solo' },
    instance: generateGameInstance(settings.instanceId, seedFromInstanceId(settings.instanceId), schedule),
  };
}
