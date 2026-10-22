// ============================================================================
// ORDINARY LOSSES FROM BOOK UNITS — THE GATE.
//
//   npx tsx scripts/diagnostics/book-units-ordinary-check.ts
//
// Each unit's expected ordinary loss is its exposure x its true risk x the
// line's cost; each year it is that x the year factor every unit shares (CV
// the line's BASELINE_CV) x its own (CV UNIT_ORDINARY_OWN_CV); the line's is
// the sum (ordinaryLossFromUnits). Against the closed form:
//
//   1. PER UNIT: realised / expected averages 1, with CV
//      sqrt((1 + Y^2)(1 + U^2) − 1) — a unit carries both factors.
//   2. AT THE LINE: realised / expected averages 1, with CV
//      sqrt((1 + Y^2)(1 + U^2 x H) − 1), H the sum of the units' squared
//      shares of expected loss — the book's own (bookOrdinaryCv), on several
//      books.
//   3. EXPECTED IS EXPOSURE x RISK x COST: the line's expected ordinary loss is
//      the units' sum, exactly the line's exposure x the book's size-weighted
//      risk x the cost, and the engine's expected ordinary loss is that.
//   4. THROUGH THE ENGINE: in a ten-world game every world's ordinary loss is
//      drawn on the same book — the same expected — and the worlds differ only
//      in their draws.
//
// ⚠ AND EACH FAILS WHEN BROKEN — the CONTROLS feed each predicate the draws a
// broken engine would make: one factor for the whole line, no year factor, and
// an expected that ignores risk.
// ============================================================================

import { UNIT_MARKET_COUNT, UNIT_ORDINARY_OWN_CV } from '../../src/data/pricingParameters';
import { marketSeedOf, openingBookUnits, unitsOf, type BookUnit } from '../../src/utils/bookUnits';
import { heldUnits } from '../../src/utils/bookUnderwriting';
import {
  bookOrdinaryCv, bookOrdinaryRisk, drawOrdinaryFactor, ordinaryYearCv, ordinaryLossCostPer100, ordinaryLossFromUnits, ordinaryLossRng,
  unitOrdinaryRng,
} from '../../src/utils/ordinaryLoss';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { exposureFactor } from '../../src/data/exposureTrend';
import type { CoverageLine, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const Z = 4;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
function moments(xs: number[]) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const m2 = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const m4 = xs.reduce((a, b) => a + (b - mean) ** 4, 0) / n;
  const sd = Math.sqrt(m2);
  // SE of the sample CV, from the fourth moment (delta method on the variance).
  const seSd = Math.sqrt(Math.max(0, m4 - m2 * m2) / n) / (2 * sd);
  return { n, mean, seMean: sd / Math.sqrt(n), cv: sd / mean, seCv: seSd / mean };
}

type Draw = (line: CoverageLine, units: readonly BookUnit[], year: number, seed: number) =>
  { expected: number; realised: number; byUnit: { expected: number; realised: number }[] };

const engineDraw: Draw = (line, units, year, seed) => ordinaryLossFromUnits(line, units, 100, year, seed);

// ---------------------------------------------------------------- predicates
const BOOK_SEEDS = [4_242_424, 5_151_515, 6_060_606];
const STREAM_SEEDS = 3_000;
function grade(draw: Draw, tag: string, expectedOf: (line: CoverageLine, units: readonly BookUnit[]) => number) {
  for (const line of LINES) {
    const unitCv = Math.sqrt((1 + ordinaryYearCv(line) ** 2) * (1 + UNIT_ORDINARY_OWN_CV ** 2) - 1);
    const perUnit: number[] = [];
    let worstLineZ = 0, worstLineCvZ = 0, worstExpected = 0;
    const lineDetail: string[] = [];
    for (const bs of BOOK_SEEDS) {
      const units = unitsOf(bs, line, openingBookUnits(bs, line));
      const want = bookOrdinaryCv(units, line);
      const ratios: number[] = [];
      for (let s = 0; s < STREAM_SEEDS; s++) {
        const y = 1 + (s % 10);
        const o = draw(line, units, y, 7_000_000 + s * 104_729);
        ratios.push(o.realised / o.expected);
        // ONE unit per draw, in turn: the units of one year share its year
        // factor, so pooling them all would understate the SE.
        const pick = o.byUnit[s % o.byUnit.length];
        perUnit.push(pick.realised / pick.expected);
        if (s < 10) {
          worstExpected = Math.max(worstExpected, Math.abs(o.expected / expectedOf(line, units) - 1),
            Math.abs(o.byUnit.reduce((a, u) => a + u.expected, 0) / o.expected - 1));
        }
      }
      const m = moments(ratios);
      worstLineZ = Math.max(worstLineZ, Math.abs(m.mean - 1) / m.seMean);
      worstLineCvZ = Math.max(worstLineCvZ, Math.abs(m.cv - want) / m.seCv);
      lineDetail.push(`${(100 * m.cv).toFixed(3)}% vs ${(100 * want).toFixed(3)}%`);
    }
    const u = moments(perUnit);
    check(Math.abs(u.mean - 1) < Z * u.seMean && Math.abs(u.cv - unitCv) < Z * u.seCv,
      `${tag}1. ${line}: each unit averages its expected, CV ${(100 * unitCv).toFixed(2)}%`,
      `mean ${u.mean.toFixed(5)}, CV ${(100 * u.cv).toFixed(3)}% over ${u.n} unit-years`);
    check(worstLineZ < Z && worstLineCvZ < Z, `${tag}2. ${line}: the line averages its expected, at its book's own CV`,
      `${lineDetail.join(' · ')} (worst ${Math.max(worstLineZ, worstLineCvZ).toFixed(2)} SE)`);
    check(worstExpected < 1e-12, `${tag}3. ${line}: expected is exposure x the book's risk x cost, the units' sum`,
      `worst relative ${worstExpected.toExponential(2)}`);
  }
}

// Exposure x risk x cost at the draw's own year (the draws use exposure 100).
const expectedAtYear = (line: CoverageLine, units: readonly BookUnit[], year: number) =>
  100 * bookOrdinaryRisk(units) * 10_000 * ordinaryLossCostPer100(line, year);

console.log(`ORDINARY LOSSES FROM BOOK UNITS — ${BOOK_SEEDS.length} books x ${STREAM_SEEDS} stream seeds per line`);
{
  // The engine's draw, its expected compared at the draw's own year.
  let year = 1;
  const tracked: Draw = (line, units, y, seed) => { year = y; return engineDraw(line, units, y, seed); };
  grade(tracked, '', (line, units) => expectedAtYear(line, units, year));
}

// ---------------------------------------------------------------- 4. the engine
{
  const { setup, instance } = openSoloInstance({ poolName: 'B', gameLength: 2, startingYear: 2026, instanceId: 'BUORD', activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory });
  gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(1)), [])), currentYearNumber: 2 };
  let worst = 0, sameExpected = true, differ = 0;
  for (const line of LINES) {
    // The book year 1 drew on — after its movement, each unit at its held share
    // (uw-hybrid: the defaults write new business, part of the last applicant).
    const units = heldUnits(marketSeedOf(instance), line, gs.poolState.bookUnits?.[line] ?? [], gs.poolState.bookLedger?.[line]);
    const recs = (gs.worlds ?? []).map(w => w.lockedResults[0].byLine[line].newLossEngine!);
    const exposure = units.reduce((a, u) => a + u.size, 0) * exposureFactor(line, 1);
    const want = exposure * bookOrdinaryRisk(units) * 10_000 * ordinaryLossCostPer100(line, 1);
    for (const r of recs) worst = Math.max(worst, Math.abs(r.ordinaryExpected / want - 1));
    sameExpected = sameExpected && recs.every(r => r.ordinaryExpected === recs[0].ordinaryExpected);
    differ += new Set(recs.map(r => r.ordinaryFactor)).size;
  }
  check(worst < 1e-12 && sameExpected && differ === LINES.length * (gs.worlds ?? []).length,
    '4. through the engine: every world draws on the same book (the same expected, exposure x risk x cost); only the draws differ',
    `worst ${worst.toExponential(2)}; ${differ} distinct factors over ${LINES.length} lines x ${(gs.worlds ?? []).length} worlds`);
}

// ---------------------------------------------------------------- controls
console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, draw: Draw, expectedOf: (line: CoverageLine, units: readonly BookUnit[]) => number, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  grade(draw, '', expectedOf);
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
const byHand = (sharedOwn: boolean, withYear: boolean, riskless: boolean): Draw => (line, units, year, seed) => {
  const size = units.reduce((a, u) => a + u.size, 0);
  const cost = 10_000 * ordinaryLossCostPer100(line, year);
  const F = withYear ? drawOrdinaryFactor(ordinaryLossRng(seed, year, line), ordinaryYearCv(line)) : 1;
  const own = unitOrdinaryRng(seed, year, line);
  const fs = Array.from({ length: UNIT_MARKET_COUNT }, () => drawOrdinaryFactor(own, UNIT_ORDINARY_OWN_CV));
  const byUnit = units.map(u => {
    const expected = (u.size * 100 / size) * (riskless ? 1 : u.risk) * cost;
    return { expected, realised: expected * F * (sharedOwn ? fs[0] : fs[u.index]) };
  });
  return { expected: byUnit.reduce((a, u) => a + u.expected, 0), realised: byUnit.reduce((a, u) => a + u.realised, 0), byUnit };
};
let cy = 1;
const at = (d: Draw): Draw => (line, units, y, seed) => { cy = y; return d(line, units, y, seed); };
const exp = (line: CoverageLine, units: readonly BookUnit[]) => expectedAtYear(line, units, cy);
controlFails('one own factor for the whole line', at(byHand(true, true, false)), exp, '2.');
// A unit alone barely sees the year factor (10.0% against 10.2%); the line,
// where the own factors average away, loses most of its CV without it.
controlFails('no year factor', at(byHand(false, false, false)), exp, '2.');
controlFails('an expected that ignores risk', at(byHand(false, true, true)), exp, '3.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — each unit and the line draw their closed-form mean and CV, and expected is exposure x risk x cost.');
