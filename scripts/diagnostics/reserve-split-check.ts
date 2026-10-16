// ============================================================================
// CASE AND IBNR ADD UP, AND NOTHING ECONOMIC CAN SEE THEM.
//
//   npx tsx scripts/diagnostics/reserve-split-check.ts
//   GAMES=4 YEARS=8 npx tsx scripts/diagnostics/reserve-split-check.ts
//
// Two claims, and they fail in different ways, so both are asserted separately.
//
//   1. THE SPLIT ADDS UP. For every accident year, line and valuation, case and
//      IBNR are each at least zero and sum EXACTLY to the unpaid reserve. This
//      is the arithmetic the exhibit's reader will do; if it fails, a published
//      table does not foot.
//
//   2. THE SPLIT IS INERT. Case and IBNR are a presentation — the engine books
//      claims at full cost and holds no unreported inventory — so changing the
//      split must move NO economic figure. Asserted by playing identical games
//      with SPLIT_PRESENTATION.invert on and off and requiring every numeric
//      result field to come back BIT-IDENTICAL. Inverting swaps case and IBNR
//      wholesale, which is as large a change to the split as can be made while
//      keeping claim 1 true, so anything reading the split would move.
//
// ⚠ CLAIM 2 IS THE ONE WORTH HAVING AND IT IS THE ONE A FUTURE EDIT WILL
// BREAK. "Read by nothing economic" is a property of the whole program, not of
// reserveSplit.ts, and it cannot be kept by a comment. The day someone funds
// off IBNR, or puts case reserves into required capital, this goes red and says
// which field moved.
//
// ⚠ IT MUST BE SHOWN TO FAIL. A gate asserting an identity that holds by
// construction passes whether or not it is wired up. Both claims were confirmed
// to fail on purpose before this was committed — see THE CONTROLS at the foot.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SPLIT_PRESENTATION } from '../../src/utils/reserveSplit';
import type {
  AccidentYearSplit, CoverageLine, GameState, LineResultSet, ResultSet,
} from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 3);
const YEARS = Number(process.env.YEARS ?? 6);

let failures = 0;
const fail = (s: string) => { failures++; if (failures <= 20) console.log(`  FAIL  ${s}`); };

console.log('=== RESERVE SPLIT CHECK ===\n');

// ⚠ THE SUM IS CHECKED IN DOLLARS, NOT BIT-EXACTLY, AND THE BOUND IS STATED.
// `case = unpaid - ibnr` is exact in floating point, so the per-year identity
// really is bit-exact; the LINE TOTAL is a sum of many such rows and carries
// ordinary accumulation noise. A tenth of a cent on a balance measured in tens
// of millions is nine significant figures of agreement — far tighter than any
// real defect and far looser than float noise.
const DOLLAR_TOLERANCE = 0.001;

function playGame(id: string, seed: number, invert: boolean): ResultSet[] {
  SPLIT_PRESENTATION.invert = invert;
  try {
    const inst = generateGameInstance(id, seed);
    const setup = {
      poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES,
    };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true,
      isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    const out: ResultSet[] = [];
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      out.push(p.result);
      gs = {
        ...gs, poolState: p.updatedPoolState, currentYearNumber: y + 1,
        currentDecisions: defaultDecisionSet(y + 1),
      };
    }
    return out;
  } finally {
    SPLIT_PRESENTATION.invert = false;
  }
}

// --------------------------------------------------------------------------
console.log('--- 1. THE SPLIT ADDS UP, ON EVERY YEAR, LINE AND VALUATION ---');
let rowsChecked = 0, yearsChecked = 0, worstSum = 0, worstDesc = '', negatives = 0;

const baseline: ResultSet[][] = [];
for (let g = 0; g < GAMES; g++) {
  const results = playGame(`RS${g}`, 6_100_000 + g * 7919, false);
  baseline.push(results);

  for (const r of results) {
    for (const line of LINES) {
      const lr = r.byLine[line] as LineResultSet | undefined;
      if (!lr) continue;
      yearsChecked++;

      // The LINE total against the booked reserve.
      const d = Math.abs(lr.caseReservesNet + lr.ibnrNet - lr.endingNetReserve);
      if (d > worstSum) { worstSum = d; worstDesc = `${line} y${r.yearNumber}`; }
      if (d > DOLLAR_TOLERANCE) {
        fail(`${line} y${r.yearNumber}: case ${lr.caseReservesNet.toFixed(2)} + IBNR `
          + `${lr.ibnrNet.toFixed(2)} = ${(lr.caseReservesNet + lr.ibnrNet).toFixed(2)} against booked `
          + `${lr.endingNetReserve.toFixed(2)} — out by ${d.toFixed(4)}`);
      }
      if (lr.caseReservesNet < 0) fail(`${line} y${r.yearNumber}: line case total is negative`);
      if (lr.ibnrNet < 0) fail(`${line} y${r.yearNumber}: line IBNR total is negative`);

      // Every accident year on all three bases.
      for (const row of lr.reserveSplitByYear as AccidentYearSplit[]) {
        rowsChecked++;
        const bases: [string, number, number, number][] = [
          ['net', row.caseNet, row.ibnrNet, row.unpaidNet],
          ['gross', row.caseGross, row.ibnrGross, row.unpaidGross],
          ['ceded', row.caseCeded, row.ibnrCeded, row.unpaidCeded],
        ];
        for (const [basis, c, i, u] of bases) {
          if (c < -DOLLAR_TOLERANCE) { negatives++; fail(`${line} y${r.yearNumber} AY${row.yearNumber} ${basis}: case ${c.toFixed(4)} < 0`); }
          if (i < -DOLLAR_TOLERANCE) { negatives++; fail(`${line} y${r.yearNumber} AY${row.yearNumber} ${basis}: IBNR ${i.toFixed(4)} < 0`); }
          const dd = Math.abs(c + i - u);
          if (dd > DOLLAR_TOLERANCE) {
            fail(`${line} y${r.yearNumber} AY${row.yearNumber} ${basis}: case + IBNR = `
              + `${(c + i).toFixed(4)} against unpaid ${u.toFixed(4)}`);
          }
        }
        // Ceded is gross minus net, by definition, on both halves.
        if (Math.abs((row.caseGross - row.caseNet) - row.caseCeded) > DOLLAR_TOLERANCE
          || Math.abs((row.ibnrGross - row.ibnrNet) - row.ibnrCeded) > DOLLAR_TOLERANCE) {
          fail(`${line} y${r.yearNumber} AY${row.yearNumber}: ceded is not gross minus net`);
        }
      }
    }
  }
}
console.log(`  ${rowsChecked} accident-year rows across ${yearsChecked} line-valuations, 3 bases each.`);
console.log(`  worst line-total departure from the booked reserve: $${worstSum.toExponential(3)} (${worstDesc})`);
console.log(`  negative halves: ${negatives}`);

// --------------------------------------------------------------------------
console.log('\n--- 2. THE SPLIT IS INERT: INVERT IT AND NOTHING ECONOMIC MOVES ---');

// ⚠ THE SPLIT'S OWN FIELDS ARE THE ONLY ONES EXEMPT, and they are named rather
// than pattern-matched, so a new field is compared until somebody deliberately
// adds it here.
const SPLIT_FIELDS = new Set([
  'caseReservesNet', 'ibnrNet', 'caseReservesGross', 'ibnrGross',
  'caseReservesCeded', 'ibnrCeded', 'reserveSplitByYear',
]);

function numericFields(o: object, prefix: string, into: Map<string, number>) {
  for (const [k, v] of Object.entries(o)) {
    if (SPLIT_FIELDS.has(k)) continue;
    if (typeof v === 'number') into.set(`${prefix}${k}`, v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) numericFields(v, `${prefix}${k}.`, into);
  }
}

let compared = 0, moved = 0;
for (let g = 0; g < GAMES; g++) {
  const inverted = playGame(`RS${g}`, 6_100_000 + g * 7919, true);
  for (let y = 0; y < baseline[g].length; y++) {
    const a = new Map<string, number>(), b = new Map<string, number>();
    numericFields(baseline[g][y], `y${y + 1}|`, a);
    numericFields(inverted[y], `y${y + 1}|`, b);
    for (const line of LINES) {
      const la = baseline[g][y].byLine[line], lb = inverted[y].byLine[line];
      if (la) numericFields(la, `y${y + 1}|${line}|`, a);
      if (lb) numericFields(lb, `y${y + 1}|${line}|`, b);
    }
    for (const [k, v] of a) {
      compared++;
      const w = b.get(k);
      // Bit-identical, not approximately: an inert quantity does not drift.
      if (w === undefined || !Object.is(v, w)) {
        moved++;
        fail(`game ${g} ${k}: ${v} -> ${w} — an economic field moved when only the SPLIT changed`);
      }
    }
  }
}
console.log(`  ${compared} numeric field readings compared across ${GAMES} games x ${YEARS} years.`);
console.log(`  ${moved} moved.`);

// --------------------------------------------------------------------------
// THE CONTROLS — run by hand, recorded here, not run every time.
//
//   CLAIM 1 fails on purpose: in reserveSplit.splitCohort, change
//   `const caseNet = unpaidNet - ibnrNet` to `unpaidNet - ibnrNet * 1.01`.
//   MEASURED: exit 1, 2,430 failures, worst line-total departure from the
//   booked reserve $6.438e+5 against $5.960e-8 unmodified. Not every row fails,
//   and that is right: a row holding nothing unpaid still sums to nothing.
//
//   CLAIM 2 fails on purpose: in simulationEngine, make one economic figure
//   read the split — `const expectedNetUnpaidLoss = reserveSplitTotals.caseNet`
//   in place of `endingNetReserve` (the split block has to move above it).
//   MEASURED: exit 1, 1,260 of 17,622 field readings moved, naming
//   expectedNetUnpaidLoss, netFundingTarget, indicatedNetReserveAtConfidence-
//   Level and reserveRiskMarginNeeded first.
//
// Both controls were reverted before commit; this file passes only on the
// unmodified engine.
// --------------------------------------------------------------------------
console.log(`\n${failures === 0
  ? 'CASE AND IBNR SUM TO THE BOOKED RESERVE ON EVERY ROW, AND INVERTING THE SPLIT MOVES NOTHING.'
  : `${failures} FAILURE(S).`}`);
process.exit(failures === 0 ? 0 : 1);
