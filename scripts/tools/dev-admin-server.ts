// ============================================================================
// A LOCAL ADMIN BACKEND FOR `npm run dev` — NOT A DEPLOYMENT, NOT THE STUB
// PATTERN EITHER.
//
// ⚠ WHY THIS RUNS DynamoAdminBackend AGAINST DYNAMODB LOCAL RATHER THAN A
// HAND-WRITTEN IN-MEMORY STUB, UNLIKE session-stub-server.ts. That stub can
// borrow its rules from LocalSessionTransport, an existing in-memory
// implementation of the same contract. There is no in-memory admin
// implementation to borrow from — only DynamoAdminBackend, which is
// DynamoDB-specific. Hand-writing a second, in-memory copy of the rules
// (self-protection, username uniqueness, password hashing) would be exactly
// the "second opinion" risk this codebase avoids elsewhere, so this runs the
// real backend against a real (local, throwaway) DynamoDB instead.
//
// ⚠ NEEDS DOCKER, NOT AWS CREDENTIALS. Starts one amazon/dynamodb-local
// container, creates a throwaway table, seeds one bootstrap admin account,
// and serves admin/server/handler.ts's own `handler` over a real socket —
// same lambdaShim trick admin-contract-check.ts uses. Ctrl+C stops the
// container along with the server.
//
// Run: npx tsx scripts/tools/dev-admin-server.ts [--port 8787]
// Then set VITE_ADMIN_API=http://localhost:8787 (see .env.local) and
// npm run dev — restart it if it was already running, so Vite picks up the
// new env var.
// ============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const DYNAMO_IMAGE = 'amazon/dynamodb-local:3.3.1';
const CONTAINER_NAME = `ripple-admin-dev-${process.pid}`;
const TABLE = 'ripple-admins-dev';

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function randomPassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function main(): Promise<void> {
  const portArg = process.argv.indexOf('--port');
  const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : 8787;

  console.log('Starting DynamoDB Local…');
  docker(['run', '-d', '--rm', '--name', CONTAINER_NAME, '-p', '127.0.0.1::8000', DYNAMO_IMAGE]);

  const cleanup = () => {
    try { docker(['rm', '-f', CONTAINER_NAME]); } catch { /* already gone */ }
  };
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  try {
    const { CreateTableCommand, DynamoDBClient, ListTablesCommand, UpdateTimeToLiveCommand } = await import('@aws-sdk/client-dynamodb');
    const dynamoPort = docker(['port', CONTAINER_NAME, '8000/tcp']).split('\n')[0].split(':').pop();
    const client = {
      endpoint: `http://127.0.0.1:${dynamoPort}`,
      region: 'us-west-2',
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' }, // dummy, on purpose
    };
    const raw = new DynamoDBClient(client);
    for (let i = 0; ; i++) {
      try { await raw.send(new ListTablesCommand({})); break; } catch (e) {
        if (i > 60) throw e;
        await new Promise(r => setTimeout(r, 250));
      }
    }
    await raw.send(new CreateTableCommand({
      TableName: TABLE,
      AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST',
    }));
    await raw.send(new UpdateTimeToLiveCommand({
      TableName: TABLE,
      TimeToLiveSpecification: { Enabled: true, AttributeName: 'expiresAtSec' },
    }));

    process.env.ADMIN_TABLE_NAME = TABLE;
    process.env.AWS_REGION = client.region;
    process.env.AWS_ENDPOINT_URL_DYNAMODB = client.endpoint;
    process.env.AWS_ACCESS_KEY_ID = client.credentials.accessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = client.credentials.secretAccessKey;
    delete process.env.AWS_PROFILE;
    delete process.env.AWS_SESSION_TOKEN;

    // Seed one bootstrap admin, same way seed-default-admin.ts does for real.
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const { adminDynamoFromEnv, adminPk, hashPassword, normalizeUsername } = await import('../../src/admin/server/dynamo');
    const dynamo = adminDynamoFromEnv();
    const username = 'admin';
    const password = randomPassword();
    const { salt, hash } = hashPassword(password);
    await dynamo.doc.send(new PutCommand({
      TableName: dynamo.table,
      Item: { pk: adminPk(normalizeUsername(username)), username, passwordHash: hash, passwordSalt: salt, disabled: false, createdAt: Date.now() },
    }));

    const { handler } = await import('../../src/admin/server/handler');
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c as Buffer));
      req.on('end', () => {
        void (async () => {
          // ⚠ CORS, HANDLED HERE — NOT BY THE HANDLER. The real Lambda never
          // sets these (API Gateway does); this local stand-in has no
          // gateway in front of it, so without this the browser's preflight
          // for a JSON POST with an Authorization header fails before the
          // real request is even sent — "Failed to fetch", same reasoning
          // session-stub-server.ts gives for doing the same thing.
          const cors = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
          };
          if (req.method === 'OPTIONS') {
            res.writeHead(204, cors);
            res.end();
            return;
          }

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
          res.writeHead(out.statusCode ?? 200, { ...(out.headers ?? {}), ...cors } as Record<string, string>);
          res.end(out.body ?? '');
        })();
      });
    });
    server.listen(port, () => {
      console.log('');
      console.log(`admin dev server listening on http://localhost:${port} — throwaway, DynamoDB Local, not a deployment`);
      console.log('');
      console.log(`Bootstrap admin:  ${username} / ${password}`);
      console.log('');
      console.log('Set VITE_ADMIN_API=' + `http://localhost:${port}` + ' (see .env.local) and run npm run dev.');
      console.log('Ctrl+C here stops this server and the DynamoDB Local container.');
    });
  } catch (e) {
    cleanup();
    throw e;
  }
}

main().catch(e => {
  console.error('dev-admin-server failed:', e);
  process.exit(1);
});
