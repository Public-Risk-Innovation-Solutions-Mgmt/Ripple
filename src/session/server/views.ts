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
  CallerRole, CallerView, JsonValue, PriorDevelopment, DevelopmentLevels, RoomMarketShares, RoomStatus, RoomView,
  ScheduledShockSpec, TeamView, TeamYearSummary,
} from '../contract';
import type { CoverageLine } from '../../types/simulation';
import { shownShares, type RoomSharesByYear } from '../marketShares';

/** Canonical order, and the fallback for a header written before the host
 *  picked the lines. Mirrors rooms.ts's own copy. */
const LINE_ORDER: CoverageLine[] = ['WC', 'GL', 'Property'];

/** One team as the header's roster holds it. Keyed by teamId in the map. */
export interface RosterEntry {
  name: string;
  lines: CoverageLine[];
  joined: boolean;
  lockedYear: number | null;
  tokenHash: string;
  /**
   * ⚠ PLAIN, NOT HASHED — AND DELIBERATELY SO, UNLIKE tokenHash. A PIN is not a
   * secret in that sense: its only power is letting a viewer watch, the same
   * authority a name-based viewer join already grants with no secret at all.
   * It is kept here so a rejoining player's JoinResponse can return it again
   * without a second lookup. Never copied into TeamView or CallerView —
   * buildTeamView below builds its output field by field and does not include
   * it; JoinResponse.pin is the only place this ever leaves the header.
   */
  pin?: string;
  /**
   * ⚠ HASHED, NOT PLAIN — unlike `pin` above. A recovery code is the one
   * secret a device hands to a PERSON rather than to a wire: writing it in
   * the clear here would mean anyone who ever reads this header (the host
   * screen, a DynamoDB console, a support engineer) could reclaim the team
   * themselves. Checked with server/dynamo.ts's hashesMatch — the caller's
   * candidate is hashed and compared, never the other way round — and never
   * returned anywhere except JoinResponse.recoveryCode, once, at creation.
   * Absent on a team created before this feature existed; reclaimTeam treats
   * that the same as any other wrong guess (server/rooms.ts's
   * PLACEHOLDER_RECOVERY_HASH) rather than branching on it.
   */
  recoveryHash?: string;
  /** Year (as a string) -> true, for every year this team has a result posted. */
  posted: Record<string, boolean>;
  /**
   * Year (as a string) -> true, for every year this team locked decisions for.
   * lockedYear holds only the newest, and the room market share needs to know
   * whether a team locked a PARTICULAR year (a team that did not is stopped).
   * Absent on an entry written before it existed; read as lockedYear alone.
   */
  lockedYears?: Record<string, boolean>;
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
  /** The pool's name. ⚠ Optional on the item: a header written before it existed reads the event name. */
  poolName?: string;
  yearCount: number;
  startingYear: number;
  expectedTeams: number;
  // ⚠ OPTIONAL ON THE ITEM, REQUIRED ON THE VIEW, same as the local transport.
  // A header written before the host picked the lines carries neither, and
  // buildRoomView defaults them rather than returning a room with no game.
  lines?: CoverageLine[];
  priorDevelopment?: PriorDevelopment;
  developmentLevels?: DevelopmentLevels;
  /** Taken off the lobby by the host. Absent reads as false. */
  hidden?: boolean;
  currentYear: number;
  shocks: ScheduledShockSpec[];
  roster: Record<string, RosterEntry>;
  /** Every year's room market shares, as each year completed — see RoomMarketShares. */
  marketSharesByYear?: RoomSharesByYear;
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

// ⚠ DECISIONS ARE HOST-ONLY, AND THE STRIP IS HERE RATHER THAN IN THE QUERY.
// The role-keyed Query already decides WHICH teams' R# rows a caller gets —
// every team for the host, its own for a player or viewer, none for anonymous.
// That is enough for the figures and is NOT enough for decisions: a player
// still receives its OWN rows, and those rows now carry a decisions block.
// Its own choices are not news to it, but sending them back through a second
// channel widens what the row means for no reason, so the rule is the plain
// one the contract states — decisions reach the host and nobody else.
//
// Defaults to stripping, as localTransport's does and for the same reason: a
// caller that forgets the role renders a dash, not a leak.
function summaryFor(s: TeamYearSummary, role: CallerRole): TeamYearSummary {
  if (role === 'host' || s.decisions === undefined) return s;
  const { decisions: _omitted, ...rest } = s;
  void _omitted;
  return rest;
}

export function buildTeamView(
  entry: RosterEntry,
  currentYear: number,
  results: Record<string, TeamYearSummary> | undefined,
  role: CallerRole = 'anonymous',
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
    resultsByYear: results && Object.keys(results).length > 0
      ? Object.fromEntries(Object.entries(results).map(([y, v]) => [y, summaryFor(v, role)]))
      : undefined,
  };
}

export function buildRoomView(header: RoomHeader, fetched: Fetched, role: CallerRole = 'anonymous'): RoomView {
  return {
    code: header.code,
    status: statusOf(header),
    seed: header.seed,
    eventName: header.eventName,
    poolName: header.poolName || header.eventName,
    yearCount: header.yearCount,
    startingYear: header.startingYear,
    expectedTeams: header.expectedTeams,
    lines: [...(header.lines ?? LINE_ORDER)],
    priorDevelopment: { ...(header.priorDevelopment ?? {}) },
    ...(header.developmentLevels ? { developmentLevels: { ...header.developmentLevels } } : {}),
    hidden: header.hidden ?? false,
    currentYear: header.currentYear,
    shocks: (header.shocks ?? []).map(s => ({ shockId: s.shockId, yearNumber: s.yearNumber })),
    teams: orderedRoster(header).map(([teamId, entry]) =>
      buildTeamView(entry, header.currentYear, fetched.results.get(teamId), role)),
    // Host only, the latest known year's, as in localTransport: a player gets its own on CallerView.
    ...(role === 'host' && shownShares(header, header.marketSharesByYear)
      ? { marketShares: shownShares(header, header.marketSharesByYear) } : {}),
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
  shares?: RoomMarketShares,
): CallerView {
  const view: CallerView = { role };
  if (!teamId || !entry) return view;

  const share = shares?.byTeam[entry.name];
  if (share) view.marketShare = { year: shares!.year, pool: share.pool, byLine: { ...share.byLine } };

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
    // Stripped for the same reason as localTransport's — see the note there.
    // The host has no team, so this route never carries decisions at all.
    view.lastResult = summaryFor(results[String(played)], role);
    view.lastResultYear = played;
  }
  return view;
}
