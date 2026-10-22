// ============================================================================
// THE OPENING POSITION, BY LINE — a REPORT, not a gate.
//
//   npx tsx scripts/diagnostics/opening-position-report.ts
//
// Every scenario (1 to 20), single-player, all three lines: at the start of
// year 1, each line's net reserve, its loss expense reserve, its required
// capital (the reserve risk margin on the net reserve, plus Property's
// catastrophe charge when the game's shocks are on), its surplus, the
// pre-game's solved funding margin, and year-1 premium at Expected. Printed as
// the mean over the scenarios, and the range. Written to compare one commit
// against another — run it on both.
// ============================================================================

import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { openWorlds, strikeRates } from '../../src/utils/worlds';
import { requiredCapital, openingCatCapital } from '../../src/utils/openingReserves';
import { lossExpenseReserve } from '../../src/utils/lossExpense';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { SCENARIO_OPTIONS } from '../../src/utils/scenarios';
import type { CoverageLine, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
type Row = { reserve: number; lae: number; required: number; surplus: number; margin: number; premium: number; oldest: number };
const rows: Record<CoverageLine, Row[]> = { WC: [], GL: [], Property: [] };

for (const id of SCENARIO_OPTIONS) {
  const { setup, instance } = openSoloInstance({
    poolName: 'Open', gameLength: 5, startingYear: 2026, instanceId: id, activeLines: LINES,
  } as GameSetupSettings);
  const shocks = gameShocksOn(setup, instance);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const gs = openWorlds({
    setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [],
    currentDecisions: defaultDecisionSet(1, shocks), priorHistory, earlyPreGameHistory,
  } as GameState);
  const struck = strikeRates(gs, defaultDecisionSet(1, shocks));
  for (const line of LINES) {
    const ls = poolState.lines[line];
    const cohorts = ls.reserveCohorts ?? [];
    const open = cohorts.filter(c => !c.closed && c.netUnpaid > 0);
    const s = struck[line]!;
    rows[line].push({
      reserve: ls.netUnpaidReserve,
      lae: lossExpenseReserve(line, cohorts),
      required: requiredCapital(line, ls.netUnpaidReserve) + (shocks ? openingCatCapital(line, { exposure: s.exposure }, true) : 0),
      surplus: ls.surplus,
      margin: priorHistory[priorHistory.length - 1].byLine[line]?.decisions.fundingCushion ?? NaN,
      premium: s.quote.finalRatePer100 * s.exposure * 10_000,
      oldest: open.length ? Math.min(...open.map(c => c.calendarYear)) : NaN,
    });
  }
}

const m = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const $ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const range = (xs: number[], f: (x: number) => string) => `${f(Math.min(...xs))}–${f(Math.max(...xs))}`;
console.log(`OPENING POSITION AT THE START OF YEAR 1 — ${SCENARIO_OPTIONS.length} scenarios, single-player, mean (range)`);
for (const line of LINES) {
  const r = rows[line];
  const col = (k: keyof Row, f: (x: number) => string) => `${f(m(r.map(x => x[k])))} (${range(r.map(x => x[k]), f)})`;
  console.log(`\n${line}`);
  console.log(`  net reserve           ${col('reserve', $)}`);
  console.log(`  loss expense reserve  ${col('lae', $)}`);
  console.log(`  required capital      ${col('required', $)}`);
  console.log(`  surplus               ${col('surplus', $)}`);
  console.log(`  solved pre-game margin ${col('margin', x => `${(100 * x).toFixed(2)}%`)}`);
  console.log(`  year-1 premium at Expected ${col('premium', $)}`);
  console.log(`  oldest open accident year ${col('oldest', x => x.toFixed(0))}`);
}
