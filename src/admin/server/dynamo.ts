// ============================================================================
// THE ADMIN LAMBDA'S DYNAMODB PLUMBING — the client, the table name, password
// hashing, and the session token.
//
// ⚠ A FLAT TABLE, NOT ripple-sessions. Two item shapes, both found by a plain
// GetItem on `pk` alone — there is no family of child items under one
// partition the way a room has, so there is no sort key and nothing here
// imports from src/session/server/keys.ts. See ADMIN_ACCOUNTS_HANDOFF.md.
//
//   pk = ADMIN#<username, lowercased>    the account: username, passwordHash,
//                                        passwordSalt, disabled, createdAt.
//                                        No TTL — an account is not ephemeral.
//   pk = SESSION#<sha256(token)>         a login: username, expiresAtSec.
//                                        TTL on expiresAtSec — a login IS the
//                                        ephemeral thing TTL is for.
//
// ⚠ THE TABLE NAME COMES FROM THE ENVIRONMENT AND NOWHERE ELSE, same rule
// session/server/dynamo.ts enforces for ripple-sessions — a default is how a
// review Lambda ends up reading or writing the prod table.
// ============================================================================

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface AdminDynamoConfig {
  /** Overrides ADMIN_TABLE_NAME — the contract check points at a throwaway table. */
  tableName?: string;
  /** Passed straight to the SDK — the check sets `endpoint` to DynamoDB Local. */
  client?: DynamoDBClientConfig;
  /** How long a login lasts, in seconds, before TTL may remove it. */
  sessionTtlSec?: number;
}

/** A placeholder, not a decided figure — thirty days. */
export const DEFAULT_ADMIN_SESSION_TTL_SEC = 30 * 24 * 60 * 60;

export interface AdminDynamo {
  doc: DynamoDBDocumentClient;
  table: string;
  sessionTtlSec: number;
}

export function adminDynamoFromEnv(config: AdminDynamoConfig = {}): AdminDynamo {
  const table = config.tableName ?? process.env.ADMIN_TABLE_NAME;
  if (!table) {
    throw new Error('ADMIN_TABLE_NAME is not set. The admin handler never hard-codes its table.');
  }
  const fromEnv = Number(process.env.ADMIN_SESSION_TTL_SEC);
  const sessionTtlSec = config.sessionTtlSec
    ?? (Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_ADMIN_SESSION_TTL_SEC);
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient(config.client ?? {}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return { doc, table, sessionTtlSec };
}

// ---------------------------------------------------------------- keys

/** Trimmed, lower-cased — "Mike" and "mike" are the same admin. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function adminPk(usernameLower: string): string {
  return `ADMIN#${usernameLower}`;
}

export function sessionPk(tokenHash: string): string {
  return `SESSION#${tokenHash}`;
}

// ---------------------------------------------------------------- passwords

/**
 * scrypt, built into node:crypto — no new dependency for a table this small.
 * Salted per account; the salt and hash are both stored, hex-encoded.
 */
export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

/** Constant-time compare — a password check must not leak timing. */
export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ---------------------------------------------------------------- session tokens

// Lower-case letters and digits, 32 characters (~165 bits) — same shape as the
// room layer's newSessionToken (src/session/contract.ts), duplicated rather
// than imported: that module is reachable from the browser bundle and nothing
// admin-specific belongs pulled in alongside it.
const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newAdminToken(): string {
  const bytes = randomBytes(32);
  let out = '';
  for (let i = 0; i < 32; i++) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return out;
}

/** SHA-256 hex of a bearer token — the table never holds one in plaintext. */
export function hashAdminToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
