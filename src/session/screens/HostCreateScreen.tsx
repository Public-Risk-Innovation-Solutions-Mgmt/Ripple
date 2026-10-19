// ============================================================================
// THE GAME SETUP TAB — what the host sets, and only what the host sets.
//
// ⚠ WHAT THE HOST OWNS HAS NARROWED TO WHAT NOTHING ELSE CAN SET: the seed, the
// year count, the starting year and the shock schedule. Those are properties of
// the EVENT and every team must share them or the session is not one session.
//
// ⚠ COVERAGE LINES CAME OFF, AND THE MENU WENT WITH THEM. All three are
// available in every room; each team picks its own at join. The host constrained
// nothing with that control — a "menu" that always listed everything was a
// setting that could only be used to take something away, and nobody wanted to.
//
// ⚠ THE TEAM LIST IS A COUNT, NOT NAMES, AND NOT A NUMBERED PLACEHOLDER LIST.
// Players name their own teams, so host-typed names were dead. A numbered list
// ("Team 1", "Team 2") would have been the pre-registered roster wearing a
// different hat: it implies the host reserved a slot that a player then fills,
// and the table would inherit rows describing teams that do not exist. A plain
// count claims only what the host actually knows before the room opens — how
// many to expect — and it BINDS NOTHING (see the transport).
// ============================================================================

import { useRef, useState } from 'react';
import { newSessionToken } from '../contract';
import { Shuffle, Trash2, Zap } from 'lucide-react';
import { sessionTransport, isSessionError, type ScheduledShockSpec, type SessionError } from '../index';
import { DEFAULT_PRIOR_DEVELOPMENT, type PriorDevelopment } from '../contract';
import type { CoverageLine } from '../../types/simulation';
import { LINE_FULL_NAME } from '../../utils/lineDisplay';
import { rememberHostToken, saveActive } from '../client/identity';
import { drawShockSchedule, drawableShocks } from '../shockDraw';
import { navigate } from '../client/navigation';

// ⚠ EVERY ONE OF THE R MODEL'S TWELVE EVENTS IS OFFERED, AND EVERY ONE RUNS.
// Loss engine commit 3b retired the old catalogue, which only built six of
// them; the new engine runs all twelve. The list is the same one Randomise
// draws from (session/shockDraw.ts), so the two cannot offer different events.
const SCHEDULABLE = drawableShocks();

// ⚠ THE SEED IS A SHORT MENU NOW, AND IT IS STILL A STRING. The contract's
// `seed: string` is untouched — these are the strings '1' to '20' rather than an
// eight-character draw, so nothing about what a room stores changes shape.
const SEED_OPTIONS = Array.from({ length: 20 }, (_, i) => String(i + 1));

const LINE_ORDER: CoverageLine[] = ['WC', 'GL', 'Property'];

// ⚠ THE FACTOR IS SIGNED AND THE SCREEN IS NOT. Stored as a fraction where
// POSITIVE IS ADVERSE (see PriorDevelopment), but a host reads "3% adverse",
// never "0.03". These two convert between the two readings and nothing else
// does, so the sign convention lives in one place.
const pctOf = (v: number) => Math.round(Math.abs(v) * 1000) / 10;
const signedFrom = (pct: number, adverse: boolean) => (adverse ? 1 : -1) * (Math.abs(pct) / 100);

// ⚠ THE DEFAULT IS STILL RANDOM, DELIBERATELY. The free-text field it replaces
// defaulted to a fresh eight-character draw, so two hosts who changed nothing got
// different games. Defaulting the menu to '1' would quietly undo that and make
// every unconsidered room identical. A random option keeps the old behaviour
// inside the new, smaller set.
// ⚠ THE SCHEDULED LIST READS AS A SENTENCE, NOT AN ID: '#2 Winterstorm/Rainstorm'.
// An id that is not one of the twelve shows as itself.
function shockLabel(id: string): string {
  const name = SCHEDULABLE.find(s => s.id === id)?.name;
  if (!name) return id;
  return id.startsWith('#') ? `${id} ${name}` : name;
}

function randomSeed(): string {
  return SEED_OPTIONS[Math.floor(Math.random() * SEED_OPTIONS.length)];
}

export default function HostCreateScreen() {
  // ⚠ OPENS EMPTY, NOT 'Ripple Game'. The field is REQUIRED now and the lobby
  // lists it, so a default would be the name most events end up called — a
  // lobby of identical rows, each needing its code read to tell apart. An empty
  // required field asks the one question the lobby cannot answer for itself.
  const [eventName, setEventName] = useState('');
  const [seed, setSeed] = useState(() => randomSeed());
  const [yearCount, setYearCount] = useState(5);
  const [startingYear, setStartingYear] = useState(2026);
  const [expectedTeams, setExpectedTeams] = useState(3);
  // ⚠ ALL THREE LINES ON BY DEFAULT, which is what every room played when teams
  // chose for themselves — so a host who changes nothing gets the old game.
  const [lines, setLines] = useState<CoverageLine[]>([...LINE_ORDER]);
  // Kept for ALL THREE lines even while one is unticked, so toggling a line off
  // and back on does not silently reset a factor the host had edited. The
  // transport drops entries for lines the room does not play.
  const [priorDev, setPriorDev] = useState<PriorDevelopment>({ ...DEFAULT_PRIOR_DEVELOPMENT });
  const [shocks, setShocks] = useState<ScheduledShockSpec[]>([]);
  const [shockId, setShockId] = useState(SCHEDULABLE[0]?.id ?? '');
  const [shockYear, setShockYear] = useState(2);
  // What the last Randomise drew FOR. The draw is a pure function of the seed
  // and the year count, so the list is reproducible from the room record only
  // while both still match — and only if the host has not edited the list since.
  const [drawnFor, setDrawnFor] = useState<{ seed: string; yearCount: number } | null>(null);

  // ⚠ THE DRAW HAPPENS HERE, ONCE, ON THE HOST'S CLICK, AND NOWHERE ELSE. The
  // result is written into the room as concrete entries by handleCreate below,
  // and every team builds from those entries — see session/shockDraw.ts. The
  // host SEES what was drawn (ruled): it lands in the same list a hand-picked
  // shock does, and can be edited like one.
  function handleRandomise() {
    // A blank seed would be replaced at creation, and the schedule would then
    // have been drawn from a seed the room does not carry. So fill it first.
    const s = seed.trim() || randomSeed();
    if (s !== seed) setSeed(s);
    setShocks(drawShockSchedule(s, yearCount));
    setDrawnFor({ seed: s, yearCount });
  }
  const drawStale = drawnFor !== null && (drawnFor.seed !== seed.trim() || drawnFor.yearCount !== yearCount);

  const hostTokenRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SessionError | null>(null);

  // ⚠ THE EVENT NAME IS REQUIRED. It was optional and defaulted; the lobby
  // lists rooms by it, so a nameless event is a row nobody can choose.
  const canCreate = eventName.trim().length > 0
    && yearCount >= 1 && expectedTeams >= 1 && lines.length >= 1 && !busy;

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      // ⚠ MINTED HERE AND HELD ACROSS THE RETRY. The token is the idempotency
      // key, so it must be the SAME on a second attempt — generating it inside
      // the call would make every retry a new room. Kept in a ref so a user who
      // clicks Create again after a timeout reuses it.
      if (!hostTokenRef.current) hostTokenRef.current = newSessionToken();
      const res = await sessionTransport().createRoom({
        hostToken: hostTokenRef.current,
        seed: seed.trim() || randomSeed(),
        yearCount,
        startingYear,
        eventName: eventName.trim(),
        expectedTeams,
        lines,
        priorDevelopment: priorDev,
        shocks,
      });
      // ⚠ PERSIST THE HOST TOKEN BEFORE NAVIGATING. The room exists the moment
      // createRoom resolves; a navigation that happened first and then failed to
      // store would leave a live room nobody can drive.
      // res.hostToken is the token we sent, echoed back — see CreateRoomResponse.
      saveActive(res.code, { hostToken: res.hostToken });
      rememberHostToken(res.code, res.hostToken);
      navigate(`/host/${res.code}`);
    } catch (e) {
      setError(isSessionError(e) ? e : null);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="w-full">
        <p className="text-sm text-slate-500">
          Every team plays the same instance. Teams name themselves when they join; you choose the coverage lines below.
        </p>

        {error && (
          <div data-testid="create-error" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error.message}
          </div>
        )}

        <div className="mt-5 space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {/* ⚠ MOVED TO THE TOP AND MADE REQUIRED — THE SAME FIELD, NOT A NEW
              ONE. It sat in the two-column grid below sharing a row with the
              seed, optional, defaulting to 'Ripple Game'. The lobby lists
              events by this name, so it is now the first thing the host is
              asked and the room cannot be created without it. The mockup drew a
              SECOND field above the existing one; that was wrong, and there is
              one field here. */}
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Event name <span className="text-red-500">*</span>
            </span>
            <input
              data-testid="event-name"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={eventName}
              onChange={e => setEventName(e.target.value)}
              placeholder="e.g. PRISM Spring Workshop"
            />
            <span className="mt-1 block text-xs text-slate-400">
              Required. This is how the event appears in the lobby and on every player&rsquo;s screen.
            </span>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Seed</span>
              <select
                data-testid="seed"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                value={seed}
                onChange={e => setSeed(e.target.value)}
              >
                {SEED_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Years</span>
              <input
                data-testid="year-count"
                type="number" min={1} max={20}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={yearCount}
                onChange={e => setYearCount(Number(e.target.value))}
              />
              <span className="mt-1 block text-xs text-slate-400">How many rounds the game will run.</span>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Starting year</span>
              <input
                type="number" min={2000} max={2100}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={startingYear}
                onChange={e => setStartingYear(Number(e.target.value))}
              />
              <span className="mt-1 block text-xs text-slate-400">Year 0 of the game.</span>
            </label>
          </div>

          <div>
            <label className="block max-w-[220px]">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Number of Teams</span>
              <input
                data-testid="expected-teams"
                type="number" min={1} max={40}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={expectedTeams}
                onChange={e => setExpectedTeams(Number(e.target.value))}
              />
            </label>
            {/* ⚠ SAID ON SCREEN BECAUSE A NUMBER FIELD LOOKS LIKE A LIMIT. It is
                not one: the room does not turn anyone away, and the count exists
                so the host knows when everybody has arrived. */}
            <p className="mt-1.5 text-xs text-slate-400">
              How many to expect, so you know when everyone has arrived. It does not limit who can join, and
              teams name themselves at join and play the coverage lines you pick below.
            </p>
          </div>

          {/* ---- coverage lines, and their prior development ---- */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Coverage lines</span>
            {/* ⚠ THE HOST SETS THE GAME, NOT A MENU OF PERMISSIONS. This used to
                be each team's own choice at join, which made a session a table of
                different games; the lines are a property of the EVENT, like the
                seed and the year count. */}
            <p className="mt-1 text-xs text-slate-400">
              Every team plays these lines. At least one.
            </p>
            <div className="mt-2 space-y-2">
              {LINE_ORDER.map(l => {
                const on = lines.includes(l);
                const v = priorDev[l] ?? 0;
                const adverse = v >= 0;
                return (
                  <div key={l} className="flex items-center gap-3">
                    <label className="flex w-56 items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        data-testid={`line-${l}`}
                        checked={on}
                        onChange={e => setLines(prev => (
                          e.target.checked
                            ? LINE_ORDER.filter(x => x === l || prev.includes(x))
                            : prev.filter(x => x !== l)
                        ))}
                      />
                      {LINE_FULL_NAME[l]}
                    </label>
                    <div className={`flex items-center gap-1.5 ${on ? '' : 'opacity-40'}`}>
                      <input
                        type="number" min={0} max={100} step={1}
                        disabled={!on}
                        data-testid={`prior-dev-pct-${l}`}
                        className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        value={pctOf(v)}
                        onChange={e => setPriorDev(prev => ({
                          ...prev, [l]: signedFrom(Number(e.target.value), adverse),
                        }))}
                      />
                      <span className="text-sm text-slate-500">%</span>
                      <select
                        disabled={!on}
                        data-testid={`prior-dev-dir-${l}`}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                        value={adverse ? 'adverse' : 'favourable'}
                        onChange={e => setPriorDev(prev => ({
                          ...prev, [l]: signedFrom(pctOf(prev[l] ?? 0), e.target.value === 'adverse'),
                        }))}
                      >
                        <option value="adverse">adverse</option>
                        <option value="favourable">favourable</option>
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* ⚠ SAID PLAINLY, BECAUSE A NUMBER THAT DOES NOTHING IS WORSE THAN NO
                NUMBER. The engine does not read these yet; they are carried on the
                room so a later update can apply them without re-creating rooms. */}
            <p className="mt-2 text-xs text-slate-400">
              Prior development is <span className="font-medium">stored for a future update, not yet used</span> —
              it does not change the game today.
            </p>
            {lines.length === 0 && (
              <p data-testid="no-lines" className="mt-1.5 text-xs text-amber-700">
                Pick at least one coverage line.
              </p>
            )}
          </div>

          {/* ---- shocks ---- */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Shock schedule</span>
            <p className="mt-1 text-xs text-slate-400">
              The same schedule reaches every team. Randomise draws it once, here, from the seed.
            </p>
            <div className="mt-2 flex items-end gap-2">
              <label className="flex-1 block">
                <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Event</span>
              <select
                data-testid="shock-id"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={shockId}
                onChange={e => setShockId(e.target.value)}
              >
                {SCHEDULABLE.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.id} — {s.name}
                  </option>
                ))}
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
                title="Replace the list with a draw from the catalog: one event per three years, never year 1, milder events more likely"
              >
                <Shuffle size={13} />
                Randomise
              </button>
            </div>
            {drawnFor && !drawStale && (
              <p data-testid="shock-drawn-note" className="mt-1.5 text-xs text-slate-400">
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
                  // ⚠ THE ID AND YEAR STAY IN THE DOM AS ATTRIBUTES, not because the
                  // screen needs them but because the LABEL is now prose and the
                  // catalog is about to be renumbered 1-12. A driver matching the
                  // room record against rendered text would be re-broken by that
                  // rename; matching these is stable and reads the same fact.
                  <li
                    key={i}
                    data-shock-id={s.shockId}
                    data-shock-year={s.yearNumber}
                    className="flex items-center gap-2 text-sm text-slate-600"
                  >
                    <Zap size={13} className="text-amber-500" />
                    <span>{shockLabel(s.shockId)} — Year {s.yearNumber}</span>
                    <button
                      type="button"
                      onClick={() => { setShocks(prev => prev.filter((_, j) => j !== i)); setDrawnFor(null); }}
                      className="text-slate-400 hover:text-red-600"
                      aria-label={`Remove shock ${i + 1}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            data-testid="create-room"
            disabled={!canCreate}
            onClick={() => { void handleCreate(); }}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-300"
          >
            {busy ? 'Creating…' : 'Create room'}
          </button>
        </div>
      </div>
    </>
  );
}
