// THE ANNUAL STATEMENT — the players' results page, replacing Pool History.
// Every figure comes from buildAnnualStatement (utils/resultsStatement), which
// reads the engine and recomputes ratios from averaged parts; this file only
// lays the cells out. results-statement-check holds the figures together.
import { useMemo, useState } from 'react';
import type { GameState, LineView } from '../types/simulation';
import {
  buildAnnualStatement, cellText, statementYears, type Cell, type CellFormat, type StatementSection,
} from '../utils/resultsStatement';
import { lineDisplayName } from '../utils/lineDisplay';

interface Props {
  gameState: GameState;
  lineView: LineView;
}

// The text is the statement's own (cellText — a cell with no source is BLANK);
// only the colour is decided here.
function show(c: Cell, format: CellFormat): { text: string; className?: string } {
  const text = cellText(c, format);
  switch (c.kind) {
    case 'na': return { text };
    case 'none': return { text, className: 'text-gray-300' };
    case 'byLine': return { text, className: 'text-gray-400 italic text-xs' };
    case 'range': return { text, className: 'text-xs text-gray-500' };
    case 'value': return { text, className: c.v < 0 && format !== 'rate' ? 'text-red-600' : undefined };
  }
}

function SectionTable({ section }: { section: StatementSection }) {
  return (
    <div data-testid={`statement-${section.key}`} className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
      <div className="px-5 py-3 border-b border-gray-100 flex items-baseline gap-3">
        <h2 className="text-sm font-semibold text-gray-800">{section.title}</h2>
        <span className="text-xs text-gray-400">{section.basis}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide min-w-[240px]"></th>
            {section.columns.map(c => (
              <th key={c} className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.rows.map((r, i) => (
            <tr key={`${r.label}-${i}`} data-row-label={r.label} className={`border-b border-gray-50 ${r.emphasis ? 'bg-gray-50 font-medium' : ''}`}>
              <td className={`px-4 py-1.5 text-gray-700 ${r.indent ? 'pl-8' : ''}`}>{r.label}</td>
              {r.cells.map((c, j) => {
                const s = show(c, r.format);
                return <td key={j} className={`px-4 py-1.5 text-right font-mono whitespace-nowrap ${s.className ?? 'text-gray-800'}`}>{s.text}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const yearEnd = (calendarYear: number) => `12/31/${String(calendarYear % 100).padStart(2, '0')}`;

export default function ResultsStatementPage({ gameState, lineView }: Props) {
  // The year the statement stands at; null follows the latest year as the game moves on.
  const [chosen, setChosen] = useState<number | null>(null);
  const years = useMemo(() => statementYears(gameState), [gameState]);
  const latest = years.at(-1)?.yearNumber ?? 0;
  const asOf = chosen !== null && years.some(y => y.yearNumber === chosen) ? chosen : latest;
  const st = useMemo(() => buildAnnualStatement(gameState, lineView, asOf), [gameState, lineView, asOf]);
  const scope = lineView === 'pool' ? 'Pool' : lineDisplayName(lineView);
  // The same choices as the Financial Statements tab's selector, latest last.
  const options = years.map(y => ({
    value: y.yearNumber,
    label: y.yearNumber > 0 ? `Year ${y.yearNumber} — ${yearEnd(y.calendarYear)}`
      : y.yearNumber === 0 ? `Year 0 — ${yearEnd(y.calendarYear)} (Opening)`
      : `${yearEnd(y.calendarYear)} (History)`,
  }));
  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6" data-testid="annual-statement">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Annual Statement — {scope}</h1>
          <p className="text-xs text-gray-500 mt-1">Dollars in thousands. Exposure in $M; rates per $100 of exposure.</p>
        </div>
        <select
          data-testid="statement-year"
          value={String(asOf)}
          onChange={e => { const y = parseInt(e.target.value); setChosen(y === latest ? null : y); }}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {st.sections.map(s => <SectionTable key={s.key} section={s} />)}
      {/*
        ⚠ HIDDEN FROM PLAYERS — the explanatory notes and the "Not yet available"
        list that stood here. The text is kept in the statement (st.notes, and
        notYetAvailable(st) in utils/resultsStatement), so this block can be
        restored as it was, or shown in a testing view:

      <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 text-xs text-gray-600 space-y-1.5">
        {st.notes.map(n => <p key={n}>{n}</p>)}
        {missing.length > 0 && (
          <p data-testid="statement-not-available">
            <span className="font-medium">Not yet available:</span> {missing.join('; ')}.
          </p>
        )}
      </div>

        with `const missing = notYetAvailable(st);` above the return.
      */}
    </div>
  );
}
