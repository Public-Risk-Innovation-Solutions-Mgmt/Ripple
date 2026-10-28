// ============================================================================
// THE ANNUAL STATEMENT AS AN EXCEL FILE — one sheet for the pool and one for
// each line the team writes, each laid out cell for cell as the template
// (docs/Annual Statement Example v2.xlsx, through TEMPLATE_ROWS): labels in column
// B, the five years in D to H; in the program-year sections Prior in C and All
// Years in I (a SUM formula over the row, as the template writes it), and in the
// first three C and I blank, their lines kept, so every table is seven columns
// wide; every blank row where it is, and every cell's BORDER as the template
// draws it through the statement's deliberate differences (cellBorders, and the
// list beside it in annualStatementTemplate.ts).
//
// Every figure is a NUMBER, in the statement's units — dollars in thousands, a
// percentage as its fraction under a percent format — with negatives shown red
// by the number format. A row with no figure holds "—". The header rows hold the
// calendar years as numbers, and the balance sheet's its 12/31 year-ends as dates,
// as the template does.
//
// ⚠ WRITTEN WITH exceljs, LOADED ONLY WHEN THE FILE IS BUILT. The SheetJS build
// the rest of the app uses writes no borders, so this file needs a library that
// does — and exceljs is large, so it is a dynamic import: it is fetched the first
// time the button is pressed and is in no page's bundle.
//
// Tab names keep the short WC / GL / Property convention (lineDisplay.ts).
// annual-statement-template-check reads a file built here back against the
// template, borders included, and the export guard (solo-export-guard.ts) hashes it.
// ============================================================================
import type { Borders, Worksheet } from 'exceljs';
import {
  ALL_YEARS_LABEL, allYearsCell, cellBorders, DOLLARS_PER_UNIT, isBlockName, showsPrior, shownFigure, statementsForView, TEMPLATE_ROWS,
  type FigureFormat, type TemplateStatement,
} from './annualStatementTemplate';
import type { GameState, LineView } from '../types/simulation';

/** The figures' Excel number formats: the screen's units and decimals, negatives red. */
export const STATEMENT_NUMBER_FORMAT: Record<FigureFormat, string> = {
  dollars: '#,##0;[Red]-#,##0',
  pct: '0.0%;[Red]-0.0%',
  ratio: '0.00;[Red]-0.00',
  exposure: '#,##0.0;[Red]-#,##0.0',
  rate: '0.000;[Red]-0.000',
};

/** The columns a statement row spans, A to I — I is All Years: the template's own. */
export const STATEMENT_COLUMNS = 9;
/** All Years' column (I), and the range its SUM covers: Prior (C) to the last year (H). */
export const ALL_YEARS_COLUMN = 9;
export const allYearsFormula = (r: number) => `SUM(C${r}:H${r})`;

/** A cell's border from its sides ('LRTB'), every line thin as the template's. */
function borderOf(sides: string): Partial<Borders> {
  const thin = { style: 'thin' as const };
  return {
    ...(sides.includes('L') ? { left: thin } : {}),
    ...(sides.includes('R') ? { right: thin } : {}),
    ...(sides.includes('T') ? { top: thin } : {}),
    ...(sides.includes('B') ? { bottom: thin } : {}),
  };
}

/** Fill one sheet with a statement, row for row as TEMPLATE_ROWS. */
function fillSheet(ws: Worksheet, ts: TemplateStatement): void {
  TEMPLATE_ROWS.forEach((row, i) => {
    const r = i + 1;
    // Every cell's border first, blank rows included — the template draws its
    // vertical lines down the blank rows and closes sections on them.
    for (let c = 1; c <= STATEMENT_COLUMNS; c++) { const sides = cellBorders(i, c); if (sides) ws.getCell(r, c).border = borderOf(sides); }
    if (row.kind === 'blank') return;
    if (row.label !== '') ws.getCell(r, 2).value = row.label;
    // The Reinsurance blocks' names — Gross, Ceded, Net — head their blocks in bold, in the label column.
    if (row.kind === 'header' && isBlockName(row.label)) ws.getCell(r, 2).font = { bold: true };
    if (row.kind === 'header') {
      // Prior only where the section shows it; the first three sections leave C blank.
      if (showsPrior(i)) ws.getCell(r, 3).value = 'Prior';
      ts.years.forEach((y, k) => {
        const cell = ws.getCell(r, 4 + k);
        // A real date: 12/31 of the year, as the template's mm-dd-yy cells.
        if (row.dates) { cell.value = dateSerial(y, 12, 31); cell.numFmt = 'mm-dd-yy'; } else cell.value = y;
      });
      if (row.allYears) ws.getCell(r, ALL_YEARS_COLUMN).value = ALL_YEARS_LABEL;
    }
    if (row.kind !== 'figure') return;
    const written: number[] = [];
    ts.figures[row.key].forEach((_, k) => {
      const x = shownFigure(row, i, k, ts);
      if (x === undefined) return; // blank: Prior in the first three sections, a first-year change
      const cell = ws.getCell(r, 3 + k);
      if (x === null) { cell.value = '—'; return; }
      // A dollar figure within half a cent of zero is zero: it is arithmetic's
      // residue (a balance less its own parts), and would show as a red "-0".
      const v = row.format === 'dollars' ? (Math.abs(x) < 0.005 ? 0 : x / DOLLARS_PER_UNIT) : x;
      cell.value = v;
      cell.numFmt = STATEMENT_NUMBER_FORMAT[row.format];
      written.push(v);
    });
    // ALL YEARS, as the template writes it: a SUM over the row's own cells, Prior
    // to the last year, its value cached so a reader that does not recalculate
    // sees the total. A ratio row leaves it blank; a row with no figure at all
    // shows "—", as on the screen, rather than a SUM of nothing.
    const total = allYearsCell(row, i, ts);
    if (total === undefined) return;
    const cell = ws.getCell(r, ALL_YEARS_COLUMN);
    if (total === null) { cell.value = '—'; return; }
    cell.value = { formula: allYearsFormula(r), result: written.reduce((t, x) => t + x, 0) };
    cell.numFmt = STATEMENT_NUMBER_FORMAT.dollars;
  });
  ws.columns = [{ width: 2 }, { width: 42 }, ...Array.from({ length: 2 + ts.years.length }, () => ({ width: 12 }))];
}

/** Excel's serial day number for a calendar date (the 1900 system, past its leap-year bug). */
function dateSerial(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

const SHEET_NAME = (ts: TemplateStatement) => (ts.scope === 'pool' ? 'Pool' : ts.scope);

/** exceljs, fetched on first use. The module is CommonJS in Node and a UMD bundle in the browser; either way the classes are on its default. */
async function loadExcelJS(): Promise<typeof import('exceljs')> {
  const mod = await import('exceljs') as unknown as { default?: typeof import('exceljs') } & typeof import('exceljs');
  return mod.default ?? mod;
}

/**
 * The .xlsx file for a view, as of a year (the latest by default): one sheet per
 * statement the view's download holds (statementsForView) — a line's alone on
 * its view; the pool's, then each line's, on the Pool view.
 */
export async function buildAnnualStatementXlsx(gs: GameState, asOfYear?: number, view: LineView = 'pool'): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  for (const ts of statementsForView(gs, view, asOfYear)) fillSheet(wb.addWorksheet(SHEET_NAME(ts)), ts);
  // Copied into its own buffer of exactly the file's length: in Node, writeBuffer
  // hands back a Buffer that may be a slice of a larger shared pool.
  return new Uint8Array(await wb.xlsx.writeBuffer()).buffer as ArrayBuffer;
}

