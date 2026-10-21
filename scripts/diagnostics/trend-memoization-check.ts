// FIVE PURE-FUNCTION-OF-YEAR TRENDS, MEMOIZED — this is what guards it.
//
// Run: npx tsx scripts/diagnostics/trend-memoization-check.ts
//
// wageFactor, wcFrequencyTrend, wcSeverityTrend, glSeverityTrend and
// glCappedSeverityTrend were each a fresh Math.pow (or, for the last, a
// component-loop evaluation) on every call, including calls made once per
// DRAWN CLAIM inside generateWcClaims/generateGlClaims and once per MEMBER
// inside wcAggregateCumulants/glAggregateCumulants — ~7,500 calls/yr at full
// market to pure functions of a single integer. Each is now backed by a
// module-level Map (src/utils/claimMath.ts's memoizeByYear).
//
// PURELY A SPEED FIX. Nothing here should ever be able to move a simulated
// value — if any assertion below fails, the memo key is wrong. Do not
// "explain" a failure; a wrong memoized value is a defect by definition,
// never a modelling question.
//
// THE THING WORTH GETTING WRONG: fn must floor internally, not rely on
// keyOf having already floored — memoizeByYear calls fn with the RAW year on
// a cache miss, so a function that trusted its key to be pre-floored would
// let whichever raw year (-2, -1, 0 or 1) happens to populate a given slot
// first silently decide that slot's value. Section 2 asserts this directly:
// every floored function must return the SAME thing at -2, -1, 0 and 1, in
// every call order.

import { EXPOSURE_GROWTH_PER_YEAR, exposureFactor } from '../../src/data/exposureTrend';
import { FREQUENCY_TREND_PER_YEAR } from '../../src/data/pricingParameters';
import {
  wcFrequencyTrend, wcSeverityTrend, WC_SEVERITY_TREND_PER_YEAR,
} from '../../src/utils/wcClaimEngine';
import {
  glSeverityTrend, glCappedSeverityTrend, GL_SEVERITY_TREND_PER_YEAR,
  HELD_PURE_PREMIUM_YEAR, untiltedGlWeights, expectedClaimSeverity,
} from '../../src/utils/glClaimEngine';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';

// ⚠ THE VERDICT NAMES WHAT FAILED. IT USED TO COUNT. A bare "N CHECK(S) FAILED"
// at the end of a long report makes the reader scroll back for the FAIL lines,
// and whatever prose they land on on the way gets read as the explanation. That
// is not hypothetical: this project misdiagnosed a red gate exactly that way,
// attributing a failure in one section to a paragraph in another that happened
// to say "is NOT a defect". `failed` exists so the last line of output is the
// list, not the count.
const failed: string[] = [];
// The verdict is fenced so no neighbouring paragraph can be read as covering it.
const RULE = '='.repeat(72);
let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (!ok) {
    failures++;
    failed.push(`${label}${detail ? '  — ' + detail : ''}`);
    console.log(`  FAIL  ${label}${detail ? '  — ' + detail : ''}`);
  } else console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
}

const YEARS = [-8, -5, -2, -1, 0, 1, 2, 3, 5, 7, 10, 15, 20, 30, 50];

console.log('=== TREND MEMOIZATION CHECK ===\n');

// ---------------------------------------------------------------------------
console.log('--- 1. EVERY MEMOIZED VALUE MATCHES A FRESH, INDEPENDENTLY REIMPLEMENTED COMPUTATION ---');
{
  // Fresh reference formulas, duplicated from each function's PRE-MEMOIZATION
  // body rather than imported — the point is to have a computation that never
  // touches the Map, so a wrong key can't hide from it.
  const freshWcFrequencyTrend = (y: number) => Math.pow(1 + FREQUENCY_TREND_PER_YEAR.WC, y - 1);
  const freshWcSeverityTrend = (y: number) => Math.pow(1 + WC_SEVERITY_TREND_PER_YEAR, Math.max(1, y) - 1);
  const freshGlSeverityTrend = (y: number) => Math.pow(1 + GL_SEVERITY_TREND_PER_YEAR, Math.max(1, y) - 1);
  // glCappedSeverityTrend's fresh reference calls the UNMEMOIZED
  // expectedClaimSeverity fresh every time, recomputing `base` from scratch on
  // every single call rather than hoisting it — the two must still agree,
  // which is the actual thing at risk in that function (the hoisting, not the
  // arithmetic already checked via glSeverityTrend above).
  const freshGlCapped = (y: number) => {
    const base = expectedClaimSeverity(untiltedGlWeights(), HELD_PURE_PREMIUM_YEAR);
    if (!(base > 0)) return 1;
    return expectedClaimSeverity(untiltedGlWeights(), y) / base;
  };

  let allMatch = true;
  for (const y of YEARS) {
    const rows: [string, number, number][] = [
      ['wcFrequencyTrend', wcFrequencyTrend(y), freshWcFrequencyTrend(y)],
      ['wcSeverityTrend', wcSeverityTrend(y), freshWcSeverityTrend(y)],
      ['glSeverityTrend', glSeverityTrend(y), freshGlSeverityTrend(y)],
      ['glCappedSeverityTrend', glCappedSeverityTrend(y), freshGlCapped(y)],
    ];
    for (const [name, memoized, fresh] of rows) {
      if (memoized !== fresh) {
        allMatch = false;
        console.log(`    MISMATCH ${name} at year ${y}: memoized ${memoized} vs fresh ${fresh}`);
      }
    }
  }
  check(allMatch, `memoized === fresh across years [${YEARS.join(', ')}]`, 'the four memoized trend factors');

  // ⚠ exposureFactor LEFT THIS LIST BECAUSE IT LEFT THE MEMO. It was a
  // per-line Map over Math.pow(1.0363, ...); with EXPOSURE_GROWTH_PER_YEAR at
  // zero the body is a constant and a Map lookup would cost more than the
  // arithmetic. It is still checked here — just as a VALUE rather than as a
  // cache, because a base that silently stopped being level is the defect this
  // file is positioned to catch.
  const levelEverywhere = (['WC', 'GL', 'Property'] as const)
    .every(l => [-5, 0, 1, 2, 10, 40].every(y => exposureFactor(l, y) === 1));
  check(EXPOSURE_GROWTH_PER_YEAR === 0 && levelEverywhere,
    'exposureFactor is exactly 1 on every line and year — the exposure base is level');
}

// ---------------------------------------------------------------------------
console.log('\n--- 2. THE FLOOR IS AT THE CACHE KEY, NOT JUST THE VALUE ---');
{
  // Query out of order and with repeats, so a function whose fn trusted keyOf
  // to have already floored would show it: whichever raw year populates the
  // key=1 slot FIRST would silently win for every year <= 1 queried after.
  const floored: [string, (y: number) => number][] = [
    ['wcSeverityTrend', wcSeverityTrend],
    ['glSeverityTrend', glSeverityTrend],
    ['glCappedSeverityTrend', glCappedSeverityTrend],
  ];
  for (const [name, fn] of floored) {
    const order = [0, -2, 1, -8, -1]; // year 1 is NOT queried first
    const seen = order.map(fn);
    const allSame = seen.every(v => v === seen[0]);
    check(allSame, `${name}: years [${order.join(', ')}] all equal, year 1 queried third`,
      allSame ? `${seen[0]}` : seen.join(' / '));
  }

  // ⚠ THE UN-FLOORED CONTROL IS NOW INERT, AND IT SAYS SO RATHER THAN BEING
  // DELETED OR QUIETLY PASSING.
  //
  // It read `wcFrequencyTrend(-2) !== wcFrequencyTrend(1)` — the pre-game is
  // allowed to run frequency hotter, so this one function deliberately has no
  // year-1 floor, unlike every other factor above. That test worked by
  // observing a DIFFERENCE in value, which requires a non-zero rate. WC's
  // frequency trend is a named zero now (FREQUENCY_TREND_PER_YEAR.WC), so the
  // factor is 1 in every year and a floored and an unfloored implementation are
  // indistinguishable from outside.
  //
  // What can still be checked is that the function IS the unfloored formula, so
  // that is what is checked — against a fresh reimplementation, at the live
  // rate, across negative years. It passes trivially today and regains its
  // discriminating power the moment a frequency trend comes back. Stated as
  // INERT so nobody reads a green here as evidence the floor is still absent.
  const unflooredFresh = (y: number) => Math.pow(1 + FREQUENCY_TREND_PER_YEAR.WC, y - 1);
  const years = [-8, -2, -1, 0, 1, 2, 10];
  const matchesUnfloored = years.every(y => wcFrequencyTrend(y) === unflooredFresh(y));
  check(matchesUnfloored,
    'wcFrequencyTrend is the UNFLOORED formula at every year (INERT while the rate is 0 — '
    + 'it cannot tell floored from unfloored until a frequency trend returns)',
    years.map(y => wcFrequencyTrend(y).toFixed(6)).join(' / '));
}

// ---------------------------------------------------------------------------
console.log('\n--- 3. REPEATED CALLS ARE BIT-IDENTICAL (the cache itself is not corrupting anything) ---');
{
  let stable = true;
  for (const y of YEARS) {
    if (wcFrequencyTrend(y) !== wcFrequencyTrend(y)) stable = false;
    if (glCappedSeverityTrend(y) !== glCappedSeverityTrend(y)) stable = false;
  }
  check(stable, 'calling each function twice at the same year returns bit-identical results');
}

// ---------------------------------------------------------------------------
console.log('\n--- 4. RUNTIME COST: processYear timed in this process, before/after cannot be re-measured here ---');
console.log('  (this run only measures AFTER; see the report for the before/after comparison)');
{
  const inst = generateGameInstance('MEMOBENCH', 20260820);
  const setup = { poolName: 'B', gameLength: 5, startingYear: 2026, instanceId: 'MEMOBENCH', activeLines: ['WC', 'GL', 'Property'] as const };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  } as never as Parameters<typeof processYear>[0];
  const N = 60;
  for (let i = 0; i < 5; i++) processYear(gs, defaultDecisionSet(1)); // warm
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) processYear(gs, defaultDecisionSet(1));
  const perYear = Number(process.hrtime.bigint() - t0) / 1000 / N;
  console.log(`  processYear (3 lines, this machine, AFTER memoization): ${perYear.toFixed(0)} us`);
}

console.log(failures === 0 ? '\nALL TREND MEMOIZATION CHECKS PASS.'
  : `\n${RULE}\n${failures} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
if (failures > 0) process.exit(1);
