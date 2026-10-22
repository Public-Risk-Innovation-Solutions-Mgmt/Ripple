// ============================================================================
// THE PRE-GAME AND WHAT FOLLOWS IT, BY LINE — a REPORT, not a gate.
//
//   npx tsx scripts/diagnostics/pregame-years-report.ts            # all of it
//   PART=pregame npx tsx scripts/diagnostics/pregame-years-report.ts  # 1-3 only
//
// Single-player, all three lines, at the default decisions (funded at
// Expected). Written to compare one commit against another — run it on both.
//
//   1. THE SOLVED PRE-GAME MARGIN on every scenario, 1 to 20: the range and
//      every scenario below zero.
//   2. THE PRE-GAME'S RATES per $100 of exposure, by year, and the year-1 rate
//      struck at the opening: the mean over the scenarios, and how much each
//      year moves from the year before (the mean absolute change, and its
//      spread across scenarios).
//   3. THE ANNUAL STATEMENT AT GAME START: every section's columns, so what
//      appears before the first pre-game year can be seen.
//   4. PLAYED: investment income over years 1-5 and surplus at years 5 and 10,
//      on every scenario (mean and range).
//   5. PLAYED: the cumulative combined ratio over ten years on scenarios 1, 10
//      and 20.
// ============================================================================

import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, strikeRates } from '../../src/utils/worlds';
import { buildAnnualStatement } from '../../src/utils/resultsStatement';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { SCENARIO_OPTIONS } from '../../src/utils/scenarios';
import type { CoverageLine, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const PART = process.env.PART ?? 'all';
const f2 = (x: number) => x.toFixed(2);
const $ = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function open(id: string) {
  const { setup, instance } = openSoloInstance({
    poolName: 'R', gameLength: 10, startingYear: 2026, instanceId: id, activeLines: LINES,
  } as GameSetupSettings);
  const shocks = gameShocksOn(setup, instance);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const gs = openWorlds({
    setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [],
    currentDecisions: defaultDecisionSet(1, shocks), priorHistory, earlyPreGameHistory,
  } as GameState);
  return { gs, shocks, pre: [...(earlyPreGameHistory ?? []), ...priorHistory] };
}

// ---------------------------------------------------------------- 1-3
const margins: Record<CoverageLine, { id: string; m: number }[]> = { WC: [], GL: [], Property: [] };
const rates: Record<CoverageLine, number[][]> = { WC: [], GL: [], Property: [] };   // per scenario: 5 pre-game + year 1
let statementShown = false;
for (const id of SCENARIO_OPTIONS) {
  const { gs, shocks, pre } = open(id);
  const struck = strikeRates(gs, defaultDecisionSet(1, shocks));
  for (const line of LINES) {
    margins[line].push({ id, m: pre[pre.length - 1].byLine[line]!.decisions.fundingCushion ?? NaN });
    rates[line].push([...pre.map(r => r.byLine[line]!.finalRatePer100 ?? NaN), struck[line]!.quote.finalRatePer100]);
  }
  if (!statementShown) {
    statementShown = true;
    console.log(`=== 3. THE ANNUAL STATEMENT AT GAME START — scenario ${id} ===`);
    for (const scope of ['pool', ...LINES] as const) {
      const st = buildAnnualStatement(gs, scope as never);
      console.log(`  ${scope}: ` + st.sections.map(s => `${s.key} [${s.columns.join(' | ')}]`).join('  '));
    }
    const pg = pre.map(r => `${r.calendarYear}`);
    console.log(`  pre-game years in the game state: ${pg.join(', ')}; oldest cohort at the opening: `
      + LINES.map(l => `${l} ${Math.min(...(gs.poolState.lines[l].reserveCohorts ?? []).map(c => c.calendarYear))}`).join(', '));
  }
}

console.log('\n=== 1. THE SOLVED PRE-GAME MARGIN, ALL TWENTY SCENARIOS ===');
for (const line of LINES) {
  const ms = margins[line].map(x => x.m);
  const below = margins[line].filter(x => x.m < 0);
  console.log(`  ${line.padEnd(8)} mean ${(100 * mean(ms)).toFixed(2)}%  range ${(100 * Math.min(...ms)).toFixed(2)}% to ${(100 * Math.max(...ms)).toFixed(2)}%  `
    + `below zero: ${below.length ? below.map(x => `scenario ${x.id} ${(100 * x.m).toFixed(2)}%`).join(', ') : 'none'}`);
  console.log(`           by scenario: ${margins[line].map(x => `${x.id}:${(100 * x.m).toFixed(1)}`).join(' ')}`);
}

console.log('\n=== 2. THE PRE-GAME RATES PER $100, 2021-2025, AND THE YEAR-1 RATE (mean over scenarios) ===');
const labels = ['2021', '2022', '2023', '2024', '2025', '2026 (y1)'];
for (const line of LINES) {
  const byYear = labels.map((_, k) => mean(rates[line].map(r => r[k])));
  // Year-on-year change, per scenario, then its mean absolute and its spread.
  const chg = labels.slice(1).map((_, k) => rates[line].map(r => r[k + 1] / r[k] - 1));
  console.log(`  ${line.padEnd(8)} ` + labels.map((l, k) => `${l} ${f2(byYear[k])}`).join('  '));
  console.log(`           change from the year before: ` + labels.slice(1).map((l, k) => {
    const c = chg[k];
    return `${l} ${(100 * mean(c)).toFixed(1)}% (|mean| ${(100 * mean(c.map(Math.abs))).toFixed(1)}%, `
      + `${(100 * Math.min(...c)).toFixed(1)} to ${(100 * Math.max(...c)).toFixed(1)})`;
  }).join('  '));
}

if (PART !== 'pregame') {
  // ---------------------------------------------------------------- 4-5
  const inv: Record<CoverageLine, number[]> = { WC: [], GL: [], Property: [] };
  const s5: Record<CoverageLine, number[]> = { WC: [], GL: [], Property: [] };
  const s10: Record<CoverageLine, number[]> = { WC: [], GL: [], Property: [] };
  const cr: string[] = [];
  for (const id of SCENARIO_OPTIONS) {
    let { gs } = open(id);
    const { shocks } = open(id);
    for (let y = 1; y <= 10; y++) {
      gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y, shocks)), [])), currentYearNumber: y + 1 };
    }
    const rows = gs.lockedResults;
    for (const line of LINES) {
      inv[line].push(rows.slice(0, 5).reduce((a, r) => a + r.byLine[line]!.investmentIncome, 0));
      s5[line].push(rows[4].byLine[line]!.endingSurplus);
      s10[line].push(rows[9].byLine[line]!.endingSurplus);
    }
    if (['1', '10', '20'].includes(id)) {
      cr.push(`  scenario ${id.padStart(2)}: ` + LINES.map(line => {
        const charge = rows.reduce((a, r) => a + r.byLine[line]!.totalMemberCharge, 0);
        const c = rows.reduce((a, r) => a + r.byLine[line]!.actualCombinedRatio * r.byLine[line]!.totalMemberCharge, 0) / charge;
        return `${line} ${(100 * c).toFixed(1)}%`;
      }).join('  '));
    }
  }
  const range = (xs: number[]) => `${$(mean(xs))} (${$(Math.min(...xs))} to ${$(Math.max(...xs))})`;
  console.log('\n=== 4. PLAYED AT THE DEFAULTS — mean (range) over the twenty scenarios ===');
  for (const line of LINES) {
    console.log(`  ${line.padEnd(8)} investment income y1-5 ${range(inv[line])}   surplus y5 ${range(s5[line])}   surplus y10 ${range(s10[line])}`);
  }
  console.log('\n=== 5. CUMULATIVE COMBINED RATIO OVER TEN YEARS, AT EXPECTED ===');
  console.log(cr.join('\n'));
}
