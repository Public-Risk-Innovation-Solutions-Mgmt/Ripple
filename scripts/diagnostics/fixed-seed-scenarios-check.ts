// ============================================================================
// FIXED-SEED SCENARIOS — each scenario plays its one fixed seed, nothing fits
// its opening at run time, and the opening is the same in every mode.
//
//   npx tsx scripts/diagnostics/fixed-seed-scenarios-check.ts
//
// THE CLAIMS (wip/fixed-seed-scenarios):
//
//   1. THE MAPPING: twenty distinct seeds (SCENARIO_SEEDS), one per scenario;
//      Scenario N's instance — built as single player, Test player and a hosted
//      room build it — has the seed's own text as its id, that text's hash as
//      its seed, and N as `scenario`; a harness's bare id carries no scenario.
//   2. NOTHING FITS THE OPENING: on every scenario and line the prior board
//      funds every pre-game year at Expected (a margin of exactly 0), and the
//      opening surplus IS the played pre-game's last year-end — a single run
//      from STARTING_CAPITAL on the scenario's own seed reproduces it to the
//      bit. And the retired machinery is gone from the engine's source: no
//      margin solve, floor, guardrail, designed run, forced opening, scenario
//      multiple, shifted-seed re-draw or fallback scenario mapping, and no game
//      code reads the design targets (SCENARIO_PREMIUM_TO_SURPLUS).
//   3. DETERMINISM: each scenario's OPENING POOL (every balance, reserve and
//      cohort) is byte-identical run to run and across single player, Test
//      player and a hosted room, whatever the shock switch; and its WHOLE
//      PRE-GAME RECORD (the six years as the statements show them) is
//      identical across the three at the same switch — all three with shocks
//      on (a room with a schedule), and all three with shocks off (single
//      player's SOLO_SHOCKS off, a room with none). The record differs between
//      the switches by design: with shocks on Property's required capital
//      carries its catastrophe capital (catCapitalNeeded).
//
// THE CONTROLS, each must fail: 1 — a hosted room built on the scenario
// number's own hash (the old mapping); 2 — a pre-game at a 1% margin, an
// opening forced to premium / target, and a retired name put back into the
// scanned source; 3 — a neighbouring scenario's opening standing in for the
// hosted one.
// ============================================================================
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SCENARIO_COUNT, SCENARIO_PREMIUM_TO_SURPLUS, SCENARIO_SEEDS, SOLO_SHOCKS, STARTING_CAPITAL } from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { openingYear1Premium, runPriorHistory, simulateLineCandidate } from '../../src/utils/priorHistoryEngine';
import { buildTeamGame } from '../../src/session/client/buildGame';
import { generateGameInstance, scenarioInstance } from '../../src/utils/instanceGenerator';
import { seedFromInstanceId } from '../../src/seedHash';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { openWorlds } from '../../src/utils/worlds';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, GameInstance, GameSetupSettings, GameState, PoolState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SCENARIOS = Array.from({ length: SCENARIO_COUNT }, (_, i) => i + 1);
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const settings = (id: string): GameSetupSettings =>
  ({ poolName: 'S', gameLength: 5, startingYear: 2027, instanceId: id, activeLines: LINES } as GameSetupSettings);

// ---------------------------------------------------------------- the openings
interface Opened { instance: GameInstance; shocks: boolean; poolState: PoolState; priorHistory: ResultSet[]; earlyPreGameHistory?: ResultSet[] }
const recordOf = (o: Opened) => hash({ p: o.priorHistory, e: o.earlyPreGameHistory, s: o.poolState });
const poolOf = (o: Opened) => hash(o.poolState);
function solo(id: string, test: boolean): Opened & { setup: GameSetupSettings } {
  const { setup, instance } = test ? openSoloInstance(settings(id), { schedule: [] }) : openSoloInstance(settings(id));
  const pre = runPriorHistory(instance, setup);
  // As App opens it: the worlds on the pre-game's position.
  const gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState: pre.poolState,
    lockedResults: [], currentDecisions: defaultDecisionSet(1, gameShocksOn(setup, instance)), priorHistory: pre.priorHistory,
    earlyPreGameHistory: pre.earlyPreGameHistory } as GameState);
  return { setup, instance, shocks: gameShocksOn(setup, instance), poolState: gs.poolState, priorHistory: gs.priorHistory, earlyPreGameHistory: gs.earlyPreGameHistory };
}
// A room with shocks scheduled (one event in year 3), or with none.
function hosted(seed: string, shocks: boolean): Opened {
  const schedule = shocks ? [{ shockId: '#2', yearNumber: 3 }] : [];
  const gs = buildTeamGame({ seed, yearCount: 5, startingYear: 2027, eventName: 'E', poolName: 'S', shocks: schedule, priorDevelopment: undefined } as never, LINES).gameState;
  return { instance: gs.instance, shocks: gameShocksOn(gs.setup, gs.instance), poolState: gs.poolState, priorHistory: gs.priorHistory, earlyPreGameHistory: gs.earlyPreGameHistory };
}
// Each scenario built four ways with shocks on, and three with them off.
const runs = SCENARIOS.map(n => {
  const id = String(n);
  const on = { single: solo(id, false), again: solo(id, false), test: solo(id, true), hosted: hosted(id, true) };
  SOLO_SHOCKS.enabled = false;
  try {
    const off = { single: solo(id, false), test: solo(id, true), hosted: hosted(id, false) };
    return { n, ...on, off };
  } finally { SOLO_SHOCKS.enabled = true; }
});

// ---------------------------------------------------------------- 1
function gradeMapping(built: Record<number, { single: GameInstance; test: GameInstance; hosted: GameInstance }>, tag: string) {
  const seeds = SCENARIOS.map(n => SCENARIO_SEEDS[n]);
  const distinct = new Set(seeds).size === SCENARIO_COUNT && seeds.every(s => Number.isInteger(s) && s > 0);
  let wrong = 0;
  for (const n of SCENARIOS) for (const inst of Object.values(built[n])) {
    const gameId = String(SCENARIO_SEEDS[n]);
    if (inst.instanceId !== gameId || inst.seed !== seedFromInstanceId(gameId) || inst.scenario !== n) wrong++;
  }
  const bare = scenarioInstance('MAMC6EA4');
  const bareOk = bare.scenario === undefined && bare.instanceId === 'MAMC6EA4' && bare.seed === seedFromInstanceId('MAMC6EA4');
  check(distinct && wrong === 0 && bareOk,
    `${tag}1. every scenario plays its fixed seed — single player, Test player and hosted alike; a bare id carries no scenario`,
    `${new Set(seeds).size} distinct seeds; ${SCENARIOS.length * 3 - wrong} of ${SCENARIOS.length * 3} instances on their seed; bare id scenario ${bare.scenario}`);
}

// ---------------------------------------------------------------- 2
const RETIRED: [string, RegExp][] = [
  ['the margin solve', /solvePreGameMargin/],
  ['its floor', /PRE_GAME_MARGIN_FLOOR/],
  ['the guardrails', /OPENING_PREMIUM_TO_SURPLUS_BOUNDS/],
  ['the designed run', /PRE_GAME_MARGIN_ON_DESIGN|'designed'/],
  ['the forced opening', /surplusOf/],
  ['the history scaling', /preGameLossMultiplier|preGameLossFactor|PRE_GAME_EXPERIENCE_(BASE|WEIGHT)/],
  ['the shifted-seed re-draw', /attempt \* 997|pregameAttempt|historyAttempt/],
  ['the fallback scenario mapping', /scenarioOfId|scenarioOf\b/],
];
// Code only: comments may name what was retired.
const codeOf = (file: string) => fs.readFileSync(file, 'utf8').split('\n')
  .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\/\/.*$/, '')).join('\n');
const srcFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? srcFiles(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []);
const sources = Object.fromEntries(srcFiles(SRC).map(f => [path.relative(SRC, f), codeOf(f)]));
interface Fit { cushions: number[]; opened: number; replay: number }
function gradeNoFit(fits: Fit[], src: Record<string, string>, tag: string) {
  const offMargin = fits.filter(f => f.cushions.some(c => c !== 0)).length;
  const offOpening = fits.filter(f => f.opened !== f.replay).length;
  const found = RETIRED.flatMap(([name, re]) => Object.entries(src).filter(([, code]) => re.test(code)).map(([f]) => `${name} in ${f}`));
  const targetReaders = Object.entries(src).filter(([f, code]) => f !== path.join('data', 'pricingParameters.ts') && /SCENARIO_PREMIUM_TO_SURPLUS|SCENARIO_RATIO_RANGE/.test(code)).map(([f]) => f);
  check(offMargin === 0 && offOpening === 0 && found.length === 0 && targetReaders.length === 0,
    `${tag}2. nothing fits the opening: the prior board funds at Expected, the opening is the played year-end, the retired machinery is gone and no game code reads the targets`,
    `${fits.length} line-scenarios: ${offMargin} with a margin, ${offOpening} off a single replay; retired names found: ${found.length ? found.join(', ') : 'none'}; target readers: ${targetReaders.length ? targetReaders.join(', ') : 'none'}`);
}
const fitsOf = (margin = 0, forced = false): Fit[] => runs.flatMap(r => LINES.map(l => {
  const rows = [...(r.single.earlyPreGameHistory ?? []), ...r.single.priorHistory].map(x => x.byLine[l]!);
  const replay = simulateLineCandidate(r.single.instance, r.single.setup, l, STARTING_CAPITAL[l]).poolState.lines[l].surplus;
  const opened = r.single.poolState.lines[l].surplus;
  const premium = openingYear1Premium(r.single.instance, l, r.single.poolState.lines[l], rows[rows.length - 1], gameShocksOn(r.single.setup, r.single.instance));
  return {
    cushions: rows.map(x => (x.decisions?.fundingCushion ?? NaN) + margin),
    opened: forced ? premium / SCENARIO_PREMIUM_TO_SURPLUS[l][r.n] : opened, replay,
  };
}));

// ---------------------------------------------------------------- 3
function gradeDeterminism(rs: typeof runs, tag: string) {
  let pool = 0, on = 0, off = 0;
  for (const r of rs) {
    const all = [r.single, r.again, r.test, r.hosted, r.off.single, r.off.test, r.off.hosted];
    if (all.some(x => poolOf(x) !== poolOf(r.single))) pool++;
    if ([r.again, r.test, r.hosted].some(x => recordOf(x) !== recordOf(r.single))) on++;
    if ([r.off.test, r.off.hosted].some(x => recordOf(x) !== recordOf(r.off.single))) off++;
  }
  // The builds compared really are at the switch they are labelled with.
  const switched = rs.filter(r => [r.single, r.again, r.test, r.hosted].every(x => x.shocks)
    && [r.off.single, r.off.test, r.off.hosted].every(x => !x.shocks)).length;
  check(pool === 0 && on === 0 && off === 0 && switched === rs.length,
    `${tag}3. each scenario's opening pool is byte-identical run to run and across single player, Test player and hosted, and so is its whole pre-game record at the same shock switch`,
    `opening pool: ${rs.length - pool} of ${rs.length} identical across seven builds; pre-game record, shocks on: ${rs.length - on} of ${rs.length} across four builds; shocks off: ${rs.length - off} of ${rs.length} across three`);
}

console.log('FIXED-SEED SCENARIOS');
const built = Object.fromEntries(runs.map(r => [r.n, { single: r.single.instance, test: r.test.instance, hosted: r.hosted.instance }]));
gradeMapping(built, '');
gradeNoFit(fitsOf(), sources, '');
gradeDeterminism(runs, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('a hosted room built on the scenario number\'s own hash (the old mapping)', () => gradeMapping(
  { ...built, 7: { ...built[7], hosted: generateGameInstance('7', seedFromInstanceId('7')) } }, ''), '1.');
controlFails('a pre-game at a 1% margin', () => gradeNoFit(fitsOf(0.01), sources, ''), '2.');
controlFails('an opening forced to premium / target', () => gradeNoFit(fitsOf(0, true), sources, ''), '2.');
controlFails('the margin solve put back into the engine', () => gradeNoFit(fitsOf(), {
  ...sources, [path.join('utils', 'priorHistoryEngine.ts')]: sources[path.join('utils', 'priorHistoryEngine.ts')] + '\nsolvePreGameMargin(run, line);' }, ''), '2.');
controlFails('a neighbouring scenario standing in for the hosted opening', () => gradeDeterminism(
  runs.map((r, i) => (i === 6 ? { ...r, hosted: runs[7].hosted } : r)), ''), '3.');
controlFails('a room with shocks off standing in for one with them on', () => gradeDeterminism(
  runs.map(r => ({ ...r, hosted: r.off.hosted })), ''), '3.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — every scenario plays its fixed seed, nothing fits its opening, and the opening is the same run to run and in every mode.');
