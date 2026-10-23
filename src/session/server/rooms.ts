// ============================================================================
// THE DYNAMODB IMPLEMENTATION of SessionTransport — the third one, and the one
// that runs in the Lambda.
//
// ⚠ localTransport.ts IS THE REFERENCE FOR EVERY RULE; keys.ts IS THE
// REFERENCE FOR EVERY KEY AND EVERY CONDITION. This file must behave exactly like
// LocalSessionTransport against DynamoDB instead of localStorage, and
// scripts/tools/session-contract-check.ts --dynamo is the proof: the same
// assertions, unmodified, in-process here and over HTTP through handler.ts.
//
// ============================================================================
// ⚠ THERE IS NO LOCK HERE, AND EVERYTHING THE LOCK WAS DOING HAS TO BE DONE BY
// A CONDITION INSTEAD.
//
// localTransport runs every mutation inside navigator.locks, so its
// read-check-write is atomic for free. Concurrent Lambda invocations are
// genuinely parallel processes, so every check that a later write depends on
// must be re-asserted by that write's ConditionExpression — or it is a
// check of a state that may already be gone. keys.ts's condition table covers
// most of it. Ported rule-for-rule it does NOT cover four things the lock was
// also holding up, each found by asking "what would two of these at once do?":
//
//   1. THE TOKEN-COLLISION GUARD. localTransport refuses a client-supplied
//      token already owned by the host, a team or a viewer (assertTokenFree).
//      That is a read of three places followed by a write, and the roster's
//      tokenHash cannot be conditioned on — DynamoDB cannot express "no map
//      entry has this value". Two joins presenting one token for two different
//      names would both pass the read and both write: two seats, one token.
//      Fixed by a TOKEN#<hash> claim item per player token (keys.ts tokenSk),
//      put with attribute_not_exists in the same transaction as the team, with
//      a ConditionCheck that VIEW#<hash> is absent; a viewer's put of
//      VIEW#<hash> carries the mirror ConditionCheck on TOKEN#<hash>. The host
//      token is fixed at creation, so checking it against the header is not a
//      race.
//
//   2. A FAILED CONDITION IS NOT AUTOMATICALLY THE ERROR IT GUARDS. Under the
//      lock, a retried join (same token, lost response) always saw the team its
//      first attempt made, and landed on the rejoin path. Without it, the retry
//      can read the header BEFORE the first attempt's transaction lands, decide
//      "new team", and then fail the NAME# condition. Mapping that straight to
//      TEAM_TAKEN — which is what keys.ts's table says — answers TEAM_TAKEN to
//      the player who just made the team, the exact failure client-minted tokens
//      exist to prevent. So a failed join condition RE-READS and decides again,
//      the same shape as advance's readback: the second read sees the team, the
//      token matches, and it is a rejoin.
//
//   3. createRoom's INDEX PUT WAS UNCONDITIONAL. keys.ts says Put ROOM, then Put
//      CREATE#<hash> — under the lock, the GetItem CREATE# that precedes them
//      was enough. Two concurrent creates with the same host token (a retry
//      sent while the first was still in flight) both miss the index, both make
//      a room, and the second index put silently replaces the first: two rooms,
//      two codes handed back for one request, one of them orphaned. Fixed by
//      conditioning the index put on attribute_not_exists; the loser returns the
//      winner's room with reused: true and deletes its own unreachable header.
//
//   4. THE RESPONSE WAS A SNAPSHOT. Under the lock, the roomView a mutation
//      returns is exactly the state its write produced. Here it is a follow-up
//      read (a transaction cannot return values), and it is read HEADER FIRST,
//      ITEMS SECOND, never in parallel. A header read at rev r followed by a
//      query can only see items at r or newer — the caller stores r and its
//      next poll refetches. The reverse order can pair items at r with a header
//      at r+1, and the caller would store r+1 as its ETag while missing the item
//      that made it r+1: the lost update in keys.ts's fourth form. Every view in
//      this file is built by `viewFor`, which reads in that order.
//
// And one the conditions DO cover but that a port can still get wrong: advance's
// four-case readback. See advance().
//
// ============================================================================
// ⚠ WHAT IS MEASURED, AND WHAT NOTHING MEASURES. Each protection in this file
// was deleted in turn and the instruments re-run. The 144 contract assertions
// caught TWO of sixteen deletions (decisions handed to the host; the handler
// dropping the error code). scripts/tools/session-race-probe.ts caught ten
// more, each by a probe named for it. FOUR SURVIVE BOTH, and stay unmeasured
// until someone builds the instrument:
//
//   1. THE TransactionConflict RETRY in transact(). DynamoDB Local raised ZERO
//      conflicts for twenty simultaneous transactions on one header item (probe
//      F reports the count), so it evidently serialises them, and the retry
//      loop has never executed. Deleting it changes no result. On real DynamoDB
//      this is the burst after every advance, keys.ts HARD 1. Twenty-five to
//      forty-five teams is the planned event, and nothing here has seen the
//      sustained case. Only a load test against a real table measures it.
//   2. THE ANY-ITEM CHECK ON A NEW ROOM CODE in createRoom. Codes are random and
//      not injectable, so no test can make one collide with an expired room's
//      leftover items. Deleting the check changes no result.
//   3. THE LOSER'S ORPHAN DELETE in createRoom's same-token race. Probe C proves
//      both callers get one code; nothing checks the losing header is gone. If
//      the delete fails, the cost is one unreachable item until TTL.
//   4. EXHAUSTING MAX_ATTEMPTS. Every probe settles on the second pass; nothing
//      sustains contention on one name or token long enough to reach the
//      fallback errors.
//
// And what DynamoDB Local is not. It never runs TTL, so expiry is tested only
// through the stamp (probe G). It does not enforce IAM or throttle. The 144 run
// over HTTP through a shim that builds the API Gateway v2 event; a real
// gateway's event (stage prefix, base64 body) is handled in handler.ts but has
// only been seen through that shim.
//
// HOW THE PROBES GET THEIR CONCURRENCY, so nobody over-reads them. Most are
// SEQUENTIAL CALLS ARRANGED INTO A RACE'S EXACT INTERLEAVING. The request under
// test is held between its header read and its write, and the competing request
// runs to completion inside that gap. That is deterministic, so a passing run
// means the window was hit every time, not that it was missed. It covers only
// the "one request wholly inside another's window" shape. When two transactions
// overlap at DynamoDB itself, the outcome is a conflict, which Local does not
// produce (see 1). Four probes (A∥, B∥, C, F) fire genuinely parallel requests
// from one process. A∥ and B∥ do catch their deletions, but only by hitting
// the window by chance, so they are corroboration, not proof.
// ============================================================================

import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
  type CancellationReason,
} from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand,
  TransactWriteCommand, UpdateCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type {
  AdvanceRequest, AdvanceResponse,
  CallerRole,
  CreateRoomRequest, CreateRoomResponse,
  JoinRequest, JoinResponse,
  JsonValue,
  ListEventsResponse, LobbyEvent,
  PriorDevelopment,
  ReadRequest, ReadResponse,
  SetEventHiddenRequest, SetEventHiddenResponse,
  SessionTransport,
  SubmitRequest, SubmitResponse,
  TeamYearSummary,
} from '../contract';
import { SessionError, SESSION_TOKEN_PATTERN, isRoomSeed, newSessionToken, eventStatusOf, mayCreateTeam } from '../contract';
import { Faults } from '../faults';
import type { CoverageLine } from '../../types/simulation';
import {
  CREATE_SK, LOBBY_PK, LOBBY_SK, PIN_SK, RESULT_PREFIX, ROOM_HEADER_SK,
  createPk, decisionPrefix, decisionSk, lobbyEventPath, nameSk, pinPk, resultPrefix, resultSk, roomPk,
  tokenSk, viewerSk,
} from './keys';
import {
  dynamoFromEnv, hashToken, newRoomCode, newTeamId, newViewerPin, type Dynamo, type DynamoConfig,
} from './dynamo';
import {
  buildCallerView, buildRoomView, type Fetched, type RoomHeader, type RosterEntry, type YearItem,
} from './views';

const LINE_ORDER: CoverageLine[] = ['WC', 'GL', 'Property'];

/**
 * The most years a room may have. padYear refuses 1000, and the room's
 * currentYear reaches yearCount + 1 when it completes; a result is never posted
 * past yearCount, so 998 keeps every key a write can build inside three digits.
 * localTransport has no ceiling because it has no key to overflow.
 */
const MAX_YEAR_COUNT = 998;

/** How many times a mutation re-reads and re-decides after losing a race. */
const MAX_ATTEMPTS = 5;

// sameLines is gone with LINES_LOCKED: a join carries no lines, so there are
// never two sets to compare.

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function requireString(v: unknown, what: string): string {
  if (!isString(v)) throw new SessionError('INVALID_REQUEST', `${what} must be a string.`);
  return v;
}

function requireInteger(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new SessionError('INVALID_REQUEST', `${what} must be a whole number.`);
  }
  return v;
}

function nowSec(ms: number): number {
  return Math.floor(ms / 1000);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- transactions

type TransactItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

/**
 * The outcome of a transaction: it committed, or a named item's condition
 * failed. A TransactionConflict — another transaction on the same item at the
 * same moment, which is keys.ts HARD 1 and expected in the burst after an
 * advance — is retried here with jitter rather than surfaced: it says nothing
 * about the request, only about timing.
 */
type TxOutcome = { ok: true } | { ok: false; failed: number[] };

// ---------------------------------------------------------------- transport

export interface DynamoTransportOptions extends DynamoConfig {
  /** An already-built client — the handler shares one across warm invocations. */
  dynamo?: Dynamo;
  /** Client-side latency, as the other two transports have. Zero by default. */
  latencyMs?: number;
}

export class DynamoSessionTransport implements SessionTransport {
  readonly faults: Faults;
  private readonly db: Dynamo;

  constructor(opts: DynamoTransportOptions = {}) {
    this.db = opts.dynamo ?? dynamoFromEnv(opts);
    this.faults = new Faults(opts.latencyMs ?? 0);
  }

  // ⚠ THE SAME INJECTABLE FAULT AS THE OTHER TWO, so the harness's failure block
  // runs here unweakened. And anything that is not a SessionError — the SDK
  // throwing, DynamoDB throttling past the SDK's own retries — leaves as a
  // RETRYABLE TRANSPORT_FAILURE, because it is the pipe and not the request.
  private async call<T>(work: () => Promise<T>): Promise<T> {
    const fault = this.faults.take();
    if (this.faults.latencyMs > 0) await sleep(this.faults.latencyMs);
    if (fault) throw new SessionError(fault.code, fault.message, true);
    try {
      return await work();
    } catch (e) {
      if (e instanceof SessionError) throw e;
      // A key builder refusing its input (a 1 KB team name, say) is the request.
      if (e instanceof RangeError) throw new SessionError('INVALID_REQUEST', e.message);
      throw new SessionError(
        'TRANSPORT_FAILURE',
        `The session store failed: ${e instanceof Error ? e.message : String(e)}`,
        true,
      );
    }
  }

  // ---- reads -----------------------------------------------------------

  /** A header past its expiry is gone, whether or not TTL has removed it yet. */
  private live(item: Record<string, unknown> | undefined, code: string): RoomHeader {
    const header = item as RoomHeader | undefined;
    if (!header || header.expiresAtSec <= nowSec(Date.now())) {
      throw new SessionError('ROOM_NOT_FOUND', `No room with code ${code}.`);
    }
    return header;
  }

  private async getHeader(code: string): Promise<RoomHeader> {
    const res = await this.db.doc.send(new GetCommand({
      TableName: this.db.table,
      Key: { pk: roomPk(code), sk: ROOM_HEADER_SK },
      ConsistentRead: true,
    }));
    return this.live(res.Item, code);
  }

  /**
   * The header and, when a token is presented, its VIEW# item — keys.ts READ
   * step 1, every role resolvable in one round trip.
   */
  private async getHeaderAndViewer(code: string, tokenHash: string | null) {
    if (!tokenHash) return { header: await this.getHeader(code), viewerTeamId: null };
    const header = roomPk(code);
    let keys: Array<Record<string, string>> = [
      { pk: header, sk: ROOM_HEADER_SK },
      { pk: header, sk: viewerSk(tokenHash) },
    ];
    const found: Record<string, unknown>[] = [];
    for (let i = 0; keys.length > 0; i++) {
      if (i > 0) await sleep(Math.min(200, 10 * 2 ** i));
      const res = await this.db.doc.send(new BatchGetCommand({
        RequestItems: { [this.db.table]: { Keys: keys, ConsistentRead: true } },
      }));
      found.push(...(res.Responses?.[this.db.table] ?? []));
      keys = (res.UnprocessedKeys?.[this.db.table]?.Keys ?? []) as Array<Record<string, string>>;
      if (i > 8 && keys.length > 0) throw new Error('BatchGetItem left keys unprocessed.');
    }
    const head = found.find(x => x.sk === ROOM_HEADER_SK);
    const view = found.find(x => x.sk !== ROOM_HEADER_SK) as { teamId?: string } | undefined;
    return { header: this.live(head, code), viewerTeamId: view?.teamId ?? null };
  }

  private async getViewerTeamId(code: string, tokenHash: string): Promise<string | null> {
    const res = await this.db.doc.send(new GetCommand({
      TableName: this.db.table,
      Key: { pk: roomPk(code), sk: viewerSk(tokenHash) },
      ConsistentRead: true,
    }));
    return (res.Item as { teamId?: string } | undefined)?.teamId ?? null;
  }

  /**
   * A viewer PIN resolved to the room+team it names, or null — never throws.
   * join() still re-reads the room header itself afterward (header first,
   * items second), so an expired room is caught there as ROOM_NOT_FOUND
   * whether or not this index item has been swept by TTL yet — see keys.ts.
   */
  private async resolvePin(pin: string): Promise<{ code: string; teamId: string } | null> {
    const res = await this.db.doc.send(new GetCommand({
      TableName: this.db.table,
      Key: { pk: pinPk(pin), sk: PIN_SK },
      ConsistentRead: true,
    }));
    const item = res.Item as { code?: string; teamId?: string } | undefined;
    if (!item?.code || !item.teamId) return null;
    return { code: item.code, teamId: item.teamId };
  }

  private async queryPrefix(pk: string, prefix: string): Promise<YearItem[]> {
    const out: YearItem[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const res = await this.db.doc.send(new QueryCommand({
        TableName: this.db.table,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': pk, ':p': prefix },
        ConsistentRead: true,
        ExclusiveStartKey: start,
      }));
      out.push(...((res.Items ?? []) as YearItem[]));
      start = res.LastEvaluatedKey;
    } while (start);
    return out;
  }

  /**
   * Resolve a token against a header — localTransport's callerOf.
   *
   * ⚠ AUTHORITY IS DECIDED HERE AND ONLY HERE, by hash. The viewer lookup is an
   * item read, so callers that already batched it pass the answer in; those
   * that did not get it fetched only when the token is neither host nor player.
   */
  private async resolve(
    header: RoomHeader,
    token: string | undefined,
    viewerTeamId?: string | null,
  ): Promise<{ role: CallerRole; teamId: string | null }> {
    if (token === undefined || token === null || token === '') return { role: 'anonymous', teamId: null };
    if (!isString(token)) throw new SessionError('INVALID_REQUEST', 'token must be a string.');
    const h = hashToken(token);
    if (h === header.hostTokenHash) return { role: 'host', teamId: null };
    for (const [teamId, entry] of Object.entries(header.roster ?? {})) {
      if (entry.tokenHash === h) return { role: 'player', teamId };
    }
    const watched = viewerTeamId !== undefined ? viewerTeamId : await this.getViewerTeamId(header.code, h);
    // A VIEW# item whose team is not in the roster cannot happen (teams are
    // never removed), and is treated as watching nothing, as callerOf does.
    if (watched) return { role: 'viewer', teamId: header.roster?.[watched] ? watched : null };
    throw new SessionError('BAD_TOKEN', 'That token does not belong to this room.');
  }

  /**
   * ⚠ THE ONLY PLACE A VIEW IS BUILT, AND THE QUERY IS CHOSEN BY ROLE.
   *
   *   host       every team's results     (begins_with R#)
   *   player     its own decisions        (begins_with D#<teamId>#)
   *              and its own results      (begins_with R#<teamId>#)
   *   viewer     as the player it watches
   *   anonymous  the header alone
   *
   * ⚠ THE HOST NEVER QUERIES D#. Privacy by code, not by key (keys.ts HARD 6).
   *
   * ⚠ A PLAYER NEEDS ITS OWN R# RANGE, which keys.ts's READ table omits. It
   * lists the player's query as D# alone with postedYears from the roster —
   * true for postedYears, but CallerView.lastResult is the payload of the
   * highest played year, and the harness asserts a player's own resultsByYear
   * off its submit response. So a player pays one more small Query.
   *
   * ⚠ THE HEADER MUST ALREADY HAVE BEEN READ when this runs — header first,
   * items second. See the file header, point 4.
   */
  private async viewFor(header: RoomHeader, role: CallerRole, teamId: string | null) {
    const pk = roomPk(header.code);
    const fetched: Fetched = { results: new Map(), decisions: new Map() };
    const resultItems: YearItem[] = [];
    if (role === 'host') {
      resultItems.push(...await this.queryPrefix(pk, RESULT_PREFIX));
    } else if ((role === 'player' || role === 'viewer') && teamId) {
      for (const item of await this.queryPrefix(pk, decisionPrefix(teamId))) {
        const held = fetched.decisions.get(item.teamId) ?? {};
        held[String(item.year)] = JSON.parse(item.body) as JsonValue;
        fetched.decisions.set(item.teamId, held);
      }
      resultItems.push(...await this.queryPrefix(pk, resultPrefix(teamId)));
    }
    for (const item of resultItems) {
      const held = fetched.results.get(item.teamId) ?? {};
      held[String(item.year)] = JSON.parse(item.body) as TeamYearSummary;
      fetched.results.set(item.teamId, held);
    }
    const entry = teamId ? header.roster?.[teamId] ?? null : null;
    return {
      room: buildRoomView(header, fetched, role),
      you: buildCallerView(role, teamId, entry, fetched),
    };
  }

  /** A fresh header, then the view — what every mutation returns. */
  private async freshView(code: string, role: CallerRole, teamId: string | null) {
    return this.viewFor(await this.getHeader(code), role, teamId);
  }

  private async transact(items: TransactItem[]): Promise<TxOutcome> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.db.doc.send(new TransactWriteCommand({ TransactItems: items }));
        return { ok: true };
      } catch (e) {
        if (!(e instanceof TransactionCanceledException)) throw e;
        const reasons: CancellationReason[] = e.CancellationReasons ?? [];
        const failed = reasons
          .map((r, i) => (r.Code === 'ConditionalCheckFailed' ? i : -1))
          .filter(i => i >= 0);
        if (failed.length > 0) return { ok: false, failed };
        const conflict = reasons.some(r => r.Code === 'TransactionConflict');
        if (!conflict || attempt >= 8) throw e;
        await sleep(Math.random() * Math.min(500, 20 * 2 ** attempt));
      }
    }
  }

  // ---- createRoom ------------------------------------------------------

  createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
    return this.call(async () => {
      if (!Number.isInteger(req.yearCount) || req.yearCount < 1) {
        throw new SessionError('INVALID_REQUEST', 'Year count must be a positive whole number.');
      }
      if (req.yearCount > MAX_YEAR_COUNT) {
        throw new SessionError('INVALID_REQUEST', `A game may run at most ${MAX_YEAR_COUNT} years.`);
      }
      // ⚠ NOT VALIDATED AGAINST A CEILING, ON PURPOSE — see the contract.
      if (!Number.isInteger(req.expectedTeams) || req.expectedTeams < 1) {
        throw new SessionError('INVALID_REQUEST', 'Expected teams must be a positive whole number.');
      }
      if (!isString(req.hostToken) || !SESSION_TOKEN_PATTERN.test(req.hostToken)) {
        throw new SessionError('INVALID_REQUEST', 'A room needs a valid host token.');
      }
      requireString(req.seed, 'seed');
      // The seed is the scenario: "1" to "20" and nothing else (ROOM_SEEDS).
      if (!isRoomSeed(req.seed)) {
        throw new SessionError('INVALID_REQUEST', 'The seed must be a scenario from 1 to 20.');
      }
      requireString(req.eventName, 'eventName');
      // Optional: a client older than this handler sends none (the event name stands in).
      if (req.poolName !== undefined) requireString(req.poolName, 'poolName');
      const poolName = req.poolName?.trim() ?? '';
      requireInteger(req.startingYear, 'startingYear');
      // ⚠ THE ONLY LINE-SET GATE IN THE SERVER NOW. It used to run per join;
      // the host picks once, so this is it.
      const reqLines = Array.isArray(req.lines) ? req.lines : [];
      if (reqLines.length === 0) {
        throw new SessionError('INVALID_REQUEST', 'A game must use at least one coverage line.');
      }
      const notALine = reqLines.filter(l => !LINE_ORDER.includes(l));
      if (notALine.length > 0) {
        throw new SessionError('INVALID_REQUEST', `${notALine.join(', ')} is not a coverage line.`);
      }
      const roomLines = LINE_ORDER.filter(l => reqLines.includes(l));
      // Entries for lines the room does not play are dropped, not refused.
      const roomPriorDev: PriorDevelopment = {};
      for (const l of roomLines) {
        const v = req.priorDevelopment?.[l];
        if (typeof v === 'number' && Number.isFinite(v)) roomPriorDev[l] = v;
      }
      if (!Array.isArray(req.shocks)) throw new SessionError('INVALID_REQUEST', 'shocks must be a list.');
      const shocks = req.shocks.map(s => ({
        shockId: requireString(s?.shockId, 'shockId'),
        yearNumber: requireInteger(s?.yearNumber, 'a shock yearNumber'),
      }));

      const hostTokenHash = hashToken(req.hostToken);
      const indexKey = { pk: createPk(hostTokenHash), sk: CREATE_SK };

      // ⚠ THE RETRY PATH, AND IT RETURNS SUCCESS RATHER THAN AN ERROR.
      const reuse = async (): Promise<CreateRoomResponse | null> => {
        const seen = await this.db.doc.send(new GetCommand({
          TableName: this.db.table, Key: indexKey, ConsistentRead: true,
        }));
        const code = (seen.Item as { code?: string } | undefined)?.code;
        if (!code) return null;
        const view = await this.freshView(code, 'host', null);
        return { code, hostToken: req.hostToken, room: view.room, reused: true };
      };
      const existing = await reuse();
      if (existing) return existing;

      const now = Date.now();
      // Set ONCE, here. Every later write on this room copies it verbatim.
      const expiresAtSec = nowSec(now) + this.db.retentionSec;

      let code: string | null = null;
      for (let i = 0; i < 50 && code === null; i++) {
        const candidate = newRoomCode();
        // ⚠ ANY ITEM, NOT JUST A HEADER. attribute_not_exists below guards only
        // the header; a code whose expired room still has D#/R# items lingering
        // before TTL reaches them would otherwise inherit them (keys.ts).
        const occupied = await this.db.doc.send(new QueryCommand({
          TableName: this.db.table,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': roomPk(candidate) },
          ConsistentRead: true,
          Limit: 1,
        }));
        if ((occupied.Items ?? []).length > 0) continue;
        const header: RoomHeader = {
          pk: roomPk(candidate),
          sk: ROOM_HEADER_SK,
          code: candidate,
          seed: req.seed,
          eventName: req.eventName,
          ...(poolName ? { poolName } : {}),
          yearCount: req.yearCount,
          startingYear: req.startingYear,
          expectedTeams: req.expectedTeams,
          lines: roomLines,
          priorDevelopment: roomPriorDev,
          currentYear: 1,
          shocks,
          // ⚠ A ROOM OPENS EMPTY. Teams are created by JOINING.
          roster: {},
          createdAt: now,
          updatedAt: now,
          rev: 0,
          expiresAtSec,
          hostTokenHash,
        };
        try {
          await this.db.doc.send(new PutCommand({
            TableName: this.db.table,
            Item: header,
            ConditionExpression: 'attribute_not_exists(pk)',
          }));
          code = candidate;
        } catch (e) {
          if (!(e instanceof ConditionalCheckFailedException)) throw e;
        }
      }
      if (code === null) {
        throw new SessionError('TRANSPORT_FAILURE', 'Could not find a free room code.', true);
      }

      // ⚠ THE INDEX AFTER THE ROOM, NEVER BEFORE — and CONDITIONED, which keys.ts
      // does not say. See the file header, point 3.
      try {
        await this.db.doc.send(new PutCommand({
          TableName: this.db.table,
          Item: { ...indexKey, code, expiresAtSec },
          ConditionExpression: 'attribute_not_exists(pk)',
        }));
      } catch (e) {
        if (!(e instanceof ConditionalCheckFailedException)) throw e;
        // A concurrent create with this same token won. Its room is THE room;
        // ours was never handed to anyone and nothing can reach it, so it goes.
        await this.db.doc.send(new DeleteCommand({
          TableName: this.db.table, Key: { pk: roomPk(code), sk: ROOM_HEADER_SK },
        })).catch(() => undefined);   // TTL removes it if this fails
        const winner = await reuse();
        if (winner) return winner;
        throw new SessionError('TRANSPORT_FAILURE', 'The room index changed under this request.', true);
      }

      // CREATE — the first of the four moments the listing changes. AFTER the
      // room and its index, for the same reason they are ordered that way: a
      // failure between them leaves no row pointing at a room nobody made.
      await this.writeLobbyRow(await this.getHeader(code));
      const view = await this.freshView(code, 'host', null);
      return { code, hostToken: req.hostToken, room: view.room, reused: false };
    });
  }

  // ---- join ------------------------------------------------------------

  /**
   * localTransport's assertTokenFree, against the header and VIEW#. ⚠ THIS IS
   * THE READ HALF ONLY. It gives the right error on the common path; the
   * TOKEN#/VIEW# conditions in the transaction are what make it hold under
   * concurrency — see the file header, point 1.
   */
  private async assertTokenFree(header: RoomHeader, token: string): Promise<void> {
    if (!SESSION_TOKEN_PATTERN.test(token)) {
      throw new SessionError('INVALID_REQUEST', 'That token is not a valid session token.');
    }
    const h = hashToken(token);
    if (h === header.hostTokenHash
      || Object.values(header.roster ?? {}).some(t => t.tokenHash === h)
      || (await this.getViewerTeamId(header.code, h)) !== null) {
      throw new SessionError('BAD_TOKEN', 'That token is already in use in this room.');
    }
  }

  join(req: JoinRequest): Promise<JoinResponse> {
    return this.call(async () => {
      if (req.role !== 'player' && req.role !== 'viewer') {
        throw new SessionError('INVALID_REQUEST', "role must be 'player' or 'viewer'.");
      }
      if (req.token !== undefined) requireString(req.token, 'token');

      // ⚠ A PIN RESOLVES code AND teamName BOTH, BEFORE ANY OF THE RETRY LOGIC
      // BELOW. Viewer-only — see JoinRequest.pin — so a player request never
      // reaches this branch. The lookup is a plain read, not a write, and does
      // not need to be inside the retry loop: it names a target, the loop below
      // still re-reads the room fresh on every attempt.
      let code: string;
      let rawName: string | undefined;
      let resolvedTeamId: string | null = null;
      if (req.pin !== undefined) {
        if (req.role !== 'viewer') {
          throw new SessionError('INVALID_REQUEST', 'pin may only be used to join as a viewer.');
        }
        const pin = requireString(req.pin, 'pin');
        const resolved = await this.resolvePin(pin);
        if (!resolved) throw new SessionError('TEAM_NOT_FOUND', 'No team with that PIN.');
        code = resolved.code;
        resolvedTeamId = resolved.teamId;
      } else {
        code = requireString(req.code, 'code');
        rawName = requireString(req.teamName, 'teamName');
      }

      // ⚠ EACH PASS READS AND DECIDES FROM SCRATCH. A failed condition means the
      // room changed between this pass's read and its write; the next pass sees
      // what changed and may well decide differently — a rejoin rather than
      // TEAM_TAKEN. See the file header, point 2.
      let lastFailure: SessionError | null = null;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const header = await this.getHeader(code);
        const name = rawName !== undefined ? rawName.trim() : undefined;
        if (name !== undefined && name.length === 0) {
          throw new SessionError('INVALID_REQUEST', 'A team needs a name.');
        }
        // ⚠ RESOLVED BY ID WHEN A PIN NAMED THE TEAM, BY NAME OTHERWISE. Both
        // land on the same [teamId, team] shape, so every branch below reads
        // exactly as it did before a PIN could ever reach this method.
        const found = resolvedTeamId
          ? (header.roster?.[resolvedTeamId] ? ([resolvedTeamId, header.roster[resolvedTeamId]] as const) : null)
          : Object.entries(header.roster ?? {}).find(([, t]) => t.name === name) ?? null;
        const [teamId, team] = found ?? [null, null];
        const pk = roomPk(code);

        // ⚠ A VIEWER WATCHES SOMETHING THAT EXISTS; A PLAYER MAY CREATE IT.
        if (req.role === 'viewer') {
          if (!team || !teamId) {
            throw new SessionError(
              'TEAM_NOT_FOUND',
              resolvedTeamId ? 'No team with that PIN.' : `${name} is not a team in this room.`,
            );
          }
          if (req.token) {
            const watching = await this.getViewerTeamId(code, hashToken(req.token));
            if (watching === teamId) {
              const view = await this.viewFor(header, 'viewer', teamId);
              // ⚠ NO pin HERE — a viewer's JoinResponse never carries one. See
              // JoinResponse.pin: only the team's own player ever learns it.
              return { teamToken: req.token, teamName: team.name, lines: [...team.lines], role: 'viewer' as const, rejoined: true, room: view.room };
            }
            await this.assertTokenFree(header, req.token);
          }
          const token = req.token ?? newSessionToken();
          const h = hashToken(token);
          // ⚠ NO rev BUMP: viewers are not in RoomView (keys.ts). localTransport
          // bumps it because it saves the whole record; no assertion depends on it.
          const tx = await this.transact([
            { Put: {
              TableName: this.db.table,
              Item: { pk, sk: viewerSk(h), teamId, expiresAtSec: header.expiresAtSec },
              ConditionExpression: 'attribute_not_exists(sk)',
            } },
            { ConditionCheck: {
              TableName: this.db.table,
              Key: { pk, sk: tokenSk(h) },
              ConditionExpression: 'attribute_not_exists(sk)',
            } },
          ]);
          if (!tx.ok) {
            lastFailure = new SessionError('BAD_TOKEN', 'That token is already in use in this room.');
            continue;
          }
          const view = await this.freshView(code, 'viewer', teamId);
          return { teamToken: token, teamName: team.name, lines: [...team.lines], role: 'viewer' as const, rejoined: false, room: view.room };
        }

        // ---- a player, on a team that already exists ----------------------
        if (team && teamId) {
          // ⚠ REJOIN BEFORE TAKEN — a refresh must not lock the driver out.
          if (req.token && team.tokenHash === hashToken(req.token)) {
            // ⚠ NOTHING TO REFUSE. This threw LINES_LOCKED when a rejoin asked
            // for a different set; a join carries no lines now, so the team
            // holds the room's set on the first join and on every return.
            const view = await this.viewFor(header, 'player', teamId);
            // ⚠ pin, AGAIN, EVERY REJOIN — not only on create. A reloaded
            // player's screen needs it to show the PIN again without a second
            // lookup; team.pin is absent only for a team created before this
            // field existed.
            return { teamToken: req.token, teamName: team.name, lines: [...team.lines], pin: team.pin, role: 'player' as const, rejoined: true, room: view.room };
          }
          throw new SessionError('TEAM_TAKEN', `A team called ${team.name} is already in this room.`);
        }

        // ---- a player creating its team -----------------------------------
        // ⚠ THE SERVER REFUSES A LATE TEAM. Reached only on the CREATING path:
        // every rejoin and every viewer returned above. Keyed on STATUS, not on
        // whether the event is listed — a hidden OPEN event still takes teams,
        // a listed IN_PROGRESS one still refuses them. Same rule, same message
        // and same code as the local transport, from the same contract
        // function, because the harness runs one set of assertions at both.
        const joinStatus = eventStatusOf(header.currentYear, header.yearCount);
        if (!mayCreateTeam(joinStatus)) {
          throw new SessionError(
            'EVENT_IN_PROGRESS',
            joinStatus === 'FINISHED'
              ? 'This event has finished, so no new teams can join.'
              : `This event is already in year ${header.currentYear}, so no new teams can join. `
                + 'You can still watch it as a viewer.',
          );
        }

        // ⚠ THE ROOM'S LINES, NOT THE REQUEST'S, AND NO VALIDATION HERE. The set
        // was checked once when the host created the room. A stale client still
        // sending `lines` is ignored rather than refused, as the contract asks.
        const lines = [...(header.lines ?? LINE_ORDER)];
        if (req.token) await this.assertTokenFree(header, req.token);
        const token = req.token ?? newSessionToken();
        const h = hashToken(token);
        const newId = newTeamId();
        // ⚠ name IS DEFINED HERE, ALWAYS. Reaching this line means req.pin was
        // not given (a pin forces role 'viewer', which returns above this
        // point), so this is the code/teamName path, where teamName is
        // required and already validated.
        const teamName = name as string;
        // A PIN lets a viewer jump straight to this team from the Lobby with
        // no room code in hand — see keys.ts's PIN# index. Minted fresh each
        // attempt; a collision below (vanishingly unlikely at 10^6 PINs) just
        // retries with a new one, the room-code collision's own shape.
        const pin = newViewerPin();
        const entry: RosterEntry = {
          name: teamName,
          // The room's set, already canonical — copied onto the roster entry so
          // the host's table and a viewer read it from the team row as before.
          lines: [...lines],
          joined: true,
          lockedYear: null,
          tokenHash: h,
          pin,
          posted: {},
          joinedAt: Date.now(),
        };
        const tx = await this.transact([
          // 0 — the name is claimed once.
          { Put: {
            TableName: this.db.table,
            Item: { pk, sk: nameSk(teamName), teamId: newId, expiresAtSec: header.expiresAtSec },
            ConditionExpression: 'attribute_not_exists(sk)',
          } },
          // 1 — the token is claimed once, across players...
          { Put: {
            TableName: this.db.table,
            Item: { pk, sk: tokenSk(h), teamId: newId, expiresAtSec: header.expiresAtSec },
            ConditionExpression: 'attribute_not_exists(sk)',
          } },
          // 2 — ...and is not a viewer's.
          { ConditionCheck: {
            TableName: this.db.table,
            Key: { pk, sk: viewerSk(h) },
            ConditionExpression: 'attribute_not_exists(sk)',
          } },
          // 3 — the roster entry, on a room that still exists.
          { Update: {
            TableName: this.db.table,
            Key: { pk, sk: ROOM_HEADER_SK },
            UpdateExpression: 'SET roster.#tid = :entry, updatedAt = :now ADD rev :one',
            ConditionExpression: 'attribute_exists(pk)',
            ExpressionAttributeNames: { '#tid': newId },
            ExpressionAttributeValues: { ':entry': entry, ':now': Date.now(), ':one': 1 },
          } },
          // 4 — the PIN is claimed once, globally (outside this room's
          // partition — keys.ts's pinPk).
          { Put: {
            TableName: this.db.table,
            Item: { pk: pinPk(pin), sk: PIN_SK, code, teamId: newId, expiresAtSec: header.expiresAtSec },
            ConditionExpression: 'attribute_not_exists(pk)',
          } },
        ]);
        if (!tx.ok) {
          // ⚠ A PIN COLLISION, ALONE, IS NOT ONE OF THE THREE USER-FACING
          // FAILURES BELOW — it says nothing about the name or the token, so
          // it is not reported if the OTHERS also failed; it just means this
          // attempt's PIN was already in use somewhere, and the next attempt
          // mints a fresh one.
          if (tx.failed.length === 1 && tx.failed[0] === 4) {
            lastFailure = new SessionError('TRANSPORT_FAILURE', 'Could not allocate a viewer PIN.', true);
            continue;
          }
          lastFailure = tx.failed.includes(0)
            ? new SessionError('TEAM_TAKEN', `A team called ${teamName} is already in this room.`)
            : tx.failed.includes(3)
              ? new SessionError('ROOM_NOT_FOUND', `No room with code ${code}.`)
              : new SessionError('BAD_TOKEN', 'That token is already in use in this room.');
          continue;
        }
        const view = await this.freshView(code, 'player', newId);
        return { teamToken: token, teamName: entry.name, lines: [...entry.lines], pin, role: 'player' as const, rejoined: false, room: view.room };
      }
      // Lost the race MAX_ATTEMPTS times in a row and the re-read never settled
      // it. Only reachable under sustained contention on one name or token.
      throw lastFailure ?? new SessionError('TRANSPORT_FAILURE', 'The room kept changing under this join.', true);
    });
  }

  // ---- submit ----------------------------------------------------------

  submit(req: SubmitRequest): Promise<SubmitResponse> {
    return this.call(async () => {
      const code = requireString(req.code, 'code');
      for (let attempt = 0; ; attempt++) {
        const header = await this.getHeader(code);
        const h = req.token ? hashToken(req.token) : null;
        const found = h ? Object.entries(header.roster ?? {}).find(([, t]) => t.tokenHash === h) : undefined;
        // Host, viewer, anonymous and unknown are all refused alike, as
        // localTransport's `role !== 'player'` refuses them.
        if (!found) throw new SessionError('BAD_TOKEN', 'Only a team player may submit.');
        const [teamId] = found;
        if (req.decisions === undefined && req.result === undefined) {
          throw new SessionError('INVALID_REQUEST', 'Nothing to submit.');
        }
        const y = requireInteger(req.yearNumber, 'yearNumber');

        if (req.decisions !== undefined && y !== header.currentYear) {
          throw new SessionError(
            'WRONG_YEAR',
            `The room is on year ${header.currentYear}; those decisions are for year ${y}.`,
          );
        }
        if (req.result !== undefined) {
          if (y > header.currentYear) {
            throw new SessionError(
              'WRONG_YEAR',
              `Cannot post a result for year ${y}; the room is on year ${header.currentYear}.`,
            );
          }
          if (y < 0) {
            throw new SessionError(
              'WRONG_YEAR',
              `Year ${y} is before the opening position; results start at year 0.`,
            );
          }
        }

        const pk = roomPk(code);
        const sets = ['updatedAt = :now'];
        const names: Record<string, string> = { '#tid': teamId };
        const values: Record<string, unknown> = { ':now': Date.now(), ':one': 1, ':y': y };
        const items: TransactItem[] = [];
        if (req.decisions !== undefined) {
          sets.push('roster.#tid.lockedYear = :y');
          items.push({ Put: {
            TableName: this.db.table,
            Item: {
              pk, sk: decisionSk(teamId, y), teamId, year: y,
              body: JSON.stringify(req.decisions), expiresAtSec: header.expiresAtSec,
            },
          } });
        }
        if (req.result !== undefined) {
          sets.push('roster.#tid.posted.#y = :true');
          names['#y'] = String(y);
          values[':true'] = true;
          items.push({ Put: {
            TableName: this.db.table,
            Item: {
              pk, sk: resultSk(teamId, y), teamId, year: y,
              body: JSON.stringify(req.result), expiresAtSec: header.expiresAtSec,
            },
          } });
        }
        // ⚠ THE CONDITION IS WHAT THE LOCK WAS. Between this pass's read of
        // currentYear and the write, an advance may have landed; the year check
        // above was against a room that no longer exists. Decisions need the
        // year to be EXACTLY this one (keys.ts: a year-3 decision landing after
        // year 3 was processed is the slot-history bug by another door).
        let condition = 'attribute_exists(roster.#tid) AND currentYear = :y';
        if (req.decisions === undefined) {
          condition = 'attribute_exists(roster.#tid) AND currentYear >= :y AND :y >= :zero';
          values[':zero'] = 0;
        }
        items.unshift({ Update: {
          TableName: this.db.table,
          Key: { pk, sk: ROOM_HEADER_SK },
          UpdateExpression: `SET ${sets.join(', ')} ADD rev :one`,
          ConditionExpression: condition,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        } });

        const tx = await this.transact(items);
        if (tx.ok) return this.freshView(code, 'player', teamId);
        // The year moved under us. Re-read and decide again: the checks above
        // then raise WRONG_YEAR against the room as it now is.
        if (attempt >= MAX_ATTEMPTS - 1) {
          throw new SessionError('WRONG_YEAR', 'The room moved to another year during this submit.');
        }
      }
    });
  }

  // ---- advance ---------------------------------------------------------

  /**
   * ⚠ ONE CONDITIONAL UPDATE ON THE HEADER, AND ON FAILURE THE OLD HEADER
   * DECIDES WHICH OF FOUR THINGS HAPPENED — in localTransport's order, which is
   * load-bearing:
   *
   *   1. token mismatch            NOT_HOST
   *   2. already at expected + 1   A RETRY — success, advanced: false
   *   3. past the year count       GAME_COMPLETE
   *   4. anything else             WRONG_YEAR
   *
   * ⚠ 2 BEFORE 3. With yearCount 3 and the room on 4, a retry of the advance
   * that COMPLETED the game carries expectedYear 3 and must succeed; a fresh
   * call carrying 4 must be GAME_COMPLETE. Both see currentYear > yearCount;
   * only the caller's expectation tells them apart. Checking 3 first breaks the
   * last advance of every game on exactly the retry nobody reproduces by hand.
   *
   * ⚠ AND THE READBACK IS ALL_OLD, NOT A SECOND GetItem. The old image is the
   * header AT THE MOMENT THE CONDITION FAILED. A re-read could see a later
   * advance and turn a genuine retry into WRONG_YEAR.
   *
   * Authority is resolved BEFORE the update, from the header, so a non-host
   * learns nothing about the year from the refusal and BAD_TOKEN stays distinct
   * from NOT_HOST. The update still conditions on the host hash, so case 1 is
   * also enforced by the write itself rather than only by the read before it.
   */
  // ---------------------------------------------------------------- lobby
  //
  // ⚠ EVERY WRITE HERE IS A PATH UPDATE, NEVER A PUT OF THE WHOLE ITEM. Two
  // hosts creating at once both read the lobby item, both add their own row,
  // and two Puts mean the second silently drops the first — a created event
  // that is simply never listed, with nothing recording that it happened. A
  // path update touches only its own code and the two interleave safely. See
  // keys.ts, THE LOBBY, and the CREATE# correction it points at.
  private async writeLobbyRow(header: RoomHeader): Promise<void> {
    const { expression, nameKey } = lobbyEventPath();
    const entry = {
      code: header.code,
      eventName: header.eventName,
      status: eventStatusOf(header.currentYear, header.yearCount),
      teams: Object.values(header.roster ?? {}).filter(t => t.joined).length,
      currentYear: header.currentYear,
      yearCount: header.yearCount,
      hidden: header.hidden ?? false,
      updatedAt: header.updatedAt,
    };
    const setRow = () => this.db.doc.send(new UpdateCommand({
      TableName: this.db.table,
      Key: { pk: LOBBY_PK, sk: LOBBY_SK },
      UpdateExpression: `SET ${expression} = :entry`,
      ExpressionAttributeNames: { [nameKey]: header.code },
      ExpressionAttributeValues: { ':entry': entry },
    }));

    try {
      await setRow();
    } catch (err) {
      // ⚠ A NESTED PATH CANNOT BE SET WHEN ITS PARENT MAP DOES NOT EXIST, and
      // DynamoDB answers that with a ValidationException reading "The document
      // path provided in the update expression is invalid for update" — not
      // with a condition failure, and not by creating the map. The FIRST event
      // ever created hits it, every time, on a fresh table.
      //
      // ⚠ WHY NOT PUT THE WHOLE ITEM, OR SET events AND events.#c TOGETHER.
      // A Put is the lost update this item exists to avoid (two hosts creating
      // at once, the second dropping the first), and DynamoDB evaluates every
      // SET clause against the ORIGINAL item, so `SET events = if_not_exists(
      // events, :empty), events.#c = :entry` overlaps two paths and is refused
      // outright. So: create the map if absent — itself conditional, so two
      // racing creators cannot clear each other's rows — then set the path.
      // One write in the steady state; two exactly once per table.
      const name = err instanceof Error ? err.name : '';
      if (name !== 'ValidationException') throw err;
      try {
        await this.db.doc.send(new UpdateCommand({
          TableName: this.db.table,
          Key: { pk: LOBBY_PK, sk: LOBBY_SK },
          UpdateExpression: 'SET events = :empty',
          ConditionExpression: 'attribute_not_exists(events)',
          ExpressionAttributeValues: { ':empty': {} },
        }));
      } catch (seedErr) {
        // Somebody else seeded it between our two calls, which is the case the
        // condition is for. Anything else is real.
        if (!(seedErr instanceof ConditionalCheckFailedException)) throw seedErr;
      }
      await setRow();
    }
  }

  /** Drop a row whose room is gone. Removing one twice is a no-op, so no condition. */
  private async removeLobbyRows(codes: string[]): Promise<void> {
    const { expression, nameKey } = lobbyEventPath();
    for (const code of codes) {
      await this.db.doc.send(new UpdateCommand({
        TableName: this.db.table,
        Key: { pk: LOBBY_PK, sk: LOBBY_SK },
        UpdateExpression: `REMOVE ${expression}`,
        ExpressionAttributeNames: { [nameKey]: code },
      }));
    }
  }

  // No parameter — ListEventsRequest is empty. See the local transport.
  listEvents(): Promise<ListEventsResponse> {
    return this.call(async () => {
      const got = await this.db.doc.send(new GetCommand({
        TableName: this.db.table,
        Key: { pk: LOBBY_PK, sk: LOBBY_SK },
      }));
      const rows = (got.Item?.events ?? {}) as Record<string, { code: string; updatedAt?: number }>;
      const codes = Object.keys(rows);
      if (codes.length === 0) return { events: [] };

      // ⚠ THE HEADERS ARE THE AUTHORITY, NOT THE ROWS. The index is derived
      // data and can be stale in either direction, so a row is only ever a
      // pointer: the status served is RE-DERIVED from the header fetched here.
      // This is also the only way to notice a room that TTL has deleted — its
      // row outlives it, and a lobby listing events nobody can open would be
      // worse than one listing none.
      const headers = new Map<string, RoomHeader>();
      for (let i = 0; i < codes.length; i += 100) {
        const chunk = codes.slice(i, i + 100);
        const res = await this.db.doc.send(new BatchGetCommand({
          RequestItems: {
            [this.db.table]: {
              Keys: chunk.map(c => ({ pk: roomPk(c), sk: ROOM_HEADER_SK })),
            },
          },
        }));
        for (const item of res.Responses?.[this.db.table] ?? []) {
          const h = item as RoomHeader;
          headers.set(h.code, h);
        }
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const dead: string[] = [];
      const events: LobbyEvent[] = [];
      for (const code of codes) {
        const header = headers.get(code);
        // ⚠ EXPIRED IS BOTH "GONE" AND "PAST ITS STAMP". TTL deletion is a
        // background sweep that runs well after the expiry, so a header can
        // still be present and already dead — keys.ts: reads check the stamp,
        // not the item's presence.
        if (!header || header.expiresAtSec <= nowSec) { dead.push(code); continue; }
        if (header.hidden) continue;
        const status = eventStatusOf(header.currentYear, header.yearCount);
        // FINISHED EVENTS DROP OFF, and their rows go with them: the room keeps
        // serving its teams until TTL, it simply stops being walkable-up-to.
        if (status === 'FINISHED') { dead.push(code); continue; }
        events.push({
          code: header.code,
          eventName: header.eventName,
          status,
          teams: Object.values(header.roster ?? {}).filter(t => t.joined).length,
          currentYear: header.currentYear,
          yearCount: header.yearCount,
        });
      }
      if (dead.length > 0) await this.removeLobbyRows(dead);

      const rank = (e: LobbyEvent) => (e.status === 'OPEN' ? 0 : 1);
      events.sort((a, b) => rank(a) - rank(b)
        || (rows[b.code]?.updatedAt ?? 0) - (rows[a.code]?.updatedAt ?? 0));
      return { events };
    });
  }

  setEventHidden(req: SetEventHiddenRequest): Promise<SetEventHiddenResponse> {
    return this.call(async () => {
      const code = requireString(req.code, 'code');
      if (typeof req.hidden !== 'boolean') {
        throw new SessionError('INVALID_REQUEST', 'hidden must be true or false.');
      }
      const h = hashToken(req.token);
      try {
        // ⚠ THE HOST CHECK IS THE CONDITION, NOT A READ-THEN-WRITE. Reading the
        // header first and then writing would be the same two-step the advance
        // path was corrected away from: the authority has to be part of the
        // write or it is a race with its own re-read.
        await this.db.doc.send(new UpdateCommand({
          TableName: this.db.table,
          Key: { pk: roomPk(code), sk: ROOM_HEADER_SK },
          // ⚠ `hidden` IS A DYNAMODB RESERVED KEYWORD, so it cannot appear in an
          // expression as itself — the write fails with "Attribute name is a
          // reserved keyword". Aliased through ExpressionAttributeNames, which
          // is the only reason this one field is written differently from
          // `updatedAt` and `rev` beside it. Caught by the --dynamo pass; the
          // localStorage and stub-server passes cannot see it, because neither
          // has an expression language to be reserved in.
          UpdateExpression: 'SET #hidden = :hid, updatedAt = :now ADD rev :one',
          ConditionExpression: 'attribute_exists(sk) AND hostTokenHash = :h',
          ExpressionAttributeNames: { '#hidden': 'hidden' },
          ExpressionAttributeValues: { ':hid': req.hidden, ':now': Date.now(), ':one': 1, ':h': h },
          ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
        }));
      } catch (err) {
        if (!(err instanceof ConditionalCheckFailedException)) throw err;
        if (!err.Item) throw new SessionError('ROOM_NOT_FOUND', `No room with code ${code}.`);
        throw new SessionError('NOT_HOST', 'Only the host may hide an event.');
      }
      const header = await this.getHeader(code);
      await this.writeLobbyRow(header);
      const view = await this.viewFor(header, 'host', null);
      return { room: view.room };
    });
  }

  advance(req: AdvanceRequest): Promise<AdvanceResponse> {
    return this.call(async () => {
      const code = requireString(req.code, 'code');
      const header = await this.getHeader(code);
      if (!Number.isInteger(req.expectedYear)) {
        throw new SessionError('INVALID_REQUEST', 'advance needs the year the caller expects the room to be on.');
      }
      const { role } = await this.resolve(header, req.token);
      if (role !== 'host') {
        throw new SessionError('NOT_HOST', 'Only the host may advance the year.');
      }
      const e = req.expectedYear;
      const h = hashToken(req.token);

      try {
        await this.db.doc.send(new UpdateCommand({
          TableName: this.db.table,
          Key: { pk: roomPk(code), sk: ROOM_HEADER_SK },
          UpdateExpression: 'SET currentYear = :next, updatedAt = :now ADD rev :one',
          ConditionExpression: 'currentYear = :e AND currentYear <= yearCount AND hostTokenHash = :h',
          ExpressionAttributeValues: { ':e': e, ':next': e + 1, ':now': Date.now(), ':one': 1, ':h': h },
          ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
        }));
      } catch (err) {
        if (!(err instanceof ConditionalCheckFailedException)) throw err;
        if (!err.Item) throw new SessionError('ROOM_NOT_FOUND', `No room with code ${code}.`);
        const old = unmarshall(err.Item) as RoomHeader;
        // 1. Authority.
        if (old.hostTokenHash !== h) {
          throw new SessionError('NOT_HOST', 'Only the host may advance the year.');
        }
        // 2. The retry. No write, and success.
        if (old.currentYear === e + 1) {
          const view = await this.freshView(code, 'host', null);
          return { room: view.room, currentYear: old.currentYear, advanced: false };
        }
        // 3. Past the end.
        if (old.currentYear > old.yearCount) {
          throw new SessionError('GAME_COMPLETE', 'The game is already complete.');
        }
        // 4. A stale or invented expectation.
        throw new SessionError(
          'WRONG_YEAR',
          `The room is on year ${old.currentYear}; that request expected year ${e}.`,
        );
      }
      // START and FINISH — the first advance takes the event OPEN ->
      // IN_PROGRESS, the last IN_PROGRESS -> FINISHED. Written on EVERY advance
      // so the row's currentYear stays honest for the lobby; listEvents prunes
      // the row once the status it derives is FINISHED.
      await this.writeLobbyRow(await this.getHeader(code));
      const view = await this.freshView(code, 'host', null);
      return { room: view.room, currentYear: e + 1, advanced: true };
    });
  }

  // ---- read ------------------------------------------------------------

  read(req: ReadRequest): Promise<ReadResponse> {
    return this.call(async () => {
      const code = requireString(req.code, 'code');
      const token = req.token ? requireString(req.token, 'token') : undefined;
      const { header, viewerTeamId } = await this.getHeaderAndViewer(code, token ? hashToken(token) : null);
      const { role, teamId } = await this.resolve(header, token, viewerTeamId);
      return this.viewFor(header, role, teamId);
    });
  }
}
