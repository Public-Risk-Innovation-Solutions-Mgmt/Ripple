// ============================================================================
// EACH LINE AT ABOUT $30M OF YEAR-1 PREMIUM — THE GATE (stable-scenarios commit 8).
//
//   npx tsx scripts/diagnostics/exposure-scale-check.ts
//
//   1. ONE MULTIPLIER, THE WHOLE MARKET: FULL_MARKET_EXPOSURE is the 200-member
//      market times EXPOSURE_SCALE, line by line, and the multipliers are the
//      ones calibrated on the pure-premium basis: WC 2.236, GL 1.604, Property
//      0.534 (re-scaled from 1.797 / 1.258 / 0.430 once the catastrophe load was
//      removed and the pure premium became the basis).
//   2. THE POOL KEEPS ABOUT 30% OF IT: every seed's opening book is 29% to 33%
//      of its line's scaled market.
//   3. ABOUT $30M AT EXPECTED: each line's year-1 premium at the default
//      decisions (Expected, Bad-year cover), averaged over seeds, is within 2%
//      of $30M.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: a market left unscaled, a book
// read off the unscaled market, and premiums 10% off.
// ============================================================================

import { EXPOSURE_SCALE, FULL_MARKET_EXPOSURE } from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import type { CoverageLine, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const BASE: Record<CoverageLine, number> = { WC: 1300, GL: 1300, Property: 59233.002 };
const CALIBRATED: Record<CoverageLine, number> = { WC: 2.236, GL: 1.604, Property: 0.534 };
const TARGET = 30e6;
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
  const worst = Math.max(...LINES.map(l => Math.abs(mean(prem[l]) / TARGET - 1)));
  check(worst < 0.02, `${tag}3. each line's year-1 premium at Expected averages within 2% of $30M`,
    LINES.map(l => `${l} $${(mean(prem[l]) / 1e6).toFixed(2)}M`).join(', ') + ` over ${SEEDS} seeds`);
}

console.log('EACH LINE AT ABOUT $30M OF YEAR-1 PREMIUM');
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
controlFails('a book read off the unscaled market', () => gradeShare(books, BASE, ''), '2.');
controlFails('premiums 10% off', () => gradePremium(
  Object.fromEntries(LINES.map(l => [l, premiums[l].map(p => p * 1.1)])) as Record<CoverageLine, number[]>, ''), '3.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — one exposure multiplier per line on the whole market, a 30% book, and about $30M of year-1 premium.');
