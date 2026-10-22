// ============================================================================
// THE OPENING'S CAPITAL — what a line must hold at the start of year 1.
//
// ⚠ THERE ARE NO BULK RESERVES ANY MORE: THE POOL'S HISTORY BEGINS IN 2021.
// This file used to derive BULK cohorts — reserves for accident years older
// than the pre-game (2016-2020 on WC and GL, 2019-2020 on Property), with no
// claim register, held net and paying down on the recorded patterns — inside a
// window of OPENING_RESERVE_YEARS, and put them on the books at the pre-game's
// start (preGameBulkYears) so pricing's window was full from the first year.
// Those years were imaginary, and they are retired with the window: the
// pre-game starts on its paid-in capital with no reserves (priorHistoryEngine),
// and the opening's reserve is only what 2021 on left behind.
// ============================================================================

import type { CoverageLine } from '../types/simulation';
import { staticClf, type StaticClfLine } from '../data/clfTables';
import { newLossEngineRuns, RESERVE_MARGIN_CONFIDENCE_PARAM } from '../data/pricingParameters';
import { bookExposureOf, rosterOf, type Book } from './lineHelpers';
import { newEngineCatCapital } from './shockExpectation';
import { catCapitalRetained } from './propertyCatastrophe';
import { defaultReinsuranceOption, placementFor } from './reinsuranceOptions';

/** Required capital for a line: the RESERVE RISK MARGIN on its net unpaid — x (CLF90 - 1) off the line's own BaselineCV table. */
export function requiredCapital(line: CoverageLine, netUnpaidReserve: number): number {
  return netUnpaidReserve * (staticClf(line as StaticClfLine, RESERVE_MARGIN_CONFIDENCE_PARAM) - 1);
}

/**
 * THE RETAINED-CATASTROPHE CHARGE THE LINE OPENS WITH — the second term of its
 * full requirement, on the opening book, at year 1, behind the default
 * package the prior board bought. The SAME expression the engine charges in
 * every year (simulationEngine's catCapitalNeeded): zero on WC and GL, which
 * have no catastrophe band.
 */
export function openingCatCapital(line: CoverageLine, members: Book, shocks = true): number {
  const placed = placementFor(line, defaultReinsuranceOption(line, shocks));
  return newLossEngineRuns()
    ? newEngineCatCapital(line, bookExposureOf(members, line, 1), 1, placed, defaultReinsuranceOption(line, shocks), shocks)
    : catCapitalRetained(line, [...rosterOf(members, 'openingCatCapital')], placed);
}

// ⚠ setOpeningSurplus IS GONE (stable-scenarios commit 9). It returned
// OPENING_SURPLUS, $35M on every line; the opening is now the scenario's — the
// line's year-1 premium at Expected / its premium-to-surplus ratio — set in
// priorHistoryEngine's applySetOpening.
