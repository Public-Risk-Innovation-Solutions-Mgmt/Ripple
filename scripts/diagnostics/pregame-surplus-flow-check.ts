// ============================================================================
// THE PRE-GAME SURPLUS FLOWS — THE GATE.
//
//   npx tsx scripts/diagnostics/pregame-surplus-flow-check.ts
//
// A real pool's surplus moves only by its income, assessments and dividends.
// Across all six pre-game years (PRE_GAME_DEPTH) and into year 1, on every line and the pool,
// in solo ten-world games as the app plays them:
//
//   1. EACH YEAR MOVES BY ITS INCOME: year-end − year-start = net income, and
//      net income = underwriting (assessments and dividends inside it) +
//      investment income.
//   2. NO RESET BETWEEN YEARS: each pre-game year starts where the one before
//      it ended — the seam into the declared three included.
//   3. NO RESET AT THE OPENING: the opening surplus, and year 1's start in
//      every world, is the last pre-game year's year-end.
//   4. AT EXPECTED: every pre-game year funds at a margin of exactly 0 — the
//      prior board at Expected (restated for the fixed-seed scenarios; it was
//      one SOLVED margin, set on the scenario's designed history). The opening
//      is where the played history ends (3), never a target.
//   5. FROM THE STARTING CAPITAL: every line's first pre-game year begins at
//      STARTING_CAPITAL, paid in.
//
// ⚠ AND IT FAILS WITH EITHER RESET RESTORED. The checks are functions over a
// chain of years, and THE CONTROLS feed them the engine's own output with each
// reset put back: the retired forced opening — year-1 premium at Expected /
// the scenario's design target (the opening reset: the opening jumps off year
// 0's end) — and another scenario's earlier years spliced in front of this
// one's declared years (the reset before 2023 — the seam jumps). (Restated:
// both used a pre-game re-run at expected, which is now the game's own.)
// ============================================================================

import { openSoloInstance } from '../../src/utils/soloGame';
import { openingYear1Premium, PRE_GAME_DEPTH, runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { SCENARIO_PREMIUM_TO_SURPLUS, STARTING_CAPITAL } from '../../src/data/pricingParameters';
import { gameShocksOn } from '../../src/utils/shockLosses';
import type { CoverageLine, GameSetupSettings, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
// Four of the twenty scenarios, thinnest and richest among them.
const SEEDS = ['12', '16', '1', '7'];
// ⚠ THE FIVE PRE-GAME YEARS, STATED HERE — not read from the engine's depth, or
// a pre-game that lost a year would shorten the chain this checks along with it.
const PRE_GAME = PRE_GAME_DEPTH;
const PRE_GAME_YEARS_LIST = Array.from({ length: PRE_GAME }, (_, i) => i - (PRE_GAME - 1)).join();
const DOLLAR = 1;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

interface Year { yearNumber: number; begin: number; end: number; netIncome: number; uw: number; inv: number }
interface Chain {
  label: string;
  preGame: Year[];             // the pre-game years (PRE_GAME_DEPTH), oldest first
  year1: Year[];               // year 1 in every world
  opening: number;             // the opening surplus the game holds
  margins: number[];           // the margin each pre-game year funded at
  paidIn: number;              // what the first pre-game year must begin at
  // The start was floored at zero and even so the pre-game ended above the
  // opening — the one case allowed an opening reset (see runLinePreGame).
  floored: boolean;
}

const yearOf = (r: { yearNumber: number; beginingSurplus: number; endingSurplus: number; netIncome: number; underwritingIncome: number; investmentIncome: number }): Year => ({
  yearNumber: r.yearNumber, begin: r.beginingSurplus, end: r.endingSurplus,
  netIncome: r.netIncome, uw: r.underwritingIncome, inv: r.investmentIncome,
});

// ---------------------------------------------------------------- the checks
/** Worst miss of year-end against year-start + net income, and of net income against its parts. */
function flowMiss(c: Chain): number {
  return Math.max(...[...c.preGame, ...c.year1].map(y =>
    Math.max(Math.abs(y.end - y.begin - y.netIncome), Math.abs(y.netIncome - y.uw - y.inv))));
}
/** Worst jump between one pre-game year's end and the next one's start. */
function seamMiss(c: Chain): number {
  if (c.preGame.length !== PRE_GAME) return Infinity;
  return Math.max(...c.preGame.slice(1).map((y, i) => Math.abs(y.begin - c.preGame[i].end)));
}
/** Worst jump from the last pre-game year-end to the opening and to year 1's start in any world. */
function openingMiss(c: Chain): number {
  // A floored pool opens at the rule, not at its year-end: its reset is the
  // allowed one. Year 1 must still begin exactly where the pool opened.
  const ref = c.floored ? c.opening : c.preGame.at(-1)!.end;
  return Math.max(Math.abs(c.opening - ref), ...c.year1.map(y => Math.abs(y.begin - ref)));
}
const isFloored = (preGame: Year[], opening: number) =>
  preGame.length > 0 && preGame[0].begin === 0 && preGame.at(-1)!.end > opening + DOLLAR;
/** Largest margin over expected in any pre-game year — 0 at Expected; a chain with none is a miss. */
function marginSpread(c: Chain): number {
  if (c.margins.length === 0 || !c.margins.every(Number.isFinite)) return Infinity;
  return Math.max(...c.margins.map(Math.abs));
}

function grade(chains: Chain[], tag: string) {
  const worst = (f: (c: Chain) => number) => {
    let m = -1, at = '';
    for (const c of chains) { const v = f(c); if (v > m) { m = v; at = c.label; } }
    return { m, at };
  };
  const yrs = chains.every(c => c.preGame.length === PRE_GAME && c.preGame.map(y => y.yearNumber).join() === PRE_GAME_YEARS_LIST);
  check(yrs, `${tag}all ${PRE_GAME} pre-game years, ${-(PRE_GAME - 1)} to 0, on every chain`);
  const f = worst(flowMiss);
  check(f.m <= DOLLAR, `${tag}1. every year moves by its net income`, `worst $${f.m.toFixed(6)} (${f.at})`);
  const s = worst(seamMiss);
  check(s.m <= DOLLAR, `${tag}2. no reset between pre-game years`, `worst $${s.m.toFixed(6)} (${s.at})`);
  const o = worst(openingMiss);
  check(o.m <= DOLLAR, `${tag}3. no reset at the opening`, `worst $${o.m.toFixed(6)} (${o.at})`);
  const z = worst(c => (c.label.endsWith('pool') ? 0 : marginSpread(c)));
  check(z.m === 0, `${tag}4. every pre-game year funds at Expected — a margin of exactly 0`, `worst margin ${z.m.toExponential(2)} (${z.at})`);
  const p = worst(c => Math.abs((c.preGame[0]?.begin ?? Infinity) - c.paidIn));
  check(p.m <= 1e-6, `${tag}5. the pre-game begins at the starting capital`, `worst $${p.m.toExponential(2)} (${p.at})`);
}

// ---------------------------------------------------------------- the games
const chains: Chain[] = [];
const opensForced: Chain[] = [];
const seamRestored: Chain[] = [];
// Each scenario's line chains, for the splice control.
const byGame: Chain[][] = [];
for (const id of SEEDS) {
  const { setup, instance } = openSoloInstance({ poolName: 'S', gameLength: 1, startingYear: 2027, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const preGame: ResultSet[] = [...(earlyPreGameHistory ?? []), ...priorHistory];
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory });
  gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(1)), [])) };
  const worlds = gs.worlds ?? [];
  const lineChains = LINES.map(line => {
    const ls = poolState.lines[line];
    const c: Chain = {
      label: `${id} ${line}`,
      preGame: preGame.map(r => yearOf(r.byLine[line])),
      year1: worlds.map(w => yearOf(w.lockedResults[0].byLine[line])),
      opening: ls.surplus,
      margins: preGame.map(r => r.byLine[line]!.decisions.fundingCushion ?? NaN),
      paidIn: STARTING_CAPITAL[line],
      floored: false,
    };
    c.floored = isFloored(c.preGame, c.opening);
    // THE OPENING-RESET CONTROL — the retired forced opening: year-1 premium
    // at Expected / the scenario's design target.
    const forced = openingYear1Premium(instance, line, ls, preGame[preGame.length - 1].byLine[line], gameShocksOn(setup, instance))
      / SCENARIO_PREMIUM_TO_SURPLUS[line][Number(id)];
    opensForced.push({ ...c, label: `${c.label} forced`, opening: forced, floored: isFloored(c.preGame, forced) });
    return c;
  });
  byGame.push(lineChains);
  chains.push(...lineChains);
  chains.push({
    label: `${id} pool`,
    preGame: preGame.map(r => yearOf(r)),
    year1: worlds.map(w => yearOf(w.lockedResults[0])),
    opening: lineChains.reduce((a, c) => a + c.opening, 0),
    margins: [],
    paidIn: lineChains.reduce((a, c) => a + c.paidIn, 0),
    floored: lineChains.some(c => c.floored),
  });
}

// THE SEAM CONTROL — the next scenario's earlier years spliced in front of
// this one's declared years.
byGame.forEach((g, i) => g.forEach((c, k) => {
  const other = byGame[(i + 1) % byGame.length][k];
  seamRestored.push({ ...c, label: `${c.label} spliced`, preGame: [...other.preGame.slice(0, PRE_GAME - 3), ...c.preGame.slice(-3)] });
}));

console.log(`PRE-GAME SURPLUS FLOWS — ${SEEDS.length} solo games, ${LINES.join('/')} + pool, ${chains[0].year1.length} worlds, pre-game depth ${PRE_GAME_DEPTH}`);
grade(chains, '');
const flooredLines = chains.filter(c => c.floored && !c.label.endsWith('pool')).map(c => c.label);
console.log(`  floored at a zero start (an opening reset allowed): ${flooredLines.length ? flooredLines.join(', ') : 'none'}`);

// ---------------------------------------------------------------- controls
console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, broken: Chain[], expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  grade(broken, '');
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('the opening reset restored (the retired forced opening, premium / target)', opensForced, '3.');
controlFails('the reset before 2023 restored (seam spliced)', seamRestored, '2.');
controlFails('a dividend paid outside income', chains.map(c => ({ ...c, preGame: c.preGame.map((y, i) => i === 2 ? { ...y, end: y.end - 1e5 } : y) })), '1.');
controlFails('a margin changed in one pre-game year', chains.map(c => ({ ...c, margins: c.margins.map((m, i) => (i === 2 ? m + 0.01 : m)) })), '4.');
controlFails('the prior board at a uniform 1% margin', chains.map(c => ({ ...c, margins: c.margins.map(m => m + 0.01) })), '4.');
controlFails('a pre-game started from the old $15M', chains.map(c => ({ ...c, paidIn: c.paidIn * 3 })), '5.');
controlFails('a pre-game year missing', chains.map(c => ({ ...c, preGame: c.preGame.slice(1) })), 'all ');

// ---------------------------------------------------------------- verdict
console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — surplus moves only by income, assessments and dividends from the first pre-game year into year 1, at Expected, with no reset at the opening.');
