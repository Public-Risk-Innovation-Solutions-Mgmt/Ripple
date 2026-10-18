// ============================================================================
// THE SET OPENING — BULK RESERVES FOR THE ACCIDENT YEARS OLDER THAN THE PRIOR
// HISTORY. RECORDED AND NOT YET WIRED.
//
// ⚠ THIS IS NOW THE OPENING. Commit (a) recorded the derivation unwired;
// commit (b) — this one — switched priorHistoryEngine over to it and retired
// the search, the band and the pin. Splitting the two is what let (b)'s
// baseline recapture attribute the whole movement to the opening.
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
//   - these cohorts open with no grossPaid / grossUnpaid, but they do NOT stay
//     that way and they are NOT skipped downstream — measured, not assumed.
//     recordReserveDevelopment opens a ledger row for each of them at the first
//     played valuation and writes `c.grossPaid ?? c.netPaid`, and processIbner
//     populates both gross fields from the net ones at the first step. So the
//     ground-up series exists for a bulk cohort and equals the net series,
//     which is right: these years are held net, and net IS their ground-up as
//     far as any series the game can still observe. recorded-payout-check reads
//     them at their own high ages; its section 3 never sees them, because that
//     section indexes from age 0 and a bulk row's first valuation is age 11+.
//   - the claims workbook has no rows for them. Its register-less path exists;
//     development-cession-check records that path as untested.
//   - reinsuranceRecovery and retainedAboveTower see nothing from them, which
//     is correct: the recoveries on those years were collected before the game
//     started and are already inside the net figure.
// ============================================================================

import type { CoverageLine, Member, ReserveCohort } from '../types/simulation';
import { PAID_DEVELOPMENT_PATTERN } from '../data/paidDevelopmentPatterns';
import { LINE_PAYOUT_PATTERN } from '../data/defaultAssumptions';
import { unpaidShare } from './payoutPattern';
import { staticClf, type StaticClfLine } from '../data/clfTables';
import {
  EXPOSURE_GROWTH_PER_YEAR, NEW_LOSS_ENGINE, OPENING_SURPLUS_MULTIPLE_OF_REQUIRED, PRIOR_HISTORY_YEARS,
  RESERVE_MARGIN_CONFIDENCE_PARAM, SEVERITY_TREND_PER_YEAR,
} from '../data/pricingParameters';
import { computeKLine, deriveNeutralPurePremiumPer100 } from './wcClaimEngine';
import { computeKGl, deriveNeutralGlPurePremiumPer100 } from './glClaimEngine';
import { computeKPr, deriveNeutralPropertyPurePremiumPer100 } from './propertyClaimEngine';
import { allLayerRiskMoments, expectedCededAtBoundsScale } from './towerMoments';
import { getPredefinedMarketMembers } from '../data/memberCatalog';
import { bookExposureOf, rosterOf, type Book } from './lineHelpers';
import { expectedLossBreakdown, newEngineLayerMoments } from './shockExpectation';
import { REINSURANCE_TOWER } from '../data/reinsuranceTower';
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
 * ⚠ THE SIZE, MEASURED IN DOLLARS RATHER THAN LEFT AS A DIRECTION. The bound
 * is tight because the true cession on a bulk year lies in [0, year-1 ratio]:
 *
 *   line      year-1 cession   bulk reserve as built   if cession were 0
 *   WC               23.63%                   $23.5M              $30.7M
 *   GL               41.47%                    $2.6M               $4.5M
 *   Property         32.68%                    $0.0M               $0.0M
 *
 * so the MAXIMUM understatement is $9.1M, 5.1% of the set opening reserve
 * total. The measured ratio against claim-size scale — WC 23.6% at 1.00x
 * rising to 45.8% at 1.55x — falls steeply enough that the oldest years are
 * near the zero end, so the true figure is nearer $9.1M than $0.
 *
 * ⚠ IT DOES NOT MOVE THE OPENING'S SHAPE, which is why it is recorded rather
 * than corrected here. Opening surplus is 2.28 x required and required is a
 * multiple of the reserve, so understating the reserve understates surplus by
 * the same proportion and the surplus/required RATIO the opening is set on is
 * unaffected. What is slightly low is the absolute scale of the oldest and
 * smallest cohorts.
 *
 * ⚠ THE CORRECTION IS SOUND ALGEBRA AND THE TOWER CANNOT EXPRESS IT AS BUILT.
 * Ceding a claim deflated by d to a layer [A, A+L] equals d x the cession of
 * the UNDEFLATED claim to [A/d, (A+L)/d] — so an older year is priceable by
 * scaling the layer bounds UP by (1.05)^age and scaling the answer back down.
 * The identity holds exactly. What is missing is an entry point: every
 * exported accessor here prices REINSURANCE_TOWER[line]'s FIXED bounds, and
 * the one function that takes bounds, bandMomentsForEdges, is private. Asking
 * at a LATER year scales the bounds the wrong way (claims inflate, so bounds
 * effectively shrink) and earlier years floor at 1. So the fix is one exported
 * bounds-taking accessor on towerMoments — small, but a reinsurance-module
 * change, and this commit is value-neutral by construction.
 */
/**
 * THE CESSION RATIO FOR A BULK ACCIDENT YEAR, AT ITS OWN COST LEVEL.
 *
 * ⚠ THIS REPLACES TAKING YEAR 1'S RATIO FOR EVERY AGE, which was recorded as a
 * known bias when the set opening landed and is corrected here. A fixed-dollar
 * attachment is further up a cheaper year's severity distribution, so an older
 * year cedes LESS — taking year 1's ratio overstated what those years ceded
 * and therefore UNDERSTATED their net reserve. Measured before the fix at up
 * to $9.1M, 5.1% of opening reserves, mostly WC.
 *
 * The bounds are scaled by (1 + severity trend)^age and the cession priced on
 * today's distributions; see expectedCededAtBoundsScale for the identity, and
 * for why the tower's year axis cannot be used instead (it clamps at year 1).
 *
 * ⚠ DIVIDED BY TODAY'S GROSS, NOT THE DEFLATED GROSS. The identity's 1/t and
 * the deflated year's own 1/t cancel; dividing the scaled cession by the
 * deflated gross would deflate twice and hand back year 1's ratio again.
 */
export function bulkCessionRatioAtAge(line: CoverageLine, members: Book, ageYears: number): number {
  // ⚠ UNDER NEW_LOSS_ENGINE, PRICED DIRECTLY AT THE BULK YEAR ITSELF. The
  // identity below rescales year 1's cession — but year 1 can carry shocks
  // and a bulk year cannot (nothing fires before year 1), so the new engine's
  // own figures for that year are read instead: routine large losses' cession
  // over their gross, and zero when that switch is off.
  if (NEW_LOSS_ENGINE.enabled) {
    const exposure = bookExposureOf(members, line, 1);
    const year = 1 - ageYears;
    const ceded = newEngineLayerMoments(line as TowerLine, exposure, year)
      .reduce((t, l, i) => t + (REINSURANCE_TOWER[line as TowerLine][i].purchasable ? l.expected : 0), 0);
    const gross = expectedLossBreakdown(line, exposure, year).total;
    return gross > 0 ? Math.min(0.95, ceded / gross) : 0;
  }
  const scale = Math.pow(1 + SEVERITY_TREND_PER_YEAR[line], ageYears);
  const ceded = expectedCededAtBoundsScale(line as TowerLine, rosterOf(members, 'bulkCessionRatioAtAge'), 1, scale);
  const grossToday = expectedGrossUltimateAtAge(line, 0, members);
  return grossToday > 0 ? Math.min(0.95, ceded / grossToday) : 0;
}

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
  line: CoverageLine, ageYears: number, members: Book,
): number {
  const exposure = bookExposureOf(members, line, 1);
  // ⚠ UNDER NEW_LOSS_ENGINE THE BULK YEARS ARE THE PRE-GAME'S KIND OF YEAR:
  // ordinary losses, plus routine large losses when that switch is on, and NO
  // SHOCKS — nothing fires before year 1, and the pre-game draws none. Read
  // straight off the engine's own expectation at the bulk year (1 - age),
  // which carries the trend back by itself.
  if (NEW_LOSS_ENGINE.enabled) return expectedLossBreakdown(line, exposure, 1 - ageYears).total;
  const rate = heldGrossPurePremiumPer100(line, rosterOf(members, 'expectedGrossUltimateAtAge'));
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
export function bulkOpeningCohorts(line: CoverageLine, members: Book): BulkCohortSpec[] {
  return bulkAccidentYearAges(line).map(ageYears => {
    // ⚠ PER AGE NOW, not one year-1 ratio for all of them. See
    // bulkCessionRatioAtAge for the bias this removes.
    const cession = bulkCessionRatioAtAge(line, members, ageYears);
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
export function bulkOpeningReserve(line: CoverageLine, members: Book): number {
  return bulkOpeningCohorts(line, members).reduce((a, c) => a + c.netUnpaid, 0);
}

// ============================================================================
// THE SET OPENING, APPLIED TO A LINE'S ENDING PRE-GAME STATE.
//
// ⚠ IT REPLACES THE SEED COHORTS AND LEAVES THE PLAYED ONES ALONE. The pre-game
// simulates PRIOR_HISTORY_YEARS of real accident years with claims behind them,
// and those cohorts stay exactly as they were simulated — pricing reads their
// history and the whole rebuild rests on it being real. What goes is the
// BOOTSTRAP's drawn seed cohorts, which were an apportionment of a drawn
// reserve total across three to five ages and are the thing the search existed
// to accept or reject. They are replaced by bulk cohorts derived from the
// patterns.
//
// ⚠ SURPLUS IS SET, NOT SEARCHED, AND REQUIRED CAPITAL IS THE RESERVE RISK
// MARGIN. See OPENING_SURPLUS_MULTIPLE_OF_REQUIRED for the denominator, which
// is stated there rather than here because the parameter is what a reader
// tunes. Setting it last means the pre-game's own profit does not reach the
// opening: whatever the declared years earned, the pool opens where the
// multiple says.
// ============================================================================

/** A bulk cohort in the engine's own shape. Seeded, claimless, net. */
export function bulkCohortsAsReserveCohorts(
  line: CoverageLine, members: Book, startingYear: number,
): ReserveCohort[] {
  return bulkOpeningCohorts(line, members).map(b => ({
    yearNumber: b.yearNumber,
    calendarYear: startingYear + b.yearNumber - 1,
    netUltimate: b.netUltimate,
    netPaid: b.netPaid,
    netUnpaid: b.netUnpaid,
    closed: false,
    seeded: true,
    // ⚠ registerSum IS THE ULTIMATE, exactly as instanceGenerator's seeds set
    // it: there is no claim register behind a bulk cohort, so the figure the
    // engine would otherwise sum from claims is the ultimate itself.
    registerSum: b.netUltimate,
    horizon: 0,
    age: b.ageYears,
    stepMultiplier: 1,
    bookingBias: 0,
  }));
}

/** Required capital for a line: the RESERVE RISK MARGIN on its net unpaid. */
export function requiredCapital(line: CoverageLine, netUnpaidReserve: number): number {
  return netUnpaidReserve * (staticClf(line as StaticClfLine, RESERVE_MARGIN_CONFIDENCE_PARAM) - 1);
}

/** Opening surplus for a line: the ruled multiple of its own required capital. */
export function setOpeningSurplus(line: CoverageLine, netUnpaidReserve: number): number {
  return OPENING_SURPLUS_MULTIPLE_OF_REQUIRED * requiredCapital(line, netUnpaidReserve);
}
