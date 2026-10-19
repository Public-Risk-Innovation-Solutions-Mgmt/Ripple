// ============================================================================
// THE ANNUAL STATEMENT — THE GATE.
//
//   npx tsx scripts/diagnostics/results-statement-check.ts
//
// The results page's figures (utils/resultsStatement), built on solo ten-world
// games as the app plays them — at the pool and on every line, before any year
// is played and after ten — must hold together:
//
//   1. REPORTED = PAID + CASE, and ULTIMATE = REPORTED + IBNR, in every program-
//      year block and column.
//   2. NET = GROSS − CEDED, row by row — premium against reinsurance premium,
//      paid, case, reported, IBNR, ultimates.
//   3. THE BALANCE SHEET BALANCES, loss expense reserves included: invested +
//      cash = loss reserves + loss expense reserves + other liabilities +
//      paid-in capital + earned surplus; and it is the engine's own.
//   4. THE COMBINED RATIO is losses, LAE and expenses over premium — worked out
//      from the rows above it, never the engine's pinned expected ratio.
//   5. UNDERWRITING TIES TO THE ENGINE: Net Underwriting Income + Assessments/
//      Dividends is the engine's underwriting income, and + Investment Income
//      its net income.
//   6. TOTAL sums the flow rows over the game years and takes the latest year
//      for balances, ratios and changes.
//   7. THE BLOCKS MEET THE BALANCE SHEET: net case + IBNR over every program
//      year is the loss reserves plus the loss expense reserves.
//   8. NOTHING MISSING READS AS ZERO: the cells with no source are "not yet
//      available", and they are exactly the expected ones.
//   9. RENEWAL + NEW BUSINESS IS THE WRITTEN EXPOSURE, line by line.
//
// ⚠ AND IT FAILS WHEN BROKEN — every check is a function over a statement, and
// THE CONTROLS feed each one a statement broken the way it guards against.
// ============================================================================

import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { buildAnnualStatement, notYetAvailable, num, type AnnualStatement, type Cell, type StatementRow } from '../../src/utils/resultsStatement';
import type { CoverageLine, GameSetupSettings, GameState, LineView } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

function play(id: string, years: number): GameState {
  const { setup, instance } = openSoloInstance({ poolName: 'S', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory });
  for (let y = 1; y <= years; y++) {
    const s = settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), []);
    gs = { ...gs, ...commitSettledYear(gs, s), currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
  }
  return gs;
}

const sec = (st: AnnualStatement, key: string) => st.sections.find(s => s.key === key)!;
const rowOf = (st: AnnualStatement, key: string, label: string, nth = 0) => sec(st, key).rows.filter(r => r.label === label)[nth];
const cellsOf = (st: AnnualStatement, key: string, label: string, nth = 0) => rowOf(st, key, label, nth).cells;
/** For each column where every cell is a value, run f; collect what fails. */
function eachColumn(st: AnnualStatement, cols: Cell[][], f: (xs: number[]) => boolean, what: string): string[] {
  const out: string[] = [];
  st.columns.forEach((c, i) => {
    const xs = cols.map(cs => num(cs[i]));
    if (xs.every(x => x !== undefined) && !f(xs as number[])) out.push(`${what} (${c})`);
  });
  return out;
}

// ---------------------------------------------------------------------------
// THE CHECKS
// ---------------------------------------------------------------------------
function reportedAndUltimate(st: AnnualStatement): string[] {
  return (['gross', 'ceded', 'net'] as const).flatMap(k => [
    ...eachColumn(st, [cellsOf(st, k, 'Paid Loss + LAE'), cellsOf(st, k, 'Case'), cellsOf(st, k, 'Reported Loss + LAE')],
      ([p, c, r]) => near(r, p + c), `${k}: reported ≠ paid + case`),
    ...eachColumn(st, [cellsOf(st, k, 'Reported Loss + LAE'), cellsOf(st, k, 'IBNR Reserve'), cellsOf(st, k, 'Ultimates')],
      ([r, i, u]) => near(u, r + i), `${k}: ultimate ≠ reported + IBNR`),
  ]);
}

function netIsGrossLessCeded(st: AnnualStatement): string[] {
  const pairs: [string, string][] = [['Premium', 'Reinsurance Premium'], ['Paid Loss + LAE', 'Paid Loss + LAE'], ['Case', 'Case'],
    ['Reported Loss + LAE', 'Reported Loss + LAE'], ['IBNR Reserve', 'IBNR Reserve'], ['Ultimates', 'Ultimates']];
  return pairs.flatMap(([g, c]) => eachColumn(st, [cellsOf(st, 'gross', g), cellsOf(st, 'ceded', c), cellsOf(st, 'net', g)],
    ([gv, cv, nv]) => near(nv, gv - cv), `${g}: net ≠ gross − ceded`));
}

function balances(st: AnnualStatement, gs: GameState, scope: LineView): string[] {
  const c = (l: string) => cellsOf(st, 'balance', l);
  const out = eachColumn(st, ['Invested', 'Cash', 'Loss Reserves', 'Loss Expense Reserves', 'Other Liabilities', 'Paid-in Capital', 'Earned Surplus'].map(c),
    ([inv, cash, lr, ler, ol, pic, es]) => near(inv + cash, lr + ler + ol + pic + es), 'assets ≠ liabilities + net worth');
  out.push(...eachColumn(st, [c('Paid-in Capital'), c('Earned Surplus'), c('Ending Surplus')], ([p, e, s]) => near(s, p + e), 'ending surplus ≠ paid-in + earned'));
  gs.lockedResults.forEach((r, i) => {
    const x = scope === 'pool' ? r : r.byLine[scope];
    const lae = num(c('Loss Expense Reserves')[i + 1]);
    if (lae === undefined || !near(lae, x.endingLaeReserve)) out.push(`year ${i + 1}: loss expense reserves are not the engine's`);
    const s = num(c('Ending Surplus')[i + 1]);
    if (s === undefined || !near(s, x.endingSurplus)) out.push(`year ${i + 1}: ending surplus is not the engine's`);
  });
  return out;
}

function combinedRatio(st: AnnualStatement): string[] {
  const c = (l: string, n = 0) => cellsOf(st, 'operating', l, n);
  return eachColumn(st, [c('Total Incurred Loss & LAE'), c('General Admin Expense'), c('Additional Admin Expense (risk control)'), c('Premium'), c('Combined Ratio')],
    ([ll, ga, ra, p, cr]) => near(cr, (ll + ga + ra) / p), 'combined ratio ≠ (losses + LAE + expenses) / premium')
    // Total takes the latest year's ratio, by the rule — check 6 holds it to that.
    .filter(x => !x.includes('(Total)'));
}

function tiesToEngine(st: AnnualStatement, gs: GameState, scope: LineView): string[] {
  const out: string[] = [];
  const c = (l: string) => cellsOf(st, 'operating', l);
  [gs.priorHistory.at(-1)!, ...gs.lockedResults].forEach((r, i) => {
    const x = scope === 'pool' ? r : r.byLine[scope];
    const nui = num(c('Net Underwriting Income')[i]), ad = num(c('Assessments/Dividends')[i]), inv = num(c('Investment Income')[i]), noi = num(c('Net Operating Income')[i]);
    if (nui === undefined || ad === undefined || !near(nui + ad, x.underwritingIncome)) out.push(`${st.columns[i]}: NUI + A/D ≠ engine underwriting income`);
    if (nui === undefined || ad === undefined || inv === undefined || noi === undefined || !near(nui + ad + inv, noi) || !near(noi, x.netIncome)) out.push(`${st.columns[i]}: net operating income does not tie`);
  });
  return out;
}

function totals(st: AnnualStatement): string[] {
  const out: string[] = [];
  const n = st.columns.length;
  for (const s of st.sections) for (const r of s.rows) {
    const game = r.cells.slice(1, n - 1), total = r.cells[n - 1];
    if (game.length === 0) continue;
    if (r.rowClass === 'point') {
      if (JSON.stringify(total) !== JSON.stringify(game[game.length - 1])) out.push(`${s.title} — ${r.label}: Total is not the latest year`);
    } else if (game.every(c => c.kind === 'value')) {
      const sum = game.reduce((a, c) => a + num(c)!, 0);
      if (num(total) === undefined || !near(num(total)!, sum)) out.push(`${s.title} — ${r.label}: Total is not the sum`);
    }
  }
  return out;
}

function blocksMeetBalanceSheet(st: AnnualStatement): string[] {
  const n = st.columns.length;
  const allYears = (l: string) => { const c = cellsOf(st, 'net', l); return (num(c[0]) ?? NaN) + (n > 2 ? (num(c[n - 1]) ?? NaN) : 0); };
  const reserves = (num(cellsOf(st, 'balance', 'Loss Reserves')[n > 2 ? n - 2 : 0]) ?? NaN)
    + (num(cellsOf(st, 'balance', 'Loss Expense Reserves')[n > 2 ? n - 2 : 0]) ?? NaN);
  return near(allYears('Case') + allYears('IBNR Reserve'), reserves) ? [] : [`net case + IBNR ${(allYears('Case') + allYears('IBNR Reserve')).toFixed(0)} vs reserves ${reserves.toFixed(0)}`];
}

const EXPECTED_NA = ['Gross — Loss and LAE Ratio (Prior)', 'Ceded (Reinsurance) — Loss and LAE Ratio (Prior)', 'Net — Loss and LAE Ratio (Prior)'];
function notAvailable(st: AnnualStatement): string[] {
  const got = notYetAvailable(st);
  return JSON.stringify(got) === JSON.stringify(EXPECTED_NA) ? [] : [`not-yet-available cells ${JSON.stringify(got)}`];
}

function renewalPlusNew(st: AnnualStatement): string[] {
  const c = (l: string) => cellsOf(st, 'underwriting', l);
  return eachColumn(st, [c('Renewal'), c('New Business'), c('Written Exposure')], ([r, nb, w]) => Math.abs(r + nb - w) <= 0.006,
    'renewal + new business ≠ written exposure').filter(x => !x.includes('(Total)'));
}

// ---------------------------------------------------------------------------
console.log('=== THE ANNUAL STATEMENT — solo ten-world games, three lines, pool and every line ===');
const played = play('STMT1', 10);
const opening = play('STMT2', 0);
const runs: { name: string; gs: GameState }[] = [{ name: 'ten years', gs: played }, { name: 'before year 1', gs: opening }];
const scopes: LineView[] = ['pool', ...LINES];
for (const { name, gs } of runs) {
  console.log(`\n--- ${name} ---`);
  const all = (f: (st: AnnualStatement, scope: LineView) => string[]) => scopes.flatMap(s => f(buildAnnualStatement(gs, s), s).map(x => `${s}: ${x}`));
  const r1 = all(reportedAndUltimate); check(r1.length === 0, '1. reported = paid + case; ultimate = reported + IBNR', r1[0] ?? '');
  const r2 = all(netIsGrossLessCeded); check(r2.length === 0, '2. net = gross − ceded, every row', r2[0] ?? '');
  const r3 = all((st, s) => balances(st, gs, s)); check(r3.length === 0, '3. the balance sheet balances, loss expense reserves included, and is the engine\'s', r3[0] ?? '');
  const r4 = all(combinedRatio); check(r4.length === 0, '4. combined ratio = (losses + LAE + expenses) / premium', r4[0] ?? '');
  const r5 = all((st, s) => tiesToEngine(st, gs, s)); check(r5.length === 0, '5. underwriting and net operating income tie to the engine', r5[0] ?? '');
  const r6 = all(totals); check(r6.length === 0, '6. Total sums flows and takes the latest year for balances, ratios and changes', r6[0] ?? '');
  const r7 = all(blocksMeetBalanceSheet); check(r7.length === 0, '7. net case + IBNR over every program year = loss + loss expense reserves', r7[0] ?? '');
  const r8 = all(notAvailable); check(r8.length === 0, '8. "not yet available" exactly where there is no source: Prior Loss and LAE Ratio, three blocks', r8[0] ?? '');
  const r9 = LINES.flatMap(l => renewalPlusNew(buildAnnualStatement(gs, l)).map(x => `${l}: ${x}`)); check(r9.length === 0, '9. renewal + new business = written exposure, every line', r9[0] ?? '');
}
{
  const ceded = buildAnnualStatement(played, 'pool');
  const recovered = num(cellsOf(ceded, 'ceded', 'Ultimates').at(-1)!) ?? 0;
  check(recovered > 0, 'the ten-year game recovered from its reinsurers, so the ceded block is tested on real figures', `ceded ultimates $${(recovered / 1e6).toFixed(2)}M`);
}

// ============================================================================
// THE CONTROLS — each check, fed a statement broken its way, must fail.
// ============================================================================
console.log('\n--- CONTROLS: every check fails when broken ---');
{
  const base = () => buildAnnualStatement(played, 'pool');
  const bump = (st: AnnualStatement, key: string, label: string, col: number, f: (x: number) => number, nth = 0): AnnualStatement => {
    const r = rowOf(st, key, label, nth) as StatementRow;
    const c = r.cells[col]; if (c.kind === 'value') r.cells[col] = { kind: 'value', v: f(c.v) };
    return st;
  };
  check(reportedAndUltimate(bump(base(), 'net', 'Case', 3, x => x + 1e5)).length > 0, 'control: a case reserve that is not in reported is caught');
  check(netIsGrossLessCeded(bump(base(), 'net', 'Premium', 2, x => x + 1.7e6)).length > 0, 'control: net premium read as gross is caught');
  check(balances(bump(base(), 'balance', 'Loss Expense Reserves', 4, () => 0), played, 'pool').length > 0, 'control: a balance sheet without its loss expense reserves is caught');
  check(combinedRatio(bump(base(), 'operating', 'Combined Ratio', 2, () => 1)).length > 0, 'control: the engine\'s pinned 1.000 in place of the worked ratio is caught');
  const st5 = base(); const lae = num(cellsOf(st5, 'operating', 'Incurred Loss Adjustment Expense')[2])!;
  check(tiesToEngine(bump(st5, 'operating', 'Net Underwriting Income', 2, x => x + lae), played, 'pool').length > 0, 'control: underwriting income that keeps the LAE is caught');
  const st6 = base(); const prem = rowOf(st6, 'operating', 'Premium'); prem.cells[prem.cells.length - 1] = prem.cells[prem.cells.length - 2];
  check(totals(st6).length > 0, 'control: a flow row totalled as its latest year is caught');
  const st6b = base(); const inv = rowOf(st6b, 'balance', 'Invested'); inv.cells[inv.cells.length - 1] = { kind: 'value', v: inv.cells.slice(1, -1).reduce((a, c) => a + (num(c) ?? 0), 0) };
  check(totals(st6b).length > 0, 'control: a balance summed across the years is caught');
  check(blocksMeetBalanceSheet(bump(base(), 'net', 'IBNR Reserve', 0, x => x - 5e5)).length > 0, 'control: blocks that miss the balance sheet are caught');
  const st8 = base(); rowOf(st8, 'net', 'Loss and LAE Ratio').cells[0] = { kind: 'value', v: 0 };
  check(notAvailable(st8).length > 0, 'control: a zero standing in for a figure with no source is caught');
  const st9 = buildAnnualStatement(played, 'WC'); bump(st9, 'underwriting', 'Renewal', 3, x => x + 1);
  check(renewalPlusNew(st9).length > 0, 'control: renewal and new business that miss the written exposure are caught');
}

console.log(failures.length === 0
  ? '\nTHE ANNUAL STATEMENT HOLDS TOGETHER: ALL CHECKS PASS.'
  : `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
