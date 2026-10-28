// ============================================================================
// THE YEAR WALKTHROUGH, ON THE CALCULATION AUDIT — one played year, draw by
// draw and step by step, each with a code to compare (utils/yearWalkthrough).
//
// The same panel in single player, Test player and a hosted team's game; in a
// hosted session it is the whole of the Calculation Audit tab. ⚠ THE SEED IS
// THE CALLER'S TO SHOW (`showSeed`): Test player passes true; single player and
// a team never do, and the panel then prints the version alone.
// ============================================================================
import { useMemo, useState } from 'react';
import { ListOrdered } from 'lucide-react';
import type { GameState, LineView } from '../types/simulation';
import {
  buildYearWalkthroughs, walkMark, walkthroughHeader, walkthroughYears, type WalkBlock, type WalkRow,
} from '../utils/yearWalkthrough';
import { formatCurrency, formatMillions, formatNumber, formatPct } from '../utils/formatters';
import { lineDisplayName } from '../utils/lineDisplay';

function shown(r: WalkRow): string {
  if (r.value === null) return '—';
  if (typeof r.value === 'string') return r.value;
  switch (r.kind) {
    case 'usd': return formatCurrency(r.value);
    case 'pct': return formatPct(r.value, 2);
    case 'factor': return formatNumber(r.value, 4);
    case 'per100': return `$${formatNumber(r.value, 4)}`;
    case 'exposure': return formatMillions(r.value, 2);
    case 'count': return formatNumber(r.value, 2);
    default: return String(r.value);
  }
}

function Block({ b }: { b: WalkBlock }) {
  return (
    <div data-testid="walk-block" data-block={b.id} className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <span className="text-sm font-semibold text-gray-800">{b.title}</span>
        <span className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs ${b.same ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'}`}>
            {walkMark(b.same)}
          </span>
          <span data-testid="walk-code" className="font-mono text-xs font-semibold text-gray-700">{b.code}</span>
        </span>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {b.rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-50 last:border-0">
              <td className="px-3 py-1 text-gray-600">{r.label}</td>
              <td className="px-3 py-1 text-right font-mono text-gray-900">{shown(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {b.note && <p className="px-3 pb-2 text-xs text-gray-400">{b.note}</p>}
    </div>
  );
}

export default function YearWalkthroughPanel({ gameState, lineView, showSeed }: {
  /** The whole game, not the known view: the worlds' rows are read off it. */
  gameState: GameState;
  lineView: LineView;
  showSeed: boolean;
}) {
  const header = walkthroughHeader(gameState.instance, showSeed);
  const years = walkthroughYears(gameState);
  const [picked, setPicked] = useState<number | null>(null);
  const year = picked !== null && years.includes(picked) ? picked : years[years.length - 1];
  const all = useMemo(() => (year === undefined ? [] : buildYearWalkthroughs(gameState, year)), [gameState, year]);
  const w = all.find(x => x.view === lineView) ?? all[0];

  return (
    <section data-testid="year-walkthrough" className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListOrdered size={18} className="text-gray-500" />
          <h3 className="text-base font-bold text-gray-900">
            Year Walkthrough{lineView === 'pool' ? '' : ` — ${lineDisplayName(lineView)}`}
          </h3>
        </div>
        {years.length > 0 && (
          <select
            data-testid="walk-year"
            value={year}
            onChange={e => setPicked(parseInt(e.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
          >
            {all.length > 0 && years.map(y => (
              <option key={y} value={y}>{gameState.setup.startingYear + y - 1}</option>
            ))}
          </select>
        )}
      </div>

      <div data-testid="walk-header" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
        <span>Version <span data-testid="walk-version" className="font-mono text-gray-900">{header.version}</span></span>
        {header.scenario !== undefined && <span>Scenario <span className="font-mono text-gray-900">{header.scenario}</span></span>}
        {header.seed !== undefined && (
          <span>Seed <span data-testid="walk-seed" className="font-mono text-gray-900">{header.seed}</span></span>
        )}
      </div>

      {!w ? (
        <p className="text-sm text-gray-500">Complete a year to walk through it.</p>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            Dollar figures are averages across the game's {w.worlds} worlds. Compare codes from the top: the first that
            differs is where two games part.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>Year code <span data-testid="walk-year-code" className="font-mono font-semibold">{w.yearCode}</span></span>
            <span>Decisions code <span data-testid="walk-decisions-code" className="font-mono font-semibold">{w.decisionsCode}</span></span>
            <span>Draws code <span data-testid="walk-draws-code" className="font-mono font-semibold">{w.drawsCode}</span></span>
          </div>
          <h4 className="pt-1 text-sm font-semibold text-gray-700">Draws</h4>
          <div className="grid gap-3 md:grid-cols-2">
            {w.draws.map(b => <Block key={b.id} b={b} />)}
          </div>
          <h4 className="pt-1 text-sm font-semibold text-gray-700">Steps</h4>
          <div className="grid gap-3 md:grid-cols-2">
            {w.steps.map(b => <Block key={b.id} b={b} />)}
          </div>
        </>
      )}
    </section>
  );
}
