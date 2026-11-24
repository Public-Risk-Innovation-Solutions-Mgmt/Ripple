import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { RefreshCw, ChevronRight, AlertCircle } from 'lucide-react';
import type { GameState, LineView } from '../types/simulation';
import type { TeamMarketShare } from '../session/contract';
import { buildAnnualStatement, newestCombinedRatio, topSurplus } from '../utils/resultsStatement';
import { formatCurrency, formatPct, colorForRatioOnDark } from '../utils/formatters';
import RippleBrandLogo, { LOGO_ASPECT } from './RippleBrandLogo';
import { useTopBar, useWide } from './useTopBar';

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
  /** Which figures the bar shows — surplus, combined ratio and market share: the pool, or a line (GameShell passes a line only on the Decisions page). Defaults to the pool. */
  lineView?: LineView;
  /**
   * A HOSTED GAME'S MARKET SHARE: the team's share of the ROOM for the latest
   * known year (CallerView.marketShare) — its line's on a line view, on the
   * pool view the average of its line shares (marketShares.poolShareOf). Passed only by a session screen; null
   * there means the room holds no share for this team (an older handler sends
   * none), and the chip is left out. Absent (single player): no chip.
   */
  roomMarketShare?: TeamMarketShare | null;
  /** A hosted team's number, shown before its pool name — "Team 3 | Harbour Mutual" (a room where each team names its pool). */
  teamNumber?: number;
}

/** Today's logo height, the bar's size once scrolled and on a phone. */
const LOGO_BASE = 44;
/** The logo at the top of the page on a desktop, when the bar has the room. */
const LOGO_TOP = 76;

/**
 * HOW BIG THE BAR CAN GROW AT THE TOP OF THE PAGE, measured: the logo toward
 * 76px and the chips toward the logo's own rate (76/44), but only as far as the
 * bar stays on ONE ROW at this width. The chips are 600px wide at today's size,
 * so the logo's full rate would need about 440px more than a 1440px screen has;
 * there they grow as far as the room allows. A very narrow desktop (1280) has
 * no room at all, and the bar stays at today's size even at the top.
 *
 * Every chip size is a multiple of --bar-s, so a group's width at --bar-s 1 is
 * its width now divided by --bar-s now — exact mid-animation too.
 */
function useBarFit(row: React.RefObject<HTMLDivElement | null>, left: React.RefObject<HTMLDivElement | null>,
  chips: React.RefObject<HTMLDivElement | null>, right: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  const [fit, setFit] = useState({ logo: LOGO_TOP, scale: LOGO_TOP / LOGO_BASE });
  useLayoutEffect(() => {
    const measure = () => {
      const r = row.current, l = left.current, c = chips.current, b = right.current;
      if (!r || !l || !b) return;
      const logo = l.querySelector('img');
      const logoNow = logo ? logo.getBoundingClientRect().height : LOGO_BASE;
      const sNow = parseFloat(getComputedStyle(r).getPropertyValue('--bar-s')) || 1;
      const leftAtBase = l.getBoundingClientRect().width - (logoNow - LOGO_BASE) * LOGO_ASPECT;
      const chipsAtBase = c ? c.getBoundingClientRect().width / sNow : 0;
      const gaps = c ? 32 : 16; // gap-4 between the groups
      const free = r.clientWidth - leftAtBase - chipsAtBase - b.getBoundingClientRect().width - gaps - 4;
      const logoTop = LOGO_BASE + Math.max(0, Math.min(LOGO_TOP - LOGO_BASE, free / LOGO_ASPECT));
      const remain = free - (logoTop - LOGO_BASE) * LOGO_ASPECT;
      const scale = chipsAtBase > 0 ? Math.min(logoTop / LOGO_BASE, 1 + Math.max(0, remain) / chipsAtBase) : logoTop / LOGO_BASE;
      setFit(f => (Math.abs(f.logo - logoTop) < 0.5 && Math.abs(f.scale - scale) < 0.005 ? f : { logo: logoTop, scale }));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (row.current) ro?.observe(row.current);
    if (right.current) ro?.observe(right.current);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return fit;
}

export default function Header({ gameState, onNewGame, onAdvanceYear, canAdvance, advanceLabel, lineView = 'pool', roomMarketShare, teamNumber }: HeaderProps) {

  // ============================================================================
  // THE COMBINED RATIO OF THE NEWEST YEAR, READ OFF THE ANNUAL STATEMENT, AND
  // LABELLED WITH THAT YEAR ("Combined ratio 2027").
  //
  // Every cost — net losses, LAE, admin and the reinsurance cost — over what
  // members were charged, for the year the statement's newest column shows: the
  // latest played year, or before year 1 the last history year. It is that
  // column's Combined Ratio cell (buildAnnualStatement → newestCombinedRatio),
  // for the view on screen: the pool's on the pool view, a line's on its own. So
  // the top and the statement cannot disagree. The host's Teams table posts the
  // same cell (session/client/results, yearCombinedRatio).
  //
  // ⚠ IT WAS THE CUMULATIVE SINCE GAME START (the statement's Total,
  // topCombinedRatio), which a player could not find in any one column.
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
  const combined = statement ? newestCombinedRatio(statement) : undefined;
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
  // ⚠ THE SCENARIO NUMBER, NEVER THE INSTANCE ID: a scenario's instance carries
  // its fixed seed as its id (scenarios.ts), which no player or host is shown.
  const instanceId = gameState?.instance?.scenario !== undefined ? String(gameState.instance.scenario) : (gameState?.setup?.instanceId ?? '—');
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
  const topBar = useTopBar<HTMLElement>();
  const wide = useWide();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const leftRef = useRef<HTMLDivElement | null>(null);
  const chipsRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const fit = useBarFit(rowRef, leftRef, chipsRef, rightRef, [isStarted, isComplete, poolName]);
  // ⚠ A PHONE KEEPS TODAY'S BAR: no growing at the top, no shrinking on scroll.
  const grown = wide && !topBar.compact;
  const logoHeight = grown ? fit.logo : LOGO_BASE;
  const barScale = grown ? fit.scale : 1;

  return (
    <header ref={topBar.ref} data-testid="top-bar" data-compact={topBar.compact ? 'true' : 'false'} className="bg-slate-900 text-white shadow-xl sticky top-0 z-40">
      <div className="max-w-screen-2xl mx-auto px-4 py-3">
        <div ref={rowRef} data-testid="top-bar-row" className="bar-scale flex items-center justify-between gap-4 flex-wrap" style={{ ['--bar-s' as string]: barScale } as CSSProperties}>
          {/* Left: branding */}
          <div ref={leftRef} className="flex items-center gap-3 min-w-0">
            {/* The full logo on a white tile: its own background is white and its lettering black. */}
            {/* On a desktop, readable at the top of the page (76px where the bar has the
                room, "Powered by PRISM" included) and today's 44px once scrolled
                (useTopBar, useBarFit). On a phone, today's 44px throughout. */}
            <RippleBrandLogo tile className="transition-[height] duration-200 ease-out" height={logoHeight} />
            <span className="text-slate-500 flex-shrink-0">|</span>
            {/* Same slot, two occupants that never overlap: the tagline
                before a game exists, the SIMULATED pool's own name once one
                does. The pool-name branch is untouched — it names the game
                in progress, not the product, and stays that way on rename. */}
            {isStarted ? (
              <span data-testid="header-pool-name" className="text-slate-300 text-sm truncate min-w-0">{teamNumber !== undefined ? `Team ${teamNumber} | ${poolName}` : poolName}</span>
            ) : (
              <span className="text-slate-300 text-sm truncate min-w-0">Every decision creates impact.</span>
            )}
          </div>

          {/* Center: game state chips */}
          {isStarted && (
            <div ref={chipsRef} data-testid="top-bar-chips" className="flex items-center flex-wrap" style={{ gap: 'calc(12px * var(--bar-s))' }}>
              <Chip label="Year" value={`${yearNumber}`} />
              <Chip label="Calendar" value={`${calendarYear}`} testId="header-calendar" />
              <Chip label="Scenario" value={instanceId} mono />
              {/* WHICH FIGURES THE NEXT CHIPS ARE: the pool's, or on Decisions the
                  line being decided (GameShell passes the line only there). */}
              <Chip label="Showing" value={lineView === 'pool' ? 'Pool' : lineView} testId="header-scope" />
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
                  label={`Combined ratio ${combined.calendarYear}`}
                  value={formatPct(combined.value)}
                  valueClass={colorForRatioOnDark(combined.value)}
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
          <div ref={rightRef} className="flex items-center gap-2 flex-shrink-0">
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
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold transition-colors"
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

const BS = (px: number) => `calc(${px}px * var(--bar-s, 1))`;
const CHIP_STYLE: CSSProperties = { padding: `${BS(6)} ${BS(12)}`, minWidth: BS(80), borderRadius: BS(8) };
const CHIP_LABEL: CSSProperties = { fontSize: BS(12), lineHeight: BS(16) };
const CHIP_VALUE: CSSProperties = { fontSize: BS(14), lineHeight: BS(20), minHeight: BS(20) };

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
    // Every size a multiple of --bar-s (1 is today's: px-3 py-1.5, min-w 80px, text-xs over text-sm),
    // so the chips grow and shrink with the logo (useBarFit).
    <div className="bg-slate-800 rounded-lg flex flex-col items-center" style={CHIP_STYLE}>
      <span className="text-white" style={CHIP_LABEL}>{label}</span>
      <span data-testid={testId} className={`font-bold ${valueClass} ${mono ? 'font-mono' : ''}`} style={CHIP_VALUE}>{value}</span>
    </div>
  );
}
