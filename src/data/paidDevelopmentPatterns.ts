// ============================================================================
// THE POOL'S OWN DEVELOPMENT PATTERNS — PAID AND INCURRED — RECORDED, NOT USED.
//
// ⚠ NOTHING READS THIS FILE. It is data put down ahead of the work that will
// consume it. These patterns are intended to REPLACE the fitted Weibull payout
// curves (FITTED_PAYOUT_PATTERN in defaultAssumptions.ts, mechanics in
// payoutPattern.ts) when the simplified multiplayer model is built. Until that
// commit, the engine pays claims off the Weibull fit exactly as before and
// every value baseline is blind to this file by construction.
//
// Recorded here rather than in defaultAssumptions.ts beside the Weibull
// parameters BECAUSE both will exist at once for a while, and two payout
// patterns sharing a file is how the next reader comes to wire the wrong one.
// The pointer is at LINE_PAYOUT_PATTERN, where someone looking for payout data
// will actually land.
//
// ============================================================================
// CONVENTIONS — EVERY PATTERN IN THIS FILE, NO EXCEPTIONS.
//
//   AGE-TO-ULTIMATE loss development factors. Each factor takes the amount at
//     that age to ultimate; it is NOT an age-to-age link ratio. LDF 1.000 means
//     the quantity has reached ultimate.
//   TWO BASES. PAID takes paid-to-date to ultimate. INCURRED takes REPORTED
//     (paid plus case reserves) to ultimate. Incurred is at or below paid at
//     every age, because reported can never be behind paid.
//   GROUND-UP, which is the basis the game's losses are on. GL carries one
//     qualification — see its own note.
//   AGES IN MONTHS FROM THE START OF THE ACCIDENT YEAR, so 12 is the END of the
//     first year, 24 the end of the second, and so on. An age of 12 is not
//     "twelve months of development" on a mid-year claim; it is the valuation
//     date, and every claim in the year shares it.
//
// ⚠ DERIVED, NOT STORED. Storing any of these beside the factors would be two
// descriptions of one fact — the defect shape this project keeps finding — so
// they are functions over the LDF columns and the LDF columns are the record:
//
//   Pct Paid       = 1 / paid LDF
//   Pct Reported   = 1 / incurred LDF
//   Pct Unpaid     = 1 - 1 / paid LDF
//   Case reserves  = 1 / incurred - 1 / paid        (reported but not yet paid)
//   IBNR           = 1 - 1 / incurred
//   Case + IBNR    = total unpaid, identically
//   Share of outstanding paid
//     over the next twelve months = (unpaid now - unpaid next) / unpaid now
//   Each year's payment           = the STEP in paid-to-date between two ages
//
// ⚠ "IBNR" HERE IS NOT ONLY LATE-REPORTED CLAIMS, AND THE LABEL IS A
// COMPROMISE. On an INCURRED age-to-ultimate factor, everything between
// reported and ultimate is in this bucket — and that includes GROWTH ON CLAIMS
// ALREADY REPORTED, which is development on a known claim rather than a claim
// nobody has heard of. On WC most of it is exactly that: a long-tail
// compensation claim is reported early and then grows for years. Read it as
// "reported-to-ultimate development", of which pure late reporting is one part.
//
// ============================================================================
// PROVENANCE — WHAT WAS CHOSEN, AND WHAT WAS REJECTED.
//
// ⚠ A POOL-LAYER WC PATTERN ALSO EXISTS AND IS DELIBERATELY NOT USED. That one
// describes the layer ABOVE member retentions. The game's losses are ground-up,
// so the pool-layer pattern would be the right table for the wrong quantity —
// it pays later than ground-up by construction, because the layer is only
// reached once a claim is already large.
//
// ⚠ THE GL "TOTAL" PAID PATTERN IS RETIRED. It is kept below as
// RETIRED_GL_TOTAL_PAID_DEVELOPMENT, unused, because the reason it was retired
// is a measurement and the measurement should stay checkable. It did not pair
// with an incurred pattern: against the GL incurred factors recorded here it
// shows MORE PAID THAN REPORTED, which is impossible — money cannot leave
// before the claim it pays is on the books.
//
//   MEASURED, not restated. Paid-to-date exceeds reported at EIGHT ages,
//   108 through 192 months, peaking at 132:
//
//     108mo  paid 91.41%  reported 90.66%   excess 0.75% of ultimate
//     120mo  paid 92.94%  reported 91.74%   excess 1.19%
//     132mo  paid 94.52%  reported 93.02%   excess 1.49%
//     144mo  paid 95.15%  reported 93.98%   excess 1.16%
//     156mo  paid 95.79%  reported 94.97%   excess 0.82%
//     168mo  paid 96.43%  reported 95.88%   excess 0.55%
//     180mo  paid 97.09%  reported 96.81%   excess 0.28%
//     192mo  paid 97.37%  reported 97.28%   excess 0.09%
//
//   ⚠ THE RANGE IS 108-192, NOT 84-180. The brief that retired this pattern
//   gave 84 to 180 months. 84 and 96 are coherent (incurred 1.136 and 1.116
//   against paid 1.218 and 1.146), and 192 is not — it is the last violating
//   age, by 0.09%. The conclusion is unchanged and the pattern is still
//   retired; the range is recorded as measured so the next reader checking it
//   does not find two of the eight ages missing and the endpoints wrong.
//
// ⚠ A SECOND WC TAIL EXTENSION WAS REJECTED. It jumped to about 9.3% annual
// emergence at 264 months — roughly double the rate the measured data runs at
// as it approaches that age — and continued from there. A tail is an
// extrapolation of a trend or it is an invention; that one broke the data's own
// trend at exactly the point it took over, which is the one place a tail must
// be continuous. The extension kept below continues the measured 4.2-4.9%
// emergence smoothly across the join.
// ============================================================================

import type { CoverageLine } from '../types/simulation';

export interface DevelopmentRow {
  /** Months from the START of the accident year. 12 is the end of year one. */
  readonly ageMonths: number;
  /** Age-to-ultimate factor on this pattern's basis. 1.000 means at ultimate. */
  readonly ldf: number;
  /**
   * TRUE where the row is a PROJECTED tail extension rather than the pool's
   * measured experience. Present only on WC paid. A consumer that must not
   * extrapolate can filter on it; nothing is hidden by being projected, but
   * nothing should mistake it for data either.
   */
  readonly projected?: true;
  /**
   * TRUE where the supplied factor was ADJUSTED rather than taken as given.
   * Present only on GL incurred — see that pattern's note for what was changed
   * and why.
   */
  readonly adjusted?: true;
}

// ============================================================================
// PAID
// ============================================================================

// WORKERS' COMPENSATION — PAID, ground-up.
//
// ⚠ ROWS TO 264 ARE THE POOL'S DATA. ROWS FROM 276 ARE PROJECTED. The split is
// marked on the rows themselves rather than left to this comment, because a
// comment does not survive the table being read programmatically. The
// projection continues the measured late emergence of about 4.5-4.8% a year:
// across the join it runs 4.53% at 264-276 against the measured 4.2-4.9% over
// the preceding decade, which is the continuity the rejected alternative lacked.
//
// WC does not reach 1.000 even at 444 months. That is the shape, not a missing
// row — a long-tail line is still paying twenty years in, and the lookup below
// THROWS past the last age rather than pretending the balance has settled.
const WC_PAID_DEVELOPMENT: readonly DevelopmentRow[] = [
  { ageMonths: 12, ldf: 12.777 },
  { ageMonths: 24, ldf: 4.483 },
  { ageMonths: 36, ldf: 2.911 },
  { ageMonths: 48, ldf: 2.31 },
  { ageMonths: 60, ldf: 1.992 },
  { ageMonths: 72, ldf: 1.811 },
  { ageMonths: 84, ldf: 1.692 },
  { ageMonths: 96, ldf: 1.604 },
  { ageMonths: 108, ldf: 1.535 },
  { ageMonths: 120, ldf: 1.49 },
  { ageMonths: 132, ldf: 1.454 },
  { ageMonths: 144, ldf: 1.418 },
  { ageMonths: 156, ldf: 1.391 },
  { ageMonths: 168, ldf: 1.363 },
  { ageMonths: 180, ldf: 1.339 },
  { ageMonths: 192, ldf: 1.319 },
  { ageMonths: 204, ldf: 1.3 },
  { ageMonths: 216, ldf: 1.281 },
  { ageMonths: 228, ldf: 1.266 },
  { ageMonths: 240, ldf: 1.251 },
  { ageMonths: 252, ldf: 1.236 },
  { ageMonths: 264, ldf: 1.227 },
  // ---- PROJECTED FROM HERE. NOT MEASURED. ----
  { ageMonths: 276, ldf: 1.214513466, projected: true },
  { ageMonths: 288, ldf: 1.202768977, projected: true },
  { ageMonths: 300, ldf: 1.191716924, projected: true },
  { ageMonths: 312, ldf: 1.181311554, projected: true },
  { ageMonths: 324, ldf: 1.171510618, projected: true },
  { ageMonths: 336, ldf: 1.162275057, projected: true },
  { ageMonths: 348, ldf: 1.153568721, projected: true },
  { ageMonths: 360, ldf: 1.145358117, projected: true },
  { ageMonths: 372, ldf: 1.13761218, projected: true },
  { ageMonths: 384, ldf: 1.130302066, projected: true },
  { ageMonths: 396, ldf: 1.123400972, projected: true },
  { ageMonths: 408, ldf: 1.116883965, projected: true },
  { ageMonths: 420, ldf: 1.110727828, projected: true },
  { ageMonths: 432, ldf: 1.104910931, projected: true },
  { ageMonths: 444, ldf: 1.099413098, projected: true },
];

// GENERAL LIABILITY — PAID, ground-up, AT A LIMITED LAYER.
//
// ⚠ THIS IS THE ORDINARY BOOK, NOT THE WHOLE LINE, AND THE LIMIT IS MISSING.
// GL's large claims come from SHOCK EVENTS in this game, which are modelled
// separately, so the pattern that belongs against the routine book is a
// ground-up pattern at a smaller, LIMITED layer — losses capped at a per-claim
// limit, with everything above it left to the shock system.
//
// THE LIMIT ITSELF WAS NOT SUPPLIED AND MUST BE ADDED. Recording the pattern
// without it is deliberate rather than an oversight being waved through: the
// factors are the scarce thing and they are right, but a limited pattern whose
// limit is unknown cannot be wired, because nothing can check that the claims
// being developed are the ones the pattern describes. Whoever wires this adds
// the limit here first, beside the factors it conditions.
//
// Replaces the "Total" pattern, which is retired below for showing more paid
// than reported. This one pairs with GL_INCURRED_DEVELOPMENT at every age.
const GL_PAID_DEVELOPMENT: readonly DevelopmentRow[] = [
  { ageMonths: 12, ldf: 46.794 },
  { ageMonths: 24, ldf: 8.138 },
  { ageMonths: 36, ldf: 3.349 },
  { ageMonths: 48, ldf: 1.97 },
  { ageMonths: 60, ldf: 1.487 },
  { ageMonths: 72, ldf: 1.299 },
  { ageMonths: 84, ldf: 1.192 },
  { ageMonths: 96, ldf: 1.146 },
  { ageMonths: 108, ldf: 1.113 },
  { ageMonths: 120, ldf: 1.091 },
  { ageMonths: 132, ldf: 1.075 },
  { ageMonths: 144, ldf: 1.064 },
  { ageMonths: 156, ldf: 1.053 },
  { ageMonths: 168, ldf: 1.043 },
  { ageMonths: 180, ldf: 1.033 },
  { ageMonths: 192, ldf: 1.028 },
  { ageMonths: 204, ldf: 1.023 },
  { ageMonths: 216, ldf: 1.018 },
  { ageMonths: 228, ldf: 1.013 },
  { ageMonths: 240, ldf: 1.012 },
  { ageMonths: 252, ldf: 1.011 },
];

// PROPERTY — PAID, ground-up. FULLY PAID AT 132 MONTHS: the last factor is
// exactly 1.000, which is the one place in this file where a lookup at the last
// age means "nothing is outstanding" rather than "the table ran out".
const PROPERTY_PAID_DEVELOPMENT: readonly DevelopmentRow[] = [
  { ageMonths: 12, ldf: 2.18 },
  { ageMonths: 24, ldf: 1.24 },
  { ageMonths: 36, ldf: 1.09 },
  { ageMonths: 48, ldf: 1.033 },
  { ageMonths: 60, ldf: 1.02 },
  { ageMonths: 72, ldf: 1.008 },
  { ageMonths: 84, ldf: 1.004 },
  { ageMonths: 96, ldf: 1.002 },
  { ageMonths: 108, ldf: 1.002 },
  { ageMonths: 120, ldf: 1.001 },
  { ageMonths: 132, ldf: 1.0 },
];

// ============================================================================
// INCURRED — reported (paid plus case) to ultimate.
// ============================================================================

// WORKERS' COMPENSATION — INCURRED, ground-up.
//
// ⚠ MEASURED TO 264, PROJECTED FROM 276 TO 444, marked on the rows as the paid
// table marks its own. This extension was ADDED AT PRICING COMMIT 5(c), when
// case and IBNR became a derived presentation that every accident year needs at
// every age a game reaches. Before it, the table stopped at 264 while paid ran
// to 444 and reserveSplitAt threw across the gap; a presentation cannot throw
// on the years it is meant to present, so the gap had to close one way or the
// other, and closing it with a stated projection is the honest way.
//
// HOW THE PROJECTION WAS MADE, so it can be argued with. The IBNR share
// (1 - 1 / incurred) is continued at the LAST DECLINE THE DATA MEASURED: 3.827%
// a year, the 252-to-264 step. The three final measured steps run 3.549%,
// 3.683% and 3.827% — a tight, slowly rising cluster that breaks cleanly from
// the 5.5-6.6% of the preceding decade — so the late regime is the one being
// continued. The rate is HELD rather than extrapolated: it is drifting up by
// about 0.14pp a step, and carrying that drift fifteen steps past the last
// observation would invent an acceleration the data does not support.
//
// ⚠ WHAT THE PROJECTION IS CHECKED AGAINST, because a tail that breaks the
// split is worse than no tail. Case reserves are 1/incurred - 1/paid, so the
// incurred factor must stay BELOW the paid factor at every age or case goes
// negative. It does: case runs 0.1531 of ultimate at 276 down to 0.0768 at 444,
// positive and declining monotonically throughout, and IBNR declines beside it.
// reserve-split-check asserts this on every line, age and valuation.
//
// The gap between the two bases is wide and early on this line, which is the
// whole character of WC: 36% reported at 12 months against 8% paid, so most of
// the opening balance is case reserve on claims already known. By 264 months
// incurred is 1.025 against paid 1.227 — nearly everything left is case.
const WC_INCURRED_DEVELOPMENT: readonly DevelopmentRow[] = [
  { ageMonths: 12, ldf: 2.776802343 },
  { ageMonths: 24, ldf: 1.638231471 },
  { ageMonths: 36, ldf: 1.321154412 },
  { ageMonths: 48, ldf: 1.195614853 },
  { ageMonths: 60, ldf: 1.13328422 },
  { ageMonths: 72, ldf: 1.100275942 },
  { ageMonths: 84, ldf: 1.087229192 },
  { ageMonths: 96, ldf: 1.078600389 },
  { ageMonths: 108, ldf: 1.070040068 },
  { ageMonths: 120, ldf: 1.063658119 },
  { ageMonths: 132, ldf: 1.057314234 },
  { ageMonths: 144, ldf: 1.051008185 },
  { ageMonths: 156, ldf: 1.045779289 },
  { ageMonths: 168, ldf: 1.040576406 },
  { ageMonths: 180, ldf: 1.036430684 },
  { ageMonths: 192, ldf: 1.03436196 },
  { ageMonths: 204, ldf: 1.032297365 },
  { ageMonths: 216, ldf: 1.030236891 },
  { ageMonths: 228, ldf: 1.02818053 },
  { ageMonths: 240, ldf: 1.027153377 },
  { ageMonths: 252, ldf: 1.02612725 },
  { ageMonths: 264, ldf: 1.025102147 },
  // ---- PROJECTED FROM HERE. NOT MEASURED. See the header for the method. ----
  { ageMonths: 276, ldf: 1.024118318, projected: true },
  { ageMonths: 288, ldf: 1.023173921, projected: true },
  { ageMonths: 300, ldf: 1.022267307, projected: true },
  { ageMonths: 312, ldf: 1.021396903, projected: true },
  { ageMonths: 324, ldf: 1.020561207, projected: true },
  { ageMonths: 336, ldf: 1.019758782, projected: true },
  { ageMonths: 348, ldf: 1.018988255, projected: true },
  { ageMonths: 360, ldf: 1.018248313, projected: true },
  { ageMonths: 372, ldf: 1.017537703, projected: true },
  { ageMonths: 384, ldf: 1.016855222, projected: true },
  { ageMonths: 396, ldf: 1.016199723, projected: true },
  { ageMonths: 408, ldf: 1.015570107, projected: true },
  { ageMonths: 420, ldf: 1.014965322, projected: true },
  { ageMonths: 432, ldf: 1.014384361, projected: true },
  { ageMonths: 444, ldf: 1.01382626, projected: true },
];

// GENERAL LIABILITY — INCURRED, same limited layer as the paid pattern above.
//
// ⚠ SIX ROWS ARE ADJUSTED, AND THE ADJUSTMENT IS RECORDED ON THE ROWS. At 132,
// 144, 156, 168, 180 and 228 months the SUPPLIED incurred factor slightly
// EXCEEDED the paid factor — up to 0.4% of ultimate — which would mean more
// paid than reported. It is a rounding artefact rather than a signal: at those
// ages case reserves are near zero, both columns round to three decimals, and
// the difference is smaller than the rounding. Incurred is set EQUAL TO PAID at
// those six ages, which puts case reserves at exactly zero there.
//
// ⚠ THREE FURTHER AGES ARRIVE EQUAL WITHOUT BEING ADJUSTED — 192, 204 and 216.
// Those are not marked, because the supplied figures already matched the paid
// column and nothing was changed. They are called out here because the data
// cannot distinguish them from the adjusted six by inspection: nine ages read
// case = 0, and only six of them were touched.
//
// ALL NINE ARE BEYOND ANY GAME'S RANGE. A session runs five years, so nothing
// the engine will ever ask for reaches 132 months — the adjustment cannot move
// a played figure, and is recorded for the reader rather than for the model.
const GL_INCURRED_DEVELOPMENT: readonly DevelopmentRow[] = [
  { ageMonths: 12, ldf: 4.669 },
  { ageMonths: 24, ldf: 1.966 },
  { ageMonths: 36, ldf: 1.435 },
  { ageMonths: 48, ldf: 1.27 },
  { ageMonths: 60, ldf: 1.198 },
  { ageMonths: 72, ldf: 1.163 },
  { ageMonths: 84, ldf: 1.136 },
  { ageMonths: 96, ldf: 1.116 },
  { ageMonths: 108, ldf: 1.103 },
  { ageMonths: 120, ldf: 1.09 },
  { ageMonths: 132, ldf: 1.075, adjusted: true },
  { ageMonths: 144, ldf: 1.064, adjusted: true },
  { ageMonths: 156, ldf: 1.053, adjusted: true },
  { ageMonths: 168, ldf: 1.043, adjusted: true },
  { ageMonths: 180, ldf: 1.033, adjusted: true },
  { ageMonths: 192, ldf: 1.028 },
  { ageMonths: 204, ldf: 1.023 },
  { ageMonths: 216, ldf: 1.018 },
  { ageMonths: 228, ldf: 1.013, adjusted: true },
  { ageMonths: 240, ldf: 1.01 },
  { ageMonths: 252, ldf: 1.007 },
];

// PROPERTY — INCURRED, ground-up. Reaches 1.000 at 108 months, a full two years
// before paid does: a property claim is known almost at once and the remaining
// time is spent paying it, which is the opposite of WC's shape.
const PROPERTY_INCURRED_DEVELOPMENT: readonly DevelopmentRow[] = [
  { ageMonths: 12, ldf: 1.203 },
  { ageMonths: 24, ldf: 1.05 },
  { ageMonths: 36, ldf: 1.02 },
  { ageMonths: 48, ldf: 1.003 },
  { ageMonths: 60, ldf: 1.003 },
  { ageMonths: 72, ldf: 1.001 },
  { ageMonths: 84, ldf: 1.001 },
  { ageMonths: 96, ldf: 1.001 },
  { ageMonths: 108, ldf: 1.0 },
  { ageMonths: 120, ldf: 1.0 },
  { ageMonths: 132, ldf: 1.0 },
];

// ============================================================================
// RETIRED — kept so the reason stays checkable. NOT in the pattern maps.
// ============================================================================

/**
 * THE RETIRED GL "TOTAL" PAID PATTERN — the whole line rather than the limited
 * ordinary-book layer. Superseded by GL_PAID_DEVELOPMENT.
 *
 * ⚠ NOT EXPORTED FOR USE. It is exported so the incoherence that retired it can
 * be re-measured instead of taken on trust: paired with GL_INCURRED_DEVELOPMENT
 * it shows more paid than reported at eight ages, 108 through 192 months. See
 * this file's provenance block for the readings, and paid-development-check,
 * which asserts that this pattern FAILS the incurred-at-or-below-paid rule.
 */
export const RETIRED_GL_TOTAL_PAID_DEVELOPMENT: readonly DevelopmentRow[] = [
  { ageMonths: 12, ldf: 78.547 },
  { ageMonths: 24, ldf: 21.963 },
  { ageMonths: 36, ldf: 5.754 },
  { ageMonths: 48, ldf: 2.543 },
  { ageMonths: 60, ldf: 1.674 },
  { ageMonths: 72, ldf: 1.387 },
  { ageMonths: 84, ldf: 1.218 },
  { ageMonths: 96, ldf: 1.146 },
  { ageMonths: 108, ldf: 1.094 },
  { ageMonths: 120, ldf: 1.076 },
  { ageMonths: 132, ldf: 1.058 },
  { ageMonths: 144, ldf: 1.051 },
  { ageMonths: 156, ldf: 1.044 },
  { ageMonths: 168, ldf: 1.037 },
  { ageMonths: 180, ldf: 1.030 },
  { ageMonths: 192, ldf: 1.027 },
  { ageMonths: 204, ldf: 1.024 },
  { ageMonths: 216, ldf: 1.021 },
  { ageMonths: 228, ldf: 1.019 },
  { ageMonths: 240, ldf: 1.016 },
  { ageMonths: 252, ldf: 1.014 },
];

// ============================================================================

/** The PAID patterns, by line. NOT YET USED — see this file's header. */
export const PAID_DEVELOPMENT_PATTERN: Readonly<Record<CoverageLine, readonly DevelopmentRow[]>> = {
  WC: WC_PAID_DEVELOPMENT,
  GL: GL_PAID_DEVELOPMENT,
  Property: PROPERTY_PAID_DEVELOPMENT,
};

/** The INCURRED patterns, by line. NOT YET USED — see this file's header. */
export const INCURRED_DEVELOPMENT_PATTERN: Readonly<Record<CoverageLine, readonly DevelopmentRow[]>> = {
  WC: WC_INCURRED_DEVELOPMENT,
  GL: GL_INCURRED_DEVELOPMENT,
  Property: PROPERTY_INCURRED_DEVELOPMENT,
};

const AGE_STEP_MONTHS = 12;

function ldfAt(
  rows: readonly DevelopmentRow[], line: CoverageLine, basis: string, ageMonths: number,
): number {
  const last = rows[rows.length - 1];
  if (ageMonths > last.ageMonths) {
    throw new Error(
      `${basis}LdfAt: ${line} has no ${basis} development factor at age ${ageMonths} months — `
      + `the pattern ends at ${last.ageMonths} (LDF ${last.ldf}). `
      + 'Extend the pattern rather than defaulting; a longer game must announce the gap.',
    );
  }
  const row = rows.find(r => r.ageMonths === ageMonths);
  if (row === undefined) {
    throw new Error(
      `${basis}LdfAt: ${line} has no ${basis} row at age ${ageMonths} months. Ages are months from the `
      + `START of the accident year in steps of ${AGE_STEP_MONTHS} `
      + `(first row ${rows[0].ageMonths}, last ${last.ageMonths}).`,
    );
  }
  return row.ldf;
}

/**
 * The PAID age-to-ultimate factor for a line at an age in months.
 *
 * ⚠ THROWS PAST THE PATTERN'S LAST AGE RATHER THAN DEFAULTING, and that is the
 * point of the function rather than a precaution in it. A game run longer than
 * a pattern covers would otherwise silently stop paying — the balance would
 * freeze at whatever the last row left outstanding and no figure anywhere would
 * say why. WC is the live case: it is still 9% unpaid at 444 months, so a
 * lookup past the end is asking for a number that does not exist, not for zero.
 */
export function paidLdfAt(line: CoverageLine, ageMonths: number): number {
  return ldfAt(PAID_DEVELOPMENT_PATTERN[line], line, 'paid', ageMonths);
}

/** The INCURRED age-to-ultimate factor for a line at an age. Throws as paidLdfAt does. */
export function incurredLdfAt(line: CoverageLine, ageMonths: number): number {
  return ldfAt(INCURRED_DEVELOPMENT_PATTERN[line], line, 'incurred', ageMonths);
}

/** DERIVED: the share of ultimate still unpaid at an age. `1 - 1 / paid LDF`. */
export function pctUnpaid(ldf: number): number {
  return 1 - 1 / ldf;
}

/** DERIVED: the share of ultimate REPORTED at an age. `1 / incurred LDF`. */
export function pctReported(incurredLdf: number): number {
  return 1 / incurredLdf;
}

/**
 * DERIVED: the unpaid balance split into CASE reserves and IBNR.
 *
 *   case = 1 / incurred - 1 / paid     reported, not yet paid
 *   ibnr = 1 - 1 / incurred            reported-to-ultimate development
 *   case + ibnr = 1 - 1 / paid         total unpaid, identically
 *
 * ⚠ THE "SPLIT IS UNDEFINED PAST 264" GUARD IS GONE, and this is the note it
 * left behind. It existed because WC's incurred pattern stopped at 264 while
 * paid ran to 444, so across that gap there was no incurred factor to divide
 * the balance with and throwing beat guessing. Pricing commit 5(c) made case
 * and IBNR a derived presentation shown for every accident year at every age a
 * game reaches, and a presentation cannot throw on the years it presents — so
 * WC's incurred table was PROJECTED to 444 on a stated method instead. The gap
 * no longer exists on any line: all three incurred patterns now end exactly
 * where their paid patterns do.
 *
 * There is still a range guard, and it is the right one: it belongs to
 * paidLdfAt and incurredLdfAt, which throw past the last age of their own
 * tables. A separate guard here would now only duplicate theirs, and a
 * duplicate guard is the kind that goes stale when one table moves.
 */
export function reserveSplitAt(line: CoverageLine, ageMonths: number): {
  caseReserves: number; ibnr: number; totalUnpaid: number;
} {
  const paidLdf = paidLdfAt(line, ageMonths);
  const incurredLdf = incurredLdfAt(line, ageMonths);
  return {
    caseReserves: 1 / incurredLdf - 1 / paidLdf,
    ibnr: 1 - 1 / incurredLdf,
    totalUnpaid: 1 - 1 / paidLdf,
  };
}

/**
 * DERIVED: the share of what is OUTSTANDING at `ageMonths` that is paid over
 * the following twelve months. `(unpaid now - unpaid next) / unpaid now`.
 *
 * Returns 0 where nothing is outstanding, which is the only sensible reading of
 * "what share of nothing was paid" and the case Property reaches at 132.
 */
export function shareOfOutstandingPaidNextYear(line: CoverageLine, ageMonths: number): number {
  const now = pctUnpaid(paidLdfAt(line, ageMonths));
  if (now <= 0) return 0;
  const next = pctUnpaid(paidLdfAt(line, ageMonths + AGE_STEP_MONTHS));
  return (now - next) / now;
}

/**
 * DERIVED: the share of ULTIMATE paid during the twelve months ending at
 * `ageMonths` — the step in paid-to-date. Paid-to-date at an age is `1 / LDF`,
 * and before the first valuation it is 0.
 */
export function paymentInYearEndingAt(line: CoverageLine, ageMonths: number): number {
  const paidNow = 1 / paidLdfAt(line, ageMonths);
  const rows = PAID_DEVELOPMENT_PATTERN[line];
  if (ageMonths === rows[0].ageMonths) return paidNow;
  return paidNow - 1 / paidLdfAt(line, ageMonths - AGE_STEP_MONTHS);
}
