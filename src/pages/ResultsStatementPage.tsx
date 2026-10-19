// THE ANNUAL STATEMENT — the players' results page, replacing Pool History.
// Every figure comes from buildAnnualStatement (utils/resultsStatement), which
// reads the engine and recomputes ratios from averaged parts; this file only
// lays the cells out. results-statement-check holds the figures together.
import { useMemo } from 'react';
import type { GameState, LineView } from '../types/simulation';
import { buildAnnualStatement, notYetAvailable, type Cell, type CellFormat, type StatementSection } from '../utils/resultsStatement';
import { lineDisplayName } from '../utils/lineDisplay';

interface Props {
  gameState: GameState;
  lineView: LineView;
}

const thousands = (x: number) => {
  const r = Math.round(x / 1000);
  return `${r < 0 ? '−' : ''}${Math.abs(r).toLocaleString('en-US')}`;
};

function show(c: Cell, format: CellFormat): { text: string; className?: string } {
  switch (c.kind) {
    case 'na': return { text: 'not yet available', className: 'text-gray-400 italic text-xs' };
    case 'none': return { text: '—', className: 'text-gray-300' };
    case 'byLine': return { text: 'by line', className: 'text-gray-400 italic text-xs' };
    case 'range': return { text: `${thousands(c.min)} · ${thousands(c.median)} · ${thousands(c.max)}`, className: 'text-xs text-gray-500' };
    case 'value': {
      const x = c.v;
      const text = format === 'dollars' ? thousands(x)
        : format === 'pct' ? `${(x * 100).toFixed(1)}%`.replace(/^-/, '−')
        : format === 'ratio' ? x.toFixed(2).replace(/^-/, '−')
        : format === 'exposure' ? `${Math.abs(x) < 0.05 ? '0.0' : x.toFixed(1)}`
        : x.toFixed(3);
      return { text, className: x < 0 && format !== 'rate' ? 'text-red-600' : undefined };
    }
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
            <tr key={`${r.label}-${i}`} className={`border-b border-gray-50 ${r.emphasis ? 'bg-gray-50 font-medium' : ''}`}>
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

export default function ResultsStatementPage({ gameState, lineView }: Props) {
  const st = useMemo(() => buildAnnualStatement(gameState, lineView), [gameState, lineView]);
  const missing = notYetAvailable(st);
  const scope = lineView === 'pool' ? 'Pool' : lineDisplayName(lineView);
  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6" data-testid="annual-statement">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Annual Statement — {scope}</h1>
        <p className="text-xs text-gray-500 mt-1">Dollars in thousands. Exposure in $M; rates per $100 of exposure.</p>
      </div>
      {st.sections.map(s => <SectionTable key={s.key} section={s} />)}
      <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 text-xs text-gray-600 space-y-1.5">
        {st.notes.map(n => <p key={n}>{n}</p>)}
        {missing.length > 0 && (
          <p data-testid="statement-not-available">
            <span className="font-medium">Not yet available:</span> {missing.join('; ')}.
          </p>
        )}
      </div>
    </div>
  );
}
