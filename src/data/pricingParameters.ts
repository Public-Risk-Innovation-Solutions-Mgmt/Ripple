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
 * RESERVE INFLATION — OPEN CLAIMS INFLATE WHILE THEY WAIT TO BE PAID. Each
 * year, BEFORE that year's payments, every open accident year's unpaid reserve
 * (its gross outstanding at the start of the year) grows by its line's
 * severity trend — WC 4%, GL 8%, Property 5% — and the growth is booked as
 * development on prior years, ON TOP OF the host's lifetime development
 * (PRIOR_DEVELOPMENT_DEFAULTS), through the same path: allocated across the
 * register, ceded under the accident year's own cover, trimmed at the GL pool
 * limit. Paid-to-date never moves; the ultimate creeps up, and later payments
 * are larger. It runs in the pre-game and every played year alike.
 *
 * ⚠ IT FILLS THE YEARLY_ADVERSE_RATE PLACEHOLDER (stable-scenarios commit 4),
 * which wrote down exactly this design — a yearly rate on each open year's
 * unpaid reserve, applied before payments, booked as prior-year development —
 * at 0% and wired to nothing. Two things differ from that note, both by the
 * reserve-inflation brief: the host's development STAYS (this sits on top of
 * it rather than replacing it), and pricing anticipates part of it
 * (RESERVE_INFLATION_PRICED_YEARS) rather than none.
 *
 * ⚠ WHY THE SEVERITY TREND: a claim reported in its accident year still
 * settles at the cost of the year it is paid in. The trend already brings each
 * accident year's cost up to its own year; this is the same inflation running
 * on after it, on what is still unpaid. Defined from SEVERITY_TREND_PER_YEAR so
 * the two cannot drift apart.
 *
 * MEASURED (scripts/probes/ri-probe.mts, twenty scenarios, ten years, the
 * default decisions, on wip/policy-year-2027 at e238cbb): scenario 1's 2027
 * accident year, valued 2027 to 2036, rises WC +12.7%, GL +15.0%, Property
 * +3.1% (against +1.9%, +7.3%, -1.0% from the host's development alone).
 * Unpriced, 2027 drops on 16 WC and 12 GL scenarios and WC's ten-year surplus
 * nearly halves; priced in full, rates charge the whole lifetime inflation up
 * front and surplus balloons.
 */
/**
 * ⚠ OFF (wip/adverse-development). Trend sets each NEW accident year's
 * expected cost only; it does not run on after it on prior years' reserves,
 * and pricing anticipates none (reserveInflationToCome is then 1). WHY: the
 * brief replaces open-claim inflation with adverse development
 * (ADVERSE_DEVELOPMENT), drawn per prior year at the line's level, which the
 * rate does not anticipate. Ratemaking still trends the experience to the
 * priced year. On restores inflation at the severity trend, priced for
 * RESERVE_INFLATION_PRICED_YEARS.
 */
export const RESERVE_INFLATION = { enabled: false };
export const RESERVE_INFLATION_PER_YEAR: PerLine<number> = RESERVE_INFLATION.enabled
  ? { ...SEVERITY_TREND_PER_YEAR } : { WC: 0, GL: 0, Property: 0 };

/**
 * HOW MUCH OF IT PRICING ANTICIPATES — WC 2 YEARS, GL 1, PROPERTY 2. The pure
 * premium includes the inflation each year's claims pick up in their first N
 * years of run-off along the line's paid pattern:
 *
 *     factor = product over j = 1..N of (1 + rate x unpaid share at year j)
 *
 *     WC (N 2) 1.0591   GL (N 1) 1.0742   Property (N 2) 1.0370
 *     (in full, N unbounded: WC 1.2112, GL 1.2323, Property 1.0449)
 *
 * A window year valued at age k picks up only the steps still to come, j = k
 * to N — what has emerged is already in its paid; a year past N picks up none.
 * Inflation after year N is LEFT TO EXPERIENCE: it reaches the rate as it
 * emerges in the window, as the host's development does.
 *
 * ⚠ WHY (scripts/probes/; twenty scenarios, ten years, the defaults). Priced in
 * full, the rate charges claims' whole lifetime inflation while reserves hold
 * only what has emerged: the ten-year combined ratio fell below 100% and
 * surplus doubled. Two years held WC's and Property's combined ratios near
 * their levels before inflation. GL's experience catches its own inflation
 * within a few years, so with no investment income credit and no contingency
 * one year is enough: at two GL ran a ten-year combined ratio of 95.4% (against
 * 100.2% before the correction), at one 98.9%, with no 2027 drop. Measured with
 * the per-line profit and contingency (since retired) and the admin overrun.
 */
export const RESERVE_INFLATION_PRICED_YEARS: PerLine<number> = { WC: 2, GL: 1, Property: 2 };

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
 * no-tail-trend-check holds the dormant factor to them.
 *
 * ⚠ OFF SINCE THE PURE-PREMIUM BASIS (stable-scenarios, after commit 8), in the
 * engine's claims and in pricing together. The pool's supplied loss costs are
 * its PURE PREMIUM at the year-1 level — ultimate costs, inflation to
 * settlement already in them — so booking inflation to reporting on top
 * counted it twice. Trend now enters once: year over year, when older years
 * are brought up to the priced year (SEVERITY_TREND_PER_YEAR).
 */
export const UP_FRONT_TREND = { enabled: false };

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
 * THE FUNDING SLIDER'S STOPS — 30% TO 90% IN FIVES, PLUS "EXPECTED" (CLF exactly
 * 1.000, the fundingAtExpected flag, which sits off the grid at the table's own
 * `expected`). Every stop is a column of the BaselineCV tables, so no stop is
 * interpolated.
 *
 * ⚠ BACK TO FIVES. The funding tables wiring (e045ba7) cut it to tens because
 * the tables it wired had columns only at 30, 40 … 90, 95 and 99. The tables
 * now carry the fives too (clf-ds-method-derive with the 5% percentiles added:
 * the same draws, so all 210 existing cells re-derived identical), and the
 * slider steps in fives again.
 */
export const FUNDING_SLIDER_RANGE = { min: 0.30, max: 0.90, step: 0.05, default: DEFAULT_FUNDING_CONFIDENCE_LEVEL };

/**
 * THE RATE INDICATION'S OTHER FUNDING LEVELS — shown beside Expected on the
 * Actuarial department's Rate Indication. Display only: each is a slider stop,
 * priced as the Decisions panel prices it.
 */
export const RATE_INDICATION_FUNDING_LEVELS = [0.70, 0.80, 0.90] as const;

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
 * member of a line's book shares in a given year (the data scientist's
 * BaselineCV).
 *
 * ⚠ ONE SETTING DRIVES TWO THINGS, SO THE TWO CAN NEVER DISAGREE. It sets
 * BOTH the engine's ordinary loss draw (the shared year factor in
 * ordinaryLossFromMembers, which replaced the single UNIT_ORDINARY_YEAR_CV of 2%
 * for every line) AND which funding table the line reads (BASELINE_CV_TABLES
 * in clfTables.ts, one per BaselineCV, from wip/clf-tables). A line whose
 * losses wobble at one CV and are funded off a table built at another would be
 * priced for a risk it does not run; baseline-cv-table-check holds the two to
 * the same value, and tableAtBaselineCv throws on a CV with no table (tables
 * exist at 2, 4, 6, 8, 10, 12 and 15%).
 *
 * ⚠ SET DELIBERATELY BY THE PROJECT LEAD: WC 6%, GL 10%, Property 8%. At the R
 * model's 2% the funding tables were too close together — every funding level
 * priced almost the same — so the higher, line-specific values make the tables
 * differ by line and give the funding slider a meaningful range.
 *
 * Over 100 equal members, with each member's luck and its yearly risk score
 * (MEMBER_LUCK_CV, MEMBER_RISK_CV), the line's ordinary loss CV is about 6.8%
 * on WC, 8.6% on Property and 10.5% on GL (typicalBookOrdinaryCv).
 */
export const BASELINE_CV: PerLine<number> = { WC: 0.06, GL: 0.10, Property: 0.08 };

/** The combined dividend / assessment control: negative is an assessment. */
export const DIVIDEND_ASSESSMENT_RANGE = { min: -0.15, max: 0.15, step: 0.01, default: 0 };

/** Pool-wide risk control intensity, as a share of each line's own premium. */
export const RISK_CONTROL_PCT_RANGE = { min: 0, max: 0.08, step: 0.01, default: 0 };

/**
 * THE RISK CONTROL SLIDER, per line per year: 0% to 5% of the rate before
 * reinsurance, in 1% steps, default 0% (wip/risk-control; see
 * RISK_CONTROL_CHARGE). 5% is the R model's top; 1% steps keep the choice a
 * handful of clear settings; 0% by default so a player who never touches it
 * plays the game as it was. SLIDER_RANGES.riskControlIncentivePct is the
 * screen's copy and must match (risk-control-check).
 */
export const RISK_CONTROL_INCENTIVE_RANGE = { min: 0, max: 0.05, step: 0.01, default: 0 };

/**
 * Per-line prior development the host screen offered — a lifetime total.
 * ⚠ RETIRED BY ADVERSE_DEVELOPMENT (wip/adverse-development): with it on the
 * engine develops nothing by these, in the pre-game or the played years; the
 * figures stay for the switch off.
 */
export const PRIOR_DEVELOPMENT_DEFAULTS: PerLine<number> = {
  WC: 0.03,
  GL: 0.10,
  Property: -0.02,
};

/**
 * ADVERSE DEVELOPMENT (wip/adverse-development) — replaces the host's
 * prior-development percentages. Each line has a LEVEL, Low, Mid or High.
 * Each PLAYED year, every open PRIOR accident year draws its own λ, uniform in
 * its line's range below, and its outstanding reserve (gross, at the start of
 * the year, before that year's payments) grows by λ: the added amount is
 * booked as prior-year development, through the route reserve inflation used
 * — allocated across the register, ceded under the year's own cover. Paid to
 * date is never restated; the ultimate rises by the amount and later payments
 * follow the payout pattern on the new ultimate. The current accident year
 * gets none in its own year; the pre-game years get none at all. Shock R
 * development runs on top, as before.
 *
 * Draws: the game seed, stream 'adverse_dev', keyed on the line, the
 * valuation year and the accident year — so every world shares them.
 *
 * PRICING DOES NOT ANTICIPATE IT: it reaches the rate only as it emerges in
 * the experience (and the shock-free shadow develops alike, so it is in that
 * experience too).
 *
 * WHY: the brief's. Development a host can set by severity, compounding on
 * what is still open — which is why a long tail (WC) feels it hardest — in
 * place of a lifetime percentage struck once.
 */
export const ADVERSE_DEVELOPMENT = { enabled: true };
export type DevelopmentLevel = 'Low' | 'Mid' | 'High';
export const DEVELOPMENT_LEVELS: readonly DevelopmentLevel[] = ['Low', 'Mid', 'High'];
/** λ's range per level, a yearly share of each open prior year's outstanding. */
export const ADVERSE_DEVELOPMENT_RANGE: Readonly<Record<DevelopmentLevel, readonly [number, number]>> = {
  Low: [0.01, 0.05], Mid: [0.05, 0.15], High: [0.15, 0.20],
};
/**
 * What a game with no level chosen plays, on every line: a hosted room's or a
 * Test player game's line with no level picked (the host's create screen also
 * opens on it), and any harness that sets none. Single player sets every line
 * Off (SOLO_ADVERSE_DEVELOPMENT) and never reads this.
 *
 * ⚠ LOW, WAS MID. At Mid (5-15% of each open prior year's outstanding a year,
 * compounding on what is still open), WC — the long tail — fails in most
 * scenarios within five years. Low (1-5%) is the default a host gets without
 * choosing; Mid and High stay one pick away for a room that wants them.
 */
export const ADVERSE_DEVELOPMENT_DEFAULT_LEVEL: DevelopmentLevel = 'Low';
/** A line's setting on a game's setup: a level, or Off — single player's on every line, and the host's None on a line. */
export type DevelopmentSetting = DevelopmentLevel | 'Off';

/**
 * SINGLE PLAYER'S ADVERSE DEVELOPMENT — OFF. Single player draws no level and
 * stores every line Off on its setup, so no older year develops; Test player
 * and a hosted room choose Low / Mid / High per line, as ADVERSE_DEVELOPMENT
 * describes.
 *
 * WHY: single player is for learning the game. Adverse development is a tool
 * for hosted and test games — a host or tester choosing how hard each line's
 * older years develop — not something a player learning the game should meet
 * unannounced. On, single player would draw each line's level from the seed,
 * Low, Mid and High equally likely (utils/soloGame).
 */
export const SOLO_ADVERSE_DEVELOPMENT = { enabled: false };

// ============================================================================
// THE NEW PRICING PARAMETERS — read by the new rate stack, except where an
// entry says it is not. Every one is CHOSEN and is a STARTING VALUE TO BE TUNED.
// (Was headed "NOT YET USED — read from commit 2 onward", which stopped being
// true when the new stack went live; corrected at stable-scenarios commit 11.)
// ============================================================================

/**
 * ALAE — allocated loss adjustment expense, 5% of claims on every line. Charged
 * in the rate on top of the loss cost (newPurePremium) and booked as a cost on
 * the ground-up loss (lossExpense.ts). The pool's supplied pure premiums
 * EXCLUDE it, so it is added on WC and GL as on Property.
 *
 * ⚠ REPLACES 8.3%, WHICH MISREAD THE POOL'S PRICING EXAMPLE, and the rule that
 * GL took none: that came from the old per-claim GL model, whose fitted claim
 * sizes included defence costs. GL's losses are the pool's pure premium now.
 */
/**
 * ALAE VARIES YEAR TO YEAR, BY LINE, as a share of claims: WC 7-15%, GL
 * 10-20%, Property 2-5% (ALAE_RATIO_RANGE).
 *
 *   THE DRAW      each line draws its ALAE ratio once per accident year,
 *                 uniformly within its range, from the GAME's seed (marketSeedOf)
 *                 on its own labelled stream (alae_ratio_<line>), so every world
 *                 uses the same draw — the variation shows in the averaged
 *                 result — a replay draws it again identically, and no other
 *                 stream moves. The pre-game's years draw it too.
 *   THE BOOKING   the year's ALAE is its claims x that year's drawn ratio: each
 *                 accident year's cohort carries its ratio, and its ALAE is
 *                 incurred, paid and reserved at it as the year develops
 *                 (lossExpense.ts).
 *   THE PRICING   the rate's ALAE load is the mean of the drawn ratios of the
 *                 accident years in its pricing window, as the ledger records
 *                 them; before any history, the middle of the line's range
 *                 (ALAE_OF_LOSS_COST below).
 *
 * ULAE stays at 5% of claims (ULAE_OF_LOSS_COST).
 *
 * WHY: a fixed 5% share made ALAE a constant of the model; a pool's defence
 * and adjusting spend moves with its claims mix and its vendors, and pricing it
 * on recent experience is how a pool would.
 */
export const ALAE_RATIO_RANGE: PerLine<{ min: number; max: number }> = {
  WC: { min: 0.07, max: 0.15 },
  GL: { min: 0.10, max: 0.20 },
  Property: { min: 0.02, max: 0.05 },
};

/**
 * THE ALAE LOAD BEFORE ANY HISTORY — the middle of each line's range
 * (ALAE_RATIO_RANGE): WC 11%, GL 15%, Property 3.5%. What a rate struck with no
 * usable accident year loads, and the ratio of a cohort carried from before
 * the draw existed. (Was 5% of claims on every line, booked and priced alike;
 * that replaced 8.3%, which misread the pool's pricing example.)
 */
export const ALAE_OF_LOSS_COST: PerLine<number> = {
  WC: (ALAE_RATIO_RANGE.WC.min + ALAE_RATIO_RANGE.WC.max) / 2,
  GL: (ALAE_RATIO_RANGE.GL.min + ALAE_RATIO_RANGE.GL.max) / 2,
  Property: (ALAE_RATIO_RANGE.Property.min + ALAE_RATIO_RANGE.Property.max) / 2,
};

/**
 * ULAE — unallocated loss adjustment expense, as a share of loss cost. Charged
 * in the rate and booked as claims-handling cost, paid as losses are paid
 * (lossExpense.ts).
 */
//
// ⚠ 5% OF CLAIMS ON EVERY LINE, REPLACING 8.3% (which misread the pool's pricing
// example). On WC and GL it is INSIDE the supplied pure premium: the engine
// draws claims at the pure premium / (1 + this), and books ULAE at this share of
// them, so claims + ULAE are the pure premium exactly
// (SUPPLIED_PURE_PREMIUM_INCLUDES_ULAE). On Property, whose cost is loss only,
// it is on top.
export const ULAE_OF_LOSS_COST: PerLine<number> = { WC: 0.05, GL: 0.05, Property: 0.05 };

/**
 * ADMIN — A SHARE OF PREMIUM, PER LINE: 20% on every line.
 *
 * THE RATE IS THE PURE PREMIUM x CLF / (1 - THIS), plus the cover's price. So
 * admin is exactly this share of the premium before reinsurance, every year and
 * on every book, and the permissible loss ratio is 1 - this (80%). What goes to
 * losses — the pure premium x CLF — is unchanged by it: admin is a pass-through
 * on top, and the cover's price is added after the divisor, never loaded by it.
 * Risk control is NOT in the divisor: the rate before reinsurance is multiplied
 * by (1 + the slider), and admin is not taken on that charge (RISK_CONTROL_CHARGE).
 *
 * ⚠ WHY A SHARE OF PREMIUM (wip/pricing-rework). It replaced a fixed amount per
 * line plus a per-exposure rate, both trended 3% a year from a 2027 base, whose
 * calibration was stale (16-39% of the supplied cost), and a profit and
 * contingency provision (WC 2%, GL and Property 0%). A pool's administration is
 * budgeted as a share of what it collects; one figure per line, the same every
 * year, is what the Rate Indication, the Decisions panel and the Model tab show.
 *
 * ⚠ PER LINE so it can be set line by line later; every line is 20% today.
 * ⚠ LIVE — read by linePricing.expenseDivisor and quoteNewRateStack; the
 * pre-game prices through the same quote, so its history, the prior board's
 * margins and the openings follow from it.
 *
 * ⚠ MEASURED AT LANDING (scripts/probes/pricing-rework-probe.mts and
 * pricing-rework-summ.py; twenty scenarios, five played years, default
 * decisions; multiplayer 8a4dae4 -> this): the 2027 rate WC $3.306 -> $3.559,
 * GL $4.665 -> $4.902, Property $0.2816 -> $0.2850; 2027 admin WC $3.67M ->
 * $6.52M, GL $4.58M -> $6.03M, Property $5.15M -> $5.48M; the pure premium
 * bit-identical in every scenario. WC's prior-board margin rises (designed
 * 2.73-5.22%, none at the floor, from -0.21-2.26%, four at the floor), because
 * the 2% contingency's surplus is gone and the margin replaces it — so WC's
 * 2027 rate is below 2026's in 8 of 20 scenarios, 3 by more than 2% (worst
 * -3.15%). GL and Property have no 2027 drop over 2%.
 */
export const ADMIN_SHARE_OF_PREMIUM: PerLine<number> = { WC: 0.20, GL: 0.20, Property: 0.20 };

/**
 * ACTUAL ADMIN RUNS OVER WHAT WAS PRICED — by a share drawn each year,
 * uniformly between 0% and 2%, per line, from the game's seed on its own
 * labelled stream (adminOverrun.ts), the same in every world. Pricing still
 * charges admin at its share of premium (ADMIN_SHARE_OF_PREMIUM); only the
 * admin booked (operatingExpense = that admin x (1 + the overrun))
 * and the year's result carry it.
 *
 * ⚠ WHY: a pool's expenses do not come in exactly at budget, and when they miss
 * they mostly miss high — salaries, systems and claims handling run ahead of the
 * plan the rate was set on. Charged at expected and booked a little above, admin
 * is a small, steady drag on the underwriting result that the rate never
 * recovers. 0% to 2% keeps it a drag and not a shock: a mean 1% of admin.
 */
export const ADMIN_OVERRUN_RANGE = { min: 0, max: 0.02 } as const;

// ⚠ PROFIT AND CONTINGENCY IS GONE (wip/pricing-rework). It was a share of the
// rate in the expense divisor — WC 2%, GL 0%, Property 0% at the end, 5% on every
// line before that. The rate now carries the pure premium x CLF, admin at its
// share of premium (ADMIN_SHARE_OF_PREMIUM) and the cover's price, and nothing
// else; the CLF's margin over Expected is the only provision for the unexpected.

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
 * behind them — 2021 to 2026, with 2026 the year in progress when the game
 * opens and 2027 the first played year. ⚠ AND THEY ARE THE POOL'S WHOLE
 * HISTORY: there are no accident years before 2021. The pre-game starts on its
 * paid-in capital with no reserves.
 *
 * ⚠ SIX SINCE THE 2027 POLICY YEAR, WITH THE ONE-YEAR DATA LAG
 * (PRICING_DATA_LAG_YEARS). Pricing's window ends two years before the year
 * priced, so the newest accident year on the books — 2026 at the opening — is
 * reserved, stated and carried in surplus but too new to price on. A sixth
 * pre-game year keeps 2027 priced on the full five (2021-2025) while 2026's
 * claims are on the books. With the lag, 2021 and 2022 price on the starting
 * expected loss (no usable history), 2023 on one year, 2024 on two, 2025 on
 * three, 2026 on four, and 2027 on the full five. (Five, 2021-2025 with a 2026
 * start and no lag, until then.)
 * (Everything older used to open as a BULK cohort — 2016-2020 on WC and GL,
 * 2019-2020 on Property — inside OPENING_RESERVE_YEARS; both are retired.)
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
export const PRIOR_HISTORY_YEARS = 6;

/**
 * THE PRE-GAME BOOK GROWS 2% A YEAR, ENDING EXACTLY AT THE OPENING BOOK.
 *
 * 2021, the first pre-game year, holds OPENING_BOOK_EXPOSURE / (1 + this)^5;
 * each later year grows to exactly the opening book x (1 + this)^(year − 2026),
 * and 2026 holds the whole opening book (bookUnderwriting.preGameBook). Each
 * year's growth is new members' exposure: it carries NEW_BUSINESS_PENALTY on
 * its ordinary losses that year, as the New members slider's does in play.
 * There is no decision in it, and no non-renewal.
 *
 * ⚠ WHY: a pool's book does not stand still for six years before the game, and
 * a growing one hands the team a history of smaller, older years, with new
 * business in each. Measured (scripts/probes/ri-growth-probe.mts, at 1%, 2%,
 * 3% against none): 2021's exposure is 0.906 of 2026's at 2%; pricing reads
 * each window year's loss cost on its own exposure with equal weights, so the
 * smaller years neither drag the rate nor count for less, and growth reaches
 * it only through the penalty on new business in the history (the 2027 rate
 * about +0.5%). Opening reserves fall up to $1.8M, paid-in capital needs about
 * $1M more on WC, and every other figure moves by a point or less.
 */
export const PRE_GAME_BOOK_GROWTH = 0.02;

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
/*
 * ⚠ REMOVED ON EVERY LINE (wip/shocks test build). GL's $25M limit is gone:
 * the pool pays every shock claim whole, on every line, and reinsurance (the
 * four T covers, REINSURANCE_OPTIONS) is the only thing above it. A T claim
 * now reaches $40M, and with a limit the GL covers above $25M would have
 * insured nothing. null is "no limit"; the machinery above stays for a limit
 * that is ruled again.
 */
export const POOL_LIMIT_PER_OCCURRENCE: PerLine<number | null> = {
  WC: null,
  GL: null,
  Property: null,
};

// ============================================================================
// THE TWENTY SCENARIOS — FIXED SEEDS (wip/fixed-seed-scenarios; first built
// as stable-scenarios commit 9).
//
// A game is set up as Scenario 1 to 20, which is all a player or host sees.
// Scenario N PLAYS ONE FIXED SEED (SCENARIO_SEEDS), with the same paid-in
// capital (STARTING_CAPITAL), a pre-game drawn at TRUE COST and a prior board
// that funds every pre-game year at Expected. Whatever opening that seed
// produces IS the scenario's opening: nothing is re-rolled, re-searched,
// re-solved, scaled, floored, guarded or set at run time.
//
// What a scenario used to be — a target premium to surplus per line that set
// the opening directly, scaled the pre-game's losses by an experience multiple,
// and solved the prior board's margin to land there, with a floor and
// guardrails — is RETIRED. The targets remain (SCENARIO_PREMIUM_TO_SURPLUS) as
// what the seeds were chosen against; the game reads them nowhere.
//
// ⚠ WHY: a scenario's opening should come from its history, not be fitted to
// it. Fitted, a thin scenario's board had to price above expected to land its
// target, and that margin came off in 2027 — WC's rate dropped in 8 scenarios,
// three by over 2%. Chosen by seed, the opening is what the drawn history
// left, the prior board priced at expected, and no 2027 rate drops.
// ============================================================================

export const SCENARIO_COUNT = 20;

/** The scenarios from THINNEST (highest premium to surplus) to RICHEST. */
export const SCENARIOS_THIN_TO_RICH: readonly number[] = [12, 19, 10, 14, 3, 8, 15, 11, 20, 6, 9, 5, 4, 1, 18, 7, 17, 2, 13, 16];

/**
 * EACH SCENARIO'S FIXED SEED — kept here, in the code, and never shown to a
 * player or a host, who see only "Scenario N". The game plays the seed's own
 * text as its identity and that text's hash as its numeric seed
 * (utils/scenarios.gameIdentity), in single player, Test player and a hosted
 * room alike. PERMANENT: chosen once, by search, and never re-picked at run
 * time; scenario-opening-drift-check reports any change that moves an opening.
 *
 * ⚠ HOW THEY WERE CHOSEN (the Measurements chat, on multiplayer 985f365). Every
 * seed 1 to 20,000 was run through the pre-game — capital WC $3.0M, GL $12.0M,
 * Property $12.5M, history at true cost, the prior board at Expected, no
 * guardrails — and each line's opening premium to surplus recorded (shocks
 * off: year-1 premium at Expected, as the room and Test player price it). Each
 * scenario takes the seed closest on ALL THREE lines at once to its design
 * targets (SCENARIO_PREMIUM_TO_SURPLUS), keeping today's thin-to-rich order;
 * no seed is used twice.
 *
 *   The openings, measured on this build (premium to surplus, shocks off;
 *   target, actual, miss):
 *
 *   scen  seed    WC                    GL                    Property
 *    12   8095   3.00 3.00  +0.2%   2.30 2.30  +0.0%   1.70 1.67  -1.8%
 *    19   9401   2.92 2.92  -0.1%   2.25 2.27  +0.8%   1.67 1.68  +0.4%
 *    10  11168   2.84 2.82  -0.8%   2.19 2.21  +0.8%   1.65 1.65  +0.3%
 *    14   1428   2.76 2.70  -2.1%   2.14 2.19  +2.3%   1.62 1.65  +1.7%
 *     3   8310   2.68 2.64  -1.6%   2.09 2.07  -0.9%   1.59 1.63  +2.1%
 *     8  12312   2.61 2.62  +0.4%   2.04 2.05  +0.8%   1.57 1.54  -1.7%
 *    15   1105   2.53 2.45  -3.0%   1.98 2.01  +1.1%   1.54 1.59  +2.9%
 *    11  16179   2.45 2.40  -1.9%   1.93 1.95  +0.9%   1.52 1.51  -0.7%
 *    20   7068   2.37 2.40  +1.5%   1.88 1.90  +1.3%   1.49 1.51  +1.2%
 *     6   4886   2.29 2.32  +1.1%   1.83 1.81  -1.0%   1.46 1.45  -0.8%
 *     9   1018   2.21 2.25  +1.9%   1.77 1.77  -0.2%   1.44 1.47  +2.2%
 *     5  11220   2.13 2.17  +1.9%   1.72 1.70  -1.3%   1.41 1.43  +1.7%
 *     4  13073   2.05 2.06  +0.3%   1.67 1.69  +1.3%   1.38 1.39  +0.5%
 *     1   4109   1.97 2.00  +1.2%   1.62 1.60  -0.9%   1.36 1.40  +3.1%
 *    18  13548   1.89 1.89  -0.0%   1.56 1.53  -1.9%   1.33 1.36  +1.9%
 *     7   9719   1.82 1.76  -2.8%   1.51 1.54  +2.2%   1.31 1.35  +3.2%
 *    17   3895   1.74 1.68  -3.1%   1.46 1.46  +0.2%   1.28 1.34  +4.4%
 *     2   1681   1.66 1.68  +1.5%   1.41 1.43  +1.8%   1.25 1.22  -2.7%
 *    13  14577   1.58 1.72  +8.8%   1.35 1.44  +6.2%   1.23 1.21  -1.1%
 *    16   2812   1.50 1.61  +7.2%   1.30 1.16 -11.0%   1.20 1.18  -1.5%
 *
 * ⚠ THE TWO RICHEST MISS, ACCEPTED. Eighteen scenarios land within 5% on every
 * line. Scenarios 13 and 16 miss their WC targets by about 9% and 7% (and GL by
 * +6% and -11%): at $3.0M WC's opening premium to surplus has its 1st
 * percentile at 1.89 across the 20,000 seeds, so a 1.5-1.6 WC opening that
 * also matches GL and Property was not drawn — no seed came within 5% on all
 * three lines for either. Raising WC's capital to about $8-9M would make every
 * slot reachable (estimated: opening surplus rises about $1.13-1.25M per $1M
 * paid in); not taken — the capital is the brief's.
 */
export const SCENARIO_SEEDS: Readonly<Record<number, number>> = {
  12: 8095, 19: 9401, 10: 11168, 14: 1428, 3: 8310, 8: 12312, 15: 1105, 11: 16179, 20: 7068, 6: 4886,
  9: 1018, 5: 11220, 4: 13073, 1: 4109, 18: 13548, 7: 9719, 17: 3895, 2: 1681, 13: 14577, 16: 2812,
};

/**
 * EACH LINE'S THINNEST AND RICHEST DESIGN TARGET, PREMIUM TO SURPLUS — the
 * openings the fixed seeds were CHOSEN against, and nothing more: no game code
 * reads them (the drift and seed gates and the parameters page do). Its twenty
 * are evenly spaced between, in the one scenario order (SCENARIOS_THIN_TO_RICH):
 * scenario 12 is the thinnest on every line and scenario 16 the richest.
 *
 *   WC        3.0 to 1.5   (centred on 2.25)
 *   GL        2.3 to 1.3   (centred on 1.8)
 *   Property  1.7 to 1.2   (centred on 1.45 — the range every line had before)
 *
 * ⚠ WHY PER LINE (reserve-inflation measurements, scripts/probes/; twenty
 * scenarios, ten years, the defaults, with reserve inflation priced for two
 * years). The game opened rich — premium to surplus 1.2 to 1.7 — and a thinner
 * start was wanted where a line can carry one:
 *   WC at 1.5-3.0 opens about $9M thinner at year 5 with no line below zero
 *     and one 2027 drop (a guardrail scenario).
 *   GL at 1.3-2.3 against 1.4-2.6: the lowest surplus at any point $6.5M
 *     (P/S 3.8) against $4.8M (P/S 5.1), no Deficient scenario-year against
 *     3, loans to GL in 0.8% of worlds against 1.4%, no 2027 drop on either.
 *   Property stays at 1.2-1.7: at 1.5-3.0, three Property scenarios went
 *     below zero and three dropped in 2027 — its 103% combined ratio from a
 *     thinner start left it exposed.
 */
export const SCENARIO_RATIO_RANGE: PerLine<{ thinnest: number; richest: number }> = {
  WC: { thinnest: 3.0, richest: 1.5 },
  GL: { thinnest: 2.3, richest: 1.3 },
  Property: { thinnest: 1.7, richest: 1.2 },
};

const lineMap = <T>(f: (l: CoverageLine) => T): PerLine<T> => ({ WC: f('WC'), GL: f('GL'), Property: f('Property') });

/**
 * Each line's DESIGN TARGET premium to surplus, by scenario number — what the
 * fixed seeds were chosen against. READ BY NO GAME CODE: the opening is the
 * seed's (SCENARIO_SEEDS), never set or solved to this.
 */
export const SCENARIO_PREMIUM_TO_SURPLUS: PerLine<Readonly<Record<number, number>>> = lineMap(l => Object.fromEntries(
  SCENARIOS_THIN_TO_RICH.map((n, k) => [n,
    SCENARIO_RATIO_RANGE[l].thinnest
      - k * (SCENARIO_RATIO_RANGE[l].thinnest - SCENARIO_RATIO_RANGE[l].richest) / (SCENARIO_COUNT - 1)]),
));

/**
 * STARTING CAPITAL — PER LINE (WC $3.0M, GL $12.0M, Property $12.5M; see the
 * note under the value), paid in, with no earned surplus, at the
 * start of the pre-game. The Annual Statement's paid-in capital is this; earned
 * surplus is everything the pre-game adds.
 *
 * ⚠ WHY $12.5M. The prior board's margin is solved to grow this into the
 * scenario's opening, and it comes off when year 1 funds at Expected — so the
 * less there is to grow, the higher the margin and the further the 2026 rate
 * falls from 2025's. Tried across the twenty scenarios by line (the history
 * beginning in 2021, profit and contingency 0); trend is WC 4%, GL 8%,
 * Property 5%:
 *
 *            solved pre-game margin (range)          2026 rate change from 2025 (range)
 *   start    WC            GL            Property    WC            GL            Property
 *   $5M      7.1 to 10.2   8.5 to 13.0   9.8 to 13.8 -4.9 to -2.6  -3.7 to -0.3  -6.2 to -3.6
 *   $10M     2.2 to 5.0    2.7 to 7.2    3.9 to 8.0  -0.8 to +1.6  +0.6 to +4.2  -2.3 to +0.8
 *   $12.5M  -0.4 to 2.5   -0.1 to 4.2    1.0 to 5.4  +1.3 to +3.8  +3.0 to +6.7  -0.3 to +3.2
 *   $15M    -2.9 to -0.1  -3.0 to 1.3   -2.0 to 2.8  +3.6 to +6.1  +5.5 to +9.3  +1.8 to +5.7
 *
 * At $12.5M the 2026 rate carries on rising from 2025's on almost every line
 * and scenario (the one exception a Property scenario at -0.3%), where at $5M
 * it fell on every one. Two scenarios' margins solve just below expected —
 * WC scenario 10 at -0.35% and GL scenario 12 at -0.12% — ACCEPTED as a
 * negligible underpricing by the prior board. $15M brings 2026 nearer trend
 * but solves most margins below expected. Making the mean change equal trend
 * would take about $14.2M / $15.4M / $16.4M (paid-in-capital-solve-report).
 *
 * $5M was chosen while imaginary accident years before the pre-game sat on
 * the books as reserves, earning investment income that a larger start
 * compounded (at $15M investment outgrew the margin). Those years are retired
 * (The pool's history begins), so that reason went with them.
 *
 * ⚠ PROPERTY $17.5M, WC AND GL $12.5M (policy-year build, with the six-year
 * simulated pre-game, the margin set on the designed history and floored at
 * zero, the one-year data lag, the investment income credit and ALAE drawn by
 * line and year). The table above predates all of those. At $12.5M Property's
 * designed margin ran 3.0% to 5.8%, and it comes off when year 1 (2027) funds
 * at Expected, so the 2027 rate dropped from 2026's in 9 of the twenty
 * scenarios. Property alone, WC and GL at $12.5M:
 *
 *   Property   margin           at the floor   opening P/S          2027 rate change    drops
 *   $12.5M     3.0% to 5.8%     0              1.00-2.15 (sc 17)    -5.4% to +4.8%       9
 *   $15M       0.3% to 3.5%     0              1.00-2.15 (sc 17)    -3.6% to +7.1%       3
 *   $17.5M     0.0% to 1.1%    18              1.00-2.14            -1.7% to +7.7%       1
 *   $20M       0.0%            20              0.90-1.74            -0.9% to +7.7%       1
 *
 * CHOSEN: $17.5M. One 2027 drop (scenario 17), against 3 at $15M and 9 at
 * $12.5M. On 18 of the twenty scenarios the designed history would price
 * below expected, so the zero floor (PRE_GAME_MARGIN_FLOOR) holds the prior
 * board at EXACTLY expected — ruled fine: a board funding at expected is an
 * ordinary history to hand over, and with no margin to come off, 2027 at
 * Expected follows 2026 at trend. Openings stay inside the guardrails
 * (1.00-2.14, none needing them). $20M drops no less and opens richer than
 * the 1.0 guardrail (0.90 at its richest). $15M (shipped briefly, f096e1a)
 * kept every designed margin above the floor at the cost of two more drops.
 */
export const STARTING_CAPITAL: PerLine<number> = { WC: 3_000_000, GL: 12_000_000, Property: 12_500_000 };
// ⚠ THE FIXED-SEED SCENARIOS (wip/fixed-seed-scenarios): WC $3.0M, GL $12.0M,
// PROPERTY $12.5M, UNCHANGED, FOR EVERY SCENARIO — the capital the seeds were
// chosen at (SCENARIO_SEEDS). There is no margin to solve any more: the prior
// board funds at Expected and the opening is where the history ends, so this
// is simply what the pool was paid in. Moving it moves every opening, and
// scenario-opening-drift-check reports it. The notes below are the history of
// how it was set while the margin was solved; they no longer drive anything.
// ⚠ WC $3.0M, GL $12.0M, PROPERTY $12.5M (reserve-inflation build: no
// investment income credit; profit and contingency WC 2%, GL 0%, Property 0%;
// inflation priced WC 2 years, GL 1, Property 2; the admin overrun; twenty
// scenarios, ten years, the defaults). The notes above predate all of these.
//
// WC and GL: the largest $0.5M step that keeps every scenario's designed
// margin above zero. WC +0.12% to +2.22% (the step above, $3.5M, takes the
// lowest to -0.29%); GL +0.20% to +4.34% ($12.5M: -0.22%). Before the
// correction they were $5.0M and $10.0M; removing the credit raised every
// pure premium, which moved the solve.
//
// Property: the rule gives $11.0M, but there the margin that comes off when
// 2027 funds at Expected drops 2027's rate in 3 scenarios. Measured:
//
//   Property   designed margin   on the floor   2027 change        drops   10-yr CR   surplus yr 5 / 10 ($M)
//   $11.0M     +2.22 to +5.22%   0              -0.9% to +3.9%      3       99.7%      28.5 / 40.7
//   $12.5M     +0.65 to +3.85%   0              +0.2% to +5.2%      0       99.7%      28.5 / 40.7
//   $14.0M     -0.91 to +2.48%   3              +1.3% to +6.5%      0       99.7%      28.6 / 40.8
//   $17.5M     (before the correction: -2.04 to +1.89%, 12 on the floor, 1 drop, 102.7%, 23.0 / 25.8)
//
// CHOSEN $12.5M: the fewest 2027 drops (none) while no margin sits on the
// floor. $14.0M drops none either but puts three scenarios (8, 19, 20) on the
// floor. Openings 1.01-1.96 at every level, inside the guardrails; the ten-year
// figures barely move, since the pre-game's margin grows each level to the same
// opening.
// ⚠ WC $5.0M AND GL $10.0M SINCE THE PER-LINE TARGETS (SCENARIO_RATIO_RANGE),
// PROPERTY STAYS $17.5M. With WC's targets at 1.5-3.0 and GL's at 1.3-2.3 the
// openings are thinner, and $12.5M grew past them with nothing to spare: the
// designed margin solved below zero and sat on the floor (PRE_GAME_MARGIN_FLOOR)
// on 41 of the 60 line-scenarios, Property's at $17.5M among them. THE RULE: the largest
// amount, in $0.5M steps, that keeps every scenario's DESIGNED margin above
// zero — small and genuine. Solved with reserve inflation, the per-line
// targets and PRE_GAME_BOOK_GROWTH in (scripts/probes/capital-solve-probe.mts,
// twenty scenarios):
//
//            capital   designed margin (range)    the step above
//   WC       $5.0M     +0.27% to +2.83%           $5.5M: -0.17% at the lowest
//   GL       $10.0M    +0.34% to +4.65%           $10.5M: -0.06% at the lowest
//
// Property is held at $17.5M by the brief, where its designed margin runs
// -2.04% to +1.89%: the scenarios below zero are charged at the floor, as
// before (18 of 20 sat there at $17.5M on the shared targets).

/**
 * THE PRE-GAME'S INVESTMENT RETURN — 3% A YEAR on its invested assets, every
 * asset class alike, no draw — READ BY THE FLAT PRE-GAME ONLY; with
 * FLAT_PRE_GAME off the pre-game draws its market (and the designed run that
 * also read this is retired with the margin solve). A
 * realistic return for a public pool's
 * bond-heavy portfolio. Most of the pre-game's growth comes from the prior
 * board's margin, not from this. The played years draw their market as before.
 */
export const PRE_GAME_INVESTMENT_RETURN = 0.03;

// ⚠ RETIRED: INVESTMENT_INCOME_CREDIT, which took last year's realised return
// off the pure premium (policy-year build). INVESTMENT INCOME DOES NOT AFFECT
// THE RATE IN ANY WAY; it flows into surplus only. (The profit and contingency
// that replaced it in the rate is retired too — see ADMIN_SHARE_OF_PREMIUM.)

/**
 * ⚠ RETIRED: PRE_GAME_FUNDING_CUSHION, the prior board's fixed 14% cushion
 * over expected (WC 1.1400, GL 1.1350, Property 1.1471 on the old 70% stops).
 * The board's funding level is now solved per scenario and line so the
 * pre-game lands exactly on the opening, and it can sit below expected.
 *
 * ⚠ WHAT A PLAYER SEES BECAUSE OF IT. A team that locks year 1 untouched funds
 * at EXPECTED, so year 1's rate on WC and GL may step UP or DOWN from the
 * declared year before it, depending on whether the scenario's solved margin
 * sat above or below expected. No player-facing text names the margin.
 */

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
 * ⚠ THE REINSURANCE RULE (corrected at stable-scenarios commit 11; it
 * described the per-claim tower priced at the CLF's 70% stop). Each line buys
 * an aggregate stop on its accident year (AGGREGATE_STOP), priced at its
 * expected recovery + AGGREGATE_STOP_SD_LOAD x the recovery's SD, over sampled
 * years of exactly the losses this engine draws — each event at the
 * catalogue's probability, ex ante (aggregateStop.ts). The rate charges that
 * price in full as reinsurance and takes NOTHING off the claims cost for the
 * expected recovery (STOP_RECOVERY_OFF_CLAIMS_COST).
 */
export const newLossEngineRuns = (): boolean => !MEMBER_LEVEL.enabled;

/**
 * MEMBER-LEVEL PLAY — OFF. Loss engine commit 3.
 *
 * Off, each line is ONE BOOK: premium is rate x exposure, losses are the new
 * engine's ordinary aggregate and its large losses, and underwriting moves
 * exposure rather than members (the two underwriting sliders, Member
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
 * THE OLD RISK CONTROL — the pool-wide spend and the programs. OFF, and it stays
 * off. Loss engine commit 3.
 *
 * Its effects lived in the old per-claim generators, which the new loss engine
 * does not run, so its spend bought nothing. Off: the pool-wide spend
 * (DecisionSet.riskControlPct, pinned at 0) and the programs charge nothing and
 * do nothing, and the Departments screen hides the programs. Their code is kept
 * intact and unwired.
 *
 * ⚠ IT NO LONGER GOVERNS THE DECISIONS PAGE'S RISK CONTROL. That is the per-line
 * slider (LineDecisionSet.riskControlIncentivePct), live since wip/risk-control
 * and described at RISK_CONTROL_CHARGE below. This switch used to hold that
 * slider disabled at 0% ("coming soon"); it is now read only for the old spend
 * and the programs.
 */
export const RISK_CONTROL = { enabled: false };

/**
 * RISK CONTROL — A SLIDER PER LINE PER YEAR (wip/risk-control), after the R model
 * (Ripple_Game_RC_CLF_100_Background_Simulations.R) except where stated.
 *
 *   DECISION  each line, each year: 0% to 5% in 1% steps, default 0%
 *             (RISK_CONTROL_INCENTIVE_RANGE; the slider is SLIDER_RANGES
 *             .riskControlIncentivePct). Single player, Test player and hosted.
 *   CHARGE    IN THE RATE: rate = (pure premium x CLF / (1 - admin share)) x
 *             (1 + slider) + reinsurance (linePricing.quoteNewRateStack). So at
 *             2% the rate is 2% higher, before reinsurance, than without it.
 *             Admin is NOT taken on the charge — it is a pass-through, like
 *             reinsurance. Its own "Risk Control" row in the rate build on the
 *             Decisions panel, the Rate Indication and the Model tab.
 *   COST      the charge, booked as Other Admin Expense (riskControlInvestment),
 *             so the charge in and the cost out match every year.
 *   EFFECT    cuts THIS program year's NORMAL losses only — never a shock's
 *             surge or large claims, routine large claims, or any older year —
 *             by a cut drawn once per year per line (RISK_CONTROL_CUT).
 *   PRICING   sees the lower losses only through experience, like any other
 *             loss: members get the saving back as lower rates later.
 *
 * ⚠ WHY THE CHARGE IS IN THE RATE (the user's change after Phase 1). Measured
 * with the cost booked but NOT charged (scratch probe, twenty scenarios, five
 * years, Low, shocks off, funding at Expected): losses + LAE saved were 1.02x the
 * cost, but the pool ended year 5 $2.4M (2%) and $5.9M (5%) lower per game in
 * single player — it paid the cost every year while experience passed the saving
 * back as rates 1.2% (2%) and 3.1% (5%) lower by year 5. Charging it in the rate
 * makes the members pay for what they get back.
 *
 * ⚠ THE PRE-GAME PLAYS AT 0%: its decisions carry no slider, so its history,
 * the openings and every scenario's record are untouched.
 */
export const RISK_CONTROL_CHARGE = { chargedOn: 'pure premium x CLF / (1 - admin share)', adminOnCharge: false } as const;

/**
 * THE CUT — WHAT A YEAR OF RISK CONTROL TAKES OFF NORMAL LOSSES.
 *
 *   cut = max(0, m x (1 + sdOfMean x z)),  z ~ N(0, 1)
 *   m   = the charge in dollars / (expected normal losses x (1 + expected ALAE
 *         ratio + ULAE share))
 *
 * ⚠ m IS SIZED SO THE EXPECTED LOSS + LAE SAVED EQUALS THE COST at every slider
 * setting: E[normal] x m x (1 + LAE) = the charge. Expected ALAE is the line's
 * ALAE_OF_LOSS_COST (0 where ALAE is already in the losses), not the year's
 * drawn ratio — the cut is sized before the year happens; the saving books at
 * the year's drawn ratio, as all LAE does.
 *
 * ⚠ z IS DRAWN ONCE PER YEAR PER LINE OFF THE GAME'S SEED (marketSeedOf, label
 * `label`_<line>), so every world and every player in a scenario shares it — the
 * luck of the year's prevention is the scenario's, not the team's. m is each
 * player's own: it follows their slider, their charge and their book.
 *
 * sdOfMean 0.5 — the R model's: the SD of the cut is half its mean, so most
 * years (about two in three) the cut is 0.5m to 1.5m and nearly all (95%) 0 to
 * 2m. Measured in Phase 1: 5th to 95th percentile 0.28m to 1.85m.
 *
 * floor 0 — a year of prevention never ADDS losses. ACCEPTED, NOT CORRECTED: the
 * floor lifts the mean cut by about 0.4% of m (E[max(0, N(1, 0.5))] = 1.0043),
 * so on average the saving runs 0.4% over the cost (the user's decision).
 */
export const RISK_CONTROL_CUT = { sdOfMean: 0.5, floor: 0, label: 'risk_control_cut' } as const;

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
 * ORDINARY LOSSES FROM 100 EQUAL MEMBERS — CHOSEN, the R model's two factors.
 * Each member's expected ordinary loss is its 1/UNDERWRITING_MEMBERS share of
 * the line's (exposure x the line's cost x underwriting's one-year bracket);
 * each year it is
 *
 *   expected x F x r x f,   F the year factor every member shares (CV
 *                           BASELINE_CV, the line's own), r the member's
 *                           risk score this year (CV MEMBER_RISK_CV, below),
 *                           f its own luck (CV MEMBER_LUCK_CV)
 *
 * and the line's ordinary loss is the sum. All three factors are LOGNORMAL
 * WITH MEAN EXACTLY 1, so the expected loss IS the mean of the draws by
 * construction. Over 100 equal members the line's CV is
 * sqrt((1 + Y^2)(1 + ((1 + 0.10^2)(1 + 0.30^2) − 1) / 100) − 1): 6.8% (WC),
 * 8.6% (Property), 10.5% (GL) — 6.1%, 8.0% and 10.0% with luck alone.
 *
 * WHY 10%: the R model's own factor, kept when units were replaced by members.
 */
export const MEMBER_LUCK_CV = 0.10;

/**
 * EACH MEMBER'S RISK SCORE — CHOSEN, by the project lead. The 100 members stay
 * equal in size, but each carries a risk score, REDRAWN EVERY YEAR: lognormal,
 * mean 1, CV 30%, multiplying that member's expected loss alongside its own
 * luck. Drawn per member per year from the GAME's seed (marketSeedOf; stream
 * `member_risk_<line>`, `pregame_` before year 1), so every world holds the
 * same scores and only the luck is each world's own. A flat pre-game year
 * draws none.
 *
 * WHY: equal members differing only by a 10% luck draw made the book's
 * ordinary losses nearly as smooth as the year factor alone; a pool's members
 * differ in how risky they are, and that spread belongs in the year's losses.
 * 30% is the R model's spread of risk, the same figure the retired book of
 * units carried (UNIT_RISK_CV). Redrawn every year by the project lead's
 * choice. Shared by every world because it is the book's risk, not the
 * world's luck.
 *
 * Not in pricing's expected loss (mean 1): the rate learns it through the
 * experience. It raises the line's ordinary CV from 6.1% / 10.0% / 8.0% to
 * 6.8% / 10.5% / 8.6% on WC / GL / Property (typicalBookOrdinaryCv).
 */
export const MEMBER_RISK_CV = 0.30;

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
 * ⚠ WHAT THE SUPPLIED LOSS COSTS ARE — THE POOL'S PURE PREMIUM, year-1 level:
 * WC $2.50 + $0.118 = $2.618 and GL $2.50 + $0.95 = $3.45 per $100. ULTIMATE
 * costs (inflation to settlement already in them, so UP_FRONT_TREND is off);
 * they INCLUDE ULAE and EXCLUDE ALAE. So the claims the engine draws are the
 * pure premium less its ULAE share — / (1 + ULAE_OF_LOSS_COST) — ULAE is
 * booked at its share of those claims, and claims + ULAE are the pure premium
 * exactly; ALAE is added on top. Property's cost is still the old engine's
 * figure, loss only, so it takes ALAE and ULAE on top.
 */
export const SUPPLIED_PURE_PREMIUM_INCLUDES_ULAE: PerLine<boolean> = { WC: true, GL: true, Property: false };

/**
 * EACH LINE'S ORDINARY CLAIMS COST PER $100, YEAR 1 — WC and GL the pool's pure
 * premium (the sum of POOL_LOSS_COST_LAYERS) less its ULAE share; Property its
 * derived attritional cost above, unchanged.
 */
export const EXPECTED_ORDINARY_LOSS_COST_PER_100: PerLine<number> = {
  WC: layerSum('WC') / (1 + ULAE_OF_LOSS_COST.WC),
  GL: layerSum('GL') / (1 + ULAE_OF_LOSS_COST.GL),
  Property: 0.159515,
};

/**
 * WHAT THE SHOCKS' LARGE LOSSES (T) ARE SCALED OFF, per $100, year 1 — CHOSEN
 * (stable-scenarios commit 2). T scales with the line's expected ordinary cost
 * against the R model's (shockLosses' tScale). On WC and GL it reads the
 * $0 – $1M layer ON THE CLAIMS BASIS — $2.50 less its ULAE share, / 1.05 =
 * $2.381 — so shocks are sized on claims like everything else: the supplied
 * layers are pure premium including ULAE. The layer is the closest match to
 * what "ordinary" meant when T was calibrated (claims to $1M, then WC $2.774
 * and GL $2.830). Property's cost is loss only and reads its ordinary cost
 * without the routine fold, as before.
 */
export const SHOCK_T_BASIS_PER_100: PerLine<number> = {
  WC: POOL_LOSS_COST_LAYERS.WC![0].per100 / (1 + ULAE_OF_LOSS_COST.WC),
  GL: POOL_LOSS_COST_LAYERS.GL![0].per100 / (1 + ULAE_OF_LOSS_COST.GL),
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
 * A FLAT PRE-GAME — OFF: THE PRE-GAME IS SIMULATED (wip/simulated-pregame, a
 * test build). On, the six pre-game years (2021-2026) run at exactly expected: each asset
 * class at PRE_GAME_INVESTMENT_RETURN, and ordinary losses at exactly expected,
 * no year or unit factor (stable-scenarios build, commit 1; the scenario's
 * multiple is retired with the fixed seeds).
 *
 * OFF, each pre-game year is DRAWN THE WAY A PLAYED YEAR IS: the line's year
 * factor and each member's own luck at their settings (BASELINE_CV,
 * MEMBER_LUCK_CV), at true cost, as a played year draws them. No shock fires in the pre-game, as before. Every draw
 * comes from the game's seed on a stream of its own (`pregame_ordinary_<line>`,
 * `pregame_ordinary_unit_<line>`, `pregame_invest`), so every team in a room
 * and any takeover inherit the identical history, and the played years' draws
 * do not shift. The prior board funds every pre-game year at Expected, and the
 * opening is where the simulated history ends (the fixed-seed scenarios).
 *
 * ⚠ WHY: a flat pre-game made the inherited history — six years of the
 * Annual Statement, and the window year 1 is priced on — read as a straight
 * line, with no year-to-year variation at all. Simulated, it reads like the
 * years the team then plays. Measured over the twenty scenarios, the pre-game
 * loss ratio's year-to-year SD rises from 1.2-2.1 points to 5.7-8.1; the
 * solved margin then ranges about -11% to +15% (below zero on 7-12 scenarios a
 * line, against 0-1 flat) and year 1's rate change from -6% to +18%.
 */
export const FLAT_PRE_GAME = { enabled: false };

/**
 * THE PRE-GAME'S MARKET — THE AVERAGE OF 10 DRAWS, ON CASH AND BONDS ONLY.
 *
 * Each simulated pre-game year's market is the average of this many markets,
 * each drawn as a played year's is, every one from the game's seed on its own
 * labelled stream (`pregame_invest_0` to `_9`), so a replay is identical. The
 * pre-game holds CASH AND BONDS ONLY: the default allocation with equities
 * removed and the rest scaled up to 100% (about 11% cash, 89% bonds —
 * investmentEngine.preGameAllocation). The played years keep the default
 * allocation, equities included, and draw one market each, as before.
 *
 * ⚠ WHY: with the prior board's margin set on the designed history, the
 * opening carries the pre-game's whole luck, and one equity-bearing market a
 * year was most of it — about $5M of a $6.4M SD in the opening. Averaging ten
 * draws on a bond-heavy book keeps a year's return realistic while leaving the
 * loss history, not the stock market, to give each scenario its character.
 */
export const PRE_GAME_MARKET_DRAWS = 10;

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
 * T — ONE ADDITIONAL LARGE CLAIM, in the program year the event fires
 * (wip/shocks test build). Where the shock map gives an event a T level on a
 * line, that line takes ONE claim, its size drawn uniformly within the
 * level's range below, in dollars as they stand — not scaled to the book, not
 * trended, not spread over several claims. It is its own occurrence; a
 * regional event's claim lands in the struck region.
 *
 * WHY: a T is the year's single large loss — a verdict, a catastrophe's worst
 * risk — and the reinsurance options (REINSURANCE_OPTIONS) are written per
 * occurrence on exactly that claim. It replaces T as an expected aggregate
 * scaled by each line's book (the old tScale) and arriving as several
 * lognormal claims (the old SHOCK_LOSS_COUNT and SHOCK_LOSS_CV). The ranges
 * are the R model's (R_MODEL.tShock) with each High raised to $40M, the top of
 * the widest cover.
 */
/**
 * LARGE (T) CLAIMS ARRIVE BY FREQUENCY, NOT WITH CATALOGUE EVENTS
 * (wip/large-claims-frequency). ON: each played year, each line draws at most
 * one large claim — Low with LARGE_CLAIM_FREQUENCY.Low, Mid with .Mid, High
 * with .High (15% a year in all), none otherwise — its size uniform across the
 * line's range for that level (SHOCK_T_CLAIM_RANGE) x the year's growth factor
 * (shockCost.shockCostFactor, as before). The draws are the game seed's, on
 * their own stream per line and year, so every world shares them, as the T
 * claims did. The catalogue events keep their surge (A) and development (R)
 * effects but no longer set large claims. Only while the game's shocks are on;
 * never in the pre-game; never in the shock-free pricing shadow — so large
 * claims stay OUT OF THE RATE ENTIRELY: no load, nothing in the experience.
 * OFF: the catalogue events set T claims, as the wip/shocks build did.
 *
 * WHY: the brief's. A large claim is something a pool should expect every few
 * years, not only when a rare event fires — at the catalogue's odds WC saw one
 * once in 144 years. Kept out of the rate on purpose: a pool without cover pays
 * them from surplus, which is what teaches the value of reinsurance. Measured
 * on twenty five-year single player games at Expected (the Phase 1 report):
 * the five-year combined ratio 1.047 -> 1.074 with no cover, 1.057 with 9 xs 1.
 */
export const LARGE_CLAIMS_BY_FREQUENCY = { enabled: true };
/**
 * Each level's chance a year of a line's one large claim — the T-shock
 * assumptions' frequencies, the same values the cover prices use
 * (T_COVER_FREQUENCY), held apart so the prices stay exactly as they are
 * whatever is done to these.
 */
export const LARGE_CLAIM_FREQUENCY: Readonly<Record<'Low' | 'Mid' | 'High', number>> = { Low: 0.075, Mid: 0.0525, High: 0.0225 };

/**
 * LARGE CLAIMS AND THEIR COVERS IN EVERY GAME — shocks on or off. ON (with
 * LARGE_CLAIMS_BY_FREQUENCY): each line draws its large claims at
 * LARGE_CLAIM_FREQUENCY in single player, Test player and hosted games alike,
 * whether or not the game's shocks are on (shockLosses.gameShocksOn) or any
 * event is scheduled; all eight covers and None are offered and priced the
 * same in every game; the Event Likelihoods show in every game; and the
 * expected losses and Property's large-claim capital carry them throughout.
 * "Shocks off" now means only that no catalogue event fires — no surge and no
 * development event.
 *
 * WHY: a large claim is a fact of the line, not a scenario's event, and the
 * covers exist to teach its cost. With large claims drawn by frequency (above)
 * nothing about them depends on the catalogue any more, so a game without
 * events should still face them and still be offered the cover.
 * OFF restores large claims and the covers (all but None) to shocks-on games
 * only (REINSURANCE_OFFERED_SHOCKS_OFF).
 */
export const LARGE_CLAIMS_EVERY_GAME = { enabled: true };

/**
 * THE ONE EVENT THAT KEEPS ITS OWN LARGE CLAIM: NUCLEAR VERDICT. With
 * LARGE_CLAIMS_BY_FREQUENCY on, no catalogue event sets a large claim — except
 * the events named here. When Nuclear Verdict fires, General Liability gets one
 * large claim at its level from the event map (High), sized as before (the
 * line's range for the level x the year's growth factor), ON TOP of the
 * regular large claims drawn at LARGE_CLAIM_FREQUENCY. It keeps its
 * development effect, its wording and its news. Every other event sets none.
 *
 * WHY: a nuclear verdict IS a single very large award — without its claim the
 * event did nothing a player could see in its year. The others' large claims
 * are what the yearly frequencies now stand in for.
 *
 * ⚠ GL'S COVER PRICES DO NOT INCLUDE THESE EXTRA CLAIMS: the covers are priced
 * on T_COVER_FREQUENCY alone (tCoverPrice), so in a year Nuclear Verdict fires
 * a cover recovers on its claim beyond what its price allowed for. The Event
 * Likelihoods (the frequencies' table) do not include it either. The expected
 * losses do, at the event's catalogue odds, while the game's shocks are on.
 */
export const EVENTS_KEEPING_LARGE_CLAIMS: readonly string[] = ['Nuclear Verdict'];
/** Does this catalogue event still set its own large claim (EVENTS_KEEPING_LARGE_CLAIMS)? */
export const eventKeepsLargeClaim = (eventName: string): boolean =>
  !LARGE_CLAIMS_BY_FREQUENCY.enabled || EVENTS_KEEPING_LARGE_CLAIMS.includes(eventName);
/** Are large claims and their covers in every game, shocks on or off? Both switches on. */
export const largeClaimsInEveryGame = (): boolean => LARGE_CLAIMS_BY_FREQUENCY.enabled && LARGE_CLAIMS_EVERY_GAME.enabled;

export const SHOCK_T_CLAIM_RANGE: PerLine<Readonly<Record<'Low' | 'Mid' | 'High', readonly [number, number]>>> = {
  GL: { Low: [1e6, 3e6], Mid: [3e6, 7e6], High: [7e6, 40e6] },
  WC: { Low: [1e6, 3e6], Mid: [3e6, 6e6], High: [6e6, 40e6] },
  Property: { Low: [2e6, 5e6], Mid: [5e6, 12e6], High: [12e6, 40e6] },
};

/**
 * A — ONE YEAR ONLY (wip/shocks test build). Where the shock map gives an
 * event an A level on a line, that program year's normal (ordinary) losses
 * are multiplied by (1 + A), A drawn uniformly within the level's range
 * (R_MODEL.aShock — the brief's ranges, unchanged), in the year the event
 * fires and no other. It no longer decays over the event's duration, and a
 * regional event's A is no longer cut to the struck region's share: the brief
 * sizes it as the line's normal losses x (1 + A).
 *
 * WHY: the A is a surge in the year it happens; carrying it on, decayed, was
 * the R model's and is replaced by the brief's. Economic Inflation (not an A
 * on the map) and R are untouched, and still run over their durations.
 */
export const SHOCK_A_YEARS = 1;

/**
 * T CLAIMS GROW WITH THE LINE'S TREND AND ITS BOOK (wip/shocks), AND COVER
 * PRICES ARE RE-WORKED ON THE GROWN CLAIMS (wip/reinsurance-layers). Each
 * year's T range is the table's (SHOCK_T_CLAIM_RANGE) x
 *
 *     (1 + SHOCK_COST_TREND[line]) ^ (years since SHOCK_COST_BASE_YEAR)
 *       x (this year's exposure / the base year's exposure)
 *
 * and each cover's price is its method's (REINSURANCE_OPTIONS,
 * T_COVER_FREQUENCY) on mean claims grown by the SAME factor — one function,
 * shockCostFactor, feeds both. The layers themselves stay fixed in dollars,
 * so a growing claim pierces them further.
 *
 * WHY: the tables are year-1 figures. A claim in year 8 that cost what it
 * cost in year 1 would shrink against a book whose losses trend at 4-8% a
 * year and whose exposure grows; and a price that stood still while the
 * claims it pays grew would get cheaper every year for the same layer.
 *
 * THE BASE YEAR IS THE GAME'S YEAR 1 — 2027 in single player, whose first
 * program year is 2027 — counted as yearNumber - 1, so a hosted room that
 * starts in another calendar year is not re-based by its start date.
 * "Exposure" is the book's exposure as quoted for the year (before the year's
 * underwriting moves it), and the base is that figure in year 1, recorded once
 * when the pre-game ends (LinePoolState.shockCostBaseExposure), so the
 * Decisions panel's price and the engine's charge are one figure.
 */
export const SHOCK_COST_BASE_YEAR = 2027;
/** The trend each line's T claims and cover prices take: its severity trend (WC 4%, GL 8%, Property 5%). */
export const SHOCK_COST_TREND: PerLine<number> = SEVERITY_TREND_PER_YEAR;
/** And the book's exposure, against year 1's. */
export const SHOCK_COST_FOLLOWS_EXPOSURE = { enabled: true };

/**
 * THE ROUTINE FOLD NET OF THE SHOCKS' UPLIFT — OFF (wip/shocks). On, the
 * routine fold (shockExpectation.routineFoldPer100) was divided by (1 + the
 * catalogue's expected A uplift), so the uplift gave it back and a line's
 * expected loss held still. WHY OFF: that division ran whatever the game's
 * shock switch said, so Property's normal losses moved with the shock
 * catalogue even in a game whose shocks are off (Y10 surplus $23.2M against
 * $22.3M when the A sizing changed). Off, the fold is the routine claims'
 * cost and the shocks land wholly on top of normal losses — no shock
 * allowance in the normal losses, as there is none in the rate.
 */
export const ROUTINE_FOLD_NET_OF_UPLIFT = { enabled: false };

/**
 * SHOCKS NEVER REACH THE PURE PREMIUM (wip/shocks) — THE RULE. No shock event
 * affects the pure premium in any way:
 *
 *   - an A surge and a T claim are not in the experience it is built from;
 *   - nor is a shock's R development on prior years (it was kept in, by
 *     design, until this build);
 *   - nor anything a shock does to how the normal losses are booked and
 *     developed — the reserve inflation and the host's development on a
 *     shock's own reserves, and forward booking contracting a year's whole
 *     gross by a ratio its T claim moved;
 *   - the Investment Loss never reaches the rate, since investment income does
 *     not enter pricing at all;
 *   - and the expectation it falls back on is the normal losses only
 *     (bookPurePremium, with SHOCKS_OUT_OF_EXPERIENCE on and no catastrophe load).
 *
 * HOW: ON, once a shock is first in force the game keeps a SHOCK-FREE SHADOW
 * (utils/worlds.ts, GameState.pricingShadow) — the same game, the same worlds,
 * decisions and loan choices, with no shock firing — and every pure premium is
 * struck from the shadow's ledger (pricingLineState). Reserve inflation and the
 * host's development stay in that experience exactly as they are, on the
 * normal losses. So a game with a shock prices EXACTLY as the same game without
 * it, year by year (shock-effects-check 7).
 *
 * WHY THE SHADOW AND NOT A DEDUCTION: the ledger's shock dollars were taken out
 * at their booked gross over the LDF (SHOCKS_OUT_OF_EXPERIENCE), which is
 * approximate — measured, a Wildfire moved Property's pure premium 0.5-0.9% and
 * a Legislation (A + R) GL's 6-12% for five years. A shock touches booking,
 * development and inflation in ways no single deduction reverses; a ledger that
 * never had the shock is the definition.
 *
 * COST: the years after a shock run their worlds twice. Off: the deduction
 * alone (R left in) — the control in shock-effects-check 7.
 */
export const SHOCK_FREE_PRICING = { enabled: true };

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
/**
 * THE EXPOSURE SCALE, PER LINE (stable-scenarios commit 8) — CHOSEN so each
 * line's YEAR-1 PREMIUM AT EXPECTED IS ABOUT $30M (the default decisions, the
 * Bad-year cover, the mean over seeds). It multiplies the whole market
 * (FULL_MARKET_EXPOSURE), so the book (OPENING_BOOK_EXPOSURE) keeps about 30%
 * of the market. Everything that scales with exposure —
 * ordinary losses, the shocks' large losses (their T scale is exposure x cost),
 * the stop's terms — scales with it; what is fixed in dollars does not: the
 * GL pool limit, the peril deductibles, the opening surplus. (Admin is a share
 * of premium since wip/pricing-rework, so it scales with the book too.)
 *
 * ⚠ RE-SCALED ONCE, from WC 1.797 / GL 1.258 / Property 0.430, after the
 * catastrophe load was removed and year-1 pricing moved onto the pool's pure
 * premium: both lowered the year-1 rate, so the same books came to about $24M.
 * ⚠ AND AGAIN, from WC 2.236 / GL 1.604 / Property 0.534, once the cover's full
 * price was charged with nothing netted off the claims cost: the year-1 rate
 * rose 0.7% / 2.1% / 2.6%, and premium with it to $30.3M / $31.0M / $31.0M.
 * ⚠ AND A THIRD TIME, from WC 2.211 / GL 1.549 / Property 0.515, once profit
 * and contingency went to 0: premium on the same books fell to $28.38M /
 * $28.44M / $28.47M.
 * ⚠ AND NO LONGER RE-SCALED WHEN PRICING CHANGES. Since the expectation
 * followed the shock switch the multipliers stay as they are; a pricing change
 * moves year-1 premium, and exposure-scale-check allows $27M to $33M on each
 * line before anyone looks. Then: WC $29.1M, GL $28.5M, Property $27.9M.
 */
export const EXPOSURE_SCALE: PerLine<number> = { WC: 2.342, GL: 1.640, Property: 0.546 };

const scaled = (base: PerLine<number>): PerLine<number> =>
  ({ WC: base.WC * EXPOSURE_SCALE.WC, GL: base.GL * EXPOSURE_SCALE.GL, Property: base.Property * EXPOSURE_SCALE.Property });

export const OPENING_BOOK_EXPOSURE: PerLine<number> = scaled({
  WC: 391.167,
  GL: 374.949,
  Property: 17609.707,
});

/**
 * THE MOST A LINE CAN WRITE, IN $M OF EXPOSURE — SOURCED: the 200-member
 * market (WC 1,300, GL 1,300, Property 59,233.002), times EXPOSURE_SCALE since
 * stable-scenarios commit 8. Intake stops at it.
 */
export const FULL_MARKET_EXPOSURE: PerLine<number> = scaled({
  WC: 1300,
  GL: 1300,
  Property: 59233.002,
});

/**
 * ============================================================================
 * UNDERWRITING — TWO SLIDERS ON A BOOK OF 100 EQUAL MEMBERS (simple
 * underwriting, a test build). Every setting underwriting reads is here;
 * bookUnderwriting.ts moves the book and ordinaryLoss.ts draws its losses.
 *
 * THE BOOK. Each line's book is UNDERWRITING_MEMBERS equal members sharing the
 * line's exposure. They exist ONLY for each member's own luck draw
 * (MEMBER_LUCK_CV), which randomises the year's ordinary losses. No risk
 * scores, no loss history, no choosing who leaves, no partial members: the
 * sliders move the line's EXPOSURE, and every member's share of it alike.
 *
 * NON-RENEWAL (NON_RENEWAL_SLIDER, a1) — exposure falls by a1 of the book at
 * the start of the year, and THIS YEAR's ordinary loss per unit of the
 * renewing exposure falls by NON_RENEWAL_LOSS_RELIEF x a1.
 *
 * NEW MEMBERS (NEW_MEMBERS_SLIDER, a2) — exposure rises by a2 of the book at
 * the start of the year, and that new exposure's ordinary losses carry
 * NEW_BUSINESS_PENALTY, flat, THIS YEAR.
 *
 *   expected ordinary loss = f(x) x E x [ (1 − a1)(1 − 0.5 a1) + a2 x 1.2 ]
 *
 * E the book at the start of the year, f(x) the trended expected loss per
 * unit. Both effects are one-year: next year the loss per unit is back to
 * f(x) unless a slider is used again. The year factor and each member's luck
 * multiply it as before.
 *
 * ⚠ THE BRACKET IS NOT IN PRICING'S EXPECTED LOSS. Pricing is unchanged: it
 * prices exposure x f(x) and learns what underwriting did only through the
 * experience, as it learned the old penalty.
 *
 * A Member Withdrawal still removes R_MODEL.memberWithdrawalReduction of what
 * renews (at its relieved cost); FULL_MARKET_EXPOSURE still caps the book.
 * Shocks hit the line directly — a T claim lands on the line by region share,
 * an A surge on the whole line's ordinary losses — never on a member.
 *
 * RETIRED HERE: the market of units (UNIT_MARKET_COUNT, UNIT_SIZE_CV,
 * UNIT_RISK_CV, UNIT_POOL_SHARE), selection on loss history
 * (LOSS_HISTORY_YEARS, LOSS_HISTORY_CLAIM_CAP, NEW_MEMBER_GRACE_YEARS), and
 * the rejection rate with everything it bought down (NEW_BUSINESS_APPLICATIONS,
 * FULL_SAVINGS_AT, RENEWALS_DECLINED_SLIDER, NEW_BUSINESS_REJECTION_SLIDER).
 * ============================================================================
 */

/**
 * Members in each line's book — CHOSEN, 100. Each holds 1/100 of the line's
 * exposure and draws its own luck; with equal shares the line's ordinary CV is
 * sqrt((1 + Y^2)(1 + MEMBER_LUCK_CV^2 / 100) − 1), Y the line's year CV. WHY
 * 100: enough that one member's luck cannot move the line, few enough to stay
 * a pool. Members never come or go — exposure does.
 */
export const UNDERWRITING_MEMBERS = 100;

/** "Non-renewal": 0–5% of the book at the start of the year, in 1% steps, default 0%. */
export const NON_RENEWAL_SLIDER = { min: 0, max: 0.05, step: 0.01, default: 0 } as const;

/** "New members": 0–5% of the book at the start of the year added, in 1% steps, default 0%. */
export const NEW_MEMBERS_SLIDER = { min: 0, max: 0.05, step: 0.01, default: 0 } as const;

/**
 * NON-RENEWAL'S LOSS RELIEF — CHOSEN, 0.5: this year's ordinary loss per unit
 * of renewing exposure falls by this x the non-renewal share (5% non-renewed
 * -> 2.5% cheaper). WHY: a pool that declines renewals sheds worse-than-average
 * business, and half the share declined is the brief's measure of how much;
 * one year only, because the book has no memory of who left.
 */
export const NON_RENEWAL_LOSS_RELIEF = 0.5;

/**
 * NEW-BUSINESS PENALTY — CHOSEN, the R model's 20%, now FLAT: the new members'
 * exposure (NEW_MEMBERS_SLIDER) costs this much more per unit than the book on
 * its ordinary losses, in its first year only. Nothing buys it down — the
 * rejection rate is gone. The pre-game's steady growth (PRE_GAME_BOOK_GROWTH)
 * carries it on each year's growth too. Not in pricing's expected loss: the
 * rate learns it only through the experience.
 */
export const NEW_BUSINESS_PENALTY = 0.20;

/*
 * ⚠ MEASURED BEFORE LANDING — WHY BOTH EFFECTS ARE ONE YEAR AND FIXED ADMIN IS
 * UNCHANGED (scripts/probes/simple-uw-report.mts; twenty scenarios, single
 * player, shocks off, both sliders held every year). Three switches were built
 * on wip/simple-underwriting to test these and removed at landing; the
 * findings stand here instead.
 *
 * HOW LONG NON-RENEWAL'S IMPROVEMENT LASTS (ten years, non-renewal 5%). One
 * year (as landed): never beats leaving the book alone on WC or GL — combined
 * ratio worse in 20 of 20 — the smaller book carries the same prior-year
 * development. Halving each year: settles 4.9% cheaper; beats leaving the book
 * alone on Property (20/20 on surplus and combined ratio) and about breaks even
 * on WC and GL. Never resetting: compounds without limit (0.776 by year 10),
 * the year-10 loss ratio 5.9 / 7.4 / 13.5 points below leaving the book alone
 * on WC / GL / Property and the rate down about 10% — too strong.
 *
 * FADING THE NEW-MEMBER PENALTY (ten years, at Expected and 70%): 20% then 10%,
 * or 20% / 13.33% / 6.67%, each year's intake on its own schedule. It moves the
 * new-members combined ratio by at most 0.0016, and the rate learns most of it
 * back. Adding members beats non-renewal on WC and GL in 20 of 20 scenarios
 * under every option and both funding levels.
 *
 * FIXED ADMIN AT 100% (as landed), 50% AND 0% (the rest moved onto the
 * per-exposure rate, year-1 admin dollars unchanged; five years, at Expected):
 * the five-year combined ratio and year-5 surplus agree to three decimals on
 * every line and setting; only the rate moves. Admin is booked as charged, so
 * its split changes the price, not the result.
 *
 * WHAT ACTUALLY FAVOURS GROWTH ON WC AND GL is PRIOR-YEAR DEVELOPMENT —
 * reserve inflation on older years, fixed in dollars against this year's book:
 * 9.9% of five years' premium on WC and 16.4% on GL, +1.1 / +1.4 points when
 * the book is non-renewed 5% a year and −0.9 / −1.3 when it adds 5%. A real
 * trade-off between the two sliders on those lines would need that cost to
 * scale with the current book, or a larger or longer first-year cost on new
 * members.
 */

/**
 * ⚠ RETIRED: OPENING_SURPLUS, $35M on every line — the interim opening the
 * twenty scenarios replace (commit 9). Each line now opens with its year-1
 * premium at Expected / the scenario's premium-to-surplus ratio
 * (SCENARIO_PREMIUM_TO_SURPLUS). Before the $35M, 2 x the line's full required
 * capital — the history follows.
 */

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

// ⚠ OPENING_RESERVE_YEARS IS RETIRED: the pool's history begins in 2021, so the
// opening holds every accident year it has (the five played) and there is no
// older window to bound. It was 10 — the played years and the bulk years before
// them, on the books from the start of the pre-game.

/**
 * How many years of prior history the new pricing reads.
 * ⚠ NOT YET USED — read from commit 2 onward.
 */
export const PRIOR_HISTORY_YEARS_NEW = 5;

/**
 * The new pricing window: 5 years, EQUAL WEIGHTS.
 * ⚠ LIVE — the new pure premium's window (newPurePremium.ts).
 */
export const PRICING_WINDOW_YEARS_NEW = 5;

/**
 * THE POOL'S DATA RUNS A YEAR BEHIND, AS IN REAL PRICING (the 2027 policy
 * year). The year being priced is never the year after the latest data, but
 * the year after that: 2027 is priced on accident years 2021-2025, 2028 on
 * 2022-2026, and so on — the five most recent COMPLETE years, ending
 * 1 + PRICING_DATA_LAG_YEARS years before the priced year.
 *
 * ⚠ AND THE WHOLE DATA SET IS A YEAR OLD, NOT ONLY THE WINDOW. The window years
 * are valued as at the end of the latest data year (2025 for 2027), as an
 * actuary pricing 2027 in mid-2026 would have them: 2025 enters at 12 months,
 * 2021 at 60, and no payment made in the year in progress is used — on the
 * newest year or the older ones. The year in progress (2026) is on the books —
 * in the reserves, the statements and surplus — but none of it prices.
 *
 * Experience is trended to the latest data year and then forward two years to
 * the priced year (WC 1.04^2), which is the same as trending each accident year
 * straight to the priced year: the trend did not change, only the window.
 *
 * WHY: pricing the next year on the year just closed is not how a pool prices.
 * Its data closes after the year ends, the indication is built from it, and the
 * rate is filed for the year after — so the newest experience a rate can see is
 * two years old, and the board has to carry a year it cannot yet price on.
 * 0 restores the old rule (priced on the year just closed, valued at its end).
 */
export const PRICING_DATA_LAG_YEARS = 1;
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
 * THE REINSURANCE A TEAM BUYS — PER OCCURRENCE, ON T CLAIMS ONLY. One option
 * per line, from None and these eight, each a layer in $M — limit xs
 * attachment — on the single T claim (SHOCK_T_CLAIM_RANGE):
 *
 *   9 xs 1    19 xs 1    29 xs 1    39 xs 1
 *   8 xs 2    18 xs 2    28 xs 2    38 xs 2      — the same eight on every line
 *
 * (wip/reinsurance-layers; the wip/shocks build offered 9 xs 1, 8 xs 2, 18 xs 2
 * and 38 xs 2.) None stays the default. THE LAYERS ARE FIXED IN DOLLARS AND
 * NEVER GROW: the T claims grow with trend and the book (shockCost), so as
 * they grow more of each large claim lands above a pool's layer — a player
 * moves up a layer or keeps that risk. That is the reason for offering the
 * tops at $10M, $20M, $30M and $40M from both attachments.
 *
 * A layer pays min(max(claim - attachment, 0), limit) on each T claim. An A
 * surge and normal losses never reach it: they are an aggregate, not claims,
 * and with ROUTINE_LARGE_LOSSES off the T claims are the only claims there are.
 * Priced each year by the pricing workbook's method on that year's claims
 * (T_COVER_FREQUENCY and the multipliers below), not by the tower's moments.
 *
 * ⚠ THE TOWER IS CUT AT EVERY OPTION'S EDGES — $1M, $2M, $10M, $20M, $30M and
 * $40M on every line (data/reinsuranceTower.ts) — so each option is exactly a
 * set of whole tower layers, checked at load (reinsuranceOptions.ts). They
 * overlap, which a set of layers allows.
 *
 * WHY: the brief replaces the aggregate stop with cover written on the event
 * that hurts a pool — one large claim — in four sizes a player can compare.
 * The aggregate covers stay dormant behind AGGREGATE_STOP.
 */
export interface ReinsuranceOption { id: string; attachment: number; limit: number }
const xs = (limitM: number, attachmentM: number): ReinsuranceOption =>
  ({ id: `$${limitM}M xs $${attachmentM}M`, attachment: attachmentM * 1e6, limit: limitM * 1e6 });
const NONE: ReinsuranceOption = { id: 'none', attachment: 0, limit: 0 };
const T_COVERS: readonly ReinsuranceOption[] = [
  NONE, xs(9, 1), xs(19, 1), xs(29, 1), xs(39, 1), xs(8, 2), xs(18, 2), xs(28, 2), xs(38, 2),
];
export const REINSURANCE_OPTIONS: PerLine<readonly ReinsuranceOption[]> = {
  WC: T_COVERS,
  GL: T_COVERS,
  Property: T_COVERS,
};

/**
 * EACH OPTION'S PRICE, RE-WORKED EVERY YEAR BY THE PRICING WORKBOOK'S METHOD ON
 * THAT YEAR'S CLAIMS (wip/reinsurance-layers; reinsuranceOptions.tCoverPrice).
 * What a team pays a year for the option on a line; None costs nothing.
 * Players see each option's name and this price only.
 *
 *   mean claim, per level = the midpoint of the line's T range
 *                           (SHOCK_T_CLAIM_RANGE) x the year's growth factor
 *   expected cost         = sum over Low / Mid / High of
 *                           T_COVER_FREQUENCY x min(max(mean claim - attachment, 0), limit)
 *   the 30M layers        (29 xs 1, 28 xs 2) = T_COVER_30M_MULTIPLIER x the 20M
 *                           layer from the same attachment (19 xs 1, 18 xs 2)
 *   the 40M layers        (39 xs 1, 38 xs 2) = T_COVER_40M_MULTIPLIER x the
 *                           UNMULTIPLIED 30M layer from the same attachment
 *   every other layer     = its expected cost
 *
 * THE GROWTH FACTOR IS THE ONE THE T CLAIMS USE (shockCost.shockCostFactor:
 * the line's trend x the book's growth since year 1, 2027), so claims and
 * prices grow together; in 2027 it is 1 and the prices start from the game's
 * own claim sizes — WC 9 xs 1 $461K, GL $488K, Property $784K. The layers do
 * not grow, so a layer's price rises more slowly than the claims once the
 * mean claim passes its top.
 *
 * WHY: the pricing workbook's method, on the game's own claims, so a price
 * follows the claims a player can see rather than a fixed table that drifts
 * from them as they grow. The multipliers load the high layers, where a mean
 * claim says least about the tail: a 30M layer costs 1.25x its 20M neighbour,
 * a 40M layer 1.2x the 30M layer's own expected cost.
 */
export const T_COVER_FREQUENCY: Readonly<Record<'Low' | 'Mid' | 'High', number>> = { Low: 0.075, Mid: 0.0525, High: 0.0225 };
export const T_COVER_30M_MULTIPLIER = 1.25;
export const T_COVER_40M_MULTIPLIER = 1.2;

/**
 * WHILE A GAME'S SHOCKS ARE OFF (shockLosses.gameShocksOn) AND
 * LARGE_CLAIMS_EVERY_GAME IS OFF: only None is offered, and held. WHY: with no
 * shocks there was no T claim, so every option would cost its price and never
 * pay. With LARGE_CLAIMS_EVERY_GAME on (as shipped) large claims come in every
 * game, so every game is offered all eight covers and None, and this list is
 * not read.
 */
export const REINSURANCE_OFFERED_SHOCKS_OFF: readonly string[] = ['none'];

/**
 * THE AGGREGATE COVER ON ATTRITIONAL LOSSES (wip/aggregate-cover;
 * utils/aggregateCover.ts). Bought per line per year BESIDE the per-claim
 * layer above, never instead of it. It covers the year's ATTRITIONAL losses —
 * normal losses (the year factor, member risk and luck, after underwriting and
 * risk control) plus the shocks' surges (A) — and nothing else: no large (T)
 * claim, no Economic Inflation uplift, no development on older years.
 *
 *   expected attritional = expected normal losses x (1 + the average surge)
 *   attachment, limit    = each option's share x expected attritional
 *   recovery             = min(max(actual attritional - attachment, 0), limit)
 *
 * PRICE, the pricing workbook's "Agg Attritional" tab: four cases a year — no
 * surge, Low, Mid, High — at the shock assumptions' odds (T_COVER_FREQUENCY,
 * 7.5% / 5.25% / 2.25%, so 85% none). Each surge is the top of its level's
 * range in R_MODEL.aShock (`surgeBasis` 'maximum'; 'midpoint' takes the
 * middle). Within a case ordinary luck is normal around the case's level, 1 +
 * surge, with SD the line's ordinary-year CV (typicalBookOrdinaryCv) x that
 * level. The average surge in the attachment is taken on the same basis, so
 * the switch moves the cases and the terms together.
 *
 *   expected recovery = Σ chance x E[min(max(X - attachment, 0), limit)]
 *                       x expected normal losses
 *   price             = expected recovery x the option's load
 *
 * Charged as reinsurance: added to the member charge as a pass-through, no
 * admin taken on it, and never netted off the pure premium. The price and the
 * terms are struck together, on the book the rate is quoted on — in a game of
 * many worlds the averaged book, one price a team-year. While the game's
 * shocks are off only None is offered, as with the per-claim covers: the
 * price assumes surges the game would then never draw.
 *
 * WHY: the pricing workbook's "Agg Attritional" tab (the source of every
 * figure here), so a team can buy cover against a bad ordinary year and a
 * surge, which the per-claim layers never reach. ⚠ THE PRICES ASSUME SURGES AT
 * THE SHOCK ASSUMPTIONS' ODDS; until the game's surges follow those odds the
 * game's recoveries will differ from the prices (aggregateCover's
 * expectedRecoveryToday measures what today's surges give).
 *
 * Expected 2027 prices at default decisions (aggregate-cover-check holds them):
 * WC $667,967 / $292,675 / $94,629; GL $675,955 / $263,022 / $74,451;
 * Property $879,680 / $434,590 / $188,692.
 */
export interface AggregateCoverOption {
  id: string;
  name: string;
  /** Attaches at this share of the year's expected attritional losses. */
  attachment: number;
  /** Pays up to this share of the year's expected attritional losses. */
  limit: number;
  /** The price is the expected recovery x this. */
  load: number;
}
export const AGGREGATE_COVER_OPTIONS: readonly AggregateCoverOption[] = [
  { id: 'none', name: 'None', attachment: 0, limit: 0, load: 0 },
  { id: 'agg-110-50', name: '110/50', attachment: 1.10, limit: 0.50, load: 1.2 },
  { id: 'agg-125-50', name: '125/50', attachment: 1.25, limit: 0.50, load: 1.0 },
  { id: 'agg-150-50', name: '150/50', attachment: 1.50, limit: 0.50, load: 1.0 },
];
/** Held by every team until it chooses; an absent choice reads as this. */
export const AGGREGATE_COVER_DEFAULT = 'none';
/** Where in its level's range each surge is priced: the top (the workbook's) or the middle. */
export const AGGREGATE_COVER_SURGE_BASIS: { basis: 'maximum' | 'midpoint' } = { basis: 'maximum' };

/**
 * THE AGGREGATE STOP, PER LINE (stable-scenarios commit 6). ON: the reinsurance
 * a team buys is a stop on each line's ACCIDENT-YEAR TOTAL — ordinary losses,
 * the shocks' uplift and their large losses together — replacing the per-claim
 * packages above, whose code stays dormant behind this switch (OFF restores
 * them).
 *
 * Each option is a share of the year's EXPECTED losses (the engine's ex-ante
 * expectation for the accident year, on the book written): the stop pays the
 * year's losses above `attachment` x expected, up to `limit` x expected more.
 * The terms are fixed when the year is written; the recovery is recalculated
 * each year as the accident year develops, and the change is booked as a
 * prior-year reinsurance adjustment.
 *
 * PRICE = the expected recovery + AGGREGATE_STOP_SD_LOAD x the SD of the
 * annual recovery, no floor — from the accident year's distribution sampled
 * once per line (aggregateStop.ts). Players see each option's name and price
 * only.
 */
// ⚠ OFF (wip/shocks test build): dormant, its code kept. The per-occurrence T
// covers (REINSURANCE_OPTIONS) replace it.
export const AGGREGATE_STOP = { enabled: false };

export interface AggregateStopOption {
  id: string;
  name: string;
  /** Attaches at this share of the year's expected losses. */
  attachment: number;
  /** Pays up to this share of the year's expected losses. */
  limit: number;
}
export const AGGREGATE_STOP_OPTIONS: readonly AggregateStopOption[] = [
  { id: 'none', name: 'None', attachment: 0, limit: 0 },
  // ⚠ NAMES ARE LABELS ONLY: the ids ('working', 'bad-year', 'catastrophe') are
  // what saves, decisions and the session contract carry, and stay as they are.
  // Renamed from Working / Bad-year / Catastrophe cover, by where each attaches.
  { id: 'working', name: 'Low attachment', attachment: 1.00, limit: 0.50 },
  { id: 'bad-year', name: 'Medium attachment', attachment: 1.15, limit: 0.50 },
  { id: 'catastrophe', name: 'High attachment', attachment: 1.30, limit: 1.00 },
];
/**
 * Held by every team until it chooses, and by the pre-game's prior board — WHILE
 * THE GAME'S SHOCKS ARE ON (shockLosses.gameShocksOn).
 */
export const AGGREGATE_STOP_DEFAULT = 'bad-year';

/**
 * WHILE A GAME'S SHOCKS ARE OFF: the options offered, and the default.
 *
 * Only None and the Working cover are offered; the Bad-year and Catastrophe
 * covers are hidden. They attach at 115% and 130% of the year's expected
 * losses, and with the shocks off a year is its ordinary losses alone — a
 * lognormal around expected at the line's Baseline CV — which almost never
 * reaches 115% and never 130%: priced on that year they cost about nothing and
 * pay nothing. The default, for players and the pre-game's prior board, is
 * None. When the game's shocks are on, all four options return and the default
 * is AGGREGATE_STOP_DEFAULT. The engine still prices any option it is handed;
 * this is what a team is offered and what it holds until it chooses.
 */
export const AGGREGATE_STOP_OFFERED_SHOCKS_OFF: readonly string[] = ['none', 'working'];
export const AGGREGATE_STOP_DEFAULT_SHOCKS_OFF = 'none';
/** The price's load on the SD of the annual recovery: price = E + this x SD. */
export const AGGREGATE_STOP_SD_LOAD = 0.5;
/**
 * Accident years sampled per line to price the stop. Drawn once, on a fixed
 * stream, in standard units, and rescaled to each book and year — so a price
 * is deterministic and costs one pass over the samples.
 */
export const AGGREGATE_STOP_SAMPLES = 50_000;

/**
 * WHAT A TEAM HOLDS UNTIL IT CHOOSES — None on every line (wip/shocks test
 * build). It is also the pre-game's prior board, which plays the default
 * decisions, so the opening is built on it.
 *
 * WHY NONE: the pre-game draws no shocks, so a cover held there would only
 * cost its price and move every scenario's opening; and a team buys T cover
 * as a choice. The brief named no default; this is a test-build choice.
 */
export const REINSURANCE_DEFAULT_OPTION: PerLine<string> = {
  WC: 'none',
  GL: 'none',
  Property: 'none',
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
 *
 * ⚠ A HUNDRED SINCE STABLE-SCENARIOS COMMIT 10, AVERAGES ONLY. A world keeps
 * only its last year's row (world 1 all of its own, for its claims); what the
 * screens read of the worlds — the surplus range, the audit's figures — is
 * struck onto the averaged row when the year settles; and the save keeps the
 * averages, the decisions and world 1's claim rows, a reload replaying the
 * years. Measured in Node: about 0.85 s a turn, three lines, against 0.1 s at
 * ten; the full state at year 10 is 48.5 MB, which is why nothing saves it.
 */
export const WORLD_COUNT = 100;

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
// THE R MODEL — THE DATA SCIENTIST'S PARAMETERS, AS RECORDED, AND WHAT THE GAME
// DID WITH EACH.
//
// ⚠ THE NEW LOSS ENGINE READS THE ONES IT KEPT (corrected at stable-scenarios
// commit 11; this header said nothing was wired). The shock catalogue — its
// events, probabilities (x SHOCK_CATALOGUE_SCALE), durations and A/T/R
// assumptions — is read by shockLosses.ts and shockExpectation.ts; the status
// column on each entry says which were ADOPTED, SCALED, ADAPTED, SUPERSEDED or
// NOT USED. It was recorded before that engine existed because the alternative
// is a build that quietly diverges from its own source and nobody able to say where.
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

/**
 * SHOCKS IN SINGLE-PLAYER — OFF, PENDING THE DATA SCIENTIST. Off, a solo game
 * draws no shock schedule (soloGame.openSoloInstance), so no event fires in
 * any world. Hosted games keep their host-set schedules. The schedule's rule,
 * stream and save handling are untouched and come back as they were when this
 * is switched on. Pricing never read the schedule, so the rate is the same
 * either way.
 *
 * ⚠ THE EXPECTATION FOLLOWS THE GAME'S SHOCKS (shockLosses.gameShocksOn). A
 * game whose shocks are off — single-player with this off, or a room whose
 * host scheduled none — reads the ORDINARY-LOSS expectation only, everywhere:
 * the Expected Losses rows and the reserve basis built on them, the expected
 * loss ratio, the aggregate stop's attachment, and each cover's price and its
 * recovery distribution. A hosted game with a schedule, and a harness on the
 * catalogue, keep the shock-inclusive expectation. With the catalogue's shocks
 * in a game where none could fire, Expected Losses read 4-6% above every
 * simulated year, and the Working cover attached that far above the real mean,
 * paid in about one world in five and recovered 8% of its price.
 *
 * ⚠ AND SO DOES PROPERTY'S CATASTROPHE CAPITAL (newEngineCatCapital): with a
 * game's shocks off, required capital carries no catastrophe charge; with
 * them on, it returns. Measured on a solo game (scenario 7): Property's year-1
 * requirement $51.5M -> $1.3M (the charge was $50.2M of it), its capital
 * status Deficient -> Strong.
 */
// ⚠ ON IN THE wip/shocks TEST BUILD, drawn by SOLO_SHOCK_DRAW below.
export const SOLO_SHOCKS = { enabled: true };

/**
 * HOW SINGLE-PLAYER DRAWS ITS EVENTS (wip/shocks test build): each year from
 * year 2, each of the twelve events fires with its catalogue probability (x
 * SHOCK_CATALOGUE_SCALE, so the twelve total SHOCKS_PER_YEAR, about 0.3 a
 * year) — independently, so a year can hold two events or none. Year 1 is
 * shock-free. Drawn ONCE at the game's start from the game seed, on the solo
 * stream, and kept on the instance, so every world fires the same events in
 * the same years.
 *
 * WHY: the brief's — a game's events at their real odds, rather than a fixed
 * count of two to four. 'catalogue' is that; 'count' restores the host
 * Randomise's rule (SHOCK_SCHEDULE_SPREAD), which hosted games keep.
 */
export const SOLO_SHOCK_DRAW: 'catalogue' | 'count' = 'catalogue';

/**
 * THE INVESTMENT LOSS EVENT, BY ASSET CLASS (wip/shocks test build): added
 * to each class's return in the year it fires — cash unaffected, bonds −5
 * points, equities −20 — so the loss depends on the pool's own asset mix.
 * Every world shares the event; each world's own market draw takes it.
 *
 * WHY: the brief's. It replaces one cut to the equity return alone
 * (R_MODEL.investmentLossAdjustment, −20 points, now superseded): a
 * cash-heavy pool rides an investment shock out; an equity-heavy one does not.
 */
export const INVESTMENT_LOSS_BY_ASSET = { cash: 0, bonds: -0.05, equities: -0.20 } as const;
export const SHOCK_CATALOGUE_SCALE = SHOCKS_PER_YEAR
  / R_MODEL.catalogue.reduce((a, [, p]) => a + (p as number), 0);

/**
 * THE SCHEDULE'S SPREAD (stable-scenarios commit 5). Randomise and the
 * singleplayer schedule draw round(SHOCKS_PER_YEAR x years) events, then −1, 0
 * or +1 of that, each equally likely, and never fewer than one: 2 to 4 in a
 * ten-year game. Year 1 stays shock-free; one event a year at most.
 */
export const SHOCK_SCHEDULE_SPREAD = 1;

/**
 * SHOCKS OUT OF THE EXPERIENCE (stable-scenarios commit 7). ON: each accident
 * year's shock dollars — the uplift on its ordinary losses and the shocks'
 * large losses, as booked — are recorded on its ledger row and taken OUT of
 * the experience pure premium's history, on the paid basis before development
 * (the share of them paid by that age). Shock R development stays in the
 * history — it is development on open years, not a shock's own dollars. With
 * CATASTROPHE_LOAD on (below), a steady load stands in their place: the
 * shocks' expected cost per $100 at the catalogue's probabilities, trended,
 * charged from the pre-game on (newPurePremium's catastropheLoadPer100).
 *
 * ⚠ WHY THE HISTORY EXCLUDES THEM: a shock in the five-year window lifted the
 * rate for five years and a quiet window under-priced the next one.
 */
export const SHOCKS_OUT_OF_EXPERIENCE = { enabled: true };

/**
 * ⚠ THE LOAD ITSELF IS OFF, SINCE IT DOUBLE-COUNTED. The pool's supplied loss
 * costs (POOL_LOSS_COST_LAYERS) already include its historical large events, so
 * charging the shocks' expected cost on top priced them twice. The rate now
 * carries no catastrophe load on any line: shocks are UNPRICED SURPRISES, like
 * the host's development — never anticipated by the rate, and kept out of the
 * experience it is struck from (SHOCKS_OUT_OF_EXPERIENCE), so a shock does not
 * lift the rate afterwards either. ON restores the steady load as commit 7
 * built it.
 */
export const CATASTROPHE_LOAD = { enabled: false };

/**
 * ⚠ THE COVER'S EXPECTED RECOVERY IS NOT TAKEN OFF THE CLAIMS COST. With the
 * shocks out of the experience (above) and out of the rate (CATASTROPHE_LOAD
 * off), the claims cost the rate is struck on is the experience claims cost
 * alone — and the aggregate stop's expected recovery comes mostly from the
 * shock years that cost never held, so subtracting it took off a recovery on
 * losses that were never charged. OFF: the rate carries the experience claims
 * cost in full and the cover's full price as reinsurance (quoteNewRateStack).
 * ON restores the netting: claims cost less the stop's expected recovery.
 */
export const STOP_RECOVERY_OFF_CLAIMS_COST = { enabled: false };
/**
 * The year the load is struck at, then trended to each year: the first in
 * which every event's duration can be in force (the catalogue's longest is 3
 * years), so the load is the steady state rather than year 1's partial one.
 */
export const CATASTROPHE_LOAD_STEADY_YEAR = Math.max(...R_MODEL.catalogue.map(([, , d]) => d as number));

const rRange = (r: readonly [number, number] | readonly number[], pct = true) =>
  pct ? `${(r[0] * 100).toFixed(0)}%-${(r[1] * 100).toFixed(0)}%`
      : `$${(r[0] / 1e6).toFixed(0)}M-$${(r[1] / 1e6).toFixed(0)}M`;

const rLevels = (l: { Low: readonly number[]; Mid: readonly number[]; High: readonly number[] }, pct = true) =>
  `Low ${rRange(l.Low, pct)} · Mid ${rRange(l.Mid, pct)} · High ${rRange(l.High, pct)}`;

// ============================================================================
// MULTIPLAYER
// ============================================================================

/**
 * HOW OFTEN A SESSION SCREEN READS THE ROOM, in milliseconds — the poller's
 * floor, which every change resets it to (src/session/client/pollSchedule.ts
 * backs off from here towards its ceiling while the room is still). One
 * setting: the host's screen, every player's and every viewer's read on it.
 * Kept at 3 seconds for now; 5_000 here moves every screen to 5 seconds.
 */
export const SESSION_POLL_INTERVAL_MS = 3_000;

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
        what: 'OFF in claims and pricing together: the pool\'s supplied loss costs are its pure premium, ultimate '
          + 'costs with inflation to settlement already in them, so trend enters once — year over year, bringing older '
          + 'years up to the priced year. ON (dormant): each accident year\'s ultimate rises with trend only by as much '
          + 'as its reported losses rise '
          + 'because of trend — inflation up to reporting, not up to final payment. Factor = the sum over development '
          + 'years k of the share newly reported in year k x (1 + trend)^(k - 1), along the closed reported pattern: '
          + 'WC 1.0787, GL 1.1599, Property 1.0126. It multiplies the layered loss costs, Property\'s basis and the '
          + 'shock sizes alike.', basis: 'CHOSEN',
        note: 'Older years do not develop for trend afterwards — the booked ultimate already carries it. Was '
          + 'computed along the paid pattern (WC 1.2440, GL 1.2478, Property 1.0460) before it was ruled that '
          + 'inflation runs only to reporting.',
      }],
      ['Reserve inflation', {
        value: RESERVE_INFLATION.enabled ? perLine(RESERVE_INFLATION_PER_YEAR, 3) : 'off',
        unit: 'per year, of each open year\'s unpaid reserve',
        what: 'OFF (wip/adverse-development): trend sets each new accident year\'s expected cost only and does not run on '
          + 'prior years\' reserves; pricing anticipates none. Adverse development (below) is what develops prior years.',
        basis: 'CHOSEN',
        note: 'On, every open year\'s unpaid reserve grew by its line\'s severity trend each year, and pricing anticipated '
          + 'the first years of it (Reserve inflation priced, then inert). Ratemaking still trends the experience to the priced year.',
      }],
      ['Reserve inflation priced', {
        value: `WC ${RESERVE_INFLATION_PRICED_YEARS.WC} · GL ${RESERVE_INFLATION_PRICED_YEARS.GL} · Property ${RESERVE_INFLATION_PRICED_YEARS.Property}`, unit: 'years of run-off',
        what: 'The pure premium includes the inflation each year\'s claims pick up in their first this-many years along '
          + 'the paid pattern: the product over those years of (1 + rate x unpaid share) — WC 1.0591 (2 years), GL 1.0742 '
          + '(1), Property 1.0370 (2). A window year valued at age k picks up only the years still to come. Later inflation '
          + 'is left to experience.', basis: 'CHOSEN',
        note: 'Priced in full (WC 1.2112, GL 1.2323, Property 1.0449) the rate charges lifetime inflation up front and '
          + 'ten-year surplus doubles; unpriced, 2027 drops on most WC and GL scenarios. Two years keeps WC and Property '
          + 'near their combined ratios before inflation; GL\'s experience catches its inflation within a few years, and '
          + 'at two years it ran 95.4% against 100.2% before the correction, at one 98.9%.',
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
        what: 'The OLD rate stack\'s administration charge — read only where the new stack has no pure premium to price '
          + 'from, which a book never reaches. The live admin is Admin share of premium.', basis: 'CHOSEN',
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
          + 'opening, the pre-game and the host\'s development all read the compressed patterns. '
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
          + 'member of the book shares.',
        basis: 'CHOSEN',
        note: 'Set deliberately by the project lead. At the R model\'s 2% the funding tables were too close together — '
          + 'every funding level priced almost the same — so the higher, line-specific values make the tables differ by '
          + 'line and give the funding slider a meaningful range. '
          + 'One setting for two things, so they can never disagree: it drives both the engine\'s ordinary '
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
        note: 'Back to fives: the funding tables wiring cut it to tens because its tables had columns only at 30, 40 … 90; '
          + 'they now carry the fives too, re-derived on the same draws (all existing cells identical). Every stop is a '
          + 'column of the BaselineCV tables, none interpolated.',
      }],
      ['Rate Indication funding levels', {
        value: RATE_INDICATION_FUNDING_LEVELS.map(l => `${Math.round(l * 100)}%`).join(', '),
        unit: 'confidence',
        what: 'The funding levels the Rate Indication shows beside Expected, each with its indicated rate and change.',
        basis: 'CHOSEN',
        note: 'Display only. Each is a slider stop, priced by the Decisions panel\'s own pricing, so the indicated '
          + 'rate plus a cover\'s price is the rate the panel charges there.',
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
      ['Pool-wide risk control range (retired)', {
        value: `${RISK_CONTROL_PCT_RANGE.min} to ${RISK_CONTROL_PCT_RANGE.max}, step ${RISK_CONTROL_PCT_RANGE.step}`,
        unit: 'share of the line\'s premium',
        what: 'Pool-wide risk control intensity.', basis: 'CHOSEN',
        note: 'The control is retired from the screen; the field is pinned at its default of 0.',
      }],
      ['Risk control range', {
        value: `${RISK_CONTROL_INCENTIVE_RANGE.min} to ${RISK_CONTROL_INCENTIVE_RANGE.max}, step ${RISK_CONTROL_INCENTIVE_RANGE.step}, `
          + `default ${RISK_CONTROL_INCENTIVE_RANGE.default}`,
        unit: 'share of the rate before reinsurance',
        what: 'The Risk Control slider, per line per year. The rate is (pure premium x CLF / (1 - admin share)) x '
          + '(1 + this) + reinsurance; the charge is booked as Other Admin Expense, so the charge in and the cost out '
          + 'match every year.',
        basis: 'CHOSEN',
        note: '5% is the R model\'s top; 1% steps keep it a handful of clear settings; 0% by default, so a player who '
          + 'never touches it plays the game as it was. Admin is not taken on the charge — a pass-through, like '
          + 'reinsurance. Charged in the rate because, booked without it (Phase 1), the pool ended year 5 $2.4M (2%) '
          + 'and $5.9M (5%) lower per game: experience passed the saving back as lower rates while the pool kept paying.',
      }],
      ['Risk control cut', {
        value: `mean m, SD ${RISK_CONTROL_CUT.sdOfMean} m, floored at ${RISK_CONTROL_CUT.floor}`,
        unit: 'share of the year\'s normal losses',
        what: 'What a year of risk control takes off THIS program year\'s normal losses — never shocks, large claims '
          + 'or older years. m = the charge / (expected normal losses x (1 + expected ALAE + ULAE)), so the expected '
          + 'losses + LAE saved equal the cost at every setting.',
        basis: 'CHOSEN',
        note: 'The R model\'s SD of half the mean. The draw is made once per year per line off the game\'s seed, so '
          + 'every world and every player shares the year\'s luck; m is each player\'s own. The floor (a year of '
          + 'prevention never adds losses) lifts the mean cut about 0.4% — accepted.',
      }],
    ],
  },
  {
    title: 'Multiplayer',
    entries: [
      ['Session poll interval', {
        value: `${SESSION_POLL_INTERVAL_MS / 1000} seconds`,
        unit: 'between reads of the room, at the fastest',
        what: 'How often the host\'s, every player\'s and every viewer\'s screen reads the room. It is the poller\'s '
          + 'floor: a change resets to it, and a still room backs off from it towards ten seconds.',
        basis: 'CHOSEN',
        note: 'One setting for every session screen. Kept at today\'s 3 seconds; set to 5 to move them all.',
      }],
      ['Room market share', {
        value: 'per line: own exposure / the room\'s exposure on the line · pool: own premium / the room\'s premium',
        unit: 'share of the room, hosted games only',
        what: 'In a hosted game a team\'s market share is its share of the room, not of the full market. Per line, '
          + 'its exposure over the total exposure of every team in the room that writes the line; for the pool, its '
          + 'premium over the room\'s, since the lines\' exposures are in different units. Before year 1 it comes '
          + 'from the opening books, so N teams each read 1/N.',
        basis: 'CHOSEN',
        note: 'Worked out once a year and stored with the room, in the submit that brings in the last result from '
          + 'the teams that locked in that year; fixed until the next set. A team that did not lock in a year counts '
          + 'as stopped: nobody waits for it and its last reported figures stay in the totals. Each player sees its '
          + 'own team\'s; the host sees every team\'s. Single player keeps the share of the full market.',
      }],
    ],
  },
  {
    title: 'Opening position',
    entries: [
      ['Prior development defaults', {
        value: perLine(PRIOR_DEVELOPMENT_DEFAULTS, 2), unit: 'share of the base outstanding, in TOTAL',
        what: ADVERSE_DEVELOPMENT.enabled
          ? 'RETIRED while adverse development is on: no accident year develops by these, in the pre-game or the game.'
          : 'Each accident year develops by this share of a base outstanding, in TOTAL over its remaining lifetime.',
        basis: 'CHOSEN',
        note: 'The host\'s prior-development percentages, replaced on the host screen by a Low / Mid / High level per line.',
      }],
      ['Adverse development', {
        value: ADVERSE_DEVELOPMENT.enabled
          ? (['Low', 'Mid', 'High'] as const).map(v => `${v} ${Math.round(ADVERSE_DEVELOPMENT_RANGE[v][0] * 100)}–${Math.round(ADVERSE_DEVELOPMENT_RANGE[v][1] * 100)}%`).join(' · ')
          : 'off',
        unit: 'λ a year, uniform in the level\'s range',
        what: 'Each played year every open PRIOR accident year draws its own λ in its line\'s level\'s range and its '
          + 'outstanding reserve grows by λ, booked as prior-year development. Paid to date is never restated; the ultimate '
          + 'rises by the amount and later payments follow the payout pattern. None on the current year in its own year, '
          + 'none in the pre-game. Pricing does not anticipate it; it reaches the rate through the experience. Shock R runs on top.',
        basis: 'CHOSEN',
        note: `Draws from the game seed ('adverse_dev' stream), shared by every world. Hosts choose a level per line; Test `
          + `player takes the host's setup; single player has none (Single player adverse development, below). `
          + `A hosted or Test player game with no level chosen, and a harness with none, reads `
          + `${ADVERSE_DEVELOPMENT_DEFAULT_LEVEL} on every line — Low since Mid failed WC in most scenarios within five years.`,
      }],
      ['Single player adverse development', {
        value: SOLO_ADVERSE_DEVELOPMENT.enabled ? 'on' : 'off', unit: 'switch',
        what: 'Off: single player draws no level and stores every line Off, so no older year develops. On: each line\'s '
          + 'level is drawn from the seed, Low / Mid / High equally likely. Test player and hosted rooms choose a level per line either way.',
        basis: 'CHOSEN',
        note: 'Single player is for learning the game; adverse development is a tool for hosted and test games.',
      }],
      ['Opening surplus bands', {
        value: 'per line, in defaultAssumptions.ts', unit: 'band on a per-line basis',
        what: 'The band each line\'s opening surplus is drawn inside.', basis: 'SOURCED',
        note: 'REGISTERED, NOT MOVED — the bands carry their own re-translation rule and a standing prohibition on re-deriving them casually.',
      }],
    ],
  },
  {
    title: 'The twenty scenarios',
    blurb: 'Each scenario plays one FIXED SEED (SCENARIO_SEEDS, never shown to players or hosts), chosen once by '
      + 'search, with the same paid-in capital, a pre-game at true cost and a prior board at Expected; whatever opening '
      + 'that seed produces is the opening. Nothing is solved, scaled, floored or guarded at run time. The design '
      + 'targets the seeds were chosen against, evenly spaced per line from thinnest to richest: '
      + (['WC', 'GL', 'Property'] as const).map(l => `${l} ${SCENARIO_RATIO_RANGE[l].thinnest} to ${SCENARIO_RATIO_RANGE[l].richest}`).join(', ')
      + '. Scenarios 13 and 16 miss their WC targets by about 9% and 7% (GL +6% and -11%), accepted.',
    entries: Array.from({ length: SCENARIO_COUNT }, (_, i) => i + 1).map(n => [`Scenario ${n}`, {
      value: `seed ${SCENARIO_SEEDS[n]}`,
      unit: 'fixed seed',
      what: `${SCENARIOS_THIN_TO_RICH.indexOf(n) + 1} of ${SCENARIO_COUNT}, thinnest first. Design target premium to surplus `
        + (['WC', 'GL', 'Property'] as const).map(l => `${l} ${SCENARIO_PREMIUM_TO_SURPLUS[l][n].toFixed(4)}`).join(' · ')
        + '; the opening is the seed\'s (see SCENARIO_SEEDS for the measured openings).',
      basis: 'CHOSEN',
    }] as const),
  },
  {
    title: 'The opening',
    blurb: 'The opening as played — no acceptance band, no pin, no search, no solve and no reset: the pre-game starts '
      + 'from its starting capital, the prior board funds every year at Expected, and the last year-end is the opening.',
    entries: [
      ['Prior history years', {
        value: PRIOR_HISTORY_YEARS, unit: 'accident years',
        what: 'How many pre-game years are simulated with real claims behind them — 2021 to 2026, with 2026 the year in '
          + 'progress when the game opens and 2027 the first played year.', basis: 'CHOSEN',
        note: 'Ten while the old ten-year experience path was live; five with the new window since commit 3; six since the '
          + '2027 policy year, so that with the one-year data lag (Pricing data lag) 2027 still prices on the full five-year '
          + 'window while 2026\'s claims are on the books.',
      }],
      ['The pool\'s history begins', {
        value: 2021, unit: 'the first accident year',
        what: 'There are no accident years before 2021, the first pre-game year. The pre-game starts on its paid-in '
          + 'capital (WC $5.0M, GL $10.0M, Property $17.5M — see Starting capital) with no reserves, and reserves build only from 2021\'s claims on. 2021 is priced on '
          + 'the starting expected loss with trend applied — no history — and so is 2022, with the one-year data lag; '
          + '2023 on one year, 2024 on two, 2025 on three, 2026 on four; from 2027 the full five-year window.',
        basis: 'CHOSEN',
        note: 'Until then the books carried imaginary accident years before the pre-game — 2016-2020 on WC and GL, '
          + '2019-2020 on Property — as bulk reserves on the books from its start, inside a window of ten accident '
          + 'years (Opening reserve years, retired), so that pricing\'s window was full from the first pre-game year. '
          + 'The opening surplus is still the scenario\'s, and the pre-game\'s margin is still solved to reach it.',
      }],
      ['Opening surplus', {
        value: 'year-1 premium at Expected / the scenario\'s premium to surplus', unit: 'surplus at the opening, each line',
        what: 'Each line opens with its year-1 premium at Expected (the default decisions, struck on the opening book) '
          + 'divided by its scenario\'s target ratio — see The twenty scenarios.', basis: 'CHOSEN',
        note: 'Was $35M on every line, interim until the scenarios. The pre-game starts from the starting capital and '
          + 'the prior board\'s margin is solved so its last year-end lands here, so the opening is set without a reset.',
      }],
    ],
  },
  {
    title: 'The new pricing parameters',
    blurb: 'Read by the new rate stack, except where an entry is marked not yet used. Every one is CHOSEN and is a '
      + 'starting value to be tuned.',
    entries: [
      ['ALAE ratio range', {
        value: `WC ${ALAE_RATIO_RANGE.WC.min * 100}-${ALAE_RATIO_RANGE.WC.max * 100}%, GL ${ALAE_RATIO_RANGE.GL.min * 100}-`
          + `${ALAE_RATIO_RANGE.GL.max * 100}%, Property ${ALAE_RATIO_RANGE.Property.min * 100}-${ALAE_RATIO_RANGE.Property.max * 100}%`,
        unit: 'share of claims',
        what: 'Allocated loss adjustment expense varies year to year. Each line draws its ALAE ratio once per accident year, '
          + 'uniformly in its range, from the game\'s seed on its own labelled stream: every world uses the same draw and a '
          + 'replay is identical; the pre-game draws it too. The year\'s ALAE is booked at its ratio — incurred, paid on the '
          + 'loss pattern and reserved as its claims develop. The rate\'s ALAE load is the mean of the drawn ratios over its '
          + 'pricing window\'s accident years.', basis: 'CHOSEN',
        note: 'Was 5% of claims on every line, booked and priced alike (which replaced 8.3%, a misreading of the pool\'s '
          + 'pricing example). The supplied pure premiums exclude ALAE, so it is added on every line.',
      }],
      ['ALAE before any history', {
        value: perLine(ALAE_OF_LOSS_COST, 3), unit: 'share of loss cost',
        what: 'The middle of each line\'s range: the ALAE load of a rate struck with no usable accident year.', basis: 'CHOSEN',
      }],
      ['ULAE', {
        value: perLine(ULAE_OF_LOSS_COST, 3), unit: 'share of loss cost',
        what: 'Unallocated loss adjustment expense — claims handling. Charged in the rate on the ground-up '
          + 'loss cost and booked as a cost: paid as losses are paid, the unpaid part held as the loss '
          + 'expense reserve.', basis: 'CHOSEN',
        note: '5% on every line, replacing 8.3%, which misread the pool\'s pricing example. On WC and GL it is inside '
          + 'the supplied pure premium (claims are the pure premium / 1.05, so claims + ULAE equal it exactly); on '
          + 'Property it is on top.',
      }],
      ['Supplied pure premium', {
        value: `WC $${layerSum('WC').toFixed(3)} · GL $${layerSum('GL').toFixed(3)}`, unit: 'per $100, year-1 level',
        what: 'The pool\'s own pure premium: WC $2.50 + $0.118, GL $2.50 + $0.95 (POOL_LOSS_COST_LAYERS). Ultimate '
          + 'costs that INCLUDE ULAE and EXCLUDE ALAE. The engine draws claims at the pure premium / (1 + ULAE), books '
          + 'ULAE at its share of them and ALAE on top.',
        basis: 'SOURCED',
        note: 'Ultimate, so no inflation to settlement is booked on top (Trend booked up front: off); trend enters once, '
          + 'year over year. Property is not supplied: its cost is the old engine\'s figure, loss only, with ALAE and '
          + 'ULAE on top.',
      }],
      ['Admin share of premium', {
        value: perLine(ADMIN_SHARE_OF_PREMIUM, 2), unit: 'share of premium before reinsurance',
        what: 'Administration, the same share every year on every book. Rate = pure premium x CLF / (1 - this) + the '
          + 'cover\'s price, so admin is exactly this share of the premium before reinsurance and the permissible loss '
          + 'ratio is 1 - this. What goes to losses is unchanged by it; the cover\'s price is not loaded by it. Booked '
          + 'admin is this admin x (1 + the year\'s overrun).',
        basis: 'CHOSEN',
        note: 'Per line so it can be set line by line; 20% on every line. Replaced (wip/pricing-rework) a fixed amount per '
          + 'line plus a per-exposure rate, both trended 3% a year from 2027, and the profit and contingency provision '
          + '(WC 2%, GL 0%, Property 0%), all removed.',
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
        what: 'The new window and its weighting. Live: the experience pure premium reads it.', basis: 'CHOSEN',
      }],
      ['Pricing data lag', {
        value: PRICING_DATA_LAG_YEARS, unit: 'year',
        what: 'The pool\'s data runs a year behind. The year priced is never the year after the latest data but the year '
          + 'after that: 2027 is priced on 2021-2025, 2028 on 2022-2026. The window years are valued as at the end of the '
          + 'latest data year (2025 for 2027, so 2025 enters at 12 months), and no payment from the year in progress is '
          + 'used. Experience is trended to the latest data year, then forward two years to the priced year (WC 1.04 squared).',
        basis: 'CHOSEN',
        note: 'As in real pricing: a pool\'s data closes after its year ends and the rate is filed for the year after, so '
          + 'the newest experience a rate sees is two years old. The year in progress is on the books — reserves, '
          + 'statements and surplus — but too new to price on. 0 restores pricing on the year just closed.',
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
      ['Pool limits', {
        value: 'none on any line', unit: 'per occurrence',
        what: 'The Pool pays every claim whole, on every line. GL\'s $25M per-claim limit is removed.',
        basis: 'CHOSEN',
        note: 'wip/shocks test build. A T claim reaches $40M; reinsurance (the T covers) is the only thing above '
          + 'the Pool\'s own retention. The limit\'s machinery stays for a limit ruled again.',
      }],
      ['Starting capital', {
        value: `WC $${STARTING_CAPITAL.WC / 1e6}M · GL $${STARTING_CAPITAL.GL / 1e6}M · Property $${STARTING_CAPITAL.Property / 1e6}M`,
        unit: 'paid in, start of the pre-game',
        what: 'Each line begins the pre-game with this paid-in capital and no earned surplus. The Annual Statement\'s '
          + 'paid-in capital is this; earned surplus is everything the pre-game adds.',
        basis: 'CHOSEN',
        note: 'The same for every scenario since the fixed seeds, which were chosen at it; with no margin to solve, it is '
          + 'simply what the pool was paid in, and moving it moves every opening. Before, while the margin was solved: '
          + 'WC $3.0M and GL $12.0M: the largest amount, in $0.5M steps, that keeps every scenario\'s designed '
          + 'margin above zero (WC +0.12% to +2.22%, GL +0.20% to +4.34%; the step above takes the lowest to -0.29% and '
          + '-0.22%). They were $5.0M and $10.0M with the investment income credit; removing it raised every pure premium. '
          + 'Property $12.5M: the rule gives $11.0M, where 2027\'s rate drops in 3 scenarios as the margin comes off at '
          + 'Expected (+2.22% to +5.22%). At $12.5M none drops and every margin is genuine (+0.65% to +3.85%); at $14.0M '
          + 'none drops but three margins sit on the floor. All three levels run a 99.7% ten-year combined ratio. '
          + 'Measured with profit and contingency WC 2%, GL 0%, Property 0%, inflation priced WC 2 years, GL 1, Property 2, '
          + 'and the admin overrun. '
          + 'Before the per-line targets — Property $17.5M, WC and GL $12.5M: at $12.5M Property\'s designed margin (3.0-5.8%) came off at Expected and '
          + 'its 2027 rate dropped in 9 of 20 scenarios; at $15M, 3; at $17.5M, 1. At $17.5M the zero floor holds the '
          + 'prior board at exactly expected on 18 scenarios, ruled fine: a board funding at expected is an ordinary '
          + 'history, and with no margin to come off 2027 follows 2026 at trend. $20M drops no less and opens richer '
          + 'than the 1.0 guardrail. '
          + 'Earlier, before the simulated pre-game: the prior board\'s margin is solved to grow this into the opening and comes off when year 1 funds at '
          + 'Expected, so a smaller start means a higher margin and a 2026 rate that falls from 2025\'s. Tried at $5M, $10M, '
          + '$12.5M and $15M across the twenty scenarios by line. At $12.5M 2026\'s rate carries on rising from 2025\'s on '
          + 'almost every line and scenario (WC +1.3 to +3.8%, GL +3.0 to +6.7%, Property -0.3 to +3.2%; at $5M it fell on '
          + 'all). Two margins solve just below expected — WC scenario 10 at -0.35%, GL scenario 12 at -0.12% — accepted '
          + 'as a negligible underpricing by the prior board. $15M solves most margins below expected. $5M was set while '
          + 'imaginary pre-2021 reserves earned investment income; those years are retired.',
      }],
      ['Prior board\'s margin', {
        value: 0, unit: 'over expected (CLF 1 + this)',
        what: 'The prior board funds every pre-game year at Expected, on every scenario and line. Nothing solves it.',
        basis: 'CHOSEN',
        note: 'It was solved per scenario and line to land the opening on a target, floored at zero and moved by '
          + 'guardrails; retired with the fixed seeds. With no margin to come off, 2027 at Expected follows 2026.',
      }],
      ['Pre-game investment return', {
        value: PRE_GAME_INVESTMENT_RETURN, unit: 'a year, on invested assets',
        what: 'What the pre-game\'s invested assets earn each year, every asset class alike, no draw — read by the '
          + 'flat pre-game only.',
        basis: 'CHOSEN',
        note: 'A realistic return for a public pool\'s bond-heavy portfolio; most of the pre-game\'s growth comes '
          + 'from the prior board\'s margin. With the flat pre-game off (as now), the pre-game as played draws its '
          + 'market as a played year does.',
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
          + `Property ${(100 * BASELINE_CV.Property).toFixed(0)}%) · member risk ${(100 * MEMBER_RISK_CV).toFixed(0)}% · `
          + `member luck ${(100 * MEMBER_LUCK_CV).toFixed(0)}%`,
        unit: 'CV, each a mean-1 lognormal',
        what: 'Each of the 100 equal members\' ordinary loss is its 1/100 share of the line\'s expected loss times a '
          + 'year factor every member shares, its risk score this year and its own luck; the line\'s ordinary loss is '
          + 'the sum.',
        basis: 'CHOSEN',
        note: 'The R model\'s two factors. The year factor\'s CV is the line\'s Baseline CV since the funding '
          + 'tables wiring (it was 2% on every line); over 100 equal members with risk and luck the line\'s CV is '
          + '6.8% (WC), 8.6% (Property) and 10.5% (GL) — 6.1%, 8.0% and 10.0% with luck alone.',
      }],
      ['Pool loss costs', {
        value: 'WC $2.50 + $0.118 · GL $2.50 + $0.95', unit: 'per $100 of payroll, year 1: $0–$1M + $1M–$5M',
        what: 'The pool\'s own loss costs by per-claim layer, no deductible. Each line\'s ordinary expected loss is '
          + 'the sum of its layers; losses above $5M per claim stay with the pool and arrive only with shocks.',
        basis: 'SOURCED',
        note: 'The pool\'s loss costs, supplied by the pool: its PURE PREMIUM, including ULAE and excluding ALAE (see '
          + 'Supplied pure premium). GL keeps its $25M per-claim limit. Replaced the old engine\'s derived ordinary '
          + 'cost (WC $2.774, GL $2.830 to $1M, plus the routine claims above it).',
      }],
      ['Expected ordinary loss cost', {
        value: perLine(EXPECTED_ORDINARY_LOSS_COST_PER_100), unit: 'per $100 of exposure, year 1',
        what: 'Each line\'s expected ordinary CLAIMS per $100: WC and GL the pool\'s pure premium (the sum of its '
          + 'layers) less its ULAE share, / 1.05; Property its derived attritional cost, plus the routine fold.',
        basis: 'SOURCED',
        note: 'Property\'s figure was derived by scripts/tools/derive-ordinary-loss-cost.ts from today\'s '
          + 'distributions on the full market at neutral risk quality, year 1, its catastrophe band excluded; it '
          + 'stays until Property\'s loss costs are supplied.',
      }],
      ['Shock scale basis', {
        value: perLine(SHOCK_T_BASIS_PER_100), unit: 'per $100, year 1',
        what: 'The ordinary cost the shocks\' large losses (T) are scaled off.',
        basis: 'CHOSEN',
        note: 'WC and GL read the $0–$1M layer on the claims basis — $2.50 less its ULAE share, / 1.05 = $2.381 — so '
          + 'shocks are sized on claims like everything else (was $2.50, the pure premium including ULAE). The layer '
          + 'is the closest match to what "ordinary" meant when T was calibrated (WC $2.774, GL $2.830). Property '
          + 'reads its cost without the routine fold.',
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
      ['Pre-game market draws', {
        value: PRE_GAME_MARKET_DRAWS, unit: 'draws averaged, each pre-game year',
        what: 'Each simulated pre-game year\'s market is the average of this many markets drawn as a played year\'s, '
          + 'each on its own stream from the game\'s seed, on a cash-and-bond portfolio: the default allocation '
          + 'without equities, scaled to 100% (about 11% cash, 89% bonds). The played years keep the default '
          + 'allocation and draw one market each.',
        basis: 'CHOSEN',
        note: 'One equity-bearing market a year drove most of the opening\'s scatter once the margin was set on the '
          + 'designed history; the loss history, not the stock market, is meant to give each scenario its character.',
      }],
      ['Flat pre-game', {
        value: FLAT_PRE_GAME.enabled ? 'on' : 'off', unit: 'switch',
        what: 'On: the six pre-game years at expected — the pre-game return, and ordinary losses at exactly the '
          + 'scenario\'s multiple of expected. Off: each pre-game year drawn as a played year is — the year factor, '
          + 'each unit\'s own factor and the market — on the scenario\'s multiple, from the game\'s seed on '
          + 'streams of its own. No shocks fire in the pre-game either way.',
        basis: 'CHOSEN',
        note: 'Off (test build) so the inherited history varies like the played years: flat, the pre-game loss '
          + 'ratio moved 1.2-2.1 points a year; simulated, 5.7-8.1. Every team in a room, and any takeover, gets '
          + 'the same history, and the played years\' draws do not shift. The prior board\'s margin is still solved '
          + 'to the opening; it now falls below zero on 7-12 of the twenty scenarios a line.',
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
          + 'event strikes one region, drawn by this share; its T claim lands there. Its A now reaches the whole '
          + 'line (wip/shocks).',
        basis: 'CHOSEN',
        note: 'The R model\'s four regions, adopted with book units; they replace three read from today\'s '
          + 'roster (35.2 / 34.4 / 30.4%). Drawn by share, the expected share an event reaches is 0.255 '
          + 'against 0.334 before, so a regional event\'s expected A falls about 23.5%. A regional T is NOT '
          + 'cut to the share: it lands whole in the struck region. The region is the same on every line the '
          + 'event reaches.',
      }],
      ['T claim sizes', {
        value: (['GL', 'WC', 'Property'] as const).map(l => `${l} ${(['Low', 'Mid', 'High'] as const)
          .map(v => `${v} $${SHOCK_T_CLAIM_RANGE[l][v][0] / 1e6}–${SHOCK_T_CLAIM_RANGE[l][v][1] / 1e6}M`).join(', ')}`).join(' · '),
        unit: 'one claim, uniform within the range',
        what: 'Where an event has a T on a line, that program year takes ONE additional claim of this size — '
          + 'unscaled, untrended, its own occurrence. A regional event\'s claim lands in the struck region.',
        basis: 'CHOSEN',
        note: 'wip/shocks test build. Replaces T as an expected aggregate scaled to each line\'s book and spread '
          + 'over several lognormal claims. The R model\'s ranges with each High raised to $40M.',
      }],
      ['A, one year only', {
        value: SHOCK_A_YEARS, unit: 'program years',
        what: 'An event\'s A multiplies that program year\'s normal losses by (1 + A), A uniform within the level\'s '
          + 'range, in the year it fires only — undecayed and on the whole line, not cut to a region\'s share.',
        basis: 'CHOSEN', note: 'wip/shocks test build. Economic Inflation and R still run over their durations.',
      }],
      ['Shock draws shared by every world', {
        value: 'the game seed', unit: 'rule',
        what: 'Every shock draw — which events fire, each A, T and R size, and where a T claim lands — is keyed on '
          + 'the game seed, so every world shares the same events and the same draws. Each world keeps its own '
          + 'ordinary year and market.',
        basis: 'CHOSEN', note: 'wip/shocks test build. Sizes were drawn per world.',
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
      ['Old risk control (pool-wide spend and programs)', {
        value: RISK_CONTROL.enabled ? 'on' : 'off', unit: 'switch',
        what: 'Off: the pool-wide spend and the programs charge nothing and do nothing; the Departments screen hides '
          + 'the programs. It no longer governs the Decisions page\'s Risk Control slider, which is live (Risk control '
          + 'range, Risk control cut).',
        basis: 'CHOSEN',
        note: 'Their effects lived in the old per-claim generators, which the new loss engine does not run. The '
          + 'code is kept, unwired.',
      }],
      ['Opening book', {
        value: perLine(OPENING_BOOK_EXPOSURE, 3), unit: '$M of exposure, base year',
        what: 'What each line opens with — every game alike — and where the pre-game\'s growth ends.',
        basis: 'SOURCED',
        note: 'The mean of today\'s opening books over 40 seeds: 30.1%, 28.8% and 29.7% of the full market. '
          + 'In use again since simple underwriting retired the book of units (which opened on its units\' sizes '
          + 'summed, different in every game).',
      }],
      ['Exposure scale', {
        value: perLine(EXPOSURE_SCALE, 3), unit: 'x the 200-member market',
        what: 'Chosen so each line\'s year-1 premium at Expected is about $30M (default decisions, Bad-year cover, '
          + 'the mean over seeds). It multiplies the whole market, so the book keeps about 30% of it.',
        basis: 'CHOSEN',
        note: 'Scales everything tied to exposure — ordinary losses, the shocks\' large losses, the stop\'s terms — '
          + 'and nothing fixed in dollars: the GL pool limit, the peril deductibles, the opening surplus. '
          + 'Last re-set from WC 2.211 / GL 1.549 / Property 0.515 when profit and contingency went to 0. NO LONGER '
          + 'RE-SCALED WHEN PRICING CHANGES: the multipliers are pinned, and year-1 premium at Expected may sit '
          + 'anywhere from $27M to $33M on each line (WC $29.1M, GL $28.5M, Property $27.9M once the covers were '
          + 'priced on the ordinary year in single-player).',
      }],
      ['Full-market exposure', {
        value: perLine(FULL_MARKET_EXPOSURE, 3), unit: '$M of exposure, base year',
        what: 'The most a line can write — the cap on the book. New business stops at it.',
        basis: 'SOURCED',
        note: 'The 200-member market (WC 1,300, GL 1,300, Property 59,233.002) x the exposure scale.',
      }],
      ['Member risk score', {
        value: MEMBER_RISK_CV, unit: 'CV of a lognormal, mean 1, redrawn every year',
        what: 'Each of the 100 equal members carries a risk score, redrawn every year, that multiplies its expected '
          + 'loss alongside its own luck. From the game seed, per member and year, the same in every world.',
        basis: 'CHOSEN',
        note: 'The R model\'s 30% spread of risk, redrawn every year by the project lead\'s choice. It raises the '
          + 'line\'s ordinary loss CV '
          + 'from 6.1% / 10.0% / 8.0% to 6.8% / 10.5% / 8.6% on WC / GL / Property. Not in pricing\'s expected loss.',
      }],
      ['Underwriting members', {
        value: UNDERWRITING_MEMBERS, unit: 'equal members a line',
        what: 'Each line\'s book is this many equal members sharing its exposure. They exist only for each member\'s '
          + 'own luck draw on the year\'s ordinary losses: no risk scores, no loss history, no choosing who leaves.',
        basis: 'CHOSEN',
        note: 'Replaces the market of about 200 unequal units and selection on loss history (simple underwriting).',
      }],
      ['Non-renewal — slider', {
        value: `${(100 * NON_RENEWAL_SLIDER.min).toFixed(0)}–${(100 * NON_RENEWAL_SLIDER.max).toFixed(0)}%, `
          + `${(100 * NON_RENEWAL_SLIDER.step).toFixed(0)}% steps, default ${(100 * NON_RENEWAL_SLIDER.default).toFixed(0)}%`,
        unit: 'of the book at the start of the year',
        what: 'Exposure falls by this share, and this year\'s ordinary loss per unit of exposure falls by the loss '
          + 'relief x the share. One year only.',
        basis: 'CHOSEN',
        note: 'Replaces "Renewals declined", which ranked units on loss history.',
      }],
      ['Non-renewal loss relief', {
        value: NON_RENEWAL_LOSS_RELIEF, unit: 'x the non-renewal share, off this year\'s loss per unit',
        what: 'How much cheaper the renewing book runs this year for what was declined: 5% non-renewed, 2.5% cheaper.',
        basis: 'CHOSEN', note: 'The brief\'s 0.5. Not in pricing\'s expected loss.',
      }],
      ['New members — slider', {
        value: `${(100 * NEW_MEMBERS_SLIDER.min).toFixed(0)}–${(100 * NEW_MEMBERS_SLIDER.max).toFixed(0)}%, `
          + `${(100 * NEW_MEMBERS_SLIDER.step).toFixed(0)}% steps, default ${(100 * NEW_MEMBERS_SLIDER.default).toFixed(0)}%`,
        unit: 'of the book at the start of the year',
        what: 'Exposure rises by this share, and that new exposure\'s ordinary losses carry the new-business '
          + 'penalty this year.',
        basis: 'CHOSEN',
        note: 'Replaces "New Business, rejection rate" and the applications it was a share of.',
      }],
      ['New-business penalty', {
        value: NEW_BUSINESS_PENALTY, unit: 'on the new exposure\'s first-year actual ordinary losses, flat',
        what: 'What new members\' exposure costs over the book per unit, in its first year only — and on the '
          + 'pre-game\'s 2% growth each year. It is not in expected loss: the rate learns it through the experience.',
        basis: 'CHOSEN',
        note: 'The R model\'s 20%. Flat since simple underwriting: there is no rejection rate to buy it down.',
      }],
      ['Large claims (T)', {
        value: LARGE_CLAIMS_BY_FREQUENCY.enabled
          ? `by frequency: Low ${LARGE_CLAIM_FREQUENCY.Low * 100}% · Mid ${LARGE_CLAIM_FREQUENCY.Mid * 100}% · High ${LARGE_CLAIM_FREQUENCY.High * 100}% a year`
          : 'with the catalogue\'s events',
        unit: 'at most one per line a year',
        what: 'Each played year each line draws at most one large claim — its level by these chances, its size uniform '
          + 'across the line\'s range for the level x the year\'s growth factor. The catalogue events keep their surge and '
          + 'development but no longer set large claims — all but Nuclear Verdict (EVENTS_KEEPING_LARGE_CLAIMS). In every game, shocks on or off (LARGE_CLAIMS_EVERY_GAME); never in the pre-game.',
        basis: 'CHOSEN',
        note: 'The T-shock assumptions\' frequencies, the same values the cover prices use (held apart, so the prices stay '
          + 'as they are). Kept out of the rate entirely — a pool without cover pays them from surplus, which teaches the '
          + 'value of reinsurance.',
      }],
      ['Reinsurance options (T covers)', {
        value: REINSURANCE_OPTIONS.GL.filter(o => o.limit > 0).map(o => o.id).join(' · '),
        unit: 'per occurrence, on T claims only, every line',
        what: 'What a team buys on each line: None, or one layer on the single T claim — pays min(max(claim − '
          + 'attachment, 0), limit). An A surge and normal losses never reach it. Players see each option\'s name '
          + 'and price only.',
        basis: 'CHOSEN',
        note: 'The layers are fixed in dollars and never grow: as the T claims grow, more of each lands above a '
          + 'pool\'s layer, so a player moves up a layer or keeps that risk. The tower is cut at $1M, $2M, $10M, $20M, '
          + '$30M and $40M on every line, so each option is whole layers. Replaces the aggregate stop, which stays '
          + 'dormant behind its switch.',
      }],
      ['Reinsurance prices', {
        value: `frequencies Low ${T_COVER_FREQUENCY.Low * 100}% · Mid ${T_COVER_FREQUENCY.Mid * 100}% · High `
          + `${T_COVER_FREQUENCY.High * 100}% a year; 30M layers x${T_COVER_30M_MULTIPLIER} the 20M; 40M layers `
          + `x${T_COVER_40M_MULTIPLIER} the unmultiplied 30M`,
        unit: '$ a year, re-worked each year',
        what: 'Each year, for each level, the mean claim is the midpoint of the line\'s T range x the year\'s growth '
          + 'factor (the T claims\' own: trend x book growth since 2027); a layer\'s expected cost is the sum over the '
          + 'levels of frequency x min(max(mean claim − attachment, 0), limit). The 30M layers (29 xs 1, 28 xs 2) are '
          + '1.25 x the 20M layer from the same attachment; the 40M layers (39 xs 1, 38 xs 2) 1.2 x the unmultiplied '
          + '30M layer. Charged as reinsurance in the rate, not multiplied by the CLF.',
        basis: 'CHOSEN',
        note: 'The pricing workbook\'s method, on the game\'s own claims, so prices follow the claims a player sees. '
          + 'In 2027 the factor is 1: WC 9 xs 1 $461K, GL $488K, Property $784K.',
      }],
      ['Aggregate cover on attritional losses', {
        value: AGGREGATE_COVER_OPTIONS.filter(o => o.limit > 0)
          .map(o => `${o.name} (${Math.round(o.attachment * 100)}% / ${Math.round(o.limit * 100)}%, load ${o.load})`).join(' · '),
        unit: 'attaches / limit, shares of the year\'s expected attritional losses; price = expected recovery x load',
        what: 'What a team can buy on each line beside the per-claim cover: None, or a cover on the year\'s attritional '
          + 'losses — normal losses plus the shocks\' surges (A), never a large (T) claim, Economic Inflation\'s uplift '
          + 'or the development of an older year — paying min(max(attritional − attachment, 0), limit). Expected '
          + 'attritional = expected normal losses x (1 + the average surge). Charged as reinsurance, no admin on it.',
        basis: 'SOURCED',
        note: 'The pricing workbook\'s "Agg Attritional" tab: four cases a year at the shock assumptions\' odds (none '
          + `85%, Low ${T_COVER_FREQUENCY.Low * 100}%, Mid ${T_COVER_FREQUENCY.Mid * 100}%, High ${T_COVER_FREQUENCY.High * 100}%), `
          + `each surge at the ${AGGREGATE_COVER_SURGE_BASIS.basis} of its A range, ordinary luck normal around the case at the `
          + 'line\'s ordinary-year CV. Not offered while the game\'s shocks are off. The prices assume surges at those odds; '
          + 'until the game\'s surges follow them, recoveries will differ from the prices.',
      }],
      ['Aggregate stop', {
        value: !AGGREGATE_STOP.enabled ? 'off — dormant; the T covers are offered' : AGGREGATE_STOP.enabled
          ? AGGREGATE_STOP_OPTIONS.filter(o => o.limit > 0)
            .map(o => `${o.name} ${Math.round(o.attachment * 100)}% / ${Math.round(o.limit * 100)}%`).join(' · ')
          : 'off — the per-claim packages', unit: 'attaches / limit, shares of the year\'s expected losses',
        what: 'What a team buys on each line: a stop on the accident year\'s total — ordinary losses, the shocks\' '
          + 'uplift and their large losses together — paying above the attachment up to the limit, both shares of '
          + 'the year\'s expected losses, or None. Recalculated each year as the year develops; the change is a '
          + 'prior-year reinsurance adjustment.',
        basis: 'CHOSEN',
        note: `Price = expected recovery + ${AGGREGATE_STOP_SD_LOAD} x the SD of the annual recovery, no floor, from `
          + `${AGGREGATE_STOP_SAMPLES.toLocaleString('en-US')} sampled accident years per line. Default: `
          + `${AGGREGATE_STOP_OPTIONS.find(o => o.id === AGGREGATE_STOP_DEFAULT)?.name}, for players and the prior `
          + 'board, while the game\'s shocks are on. Replaces the per-claim packages, whose code stays dormant behind '
          + 'the switch.',
      }],
      ['Covers while shocks are off', {
        value: largeClaimsInEveryGame()
          ? 'all eight and None, as with shocks on' : `offered: ${REINSURANCE_OFFERED_SHOCKS_OFF.join(' · ')}`,
        unit: 'rule',
        what: 'Large claims come in every game (LARGE_CLAIMS_EVERY_GAME), so a game with its shocks off (a hosted room '
          + 'with none scheduled) is offered and priced every cover exactly as one with them on. Off, only None.',
        basis: 'CHOSEN', note: 'Shocks off means only that no catalogue event fires; large claims still come, so the covers still pay.',
      }],
      ['Events keeping their large claim', {
        value: EVENTS_KEEPING_LARGE_CLAIMS.join(' · ') || 'none', unit: 'list',
        what: 'When Nuclear Verdict fires, General Liability gets one large claim at its map level (High), sized as before x the '
          + 'year\'s growth factor, on top of the regular large claims. It keeps its development, wording and news. Every '
          + 'other event sets no large claim.',
        basis: 'CHOSEN',
        note: 'The one exception. GL\'s cover prices do not include its extra claims (they are priced on the frequencies '
          + 'alone), nor do the Event Likelihoods; the expected losses do, while shocks are on.',
      }],
      ['Large claims in every game', {
        value: LARGE_CLAIMS_EVERY_GAME.enabled ? 'on' : 'off', unit: 'switch',
        what: 'Large claims, the covers and the Event Likelihoods in every game — single player, Test player and hosted — '
          + 'shocks on or off. Shocks off means only that no catalogue event fires (no surge, no development event).',
        basis: 'CHOSEN',
        note: 'A large claim is a fact of the line, not a scenario\'s event; a game without events should still face it and be offered the cover.',
      }],
      ['Default reinsurance', {
        value: `WC ${REINSURANCE_DEFAULT_OPTION.WC} · GL ${REINSURANCE_DEFAULT_OPTION.GL} · Property ${REINSURANCE_DEFAULT_OPTION.Property}`,
        unit: 'per line',
        what: 'Held by every team until it chooses, and by the pre-game\'s prior board.',
        basis: 'CHOSEN',
        note: 'wip/shocks: None — the pre-game draws no shocks, so a cover there would only move every opening.',
      }],
      ['Worlds', {
        value: String(WORLD_COUNT), unit: 'worlds per team-year',
        what: 'Each team\'s year runs in this many worlds, all teams sharing the same worlds\' draws; dollars '
          + 'shown are the average across worlds and every ratio is recomputed from averaged parts.',
        basis: 'CHOSEN',
        note: 'Shared across worlds: the decisions, one rate per team-year struck from the averaged history, '
          + 'and host-scheduled shocks (severity drawn per world). Per world: the ordinary year factor, shock '
          + 'severities, routine large losses and investment returns, and its own ledger and surplus. A hundred '
          + 'since stable-scenarios commit 10, averages only: a world keeps only its last row, the averaged row '
          + 'carries the surplus range and the audit\'s figures, and the save keeps the averages, the decisions and '
          + 'world 1\'s claim rows — a reload replays the years.',
      }],
      ['Aggregate cover', {
        value: 'not offered', unit: '—',
        what: 'Neither aggregate cover (the old WC/Property aggregate, or the aggregate stop) is offered; their code '
          + 'is kept dormant.',
        basis: 'CHOSEN',
        note: 'IT MAY RETURN. Aggregate cover is what protects against a broad surge — an A — which no '
          + 'per-occurrence cover reaches.',
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
        what: 'How many events the host\'s Randomise draws: round(Shocks per year x years), then −1, 0 or +1, '
          + 'equally likely, never fewer than one and at most one a year from year 2 — 2 to 4 in a ten-year game.',
        basis: 'CHOSEN',
        note: `Single-player draws by SOLO_SHOCK_DRAW ('${SOLO_SHOCK_DRAW}'); 'count' would use this rule. Year 1 stays shock-free.`,
      }],
      ['Shocks out of the experience', {
        value: SHOCKS_OUT_OF_EXPERIENCE.enabled ? 'on' : 'off', unit: 'switch',
        what: 'Each accident year\'s shock dollars (the uplift on ordinary losses and the shocks\' large losses, as '
          + 'booked) are taken out of the experience pure premium, on the paid basis before development. With '
          + 'Shock-free pricing on (below) the pure premium reads the shock-free shadow\'s ledger instead, which '
          + 'never had them.',
        basis: 'CHOSEN',
        note: 'A shock in the five-year window no longer lifts the rate for five years afterwards.',
      }],
      ['Shock-free pricing', {
        value: SHOCK_FREE_PRICING.enabled ? 'on' : 'off', unit: 'switch',
        what: 'THE RULE: no shock event affects the pure premium in any way — not its A or T, not its R development '
          + 'on prior years, not what it does to the booking and development of the normal losses, and not the '
          + 'Investment Loss (investment income does not enter pricing). From the first year a shock is in force '
          + 'the game keeps a shock-free shadow — the same game, worlds and decisions with nothing firing — and '
          + 'every pure premium is struck from its ledger. Reserve inflation and the host\'s development stay in.',
        basis: 'CHOSEN',
        note: 'wip/shocks. The deduction alone was approximate: a Wildfire moved Property\'s pure premium 0.5-0.9% '
          + 'and a Legislation (A + R) GL\'s 6-12% for five years. With the shadow a shocked game prices exactly as '
          + 'the same game without the shocks (shock-effects-check 7). The years after a shock run twice.',
      }],
      ['Catastrophe load', {
        value: CATASTROPHE_LOAD.enabled ? 'on' : 'off', unit: 'switch',
        what: 'OFF on every line: the rate carries no charge for shocks. They are unpriced surprises, like the host\'s '
          + 'development — never anticipated by the rate, and kept out of the experience it is struck from.',
        basis: 'CHOSEN',
        note: 'Removed because it double-counted: the pool\'s supplied loss costs already include its historical large '
          + 'events, so a load for the shocks\' expected cost priced them twice. On, it would charge that cost (struck '
          + `at year ${CATASTROPHE_LOAD_STEADY_YEAR} and trended) from the pre-game on — WC $0.167, GL $0.382, Property `
          + '$0.040 per $100 in year 1.',
      }],
      ['Stop recovery off the claims cost', {
        value: STOP_RECOVERY_OFF_CLAIMS_COST.enabled ? 'on' : 'off', unit: 'switch',
        what: 'OFF: the rate\'s claims cost is the experience claims cost alone, and the cover\'s full price is added '
          + 'as reinsurance. Nothing is taken off the claims cost for what the cover is expected to recover.',
        basis: 'CHOSEN',
        note: 'The cover recovers mostly in shock years, and the shocks are out of the claims cost; subtracting the '
          + 'expected recovery took off a recovery on losses the rate never charged. Year-1 rate per $100 at Expected, '
          + 'with the shocks sized on claims (below): WC 3.407 → 3.432, GL 4.754 → 4.852, Property 0.314 → 0.322.',
      }],
      ['Shocks in single-player', {
        value: SOLO_SHOCKS.enabled ? `on — drawn by '${SOLO_SHOCK_DRAW}'` : 'off', unit: 'switch',
        what: 'On: a single-player game draws its events once at its start — each year from year 2, each event at its '
          + 'catalogue probability (scaled so the twelve total Shocks per year), independently. Year 1 is shock-free.',
        basis: 'CHOSEN', note: 'ON in the wip/shocks test build. Hosted games keep the host\'s schedule.',
      }],
      ['Expected losses follow the shocks', {
        value: 'ordinary only whenever a game\'s shocks are off', unit: 'rule',
        what: 'A game whose shocks are off — single-player while the switch above is off, or a hosted room with '
          + 'no shocks scheduled — reads the ordinary-loss expectation only, everywhere it reads expected loss: '
          + 'the Expected Losses rows and the reserve basis on them, the expected loss ratio, the aggregate stop\'s '
          + 'attachment, and each cover\'s price and recovery distribution. A hosted game with a shock schedule '
          + 'keeps the shock-inclusive expectation, at the catalogue\'s probabilities.',
        basis: 'CHOSEN',
        note: 'With the catalogue\'s shocks in a game where none could fire, Expected Losses read 4-6% above every '
          + 'simulated year (scenario 10, WC), and the Working cover attached that far above the real mean, paid in '
          + 'about one world in five and recovered 8% of its price. On the ordinary expectation it costs about a '
          + 'third less and pays in about half the worlds, recovering 55% of its price; the Bad-year and Catastrophe '
          + 'covers, attaching at 115% and 130% of an ordinary year, now price at about nothing.',
      }],
      ['Catastrophe capital follows the shocks', {
        value: 'Property: none while a game\'s shocks are off', unit: 'rule',
        what: 'Required capital is the reserve risk margin plus, on Property, the catastrophe the pool retains from '
          + 'one regional event after its cover. A game whose shocks are off — single-player while the switch above '
          + 'is off, or a hosted room with no shocks scheduled — carries no catastrophe charge: no catastrophe can '
          + 'fire in it. With a schedule the charge returns, as before. WC and GL carry none either way.',
        basis: 'CHOSEN',
        note: 'The same switch as the expectation (shockLosses.gameShocksOn). Measured on a solo game (scenario 7): '
          + 'Property\'s year-1 required capital was $51.5M, $50.2M of it the catastrophe charge, and its capital '
          + 'status Deficient (-0.58); without the charge it is $1.3M and Strong (15.8).',
      }],
      ['Shock timing', {
        value: 'a schedule drawn once — the host\'s, or singleplayer\'s at its start', unit: '—',
        what: 'Multiplayer fires only what the host scheduled. Singleplayer draws its events once, at the game\'s '
          + 'start, each year from year 2 at the catalogue\'s probabilities, from the game seed, and keeps them in the '
          + 'save. Either way every world fires the same events in the same years, with the same sizes — a regional '
          + 'event in the same region. Pricing uses the catalogue\'s probabilities, never the schedule. Nothing fires '
          + 'before year 1.',
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
        note: 'The game charges admin as a share of premium, per line (ADMIN_SHARE_OF_PREMIUM, 20% on every line), not of operating expense as a whole.',
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
        status: 'SUPERSEDED',
        what: 'The Investment Loss event\'s hit to the equity return in the event year.',
        note: `Superseded by the hit by asset class: cash ${INVESTMENT_LOSS_BY_ASSET.cash}, bonds `
          + `${INVESTMENT_LOSS_BY_ASSET.bonds}, equities ${INVESTMENT_LOSS_BY_ASSET.equities} (wip/shocks).`,
      }],
      ['Investment Loss by asset class', {
        value: `cash ${INVESTMENT_LOSS_BY_ASSET.cash} · bonds ${INVESTMENT_LOSS_BY_ASSET.bonds} · equities ${INVESTMENT_LOSS_BY_ASSET.equities}`,
        unit: 'added to each class\'s return, event year', basis: 'CHOSEN', status: 'ADAPTED',
        what: 'In the year Investment Loss fires, each asset class\'s return takes its hit, so the loss depends on the '
          + 'pool\'s own allocation. Every world shares the event.',
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
        note: 'Adopted as NEW_BUSINESS_PENALTY: 20%, flat, on the new members\' exposure\'s first-year actual '
          + 'ordinary losses, kept out of expected loss so the rate learns it through the experience.',
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
        what: 'Drawn uniformly within the level\'s range, in the firing year only (wip/shocks; see A, one year only).',
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
        status: 'SUPERSEDED',
        what: 'An aggregate shock loss at the event\'s start, drawn uniformly. SUPERSEDED (wip/shocks) by one T claim '
          + 'of the sizes under T claim sizes.',
        note: '⚠ SCALED PER LINE, by that line\'s own ratio, never one pool-wide factor — the game\'s '
          + 'expected ordinary loss against the R model\'s (base premium x target loss ratio), a basis that '
          + 'does not move with a team\'s funding level; see T scaling under New loss engine. The model\'s '
          + 'Property book is $4.5M and its GL book $7M, so a single factor would scale them unevenly. In '
          + 'the game T arrives as large INDIVIDUAL losses, not a lump sum, so occurrence reinsurance can '
          + 'respond to it.',
      }],
      ['T shocks — WC', {
        value: rLevels(R_MODEL.tShock.WC, false), unit: 'dollars at onset', basis: 'CHOSEN',
        status: 'SUPERSEDED', what: 'As GL, scaled by WC\'s own premium ratio.',
      }],
      ['T shocks — Property', {
        value: rLevels(R_MODEL.tShock.Property, false), unit: 'dollars at onset', basis: 'CHOSEN',
        status: 'SUPERSEDED',
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
