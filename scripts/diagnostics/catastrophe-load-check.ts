// ============================================================================
// THE STEADY CATASTROPHE LOAD — THE GATE (stable-scenarios commit 7).
//
//   npx tsx scripts/diagnostics/catastrophe-load-check.ts
//
//   1. RECORDED: every accident year's ledger row carries its shock dollars as
//      booked — its gross less its ordinary losses: the uplift on them and the
//      shocks' large losses — and an averaged ledger carries the worlds' mean.
//   2. TAKEN OUT ON THE PAID BASIS, BEFORE DEVELOPMENT: each window year's
//      paid-to-date loses exactly its shock dollars / the LDF at its age, and
//      is then developed — so a year's shocks leave its developed figure whole.
//   3. THE LOAD: per $100, the shocks' expected cost at the catalogue's
//      probabilities at year 3 (every duration in force), trended at the
//      line's booked cost level — so year on year it grows at the line's
//      trend — and it is charged in the pre-game's years as in play.
//   4. THE PURE PREMIUM CARRIES IT: experience without shocks + the load,
//      before ALAE and ULAE, from the ledgers of played games.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: a year whose shocks were not
// recorded, shocks taken out after development (at ultimate, not paid), a
// load struck at year 1, and a pure premium without the load.
// ============================================================================

import { CATASTROPHE_LOAD_STEADY_YEAR, SEVERITY_TREND_PER_YEAR } from '../../src/data/pricingParameters';
import { catastropheLoadPer100, newPurePremiumPer100 } from '../../src/utils/newPurePremium';
import { expectedLossBreakdown } from '../../src/utils/shockExpectation';
import { bookedCostLevel } from '../../src/utils/ordinaryLoss';
import { averageLedger } from '../../src/utils/worlds';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import type { CoverageLine, GameSetupSettings, GameState, PoolState, ReserveDevelopmentRow, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

interface Played { results: ResultSet[]; states: PoolState[] }
function play(id: string, years: number): Played {
  const { setup, instance } = openSoloInstance({ poolName: 'C', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = { setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState;
  const results: ResultSet[] = [], states: PoolState[] = [];
  for (let y = 1; y <= years; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    results.push(p.result);
    states.push(p.updatedPoolState);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return { results, states };
}
const games = ['CLC1', 'CLC2', 'CLC3', 'CLC4', 'CLC5', 'CLC6'].map(id => play(id, 10));

// ---------------------------------------------------------------- 1
type RowShock = (row: ReserveDevelopmentRow | undefined) => number;
const shippedRowShock: RowShock = row => row?.shockGross ?? 0;
function gradeRecorded(rowShock: RowShock, tag: string) {
  let worst = 0, years = 0, shocked = 0;
  for (const g of games) g.results.forEach((r, i) => {
    for (const l of LINES) {
      const x = r.byLine[l]!, n = x.newLossEngine!;
      const gross = x.bookedGrossUltimate ?? x.grossUltimateLoss;
      const want = gross - (gross - n.shockLarge) / (1 + n.uplift);
      const row = g.states[i].lines[l]?.reserveDevelopment?.find(z => z.yearNumber === r.yearNumber);
      years++;
      if (want > 1) shocked++;
      worst = Math.max(worst, rel(rowShock(row), want));
    }
  });
  // An averaged ledger carries the mean (a world with none counting 0).
  const rows = games.slice(0, 3).map(g => g.states[9].lines.GL?.reserveDevelopment ?? []);
  const avg = averageLedger(rows);
  const worstAvg = Math.max(...avg.map(a => rel(a.shockGross ?? 0, rows.reduce((s, w) => s + (w.find(z => z.yearNumber === a.yearNumber)?.shockGross ?? 0), 0) / rows.length)));
  check(worst < 1e-6 && worstAvg < 1e-9 && shocked > 0,
    `${tag}1. each year's ledger row carries its shock dollars as booked; an averaged ledger their mean`,
    `${years} line-years, ${shocked} with shocks; worst relative ${worst.toExponential(2)}`);
}

// ---------------------------------------------------------------- 2
type Taken = (shock: number, ldf: number) => number;
const shippedTaken: Taken = (shock, ldf) => shock / ldf;
function gradeRemoval(taken: Taken, tag: string) {
  let worst = 0, points = 0, withShock = 0;
  for (const g of games) g.states.forEach((st, i) => {
    for (const l of LINES) {
      const rows = st.lines[l]?.reserveDevelopment ?? [];
      const pp = newPurePremiumPer100(l, i + 2, { rows, allMarketMembers: [], membershipHistory: {} as never });
      for (const p of pp?.points ?? []) {
        const row = rows.find(r => r.yearNumber === p.accidentYear)!;
        const paid = row.grossPaidByValuation![row.grossPaidByValuation!.length - 1];
        const shock = row.shockGross ?? 0;
        points++;
        if (shock > 0) withShock++;
        worst = Math.max(worst, rel(p.groundUpPaid, Math.max(0, paid - taken(shock, p.ldf))),
          rel(p.developed, Math.max(0, paid - taken(shock, p.ldf)) * p.ldf));
      }
    }
  });
  check(worst < 1e-9 && withShock > 0,
    `${tag}2. each window year loses its shock dollars on the paid basis (shock / LDF) before it is developed`,
    `${points} priced accident years, ${withShock} with shocks; worst relative ${worst.toExponential(2)}`);
}

// ---------------------------------------------------------------- 3
type Load = (l: CoverageLine, y: number, e: number) => number;
function gradeLoad(load: Load, tag: string) {
  let worstDef = 0, worstGrowth = 0, preGame = Infinity;
  const shown: string[] = [];
  for (const l of LINES) {
    const e = 1000;
    const b = expectedLossBreakdown(l, e, CATASTROPHE_LOAD_STEADY_YEAR);
    for (let y = -4; y <= 12; y++) {
      const want = (b.uplift + b.shockLarge) / (e * 10_000) * bookedCostLevel(l, y) / bookedCostLevel(l, CATASTROPHE_LOAD_STEADY_YEAR);
      worstDef = Math.max(worstDef, Math.abs(load(l, y, e) / want - 1));
      if (y < 12) worstGrowth = Math.max(worstGrowth, Math.abs(load(l, y + 1, e) / load(l, y, e) - (1 + SEVERITY_TREND_PER_YEAR[l])));
      if (y <= 0) preGame = Math.min(preGame, load(l, y, e));
    }
    shown.push(`${l} $${load(l, 1, e).toFixed(4)}`);
  }
  check(worstDef < 1e-12 && worstGrowth < 1e-12 && preGame > 0,
    `${tag}3. the load is the shocks' expected cost at year ${CATASTROPHE_LOAD_STEADY_YEAR}, trended at the line's rate, charged from the pre-game on`,
    `year 1 per $100: ${shown.join(', ')}`);
}

// ---------------------------------------------------------------- 4
type Carried = (exShock: number, load: number) => number;
function gradeCarried(carried: Carried, tag: string) {
  let worst = 0, n = 0;
  for (const g of games) g.states.forEach((st, i) => {
    for (const l of LINES) {
      const rows = st.lines[l]?.reserveDevelopment ?? [];
      const pp = newPurePremiumPer100(l, i + 2, { rows, allMarketMembers: [], membershipHistory: {} as never });
      if (!pp) continue;
      n++;
      const exShock = pp.points.reduce((s, p) => s + p.trendedLossCostPer100, 0) / pp.points.length;
      const load = catastropheLoadPer100(l, i + 2, pp.points[pp.points.length - 1].exposure);
      worst = Math.max(worst, rel(pp.lossCostPer100 * 1e6, carried(exShock, load) * 1e6),
        rel(pp.catastropheLoadPer100 * 1e6, load * 1e6));
    }
  });
  check(worst < 1e-9, `${tag}4. the pure premium's loss cost is the experience without its shocks + the load`,
    `${n} line-years priced; worst relative ${worst.toExponential(2)}`);
}

console.log('THE STEADY CATASTROPHE LOAD');
gradeRecorded(shippedRowShock, '');
gradeRemoval(shippedTaken, '');
gradeLoad(catastropheLoadPer100, '');
gradeCarried((x, l) => x + l, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('a year whose shocks were not recorded', () => gradeRecorded(row => (row && row.yearNumber === 3 ? 0 : shippedRowShock(row)), ''), '1.');
controlFails('shocks taken out at ultimate, after development', () => gradeRemoval(shock => shock, ''), '2.');
controlFails('a load struck at year 1', () => gradeLoad((l, y, e) => {
  const b = expectedLossBreakdown(l, e, 1);
  return (b.uplift + b.shockLarge) / (e * 10_000) * bookedCostLevel(l, y) / bookedCostLevel(l, 1);
}, ''), '3.');
controlFails('a pure premium without the load', () => gradeCarried(x => x, ''), '4.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — shock dollars recorded, taken out on the paid basis, and priced as a steady trended load from the pre-game on.');
