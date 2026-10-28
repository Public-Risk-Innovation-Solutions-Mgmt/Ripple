// ============================================================================
// THE YEAR WALKTHROUGH (utils/yearWalkthrough) — its codes, its figures and
// its seed rule.
//
//   npx tsx scripts/diagnostics/year-walkthrough-check.ts
//
// Each section is a function returning its problems; each has a CONTROL that
// breaks the thing it guards, asserts the section FAILS, and restores it.
//
// 1. SAME GAME, SAME CODES. Two games played apart, on the same setup with the
//    same decisions, give identical draws and identical codes at every block,
//    every year, every view — the year code and the decisions code too.
// 2. ONE DECISION, ONLY ITS STEPS. The same game with one decision changed —
//    the asset mix in the last year — keeps every draw and steps 1 to 9 and
//    every earlier year exactly, and moves steps 10 and 11, the decisions code
//    and the year code.
// 3. THE FIGURES ARE THE ENGINE'S. Every draw read off a stream is the one the
//    engine booked (each world's year factor, market and investment income;
//    the admin overrun on the row); step 1 is the recorded expected; step 6's
//    accident years sum to the recorded development; premium is rate x
//    exposure; surplus opens, earns and ends as recorded.
// 4. THE SEED RULE. A single-player game and a hosted team's give a header with
//    the version and no seed, and their downloads — the Results workbook with
//    its walkthrough sheet, the claims workbook, the Annual Statement — hold no
//    "Seed" and no cell equal to the seed. A Test player game's header and
//    sheet carry it.
// 5. ONE SEED AND ONE VERSION across Test player, the host's header and a
//    team's game, for the same scenario: its fixed seed and the save key.
// ============================================================================

import * as XLSX from 'xlsx';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, worldInstance } from '../../src/utils/worlds';
import { buildTeamGame } from '../../src/session/client/buildGame';
import { gameIdentity } from '../../src/utils/scenarios';
import { SAVE_KEY } from '../../src/utils/gameSave';
import { SCENARIO_SEEDS } from '../../src/data/pricingParameters';
import { drawOrdinaryFactor, ordinaryLossRng, ordinaryYearCv } from '../../src/utils/ordinaryLoss';
import { simulateMarketReturns, blendInvestmentReturn } from '../../src/utils/investmentEngine';
import { deriveSubRng } from '../../src/utils/random';
import { applyMarketShock, resolveShockYear, shockTimingOf } from '../../src/utils/shockLosses';
import { buildResultsWorkbook } from '../../src/utils/resultsExport';
import { RESULT_METRICS } from '../../src/utils/resultMetrics';
import { buildClaimsWorkbook } from '../../src/utils/claimsExport';
import { buildAnnualStatementXlsx } from '../../src/utils/annualStatementExport';
import {
  buildYearWalkthroughs, walkthroughHeader, walkthroughSheetRows, walkthroughYears, type YearWalkthrough,
} from '../../src/utils/yearWalkthrough';
import type { CoverageLine, DecisionSet, GameSetupSettings, GameState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SCENARIO = '16', YEARS = 3;
const failures: string[] = [];
const check = (problems: string[], label: string, detail = '') => {
  if (problems.length) failures.push(label);
  console.log(`  ${problems.length ? 'FAIL' : 'OK  '}  ${label}${detail ? `  — ${detail}` : ''}`);
  for (const p of problems.slice(0, 5)) console.log(`          ${p}`);
};
const control = async (label: string, breakIt: () => () => void, section: () => string[] | Promise<string[]>) => {
  const restore = breakIt();
  let problems: string[];
  try { problems = await section(); } finally { restore(); }
  check(problems.length > 0 ? [] : ['the section passed with the thing it guards broken'], `  control: ${label}`,
    `${problems.length} problem(s) when broken`);
};

// ---- the games -------------------------------------------------------------
type Decide = (y: number) => DecisionSet;
function playFrom(gs: GameState, decide: Decide): GameState {
  for (let y = 1; y <= YEARS; y++) {
    const played = playWorldsYear(gs, decide(y));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
  }
  return gs;
}
function soloGame(decide: Decide, test = false): GameState {
  const settings = { poolName: 'W', gameLength: 5, startingYear: 2027, instanceId: SCENARIO, activeLines: LINES,
    ...(test ? { developmentLevels: { WC: 'Mid', GL: 'Off', Property: 'Low' } } : {}) } as GameSetupSettings;
  const { setup, instance } = openSoloInstance(settings,
    test ? { schedule: [{ shockId: '#7', yearNumber: 2 }, { shockId: '#1', yearNumber: 3 }] as never } : undefined);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  return playFrom(openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState,
    lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory }), decide);
}
const ROOM = { seed: SCENARIO, yearCount: 5, startingYear: 2027, eventName: 'W', poolName: 'W', shocks: [], priorDevelopment: {} };
function teamGame(decide: Decide): GameState {
  return playFrom(buildTeamGame(ROOM as never, LINES).gameState, decide);
}
const DEFAULT: Decide = y => defaultDecisionSet(y);
// The asset mix changed in the last year only.
const MIX: Decide = y => (y < YEARS ? defaultDecisionSet(y)
  : { ...defaultDecisionSet(y), assetAllocation: { cashPct: 40, bondsPct: 40, equitiesPct: 20 } });
// The reinsurance changed in the last year only — moves an earlier step than investment.
const COVER: Decide = y => {
  const d = defaultDecisionSet(y);
  if (y < YEARS) return d;
  return { ...d, byLine: { ...d.byLine, Property: { ...d.byLine.Property, reinsuranceOption: '$38M xs $2M' } } };
};

const A = soloGame(DEFAULT);
const B = soloGame(DEFAULT);
const C = soloGame(MIX);
const T = soloGame(DEFAULT, true);
const team = teamGame(DEFAULT);

const all = (gs: GameState): YearWalkthrough[] => walkthroughYears(gs).flatMap(y => buildYearWalkthroughs(gs, y));
const flat = (w: YearWalkthrough) => [
  ['year code', w.yearCode], ['decisions code', w.decisionsCode], ['draws code', w.drawsCode],
  ...[...w.draws, ...w.steps].map(b => [b.id, b.code]),
];
const key = (w: YearWalkthrough) => `${w.calendarYear} ${w.view}`;

// ---- 1. SAME GAME, SAME CODES ------------------------------------------------
let bGame = B;
function sectionSame(): string[] {
  const out: string[] = [];
  const a = all(A), b = all(bGame);
  if (a.length !== b.length || a.length === 0) return [`${a.length} walkthroughs against ${b.length}`];
  a.forEach((wa, i) => {
    const wb = b[i];
    const fa = flat(wa), fb = flat(wb);
    fa.forEach(([id, code], k) => { if (fb[k]?.[1] !== code) out.push(`${key(wa)} ${id}: ${code} against ${fb[k]?.[1]}`); });
    [...wa.draws, ...wa.steps].forEach((blk, k) => {
      const other = [...wb.draws, ...wb.steps][k];
      if (JSON.stringify(blk.rows) !== JSON.stringify(other?.rows)) out.push(`${key(wa)} ${blk.id}: the figures differ`);
    });
  });
  return out;
}

// ---- 2. ONE DECISION, ONLY ITS STEPS -----------------------------------------
let cGame = C;
function sectionOneDecision(): string[] {
  const out: string[] = [];
  const a = all(A), c = all(cGame);
  a.forEach((wa, i) => {
    const wc = c[i];
    const last = wa.yearNumber === YEARS;
    const ids = [...wa.draws, ...wa.steps].map(b => b.id);
    const codesA = Object.fromEntries([...wa.draws, ...wa.steps].map(b => [b.id, b.code]));
    const codesC = Object.fromEntries([...wc.draws, ...wc.steps].map(b => [b.id, b.code]));
    for (const id of ids) {
      const step = /^step-(\d+)-/.exec(id);
      const moves = last && step !== null && Number(step[1]) >= 10;
      const same = codesA[id] === codesC[id];
      if (moves && same) out.push(`${key(wa)} ${id}: unchanged, though the asset mix changed`);
      if (!moves && !same) out.push(`${key(wa)} ${id}: changed (${codesA[id]} -> ${codesC[id]}), and the asset mix does not reach it`);
    }
    if (last && wa.decisionsCode === wc.decisionsCode) out.push(`${key(wa)}: the decisions code did not move`);
    if (!last && wa.decisionsCode !== wc.decisionsCode) out.push(`${key(wa)}: an earlier year's decisions code moved`);
    if (last && wa.yearCode === wc.yearCode) out.push(`${key(wa)}: the year code did not move`);
    if (wa.drawsCode !== wc.drawsCode) out.push(`${key(wa)}: the draws moved with a decision`);
  });
  return out;
}

// ---- 3. THE FIGURES ARE THE ENGINE'S -----------------------------------------
const tGame = T;
const fig = (w: YearWalkthrough, id: string, label: string): number => {
  const v = [...w.draws, ...w.steps].find(b => b.id === id)?.rows.find(r => r.label === label)?.value;
  return typeof v === 'number' ? v : NaN;
};
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
function sectionEngine(): string[] {
  const out: string[] = [];
  const gs = tGame;
  const y = YEARS;
  const row = gs.lockedResults.find(r => r.yearNumber === y)!;
  const worldRows = gs.worlds!.map(w => w.lockedResults.find(r => r.yearNumber === y)!) as ResultSet[];
  for (const l of LINES) {
    const w = buildYearWalkthroughs(gs, y).find(x => x.view === l)!;
    const a = row.byLine[l];
    // Each world's year factor, read off its stream, is the one it booked.
    worldRows.forEach((r, i) => {
      const yf = drawOrdinaryFactor(ordinaryLossRng(worldInstance(gs.instance, i).seed, y, l), ordinaryYearCv(l));
      if (yf !== r.byLine[l].commonLossFactor) out.push(`${l} world ${i + 1}: year factor ${yf} against ${r.byLine[l].commonLossFactor}`);
      const inst = worldInstance(gs.instance, i);
      const m = applyMarketShock(simulateMarketReturns(deriveSubRng(inst.seed, y, 'invest')), resolveShockYear(inst, shockTimingOf(gs.setup), y).marketShock);
      const inc = blendInvestmentReturn(r.byLine[l].investedAssets, r.byLine[l].assetAllocation, m).income;
      if (!near(inc, r.byLine[l].investmentIncome, 1e-6)) out.push(`${l} world ${i + 1}: the market re-read earns ${inc}, booked ${r.byLine[l].investmentIncome}`);
    });
    if (!near(fig(w, `draw-year-${l}`, 'Year factor (average across the worlds)'), a.commonLossFactor, 1e-12)) out.push(`${l}: year factor not the row's`);
    const overrun = fig(w, `draw-expense-${l}`, 'Admin overrun');
    if (!near(overrun, a.operatingExpense / a.adminExpense - 1, 1e-9)) out.push(`${l}: overrun ${overrun} against booked ${a.operatingExpense / a.adminExpense - 1}`);
    const recorded = worldRows.reduce((s, r) => s + r.byLine[l].newLossEngine!.ordinaryExpected, 0) / worldRows.length;
    const exp = fig(w, `step-1-${l}`, 'Exposure ($M)') * 10_000 * fig(w, `step-1-${l}`, 'Cost per $100');
    if (!near(exp, recorded) || !near(fig(w, `step-1-${l}`, 'Expected baseline losses'), recorded)) out.push(`${l}: expected baseline ${exp} against recorded ${recorded}`);
    const dev = w.steps.find(b => b.id === `step-6-${l}`)!.rows;
    const byAy = dev.filter(r => r.label.startsWith('Accident year')).reduce((s, r) => s + (r.value as number), 0);
    if (!near(byAy, -a.priorYearDevelopment)) out.push(`${l}: development by accident year sums to ${byAy}, recorded ${-a.priorYearDevelopment}`);
    const prem = fig(w, `step-8-${l}`, 'Rate per $100') * fig(w, `step-8-${l}`, 'Exposure ($M)') * 10_000;
    if (!near(prem, a.totalMemberCharge, 1)) out.push(`${l}: rate x exposure ${prem} against premium ${a.totalMemberCharge}`);
    const s11 = (lab: string) => fig(w, `step-11-${l}`, lab);
    if (!near(s11('Opening surplus') + s11('Net income'), s11('Ending surplus'))) out.push(`${l}: surplus does not roll forward`);
  }
  return out;
}

// ---- 4. THE SEED RULE --------------------------------------------------------
const seedOf = (gs: GameState) => String(SCENARIO_SEEDS[gs.instance.scenario!]);
function cellsOf(wb: XLSX.WorkBook): string[] {
  return wb.SheetNames.flatMap(n => {
    const ws = wb.Sheets[n];
    return Object.keys(ws).filter(k => !k.startsWith('!')).map(k => String((ws[k] as XLSX.CellObject).v ?? ''));
  });
}
const leaks = (cells: string[], seed: string) => cells.filter(c => c === seed || /^seed$/i.test(c.trim()));
let soloShows = false;
async function sectionSeed(): Promise<string[]> {
  const out: string[] = [];
  for (const [name, gs] of [['single player', A], ['a team', team]] as const) {
    const seed = seedOf(gs);
    const header = walkthroughHeader(gs.instance, name === 'single player' ? soloShows : false);
    if (header.version !== SAVE_KEY) out.push(`${name}: version ${header.version}`);
    if (header.seed !== undefined) out.push(`${name}: the header carries the seed ${header.seed}`);
    const results = buildResultsWorkbook(gs.lockedResults, LINES, RESULT_METRICS, walkthroughSheetRows(gs, header));
    if (!results.SheetNames.includes('Year Walkthrough')) out.push(`${name}: no Year Walkthrough sheet`);
    const claims = buildClaimsWorkbook(gs.lockedResults, gs.priorHistory, gs.instance, LINES, gs.poolState, gs.instance.instanceId);
    const stmt = XLSX.read(new Uint8Array(await buildAnnualStatementXlsx(gs)), { type: 'array' });
    for (const [file, wb] of [['Results', results], ['claims', claims], ['Annual Statement', stmt]] as const) {
      const hit = leaks(cellsOf(wb), seed);
      if (hit.length) out.push(`${name}: the ${file} download holds ${hit.slice(0, 3).join(', ')}`);
    }
  }
  const th = walkthroughHeader(T.instance, true);
  if (th.seed !== seedOf(T)) out.push(`Test player: header seed ${th.seed}, the scenario's is ${seedOf(T)}`);
  const rows = walkthroughSheetRows(T, th);
  if (!rows.some(r => r[0] === 'Seed' && r[1] === seedOf(T))) out.push('Test player: the sheet carries no seed');
  return out;
}

// ---- 5. ONE SEED AND ONE VERSION ---------------------------------------------
let hostRoomSeed = SCENARIO;
function sectionAcross(): string[] {
  const id = gameIdentity(hostRoomSeed);
  const host = walkthroughHeader({ instanceId: id.gameId, scenario: id.scenario }, true);
  const test = walkthroughHeader(T.instance, true);
  const teamH = walkthroughHeader(team.instance, true);
  const out: string[] = [];
  const want = String(SCENARIO_SEEDS[Number(SCENARIO)]);
  for (const [n, h] of [['host', host], ['Test player', test], ['team game', teamH]] as const) {
    if (h.seed !== want) out.push(`${n}: seed ${h.seed}, scenario ${SCENARIO}'s fixed seed is ${want}`);
    if (h.version !== SAVE_KEY) out.push(`${n}: version ${h.version}`);
  }
  return out;
}

// ---- run -------------------------------------------------------------------
console.log('year-walkthrough-check\n');
check(sectionSame(), '1. two games, same setup and decisions: identical draws and codes at every block, year and view');
await control('one draw moved in the second game', () => {
  const r = B.lockedResults.find(x => x.yearNumber === 2)!.byLine.GL; const o = r.commonLossFactor;
  r.commonLossFactor = o * (1 + 1e-6); return () => { r.commonLossFactor = o; };
}, sectionSame);
await control('the second game a hosted team\'s (the host\'s shock timing)', () => { const o = bGame; bGame = team; return () => { bGame = o; }; }, sectionSame);

check(sectionOneDecision(), `2. the asset mix changed in ${2026 + YEARS}: steps 10-11, the decisions and year codes move; every draw, steps 1-9 and earlier years do not`);
await control('no decision changed', () => { const o = cGame; cGame = B; return () => { cGame = o; }; }, sectionOneDecision);
await control('the reinsurance changed instead (an earlier step)', () => { const o = cGame; cGame = soloGame(COVER); return () => { cGame = o; }; }, sectionOneDecision);

check(sectionEngine(), '3. the figures are the engine\'s: stream re-reads match every world, step 1, development, premium and surplus tie to the record');
await control('a recorded development figure tampered', () => {
  const a = T.lockedResults.find(x => x.yearNumber === YEARS)!.byLine.WC; const o = a.priorYearDevelopment;
  a.priorYearDevelopment = o - 5000; return () => { a.priorYearDevelopment = o; };
}, sectionEngine);
await control('a world\'s booked year factor tampered', () => {
  const r = T.worlds![7].lockedResults.find(x => x.yearNumber === YEARS)!.byLine.GL; const o = r.commonLossFactor;
  r.commonLossFactor = o + 1e-9; return () => { r.commonLossFactor = o; };
}, sectionEngine);

check(await sectionSeed(), '4. no seed on a single-player or team header or download; Test player\'s header and sheet carry it');
await control('single player shown the seed', () => { soloShows = true; return () => { soloShows = false; }; }, sectionSeed);

check(sectionAcross(), `5. scenario ${SCENARIO}: one seed and one version across Test player, the host and a team's game`);
await control('the host\'s room another scenario', () => { hostRoomSeed = '7'; return () => { hostRoomSeed = SCENARIO; }; }, sectionAcross);

console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS');
process.exit(failures.length ? 1 : 0);
