// ============================================================================
// THE ANNUAL STATEMENT'S UNDERWRITING, IN THE HISTORY YEARS
// (pr/statement-history-underwriting; utils/annualStatementTemplate.ts
// perLineUnderwritingRows).
//
//   npx tsx scripts/diagnostics/statement-underwriting-history-check.ts
//
// Every Underwriting cell in a pre-game history column (program years up to
// 2026) shows the prior board's figures — never "—" — in every statement a game
// has (the pool's and each line's), at the opening (before year 1 is played),
// after year 1 and after year 3, in single player, Test player and a hosted
// team's game. A pool writing Property beside WC or GL shows them line by line
// (its exposures are in two units and cannot be added); a pool on payroll lines
// alone shows one set, summed.
//
// For each history column, each line (or the payroll pool's sum):
//   1. PRESENT: Written Exposures, New Business, Renewal Business, Retained %
//      and Current Rate show a figure; Change from Prior and % Change Over Prior
//      too, but in the first column, which is blank.
//   2. THE BOOK GROWS BY ITS NEW MEMBERS: New Business over last year's Written
//      Exposures is the year's New Members (the prior board's decision, as the
//      year recorded it), and Written Exposures = New Business + Renewal
//      Business — to the engine's rounding (written exposure to $0.01M).
//   3. RENEWALS AT 100%: Renewal Business is last year's Written Exposures, and
//      Retained % is 100.0%.
//   4. ITS RATES: Current Rate is the year's own rate per $100 (a payroll pool's
//      weighted by exposure), and % Change Over Prior is its change.
//
// CONTROLS, each of which must fail: the history columns shown as "—" (the
// statement before this fix: a pool with Property summed nothing); renewals a
// year off; retention at 95%; the book grown 1% past its New Members; and a
// rate from another year.
// ============================================================================
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { roundStartDecisions } from '../../src/utils/decisionDefaults';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { newMembersShare } from '../../src/utils/bookUnderwriting';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import {
  baseKey, buildTemplateStatement, figureText, isPerLineLayout, shownFigure, templateStatements,
  type Figure, type TemplateStatement,
} from '../../src/utils/annualStatementTemplate';
import type { CoverageLine, GameState, ResultSet } from '../../src/types/simulation';

let passed = 0, failed = 0;
function ok(cond: boolean, label: string, detail = '') {
  if (cond) { passed++; console.log(`  OK    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
function control(label: string, problems: number) {
  ok(problems > 0, `control: ${label}`, problems > 0 ? '' : 'the broken form passed');
  if (problems > 0) console.log(`          (${problems} problem(s) when broken)`);
}

const UW = ['exposure', 'exposureChange', 'newBusiness', 'renewal', 'retained', 'rate', 'rateChange'];
const rateOf = (x: { finalRatePer100?: number; ratePer100: number }) => x.finalRatePer100 ?? x.ratePer100;

/**
 * Every problem with a statement's history Underwriting columns. `groups`: per
 * line where the statement goes line by line, else the scope's lines summed.
 */
function historyProblems(gs: GameState, ts: TemplateStatement): string[] {
  const out: string[] = [];
  const timeline: ResultSet[] = [...(gs.earlyPreGameHistory ?? []), ...gs.priorHistory, ...gs.lockedResults];
  const byCalendar = (y: number) => timeline.find(r => r.calendarYear === y);
  const lines: CoverageLine[] = ts.scope === 'pool' ? gs.setup.activeLines : [ts.scope];
  const perLine = isPerLineLayout(ts.rows);
  const groups = perLine ? lines.map(l => ({ lines: [l], sfx: `@${l}` })) : [{ lines, sfx: '' }];
  const sum = (r: ResultSet | undefined, ls: CoverageLine[], f: (x: NonNullable<ResultSet['byLine'][CoverageLine]>) => number) =>
    (r ? ls.reduce((t, l) => t + f(r.byLine[l]!), 0) : NaN);
  const tag = `${ts.scope}@${ts.asOf}`;
  for (const { lines: ls, sfx } of groups) {
    const rowOf = (k: string) => ts.rows.findIndex(r => r.kind === 'figure' && r.key === `${k}${sfx}`);
    const missing = UW.filter(k => rowOf(k) < 0);
    if (missing.length) { out.push(`${tag}${sfx}: no ${missing.join(', ')} row`); continue; }
    const cell = (k: string, c: number): Figure | undefined => shownFigure(ts.rows[rowOf(k)], rowOf(k), c, ts);
    ts.years.forEach((cy, j) => {
      if (cy > gs.setup.startingYear - 1) return;           // the history columns only
      const c = j + 1, at = `${tag}${sfx} ${cy}`;
      // 1. PRESENT, never "—".
      for (const k of UW) {
        const x = cell(k, c);
        if (x === undefined) { if (!(c === 1 && (baseKey(k) === 'exposureChange' || baseKey(k) === 'rateChange'))) out.push(`${at}: ${k} blank`); continue; }
        const row = ts.rows[rowOf(k)];
        if (x === null || (row.kind === 'figure' && figureText(x, row.format) === '—')) out.push(`${at}: ${k} shows "—"`);
      }
      const r = byCalendar(cy), prev = byCalendar(cy - 1);
      const w = cell('exposure', c), nb = cell('newBusiness', c), ren = cell('renewal', c), ret = cell('retained', c), rate = cell('rate', c);
      if ([w, nb, ren, ret, rate].some(x => x === null || x === undefined) || !r) return;
      const tol = 0.006 * ls.length + 1e-9;
      // 2. THE BOOK GROWS BY ITS NEW MEMBERS.
      if (Math.abs(w! - nb! - ren!) > tol) out.push(`${at}: written ${w} ≠ new ${nb} + renewal ${ren}`);
      if (prev) {
        const prior = sum(prev, ls, x => x.writtenExposure);
        const wantNb = ls.reduce((t, l) => t + prev.byLine[l]!.writtenExposure * newMembersShare(r.byLine[l]!.decisions?.newMembers), 0);
        if (Math.abs(nb! - wantNb) > tol + 1e-4 * prior) out.push(`${at}: new business ${nb} ≠ last year's written × the year's New Members ${wantNb}`);
        // 3. RENEWALS AT 100%.
        if (Math.abs(ren! - prior) > tol) out.push(`${at}: renewal ${ren} ≠ last year's written ${prior}`);
        if (Math.abs(ret! - 1) > 1e-4) out.push(`${at}: retained ${(ret! * 100).toFixed(3)}%, not 100%`);
        // 4. ITS RATES.
        const wantRate = sum(r, ls, x => rateOf(x) * x.writtenExposure) / sum(r, ls, x => x.writtenExposure);
        if (Math.abs(rate! - wantRate) > 1e-9 * Math.max(1, wantRate)) out.push(`${at}: rate ${rate} ≠ the year's ${wantRate}`);
        const ch = cell('rateChange', c);
        const prevRate = sum(prev, ls, x => rateOf(x) * x.writtenExposure) / sum(prev, ls, x => x.writtenExposure);
        if (ch !== undefined && (ch === null || Math.abs(ch - (wantRate / prevRate - 1)) > 1e-9)) out.push(`${at}: % change over prior ${ch} ≠ ${wantRate / prevRate - 1}`);
      }
    });
  }
  return out;
}

// ---- the games ---------------------------------------------------------------
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
function soloGame(id: string, lines: CoverageLine[], test: boolean): GameState {
  const settings = { poolName: 'Underwriting', gameLength: 5, startingYear: 2027, instanceId: id, activeLines: lines, ...(test ? { testPlayer: true } : {}) } as never;
  const { setup, instance } = openSoloInstance(settings, test ? { schedule: [] } : undefined);
  const pre = runPriorHistory(instance, setup);
  return openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState: pre.poolState, lockedResults: [],
    currentDecisions: roundStartDecisions(1, gameShocksOn(setup, instance)), priorHistory: pre.priorHistory, earlyPreGameHistory: pre.earlyPreGameHistory } as GameState);
}
function playTo(gs: GameState, years: number): GameState {
  let g = gs;
  while (g.lockedResults.length < years) {
    const d = roundStartDecisions(g.currentYearNumber, gameShocksOn(g.setup, g.instance));
    g = { ...g, ...commitSettledYear(g, settleWorldsYear(g, playWorldsYear(g, d), [])), currentYearNumber: g.currentYearNumber + 1 } as GameState;
  }
  return g;
}

async function hostedGame(lines: CoverageLine[]): Promise<{ open: GameState; after: (n: number) => GameState }> {
  (globalThis as unknown as { localStorage: unknown }).localStorage = new (class {
    m = new Map<string, string>();
    get length() { return this.m.size; }
    getItem(k: string) { return this.m.get(k) ?? null; }
    setItem(k: string, v: string) { this.m.set(k, String(v)); }
    removeItem(k: string) { this.m.delete(k); }
    key(i: number) { return [...this.m.keys()][i] ?? null; }
    clear() { this.m.clear(); }
  })();
  Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
  const { LocalSessionTransport } = await import('../../src/session/localTransport');
  const { newSessionToken } = await import('../../src/session/contract');
  const { buildTeamGame, replayTeamYears } = await import('../../src/session/client/buildGame');
  const t = new LocalSessionTransport({ latencyMs: 0 });
  const made = await t.createRoom({ hostToken: newSessionToken(), seed: '7', yearCount: 4, startingYear: 2027, eventName: 'Underwriting', expectedTeams: 1, lines, shocks: [] });
  const room = (await t.read({ code: made.code })).room;
  const open = buildTeamGame(room, lines).gameState;
  return { open, after: n => replayTeamYears(open, n + 1, undefined).state };
}

// ---- run -----------------------------------------------------------------------
console.log('\n1-4. Every history column of every statement shows the prior board\'s underwriting');
const all: { name: string; gs: GameState }[] = [];
for (const [mode, id, test] of [['single player', '7', false], ['Test player', '3', true]] as const) {
  const open = soloGame(id, LINES, test);
  all.push({ name: `${mode}, opening`, gs: open }, { name: `${mode}, after year 1`, gs: playTo(open, 1) }, { name: `${mode}, after year 3`, gs: playTo(open, 3) });
}
const payroll = soloGame('12', ['WC', 'GL'], false);
all.push({ name: 'single player, WC + GL, opening', gs: payroll }, { name: 'single player, WC + GL, after year 1', gs: playTo(payroll, 1) });
const hosted = await hostedGame(LINES);
all.push({ name: 'hosted team, opening', gs: hosted.open }, { name: 'hosted team, after year 1', gs: hosted.after(1) }, { name: 'hosted team, after year 3', gs: hosted.after(3) });

let checkedCells = 0;
const sample: string[] = [];
for (const { name, gs } of all) {
  const statements = templateStatements(gs);
  const problems = statements.flatMap(ts => historyProblems(gs, ts));
  const histCols = statements.reduce((t, ts) => t + ts.years.filter(y => y < gs.setup.startingYear).length, 0);
  checkedCells += histCols;
  const pool = statements[0];
  ok(problems.length === 0 && histCols > 0,
    `${name}: ${statements.length} statements, ${histCols} history columns — present, growing by New Members, renewals at 100%, the year's rates${isPerLineLayout(pool.rows) ? ' (the pool line by line)' : ''}`,
    problems.slice(0, 4).join('; '));
  if (name === 'single player, opening') {
    const row = pool.rows.findIndex(r => r.kind === 'figure' && r.key === 'exposure@WC');
    sample.push(`Pool, WC Written Exposures: ${pool.years.map((y, k) => `${y} ${figureText(shownFigure(pool.rows[row], row, k + 1, pool) ?? null, 'exposure')}`).join(', ')}`);
  }
}
ok(checkedCells > 100, `history columns checked: ${checkedCells}`);
for (const s of sample) console.log(`          ${s}`);
const threeLine = all[0].gs;
ok(isPerLineLayout(buildTemplateStatement(threeLine, 'pool').rows) && !isPerLineLayout(buildTemplateStatement(payroll, 'pool').rows)
  && !isPerLineLayout(buildTemplateStatement(threeLine, 'WC').rows),
  'a pool with Property goes line by line; a payroll pool and every line view keep one set');

// ---- controls --------------------------------------------------------------------
console.log('\nControls');
const base = buildTemplateStatement(threeLine, 'pool');
const tamper = (f: (fig: Record<string, Figure[]>, k: string, cols: number[]) => void): number => {
  const figures = JSON.parse(JSON.stringify(base.figures)) as Record<string, Figure[]>;
  const cols = base.years.map((y, j) => (y < threeLine.setup.startingYear ? j + 1 : -1)).filter(c => c > 0);
  for (const k of Object.keys(figures)) if (UW.includes(baseKey(k))) f(figures, k, cols);
  return historyProblems(threeLine, { ...base, figures }).length;
};
control('the history columns shown as "—" (a pool with Property, summed: the statement before this fix)', tamper((f, k, cols) => { for (const c of cols) f[k][c] = null; }));
control('renewals a year off (each year\'s renewal its own written exposure)', tamper((f, k, cols) => { if (baseKey(k) === 'renewal') for (const c of cols) f[k][c] = f[k.replace('renewal', 'exposure')][c]; }));
control('retention at 95%', tamper((f, k, cols) => { if (baseKey(k) === 'retained') for (const c of cols) f[k][c] = 0.95; }));
control('the book grown 1% past its New Members', tamper((f, k, cols) => { if (baseKey(k) === 'newBusiness' || baseKey(k) === 'exposure') for (const c of cols) f[k][c] = f[k][c]! + 0.01 * f[k.replace(/^\w+/, 'renewal')][c]!; }));
control('a rate from another year (each year\'s the year before\'s)', tamper((f, k, cols) => { if (baseKey(k) === 'rate') for (const c of cols) f[k][c] = f[k][c - 1] ?? f[k][c]! * 0.9; }));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nstatement-underwriting-history-check: FAILED'); process.exit(1); }
console.log('\nstatement-underwriting-history-check: PASS — every history column shows the prior board\'s underwriting, at every point and in every mode, and the controls fail.');
