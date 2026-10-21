// THE REINSURANCE TOWER IS PRICED AT RUNTIME — this is what guards it, ON THE
// NEW ENGINE (book mode, MEMBER_LEVEL off), as the game runs.
//
// Run: npx tsx scripts/diagnostics/tower-runtime-check.ts
//
// ============================================================================
// FORKED FROM tower-runtime-member-check, which is dormant with the old member
// engine. That gate guarded the member path's band moments: their memo key, the
// algebra against the per-claim generators, and a shared-factor floor. On a
// book the tower is priced by newEngineLayerMoments on the new engine's own
// large losses (shockExpectation.ts), so the same concerns are asked of THAT:
//
//   1. PURITY — the memo key's successor. A cached price keyed wrongly prices
//      one year's tower with another's figures and stays self-consistent. Every
//      year evaluated cold must equal the same year evaluated warm and out of
//      order, and distinct years and distinct book sizes must give distinct
//      prices. The new engine caches nothing today; this is what keeps a cache
//      added tomorrow honest.
//   2. THE SEAM ROUTES TO THE NEW ENGINE: what the tower prices from
//      (layerRiskMoments on a book) IS newEngineLayerMoments, exactly. ⚠ THE
//      ALGEBRA AGAINST THE DRAW is shock-loss-check's, in FAST: every event and
//      routine large losses, drawn through the tower layer by layer, against
//      the expected recovery. Not repeated here.
//   3. THE TWO PARTS OF A LAYER'S RISK. Shocks are pool-wide and their losses
//      scale with the book, so they do not diversify: the shocks' own SD/E
//      settles, as the book grows, on a floor above zero and no higher than at
//      the market's size. Routine large losses are independent claims: their
//      mean AND variance are exactly linear in the book, so they diversify.
//      With routine large losses on (Prompt A commit 1) the second part
//      dominates WC's and GL's layers, whose total SD/E now falls like
//      1/sqrt(book) instead of settling — which is why the floor is asserted on
//      the shocks' part and not on the total. (Not monotone on the way:
//      Property's shock SD/E dips below its floor at twice the market, as the
//      cat convolution and the attritional band trade places.)
//   4. THE ABOVE-TOWER BAND, in live games: never negative, and on GL never more
//      per occurrence than the pool's $25M limit less the $15M tower top.
//   5. THE RUNTIME COST of a pricing pass against a game-year, both measured in
//      this run.
//   6. THE FEEDBACK GAIN: how far the reinsurance rate per $100 moves when the
//      book moves. Well below 1 damps.
//
// ⚠ AND EACH FAILS WHEN BROKEN — every assertion is a predicate, and THE
// CONTROLS feed each one what it guards against.
// ============================================================================

import { REINSURANCE_TOWER, TOWER_TOP, type TowerLine } from '../../src/data/reinsuranceTower';
import { MEMBER_LEVEL, POOL_LIMIT_PER_OCCURRENCE, ROUTINE_LARGE_LOSSES } from '../../src/data/pricingParameters';
import { layerRiskMoments, resetTowerMomentCache } from '../../src/utils/towerMoments';
import { newEngineLayerMoments } from '../../src/utils/shockExpectation';
import { occurrenceProgramCost } from '../../src/utils/reinsuranceTower';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, GameState, ResultSet } from '../../src/types/simulation';

const LINES: TowerLine[] = ['WC', 'GL', 'Property'];
const failed: string[] = [];
const RULE = '='.repeat(72);
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failed.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const seedOf = (id: string) => { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; };

function play(id: string, years: number): { rows: ResultSet[]; gs: GameState } {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'R', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES as CoverageLine[] };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
  const start = gs;
  for (let y = 1; y <= years; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return { rows: gs.lockedResults, gs: start };
}

check(!MEMBER_LEVEL.enabled, 'running on the new engine (MEMBER_LEVEL off)');
// The market's own book on each line, from a game's opening.
const opening = play('RUNTIME-OPEN', 0).gs;
const MARKET = Object.fromEntries(LINES.map(l => [l, opening.poolState.lines[l].bookExposure ?? 0])) as Record<TowerLine, number>;
console.log(`  opening books: ${LINES.map(l => `${l} $${MARKET[l].toFixed(0)}M`).join(', ')}`);

// ---------------------------------------------------------------- predicates
type Price = (line: TowerLine, layer: number, exposure: number, year: number) => number;
const truePrice: Price = (line, layer, exposure, year) => layerRiskMoments(line, layer, { exposure }, year).expected;
const YEARS = 15;
/** Cold (cache cleared before every year) against warm (out of order, with repeats). */
function purity(price: Price): { coldEqualsWarm: boolean; yearsDistinct: boolean; sizesDistinct: boolean } {
  let coldEqualsWarm = true, yearsDistinct = true, sizesDistinct = true;
  for (const line of LINES) {
    for (let li = 0; li < REINSURANCE_TOWER[line].length; li++) {
      const cold: number[] = [];
      for (let y = 1; y <= YEARS; y++) { resetTowerMomentCache(); cold.push(price(line, li, MARKET[line], y)); }
      resetTowerMomentCache();
      const warm = new Array<number>(YEARS).fill(NaN);
      for (const y of [9, 2, 15, 5, 9, 1, 12, 3, 7, 15, 4, 6, 8, 10, 11, 13, 14, 2]) warm[y - 1] = price(line, li, MARKET[line], y);
      if (cold.some((v, i) => v !== warm[i])) coldEqualsWarm = false;
      if (cold[0] > 0 && new Set(cold).size !== YEARS) yearsDistinct = false;
      const a = price(line, li, MARKET[line], 3), b = price(line, li, MARKET[line] * 1.5, 3);
      if (a > 0 && a === b) sizesDistinct = false;
    }
  }
  return { coldEqualsWarm, yearsDistinct, sizesDistinct };
}
const SIZES = [0.5, 1, 2, 10, 100, 1000];
/** SD/E settled by 100x, above zero there, and no higher than at the market's size. */
function floorHolds(sdOverE: number[]): { settles: boolean; positive: boolean; notAboveMarket: boolean } {
  const floor = sdOverE[sdOverE.length - 1];
  return {
    settles: Math.abs(sdOverE[SIZES.indexOf(100)] - floor) < 0.01,
    positive: floor > 0.1,
    notAboveMarket: floor <= sdOverE[SIZES.indexOf(1)] + 1e-9,
  };
}
/** A layer's moments with routine large losses held off — the shocks' part alone. */
function shocksOnly(line: TowerLine, layer: number, exposure: number) {
  const was = ROUTINE_LARGE_LOSSES.enabled;
  try { ROUTINE_LARGE_LOSSES.enabled = false; return layerRiskMoments(line, layer, { exposure }, 1); }
  finally { ROUTINE_LARGE_LOSSES.enabled = was; }
}
/** The routine part (total less shocks) at 1x and 10x: both its mean and its variance scale by exactly 10. */
const linearInBook = (m1: number, m10: number, v1: number, v10: number) =>
  Math.abs(m10 / m1 - 10) < 1e-6 && Math.abs(v10 / v1 - 10) < 1e-6;
const aboveTowerOk = (line: CoverageLine, rows: { retainedAboveTower: number; occurrences?: unknown[] }[]) => {
  const limit = POOL_LIMIT_PER_OCCURRENCE[line];
  const band = limit === null ? null : Math.max(0, limit - TOWER_TOP[line as TowerLine]);
  return rows.every(r => r.retainedAboveTower >= 0
    && (band === null || r.retainedAboveTower <= (r.occurrences ?? []).length * band + 1e-6));
};
// ⚠ 40%, AND THE MEASURED FIGURE IS 14-18%. One pricing pass over the three
// lines is a fifth of a game-year on the new engine (the member gate's warm path
// was 0.13%): Property's catastrophe convolution is most of it. The budget is a
// guard against a doubling, set with headroom for FAST's three parallel jobs,
// not a statement that a fifth is cheap.
const BUDGET = 0.4;
const loopGain = (cost: (exposure: number) => number, base: number) => {
  const shrunk = base * 0.9;
  const rateDelta = (cost(shrunk) / shrunk) / (cost(base) / base) - 1;
  // Reinsurance is about a quarter of the member charge, as the member gate scaled it.
  return Math.abs((rateDelta * 0.25) / (shrunk / base - 1));
};

console.log('\n--- 1. PURITY: the memo key\'s successor ---');
{
  const p = purity(truePrice);
  check(p.coldEqualsWarm, `1. cold === warm, ${YEARS} years x every layer x 3 lines, evaluated out of order`);
  check(p.yearsDistinct, '1. every year gives a distinct price on every layer that cedes');
  check(p.sizesDistinct, '1. a larger book gives a different price (the exposure reaches it)');
}

console.log('\n--- 2. THE SEAM ROUTES TO THE NEW ENGINE ---');
/** Worst gap between what the tower prices from and newEngineLayerMoments at `scale` x the book. */
function seamGap(scale: number): number {
  let worst = 0;
  for (const line of LINES) for (const y of [1, 4, 9]) {
    const direct = newEngineLayerMoments(line, MARKET[line] * scale, y);
    REINSURANCE_TOWER[line].forEach((_l, i) => {
      const m = layerRiskMoments(line, i, { exposure: MARKET[line] }, y);
      worst = Math.max(worst, Math.abs(m.expected - direct[i].expected), Math.abs(m.sd - direct[i].sd));
    });
  }
  return worst;
}
{
  const g = seamGap(1);
  check(g === 0, '2. the tower prices from newEngineLayerMoments, exactly', `worst ${g}`);
  console.log('  (the algebra against the draw: shock-loss-check, every event and routine large losses, layer by layer)');
}

console.log('\n--- 3. THE TWO PARTS OF A LAYER\'S RISK: the shocks settle on a floor, routine claims diversify ---');
let routineLayers = 0;
{
  for (const line of LINES) {
    REINSURANCE_TOWER[line].forEach((l, i) => {
      if (shocksOnly(line, i, MARKET[line]).expected > 0) {
        const series = SIZES.map(f => shocksOnly(line, i, MARKET[line] * f).sdOverExpected);
        const f = floorHolds(series);
        check(f.settles && f.positive && f.notAboveMarket, `3. ${line} ${l.name}: the shocks' SD/E settles on a floor above zero, no higher than at market size`,
          series.map(v => v.toFixed(3)).join(' -> '));
      }
      if (!ROUTINE_LARGE_LOSSES.enabled) return;
      const part = (f: number) => {
        const t = layerRiskMoments(line, i, { exposure: MARKET[line] * f }, 1), s0 = shocksOnly(line, i, MARKET[line] * f);
        return { m: t.expected - s0.expected, v: t.sd ** 2 - s0.sd ** 2 };
      };
      const a = part(1), b = part(10);
      if (!(a.m > 0)) return;
      routineLayers++;
      check(linearInBook(a.m, b.m, a.v, b.v), `3. ${line} ${l.name}: the routine part's mean and variance are linear in the book`,
        `x${(b.m / a.m).toFixed(6)} and x${(b.v / a.v).toFixed(6)} at 10x`);
    });
  }
  if (ROUTINE_LARGE_LOSSES.enabled) check(routineLayers > 0, '3. routine large losses reach the tower (not vacuous)', `${routineLayers} layers`);
}

console.log('\n--- 4. THE ABOVE-TOWER BAND, IN LIVE GAMES ---');
const live = ['TWR0', 'TWR1', 'TWR2', 'TWR3', 'TWR4', 'TWR5', 'TWR6', 'TWR7'].flatMap(id => play(id, 10).rows);
{
  for (const line of LINES) {
    const rows = live.map(r => r.byLine[line]);
    const above = rows.reduce((a, r) => a + r.retainedAboveTower, 0);
    check(aboveTowerOk(line, rows), `4. ${line}: above-tower never negative${POOL_LIMIT_PER_OCCURRENCE[line] !== null ? ', and never past the pool limit per occurrence' : ''}`,
      `$${(above / 1e6).toFixed(2)}M over ${rows.length} years`);
  }
  check(live.some(r => LINES.some(l => r.byLine[l].retainedAboveTower > 0)), '4. some year carries a loss above the tower (not vacuous)');
}

console.log('\n--- 5. THE RUNTIME COST OF A PRICING PASS ---');
let shareMeasured = 0;
const pricingPass = () => { for (const l of LINES) occurrenceProgramCost(l, REINSURANCE_TOWER[l].map(() => true), { exposure: MARKET[l] }, 3); };
const timeUs = (f: () => void, n: number) => { const t = process.hrtime.bigint(); for (let i = 0; i < n; i++) f(); return Number(process.hrtime.bigint() - t) / 1000 / n; };
{
  for (let i = 0; i < 300; i++) pricingPass();
  const passUs = timeUs(pricingPass, 1000);
  const y1 = opening;
  for (let i = 0; i < 5; i++) processYear(y1, defaultDecisionSet(1));
  const yearUs = timeUs(() => processYear(y1, defaultDecisionSet(1)), 40);
  shareMeasured = passUs / yearUs;
  console.log(`  a pricing pass over the three lines ${passUs.toFixed(0)} us; a three-line game-year ${yearUs.toFixed(0)} us`);
  check(shareMeasured < BUDGET, `5. a pricing pass is under ${BUDGET * 100}% of a game-year`, `${(shareMeasured * 100).toFixed(1)}%`);
}

console.log('\n--- 6. THE FEEDBACK GAIN ---');
const towerCost = (line: TowerLine) => (exposure: number) => occurrenceProgramCost(line, REINSURANCE_TOWER[line].map(() => true), { exposure }, 1).premium;
{
  for (const line of LINES) {
    const g = loopGain(towerCost(line), MARKET[line]);
    check(g < 0.5, `6. ${line}: a 10% smaller book moves the member charge by a gain of ${g.toFixed(3)} — damps`);
  }
}

// ---------------------------------------------------------------- controls
console.log('\nCONTROLS — each must be caught');
{
  // A cache keyed on (line, layer) alone — the year left out of the key.
  // It survives resetTowerMomentCache, as a module-level cache the reset did not
  // know about would.
  const memo = new Map<string, number>();
  const badKey: Price = (line, layer, exposure, year) => {
    const k = `${line}|${layer}`;
    if (!memo.has(k)) memo.set(k, truePrice(line, layer, exposure, year));
    return memo.get(k)!;
  };
  const p = purity(badKey);
  check(!p.coldEqualsWarm || !p.yearsDistinct, 'control: a price cache that leaves the year out of its key is caught by 1');
  check(seamGap(1.01) > 0, 'control: a tower priced on a book 1% off is caught by 2');
  const diversifying = SIZES.map(f => 4 / Math.sqrt(f));
  const fl = floorHolds(diversifying);
  check(!(fl.settles && fl.positive && fl.notAboveMarket), 'control: an SD/E that diversifies away like independent risks is caught by 3');
  check(!linearInBook(1, 9, 1, 10), 'control: a routine part that does not scale with the book is caught by 3');
  const rising = floorHolds(SIZES.map(f => 4 + Math.log10(f * 2)));
  check(!(rising.settles && rising.positive && rising.notAboveMarket), 'control: an SD/E that grows with the book is caught by 3');
  check(!aboveTowerOk('GL', [{ retainedAboveTower: -1, occurrences: [] }]), 'control: a negative above-tower year is caught by 4');
  check(!aboveTowerOk('GL', [{ retainedAboveTower: 10e6 + 1, occurrences: [{}] }]), 'control: GL above-tower past $25M less the $15M top is caught by 4');
  check(!(shareMeasured * 4 < BUDGET), 'control: pricing four times as slow is caught by 5');
  check(loopGain(e => towerCost('GL')(MARKET.GL) * (e / MARKET.GL) ** 5, MARKET.GL) >= 0.5, 'control: a price that steepens with the book is caught by 6');
}

console.log(failed.length === 0 ? '\nALL RUNTIME TOWER CHECKS PASS, AND EVERY CONTROL IS CAUGHT.'
  : `\n${RULE}\n${failed.length} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
process.exit(failed.length === 0 ? 0 : 1);
