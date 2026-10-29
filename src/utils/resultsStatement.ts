// ============================================================================
// THE ANNUAL STATEMENT — the results page's figures, built once, pure.
//
// COLUMNS — A ROLLING FIVE-YEAR WINDOW over one timeline: the five pre-game
// years, then the game years. The most recent five are individual columns,
// labelled by calendar year; every older year collects in PRIOR.
//   PRIOR   flows summed over the years rolled out; balances at the end of the
//           last of them; in the program-year blocks, every older program
//           year combined. The pool's history begins in 2021, so at game start
//           the five pre-game years fill the window and there is no Prior; it
//           appears once a year has rolled out, in every section alike.
//   TOTAL   over the five years shown: the sum for flow rows; the latest year
//           for balances, ratios and changes.
//
// AS OF A YEAR. The statement is built as it stood at a chosen year (the page's
// year selector; the latest by default): the window is the five years ending
// there, everything older in Prior, and the program-year blocks are valued at
// that year — its own reserve split and the ledger's paid at its valuation.
// Above the calendar labels, each window year carries a YEAR LABEL: "Year 0"
// for the last pre-game year (the one the game starts from), "Year 1", "Year 2"
// … after it, and "Current" on the game's actual latest year only; earlier
// pre-game years, Prior and Total carry none.
//
// ⚠ EVERY FIGURE IS READ, NEVER RESTATED. Dollars are the ten-world averages
// the game state holds (lockedResults, the averaged ledger and its reserve
// split; the pre-game ran once, before the worlds); every ratio is recomputed
// here from those averaged parts, never read as a stored ratio and never
// averaged. The only per-world figure is the ending-surplus range.
//
// ⚠ A FIGURE WITH NO SOURCE IS "not yet available", NEVER ZERO. Each such cell
// is a 'na' cell and the page lists the rows that carry one.
// ============================================================================

import { formatNumber } from './formatters';
import { laeShares, lossExpenseReserve } from './lossExpense';
import { splitCohorts } from './reserveSplit';
import { computeContributionShares } from './simulationEngine';
import { realStateOf } from './knownYears';
import type {
  AccidentYearSplit, CoverageLine, GameState, LineResultSet, LineView, ResultSet,
} from '../types/simulation';

export type CellFormat = 'dollars' | 'pct' | 'ratio' | 'exposure' | 'rate';
export type Cell =
  | { kind: 'value'; v: number }
  | { kind: 'na' }                                   // not yet available
  | { kind: 'none' }                                 // — (no meaning here)
  | { kind: 'byLine' }                               // mixed units at pool scope
  | { kind: 'range'; min: number; median: number; max: number };

/** How a row totals: flows sum the game years; points take the latest year. */
export type RowClass = 'flow' | 'point';

/** The window: the most recent years shown as their own columns. */
export const STATEMENT_WINDOW_YEARS = 5;

export interface StatementRow {
  label: string;
  format: CellFormat;
  rowClass: RowClass;
  /** Aligned with the section's columns: [Prior,] each window year, Total. */
  cells: Cell[];
  indent?: boolean;
  emphasis?: boolean;
}

export interface StatementSection {
  key: 'operating' | 'balance' | 'underwriting' | 'gross' | 'ceded' | 'net';
  title: string;
  basis: string;
  /** e.g. 'Prior (2021–22)', '2023', …, 'Total'. Prior only where something predates the window. */
  columns: string[];
  hasPrior: boolean;
  /** The yearNumber of each window column. */
  windowYears: number[];
  rows: StatementRow[];
}

export interface AnnualStatement {
  scope: LineView;
  /** The year the statement stands at — the last window column. */
  asOf: number;
  sections: StatementSection[];
  /**
   * ⚠ HIDDEN FROM PLAYERS. The explanatory notes the page used to print under
   * the tables. Kept so they can be restored, or shown in a testing view.
   */
  notes: string[];
}

/** A cell's text. A figure with no source shows BLANK — it is still 'na' in the statement. */
export function cellText(c: Cell, format: CellFormat): string {
  const thousands = (x: number) => {
    const r = Math.round(x / 1000);
    return `${r < 0 ? '−' : ''}${Math.abs(r).toLocaleString('en-US')}`;
  };
  switch (c.kind) {
    case 'na': return '';
    case 'none': return '—';
    case 'byLine': return 'by line';
    case 'range': return `${thousands(c.min)} · ${thousands(c.median)} · ${thousands(c.max)}`;
    case 'value': {
      const x = c.v;
      return format === 'dollars' ? thousands(x)
        : format === 'pct' ? `${(x * 100).toFixed(1)}%`.replace(/^-/, '−')
        : format === 'ratio' ? x.toFixed(2).replace(/^-/, '−')
        : format === 'exposure' ? `${Math.abs(x) < 0.05 ? '0.0' : formatNumber(x, 1)}`
        : x.toFixed(3);
    }
  }
}

/** The years a statement can stand at — every pre-game and game year, oldest first. */
export function statementYears(gs: GameState): { yearNumber: number; calendarYear: number }[] {
  return [...(gs.earlyPreGameHistory ?? []), ...(gs.priorHistory ?? []), ...gs.lockedResults]
    .map(r => ({ yearNumber: r.yearNumber, calendarYear: r.calendarYear }));
}

const v = (x: number | undefined | null): Cell =>
  (x === undefined || x === null || !Number.isFinite(x) ? { kind: 'na' } : { kind: 'value', v: x });
const NONE: Cell = { kind: 'none' };
const NA: Cell = { kind: 'na' };
const BY_LINE: Cell = { kind: 'byLine' };
export const num = (c: Cell): number | undefined => (c.kind === 'value' ? c.v : undefined);
// No source → not yet available; a zero denominator (no prior reinsurance, say)
// has a source and no meaning → —.
const div = (a: number | undefined, b: number | undefined): Cell =>
  (a === undefined || b === undefined ? NA : b === 0 ? NONE : { kind: 'value', v: a / b });

/** Total per the rule: flows sum the game years (any gap → n/a); points take the latest. */
export function totalCell(rowClass: RowClass, gameCells: readonly Cell[]): Cell {
  if (gameCells.length === 0) return NONE;
  if (rowClass === 'point') return gameCells[gameCells.length - 1];
  if (gameCells.some(c => c.kind === 'na')) return NA;
  if (gameCells.some(c => c.kind !== 'value')) return gameCells.every(c => c.kind === 'byLine') ? BY_LINE : NONE;
  return { kind: 'value', v: gameCells.reduce((s, c) => s + (c as { v: number }).v, 0) };
}

/** A row: Prior (null where the section has none), the window, and its Total. */
function row(label: string, format: CellFormat, rowClass: RowClass, prior: Cell | null, game: Cell[],
  opts: { indent?: boolean; emphasis?: boolean; total?: Cell } = {}): StatementRow {
  const { total, ...rest } = opts;
  return { label, format, rowClass, cells: [...(prior ? [prior] : []), ...game, total ?? totalCell(rowClass, game)], ...rest };
}

/**
 * A RATIO'S TOTAL, FROM SUMMED FIGURES (stable-scenarios commit 11): the
 * window's numerators summed over its denominators summed — the cumulative
 * ratio — never the latest year's, and never a mean of the years' ratios.
 */
function cumulativeRatio(nums: (number | undefined)[], dens: (number | undefined)[]): Cell {
  if (nums.length === 0) return NONE;
  if (nums.some(x => x === undefined) || dens.some(x => x === undefined)) return NA;
  return div(nums.reduce((a, b) => a! + b!, 0), dens.reduce((a, b) => a! + b!, 0));
}

type Scoped = ResultSet | LineResultSet;
const at = (r: ResultSet, scope: LineView): Scoped | undefined =>
  (scope === 'pool' ? r : r.byLine[scope]);

// ---------------------------------------------------------------------------
// OPERATING RESULTS — calendar years, NET basis: premium net of reinsurance
// cost, losses net of recoveries, so Net Underwriting Income + Assessments/
// Dividends is the engine's underwriting income exactly.
// ---------------------------------------------------------------------------
interface OperatingYear {
  premium?: number; losses?: number; lae?: number; admin?: number; riskControl?: number;
  assessDiv?: number; investment?: number; netIncome?: number;
  /** The combined ratio's two extra parts: what members were charged, and the reinsurance cost within it. */
  memberCharge?: number; reinsurance?: number;
}
const operatingOf = (r: Scoped | undefined): OperatingYear => (r ? {
  memberCharge: r.totalMemberCharge,
  reinsurance: r.reinsuranceCost,
  premium: r.totalMemberCharge - r.reinsuranceCost,
  losses: r.netIncurredLoss,
  lae: r.laeIncurred,
  admin: r.operatingExpense,
  riskControl: r.riskControlInvestment,
  assessDiv: r.assessments - r.dividends,
  investment: r.investmentIncome,
  netIncome: r.netIncome,
} : {});
const add = (...xs: (number | undefined)[]) => (xs.some(x => x === undefined) ? undefined : xs.reduce<number>((s, x) => s + x!, 0));
const sub = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? undefined : a - b);

/** Prior's operating year: every field summed over the years rolled out. */
function sumOperating(ys: OperatingYear[]): OperatingYear {
  const k = (f: keyof OperatingYear) => add(...ys.map(o => o[f]));
  return { premium: k('premium'), losses: k('losses'), lae: k('lae'), admin: k('admin'), riskControl: k('riskControl'),
    assessDiv: k('assessDiv'), investment: k('investment'), netIncome: k('netIncome'),
    memberCharge: k('memberCharge'), reinsurance: k('reinsurance') };
}

/**
 * THE COMBINED RATIO — the statement's one, and the header's: every cost over
 * what members were charged — net losses, LAE, admin (risk control included)
 * and the reinsurance cost, over the total member charge. It is 1 − net
 * underwriting income / member charge, and the engine's own actualCombinedRatio
 * (worlds.deriveLineRatios) on the same parts. The reinsurance cost is a cost
 * here, so the denominator is the charge that pays for it, not the Premium row,
 * which is net of it.
 *
 * ⚠ THE NET-OF-REINSURANCE COMBINED RATIO IS GONE FROM THE STATEMENT — (losses
 * + LAE + admin) over the net Premium row. Two figures under one name read as
 * a contradiction; this is the one players see.
 */
const combinedCosts = (o: OperatingYear) => add(o.losses, o.lae, o.admin, o.riskControl, o.reinsurance);

export const COMBINED_RATIO_LABEL = 'Combined Ratio';
export const ENDING_SURPLUS_LABEL = 'Ending Surplus';

/**
 * The statement's first row. Each year's cell is that year's own; TOTAL is
 * CUMULATIVE — summed costs over summed charges — over every PLAYED year since
 * game start, to the year the statement stands at; before year 1 is played,
 * over the pre-game years instead. The header and the host's Teams table show
 * the NEWEST year's cell, not this Total (newestCombinedRatio).
 */
function combinedRatioRow(prior: OperatingYear | null, cols: OperatingYear[], cumulativeOver: OperatingYear[]): StatementRow {
  const total = cumulativeOver.length === 0 ? NONE
    : cumulativeRatio(cumulativeOver.map(combinedCosts), cumulativeOver.map(o => o.memberCharge));
  return row(COMBINED_RATIO_LABEL, 'pct', 'point', prior ? div(combinedCosts(prior), prior.memberCharge) : null,
    cols.map(o => div(combinedCosts(o), o.memberCharge)), { emphasis: true, total });
}

/** The statement's cumulative combined ratio (its first row's Total). */
export function topCombinedRatio(st: AnnualStatement): number | undefined {
  const r = st.sections.find(s => s.key === 'operating')?.rows.find(x => x.label === COMBINED_RATIO_LABEL);
  return r ? num(r.cells[r.cells.length - 1]) : undefined;
}

/**
 * THE HEADER'S AND THE HOST'S FIGURE: the Combined Ratio of the statement's
 * NEWEST year — its last column before Total — with that year's calendar label.
 * The year the statement stands at: the latest played year, or before year 1
 * the last pre-game (history) year. Undefined where the statement has no such
 * cell.
 */
export function newestCombinedRatio(st: AnnualStatement): { value: number; calendarYear: number } | undefined {
  const sec = st.sections.find(s => s.key === 'operating');
  const r = sec?.rows.find(x => x.label === COMBINED_RATIO_LABEL);
  if (!sec || !r || r.cells.length < 2) return undefined;
  const value = num(r.cells[r.cells.length - 2]);
  const calendarYear = Number(sec.columns[sec.columns.length - 2]);
  return value !== undefined && Number.isFinite(value) && Number.isFinite(calendarYear) ? { value, calendarYear } : undefined;
}

/**
 * THE HEADER'S SURPLUS: the balance sheet's Ending Surplus for the latest year
 * — the opening before year 1, each played year's year-end after it — for the
 * statement's view. The last cell is Total, so the latest year is the one
 * before it.
 */
export function topSurplus(st: AnnualStatement): number | undefined {
  const r = st.sections.find(s => s.key === 'balance')?.rows.find(x => x.label === ENDING_SURPLUS_LABEL);
  return r && r.cells.length >= 2 ? num(r.cells[r.cells.length - 2]) : undefined;
}

function operatingRows(prior: OperatingYear | null, cols: OperatingYear[], cumulativeOver: OperatingYear[]): StatementRow[] {
  const mk = (label: string, f: (o: OperatingYear) => number | undefined, opts: { indent?: boolean; emphasis?: boolean } = {}) =>
    row(label, 'dollars', 'flow', prior ? v(f(prior)) : null, cols.map(o => v(f(o))), opts);
  // Prior's ratios come from Prior's own summed parts, and Total's from the
  // window's (cumulative — summed figures, commit 11).
  const pct = (label: string, f: (o: OperatingYear) => number | undefined) =>
    row(label, 'pct', 'point', prior ? div(f(prior), prior.premium) : null, cols.map(o => div(f(o), o.premium)),
      { indent: true, total: cumulativeRatio(cols.map(f), cols.map(o => o.premium)) });
  const lossLae = (o: OperatingYear) => add(o.losses, o.lae);
  const expenses = (o: OperatingYear) => add(o.admin, o.riskControl);
  const nui = (o: OperatingYear) => sub(o.premium, add(o.losses, o.lae, o.admin, o.riskControl));
  return [
    combinedRatioRow(prior, cols, cumulativeOver),
    mk('Premium', o => o.premium, { emphasis: true }),
    mk('Incurred Losses', o => o.losses),
    mk('Incurred Loss Adjustment Expense', o => o.lae),
    mk('Total Incurred Loss & LAE', lossLae, { emphasis: true }),
    // The loss ratio and the Loss & LAE ratio side by side (commit 11).
    pct('Loss Ratio', o => o.losses),
    pct('Loss & LAE Ratio', lossLae),
    mk('General Admin Expense', o => o.admin),
    mk('Additional Admin Expense (risk control)', o => o.riskControl),
    pct('% of Premium', expenses),
    mk('Net Underwriting Income', nui, { emphasis: true }),
    pct('% of Premium', nui),
    mk('Assessments/Dividends', o => o.assessDiv),
    mk('Investment Income', o => o.investment),
    mk('Net Operating Income', o => o.netIncome, { emphasis: true }),
  ];
}

// ---------------------------------------------------------------------------
// BALANCE SHEET AT YEAR-END. Each year's own year-end, read from its result —
// except the last pre-game year (2025 for a 2026 start), whose year-end is THE
// OPENING, which is what year 1 begins from. Its surplus is that year's own
// year-end — the pre-game starts from the surplus that lands it there — but the
// opening re-bases its cohorts for the host's development (priorHistoryEngine),
// so its reserves and invested assets are the opening's. It is read as year 1's
// beginning position, or the opening state itself before any year is played.
// ---------------------------------------------------------------------------
interface Position { invested?: number; cash?: number; lossRes?: number; laeRes?: number; other?: number; surplus?: number }

function openingPosition(gs: GameState, scope: LineView): Position {
  const lines: CoverageLine[] = scope === 'pool' ? gs.setup.activeLines : [scope];
  const y0 = gs.priorHistory?.at(-1);
  const other = y0 ? at(y0, scope)?.unearnedPremium : undefined;
  // ⚠ FROM THE REAL GAME, NOT THE KNOWN VIEW (knownYears.ts): after the first
  // advance the view lists no played year, but the pool state has moved on —
  // year 1's own beginning balances are the opening.
  const first = realStateOf(gs).lockedResults[0];
  if (first) {
    const r = at(first, scope)!;
    return {
      invested: r.beginningInvestments, cash: r.beginningCash, lossRes: r.beginningNetReserve,
      laeRes: r.beginningLaeReserve, other, surplus: r.beginingSurplus,
    };
  }
  const ps = gs.poolState;
  const shares = computeContributionShares(ps, gs.setup.activeLines);
  return {
    invested: lines.reduce((s, l) => s + ps.lines[l].investedAssets, 0),
    cash: lines.reduce((s, l) => s + ps.cash * shares[l], 0),
    lossRes: lines.reduce((s, l) => s + ps.lines[l].netUnpaidReserve, 0),
    laeRes: lines.reduce((s, l) => s + lossExpenseReserve(l, ps.lines[l].reserveCohorts ?? []), 0),
    other,
    surplus: lines.reduce((s, l) => s + ps.lines[l].surplus, 0),
  };
}

const positionOf = (r: Scoped): Position => ({
  invested: r.endingInvestments, cash: r.endingCash, lossRes: r.endingNetReserve, laeRes: r.endingLaeReserve,
  // The engine's liabilities beyond the two reserves — read as its total less them.
  other: r.totalLiabilities - r.endingNetReserve - (r.endingLaeReserve ?? 0),
  surplus: r.endingSurplus,
});

function balanceRows(
  paidIn: number | undefined,
  prior: { position: Position; premium?: number } | null,
  cols: { yearNumber: number; position: Position; premium?: number }[],
): StatementRow[] {
  const bal = (label: string, f: (p: Position) => number | undefined, opts: { indent?: boolean; emphasis?: boolean } = {}) =>
    row(label, 'dollars', 'point', prior ? v(f(prior.position)) : null, cols.map(c => v(f(c.position))), opts);
  const reserves = (p: Position) => add(p.lossRes, p.laeRes);
  const ratio = (label: string, num_: (p: Position, prem?: number) => number | undefined, den: (p: Position, prem?: number) => number | undefined) =>
    row(label, 'ratio', 'point', prior ? div(num_(prior.position, prior.premium), den(prior.position, prior.premium)) : null,
      cols.map(c => div(num_(c.position, c.premium), den(c.position, c.premium))), { indent: true });
  return [
    bal('Invested', p => p.invested, { indent: true }),
    bal('Cash', p => p.cash, { indent: true }),
    bal('Loss Reserves', p => p.lossRes, { indent: true }),
    bal('Loss Expense Reserves', p => p.laeRes, { indent: true }),
    bal('Other Liabilities', p => p.other, { indent: true }),
    bal('Paid-in Capital', () => paidIn, { indent: true }),
    bal('Earned Surplus', p => sub(p.surplus, paidIn), { indent: true }),
    bal(ENDING_SURPLUS_LABEL, p => p.surplus, { emphasis: true }),
    // ⚠ NO "ACROSS THE WORLDS" ROW: players are never told about the worlds
    // (docs/PENDING_MULTIPLAYER.md). The surplus range stays in the session's
    // posted results, for the host.
    ratio('Premium to Surplus', (_p, prem) => prem, p => p.surplus),
    ratio('Reserve to Surplus', reserves, p => p.surplus),
    ratio('Premium to Reserve', (_p, prem) => prem, reserves),
  ];
}

// ---------------------------------------------------------------------------
// UNDERWRITING — calendar years. Exposure is payroll on WC and GL and building
// value on Property, so at pool scope the exposure rows and the rate read "by
// line": a sum across them is not a number.
// ---------------------------------------------------------------------------
function underwritingRows(scope: LineView, timeline: (Scoped | undefined)[], firstWindow: number): StatementRow[] {
  const pool = scope === 'pool';
  // The window's results, and the year before the window opens (Prior's last).
  const cols = timeline.slice(firstWindow);
  const prev = firstWindow > 0 ? timeline[firstWindow - 1] : undefined;
  const rolled = timeline.slice(0, firstWindow);
  const rate = (r?: Scoped) => (r ? ((r as LineResultSet).finalRatePer100 ?? (r as LineResultSet).ratePer100) : undefined);
  const series = (f: (r?: Scoped) => number | undefined) => cols.map(r => (pool ? BY_LINE : v(f(r))));
  const change = (f: (r?: Scoped) => number | undefined, asRatio: boolean) => cols.map((r, i) => {
    if (pool) return BY_LINE;
    const before = i === 0 ? prev : cols[i - 1];
    const a = f(r), b = f(before);
    if (a === undefined || b === undefined) return NA;
    return asRatio ? (b === 0 ? NONE : { kind: 'value' as const, v: a / b - 1 }) : { kind: 'value' as const, v: a - b };
  });
  // Prior: points at the last year rolled out (its change against the one
  // before it); flows summed over every year rolled out.
  const priorPoint = (f: (r?: Scoped) => number | undefined): Cell => (pool ? BY_LINE : v(f(prev)));
  const priorFlow = (f: (r?: Scoped) => number | undefined): Cell => (pool ? BY_LINE : v(add(...rolled.map(f))));
  const priorChange = (f: (r?: Scoped) => number | undefined, asRatio: boolean): Cell => {
    if (pool) return BY_LINE;
    const a = f(prev), b = f(firstWindow > 1 ? timeline[firstWindow - 2] : undefined);
    if (a === undefined || b === undefined) return NA;
    return asRatio ? (b === 0 ? NONE : { kind: 'value', v: a / b - 1 }) : { kind: 'value', v: a - b };
  };
  const hasPrior = firstWindow > 0;
  const mk = (label: string, format: CellFormat, rowClass: RowClass, prior: Cell, cells: Cell[], indent = false) =>
    row(label, format, rowClass, hasPrior ? prior : null, cells, { indent });
  return [
    mk('Written Exposure', 'exposure', 'point', priorPoint(r => r?.writtenExposure), series(r => r?.writtenExposure)),
    mk('Change from Prior', 'exposure', 'point', priorChange(r => r?.writtenExposure, false), change(r => r?.writtenExposure, false), true),
    mk('New Business', 'exposure', 'flow', priorFlow(r => r?.newBusinessExposure), series(r => r?.newBusinessExposure), true),
    mk('Renewal', 'exposure', 'flow', priorFlow(r => r?.renewalExposure), series(r => r?.renewalExposure), true),
    mk('Retained %', 'pct', 'point', priorPoint(r => r?.memberRetentionRate), series(r => r?.memberRetentionRate), true),
    mk('Current Rate', 'rate', 'point', priorPoint(rate), series(rate)),
    mk('% Change Over Prior', 'pct', 'point', priorChange(rate, true), change(rate, true), true),
  ];
}

// ---------------------------------------------------------------------------
// GROSS, CEDED, NET — by PROGRAM (accident) year, at the latest valuation.
//
// Paid and ultimate loss come from the averaged reserve ledger; case and IBNR
// from the engine's presentation split of the latest averaged result (closed
// years carry neither). LAE is the rate's share of the GROUND-UP loss
// (lossExpense.ts): paid with the paid loss, its reserve in IBNR; the reinsurer reimburses none, so it is in gross and net alike.
// ---------------------------------------------------------------------------
export interface AyLoss { paid: number; case_: number; ibnr: number }
export interface AyBlock { gross: AyLoss; ceded: AyLoss; net: AyLoss }
const zero = (): AyLoss => ({ paid: 0, case_: 0, ibnr: 0 });
const addLoss = (a: AyLoss, b: AyLoss): AyLoss => ({ paid: a.paid + b.paid, case_: a.case_ + b.case_, ibnr: a.ibnr + b.ibnr });

/**
 * One line's program years, valued at `asOf`: AY -> its gross, ceded and net
 * figures. At the latest year, the latest valuation; at an earlier year, that
 * year's own reserve split and the ledger's paid at its valuation, over the
 * accident years it had.
 */
export function programYearsOf(gs: GameState, line: CoverageLine, asOf: ResultSet): Map<number, AyBlock> {
  const out = new Map<number, AyBlock>();
  const ls = gs.poolState.lines[line];
  // The opening — the last pre-game year — stands at the opening's own cohorts
  // while the pool state still IS the opening: before year 1. After, it is
  // valued from its own result and the ledger like any other year.
  // ⚠ READ OFF THE REAL GAME, NOT THE KNOWN VIEW (knownYears.ts): after the
  // first advance the view lists no played year, yet the pool state has moved on.
  const atOpening = asOf.yearNumber === 0 && realStateOf(gs).lockedResults.length === 0;
  // The year shown's own reserve split — at the latest year, that is the latest
  // result's; at an earlier one, its own.
  const split: AccidentYearSplit[] = atOpening ? splitCohorts(line, openingCohorts(gs, line))
    : asOf.byLine[line]?.reserveSplitByYear ?? [];
  const splitOf = new Map(split.map(x => [x.yearNumber, x]));
  // Paid to date: the averaged ledger, at the shown year's valuation; the
  // opening's cohorts at the opening (one opening, shared by every world).
  const paid = new Map<number, { net: number; gross: number }>();
  if (atOpening) {
    for (const c of openingCohorts(gs, line)) paid.set(c.yearNumber, { net: c.netPaid, gross: c.grossPaid ?? c.netPaid });
  } else {
    for (const r of ls.reserveDevelopment ?? []) {
      if (r.yearNumber > asOf.yearNumber) continue;
      const k = asOf.yearNumber - r.firstValuationYear;
      if (k < 0) continue;
      const pick = (xs?: number[]) => (xs && xs.length > 0 ? xs[Math.min(k, xs.length - 1)] : undefined);
      // Paid AT THE SHOWN YEAR'S VALUATION — at the latest year the ledger's
      // newest, since k is then its last; on a known view (knownYears.ts) the
      // ledger runs past the year shown, and later valuations stay unseen.
      const net = pick(r.paidByValuation) ?? 0;
      const gross = pick(r.grossPaidByValuation) ?? net;
      paid.set(r.yearNumber, { net, gross });
    }
  }
  const ays = new Set([...paid.keys(), ...splitOf.keys()]);
  for (const ay of ays) {
    const p = paid.get(ay) ?? { net: 0, gross: 0 };
    const x = splitOf.get(ay);
    // The accident year's own LAE share: its drawn ALAE ratio + ULAE (alaeRatio.ts).
    const s = laeShares(line, ls.reserveDevelopment?.find(r => r.yearNumber === ay)?.alaeRatio).total;
    const laeRes = s * (x?.unpaidGross ?? 0);
    out.set(ay, {
      gross: { paid: p.gross * (1 + s), case_: x?.caseGross ?? 0, ibnr: (x?.ibnrGross ?? 0) + laeRes },
      ceded: { paid: p.gross - p.net, case_: x?.caseCeded ?? 0, ibnr: x?.ibnrCeded ?? 0 },
      net: { paid: p.net + s * p.gross, case_: x?.caseNet ?? 0, ibnr: (x?.ibnrNet ?? 0) + laeRes },
    });
  }
  return out;
}

/**
 * One line's NET ULTIMATES BY PROGRAM YEAR, loss + LAE, at the latest
 * valuation — the Net block's Ultimates row, one program year at a time, by the
 * same programYearsOf. A hosted team posts this as its developed column, so the
 * host's views print the figure the team's own statement prints.
 */
export function netUltimatesByProgramYear(gs: GameState, line: CoverageLine): Map<number, number> {
  const latest = [...(gs.earlyPreGameHistory ?? []), ...(gs.priorHistory ?? []), ...gs.lockedResults].at(-1);
  const out = new Map<number, number>();
  if (!latest) return out;
  for (const [ay, b] of programYearsOf(gs, line, latest)) out.set(ay, b.net.paid + b.net.case_ + b.net.ibnr);
  return out;
}

interface Premiums { gross?: number; ceded?: number; net?: number }
const premiumsOf = (r: Scoped | undefined): Premiums => (r ? {
  gross: r.totalMemberCharge,
  ceded: r.reinsuranceCost,
  // Read on its own rather than as gross − ceded, so the gate's identity can fail.
  net: r.poolPremiumAndAdminExpense + (r.retainedCoverMargin ?? 0),
} : {});

function programRows(
  block: 'gross' | 'ceded' | 'net', priorLoss: AyLoss, gameLoss: AyLoss[],
  priorPremium: number | undefined, gamePremium: (number | undefined)[], beforeWindowPremium: number | undefined,
): StatementRow[] {
  const prem = (x: number | undefined) => v(x);
  const change = gamePremium.map((p, i) => {
    const b = i === 0 ? beforeWindowPremium : gamePremium[i - 1];
    return p === undefined || b === undefined ? NA : { kind: 'value' as const, v: p - b };
  });
  const ofPrior = gamePremium.map((p, i) => div(p, i === 0 ? beforeWindowPremium : gamePremium[i - 1]));
  const ult = (l: AyLoss) => l.paid + l.case_ + l.ibnr;
  const L = (label: string, f: (l: AyLoss) => number, opts: { indent?: boolean; emphasis?: boolean } = {}) =>
    row(label, 'dollars', 'flow', v(f(priorLoss)), gameLoss.map(l => v(f(l))), opts);
  return [
    row(block === 'ceded' ? 'Reinsurance Premium' : 'Premium', 'dollars', 'flow', prem(priorPremium), gamePremium.map(prem), { emphasis: true }),
    row('Change from Prior', 'dollars', 'point', NONE, change, { indent: true }),
    row('% of Prior', 'pct', 'point', NONE, ofPrior, { indent: true }),
    L('Paid Loss + LAE', l => l.paid),
    L('Case', l => l.case_),
    L('Reported Loss + LAE', l => l.paid + l.case_, { emphasis: true }),
    L('IBNR Reserve', l => l.ibnr),
    L('Ultimates', ult, { emphasis: true }),
    // ⚠ NO RATIO IN PRIOR. It was left blank because Prior always held the bulk
    // years, which carried no premium; those are retired (the pool's history
    // begins in 2021), and the cell stays blank as it was.
    row('Loss and LAE Ratio', 'pct', 'point', NA, gameLoss.map((l, i) => div(ult(l), gamePremium[i])),
      { total: cumulativeRatio(gameLoss.map(ult), gamePremium) }),
  ];
}

/**
 * The opening's reserve cohorts — what year 1 begins from — read only before
 * year 1, while the pool state still IS the opening. Once a year is played the
 * state has moved on, and the opening year is valued from its own result and
 * the ledger like any other (see programYearsOf).
 */
const openingCohorts = (gs: GameState, line: CoverageLine) => gs.poolState.lines[line].reserveCohorts ?? [];

// ---------------------------------------------------------------------------
const yearsLabel = (first: number, last: number) =>
  (first === last ? `${first}` : `${first}–${String(last).slice(-2)}`);

export function buildAnnualStatement(gs: GameState, scope: LineView, asOfYear?: number): AnnualStatement {
  const lines: CoverageLine[] = scope === 'pool' ? gs.setup.activeLines : [scope];
  // THE TIMELINE: every pre-game year, then every game year, oldest first —
  // cut at the year the statement stands at (the latest, unless one is chosen).
  const preGameAll = [...(gs.earlyPreGameHistory ?? []), ...(gs.priorHistory ?? [])];
  const full: ResultSet[] = [...preGameAll, ...gs.lockedResults];
  const latestYear = full.at(-1)?.yearNumber ?? 0;
  const asOf = asOfYear !== undefined && full.some(r => r.yearNumber === asOfYear) ? asOfYear : latestYear;
  const isLatest = asOf === latestYear;
  const timeline: ResultSet[] = full.filter(r => r.yearNumber <= asOf);
  const preGame = preGameAll.filter(r => r.yearNumber <= asOf);
  const first = Math.max(0, timeline.length - STATEMENT_WINDOW_YEARS);
  const window = timeline.slice(first), rolled = timeline.slice(0, first);
  const windowYears = window.map(r => r.yearNumber);
  const hasCalendarPrior = rolled.length > 0;
  const priorLabel = !hasCalendarPrior ? ''
    : rolled.length === preGame.length && rolled.every(r => r.yearNumber <= 0) ? 'Prior (all pre-game)'
    : `Prior (${yearsLabel(rolled[0].calendarYear, rolled[rolled.length - 1].calendarYear)})`;
  const calendarColumns = [...(hasCalendarPrior ? [priorLabel] : []), ...window.map(r => `${r.calendarYear}`), 'Total'];
  const calendar = (key: StatementSection['key'], title: string, basis: string, rows: StatementRow[]): StatementSection =>
    ({ key, title, basis, columns: calendarColumns, hasPrior: hasCalendarPrior, windowYears, rows });

  // Operating results.
  const operatingAll = timeline.map(r => operatingOf(at(r, scope)));
  // The combined ratio's cumulative: every played year since game start, or the pre-game years before year 1.
  const played = timeline.filter(r => r.yearNumber >= 1);
  const cumulativeOver = (played.length > 0 ? played : timeline).map(r => operatingOf(at(r, scope)));
  const operating = calendar('operating', 'Operating Results', 'by calendar year, net of reinsurance',
    operatingRows(hasCalendarPrior ? sumOperating(operatingAll.slice(0, first)) : null, operatingAll.slice(first), cumulativeOver));

  // Balance sheet: each year's year-end; the last pre-game year's is the opening.
  const opening = openingPosition(gs, scope);
  const positionAt = (r: ResultSet): Position => (r.yearNumber === 0 ? opening : positionOf(at(r, scope)!));
  // ⚠ PAID-IN CAPITAL IS THE SURPLUS THE POOL STARTED THE PRE-GAME WITH (Prompt
  // A commit 2) — STARTING_CAPITAL since stable-scenarios commit 9 — so earned
  // surplus builds from zero through the pre-game. It was the opening surplus,
  // which read the pre-game's own earnings as negative.
  const paidIn = preGame.length > 0 ? at(preGame[0], scope)?.beginingSurplus : opening.surplus;
  const balance = calendar('balance', 'Balance Sheet at Year-End', 'each year at its year-end; the last pre-game year at the opening',
    balanceRows(paidIn,
      hasCalendarPrior ? { position: positionAt(rolled[rolled.length - 1]), premium: operatingAll[first - 1].premium } : null,
      window.map((r, i) => ({ yearNumber: r.yearNumber, position: positionAt(r), premium: operatingAll[first + i].premium }))));

  const underwriting = calendar('underwriting', 'Underwriting', 'by calendar year',
    underwritingRows(scope, timeline.map(r => at(r, scope)), first));

  // Program years, summed over the scope's lines. The window is the same five
  // years, as program years; Prior holds every older one, once there is one.
  const asOfResult = timeline[timeline.length - 1];
  const perLine = lines.map(l => programYearsOf(gs, l, asOfResult));
  const blockAt = (pick: (b: AyBlock) => AyLoss, ays: (ay: number) => boolean) =>
    perLine.reduce((acc, m) => [...m.entries()].filter(([ay]) => ays(ay)).reduce((a, [, b]) => addLoss(a, pick(b)), acc), zero());
  const firstAy = windowYears[0] ?? 1;
  const programPrior = perLine.some(m => [...m.keys()].some(ay => ay < firstAy));
  const premAll = timeline.map(r => premiumsOf(at(r, scope)));
  const firstCalendar = window[0]?.calendarYear ?? gs.setup.startingYear;
  const programColumns = [
    ...(programPrior ? [hasCalendarPrior ? `Prior (${firstCalendar - 1} and earlier)` : `Prior (before ${firstCalendar})`] : []),
    ...window.map(r => `${r.calendarYear}`), 'Total',
  ];
  const block = (key: 'gross' | 'ceded' | 'net', title: string, pick: (b: AyBlock) => AyLoss): StatementSection => {
    // Prior premium: the rolled-out years that have one; none at all → no source.
    const priorPrem = rolled.length === 0 ? undefined : add(...premAll.slice(0, first).map(p => p[key]));
    const rows = programRows(key, blockAt(pick, ay => ay < firstAy), windowYears.map(ay => blockAt(pick, x => x === ay)),
      priorPrem, premAll.slice(first).map(p => p[key]), first > 0 ? premAll[first - 1][key] : undefined);
    // Drop the Prior cell where nothing predates the window — at game start, since the pool's history begins with the pre-game.
    if (!programPrior) for (const r of rows) r.cells.shift();
    return {
      key, title, basis: isLatest ? 'by program year, at the latest valuation' : `by program year, valued at ${asOfResult.calendarYear}`,
      columns: programColumns, hasPrior: programPrior, windowYears, rows,
    };
  };

  const sections: StatementSection[] = [
    operating, balance, underwriting,
    block('gross', 'Gross', b => b.gross),
    block('ceded', 'Ceded (Reinsurance)', b => b.ceded),
    block('net', 'Net', b => b.net),
  ];

  // ⚠ HIDDEN FROM PLAYERS (the page no longer prints them). Kept here so they
  // can be restored, or shown in a testing view.
  const notes = [
    'Dollars are the average of the ten worlds; every ratio is worked out from those averaged figures. The surplus range is the one per-world figure; the pre-game ran once, before the worlds.',
    `The most recent ${STATEMENT_WINDOW_YEARS} years are shown as their own columns; every older year collects in Prior — flows summed, balances at the end of the last year in it. Total covers the ${STATEMENT_WINDOW_YEARS} years shown: the sum for flows; for a ratio of premium, the summed figures over summed premium; the latest year for balances and changes. The combined ratio in the first row is every cost — net losses, LAE, admin and the reinsurance cost — over the member charge, and its Total is cumulative over every played year since game start, or over the pre-game years before year 1.`,
    `The ${preGame.length} pre-game years are the pool's played history. Surplus moves through them only by each year's income, assessments and dividends, from the paid-in capital the pool started with, the prior board's margin set so the last of them ends at the opening. That year's year-end is shown as the opening, which is what year 1 begins from. The pool's history begins with the first of them: it started with its paid-in capital and no reserves, and every reserve at the opening is one the pre-game wrote. Paid-in capital is the surplus the pool started the pre-game with; earned surplus is everything since.`,
    'In the Gross, Ceded and Net blocks Prior holds every older program year, once there is one.',
    'Loss adjustment expense is the rate\'s share of the ground-up loss: paid with the losses, its reserve held in IBNR. The reinsurer reimburses none of it, so it is in gross and net alike.',
  ];
  return { scope, asOf, sections, notes };
}

/** Every row carrying a "not yet available" cell, as "Section — Row (column)". */
export function notYetAvailable(st: AnnualStatement): string[] {
  const out: string[] = [];
  for (const s of st.sections) for (const r of s.rows) r.cells.forEach((c, i) => {
    if (c.kind === 'na') out.push(`${s.title} — ${r.label} (${s.columns[i]})`);
  });
  return out;
}
