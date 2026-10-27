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
import { SOLO_ADVERSE_DEVELOPMENT, SOLO_SHOCK_DRAW, SOLO_SHOCKS } from '../data/pricingParameters';
import { generateGameInstance } from './instanceGenerator';
import { drawCatalogueSchedule, drawShockSchedule, SOLO_SHOCK_STREAM } from './shockSchedule';
import { seedFromInstanceId } from '../seedHash';
import type { GameInstance, GameSetupSettings } from '../types/simulation';
import type { ScheduledShock } from '../types/shocks';
import { drawDevelopmentLevels, NO_DEVELOPMENT } from './adverseDevelopment';

export function openSoloInstance(
  settings: GameSetupSettings,
  // TEST PLAYER (wip/adverse-development): the host's setup, played solo — its
  // own shock schedule, fixed or randomised on the host screen, in place of the
  // draw. Its development levels ride on `settings.developmentLevels`. The save
  // carries setup and instance, so a reload rebuilds the same game.
  test?: { schedule: ScheduledShock[] },
): { setup: GameSetupSettings; instance: GameInstance } {
  const draw = SOLO_SHOCK_DRAW === 'catalogue' ? drawCatalogueSchedule : drawShockSchedule;
  const schedule = test
    ? test.schedule
    : SOLO_SHOCKS.enabled ? draw(settings.instanceId, settings.gameLength, SOLO_SHOCK_STREAM) : [];
  // THE DEVELOPMENT LEVELS, stored on the setup so the save carries them. Test
  // player brings the ones chosen on the host's screen. SINGLE PLAYER HAS NONE
  // (SOLO_ADVERSE_DEVELOPMENT off): every line Off and no level drawn — single
  // player is for learning the game, development a tool for hosted and test
  // games. Switched on, it would draw each line's level from the seed.
  const developmentLevels = settings.developmentLevels
    ?? (SOLO_ADVERSE_DEVELOPMENT.enabled ? drawDevelopmentLevels(settings.instanceId) : { ...NO_DEVELOPMENT });
  // ⚠ TEST PLAYER TAKES THE HOST'S SHOCK SWITCH ('host'), so a Test player
  // game and a hosted team on the same seed, levels and schedule are the same
  // game. 'solo' turns shocks on whatever the schedule (SOLO_SHOCKS); with an
  // empty schedule that priced the catalogue's load and opened on the default
  // cover where a hosted room, shocks off, opens on None.
  return {
    setup: { ...settings, shockTiming: test ? 'host' : 'solo', developmentLevels },
    instance: generateGameInstance(settings.instanceId, seedFromInstanceId(settings.instanceId), schedule),
  };
}
