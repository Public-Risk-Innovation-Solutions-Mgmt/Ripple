// ============================================================================
// THE DECISION-PAGE DERIVATIONS — one implementation, two callers.
//
// ⚠ THIS MOVED OUT OF App.tsx UNCHANGED. Every memo below is the one that stood
// in App.tsx, with the same body and the same dependency array; only the file
// changed. A derivation moving files is not a derivation changing, and the solo
// game's rendered output is fingerprinted tab by tab before and after to hold
// that claim to something.
//
// ⚠ WHY IT MOVED RATHER THAN BEING REPRODUCED. A session player plays the same
// game as a solo player, so it needs the same thirteen props — the
// funding-consequence panel, the tower priced off the enrolled book, the
// renewal decline counts, the appetite applicant pool. A second copy of this
// arithmetic is how two paths disagree later, and this repository has
// RESULT_METRICS on record as the case where exactly that happened, twice: the
// on-screen table and the .xlsx export drifted apart because each carried its
// own list. One file, both callers, no second opinion.
//
// ⚠ IT DEPENDS ON NOTHING App HAS AND A SESSION DOES NOT. Every value here is a
// pure function of (gameState, lineView, currentDecisions). There is no context,
// no module state, and nothing reaching back into App — which is what makes the
// session caller a caller rather than a fork.
// ============================================================================

import React from 'react';
import type {
  CoverageLine, DecisionSet, GameState, HistoricalYear,
  LineResultSet, LineView, Member, ResultSet,
} from '../types/simulation';
import type { LineLoanInfo } from '../pages/DecisionsPage';
import type { FundingConsequence } from '../utils/fundingConsequence';
import { computeFundingConsequence } from '../utils/fundingConsequence';
import { aggregateTermsRetainedPer100 } from '../utils/simulationEngine';
import { bookPurePremium, newPurePremiumPer100 } from '../utils/newPurePremium';
import { pricingExperienceBasis } from '../utils/pricingTriangle';
import { poolToHistoricalYear, toHistoricalYear } from '../utils/priorHistoryEngine';
import { bookExposureOf, getMemberExposure, isRoster, selectResultView, type Book } from '../utils/lineHelpers';
import { exposureFactor } from '../data/exposureTrend';
import type { LinePoolState } from '../types/simulation';

/** A line's exposure this year — its book, or its active roster. */
function lineBookExposure(lineState: LinePoolState, line: CoverageLine, yearNumber: number): number {
  return lineState.bookExposure !== undefined
    ? lineState.bookExposure * exposureFactor(line, yearNumber)
    : lineState.members
      .filter(m => m.status === 'active')
      .reduce((s, m) => s + getMemberExposure(m, line, yearNumber), 0);
}
import { effectiveRiskControlIncentivePct } from '../utils/linePricing';

export interface GameDerivations {
  decisionLine: CoverageLine;
  // ⚠ A UNION, NOT LineResultSet[]. At the pool view these ARE pool rows, and
  // typing them as line rows is what let every consuming page read a per-line
  // placeholder off one. A consumer that needs a line field must now narrow on
  // the view, which is the question that was never being asked.
  viewResults: Array<ResultSet | LineResultSet>;
  viewPriorResults: Array<ResultSet | LineResultSet>;
  historicalYears: HistoricalYear[];
  lineLoanInfo: Record<CoverageLine, LineLoanInfo>;
  estimatedExpectedLoss: number;
  estimatedAggregateTermsRetained: number | undefined;
  lastLineResult: LineResultSet | undefined;
  decisionLineActiveMembers: Member[];
  fundingConsequence: FundingConsequence | null;
}

export function useGameDerivations(
  gameState: GameState | null,
  lineView: LineView,
  currentDecisions: DecisionSet,
): GameDerivations {
  const viewResults = React.useMemo(() => {
    if (!gameState) return [];
    return selectResultView(gameState.lockedResults, lineView);
  }, [gameState, lineView]);

  const lineLoanInfo = React.useMemo(() => {
    const lastResult = gameState?.lockedResults[gameState.lockedResults.length - 1];
    const info: Record<CoverageLine, LineLoanInfo> = { WC: { balance: 0, dividendBlocked: false }, GL: { balance: 0, dividendBlocked: false }, Property: { balance: 0, dividendBlocked: false } };
    for (const line of (['WC', 'GL', 'Property'] as CoverageLine[])) {
      info[line] = {
        balance: gameState?.poolState.interLineLoans.find(l => l.borrowingLine === line)?.remainingBalance ?? 0,
        dividendBlocked: (lastResult?.byLine[line]?.endingSurplus ?? 0) < 0,
      };
    }
    return info;
  }, [gameState]);

  // Stage 2.10: the pre-game history is real per-line engine output. Filter it
  // to the current view (pool aggregate or a single line), then adapt to the
  // HistoricalYear display shape the history-aware pages render.
  const viewPriorResults = React.useMemo(() => {
    if (!gameState) return [];
    return lineView === 'pool'
      ? selectResultView(gameState.priorHistory, 'pool')
      : selectResultView(gameState.priorHistory, lineView);
  }, [gameState, lineView]);

  // ⚠ TWO ADAPTERS, DISPATCHED ON THE VIEW. A pool row and a line row no longer
  // share a shape, so one `.map(toHistoricalYear)` cannot serve both: the pool
  // one omits the two per-$100 rate fields because neither exists at pool scale.
  // The branch is what carries that into the history-aware pages.
  const historicalYears = React.useMemo(
    () => (lineView === 'pool'
      ? (viewPriorResults as ResultSet[]).map(poolToHistoricalYear)
      : (viewPriorResults as LineResultSet[]).map(toHistoricalYear)),
    [viewPriorResults, lineView]
  );

  // Decisions-page reinsurance preview estimates, scoped to the line currently
  // being edited (Stage 2.7). Uses that line's own exposure basis — payroll for
  // WC/GL, TIV for Property — and its own ratePer100 / purePremiumPer100.
  // These are intentionally simple previews; the real premium is recomputed per
  // line in simulationEngine.ts at lock.
  //
  // The (1 + rateChange) factor this used to carry is GONE — CLF-only pricing
  // removed the Rate Change decision, so lineState.ratePer100 (last year's
  // total member charge rate) is used directly.
  const decisionLine: CoverageLine = lineView === 'pool' ? 'WC' : (lineView as CoverageLine);

  // (The `estimatedExposure` memo that used to live here is gone. It existed
  // solely to feed the reinsurance tower a per-$100 exposure base; the tower now
  // prices off `decisionLineActiveMembers` and the year directly, so a nominal
  // exposure figure is no longer an input to any price.)

  const estimatedExpectedLoss = React.useMemo(() => {
    if (!gameState) return 3_500_000;

    const lineState = gameState.poolState.lines[decisionLine];
    const exposure = lineBookExposure(lineState, decisionLine, gameState.currentYearNumber);

    return exposure * lineState.purePremiumPer100 * 10_000;
  }, [gameState, decisionLine]);

  // ⚠ THE AGGREGATE'S AGREED TERMS, FOR THE TOWER TILE ONLY. Once the pool
  // prices off its own triangle the engine sets the attachment from the
  // triangle's retained estimate rather than from the rate (see quoteAggregate's
  // header), so a tile deriving it from `estimatedExpectedLoss` would quote a
  // layer the engine will not write. Undefined on the held path, which restores
  // the tile's previous arithmetic exactly.
  //
  // ⚠ AND `estimatedExpectedLoss` ABOVE IS STILL LAST YEAR'S RATE. That
  // approximation is older than this and is deliberate — the tile is indicative
  // and re-renders live off the CURRENT placements — but it is the reason the
  // tile's E[R] and the engine's differ even when the terms agree.
  const estimatedAggregateTermsRetained = React.useMemo(() => {
    if (!gameState) return undefined;
    const lineState = gameState.poolState.lines[decisionLine];
    const rate = aggregateTermsRetainedPer100(decisionLine, {
      rows: lineState.reserveDevelopment ?? [],
      allMarketMembers: gameState.poolState.allMarketMembers,
      membershipHistory: gameState.poolState.membershipHistory,
    });
    if (rate === undefined) return undefined;
    const exposure = lineBookExposure(lineState, decisionLine, gameState.currentYearNumber);
    return exposure * rate * 10_000;
  }, [gameState, decisionLine]);

  // The last computed result for the line currently being edited — pool
  // accounting fields the consequence panel surfaces are not carried on
  // LinePoolState itself (excessCapitalRatio, capitalAdequacyStatus), only on
  // the LineResultSet each processed year returns. Falls back to the last
  // pre-game year when no year has been locked yet (mirrors lineLoanInfo's
  // pattern, but that one only reads lockedResults since it does not need to
  // cover the pre-Year-1 gap).
  const lastLineResult = React.useMemo(() => {
    if (!gameState) return undefined;
    if (gameState.lockedResults.length > 0) {
      return gameState.lockedResults[gameState.lockedResults.length - 1].byLine[decisionLine];
    }
    if (gameState.priorHistory.length > 0) {
      return gameState.priorHistory[gameState.priorHistory.length - 1].byLine[decisionLine];
    }
    return undefined;
  }, [gameState, decisionLine]);

  // CLF-only pricing consequence panel (Decisions page). lineState.ratePer100
  // is already last year's totalMemberChargeRatePer100, so it doubles as the
  // "vs last year" basis with no separate lookup. Narrow deps (not all of
  // currentDecisions) so this does not recompute when an unrelated line's or
  // pool decision changes.
  // The decision line's active book. Shared by the funding-consequence panel and
  // by the reinsurance tower, which now prices off the members themselves rather
  // than off a frozen per-$100 rate card times exposure.
  const decisionLineActiveMembers = React.useMemo(() => {
    if (!gameState) return [];
    return gameState.poolState.lines[decisionLine].members.filter(m => m.status === 'active');
  }, [gameState, decisionLine]);
  // What the panel prices — the roster, or with MEMBER_LEVEL off the line's one
  // book, exactly as the engine does (see Book).
  const decisionLineBook: Book = React.useMemo(() => {
    if (!gameState) return [];
    const lineState = gameState.poolState.lines[decisionLine];
    return lineState.bookExposure !== undefined
      ? { exposure: lineBookExposure(lineState, decisionLine, gameState.currentYearNumber) }
      : decisionLineActiveMembers;
  }, [gameState, decisionLine, decisionLineActiveMembers]);

  const decisionLineFundingLevel = currentDecisions.byLine[decisionLine].fundingConfidenceLevel;
  const decisionLineFundingAtExpected = currentDecisions.byLine[decisionLine].fundingAtExpected;
  const fundingConsequence = React.useMemo(() => {
    if (!gameState) return null;
    const lineState = gameState.poolState.lines[decisionLine];
    const d = currentDecisions.byLine[decisionLine];
    return computeFundingConsequence(
      decisionLineFundingLevel,
      lineState.ratePer100,
      decisionLine,
      decisionLineFundingAtExpected,
      {
        yearNumber: gameState.currentYearNumber,
        // The tower prices off the book itself, so the panel needs the members
        // and the year, not just an exposure total.
        members: decisionLineBook,
        exposure: bookExposureOf(decisionLineBook, decisionLine, gameState.currentYearNumber),
        layersPlaced: d.layersPlaced,
        aggregateStopLevel: d.aggregateStopLevel,
        pricingAdjustment: lineState.rateLevel / 100,
        priorPurePremiumPer100: lineState.purePremiumPer100,
        lossTrend: gameState.instance.lossEnvironment.lossTrend,
        priorRcEffectiveness: lineState.riskControlEffectiveness,
        riskControlPct: d.riskControlPct,
        // ⚠ NEW_RATE_STACK ONLY, AND IT IS NOW READ OFF THE LEDGER RATHER THAN
        // OFF LAST YEAR'S RESULT. What stood here was
        // `lastLineResult?.newPurePremiumPer100`, on the reasoning that the
        // page had no reserve ledger reader of its own. It has one — the
        // aggregate-terms tile above uses exactly this basis shape — and the
        // stale figure had a consequence the panel showed on its face: the
        // "vs last year" row read +0.0% / +0.1% every year while the rate
        // climbed about 3% a year, because the panel's indication was built
        // from the SAME pure premium that produced the indication it was being
        // compared against. A change column that cannot move is not one.
        //
        // This is the engine's own call with the engine's own arguments —
        // simulationEngine.ts computes `newPp` as
        // computeNewPurePremium(line, yearNumber, { rows: reserveDevelopment,
        // allMarketMembers, membershipHistory }) — evaluated on the state the
        // page is holding, which after year N is processed is the state year
        // N+1 will be priced from. Still undefined before the first priced
        // year, which is when the panel has no comparison to show either.
        // A book takes the engine's own book rule — the ledger's figure, or
        // the engine's expectation before the ledger has one.
        groundUpPurePremiumPer100: (isRoster(decisionLineBook)
          ? newPurePremiumPer100(decisionLine, gameState.currentYearNumber, {
            rows: gameState.poolState.lines[decisionLine]?.reserveDevelopment ?? [],
            allMarketMembers: gameState.poolState.allMarketMembers,
            membershipHistory: gameState.poolState.membershipHistory,
          })
          : bookPurePremium(decisionLine, gameState.currentYearNumber, {
            rows: gameState.poolState.lines[decisionLine]?.reserveDevelopment ?? [],
            allMarketMembers: gameState.poolState.allMarketMembers,
            membershipHistory: gameState.poolState.membershipHistory,
          }, bookExposureOf(decisionLineBook, decisionLine, gameState.currentYearNumber)))?.purePremiumPer100,
        newStackRiskControlPct: effectiveRiskControlIncentivePct(d),
        // S3: the panel prices off the same played triangle the engine does.
        //
        // ⚠ IT DID NOT, UNTIL THIS COMMIT. These three fields were spelled out
        // here with `rows: lineState.reserveDevelopment ?? []` and NO
        // windowRows, so the panel priced off the pool's whole history against
        // an engine pricing off ten years — WC's basis ran 23.3% high on average
        // and 72.9% at worst, in every line-year of every game from year one.
        // pricingExperienceBasis is now the single builder; see its header for
        // the measurement and for the identity that validates it.
        experience: isRoster(decisionLineBook) ? pricingExperienceBasis(gameState.poolState, decisionLine) : undefined,
      },
    );
  }, [gameState, decisionLine, decisionLineFundingLevel, decisionLineFundingAtExpected, decisionLineBook, currentDecisions]);

  return {
    decisionLine,
    viewResults,
    viewPriorResults,
    historicalYears,
    lineLoanInfo,
    estimatedExpectedLoss,
    estimatedAggregateTermsRetained,
    lastLineResult,
    decisionLineActiveMembers,
    fundingConsequence,
  };
}
