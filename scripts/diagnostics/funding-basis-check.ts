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

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { REINSURANCE_TOWER, RISK_LOAD_LAMBDA } from '../../src/data/reinsuranceTower';
import { AGGREGATE_STOP, NEW_RATE_STACK, RISK_CONTROL_INCENTIVE_RANGE, STOP_RECOVERY_OFF_CLAIMS_COST } from '../../src/data/pricingParameters';
import { adminRatePer100For, expenseDivisor } from '../../src/utils/linePricing';
import { occurrenceProgramCost } from '../../src/utils/reinsuranceTower';
import { REINSURANCE_LOAD } from '../../src/data/pricingParameters';
import { ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState, Member } from '../../src/types/simulation';

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
  poolPremium: number; adminExpense: number; expectedLoss: number; reinsuranceCost: number;
  totalMemberCharge: number; netIncurredLoss: number; laeIncurred: number; underwritingIncome: number; operatingExpense: number;
  activeExposure: number; purePremiumPer100: number; ratePer100: number; clf: number;
  netPurePremiumPer100: number; rcIncentive: number; year: number;
}
const rows: Record<string, Row[]> = { WC: [], GL: [], Property: [] };
const cededPriced: Record<string, number[]> = { WC: [], GL: [], Property: [] };

for (let g = 0; g < GAMES; g++) {
  const id = `FBC${g}`;
  const inst = generateGameInstance(id, 6_300_000 + g * 4441);
  const setup = { poolName: 'F', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  } as never as GameState;

  for (let y = 1; y <= YEARS; y++) {
    const d = defaultDecisionSet(y);
    // The expected ceded the engine itself priced on: same pre-movement book,
    // same placement, same function.
    for (const l of ['WC', 'GL', 'Property'] as const) {
      const book = (gs.poolState as never as {
        lines: Record<string, { members: Member[] }>
      }).lines[l].members.filter(m => m.status === 'active');
      const placed = REINSURANCE_TOWER[l].map(x => x.purchasable);
      cededPriced[l].push(occurrenceProgramCost(l, placed, book, y).expectedCeded);
    }

    const p = processYear(gs, d);
    for (const line of LINES) {
      const r = (p.result as never as { byLine: Record<string, Record<string, number>> }).byLine[line];
      if (!r) continue;
      rows[line].push({
        poolPremium: r.poolPremium, adminExpense: r.adminExpense, expectedLoss: r.expectedLoss,
        reinsuranceCost: r.reinsuranceCost, totalMemberCharge: r.totalMemberCharge,
        netIncurredLoss: r.netIncurredLoss, laeIncurred: r.laeIncurred, underwritingIncome: r.underwritingIncome, operatingExpense: r.operatingExpense,
        activeExposure: r.activeExposure, purePremiumPer100: r.purePremiumPer100,
        ratePer100: r.ratePer100, clf: r.selectedFundingCLF,
        netPurePremiumPer100: r.netPurePremiumPer100,
        // ⚠ READ FROM THE SLIDER'S DEFAULT, NOT THE RESULT. This gate plays
        // all-defaults by construction (see the header), so the per-line risk
        // control incentive is its default throughout; taking it from the
        // parameter rather than the row keeps that assumption visible.
        rcIncentive: RISK_CONTROL_INCENTIVE_RANGE.default,
        year: y,
      });
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
}

console.log('=== NET FUNDING BASIS CHECK — 60 games x 10 years, all defaults ===');
console.log('All-defaults = CLF 1.000 on WC/GL and the FULL occurrence tower placed.\n');

console.log('--- 1. poolPremium FUNDS NET, NOT GROSS ---');
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
      - r.clf / expenseDivisor(r.rcIncentive));
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
  const grossBasis = rows[l].map(r =>
    (r.poolPremium / Math.max(r.purePremiumPer100 * r.activeExposure * 10_000, 1))
    / (r.clf / expenseDivisor(r.rcIncentive)));
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
  const retainedShare = rows[l].map(r => r.netPurePremiumPer100 / Math.max(r.purePremiumPer100, 1e-12));
  const unnetted = AGGREGATE_STOP.enabled && !STOP_RECOVERY_OFF_CLAIMS_COST.enabled;
  check(NEW_RATE_STACK.enabled
    ? Math.abs(mean(grossBasis) - mean(retainedShare)) < 1e-4
      // Under the stop the claims basis IS the gross figure (it was the gross
      // less the investment income credit while there was one; investment
      // income no longer touches the rate). On the means, as before: the row's
      // pure premium is stored to four places, which is 2e-4 of Property's on
      // a single row.
      && (unnetted ? Math.abs(mean(grossBasis) - 1) < 1e-4
        : Math.abs(mean(grossBasis) - 1) > 1e-3)
    : mean(gross) < 0.95,
    unnetted ? `${l}: and under the stop it IS the gross figure — nothing nets off the claims cost`
      : `${l}: and it is NO LONGER the gross figure`,
    NEW_RATE_STACK.enabled ? `on the gross pure premium ${mean(grossBasis).toFixed(4)}, the retained share ${mean(retainedShare).toFixed(4)} (gross expected loss ${mean(gross).toFixed(4)})`
      : `gross ratio ${mean(gross).toFixed(4)}`);
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
      - r.activeExposure * (adminRatePer100For(l, r.activeExposure, r.year) / expenseDivisor(r.rcIncentive)) * 10_000)
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

console.log('\n--- 4. E[UW INCOME] AT CLF 1.000 IS NOW ~ZERO, NOT E[CEDED] ---');
console.log('  line       E[UW income]$M   95% CI +/-$M   E[ceded]$M (what it USED to be)   CLF');
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

console.log('\n--- 6. DECLINING A LAYER: the net cost is the RISK LOAD alone ---');
console.log('  Placing a layer costs its premium but SAVES its expected ceded from the pool');
console.log('  premium, so the net member cost of any layer is lambda x SD[ceded].');
console.log(`  Checked analytically on the full canonical roster at lambda ${RISK_LOAD_LAMBDA}.\n`);
{
  const { getPredefinedMarketMembers } = await import('../../src/data/memberCatalog');
  const book = getPredefinedMarketMembers();
  for (const l of ['WC', 'GL'] as const) {
    const none = REINSURANCE_TOWER[l].map(() => false);
    const all = REINSURANCE_TOWER[l].map(x => x.purchasable);
    const qAll = occurrenceProgramCost(l, all, book, 1);
    const qNone = occurrenceProgramCost(l, none, book, 1);
    const netCost = (qAll.premium - qAll.expectedCeded) - (qNone.premium - qNone.expectedCeded);
    console.log(`  ${l}: full tower premium $${(qAll.premium / M).toFixed(3)}M, expected ceded ` +
      `$${(qAll.expectedCeded / M).toFixed(3)}M, NET cost to members $${(netCost / M).toFixed(3)}M/yr`);
    // ⚠ REWRITTEN AT COMMIT 4, AND THE OLD ASSERTION IS RECORDED BECAUSE IT WAS
    // TRUE AND IS NOW FALSE BY DESIGN. The price was E[ceded] + lambda x SD and
    // REINSURANCE_RISK_LOAD_LAMBDA is 0, so the tower was actuarially FREE:
    // placing a layer cost its premium and saved exactly its expected ceded,
    // and this asserted the net cost was zero to within $1. It held.
    //
    // The price is now expected layer loss x the line's CLF multiplier at 70%,
    // so the net cost is expected x (CLF - 1) — a real, intended margin. The
    // old assertion would report the new price working as a defect, which is
    // the stale-assertion trap this project keeps meeting. It is FORKED rather
    // than loosened: the claim is still an exact identity, just a different
    // one, and a `netCost > 0` would have waved through any load at all.
    const impliedLoad = qAll.expectedCeded * REINSURANCE_LOAD;
    check(Math.abs(netCost - impliedLoad) < Math.max(1, qAll.expectedCeded * 1e-9),
      `${l}: net cost is exactly expected ceded x REINSURANCE_LOAD`,
      `$${(netCost / M).toFixed(3)}M against $${(impliedLoad / M).toFixed(3)}M at load ${REINSURANCE_LOAD}`);
    if (RISK_LOAD_LAMBDA > 0) {
      check(netCost > 0 && netCost < qAll.premium,
        `${l}: net cost is positive but below the gross premium`,
        `${((netCost / qAll.premium) * 100).toFixed(1)}% of premium`);
    } else {
      check(netCost > 0,
        `${l}: the tower is no longer actuarially free — the CLF load is real`,
        `$${netCost.toFixed(2)} against a $1 tolerance`);
    }
  }
}

console.log(failures === 0 ? '\nALL FUNDING-BASIS CHECKS PASS.'
  : `\n${RULE}\n${failures} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
if (failures > 0) process.exit(1);
