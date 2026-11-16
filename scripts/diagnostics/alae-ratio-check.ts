// ============================================================================
// ALAE THAT VARIES BY YEAR — A GATE.
//
//   npx tsx scripts/diagnostics/alae-ratio-check.ts
//
// Single-player, three lines, at the defaults, the pre-game and five played
// years (100 worlds) on three scenarios:
//
//   1. THE DRAW: every line-year's ALAE ratio — pre-game and played — lies in
//      its line's range (ALAE_RATIO_RANGE), is the draw on the GAME's seed on
//      its own stream (alaeRatioFor), and every world booked the same one.
//   2. THE BOOKING: the first pre-game year, its only accident year, books ALAE
//      at exactly its drawn ratio (ALAE / ULAE = ratio / 5%), and ULAE stays at
//      5% of claims.
//   3. THE PRICING: every rate's ALAE load — pre-game and played, every line —
//      is the line's PRICING_ALAE_LOAD, and that setting is the brief's
//      expected ratio, written out here: WC 11%, GL 15%, Property 3.5%.
//      RESTATED at wip/pricing-alae-load: it asserted the mean of the pricing
//      window's drawn ratios, the rule that change retired.
//   4. THE REPLAY: the same scenario played again draws, books and prices the
//      same ratios, line-year by line-year.
//
// ⚠ AND EACH FAILS WHEN BROKEN: the controls feed 1 a draw on a world's seed,
// 3 the old rule (the window's mean drawn ratio) and WC's load at 12%, and 4 a
// replay drawn on another stream.
// ============================================================================

import { ALAE_OF_LOSS_COST, ALAE_RATIO_RANGE, PRICING_ALAE_LOAD, PRICING_DATA_LAG_YEARS, PRICING_WINDOW_YEARS_NEW, ULAE_OF_LOSS_COST } from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, worldInstance } from '../../src/utils/worlds';
import { gameHistory } from '../../src/utils/gameHistory';
import { alaeRatioFor } from '../../src/utils/alaeRatio';
import { marketSeedOf } from '../../src/utils/bookUnits';
import { deriveSubRng } from '../../src/utils/random';
import type { CoverageLine, GameInstance, GameSetupSettings, GameState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SCENARIOS = ['1', '9', '17'];
const YEARS = 5;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

interface Game { instance: GameInstance; history: ResultSet[]; worldRatios: Record<CoverageLine, number[]> }

function play(id: string): Game {
  const { setup, instance } = openSoloInstance({ poolName: 'L', gameLength: YEARS, startingYear: 2027, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
  for (let y = 1; y <= YEARS; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), LINES)), currentYearNumber: y + 1 };
  }
  // Each world's own cohort for the last played year: the ratio it booked.
  const worldRatios = Object.fromEntries(LINES.map(l => [l, (gs.worlds ?? []).map(w =>
    w.poolState.lines[l]?.reserveCohorts?.find(c => c.yearNumber === YEARS)?.alaeRatio ?? NaN)])) as Game['worldRatios'];
  return { instance, history: gameHistory(gs), worldRatios };
}

type Draw = (g: Game, y: number, l: CoverageLine) => number;
const shipped: Draw = (g, y, l) => alaeRatioFor(marketSeedOf(g.instance), y, l);

function gradeDraw(games: Game[], draw: Draw, tag: string) {
  let n = 0, off = 0, outside = 0, worldsOff = 0, worlds = 0;
  for (const g of games) for (const r of g.history) for (const l of LINES) {
    const got = r.byLine[l]?.alaeRatio;
    n++;
    if (got === undefined || got < ALAE_RATIO_RANGE[l].min || got > ALAE_RATIO_RANGE[l].max) outside++;
    if (got !== draw(g, r.yearNumber, l)) off++;
  }
  for (const g of games) for (const l of LINES) for (const x of g.worldRatios[l]) {
    worlds++;
    if (x !== draw(g, YEARS, l)) worldsOff++;
  }
  check(n > 0 && off === 0 && outside === 0 && worlds > 0 && worldsOff === 0,
    `${tag}1. every line-year's ALAE ratio is in its range, the draw on the game's seed, and the same in every world`,
    `${n} line-years, ${off} off the draw, ${outside} outside the range; ${worlds} world cohorts, ${worldsOff} off`);
}

function gradeBooking(games: Game[]) {
  let worst = 0, n = 0;
  for (const g of games) for (const l of LINES) {
    const first = g.history[0].byLine[l]!;
    n++;
    worst = Math.max(worst, Math.abs((first.alaeIncurred / first.ulaeIncurred) / (first.alaeRatio! / ULAE_OF_LOSS_COST[l]) - 1));
  }
  check(worst < 1e-12 && n > 0, '2. the first pre-game year books ALAE at exactly its drawn ratio, beside ULAE at 5%',
    `${n} line-openings, worst off ${worst.toExponential(2)}`);
}

// What a year's ALAE load should be: the line's expected ratio, every year,
// written out from the brief rather than read from the parameter.
type Load = (g: Game, y: number, l: CoverageLine) => number;
const BRIEFED_LOAD: Record<CoverageLine, number> = { WC: 0.11, GL: 0.15, Property: 0.035 };
const expectedLoad: Load = (_g, _y, l) => BRIEFED_LOAD[l];
// The rule it replaced, kept as a control: the window years' drawn ratios averaged.
const windowLoad: Load = (g, y, l) => {
  const latest = y - 1 - PRICING_DATA_LAG_YEARS;
  const ays = g.history.map(r => r.yearNumber).filter(a => a <= latest).slice(-PRICING_WINDOW_YEARS_NEW);
  if (ays.length === 0) return ALAE_OF_LOSS_COST[l];
  return ays.reduce((s, a) => s + g.history.find(r => r.yearNumber === a)!.byLine[l]!.alaeRatio!, 0) / ays.length;
};

function gradePricing(games: Game[], load: Load, tag: string) {
  let worst = 0, n = 0, preGame = 0;
  for (const g of games) for (const r of g.history) for (const l of LINES) {
    const got = r.byLine[l]?.pricingAlaeRatio;
    if (got === undefined) { worst = Infinity; continue; }
    n++;
    if (r.yearNumber <= 0) preGame++;
    worst = Math.max(worst, Math.abs(got - load(g, r.yearNumber, l)));
  }
  const setting = Math.max(...LINES.map(l => Math.abs(PRICING_ALAE_LOAD[l] - BRIEFED_LOAD[l])));
  check(worst < 1e-12 && setting < 1e-12 && n > 0,
    `${tag}3. every rate's ALAE load is the line's PRICING_ALAE_LOAD (WC 11%, GL 15%, Property 3.5%), every year, pre-game and played`,
    `${n} line-years (${preGame} pre-game), worst off ${worst.toExponential(2)}; the setting off the brief by ${setting.toExponential(2)}`);
}

function gradeReplay(a: Game[], b: Game[], tag: string) {
  let n = 0, off = 0;
  a.forEach((g, i) => g.history.forEach((r, j) => LINES.forEach(l => {
    const x = r.byLine[l]!, z = b[i].history[j].byLine[l]!;
    n++;
    if (x.alaeRatio !== z.alaeRatio || x.pricingAlaeRatio !== z.pricingAlaeRatio || x.alaeIncurred !== z.alaeIncurred) off++;
  })));
  check(n > 0 && off === 0, `${tag}4. a replay draws, books and prices the same ALAE, line-year by line-year`, `${n} line-years, ${off} differ`);
}

console.log(`ALAE BY YEAR — scenarios ${SCENARIOS.join(', ')}, the pre-game and ${YEARS} played years, three lines`);
const games = SCENARIOS.map(play);
const again = SCENARIOS.map(play);
gradeDraw(games, shipped, '');
gradeBooking(games);
gradePricing(games, expectedLoad, '');
gradeReplay(games, again, '');
const g0 = games[0];
console.log(`  scenario ${SCENARIOS[0]}, WC by year: ${g0.history.map(r => `${2027 + r.yearNumber - 1}:${(r.byLine.WC!.alaeRatio! * 100).toFixed(2)}%/${(r.byLine.WC!.pricingAlaeRatio! * 100).toFixed(2)}%`).join(' ')}  (drawn/priced)`);

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails("a draw on a world's seed", () => gradeDraw(games, (g, y, l) => alaeRatioFor(worldInstance(g.instance, 7).seed, y, l), ''), '1.');
controlFails('the old rule: the window\'s mean drawn ratio', () => gradePricing(games, windowLoad, ''), '3.');
controlFails('WC\'s load at 12%', () => gradePricing(games, (g, y, l) => (l === 'WC' ? 0.12 : expectedLoad(g, y, l)), ''), '3.');
controlFails('a replay drawn on another stream', () => gradeReplay(games, again.map(g => ({
  ...g, history: g.history.map(r => ({ ...r, byLine: Object.fromEntries(LINES.map(l => [l, {
    ...r.byLine[l]!, alaeRatio: ALAE_RATIO_RANGE[l].min + (ALAE_RATIO_RANGE[l].max - ALAE_RATIO_RANGE[l].min)
      * deriveSubRng(marketSeedOf(g.instance), r.yearNumber, `alae_other_${l}`).next(),
  }])) })) as ResultSet[],
})), ''), '4.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — ALAE drawn by year on the game seed, booked at its draw, priced at the fixed expected load, and replayed identically.');
