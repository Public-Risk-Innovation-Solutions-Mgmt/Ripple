// ============================================================================
// THE NEW LOSS ENGINE'S ORDINARY LOSSES — one aggregate per line per year.
//
// Behind NEW_LOSS_ENGINE. See pricingParameters.ts for the parameters and
// docs/PENDING_MULTIPLAYER.md section 3 for the plan.
//
//   expected = exposure x EXPECTED_ORDINARY_LOSS_COST_PER_100 x (1 + trend)^(year - 1)
//   realised = expected x F,  F ~ lognormal with E[F] = 1 and CV = ORDINARY_LOSS_CV
//
// NO INDIVIDUAL CLAIMS. Ordinary losses are limited per claim at the line's
// lowest attachment, so they sit below every occurrence layer and cede
// nothing; there is therefore nothing a claim register would add, and the
// line books one accident-year cohort at full cost (see the engine).
//
// ⚠ EXPECTED IS THE MEAN OF THE DRAWS BY CONSTRUCTION. The year factor is a
// lognormal with mu = -sigma^2/2, so E[F] = 1 exactly, and `expected` is the
// one figure both the draw and every reader use — there is no separately held
// expectation that could drift away from what is drawn. ordinary-loss-check
// asserts the mean and the CV across many draws, and that it fails when either
// is broken.
//
// ⚠ ITS OWN LABELLED SUB-STREAM. `ordinary_<line>` off the instance seed and
// the year, never the sequential bootstrap, so a line's ordinary loss does not
// move when anything else draws more or less — and turning the flag on cannot
// re-roll a stream the flag-off path reads.
// ============================================================================

import {
  EXPECTED_ORDINARY_LOSS_COST_PER_100, ORDINARY_LOSS_CV, SEVERITY_TREND_PER_YEAR,
} from '../data/pricingParameters';
import { deriveSubRng, type SeededRandom } from './random';
import { bookExposureOf, getMemberExposure, type Book } from './lineHelpers';
import { primaryShare } from './memberExperienceMod';
import type { CoverageLine, Member, MemberLossResult } from '../types/simulation';

/** Expected ordinary loss per $100 of exposure in accident year `yearNumber`,
 *  trended at the line's severity trend from year 1 (backwards for the
 *  pre-game's negative years). */
export function ordinaryLossCostPer100(line: CoverageLine, yearNumber: number): number {
  return EXPECTED_ORDINARY_LOSS_COST_PER_100[line]
    * Math.pow(1 + SEVERITY_TREND_PER_YEAR[line], yearNumber - 1);
}

/** The lognormal's parameters for a mean-1 year factor with the given CV. */
export function ordinaryFactorParams(cv: number): { mu: number; sigma: number } {
  const sigma2 = Math.log(1 + cv * cv);
  return { mu: -sigma2 / 2, sigma: Math.sqrt(sigma2) };
}

/** One year factor. Pure in the stream it is handed. */
export function drawOrdinaryFactor(rng: SeededRandom, cv: number): number {
  const { mu, sigma } = ordinaryFactorParams(cv);
  return rng.lognormal(mu, sigma);
}

/** The stream a line's ordinary loss is drawn from. */
export const ordinaryLossRng = (seed: number, yearNumber: number, line: CoverageLine): SeededRandom =>
  deriveSubRng(seed, yearNumber, `ordinary_${line}`);

export interface OrdinaryLossYear {
  exposure: number;
  expected: number;
  realised: number;
  factor: number;
}

/** Draw a line's ordinary loss for one accident year on a given book. */
export function ordinaryLossYear(
  line: CoverageLine, book: Book, yearNumber: number, seed: number,
): OrdinaryLossYear {
  const exposure = bookExposureOf(book, line, yearNumber);
  const expected = exposure * 10_000 * ordinaryLossCostPer100(line, yearNumber);
  const factor = drawOrdinaryFactor(ordinaryLossRng(seed, yearNumber, line), ORDINARY_LOSS_CV[line]);
  return { exposure, expected, realised: expected * factor, factor };
}

/**
 * EACH MEMBER'S RECORD WHILE THE FLAG IS ON: its SHARE OF THE LINE'S EXPOSURE
 * of the line's ordinary figures.
 *
 * ⚠ AN INTERIM SHAPE, AND DELIBERATELY THE SMALLEST ONE. Members exist until
 * commit 4, and the ledgers that read them — loss history, renewal ranking,
 * the experience modifier, the appetite bar — need a record each year. Under
 * an aggregate engine there is no per-member draw to record, so each member
 * carries its exposure share of the line's actual and expected loss and
 * nothing is designed that commit 4 retires.
 *
 * The primary layer is scaled by the member's own analytic primary share, so
 * primaryActual / (expectedAtManual x primaryShare) reads the line's factor —
 * about 1.00 for everyone. The experience modifier therefore goes quiet under
 * the flag rather than reading noise, which is the honest statement of an
 * engine with no member-level variation. Risk selection stops affecting losses
 * under the flag for the same reason.
 *
 * Prospects get records on the same basis, from their own exposure, so a
 * member who joins arrives with a history rather than a blank.
 */
export function ordinaryMemberRecords(
  line: CoverageLine, members: Member[], yearNumber: number, costPer100: number, factor: number,
): MemberLossResult[] {
  return members.map(m => {
    const exposure = getMemberExposure(m, line, yearNumber);
    const expected = exposure * 10_000 * costPer100;
    const realised = expected * factor;
    const share = primaryShare(m, line, yearNumber);
    return {
      memberId: m.id,
      memberName: m.name,
      exposure,
      riskQuality: m.riskQuality,
      expectedLoss: expected,
      expectedLossAtManual: expected,
      primaryLoss: realised * share,
      coefficientOfVariation: ORDINARY_LOSS_CV[line],
      standardDeviation: expected * ORDINARY_LOSS_CV[line],
      simulatedLoss: realised,
    };
  });
}
