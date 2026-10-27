// THE ANNUAL STATEMENT — the players' results page, replacing Pool History.
// Laid out as the template (docs/Annual Statement Example.xlsx) row for row:
// TEMPLATE_ROWS (utils/annualStatementTemplate) gives every title, label and
// blank row, buildTemplateStatement every figure — read from buildAnnualStatement
// (utils/resultsStatement), which reads the engine. This file only lays the
// cells out, and the Excel download writes the same rows (annualStatementExport).
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import type { GameState, LineView } from '../types/simulation';
import { statementYears } from '../utils/resultsStatement';
import {
  buildTemplateStatement, figureText, TEMPLATE_ROWS, type TemplateRow, type TemplateStatement,
} from '../utils/annualStatementTemplate';
import { annualStatementFilename, buildAnnualStatementWorkbook } from '../utils/annualStatementExport';
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

/** The template's rows, cut at each title: [title, rows under it]. Row 1, above the first title, opens the page. */
function sections(): { title: string; rows: TemplateRow[] }[] {
  const out: { title: string; rows: TemplateRow[] }[] = [];
  for (const r of TEMPLATE_ROWS) {
    if (r.kind === 'title') out.push({ title: r.label.trim(), rows: [] });
    else if (out.length > 0) out[out.length - 1].rows.push(r);
  }
  return out;
}
const SECTIONS = sections();

const yearEnd = (calendarYear: number) => `12/31/${String(calendarYear % 100).padStart(2, '0')}`;
/** The template indents a sub-item by leading spaces; the screen indents it. */
const indented = (label: string) => /^\s/.test(label);

function Row({ row, ts }: { row: TemplateRow; ts: TemplateStatement }) {
  const width = 1 + ts.columns.length;
  switch (row.kind) {
    case 'blank': case 'title':
      return <tr data-row-kind="blank" aria-hidden="true"><td colSpan={width} className="h-5" /></tr>;
    case 'header':
      return (
        <tr data-row-kind="header">
          <th className="px-3 py-1 text-right font-semibold text-black whitespace-pre">{row.label.trim()}</th>
          {ts.columns.map((c, i) => (
            <th key={c} className="px-3 py-1 text-center font-semibold text-black whitespace-nowrap">
              {i > 0 && row.dates ? yearEnd(ts.years[i - 1]) : c}
            </th>
          ))}
        </tr>
      );
    case 'heading':
      return (
        <tr data-row-kind="heading">
          <td colSpan={width} className="px-3 py-1 text-black">{row.label.trim()}</td>
        </tr>
      );
    case 'figure': {
      const right = row.label.trim() === '% of Premium';
      return (
        <tr data-row-label={row.label.trim()} data-row-key={row.key}>
          <td className={`px-3 py-1 text-black ${indented(row.label) ? 'pl-10' : ''} ${right ? 'text-right' : ''}`}>{row.label.trim()}</td>
          {ts.figures[row.key].map((x, i) => {
            // Red by the figure AS SHOWN: a few cents below zero shows 0, in black.
            const text = figureText(x, row.format);
            return (
              <td key={i} className={`px-3 py-1 text-right tabular-nums whitespace-nowrap ${text.startsWith('−') ? 'text-red-600' : 'text-black'}`}>
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
function SectionTable({ title, rows, ts }: { title: string; rows: TemplateRow[]; ts: TemplateStatement }) {
  const bodies: { header?: string; rows: TemplateRow[] }[] = [{ rows: [] }];
  for (const r of rows) {
    if (r.kind === 'header' && bodies[bodies.length - 1].rows.some(x => x.kind === 'header')) bodies.push({ header: r.label.trim(), rows: [] });
    else if (r.kind === 'header') bodies[bodies.length - 1].header = r.label.trim();
    bodies[bodies.length - 1].rows.push(r);
  }
  return (
    <section data-testid={SECTION_ID[title]} className="overflow-x-auto">
      <h2 className="px-3 text-base font-semibold text-black">{title}</h2>
      <table className="text-sm text-black">
        <colgroup>
          <col className="w-[340px]" />
          {ts.columns.map(c => <col key={c} className="w-[110px]" />)}
        </colgroup>
        {bodies.map((b, i) => (
          <tbody key={i} data-testid={b.header ? BLOCK_ID[b.header] : undefined}>
            {b.rows.map((r, j) => <Row key={j} row={r} ts={ts} />)}
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
  const download = () => {
    const wb = buildAnnualStatementWorkbook(gameState, asOf);
    XLSX.writeFile(wb, annualStatementFilename(gameState.setup.instanceId, ts.years.at(-1) ?? gameState.setup.startingYear));
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
              onClick={download}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
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
