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

import { SCENARIO_OPTIONS, randomScenarioId } from '../../utils/scenarios';
import { useRef, useState } from 'react';
import { newSessionToken } from '../contract';
import { sessionTransport, isSessionError, type ScheduledShockSpec, type SessionError } from '../index';
import type { DevelopmentLevels } from '../contract';
import { DevelopmentLevelSelect, ShockScheduleFields } from '../../components/GameRulesFields';
import { ADVERSE_DEVELOPMENT_RANGE, ADVERSE_DEVELOPMENT_DEFAULT_LEVEL } from '../../data/pricingParameters';
import type { CoverageLine, GameSetupSettings } from '../../types/simulation';
import { GAME_LENGTH_YEARS } from '../../data/defaultAssumptions';
import { LINE_FULL_NAME } from '../../utils/lineDisplay';
import { rememberHostToken, saveActive } from '../client/identity';
import { navigate } from '../client/navigation';

// ⚠ THE SEED IS THE SCENARIO, 1 TO 20, AND IT IS STILL A STRING. The contract's
// `seed: string` is untouched — these are the strings '1' to '20', the same
// options solo setup offers (utils/scenarios.ts), and the handler refuses any
// other. Nothing about what a room stores changes shape.
const SEED_OPTIONS = SCENARIO_OPTIONS;

const LINE_ORDER: CoverageLine[] = ['WC', 'GL', 'Property'];

// ⚠ THE DEFAULT IS STILL RANDOM, DELIBERATELY. The free-text field it replaces
// defaulted to a fresh eight-character draw, so two hosts who changed nothing got
// different games. Defaulting the menu to '1' would quietly undo that and make
// every unconsidered room identical. A random option keeps the old behaviour
// inside the new, smaller set.
function randomSeed(): string {
  return randomScenarioId();
}

/**
 * TEST PLAYER (start screen): THIS SCREEN, played solo. Not a copy — the same
 * fields the host sets (seed, years, first program year, lines, each line's
 * prior development, the shock schedule, fixed or randomised), minus what only
 * a room has (event name, team count), and a start button in place of Create
 * room. Nothing is sent to a transport and no admin sign-in is asked for: the
 * game is the player's own, built by utils/soloGame on exactly these settings.
 */
export interface SoloTestMode {
  /** The start screen's values, so the player does not set them twice. */
  initial: Pick<GameSetupSettings, 'poolName' | 'gameLength' | 'startingYear' | 'instanceId' | 'activeLines'>;
  onStart: (settings: GameSetupSettings, schedule: ScheduledShockSpec[]) => void;
  onBack: () => void;
}

export default function HostCreateScreen({ soloTest }: { soloTest?: SoloTestMode } = {}) {
  // ⚠ OPENS EMPTY, NOT 'Ripple Game'. The field is REQUIRED now and the lobby
  // lists it, so a default would be the name most events end up called — a
  // lobby of identical rows, each needing its code read to tell apart. An empty
  // required field asks the one question the lobby cannot answer for itself.
  const [eventName, setEventName] = useState('');
  const [poolName, setPoolName] = useState(soloTest?.initial.poolName ?? '');
  const [seed, setSeed] = useState(() => soloTest?.initial.instanceId ?? randomSeed());
  const [yearCount, setYearCount] = useState(soloTest?.initial.gameLength ?? 5);
  const [startingYear, setStartingYear] = useState(soloTest?.initial.startingYear ?? 2027);
  const [expectedTeams, setExpectedTeams] = useState(3);
  // ⚠ ALL THREE LINES ON BY DEFAULT, which is what every room played when teams
  // chose for themselves — so a host who changes nothing gets the old game.
  const [lines, setLines] = useState<CoverageLine[]>(() => soloTest ? [...soloTest.initial.activeLines] : [...LINE_ORDER]);
  // Kept for ALL THREE lines even while one is unticked, so toggling a line off
  // and back on does not silently reset a factor the host had edited. The
  // transport drops entries for lines the room does not play.
  // ADVERSE DEVELOPMENT'S LEVEL PER LINE (wip/adverse-development), replacing
  // the prior-development percentages.
  const [devLevels, setDevLevels] = useState<Required<DevelopmentLevels>>({
    WC: ADVERSE_DEVELOPMENT_DEFAULT_LEVEL, GL: ADVERSE_DEVELOPMENT_DEFAULT_LEVEL, Property: ADVERSE_DEVELOPMENT_DEFAULT_LEVEL,
  });
  const [shocks, setShocks] = useState<ScheduledShockSpec[]>([]);
  // A blank seed would be replaced at creation, and a schedule drawn from it
  // would not be the room's — so Randomise fills it first.
  function ensureSeed() {
    const s = seed.trim() || randomSeed();
    if (s !== seed) setSeed(s);
    return s;
  }

  const hostTokenRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SessionError | null>(null);

  // ⚠ THE EVENT NAME IS REQUIRED. It was optional and defaulted; the lobby
  // lists rooms by it, so a nameless event is a row nobody can choose.
  const canCreate = eventName.trim().length > 0
    && yearCount >= 1 && expectedTeams >= 1 && lines.length >= 1 && !busy;
  // Test player: a solo game's length is the start screen's range, and its pool
  // name is required there too.
  const soloYearsOk = yearCount >= GAME_LENGTH_YEARS.min && yearCount <= GAME_LENGTH_YEARS.max;
  const canStartSolo = poolName.trim().length > 0 && soloYearsOk && lines.length >= 1;

  function handleStartSolo() {
    if (!soloTest || !canStartSolo) return;
    // Only the lines played, as the transport keeps them for a room. The levels
    // ride on the setup (setup.developmentLevels), as Single player's draw does.
    const developmentLevels: DevelopmentLevels = {};
    for (const l of lines) developmentLevels[l] = devLevels[l];
    soloTest.onStart(
      { poolName: poolName.trim(), gameLength: yearCount, startingYear, instanceId: seed, activeLines: [...lines], developmentLevels },
      shocks.filter(s => s.yearNumber >= 1 && s.yearNumber <= yearCount).map(s => ({ shockId: s.shockId, yearNumber: s.yearNumber })),
    );
  }

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
        // Blank: the room names its pool after the event (RoomView.poolName).
        ...(poolName.trim() ? { poolName: poolName.trim() } : {}),
        expectedTeams,
        lines,
        developmentLevels: devLevels,
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
        {soloTest ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              The host&rsquo;s game setup, played solo: set each line&rsquo;s prior development and the shock schedule, then start.
            </p>
            <button type="button" data-testid="test-player-back" onClick={soloTest.onBack}
              className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              Back
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Every team plays the same instance. Teams name themselves when they join; you choose the coverage lines below.
          </p>
        )}

        {error && (
          <div data-testid="create-error" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error.message}
          </div>
        )}

        <div data-testid={soloTest ? 'test-player-setup' : undefined} className="mt-5 space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {/* ⚠ MOVED TO THE TOP AND MADE REQUIRED — THE SAME FIELD, NOT A NEW
              ONE. It sat in the two-column grid below sharing a row with the
              seed, optional, defaulting to 'Ripple Game'. The lobby lists
              events by this name, so it is now the first thing the host is
              asked and the room cannot be created without it. The mockup drew a
              SECOND field above the existing one; that was wrong, and there is
              one field here. */}
          {!soloTest && <label className="block">
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
          </label>}

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Pool name</span>
            <input
              data-testid="pool-name"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={poolName}
              onChange={e => setPoolName(e.target.value)}
              placeholder="e.g. Harbour Public Entity Risk Pool"
            />
            <span className="mt-1 block text-xs text-slate-400">
              {soloTest
                ? 'Required. The pool you run, as the welcome memo and your screens name it.'
                : <>The pool every team runs, as the welcome memo and each team&rsquo;s screens name it. Left blank, the event name is used.</>}
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
                type="number" min={soloTest ? GAME_LENGTH_YEARS.min : 1} max={soloTest ? GAME_LENGTH_YEARS.max : 20}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={yearCount}
                onChange={e => setYearCount(Number(e.target.value))}
              />
              <span className={`mt-1 block text-xs ${soloTest && !soloYearsOk ? 'text-amber-700' : 'text-slate-400'}`}>
                {soloTest ? `How many rounds the game will run: ${GAME_LENGTH_YEARS.min} to ${GAME_LENGTH_YEARS.max}.` : 'How many rounds the game will run.'}
              </span>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">First program year</span>
              <input
                type="number" min={2000} max={2100}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={startingYear}
                onChange={e => setStartingYear(Number(e.target.value))}
              />
              <span className="mt-1 block text-xs text-slate-400">The year the teams price first; the game opens in the year before it.</span>
            </label>
          </div>

          {!soloTest && <div>
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
          </div>}

          {/* ---- coverage lines, and their prior development ---- */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Coverage lines</span>
            {/* ⚠ THE HOST SETS THE GAME, NOT A MENU OF PERMISSIONS. This used to
                be each team's own choice at join, which made a session a table of
                different games; the lines are a property of the EVENT, like the
                seed and the year count. */}
            <p className="mt-1 text-xs text-slate-400">
              {soloTest ? 'The lines you play. At least one.' : 'Every team plays these lines. At least one.'}
            </p>
            <div className="mt-2 space-y-2">
              {LINE_ORDER.map(l => {
                const on = lines.includes(l);
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
                      <span className="text-sm text-slate-500">Adverse development</span>
                      <DevelopmentLevelSelect line={l} value={devLevels[l]} disabled={!on}
                        onChange={v => setDevLevels(prev => ({ ...prev, [l]: v }))} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p data-testid="dev-level-note" className="mt-2 text-xs text-slate-400">
              Each played year every open prior year's reserve grows by a rate drawn in its line's range —
              None 0%,
              Low {Math.round(ADVERSE_DEVELOPMENT_RANGE.Low[0] * 100)}–{Math.round(ADVERSE_DEVELOPMENT_RANGE.Low[1] * 100)}%,
              Mid {Math.round(ADVERSE_DEVELOPMENT_RANGE.Mid[0] * 100)}–{Math.round(ADVERSE_DEVELOPMENT_RANGE.Mid[1] * 100)}%,
              High {Math.round(ADVERSE_DEVELOPMENT_RANGE.High[0] * 100)}–{Math.round(ADVERSE_DEVELOPMENT_RANGE.High[1] * 100)}%.
            </p>
            {lines.length === 0 && (
              <p data-testid="no-lines" className="mt-1.5 text-xs text-amber-700">
                Pick at least one coverage line.
              </p>
            )}
          </div>

          {/* ---- shocks ---- */}
          <ShockScheduleFields
            seed={seed} ensureSeed={ensureSeed} yearCount={yearCount} shocks={shocks} setShocks={setShocks}
            note={soloTest
              ? 'Your game fires exactly this schedule. Randomise draws it once, here, from the seed.'
              : 'The same schedule reaches every team. Randomise draws it once, here, from the seed.'}
          />

          {soloTest ? (
            <button
              type="button"
              data-testid="start-test-player"
              disabled={!canStartSolo}
              onClick={handleStartSolo}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-300"
            >
              Start test game
            </button>
          ) : <button
            type="button"
            data-testid="create-room"
            disabled={!canCreate}
            onClick={() => { void handleCreate(); }}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-300"
          >
            {busy ? 'Creating…' : 'Create room'}
          </button>}
        </div>
      </div>
    </>
  );
}
