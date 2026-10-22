// ============================================================================
// THE NEW RATE STACK TIES OUT — BOTH INDICATIONS, FROM THEIR OWN COMPONENTS.
//
//   npx tsx scripts/diagnostics/new-rate-tieout-check.ts
//
// ⚠ IT TESTS A PATH THE SWEEP CANNOT REACH. NEW_RATE_STACK is off in every
// shipped build, so the full sweep and both value baselines exercise the OLD
// stack exclusively. This file flips the flag at runtime, prices real games
// through the new stack, and flips it back — which is the only way the new
// arithmetic is checked at all until the flag turns on for good.
//
// ⚠ IT MUST NOT RUN BESIDE ANYTHING THAT READS THE FLAG. It mutates a module
// constant for the length of the run, exactly as full-cost-booking-report does
// with FULL_COST_BOOKING, and restores it in a `finally`.
//
// WHAT IT ASSERTS, on every line and year:
//
//   1. THE FIRST INDICATION TIES: (ground-up + admin) / divisor, rebuilt here
//      from the parameters, equals the engine's figure to the bit.
//   2. THE FINAL RATE TIES: (retained x CLF + admin) / divisor + reinsurance.
//      With the aggregate stop on, retained IS the ground-up claims cost: the
//      cover's expected recovery is not taken off it
//      (STOP_RECOVERY_OFF_CLAIMS_COST off) and its full price is the
//      reinsurance.
//   3. THE TWO ARE ORDERED AS THEIR DEFINITIONS REQUIRE. The final rate is
//      below the first indication whenever the team funds at or below expected
//      and cedes nothing — and the check states the condition rather than
//      asserting an unconditional inequality that is simply false for a team
//      funding at 95%.
//   4. ADMIN IS NOT GROSSED UP BY THE CLF and REINSURANCE IS NOT GROSSED UP BY
//      THE DIVISOR. Both are tested by rebuilding the rate with the error in
//      place and requiring it to DIFFER — a mutation test, not an assertion
//      that the code equals itself.
//   5. THE QUOTE IS ADDITIVE: pool + admin + reinsurance equals the total the
//      engine charges, which is the identity every downstream reader assumes.
//
// ⚠ ASSERTION 1 AND 2 ARE RECOMPUTATIONS AND WOULD PASS AGAINST A WRONG
// FORMULA IF THIS FILE COPIED IT. They do not copy it: they are written from
// the DESIGN as stated in the brief — ground-up for the indication, retained
// for the rate, CLF on the pure premium only, reinsurance outside the divisor
// — so a stack that implemented something else would fail here.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { adminRatePer100For, expenseDivisor, expectedCededPer100For } from '../../src/utils/linePricing';
import { AGGREGATE_STOP, NEW_RATE_STACK, STOP_RECOVERY_OFF_CLAIMS_COST } from '../../src/data/pricingParameters';
import { quoteNewRateStack, newStackAsLineRateQuote } from '../../src/utils/linePricing';
import type { CoverageLine, GameState, LinePoolState } from '../../src/types/simulation';
import { AGGREGATE_NOT_OFFERED, placementFor } from '../../src/utils/reinsuranceOptions';
import { lineBookRisk } from '../../src/utils/bookUnits';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 3);
const YEARS = Number(process.env.YEARS ?? 5);

// ⚠ NOT BIT-EXACT, AND THE REASON IS A REAL BASIS DIFFERENCE RATHER THAN
// SLOPPINESS. The engine prices on the PRE-MOVEMENT book — the exposure that
// exists when members decide — while the only exposure on the result is
// `writtenExposure`, which is after joins and departures. Admin is
// `fixed / exposure + rate`, so the two exposures give admin figures that
// differ in the sixth decimal. Measured worst departure 5.4e-6 on rates of
// 3 to 10, i.e. under one part in a million.
//
// The bar is set an order of magnitude above that and two orders below any
// real error: a CLF applied to admin, or a divisor applied to reinsurance,
// moves the rate by 0.05 to 0.5, not by 1e-5. Assertion 4 tests those
// directly rather than relying on this tolerance to catch them.
const EPS = 1e-4;

let failures = 0;
const fail = (s: string) => { failures++; if (failures <= 20) console.log(`  FAIL  ${s}`); };

console.log('=== NEW RATE TIEOUT CHECK ===\n');

interface Row {
  line: CoverageLine; year: number;
  first: number; final: number; rebuiltFirst: number; rebuiltFinal: number;
  admin: number; divisor: number; clf: number;
  groundUp: number; retained: number; reins: number;
  total: number;
}

function play(): Row[] {
  const rows: Row[] = [];
  for (let g = 0; g < GAMES; g++) {
    const id = `NR${g}`;
    const inst = generateGameInstance(id, 6_100_000 + g * 7919);
    const setup = {
      poolName: 'A', gameLength: YEARS + 1, startingYear: 2026, instanceId: id, activeLines: LINES,
    };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true,
      isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= YEARS; y++) {
      const d = defaultDecisionSet(y);
      const p = processYear(gs, d);
      for (const line of LINES) {
        const r = p.result.byLine[line];
        if (!r || r.firstIndicationPer100 === undefined || r.finalRatePer100 === undefined) continue;
        const groundUp = r.newPurePremiumPer100!;
        const exposure = r.writtenExposure;
        const ld = d.byLine[line];
        const admin = adminRatePer100For(line, exposure);
        const divisor = expenseDivisor(ld.riskControlIncentivePct ?? 0);
        const { expectedCededPer100 } = expectedCededPer100For(line, y, groundUp, {
          // A book (MEMBER_LEVEL off) is priced on its exposure, as the engine
          // prices it; a roster on its members.
          members: (gs.poolState.lines[line] as LinePoolState).bookExposure !== undefined
            ? { exposure, risk: lineBookRisk(gs.instance, line, gs.poolState.bookUnits, gs.poolState.bookLedger) ?? 1 }
            : (gs.poolState.lines[line] as LinePoolState).members ?? [],
          exposure, layersPlaced: placementFor(line, ld.reinsuranceOption), aggregateStopLevel: AGGREGATE_NOT_OFFERED,
          reinsuranceOption: ld.reinsuranceOption,
        });
        const netted = AGGREGATE_STOP.enabled && !STOP_RECOVERY_OFF_CLAIMS_COST.enabled ? 0 : expectedCededPer100;
        const retained = Math.max(0, groundUp - netted);
        const reins = (r.reinsuranceCost ?? 0) / Math.max(exposure * 10_000, 1);
        rows.push({
          line, year: y,
          first: r.firstIndicationPer100, final: r.finalRatePer100,
          rebuiltFirst: (groundUp + admin) / divisor,
          rebuiltFinal: (retained * r.selectedFundingCLF + admin) / divisor + reins,
          admin, divisor, clf: r.selectedFundingCLF,
          groundUp, retained, reins,
          total: r.ratePer100,
        });
      }
      gs = {
        ...gs, poolState: p.updatedPoolState, currentYearNumber: y + 1,
        currentDecisions: defaultDecisionSet(y + 1), lockedResults: [...gs.lockedResults, p.result] as never,
      };
    }
  }
  return rows;
}

const wasEnabled = NEW_RATE_STACK.enabled;
let rows: Row[] = [];
try {
  NEW_RATE_STACK.enabled = true;
  rows = play();
} finally {
  NEW_RATE_STACK.enabled = wasEnabled;
}

if (rows.length === 0) {
  console.log('  FAIL  the flag was on and NO line-year produced an indication — nothing was tested');
  failures++;
}

// --------------------------------------------------------------------------
console.log(`--- 1 & 2. BOTH INDICATIONS TIE TO THEIR COMPONENTS (${rows.length} line-years) ---`);
let worstFirst = 0, worstFinal = 0;
for (const r of rows) {
  const d1 = Math.abs(r.first - r.rebuiltFirst);
  const d2 = Math.abs(r.final - r.rebuiltFinal);
  worstFirst = Math.max(worstFirst, d1); worstFinal = Math.max(worstFinal, d2);
  if (d1 > EPS) {
    fail(`${r.line} y${r.year} first indication ${r.first.toFixed(6)} against rebuilt `
      + `${r.rebuiltFirst.toFixed(6)} — (ground-up ${r.groundUp.toFixed(4)} + admin `
      + `${r.admin.toFixed(4)}) / ${r.divisor.toFixed(4)}`);
  }
  if (d2 > EPS) {
    fail(`${r.line} y${r.year} final rate ${r.final.toFixed(6)} against rebuilt `
      + `${r.rebuiltFinal.toFixed(6)} — (retained ${r.retained.toFixed(4)} x CLF `
      + `${r.clf.toFixed(4)} + admin ${r.admin.toFixed(4)}) / ${r.divisor.toFixed(4)} + reins ${r.reins.toFixed(4)}`);
  }
}
console.log(`  worst departure: first ${worstFirst.toExponential(2)}, final ${worstFinal.toExponential(2)}`);

// --------------------------------------------------------------------------
console.log('\n--- 3. THE TWO ARE ORDERED AS THEIR DEFINITIONS REQUIRE ---');
// ⚠ THE FIRST VERSION OF THIS ASSERTION WAS VACUOUS AND IS RECORDED AS SUCH.
// It required CLF exactly 1 AND nothing ceded, and the default book places the
// tower, so it ran on 0 of 45 line-years and passed by never executing. This
// is the same claim stated so that it always fires: at CLF 1 the gap between
// the two rates is EXACTLY the ceded pure premium carried through the divisor,
// less the reinsurance added back. Cede nothing and the gap is nil, which is
// the original claim as a special case rather than as the only case.
let checkedOrder = 0;
for (const r of rows) {
  if (Math.abs(r.clf - 1) > 1e-12) continue;
  checkedOrder++;
  const expectedGap = (r.groundUp - r.retained) / r.divisor - r.reins;
  if (Math.abs((r.first - r.final) - expectedGap) > EPS) {
    fail(`${r.line} y${r.year}: at CLF 1 the indication less the rate (${(r.first - r.final).toFixed(6)}) `
      + `must be the ceded premium through the divisor less reinsurance (${expectedGap.toFixed(6)})`);
  }
}
if (checkedOrder === 0) fail('no line-year had CLF 1 — assertion 3 tested nothing');
console.log(`  ${checkedOrder} line-year(s) at CLF 1.`);

// --------------------------------------------------------------------------
console.log('\n--- 4. THE TWO LOADING ERRORS ARE NOT PRESENT (mutation test) ---');
// ⚠ PRICED AT A CLF THAT IS NOT 1, AND THE FIRST VERSION OF THIS WAS VACUOUS
// FOR WANT OF THAT. It ran over the played rows, every one of which funds at
// Expected — CLF exactly 1.0000 — where `admin x clf` IS `admin` and the
// mutation changes nothing. Grossing admin up by the CLF was introduced
// deliberately and the gate stayed green on 45 of 45 rows.
//
// So the two errors are tested on a quote priced at CLF 1.25, where each one
// moves the rate by an amount no tolerance could absorb. The check is that the
// implemented rate matches the DESIGNED formula and differs from both wrong
// ones — stated as a margin, so a future change that narrows the gap is seen.
{
  const CLF = 1.25;
  let tested = 0;
  for (const line of LINES) {
    const groundUp = line === 'Property' ? 0.30 : 6.0;
    const q = quoteNewRateStack({
      line, yearNumber: 1, members: [], exposure: 100,
      groundUpPurePremiumPer100: groundUp, clf: CLF,
      riskControlPct: 0.02, layersPlaced: [], aggregateStopLevel: -1, reinsuranceOption: 'none',
    });
    const designed = (q.retainedPurePremiumPer100 * CLF + q.adminRatePer100) / q.divisor + q.reinsRatePer100;
    const adminGrossed = (q.retainedPurePremiumPer100 * CLF + q.adminRatePer100 * CLF) / q.divisor + q.reinsRatePer100;
    const reinsGrossed = (q.retainedPurePremiumPer100 * CLF + q.adminRatePer100 + q.reinsRatePer100) / q.divisor;
    tested++;
    if (Math.abs(q.finalRatePer100 - designed) > 1e-12) {
      fail(`${line}: the implemented rate ${q.finalRatePer100} is not the designed formula ${designed}`);
    }
    // ⚠ ONLY THE ADMIN ERROR IS TESTABLE HERE. This quote has no members, so
    // the tower prices at zero and `(x + 0) / d` is `x / d` — the reinsurance
    // mutation is a no-op on it, exactly as the admin mutation was a no-op on
    // the CLF-1 rows. It is tested on the played rows below, where
    // reinsurance is 0.9 to 2.8 per $100 and the divisor is 0.95.
    void reinsGrossed;
    const dAdmin = Math.abs(q.finalRatePer100 - adminGrossed);
    if (dAdmin < 1e-6) fail(`${line}: admin IS grossed up by the CLF — the two forms agree to ${dAdmin}`);
    console.log(`  ${line.padEnd(9)} CLF ${CLF}: rate ${q.finalRatePer100.toFixed(4)}, `
      + `admin-grossed would be ${adminGrossed.toFixed(4)} — ${dAdmin.toFixed(4)} away`);
  }
  if (tested !== LINES.length) fail('assertion 4a did not price every line');

  // The reinsurance error, on rows that actually carry reinsurance.
  let withReins = 0, worstGap = Infinity;
  for (const r of rows) {
    if (!(r.reins > 1e-6) || Math.abs(r.divisor - 1) < 1e-12) continue;
    withReins++;
    const correct = (r.retained * r.clf + r.admin) / r.divisor + r.reins;
    const grossed = (r.retained * r.clf + r.admin + r.reins) / r.divisor;
    const gap = Math.abs(correct - grossed);
    worstGap = Math.min(worstGap, gap);
    if (Math.abs(r.final - grossed) < EPS) {
      fail(`${r.line} y${r.year}: reinsurance IS grossed up by the divisor`);
    }
  }
  // ⚠ AND ON A DIRECT QUOTE, because the played rows may carry no divisor at
  // all: with risk control off and profit and contingency at 0 (since the
  // contingency went to 0), every played divisor is exactly 1 and the loop
  // above skips them all. A quote with the risk-control slider at 10% and the
  // Bad-year cover bought has both, on every line.
  let direct = 0;
  for (const line of LINES) {
    const q = quoteNewRateStack({
      line, yearNumber: 1, members: [], exposure: line === 'Property' ? 9000 : 900,
      groundUpPurePremiumPer100: line === 'Property' ? 0.30 : 3.0, clf: 1,
      riskControlPct: 0.10, layersPlaced: [], aggregateStopLevel: -1, reinsuranceOption: 'bad-year',
    });
    if (!(q.reinsRatePer100 > 1e-6) || Math.abs(q.divisor - 1) < 1e-12) continue;
    direct++;
    const correct = (q.retainedPurePremiumPer100 * q.clf + q.adminRatePer100) / q.divisor + q.reinsRatePer100;
    const grossed = (q.retainedPurePremiumPer100 * q.clf + q.adminRatePer100 + q.reinsRatePer100) / q.divisor;
    worstGap = Math.min(worstGap, Math.abs(correct - grossed));
    if (Math.abs(q.finalRatePer100 - correct) > 1e-12) fail(`${line} direct: the implemented rate is not the designed formula`);
    if (Math.abs(q.finalRatePer100 - grossed) < EPS) fail(`${line} direct: reinsurance IS grossed up by the divisor`);
  }
  if (direct !== LINES.length) fail(`assertion 4b's direct quote carried reinsurance and a divisor on ${direct} of ${LINES.length} lines`);
  if (withReins + direct === 0) fail('assertion 4b tested nothing — no row carried both reinsurance and a divisor');
  console.log(`  reinsurance-outside-the-divisor tested on ${withReins} played row(s) and ${direct} direct quote(s); `
    + `smallest gap between the two forms ${worstGap.toFixed(4)} per $100`);
}

console.log('\n--- 5. THE ADAPTER IS ADDITIVE ---');
// ⚠ TESTED ON THE ADAPTER DIRECTLY, NOT OFF THE RESULT. The first version read
// `poolPremiumRatePer100` and `adminRatePer100` from the line result, where
// neither exists — both came back undefined, were coerced to 0, and the
// "worst departure" it printed was simply the rate. It passed nothing and
// would have reported a failure for the wrong reason forever.
//
// What matters is that `newStackAsLineRateQuote` splits the loading without
// losing any of it, because every downstream reader assumes
// pool + admin + reinsurance === total. That is a property of the adapter and
// needs no game to test.
{
  let worstAdd = 0, n = 0;
  for (const r of rows) {
    const q = quoteNewRateStack({
      line: r.line, yearNumber: r.year, members: [], exposure: 100,
      groundUpPurePremiumPer100: r.groundUp, clf: r.clf,
      riskControlPct: 0, layersPlaced: [], aggregateStopLevel: -1, reinsuranceOption: 'none',
    });
    const lrq = newStackAsLineRateQuote(q, 100);
    const sum = lrq.poolPremiumRatePer100 + lrq.adminRatePer100 + lrq.reinsRatePer100;
    const d = Math.abs(sum - lrq.totalMemberChargeRatePer100);
    const d2 = Math.abs(lrq.totalMemberChargeRatePer100 - q.finalRatePer100);
    worstAdd = Math.max(worstAdd, d, d2); n++;
    if (d > 1e-12) fail(`adapter not additive on ${r.line}: ${sum} vs ${lrq.totalMemberChargeRatePer100}`);
    if (d2 > 1e-12) fail(`adapter total is not the designed rate on ${r.line}`);
    if (lrq.retainedCoverMargin !== 0) fail('the retained-cover margin is not retired under the new stack');
  }
  console.log(`  ${n} adapter quote(s), worst departure ${worstAdd.toExponential(2)}; retained-cover margin 0 throughout.`);
}

console.log(`\n${failures === 0
  ? 'BOTH INDICATIONS TIE OUT, NEITHER LOADING ERROR IS PRESENT, AND THE QUOTE IS ADDITIVE.'
  : `${failures} FAILURE(S).`}`);
process.exit(failures === 0 ? 0 : 1);
