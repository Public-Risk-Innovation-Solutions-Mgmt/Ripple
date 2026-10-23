// ============================================================================
// SHOCKS OUT OF THE EXPERIENCE, AND NO CATASTROPHE LOAD — THE GATE
// (stable-scenarios commit 7; the load removed after it, as double-counting).
//
//   npx tsx scripts/diagnostics/catastrophe-load-check.ts
//
//   1. RECORDED: every accident year's ledger row carries its shock dollars as
//      booked — its gross less its ordinary losses: the uplift on them and the
//      shocks' large losses — and an averaged ledger carries the worlds' mean.
//   2. TAKEN OUT ON THE PAID BASIS, BEFORE DEVELOPMENT: each window year's
//      paid-to-date loses exactly its shock dollars / the LDF at its age, and
//      is then developed — so a year's shocks leave its developed figure whole.
//   3. NO LOAD IS CHARGED: catastropheLoadPer100 is 0 on every line in every
//      year, the pre-game's included — the pool's supplied loss costs already
//      carry its historical large events. Switched back on, the dormant load is
//      still the shocks' expected cost at year 3, trended at the line's rate.
//   4. THE PURE PREMIUM IS THE EXPERIENCE WITHOUT SHOCKS, before ALAE and
//      ULAE, from the ledgers of played games; and a book with no usable
//      history prices its ordinary expectation alone, no shock expectation.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: a year whose shocks were not
// recorded, shocks taken out after development (at ultimate, not paid), the
// load left on, and a pure premium that still carries the load.
// ============================================================================

import { CATASTROPHE_LOAD, CATASTROPHE_LOAD_STEADY_YEAR, SEVERITY_TREND_PER_YEAR, PRICING_DATA_LAG_YEARS } from '../../src/data/pricingParameters';
import { bookPurePremium, catastropheLoadPer100, newPurePremiumPer100 } from '../../src/utils/newPurePremium';
import { expectedLossBreakdown } from '../../src/utils/shockExpectation';
import { bookedCostLevel } from '../../src/utils/ordinaryLoss';
import { averageLedger } from '../../src/utils/worlds';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import type { CoverageLine, GameSetupSettings, GameState, PoolState, ReserveDevelopmentRow, ResultSet } from '../../src/types/simulation';
import { SOLO_SHOCKS } from '../../src/data/pricingParameters';
// ⚠ SHOCKS ARE OFF IN SINGLE-PLAYER (SOLO_SHOCKS, pending the data scientist),
// and this gate tests how fired shocks are handled — which hosted games still
// do — through solo games. Their schedule is switched on here so it has
// shocks to test, rather than passing on none.
SOLO_SHOCKS.enabled = true;

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
        // Valued at the end of the latest data year (PRICING_DATA_LAG_YEARS), clamped forward.
        const k = Math.min(i + 1 - PRICING_DATA_LAG_YEARS - row.firstValuationYear, row.grossPaidByValuation!.length - 1);
        const paid = row.grossPaidByValuation![k];
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
  let charged = 0, worstDormant = 0, worstGrowth = 0;
  for (const l of LINES) for (let y = -4; y <= 12; y++) charged = Math.max(charged, Math.abs(load(l, y, 1000)));
  // The dormant load, switched on for a moment, is still what it was built to be.
  CATASTROPHE_LOAD.enabled = true;
  for (const l of LINES) {
    const b = expectedLossBreakdown(l, 1000, CATASTROPHE_LOAD_STEADY_YEAR);
    for (let y = -4; y <= 12; y++) {
      const want = (b.uplift + b.shockLarge) / 1e7 * bookedCostLevel(l, y) / bookedCostLevel(l, CATASTROPHE_LOAD_STEADY_YEAR);
      worstDormant = Math.max(worstDormant, Math.abs(catastropheLoadPer100(l, y, 1000) / want - 1));
      if (y < 12) worstGrowth = Math.max(worstGrowth, Math.abs(catastropheLoadPer100(l, y + 1, 1000) / catastropheLoadPer100(l, y, 1000) - (1 + SEVERITY_TREND_PER_YEAR[l])));
    }
  }
  CATASTROPHE_LOAD.enabled = false;
  check(charged === 0 && worstDormant < 1e-12 && worstGrowth < 1e-12,
    `${tag}3. no catastrophe load is charged, any line, any year; the dormant load is still the year-${CATASTROPHE_LOAD_STEADY_YEAR} cost, trended`,
    `largest charged ${charged}; dormant worst relative ${Math.max(worstDormant, worstGrowth).toExponential(2)}`);
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
      worst = Math.max(worst, rel(pp.lossCostPer100 * 1e6, carried(exShock, load) * 1e6));
    }
  });
  // With no history at all: the ordinary expectation, nothing for the shocks.
  let worstFallback = 0;
  for (const l of LINES) for (const y of [-4, 1, 5]) {
    const pp = bookPurePremium(l, y, { rows: [], allMarketMembers: [], membershipHistory: {} as never }, 1000);
    const b = expectedLossBreakdown(l, 1000, y);
    worstFallback = Math.max(worstFallback, rel(pp.lossCostPer100 * 1e6, carried(b.ordinary / 1e7, catastropheLoadPer100(l, y, 1000)) * 1e6));
  }
  check(worst < 1e-9 && worstFallback < 1e-9, `${tag}4. the pure premium's loss cost is the experience without its shocks; with no history, the ordinary expectation`,
    `${n} line-years priced; worst relative ${Math.max(worst, worstFallback).toExponential(2)}`);
}

console.log('SHOCKS OUT OF THE EXPERIENCE, AND NO CATASTROPHE LOAD');
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
controlFails('the load left on', () => gradeLoad((l, y, e) => {
  const b = expectedLossBreakdown(l, e, CATASTROPHE_LOAD_STEADY_YEAR);
  return (b.uplift + b.shockLarge) / (e * 10_000) * bookedCostLevel(l, y) / bookedCostLevel(l, CATASTROPHE_LOAD_STEADY_YEAR);
}, ''), '3.');
controlFails('a pure premium that still carries the load', () => gradeCarried((x, l) => x + l + 0.01, ''), '4.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — shock dollars recorded and kept out of the experience on the paid basis, and no catastrophe load charged.');
