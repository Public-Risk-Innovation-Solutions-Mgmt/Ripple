import { useMemo } from 'react';
import { RefreshCw, ChevronRight, AlertCircle } from 'lucide-react';
import type { GameState, LineView } from '../types/simulation';
import type { TeamMarketShare } from '../session/contract';
import { buildAnnualStatement, topCombinedRatio, topSurplus } from '../utils/resultsStatement';
import { formatCurrency, formatPct, colorForRatioOnDark } from '../utils/formatters';
import { RippleMark } from '../assets/RippleLogo';

interface HeaderProps {
  gameState: GameState | null;
  /** Omitted by a session player: the room owns the game's lifecycle, and a
   *  player who restarted would desync from a room that is still advancing. The
   *  solo game always passes it, so its button is unchanged. */
  onNewGame?: () => void;
  /** Omitted by a VIEWER: there is no submit on a read-only screen, and a
   *  disabled button would still invite the click. The solo game and a playing
   *  session player both pass it, so their button is unchanged. */
  onAdvanceYear?: () => void;
  canAdvance?: boolean;
  /** Overrides the advance button's text. Defaults to the solo wording. A
   *  session player who has already locked shows what it is waiting for
   *  instead. */
  advanceLabel?: string;
  /** The view on screen — the combined ratio is the pool's or that line's. Defaults to the pool. */
  lineView?: LineView;
  /**
   * A HOSTED GAME'S MARKET SHARE: the team's share of the ROOM for the latest
   * known year (CallerView.marketShare) — its line's on a line view, its
   * premium share on the pool view. Passed only by a session screen; null
   * there means the room holds no share for this team (an older handler sends
   * none), and the chip is left out. Absent (single player): no chip.
   */
  roomMarketShare?: TeamMarketShare | null;
}

export default function Header({ gameState, onNewGame, onAdvanceYear, canAdvance, advanceLabel, lineView = 'pool', roomMarketShare }: HeaderProps) {

  // ============================================================================
  // THE COMBINED RATIO, CUMULATIVE SINCE GAME START, READ OFF THE ANNUAL STATEMENT.
  //
  // Every cost — net losses, LAE, admin and the reinsurance cost — over what
  // members were charged, summed over every played year since game start; before
  // any year is played, over the pre-game years. It is the statement's own first
  // row's Total (buildAnnualStatement → topCombinedRatio), for the view on
  // screen: the pool's on the pool view, a line's on its own. So the top and the
  // statement cannot disagree.
  //
  // ⚠ IT REPLACED "Loss Ratio (prem + admin)" — actualLossRatioPricingBasis,
  // net incurred over pool premium + admin. That figure is not gone: it stays
  // on the result, the export, the Results detail and the audit page. The
  // reason the old chip existed still holds for this one: a member-charge LOSS
  // ratio compressed the range, because the near-constant reinsurance and admin
  // sat in the denominator only. Here every cost is in the numerator too.
  // ============================================================================
  const statement = useMemo(
    () => (gameState?.isStarted ? buildAnnualStatement(gameState, lineView) : undefined),
    [gameState, lineView],
  );
  const combined = statement ? topCombinedRatio(statement) : undefined;
  // ============================================================================
  // THE SURPLUS, READ OFF THE SAME STATEMENT: the balance sheet's Ending Surplus
  // for the latest year (topSurplus) — the opening before year 1, each played
  // year's year-end after it — for the view on screen. It was the pool's last
  // result, whatever the view, and before year 1 startingFinancials' cash plus
  // investments less the net reserve and unearned premium, which left out the
  // loss expense reserve and read high by it.
  // ============================================================================
  const surplus = (statement ? topSurplus(statement) : undefined) ?? 0;
  // ============================================================================
  // THE MARKET SHARE IS THE TEAM'S SHARE OF THE ROOM, AND ONLY IN A HOSTED GAME.
  // Its exposure over every team's in the room on a line view, its premium over
  // the room's on the pool view, for the latest known year — the room's own
  // figure for this team (CallerView.marketShare), worked out where the room
  // is kept so every screen in it reads the same number. ⚠ SINGLE PLAYER HAS NO
  // CHIP: there is no room to share, and the share of the whole market of
  // potential members (which a hosted team used to see as ~30% in a room of
  // eight) is not a share of anything the player competes for.
  // ============================================================================
  const marketShare = roomMarketShare
    ? (lineView === 'pool' ? roomMarketShare.pool : roomMarketShare.byLine[lineView])
    : undefined;
  const poolName = gameState?.setup?.poolName ?? 'Ripple Public Entity Risk Pool';
  const instanceId = gameState?.instance?.instanceId ?? '—';
  const yearNumber = gameState?.currentYearNumber ?? 1;
  // ⚠ TWO YEARS, NAMED APART. The board sets next year's rates during the year
  // in progress: the PROGRAM YEAR is the one being priced (the setup's first
  // year, 2027, at year 1), and the CURRENT year — this chip — is the year
  // before it (2026 at the start, 2027 after the first played year). The lock
  // button names the program year.
  const programYear = gameState ? gameState.setup.startingYear + gameState.currentYearNumber - 1 : undefined;
  const calendarYear = programYear !== undefined ? programYear - 1 : '—';
  const isStarted = gameState?.isStarted ?? false;
  const isComplete = gameState?.isComplete ?? false;

  return (
    <header className="bg-slate-900 text-white shadow-xl sticky top-0 z-40">
      <div className="max-w-screen-2xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left: branding */}
          <div className="flex items-center gap-3 min-w-0">
            <RippleMark size={32} className="flex-shrink-0" />
            <span className="font-bold text-lg leading-none text-white flex-shrink-0">RIPPLE</span>
            <span className="text-slate-600 flex-shrink-0">|</span>
            {/* Same slot, two occupants that never overlap: the tagline
                before a game exists, the SIMULATED pool's own name once one
                does. The pool-name branch is untouched — it names the game
                in progress, not the product, and stays that way on rename. */}
            {isStarted ? (
              <span className="text-slate-300 text-sm truncate min-w-0">{poolName}</span>
            ) : (
              <span className="text-slate-400 text-sm truncate min-w-0">Every decision creates impact.</span>
            )}
          </div>

          {/* Center: game state chips */}
          {isStarted && (
            <div className="flex items-center gap-3 flex-wrap">
              <Chip label="Year" value={`${yearNumber}`} />
              <Chip label="Calendar" value={`${calendarYear}`} testId="header-calendar" />
              <Chip label="Scenario" value={instanceId} mono />
              <Chip
                label="Surplus"
                value={formatCurrency(surplus, true)}
                valueClass={surplus >= 0 ? 'text-emerald-400' : 'text-red-400'}
              />
              {/* ⚠ FOUR COLOURS OVER THE NARRATIVE'S FIVE BANDS, AND THE MERGE IS
                  DELIBERATE. The chip is a number and a colour with no room for
                  words, so bands 0 and 1 — "most of the premium unspent" and
                  "margin to spare" — share emerald. Every colour boundary is
                  also a sentence boundary, so the chip says LESS than the
                  narrative and never something different. The band-to-sentence
                  map is at colorForRatio in formatters.ts; change neither alone. */}
              {combined !== undefined && (
                <Chip
                  label="Combined Ratio"
                  value={formatPct(combined)}
                  valueClass={colorForRatioOnDark(combined)}
                  testId="header-combined-ratio"
                />
              )}
              {marketShare !== undefined && (
                <Chip
                  label="Market Share"
                  value={formatPct(marketShare)}
                  valueClass="text-sky-400"
                  testId="header-market-share"
                />
              )}
            </div>
          )}

          {/* Right: actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {onNewGame && (
              <button
                onClick={onNewGame}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-medium transition-colors"
              >
                <RefreshCw size={14} />
                New Game
              </button>
            )}
            {isStarted && !isComplete && onAdvanceYear && (
              <button
                onClick={onAdvanceYear}
                disabled={!canAdvance}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold transition-colors"
              >
                {advanceLabel ?? `Lock Program Year ${programYear}`}
                <ChevronRight size={14} />
              </button>
            )}
            {isComplete && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 text-sm font-medium">
                <AlertCircle size={14} />
                Game Complete
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function Chip({
  label,
  value,
  valueClass = 'text-white',
  mono = false,
  testId,
}: {
  label: string;
  value: string;
  valueClass?: string;
  mono?: boolean;
  testId?: string;
}) {
  return (
    <div className="bg-slate-800 rounded-lg px-3 py-1.5 flex flex-col items-center min-w-[80px]">
      <span className="text-slate-400 text-xs">{label}</span>
      <span data-testid={testId} className={`text-sm font-bold min-h-[1.25rem] ${valueClass} ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
