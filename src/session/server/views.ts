// ============================================================================
// THE PROJECTIONS: what a stored room looks like to each caller.
//
// ⚠ THE SAME FUNCTIONS localTransport.ts HAS — statusOf, highestPlayedYear,
// teamView, roomView, callerView — rewritten over the DynamoDB header's roster
// plus the D#/R# items a role-keyed Query fetched, instead of over one in-memory
// record. Where they differ, the difference is named at the function and is
// deliberate.
//
// ⚠ ONE DIFFERENCE IS THE POINT: OTHER TEAMS' RESULTS ARE NOT SENT TO PLAYERS.
// localTransport.ts's teamView fills resultsByYear for EVERY caller and says so
// as a live over-send and privacy gap. keys.ts's READ section designs it closed:
// the host's query fetches every team's R# range and nobody else's does. So here
// a TeamView carries resultsByYear only for the teams whose results were fetched
// — every team for the host, the caller's own team for a player or viewer, none
// for an anonymous caller. No player screen reads another team's results (only
// HostTeamsTab and HostChartsTab read resultsByYear), and the contract harness
// passes over it unchanged.
//
// Nothing here touches DynamoDB. rooms.ts does the I/O and hands these the
// items; that is what lets the projection be read in one place.
// ============================================================================

import type {
  CallerRole, CallerView, JsonValue, RoomStatus, RoomView, ScheduledShockSpec,
  TeamView, TeamYearSummary,
} from '../contract';
import type { CoverageLine } from '../../types/simulation';

/** One team as the header's roster holds it. Keyed by teamId in the map. */
export interface RosterEntry {
  name: string;
  lines: CoverageLine[];
  joined: boolean;
  lockedYear: number | null;
  tokenHash: string;
  /** Year (as a string) -> true, for every year this team has a result posted. */
  posted: Record<string, boolean>;
  /**
   * Epoch millis of the join that created the team.
   *
   * ⚠ IT EXISTS FOR ORDER, BECAUSE A MAP HAS NONE. localTransport keeps teams in
   * an array, so RoomView.teams is in join order and the host's table, its
   * chart colours and the harness's teams[0] all rely on that. A DynamoDB map
   * returns its keys in no promised order. Sorting on this restores join order;
   * teamId breaks a same-millisecond tie so the order is at least stable.
   */
  joinedAt: number;
}

/** The ROOM item, as stored. Every secret in it is a hash. */
export interface RoomHeader {
  pk: string;
  sk: string;
  code: string;
  seed: string;
  eventName: string;
  yearCount: number;
  startingYear: number;
  expectedTeams: number;
  currentYear: number;
  shocks: ScheduledShockSpec[];
  roster: Record<string, RosterEntry>;
  createdAt: number;
  updatedAt: number;
  rev: number;
  expiresAtSec: number;
  hostTokenHash: string;
}

/** A D# or R# item, as stored: the payload is a JSON STRING, never a map. */
export interface YearItem {
  pk: string;
  sk: string;
  teamId: string;
  year: number;
  body: string;
  expiresAtSec: number;
}

/** What the role-keyed Query fetched, already parsed, keyed teamId -> year -> payload. */
export interface Fetched {
  results: Map<string, Record<string, TeamYearSummary>>;
  decisions: Map<string, Record<string, JsonValue>>;
}

export function statusOf(header: RoomHeader): RoomStatus {
  if (header.currentYear > header.yearCount) return 'complete';
  return Object.values(header.roster).some(t => t.joined) ? 'running' : 'lobby';
}

/**
 * ⚠ THE HIGHEST PLAYED YEAR, WHICH IS NOT THE HIGHEST KEY. Year 0 is the
 * opening position, posted before a team has decided anything; counting it
 * would report a team that has played nothing as having reported. Read from the
 * roster's `posted` set, so it needs no R# item — every caller can be told it.
 */
export function highestPlayedYear(entry: RosterEntry): number | null {
  let best: number | null = null;
  for (const k of Object.keys(entry.posted ?? {})) {
    const y = Number(k);
    if (Number.isFinite(y) && y >= 1 && (best === null || y > best)) best = y;
  }
  return best;
}

/** The roster in join order — see RosterEntry.joinedAt. */
export function orderedRoster(header: RoomHeader): Array<[string, RosterEntry]> {
  return Object.entries(header.roster ?? {}).sort(([ia, a], [ib, b]) =>
    a.joinedAt - b.joinedAt || (ia < ib ? -1 : ia > ib ? 1 : 0));
}

export function buildTeamView(
  entry: RosterEntry,
  currentYear: number,
  results: Record<string, TeamYearSummary> | undefined,
): TeamView {
  return {
    name: entry.name,
    lines: [...entry.lines],
    joined: entry.joined,
    lockedYear: entry.lockedYear ?? null,
    locked: entry.lockedYear === currentYear,
    resultYear: highestPlayedYear(entry),
    // Absent when nothing was fetched for this team OR it has posted nothing —
    // the same `undefined` localTransport gives a team with no history.
    resultsByYear: results && Object.keys(results).length > 0 ? { ...results } : undefined,
  };
}

export function buildRoomView(header: RoomHeader, fetched: Fetched): RoomView {
  return {
    code: header.code,
    status: statusOf(header),
    seed: header.seed,
    eventName: header.eventName,
    yearCount: header.yearCount,
    startingYear: header.startingYear,
    expectedTeams: header.expectedTeams,
    currentYear: header.currentYear,
    shocks: (header.shocks ?? []).map(s => ({ shockId: s.shockId, yearNumber: s.yearNumber })),
    teams: orderedRoster(header).map(([teamId, entry]) =>
      buildTeamView(entry, header.currentYear, fetched.results.get(teamId))),
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    rev: header.rev,
  };
}

/**
 * The caller's own slice. ⚠ OWN TEAM ONLY, and only for a player or a viewer:
 * the host gets no team's decisions, which is enforced by rooms.ts never
 * querying D# for the host — keys.ts HARD 6, privacy by code, held by the
 * harness's redaction block.
 */
export function buildCallerView(
  role: CallerRole,
  teamId: string | null,
  entry: RosterEntry | null,
  fetched: Fetched,
): CallerView {
  const view: CallerView = { role };
  if (!teamId || !entry) return view;

  view.teamName = entry.name;
  view.lines = [...entry.lines];
  const decisions = fetched.decisions.get(teamId);
  if (decisions && Object.keys(decisions).length > 0) view.decisionsByYear = { ...decisions };

  const postedYears = Object.keys(entry.posted ?? {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (postedYears.length > 0) view.postedYears = postedYears;

  const played = highestPlayedYear(entry);
  const results = fetched.results.get(teamId);
  if (played !== null && results?.[String(played)] !== undefined) {
    view.lastResult = results[String(played)];
    view.lastResultYear = played;
  }
  return view;
}
