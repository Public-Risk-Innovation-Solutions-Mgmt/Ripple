// ============================================================================
// ADMIN GROWS WITH INFLATION — A GATE.
//
//   npx tsx scripts/diagnostics/admin-trend-check.ts
//
// Single-player, three lines, at the defaults, the pre-game and five played
// years (100 worlds) on three scenarios:
//
//   1. THE BOOKED ADMIN IS THE TRENDED ADMIN: every line-year's admin expense —
//      the pre-game's and the played years' — is its exposure x (the fixed
//      dollars spread over the book it was priced on + the per-exposure rate),
//      BOTH parts x (1 + ADMIN_TREND_PER_YEAR)^(year - ADMIN_BASE_YEAR), carried
//      by the divisor; and the engine books it with the year's overrun
//      (ADMIN_OVERRUN_RANGE): operatingExpense = admin x (1 + the share drawn
//      for the line and year on the game's seed, admin_overrun_<line>), the
//      share inside 0% to 2%. ⚠ RESTATED: it was operatingExpense = admin until
//      actual admin was made to run over the admin priced; the admin PRICED is
//      unchanged, and that is what section 1's trend is checked on.
//   2. THE BASE YEAR STANDS ON THE PARAMETERS: at ADMIN_BASE_YEAR (2027) the
//      factor is exactly 1, and 2021's is 1.03^-6.
//
// ⚠ AND EACH FAILS WHEN BROKEN: the controls feed 1 flat admin, a trend on the
// fixed part only, a base year a year late, admin booked with no overrun, and an
// overrun drawn on another stream.
// ============================================================================

import {
  ADMIN_BASE_YEAR, adminFixedPerYear, adminPerExposurePer100, ADMIN_TREND_PER_YEAR,
} from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { gameHistory } from '../../src/utils/gameHistory';
import { adminOverrunFor } from '../../src/utils/adminOverrun';
import { marketSeedOf } from '../../src/utils/bookUnits';
import { deriveSubRng } from '../../src/utils/random';
import { ADMIN_OVERRUN_RANGE } from '../../src/data/pricingParameters';
import { adminTrendFactor, effectiveRiskControlIncentivePct, expenseDivisor } from '../../src/utils/linePricing';
import type { CoverageLine, GameSetupSettings, GameState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SCENARIOS = ['2', '11', '19'];
const YEARS = 5;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

interface Played { rows: ResultSet[]; seed: number }
function play(id: string): Played {
  const { setup, instance } = openSoloInstance({ poolName: 'A', gameLength: YEARS, startingYear: 2027, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
  for (let y = 1; y <= YEARS; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), LINES)), currentYearNumber: y + 1 };
  }
  return { rows: gameHistory(gs), seed: marketSeedOf(instance) };
}

// The two parts' trend factors for a year: [fixed, per-exposure].
type Trend = (y: number) => [number, number];
const shipped: Trend = y => [Math.pow(1 + ADMIN_TREND_PER_YEAR, y - ADMIN_BASE_YEAR), Math.pow(1 + ADMIN_TREND_PER_YEAR, y - ADMIN_BASE_YEAR)];

/** The share the admin booked runs over the admin priced, for a line and year. */
type Overrun = (seed: number, y: number, l: CoverageLine) => number;
const shippedOverrun: Overrun = adminOverrunFor;
function gradeBooked(games: Played[], trend: Trend, tag: string, overrun: Overrun = shippedOverrun) {
  let worst = 0, n = 0, booked = 0, outside = 0, lo = Infinity, hi = -Infinity;
  for (const g of games) for (const r of g.rows) for (const l of LINES) {
    const x = r.byLine[l]!;
    const billed = x.billedExposure ?? x.activeExposure;
    const priced = x.ratedExposure ?? billed;
    const [tf, te] = trend(r.yearNumber);
    const per100 = tf * adminFixedPerYear(l) / (priced * 10_000) + te * adminPerExposurePer100(l);
    const want = billed * per100 / expenseDivisor(effectiveRiskControlIncentivePct(x.decisions), l) * 10_000;
    n++;
    worst = Math.max(worst, Math.abs(x.adminExpense / want - 1));
    const share = overrun(g.seed, r.yearNumber, l);
    if (Math.abs(x.operatingExpense / (x.adminExpense * (1 + share)) - 1) > 1e-9) booked++;
    const actual = x.operatingExpense / x.adminExpense - 1;
    lo = Math.min(lo, actual); hi = Math.max(hi, actual);
    if (actual < ADMIN_OVERRUN_RANGE.min - 1e-12 || actual > ADMIN_OVERRUN_RANGE.max + 1e-12) outside++;
  }
  check(worst < 1e-9 && booked === 0 && outside === 0 && n > 0,
    `${tag}1. every line-year's admin priced is both parts trended ${(ADMIN_TREND_PER_YEAR * 100).toFixed(0)}% a year from the base year, and the engine books it x (1 + the year's drawn overrun, 0-2%)`,
    `${n} line-years (pre-game and played), priced worst off ${worst.toExponential(2)}; ${booked} booked otherwise; overruns ${(lo * 100).toFixed(3)}% to ${(hi * 100).toFixed(3)}%, ${outside} outside the range`);
}

console.log(`ADMIN TREND — scenarios ${SCENARIOS.join(', ')}, the pre-game and ${YEARS} played years, three lines`);
const games = SCENARIOS.map(play);
gradeBooked(games, shipped, '');
check(adminTrendFactor(ADMIN_BASE_YEAR) === 1 && Math.abs(adminTrendFactor(-5) - Math.pow(1.03, -6)) < 1e-15,
  '2. the factor is 1 at the base year (2027) and 1.03^-6 in 2021',
  `2021 ${adminTrendFactor(-5).toFixed(6)}, 2027 ${adminTrendFactor(1).toFixed(6)}, 2031 ${adminTrendFactor(5).toFixed(6)}`);

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('flat admin', () => gradeBooked(games, () => [1, 1], ''), '1.');
controlFails('a trend on the fixed part only', () => gradeBooked(games, y => [shipped(y)[0], 1], ''), '1.');
controlFails('a base year a year late', () => gradeBooked(games, y => shipped(y - 1), ''), '1.');
controlFails('admin booked with no overrun', () => gradeBooked(games, shipped, '', () => 0), '1.');
controlFails('an overrun drawn on another stream', () => gradeBooked(games, shipped, '',
  (seed, y, l) => ADMIN_OVERRUN_RANGE.max * deriveSubRng(seed, y, `admin_overrun_x_${l}`).next()), '1.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — admin trends 3% a year on both parts from 2027 as priced, and is booked with the year\'s drawn overrun.');
