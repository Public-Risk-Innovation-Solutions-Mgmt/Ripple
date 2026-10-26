// ============================================================================

// ============================================================================
// ⚠ THE HANDLER AND THE FRONT END MUST BE DEPLOYED TOGETHER WHEN multiplayer
// GOES LIVE. THIS IS NOT A STYLE NOTE.
//
// This file changed in a way that is NOT backward compatible in one direction:
//   - a room now carries `lines` and `priorDevelopment`, set at creation;
//   - `join` no longer sends `lines`, and LINES_LOCKED is gone.
//
// A NEW FRONT END against an OLD handler is the break: createRoom's `lines` is
// dropped on the floor, the room is made without them, and every join is then
// refused with INVALID_REQUEST ("a team must play at least one coverage line")
// because the new client sends none. The room is unjoinable. The reverse — an
// old client against a new handler — is survivable by design: the new server
// IGNORES a stray `lines` on a join and hands back the room's set.
//
// The two ship through DIFFERENT PIPELINES (.github/workflows/handler.yml
// builds and promotes the Lambda zip; the front end is built and served
// separately), so nothing enforces this ordering for you. Deploy the handler
// FIRST, then the front end — that order is safe in both directions.
//
// NOTHING ON `multiplayer` IS DEPLOYED TODAY, so there is no live break to fix;
// this is recorded for whoever first takes this branch to an environment.
// See docs/handoff/AWS_HANDLER_HANDOFF.md, which carries the same warning.
// ============================================================================
// THE SESSION CONTRACT — five endpoints, one interface, no implementation.
//
// ⚠ THIS FILE IS THE DELIVERABLE. localStorage is the FIRST implementation of
// it, not the design. A second implementation against HTTP must drop in with no
// client change, and everything in this file exists to make that true. If a
// swap to a hosted backend turns out to touch anything above this layer, the
// fault is here, not there.
//
// THREE RULES THAT MAKE THE SWAP A BASE-URL CHANGE RATHER THAN A REWRITE:
//
//   1. EVERY PAYLOAD IS PLAIN JSON. No class instances, no Date objects, no
//      functions, no Map/Set. Timestamps are epoch millis. A request object is
//      exactly what a POST body would carry and a response object is exactly
//      what one would return, so `JSON.stringify(req)` over `fetch` is the
//      whole of the HTTP implementation's marshalling.
//
//   2. AUTHORITY TRAVELS AS A TOKEN FIELD ON THE REQUEST. Not as connection
//      state, not as a module-level "current user", not as something the
//      transport remembers between calls. Every call that needs authority
//      carries it explicitly, so the HTTP implementation lifts that field into
//      an `Authorization` header and changes nothing else. A transport that
//      remembered who you were would be a transport that could not be
//      statelessly re-pointed.
//
//   3. THE ENGINE'S DATA IS OPAQUE. `decisions` and `result` are JsonValue and
//      this layer NEVER looks inside them. It stores them, hands them back, and
//      carries the last one forward. That is what keeps the session layer from
//      growing a second, divergent opinion about what a decision is — and it is
//      why nothing in src/utils had to change to make multiplayer work.
//
// ASYNC AND FALLIBLE FROM DAY ONE. Every method returns a promise and every
// method can reject. That is not defensive padding: the localStorage
// implementation is synchronous underneath and could have exposed a synchronous
// API, which would have compiled fine and then needed every call site rewritten
// the first time a real network appeared. Loading and failure states get built
// and exercised now, against a fake latency and an injectable fault, rather than
// discovered against the first real network.
// ============================================================================

import type { CoverageLine } from '../types/simulation';

// ---------------------------------------------------------------- json

// What may cross the boundary. Deliberately narrow: if a payload cannot be
// expressed in this type it cannot survive a real HTTP hop either, so the
// compiler refuses it here rather than the network refusing it later.
export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// ---------------------------------------------------------------- shocks

// The shock schedule the room carries — and every team's game is built from it.
//
// ⚠ CONSUMED NOW, THROUGH THE ENGINE'S OWN CONSTRUCTOR. buildTeamGame
// (client/buildGame.ts) passes this list to generateGameInstance, which takes a
// schedule as an argument from both callers — solo passes an empty one — and
// resolveShocks then reads it as a deterministic, year-filtered list that
// consumes no randomness. `ScheduledShock` in src/types/shocks.ts is
// structurally identical to this type.
//
// ⚠ THE ROOM RECORD IS WHAT MAKES EVERY TEAM FACE THE SAME SCHEDULE. A host's
// randomised schedule is drawn once, on the host's client at creation
// (session/shockDraw.ts), and arrives here as concrete entries like a
// hand-picked one; no client ever re-draws it. It is readable by every caller —
// it has to be, since every player's browser builds from it — so what players
// do not see is a screen decision, not a secret.
export interface ScheduledShockSpec {
  shockId: string;
  yearNumber: number;
}

// ---------------------------------------------------------------- errors

export type SessionErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'TEAM_NOT_FOUND'
  | 'TEAM_TAKEN'
  | 'BAD_TOKEN'
  | 'NOT_HOST'
  | 'WRONG_YEAR'
  | 'GAME_COMPLETE'
  | 'INVALID_REQUEST'
  // ⚠ A NEW TEAM ARRIVED AFTER THE FIRST ADVANCE. Refused by the SERVER, not
  // only greyed out on the lobby: the screen knowing the rule is a courtesy to
  // the player, and a client that skips the lobby and posts straight to /join
  // must meet the same answer. A REJOIN is not this — a team already in the
  // room returns with its own token at any status. See mayCreateTeam.
  | 'EVENT_IN_PROGRESS'
  // ⚠ 'LINES_LOCKED' WAS HERE AND IS GONE, DELIBERATELY. It refused a rejoin that
  // asked for different coverage lines than the team already held. A team cannot
  // ask for lines at all any more — the HOST picks the room's lines at creation
  // and every team plays them, so JoinRequest carries no `lines` field and there
  // is nothing left to disagree with. The guard is not relaxed; the state it
  // guarded against is unreachable. Removing it rather than leaving it reserved
  // is the honest record: a code no server can emit is one a client will be
  // written to handle for no reason.
  | 'TRANSPORT_FAILURE';

// ⚠ ONE ERROR TYPE FOR EVERY IMPLEMENTATION, and `code` is what callers branch
// on — never the message. An HTTP implementation maps status codes onto these
// same codes (404 -> ROOM_NOT_FOUND, 403 -> BAD_TOKEN/NOT_HOST, 409 ->
// WRONG_YEAR, anything else -> TRANSPORT_FAILURE) and every existing catch block
// keeps working untouched.
//
// `retryable` separates "the call was wrong" from "the pipe was" — a UI retries
// the second and reports the first. That distinction is invisible while the
// pipe is localStorage and load-bearing the moment it is not.
export class SessionError extends Error {
  readonly code: SessionErrorCode;
  readonly retryable: boolean;

  constructor(code: SessionErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
    this.retryable = retryable;
  }
}

// ---------------------------------------------------------------- tokens

/**
 * Mint a bearer token. CLIENTS call this now, not only the server.
 *
 * ⚠ THE CLIENT GENERATES ITS OWN TOKEN SO THAT A RETRY CAN PRESENT THE SAME
 * ONE, which is the whole of the idempotency fix for `join` and `createRoom`.
 * While the server minted it, a lost RESPONSE was unrecoverable: the team
 * existed, the token that owned it had gone back down a socket nobody was
 * listening on, and the retry read as a second person claiming a taken name —
 * TEAM_TAKEN, in front of a room, locking a player out of a team they had just
 * created. Nothing on the client could fix that, because the only copy of the
 * secret was in the response that never arrived.
 *
 * ⚠ IT IS NOT A WEAKER SECRET. Same alphabet, same length, same
 * crypto.getRandomValues as the server's. What changes is WHO holds it first.
 * The server still refuses a token that is already in use by somebody else —
 * see the collision guard in the local transport — so a client cannot claim a
 * seat by guessing, any more than it could before.
 */
export function newSessionToken(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 32; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** What a token must look like for the transport to accept it from a caller. */
export const SESSION_TOKEN_PATTERN = /^[a-z0-9]{32}$/;

/**
 * THE SEEDS A ROOM MAY BE CREATED WITH — the scenario numbers "1" to "20", as
 * text (stable-scenarios commit 9). The scenario is the game's only seed, and
 * solo setup offers the same twenty (utils/scenarios.ts reads them from here).
 * Both transports refuse any other seed at createRoom.
 *
 * ⚠ THE ROOM'S SHAPE IS UNCHANGED — `seed` stays a string — so no stored room
 * moves and keys.ts is untouched. The handler must still deploy FIRST: a front
 * end that sends only these is accepted by the old handler, but a handler that
 * refuses others must be live before anything relies on the refusal.
 */
export const ROOM_SEEDS: readonly string[] = Array.from({ length: 20 }, (_, i) => String(i + 1));
export const isRoomSeed = (seed: unknown): boolean => typeof seed === 'string' && ROOM_SEEDS.includes(seed);

export function isSessionError(e: unknown): e is SessionError {
  return e instanceof SessionError;
}

// ---------------------------------------------------------------- results

/**
 * The five figures the host's Teams tab scans, for one scope of one team-year.
 *
 * ⚠ EVERY ONE IS A RESULT_METRICS KEY, AND THAT IS THE POINT. The on-screen
 * spreadsheet and the .xlsx export share one list precisely because two copies
 * drifted twice; a host table quoting figures from a list of its own would be
 * the third copy. Field for field:
 *
 *   endingSurplus                  <- RESULT_METRICS 'endingSurplus'
 *   actualLossRatioPricingBasis    <- 'actualLossRatioPricingBasis'
 *   poolPremium                    <- 'poolPremium'
 *   activeExposure                 <- 'activeExposure' ("Active Payroll
 *                                     Exposure ($M)"). ⚠ REPLACED
 *                                     `activeMembers`, and the reason is the
 *                                     same one that pruned the metric list: the
 *                                     multiplayer game shows the pool in
 *                                     aggregate, so a host table counting
 *                                     MEMBERS was reading a figure the player
 *                                     can no longer see. It is still a
 *                                     RESULT_METRICS key, which is the rule
 *                                     this field list exists to keep.
 *   selectedFundingConfidenceLevel <- 'fundingConfidenceLevel' (the metric reads
 *                                     this field; the key is named for the
 *                                     decision, the field for what was selected)
 *   netUltimateLoss                <- 'netUltimateLoss' ("Net Ultimate Loss +
 *                                     LAE"), added for the Charts tab
 *
 * ⚠ netUltimateLoss AND NOT netIncurredLoss, AND THE NEAR MISS IS WORTH
 * RECORDING. netIncurredLoss is a real ResultSet field and is NOT in
 * RESULT_METRICS — picking it would have been grossPremium a second time, a
 * figure published to a second party from a list nobody curated. Of the two,
 * netUltimateLoss is also the one the chart wants: it is this year's losses
 * after reinsurance recovery, which is what reaches surplus, where
 * netIncurredLoss folds in prior-year reserve development and so moves for
 * reasons that did not happen this year.
 *
 * ⚠ AND poolPremium REPLACES grossPremium, WHICH WAS NEVER IN THE LIST. The
 * first version of this summary posted grossPremium — a real ResultSet field,
 * but not a metric anybody had chosen to publish. It had already forked, quietly
 * and by one field. It reads as Pool Premium at Selected CLF now, the same thing
 * the Result Spreadsheet calls it.
 */
export interface TeamYearFigures {
  endingSurplus: number;
  actualLossRatioPricingBasis: number;
  poolPremium: number;
  /**
   * ⚠ EXPOSURE, NOT A MEMBER COUNT, and the field was RENAMED rather than
   * repurposed so no stored row can be misread. A row written before this
   * carries `activeMembers` and no `activeExposure`; a reader gets undefined
   * for the new field rather than a member count silently displayed as payroll.
   * See the deploy-order warning at the head of this file — this is a second
   * reason the handler and the front end ship together.
   */
  activeExposure: number;
  /**
   * ⚠ OPTIONAL, AND ITS ABSENCE IS INFORMATION. On a LINE's figures it is that
   * line's own choice and is always present. On the POOL's it is present only
   * when every line the team writes chose the SAME stop — then the pool really
   * does have a funding level. When they differ there is no pool level and this
   * is absent; the host renders a dash. Absent means "these differ", not zero.
   */
  selectedFundingConfidenceLevel?: number;
  netUltimateLoss: number;
  /**
   * ⚠ THE HOST'S TEAMS TABLE, AND EACH IS THE TEAM'S OWN FIGURE — read off its
   * Annual Statement as it stood at this year, so the host prints exactly what
   * the team sees. OPTIONAL: a row posted before these existed has none, and the
   * host renders a dash. The handler stores the summary whole, so no handler
   * change; across a deploy gap either side reads what it knows.
   *
   *   combinedRatio      cumulative since the game began — the statement's
   *                      first row's Total, the team's top-bar figure (over the
   *                      pre-game years before year 1 is played)
   *   premiumToSurplus   the balance sheet's Premium to Surplus for this year
   *   ratePer100         a LINE's rate charged this year, per $100 of exposure;
   *                      absent on the pool, whose lines have different units
   *   rateChange         that rate against the year before's, as a fraction
   */
  combinedRatio?: number;
  premiumToSurplus?: number;
  ratePer100?: number;
  rateChange?: number;
}

/**
 * What a team posts at the end of a year, and the ONE payload in this contract
 * that is typed rather than opaque.
 *
 * ⚠ THE OPAQUE/TYPED SPLIT, AND THE RULE THAT DECIDES IT. A payload a SECOND
 * PARTY renders has to have an agreed shape, or the agreement lives in two
 * places and drifts; a payload read only by the client that wrote it is better
 * left opaque, because this layer then cannot be broken by a change to it.
 *
 * ⚠ THIS NOTE USED TO READ "DECISIONS STAY OPAQUE; RESULTS DO NOT" AND THAT
 * HALF IS NOW WRONG — the rule is unchanged, the FACT it was applied to moved.
 * The live decision stream is still opaque: SubmitRequest.decisions is JSON
 * this layer does not inspect, and CallerView.decisionsByYear hands it back to
 * the one client that wrote it. What changed is that the host now renders each
 * team's decisions for a COMPLETED year, which makes that reading a second
 * party and so demands an agreed shape — supplied by TeamYearDecisions below,
 * a chosen projection rather than LineDecisionSet itself.
 *
 * The two live side by side on purpose. Opaque where one client reads it,
 * typed where two do.
 *
 * ⚠ byLine CARRIES ONLY THE LINES THE TEAM WRITES. A team that does not write GL
 * has no GL entry — not a zeroed one. That absence is what lets the host's table
 * say "does not write GL" instead of showing a surplus of $0, and it is the
 * distinction the whole Teams tab turns on.
 */
/**
 * ⚠ THE DEVELOPED TRIANGLE'S CURRENT COLUMN: one program year's NET ULTIMATE,
 * LOSS + LAE, AT THIS VALUATION — the team's Annual Statement's Net Ultimates,
 * keyed by accident year as a string. Posted afresh every year, because that is
 * what makes it the current column rather than a frozen one; earlier posts are
 * never rewritten, and the host reads the newest.
 *
 * ⚠ AND IT IS NOT A RESULT_METRICS KEY, WHICH IS A STATEMENT AND NOT AN
 * OVERSIGHT. A RESULT_METRICS entry maps ONE ResultSet to ONE value; this is a
 * value per accident year per valuation, and it does not live on a ResultSet at
 * all — it is the statement's program-year valuation of the ledger. Inventing a
 * metric key for it would be the grossPremium mistake in reverse: not a figure
 * published from outside the list, but a quantity forced into a list it does
 * not fit. What this DOES reuse is the statement's own reader —
 * resultsStatement's netUltimatesByProgramYear, the code the Net block's
 * Ultimates row is printed from. One field, one derivation, two readers: the
 * team's statement and the host's views print the same figure for every year.
 */
export type DevelopedUltimates = Record<string, number>;

// ============================================================================
// WHAT A TEAM CHOSE, AS THE HOST READS IT BACK AFTER THE YEAR IS ADVANCED.
//
// ⚠ THIS IS THE SHAPE'S ONE DEFINITION AND IT LIVES HERE, IN THE CONTRACT,
// beside TeamYearFigures and for the same reason: a payload a SECOND PARTY
// renders has to have an agreed shape, or the agreement lives in two places and
// drifts. LineDecisionSet in types/simulation.ts stays exactly as it is — it is
// the engine's input type, it carries fields no host screen shows
// (loanRepaymentAggressiveness, riskControlProgramIds, riskControlIncentivePct)
// and it will go on changing for engine reasons. This is a projection OF it,
// chosen field by field, so an engine-side change cannot silently alter what
// crosses the wire or what a stored row means.
//
// ⚠ NOT RESULT_METRICS ENTRIES, AND THAT IS A STATEMENT RATHER THAN AN
// OVERSIGHT. RESULT_METRICS publishes values OF A ResultSet — what a played
// year produced. These are INPUTS: what the team asked for before the year ran.
// They do not live on a ResultSet at all, so there is no ResultSet field for a
// metric key to name, and inventing one would put an input into the list of
// outputs. Same reasoning DevelopedUltimates carries above.
//
// ⚠ "FUNDING LEVEL" IS TWO FIELDS AND MUST STAY TWO. `atExpected` true means
// break-even, CLF exactly 1.000, which is a MODE and not a percentile — it
// falls between stops and moves with the book. Flattening it to a number would
// record a stop the team did not choose. When it is true, `confidenceLevel` is
// only the stop the slider would land on if the team dragged off Expected; the
// host screen shows "Expected", not the number. See LineDecisionSet.
export interface TeamLineDecisions {
  confidenceLevel: number;
  atExpected: boolean;
  /**
   * THE REINSURANCE the team bought on this line — with AGGREGATE_STOP on
   * (stable-scenarios commit 6), one id from AGGREGATE_STOP_OPTIONS: 'none',
   * 'working', 'bad-year' or 'catastrophe'; with it off, a package from
   * REINSURANCE_OPTIONS[line] (e.g. '$9M xs $1M'). Loss engine commit 4a: it
   * replaces `layersPlaced` (per band) and `aggregateStopLevel`, which are gone
   * from the wire. ⚠ THE SHAPE IS UNCHANGED BY THE STOP — still one string the
   * server stores without reading — so the handler, both transports and
   * keys.ts need no change for it; only the values a client writes do.
   */
  reinsuranceOption: string;
  /**
   * "Non-renewal": the share of the book at the start of the year not renewed,
   * a FRACTION 0–0.05. Absent on the engine side reads as 0.
   *
   * ⚠ simple underwriting: this and newMembers REPLACE uw-hybrid's
   * `renewalsDeclined` and `newBusinessRejection` (which replaced `renewalCut`
   * and `intakeLevel`). Still two scalars the server stores without reading, so
   * the handler, both transports and keys.ts change only in their notes; a row
   * written before carries the old names and the host reads 0% for both.
   */
  nonRenewal: number;
  /** "New members": the share of the book at the start of the year added, a FRACTION 0–0.05. */
  newMembers: number;
  riskControlPct: number;
  dividendPct: number;
  assessmentPct: number;
  /**
   * ⚠ PERCENTAGE POINTS, 0-100 — NOT a fraction, unlike every other field on
   * this interface. That is AssetAllocation's own convention and it is carried
   * unchanged rather than normalised, so a stored row means the same thing as
   * the engine's own value and no conversion can go missing in one direction
   * only. Readers must print it directly; putting it through a percent
   * formatter yields "1000%", which is how the first host render of it read.
   */
  allocation: { cashPct: number; bondsPct: number; equitiesPct: number };
}

/**
 * ⚠ OPTIONAL, AND ITS ABSENCE IS INFORMATION TWICE OVER.
 *
 * Absent on YEAR 0, because year 0 is the opening position — it is posted the
 * moment a team builds its game, before anybody has decided anything, and a
 * decisions block there would be inventing choices nobody made.
 *
 * Absent on a row WRITTEN BEFORE THIS FIELD EXISTED. A host reading an old
 * room gets no decisions for its years rather than a block of zeros, and the
 * screen renders "not recorded" instead of a funding level of 0.00 that would
 * read as a real and alarming choice. See the deploy-order warning at the head
 * of this file: this is another reason the handler ships before the front end.
 *
 * Absent for a caller who is not the HOST. See TeamView.resultsByYear.
 */
export type TeamYearDecisions = Partial<Record<CoverageLine, TeamLineDecisions>>;

export interface TeamYearSummary {
  /**
   * ⚠ 0 IS A LEGITIMATE YEAR HERE, AND IT IS THE OPENING POSITION. The pre-game
   * runs real engine years before year 1 — that is why an opening reserve, an
   * opening roster and an opening surplus exist at all — and its last year is
   * numbered 0. Posting it is what lets a chart start where the game starts
   * rather than at the first decision. A negative year is refused: the earlier
   * pre-game years are the scaffolding that built the opening position, not part
   * of the session the host is running.
   */
  yearNumber: number;
  calendarYear: number;
  /** The pooled row — the aggregate, meaning what it means everywhere else. */
  pool: TeamYearFigures;
  byLine: Partial<Record<CoverageLine, TeamYearFigures>>;
  /**
   * ⚠ EVERY ACCIDENT YEAR SO FAR, RE-REPORTED AT THIS YEAR'S VALUATION — a
   * TRIANGLE COLUMN, not a line. pool.netUltimateLoss above is the accident
   * year as BOOKED when it happened and is frozen forever; this says what every
   * accident year is thought to cost NOW. Under forward booking those are very
   * different numbers — measured on a ten-year WC game, an accident year's
   * latest valuation runs 1.2x its booked figure at age 2 and 1.85x by age 12 —
   * and a chart with only the first can never show the second happening.
   *
   * ⚠ IT IS THE ONLY PART OF THIS PAYLOAD THAT RESTATES THE PAST, and that is
   * the cost of the thing: each post carries a number per accident year per
   * scope rather than one number. Accident years BELOW 0 are dropped — the
   * pre-game's own years and the seeded cohorts are off the chart's axis, and
   * carrying fourteen of them in every post forever is a payload nothing reads.
   */
  developed?: {
    pool: DevelopedUltimates;
    byLine: Partial<Record<CoverageLine, DevelopedUltimates>>;
  };
  /**
   * ⚠ WHAT THE TEAM CHOSE FOR THIS YEAR — carried in the record the team
   * ALREADY posts at year end, which is what makes the timing right for free.
   * This record is written when a year is posted, so the host cannot read a
   * year's decisions before that year is advanced: there is no row to read.
   * No new endpoint, and no change to who may call what.
   *
   * ⚠ HOST ONLY. Both transports strip this for a non-host caller, so a viewer
   * or another team sees nothing new. A team's own decisions reach it the way
   * they always did, through CallerView.decisionsByYear.
   */
  decisions?: TeamYearDecisions;
  /**
   * THE SPREAD BEHIND THE AVERAGE (loss engine commit 4b). Every figure above is
   * the AVERAGE across the team's worlds; this is the pool's ending surplus in
   * the worst, middle and best of them. Absent for the opening position (one
   * world, before any year is played) and on a one-world build. ⚠ A CONTRACT
   * CHANGE — deploy the handler first; see docs/handoff/AWS_HANDLER_HANDOFF.md.
   */
  surplusRange?: { min: number; median: number; max: number };
}

// ---------------------------------------------------------------- market share

/**
 * A TEAM'S SHARE OF THE ROOM — multiplayer only, and a different measure from
 * single player's share of the full market.
 *
 *   per line  the team's exposure on the line / the total exposure on that line
 *             of every team in the room that writes it
 *   pool      the team's total premium / the room's total premium — the lines'
 *             exposures are in different units (payroll, TIV), premium is not
 *
 * Fractions, not percentages. At the opening every team holds the same book, so
 * N teams each read 1/N on every line and the pool.
 */
export interface TeamMarketShare {
  pool: number;
  byLine: Partial<Record<CoverageLine, number>>;
}

/** One team's room share with the result year it is from — CallerView.marketShare. */
export type TeamMarketShareOfYear = TeamMarketShare & { year: number };

/**
 * ⚠ WORKED OUT ONCE PER YEAR AND STORED WITH THE ROOM, so the host and every
 * player read the same figures. The set for year Y is computed in the SUBMIT
 * that brings in the last year-Y result from the teams that locked in year Y
 * (results are computed by the clients after the host advances, so no advance
 * call ever holds them). A team that did not lock in year Y counts as stopped:
 * nobody waits for it, and its last reported figures (its newest result at or
 * before Y) stay in the totals. A team that locked in and has not yet posted
 * is waited for.
 *
 * ⚠ SHOWN FOR THE LATEST KNOWN YEAR, ONE YEAR BEHIND LIKE EVERY OTHER RESULT:
 * with the room deciding year N the set shown is year N - 2's (the year before
 * the one in progress), the last year's once the game is over — see
 * marketShares.ts's shownShares. Before the first advance that year is 2025,
 * which no team posts; every team played the same pre-game, so the opening
 * posts (year 0) stand in, at 1/N each.
 *
 * ⚠ HOST ONLY ON RoomView. A player or viewer gets its own team's figure on
 * CallerView.marketShare and never another team's.
 *
 * ⚠ OPTIONAL ON THE WIRE BOTH WAYS. A handler older than this sends neither
 * field, and a front end older than it ignores them: the newer front end then
 * shows no chip (never the old share of the whole market), and the older one
 * keeps what it showed. Deploy the handler first.
 */
export interface RoomMarketShares {
  /** The result year the figures are from: 0 is the opening books (and stands in for 2025). */
  year: number;
  /** Keyed by team name. A team with no result yet is absent. */
  byTeam: Record<string, TeamMarketShare>;
}

// ---------------------------------------------------------------- views

export type RoomStatus = 'lobby' | 'running' | 'complete';
export type CallerRole = 'host' | 'player' | 'viewer' | 'anonymous';

// ============================================================================
// THE EVENT'S STATUS — THE LOBBY'S AXIS, AND IT IS NOT RoomStatus.
//
// ⚠ TWO STATUS TYPES, AND THE SECOND IS NOT A TIDY-UP OF THE FIRST. RoomStatus
// above turns 'lobby' -> 'running' WHEN THE FIRST TEAM JOINS. The lobby needs a
// different boundary: an event with six teams waiting for the host is still
// OPEN — joining it is exactly what the lobby is for — and it stops being open
// at the HOST'S FIRST ADVANCE, because that is the moment a new team would have
// missed a played year.
//
//   OPEN         currentYear === 1           nothing has been advanced
//   IN_PROGRESS  1 < currentYear <= yearCount
//   FINISHED     currentYear > yearCount     the last year has been advanced
//
// Collapsing the two would have moved RoomStatus's meaning under every existing
// reader of it (HostRoomScreen, PlayScreen, the harness), to make one word
// serve two questions. They are different questions, so they are different
// types, and neither is derived from the other.
//
// ⚠ ONE DERIVATION, EXPORTED, AND EVERY IMPLEMENTATION CALLS IT. The local
// transport, the Lambda handler and the lobby index all have to agree about
// when an event stops being joinable; a second copy of this arithmetic is how
// the server and the screen come to disagree about who may join.
export type EventStatus = 'OPEN' | 'IN_PROGRESS' | 'FINISHED';

export function eventStatusOf(currentYear: number, yearCount: number): EventStatus {
  if (currentYear > yearCount) return 'FINISHED';
  if (currentYear > 1) return 'IN_PROGRESS';
  return 'OPEN';
}

/**
 * ⚠ THE ONE RULE BOTH THE SCREEN AND THE SERVER READ. A NEW team may be created
 * only while the event is OPEN. The screen greys the Team Leader card with this;
 * the server refuses with it. The screen is a courtesy — the server is the rule,
 * which is why this lives in the contract and not in a component.
 *
 * It does NOT govern a REJOIN: a team already in the room comes back with its
 * own token at any status, or a refreshed browser would lose its seat the moment
 * the host advanced. Nor does it govern a viewer, who may always watch.
 */
export function mayCreateTeam(status: EventStatus): boolean {
  return status === 'OPEN';
}

/**
 * ONE ROW OF THE LOBBY. Deliberately small: the lobby lists events, it does not
 * preview them, and every field here is one a player needs to choose a row.
 *
 * ⚠ NO TOKENS, NO ROSTER, NO SHOCKS. This payload is served to ANYONE — the
 * lobby has no passcode — so it carries nothing a room's own `read` would
 * redact. `teams` is a COUNT, not names: the names are in the room, behind a
 * join, and a lobby that listed them would publish who is playing to the world.
 */
export interface LobbyEvent {
  code: string;
  eventName: string;
  status: EventStatus;
  /** How many teams have joined so far. A count, never the names. */
  teams: number;
  currentYear: number;
  yearCount: number;
}

// ⚠ NO FILTER, NO CURSOR, NO PAGE. The list is short by construction — FINISHED
// events drop off it and hidden ones never appear — so paging would be
// machinery for a case that does not arise. If it ever does, a cursor is an
// additive field here.
export type ListEventsRequest = Record<string, never>;

export interface ListEventsResponse {
  /** OPEN first, then IN_PROGRESS; each newest first. Never FINISHED, never hidden. */
  events: LobbyEvent[];
}

/**
 * THE HOST TAKES AN EVENT OFF THE LOBBY, OR PUTS IT BACK.
 *
 * ⚠ HIDING IS NOT CLOSING, AND THE DISTINCTION IS THE WHOLE POINT. A hidden
 * event keeps running, its teams are unaffected, and ITS DIRECT LINKS KEEP
 * WORKING — /join/CODE, /view/CODE and the host's own screen all behave exactly
 * as before. It leaves the LIST and nothing else.
 *
 * ⚠ AND THAT IS CONSISTENT WITH THE LATE-JOIN RULE RATHER THAN A HOLE IN IT.
 * Hiding does not grant anything: a hidden OPEN event can still be joined by
 * someone with the code, which is the same as an unlisted room has always been;
 * a hidden IN_PROGRESS event refuses a new team exactly as a listed one does,
 * because that refusal keys on STATUS, not on listing. So "hidden" is about who
 * can FIND it, and "in progress" is about who may JOIN it — two independent
 * questions, and neither is a way around the other.
 */
export interface SetEventHiddenRequest {
  code: string;
  /** Host token only. Enforced by the implementation, not by hiding the control. */
  token: string;
  hidden: boolean;
}

export interface SetEventHiddenResponse {
  room: RoomView;
}

// What a team looks like to anyone allowed to see the table.
//
// ⚠ PRESENCE AND PROGRESS ONLY — NEVER ANOTHER TEAM'S DECISIONS. The host runs
// the room; the host does not need to see what a team chose before that team's
// year is processed, and a host screen that could show it would be one
// accidental render away from projecting it. `read` enforces this rather than
// trusting the caller to look away.
export interface TeamView {
  name: string;
  // ⚠ THE LINES THIS TEAM PLAYS, WHICH ARE NOW THE ROOM'S. It used to be the
  // team's own choice at join, and the note here used to say teams in one room
  // play different books. They do not any more: the host sets the room's lines
  // and every team takes them, so this is a copy of RoomView.lines kept because
  // the host's table and a viewer both read the team row rather than the room.
  // It is written from the room at join and never from a request.
  lines: CoverageLine[];
  joined: boolean;
  // The last year this team locked decisions for, or null if it never has.
  lockedYear: number | null;
  // Locked for the room's CURRENT year specifically — what the host's table and
  // the advance control actually key on.
  locked: boolean;
  /**
   * The highest PLAYED year this team has posted a result for, or null — a
   * convenience over resultsByYear for the Game Setup tab's Reported column.
   *
   * ⚠ IT IGNORES YEAR 0, AND THE ASYMMETRY IS THE POINT. The opening position
   * is posted as year 0 the moment a team builds its game, before anybody has
   * decided anything. It belongs on a chart's x-axis and it is NOT a year the
   * team has played, so a host's "Reported: year 0" against a team that has done
   * nothing yet would be a tick for turning up.
   */
  resultYear: number | null;
  /**
   * ⚠ THE SCOREBOARD, AND THE HOST IS MEANT TO SEE IT. The redaction rule next
   * to callerView still holds for DECISIONS — presence and progress, never
   * content — because a host who could read what a team chose before the year is
   * processed is one render away from projecting it. A posted RESULT is the
   * opposite: it is the thing the room exists to compare, it describes a year
   * already played, and the host's Teams tab is where it is read.
   *
   * ⚠ EVERY YEAR, NOT THE LATEST ONE, AND IT WAS A SLOT UNTIL THE CHARTS TAB
   * NEEDED OTHERWISE. This is the same defect the decision history fixed, in a
   * different field: one slot per team can serve a table of the last completed
   * year and cannot serve a line over time, because the host's record only ever
   * held the most recent year. Keyed by year as a STRING, per JSON.
   *
   * ⚠ YEAR "0" IS THE OPENING POSITION, NOT A PLAYED YEAR. See TeamYearSummary.
   *
   * ⚠ "THE HOST IS MEANT TO SEE IT" — BUT TODAY EVERYONE DOES. The local
   * implementation fills this for every caller, players and anonymous included,
   * though only the host's screens read it. That is a live over-send and a
   * privacy gap, recorded at localTransport.ts's teamView, not fixed there.
   */
  resultsByYear?: Record<string, TeamYearSummary>;
}

/**
 * ⚠ PRIOR DEVELOPMENT, PER LINE — READ WITH ADVERSE_DEVELOPMENT OFF, AND NOT
 * READ WITH IT ON (wip/adverse-development, where the levels below replace it).
 *
 * A signed fraction: POSITIVE IS ADVERSE (prior years develop upward, the pool
 * owes more than it booked) and NEGATIVE IS FAVOURABLE. So 0.03 is "3% adverse"
 * and -0.02 is "2% favourable".
 *
 * Off, it is the share of each open older accident year's reserve that develops
 * over its remaining life, in total, emerging as it pays (utils/hostDevelopment;
 * setup.priorDevelopment, read by the engine and the pre-game). A line absent
 * from the record reads the engine's default (PRIOR_DEVELOPMENT_DEFAULTS),
 * which is also what an old room record reads as. On, the room still carries
 * it, so a record written either way reads the same.
 */
export type PriorDevelopment = Partial<Record<CoverageLine, number>>;

/**
 * ADVERSE DEVELOPMENT'S LEVEL PER LINE (wip/adverse-development;
 * ADVERSE_DEVELOPMENT) — what the host sets in place of PriorDevelopment, which
 * the engine no longer reads with the switch on. A line absent reads
 * ADVERSE_DEVELOPMENT_DEFAULT_LEVEL; an old room record, absent throughout.
 */
export type DevelopmentLevels = Partial<Record<CoverageLine, 'Low' | 'Mid' | 'High'>>;
/** Is `v` a level? The transports keep only these. */
export const isDevelopmentLevel = (v: unknown): v is 'Low' | 'Mid' | 'High' => v === 'Low' || v === 'Mid' || v === 'High';

/**
 * The prior-development defaults — the engine's own, the same values, so a line
 * left unset plays what the default plays (with ADVERSE_DEVELOPMENT off).
 */
// ⚠ DEFINED IN src/data/pricingParameters.ts NOW, re-exported here. Same values.
export { PRIOR_DEVELOPMENT_DEFAULTS as DEFAULT_PRIOR_DEVELOPMENT } from '../data/pricingParameters';

export interface RoomView {
  code: string;
  status: RoomStatus;
  seed: string;
  /**
   * ⚠ THE EVENT, NOT A POOL. The host is running a SESSION — a class, a
   * workshop — and each team runs its own pool inside it. Naming the room after
   * a pool made sense only while every team shared one.
   */
  eventName: string;
  /**
   * THE POOL'S NAME — what every team's game calls its pool: the welcome memo,
   * the header chip, every player-facing mention of the pool. Set by the host
   * when creating the room, separate from the event name the lobby shows.
   * ⚠ ALWAYS PRESENT ON THE VIEW: a room created before it existed, or created
   * with it blank, reads the event name here.
   */
  poolName: string;
  yearCount: number;
  startingYear: number;
  /**
   * ⚠ HOW MANY TEAMS THE HOST EXPECTS, AND IT BINDS NOTHING. It exists for one
   * question — is everyone here yet — which is what decides when to advance
   * year 1. The transport does NOT refuse an extra team: the number is the
   * host's estimate before the room opens, and a room where four turn up
   * instead of five must not be stuck forever because of a guess.
   */
  expectedTeams: number;
  /**
   * ⚠ THE ROOM'S COVERAGE LINES, SET BY THE HOST AT CREATION AND FIXED. Every
   * team plays exactly these. This replaced a per-team choice made at join: a
   * session where each team ran a different book was a table of games rather
   * than one game, and the host could not set the thing the session is about.
   * At least one line; order is canonical (WC, GL, Property), not the order the
   * host clicked them.
   */
  lines: CoverageLine[];
  /** Per-line prior development, stored and not read with ADVERSE_DEVELOPMENT on. See PriorDevelopment. */
  priorDevelopment: PriorDevelopment;
  /** Per-line adverse development level, set by the host. See DevelopmentLevels. */
  developmentLevels?: DevelopmentLevels;
  /**
   * TAKEN OFF THE LOBBY BY THE HOST. Absent on a room written before hiding
   * existed, which reads as false — not hidden, which is what those rooms were.
   * See SetEventHiddenRequest for why this changes only whether the event is
   * LISTED and nothing about who may join it.
   */
  hidden?: boolean;
  currentYear: number;
  shocks: ScheduledShockSpec[];
  teams: TeamView[];
  /** Every team's room market share — HOST ONLY; absent for every other caller. */
  marketShares?: RoomMarketShares;
  createdAt: number;
  updatedAt: number;
  // Monotonic per write. A poller compares this to know something moved without
  // diffing the whole record, and an HTTP implementation can serve it as an
  // ETag for free.
  rev: number;
}

// What the CALLER may see of their own slice — the part `read` redacts by token.
export interface CallerView {
  role: CallerRole;
  teamName?: string;
  // The caller's own team's lines — the set its GameState is built from. A
  // viewer gets the watched team's, which is what lets it build the same game.
  lines?: CoverageLine[];
  /**
   * ⚠ THE CALLER'S OWN DECISIONS, PER YEAR, AND IT REPLACED A SINGLE SLOT.
   * The room used to hold one `lastDecisions` per team, overwritten on every
   * submit. That made the record flat in the year count — pleasingly cheap, and
   * wrong: a client rebuilding from the seed after a reload had only the LATEST
   * set to replay every prior year with, so a team that varied its choices was
   * shown numbers it never played, and the host's table (built from what was
   * posted at the time) disagreed with the team's own screen. Viewers replayed
   * identically wrong.
   *
   * ⚠ KEYED BY YEAR AS A STRING, BECAUSE THAT IS WHAT JSON DOES. A numeric key
   * survives JSON.stringify as "3"; typing it as a number here would be a lie
   * the first time this crossed a real network.
   *
   * ⚠ CARRY-FORWARD NOW MEANS "THE MOST RECENT YEAR THAT HAS ONE", not "the
   * single slot". A team that did not lock year 3 is still processed on what it
   * last chose — that is unchanged and still the point — but "what it last
   * chose" is now answered per target year rather than globally. See
   * decisionsForYear.
   */
  decisionsByYear?: Record<string, JsonValue>;
  // This caller's own last posted result — the same typed summary the host
  // reads, so a team and the host are never looking at two shapes of one thing.
  lastResult?: TeamYearSummary;
  lastResultYear?: number;
  /**
   * ⚠ WHICH YEARS THE ROOM ALREADY HOLDS FOR THIS CALLER — the client's
   * reconciliation input, and the reason it exists is a defect. A client used to
   * post only the newest year it computed, so a tab that came back three years
   * behind left the room holding years [0, 3] and the host's charts lost the two
   * in between. Posting every year it produced fixes the common case; knowing
   * what is ALREADY there is what lets a client repair a year whose post never
   * landed, the opening position included. Sorted ascending, year 0 included.
   */
  postedYears?: number[];
  /**
   * THIS CALLER'S TEAM'S ROOM MARKET SHARE, from the room's stored set — the
   * one figure of RoomView.marketShares a player (or a viewer of that player)
   * may see. Absent until the team has a share in the stored set.
   */
  marketShare?: TeamMarketShareOfYear;
}

// ---------------------------------------------------------------- requests

// ⚠ GAP CLOSED. This said createRoom WAS NOT IDEMPOTENT and that a retry made a
// second room. It does not any more: `hostToken` below is minted by the CLIENT
// and doubles as the idempotency key, and the server keeps an index on it so a
// retried create returns the room it already made with `reused: true`. The note
// survived into this branch because the gap was recorded here and closed on
// another; a server author reading it would have built the wrong thing.
// The table shape for the index is in src/session/server/keys.ts.
export interface CreateRoomRequest {
  /** One of ROOM_SEEDS, "1" to "20": the scenario. Any other is refused. */
  seed: string;
  yearCount: number;
  startingYear: number;
  eventName: string;
  /**
   * The pool's name — see RoomView.poolName. ⚠ OPTIONAL ON THE REQUEST so a
   * client older than the handler still creates rooms (the handler deploys
   * first); absent or blank, the room's pool is named after the event.
   */
  poolName?: string;
  /** Non-binding — see RoomView.expectedTeams. */
  expectedTeams: number;
  /**
   * ⚠ THE LINES THE GAME USES. At least one, and every entry a real coverage
   * line; an empty or unknown set is refused with BAD_REQUEST. The server
   * normalises the order to canonical, so a host who clicks Property first does
   * not create a room that differs from one who clicks WC first.
   */
  lines: CoverageLine[];
  /**
   * Per-line prior development, stored on the room and NOT read by the engine.
   * See PriorDevelopment. Optional: omitted means no development recorded, and
   * entries for lines the room does not play are dropped rather than refused.
   */
  priorDevelopment?: PriorDevelopment;
  /** Per-line adverse development level (DevelopmentLevels); entries for lines not played are dropped. */
  developmentLevels?: DevelopmentLevels;
  shocks: ScheduledShockSpec[];
  /**
   * ⚠ THE HOST'S TOKEN, MINTED BY THE CLIENT, AND IT DOUBLES AS THE
   * IDEMPOTENCY KEY. A retried createRoom used to make a SECOND room and the
   * caller kept whichever response arrived — two rooms, two codes, one of them
   * orphaned with teams potentially joining it. Presenting the same token means
   * the server can recognise the retry and hand back the room it already made.
   *
   * ⚠ THE SERVER STORES AN INDEX ON IT. In the local transport that index is
   * keyed on the token itself, which is no worse than the room record beside it
   * — that already holds the token in the clear, in the same localStorage. ⚠ A
   * HOSTED IMPLEMENTATION MUST KEY ON A HASH INSTEAD, so no plaintext bearer
   * token is written to the table; the contract does not constrain that because
   * it is entirely the server's side of the wire.
   */
  hostToken: string;
}

export interface CreateRoomResponse {
  code: string;
  // ⚠ ECHOED, NOT MINTED — it is the token the CALLER supplied, returned so the
  // response stays self-contained and a caller that lost its own copy between
  // request and response still has one. `read` never discloses it. It is shown
  // at creation as the resume code precisely because a closed laptop otherwise
  // ends the session.
  hostToken: string;
  /** False when this call CREATED the room, true when it recognised a retry and
   *  returned the room it had already made. See AdvanceResponse.advanced. */
  reused: boolean;
  room: RoomView;
}

// ⚠ GAP CLOSED. This said a CREATING join was not idempotent and that a lost
// response locked a player out of their own team name. It does not any more:
// `token` below is minted by the CLIENT and sent on the FIRST join as well as
// on a return, so a retry presents the same token and lands on the rejoin branch
// instead of TEAM_TAKEN. It remains OPTIONAL — omitting it is a one-shot join
// that cannot survive a lost response, which is what every join used to be — so
// a server must handle both. The note survived into this branch because the gap
// was recorded here and closed on another.
export interface JoinRequest {
  /** Omit when `pin` is given — the pin resolves both this and `teamName`. */
  code?: string;
  /**
   * A PLAYER NAMES ITS OWN TEAM HERE and the name must be free in this room; a
   * VIEWER names an existing team to watch. The host no longer pre-registers a
   * roster, because the name is part of the team's own game setup — the same
   * act as choosing its lines, and set at the same single moment.
   *
   * Omit when `pin` is given.
   */
  teamName?: string;
  role: 'player' | 'viewer';
  /**
   * ⚠ A SHORTCUT TO ONE TEAM, NOT A SECOND WAY TO ADDRESS A ROOM. Minted once,
   * for the team, when it is created (JoinResponse.pin) — a viewer who has it
   * can jump straight to watching that team from the Lobby, with no room code
   * in hand at all. `code`/`teamName` are not needed when `pin` is given; it
   * resolves both.
   *
   * ⚠ VIEWER-ONLY, REFUSED OTHERWISE (INVALID_REQUEST). A pin never creates or
   * claims a team — it only names one to watch — so it carries exactly the
   * authority a name-based viewer join already has, nothing more. It is
   * globally unique (keys.ts's PIN# index, outside any room's partition),
   * unlike a team name, which is only unique within its own room.
   */
  pin?: string;
  /**
   * ⚠ THERE IS NO `lines` FIELD ANY MORE, AND ITS ABSENCE IS THE POINT.
   * A player used to send its coverage lines here, required on a first join and
   * refused with LINES_LOCKED if a rejoin disagreed. The HOST now picks the
   * room's lines at creation and every team plays them, so a team has nothing to
   * send and nothing to disagree about. JoinResponse.lines still answers "what
   * do I play" — it is the room's set, returned so a client need not read the
   * room separately to build its game.
   *
   * A server written against this contract must IGNORE a stray `lines` on the
   * wire rather than refuse it, so a stale client that still sends one joins
   * correctly and plays the room's lines instead of its own.
   */
  /**
   * ⚠ REJOIN, NOT A SECOND CLAIM. The same browser returning to the same code
   * presents the token it already holds and gets its own seat back. Without
   * this, a refresh reads as a different person trying to take a team that is
   * already taken, and the real driver is locked out of their own game.
   *
   * ⚠ AND IT IS SUPPLIED ON THE FIRST JOIN TOO, WHICH IS WHAT MAKES JOIN
   * IDEMPOTENT. The client mints it (newSessionToken) and sends it when
   * CREATING the team as well as when returning to it, so a retry after a lost
   * response presents the same token and lands on the rejoin path above rather
   * than on TEAM_TAKEN. Omitting it is still legal and still works — it is then
   * a one-shot join that cannot survive a lost response, which is what every
   * join used to be.
   */
  token?: string;
}

export interface JoinResponse {
  teamToken: string;
  teamName: string;
  role: 'player' | 'viewer';
  /** What the team plays: THE ROOM'S LINES, authoritative. It is no longer "the
   *  set chosen originally" because nothing is chosen at join — it is the set
   *  the host fixed at creation, returned here so a client can build its game
   *  from the join response alone. */
  lines: CoverageLine[];
  /**
   * ⚠ PRESENT ONLY FOR THE PLAYER THAT OWNS THIS TEAM — on create, and on every
   * rejoin. This is the ONLY way a team ever learns its own PIN: it is never in
   * `RoomView`, never in another caller's `CallerView`, same treatment as the
   * team's bearer token. A viewer's `JoinResponse` never carries one.
   */
  pin?: string;
  rejoined: boolean;
  room: RoomView;
}

// Decisions for a year, a result for a year, or both.
//
// ⚠ ONE ENDPOINT, TWO SLOTS, AND THAT IS DELIBERATE. Posting a computed result
// is the same act as posting decisions — a team saying "here is my year" — and
// giving it a sixth endpoint would have widened the contract for a payload
// difference rather than an authority difference. Both slots are authorised
// identically and both are opaque.
export interface SubmitRequest {
  code: string;
  token: string;
  yearNumber: number;
  /** Opaque by design — see TeamYearSummary's note on why results are not. */
  decisions?: JsonValue;
  result?: TeamYearSummary;
}

export interface SubmitResponse {
  room: RoomView;
  you: CallerView;
}

// ⚠ GAP CLOSED, AND IT IS THE ONE THAT CHANGES THE WIRE. This said the request
// NEEDED an expected current year and did not carry one. It carries one now:
// `expectedYear` below is REQUIRED, and the server compare-and-swaps on it
// (currentYear = :expected) so a retried POST is a no-op that still SUCCEEDS,
// reporting `advanced: false`. A server that ignores the field, or that returns
// an error on the no-op branch, breaks the guarantee — the host would be told an
// operation failed that in fact worked. The note survived into this branch
// because the gap was recorded here and closed on another.
export interface AdvanceRequest {
  code: string;
  // Host token only. Enforced by the implementation, not by hiding the button.
  token: string;
  /**
   * ⚠ THE YEAR THE CALLER BELIEVES THE ROOM IS ON, AND THE SERVER
   * COMPARE-AND-SWAPS ON IT. REQUIRED, not optional: an advance that may omit
   * its expectation is an advance somebody will omit it from, and the whole
   * guarantee is gone for that call. The compiler asks every caller.
   *
   * ⚠ WHAT IT PREVENTS. `advance` increments. A retried POST — which is exactly
   * what a client does when a response is lost — used to SKIP A YEAR: the room
   * went to 4 when the host had asked it to go to 3, and every team then
   * reported against a year nobody played. There is no way to tell the two
   * requests apart from the server's side without this field, because they are
   * byte-identical.
   */
  expectedYear: number;
}

export interface AdvanceResponse {
  room: RoomView;
  currentYear: number;
  /**
   * ⚠ FALSE WHEN THIS CALL WAS A RETRY THAT CHANGED NOTHING, and the call still
   * SUCCEEDS. That is the point of the whole mechanism rather than a detail: a
   * host whose request was retried must see the year advance ONCE and get a
   * success, not an error telling them it already happened. An error would be a
   * failure the host can do nothing about, reported for an operation that
   * worked.
   *
   * It is reported rather than hidden so a UI can stay quiet on a retry instead
   * of animating a second transition, and so a harness can tell the two apart.
   */
  advanced: boolean;
}

export interface ReadRequest {
  code: string;
  // Absent is legal and yields role 'anonymous' with the public room view — a
  // join screen needs the team roster before it holds any token at all.
  token?: string;
}

export interface ReadResponse {
  room: RoomView;
  you: CallerView;
}

// ---------------------------------------------------------------- interface

// ⚠ THE WHOLE SURFACE. Five methods. Anything a client needs that is not here is
// a gap in this interface to be closed here, not a reach around it into an
// implementation — the moment a screen imports from a concrete transport, the
// swap stops being a swap.
export interface SessionTransport {
  createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse>;
  join(req: JoinRequest): Promise<JoinResponse>;
  submit(req: SubmitRequest): Promise<SubmitResponse>;
  advance(req: AdvanceRequest): Promise<AdvanceResponse>;
  read(req: ReadRequest): Promise<ReadResponse>;
  // ---- the lobby ----------------------------------------------------------
  // ⚠ TWO NEW METHODS, NOT ONE, AND THE SECOND IS NOT AN OVERSIGHT. The lobby
  // needs a READ (listEvents) and the host's hide control needs a WRITE. There
  // was nowhere to put the write: `advance` fires once a year and means
  // something else, `read` is a read, and folding a mutation into either would
  // make a method that sometimes writes — the kind of thing this contract's
  // header spends its length arguing against. So hiding gets its own narrow,
  // host-only endpoint rather than a flag smuggled onto a call that exists.
  listEvents(req: ListEventsRequest): Promise<ListEventsResponse>;
  setEventHidden(req: SetEventHiddenRequest): Promise<SetEventHiddenResponse>;
}

// ---------------------------------------------------------------- faults

// Deliberate failure injection, so loading and error states are exercised now.
//
// ⚠ THIS IS PART OF THE CONTRACT, NOT OF THE localStorage IMPLEMENTATION. A
// hosted implementation implements it too (by failing requests before they are
// sent) so the same error-path walkthrough can be run against a real backend
// without a special build.
export interface FaultController {
  // Fail the next call only.
  failNext(code?: SessionErrorCode, message?: string): void;
  // Fail every call until cleared — for holding a screen in its error state.
  failAll(code?: SessionErrorCode, message?: string): void;
  // Added latency in ms for every call.
  setLatency(ms: number): void;
  clear(): void;
}
