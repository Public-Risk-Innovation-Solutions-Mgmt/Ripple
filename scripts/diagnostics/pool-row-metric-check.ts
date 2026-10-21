// ============================================================================
// POOL-ROW METRIC CHECK — no exported metric may read a field the pool row does
// not have.
//
//   npx tsx scripts/diagnostics/pool-row-metric-check.ts
//
// ⚠ IT EXISTS BECAUSE THE COMPILER CANNOT SEE INSIDE A CLOSURE, AND THAT GAP IS
// NOT THEORETICAL — IT FIRED DURING THE COMMIT THAT ADDED THIS FILE.
//
// Splitting the pooled result type put per-line quantities out of reach of a
// pool-scope read, and the compiler found every direct one: 20 errors in 10
// files, each a page printing the first active line's rate or decisions under a
// pool heading. It could not find the ones inside SpreadsheetMetric, because a
// metric is `{ key, label, value: (r) => ... }` and `value` is a closure. No
// signature on that interface can state which fields the body touches.
//
// So the metric table carries a hand-written `lineOnly` flag, and a hand-written
// flag is exactly the kind of thing that goes stale. Six metrics were marked by
// reading the file; SIX MORE WERE MISSED and were found only when
// solo-export-guard crashed with "Cannot read properties of undefined (reading
// 'dividendPct')". That crash is the honest version of the failure. The silent
// version is worse and is what this gate is for: a metric reading a missing
// NUMBER gets `undefined`, formats as "NaN" or "$NaN", and ships.
//
// ============================================================================
// HOW IT WORKS, AND WHY A PROXY RATHER THAN A SAMPLE.
//
// Every pool metric is evaluated against a REAL pool row — a played game, not a
// fixture — wrapped in a Proxy that THROWS on any key in PoolAbsentKey. A metric
// that touches one is named, with the key it reached for.
//
// A proxy rather than "look for undefined" because absence and a legitimate zero
// are indistinguishable afterwards: `poolPremium` of 0 in a degenerate year is a
// real answer, and `rateLevel` of undefined is not. Catching the ACCESS rather
// than inspecting the RESULT tells those apart with no tolerance to tune.
//
// ⚠ AND IT CHECKS THE OTHER DIRECTION TOO, which is the half that stops the flag
// becoming a dumping ground. A metric marked `lineOnly` that does NOT read an
// absent field is over-marked: it was dropped from the Pool tab for no reason,
// and a row the pool could have shown is missing. Both directions fail.
//
// ⚠ THE `poolValue` ESCAPE IS CHECKED ON ITS OWN TERMS. A metric may be
// line-only in form and pool-wide in substance — `riskControlPct` is one spend
// projected into every line — and carries a `poolValue` that reads `pool`
// instead. Those are evaluated against the proxy as well, so a pool form that
// reaches back into a line field is caught like any other.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { RESULT_METRICS } from '../../src/utils/resultMetrics';
import { buildPoolMetrics, buildLineMetrics, type SpreadsheetMetric } from '../../src/utils/resultsExport';
import type { CoverageLine, GameState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = 3;

/** Mirrors PoolAbsentKey in types/simulation.ts. Kept here as a literal list so
 *  the gate fails loudly if the two drift rather than silently checking less. */
const ABSENT = [
  'rateLevel', 'ratePer100', 'purePremiumPer100', 'purePremium',
  'expectedCededPer100', 'netPurePremiumPer100',
  'selectedFundingConfidenceLevel', 'selectedFundingCLF', 'fundingCLF',
  'decisions', 'commonLossFactor', 'aggregateAttachment',
] as const;

class AbsentFieldRead extends Error {
  constructor(public key: string) { super(`read of absent pool field '${key}'`); }
}

function guard(row: ResultSet): ResultSet {
  return new Proxy(row as unknown as Record<string, unknown>, {
    get(target, prop) {
      if (typeof prop === 'string' && (ABSENT as readonly string[]).includes(prop)) {
        throw new AbsentFieldRead(prop);
      }
      return target[prop as string];
    },
  }) as unknown as ResultSet;
}

function playOne(): ResultSet {
  const inst = generateGameInstance('PRM1', 9_100_000);
  const setup = { poolName: 'PRM', gameLength: YEARS, startingYear: 2026, instanceId: 'PRM1', activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  let last: ResultSet | null = null;
  for (let y = 1; y <= YEARS; y++) {
    const out = processYear(gs, defaultDecisionSet(y));
    last = out.result;
    gs = {
      ...gs, poolState: out.updatedPoolState, lockedResults: [...gs.lockedResults, out.result],
      currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1), isComplete: y >= YEARS,
    };
  }
  return last!;
}

/** Runs one accessor and reports which absent key it reached for, if any. */
function probe(fn: (r: never) => unknown, row: ResultSet): string | null {
  try { fn(guard(row) as never); return null; } catch (e) {
    if (e instanceof AbsentFieldRead) return e.key;
    return null;  // a metric throwing for its own reasons is not this gate's subject
  }
}

const row = playOne();
const poolMetrics = buildPoolMetrics(RESULT_METRICS, LINES);
const failures: string[] = [];

console.log('='.repeat(78));
console.log('POOL-ROW METRIC CHECK — every Pool-tab metric, against a real pool row');
console.log('='.repeat(78));
console.log(`  base metrics ${RESULT_METRICS.length}   pool-tab metrics ${poolMetrics.length}`);

// --- 1. nothing on the Pool tab may read an absent field --------------------
let leaks = 0;
for (const m of poolMetrics) {
  for (const [what, fn] of [['value', m.value], ['csvValue', m.csvValue]] as const) {
    if (!fn) continue;
    const key = probe(fn as (r: never) => unknown, row);
    if (key) {
      leaks++;
      failures.push(`POOL TAB: metric '${m.key}' (${what}) reads '${key}', which the pool row does not have. `
        + 'Mark it `lineOnly: true` — or, if the quantity really is pool-wide, give it a `poolValue` '
        + 'that reads `pool`.');
    }
  }
}
console.log(`  pool-tab metrics reading an absent field: ${leaks}`);

// --- 2. nothing may be marked lineOnly without reading one ------------------
let overMarked = 0;
for (const m of RESULT_METRICS) {
  if (!m.lineOnly) continue;
  const reads = probe(m.value as (r: never) => unknown, row)
    ?? (m.csvValue ? probe(m.csvValue as (r: never) => unknown, row) : null);
  if (!reads) {
    overMarked++;
    failures.push(`OVER-MARKED: metric '${m.key}' is flagged lineOnly but reads no absent field. `
      + 'It is being dropped from the Pool tab for no reason — a row the pool could show is missing.');
  }
}
console.log(`  metrics marked lineOnly that need not be: ${overMarked}`);

// --- 3. the ABSENT list here must match the type ----------------------------
// A key that is still present on a real pool row means this list has drifted
// ahead of PoolAbsentKey and the gate is checking something that is not true.
const stale = ABSENT.filter(k => (row as unknown as Record<string, unknown>)[k] !== undefined);
if (stale.length) {
  failures.push(`THE ABSENT LIST HAS DRIFTED: ${stale.join(', ')} still present on a real pool row. `
    + 'This gate is asserting against a type that has moved; reconcile it with PoolAbsentKey.');
}
console.log(`  absent-list keys still present on the row: ${stale.length}`);

// --- 4. POOLING IS A FIXED POINT -------------------------------------------
// ⚠ THIS ASSERTION PASSED BEFORE THE BUG IT GUARDS WAS FIXED, AND SAYING SO IS
// THE POINT. Pooling twice already equalled pooling once — the second pass saw
// no flags and passed everything through — so idempotence was never the broken
// property. It is asserted anyway because the FIX makes it structural: a pooled
// metric is now returned untouched, so the identity holds by construction
// rather than by the accident of a dropped flag. If someone restores the
// one-way rewrite this stays green; part 5 is the one that would red.
const pooledTwice = buildPoolMetrics(poolMetrics, LINES);
const samePooling = pooledTwice.length === poolMetrics.length
  && pooledTwice.every((m, i) => m.key === poolMetrics[i].key);
if (!samePooling) {
  failures.push('POOLING IS NOT A FIXED POINT: buildPoolMetrics(buildPoolMetrics(x)) differs from '
    + 'buildPoolMetrics(x). The Pool tab a page renders and the one the workbook writes can disagree.');
}
console.log(`  pooling twice == pooling once: ${samePooling}`);

// --- 5. THE MIRROR: every LINE metric against a real LINE row --------------
// ⚠ THIS IS THE ARM THAT DID NOT EXIST, AND ITS ABSENCE IS THE WHOLE DEFECT.
// Part 1 proves no POOL metric reaches for a field a pool row lacks. Nobody had
// ever asserted the reverse, so a metric whose `value` had been rewritten to
// read `r.pool` could be handed to a LINE tab and throw — which is exactly what
// broke the Results download: the page pools its metric list for its own
// on-screen table, passes that same list to buildResultsWorkbook, and the line
// tabs got pool accessors. No gate could see it, because every gate called the
// builder correctly and the builder was never wrong.
//
// BOTH LISTS ARE TESTED: the raw one, and the one that has been through
// buildPoolMetrics. The second is the one that was failing.
const lineRow = row.byLine[LINES[0]];
let lineLeaks = 0;
for (const [label, list] of [
  ['RAW', RESULT_METRICS],
  ['POOLED then line-built', buildPoolMetrics(RESULT_METRICS, LINES)],
] as const) {
  for (const m of buildLineMetrics(list as SpreadsheetMetric[], LINES[0])) {
    for (const [what, fn] of [['value', m.value], ['csvValue', m.csvValue]] as const) {
      if (!fn) continue;
      try { fn(lineRow as never); } catch (e) {
        lineLeaks++;
        failures.push(`LINE TAB (${label}): metric '${m.key}' (${what}) threw on a real line row — `
          + `${e instanceof Error ? e.message : String(e)}. A line metric must read only line fields; `
          + 'if it was rewritten for the Pool tab, buildLineMetrics must restore its line form.');
      }
    }
  }
}
console.log(`  line-tab metrics throwing on a real line row: ${lineLeaks}`);

console.log(`\n${'='.repeat(78)}`);
if (failures.length) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('OK — every Pool-tab metric reads only fields the pool row has, every lineOnly');
  console.log('flag earns itself, the absent list matches the shipped type, pooling is a fixed');
  console.log('point, and every LINE-tab metric survives a real line row from both list forms.');
}
