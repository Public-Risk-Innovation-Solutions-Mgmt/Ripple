// ============================================================================
// EVENT LIKELIHOODS — the size of a single large (T) claim at 1 in 10, 20, 50,
// 100 and 200 years on a line, for the year being priced (wip/reinsurance-
// layers; the Rate Indication shows it beside the cover prices).
//
// Built from the T-shock assumptions' odds — the same chances the covers are
// priced on (T_COVER_FREQUENCY: Low 7.5%, Mid 5.25%, High 2.25% a year), NOT
// from the catalogue events the game fires (wip/large-claims-from-events:
// large claims come only from T-shock events; these odds price the covers and
// build this table). Each level's claim is spread evenly across its range
// (SHOCK_T_CLAIM_RANGE) x the priced year's growth factor — the factor the
// claims and the cover prices use (reinsuranceTower.pricedGrowthFactor). Then
//
//   P(a claim >= x in a year) = Σ over the levels of
//                               yearly chance x the share of its range above x
//
// and the size at 1 in N is the x where that equals 1/N (the levels exclude
// one another, so the chances add). The three total 15% a year, more than
// 1 in 10, so every return period has a size.
// ============================================================================

import { SHOCK_T_CLAIM_RANGE, T_COVER_FREQUENCY } from '../data/pricingParameters';
import type { CoverageLine } from '../types/simulation';

export const RETURN_PERIODS = [10, 20, 50, 100, 200] as const;

/** Each level on the line at the cover-pricing odds: its yearly chance and its claim range, grown by `g`. */
export function tEventsOn(line: CoverageLine, g: number): { chance: number; lo: number; hi: number }[] {
  return (['Low', 'Mid', 'High'] as const).map(lv => ({
    chance: T_COVER_FREQUENCY[lv], lo: SHOCK_T_CLAIM_RANGE[line][lv][0] * g, hi: SHOCK_T_CLAIM_RANGE[line][lv][1] * g,
  }));
}

/** The chance in a year of a single T claim at least `x`. */
export function chanceAtLeast(events: readonly { chance: number; lo: number; hi: number }[], x: number): number {
  return events.reduce((s, e) => s + e.chance * Math.min(1, Math.max(0, (e.hi - x) / (e.hi - e.lo))), 0);
}

/** The size at 1 in `n` years, or null where every T event together is rarer. */
export function sizeAtReturnPeriod(events: readonly { chance: number; lo: number; hi: number }[], n: number): number | null {
  const target = 1 / n;
  if (events.length === 0 || chanceAtLeast(events, 0) < target) return null;
  // Non-increasing in x: bisect on [0, the largest top] to a cent.
  let a = 0, b = Math.max(...events.map(e => e.hi));
  while (b - a > 0.01) {
    const m = (a + b) / 2;
    if (chanceAtLeast(events, m) >= target) a = m; else b = m;
  }
  return (a + b) / 2;
}

/** The Event Likelihoods for a line at growth factor `g`: one size (or null) per return period. */
export function eventLikelihoods(line: CoverageLine, g: number): { years: number; size: number | null }[] {
  const events = tEventsOn(line, g);
  return RETURN_PERIODS.map(years => ({ years, size: sizeAtReturnPeriod(events, years) }));
}
