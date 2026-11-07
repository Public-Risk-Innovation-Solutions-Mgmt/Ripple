// ============================================================================
// "EDIT GAME" — the host's (and Test player's) mid-game edits: each line's
// adverse development level and the shock events, for the CURRENT year and
// every later year (wip/mid-game-edits). Played years are not listed: they
// cannot change. One component for the host's Game Setup tab and Test player,
// so Test player tests exactly what a room does.
//
// A development level changed in a year applies to that year AND EVERY LATER
// YEAR shown ("from a chosen year onward"); a later year can then be set on its
// own. Shocks are per year. Nothing is sent until Apply; the rules themselves
// are utils/gameEdits.ts's, which the transport applies.
//
// ⚠ TEAMS AREN'T TOLD. This panel exists on the host's screen and Test
// player's only; a development change shows up in a team's results, and a shock
// through the news banner in its year, as any shock does.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, History, Plus, X } from 'lucide-react';
import { DevelopmentLevelSelect } from './GameRulesFields';
import { drawableShocks } from '../utils/shockSchedule';
import { ADVERSE_DEVELOPMENT_DEFAULT_LEVEL, type DevelopmentSetting } from '../data/pricingParameters';
import { describeEdit, settingsForYear, type EditableSettings, type GameEdit, type YearSettings } from '../utils/gameEdits';
import type { CoverageLine } from '../types/simulation';

const SHOCKS = drawableShocks();
const shockName = (id: string) => {
  const s = SHOCKS.find(x => x.id === id);
  return s ? `${s.id} ${s.name}` : id;
};

export interface EditGamePanelProps {
  lines: CoverageLine[];
  yearCount: number;
  startingYear: number;
  /** The current year: the first that may be changed. */
  firstEditable: number;
  settings: EditableSettings;
  /** Teams that have already locked the current year — the host is warned. Empty for Test player. */
  lockedTeams: string[];
  history: GameEdit[];
  /** Send the wanted settings for the changed years; rejects with an Error to show. */
  onApply: (years: Record<string, YearSettings>) => Promise<void>;
}

export function EditGamePanel({ lines, yearCount, startingYear, firstEditable, settings, lockedTeams, history, onApply }: EditGamePanelProps) {
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = Math.max(1, firstEditable); y <= yearCount; y++) out.push(y);
    return out;
  }, [firstEditable, yearCount]);
  const calendar = (y: number) => startingYear + y - 1;
  const original = useMemo(() => Object.fromEntries(years.map(y => {
    const s = settingsForYear(settings, lines, y);
    // A line with no level reads the default — shown, so the select has a value.
    for (const l of lines) if (s.developmentLevels[l] === undefined) s.developmentLevels[l] = ADVERSE_DEVELOPMENT_DEFAULT_LEVEL;
    return [String(y), s];
  })) as Record<string, YearSettings>, [settings, lines, years]);
  const originalKey = JSON.stringify(original);

  const [draft, setDraft] = useState<Record<string, YearSettings>>(original);
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // A new year, an advance or another device's edit resets the draft to what the game now holds.
  useEffect(() => { setDraft(JSON.parse(originalKey)); setConfirming(false); }, [originalKey]);

  const changed = years.filter(y => JSON.stringify(draft[String(y)]) !== JSON.stringify(original[String(y)]));
  const currentChanged = changed.includes(firstEditable);

  const setLevel = (y: number, l: CoverageLine, v: DevelopmentSetting) => setDraft(prev => {
    const next = { ...prev };
    // From the chosen year onward: this year and every later one shown.
    for (const z of years) if (z >= y) next[String(z)] = { ...next[String(z)], developmentLevels: { ...next[String(z)].developmentLevels, [l]: v } };
    return next;
  });
  const addShock = (y: number) => {
    const id = adding[String(y)] ?? SHOCKS[0]?.id;
    if (!id) return;
    setDraft(prev => ({ ...prev, [String(y)]: { ...prev[String(y)], shocks: [...prev[String(y)].shocks, id] } }));
  };
  const removeShock = (y: number, i: number) => setDraft(prev => ({
    ...prev, [String(y)]: { ...prev[String(y)], shocks: prev[String(y)].shocks.filter((_, k) => k !== i) },
  }));

  async function apply() {
    setBusy(true); setError(null); setSaved(null);
    try {
      await onApply(Object.fromEntries(changed.map(y => [String(y), draft[String(y)]])));
      setSaved(`Applied ${changed.length === 1 ? `the change to ${calendar(changed[0])}` : `changes to ${changed.map(calendar).join(', ')}`}.`);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="edit-game" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-800">Edit game</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Change the shocks and each line&rsquo;s adverse development for {calendar(firstEditable)} and later years. Played
        years cannot change. A development level applies from the year you set it onward. Teams are not told.
      </p>

      {years.length === 0 ? (
        <p data-testid="edit-game-over" className="mt-3 text-sm text-black">The game is over: no year is left to change.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1 pr-3 font-medium">Year</th>
                {lines.map(l => <th key={l} className="py-1 pr-3 font-medium">{l} development</th>)}
                <th className="py-1 font-medium">Shocks</th>
              </tr>
            </thead>
            <tbody>
              {years.map(y => {
                const d = draft[String(y)];
                if (!d) return null;
                return (
                  <tr key={y} data-testid={`edit-year-${calendar(y)}`} className={`border-t border-slate-100 align-top ${changed.includes(y) ? 'bg-amber-50/60' : ''}`}>
                    <td className="py-2 pr-3 whitespace-nowrap text-slate-700">
                      {calendar(y)}{y === firstEditable && <span className="ml-1 text-xs text-slate-500">(current)</span>}
                    </td>
                    {lines.map(l => (
                      <td key={l} className="py-2 pr-3" data-testid={`edit-dev-${calendar(y)}-${l}`}>
                        <DevelopmentLevelSelect line={l} value={d.developmentLevels[l] ?? ADVERSE_DEVELOPMENT_DEFAULT_LEVEL}
                          onChange={v => setLevel(y, l, v)} />
                      </td>
                    ))}
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {d.shocks.length === 0 && <span className="text-xs text-slate-400">none</span>}
                        {d.shocks.map((id, i) => (
                          <span key={`${id}-${i}`} data-testid={`edit-shock-${calendar(y)}-${id}`}
                            className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-800 ring-1 ring-orange-200">
                            {shockName(id)}
                            <button type="button" aria-label={`Remove ${shockName(id)} from ${calendar(y)}`}
                              data-testid={`edit-remove-${calendar(y)}-${id}`} onClick={() => removeShock(y, i)}
                              className="text-orange-500 hover:text-orange-800"><X size={12} /></button>
                          </span>
                        ))}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <select data-testid={`edit-add-select-${calendar(y)}`} aria-label={`Shock to add in ${calendar(y)}`}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                          value={adding[String(y)] ?? SHOCKS[0]?.id}
                          onChange={e => setAdding(prev => ({ ...prev, [String(y)]: e.target.value }))}>
                          {SHOCKS.map(s => <option key={s.id} value={s.id}>{s.id} {s.name}</option>)}
                        </select>
                        <button type="button" data-testid={`edit-add-${calendar(y)}`} onClick={() => addShock(y)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                          <Plus size={12} /> Add
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirming && (
        <div data-testid="edit-locked-warning" role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="flex items-center gap-1.5 font-medium"><AlertTriangle size={14} /> Some teams have already locked {calendar(firstEditable)}</p>
          <p className="mt-1">
            <span data-testid="edit-locked-teams">{lockedTeams.join(', ')}</span> locked their decisions before this change.
            Their decisions stand, and their {calendar(firstEditable)} will be played on the new settings.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" data-testid="edit-apply-anyway" disabled={busy} onClick={() => { void apply(); }}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:bg-slate-300">
              {busy ? 'Applying…' : 'Apply anyway'}
            </button>
            <button type="button" data-testid="edit-cancel" onClick={() => setConfirming(false)}
              className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs text-amber-900">Cancel</button>
          </div>
        </div>
      )}

      {years.length > 0 && !confirming && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" data-testid="edit-apply" disabled={busy || changed.length === 0}
            onClick={() => { if (currentChanged && lockedTeams.length > 0) setConfirming(true); else void apply(); }}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300">
            {busy ? 'Applying…' : changed.length === 0 ? 'No changes' : `Apply ${changed.length === 1 ? 'change' : 'changes'}`}
          </button>
          {changed.length > 0 && (
            <button type="button" data-testid="edit-reset" onClick={() => setDraft(JSON.parse(originalKey))}
              className="text-xs text-slate-500 hover:text-slate-800">Discard</button>
          )}
          {saved && <span data-testid="edit-saved" className="text-xs text-emerald-700">{saved}</span>}
        </div>
      )}
      {error && <p data-testid="edit-error" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div data-testid="edit-history" className="mt-4 border-t border-slate-100 pt-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><History size={12} /> Change history</p>
        {history.length === 0 ? (
          <p data-testid="edit-history-empty" className="mt-1 text-xs text-slate-500">No changes yet.</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
            {[...history].reverse().map((e, i) => (
              <li key={i} data-testid="edit-history-row" className="flex gap-2">
                <span className="whitespace-nowrap text-slate-500">{new Date(e.at).toLocaleString()}</span>
                <span className="whitespace-nowrap font-medium">{e.by}</span>
                <span>{describeEdit(e, calendar, shockName)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
