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

import { investmentIncomeCredit, gameHistory } from '../utils/investmentIncomeCredit';
import React from 'react';
import type {
  CoverageLine, DecisionSet, GameState, HistoricalYear, LineDecisionSet,
  LineResultSet, LineView, Member, ResultSet,
} from '../types/simulation';
import type { LineLoanInfo } from '../pages/DecisionsPage';
import type { FundingConsequence } from '../utils/fundingConsequence';
import { computeFundingConsequence } from '../utils/fundingConsequence';
import { aggregateTermsRetainedPer100 } from '../utils/simulationEngine';
import { bookPurePremium, newPurePremiumPer100 } from '../utils/newPurePremium';
import { pricingExperienceBasis } from '../utils/pricingTriangle';
import { poolToHistoricalYear, toHistoricalYear } from '../utils/priorHistoryEngine';
import { bookExposureOf, bookRiskOf, getMemberExposure, isRoster, selectResultView, type Book } from '../utils/lineHelpers';
import { exposureFactor } from '../data/exposureTrend';
import { lineBookRisk, marketSeedOf } from '../utils/bookUnits';
import { moveBook, moveBookUnits } from '../utils/bookUnderwriting';
import { MEMBER_LEVEL, newLossEngineRuns, RISK_CONTROL } from '../data/pricingParameters';
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
import { AGGREGATE_NOT_OFFERED, placementFor } from '../utils/reinsuranceOptions';
import { surplusRange, type SurplusRange } from '../utils/worlds';
import { gameShocksOn } from '../utils/shockLosses';
import type { FundingConsequenceBook } from '../utils/fundingConsequence';
import type { NewPurePremiumResult } from '../utils/newPurePremium';

/**
 * WHAT A LINE'S RATE IS PRICED ON FOR THE COMING YEAR — the roster, or with
 * MEMBER_LEVEL off the line's one book with its own risk, exactly as the
 * engine does (see Book). The Decisions panel and the Rate Indication read it.
 */
export function pricingBookFor(gameState: GameState, line: CoverageLine): Book {
  const lineState = gameState.poolState.lines[line];
  // With the book's own risk, which its tower's price carries (book units commit 5).
  const risk = lineBookRisk(gameState.instance, line, gameState.poolState.bookUnits, gameState.poolState.bookLedger);
  return lineState.bookExposure !== undefined
    ? { exposure: lineBookExposure(lineState, line, gameState.currentYearNumber), ...(risk !== undefined ? { risk } : {}) }
    : lineState.members.filter(m => m.status === 'active');
}

/**
 * THE DECISIONS PANEL'S PRICING INPUT FOR A LINE, AND THE PURE PREMIUM BEHIND
 * IT — one builder, so the panel and the Rate Indication (Departments,
 * Actuarial) price off the same figures and cannot drift. `reinsuranceOption`
 * overrides the line's chosen cover (the indication prices each one).
 */
export function fundingConsequenceInput(
  gameState: GameState, line: CoverageLine, decisions: DecisionSet, reinsuranceOption?: string,
): { book: FundingConsequenceBook; purePremium: NewPurePremiumResult | null } {
  const d = decisions.byLine[line];
  const option = reinsuranceOption ?? d.reinsuranceOption;
  const book = pricingBookFor(gameState, line);
  const exposure = bookExposureOf(book, line, gameState.currentYearNumber);
  const basis = {
    rows: gameState.poolState.lines[line]?.reserveDevelopment ?? [],
    allMarketMembers: gameState.poolState.allMarketMembers,
    membershipHistory: gameState.poolState.membershipHistory,
  };
  // A book takes the engine's own book rule — the ledger's figure, or the
  // engine's expectation before the ledger has one.
  const purePremium = isRoster(book)
    ? newPurePremiumPer100(line, gameState.currentYearNumber, basis)
    : bookPurePremium(line, gameState.currentYearNumber, basis, exposure, bookRiskOf(book));
  const lineState = gameState.poolState.lines[line];
  return {
    purePremium,
    book: {
      yearNumber: gameState.currentYearNumber,
      // The tower prices off the book itself, so the panel needs the members
      // and the year, not just an exposure total.
      members: book,
      exposure,
      // The chosen package, as the tower reads it — the engine's own call.
      layersPlaced: placementFor(line, option),
      aggregateStopLevel: AGGREGATE_NOT_OFFERED,
      reinsuranceOption: option,
      shocks: gameShocksOn(gameState.setup, gameState.instance),
      pricingAdjustment: lineState.rateLevel / 100,
      priorPurePremiumPer100: lineState.purePremiumPer100,
      lossTrend: gameState.instance.lossEnvironment.lossTrend,
      priorRcEffectiveness: lineState.riskControlEffectiveness,
      riskControlPct: d.riskControlPct,
      groundUpPurePremiumPer100: purePremium?.purePremiumPer100,
      investmentIncomeCredit: investmentIncomeCredit(line, gameHistory(gameState), gameState.currentYearNumber),
      newStackRiskControlPct: effectiveRiskControlIncentivePct(d),
      // S3: the panel prices off the same played triangle the engine does
      // (pricingExperienceBasis — see its header).
      experience: isRoster(book) ? pricingExperienceBasis(gameState.poolState, line) : undefined,
    },
  };
}

// ============================================================================
// THE DECISION FIGURES — dollars the Decisions page prints beside its sliders.
//
// ⚠ ONE FUNCTION EACH, CALLED BY THE PAGE AND BY decision-figures-check, and
// every one is the engine's own pricing or movement function applied to the
// engine's own inputs — none is a second sum. Underwriting calls the same
// movement function processLineYear calls (moveBookUnits, or moveBook on a
// book with no units) and multiplies by the rate the panel already quotes;
// the risk control cost reads quoteNewRateStack's own riskControlPer100.
// DISPLAY ONLY: nothing here is read by the engine.
// ============================================================================

export interface UnderwritingFigures {
  /** Premium on the book the renewal slider turns away, at this year's rate. Dollars. */
  nonRenewedPremium: number;
  /** Premium on the new business the rejection slider lets in, at this year's rate. Dollars. */
  newBusinessPremium: number;
}

/**
 * THE BOOK'S MOVEMENT FOR THE COMING YEAR, PRICED. `ratePer100` is the rate the
 * Decisions panel quotes — the funding level's and the cover's, struck on the
 * book before it moves, as the engine strikes it. Withdrawal is not forecast:
 * a Member Withdrawal is a shock the player has not been told of. Null where
 * there is no book to move (the member path).
 */
export function underwritingFigures(
  gameState: GameState, line: CoverageLine, d: LineDecisionSet, ratePer100: number,
): UnderwritingFigures | null {
  if (MEMBER_LEVEL.enabled) return null;
  const { poolState, instance, currentYearNumber } = gameState;
  const units = newLossEngineRuns() ? poolState.bookUnits?.[line] : undefined;
  // The engine's own choice (processLineYear): units where the state has them.
  const move = units
    ? moveBookUnits(line, marketSeedOf(instance), units, poolState.bookLedger?.[line], d, false, false, currentYearNumber)
    : moveBook(line, poolState.lines[line].bookExposure ?? 0, d, false, false);
  const dollarsPerUnit = exposureFactor(line, currentYearNumber) * 10_000 * ratePer100;
  return { nonRenewedPremium: move.renewedOff * dollarsPerUnit, newBusinessPremium: move.written * dollarsPerUnit };
}

/**
 * WHAT THE RISK CONTROL SLIDER COSTS AT THE CURRENT EXPOSURE, in dollars: the
 * rate's risk control loading (quoteNewRateStack.riskControlPer100) on the
 * book's exposure, at the funding level and cover chosen.
 *
 * ⚠ $0 WHILE RISK_CONTROL IS OFF. The engine charges nothing for the incentive
 * then, and the slider is disabled at 0%, so the box shows $0 — never a cost the
 * game does not charge. With the flag on, the figure is what the engine's rate
 * charges for the incentive at the slider's value.
 *
 * ⚠ OPEN, FOR WHEN THE FLAG COMES ON: the engine loads the incentive as a share
 * of the loaded rate (quoteNewRateStack's divisor), but the slider is labelled
 * as a share of the PURE PREMIUM. It must be charged as a percentage of the pure
 * premium, matching the label, before the flag is switched on.
 */
export function riskControlCost(gameState: GameState, line: CoverageLine, decisions: DecisionSet): number | null {
  // ⚠ $0 WHILE RISK_CONTROL IS OFF: the engine charges nothing for the
  // incentive, and the box never shows a cost the game does not charge.
  if (!RISK_CONTROL.enabled) return 0;
  const d = decisions.byLine[line];
  const { book } = fundingConsequenceInput(gameState, line, decisions);
  const c = computeFundingConsequence(
    d.fundingConfidenceLevel, gameState.poolState.lines[line].ratePer100, line, d.fundingAtExpected,
    { ...book, newStackRiskControlPct: d.riskControlIncentivePct ?? 0 },
  );
  return c.newStack ? c.newStack.riskControlPer100 * book.exposure * 10_000 : null;
}

/**
 * THE "YOUR RATE" AND "INDICATED" COLUMNS' PIECES, per $100, built to add up to
 * the rate exactly. Your rate's pure premium is the retained pure premium times
 * the CLF — the figure the divisor loads — so it moves with the funding level;
 * the risk control & contingency row is what is left of the charged rate once
 * the other three are taken, so the four sum to the rate by construction.
 * Indicated stays at Expected: the ground-up pure premium, self-funded.
 */
export function ratePieces(n: NonNullable<FundingConsequence['newStack']>) {
  const purePremium = n.purePremiumRetained * n.clf;
  const rcAndContingency = n.finalRatePer100 - n.reinsRatePer100 - purePremium - n.adminRatePer100;
  return {
    indicated: {
      purePremium: n.purePremiumGroundUp,
      admin: n.adminRatePer100,
      rcAndContingency: n.firstIndicationPer100 - n.purePremiumGroundUp - n.adminRatePer100,
      rate: n.firstIndicationPer100,
    },
    yours: { purePremium, admin: n.adminRatePer100, rcAndContingency, reins: n.reinsRatePer100, rate: n.finalRatePer100 },
  };
}

export interface GameDerivations {
  decisionLine: CoverageLine;
  // ⚠ A UNION, NOT LineResultSet[]. At the pool view these ARE pool rows, and
  // typing them as line rows is what let every consuming page read a per-line
  // placeholder off one. A consumer that needs a line field must now narrow on
  // the view, which is the question that was never being asked.
  viewResults: Array<ResultSet | LineResultSet>;
  /** Min, median and max ending surplus across the worlds, by played year, at the view's scope. */
  surplusRangeByYear: Record<number, SurplusRange>;
  viewPriorResults: Array<ResultSet | LineResultSet>;
  historicalYears: HistoricalYear[];
  lineLoanInfo: Record<CoverageLine, LineLoanInfo>;
  estimatedExpectedLoss: number;
  estimatedAggregateTermsRetained: number | undefined;
  lastLineResult: LineResultSet | undefined;
  decisionLineActiveMembers: Member[];
  /** What the decision line's reinsurance is priced on — its book or roster. */
  decisionLineBook: Book;
  fundingConsequence: FundingConsequence | null;
  /** Underwriting premiums for the decision line's book; null off the book path or before a game. */
  underwriting: UnderwritingFigures | null;
  /** The risk control slider's cost in dollars; null before a game. */
  riskControlCost: number | null;
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

  // THE SPREAD BEHIND THE AVERAGE (loss engine commit 4b): the minimum, median
  // and maximum ending surplus across the worlds, per played year, at this
  // view's scope. Empty on a one-world game.
  const surplusRangeByYear = React.useMemo(() => {
    const out: Record<number, SurplusRange> = {};
    if (!gameState?.worlds) return out;
    for (const r of gameState.lockedResults) {
      const range = surplusRange(gameState, r.yearNumber, lineView === 'pool' ? undefined : lineView);
      if (range) out[r.yearNumber] = range;
    }
    return out;
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
    // With the book's own risk, which its tower's price carries (book units commit 5).
    const risk = lineBookRisk(gameState.instance, decisionLine, gameState.poolState.bookUnits, gameState.poolState.bookLedger);
    return lineState.bookExposure !== undefined
      ? { exposure: lineBookExposure(lineState, decisionLine, gameState.currentYearNumber), ...(risk !== undefined ? { risk } : {}) }
      : decisionLineActiveMembers;
  }, [gameState, decisionLine, decisionLineActiveMembers]);

  const decisionLineFundingLevel = currentDecisions.byLine[decisionLine].fundingConfidenceLevel;
  const decisionLineFundingAtExpected = currentDecisions.byLine[decisionLine].fundingAtExpected;
  const fundingConsequence = React.useMemo(() => {
    if (!gameState) return null;
    const lineState = gameState.poolState.lines[decisionLine];
    // ⚠ ONE BUILDER (fundingConsequenceInput), shared with the Rate Indication
    // on the Actuarial page, so the two price off the same figures. It is the
    // input that stood here, field for field.
    return computeFundingConsequence(
      decisionLineFundingLevel,
      lineState.ratePer100,
      decisionLine,
      decisionLineFundingAtExpected,
      fundingConsequenceInput(gameState, decisionLine, currentDecisions).book,
    );
  }, [gameState, decisionLine, decisionLineFundingLevel, decisionLineFundingAtExpected, currentDecisions]);

  const decisionLineDecisions = currentDecisions.byLine[decisionLine];
  const underwriting = React.useMemo(() => {
    const n = fundingConsequence?.newStack;
    return gameState && n ? underwritingFigures(gameState, decisionLine, decisionLineDecisions, n.finalRatePer100) : null;
  }, [gameState, decisionLine, decisionLineDecisions, fundingConsequence]);
  const riskControlCostFigure = React.useMemo(
    () => (gameState ? riskControlCost(gameState, decisionLine, currentDecisions) : null),
    [gameState, decisionLine, currentDecisions],
  );

  return {
    decisionLine,
    viewResults,
    surplusRangeByYear,
    viewPriorResults,
    historicalYears,
    lineLoanInfo,
    estimatedExpectedLoss,
    estimatedAggregateTermsRetained,
    lastLineResult,
    decisionLineActiveMembers,
    decisionLineBook,
    fundingConsequence,
    underwriting,
    riskControlCost: riskControlCostFigure,
  };
}
