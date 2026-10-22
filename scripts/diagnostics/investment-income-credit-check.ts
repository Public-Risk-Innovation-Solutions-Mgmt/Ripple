// ============================================================================
// THE INVESTMENT INCOME CREDIT — A GATE.
//
//   npx tsx scripts/diagnostics/investment-income-credit-check.ts
//
// Single-player, three lines, at the defaults, the pre-game and five played
// years (100 worlds) on four scenarios:
//
//   1. THE CREDIT IS LAST YEAR'S RETURN: every line-year's rate — pre-game and
//      played — took off its pure premium the pool's realised return of the
//      year before it (its investment income over its invested assets, summed
//      over the lines), and the first pre-game year, with no year before it,
//      3% (INVESTMENT_INCOME_CREDIT.beforeHistory). The same on every line.
//   2. OFF THE PURE PREMIUM ONLY: every played year's struck rate, re-quoted at
//      no credit, has the same admin and the same reinsurance price, and the
//      rate differs by exactly pure premium x credit x CLF / divisor.
//   3. THE RATE CHARGED CARRIES IT: every played year's charged rate is the
//      struck rate, credit and all.
//
// ⚠ AND EACH FAILS WHEN BROKEN: the controls feed 1 a credit read off the year
// being priced instead of the year before, and a flat 3%; and 2 a credit also
// taken off admin.
// ============================================================================

import { INVESTMENT_INCOME_CREDIT } from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, strikeRates } from '../../src/utils/worlds';
import { gameHistory, poolReturnOf } from '../../src/utils/investmentIncomeCredit';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { quoteNewRateStack, type NewStackQuote } from '../../src/utils/linePricing';
import type { StruckLineRate } from '../../src/utils/simulationEngine';
import type { CoverageLine, GameSetupSettings, GameState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SCENARIOS = ['1', '7', '14', '20'];
const YEARS = 5;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

interface Game { history: ResultSet[]; shocks: boolean; struck: { year: number; byLine: Partial<Record<CoverageLine, StruckLineRate>> }[] }

function play(id: string): Game {
  const { setup, instance } = openSoloInstance({ poolName: 'C', gameLength: YEARS, startingYear: 2027, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
  const struck: Game['struck'] = [];
  for (let y = 1; y <= YEARS; y++) {
    struck.push({ year: y, byLine: strikeRates(gs, defaultDecisionSet(y)) });
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), LINES)), currentYearNumber: y + 1 };
  }
  return { history: gameHistory(gs), shocks: gameShocksOn(setup, instance), struck };
}

// What a year's credit should be, read off the history: the year before's pool return.
type Expect = (history: ResultSet[], y: number) => number;
const shipped: Expect = (h, y) => {
  const last = h.find(r => r.yearNumber === y - 1);
  return (last ? poolReturnOf(last) : null) ?? INVESTMENT_INCOME_CREDIT.beforeHistory;
};

function gradeCredit(games: Game[], expect: Expect, tag: string) {
  let worst = 0, n = 0, first = Infinity;
  const seen = new Set<string>();
  for (const g of games) for (const r of g.history) for (const l of LINES) {
    const got = r.byLine[l]?.investmentIncomeCredit;
    if (got === undefined) { worst = Infinity; continue; }
    n++;
    worst = Math.max(worst, Math.abs(got - expect(g.history, r.yearNumber) * INVESTMENT_INCOME_CREDIT.byLine[l]));
    if (r.yearNumber === g.history[0].yearNumber) first = Math.min(first, got);
    seen.add(got.toFixed(6));
  }
  check(worst < 1e-12 && n > 0,
    `${tag}1. every line-year's credit is the pool's return the year before (3% in the first pre-game year), the same on every line`,
    `${n} line-years, worst off ${worst.toExponential(2)}; first pre-game year ${(first * 100).toFixed(2)}%; ${seen.size} distinct credits`);
}

// The struck rate re-quoted at no credit: what the credit moved and what it left alone.
type Requote = (shocks: boolean, line: CoverageLine, y: number, s: StruckLineRate, credit: number) => NewStackQuote;
const requote: Requote = (shocks, line, y, s, credit) => quoteNewRateStack({
  line, yearNumber: y, members: { exposure: s.exposure, ...(s.bookRisk !== undefined ? { risk: s.bookRisk } : {}) }, exposure: s.exposure,
  groundUpPurePremiumPer100: s.newPp.purePremiumPer100, clf: s.quote.clf, riskControlPct: 1 - s.quote.divisor,
  layersPlaced: [], aggregateStopLevel: -1, reinsuranceOption: defaultDecisionSet(y).byLine[line].reinsuranceOption,
  investmentIncomeCredit: credit, shocks,
});

function gradePurePremiumOnly(games: Game[], adminCredited: boolean, tag: string) {
  let worst = 0, n = 0;
  for (const g of games) for (const { year, byLine } of g.struck) for (const l of LINES) {
    const s = byLine[l]!;
    const q = s.quote;
    // Re-quoted at its own credit it is the struck quote — so the re-quote is the engine's.
    const same = requote(g.shocks, l, year, s, q.investmentIncomeCredit);
    const none = requote(g.shocks, l, year, s, 0);
    const c = q.investmentIncomeCredit;
    // The designed difference: the credit off the pure premium, carried by the CLF and the divisor.
    const want = s.newPp.purePremiumPer100 * c * q.clf / q.divisor + (adminCredited ? q.adminRatePer100 * c / q.divisor : 0);
    n++;
    worst = Math.max(worst,
      Math.abs(none.adminRatePer100 - q.adminRatePer100),
      Math.abs(none.reinsRatePer100 - q.reinsRatePer100),
      Math.abs((none.finalRatePer100 - q.finalRatePer100) - want) / q.finalRatePer100,
      Math.abs(same.finalRatePer100 - q.finalRatePer100) / q.finalRatePer100);
  }
  check(worst < 1e-12 && n > 0,
    `${tag}2. off the pure premium only: admin and reinsurance unchanged, the rate lower by pure premium x credit x CLF / divisor`,
    `${n} struck line-years, worst ${worst.toExponential(2)}`);
}

function gradeCharged(games: Game[], tag: string) {
  let worst = 0, n = 0;
  for (const g of games) for (const { year, byLine } of g.struck) for (const l of LINES) {
    const row = g.history.find(r => r.yearNumber === year)!.byLine[l]!;
    n++;
    worst = Math.max(worst, Math.abs((row.finalRatePer100 ?? NaN) - byLine[l]!.quote.finalRatePer100),
      Math.abs((row.investmentIncomeCredit ?? NaN) - byLine[l]!.quote.investmentIncomeCredit));
  }
  check(worst < 1e-12 && n > 0, `${tag}3. every played year's charged rate is the struck rate, credit and all`,
    `${n} line-years, worst ${worst.toExponential(2)}`);
}

console.log(`THE INVESTMENT INCOME CREDIT — scenarios ${SCENARIOS.join(', ')}, ${YEARS} played years, three lines`);
const games = SCENARIOS.map(play);
gradeCredit(games, shipped, '');
gradePurePremiumOnly(games, false, '');
gradeCharged(games, '');
const sample = games[0].history.map(r => `${r.yearNumber}:${((r.byLine.WC?.investmentIncomeCredit ?? NaN) * 100).toFixed(2)}%`).join(' ');
console.log(`  scenario ${SCENARIOS[0]}, WC's credit by year: ${sample}`);

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('a credit read off the year being priced', () => gradeCredit(games, (h, y) => {
  const own = h.find(r => r.yearNumber === y);
  return (own ? poolReturnOf(own) : null) ?? INVESTMENT_INCOME_CREDIT.beforeHistory;
}, ''), '1.');
controlFails('a flat 3% credit', () => gradeCredit(games, () => INVESTMENT_INCOME_CREDIT.beforeHistory, ''), '1.');
controlFails('a credit also taken off admin', () => gradePurePremiumOnly(games, true, ''), '2.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log("PASS — every rate credits last year's return off its pure premium, and nothing else.");
