import React, { useState, useCallback } from 'react';

import type { GameState, GameSetupSettings, DecisionSet, StartingFinancials, Member, CoverageLine, LineView } from './types/simulation';
import { openSoloInstance } from './utils/soloGame';
import type { ScheduledShock } from './types/shocks';
import { gameShocksOn } from './utils/shockLosses';
import { openWorlds, playWorldsYear, settleWorldsYear, commitSettledYear, type SettledYear, type WorldsYear } from './utils/worlds';
import { runPriorHistory } from './utils/priorHistoryEngine';
import { defaultDecisionSet } from './utils/decisionDefaults';
import { RETIRED_SAVE_KEYS, SAVE_KEY, unpackSave, writeSave, type SavedGame, type SaveEnvelope, type SaveOutcome } from './utils/gameSave';
import { restoreSavedGame } from './utils/saveRestore';
import { createSaveScheduler, type SaveScheduler } from './utils/saveScheduler';
import LoanPromptModal from './components/LoanPromptModal';
import type { TabId } from './components/TabNav';
import SetupPage from './pages/SetupPage';

// ⚠ THE TAB LIST, THE LINE-VIEW BAR, THE PAGE WIRING AND THE THIRTEEN
// DECISION-PAGE PROPS ALL MOVED TO src/game/. This file is now the SOLO CALLER
// of that shell: it owns the save, the setup screen, and an advance that
// processes the year immediately. The session player screen is the second
// caller and owns a different advance. Neither owns a copy of the game.
import GameShell from './game/GameShell';
import { openingRoster } from './game/openingRoster';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('setup');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [startingFinancials, setStartingFinancials] = useState<StartingFinancials | null>(null);
  const [initialMembers, setInitialMembers] = useState<Member[]>([]);
  const [currentDecisions, setCurrentDecisions] = useState<DecisionSet>(defaultDecisionSet(1));
  // A year that has been processed but is awaiting the player's loan decisions
  // before it can be committed (see handleAdvanceYear / handleResolveLoans).
  const [pendingYear, setPendingYear] = useState<WorldsYear | null>(null);
  // Stage 2.1 Pool/line view toggle. Display-only — not persisted to
  // localStorage, and not part of GameState/DecisionSet.
  const [lineViewRaw, setLineView] = useState<LineView>('pool');
  // The last failed save, or null. Rendered as a banner that does not dismiss —
  // see the note on persistState and gameSave.ts.
  const [saveFailure, setSaveFailure] = useState<Extract<SaveOutcome, { ok: false }> | null>(null);

  // A reload in progress: the year being replayed and the last one to replay.
  const [restoring, setRestoring] = useState<{ year: number; of: number } | null>(null);

  // Load persisted game from localStorage if available.
  //
  // ⚠ THE KEY IS `SAVE_KEY`, A CONSTANT IN gameSave.ts, not a literal kept in
  // step by hand across the load, its cleanup paths and the write.
  //
  // ⚠ A RELOAD IS A REPLAY (stable-scenarios commit 10). The save keeps the
  // averages only — the setup, the instance, every played year's decisions and
  // loan choices, the averaged rows and world 1's claim rows — and the game is
  // rebuilt from the opening, year by year (utils/saveRestore.ts), with the
  // page saying which year it is on. The pool state, the worlds and the
  // pre-game come back from the engine, so the old load-side backfills of
  // membership history, the loss record and WC rating groups went with them.
  React.useEffect(() => {
    let cancelled = false;
    try {
      // A save under a retired key is a schema this build cannot read
      // faithfully; it is cleared, and the player starts a new game.
      for (const key of RETIRED_SAVE_KEYS) localStorage.removeItem(key);
      const stored = localStorage.getItem(SAVE_KEY);
      if (stored) {
        // ⚠ unpackSave THROWS ON A SAVE IT DID NOT WRITE, and the catch below
        // clearing the key is the designed outcome — see gameSave.ts.
        const { gameState: saved, currentDecisions: cd } = unpackSave(stored) as { gameState: SavedGame; currentDecisions: DecisionSet | null };
        if (saved && saved.setup && saved.instance && Array.isArray(saved.playedYears) && Array.isArray(saved.lockedResults)) {
          setRestoring({ year: 0, of: saved.playedYears.length });
          void restoreSavedGame(saved, cd, (year, of) => { if (!cancelled) setRestoring({ year, of }); })
            .then(r => {
              if (cancelled) return;
              if (!r.matches) console.error('[save] the replayed game does not match the saved rows; showing the replay');
              setGameState(r.gameState);
              setStartingFinancials(r.startingFinancials);
              setInitialMembers(r.initialMembers);
              setCurrentDecisions(r.currentDecisions ?? defaultDecisionSet(r.gameState.currentYearNumber, gameShocksOn(r.gameState.setup, r.gameState.instance)));
              setActiveTab('dashboard');
              setRestoring(null);
            })
            .catch(() => {
              if (cancelled) return;
              localStorage.removeItem(SAVE_KEY);
              setRestoring(null);
            });
        } else {
          // Bad saved state - clear it
          localStorage.removeItem(SAVE_KEY);
        }
      }
    } catch {
      // ignore parse errors - clear corrupted data
      localStorage.removeItem(SAVE_KEY);
    }
    return () => { cancelled = true; };
  }, []);

  // ⚠ THE WRITE LIVES IN gameSave.ts NOW, AND THE FAILURE IS SURFACED.
  // This was a bare JSON.stringify in a bare catch {}, which meant the game
  // silently stopped saving at year 4 once the payload passed the ~5 MiB
  // localStorage quota. gameSave strips the per-claim flow that made up 65-70%
  // of it and reports what happened; this turns a failure into a banner the
  // player cannot miss. See gameSave.ts for the measurement and the budget.
  //
  // ⚠ AND *WHEN* IT IS WRITTEN LIVES IN saveScheduler.ts, FOR THE SAME REASON.
  // The decision path fires per slider STEP, not per interaction; the scheduler
  // coalesces a drag into one write and is a pure module so a gate can prove it
  // never drops a value. See its header.
  const scheduler = React.useRef<SaveScheduler<SaveEnvelope> | null>(null);
  if (scheduler.current === null) {
    scheduler.current = createSaveScheduler<SaveEnvelope>(
      // ⚠ THE WRITE IS OUTSIDE setSaveFailure, not inside an updater. A state
      // updater must be pure — React invokes it twice under StrictMode — and a
      // write in there would run twice per save in development.
      env => {
        const outcome = writeSave(env, window.localStorage);
        setSaveFailure(outcome.ok ? null : outcome);
      },
      { setTimer: (fn, ms) => window.setTimeout(fn, ms), clearTimer: id => window.clearTimeout(id) },
    );
  }

  // ⚠ THE LIFECYCLE FLUSH IS WHAT MAKES THE DEBOUNCE SAFE, not an extra. A
  // trailing debounce leaves the last value in memory for up to
  // SAVE_DEBOUNCE_MS; these two events are where a tab that is about to stop
  // existing says so. visibilitychange covers mobile backgrounding (where the
  // tab can be killed with no further event); pagehide covers navigation and
  // close. Neither alone is sufficient — see saveScheduler.ts. The unmount
  // cleanup flushes too, so no path out of this component leaves a write owed.
  React.useEffect(() => {
    const s = scheduler.current!;
    const onFlush = () => s.flush();
    const onVisibility = () => { if (document.visibilityState === 'hidden') s.flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onFlush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onFlush);
      s.flush();
    };
  }, []);

  /** Write now. For the once-a-turn events: starting a game, committing a year. */
  function persistState(gs: GameState, sf: StartingFinancials, im: Member[], cd: DecisionSet) {
    scheduler.current!.now(
      { gameState: gs, startingFinancials: sf, initialMembers: im, currentDecisions: cd },
    );
  }

  /**
   * Write once the player stops moving. For the per-step decision path ONLY.
   *
   * ⚠ THIS IS THE ONLY CALLER THAT MAY DEBOUNCE, and the reason is a frequency
   * measurement rather than a category: handleDecisionsChange is the only
   * persistState caller on a path that fires more than once per turn, because
   * SliderInput is the only continuous input in the decision tree and
   * DecisionsPage's onChange is its only sink. A second high-frequency caller
   * appearing later belongs here too; a once-a-turn one does not, because
   * delaying it buys nothing and widens the window above for no reason.
   */
  function persistStateSoon(gs: GameState, sf: StartingFinancials, im: Member[], cd: DecisionSet) {
    scheduler.current!.soon(
      { gameState: gs, startingFinancials: sf, initialMembers: im, currentDecisions: cd },
    );
  }

  const handleStartGame = useCallback((settings: GameSetupSettings, test?: { schedule: ScheduledShock[] }) => {
    // THE SHOCK SCHEDULE IS DRAWN HERE, ONCE, by the host's Randomise rule on the
    // solo stream (or, for Test player, is the one set on the host's screen), and
    // rides on the instance into the save and every world.
    const { setup, instance } = openSoloInstance(settings, test);
    // Stage 2.10: each active line simulates its own 3-year pre-game past
    // through the real engine; the ending state is the Year 1 opening position.
    const { poolState, startingFinancials: sf, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);

    // Every active line's roster, deduplicated — the same object the pool row's
    // memberList is, which is what replaces this at year 1. See openingRoster.
    const initMembers = openingRoster(poolState, settings.activeLines);

    const opened: GameState = {
      setup,
      instance,
      currentYearNumber: 1,
      isStarted: true,
      isComplete: false,
      poolState,
      lockedResults: [],
      currentDecisions: defaultDecisionSet(1, gameShocksOn(setup, instance)),
      priorHistory,
      earlyPreGameHistory,
    };
    // THE WORLDS (loss engine commit 4b): every world opens on this position.
    const gs = openWorlds(opened);

    // The default cover follows the game's shock switch: None while it is off.
    const cd = defaultDecisionSet(1, gameShocksOn(setup, instance));

    setGameState(gs);
    setStartingFinancials(sf);
    setInitialMembers(initMembers);
    setCurrentDecisions(cd);
    setLineView('pool');
    persistState(gs, sf, initMembers, cd);
    // ⚠ THIS USED TO BE 'history' AND THERE IS NO RECORDED REASON FOR IT. The line
    // is in the first upload (116b96d), which PREDATES the Introduction tab
    // (e4d060b) — so Pool History was the landing tab because it was the first
    // thing worth landing on, not because anything chose it over an Introduction
    // that did not yet exist. It is the last line of the start handler, after
    // gameState is set, so it is not a first-run state and not a setup hand-off;
    // IntroductionPage reads only gameState and priorHistory, both populated by
    // now. RESTORING A SAVE IS A DIFFERENT PATH and still lands on 'dashboard' —
    // see loadState below. Left alone deliberately: a player resuming has already
    // read the introduction.
    setActiveTab('introduction');
  }, []);

  // Commit a fully-resolved year (loan offers, if any, already handled) — the
  // average across the worlds, with the worlds themselves.
  const commitYear = useCallback((baseGs: GameState, settled: SettledYear) => {
    const result = settled.result;
    const nextYearNumber = baseGs.currentYearNumber + 1;
    const isComplete = nextYearNumber > baseGs.setup.gameLength;
    // ⚠ RISK-CONTROL PROGRAMS ARE OPT-OUT: a program that ran this year arrives
    // NEXT year already committed, and the player unticks it to stop. Every
    // other decision resets to its default, which is right for a yearly choice
    // and wrong for a multi-year commitment — nobody re-signs a safety
    // consultant each January, and a commitment a player can end by forgetting
    // is not a commitment.
    //
    // ⚠ CARRIED FROM `result.decisions`, THE ENGINE'S OWN ECHO OF WHAT WAS
    // PLAYED, not from `currentDecisions`. This function is handed the state it
    // committed; reading the live editing buffer instead would carry forward
    // whatever the player had half-typed when the year locked. The echo is what
    // the engine actually charged and benefited, so the carry-forward and the
    // derived tenure read the same source.
    //
    // ⚠ THIS IS THE ONLY PLACE THE OPT-OUT LIVES. The engine has no notion of
    // continuing — it reads the list it is given. That keeps the default a UI
    // policy rather than a rule buried in the loss draw, and it is why the
    // pre-game (which runs on defaultDecisionSet) commits nothing.
    const nextDecisions: DecisionSet = {
      ...defaultDecisionSet(nextYearNumber, gameShocksOn(baseGs.setup, baseGs.instance)),
      // Pool-wide, so it comes off the pool row's own `pool` field now rather
      // than off a line's echo of it. Same list, named where it belongs.
      riskControlProgramIds: [...(result.pool?.riskControlProgramIds ?? [])],
    };

    const newGs: GameState = {
      ...baseGs,
      ...commitSettledYear(baseGs, settled),
      currentYearNumber: nextYearNumber,
      isComplete,
      currentDecisions: nextDecisions,
    };

    setGameState(newGs);
    setCurrentDecisions(nextDecisions);
    persistState(newGs, startingFinancials!, initialMembers, nextDecisions);
    setActiveTab('results');
  }, [startingFinancials, initialMembers]);

  const handleAdvanceYear = useCallback(() => {
    if (!gameState || gameState.isComplete) return;

    const played = playWorldsYear(gameState, currentDecisions);

    // If any line ended negative without a loan IN ANY WORLD, pause to let the
    // player authorize/decline before committing the year. The choice is the
    // team's, so it applies in every world whose line needs the loan.
    if (played.loanOffers.length > 0) {
      setPendingYear(played);
      return;
    }

    commitYear(gameState, settleWorldsYear(gameState, played, []));
  }, [gameState, currentDecisions, commitYear]);

  const handleResolveLoans = useCallback((authorizedLines: string[]) => {
    if (!gameState || !pendingYear) return;
    const settled = settleWorldsYear(gameState, pendingYear, authorizedLines as CoverageLine[]);
    setPendingYear(null);
    commitYear(gameState, settled);
  }, [gameState, pendingYear, commitYear]);

  const handleNewGame = useCallback(() => {
    setGameState(null);
    setStartingFinancials(null);
    setInitialMembers([]);
    setCurrentDecisions(defaultDecisionSet(1));
    setLineView('pool');
    // ⚠ DISCARD BEFORE REMOVING, OR THE OLD GAME COMES BACK. A decision write
    // pending from the last few hundred milliseconds would fire after this
    // removeItem and write the abandoned game straight back into the key the
    // player just cleared. See SaveScheduler.discard.
    scheduler.current!.discard();
    localStorage.removeItem(SAVE_KEY);
    setActiveTab('setup');
  }, []);

  // ⚠ DEBOUNCED, AND THIS IS THE ONLY CALLER THAT IS. SliderInput's onChange is
  // a bare <input type="range">, which emits one event per STEP: the Dividend /
  // Assessment slider's 80 steps wrote the whole save 80 times for one drag.
  // See persistStateSoon and saveScheduler.ts.
  const handleDecisionsChange = useCallback((d: DecisionSet) => {
    setCurrentDecisions(d);
    if (gameState && startingFinancials) {
      persistStateSoon(gameState, startingFinancials, initialMembers, d);
    }
  }, [gameState, startingFinancials, initialMembers]);

  const isStarted = gameState?.isStarted ?? false;
  const activeLines = gameState?.setup.activeLines ?? [];

  // Guard against a stale selection (e.g. a loaded save with fewer active
  // lines than were selected before) by falling back to 'pool'.
  const lineView: LineView = lineViewRaw === 'pool' || activeLines.includes(lineViewRaw as CoverageLine)
    ? lineViewRaw
    : 'pool';

  // ⚠ A RELOAD SAYS WHERE IT IS: the replay rebuilds a year at a time.
  if (restoring) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center text-slate-500">
        <p data-testid="restoring" className="text-sm font-medium">
          {restoring.year > 0 ? `Restoring year ${restoring.year} of ${restoring.of}…` : 'Restoring your game…'}
        </p>
      </div>
    );
  }

  return (
    <GameShell
      gameState={gameState}
      startingFinancials={startingFinancials}
      initialMembers={initialMembers}
      currentDecisions={currentDecisions}
      onDecisionsChange={handleDecisionsChange}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      lineView={lineView}
      onSelectLineView={setLineView}
      onNewGame={handleNewGame}
      onAdvanceYear={handleAdvanceYear}
      canAdvance={isStarted && !gameState?.isComplete}
      setupPage={<SetupPage onStart={handleStartGame} />}
      loanPrompt={pendingYear
        ? <LoanPromptModal offers={pendingYear.loanOffers} onResolve={handleResolveLoans} />
        : undefined}
      banner={saveFailure ? (
        /*
          ⚠ THE SAVE-FAILURE BANNER, AND IT IS DELIBERATELY NOT DISMISSABLE.
          The defect this replaces was a swallowed QuotaExceededError: the game
          stopped being written at year 4 and said nothing, so the loss only
          surfaced on reload, by which time the session was over. This sits above
          the header, stays for the rest of the session, and names the remedy the
          player can actually act on — finish and export, rather than reload.
          A dismissable toast would be the same defect with a longer fuse.
        */
        <div role="alert" className="bg-red-700 text-white px-4 py-3 text-sm font-medium">
          <span className="font-bold">This game is no longer being saved.</span>{' '}
          {saveFailure.reason === 'quota'
            ? `The browser refused a ${saveFailure.chars.toLocaleString()}-character save (storage full).`
            : `The browser refused the save (${saveFailure.detail}).`}{' '}
          Keep playing — the session in this tab is intact — but do NOT reload or close
          this tab, and export your results before you finish.
        </div>
      ) : undefined}
    />
  );
}
