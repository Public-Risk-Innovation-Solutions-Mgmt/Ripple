// ============================================================================
// SEED THE ONE BOOTSTRAP ADMIN ACCOUNT — a one-off, not part of the API.
//
//   ADMIN_TABLE_NAME=ripple-admins npx tsx scripts/tools/seed-default-admin.ts [username]
//
// ⚠ RUN ONCE, AGAINST A REAL TABLE, AFTER MIKE PROVISIONS IT. createAdminAccount
// always requires a caller who is already an admin — there is no unauthenticated
// way to create the first one, on purpose (see accounts.ts). This script is
// that one exception: it talks to DynamoDB directly, the same way the Lambda
// does, using the real AWS credentials in the environment (the usual SDK
// resolution — profile, env vars, instance role) rather than anything this
// script invents.
//
// ⚠ REFUSES TO OVERWRITE AN EXISTING ACCOUNT. The write is conditioned on
// attribute_not_exists(pk), same as createAdminAccount's own — running this
// twice against a table that already has the username does nothing instead
// of silently resetting its password.
//
// ⚠ THE PASSWORD IS SHOWN EXACTLY ONCE, HERE, AND NEVER AGAIN. It is not
// stored anywhere in plaintext — only its salted hash goes into the table —
// and this script does not log it to a file. Copy it now; after this the
// only way back in is resetAdminPassword, logged in as some other admin, or
// running this again for a different username.
// ============================================================================

import { randomBytes } from 'node:crypto';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { adminDynamoFromEnv, adminPk, hashPassword, normalizeUsername } from '../../src/admin/server/dynamo';

// No O/0/I/1 — read aloud or copied off a terminal, those are the characters
// that come back wrong. Same reasoning as the room layer's code alphabet.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function randomPassword(length = 20): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

async function main(): Promise<void> {
  const username = process.argv[2] ?? 'admin';
  const dynamo = adminDynamoFromEnv();
  const password = randomPassword();
  const { salt, hash } = hashPassword(password);

  try {
    await dynamo.doc.send(new PutCommand({
      TableName: dynamo.table,
      Item: {
        pk: adminPk(normalizeUsername(username)),
        username,
        passwordHash: hash,
        passwordSalt: salt,
        disabled: false,
        createdAt: Date.now(),
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) {
      console.error(`"${username}" already has an admin account on table ${dynamo.table} — refusing to overwrite it.`);
      process.exit(1);
    }
    throw e;
  }

  console.log(`Created admin "${username}" on table ${dynamo.table}.`);
  console.log('');
  console.log('Password (shown once — not stored in plaintext anywhere, not logged again):');
  console.log(`  ${password}`);
}

main().catch(e => {
  console.error('seed-default-admin failed:', e);
  process.exit(1);
});
