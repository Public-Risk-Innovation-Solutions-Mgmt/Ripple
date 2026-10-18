// ============================================================================
// TEN WORLDS BY PACKAGE — a reading, not a gate (loss engine commit 4b).
//
//   npx tsx scripts/tools/worlds-package-report.ts [--seed 5150515]
//
// One team, a three-line game at default decisions, played in its ten worlds
// as the app plays it. Each line in turn takes every package it offers — and
// none — while the other two hold the default; the table is that line's ending
// surplus at years 5 and 10: the average across the worlds (what the pages
// show) beside the minimum and maximum world. Also prints the time per year.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { reinsuranceOptionsFor } from '../../src/utils/reinsuranceOptions';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, surplusRange } from '../../src/utils/worlds';
import { WORLD_COUNT } from '../../src/data/pricingParameters';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const i = process.argv.indexOf('--seed');
const SEED = i >= 0 ? Number(process.argv[i + 1]) : 5_150_515;
const M = (x: number) => `${(x / 1e6).toFixed(1)}`.padStart(7);

console.log(`TEN WORLDS BY PACKAGE — one team, three lines, ${WORLD_COUNT} worlds, seed ${SEED}`);
console.log('Ending surplus of the line, $M: average across worlds [min, max]\n');
console.log('line      package          year 5 avg [  min ,   max ]   year 10 avg [  min ,   max ]');

let ms = 0, years = 0;
for (const line of LINES) {
  for (const option of reinsuranceOptionsFor(line)) {
    const inst = generateGameInstance('WPKG', SEED);
    const setup = { poolName: 'P', gameLength: 10, startingYear: 2026, instanceId: 'WPKG', activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = openWorlds({
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    });
    for (let y = 1; y <= 10; y++) {
      const d = defaultDecisionSet(y);
      d.byLine[line].reinsuranceOption = option.id;
      const t0 = performance.now();
      const settled = settleWorldsYear(gs, playWorldsYear(gs, d), []);
      ms += performance.now() - t0; years++;
      gs = { ...gs, ...commitSettledYear(gs, settled), currentYearNumber: y + 1 };
    }
    const at = (y: number) => {
      const avg = gs.lockedResults[y - 1].byLine[line].endingSurplus;
      const r = surplusRange(gs, y, line)!;
      return `${M(avg)} [${M(r.min)}, ${M(r.max)}]`;
    };
    console.log(`${line.padEnd(9)} ${option.id.padEnd(15)} ${at(5)}    ${at(10)}`);
  }
}
console.log(`\ntime per year: ${(ms / years).toFixed(0)} ms, all ${WORLD_COUNT} worlds, three lines (mean of ${years} years)`);
