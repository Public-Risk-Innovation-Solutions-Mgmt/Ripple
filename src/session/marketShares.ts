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
import type { RoomMarketShares, TeamMarketShare, TeamMarketShareOfYear, TeamYearSummary } from './contract';

/** One team as the share needs it — whatever the transport stores it as. */
export interface ShareTeam {
  name: string;
  /** Did this team lock in decisions for the year being worked out? */
  lockedYear: boolean;
  /** Every result it has posted, keyed by year as a string. */
  results: Record<string, TeamYearSummary>;
}

/**
 * THE POOL'S MARKET SHARE: the simple AVERAGE of the team's line shares, over
 * the lines in the room — each line's share already being the team's share of
 * the room's exposure on that line. 52% WC, 48% GL and 50% Property is 50%; a
 * WC-only room's pool share is its WC share.
 *
 * ⚠ NOT ITS SHARE OF THE ROOM'S PREMIUM, which it was until
 * pr/pool-share-average: premium weighted the pool toward whichever line
 * carried the most premium, so a team could lead every line's exposure and
 * still trail on the pool. Every screen and download reads this one function,
 * through roomSharesFor (a set as it is worked out) and shownShares (a set as
 * it is read back, so a room stored before the change shows the average too).
 */
export function poolShareOf(byLine: Partial<Record<CoverageLine, number>>): number {
  const shares = Object.values(byLine).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return shares.length === 0 ? 0 : shares.reduce((a, v) => a + v, 0) / shares.length;
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
    byTeam[name] = { pool: poolShareOf(byLine), byLine };
  }
  return { year, byTeam };
}

/**
 * THE STORE: one set per result year, keyed by year as a string, each team's
 * share keyed by team name. Written once a year as each year completes, so the
 * room keeps every year's figures and a reader shows the latest known year's.
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
 * THE SET A SCREEN SHOWS: the latest known year's — the year just completed,
 * the room's current year less one (latestKnownRoomYear), the last year once
 * the game is over — the same rule as every other result. Before the first
 * advance that is year 0, the opening posts. When that year's set is not
 * complete yet (a team that locked in has not posted), the newest complete year
 * before it.
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
  if (best === null) return undefined;
  // The pool share re-derived from the stored line shares: a set stored before
  // pr/pool-share-average holds the old premium share in `pool`.
  const byTeam = structuredClone(stored[String(best)]);
  for (const t of Object.values(byTeam)) t.pool = poolShareOf(t.byLine);
  return { year: best, byTeam };
}

/**
 * EVERY KNOWN YEAR'S SET, for the Market Survey's and the Teams tab's year
 * selector (pr/market-survey-order): each stored year up to the latest known
 * year (as shownShares), keyed by year as a string, the pool share re-derived
 * as there. Undefined with none stored.
 */
export function sharesByYearShown(
  room: { currentYear: number; yearCount: number },
  stored: RoomSharesByYear | undefined,
): Record<string, RoomMarketShares> | undefined {
  if (!stored) return undefined;
  const known = Math.max(0, Math.min(latestKnownRoomYear(room), room.currentYear - 1));
  const out: Record<string, RoomMarketShares> = {};
  for (const k of Object.keys(stored)) {
    const y = Number(k);
    if (!Number.isFinite(y) || y > known) continue;
    const byTeam = structuredClone(stored[k]);
    for (const t of Object.values(byTeam)) t.pool = poolShareOf(t.byLine);
    out[String(y)] = { year: y, byTeam };
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * A HOSTED TEAM'S ROOM SHARE FOR ONE YEAR ON ONE VIEW, as a result screen shows
 * it — the same figure as the top-bar chip and the host's Market share column.
 * The team holds its share for the latest known year only (CallerView), so a
 * screen showing another year has none: undefined. A pre-game year takes the
 * opening set — every team plays the same pre-game, so the shares are 1/N in
 * every one of them.
 */
export function roomShareFor(
  share: TeamMarketShareOfYear | null | undefined,
  yearNumber: number,
  view: CoverageLine | 'pool',
): number | undefined {
  if (!share) return undefined;
  const matches = yearNumber === share.year || (yearNumber <= 0 && share.year === 0);
  if (!matches) return undefined;
  return view === 'pool' ? share.pool : share.byLine[view];
}
