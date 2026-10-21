// ============================================================================
// THE PRICING PARAMETERS — ONE PLACE, SO THE REBUILD CAN BE TUNED BY NUMBER.
//
// ⚠ COMMIT 1 OF THE PRICING REBUILD, AND IT CHANGES NO GAME RESULT. Everything
// under MOVED below was already in the engine at the value it has here; this
// file is now where it is DEFINED, and its old home re-exports it so every
// existing import keeps resolving. Everything under NEW is declared and read by
// nothing — it is tuned and wired from commit 2 onward.
//
// ⚠ VALUE-NEUTRALITY IS THE WHOLE CLAIM OF THIS COMMIT and both value baselines
// are the evidence. A moved constant that changed by an ulp would show up
// there, which is why the move was done as re-export rather than as retyping
// the literals at a second site.
//
// ============================================================================
// WHAT EACH ENTRY CARRIES, AND WHY `basis` IS NOT DECORATION.
//
//   value        the number the engine uses
//   unit         what the number is OF — a rate per $100, a share, dollars,
//                years, a multiplier
//   what         what it does, in one line
//   basis        SOURCED: measured from the pool's own data or an external
//                         source named in `note`. Changing it is a re-fit.
//                CHOSEN:  picked. Changing it is a decision, not a re-fit.
//
// The distinction is the point of the file. A reader tuning the model needs to
// know which numbers they are allowed to move, and this project has repeatedly
// found constants whose provenance had been forgotten — a CHOSEN number
// defended as if it were measured, or a SOURCED one nudged to make a gate pass.
//
// ⚠ TWO THINGS DELIBERATELY NOT MOVED HERE, and the page says so where they
// appear. THE CLF TABLES and THE OPENING SURPLUS BANDS stay in clfTables.ts and
// defaultAssumptions.ts, because each is a derived table whose fitting method,
// controls and rejected alternatives are recorded beside it at length. Moving
// the numbers and leaving the derivation behind is how a table ends up tuned by
// somebody who never read what it was fitted to. They are REGISTERED here — the
// page lists them, read from their own modules — rather than relocated.
// ============================================================================

import { CoverageLine, Region } from '../types/simulation';

export type ParameterBasis = 'SOURCED' | 'CHOSEN';

export interface ParameterEntry {
  readonly value: number | string;
  readonly unit: string;
  readonly what: string;
  readonly basis: ParameterBasis;
  /** Where it came from, or what tuning it would mean. Optional. */
  readonly note?: string;
  /** TRUE while nothing reads it. Commit 2 onward clears these as they wire. */
  readonly notYetUsed?: true;
  /**
   * What the game did with an EXTERNAL model's parameter. Set only in the
   * R model section; a union rather than a string so a typo is a compile
   * error instead of a new category nobody notices on the page.
   */
  readonly status?: RModelStatus;
}

/** The five, and no others. See the R model section's header. */
export type RModelStatus =
  | 'ADOPTED'          // used as given
  | 'ADOPTED, SCALED'  // used after scaling
  | 'ADAPTED'          // changed to fit the game
  | 'SUPERSEDED'       // replaced by a game decision
  | 'NOT USED';        // no game equivalent

export type PerLine<T> = Readonly<Record<CoverageLine, T>>;

// ============================================================================
// MOVED — read by the engine today, at exactly the value it already had.
// ============================================================================

/** Admin load. Applied to GROSS EXPECTED LOSS, not to premium — see the page. */
export const ADMIN_LOAD_OF_EXPECTED_LOSS = 0.15;

/** How many accident years the pricing window keeps. */
export const PRICING_WINDOW_YEARS = 10;

/**
 * The reinsurance risk load lambda: premium = E[ceded] + lambda x SD[ceded].
 * ⚠ IT IS ZERO TODAY. The tower therefore charges its expected cession and no
 * margin. Several comments elsewhere in the repo still say 0.60; they are stale.
 */
export const REINSURANCE_RISK_LOAD_LAMBDA = 0;

// ============================================================================
// TREND AND EXPOSURE — ONE SEVERITY RATE PER LINE, NO FREQUENCY TREND, AND A
// LEVEL EXPOSURE BASE.
//
// ⚠ THIS REPLACES A THREE-PART ARRANGEMENT AND ALL THREE PARTS HAD TO GO
// TOGETHER. What was here: WC severity +3.67% with frequency -1.5%, GL severity
// +5.7026%, Property zero, and an exposure base growing at wage inflation
// 3.63% on WC and GL but not on Property. The rate trend was then the quotient
// — WC -1.462%/yr, GL +2.00%/yr, Property flat — and the three lines were on
// three different footings for reasons that were individually sourced and
// jointly impossible to price off.
//
// Removing the exposure trend ALONE would have made WC's rate rise 2.115%/yr
// and GL's 5.70%/yr, because each line's severity was paired with it by
// construction; that pairing is exactly what exposureTrend.ts warned about at
// length. So the pair is replaced, not half of it.
//
// ⚠ THE 3.63% / 3.67% CANCELLATION IS NOT LOST, IT IS EXPRESSED DIFFERENTLY.
// WCIRB's indemnity trend tracks wages because benefits are a statutory share
// of wage, and with a level exposure base that relationship no longer has a
// denominator to cancel against: the full severity trend now reaches the rate.
// 5% is a CHOSEN round figure for all three lines, deliberately above WC's
// measured 3.67%, and is the number to tune first if the rate moves too fast.
// ============================================================================

/**
 * ACCIDENT-YEAR SEVERITY TREND — one rate per line, applied at the DRAW and in
 * pricing alike. Each accident year n costs (1 + rate)^(n-1) of year 1's.
 *
 * ⚠ PER LINE SINCE STABLE-SCENARIOS COMMIT 3: WC 4%, GL 8%, Property 5% —
 * replacing one round 5% for all three. WC's sits nearer its measured 3.67%;
 * GL's carries liability's faster claim-cost growth. The same rate books each
 * accident year's inflation up to reporting up front (UP_FRONT_TREND).
 */
export const SEVERITY_TREND_PER_YEAR: PerLine<number> = { WC: 0.04, GL: 0.08, Property: 0.05 };

/**
 * THE TREND BOOKED UP FRONT (stable-scenarios commit 3). ON: each accident
 * year's ultimate rises with trend only by as much as its REPORTED losses rise
 * because of trend — inflation up to reporting, not up to final payment. The
 * factor, per line, along the closed REPORTED pattern (paidDevelopmentPatterns'
 * upFrontTrendFactor):
 *
 *     sum over development years k of  (share newly reported in year k) x (1 + trend)^(k - 1)
 *
 *     WC 1.0787   GL 1.1599   Property 1.0126
 *
 * It multiplies the pool's layered loss costs (WC, GL), Property's basis and
 * the shock sizes alike (ordinaryLoss.ts's bookedCostLevel). Older years do not
 * develop for trend afterwards: the booked ultimate already carries it, and
 * pricing, which develops paid losses to that ultimate, sees it through the
 * experience. OFF is the gate's control (factor 1).
 *
 * ⚠ THE FIGURES ABOVE ARE ALSO ON THE PARAMETERS PAGE ENTRY BELOW, and
 * no-tail-trend-check fails if either disagrees with the computed factor.
 */
export const UP_FRONT_TREND = { enabled: true };

/**
 * ACCIDENT-YEAR FREQUENCY TREND — ZERO on all three lines.
 *
 * ⚠ A NAMED ZERO, NOT A DELETION. WC carried -1.5%/yr, sourced, and the
 * mechanism that applies it is still wired and still reads this. Giving a line
 * a frequency trend again is a one-number edit here; deleting the parameter
 * would make it a code change.
 */
export const FREQUENCY_TREND_PER_YEAR: PerLine<number> = { WC: 0, GL: 0, Property: 0 };

/**
 * EXPOSURE BASE GROWTH — ZERO. Payroll and insured value are LEVEL.
 *
 * ⚠ THE BASE NOW MOVES ONLY THROUGH UNDERWRITING, which is the point: a pool
 * whose exposure grew 3.63% a year on its own made every per-$100 figure a
 * quotient of two trends, and a member joining or leaving was the smaller term.
 * The frozen roster carries year-1 dollars and nothing rides on top of them.
 */
export const EXPOSURE_GROWTH_PER_YEAR = 0;

/** The funding confidence level the slider opens on. */
export const DEFAULT_FUNDING_CONFIDENCE_LEVEL = 0.60;

/**
 * THE FUNDING SLIDER'S STOPS — 30% TO 90% IN TENS, PLUS "EXPECTED" (CLF exactly
 * 1.000, the fundingAtExpected flag, which sits off the grid at the table's own
 * `expected`). Was 30% to 95% in fives. Since the funding tables wiring the
 * stops are the BaselineCV tables' own columns, so no stop is interpolated.
 */
export const FUNDING_SLIDER_RANGE = { min: 0.30, max: 0.90, step: 0.10, default: DEFAULT_FUNDING_CONFIDENCE_LEVEL };

/**
 * THE RESERVE MARGIN'S FIXED CONFIDENCE LEVEL — 80% (stable-scenarios commit 2;
 * was 90%). Required capital = outstanding reserves x (the line's CLF at this
 * level - 1). The single source: clfTables' RESERVE_MARGIN_CONFIDENCE reads it.
 *
 * THE POOL'S TARGETS, recorded here beside it:
 *   - overall confidence level 80%  — this parameter;
 *   - premium to surplus under 1.5 : 1;
 *   - outstanding reserves to equity under 5 : 1 — NOT BUILT YET: it needs the
 *     reserves discounted, which the engine does not do.
 */
export const RESERVE_MARGIN_CONFIDENCE_PARAM = 0.80;

/**
 * DEVELOPMENT SPEED — per line: WC and GL 1.5, Property 1.0.
 *
 * 1.0 is the recorded paid and incurred patterns as they are. Above 1.0 both
 * patterns are compressed in time by the factor, keeping their shape: the
 * share paid at age t becomes the recorded share at age speed x t, and the
 * same for the share reported, so case reserves (reported less paid) and IBNR
 * (unreported) stay consistent with each other at every age. Applied where the
 * patterns are defined (paidDevelopmentPatterns.ts), so every reader of a
 * pattern reads the compressed one.
 *
 * ⚠ WC AND GL AT 1.5 BECAUSE THE RECORDED PATTERNS WERE JUDGED TOO SLOW.
 * Property stays at 1.0.
 *
 * ⚠ THE RATE MOVES A LITTLE, AND FOR TWO REASONS, BOTH MEASURED AND ACCEPTED.
 * Pricing develops paid to ultimate on the same compressed pattern, so in
 * expectation it prices the same ultimate and every year-1 rate is unchanged
 * bit for bit. Later years drift, and only through development:
 *   - faster payment brings the host's adverse development into the pricing
 *     window sooner, so rates catch up to it sooner. Over the same 100 solo
 *     seeds, rates rose by up to +0.06% on WC and +0.2% to +0.9% on GL by year;
 *   - faster payment leaves less open balance for a shock's R development to
 *     act on, so a year with WC Reform, Legislation, Nuclear Verdict or Social
 *     Inflation behind it develops less and prices slightly lower. With the
 *     host's development at zero, every rate that still moved (45 game-years of
 *     1,000 on WC, 184 on GL) came after such a shock, and none without one:
 *     WC -0.04% and GL -0.41% by year 10.
 */
export const DEVELOPMENT_SPEED: PerLine<number> = { WC: 1.5, GL: 1.5, Property: 1.0 };

/**
 * NO DEVELOPMENT TAIL (stable-scenarios commit 3). CLOSED: every line's paid
 * pattern pays 100% by its last row — the share paid at each age divided by the
 * share paid at the end, keeping the shape — and the reported pattern closes on
 * paid's last step (the larger of the recorded share reported and the closed
 * share paid). Pricing develops each accident year to the end of the pattern
 * with no tail factor; the engine pays the same.
 *
 * ⚠ WHY: no accident year in a game reaches the end of WC's pattern, where the
 * recorded tail left 9.04% unpaid (GL 1.09%, Property none). Keeping it priced
 * and reserved a balance no game ever pays. Read where the patterns are defined
 * (paidDevelopmentPatterns.ts), so every reader of a pattern reads the closed one.
 */
export const DEVELOPMENT_TAIL = { closed: true } as const;

/**
 * THE BASELINE CV, PER LINE — the shared year-to-year wobble in each line's
 * ordinary losses: the coefficient of variation of the one year factor every
 * unit of a line's book shares in a given year (the data scientist's
 * BaselineCV).
 *
 * ⚠ ONE SETTING DRIVES TWO THINGS, SO THE TWO CAN NEVER DISAGREE. It sets
 * BOTH the engine's ordinary loss draw (the shared year factor in
 * ordinaryLossFromUnits, which replaced the single UNIT_ORDINARY_YEAR_CV of 2%
 * for every line) AND which funding table the line reads (BASELINE_CV_TABLES
 * in clfTables.ts, one per BaselineCV, from wip/clf-tables). A line whose
 * losses wobble at one CV and are funded off a table built at another would be
 * priced for a risk it does not run; baseline-cv-table-check holds the two to
 * the same value, and tableAtBaselineCv throws on a CV with no table (tables
 * exist at 2, 4, 6, 8, 10, 12 and 15%).
 *
 * ⚠ CHOSEN, NOT SOURCED. WC 6%, Property 8%, GL 10%. In use since the funding
 * tables wiring. Over a book of about 60 units the line's ordinary loss CV is
 * sqrt((1+B^2)(1+0.10^2 H) - 1), H about 0.021: about 6.2% on WC, 8.1% on
 * Property and 10.1% on GL, against 2.5% on every line before.
 */
export const BASELINE_CV: PerLine<number> = { WC: 0.06, GL: 0.10, Property: 0.08 };

/** The combined dividend / assessment control: negative is an assessment. */
export const DIVIDEND_ASSESSMENT_RANGE = { min: -0.15, max: 0.15, step: 0.01, default: 0 };

/** Pool-wide risk control intensity, as a share of each line's own premium. */
export const RISK_CONTROL_PCT_RANGE = { min: 0, max: 0.08, step: 0.01, default: 0 };

/** Per-line risk control incentives. Stored and not read by the engine. */
export const RISK_CONTROL_INCENTIVE_RANGE = { min: 0, max: 0.05, step: 0.01, default: 0 };

/** Per-line prior development the host screen offers. Stored, not read. */
export const PRIOR_DEVELOPMENT_DEFAULTS: PerLine<number> = {
  WC: 0.03,
  GL: 0.10,
  Property: -0.02,
};

// ============================================================================
// NEW — NOT YET USED. Read from commit 2 onward. Every one is CHOSEN and is a
// STARTING VALUE TO BE TUNED.
// ============================================================================

/**
 * ALAE — allocated loss adjustment expense, as a share of loss cost. Charged in
 * the rate (newPurePremium) and booked as a cost on the ground-up loss
 * (lossExpense.ts); neither on GL, whose losses already include it.
 */
export const ALAE_OF_LOSS_COST: PerLine<number> = { WC: 0.083, GL: 0.083, Property: 0.083 };

/**
 * ULAE — unallocated loss adjustment expense, as a share of loss cost. Charged
 * in the rate and booked as claims-handling cost, paid as losses are paid
 * (lossExpense.ts).
 */
export const ULAE_OF_LOSS_COST: PerLine<number> = { WC: 0.083, GL: 0.083, Property: 0.083 };

/**
 * ADMIN, FIXED — dollars a year, per line.
 *
 * ⚠ CALIBRATED SO THE OPENING ADMIN EQUALS TODAY'S 15% LOAD, HALF OF IT FIXED.
 * Measured over 12 games at year 1 on default decisions: admin today is
 * `expectedLoss x 0.15`, so half of that is the fixed figure and the other half
 * is the per-exposure rate below. Means: WC admin $2,157,173 on $392.90M of
 * exposure at a 3.6685 pure premium; GL $3,502,043 on $382.30M at 6.1243;
 * Property $6,797,634 on $18,639.78M at 0.2431.
 *
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const ADMIN_FIXED_PER_YEAR: PerLine<number> = {
  WC: 1_078_586,
  GL: 1_751_022,
  Property: 3_398_817,
};

/**
 * ADMIN, PER EXPOSURE — dollars per $100 of exposure, per line.
 *
 * ⚠ THE OTHER HALF OF THE SAME CALIBRATION, and it is an identity rather than a
 * second measurement: half the load as a RATE is
 * `0.5 x 0.15 x openingPurePremiumPer100`, so WC is 0.075 x 3.6685 = 0.275138,
 * GL 0.075 x 6.1243 = 0.459324, Property 0.075 x 0.2431 = 0.018236. Multiplied
 * back by the opening exposure each lands within 0.3% of half the measured
 * admin — the residual is the spread of pure premium across the 12 games, not
 * an error in the split.
 *
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const ADMIN_PER_EXPOSURE_PER_100: PerLine<number> = {
  WC: 0.275138,
  GL: 0.459324,
  Property: 0.018236,
};

/**
 * PROFIT AND CONTINGENCY — a share of the rate. May be set to 0.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const PROFIT_AND_CONTINGENCY_OF_RATE = 0.05;

/**
 * THE REINSURANCE LOAD — CHOSEN: every layer is priced at its EXPECTED loss x
 * (1 + this), on every line, the occurrence layers and the aggregate alike.
 *
 * ⚠ A MARKET'S LOAD, NEVER READ FROM A CONFIDENCE PERCENTILE. It used to be each
 * line's funding (CLF) table read at 70% — WC 1.1400, GL 1.1350, Property 1.1471
 * — so re-deriving the funding tables re-priced the reinsurance under them. 14%
 * is that figure, separated (funding tables commit): the funding tables now
 * describe the pool's own volatility and nothing else, and the reinsurer's price
 * does not move when they do.
 *
 * ⚠ AND IT IS A LOAD ON AN EXPECTED LOSS, NOT A PERCENTILE OF THE LAYER'S OWN
 * LOSSES. A layer that is rarely hit has a loss distribution with a large atom at
 * zero, so its own 70th percentile is often ZERO; pricing off that would charge
 * nothing for the layers that most need a margin.
 */
export const REINSURANCE_LOAD = 0.14;

/**
 * HOW MANY YEARS OF PRIOR HISTORY THE PRE-GAME SIMULATES, with real claims
 * behind them. Everything OLDER, out to the end of the line's recorded paid
 * pattern, opens as a BULK cohort — see openingReserves.ts.
 *
 * ⚠ FIVE SINCE COMMIT 3, AND IT DROPPED WHETHER OR NOT THE NEW RATE IS ON.
 * It used to read ten, with a note saying five would STARVE the old ten-year
 * experience window — "a rate priced off half the history it expects is not a
 * smaller sample, it is a different estimator". That is still true, and the
 * drop was ruled anyway: five prior years is the setting going forward, the
 * new window is five, and running the opening on ten while the rate that
 * replaces it wants five would mean moving the opening twice.
 *
 * ⚠ SO THE OLD RATE IS NOW READING A SHORTER HISTORY THAN IT WAS BUILT FOR,
 * while NEW_RATE_STACK is off. That is a known and accepted cost of landing
 * the opening change once rather than twice; it is why all three baselines
 * move at this commit with the flag still off, and every row of that move is
 * attributable to this one parameter.
 */
export const PRIOR_HISTORY_YEARS = 5;

/**
 * THE NEW RATE STACK — ON.
 *
 * ⚠ IT IS STILL A FLAG, AND ONE LINE SWITCHES IT BACK. Set `enabled` to false
 * and the old rate, the old Decisions panel, the 15% admin load, the gross-up
 * and the retained-cover margin all return; nothing else has to move. It is
 * kept rather than inlined because the reason it was off has not gone away —
 * see below — and because a rate change is the one thing in this game that a
 * session cannot absorb halfway through.
 *
 * ⚠ WHAT IS STILL TRUE, AND WHY IT WAS TURNED ON ANYWAY. Measured at three
 * severity trends: today's rate UNDERPRICES, because the engine's held
 * expected figure does not keep pace with trending losses, and the new stack
 * prices that correctly — WC's ten-year loss ratio falls from 2.225 to 1.194,
 * Property's surplus from near-collapse at $2.8M to $212.6M. But on TODAY'S
 * losses the new pure premium still swings 3-5x between otherwise identical
 * games, because the old engine's losses are that lumpy: roughly one year in
 * five shows a rate move over 20%, one in 25 over 50%.
 *
 * That volatility is the OLD ENGINE's and the new loss engine removes it, by
 * making ordinary losses stable and making them average to their expected
 * figure by construction. Until then the game prices correctly on a lumpy
 * book, which is the better of the two wrong answers: underpricing compounds
 * into insolvency, while a volatile rate is visible and arguable. See the
 * trend findings in docs/PENDING_MULTIPLAYER.md.
 *
 * WHAT THE FLAG GOVERNS: the rate members are charged, the two indications,
 * the Decisions panel, and the retirement of the 15% admin load, the gross-up
 * step and the retained-cover margin. PRIOR_HISTORY_YEARS is NOT behind it.
 */
/**
 * THE POOL'S PER-OCCURRENCE LIMIT — WHAT IT COVERS, AND WHERE THE MEMBER TAKES
 * OVER. GL ONLY TODAY.
 *
 *   GL  $25,000,000 per claim. WC and Property: no limit.
 *
 * ⚠ THIS CORRECTS AN ERROR, AND IT IS WORTH STATING AS ONE. The pool covers GL
 * to $25M per claim; anything above that was never the pool's money. The
 * engine nevertheless counted it: `cedeOccurrences` returns
 * `retained = gross - ceded`, which includes everything above TOWER_TOP, and
 * `retainedAboveTower` was DISPLAYED as the pool's own retention. Measured
 * over 30 games x 10 years before the fix, GL carried $655.5M above the limit
 * — 7.83% of its gross loss, in 27 of 300 line-years, with a worst single year
 * of $103.9M. None of it was ever the pool's to pay.
 *
 * ⚠ IT IS A COVERAGE TERM, NOT A SEVERITY CEILING, AND THE TWO MUST NOT BE
 * CONFUSED. GL_SEVERITY_CAP ($84M) is how large a GL claim can physically be;
 * this is how much of one the pool is on the hook for. The draw is unchanged —
 * claims above $25M still happen, and still happen at the same size — so the
 * limit is applied AFTER generation, as an explicit step, rather than folded
 * into the claim engine where it would silently become part of the physics.
 *
 * ⚠ WHAT THE EXCESS DOES AND DOES NOT TOUCH. It is reported, per line-year, as
 * `memberShareAboveLimit`, and it enters NOTHING: not gross or net loss, not
 * reserves, not the ledger the rate is priced from, not premium, not the loss
 * ratio. The member pays it. `primaryLoss` is unaffected by construction —
 * it is min(claim, EXPERIENCE_SPLIT_POINT) at $25,000, three orders below this
 * limit — so a member's experience modifier does not move either.
 *
 * ⚠ AND GL's retainedAboveTower IS NOW IDENTICALLY ZERO, which is the clearest
 * statement that the fix landed: TOWER_TOP.GL is $25M and no capped occurrence
 * can exceed it. WC ($50M) and Property ($1B) keep theirs, and keep retaining
 * above it, because no limit has been ruled for them.
 *
 * Reinsurance is bought WITHIN the limit and is unaffected: every GL layer
 * tops out at or below $25M.
 */
export const POOL_LIMIT_PER_OCCURRENCE: PerLine<number | null> = {
  WC: null,
  GL: 25_000_000,
  Property: null,
};

/**
 * WHAT THE BOARD FUNDED AT BEFORE THE PLAYERS ARRIVED — a 14% CUSHION OVER
 * EXPECTED: each line's retained pure premium x 1.14, every pre-game year.
 *
 * ⚠ A CUSHION, NOT A CONFIDENCE LEVEL (funding tables commit). It was the 70%
 * level on each line's own CLF table — WC 1.1400, GL 1.1350, Property 1.1471 —
 * so re-deriving the tables would have re-run the pre-game and moved the
 * opening. Stated as the multiplier it amounted to, it no longer reads a table:
 * the same effect as before (WC identical, GL +0.4%, Property -0.6% on the
 * multiplier), and the tables are free to describe the pool's volatility. What
 * confidence it amounts to is now a property of the tables, recorded on the
 * pre-game years' results (fundingConfidenceLevel) and nowhere relied on.
 *
 * ⚠ IT IS THE PRE-GAME ONLY. Players still default to funding at EXPECTED
 * (CLF 1.000) and choose their own level from year 1, which is
 * DEFAULT_FUNDING_CONFIDENCE_LEVEL and the `fundingAtExpected` flag on each
 * line's decisions. This parameter governs the declared years the pool was run
 * by someone else.
 *
 * WHY IT IS NOT "expected": a pool handed over with no cushion is a pool whose
 * previous board was funding to break even every year, which is not how a
 * going concern is run and not the position the game means to start from. 70%
 * is a conservative-but-ordinary stop.
 *
 * ⚠ WHAT A PLAYER SEES BECAUSE OF IT. Year 1 at the default shows a rate DROP
 * against the declared year before it — the player is funding at expected
 * where the prior board funded with a cushion — and that drop is real rather
 * than a modelling artefact. It is the first thing the Decisions panel's
 * change column reports. No player-facing text names the 14%: the welcome
 * memo carries no engine detail (docs/PENDING_MULTIPLAYER.md).
 */
export const PRE_GAME_FUNDING_CUSHION = 0.14;

export const NEW_RATE_STACK = { enabled: true };

// ============================================================================
// THE NEW LOSS ENGINE — commit 1 of 6: exposure base and ordinary losses.
// See docs/PENDING_MULTIPLAYER.md section 3 for the plan this is one step of.
// ============================================================================

/**
 * THE NEW LOSS ENGINE — THE GAME'S LOSS ENGINE, WHENEVER MEMBER_LEVEL IS OFF.
 *
 * Commit 3b retired the NEW_LOSS_ENGINE flag: there is one switch, MEMBER_LEVEL.
 * Off (the game as it ships), each line is one book and its year is ONE
 * aggregate ordinary loss — exposure x the expected ordinary loss cost per
 * $100 x a lognormal year factor, raised by any A in force — plus LARGE losses
 * as individual claims: each catalogue event's T when it arrives, and routine
 * claims above the ordinary limit when ROUTINE_LARGE_LOSSES is on. Ordinary
 * losses are limited per claim at the line's lowest attachment, so they CEDE
 * NOTHING; the large losses go through the tower per occurrence like any other
 * claim. On, the member path draws each member's own claims with the per-claim
 * generators instead (see MEMBER_LEVEL). The old engine as a whole is frozen
 * on the legacy-engine branch.
 *
 * ⚠ THE REINSURANCE RULE. The rate deducts what the reinsurance will ACTUALLY
 * pay, and the reinsurance is priced on that same basis. Both are computed
 * from the losses THIS engine generates:
 *   expected ceded       = the expected recovery on the new engine's losses
 *   reinsurance price    = that expected recovery x the line's CLF at 70%
 * — each event at the catalogue's probability, ex ante — computed in
 * shockExpectation.ts over exactly the draw shockLosses.ts makes. The aggregate
 * stop is priced on the new engine's retained moments.
 */
export const newLossEngineRuns = (): boolean => !MEMBER_LEVEL.enabled;

/**
 * MEMBER-LEVEL PLAY — OFF. Loss engine commit 3.
 *
 * Off, each line is ONE BOOK: premium is rate x exposure, losses are the new
 * engine's ordinary aggregate and its large losses, and underwriting moves
 * exposure rather than members (BOOK_INTAKE_SHARE, the renewal cut, Member
 * Withdrawal). There is no roster selection, no per-member premium or loss,
 * no experience modifier, risk quality, rating group, satisfaction or
 * departure.
 *
 * ⚠ THE MEMBER CODE IS KEPT, AND MAY COME BACK. On, the engine runs the member
 * path — the roster, the membership engine, member premium, the experience
 * modifier, risk quality, rating groups, departure and per-member satisfaction
 * — with each member's OWN claims from the per-claim generators, because
 * members need their own claims and experience (exposure shares would make
 * every member identical). It runs with NO SHOCKS: commit 3b deleted the old
 * shock placeholders, and members get shocks only if they return. The gates
 * that test the member code switch this on inside their own process
 * (scripts/tools/engine-mode/member-level.ts).
 *
 * ⚠ THE OLD MEMBER ENGINE IS INACTIVE AND NO LONGER MAINTAINED. This switch
 * stays, off, and the code behind it stays exactly as it is — but later
 * changes are NOT required to keep it working, so it may need repair before it
 * is switched on again. Its gates are in DORMANT (scripts/gates.ts), which no
 * sweep runs; they can still be run by name. A working copy is preserved on
 * the legacy-engine branch and in advance-single-player. Members return in the
 * new engine as BOOK UNITS, not through this path.
 */
export const MEMBER_LEVEL = { enabled: false };

/**
 * RISK CONTROL — OFF, PENDING DESIGN. Loss engine commit 3.
 *
 * Its effects lived in the old per-claim generators, which the new loss engine
 * does not run, so its spend bought nothing. Off: no charge and no effect; the
 * Decisions page shows each line's slider disabled at 0% ("coming soon") and
 * the Departments screen hides the programs. The programs, the spend and their
 * code are kept intact and unwired, for the pool-level redesign to reuse.
 */
export const RISK_CONTROL = { enabled: false };

/**
 * WHAT ORDINARY LOSSES COVER — per claim, limited at each line's LOWEST
 * reinsurance attachment. Anything above belongs to the shocks.
 */
export const ORDINARY_LOSS_LIMIT: PerLine<number> = {
  WC: 1_000_000,
  GL: 1_000_000,
  Property: 5_000_000,
};

/**
 * ORDINARY LOSSES FROM BOOK UNITS — CHOSEN, the R model's two factors (book
 * units commit 3). Each unit's expected ordinary loss is its exposure x its
 * true risk x the line's expected ordinary loss cost; each year it is
 *
 *   expected x F x f,   F the year factor every unit shares (CV
 *                       BASELINE_CV, the line's own), f the unit's own (CV
 *                       UNIT_ORDINARY_OWN_CV)
 *
 * and the line's ordinary loss is the sum. Both factors are LOGNORMAL WITH
 * MEAN EXACTLY 1, so the expected loss IS the mean of the draws by
 * construction.
 *
 * ⚠ THEY REPLACE ORDINARY_LOSS_CV, one 2.2% draw at the line — what these two
 * compound to over 100 equal members, sqrt(0.02^2 + 0.10^2/100). Over a book
 * of about 60 unequal units the line's CV is sqrt(0.02^2 + 0.10^2 x H), H the
 * sum of each unit's squared share of the expected loss: about 2.47%
 * (typicalBookOrdinaryCv). book-units-ordinary-check holds the draws to both.
 *
 * ⚠ THE YEAR FACTOR'S CV IS BASELINE_CV, PER LINE, SINCE THE FUNDING TABLES
 * WIRING. It was UNIT_ORDINARY_YEAR_CV, 2% on every line, and that constant is
 * gone: the year factor is now the one setting the funding table is chosen by.
 * The sqrt(0.02^2 + ...) above is the history; the line's CV today is about
 * 6.2% (WC), 8.1% (Property) and 10.1% (GL).
 */
export const UNIT_ORDINARY_OWN_CV = 0.10;

/*
 * THE OLD ENGINE'S DERIVED ORDINARY LOSS COST, PER $100, YEAR 1 — SOURCED, AND
 * SINCE STABLE-SCENARIOS COMMIT 2 READ FOR PROPERTY ONLY: WC and GL read the
 * pool's own layered loss costs (POOL_LOSS_COST_LAYERS, below). Its history:
 *
 * Derived ONCE by scripts/tools/derive-ordinary-loss-cost.ts and typed here;
 * nothing recomputes it at runtime. How: today's own expectation functions —
 * the ones the current engine prices with — on the full 200-member market at
 * NEUTRAL risk quality, year 1, k = 1, which is the basis the held pure
 * premiums are derived on. Each claim LIMITED at ORDINARY_LOSS_LIMIT. Property
 * is its ATTRITIONAL band only: today's catastrophe band is excluded because
 * the shock catalogue brings catastrophe in commit 2, and counting it here too
 * would count it twice.
 *
 * The engine trends it at SEVERITY_TREND_PER_YEAR by accident year — 5% — so
 * year N costs this x 1.05^(N-1), the pre-game's negative years included.
 *
 * WHAT IT LEAVES OUT, measured on the same basis by the same script — the share
 * of today's expected loss that now WAITS FOR THE SHOCKS:
 *   WC        25.8%   claims above $1M
 *   GL        49.4%   claims above $1M
 *   Property  33.1%   the catastrophe band, 12.0%, PLUS attritional claims
 *                     above $5M, 21.1%
 * ⚠ PROPERTY WAS FIRST REPORTED AS "ABOUT 12%" AND THAT WAS THE CAT BAND ALONE.
 * The probe that produced it compared attritional against total without
 * applying the $5M per-claim limit to the attritional band; the severity
 * mixture's heavy component runs to $75M and a fifth of expected loss sits
 * above $5M. The derivation applies the limit, and 33.1% is the figure.
 */
/**
 * THE POOL'S LOSS COSTS — SUPPLIED BY THE POOL (stable-scenarios commit 2). Per
 * $100 of payroll at today's level (year 1, trended by accident year at
 * SEVERITY_TREND_PER_YEAR), by per-claim layer, with no deductible:
 *
 *               $0 – $1M     $1M – $5M     line's ordinary cost
 *     WC          $2.50       $0.118          $2.618
 *     GL          $2.50       $0.95           $3.45
 *
 * Each line's ordinary expected loss is the SUM OF ITS LAYERS. Losses above $5M
 * per claim stay with the pool — self-funded, or covered by the aggregate
 * reinsurance a team buys — and arrive ONLY WITH THE SHOCKS. GL keeps its $25M
 * per-claim limit. Property is not here: it keeps its current basis
 * (EXPECTED_ORDINARY_LOSS_COST_PER_100 and the routine fold) until its loss
 * costs are supplied.
 *
 * They REPLACE the old engine's derived figures for WC and GL — ordinary to $1M
 * of WC $2.774112 and GL $2.830161, plus the routine claims above $1M folded in
 * (commit 1): WC $0.965 and GL $2.352 per $100 more in year 1.
 */
export const POOL_LOSS_COST_LAYERS: Partial<Record<CoverageLine, readonly { from: number; to: number; per100: number }[]>> = {
  WC: [{ from: 0, to: 1_000_000, per100: 2.50 }, { from: 1_000_000, to: 5_000_000, per100: 0.118 }],
  GL: [{ from: 0, to: 1_000_000, per100: 2.50 }, { from: 1_000_000, to: 5_000_000, per100: 0.95 }],
};
const layerSum = (line: CoverageLine) => (POOL_LOSS_COST_LAYERS[line] ?? []).reduce((a, l) => a + l.per100, 0);

/**
 * EACH LINE'S ORDINARY COST PER $100, YEAR 1 — WC and GL the sum of the pool's
 * layers (POOL_LOSS_COST_LAYERS); Property its derived attritional cost above,
 * unchanged.
 */
export const EXPECTED_ORDINARY_LOSS_COST_PER_100: PerLine<number> = {
  WC: layerSum('WC'),
  GL: layerSum('GL'),
  Property: 0.159515,
};

/**
 * WHAT THE SHOCKS' LARGE LOSSES (T) ARE SCALED OFF, per $100, year 1 — CHOSEN
 * (stable-scenarios commit 2). T scales with the line's expected ordinary cost
 * against the R model's (shockLosses' tScale). On WC and GL it reads the
 * $0 – $1M layer, $2.50: the closest match to what "ordinary" meant when T was
 * calibrated (claims to $1M, then WC $2.774 and GL $2.830), so WC's shocks are
 * about 10% and GL's about 12% smaller than they were. Property reads its
 * ordinary cost without the routine fold, as before. Whether shocks should be
 * fixed in dollars instead is to be decided once exposure is scaled (block C).
 */
export const SHOCK_T_BASIS_PER_100: PerLine<number> = {
  WC: POOL_LOSS_COST_LAYERS.WC![0].per100,
  GL: POOL_LOSS_COST_LAYERS.GL![0].per100,
  Property: 0.159515,
};

// ============================================================================
// THE NEW LOSS ENGINE — commit 2 of 6: shocks, large losses, regions.
// See docs/PENDING_MULTIPLAYER.md section 3 and src/utils/shockLosses.ts.
// ============================================================================

/**
 * ROUTINE LARGE LOSSES — A SWITCH, NOW ON; THE QUESTION AS IT WAS PUT TO THE TEAM.
 *
 * Ordinary losses stop at each line's ordinary limit, and the share of today's
 * expected loss above it — WC 25.8%, GL 49.4%, Property's 21.1% above $5M —
 * has to come from somewhere. Two answers, both built:
 *
 *   OFF  shocks only. Large losses arrive with the catalogue's events and at
 *        no other time. Quiet years are quiet, and the line's expected loss
 *        is ordinary plus what the shocks bring, which is well under today's.
 *   ON   routine large claims EVERY year — drawn from today's distributions
 *        above the ordinary limit, at the count that restores those shares —
 *        with the shocks on top as the tail above them.
 *
 * Property's catastrophe band stays with the shocks either way: Earthquake,
 * Winterstorm and Wildfire are what bring catastrophe, so a routine cat band
 * would count it twice.
 */
//
// ⚠ OFF SINCE THE STABLE-SCENARIOS BUILD (commit 1), AND ITS COST IS FOLDED INTO
// THE ORDINARY LOSSES, COST-NEUTRAL. It was ON from Prompt A commit 1: routine
// large claims every year, the shocks on top. Off, the regular years are
// stable — no lumpy claim above the ordinary limit lands in a quiet year — and
// the expected cost those claims carried is not dropped: each line-year adds
//
//     routine cost per $100 (that year) / (1 + that year's expected A uplift)
//
// to its ordinary cost per $100 (routineFoldPer100), so the A uplift, which
// multiplies the ordinary losses, gives back exactly the routine cost and the
// line's expected loss is unchanged. The shocks' large losses (T) stay scaled
// off the ordinary cost WITHOUT the fold (baseOrdinaryLossCostPer100), so the
// fold does not grow them. Back ON, the fold is zero and the routine claims
// return — the switch is coherent either way.
export const ROUTINE_LARGE_LOSSES = { enabled: false };

/**
 * A FLAT PRE-GAME — CHOSEN (stable-scenarios build, commit 1). In the five
 * pre-game years only: each asset class earns its EXPECTED return net of fee
 * (no market draw), and ordinary losses come in at EXACTLY their expected
 * cost — no year factor and no unit (member) factor. No shock fires in the
 * pre-game (it never did — see shockLosses.ts). The history a team inherits is
 * then the pool's expected experience, not one seed's luck, and pricing's
 * window opens on it. The played years are untouched.
 */
export const FLAT_PRE_GAME = { enabled: true };

/**
 * CLAIMS ABOVE THE ORDINARY LIMIT, PER $1M OF EXPOSURE A YEAR — SOURCED.
 *
 * Derived ONCE by scripts/tools/derive-ordinary-loss-cost.ts on the basis the
 * ordinary cost was: today's severity mixture and claim rates, the full
 * market, neutral risk quality, year 1. Read only when ROUTINE_LARGE_LOSSES is
 * on. Each claim's size is drawn from the same mixture conditioned above the
 * limit (largeLosses.ts), so count x mean excess restores exactly the share
 * of today's loss that ordinary losses leave out — WC 0.965, GL 2.763,
 * Property 0.050 per $100. ⚠ ON GL THE POOL KEEPS LESS: 7.3% of today's GL
 * loss lies above the $25M pool limit and is the member's, so the pool's
 * routine large losses come to 2.352 per $100, not 2.763.
 */
export const ROUTINE_LARGE_LOSS_FREQUENCY_PER_1M: PerLine<number> = {
  WC: 0.005524783216,
  GL: 0.008769429942,
  Property: 0.00006964657599,
};

/**
 * THE GAME'S FOUR REGIONS AND EACH ONE'S SHARE OF EXPOSURE — CHOSEN, the R
 * model's own (R_MODEL.regions), the same on every line.
 *
 * ⚠ FOUR SINCE BOOK UNITS, AND NO LONGER SOURCED. The three regions were read
 * from today's 200-member roster (North 35.2%, Central 34.4%, South 30.4%);
 * that roster has no East, so re-running its derivation cannot give four.
 * The R model's uplift ranges were set for these four, so adopting them
 * restores its calibration.
 *
 * A REGIONAL EVENT STRIKES ONE REGION, DRAWN BY THIS SHARE (regionByShare), and
 * its A reaches that region's share of the line's ordinary losses. Its T is
 * not cut: it lands whole in the struck region. Drawn by share, the expected
 * share an event reaches is the sum of the squares, 0.255, where three
 * near-equal regions drawn uniformly gave 0.334 — so a regional event's
 * expected A falls by about 23.5%. Nothing else moves.
 */
export const GAME_REGIONS: readonly Region[] = ['North', 'South', 'Central', 'East'];
export const REGION_EXPOSURE_SHARE: Readonly<Record<Region, number>> = {
  North: 0.25, South: 0.30, Central: 0.25, East: 0.20,
};

/** The region a share-weighted draw `u` in [0, 1) lands on: one uniform, cumulative by GAME_REGIONS. */
export function regionByShare(u: number): Region {
  let acc = 0;
  for (const r of GAME_REGIONS) { acc += REGION_EXPOSURE_SHARE[r]; if (u < acc) return r; }
  return GAME_REGIONS[GAME_REGIONS.length - 1];
}

/**
 * HOW MANY LARGE LOSSES EACH EVENT'S T ARRIVES AS — CHOSEN, A STARTING POINT.
 *
 * T is the EXPECTED aggregate, scaled to the game (see tScale in
 * shockLosses.ts); it arrives as this many individual losses, each lognormal
 * around T / count with CV SHOCK_LOSS_CV, so the realised total varies and is
 * never rescaled to T. One for a verdict, many for a disaster.
 *
 * ⚠ EARTHQUAKE AND WILDFIRE ARE ONE OCCURRENCE (SHOCK_ONE_OCCURRENCE): their
 * losses are member claims under a single event, as today's catastrophe band
 * books them, so the tower answers the event total and an earthquake retains
 * PROPERTY_PERIL_DEDUCTIBLE first. Every other T loss is its own occurrence.
 */
export const SHOCK_LOSS_COUNT: Readonly<Record<string, Partial<PerLine<number>>>> = {
  'Earthquake': { Property: 25 },
  'Winterstorm': { Property: 10 },
  'Wildfire': { Property: 15 },
  'Nuclear Verdict': { GL: 1 },
  'Social Inflation': { GL: 3 },
  'Pandemic': { GL: 5, WC: 20 },
};
export const SHOCK_ONE_OCCURRENCE: readonly string[] = ['Earthquake', 'Wildfire'];

/** The CV of each T loss around T / count — CHOSEN. */
export const SHOCK_LOSS_CV = 0.5;

// ============================================================================
// THE BOOK — loss engine commit 3. Read only with MEMBER_LEVEL off.
// ============================================================================

/**
 * WHAT EACH LINE OPENS WITH, IN $M OF EXPOSURE — SOURCED.
 *
 * The mean of today's opening books — the starting enrolment the roster draw
 * produced — over 40 seeds: WC 30.1%, GL 28.8% and Property 29.7% of the full
 * market, each varying about +/-10% between seeds. Without a roster there is
 * nothing to draw, so every game opens on the mean.
 */
export const OPENING_BOOK_EXPOSURE: PerLine<number> = {
  WC: 391.167,
  GL: 374.949,
  Property: 17609.707,
};

/**
 * THE MOST A LINE CAN WRITE, IN $M OF EXPOSURE — SOURCED: today's whole
 * 200-member market. Intake stops at it.
 */
export const FULL_MARKET_EXPOSURE: PerLine<number> = {
  WC: 1300,
  GL: 1300,
  Property: 59233.002,
};

/**
 * BOOK UNITS — each line's exposure split across individual units
 * (src/utils/bookUnits.ts). NOT members: the dormant member engine has its own
 * roster; units are never shown on any screen, export or host view. All
 * CHOSEN, the R model's own shapes.
 *
 *   UNIT_MARKET_COUNT  units in each line's market, drawn from the game seed
 *   UNIT_SIZE_CV       the spread of unit sizes; the market sums exactly to
 *                      FULL_MARKET_EXPOSURE
 *   UNIT_RISK_CV       the spread of true risk scores; the market's
 *                      size-weighted mean is exactly 1.0
 *   UNIT_POOL_SHARE    the opening book: units in a seeded order until it
 *                      first reaches this share of the market — about 60
 *
 * ⚠ READ BY NOTHING YET (book units commit 2): the book is drawn and stored,
 * and every loss, rate and movement still runs on the line's one exposure.
 */
export const UNIT_MARKET_COUNT = 200;
export const UNIT_SIZE_CV = 0.40;
export const UNIT_RISK_CV = 0.30;
export const UNIT_POOL_SHARE = 0.30;

/**
 * UNDERWRITING'S VIEW OF A UNIT'S RISK — CHOSEN, a starting point (book units
 * commit 4). Each unit's OBSERVED risk is its true risk x a noise drawn once
 * from the seed (BookUnit.noiseZ); VISIBILITY is the share of the observed
 * log-risk's variance that is true risk:
 *
 *   log observed  ~  sqrt(v) x log(true risk) + sqrt(1 − v) x sigma x z
 *
 * with sigma the true risk's own log-scale spread, so the observed spread is
 * the true one at every v. At 0 underwriting sees only noise and selects at
 * random; at 1 it sees true risk and selects perfectly. Renewal declines the
 * units that look riskiest; intake takes the prospects that look best.
 */
export const UNIT_UW_VISIBILITY = 0.5;

/**
 * NEW BUSINESS A YEAR, AS A SHARE OF THE CURRENT BOOK, PER INTAKE POSITION —
 * CHOSEN, A STARTING POINT. No New Business, Strict, Moderate, Low. The R model
 * wrote about 5 prospects in 100 a year, which is Moderate; today's member
 * intake joined about 2%, 4% and 7% of the book at the same three positions.
 */
export const BOOK_INTAKE_SHARE: readonly number[] = [0, 0.02, 0.05, 0.08];

/**
 * NEW-BUSINESS PENALTY — CHOSEN, the R model's 20% (book units commit 6). The
 * book units written this year cost this much more on their ACTUAL ordinary
 * losses, in their first year only (ordinaryLossFromUnits); a unit renewed
 * the next year carries none.
 *
 * ⚠ AND IT IS NOT IN EXPECTED LOSS. A pool does not know in advance that its
 * new business will run worse; expected loss is the book's own exposure x
 * risk x cost, and the rate learns the penalty only through the history, as
 * new business's losses reach the ledger. It was 0 — the mechanism without a
 * calibration — and it was IN expected loss.
 */
export const NEW_BUSINESS_PENALTY = 0.20;

/**
 * OPENING SURPLUS, PER LINE — $35M ON EVERY LINE, SET, NOT DERIVED FROM
 * REQUIRED CAPITAL (funding tables wiring).
 *
 * ⚠ INTERIM, UNTIL THE TWENTY STARTING SCENARIOS REPLACE IT. Each scenario will
 * carry its own opening; this one figure stands in for all of them.
 *
 * ⚠ WHY SET. Required capital is the unpaid reserve x (CLF90 - 1) off the
 * line's own funding table, and the BaselineCV tables' 90% stop sits far
 * lower than the tables they replaced (WC 1.0802 against 1.3275, GL 1.1321
 * against 1.7910, Property 1.1060 against 1.5247). Two times that requirement
 * would collapse the opening, so the opening is no longer read off it. The
 * pre-game still starts from whatever surplus lands its last year-end exactly
 * here (solvePreGameStart), so the five years flow into year 1 with no reset.
 *
 * Before: 2 x the line's full required capital — the history follows.
 */
export const OPENING_SURPLUS: PerLine<number> = { WC: 35_000_000, GL: 35_000_000, Property: 35_000_000 };

/**
 * ⚠ HISTORY, NOT IN USE SINCE THE FUNDING TABLES WIRING — OPENING_SURPLUS above
 * replaced it. OPENING SURPLUS, as a multiple of each line's OWN REQUIRED
 * CAPITAL.
 *
 * ⚠ THE DENOMINATOR, STATED EXPLICITLY, because "required capital" names three
 * different quantities elsewhere in this engine and the wrong one is a silent
 * factor of several:
 *
 *   required capital = expectedNetUnpaidLoss x (staticClf(line, 0.90) - 1)
 *
 * — the RESERVE RISK MARGIN, which is what priorHistoryEngine's 'required'
 * band basis already divides by. It is NOT premium, NOT the net reserve
 * itself, and NOT the funding CLF's margin on the coming year's loss.
 *
 * 2.28 is today's figure carried over unchanged: it is the midpoint every
 * line's OPENING_SURPLUS_BAND was re-translated onto, and each line's
 * FROZEN_CAPITAL_J equals it by construction. Starting here means the set
 * opening lands where the search was aiming, so the change is the MECHANISM
 * and not a re-levelling hidden inside it.
 *
 * ⚠ 2, SINCE PROMPT A COMMIT 2. A round, stated multiple replaces the carried-
 * over 2.28: the band it was the midpoint of is gone, so the figure no longer
 * had anything to land on.
 *
 * ⚠ AND THE REQUIREMENT IS THE LINE'S FULL ONE SINCE PROMPT A COMMIT 3: the
 * margin above PLUS the retained-catastrophe charge (Property only), the same
 * total the engine grades capital on every year. See setOpeningSurplus.
 */
// (OPENING_SURPLUS_MULTIPLE_OF_REQUIRED = 2, removed with the wiring.)

/**
 * OPENING RESERVE YEARS — how many accident years the pool holds reserves for
 * at the opening. Older accident years are treated as CLOSED.
 *
 * The opening window is the last OPENING_RESERVE_YEARS accident years: the
 * PRIOR_HISTORY_YEARS the pre-game plays with claims behind them, and the
 * years before those as bulk cohorts. The bulk years are on the books from
 * the START of the pre-game, at their ages then, and pay down on the recorded
 * patterns through it — so every pre-game balance sheet carries them, their
 * losses are in the pricing history from the first pre-game year, and the
 * opening is simply where the pre-game ends. (Before Prompt A commit 2 the
 * runoff reached each pattern's end — WC 37 years, GL 21, Property 11 — and
 * appeared all at once at the opening.)
 */
export const OPENING_RESERVE_YEARS = 10;

/**
 * How many years of prior history the new pricing reads.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const PRIOR_HISTORY_YEARS_NEW = 5;

/**
 * The new pricing window: 5 years, EQUAL WEIGHTS.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const PRICING_WINDOW_YEARS_NEW = 5;
export const PRICING_WINDOW_WEIGHTING_NEW = 'equal';

/**
 * Cap on how far the rate may move in a year. NONE.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const RATE_CHANGE_CAP_NEW: number | null = null;

/**
 * The basis reserves are held on under the new pricing.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const RESERVE_BASIS_NEW = 'expected';

// ============================================================================
// DECIDED WITH THE LOSS ENGINE, RECORDED HERE, NOT YET WIRED.
//
// ⚠ EVERY CONSTANT BELOW IS READ BY THE PARAMETERS PAGE AND BY NOTHING ELSE.
// They are decisions already taken about the new loss engine, written down
// before the engine exists for the reason the R model block gives: a decision
// that lives only in a conversation is one the next reader re-derives, and
// usually re-derives differently. Each says plainly that it is not yet in
// force. See docs/PENDING_MULTIPLAYER.md for the plan they belong to.
// ============================================================================

/**
 * DEVELOPMENT IS A TOTAL OVER THE ACCIDENT YEAR'S REMAINING LIFETIME, NOT A
 * RATE PER YEAR — and the distinction is the whole reason this is written
 * down rather than left to the implementer.
 *
 * The figure says how much an accident year's incurred loss grows from where
 * it stands to where it finally settles, emerging WITH THE PAYMENTS rather
 * than on a calendar schedule: a year that is 60% paid has seen about 60% of
 * its development. One number for the whole remaining life.
 *
 * ⚠ READ AS A YEARLY RATE IT COMPOUNDS INTO SOMETHING NOBODY CHOSE. At
 * today's settings the same percentages applied once per year over each
 * line's remaining lifetime come to roughly +54% on GL and +171% on WC in
 * total. That is not a refinement of the intended figure, it is a different
 * model, and it is the error this note exists to prevent.
 *
 * IT CAN BE CHANGED. The value is a judgement about how conservatively the
 * pool books, not a measurement, and the loss engine is where it lands.
 */
export const DEVELOPMENT_IS_LIFETIME_TOTAL = true;

/**
 * ⚠ PLACEHOLDER — NOT YET USED. NOTHING READS THIS (stable-scenarios commit 4).
 *
 * YEARLY ADVERSE DEVELOPMENT, per line, at 0%. It will REPLACE the host's
 * lifetime development (hostDevelopment.ts, DEVELOPMENT_IS_LIFETIME_TOTAL):
 * each year, a yearly rate on each open accident year's unpaid reserve,
 * applied BEFORE that year's payments, booked as prior-year development, and
 * NOT anticipated by pricing — pricing sees it only as it emerges in the
 * experience. Recorded now so the design is written down beside the value; the
 * wiring is a later commit, and placeholder-check holds that nothing reads it.
 */
export const YEARLY_ADVERSE_RATE: PerLine<number> = { WC: 0, GL: 0, Property: 0 };
// ⚠ NO LONGER "NOT YET WIRED". The host's development % reads this convention
// and hostDevelopment.ts implements it; the entry above is live. The constant
// stays as the written-down statement of WHICH convention is in force.

/**
 * THE REINSURANCE A TEAM BUYS — ONE PACKAGE PER LINE, from this fixed set.
 * Loss engine commit 4a; it replaces placing or declining each band.
 *
 * Each package is one layer, `limit` xs `attachment` per occurrence, priced as
 * every layer is: the expected recovery on the new engine's large losses x the
 * line's CLF at 70%. 'none' buys nothing. GL's $25M pool limit still applies
 * below any package, so a GL loss above $15M is the pool's to $25M.
 *
 * ⚠ THE TOWER IS CUT AT EVERY PACKAGE'S EDGES, so each package is exactly a
 * set of whole tower layers (REINSURANCE_TOWER, and see reinsuranceOptions.ts,
 * which checks it at load). Per-occurrence cession and expected-recovery
 * pricing both add across adjacent layers, so pricing a package as its layers
 * is pricing it as one layer.
 *
 * WC and GL are deliberately the SAME LIST. Property's differs because its
 * retention and its limits do. The aggregate cover is not among them.
 */
export interface ReinsuranceOption { id: string; attachment: number; limit: number }
const xs = (limitM: number, attachmentM: number): ReinsuranceOption =>
  ({ id: `$${limitM}M xs $${attachmentM}M`, attachment: attachmentM * 1e6, limit: limitM * 1e6 });
const NONE: ReinsuranceOption = { id: 'none', attachment: 0, limit: 0 };
export const REINSURANCE_OPTIONS: PerLine<readonly ReinsuranceOption[]> = {
  WC: [NONE, xs(9, 1), xs(5, 5), xs(14, 1), xs(10, 5)],
  GL: [NONE, xs(9, 1), xs(5, 5), xs(14, 1), xs(10, 5)],
  Property: [NONE, xs(20, 5), xs(45, 5), xs(25, 25)],
};

/**
 * WHAT A TEAM HOLDS UNTIL IT CHOOSES — CHOSEN: the middle option, $9M xs $1M on
 * WC and GL and $20M xs $5M on Property. It is also the pre-game's prior board,
 * which plays the default decisions, so the opening is built on it.
 */
export const REINSURANCE_DEFAULT_OPTION: PerLine<string> = {
  WC: '$9M xs $1M',
  GL: '$9M xs $1M',
  Property: '$20M xs $5M',
};

/**
 * TEN WORLDS (loss engine commit 4b). Each team's year runs in this many
 * worlds, every team sharing the same worlds' draws. Each world carries its own
 * reserve ledger, cohorts and surplus forward, with its own ordinary year
 * factor, shock severities, routine large losses and investment returns; the
 * pre-game runs once and the opening is shared. The team's decisions and ONE
 * rate per team-year — struck from the worlds' averaged history — are shared.
 * Displayed dollars are the average across worlds; every ratio is recomputed
 * from averaged parts. See src/utils/worlds.ts.
 *
 * The new engine only: the member path runs one world.
 */
export const WORLD_COUNT = 10;

/**
 * GL'S ORDINARY LOSSES ARE THE $0-1M LAYER, and they are paid on the pattern
 * that layer is paid on.
 *
 * ⚠ THE POINT IS THE MATCHED PATTERN, NOT THE BAND. An ordinary-loss model
 * built on the whole-account payout pattern would pay out too slowly, because
 * the account's pattern is dominated by the large claims that sit above this
 * band and settle years later. The limited layer has its own, faster pattern
 * and that is the one these losses use.
 */
export const GL_ORDINARY_LOSS_BAND_PLANNED = { from: 0, to: 1_000_000 } as const;


// ============================================================================
// THE R MODEL — THE DATA SCIENTIST'S PARAMETERS, RECORDED AND NOT READ.
//
// ⚠ NOTHING IN HERE IS WIRED TO ANYTHING. Every entry is marked `notYetUsed`
// and the new loss engine is what will read the ones it keeps. It is recorded
// now, before that engine exists, because the alternative is a build that
// quietly diverges from its own source and nobody able to say where.
//
// ⚠ ONE FROZEN OBJECT, NOT SIXTY EXPORTED CONSTANTS, and the namespacing is
// the point. These are an EXTERNAL MODEL'S inputs, not this game's: a loose
// `BASE_PREMIUM` next to the game's own constants is an import waiting to
// happen. `R_MODEL.basePremium` cannot be mistaken for ours at a call site.
// The registry below points AT these, so the page and the record cannot
// disagree about a number — the same rule the rest of this file follows.
//
// ⚠ EVERY ENTRY IS CHOSEN, NOT SOURCED, INCLUDING THE ONES THAT LOOK FITTED.
// The data scientist states plainly that the payout patterns, the routine
// reserve development and the A/T/R shock assumptions are ILLUSTRATIVE and not
// fitted to claims data. Nothing else in the model is presented as fitted to
// this pool either. A SOURCED mark anywhere in this section would be exactly
// the "CHOSEN number defended as if it were measured" this file's header was
// written to prevent.
//
// THE STATUS COLUMN is what the game did with each one. Five values, no others:
//   ADOPTED          used as given
//   ADOPTED, SCALED  used after scaling
//   ADAPTED          changed to fit the game
//   SUPERSEDED       replaced by a game decision
//   NOT USED         no game equivalent
// ============================================================================

export const R_MODEL = {
  // General
  years: '2020-2026 (seven)',
  preGeneratedScenarios: 10_000,
  backgroundSimulations: 100,
  initialMembers: 100,
  prospects: 100,
  prospectsPerYear: 5,
  regions: 'North 25% · South 30% · Central 25% · East 20%',
  premiumGrowthPerYear: 0.03,
  initialSurplus: 12_000_000,
  expenseRatio: 0.08,
  seeds: '42, 142, 1000+s, 2000+s, 3000+s, 5000+s',

  // Variance. The two CVs carry the data scientist's OWN revision: the earlier
  // 0.12 and 0.20 were superseded by 0.02 and 0.10 in the model as supplied.
  baselineCV: 0.02,
  baselineCVEarlier: 0.12,
  memberLossCV: 0.10,
  memberLossCVEarlier: 0.20,
  memberRiskCV: 0.30,
  memberSizeCV: 0.40,

  // Shock effects
  shockDecayRate: 0.65,
  economicInflationInitialRate: 0.12,
  investmentLossAdjustment: -0.20,
  memberWithdrawalReduction: 0.25,
  newBusinessPenalty: 0.20,

  // Investment
  investableSurplusRatio: 0.20,
  defaultEquityAllocation: 0.40,
  expectedEquityReturn: 0.07,
  equityReturnSD: 0.15,
  fixedIncomeReturn: 0.03,
  investmentPeriodYears: 1,
  generalInitialInvestments: 25_000_000,
  generalLegacyInvestmentReturn: 0.045,
  generalLegacyInvestmentReturnSD: 0.025,

  // Lines
  basePremium: { GL: 7_000_000, WC: 6_500_000, Property: 4_500_000 },
  targetLossRatio: { GL: 0.70, WC: 0.72, Property: 0.65 },

  // A — proportional increase on the year's ordinary losses, drawn uniformly.
  aShock: {
    GL: { Low: [0.05, 0.15], Mid: [0.15, 0.35], High: [0.35, 0.70] },
    WC: { Low: [0.05, 0.15], Mid: [0.15, 0.35], High: [0.35, 0.75] },
    Property: { Low: [0.10, 0.25], Mid: [0.25, 0.50], High: [0.50, 1.00] },
  },
  // T — aggregate shock loss at the event's start, drawn uniformly.
  tShock: {
    GL: { Low: [1e6, 3e6], Mid: [3e6, 7e6], High: [7e6, 15e6] },
    WC: { Low: [1e6, 3e6], Mid: [3e6, 6e6], High: [6e6, 12e6] },
    Property: { Low: [2e6, 5e6], Mid: [5e6, 12e6], High: [12e6, 25e6] },
  },
  // R — extra adverse rate on outstanding prior-year reserves, drawn uniformly.
  rShock: { Low: [0.02, 0.05], Mid: [0.05, 0.12], High: [0.12, 0.25] },

  // Catalogue: annual probability, duration in years, regional.
  catalogue: [
    ['Earthquake', 0.002, 1, true], ['Winterstorm', 0.06, 1, true],
    ['Wildfire', 0.035, 1, true], ['Legislation', 0.015, 3, false],
    ['WC Reform', 0.02, 3, false], ['Recession', 0.06, 2, false],
    ['Nuclear Verdict', 0.025, 1, false], ['Social Inflation', 0.045, 3, false],
    ['Pandemic', 0.01, 2, false], ['Economic Inflation', 0.10, 3, false],
    ['Investment Loss', 0.04, 1, false], ['Member Withdrawal', 0.02, 2, false],
  ],
  // Map: event, line, A level, T level, R level.
  shockMap: [
    ['Earthquake', 'GL', 'Mid', 'None', 'None'],
    ['Earthquake', 'WC', 'High', 'None', 'None'],
    ['Earthquake', 'Property', 'High', 'High', 'None'],
    ['Winterstorm', 'Property', 'High', 'Low', 'None'],
    ['Wildfire', 'Property', 'Low', 'High', 'None'],
    ['Legislation', 'GL', 'Mid', 'None', 'High'],
    ['WC Reform', 'WC', 'High', 'None', 'Mid'],
    ['Recession', 'GL', 'Low', 'None', 'None'],
    ['Recession', 'WC', 'Low', 'None', 'None'],
    ['Nuclear Verdict', 'GL', 'None', 'High', 'Mid'],
    ['Social Inflation', 'GL', 'High', 'Low', 'Mid'],
    ['Pandemic', 'GL', 'None', 'Mid', 'None'],
    ['Pandemic', 'WC', 'High', 'High', 'None'],
  ],

  // Reinsurance: an AGGREGATE stop on the line's annual loss.
  reinsurance: {
    GL: { attachment: 5_000_000, limit: 5_000_000, rateOnLine: 0.15 },
    WC: { attachment: 4_500_000, limit: 4_000_000, rateOnLine: 0.13 },
    Property: { attachment: 3_500_000, limit: 7_000_000, rateOnLine: 0.16 },
  },

  // Cumulative paid share by development year.
  paidCumulative: {
    GL: [0.15, 0.30, 0.43, 0.55, 0.65, 0.73, 0.80, 0.86, 0.90, 0.94, 0.97, 0.99, 1.00],
    WC: [0.10, 0.20, 0.30, 0.38, 0.45, 0.51, 0.57, 0.62, 0.67, 0.70,
         0.73, 0.76, 0.78, 0.80, 0.82, 0.84, 0.86, 0.88, 0.94, 1.00],
    Property: [0.55, 0.75, 0.87, 0.94, 0.98, 1.00],
  },
  routineDevelopmentMean: 0.00,
  routineDevelopmentSD: 0.07,
} as const;

/**
 * SHOCKS PER YEAR — the catalogue's expected events a year (stable-scenarios
 * commit 5). Every one of the twelve probabilities is scaled by the same
 * factor, SHOCKS_PER_YEAR / their total (0.3 / 0.432 = 0.694), so the relative
 * weights stay exactly as the R model gave them and only the rate falls. Read
 * by pricing (each event's expected cost), the catalogue timing harnesses use,
 * and the schedule's count below.
 *
 * ⚠ WHY: at the R model's 0.432 a year a ten-year game met four or five events
 * in expectation; 0.3 is three.
 */
export const SHOCKS_PER_YEAR = 0.3;
export const SHOCK_CATALOGUE_SCALE = SHOCKS_PER_YEAR
  / R_MODEL.catalogue.reduce((a, [, p]) => a + (p as number), 0);

/**
 * THE SCHEDULE'S SPREAD (stable-scenarios commit 5). Randomise and the
 * singleplayer schedule draw round(SHOCKS_PER_YEAR x years) events, then −1, 0
 * or +1 of that, each equally likely, and never fewer than one: 2 to 4 in a
 * ten-year game. Year 1 stays shock-free; one event a year at most.
 */
export const SHOCK_SCHEDULE_SPREAD = 1;

const rRange = (r: readonly [number, number] | readonly number[], pct = true) =>
  pct ? `${(r[0] * 100).toFixed(0)}%-${(r[1] * 100).toFixed(0)}%`
      : `$${(r[0] / 1e6).toFixed(0)}M-$${(r[1] / 1e6).toFixed(0)}M`;

const rLevels = (l: { Low: readonly number[]; Mid: readonly number[]; High: readonly number[] }, pct = true) =>
  `Low ${rRange(l.Low, pct)} · Mid ${rRange(l.Mid, pct)} · High ${rRange(l.High, pct)}`;

// ============================================================================
// THE REGISTRY — what the page is generated from.
//
// ⚠ IT IS A SECOND DESCRIPTION OF THE CONSTANTS ABOVE AND THAT IS THE ONE PLACE
// THIS FILE ALLOWS IT. The alternative — one object holding value, unit, what
// and basis, with the engine reading `P.adminLoad.value` — makes every call
// site read a wrapper and makes a typo in a key a runtime error instead of a
// compile error. So the constants stay plain and the registry points AT them:
// every `value` below is the constant itself, never a retyped literal, so the
// two cannot disagree about a number. Only the prose can drift, and the page
// check is what holds that still.
// ============================================================================

export interface ParameterSection {
  readonly title: string;
  readonly blurb?: string;
  readonly entries: ReadonlyArray<readonly [string, ParameterEntry]>;
}

const perLine = (v: PerLine<number>, dp = 6) =>
  `WC ${v.WC.toFixed(dp)} · GL ${v.GL.toFixed(dp)} · Property ${v.Property.toFixed(dp)}`;

export const PRICING_PARAMETER_SECTIONS: ReadonlyArray<ParameterSection> = [
  {
    title: 'Trend and exposure',
    blurb: 'Applied at the DRAW, and on the held pricing path so the two cannot diverge. '
      + 'The experience path applies no trend at all.',
    entries: [
      ['Severity trend', {
        value: perLine(SEVERITY_TREND_PER_YEAR, 3), unit: 'per year',
        what: 'Accident-year severity growth, per line, for losses and pricing alike.', basis: 'CHOSEN',
        note: 'WC 4%, GL 8%, Property 5% since stable-scenarios commit 3, replacing one 5% for all three '
          + '(and before that WC 3.67% / GL 5.7026% / Property 0). The first number to tune if the rate moves too fast.',
      }],
      ['Trend booked up front', {
        value: UP_FRONT_TREND.enabled ? 'on' : 'off', unit: 'switch',
        what: 'Each accident year\'s ultimate rises with trend only by as much as its reported losses rise '
          + 'because of trend — inflation up to reporting, not up to final payment. Factor = the sum over development '
          + 'years k of the share newly reported in year k x (1 + trend)^(k - 1), along the closed reported pattern: '
          + 'WC 1.0787, GL 1.1599, Property 1.0126. It multiplies the layered loss costs, Property\'s basis and the '
          + 'shock sizes alike.', basis: 'CHOSEN',
        note: 'Older years do not develop for trend afterwards — the booked ultimate already carries it. Was '
          + 'computed along the paid pattern (WC 1.2440, GL 1.2478, Property 1.0460) before it was ruled that '
          + 'inflation runs only to reporting.',
      }],
      ['Frequency trend', {
        value: perLine(FREQUENCY_TREND_PER_YEAR, 3), unit: 'per year',
        what: 'Zero on all three lines.', basis: 'CHOSEN',
        note: 'A named zero, not a deletion — WC carried -1.5%/yr and the mechanism still reads this.',
      }],
      ['Exposure growth', {
        value: EXPOSURE_GROWTH_PER_YEAR, unit: 'per year',
        what: 'Payroll and insured value are LEVEL; the base moves only through underwriting.', basis: 'CHOSEN',
        note: 'Replaces wage inflation at 3.63% on WC and GL. Removing it alone would have made the rate '
          + 'climb at the full severity trend, which is why the severity rates were replaced with it.',
      }],
      ['Settlement inflation', {
        value: 'per line, in defaultAssumptions.ts', unit: 'per year over a claim\'s life',
        what: 'The dollar-vintage convention applied between accident year and settlement.', basis: 'SOURCED',
        note: 'REGISTERED, NOT MOVED, AND NOT CHANGED IN THIS COMMIT. Distinct from the accident-year '
          + 'severity trend above; see PAYOUT_TREND_FACTOR for the double-count this separation prevents.',
      }],
    ],
  },
  {
    title: 'The pricing window',
    entries: [
      ['Pricing window length', {
        value: PRICING_WINDOW_YEARS, unit: 'accident years',
        what: 'How many accident years the experience rate averages.', basis: 'CHOSEN',
        note: 'The mean is UNWEIGHTED — each year counts the same regardless of exposure or age.',
      }],
    ],
  },
  {
    title: 'Expenses and loads',
    entries: [
      ['Admin load', {
        value: ADMIN_LOAD_OF_EXPECTED_LOSS, unit: 'share of gross expected loss',
        what: 'The pool\'s administration charge.', basis: 'CHOSEN',
        note: 'Applied to EXPECTED LOSS, not to premium, so it does not move with the funding level.',
      }],
      ['Reinsurance risk load (lambda)', {
        value: REINSURANCE_RISK_LOAD_LAMBDA, unit: 'multiplier on SD[ceded]',
        what: 'premium = E[ceded] + lambda x SD[ceded].', basis: 'CHOSEN',
        note: 'ZERO today: the tower charges its expected cession and no margin. Comments elsewhere saying 0.60 are stale.',
      }],
    ],
  },
  {
    title: 'Funding and reserves',
    entries: [
      ['Default funding confidence level', {
        value: DEFAULT_FUNDING_CONFIDENCE_LEVEL, unit: 'confidence',
        what: 'Where the funding slider opens.', basis: 'CHOSEN',
        note: 'The default decision is fundingAtExpected, which bypasses the level and prices at CLF exactly 1.000.',
      }],
      ['Reserve margin confidence', {
        value: RESERVE_MARGIN_CONFIDENCE_PARAM, unit: 'confidence',
        what: 'The confidence the reserve margin is held at: required capital = outstanding reserves x (the '
          + 'line\'s CLF at this level - 1).', basis: 'CHOSEN',
        note: 'Was 90%. The pool\'s targets: overall confidence 80%; premium to surplus under 1.5 : 1; outstanding '
          + 'reserves to equity under 5 : 1 — not built yet, as it needs reserve discounting.',
      }],
      ['Development speed', {
        value: perLine(DEVELOPMENT_SPEED, 2), unit: 'x the recorded patterns\' pace',
        what: '1.0 is the recorded paid and incurred patterns as they are; above 1.0 compresses both in time '
          + 'by that factor, keeping their shape, so case reserves and IBNR stay consistent.',
        basis: 'CHOSEN',
        note: 'WC and GL at 1.5 because the recorded patterns were judged too slow; Property at 1.0. '
          + 'Applied where the patterns are defined, so payments, case and IBNR, the pricing LDFs, the '
          + 'opening and its bulk years, the pre-game and the host\'s development all read the compressed patterns. '
          + 'Year-1 rates are unchanged; later rates move slightly because faster payment brings the host\'s adverse '
          + 'development into pricing sooner, and leaves less open balance for shock R development to act on.',
      }],
      ['Development tail', {
        value: DEVELOPMENT_TAIL.closed ? 'none — closed at the last row' : 'recorded tail kept', unit: 'switch',
        what: 'Each paid pattern pays 100% by its last row (share paid / share paid at the end, keeping its shape); '
          + 'the reported pattern closes on paid\'s last step, so GL keeps its recorded IBNR at its late ages. Pricing '
          + 'develops each accident year to the end of the pattern with no tail factor.',
        basis: 'CHOSEN',
        note: 'No accident year in a game reaches the end of WC\'s pattern, where the recorded tail left 9.04% unpaid '
          + '(GL 1.09%, Property none).',
      }],
      ['Baseline CV', {
        value: perLine(BASELINE_CV, 2), unit: 'coefficient of variation',
        what: 'The shared year-to-year wobble in each line\'s ordinary losses: the CV of the year factor every '
          + 'unit of the book shares.',
        basis: 'CHOSEN',
        note: 'One setting for two things, so they can never disagree: it drives both the engine\'s ordinary '
          + 'loss draw (replacing the 2% year factor every line shared) and which funding table the line reads. '
          + 'baseline-cv-table-check holds the two to the same value.',
      }],
      ['CLF tables', {
        value: 'the BaselineCV tables, in clfTables.ts', unit: 'multiplier on the retained pure premium',
        what: 'Confidence level factors by line and stop: each line reads the table built at its own Baseline CV. '
          + 'Required capital is the unpaid reserve x (the same table\'s 90% factor - 1).',
        basis: 'SOURCED',
        note: 'The data scientist\'s method, by simulation on the game\'s opening book units, ordinary losses only '
          + '(clf-ds-method-derive). The factor multiplies the whole retained pure premium. The new-engine and '
          + 'member-engine tables before them are kept in the file as history, not in use.',
      }],
      ['Funding slider stops', {
        value: `${FUNDING_SLIDER_RANGE.min} to ${FUNDING_SLIDER_RANGE.max}, step ${FUNDING_SLIDER_RANGE.step}, plus Expected`,
        unit: 'confidence',
        what: 'The positions a team can fund at. Expected is CLF exactly 1.000 and sits at the table\'s own '
          + 'measured position.',
        basis: 'CHOSEN',
        note: 'Was 0.30 to 0.95 in fives. The stops are the BaselineCV tables\' own columns.',
      }],
    ],
  },
  {
    title: 'Player controls',
    entries: [
      ['Dividend / assessment range', {
        value: `${DIVIDEND_ASSESSMENT_RANGE.min} to ${DIVIDEND_ASSESSMENT_RANGE.max}, step ${DIVIDEND_ASSESSMENT_RANGE.step}`,
        unit: 'share of opening surplus',
        what: 'Negative is an assessment, positive a dividend.', basis: 'CHOSEN',
      }],
      ['Risk control range', {
        value: `${RISK_CONTROL_PCT_RANGE.min} to ${RISK_CONTROL_PCT_RANGE.max}, step ${RISK_CONTROL_PCT_RANGE.step}`,
        unit: 'share of the line\'s premium',
        what: 'Pool-wide risk control intensity.', basis: 'CHOSEN',
        note: 'The control is retired from the screen; the field is pinned at its default of 0.',
      }],
      ['Risk control incentives range', {
        value: `${RISK_CONTROL_INCENTIVE_RANGE.min} to ${RISK_CONTROL_INCENTIVE_RANGE.max}, step ${RISK_CONTROL_INCENTIVE_RANGE.step}`,
        unit: 'share of the line\'s premium',
        what: 'Per-line risk control incentives.', basis: 'CHOSEN',
        note: 'Stored and not read by the engine; awaiting the new rate indication.',
      }],
    ],
  },
  {
    title: 'Opening position',
    entries: [
      ['Prior development defaults', {
        value: perLine(PRIOR_DEVELOPMENT_DEFAULTS, 2), unit: 'share of the base outstanding, in TOTAL',
        what: 'LIVE. Each accident year develops by this share of a base outstanding, in TOTAL over '
          + 'its remaining lifetime, arriving in step with the payments. Positive is adverse. '
          + 'Singleplayer takes these defaults; a session takes the host\'s setting, per line.',
        basis: 'CHOSEN',
        note: 'THE BASE is the accident year\'s outstanding at the first valuation it meets — game '
          + 'start for prior and bulk years, the end of its own first year for a played one. '
          + 'EACH YEAR\'S SHARE is that year\'s increment in paid share over the share still unpaid '
          + 'at the base, so by run-off exactly this percentage has emerged — asserted per accident '
          + 'year by development-emergence-check. ⚠ NOT A YEARLY RATE: read as one these same '
          + 'percentages compound to about +54% on GL and +171% on WC. Bulk years develop held NET; '
          + 'played years develop GROSS and their reinsurance recoveries are recalculated on each '
          + 'occurrence\'s revised cost under that accident year\'s own cover, so adverse '
          + 'development makes reinsurance worth more. The GL $25M pool limit still applies.',
      }],
      ['Opening surplus bands', {
        value: 'per line, in defaultAssumptions.ts', unit: 'band on a per-line basis',
        what: 'The band each line\'s opening surplus is drawn inside.', basis: 'SOURCED',
        note: 'REGISTERED, NOT MOVED — the bands carry their own re-translation rule and a standing prohibition on re-deriving them casually.',
      }],
    ],
  },
  {
    title: 'The opening',
    blurb: 'The SET opening — no acceptance band, no pin, no search, and no reset: the pre-game starts '
      + 'from the surplus that lands its last year-end on the opening.',
    entries: [
      ['Prior history years', {
        value: PRIOR_HISTORY_YEARS, unit: 'accident years',
        what: 'How many pre-game years are simulated with real claims behind them.', basis: 'CHOSEN',
        note: 'Ten while the old ten-year experience path is live; drops to the new window of five at '
          + 'commit 3, and the two move together. Everything older opens as a bulk cohort.',
      }],
      ['Opening surplus', {
        value: `WC $${OPENING_SURPLUS.WC / 1e6}M · GL $${OPENING_SURPLUS.GL / 1e6}M · Property $${OPENING_SURPLUS.Property / 1e6}M`,
        unit: 'surplus at the opening, each line',
        what: 'Each line opens with this surplus, set rather than derived from required capital.', basis: 'CHOSEN',
        note: 'INTERIM, until the twenty starting scenarios replace it. Was 2 x the line\'s full required capital; '
          + 'the BaselineCV tables\' much smaller 90% factor would have collapsed that. The pre-game starts from '
          + 'the surplus that lands its last year-end here, so the opening is set without a reset.',
      }],
      ['Opening reserve years', {
        value: OPENING_RESERVE_YEARS, unit: 'accident years',
        what: 'How many accident years the opening holds reserves for; older years are treated as closed.',
        basis: 'CHOSEN',
        note: 'The prior history years played with claims, and the years before them as bulk cohorts on '
          + 'the books from the start of the pre-game, paying down through it. Was each pattern\'s full '
          + 'length (WC 37 years, GL 21, Property 11) before Prompt A commit 2.',
      }],
    ],
  },
  {
    title: 'The new pricing parameters',
    blurb: 'NOT YET USED — read from commit 2 onward. Every one is CHOSEN and is a starting value to be tuned.',
    entries: [
      ['ALAE', {
        value: perLine(ALAE_OF_LOSS_COST, 3), unit: 'share of loss cost',
        what: 'Allocated loss adjustment expense. Charged in the rate on the ground-up loss cost and booked '
          + 'as a cost: incurred as this share of the ground-up loss incurred, paid on the loss pattern, the '
          + 'unpaid part held as the loss expense reserve.', basis: 'CHOSEN',
        note: 'Not on GL, whose fitted severities already include ALAE — neither charged nor booked there.',
      }],
      ['ULAE', {
        value: perLine(ULAE_OF_LOSS_COST, 3), unit: 'share of loss cost',
        what: 'Unallocated loss adjustment expense — claims handling. Charged in the rate on the ground-up '
          + 'loss cost and booked as a cost: paid as losses are paid, the unpaid part held as the loss '
          + 'expense reserve.', basis: 'CHOSEN',
      }],
      ['Admin, fixed', {
        value: perLine(ADMIN_FIXED_PER_YEAR, 0), unit: 'dollars per year',
        what: 'The fixed half of administration.', basis: 'CHOSEN', notYetUsed: true,
        note: 'Calibrated so opening admin equals today\'s 15% load, half of it fixed. Measured over 12 games at year 1.',
      }],
      ['Admin, per exposure', {
        value: perLine(ADMIN_PER_EXPOSURE_PER_100), unit: 'dollars per $100 of exposure',
        what: 'The variable half of administration.', basis: 'CHOSEN', notYetUsed: true,
        note: 'The same calibration: 0.5 x 0.15 x the opening pure premium per $100.',
      }],
      ['Profit and contingency', {
        value: PROFIT_AND_CONTINGENCY_OF_RATE, unit: 'share of rate',
        what: 'May be set to 0.', basis: 'CHOSEN', notYetUsed: true,
      }],
      ['Reinsurance load', {
        value: REINSURANCE_LOAD, unit: 'over a layer\'s EXPECTED loss, every line',
        what: 'Every layer — the occurrence layers and the aggregate — is priced at its expected loss x (1 + this).',
        basis: 'CHOSEN',
        note: 'Was each line\'s funding table read at 70% (WC 1.1400, GL 1.1350, Property 1.1471); separated '
          + 'from the funding tables, so re-deriving them no longer re-prices the reinsurance. Never a percentile '
          + 'of the layer\'s own losses — for a rarely hit layer that is often zero.',
      }],
      ['Prior history years', {
        value: PRIOR_HISTORY_YEARS_NEW, unit: 'years',
        what: 'How many years of prior history the new pricing reads.', basis: 'CHOSEN', notYetUsed: true,
      }],
      ['Pricing window (new)', {
        value: `${PRICING_WINDOW_YEARS_NEW} years, ${PRICING_WINDOW_WEIGHTING_NEW} weights`, unit: 'years',
        what: 'The new window and its weighting.', basis: 'CHOSEN', notYetUsed: true,
      }],
      ['Rate change cap', {
        value: RATE_CHANGE_CAP_NEW === null ? 'none' : RATE_CHANGE_CAP_NEW, unit: '—',
        what: 'Limit on how far the rate may move in a year.', basis: 'CHOSEN', notYetUsed: true,
      }],
      ['Reserve basis', {
        value: RESERVE_BASIS_NEW, unit: '—',
        what: 'The basis reserves are held on.', basis: 'CHOSEN', notYetUsed: true,
      }],
    ],
  },
  {
    title: 'Coverage and the pre-game',
    blurb: 'What the pool covers, and how the board before the players funded it. Both are LIVE.',
    entries: [
      ['GL pool limit', {
        value: `$${(POOL_LIMIT_PER_OCCURRENCE.GL ?? 0).toLocaleString('en-US')} per claim`,
        unit: 'per occurrence, GL only',
        what: 'The most the Pool pays on any one GL claim. Above it the loss falls to the MEMBER — '
          + 'reported each year as the member\'s share, and counted in none of the Pool\'s losses, '
          + 'premium, reserves or pricing.',
        basis: 'CHOSEN',
        note: 'WC and Property have no limit. This corrects an error: loss above $25M used to be counted '
          + 'as the Pool\'s own retention — $655.5M over 30 games x 10 years, 7.83% of GL\'s gross, worst '
          + 'single year $103.9M. Distinct from GL_SEVERITY_CAP ($84M), which is how large a claim can be '
          + 'rather than how much of one the Pool covers. Reinsurance is bought within the limit.',
      }],
      ['Pre-game funding cushion', {
        value: PRE_GAME_FUNDING_CUSHION, unit: 'over expected (CLF 1 + this)',
        what: 'What the previous board funded the declared years at: each line\'s retained pure premium x '
          + '(1 + this). A cushion, not a confidence level — it reads no funding table.',
        basis: 'CHOSEN',
        note: 'Was the 70% level on each line\'s own table (WC 1.1400, GL 1.1350, Property 1.1471). '
          + 'The PLAYER\'S default is unchanged: funding at EXPECTED, CLF 1.000, from year 1. So a team '
          + 'that locks year 1 untouched prices BELOW the year before it — measured at -7.0% on WC, -4.9% '
          + 'on GL, -3.9% on Property, against +41.7% / +18.5% / +35.7% when the pre-game also funded at '
          + 'expected. The year-1 rate itself is identical either way; only the figure it is compared '
          + 'against moves. No player-facing text names it.',
      }],
    ],
  },
  {
    title: 'New loss engine',
    blurb: 'The new loss engine, ON and permanent since commit 3: one aggregate ordinary loss per line per '
      + 'year, the R model\'s twelve-event shock catalogue with large losses as individual claims, regions, '
      + 'and routine large losses every year (on). Each line is ONE BOOK with no individual members. The '
      + 'old engine is frozen on the legacy-engine branch. See docs/PENDING_MULTIPLAYER.md section 3.',
    entries: [
      ['New loss engine', {
        value: newLossEngineRuns() ? 'on' : 'off — member path', unit: 'whenever MEMBER_LEVEL is off',
        what: 'Expected ordinary loss = exposure x the cost per $100 below, trended by accident year at the '
          + 'severity trend; realised = expected x a lognormal year factor with mean exactly 1.',
        basis: 'CHOSEN',
        note: 'Under the flag the rate deducts what the reinsurance will ACTUALLY pay and the reinsurance is '
          + 'priced on the same basis, both from this engine\'s own losses: expected ceded = the expected '
          + 'recovery on its large losses (each event\'s T at the catalogue\'s probability, plus routine large '
          + 'losses when that switch is on), price = that x the line\'s CLF at 70%. Ordinary losses sit below '
          + 'every attachment and cede nothing. Pricing is ex ante: a host\'s schedule is not known to it.',
      }],
      ['Ordinary loss limit', {
        value: `WC $${(ORDINARY_LOSS_LIMIT.WC / 1e6).toFixed(0)}M · GL $${(ORDINARY_LOSS_LIMIT.GL / 1e6).toFixed(0)}M`
          + ` · Property $${(ORDINARY_LOSS_LIMIT.Property / 1e6).toFixed(0)}M`,
        unit: 'per claim',
        what: 'What ordinary losses cover: each claim limited at the line\'s lowest reinsurance attachment. '
          + 'Losses above arrive only with the shocks.',
        basis: 'CHOSEN',
      }],
      ['Ordinary loss factors', {
        value: `year: Baseline CV (WC ${(100 * BASELINE_CV.WC).toFixed(0)}% · GL ${(100 * BASELINE_CV.GL).toFixed(0)}% · `
          + `Property ${(100 * BASELINE_CV.Property).toFixed(0)}%) · unit ${(100 * UNIT_ORDINARY_OWN_CV).toFixed(0)}%`,
        unit: 'CV, each a mean-1 lognormal',
        what: 'Each book unit\'s ordinary loss is its expected loss (exposure x true risk x the line\'s cost) times a '
          + 'year factor every unit shares and a factor of its own; the line\'s ordinary loss is the sum.',
        basis: 'CHOSEN',
        note: 'The R model\'s two factors. The year factor\'s CV is the line\'s Baseline CV since the funding '
          + 'tables wiring (it was 2% on every line); over a book of about 60 unequal units the line\'s CV is about '
          + '6.2% (WC), 8.1% (Property) and 10.1% (GL).',
      }],
      ['Pool loss costs', {
        value: 'WC $2.50 + $0.118 · GL $2.50 + $0.95', unit: 'per $100 of payroll, year 1: $0–$1M + $1M–$5M',
        what: 'The pool\'s own loss costs by per-claim layer, no deductible. Each line\'s ordinary expected loss is '
          + 'the sum of its layers; losses above $5M per claim stay with the pool and arrive only with shocks.',
        basis: 'SOURCED',
        note: 'The pool\'s loss costs, supplied by the pool. GL keeps its $25M per-claim limit. Replaced the old '
          + 'engine\'s derived ordinary cost (WC $2.774, GL $2.830 to $1M, plus the routine claims above it).',
      }],
      ['Expected ordinary loss cost', {
        value: perLine(EXPECTED_ORDINARY_LOSS_COST_PER_100), unit: 'per $100 of exposure, year 1',
        what: 'Each line\'s expected ordinary loss per $100: WC and GL the sum of the pool\'s layers; Property its '
          + 'derived attritional cost, plus the routine fold.',
        basis: 'SOURCED',
        note: 'Property\'s figure was derived by scripts/tools/derive-ordinary-loss-cost.ts from today\'s '
          + 'distributions on the full market at neutral risk quality, year 1, its catastrophe band excluded; it '
          + 'stays until Property\'s loss costs are supplied.',
      }],
      ['Shock scale basis', {
        value: perLine(SHOCK_T_BASIS_PER_100), unit: 'per $100, year 1',
        what: 'The ordinary cost the shocks\' large losses (T) are scaled off.',
        basis: 'CHOSEN',
        note: 'WC and GL read the $0–$1M layer, the closest match to what "ordinary" meant when T was calibrated '
          + '(WC $2.774, GL $2.830): their shocks are about 10% and 12% smaller. Property reads its cost without '
          + 'the routine fold. Whether shocks are fixed in dollars instead is decided once exposure is scaled.',
      }],
      ['Routine large losses', {
        value: ROUTINE_LARGE_LOSSES.enabled ? 'on' : 'off', unit: 'switch',
        what: 'Whether claims above the ordinary limit arrive EVERY year, drawn from today\'s distributions, '
          + 'or only with the shocks. Off, their expected cost is folded into the ordinary losses instead.',
        basis: 'CHOSEN',
        note: 'OFF since the stable-scenarios build: the regular years are stable, and each line-year adds its '
          + 'routine cost / (1 + that year\'s expected A uplift) to the ordinary cost per $100, so the uplift on '
          + 'the larger base gives back exactly the routine cost — the line\'s expected loss is unchanged. The '
          + 'shocks\' large losses stay scaled off the ordinary cost without the fold. It was ON from Prompt A '
          + 'commit 1, routine large claims every year with the shocks on top.',
      }],
      ['Flat pre-game', {
        value: FLAT_PRE_GAME.enabled ? 'on' : 'off', unit: 'switch',
        what: 'In the five pre-game years only: expected investment returns net of fee, and ordinary losses at '
          + 'exactly expected — no year or unit factor. No shocks fire in the pre-game.',
        basis: 'CHOSEN',
        note: 'The history a team inherits is the pool\'s expected experience rather than one seed\'s luck. The '
          + 'played years are untouched.',
      }],
      ['Routine large-loss frequency', {
        value: perLine(ROUTINE_LARGE_LOSS_FREQUENCY_PER_1M, 9), unit: 'claims per $1M of exposure a year',
        what: 'How many claims above the ordinary limit arrive a year when routine large losses are on. Each '
          + 'size is drawn from today\'s mixture above the limit.',
        basis: 'SOURCED',
        note: 'Derived once by the same script as the ordinary cost, on the same basis. Count x mean excess '
          + 'restores the share ordinary losses leave out: WC 0.965, GL 2.763, Property 0.050 per $100 — on '
          + 'GL the pool keeps 2.352, the rest lying above its $25M limit.',
      }],
      ['Region exposure share', {
        value: GAME_REGIONS.map(r => `${r} ${(100 * REGION_EXPOSURE_SHARE[r]).toFixed(0)}%`).join(' · '),
        unit: 'share of each line\'s exposure',
        what: 'The game\'s four regions and each one\'s share of exposure, the same on every line. A regional '
          + 'event strikes one region, drawn by this share, and its A reaches only that region\'s share of '
          + 'ordinary losses.',
        basis: 'CHOSEN',
        note: 'The R model\'s four regions, adopted with book units; they replace three read from today\'s '
          + 'roster (35.2 / 34.4 / 30.4%). Drawn by share, the expected share an event reaches is 0.255 '
          + 'against 0.334 before, so a regional event\'s expected A falls about 23.5%. A regional T is NOT '
          + 'cut to the share: it lands whole in the struck region. The region is the same on every line the '
          + 'event reaches.',
      }],
      ['Large losses per event', {
        value: Object.entries(SHOCK_LOSS_COUNT).map(([e, by]) =>
          `${e} ${Object.entries(by).map(([l, n]) => `${l} ${n}`).join(', ')}`).join(' · '),
        unit: 'losses per T',
        what: 'How many individual losses each event\'s T arrives as, each lognormal around T / count. T is the '
          + 'expected aggregate; the realised total varies and is never rescaled.',
        basis: 'CHOSEN',
        note: `A starting point. ${SHOCK_ONE_OCCURRENCE.join(' and ')} are ONE occurrence each, as today's `
          + 'catastrophe band books them, so the tower answers the event total and an earthquake retains its '
          + '$10M peril deductible first; every other loss is its own occurrence. On GL the pool keeps $25M '
          + 'of any one loss.',
      }],
      ['Large-loss CV', {
        value: SHOCK_LOSS_CV, unit: 'coefficient of variation',
        what: 'The spread of each T loss around T / count.', basis: 'CHOSEN',
      }],
      ['T scaling', {
        value: 'expected ordinary loss / (R base premium x R target loss ratio)', unit: 'per line, per year',
        what: 'How the R model\'s T dollars become the game\'s: each line by its own ratio, never one '
          + 'pool-wide factor.',
        basis: 'CHOSEN',
        note: 'A STABLE basis: both halves are ordinary losses — the R model\'s base premium x target loss '
          + 'ratio is its ordinary expectation — so the ratio moves with the book\'s exposure and the 5% '
          + 'trend and with nothing a team decides about price. At full market it is about 7.7 on WC, 7.5 on '
          + 'GL and 32 on Property.',
      }],
      ['Member-level play', {
        value: MEMBER_LEVEL.enabled ? 'on' : 'off', unit: 'switch',
        what: 'Off, each line is one book: premium = rate x exposure, and underwriting moves exposure. No '
          + 'roster selection, per-member premium or losses, experience modifier, risk quality, rating '
          + 'groups, member satisfaction or departure; satisfaction is hidden and feeds nothing.',
        basis: 'CHOSEN',
        note: 'MEMBER-LEVEL PLAY MAY RETURN. On, it is the member path: each member\'s own claims from the '
          + 'per-claim generators, with no shocks. The code is kept, unwired, and its gates run with this switch '
          + 'on inside their own process so it stays correct. A future member design would likely layer '
          + 'member-level risk over the new engine rather than reuse these generators — to be decided if '
          + 'members return.',
      }],
      ['Risk control', {
        value: RISK_CONTROL.enabled ? 'on' : 'off', unit: 'switch',
        what: 'Off: no charge and no effect. The Decisions page shows each line\'s slider disabled at 0%, '
          + '"coming soon"; the Departments screen hides the programs.',
        basis: 'CHOSEN',
        note: 'PENDING DESIGN at pool level — its effect on the loss engine is being designed separately. '
          + 'The programs, the spend and their code are kept for the redesign to reuse.',
      }],
      ['Opening book', {
        value: perLine(OPENING_BOOK_EXPOSURE, 3), unit: '$M of exposure, base year',
        what: 'What each line opened with before book units — for the record.',
        basis: 'SOURCED', status: 'SUPERSEDED',
        note: 'The mean of today\'s opening books over 40 seeds: 30.1%, 28.8% and 29.7% of the full market. '
          + 'Since book units commit 3 a line opens on its book of units: their sizes summed, about 30% of '
          + 'the market plus the last unit, and different in every game.',
      }],
      ['Full-market exposure', {
        value: perLine(FULL_MARKET_EXPOSURE, 3), unit: '$M of exposure, base year',
        what: 'The most a line can write — the cap on the book. Intake stops at it.',
        basis: 'SOURCED',
        note: 'Today\'s whole 200-member market.',
      }],
      ['Book intake', {
        value: BOOK_INTAKE_SHARE.map(v => `${(100 * v).toFixed(0)}%`).join(' · '),
        unit: 'of the book a year, by intake position',
        what: 'New exposure written each year as a share of the book at the start of the year: No New '
          + 'Business, Strict, Moderate, Low. The renewal cut declines its share of the book, and a Member '
          + 'Withdrawal removes 25% of what is left from the following year.',
        basis: 'CHOSEN',
        note: 'A starting point. The R model wrote about 5 prospects in 100 a year, which is Moderate; today\'s '
          + 'member intake joined about 2%, 4% and 7% of the book at the same three positions.',
      }],
      ['New-business penalty', {
        value: NEW_BUSINESS_PENALTY, unit: 'on first-year actual ordinary losses of new units',
        what: 'Book units written this year cost this much more on their actual ordinary losses, in their first '
          + 'year only. It is not in expected loss: the rate learns it only through the history.',
        basis: 'CHOSEN',
        note: 'The R model\'s 20%, adopted with book units (it was 0, the mechanism without a calibration, and '
          + 'it was in expected loss).',
      }],
      ['Reinsurance packages', {
        value: `WC and GL ${REINSURANCE_OPTIONS.WC.map(o => o.id).join(' · ')}`,
        unit: 'one package per line',
        what: 'What a team buys: one package per line from this fixed set, each one layer per occurrence, '
          + 'priced as the expected recovery on the new engine\'s large losses x the line\'s CLF at 70%.',
        basis: 'CHOSEN',
        note: `Property: ${REINSURANCE_OPTIONS.Property.map(o => o.id).join(' · ')}. GL's $25M pool limit still `
          + 'applies. The tower is cut at every package\'s edges, so each package is whole tower layers.',
      }],
      ['Book units', {
        value: `${UNIT_MARKET_COUNT} units a line; size CV ${(100 * UNIT_SIZE_CV).toFixed(0)}%, risk CV `
          + `${(100 * UNIT_RISK_CV).toFixed(0)}%; the book ${(100 * UNIT_POOL_SHARE).toFixed(0)}% of the market`,
        unit: 'per line',
        what: 'Each line\'s market split into units drawn from the game seed: sizes summing to the full market, '
          + 'true risk scores averaging 1.0 by size, regions by share. The opening book is the market in a '
          + 'seeded order until it reaches the pool share — about 60 units. Never shown.',
        basis: 'CHOSEN',
        note: 'The R model\'s shapes. Read by nothing yet: the book is drawn and stored once per game, and the '
          + 'engine still runs on each line\'s one exposure.',
      }],
      ['Underwriting visibility', {
        value: UNIT_UW_VISIBILITY, unit: 'share of the observed risk\'s variance that is true risk',
        what: 'How well underwriting sees each book unit\'s true risk. Renewal declines the units that look '
          + 'riskiest; intake takes the prospects that look best. 0 is random selection, 1 perfect.',
        basis: 'CHOSEN',
        note: 'A starting point. The noise is drawn once from the game seed, so a unit looks the same every '
          + 'year and in every world.',
      }],
      ['Default package', {
        value: `WC ${REINSURANCE_DEFAULT_OPTION.WC} · GL ${REINSURANCE_DEFAULT_OPTION.GL} · Property ${REINSURANCE_DEFAULT_OPTION.Property}`,
        unit: 'per line',
        what: 'The middle option, held by every team until it chooses and by the pre-game\'s prior board.',
        basis: 'CHOSEN',
      }],
      ['Worlds', {
        value: String(WORLD_COUNT), unit: 'worlds per team-year',
        what: 'Each team\'s year runs in this many worlds, all teams sharing the same worlds\' draws; dollars '
          + 'shown are the average across worlds and every ratio is recomputed from averaged parts.',
        basis: 'CHOSEN',
        note: 'Shared across worlds: the decisions, one rate per team-year struck from the averaged history, '
          + 'and host-scheduled shocks (severity drawn per world). Per world: the ordinary year factor, shock '
          + 'severities, routine large losses and investment returns, and its own ledger and surplus.',
      }],
      ['Aggregate cover', {
        value: 'not offered', unit: '—',
        what: 'The aggregate stop-loss is not among the packages: not offered, its code kept unwired.',
        basis: 'CHOSEN',
        note: 'IT MAY RETURN. Aggregate cover is what protects against a broad surge of small losses — a '
          + 'winterstorm\'s many claims under the retention — which no per-occurrence package reaches.',
      }],
      ['Shocks per year', {
        value: SHOCKS_PER_YEAR, unit: 'expected events a year',
        what: 'The catalogue\'s twelve probabilities, each scaled by the same factor so they total this, keeping '
          + 'their relative weights.', basis: 'CHOSEN',
        note: `Scale ${SHOCK_CATALOGUE_SCALE.toFixed(4)} on the R model's 0.432 a year — three events in a ten-year game `
          + 'in expectation, rather than four or five.',
      }],
      ['Shock schedule count', {
        value: `round(${SHOCKS_PER_YEAR} x years) ± ${SHOCK_SCHEDULE_SPREAD}, at least 1`, unit: 'events per game',
        what: 'How many events Randomise and the singleplayer schedule draw: round(Shocks per year x years), '
          + 'then −1, 0 or +1, equally likely, never fewer than one and at most one a year from year 2 — 2 to 4 in '
          + 'a ten-year game.', basis: 'CHOSEN',
        note: 'Was one event per three years, rounded. Year 1 stays shock-free.',
      }],
      ['Shock timing', {
        value: 'a schedule drawn once — the host\'s, or singleplayer\'s at its start', unit: '—',
        what: 'Multiplayer fires only what the host scheduled. Singleplayer draws its schedule once, at the '
          + 'game\'s start, by the same rule as the host\'s Randomise (Shock schedule count, from year 2, '
          + 'weighted by the catalogue\'s probabilities) on its own stream, and keeps it in the save. Either way '
          + 'every world fires the same events in the same years — a regional event in the same region, '
          + 'resolved once when the game is built — and only each firing\'s size is drawn per world, from a '
          + 'stream keyed on the world, the event and its year. Pricing uses the catalogue\'s '
          + 'probabilities, never the schedule. Nothing fires before year 1.',
        basis: 'CHOSEN',
      }],
    ],
  },
  {
    title: 'Decided with the loss engine, not yet wired',
    blurb: 'Decisions already taken about the new loss engine, recorded before it is built. '
      + 'NONE of these is in force — see docs/PENDING_MULTIPLAYER.md.',
    entries: [
      ['Development basis', {
        value: DEVELOPMENT_IS_LIFETIME_TOTAL ? 'lifetime total' : 'per year', unit: '—',
        what: 'Development is a TOTAL over each accident year\'s remaining lifetime, emerging with the '
          + 'payments — a year that is 60% paid has seen about 60% of its development. Not a yearly rate.',
        basis: 'CHOSEN',
        note: 'It can be changed. ⚠ Read as a YEARLY rate instead, the same percentages compound to roughly '
          + '+54% on GL and +171% on WC in total at today\'s settings — a different model, not a refinement.',
      }],
      ['Yearly adverse development', {
        value: perLine(YEARLY_ADVERSE_RATE, 3), unit: 'per year, of each open year\'s unpaid reserve',
        what: 'PLACEHOLDER — NOT YET USED. Will replace the host\'s lifetime development: a yearly rate on each open '
          + 'accident year\'s unpaid reserve, applied before payments, booked as prior-year development, and not '
          + 'anticipated by pricing.',
        basis: 'CHOSEN', notYetUsed: true,
        note: 'Zero on every line and read by nothing; recorded so the design sits beside the value until it is wired.',
      }],
      ['GL ordinary losses', {
        value: `$${GL_ORDINARY_LOSS_BAND_PLANNED.from.toLocaleString('en-US')}`
          + `-$${GL_ORDINARY_LOSS_BAND_PLANNED.to.toLocaleString('en-US')}`,
        unit: 'the layer they occupy',
        what: 'GL\'s ordinary losses are the $0-1M layer, paid on that limited layer\'s own payout pattern.',
        basis: 'CHOSEN', notYetUsed: true,
        note: 'The matched pattern is the point: the whole-account pattern is dominated by the large claims '
          + 'above this band and would pay these out too slowly.',
      }],
    ],
  },
  {
    title: 'R model (data scientist)',
    blurb: 'The data scientist\'s R model, recorded in full. **Read only by the new loss engine** — the '
      + 'entries it reads carry no *not yet used* mark, and every other entry is still unread. '
      + 'The Status column says what the game did with each: ADOPTED (as given), ADOPTED, SCALED, '
      + 'ADAPTED (changed to fit), SUPERSEDED (replaced by a game decision) or NOT USED. '
      + 'Every entry is CHOSEN rather than SOURCED: the data scientist states that the payout patterns, '
      + 'the routine reserve development and the A/T/R shock assumptions are illustrative and not fitted '
      + 'to claims data, and nothing else in the model is presented as fitted to this pool either.',
    entries: [
      // ---- general ----
      ['Selected line', {
        value: 'one of GL / WC / Property', unit: '—', basis: 'CHOSEN', notYetUsed: true,
        status: 'NOT USED',
        what: 'The administrator picks ONE line for the whole session.',
        note: 'The host picks one or more lines, and a team plays the room\'s whole set.',
      }],
      ['Years', {
        value: R_MODEL.years, unit: 'years', basis: 'CHOSEN', notYetUsed: true, status: 'NOT USED',
        what: 'The model\'s fixed seven-year span.',
        note: 'The game\'s years are the host\'s, 3 to 10 from a chosen starting year.',
      }],
      ['Pre-generated scenarios', {
        value: R_MODEL.preGeneratedScenarios, unit: 'scenarios', basis: 'CHOSEN', notYetUsed: true,
        status: 'NOT USED',
        what: 'How many scenarios the model generates up front.',
        note: 'The game generates on demand from the seed, so there is no pre-generated pool to size.',
      }],
      ['Background simulations', {
        value: R_MODEL.backgroundSimulations, unit: 'simulations', basis: 'CHOSEN', notYetUsed: true,
        status: 'ADAPTED',
        what: 'How many scenarios each displayed figure averages.',
        note: 'The game averages 10, and the count is a parameter — 100 in a browser, per team per year, '
          + 'is the cost the game cannot pay.',
      }],
      ['Members, prospects, offers', {
        value: `${R_MODEL.initialMembers} members · ${R_MODEL.prospects} prospects · `
          + `${R_MODEL.prospectsPerYear} offered a year`,
        unit: 'members', basis: 'CHOSEN', notYetUsed: true, status: 'SUPERSEDED',
        what: 'The model\'s individual member population and its new-business pipeline.',
        note: 'No individual members. Exposure is the unit, and underwriting moves it in and out.',
      }],
      ['Regions', {
        value: R_MODEL.regions, unit: 'share of members', basis: 'CHOSEN', status: 'ADOPTED',
        what: 'Four regions, with a membership share each, for regional shocks.',
        note: 'Adopted with book units as REGION_EXPOSURE_SHARE, as exposure shares; a regional event strikes '
          + 'one region drawn by share.',
      }],
      ['Premium growth', {
        value: R_MODEL.premiumGrowthPerYear, unit: 'per year', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'Renewal premium growth per member.',
        note: 'The game trends severity at 5% on a level exposure base; see Trend and exposure above.',
      }],
      ['Initial surplus', {
        value: R_MODEL.initialSurplus, unit: 'dollars', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'The opening surplus every player starts with.',
        note: 'The set opening: 2.28 x the line\'s own required capital. See The opening above.',
      }],
      ['Expense ratio', {
        value: R_MODEL.expenseRatio, unit: 'of premium', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'Operating expense as a flat share of premium.',
        note: 'The game charges a fixed amount plus a per-exposure admin load.',
      }],
      ['Random seeds', {
        value: R_MODEL.seeds, unit: '—', basis: 'CHOSEN', notYetUsed: true, status: 'NOT USED',
        what: 'The literal seeds the model sets before each draw.',
        note: 'The game uses labelled sub-streams off one instance seed.',
      }],

      // ---- variance ----
      ['Baseline (year-wide) CV', {
        value: R_MODEL.baselineCV, unit: 'coefficient of variation', basis: 'CHOSEN', notYetUsed: true,
        status: 'ADAPTED',
        what: 'The year-wide ordinary-loss factor\'s CV, shared by every member.',
        note: `The data scientist's own revision — ${R_MODEL.baselineCVEarlier} earlier, superseded in the `
          + 'model as supplied. Folded into one CV per line in the game.',
      }],
      ['Member loss CV', {
        value: R_MODEL.memberLossCV, unit: 'coefficient of variation', basis: 'CHOSEN', notYetUsed: true,
        status: 'ADAPTED',
        what: 'The per-member, per-year loss factor\'s CV.',
        note: `The data scientist's own revision — ${R_MODEL.memberLossCVEarlier} earlier, superseded in `
          + 'the model as supplied. Folded into one CV per line. ⚠ NOT a straight carry-over: this CV '
          + 'is averaged over 100 members, so it contributes about CV/sqrt(100) to the line. Applied to a '
          + 'handful of exposure buckets it would contribute far more, and the line would be lumpier '
          + 'than the model it came from.',
      }],
      ['Member risk CV', {
        value: R_MODEL.memberRiskCV, unit: 'coefficient of variation', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'Spread of the fixed per-member risk score.',
        note: 'No members, so no risk scores. The game has no per-member quality in the new engine.',
      }],
      ['Member size CV', {
        value: R_MODEL.memberSizeCV, unit: 'coefficient of variation', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'Spread of the fixed per-member size factor.',
        note: 'No members, so no size factors.',
      }],

      // ---- shock effects ----
      ['Shock decay rate', {
        value: R_MODEL.shockDecayRate, unit: 'per year', basis: 'CHOSEN',
        status: 'ADOPTED',
        what: 'A and R decay by this factor each year of an event\'s duration. T fires only at onset.',
      }],
      ['Economic inflation, initial', {
        value: R_MODEL.economicInflationInitialRate, unit: 'on ordinary losses', basis: 'CHOSEN',
        status: 'ADOPTED',
        what: 'The Economic Inflation event\'s first-year uplift, decaying at the decay rate.',
      }],
      ['Investment loss adjustment', {
        value: R_MODEL.investmentLossAdjustment, unit: 'added to the equity return', basis: 'CHOSEN',
        status: 'ADOPTED',
        what: 'The Investment Loss event\'s hit to the equity return in the event year.',
      }],
      ['Member withdrawal reduction', {
        value: R_MODEL.memberWithdrawalReduction, unit: 'of exposure', basis: 'CHOSEN',
        status: 'ADOPTED',
        what: 'The Member Withdrawal event cuts exposure by this much from the FOLLOWING year.',
      }],
      ['New-business penalty', {
        value: R_MODEL.newBusinessPenalty, unit: 'on first-year expected loss', basis: 'CHOSEN',
        status: 'ADAPTED',
        what: 'New business costs more in its first year than its price implies.',
        note: 'Adopted as NEW_BUSINESS_PENALTY with book units: 20% on new units\' first-year actual ordinary '
          + 'losses, kept out of expected loss so the rate learns it through the history.',
      }],

      // ---- investment ----
      ['Investable surplus ratio', {
        value: R_MODEL.investableSurplusRatio, unit: 'of positive beginning surplus', basis: 'CHOSEN',
        notYetUsed: true, status: 'SUPERSEDED',
        what: 'The share of surplus that earns a return.',
        note: 'The game invests its own assets on its own model; see the investment parameters elsewhere.',
      }],
      ['Default equity allocation', {
        value: R_MODEL.defaultEquityAllocation, unit: 'of investable assets', basis: 'CHOSEN',
        notYetUsed: true, status: 'SUPERSEDED', what: 'The default equity share.',
        note: 'The game\'s allocation is a player decision across cash, bonds and equities.',
      }],
      ['Expected equity return', {
        value: R_MODEL.expectedEquityReturn, unit: 'per year', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED', what: 'Mean equity return.', note: 'The game\'s investment model sets its own.',
      }],
      ['Equity return SD', {
        value: R_MODEL.equityReturnSD, unit: 'per year', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED', what: 'Equity return standard deviation.',
        note: 'The game\'s investment model sets its own.',
      }],
      ['Fixed income return', {
        value: R_MODEL.fixedIncomeReturn, unit: 'per year', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED', what: 'The fixed-income leg\'s flat return.',
        note: 'The game\'s investment model sets its own.',
      }],
      ['Investment period', {
        value: R_MODEL.investmentPeriodYears, unit: 'years', basis: 'CHOSEN', notYetUsed: true,
        status: 'NOT USED', what: 'How long each year\'s investment is held.',
      }],
      ['General-tab legacy fields', {
        value: `$${(R_MODEL.generalInitialInvestments / 1e6).toFixed(0)}M · `
          + `${(R_MODEL.generalLegacyInvestmentReturn * 100).toFixed(1)}% · `
          + `${(R_MODEL.generalLegacyInvestmentReturnSD * 100).toFixed(1)}% SD`,
        unit: 'dollars, per year', basis: 'CHOSEN', notYetUsed: true, status: 'NOT USED',
        what: 'Initial investments and a legacy return, from the workbook\'s General tab.',
        note: 'The R model itself marks these unused — superseded there by its Investment Return tab.',
      }],

      // ---- lines ----
      ['Base premium', {
        value: `GL $${(R_MODEL.basePremium.GL / 1e6).toFixed(1)}M · `
          + `WC $${(R_MODEL.basePremium.WC / 1e6).toFixed(1)}M · `
          + `Property $${(R_MODEL.basePremium.Property / 1e6).toFixed(1)}M`,
        unit: 'dollars', basis: 'CHOSEN', status: 'ADOPTED',
        what: 'The model\'s premium for each line.',
        note: 'Kept for ONE job: with the target loss ratio, the denominator that scales T per line. See the '
          + 'T scaling row under New loss engine.',
      }],
      ['Target loss ratio', {
        value: `GL ${R_MODEL.targetLossRatio.GL} · WC ${R_MODEL.targetLossRatio.WC} · `
          + `Property ${R_MODEL.targetLossRatio.Property}`,
        unit: 'of premium', basis: 'CHOSEN', status: 'ADAPTED',
        what: 'Expected loss as a share of premium, per line.',
        note: 'The game derives expected loss from its own exposure and pure premium, not from a target. Used '
          + 'for one job: base premium x this is the R model\'s ordinary expectation, the denominator of T '
          + 'scaling.',
      }],

      // ---- A / T / R ----
      ['A shocks — GL', {
        value: rLevels(R_MODEL.aShock.GL), unit: 'increase on ordinary losses', basis: 'CHOSEN',
        status: 'ADOPTED',
        what: 'Drawn uniformly within the level\'s range, then decayed over the event\'s duration.',
        note: 'Illustrative, says the data scientist — not fitted to claims data.',
      }],
      ['A shocks — WC', {
        value: rLevels(R_MODEL.aShock.WC), unit: 'increase on ordinary losses', basis: 'CHOSEN',
        status: 'ADOPTED', what: 'As GL, with WC\'s own High range.',
      }],
      ['A shocks — Property', {
        value: rLevels(R_MODEL.aShock.Property), unit: 'increase on ordinary losses', basis: 'CHOSEN',
        status: 'ADOPTED', what: 'The widest of the three, up to a doubling.',
      }],
      ['T shocks — GL', {
        value: rLevels(R_MODEL.tShock.GL, false), unit: 'dollars at onset', basis: 'CHOSEN',
        status: 'ADOPTED, SCALED',
        what: 'An aggregate shock loss at the event\'s start, drawn uniformly.',
        note: '⚠ SCALED PER LINE, by that line\'s own ratio, never one pool-wide factor — the game\'s '
          + 'expected ordinary loss against the R model\'s (base premium x target loss ratio), a basis that '
          + 'does not move with a team\'s funding level; see T scaling under New loss engine. The model\'s '
          + 'Property book is $4.5M and its GL book $7M, so a single factor would scale them unevenly. In '
          + 'the game T arrives as large INDIVIDUAL losses, not a lump sum, so occurrence reinsurance can '
          + 'respond to it.',
      }],
      ['T shocks — WC', {
        value: rLevels(R_MODEL.tShock.WC, false), unit: 'dollars at onset', basis: 'CHOSEN',
        status: 'ADOPTED, SCALED', what: 'As GL, scaled by WC\'s own premium ratio.',
      }],
      ['T shocks — Property', {
        value: rLevels(R_MODEL.tShock.Property, false), unit: 'dollars at onset', basis: 'CHOSEN',
        status: 'ADOPTED, SCALED',
        what: 'The largest of the three, scaled by Property\'s own premium ratio.',
      }],
      ['R shocks', {
        value: rLevels(R_MODEL.rShock), unit: 'on outstanding prior-year reserves', basis: 'CHOSEN',
        status: 'ADOPTED',
        what: 'An extra adverse rate on prior years\' outstanding reserves, drawn uniformly and decayed.',
        note: 'Illustrative, says the data scientist — not fitted to claims data.',
      }],

      // ---- catalogue and map ----
      ['Shock catalogue', {
        value: `${R_MODEL.catalogue.length} events`, unit: 'probability, duration, regional',
        basis: 'CHOSEN', status: 'ADOPTED, SCALED',
        what: 'As given: Earthquake 0.2%/1y regional · Winterstorm 6%/1y regional · Wildfire 3.5%/1y regional · '
          + 'Legislation 1.5%/3y · WC Reform 2%/3y · Recession 6%/2y · Nuclear Verdict 2.5%/1y · '
          + 'Social Inflation 4.5%/3y · Pandemic 1%/2y · Economic Inflation 10%/3y · '
          + 'Investment Loss 4%/1y · Member Withdrawal 2%/2y — 0.432 events a year in all.',
        note: `Probabilities SCALED by ${SHOCK_CATALOGUE_SCALE.toFixed(4)} (Shocks per year), keeping their relative `
          + 'weights. They price each event\'s expected cost and weight the schedule\'s draw; the schedule, not '
          + 'a probability, decides what fires in a game. Durations and regional flags adopted throughout.',
      }],
      ['Shock map', {
        value: `${R_MODEL.shockMap.length} event-line pairs`, unit: 'A / T / R level', basis: 'CHOSEN',
        status: 'ADOPTED',
        what: 'Earthquake: GL Mid/–/– · WC High/–/– · Property High/High/–. Winterstorm: Property '
          + 'High/Low/–. Wildfire: Property Low/High/–. Legislation: GL Mid/–/High. WC Reform: WC '
          + 'High/–/Mid. Recession: GL Low/–/– · WC Low/–/–. Nuclear Verdict: GL –/High/Mid. '
          + 'Social Inflation: GL High/Low/Mid. Pandemic: GL –/Mid/– · WC High/High/–.',
        note: 'Which line each event touches, and at what level on each of the three channels.',
      }],

      // ---- superseded structure ----
      ['Reinsurance terms', {
        value: 'GL $5M xs $5M @ 15% · WC $4M xs $4.5M @ 13% · Property $7M xs $3.5M @ 16%',
        unit: 'limit xs attachment, rate on line', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'A single AGGREGATE stop on each line\'s annual loss, priced at a rate on line.',
        note: 'The game prices OCCURRENCE layers at expected layer loss x CLF at 70%, which is why T '
          + 'has to arrive as individual losses rather than one aggregate number.',
      }],
      ['Payout patterns', {
        value: `GL ${R_MODEL.paidCumulative.GL.length}y · WC ${R_MODEL.paidCumulative.WC.length}y · `
          + `Property ${R_MODEL.paidCumulative.Property.length}y`,
        unit: 'cumulative paid share by development year', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'GL 15/30/43/55/65/73/80/86/90/94/97/99/100%. '
          + 'WC 10/20/30/38/45/51/57/62/67/70/73/76/78/80/82/84/86/88/94/100%. '
          + 'Property 55/75/87/94/98/100%.',
        note: 'Illustrative, says the data scientist — not fitted to claims data. The game uses the '
          + 'RECORDED paid and incurred patterns, which are: WC 37 years, GL 21, Property 11.',
      }],
      ['Routine reserve development', {
        value: `mean ${R_MODEL.routineDevelopmentMean.toFixed(2)} · SD ${R_MODEL.routineDevelopmentSD}`,
        unit: 'on beginning outstanding reserves', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'A normal draw applied each year to each prior year\'s outstanding reserves.',
        note: 'Illustrative, says the data scientist — not fitted to claims data. Removed: development '
          + 'comes from the host\'s development setting and from the R-type reserve shocks, and from '
          + 'nothing else.',
      }],
    ],
  },
];
