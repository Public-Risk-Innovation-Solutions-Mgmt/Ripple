// ============================================================================
// THE HOST'S GAME RULES — each line's adverse development level and the shock
// schedule. One component for the host's setup screen and for Test player
// (SetupPage), so Test player is the host's setup played solo, not a copy of it
// that drifts (wip/adverse-development).
// ============================================================================

import { useState } from 'react';
import { Shuffle, Trash2, Zap } from 'lucide-react';
import { DEVELOPMENT_LEVELS, type DevelopmentLevel } from '../data/pricingParameters';
import { drawShockSchedule, drawableShocks } from '../session/shockDraw';
import type { ScheduledShockSpec } from '../session/contract';
import type { CoverageLine } from '../types/simulation';

// ⚠ EVERY ONE OF THE R MODEL'S TWELVE EVENTS IS OFFERED, AND EVERY ONE RUNS —
// the same list Randomise draws from (session/shockDraw.ts).
const SCHEDULABLE = drawableShocks();

/** '#2 Winterstorm/Rainstorm' — an id that is not one of the twelve shows as itself. */
function shockLabel(id: string): string {
  const name = SCHEDULABLE.find(s => s.id === id)?.name;
  if (!name) return id;
  return id.startsWith('#') ? `${id} ${name}` : name;
}

/** A line's adverse development level: Low, Mid or High (ADVERSE_DEVELOPMENT_RANGE). */
export function DevelopmentLevelSelect({ line, value, onChange, disabled }: {
  line: CoverageLine; value: DevelopmentLevel; onChange: (v: DevelopmentLevel) => void; disabled?: boolean;
}) {
  return (
    <select
      disabled={disabled}
      data-testid={`dev-level-${line}`}
      aria-label={`Adverse development, ${line}`}
      className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
      value={value}
      onChange={e => onChange(e.target.value as DevelopmentLevel)}
    >
      {DEVELOPMENT_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
    </select>
  );
}

/**
 * THE SHOCK SCHEDULE: add events by year, or Randomise — drawn once, here, from
 * the seed, by the host's rule. `ensureSeed` returns the seed to draw from
 * (the host screen fills a blank one first).
 */
export function ShockScheduleFields({ seed, ensureSeed, yearCount, shocks, setShocks, note }: {
  seed: string;
  ensureSeed?: () => string;
  yearCount: number;
  shocks: ScheduledShockSpec[];
  setShocks: (f: (prev: ScheduledShockSpec[]) => ScheduledShockSpec[]) => void;
  note: string;
}) {
  const [shockId, setShockId] = useState(SCHEDULABLE[0]?.id ?? '');
  const [shockYear, setShockYear] = useState(2);
  // What the last Randomise drew FOR: the list is reproducible from the seed and
  // the year count only while both still match and nobody has edited it.
  const [drawnFor, setDrawnFor] = useState<{ seed: string; yearCount: number } | null>(null);
  const drawStale = drawnFor !== null && (drawnFor.seed !== seed.trim() || drawnFor.yearCount !== yearCount);
  function handleRandomise() {
    const s = ensureSeed ? ensureSeed() : seed;
    setShocks(() => drawShockSchedule(s, yearCount));
    setDrawnFor({ seed: s, yearCount });
  }
  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Shock schedule</span>
      <p className="mt-1 text-xs text-slate-600">{note}</p>
      <div className="mt-2 flex items-end gap-2">
        <label className="flex-1 block">
          <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Event</span>
          <select
            data-testid="shock-id"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={shockId}
            onChange={e => setShockId(e.target.value)}
          >
            {SCHEDULABLE.map(s => <option key={s.id} value={s.id}>{s.id} — {s.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Year of Event</span>
          <input
            data-testid="shock-year"
            type="number" min={1} max={yearCount}
            className="mt-1 w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={shockYear}
            onChange={e => setShockYear(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          data-testid="add-shock"
          onClick={() => { setShocks(prev => [...prev, { shockId, yearNumber: shockYear }]); setDrawnFor(null); }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600"
        >
          Add
        </button>
        <button
          type="button"
          data-testid="randomise-shocks"
          onClick={handleRandomise}
          disabled={yearCount < 1}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 disabled:text-slate-300"
          title="Replace the list with a draw from the catalog: about three events per ten years, never year 1"
        >
          <Shuffle size={13} />
          Randomise
        </button>
      </div>
      {drawnFor && !drawStale && (
        <p data-testid="shock-drawn-note" className="mt-1.5 text-xs text-slate-600">
          Drawn from seed <span className="font-mono">{drawnFor.seed}</span> over {drawnFor.yearCount} years.
        </p>
      )}
      {drawStale && (
        <p data-testid="shock-drawn-stale" className="mt-1.5 text-xs text-amber-700">
          The seed or year count changed after this was drawn. Randomise again to draw for the current settings.
        </p>
      )}
      {shocks.length > 0 && (
        <ul data-testid="shock-list" className="mt-2 space-y-1">
          {shocks.map((s, i) => (
            // The id and year stay in the DOM as attributes: drivers match these,
            // not the prose label.
            <li key={i} data-shock-id={s.shockId} data-shock-year={s.yearNumber} className="flex items-center gap-2 text-sm text-slate-600">
              <Zap size={13} className="text-amber-500" />
              <span>{shockLabel(s.shockId)} — Year {s.yearNumber}</span>
              <button
                type="button"
                onClick={() => { setShocks(prev => prev.filter((_, j) => j !== i)); setDrawnFor(null); }}
                className="text-slate-600 hover:text-red-600"
                aria-label={`Remove shock ${i + 1}`}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
