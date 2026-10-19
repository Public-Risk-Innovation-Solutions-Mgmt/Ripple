// ============================================================================
// DERIVE EACH LINE'S EXPECTED ORDINARY LOSS COST — ONCE.
//
//   npx tsx scripts/tools/derive-ordinary-loss-cost.ts
//
// The new loss engine's ordinary losses are aggregate and exposure-based. Each
// line needs one number: the expected ordinary loss per $100 of exposure in
// year 1, which the engine then trends at the line's severity trend by
// accident year. This script is HOW that number was obtained, and it is kept
// in the repository so the derivation can be re-run and checked rather than
// taken on trust. Its output is typed into EXPECTED_ORDINARY_LOSS_COST_PER_100
// in pricingParameters.ts, marked SOURCED, and nothing reads this file at
// runtime.
//
// THE BASIS, as ruled:
//   - TODAY'S DISTRIBUTIONS — the same expectation functions the current
//     engine prices with, so the new engine starts where the old one stands.
//   - LIMITED PER CLAIM at the line's lowest reinsurance attachment: WC and GL
//     at $1M, Property at $5M. Ordinary losses sit below every attachment by
//     definition, which is why they cede nothing; what lies above waits for the
//     shocks in commit 2.
//   - PROPERTY IS THE ATTRITIONAL BAND ONLY. Today's catastrophe band is
//     excluded: the shock catalogue brings catastrophe through Earthquake,
//     Winterstorm and Wildfire, and including it here would count it twice.
//   - THE FULL 200-MEMBER MARKET AT NEUTRAL RISK QUALITY, YEAR 1, k = 1. The
//     same basis the held pure premiums are derived on (see
//     deriveNeutralPurePremiumPer100), so the two are comparable line for line.
//
// It also prints the UNLIMITED figure on the same basis, which is how the
// share of expected loss now waiting for the shocks is measured.
// ============================================================================

import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { expectedWcGrossLossForPricing, NEUTRAL_RQ } from '../../src/utils/wcClaimEngine';
import { expectedGlGrossLossForPricing, HELD_PURE_PREMIUM_YEAR } from '../../src/utils/glClaimEngine';
import { expectedPropertyAttritionalLoss, expectedPropertyGrossLoss } from '../../src/utils/propertyClaimEngine';
import { ORDINARY_LOSS_LIMIT } from '../../src/data/pricingParameters';
import { routineLargeBasis } from '../../src/utils/largeLosses';
import type { CoverageLine } from '../../src/types/simulation';

const roster = getPredefinedMarketMembers();
const units = (line: CoverageLine) => roster.reduce((s, m) => s + (m.exposureByLine[line] ?? 0), 0) * 10_000;

const rows: Array<[CoverageLine, number, number]> = [
  ['WC',
    expectedWcGrossLossForPricing(roster, {
      riskQualityOverride: NEUTRAL_RQ, kLine: 1, yearNumber: 1, severityLimit: ORDINARY_LOSS_LIMIT.WC,
    }),
    expectedWcGrossLossForPricing(roster, { riskQualityOverride: NEUTRAL_RQ, kLine: 1, yearNumber: 1 })],
  ['GL',
    expectedGlGrossLossForPricing(roster, {
      yearNumber: HELD_PURE_PREMIUM_YEAR, riskQualityOverride: NEUTRAL_RQ, kGl: 1,
      severityLimit: ORDINARY_LOSS_LIMIT.GL,
    }),
    expectedGlGrossLossForPricing(roster, { yearNumber: HELD_PURE_PREMIUM_YEAR, riskQualityOverride: NEUTRAL_RQ, kGl: 1 })],
  ['Property',
    expectedPropertyAttritionalLoss(roster, {
      riskQualityOverride: NEUTRAL_RQ, kPr: 1, severityLimit: ORDINARY_LOSS_LIMIT.Property,
    }),
    expectedPropertyGrossLoss(roster, { riskQualityOverride: NEUTRAL_RQ, kPr: 1 })],
];

console.log('EXPECTED ORDINARY LOSS COST — full market, neutral risk quality, year 1, k = 1\n');
console.log('line        limit     ordinary/100    unlimited/100    ordinary share    waits for shocks');
for (const [line, ordinary, unlimited] of rows) {
  const u = units(line);
  console.log(`${line.padEnd(10)} $${(ORDINARY_LOSS_LIMIT[line] / 1e6).toFixed(0)}M`
    + `   ${(ordinary / u).toFixed(6).padStart(12)}    ${(unlimited / u).toFixed(6).padStart(13)}`
    + `    ${(100 * ordinary / unlimited).toFixed(1).padStart(13)}%    ${(100 * (1 - ordinary / unlimited)).toFixed(1).padStart(15)}%`);
}

// ============================================================================
// COMMIT 2 — ROUTINE LARGE LOSSES AND THE REGIONAL SPLIT, ON THE SAME BASIS.
//
// ROUTINE_LARGE_LOSS_FREQUENCY_PER_1M: the expected number of claims ABOVE the
// ordinary limit per $1M of exposure a year — today's mixture's survival at the
// limit, summed over the full market's claim rates. Their sizes are drawn at
// runtime from the same mixture conditioned above the limit (largeLosses.ts),
// so this count times that conditional mean excess IS the "waits for shocks"
// share above, by construction rather than by fit.
//
// REGION_EXPOSURE_SHARE: each line's exposure split across the game's three
// regions on today's roster.
// ============================================================================
console.log('\nROUTINE LARGE LOSSES — claims above the ordinary limit, full market, year 1\n');
for (const line of ['WC', 'GL', 'Property'] as const) {
  const r = routineLargeBasis(line);
  console.log(`${line.padEnd(10)} ${r.frequencyPer1M.toPrecision(10)} per $1M a year`
    + `   mean excess $${(r.meanExcess / 1e6).toFixed(4)}M   excess/100 ${(r.frequencyPer1M * r.meanExcess / 1e4).toFixed(6)}`);
}
console.log('\nREGION EXPOSURE SHARE — full market\n');
for (const line of ['WC', 'GL', 'Property'] as const) {
  const t: Record<string, number> = {};
  let total = 0;
  for (const m of roster) {
    const e = m.exposureByLine[line] ?? 0;
    t[m.region] = (t[m.region] ?? 0) + e;
    total += e;
  }
  console.log(`${line.padEnd(10)} ${Object.entries(t).map(([k, v]) => `${k} ${(v / total).toFixed(6)}`).join('   ')}`);
}
