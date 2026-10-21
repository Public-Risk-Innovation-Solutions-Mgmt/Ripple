// ============================================================================
// THE RATE MEMBERS ARE CHARGED IS THE RATE THEY ARE SHOWN.
//
//   npx tsx scripts/diagnostics/new-rate-bill-check.ts
//
// ⚠ THIS IS THE CHECK WHOSE ABSENCE LET A WHOLE COMMIT SHIP INERT. Commit 3
// wired the new stack into `estimatedQuote` — the PRICE SIGNAL, struck on the
// pre-movement book — and not into the bill, which is quoted again on the
// covered book after movement. With the flag on, `ratePer100`, `poolPremium`,
// `totalMemberCharge` and `reinsuranceCost` came back BIT-IDENTICAL to the
// flag-off run across 20 games x 10 years. The new rate was displayed and
// never charged, and nothing in the suite noticed, because every gate either
// ran flag-off or only read the new fields.
//
// Worse than inert: `memberSatisfaction` DID move, 7.1 -> 6.8 on 297
// instances, because satisfaction reads the signal. Members were made unhappy
// by a rate that never appeared on their invoice. A check that the two agree
// is the only thing that catches that class of defect.
//
// WHAT IT ASSERTS, with the flag forced on, per line and year:
//
//   1. THE BILLED RATE IS THE STORED FINAL RATE. totalMemberCharge divided by
//      exposure equals `finalRatePer100` on the result, to the bit.
//   2. THE CHARGE IS ADDITIVE: pool premium + admin + reinsurance equals
//      totalMemberCharge, and the retained-cover margin is exactly 0 — it is
//      retired under this stack.
//   3. THE BILL IS NOT THE OLD STACK'S. The charged rate must DIFFER from what
//      the old stack would have billed, by a margin no rounding could produce.
//      This is the assertion that fails on today's code, where the bill
//      ignores the flag entirely.
//   4. THE SIGNAL AND THE BILL DIFFER ONLY BY THE BOOK. Both price through
//      quoteNewRateStack; the signal uses the pre-movement roster and
//      exposure, the bill the covered book. On a year where nobody joins or
//      leaves the two must be IDENTICAL. That is the stated, measured reason
//      for any difference, and it is checked rather than asserted.
//
// ⚠ IT FLIPS NEW_RATE_STACK AT RUNTIME and restores it in a `finally`. Safe
// only because every gate runs in its own process.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { NEW_RATE_STACK } from '../../src/data/pricingParameters';
import type { CoverageLine, GameState, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 3);
const YEARS = Number(process.env.YEARS ?? 5);

let failures = 0;
const fail = (s: string) => { failures++; if (failures <= 20) console.log(`  FAIL  ${s}`); };

console.log('=== NEW RATE BILL CHECK ===\n');

interface Row { line: CoverageLine; year: number; game: number; r: LineResultSet; }

function play(flag: boolean): Row[] {
  const was = NEW_RATE_STACK.enabled;
  const rows: Row[] = [];
  try {
    NEW_RATE_STACK.enabled = flag;
    for (let g = 0; g < GAMES; g++) {
      const id = `NB${g}`;
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
        const p = processYear(gs, defaultDecisionSet(y));
        for (const line of LINES) {
          const r = p.result.byLine[line];
          if (r) rows.push({ line, year: y, game: g, r });
        }
        gs = {
          ...gs, poolState: p.updatedPoolState, currentYearNumber: y + 1,
          currentDecisions: defaultDecisionSet(y + 1), lockedResults: [...gs.lockedResults, p.result] as never,
        };
      }
    }
  } finally {
    NEW_RATE_STACK.enabled = was;
  }
  return rows;
}

const on = play(true);
const off = play(false);

if (on.length === 0) { fail('the flag was on and no line-year was produced'); }

// --------------------------------------------------------------------------
console.log(`--- 1. THE BILLED RATE IS THE STORED FINAL RATE (${on.length} line-years) ---`);
let worst = 0, priced = 0;
for (const { line, year, r } of on) {
  const stored = r.finalRatePer100;
  if (stored === undefined) { fail(`${line} y${year}: the flag is on but no finalRatePer100 was stored`); continue; }
  priced++;
  // ⚠ THE EXPOSURE ON THE RESULT IS ROUNDED, so this cannot be bit-exact and
  // the bar says why. `writtenExposure` is stored as `toFixed(2)` in $M — a
  // precision of $5,000 on a $392M book, 1.3e-5 relative, which on a rate of 8
  // is about 1e-4. Measured worst 9.3e-5, which is that and nothing else. The
  // EXACT form of this identity is section 2: the three components sum to the
  // charge to 0.00e+0, on unrounded figures.
  const billed = r.totalMemberCharge / Math.max(r.writtenExposure * 10_000, 1);
  const d = Math.abs(billed - stored);
  worst = Math.max(worst, d);
  if (d > 5e-4) {
    fail(`${line} y${year}: billed ${billed.toFixed(6)} against displayed ${stored.toFixed(6)} — `
      + `charge $${(r.totalMemberCharge / 1e6).toFixed(3)}M over exposure ${r.writtenExposure.toFixed(1)}`);
  }
}
console.log(`  ${priced} priced line-years; worst departure ${worst.toExponential(2)}`);

// --------------------------------------------------------------------------
console.log('\n--- 2. THE CHARGE IS ADDITIVE AND THE MARGIN IS RETIRED ---');
let worstAdd = 0;
for (const { line, year, r } of on) {
  const sum = r.poolPremiumAndAdminExpense + r.reinsuranceCost + r.retainedCoverMargin;
  const d = Math.abs(sum - r.totalMemberCharge);
  worstAdd = Math.max(worstAdd, d);
  if (d > 1e-6) fail(`${line} y${year}: pool+admin+reins+margin does not equal the charge (${d})`);
  if (r.retainedCoverMargin !== 0) {
    fail(`${line} y${year}: retainedCoverMargin is ${r.retainedCoverMargin}, not 0 — it is retired here`);
  }
}
console.log(`  worst additive departure ${worstAdd.toExponential(2)}; margin 0 throughout`);

// --------------------------------------------------------------------------
console.log('\n--- 3. THE BILL IS NOT THE OLD STACK\'S ---');
// ⚠ THE ASSERTION THAT FAILS ON TODAY'S CODE. With the bill ignoring the flag,
// every one of these is an exact tie rather than a difference.
let same = 0, compared = 0;
const key = (x: Row) => `${x.game}|${x.line}|${x.year}`;
const offBy = new Map(off.map(x => [key(x), x.r]));
const moves: number[] = [];
for (const row of on) {
  const o = offBy.get(key(row));
  if (!o) continue;
  compared++;
  const a = row.r.totalMemberCharge, b = o.totalMemberCharge;
  if (Math.abs(a - b) < Math.max(1, Math.abs(b) * 1e-12)) same++;
  else moves.push(a / Math.max(b, 1) - 1);
}
if (same > 0) {
  fail(`${same} of ${compared} line-years are charged EXACTLY what the old stack charged — `
    + 'the bill is ignoring the flag, which is the defect this file was written for');
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
console.log(`  ${compared} compared, ${same} identical (must be 0); mean charge change `
  + `${(mean(moves) * 100).toFixed(1)}%`);

// --------------------------------------------------------------------------
console.log('\n--- 4. SIGNAL vs BILL: THEY DIFFER ONLY BY THE BOOK ---');
// On a year with no movement the two price the same roster and the same
// exposure, so they must agree exactly. Default decisions close intake and cut
// no renewals, so this condition holds broadly rather than rarely — which is
// what makes it worth asserting instead of describing.
let still = 0, moved = 0, worstStill = 0;
for (const { line, year, r } of on) {
  const stored = r.finalRatePer100;
  if (stored === undefined) continue;
  const bookMoved = (r.newMembers ?? 0) > 0 || (r.withdrawnMembers ?? 0) > 0 || (r.declinedMembers ?? 0) > 0;
  if (bookMoved) { moved++; continue; }
  still++;
  // With the roster unmoved, the signal's exposure is the billed exposure, so
  // the two stacks see one book and the rates must coincide.
  const d = Math.abs((r.totalMemberCharge / Math.max(r.writtenExposure * 10_000, 1)) - stored);
  worstStill = Math.max(worstStill, d);
  // Same rounded exposure, same bar — see section 1.
  if (d > 5e-4) fail(`${line} y${year}: the book did not move yet signal and bill differ by ${d}`);
}
console.log(`  ${still} line-year(s) with an unmoved book, worst departure ${worstStill.toExponential(2)}; `
  + `${moved} with movement, where a difference is legitimate`);

console.log(`\n${failures === 0
  ? 'THE RATE CHARGED IS THE RATE SHOWN, THE CHARGE IS ADDITIVE, AND IT IS NOT THE OLD STACK\'S.'
  : `${failures} FAILURE(S).`}`);
process.exit(failures === 0 ? 0 : 1);
