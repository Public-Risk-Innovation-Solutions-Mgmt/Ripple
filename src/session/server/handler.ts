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
// ⚠ THE DECISIONS SECTION NEEDED NO CODE HERE, AND THAT IS THE FILE'S CLAIM
// HOLDING RATHER THAN THE CHANGE MISSING IT. TeamYearSummary gained a
// `decisions` block; submit stores `req.result` whole (rooms.ts writes
// JSON.stringify(req.result) into the R# item) and this file routes the payload
// without inspecting it. A new field inside an existing payload is therefore a
// contract-and-transport change, not a handler one. It is named here because
// "the handler was not touched" is a thing a reader should be able to confirm
// deliberately rather than infer from a silent file.
//
// ⚠ IT STILL SHIPS FIRST. The handler carries no new code but the DEPLOY ORDER
// is unchanged and still matters: the stored R# row gains a field, and a front
// end deployed ahead of the handler would read rows that do not carry it. See
// docs/AWS_HANDOFF.md — this lands with the lobby and host-picks-lines changes,
// handler first, then the front end.
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
  // ⚠ 409, NOT 403. A late team is not UNAUTHORISED — nothing is wrong with
  // who it is, and no credential would help. The room is in a state that
  // refuses the request, which is the same shape as WRONG_YEAR and TEAM_TAKEN
  // above and maps to the same code.
  EVENT_IN_PROGRESS: 409,
  // LINES_LOCKED is gone from the contract — a join carries no lines, so no
  // server can emit it. Nothing maps to 409 for it any more.
  TRANSPORT_FAILURE: 500,
};

// ⚠ TWO NEW ROUTES, AND THE DISPATCH BELOW NEEDED NOTHING ELSE. It calls
// transport[endpoint] generically, so a route is this list plus a method on the
// transport — which is the property that made adding the lobby a contract
// change rather than a handler change. Mike adds the routes in API Gateway; see
// docs/AWS_HANDOFF.md.
type Endpoint = 'createRoom' | 'join' | 'submit' | 'advance' | 'read' | 'listEvents' | 'setEventHidden';
const ENDPOINTS: readonly Endpoint[] = [
  'createRoom', 'join', 'submit', 'advance', 'read', 'listEvents', 'setEventHidden',
];

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
