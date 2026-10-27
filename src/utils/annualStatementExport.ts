// ============================================================================
// THE ANNUAL STATEMENT AS AN EXCEL FILE — one sheet for the pool and one for
// each line the team writes, each laid out cell for cell as the template
// (docs/Annual Statement Example.xlsx, through TEMPLATE_ROWS): labels in column
// B, Prior in C, the five years in D to H, every blank row where it is.
//
// Every figure is a NUMBER, in the statement's units — dollars in thousands, a
// percentage as its fraction under a percent format — with negatives shown red
// by the number format. A row with no figure holds "—". The header rows hold the
// calendar years as numbers, and the balance sheet's its 12/31 year-ends as dates,
// as the template does.
//
// Tab names keep the short WC / GL / Property convention (lineDisplay.ts).
// annual-statement-template-check reads a workbook built here back against the
// template, and the export guard (solo-export-guard.ts) hashes it.
// ============================================================================
import * as XLSX from 'xlsx';
import {
  DOLLARS_PER_UNIT, TEMPLATE_ROWS, templateStatements, type FigureFormat, type TemplateStatement,
} from './annualStatementTemplate';
import type { GameState } from '../types/simulation';

/** The figures' Excel number formats: the screen's units and decimals, negatives red. */
export const STATEMENT_NUMBER_FORMAT: Record<FigureFormat, string> = {
  dollars: '#,##0;[Red]-#,##0',
  pct: '0.0%;[Red]-0.0%',
  ratio: '0.00;[Red]-0.00',
  exposure: '#,##0.0;[Red]-#,##0.0',
  rate: '0.000;[Red]-0.000',
};

/** The statement's sheet, row for row as TEMPLATE_ROWS. */
export function statementSheet(ts: TemplateStatement): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const put = (r: number, c: number, cell: XLSX.CellObject) => { ws[XLSX.utils.encode_cell({ r, c })] = cell; };
  TEMPLATE_ROWS.forEach((row, r) => {
    if (row.kind === 'blank') return;
    if (row.label !== '') put(r, 1, { t: 's', v: row.label });
    if (row.kind === 'header') {
      put(r, 2, { t: 's', v: 'Prior' });
      ts.years.forEach((y, i) => put(r, 3 + i, row.dates
        // A real date: 12/31 of the year, as the template's mm-dd-yy cells.
        ? { t: 'n', v: dateSerial(y, 12, 31), z: 'mm-dd-yy' }
        : { t: 'n', v: y }));
    }
    if (row.kind !== 'figure') return;
    ts.figures[row.key].forEach((x, i) => {
      if (x === null) { put(r, 2 + i, { t: 's', v: '—' }); return; }
      // A dollar figure within half a cent of zero is zero: it is arithmetic's
      // residue (a balance less its own parts), and would show as a red "-0".
      const v = row.format === 'dollars' ? (Math.abs(x) < 0.005 ? 0 : x / DOLLARS_PER_UNIT) : x;
      put(r, 2 + i, { t: 'n', v, z: STATEMENT_NUMBER_FORMAT[row.format] });
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: TEMPLATE_ROWS.length - 1, c: 2 + ts.years.length } });
  ws['!cols'] = [{ wch: 2 }, { wch: 42 }, ...Array.from({ length: 1 + ts.years.length }, () => ({ wch: 12 }))];
  return ws;
}

/** Excel's serial day number for a calendar date (the 1900 system, past its leap-year bug). */
function dateSerial(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

const SHEET_NAME = (ts: TemplateStatement) => (ts.scope === 'pool' ? 'Pool' : ts.scope);

/** The workbook: the pool's statement, then each line's, as of a year (the latest by default). */
export function buildAnnualStatementWorkbook(gs: GameState, asOfYear?: number): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const ts of templateStatements(gs, asOfYear)) XLSX.utils.book_append_sheet(wb, statementSheet(ts), SHEET_NAME(ts));
  return wb;
}

export function annualStatementFilename(instanceId: string, calendarYear: number): string {
  return `Annual_Statement_${instanceId}_${calendarYear}.xlsx`;
}
