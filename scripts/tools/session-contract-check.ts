// ============================================================================
// THE SESSION CONTRACT HARNESS — the closest thing to a gate this layer gets.
//
// ⚠ WHY THIS IS NOT IN scripts/diagnostics. The gate manifest asserts that every
// file in that directory is in exactly one tier, and the 68 gates plus both
// baselines exist to hold a DETERMINISTIC ENGINE still. This checks a session
// layer: tokens, claims, redaction and carry-forward. It shares no baseline with
// them and putting it there would either fail the manifest check or dilute what
// a green sweep means. It runs on its own:
//
//   npx tsx scripts/tools/session-contract-check.ts
//
// WHAT IT IS FOR. The failure modes of a session layer are not numeric drift —
// they are a refresh that locks the real driver out of their own team, a host
// table that loses a lock to a race, a team silently reverted to engine defaults
// because it missed a deadline, and one team's decisions visible to another.
// Each of those is an assertion below.
//
// ⚠ IT RUNS TWICE: ONCE AGAINST EACH IMPLEMENTATION, AND THE ASSERTIONS ARE THE
// SAME OBJECT CODE BOTH TIMES. The localStorage one runs behind a memory shim;
// the HTTP one runs against the throwaway stub server over a real socket on
// 127.0.0.1. Nothing below the fixture line knows which is underneath — the only
// thing that changed to add the second pass was `transport()` returning a
// different object, which is the claim the contract was written to make. If a
// single assertion had needed weakening for one of them, THAT would have been
// the finding; none did.
//
// So it tests the contract, not the browser, and now demonstrably not the
// storage either.
//
// ⚠ AND TWICE MORE WITH --dynamo, AGAINST THE LAMBDA'S OWN CODE:
//
//   npx tsx scripts/tools/session-contract-check.ts --dynamo
//   npm run contract:dynamo
//
// The same assertions in-process against DynamoSessionTransport, then over a
// real socket through handler.ts — a few lines below turn an HTTP request into
// the API Gateway v2 event the Lambda receives, so the routing, the header, the
// status codes and the error body are what is being tested, not just the
// DynamoDB logic beneath them. Both run against one amazon/dynamodb-local
// container started here with `docker run` and removed afterwards. It needs
// Docker and NO AWS credentials: the SDK is handed dummy ones and pointed at
// 127.0.0.1, so nothing can reach a real account. Without the flag the run is
// exactly what it was — fast and Docker-free.
//
// ⚠ THE OVER-HTTP PASS RUNS THE MODULE'S OWN `handler`, configured only by
// environment variables, as the function is. Add --built (npm run
// contract:built) and the same pass runs again against dist-lambda/handler.zip's
// index.js — the artifact itself, not the source it came from. And every
// DynamoDB pass prints how many items it wrote to the container's table, and
// fails if that is zero: a pass that silently ran against something else would
// otherwise read as green.
//
// ⚠ WHAT THE 144 DO NOT REACH, so a green run is not over-read. Every block is
// sequential, so none of the races the Lambda's conditions exist for is
// exercised here (rooms.ts lists them). And the completion block advances past
// the end once; nothing retries the advance that COMPLETED the game, which is
// the case advance's ordering trap breaks.
// ============================================================================

import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
// Types only at the top: the SDK and the server modules are imported inside
// dynamoPasses, so a run without --dynamo loads none of them.
import type { makeHandler } from '../../src/session/server/handler';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalSessionTransport } from '../../src/session/localTransport';
import { HttpSessionTransport } from '../../src/session/httpTransport';
import type { SessionTransport } from '../../src/session/contract';
import { isSessionError, newSessionToken, type SessionErrorCode, type JsonValue } from '../../src/session/contract';
import type { CoverageLine } from '../../src/types/simulation';
import { decisionsForYear, governingYear } from '../../src/session/client/decisions';
import type {
  RoomView, TeamLineDecisions, TeamYearFigures, TeamYearSummary,
} from '../../src/session/contract';

// A posted scoreboard row. Every field is a RESULT_METRICS key — see
// TeamYearFigures in the contract.
const figures = (surplus: number): TeamYearFigures => ({
  endingSurplus: surplus,
  actualLossRatioPricingBasis: 0.82,
  poolPremium: 4_000_000,
  activeExposure: 41,
  selectedFundingConfidenceLevel: 0.6,
  netUltimateLoss: 3_300_000,
});
// ⚠ THE DEVELOPED COLUMN RESTATES EVERY ACCIDENT YEAR UP TO `year`, which is
// what makes it a triangle column rather than a point. The fixture grows it the
// way a real post does: every prior accident year, re-valued.
const developedTo = (year: number, factor: number): Record<string, number> =>
  Object.fromEntries(Array.from({ length: year + 1 }, (_, ay) => [String(ay), 1_000_000 * (ay + 1) * factor]));

// A decisions block carrying a MARKER VALUE the redaction assertions can
// search the whole serialised view for, exactly as the opaque stream's
// 'secret-a' marker is used. 0.37 is not a stop any default would produce.
const DECISION_MARKER = 0.37;
const lineDecisions = (): TeamLineDecisions => ({
  confidenceLevel: DECISION_MARKER,
  atExpected: false,
  // Not the default cover, so a transport that substituted the default
  // would fail the read-back below.
  reinsuranceOption: 'working',
  // Not the defaults (0 and 0), so a transport that substituted one fails.
  renewalsDeclined: 0.07,
  newBusinessRejection: 0.12,
  riskControlPct: 0.03,
  dividendPct: 0.05,
  assessmentPct: 0,
  allocation: { cashPct: 0.2, bondsPct: 0.6, equitiesPct: 0.2 },
});

const summaryFor = (
  year: number,
  surplus: number,
  lines: CoverageLine[] = ['WC'],
  factor = 1,
  withDecisions = false,
): TeamYearSummary => ({
  yearNumber: year,
  calendarYear: 2025 + year,
  pool: figures(surplus),
  byLine: Object.fromEntries(lines.map(l => [l, figures(surplus)])),
  developed: {
    pool: developedTo(year, factor),
    byLine: Object.fromEntries(lines.map(l => [l, developedTo(year, factor)])),
  },
  // Year 0 never carries decisions — see TeamYearSummary.decisions.
  ...(withDecisions && year > 0
    ? { decisions: Object.fromEntries(lines.map(l => [l, lineDecisions()])) }
    : {}),
  // The worlds' spread (loss engine commit 4b) rides with the decisions: a played
  // year carries it, the opening position does not. Off-centre on purpose, so a
  // transport that recomputed or defaulted it would fail the read-back.
  ...(withDecisions && year > 0
    ? { surplusRange: { min: surplus - 123, median: surplus + 7, max: surplus + 456 } }
    : {}),
});

// ---------------------------------------------------------------- shim

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
}

(globalThis as unknown as { localStorage: unknown }).localStorage = new MemoryStorage();

// ⚠ NODE'S OWN navigator.locks IS SHUT OFF HERE, DELIBERATELY. localTransport's
// withRoomLock already falls back to running synchronously when no lock
// manager exists — the comment there says "the harness runs under a DOM-less
// Node". That was true until Node started shipping navigator.locks itself
// (confirmed present as of Node v24.21.0, this harness's target), which is
// where the fallback stopped applying. Node's implementation does not release
// the lock when the callback throws, so the very first validation rejection in
// this file wedges every withRoomLock call after it: no error, no output, a
// clean process exit with the hung promise simply abandoned. One process runs
// every pass here, so blanking it once at the top is enough.
Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });

// ---------------------------------------------------------------- asserts

const failures: string[] = [];
let checks = 0;

function ok(cond: boolean, what: string): void {
  checks++;
  if (!cond) failures.push(what);
}

function eq<T>(actual: T, expected: T, what: string): void {
  checks++;
  if (actual !== expected) failures.push(`${what}: expected ${String(expected)}, got ${String(actual)}`);
}

// Assert a call rejects with a specific code. A session layer's error codes are
// what every UI branches on, so a wrong code is a real defect, not a detail.
async function rejects(p: Promise<unknown>, code: SessionErrorCode, what: string): Promise<void> {
  checks++;
  try {
    await p;
    failures.push(`${what}: expected rejection ${code}, but it resolved`);
  } catch (e) {
    if (!isSessionError(e)) failures.push(`${what}: threw a non-SessionError: ${String(e)}`);
    else if (e.code !== code) failures.push(`${what}: expected ${code}, got ${e.code}`);
  }
}

// ---------------------------------------------------------------- fixture

const TEAMS = ['Harbour Mutual', 'Cedar Valley', 'Tri-County'];

// ⚠ THE ONE SEAM BETWEEN THE TWO PASSES. Everything else in this file is
// written against the interface and cannot tell the difference.
let makeTransport: () => SessionTransport & { faults: { failNext(code?: SessionErrorCode, m?: string): void; failAll(code?: SessionErrorCode, m?: string): void; setLatency(ms: number): void; clear(): void } };

function transport() {
  return makeTransport();
}

/**
 * Advance one year the way a real client does: from the year it can SEE.
 *
 * ⚠ IT READS FIRST, WHICH IS THE POINT RATHER THAN A CONVENIENCE.
 * HostRoomScreen compare-and-swaps on its polled `room.currentYear`, so a
 * harness that passed a year it had counted itself would be testing a client
 * nobody wrote. The idempotency assertions below pass the year EXPLICITLY,
 * because there the whole question is what happens when the expectation and
 * the room disagree.
 */
async function step(t: SessionTransport, code: string, token: string) {
  const { room } = await t.read({ code, token });
  return t.advance({ code, token, expectedYear: room.currentYear });
}

async function freshRoom(t: SessionTransport) {
  return t.createRoom({
    hostToken: newSessionToken(),
    seed: '7',
    yearCount: 3,
    startingYear: 2026,
    eventName: 'Ripple Game',
    expectedTeams: 3,
    // ⚠ THE ROOM DECLARES ITS LINES NOW. Every team in the fixture plays WC
    // only, which is what each of them used to ask for at join.
    lines: WC,
    shocks: [{ shockId: 'pandemic', yearNumber: 2 }],
  });
}

// The fixture room plays WC only, so every team in it does too. A check that
// cares about a different set creates its own room — a team cannot ask.
const WC: CoverageLine[] = ['WC'];


const decisionsFor = (year: number, marker: string): JsonValue =>
  ({ yearNumber: year, marker } as JsonValue);

// ---------------------------------------------------------------- run

async function main(): Promise<void> {
  // ---- createRoom ------------------------------------------------------
  {
    const t = transport();
    const created = await freshRoom(t);

    ok(/^[A-Z2-9]{6}$/.test(created.code), 'room code is six unambiguous characters');
    ok(created.hostToken.length >= 16, 'host token is not guessable-short');
    eq(created.room.currentYear, 1, 'a new room starts on year 1');
    eq(created.room.status, 'lobby', 'a room with nobody joined is in lobby');
    // ⚠ A ROOM OPENS EMPTY NOW. Teams are created by joining, because a team's
    // name and its lines are one act of setup performed by the team itself.
    eq(created.room.teams.length, 0, 'a new room has no teams — they are created by joining');
    eq(created.room.expectedTeams, 3, 'the room carries how many teams the host expects');
    eq(created.room.eventName, 'Ripple Game', 'the room is named for the EVENT, not a pool');

    // The shock list is CARRIED. Nothing consumes it yet — see the note in
    // contract.ts — but it must survive the round trip or the seam that lands
    // later will have nothing to read.
    eq(created.room.shocks.length, 1, 'the room carries its shock list');
    eq(created.room.shocks[0].shockId, 'pandemic', 'the carried shock keeps its catalog id');
    eq(created.room.shocks[0].yearNumber, 2, 'the carried shock keeps its fire year');

    // ⚠ A ROOM VIEW MUST NEVER CARRY THE HOST TOKEN. It is handed back once at
    // creation and is the only thing standing between a player and the advance
    // control.
    ok(!JSON.stringify(created.room).includes(created.hostToken), 'the room view never discloses the host token');

    await rejects(
      t.createRoom({ hostToken: newSessionToken(), seed: '1', yearCount: 0, startingYear: 2026, eventName: 'p', expectedTeams: 3, shocks: [], lines: WC }),
      'INVALID_REQUEST', 'a zero-year game is refused',
    );
    await rejects(
      t.createRoom({ hostToken: newSessionToken(), seed: '1', yearCount: 3, startingYear: 2026, eventName: 'p', expectedTeams: 0, shocks: [], lines: WC }),
      'INVALID_REQUEST', 'a room expecting no teams is refused',
    );
    // ⚠ THE SEED IS THE SCENARIO, "1" TO "20" (stable-scenarios commit 9):
    // every other seed is refused, by the handler as by the local transport.
    for (const seed of ['0', '21', '07', '7 ', '', 'MAMC6EA4']) {
      await rejects(
        t.createRoom({ hostToken: newSessionToken(), seed, yearCount: 3, startingYear: 2026, eventName: 'p', expectedTeams: 3, shocks: [], lines: WC }),
        'INVALID_REQUEST', `a room seeded "${seed}", not a scenario from 1 to 20, is refused`,
      );
    }
    await rejects(t.read({ code: 'ZZZZZZ' }), 'ROOM_NOT_FOUND', 'an unknown code is not found');
  }

  // ---- join, rejoin, claims -------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);

    const a = await t.join({ code, teamName: TEAMS[0], role: 'player' });
    eq(a.rejoined, false, 'a first join is not a rejoin');
    eq(a.teamName, TEAMS[0], 'the joiner gets the team it asked for');

    // ⚠ THE FAILURE MODE THIS EXISTS FOR. A refresh must not read as a second
    // person claiming a taken team — that locks the real driver out of their
    // own game for the rest of the session.
    const again = await t.join({ code, teamName: TEAMS[0], role: 'player', token: a.teamToken });
    eq(again.rejoined, true, 'the same token returning to the same team is a rejoin');
    eq(again.teamToken, a.teamToken, 'a rejoin keeps the original token rather than issuing a new one');

    await rejects(
      t.join({ code, teamName: TEAMS[0], role: 'player' }),
      'TEAM_TAKEN', 'a different browser cannot take a name already in the room',
    );
    // ⚠ THE INVERSE OF THE OLD RULE. A name nobody has used is not an error for
    // a player — it is how a team comes into being.
    const invented = await t.join({ code, teamName: 'Nobody FC', role: 'player' });
    eq(invented.teamName, 'Nobody FC', 'a player names its own team into existence');
    await rejects(
      t.join({ code, teamName: 'Nobody FC', role: 'player' }),
      'TEAM_TAKEN', 'a second player cannot reuse a name already in the room',
    );
    await rejects(
      t.join({ code, teamName: 'Ghost FC', role: 'viewer' }),
      'TEAM_NOT_FOUND', 'a viewer cannot watch a team that does not exist',
    );

    // A viewer never claims, so landing as a viewer by accident blocks nobody —
    // and any number of people may watch the same team. The team has to exist
    // first now, so a player creates it.
    const driver = await t.join({ code, teamName: TEAMS[1], role: 'player' });
    const v1 = await t.join({ code, teamName: TEAMS[1], role: 'viewer' });
    const v2 = await t.join({ code, teamName: TEAMS[1], role: 'viewer' });
    ok(v1.teamToken !== v2.teamToken, 'two viewers of one team get distinct tokens');
    ok(v1.teamToken !== driver.teamToken, "a viewer's token is not the driver's");
    const afterViewers = await t.read({ code, token: hostToken });
    const watched = afterViewers.room.teams.find(x => x.name === TEAMS[1])!;
    eq(watched.joined, true, 'the team is joined because its PLAYER joined it');
    eq(afterViewers.room.teams.length, 3, 'watching adds no team row');

    await rejects(
      t.submit({ code, token: v1.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'viewer') }),
      'BAD_TOKEN', 'a viewer token cannot submit',
    );
    await rejects(t.read({ code, token: 'not-a-real-token' }), 'BAD_TOKEN', 'a forged token is rejected');
  }

  // ---- submit, lock, authority ----------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);
    const players = [];
    for (const name of TEAMS) players.push(await t.join({ code, teamName: name, role: 'player' }));

    const s = await t.submit({ code, token: players[0].teamToken, yearNumber: 1, decisions: decisionsFor(1, 'y1-a') });
    eq(s.room.teams[0].locked, true, 'a submit locks that team for the current year');
    eq(s.room.teams[1].locked, false, 'one team locking does not lock another');

    await rejects(
      t.submit({ code, token: players[1].teamToken, yearNumber: 2, decisions: decisionsFor(2, 'early') }),
      'WRONG_YEAR', 'decisions for a year the room is not on are refused',
    );

    // ⚠ AUTHORITY IS ENFORCED, NOT HIDDEN. The player's screen has no advance
    // button, but that is a UI fact; this is the one that matters.
    await rejects(
      t.advance({ code, token: players[0].teamToken, expectedYear: 1 }),
      'NOT_HOST', 'a team token cannot advance the year',
    );
    await rejects(t.advance({ code, token: 'nope', expectedYear: 1 }), 'BAD_TOKEN', 'a forged token cannot advance the year');

    const adv = await step(t, code, hostToken);
    eq(adv.currentYear, 2, 'the host advances the room to year 2');
    const afterAdv = await t.read({ code, token: hostToken });
    ok(afterAdv.room.teams.every(x => !x.locked), 'advancing clears every teamlock for the new year');
    eq(afterAdv.room.teams[0].lockedYear, 1, 'the year a team last locked survives the advance');
  }

  // ---- carry-forward ---------------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);
    const p = await t.join({ code, teamName: TEAMS[0], role: 'player' });

    await t.submit({ code, token: p.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'deliberate') });
    await step(t, code, hostToken);

    // ⚠ THE WHOLE POINT OF CARRY-FORWARD. The team did NOT lock for year 2. What
    // it gets back must still be the deliberate choice it made in year 1 —
    // reverting to engine defaults here would silently undo a decision the team
    // made on purpose, and it would look like the team had chosen the default.
    const mine = await t.read({ code, token: p.teamToken });
    eq(mine.room.currentYear, 2, 'the room moved on to year 2');
    eq(mine.room.teams[0].locked, false, 'the team has not locked for year 2');
    ok(mine.you.decisionsByYear !== undefined, 'an unlocked team still has a decision history to carry from');
    eq(governingYear(2, mine.you.decisionsByYear), 1, 'year 2 is governed by year 1 — the last lock BEFORE it');
    eq((decisionsForYear(2, mine.you.decisionsByYear) as unknown as { marker: string }).marker, 'deliberate',
       'the carried decisions are the last DELIBERATE ones, not defaults');
  }

  // ---- the decision history -------------------------------------------
  {
    const t = transport();
    // Its own room: this block needs six years, and the shared fixture is three.
    const { code, hostToken } = await t.createRoom({
      hostToken: newSessionToken(),
      seed: '7', yearCount: 6, startingYear: 2026,
      eventName: 'History', expectedTeams: 1, shocks: [], lines: WC,
    });
    const p = await t.join({ code, teamName: TEAMS[0], role: 'player' });

    // Lock years 1 and 2 with DIFFERENT sets, skip 3, lock 4.
    await t.submit({ code, token: p.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'y1') });
    await step(t, code, hostToken);
    await t.submit({ code, token: p.teamToken, yearNumber: 2, decisions: decisionsFor(2, 'y2') });
    await step(t, code, hostToken);
    await step(t, code, hostToken);   // year 3 never locked
    await t.submit({ code, token: p.teamToken, yearNumber: 4, decisions: decisionsFor(4, 'y4') });

    const mine = await t.read({ code, token: p.teamToken });
    const h = mine.you.decisionsByYear;
    eq(Object.keys(h ?? {}).sort().join(','), '1,2,4', 'every locked year is kept, and only those');

    // ⚠ THE ASSERTION THE OLD SHAPE COULD NOT MAKE. With one slot, every one of
    // these read 'y4' — which is precisely why a reload replayed years the team
    // never played.
    const marker = (y: number) => (decisionsForYear(y, h) as unknown as { marker: string }).marker;
    eq(marker(1), 'y1', 'year 1 replays on year 1');
    eq(marker(2), 'y2', 'year 2 replays on year 2, NOT on the latest set');
    eq(marker(3), 'y2', 'the skipped year 3 carries forward from year 2, the last lock before it');
    eq(marker(4), 'y4', 'year 4 replays on year 4');
    eq(governingYear(3, h), 2, 'and the governing year for a skipped year is named, not inferred');

    // Re-submitting a year replaces THAT year and leaves the others alone.
    await step(t, code, hostToken);
    await t.submit({ code, token: p.teamToken, yearNumber: 5, decisions: decisionsFor(5, 'y5') });
    const after = await t.read({ code, token: p.teamToken });
    eq(marker(1), 'y1', 'a later submit does not disturb an earlier year');
    eq(Object.keys(after.you.decisionsByYear ?? {}).sort().join(','), '1,2,4,5', 'the history grows by one');
  }

  // ---- results ---------------------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);
    const p = await t.join({ code, teamName: TEAMS[0], role: 'player' });

    await t.submit({ code, token: p.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'y1') });
    await step(t, code, hostToken);

    // A result is for a year already processed, so it arrives for a year BEHIND
    // the room's current one. That is the normal case, not an error.
    const posted = await t.submit({ code, token: p.teamToken, yearNumber: 1, result: summaryFor(1, 1234) });
    eq(posted.room.teams[0].resultYear, 1, 'a result for a completed year is accepted');
    eq(posted.you.lastResult?.pool.endingSurplus, 1234, 'the posting team reads its own result back');

    // ⚠ THE HOST READS THE SCOREBOARD, AND THAT IS DELIBERATE. Decisions stay
    // redacted from the host (asserted below); a posted result is the thing the
    // room exists to compare, and the Teams tab is where it is read.
    const asHost = await t.read({ code, token: hostToken });
    const held = (r: RoomView, y: number) => r.teams[0].resultsByYear?.[String(y)];
    eq(held(asHost.room, 1)?.pool.endingSurplus, 1234, "the host's table carries a posted result");
    eq(held(asHost.room, 1)?.byLine.WC?.endingSurplus, 1234, 'and carries the per-line slice it needs');
    eq(held(asHost.room, 1)?.byLine.GL, undefined,
       'a line the team does not write has NO entry — absent, not zero');

    await rejects(
      t.submit({ code, token: p.teamToken, yearNumber: 9, result: summaryFor(9, 0) }),
      'WRONG_YEAR', 'a result from the future is refused',
    );
    await rejects(
      t.submit({ code, token: p.teamToken, yearNumber: 2 }),
      'INVALID_REQUEST', 'a submit carrying neither decisions nor a result is refused',
    );
  }

  // ---- the opening position -------------------------------------------
  //
  // ⚠ YEAR 0 IS A RESULT YEAR AND IS NOT A PLAYED YEAR, and holding both of
  // those at once is the whole of this block. The pre-game is real engine years,
  // so the opening position is a summary like any other and the charts' axis
  // starts there; the team that posted it has still played nothing, so the
  // host's Reported column must not tick for it.
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);
    const p = await t.join({ code, teamName: TEAMS[0], role: 'player' });

    const opened = await t.submit({ code, token: p.teamToken, yearNumber: 0, result: summaryFor(0, 500) });
    eq(opened.room.teams[0].resultsByYear?.['0']?.pool.endingSurplus, 500,
       'the opening position is accepted for year 0, before anything is decided');
    eq(opened.room.teams[0].resultYear, null,
       'and it is NOT a reported year — a team that has played nothing has not reported');
    eq(opened.you.lastResult, undefined, "nor is it the caller's last result");

    await rejects(
      t.submit({ code, token: p.teamToken, yearNumber: -1, result: summaryFor(-1, 0) }),
      'WRONG_YEAR', 'a year before the opening position is refused — the earlier pre-game is not the session',
    );

    // ⚠ THE SECOND TEAM JOINS HERE, BEFORE THE ADVANCE, AND IT USED TO JOIN AT
    // THE END OF THIS BLOCK. A new team cannot be created once the event is
    // IN_PROGRESS — see the lobby block — and `step` below is the first
    // advance. The assertion it serves is about a team that has POSTED
    // nothing, which has nothing to do with when it arrived, so moving it is
    // the whole fix: it still joins, still posts nothing, and still must have
    // no history. Leaving it late and relaxing the new rule for the harness
    // would have been testing a server nobody ships.
    const fresh = await t.join({ code, teamName: TEAMS[1], role: 'player' });
    eq(fresh.room.teams[1].resultsByYear, undefined, 'a team that has posted nothing has no history');
    const freshRead = await t.read({ code, token: fresh.teamToken });
    eq(freshRead.you.postedYears, undefined, 'and is told so rather than being handed an empty list');

    // Once a year is actually played, the opening stays put beside it.
    await t.submit({ code, token: p.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'y1') });
    await step(t, code, hostToken);
    const played = await t.submit({ code, token: p.teamToken, yearNumber: 1, result: summaryFor(1, 1500) });
    eq(played.room.teams[0].resultYear, 1, 'the first PLAYED year is the first reported one');
    eq(Object.keys(played.room.teams[0].resultsByYear ?? {}).sort().join(','), '0,1',
       'and the opening position is still there, one point to the left of it');
    eq(played.you.lastResult?.pool.endingSurplus, 1500, "the caller's last result is the played year, not the opening");

    // ⚠ WHAT THE ROOM ALREADY HOLDS FOR YOU, WHICH IS HOW A CLIENT REPAIRS A
    // POST THAT NEVER LANDED. It includes year 0 — the one year that has no
    // later post to carry it in, so nothing else would ever notice its absence.
    eq((played.you.postedYears ?? []).join(','), '0,1', 'the caller is told which years the room holds for it');
    eq((opened.you.postedYears ?? []).join(','), '0', 'including when the only one is the opening position');
  }

  // ---- the developed column --------------------------------------------
  //
  // ⚠ IT IS THE ONE PART OF A SUMMARY THAT RESTATES THE PAST, and the transport
  // must carry it verbatim rather than merging it. Each post is a WHOLE column:
  // the accident years as at THAT valuation. Merging two posts would produce a
  // valuation that never existed.
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);
    const p = await t.join({ code, teamName: TEAMS[0], role: 'player' });

    await t.submit({ code, token: p.teamToken, yearNumber: 0, result: summaryFor(0, 500, WC, 1) });
    await t.submit({ code, token: p.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'y1') });
    await step(t, code, hostToken);
    // Year 1's valuation restates accident year 0 at 1.5x what year 0 said.
    await t.submit({ code, token: p.teamToken, yearNumber: 1, result: summaryFor(1, 1500, WC, 1.5) });

    const seen = await t.read({ code, token: hostToken });
    const at = (y: number) => seen.room.teams[0].resultsByYear?.[String(y)]?.developed;
    eq(Object.keys(at(0)?.pool ?? {}).join(','), '0', 'the opening valuation holds accident year 0 alone');
    eq(Object.keys(at(1)?.pool ?? {}).sort().join(','), '0,1',
       'the next valuation restates accident year 0 AND adds accident year 1');
    eq(at(0)?.pool['0'], 1_000_000, 'accident year 0 as it was valued at year 0');
    eq(at(1)?.pool['0'], 1_500_000,
       'and the SAME accident year, higher, as it is valued a year later — the point of the chart');
    eq(at(1)?.byLine.WC?.['1'], 3_000_000, 'the per-line column is carried too, so a line view has one');
    eq(at(1)?.byLine.GL, undefined, 'and a line the team does not write has none — absent, not zero');

    // The frozen series is untouched by the restatement beside it.
    eq(seen.room.teams[0].resultsByYear?.['0']?.pool.endingSurplus, 500,
       'the as-booked figures are not revised by a later valuation');
  }

  // ---- a result history, not a slot ------------------------------------
  //
  // ⚠ THIS IS THE DECISIONS BLOCK ABOVE ASKED OF THE OTHER FIELD, AND THE
  // ANSWER FOR A SKIPPED YEAR IS THE OPPOSITE ONE. Decisions carry forward
  // because a team that does not lock still plays the year on its last choices.
  // A result does NOT: a year nobody posted has no result, and inventing one by
  // carrying the previous year forward would draw a flat line on the chart
  // where a gap belongs. Absent must stay absent.
  {
    const t = transport();
    // Its own room again: four played years, and the shared fixture is three.
    const { code, hostToken } = await t.createRoom({
      hostToken: newSessionToken(),
      seed: '7', yearCount: 6, startingYear: 2026,
      eventName: 'Results', expectedTeams: 1, shocks: [], lines: WC,
    });
    const p = await t.join({ code, teamName: TEAMS[0], role: 'player' });

    // Play through four years, posting a DIFFERENT surplus for 1, 2 and 4.
    for (const y of [1, 2, 3, 4]) {
      await t.submit({ code, token: p.teamToken, yearNumber: y, decisions: decisionsFor(y, `y${y}`) });
      await step(t, code, hostToken);
      if (y !== 3) {
        await t.submit({ code, token: p.teamToken, yearNumber: y, result: summaryFor(y, y * 1000) });
      }
    }

    const seen = await t.read({ code, token: hostToken });
    const byYear = seen.room.teams[0].resultsByYear;
    eq(Object.keys(byYear ?? {}).sort().join(','), '1,2,4', 'every posted year is kept, and only those');
    eq(byYear?.['1']?.pool.endingSurplus, 1000, 'year 1 holds year 1, not the newest value');
    eq(byYear?.['2']?.pool.endingSurplus, 2000, 'year 2 holds its own');
    eq(byYear?.['3'], undefined, 'a year nobody posted stays ABSENT — it does not carry forward');
    eq(byYear?.['4']?.pool.endingSurplus, 4000, 'year 4 holds its own');
    eq(seen.room.teams[0].resultYear, 4, 'resultYear is the HIGHEST posted year');

    // A re-post of an earlier year — which is exactly what a reloaded tab does —
    // replaces that year and disturbs nothing else.
    await t.submit({ code, token: p.teamToken, yearNumber: 2, result: summaryFor(2, 2222) });
    const after = await t.read({ code, token: hostToken });
    eq(after.room.teams[0].resultsByYear?.['2']?.pool.endingSurplus, 2222, 'a re-post replaces that year');
    eq(after.room.teams[0].resultsByYear?.['4']?.pool.endingSurplus, 4000, 'and leaves the later year alone');
    eq(after.room.teams[0].resultYear, 4, 'and does not move the highest posted year backwards');
  }

  // ---- redaction -------------------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);
    const p0 = await t.join({ code, teamName: TEAMS[0], role: 'player' });
    const p1 = await t.join({ code, teamName: TEAMS[1], role: 'player' });
    const viewer = await t.join({ code, teamName: TEAMS[0], role: 'viewer' });

    await t.submit({ code, token: p0.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'secret-a') });
    await t.submit({ code, token: p1.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'secret-b') });

    const asHost = await t.read({ code, token: hostToken });
    eq(asHost.you.role, 'host', 'the host token reads as the host');
    eq(asHost.room.teams[0].locked, true, 'the host sees the first team has locked');
    eq(asHost.room.teams[1].locked, true, 'the host sees the second team has locked');
    // A third team joins but does not lock, so the host has something
    // outstanding to see. It cannot simply be absent now — a team that never
    // joined has no row at all.
    const p2 = await t.join({ code, teamName: TEAMS[2], role: 'player' });
    const withThird = await t.read({ code, token: hostToken });
    eq(withThird.room.teams.find(x => x.name === TEAMS[2])!.locked, false,
       'the host sees a joined-but-unlocked team as outstanding');
    ok(p2.teamToken.length > 0, 'the third team holds a token of its own');
    // ⚠ PRESENCE AND PROGRESS, NEVER CONTENT. The host needs to know WHO has
    // locked, not WHAT they chose; a host view that carried it would be one
    // render away from projecting another team's hand onto a shared screen.
    ok(!JSON.stringify(asHost).includes('secret-a'), "the host view does not carry a team's decisions");

    const asP0 = await t.read({ code, token: p0.teamToken });
    eq((decisionsForYear(1, asP0.you.decisionsByYear) as unknown as { marker: string }).marker, 'secret-a',
       'a player reads its own decisions back');
    ok(!JSON.stringify(asP0).includes('secret-b'), "a player cannot see another team's decisions");

    const asViewer = await t.read({ code, token: viewer.teamToken });
    eq(asViewer.you.role, 'viewer', 'a viewer token reads as a viewer');
    eq(asViewer.you.teamName, TEAMS[0], 'a viewer is bound to the team it watches');
    ok(!JSON.stringify(asViewer).includes('secret-b'), 'a viewer sees only the team it watches');

    const anon = await t.read({ code });
    eq(anon.you.role, 'anonymous', 'a tokenless read is anonymous');
    eq(anon.room.teams.length, 3, 'an anonymous caller still sees the roster, to pick a team from');
    ok(!JSON.stringify(anon).includes('secret-a'), 'an anonymous caller sees no decisions at all');
  }

  // ---- THE HOST SEES EACH TEAM'S DECISIONS, BUT ONLY AFTER THE ADVANCE ----
  // ⚠ EVERY ASSERTION HERE FAILS ON THE OLD BEHAVIOUR, and the two controls
  // that show it were RUN rather than reasoned about:
  //
  //   A. the field reaches nobody (summaryFor strips unconditionally — the
  //      world before TeamYearSummary.decisions existed). MEASURED: 11
  //      failures, naming "the host sees a team's decisions once the year is
  //      advanced and posted" and each figure read off it.
  //   B. the strip is absent (summaryFor returns its input). MEASURED: the
  //      four non-host assertions fail — player, other team, viewer, anonymous.
  //
  // Control B is not hypothetical: the first version of this change stripped in
  // teamView only, and this block failed on exactly those assertions because
  // callerView hands a caller its own team's newest row by a second route. The
  // harness found it, which is the reason the block is worth its length.
  //
  // ⚠ THE TIMING IS THE CLAIM, AND IT IS STRUCTURAL RATHER THAN ENFORCED. A
  // year's decisions ride in the record posted at that year's END, so there is
  // no row for the host to read until the team has posted it. Nothing checks a
  // clock and nothing refuses a request; the data simply does not exist yet.
  // That is why the assertion is worth making over a transport — it proves the
  // shape of the design, not a guard somebody could delete.
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);
    const p0 = await t.join({ code, teamName: TEAMS[0], role: 'player' });
    const p1 = await t.join({ code, teamName: TEAMS[1], role: 'player' });
    const viewer = await t.join({ code, teamName: TEAMS[0], role: 'viewer' });

    // Year 1 is live. The team locks its decisions through the OPAQUE stream,
    // which is the only thing that exists before the year is played.
    await t.submit({ code, token: p0.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'live-1') });
    // And posts its OPENING position, which is year 0 and carries no decisions.
    await t.submit({ code, token: p0.teamToken, yearNumber: 0, result: summaryFor(0, 500, ['WC'], 1, true) });

    const before = await t.read({ code, token: hostToken });
    ok(!JSON.stringify(before).includes(String(DECISION_MARKER)),
       'the host cannot see a year\'s decisions before it is advanced — there is no posted row to read');
    eq(before.room.teams[0].resultsByYear?.['0']?.decisions, undefined,
       'year 0 carries no decisions: the opening position precedes every choice');

    // The host advances; the team then posts the played year, decisions and all.
    await t.advance({ code, token: hostToken, expectedYear: 1 });
    await t.submit({ code, token: p0.teamToken, yearNumber: 1, result: summaryFor(1, 600, ['WC'], 1, true) });
    await t.submit({ code, token: p1.teamToken, yearNumber: 1, result: summaryFor(1, 700, ['WC'], 1, true) });

    const after = await t.read({ code, token: hostToken });
    const seen = after.room.teams[0].resultsByYear?.['1']?.decisions?.WC;
    ok(seen !== undefined, 'the host sees a team\'s decisions once the year is advanced and posted');
    eq(seen?.confidenceLevel, DECISION_MARKER, 'and reads the funding level the team chose');
    eq(seen?.reinsuranceOption, 'working', 'and the reinsurance cover the team bought');
    ok(seen !== undefined && !('layersPlaced' in seen) && !('aggregateStopLevel' in seen),
       'and nothing of the retired per-band placement or aggregate level');
    eq(seen?.renewalsDeclined, 0.07, 'and the share of renewals declined');
    eq(seen?.newBusinessRejection, 0.12, 'and the new-business rejection rate');
    ok(seen !== undefined && !('renewalCut' in seen) && !('intakeLevel' in seen),
       'and nothing of the retired renewal cut or intake position (uw-hybrid)');
    eq(seen?.dividendPct, 0.05, 'and the dividend');
    // THE WORLDS' SPREAD (loss engine commit 4b): what the team posts beside the
    // average comes back exactly, for the host's minimum column.
    const spread = after.room.teams[0].resultsByYear?.['1']?.surplusRange;
    eq(spread?.min, 600 - 123, 'and the minimum ending surplus across the team\'s worlds');
    eq(spread?.median, 600 + 7, 'and the median');
    eq(spread?.max, 600 + 456, 'and the maximum');
    eq(after.room.teams[1].resultsByYear?.['1']?.decisions?.WC?.confidenceLevel, DECISION_MARKER,
       'for EVERY team, not only the first');

    // ⚠ AND NOBODY ELSE SEES THEM. This is the half that would rot silently:
    // the decisions block rides inside resultsByYear, which localTransport
    // sends to every caller, so without an explicit strip a player would get
    // every other team's choices. Each of these fails without it.
    const asP0 = await t.read({ code, token: p0.teamToken });
    ok(!JSON.stringify(asP0).includes(String(DECISION_MARKER)),
       'a player receives no decisions block, not even its own, through the results channel');
    const asP1 = await t.read({ code, token: p1.teamToken });
    ok(!JSON.stringify(asP1).includes(String(DECISION_MARKER)),
       "a player cannot see another team's decisions for a completed year");
    const asViewer = await t.read({ code, token: viewer.teamToken });
    ok(!JSON.stringify(asViewer).includes(String(DECISION_MARKER)),
       'a viewer sees no decisions for a completed year');
    const anon = await t.read({ code });
    ok(!JSON.stringify(anon).includes(String(DECISION_MARKER)),
       'an anonymous caller sees no decisions for a completed year');

    // The figures themselves are untouched for those callers — the strip takes
    // the decisions and nothing else.
    eq(asP0.room.teams[0].resultsByYear?.['1']?.pool.endingSurplus, 600,
       'and the strip removes ONLY the decisions: the figures still arrive');
  }

  // ---- THE HOST'S LINES, AND PRIOR DEVELOPMENT ---------------------------
  // ⚠ THIS SECTION USED TO BE "team-chosen lines" AND IT TESTED THE OPPOSITE
  // RULE. A team asked for its own set at join, two teams in one room could play
  // different books, and a rejoin that disagreed was refused with LINES_LOCKED.
  // The host picks the room's lines now; every assertion below fails against
  // that old behaviour, which is the point of rewriting rather than deleting.
  {
    const t = transport();

    // The host declares the set. Canonical order regardless of the order given,
    // so two hosts who pick the same lines create the same room.
    const room = await t.createRoom({
      hostToken: newSessionToken(),
      seed: '1', yearCount: 3, startingYear: 2026, eventName: 'p',
      expectedTeams: 2, shocks: [],
      lines: ['Property', 'WC', 'GL'],
      priorDevelopment: { WC: 0.03, GL: 0.10, Property: -0.02 },
    });
    const hostRead = await t.read({ code: room.code, token: room.hostToken });
    eq(hostRead.room.lines.join(','), 'WC,GL,Property',
      'the room carries the lines the HOST chose, in canonical order');
    eq(JSON.stringify(hostRead.room.priorDevelopment),
      JSON.stringify({ WC: 0.03, GL: 0.10, Property: -0.02 }),
      'the room carries the prior development factors the host set');

    // ⚠ EVERY TEAM PLAYS THE ROOM'S SET, and a team sends nothing.
    const one = await t.join({ code: room.code, teamName: 'First', role: 'player' });
    const two = await t.join({ code: room.code, teamName: 'Second', role: 'player' });
    eq(one.lines.join(','), 'WC,GL,Property', 'a joining team is handed the ROOM\'s lines');
    eq(two.lines.join(','), one.lines.join(','), 'two teams in one room play the SAME book');

    const after = await t.read({ code: room.code, token: room.hostToken });
    const rowOf = (n: string) => after.room.teams.find(x => x.name === n)!;
    eq(rowOf('First').lines.join(','), 'WC,GL,Property', "the host's table carries the room's lines");

    // ⚠ A STRAY `lines` ON THE WIRE IS IGNORED, NOT REFUSED. A client built
    // against the old contract must still join and must still play the room's
    // set — the contract says so explicitly, and this is where that is proved.
    const stale = await t.join(
      { code: room.code, teamName: 'Stale Client', role: 'player', lines: ['WC'] } as never,
    );
    eq(stale.lines.join(','), 'WC,GL,Property',
      'a stale client sending its own lines is ignored and plays the room\'s');

    // A rejoin needs no lines and never did disagree — there is nothing to send.
    const back = await t.join({ code: room.code, teamName: 'First', role: 'player', token: one.teamToken });
    eq(back.rejoined, true, 'a rejoin is still a rejoin');
    eq(back.lines.join(','), 'WC,GL,Property', "a rejoin returns the room's lines");

    // ---- what the ROOM refuses, which is where the check moved to ----------
    await rejects(
      t.createRoom({
        hostToken: newSessionToken(), seed: '1', yearCount: 3, startingYear: 2026,
        eventName: 'p', expectedTeams: 2, shocks: [], lines: [],
      }),
      'INVALID_REQUEST', 'a room must use at least one coverage line',
    );
    await rejects(
      t.createRoom({
        hostToken: newSessionToken(), seed: '1', yearCount: 3, startingYear: 2026,
        eventName: 'p', expectedTeams: 2, shocks: [], lines: ['Marine'],
      } as never),
      'INVALID_REQUEST', 'a room cannot be created on something that is not a coverage line',
    );

    // ⚠ A FACTOR FOR A LINE THE ROOM DOES NOT PLAY IS DROPPED, NOT REFUSED. The
    // host screen keeps a value per line as lines are toggled, so a leftover is
    // ordinary rather than a bad request.
    const wcOnly = await t.createRoom({
      hostToken: newSessionToken(), seed: '1', yearCount: 3, startingYear: 2026,
      eventName: 'p', expectedTeams: 1, shocks: [],
      lines: ['WC'], priorDevelopment: { WC: 0.03, GL: 0.10 },
    });
    const wcRead = await t.read({ code: wcOnly.code, token: wcOnly.hostToken });
    eq(wcRead.room.lines.join(','), 'WC', 'a room may play one line');
    eq(JSON.stringify(wcRead.room.priorDevelopment), JSON.stringify({ WC: 0.03 }),
      'a factor for a line the room does not play is dropped');

    // ⚠ OMITTING priorDevelopment IS LEGAL and reads as no development.
    const bare = await t.createRoom({
      hostToken: newSessionToken(), seed: '1', yearCount: 3, startingYear: 2026,
      eventName: 'p', expectedTeams: 1, shocks: [], lines: ['GL'],
    });
    const bareRead = await t.read({ code: bare.code, token: bare.hostToken });
    eq(JSON.stringify(bareRead.room.priorDevelopment), '{}',
      'a room created without prior development carries none');

    // THE POOL NAME. The host sets it apart from the event name; a room created
    // without one — by a client older than the handler, or before it existed —
    // names its pool after the event, as does a blank one. The lobby still
    // lists the event, never the pool.
    eq(bareRead.room.poolName, 'p', 'a room created without a pool name names its pool after the event');
    const named = await t.createRoom({
      hostToken: newSessionToken(), seed: '1', yearCount: 3, startingYear: 2027,
      eventName: 'Spring Workshop', poolName: '  Harbour Public Entity Pool  ', expectedTeams: 1, shocks: [], lines: ['WC'],
    });
    const namedRead = await t.read({ code: named.code, token: named.hostToken });
    eq(namedRead.room.poolName, 'Harbour Public Entity Pool', 'the pool name the host set is the room\'s, trimmed');
    eq(namedRead.room.eventName, 'Spring Workshop', 'the event name stands apart from the pool name');
    const namedJoin = await t.join({ code: named.code, teamName: 'Harbour', role: 'player' });
    eq((await t.read({ code: named.code, token: namedJoin.teamToken })).room.poolName, 'Harbour Public Entity Pool',
      'a team reads the pool name');
    const namedLobby = (await t.listEvents({})).events.find(e => e.code === named.code);
    eq(namedLobby?.eventName, 'Spring Workshop', 'the lobby lists the event, not the pool');
    eq('poolName' in (namedLobby ?? {}), false, 'the lobby carries no pool name');
    const blank = await t.createRoom({
      hostToken: newSessionToken(), seed: '1', yearCount: 3, startingYear: 2027,
      eventName: 'q', poolName: '   ', expectedTeams: 1, shocks: [], lines: ['WC'],
    });
    eq((await t.read({ code: blank.code, token: blank.hostToken })).room.poolName, 'q', 'a blank pool name reads the event name');
    await rejects(
      t.createRoom({
        hostToken: newSessionToken(), seed: '1', yearCount: 3, startingYear: 2027,
        eventName: 'p', poolName: 42 as unknown as string, expectedTeams: 1, shocks: [], lines: ['WC'],
      }),
      'INVALID_REQUEST', 'a pool name that is not text is refused',
    );

    // expectedTeams still binds nothing.
    await t.join({ code: wcOnly.code, teamName: 'A', role: 'player' });
    const third = await t.join({ code: wcOnly.code, teamName: 'B', role: 'player' });
    eq(third.rejoined, false, 'a team beyond expectedTeams still joins');

    // A viewer needs the watched team's lines, which are the room's.
    const watcher = await t.join({ code: room.code, teamName: 'First', role: 'viewer' });
    eq(watcher.lines.join(','), 'WC,GL,Property', "a viewer is handed the watched team's lines");
    const asWatcher = await t.read({ code: room.code, token: watcher.teamToken });
    eq((asWatcher.you.lines ?? []).join(','), 'WC,GL,Property', 'read gives a viewer those lines');
    const asPlayer = await t.read({ code: room.code, token: one.teamToken });
    eq((asPlayer.you.lines ?? []).join(','), 'WC,GL,Property', 'read gives a player its own lines');
  }

  // ---- completion ------------------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t); // yearCount 3
    await step(t, code, hostToken); // -> 2
    await step(t, code, hostToken); // -> 3
    const last = await step(t, code, hostToken); // -> 4, past the end
    eq(last.room.status, 'complete', 'a room past its last year reads as complete');
    await rejects(t.advance({ code, token: hostToken, expectedYear: 4 }), 'GAME_COMPLETE', 'a complete game cannot advance again');
  }

  // ---- IDEMPOTENCY: the three mutating endpoints survive a lost response --
  //
  // ⚠ A LOST RESPONSE IS NOT AN EXOTIC CASE. It is what every client produces
  // the moment a network blinks: the request arrived, the work was done, the
  // reply went down a socket nobody was listening on, and the client retries a
  // byte-identical request. Each of these three used to do real damage on that
  // path — advance SKIPPED A YEAR, createRoom made a SECOND ROOM, and join
  // answered TEAM_TAKEN to the player who had just made the team.
  {
    const t = transport();
    const { code, hostToken, reused } = await freshRoom(t);
    ok(reused === false, 'a first createRoom reports reused: false');

    // ADVANCE, TWICE, WITH THE SAME EXPECTED YEAR — the proof.
    const first = await t.advance({ code, token: hostToken, expectedYear: 1 });
    const retry = await t.advance({ code, token: hostToken, expectedYear: 1 });
    eq(first.currentYear, 2, 'the first advance moves the room to year 2');
    ok(first.advanced === true, 'the first advance reports advanced: true');
    // ⚠ THE RETRY SUCCEEDS. It does not reject, and it does not move the room.
    eq(retry.currentYear, 2, 'the RETRY leaves the room on year 2 — one advance, not two');
    ok(retry.advanced === false, 'the retry reports advanced: false — it did not move the year');
    eq(retry.room.currentYear, 2, 'the room the retry returns is the same room, on year 2');
    const after = await t.read({ code, token: hostToken });
    eq(after.room.currentYear, 2, 'and a fresh read agrees: the year moved exactly once');

    // The other three branches of the compare-and-swap.
    await rejects(t.advance({ code, token: hostToken, expectedYear: 1 - 1 }), 'WRONG_YEAR',
      'an expectation two years stale is WRONG_YEAR, not a silent no-op');
    await rejects(t.advance({ code, token: hostToken, expectedYear: 9 }), 'WRONG_YEAR',
      'an invented future expectation is WRONG_YEAR');
    await rejects(t.advance({ code, token: 'nope', expectedYear: 2 }), 'BAD_TOKEN',
      'a forged token is refused before the year is even considered');
  }
  {
    // CREATE, TWICE, WITH THE SAME HOST TOKEN.
    const t = transport();
    const token = newSessionToken();
    const mk = () => t.createRoom({
      hostToken: token, seed: '7', yearCount: 3, startingYear: 2026,
      eventName: 'Ripple Game', expectedTeams: 3, shocks: [], lines: WC,
    });
    const a = await mk();
    const b = await mk();
    eq(b.code, a.code, 'a retried createRoom returns the SAME room code, not a second room');
    ok(a.reused === false && b.reused === true,
      `the retry is reported as reused (first ${a.reused}, retry ${b.reused})`);
    eq(b.hostToken, token, 'the response echoes the token the caller minted');
  }
  {
    // JOIN, TWICE, WITH THE SAME CLIENT TOKEN.
    const t = transport();
    const { code } = await freshRoom(t);
    const token = newSessionToken();
    const req = { code, teamName: 'Harbour Mutual', role: 'player' as const, token };
    const a = await t.join(req);
    const b = await t.join({ ...req });
    ok(a.rejoined === false, 'the first join creates the team rather than rejoining');
    // ⚠ THE RETRY IS A REJOIN, NOT TEAM_TAKEN. This is the assertion the whole
    // client-minted-token change exists for.
    ok(b.rejoined === true, 'the RETRY is a rejoin, not TEAM_TAKEN');
    eq(b.teamToken, token, 'and it gets back the token it supplied');
    const room = (await t.read({ code })).room;
    eq(room.teams.length, 1, 'the room holds ONE team after the retry, not two');

    // ⚠ AND A CLIENT CANNOT TAKE A SEAT BY PRESENTING SOMEBODY ELSE'S TOKEN.
    // Moving the mint to the client would be a hole without this.
    await rejects(
      t.join({ code, teamName: 'Cedar Valley', role: 'player', token }),
      'BAD_TOKEN', 'a token already owned by another team is refused on a new join',
    );
  }

  // ---- fallibility -----------------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);

    // ⚠ EVERY CALL CAN FAIL, AND THE UI HAS TO HAVE BEEN BUILT FOR THAT. This is
    // the mechanism that lets a loading spinner and an error state be walked
    // now, against a fake network, rather than discovered against a real one.
    t.faults.failNext();
    await rejects(t.read({ code, token: hostToken }), 'TRANSPORT_FAILURE', 'an injected fault fails the next call');

    const after = await t.read({ code, token: hostToken });
    eq(after.room.code, code, 'the call after an injected fault succeeds again');

    t.faults.failAll('TRANSPORT_FAILURE');
    await rejects(t.read({ code, token: hostToken }), 'TRANSPORT_FAILURE', 'failAll holds the error state');
    await rejects(t.advance({ code, token: hostToken, expectedYear: 1 }), 'TRANSPORT_FAILURE', 'failAll applies to every endpoint');
    t.faults.clear();
    const recovered = await t.read({ code, token: hostToken });
    eq(recovered.room.code, code, 'clearing the fault restores the transport');

    // A retryable failure is what a UI is allowed to retry silently; a refused
    // request is what it must report. Keeping them distinguishable matters more
    // once the pipe is real.
    try {
      t.faults.failNext();
      await t.read({ code, token: hostToken });
    } catch (e) {
      ok(isSessionError(e) && e.retryable, 'an injected transport failure is marked retryable');
    }
    try {
      await t.join({ code, teamName: TEAMS[0], role: 'player' });
      await t.join({ code, teamName: TEAMS[0], role: 'player' });
    } catch (e) {
      ok(isSessionError(e) && !e.retryable, 'a refused request is NOT marked retryable');
    }
  }

  // ---- rev monotonicity ------------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);
    const r0 = await t.read({ code, token: hostToken });
    const p = await t.join({ code, teamName: TEAMS[0], role: 'player' });
    const r1 = await t.read({ code, token: hostToken });
    await t.submit({ code, token: p.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'x') });
    const r2 = await t.read({ code, token: hostToken });
    ok(r1.room.rev > r0.room.rev, 'a join bumps the revision');
    ok(r2.room.rev > r1.room.rev, 'a submit bumps the revision');
    eq(r2.room.rev, r0.room.rev + 2, 'the revision counts writes exactly, so a poller can trust it');
  }

  // ---- THE LOBBY -------------------------------------------------------
  //
  // ⚠ ALL FOUR OF THESE RUN AGAINST EVERY IMPLEMENTATION, which is the whole
  // reason they are here and not only in the browser driver. The local
  // transport keeps its index in localStorage and the Dynamo one keeps it in a
  // single LOBBY item updated by path expressions — two entirely different
  // mechanisms that have to produce one answer. A rule enforced in the screen,
  // or in only one transport, is a rule a client can walk around.
  {
    const t = transport();

    // --- listing ---------------------------------------------------------
    const a = await freshRoom(t);
    const listedAfterCreate = (await t.listEvents({})).events;
    const rowA = listedAfterCreate.find(e => e.code === a.code);
    ok(!!rowA, 'a created event is listed');
    eq(rowA?.status, 'OPEN', 'a created event is listed OPEN');
    eq(rowA?.eventName, 'Ripple Game', 'the row carries the event name');
    eq(rowA?.teams, 0, 'a new event lists no teams');
    // ⚠ THE ROW CARRIES NO TOKENS AND NO NAMES. The lobby has no passcode, so
    // anything on a row is public; team NAMES live behind a join.
    ok(!JSON.stringify(rowA).includes(a.hostToken), 'a lobby row never carries the host token');

    const joined = await t.join({ code: a.code, teamName: TEAMS[0], role: 'player' });
    eq((await t.listEvents({})).events.find(e => e.code === a.code)?.teams, 1,
      'the row counts a team that joined');

    // --- status: OPEN until the FIRST ADVANCE ----------------------------
    // ⚠ NOT 'when somebody joins', which is what RoomStatus does. A room with
    // teams waiting for the host is exactly what the lobby is for.
    eq((await t.read({ code: a.code, token: a.hostToken })).room.status, 'running',
      'RoomStatus turns running on a join, as it always has');
    eq((await t.listEvents({})).events.find(e => e.code === a.code)?.status, 'OPEN',
      'the EVENT is still OPEN once a team has joined — the two statuses differ');

    await t.advance({ code: a.code, token: a.hostToken, expectedYear: 1 });
    const afterAdvance = (await t.listEvents({})).events.find(e => e.code === a.code);
    eq(afterAdvance?.status, 'IN_PROGRESS', 'the first advance turns the event IN_PROGRESS');
    eq(afterAdvance?.currentYear, 2, 'the row carries the current year');

    // --- late join: the SERVER refuses, not only the screen ---------------
    await rejects(
      t.join({ code: a.code, teamName: 'Johnny Come Lately', role: 'player' }),
      'EVENT_IN_PROGRESS', 'a NEW team is refused once the event is in progress');
    // ⚠ AND THE TWO THINGS IT MUST NOT REFUSE.
    const rejoin = await t.join({ code: a.code, teamName: TEAMS[0], role: 'player', token: joined.teamToken });
    ok(rejoin.rejoined, 'a team already in the room may still rejoin in progress');
    const watcher = await t.join({ code: a.code, teamName: TEAMS[0], role: 'viewer' });
    eq(watcher.role, 'viewer', 'a viewer may still join in progress');

    // --- hiding -----------------------------------------------------------
    await rejects(
      t.setEventHidden({ code: a.code, token: joined.teamToken, hidden: true }),
      'NOT_HOST', 'only the host may hide an event');

    const hid = await t.setEventHidden({ code: a.code, token: a.hostToken, hidden: true });
    eq(hid.room.hidden, true, 'the room reports itself hidden');
    ok(!(await t.listEvents({})).events.some(e => e.code === a.code), 'a hidden event is off the lobby');
    // ⚠ HIDING IS NOT CLOSING — the room keeps working by its code, and the
    // late-join rule is unchanged by it in BOTH directions.
    eq((await t.read({ code: a.code, token: a.hostToken })).room.code, a.code,
      'a hidden room is still reachable by its code');
    await rejects(
      t.join({ code: a.code, teamName: 'Also Late', role: 'player' }),
      'EVENT_IN_PROGRESS', 'hiding does not reopen an in-progress event to new teams');

    await t.setEventHidden({ code: a.code, token: a.hostToken, hidden: false });
    ok((await t.listEvents({})).events.some(e => e.code === a.code), 'unhiding puts it back');
    // Idempotent, and silently so: a toggle that threw on a double click would
    // be a worse contract than one that agrees.
    const again = await t.setEventHidden({ code: a.code, token: a.hostToken, hidden: false });
    eq(again.room.hidden, false, 'setting hidden to what it already is succeeds');

    // --- a hidden OPEN event still takes teams ---------------------------
    const b = await freshRoom(t);
    await t.setEventHidden({ code: b.code, token: b.hostToken, hidden: true });
    const intoHidden = await t.join({ code: b.code, teamName: TEAMS[1], role: 'player' });
    eq(intoHidden.role, 'player',
      'a hidden event that is still OPEN takes a new team — hiding governs finding, not joining');

    // --- FINISHED drops off ----------------------------------------------
    for (let y = 2; y <= 3; y++) await t.advance({ code: a.code, token: a.hostToken, expectedYear: y });
    const finished = (await t.read({ code: a.code, token: a.hostToken })).room;
    eq(finished.currentYear, 4, 'the room is past its last year');
    ok(!(await t.listEvents({})).events.some(e => e.code === a.code), 'a finished event drops off the lobby');
    // ⚠ AND ITS TEAMS KEEP IT. Dropping off the lobby is not expiry.
    eq((await t.read({ code: a.code, token: joined.teamToken })).room.code, a.code,
      'a team still reaches a finished room by its code');
    await rejects(
      t.join({ code: a.code, teamName: 'Far Too Late', role: 'player' }),
      'EVENT_IN_PROGRESS', 'a finished event takes no new teams');
  }

  // ---- VIEWER JOIN BY PIN -----------------------------------------------
  //
  // ⚠ VIEWER-ONLY, AND RESOLVED GLOBALLY. A PIN never creates or claims a team
  // — it only tells join() which existing team to watch, which is why a PIN
  // plus role: 'player' is refused outright rather than silently downgraded.
  // And it resolves with no room code in hand at all, which is the one new
  // kind of lookup this feature adds — see keys.ts's pinPk.
  {
    const t = transport();
    const { code } = await freshRoom(t);
    const driver = await t.join({ code, teamName: TEAMS[0], role: 'player' });

    ok(typeof driver.pin === 'string' && driver.pin.length > 0,
      'a player creating a team gets back a PIN for it');
    ok(!JSON.stringify(await t.read({ code })).includes(driver.pin as string),
      'the PIN is never carried on a room view, for anyone');

    const watcher = await t.join({ pin: driver.pin, role: 'viewer' } as never);
    eq(watcher.role, 'viewer', 'joining by PIN lands as a viewer');
    eq(watcher.teamName, TEAMS[0], 'and resolves to the team the PIN was minted for');
    ok(watcher.pin === undefined, 'a viewer never receives a PIN of its own — only a player does');
    eq(watcher.lines.join(','), driver.lines.join(','), 'a PIN-joined viewer gets the watched team\'s lines');

    // ⚠ SAME REDACTION A NAME-BASED VIEWER JOIN ALREADY GETS. Resolving by PIN
    // changes how the team is FOUND, not what the caller is handed back.
    const asWatcher = await t.read({ code, token: watcher.teamToken });
    eq(asWatcher.you.role, 'viewer', 'a PIN-minted viewer token reads back as a viewer');
    eq(asWatcher.you.teamName, TEAMS[0], 'bound to the watched team, same as a name-based viewer join');

    const rejoinedPlayer = await t.join({ code, teamName: TEAMS[0], role: 'player', token: driver.teamToken });
    eq(rejoinedPlayer.pin, driver.pin, 'a rejoining player is handed the same PIN again');

    await rejects(
      t.join({ pin: '000000', role: 'viewer' } as never),
      'TEAM_NOT_FOUND', 'an unknown PIN resolves to no team');
    await rejects(
      t.join({ pin: driver.pin, role: 'player' } as never),
      'INVALID_REQUEST', 'a PIN combined with role: player is refused — a PIN never claims a team');
  }

}

// ---------------------------------------------------------------- the passes

async function runPass(label: string, make: typeof makeTransport): Promise<number> {
  makeTransport = make;
  failures.length = 0;
  checks = 0;
  await main();
  console.log(`  ${label.padEnd(22)} ${checks - failures.length}/${checks} assertions passed`);
  for (const f of failures) console.log(`    FAIL  ${f}`);
  return failures.length;
}

async function all(): Promise<void> {
  console.log('session-contract-check — the SAME assertions against each implementation\n');

  let bad = await runPass('localStorage', () => new LocalSessionTransport({ latencyMs: 0 }));

  // The stub is started here rather than assumed: the harness is the thing that
  // must not need a running environment to be useful.
  const { createStubServer } = await import('./session-stub-server');
  const server: Server = createStubServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  bad += await runPass('HTTP + stub server', () => new HttpSessionTransport({ baseUrl: `http://127.0.0.1:${port}` }));
  await new Promise<void>(r => { server.close(() => r()); });

  if (process.argv.includes('--dynamo')) bad += await dynamoPasses();

  console.log('');
  if (bad > 0) {
    console.log(`FAIL — ${bad} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('PASS — seven endpoints, token authority, redaction, carry-forward, the lobby and the failure path,');
  console.log(process.argv.includes('--dynamo')
    ? '       identically over localStorage, the stub, DynamoDB and the Lambda handler.'
    : '       identically over localStorage and over the wire.');
}

// ---------------------------------------------------------------- --dynamo

const DYNAMO_IMAGE = 'amazon/dynamodb-local:3.3.1';

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * The real server's dispatch behind a real socket. Turns each request into the
 * API Gateway HTTP API (v2) event the Lambda receives and writes back the result
 * it returns, adding nothing — the handler owns every status and header.
 */
function lambdaShim(handler: ReturnType<typeof makeHandler>): Server {
  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      void (async () => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
        const rawPath = (req.url ?? '/').split('?')[0];
        const event = {
          version: '2.0',
          routeKey: '$default',
          rawPath,
          rawQueryString: '',
          headers,
          requestContext: { http: { method: req.method ?? 'GET', path: rawPath } },
          body: Buffer.concat(chunks).toString('utf8'),
          isBase64Encoded: false,
        } as unknown as APIGatewayProxyEventV2;
        const out = await handler(event);
        res.writeHead(out.statusCode ?? 200, (out.headers ?? {}) as Record<string, string>);
        res.end(out.body ?? '');
      })();
    });
  });
}

async function dynamoPasses(): Promise<number> {
  const { CreateTableCommand, DynamoDBClient, ListTablesCommand, ScanCommand, UpdateTimeToLiveCommand } = await import('@aws-sdk/client-dynamodb');
  const { DynamoSessionTransport } = await import('../../src/session/server/rooms');
  const { dynamoFromEnv } = await import('../../src/session/server/dynamo');
  const { handler } = await import('../../src/session/server/handler');
  const { unzipSync } = await import('fflate');
  const name = `ripple-contract-${process.pid}`;
  const table = 'ripple-sessions-contract';
  let bad = 0;
  docker(['run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::8000', DYNAMO_IMAGE]);
  try {
    const port = docker(['port', name, '8000/tcp']).split('\n')[0].split(':').pop();
    const client = {
      endpoint: `http://127.0.0.1:${port}`,
      region: 'us-west-2',
      // ⚠ DUMMY CREDENTIALS, ON PURPOSE. With these and a local endpoint the SDK
      // cannot reach a real account even on a machine that has real ones.
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    };
    const raw = new DynamoDBClient(client);
    for (let i = 0; ; i++) {
      try { await raw.send(new ListTablesCommand({})); break; } catch (e) {
        if (i > 60) throw e;
        await new Promise(r => setTimeout(r, 250));
      }
    }
    // The schema docs/SESSION_DYNAMODB.md gives the console: pk/sk strings,
    // on-demand, TTL on expiresAtSec. No secondary index.
    await raw.send(new CreateTableCommand({
      TableName: table,
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }));
    await raw.send(new UpdateTimeToLiveCommand({
      TableName: table,
      TimeToLiveSpecification: { Enabled: true, AttributeName: 'expiresAtSec' },
    }));

    // ⚠ REACH: EACH PASS MUST BE SEEN TO WRITE TO THIS CONTAINER'S TABLE. A pass
    // that silently fell through to an implementation already known to work —
    // a wrong import, the wrong container, a handler with an injected transport
    // nobody meant — would read 144/144 exactly like a real one. The count of
    // items in THIS table before and after each pass is what cannot be faked
    // from anywhere else. It is not one of the 144; it is whether they ran here.
    const countItems = async (): Promise<number> => {
      let n = 0;
      let start: Record<string, AttributeValue> | undefined;
      do {
        const page = await raw.send(new ScanCommand({ TableName: table, Select: 'COUNT', ExclusiveStartKey: start }));
        n += page.Count ?? 0;
        start = page.LastEvaluatedKey;
      } while (start);
      return n;
    };
    const reached = async (label: string, run: () => Promise<number>): Promise<number> => {
      const before = await countItems();
      const failed = await run();
      const wrote = (await countItems()) - before;
      console.log(`  ${''.padEnd(22)} reach: ${wrote} items written to DynamoDB Local by this pass`);
      if (wrote <= 0) {
        console.log(`    FAIL  ${label} wrote nothing to the table — it did not run against DynamoDB`);
        return failed + 1;
      }
      return failed;
    };

    const dynamo = dynamoFromEnv({ tableName: table, client });
    bad += await reached('DynamoDB, in-process', () =>
      runPass('DynamoDB, in-process', () => new DynamoSessionTransport({ dynamo })));

    // ⚠ THE HANDLER EXACTLY AS LAMBDA LOADS IT: the module's own exported
    // `handler`, building its transport from the environment on first call — no
    // injected transport, no config object. TABLE_NAME and the SDK's standard
    // AWS_ENDPOINT_URL_DYNAMODB / AWS_REGION / credential variables are the
    // whole configuration, as they are on the function.
    const saved = { ...process.env };
    Object.assign(process.env, {
      TABLE_NAME: table,
      AWS_REGION: client.region,
      AWS_ENDPOINT_URL_DYNAMODB: client.endpoint,
      AWS_ACCESS_KEY_ID: client.credentials.accessKeyId,
      AWS_SECRET_ACCESS_KEY: client.credentials.secretAccessKey,
    });
    delete process.env.AWS_PROFILE;
    delete process.env.AWS_SESSION_TOKEN;
    try {
      const overHttp = async (label: string, handler: ReturnType<typeof makeHandler>) => {
        const server = lambdaShim(handler);
        await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
        const addr = server.address();
        const shimPort = typeof addr === 'object' && addr ? addr.port : 0;
        const failed = await reached(label, () =>
          runPass(label, () => new HttpSessionTransport({ baseUrl: `http://127.0.0.1:${shimPort}` })));
        await new Promise<void>(r => { server.close(() => r()); });
        return failed;
      };
      bad += await overHttp('HTTP + Lambda handler', handler);

      // ⚠ --built: THE ARTIFACT, NOT THE SOURCE. The same pass against
      // dist-lambda/handler.zip's own index.js, unzipped and require()d as the
      // runtime does. A missing zip FAILS rather than skipping — a pass that
      // quietly does not run is the thing this whole section guards against.
      if (process.argv.includes('--built')) {
        const zipFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist-lambda/handler.zip');
        if (!existsSync(zipFile)) {
          console.log('    FAIL  --built: dist-lambda/handler.zip is missing — run npm run build:handler');
          bad += 1;
        } else {
          const dir = mkdtempSync(path.join(tmpdir(), 'ripple-built-'));
          try {
            const entry = path.join(dir, 'index.js');
            writeFileSync(entry, unzipSync(readFileSync(zipFile))['index.js']);
            const built = createRequire(entry)(entry) as { handler: ReturnType<typeof makeHandler> };
            bad += await overHttp('HTTP + built zip', built.handler);
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        }
      }
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
    raw.destroy();
    dynamo.doc.destroy();
  } finally {
    try { docker(['rm', '-f', name]); } catch { /* already gone */ }
  }
  return bad;
}

all().catch(e => {
  console.error('session-contract-check threw:', e);
  process.exit(1);
});
