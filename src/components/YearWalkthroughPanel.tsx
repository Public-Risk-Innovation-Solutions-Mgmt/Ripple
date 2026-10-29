// ============================================================================
// THE YEAR WALKTHROUGH — the whole of its tab, in every mode: one played year,
// every stage the engine goes through, each with how the player's decisions
// reach it, its working, its figures and a code to compare (utils/yearWalkthrough).
//
// ⚠ THE SEED IS THE CALLER'S TO SHOW (`showSeed`): Test player passes true;
// single player and a hosted team never do, and the page and its download then
// carry the version and the scenario alone.
// ============================================================================
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, ListOrdered } from 'lucide-react';
import type { GameState, LineView } from '../types/simulation';
import type { TeamMarketShareOfYear } from '../session/contract';
import {
  buildWalkthroughWorkbook, buildYearWalkthroughs, feedText, walkMark, walkthroughFilename, walkthroughHeader,
  walkthroughYears, type WalkRow, type WalkStage,
} from '../utils/yearWalkthrough';
import { formatCurrency, formatMillions, formatNumber, formatPct } from '../utils/formatters';
import { lineDisplayName } from '../utils/lineDisplay';

function shown(r: WalkRow): string {
  if (r.value === null) return '—';
  if (typeof r.value === 'string') return r.value;
  switch (r.kind) {
    case 'usd': return formatCurrency(r.value);
    case 'pct': return formatPct(r.value, 2);
    case 'pct1': return formatPct(r.value, 1);
    case 'factor': return formatNumber(r.value, 4);
    case 'per100': return `$${formatNumber(r.value, 4)}`;
    case 'exposure': return formatMillions(r.value, 2);
    case 'count': return formatNumber(r.value, 2);
    default: return String(r.value);
  }
}

function Stage({ st, n }: { st: WalkStage; n: number }) {
  return (
    <div data-testid="walk-block" data-block={st.id} data-stage={st.key} className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <span className="text-sm font-semibold text-gray-800">{n}. {st.title}</span>
        <span className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-xs ${st.info ? 'bg-gray-100 text-gray-500' : st.same ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'}`}>
            {walkMark(st.same, st.info)}
          </span>
          {!st.info && <span data-testid="walk-code" className="font-mono text-xs font-semibold text-gray-700">{st.code}</span>}
        </span>
      </div>
      <div data-testid="walk-feed" className="space-y-0.5 border-b border-gray-50 px-3 py-2 text-xs text-gray-600">
        {feedText(st).map((t, i) => <p key={i} className={i === 0 ? 'font-medium text-gray-700' : 'font-mono'}>{t}</p>)}
      </div>
      <table className="w-full text-sm">
        <tbody>
          {st.rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-50 last:border-0">
              <td className="px-3 py-1 text-gray-600">{r.label}</td>
              <td className="px-3 py-1 text-right font-mono text-gray-900">{shown(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {st.note && <p className="px-3 pb-2 pt-1 text-xs text-gray-400">{st.note}</p>}
    </div>
  );
}

export default function YearWalkthroughPanel({ gameState, lineView, showSeed, roomMarketShare }: {
  /** The whole game, not the known view: the worlds and the ledger are read off it. */
  gameState: GameState;
  lineView: LineView;
  showSeed: boolean;
  /** A hosted team's room share (CallerView.marketShare); absent in single player. */
  roomMarketShare?: TeamMarketShareOfYear | null;
}) {
  const header = walkthroughHeader(gameState.instance, showSeed);
  const years = walkthroughYears(gameState);
  const [picked, setPicked] = useState<number | null>(null);
  const year = picked !== null && years.includes(picked) ? picked : years[years.length - 1];
  const all = useMemo(
    () => (year === undefined ? [] : buildYearWalkthroughs(gameState, year, roomMarketShare)),
    [gameState, year, roomMarketShare],
  );
  const w = all.find(x => x.view === lineView) ?? all[0];

  function download() {
    XLSX.writeFile(buildWalkthroughWorkbook(gameState, header, roomMarketShare), walkthroughFilename(gameState));
  }

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6">
      <section data-testid="year-walkthrough" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListOrdered size={20} className="text-gray-500" />
            <h2 className="text-xl font-bold text-gray-900">
              Year Walkthrough{lineView === 'pool' ? '' : ` — ${lineDisplayName(lineView)}`}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {years.length > 0 && (
              <select
                data-testid="walk-year"
                value={year}
                onChange={e => setPicked(parseInt(e.target.value))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
              >
                {years.map(y => <option key={y} value={y}>{gameState.setup.startingYear + y - 1}</option>)}
              </select>
            )}
            <button
              type="button"
              data-testid="walk-download"
              disabled={years.length === 0}
              onClick={download}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            >
              <Download size={16} />
              Download Year Walkthrough (Excel)
            </button>
          </div>
        </div>

        <div data-testid="walk-header" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
          <span>Version <span data-testid="walk-version" className="font-mono text-gray-900">{header.version}</span></span>
          {header.scenario !== undefined && (
            <span>Scenario <span data-testid="walk-scenario" className="font-mono text-gray-900">{header.scenario}</span></span>
          )}
          {header.seed !== undefined && (
            <span>Seed <span data-testid="walk-seed" className="font-mono text-gray-900">{header.seed}</span></span>
          )}
        </div>

        {!w ? (
          <p className="py-16 text-center text-gray-500">Complete a year to walk through it.</p>
        ) : (
          <>
            <p className="text-xs text-gray-500">
              Every stage of the year in the order the model runs it. Dollar figures are averages across the game's {w.worlds} worlds.
              Compare codes from the top: the first that differs is where two games part.
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>Year code <span data-testid="walk-year-code" className="font-mono font-semibold">{w.yearCode}</span></span>
              <span>Decisions code <span data-testid="walk-decisions-code" className="font-mono font-semibold">{w.decisionsCode}</span></span>
              <span>Draws code <span data-testid="walk-draws-code" className="font-mono font-semibold">{w.drawsCode}</span></span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {w.stages.map((st, i) => <Stage key={st.id} st={st} n={i + 1} />)}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
