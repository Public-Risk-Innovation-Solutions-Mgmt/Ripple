// Stage 2.10 + seed-fix-per-line-opening — per-line prior histories.
//
// Each active line gets a REAL simulated 3-year pre-game past (yearNumbers -2,
// -1, 0) produced by the same engine as live years, at default decisions —
// preceded by MATURATION_YEARS further simulated years that are NOT part of the
// declared past and exist only to leave a ten-accident-year book behind. See
// MATURATION_YEARS for why. Surplus is not re-pinned anywhere inside it: the
// line starts from STARTING_CAPITAL, funded at the prior board's margin — set
// on the scenario's DESIGNED history (PRE_GAME_MARGIN_ON_DESIGN), so the
// opening falls where the played history takes it — and moves only by its own
// income from there. Each
// line is simulated IN ISOLATION (a single-line pre-game), so its history is
// config-independent: WC's pre-game is byte-identical whether the game is
// WC-only, WC+GL, or WC+GL+Property. There is no shared roster fold and no
// pool-wide reseed across lines during the pre-game. The per-line ending states
// are then assembled into the Year 1 opening pool; live years (Y1+) resume the
// normal multi-line shared-cash fold, which reproduces each line's stored
// surplus (so tie-out holds with cash still pooled).
//
// Seeding: every engine draw is deriveSubRng(seed, yearNumber, label), a pure
// stateless function; each line's streams are label-keyed to that line, so a
// line at attempt 0 uses the true instance seed and is unaffected by whether
// other lines exist or needed a redraw.
//
// Opening band (PER-LINE reject-and-redraw, NO clamping): each active line
// must end its pre-game with opening surplus inside that line's own
// OPENING_SURPLUS_BAND — [min, max] × its own opening POOL PREMIUM on a
// 'premium' line, or × its own opening NET RESERVE on a 'reserve' line
// (two-sided: too weak AND too strong both redraw). If a line lands outside,
// ONLY that line re-simulates on a deterministically derived alternate seed
// (seed + attempt * 997) until it lands in-band — one line's redraw never
// reseeds another. Deterministic: same seed -> same per-line redraw path
// -> same history, every config. The accepted history is real and ties out.

import { exposureFactor } from '../data/exposureTrend';
import type {
  BookLedger,
  CoverageLine,
  DecisionSet,
  GameInstance,
  GameSetupSettings,
  GameState,
  HistoricalYear,
  LineResultSet,
  LinePoolState,
  Member,
  MembershipHistory,
  MemberLossHistory,
  PoolState,
  ResultSet,
  StartingFinancials,
} from '../types/simulation';
import { generateStartingPoolState } from './instanceGenerator';
import { marketSeedOf, openingBookUnits } from './bookUnits';
import { getPredefinedMarketMembers } from '../data/memberCatalog';
import { OPENING_SURPLUS_BAND } from '../data/defaultAssumptions';
import { processYear, aggregateLineResults, strikeBookRate } from './simulationEngine';
import { scenarioOf } from './scenarios';
import { gameShocksOn } from './shockLosses';
import { lineBookRisk } from './bookUnits';
import {
  satisfactionAnchor, memberLossStanding, surplusBandOf, SATISFACTION,
} from './memberSatisfaction';
import { marketLevelGapPct } from './marketConditions';
import { OPENING_SATISFACTION } from '../data/memberCatalog';
import { emptyLinePoolState } from './lineHelpers';
import { lossExpenseReserve } from './lossExpense';
import {
  FLAT_PRE_GAME, MEMBER_LEVEL, OPENING_PREMIUM_TO_SURPLUS_BOUNDS, PRE_GAME_MARGIN_FLOOR, PRE_GAME_MARGIN_ON_DESIGN,
  PRIOR_DEVELOPMENT_DEFAULTS,
  PRIOR_HISTORY_YEARS, SCENARIO_PREMIUM_TO_SURPLUS, STARTING_CAPITAL,
} from '../data/pricingParameters';
import { preGameAllocation } from './investmentEngine';
import { confidenceAtClf, hasStaticClf } from '../data/clfTables';
import { withLifetimeDevelopment } from './hostDevelopment';
import { defaultDecisionSet } from './decisionDefaults';

export const PRE_GAME_YEARS = 3; // yearNumbers -2, -1, 0

// ============================================================================
// THE PRE-GAME IS THE POOL'S WHOLE HISTORY, AND IT BEGINS IN 2021.
//
// PRE_GAME_DEPTH years are played — 2021 to 2026 at the shipped six — on the
// line's paid-in capital (STARTING_CAPITAL, $12.5M) and nothing else: no reserves,
// no cohorts, no ledger. Reserves build only from 2021's claims on, and the
// opening is simply where the last year ends. The last PRE_GAME_YEARS of them
// are the declared prior history (priorHistory); the ones before are the early
// pre-game years the Annual Statement shows beside them (earlyPreGameHistory).
//
// ⚠ IT USED TO START WITH YEARS BEHIND IT, AND THEY WERE IMAGINARY. Bulk
// accident years older than the pre-game — 2016-2020 on WC and GL, 2019-2020
// on Property — sat on the books from its start, inside a window of
// OPENING_RESERVE_YEARS, so that pricing's five-year window was full from the
// first pre-game year; before them the bootstrap apportioned drawn seed
// cohorts. Both are retired: there are no accident years before 2021. The
// first pre-game year prices on the starting expected loss (bookPurePremium's
// ex-ante figure), and each later one on the years there are.
//
// ⚠ AND THE OPENING SURPLUS IS SET, NOT EARNED, so a young book costs it
// nothing. The scenario's premium-to-surplus ratio sets it (applySetOpening),
// and the prior board's funding margin is solved so the last year-end lands
// there (solvePreGameMargin). A young book's forward-booking optimism — what
// once ran the opening away and needed a ten-year maturation to cure — moves
// only the solved margin.
// ============================================================================
export const PRE_GAME_DEPTH = PRIOR_HISTORY_YEARS;

/**
 * The simulated years BEFORE the three declared pre-game years — derived now,
 * not declared. It is the pre-game's depth less the declared years, so it
 * falls out of the one parameter instead of being a second number to keep in
 * step. Read by claimsExport.ts for the seed-cohort boundary it prints.
 *
 * ⚠ NEGATIVE IF PRIOR_HISTORY_YEARS EVER DROPS BELOW PRE_GAME_YEARS, which
 * would mean a pre-game shorter than the declared years it is supposed to
 * contain. Asserted rather than clamped: a clamp would quietly run a 3-year
 * pre-game under a parameter that said 2.
 */
export const MATURATION_YEARS = PRE_GAME_DEPTH - PRE_GAME_YEARS;
if (MATURATION_YEARS < 0) {
  throw new Error(
    `PRIOR_HISTORY_YEARS (${PRIOR_HISTORY_YEARS}) is below PRE_GAME_YEARS (${PRE_GAME_YEARS}): `
    + 'the pre-game cannot be shorter than the declared pre-game years it contains.',
  );
}


export interface PriorHistoryResult {
  priorHistory: ResultSet[];      // the 3 accepted pre-game years, oldest first (pool aggregate)
  /**
   * THE PRE-GAME'S EARLIER YEARS — every played pre-game year before the three
   * in priorHistory (yearNumbers -5, -4, -3), oldest first, aggregated the same way.
   * Kept for the Annual Statement, which shows all six; priorHistory is
   * unchanged, so nothing else that reads it moves.
   */
  earlyPreGameHistory: ResultSet[];
  poolState: PoolState;           // ending state after year 0 = Year 1 opening
  startingFinancials: StartingFinancials;
  historyAttempt: number;         // max accepted per-line attempt (0 = all lines passed on base seed)
}

// One line's accepted solo pre-game: the 3 per-line yearly results plus its
// ending line state and its own ending shared operating items.
interface LinePreGame {
  line: CoverageLine;
  lineResults: LineResultSet[];   // years -2, -1, 0 for this line
  /** The pre-game's earlier years (-5, -4, -3), kept for the Annual Statement. */
  earlyLineResults: LineResultSet[];
  lineState: LinePoolState;       // ending state (Year 1 opening for this line)
  cash: number;                   // this line's own ending operating cash
  unearnedPremium: number;
  members: Member[];              // this line's ending roster
  membershipHistory: MembershipHistory; // this line's pre-game enrollment ledger
  memberLossHistory: MemberLossHistory; // this line's pre-game marketplace loss record
  /** This line's underwriting ledger after the pre-game — its units' loss history (bookUnderwriting.ts). */
  bookLedger?: BookLedger;
  attempt: number;
  /**
   * The prior board's margin over expected, every pre-game year — solved on
   * the DESIGNED history (PRE_GAME_MARGIN_ON_DESIGN) or on the history played.
   */
  solvedMargin: number;
}

// Run one line's pre-game IN ISOLATION (single-line sim) on a given candidate
// seed: MATURATION_YEARS to build the book, then the 3 declared pre-game
// years, one surplus carried through all of them from startingSurplus. Loan offers can't arise (single line), and the ending is
// gated by that line's own adequacy in the caller.
//
// ⚠ EXPORTED SO opening-centring-check STOPS REIMPLEMENTING IT. That gate needs
// the candidate BEFORE rejection, which runLinePreGame cannot give it, so it
// carried its own copy of this construction with a comment saying the two must
// be changed together. They were changed together exactly once — here — and the
// duplicate is now gone instead. A gate that reproduces the thing it measures
// can silently stop measuring it.
/** Which pre-game a run plays — see simulateLineCandidate's `run`. */
export type PreGameRun = 'flat' | 'designed' | 'simulated';

export function simulateLineCandidate(
  instance: GameInstance,
  setup: GameSetupSettings,
  line: CoverageLine,
  attempt: number,
  // The surplus the line enters its first pre-game year with. Omitted, it is
  // the bootstrap's own pin; runLinePreGame passes STARTING_CAPITAL.
  startingSurplus?: number,
  // The prior board's funding margin over expected, every pre-game year — the
  // solved one from runLinePreGame (solvePreGameMargin). 0 is expected.
  margin = 0,
  // Which pre-game: 'flat' (FLAT_PRE_GAME on — exactly the scenario's multiple
  // of expected, at PRE_GAME_INVESTMENT_RETURN), 'designed' (the same losses at
  // the market's expected return — the history the margin is set on,
  // PRE_GAME_MARGIN_ON_DESIGN) or 'simulated' (drawn, as the game plays it).
  run: PreGameRun = FLAT_PRE_GAME.enabled ? 'flat' : 'simulated',
): { lineResults: LineResultSet[]; poolState: PoolState; pooled: ResultSet[] } {
  const candidateInstance: GameInstance = attempt === 0
    ? instance
    // Its own draws; the game's book of units (marketSeed).
    : { ...instance, seed: (instance.seed + attempt * 997) >>> 0, marketSeed: instance.marketSeed ?? instance.seed };

  const soloSetup: GameSetupSettings = { ...setup, activeLines: [line] };
  const { poolState: bootstrap } = generateStartingPoolState(
    candidateInstance,
    setup.startingYear - PRE_GAME_DEPTH,
    [line],
    -(PRE_GAME_DEPTH - 1)
  );
  // ⚠ THE POOL'S HISTORY BEGINS IN 2021, THE FIRST PRE-GAME YEAR. There are
  // no accident years before it: the line starts with no reserves, no cohorts
  // and an empty ledger, and reserves build only from 2021's claims on. So
  // 2021 is priced on the starting expected loss for its year (bookPurePremium's
  // ex-ante figure, trended) — no history — and so is 2022, since pricing reads
  // a year behind (PRICING_DATA_LAG_YEARS); each later year on the complete
  // years there are: 2023 on one, 2024 on two, 2025 on three, 2026 on four, and
  // 2027, the first played year, on the full five-year window. (The bulk
  // accident years that used to sit here, older than the pre-game, are retired.)
  {
    const ls = bootstrap.lines[line];
    bootstrap.lines[line] = { ...ls, reserveCohorts: [], reserveDevelopment: [], netUnpaidReserve: 0 };
  }
  // ⚠ THE STARTING SURPLUS IS THE ONLY CAPITAL EVENT IN THE PRE-GAME. From here
  // the line's surplus moves only by its income, dividends and assessments, year
  // by year, into the opening. invested is re-derived from the identity, loss
  // expense reserve included, so the first year opens balanced.
  //
  // ⚠ AND OPERATING CASH IS CAPPED AT WHAT THE BALANCE SHEET HOLDS. With no
  // reserves the line's assets are its paid-in capital and nothing else, and
  // the bootstrap's operating-cash target (a share of its drawn premium) can
  // exceed it — measured, GL's did. Invested would then be negative, the engine
  // floors a year's investments at zero, and the floor creates assets: GL's
  // first pre-game year missed its income by $9.8M. So cash is the target or
  // the whole balance, whichever is less, and invested is the rest (never
  // below zero). The first year's sweep restores the target from premium.
  {
    const ls = bootstrap.lines[line];
    const surplus = startingSurplus ?? ls.surplus;
    const assets = surplus + ls.netUnpaidReserve + lossExpenseReserve(line, ls.reserveCohorts ?? []);
    bootstrap.cash = Math.min(bootstrap.cash, Math.max(0, assets));
    bootstrap.lines[line] = { ...ls, surplus, investedAssets: assets - bootstrap.cash };
  }

  let gs: GameState = {
    setup: soloSetup,
    instance: candidateInstance,
    currentYearNumber: -(PRE_GAME_DEPTH - 1),
    isStarted: true,
    isComplete: false,
    poolState: bootstrap,
    lockedResults: [],
    currentDecisions: preGameDecisionSet(-(PRE_GAME_DEPTH - 1), margin, gameShocksOn(setup, instance)),
    priorHistory: [],
  };

  for (let y = -(PRE_GAME_DEPTH - 1); y <= 0; y++) {
    // ⚠ THE PRE-GAME DOES NOT MOVE MEMBERSHIP. The roster that enters year 1 is
    // the STARTING ENROLMENT generateStartingPoolState drew, unchanged.
    //
    // Building a loss history and a reserve position is what these years are
    // for; evolving the ROSTER across them was a side effect of reusing
    // processYear, and it made the opening book a function of the decision
    // defaults — measured, switching voluntary departures off moved it from ~72
    // to ~120 without anyone changing the opening. Freezing it makes the opening
    // independent of what those defaults happen to be, which is the property
    // worth having.
    //
    // ⚠ EVERYTHING ELSE THESE YEARS DO STAYS. Claims are still generated for all
    // 200 marketplace members every year — the member loss ledger depends on it
    // and the appetite bar reads it — and the loss history, the reserve build
    // and the maturation years are untouched.
    const processed = processYear(gs, preGameDecisionSet(y, margin, gameShocksOn(setup, instance)), {
      freezeMembership: true,
      flatPreGame: run !== 'simulated',
      preGameMarket: run === 'flat' ? 'flat' : run === 'designed' ? 'expected' : 'drawn',
    });
    gs = {
      ...gs,
      currentYearNumber: y + 1,
      poolState: processed.updatedPoolState,
      lockedResults: [...gs.lockedResults, processed.result],
    };
  }

  return {
    // ⚠ ONLY THE DECLARED YEARS. The maturation years are not part of the pool's
    // stated past — priorHistory stays three years and every exhibit reading it
    // is unchanged. The BOOK they left is on the line state, and
    // reserveDevelopment carries them all, which is the point.
    lineResults: gs.lockedResults.slice(-PRE_GAME_YEARS).map(r => r.byLine[line]),
    poolState: gs.poolState,
    pooled: gs.lockedResults,
  };
}

// Per-line reject-and-redraw: re-simulate ONLY this line until its opening
// surplus lands inside OPENING_SURPLUS_BAND (two-sided), on that line's basis.
//
// ⚠ MEASURED AGAINST PREMIUM, NOT AGAINST THE REQUIRED RESERVE MARGIN. The
// margin is expectedNetUnpaidLoss x (reserveMarginCLF - 1), and testing against
// it made the opening move whenever the reserve, the reserve-margin CLF or the
// funding basis moved — three consecutive commits did exactly that, none of them
// a decision. Premium is the same quantity STARTING_CAPITAL_TO_PREMIUM already
// sets the seed from, so both sides of the pre-game now reference one stable
// basis and the reserve margin has left this path entirely. The band stays
// PER-LINE: a single shared tolerance was measured and rejected because it moved
// WC +22% and Property -18%, which is a re-tune, not a decoupling. See the
// band's own comment for the calibration.
//
// ⚠ AND THAT PARAGRAPH IS NOW HALF TRUE, WHICH IS WHY IT IS KEPT. WC and GL are
// tested against the opening NET RESERVE; Property is still tested against
// premium. The objection above — that testing against the required reserve
// margin made the opening move whenever the reserve, the margin CLF or the
// funding basis moved — is answered by FROZEN_CAPITAL_J: the CLF-derived
// multiple is a frozen literal, so the margin CLF is not a live consumer of this
// path and cannot move it. The RESERVE still can, and that is intended: it is
// the liability the capital is held against. See OPENING_SURPLUS_BAND.

/**
 * THE ACCEPTANCE RATIO — one definition, called by the engine and by every gate
 * that reproduces the search.
 *
 * ⚠ IT IS EXPORTED BECAUSE FOUR DIAGNOSTICS RE-IMPLEMENT THIS TEST. pin-vs-band,
 * opening-centring, pregame-acceptance and opening-basis-report all divide a
 * surplus by something and compare it to the band. Before the reserve basis
 * existed they could all hardcode `/ poolPremium` and be right; now a copy that
 * did so would silently grade WC and GL against the wrong denominator and still
 * look green. There is one expression and all five call it.
 */
export function openingBandRatio(
  line: CoverageLine,
  endingSurplus: number,
  poolPremium: number,
  endingNetReserve: number,
  // ⚠ REQUIRED, NOT OPTIONAL, AND DELIBERATELY SO. The 'required' basis divides
  // by this; an optional parameter would let a caller omit it and silently grade
  // against a default. Making it mandatory is what turned "update six call
  // sites" into a compiler error list rather than a search.
  reserveRiskMarginNeeded: number,
): number {
  const basis = OPENING_SURPLUS_BAND[line]?.basis ?? 'premium';
  // THE REQUIRED-CAPITAL BASIS. Surplus against what the line must hold —
  // reserve margin PLUS the catastrophe it retains (see catCapitalRetained). It
  // is the only basis on which "every line opens at the same multiple" is a
  // statement about safety rather than about the size of a denominator that
  // happens to differ by line.
  if (basis === 'required') return endingSurplus / Math.max(reserveRiskMarginNeeded, 1);
  return basis === 'reserve'
    ? endingSurplus / Math.max(endingNetReserve, 1)
    : endingSurplus / Math.max(poolPremium, 1);
}

/**
 * THE DECLARED YEARS' DECISIONS — the player's defaults in every respect but
 * one: the board before them funded at its own margin over expected, solved
 * per scenario and line (solvePreGameMargin), rather than at expected.
 *
 * ⚠ IT IS THE ONLY DIFFERENCE, AND THAT IS THE POINT. Everything else about
 * the pre-game — renewals, intake, risk control, the cover — stays on
 * `defaultDecisionSet`, so the handed-over pool is one that was run on the
 * same settings the player starts from.
 *
 * ⚠ AND THE PLAYER'S OWN DEFAULT IS UNCHANGED: `fundingAtExpected` is still
 * true from year 1. So year 1's rate steps up or down from the declared year
 * before it, by whether the scenario's solved margin sat below or above
 * expected. The welcome memo does not name the margin.
 */
// `shocks`: the game's switch — the prior board holds None while it is off.
function preGameDecisionSet(yearNumber: number, margin: number, shocks: boolean): DecisionSet {
  const d = defaultDecisionSet(yearNumber, shocks);
  for (const line of Object.keys(d.byLine) as CoverageLine[]) {
    // The margin prices; no table is read for it. The confidence level is what
    // it amounts to on the line's own table, recorded on the pre-game years'
    // results for display and read for nothing else.
    d.byLine[line].fundingAtExpected = false;
    d.byLine[line].fundingCushion = margin;
    if (hasStaticClf(line)) d.byLine[line].fundingConfidenceLevel = confidenceAtClf(line, 1 + margin);
    // ⚠ THE PRE-GAME HOLDS CASH AND BONDS ONLY (PRE_GAME_MARKET_DRAWS).
    d.byLine[line].assetAllocation = preGameAllocation();
  }
  d.assetAllocation = preGameAllocation();
  return d;
}

// ⚠ NO SEARCH, NO BAND, NO REDRAW — THE OPENING IS SET, AND THE PRIOR BOARD'S
// MARGIN IS SOLVED TO LAND ON IT (stable-scenarios commit 9).
//
// Each line starts the pre-game with STARTING_CAPITAL, paid in, and the board
// funds every pre-game year at one margin over expected. The opening is the
// scenario's: the line's year-1 premium at Expected, struck on the book the
// pre-game leaves, / the scenario's premium-to-surplus ratio. That premium
// reads only the ledger and the book — losses, not funding — so it is the same
// at every margin, and the margin is solved so the last year-end lands on it.
//
// The pre-game still RUNS because pricing reads the loss history it produces;
// what is gone is accepting or rejecting the result, and any reset.
function runLinePreGame(
  instance: GameInstance,
  setup: GameSetupSettings,
  line: CoverageLine
): LinePreGame {
  const developmentPct = setup.priorDevelopment?.[line] ?? PRIOR_DEVELOPMENT_DEFAULTS[line];
  const ratio = SCENARIO_PREMIUM_TO_SURPLUS[line][scenarioOf(instance)];
  const shocks = gameShocksOn(setup, instance);
  // One pre-game of a given kind at a given margin, and how far its last
  // year-end misses an opening at premium to surplus `target`.
  const run = (kind: PreGameRun, target = ratio) => (margin: number) => {
    const c = simulateLineCandidate(instance, setup, line, 0, STARTING_CAPITAL[line], margin, kind);
    const opened = finalizeLine(c, line, 0, developmentPct, instance, target, margin, shocks);
    return { start: margin, gap: c.poolState.lines[line].surplus - opened.lineState.surplus, opened };
  };
  // ⚠ THE MARGIN IS SET ON THE DESIGNED HISTORY, NOT SOLVED TO THE OPENING
  // (PRE_GAME_MARGIN_ON_DESIGN). It is the margin that lands the FLAT pre-game
  // — exactly expected x the scenario's experience multiple, at the pre-game
  // return — on the scenario's premium to surplus. The pre-game as the game
  // plays it then runs at that margin, and the opening is wherever its last
  // year-end falls: richer after good luck, thinner after bad. Flat, the two
  // runs are one and the opening lands exactly on the ratio, as before.
  if (!PRE_GAME_MARGIN_ON_DESIGN.enabled || FLAT_PRE_GAME.enabled) {
    return solvePreGameMargin(run(FLAT_PRE_GAME.enabled ? 'flat' : 'simulated'), line).opened;
  }
  // ⚠ NEVER BELOW ZERO (PRE_GAME_MARGIN_FLOOR): a designed history that would
  // need the board to charge under expected is charged at expected.
  const playAt = (margin: number) => {
    const c = simulateLineCandidate(instance, setup, line, 0, STARTING_CAPITAL[line], margin, 'simulated');
    return finalizeLine(c, line, 0, developmentPct, instance, ratio, margin, shocks, () => c.poolState.lines[line].surplus);
  };
  const designed = Math.max(PRE_GAME_MARGIN_FLOOR, solvePreGameMargin(run('designed'), line).start);
  const played = playAt(designed);
  // ⚠ THE GUARDRAILS (OPENING_PREMIUM_TO_SURPLUS_BOUNDS). An opening outside
  // them has its margin re-solved on the played history to land JUST on the
  // nearest bound; inside them, the designed margin stands. The secant reads
  // the opening's own year-1 premium at every trial margin.
  const premium = openingYear1Premium(instance, line, played.lineState,
    played.lineResults[played.lineResults.length - 1], shocks);
  const ps = premium / played.lineState.surplus;
  const { min, max } = OPENING_PREMIUM_TO_SURPLUS_BOUNDS;
  // A surplus at or below zero is thinner than any bound; raising the margin
  // to the thin bound never takes it below the floor.
  if (!(played.lineState.surplus > 0) || ps > max) return solvePreGameMargin(run('simulated', max), line).opened;
  if (ps < min) {
    // Too rich: lower the margin to land on the rich bound — but not below the
    // floor. Where the bound needs a negative margin, the board charges at the
    // floor and the opening lands where that history takes it.
    const guarded = solvePreGameMargin(run('simulated', min), line);
    return guarded.start >= PRE_GAME_MARGIN_FLOOR ? guarded.opened
      : designed === PRE_GAME_MARGIN_FLOOR ? played : playAt(PRE_GAME_MARGIN_FLOOR);
  }
  return played;
}

/**
 * THE LINE'S YEAR-1 PREMIUM AT EXPECTED, struck on the opening: the default
 * decisions' rate on its opening ledger and book, times the book's year-1
 * exposure — what the scenario's opening surplus is a fraction of. Off the new
 * rate stack (the dormant member path), the last pre-game year's charge.
 */
export function openingYear1Premium(
  instance: GameInstance, line: CoverageLine, lineState: LinePoolState, lastPreGame?: LineResultSet,
  /** The game's shock switch (shockLosses.gameShocksOn) — year 1's cover is priced on it. Absent is on. */
  shocks = true,
): number {
  const struck = strikeBookRate(line, lineState, defaultDecisionSet(1, shocks).byLine[line], 1,
    { allMarketMembers: [], membershipHistory: {} },
    MEMBER_LEVEL.enabled ? undefined : lineBookRisk(instance, line, { [line]: openingBookUnits(marketSeedOf(instance), line) }),
    shocks);
  return struck ? struck.quote.finalRatePer100 * struck.exposure * 10_000 : lastPreGame?.totalMemberCharge ?? 0;
}

// ============================================================================
// THE PRIOR BOARD'S MARGIN, SOLVED — one funding level over expected across the
// six pre-game years, per line, so the last year-end of a given history lands
// exactly on a given opening from STARTING_CAPITAL (stable-scenarios commit 9;
// runLinePreGame solves it on the DESIGNED history and, for the guardrails, on
// the played one — PRE_GAME_MARGIN_ON_DESIGN). It
// replaced the fixed 14% cushion, whose ending surplus was closed instead by
// solving the STARTING surplus (solvePreGameStart, now gone).
//
// A secant on the margin. The year-end is affine in it — premium is linear in
// the CLF, and the investment return on what that premium adds is too — so
// the second step lands; the loop keeps going while anything nonlinear
// (dividends or assessments on a surplus basis) leaves a gap, and refuses to
// hand over a pre-game that does not close. The margin is not floored: a
// scenario may solve below expected.
// ============================================================================
const PRE_GAME_MARGIN_MAX_STEPS = 40;

export function solvePreGameMargin<T extends { start: number; gap: number }>(
  run: (margin: number) => T,
  line: CoverageLine,
): T {
  let a = run(0);
  if (Math.abs(a.gap) <= PRE_GAME_START_TOLERANCE) return a;
  let b = run(0.1);
  for (let step = 0; step < PRE_GAME_MARGIN_MAX_STEPS && Math.abs(b.gap) > PRE_GAME_START_TOLERANCE; step++) {
    const slope = (b.gap - a.gap) / (b.start - a.start);
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-6) {
      throw new Error(`pre-game ${line}: year-end does not respond to the margin (slope ${slope})`);
    }
    a = b;
    b = run(b.start - b.gap / slope);
  }
  if (Math.abs(b.gap) > PRE_GAME_START_TOLERANCE) {
    throw new Error(`pre-game ${line}: the prior board's margin did not converge (gap ${b.gap})`);
  }
  return b;
}

// How close the pre-game's last year-end must land on the opening.
const PRE_GAME_START_TOLERANCE = 0.01; // dollars

// ============================================================================
// THE SET OPENING, APPLIED. The pre-game's ending book IS the opening book:
// the years it played, 2021 on, as they stand — the pool's whole history.
// Surplus is the ruled multiple of required capital on that reserve — and the
// pre-game started from the surplus that lands its last year-end exactly there
// (solvePreGameMargin), so setting it moves nothing.
//
// ⚠ NOTHING IS SWAPPED IN AND NOTHING IS FILTERED. The pool's history begins
// in 2021, the first pre-game year: there are no accident years before it, so
// every cohort and ledger row the pre-game wrote is the opening's. (It used to
// carry bulk accident years older than the pre-game — 2016-2020 on WC and GL,
// 2019-2020 on Property — and keep a window of OPENING_RESERVE_YEARS; both are
// retired.)
//
// ⚠ invested IS RE-DERIVED FROM THE IDENTITY, not adjusted. surplus = cash +
// invested - netReserve - LAE reserve, so invested = surplus + netReserve + LAE
// reserve - cash.
// ============================================================================
function applySetOpening(
  line: CoverageLine,
  ls: LinePoolState,
  lineCash: number,
  developmentPct: number,
  // The opening surplus, from the opened book (the scenario's: year-1 premium
  // at Expected / its ratio).
  surplusOf: (opened: LinePoolState) => number,
): LinePoolState {
  const open = ls.reserveCohorts ?? [];
  // ⚠ EVERY COHORT THE POOL OPENS WITH IS BASED HERE on its outstanding AT
  // GAME START — the brief's rule for prior years. The fields are cleared
  // first: withLifetimeDevelopment refuses to re-base a cohort that already
  // carries a total, and the pre-game develops nothing, so without the clear
  // they would open based at zero and never develop.
  const reserveCohorts = open.map(c => withLifetimeDevelopment(
    { ...c, developmentBase: undefined, developmentTotal: undefined, developmentEmerged: undefined,
      developmentBaseOpenShare: undefined },
    line, developmentPct,
  ));
  const netUnpaidReserve = reserveCohorts.reduce((a, c) => a + c.netUnpaid, 0);
  const reserveDevelopment = ls.reserveDevelopment ?? [];
  // SET at the scenario's opening, read off the opened book — never off
  // required capital (funding tables wiring) — see runLinePreGame.
  const surplus = surplusOf({ ...ls, reserveCohorts, reserveDevelopment, netUnpaidReserve });
  return {
    ...ls,
    reserveCohorts,
    reserveDevelopment,
    netUnpaidReserve,
    surplus,
    // ⚠ THE LOSS EXPENSE RESERVE IS A LIABILITY TOO, so the opening holds assets
    // for it: the ruled surplus is surplus OVER both reserves.
    investedAssets: surplus + netUnpaidReserve + lossExpenseReserve(line, reserveCohorts) - lineCash,
  };
}

function finalizeLine(
  c: ReturnType<typeof simulateLineCandidate>,
  line: CoverageLine,
  attempt: number,
  developmentPct: number,
  instance: GameInstance,
  ratio: number,
  margin: number,
  shocks = true,
  // The opening surplus from the opened book. Absent, the scenario's: year-1
  // premium at Expected / its ratio. The designed-margin rule passes the
  // played pre-game's own last year-end (PRE_GAME_MARGIN_ON_DESIGN).
  surplusOf?: (opened: LinePoolState) => number,
): LinePreGame {
  // Stamp the accepted attempt onto each pre-game year's result so the
  // effective seed (instance.seed + attempt x 997) that produced it is
  // recoverable later from saved state, not just during this simulation run.
  const lineResults = c.lineResults.map(r => ({ ...r, pregameAttempt: attempt }));
  // The same accepted attempt's earlier years — every pre-game year before the
  // declared three, off the single-line pooled results it already returns.
  const earlyLineResults = c.pooled.slice(0, -PRE_GAME_YEARS)
    .map(r => ({ ...r.byLine[line], pregameAttempt: attempt }));
  return {
    line,
    lineResults,
    earlyLineResults,
    lineState: applySetOpening(line, c.poolState.lines[line], c.poolState.cash, developmentPct,
      surplusOf ?? (opened => openingYear1Premium(instance, line, opened, lineResults[lineResults.length - 1], shocks) / ratio)),
    solvedMargin: margin,
    cash: c.poolState.cash,
    unearnedPremium: c.poolState.unearnedPremium,
    members: c.poolState.lines[line].members,
    membershipHistory: c.poolState.membershipHistory,
    memberLossHistory: c.poolState.memberLossHistory ?? {},
    ...(c.poolState.bookLedger?.[line] ? { bookLedger: c.poolState.bookLedger[line] } : {}),
    attempt,
  };
}

export function runPriorHistory(
  instance: GameInstance,
  setup: GameSetupSettings
): PriorHistoryResult {
  // Simulate each active line's pre-game in isolation (config-independent).
  const perLine = setup.activeLines.map(line => runLinePreGame(instance, setup, line));

  // --- Assemble the Year 1 opening pool from the per-line ending states ---
  // Per-line surplus/invested/reserves/roster come straight from each line's
  // own solo pre-game. The shared operating cash is the SUM across lines.
  // The pool total is internally
  // consistent (each solo line's balance sheet ties, and summing preserves
  // that), so the live-year contribution-share split reproduces each line's
  // stored surplus and Year 1 ties out.
  // ============================================================================
  // ⚠ SATISFACTION IS RE-PINNED AT THE BOUNDARY — WHAT CARRIES FORWARD IS THE
  // BOOK, NOT THE HISTORY THAT BUILT IT. (Surplus no longer is: it flows into
  // the opening at a solved margin, see solvePreGameMargin.)
  //
  // Per-member satisfaction is a STOCK, so ten pre-game years of it accumulate.
  // Measured before this re-pin, a member entered Year 1 at 4.24 against an
  // opening disposition of 7.25 — three points of grievance about a bootstrap.
  // The pre-game's rate series is not a policy record: the book is grown from
  // nothing through the maturation years, so its year-over-year rate moves are
  // large and are nobody's decision. A player opening the game holding someone
  // else's complaint cannot read their own.
  //
  // ⚠ NO DRAW, WHICH IS WHAT MAKES IT SAFE TO DO HERE. The pre-game is where
  // STARTING_CAPITAL_TO_PREMIUM is solved and where the opening band accepts or
  // rejects a candidate; a draw added anywhere in it would re-phase every stream
  // and move the pin, both baselines, and every calibration standing on them.
  // This is a pure assignment of a deterministic per-member value.
  //
  // It also makes the opening REPRODUCIBLE FROM THE ROSTER ALONE — a member's
  // Year 1 satisfaction no longer depends on which pre-game attempt was
  // accepted, which is one less thing the opening position carries.
  //
  // ⚠ THE PIN IS THE EARNED ANCHOR, NOT A FIXED NUMBER, AND THAT IS THE WHOLE
  // OF THE 2026-10 CHANGE. It used to re-pin every member to the roster's
  // static OPENING_SATISFACTION (7.20-7.22), which is anchorCentre — the anchor
  // for a pool priced AT the market. Once zero risk load left the pool about
  // 25% UNDER the market, the anchor it actually earns rose to roughly 8.2, and
  // a roster pinned at 7.21 spent the whole game climbing to it. That climb was
  // member-satisfaction-check's five drift failures: ~90% of a 0.8-1.0 point gap
  // closes over ten years at the 20.63%/yr pull, and the measured climb (+0.68
  // WC, +0.75 GL, +0.55 Property) matched that arithmetic.
  //
  // So members now OPEN WHERE THEY WOULD SETTLE. The pool has traded for ten
  // pre-game years; its members would already reflect its price, not arrive with
  // an opinion formed about some other pool.
  //
  // ⚠ STILL NO DRAW, which is what kept this safe to do here and still does.
  // Every input is deterministic given the accepted pre-game: the line's own
  // ending rate against the market, each member's loss standing over the
  // experience window, and the ending capital band. Nothing is sampled, so no
  // stream is re-phased and the pin, the band and both baselines stand.
  //
  // ⚠ WHAT IS STILL RE-PINNED, AND WHY THE ORIGINAL REASON SURVIVES INTACT. The
  // accumulated pre-game STOCK is still discarded. A member reached Year 1 at
  // 4.24 before any of this, carrying grievance about a bootstrap whose rate
  // moves were nobody's decision. Seeding the anchor keeps that out while
  // dropping the part that was wrong — the anchor is a property of the pool's
  // STANDING PRICE, which is a real fact about the pool the player inherits,
  // whereas the stock was a record of how it was built.
  //
  // ⚠ THE PER-MEMBER SPREAD IS PRESERVED, as an OFFSET rather than a level. The
  // roster's 19-mod-23 walk gives each member a disposition 0 to 0.02 above the
  // floor; that offset is carried onto the earned anchor, so a member's
  // disposition stays a property of the member exactly as its note requires.
  //
  // ⚠ REPRODUCIBILITY NARROWS BY EXACTLY ONE STEP, STATED SO IT IS NOT A
  // SURPRISE. The old pin made Year 1 satisfaction readable from the roster
  // ALONE, independent of which pre-game attempt was accepted. It is now
  // readable from the roster AND the accepted opening position. That is
  // unavoidable: the whole point is to reflect the price, and the price is what
  // the accepted attempt settled. It is still fully deterministic.
  const openingByMember = new Map(
    getPredefinedMarketMembers().map(m => [m.id, m.satisfaction]),
  );
  const lines = {} as Record<CoverageLine, LinePoolState>;
  for (const line of (['WC', 'GL', 'Property'] as CoverageLine[])) {
    const pg = perLine.find(p => p.line === line);
    if (!pg) { lines[line] = emptyLinePoolState(); continue; }
    const last = pg.lineResults[pg.lineResults.length - 1];
    // The line's opening price against what a carrier would want for the same
    // expected loss — the same call, on the same gross basis, that
    // processLineYear makes. The cycle is read at YEAR 1, the first year the
    // player actually faces, because that is the anchor they are opening into.
    const openingRatePer100 = last
      ? last.totalMemberCharge / Math.max(last.activeExposure * 10_000, 1)
      : 0;
    const levelGapPct = last
      ? marketLevelGapPct(line, openingRatePer100, last.purePremiumPer100 ?? 0,
        { yearNumber: 1, ctx: { seed: instance.seed, gameId: instance.instanceId } })
      : 0;
    const band = surplusBandOf(last?.excessCapitalRatio ?? null);
    const standing = new Map(
      memberLossStanding(pg.lineState.members, line, pg.memberLossHistory)
        .map(x => [x.memberId, x.level]),
    );
    // ⚠ THE MEASUREMENTS THIS REPLACED A CONSTANT ON, RECORDED HERE BECAUSE
  // memberCatalog.ts IS MACHINE-GENERATED AND CANNOT CARRY THEM (it is
  // regenerated and compared byte-for-byte by roster-catalog-check).
  // OPENING_SATISFACTION's 7.20-7.22 is anchorCentre, the anchor for a pool
  // priced AT the market. At the cushion the pool actually runs — about
  // -25.25pp on all three lines once the risk load went to zero — the anchor is
  // 8.2100 in the Adequate band and 8.4084 in Strong. The engine closes 20.63%
  // of that gap a year, so ~90% of it closes over ten years: predicted climb
  // 0.70-0.88 points, measured +0.68 WC, +0.75 GL, +0.55 Property. That climb
  // was member-satisfaction-check's five drift failures.
  //
  // AND IT WAS NOT THE SURPLUS LIMB, tested rather than argued: with
  // surplusWeight set to 0 — the limb entirely off — every drift failure
  // survived (WC 10yr 273% -> 244%, GL 5yr 189% -> 167%). The limb carries about
  // a tenth of the drift and clears none of it.
  //
  // ⚠ WHY THE BARE ANCHOR AND NOT THE SETTLED STOCK — TRIED, MEASURED,
    // REJECTED. The stock's fixed point under a repeating year is
    // anchor + delta/pull, not the anchor, because the change term lands before
    // the pull; measured in play the settled stock sits -0.214 below its anchor
    // on WC, -0.061 on GL and -0.070 on Property. Seeding that fixed point was
    // implemented and run, using the rate the pool actually moved between its
    // last two DECLARED pre-game years. It made GL and Property better and WC
    // worse by the same margin, flipping WC's residual from -0.133 to +0.134.
    //
    // THE REASON IS THE ONE THIS BLOCK ALREADY KNOWS: the pre-game's rate series
    // is not a policy record, so it does not predict the game's. Measured over
    // 12 games, mean rate change per year:
    //
    //     line        pre-game last yr    pre-game declared mean    IN-GAME
    //     WC                  +3.044%                   +2.296%     -1.154%
    //     GL                  -1.021%                   +0.511%     +1.147%
    //     Property            +0.300%                   -0.099%     +0.337%
    //
    // WC's pre-game price is RISING at 3% while its game price FALLS at 1.2% —
    // opposite sign, four points apart. Any settle offset read off the pre-game
    // therefore seeds WC for a price path that does not happen. Property worked
    // only because its two figures happen to agree. Taking the offset from the
    // pre-game is the very mistake the re-pin exists to prevent, so the seed is
    // the anchor and the residual walk to the fixed point is left alone.
    lines[line] = {
      ...pg.lineState,
      // THE SHOCK COST BASE (wip/shocks): the book as year 1 quotes it — the
      // opening book x year 1's exposure factor — recorded once, so every later
      // year's T claims and cover prices scale against it (shockCost.ts).
      ...(pg.lineState.bookExposure !== undefined
        ? { shockCostBaseExposure: pg.lineState.bookExposure * exposureFactor(line, 1) } : {}),
      members: pg.lineState.members.map(m => {
        const roster = openingByMember.get(m.id);
        if (roster === undefined) return m;
        const offset = roster - OPENING_SATISFACTION.min;
        const anchor = satisfactionAnchor(levelGapPct, standing.get(m.id) ?? 0, band);
        const seeded = parseFloat(Math.max(SATISFACTION.floor, Math.min(SATISFACTION.ceiling,
          anchor + offset)).toFixed(2));
        return seeded === m.satisfaction ? m : { ...m, satisfaction: seeded };
      }),
    };
  }

  // Shared market roster: the FULL canonical marketplace, with a member
  // 'active' if active in ANY line's ending pre-game roster and 'prospect'
  // otherwise — the same OR-semantic instanceGenerator applies at bootstrap.
  //
  // The base set must be the full catalog, not any line's ending roster: a
  // line's ending members are its ACTIVES ONLY (the engine stores
  // memberResult.activeMembers each year), so basing the market on
  // perLine[0].members silently shrank the live-year universe to WC's
  // pre-game survivors. The activeIds OR-union was always computed correctly
  // across lines — it was just applied over that shrunken base, which
  // collapsed recruitment to a near-empty candidate pool and pushed displayed
  // market share to ~97% (>100% for non-WC lines, whose actives weren't even
  // subsets of the base).
  const activeIds = new Set<string>();
  for (const pg of perLine) {
    for (const m of pg.members) if (m.status === 'active') activeIds.add(m.id);
  }
  // With MEMBER_LEVEL off there is no market roster to carry.
  const allMarketMembers: Member[] = (MEMBER_LEVEL.enabled ? getPredefinedMarketMembers() : []).map(m => ({
    ...m,
    status: activeIds.has(m.id) ? ('active' as const) : ('prospect' as const),
  }));

  // Merge the per-line pre-game ledgers. Each solo pre-game only ever wrote
  // its own line's intervals, so the merge is a disjoint per-line union.
  const membershipHistory: MembershipHistory = {};
  for (const pg of perLine) {
    for (const [memberId, byLine] of Object.entries(pg.membershipHistory)) {
      const intervals = byLine[pg.line];
      if (!intervals || intervals.length === 0) continue;
      const target = (membershipHistory[memberId] ??= {});
      target[pg.line] = intervals.map(iv => ({ ...iv }));
    }
  }

  // Merge the per-line pre-game LOSS records the same way, and for the same
  // reason: each solo pre-game ran with one line active, so recordMemberLossYear
  // only ever wrote that line's key. A disjoint per-line union.
  //
  // ⚠ THIS IS WHAT MAKES EVERY EXPERIENCE MECHANIC LIVE ON TURN ONE, and it is
  // the answer to a question that gets asked again roughly every time someone
  // reads a game's first year: renewal underwriting, new business appetite, the
  // experience modifier and satisfaction's loss limb all need a three-year
  // record, and they have one before the player has made a single decision.
  //
  // FIVE YEARS, NOT THREE. The note here used to say three. The pre-game plays
  // PRE_GAME_DEPTH = MATURATION_YEARS + PRE_GAME_YEARS = 10 accident years and
  // recordMemberLossYear prunes to LOSS_HISTORY_CAP_YEARS, so what survives into
  // year 1 is yearNumbers -4 through 0 — MEASURED, 8 games: every member of the
  // WC roster carries exactly 5 entries and 100% of them are `rated`.
  //
  // Prospects are included, since stage 2 generates marketplace-wide in the
  // pre-game years too (they run through the same processYear) — measured, 100%
  // of the WC and GL applicant pool is rated at year 1.
  //
  // Only the ACCEPTED attempt's record survives. runLinePreGame re-simulates
  // rejected candidates, but each attempt builds its own poolState from
  // scratch, so a rejected attempt's losses are discarded with it rather than
  // accumulating — which is why recordMemberLossYear replaces same-year entries
  // rather than appending.
  const memberLossHistory: MemberLossHistory = {};
  for (const pg of perLine) {
    for (const [memberId, byLine] of Object.entries(pg.memberLossHistory)) {
      const years = byLine[pg.line];
      if (!years || years.length === 0) continue;
      const target = (memberLossHistory[memberId] ??= {});
      target[pg.line] = years.map(y => ({ ...y }));
    }
  }

  const poolState: PoolState = {
    cash: perLine.reduce((s, p) => s + p.cash, 0),
    unearnedPremium: perLine.reduce((s, p) => s + p.unearnedPremium, 0),
    allMarketMembers,
    lines,
    interLineLoans: [],
    membershipHistory,
    memberLossHistory,
    // The book of units, ONCE, from the GAME's seed — whatever attempt a line's
    // pre-game was accepted on (bookUnits.ts). Never shown.
    ...(MEMBER_LEVEL.enabled ? {} : {
      bookUnits: Object.fromEntries(setup.activeLines.map(l => [l, openingBookUnits(marketSeedOf(instance), l)])),
      // ⚠ AND THE PRE-GAME'S LOSS HISTORY BY UNIT, so year 1's renewals read
      // the years the players inherit — the accepted attempt's, whatever it was.
      bookLedger: Object.fromEntries(perLine.flatMap(p => (p.bookLedger ? [[p.line, p.bookLedger]] : []))),
    }),
  };

  // Pool-level pre-game history = per-year aggregate across the active lines.
  const priorHistory: ResultSet[] = [];
  for (let i = 0; i < PRE_GAME_YEARS; i++) {
    const lineResults = perLine.map(p => ({ line: p.line, result: p.lineResults[i] }));
    priorHistory.push(aggregateLineResults(lineResults, priorHistory[i - 1]));
  }

  // The earlier pre-game years, aggregated exactly as the declared three are.
  const earlyPreGameHistory: ResultSet[] = [];
  const earlyCount = perLine[0]?.earlyLineResults.length ?? 0;
  for (let i = 0; i < earlyCount; i++) {
    const lineResults = perLine.map(p => ({ line: p.line, result: p.earlyLineResults[i] }));
    earlyPreGameHistory.push(aggregateLineResults(lineResults, earlyPreGameHistory[i - 1]));
  }

  return {
    priorHistory,
    earlyPreGameHistory,
    poolState,
    startingFinancials: deriveStartingFinancials(poolState, priorHistory),
    historyAttempt: Math.max(0, ...perLine.map(p => p.attempt)),
  };
}

// The Year 1 opening position, derived from the pre-game ending state instead
// of raw draws. Pool-level: sums span all lines (inactive lines are zeroed
// empty states, so summing all three is safe).
function deriveStartingFinancials(poolState: PoolState, priorHistory: ResultSet[]): StartingFinancials {
  const lastResult = priorHistory[priorHistory.length - 1];
  const lines = Object.values(poolState.lines);

  const investments = lines.reduce((s, l) => s + l.investedAssets, 0);

  const netUnpaidReserve = lines.reduce((s, l) => s + l.netUnpaidReserve, 0);

  const totalAssets = poolState.cash + investments;
  const totalLiabilities = netUnpaidReserve + poolState.unearnedPremium;
  const surplus = totalAssets - totalLiabilities;
  const annualPremium = lastResult.totalMemberCharge;

  return {
    cash: poolState.cash,
    investments,
    totalAssets,
    netUnpaidReserve,
    unearnedPremium: poolState.unearnedPremium,
    totalLiabilities,
    surplus,
    annualPremium,
    expectedLossRatio: lastResult.expectedLossRatio,
    memberSatisfaction: parseFloat(lastResult.memberSatisfaction.toFixed(1)),
    riskQuality: parseFloat(lastResult.averageRiskQuality.toFixed(1)),
    surplusToPremiumRatio: surplus / Math.max(annualPremium, 1),
    activeMembers: lastResult.activeMembers,
    activeExposure: lastResult.activeExposure,
    totalMarketExposure: lastResult.totalMarketExposure,
    marketShare: lastResult.marketShare,
    // The four rate fields that used to be set here are gone from
    // StartingFinancials — see its own note. They read a pool row's per-line
    // placeholders and nothing consumed them.
  };
}

// Adapter: map a real pre-game result (pool or per-line slice) onto the
// HistoricalYear display shape the Pool History / Dashboard / Financials
// pages already render. Every field is present on (or derivable from) the
// real result — no synthetic values.
/**
 * THE POOL ROW'S historical shape — the two per-$100 rate fields OMITTED.
 *
 * ⚠ BOTH WERE POOL RATES AND NEITHER HAD A DENOMINATOR. `purePremiumPer100` was
 * the first active line's, straight off the pool row's placeholder.
 * `poolPremiumRatePer100` is worse because the compiler cannot catch it: it is
 * COMPUTED, `poolPremium / (activeExposure x 10_000)`, and both of those fields
 * are real at pool scope — but pool activeExposure is payroll plus TIV, so the
 * quotient is dollars per $100 of two different things added together. The type
 * change finds the placeholder read and cannot find this one; it is omitted here
 * by hand, and that asymmetry is worth knowing about the guard's reach.
 */
export function poolToHistoricalYear(r: ResultSet): HistoricalYear {
  const full = toHistoricalYear(r as unknown as LineResultSet);
  const pooled: HistoricalYear = { ...full };
  delete pooled.purePremiumPer100;
  delete pooled.poolPremiumRatePer100;
  return pooled;
}

export function toHistoricalYear(r: LineResultSet): HistoricalYear {
  return {
    historyYearNumber: r.yearNumber,
    calendarYear: r.calendarYear,
    // activeMembers is the DISTINCT roster at both scopes now — the pooled row
    // deduplicates by member id rather than summing per-line enrolments. Read
    // the field directly; there is no longer a display-side correction to apply.
    activeMembers: r.activeMembers,
    activeExposure: r.activeExposure,
    totalMarketExposure: r.totalMarketExposure,
    marketShare: r.marketShare,
    purePremiumPer100: r.purePremiumPer100,
    poolPremiumRatePer100: r.poolPremium / Math.max(r.activeExposure * 10_000, 1),
    expectedLoss: r.expectedLoss,
    poolPremium: r.poolPremium,
    adminExpense: r.adminExpense,
    poolPremiumAndAdminExpense: r.poolPremiumAndAdminExpense,
    reinsuranceCost: r.reinsuranceCost,
    totalMemberCharge: r.totalMemberCharge,
    grossUltimateLoss: r.grossUltimateLoss,
    reinsuranceRecovery: r.reinsuranceRecovery,
    priorYearDevelopmentCeded: r.priorYearDevelopmentCeded,
    bookingGiveBack: r.bookingGiveBack,
    netUltimateLoss: r.netUltimateLoss,
    netPaidLosses: r.netPaidLosses,
    endingNetReserve: r.endingNetReserve,
    actualLossRatio: r.actualLossRatio,
    actualLossRatioPricingBasis: r.actualLossRatioPricingBasis,
    actualLossRatioRetainedPremium: r.actualLossRatioRetainedPremium,
    actualExpenseRatio: r.actualExpenseRatio,
    actualCombinedRatio: r.actualCombinedRatio,
    underwritingIncome: r.underwritingIncome,
    investmentIncome: r.investmentIncome,
    netIncome: r.netIncome,
    endingSurplus: r.endingSurplus,
    requiredReserveMargin: r.reserveRiskMarginNeeded,
    excessCapitalRatio: r.excessCapitalRatio,
    capitalAdequacyStatus: r.capitalAdequacyStatus,
  };
}
