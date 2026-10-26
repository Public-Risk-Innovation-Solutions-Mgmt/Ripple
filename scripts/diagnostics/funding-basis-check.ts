// NET FUNDING BASIS — this is what guards it.
//
// Run: npx tsx scripts/diagnostics/funding-basis-check.ts
//
// The pool premium now funds NET expected loss: gross pure premium less the
// expected ceded of the layers ACTUALLY PLACED (plus the WC/Property
// aggregate's own expected ceded), before the CLF is applied. All three lines
// net now — Property joined as of its own occurrence layer and aggregate.
//
// THE ASSERTIONS THAT MATTER:
//
//  1. poolPremium / (expectedLoss - expectedCeded) == CLF exactly. Under the old
//     gross basis this ratio was CLF against expectedLoss itself.
//  2. The underwriting identity still holds EXACTLY: at defaults,
//     underwritingIncome == poolPremium - netIncurredLoss - laeIncurred (LAE
//     since it is booked). What changes is not
//     the identity but its expectation.
//  3. E[underwriting income] at CLF 1.000 is now ~ZERO rather than ~E[ceded].
//     This is the whole point: the pool no longer banks the ceded portion.
//  4. Declining layers RAISES the pool premium, because their expected ceded
//     stays in. A layer's net cost to members is its RISK LOAD alone.
//  5. Admin is unchanged and still on the GROSS expected loss.
//
// Reported, plus hard assertions where the quantity is bounded.
//
// ⚠ RESTATED FOR THE SHOCKS LANDING (wip/shocks, 2ae5c1a): THE NET BASIS IS
// RETIRED ON THE NEW ENGINE. Reinsurance is the per-occurrence T covers, at a
// fixed price, on shock T claims only — and the shocks are out of the
// experience the pure premium is struck from — so expected ceded is NOT
// netted off the claims cost (linePricing.expectedCededPer100For returns 0):
// buying cover never lowers the pure premium, and the cover's price is added
// as reinsurance outside the CLF and the divisor. With the default now None,
// "net" and "gross" were the same figure for want of a cover, and 1 and 6
// asserted the retired design. So this gate now plays every game WITH THE
// WIDEST COVER ('$38M xs $2M' on every line), and asserts in place of 1, 4
// and 6:
//
//  1. poolPremium funds the GROSS pure premium at CLF / divisor, a cover bought
//     — nothing nets off — and the covers DO recover in these games.
//  4. E[UW income] is reported against the cover's recorded expected ceded.
//  6. A COVER'S NET COST TO MEMBERS IS ITS FULL PRICE: the same games with
//     None and with the cover charge identical pool premiums and pure premiums,
//     and member charges that differ by exactly the cover's reinsurance cost.
//
// 2 and 3 are unchanged. CONTROLS: a netted premium fed to 1; the dormant
// netting path (AGGREGATE_STOP + STOP_RECOVERY_OFF_CLAIMS_COST) switched on at
// runtime and caught by 1; and to 6 a cover whose expected ceded came off the
// pool premium, and a cover that charged nothing.

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { type TowerLine } from '../../src/data/reinsuranceTower';
import { AGGREGATE_STOP, NEW_RATE_STACK, RISK_CONTROL_INCENTIVE_RANGE, STOP_RECOVERY_OFF_CLAIMS_COST } from '../../src/data/pricingParameters';
import { adminRatePer100For, expenseDivisor } from '../../src/utils/linePricing';
import { occurrenceProgramCost } from '../../src/utils/reinsuranceTower';
import { placementFor } from '../../src/utils/reinsuranceOptions';
import { ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = 60, YEARS = 10;
const M = 1e6;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1));
const ci95 = (xs: number[]) => 1.96 * sd(xs) / Math.sqrt(xs.length);

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

interface Row {
  poolPremium: number; adminExpense: number; expectedLoss: number; reinsuranceCost: number; reinsuranceRecovery: number;
  totalMemberCharge: number; netIncurredLoss: number; laeIncurred: number; underwritingIncome: number; operatingExpense: number;
  activeExposure: number; purePremiumPer100: number; ratePer100: number; clf: number;
  netPurePremiumPer100: number; expectedCededPer100: number; rcIncentive: number; year: number;
}
// THE COVER EVERY GAME BUYS (shocks landing): the widest, on every line, so a
// netting of its expected ceded would show. The default (None) nets nothing
// because it places nothing.
const COVER = '$38M xs $2M';

function play(g: number, years: number, option: string): ResultSet[] {
  const id = `FBC${g}`;
  const inst = generateGameInstance(id, 6_300_000 + g * 4441);
  const setup = { poolName: 'F', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  } as never as GameState;
  for (let y = 1; y <= years; y++) {
    const d = defaultDecisionSet(y);
    for (const l of LINES) d.byLine[l] = { ...d.byLine[l], reinsuranceOption: option };
    const p = processYear(gs, d);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return gs.lockedResults;
}
function rowsOf(results: ResultSet[]): Record<string, Row[]> {
  const out: Record<string, Row[]> = { WC: [], GL: [], Property: [] };
  results.forEach(res => {
    for (const line of LINES) {
      const r = (res as never as { byLine: Record<string, Record<string, number>> }).byLine[line];
      if (!r) continue;
      out[line].push({
        poolPremium: r.poolPremium, adminExpense: r.adminExpense, expectedLoss: r.expectedLoss,
        reinsuranceCost: r.reinsuranceCost, reinsuranceRecovery: r.reinsuranceRecovery, totalMemberCharge: r.totalMemberCharge,
        netIncurredLoss: r.netIncurredLoss, laeIncurred: r.laeIncurred, underwritingIncome: r.underwritingIncome, operatingExpense: r.operatingExpense,
        activeExposure: r.activeExposure, purePremiumPer100: r.purePremiumPer100,
        ratePer100: r.ratePer100, clf: r.selectedFundingCLF,
        netPurePremiumPer100: r.netPurePremiumPer100, expectedCededPer100: r.expectedCededPer100,
        // ⚠ READ FROM THE SLIDER'S DEFAULT, NOT THE RESULT. This gate plays
        // all-defaults by construction (see the header), so the per-line risk
        // control incentive is its default throughout; taking it from the
        // parameter rather than the row keeps that assumption visible.
        rcIncentive: RISK_CONTROL_INCENTIVE_RANGE.default,
        year: res.yearNumber,
      });
    }
  });
  return out;
}

const rows: Record<string, Row[]> = { WC: [], GL: [], Property: [] };
// The cover's expected ceded, for the record (the tower's moments): what a net
// basis WOULD have taken off, reported in 1 and 4 and fed to the controls.
const cededPriced: Record<string, number[]> = { WC: [], GL: [], Property: [] };
for (let g = 0; g < GAMES; g++) {
  const r = rowsOf(play(g, YEARS, COVER));
  for (const l of LINES) {
    rows[l].push(...r[l]);
    for (const x of r[l]) cededPriced[l].push(occurrenceProgramCost(l as TowerLine, placementFor(l, COVER), { exposure: x.activeExposure }, x.year).expectedCeded);
  }
}

// THE PREDICATE FOR 1 (shocks landing): the pool premium is the GROSS pure
// premium x exposure x CLF / divisor (to the 1e-4 the identity carries through
// the stored exposure), the stored net equals the gross — to the half unit in
// the fourth place the gross is stored to (net is stored unrounded) — and no
// expected ceded is on the row.
const grossBasisOf = (rs: Row[], l: CoverageLine) => rs.map(r =>
  (r.poolPremium / Math.max(r.purePremiumPer100 * r.activeExposure * 10_000, 1)) / (r.clf / expenseDivisor(r.rcIncentive, l)));
const grossFunded = (rs: Row[], l: CoverageLine) => rs.length > 0
  && Math.abs(mean(grossBasisOf(rs, l)) - 1) < 1e-4
  && rs.every(r => r.expectedCededPer100 === 0 && Math.abs(r.netPurePremiumPer100 - r.purePremiumPer100) <= 5e-5 + 1e-12);

console.log('=== NET FUNDING BASIS CHECK — 60 games x 10 years, all defaults ===');
console.log(`All-defaults = CLF 1.000 on WC/GL, with ${COVER} bought on every line (the shocks landing's default is None).\n`);

console.log('--- 1. poolPremium FUNDS THE GROSS PURE PREMIUM, A COVER BOUGHT — NOTHING NETS OFF (shocks landing) ---');
for (const l of ['WC', 'GL', 'Property'] as const) {
  const gross = rows[l].map(r => r.poolPremium / Math.max(r.expectedLoss, 1));
  const net = rows[l].map((r, i) => r.poolPremium / Math.max(r.expectedLoss - cededPriced[l][i], 1));
  console.log(`  ${l}: poolPremium/GROSS expected = ${mean(gross).toFixed(4)}  ` +
    `poolPremium/NET expected = ${mean(net).toFixed(6)} (CLF ${mean(rows[l].map(r => r.clf)).toFixed(4)})`);
  // ⚠ FORKED WHEN THE NEW RATE STACK WENT LIVE, AND THE OLD CLAIM IS KEPT IN
  // WORDS BECAUSE IT WAS TRUE. Under the old stack poolPremium funded the
  // net EXPECTED LOSS at the CLF, so this ratio was 1.000 at CLF 1. The new
  // rate is not built from the engine's expected loss at all — it is built
  // from a ground-up EXPERIENCE pure premium, and the gap between the two is
  // the underpricing the whole rebuild exists to remove (the engine's
  // expected figure does not keep pace with trending losses). So the ratio
  // against expected loss is now 1.4 to 2.3 and SHOULD be.
  //
  // The identity that replaces it is just as exact: poolPremium funds the
  // RETAINED pure premium at the CLF, loaded by the expense divisor, because
  // the loading is split across the pure-premium and admin limbs.
  if (NEW_RATE_STACK.enabled) {
    const want = rows[l].map(r =>
      r.poolPremium / Math.max(r.netPurePremiumPer100 * r.activeExposure * 10_000, 1)
      - r.clf / expenseDivisor(r.rcIncentive, l));
    // ⚠ NOT BIT-EXACT, AND THE BOUND IS THE SAME ONE new-rate-bill-check
    // states: activeExposure is stored to 2dp in $M, so a ratio built through
    // it carries about 1e-5. Measured worst 1.13e-6.
    check(Math.abs(mean(want)) < 1e-4,
      `${l}: poolPremium / retained expected == CLF / (1 - rc - contingency)`,
      `departure ${mean(want).toExponential(2)}`);
  } else {
    check(Math.abs(mean(net) - 1) < 2e-3,
      `${l}: poolPremium / (gross - expected ceded) == CLF 1.000`, `${mean(net).toFixed(6)}`);
  }
  // ⚠ FORKED FOR THE SAME REASON, AND THE OLD BAR WAS ONE-SIDED. Under the
  // net-funding basis the pool premium necessarily sat BELOW the engine's
  // gross expected loss, so `< 0.95` said the whole thing. The experience
  // rate clears that gross figure on WC (1.40) and Property (1.03) and stays
  // under it on GL, so a one-sided bar now reads as a defect when nothing is
  // wrong. What survives is exactly the claim the label makes: poolPremium is
  // NOT the gross expected loss, either side of it, by a margin no rounding
  // could produce. WHAT IT IS is pinned exactly by the identity above; this
  // line only rules the gross figure out. Property is the tightest at 3.1%.
  //
  // ⚠ AND UNDER THE NEW STACK IT RULES OUT THE GROSS PURE PREMIUM, NOT THE
  // ENGINE'S GROSS EXPECTED LOSS. Ruling out the expected-loss figure was a
  // statement about levels, and levels coincide: with routine large losses on
  // (Prompt A commit 1) WC's retained-basis premium lands 0.48% from it with
  // nothing wrong. What a regression to gross funding would actually produce is
  // the SAME identity on the gross pure premium — poolPremium / (gross pure
  // premium x exposure) == CLF / divisor — so that ratio must sit away from 1,
  // by the ceded share, which no rounding produces.
  // ⚠ THE BAR IS THE IDENTITY'S OWN PRECISION, NOT 2%, SINCE STABLE-SCENARIOS
  // COMMIT 1. With routine large losses folded below every retention, the
  // ceded share of the pure premium fell to 0.4% on WC and about 2% on GL and
  // Property, so a fixed 2% gap no longer separates net funding from gross.
  // What does: the ratio sits exactly at the retained share (net / gross pure
  // premium), and away from 1 by more than ten times the 1e-4 the identity
  // above carries — which a regression to gross funding (ratio 1) cannot meet.
  //
  // ⚠ AND UNDER THE AGGREGATE STOP IT IS THE GROSS FIGURE, BY DESIGN
  // (STOP_RECOVERY_OFF_CLAIMS_COST off): the claims cost is the experience's
  // alone and nothing nets off it, so the ratio sits exactly at 1 — the
  // retained share — and the cover's full price is charged as reinsurance.
  //
  // ⚠ AND SINCE THE SHOCKS LANDING IT IS THE GROSS FIGURE, BY DESIGN, ON THE
  // NEW ENGINE: nothing nets off the claims cost (expectedCededPer100For
  // returns 0), so with a cover bought the ratio sits exactly at 1 — and the
  // cover's full price is charged as reinsurance. It used to assert "NO LONGER
  // the gross figure", which was the retired net basis. grossFunded is the
  // predicate; its controls follow section 1.
  check(NEW_RATE_STACK.enabled ? grossFunded(rows[l], l) : mean(gross) < 0.95,
    NEW_RATE_STACK.enabled ? `${l}: and it IS the gross figure with ${COVER} bought — nothing nets off the claims cost`
      : `${l}: and it is NO LONGER the gross figure`,
    NEW_RATE_STACK.enabled ? `on the gross pure premium ${mean(grossBasisOf(rows[l], l)).toFixed(6)}, expected ceded per $100 max `
      + `${Math.max(...rows[l].map(r => r.expectedCededPer100))}, recorded ceded $${(mean(cededPriced[l]) / M).toFixed(3)}M/yr, `
      + `${rows[l].filter(r => r.reinsuranceRecovery > 0).length} recovering year(s), cost $${(mean(rows[l].map(r => r.reinsuranceCost)) / M).toFixed(3)}M/yr`
      : `gross ratio ${mean(gross).toFixed(4)}`);
}
// Not vacuous: the cover is charged every year, and recovers somewhere.
check(LINES.every(l => rows[l].every(r => r.reinsuranceCost > 0)) && LINES.some(l => rows[l].some(r => r.reinsuranceRecovery > 0)),
  `1. ${COVER} is charged on every line-year and recovers in some (not vacuous)`,
  LINES.map(l => `${l} ${rows[l].filter(r => r.reinsuranceRecovery > 0).length}`).join(', ') + ' recovering line-years');

// CONTROLS for 1 — each must FAIL.
{
  // (a) the figures a net basis would give: each premium less its cover's
  // recorded expected ceded at the same load.
  const netted = (l: CoverageLine) => rows[l].map((r, i) => ({
    ...r, poolPremium: r.poolPremium * (1 - cededPriced[l][i] / Math.max(r.purePremiumPer100 * r.activeExposure * 10_000, 1)),
  }));
  check(LINES.some(l => !grossFunded(netted(l), l)), 'control: a premium netted of the cover\'s expected ceded is caught by 1');
  // (b) THE DORMANT NETTING PATH, SWITCHED ON AT RUNTIME: the aggregate stop
  // with its expected recovery taken off the claims cost — the engine's own
  // net basis — on a few games; restored after.
  const was = [AGGREGATE_STOP.enabled, STOP_RECOVERY_OFF_CLAIMS_COST.enabled];
  AGGREGATE_STOP.enabled = true; STOP_RECOVERY_OFF_CLAIMS_COST.enabled = true;
  let broken: Record<string, Row[]>;
  try { broken = rowsOf([0, 1, 2].flatMap(g => play(g, 4, 'working'))); }
  finally { [AGGREGATE_STOP.enabled, STOP_RECOVERY_OFF_CLAIMS_COST.enabled] = was; }
  check(LINES.some(l => !grossFunded(broken[l], l)),
    'control: the engine\'s netting path switched on (the stop, its recovery off the claims cost) is caught by 1',
    LINES.map(l => `${l} ${mean(grossBasisOf(broken[l], l)).toFixed(4)}`).join(', '));
}

console.log(`\n--- 2. ADMIN ${NEW_RATE_STACK.enabled
  ? 'IS FIXED-PLUS-PER-EXPOSURE, CARRYING THE DIVISOR' : 'IS STILL ON THE GROSS EXPECTED LOSS'} ---`);
for (const l of LINES) {
  const ratio = rows[l].map(r => r.adminExpense / Math.max(r.expectedLoss, 1));
  console.log(`  ${l}: adminExpense / GROSS expected = ${mean(ratio).toFixed(6)}`);
  if (NEW_RATE_STACK.enabled) {
    // ⚠ FORKED: THE 15% LOAD IS RETIRED UNDER THE FLAG. Admin no longer rides
    // on the expected loss at all — it is a fixed amount per line spread over
    // exposure plus a per-exposure rate, and it carries its share of the
    // expense divisor. The ratio above is reported and no longer asserted,
    // because it is now an output of the book's size rather than a constant.
    // The replacement is stronger than the one it retires: it RECONSTRUCTS
    // the dollars from the parameters, so dropping the divisor off the admin
    // limb — the mistake that is easy to make when the loading is split
    // across limbs — fails here even though the ratio test would not notice.
    const rel = rows[l].map(r => Math.abs(r.adminExpense
      - r.activeExposure * (adminRatePer100For(l, r.activeExposure, r.year) / expenseDivisor(r.rcIncentive, l)) * 10_000)
      / Math.max(r.adminExpense, 1));
    // ⚠ NOT BIT-EXACT, SAME CAUSE AS SECTION 1: activeExposure is stored to
    // 2dp in $M ($5,000 on a $400M book), and the admin rate is a function of
    // that exposure, so reconstructing through the stored figure carries
    // about 1e-5. Measured worst 7.0e-6. The deliberate break — dropping the
    // divisor from the reconstruction — reads 5.00e-2 on all three lines,
    // which is the divisor itself, and is four decades clear of the bar.
    check(Math.max(...rel) < 1e-4,
      `${l}: adminExpense == exposure x admin rate / (1 - rc - contingency)`,
      `max relative diff ${Math.max(...rel).toExponential(2)}`);
  } else {
    check(Math.abs(mean(ratio) - ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM) < 1e-9,
      `${l}: adminExpense / GROSS expectedLoss == ${ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM}`, mean(ratio).toFixed(6));
  }
}

console.log('\n--- 3. THE UNDERWRITING IDENTITY STILL HOLDS EXACTLY ---');
for (const l of LINES) {
  // ⚠ LESS LAE SINCE IT IS BOOKED: the pool premium funds the loss AND its
  // adjustment expense (the pure premium carries both), and both are spent.
  // ⚠ AND LESS THE ADMIN OVERRUN (ADMIN_OVERRUN_RANGE): admin is charged at the
  // admin priced (adminExpense) and booked above it (operatingExpense), so the
  // two no longer cancel — the difference is the overrun. RESTATED: the
  // identity held without it until actual admin was made to run over.
  const diff = rows[l].map(r => Math.abs(r.underwritingIncome
    - (r.poolPremium - r.netIncurredLoss - r.laeIncurred - (r.operatingExpense - r.adminExpense))));
  check(Math.max(...diff) < 1e-6,
    `${l}: underwritingIncome == poolPremium - netIncurredLoss - laeIncurred - the admin overrun (booked - priced)`, `max abs diff $${Math.max(...diff).toExponential(2)}`);
  // CONTROL — must FAIL: the identity without the overrun.
  const without = rows[l].map(r => Math.abs(r.underwritingIncome - (r.poolPremium - r.netIncurredLoss - r.laeIncurred)));
  check(Math.max(...without) > 1, `control: ${l}: the identity without the overrun is caught`, `max abs diff $${Math.max(...without).toExponential(2)}`);
}

console.log('\n--- 4. E[UW INCOME] AT CLF 1.000, BESIDE THE COVER\'S RECORDED E[CEDED] ---');
console.log('  line       E[UW income]$M   95% CI +/-$M   E[ceded]$M (the cover\'s record, not netted)   CLF');
for (const l of LINES) {
  const uw = rows[l].map(r => r.underwritingIncome);
  console.log(`  ${l.padEnd(10)} ${(mean(uw) / M).toFixed(3).padStart(14)} ${(ci95(uw) / M).toFixed(3).padStart(14)} ` +
    `${(mean(cededPriced[l]) / M).toFixed(3).padStart(30)}   ${mean(rows[l].map(r => r.clf)).toFixed(4)}`);
}
console.log('  (heavy-tailed — reported with a CI, and NOT gated on. The gated facts are 1-3 above.)');
console.log('');
console.log('  ⚠ THIS CHECK MEANS SOMETHING DIFFERENT ON PROPERTY, and the difference is not');
console.log('  cosmetic. WC and GL reach CLF 1.000 because fundingAtExpected FORCES it to 1.0');
console.log('  (simulationEngine\'s selectedFundingCLF dispatch) — their own backtested grids');
console.log('  exist to tell the player which PERCENTILE that break-even sits at. Property has');
console.log('  no grid: it reads the generic FUNDING_CLF_TABLE, whose 0.60 entry is the literal');
console.log('  value 1.000, so its CLF is 1.000 by table lookup rather than by construction.');
console.log('');
console.log('  So on Property this tests exactly one thing: that the pricing expectation');
console.log('  (gross expected loss less expected ceded) matches the mean the generator');
console.log('  actually draws. It does NOT validate the 60%-confidence LABEL on that 1.000 —');
console.log('  the multiplier is the identity there, so the table cannot be wrong in VALUE at');
console.log('  the default, only in what percentile it claims 1.000x corresponds to. Sizing');
console.log('  that mislabelling is the CLF basis error, measured separately in');
console.log('  scripts/diagnostics/property-clf-basis-report.ts.');

console.log('\n--- 5. MEMBER CHARGE PER $100 ---');
console.log('  line       pure/100   pool rate/100   admin/100   reins/100   TOTAL/100');
for (const l of LINES) {
  const e = mean(rows[l].map(r => r.activeExposure)) * 1e4;
  console.log(`  ${l.padEnd(10)} ${mean(rows[l].map(r => r.purePremiumPer100)).toFixed(3).padStart(8)} ` +
    `${(mean(rows[l].map(r => r.poolPremium)) / e).toFixed(3).padStart(15)} ` +
    `${(mean(rows[l].map(r => r.adminExpense)) / e).toFixed(3).padStart(11)} ` +
    `${(mean(rows[l].map(r => r.reinsuranceCost)) / e).toFixed(3).padStart(11)} ` +
    `${(mean(rows[l].map(r => r.totalMemberCharge)) / e).toFixed(3).padStart(11)}`);
}

console.log(`\n--- 6. BUYING A COVER: its net cost to members is its FULL PRICE ---`);
// ⚠ RESTATED FOR THE SHOCKS LANDING. This section held that placing a layer
// SAVED its expected ceded from the pool premium, so a layer's net cost was its
// load alone — last as "net cost is exactly expected ceded x REINSURANCE_LOAD".
// True of the net basis, retired with it: the cover's expected ceded no longer
// comes off, so the net cost of a cover is its whole fixed price. Asserted in
// games, the same ones played with None and with the cover, every line-year:
// the pool premium and the pure premium are identical, and the member charge
// differs by exactly the cover's reinsurance cost.
const SAME_GAMES = 20;
type Pair = { none: Row; cover: Row };
const costIsFullPrice = (pairs: Pair[]) => pairs.length > 0 && pairs.every(({ none, cover }) =>
  cover.reinsuranceCost > 0 && none.reinsuranceCost === 0
  && cover.poolPremium === none.poolPremium && cover.purePremiumPer100 === none.purePremiumPer100
  && Math.abs((cover.totalMemberCharge - cover.reinsuranceCost) - none.totalMemberCharge) < 1e-6);
const pairs: Record<string, Pair[]> = { WC: [], GL: [], Property: [] };
for (let g = 0; g < SAME_GAMES; g++) {
  const none = rowsOf(play(g, YEARS, 'none'));
  for (const l of LINES) none[l].forEach((r, i) => pairs[l].push({ none: r, cover: rows[l][g * YEARS + i] }));
}
for (const l of LINES) {
  const ps = pairs[l];
  console.log(`  ${l}: ${COVER} at $${(mean(ps.map(p => p.cover.reinsuranceCost)) / M).toFixed(3)}M/yr, recorded expected ceded `
    + `$${(mean(cededPriced[l].slice(0, SAME_GAMES * YEARS)) / M).toFixed(3)}M/yr — none of it off the pool premium`);
  check(costIsFullPrice(ps), `${l}: same games, None vs ${COVER}: pool and pure premium identical, the charge differs by exactly the cover's cost`,
    `${ps.length} line-years`);
}
// CONTROLS for 6 — each must FAIL.
check(!costIsFullPrice(pairs.GL.map((p, i) => ({ ...p, cover: { ...p.cover,
  poolPremium: p.cover.poolPremium - cededPriced.GL[i], totalMemberCharge: p.cover.totalMemberCharge - cededPriced.GL[i] } }))),
'control: a cover whose expected ceded came off the pool premium is caught by 6');
check(!costIsFullPrice(pairs.WC.map(p => ({ ...p, cover: { ...p.cover, reinsuranceCost: 0, totalMemberCharge: p.none.totalMemberCharge } }))),
  'control: a cover that charged nothing is caught by 6');

console.log(failures === 0 ? '\nALL FUNDING-BASIS CHECKS PASS.'
  : `\n${RULE}\n${failures} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
if (failures > 0) process.exit(1);
