// THE ANNUAL STATEMENT — the players' results page, replacing Pool History.
// Laid out as the template (docs/Annual Statement Example.xlsx) row for row:
// TEMPLATE_ROWS (utils/annualStatementTemplate) gives every title, label and
// blank row, buildTemplateStatement every figure — read from buildAnnualStatement
// (utils/resultsStatement), which reads the engine — and STATEMENT_BORDERS every
// cell's lines, generated from the template file. This file only lays the cells
// out, and the Excel download writes the same rows and lines (annualStatementExport).
import { useMemo, useState, type CSSProperties } from 'react';
import { Download } from 'lucide-react';
import type { GameState, LineView } from '../types/simulation';
import { statementYears } from '../utils/resultsStatement';
import {
  buildTemplateStatement, figureText, TEMPLATE_ROWS, type TemplateRow, type TemplateStatement,
} from '../utils/annualStatementTemplate';
import { STATEMENT_BORDERS } from '../utils/annualStatementBorders';
import { annualStatementFilename, buildAnnualStatementXlsx } from '../utils/annualStatementExport';
import { lineDisplayName } from '../utils/lineDisplay';

interface Props {
  gameState: GameState;
  lineView: LineView;
}

/** The test id of the table each title opens; the reinsurance blocks take their own by their header. */
const SECTION_ID: Record<string, string> = {
  'Net Income Statement': 'statement-operating',
  'Balance Sheet at Year-End': 'statement-balance',
  'Underwriting': 'statement-underwriting',
  'Contributions To The Current Calendar Year - Net': 'statement-contributions',
  'Program Year Totals - Net': 'statement-program',
  'Reinsurance Information - Policy Year Totals': 'statement-reinsurance',
};
const BLOCK_ID: Record<string, string> = { Gross: 'statement-gross', Ceded: 'statement-ceded', Net: 'statement-net' };

/** A template row and its index in TEMPLATE_ROWS — the index is its row in the file, and its borders. */
interface At { row: TemplateRow; i: number }

/** The template's rows, cut at each title: [title, rows under it]. Row 1, above the first title, carries no line. */
function sections(): { title: string; rows: At[] }[] {
  const out: { title: string; rows: At[] }[] = [];
  TEMPLATE_ROWS.forEach((row, i) => {
    if (row.kind === 'title') out.push({ title: row.label.trim(), rows: [] });
    else if (out.length > 0) out[out.length - 1].rows.push({ row, i });
  });
  return out;
}
const SECTIONS = sections();

const yearEnd = (calendarYear: number) => `12/31/${String(calendarYear % 100).padStart(2, '0')}`;
/** The template indents a sub-item by leading spaces; the screen indents it. */
const indented = (label: string) => /^\s/.test(label);

/**
 * A cell's lines, as the template draws them: column c (B = 1 … H = 7) of
 * template row i. The tables collapse their borders, so a line two neighbours
 * both carry is one line, as in Excel.
 */
const LINE = '1px solid #000';
function edges(i: number, c: number): CSSProperties {
  const s = STATEMENT_BORDERS[i][c];
  return {
    ...(s.includes('L') ? { borderLeft: LINE } : {}),
    ...(s.includes('R') ? { borderRight: LINE } : {}),
    ...(s.includes('T') ? { borderTop: LINE } : {}),
    ...(s.includes('B') ? { borderBottom: LINE } : {}),
  };
}

function Row({ at: { row, i }, ts }: { at: At; ts: TemplateStatement }) {
  // Every row has all seven cells, B to H, so the vertical lines run down blank rows and headings too.
  const cols = ts.columns.length;
  const data = { 'data-template-row': i + 1 };
  switch (row.kind) {
    case 'blank': case 'title':
      return (
        <tr data-row-kind="blank" aria-hidden="true" {...data}>
          {Array.from({ length: 1 + cols }, (_, c) => <td key={c} className="h-5" style={edges(i, c + 1)} />)}
        </tr>
      );
    case 'header':
      return (
        <tr data-row-kind="header" {...data}>
          <th className="px-3 py-1 text-right font-semibold text-black whitespace-pre" style={edges(i, 1)}>{row.label.trim()}</th>
          {ts.columns.map((c, k) => (
            <th key={c} className="px-3 py-1 text-center font-semibold text-black whitespace-nowrap" style={edges(i, k + 2)}>
              {k > 0 && row.dates ? yearEnd(ts.years[k - 1]) : c}
            </th>
          ))}
        </tr>
      );
    case 'heading':
      return (
        <tr data-row-kind="heading" {...data}>
          <td className="px-3 py-1 text-black whitespace-nowrap" style={edges(i, 1)}>{row.label.trim()}</td>
          {Array.from({ length: cols }, (_, k) => <td key={k} style={edges(i, k + 2)} />)}
        </tr>
      );
    case 'figure': {
      const right = row.label.trim() === '% of Premium';
      return (
        <tr data-row-label={row.label.trim()} data-row-key={row.key} {...data}>
          <td className={`px-3 py-1 text-black ${indented(row.label) ? 'pl-10' : ''} ${right ? 'text-right' : ''}`} style={edges(i, 1)}>{row.label.trim()}</td>
          {ts.figures[row.key].map((x, k) => {
            // Red by the figure AS SHOWN: a few cents below zero shows 0, in black.
            const text = figureText(x, row.format);
            return (
              <td key={k} className={`px-3 py-1 text-right tabular-nums whitespace-nowrap ${text.startsWith('−') ? 'text-red-600' : 'text-black'}`} style={edges(i, k + 2)}>
                {text}
              </td>
            );
          })}
        </tr>
      );
    }
  }
}

/** One section's rows; a header row opens a new body, so each reinsurance block is its own. */
function SectionTable({ title, rows, ts }: { title: string; rows: At[]; ts: TemplateStatement }) {
  const bodies: { header?: string; rows: At[] }[] = [{ rows: [] }];
  for (const at of rows) {
    const r = at.row;
    if (r.kind === 'header' && bodies[bodies.length - 1].rows.some(x => x.row.kind === 'header')) bodies.push({ header: r.label.trim(), rows: [] });
    else if (r.kind === 'header') bodies[bodies.length - 1].header = r.label.trim();
    bodies[bodies.length - 1].rows.push(at);
  }
  return (
    <section data-testid={SECTION_ID[title]} className="overflow-x-auto">
      <h2 className="px-3 text-base font-semibold text-black">{title}</h2>
      <table className="text-sm text-black border-collapse">
        <colgroup>
          <col className="w-[340px]" />
          {ts.columns.map(c => <col key={c} className="w-[110px]" />)}
        </colgroup>
        {bodies.map((b, k) => (
          <tbody key={k} data-testid={b.header ? BLOCK_ID[b.header] : undefined}>
            {b.rows.map(at => <Row key={at.i} at={at} ts={ts} />)}
          </tbody>
        ))}
      </table>
    </section>
  );
}

export default function ResultsStatementPage({ gameState, lineView }: Props) {
  // The year the statement stands at; null follows the latest year as the game moves on.
  const [chosen, setChosen] = useState<number | null>(null);
  const years = useMemo(() => statementYears(gameState), [gameState]);
  const latest = years.at(-1)?.yearNumber ?? 0;
  const asOf = chosen !== null && years.some(y => y.yearNumber === chosen) ? chosen : latest;
  const ts = useMemo(() => buildTemplateStatement(gameState, lineView, asOf), [gameState, lineView, asOf]);
  const scope = lineView === 'pool' ? 'Pool' : lineDisplayName(lineView);
  // The same choices as the Financial Statements tab's selector, latest last.
  const options = years.map(y => ({
    value: y.yearNumber,
    label: y.yearNumber > 0 ? `Year ${y.yearNumber} — ${yearEnd(y.calendarYear)}`
      : y.yearNumber === 0 ? `Year 0 — ${yearEnd(y.calendarYear)} (Opening)`
      : `${yearEnd(y.calendarYear)} (History)`,
  }));
  // The file is built on demand: its library (exceljs) is fetched on the first press, not with the page.
  const [building, setBuilding] = useState(false);
  const download = async () => {
    setBuilding(true);
    try {
      const bytes = await buildAnnualStatementXlsx(gameState, asOf);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = annualStatementFilename(gameState.setup.instanceId, ts.years.at(-1) ?? gameState.setup.startingYear);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } finally {
      setBuilding(false);
    }
  };
  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6" data-testid="annual-statement">
      <div className="bg-white text-black border border-gray-300 rounded-lg p-6 space-y-2">
        <div className="flex items-end justify-between flex-wrap gap-3 px-3">
          <div>
            <h1 className="text-lg font-semibold text-black">Annual Statement — {scope}</h1>
            <p className="text-xs text-black mt-1">Dollars in thousands. Exposure in $M; rates per $100 of exposure.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              data-testid="statement-year"
              value={String(asOf)}
              onChange={e => { const y = parseInt(e.target.value); setChosen(y === latest ? null : y); }}
              className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-black bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button
              type="button"
              data-testid="statement-download"
              onClick={() => { void download(); }}
              disabled={building}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Download size={16} />
              Download Annual Statement (Excel)
            </button>
          </div>
        </div>
        {SECTIONS.map(s => <SectionTable key={s.title} title={s.title} rows={s.rows} ts={ts} />)}
      </div>
    </div>
  );
}
