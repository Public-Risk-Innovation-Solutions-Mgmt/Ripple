// ============================================================================
// THE ANNUAL STATEMENT — THE GATE.
//
//   npx tsx scripts/diagnostics/results-statement-check.ts
//
// The results page's figures (utils/resultsStatement), built on a solo
// ten-world game as the app plays it — at the pool and on every line, at game
// start and after every year to ten — must hold together:
//
//   1. REPORTED = PAID + CASE, and ULTIMATE = REPORTED + IBNR, in every program-
//      year block and column.
//   2. NET = GROSS − CEDED, row by row — premium against reinsurance premium,
//      paid, case, reported, IBNR, ultimates.
//   3. THE BALANCE SHEET BALANCES, loss expense reserves included: invested +
//      cash = loss reserves + loss expense reserves + other liabilities +
//      paid-in capital + earned surplus; and each game year is the engine's own.
//   4. THE COMBINED RATIO is losses, LAE and expenses over premium — worked out
//      from the rows above it, never the engine's pinned expected ratio.
//   5. UNDERWRITING TIES TO THE ENGINE: Net Underwriting Income + Assessments/
//      Dividends is the engine's underwriting income in every column — Prior
//      as the sum over the years in it — and + Investment Income its net income.
//   6. TOTAL covers the five years shown: it sums the flow rows, takes a ratio
//      of premium from the summed figures (commit 11), and takes the latest
//      year for balances and changes.
//   7. THE BLOCKS MEET THE BALANCE SHEET: net case + IBNR over every program
//      year is the loss reserves plus the loss expense reserves.
//   8. NOTHING MISSING READS AS ZERO: the cells with no source are "not yet
//      available", and they are exactly the expected ones.
//   9. RENEWAL + NEW BUSINESS IS THE WRITTEN EXPOSURE, line by line.
//
// AND THE WINDOW:
//
//  10. IT ROLLS: the five most recent calendar years are the columns, labelled
//      by year; every older one is in Prior, labelled by what it holds.
//  11. PRIOR + THE FIVE RECONCILE TO THE FULL HISTORY: every operating flow and
//      every block's premium, summed over Prior and the window, is the sum over
//      every pre-game and game year.
//  12. THE PRE-GAME COLUMNS ARE THE ENGINE'S PRE-GAME RESULTS: at game start the
//      five columns are the last five of the six pre-game years, each tied to
//      its own result — the last year's year-end tied to the opening.
//  13. PRIOR HOLDS 2021 ALONE AT GAME START in every section: the pre-game runs
//      six years and the window shows five; the pool's history begins in 2021,
//      so nothing older is anywhere (the program-year blocks used to hold the
//      bulk reserves there).
//
// AND WHAT THE PLAYER SEES (the display commit):
//
//  14. THE COLUMNS ARE JUST YEARS: no header row of "Current" / "Year 0" /
//      "Year n" above them (removed with results-one-year-behind) — every
//      section carries no year labels, and each window column is its year.
//  15. NO SOURCE SHOWS BLANK: every "not yet available" cell renders as an
//      empty cell, and no other cell does.
//  16. THE YEAR SELECTOR: chosen at any year, the window is the five years
//      ending there and everything older is in Prior; the default is the
//      latest year. Checks 1-13 hold at EVERY year the selector offers, at
//      every point in the game — the program-year blocks valued at that year.
//
// ⚠ AND IT FAILS WHEN BROKEN — every check is a function over a statement, and
// THE CONTROLS feed each one a statement broken the way it guards against.
//
// ⚠ THE SHOCKS LANDING (2ae5c1a): a solo game now draws shocks, and the only
// thing a cover pays is a T claim (per-occurrence T covers, default None; the
// aggregate stop, which recovered on an ordinary bad year, is off). So the
// ceded block is real only in a game that buys cover AND carries a T claim:
// the game is STMT7 (GL's Nuclear Verdict in year 2, Property's Earthquake in
// year 6), every line holding the widest T cover every year. Its control: the
// same game on the default decisions (no cover) must recover nothing.
// ============================================================================

import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { fullTowerOption } from '../../src/utils/reinsuranceOptions';
import {
  buildAnnualStatement, cellText, COMBINED_RATIO_LABEL, notYetAvailable, num, statementYears, topCombinedRatio,
  type AnnualStatement, type Cell, type CellFormat, type StatementRow, type StatementSection,
} from '../../src/utils/resultsStatement';
import type { CoverageLine, DecisionSet, GameSetupSettings, GameState, LineView, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SCOPES: LineView[] = ['pool', ...LINES];
const YEARS = 10;
// ⚠ THE SPECIFICATION'S FIVE, STATED HERE — not imported from the builder, or a
// wrong window size would roll this check along with it.
const WINDOW = 5;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/** One game, its state at game start and after every year. */
/** The year's decisions: the defaults, with the widest T cover bought on every line (the shocks landing). */
function covered(y: number): DecisionSet {
  const d = defaultDecisionSet(y);
  for (const l of LINES) d.byLine[l].reinsuranceOption = fullTowerOption(l);
  return d;
}

function playSnapshots(id: string, years: number, decide: (y: number) => DecisionSet = covered): GameState[] {
  const { setup, instance } = openSoloInstance({ poolName: 'S', gameLength: years, startingYear: 2027, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory });
  const out = [gs];
  for (let y = 1; y <= years; y++) {
    const s = settleWorldsYear(gs, playWorldsYear(gs, decide(y)), []);
    gs = { ...gs, ...commitSettledYear(gs, s), currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
    out.push(gs);
  }
  return out;
}

/** Every pre-game and game year, oldest first — up to the year a statement stands at. */
const timelineOf = (gs: GameState, asOf = Infinity): ResultSet[] =>
  [...(gs.earlyPreGameHistory ?? []), ...gs.priorHistory, ...gs.lockedResults].filter(r => r.yearNumber <= asOf);
const at = (r: ResultSet, scope: LineView) => (scope === 'pool' ? r : r.byLine[scope]);
const sec = (st: AnnualStatement, key: string) => st.sections.find(s => s.key === key)!;
const rowOf = (st: AnnualStatement, key: string, label: string, nth = 0) => sec(st, key).rows.filter(r => r.label === label)[nth];
const cellsOf = (st: AnnualStatement, key: string, label: string, nth = 0) => rowOf(st, key, label, nth).cells;
/** The window's cell indexes on a section (after Prior, where it has one). */
const windowIx = (s: StatementSection) => s.windowYears.map((_, i) => i + (s.hasPrior ? 1 : 0));

/** For each column where every cell is a value, run f; collect what fails. */
function eachColumn(s: StatementSection, cols: Cell[][], f: (xs: number[]) => boolean, what: string): string[] {
  const out: string[] = [];
  s.columns.forEach((c, i) => {
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
    ...eachColumn(sec(st, k), [cellsOf(st, k, 'Paid Loss + LAE'), cellsOf(st, k, 'Case'), cellsOf(st, k, 'Reported Loss + LAE')],
      ([p, c, r]) => near(r, p + c), `${k}: reported ≠ paid + case`),
    ...eachColumn(sec(st, k), [cellsOf(st, k, 'Reported Loss + LAE'), cellsOf(st, k, 'IBNR Reserve'), cellsOf(st, k, 'Ultimates')],
      ([r, i, u]) => near(u, r + i), `${k}: ultimate ≠ reported + IBNR`),
  ]);
}

function netIsGrossLessCeded(st: AnnualStatement): string[] {
  const pairs: [string, string][] = [['Premium', 'Reinsurance Premium'], ['Paid Loss + LAE', 'Paid Loss + LAE'], ['Case', 'Case'],
    ['Reported Loss + LAE', 'Reported Loss + LAE'], ['IBNR Reserve', 'IBNR Reserve'], ['Ultimates', 'Ultimates']];
  return pairs.flatMap(([g, c]) => eachColumn(sec(st, 'net'), [cellsOf(st, 'gross', g), cellsOf(st, 'ceded', c), cellsOf(st, 'net', g)],
    ([gv, cv, nv]) => near(nv, gv - cv), `${g}: net ≠ gross − ceded`));
}

function balances(st: AnnualStatement, gs: GameState, scope: LineView): string[] {
  const s = sec(st, 'balance');
  const c = (l: string) => cellsOf(st, 'balance', l);
  const out = eachColumn(s, ['Invested', 'Cash', 'Loss Reserves', 'Loss Expense Reserves', 'Other Liabilities', 'Paid-in Capital', 'Earned Surplus'].map(c),
    ([inv, cash, lr, ler, ol, pic, es]) => near(inv + cash, lr + ler + ol + pic + es), 'assets ≠ liabilities + net worth');
  out.push(...eachColumn(s, [c('Paid-in Capital'), c('Earned Surplus'), c('Ending Surplus')], ([p, e, x]) => near(x, p + e), 'ending surplus ≠ paid-in + earned'));
  windowIx(s).forEach((ix, i) => {
    const y = s.windowYears[i];
    if (y < 1) return;
    const r = at(gs.lockedResults[y - 1], scope);
    const lae = num(c('Loss Expense Reserves')[ix]), sur = num(c('Ending Surplus')[ix]);
    if (lae === undefined || !near(lae, r.endingLaeReserve)) out.push(`${y}: loss expense reserves are not the engine's`);
    if (sur === undefined || !near(sur, r.endingSurplus)) out.push(`${y}: ending surplus is not the engine's`);
  });
  return out;
}

// ONE COMBINED RATIO: the net-of-reinsurance one — (losses + LAE + expenses)
// over the net Premium row — is gone from the statement; the only row of the
// name is the first, all costs over the member charge (held by check 17).
function combinedRatio(st: AnnualStatement): string[] {
  const rows = st.sections.flatMap(s => s.rows.filter(r => /combined ratio/i.test(r.label)).map(r => `${s.key}: ${r.label}`));
  return rows.length === 1 && rows[0] === `operating: ${COMBINED_RATIO_LABEL}` ? [] : [`combined ratio rows: ${rows.join('; ') || 'none'}`];
}

function tiesToEngine(st: AnnualStatement, gs: GameState, scope: LineView): string[] {
  const out: string[] = [];
  const s = sec(st, 'operating');
  const c = (l: string) => cellsOf(st, 'operating', l);
  const tl = timelineOf(gs, st.asOf);
  const first = tl.length - s.windowYears.length;
  const groups: { ix: number; years: ResultSet[] }[] = [
    ...(s.hasPrior ? [{ ix: 0, years: tl.slice(0, first) }] : []),
    ...windowIx(s).map((ix, i) => ({ ix, years: [tl[first + i]] })),
  ];
  for (const g of groups) {
    const uw = g.years.reduce((a, r) => a + at(r, scope).underwritingIncome, 0);
    const ni = g.years.reduce((a, r) => a + at(r, scope).netIncome, 0);
    const nui = num(c('Net Underwriting Income')[g.ix]), ad = num(c('Assessments/Dividends')[g.ix]);
    const inv = num(c('Investment Income')[g.ix]), noi = num(c('Net Operating Income')[g.ix]);
    if (nui === undefined || ad === undefined || !near(nui + ad, uw)) out.push(`${s.columns[g.ix]}: NUI + A/D ≠ engine underwriting income`);
    if (nui === undefined || ad === undefined || inv === undefined || noi === undefined || !near(nui + ad + inv, noi) || !near(noi, ni)) out.push(`${s.columns[g.ix]}: net operating income does not tie`);
  }
  return out;
}

// ⚠ A RATIO OF PREMIUM TOTALS FROM SUMMED FIGURES (stable-scenarios commit 11):
// its Total is the summed numerator over the summed premium — the premium-
// weighted average of the years' ratios — not the latest year's. Balance-sheet
// ratios and changes still take the latest year.
const OF_PREMIUM = new Set(['operating', 'gross', 'ceded', 'net']);
function totals(st: AnnualStatement): string[] {
  const out: string[] = [];
  for (const s of st.sections) for (const r of s.rows) {
    const game = windowIx(s).map(i => r.cells[i]), total = r.cells[r.cells.length - 1];
    if (game.length === 0) continue;
    // The combined ratio at the top totals since game start, not over the five (check 17).
    if (r.label === COMBINED_RATIO_LABEL) continue;
    const premRow = s.rows.find(x => x.label === 'Premium' || x.label === 'Reinsurance Premium');
    if (OF_PREMIUM.has(s.key) && r.format === 'pct' && r.label !== '% of Prior' && premRow) {
      const prem = windowIx(s).map(i => num(premRow.cells[i]));
      if (game.every(c => c.kind === 'value') && prem.every(x => x !== undefined)) {
        const den = prem.reduce((a, x) => a + x!, 0);
        const want = game.reduce((a, c, i) => a + num(c)! * prem[i]!, 0) / den;
        if (num(total) === undefined || !near(num(total)!, want)) out.push(`${s.title} — ${r.label}: Total is not the summed figures' ratio`);
      }
      continue;
    }
    if (r.rowClass === 'point') {
      if (JSON.stringify(total) !== JSON.stringify(game[game.length - 1])) out.push(`${s.title} — ${r.label}: Total is not the latest year`);
    } else if (game.every(c => c.kind === 'value')) {
      const sum = game.reduce((a, c) => a + num(c)!, 0);
      if (num(total) === undefined || !near(num(total)!, sum)) out.push(`${s.title} — ${r.label}: Total is not the sum of the five`);
    }
  }
  return out;
}

// ⚠ THE COMBINED RATIO — the statement's first row, and the header's figure,
// which reads it. Each year: every cost (net losses, LAE, admin, risk control,
// the reinsurance cost) over the member charge, off the engine's result — and
// the engine's own actualCombinedRatio. Total: the same summed over every
// PLAYED year since game start to the year the statement stands at — not the
// five shown — or over the pre-game years before year 1. And topCombinedRatio,
// what the header shows, is that Total.
const costsOf = (r: ResultSet, scope: LineView) => {
  const x = at(r, scope);
  return { costs: x.netIncurredLoss + x.laeIncurred + x.operatingExpense + x.riskControlInvestment + x.reinsuranceCost, charge: x.totalMemberCharge };
};
function topCombined(st: AnnualStatement, gs: GameState, scope: LineView): string[] {
  const out: string[] = [];
  const s = sec(st, 'operating');
  if (s.rows[0]?.label !== COMBINED_RATIO_LABEL) return ['the combined ratio is not the first row'];
  const cells = s.rows[0].cells;
  const tl = timelineOf(gs, st.asOf);
  const first = tl.length - s.windowYears.length;
  windowIx(s).forEach((ix, i) => {
    const r = tl[first + i];
    const { costs, charge } = costsOf(r, scope);
    if (num(cells[ix]) === undefined || !near(num(cells[ix])!, costs / charge)) out.push(`${s.columns[ix]}: combined ratio is not every cost over the member charge`);
    if (num(cells[ix]) !== undefined && !near(num(cells[ix])!, at(r, scope).actualCombinedRatio)) out.push(`${s.columns[ix]}: combined ratio is not the engine's actualCombinedRatio`);
  });
  const played = tl.filter(r => r.yearNumber >= 1);
  const over = played.length > 0 ? played : tl;
  const sum = over.reduce((a, r) => { const c = costsOf(r, scope); return { costs: a.costs + c.costs, charge: a.charge + c.charge }; }, { costs: 0, charge: 0 });
  const total = cells[cells.length - 1];
  if (num(total) === undefined || !near(num(total)!, sum.costs / sum.charge)) {
    out.push(played.length > 0 ? 'Total is not cumulative over every played year since game start' : 'Total is not cumulative over the pre-game years');
  }
  if (topCombinedRatio(st) !== num(total)) out.push('the header\'s figure is not the row\'s Total');
  return out;
}

function blocksMeetBalanceSheet(st: AnnualStatement): string[] {
  const n = sec(st, 'net'), b = sec(st, 'balance');
  const allYears = (l: string) => { const c = cellsOf(st, 'net', l); return [...(n.hasPrior ? [0] : []), ...windowIx(n)].reduce((a, i) => a + (num(c[i]) ?? NaN), 0); };
  const last = windowIx(b).at(-1)!;
  const reserves = (num(cellsOf(st, 'balance', 'Loss Reserves')[last]) ?? NaN) + (num(cellsOf(st, 'balance', 'Loss Expense Reserves')[last]) ?? NaN);
  const blocks = allYears('Case') + allYears('IBNR Reserve');
  return near(blocks, reserves) ? [] : [`net case + IBNR ${blocks.toFixed(0)} vs reserves ${reserves.toFixed(0)}`];
}

/**
 * The cells with no source, by state: what is genuinely missing at each point.
 * `played` is the game years the SHOWN timeline holds — 0 for a statement
 * standing at the opening or earlier.
 */
function expectedNotAvailable(st: AnnualStatement, scope: LineView, windowLength = WINDOW): string[] {
  // At pool scope the underwriting rows read "by line", not "not yet available".
  const uw = (xs: string[]) => (scope === 'pool' ? [] : xs);
  const blocks: [string, string][] = [['Gross', 'Premium'], ['Ceded (Reinsurance)', 'Reinsurance Premium'], ['Net', 'Premium']];
  // ⚠ WHETHER THE WINDOW HOLDS THE FIRST PRE-GAME YEAR, not how many years were
  // played: the pre-game runs six years (2021-2026) and the window five, so at
  // game start 2021 is already in Prior.
  if (!sec(st, 'operating').hasPrior) {
    // Nothing before the first pre-game year to change from, and no Prior: the
    // pool's history begins in 2021.
    // Standing at the first pre-game year, that year is the window's only one,
    // so the change rows' Total — the latest year's — has no source either.
    const cols = windowLength === 1 ? ['2021', 'Total'] : ['2021'];
    return [
      ...uw(cols.flatMap(c => [`Underwriting — Change from Prior (${c})`, `Underwriting — % Change Over Prior (${c})`])),
      ...blocks.flatMap(([t]) => cols.flatMap(c => [`${t} — Change from Prior (${c})`, `${t} — % of Prior (${c})`])),
    ];
  }
  // The blocks' Prior, as labelled (its label is check 10's). With Prior holding
  // 2021 alone there is no year before it for the underwriting change rows.
  const prior = sec(st, 'gross').columns[0];
  const uwPrior = sec(st, 'underwriting').columns[0];
  return [
    ...(uwPrior === 'Prior (2021)' ? uw(['Underwriting — Change from Prior (Prior (2021))', 'Underwriting — % Change Over Prior (Prior (2021))']) : []),
    ...blocks.map(([t]) => `${t} — Loss and LAE Ratio (${prior})`),
  ];
}
function notAvailable(st: AnnualStatement, played: number, scope: LineView): string[] {
  const got = [...notYetAvailable(st)].sort();
  void played;
  const want = [...expectedNotAvailable(st, scope, sec(st, 'operating').windowYears.length)].sort();
  return JSON.stringify(got) === JSON.stringify(want) ? [] : [`not-yet-available cells ${JSON.stringify(got)} — expected ${JSON.stringify(want)}`];
}

function renewalPlusNew(st: AnnualStatement): string[] {
  const c = (l: string) => cellsOf(st, 'underwriting', l);
  return eachColumn(sec(st, 'underwriting'), [c('Renewal'), c('New Business'), c('Written Exposure')], ([r, nb, w]) => Math.abs(r + nb - w) <= 0.006,
    'renewal + new business ≠ written exposure').filter(x => !x.includes('(Total)') && !x.includes('(Prior'));
}

// --- THE WINDOW ---------------------------------------------------------------
/** 10. The calendar columns: the last five calendar years, Prior labelled by what it holds. */
function expectedCalendarColumns(gs: GameState, asOf = Infinity): string[] {
  const tl = timelineOf(gs, asOf);
  const first = Math.max(0, tl.length - WINDOW);
  const rolled = tl.slice(0, first);
  const pre = tl.filter(r => r.yearNumber <= 0).length;
  const prior = rolled.length === 0 ? [] : [rolled.length === pre && rolled.every(r => r.yearNumber <= 0) ? 'Prior (all pre-game)'
    : rolled.length === 1 ? `Prior (${rolled[0].calendarYear})`
    : `Prior (${rolled[0].calendarYear}–${String(rolled.at(-1)!.calendarYear).slice(-2)})`];
  return [...prior, ...tl.slice(first).map(r => `${r.calendarYear}`), 'Total'];
}
function windowRolls(st: AnnualStatement, gs: GameState): string[] {
  const want = expectedCalendarColumns(gs, st.asOf);
  const out: string[] = [];
  for (const k of ['operating', 'balance', 'underwriting']) {
    if (JSON.stringify(sec(st, k).columns) !== JSON.stringify(want)) out.push(`${k} columns ${sec(st, k).columns.join(' · ')} — expected ${want.join(' · ')}`);
  }
  for (const k of ['gross', 'ceded', 'net']) {
    const s = sec(st, k);
    if (JSON.stringify(s.columns.slice(s.hasPrior ? 1 : 0)) !== JSON.stringify(want.filter(c => !c.startsWith('Prior')))) out.push(`${k} window ≠ the calendar window`);
  }
  return out;
}

/** 11. Prior + the five = every year, for each operating flow and each block's premium. */
function reconciles(st: AnnualStatement, gs: GameState, scope: LineView): string[] {
  const tl = timelineOf(gs, st.asOf).map(r => at(r, scope));
  const out: string[] = [];
  const sumOf = (s: StatementSection, cells: Cell[]) => [...(s.hasPrior ? [0] : []), ...windowIx(s)].reduce((a, i) => a + (num(cells[i]) ?? NaN), 0);
  const flows: [string, (r: typeof tl[number]) => number][] = [
    ['Premium', r => r.totalMemberCharge - r.reinsuranceCost], ['Incurred Losses', r => r.netIncurredLoss],
    ['Incurred Loss Adjustment Expense', r => r.laeIncurred], ['Investment Income', r => r.investmentIncome], ['Net Operating Income', r => r.netIncome],
  ];
  for (const [label, f] of flows) {
    const got = sumOf(sec(st, 'operating'), cellsOf(st, 'operating', label)), want = tl.reduce((a, r) => a + f(r), 0);
    if (!near(got, want)) out.push(`operating ${label}: Prior + window ${got.toFixed(0)} vs every year ${want.toFixed(0)}`);
  }
  const prem: [string, string, (r: typeof tl[number]) => number][] = [
    ['gross', 'Premium', r => r.totalMemberCharge], ['ceded', 'Reinsurance Premium', r => r.reinsuranceCost],
    ['net', 'Premium', r => r.poolPremiumAndAdminExpense + (r.retainedCoverMargin ?? 0)],
  ];
  for (const [k, label, f] of prem) {
    const s = sec(st, k), cells = cellsOf(st, k, label);
    // At game start Prior holds only the bulk years, which have no premium.
    const got = (s.hasPrior && cells[0].kind === 'na' ? 0 : sumOf(s, cells.map((c, i) => (i === 0 && c.kind === 'na' ? { kind: 'value', v: 0 } as Cell : c))));
    const want = tl.reduce((a, r) => a + f(r), 0);
    if (!near(got, want) && !(s.hasPrior && cells[0].kind === 'na' && near(windowIx(s).reduce((a, i) => a + (num(cells[i]) ?? NaN), 0), want))) {
      out.push(`${k} ${label}: Prior + window ${got.toFixed(0)} vs every year ${want.toFixed(0)}`);
    }
  }
  return out;
}

/**
 * 12. At game start, the five columns are the LAST FIVE pre-game years, each its
 * own result — the pre-game runs six (2021-2026), so 2021 is in Prior (13).
 */
function preGameTies(st: AnnualStatement, gs: GameState, scope: LineView): string[] {
  const out: string[] = [];
  const pre = [...(gs.earlyPreGameHistory ?? []), ...gs.priorHistory].slice(-WINDOW);
  const op = sec(st, 'operating'), bs = sec(st, 'balance');
  // A window that is not the five pre-game years cannot be tied column by column.
  if (JSON.stringify(op.windowYears) !== JSON.stringify(pre.map(r => r.yearNumber))) return [`window years ${op.windowYears} are not the pre-game's ${pre.map(r => r.yearNumber)}`];
  pre.forEach((r, i) => {
    const x = at(r, scope);
    const tie = (label: string, want: number, key = 'operating') => {
      const got = num(cellsOf(st, key, label)[windowIx(sec(st, key))[i]]);
      if (got === undefined || !near(got, want)) out.push(`${r.calendarYear} ${label}: ${got} vs the engine's ${want}`);
    };
    tie('Premium', x.totalMemberCharge - x.reinsuranceCost);
    tie('Incurred Losses', x.netIncurredLoss);
    tie('Incurred Loss Adjustment Expense', x.laeIncurred);
    tie('General Admin Expense', x.operatingExpense);
    tie('Investment Income', x.investmentIncome);
    tie('Assessments/Dividends', x.assessments - x.dividends);
    tie('Net Operating Income', x.netIncome);
    tie('Premium', x.totalMemberCharge, 'gross');
    // Each year-end is the year's own — the last pre-game year's is the opening.
    const lines: CoverageLine[] = scope === 'pool' ? gs.setup.activeLines : [scope];
    // The opening: the pool state's own before year 1; year 1's beginning after.
    const sur = r.yearNumber !== 0 ? x.endingSurplus
      : gs.lockedResults[0] ? at(gs.lockedResults[0], scope).beginingSurplus
      : lines.reduce((a, l) => a + gs.poolState.lines[l].surplus, 0);
    const got = num(cellsOf(st, 'balance', 'Ending Surplus')[windowIx(bs)[i]]);
    if (got === undefined || !near(got, sur)) out.push(`${r.calendarYear} ending surplus ${got} vs ${sur}`);
  });
  return out;
}

/**
 * 13. At game start Prior holds exactly the first pre-game year, 2021, in every
 * section: the pre-game runs six years and the window shows five, and the
 * pool's history begins in 2021, so nothing older is anywhere. (The program-year
 * blocks used to carry a "Prior (before 2021)" for the bulk reserves, now
 * retired; with five pre-game years Prior was absent at game start.)
 */
function priorAtStart(st: AnnualStatement): string[] {
  const out: string[] = [];
  for (const k of ['operating', 'balance', 'underwriting', 'gross', 'ceded', 'net']) {
    // The program-year blocks label it in their own style, "(2021 and earlier)".
    if (!sec(st, k).hasPrior || !['Prior (2021)', 'Prior (2021 and earlier)'].includes(sec(st, k).columns[0])) {
      out.push(`${k}: Prior at game start is "${sec(st, k).columns[0]}", not 2021 alone`);
    }
  }
  return out;
}

// --- WHAT THE PLAYER SEES -------------------------------------------------------
/** 14. The columns are just years: no year-label row, and each window column is its calendar year. */
function yearLabels(st: AnnualStatement, gs: GameState): string[] {
  const calendarOf = new Map(timelineOf(gs).map(r => [r.yearNumber, String(r.calendarYear)]));
  const out: string[] = [];
  for (const s of st.sections) {
    if ('yearLabels' in s) out.push(`${s.title}: carries a year-label row`);
    const cols = s.columns.slice(s.hasPrior ? 1 : 0, -1);
    const want = s.windowYears.map(y => calendarOf.get(y));
    if (JSON.stringify(cols) !== JSON.stringify(want)) out.push(`${s.title}: columns ${cols.join(' · ')} — expected the years ${want.join(' · ')}`);
  }
  return out;
}

/** 15. A cell with no source renders blank, and nothing else does. */
function blanks(st: AnnualStatement, text: (c: Cell, f: CellFormat) => string): string[] {
  const out: string[] = [];
  for (const s of st.sections) for (const r of s.rows) r.cells.forEach((c, i) => {
    const t = text(c, r.format);
    if ((c.kind === 'na') !== (t === '')) out.push(`${s.title} — ${r.label} (${s.columns[i]}): ${c.kind} shows "${t}"`);
  });
  return out;
}

/** 16. Chosen at `year`, the window is the five years ending there; older years are in Prior. */
function selector(st: AnnualStatement, gs: GameState, year: number): string[] {
  const tl = timelineOf(gs, year);
  const want = tl.slice(Math.max(0, tl.length - WINDOW)).map(r => r.yearNumber);
  const out: string[] = [];
  if (st.asOf !== year) out.push(`asked for ${year}, stands at ${st.asOf}`);
  for (const k of ['operating', 'balance', 'underwriting']) {
    const s = sec(st, k);
    if (JSON.stringify(s.windowYears) !== JSON.stringify(want)) out.push(`${k} window ${s.windowYears} — expected ${want}`);
    if (s.hasPrior !== tl.length > WINDOW) out.push(`${k}: Prior ${s.hasPrior ? 'shown' : 'missing'} with ${tl.length} years up to ${year}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
console.log(`=== THE ANNUAL STATEMENT — a solo ten-world game, three lines, game start and every year to ${YEARS}, pool and every line ===`);
// STMT7, not STMT1, since the shocks landing: STMT1 draws no T claim, so no cover would pay.
const GAME = 'STMT7';
const snaps = playSnapshots(GAME, YEARS);
const agg: Record<string, string[]> = {};
const note = (k: string, xs: string[]) => { (agg[k] ??= []).push(...xs); };
let statements = 0;
snaps.forEach((gs, played) => {
  const latest = timelineOf(gs).at(-1)!.yearNumber;
  for (const scope of SCOPES) {
    // The default is the latest year, field for field.
    if (JSON.stringify(buildAnnualStatement(gs, scope)) !== JSON.stringify(buildAnnualStatement(gs, scope, latest))) {
      note('16', [`after ${played}, ${scope}: the default is not the latest year`]);
    }
   for (const { yearNumber: year } of statementYears(gs)) {
    const st = buildAnnualStatement(gs, scope, year);
    statements++;
    const tag = (xs: string[]) => xs.map(x => `after ${played}, ${scope}, as of ${year}: ${x}`);
    note('1', tag(reportedAndUltimate(st)));
    note('2', tag(netIsGrossLessCeded(st)));
    note('3', tag(balances(st, gs, scope)));
    note('4', tag(combinedRatio(st)));
    note('5', tag(tiesToEngine(st, gs, scope)));
    note('6', tag(totals(st)));
    note('7', tag(blocksMeetBalanceSheet(st)));
    note('8', tag(notAvailable(st, year, scope)));
    if (scope !== 'pool') note('9', tag(renewalPlusNew(st)));
    note('10', tag(windowRolls(st, gs)));
    note('11', tag(reconciles(st, gs, scope)));
    // The opening's view: at game start, and chosen at Year 0 later on.
    if (year === 0) { note('12', tag(preGameTies(st, gs, scope))); note('13', tag(priorAtStart(st))); }
    note('14', tag(yearLabels(st, gs)));
    note('15', tag(blanks(st, cellText)));
    note('16', tag(selector(st, gs, year)));
    note('17', tag(topCombined(st, gs, scope)));
   }
  }
});
const labels: Record<string, string> = {
  1: 'reported = paid + case; ultimate = reported + IBNR', 2: 'net = gross − ceded, every row',
  3: 'the balance sheet balances, loss expense reserves included, and each game year is the engine\'s',
  4: 'one combined ratio on the statement: the net-of-reinsurance one is gone, the first row is the only one', 5: 'underwriting and net operating income tie to the engine, Prior included',
  6: 'Total covers the five shown: sums flows, summed figures for ratios of premium, latest year for balances and changes',
  7: 'net case + IBNR over every program year = loss + loss expense reserves',
  8: '"not yet available" exactly where there is no source, at every point', 9: 'renewal + new business = written exposure, every line',
  10: 'the window rolls: the five most recent calendar years, older ones in Prior, labelled as specified',
  11: 'Prior + the five reconcile to the full history — operating flows and every block\'s premium',
  12: 'at game start the five columns are the last five pre-game years, tied to the engine\'s results',
  13: 'at game start Prior holds 2021 alone in every section — nothing predates 2021',
  14: 'the columns are just years: no year-label row, each window column its calendar year',
  15: 'a cell with no source shows blank, and no other cell does',
  16: 'the year selector: the five years ending at the chosen year, older years in Prior; the default is the latest',
  17: 'the combined ratio is the first row: every cost over the member charge each year (the engine\'s actualCombinedRatio), Total cumulative since game start (over the pre-game years before year 1), and the header shows exactly that Total',
};
console.log(`\n--- ${snaps.length} points (game start and after 1 to ${YEARS}) x ${SCOPES.length} scopes x every year the selector offers: ${statements} statements ---`);
for (const k of Object.keys(labels)) check((agg[k] ?? []).length === 0, `${k}. ${labels[k]}`, (agg[k] ?? [])[0] ?? '');
{
  const cols = (n: number) => sec(buildAnnualStatement(snaps[n], 'pool'), 'operating').columns.join(' · ');
  console.log(`\n  game start    ${cols(0)}\n  after year 1  ${cols(1)}\n  after year 2  ${cols(2)}\n  after year 5  ${cols(5)}\n  after year 6  ${cols(6)}`);
  // Over every program year — Prior and the five — not the latest five alone.
  const recoveredBy = (gs: GameState) => {
    const ced = cellsOf(buildAnnualStatement(gs, 'pool'), 'ceded', 'Ultimates');
    return (num(ced[0]) ?? 0) + (num(ced.at(-1)!) ?? 0);
  };
  const recovered = recoveredBy(snaps[YEARS]);
  check(recovered > 1, 'the game recovered from its reinsurers, so the ceded block is tested on real figures', `ceded ultimates, every program year $${(recovered / 1e6).toFixed(2)}M`);
  // THE CONTROL (the shocks landing): the same game holding no cover — the
  // default decisions — recovers nothing, so the check above must fail on it.
  // ⚠ "NOTHING" IS UNDER A DOLLAR (wip/adverse-development): the ceded cell is
  // gross less net, and with adverse development on both sides the difference
  // of two equal figures reads 5.8e-11, not 0. The check above is held to the
  // same dollar, so the control still fails it.
  const bare = recoveredBy(playSnapshots(GAME, YEARS, defaultDecisionSet)[YEARS]);
  check(!(bare > 1), 'control: the same game holding no cover (the defaults) recovers nothing, and the check fails on it', `ceded ultimates $${(bare / 1e6).toFixed(2)}M (${bare})`);
}

// ============================================================================
// THE CONTROLS — each check, fed a statement broken its way, must fail.
// ============================================================================
console.log('\n--- CONTROLS: every check fails when broken ---');
{
  const played = 6, gs = snaps[played];
  const base = () => buildAnnualStatement(gs, 'pool');
  const bump = (st: AnnualStatement, key: string, label: string, col: number, f: (x: number) => number, nth = 0): AnnualStatement => {
    const r = rowOf(st, key, label, nth) as StatementRow;
    const c = r.cells[col]; if (c.kind === 'value') r.cells[col] = { kind: 'value', v: f(c.v) };
    return st;
  };
  check(reportedAndUltimate(bump(base(), 'net', 'Case', 3, x => x + 1e5)).length > 0, 'control: a case reserve that is not in reported is caught');
  check(netIsGrossLessCeded(bump(base(), 'net', 'Premium', 2, x => x + 1.7e6)).length > 0, 'control: net premium read as gross is caught');
  check(balances(bump(base(), 'balance', 'Loss Expense Reserves', 4, () => 0), gs, 'pool').length > 0, 'control: a balance sheet without its loss expense reserves is caught');
  const st4 = base(); const op4 = sec(st4, 'operating'); op4.rows.splice(10, 0, { ...op4.rows[0], label: 'Combined Ratio (net of reinsurance)' });
  check(combinedRatio(st4).length > 0, 'control: a second, net-of-reinsurance combined ratio on the statement is caught');
  const st5 = base(); const lae = num(cellsOf(st5, 'operating', 'Incurred Loss Adjustment Expense')[2])!;
  check(tiesToEngine(bump(st5, 'operating', 'Net Underwriting Income', 2, x => x + lae), gs, 'pool').length > 0, 'control: underwriting income that keeps the LAE is caught');
  const st6 = base(); const prem = rowOf(st6, 'operating', 'Premium'); prem.cells[prem.cells.length - 1] = prem.cells[prem.cells.length - 2];
  check(totals(st6).length > 0, 'control: a flow row totalled as its latest year is caught');
  const st6b = base(); const inv = rowOf(st6b, 'balance', 'Invested'); inv.cells[inv.cells.length - 1] = { kind: 'value', v: inv.cells.slice(1, -1).reduce((a, c) => a + (num(c) ?? 0), 0) };
  check(totals(st6b).length > 0, 'control: a balance summed across the years is caught');
  const st6c = base(); const p2 = rowOf(st6c, 'operating', 'Premium'); p2.cells[p2.cells.length - 1] = { kind: 'value', v: p2.cells.slice(0, -1).reduce((a, c) => a + (num(c) ?? 0), 0) };
  check(totals(st6c).length > 0, 'control: a Total that counts Prior as well as the five is caught');
  const st6d = base(); const lr = rowOf(st6d, 'operating', 'Loss & LAE Ratio'); lr.cells[lr.cells.length - 1] = lr.cells[lr.cells.length - 2];
  check(totals(st6d).length > 0, 'control: a ratio of premium totalled as its latest year is caught');
  check(blocksMeetBalanceSheet(bump(base(), 'net', 'IBNR Reserve', 0, x => x - 5e5)).length > 0, 'control: blocks that miss the balance sheet are caught');
  const st8 = base(); rowOf(st8, 'net', 'Loss and LAE Ratio').cells[0] = { kind: 'value', v: 0 };
  check(notAvailable(st8, played, 'pool').length > 0, 'control: a zero standing in for a figure with no source is caught');
  const st9 = buildAnnualStatement(gs, 'WC'); bump(st9, 'underwriting', 'Renewal', 3, x => x + 1);
  check(renewalPlusNew(st9).length > 0, 'control: renewal and new business that miss the written exposure are caught');
  // The window.
  // Last year's statement shown as this year's: it claims the latest year and kept last year's window.
  check(windowRolls({ ...buildAnnualStatement(snaps[played - 1], 'pool'), asOf: played }, gs).length > 0, 'control: a window that did not roll is caught');
  check(reconciles(bump(base(), 'operating', 'Premium', 0, x => x - 1e6), gs, 'pool').length > 0, 'control: a Prior that dropped a year is caught');
  const st12 = buildAnnualStatement(snaps[0], 'GL'); const pr = rowOf(st12, 'operating', 'Premium');
  [pr.cells[0], pr.cells[1]] = [pr.cells[1], pr.cells[0]];
  check(preGameTies(st12, snaps[0], 'GL').length > 0, 'control: pre-game columns in the wrong years are caught');
  const st13 = buildAnnualStatement(snaps[0], 'pool'); sec(st13, 'operating').columns[0] = 'Prior (2020–21)';
  check(priorAtStart(st13).length > 0, 'control: a Prior at game start holding a year before 2021 is caught');
  const st13b = buildAnnualStatement(snaps[0], 'pool'); sec(st13b, 'balance').hasPrior = false;
  check(priorAtStart(st13b).length > 0, 'control: a Prior missing at game start, 2021 dropped, is caught');
  // What the player sees.
  const st14 = buildAnnualStatement(gs, 'pool', 3); const op14 = sec(st14, 'operating');
  op14.columns[op14.windowYears.indexOf(3) + (op14.hasPrior ? 1 : 0)] = 'Current';
  check(yearLabels(st14, gs).length > 0, 'control: a column labelled "Current" in place of its year is caught');
  const st14b = buildAnnualStatement(snaps[0], 'pool');
  Object.assign(sec(st14b, 'gross'), { yearLabels: sec(st14b, 'gross').columns.map(() => '') });
  check(yearLabels(st14b, snaps[0]).length > 0, 'control: a year-label row put back is caught');
  const shown = (c: Cell, f: CellFormat) => (c.kind === 'na' ? 'not yet available' : cellText(c, f));
  check(blanks(base(), shown).length > 0, 'control: "not yet available" printed in place of a blank is caught');
  check(selector(base(), gs, 3).length > 0, 'control: a selector that ignores the chosen year is caught');
  // Valued at the latest year instead of the chosen one, the blocks miss the chosen year's reserves.
  const st16 = buildAnnualStatement(gs, 'pool', 3); const latestNet = sec(base(), 'net');
  const n16 = sec(st16, 'net'); n16.rows = latestNet.rows.map(r => ({ ...r, cells: [...r.cells] }));
  check(blocksMeetBalanceSheet(st16).length > 0, 'control: blocks valued at the latest year under a chosen earlier year are caught');
  // The combined ratio at the top.
  check(topCombined(bump(base(), 'operating', COMBINED_RATIO_LABEL, 2, x => x * 1.05), gs, 'pool').length > 0, 'control: a combined ratio off by 5% in one year is caught');
  const st17b = base(); const c17b = rowOf(st17b, 'operating', COMBINED_RATIO_LABEL);
  // Over the window instead of since game start: at year 6 the five shown are years 2-6, so year 1 drops out.
  const winCosts = sec(st17b, 'operating').windowYears.map(y => costsOf(timelineOf(gs).find(r => r.yearNumber === y)!, 'pool'));
  c17b.cells[c17b.cells.length - 1] = { kind: 'value', v: winCosts.reduce((a, x) => a + x.costs, 0) / winCosts.reduce((a, x) => a + x.charge, 0) };
  check(topCombined(st17b, gs, 'pool').length > 0, 'control: a cumulative over the five shown instead of since game start is caught');
  const st17c = buildAnnualStatement(snaps[0], 'WC'); const c17c = rowOf(st17c, 'operating', COMBINED_RATIO_LABEL);
  c17c.cells[c17c.cells.length - 1] = c17c.cells[c17c.cells.length - 2];
  check(topCombined(st17c, snaps[0], 'WC').length > 0, 'control: before year 1, the last pre-game year in place of the pre-game cumulative is caught');
}

console.log(failures.length === 0
  ? '\nTHE ANNUAL STATEMENT HOLDS TOGETHER: ALL CHECKS PASS.'
  : `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
