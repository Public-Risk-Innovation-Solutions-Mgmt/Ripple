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
//      five columns are the five pre-game years, each tied to its own result —
//      the last year's year-end tied to the opening.
//  13. PRIOR IS ABSENT AT GAME START where nothing predates the window — the
//      calendar sections — and present in the program-year blocks, which hold
//      the older reserves.
//
// AND WHAT THE PLAYER SEES (the display commit):
//
//  14. THE YEAR LABELS: a header row above the year columns in every section —
//      "Current" on the game's actual latest year only, "Year 0" on the last
//      pre-game year and "Year n" on each played year after it, nothing on the
//      earlier pre-game years, Prior or Total.
//  15. NO SOURCE SHOWS BLANK: every "not yet available" cell renders as an
//      empty cell, and no other cell does.
//  16. THE YEAR SELECTOR: chosen at any year, the window is the five years
//      ending there and everything older is in Prior; the default is the
//      latest year. Checks 1-13 hold at EVERY year the selector offers, at
//      every point in the game — the program-year blocks valued at that year.
//
// ⚠ AND IT FAILS WHEN BROKEN — every check is a function over a statement, and
// THE CONTROLS feed each one a statement broken the way it guards against.
// ============================================================================

import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import {
  buildAnnualStatement, cellText, notYetAvailable, num, statementYears,
  type AnnualStatement, type Cell, type CellFormat, type StatementRow, type StatementSection,
} from '../../src/utils/resultsStatement';
import type { CoverageLine, GameSetupSettings, GameState, LineView, ResultSet } from '../../src/types/simulation';

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
function playSnapshots(id: string, years: number): GameState[] {
  const { setup, instance } = openSoloInstance({ poolName: 'S', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory });
  const out = [gs];
  for (let y = 1; y <= years; y++) {
    const s = settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), []);
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

function combinedRatio(st: AnnualStatement): string[] {
  const s = sec(st, 'operating');
  const c = (l: string, n = 0) => cellsOf(st, 'operating', l, n);
  return eachColumn(s, [c('Total Incurred Loss & LAE'), c('General Admin Expense'), c('Additional Admin Expense (risk control)'), c('Premium'), c('Combined Ratio')],
    ([ll, ga, ra, p, cr]) => near(cr, (ll + ga + ra) / p), 'combined ratio ≠ (losses + LAE + expenses) / premium')
    // The Total column holds too: its ratio is the summed figures' (commit 11).
    ;
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
function expectedNotAvailable(played: number, scope: LineView, windowLength = WINDOW): string[] {
  // At pool scope the underwriting rows read "by line", not "not yet available".
  const uw = (xs: string[]) => (scope === 'pool' ? [] : xs);
  const blocks: [string, string][] = [['Gross', 'Premium'], ['Ceded (Reinsurance)', 'Reinsurance Premium'], ['Net', 'Premium']];
  if (played === 0) {
    // Nothing before the first pre-game year to change from; the bulk years
    // alone in Prior carry no premium.
    // Standing at the first pre-game year, that year is the window's only one,
    // so the change rows' Total — the latest year's — has no source either.
    const cols = windowLength === 1 ? ['2021', 'Total'] : ['2021'];
    return [
      ...uw(cols.flatMap(c => [`Underwriting — Change from Prior (${c})`, `Underwriting — % Change Over Prior (${c})`])),
      ...blocks.flatMap(([t, p]) => [`${t} — ${p} (Prior (before 2021))`, `${t} — Loss and LAE Ratio (Prior (before 2021))`,
        ...cols.flatMap(c => [`${t} — Change from Prior (${c})`, `${t} — % of Prior (${c})`])]),
    ];
  }
  const prior = `Prior (${2021 + played - 1} and earlier)`;
  return [
    ...(played === 1 ? uw(['Underwriting — Change from Prior (Prior (2021))', 'Underwriting — % Change Over Prior (Prior (2021))']) : []),
    ...blocks.map(([t]) => `${t} — Loss and LAE Ratio (${prior})`),
  ];
}
function notAvailable(st: AnnualStatement, played: number, scope: LineView): string[] {
  const got = [...notYetAvailable(st)].sort();
  const want = [...expectedNotAvailable(Math.max(0, Math.min(played, st.asOf)), scope, sec(st, 'operating').windowYears.length)].sort();
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

/** 12. At game start, the five columns are the five pre-game years, each its own result. */
function preGameTies(st: AnnualStatement, gs: GameState, scope: LineView): string[] {
  const out: string[] = [];
  const pre = [...(gs.earlyPreGameHistory ?? []), ...gs.priorHistory];
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

/** 13. At game start Prior is absent from the calendar sections and present in the blocks. */
function priorAtStart(st: AnnualStatement): string[] {
  const out: string[] = [];
  for (const k of ['operating', 'balance', 'underwriting']) if (sec(st, k).hasPrior || sec(st, k).columns[0].startsWith('Prior')) out.push(`${k} shows a Prior at game start`);
  for (const k of ['gross', 'ceded', 'net']) if (!sec(st, k).hasPrior || sec(st, k).columns[0] !== 'Prior (before 2021)') out.push(`${k} has no Prior for the older reserves`);
  return out;
}

// --- WHAT THE PLAYER SEES -------------------------------------------------------
/** 14. The header row: "Current" on the actual latest year only, "Year n" from Year 0 on, blank elsewhere. */
function yearLabels(st: AnnualStatement, gs: GameState): string[] {
  const latest = timelineOf(gs).at(-1)!.yearNumber;
  const out: string[] = [];
  for (const s of st.sections) {
    const want = [...(s.hasPrior ? [''] : []), ...s.windowYears.map(y => (y === latest ? 'Current' : y >= 0 ? `Year ${y}` : '')), ''];
    if (s.yearLabels.length !== s.columns.length) out.push(`${s.title}: ${s.yearLabels.length} labels for ${s.columns.length} columns`);
    if (JSON.stringify(s.yearLabels) !== JSON.stringify(want)) out.push(`${s.title}: labels ${s.yearLabels.join(' · ')} — expected ${want.join(' · ')}`);
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
const snaps = playSnapshots('STMT1', YEARS);
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
   }
  }
});
const labels: Record<string, string> = {
  1: 'reported = paid + case; ultimate = reported + IBNR', 2: 'net = gross − ceded, every row',
  3: 'the balance sheet balances, loss expense reserves included, and each game year is the engine\'s',
  4: 'combined ratio = (losses + LAE + expenses) / premium', 5: 'underwriting and net operating income tie to the engine, Prior included',
  6: 'Total covers the five shown: sums flows, summed figures for ratios of premium, latest year for balances and changes',
  7: 'net case + IBNR over every program year = loss + loss expense reserves',
  8: '"not yet available" exactly where there is no source, at every point', 9: 'renewal + new business = written exposure, every line',
  10: 'the window rolls: the five most recent calendar years, older ones in Prior, labelled as specified',
  11: 'Prior + the five reconcile to the full history — operating flows and every block\'s premium',
  12: 'at game start the five columns are the five pre-game years, tied to the engine\'s results',
  13: 'at game start Prior is absent from the calendar sections, present in the blocks for the older reserves',
  14: 'the year labels: "Current" on the actual latest year only, "Year 0" on the last pre-game year, "Year n" after it, blank elsewhere',
  15: 'a cell with no source shows blank, and no other cell does',
  16: 'the year selector: the five years ending at the chosen year, older years in Prior; the default is the latest',
};
console.log(`\n--- ${snaps.length} points (game start and after 1 to ${YEARS}) x ${SCOPES.length} scopes x every year the selector offers: ${statements} statements ---`);
for (const k of Object.keys(labels)) check((agg[k] ?? []).length === 0, `${k}. ${labels[k]}`, (agg[k] ?? [])[0] ?? '');
{
  const cols = (n: number) => sec(buildAnnualStatement(snaps[n], 'pool'), 'operating').columns.join(' · ');
  console.log(`\n  game start    ${cols(0)}\n  after year 1  ${cols(1)}\n  after year 2  ${cols(2)}\n  after year 5  ${cols(5)}\n  after year 6  ${cols(6)}`);
  // Over every program year — Prior and the five — not the latest five alone.
  const ced = cellsOf(buildAnnualStatement(snaps[YEARS], 'pool'), 'ceded', 'Ultimates');
  const recovered = (num(ced[0]) ?? 0) + (num(ced.at(-1)!) ?? 0);
  check(recovered > 0, 'the game recovered from its reinsurers, so the ceded block is tested on real figures', `ceded ultimates, every program year $${(recovered / 1e6).toFixed(2)}M`);
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
  check(combinedRatio(bump(base(), 'operating', 'Combined Ratio', 2, () => 1)).length > 0, 'control: the engine\'s pinned 1.000 in place of the worked ratio is caught');
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
  const st13 = buildAnnualStatement(snaps[0], 'pool'); sec(st13, 'operating').hasPrior = true;
  check(priorAtStart(st13).length > 0, 'control: a Prior shown at game start with nothing in it is caught');
  // What the player sees.
  const st14 = buildAnnualStatement(gs, 'pool', 3); const op14 = sec(st14, 'operating');
  op14.yearLabels[op14.windowYears.indexOf(3) + (op14.hasPrior ? 1 : 0)] = 'Current';
  check(yearLabels(st14, gs).length > 0, 'control: "Current" on a chosen year that is not the latest is caught');
  const st14b = buildAnnualStatement(snaps[0], 'pool'); const g14 = sec(st14b, 'gross'); g14.yearLabels = g14.yearLabels.map(() => '');
  check(yearLabels(st14b, snaps[0]).length > 0, 'control: a program-year block without its header row is caught');
  const shown = (c: Cell, f: CellFormat) => (c.kind === 'na' ? 'not yet available' : cellText(c, f));
  check(blanks(base(), shown).length > 0, 'control: "not yet available" printed in place of a blank is caught');
  check(selector(base(), gs, 3).length > 0, 'control: a selector that ignores the chosen year is caught');
  // Valued at the latest year instead of the chosen one, the blocks miss the chosen year's reserves.
  const st16 = buildAnnualStatement(gs, 'pool', 3); const latestNet = sec(base(), 'net');
  const n16 = sec(st16, 'net'); n16.rows = latestNet.rows.map(r => ({ ...r, cells: [...r.cells] }));
  check(blocksMeetBalanceSheet(st16).length > 0, 'control: blocks valued at the latest year under a chosen earlier year are caught');
}

console.log(failures.length === 0
  ? '\nTHE ANNUAL STATEMENT HOLDS TOGETHER: ALL CHECKS PASS.'
  : `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
