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

import { CoverageLine } from '../types/simulation';

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
 * ACCIDENT-YEAR SEVERITY TREND — one rate per line, applied at the DRAW.
 * Each claim in accident year n costs (1 + rate)^(n-1) of its year-1 amount.
 */
export const SEVERITY_TREND_PER_YEAR: PerLine<number> = { WC: 0.05, GL: 0.05, Property: 0.05 };

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

/** The reserve margin's fixed confidence level. */
export const RESERVE_MARGIN_CONFIDENCE_PARAM = 0.90;

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
 * ALAE — allocated loss adjustment expense, as a share of loss cost.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const ALAE_OF_LOSS_COST: PerLine<number> = { WC: 0.083, GL: 0.083, Property: 0.083 };

/**
 * ULAE — unallocated loss adjustment expense, as a share of loss cost.
 * ⚠ NOT YET USED — read from commit 2 onward.
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
 * THE REINSURANCE LOAD — the line's CLF-table multiplier at 70%, applied to a
 * LAYER'S EXPECTED LOSS.
 *
 * ⚠ IT IS NOT THE 70TH PERCENTILE OF THE LAYER'S OWN LOSSES, and the difference
 * is the reason this is a named parameter rather than a lookup at the call
 * site. A layer that is rarely hit has a loss distribution with a large atom at
 * zero, so its own 70th percentile is often ZERO — or, where it is not, below
 * its own mean. Pricing off that would charge nothing for the layers that most
 * need a margin. The pool-level CLF at 70% is a multiplier on an EXPECTED loss
 * and behaves properly at any hit rate.
 *
 * Values are each line's own static CLF table at 0.70, read at this commit:
 * WC 1.1400, GL 1.1350, Property 1.1471. The generic FUNDING_CLF_TABLE reads
 * 1.217 at the same stop and is NOT what these are.
 *
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const REINSURANCE_LOAD_CLF_AT_70: PerLine<number> = {
  WC: 1.1400,
  GL: 1.1350,
  Property: 1.1471,
};

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
 * WHAT THE BOARD FUNDED AT BEFORE THE PLAYERS ARRIVED — the 70% confidence
 * level, on each line's own CLF table.
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
 * change column reports, and the welcome memo states the 70% so the drop is
 * explicable rather than surprising. The memo READS this constant.
 */
export const PRE_GAME_FUNDING_LEVEL = 0.70;

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
 * (scripts/tools/engine-mode/member-level.ts), so it keeps compiling and stays
 * correct while the game runs without it. A future member design would likely
 * LAYER member-level risk over the new engine rather than reuse these
 * generators — to be decided if members return.
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
 * THE YEAR-TO-YEAR CV OF ORDINARY LOSSES, PER LINE — the one stochastic
 * parameter of the ordinary engine.
 *
 * 2.2% is what the R model's ordinary losses actually produce once its member
 * factor has averaged over 100 members — not either of its two input CVs (the
 * 2% year-wide factor and the 10% member factor), which compound to
 * sqrt(0.02^2 + 0.10^2/100) = 2.24%. Stated directly at the line, so nothing
 * has to invent a population of exposure units to get a variance.
 *
 * The draw is LOGNORMAL WITH MEAN EXACTLY 1: sigma^2 = ln(1 + CV^2) and
 * mu = -sigma^2/2. So the expected ordinary loss IS the mean of the draws by
 * construction, and there is no separate "held" figure that could drift from
 * them. ordinary-loss-check asserts both moments.
 */
export const ORDINARY_LOSS_CV: PerLine<number> = {
  WC: 0.022,
  GL: 0.022,
  Property: 0.022,
};

/**
 * EXPECTED ORDINARY LOSS COST PER $100 OF EXPOSURE, YEAR 1 — SOURCED.
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
export const EXPECTED_ORDINARY_LOSS_COST_PER_100: PerLine<number> = {
  WC: 2.774112,
  GL: 2.830161,
  Property: 0.159515,
};

// ============================================================================
// THE NEW LOSS ENGINE — commit 2 of 6: shocks, large losses, regions.
// See docs/PENDING_MULTIPLAYER.md section 3 and src/utils/shockLosses.ts.
// ============================================================================

/**
 * ROUTINE LARGE LOSSES — A SWITCH, OFF, AND THE QUESTION FOR THE TEAM.
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
export const ROUTINE_LARGE_LOSSES = { enabled: false };

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
 * EACH LINE'S EXPOSURE SPLIT ACROSS THE GAME'S THREE REGIONS — SOURCED.
 *
 * Read once from today's 200-member roster by the derivation script. A
 * regional event's A applies to its region's share of the line's ordinary
 * losses, read from HERE rather than from the book a team happens to hold —
 * the engine is leaving members behind (commit 5), and exposure by region has
 * to be a property of the line when it does.
 */
export const REGION_EXPOSURE_SHARE: PerLine<Readonly<Record<'North' | 'Central' | 'South', number>>> = {
  WC: { North: 0.352177, Central: 0.343909, South: 0.303914 },
  GL: { North: 0.352177, Central: 0.343909, South: 0.303914 },
  Property: { North: 0.352290, Central: 0.338421, South: 0.309289 },
};

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
 * NEW BUSINESS A YEAR, AS A SHARE OF THE CURRENT BOOK, PER INTAKE POSITION —
 * CHOSEN, A STARTING POINT. No New Business, Strict, Moderate, Low. The R model
 * wrote about 5 prospects in 100 a year, which is Moderate; today's member
 * intake joined about 2%, 4% and 7% of the book at the same three positions.
 */
export const BOOK_INTAKE_SHARE: readonly number[] = [0, 0.02, 0.05, 0.08];

/**
 * NEW-BUSINESS PENALTY — on the ordinary losses of exposure written this year,
 * in its first year. CHOSEN at ZERO: the R model's 20% is kept as the
 * mechanism, uncalibrated. At zero it changes nothing.
 */
export const NEW_BUSINESS_PENALTY = 0;

/**
 * OPENING SURPLUS, as a multiple of each line's OWN REQUIRED CAPITAL.
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
 * ⚠ NOT YET USED — commit (b) of the opening rebuild reads it.
 */
export const OPENING_SURPLUS_MULTIPLE_OF_REQUIRED = 2.28;

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
// ⚠ NO LONGER "NOT YET WIRED". The host's development % reads this convention
// and hostDevelopment.ts implements it; the entry above is live. The constant
// stays as the written-down statement of WHICH convention is in force.

/**
 * THE REINSURANCE STRUCTURES A TEAM WILL BE ABLE TO BUY — built with the loss
 * engine, not offered today.
 *
 * ⚠ THESE REPLACE THE PRESENT TOWER'S FIXED BANDS WITH A CHOICE OF PROGRAMMES,
 * which is a different decision from the one REINSURANCE_TOWER encodes: today
 * a team places or declines each band independently, and here a team picks one
 * structure. Both are written down because the second does not exist yet and
 * the first is what ships.
 *
 * WC and GL are deliberately the SAME LIST. Property's differs because its
 * retention and its limits do.
 */
export const REINSURANCE_OPTIONS_PLANNED: PerLine<readonly string[]> = {
  WC: ['none', '$9M xs $1M', '$5M xs $5M', '$14M xs $1M', '$10M xs $5M'],
  GL: ['none', '$9M xs $1M', '$5M xs $5M', '$14M xs $1M', '$10M xs $5M'],
  Property: ['none', '$20M xs $5M', '$45M xs $5M', '$25M xs $25M'],
};

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
        what: 'Accident-year severity growth. One rate, all three lines.', basis: 'CHOSEN',
        note: 'Replaces WC 3.67% / GL 5.7026% / Property 0. A round figure above WC\'s measured 3.67%, '
          + 'and the first number to tune if the rate moves too fast.',
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
        what: 'The fixed confidence the reserve margin is held at.', basis: 'CHOSEN',
      }],
      ['CLF tables', {
        value: 'per line, in clfTables.ts', unit: 'multiplier on expected loss',
        what: 'Confidence level factors by line and confidence stop.', basis: 'SOURCED',
        note: 'REGISTERED, NOT MOVED — each table is a fit whose method, controls and rejected alternatives are recorded beside it.',
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
    blurb: 'The SET opening — no acceptance band, no pin, no search. '
      + 'NOT YET USED: commit (a) records them, commit (b) reads them.',
    entries: [
      ['Prior history years', {
        value: PRIOR_HISTORY_YEARS, unit: 'accident years',
        what: 'How many pre-game years are simulated with real claims behind them.', basis: 'CHOSEN',
        note: 'Ten while the old ten-year experience path is live; drops to the new window of five at '
          + 'commit 3, and the two move together. Everything older opens as a bulk cohort.',
      }],
      ['Opening surplus multiple', {
        value: OPENING_SURPLUS_MULTIPLE_OF_REQUIRED, unit: 'x the line\'s own required capital',
        what: 'Sets opening surplus directly, replacing the band and the pin.', basis: 'CHOSEN',
        notYetUsed: true,
        note: 'REQUIRED CAPITAL IS expectedNetUnpaidLoss x (staticClf(line, 0.90) - 1), the reserve risk '
          + 'margin — not premium, not the reserve itself. 2.28 is today\'s band midpoint carried over, '
          + 'so the set opening lands where the search was aiming.',
      }],
      ['Bulk cohort horizon', {
        value: 'each line\'s own recorded paid pattern', unit: 'accident years',
        what: 'How far back the opening runoff reaches: WC 37 years, GL 21, Property 11.', basis: 'SOURCED',
        note: 'The full pattern length. WC is still 9.04% unpaid at 37 years, and its newest 25 accident '
          + 'years hold only 95% of its steady-state reserve, so truncating discards real reserve.',
      }],
    ],
  },
  {
    title: 'The new pricing parameters',
    blurb: 'NOT YET USED — read from commit 2 onward. Every one is CHOSEN and is a starting value to be tuned.',
    entries: [
      ['ALAE', {
        value: perLine(ALAE_OF_LOSS_COST, 3), unit: 'share of loss cost',
        what: 'Allocated loss adjustment expense.', basis: 'CHOSEN', notYetUsed: true,
      }],
      ['ULAE', {
        value: perLine(ULAE_OF_LOSS_COST, 3), unit: 'share of loss cost',
        what: 'Unallocated loss adjustment expense.', basis: 'CHOSEN', notYetUsed: true,
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
        value: perLine(REINSURANCE_LOAD_CLF_AT_70, 4), unit: 'multiplier on a layer\'s EXPECTED loss',
        what: 'The line\'s CLF-table multiplier at 70%.', basis: 'CHOSEN', notYetUsed: true,
        note: 'NOT the 70th percentile of the layer\'s own losses — for a rarely hit layer that is often zero, or below its own mean.',
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
      ['Pre-game funding level', {
        value: PRE_GAME_FUNDING_LEVEL, unit: 'confidence level',
        what: 'What the previous board funded the declared years at, on each line\'s own CLF table.',
        basis: 'CHOSEN',
        note: 'The PLAYER\'S default is unchanged: funding at EXPECTED, CLF 1.000, from year 1. So a team '
          + 'that locks year 1 untouched prices BELOW the year before it — measured at -7.0% on WC, -4.9% '
          + 'on GL, -3.9% on Property, against +41.7% / +18.5% / +35.7% when the pre-game also funded at '
          + 'expected. The year-1 rate itself is identical either way; only the figure it is compared '
          + 'against moves. The welcome memo reads this constant rather than naming a number.',
      }],
    ],
  },
  {
    title: 'New loss engine',
    blurb: 'The new loss engine, ON and permanent since commit 3: one aggregate ordinary loss per line per '
      + 'year, the R model\'s twelve-event shock catalogue with large losses as individual claims, regions, '
      + 'and a switch for routine large losses (off). Each line is ONE BOOK with no individual members. The '
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
      ['Ordinary loss CV', {
        value: perLine(ORDINARY_LOSS_CV, 3), unit: 'year-to-year',
        what: 'The year factor\'s coefficient of variation — the one stochastic parameter of ordinary losses.',
        basis: 'CHOSEN',
        note: 'What the R model\'s ordinary losses produce over 100 members: sqrt(0.02^2 + 0.10^2/100) = 2.24%.',
      }],
      ['Expected ordinary loss cost', {
        value: perLine(EXPECTED_ORDINARY_LOSS_COST_PER_100), unit: 'per $100 of exposure, year 1',
        what: 'The expected ordinary loss per $100, derived ONCE and fixed. It is the mean of the draws by '
          + 'construction; nothing holds a second figure.',
        basis: 'SOURCED',
        note: 'Derived by scripts/tools/derive-ordinary-loss-cost.ts from today\'s distributions on the full '
          + 'market at neutral risk quality, year 1, k = 1, each claim limited at the line\'s ordinary limit; '
          + 'Property is the attritional band only, its catastrophe band excluded. Share of today\'s expected '
          + 'loss now waiting for the shocks: WC 25.8%, GL 49.4%, Property 33.1% (12.0% the catastrophe band, '
          + '21.1% attritional above $5M).',
      }],
      ['Routine large losses', {
        value: ROUTINE_LARGE_LOSSES.enabled ? 'on' : 'off', unit: 'switch',
        what: 'Whether claims above the ordinary limit arrive EVERY year, drawn from today\'s distributions, '
          + 'or only with the shocks.',
        basis: 'CHOSEN',
        note: 'FOR THE TEAM: the question is where the large claims come from. OFF — shocks only: quiet years '
          + 'are quiet, the rate is low and steady, and on WC and GL expected loss sits well under today\'s: '
          + 'ordinary losses leave out a quarter of WC and half of GL, and the catalogue brings back only a '
          + 'little of it (Property\'s catastrophe events bring back most of its third). ON — routine large '
          + 'losses every year, with the shocks as the tail on '
          + 'top: expected loss returns close to today\'s, the tower pays most years, and the rate moves more. '
          + 'Property\'s catastrophe band stays with the shocks either way. scripts/tools/new-engine-report.ts '
          + 'puts the two side by side.',
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
        value: (['WC', 'GL', 'Property'] as const).map(l => `${l} `
          + (['North', 'Central', 'South'] as const).map(r => `${r} ${(100 * REGION_EXPOSURE_SHARE[l][r]).toFixed(1)}%`).join(' / ')).join(' · '),
        unit: 'share of the line\'s exposure',
        what: 'Each line\'s exposure split across the game\'s three regions. A regional event\'s A reaches only '
          + 'its region\'s share of ordinary losses.',
        basis: 'SOURCED',
        note: 'Read once from today\'s roster. A regional T is NOT cut to the share: it is the event\'s own '
          + 'size and lands whole on members in the struck region, drawn by exposure. The region is drawn '
          + 'uniformly per firing and is the same on every line the event reaches.',
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
        what: 'What each line opens with. Every game opens on it.',
        basis: 'SOURCED',
        note: 'The mean of today\'s opening books over 40 seeds: 30.1%, 28.8% and 29.7% of the full market, '
          + 'each varying about +/-10% between seeds.',
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
        value: NEW_BUSINESS_PENALTY, unit: 'on first-year ordinary losses of new exposure',
        what: 'Exposure written this year costs this much more in its first year, on its ordinary losses.',
        basis: 'CHOSEN',
        note: 'The R model\'s 20% kept as the mechanism, uncalibrated. At zero it changes nothing.',
      }],
      ['Shock timing', {
        value: 'host in a session · catalogue in singleplayer', unit: '—',
        what: 'Multiplayer fires only what the host scheduled, consulting no probability. Singleplayer fires '
          + 'each event at its catalogue probability. Every size is drawn from a stream keyed on the event and '
          + 'its year, so the same seed gives the same shock. Nothing fires before year 1.',
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
      ['Reinsurance options', {
        value: `WC ${REINSURANCE_OPTIONS_PLANNED.WC.join(' · ')}`,
        unit: 'structures a team may buy',
        what: 'A choice of programme, replacing today\'s place-or-decline on each band.',
        basis: 'CHOSEN', notYetUsed: true,
        note: `GL is the same list as WC. Property: ${REINSURANCE_OPTIONS_PLANNED.Property.join(' · ')}.`,
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
        value: R_MODEL.regions, unit: 'share of members', basis: 'CHOSEN', notYetUsed: true,
        status: 'SUPERSEDED',
        what: 'Four regions, with a membership share each, for regional shocks.',
        note: 'The game has three — North, Central, South — already in the type system. Each line\'s split '
          + 'across them is REGION_EXPOSURE_SHARE, read from today\'s roster.',
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
        note: 'Wired as NEW_BUSINESS_PENALTY on the new book, set to 0 for now, so the mechanism exists before '
          + 'the calibration does.',
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
        basis: 'CHOSEN', status: 'ADOPTED',
        what: 'Earthquake 0.2%/1y regional · Winterstorm 6%/1y regional · Wildfire 3.5%/1y regional · '
          + 'Legislation 1.5%/3y · WC Reform 2%/3y · Recession 6%/2y · Nuclear Verdict 2.5%/1y · '
          + 'Social Inflation 4.5%/3y · Pandemic 1%/2y · Economic Inflation 10%/3y · '
          + 'Investment Loss 4%/1y · Member Withdrawal 2%/2y.',
        note: 'Probabilities are ADOPTED for SINGLEPLAYER draws only — in multiplayer the host schedules '
          + 'events and no probability is consulted. Durations and regional flags adopted throughout.',
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
