// POOL-SCOPE AGGREGATION CHECK — is every pooled field still the thing its name says?
// ON THE NEW ENGINE (book mode, MEMBER_LEVEL off), as the game runs.
//
//   npx tsx scripts/diagnostics/pool-aggregation-check.ts
//
// ============================================================================
// FORKED FROM pool-aggregation-member-check, which is dormant with the old
// member engine. The classification below is copied from it and is now the one
// that is maintained: a field added to ResultSet is classified HERE.
//
// Why this exists (the member gate's header has the history): seven pool-scope
// aggregation defects reached players, three of them added directly underneath
// a comment warning about exactly that class. So aggregateLineResults has no
// generic `sum` — every call names its class — and this gate asserts that every
// numeric field on the pooled row is covered by one of the classes below.
//
// WHAT THE NEW ENGINE CHANGES. The member gate's sections 2 and 3 counted
// distinct members, and a book has none. In their place:
//
//   1. EVERY NUMERIC POOLED FIELD IS CLASSIFIED, in exactly one class.
//   2. THE ADDITIVE CLASSES ACTUALLY ADD: every DOLLARS, exposure, claim-count
//      and enrolment field on the pooled row is the sum of its lines. The member
//      gate could only check that a choice was written down; on a book this
//      checks the choice itself.
//   3. NO MEMBERS ARE FABRICATED: the member counts are zero at every scope.
//   4. cededByLayer CELLS LINE UP: the pooled cells are WC + GL elementwise,
//      with Property (whose layers do not share their attachments) left out.
//   5. A SOLO POOL IS ITS ONE LINE, EXACTLY.
//
// ⚠ AND EACH FAILS WHEN BROKEN — every check is a function over pooled rows,
// and THE CONTROLS feed each one rows broken the way it guards against.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { MEMBER_LEVEL } from '../../src/data/pricingParameters';
import { fullTowerOption } from '../../src/utils/reinsuranceOptions';
import type { CoverageLine, DecisionSet, GameState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const failed: string[] = [];
const RULE = '='.repeat(72);
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failed.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

// --- THE CLASSIFICATION -----------------------------------------------------
// Every numeric field on the pooled row must appear in exactly one of these.
// Copied from pool-aggregation-member-check, where each entry's reasoning is
// written beside it; read it there before moving a field between classes.

// Extensive money and other genuinely additive quantities.
const DOLLARS = new Set([
  'poolPremium', 'adminExpense', 'poolPremiumAndAdminExpense', 'totalMemberCharge',
  'grossPremium', 'assessments', 'dividends', 'aggregateMemberLoss',
  'grossUltimateLoss', 'reinsuranceCost', 'retainedAboveTower', 'aggregateRecovery',
  'memberShareAboveLimit', 'developmentAbovePoolLimit',
  'bookedGrossUltimate', 'bookedNetUltimate',
  'retainedCoverMargin',
  'poolLayerLoss',
  'aggregatePremium', 'reinsuranceRecovery', 'netUltimateLoss', 'netIncurredLoss',
  'operatingExpense', 'riskControlInvestment', 'priorYearDevelopment',
  'beginningNetReserve', 'currentYearNetReserve', 'netPaidLosses', 'endingNetReserve',
  'alaeIncurred', 'ulaeIncurred', 'laeIncurred', 'laePaid', 'beginningLaeReserve', 'endingLaeReserve',
  'caseReservesNet', 'ibnrNet', 'caseReservesGross', 'ibnrGross',
  'caseReservesCeded', 'ibnrCeded',
  'investedAssets', 'investmentIncome', 'outstandingLoanBalance', 'loanRepaymentApplied',
  'loanInterestAccrued', 'loanOriginatedThisYear',
  'interLineTransfer', 'interLineCashTransfer',
  'expectedLoss', 'clfAdjustedExpectedLoss',
  'expectedNetUnpaidLoss', 'priorYearDevelopmentCeded', 'bookingGiveBack',
  'netFundingTarget', 'indicatedNetReserveAtConfidenceLevel', 'reserveRiskMarginNeeded',
  'catCapitalNeeded',
  'fundingMarginNeeded', 'availableFunding', 'availableSurplus', 'fundingGap',
  'capitalFundingGap', 'excessAvailableSurplus', 'underwritingIncome', 'netIncome',
  'beginningCash', 'endingCash', 'beginningInvestments', 'endingInvestments',
  'totalAssets', 'unearnedPremium', 'totalLiabilities', 'beginingSurplus', 'endingSurplus',
  'surplusFromIncome', 'surplusTieOutDifference',
]);
// A count of claims, not of members — two lines' pierced claims simply add.
const CLAIM_COUNTS = new Set(['claimsAboveLimit']);
// Distinct member counts. Zero on a book (check 3); kept classified so the
// member path's fields stay accounted for.
const DISTINCT_MEMBERS = new Set(['activeMembers', 'newMembers', 'withdrawnMembers']);
// Per-line enrolment counts. A weight, never a headcount.
const ENROLMENTS = new Set(['enrolmentCount']);
// WC/GL payroll added to Property TIV. Retained for display; never unit-labelled.
const MIXED_UNIT_EXPOSURE = new Set(['activeExposure', 'totalMarketExposure', 'writtenExposure', 'renewalExposure', 'newBusinessExposure']);
// Recomputed from summed components — never summed directly.
const RECOMPUTED_RATIOS = new Set([
  'poolLayerLossRatio', 'totalLossRatioGross',
  'nextYearPaydownRate',
  'marketShare', 'memberRetentionRate', 'memberSatisfaction', 'averageRiskQuality',
  'investmentReturnRate', 'expectedLossRatio', 'expectedLossRatioMemberBasis',
  'expectedExpenseRatio', 'expectedCombinedRatio', 'actualLossRatio', 'actualExpenseRatio', 'actualLaeRatio',
  'actualLossRatioPricingBasis', 'actualLossRatioRetainedPremium',
  'actualCombinedRatio', 'combinedRatio', 'lossRatio', 'expenseRatio',
  'excessCapitalRatio', 'capitalAdequacyRatio',
]);
// No pool-level referent. Carried as a placeholder; read byLine instead.
const NO_POOL_MEANING = new Set(['aggregateAttachment', 'commonLossFactor']);
// Line-ambiguous descriptive/rate fields showing the first active line's value.
const FIRST_LINE_PLACEHOLDER = new Set([
  'yearNumber', 'calendarYear', 'rateLevel', 'ratePer100', 'purePremiumPer100', 'purePremium',
  'expectedCededPer100', 'netPurePremiumPer100', 'selectedFundingConfidenceLevel',
  'selectedFundingCLF', 'fundingCLF',
  'historyAttempt',
]);
const CLASSES = [DOLLARS, CLAIM_COUNTS, DISTINCT_MEMBERS, ENROLMENTS, MIXED_UNIT_EXPOSURE, RECOMPUTED_RATIOS,
  NO_POOL_MEANING, FIRST_LINE_PLACEHOLDER];
// The classes whose pooled value is the sum of the lines'.
const ADDITIVE = [DOLLARS, CLAIM_COUNTS, ENROLMENTS, MIXED_UNIT_EXPOSURE];

type Row = Record<string, unknown> & { byLine: Record<CoverageLine, Record<string, unknown>> };
const numericFields = (r: Row) => Object.entries(r)
  .filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).map(([k]) => k);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));

// ---------------------------------------------------------------- the checks
function classification(rows: Row[], classes: Set<string>[]) {
  const seen = new Set<string>();
  for (const r of rows) for (const k of numericFields(r)) seen.add(k);
  return {
    seen: seen.size,
    unclassified: [...seen].filter(k => !classes.some(s => s.has(k))).sort(),
    duplicated: [...seen].filter(k => classes.filter(s => s.has(k)).length > 1).sort(),
  };
}
/** Additive fields whose pooled value is not the sum of the lines', with the worst gap. */
function additiveMisses(rows: Row[], lines: CoverageLine[]): string[] {
  const out = new Set<string>();
  for (const r of rows) for (const k of numericFields(r)) {
    if (!ADDITIVE.some(s => s.has(k))) continue;
    const parts = lines.map(l => r.byLine[l][k]);
    if (!parts.every(v => typeof v === 'number')) continue;
    const sum = (parts as number[]).reduce((a, b) => a + b, 0);
    if (rel(r[k] as number, sum) > 1e-9) out.add(k);
  }
  return [...out].sort();
}
/** Member counts that are not zero, at pool or line scope. */
function fabricatedMembers(rows: Row[], lines: CoverageLine[]): string[] {
  const out = new Set<string>();
  for (const r of rows) for (const k of [...DISTINCT_MEMBERS, ...ENROLMENTS]) {
    if ((r[k] ?? 0) !== 0) out.add(`pool ${k}`);
    for (const l of lines) if ((r.byLine[l][k] ?? 0) !== 0) out.add(`${l} ${k}`);
  }
  return [...out].sort();
}
/** Worst gap between the pooled cededByLayer and WC + GL elementwise. */
function layerCellGap(rows: Row[]): number {
  let worst = 0;
  for (const r of rows) {
    const pooled = r.cededByLayer as number[];
    const wcGl: number[] = [];
    for (const l of ['WC', 'GL'] as CoverageLine[]) {
      (r.byLine[l].cededByLayer as number[]).forEach((v, i) => { wcGl[i] = (wcGl[i] ?? 0) + v; });
    }
    if (pooled.length !== wcGl.length) return Infinity;
    pooled.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - wcGl[i])); });
  }
  return worst;
}
/** Worst relative gap between a solo pool's pooled row and its one line, and where. */
function soloGap(rows: Row[], line: CoverageLine): { gap: number; at: string } {
  let gap = 0, at = '';
  for (const r of rows) for (const k of numericFields(r)) {
    if (FIRST_LINE_PLACEHOLDER.has(k) || NO_POOL_MEANING.has(k)) continue;
    const lv = r.byLine[line][k];
    if (typeof lv !== 'number' || !Number.isFinite(lv)) continue;
    const g = rel(r[k] as number, lv);
    if (g > gap) { gap = g; at = k; }
  }
  return { gap, at };
}

// ---------------------------------------------------------------- the games
// The full tower on every line: large losses then cede on WC and GL too, which
// the default package's five years rarely show.
const fullTower = (d: DecisionSet): DecisionSet => ({
  ...d, byLine: Object.fromEntries(LINES.map(l => [l, { ...d.byLine[l], reinsuranceOption: fullTowerOption(l) }])) as DecisionSet['byLine'],
});
function play(id: string, seed: number, lines: CoverageLine[], years = 5, decide = (d: DecisionSet) => d): Row[] {
  const inst = generateGameInstance(id, seed);
  const setup = { poolName: 'P', gameLength: years, startingYear: 2026, instanceId: id, activeLines: lines };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out: ResultSet[] = [];
  for (let y = 1; y <= years; y++) {
    const p = processYear(gs, decide(defaultDecisionSet(y)));
    out.push(p.result);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return out as unknown as Row[];
}

check(!MEMBER_LEVEL.enabled, 'running on the new engine (MEMBER_LEVEL off)');
const tri = [
  ...play('POOLAGG', 5_150_000, LINES),
  ...[0, 1, 2, 3].flatMap(g => play(`POOLAGG-TOWER${g}`, 5_150_100 + g, LINES, 10, fullTower)),
];
const solos = LINES.map(line => ({ line, rows: play(`SOLO${line}`, 6_200_000, [line]) }));

console.log('\n=== 1. EVERY NUMERIC POOLED FIELD IS CLASSIFIED ===');
{
  const c = classification(tri, CLASSES);
  console.log(`  ${c.seen} numeric fields on the pooled row`);
  check(c.unclassified.length === 0, '1. no unclassified pooled field', c.unclassified.join(', ') || 'none');
  check(c.duplicated.length === 0, '1. no field in two classes', c.duplicated.join(', ') || 'none');
}

console.log('\n=== 2. THE ADDITIVE CLASSES ACTUALLY ADD ===');
{
  const m = additiveMisses(tri, LINES);
  check(m.length === 0, '2. every additive pooled field is the sum of its lines', m.join(', ') || `${tri.length} line-years, 3 lines`);
}

console.log('\n=== 3. NO MEMBERS ARE FABRICATED ON A BOOK ===');
{
  const m = fabricatedMembers(tri, LINES);
  check(m.length === 0, '3. member counts are zero at pool and line scope', m.join(', ') || 'all zero');
}

console.log('\n=== 4. cededByLayer CELLS LINE UP ===');
{
  const total = (k: (r: Row) => number[]) => tri.reduce((acc, r) => { k(r).forEach((v, i) => { acc[i] = (acc[i] ?? 0) + v; }); return acc; }, [] as number[]);
  const pooled = total(r => r.cededByLayer as number[]), prop = total(r => r.byLine.Property.cededByLayer as number[]);
  console.log(`  pooled, all years  [${pooled.map(v => (v / 1e6).toFixed(2)).join(', ')}]  $M`);
  console.log(`  Property (excluded) [${prop.map(v => (v / 1e6).toFixed(2)).join(', ')}]  $M`);
  // Not vacuous: both sides of the fold must have ceded something.
  check(pooled.some(v => v > 0) && prop.some(v => v > 0), '4. WC/GL and Property both ceded in these games');
  const g = layerCellGap(tri);
  check(g < 1e-6, '4. pooled cededByLayer is WC + GL elementwise, Property left out', `worst $${g.toExponential(2)}`);
}

console.log('\n=== 5. A SOLO POOL IS ITS ONE LINE, EXACTLY ===');
for (const { line, rows } of solos) {
  const s = soloGap(rows, line);
  check(s.gap < 1e-12, `5. ${line}-solo pooled row is its only line`, `worst ${s.gap.toExponential(2)}${s.at ? ` (${s.at})` : ''}`);
}

// ---------------------------------------------------------------- controls
console.log('\nCONTROLS — each must be caught');
{
  const withField = tri.map(r => ({ ...r, newlyAddedDollars: 1 }));
  check(classification(withField, CLASSES).unclassified.includes('newlyAddedDollars'),
    'control: a pooled field added without a class is caught by 1');
  const twice = [...CLASSES, new Set(['poolPremium'])];
  check(classification(tri, twice).duplicated.includes('poolPremium'), 'control: a field in two classes is caught by 1');
  const offSum = tri.map((r, i) => (i === 2 ? { ...r, poolPremium: (r.poolPremium as number) + 1000 } : r));
  check(additiveMisses(offSum, LINES).includes('poolPremium'), 'control: a pooled premium $1,000 off its lines is caught by 2');
  const mean = tri.map(r => ({ ...r, writtenExposure: (r.writtenExposure as number) / LINES.length }));
  check(additiveMisses(mean, LINES).includes('writtenExposure'), 'control: an exposure averaged rather than summed is caught by 2');
  const roster = tri.map(r => ({ ...r, byLine: { ...r.byLine, GL: { ...r.byLine.GL, activeMembers: 12 } } }));
  check(fabricatedMembers(roster, LINES).includes('GL activeMembers'), 'control: a member count on a book is caught by 3');
  const folded = tri.map(r => ({
    ...r, cededByLayer: (r.cededByLayer as number[]).map((v, i) => v + ((r.byLine.Property.cededByLayer as number[])[i] ?? 0)),
  }));
  check(layerCellGap(folded) >= 1, 'control: Property folded into the pooled cells is caught by 4');
  const { line, rows } = solos[1];
  const drift = rows.map((r, i) => (i === 3 ? { ...r, endingSurplus: (r.endingSurplus as number) * (1 + 1e-9) } : r));
  check(soloGap(drift, line).at === 'endingSurplus', `control: a ${line}-solo pooled surplus off its line by 1e-9 is caught by 5`);
}

console.log(failed.length === 0 ? '\nALL POOL AGGREGATION CHECKS PASS, AND EVERY CONTROL IS CAUGHT.'
  : `\n${RULE}\n${failed.length} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
process.exit(failed.length === 0 ? 0 : 1);
