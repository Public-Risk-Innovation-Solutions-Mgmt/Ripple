// ============================================================================
// THE NEW LOSS ENGINE'S ORDINARY LOSSES — the sum of the book's 100 members.
//
// ⚠ FROM 100 EQUAL MEMBERS SINCE SIMPLE UNDERWRITING (ordinaryLossFromMembers).
// Each member's expected loss is its 1/100 share of the line's, and each year
// it is that x the year factor every member shares x its own luck, both mean-1
// lognormals (the line's BASELINE_CV, MEMBER_LUCK_CV). The line's ordinary
// loss is the sum. (Book units — unequal sizes and risks — came before.)
// The header below describes the one-draw
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
  BASELINE_CV, EXPECTED_ORDINARY_LOSS_COST_PER_100, FLAT_PRE_GAME, MEMBER_LUCK_CV, MEMBER_RISK_CV, SEVERITY_TREND_PER_YEAR,
  SHOCK_T_BASIS_PER_100, UNDERWRITING_MEMBERS,
} from '../data/pricingParameters';
// ⚠ A CALL-TIME CYCLE, AND SAFE AS ONE: shockExpectation imports this module,
// and the routine fold it computes is read here only inside functions, never
// while either module is loading.
import { routineFoldPer100 } from './shockExpectation';
import { upFrontTrendFactor } from '../data/paidDevelopmentPatterns';
import { deriveSubRng, type SeededRandom } from './random';
import { bookExposureOf, getMemberExposure, type Book } from './lineHelpers';
import { primaryShare } from './memberExperienceMod';
import type { CoverageLine, Member, MemberLossResult } from '../types/simulation';

/** Expected ordinary loss per $100 of exposure in accident year `yearNumber`,
 *  at its booked cost level: trended at the line's severity trend from year 1
 *  (backwards for the pre-game's negative years), with the inflation before
 *  payment booked up front. */
export function ordinaryLossCostPer100(line: CoverageLine, yearNumber: number): number {
  // With ROUTINE_LARGE_LOSSES off, the routine claims' cost folded in,
  // cost-neutral (routineFoldPer100); zero with the switch on.
  return baseOrdinaryLossCostPer100(line, yearNumber) + routineFoldPer100(line, yearNumber);
}

/**
 * THE COST LEVEL an accident year is booked at, relative to year 1's base: the
 * line's severity trend to the accident year, times the inflation the year's
 * losses suffer up to reporting, booked up front (upFrontTrendFactor —
 * stable-scenarios commit 3). Ordinary losses, the shocks' uplift on them and
 * their large losses all read it, so the whole accident year carries it.
 */
export function bookedCostLevel(line: CoverageLine, yearNumber: number): number {
  return Math.pow(1 + SEVERITY_TREND_PER_YEAR[line], yearNumber - 1) * upFrontTrendFactor(line);
}

/** The ordinary cost per $100 WITHOUT the routine fold. */
export function baseOrdinaryLossCostPer100(line: CoverageLine, yearNumber: number): number {
  return EXPECTED_ORDINARY_LOSS_COST_PER_100[line] * bookedCostLevel(line, yearNumber);
}

/**
 * The cost per $100 the shocks' large losses (T) are scaled off (shockLosses'
 * tScale), at the same booked cost level as the ordinary cost: SHOCK_T_BASIS_PER_100 — the $0 – $1M
 * layer on WC and GL, Property's cost without the routine fold — so neither the
 * fold nor the $1M – $5M layer grows the shocks.
 */
export function shockBasisCostPer100(line: CoverageLine, yearNumber: number): number {
  return SHOCK_T_BASIS_PER_100[line] * bookedCostLevel(line, yearNumber);
}

/**
 * A flat pre-game year (FLAT_PRE_GAME): ordinary losses at exactly expected, no factor drawn. `flat` is the
 * run's own choice.
 */
export const flatPreGameYear = (yearNumber: number, flat: boolean = FLAT_PRE_GAME.enabled): boolean => flat && yearNumber <= 0;

/**
 * THE PRE-GAME'S OWN STREAMS. A simulated pre-game year (FLAT_PRE_GAME off)
 * draws on labels of its own, from the game's seed — so every team in a room,
 * and any takeover, inherits the identical history, and the played years'
 * streams (the unprefixed labels) are untouched by it.
 */
const streamLabel = (yearNumber: number, label: string): string => (yearNumber <= 0 ? `pregame_${label}` : label);

// ⚠ NO SCENARIO MULTIPLE ON THE PRE-GAME'S LOSSES (fixed-seed scenarios): its
// years are drawn at true cost, exactly as a played year's. A scenario's record
// is its fixed seed's (SCENARIO_SEEDS), not a scaling.

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
  deriveSubRng(seed, yearNumber, streamLabel(yearNumber, `ordinary_${line}`));

export interface OrdinaryLossYear {
  exposure: number;
  expected: number;
  realised: number;
  factor: number;
  /** The year factor every member shares — the line's draw before each member's luck. Absent on the one-draw member path. */
  yearFactor?: number;
}

/**
 * THE LINE-LEVEL CV OF THE BOOK'S ORDINARY LOSSES —
 * sqrt((1+Y^2)(1 + ((1+U^2)(1+R^2) − 1)/n) − 1), Y the line's year CV, U the
 * members' luck CV, R their yearly risk score's CV, n UNDERWRITING_MEMBERS
 * equal members: 6.8% (WC), 8.6% (Property), 10.5% (GL); 6.1% / 8.0% / 10.0%
 * before member risk. Exact for the product of independent mean-1 factors.
 * Read by the member path's records and the aggregate's retained SD.
 */
export function typicalBookOrdinaryCv(line: CoverageLine): number {
  const member = (1 + MEMBER_LUCK_CV ** 2) * (1 + MEMBER_RISK_CV ** 2) - 1;
  return Math.sqrt((1 + ordinaryYearCv(line) ** 2) * (1 + member / UNDERWRITING_MEMBERS) - 1);
}

/** Draw a line's ordinary loss for one accident year on a given book — one draw at the line (the member path). */
export function ordinaryLossYear(
  line: CoverageLine, book: Book, yearNumber: number, seed: number,
  // Whether a pre-game year runs flat (flatPreGameYear).
  flat: boolean = FLAT_PRE_GAME.enabled,
): OrdinaryLossYear {
  const exposure = bookExposureOf(book, line, yearNumber);
  const expected = exposure * 10_000 * ordinaryLossCostPer100(line, yearNumber);
  const factor = flatPreGameYear(yearNumber, flat) ? 1
    : drawOrdinaryFactor(ordinaryLossRng(seed, yearNumber, line), typicalBookOrdinaryCv(line));
  return { exposure, expected, realised: expected * factor, factor };
}

/** The stream every member's luck is drawn from, in member order. */
export const memberLuckRng = (seed: number, yearNumber: number, line: CoverageLine): SeededRandom =>
  deriveSubRng(seed, yearNumber, streamLabel(yearNumber, `ordinary_member_${line}`));

/**
 * The stream every member's risk score is drawn from, in member order — off
 * the GAME's seed (marketSeedOf), so every world holds the same scores.
 */
export const memberRiskRng = (gameSeed: number, yearNumber: number, line: CoverageLine): SeededRandom =>
  deriveSubRng(gameSeed, yearNumber, streamLabel(yearNumber, `member_risk_${line}`));

export interface MemberOrdinaryYear extends OrdinaryLossYear {
  /** Underwriting's one-year factor on the loss per unit (BookMovement.lossFactor); 1 unmoved. */
  lossFactor: number;
  /** Each member's luck, in member order — UNDERWRITING_MEMBERS of them. */
  luck: number[];
  /** Each member's risk score this year, in member order — the game's, the same in every world. */
  risk: number[];
}

/**
 * THE LINE'S ORDINARY LOSS FROM ITS 100 EQUAL MEMBERS — the year factor every
 * member shares (the line's `ordinary_<line>` stream) times each member's
 * risk score this year (`member_risk_<line>` off the GAME's seed,
 * MEMBER_RISK_CV) and its own luck (`ordinary_member_<line>`, the world's),
 * one draw each per member, on each member's equal share of exposure x cost x
 * underwriting's `lossFactor`:
 *
 *   realised = exposure x cost x lossFactor x F x mean(risk x luck)
 *
 * ⚠ `expected` IS PRICING'S — exposure x cost, WITHOUT lossFactor — so the
 * year's actual over expected shows what underwriting did, as the old
 * new-business penalty did. The mean of the draws is expected x lossFactor.
 */
export function ordinaryLossFromMembers(
  line: CoverageLine, activeExposure: number, yearNumber: number, seed: number,
  lossFactor = 1,
  // Whether a pre-game year runs flat (flatPreGameYear).
  flatRun: boolean = FLAT_PRE_GAME.enabled,
  // The GAME's seed (marketSeedOf), which the risk scores are drawn from so
  // every world shares them. Absent: `seed` — the same thing in a one-world game.
  gameSeed: number = seed,
): MemberOrdinaryYear {
  const expected = activeExposure * 10_000 * ordinaryLossCostPer100(line, yearNumber);
  // A flat pre-game year draws neither factor: every member at exactly expected.
  const flat = flatPreGameYear(yearNumber, flatRun);
  const year = flat ? 1 : drawOrdinaryFactor(ordinaryLossRng(seed, yearNumber, line), ordinaryYearCv(line));
  const own = memberLuckRng(seed, yearNumber, line);
  const luck = Array.from({ length: UNDERWRITING_MEMBERS }, () => (flat ? 1 : drawOrdinaryFactor(own, MEMBER_LUCK_CV)));
  // A flat pre-game year draws no risk either: every member at 1.
  const riskRng = memberRiskRng(gameSeed, yearNumber, line);
  const risk = Array.from({ length: UNDERWRITING_MEMBERS }, () => (flat ? 1 : drawOrdinaryFactor(riskRng, MEMBER_RISK_CV)));
  const share = expected * lossFactor / UNDERWRITING_MEMBERS;
  const realised = luck.reduce((a, f, i) => a + share * year * risk[i] * f, 0);
  return {
    exposure: activeExposure, expected, realised, factor: expected > 0 ? realised / expected : 1, yearFactor: year,
    lossFactor, luck, risk,
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
