// ============================================================================
// THE RACES THE CONTRACT HARNESS CANNOT REACH — and the ordering trap.
//
//   npx tsx scripts/tools/session-race-probe.ts      (npm run contract:races)
//
// ⚠ WHY THIS IS NOT IN session-contract-check.ts. That harness is 144 assertions
// run identically over four implementations, and every block in it is
// sequential. The Lambda's ConditionExpressions exist for what happens when two
// requests interleave, and a sequential suite cannot make two requests
// interleave — so DynamoSessionTransport passed all 144 with each of the fixes
// below deleted. This probe forces each interleaving deterministically: it
// stalls one request between its read and its write and runs the other inside
// the gap, which is the window navigator.locks used to close.
//
// ⚠ VALIDATED AGAINST THE BROKEN CODE, per SESSION_PRACTICES.md section 2. Each
// probe was run with its protection deleted from the handler, and failed. The
// 144 stayed green through every one of these, which is why this file exists:
//   D      advance cases 2 and 3 swapped       the completing retry -> GAME_COMPLETE
//   A, A∥  no TOKEN# claim in a player join    two teams holding one token
//   B, B∥  a failed NAME# -> TEAM_TAKEN        the retry is TEAM_TAKEN, not a rejoin
//   B3     viewer join skips the TOKEN# check  a viewer holding a player's token
//   C      an unconditioned CREATE# put        15 of 15 same-token pairs got two codes
//   E      decisions not conditioned on year   late decisions recorded after the advance
//   I      items read before the header        a current rev with a missing result
//   J      readback re-reads, not ALL_OLD      a genuine retry answered WRONG_YEAR
//   G      expiry stamp not checked            an expired room still answers
//   H      tokens written unhashed             raw bearer tokens in the table
//
// ⚠ HOW THEY GET THEIR CONCURRENCY. Most are SEQUENTIAL, arranged so they
// reproduce a race's exact interleaving. The request under test is held between
// a read and its write, and the competing request runs to completion inside the
// gap. That is deterministic: green means the window was hit and held every
// time. A∥, B∥, C and F are genuinely parallel requests. F also counts
// TransactionConflicts, and DynamoDB Local raised none, so the conflict-retry
// path is NOT exercised by anything. The full list of what no instrument covers
// is in the header of src/session/server/rooms.ts.
//
// D also runs against LocalSessionTransport, so the ordering is checked to be
// the reference's and not merely this implementation's opinion.
//
// Needs Docker (amazon/dynamodb-local) and no AWS credentials.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { CreateTableCommand, DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { DynamoSessionTransport } from '../../src/session/server/rooms';
import { dynamoFromEnv } from '../../src/session/server/dynamo';
import { LocalSessionTransport } from '../../src/session/localTransport';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { isSessionError, newSessionToken, SESSION_TOKEN_PATTERN, type JoinResponse, type SessionTransport } from '../../src/session/contract';

// The reference implementation runs behind the same memory shim the harness uses.
{
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
  };
}

const docker = (a: string[]) => execFileSync('docker', a, { encoding: 'utf8' }).trim();
const name = `ripple-races-${process.pid}`;
docker(['run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::8000', 'amazon/dynamodb-local:3.3.1']);
const results: string[] = [];
let bad = 0;
const check = (c: boolean, what: string) => { results.push(`${c ? 'ok  ' : 'FAIL'} ${what}`); if (!c) bad++; };
try {
  const port = docker(['port', name, '8000/tcp']).split(':').pop();
  const client = { endpoint: `http://127.0.0.1:${port}`, region: 'us-west-2', credentials: { accessKeyId: 'l', secretAccessKey: 'l' } };
  const raw = new DynamoDBClient(client);
  for (let i = 0; ; i++) { try { await raw.send(new ListTablesCommand({})); break; } catch (e) { if (i > 60) throw e; await new Promise(r => setTimeout(r, 250)); } }
  await raw.send(new CreateTableCommand({ TableName: 'probe-table', AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }], BillingMode: 'PAY_PER_REQUEST' }));
  const dynamo = dynamoFromEnv({ tableName: 'probe-table', client });
  const fresh = () => new DynamoSessionTransport({ dynamo });
  const mkRoom = (t: SessionTransport, yearCount = 3, hostToken = newSessionToken()) =>
    t.createRoom({ hostToken, seed: 's', yearCount, startingYear: 2026, eventName: 'p', expectedTeams: 2, shocks: [] });
  type Settled<T> = { ok: true; v: T } | { ok: false; code: string };
  const settle = async <T>(p: Promise<T>): Promise<Settled<T>> => {
    try { return { ok: true, v: await p }; } catch (e) { return { ok: false, code: isSessionError(e) ? e.code : String(e) }; }
  };
  const shown = <T>(s: Settled<T>, f: (v: T) => unknown) => (s.ok ? String(f(s.v)) : s.code);

  // ⚠ THE INTERLEAVING. The NEXT header read on `t` returns its value only after
  // `between` has run — so `t` decides on a room that `between` has since changed,
  // which is exactly what two parallel Lambda invocations do to each other.
  // getHeader is private; reaching it here is the point of a probe.
  type Stallable = {
    getHeader: (code: string) => Promise<unknown>;
    queryPrefix: (pk: string, prefix: string) => Promise<unknown>;
  };
  // `skip` lets the first N reads through untouched, to reach a later read in the
  // same request (J needs the readback, not the role-resolution read).
  const stallNextRead = (t: DynamoSessionTransport, between: () => Promise<unknown>) => {
    const target = t as unknown as Stallable;
    const orig = target.getHeader.bind(t);
    target.getHeader = async (code: string) => { const h = await orig(code); target.getHeader = orig; await between(); return h; };
  };
  // The other half: `between` runs BEFORE a later header read, so that read sees
  // the changed room. `skip` lets the first N reads through untouched. J needs
  // this one — a readback that re-reads must be shown the newer room, or a
  // re-read and ALL_OLD are indistinguishable and the probe proves nothing.
  const changeBeforeRead = (t: DynamoSessionTransport, between: () => Promise<unknown>, skip: number) => {
    const target = t as unknown as Stallable;
    const orig = target.getHeader.bind(t);
    let seen = 0;
    target.getHeader = async (code: string) => {
      if (seen++ < skip) return orig(code);
      target.getHeader = orig;
      await between();
      return orig(code);
    };
  };
  // The same, on the item Query: `between` runs after the items are fetched and
  // before the request goes on to whatever it does next.
  const stallNextQuery = (t: DynamoSessionTransport, between: () => Promise<unknown>) => {
    const target = t as unknown as Stallable;
    const orig = target.queryPrefix.bind(t);
    target.queryPrefix = async (pk: string, prefix: string) => {
      const items = await orig(pk, prefix);
      target.queryPrefix = orig;
      await between();
      return items;
    };
  };

  // ⚠ COUNTING WHAT DYNAMODB ACTUALLY SAID. Every send through the shared client
  // is seen here, so F can report whether DynamoDB Local ever produced a
  // TransactionConflict — if it never does, the retry path is untested and the
  // probe says so rather than passing quietly.
  let conflicts = 0;
  {
    const doc = dynamo.doc as unknown as { send: (c: unknown) => Promise<unknown> };
    const send = doc.send.bind(dynamo.doc);
    doc.send = async (c: unknown) => {
      try { return await send(c); } catch (e) {
        const reasons = (e as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons ?? [];
        if (reasons.some(r => r.Code === 'TransactionConflict')) conflicts++;
        throw e;
      }
    };
  }

  // D. the ordering trap, both transports
  for (const [label, make] of [['local', () => new LocalSessionTransport({ latencyMs: 0 })], ['dynamo', fresh]] as const) {
    const t = make();
    const { code, hostToken } = await mkRoom(t, 3);
    for (const e of [1, 2, 3]) await t.advance({ code, token: hostToken, expectedYear: e });
    const retry = await settle(t.advance({ code, token: hostToken, expectedYear: 3 }));
    check(retry.ok && retry.v.advanced === false && retry.v.currentYear === 4, `[${label}] D: retry of the COMPLETING advance succeeds, advanced:false (${shown(retry, v => v.advanced)})`);
    const past = await settle(t.advance({ code, token: hostToken, expectedYear: 4 }));
    check(!past.ok && past.code === 'GAME_COMPLETE', `[${label}] D: a fresh advance past the end is GAME_COMPLETE (${shown(past, () => 'resolved')})`);
  }

  // A. same token, two names, B's read stale across A's join
  {
    const t = fresh(); const { code } = await mkRoom(t); const token = newSessionToken();
    let a = { ok: false, code: 'not run' } as Settled<JoinResponse>;
    stallNextRead(t, async () => { a = await settle(fresh().join({ code, teamName: 'A', role: 'player', lines: ['WC'], token })); });
    const b = await settle(t.join({ code, teamName: 'B', role: 'player', lines: ['WC'], token }));
    const room = (await fresh().read({ code })).room;
    check(a.ok && !b.ok && b.code === 'BAD_TOKEN', `A: second name with the same token is BAD_TOKEN (a ${a.ok}, b ${shown(b, () => 'resolved')})`);
    check(room.teams.length === 1, `A: one team holds the token (teams ${room.teams.length})`);
  }

  // B. same token, same name — the lost-response retry, its read stale across the first attempt
  {
    const t = fresh(); const { code } = await mkRoom(t); const token = newSessionToken();
    let a = { ok: false, code: 'not run' } as Settled<JoinResponse>;
    stallNextRead(t, async () => { a = await settle(fresh().join({ code, teamName: 'A', role: 'player', lines: ['WC'], token })); });
    const b = await settle(t.join({ code, teamName: 'A', role: 'player', lines: ['WC'], token }));
    check(a.ok && a.v.rejoined === false, 'B: the first attempt creates the team');
    check(b.ok && b.v.rejoined === true, `B: the retry that lost the race is a REJOIN, not TEAM_TAKEN (${shown(b, v => 'rejoined ' + v.rejoined)})`);
  }

  // B2. viewer token racing a player join with the same token
  {
    const t = fresh(); const { code } = await mkRoom(t); await fresh().join({ code, teamName: 'W', role: 'player', lines: ['WC'] });
    const token = newSessionToken();
    let a = { ok: false, code: 'not run' } as Settled<JoinResponse>;
    stallNextRead(t, async () => { a = await settle(fresh().join({ code, teamName: 'W', role: 'viewer', token })); });
    const b = await settle(t.join({ code, teamName: 'P', role: 'player', lines: ['WC'], token }));
    check(a.ok && !b.ok && b.code === 'BAD_TOKEN', `B2: a player cannot take a token a viewer claimed mid-flight (b ${shown(b, () => 'resolved')})`);
  }

  // C. concurrent createRoom, same host token
  {
    let split = 0, doubleFresh = 0;
    for (let i = 0; i < 15; i++) {
      const token = newSessionToken();
      const [x, y] = await Promise.all([mkRoom(fresh(), 3, token), mkRoom(fresh(), 3, token)]);
      if (x.code !== y.code) split++;
      if (!x.reused && !y.reused) doubleFresh++;
    }
    check(split === 0, `C: 15 concurrent same-token creates — pairs handed DIFFERENT codes: ${split}`);
    check(doubleFresh === 0, `C: pairs where both claimed reused:false: ${doubleFresh}`);
  }

  // E. decisions racing an advance: the submit's read is stale across the advance
  {
    const t = fresh(); const { code, hostToken } = await mkRoom(t);
    const p = await t.join({ code, teamName: 'A', role: 'player', lines: ['WC'] });
    stallNextRead(t, async () => { await fresh().advance({ code, token: hostToken, expectedYear: 1 }); });
    const s = await settle(t.submit({ code, token: p.teamToken, yearNumber: 1, decisions: { m: 'late' } }));
    const mine = await fresh().read({ code, token: p.teamToken });
    check(!s.ok && s.code === 'WRONG_YEAR', `E: year-1 decisions landing after year 1 was processed are WRONG_YEAR (${shown(s, () => 'resolved')})`);
    check(mine.you.decisionsByYear === undefined, 'E: and nothing was recorded');
  }
  // ---- GENUINELY PARALLEL, from here on unless stated -----------------------

  // A∥. A's race without the stall: two joins, one token, two names, fired
  // together. Real parallelism may or may not land in the window — this is the
  // probe that says how often it does, not one that forces it.
  {
    let doubled = 0;
    for (let i = 0; i < 30; i++) {
      const { code } = await mkRoom(fresh());
      const token = newSessionToken();
      await Promise.all(['A', 'B'].map(n => settle(fresh().join({ code, teamName: n, role: 'player', lines: ['WC'], token }))));
      if ((await fresh().read({ code })).room.teams.length > 1) doubled++;
    }
    check(doubled === 0, `A∥: 30 parallel same-token pairs — rooms where one token got two seats: ${doubled}`);
  }

  // B∥. B's race without the stall: the same join, twice at once (a client's
  // retry overlapping its own first attempt). Both must succeed, one team.
  {
    let taken = 0, doubled = 0;
    for (let i = 0; i < 30; i++) {
      const { code } = await mkRoom(fresh());
      const token = newSessionToken();
      const out = await Promise.all([0, 1].map(() => settle(fresh().join({ code, teamName: 'A', role: 'player', lines: ['WC'], token }))));
      if (out.some(o => !o.ok)) taken++;
      if ((await fresh().read({ code })).room.teams.length !== 1) doubled++;
    }
    check(taken === 0, `B∥: 30 overlapping same-token joins — pairs where one was refused: ${taken}`);
    check(doubled === 0, `B∥: pairs not ending with exactly one team: ${doubled}`);
  }

  // F. THE BURST keys.ts HARD 1 is about: twenty teams post at once, every
  // transaction touching the one header item. All must land, rev must count
  // them exactly, and the host must see all twenty.
  {
    const t = fresh(); const { code, hostToken } = await mkRoom(t);
    const teams = [];
    for (let i = 0; i < 20; i++) teams.push(await t.join({ code, teamName: `T${i}`, role: 'player', lines: ['WC'] }));
    const before = (await t.read({ code, token: hostToken })).room.rev;
    const conflictsBefore = conflicts;
    const posts = await Promise.all(teams.map((p, i) => settle(fresh().submit({
      code, token: p.teamToken, yearNumber: 0,
      result: { yearNumber: 0, calendarYear: 2025, byLine: {}, pool: { endingSurplus: i, actualLossRatioPricingBasis: 0, poolPremium: 0, activeMembers: 0, netUltimateLoss: 0 } },
    }))));
    const after = await t.read({ code, token: hostToken });
    const held = after.room.teams.filter(x => x.resultsByYear?.['0'] !== undefined).length;
    check(posts.every(x => x.ok), `F: 20 simultaneous result posts all succeed (${posts.filter(x => !x.ok).length} refused)`);
    check(after.room.rev === before + 20, `F: rev counts them exactly (${after.room.rev - before} of 20)`);
    check(held === 20, `F: the host sees all 20 (${held})`);
    results.push(`info DynamoDB Local raised ${conflicts - conflictsBefore} TransactionConflict(s) during F`
      + (conflicts - conflictsBefore === 0 ? ' — the conflict-retry path was NOT exercised' : ' — the retry path ran'));
  }

  // ---- DETERMINISTIC AGAIN ----------------------------------------------------

  // B3. B2's mirror: the PLAYER claims the token while the viewer's read is stale.
  {
    const t = fresh(); const { code } = await mkRoom(t); await fresh().join({ code, teamName: 'W', role: 'player', lines: ['WC'] });
    const token = newSessionToken();
    let a = { ok: false, code: 'not run' } as Settled<JoinResponse>;
    stallNextRead(t, async () => { a = await settle(fresh().join({ code, teamName: 'P', role: 'player', lines: ['WC'], token })); });
    const b = await settle(t.join({ code, teamName: 'W', role: 'viewer', token }));
    check(a.ok && !b.ok && b.code === 'BAD_TOKEN', `B3: a viewer cannot take a token a player claimed mid-flight (b ${shown(b, () => 'resolved')})`);
  }

  // I. HEADER FIRST, ITEMS SECOND. The host's read is held between its item
  // Query and returning; a team posts in the gap. A view may be OLD, but it must
  // never pair a newer rev with items that lack the write that made it newer —
  // a poller would store that rev and never fetch the missing result.
  {
    const t = fresh(); const { code, hostToken } = await mkRoom(t);
    const p = await t.join({ code, teamName: 'A', role: 'player', lines: ['WC'] });
    stallNextQuery(t, async () => {
      await fresh().submit({ code, token: p.teamToken, yearNumber: 0, result: { yearNumber: 0, calendarYear: 2025, byLine: {}, pool: { endingSurplus: 1, actualLossRatioPricingBasis: 0, poolPremium: 0, activeMembers: 0, netUltimateLoss: 0 } } });
    });
    const seen = await t.read({ code, token: hostToken });
    const now = await fresh().read({ code, token: hostToken });
    const sameRev = seen.room.rev === now.room.rev;
    const sameItems = JSON.stringify(seen.room.teams) === JSON.stringify(now.room.teams);
    check(!sameRev || sameItems, `I: a view at the current rev carries the current items (rev ${seen.room.rev} vs ${now.room.rev}, items ${sameItems ? 'equal' : 'DIFFER'})`);
  }

  // J. THE READBACK IS THE FAILED WRITE'S OWN IMAGE (ALL_OLD), NOT A RE-READ.
  // The host's advance 1->2 landed and its response was lost; the retry fails
  // the condition. Before anything else can be read, a second advance takes the
  // room to 3. The retry is still a retry and must succeed. (Validated: with the
  // readback replaced by a GetItem, this reads WRONG_YEAR. A first version that
  // ran the second advance AFTER the read did not — it passed on broken code.)
  {
    const t = fresh(); const { code, hostToken } = await mkRoom(t, 5);
    await fresh().advance({ code, token: hostToken, expectedYear: 1 });
    changeBeforeRead(t, async () => { await fresh().advance({ code, token: hostToken, expectedYear: 2 }); }, 1);
    const r = await settle(t.advance({ code, token: hostToken, expectedYear: 1 }));
    check(r.ok && r.v.advanced === false, `J: a retry decided from ALL_OLD survives a later advance (${shown(r, v => 'advanced ' + v.advanced)})`);
  }

  // G. EXPIRY: a header past its expiresAtSec is ROOM_NOT_FOUND whether or not
  // TTL has removed it — and DynamoDB Local never runs TTL, so presence is
  // guaranteed here and only the stamp can answer.
  {
    const shortLived = new DynamoSessionTransport({ dynamo: { ...dynamo, retentionSec: 1 } });
    const { code, hostToken } = await mkRoom(shortLived);
    await new Promise(r => setTimeout(r, 2100));
    const gone = await settle(shortLived.read({ code, token: hostToken }));
    check(!gone.ok && gone.code === 'ROOM_NOT_FOUND', `G: an expired room is ROOM_NOT_FOUND though its header is still there (${shown(gone, () => 'resolved')})`);
  }

  // H. NO PLAINTEXT TOKEN ANYWHERE IN THE TABLE, after everything above. Any
  // string that IS a session token (32 of [a-z0-9]) in any attribute of any item
  // is a raw bearer token written where only hashes belong.
  {
    let plain = 0, items = 0;
    let start: Record<string, unknown> | undefined;
    const walk = (v: unknown): void => {
      if (typeof v === 'string') { if (SESSION_TOKEN_PATTERN.test(v)) plain++; return; }
      if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
    };
    do {
      const page = await dynamo.doc.send(new ScanCommand({ TableName: 'probe-table', ExclusiveStartKey: start }));
      for (const it of page.Items ?? []) { items++; walk(it); }
      start = page.LastEvaluatedKey;
    } while (start);
    check(items > 0 && plain === 0, `H: ${items} items scanned, raw tokens found: ${plain}`);
  }

  raw.destroy(); dynamo.doc.destroy();
} finally {
  docker(['rm', '-f', name]);
}
console.log(results.join('\n'));
console.log(bad === 0 ? 'PROBES PASS' : `PROBES FAIL: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
