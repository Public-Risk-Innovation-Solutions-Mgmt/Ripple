// Stage 2.10 + seed-fix-per-line-opening — per-line prior histories.
//
// Each active line gets a REAL simulated 3-year pre-game past (yearNumbers -2,
// -1, 0) produced by the same engine as live years, at default decisions —
// preceded by MATURATION_YEARS further simulated years that are NOT part of the
// declared past and exist only to leave a ten-accident-year book behind. See
// MATURATION_YEARS for why. Surplus is not re-pinned anywhere inside it: the
// line starts from the surplus that lands its last year-end on the set opening
// (solvePreGameStart) and moves only by its own income from there. Each
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

import type {
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
import { openingBookUnits } from './bookUnits';
import { getPredefinedMarketMembers } from '../data/memberCatalog';
import { OPENING_SURPLUS_BAND } from '../data/defaultAssumptions';
import { processYear, aggregateLineResults } from './simulationEngine';
import {
  satisfactionAnchor, memberLossStanding, surplusBandOf, SATISFACTION,
} from './memberSatisfaction';
import { marketLevelGapPct } from './marketConditions';
import { OPENING_SATISFACTION } from '../data/memberCatalog';
import { emptyLinePoolState } from './lineHelpers';
import { openingCatCapital, preGameBulkYears, setOpeningSurplus } from './openingReserves';
import { lossExpenseReserve } from './lossExpense';
import { MEMBER_LEVEL, OPENING_RESERVE_YEARS, PRE_GAME_FUNDING_LEVEL, PRIOR_DEVELOPMENT_DEFAULTS, PRIOR_HISTORY_YEARS } from '../data/pricingParameters';
import { exposureFactor } from '../data/exposureTrend';
import { withLifetimeDevelopment } from './hostDevelopment';
import { defaultDecisionSet } from './decisionDefaults';

export const PRE_GAME_YEARS = 3; // yearNumbers -2, -1, 0

// ============================================================================
// THE MATURATION YEARS — WHY THE POOL NO LONGER STARTS THREE YEARS OLD.
//
// These are played BEFORE the three declared pre-game years and are not part of
// the pool's stated past. Their only job is to leave a book behind: ten accident
// years, each at its own age, each with a real claim register, a real developing
// set and real cession — the thing a three-year pre-game plus a handful of
// apportioned seed cohorts cannot produce.
//
// ⚠ WHY IT WAS NEEDED, AND IT IS A FORWARD-BOOKING PROBLEM. Booking a cohort at
// its contracted initial estimate understates incurred while the book is young.
// A pool in runoff EQUILIBRIUM does not have that problem: the development of
// its older years exactly offsets the under-booking of its newest, so booked
// incurred equals ultimate written. A three-year book is nowhere near
// equilibrium, so three years of income were overstated and the opening surplus
// ran away with them — measured, the unfiltered opening median rose to 2.207 on
// WC against a band ceiling of 1.22, and no admissible pin brought it back:
// WC and GL both solved NEGATIVE and both sat above their ceilings at K = 0.
//
// ⚠ THE TRANSIENT IS AS LONG AS THE IBNER HORIZON, WHICH IS WHERE TEN COMES
// FROM. Measured, the implied intercept by depth:
//
//   accident years at game start        WC       GL   Property
//   3 (the old book)                  1.304    1.628     0.395
//   7                                 0.783    0.064    -0.265
//   10  <- shipped                    0.377   -0.012    -0.105
//   13                                0.237   -0.048    -0.131
//
// Each line stops improving at roughly its own MEAN IBNER horizon — GL (5.5)
// and Property (3) are done by seven, WC (8.5) is still moving at thirteen.
// Nobody designed that agreement; it is the reason to trust the number. Seven
// passes on all three lines but leaves WC at K* = 0.112, which is thin. Ten is
// set by WC and is where WC has room.
//
// ⚠ AND THE RELIEF IS DEVELOPMENT, NOT RESERVE — WHICH IS WHY THE BOOK HAS TO BE
// PLAYED RATHER THAN APPORTIONED. Split at the boundary below, the whole move is
// made in the three declared years and it is adverse development on the mature
// book: 108% of it on every line, with investment income on the assets backing
// the deeper reserve pushing the other way (hence over 100%). GL is the proof —
// its net reserve/premium rises only 1.118 -> 1.429 while its opening falls by
// 1.585 of premium, five times more. The relief is a FLOW of development across
// ten cohorts, not a STOCK of reserve. An apportioned book carries the stock and
// none of the flow, so it would have bought nothing.
//
// ⚠ AND CESSION IS REAL HERE, WHICH AN APPORTIONED BOOK CANNOT MODEL. A seed
// cohort has no register, so it cedes nothing ever. These cohorts cede: the
// tower takes 15% / 26% / 14% off the standing reserve, and the gain survives it.
// ============================================================================
// ⚠ WHAT IT COSTS, AND THE TWO COSTS ARE DIFFERENT AUDIENCES.
//
// THE PLAYER pays 261 ms for a full three-line opening, measured at the
// re-solved pin with the band in force and no fallbacks in 20 openings. That is
// 2.6x the old path rather than the 3.3x the depth alone implies, because a
// centred pin buys back more than the extra years cost: fifty precomputed
// openings take 13 s, and a cold start that generates one takes 0.26 s.
//
// THE DEVELOPER pays much more, on the two-armed gates only, and this is the
// real bill. The pin is ONE SCALAR PER LINE and it centres the SHIPPED
// configuration. Any gate that also runs the other arm through runPriorHistory
// runs it off-centre, and the deeper pre-game multiplies every extra attempt.
// Measured, share of unfiltered candidates landing in band:
//
//   line       FB on (shipped)   FB off (retired)
//   WC              30%               45%
//   GL              35%                5%     <- 1 in 20, so ~20 attempts
//   Property        20%               25%
//
// GL's retired arm therefore pays roughly twenty ten-year pre-games per opening,
// and cohort-ledger-check went from about 35 s to over ten minutes on that
// alone. It is not fallbacks — nothing hits the 500 cap — it is an off-centre
// proposal distribution meeting a longer candidate.
//
// ⚠ DO NOT FIX THIS BY SHORTENING THE PRE-GAME. The depth is what the mechanism
// needs. If the suite's runtime has to come down, cut GAMES on the two-armed
// gates, or stop running the retired arm through the real search where the arm
// is only being reported — pregame-acceptance-check does the latter and says so.
// ⚠ THE FIXED SEVEN IS RETIRED. It was `MATURATION_YEARS = 7`, giving a
// PRE_GAME_DEPTH of 10, and that ten was SILENTLY COUPLED to
// PRIOR_HISTORY_YEARS, which also read 10. Bulk reserves begin at
// PRIOR_HISTORY_YEARS + 1, so while both were ten the pre-game's last played
// accident year (10) sat exactly one short of the first bulk year (11) and the
// two partitions met without touching. Nothing anywhere said so.
//
// Dropping PRIOR_HISTORY_YEARS to 5 broke it in the worst way available: the
// pre-game went on playing ten years while bulk began at six, so accident
// years 6 to 10 existed TWICE — once played, once bulk — and the opening
// double-counted them. Measured before the fix: 5 duplicated years on WC and
// GL, 2 on Property.
//
// ONE PARAMETER DRIVES BOTH NOW. The pre-game plays exactly the prior history
// the pricing reads, and everything older is a bulk reserve.
// opening-partition-check asserts the two never overlap and leave no gap.
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
   * in priorHistory (yearNumbers -4, -3), oldest first, aggregated the same way.
   * Kept for the Annual Statement, which shows all five; priorHistory is
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
  /** The pre-game's earlier years (-4, -3), kept for the Annual Statement. */
  earlyLineResults: LineResultSet[];
  lineState: LinePoolState;       // ending state (Year 1 opening for this line)
  cash: number;                   // this line's own ending operating cash
  unearnedPremium: number;
  members: Member[];              // this line's ending roster
  membershipHistory: MembershipHistory; // this line's pre-game enrollment ledger
  memberLossHistory: MemberLossHistory; // this line's pre-game marketplace loss record
  attempt: number;
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
export function simulateLineCandidate(
  instance: GameInstance,
  setup: GameSetupSettings,
  line: CoverageLine,
  attempt: number,
  // The surplus the line enters its first pre-game year with. Omitted, it is
  // the bootstrap's own pin; runLinePreGame passes the solved one.
  startingSurplus?: number,
): { lineResults: LineResultSet[]; poolState: PoolState; pooled: ResultSet[] } {
  const candidateInstance: GameInstance = attempt === 0
    ? instance
    : { ...instance, seed: (instance.seed + attempt * 997) >>> 0 };

  const soloSetup: GameSetupSettings = { ...setup, activeLines: [line] };
  const { poolState: bootstrap } = generateStartingPoolState(
    candidateInstance,
    setup.startingYear - PRE_GAME_DEPTH,
    [line],
    -(PRE_GAME_DEPTH - 1)
  );
  // ⚠ THE POOL STARTS WITH YEARS BEHIND IT (Prompt A commit 2). The
  // bootstrap's drawn seed cohorts are replaced by the bulk accident years —
  // the ones older than the pre-game inside the opening window — at their ages
  // at the pre-game's start, with their ledger rows, so pricing's window is
  // full from the first pre-game year and every pre-game balance sheet carries
  // them. They pay down on the recorded patterns through the pre-game, and the
  // opening keeps them as they stand. See preGameBulkYears.
  {
    const ls = bootstrap.lines[line];
    const book = ls.bookExposure !== undefined
      ? { exposure: ls.bookExposure * exposureFactor(line, 1) } : ls.members ?? [];
    const bulk = preGameBulkYears(line, book, setup.startingYear, PRE_GAME_DEPTH);
    bootstrap.lines[line] = {
      ...ls,
      reserveCohorts: bulk.cohorts,
      reserveDevelopment: bulk.ledger,
      netUnpaidReserve: bulk.cohorts.reduce((t, c) => t + c.netUnpaid, 0),
    };
  }
  // ⚠ THE STARTING SURPLUS IS THE ONLY CAPITAL EVENT IN THE PRE-GAME. From here
  // the line's surplus moves only by its income, dividends and assessments, year
  // by year, into the opening. invested is re-derived from the identity, loss
  // expense reserve included, so the first year opens balanced.
  {
    const ls = bootstrap.lines[line];
    const surplus = startingSurplus ?? ls.surplus;
    bootstrap.lines[line] = {
      ...ls,
      surplus,
      investedAssets: surplus + ls.netUnpaidReserve
        + lossExpenseReserve(line, ls.reserveCohorts ?? []) - bootstrap.cash,
    };
  }

  let gs: GameState = {
    setup: soloSetup,
    instance: candidateInstance,
    currentYearNumber: -(PRE_GAME_DEPTH - 1),
    isStarted: true,
    isComplete: false,
    poolState: bootstrap,
    lockedResults: [],
    currentDecisions: preGameDecisionSet(-(PRE_GAME_DEPTH - 1)),
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
    const processed = processYear(gs, preGameDecisionSet(y), { freezeMembership: true });
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
 * one: the board before them funded at PRE_GAME_FUNDING_LEVEL rather than at
 * expected.
 *
 * ⚠ IT IS THE ONLY DIFFERENCE, AND THAT IS THE POINT. Everything else about
 * the pre-game — renewals, intake, risk control, the tower, the aggregate —
 * stays on `defaultDecisionSet`, so the handed-over pool is one that was run
 * on the same settings the player starts from. A prior board that had also
 * been declining layers or cutting renewals would make the opening a function
 * of choices nobody can see, which is the objection the frozen membership
 * above answers for the roster.
 *
 * ⚠ AND THE PLAYER'S OWN DEFAULT IS UNCHANGED: `fundingAtExpected` is still
 * true from year 1. A team that locks year 1 without touching the slider is
 * funding at expected where the prior board funded with a cushion, so their
 * first rate comes in BELOW the declared year before it. That drop is real,
 * it is the first thing the Decisions panel's change column reports, and the
 * welcome memo states the 70% so it reads as inheritance rather than error.
 */
function preGameDecisionSet(yearNumber: number): DecisionSet {
  const d = defaultDecisionSet(yearNumber);
  for (const line of Object.keys(d.byLine) as CoverageLine[]) {
    d.byLine[line].fundingAtExpected = false;
    d.byLine[line].fundingConfidenceLevel = PRE_GAME_FUNDING_LEVEL;
  }
  return d;
}

// ⚠ NO SEARCH, NO BAND, NO REDRAW — ONE SIMULATION, THEN THE OPENING IS SET.
//
// What stood here ran up to 500 candidate seeds per line and accepted the
// first whose ending surplus landed inside OPENING_SURPLUS_BAND, falling back
// to the closest miss with a console warning. It existed because the opening
// was an EMERGENT property of a simulated past, and an emergent opening has to
// be filtered to be usable.
//
// ⚠ AND THAT MADE THE OPENING A FUNCTION OF EVERY PRICING CHANGE. The band is
// on surplus over required, required is a multiple of the reserve, and every
// commit that moved reserves or rates moved the candidate distribution under
// the band — so the pin had to be re-solved five times, the last of them by
// 206% on WC. The opening is now SET: the pre-game supplies the loss history
// and its own reserves, the older accident years are bulk cohorts from the
// patterns, and surplus is a stated multiple of required capital. A pricing
// change can no longer re-roll it.
//
// The pre-game still RUNS, at attempt 0, because pricing reads the loss
// history it produces. What is gone is accepting or rejecting the result.
function runLinePreGame(
  instance: GameInstance,
  setup: GameSetupSettings,
  line: CoverageLine
): LinePreGame {
  const developmentPct = setup.priorDevelopment?.[line] ?? PRIOR_DEVELOPMENT_DEFAULTS[line];
  // One pre-game from a given starting surplus, and how far its last year-end
  // misses the opening that the rule sets on the state it leaves.
  const run = (startingSurplus?: number) => {
    const c = simulateLineCandidate(instance, setup, line, 0, startingSurplus);
    const opened = finalizeLine(c, line, 0, developmentPct);
    return {
      start: c.pooled[0].byLine[line].beginingSurplus,
      gap: c.poolState.lines[line].surplus - opened.lineState.surplus,
      opened,
    };
  };
  // ⚠ EVERY START IS FLOORED AT ZERO, AND A POOL THAT HITS THE FLOOR KEEPS AN
  // OPENING RESET — THAT POOL ONLY. A pool cannot start its history insolvent,
  // and the engine cannot either: at and below zero the first year's balance
  // sheet stops tying and the year-end no longer depends on the start at all.
  // So no start goes below zero, and where even a zero start ends the pre-game
  // above the opening, applySetOpening's rule takes the difference out at the
  // opening, as it did before the smooth pre-game.
  //
  // WHY ANY POOL NEEDS IT (Prompt A commit 2). Since the bulk years are on the
  // books from the first pre-game year, the pre-game's rate is steady and
  // adequate from 2021, and the prior board funds it at the 70% cushion
  // (PRE_GAME_FUNDING_LEVEL, kept by ruling). So the pre-game EARNS — GL about
  // $37M over five years on some seeds — and where it earns more than the
  // opening the start that lands on it would be negative. Measured over 40
  // solo instances once Property opens on its full requirement: WC 0, GL 1,
  // Property 0 (see pregame-surplus-flow-check, which counts the floored pools
  // and exempts only them from "no reset at the opening").
  //
  // The dormant member path (MEMBER_LEVEL, gates only) needed the floor first:
  // with no shocks its pre-game ended above the opening from zero on 1 WC,
  // 7 GL and 29 Property of 40 host instances.
  return solvePreGameStart(run, line, 0).opened;
}

// ============================================================================
// THE STARTING SURPLUS, SOLVED — the pre-game starts from whatever surplus makes
// its last year-end land exactly on the set opening, so the five years flow into
// year 1 with no reset between them.
//
// ⚠ IT IS A SECANT ON THE WHOLE PRE-GAME, NOT A FORMULA FOR IT. Each step runs
// the line's pre-game from a trial start and measures the gap between its year-0
// year-end and the opening the rule sets ON THAT RUN'S END STATE; the next start
// is where the line through the last two (start, gap) points crosses zero. It
// never reads how the opening is set — only the opening it produces — so it
// holds for whatever the opening rule is.
//
// The losses, reserves and rates do not read surplus, so the year-end is affine
// in the start (an extra dollar in earns its investment return each year) and
// the second step lands (book mode: three runs, at most five, on 40 instances).
// The loop keeps going while anything nonlinear — dividends or assessments on a
// surplus basis, a rule that reads the year-end — leaves a gap, halves the
// bracket where the secant cannot step, and refuses to hand over a pre-game
// that does not close.
// ============================================================================
const PRE_GAME_START_TOLERANCE = 0.01; // dollars
// Ample for halving a bracket of hundreds of millions to a cent; the shipped
// path lands in three runs.
const PRE_GAME_START_MAX_STEPS = 60;

export function solvePreGameStart<T extends { start: number; gap: number }>(
  run: (startingSurplus?: number) => T,
  line: CoverageLine,
  // The lowest start allowed. If even the floor ends above the opening, the
  // floor's run is returned with its gap open — see the member path above.
  floor?: number,
): T {
  const clamp = (x: number) => (floor !== undefined && x < floor ? floor : x);
  const stuckAtFloor = (r: T) => floor !== undefined && r.start <= floor && r.gap > 0;
  // The tightest starts seen either side of the opening — once both exist the
  // root is between them, and a step that leaves them is replaced by halving.
  let below: T | undefined, above: T | undefined;
  const bracket = (r: T) => {
    if (r.gap < 0 && (!below || r.start > below.start)) below = r;
    if (r.gap > 0 && (!above || r.start < above.start)) above = r;
  };
  let a = run();
  if (Math.abs(a.gap) <= PRE_GAME_START_TOLERANCE) return a;
  bracket(a);
  // First step assumes a dollar in is a dollar out; the secant corrects it.
  let b = run(clamp(a.start - a.gap));
  for (let step = 0; step < PRE_GAME_START_MAX_STEPS && Math.abs(b.gap) > PRE_GAME_START_TOLERANCE; step++) {
    // At the floor and still above the opening: nothing allowed closes it.
    if (stuckAtFloor(b)) return b;
    bracket(b);
    const slope = (b.gap - a.gap) / (b.start - a.start);
    let next = b.start - b.gap / slope;
    // ⚠ A FLAT STRETCH IS NOT THE END WHEN THE ROOT IS BRACKETED. Just above
    // zero the first year's balance sheet stops tying and the year-end stops
    // responding to the start (measured on the member path: $0 and $0.75M end
    // identically). A secant through two points on that stretch has no slope,
    // but a bracket still holds the root, so halve it.
    const inside = below && above && next > below.start && next < above.start;
    if (below && above && (!Number.isFinite(next) || !inside)) {
      next = (below.start + above.start) / 2;
    } else if (!Number.isFinite(slope) || Math.abs(slope) < 1e-9) {
      // No slope and no bracket: the year-end does not depend on the start — a
      // reset somewhere inside the pre-game — and no start can close the gap.
      throw new Error(`pre-game ${line}: year-end does not respond to the starting surplus (slope ${slope})`);
    }
    a = b;
    b = run(clamp(next));
  }
  if (stuckAtFloor(b)) return b;
  if (Math.abs(b.gap) > PRE_GAME_START_TOLERANCE) {
    throw new Error(`pre-game ${line}: starting surplus did not converge (gap ${b.gap})`);
  }
  return b;
}


// ============================================================================
// THE SET OPENING, APPLIED. The pre-game's ending book IS the opening book:
// the bulk years it started with and the years it played, as they stand.
// Surplus is the ruled multiple of required capital on that reserve — and the
// pre-game started from the surplus that lands its last year-end exactly there
// (solvePreGameStart), so setting it moves nothing.
//
// ⚠ NOTHING IS SWAPPED IN (Prompt A commit 2). Until then the bootstrap's drawn
// seed cohorts ran through the pre-game and were replaced here by bulk cohorts
// out to each pattern's end, so the reserve jumped at the boundary (WC $39M at
// the end of 2025, $75M at the opening). The bulk years are now on the books
// from the start of the pre-game, and accident years older than
// OPENING_RESERVE_YEARS are closed — none should be open here, and the filter
// says what the window is rather than finding anything.
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
): LinePoolState {
  const oldest = 1 - OPENING_RESERVE_YEARS;
  const open = (ls.reserveCohorts ?? []).filter(c => c.yearNumber >= oldest);
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
  // The FULL requirement: Property's retained-catastrophe charge included, on
  // the same book the bulk years were sized on. See setOpeningSurplus.
  const bookForCapital = ls.bookExposure !== undefined
    ? { exposure: ls.bookExposure * exposureFactor(line, 1) } : ls.members ?? [];
  const surplus = setOpeningSurplus(line, netUnpaidReserve, openingCatCapital(line, bookForCapital));
  const kept = new Set(open.map(c => c.yearNumber));
  const reserveDevelopment = (ls.reserveDevelopment ?? []).filter(r => kept.has(r.yearNumber));
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
    lineState: applySetOpening(line, c.poolState.lines[line], c.poolState.cash, developmentPct),
    cash: c.poolState.cash,
    unearnedPremium: c.poolState.unearnedPremium,
    members: c.poolState.lines[line].members,
    membershipHistory: c.poolState.membershipHistory,
    memberLossHistory: c.poolState.memberLossHistory ?? {},
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
  // the opening from a solved start, see solvePreGameStart.)
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
      bookUnits: Object.fromEntries(setup.activeLines.map(l => [l, openingBookUnits(instance.seed, l)])),
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
