// ============================================================================
// THE ANNUAL STATEMENT AS A PDF — the same statement the page shows and the
// Excel file carries, drawn cell for cell: every section, row label, blank row,
// heading and border (TEMPLATE_ROWS and cellBorders), Prior where the section
// shows it, the five years, the All Years column, each figure as the page writes
// it (figureText), negatives in red, black on white.
//
// The statements of the player's view, in the Excel workbook's order — a line's
// alone on its view; on the Pool view the pool's, then each line the team
// writes (statementsForView) — each starting on a new page,
// landscape Letter. A small header on every page names the pool, the line and
// the year the statement stands at; the footer numbers the pages. The seven
// figure columns fit across at a reading size (9pt), a blank row at half a
// row's height (it only spaces the sections, as on the screen); a statement runs
// onto as many pages as it needs rather than shrinking. A section stays on one page when
// it fits there, and the Reinsurance section breaks only between its Gross,
// Ceded and Net blocks.
//
// ⚠ jsPDF IS LOADED ONLY WHEN THE FILE IS BUILT (a dynamic import, as exceljs is
// for the Excel file), so it is in no page's bundle. The standard Helvetica
// carries no "−" (U+2212), so a negative is written with "-"; it is red either
// way. annual-statement-pdf-check reads a file built here back, page by page,
// against the statements.
// ============================================================================
import {
  ALL_YEARS_LABEL, allYearsCell, cellBorders, figureText, isBlockName, showsPrior, shownFigure, statementsForView,
  TEMPLATE_ROWS, type TemplateRow, type TemplateStatement,
} from './annualStatementTemplate';
import type { GameState, LineView } from '../types/simulation';

/** Landscape Letter, in points. */
export const PDF_PAGE = { width: 792, height: 612 } as const;
const MARGIN_X = 30;
const TOP = 44;            // the table's first row
const BOTTOM = 576;        // no row below this
export const PDF_FONT_SIZE = 9;
export const PDF_ROW_HEIGHT = 11.5;
/** A blank row only spaces the sections, as on the screen: half a row. */
export const PDF_BLANK_HEIGHT = 6;
const heightOf = (i: number) => (TEMPLATE_ROWS[i].kind === 'blank' ? PDF_BLANK_HEIGHT : PDF_ROW_HEIGHT);
const HEADER_FONT_SIZE = 8;
/** Column B (labels), then the seven figure columns C to I — Prior, the five years, All Years — 732pt across. */
const LABEL_WIDTH = 228;
const FIGURE_WIDTH = 72;
const INDENT = 18;
const PAD = 3;
const RED: [number, number, number] = [220, 38, 38];

/** Page header text: the pool, the line, the year the statement stands at. */
export const pdfHeaderText = (poolName: string, ts: TemplateStatement) =>
  `${poolName} - ${ts.scopeName} - Annual Statement as of 12/31/${ts.years.at(-1) ?? ''}`;
export const PDF_UNITS_TEXT = 'Dollars in thousands. Exposure in $M; rates per $100 of exposure.';
export const pdfFooterText = (page: number, pages: number) => `Page ${page} of ${pages}`;
/** A figure as the PDF writes it: the page's text, with "-" for "−" (Helvetica has no U+2212). */
export const pdfFigureText = (text: string) => text.replace(/−/g, '-');

const yearEnd = (calendarYear: number) => `12/31/${String(calendarYear % 100).padStart(2, '0')}`;
const colX = (c: number) => (c === 2 ? MARGIN_X : MARGIN_X + LABEL_WIDTH + (c - 3) * FIGURE_WIDTH); // B = 2 … I = 9
const colW = (c: number) => (c === 2 ? LABEL_WIDTH : FIGURE_WIDTH);

/** One cell's text as the PDF writes it, column c (B = 2 … I = 9) of statement row i; '' for none. */
export function pdfCellText(row: TemplateRow, i: number, c: number, ts: TemplateStatement): string {
  if (c === 2) return row.kind === 'blank' ? '' : row.label.trim();
  if (row.kind === 'header') {
    if (c === 3) return showsPrior(i) ? 'Prior' : '';
    if (c === 9) return row.allYears ? ALL_YEARS_LABEL : '';
    const y = ts.years[c - 4];
    return row.dates ? yearEnd(y) : String(y);
  }
  if (row.kind !== 'figure') return '';
  if (c === 9) {
    const t = allYearsCell(row, i, ts);
    return t === undefined ? '' : pdfFigureText(figureText(t, row.format));
  }
  const x = shownFigure(row, i, c - 3, ts);
  return x === undefined ? '' : pdfFigureText(figureText(x, row.format));
}

/**
 * The statement's rows in units that stay on one page where they fit: each
 * section from its title, the Reinsurance section cut at its blocks.
 */
function units(): number[][] {
  const out: number[][] = [[]];
  let inReinsurance = false;
  TEMPLATE_ROWS.forEach((row, i) => {
    if (row.kind === 'title') { inReinsurance = row.label.trim().startsWith('Reinsurance'); out.push([]); }
    else if (inReinsurance && row.kind === 'header' && isBlockName(row.label) && out[out.length - 1].some(j => TEMPLATE_ROWS[j].kind === 'header')) out.push([]);
    out[out.length - 1].push(i);
  });
  return out.filter(u => u.length > 0);
}

/** Each page's statement rows, for one statement: whole units where they fit, a unit taller than a page row by row. */
export function pdfPagePlan(): number[][] {
  const room = BOTTOM - TOP;
  const pages: number[][] = [[]];
  let used = 0;
  const height = (rows: number[]) => rows.reduce((t, i) => t + heightOf(i), 0);
  for (const u of units()) {
    // A unit that does not fit in what is left of the page starts a new one.
    if (used + height(u) > room && pages[pages.length - 1].length > 0) { pages.push([]); used = 0; }
    for (const i of u) {
      if (used + heightOf(i) > room) { pages.push([]); used = 0; }
      // A blank row that would open a page adds nothing there.
      if (pages[pages.length - 1].length === 0 && TEMPLATE_ROWS[i].kind === 'blank') continue;
      pages[pages.length - 1].push(i);
      used += heightOf(i);
    }
  }
  return pages.filter(p => p.length > 0);
}

type Doc = InstanceType<typeof import('jspdf').jsPDF>;

function drawRow(doc: Doc, row: TemplateRow, i: number, y: number, ts: TemplateStatement, red: [number, number, number]) {
  const h = heightOf(i);
  // Lines first, as the template draws them: each cell's own sides, thin.
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  for (let c = 2; c <= 9; c++) {
    const s = cellBorders(i, c), x = colX(c), w = colW(c);
    if (s.includes('L')) doc.line(x, y, x, y + h);
    if (s.includes('R')) doc.line(x + w, y, x + w, y + h);
    if (s.includes('T')) doc.line(x, y, x + w, y);
    if (s.includes('B')) doc.line(x, y + h, x + w, y + h);
  }
  const base = y + h - 3;
  const bold = row.kind === 'title' || row.kind === 'header';
  for (let c = 2; c <= 9; c++) {
    const text = pdfCellText(row, i, c, ts);
    if (!text) continue;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(...(row.kind === 'figure' && c > 2 && text.startsWith('-') ? red : [0, 0, 0] as [number, number, number]));
    const x = colX(c), w = colW(c);
    if (c === 2) {
      // Labels on the left, a sub-item indented; a header's label on the right,
      // as the page draws it — but the Reinsurance blocks' names, on the left.
      if (row.kind === 'header' && !isBlockName(row.label)) doc.text(text, x + w - PAD, base, { align: 'right' });
      else doc.text(text, x + PAD + (row.kind !== 'title' && row.kind !== 'blank' && /^\s/.test(row.label) ? INDENT : 0), base);
    } else if (row.kind === 'header') doc.text(text, x + w / 2, base, { align: 'center' });
    else doc.text(text, x + w - PAD, base, { align: 'right' });
  }
}

/**
 * The PDF of these statements, one after another, each from a new page.
 * `negativeRgb` is the negatives' colour — red; only annual-statement-pdf-check's
 * control passes another, to prove the check reads it.
 */
export async function buildStatementsPdf(statements: TemplateStatement[], poolName: string,
  { negativeRgb = RED }: { negativeRgb?: [number, number, number] } = {}): Promise<ArrayBuffer> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({ title: `Annual Statement - ${poolName}` });
  doc.setFontSize(PDF_FONT_SIZE);
  const plan = pdfPagePlan();
  let first = true;
  const headers: string[] = [];
  for (const ts of statements) {
    for (const rows of plan) {
      if (!first) doc.addPage('letter', 'landscape');
      first = false;
      headers.push(pdfHeaderText(poolName, ts));
      let y = TOP;
      for (const i of rows) { drawRow(doc, TEMPLATE_ROWS[i], i, y, ts, negativeRgb); y += heightOf(i); }
    }
  }
  // Every page's header and footer, once the page count is known.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(HEADER_FONT_SIZE);
    doc.setTextColor(0, 0, 0);
    doc.text(headers[p - 1], MARGIN_X, 26);
    doc.text(PDF_UNITS_TEXT, PDF_PAGE.width - MARGIN_X, 26, { align: 'right' });
    doc.text(pdfFooterText(p, pages), PDF_PAGE.width / 2, PDF_PAGE.height - 16, { align: 'center' });
    doc.setFontSize(PDF_FONT_SIZE);
  }
  return doc.output('arraybuffer');
}

/**
 * The Annual Statement PDF a player downloads for a view, as of a year (the
 * latest by default): the statements the view's download holds
 * (statementsForView) — a line's alone on its view; the pool's, then each
 * line's, on the Pool view.
 */
export async function buildAnnualStatementPdf(gs: GameState, asOfYear?: number, view: LineView = 'pool'): Promise<ArrayBuffer> {
  return buildStatementsPdf(statementsForView(gs, view, asOfYear), gs.setup.poolName);
}
