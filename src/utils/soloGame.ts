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
import type { ScheduledShock } from '../types/shocks';
import { drawDevelopmentLevels } from './adverseDevelopment';

export function openSoloInstance(
  settings: GameSetupSettings,
  // TEST PLAYER (wip/adverse-development): the host's setup, played solo — its
  // own shock schedule, fixed or randomised on the host screen, in place of the
  // draw. Its development levels ride on `settings.developmentLevels`.
  test?: { schedule: ScheduledShock[] },
): { setup: GameSetupSettings; instance: GameInstance } {
  const draw = SOLO_SHOCK_DRAW === 'catalogue' ? drawCatalogueSchedule : drawShockSchedule;
  const schedule = test
    ? test.schedule
    : SOLO_SHOCKS.enabled ? draw(settings.instanceId, settings.gameLength, SOLO_SHOCK_STREAM) : [];
  // SINGLE PLAYER'S DEVELOPMENT LEVELS: drawn from the seed when the start
  // screen set none (ADVERSE_DEVELOPMENT) — Low, Mid and High equally likely —
  // and stored on the setup, so the save carries them.
  const developmentLevels = settings.developmentLevels ?? drawDevelopmentLevels(settings.instanceId);
  return {
    setup: { ...settings, shockTiming: 'solo', developmentLevels },
    instance: generateGameInstance(settings.instanceId, seedFromInstanceId(settings.instanceId), schedule),
  };
}
