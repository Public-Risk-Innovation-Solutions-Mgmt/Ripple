// ============================================================================
// TEN WORLDS — each team's year, run WORLD_COUNT times (loss engine commit 4b).
//
// A team's year runs in WORLD_COUNT worlds, every team sharing the same worlds'
// draws. EACH WORLD carries its own reserve ledger, cohorts and surplus forward,
// with its own ordinary year factor, shock severities, routine large losses and
// investment returns: a world is the game's instance with its own seed, and
// every per-year draw in the engine is keyed on that seed. World 1 is the
// instance's own seed, so a one-world game is the game as it was.
//
// SHARED ACROSS WORLDS:
//   - the team's decisions;
//   - ONE RATE per team-year, struck from the worlds' AVERAGED history
//     (strikeBookRate on the averaged state) and charged in every world on that
//     world's own exposure;
//   - host-scheduled shocks, which fire in every world, with severity (and
//     region) drawn per world. In singleplayer the catalogue's firings are
//     drawn per world by probability — both fall out of the seed.
//   - the pre-game, which runs once: every world opens on the same position.
// Dividends and assessments are each world's own share of its own surplus —
// the engine computes them inside each world.
//
// DISPLAY: the game's `poolState` and `lockedResults` are the AVERAGE across
// worlds — dollars averaged, every ratio recomputed from the averaged
// numerators and denominators, never averaged. Each world's own results are
// kept in `GameState.worlds`. worlds-check is the gate.
//
// ⚠ CLAIM-LEVEL DETAIL IS PER WORLD ONLY. An averaged row carries no claims or
// occurrences — there is no average claim — and no per-occurrence development.
// Screens that list claims read a world's own rows and say which.
// ============================================================================

import { SHOCK_FREE_PRICING, WORLD_COUNT, newLossEngineRuns } from '../data/pricingParameters';
import { CAPITAL_ADEQUACY_THRESHOLDS } from '../data/defaultAssumptions';
import { exposureFactor } from '../data/exposureTrend';
import { deriveSubRng } from './random';
import { lineBookRisk } from './bookUnits';
import { averageLedgerYear } from './bookUnderwriting';
import {
  aggregateLineResults, applyLoanAuthorizations, fundedNetExpectedLoss, processYear,
  stampPricingTriangle, strikeBookRate,
  type LoanOffer, type ProcessYearResult, type StruckLineRate,
} from './simulationEngine';
import type {
  AccidentYearSplit, CoverageLine, DecisionSet, GameInstance, GameState, InterLineLoan,
  LinePoolState, LineResultSet, PlayedYear, PoolState, RateBasis, ReserveCohort, ReserveDevelopmentRow, ResultSet, WorldState,
} from '../types/simulation';
import type { ShockRecord } from '../types/shocks';
import { rangeOf, summarizeWorlds, type SurplusRange } from './worldAudit';
import { simulateMarketReturns, type MarketReturns } from './investmentEngine';
import { applyMarketShock, gameShocksOn, resolveShockYear, shockTimingOf } from './shockLosses';
export { rangeOf, type SurplusRange };

/** Worlds per team-year for the engine in force: WORLD_COUNT on the new engine, one on the member path. */
export function worldCount(): number {
  return newLossEngineRuns() ? WORLD_COUNT : 1;
}

/** World i's seed. World 0 is the instance's own, so a one-world game is unchanged. */
export function worldSeed(baseSeed: number, i: number): number {
  if (i === 0) return baseSeed;
  return (Math.floor(deriveSubRng(baseSeed, i, 'world').next() * 0x1_0000_0000) >>> 0) || 1;
}

/** World i's instance: the game's, with world i's seed. Everything else is shared. */
export function worldInstance(instance: GameInstance, i: number): GameInstance {
  // The world's own seed for its draws; the game's for its book of units.
  return i === 0 ? instance : { ...instance, seed: worldSeed(instance.seed, i), marketSeed: instance.marketSeed ?? instance.seed };
}

/**
 * A started game, opened into its worlds: every world begins at the shared
 * opening the pre-game built. A one-world game is returned unchanged.
 */
export function openWorlds(gs: GameState): GameState {
  const n = worldCount();
  if (n <= 1) return gs;
  const opening = withoutBook(gs.poolState);
  return {
    ...gs,
    worlds: Array.from({ length: n }, () => ({ poolState: opening, lockedResults: gs.lockedResults })),
  };
}

// ⚠ THE BOOK OF UNITS IS THE GAME'S, NOT A WORLD'S. Every world holds the same
// book (underwriting is shared; only loss draws differ), so it is kept once, on
// the game's pool state (PoolState.bookUnits): a world's state never carries a
// copy, and the averaged state takes the game's, not world 1's.
// The underwriting ledger (PoolState.bookLedger) travels with it, the same way.
function withBook(ps: PoolState, game: PoolState): PoolState {
  if (game.bookUnits === undefined) return ps;
  return { ...ps, bookUnits: game.bookUnits, ...(game.bookLedger ? { bookLedger: game.bookLedger } : {}) };
}
function withoutBook(ps: PoolState): PoolState {
  if (ps.bookUnits === undefined && ps.bookLedger === undefined) return ps;
  const { bookUnits: _book, bookLedger: _ledger, ...rest } = ps;
  void _book; void _ledger;
  return rest;
}

// ----------------------------------------------------------------------------
// THE YEAR
// ----------------------------------------------------------------------------

export interface WorldsYear {
  /** The shock-free shadow's year, played alongside (SHOCK_FREE_PRICING). */
  shadow?: { state: GameState; played: WorldsYear };
  /** Each world's processed year, in world order. One entry on a one-world game. */
  perWorld: ProcessYearResult[];
  /** The one rate per line, struck from the averaged history. Absent on one world. */
  struckRates?: Partial<Record<CoverageLine, StruckLineRate>>;
  /**
   * One offer per line that needs a loan in ANY world: its deficit the mean over
   * the worlds that need it, with how many do. The decision to authorize is the
   * team's, and so is shared: it applies in every world that needs the loan.
   */
  loanOffers: LoanOffer[];
  /** The decisions the year was played on — carried to the save's played years. */
  decisions: DecisionSet;
}

/**
 * THE LINE STATE A PURE PREMIUM IS STRUCK FROM (SHOCK_FREE_PRICING): the game's
 * own, with its ledger swapped for the shock-free shadow's once there is one —
 * the experience as it would stand had no shock fired. Every reader of the
 * pure premium (the struck rate, the Decisions panel, the Model tab) reads this.
 */
export function pricingLineState(gs: GameState, line: CoverageLine): LinePoolState {
  const own = gs.poolState.lines[line];
  const shadow = SHOCK_FREE_PRICING.enabled ? gs.pricingShadow?.poolState.lines[line] : undefined;
  return shadow ? { ...own, reserveDevelopment: shadow.reserveDevelopment } : own;
}

/** Does this year need the shadow — is a shock in force and is there none yet? */
function shadowStartsNow(gs: GameState): boolean {
  if (!SHOCK_FREE_PRICING.enabled || !newLossEngineRuns() || gs.instance.shockFree || gs.pricingShadow) return false;
  return resolveShockYear(gs.instance, shockTimingOf(gs.setup), gs.currentYearNumber).inForce.length > 0;
}

/** The rate each active line charges this team-year, struck on the averaged state. */
export function strikeRates(gs: GameState, decisions: DecisionSet): Partial<Record<CoverageLine, StruckLineRate>> {
  const out: Partial<Record<CoverageLine, StruckLineRate>> = {};
  for (const line of gs.setup.activeLines) {
    const struck = strikeBookRate(line, pricingLineState(gs, line), decisions.byLine[line], gs.currentYearNumber, {
      allMarketMembers: gs.poolState.allMarketMembers,
      membershipHistory: gs.poolState.membershipHistory,
    }, lineBookRisk(gs.instance, line, gs.poolState.bookUnits, gs.poolState.bookLedger), gameShocksOn(gs.setup, gs.instance));
    if (struck) out[line] = struck;
  }
  return out;
}

/** Run the year in every world. Nothing is committed — see settleWorldsYear. */
export function playWorldsYear(gs: GameState, decisions: DecisionSet): WorldsYear {
  // THE SHOCK-FREE SHADOW (SHOCK_FREE_PRICING), played beside the game with the
  // same decisions: from the first year a shock is in force it is this game with
  // nothing firing, and the pure premium is struck from its ledger. Before then
  // the game is its own shadow.
  const shadowState = gs.pricingShadow
    ?? (shadowStartsNow(gs) ? { ...gs, instance: { ...gs.instance, shockFree: true as const }, pricingShadow: undefined } : undefined);
  const shadow = shadowState ? { state: shadowState, played: playWorldsYear(shadowState, decisions) } : undefined;
  if (!gs.worlds) {
    const p = processYear(gs, decisions);
    return { perWorld: [p], loanOffers: p.loanOffers, decisions, ...(shadow ? { shadow } : {}) };
  }
  const struckRates = strikeRates(gs, decisions);
  // The game's book reaches every world for the year (withBook); it is never
  // stored on a world's state (settleWorldsYear strips it).
  // ⚠ A WORLD'S PAST IS THE AVERAGED ROWS WITH ITS OWN LAST ONE (commit 10).
  // The engine reads the previous row's figures — the world's own — and, from
  // the rows before it, only the pool-wide decisions, which every world shares
  // with the average. So a world need keep no row but its last.
  const perWorld = gs.worlds.map((w, i) => processYear(
    { ...gs, instance: worldInstance(gs.instance, i), poolState: withBook(w.poolState, gs.poolState),
      lockedResults: worldPast(gs.lockedResults, w.lockedResults) },
    decisions,
    { struckRates },
  ));
  return { perWorld, struckRates, loanOffers: mergeLoanOffers(perWorld), decisions, ...(shadow ? { shadow } : {}) };
}

/**
 * World i's market this year, as the engine drew it: its own seed's draw, with
 * the year's Investment Loss on each asset class (simulationEngine).
 */
function worldMarket(gs: GameState, i: number): MarketReturns {
  const inst = worldInstance(gs.instance, i);
  const drawn = simulateMarketReturns(deriveSubRng(inst.seed, gs.currentYearNumber, 'invest'));
  return applyMarketShock(drawn, resolveShockYear(inst, shockTimingOf(gs.setup), gs.currentYearNumber).marketShock);
}

/** A world's played years as the engine reads them: the averaged rows, the last one the world's own. */
function worldPast(averaged: ResultSet[], own: ResultSet[]): ResultSet[] {
  const last = own[own.length - 1];
  return last ? [...averaged.slice(0, -1), last] : averaged;
}

function mergeLoanOffers(perWorld: ProcessYearResult[]): LoanOffer[] {
  const byLine = new Map<CoverageLine, LoanOffer[]>();
  for (const p of perWorld) for (const o of p.loanOffers) byLine.set(o.line, [...(byLine.get(o.line) ?? []), o]);
  return [...byLine.entries()].map(([line, offers]) => ({
    ...offers[0],
    line,
    deficit: offers.reduce((s, o) => s + o.deficit, 0) / offers.length,
    worlds: { needing: offers.length, of: perWorld.length },
  }));
}

export interface SettledYear {
  /** The shock-free shadow's year, settled on the same loan choices (SHOCK_FREE_PRICING). */
  shadow?: { state: GameState; settled: SettledYear };
  /** The averaged pool state — or the one world's, on a one-world game. */
  poolState: PoolState;
  /** The averaged result — or the one world's. */
  result: ResultSet;
  /** Each world's state after the year. Absent on a one-world game. */
  worlds?: WorldState[];
  /** The year as played — its decisions and the lines authorized a loan. */
  played: PlayedYear;
}

/**
 * Commit the year: settle each world's loans on the team's one decision, then
 * average. `authorizedLines` applies in every world whose line needs the loan.
 */
export function settleWorldsYear(gs: GameState, played_: WorldsYear, authorizedLines: CoverageLine[]): SettledYear {
  const settled = played_.perWorld.map(p => p.loanOffers.length > 0
    ? applyLoanAuthorizations(p, gs.currentYearNumber,
      authorizedLines.filter(l => p.loanOffers.some(o => o.line === l)))
    : { updatedPoolState: p.updatedPoolState, result: p.result });
  const played: PlayedYear = { yearNumber: gs.currentYearNumber, decisions: played_.decisions, authorizedLines: [...authorizedLines] };
  // The shadow takes the team's loan choices wherever its own worlds need them.
  const shadow = played_.shadow
    ? { state: played_.shadow.state, settled: settleWorldsYear(played_.shadow.state, played_.shadow.played, authorizedLines) }
    : undefined;
  if (!gs.worlds) return { poolState: settled[0].updatedPoolState, result: settled[0].result, played, ...(shadow ? { shadow } : {}) };

  // ⚠ EACH WORLD KEEPS ONLY THIS YEAR'S ROW; WORLD 1 KEEPS ALL OF ITS OWN, for
  // its claims (the claims download). What the screens read of the worlds is
  // struck below onto the averaged row, while every world's row is in hand.
  const worlds: WorldState[] = gs.worlds.map((w, i) => ({
    poolState: withoutBook(settled[i].updatedPoolState),
    lockedResults: i === 0 ? [...w.lockedResults, settled[i].result] : [settled[i].result],
    closedCohorts: archiveClosedCohorts(w, settled[i].updatedPoolState, gs.setup.activeLines),
  }));
  const prior = gs.lockedResults[gs.lockedResults.length - 1] ?? gs.priorHistory[gs.priorHistory.length - 1];
  const result = withRateBasis({
    ...averageResultSets(settled.map(s => s.result), gs.setup.activeLines, prior, gs.worlds.map(w => w.poolState)),
    worldSummary: summarizeWorlds(settled.map(s => s.result), gs.setup.activeLines, i => worldMarket(gs, i)),
  }, played_.struckRates);
  const averaged = averagePoolStates(worlds, gs.setup.activeLines, gs.currentYearNumber);
  // The book as underwriting left it — the same in every world (it reads only
  // the game's seed and the team's decision), so world 1's is the game's.
  const moved = settled[0].updatedPoolState.bookUnits ?? gs.poolState.bookUnits;
  // ⚠ ITS LEDGER IS THE WORLDS' AVERAGE: shares and joins are the same in every
  // world, and each world's record of this year is averaged across them
  // (averageLedgerYear), so next year's renewals rank one history.
  const ledgers = settled.map(s => s.updatedPoolState.bookLedger);
  const bookLedger = ledgers[0] ? Object.fromEntries(Object.keys(ledgers[0]).map(l => [l,
    averageLedgerYear(ledgers.map(x => x![l as CoverageLine]!), gs.currentYearNumber)])) as PoolState['bookLedger'] : undefined;
  const poolState = moved ? { ...averaged, bookUnits: moved, ...(bookLedger ? { bookLedger } : {}) } : averaged;
  return { poolState, result, worlds, played, ...(shadow ? { shadow } : {}) };
}

/**
 * Each line's rebuild basis for the Rate Indication (the row's rateBasis), read
 * off the rate the year was struck at. Nothing the engine computed is changed,
 * and nothing else is stored.
 */
function withRateBasis(result: ResultSet, struck: WorldsYear['struckRates']): ResultSet {
  if (!struck) return result;
  const byLine = { ...result.byLine };
  for (const [line, s] of Object.entries(struck) as [CoverageLine, StruckLineRate | undefined][]) {
    const row = byLine[line];
    if (!row || !s) continue;
    const pts = s.newPp.points;
    const rateBasis: RateBasis = {
      ...(s.bookRisk !== undefined ? { risk: s.bookRisk } : {}),
      windowYears: pts.length,
      windowExposure: pts.length > 0 ? pts.reduce((a, p) => a + p.exposure, 0) / pts.length : 0,
      ...(pts.length > 0 ? { latestExposure: pts[pts.length - 1].exposure } : {}),
      pricedExposure: s.exposure,
    };
    byLine[line] = { ...row, rateBasis };
  }
  return { ...result, byLine };
}

/** The game after a settled year: the averaged state, the worlds, the year appended. */
export function commitSettledYear(
  gs: GameState, s: SettledYear,
): Pick<GameState, 'poolState' | 'lockedResults' | 'worlds' | 'playedYears' | 'pricingShadow'> {
  const shadow = s.shadow
    ? { ...s.shadow.state, ...commitSettledYear(s.shadow.state, s.shadow.settled), currentYearNumber: s.shadow.state.currentYearNumber + 1 }
    : gs.pricingShadow;
  return {
    poolState: s.poolState,
    lockedResults: [...gs.lockedResults, s.result],
    ...(s.worlds ? { worlds: s.worlds } : {}),
    playedYears: [...(gs.playedYears ?? []), s.played],
    ...(shadow ? { pricingShadow: shadow } : {}),
  };
}

// ----------------------------------------------------------------------------
// THE SPREAD — what the average hides, kept beside it
// ----------------------------------------------------------------------------

/**
 * Minimum, median and maximum ending surplus across the worlds for a played
 * year (pool scope, or one line) — as the year's averaged row recorded it when
 * it settled (ResultSet.worldSummary). Null on a one-world game or an unplayed
 * year.
 */
export function surplusRange(gs: GameState, yearNumber: number, line?: CoverageLine): SurplusRange | null {
  const r = gs.lockedResults.find(x => x.yearNumber === yearNumber);
  return r?.worldSummary?.surplusRange[line ?? 'pool'] ?? null;
}

// ----------------------------------------------------------------------------
// AVERAGING A RESULT
// ----------------------------------------------------------------------------

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * THE LINE RATIOS, FROM THEIR PARTS — the engine's own formulas (processLineYear),
 * restated so an averaged row can recompute them from averaged dollars.
 * worlds-check asserts this reproduces every world row's own ratios exactly, so
 * a formula changed in the engine and not here fails the gate.
 */
export function deriveLineRatios(r: Pick<LineResultSet,
  'poolPremium' | 'selectedFundingCLF' | 'poolPremiumAndAdminExpense' | 'totalMemberCharge' | 'adminExpense' | 'operatingExpense'
  | 'reinsuranceCost' | 'netIncurredLoss' | 'poolLayerLoss' | 'reserveRiskMarginNeeded' | 'excessAvailableSurplus'
  | 'activeExposure' | 'totalMarketExposure' | 'laeIncurred'> & { bookedGrossUltimate?: number; grossUltimateLoss: number }) {
  const funded = fundedNetExpectedLoss({ poolPremium: r.poolPremium, selectedFundingCLF: r.selectedFundingCLF });
  const expectedLossRatio = funded / Math.max(r.poolPremiumAndAdminExpense, 1);
  const expectedLossRatioMemberBasis = funded / Math.max(r.totalMemberCharge, 1);
  const expectedExpenseRatio = (r.adminExpense + r.reinsuranceCost) / Math.max(r.totalMemberCharge, 1);
  const actualLossRatio = r.netIncurredLoss / Math.max(r.totalMemberCharge, 1);
  // The admin BOOKED, with the year's overrun (ADMIN_OVERRUN_RANGE); expected is the admin priced.
  const actualExpenseRatio = (r.operatingExpense + r.reinsuranceCost) / Math.max(r.totalMemberCharge, 1);
  const actualLaeRatio = r.laeIncurred / Math.max(r.totalMemberCharge, 1);
  const actualCombinedRatio = actualLossRatio + actualLaeRatio + actualExpenseRatio;
  const excessCapitalRatio = r.reserveRiskMarginNeeded > 0
    ? r.excessAvailableSurplus / r.reserveRiskMarginNeeded
    : null;
  return {
    expectedLossRatio,
    expectedLossRatioMemberBasis,
    expectedExpenseRatio,
    expectedCombinedRatio: expectedLossRatioMemberBasis + expectedExpenseRatio,
    actualLossRatio,
    actualLossRatioPricingBasis: r.netIncurredLoss / Math.max(r.poolPremiumAndAdminExpense, 1),
    actualLossRatioRetainedPremium: r.netIncurredLoss / Math.max(r.poolPremium, 1),
    actualExpenseRatio,
    actualLaeRatio,
    actualCombinedRatio,
    combinedRatio: actualCombinedRatio,
    lossRatio: actualLossRatio,
    expenseRatio: actualExpenseRatio,
    poolLayerLossRatio: r.poolLayerLoss / Math.max(r.poolPremiumAndAdminExpense, 1),
    totalLossRatioGross: (r.bookedGrossUltimate ?? r.grossUltimateLoss) / Math.max(r.totalMemberCharge, 1),
    excessCapitalRatio,
    capitalAdequacyRatio: excessCapitalRatio,
    capitalAdequacyStatus: capitalStatus(excessCapitalRatio),
    // Stored at four places, as the engine stores it.
    marketShare: parseFloat((r.activeExposure / Math.max(r.totalMarketExposure, 0.01)).toFixed(4)),
  };
}

/** The ratio fields deriveLineRatios recomputes — never averaged. */
export const LINE_RATIO_FIELDS = [
  'expectedLossRatio', 'expectedLossRatioMemberBasis', 'expectedExpenseRatio', 'expectedCombinedRatio',
  'actualLossRatio', 'actualLossRatioPricingBasis', 'actualLossRatioRetainedPremium', 'actualExpenseRatio',
  'actualLaeRatio', 'actualCombinedRatio', 'combinedRatio', 'lossRatio', 'expenseRatio', 'poolLayerLossRatio',
  'totalLossRatioGross', 'excessCapitalRatio', 'capitalAdequacyRatio', 'capitalAdequacyStatus', 'marketShare',
] as const;

function capitalStatus(ratio: number | null): string {
  return ratio === null ? 'N/A'
    : ratio >= CAPITAL_ADEQUACY_THRESHOLDS.strong ? 'Strong'
    : ratio >= CAPITAL_ADEQUACY_THRESHOLDS.adequate ? 'Adequate'
    : ratio >= CAPITAL_ADEQUACY_THRESHOLDS.thin ? 'Thin'
    : 'Deficient';
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * One line's year, averaged across worlds. `startBooks` is each world's book
 * exposure at the start of the year, which weights the retention rate.
 *
 * THE RULE, FIELD BY FIELD:
 *   identical in every world   kept exactly (decisions, the struck rate, ...)
 *   a ratio                    recomputed from the averaged parts (deriveLineRatios,
 *                              and the three below with their own weights)
 *   any other number           the mean across worlds — dollars, exposure, counts
 *   claim-level detail         absent (claims, occurrences, the value scoreboard,
 *                              the new engine's per-firing record)
 *   the year's events          merged, dollars averaged over all worlds, with the
 *                              number of worlds each fired in
 * Anything else that differs between worlds throws, so a new field cannot be
 * silently taken from one world.
 */
export function averageLineResults(rs: LineResultSet[], startBooks?: number[]): LineResultSet {
  const n = rs.length;
  const out: Record<string, unknown> = {};
  const keys = new Set<string>();
  for (const r of rs) for (const k of Object.keys(r)) keys.add(k);
  for (const key of keys) {
    const vals = rs.map(r => (r as unknown as Record<string, unknown>)[key]);
    if (PER_WORLD_ONLY.has(key)) continue;
    // Recomputed from the averaged parts below — never averaged.
    if ((LINE_RATIO_FIELDS as readonly string[]).includes(key)) { out[key] = vals[0]; continue; }
    if (key === 'shockEvents') { const m = averageShockEvents(rs.map(r => r.shockEvents), n); if (m) out[key] = m; continue; }
    if (key === 'dividendBlocked') { out[key] = rs.some(r => r.dividendBlocked); continue; }
    if (vals.every(v => same(v, vals[0]))) { out[key] = vals[0]; continue; }
    if (key === 'cededByLayer') { out[key] = elementwiseMean(rs.map(r => r.cededByLayer)); continue; }
    if (key === 'reserveSplitByYear') { out[key] = averageSplitRows(rs.map(r => r.reserveSplitByYear)); continue; }
    if (vals.every(v => typeof v === 'number' || v === undefined || v === null)) {
      out[key] = mean(vals.map(v => (typeof v === 'number' ? v : 0)));
      continue;
    }
    throw new Error(`averageLineResults: '${key}' differs across worlds and has no averaging rule`);
  }
  const avg = out as unknown as LineResultSet;
  Object.assign(avg, deriveLineRatios(avg));
  // Reserve-weighted, as the pool's own: next year's payment over the reserve.
  const res = rs.reduce((s, r) => s + r.endingNetReserve, 0);
  avg.nextYearPaydownRate = res > 0
    ? rs.reduce((s, r) => s + r.endingNetReserve * r.nextYearPaydownRate, 0) / res
    : rs[0].nextYearPaydownRate;
  // Income over the assets it was earned on.
  if (avg.investedAssets > 0) avg.investmentReturnRate = avg.investmentIncome / avg.investedAssets;
  // Retained book over the book at the start of the year, each world's weighted
  // by its own start — the ratio of the averaged parts.
  if (startBooks && startBooks.some(b => b > 0)) {
    const w = startBooks.reduce((a, b) => a + b, 0);
    avg.memberRetentionRate = parseFloat(
      (rs.reduce((s, r, i) => s + r.memberRetentionRate * startBooks[i], 0) / w).toFixed(3));
  }
  // The loss rate is read back off expected loss, as the engine reads it.
  if (avg.activeExposure > 0 && typeof avg.lossPurePremiumPer100 === 'number'
    && !rs.every(r => r.lossPurePremiumPer100 === rs[0].lossPurePremiumPer100)) {
    avg.lossPurePremiumPer100 = parseFloat((avg.expectedLoss / (avg.activeExposure * 10_000)).toFixed(4));
  }
  return avg;
}

/** Claim-level and per-world records an averaged row does not carry. */
const PER_WORLD_ONLY = new Set([
  'claims', 'occurrences', 'drawnCatastrophes', 'newLossEngine', 'poolValue', 'memberValueRows',
]);

function elementwiseMean(arrs: number[][]): number[] {
  const width = Math.max(0, ...arrs.map(a => a.length));
  return Array.from({ length: width }, (_, i) => mean(arrs.map(a => a[i] ?? 0)));
}

/** By accident year: dollars averaged over all worlds, an absent year counting zero. */
function averageSplitRows(perWorld: AccidentYearSplit[][]): AccidentYearSplit[] {
  const n = perWorld.length;
  const byAy = new Map<number, AccidentYearSplit[]>();
  for (const rows of perWorld) for (const r of rows) byAy.set(r.yearNumber, [...(byAy.get(r.yearNumber) ?? []), r]);
  return [...byAy.keys()].sort((a, b) => a - b).map(ay => {
    const rows = byAy.get(ay)!;
    const first = rows[0];
    const out = { ...first } as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(first)) {
      if (typeof v !== 'number' || k === 'yearNumber' || k === 'calendarYear' || k === 'ageMonths') continue;
      out[k] = rows.reduce((s, r) => s + ((r as unknown as Record<string, number>)[k] ?? 0), 0) / n;
    }
    return out as unknown as AccidentYearSplit;
  });
}

/** One row per event: dollars and claim counts averaged over ALL worlds, with the count it fired in. */
export function averageShockEvents(perWorld: (ShockRecord[] | undefined)[], n: number): ShockRecord[] | undefined {
  const merged = new Map<string, { rec: ShockRecord; fired: number; region: string | undefined; regionSame: boolean }>();
  for (const recs of perWorld) {
    for (const rec of recs ?? []) {
      const key = `${rec.shockId}|${rec.yearFired}`;
      const m = merged.get(key);
      if (!m) {
        merged.set(key, {
          rec: {
            ...rec,
            attributableGrossLoss: rec.attributableGrossLoss / n,
            attributableClaims: rec.attributableClaims / n,
            expectedGrossLossAdded: rec.expectedGrossLossAdded / n,
            ...(rec.byLine ? { byLine: Object.fromEntries(Object.entries(rec.byLine).map(([l, c]) => [l, {
              attributableGrossLoss: c!.attributableGrossLoss / n,
              attributableClaims: c!.attributableClaims / n,
              expectedGrossLossAdded: c!.expectedGrossLossAdded / n,
            }])) } : {}),
          },
          fired: 1, region: rec.region, regionSame: true,
        });
        continue;
      }
      m.fired++;
      if (m.region !== rec.region) m.regionSame = false;
      m.rec.attributableGrossLoss += rec.attributableGrossLoss / n;
      m.rec.attributableClaims += rec.attributableClaims / n;
      m.rec.expectedGrossLossAdded += rec.expectedGrossLossAdded / n;
      for (const [l, c] of Object.entries(rec.byLine ?? {})) {
        const b = (m.rec.byLine ??= {});
        const t = b[l as CoverageLine] ?? { attributableGrossLoss: 0, attributableClaims: 0, expectedGrossLossAdded: 0 };
        b[l as CoverageLine] = {
          attributableGrossLoss: t.attributableGrossLoss + c!.attributableGrossLoss / n,
          attributableClaims: t.attributableClaims + c!.attributableClaims / n,
          expectedGrossLossAdded: t.expectedGrossLossAdded + c!.expectedGrossLossAdded / n,
        };
      }
    }
  }
  if (merged.size === 0) return undefined;
  return [...merged.values()].map(({ rec, fired, regionSame }) => {
    const out: ShockRecord = { ...rec, worlds: { fired, of: n } };
    // A region drawn per world is not one region: dropped when the worlds differ.
    if (!regionSame) delete out.region;
    return out;
  });
}

/**
 * The year averaged across worlds, pool row and all: each line averaged, then
 * the pool row built from the averaged lines by the engine's own aggregation —
 * sums of averaged dollars, which are the averages of the pool's sums, and
 * every pool ratio recomputed from them.
 */
export function averageResultSets(
  rs: ResultSet[], lines: CoverageLine[], prior: ResultSet | undefined, startStates?: PoolState[],
): ResultSet {
  const lineResults = lines.map(line => ({
    line,
    result: averageLineResults(rs.map(r => r.byLine[line]), startStates?.map(s =>
      (s.lines[line]?.bookExposure ?? 0) * exposureFactor(line, rs[0].yearNumber))),
  }));
  return aggregateLineResults(lineResults, prior);
}

// ----------------------------------------------------------------------------
// AVERAGING THE STATE — what the pages read, and what the next rate is struck on
// ----------------------------------------------------------------------------

/**
 * Each world's cohorts that closed and left its state this year, kept at their
 * final values (without per-occurrence detail) so an averaged cohort can count
 * them. Carried on the world.
 */
function archiveClosedCohorts(
  before: WorldState, after: PoolState, lines: CoverageLine[],
): WorldState['closedCohorts'] {
  const out: NonNullable<WorldState['closedCohorts']> = { ...(before.closedCohorts ?? {}) };
  for (const line of lines) {
    const now = new Set((after.lines[line]?.reserveCohorts ?? []).map(c => c.yearNumber));
    const gone = (before.poolState.lines[line]?.reserveCohorts ?? []).filter(c => !now.has(c.yearNumber));
    if (gone.length === 0) continue;
    out[line] = [...(out[line] ?? []), ...gone.map(c => ({
      ...c, closed: true, developingClaims: undefined, developmentBench: undefined,
    }))];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The averaged state. Dollars averaged; the ledger averaged accident year by
 * accident year (a closed year carries its last valuation); cohorts averaged
 * the same way, a world whose cohort has closed counting its final values; the
 * pricing triangle stamped from the averaged ledger by the engine's own code.
 */
export function averagePoolStates(worlds: WorldState[], lines: CoverageLine[], yearNumber: number): PoolState {
  const states = worlds.map(w => w.poolState);
  const first = states[0];
  const avgLines = {} as Record<CoverageLine, LinePoolState>;
  for (const line of Object.keys(first.lines) as CoverageLine[]) {
    const ls = states.map(s => s.lines[line]);
    if (!lines.includes(line) || ls.every(l => same(l, ls[0]))) { avgLines[line] = ls[0]; continue; }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(ls[0])) {
      const vals = ls.map(l => (l as unknown as Record<string, unknown>)[key]);
      if (key === 'reserveDevelopment') { out[key] = averageLedger(ls.map(l => l.reserveDevelopment ?? [])); continue; }
      if (key === 'reserveCohorts') { out[key] = averageCohorts(worlds, line); continue; }
      if (key === 'pricingTriangle') continue;   // restamped below
      if (vals.every(v => same(v, vals[0]))) { out[key] = vals[0]; continue; }
      if (vals.every(v => typeof v === 'number' || v === undefined)) {
        out[key] = mean(vals.map(v => (typeof v === 'number' ? v : 0)));
        continue;
      }
      throw new Error(`averagePoolStates: '${line}.${key}' differs across worlds and has no averaging rule`);
    }
    avgLines[line] = stampPricingTriangle(line, out as unknown as LinePoolState,
      first.allMarketMembers, first.membershipHistory);
  }
  return {
    ...first,
    cash: mean(states.map(s => s.cash)),
    unearnedPremium: mean(states.map(s => s.unearnedPremium)),
    lines: avgLines,
    interLineLoans: averageLoans(states, yearNumber),
  };
}

/**
 * By accident year, valuation by valuation; a year whose row stopped growing
 * carries its last valuation. The ultimate, the net paid and the gross paid
 * series are each averaged.
 *
 * ⚠ THE PAID SERIES WERE WORLD 1'S UNTIL THE RESULTS PAGE (it spread `present[0]`
 * and averaged only the ultimates), so an averaged ledger's paid-to-date was one
 * world's. worlds-check now compares each series against the worlds' own mean.
 */
export function averageLedger(perWorld: ReserveDevelopmentRow[][]): ReserveDevelopmentRow[] {
  const n = perWorld.length;
  const ays = [...new Set(perWorld.flatMap(rows => rows.map(r => r.yearNumber)))].sort((a, b) => a - b);
  type Series = 'ultimateByValuation' | 'paidByValuation' | 'grossPaidByValuation';
  return ays.map(ay => {
    const rows = perWorld.map(w => w.find(r => r.yearNumber === ay));
    const present = rows.filter((r): r is ReserveDevelopmentRow => r !== undefined);
    const mean = (key: Series): number[] | undefined => {
      if (present.some(r => r[key] === undefined)) return undefined;
      const width = Math.max(...present.map(r => r[key]!.length));
      const at = (r: ReserveDevelopmentRow | undefined, k: number) => {
        const a = r?.[key];
        return a && a.length > 0 ? a[Math.min(k, a.length - 1)] : 0;
      };
      return Array.from({ length: width }, (_, k) => rows.reduce((s, r) => s + at(r, k), 0) / n);
    };
    const exposures = rows.map(r => r?.exposure);
    const paid = mean('paidByValuation');
    const grossPaid = mean('grossPaidByValuation');
    const out: ReserveDevelopmentRow = {
      ...present[0],
      ...(exposures.some(e => e !== undefined)
        ? { exposure: exposures.reduce<number>((s, e) => s + (e ?? 0), 0) / n } : {}),
      ultimateByValuation: mean('ultimateByValuation')!,
    };
    if (paid) out.paidByValuation = paid; else delete out.paidByValuation;
    if (grossPaid) out.grossPaidByValuation = grossPaid; else delete out.grossPaidByValuation;
    // The worlds' mean shock dollars, a world with none counting 0 (commit 7).
    const shock = rows.reduce((s, r) => s + (r?.shockGross ?? 0), 0) / n;
    if (shock > 0) out.shockGross = shock; else delete out.shockGross;
    return out;
  });
}

const COHORT_ZERO_WHEN_CLOSED = new Set(['netUnpaid', 'grossUnpaid', 'registerSum']);

function averageCohorts(worlds: WorldState[], line: CoverageLine): ReserveCohort[] {
  const n = worlds.length;
  const open = worlds.map(w => w.poolState.lines[line]?.reserveCohorts ?? []);
  const ays = [...new Set(open.flatMap(cs => cs.map(c => c.yearNumber)))].sort((a, b) => a - b);
  return ays.map(ay => {
    const each = worlds.map((w, i) => open[i].find(c => c.yearNumber === ay)
      ?? w.closedCohorts?.[line]?.find(c => c.yearNumber === ay));
    const present = each.filter((c): c is ReserveCohort => c !== undefined);
    const base = present[0];
    const out: Record<string, unknown> = {
      ...base,
      closed: each.every(c => c === undefined || c.closed),
      developingClaims: undefined,
      developmentBench: undefined,
    };
    for (const [k, v] of Object.entries(base)) {
      if (typeof v !== 'number' || k === 'yearNumber' || k === 'calendarYear') continue;
      const vals = each.map(c => {
        if (!c) return 0;
        const x = (c as unknown as Record<string, number | undefined>)[k];
        return c.closed && COHORT_ZERO_WHEN_CLOSED.has(k) ? 0 : x ?? 0;
      });
      out[k] = vals.every(x => x === vals[0]) ? vals[0] : vals.reduce((a, b) => a + b, 0) / n;
    }
    // Gross figures only where every world has both halves — the cohort views' rule.
    if (each.some(c => !c || c.grossPaid === undefined || c.grossUnpaid === undefined)) {
      delete out.grossPaid; delete out.grossUnpaid;
    }
    return out as unknown as ReserveCohort;
  });
}

/** One loan per borrowing line: balances averaged over all worlds, rates weighted by balance. */
function averageLoans(states: PoolState[], yearNumber: number): InterLineLoan[] {
  if (states.every(s => same(s.interLineLoans, states[0].interLineLoans))) return states[0].interLineLoans;
  const n = states.length;
  const byLine = new Map<CoverageLine, InterLineLoan[]>();
  for (const s of states) for (const l of s.interLineLoans) byLine.set(l.borrowingLine, [...(byLine.get(l.borrowingLine) ?? []), l]);
  return [...byLine.entries()].map(([line, loans]) => {
    const bal = loans.reduce((s, l) => s + l.remainingBalance, 0);
    const principal = loans.reduce((s, l) => s + l.principal, 0);
    const shares: Partial<Record<CoverageLine, number>> = {};
    for (const l of loans) for (const [lender, sh] of Object.entries(l.lenderShares)) {
      shares[lender as CoverageLine] = (shares[lender as CoverageLine] ?? 0) + (sh ?? 0) * l.principal / Math.max(principal, 1e-9);
    }
    return {
      borrowingLine: line,
      principal: principal / n,
      remainingBalance: bal / n,
      currentRate: bal > 0 ? loans.reduce((s, l) => s + l.currentRate * l.remainingBalance, 0) / bal : loans[0].currentRate,
      yearOriginated: Math.min(yearNumber, ...loans.map(l => l.yearOriginated)),
      lenderShares: shares,
    };
  });
}
