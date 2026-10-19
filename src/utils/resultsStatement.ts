// ============================================================================
// THE ANNUAL STATEMENT — the results page's figures, built once, pure.
//
// COLUMNS — A ROLLING FIVE-YEAR WINDOW over one timeline: the five pre-game
// years, then the game years. The most recent five are individual columns,
// labelled by calendar year; every older year collects in PRIOR.
//   PRIOR   flows summed over the years rolled out; balances at the end of the
//           last of them; in the program-year blocks, every older program
//           year combined — the bulk reserves included, so the blocks carry a
//           Prior from game start while the calendar sections show one only
//           once a year has rolled out.
//   TOTAL   over the five years shown: the sum for flow rows; the latest year
//           for balances, ratios and changes.
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

import { laeShares, lossExpenseReserve } from './lossExpense';
import { splitCohorts } from './reserveSplit';
import { surplusRange } from './worlds';
import { computeContributionShares } from './simulationEngine';
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
  sections: StatementSection[];
  notes: string[];
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
  opts: { indent?: boolean; emphasis?: boolean } = {}): StatementRow {
  return { label, format, rowClass, cells: [...(prior ? [prior] : []), ...game, totalCell(rowClass, game)], ...opts };
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
}
const operatingOf = (r: Scoped | undefined): OperatingYear => (r ? {
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
    assessDiv: k('assessDiv'), investment: k('investment'), netIncome: k('netIncome') };
}

function operatingRows(prior: OperatingYear | null, cols: OperatingYear[]): StatementRow[] {
  const mk = (label: string, f: (o: OperatingYear) => number | undefined, opts: { indent?: boolean; emphasis?: boolean } = {}) =>
    row(label, 'dollars', 'flow', prior ? v(f(prior)) : null, cols.map(o => v(f(o))), opts);
  // Prior's ratios come from Prior's own summed parts.
  const pct = (label: string, f: (o: OperatingYear) => number | undefined) =>
    row(label, 'pct', 'point', prior ? div(f(prior), prior.premium) : null, cols.map(o => div(f(o), o.premium)), { indent: true });
  const lossLae = (o: OperatingYear) => add(o.losses, o.lae);
  const expenses = (o: OperatingYear) => add(o.admin, o.riskControl);
  const nui = (o: OperatingYear) => sub(o.premium, add(o.losses, o.lae, o.admin, o.riskControl));
  return [
    mk('Premium', o => o.premium, { emphasis: true }),
    mk('Incurred Losses', o => o.losses),
    mk('Incurred Loss Adjustment Expense', o => o.lae),
    mk('Total Incurred Loss & LAE', lossLae, { emphasis: true }),
    pct('% of Premium', lossLae),
    mk('General Admin Expense', o => o.admin),
    mk('Additional Admin Expense (risk control)', o => o.riskControl),
    pct('% of Premium', expenses),
    // ⚠ WORKED OUT FROM ITS PARTS — never the engine's pinned expected ratio.
    pct('Combined Ratio', o => add(o.losses, o.lae, o.admin, o.riskControl)),
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
// set opening swaps the seed reserves for bulk cohorts (priorHistoryEngine), so
// its reserves and invested assets are the opening's. It is read as year 1's
// beginning position, or the opening state itself before any year is played.
// ---------------------------------------------------------------------------
interface Position { invested?: number; cash?: number; lossRes?: number; laeRes?: number; other?: number; surplus?: number }

function openingPosition(gs: GameState, scope: LineView): Position {
  const lines: CoverageLine[] = scope === 'pool' ? gs.setup.activeLines : [scope];
  const y0 = gs.priorHistory?.at(-1);
  const other = y0 ? at(y0, scope)?.unearnedPremium : undefined;
  const first = gs.lockedResults[0];
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
  gs: GameState, scope: LineView, paidIn: number | undefined,
  prior: { position: Position; premium?: number } | null,
  cols: { yearNumber: number; position: Position; premium?: number }[],
): StatementRow[] {
  const bal = (label: string, f: (p: Position) => number | undefined, opts: { indent?: boolean; emphasis?: boolean } = {}) =>
    row(label, 'dollars', 'point', prior ? v(f(prior.position)) : null, cols.map(c => v(f(c.position))), opts);
  const reserves = (p: Position) => add(p.lossRes, p.laeRes);
  const ratio = (label: string, num_: (p: Position, prem?: number) => number | undefined, den: (p: Position, prem?: number) => number | undefined) =>
    row(label, 'ratio', 'point', prior ? div(num_(prior.position, prior.premium), den(prior.position, prior.premium)) : null,
      cols.map(c => div(num_(c.position, c.premium), den(c.position, c.premium))), { indent: true });
  // The worlds exist from year 1; the pre-game ran once, so it has no spread.
  const ranges: Cell[] = cols.map(c => {
    if (c.yearNumber < 1) return NONE;
    const rg = surplusRange(gs, c.yearNumber, scope === 'pool' ? undefined : scope);
    return rg ? { kind: 'range', min: rg.min, median: rg.median, max: rg.max } : NA;
  });
  return [
    bal('Invested', p => p.invested, { indent: true }),
    bal('Cash', p => p.cash, { indent: true }),
    bal('Loss Reserves', p => p.lossRes, { indent: true }),
    bal('Loss Expense Reserves', p => p.laeRes, { indent: true }),
    bal('Other Liabilities', p => p.other, { indent: true }),
    bal('Paid-in Capital', () => paidIn, { indent: true }),
    bal('Earned Surplus', p => sub(p.surplus, paidIn), { indent: true }),
    bal('Ending Surplus', p => p.surplus, { emphasis: true }),
    row('Ending surplus across the worlds (min · median · max)', 'dollars', 'point', prior ? NONE : null, ranges, { indent: true }),
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
// (lossExpense.ts): paid with the paid loss, its reserve — a bulk provision —
// in IBNR; the reinsurer reimburses none, so it is in gross and net alike.
// ---------------------------------------------------------------------------
interface AyLoss { paid: number; case_: number; ibnr: number }
interface AyBlock { gross: AyLoss; ceded: AyLoss; net: AyLoss }
const zero = (): AyLoss => ({ paid: 0, case_: 0, ibnr: 0 });
const addLoss = (a: AyLoss, b: AyLoss): AyLoss => ({ paid: a.paid + b.paid, case_: a.case_ + b.case_, ibnr: a.ibnr + b.ibnr });

/** One line's program years: AY -> its gross, ceded and net figures. */
function programYearsOf(gs: GameState, line: CoverageLine): Map<number, AyBlock> {
  const s = laeShares(line).total;
  const out = new Map<number, AyBlock>();
  const latest = gs.lockedResults.at(-1)?.byLine[line];
  const ls = gs.poolState.lines[line];
  const split: AccidentYearSplit[] = latest ? latest.reserveSplitByYear ?? [] : splitCohorts(line, ls.reserveCohorts ?? []);
  const splitOf = new Map(split.map(x => [x.yearNumber, x]));
  // Paid to date: the averaged ledger once a year is played; the opening's
  // cohorts before (one opening, shared by every world).
  const paid = new Map<number, { net: number; gross: number }>();
  if (latest) {
    for (const r of ls.reserveDevelopment ?? []) {
      const net = r.paidByValuation?.at(-1) ?? 0;
      paid.set(r.yearNumber, { net, gross: r.grossPaidByValuation?.at(-1) ?? net });
    }
  } else {
    for (const c of ls.reserveCohorts ?? []) paid.set(c.yearNumber, { net: c.netPaid, gross: c.grossPaid ?? c.netPaid });
  }
  const ays = new Set([...paid.keys(), ...splitOf.keys()]);
  for (const ay of ays) {
    const p = paid.get(ay) ?? { net: 0, gross: 0 };
    const x = splitOf.get(ay);
    const laeRes = s * (x?.unpaidGross ?? 0);
    out.set(ay, {
      gross: { paid: p.gross * (1 + s), case_: x?.caseGross ?? 0, ibnr: (x?.ibnrGross ?? 0) + laeRes },
      ceded: { paid: p.gross - p.net, case_: x?.caseCeded ?? 0, ibnr: x?.ibnrCeded ?? 0 },
      net: { paid: p.net + s * p.gross, case_: x?.caseNet ?? 0, ibnr: (x?.ibnrNet ?? 0) + laeRes },
    });
  }
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
    // ⚠ PRIOR HAS NO COMPLETE PREMIUM: it always holds the bulk years, which
    // carry none, so a ratio over it would divide losses that have no premium.
    row('Loss and LAE Ratio', 'pct', 'point', NA, gameLoss.map((l, i) => div(ult(l), gamePremium[i]))),
  ];
}

// ---------------------------------------------------------------------------
const yearsLabel = (first: number, last: number) =>
  (first === last ? `${first}` : `${first}–${String(last).slice(-2)}`);

export function buildAnnualStatement(gs: GameState, scope: LineView): AnnualStatement {
  const lines: CoverageLine[] = scope === 'pool' ? gs.setup.activeLines : [scope];
  // THE TIMELINE: every pre-game year, then every game year, oldest first.
  const preGame = [...(gs.earlyPreGameHistory ?? []), ...(gs.priorHistory ?? [])];
  const timeline: ResultSet[] = [...preGame, ...gs.lockedResults];
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
  const operating = calendar('operating', 'Operating Results', 'by calendar year, net of reinsurance',
    operatingRows(hasCalendarPrior ? sumOperating(operatingAll.slice(0, first)) : null, operatingAll.slice(first)));

  // Balance sheet: each year's year-end; the last pre-game year's is the opening.
  const opening = openingPosition(gs, scope);
  const positionAt = (r: ResultSet): Position => (r.yearNumber === 0 ? opening : positionOf(at(r, scope)!));
  // ⚠ PAID-IN CAPITAL IS THE SURPLUS THE POOL STARTED THE PRE-GAME WITH (Prompt
  // A commit 2), so earned surplus builds from zero through the pre-game. It was
  // the opening surplus, which read the pre-game's own earnings as negative.
  const paidIn = preGame.length > 0 ? at(preGame[0], scope)?.beginingSurplus : opening.surplus;
  const balance = calendar('balance', 'Balance Sheet at Year-End', 'each year at its year-end; the last pre-game year at the opening',
    balanceRows(gs, scope, paidIn,
      hasCalendarPrior ? { position: positionAt(rolled[rolled.length - 1]), premium: operatingAll[first - 1].premium } : null,
      window.map((r, i) => ({ yearNumber: r.yearNumber, position: positionAt(r), premium: operatingAll[first + i].premium }))));

  const underwriting = calendar('underwriting', 'Underwriting', 'by calendar year',
    underwritingRows(scope, timeline.map(r => at(r, scope)), first));

  // Program years, summed over the scope's lines. The window is the same five
  // years, as program years; Prior holds every older one, bulk years included.
  const perLine = lines.map(l => programYearsOf(gs, l));
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
    // Drop the Prior cell where nothing predates the window (never, while bulk years exist).
    if (!programPrior) for (const r of rows) r.cells.shift();
    return { key, title, basis: 'by program year, at the latest valuation', columns: programColumns, hasPrior: programPrior, windowYears, rows };
  };

  const sections: StatementSection[] = [
    operating, balance, underwriting,
    block('gross', 'Gross', b => b.gross),
    block('ceded', 'Ceded (Reinsurance)', b => b.ceded),
    block('net', 'Net', b => b.net),
  ];

  const notes = [
    'Dollars are the average of the ten worlds; every ratio is worked out from those averaged figures. The surplus range is the one per-world figure; the pre-game ran once, before the worlds.',
    `The most recent ${STATEMENT_WINDOW_YEARS} years are shown as their own columns; every older year collects in Prior — flows summed, balances at the end of the last year in it. Total covers the ${STATEMENT_WINDOW_YEARS} years shown: the sum for flows, the latest year for balances, ratios and changes.`,
    `The ${preGame.length} pre-game years are the pool's played history. Surplus moves through them only by each year's income, assessments and dividends, from a starting surplus chosen so the last of them ends at the set opening. That year's year-end is shown as the opening, which is what year 1 begins from; its reserves are the opening's, older years included.`,
    'In the Gross, Ceded and Net blocks Prior holds every older program year, the bulk reserves from before the pre-game included. Those carry no premium, so Prior has no Loss and LAE Ratio.',
    'Loss adjustment expense is the rate\'s share of the ground-up loss: paid with the losses, its reserve held in IBNR. The reinsurer reimburses none of it, so it is in gross and net alike.',
  ];
  return { scope, sections, notes };
}

/** Every row carrying a "not yet available" cell, as "Section — Row (column)". */
export function notYetAvailable(st: AnnualStatement): string[] {
  const out: string[] = [];
  for (const s of st.sections) for (const r of s.rows) r.cells.forEach((c, i) => {
    if (c.kind === 'na') out.push(`${s.title} — ${r.label} (${s.columns[i]})`);
  });
  return out;
}
