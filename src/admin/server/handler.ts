// ============================================================================
// THE ADMIN LAMBDA ENTRY POINT — API Gateway HTTP API (payload v2) to the
// seven endpoints, and nothing else. Same shape as
// src/session/server/handler.ts, deliberately: it moves JSON and maps
// errors; every rule is in DynamoAdminBackend (accounts.ts).
//
// ⚠ NO CORS HEADERS, ON ANY RESPONSE — API Gateway owns CORS, same rule the
// session handler follows.
//
// Deployed as dist-lambda/admin-handler.zip, `index.js` at the root exporting
// `handler` — built by scripts/tools/build-admin-handler.ts
// (`npm run build:admin-handler`). The table comes from ADMIN_TABLE_NAME;
// the session TTL from ADMIN_SESSION_TTL_SEC (see dynamo.ts). Nothing else is
// configured. Deploys via .github/workflows/admin.yml.
// ============================================================================

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { isAdminError, type AdminBackend, type AdminErrorCode } from '../contract';
import { DynamoAdminBackend } from './accounts';

const STATUS: Record<AdminErrorCode, number> = {
  BAD_TOKEN: 403,
  BAD_CREDENTIALS: 403,
  USERNAME_TAKEN: 409,
  ACCOUNT_NOT_FOUND: 404,
  CANNOT_MODIFY_SELF: 409,
  INVALID_REQUEST: 400,
  TRANSPORT_FAILURE: 500,
};

type Endpoint =
  | 'adminLogin' | 'adminLogout' | 'currentAdmin' | 'createAdminAccount'
  | 'listAdminAccounts' | 'setAdminDisabled' | 'deleteAdminAccount' | 'resetAdminPassword';
const ENDPOINTS: readonly Endpoint[] = [
  'adminLogin', 'adminLogout', 'currentAdmin', 'createAdminAccount',
  'listAdminAccounts', 'setAdminDisabled', 'deleteAdminAccount', 'resetAdminPassword',
];

function json(status: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function fail(status: number, code: AdminErrorCode, message: string, retryable = false) {
  return json(status, { error: { code, message, retryable } });
}

/**
 * The dispatch, separated from the module-level backend so the contract
 * check can drive it against DynamoDB Local with a backend of its own.
 *
 * ⚠ ROUTED ON THE PATH'S LAST SEGMENT, same reasoning as the session handler:
 * a stage prefix or a mounted base path never changes where the endpoint
 * name itself sits.
 */
export function makeHandler(getBackend: () => AdminBackend) {
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

    // ⚠ THE HEADER WINS OVER THE BODY, same as the session handler — it is
    // what an authorizer in front of this would have validated.
    const auth = event.headers?.authorization ?? event.headers?.Authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      payload.token = auth.slice('Bearer '.length);
    }

    try {
      const backend = getBackend();
      const result = await (backend[endpoint] as (r: unknown) => Promise<unknown>).call(backend, payload);
      return json(200, result ?? {});
    } catch (e) {
      if (isAdminError(e)) return fail(STATUS[e.code], e.code, e.message, e.retryable);
      // Anything else is the handler's own fault or its environment's (no
      // ADMIN_TABLE_NAME, say): retryable, and logged, since nobody else will
      // see it.
      console.error('admin handler failed', e);
      return fail(500, 'TRANSPORT_FAILURE', e instanceof Error ? e.message : String(e), true);
    }
  };
}

// One backend per container, built on the first request rather than at load,
// so a missing ADMIN_TABLE_NAME is a 500 with a message and not an init crash.
let backend: AdminBackend | null = null;

export const handler = makeHandler(() => {
  if (!backend) backend = new DynamoAdminBackend();
  return backend;
});
