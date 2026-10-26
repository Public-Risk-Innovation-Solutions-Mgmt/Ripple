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
//   2. RETIRED with simple underwriting (see below): the opening book's share
//      of the market.
//   3. YEAR-1 PREMIUM AT EXPECTED IN ITS BAND: each line's year-1 premium at
//      the default decisions, averaged over seeds, is within 10% of the line's
//      centre — WC $30.65M, GL $28.81M, Property $27.40M (see BAND).
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
// ⚠ AND THE BAND MOVES WITH THE OPENING, TOO (simple underwriting, restated
// by the project lead). Every game now opens on the standard opening book
// (OPENING_BOOK_EXPOSURE — WC 30.1%, GL 28.8%, Property 29.7% of the market),
// not on a book of units drawn to just over 30% plus the last unit; so the
// opening exposure fell (GL most, 28.8% against about 30.8%) and with it
// year-1 premium, to WC $32.56M, GL $31.92M, Property $28.27M over these
// twelve seeds (from $34.92M, $35.71M, $30.53M) — GL below its old band.
// EXPOSURE IS NOT RE-SCALED WHEN THE OPENING CHANGES, as it is not when
// pricing does: the band is re-centred on the standard opening book's
// premiums, at the same +/- 10%.
// CHECK 2 IS RETIRED, NOT LOOSENED: it held each seed's opening book to 29%-33%
// of its market, the book of units' draw. This build removes that market of
// potential members as something a book is drawn from — every game opens on
// the same standard book, which simple-underwriting-check section 4 holds
// exactly — so there is no share left to vary.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: a market left unscaled,
// premiums 20% off either way, and the premiums before this restatement (the
// book of units' opening) — GL's then sat 11.9% above today's centre.
// And in the source: GL's standard opening book raised 12% (OPENING_BOOK_EXPOSURE
// .GL x 1.12) — EXIT 1, check 3 fails, GL $35.55M above its $35.11M ceiling;
// restored, PASS.
//
// ⚠ AND RE-CENTRED AGAIN WITH ADVERSE DEVELOPMENT (wip/adverse-development,
// merged onto simple underwriting). RESERVE_INFLATION is off, so reserve
// inflation is neither booked nor priced (reserveInflationToCome is 1), and
// ADVERSE_DEVELOPMENT replaces it — which the rate does not anticipate, and
// which single player (these games) does not have at all. On the standard
// opening book, over these twelve seeds:
//
//     reserve inflation priced (multiplayer, simple underwriting)  WC $32.56M  GL $31.92M  Property $28.27M
//     reserve inflation off (this landing)                         WC $30.65M  GL $28.81M  Property $27.40M
//
// The whole move is reserve inflation leaving the rate (measured on the book
// of units before simple underwriting: restoring it moved WC $32.82M -> $34.87M,
// GL $31.92M -> $35.39M, Property $29.45M -> $30.38M, and adverse development
// moved none). The band is re-centred on the as-shipped figures, per line, at
// the same +/- 10%. CONTROLS, each today's premiums scaled to another build's:
// the premiums with reserve inflation still priced (multiplayer's centre; GL
// +10.8% leaves its band) and the premiums on the book of units' opening with
// reserve inflation priced (GL +24.0%).
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
const CENTRE: Record<CoverageLine, number> = { WC: 30.65e6, GL: 28.81e6, Property: 27.40e6 };
const BAND_WIDTH = 0.10;
const BAND: Record<CoverageLine, [number, number]> = Object.fromEntries(
  LINES.map(l => [l, [CENTRE[l] * (1 - BAND_WIDTH), CENTRE[l] * (1 + BAND_WIDTH)]])) as Record<CoverageLine, [number, number]>;
/** Year-1 premium on the book of units' opening, reserve inflation priced, as a share of today's, by line (a control). */
const BEFORE_LANDING: Record<CoverageLine, number> = { WC: 34.92 / 30.65, GL: 35.71 / 28.81, Property: 30.53 / 27.40 };
/** Year-1 premium with reserve inflation still priced (simple underwriting's centre), as a share of today's (a control). */
const RESERVE_INFLATION_PRICED: Record<CoverageLine, number> = { WC: 32.56 / 30.65, GL: 31.92 / 28.81, Property: 28.27 / 27.40 };
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
const premiums: Record<CoverageLine, number[]> = { WC: [], GL: [], Property: [] };
for (let g = 0; g < SEEDS; g++) {
  const { setup, instance } = openSoloInstance({ poolName: 'X', gameLength: 10, startingYear: 2026, instanceId: `EXS${g}`, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
  gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(1)), LINES)) };
  for (const l of LINES) {
    premiums[l].push(gs.lockedResults[0].byLine[l]!.totalMemberCharge);
  }
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---------------------------------------------------------------- 3
function gradePremium(prem: Record<CoverageLine, number[]>, tag: string) {
  const inBand = LINES.every(l => mean(prem[l]) >= BAND[l][0] && mean(prem[l]) <= BAND[l][1]);
  check(inBand, `${tag}3. each line's year-1 premium at Expected averages within 10% of its centre`,
    LINES.map(l => `${l} $${(mean(prem[l]) / 1e6).toFixed(2)}M in $${(BAND[l][0] / 1e6).toFixed(2)}M-$${(BAND[l][1] / 1e6).toFixed(2)}M`).join(', ') + ` over ${SEEDS} seeds`);
}

console.log('EACH LINE\'S YEAR-1 PREMIUM IN ITS BAND');
gradeMarket(FULL_MARKET_EXPOSURE, '');
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
const scaled = (f: (l: CoverageLine) => number) =>
  Object.fromEntries(LINES.map(l => [l, premiums[l].map(p => p * f(l))])) as Record<CoverageLine, number[]>;
controlFails('premiums 20% over', () => gradePremium(scaled(() => 1.2), ''), '3.');
controlFails('premiums 20% under', () => gradePremium(scaled(() => 0.8), ''), '3.');
controlFails('the premiums on the book of units\' opening', () => gradePremium(scaled(l => BEFORE_LANDING[l]), ''), '3.');
controlFails('the premiums with reserve inflation still priced', () => gradePremium(scaled(l => RESERVE_INFLATION_PRICED[l]), ''), '3.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — one exposure multiplier per line on the whole market, and year-1 premium in its band.');
