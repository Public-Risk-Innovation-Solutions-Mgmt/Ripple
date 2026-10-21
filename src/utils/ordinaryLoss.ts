// ============================================================================
// THE NEW LOSS ENGINE'S ORDINARY LOSSES — the sum of the book's units.
//
// ⚠ FROM BOOK UNITS SINCE BOOK UNITS COMMIT 3 (ordinaryLossFromUnits). Each
// unit's expected loss is its exposure x its true risk x the line's cost, and
// each year it is that x the year factor every unit shares x its own factor,
// both mean-1 lognormals (the line's BASELINE_CV, UNIT_ORDINARY_OWN_CV). The
// line's ordinary loss is the sum. The header below describes the one-draw
// form it replaced, which ordinaryLossYear still draws for the member path.
//
// Part of the new loss engine, which runs whenever MEMBER_LEVEL is off. See pricingParameters.ts for the parameters and
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
  BASELINE_CV, EXPECTED_ORDINARY_LOSS_COST_PER_100, FLAT_PRE_GAME, SEVERITY_TREND_PER_YEAR, UNIT_MARKET_COUNT,
  UNIT_ORDINARY_OWN_CV, UNIT_POOL_SHARE, UNIT_RISK_CV, UNIT_SIZE_CV,
} from '../data/pricingParameters';
// ⚠ A CALL-TIME CYCLE, AND SAFE AS ONE: shockExpectation imports this module,
// and the routine fold it computes is read here only inside functions, never
// while either module is loading.
import { routineFoldPer100 } from './shockExpectation';
import type { BookUnit } from './bookUnits';
import { deriveSubRng, type SeededRandom } from './random';
import { bookExposureOf, getMemberExposure, type Book } from './lineHelpers';
import { primaryShare } from './memberExperienceMod';
import type { CoverageLine, Member, MemberLossResult } from '../types/simulation';

/** Expected ordinary loss per $100 of exposure in accident year `yearNumber`,
 *  trended at the line's severity trend from year 1 (backwards for the
 *  pre-game's negative years). */
export function ordinaryLossCostPer100(line: CoverageLine, yearNumber: number): number {
  // With ROUTINE_LARGE_LOSSES off, the routine claims' cost folded in,
  // cost-neutral (routineFoldPer100); zero with the switch on.
  return baseOrdinaryLossCostPer100(line, yearNumber) + routineFoldPer100(line, yearNumber);
}

/**
 * The ordinary cost per $100 WITHOUT the routine fold — the basis the shocks'
 * large losses (T) are scaled off (shockLosses' tScale), so folding the routine
 * cost into the ordinary losses does not grow them.
 */
export function baseOrdinaryLossCostPer100(line: CoverageLine, yearNumber: number): number {
  return EXPECTED_ORDINARY_LOSS_COST_PER_100[line]
    * Math.pow(1 + SEVERITY_TREND_PER_YEAR[line], yearNumber - 1);
}

/** A flat pre-game year (FLAT_PRE_GAME): ordinary losses at exactly expected, no factor drawn. */
export const flatPreGameYear = (yearNumber: number): boolean => FLAT_PRE_GAME.enabled && yearNumber <= 0;

/**
 * THE CV OF THE YEAR FACTOR A LINE'S UNITS SHARE — its BASELINE_CV, the same
 * value its funding table is chosen by (clfTables' STATIC_CLF_TABLE). One
 * definition, read by the draw and by baseline-cv-table-check.
 */
export const ordinaryYearCv = (line: CoverageLine): number => BASELINE_CV[line];

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

/**
 * THE LINE-LEVEL CV OF A TYPICAL BOOK'S ORDINARY LOSSES — sqrt((1+Y^2)(1+U^2 H) − 1),
 * Y the line's year CV
 * with H, the sum of the units' squared shares of expected loss, at its
 * expectation for a book of UNIT_POOL_SHARE x UNIT_MARKET_COUNT units of the
 * market's size and risk spread: (1 + size CV^2)(1 + risk CV^2) / n. About
 * 6.2% (WC), 8.1% (Property), 10.1% (GL); 2.47% on every line while the year
 * CV was 2%. For readers with no book in hand — the member path's records and
 * the aggregate's retained SD. A book's own is bookOrdinaryCv.
 */
export function typicalBookOrdinaryCv(line: CoverageLine): number {
  const h = (1 + UNIT_SIZE_CV ** 2) * (1 + UNIT_RISK_CV ** 2) / (UNIT_POOL_SHARE * UNIT_MARKET_COUNT);
  return Math.sqrt((1 + ordinaryYearCv(line) ** 2) * (1 + UNIT_ORDINARY_OWN_CV ** 2 * h) - 1);
}

/** A book's own line-level ordinary CV, from its units' shares of expected loss (exact for the two lognormals' product to first order). */
export function bookOrdinaryCv(units: readonly Pick<BookUnit, 'size' | 'risk'>[], line: CoverageLine): number {
  const e = units.map(u => u.size * u.risk);
  const total = e.reduce((a, b) => a + b, 0);
  const h = total > 0 ? e.reduce((a, x) => a + (x / total) ** 2, 0) : 0;
  // Var(F x sum w f) / mean^2 for independent mean-1 factors, exactly.
  const y2 = ordinaryYearCv(line) ** 2, u2 = UNIT_ORDINARY_OWN_CV ** 2;
  return Math.sqrt((1 + y2) * (1 + u2 * h) - 1);
}

/** The book's size-weighted mean true risk: what its expected ordinary loss carries over the line's cost. */
export function bookOrdinaryRisk(units: readonly Pick<BookUnit, 'size' | 'risk'>[]): number {
  const size = units.reduce((a, u) => a + u.size, 0);
  return size > 0 ? units.reduce((a, u) => a + u.size * u.risk, 0) / size : 1;
}

/** Draw a line's ordinary loss for one accident year on a given book — one draw at the line (the member path). */
export function ordinaryLossYear(
  line: CoverageLine, book: Book, yearNumber: number, seed: number,
): OrdinaryLossYear {
  const exposure = bookExposureOf(book, line, yearNumber);
  const expected = exposure * 10_000 * ordinaryLossCostPer100(line, yearNumber);
  const factor = flatPreGameYear(yearNumber) ? 1 : drawOrdinaryFactor(ordinaryLossRng(seed, yearNumber, line), typicalBookOrdinaryCv(line));
  return { exposure, expected, realised: expected * factor, factor };
}

/** The year's own factor for every unit of the market, in index order, from its own stream. */
export const unitOrdinaryRng = (seed: number, yearNumber: number, line: CoverageLine): SeededRandom =>
  deriveSubRng(seed, yearNumber, `ordinary_unit_${line}`);

export interface UnitOrdinaryYear extends OrdinaryLossYear {
  /** The book's size-weighted mean true risk — expected over exposure x cost. */
  risk: number;
  /** Per unit of the book: its expected and realised ordinary loss, in book order. */
  byUnit: { index: number; expected: number; realised: number }[];
}

/**
 * THE LINE'S ORDINARY LOSS FROM ITS UNITS — the year factor every unit shares
 * (the line's `ordinary_<line>` stream) times each unit's own (one draw per
 * MARKET unit, in index order, so a unit's factor does not depend on which
 * other units the book holds). Each unit's exposure is its size scaled to the
 * line's active exposure this year, so exposure trend — and, until units move
 * one by one, the book's scalar movement — reach every unit alike.
 */
export function ordinaryLossFromUnits(
  line: CoverageLine, units: readonly BookUnit[], activeExposure: number, yearNumber: number, seed: number,
  // THE NEW-BUSINESS PENALTY (book units commit 6): the units written this
  // year, whose ACTUAL loss carries 1 + `penalty` in this, their first year.
  // Their EXPECTED loss does not — see NEW_BUSINESS_PENALTY.
  newUnits: ReadonlySet<number> = new Set(), penalty = 0,
): UnitOrdinaryYear {
  const size = units.reduce((a, u) => a + u.size, 0);
  const scale = size > 0 ? activeExposure / size : 0;
  const cost = 10_000 * ordinaryLossCostPer100(line, yearNumber);
  // A flat pre-game year draws neither factor: every unit at exactly expected.
  const flat = flatPreGameYear(yearNumber);
  const year = flat ? 1 : drawOrdinaryFactor(ordinaryLossRng(seed, yearNumber, line), ordinaryYearCv(line));
  const own = unitOrdinaryRng(seed, yearNumber, line);
  const ownFactors = Array.from({ length: UNIT_MARKET_COUNT }, () => (flat ? 1 : drawOrdinaryFactor(own, UNIT_ORDINARY_OWN_CV)));
  const byUnit = units.map(u => {
    const expected = u.size * scale * u.risk * cost;
    const load = newUnits.has(u.index) ? 1 + penalty : 1;
    return { index: u.index, expected, realised: expected * year * ownFactors[u.index] * load };
  });
  const expected = byUnit.reduce((a, u) => a + u.expected, 0);
  const realised = byUnit.reduce((a, u) => a + u.realised, 0);
  return {
    exposure: activeExposure, expected, realised, factor: expected > 0 ? realised / expected : 1,
    risk: bookOrdinaryRisk(units), byUnit,
  };
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
      coefficientOfVariation: typicalBookOrdinaryCv(line),
      standardDeviation: expected * typicalBookOrdinaryCv(line),
      simulatedLoss: realised,
    };
  });
}
