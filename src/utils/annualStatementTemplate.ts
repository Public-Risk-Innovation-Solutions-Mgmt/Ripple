// ============================================================================
// THE ANNUAL STATEMENT, LAID OUT AS THE TEMPLATE — docs/Annual Statement
// Example v2.xlsx (its Pool sheet), cell for cell.
//
// TEMPLATE_ROWS is the template transcribed row by row from row 1: every
// section title and row label exactly as written there (leading and trailing
// spaces included) in column B — but for the DELIBERATE DIFFERENCES listed below
// (LABEL_CHANGES and one inserted row), and only those — every blank row where it
// is, and the figures in D to H (the five years shown). In the four kinds of
// program-year section — Contributions To The Current Calendar Year, Program Year
// Totals and the Gross, Ceded and Net blocks — C is Prior and column I is ALL
// YEARS: the sum of Prior and the five years on every dollar row, blank on the
// ratio rows (allYearsCell). The first three sections (Net Income Statement For
// The Year, Balance Sheet at Year-End, Underwriting) leave C and I blank with
// their lines kept, so every table is seven columns wide, the years aligned.
//
// v2 is the first template with "Profit and Contigency" already gone (the v1
// file's row 15 — a margin in the rate, not an expense — which this list used
// to drop itself), and with ONE blank row, not two, between the Contributions'
// Written Premium and "Previous Reported Claims". annual-statement-template-check
// reads v2 and holds this list to it label for label and blank for blank — and
// the downloaded file to its BORDERS and its All Years formulas cell for cell
// (TEMPLATE_BORDERS, generated from v2, through cellBorders), through that list.
//
// ⚠ EVERY FIGURE IS READ, NEVER RESTATED. The calendar sections and the program-
// year blocks are buildAnnualStatement's own cells (resultsStatement.ts), so the
// screen, the Excel file, the header and the session's posted results all read
// one computation. What the template asks for that the statement did not carry
// is derived here from engine figures alone:
//   · Operating Ratio — (net losses + LAE + admin + risk control + reinsurance
//     cost − investment income) over the member charge: the combined ratio's
//     costs and denominator, less investment income. The reinsurance cost is a
//     cost in it, so the denominator is the charge that pays for it, exactly as
//     the combined ratio's (resultsStatement's combinedRatioRow).
//   · Reserve to Surplus Ratio — (Loss Reserves + Loss Expense Reserves) over
//     Net Worth.
//   · Underwriting — each line's own written, new and renewal exposure, Retained
//     % as Renewal Business over last year's Written Exposures, and its rate; at
//     pool scope the lines' sum where their exposures share a unit (see below).
//   · Contributions To The Current Calendar Year — each program year's net loss
//     and LAE valued at the year the statement stands at, less the same valued a
//     year earlier (programYearsOf at both), split for each older accident year
//     between claims newly arising (IBNR emerging to reported, plus IBNR's share
//     of the year's development) and claims previously reported (the year's
//     payments and the rest of the development), with Change in IBNR balancing
//     them. The current program year's claims are all newly arising. Two
//     variances then re-split it without moving any accident year's payments or
//     Total Net Incurred: newly reported claims paid in part, and settlement
//     differences drawn from the game's seed (SETTLEMENT_SPREAD). Its Written
//     Premium row is each program year's own written premium.
//   · General and Other Admin Expense's "% of Premium" — each row over Written
//     Premium.
//
// A ROW WITH NO FIGURE shows "—", never zero; noFigureRows lists them.
// ============================================================================

import {
  buildAnnualStatement, num, programYearsOf, COMBINED_RATIO_LABEL, ENDING_SURPLUS_LABEL,
  type AnnualStatement, type AyBlock, type StatementSection,
} from './resultsStatement';
import { lineDisplayName } from './lineDisplay';
import { TEMPLATE_BORDERS } from './annualStatementBorders';
import { marketSeedOf } from './bookUnits';
import { deriveSubRng } from './random';
import type { CoverageLine, GameState, LineResultSet, LineView, ResultSet } from '../types/simulation';

export type FigureFormat = 'dollars' | 'pct' | 'ratio' | 'exposure' | 'rate';

/** One template row. `label` is the template's text exactly, spaces included. */
export type TemplateRow =
  | { kind: 'blank' }
  | { kind: 'title'; label: string }
  /** The column header: Prior and the five years — calendar years, or 12/31 year-ends on the balance sheet — and "All Years" where the section has it. */
  | { kind: 'header'; label: string; dates?: boolean; allYears?: boolean }
  /** A heading with no figures of its own (the Contributions' two claim groups). */
  | { kind: 'heading'; label: string }
  | { kind: 'figure'; label: string; key: string; format: FigureFormat };

const B: TemplateRow = { kind: 'blank' };
const blanks = (n: number): TemplateRow[] => Array.from({ length: n }, () => B);
const T = (label: string): TemplateRow => ({ kind: 'title', label });
const H = (label: string, dates = false): TemplateRow => ({ kind: 'header', label, ...(dates ? { dates } : {}) });
/** A program-year section's header: its columns end in All Years. */
const HA = (label: string): TemplateRow => ({ kind: 'header', label, allYears: true });
const F = (label: string, key: string, format: FigureFormat): TemplateRow => ({ kind: 'figure', label, key, format });
const IN = '      ';

/** The template's program-year block, as it stands under each of Program Year Totals, Gross, Ceded and Net. */
const programBlock = (k: string): TemplateRow[] => [
  F('Written Premium', `${k}.premium`, 'dollars'),
  F(`${IN}% Increase over Prior`, `${k}.premiumIncrease`, 'pct'),
  B,
  F('Paid Loss & LAE', `${k}.paid`, 'dollars'),
  F('Case Reserves', `${k}.case`, 'dollars'),
  F('Reported Loss & LAE', `${k}.reported`, 'dollars'),
  B,
  F('IBNR Reserves', `${k}.ibnr`, 'dollars'),
  B,
  F('Total Incurred Loss & LAE', `${k}.incurred`, 'dollars'),
  B,
  F('Loss & LAE Ratio', `${k}.ratio`, 'pct'),
];

/**
 * THE STATEMENT'S HEADINGS THAT DIFFER FROM THE TEMPLATE, deliberately — the
 * template's wording on the left. They are part of TEMPLATE_DIFFERENCES below,
 * which lists every cell the statement differs from the template in.
 *   · "Net Income Statement For The Year": its columns are what was booked in
 *     each calendar year (the template's own text has a trailing space).
 *   · "… - Program Year Totals": to match "Program Year Totals - Net".
 *   · "… - Net of Reinsurance", on the Contributions and Program Year Totals:
 *     what "Net" is net of.
 */
export const RENAMED_HEADINGS: Readonly<Record<string, string>> = {
  'Net Income Statement ': 'Net Income Statement For The Year',
  'Reinsurance Information - Policy Year Totals': 'Reinsurance Information - Program Year Totals',
  'Contributions To The Current Calendar Year - Net': 'Contributions To The Current Calendar Year - Net of Reinsurance',
  'Program Year Totals - Net': 'Program Year Totals - Net of Reinsurance',
};

/** The template, row 1 first. Index i is spreadsheet row i + 1. */
export const TEMPLATE_ROWS: readonly TemplateRow[] = [
  B,
  T(RENAMED_HEADINGS['Net Income Statement ']),
  B,
  H('Program Year:   '),
  B,
  F('Written Premium', 'premium', 'dollars'),
  B,
  F('Incurred Losses', 'losses', 'dollars'),
  F('Incurred Loss Adjustment Expense', 'lae', 'dollars'),
  F('Total Incurred Loss & LAE', 'lossLae', 'dollars'),
  F(`${IN}% of Premium`, 'lossLaePct', 'pct'),
  B,
  // Each admin row, then its own share of Written Premium (the template had one
  // "% of Premium" for both, under them): the statement's one inserted row is
  // General Admin Expense's.
  F('General Admin Expense', 'admin', 'dollars'),
  F(`${IN}% of Premium`, 'adminPct', 'pct'),
  F('Other Admin Expense', 'riskControl', 'dollars'),
  // ⚠ "Profit and Contigency" stood here in the v1 template (its row 15): gone, a margin in the rate, not an expense.
  F(`${IN}% of Premium`, 'otherAdminPct', 'pct'),
  B,
  F('Combined Ratio', 'combinedRatio', 'pct'),
  B,
  F('Net Underwriting Income', 'nui', 'dollars'),
  F(`${IN}% of Premium`, 'nuiPct', 'pct'),
  B,
  F('Assessments/Dividends', 'assessDiv', 'dollars'),
  B,
  F('Investment Income', 'investment', 'dollars'),
  B,
  F('Net Operating Income', 'netIncome', 'dollars'),
  B,
  F('Operating Ratio', 'operatingRatio', 'pct'),
  ...blanks(4),

  T('Balance Sheet at Year-End'),
  B,
  H('', true),
  B,
  F('Assets', 'assets', 'dollars'),
  F(`${IN}Invested`, 'invested', 'dollars'),
  F(`${IN}Uninvested`, 'uninvested', 'dollars'),
  B,
  F('Liabilities', 'liabilities', 'dollars'),
  F(`${IN}Loss Reserves`, 'lossRes', 'dollars'),
  F(`${IN}Loss Expense Reserves`, 'laeRes', 'dollars'),
  F(`${IN}Other Liabilities`, 'otherLiab', 'dollars'),
  B,
  F('Net Worth', 'netWorth', 'dollars'),
  F(`${IN}Paid in Capital`, 'paidIn', 'dollars'),
  F(`${IN}Earned Surplus`, 'earned', 'dollars'),
  B,
  F('Premium to Surplus Ratio', 'premToSurplus', 'ratio'),
  F('Reserve to Surplus Ratio', 'resToSurplus', 'ratio'),
  ...blanks(2),

  T('Underwriting'),
  B,
  H('Program Year:   '),
  B,
  F('Written Exposures', 'exposure', 'exposure'),
  F(`${IN}Change from Prior`, 'exposureChange', 'pct'),
  B,
  F('New Business', 'newBusiness', 'exposure'),
  F('Renewal Business', 'renewal', 'exposure'),
  F(`${IN}Retained %`, 'retained', 'pct'),
  B,
  F('Current Rate', 'rate', 'rate'),
  F(`${IN}% Change Over Prior`, 'rateChange', 'pct'),
  ...blanks(3),

  T(RENAMED_HEADINGS['Contributions To The Current Calendar Year - Net']),
  B,
  HA('Program Year:   '),
  F('Written Premium', 'cy.premium', 'dollars'),
  // ONE blank row here, as v2 has it (the v1 template had two).
  B,
  { kind: 'heading', label: 'Previous Reported Claims (Loss & LAE)' },
  F(`${IN}Payments`, 'cy.prev.paid', 'dollars'),
  F(`${IN}Reserve Changes`, 'cy.prev.case', 'dollars'),
  F(`${IN}Net Reported`, 'cy.prev.reported', 'dollars'),
  B,
  { kind: 'heading', label: 'Newly Arising Claims (Loss & LAE)' },
  F(`${IN}Payments`, 'cy.new.paid', 'dollars'),
  F(`${IN}Reserve Changes`, 'cy.new.case', 'dollars'),
  F(`${IN}Net Reported`, 'cy.new.reported', 'dollars'),
  B,
  F('Change in IBNR', 'cy.ibnr', 'dollars'),
  B,
  F('Total Net Incurred', 'cy.incurred', 'dollars'),
  ...blanks(3),

  T(RENAMED_HEADINGS['Program Year Totals - Net']),
  B,
  HA('Program Year:   '),
  ...programBlock('py'),
  ...blanks(4),

  T(RENAMED_HEADINGS['Reinsurance Information - Policy Year Totals']),
  B,
  HA('Gross'),
  ...programBlock('gross'),
  ...blanks(2),
  HA('Ceded'),
  ...programBlock('ceded'),
  ...blanks(2),
  HA('Net'),
  ...programBlock('net'),
  // The template's last row (155; the statement's 156): blank, and the one that carries the Net block's closing line.
  B,
];

// ============================================================================
// EVERY DELIBERATE DIFFERENCE FROM THE TEMPLATE — one list, read by the page, the
// Excel file and the gate. The gate builds the template's expected grid through
// exactly these and fails on any other cell that differs.
// ============================================================================

/** The statement's one inserted row: General Admin Expense's own "% of Premium", after template row 13 (1-based). Its lines are that row's. */
export const INSERTED_AFTER_TEMPLATE_ROW = 13;

/** Each statement row's template row (1-based); the inserted row takes the row above's, for its borders. */
export const TEMPLATE_ROW_OF: readonly number[] = TEMPLATE_ROWS.map((_, i) =>
  (i + 1 <= INSERTED_AFTER_TEMPLATE_ROW ? i + 1 : i + 1 === INSERTED_AFTER_TEMPLATE_ROW + 1 ? INSERTED_AFTER_TEMPLATE_ROW : i));
export const isInsertedRow = (i: number) => i + 1 === INSERTED_AFTER_TEMPLATE_ROW + 1;

export interface LabelChange { templateRow: number; from: string; to: string; why: string }
/** Every column-B text the statement changes, by the template row it stands on (1-based). */
export const LABEL_CHANGES: readonly LabelChange[] = [
  { templateRow: 2, from: 'Net Income Statement ', to: RENAMED_HEADINGS['Net Income Statement '], why: 'its columns are what was booked in each calendar year' },
  { templateRow: 6, from: 'Premium', to: 'Written Premium', why: 'the premium written that year, as the program-year tables name it' },
  { templateRow: 11, from: '% of Premium', to: `${IN}% of Premium`, why: 'indented like the other tables\' sub-rows, not right-aligned' },
  { templateRow: 14, from: 'Additional Admin Expense (risk control)', to: 'Other Admin Expense', why: 'the admin beyond general admin' },
  { templateRow: 15, from: '% of Premium', to: `${IN}% of Premium`, why: 'now Other Admin Expense\'s own share (General Admin Expense has its own, the inserted row)' },
  { templateRow: 20, from: '% of Premium', to: `${IN}% of Premium`, why: 'indented like the other tables\' sub-rows' },
  { templateRow: 70, from: 'Contributions To The Current Calendar Year - Net', to: RENAMED_HEADINGS['Contributions To The Current Calendar Year - Net'], why: 'what Net is net of' },
  { templateRow: 91, from: 'Program Year Totals - Net', to: RENAMED_HEADINGS['Program Year Totals - Net'], why: 'what Net is net of' },
  { templateRow: 110, from: 'Reinsurance Information - Policy Year Totals', to: RENAMED_HEADINGS['Reinsurance Information - Policy Year Totals'], why: 'to match Program Year Totals' },
];
/** The inserted row's label. */
export const INSERTED_LABEL = `${IN}% of Premium`;

export const ALL_YEARS_LABEL = 'All Years';
/** The first row of the sections that carry All Years: Contributions, then everything below it. */
const FIRST_ALL_YEARS_ROW = TEMPLATE_ROWS.findIndex(r => r.kind === 'title' && r.label.startsWith('Contributions To The Current Calendar Year'));
/**
 * Whether statement row i (0-based) is in a section with the All Years column —
 * the program-year sections, which are also the only ones that show Prior. The
 * first three (Net Income Statement For The Year, Balance Sheet at Year-End and
 * Underwriting) leave C and I blank, their lines kept, so every table's box is
 * the same seven columns wide and the years line up down the page.
 */
export const hasAllYears = (i: number): boolean => i > FIRST_ALL_YEARS_ROW;
export const showsPrior = hasAllYears;

/** The Reinsurance blocks' names, which head their blocks in bold in the label column. */
export const isBlockName = (label: string) => ['Gross', 'Ceded', 'Net'].includes(label.trim());

/** Rows whose first year's cell is blank — a change from Prior, now that Prior is not shown beside it. */
const BLANK_FIRST_YEAR = new Set(['exposureChange', 'rateChange']);

/**
 * WHAT A FIGURE CELL SHOWS: column k (0 Prior, 1–5 the years) of statement row i.
 * undefined is BLANK — Prior in the first three sections, and the first year of
 * Underwriting's two changes; a figure (null is "—") otherwise.
 */
export function shownFigure(row: TemplateRow, i: number, k: number, ts: TemplateStatement): Figure | undefined {
  if (row.kind !== 'figure') return undefined;
  if (k === 0 && !showsPrior(i)) return undefined;
  if (k === 1 && BLANK_FIRST_YEAR.has(row.key)) return undefined;
  return ts.figures[row.key][k];
}

/**
 * A STATEMENT CELL'S LINES: column c (1 = A … 9 = I) of statement row i, as 'LRTB'
 * sides — the template's, through TEMPLATE_ROW_OF (the inserted row takes the
 * row above's), with column I given column H's lines in the first three
 * sections, which have no All Years, so every table's box is the same width.
 */
export function cellBorders(i: number, c: number): string {
  const t = TEMPLATE_BORDERS[TEMPLATE_ROW_OF[i] - 1];
  if (c === 9 && !hasAllYears(i)) return t[7];
  return t[c - 1];
}
/**
 * A row's All Years cell: on a dollar row of an All Years section, the sum of
 * Prior and the five years — the cells with a figure, as Excel's SUM reads them;
 * "—" (null) when none has one. Everything else — the ratio rows above all —
 * is BLANK there (undefined).
 */
export function allYearsCell(row: TemplateRow, i: number, ts: TemplateStatement): Figure | undefined {
  if (row.kind !== 'figure' || row.format !== 'dollars' || !hasAllYears(i)) return undefined;
  const xs = ts.figures[row.key].filter((x): x is number => x !== null);
  return xs.length === 0 ? null : xs.reduce((t, x) => t + x, 0);
}

/** The section each template row belongs to, by the title above it — for the page's tables and their test ids. */
export const TEMPLATE_SECTION_KEYS = ['operating', 'balance', 'underwriting', 'contributions', 'programYears', 'reinsurance'] as const;
export type TemplateSectionKey = typeof TEMPLATE_SECTION_KEYS[number];

/** A figure cell: a number in the statement's units, or no figure ("—"). */
export type Figure = number | null;

export interface TemplateStatement {
  scope: LineView;
  /** The sheet name / screen title: "Pool", or the line's name. */
  scopeName: string;
  asOf: number;
  /** "Prior", then the five calendar years shown. */
  columns: string[];
  /** The calendar years of the five window columns. */
  years: number[];
  /** Keyed by TemplateRow.key: Prior, then the five years. Dollars are DOLLARS here; the page and the file show thousands. */
  figures: Record<string, Figure[]>;
}

/** The statement's units: dollars in thousands, the same as the statement has always shown. */
export const DOLLARS_PER_UNIT = 1000;

const at = (r: ResultSet, scope: LineView) => (scope === 'pool' ? r : r.byLine[scope]);
const sec = (st: AnnualStatement, key: StatementSection['key']) => st.sections.find(s => s.key === key)!;

/**
 * A statement row's cells re-cut to Prior and the five years: the Total column
 * dropped, Prior "—" where the section has none. Anything that is not a value
 * — not yet available, no meaning here, by line — is no figure.
 */
function sixOf(s: StatementSection, label: string, nth = 0): Figure[] {
  const r = s.rows.filter(x => x.label === label)[nth];
  if (!r) throw new Error(`annual statement: no row "${label}" in ${s.key}`);
  const figs = r.cells.slice(0, -1).map(c => num(c) ?? null);
  return s.hasPrior ? figs : [null, ...figs];
}

const zip = (a: Figure[], b: Figure[], f: (x: number, y: number) => number | null): Figure[] =>
  a.map((x, i) => (x === null || b[i] === null ? null : f(x, b[i]!)));
const ratio = (n: number, d: number) => (d === 0 ? null : n / d);
const columnsZero = (n: number) => Array.from({ length: n }, () => ({ prevPaid: 0, prevCase: 0, newPaid: 0, newCase: 0, ibnr: 0, incurred: 0 }));

/** Prior and each window year's results, at the scope: Prior is every year before the window, combined. */
function windowResults(gs: GameState, asOf: number, windowYears: number[]) {
  const full: ResultSet[] = [...(gs.earlyPreGameHistory ?? []), ...(gs.priorHistory ?? []), ...gs.lockedResults]
    .filter(r => r.yearNumber <= asOf);
  return {
    rolled: full.filter(r => r.yearNumber < windowYears[0]),
    window: windowYears.map(y => full.find(r => r.yearNumber === y)!),
    full,
  };
}

/** One accident year's movement in a year, split as the Contributions show it (buildTemplateStatement). */
interface AySplit { newPaid: number; newCase: number; prevPaid: number; prevCase: number; ibnr: number; incurred: number; settlement: number }

/**
 * ONE LINE'S YEAR, ACCIDENT YEAR BY ACCIDENT YEAR: the movement from `then` to
 * `now` (programYearsOf at the two valuations), `yearNumber` the later, split
 * between newly arising and previously reported claims with both variances —
 * newly reported claims paid in part, and the settlement draw. The current
 * program year's own claims are all newly arising, with no draw.
 */
function yearSplits(now: Map<number, AyBlock>, then: Map<number, AyBlock>, yearNumber: number, line: CoverageLine, seed: number): Map<number, AySplit> {
  const out = new Map<number, AySplit>();
  const firstYear = now.get(yearNumber)?.net;
  const firstYearReported = firstYear ? firstYear.paid + firstYear.case_ : 0;
  const paidShare = firstYear && firstYearReported > 0 ? Math.min(1, Math.max(0, firstYear.paid / firstYearReported)) : 0;
  const z = { paid: 0, case_: 0, ibnr: 0 };
  for (const ay of new Set([...now.keys(), ...then.keys()])) {
    const a = now.get(ay)?.net ?? z, b = then.get(ay)?.net ?? z;
    const dPaid = a.paid - b.paid, dCase = a.case_ - b.case_, dIbnr = a.ibnr - b.ibnr;
    const d = dPaid + dCase + dIbnr;
    if (ay === yearNumber) {
      out.set(ay, { newPaid: dPaid, newCase: dCase, prevPaid: 0, prevCase: 0, ibnr: dIbnr, incurred: d, settlement: 0 });
      continue;
    }
    const outstanding = b.case_ + b.ibnr;
    const share = outstanding > 0 ? Math.min(1, Math.max(0, b.ibnr / outstanding)) : 0;
    const newReported = -dIbnr + share * d;
    const newPaid = Math.min(Math.max(0, dPaid), Math.max(0, paidShare * newReported));
    const prevPaid = dPaid - newPaid;
    const settlement = settlementDraw(seed, yearNumber, line, ay) * prevPaid;
    const prevReported = (1 - share) * d + settlement;
    out.set(ay, {
      newPaid, newCase: newReported - newPaid, prevPaid, prevCase: prevReported - prevPaid,
      ibnr: dIbnr - settlement, incurred: d, settlement,
    });
  }
  return out;
}

export function buildTemplateStatement(gs: GameState, scope: LineView, asOfYear?: number): TemplateStatement {
  const st = buildAnnualStatement(gs, scope, asOfYear);
  const op = sec(st, 'operating'), bal = sec(st, 'balance');
  const windowYears = op.windowYears;
  const { rolled, window, full } = windowResults(gs, st.asOf, windowYears);
  const figures: Record<string, Figure[]> = {};

  // --- Net Income Statement ---------------------------------------------------
  figures.premium = sixOf(op, 'Premium');
  figures.losses = sixOf(op, 'Incurred Losses');
  figures.lae = sixOf(op, 'Incurred Loss Adjustment Expense');
  figures.lossLae = sixOf(op, 'Total Incurred Loss & LAE');
  figures.lossLaePct = sixOf(op, 'Loss & LAE Ratio');
  figures.admin = sixOf(op, 'General Admin Expense');
  figures.riskControl = sixOf(op, 'Additional Admin Expense (risk control)');
  // Each admin row's own share of Written Premium (the template's one "% of Premium" covered both).
  figures.adminPct = zip(figures.admin, figures.premium, ratio);
  figures.otherAdminPct = zip(figures.riskControl, figures.premium, ratio);
  figures.combinedRatio = sixOf(op, COMBINED_RATIO_LABEL);
  figures.nui = sixOf(op, 'Net Underwriting Income');
  figures.nuiPct = sixOf(op, '% of Premium', 1);
  figures.assessDiv = sixOf(op, 'Assessments/Dividends');
  figures.investment = sixOf(op, 'Investment Income');
  figures.netIncome = sixOf(op, 'Net Operating Income');
  // Operating Ratio: the combined ratio's costs less investment income, over the member charge.
  const opRatio = (rs: ResultSet[]): Figure => {
    if (rs.length === 0) return null;
    const xs = rs.map(r => at(r, scope));
    if (xs.some(x => !x)) return null;
    const sum = (f: (x: ResultSet | LineResultSet) => number) => xs.reduce((s, x) => s + f(x!), 0);
    const costs = sum(x => x.netIncurredLoss + x.laeIncurred + x.operatingExpense + x.riskControlInvestment + x.reinsuranceCost);
    return ratio(costs - sum(x => x.investmentIncome), sum(x => x.totalMemberCharge));
  };
  figures.operatingRatio = [opRatio(rolled), ...window.map(r => opRatio([r]))];

  // --- Balance Sheet at Year-End ----------------------------------------------
  figures.invested = sixOf(bal, 'Invested');
  figures.uninvested = sixOf(bal, 'Cash');
  figures.assets = zip(figures.invested, figures.uninvested, (a, b) => a + b);
  figures.lossRes = sixOf(bal, 'Loss Reserves');
  figures.laeRes = sixOf(bal, 'Loss Expense Reserves');
  figures.otherLiab = sixOf(bal, 'Other Liabilities');
  figures.liabilities = zip(zip(figures.lossRes, figures.laeRes, (a, b) => a + b), figures.otherLiab, (a, b) => a + b);
  figures.netWorth = sixOf(bal, ENDING_SURPLUS_LABEL);
  figures.paidIn = sixOf(bal, 'Paid-in Capital');
  figures.earned = sixOf(bal, 'Earned Surplus');
  figures.premToSurplus = sixOf(bal, 'Premium to Surplus');
  figures.resToSurplus = zip(zip(figures.lossRes, figures.laeRes, (a, b) => a + b), figures.netWorth, ratio);

  // --- Underwriting ---------------------------------------------------------
  // Read off each line's own result. At pool scope a figure is the lines' sum —
  // only where their exposures are in one unit: WC and GL share the payroll base
  // ($M of payroll); Property's is building value ($M of TIV), so a pool writing
  // Property beside WC or GL shows "—" in every row here (exposures, their
  // change, new and renewal business, retained %, and the rate per $100 of
  // exposure and its change). A pool of Property alone is in one unit, and sums.
  const uwLines: CoverageLine[] = scope === 'pool' ? gs.setup.activeLines : [scope];
  const unitOf = (l: CoverageLine) => (l === 'Property' ? 'TIV' : 'payroll');
  const addable = new Set(uwLines.map(unitOf)).size <= 1;
  const prevOf = (r: ResultSet): ResultSet | undefined => full[full.indexOf(r) - 1];
  const lineSum = (r: ResultSet | undefined, f: (x: LineResultSet) => number | undefined): Figure => {
    if (!r || !addable) return null;
    let sum = 0;
    for (const l of uwLines) {
      const x = r.byLine[l];
      const v = x ? f(x) : undefined;
      if (v === undefined || !Number.isFinite(v)) return null;
      sum += v;
    }
    return sum;
  };
  const exposureAt = (r?: ResultSet) => lineSum(r, x => x.writtenExposure);
  const rateOf = (x: LineResultSet) => x.finalRatePer100 ?? x.ratePer100;
  // One line's rate is its own; the pool's (payroll lines only) is weighted by each line's exposure.
  const rateAt = (r?: ResultSet): Figure => {
    const w = lineSum(r, x => rateOf(x) * x.writtenExposure), e = exposureAt(r);
    return w === null || e === null ? null : ratio(w, e);
  };
  const lastRolled = rolled.at(-1);
  const pointRow = (f: (r?: ResultSet) => Figure): Figure[] => [f(lastRolled), ...window.map(r => f(r))];
  const changeRow = (f: (r?: ResultSet) => Figure): Figure[] => pointRow(r => {
    const a = f(r), b = r ? f(prevOf(r)) : null;
    return a === null || b === null ? null : ratio(a, b) === null ? null : a / b - 1;
  });
  const flowRow = (f: (r?: ResultSet) => Figure): Figure[] => {
    const xs = rolled.map(r => f(r));
    return [xs.length === 0 || xs.some(x => x === null) ? null : xs.reduce<number>((t, x) => t + x!, 0), ...window.map(r => f(r))];
  };
  figures.exposure = pointRow(exposureAt);
  figures.exposureChange = changeRow(exposureAt);
  figures.newBusiness = flowRow(r => lineSum(r, x => x.newBusinessExposure));
  figures.renewal = flowRow(r => lineSum(r, x => x.renewalExposure));
  // Retained %: the business renewed over LAST year's written exposures. Prior's is
  // over every year in it that has a year before it — the first year the pool has
  // (2021) has none.
  const renewedOver = (rs: ResultSet[]): Figure => {
    const ok = rs.filter(r => prevOf(r) !== undefined);
    if (ok.length === 0) return null;
    const ren = ok.map(r => lineSum(r, x => x.renewalExposure)), base = ok.map(r => exposureAt(prevOf(r)));
    if ([...ren, ...base].some(x => x === null)) return null;
    return ratio(ren.reduce<number>((t, x) => t + x!, 0), base.reduce<number>((t, x) => t + x!, 0));
  };
  figures.retained = [renewedOver(rolled), ...window.map(r => renewedOver([r]))];
  figures.rate = pointRow(rateAt);
  figures.rateChange = changeRow(rateAt);

  // --- Program-year blocks: Program Year Totals - Net, and Gross / Ceded / Net --
  const block = (prefix: string, s: StatementSection) => {
    figures[`${prefix}.premium`] = sixOf(s, s.key === 'ceded' ? 'Reinsurance Premium' : 'Premium');
    // % Increase over Prior: the statement's "% of Prior" less one; Prior has no year before it.
    figures[`${prefix}.premiumIncrease`] = sixOf(s, '% of Prior').map((x, i) => (i === 0 || x === null ? null : x - 1));
    figures[`${prefix}.paid`] = sixOf(s, 'Paid Loss + LAE');
    figures[`${prefix}.case`] = sixOf(s, 'Case');
    figures[`${prefix}.reported`] = sixOf(s, 'Reported Loss + LAE');
    figures[`${prefix}.ibnr`] = sixOf(s, 'IBNR Reserve');
    figures[`${prefix}.incurred`] = sixOf(s, 'Ultimates');
    // The ratio, Prior included: Prior's incurred over Prior's premium, where both exist.
    const ratios = sixOf(s, 'Loss and LAE Ratio');
    const p = figures[`${prefix}.premium`], u = figures[`${prefix}.incurred`];
    ratios[0] = p[0] === null || u[0] === null ? null : ratio(u[0], p[0]);
    figures[`${prefix}.ratio`] = ratios;
  };
  block('py', sec(st, 'net'));
  block('gross', sec(st, 'gross'));
  block('ceded', sec(st, 'ceded'));
  block('net', sec(st, 'net'));

  // --- Contributions To The Current Calendar Year - Net ----------------------
  // Each program year's net loss and LAE valued at the year the statement stands
  // at, less the same a year earlier, accident year by accident year and line by
  // line, then summed into the columns. For an OLDER accident year, with D its
  // movement this year (Δpaid + Δcase + ΔIBNR) and s its IBNR share of the
  // reserve outstanding at the start of the year (IBNR ÷ (case + IBNR)):
  //   Newly Arising     Reserve Changes −ΔIBNR + s·D — the claims moving from IBNR
  //                     to reported (the reported pattern's emergence), plus the
  //                     share of this year's development that falls on IBNR;
  //                     Payments 0 (a claim newly reported is reserved, not yet paid).
  //   Previously Rep'd  Payments: the year's payments; Reserve Changes: (1 − s)·D
  //                     less them — the rest of the development, on claims already
  //                     reported, net of what was paid on them.
  //   Change in IBNR    ΔIBNR, which balances it: the three sum to D, so Total Net
  //                     Incurred is the year's movement exactly as before.
  // The current program year's own claims are all newly arising, as they arise.
  //
  // Then TWO VARIANCES, both only how the statement splits a year's movement —
  // each accident year's payments (Δpaid) and Total Net Incurred (D) are what
  // they were, and no engine figure moves:
  //   · NEWLY REPORTED CLAIMS ARE PAID IN PART. Of an older accident year's newly
  //     reported amount, the share a new accident year pays in its first year
  //     (that line's current program year: Δpaid ÷ (Δpaid + Δcase)) is paid —
  //     held between 0 and the year's payments. Previously Reported Payments are
  //     the rest, so the accident year's payments total as before; each group's
  //     Reserve Changes are its reported amount less its payments.
  //   · SETTLEMENT DIFFERENCES. Claims settle for a little more or less than
  //     they were reserved at: a draw per line, accident year and calendar year
  //     of mean zero, SETTLEMENT_SPREAD (a standard deviation, as a share of the
  //     previously reported payments) — from the GAME's seed, so every world and
  //     every reading draws the same. It adds to Previously Reported's Reserve
  //     Changes and comes off Change in IBNR, which balances it.
  //     The program-year blocks carry the same draws (every year's to date,
  //     moved from IBNR to case), so Contributions' Change in IBNR and Reserve
  //     Changes are exactly the movement in Program Year Totals' IBNR and Case
  //     Reserves; incurred and paid, and the reserves' total, are the engine's.
  // (A third, LAE paid half at report and half at close, is NOT drawn: LAE paid
  // is the engine's own figure — it is cash, and earns investment income — so
  // scheduling it would change the engine's figures, not only the statement's.)
  const before = full.length >= 2 ? full[full.length - 2] : undefined;
  const firstAy = windowYears[0];
  const colOf = (ay: number) => (ay < firstAy ? 0 : windowYears.indexOf(ay) + 1);
  type Split = { prevPaid: number; prevCase: number; newPaid: number; newCase: number; ibnr: number; incurred: number };
  const cols: Split[] = columnsZero(1 + windowYears.length);
  // Every year's split, line by line, from the timeline's first year to this
  // one: the Contributions take this year's, and the program-year blocks carry
  // every year's settlement differences so far (settledCase, below).
  const seed = marketSeedOf(gs.instance);
  const settled = columnsZero(1 + windowYears.length).map(() => 0);
  for (const l of uwLines) {
    const valued = full.map(r => programYearsOf(gs, l, r));
    for (let k = 1; k < full.length; k++) {
      const splits = yearSplits(valued[k], valued[k - 1], full[k].yearNumber, l, seed);
      for (const [ay, x] of splits) {
        const i = colOf(ay);
        if (i < 0) continue;
        settled[i] += x.settlement;
        if (k !== full.length - 1) continue;
        const c = cols[i];
        c.newPaid += x.newPaid; c.newCase += x.newCase; c.prevPaid += x.prevPaid; c.prevCase += x.prevCase;
        c.ibnr += x.ibnr; c.incurred += x.incurred;
      }
    }
  }
  // THE SETTLEMENT DIFFERENCES ON THE PROGRAM-YEAR BLOCKS. Each accident year's
  // draws to date move from IBNR to case — and so into Reported — in Program
  // Year Totals and the Gross and Net blocks (Ceded carries none: the draw is on
  // the retained claims, so Net = Gross − Ceded holds), so each year's Change in
  // IBNR and Reserve Changes in the Contributions are exactly the movement in
  // these rows. Paid and Total Incurred do not move, nor the reserves' total.
  for (const k of ['py', 'gross', 'net']) {
    for (const [row, sign] of [['case', 1], ['reported', 1], ['ibnr', -1]] as const) {
      figures[`${k}.${row}`] = figures[`${k}.${row}`].map((x, i) => (x === null ? null : x + sign * settled[i]));
    }
  }
  const cy = (f: (c: Split) => number): Figure[] => cols.map(c => (before ? f(c) : null));
  // Written Premium: each program year's own net written premium — Prior every older one's.
  figures['cy.premium'] = [...figures['py.premium']];
  figures['cy.prev.paid'] = cy(c => c.prevPaid);
  figures['cy.prev.case'] = cy(c => c.prevCase);
  figures['cy.prev.reported'] = cy(c => c.prevPaid + c.prevCase);
  figures['cy.new.paid'] = cy(c => c.newPaid);
  figures['cy.new.case'] = cy(c => c.newCase);
  figures['cy.new.reported'] = cy(c => c.newPaid + c.newCase);
  figures['cy.ibnr'] = cy(c => c.ibnr);
  figures['cy.incurred'] = cy(c => c.incurred);

  return {
    scope,
    scopeName: scope === 'pool' ? 'Pool' : lineDisplayName(scope),
    asOf: st.asOf,
    columns: ['Prior', ...window.map(r => `${r.calendarYear}`)],
    years: window.map(r => r.calendarYear),
    figures,
  };
}

/**
 * SETTLEMENT DIFFERENCES' SPREAD: the standard deviation of the draw by which an
 * older accident year's claims settle above or below their reserve in a year, as
 * a share of what is paid on them that year (the Contributions' settlement
 * variance, above). A setting — 0 draws none.
 */
export const SETTLEMENT_SPREAD: number = 0.03;

/** A year's settlement draw for one line's accident year, as a share of its payments: mean 0, SETTLEMENT_SPREAD, the game's seed. */
export function settlementDraw(gameSeed: number, yearNumber: number, line: CoverageLine, accidentYear: number): number {
  if (SETTLEMENT_SPREAD === 0) return 0;
  return deriveSubRng(gameSeed, yearNumber, `statement-settlement:${line}:${accidentYear}`).normal(0, 1) * SETTLEMENT_SPREAD;
}

/** Every figure row that shows "—" in some column, as "Section — Row (column)". */
export function noFigureRows(ts: TemplateStatement): string[] {
  const out: string[] = [];
  let section = '';
  TEMPLATE_ROWS.forEach((r, i) => {
    if (r.kind === 'title') section = r.label.trim();
    if (r.kind === 'header' && r.label.trim()) section = section.startsWith('Reinsurance') ? `Reinsurance ${r.label.trim()}` : section;
    if (r.kind !== 'figure') return;
    ts.figures[r.key].forEach((_, k) => { if (shownFigure(r, i, k, ts) === null) out.push(`${section} — ${r.label.trim()} (${ts.columns[k]})`); });
  });
  return out;
}

/** A figure as the page and the file show it: dollars in thousands, the statement's own formats. */
export function figureText(x: Figure, format: FigureFormat): string {
  if (x === null) return '—';
  const neg = (s: string) => s.replace(/^-/, '−');
  switch (format) {
    case 'dollars': { const r = Math.round(x / DOLLARS_PER_UNIT); return `${r < 0 ? '−' : ''}${Math.abs(r).toLocaleString('en-US')}`; }
    case 'pct': return neg(`${(x * 100).toFixed(1)}%`.replace(/^-(0\.0%)$/, '$1'));
    case 'ratio': return neg(x.toFixed(2).replace(/^-(0\.00)$/, '$1'));
    case 'exposure': return neg(Math.abs(x) < 0.05 ? '0.0' : x.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
    case 'rate': return neg(x.toFixed(3).replace(/^-(0\.000)$/, '$1'));
  }
}

/** Every statement the game has: the pool's, then each line the team writes. */
export function templateStatements(gs: GameState, asOfYear?: number): TemplateStatement[] {
  return (['pool', ...gs.setup.activeLines] as LineView[]).map(s => buildTemplateStatement(gs, s, asOfYear));
}
