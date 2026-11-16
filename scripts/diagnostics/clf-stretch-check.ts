// ============================================================================
// THE FUNDING TABLES' STRETCH (wip/clf-stretch) — THE GATE.
//
//   npx tsx scripts/diagnostics/clf-stretch-check.ts
//
// ⚠ THE BRIEF'S STOPS ARE WRITTEN OUT HERE, not read from pricingParameters,
// so a changed CLF_STRETCH_95 fails rather than moving the expectation with it.
// On every line:
//
//   1. THE STOP: CLF_STRETCH_95 is the brief's — WC 1.30, GL 1.25, Property
//      1.25 — and the table in force reads exactly that at its 95% stop.
//   2. THE STRETCH, STOP BY STOP: every stop of the table in force is
//      1 + (c - 1) x k, c the unstretched BaselineCV table's literal at that
//      stop (BASELINE_CV_TABLES, filed under the line's BASELINE_CV) and
//      k = (stop at 95% - 1) / (c at 95% - 1) — to 1e-12, with the stops
//      themselves and the table's Expected position (`expected`) unchanged.
//   3. EXPECTED IS A FACTOR OF 1.0: clfFor at Expected returns exactly 1, and
//      the stretched table crosses 1.0 where the unstretched one did.
//   4. THE READERS READ IT: the slider's every stop (staticClf, 30-90% in
//      fives) is the stretched column; requiredCapital is the unpaid reserve x
//      (the stretched CLF at RESERVE_MARGIN_CONFIDENCE - 1); and a played year
//      (scenario 1, single player, year 1) charges the stretched 80% stop at
//      80% funding and exactly 1.0 at Expected, as its selectedFundingCLF.
//
// ⚠ AND IT FAILS WHEN BROKEN — the CONTROLS feed the same predicates today's
// unstretched tables (caught by 1 and 2), WC stretched to GL's 1.25 (caught by
// 1), and a table scaled about 0 rather than 1 so its 95% stop is still right
// (caught by 2, and by 3: it no longer crosses 1.0 where it did). Each must be
// caught on the lines it breaks.
// ============================================================================

import { BASELINE_CV, CLF_STRETCH_95, RESERVE_MARGIN_CONFIDENCE_PARAM } from '../../src/data/pricingParameters';
import {
  BASELINE_CV_TABLES, baselineCvKey, crossingOf, staticClf, STATIC_CLF_TABLE, type ClfTable, type StaticClfLine,
} from '../../src/data/clfTables';
import { clfFor } from '../../src/utils/fundingConsequence';
import { requiredCapital } from '../../src/utils/openingReserves';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { openWorlds, playWorldsYear } from '../../src/utils/worlds';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const LINES: StaticClfLine[] = ['WC', 'GL', 'Property'];
const BRIEF: Record<StaticClfLine, number> = { WC: 1.30, GL: 1.25, Property: 1.25 };
const SLIDER = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
const TOL = 1e-12;

const failures: string[] = [];
function check(ok: boolean, what: string, detail = ''): void {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(what);
}

const filed = (line: StaticClfLine): ClfTable => BASELINE_CV_TABLES[baselineCvKey(BASELINE_CV[line])][line];

type TableOf = (line: StaticClfLine) => ClfTable;
function grade(tableOf: TableOf, stopOf: (line: StaticClfLine) => number): void {
  for (const line of LINES) {
    const t = tableOf(line), base = filed(line);
    const i95 = t.stops.indexOf(95), b95 = base.clf[base.stops.indexOf(95)];
    console.log(`\n${line} — BaselineCV ${BASELINE_CV[line]}, unstretched 95% stop ${b95.toFixed(4)}`);

    // 1. The stop.
    check(stopOf(line) === BRIEF[line] && Math.abs(t.clf[i95] - BRIEF[line]) < TOL,
      `1. ${line}: the 95% stop is the brief's ${BRIEF[line].toFixed(2)}`,
      `parameter ${stopOf(line)}, table ${t.clf[i95]?.toFixed(6)}`);

    // 2. Every stop the stretch of the literal.
    const k = (BRIEF[line] - 1) / (b95 - 1);
    const sameStops = t.stops.length === base.stops.length && t.stops.every((p, i) => p === base.stops[i]);
    let worst = 0, worstAt = 0;
    base.clf.forEach((c, i) => {
      const d = Math.abs(t.clf[i] - (1 + (c - 1) * k));
      if (!(d <= worst)) { worst = d; worstAt = base.stops[i]; }
    });
    check(sameStops && worst < TOL && t.expected === base.expected,
      `2. ${line}: every stop is 1 + (literal - 1) x ${k.toFixed(4)}`,
      `worst ${worst.toExponential(2)}${worst > 0 ? ` at ${worstAt}%` : ''}; stops ${sameStops ? 'unchanged' : 'CHANGED'}; expected ${t.expected} vs ${base.expected}`);

    // 3. Expected: the table crosses 1.0 where the unstretched one did.
    // Interpolated off the factors themselves: crossingOf returns the stored
    // `expected`, which 2 already holds unchanged.
    const e = crossingOf({ ...t, expected: undefined }), eb = crossingOf({ ...base, expected: undefined });
    check(Math.abs(e - eb) < 1e-9, `3. ${line}: the stretched table crosses 1.0 where the unstretched one did`,
      `${(100 * e).toFixed(3)}% against ${(100 * eb).toFixed(3)}%`);
  }
}

console.log('THE FUNDING TABLES\' STRETCH — each line\'s BaselineCV table stretched about 1.0 to its 95% stop');
grade(l => STATIC_CLF_TABLE[l], l => CLF_STRETCH_95[l]);

// 3 and 4 against the readers — the build only.
console.log('\nTHE READERS');
for (const line of LINES) {
  const t = STATIC_CLF_TABLE[line];
  check(clfFor(line as CoverageLine, 0.8, true) === 1.0, `3. ${line}: Expected is a factor of exactly 1.0`);
  check(SLIDER.every(p => staticClf(line, p / 100) === t.clf[t.stops.indexOf(p)]),
    `4. ${line}: the slider's stops 30-90% in fives are the stretched columns`);
  const level = Math.round(RESERVE_MARGIN_CONFIDENCE_PARAM * 100);
  const clfM = t.clf[t.stops.indexOf(level)];
  const rc = requiredCapital(line as CoverageLine, 100_000_000);
  check(Math.abs(rc - 100_000_000 * (clfM - 1)) < 1e-6, `4. ${line}: required capital is unpaid x (stretched CLF${level} - 1)`,
    `$100M unpaid -> $${(rc / 1e6).toFixed(3)}M at ${clfM.toFixed(4)}`);
}
{
  const settings = { poolName: 'S', gameLength: 5, startingYear: 2027, instanceId: '1', activeLines: LINES } as never;
  const { setup, instance } = openSoloInstance(settings);
  const pre = runPriorHistory(instance, setup);
  const shocks = gameShocksOn(setup, instance);
  const gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState: pre.poolState,
    lockedResults: [], currentDecisions: defaultDecisionSet(1, shocks), priorHistory: pre.priorHistory,
    earlyPreGameHistory: pre.earlyPreGameHistory } as GameState);
  const at80 = defaultDecisionSet(1, shocks), atE = defaultDecisionSet(1, shocks);
  for (const l of LINES) {
    at80.byLine[l].fundingAtExpected = false; at80.byLine[l].fundingConfidenceLevel = 0.8;
    atE.byLine[l].fundingAtExpected = true;
  }
  const clfOf = (d: typeof at80, l: StaticClfLine) =>
    playWorldsYear(gs, d).perWorld[0].lineResults.find(r => r.result.line === l)!.result.selectedFundingCLF;
  for (const l of LINES) {
    const t = STATIC_CLF_TABLE[l], want = t.clf[t.stops.indexOf(80)];
    const got80 = clfOf(at80, l), gotE = clfOf(atE, l);
    check(Math.abs(got80 - want) < TOL && gotE === 1.0, `4. ${l}: a played year charges the stretched 80% stop at 80% and 1.0 at Expected`,
      `${got80.toFixed(4)} / ${gotE}`);
  }
}

// ---------------------------------------------------------------- controls
console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, tableOf: TableOf, stopOf: (l: StaticClfLine) => number, expect: string[], lines: number) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  grade(tableOf, stopOf);
  console.log = saved;
  const caught = failures.splice(before);
  const ok = expect.every(x => caught.filter(f => f.startsWith(x)).length >= lines);
  check(ok, `control: ${name} is caught by ${expect.join(' and ')}`, `${caught.length} caught: ${caught.map(f => f.slice(0, 6)).join(', ')}`);
};
controlFails('today\'s unstretched tables', filed, l => filed(l).clf[filed(l).stops.indexOf(95)], ['1.', '2.'], 3);
controlFails('WC stretched to GL\'s 1.25', l => {
  const b = filed(l), at = l === 'WC' ? 1.25 : BRIEF[l], k = (at - 1) / (b.clf[b.stops.indexOf(95)] - 1);
  return { ...b, clf: b.clf.map(c => 1 + (c - 1) * k) };
}, l => (l === 'WC' ? 1.25 : BRIEF[l]), ['1.'], 1);
controlFails('each table scaled about 0, not 1, to its stop', l => {
  const b = filed(l), m = BRIEF[l] / b.clf[b.stops.indexOf(95)];
  return { ...b, clf: b.clf.map(c => c * m) };
}, l => BRIEF[l], ['2.', '3.'], 3);

console.log(`\n${failures.length === 0 ? 'THE STRETCH HOLDS: EVERY LINE\'S TABLE IS ITS BASELINECV TABLE STRETCHED TO THE BRIEF\'S 95% STOP.' : `FAIL — ${failures.length}: ${failures.join('; ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
