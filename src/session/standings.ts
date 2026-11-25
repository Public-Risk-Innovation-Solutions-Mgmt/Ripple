// ============================================================================
// THE ROOM'S STANDINGS — what a team (or a viewer) may see of every team: the
// host's Teams table and nothing more (the Market Survey tab).
//
// ⚠ READ ONLY, AND COPIED FIELD BY FIELD, NEVER SPREAD. Each posted summary
// carries far more than the table shows — the decisions block above all, which
// reaches the host and nobody else — so a standing is built from the table's
// own fields alone (STANDING_FIELDS), and a field added to TeamYearFigures
// later reaches no team until it is added here on purpose. Both transports
// build the view through this one function (localTransport.roomView and
// server/views.buildRoomView), so the two cannot disagree about what a team
// sees.
//
// ⚠ A YEAR'S FIGURES APPEAR ONCE IT HAS BEEN PLAYED: a summary is posted only
// for a played year (and the opening, year 0), and the table opens on the
// room's latest known year (utils/knownYears) exactly as the host's does.
//
// ⚠ EVERY KNOWN YEAR, NOT THE LATEST ALONE (pr/market-survey-order). The
// table's year selector shows any year from 0 (the opening) to the latest, so
// the standings carry every posted year up to it, each slimmed to the table's
// figures, and every year's shares. The read grows with teams x years: about
// 6 figures x 4 slices x years x teams, a few KB for 16 teams over five years.
// ============================================================================

import type {
  RoomMarketShares, RoomStandings, StandingFigures, StandingSummary, StandingTeam, TeamYearFigures, TeamYearSummary,
} from './contract';
import type { CoverageLine } from '../types/simulation';

/** The host's Teams table's own figures — every one it reads, and no other. */
export const STANDING_FIELDS = [
  'endingSurplus', 'premiumToSurplus', 'ratePer100', 'rateChange', 'adminExpenseRatio', 'yearCombinedRatio',
] as const satisfies readonly (keyof TeamYearFigures)[];

function standingFigures(f: TeamYearFigures): StandingFigures {
  const out: Partial<Record<typeof STANDING_FIELDS[number], number>> = {};
  for (const k of STANDING_FIELDS) if (typeof f[k] === 'number') out[k] = f[k] as number;
  return out as StandingFigures;
}

function standingSummary(s: TeamYearSummary): StandingSummary {
  const byLine: Partial<Record<CoverageLine, StandingFigures>> = {};
  for (const [l, f] of Object.entries(s.byLine) as [CoverageLine, TeamYearFigures | undefined][]) {
    if (f) byLine[l] = standingFigures(f);
  }
  return { yearNumber: s.yearNumber, calendarYear: s.calendarYear, pool: standingFigures(s.pool), byLine };
}

/** One team's row source: its number, name, lines and every year it has posted. */
export interface StandingSource {
  name: string;
  displayName?: string;
  teamNumber: number;
  lines: CoverageLine[];
  results?: Record<string, TeamYearSummary>;
}

/**
 * THE YEAR THE STANDINGS SHOW: the room's latest known year — the year just
 * played, currentYear - 1, the opening (0) before the first advance; as the
 * host's Teams table (utils/knownYears.latestKnownRoomYear, cut at
 * currentYear - 1). Null before any year exists.
 */
export const standingsYear = (currentYear: number): number | null => (currentYear - 1 >= 0 ? currentYear - 1 : null);

/**
 * The standings a player or viewer reads: every team, each result it has posted
 * for a year from 0 to the year shown (standingsYear) slimmed to the table's
 * figures, and the room's shares — the latest known year's and every year's.
 * ⚠ NO YEAR PAST THE ONE SHOWN: a later summary (none is posted before its
 * year is played) would not reach the table either way.
 */
export function buildStandings(
  teams: readonly StandingSource[], currentYear: number, marketShares?: RoomMarketShares,
  marketSharesByYear?: Record<string, RoomMarketShares>,
): RoomStandings {
  const y = standingsYear(currentYear);
  return {
    teams: teams.map((t): StandingTeam => {
      const byYear: Record<string, StandingSummary> = {};
      if (y !== null) {
        for (const [k, s] of Object.entries(t.results ?? {})) {
          const n = Number(k);
          if (Number.isInteger(n) && n >= 0 && n <= y && s) byYear[k] = standingSummary(s);
        }
      }
      return {
        name: t.name,
        ...(t.displayName !== undefined ? { displayName: t.displayName } : {}),
        teamNumber: t.teamNumber,
        lines: [...t.lines],
        ...(Object.keys(byYear).length ? { resultsByYear: byYear } : {}),
      };
    }),
    ...(marketShares ? { marketShares } : {}),
    ...(marketSharesByYear ? { marketSharesByYear } : {}),
  };
}
