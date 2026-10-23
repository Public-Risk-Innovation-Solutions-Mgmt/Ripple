// ============================================================================
// EACH LINE AT ABOUT $30M OF YEAR-1 PREMIUM — THE GATE (stable-scenarios commit 8).
//
//   npx tsx scripts/diagnostics/exposure-scale-check.ts
//
//   1. ONE MULTIPLIER, THE WHOLE MARKET: FULL_MARKET_EXPOSURE is the 200-member
//      market times EXPOSURE_SCALE, line by line, and the multipliers are the
//      ones calibrated with profit and contingency at 0: WC 2.342, GL 1.640,
//      Property 0.546 (re-scaled from 1.797 / 1.258 / 0.430 once the catastrophe
//      load was removed and the pure premium became the basis, then from 2.236 /
//      1.604 / 0.534 once nothing was netted off the claims cost, then from
//      2.211 / 1.549 / 0.515 once the contingency went to 0).
//   2. THE POOL KEEPS ABOUT 30% OF IT: every seed's opening book is 29% to 33%
//      of its line's scaled market.
//   3. YEAR-1 PREMIUM AT EXPECTED IN ITS BAND: each line's year-1 premium at
//      the default decisions, averaged over seeds, is within 10% of the line's
//      centre — WC $34.92M, GL $35.71M, Property $30.53M (see BAND).
//
// ⚠ THE MULTIPLIERS ARE PINNED, AND NO LONGER RE-SCALED WHEN PRICING CHANGES
// (after the expectation followed the shock switch): a pricing change moves
// year-1 premium, and the band says how far it may move before someone looks.
// It was 2% of $30M, re-scaled after every pricing change; with the covers on
// the ordinary year a solo game's premium at Expected came to WC $29.1M,
// GL $28.5M, Property $27.9M, and exposure was kept.
//
// ⚠ AND THE BAND MOVES WITH THE PRICING INSTEAD (the reserve-inflation
// landing). It was $27M to $33M on every line — $30M +/- 10%. Reserve
// inflation priced in for its first years, the investment income credit
// taken off and profit and contingency set per line raised year-1 premium to
// WC $34.92M, GL $35.71M, Property $30.53M over these twelve seeds (from
// $30.94M, $30.91M and $28.33M). Exposure is not re-scaled when pricing
// changes, so the band is re-centred on those figures, per line, at the same
// +/- 10%. The controls keep it honest both ways: premiums 20% over or 20%
// under, and the premiums before the landing, each fail.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: a market left unscaled, a book
// read off the unscaled market, and premiums 20% off.
// ============================================================================

import { EXPOSURE_SCALE, FULL_MARKET_EXPOSURE } from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import type { CoverageLine, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const BASE: Record<CoverageLine, number> = { WC: 1300, GL: 1300, Property: 59233.002 };
const CALIBRATED: Record<CoverageLine, number> = { WC: 2.342, GL: 1.640, Property: 0.546 };
/** Year-1 premium at Expected, each line's mean over seeds: within 10% of the line's centre. */
const CENTRE: Record<CoverageLine, number> = { WC: 34.92e6, GL: 35.71e6, Property: 30.53e6 };
const BAND_WIDTH = 0.10;
const BAND: Record<CoverageLine, [number, number]> = Object.fromEntries(
  LINES.map(l => [l, [CENTRE[l] * (1 - BAND_WIDTH), CENTRE[l] * (1 + BAND_WIDTH)]])) as Record<CoverageLine, [number, number]>;
/** Year-1 premium before the reserve-inflation landing, as a share of today's, by line (a control). */
const BEFORE_LANDING: Record<CoverageLine, number> = { WC: 30.94 / 34.92, GL: 30.91 / 35.71, Property: 28.33 / 30.53 };
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

// ---------------------------------------------------------------- 1
function gradeMarket(market: Record<CoverageLine, number>, tag: string, scale: Record<CoverageLine, number> = EXPOSURE_SCALE) {
  const worst = Math.max(...LINES.map(l => Math.abs(market[l] / (BASE[l] * scale[l]) - 1)));
  const pinned = LINES.every(l => scale[l] === CALIBRATED[l]);
  check(worst < 1e-12 && pinned, `${tag}1. each line's market is the 200-member market x its calibrated exposure scale`,
    LINES.map(l => `${l} x${EXPOSURE_SCALE[l]} = $${market[l].toFixed(1)}M`).join(', '));
}

// ---------------------------------------------------------------- games
const SEEDS = 12;
const books: Record<CoverageLine, number[]> = { WC: [], GL: [], Property: [] };
const premiums: Record<CoverageLine, number[]> = { WC: [], GL: [], Property: [] };
for (let g = 0; g < SEEDS; g++) {
  const { setup, instance } = openSoloInstance({ poolName: 'X', gameLength: 10, startingYear: 2026, instanceId: `EXS${g}`, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
  gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(1)), LINES)) };
  for (const l of LINES) {
    books[l].push(poolState.lines[l].bookExposure ?? 0);
    premiums[l].push(gs.lockedResults[0].byLine[l]!.totalMemberCharge);
  }
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---------------------------------------------------------------- 2
function gradeShare(book: Record<CoverageLine, number[]>, market: Record<CoverageLine, number>, tag: string) {
  const shares = LINES.flatMap(l => book[l].map(b => b / market[l]));
  check(shares.every(s => s >= 0.29 && s <= 0.33),
    `${tag}2. every opening book is about 30% of its scaled market`,
    `${shares.length} books, ${(Math.min(...shares) * 100).toFixed(1)}% to ${(Math.max(...shares) * 100).toFixed(1)}%`);
}

// ---------------------------------------------------------------- 3
function gradePremium(prem: Record<CoverageLine, number[]>, tag: string) {
  const inBand = LINES.every(l => mean(prem[l]) >= BAND[l][0] && mean(prem[l]) <= BAND[l][1]);
  check(inBand, `${tag}3. each line's year-1 premium at Expected averages within 10% of its centre`,
    LINES.map(l => `${l} $${(mean(prem[l]) / 1e6).toFixed(2)}M in $${(BAND[l][0] / 1e6).toFixed(2)}M-$${(BAND[l][1] / 1e6).toFixed(2)}M`).join(', ') + ` over ${SEEDS} seeds`);
}

console.log('EACH LINE\'S YEAR-1 PREMIUM IN ITS BAND');
gradeMarket(FULL_MARKET_EXPOSURE, '');
gradeShare(books, FULL_MARKET_EXPOSURE, '');
gradePremium(premiums, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('a market left unscaled', () => gradeMarket(BASE, ''), '1.');
controlFails('the multipliers before the re-scale', () => gradeMarket(
  { WC: 1300 * 1.797, GL: 1300 * 1.258, Property: 59233.002 * 0.430 }, '', { WC: 1.797, GL: 1.258, Property: 0.430 }), '1.');
controlFails('the multipliers before the cover was charged in full', () => gradeMarket(
  { WC: 1300 * 2.236, GL: 1300 * 1.604, Property: 59233.002 * 0.534 }, '', { WC: 2.236, GL: 1.604, Property: 0.534 }), '1.');
controlFails('the multipliers before the contingency went to 0', () => gradeMarket(
  { WC: 1300 * 2.211, GL: 1300 * 1.549, Property: 59233.002 * 0.515 }, '', { WC: 2.211, GL: 1.549, Property: 0.515 }), '1.');
controlFails('a book read off the unscaled market', () => gradeShare(books, BASE, ''), '2.');
const scaled = (f: (l: CoverageLine) => number) =>
  Object.fromEntries(LINES.map(l => [l, premiums[l].map(p => p * f(l))])) as Record<CoverageLine, number[]>;
controlFails('premiums 20% over', () => gradePremium(scaled(() => 1.2), ''), '3.');
controlFails('premiums 20% under', () => gradePremium(scaled(() => 0.8), ''), '3.');
controlFails('the premiums before the reserve-inflation landing', () => gradePremium(scaled(l => BEFORE_LANDING[l]), ''), '3.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — one exposure multiplier per line on the whole market, a 30% book, and year-1 premium in its band.');
