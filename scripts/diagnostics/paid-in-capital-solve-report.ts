// ============================================================================
// THE PAID-IN CAPITAL THAT MAKES YEAR 1'S RATE MOVE AT TREND — a REPORT.
//
//   npx tsx scripts/diagnostics/paid-in-capital-solve-report.ts
//
// The pre-game's margin is solved to land the scenario's opening surplus from
// STARTING_CAPITAL, and it comes off when year 1 funds at Expected, so the
// 2026 rate's change from 2025 depends on the paid-in capital. For each line,
// bisect STARTING_CAPITAL[line] until the mean over the twenty scenarios of
// that change equals SEVERITY_TREND_PER_YEAR[line] (frequency trend is 0).
// Prints the capital, and at it the change's range and the solved margin's
// range, flagging any scenario below zero.
//
// Single-player, all three lines, at the default decisions. The lines'
// pre-games are independent, so each line is solved on its own.
// ============================================================================

import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { openWorlds, strikeRates } from '../../src/utils/worlds';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { SCENARIO_OPTIONS } from '../../src/utils/scenarios';
import { STARTING_CAPITAL, SEVERITY_TREND_PER_YEAR } from '../../src/data/pricingParameters';
import type { CoverageLine, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Per scenario: the 2026 change from 2025, and the solved margin, for one line. */
function measure(line: CoverageLine): { chg: number[]; margin: { id: string; m: number }[] } {
  const chg: number[] = [], margin: { id: string; m: number }[] = [];
  for (const id of SCENARIO_OPTIONS) {
    const { setup, instance } = openSoloInstance({
      poolName: 'C', gameLength: 10, startingYear: 2026, instanceId: id, activeLines: [line],
    } as GameSetupSettings);
    const shocks = gameShocksOn(setup, instance);
    const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
    const gs = openWorlds({
      setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [],
      currentDecisions: defaultDecisionSet(1, shocks), priorHistory, earlyPreGameHistory,
    } as GameState);
    const last = priorHistory[priorHistory.length - 1].byLine[line]!;
    chg.push(strikeRates(gs, defaultDecisionSet(1, shocks))[line]!.quote.finalRatePer100 / last.finalRatePer100! - 1);
    margin.push({ id, m: last.decisions.fundingCushion ?? NaN });
  }
  return { chg, margin };
}

const pct = (x: number) => `${(100 * x).toFixed(2)}%`;
for (const line of LINES) {
  const target = SEVERITY_TREND_PER_YEAR[line];
  // PerLine is readonly by type; the report alone writes it, in-process, to bisect.
  const at = (cap: number) => { (STARTING_CAPITAL as Record<CoverageLine, number>)[line] = cap; return measure(line); };
  let lo = 5e6, hi = 5e6;
  // Widen until the bracket holds the target; more capital means a smaller margin, a smaller drop.
  while (mean(at(hi).chg) < target && hi < 1e9) hi *= 2;
  for (let i = 0; i < 30 && hi - lo > 1e4; i++) {
    const mid = (lo + hi) / 2;
    if (mean(at(mid).chg) < target) lo = mid; else hi = mid;
  }
  const cap = Math.round(hi / 1e4) * 1e4;
  const r = at(cap);
  const below = r.margin.filter(x => x.m < 0);
  console.log(`${line.padEnd(8)} trend ${pct(target)}  paid-in capital $${(cap / 1e6).toFixed(2)}M  `
    + `2026 change mean ${pct(mean(r.chg))} range ${pct(Math.min(...r.chg))} to ${pct(Math.max(...r.chg))}  `
    + `solved margin range ${pct(Math.min(...r.margin.map(x => x.m)))} to ${pct(Math.max(...r.margin.map(x => x.m)))}  `
    + `below zero: ${below.length ? below.map(x => `${x.id} ${pct(x.m)}`).join(', ') : 'none'}`);
}
