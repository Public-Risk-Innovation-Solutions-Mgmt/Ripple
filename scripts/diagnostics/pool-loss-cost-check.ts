// ============================================================================
// THE POOL'S LOSS COSTS AND REQUIRED CAPITAL AT 80% — THE GATE
// (stable-scenarios commit 2).
//
//   npx tsx scripts/diagnostics/pool-loss-cost-check.ts
//
//   1. WC AND GL ARE PRICED ON THE POOL'S LAYERS: each line's ordinary claims
//      cost per $100 is the sum of its layers ($0 – $1M + $1M – $5M) — the
//      pool's pure premium — less its ULAE share (/ 1.05, since the pure-premium
//      basis), trended by accident year, with no routine fold, years -10 to 15.
//   2. NOTHING ELSE IS ORDINARY: their expected loss is the ordinary cost x
//      (1 + the A uplift) plus the shocks' large losses — no routine claims.
//   3. THE SHOCKS SCALE OFF THE $0 – $1M LAYER on WC and GL, and off Property's
//      cost without the fold.
//   4. REQUIRED CAPITAL AT 80%: both margin constants read 0.80, the opening's
//      required capital is reserves x (CLF at 80% - 1), and so is every played
//      year's reserve margin.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: the $1M – $5M layer left out,
// a fold left on WC, T scaled off the full layer sum, and a margin at 90%.
// ============================================================================

import {
  POOL_LOSS_COST_LAYERS, RESERVE_MARGIN_CONFIDENCE_PARAM, SHOCK_T_BASIS_PER_100, ULAE_OF_LOSS_COST,
} from '../../src/data/pricingParameters';
import { RESERVE_MARGIN_CONFIDENCE, staticClf, type StaticClfLine } from '../../src/data/clfTables';
import { bookedCostLevel, ordinaryLossCostPer100 } from '../../src/utils/ordinaryLoss';
import { expectedLossBreakdown, upliftMoments } from '../../src/utils/shockExpectation';
import { rModelOrdinary, tScale } from '../../src/utils/shockLosses';
import { requiredCapital } from '../../src/utils/openingReserves';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import type { CoverageLine, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

const LAYERED: CoverageLine[] = ['WC', 'GL'];
const LINES: StaticClfLine[] = ['WC', 'GL', 'Property'];
const YEARS = Array.from({ length: 26 }, (_, i) => i - 10);
const E = 1000;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
// The booked cost level: the trend to the year and, since commit 3, the
// inflation before payment booked up front (trend-up-front-check holds it).
const trend = (l: CoverageLine, y: number) => bookedCostLevel(l, y);

// ---------------------------------------------------------------- 1 & 2
type Layers = (l: CoverageLine) => number;
const shippedLayers: Layers = l => (POOL_LOSS_COST_LAYERS[l] ?? []).reduce((a, x) => a + x.per100, 0);
// The claims the engine draws: the pure premium less its ULAE share.
const claimsOf = (layers: Layers): Layers => l => layers(l) / (1 + ULAE_OF_LOSS_COST[l]);
function gradeCosts(layers: Layers, cost: (l: CoverageLine, y: number) => number, tag: string) {
  let worstCost = 0, worstTotal = 0, routine = 0;
  for (const l of LAYERED) for (const y of YEARS) {
    worstCost = Math.max(worstCost, rel(cost(l, y), claimsOf(layers)(l) * trend(l, y)));
    const b = expectedLossBreakdown(l, E, y);
    routine += b.routineLarge;
    worstTotal = Math.max(worstTotal, rel(b.total, E * 10_000 * cost(l, y) * (1 + upliftMoments(l, y).mean) + b.shockLarge));
  }
  check(worstCost < 1e-12, `${tag}1. WC and GL's ordinary claims cost is the pool's layers less their ULAE share, trended, no fold`,
    `pure premium WC $${layers('WC').toFixed(3)}, GL $${layers('GL').toFixed(3)}; claims WC $${claimsOf(layers)('WC').toFixed(4)}, `
    + `GL $${claimsOf(layers)('GL').toFixed(4)} per $100 in year 1; worst relative ${worstCost.toExponential(2)}`);
  check(worstTotal < 1e-12 && routine === 0, `${tag}2. their expected loss is ordinary x (1 + uplift) + the shocks' large losses, no routine`,
    `worst relative ${worstTotal.toExponential(2)}; routine $${routine.toFixed(0)}`);
}

// ---------------------------------------------------------------- 3
function gradeShockBasis(basis: (l: CoverageLine) => number, tag: string) {
  let worst = 0;
  for (const l of LINES) for (const y of YEARS) {
    worst = Math.max(worst, rel(tScale(l, E, y), E * 10_000 * basis(l) * trend(l, y) / rModelOrdinary(l)));
  }
  check(worst < 1e-12 && SHOCK_T_BASIS_PER_100.WC === 2.5 && SHOCK_T_BASIS_PER_100.GL === 2.5,
    `${tag}3. the shocks scale off the $0 – $1M layer on WC and GL ($2.50), and Property's unfolded cost`,
    `worst relative ${worst.toExponential(2)}`);
}

// ---------------------------------------------------------------- 4
const { setup, instance } = openSoloInstance({ poolName: 'L', gameLength: 3, startingYear: 2026, instanceId: 'PLC1', activeLines: LINES } as GameSetupSettings);
const { poolState, priorHistory } = runPriorHistory(instance, setup);
let gs = { setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory } as GameState;
const played: LineResultSet[] = [];
for (let y = 1; y <= 3; y++) {
  const p = processYear(gs, defaultDecisionSet(y));
  for (const l of LINES) played.push(p.result.byLine[l] as LineResultSet);
  gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
}
function gradeMargin(level: number, tag: string) {
  let worstOpen = 0, worstPlayed = 0;
  for (const l of LINES) worstOpen = Math.max(worstOpen, rel(requiredCapital(l, 1e7), 1e7 * (staticClf(l, level) - 1)));
  for (const r of played) {
    worstPlayed = Math.max(worstPlayed, rel(r.reserveRiskMarginNeeded - r.catCapitalNeeded, r.expectedNetUnpaidLoss * (staticClf(r.line as StaticClfLine, level) - 1)));
  }
  check(RESERVE_MARGIN_CONFIDENCE === 0.8 && RESERVE_MARGIN_CONFIDENCE_PARAM === 0.8 && worstOpen < 1e-12 && worstPlayed < 1e-9,
    `${tag}4. required capital = reserves x (CLF at 80% - 1), at the opening and every played year`,
    `CLF80 ${LINES.map(l => `${l} ${staticClf(l, 0.8).toFixed(4)}`).join(', ')}; worst relative ${Math.max(worstOpen, worstPlayed).toExponential(2)}`);
}

console.log('THE POOL\'S LOSS COSTS AND REQUIRED CAPITAL AT 80%');
gradeCosts(shippedLayers, ordinaryLossCostPer100, '');
gradeShockBasis(l => SHOCK_T_BASIS_PER_100[l], '');
gradeMargin(0.8, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('the $1M – $5M layer left out', () => gradeCosts(l => POOL_LOSS_COST_LAYERS[l]![0].per100, ordinaryLossCostPer100, ''), '1.');
controlFails('claims drawn at the full pure premium (ULAE on top)', () => gradeCosts(shippedLayers, (l, y) => ordinaryLossCostPer100(l, y) * (1 + ULAE_OF_LOSS_COST[l]), ''), '1.');
controlFails('a fold left on WC', () => gradeCosts(shippedLayers, (l, y) => ordinaryLossCostPer100(l, y) + (l === 'WC' ? 0.4 : 0), ''), '1.');
controlFails('T scaled off the full layer sum', () => gradeShockBasis(l => (l === 'Property' ? SHOCK_T_BASIS_PER_100[l] : shippedLayers(l)), ''), '3.');
controlFails('a margin at 90%', () => gradeMargin(0.9, ''), '4.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — WC and GL on the pool\'s layers, the shocks off the $0 – $1M layer, and required capital at 80%.');
