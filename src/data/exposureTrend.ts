// THE EXPOSURE BASE'S OWN TREND — AND IT IS ZERO. PAYROLL AND TIV ARE LEVEL.
//
// The roster is FROZEN and stays frozen: member payroll and insured value in
// memberCatalog are permanent year-1-dollar figures. This module is the single
// read-time factor that rides on top of them, and it now returns 1 in every
// year on every line. The pool's exposure moves ONLY through underwriting —
// members joining, leaving, or changing what they buy.
//
// ===========================================================================
// ⚠ WHAT THIS REPLACED, AND WHY IT COULD NOT BE REMOVED ON ITS OWN.
// ===========================================================================
//
// Until this commit the factor grew at WAGE INFLATION, 3.63%/yr, on WC and GL
// and not on Property. That was half of a PAIR, and the file said so at
// length: WC severity grew 3.67% and GL severity 5.7026% precisely because
// their denominators were growing too. The quotient was the rate trend —
// WC -1.462%/yr, GL +2.00%/yr — and removing the denominator alone would have
// made WC's rate climb 2.115%/yr and GL's 5.70%/yr overnight.
//
// So both halves moved together. The severity side is now ONE RATE PER LINE,
// 5% on all three, in pricingParameters.ts; this side is zero. The sourcing
// that justified 3.63% (WCIRB indemnity benefits being a statutory share of
// wage, so the indemnity half of WC severity tracks wages by construction) is
// not refuted by any of this — it is simply no longer being modelled, because
// a rate per $100 of a base that trends is a quotient of two trends, and the
// pool's actual growth decisions were the smaller term in it.
//
// ⚠ A NAMED ZERO, NOT A DELETED MECHANISM. Every call site still routes through
// exposureFactor, so giving the base a trend again is a one-constant edit at
// EXPOSURE_GROWTH_PER_YEAR — and it must arrive paired with the severity side,
// exactly as before. The same discipline, now with the pair stated in one file.
//
// ⚠ PROPERTY'S BASE IS TIV AND INFLATES WITH CONSTRUCTION COST, NOT WAGES.
// That was the reason Property's switch was off while WC's and GL's were on.
// With the trend at zero the distinction has nothing to express, so the
// per-line switch is gone rather than kept as three copies of `false`. A future
// exposure trend that differs by line reintroduces it; one that does not, does
// not need it.

import type { CoverageLine } from '../types/simulation';

// ⚠ DEFINED IN pricingParameters.ts. Imported so this file can use it and
// re-exported so every existing import of the old name keeps resolving.
import { EXPOSURE_GROWTH_PER_YEAR as EXPOSURE_GROWTH_PARAM } from './pricingParameters';
export const EXPOSURE_GROWTH_PER_YEAR = EXPOSURE_GROWTH_PARAM;

/**
 * The cumulative exposure factor for a line and year. Live year 1 is the
 * reference (factor 1.0) and the pre-game FLOORS at year 1 rather than
 * deflating — see the note below, which outlives the trend being zero.
 *
 * ⚠ THE FLOOR IS LOAD-BEARING AND MUST SURVIVE THE TREND COMING BACK. The
 * pre-game is not a simulated history; it is an INITIAL-CONDITIONS GENERATOR,
 * three years run only to produce an opening balance sheet. Every dollar
 * constant that shapes it is in year-1 dollars — STARTING_FINANCIALS' premium
 * and surplus ranges, STARTING_CAPITAL_TO_PREMIUM, and the OPENING_SURPLUS_BAND
 * acceptance test that redraws the pre-game when the opening lands outside it.
 * Deflating exposure while those stay fixed silently re-rates the opening
 * position: measured, when it was tried, at a 5% lower starting surplus and
 * three fewer starting members, for no modelling gain. instanceGenerator pins
 * OPENING_EXPOSURE_YEAR to 1 for the same reason. The severity trends floor the
 * same way and must continue to, or a line's drawn and priced loss diverge
 * across exactly the years that set the opening reserves.
 *
 * ⚠ NO MEMOISATION ANY MORE, AND THAT IS NOT AN OVERSIGHT. The old body was a
 * Math.pow behind a per-line Map because it fired inside member-list loops at
 * seven call sites, several walking the 200-member market roster every year.
 * At a zero trend the body is a constant and a Map lookup would cost more than
 * the arithmetic it replaced. Restoring the trend restores the case for the
 * cache; memoizeByYear is still there and still takes the same floor key.
 */
export function exposureFactor(_line: CoverageLine, yearNumber: number): number {
  if (EXPOSURE_GROWTH_PER_YEAR === 0) return 1;
  return Math.pow(1 + EXPOSURE_GROWTH_PER_YEAR, Math.max(1, yearNumber) - 1);
}
