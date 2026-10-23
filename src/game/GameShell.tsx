// ============================================================================
// THE GAME, AS A PLAYER SEES IT — every tab, every page, both callers.
//
// ⚠ THIS IS App.tsx's RENDER BLOCK, MOVED. The tab list, the line-view bar, the
// page wiring and the loan modal slot are the ones that stood in App.tsx, with
// the same props and the same conditions. App.tsx is now the solo caller of it
// and the session player screen is the second; neither owns a copy.
//
// ⚠ EXTRACTING THE DERIVATION WITHOUT EXTRACTING THIS WOULD HAVE MISSED THE
// POINT. A session screen that called useGameDerivations and then wrote its own
// JSX would have a second copy of the page wiring instead of a second copy of
// the arithmetic — the same hazard one level up, and the harder one to spot,
// because it fails as a missing tab rather than a wrong number.
//
// WHAT THE TWO CALLERS DIFFER ON, AND ALL OF IT IS A PROP:
//
//   setupPage       solo passes SetupPage and gets the Game Setup tab; a
//                   session player has no setup because the ROOM owns the seed,
//                   the year count, the lines and the shock schedule. A player
//                   choosing any of them would fork their instance away from
//                   everyone else's.
//   onNewGame       absent in a session. The host owns the lifecycle.
//   onAdvanceYear   solo processes the year immediately; a session locks and
//                   waits for the host. Same button, same words, different verb
//                   underneath — which is the whole of the difference the
//                   session layer exists to make.
//   loanPrompt      solo blocks on the modal; a session cannot (see JoinScreen).
//   banner          the save-failure banner, which is solo-only because a
//                   session player does not write the save at all.
// ============================================================================

import React from 'react';
import { Layers, HardHat, Scale, Building2 } from 'lucide-react';

import type {
  CoverageLine, DecisionSet, GameState, LineView, Member, StartingFinancials,
} from '../types/simulation';
import { endingPosition } from '../utils/endingPosition';
import { LINE_FULL_NAME } from '../utils/lineDisplay';
import { useGameDerivations } from './derivations';
import { openingRosterForLine } from './openingRoster';

import Header from '../components/Header';
import TabNav, { type TabId } from '../components/TabNav';
import DashboardPage from '../pages/DashboardPage';
import { gameShocksOn } from '../utils/shockLosses';
import DecisionsPage from '../pages/DecisionsPage';
import DecisionHistoryPage from '../pages/DecisionHistoryPage';
import FinancialsPage from '../pages/FinancialsPage';
import ResultsPage from '../pages/ResultsPage';
import MembershipPage from '../pages/MembershipPage';
import CalculationAuditPage from '../pages/CalculationAuditPage';
import ResultSpreadsheetPage from '../pages/ResultSpreadsheetPage';
import ResultsStatementPage from '../pages/ResultsStatementPage';
import IntroductionPage from '../pages/IntroductionPage';
import DepartmentsPage from '../pages/DepartmentsPage';
import InvestmentsPage from '../pages/InvestmentsPage';
import RateIndicationPage from '../pages/RateIndicationPage';
import ModelPage from '../pages/ModelPage';
import { isHiddenTab, topBarTabs } from './tabs';
import { shockTimingOf } from '../utils/shockLosses';

const AUDIT_TAB: TabId = 'audit';
const SPREADSHEET_TAB: TabId = 'spreadsheet';

// ⚠ THE TOP BAR'S ORDER AND ITS HIDDEN TABS LIVE IN ./tabs.tsx — one list each,
// solo and multiplayer. A hidden tab is neither listed nor rendered.

// Pages that support the Pool / per-line view toggle (Stage 2.1; 'history'
// added in Stage 2.10 — each line now has its own real pre-game history —
// and 'statement', the Annual Statement, in its place since it replaced it).
// ⚠ 'membership' JOINED THIS LIST, AND IT IS THE REASON THE PAGE CAN BE HONEST.
// Its per-member experience columns are PER LINE — a member has one loss ratio
// on WC and another on GL, not one ratio — and until the bar existed the page
// read WC unconditionally whatever the pool wrote. The selector is what lets the
// three per-line columns name their line instead of assuming one.
const LINE_VIEW_PAGES: TabId[] = ['statement', 'dashboard', 'decisions', 'decisionHistory', 'financials', 'results', 'audit', 'membership'];

const LINE_VIEW_ICONS: Record<LineView, React.ReactNode> = {
  pool: <Layers size={14} />,
  WC: <HardHat size={14} />,
  GL: <Scale size={14} />,
  Property: <Building2 size={14} />,
};

export interface GameShellProps {
  gameState: GameState | null;
  startingFinancials: StartingFinancials | null;
  initialMembers: Member[];
  currentDecisions: DecisionSet;
  onDecisionsChange: (d: DecisionSet) => void;

  activeTab: TabId;
  onSelectTab: (t: TabId) => void;
  lineView: LineView;
  onSelectLineView: (v: LineView) => void;

  /** Omitted by a viewer — see Header. */
  onAdvanceYear?: () => void;
  canAdvance?: boolean;
  advanceLabel?: string;
  onNewGame?: () => void;

  /** The Game Setup page (solo): where a game starts. Off the top bar — see tabs.tsx. */
  setupPage?: React.ReactNode;
  /** Solo's loan modal. A session declines automatically and passes nothing. */
  loanPrompt?: React.ReactNode;
  /** Solo's save-failure banner, above the header. */
  banner?: React.ReactNode;
  /**
   * An extra reason the decisions page is read-only, on top of the game being
   * complete. A session player is locked out once they have submitted the
   * current year — that is what lock-and-wait means on this screen.
   */
  decisionsDisabled?: boolean;
  /** Rendered under the tab bar. The session's lock/waiting strip lives here. */
  statusStrip?: React.ReactNode;
  /** A hosted session's screen — players and viewers. Hides tabs.tsx's MULTIPLAYER_HIDDEN_TABS too. */
  multiplayer?: boolean;
}

export default function GameShell({
  gameState, startingFinancials, initialMembers, currentDecisions, onDecisionsChange,
  activeTab, onSelectTab, lineView, onSelectLineView,
  onAdvanceYear, canAdvance, advanceLabel, onNewGame,
  setupPage, loanPrompt, banner, decisionsDisabled, statusStrip, multiplayer,
}: GameShellProps) {
  const isStarted = gameState?.isStarted ?? false;
  const activeLines = gameState?.setup.activeLines ?? [];

  const d = useGameDerivations(gameState, lineView, currentDecisions);

  // A hidden tab is neither listed nor rendered (tabs.tsx).
  const hidden = (t: TabId) => isHiddenTab(t, !!multiplayer);
  const tabs = React.useMemo(
    () => topBarTabs({ multiplayer: !!multiplayer, hasSetup: setupPage !== undefined })
      .map(t => ({ ...t, disabled: !isStarted && t.id !== 'setup' })),
    [isStarted, setupPage, multiplayer],
  );
  // ⚠ A HIDDEN TAB ASKED FOR SHOWS THE FIRST LISTED ONE. Callers still name
  // tabs that may be hidden (a restored save lands on Dashboard); the setup
  // page is the exception — it is where a solo game starts, off the bar.
  const shownTab: TabId = activeTab === 'setup' || !hidden(activeTab) ? activeTab : (tabs[0]?.id ?? activeTab);

  return (
    <div className="min-h-screen bg-gray-50">
      {banner}
      <Header
        gameState={gameState}
        onNewGame={onNewGame}
        onAdvanceYear={onAdvanceYear}
        canAdvance={canAdvance}
        advanceLabel={advanceLabel}
        lineView={lineView}
      />

      {isStarted && (
        <TabNav
          tabs={tabs}
          activeTab={shownTab}
          onSelect={onSelectTab}
        />
      )}

      {isStarted && LINE_VIEW_PAGES.includes(shownTab) && (
        <TabNav<LineView>
          tabs={[
            { id: 'pool' as LineView, label: 'Pool', icon: LINE_VIEW_ICONS.pool },
            ...activeLines.map(line => ({ id: line as LineView, label: LINE_FULL_NAME[line], icon: LINE_VIEW_ICONS[line] })),
          ]}
          activeTab={lineView}
          onSelect={onSelectLineView}
          stickyTop={108}
          zIndex={20}
        />
      )}

      {statusStrip}

      <main>
        {shownTab === 'setup' && setupPage}

        {shownTab === 'introduction' && gameState && (
          <IntroductionPage gameState={gameState} />
        )}

        {shownTab === 'investments' && !hidden('investments') && gameState && <InvestmentsPage gameState={gameState} />}

        {shownTab === 'rateIndication' && gameState && (
          <RateIndicationPage gameState={gameState} decisions={currentDecisions} />
        )}

        {/* Solo only: hidden in multiplayer (MULTIPLAYER_HIDDEN_TABS), so never rendered there. */}
        {shownTab === 'model' && !hidden('model') && gameState && (
          <ModelPage gameState={gameState} decisions={currentDecisions} />
        )}

        {shownTab === 'departments' && !hidden('departments') && gameState && (
          <DepartmentsPage gameState={gameState} currentDecisions={currentDecisions} />
        )}

        {shownTab === 'dashboard' && !hidden('dashboard') && gameState && startingFinancials && (
          <DashboardPage
            lockedResults={d.viewResults}
            historicalYears={d.historicalYears}
            startingFinancials={startingFinancials}
            currentYearNumber={gameState.currentYearNumber}
            lineView={lineView}
            // ⚠ COMPUTED FROM THE WHOLE GAME STATE, NOT FROM `viewResults`, and
            // passed in rather than derived inside the page. The panel shows
            // every line at once whatever the line view is set to — the contrast
            // between a short-tail and a long-tail runoff is the lesson — and
            // DashboardPage only ever receives the filtered slice.
            endingPositionRows={endingPosition(gameState)}
            gameComplete={gameState.isComplete}
          />
        )}

        {shownTab === 'statement' && gameState && (
          <ResultsStatementPage gameState={gameState} lineView={lineView} />
        )}

        {shownTab === 'decisions' && gameState && (
          <DecisionsPage
            /* ⚠ priorProgramIds AND activeLines ARE NO LONGER PASSED. The
               first derived each program's tenure for the Risk Control
               Programs tiles and the second gated which tiles were offered;
               the tiles are removed — risk control is a per-line slider now —
               and neither prop had another reader on that screen. The
               derivation itself is not lost: simulationEngine rebuilds the
               same list from lockedResults for the engine's own read. */
            memberLossHistory={gameState.poolState.memberLossHistory ?? {}}
            allMarketMembers={gameState.poolState.allMarketMembers}
            membershipHistory={gameState.poolState.membershipHistory}
            decisions={currentDecisions}
            onChange={onDecisionsChange}
            yearNumber={gameState.currentYearNumber}
            disabled={gameState.isComplete || decisionsDisabled}
            lineView={lineView}
            lineLoanInfo={d.lineLoanInfo}
            shocks={gameShocksOn(gameState.setup, gameState.instance)}
            lastLineResult={d.lastLineResult}
            fundingConsequence={d.fundingConsequence}
            book={d.decisionLineBook}
          />
        )}

        {shownTab === 'decisionHistory' && gameState && (
          <DecisionHistoryPage lockedResults={d.viewResults} lineView={lineView} />
        )}

        {shownTab === 'financials' && !hidden('financials') && gameState && startingFinancials && (
          <FinancialsPage
            lockedResults={d.viewResults}
            priorResults={d.viewPriorResults}
            lineView={lineView}
          />
        )}

        {shownTab === 'results' && !hidden('results') && gameState && (
          <ResultsPage lockedResults={d.viewResults} lineView={lineView} />
        )}

        {shownTab === SPREADSHEET_TAB && gameState && (
          <ResultSpreadsheetPage
            lockedResults={gameState.lockedResults}
            priorHistory={gameState.priorHistory}
            instance={gameState.instance}
            activeLines={gameState.setup.activeLines}
            instanceId={gameState.setup.instanceId}
            poolState={gameState.poolState}
            claimsWorld={gameState.worlds?.[0]}
          />
        )}

        {shownTab === AUDIT_TAB && !hidden(AUDIT_TAB) && gameState && (
          <CalculationAuditPage
            lockedResults={gameState.lockedResults}
            priorHistory={gameState.priorHistory}
            instanceSeed={gameState.instance.seed}
            lineView={lineView}
            instance={gameState.instance}
            shockTiming={shockTimingOf(gameState.setup)}
          />
        )}

        {shownTab === 'membership' && gameState && startingFinancials && (
          <MembershipPage
            lockedResults={gameState.lockedResults}
            startingFinancials={startingFinancials}
            {...{
              /* ⚠ THE PRE-YEAR-1 FALLBACK FOLLOWS THE VIEW TOO. Before any year
                 is locked the page has no result to read, so it falls back to
                 the opening roster — and on a line view that has to be THAT
                 LINE's opening members, not the pool union, or the page shows
                 116 members under a WC heading for exactly one turn. Derived
                 from poolState rather than stored; see openingRosterForLine. */
            }}
            initialMembers={lineView === 'pool'
              ? initialMembers
              : openingRosterForLine(gameState.poolState, lineView)}
            startingYear={gameState.setup.startingYear}
            memberLossHistory={gameState.poolState.memberLossHistory ?? {}}
            lineView={lineView}
            activeLines={gameState.setup.activeLines}
          />
        )}
      </main>

      {loanPrompt}
    </div>
  );
}

export type { CoverageLine };
