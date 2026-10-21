// ============================================================================
// THE ADMIN CONTRACT CHECK — the equivalent of session-contract-check.ts for
// src/admin/, scaled to a much smaller surface.
//
//   npx tsx scripts/tools/admin-contract-check.ts
//   npm run contract:admin
//
// ⚠ ALWAYS AGAINST DYNAMODB LOCAL. Unlike the session layer, admin accounts
// have no offline/local-storage implementation any more — adminAuth.ts is a
// thin HTTP client now, not a second implementation of the rules — so there
// is nothing to check without Docker. Needs Docker and NO AWS credentials:
// the SDK gets dummy ones and a 127.0.0.1 endpoint, same as
// session-contract-check.ts --dynamo.
//
// ⚠ THE SAME ASSERTIONS RUN TWICE: in-process against DynamoAdminBackend,
// then over a real socket through admin/server/handler.ts — the same
// lambdaShim trick turns an HTTP request into the API Gateway v2 event the
// Lambda receives. Both runs share one amazon/dynamodb-local container and
// one table, so every username this file uses is suffixed with a per-pass
// random tag — otherwise the second pass would collide with the first pass's
// leftover accounts in the same table.
//
// ⚠ BOOTSTRAPPING THE FIRST ACCOUNT IS NOT PART OF THE CONTRACT. There is no
// API that creates an admin account without already holding one (on purpose —
// see accounts.ts) — createAdminAccount requires a caller token. Each pass
// seeds exactly one account directly into the table first, with the same
// hashPassword() the real seed-default-admin.ts script uses, then logs in
// through the pass's own backend to get a real token for everything else.
//
// ⚠ EVERY PASS PRINTS HOW MANY ITEMS IT WROTE TO THE CONTAINER'S TABLE AND
// FAILS IF THAT IS ZERO — a pass that silently ran against something else
// would otherwise read as green, same reasoning session-contract-check.ts
// gives for the same check.
// ============================================================================

import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { makeHandler } from '../../src/admin/server/handler';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';

import {
  AdminError, isAdminError, type AdminBackend, type AdminErrorCode,
} from '../../src/admin/contract';

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

async function rejects(p: Promise<unknown>, code: AdminErrorCode, what: string): Promise<void> {
  checks++;
  try {
    await p;
    failures.push(`${what}: expected rejection ${code}, but it resolved`);
  } catch (e) {
    if (!isAdminError(e)) failures.push(`${what}: threw a non-AdminError: ${String(e)}`);
    else if (e.code !== code) failures.push(`${what}: expected ${code}, got ${e.code}`);
  }
}

// ---------------------------------------------------------------- fixture

let makeBackend: () => AdminBackend;
function backend(): AdminBackend {
  return makeBackend();
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function main(bootstrapUsername: string, bootstrapPassword: string): Promise<void> {
  const suffix = randomSuffix();
  const name = (base: string) => `${base}-${suffix}`;
  const b = backend();

  // ---- login -------------------------------------------------------------
  const boot = await b.adminLogin({ username: bootstrapUsername, password: bootstrapPassword });
  eq(boot.username, bootstrapUsername, 'the bootstrap account logs in with its seeded credentials');
  ok(boot.token.length > 0, 'login returns a non-empty token');

  await rejects(
    b.adminLogin({ username: bootstrapUsername, password: 'wrong-password' }),
    'BAD_CREDENTIALS', 'the wrong password is refused',
  );
  await rejects(
    b.adminLogin({ username: name('nobody'), password: 'whatever123' }),
    'BAD_CREDENTIALS', 'an unknown username is refused the same way a wrong password is',
  );

  const mine = await b.currentAdmin({ token: boot.token });
  eq(mine.username, bootstrapUsername, 'currentAdmin resolves a valid token to its username');
  const garbage = await b.currentAdmin({ token: 'not-a-real-token' });
  eq(garbage.username, null, 'currentAdmin on a bad token resolves to null rather than throwing');

  // ---- malformed requests: every field checked before it is used -----------
  //
  // ⚠ FOUND BY MIKE'S OWN TESTING, NOT BY THIS FILE. An empty {} against
  // adminLogin / currentAdmin / listAdminAccounts used to crash with a raw
  // TypeError (".trim() of undefined", "the \"data\" argument must be of
  // type string") instead of answering INVALID_REQUEST — exposing internals,
  // claiming retryable: true, and reading as a server outage. These
  // assertions are what would have caught it.
  await rejects(b.adminLogin({} as never), 'INVALID_REQUEST', 'adminLogin with no fields at all is refused cleanly, not a crash');
  await rejects(b.adminLogin({ username: 'x' } as never), 'INVALID_REQUEST', 'adminLogin missing only password is refused cleanly');
  const noToken = await b.currentAdmin({} as never);
  eq(noToken.username, null, 'currentAdmin with no token field at all resolves to null, same as a bad token — never an error');
  await rejects(b.listAdminAccounts({} as never), 'INVALID_REQUEST', 'listAdminAccounts with no token field is refused cleanly, not a crash');
  await rejects(b.createAdminAccount({ token: boot.token } as never), 'INVALID_REQUEST', 'createAdminAccount missing username/password is refused cleanly');
  await rejects(b.setAdminDisabled({ token: boot.token, username: name('second') } as never), 'INVALID_REQUEST', 'setAdminDisabled missing disabled is refused cleanly');
  await rejects(b.deleteAdminAccount({ token: boot.token } as never), 'INVALID_REQUEST', 'deleteAdminAccount missing username is refused cleanly');
  await rejects(b.resetAdminPassword({ token: boot.token, username: name('second') } as never), 'INVALID_REQUEST', 'resetAdminPassword missing newPassword is refused cleanly');

  // ---- create --------------------------------------------------------------
  await rejects(
    b.createAdminAccount({ token: 'nope', username: name('second'), password: 'whatever123' }),
    'BAD_TOKEN', 'creating an account needs a valid token',
  );
  await b.createAdminAccount({ token: boot.token, username: name('second'), password: 'whatever123' });
  await rejects(
    b.createAdminAccount({ token: boot.token, username: name('second'), password: 'different456' }),
    'USERNAME_TAKEN', 'the same username cannot be created twice',
  );
  await rejects(
    b.createAdminAccount({ token: boot.token, username: name('short'), password: 'abc' }),
    'INVALID_REQUEST', 'a password under four characters is refused',
  );

  const second = await b.adminLogin({ username: name('second'), password: 'whatever123' });
  eq(second.username, name('second'), 'the newly created account logs in with the password it was given');

  // ---- list ------------------------------------------------------------
  await rejects(b.listAdminAccounts({ token: 'nope' }), 'BAD_TOKEN', 'listing needs a valid token');
  const listed = await b.listAdminAccounts({ token: boot.token });
  const names = listed.accounts.map(a => a.username).sort();
  ok(names.includes(bootstrapUsername) && names.includes(name('second')),
    'the list carries both the bootstrap account and the one just created');
  ok(listed.accounts.every(a => !a.disabled), 'both accounts list as enabled so far');

  // ---- self-protection ---------------------------------------------------
  await rejects(
    b.setAdminDisabled({ token: boot.token, username: bootstrapUsername, disabled: true }),
    'CANNOT_MODIFY_SELF', 'an admin cannot disable its own account',
  );
  await rejects(
    b.deleteAdminAccount({ token: boot.token, username: bootstrapUsername }),
    'CANNOT_MODIFY_SELF', 'an admin cannot delete its own account',
  );

  // ---- disable / re-enable -------------------------------------------------
  await b.setAdminDisabled({ token: boot.token, username: name('second'), disabled: true });
  const afterDisable = await b.listAdminAccounts({ token: boot.token });
  ok(afterDisable.accounts.find(a => a.username === name('second'))?.disabled === true,
    'the disabled account is reported disabled');
  await rejects(
    b.adminLogin({ username: name('second'), password: 'whatever123' }),
    'BAD_CREDENTIALS', 'a disabled account cannot log in even with the right password',
  );

  // Resetting a disabled account's password is still allowed — nothing rules
  // it out, and it is how a disabled account gets fixed before re-enabling it.
  await b.resetAdminPassword({ token: boot.token, username: name('second'), newPassword: 'reset-password-1' });
  await b.setAdminDisabled({ token: boot.token, username: name('second'), disabled: false });
  const resetLogin = await b.adminLogin({ username: name('second'), password: 'reset-password-1' });
  eq(resetLogin.username, name('second'), 're-enabled, the account logs in with its reset password');

  await rejects(
    b.resetAdminPassword({ token: boot.token, username: name('second'), newPassword: 'ab' }),
    'INVALID_REQUEST', 'a reset password under four characters is refused',
  );
  await rejects(
    b.resetAdminPassword({ token: boot.token, username: name('nobody-at-all'), newPassword: 'whatever123' }),
    'ACCOUNT_NOT_FOUND', 'resetting a password for an unknown username is refused',
  );
  await rejects(
    b.setAdminDisabled({ token: boot.token, username: name('nobody-at-all'), disabled: true }),
    'ACCOUNT_NOT_FOUND', 'disabling an unknown username is refused',
  );

  // ---- delete --------------------------------------------------------------
  await rejects(
    b.deleteAdminAccount({ token: boot.token, username: name('nobody-at-all') }),
    'ACCOUNT_NOT_FOUND', 'deleting an unknown username is refused',
  );
  await b.deleteAdminAccount({ token: boot.token, username: name('second') });
  const afterDelete = await b.listAdminAccounts({ token: boot.token });
  ok(!afterDelete.accounts.some(a => a.username === name('second')), 'the deleted account is gone from the list');

  // ---- logout ------------------------------------------------------------
  await b.adminLogout({ token: boot.token });
  const afterLogout = await b.currentAdmin({ token: boot.token });
  eq(afterLogout.username, null, 'a logged-out token resolves to no one');
  await rejects(
    b.listAdminAccounts({ token: boot.token }),
    'BAD_TOKEN', 'a logged-out token is refused by a protected endpoint, not silently honoured',
  );
}

// ---------------------------------------------------------------- the passes

async function runPass(
  label: string, make: typeof makeBackend, bootstrapUsername: string, bootstrapPassword: string,
): Promise<number> {
  makeBackend = make;
  failures.length = 0;
  checks = 0;
  await main(bootstrapUsername, bootstrapPassword);
  console.log(`  ${label.padEnd(24)} ${checks - failures.length}/${checks} assertions passed`);
  for (const f of failures) console.log(`    FAIL  ${f}`);
  return failures.length;
}

const DYNAMO_IMAGE = 'amazon/dynamodb-local:3.3.1';

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Same trick session-contract-check.ts uses: a real socket, turned into the
 *  API Gateway v2 event the Lambda receives, adding nothing the handler does
 *  not already own. */
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

/** A thin AdminBackend that POSTs to a base URL and maps the response the
 *  same way src/admin/client/adminAuth.ts does, but throwing AdminError
 *  instead of returning a Result — this is what exercises handler.ts's own
 *  routing/status/body shape, the thing adminAuth.ts is NOT tested here. */
function httpBackend(baseUrl: string): AdminBackend {
  async function call<Req extends object, Res>(endpoint: string, req: Req): Promise<Res> {
    const res = await fetch(`${baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    const text = await res.text();
    const body: unknown = text.length > 0 ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = (body as { error?: { code?: AdminErrorCode; message?: string; retryable?: boolean } } | null)?.error;
      throw new AdminError(err?.code ?? 'TRANSPORT_FAILURE', err?.message ?? `status ${res.status}`, err?.retryable ?? false);
    }
    return (body ?? {}) as Res;
  }
  return {
    adminLogin: req => call('adminLogin', req),
    adminLogout: req => call('adminLogout', req),
    currentAdmin: req => call('currentAdmin', req),
    createAdminAccount: req => call('createAdminAccount', req),
    listAdminAccounts: req => call('listAdminAccounts', req),
    setAdminDisabled: req => call('setAdminDisabled', req),
    deleteAdminAccount: req => call('deleteAdminAccount', req),
    resetAdminPassword: req => call('resetAdminPassword', req),
  };
}

async function dynamoPasses(): Promise<number> {
  const { CreateTableCommand, DynamoDBClient, ListTablesCommand, ScanCommand, UpdateTimeToLiveCommand } = await import('@aws-sdk/client-dynamodb');
  const { PutCommand, DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
  const { DynamoAdminBackend } = await import('../../src/admin/server/accounts');
  const { adminDynamoFromEnv, adminPk, hashPassword, normalizeUsername } = await import('../../src/admin/server/dynamo');
  const { handler } = await import('../../src/admin/server/handler');
  const name = `ripple-admin-contract-${process.pid}`;
  const table = 'ripple-admins-contract';
  let bad = 0;
  docker(['run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::8000', DYNAMO_IMAGE]);
  try {
    const port = docker(['port', name, '8000/tcp']).split('\n')[0].split(':').pop();
    const client = {
      endpoint: `http://127.0.0.1:${port}`,
      region: 'us-west-2',
      // ⚠ DUMMY CREDENTIALS, ON PURPOSE — same reasoning as session-contract-check.ts.
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    };
    const raw = new DynamoDBClient(client);
    for (let i = 0; ; i++) {
      try { await raw.send(new ListTablesCommand({})); break; } catch (e) {
        if (i > 60) throw e;
        await new Promise(r => setTimeout(r, 250));
      }
    }
    await raw.send(new CreateTableCommand({
      TableName: table,
      AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST',
    }));
    await raw.send(new UpdateTimeToLiveCommand({
      TableName: table,
      TimeToLiveSpecification: { Enabled: true, AttributeName: 'expiresAtSec' },
    }));

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
    // ⚠ REACH: see this file's header. The count of items in THIS table
    // before and after each pass is what cannot be faked from anywhere else.
    const reached = async (label: string, run: () => Promise<number>): Promise<number> => {
      const before = await countItems();
      const failed = await run();
      const wrote = (await countItems()) - before;
      console.log(`  ${''.padEnd(24)} reach: ${wrote} items written to DynamoDB Local by this pass`);
      if (wrote <= 0) {
        console.log(`    FAIL  ${label} wrote nothing to the table — it did not run against DynamoDB`);
        return failed + 1;
      }
      return failed;
    };

    // Each pass seeds its own bootstrap account directly — the same
    // hashPassword() seed-default-admin.ts will use for real — then logs in
    // through the pass's own backend for a real token.
    const doc = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
    const seedBootstrap = async (): Promise<{ username: string; password: string }> => {
      const username = `bootstrap-${randomSuffix()}`;
      const password = 'bootstrap-password-1';
      const { salt, hash } = hashPassword(password);
      await doc.send(new PutCommand({
        TableName: table,
        Item: {
          pk: adminPk(normalizeUsername(username)), username,
          passwordHash: hash, passwordSalt: salt, disabled: false, createdAt: Date.now(),
        },
      }));
      return { username, password };
    };

    const dynamo = adminDynamoFromEnv({ tableName: table, client });
    {
      const { username, password } = await seedBootstrap();
      bad += await reached('DynamoDB, in-process', () =>
        runPass('DynamoDB, in-process', () => new DynamoAdminBackend({ dynamo }), username, password));
    }

    const saved = { ...process.env };
    Object.assign(process.env, {
      ADMIN_TABLE_NAME: table,
      AWS_REGION: client.region,
      AWS_ENDPOINT_URL_DYNAMODB: client.endpoint,
      AWS_ACCESS_KEY_ID: client.credentials.accessKeyId,
      AWS_SECRET_ACCESS_KEY: client.credentials.secretAccessKey,
    });
    delete process.env.AWS_PROFILE;
    delete process.env.AWS_SESSION_TOKEN;
    try {
      const server = lambdaShim(handler);
      await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
      const addr = server.address();
      const shimPort = typeof addr === 'object' && addr ? addr.port : 0;
      const { username, password } = await seedBootstrap();
      bad += await reached('HTTP + Lambda handler', () =>
        runPass('HTTP + Lambda handler', () => httpBackend(`http://127.0.0.1:${shimPort}`), username, password));
      await new Promise<void>(r => { server.close(() => r()); });
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

async function all(): Promise<void> {
  console.log('admin-contract-check — the SAME assertions against DynamoDB Local and the Lambda handler\n');
  const bad = await dynamoPasses();
  console.log('');
  if (bad > 0) {
    console.log(`FAIL — ${bad} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('PASS — login, creation, listing, self-protection, disable/enable, delete, and logout,');
  console.log('       identically in-process and over HTTP through the Lambda handler.');
}

all().catch(e => {
  console.error('admin-contract-check threw:', e);
  process.exit(1);
});
