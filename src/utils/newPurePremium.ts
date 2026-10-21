// ============================================================================
// THE NEW PURE PREMIUM — COMMIT 2, AND IT SETS NO RATE.
//
// ⚠ SHADOW MODE. This is computed beside the current experience rate, exposed
// on the line result and in a report, and READ BY NOTHING THAT PRICES. The rest
// of the new rate stack — the expense loads, the reinsurance load, the profit
// provision — arrives in commit 3, and feeding this number into the OLD stack
// would produce a hybrid that is neither design and that nobody could reason
// about. The rate members pay is bit-identical with this file present.
//
// WHAT IT IS, per $100 of exposure, per line:
//
//   1. WINDOW       the most recent five accident years, EQUAL WEIGHTS
//   2. DEVELOPMENT  each year to the end of the pattern with the PAID LDFs at
//                   its age — the patterns the game reads, closed with no tail
//                   (DEVELOPMENT_TAIL), not factors estimated from the ledger
//   3. TREND        each year's loss cost to the year being priced, NET of
//                   exposure growth
//   4. ALAE + ULAE  each the parameter's share of loss cost
//
// Every parameter comes from src/data/pricingParameters.ts. Nothing here holds
// a literal that belongs there.
//
// ============================================================================
// ⚠ THE BASIS IS GROUND-UP, AND THAT IS WHY THE LEDGER GREW A SERIES.
//
// The first indication is priced as if the pool were self-funding, so it needs
// GROUND-UP losses. Everything on ReserveDevelopmentRow was NET of reinsurance
// — `ultimateByValuation` and `paidByValuation` both say so at the field. The
// two ways to price ground-up off a net ledger were:
//
//   gross a net rate back up through the tower, which is the secant solve the
//     current path runs (grossUpRetainedPurePremium) and which exists to stop
//     cession being deducted twice. Building the NEW rate on top of that would
//     inherit the whole mechanism this rebuild is meant to replace; or
//   price the retained basis and call it ground-up, which is just wrong.
//
// So `grossPaidByValuation` is recorded alongside the net series, from the
// cohort's own `grossPaid` — a ledger that has existed for other reasons since
// the gross claims workbook landed. See the field's comment. A row without it
// is SKIPPED rather than falling back to the net series, because a silent basis
// switch inside a window is worse than a short window.
//
// ⚠ FOR COMMIT 4: THE FINAL RATE NEEDS THE RETAINED PORTION SEPARATELY. This
// number is ground-up by construction; what a member pays is the retained part
// plus the price of the cover. Both halves exist — the net series is still on
// the row beside the gross one — but the split is not this commit's job and is
// not computed here.
// ============================================================================

import {
  PRICING_WINDOW_YEARS_NEW,
  ALAE_OF_LOSS_COST, ULAE_OF_LOSS_COST,
  FREQUENCY_TREND_PER_YEAR, SEVERITY_TREND_PER_YEAR, EXPOSURE_GROWTH_PER_YEAR,
} from '../data/pricingParameters';
import { PAID_DEVELOPMENT_PATTERN } from '../data/paidDevelopmentPatterns';
import { expectedLossBreakdown } from './shockExpectation';
import { getMemberExposure } from './lineHelpers';
import { wasActiveInLine } from './membershipHistory';
import type {
  CoverageLine, Member, MembershipHistory, ReserveDevelopmentRow,
} from '../types/simulation';

/**
 * ⚠ IS ALAE ALREADY IN THE LOSSES? ON GL, YES — MEASURED FROM THE CODE, NOT
 * ASSUMED, AND IT IS WHY THIS FLAG EXISTS RATHER THAN A FLAT 8.3%.
 *
 * GL's severity is a fitted 3-component lognormal mixture and the fit says so
 * twice in defaultAssumptions.ts: "no sub-coverage, no gate, ALAE included in
 * the amount", and "the fitted mixture includes ALAE and comes from a real
 * pool's real claim experience". Adding the parameter's share on top of GL
 * would therefore count defence costs twice, so it is NOT added on GL.
 *
 * ⚠ WC AND PROPERTY ARE MARKED FALSE AND THAT IS THE WEAKER OF THE TWO
 * READINGS. Their generators carry no ALAE component — WC draws medical and
 * indemnity, which are benefit categories, and Property draws building damage —
 * so on the generators alone the parameter is not a double count. BUT the
 * engine's own published metric is labelled "Gross Ultimate Loss + LAE"
 * (resultMetrics.ts), which asserts that every line's loss figure is already
 * LAE-inclusive. The label and the generators disagree, and the code does not
 * settle it. Recorded rather than resolved: if the label is right, WC's and
 * Property's new pure premium here is 8.3% too high on the ALAE limb, and the
 * fix is this flag rather than a change to the parameter.
 */
export const ALAE_ALREADY_IN_LOSSES: Readonly<Record<CoverageLine, boolean>> = {
  WC: false,
  GL: true,
  Property: false,
};

/**
 * ⚠ THE GL LDFs DESCRIBE A LIMITED LAYER AND THE ENGINE'S GL LOSSES DO NOT.
 * The recorded GL paid pattern is the ordinary book at a limited layer — whose
 * LIMIT was not supplied and is recorded as required before wiring — while the
 * engine's GL severity mixture is unlimited and carries its large claims
 * itself. Developing unlimited losses on limited-layer factors understates
 * them: the limited pattern's tail is shorter, because the claims that develop
 * longest are the large ones the layer excludes. The size of that is MEASURED
 * in the report rather than guessed at here. It resolves when the new
 * distributions arrive and GL's generator matches the layer the pattern
 * describes.
 */
export const GL_LAYER_MISMATCH = true;

export interface NewPurePremiumPoint {
  accidentYear: number;
  /** Ledger age at the latest valuation; months = (age + 1) x 12. */
  ageMonths: number;
  groundUpPaid: number;
  ldf: number;
  developed: number;
  exposure: number;
  lossCostPer100: number;
  trendFactor: number;
  trendedLossCostPer100: number;
}

export interface NewPurePremiumResult {
  /** Loss cost only, trended, before ALAE and ULAE. */
  lossCostPer100: number;
  alaePer100: number;
  ulaePer100: number;
  /** loss cost + ALAE + ULAE, at expected. The headline. */
  purePremiumPer100: number;
  points: NewPurePremiumPoint[];
  /** Years dropped for want of a ground-up series or a known exposure. */
  skipped: number;
}

export interface NewPurePremiumBasis {
  rows: ReserveDevelopmentRow[];
  allMarketMembers: Member[];
  membershipHistory: MembershipHistory;
}

/**
 * THE TREND APPLIED TO A LOSS COST, PER YEAR.
 *
 *   loss cost trend = (1 + frequency) x (1 + severity) / (1 + exposure growth)
 *                   = 1.000 x (1 + the line's severity trend) / 1.000
 *                   -> WC +4%, GL +8%, Property +5% a year (stable-scenarios commit 3)
 *
 * ⚠ THE EXPOSURE DIVISOR IS STILL HERE AND IT IS 1. It used to be the whole
 * subtlety of this function: a loss cost is losses DIVIDED BY exposure, the
 * base grew at wage inflation, so an older year's loss cost was already
 * expressed against a smaller base and trending it by the full loss trend
 * counted wage growth twice. The three lines came out at -1.462%, -3.504% and
 * 0.0%/yr — three different signs for three different reasons.
 *
 * With EXPOSURE_GROWTH_PER_YEAR at zero there is nothing to net out, and the
 * loss cost trends at exactly the severity trend. The divisor stays written
 * down because the hazard it guards against is one line of carelessness away
 * the moment the base trends again.
 *
 * ⚠ IT READS THE SAME PARAMETERS THE ENGINE DRAWS AND PRICES ON, which is the
 * property that makes this a shadow of the engine rather than a second opinion
 * about it. If these ever diverge, the comparison this module exists to make
 * is measuring the divergence and not the rate.
 */
export function lossCostTrendPerYear(line: CoverageLine): number {
  return (1 + FREQUENCY_TREND_PER_YEAR[line]) * (1 + SEVERITY_TREND_PER_YEAR[line])
    / (1 + EXPOSURE_GROWTH_PER_YEAR);
}

/** The recorded PAID age-to-ultimate factor for a line at an age in months. */
function recordedPaidLdf(line: CoverageLine, ageMonths: number): number {
  const rows = PAID_DEVELOPMENT_PATTERN[line];
  const exact = rows.find(r => r.ageMonths === ageMonths);
  if (exact) return exact.ldf;
  const last = rows[rows.length - 1];
  // ⚠ PAST THE PATTERN, THE LAST FACTOR, NOT A THROW. A throw is right for
  // `paidLdfAt`, whose caller is asking for a figure that does not exist. Here
  // the caller is a five-year window on a game that can run longer than a
  // pattern covers. With no tail (DEVELOPMENT_TAIL, stable-scenarios commit 3)
  // the last factor is 1: a year is developed to the END OF THE PATTERN, with
  // no tail factor beyond it.
  if (ageMonths > last.ageMonths) return last.ldf;
  // Younger than the first row cannot happen — the first row is 12 months and
  // a year is only priced once it has been valued — but a pattern that ever
  // started later must not silently develop by 1.0.
  return rows[0].ldf;
}

function exposureFor(basis: NewPurePremiumBasis, line: CoverageLine, ay: number): number {
  // ⚠ A BOOK'S LEDGER CARRIES ITS OWN EXPOSURE. With MEMBER_LEVEL off there is
  // no roster and no membership history to reconstruct an accident year's
  // exposure from, so each row records the exposure it was written on.
  const row = basis.rows.find(r => r.yearNumber === ay);
  if (row?.exposure !== undefined) return row.exposure;
  let e = 0;
  for (const m of basis.allMarketMembers) {
    if (!wasActiveInLine(basis.membershipHistory, m.id, line, ay)) continue;
    e += getMemberExposure(m, line, ay);
  }
  return e;
}

/**
 * The new pure premium for `line`, priced for `pricingYear`.
 *
 * Returns null when the window holds no usable accident year — no row with both
 * a ground-up paid figure and a known exposure. The caller shows nothing rather
 * than a number built on nothing.
 */
export function newPurePremiumPer100(
  line: CoverageLine, pricingYear: number, basis: NewPurePremiumBasis,
): NewPurePremiumResult | null {
  // THE WINDOW: the most recent five accident years. Taken from the rows the
  // caller supplies, newest last, so a caller that already windowed is not
  // double-windowed — it just takes the last five of five.
  const ordered = [...basis.rows].sort((a, b) => a.yearNumber - b.yearNumber);
  const windowed = ordered.slice(-PRICING_WINDOW_YEARS_NEW);

  const trendPerYear = lossCostTrendPerYear(line);
  const points: NewPurePremiumPoint[] = [];
  let skipped = 0;

  for (const r of windowed) {
    const gross = r.grossPaidByValuation ?? [];
    if (gross.length === 0) { skipped++; continue; }
    const groundUpPaid = gross[gross.length - 1];
    if (!(groundUpPaid > 0)) { skipped++; continue; }
    const exposure = exposureFor(basis, line, r.yearNumber);
    if (!(exposure > 0)) { skipped++; continue; }

    // Ledger ages are 0-based and the patterns are 1-based in MONTHS — the one
    // place the two clocks meet, converted here as pricingTriangle.ts converts
    // it: triangle age = ledger age + 1, months = that x 12.
    const ledgerAge = (r.ageAtFirstValuation ?? 0) + gross.length - 1;
    const ageMonths = (ledgerAge + 1) * 12;
    const ldf = recordedPaidLdf(line, ageMonths);
    const developed = groundUpPaid * ldf;
    const lossCostPer100 = developed / (exposure * 10_000);

    // Trend from the accident year to the year being priced.
    const years = pricingYear - r.yearNumber;
    const trendFactor = Math.pow(trendPerYear, years);

    points.push({
      accidentYear: r.yearNumber, ageMonths, groundUpPaid, ldf, developed, exposure,
      lossCostPer100, trendFactor, trendedLossCostPer100: lossCostPer100 * trendFactor,
    });
  }

  if (points.length === 0) return null;

  // EQUAL WEIGHTS — the parameter, and it is deliberate rather than a
  // simplification left for later. See PRICING_WINDOW_WEIGHTING_NEW.
  const lossCost = points.reduce((s, p) => s + p.trendedLossCostPer100, 0) / points.length;

  // ⚠ ALAE IS NOT ADDED WHERE IT IS ALREADY IN THE LOSSES. See
  // ALAE_ALREADY_IN_LOSSES — on GL the fitted severity mixture includes it, so
  // the parameter would be a second helping. ULAE is unallocated by definition
  // and is in no severity fit, so it is added on every line.
  const alae = ALAE_ALREADY_IN_LOSSES[line] ? 0 : lossCost * ALAE_OF_LOSS_COST[line];
  const ulae = lossCost * ULAE_OF_LOSS_COST[line];

  return {
    lossCostPer100: lossCost,
    alaePer100: alae,
    ulaePer100: ulae,
    purePremiumPer100: lossCost + alae + ulae,
    points,
    skipped,
  };
}

/**
 * THE SAME FIGURE BUILT FROM A LOSS COST IN HAND, for a book with no usable
 * history yet — the first years of the pre-game, before any accident year has
 * a ground-up paid figure. The loss cost is the new engine's own ex-ante
 * expectation, and ALAE and ULAE are added on exactly the rule above, so the
 * figure the rate is struck on has one shape whichever source it came from.
 */
export function newPurePremiumFromLossCost(line: CoverageLine, lossCostPer100: number): NewPurePremiumResult {
  const alae = ALAE_ALREADY_IN_LOSSES[line] ? 0 : lossCostPer100 * ALAE_OF_LOSS_COST[line];
  const ulae = lossCostPer100 * ULAE_OF_LOSS_COST[line];
  return {
    lossCostPer100, alaePer100: alae, ulaePer100: ulae,
    purePremiumPer100: lossCostPer100 + alae + ulae, points: [], skipped: 0,
  };
}

/**
 * A BOOK'S PURE PREMIUM — the ledger's figure, or, before the ledger has a
 * usable accident year, the new engine's own ex-ante expectation on the same
 * rule. One function, read by the engine and by the Decisions panel, so the
 * two cannot price a book differently.
 */
export function bookPurePremium(
  line: CoverageLine, pricingYear: number, basis: NewPurePremiumBasis, exposure: number,
): NewPurePremiumResult {
  return newPurePremiumPer100(line, pricingYear, basis)
    ?? newPurePremiumFromLossCost(line,
      expectedLossBreakdown(line, exposure, pricingYear).total / Math.max(exposure * 10_000, 1));
}
