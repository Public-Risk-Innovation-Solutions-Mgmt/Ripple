// ============================================================================
// THE RATE BUILD-UP, ONE LINE-YEAR AT A TIME — every step from losses to the
// member's rate, with the arithmetic shown.
//
//   npx tsx scripts/tools/rate-buildup-report.ts --seed 7 --line WC --year 3
//   npx tsx scripts/tools/rate-buildup-report.ts --seed 7 --line GL --year 5 \
//     --set SEVERITY_TREND_PER_YEAR.GL=0.07 --set PROFIT_AND_CONTINGENCY_OF_RATE=0.06
//
// Flags: --seed N (default 7), --line WC|GL|Property (default WC), --year N
// (default 3), and any number of --set NAME=VALUE overrides — see
// pricing-overrides.cjs for what those reach and how.
//
// A typical run is about 2 seconds — 2.0s measured at year 3, 1.8s at year 10.
// It plays one game to the requested year, which is the only way to have a
// ledger to price off, so the cost grows with --year and with nothing else.
//
// ============================================================================
// ⚠ IT TIES TO THE BILLED RATE OR IT FAILS. THAT IS THE WHOLE DESIGN.
//
// A report that recomputes the rate alongside the engine is worth nothing: it
// shows what a second implementation thinks, and the second implementation is
// the one nobody bills from. So the walk below is built by calling
// quoteNewRateStack — the function the engine itself prices with — and then
// asserting that what comes back is, to the bit, the finalRatePer100 the
// engine stored on the result it just produced, and that the engine's own
// dollar components sum to the charge members actually paid.
//
// If the two ever part, this exits 1 and prints both. A tuning instrument that
// quietly describes a rate nobody is charged is worse than no instrument.
//
// ⚠ THE TIE-OUT IS ALSO WHAT PROVES AN OVERRIDE REACHED THE ENGINE. A `--set`
// that only moved this report's own arithmetic would show a different rate
// here and leave the engine's stored rate where it was, and the first two
// checks in section 7 would go red. They do not: with
// SEVERITY_TREND_PER_YEAR.WC at 0.09 and the contingency at 8%, the walk and
// the engine agree bit for bit on a final rate of 5.1258 against the
// committed 4.5297. The knob is connected to the thing being measured.
// outcomes-summary.ts reads the same way: WC's median rate goes 7.020 to 7.985
// with SEVERITY_TREND_PER_YEAR.WC at 0.09, off the engine's own billed rates.
//
// ⚠ AND THE TIE-OUT CAN FAIL — MEASURED, NOT ASSUMED. Multiplying the ground-up
// pure premium handed to the quote by (1 + 1e-9) — one part in a billion, four
// decimal places below anything this report prints — reddens 4 of the 11
// checks and exits 1: the retained pure premium and the first indication both
// break bit-equality, the pool-premium reconstruction breaks the cent, and the
// final rate reads 8.5e-10 relative against a bar of 1e-13. A tie-out that
// cannot fail is decoration.
//
// ⚠ ALL-DEFAULT DECISIONS, AND THE TIE-OUT IS WHAT MAKES THAT SAFE. The quote
// needs the book the tower was bought for — `towerMembers` inside the engine —
// and that is built from member movement this script cannot see from outside.
// At default decisions nobody is declined and the roster does not move, so the
// line's active members ARE that book. Rather than assert that in prose, the
// tie-out asserts it in arithmetic: if movement ever made the two books
// differ, the rate would differ and this would go red.
// ============================================================================

// ⚠ FIRST IMPORT, AND IT HAS TO BE — see pricing-overrides-install.ts.
import { argvWithoutOverrides, overridesBanner, pricingOverrides } from './pricing-overrides-install';
import { startRunLog } from './runlog';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { newPurePremiumPer100, lossCostTrendPerYear } from '../../src/utils/newPurePremium';
import { quoteNewRateStack } from '../../src/utils/linePricing';
import { getMemberExposure } from '../../src/utils/lineHelpers';
import { REINSURANCE_TOWER, type TowerLine } from '../../src/data/reinsuranceTower';
import { layerPremium, expectedCededForLayer } from '../../src/utils/reinsuranceTower';
import {
  ADMIN_FIXED_PER_YEAR, ADMIN_PER_EXPOSURE_PER_100, ALAE_OF_LOSS_COST, ULAE_OF_LOSS_COST,
  NEW_RATE_STACK, PRICING_WINDOW_YEARS_NEW, PROFIT_AND_CONTINGENCY_OF_RATE,
  REINSURANCE_LOAD,
} from '../../src/data/pricingParameters';
import type { CoverageLine, GameState, LineResultSet, Member } from '../../src/types/simulation';
import { AGGREGATE_NOT_OFFERED, placementFor } from '../../src/utils/reinsuranceOptions';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const RULE = '='.repeat(86);

function flag(name: string, fallback: string): string {
  const i = argvWithoutOverrides.indexOf(`--${name}`);
  return i >= 0 && argvWithoutOverrides[i + 1] !== undefined ? argvWithoutOverrides[i + 1] : fallback;
}

const SEED = Number(flag('seed', '7'));
const LINE = flag('line', 'WC') as CoverageLine;
const YEAR = Number(flag('year', '3'));

if (!LINES.includes(LINE)) {
  console.error(`--line must be one of ${LINES.join(', ')}`);
  process.exit(1);
}
if (!Number.isInteger(YEAR) || YEAR < 1) {
  console.error('--year must be a whole year from 1');
  process.exit(1);
}

const RUN_LOG = startRunLog('rate-buildup', pricingOverrides, [LINE, `y${YEAR}`, `seed${SEED}`]);

const failures: string[] = [];
const check = (ok: boolean, what: string, detail: string) => {
  if (!ok) failures.push(`${what} — ${detail}`);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${what}`.padEnd(66) + detail);
};

const m$ = (v: number) => `$${(v / 1e6).toFixed(3)}M`;
const r4 = (v: number) => v.toFixed(4);
const pct = (v: number) => `${(100 * v).toFixed(2)}%`;

// ---------------------------------------------------------------------------
// PLAY. Each year is processed in turn; the state BEFORE the target year is
// kept, because that is the ledger the target year is priced off.
// ---------------------------------------------------------------------------
const id = `RBU${SEED}`;
const instance = generateGameInstance(id, SEED);
const setup = {
  poolName: 'Build-up', gameLength: YEAR + 1, startingYear: 2026,
  instanceId: id, activeLines: LINES,
};
const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
let gs: GameState = {
  setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
  poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
};

interface Walk {
  year: number;
  result: LineResultSet;
  quote: ReturnType<typeof quoteNewRateStack>;
  pp: NonNullable<ReturnType<typeof newPurePremiumPer100>>;
  members: Member[];
  exposure: number;
  clf: number;
  rc: number;
  placed: boolean[];
}

const walks = new Map<number, Walk>();

for (let y = 1; y <= YEAR; y++) {
  const decisions = defaultDecisionSet(y);
  const lineState = gs.poolState.lines[LINE];
  // The book the tower is bought for, at default decisions — see the header.
  const members = (lineState.members ?? []).filter(m => m.status === 'active');
  const exposure = members.reduce((s, m) => s + getMemberExposure(m, LINE, y), 0);
  const pp = newPurePremiumPer100(LINE, y, {
    rows: lineState.reserveDevelopment ?? [],
    allMarketMembers: gs.poolState.allMarketMembers,
    membershipHistory: gs.poolState.membershipHistory,
  });

  const processed = processYear(gs, decisions);
  const result = processed.result.byLine[LINE];

  if (pp !== null && result !== undefined && (y === YEAR || y === YEAR - 1)) {
    const d = decisions.byLine[LINE];
    const rc = d.riskControlIncentivePct ?? 0;
    const placed = placementFor(LINE, d.reinsuranceOption);
    walks.set(y, {
      year: y, result, pp, members, exposure, rc, placed,
      clf: result.selectedFundingCLF,
      quote: quoteNewRateStack({
        line: LINE, yearNumber: y, members, exposure,
        groundUpPurePremiumPer100: pp.purePremiumPer100,
        clf: result.selectedFundingCLF, riskControlPct: rc,
        layersPlaced: placed, aggregateStopLevel: AGGREGATE_NOT_OFFERED,
      }),
    });
  }

  gs = {
    ...gs, poolState: processed.updatedPoolState, currentYearNumber: y + 1,
    currentDecisions: defaultDecisionSet(y + 1),
    lockedResults: [...gs.lockedResults, processed.result],
  };
}

const w = walks.get(YEAR);
const prior = walks.get(YEAR - 1);

console.log(RULE);
console.log(`RATE BUILD-UP — ${LINE}, year ${YEAR}, seed ${SEED}`);
console.log(RULE);
console.log(overridesBanner);
console.log(`NEW_RATE_STACK is ${NEW_RATE_STACK.enabled ? 'ON' : 'OFF'}; all-default decisions.\n`);

if (w === undefined) {
  console.error(`No priced ${LINE} line-year at year ${YEAR} — the line produced no quote.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
console.log(`--- 1. THE EXPERIENCE: the most recent ${PRICING_WINDOW_YEARS_NEW} accident years ---`);
console.log(`  Each year's ground-up PAID is developed to ultimate on the recorded paid pattern,`);
console.log(`  divided by that year's exposure, then trended to ${2025 + YEAR} at `
  + `${pct(lossCostTrendPerYear(LINE) - 1)}/yr.\n`);
console.log('    AY   age(mo)      ground-up paid       LDF        developed     exposure $M'
  + '   loss cost/100   trend    trended/100');
for (const p of w.pp.points) {
  console.log(`  ${String(p.accidentYear).padStart(4)}   ${String(p.ageMonths).padStart(7)}`
    + `   ${m$(p.groundUpPaid).padStart(17)}   ${p.ldf.toFixed(4).padStart(7)}`
    + `   ${m$(p.developed).padStart(14)}   ${p.exposure.toFixed(2).padStart(12)}`
    + `   ${r4(p.lossCostPer100).padStart(13)}   ${p.trendFactor.toFixed(4).padStart(6)}`
    + `   ${r4(p.trendedLossCostPer100).padStart(11)}`);
}
if (w.pp.skipped > 0) {
  console.log(`  ⚠ ${w.pp.skipped} year(s) skipped for want of a ground-up series or a known exposure.`);
}
console.log(`\n  mean trended loss cost per $100                        ${r4(w.pp.lossCostPer100).padStart(10)}`);
console.log(`  + ALAE at ${pct(ALAE_OF_LOSS_COST[LINE]).padStart(6)} of loss cost                     `
  + `${r4(w.pp.alaePer100).padStart(10)}`);
console.log(`  + ULAE at ${pct(ULAE_OF_LOSS_COST[LINE]).padStart(6)} of loss cost                     `
  + `${r4(w.pp.ulaePer100).padStart(10)}`);
console.log(`  = GROUND-UP PURE PREMIUM per $100                      ${r4(w.quote.groundUpPurePremiumPer100).padStart(10)}`);

// ---------------------------------------------------------------------------
console.log('\n--- 2. WHAT THE POOL KEEPS ---');
console.log(`  ground-up pure premium                                 ${r4(w.quote.groundUpPurePremiumPer100).padStart(10)}`);
console.log(`  - expected ceded to the placed layers and aggregate    ${r4(w.quote.expectedCededPer100).padStart(10)}`);
console.log(`  = RETAINED PURE PREMIUM per $100                       ${r4(w.quote.retainedPurePremiumPer100).padStart(10)}`);
console.log(`  x CLF (funding confidence)                             ${w.clf.toFixed(4).padStart(10)}`);
console.log(`  = funded retained loss cost per $100                   ${r4(w.quote.retainedPurePremiumPer100 * w.clf).padStart(10)}`);

// ---------------------------------------------------------------------------
console.log('\n--- 3. ADMINISTRATION ---');
console.log(`  fixed per year                                   ${m$(ADMIN_FIXED_PER_YEAR[LINE]).padStart(16)}`);
console.log(`  over exposure of ${w.exposure.toFixed(2)} $M                        `
  + `${r4(ADMIN_FIXED_PER_YEAR[LINE] / Math.max(w.exposure * 10_000, 1)).padStart(10)} per $100`);
console.log(`  + per-exposure rate                                    ${r4(ADMIN_PER_EXPOSURE_PER_100[LINE]).padStart(10)} per $100`);
console.log(`  = ADMIN RATE per $100                                  ${r4(w.quote.adminRatePer100).padStart(10)}`);

// ---------------------------------------------------------------------------
console.log('\n--- 4. THE VARIABLE PERCENTAGES ---');
console.log(`  risk control incentive                                 ${pct(w.rc).padStart(10)}`);
console.log(`  profit & contingency                                   ${pct(PROFIT_AND_CONTINGENCY_OF_RATE).padStart(10)}`);
console.log(`  = divisor  1 - ${pct(w.rc)} - ${pct(PROFIT_AND_CONTINGENCY_OF_RATE)}`
  + `                           ${w.quote.divisor.toFixed(4).padStart(10)}`);
console.log(`  what the divisor adds to the final rate                ${r4(w.quote.riskControlAndContingencyPer100).padStart(10)} per $100`);

// ---------------------------------------------------------------------------
console.log('\n--- 5. REINSURANCE, LAYER BY LAYER ---');
console.log(`  Each placed layer is priced at its expected loss x (1 + REINSURANCE_LOAD), `
  + `${(1 + REINSURANCE_LOAD).toFixed(4)}.\n`);
console.log('    layer                        placed       expected loss            price'
  + '      price/100');
const tower = REINSURANCE_TOWER[LINE as TowerLine] ?? [];
let layerPriceSum = 0;
tower.forEach((l, i) => {
  const on = (w.placed[i] ?? false) && l.purchasable;
  const exp = on ? expectedCededForLayer(LINE as TowerLine, i, w.members, YEAR) : 0;
  const price = on ? layerPremium(LINE as TowerLine, i, w.members, YEAR) : 0;
  layerPriceSum += price;
  const band = `${m$(l.attachment)} xs ${m$(l.limit)}`;
  console.log(`  ${band.padEnd(30)} ${(l.purchasable ? (on ? 'yes' : 'no') : 'n/a').padEnd(8)}`
    + `   ${(on ? m$(exp) : '—').padStart(14)}   ${(on ? m$(price) : '—').padStart(14)}`
    + `   ${(on ? r4(price / Math.max(w.exposure * 10_000, 1)) : '—').padStart(11)}`);
});
const aggPremium = w.quote.aggregateQuote?.premium ?? 0;
console.log(`  ${'aggregate stop-loss'.padEnd(30)} ${(aggPremium > 0 ? 'yes' : 'no').padEnd(8)}`
  + `   ${(aggPremium > 0 ? m$(w.quote.aggregateQuote?.expectedCeded ?? 0) : '—').padStart(14)}`
  + `   ${(aggPremium > 0 ? m$(aggPremium) : '—').padStart(14)}`
  + `   ${(aggPremium > 0 ? r4(aggPremium / Math.max(w.exposure * 10_000, 1)) : '—').padStart(11)}`);
console.log(`\n  = REINSURANCE per $100                                 ${r4(w.quote.reinsRatePer100).padStart(10)}`
  + `   (${m$(w.quote.reinsuranceCost)})`);

// ---------------------------------------------------------------------------
console.log('\n--- 6. THE TWO RATES, AND EACH AGAINST LAST YEAR ---');
const move = (now: number, before: number | undefined) =>
  before === undefined || !(before > 0)
    ? '      —'
    : `${((now / before - 1) >= 0 ? '+' : '')}${(100 * (now / before - 1)).toFixed(1)}%`.padStart(7);
const lastCol = (v: number | undefined) => (v === undefined ? '        —' : r4(v).padStart(9));

console.log(`                                                      year ${String(YEAR).padEnd(3)}`
  + `  year ${String(YEAR - 1).padEnd(3)}   change`);
const rows: Array<[string, number, number | undefined]> = [
  ['ground-up pure premium', w.quote.groundUpPurePremiumPer100, prior?.quote.groundUpPurePremiumPer100],
  ['expected ceded', w.quote.expectedCededPer100, prior?.quote.expectedCededPer100],
  ['retained pure premium', w.quote.retainedPurePremiumPer100, prior?.quote.retainedPurePremiumPer100],
  ['CLF', w.clf, prior?.clf],
  ['admin rate', w.quote.adminRatePer100, prior?.quote.adminRatePer100],
  ['risk control & contingency', w.quote.riskControlAndContingencyPer100, prior?.quote.riskControlAndContingencyPer100],
  ['reinsurance', w.quote.reinsRatePer100, prior?.quote.reinsRatePer100],
  ['FIRST INDICATION  (ground-up + admin) / divisor', w.quote.firstIndicationPer100, prior?.quote.firstIndicationPer100],
  ['FINAL RATE        what members are billed', w.quote.finalRatePer100, prior?.quote.finalRatePer100],
];
for (const [label, now, before] of rows) {
  console.log(`  ${label.padEnd(50)} ${r4(now).padStart(9)}  ${lastCol(before)}   ${move(now, before)}`);
}
console.log(`\n  expected to surplus at this rate                      ${m$(w.quote.expectedToSurplus)}`);

// ---------------------------------------------------------------------------
console.log('\n--- 7. TIE-OUT: does this walk end where the bill does? ---');
const r = w.result;

// ⚠ THE TWO THAT PROVE THE BOOK IS THE ENGINE'S. This walk re-quotes through
// quoteNewRateStack, so it ties only if it was handed the same members, the
// same exposure and the same placements the engine used. These two come back
// BIT-IDENTICAL when it was and move visibly when it was not — the reinsurance
// cost is struck on the member list itself, and the retained pure premium
// carries the cession off that same list. They are the assertion behind the
// header's claim that the all-default roster IS the engine's towerMembers.
check(r.netPurePremiumPer100 !== undefined
  && w.quote.retainedPurePremiumPer100 - r.netPurePremiumPer100 === 0,
'the retained pure premium IS the engine\'s, to the bit',
`walk ${w.quote.retainedPurePremiumPer100.toPrecision(17)}`);

check(w.quote.reinsuranceCost - r.reinsuranceCost === 0,
  'the reinsurance cost IS the engine\'s, to the bit',
  `walk ${m$(w.quote.reinsuranceCost)} on ${w.members.length} members`);

check(r.firstIndicationPer100 !== undefined
  && w.quote.firstIndicationPer100 - r.firstIndicationPer100 === 0,
'the first indication IS the engine\'s, to the bit',
`walk ${r4(w.quote.firstIndicationPer100)}`);

// ⚠ THE GROUND-UP FIGURE IS COMPARED AT 4 DECIMALS AND THAT IS THE STORAGE,
// NOT A TOLERANCE. `purePremiumPer100` is written to the result through
// toFixed(4); the walk holds the unrounded number it was rounded from.
check(r.purePremiumPer100 !== undefined
  && Math.abs(w.quote.groundUpPurePremiumPer100 - r.purePremiumPer100) < 5e-5,
'the ground-up pure premium is the engine\'s (4dp as stored)',
`walk ${w.quote.groundUpPurePremiumPer100.toFixed(6)} vs stored ${r.purePremiumPer100?.toFixed(4)}`);

// ⚠ THE DOLLARS, ON THE WALK'S OWN EXPOSURE. Reconstructing these through the
// result's `activeExposure` fails by about $80 on WC, and the cause is worth
// stating rather than absorbing: that field is stored to 2dp in $M, so it is
// 360.52 where the book is 360.517. The walk holds the unrounded figure the
// engine priced on, and against that the two limbs come back to the cent.
const E = w.exposure * 10_000;
const walkPool = w.quote.retainedPurePremiumPer100 * w.clf / w.quote.divisor * E;
const walkAdmin = w.quote.adminRatePer100 / w.quote.divisor * E;
check(Math.abs(walkPool - r.poolPremium) < 0.01,
  'retained x CLF / divisor x exposure == the pool premium',
  `${m$(walkPool)} vs ${m$(r.poolPremium)}`);
check(Math.abs(walkAdmin - r.adminExpense) < 0.01,
  'admin rate / divisor x exposure == the admin expense',
  `${m$(walkAdmin)} vs ${m$(r.adminExpense)}`);

// The charge is additive and the three limbs are the three sections above.
const sum = r.poolPremium + r.adminExpense + r.reinsuranceCost;
check(Math.abs(sum - r.totalMemberCharge) < 1e-6,
  'pool premium + admin + reinsurance == the charge',
  `${m$(sum)} vs ${m$(r.totalMemberCharge)}`);

// ⚠ THE LAST STEP IS ONE ULP OFF AND IT IS NOT A DEFECT — IT IS TWO ORDERS OF
// OPERATION ON THE SAME QUANTITY. The engine does NOT store the stack's
// finalRatePer100; it stores totalMemberCharge divided by the billed exposure,
// deliberately, so that "the rate shown is the rate charged" holds by
// construction (see the comment at the field). The walk instead sums rates and
// divides once. Measured difference on WC year 3: 4.5296969258855082 against
// 4.5296969258855073, which is 9e-16 — the last bit of a double, and the bar
// is set three decades above it rather than at zero because no reassociation
// of these terms can be made exact.
const storedFinal = r.finalRatePer100 ?? NaN;
const ulps = Math.abs(w.quote.finalRatePer100 - storedFinal) / Math.max(Math.abs(storedFinal), 1e-12);
check(ulps < 1e-13, 'the walk\'s final rate IS the rate the engine billed',
  `walk ${w.quote.finalRatePer100.toPrecision(17)} vs engine ${storedFinal.toPrecision(17)}`
  + ` (${ulps.toExponential(1)} relative)`);

// ⚠ AND THAT RATE IS WHAT WAS ACTUALLY BILLED. Not bit-exact, and the bound is
// the one new-rate-bill-check states: writtenExposure is stored to 2dp in $M,
// about 1e-4 on a rate of 8. The EXACT form of this identity is the two dollar
// limbs above.
const billed = r.totalMemberCharge / Math.max(r.writtenExposure * 10_000, 1);
check(Math.abs(billed - w.quote.finalRatePer100) < 5e-4,
  'the charge over exposure is that rate (2dp exposure bound)',
  `billed ${r4(billed)} vs walk ${r4(w.quote.finalRatePer100)}`);

// The build-up's own arithmetic, stated as an identity rather than implied by
// the layout: the final rate is the funded retained loss cost plus admin, over
// the divisor, plus reinsurance.
const rebuilt = (w.quote.retainedPurePremiumPer100 * w.clf + w.quote.adminRatePer100)
  / w.quote.divisor + w.quote.reinsRatePer100;
check(Math.abs(rebuilt - w.quote.finalRatePer100) < 1e-12,
  'the printed steps reproduce the final rate',
  `(${r4(w.quote.retainedPurePremiumPer100)} x ${w.clf.toFixed(4)} + ${r4(w.quote.adminRatePer100)})`
  + ` / ${w.quote.divisor.toFixed(4)} + ${r4(w.quote.reinsRatePer100)} = ${r4(rebuilt)}`);

check(Math.abs(layerPriceSum + aggPremium - w.quote.reinsuranceCost) < 1e-6,
  'the layer prices sum to the reinsurance cost',
  `${m$(layerPriceSum + aggPremium)} vs ${m$(w.quote.reinsuranceCost)}`);

console.log(`\n${RULE}`);
if (failures.length === 0) {
  console.log('THE WALK TIES TO THE BILLED RATE.');
} else {
  console.log(`${failures.length} TIE-OUT FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
}
console.log(RULE);
console.log(`log: ${RUN_LOG}`);
process.exit(failures.length === 0 ? 0 : 1);
