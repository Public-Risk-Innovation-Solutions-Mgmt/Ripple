// One seed's opening, premium to surplus per line, as scenarios-check measures it:
// year 1 at Expected with no cover (atExpectedDecisionSet), shocks off, over the opening surplus.
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { atExpectedDecisionSet, defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { openWorlds, strikeRates } from '../../src/utils/worlds';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { SOLO_SHOCKS } from '../../src/data/pricingParameters';
import type { CoverageLine, GameSetupSettings, GameState } from '../../src/types/simulation';

export const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
export function openingPs(id: string): Record<CoverageLine, number> {
  const was = SOLO_SHOCKS.enabled;
  SOLO_SHOCKS.enabled = false;
  try {
    const { setup, instance } = openSoloInstance({ poolName: 'S', gameLength: 10, startingYear: 2027, instanceId: id, activeLines: LINES } as GameSetupSettings);
    const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
    const gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
    const struck = strikeRates(gs, atExpectedDecisionSet(1, gameShocksOn(gs.setup, gs.instance)));
    return Object.fromEntries(LINES.map(l => [l, struck[l]!.quote.finalRatePer100 * struck[l]!.exposure * 10_000 / poolState.lines[l].surplus])) as Record<CoverageLine, number>;
  } finally { SOLO_SHOCKS.enabled = was; }
}
if (process.argv[1]?.endsWith('scenario-seed-open.mts')) {
  for (const id of process.argv.slice(2)) {
    const t = Date.now();
    const ps = openingPs(id);
    console.log(id, LINES.map(l => `${l} ${ps[l].toFixed(4)}`).join('  '), `${Date.now() - t}ms`);
  }
}
