// ============================================================================
// HOW BIG ONE YEAR'S RESULT AND THE SAVE ARE. Read-only; asserts nothing —
// result-size-check is the gate.
//
//   npx tsx scripts/tools/result-size-report.ts [--games 3]
//
// Three-line games at default decisions. Prints, as means over the games:
// one year's pooled ResultSet serialised (year 5), and the save at years 5 and
// 10 — raw (serialiseSave) and as stored (packSave). Written to measure the
// result before and after the member cut (loss engine commit 3a), because ten
// worlds come next and multiply the result by ten.
//
// ⚠ TEN WORLDS SINCE LOSS ENGINE COMMIT 4b: the games run as the app runs them
// (worlds.ts), so the save carries every world, and the time per played year
// — all worlds — is measured beside the sizes.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { packSave, serialiseSave } from '../../src/utils/gameSave';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const i = process.argv.indexOf('--games');
const GAMES = i >= 0 ? Number(process.argv[i + 1]) : 3;

export interface SizeMeasure {
  result5: number; save5Raw: number; save5Packed: number; save10Raw: number; save10Packed: number;
  /** Mean wall-clock milliseconds per played year, every world included. */
  msPerYear: number;
}

export function measureSizes(games: number): SizeMeasure {
  const acc: SizeMeasure = { result5: 0, save5Raw: 0, save5Packed: 0, save10Raw: 0, save10Packed: 0, msPerYear: 0 };
  for (let g = 0; g < games; g++) {
    const id = `RSZ${g}`;
    const inst = generateGameInstance(id, 6_060_606 + g * 7717);
    const setup = { poolName: 'S', gameLength: 10, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory, startingFinancials } = runPriorHistory(inst, setup as never);
    let gs: GameState = openWorlds({
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    });
    for (let y = 1; y <= 10; y++) {
      const t0 = performance.now();
      const played = playWorldsYear(gs, defaultDecisionSet(y));
      const settled = settleWorldsYear(gs, played, []);
      acc.msPerYear += (performance.now() - t0) / 10;
      gs = {
        ...gs, ...commitSettledYear(gs, settled),
        currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1),
      };
      if (y === 5) acc.result5 += JSON.stringify(settled.result).length;
      if (y === 5 || y === 10) {
        const env = { gameState: gs, startingFinancials, initialMembers: [], currentDecisions: gs.currentDecisions };
        const raw = serialiseSave(env as never).length;
        const packed = packSave(env as never).length;
        if (y === 5) { acc.save5Raw += raw; acc.save5Packed += packed; } else { acc.save10Raw += raw; acc.save10Packed += packed; }
      }
    }
  }
  for (const k of Object.keys(acc) as (keyof SizeMeasure)[]) acc[k] /= games;
  return acc;
}

if (process.argv[1]?.endsWith('result-size-report.ts')) {
  const m = measureSizes(GAMES);
  const KB = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`RESULT AND SAVE SIZE — ${GAMES} three-line games, default decisions, means\n`);
  console.log(`one year's result (year 5, raw JSON)   ${KB(m.result5)}`);
  console.log(`save at year 5    raw ${KB(m.save5Raw)}   stored ${KB(m.save5Packed)}`);
  console.log(`save at year 10   raw ${KB(m.save10Raw)}   stored ${KB(m.save10Packed)}`);
  console.log(`time per year     ${m.msPerYear.toFixed(0)} ms, every world`);
}
