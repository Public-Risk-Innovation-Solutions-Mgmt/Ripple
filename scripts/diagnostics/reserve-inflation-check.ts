// ============================================================================
// RESERVE INFLATION — A GATE. It replaces adverse-rate-placeholder-check, which
// held YEARLY_ADVERSE_RATE at 0 and read by nothing until the rate was wired;
// this is that wiring (RESERVE_INFLATION_PER_YEAR).
//
//   npx tsx scripts/diagnostics/reserve-inflation-check.ts
//
// Single-player, three lines, one world, the pre-game and six played years on
// two scenarios, at the default decisions:
//
//   1. BOOKED ON THE START-OF-YEAR OUTSTANDING: every line-year's reserve
//      inflation is the line's rate x the gross outstanding, at the START of
//      the year, of every open accident year — before the year's payments.
//   2. INCURRED CARRIES IT, PAYMENTS FOLLOW: the same year played from the
//      same books with the rate at 0 has less adverse prior-year development,
//      and pays no more — and with the rate on, no more than the inflation
//      booked on top. Paid-to-date is never restated; the forward-booking
//      true-up pays the pattern's share of the higher ultimate in the year it
//      emerges, as it does the host's development.
//   3. PRICED FOR THE FIRST YEARS — WC 2, GL 1, PROPERTY 2: reserveInflationToCome
//      is the product over run-off years age..the line's
//      RESERVE_INFLATION_PRICED_YEARS of (1 + rate x unpaid
//      share), 1 past them; every window year of every priced rate carries its
//      age's factor and its loss cost is developed x factor / exposure; and a
//      rate with no history carries the full factor.
//   4. PROFIT AND CONTINGENCY PER LINE — WC 2%, GL 0%, PROPERTY 0%: the expense
//      divisor is 1 - risk control - the line's own. (Per line WC 3% / GL and
//      Property 0% for one commit, then 5% on every line, which made every line
//      too rich once the investment income credit was gone.)
//
// ⚠ AND EACH FAILS WHEN BROKEN: the controls feed 1 the END-of-year base
// (after the paydown), 2 a year whose payments fell, 3 a factor that runs to
// the end of the pattern and GL priced for 2 years, and 4 the 5% on every line.
//
// ⚠ RESTATED FOR wip/adverse-development: reserve inflation is OFF as shipped
// (RESERVE_INFLATION.enabled false, RESERVE_INFLATION_PER_YEAR 0 on every
// line) — adverse development by level (ADVERSE_DEVELOPMENT) replaces it, and
// pricing anticipates neither. As shipped, 1 booked $0 on every line-year and
// so failed its own "something was booked", and the two controls on 3 could
// no longer fail, because every factor they substitute is 1 at a rate of 0.
// So this gate now does both, the way aggregate-stop-check does for its
// dormant stop:
//
//   0. THE DORMANCY, as shipped: the switch off and every line's rate 0
//      (written out here, not read from the parameter); every played
//      line-year books exactly $0 of reserve inflation; reserveInflationToCome
//      is exactly 1 at every age, every priced window point carries exactly 1
//      and a rate with no history carries exactly 1 — nothing booked, nothing
//      priced. (Adverse development, which replaced it, is held by
//      adverse-development-check; its total is printed here for reference.)
//
// and then SWITCHES RESERVE INFLATION ON INSIDE ITS OWN PROCESS — the switch
// and the rate at the severity trend, what the parameter's "on" restores — and
// grades 1-4 on the dormant code, with adverse development running beside it
// as shipped, so it stays correct for the day it is switched back on. Safe
// only because every gate runs in its own process; restored before exit.
// 0's CONTROLS grade the dormancy on the games played with the switch on,
// which must fail — once as switched on, and once with the switch and rates
// read back off, so the booked-dollars count alone must catch it.
// ============================================================================

import {
  PROFIT_AND_CONTINGENCY_OF_RATE, RESERVE_INFLATION, RESERVE_INFLATION_PER_YEAR, RESERVE_INFLATION_PRICED_YEARS,
  SEVERITY_TREND_PER_YEAR,
} from '../../src/data/pricingParameters';
import { LINE_PAYOUT_PATTERN } from '../../src/data/defaultAssumptions';
import { unpaidShare, conditionalPaydown } from '../../src/utils/payoutPattern';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import { bookPurePremium, reserveInflationToCome } from '../../src/utils/newPurePremium';
import { expenseDivisor } from '../../src/utils/linePricing';
import { developmentBaseOf } from '../../src/utils/hostDevelopment';
import type { CoverageLine, GameSetupSettings, GameState, LineResultSet, ReserveCohort } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SCENARIOS = ['4', '15'];
const YEARS = 6;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));

interface Year { y: number; line: CoverageLine; open: ReserveCohort[]; row: LineResultSet; zero: LineResultSet }
interface Game { years: Year[]; priced: { line: CoverageLine; y: number; gs: GameState; exposure: number; risk: number }[] }

const rate = RESERVE_INFLATION_PER_YEAR as Record<CoverageLine, number>;
function play(id: string): Game {
  const { setup, instance } = openSoloInstance({ poolName: 'R', gameLength: YEARS, startingYear: 2027, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = { setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState;
  const game: Game = { years: [], priced: [] };
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    // The same year from the same books, with the rate at 0.
    const saved = { ...rate };
    for (const l of LINES) rate[l] = 0;
    const z = processYear(gs, defaultDecisionSet(y));
    Object.assign(rate, saved);
    for (const l of LINES) {
      game.years.push({ y, line: l, open: (gs.poolState.lines[l].reserveCohorts ?? []).filter(c => !c.closed),
        row: p.result.byLine[l]!, zero: z.result.byLine[l]! });
      const r = p.result.byLine[l]!;
      game.priced.push({ line: l, y, gs, exposure: r.rateBasis?.pricedExposure ?? r.activeExposure, risk: r.rateBasis?.risk ?? 1 });
    }
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return game;
}

// ---------------------------------------------------------------- 1
type Base = (c: ReserveCohort, line: CoverageLine) => number;
const startBase: Base = c => developmentBaseOf(c);
function gradeBooked(games: Game[], base: Base, tag: string) {
  let worst = 0, n = 0, total = 0, where = '';
  for (const g of games) for (const x of g.years) {
    const want = x.open.reduce((a, c) => a + rate[x.line] * base(c, x.line), 0);
    const got = x.row.newLossEngine?.reserveInflation ?? NaN;
    n++; total += got;
    const off = rel(got, want);
    if (!(off <= worst)) { worst = off; where = `${x.line} year ${x.y}: ${got.toFixed(2)} vs ${want.toFixed(2)}`; }
  }
  check(worst < 1e-9 && n > 0 && total > 0,
    `${tag}1. every line-year's reserve inflation is the rate x the open years' gross outstanding at the start of the year`,
    `${n} line-years, $${(total / 1e6).toFixed(1)}M booked, worst ${worst.toExponential(2)}${worst >= 1e-9 ? ` (${where})` : ''}`);
}

// ---------------------------------------------------------------- 2
function gradePaid(games: Game[], tag: string, shift = 0) {
  let inBounds = 0, adverse = 0, n = 0, extraPaid = 0, booked = 0;
  for (const g of games) for (const x of g.years) {
    n++;
    const extra = x.row.netPaidLosses + shift - x.zero.netPaidLosses;
    const inflation = x.row.newLossEngine!.reserveInflation;
    extraPaid += extra; booked += inflation;
    if (extra >= -1e-6 && extra <= inflation + 1e-6) inBounds++;
    if (inflation > 0 && x.row.priorYearDevelopment < x.zero.priorYearDevelopment) adverse++;
  }
  const withInflation = games.reduce((a, g) => a + g.years.filter(x => x.row.newLossEngine!.reserveInflation > 0).length, 0);
  check(inBounds === n && adverse === withInflation && n > 0,
    `${tag}2. against the rate at 0 the year's prior-year development is more adverse, and it pays no less and no more than the inflation booked`,
    `${n} line-years; more adverse in ${adverse} of ${withInflation} with inflation; payments within bounds in ${inBounds} of ${n} `
    + `($${(extraPaid / 1e6).toFixed(1)}M more paid of $${(booked / 1e6).toFixed(1)}M booked)`);
}

// ---------------------------------------------------------------- 3
type ToCome = (line: CoverageLine, age: number) => number;
const byDefinition: ToCome = (line, age) => {
  let f = 1;
  // The briefed years, written out rather than read from the parameter.
  const years: Record<CoverageLine, number> = { WC: 2, GL: 1, Property: 2 };
  for (let j = Math.max(1, age); j <= years[line]; j++) f *= 1 + rate[line] * unpaidShare(LINE_PAYOUT_PATTERN[line], j);
  return f;
};
function gradePriced(games: Game[], toCome: ToCome, tag: string) {
  let worst = 0, points = 0, noHistory = 0;
  for (const l of LINES) for (let age = 1; age <= 12; age++) worst = Math.max(worst, rel(reserveInflationToCome(l, age), toCome(l, age)));
  for (const g of games) for (const p of g.priced) {
    const ledger = p.gs.poolState.lines[p.line].reserveDevelopment ?? [];
    const pp = bookPurePremium(p.line, p.y, { rows: ledger, allMarketMembers: p.gs.poolState.allMarketMembers, membershipHistory: p.gs.poolState.membershipHistory }, p.exposure, p.risk);
    for (const pt of pp.points) {
      points++;
      worst = Math.max(worst, rel(pt.reserveInflation, toCome(p.line, pt.ageMonths / 12)),
        rel(pt.lossCostPer100, pt.developed * pt.reserveInflation / (pt.exposure * 10_000)));
    }
    if (pp.points.length === 0) { noHistory++; worst = Math.max(worst, rel(pp.reserveInflation ?? NaN, toCome(p.line, 1))); }
  }
  // A book with no ledger at all: the expectation, carrying the full factor.
  for (const l of LINES) {
    const pp = bookPurePremium(l, 1, { rows: [], allMarketMembers: [], membershipHistory: {} }, 1000, 1);
    noHistory++;
    worst = Math.max(worst, rel(pp.reserveInflation ?? NaN, toCome(l, 1)));
  }
  const f = LINES.map(l => `${l} ${toCome(l, 1).toFixed(4)}`).join(', ');
  check(worst < 1e-12 && points > 0,
    `${tag}3. pricing carries the inflation still to come within the line's priced years (WC ${RESERVE_INFLATION_PRICED_YEARS.WC}, GL ${RESERVE_INFLATION_PRICED_YEARS.GL}, Property ${RESERVE_INFLATION_PRICED_YEARS.Property}): every window year at its age, a rate with no history in full`,
    `${points} window points, ${noHistory} no-history rates; full factor ${f}; worst ${worst.toExponential(2)}`);
}

// ---------------------------------------------------------------- 4
const BRIEFED_PC: Record<CoverageLine, number> = { WC: 0.02, GL: 0, Property: 0 };
function gradeContingency(divisor: (rc: number, line: CoverageLine) => number, tag: string) {
  let worst = 0;
  for (const l of LINES) for (const rc of [0, 0.02, 0.05]) worst = Math.max(worst, Math.abs(divisor(rc, l) - (1 - rc - BRIEFED_PC[l])));
  check(worst < 1e-15,
    `${tag}4. profit and contingency per line, WC 2%, GL 0%, Property 0%: the divisor is 1 - risk control - the line's own`,
    `${LINES.map(l => `${l} ${(PROFIT_AND_CONTINGENCY_OF_RATE[l] * 100).toFixed(1)}%`).join(', ')}; worst ${worst.toExponential(2)}`);
}

// ---------------------------------------------------------------- 0
// THE DORMANCY (wip/adverse-development): off, and nothing booked or priced.
function gradeDormancy(games: Game[], tag: string) {
  const off = !RESERVE_INFLATION.enabled && LINES.every(l => RESERVE_INFLATION_PER_YEAR[l] === 0);
  let lineYears = 0, booked = 0, adverse = 0, points = 0, unpriced = 0;
  for (const g of games) for (const x of g.years) {
    lineYears++;
    const n = x.row.newLossEngine;
    if (!n || n.reserveInflation !== 0) booked++;
    adverse += n?.adverseDevelopment ?? 0;
  }
  for (const l of LINES) for (let age = 1; age <= 12; age++) { points++; if (reserveInflationToCome(l, age) !== 1) unpriced++; }
  for (const g of games) for (const p of g.priced) {
    const ledger = p.gs.poolState.lines[p.line].reserveDevelopment ?? [];
    const pp = bookPurePremium(p.line, p.y, { rows: ledger, allMarketMembers: p.gs.poolState.allMarketMembers, membershipHistory: p.gs.poolState.membershipHistory }, p.exposure, p.risk);
    for (const pt of pp.points) { points++; if (pt.reserveInflation !== 1) unpriced++; }
    if (pp.points.length === 0) { points++; if (pp.reserveInflation !== 1) unpriced++; }
  }
  for (const l of LINES) {
    points++;
    if (bookPurePremium(l, 1, { rows: [], allMarketMembers: [], membershipHistory: {} }, 1000, 1).reserveInflation !== 1) unpriced++;
  }
  check(off && booked === 0 && unpriced === 0 && lineYears > 0,
    `${tag}0. reserve inflation is OFF as shipped: the switch off, every line's rate 0, nothing booked on any played line-year and nothing priced (every factor exactly 1)`,
    `RESERVE_INFLATION ${RESERVE_INFLATION.enabled ? 'ON' : 'off'}, rates ${LINES.map(l => `${l} ${RESERVE_INFLATION_PER_YEAR[l]}`).join(' / ')}; `
    + `${booked} of ${lineYears} line-years booked some; ${unpriced} of ${points} priced factors not 1; `
    + `adverse development booked in its place $${(adverse / 1e6).toFixed(1)}M (graded by adverse-development-check)`);
}

console.log(`RESERVE INFLATION — scenarios ${SCENARIOS.join(', ')}, the pre-game and ${YEARS} played years, three lines, one world`);
console.log('AS SHIPPED (wip/adverse-development): off');
const shipped = SCENARIOS.map(play);
gradeDormancy(shipped, '');

// SWITCHED ON INSIDE THIS PROCESS: the switch and the severity trend, what
// "on" restores. Restored at the foot.
const shippedRate = { ...rate };
RESERVE_INFLATION.enabled = true;
for (const l of LINES) rate[l] = SEVERITY_TREND_PER_YEAR[l];
console.log(`\nSWITCHED ON IN THIS PROCESS: rates ${LINES.map(l => `${l} ${rate[l]}`).join(' / ')}, adverse development running beside it as shipped`);
const games = SCENARIOS.map(play);
gradeBooked(games, startBase, '');
gradePaid(games, '');
gradePriced(games, byDefinition, '');
gradeContingency(expenseDivisor, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('the end-of-year base, after the paydown', () => gradeBooked(games,
  (c, l) => developmentBaseOf(c) * (1 - conditionalPaydown(LINE_PAYOUT_PATTERN[l], c.age + 2)), ''), '1.');
controlFails('a year whose payments fell', () => gradePaid(games, '', -1e6), '2.');
controlFails('a factor that runs to the end of the pattern', () => gradePriced(games, (l, age) => {
  let f = 1;
  for (let j = Math.max(1, age); j <= 60; j++) f *= 1 + rate[l] * unpaidShare(LINE_PAYOUT_PATTERN[l], j);
  return f;
}, ''), '3.');
controlFails('GL priced for 2 years', () => gradePriced(games, (l, age) => {
  let f = 1;
  for (let j = Math.max(1, age); j <= (l === 'GL' ? 2 : RESERVE_INFLATION_PRICED_YEARS[l]); j++) f *= 1 + rate[l] * unpaidShare(LINE_PAYOUT_PATTERN[l], j);
  return f;
}, ''), '3.');
controlFails('the 5% on every line', () => gradeContingency(rc => 1 - rc - 0.05, ''), '4.');
// 0's control: the dormancy graded while the switch is on, on the games it played.
controlFails('reserve inflation switched on, booked and priced', () => gradeDormancy(games, ''), '0.');
// And the booking alone: the switch read off and the rates 0, but the games
// are the ones that booked inflation — the line-year count must catch it.
controlFails('inflation booked on the played years, the switch and rates read off', () => {
  RESERVE_INFLATION.enabled = false;
  for (const l of LINES) rate[l] = 0;
  try { gradeDormancy(games, ''); } finally {
    RESERVE_INFLATION.enabled = true;
    for (const l of LINES) rate[l] = SEVERITY_TREND_PER_YEAR[l];
  }
}, '0.');

// Restore the shipped switch.
RESERVE_INFLATION.enabled = false;
Object.assign(rate, shippedRate);

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — reserve inflation is off as shipped, nothing booked or priced; switched on, open years inflate on the start-of-year outstanding, booked as development, and pricing carries WC 2, GL 1 and Property 2 years of it; contingency WC 2%, GL 0%, Property 0%.');
