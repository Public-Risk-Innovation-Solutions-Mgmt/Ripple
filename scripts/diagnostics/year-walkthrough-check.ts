// ============================================================================
// THE YEAR WALKTHROUGH (utils/yearWalkthrough) — every stage tied to the
// engine, its codes, how a decision moves it, and its seed rule.
//
//   npx tsx scripts/diagnostics/year-walkthrough-check.ts
//
// Each section is a function returning its problems; each has a CONTROL that
// breaks the thing it guards, asserts the section FAILS, and restores it.
//
// 1. SAME GAME, SAME CODES. Two games played apart, on the same setup with the
//    same decisions, give identical figures and codes at every stage, every
//    year, every view — the draws, the year code and the decisions code too.
// 2. A CHANGED DECISION MOVES ONLY THE STAGES AFTER IT. The same game with one
//    decision changed in its last year — the asset mix, the cover, the
//    funding level, non-renewal, the dividend — moves the decisions code, the
//    year code and the first stage that decision feeds (FIRST_STAGE_FED), and
//    no stage before it, no draw and no earlier year.
// 3. EVERY STAGE TIES TO THE ENGINE, every played year and line, in a game
//    that moves the book, buys cover, squeezes funding, pays a dividend and
//    has shocks in force (so the shock-free pricing ledger is in play): the
//    re-struck pure premium and rate are the row's; the book's movement gives
//    the exposure billed; premium is rate x exposure; the re-read losses'
//    gross is the row's; the year's own booking is the ledger's; development
//    by accident year sums to the year's; reserves and LAE reserves by
//    accident year sum to the line's; admin booked is charged x (1 +
//    overrun); investment income is the row's; dividends are % x basis;
//    surplus rolls forward; required capital is its working; in the latest
//    year, each world's year factor and investment income re-read off its own
//    stream are what that world booked.
// 4. THE SEED RULE. Single player and a hosted team: the header has the
//    version and the scenario and no seed, and no download — the Year
//    Walkthrough workbook, the Results workbook with its walkthrough sheet,
//    the claims workbook, the Annual Statement — holds a "Seed" or a cell
//    equal to the fixed seed. Test player's header and download carry it.
// 5. ONE SEED, ONE VERSION, ONE SCENARIO across Test player, the host's header
//    and a team's game, for the same scenario.
// 6. MARKET SHARE IS INFORMATION ONLY. A team's walkthrough shows its room
//    share at the end, marked "Not part of the model — depends on the room",
//    with no code; the same game read with two different shares (or none)
//    gives the same year code and the same code at every other stage.
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
  buildWalkthroughWorkbook, buildYearWalkthroughs, FIRST_STAGE_FED, INFO_STAGES, STAGES, walkMark, walkthroughFilename, walkthroughHeader,
  walkthroughSheetRows, walkthroughYears, type StageKey, type YearWalkthrough,
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
    test ? { schedule: [{ shockId: '#7', yearNumber: 1 }, { shockId: '#1', yearNumber: 2 }] as never } : undefined);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  return playFrom(openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState,
    lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory }), decide);
}
const ROOM = { seed: SCENARIO, yearCount: 5, startingYear: 2027, eventName: 'W', poolName: 'W', shocks: [], priorDevelopment: {} };
const teamGame = (decide: Decide): GameState => playFrom(buildTeamGame(ROOM as never, LINES).gameState, decide);

const DEFAULT: Decide = y => defaultDecisionSet(y);
/** The defaults, with one thing changed in the last year only. */
const lastYear = (change: (d: DecisionSet) => DecisionSet): Decide => y => (y < YEARS ? defaultDecisionSet(y) : change(defaultDecisionSet(y)));
const onLine = (d: DecisionSet, l: CoverageLine, f: Partial<DecisionSet['byLine'][CoverageLine]>): DecisionSet =>
  ({ ...d, byLine: { ...d.byLine, [l]: { ...d.byLine[l], ...f } } });
const CHANGES: { name: string; decision: string; line: CoverageLine; decide: Decide }[] = [
  { name: 'the asset mix', decision: 'assetMix', line: 'GL', decide: lastYear(d => ({ ...d, assetAllocation: { cashPct: 40, bondsPct: 40, equitiesPct: 20 } })) },
  { name: 'the Property cover', decision: 'reinsurance', line: 'Property', decide: lastYear(d => onLine(d, 'Property', { reinsuranceOption: '$38M xs $2M' })) },
  { name: 'the WC funding level', decision: 'funding', line: 'WC', decide: lastYear(d => onLine(d, 'WC', { fundingAtExpected: false, fundingConfidenceLevel: 0.75 })) },
  { name: 'GL non-renewal', decision: 'nonRenewal', line: 'GL', decide: lastYear(d => onLine(d, 'GL', { nonRenewal: 0.05 })) },
  { name: 'the WC dividend', decision: 'dividend', line: 'WC', decide: lastYear(d => onLine(d, 'WC', { dividendPct: 0.05 })) },
];
// The tie game: the book moves, cover is bought, funding is squeezed, a dividend is paid, shocks are in force.
const TIE: Decide = y => {
  const d = defaultDecisionSet(y);
  return {
    ...d, assetAllocation: { cashPct: 20, bondsPct: 60, equitiesPct: 20 },
    byLine: {
      ...d.byLine,
      WC: { ...d.byLine.WC, nonRenewal: 0.05, newMembers: 0.1, fundingAtExpected: false, fundingConfidenceLevel: 0.75 },
      Property: { ...d.byLine.Property, reinsuranceOption: '$38M xs $2M', dividendPct: y === YEARS ? 0.05 : 0 },
    },
  };
};

const A = soloGame(DEFAULT);
const B = soloGame(DEFAULT);
const T = soloGame(TIE, true);
const team = teamGame(DEFAULT);
const changed = CHANGES.map(c => ({ ...c, game: soloGame(c.decide) }));

const all = (gs: GameState): YearWalkthrough[] => walkthroughYears(gs).flatMap(y => buildYearWalkthroughs(gs, y));
const key = (w: YearWalkthrough) => `${w.calendarYear} ${w.view}`;
const ORDER = STAGES.map(s => s.key);

// ---- 1. SAME GAME, SAME CODES ------------------------------------------------
let bGame = B;
function sectionSame(): string[] {
  const out: string[] = [];
  const a = all(A), b = all(bGame);
  if (a.length !== b.length || a.length === 0) return [`${a.length} walkthroughs against ${b.length}`];
  a.forEach((wa, i) => {
    const wb = b[i];
    for (const k of ['yearCode', 'decisionsCode', 'drawsCode'] as const) if (wa[k] !== wb[k]) out.push(`${key(wa)} ${k}: ${wa[k]} against ${wb[k]}`);
    wa.stages.forEach((st, j) => {
      const o = wb.stages[j];
      if (o?.code !== st.code) out.push(`${key(wa)} ${st.title}: ${st.code} against ${o?.code}`);
      if (JSON.stringify(st.rows) !== JSON.stringify(o?.rows)) out.push(`${key(wa)} ${st.title}: the figures differ`);
    });
  });
  return out;
}

// ---- 2. A CHANGED DECISION MOVES ONLY THE STAGES AFTER IT --------------------
let changedGames = changed;
function sectionOneDecision(): string[] {
  const out: string[] = [];
  const a = all(A);
  for (const c of changedGames) {
    const first = FIRST_STAGE_FED[c.decision] as StageKey;
    const firstAt = ORDER.indexOf(first);
    const cw = all(c.game);
    a.forEach((wa, i) => {
      const wc = cw[i];
      const last = wa.yearNumber === YEARS;
      if (wa.drawsCode !== wc.drawsCode) out.push(`${c.name}: ${key(wa)} the draws moved`);
      if (!last) {
        if (wa.yearCode !== wc.yearCode) out.push(`${c.name}: ${key(wa)} an earlier year moved`);
        return;
      }
      if (wa.decisionsCode === wc.decisionsCode) out.push(`${c.name}: the decisions code did not move`);
      if (wa.yearCode === wc.yearCode) out.push(`${c.name}: the year code did not move`);
      for (const st of wa.stages) {
        const at = ORDER.indexOf(st.key);
        const other = wc.stages.find(x => x.key === st.key);
        if (st.key === 'decisions') continue;
        if (at < firstAt && other?.code !== st.code) out.push(`${c.name}: ${key(wa)} ${st.title} moved, before ${first}`);
      }
      if (wa.view === c.line || wa.view === 'pool') {
        const st = wa.stages.find(x => x.key === first), other = wc.stages.find(x => x.key === first);
        if (st && st.code === other?.code) out.push(`${c.name}: ${key(wa)} ${st.title} did not move`);
      }
    });
  }
  return out;
}

// ---- 3. EVERY STAGE TIES TO THE ENGINE ---------------------------------------
const tGame = T;
const fig = (w: YearWalkthrough, k: StageKey, label: string): number => {
  const v = w.stages.find(s => s.key === k)?.rows.find(r => r.label === label)?.value;
  return typeof v === 'number' ? v : NaN;
};
const sumOf = (w: YearWalkthrough, k: StageKey, re: RegExp): number =>
  (w.stages.find(s => s.key === k)?.rows ?? []).filter(r => re.test(r.label)).reduce((t, r) => t + (typeof r.value === 'number' ? r.value : NaN), 0);
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 1e-9);
function sectionEngine(): string[] {
  const out: string[] = [];
  const gs = tGame;
  for (const y of walkthroughYears(gs)) {
    const row = gs.lockedResults.find(r => r.yearNumber === y)!;
    for (const w of buildYearWalkthroughs(gs, y).filter(x => x.view !== 'pool')) {
      const l = w.view as CoverageLine;
      const a = row.byLine[l];
      const tie = (what: string, got: number, want: number, tol = 0.01) => { if (!near(got, want, tol)) out.push(`${y} ${l} ${what}: ${got} against the engine's ${want}`); };
      tie('pure premium', fig(w, 'pricing', 'Pure premium per $100'), a.newPurePremiumPer100!, 1e-9);
      tie('rate', fig(w, 'pricing', 'Rate per $100 (member charge rate)'), a.finalRatePer100!, 1e-9);
      tie('exposure after the book moves', fig(w, 'book', "This year's exposure ($M)"), a.billedExposure!, 1e-6);
      tie('premium = rate x exposure', fig(w, 'pricing', 'Rate per $100 (member charge rate)') * fig(w, 'premium', 'Exposure billed ($M)') * 10_000, a.totalMemberCharge, 1);
      tie('gross losses', fig(w, 'losses', 'Gross losses'), a.grossUltimateLoss);
      tie('net retained', fig(w, 'reinsurance', 'Net retained'), a.netUltimateLoss);
      tie("the year's own booking", fig(w, 'booking', 'Booked ultimate'), a.netUltimateLoss * (1 - fig(w, 'booking', 'Booking bias at the funding CLF')), 1);
      tie('development by accident year', sumOf(w, 'development', /development booked$/), -a.priorYearDevelopment);
      tie('reserves by accident year, end', sumOf(w, 'reserves', /^\d{4}: (case reserve|IBNR), end$/), a.endingNetReserve);
      tie('reserves by accident year, start', sumOf(w, 'reserves', /^\d{4}: (case reserve|IBNR), start$/), a.beginningNetReserve);
      tie('LAE reserve by accident year, end', sumOf(w, 'reserves', /^\d{4}: LAE reserve, end$/), a.endingLaeReserve);
      tie('LAE reserve by accident year, start', sumOf(w, 'reserves', /^\d{4}: LAE reserve, start$/), a.beginningLaeReserve);
      tie('admin booked = charged x (1 + overrun)', fig(w, 'admin', 'Admin charged') * (1 + fig(w, 'admin', 'Overrun drawn')), a.operatingExpense);
      tie('investment income', fig(w, 'investment', 'Investment income'), a.investmentIncome);
      tie('dividends = % x basis', fig(w, 'dividends', 'Dividend %') * fig(w, 'dividends', 'Basis (opening surplus, not below zero)'), a.dividends, 1);
      tie('surplus rolls forward', fig(w, 'surplus', 'Opening surplus') + fig(w, 'surplus', 'Net income') + fig(w, 'surplus', 'Transfer between lines (loans)'), a.endingSurplus);
      const marginRow = w.stages.find(s => s.key === 'capital')!.rows.find(r => r.label.startsWith('Reserve margin factor'))!;
      tie('required capital', fig(w, 'capital', 'Loss reserve (net), end') * ((marginRow.value as number) - 1) + fig(w, 'capital', 'Retained catastrophe capital'), a.reserveRiskMarginNeeded);
    }
  }
  // The latest year: each world's own draws, re-read off its stream, are what it booked.
  const y = YEARS;
  const worldRows = gs.worlds!.map(w => w.lockedResults.find(r => r.yearNumber === y)!) as ResultSet[];
  for (const l of LINES) {
    worldRows.forEach((r, i) => {
      const inst = worldInstance(gs.instance, i);
      const yf = drawOrdinaryFactor(ordinaryLossRng(inst.seed, y, l), ordinaryYearCv(l));
      if (yf !== r.byLine[l].commonLossFactor) out.push(`${l} world ${i + 1}: year factor ${yf} against ${r.byLine[l].commonLossFactor}`);
      const m = applyMarketShock(simulateMarketReturns(deriveSubRng(inst.seed, y, 'invest')), resolveShockYear(inst, shockTimingOf(gs.setup), y).marketShock);
      const inc = blendInvestmentReturn(r.byLine[l].investedAssets, r.byLine[l].assetAllocation, m).income;
      if (!near(inc, r.byLine[l].investmentIncome, 1e-6)) out.push(`${l} world ${i + 1}: the market re-read earns ${inc}, booked ${r.byLine[l].investmentIncome}`);
    });
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
    if (header.scenario !== Number(SCENARIO)) out.push(`${name}: scenario ${header.scenario}`);
    if (header.seed !== undefined) out.push(`${name}: the header carries the seed ${header.seed}`);
    const walk = buildWalkthroughWorkbook(gs, header);
    const results = buildResultsWorkbook(gs.lockedResults, LINES, RESULT_METRICS, walkthroughSheetRows(gs, header));
    if (!results.SheetNames.includes('Year Walkthrough')) out.push(`${name}: no Year Walkthrough sheet in the Results download`);
    if (!/^Year_Walkthrough_\d{4}\.xlsx$/.test(walkthroughFilename(gs))) out.push(`${name}: the download is named ${walkthroughFilename(gs)}`);
    const claims = buildClaimsWorkbook(gs.lockedResults, gs.priorHistory, gs.instance, LINES, gs.poolState, gs.instance.instanceId);
    const stmt = XLSX.read(new Uint8Array(await buildAnnualStatementXlsx(gs)), { type: 'array' });
    for (const [file, wb] of [['Year Walkthrough', walk], ['Results', results], ['claims', claims], ['Annual Statement', stmt]] as const) {
      const hit = leaks(cellsOf(wb), seed);
      if (hit.length) out.push(`${name}: the ${file} download holds ${hit.slice(0, 3).join(', ')}`);
    }
  }
  const th = walkthroughHeader(T.instance, true);
  if (th.seed !== seedOf(T)) out.push(`Test player: header seed ${th.seed}, the scenario's is ${seedOf(T)}`);
  if (!cellsOf(buildWalkthroughWorkbook(T, th)).includes(seedOf(T))) out.push('Test player: the walkthrough download carries no seed');
  return out;
}

// ---- 5. ONE SEED, ONE VERSION, ONE SCENARIO ----------------------------------
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
    if (h.scenario !== Number(SCENARIO)) out.push(`${n}: scenario ${h.scenario}`);
  }
  return out;
}

// ---- 6. MARKET SHARE IS INFORMATION ONLY -------------------------------------
function sectionInfo(): string[] {
  const out: string[] = [];
  const y = YEARS;
  const share = (pool: number) => ({ year: y, pool, byLine: { WC: pool, GL: pool * 0.9, Property: pool * 1.1 } });
  const reads = [buildYearWalkthroughs(team, y, share(0.25)), buildYearWalkthroughs(team, y, share(0.4)), buildYearWalkthroughs(team, y, null)];
  reads[0].forEach((w, i) => {
    const ms = w.stages.find(s => s.key === 'marketShare');
    if (!ms) { out.push(`${key(w)}: no market share stage`); return; }
    if (w.stages[w.stages.length - 1] !== ms) out.push(`${key(w)}: the market share is not at the end`);
    if (ms.code !== '' || walkMark(ms.same, ms.info) !== 'Not part of the model — depends on the room') out.push(`${key(w)}: market share carries code '${ms.code}' / '${walkMark(ms.same, ms.info)}'`);
    for (const other of [reads[1][i], reads[2][i]]) {
      if (other.yearCode !== w.yearCode) out.push(`${key(w)}: the year code moved with the room's share (${w.yearCode} -> ${other.yearCode})`);
      for (const st of w.stages.filter(s => !s.info)) {
        if (other.stages.find(s => s.key === st.key)?.code !== st.code) out.push(`${key(w)} ${st.title}: moved with the room's share`);
      }
    }
  });
  return out;
}

// ---- run -------------------------------------------------------------------
console.log('year-walkthrough-check\n');
check(sectionSame(), '1. two games, same setup and decisions: identical figures and codes at every stage, year and view');
await control('one draw moved in the second game', () => {
  const r = B.lockedResults.find(x => x.yearNumber === 2)!.byLine.GL; const o = r.commonLossFactor;
  r.commonLossFactor = o * (1 + 1e-6); return () => { r.commonLossFactor = o; };
}, sectionSame);
await control('the second game a hosted team\'s (the host\'s shock timing)', () => { const o = bGame; bGame = team; return () => { bGame = o; }; }, sectionSame);

check(sectionOneDecision(), `2. one decision changed in ${2026 + YEARS} (${CHANGES.map(c => c.name).join(', ')}): its first stage and the codes move; no earlier stage, no draw, no earlier year`);
await control('no decision changed', () => { const o = changedGames; changedGames = changed.map(c => ({ ...c, game: B })); return () => { changedGames = o; }; }, sectionOneDecision);
await control('the cover said to feed investment first (pricing moves before it)', () => {
  const m = FIRST_STAGE_FED as Record<string, StageKey>; const o = m.reinsurance; m.reinsurance = 'investment';
  return () => { m.reinsurance = o; };
}, sectionOneDecision);

check(sectionEngine(), '3. every stage ties to the engine, every year and line; each world\'s draws are what it booked');
await control('the shock-free pricing ledger dropped (the rate re-struck on the wrong ledger)', () => {
  const o = T.pricingShadow; (T as { pricingShadow?: unknown }).pricingShadow = undefined;
  return () => { (T as { pricingShadow?: unknown }).pricingShadow = o; };
}, sectionEngine);
await control('a recorded development figure tampered', () => {
  const a = T.lockedResults.find(x => x.yearNumber === YEARS)!.byLine.WC; const o = a.priorYearDevelopment;
  a.priorYearDevelopment = o - 5000; return () => { a.priorYearDevelopment = o; };
}, sectionEngine);
await control('a world\'s booked year factor tampered', () => {
  const r = T.worlds![7].lockedResults.find(x => x.yearNumber === YEARS)!.byLine.GL; const o = r.commonLossFactor;
  r.commonLossFactor = o + 1e-9; return () => { r.commonLossFactor = o; };
}, sectionEngine);

check(await sectionSeed(), '4. no seed on a single-player or team header or in any of their downloads; Test player\'s header and download carry it');
await control('single player shown the seed', () => { soloShows = true; return () => { soloShows = false; }; }, sectionSeed);

check(sectionAcross(), `5. scenario ${SCENARIO}: one seed, version and scenario across Test player, the host and a team's game`);
await control('the host\'s room another scenario', () => { hostRoomSeed = '7'; return () => { hostRoomSeed = SCENARIO; }; }, sectionAcross);

check(sectionInfo(), '6. market share: at the end, marked not part of the model, no code; the year code and every other stage ignore it');
await control('market share counted as part of the model', () => { const o = [...INFO_STAGES]; INFO_STAGES.length = 0; return () => { INFO_STAGES.push(...o); }; }, sectionInfo);

console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS');
process.exit(failures.length ? 1 : 0);
