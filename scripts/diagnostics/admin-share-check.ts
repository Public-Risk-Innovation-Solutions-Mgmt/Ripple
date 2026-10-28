// ============================================================================
// ADMIN IS A SHARE OF PREMIUM — A GATE (wip/pricing-rework; was
// admin-trend-check, which asserted the fixed and per-exposure admin trended 3%
// a year — all three retired).
//
//   npx tsx scripts/diagnostics/admin-share-check.ts
//
// Single-player, three lines, at the defaults, the pre-game and five played
// years (100 worlds) on three scenarios:
//
//   1. ADMIN PRICED IS EXACTLY ITS SHARE OF PREMIUM, EVERY YEAR: on every
//      line-year — the pre-game's and the played years' — admin / (pool
//      premium + admin) is ADMIN_SHARE_OF_PREMIUM (20%) to 1e-12, and the
//      member charge is pool premium + admin + reinsurance.
//   2. WHAT GOES TO LOSSES IS THE PURE PREMIUM x CLF: the pool premium is the
//      exposure charged x the retained pure premium x the CLF (risk control
//      off), so the permissible loss ratio is 1 - the share (80%) every year —
//      no profit and contingency in the divisor.
//   3. ADMIN BOOKED IS ADMIN PRICED x (1 + THE YEAR'S OVERRUN): operatingExpense
//      = admin x (1 + the share drawn for the line and year on the game's seed,
//      admin_overrun_<line>), the share inside 0% to 2%.
//   4. THE PURE PREMIUM IS UNCHANGED BY ADMIN: the same games played with every
//      line's share at 10% strike every line-year's pure premium bit-identical,
//      while admin moves (the arm is live).
//   5. THE SCREENS' SHARES: the Rate Indication's and the Model tab's admin
//      share is the parameter and the permissible loss ratio 1 - it, for every
//      priced year from the first played year to the coming one.
//
// ⚠ AND EACH FAILS WHEN BROKEN: the controls grade against a 19% share, a
// divisor carrying WC's old 2% profit and contingency, admin booked with no
// overrun, an overrun on another stream, a pure premium that moves (ULAE
// changed in the paired arm), and a screen share of 15%.
// ============================================================================

import { ADMIN_OVERRUN_RANGE, ADMIN_SHARE_OF_PREMIUM, ULAE_OF_LOSS_COST } from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { gameHistory } from '../../src/utils/gameHistory';
import { adminOverrunFor } from '../../src/utils/adminOverrun';
import { marketSeedOf } from '../../src/utils/bookUnits';
import { deriveSubRng } from '../../src/utils/random';
import { buildRateIndication } from '../../src/utils/rateIndication';
import { buildModelRate } from '../../src/utils/modelRate';
import type { CoverageLine, GameSetupSettings, GameState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SCENARIOS = ['2', '11', '19'];
const YEARS = 5;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

interface Played { rows: ResultSet[]; seed: number; gs: GameState }
function play(id: string): Played {
  // One year longer than played, so the coming year exists for section 5.
  const { setup, instance } = openSoloInstance({ poolName: 'A', gameLength: YEARS + 1, startingYear: 2027, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
  for (let y = 1; y <= YEARS; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), LINES)), currentYearNumber: y + 1 };
  }
  return { rows: gameHistory(gs), seed: marketSeedOf(instance), gs };
}
/** Play with every line's admin share (or another per-line table) temporarily set, then restore it. */
function playWith<T extends Record<CoverageLine, number>>(table: T, v: Partial<Record<CoverageLine, number>>, id: string): Played {
  const saved = { ...table };
  Object.assign(table, v);
  try { return play(id); } finally { Object.assign(table, saved); }
}

const lineYears = (games: Played[]) => games.flatMap(g => g.rows.flatMap(r => LINES.map(l => ({ g, y: r.yearNumber, l, x: r.byLine[l]! }))));

function gradeShare(games: Played[], share: (l: CoverageLine) => number, tag: string) {
  let worst = 0, worstCharge = 0, n = 0;
  for (const { l, x } of lineYears(games)) {
    n++;
    worst = Math.max(worst, Math.abs(x.adminExpense / (x.poolPremium + x.adminExpense) - share(l)));
    worstCharge = Math.max(worstCharge, Math.abs((x.poolPremium + x.adminExpense + x.reinsuranceCost) / x.totalMemberCharge - 1));
  }
  check(worst < 1e-12 && worstCharge < 1e-12 && n > 0,
    `${tag}1. every line-year's admin priced is exactly its share of the premium before reinsurance (${LINES.map(l => `${l} ${(ADMIN_SHARE_OF_PREMIUM[l] * 100).toFixed(0)}%`).join(', ')}), and the charge is pool premium + admin + reinsurance`,
    `${n} line-years (pre-game and played), share worst off ${worst.toExponential(2)}, charge worst off ${worstCharge.toExponential(2)}`);
}

function gradeLosses(games: Played[], divisor: (l: CoverageLine) => number, tag: string) {
  let worst = 0, n = 0;
  for (const { l, x } of lineYears(games)) {
    const billed = x.billedExposure ?? x.activeExposure;
    // The pool premium at the rate struck: retained x CLF over the divisor, less admin's share of it.
    const rateBefore = (x.netPurePremiumPer100 * x.selectedFundingCLF) / divisor(l);
    const want = billed * rateBefore * (1 - ADMIN_SHARE_OF_PREMIUM[l]) * 10_000;
    n++;
    worst = Math.max(worst, Math.abs(x.poolPremium / want - 1));
  }
  check(worst < 1e-9 && n > 0,
    `${tag}2. every line-year's pool premium is the exposure charged x the retained pure premium x the CLF — the permissible loss ratio is 1 - the admin share, with no profit and contingency`,
    `${n} line-years, worst off ${worst.toExponential(2)}`);
}

type Overrun = (seed: number, y: number, l: CoverageLine) => number;
function gradeBooked(games: Played[], overrun: Overrun, tag: string) {
  let booked = 0, outside = 0, n = 0, lo = Infinity, hi = -Infinity;
  for (const { g, y, l, x } of lineYears(games)) {
    n++;
    if (Math.abs(x.operatingExpense / (x.adminExpense * (1 + overrun(g.seed, y, l))) - 1) > 1e-9) booked++;
    const actual = x.operatingExpense / x.adminExpense - 1;
    lo = Math.min(lo, actual); hi = Math.max(hi, actual);
    if (actual < ADMIN_OVERRUN_RANGE.min - 1e-12 || actual > ADMIN_OVERRUN_RANGE.max + 1e-12) outside++;
  }
  check(booked === 0 && outside === 0 && n > 0,
    `${tag}3. the engine books every line-year's admin x (1 + the year's drawn overrun, 0-2%)`,
    `${n} line-years; ${booked} booked otherwise; overruns ${(lo * 100).toFixed(3)}% to ${(hi * 100).toFixed(3)}%, ${outside} outside the range`);
}

function gradePurePremium(a: Played[], b: Played[], tag: string) {
  let differ = 0, adminMoved = 0, n = 0;
  a.forEach((g, i) => g.rows.forEach((r, j) => LINES.forEach(l => {
    const x = r.byLine[l]!, z = b[i].rows[j].byLine[l]!;
    n++;
    if (x.newPurePremiumPer100 !== z.newPurePremiumPer100 || x.purePremiumPer100 !== z.purePremiumPer100) differ++;
    if (x.adminExpense !== z.adminExpense) adminMoved++;
  })));
  check(differ === 0 && adminMoved > 0 && n > 0,
    `${tag}4. with every line's admin share at 10% the pure premium is bit-identical in every line-year, and admin moved`,
    `${n} line-years; pure premium differs in ${differ}; admin differs in ${adminMoved}`);
}

function gradeScreens(games: Played[], share: (l: CoverageLine) => number, tag: string) {
  let bad = 0, n = 0;
  for (const g of games) for (const l of LINES) for (let y = 1; y <= YEARS + 1; y++) {
    const ri = buildRateIndication(g.gs, l, g.gs.currentDecisions, y);
    const m = buildModelRate(g.gs, l, g.gs.currentDecisions, y);
    if (!ri || !m) { bad++; continue; }
    n++;
    if (ri.expenses.admin !== share(l) || ri.expenses.permissibleLossRatio !== 1 - share(l)
      || m.expenses.admin !== share(l) || m.expenses.permissibleLossRatio !== 1 - share(l) || m.adminShare !== share(l)) bad++;
  }
  check(bad === 0 && n > 0,
    `${tag}5. the Rate Indication and the Model tab show admin at its share and the permissible loss ratio at 1 - it, every year`,
    `${n} line-years (2027 to the coming year), ${bad} otherwise`);
}

console.log(`ADMIN SHARE OF PREMIUM — scenarios ${SCENARIOS.join(', ')}, the pre-game and ${YEARS} played years, three lines`);
const games = SCENARIOS.map(play);
const tenPct = SCENARIOS.map(id => playWith(ADMIN_SHARE_OF_PREMIUM, { WC: 0.1, GL: 0.1, Property: 0.1 }, id));
const shipShare = (l: CoverageLine) => ADMIN_SHARE_OF_PREMIUM[l];
const shipDivisor = (l: CoverageLine) => 1 - ADMIN_SHARE_OF_PREMIUM[l];
gradeShare(games, shipShare, '');
gradeLosses(games, shipDivisor, '');
gradeBooked(games, adminOverrunFor, '');
gradePurePremium(games, tenPct, '');
gradeScreens(games, shipShare, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('a 19% share', () => gradeShare(games, () => 0.19, ''), '1.');
controlFails('the old 2% profit and contingency in WC\'s divisor', () => gradeLosses(games, l => shipDivisor(l) - (l === 'WC' ? 0.02 : 0), ''), '2.');
controlFails('admin booked with no overrun', () => gradeBooked(games, () => 0, ''), '3.');
controlFails('an overrun drawn on another stream', () => gradeBooked(games,
  (seed, y, l) => ADMIN_OVERRUN_RANGE.max * deriveSubRng(seed, y, `admin_overrun_x_${l}`).next(), ''), '3.');
controlFails('a pure premium that moves (ULAE 6% in the paired arm)', () => gradePurePremium(games,
  SCENARIOS.map(id => playWith(ULAE_OF_LOSS_COST, { WC: 0.06, GL: 0.06, Property: 0.06 }, id)), ''), '4.');
controlFails('a screen share of 15%', () => gradeScreens(games, () => 0.15, ''), '5.');

console.log('');
if (failures.length) {
  console.log('='.repeat(72));
  console.log(`${failures.length} CHECK(S) FAILED:\n  ${failures.join('\n  ')}`);
  console.log('='.repeat(72));
  process.exit(1);
}
console.log('PASS — admin is exactly its share of premium every year, priced and shown; losses carry the pure premium x CLF; booked with the year\'s overrun; the pure premium does not move with admin.');
