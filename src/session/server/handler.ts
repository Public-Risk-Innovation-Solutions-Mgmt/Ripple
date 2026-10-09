// ============================================================================
// THE LAMBDA ENTRY POINT — API Gateway HTTP API (payload v2) to the five
// endpoints, and nothing else.
//
// ⚠ IT MOVES JSON AND MAPS ERRORS; IT DECIDES NOTHING. Every rule is in
// DynamoSessionTransport (rooms.ts), so the in-process pass and the over-HTTP
// pass of the contract harness test one implementation, not two. What this file
// adds — routing, the Authorization header, status codes, the error body — is
// exactly what the over-HTTP pass exists to prove.
//
// ⚠ NO CORS HEADERS, ON ANY RESPONSE. The AWS owner's guide is explicit that API
// Gateway owns CORS and the handler must not add any: a handler-set
// Access-Control-Allow-Origin duplicates the gateway's, and a browser refuses a
// response carrying two. The stub server answers `*` because nothing sits in
// front of it; this has a gateway. See httpTransport.ts item 1 for what the
// gateway does NOT cover (its own 429s and unknown routes) and why the client
// already survives that.
//
// ⚠ THE STATUS TABLE MATCHES THE STUB'S, and the body carries the exact code.
// HttpSessionTransport reads the body's code first and falls back to the status
// only for responses the server did not write (a gateway 502, an HTML page).
//
// Deployed as dist-lambda/handler.zip, `index.js` at the root exporting
// `handler` — built by scripts/tools/build-handler.ts (`npm run build:handler`).
// The table comes from TABLE_NAME; retention from ROOM_RETENTION_SEC (undecided,
// see dynamo.ts). Nothing else is configured.
//
// Deploys to review automatically on a merge to `aws`, and to prod on a v*
// tag, via .github/workflows/handler.yml — see that file for how.
// ============================================================================

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { isSessionError, type SessionErrorCode, type SessionTransport } from '../contract';
import { DynamoSessionTransport } from './rooms';

const STATUS: Record<SessionErrorCode, number> = {
  ROOM_NOT_FOUND: 404,
  TEAM_NOT_FOUND: 404,
  TEAM_TAKEN: 409,
  BAD_TOKEN: 403,
  NOT_HOST: 403,
  WRONG_YEAR: 409,
  GAME_COMPLETE: 409,
  INVALID_REQUEST: 400,
  LINES_LOCKED: 409,
  TRANSPORT_FAILURE: 500,
};

type Endpoint = 'createRoom' | 'join' | 'submit' | 'advance' | 'read';
const ENDPOINTS: readonly Endpoint[] = ['createRoom', 'join', 'submit', 'advance', 'read'];

function json(status: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function fail(status: number, code: SessionErrorCode, message: string, retryable = false) {
  return json(status, { error: { code, message, retryable } });
}

/**
 * The dispatch, separated from the module-level transport so the contract
 * harness can drive it against DynamoDB Local with a transport of its own.
 *
 * ⚠ ROUTED ON THE PATH'S LAST SEGMENT. An HTTP API's rawPath carries a stage
 * prefix when the stage is not $default (`/review/join`), and a deployment may
 * mount the endpoints under a base path; the endpoint name is always last.
 */
export function makeHandler(getTransport: () => SessionTransport) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const method = event.requestContext?.http?.method ?? 'POST';
    const segment = (event.rawPath ?? '').split('/').filter(Boolean).pop() ?? '';
    const endpoint = ENDPOINTS.find(e => e === segment);
    if (!endpoint || method !== 'POST') {
      return fail(404, 'INVALID_REQUEST', `No endpoint ${method} /${segment}.`);
    }

    let payload: Record<string, unknown>;
    try {
      const raw = event.isBase64Encoded && event.body
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body ?? '';
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      payload = parsed as Record<string, unknown>;
    } catch {
      return fail(400, 'INVALID_REQUEST', 'Body was not a JSON object.');
    }

    // ⚠ THE HEADER WINS OVER THE BODY, because the header is what an authorizer
    // in front of this would have validated. HTTP API lower-cases header names.
    const auth = event.headers?.authorization ?? event.headers?.Authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      payload.token = auth.slice('Bearer '.length);
    }

    try {
      const transport = getTransport();
      const result = await (transport[endpoint] as (r: unknown) => Promise<unknown>).call(transport, payload);
      return json(200, result);
    } catch (e) {
      if (isSessionError(e)) return fail(STATUS[e.code], e.code, e.message, e.retryable);
      // Anything else is the handler's own fault or its environment's (no
      // TABLE_NAME, say): retryable, and logged, since nobody else will see it.
      console.error('session handler failed', e);
      return fail(500, 'TRANSPORT_FAILURE', e instanceof Error ? e.message : String(e), true);
    }
  };
}

// One transport per container, built on the first request rather than at load,
// so a missing TABLE_NAME is a 500 with a message and not an init crash.
let transport: SessionTransport | null = null;

export const handler = makeHandler(() => {
  if (!transport) transport = new DynamoSessionTransport();
  return transport;
});
