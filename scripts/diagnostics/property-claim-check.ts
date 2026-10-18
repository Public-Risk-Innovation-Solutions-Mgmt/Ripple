// PROPERTY'S FITTED GENERATOR — the invariants that guard it.
//
// Run: npx tsx scripts/diagnostics/property-claim-check.ts
//
// Replaces the check for the retired attritional/weather/cat design. What
// carries over is the DISCIPLINE, not the assertions: invariant 1 (the draw
// reproduces the analytic expectation) is the same test WC and GL are held to,
// and it is the one that would have caught the defect this rebuild fixed —
// eleven times too many claims at 44% of the size, a product right by accident
// while both factors were wrong.
//
// WHAT IS ASSERTED (hard, fails the run):
//   1. The capped mixture's mean reproduces the vehicles-folded-in fit's
//      $418,289 (was $681,582 buildings-only, $435,254 before any real-data
//      recalibration — see PROPERTY_LOSS_MODEL.severityMixture's own comment).
//   2. Held pure premium = the attritional band (frequency x mean severity,
//      0.2100) PLUS the catastrophe band's derived load (0.0286) = 0.2386,
//      both reconciled from the parameters. The cat band's two market
//      constants — eventsPerYear and regionWeights — are re-derived from the
//      roster and the 12% budget, so a roster change fails here first. The
//      retired 0.0247 asserted load is still summed into nothing.
//   3. The draw reproduces the analytic expectation (invariant 1), BOTH bands.
//   4. Severity never exceeds the cap, and the cap binds rarely.
//   5. ATTRITIONAL expected loss is exactly proportional to TIV — the identity
//      that replaced the retired design's location-count cancellation. The cat
//      band's is not (it runs through primaryAssetShare and region), so the
//      identity is asserted on the band it holds for.
//
// WHAT IS MEASURED AND REPORTED (not gated — heavy-tailed sample means, and
// gating on one is finding 26):
//   claim counts, annual aggregate CV, per-risk breaches, the realised AAL.

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import {
  PROPERTY_CAT_MODEL, PROPERTY_LOSS_MODEL, PROPERTY_HELD_PURE_PREMIUM_PER_100, PROPERTY_PURE_PREMIUM_SPLIT,
} from '../../src/data/defaultAssumptions';
import { PROPERTY_TOWER_TOP, REINSURANCE_TOWER, TOWER_TOP } from '../../src/data/reinsuranceTower';
import {
  computeKPr, deriveNeutralPropertyPurePremiumPer100, deriveNeutralPropertyPurePremiumSplit,
  expectedPropertyAttritionalLoss, expectedPropertyGrossLoss,
  generatePropertyClaims, propertySeverityMoment, propertySeverityCap, PROPERTY_MEAN_SEVERITY,
  PROPERTY_DRAW_SEVERITY_TREND_PER_YEAR, propertyCappedSeverityTrend,
} from '../../src/utils/propertyClaimEngine';
import { CAT_REGIONS, catEventGrossDistribution } from '../../src/utils/propertyCatastrophe';

const M = PROPERTY_LOSS_MODEL;
const YEARS = Number(process.env.YEARS ?? 3000);

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
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

const roster = getPredefinedMarketMembers();
const fullTiv = roster.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);

console.log('=== PROPERTY FITTED GENERATOR ===\n');

console.log('--- 1. THE SEVERITY MIXTURE ---');
check(Math.abs(PROPERTY_MEAN_SEVERITY - 418_289) < 500,
  'capped mixture mean reproduces the vehicles-folded-in fit', `$${PROPERTY_MEAN_SEVERITY.toFixed(0)} vs $418,289`);
{
  const m1 = propertySeverityMoment(1), m2 = propertySeverityMoment(2);
  const cv = Math.sqrt(m2 - m1 * m1) / m1;
  check(Math.abs(cv - 4.810) < 0.02, 'capped severity CV is 4.810', cv.toFixed(3));
  const w = M.severityMixture.reduce((a, c) => a + c.weight, 0);
  check(Math.abs(w - 1) < 1e-9, 'mixture weights sum to 1', w.toFixed(6));
}

// ⚠ PROPERTY'S SEVERITY TRENDS NOW, ITS CEILING DOES NOT, AND THIS ASSERTS
// BOTH HALVES RATHER THAN THE INERTNESS IT USED TO.
//
// What stood here asserted that propertySeverityCap returned the same number in
// every year, because Property's draw-side trend was exactly 0. It was a
// TRIPWIRE, written to fire at whoever switched the trend on and send them to
// propertySeverityCap's header, where three year-blind seams were listed. It
// fired, and what it found is recorded in that header: the DRAW never routed
// through propertySeverityTrend at all, so the constant alone would have
// trended the ceiling and the price while leaving the losses in year-1 dollars.
//
// The arrangement it now guards, which is GL's:
//   - the ceiling is FLAT, a worst case that can be stated in any year
//   - the severity MIXTURE trends, at the draw and in the capped moments alike
//   - so the capped mean is NOT year-invariant, and the price must therefore
//     carry propertyCappedSeverityTrend rather than the raw rate
//   - towerMoments' Property band cache is keyed on the year, not one slot
{
  const caps = [1, 2, 5, 10, 20].map(() => propertySeverityCap());
  const allSame = caps.every(c => c === caps[0]);
  check(allSame && caps[0] === M.severityCap,
    'Property ceiling is FLAT — stated in every year\'s dollars, as GL\'s is',
    `$${(caps[0] / 1e6).toFixed(1)}M`);
  const L = REINSURANCE_TOWER.Property;
  // ⚠ RE-CUT BY LOSS ENGINE COMMIT 4a. Property was ONE layer from the $5M
  // retention to a $1B top; the tower is now cut at the packages' edges —
  // retention to $25M, then $25M xs $25M — and tops out at the highest
  // package edge, $50M. Above it is retained on every package.
  check(L.length === 2 && L[0].attachment === M.perRiskRetention && L[1].attachment === 25e6
      && L[0].attachment + L[0].limit === L[1].attachment && L[1].attachment + L[1].limit === PROPERTY_TOWER_TOP
      && PROPERTY_TOWER_TOP === 50e6,
    'Property is TWO layers, the $5M retention to $25M and $25M xs $25M, to a $50M top',
    L.map(l => `${l.name}`).join(', '));
  check(TOWER_TOP.Property === PROPERTY_TOWER_TOP && PROPERTY_TOWER_TOP !== M.severityCap,
    'TOWER_TOP.Property is the $50M package top, decoupled from severityCap',
    `$${(TOWER_TOP.Property / 1e6).toFixed(0)}M vs cap $${(M.severityCap / 1e6).toFixed(0)}M`);

  // ⚠ THE MOMENT MUST MOVE WITH THE YEAR, and this is the assertion that fails
  // against the old behaviour — it was `momentSame` and it was true.
  const m1 = propertySeverityMoment(1, 1, 1);
  const m10 = propertySeverityMoment(1, 1, 10);
  check(m10 > m1 * 1.3,
    'the capped mixture mean TRENDS with the year (year 10 vs year 1)',
    `$${m1.toFixed(0)} -> $${m10.toFixed(0)}, x${(m10 / m1).toFixed(4)}`);

  // ⚠ THE CAP BITES HARDER EACH YEAR AND THAT IS MEASURED, NOT ASSERTED AWAY.
  // A flat ceiling over a trending distribution is not scale-invariant: the
  // capped mean grows by LESS than the raw trend. The gap is what
  // propertyCappedSeverityTrend carries into the price instead of the raw 5%.
  const raw = Math.pow(1 + PROPERTY_DRAW_SEVERITY_TREND_PER_YEAR, 9);
  const capped = propertyCappedSeverityTrend(10);
  console.log(`    [MEASURED] year-10 severity: raw x${raw.toFixed(4)}, capped x${capped.toFixed(4)} `
    + `— the ceiling absorbs ${((1 - capped / raw) * 100).toFixed(2)}% of the trend by year 10`);
  check(capped <= raw + 1e-12 && capped > 1,
    'and the CAPPED trend is at or below the raw trend, which is what the price uses',
    `${capped.toFixed(6)} <= ${raw.toFixed(6)}`);
}

console.log('\n--- 2. THE HELD PURE PREMIUM RECONCILES FROM ITS PARTS ---');
{
  const split = deriveNeutralPropertyPurePremiumSplit(roster);
  const derived = deriveNeutralPropertyPurePremiumPer100(roster);
  check(Math.abs(split.nonCat - PROPERTY_PURE_PREMIUM_SPLIT.nonCatDerived) < 0.0005,
    'attritional analytic == the derived non-cat figure (0.2100)', split.nonCat.toFixed(4));
  check(Math.abs(split.cat - PROPERTY_PURE_PREMIUM_SPLIT.catDerived) < 0.0005,
    'cat analytic == the derived cat load (0.0286)', split.cat.toFixed(4));
  // THE INVARIANT: price and draw are the same number, both bands, so there is
  // nothing in the premium the generator does not produce and nothing the
  // generator produces that the premium does not carry.
  check(Math.abs(derived - PROPERTY_HELD_PURE_PREMIUM_PER_100) < 0.0005,
    'the HELD constant IS the generator analytic, both bands — no unearned load, no unpriced loss',
    `${PROPERTY_HELD_PURE_PREMIUM_PER_100} vs ${derived.toFixed(4)}`);
  check(Math.abs(split.cat / derived - PROPERTY_CAT_MODEL.budgetShareOfExpectedLoss) < 0.001,
    'the cat band is the 12% budget of the full market\'s expected loss',
    `${(split.cat / derived * 100).toFixed(3)}%`);
  check(Math.abs(PROPERTY_HELD_PURE_PREMIUM_PER_100 - (split.nonCat + PROPERTY_PURE_PREMIUM_SPLIT.catAssertedRetired)) > 0.001,
    'the RETIRED asserted load is NOT what came back',
    `held ${PROPERTY_HELD_PURE_PREMIUM_PER_100}, retired load ${PROPERTY_PURE_PREMIUM_SPLIT.catAssertedRetired}`);

  // THE CAT BAND'S MARKET CONSTANTS, re-derived from the roster they claim to
  // describe. Held at 4 dp / 4 sf, so the tolerances are the rounding.
  const tivOf = (r: string) => roster.filter(m => m.region === r).reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);
  const weightsOk = CAT_REGIONS.every(r => Math.abs(tivOf(r) / fullTiv - PROPERTY_CAT_MODEL.regionWeights[r as keyof typeof PROPERTY_CAT_MODEL.regionWeights]) < 5e-5);
  check(weightsOk, 'regionWeights are the roster\'s TIV shares',
    CAT_REGIONS.map(r => `${r} ${(tivOf(r) / fullTiv).toFixed(5)}`).join(' '));
  const attr = expectedPropertyAttritionalLoss(roster, { riskQualityOverride: 5, kPr: 1 });
  const budget = PROPERTY_CAT_MODEL.budgetShareOfExpectedLoss;
  const solved = (budget / (1 - budget)) * attr / catEventGrossDistribution(roster).expectedGross;
  check(Math.abs(solved / PROPERTY_CAT_MODEL.eventsPerYear - 1) < 1e-4,
    'eventsPerYear re-solves from the 12% budget on the full roster', `${solved.toFixed(6)} vs ${PROPERTY_CAT_MODEL.eventsPerYear}`);
}

console.log('\n--- 3. ATTRITIONAL EXPECTED LOSS IS EXACTLY PROPORTIONAL TO TIV ---');
console.log('  The identity that replaced the retired design\'s location-count cancellation.');
console.log('  The attritional band only: the cat band runs through primaryAssetShare and region.');
{
  const half = roster.slice(0, 100), whole = roster;
  const eHalf = expectedPropertyAttritionalLoss(half, { riskQualityOverride: 5, kPr: 1 });
  const tHalf = half.reduce((s, m) => s + (m.exposureByLine.Property ?? 0), 0);
  const eWhole = expectedPropertyAttritionalLoss(whole, { riskQualityOverride: 5, kPr: 1 });
  const perTivHalf = eHalf / tHalf, perTivWhole = eWhole / fullTiv;
  check(Math.abs(perTivHalf / perTivWhole - 1) < 1e-12,
    'loss per $1M TIV is identical on any subset at neutral RQ',
    `${perTivHalf.toFixed(4)} vs ${perTivWhole.toFixed(4)}`);
}

console.log('\n--- 4. INVARIANT 1: THE DRAW REPRODUCES THE ANALYTIC EXPECTATION ---');
console.log(`  ${YEARS.toLocaleString()} independent full-roster REPLICATES, all at YEAR 1, at neutral kPr and no risk control.\n`);
// ⚠ THE REPLICATE INDEX IS NO LONGER THE ACCIDENT YEAR, AND THAT DISTINCTION
// ONLY STARTED MATTERING WHEN PROPERTY GOT A SEVERITY TREND.
//
// This loop read `yearNumber: y` while y ran to 3,000, using the year as a
// replicate counter. That was exact while propertySeverityTrend was identically
// 1 and cost nothing. At 5%/yr it asks the generator for accident year 3,000,
// where severity is 1.05^2999 of year 1 and every claim pins at the $75M cap:
// measured, drawn/analytic read 149.35 and 95% of claims bound the cap. Neither
// was an engine defect — the harness was requesting a year three millennia out.
//
// The analytic it is compared against is expectedPropertyGrossLoss, which is
// deliberately YEAR-BLIND (it is the year-1 basis the held pure premium is
// derived at — see propertyCappedSeverityTrend), so the draw must be at year 1
// for the two to be the same quantity. Independence now comes from the SEED
// alone, which is where it always actually came from.
{
  const analytic = expectedPropertyGrossLoss(roster, { kPr: computeKPr(roster) });
  const totals: number[] = [];
  let counts = 0, maxClaim = 0, breaches = 0, capBinds = 0;
  for (let rep = 1; rep <= YEARS; rep++) {
    const r = generatePropertyClaims({
      members: roster, yearNumber: 1, calendarYear: 2026,
      instanceSeed: 990_000 + rep * 7919, kPr: computeKPr(roster), riskControlEffectiveness: 0,
    });
    totals.push(r.grossUltimateLoss);
    counts += r.claimCount; breaches += r.perRiskBreaches; capBinds += r.capBindings;
    if (r.maxClaimGross > maxClaim) maxClaim = r.maxClaimGross;
  }
  const drawn = mean(totals);
  const ratio = drawn / analytic;
  // A heavy tail needs a wide band on a sample mean — this is a convergence
  // test, not a calibration gate. Finding 26.
  check(Math.abs(ratio - 1) < 0.06, 'drawn / analytic within 6%, both bands', ratio.toFixed(4));
  console.log(`\n  analytic $${(analytic / 1e6).toFixed(2)}M   drawn $${(drawn / 1e6).toFixed(2)}M   over ${YEARS.toLocaleString()} replicates`);
  console.log(`  claims/yr ${(counts / YEARS).toFixed(1)} (full market, ${fullTiv.toFixed(0)}M TIV)`);
  console.log(`  annual aggregate CV ${(Math.sqrt(mean(totals.map(t => (t - drawn) ** 2))) / drawn).toFixed(3)}`);
  console.log(`  p50 $${(q(totals, 0.5) / 1e6).toFixed(2)}M   p90 $${(q(totals, 0.9) / 1e6).toFixed(2)}M   p99 $${(q(totals, 0.99) / 1e6).toFixed(2)}M   worst $${(Math.max(...totals) / 1e6).toFixed(1)}M`);
  console.log(`  per-risk breaches/yr (>$${(M.perRiskRetention / 1e6).toFixed(0)}M) ${(breaches / YEARS).toFixed(2)}`);

  console.log('');
  // A HARD bound, not a trended one: Property books settlement dollars
  // directly, so the cap is the cap. See PAYOUT_TREND_FACTOR in the generator.
  // ATTRITIONAL claims only: maxClaimGross excludes the cat band, whose claims
  // are bounded by the member's TIV and not by this cap (PROPERTY_CAT_MODEL).
  check(maxClaim <= M.severityCap,
    'no attritional claim exceeds the cap — Property books settlement dollars, so the bound is exact',
    `max $${(maxClaim / 1e6).toFixed(1)}M vs cap $${(M.severityCap / 1e6).toFixed(1)}M`);
  const bindRate = capBinds / Math.max(counts, 1);
  check(bindRate < 0.001, 'the cap binds rarely — it disciplines the 2nd moment, it is not a loss limit',
    `${capBinds} of ${counts} claims (1 in ${capBinds ? Math.round(counts / capBinds) : counts})`);
}

console.log(failures === 0 ? '\nALL PROPERTY GENERATOR CHECKS PASS.'
  : `\n${RULE}\n${failures} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
if (failures > 0) process.exit(1);
