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
//   1. WINDOW       the five most recent COMPLETE accident years, EQUAL
//                   WEIGHTS, a year behind (PRICING_DATA_LAG_YEARS): the year
//                   priced reads the years ending two before it, valued as at
//                   the end of the latest of them
//   2. DEVELOPMENT  each year to the end of the pattern with the PAID LDFs at
//                   its age — the patterns the game reads, closed with no tail
//                   (DEVELOPMENT_TAIL), not factors estimated from the ledger
//   3. TREND        each year's loss cost to the year being priced, NET of
//                   exposure growth
//   4. ALAE + ULAE  ALAE at the mean of the window years' drawn ALAE ratios (the
//                   middle of the line's range before any history); ULAE the
//                   parameter's share of loss cost (claims). On WC and GL the
//                   claims are the supplied pure premium / (1 + ULAE), so loss
//                   cost + ULAE is the pure premium; ALAE is on top
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
  PRICING_WINDOW_YEARS_NEW, PRICING_DATA_LAG_YEARS,
  ALAE_OF_LOSS_COST, ULAE_OF_LOSS_COST,
  FREQUENCY_TREND_PER_YEAR, SEVERITY_TREND_PER_YEAR, EXPOSURE_GROWTH_PER_YEAR,
  CATASTROPHE_LOAD, CATASTROPHE_LOAD_STEADY_YEAR, SHOCKS_OUT_OF_EXPERIENCE,
} from '../data/pricingParameters';
import { bookedCostLevel } from './ordinaryLoss';
import { PAID_DEVELOPMENT_PATTERN } from '../data/paidDevelopmentPatterns';
import { expectedLossBreakdown } from './shockExpectation';
import { getMemberExposure } from './lineHelpers';
import { wasActiveInLine } from './membershipHistory';
import type {
  CoverageLine, Member, MembershipHistory, ReserveDevelopmentRow,
} from '../types/simulation';

/**
 * IS ALAE ALREADY IN THE LOSSES? ON NO LINE, SINCE THE PURE-PREMIUM BASIS.
 *
 * WC's and GL's losses are the pool's supplied pure premium, which EXCLUDES
 * ALAE (SUPPLIED_PURE_PREMIUM_INCLUDES_ULAE in pricingParameters.ts), and
 * Property's are loss only — so ALAE is added on top on every line, at
 * ALAE_OF_LOSS_COST.
 *
 * ⚠ GL WAS TRUE UNTIL THEN, AND THAT RULE CAME FROM THE OLD PER-CLAIM GL MODEL:
 * its fitted 3-component claim-size mixture included defence costs
 * (defaultAssumptions.ts, GL_SEVERITY_COMPONENTS). The live engine no longer
 * draws GL's losses from that mixture, so the rule no longer applied. The flag
 * stays, false everywhere, so a line whose losses do carry ALAE can say so.
 */
export const ALAE_ALREADY_IN_LOSSES: Readonly<Record<CoverageLine, boolean>> = {
  WC: false,
  GL: false,
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
  /** Age in months at the valuation priced on — the end of the latest data year. */
  ageMonths: number;
  /** Ground-up paid at that valuation, with the year's shock dollars taken out on the paid basis. */
  groundUpPaid: number;
  /** The shock dollars' paid to date that came out: the year's shock gross / the LDF. */
  shockPaid: number;
  ldf: number;
  developed: number;
  exposure: number;
  lossCostPer100: number;
  trendFactor: number;
  trendedLossCostPer100: number;
}

export interface NewPurePremiumResult {
  /** Loss cost only, trended, before ALAE and ULAE — the experience's, plus the catastrophe load. */
  lossCostPer100: number;
  /** The steady catastrophe load in it (catastropheLoadPer100); 0 with CATASTROPHE_LOAD off. */
  catastropheLoadPer100: number;
  alaePer100: number;
  /** The ALAE load as a share of the loss cost: the window years' mean drawn ratio, or the range's middle. */
  alaeRatio: number;
  /** The window years' drawn ALAE ratios, oldest first — what alaeRatio averages. */
  alaeRatios: number[];
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

/**
 * THE STEADY CATASTROPHE LOAD, per $100, for the year being priced
 * (stable-scenarios commit 7): the shocks' expected cost — the uplift on
 * ordinary losses and their large losses — at the catalogue's probabilities,
 * once every event's duration is in force (CATASTROPHE_LOAD_STEADY_YEAR), and
 * trended to the year at the line's booked cost level. Charged in every year,
 * the pre-game's included, in place of the shock dollars the experience no
 * longer carries. On the line's typical book (risk 1), on `exposure`.
 */
export function catastropheLoadPer100(line: CoverageLine, pricingYear: number, exposure: number): number {
  if (!CATASTROPHE_LOAD.enabled || !(exposure > 0)) return 0;
  const steady = CATASTROPHE_LOAD_STEADY_YEAR;
  const b = expectedLossBreakdown(line, exposure, steady);
  return ((b.uplift + b.shockLarge) / (exposure * 10_000))
    * bookedCostLevel(line, pricingYear) / bookedCostLevel(line, steady);
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
  // The exposure the catastrophe load is struck on — the book being priced.
  // Absent, the newest window year's own.
  loadExposure?: number,
): NewPurePremiumResult | null {
  // THE WINDOW: the five most recent COMPLETE accident years, a year behind
  // (PRICING_DATA_LAG_YEARS). The latest data year is the one before the year
  // just closed — 2025 when 2027 is priced — and the year in progress at the
  // opening (2026) is on the books but too new to price on. Taken from the rows
  // the caller supplies, so a caller that already windowed is not
  // double-windowed — it just takes the last five of five.
  const latestDataYear = pricingYear - 1 - PRICING_DATA_LAG_YEARS;
  const ordered = [...basis.rows]
    .filter(r => r.yearNumber <= latestDataYear)
    .sort((a, b) => a.yearNumber - b.yearNumber);
  const windowed = ordered.slice(-PRICING_WINDOW_YEARS_NEW);

  const trendPerYear = lossCostTrendPerYear(line);
  const points: NewPurePremiumPoint[] = [];
  let skipped = 0;

  for (const r of windowed) {
    const gross = r.grossPaidByValuation ?? [];
    if (gross.length === 0) { skipped++; continue; }
    // ⚠ VALUED AS AT THE END OF THE LATEST DATA YEAR, NOT THE LATEST VALUATION
    // ON THE LEDGER: the whole data set is a year old, so no payment made in
    // the year in progress is read, on any accident year. Index k is valuation
    // year firstValuationYear + k; clamped forward as actuarialMemo's seriesAt
    // is — a closed cohort stops recording and its last figure is final.
    const k = Math.min(latestDataYear - r.firstValuationYear, gross.length - 1);
    if (k < 0) { skipped++; continue; }
    const paidToDate = gross[k];
    if (!(paidToDate > 0)) { skipped++; continue; }
    const exposure = exposureFor(basis, line, r.yearNumber);
    if (!(exposure > 0)) { skipped++; continue; }

    // Ledger ages are 0-based and the patterns are 1-based in MONTHS — the one
    // place the two clocks meet, converted here as pricingTriangle.ts converts
    // it: triangle age = ledger age + 1, months = that x 12. The age is the
    // one at the valuation read, so the year develops from there.
    const ledgerAge = (r.ageAtFirstValuation ?? 0) + (latestDataYear - r.firstValuationYear);
    const ageMonths = (ledgerAge + 1) * 12;
    const ldf = recordedPaidLdf(line, ageMonths);
    // ⚠ THE SHOCK DOLLARS COME OUT ON THE PAID BASIS, BEFORE DEVELOPMENT
    // (stable-scenarios commit 7): the share of them paid by this age is
    // their booked gross / the LDF, which is what leaves paid-to-date. Shock R
    // development stays in: it is development, not the shock's own dollars.
    const shockPaid = SHOCKS_OUT_OF_EXPERIENCE.enabled ? (r.shockGross ?? 0) / ldf : 0;
    const groundUpPaid = Math.max(0, paidToDate - shockPaid);
    const developed = groundUpPaid * ldf;
    const lossCostPer100 = developed / (exposure * 10_000);

    // Trend from the accident year to the year being priced: to the latest
    // data year and then forward 1 + PRICING_DATA_LAG_YEARS years, which is
    // the same factor.
    const years = pricingYear - r.yearNumber;
    const trendFactor = Math.pow(trendPerYear, years);

    points.push({
      accidentYear: r.yearNumber, ageMonths, groundUpPaid, shockPaid, ldf, developed, exposure,
      lossCostPer100, trendFactor, trendedLossCostPer100: lossCostPer100 * trendFactor,
    });
  }

  if (points.length === 0) return null;

  // EQUAL WEIGHTS — the parameter, and it is deliberate rather than a
  // simplification left for later. See PRICING_WINDOW_WEIGHTING_NEW.
  // The experience, without its shocks, plus the steady catastrophe load.
  const catastropheLoad = catastropheLoadPer100(line, pricingYear, loadExposure ?? points[points.length - 1].exposure);
  const lossCost = points.reduce((s, p) => s + p.trendedLossCostPer100, 0) / points.length + catastropheLoad;

  // ⚠ ALAE IS NOT ADDED WHERE IT IS ALREADY IN THE LOSSES. See
  // ALAE_ALREADY_IN_LOSSES — no line, since the pure-premium basis. Its load is
  // the MEAN OF THE WINDOW YEARS' DRAWN ALAE RATIOS, as the ledger records them
  // (alaeRatio.ts; a row from before the draw reads the range's middle). ULAE
  // is at its share of the claims on every line: on WC and GL the claims are
  // the pure premium / (1 + ULAE), so claims + ULAE give the pure premium back.
  const alaeRatios = points.map(p => basis.rows.find(r => r.yearNumber === p.accidentYear)?.alaeRatio ?? ALAE_OF_LOSS_COST[line]);
  const alaeRatio = alaeRatios.reduce((a, b) => a + b, 0) / alaeRatios.length;
  const alae = ALAE_ALREADY_IN_LOSSES[line] ? 0 : lossCost * alaeRatio;
  const ulae = lossCost * ULAE_OF_LOSS_COST[line];

  return {
    lossCostPer100: lossCost,
    catastropheLoadPer100: catastropheLoad,
    alaePer100: alae,
    alaeRatio: ALAE_ALREADY_IN_LOSSES[line] ? 0 : alaeRatio,
    alaeRatios,
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
export function newPurePremiumFromLossCost(
  line: CoverageLine, lossCostPer100: number, catastropheLoad = 0,
): NewPurePremiumResult {
  // No history: ALAE at the middle of the line's range (ALAE_OF_LOSS_COST).
  const alae = ALAE_ALREADY_IN_LOSSES[line] ? 0 : lossCostPer100 * ALAE_OF_LOSS_COST[line];
  const ulae = lossCostPer100 * ULAE_OF_LOSS_COST[line];
  return {
    lossCostPer100, catastropheLoadPer100: catastropheLoad, alaePer100: alae,
    alaeRatio: ALAE_ALREADY_IN_LOSSES[line] ? 0 : ALAE_OF_LOSS_COST[line], alaeRatios: [], ulaePer100: ulae,
    purePremiumPer100: lossCostPer100 + alae + ulae, points: [], skipped: 0,
  };
}

/**
 * A BOOK'S PURE PREMIUM — the ledger's figure, or, before the ledger has a
 * usable accident year, the new engine's own ex-ante expectation on the same
 * rule. One function, read by the engine and by the Decisions panel, so the
 * two cannot price a book differently.
 *
 * ⚠ THE EXPECTATION IS THE BOOK'S OWN, AT ITS TRUE RISK (`bookRisk`, its
 * size-weighted mean — bookOrdinaryRisk / lineBookRisk), like every other
 * expected loss the engine reads. It first carried none, so the market's 1.0:
 * harmless while bulk years gave the ledger a history from the start, but
 * since the pool's history begins in 2021 this is what prices 2021, and 2022
 * then jumped by exactly the book's risk x the scenario's experience x trend.
 */
export function bookPurePremium(
  line: CoverageLine, pricingYear: number, basis: NewPurePremiumBasis, exposure: number,
  // The book's size-weighted true risk; 1 is the market's.
  bookRisk = 1,
): NewPurePremiumResult {
  if (!SHOCKS_OUT_OF_EXPERIENCE.enabled) {
    return newPurePremiumPer100(line, pricingYear, basis, exposure)
      ?? newPurePremiumFromLossCost(line,
        expectedLossBreakdown(line, exposure, pricingYear, undefined, bookRisk).total / Math.max(exposure * 10_000, 1));
  }
  // With no usable history: the ordinary expectation, plus the steady load when
  // it is on (0 off) — the shocks priced as the history prices them.
  const load = catastropheLoadPer100(line, pricingYear, exposure);
  return newPurePremiumPer100(line, pricingYear, basis, exposure)
    ?? newPurePremiumFromLossCost(line,
      expectedLossBreakdown(line, exposure, pricingYear, undefined, bookRisk).ordinary / Math.max(exposure * 10_000, 1) + load, load);
}
