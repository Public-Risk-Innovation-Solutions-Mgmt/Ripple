// ============================================================================
// THE LAMBDA'S DYNAMODB PLUMBING — the client, the table name, and the three
// mints the handler needs (token hash, teamId, room code).
//
// ⚠ NOTHING BROWSER-ONLY MAY REACH THIS DIRECTORY. These files compile under
// tsconfig.app.json with the rest of src/, so the compiler will not stop a
// `navigator.locks` or a `localStorage` here — the bundle would build and the
// Lambda would throw on its first call. node:crypto is the one platform import.
//
// ⚠ THE TABLE NAME COMES FROM THE ENVIRONMENT AND NOWHERE ELSE. keys.ts says it
// first; this is where it is enforced. A missing TABLE_NAME throws at the first
// call rather than defaulting, because a default is how a review Lambda ends up
// writing to the prod table.
// ============================================================================

import { createHash, randomBytes } from 'node:crypto';
import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface DynamoConfig {
  /** Overrides TABLE_NAME — the contract harness points at a throwaway table. */
  tableName?: string;
  /** Passed straight to the SDK — the harness sets `endpoint` to DynamoDB Local. */
  client?: DynamoDBClientConfig;
  /**
   * How long a room lives, in seconds, before TTL may remove it.
   *
   * ⚠ NOT A DECIDED NUMBER. keys.ts and docs/SESSION_DYNAMODB.md both say the
   * retention period is undecided; this reads ROOM_RETENTION_SEC and otherwise
   * uses DEFAULT_RETENTION_SEC, which is a placeholder long enough that no
   * session in progress can expire under it. Whoever decides the real figure
   * sets the variable; nothing here needs to change.
   */
  retentionSec?: number;
}

/** A placeholder, not a decision — see DynamoConfig.retentionSec. Seven days. */
export const DEFAULT_RETENTION_SEC = 7 * 24 * 60 * 60;

export interface Dynamo {
  doc: DynamoDBDocumentClient;
  table: string;
  retentionSec: number;
}

export function dynamoFromEnv(config: DynamoConfig = {}): Dynamo {
  const table = config.tableName ?? process.env.TABLE_NAME;
  if (!table) {
    throw new Error('TABLE_NAME is not set. The session handler never hard-codes its table.');
  }
  const fromEnv = Number(process.env.ROOM_RETENTION_SEC);
  const retentionSec = config.retentionSec
    ?? (Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_RETENTION_SEC);
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient(config.client ?? {}), {
    // Payloads are stored as JSON strings (see rooms.ts), so the only values the
    // marshaller sees are the header's own fields. Dropping undefined is for
    // optional roster fields; nothing opaque goes through it.
    marshallOptions: { removeUndefinedValues: true },
  });
  return { doc, table, retentionSec };
}

/**
 * SHA-256 hex of a bearer token. EVERY token this table holds goes through here
 * first — the host's on the header and in the CREATE# key, a player's in the
 * roster and its TOKEN# claim, a viewer's in its VIEW# key. No plaintext token is
 * ever written, which is the one thing the hosted table must not copy from
 * localTransport (where the record beside the token already holds it in clear).
 *
 * Unsalted on purpose: it is a lookup key and must be computable from the token
 * alone. The tokens are 32 characters from a 36-letter alphabet (~165 bits), so
 * there is nothing to dictionary-attack.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// Lower-case letters and digits: no '#', so it can never break a key (keys.ts
// checkTeamId), and long enough that two teams in one room will not collide.
const TEAM_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomFrom(alphabet: string, length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function newTeamId(): string {
  return randomFrom(TEAM_ID_ALPHABET, 12);
}

// ⚠ DUPLICATED FROM localTransport.ts, NOT IMPORTED. Importing would drag a
// browser-oriented module into the Lambda bundle for one constant. The harness
// asserts the shape (/^[A-Z2-9]{6}$/), so a drift between the two copies fails
// there rather than going unnoticed.
//
// No O/0/I/1 — a room code gets read aloud across a room and written on a
// whiteboard, and those are the four characters that come back wrong.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function newRoomCode(): string {
  return randomFrom(CODE_ALPHABET, ROOM_CODE_LENGTH);
}
