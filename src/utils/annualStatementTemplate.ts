// ============================================================================
// THE ANNUAL STATEMENT, LAID OUT AS THE TEMPLATE — docs/Annual Statement
// Example.xlsx, cell for cell.
//
// TEMPLATE_ROWS is the template transcribed row by row from row 1: every
// section title and row label exactly as written there (leading and trailing
// spaces included) in column B, every blank row where it is, and the figures in
// C (Prior) to H (the five years shown). ONE CHANGE: the template's row 15,
// "Profit and Contigency", is removed and the rows below it close up by one — it
// is a margin in the rate, not an expense. annual-statement-template-check reads
// the template file and holds this list to it, label for label and blank for
// blank, apart from that row — and the downloaded file to its BORDERS cell for
// cell (STATEMENT_BORDERS, generated from the template, row for row with this).
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
//     them. The current program year's claims are all newly arising. Its Written
//     Premium row is each program year's own written premium.
//
// A ROW WITH NO FIGURE shows "—", never zero; noFigureRows lists them.
// ============================================================================

import {
  buildAnnualStatement, num, programYearsOf, COMBINED_RATIO_LABEL, ENDING_SURPLUS_LABEL,
  type AnnualStatement, type StatementSection,
} from './resultsStatement';
import { lineDisplayName } from './lineDisplay';
import type { CoverageLine, GameState, LineResultSet, LineView, ResultSet } from '../types/simulation';

export type FigureFormat = 'dollars' | 'pct' | 'ratio' | 'exposure' | 'rate';

/** One template row. `label` is the template's text exactly, spaces included. */
export type TemplateRow =
  | { kind: 'blank' }
  | { kind: 'title'; label: string }
  /** The column header: Prior and the five years — calendar years, or 12/31 year-ends on the balance sheet. */
  | { kind: 'header'; label: string; dates?: boolean }
  /** A heading with no figures of its own (the Contributions' two claim groups). */
  | { kind: 'heading'; label: string }
  | { kind: 'figure'; label: string; key: string; format: FigureFormat };

const B: TemplateRow = { kind: 'blank' };
const blanks = (n: number): TemplateRow[] => Array.from({ length: n }, () => B);
const T = (label: string): TemplateRow => ({ kind: 'title', label });
const H = (label: string, dates = false): TemplateRow => ({ kind: 'header', label, ...(dates ? { dates } : {}) });
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

/** The template, row 1 first. Index i is spreadsheet row i + 1. */
export const TEMPLATE_ROWS: readonly TemplateRow[] = [
  B,
  T('Net Income Statement '),
  B,
  H('Program Year:   '),
  B,
  F('Premium', 'premium', 'dollars'),
  B,
  F('Incurred Losses', 'losses', 'dollars'),
  F('Incurred Loss Adjustment Expense', 'lae', 'dollars'),
  F('Total Incurred Loss & LAE', 'lossLae', 'dollars'),
  F('% of Premium', 'lossLaePct', 'pct'),
  B,
  F('General Admin Expense', 'admin', 'dollars'),
  F('Additional Admin Expense (risk control)', 'riskControl', 'dollars'),
  // ⚠ "Profit and Contigency" stood here (template row 15): removed, a margin in the rate, not an expense.
  F('% of Premium', 'expensePct', 'pct'),
  B,
  F('Combined Ratio', 'combinedRatio', 'pct'),
  B,
  F('Net Underwriting Income', 'nui', 'dollars'),
  F('% of Premium', 'nuiPct', 'pct'),
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

  T('Contributions To The Current Calendar Year - Net'),
  B,
  H('Program Year:   '),
  F('Written Premium', 'cy.premium', 'dollars'),
  ...blanks(2),
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

  T('Program Year Totals - Net'),
  B,
  H('Program Year:   '),
  ...programBlock('py'),
  ...blanks(4),

  T('Reinsurance Information - Policy Year Totals'),
  B,
  H('Gross'),
  ...programBlock('gross'),
  ...blanks(2),
  H('Ceded'),
  ...programBlock('ceded'),
  ...blanks(2),
  H('Net'),
  ...programBlock('net'),
  // The template's last row, 157: blank, and the one that carries the Net block's closing line.
  B,
];

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
  figures.expensePct = sixOf(op, '% of Premium', 0);
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
  const asOfResult = full[full.length - 1];
  const before = full.length >= 2 ? full[full.length - 2] : undefined;
  const firstAy = windowYears[0];
  const colOf = (ay: number) => (ay < firstAy ? 0 : windowYears.indexOf(ay) + 1);
  type Split = { prevPaid: number; prevCase: number; newPaid: number; newCase: number; ibnr: number; incurred: number };
  const cols: Split[] = columnsZero(1 + windowYears.length);
  for (const l of uwLines) {
    if (!before) break;
    const now = programYearsOf(gs, l, asOfResult), then = programYearsOf(gs, l, before);
    for (const ay of new Set([...now.keys(), ...then.keys()])) {
      const i = colOf(ay);
      if (i < 0) continue;
      const z = { paid: 0, case_: 0, ibnr: 0 };
      const a = now.get(ay)?.net ?? z, b = then.get(ay)?.net ?? z;
      const dPaid = a.paid - b.paid, dCase = a.case_ - b.case_, dIbnr = a.ibnr - b.ibnr;
      const d = dPaid + dCase + dIbnr;
      const c = cols[i];
      if (ay === st.asOf) {
        c.newPaid += dPaid; c.newCase += dCase;
      } else {
        const outstanding = b.case_ + b.ibnr;
        const share = outstanding > 0 ? Math.min(1, Math.max(0, b.ibnr / outstanding)) : 0;
        c.newCase += -dIbnr + share * d;
        c.prevPaid += dPaid;
        c.prevCase += (1 - share) * d - dPaid;
      }
      c.ibnr += dIbnr;
      c.incurred += d;
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

/** Every figure row that shows "—" in some column, as "Section — Row (column)". */
export function noFigureRows(ts: TemplateStatement): string[] {
  const out: string[] = [];
  let section = '';
  for (const r of TEMPLATE_ROWS) {
    if (r.kind === 'title') section = r.label.trim();
    if (r.kind === 'header' && r.label.trim()) section = section.startsWith('Reinsurance') ? `Reinsurance ${r.label.trim()}` : section;
    if (r.kind !== 'figure') continue;
    ts.figures[r.key].forEach((x, i) => { if (x === null) out.push(`${section} — ${r.label.trim()} (${ts.columns[i]})`); });
  }
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
