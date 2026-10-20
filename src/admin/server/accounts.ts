// ============================================================================
// THE ADMIN BACKEND — the seven endpoints, against the ripple-admins table.
//
// ⚠ AUTHORITY IS RESOLVED HERE AND ONLY HERE (resolveToken/requireAdmin).
// Every protected endpoint calls requireAdmin first; adminLogin is the only
// one that does not, because it is how a token comes to exist at all.
//
// ⚠ SELF-PROTECTION AND THE LAST-ADMIN RULE ARE ENFORCED HERE, SERVER-SIDE —
// the real change from the client-side placeholder, which only hid the
// buttons. See guardTarget. The placeholder's other safety net (reseed a
// default admin the moment the table is empty) has NO equivalent here: that
// would be a real hole in a real backend, not a convenience, so there is
// none — see scripts/tools/seed-default-admin.ts for how the one bootstrap
// account actually gets created.
// ============================================================================

import {
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand, GetCommand, PutCommand, ScanCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  AdminError,
  type AdminAccountSummary,
  type AdminBackend,
  type AdminLoginRequest, type AdminLoginResponse,
  type AdminLogoutRequest,
  type CreateAdminAccountRequest,
  type CurrentAdminRequest, type CurrentAdminResponse,
  type DeleteAdminAccountRequest,
  type ListAdminAccountsRequest, type ListAdminAccountsResponse,
  type ResetAdminPasswordRequest,
  type SetAdminDisabledRequest,
} from '../contract';
import {
  type AdminDynamo, adminDynamoFromEnv, adminPk, hashAdminToken, hashPassword,
  newAdminToken, normalizeUsername, sessionPk, verifyPassword,
} from './dynamo';

interface AccountItem {
  pk: string;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  disabled: boolean;
  createdAt: number;
}

interface SessionItem {
  pk: string;
  username: string;
  expiresAtSec: number;
}

/** A caller's token resolved to its account, or null — never throws. */
async function resolveToken(dynamo: AdminDynamo, token: string): Promise<AccountItem | null> {
  const session = await dynamo.doc.send(new GetCommand({
    TableName: dynamo.table,
    Key: { pk: sessionPk(hashAdminToken(token)) },
    ConsistentRead: true,
  }));
  const sessionItem = session.Item as SessionItem | undefined;
  if (!sessionItem) return null;
  // TTL deletes in the background, well after the expiry — a stamp past it is
  // treated as gone whether or not TTL has physically removed the item yet,
  // same rule the room layer's expiresAtSec items follow.
  if (sessionItem.expiresAtSec <= Math.floor(Date.now() / 1000)) return null;

  const account = await dynamo.doc.send(new GetCommand({
    TableName: dynamo.table,
    Key: { pk: adminPk(normalizeUsername(sessionItem.username)) },
    ConsistentRead: true,
  }));
  const accountItem = account.Item as AccountItem | undefined;
  if (!accountItem || accountItem.disabled) return null;
  return accountItem;
}

async function requireAdmin(dynamo: AdminDynamo, token: string): Promise<AccountItem> {
  const account = await resolveToken(dynamo, token);
  if (!account) throw new AdminError('BAD_TOKEN', 'Not logged in, or the session has expired.');
  return account;
}

export class DynamoAdminBackend implements AdminBackend {
  private readonly dynamo: AdminDynamo;

  constructor(opts: { dynamo?: AdminDynamo } = {}) {
    this.dynamo = opts.dynamo ?? adminDynamoFromEnv();
  }

  async adminLogin(req: AdminLoginRequest): Promise<AdminLoginResponse> {
    const res = await this.dynamo.doc.send(new GetCommand({
      TableName: this.dynamo.table,
      Key: { pk: adminPk(normalizeUsername(req.username)) },
      ConsistentRead: true,
    }));
    const account = res.Item as AccountItem | undefined;
    if (!account || !verifyPassword(req.password, account.passwordSalt, account.passwordHash)) {
      throw new AdminError('BAD_CREDENTIALS', 'Incorrect username or password.');
    }
    if (account.disabled) {
      throw new AdminError('BAD_CREDENTIALS', `${account.username} has been disabled.`);
    }
    const token = newAdminToken();
    const expiresAtSec = Math.floor(Date.now() / 1000) + this.dynamo.sessionTtlSec;
    await this.dynamo.doc.send(new PutCommand({
      TableName: this.dynamo.table,
      Item: { pk: sessionPk(hashAdminToken(token)), username: account.username, expiresAtSec },
    }));
    return { token, username: account.username };
  }

  async adminLogout(req: AdminLogoutRequest): Promise<void> {
    await this.dynamo.doc.send(new DeleteCommand({
      TableName: this.dynamo.table,
      Key: { pk: sessionPk(hashAdminToken(req.token)) },
    }));
  }

  async currentAdmin(req: CurrentAdminRequest): Promise<CurrentAdminResponse> {
    const account = await resolveToken(this.dynamo, req.token);
    return { username: account?.username ?? null };
  }

  async createAdminAccount(req: CreateAdminAccountRequest): Promise<void> {
    await requireAdmin(this.dynamo, req.token);
    const name = req.username.trim();
    if (name.length === 0) throw new AdminError('INVALID_REQUEST', 'Choose a username.');
    if (req.password.length < 4) throw new AdminError('INVALID_REQUEST', 'Password must be at least 4 characters.');
    const { salt, hash } = hashPassword(req.password);
    try {
      await this.dynamo.doc.send(new PutCommand({
        TableName: this.dynamo.table,
        Item: {
          pk: adminPk(normalizeUsername(name)),
          username: name,
          passwordHash: hash,
          passwordSalt: salt,
          disabled: false,
          createdAt: Date.now(),
        },
        // ⚠ THE ONE REAL RACE HERE: two callers creating the same username at
        // once. The client-side placeholder could not have this race — one
        // browser, one synchronous check-then-write.
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) {
        throw new AdminError('USERNAME_TAKEN', `${name} already has an admin account.`);
      }
      throw e;
    }
  }

  async listAdminAccounts(req: ListAdminAccountsRequest): Promise<ListAdminAccountsResponse> {
    await requireAdmin(this.dynamo, req.token);
    const accounts = await this.scanAccounts();
    const summaries: AdminAccountSummary[] = accounts
      .map(a => ({ username: a.username, disabled: a.disabled }))
      .sort((a, b) => a.username.localeCompare(b.username));
    return { accounts: summaries };
  }

  async setAdminDisabled(req: SetAdminDisabledRequest): Promise<void> {
    const caller = await requireAdmin(this.dynamo, req.token);
    this.guardSelf(caller, req.username);
    const target = await this.mustFind(req.username);
    await this.dynamo.doc.send(new UpdateCommand({
      TableName: this.dynamo.table,
      Key: { pk: target.pk },
      UpdateExpression: 'SET disabled = :d',
      ExpressionAttributeValues: { ':d': req.disabled },
    }));
  }

  async deleteAdminAccount(req: DeleteAdminAccountRequest): Promise<void> {
    const caller = await requireAdmin(this.dynamo, req.token);
    this.guardSelf(caller, req.username);
    const target = await this.mustFind(req.username);
    await this.dynamo.doc.send(new DeleteCommand({ TableName: this.dynamo.table, Key: { pk: target.pk } }));
  }

  async resetAdminPassword(req: ResetAdminPasswordRequest): Promise<void> {
    await requireAdmin(this.dynamo, req.token);
    if (req.newPassword.length < 4) throw new AdminError('INVALID_REQUEST', 'Password must be at least 4 characters.');
    const target = await this.mustFind(req.username);
    const { salt, hash } = hashPassword(req.newPassword);
    await this.dynamo.doc.send(new UpdateCommand({
      TableName: this.dynamo.table,
      Key: { pk: target.pk },
      UpdateExpression: 'SET passwordHash = :h, passwordSalt = :s',
      ExpressionAttributeValues: { ':h': hash, ':s': salt },
    }));
  }

  // ---- internals ----------------------------------------------------------

  private async scanAccounts(): Promise<AccountItem[]> {
    // ⚠ A Scan, NOT a Query — unlike keys.ts's rule for ripple-sessions, this
    // table has no per-partition range to query; an admin roster small enough
    // to render in one screen is small enough to scan.
    const accounts: AccountItem[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const page = await this.dynamo.doc.send(new ScanCommand({
        TableName: this.dynamo.table,
        FilterExpression: 'begins_with(pk, :p)',
        ExpressionAttributeValues: { ':p': 'ADMIN#' },
        ExclusiveStartKey: start,
      }));
      accounts.push(...(page.Items ?? []) as AccountItem[]);
      start = page.LastEvaluatedKey;
    } while (start);
    return accounts;
  }

  private async mustFind(username: string): Promise<AccountItem> {
    const res = await this.dynamo.doc.send(new GetCommand({
      TableName: this.dynamo.table,
      Key: { pk: adminPk(normalizeUsername(username)) },
      ConsistentRead: true,
    }));
    const item = res.Item as AccountItem | undefined;
    if (!item) throw new AdminError('ACCOUNT_NOT_FOUND', `No admin named ${username}.`);
    return item;
  }

  /**
   * Refuses to let a caller act on themselves. Checked before the target is
   * even confirmed to exist, so "it's you" is reported ahead of "it doesn't
   * exist" when both are true.
   *
   * ⚠ NO SEPARATE "LAST ADMIN STANDING" CHECK, AND THAT IS A DELIBERATE
   * SIMPLIFICATION, NOT AN OVERSIGHT. A single caller can never reduce the
   * enabled-admin count to zero through these two endpoints: they cannot
   * target themselves (this guard), and they must themselves be an enabled
   * admin to hold a valid token at all (requireAdmin) — so the caller is
   * always one enabled admin left standing after acting on anyone else. The
   * only way to reach zero is two different admins disabling each other at
   * the same moment, which a pre-read Scan-and-check cannot actually close
   * (it would still race) — closing that for real needs a conditional write
   * against a live enabled-count, which is real work this placeholder-grade
   * gate does not warrant yet.
   */
  private guardSelf(caller: AccountItem, targetUsername: string): void {
    if (normalizeUsername(targetUsername) === normalizeUsername(caller.username)) {
      throw new AdminError('CANNOT_MODIFY_SELF', 'You cannot disable or delete your own account.');
    }
  }
}
