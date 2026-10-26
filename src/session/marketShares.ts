// ============================================================================
// THE ROOM'S MARKET SHARES — one pure function, called by both transports.
//
// What it measures and when it is stored are on RoomMarketShares (contract.ts).
// This file is the arithmetic and the completeness rule, written once so the
// localStorage transport and the DynamoDB one cannot disagree: the contract
// harness runs one set of assertions at both.
// ============================================================================

import type { CoverageLine } from '../types/simulation';
import { latestKnownRoomYear } from '../utils/knownYears';
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
 * THE STORE: one set per result year, keyed by year as a string, each team's
 * share keyed by team name. Written once a year as each year completes, so the
 * room keeps every year's figures and a reader can show the one the
 * one-year-behind rule allows.
 */
export type RoomSharesByYear = Record<string, Record<string, TeamMarketShare>>;

/**
 * Whether a set for `year` may be written. A played year's set is written once
 * and never replaced. Year 0 (the opening posts, which arrive as teams build
 * their games) is rewritten as teams post, but never by a set with fewer teams
 * — a slow post's view of the room must not replace a fuller one.
 */
export function mayStoreShares(stored: RoomSharesByYear | undefined, year: number, teams: number): boolean {
  const held = stored?.[String(year)];
  if (!held) return true;
  return year === 0 && Object.keys(held).length <= teams;
}

/**
 * THE SET A SCREEN SHOWS: the latest known year's — the room's current year less
 * two while the game runs (latestKnownRoomYear), the last year once it is over —
 * so the share follows the same one-year-behind rule as every other result. When
 * that year's set is not complete yet (a team that locked in has not posted),
 * the newest complete year before it.
 *
 * ⚠ BEFORE THE FIRST ADVANCE THE LATEST KNOWN YEAR IS 2025, A PRE-GAME YEAR THE
 * TEAMS NEVER POST. Every team plays the same pre-game, so its shares are 1/N
 * on every line and the pool — exactly the opening posts' (year 0), which stand
 * in for it.
 */
export function shownShares(
  room: { currentYear: number; yearCount: number },
  stored: RoomSharesByYear | undefined,
): RoomMarketShares | undefined {
  if (!stored) return undefined;
  const known = Math.max(0, Math.min(latestKnownRoomYear(room), room.currentYear - 1));
  let best: number | null = null;
  for (const k of Object.keys(stored)) {
    const y = Number(k);
    if (Number.isFinite(y) && y <= known && (best === null || y > best)) best = y;
  }
  return best === null ? undefined : { year: best, byTeam: structuredClone(stored[String(best)]) };
}
