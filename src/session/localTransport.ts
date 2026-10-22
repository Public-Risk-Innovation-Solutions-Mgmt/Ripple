// ============================================================================
// THE localStorage IMPLEMENTATION of SessionTransport.
//
// ⚠ THE FIRST IMPLEMENTATION, NOT THE DESIGN. Everything specific to
// localStorage is below this line and nothing above it (see contract.ts) knows
// this file exists. Screens import the interface and are handed an instance;
// none of them can tell what is underneath, which is the property the whole
// layer is for.
//
// WHY IT IS STILL ASYNC WHEN localStorage IS SYNCHRONOUS. Because the point is
// to build the client against the shape a network actually has. A synchronous
// API here would compile, work, and then require every call site to be rewritten
// the first time a request took 40ms and sometimes failed. The fake latency and
// the injectable fault are how the loading spinner and the error state get
// written and walked NOW, while the cost of getting them wrong is nothing.
//
// ⚠ MUTATIONS TAKE A CROSS-TAB LOCK, AND THIS WAS A BUG BEFORE THEY DID. Four
// tabs share one localStorage and there is no transaction. The first version of
// this file kept each read-modify-write in one synchronous block and argued that
// JavaScript being single-threaded made it un-interleavable. THAT ARGUMENT IS
// WRONG, and the four-tab run proved it within minutes: single-threadedness
// holds WITHIN a tab, but separate tabs are genuinely parallel, so tab A could
// read, tab B read, tab A write and tab B write — losing A's update entirely. It
// showed up as a team whose posted result silently never arrived, with the host
// table reporting it a year behind while its own screen showed the year computed
// and posted.
//
// navigator.locks is the right primitive: per ORIGIN, honoured across every tab,
// and it releases if a tab dies mid-hold. Every mutating endpoint runs its whole
// read-modify-write inside it. READS ARE DELIBERATELY NOT LOCKED — a poll is
// harmless against a half-finished sequence because each localStorage write is
// itself atomic, and serialising four pollers behind every write would make the
// lock the bottleneck it exists to avoid.
//
// Where the API is absent (the Node contract harness, an old browser) the work
// runs unlocked — correct there, because there is exactly one thread to race.
//
// The artificial latency is awaited BEFORE the lock is taken, never inside it,
// so a fake round trip cannot widen the window it is meant to be testing. A
// hosted implementation gets all of this from the server for free.
// ============================================================================

import type {
  AdvanceRequest, AdvanceResponse,
  CallerRole, CallerView,
  EventStatus,
  ListEventsResponse, LobbyEvent,
  SetEventHiddenRequest, SetEventHiddenResponse,
  CreateRoomRequest, CreateRoomResponse,
  JoinRequest, JoinResponse,
  JsonValue,
  PriorDevelopment,
  ReadRequest, ReadResponse,
  RoomMarketShares,
  RoomStatus, RoomView,
  ScheduledShockSpec,
  SessionTransport,
  TeamYearSummary,
  SubmitRequest, SubmitResponse,
  TeamView,
} from './contract';
import { SessionError, SESSION_TOKEN_PATTERN, isRoomSeed, newSessionToken, eventStatusOf, mayCreateTeam } from './contract';
import { Faults } from './faults';
import { mayStoreShares, roomSharesFor } from './marketShares';
import type { CoverageLine } from '../types/simulation';

// ⚠ EXPORTED BECAUSE THE STORE NOW HOLDS MORE THAN ROOMS. The stub server's
// /health used to report `store.length` as the room count, which was true while
// a room was the only thing written. The createRoom idempotency index below put
// a second key in the same store per room, and the two-contexts driver caught
// it immediately — "the SERVER holds the room (2)" after one create. Anything
// counting rooms filters on this.
export const ROOM_KEY_PREFIX = 'ripple.session.v1.room.';
const KEY_PREFIX = ROOM_KEY_PREFIX;
// ⚠ THE IDEMPOTENCY INDEX FOR createRoom: host token -> room code. Keyed on the
// token itself here, which is no worse than the room record beside it — that
// already holds the token in the clear in the same localStorage. A HOSTED
// implementation must key on a HASH so no plaintext bearer token is written to
// the table; that is the server's side of the wire and the contract does not
// constrain it.
const IDEMPOTENCY_PREFIX = 'ripple.session.v1.create.';

// ============================================================================
// THE LOBBY INDEX — ONE RECORD LISTING CURRENT EVENTS.
//
// ⚠ A LOCAL STORE COULD BE SCANNED AND THIS ONE DELIBERATELY IS NOT. Listing
// events here could be a loop over every ROOM_KEY_PREFIX key, which cannot
// drift because it reads the rooms themselves. The hosted table has no such
// option — see keys.ts, which has no way to scan rooms by design — so it must
// keep an index, and an index is the thing that CAN go stale.
//
// Keeping the same mechanism on both sides is the point of this transport: it
// is the rehearsal for the hosted one, and a rehearsal that uses an easier
// mechanism rehearses nothing. Every staleness bug the index can have is
// reachable here, in a browser, with no AWS account.
//
// SHAPE: one JSON object, code -> entry. Updated on CREATE, HIDE, START (the
// first advance) and FINISH (the last), which are exactly the four moments the
// listing changes.
const LOBBY_KEY = 'ripple.session.v1.lobby';

interface LobbyIndexEntry {
  code: string;
  eventName: string;
  status: EventStatus;
  teams: number;
  currentYear: number;
  yearCount: number;
  hidden: boolean;
  updatedAt: number;
}

function loadLobbyIndex(store: Storage): Record<string, LobbyIndexEntry> {
  const raw = store.getItem(LOBBY_KEY);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, LobbyIndexEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // ⚠ A CORRUPT INDEX IS AN EMPTY LOBBY, NOT A DEAD APP. The index is
    // derived data: every room it names is still reachable by its code, and
    // the next write rebuilds the entry. Throwing here would take the whole
    // front page down over a cache nothing depends on.
    return {};
  }
}

/**
 * Read-modify-write ONE entry, leaving every other entry exactly as found.
 *
 * ⚠ THE WHOLE-OBJECT WRITE IS WHY THIS MUST RUN UNDER THE ROOM LOCK. Two hosts
 * creating at once both read the index, both add their own row and both write
 * the whole object back — and the second silently drops the first. That is the
 * lost update the hosted side spends a conditional write on (keys.ts: the
 * LOBBY record is updated with an UpdateExpression touching only its own
 * `events.<code>` path, never a Put of the whole map). Here the lock does it,
 * and every caller of this function is already inside `call(..., true)`.
 */
function updateLobbyEntry(
  store: Storage, code: string, patch: (prev: LobbyIndexEntry | undefined) => LobbyIndexEntry | null,
): void {
  const index = loadLobbyIndex(store);
  const next = patch(index[code]);
  if (next === null) delete index[code];
  else index[code] = next;
  store.setItem(LOBBY_KEY, JSON.stringify(index));
}

/** The entry a room record implies. One derivation, so the index cannot invent a status. */
function lobbyEntryFor(room: RoomRecord): LobbyIndexEntry {
  return {
    code: room.code,
    eventName: room.eventName,
    status: eventStatusOf(room.currentYear, room.yearCount),
    teams: room.teams.filter(t => t.joined).length,
    currentYear: room.currentYear,
    yearCount: room.yearCount,
    hidden: room.hidden ?? false,
    updatedAt: room.updatedAt,
  };
}

// No O/0/I/1 — a room code gets read aloud across a room and written on a
// whiteboard, and those are the four characters that come back wrong.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------------------------------------------------------------- records

// What is actually stored. Holds the SECRETS (host token, team tokens) and every
// team's decisions; `read` projects a redacted view out of it and never returns
// this shape directly.
interface TeamRecord {
  name: string;
  // ⚠ COPIED FROM THE ROOM AT JOIN, never from a request and never written
  // again. The host owns the line set now; a team has no say and sends none.
  lines: CoverageLine[];
  token: string | null;
  joined: boolean;
  lockedYear: number | null;
  // Year number (as a string key, per JSON) -> that year's submitted decisions.
  // Stored whole and never read here (uw-hybrid's two sliders changed only
  // contract.ts's shape, not this store).
  decisionsByYear: Record<string, JsonValue>;
  // Year number (as a string key, per JSON) -> that year's posted summary.
  resultsByYear: Record<string, TeamYearSummary>;
}

interface ViewerRecord {
  token: string;
  teamName: string;
}

interface RoomRecord {
  code: string;
  hostToken: string;
  seed: string;
  eventName: string;
  yearCount: number;
  startingYear: number;
  expectedTeams: number;
  // ⚠ OPTIONAL ON THE RECORD, REQUIRED ON THE VIEW. A room written before the
  // host picked the lines has neither; roomView defaults them so an old record
  // stays readable rather than rendering an empty game.
  lines?: CoverageLine[];
  priorDevelopment?: PriorDevelopment;
  /** Taken off the lobby by the host. Absent reads as false — see the contract. */
  hidden?: boolean;
  currentYear: number;
  shocks: ScheduledShockSpec[];
  teams: TeamRecord[];
  viewers: ViewerRecord[];
  /** The stored room market shares — see RoomMarketShares. Absent until the first year-0 post. */
  marketShares?: RoomMarketShares;
  createdAt: number;
  updatedAt: number;
  rev: number;
}

// ---------------------------------------------------------------- ids

function randomFrom(alphabet: string, length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ⚠ ONE MINT, SHARED WITH THE CLIENTS. It lives in the contract now because a
// client mints its own token for join and createRoom — see newSessionToken.
const newToken = newSessionToken;

/**
 * A token a CALLER supplied, checked before it is allowed to own anything.
 *
 * ⚠ TWO SEPARATE REFUSALS, AND THE SECOND IS THE ONE THAT MATTERS. Shape keeps
 * a malformed or trivially short string out of the credential space. COLLISION
 * is what stops a client claiming somebody else's seat: a supplied token that
 * already belongs to a different team, a viewer or the host is refused outright
 * rather than quietly accepted, so moving the mint to the client cannot be used
 * to take a team by presenting its token. A caller re-presenting its OWN token
 * is the rejoin path and never reaches here.
 */
function assertTokenFree(room: RoomRecord, token: string): void {
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    throw new SessionError('INVALID_REQUEST', 'That token is not a valid session token.');
  }
  if (token === room.hostToken
    || room.teams.some(t => t.token === token)
    || room.viewers.some(v => v.token === token)) {
    throw new SessionError('BAD_TOKEN', 'That token is already in use in this room.');
  }
}

// ---------------------------------------------------------------- storage

function storage(): Storage {
  // Private-mode browsers throw on access rather than returning null, so this
  // is a try/catch and not a truthiness check.
  try {
    const s = globalThis.localStorage;
    if (!s) throw new Error('no localStorage');
    return s;
  } catch {
    throw new SessionError(
      'TRANSPORT_FAILURE',
      'This browser is blocking local storage, so the session cannot be reached.',
      true,
    );
  }
}

function loadRoom(code: string): RoomRecord {
  const raw = storage().getItem(KEY_PREFIX + code);
  if (raw === null) {
    throw new SessionError('ROOM_NOT_FOUND', `No room with code ${code}.`);
  }
  try {
    return JSON.parse(raw) as RoomRecord;
  } catch {
    throw new SessionError('TRANSPORT_FAILURE', `The stored room ${code} is unreadable.`);
  }
}

function saveRoom(room: RoomRecord): void {
  room.updatedAt = Date.now();
  room.rev += 1;
  storage().setItem(KEY_PREFIX + room.code, JSON.stringify(room));
}

const LINE_ORDER: CoverageLine[] = ['WC', 'GL', 'Property'];

/**
 * ⚠ THE HIGHEST PLAYED YEAR, WHICH IS NOT THE HIGHEST KEY. Year 0 is the
 * opening position, posted when a team builds its game and before it has
 * decided anything; counting it would report a team that has played nothing as
 * having reported.
 */
function highestPlayedYear(t: TeamRecord): number | null {
  let best: number | null = null;
  for (const k of Object.keys(t.resultsByYear)) {
    const y = Number(k);
    if (Number.isFinite(y) && y >= 1 && (best === null || y > best)) best = y;
  }
  return best;
}

// sameLines is gone with LINES_LOCKED: a join carries no lines, so there are
// never two sets to compare.

// ---------------------------------------------------------------- views

function statusOf(room: RoomRecord): RoomStatus {
  if (room.currentYear > room.yearCount) return 'complete';
  return room.teams.some(t => t.joined) ? 'running' : 'lobby';
}

// ⚠ LIVE OVER-SEND AND PRIVACY GAP, ON THE CURRENT BUILD — NOT AN AWS QUESTION.
// roomView calls this for EVERY team and `read` returns roomView to EVERY
// caller: host, player, viewer and anonymous alike. So every poller receives
// every team's full resultsByYear, and any player can read every other team's
// results in devtools. Only the host's screens use it (HostTeamsTab,
// HostChartsTab); PlayScreen reads the roster fields and its own `you` slice.
// It is also most of the payload — ~87 KB of a ten-by-ten room's reads.
//
// The redaction in `callerView` (below) covers DECISIONS only. The fix
// is to populate resultsByYear for the host role alone, in `read` (and the
// views submit/join return), which changes no shape — the field is already
// optional. Not done here: it changes what players receive, and wants the
// contract harness to prove no player screen depended on it. The AWS design
// assumes it done; see src/session/server/keys.ts, READ.
// ⚠ DECISIONS ARE STRIPPED FOR EVERY CALLER BUT THE HOST, AND THIS FAILS
// CLOSED. The over-send above is unchanged — every caller still receives every
// team's resultsByYear, which is the gap recorded there and not fixed here —
// but the DECISIONS section added to those rows must not widen it. So `role`
// defaults to the most restrictive value rather than the most permissive: a
// roomView call site that forgets to pass it sends no decisions, which is a
// screen that renders a dash, not a leak.
//
// The host is the only caller any of this is for. A team's own decisions reach
// it as they always did, through callerView's decisionsByYear.
function summaryFor(s: TeamYearSummary, role: CallerRole): TeamYearSummary {
  if (role === 'host' || s.decisions === undefined) return s;
  const { decisions: _omitted, ...rest } = s;
  void _omitted;
  return rest;
}

// ⚠ THE OVER-SEND ABOVE IS CLOSED NOW (room market share): resultsByYear goes to
// the host for every team, to a player or viewer for its own team only, and to
// an anonymous caller for none — what the DynamoDB transport's role-keyed Query
// already did (keys.ts, READ). Players never see another team's figures, which
// the room market share would otherwise have handed them by a side door.
function teamView(t: TeamRecord, currentYear: number, role: CallerRole, ownTeam?: string): TeamView {
  const sees = role === 'host' || ((role === 'player' || role === 'viewer') && t.name === ownTeam);
  const results = sees ? Object.entries(t.resultsByYear) : [];
  return {
    name: t.name,
    lines: [...t.lines],
    joined: t.joined,
    lockedYear: t.lockedYear,
    locked: t.lockedYear === currentYear,
    resultYear: highestPlayedYear(t),
    // The scoreboard the host's Teams and Charts tabs read. A year with no entry
    // is a year not reported — which is a DIFFERENT state from a line the team
    // does not write, and the two must not be allowed to look alike.
    resultsByYear: results.length > 0
      ? Object.fromEntries(results.map(([y, s]) => [y, summaryFor(s, role)]))
      : undefined,
  };
}

// `role` defaults to the restrictive case on purpose — see summaryFor.
function roomView(room: RoomRecord, role: CallerRole = 'anonymous', ownTeam?: string): RoomView {
  return {
    code: room.code,
    status: statusOf(room),
    seed: room.seed,
    // ⚠ DEFAULTED ON READ, NOT ONLY ON WRITE. A room record written before the
    // host picked the lines has neither field; falling back to all three and to
    // no development keeps such a record readable instead of rendering a room
    // with an empty game.
    lines: [...(room.lines ?? LINE_ORDER)],
    priorDevelopment: { ...(room.priorDevelopment ?? {}) },
    hidden: room.hidden ?? false,
    eventName: room.eventName,
    yearCount: room.yearCount,
    startingYear: room.startingYear,
    expectedTeams: room.expectedTeams,
    currentYear: room.currentYear,
    shocks: room.shocks.map(s => ({ ...s })),
    teams: room.teams.map(t => teamView(t, room.currentYear, role, ownTeam)),
    // Host only: every other caller gets its own team's on CallerView.
    ...(role === 'host' && room.marketShares ? { marketShares: structuredClone(room.marketShares) } : {}),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    rev: room.rev,
  };
}

// Resolve a token to who is calling.
//
// ⚠ AUTHORITY IS DECIDED HERE AND ONLY HERE. Every endpoint that needs it calls
// this rather than checking tokens itself, so there is one place to read to know
// what any token can do — and one place for an HTTP implementation to replace
// with its own middleware.
function callerOf(room: RoomRecord, token: string | undefined): { role: CallerRole; team: TeamRecord | null } {
  if (!token) return { role: 'anonymous', team: null };
  if (token === room.hostToken) return { role: 'host', team: null };

  const player = room.teams.find(t => t.token !== null && t.token === token);
  if (player) return { role: 'player', team: player };

  const viewer = room.viewers.find(v => v.token === token);
  if (viewer) {
    const watched = room.teams.find(t => t.name === viewer.teamName) ?? null;
    return { role: 'viewer', team: watched };
  }

  throw new SessionError('BAD_TOKEN', 'That token does not belong to this room.');
}

function callerView(role: CallerRole, team: TeamRecord | null, room?: RoomRecord): CallerView {
  const view: CallerView = { role };
  if (!team) return view;

  const share = room?.marketShares?.byTeam[team.name];
  if (share) view.marketShare = { year: room!.marketShares!.year, pool: share.pool, byLine: { ...share.byLine } };

  view.teamName = team.name;
  view.lines = [...team.lines];
  // ⚠ OWN SLICE ONLY. A player and the viewer watching that player get that
  // team's decisions and results; nobody gets anybody else's, and the host gets
  // no team's. The host runs the room from the table in RoomView, which carries
  // presence and progress and no content.
  if (Object.keys(team.decisionsByYear).length > 0) {
    view.decisionsByYear = { ...team.decisionsByYear };
  }
  const postedYears = Object.keys(team.resultsByYear)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (postedYears.length > 0) view.postedYears = postedYears;

  const played = highestPlayedYear(team);
  if (played !== null) {
    // ⚠ STRIPPED HERE TOO, AND THIS IS THE SITE THAT WAS MISSED FIRST. The
    // contract harness caught it: teamView's strip covers the ROOM's copy, and
    // callerView hands the caller its own team's newest row by a second route.
    // A rule enforced at one of two exits is not enforced. `role` is never
    // 'host' in this function — the host has no team — so this is
    // unconditional, and it is written through the same helper so the two
    // cannot drift apart.
    view.lastResult = summaryFor(team.resultsByYear[String(played)], role);
    view.lastResultYear = played;
  }
  return view;
}

// ---------------------------------------------------------------- market share

// ⚠ IN THE SUBMIT THAT COMPLETES THE YEAR. See RoomMarketShares: the set for a
// played year is written once, when the last team that locked that year posts
// it; year 0 is recomputed on each opening post until year 1's set exists.
function storeSharesIfComplete(room: RoomRecord, year: number): void {
  if (!mayStoreShares(room.marketShares, year)) return;
  const set = roomSharesFor(year, room.teams.filter(t => t.joined).map(t => ({
    name: t.name,
    lockedYear: t.decisionsByYear[String(year)] !== undefined,
    results: t.resultsByYear,
  })), room.lines ?? LINE_ORDER);
  if (set) room.marketShares = set;
}

// ---------------------------------------------------------------- locking

const LOCK_NAME = 'ripple.session.v1.rooms';

// navigator.locks is typed in lib.dom, but the harness runs under a DOM-less
// Node, so this reads it defensively rather than assuming the global shape.
interface LockManagerLike {
  request<T>(name: string, cb: () => T | Promise<T>): Promise<T>;
}

function lockManager(): LockManagerLike | null {
  const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
  return nav?.locks ?? null;
}

async function withRoomLock<T>(work: () => T): Promise<T> {
  const locks = lockManager();
  if (!locks) return work();
  return locks.request(LOCK_NAME, work);
}

// ---------------------------------------------------------------- transport

export interface LocalTransportOptions {
  // Fake round-trip time. Small enough not to annoy, large enough that a
  // loading state which was never rendered is visible as a bug.
  latencyMs?: number;
}

export class LocalSessionTransport implements SessionTransport {
  readonly faults: Faults;

  constructor(opts: LocalTransportOptions = {}) {
    this.faults = new Faults(opts.latencyMs ?? 120);
  }

  // The one place latency and injected failure are applied.
  //
  // ⚠ `work` MUST STAY SYNCHRONOUS. The lock below guarantees only that no other
  // TAB is inside the critical section; an await inside `work` would reopen the
  // same lost-update window within this one.
  private async call<T>(work: () => T, exclusive = false): Promise<T> {
    const fault = this.faults.take();
    const delay = this.faults.latencyMs;
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    if (fault) throw new SessionError(fault.code, fault.message, true);
    if (!exclusive) return work();
    return withRoomLock(work);
  }

  createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
    return this.call(() => {
      if (!Number.isInteger(req.yearCount) || req.yearCount < 1) {
        throw new SessionError('INVALID_REQUEST', 'Year count must be a positive whole number.');
      }
      // ⚠ NOT VALIDATED AGAINST A CEILING, ON PURPOSE. expectedTeams is the
      // host's estimate of attendance, not a capacity — see the contract. A
      // zero or negative expectation is still nonsense, so that much is checked.
      if (!Number.isInteger(req.expectedTeams) || req.expectedTeams < 1) {
        throw new SessionError('INVALID_REQUEST', 'Expected teams must be a positive whole number.');
      }

      if (!SESSION_TOKEN_PATTERN.test(req.hostToken)) {
        throw new SessionError('INVALID_REQUEST', 'A room needs a valid host token.');
      }
      // The seed is the scenario: "1" to "20" and nothing else (ROOM_SEEDS),
      // refused here exactly as the handler refuses it.
      if (!isRoomSeed(req.seed)) {
        throw new SessionError('INVALID_REQUEST', 'The seed must be a scenario from 1 to 20.');
      }

      // ⚠ THE LINE SET IS CHECKED HERE AND NOWHERE ELSE NOW. It used to be
      // checked on every join, once per team; the host picks it once, so this is
      // the only gate and it has to be the strict one.
      const reqLines = Array.isArray(req.lines) ? req.lines : [];
      if (reqLines.length === 0) {
        throw new SessionError('INVALID_REQUEST', 'A game must use at least one coverage line.');
      }
      const notALine = reqLines.filter(l => !LINE_ORDER.includes(l));
      if (notALine.length > 0) {
        throw new SessionError('INVALID_REQUEST', `${notALine.join(', ')} is not a coverage line.`);
      }
      // Canonical order regardless of click sequence, so two hosts who pick the
      // same lines in different orders create the same room.
      const roomLines = LINE_ORDER.filter(l => reqLines.includes(l));
      // Entries for lines the room does not play are DROPPED, not refused: the
      // host screen keeps a value per line as the host toggles them, and a
      // leftover for an unticked line is not a bad request.
      const roomPriorDev: PriorDevelopment = {};
      for (const l of roomLines) {
        const v = req.priorDevelopment?.[l];
        if (typeof v === 'number' && Number.isFinite(v)) roomPriorDev[l] = v;
      }

      const store = storage();

      // ⚠ THE RETRY PATH, AND IT RETURNS SUCCESS RATHER THAN AN ERROR. A
      // createRoom whose response was lost used to make a SECOND room on retry,
      // leaving an orphan with its own code that teams could still join. The
      // same host token means the same request; hand back the room it already
      // made.
      const seen = store.getItem(IDEMPOTENCY_PREFIX + req.hostToken);
      if (seen !== null) {
        const existing = loadRoom(seen);
        return { code: existing.code, hostToken: req.hostToken, room: roomView(existing), reused: true };
      }

      let code = randomFrom(CODE_ALPHABET, 6);
      // Collision is ~1 in 10^9 per pair, but a collision would silently hand two
      // sessions the same room, so it is cheap to just not allow it.
      for (let i = 0; store.getItem(KEY_PREFIX + code) !== null && i < 50; i++) {
        code = randomFrom(CODE_ALPHABET, 6);
      }

      const now = Date.now();
      const room: RoomRecord = {
        code,
        hostToken: req.hostToken,
        seed: req.seed,
        eventName: req.eventName,
        yearCount: req.yearCount,
        startingYear: req.startingYear,
        expectedTeams: req.expectedTeams,
        lines: roomLines,
        priorDevelopment: roomPriorDev,
        currentYear: 1,
        shocks: req.shocks.map(s => ({ ...s })),
        // ⚠ A ROOM OPENS EMPTY. Teams are created by JOINING, not registered in
        // advance, because a team's name and its coverage lines are one act of
        // setup performed by the team itself.
        teams: [],
        viewers: [],
        createdAt: now,
        updatedAt: now,
        rev: 0,
      };

      store.setItem(KEY_PREFIX + code, JSON.stringify(room));
      // The index AFTER the room, so a failure between the two leaves no index
      // pointing at a room that was never written.
      store.setItem(IDEMPOTENCY_PREFIX + req.hostToken, code);
      // CREATE — the first of the four moments the listing changes. After the
      // room, for the same reason the idempotency index is: a failure between
      // them leaves no row pointing at a room that was never written.
      updateLobbyEntry(store, code, () => lobbyEntryFor(room));
      return { code, hostToken: room.hostToken, room: roomView(room, 'host'), reused: false };
    }, true);
  }

  join(req: JoinRequest): Promise<JoinResponse> {
    return this.call(() => {
      const room = loadRoom(req.code);
      const name = req.teamName.trim();
      if (name.length === 0) {
        throw new SessionError('INVALID_REQUEST', 'A team needs a name.');
      }
      const team = room.teams.find(t => t.name === name);

      // ⚠ A VIEWER WATCHES SOMETHING THAT EXISTS; A PLAYER MAY CREATE IT. That
      // is the whole asymmetry now that the roster is not pre-registered — the
      // player's join is the moment the team comes into being, so "not found"
      // is an error for one role and the normal case for the other.
      if (req.role === 'viewer' && !team) {
        throw new SessionError('TEAM_NOT_FOUND', `${name} is not a team in this room.`);
      }

      if (req.role === 'viewer' && team) {
        // A viewer never claims the team, so any number of them may watch and
        // none of them can block the driver.
        const existing = req.token
          ? room.viewers.find(v => v.token === req.token && v.teamName === team.name)
          : undefined;
        if (existing) {
          return { teamToken: existing.token, teamName: team.name, lines: [...team.lines], role: 'viewer' as const, rejoined: true, room: roomView(room, 'viewer', team.name) };
        }
        // ⚠ THE CALLER'S OWN TOKEN WHEN IT SUPPLIED ONE, so a retried viewer
        // join lands on the `existing` branch above instead of stacking a
        // second viewer record per lost response.
        const token = req.token ?? newToken();
        if (req.token) assertTokenFree(room, req.token);
        room.viewers.push({ token, teamName: team.name });
        saveRoom(room);
        return { teamToken: token, teamName: team.name, lines: [...team.lines], role: 'viewer' as const, rejoined: false, room: roomView(room, 'viewer', team.name) };
      }

      // ---- a player, on a team that already exists ------------------------
      if (team) {
        // ⚠ REJOIN BEFORE TAKEN. The same browser coming back to the same code
        // presents the token it already holds, and that is a rejoin — not a
        // second person claiming a team that is already claimed. Checking
        // TEAM_TAKEN first would lock the real driver out on a refresh.
        if (req.token && team.token === req.token) {
          // ⚠ NOTHING TO REFUSE ANY MORE. This branch used to throw LINES_LOCKED
          // when a rejoin asked for a different set. A join carries no lines, so
          // there is no disagreement to detect — the team plays the room's lines
          // on the first join and on every return, and that is the same set by
          // construction rather than by a check.
          return { teamToken: team.token, teamName: team.name, lines: [...team.lines], role: 'player' as const, rejoined: true, room: roomView(room, 'player', team.name) };
        }
        // The name is the identity now, so a second person arriving with a name
        // already in the room is a COLLISION rather than a claim on a seat.
        throw new SessionError('TEAM_TAKEN', `A team called ${team.name} is already in this room.`);
      }

      // ---- a player creating its team -------------------------------------
      // ⚠ THE SERVER REFUSES A LATE TEAM, NOT ONLY THE SCREEN. Reached only on
      // the CREATING path: every rejoin returned above, and a viewer returned
      // further above still, so neither is caught by this. A team arriving
      // after the host's first advance would be starting at a year the room has
      // already played, with no decisions on record for the years behind it.
      //
      // ⚠ AND IT KEYS ON STATUS, NOT ON WHETHER THE EVENT IS LISTED. A hidden
      // OPEN event still takes new teams; a listed IN_PROGRESS one still
      // refuses them. See SetEventHiddenRequest.
      const status = eventStatusOf(room.currentYear, room.yearCount);
      if (!mayCreateTeam(status)) {
        throw new SessionError(
          'EVENT_IN_PROGRESS',
          status === 'FINISHED'
            ? 'This event has finished, so no new teams can join.'
            : `This event is already in year ${room.currentYear}, so no new teams can join. `
              + 'You can still watch it as a viewer.',
        );
      }

      // ⚠ THE ROOM'S LINES, NOT THE REQUEST'S. There is nothing to validate here
      // any more: the set was checked once, when the host created the room, and
      // a team cannot propose another. A stale client that still sends `lines`
      // is IGNORED rather than refused — it joins and plays the room's set,
      // which is the behaviour the contract asks a server for.
      const lines = [...(room.lines ?? LINE_ORDER)];

      // ⚠ THE CLIENT'S TOKEN, WHICH IS WHAT MAKES THE FIRST JOIN REPLAYABLE.
      // The team is created owning a secret the caller ALREADY HOLDS, so if the
      // response is lost the retry presents the same token, matches on the
      // rejoin path above and gets its seat back. While the server minted it,
      // the only copy went down a socket nobody was listening on and the retry
      // read as a second person taking a claimed name — TEAM_TAKEN, in front of
      // a room. assertTokenFree is what stops this being a way to CLAIM a seat:
      // a token already owned by anyone else in the room is refused.
      const token = req.token ?? newToken();
      if (req.token) assertTokenFree(room, req.token);
      const created: TeamRecord = {
        name,
        // Canonical WC/GL/Property order regardless of click sequence, so two
        // teams with the same choice compare equal everywhere they are shown.
        lines: LINE_ORDER.filter(l => lines.includes(l)),
        token,
        joined: true,
        lockedYear: null,
        decisionsByYear: {},
        resultsByYear: {},
      };
      room.teams.push(created);
      saveRoom(room);
      // Not one of the four moments, but the row carries a team COUNT and the
      // lobby shows it — a listing that said "0 teams so far" under a room six
      // people had joined would be worse than no count at all.
      updateLobbyEntry(storage(), room.code, () => lobbyEntryFor(room));
      return { teamToken: token, teamName: created.name, lines: [...created.lines], role: 'player' as const, rejoined: false, room: roomView(room, 'player', created.name) };
    }, true);
  }

  submit(req: SubmitRequest): Promise<SubmitResponse> {
    return this.call(() => {
      const room = loadRoom(req.code);
      const { role, team } = callerOf(room, req.token);
      if (role !== 'player' || !team) {
        throw new SessionError('BAD_TOKEN', 'Only a team player may submit.');
      }
      if (req.decisions === undefined && req.result === undefined) {
        throw new SessionError('INVALID_REQUEST', 'Nothing to submit.');
      }

      if (req.decisions !== undefined) {
        // Decisions are for the room's current year or they are stale — a tab
        // that sat on a screen while the host advanced must not overwrite the
        // new year with the old one's choices.
        if (req.yearNumber !== room.currentYear) {
          throw new SessionError(
            'WRONG_YEAR',
            `The room is on year ${room.currentYear}; those decisions are for year ${req.yearNumber}.`,
          );
        }
        // ⚠ RECORDED AGAINST ITS YEAR, NOT INTO A SLOT. Re-submitting the same
        // year overwrites that year and leaves every other year alone, which is
        // what makes a reload able to replay what was actually played.
        team.decisionsByYear[String(req.yearNumber)] = req.decisions;
        team.lockedYear = req.yearNumber;
      }

      if (req.result !== undefined) {
        // ⚠ A RESULT IS FOR A YEAR ALREADY PROCESSED, so it legitimately arrives
        // for a year BEHIND the room's current one: the host advances, the
        // clients then compute, and they post what they computed. Only a result
        // from the FUTURE is incoherent.
        if (req.yearNumber > room.currentYear) {
          throw new SessionError(
            'WRONG_YEAR',
            `Cannot post a result for year ${req.yearNumber}; the room is on year ${room.currentYear}.`,
          );
        }
        // ⚠ YEAR 0 IS ALLOWED AND IS THE OPENING POSITION; BELOW IT IS NOT. The
        // pre-game's earlier years built that position and are not part of the
        // session — a room that accepted them would be holding scaffolding it
        // has no screen for.
        if (req.yearNumber < 0) {
          throw new SessionError(
            'WRONG_YEAR',
            `Year ${req.yearNumber} is before the opening position; results start at year 0.`,
          );
        }
        // ⚠ RECORDED AGAINST ITS YEAR. A re-post of the same year (which a
        // reloaded tab does) replaces that year and leaves every other alone.
        team.resultsByYear[String(req.yearNumber)] = req.result;
        storeSharesIfComplete(room, req.yearNumber);
      }

      saveRoom(room);
      return { room: roomView(room, role, team.name), you: callerView(role, team, room) };
    }, true);
  }

  /**
   * ⚠ A COMPARE-AND-SWAP ON THE ROOM'S CURRENT YEAR, AND THE ORDER OF THE FOUR
   * CASES BELOW IS LOAD-BEARING.
   *
   * `advance` increments, so a retried request — which is what a client sends
   * when a response is lost — used to SKIP A YEAR, and every team then reported
   * against a year nobody played. The two requests are byte-identical from the
   * server's side; `expectedYear` is what makes them distinguishable.
   *
   * ⚠ WRITTEN SO THE LAMBDA INHERITS IT. On DynamoDB this is one conditional
   * update on the HEADER item and only there: condition `currentYear = the
   * expected year`, still inside the year count, host token matches. On a
   * failed condition the handler reads the header back and distinguishes
   * exactly the four cases below. Here the lock makes the read-modify-write
   * atomic so the "readback" is just the record in hand — but the CASES are the
   * contract, and they are written out rather than collapsed so the hosted
   * implementation has something to match.
   *
   *   1. token mismatch            NOT_HOST   (BAD_TOKEN if it is nobody's)
   *   2. already at expected + 1   A RETRY — success, no write
   *   3. past the year count       GAME_COMPLETE
   *   4. anything else             WRONG_YEAR
   *
   * ⚠ CASE 2 PRECEDES CASE 3, AND SWAPPING THEM BREAKS THE LAST ADVANCE OF
   * EVERY GAME. Take yearCount 3 with the room on 4: a retry carrying
   * expectedYear 3 is a retry of the advance that COMPLETED the game and must
   * return success, while a fresh call carrying expectedYear 4 is a genuine
   * attempt to advance past the end and must be GAME_COMPLETE. Both see
   * `currentYear > yearCount`; only the expectation tells them apart.
   *
   * ⚠ AND A RETRY SUCCEEDS RATHER THAN FAILING POLITELY. Returning an error
   * saying "it already happened" would report a failure for an operation that
   * worked, to a host who can do nothing about it. `advanced` says which path
   * ran, so a caller that cares can tell.
   *
   * ⚠ THE WINDOW IS ONE YEAR WIDE, WHICH IS A REAL LIMIT AND NOT A BUG. A host
   * on a stale screen whose room has moved on by exactly one gets a success and
   * no second advance — indistinguishable from a retry, by construction, and
   * the safe failure of the two. Two or more years stale is WRONG_YEAR.
   */
  // ---------------------------------------------------------------- lobby
  // ⚠ NO PARAMETER, WHICH SATISFIES THE INTERFACE. ListEventsRequest is an
  // empty object — the lobby takes no filter — so naming an argument only to
  // ignore it is a lint error with nothing to say.
  listEvents(): Promise<ListEventsResponse> {
    return this.call(() => {
      const store = storage();
      const index = loadLobbyIndex(store);
      const events: LobbyEvent[] = [];
      let pruned = false;

      for (const entry of Object.values(index)) {
        // ⚠ THE ROOM IS THE AUTHORITY, NOT THE ROW. The index is derived data
        // and can be stale in either direction; a row is only ever a pointer.
        // Reading the room back is what the hosted side does with a BatchGet
        // and what keeps a stale status from being served.
        const raw = store.getItem(KEY_PREFIX + entry.code);
        if (raw === null) {
          // SKIP AN EXPIRED ROOM, AND FORGET IT. Locally a room expires by
          // being cleared; on the table it expires by TTL. Either way the row
          // outlives it, and a lobby that listed events nobody can open would
          // be worse than one that listed none.
          delete index[entry.code];
          pruned = true;
          continue;
        }
        let room: RoomRecord;
        try { room = JSON.parse(raw) as RoomRecord; } catch { continue; }

        if (room.hidden) continue;
        const status = eventStatusOf(room.currentYear, room.yearCount);
        // FINISHED EVENTS DROP OFF. The room keeps running for the teams in it
        // — they read their results by code until it expires — it simply stops
        // being something to walk up to.
        if (status === 'FINISHED') continue;

        events.push({
          code: room.code,
          eventName: room.eventName,
          status,
          teams: room.teams.filter(t => t.joined).length,
          currentYear: room.currentYear,
          yearCount: room.yearCount,
        });
      }
      if (pruned) store.setItem(LOBBY_KEY, JSON.stringify(index));

      // OPEN first — the rows a player can act on — then IN_PROGRESS; each
      // newest first, so a workshop opened minutes ago is at the top.
      const rank = (e: LobbyEvent) => (e.status === 'OPEN' ? 0 : 1);
      events.sort((a, b) => rank(a) - rank(b)
        || (index[b.code]?.updatedAt ?? 0) - (index[a.code]?.updatedAt ?? 0));
      return { events };
    }, true);
  }

  setEventHidden(req: SetEventHiddenRequest): Promise<SetEventHiddenResponse> {
    return this.call(() => {
      const room = loadRoom(req.code);
      // Authority first, as everywhere else here: a non-host must not learn
      // anything about the room from the shape of the refusal.
      const { role } = callerOf(room, req.token);
      if (role !== 'host') {
        throw new SessionError('NOT_HOST', 'Only the host may hide an event.');
      }
      if (typeof req.hidden !== 'boolean') {
        throw new SessionError('INVALID_REQUEST', 'hidden must be true or false.');
      }
      // ⚠ IDEMPOTENT, AND SILENTLY SO. Hiding a hidden event is a no-op that
      // SUCCEEDS rather than an error: the caller asked for a state, the state
      // holds, and a toggle that threw on a double click would be a worse
      // contract than one that agrees.
      if ((room.hidden ?? false) === req.hidden) {
        return { room: roomView(room) };
      }
      room.hidden = req.hidden;
      saveRoom(room);
      // HIDE — the fourth moment. The row stays in the index carrying the flag
      // rather than being deleted, so unhiding is a flag flip and not a
      // rebuild, and `listEvents` filters on it.
      updateLobbyEntry(storage(), room.code, () => lobbyEntryFor(room));
      return { room: roomView(room) };
    }, true);
  }

  advance(req: AdvanceRequest): Promise<AdvanceResponse> {
    return this.call(() => {
      const room = loadRoom(req.code);
      if (!Number.isInteger(req.expectedYear)) {
        throw new SessionError('INVALID_REQUEST', 'advance needs the year the caller expects the room to be on.');
      }
      // 1. Authority first: a non-host must not learn the room's year from the
      //    shape of the refusal.
      const { role } = callerOf(room, req.token);
      if (role !== 'host') {
        throw new SessionError('NOT_HOST', 'Only the host may advance the year.');
      }
      // 2. The retry. No write, and success.
      if (room.currentYear === req.expectedYear + 1) {
        return { room: roomView(room, 'host'), currentYear: room.currentYear, advanced: false };
      }
      // 3. Past the end.
      if (room.currentYear > room.yearCount) {
        throw new SessionError('GAME_COMPLETE', 'The game is already complete.');
      }
      // 4. A stale or invented expectation.
      if (room.currentYear !== req.expectedYear) {
        throw new SessionError(
          'WRONG_YEAR',
          `The room is on year ${room.currentYear}; that request expected year ${req.expectedYear}.`,
        );
      }

      room.currentYear += 1;
      saveRoom(room);
      // START and FINISH, the second and third of the four moments. Both are
      // this one line because both are an advance: the first takes the event
      // OPEN -> IN_PROGRESS, the last IN_PROGRESS -> FINISHED. Writing the
      // entry on EVERY advance rather than only on those two keeps the row's
      // currentYear honest for the lobby, and costs one small write a year.
      updateLobbyEntry(storage(), room.code, () => lobbyEntryFor(room));
      return { room: roomView(room, 'host'), currentYear: room.currentYear, advanced: true };
    }, true);
  }

  read(req: ReadRequest): Promise<ReadResponse> {
    return this.call(() => {
      const room = loadRoom(req.code);
      const { role, team } = callerOf(room, req.token);
      return { room: roomView(room, role, team?.name), you: callerView(role, team, room) };
    });
  }
}
