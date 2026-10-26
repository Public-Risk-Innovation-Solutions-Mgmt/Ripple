// THE TWO NEW STORED FIELDS — expectedCededPer100 and netPurePremiumPer100.
//
// Run: npx tsx scripts/diagnostics/net-funding-fields-check.ts
//
// Purely additive commit: these were locals inside processLineYear
// (simulationEngine.ts) that nothing outside the engine could reach, which
// meant poolPremium could not be reproduced from the export by any route and
// the audit page's Funding Rate Build-Up card displayed a gross derivation
// beside a net value (38-73% apart on WC/GL). This asserts the one identity
// that justifies storing them: poolPremium is reconstructable from STORED
// fields alone, to float precision.
//
// ⚠ RESTATED FOR THE SHOCKS LANDING (wip/shocks, 2ae5c1a). Reinsurance is the
// per-occurrence T covers at a fixed price, and on the new engine NOTHING NETS
// off the claims cost (linePricing.expectedCededPer100For returns 0): buying
// cover never lowers the pure premium. Section 3 asserted that Property's
// default placed a layer and so netted on every line-year — the retired design
// (the default is now None, which places nothing). So the games now BUY THE
// WIDEST COVER ('$38M xs $2M') on every line — under None "nothing nets" would
// hold for want of a cover — and 3 asserts expectedCededPer100 is zero on every
// line-year WITH the cover bought. Its CONTROL switches the dormant netting
// path on at runtime (AGGREGATE_STOP with STOP_RECOVERY_OFF_CLAIMS_COST) and
// must see 3 fail. 1 and 2 are unchanged and still hold, on net == gross.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { AGGREGATE_STOP, NEW_RATE_STACK, RISK_CONTROL_INCENTIVE_RANGE, STOP_RECOVERY_OFF_CLAIMS_COST } from '../../src/data/pricingParameters';
import { expenseDivisor } from '../../src/utils/linePricing';
import type { DecisionSet } from '../../src/types/simulation';
import type { CoverageLine, GameState, LineResultSet } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 30);
const YEARS = 8;
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
// The cover every game buys (shocks landing), so that a netting would show.
const COVER = '$38M xs $2M';
const decide = (y: number, option: string): DecisionSet => {
  const d = defaultDecisionSet(y);
  for (const l of LINES) d.byLine[l] = { ...d.byLine[l], reinsuranceOption: option };
  return d;
};
/** Line-years of `games` games x `years` years, all defaults but the cover. */
function playLineYears(games: number, years: number, option: string, visit: (l: CoverageLine, r: LineResultSet) => void) {
  for (let g = 0; g < games; g++) {
    const id = `NFF${g}`;
    const inst = generateGameInstance(id, 4_400_000 + g * 7331);
    const setup = { poolName: 'N', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: decide(1, option), priorHistory,
    };
    for (let y = 1; y <= years; y++) {
      const p = processYear(gs, decide(y, option));
      for (const l of LINES) {
        const r = (p.result as never as { byLine: Record<string, LineResultSet> }).byLine[l];
        if (r) visit(l, r);
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
}

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

console.log('=== NET-FUNDING FIELDS: expectedCededPer100 / netPurePremiumPer100 ===\n');

const worstReconstruct: Record<string, number> = { WC: 0, GL: 0, Property: 0 };
const worstReconstructVsBound: Record<string, number> = { WC: 0, GL: 0, Property: 0 };
const worstIdentity: Record<string, number> = { WC: 0, GL: 0, Property: 0 };
// The control: the same identity with the credit ignored — the rule before ff57131.
const worstIdentityCredited: Record<string, number> = { WC: 0, GL: 0, Property: 0 };
let nettedLineYears = 0, coverCharged = 0;
let floorBound = 0;
let n = 0;
const cededShare: Record<string, number[]> = { WC: [], GL: [], Property: [] };

playLineYears(GAMES, YEARS, COVER, (l, r) => {
      n++;

      // 1. THE IDENTITY THE COMMIT EXISTS FOR: poolPremium from stored fields alone.
      // ⚠ FORKED WHEN THE NEW RATE STACK WENT LIVE. The identity is unchanged
      // in substance — poolPremium is still reconstructable from stored
      // fields and nothing else, which is the whole reason these two fields
      // are stored. What changed is the LOADING FACTOR: the old stack applied
      // a rate level, the new one divides by (1 - risk control - profit and
      // contingency). Left unforked this read exactly 5.00e-2 on all three
      // lines, which is the divisor and not an error in the fields.
      const loadFactor = NEW_RATE_STACK.enabled
        ? 1 / expenseDivisor(RISK_CONTROL_INCENTIVE_RANGE.default, l)
        : r.rateLevel / 100;
      const reconstructed =
        r.activeExposure * r.netPurePremiumPer100 * r.selectedFundingCLF * loadFactor * 10_000;
      const relErr = Math.abs(reconstructed - r.poolPremium) / Math.max(Math.abs(r.poolPremium), 1);
      worstReconstruct[l] = Math.max(worstReconstruct[l], relErr);
      // activeExposure itself is stored rounded to 2dp (pre-existing, not
      // touched by this commit) — that alone bounds the achievable relative
      // error at roughly 0.005 / activeExposure. Track the ratio to the new
      // fields' own error against that bound rather than against float noise.
      const roundingBound = 0.005 / Math.max(r.activeExposure, 1);
      worstReconstructVsBound[l] = Math.max(worstReconstructVsBound[l], relErr / Math.max(roundingBound, 1e-12));

      // 2. netPurePremiumPer100 + expectedCededPer100 == the gross pure
      // premium, purePremiumPer100.
      // ⚠ RESTATED AGAIN: NO INVESTMENT INCOME CREDIT. It was the CREDITED
      // figure, purePremiumPer100 x (1 - investmentIncomeCredit), while the
      // credit came off the pure premium (ff57131); the credit is gone —
      // investment income does not touch the rate — so the identity is the
      // pure premium itself again, and the control is a credit slipped back in.
      // purePremiumPer100 is rounded to 4dp for display; compare at that
      // tolerance, not float tolerance, since that rounding is the one place
      // this identity is expected to be inexact.
      const identityGap = Math.abs((r.netPurePremiumPer100 + r.expectedCededPer100) - r.purePremiumPer100);
      worstIdentity[l] = Math.max(worstIdentity[l], identityGap);
      worstIdentityCredited[l] = Math.max(worstIdentityCredited[l],
        Math.abs((r.netPurePremiumPer100 + r.expectedCededPer100) - r.purePremiumPer100 * (1 - 0.03)));

      if (r.expectedCededPer100 !== 0) nettedLineYears++;
      if (r.reinsuranceCost > 0) coverCharged++;

      const floored = r.netPurePremiumPer100 === 0 && r.expectedCededPer100 > 0;
      if (floored) floorBound++;

      if (r.purePremiumPer100 > 0) cededShare[l].push(r.expectedCededPer100 / r.purePremiumPer100);
});

console.log(`${n} line-years across ${GAMES} games x ${YEARS} years, ${COVER} bought on every line.\n`);

console.log('--- 1. poolPremium RECONSTRUCTED FROM STORED FIELDS ALONE ---');
console.log(NEW_RATE_STACK.enabled
  ? '  activeExposure x netPurePremiumPer100 x selectedFundingCLF / (1 - rc - contingency) x 10_000\n'
    + '  ⚠ The risk control incentive is read from the slider DEFAULT, not the row: this gate plays\n'
    + '  all-defaults by construction, so that is its value throughout, and taking it from the\n'
    + '  parameter keeps the assumption visible.\n'
  : '  activeExposure x netPurePremiumPer100 x selectedFundingCLF x (rateLevel/100) x 10_000\n');
console.log('  ⚠ NOT gated at float precision. activeExposure is already stored rounded to 2dp');
console.log('  (pre-existing, simulationEngine.ts:1333 — untouched by this commit), which alone');
console.log('  bounds the achievable relative error at ~0.005/activeExposure, several orders above');
console.log('  float noise. Gated instead on the residual staying WITHIN that pre-existing bound —');
console.log('  i.e. that netPurePremiumPer100/expectedCededPer100 add NO error of their own.\n');
for (const l of LINES) {
  check(worstReconstruct[l] < 5e-4, `${l}: worst relative error`, worstReconstruct[l].toExponential(2));
  check(worstReconstructVsBound[l] < 1.5,
    `${l}: worst error stays within the activeExposure-rounding bound (ratio to bound)`,
    worstReconstructVsBound[l].toFixed(2));
}

console.log('\n--- 2. netPurePremiumPer100 + expectedCededPer100 == gross pure premium ---');
console.log('  Compared against purePremiumPer100 (rounded to 4dp for display) at 5e-5 tolerance —');
console.log('  that rounding, not float noise, is the only source of gap this identity should show.\n');
for (const l of LINES) {
  check(worstIdentity[l] < 5e-5, `${l}: worst |sum - grossPurePremium|`, worstIdentity[l].toExponential(2));
}
// CONTROL — must FAIL: a 3% investment income credit slipped back in is caught on every line.
for (const l of LINES) {
  check(worstIdentityCredited[l] >= 5e-5, `control: ${l}: a 3% credit slipped back in is caught`,
    `worst |sum - grossPurePremium x 0.97| ${worstIdentityCredited[l].toExponential(2)}`);
}

console.log(`\n--- 3. WHAT NETS: NOTHING — ${COVER} bought on every line (the shocks landing) ---`);
// ⚠ RESTATED: it asserted Property's default layer netted on every line-year.
// Since the shocks landing nothing nets on the new engine — the cover's fixed
// price is the reinsurance, and the T claims it recovers on are out of the
// experience — so with a cover bought, expected ceded is ZERO on every
// line-year. The cover is charged on every one (not vacuous).
const nothingNets = (netted: number, charged: number, of: number) => of > 0 && netted === 0 && charged === of;
check(nothingNets(nettedLineYears, coverCharged, n),
  `with ${COVER} bought, expectedCededPer100 is zero on every line-year: nothing nets off the claims cost`,
  `${nettedLineYears} netted, ${coverCharged} of ${n} charged for the cover`);
// CONTROL — must FAIL: the engine's dormant netting path switched on at
// runtime (the aggregate stop, its expected recovery off the claims cost), on
// a few games; restored after.
{
  const was = [AGGREGATE_STOP.enabled, STOP_RECOVERY_OFF_CLAIMS_COST.enabled];
  let netted = 0, charged = 0, of = 0;
  AGGREGATE_STOP.enabled = true; STOP_RECOVERY_OFF_CLAIMS_COST.enabled = true;
  try {
    playLineYears(3, 4, 'working', (_l, r) => { of++; if (r.expectedCededPer100 !== 0) netted++; if (r.reinsuranceCost > 0) charged++; });
  } finally { [AGGREGATE_STOP.enabled, STOP_RECOVERY_OFF_CLAIMS_COST.enabled] = was; }
  check(!nothingNets(netted, charged, of), 'control: the netting path switched on (the stop, its recovery off the claims cost) is caught by 3',
    `${netted} of ${of} line-years netted`);
}

console.log('\n--- 4. DOES THE max(0, ...) FLOOR EVER BIND? ---');
console.log('  If it never does, netPurePremiumPer100 is a pure subtraction with no information');
console.log('  the floor could hide — reported because it affects whether storing both fields is');
console.log('  redundancy or genuinely necessary precision.\n');
console.log(`  floor bound (net priced at 0 while ceded > 0): ${floorBound} of ${n} line-years`);
for (const l of LINES) {
  const s = cededShare[l];
  if (s.length === 0) continue;
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const max = Math.max(...s);
  console.log(`  ${l.padEnd(10)} expectedCeded / grossPurePremium: mean ${(mean * 100).toFixed(1)}%  max ${(max * 100).toFixed(1)}%`);
}

console.log(failures === 0 ? '\nALL NET-FUNDING FIELD CHECKS PASS.'
  : `\n${RULE}\n${failures} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
if (failures > 0) process.exit(1);
