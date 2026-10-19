// ============================================================================
// THE ANNUAL STATEMENT — the results page's figures, built once, pure.
//
// Columns: Prior · each game year · Total.
//   PRIOR   the opening position on the balance sheet; all earlier program
//           years combined in the program-year blocks; the last pre-game year
//           (year 0) in the calendar sections, as its own year.
//   TOTAL   the sum of the game years for flow rows; the latest year for
//           balances, ratios and changes.
//
// ⚠ EVERY FIGURE IS READ, NEVER RESTATED. Dollars are the ten-world averages
// the game state holds (lockedResults, the averaged ledger and its reserve
// split); every ratio is recomputed here from those averaged parts, never read
// as a stored ratio and never averaged. The only per-world figure is the
// ending-surplus range, which is what it is for.
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

export interface StatementRow {
  label: string;
  format: CellFormat;
  rowClass: RowClass;
  /** Prior, each game year, Total. */
  cells: Cell[];
  indent?: boolean;
  emphasis?: boolean;
}

export interface StatementSection {
  key: 'operating' | 'balance' | 'underwriting' | 'gross' | 'ceded' | 'net';
  title: string;
  basis: string;
  rows: StatementRow[];
}

export interface AnnualStatement {
  scope: LineView;
  /** 'Prior', 'Year 1 / 2026', …, 'Total'. */
  columns: string[];
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

function row(label: string, format: CellFormat, rowClass: RowClass, prior: Cell, game: Cell[],
  opts: { indent?: boolean; emphasis?: boolean } = {}): StatementRow {
  return { label, format, rowClass, cells: [prior, ...game, totalCell(rowClass, game)], ...opts };
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

function operatingRows(cols: OperatingYear[]): StatementRow[] {
  const mk = (label: string, f: (o: OperatingYear) => number | undefined, opts: { indent?: boolean; emphasis?: boolean } = {}) =>
    row(label, 'dollars', 'flow', v(f(cols[0])), cols.slice(1).map(o => v(f(o))), opts);
  const pct = (label: string, f: (o: OperatingYear) => number | undefined) =>
    row(label, 'pct', 'point', div(f(cols[0]), cols[0].premium), cols.slice(1).map(o => div(f(o), o.premium)), { indent: true });
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
// BALANCE SHEET AT YEAR-END. Prior is the opening: year 1's beginning
// position, or — before any year is played — the opening state itself.
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

function balanceRows(gs: GameState, scope: LineView, positions: Position[], premiums: (number | undefined)[]): StatementRow[] {
  const paidIn = positions[0].surplus;
  const bal = (label: string, f: (p: Position) => number | undefined, opts: { indent?: boolean; emphasis?: boolean } = {}) =>
    row(label, 'dollars', 'point', v(f(positions[0])), positions.slice(1).map(p => v(f(p))), opts);
  const reserves = (p: Position) => add(p.lossRes, p.laeRes);
  const ratio = (label: string, num_: (p: Position, prem?: number) => number | undefined, den: (p: Position, prem?: number) => number | undefined) =>
    row(label, 'ratio', 'point', div(num_(positions[0], premiums[0]), den(positions[0], premiums[0])),
      positions.slice(1).map((p, i) => div(num_(p, premiums[i + 1]), den(p, premiums[i + 1]))), { indent: true });
  const ranges: Cell[] = gs.lockedResults.map(r => {
    const rg = surplusRange(gs, r.yearNumber, scope === 'pool' ? undefined : scope);
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
    row('Ending surplus across the worlds (min · median · max)', 'dollars', 'point', NONE, ranges, { indent: true }),
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
function underwritingRows(scope: LineView, prev: Scoped | undefined, cols: (Scoped | undefined)[]): StatementRow[] {
  const pool = scope === 'pool';
  const rate = (r?: Scoped) => (r ? ((r as LineResultSet).finalRatePer100 ?? (r as LineResultSet).ratePer100) : undefined);
  const series = (f: (r?: Scoped) => number | undefined) => cols.map(r => (pool ? BY_LINE : v(f(r))));
  const change = (f: (r?: Scoped) => number | undefined, asRatio: boolean) => cols.map((r, i) => {
    if (pool) return BY_LINE;
    const before = i === 0 ? prev : cols[i - 1];
    const a = f(r), b = f(before);
    if (a === undefined || b === undefined) return NA;
    return asRatio ? (b === 0 ? NONE : { kind: 'value' as const, v: a / b - 1 }) : { kind: 'value' as const, v: a - b };
  });
  const mk = (label: string, format: CellFormat, rowClass: RowClass, cells: Cell[], indent = false) =>
    row(label, format, rowClass, cells[0], cells.slice(1), { indent });
  return [
    mk('Written Exposure', 'exposure', 'point', series(r => r?.writtenExposure)),
    mk('Change from Prior', 'exposure', 'point', change(r => r?.writtenExposure, false), true),
    mk('New Business', 'exposure', 'flow', series(r => r?.newBusinessExposure), true),
    mk('Renewal', 'exposure', 'flow', series(r => r?.renewalExposure), true),
    mk('Retained %', 'pct', 'point', series(r => r?.memberRetentionRate), true),
    mk('Current Rate', 'rate', 'point', series(rate)),
    mk('% Change Over Prior', 'pct', 'point', change(rate, true), true),
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
  priorPremium: number | undefined, gamePremium: (number | undefined)[], yearZeroPremium: number | undefined,
): StatementRow[] {
  const prem = (x: number | undefined) => v(x);
  const change = gamePremium.map((p, i) => {
    const b = i === 0 ? yearZeroPremium : gamePremium[i - 1];
    return p === undefined || b === undefined ? NA : { kind: 'value' as const, v: p - b };
  });
  const ofPrior = gamePremium.map((p, i) => div(p, i === 0 ? yearZeroPremium : gamePremium[i - 1]));
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
    // ⚠ PRIOR HAS NO COMPLETE PREMIUM: the bulk years carry none, so a ratio
    // over the combined years would divide losses that have no premium.
    row('Loss and LAE Ratio', 'pct', 'point', NA, gameLoss.map((l, i) => div(ult(l), gamePremium[i]))),
  ];
}

// ---------------------------------------------------------------------------
export function buildAnnualStatement(gs: GameState, scope: LineView): AnnualStatement {
  const lines: CoverageLine[] = scope === 'pool' ? gs.setup.activeLines : [scope];
  const years = gs.lockedResults;
  const hist = gs.priorHistory ?? [];
  const y0 = hist.at(-1), yMinus1 = hist.at(-2);
  const columns = ['Prior', ...years.map(r => `Year ${r.yearNumber} / ${r.calendarYear}`), 'Total'];

  const operating = [y0, ...years].map(r => operatingOf(r ? at(r, scope) : undefined));
  const positions = [openingPosition(gs, scope), ...years.map(r => positionOf(at(r, scope)!))];

  // Program years, summed over the scope's lines.
  const perLine = lines.map(l => programYearsOf(gs, l));
  const blockAt = (pick: (b: AyBlock) => AyLoss, ays: (ay: number) => boolean) =>
    perLine.reduce((acc, m) => [...m.entries()].filter(([ay]) => ays(ay)).reduce((a, [, b]) => addLoss(a, pick(b)), acc), zero());
  const gameAy = (ay: number) => (pick: (b: AyBlock) => AyLoss) => blockAt(pick, x => x === ay);
  const premGame = years.map(r => premiumsOf(at(r, scope)));
  const premHist = hist.map(r => premiumsOf(at(r, scope)));
  const sumHist = (k: keyof Premiums) => (premHist.length === 0 || premHist.some(p => p[k] === undefined)
    ? undefined : premHist.reduce((s, p) => s + p[k]!, 0));
  const y0Prem = premiumsOf(y0 ? at(y0, scope) : undefined);

  const block = (key: 'gross' | 'ceded' | 'net', title: string, pick: (b: AyBlock) => AyLoss): StatementSection => ({
    key, title, basis: 'by program year, at the latest valuation',
    rows: programRows(key, blockAt(pick, ay => ay <= 0), years.map(r => gameAy(r.yearNumber)(pick)),
      sumHist(key), premGame.map(p => p[key]), y0Prem[key]),
  });

  const sections: StatementSection[] = [
    { key: 'operating', title: 'Operating Results', basis: 'by calendar year, net of reinsurance', rows: operatingRows(operating) },
    { key: 'balance', title: 'Balance Sheet at Year-End', basis: 'Prior is the opening position', rows: balanceRows(gs, scope, positions, operating.map(o => o.premium)) },
    { key: 'underwriting', title: 'Underwriting', basis: 'by calendar year',
      rows: underwritingRows(scope, yMinus1 ? at(yMinus1, scope) : undefined, [y0, ...years].map(r => (r ? at(r, scope) : undefined))) },
    block('gross', 'Gross', b => b.gross),
    block('ceded', 'Ceded (Reinsurance)', b => b.ceded),
    block('net', 'Net', b => b.net),
  ];

  const notes = [
    'Dollars are the average of the ten worlds; every ratio is worked out from those averaged figures. The surplus range is the one per-world figure.',
    'Prior: the opening position on the balance sheet; all earlier program years combined in the Gross, Ceded and Net blocks; the last pre-game year (year 0) in Operating Results and Underwriting.',
    `Prior premium is the ${hist.length} pre-game years kept as results (program years ${hist.map(r => r.yearNumber).join(', ')}). The two earliest pre-game years are played but their premium is not kept, and the older bulk years carry none — so Prior has no Loss and LAE Ratio.`,
    'Total: the game years summed for flows; the latest year for balances, ratios and changes.',
    'Loss adjustment expense is the rate\'s share of the ground-up loss: paid with the losses, its reserve held in IBNR. The reinsurer reimburses none of it, so it is in gross and net alike.',
  ];
  return { scope, columns, sections, notes };
}

/** Every row carrying a "not yet available" cell, as "Section — Row (column)". */
export function notYetAvailable(st: AnnualStatement): string[] {
  const out: string[] = [];
  for (const s of st.sections) for (const r of s.rows) r.cells.forEach((c, i) => {
    if (c.kind === 'na') out.push(`${s.title} — ${r.label} (${st.columns[i]})`);
  });
  return out;
}
