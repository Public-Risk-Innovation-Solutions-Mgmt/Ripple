// ============================================================================
// THE SET OPENING — BULK RESERVES FOR THE ACCIDENT YEARS OLDER THAN THE PRIOR
// HISTORY. RECORDED AND NOT YET WIRED.
//
// ⚠ NOTHING READS THIS FILE. Commit (a) of the opening rebuild builds the
// derivation and leaves the pre-game SEARCH live; commit (b) switches the
// opening over to it and retires the search, the pin and their gates. Keeping
// the two apart is what makes (a) value-neutral — every baseline holds by
// construction, so (b)'s recapture attributes the whole movement to the
// opening and nothing else.
//
// ============================================================================
// WHY BULK COHORTS EXIST AT ALL.
//
// A pool that has been operating does not start with ten accident years of
// claims on its books and nothing behind them. It starts with a RUNOFF: every
// accident year it ever wrote that has not finished paying. WC's recorded paid
// pattern says a year is still 9.04% unpaid at 37 years, so a real WC book
// carries 37 open accident years, not 10.
//
// The prior history supplies the newest PRIOR_HISTORY_YEARS of those as REAL
// simulated years with claims behind them, because pricing reads their loss
// history. Everything older is a BULK COHORT: a reserve with no claim register,
// paying down on the same recorded pattern as everything else.
//
// ⚠ THE MECHANISM ALREADY EXISTS AND IS NOT NEW HERE. instanceGenerator has
// always written `seeded: true` cohorts with `registerSum` set to the ultimate
// and no `developingClaims`, and processIbner pays a cohort from its own
// netUnpaid and the line's pattern without consulting a single claim. What is
// new is deriving HOW MANY and HOW LARGE from the patterns rather than
// apportioning a drawn total across three to five of them.
//
// ============================================================================
// ⚠ BULK COHORTS ARE HELD NET, AND THAT IS A RULING WITH A CONSEQUENCE.
//
// Reinsurance cession fires at INCEPTION, on the occurrences an accident year
// actually produced (cedeOccurrences in simulationEngine). A bulk cohort has no
// occurrences, so there is no inception event for the tower to respond to and
// nothing for it to cede later either — development cession is zero under
// full-cost booking on every cohort, bulk or not.
//
// So a bulk cohort's reserve must already be NET: it is what the POOL owes
// after the reinsurance its accident year bought. Holding it gross and
// expecting a recovery that no mechanism will ever produce would overstate the
// opening balance sheet by the whole ceded share.
//
// What that costs, stated rather than discovered later:
//   - these cohorts carry no grossPaid / grossUnpaid, so recorded-payout-check
//     SKIPS them (it reads the ground-up series by design and a row without one
//     is skipped, never substituted). The played years still populate it.
//   - the claims workbook has no rows for them. Its register-less path exists;
//     development-cession-check records that path as untested.
//   - reinsuranceRecovery and retainedAboveTower see nothing from them, which
//     is correct: the recoveries on those years were collected before the game
//     started and are already inside the net figure.
// ============================================================================

import type { CoverageLine, Member } from '../types/simulation';
import { PAID_DEVELOPMENT_PATTERN } from '../data/paidDevelopmentPatterns';
import { LINE_PAYOUT_PATTERN } from '../data/defaultAssumptions';
import { unpaidShare } from './payoutPattern';
import {
  EXPOSURE_GROWTH_PER_YEAR, PRIOR_HISTORY_YEARS, SEVERITY_TREND_PER_YEAR,
} from '../data/pricingParameters';
import { computeKLine, deriveNeutralPurePremiumPer100 } from './wcClaimEngine';
import { computeKGl, deriveNeutralGlPurePremiumPer100 } from './glClaimEngine';
import { computeKPr, deriveNeutralPropertyPurePremiumPer100 } from './propertyClaimEngine';
import { allLayerRiskMoments } from './towerMoments';
import { getPredefinedMarketMembers } from '../data/memberCatalog';
import { getMemberExposure } from './lineHelpers';
import type { TowerLine } from '../data/reinsuranceTower';

/** The last age a line's recorded PAID pattern reaches, in whole years. */
export function patternLengthYears(line: CoverageLine): number {
  const rows = PAID_DEVELOPMENT_PATTERN[line];
  return rows[rows.length - 1].ageMonths / 12;
}

/**
 * The ages, in years, of the accident years held as BULK cohorts at the
 * opening — everything older than the prior history, out to the pattern's end.
 *
 * ⚠ THE FULL PATTERN LENGTH, BY RULING: WC 37 years, GL 21, Property 11.
 * Truncating earlier would discard real reserve rather than a rounding: WC is
 * still 9.04% unpaid at its last age, and its newest 25 accident years hold
 * only 95% of its steady-state reserve.
 */
export function bulkAccidentYearAges(line: CoverageLine): number[] {
  const out: number[] = [];
  for (let a = PRIOR_HISTORY_YEARS + 1; a <= patternLengthYears(line); a++) out.push(a);
  return out;
}

/**
 * The share of an accident year's ultimate still unpaid at `ageYears`.
 *
 * ⚠ IT DELEGATES TO THE ENGINE'S OWN unpaidShare RATHER THAN RECOMPUTING
 * 1 - 1/LDF, AND A FIRST VERSION THAT RECOMPUTED IT WAS WRONG AT THE LAST AGE.
 * It read `age >= patternLength ? 0`, which puts WC's 37-year cohort at zero;
 * the pattern's LAST ROW is age 37 and still holds 9.04%, and the cohort is
 * finished only from 38. That is a 9%-of-ultimate error on the oldest cohorts,
 * in the direction of understating the opening — and it is exactly the kind of
 * second description of one fact this project keeps finding. One definition.
 */
export function unpaidShareAtAge(line: CoverageLine, ageYears: number): number {
  return unpaidShare(LINE_PAYOUT_PATTERN[line], ageYears);
}

/**
 * The line's rate trend per year — severity over exposure growth. Both are
 * read from the parameters so this cannot drift from what the engine draws and
 * prices on.
 */
export function rateTrendPerYear(line: CoverageLine): number {
  return (1 + SEVERITY_TREND_PER_YEAR[line]) / (1 + EXPOSURE_GROWTH_PER_YEAR) - 1;
}

/** The held GROSS pure premium per $100 at LIVE YEAR 1's level, mix-corrected. */
export function heldGrossPurePremiumPer100(line: CoverageLine, members: Member[]): number {
  const roster = getPredefinedMarketMembers();
  if (line === 'WC') return deriveNeutralPurePremiumPer100(roster) * computeKLine(members);
  if (line === 'GL') return deriveNeutralGlPurePremiumPer100(roster) * computeKGl(members, 1);
  return deriveNeutralPropertyPurePremiumPer100(roster) * computeKPr(members);
}

/**
 * The share of a line's GROSS expected loss the tower takes, at year 1.
 *
 * ⚠ IT IS A YEAR-1 RATIO APPLIED TO EVERY OLDER YEAR, AND THAT IS A KNOWN
 * BIAS WITH A KNOWN DIRECTION. Attachments are fixed in dollars and older
 * accident years are smaller in nominal terms, so they genuinely pierce the
 * tower LESS and cede a SMALLER share than year 1 does. Using year 1's ratio
 * therefore OVERSTATES cession on the older years and so UNDERSTATES their net
 * reserve — conservative in the direction that matters least, since those are
 * the smallest cohorts.
 *
 * It is a year-1 ratio because there is no API for any other: every severity
 * trend floors at year 1 (see wageFactor's header for why the pre-game pins
 * there), so allLayerRiskMoments cannot be asked for a deflated level. The
 * honest fix is a trend argument on the tower, which is a reinsurance change
 * and not this commit's. opening-reserves-report MEASURES the size of the bias
 * by reading the ratio at year 1 against year 10.
 */
export function towerCessionRatio(line: CoverageLine, members: Member[], yearNumber = 1): number {
  if (line === 'Property') {
    // Property's cat band is not a per-occurrence layer in the same sense and
    // its one layer runs to $1B; the attritional ratio is what the others are.
    const layers = allLayerRiskMoments(line as TowerLine, members, yearNumber);
    const ceded = layers.reduce((a, l) => a + l.expected, 0);
    const gross = expectedGrossUltimateAtAge(line, 0, members);
    return gross > 0 ? Math.min(0.95, ceded / gross) : 0;
  }
  const layers = allLayerRiskMoments(line as TowerLine, members, yearNumber);
  const ceded = layers.reduce((a, l) => a + l.expected, 0);
  const gross = expectedGrossUltimateAtAge(line, 0, members);
  return gross > 0 ? Math.min(0.95, ceded / gross) : 0;
}

/**
 * The GROSS expected ultimate for an accident year `ageYears` years before
 * live year 1, in that year's own dollars.
 *
 *   held rate per $100 at year 1  x  exposure  x  10,000  /  (1 + trend)^age
 *
 * ⚠ THE EXPOSURE TERM DOES NOT MOVE WITH THE YEAR, and that is the level
 * exposure base rather than an omission. EXPOSURE_GROWTH_PER_YEAR is zero, so
 * every accident year is written on the same payroll and TIV; only severity
 * differs between them. If the base ever trends again this needs that year's
 * own exposure, and the divisor below is where it goes.
 */
export function expectedGrossUltimateAtAge(
  line: CoverageLine, ageYears: number, members: Member[],
): number {
  let exposure = 0;
  for (const m of members) exposure += getMemberExposure(m, line, 1);
  const rate = heldGrossPurePremiumPer100(line, members);
  return (rate * exposure * 10_000) / Math.pow(1 + rateTrendPerYear(line), ageYears);
}

export interface BulkCohortSpec {
  /** yearNumber of the accident year — negative, counting back from live year 1. */
  yearNumber: number;
  ageYears: number;
  ageMonths: number;
  /** NET of the reinsurance that accident year bought. See this file's header. */
  netUltimate: number;
  netUnpaid: number;
  netPaid: number;
}

/**
 * Every bulk cohort a line opens with, newest first.
 *
 * Each is its accident year's expected NET ultimate times the share its own
 * age says is still unpaid — the same recorded pattern the engine pays on and
 * pricing develops with, which is the whole point of the rebuild.
 */
export function bulkOpeningCohorts(line: CoverageLine, members: Member[]): BulkCohortSpec[] {
  const cession = towerCessionRatio(line, members);
  return bulkAccidentYearAges(line).map(ageYears => {
    const netUltimate = expectedGrossUltimateAtAge(line, ageYears, members) * (1 - cession);
    const unpaidShare = unpaidShareAtAge(line, ageYears);
    const netUnpaid = netUltimate * unpaidShare;
    return {
      yearNumber: 1 - ageYears,
      ageYears,
      ageMonths: ageYears * 12,
      netUltimate,
      netUnpaid,
      netPaid: netUltimate - netUnpaid,
    };
  });
}

/** The total bulk reserve a line opens with. */
export function bulkOpeningReserve(line: CoverageLine, members: Member[]): number {
  return bulkOpeningCohorts(line, members).reduce((a, c) => a + c.netUnpaid, 0);
}
