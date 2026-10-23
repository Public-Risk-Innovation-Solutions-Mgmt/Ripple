// THE SOLO GAME'S INSTANCE — what App builds at Start, and what the gates build
// to play a solo game as the app does.
//
// ⚠ THE SHOCK SCHEDULE IS DRAWN HERE, ONCE (utils/shockSchedule, on the solo
// stream), by SOLO_SHOCK_DRAW — since wip/shocks each event at its catalogue
// probability each year from year 2 (drawCatalogueSchedule) — and it rides on the
// instance — so the save carries it and every world reads the same list. Each
// world's instance is this one with its own seed (worlds.worldInstance), and the
// shocks are keyed on the game seed (shockLosses.shockSeedOf), so the events,
// their years and their sizes are shared by every world. Before this, a solo game drew its timing per world, per year, by the
// catalogue's probabilities ('nle_fire'); the engine keeps that path for
// harnesses that build a bare instance, and no game the app makes takes it.
//
// ⚠ WITH SOLO_SHOCKS OFF (pending the data scientist) NO SCHEDULE IS DRAWN: the
// instance carries none, its timing is still 'solo', and so nothing fires.
import { SOLO_SHOCK_DRAW, SOLO_SHOCKS } from '../data/pricingParameters';
import { generateGameInstance } from './instanceGenerator';
import { drawCatalogueSchedule, drawShockSchedule, SOLO_SHOCK_STREAM } from './shockSchedule';
import { seedFromInstanceId } from '../seedHash';
import type { GameInstance, GameSetupSettings } from '../types/simulation';

export function openSoloInstance(settings: GameSetupSettings): { setup: GameSetupSettings; instance: GameInstance } {
  const draw = SOLO_SHOCK_DRAW === 'catalogue' ? drawCatalogueSchedule : drawShockSchedule;
  const schedule = SOLO_SHOCKS.enabled ? draw(settings.instanceId, settings.gameLength, SOLO_SHOCK_STREAM) : [];
  return {
    setup: { ...settings, shockTiming: 'solo' },
    instance: generateGameInstance(settings.instanceId, seedFromInstanceId(settings.instanceId), schedule),
  };
}
