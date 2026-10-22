// ============================================================================
// THE ROOM'S MARKET SHARES — one pure function, called by both transports.
//
// What it measures and when it is stored are on RoomMarketShares (contract.ts).
// This file is the arithmetic and the completeness rule, written once so the
// localStorage transport and the DynamoDB one cannot disagree: the contract
// harness runs one set of assertions at both.
// ============================================================================

import type { CoverageLine } from '../types/simulation';
import type { RoomMarketShares, TeamMarketShare, TeamYearSummary } from './contract';

/** One team as the share needs it — whatever the transport stores it as. */
export interface ShareTeam {
  name: string;
  /** Did this team lock in decisions for the year being worked out? */
  lockedYear: boolean;
  /** Every result it has posted, keyed by year as a string. */
  results: Record<string, TeamYearSummary>;
}

/** The newest posted result at or before `year` — a stopped team's last figures. */
function lastAtOrBefore(results: Record<string, TeamYearSummary>, year: number): TeamYearSummary | undefined {
  let best: number | null = null;
  for (const k of Object.keys(results)) {
    const y = Number(k);
    if (Number.isFinite(y) && y <= year && (best === null || y > best)) best = y;
  }
  return best === null ? undefined : results[String(best)];
}

/**
 * The shares for `year`, or null when the set is not complete yet.
 *
 *   year 0   every team that has posted its opening position.
 *   year Y   complete once every team that LOCKED year Y has posted year Y.
 *            Those teams count on their year-Y figures; every other team (it
 *            stopped) on its newest result at or before Y. A team with no
 *            result at all is not in the totals.
 */
export function roomSharesFor(year: number, teams: ShareTeam[], lines: CoverageLine[]): RoomMarketShares | null {
  const figures: Array<{ name: string; s: TeamYearSummary }> = [];
  for (const t of teams) {
    if (year === 0) {
      const s = t.results['0'];
      if (s) figures.push({ name: t.name, s });
      continue;
    }
    if (t.lockedYear) {
      const s = t.results[String(year)];
      if (!s) return null;   // locked in and not yet posted: waited for
      figures.push({ name: t.name, s });
    } else {
      const s = lastAtOrBefore(t.results, year);
      if (s) figures.push({ name: t.name, s });
    }
  }
  if (figures.length === 0) return null;

  const premiumTotal = figures.reduce((a, f) => a + (f.s.pool?.poolPremium ?? 0), 0);
  const exposureTotal: Partial<Record<CoverageLine, number>> = {};
  for (const line of lines) {
    exposureTotal[line] = figures.reduce((a, f) => a + (f.s.byLine?.[line]?.activeExposure ?? 0), 0);
  }
  const byTeam: Record<string, TeamMarketShare> = {};
  for (const { name, s } of figures) {
    const byLine: Partial<Record<CoverageLine, number>> = {};
    for (const line of lines) {
      const own = s.byLine?.[line]?.activeExposure;
      const total = exposureTotal[line] ?? 0;
      if (own !== undefined && total > 0) byLine[line] = own / total;
    }
    byTeam[name] = { pool: premiumTotal > 0 ? (s.pool?.poolPremium ?? 0) / premiumTotal : 0, byLine };
  }
  return { year, byTeam };
}

/**
 * Whether a set for `year` may replace the one stored. Year 0 is recomputed on
 * every opening post until a played year's set exists; a played year's set is
 * written once and never replaced by its own year or an earlier one.
 */
export function mayStoreShares(stored: RoomMarketShares | undefined, year: number): boolean {
  if (!stored) return true;
  return year === 0 ? stored.year === 0 : year > stored.year;
}
