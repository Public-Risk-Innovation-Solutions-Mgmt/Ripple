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
//   1. THE FIRST INDICATION TIES: ground-up / (1 - risk control - admin's
//      share), the share written out from the brief (20%; restated at
//      wip/pricing-rework from (ground-up + fixed and per-exposure admin) /
//      (1 - risk control - profit and contingency), all three retired; at
//      wip/risk-control risk control left the divisor for a multiplier, and at
//      wip/risk-control-divisor it came back).
//   2. THE FINAL RATE TIES: retained x CLF / (1 - rc - admin share) +
//      reinsurance, retained being the ground-up less anything netted. The
//      played games buy risk control at 3% on GL every year, so the divisor's
//      risk control is tied on real rows.
//      With the aggregate stop on, retained IS the ground-up claims cost: the
//      cover's expected recovery is not taken off it
//      (STOP_RECOVERY_OFF_CLAIMS_COST off) and its full price is the
//      reinsurance.
//   3. THE TWO ARE ORDERED AS THEIR DEFINITIONS REQUIRE. The final rate is
//      below the first indication whenever the team funds at or below expected
//      and cedes nothing — and the check states the condition rather than
//      asserting an unconditional inequality that is simply false for a team
//      funding at 95%.
//   4. ADMIN IS A SHARE OF PREMIUM — not a load on the loss cost, and with no
//      profit and contingency beside it — RISK CONTROL IS IN THE DIVISOR, NOT A
//      MULTIPLIER ON THE RATE, and REINSURANCE IS NOT GROSSED UP BY
//      THE DIVISOR. All are tested by rebuilding the rate with the error in
//      place and requiring it to DIFFER — a mutation test, not an assertion
//      that the code equals itself.
//   5. THE QUOTE IS ADDITIVE: pool + admin + risk control + reinsurance equals the total the
//      engine charges, which is the identity every downstream reader assumes.
//
// ⚠ ASSERTION 1 AND 2 ARE RECOMPUTATIONS AND WOULD PASS AGAINST A WRONG
// FORMULA IF THIS FILE COPIED IT. They do not copy it: they are written from
// the DESIGN as stated in the brief — ground-up for the indication, retained
// for the rate, admin 20% of premium, reinsurance outside the divisor
// — so a stack that implemented something else would fail here.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { expectedCededPer100For } from '../../src/utils/linePricing';
import { AGGREGATE_STOP, NEW_RATE_STACK, STOP_RECOVERY_OFF_CLAIMS_COST } from '../../src/data/pricingParameters';
import { quoteNewRateStack, newStackAsLineRateQuote } from '../../src/utils/linePricing';
import type { CoverageLine, GameState, LinePoolState } from '../../src/types/simulation';
import { AGGREGATE_NOT_OFFERED, placementFor } from '../../src/utils/reinsuranceOptions';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
/** Admin's share of premium, written out from the brief rather than read from the parameter. */
const BRIEFED_ADMIN_SHARE = 0.2;
// Risk control in it beside admin (wip/risk-control-divisor).
const briefedDivisor = (rc: number) => 1 - rc - BRIEFED_ADMIN_SHARE;
/** The slider played on GL every year, so the divisor's risk control is tied on real rows. */
const PLAYED_RC = 0.03;
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
  admin: number; divisor: number; clf: number; rc: number;
  groundUp: number; credited: number; retained: number; reins: number;
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
      const d0 = defaultDecisionSet(y);
      const d = { ...d0, byLine: { ...d0.byLine, GL: { ...d0.byLine.GL, riskControlIncentivePct: PLAYED_RC } } };
      const p = processYear(gs, d);
      for (const line of LINES) {
        const r = p.result.byLine[line];
        if (!r || r.firstIndicationPer100 === undefined || r.finalRatePer100 === undefined) continue;
        const groundUp = r.newPurePremiumPer100!;
        const exposure = r.writtenExposure;
        const ld = d.byLine[line];
        const divisor = briefedDivisor(ld.riskControlIncentivePct ?? 0);
        const { expectedCededPer100 } = expectedCededPer100For(line, y, groundUp, {
          // A book (MEMBER_LEVEL off) is priced on its exposure, as the engine
          // prices it; a roster on its members.
          members: (gs.poolState.lines[line] as LinePoolState).bookExposure !== undefined
            ? { exposure, risk: 1 }
            : (gs.poolState.lines[line] as LinePoolState).members ?? [],
          exposure, layersPlaced: placementFor(line, ld.reinsuranceOption), aggregateStopLevel: AGGREGATE_NOT_OFFERED,
          reinsuranceOption: ld.reinsuranceOption,
        });
        const netted = AGGREGATE_STOP.enabled && !STOP_RECOVERY_OFF_CLAIMS_COST.enabled ? 0 : expectedCededPer100;
        // No investment income credit: investment income does not touch the rate.
        const credited = groundUp;
        const retained = Math.max(0, credited - netted);
        const admin = retained * r.selectedFundingCLF / divisor * BRIEFED_ADMIN_SHARE;
        const reins = (r.reinsuranceCost ?? 0) / Math.max(exposure * 10_000, 1);
        const rc = ld.riskControlIncentivePct ?? 0;
        rows.push({
          line, year: y,
          first: r.firstIndicationPer100, final: r.finalRatePer100,
          rebuiltFirst: credited / divisor,
          rebuiltFinal: retained * r.selectedFundingCLF / divisor + reins,
          admin, divisor, clf: r.selectedFundingCLF, rc,
          groundUp, credited, retained, reins,
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
      + `${r.rebuiltFirst.toFixed(6)} — credited ${r.credited.toFixed(4)} / ${r.divisor.toFixed(4)}`);
  }
  if (d2 > EPS) {
    fail(`${r.line} y${r.year} final rate ${r.final.toFixed(6)} against rebuilt `
      + `${r.rebuiltFinal.toFixed(6)} — retained ${r.retained.toFixed(4)} x CLF `
      + `${r.clf.toFixed(4)} / ${r.divisor.toFixed(4)} (admin ${r.admin.toFixed(4)} inside it) + reins ${r.reins.toFixed(4)}`);
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
  const expectedGap = (r.credited - r.retained) / r.divisor - r.reins;
  if (Math.abs((r.first - r.final) - expectedGap) > EPS) {
    fail(`${r.line} y${r.year}: at CLF 1 the indication less the rate (${(r.first - r.final).toFixed(6)}) `
      + `must be the ceded premium through the divisor less reinsurance (${expectedGap.toFixed(6)})`);
  }
}
if (checkedOrder === 0) fail('no line-year had CLF 1 — assertion 3 tested nothing');
console.log(`  ${checkedOrder} line-year(s) at CLF 1.`);

// --------------------------------------------------------------------------
console.log('\n--- 4. THE LOADING ERRORS ARE NOT PRESENT (mutation test) ---');
// ⚠ PRICED AT A CLF THAT IS NOT 1, so a wrong form that only differs through
// the CLF cannot hide behind CLF 1.0000 (the first version of this assertion
// was vacuous for exactly that reason). Restated at wip/pricing-rework: the
// errors are now admin as a LOAD ON THE LOSS COST (s x the pure premium x CLF
// on top, the old shape) rather than a share of premium, and the old WC 2%
// profit and contingency left in the divisor. The implemented rate must match
// the DESIGNED formula and differ from both.
{
  const CLF = 1.25;
  let tested = 0;
  for (const line of LINES) {
    const groundUp = line === 'Property' ? 0.30 : 6.0;
    const rc = 0.02;
    const q = quoteNewRateStack({
      line, yearNumber: 1, members: [], exposure: 100,
      groundUpPurePremiumPer100: groundUp, clf: CLF,
      riskControlPct: rc, layersPlaced: [], aggregateStopLevel: -1, reinsuranceOption: 'none',
    });
    const designed = q.retainedPurePremiumPer100 * CLF / briefedDivisor(rc) + q.reinsRatePer100;
    const adminAsLoad = q.retainedPurePremiumPer100 * CLF * (1 + BRIEFED_ADMIN_SHARE) / (1 - rc) + q.reinsRatePer100;
    const withOldPc = q.retainedPurePremiumPer100 * CLF / (briefedDivisor(rc) - 0.02) + q.reinsRatePer100;
    // wip/risk-control's form: risk control a multiplier on the rate, (1 + rc).
    const rcAsMultiplier = q.retainedPurePremiumPer100 * CLF / (1 - BRIEFED_ADMIN_SHARE) * (1 + rc) + q.reinsRatePer100;
    tested++;
    if (Math.abs(q.finalRatePer100 - designed) > 1e-12) {
      fail(`${line}: the implemented rate ${q.finalRatePer100} is not the designed formula ${designed}`);
    }
    if (Math.abs(q.adminRatePer100 / (q.finalRatePer100 - q.reinsRatePer100) - BRIEFED_ADMIN_SHARE) > 1e-12) {
      fail(`${line}: admin is not ${BRIEFED_ADMIN_SHARE * 100}% of the rate before reinsurance`);
    }
    if (Math.abs(q.riskControlPer100 / (q.finalRatePer100 - q.reinsRatePer100) - rc) > 1e-12) {
      fail(`${line}: the risk control charge is not ${rc * 100}% of the rate before reinsurance`);
    }
    const dLoad = Math.abs(q.finalRatePer100 - adminAsLoad), dPc = Math.abs(q.finalRatePer100 - withOldPc);
    const dRc = Math.abs(q.finalRatePer100 - rcAsMultiplier);
    if (dLoad < 1e-6) fail(`${line}: admin IS a load on the loss cost — the two forms agree to ${dLoad}`);
    if (dPc < 1e-6) fail(`${line}: the old profit and contingency IS in the divisor — the two forms agree to ${dPc}`);
    if (dRc < 1e-6) fail(`${line}: risk control IS a multiplier on the rate, (1 + rc) — the two forms agree to ${dRc}`);
    console.log(`  ${line.padEnd(9)} CLF ${CLF}: rate ${q.finalRatePer100.toFixed(4)}, `
      + `admin-as-load would be ${adminAsLoad.toFixed(4)} (${dLoad.toFixed(4)} away), with the old 2% ${withOldPc.toFixed(4)} (${dPc.toFixed(4)} away), `
      + `risk control as a multiplier ${rcAsMultiplier.toFixed(4)} (${dRc.toFixed(4)} away)`);
  }
  if (tested !== LINES.length) fail('assertion 4a did not price every line');

  // The reinsurance error, on rows that actually carry reinsurance.
  let withReins = 0, worstGap = Infinity;
  for (const r of rows) {
    if (!(r.reins > 1e-6) || Math.abs(r.divisor - 1) < 1e-12) continue;
    withReins++;
    const correct = r.retained * r.clf / r.divisor + r.reins;
    const grossed = (r.retained * r.clf + r.reins) / r.divisor;
    const gap = Math.abs(correct - grossed);
    worstGap = Math.min(worstGap, gap);
    if (Math.abs(r.final - grossed) < EPS) {
      fail(`${r.line} y${r.year}: reinsurance IS grossed up by the divisor`);
    }
  }
  // ⚠ AND ON A DIRECT QUOTE, because the played rows may carry no
  // reinsurance (the default cover is None). A quote with the risk-control
  // slider at 10% and the Bad-year cover bought has both, on every line.
  let direct = 0;
  for (const line of LINES) {
    const q = quoteNewRateStack({
      line, yearNumber: 1, members: [], exposure: line === 'Property' ? 9000 : 900,
      groundUpPurePremiumPer100: line === 'Property' ? 0.30 : 3.0, clf: 1,
      riskControlPct: 0.10, layersPlaced: [], aggregateStopLevel: -1, reinsuranceOption: 'bad-year',
    });
    if (!(q.reinsRatePer100 > 1e-6) || Math.abs(q.divisor - 1) < 1e-12) continue;
    direct++;
    const correct = q.retainedPurePremiumPer100 * q.clf / briefedDivisor(0.10) + q.reinsRatePer100;
    const grossed = (q.retainedPurePremiumPer100 * q.clf + q.reinsRatePer100) / briefedDivisor(0.10);
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
      riskControlPct: r.rc, layersPlaced: [], aggregateStopLevel: -1, reinsuranceOption: 'none',
    });
    const lrq = newStackAsLineRateQuote(q, 100);
    const sum = lrq.poolPremiumRatePer100 + lrq.adminRatePer100 + (lrq.riskControlRatePer100 ?? 0) + lrq.reinsRatePer100;
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
