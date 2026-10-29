// ============================================================================
// STABLE REGULAR YEARS AND A SIMULATED PRE-GAME — THE GATE (stable-scenarios commit 1).
//
//   npx tsx scripts/diagnostics/routine-fold-check.ts
//
// With ROUTINE_LARGE_LOSSES off and FLAT_PRE_GAME off:
//
//   1. COST-NEUTRAL: every line-year's expected loss equals what it was with
//      routine large claims ON and no fold, to float precision, years -10 to
//      15. ⚠ RESTATED FOR THE SHOCKS LANDING (2ae5c1a; ROUTINE_FOLD_NET_OF_UPLIFT
//      off): the fold is the routine claims' cost, NOT divided by (1 + the
//      expected uplift), and the shocks land wholly on top of it. So: with the
//      game's shocks off, the folded expectation is today's (ordinary +
//      routine) exactly, whatever the shock catalogue; with them on, it is
//      (today's ordinary + routine) x (1 + uplift) + today's shock large. (It
//      was: the folded total with shocks on equals today's total, the fold
//      giving the uplift back.) ON THE LINES
//      STILL ON THEIR DERIVED COST (Property): since commit 2, WC and GL are
//      priced on the pool's layered loss costs, and pool-loss-cost-check holds
//      them.
//   2. THE SHOCKS DO NOT GROW: the shocks' large losses (T) are the same with
//      the fold as without it — scaled off the unfolded ordinary cost.
//   3. NO ROUTINE CLAIM IS DRAWN: across played games, every large claim comes
//      from a shock.
//   4. A SIMULATED PRE-GAME AT TRUE COST: every pre-game year's year factor is
//      the factor drawn on the pre-game's own stream from the game's seed, and
//      nothing else (restated for the fixed-seed scenarios: it was the
//      scenario's multiple x that draw; the multiple is retired); it earns its allocation on
//      the average of PRE_GAME_MARKET_DRAWS markets, each on its own pre-game
//      stream; and no shock fires. (It was flat — the multiple exactly, and
//      PRE_GAME_INVESTMENT_RETURN.)
//
// ⚠ RESTATED FOR LARGE_CLAIMS_EVERY_GAME: large claims are now drawn in every
// game, shocks on or off, so expectedLossBreakdown(..., shocks=false) carries
// shockLarge (the large claims' expectation, the same as shocks-on's) — today's
// shocks-off total is no longer ordinary + routine alone, which is why 1's
// shocks-off half failed (38% off on Property). 1 now holds, with the shocks
// off: the folded normal losses PLUS the large claims' expectation are today's
// shocks-off expectation exactly, and that shockLarge equals shocks-on's.
// Nothing else changes: the fold itself, the shocks-on half, 2-4. New control:
// LARGE_CLAIMS_EVERY_GAME.enabled = false at runtime must fail 1.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: a fold divided by the uplift
// (the retired design), a fold that moves with the shock catalogue in a
// shocks-off game, T scaled off the folded cost, a routine claim slipped in, a flat
// pre-game, a pre-game drawn on the played years' streams, a pre-game on
// one market draw, and the retired scenario multiple put back on the draw.
// ============================================================================

import { FLAT_PRE_GAME, LARGE_CLAIMS_EVERY_GAME, POOL_LOSS_COST_LAYERS, ROUTINE_FOLD_NET_OF_UPLIFT, PRE_GAME_MARKET_DRAWS, ROUTINE_LARGE_LOSSES, SCENARIO_COUNT, SCENARIO_PREMIUM_TO_SURPLUS, SCENARIO_RATIO_RANGE } from '../../src/data/pricingParameters';
import { drawOrdinaryFactor, ordinaryLossRng, ordinaryYearCv } from '../../src/utils/ordinaryLoss';
import { blendInvestmentReturn, simulateMarketReturns, type MarketReturns } from '../../src/utils/investmentEngine';
import { deriveSubRng } from '../../src/utils/random';
import { baseOrdinaryLossCostPer100 } from '../../src/utils/ordinaryLoss';
import { expectedLossBreakdown, routineFoldPer100, upliftMoments } from '../../src/utils/shockExpectation';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import type { CoverageLine, GameSetupSettings, GameState, LineResultSet, ResultSet } from '../../src/types/simulation';
import { SOLO_SHOCKS } from '../../src/data/pricingParameters';
// ⚠ SHOCKS WERE OFF IN SINGLE-PLAYER (SOLO_SHOCKS), and this gate tests how
// fired shocks are handled through solo games, so it switched them on. Since
// the shocks landing SOLO_SHOCKS ships on (the catalogue draw); this stays as
// a guard should it be switched off again.
SOLO_SHOCKS.enabled = true;

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
// The lines the fold applies to — those not priced on the pool's layers.
const FOLDED: CoverageLine[] = LINES.filter(l => !POOL_LOSS_COST_LAYERS[l]);
const YEARS = Array.from({ length: 26 }, (_, i) => i - 10);
const E = 1000;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

if (ROUTINE_LARGE_LOSSES.enabled || FLAT_PRE_GAME.enabled) {
  console.log('This gate checks the shipped setting: ROUTINE_LARGE_LOSSES off, FLAT_PRE_GAME off.');
  process.exit(1);
}

// "Today": routine claims ON and no fold — read with the switch flipped, which
// zeroes the fold (routineFoldPer100) and restores the routine claims.
interface Today { total: number; ordinary: number; routine: number; shockLarge: number; offTotal: number }
const today = new Map<string, Today>();
ROUTINE_LARGE_LOSSES.enabled = true;
for (const l of FOLDED) for (const y of YEARS) {
  const b = expectedLossBreakdown(l, E, y);
  const off = expectedLossBreakdown(l, E, y, true, 1, false);
  today.set(`${l}|${y}`, { total: b.total, ordinary: b.ordinary, routine: b.routineLarge, shockLarge: b.shockLarge, offTotal: off.total });
}
ROUTINE_LARGE_LOSSES.enabled = false;

// ---------------------------------------------------------------- 1 & 2
type Fold = (l: CoverageLine, y: number) => number;
function gradeExpected(fold: Fold, tFromFolded: boolean, tag: string) {
  let worstTotal = 0, worstOff = 0, worstT = 0;
  for (const l of FOLDED) for (const y of YEARS) {
    const b = expectedLossBreakdown(l, E, y);
    // Rebuilt from its parts with the fold under test, so a wrong fold shows.
    const ordinary = E * 10_000 * (baseOrdinaryLossCostPer100(l, y) + fold(l, y));
    const u = upliftMoments(l, y).mean;
    const shockLarge = tFromFolded
      ? b.shockLarge * (baseOrdinaryLossCostPer100(l, y) + fold(l, y)) / baseOrdinaryLossCostPer100(l, y)
      : b.shockLarge;
    const total = ordinary * (1 + u) + shockLarge;
    const t = today.get(`${l}|${y}`)!;
    // Shocks on: the routine claims' cost, folded, takes the uplift with the
    // ordinary losses (it is normal loss now), and the shocks land on top.
    worstTotal = Math.max(worstTotal, rel(total, (t.ordinary + t.routine) * (1 + u) + t.shockLarge));
    // Shocks off (the shocks landing): the folded normal losses are today's
    // shocks-off expectation exactly — nothing in them moves with the catalogue.
    // ⚠ LARGE_CLAIMS_EVERY_GAME: plus the large claims' expectation, drawn in
    // every game — the shocks-off shockLarge, which is shocks-on's.
    const offLarge = expectedLossBreakdown(l, E, y, undefined, 1, false).shockLarge;
    worstOff = Math.max(worstOff, rel(ordinary + offLarge, t.offTotal), rel(offLarge, b.shockLarge));
    worstT = Math.max(worstT, rel(shockLarge, t.shockLarge));
  }
  check(worstTotal < 1e-12 && worstOff < 1e-12,
    `${tag}1. every line-year's expected loss is today's, the fold the routine claims' cost with the shocks on top (shocks off: the large claims' expectation on top), years -10 to 15 (${FOLDED.join(', ')})`,
    `worst relative ${worstTotal.toExponential(2)} shocks on, ${worstOff.toExponential(2)} shocks off`);
  check(worstT < 1e-12, `${tag}2. the shocks' large losses do not grow with the fold`, `worst relative ${worstT.toExponential(2)}`);
}

// ---------------------------------------------------------------- 3 & 4
interface Played { pre: ResultSet[]; game: ResultSet[]; seed: number }
function play(id: string, years: number): Played {
  const { setup, instance } = openSoloInstance({ poolName: 'F', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = { setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState;
  const game: ResultSet[] = [];
  for (let y = 1; y <= years; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    game.push(p.result);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return { pre: [...(earlyPreGameHistory ?? []), ...priorHistory], game, seed: instance.seed };
}
const games = ['RFC1', 'RFC2', 'RFC3', 'RFC4'].map(id => play(id, 10));
type Claims = (r: LineResultSet) => { shock: boolean }[];
const claimsOf: Claims = r => (r.claims ?? []).map(c => ({ shock: c.shockId !== undefined }));
type DrawOf = (seed: number, y: number, l: CoverageLine) => number;
type MarketOf = (seed: number, y: number) => MarketReturns;
function gradeGames(claims: Claims, drawOf: DrawOf, marketOf: MarketOf, tag: string) {
  let large = 0, routine = 0;
  for (const g of games) for (const r of g.game) for (const l of LINES) for (const c of claims(r.byLine[l]!)) { large++; if (!c.shock) routine++; }
  check(routine === 0, `${tag}3. no routine large claim is drawn — every large claim comes with a shock`, `${large} large claims in ${games.length} ten-year games, ${routine} routine`);
  let worstFactor = 0, worstReturn = 0, shocks = 0, years = 0;
  for (const g of games) for (const r of g.pre) for (const l of LINES) {
    const x = r.byLine[l]!;
    const n = x.newLossEngine!;
    years++;
    const want = drawOf(g.seed, r.yearNumber, l);
    worstFactor = Math.max(worstFactor, Math.abs(x.commonLossFactor / want - 1));
    const rate = blendInvestmentReturn(1, x.assetAllocation, marketOf(g.seed, r.yearNumber)).returnRate;
    worstReturn = Math.max(worstReturn, Math.abs(x.investmentReturnRate - rate));
    shocks += n.shockLargeClaims + (n.uplift !== 0 ? 1 : 0);
  }
  check(worstFactor < 1e-12 && worstReturn < 1e-12 && shocks === 0,
    `${tag}4. a simulated pre-game at true cost: its own draw and nothing else, the market drawn, on the pre-game's own streams; no shock`,
    `${years} pre-game line-years; worst factor off ${worstFactor.toExponential(2)}, worst return off ${worstReturn.toExponential(2)}, ${shocks} shocks`);
}

console.log('STABLE REGULAR YEARS AND A SIMULATED PRE-GAME');
const shipped: Fold = routineFoldPer100;
gradeExpected(shipped, false, '');
const drawOf: DrawOf = (seed, y, l) => drawOrdinaryFactor(ordinaryLossRng(seed, y, l), ordinaryYearCv(l));
// The average of PRE_GAME_MARKET_DRAWS markets, each on its own stream — rebuilt here, not read from the engine.
const avgOf = (labels: string[]): MarketOf => (seed, y) => {
  const ms = labels.map(l => simulateMarketReturns(deriveSubRng(seed, y, l)));
  const avg = (f: (m: MarketReturns) => number) => ms.reduce((a, m) => a + f(m), 0) / ms.length;
  return { cash: avg(m => m.cash), bonds: avg(m => m.bonds), equities: avg(m => m.equities) };
};
const marketOf = avgOf(Array.from({ length: PRE_GAME_MARKET_DRAWS }, (_, k) => `pregame_invest_${k}`));
gradeGames(claimsOf, drawOf, marketOf, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
// The retired design (ROUTINE_FOLD_NET_OF_UPLIFT on): the fold divided by (1 + the uplift).
controlFails('a fold divided by the uplift (the retired design)', () => gradeExpected((l, y) => routineFoldPer100(l, y) / (1 + upliftMoments(l, y).mean), false, ''), '1.');
// And through the engine: the switch flipped on at runtime, the shipped fold read again.
controlFails('the engine\'s fold with ROUTINE_FOLD_NET_OF_UPLIFT switched on', () => {
  ROUTINE_FOLD_NET_OF_UPLIFT.enabled = true;
  try { gradeExpected(routineFoldPer100, false, ''); } finally { ROUTINE_FOLD_NET_OF_UPLIFT.enabled = false; }
}, '1.');
controlFails('LARGE_CLAIMS_EVERY_GAME switched off (no large claims with the shocks off)', () => {
  LARGE_CLAIMS_EVERY_GAME.enabled = false;
  try { gradeExpected(routineFoldPer100, false, ''); } finally { LARGE_CLAIMS_EVERY_GAME.enabled = true; }
}, '1.');
controlFails('T scaled off the folded cost', () => gradeExpected(shipped, true, ''), '2.');
controlFails('a routine claim slipped in', () => gradeGames(r => [...claimsOf(r), { shock: false }], drawOf, marketOf, ''), '3.');
controlFails('a flat pre-game (no draw)', () => gradeGames(claimsOf, () => 1, marketOf, ''), '4.');
controlFails('a pre-game drawn on the played years\' streams', () => gradeGames(claimsOf,
  (seed, y, l) => drawOrdinaryFactor(deriveSubRng(seed, y, `ordinary_${l}`), ordinaryYearCv(l)),
  (seed, y) => simulateMarketReturns(deriveSubRng(seed, y, 'invest')), ''), '4.');
controlFails('a pre-game on one market draw', () => gradeGames(claimsOf, drawOf, avgOf(['pregame_invest_0']), ''), '4.');
// The retired scenario multiple, rebuilt here: 1 + (1 - the line's midpoint /
// the target) x 0.3, on the scenario a bare id used to fall on (seed % 20 + 1).
const retiredMultiple = (seed: number, l: CoverageLine) => {
  const mid = (SCENARIO_RATIO_RANGE[l].thinnest + SCENARIO_RATIO_RANGE[l].richest) / 2;
  return 1 + (1 - mid / SCENARIO_PREMIUM_TO_SURPLUS[l][(seed % SCENARIO_COUNT) + 1]) * 0.3;
};
controlFails('the retired scenario multiple put back on the draw', () => gradeGames(claimsOf,
  (seed, y, l) => retiredMultiple(seed, l) * drawOf(seed, y, l), marketOf, ''), '4.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — expected loss unchanged line-year by line-year, the shocks unchanged, no routine claim, and a simulated pre-game on its own streams.');
