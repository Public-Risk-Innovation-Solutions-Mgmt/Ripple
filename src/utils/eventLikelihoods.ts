// ============================================================================
// EVENT LIKELIHOODS — the size of a single large (T) claim at 1 in 10, 20, 50,
// 100 and 200 years on a line, for the year being priced (wip/reinsurance-
// layers; the Rate Indication shows it beside the cover prices).
//
// Built from the game's own shock catalogue (shockLosses.SHOCK_EVENTS): each
// event with a T level on the line contributes its scaled yearly chance
// (`probability`, the catalogue's x SHOCK_CATALOGUE_SCALE), with its claim
// spread evenly across the level's range (SHOCK_T_CLAIM_RANGE) x the priced
// year's growth factor — the factor the claims and the cover prices use
// (reinsuranceTower.pricedGrowthFactor). Then
//
//   P(a claim >= x in a year) = Σ over the line's T events of
//                               yearly chance x the share of its range above x
//
// and the size at 1 in N is the x where that equals 1/N. Where every T event
// together is rarer than 1 in N, there is no such size: null.
// ============================================================================

import { SHOCK_T_CLAIM_RANGE } from '../data/pricingParameters';
import { SHOCK_EVENTS, eventLines, type ShockLevel } from './shockLosses';
import type { CoverageLine } from '../types/simulation';

export const RETURN_PERIODS = [10, 20, 50, 100, 200] as const;

/** Each T event on the line: its yearly chance and its claim range, grown by `g`. */
export function tEventsOn(line: CoverageLine, g: number): { chance: number; lo: number; hi: number }[] {
  const out: { chance: number; lo: number; hi: number }[] = [];
  for (const e of SHOCK_EVENTS) {
    const row = eventLines(e.name).find(r => r.line === line && r.t !== 'None');
    if (!row) continue;
    const [lo, hi] = SHOCK_T_CLAIM_RANGE[line][row.t as Exclude<ShockLevel, 'None'>];
    out.push({ chance: e.probability, lo: lo * g, hi: hi * g });
  }
  return out;
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
