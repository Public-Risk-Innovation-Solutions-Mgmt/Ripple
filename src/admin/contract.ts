// ============================================================================
// THE ADMIN CONTRACT — seven endpoints, one interface, no implementation.
//
// ⚠ A SEPARATE CONTRACT FROM src/session/contract.ts, DELIBERATELY. Admin
// accounts are not game-session data — ADMIN_ACCOUNTS_HANDOFF.md (Option B)
// chose a separate table and a separate Lambda specifically so nobody who can
// touch one can touch the other. This file, and everything under
// src/admin/server/, never imports anything from src/session/.
//
// ⚠ THE PUBLIC CLIENT SHAPE PREDATES THIS CONTRACT AND DOES NOT MATCH IT
// 1:1. src/admin/client/adminAuth.ts's seven exported functions were fixed
// first, by the placeholder they replace (createAdminAccount/adminLogin/
// setAdminDisabled/deleteAdminAccount/resetAdminPassword return
// `{ok:true}|{ok:false,error}` rather than throwing; adminLogout returns
// void; currentAdmin returns a username or null). adminAuth.ts is the
// translator between that public shape and the wire shape below — an
// AdminError crossing the wire becomes a `{ok:false,error}` at the public
// call sites, never a thrown error the UI has to catch. Every screen that
// calls adminAuth.ts was written against the old placeholder and is
// unchanged by this file existing at all.
// ============================================================================

export type AdminErrorCode =
  // A protected endpoint's bearer token is missing, unknown, expired, or its
  // account has been disabled or deleted since the token was issued.
  | 'BAD_TOKEN'
  // adminLogin only: the username/password pair is wrong, or the account is
  // disabled. Deliberately not BAD_TOKEN — this is a login failure, not an
  // already-logged-in caller's token going bad.
  | 'BAD_CREDENTIALS'
  | 'USERNAME_TAKEN'
  | 'ACCOUNT_NOT_FOUND'
  | 'CANNOT_MODIFY_SELF'
  | 'INVALID_REQUEST'
  | 'TRANSPORT_FAILURE';

export class AdminError extends Error {
  readonly code: AdminErrorCode;
  readonly retryable: boolean;

  constructor(code: AdminErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'AdminError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function isAdminError(e: unknown): e is AdminError {
  return e instanceof AdminError;
}

// ---------------------------------------------------------------- requests

export interface AdminLoginRequest {
  username: string;
  password: string;
}
export interface AdminLoginResponse {
  token: string;
  username: string;
}

export interface AdminLogoutRequest {
  token: string;
}

export interface CurrentAdminRequest {
  token: string;
}
export interface CurrentAdminResponse {
  /** Null for a missing, expired, unknown, or disabled token — never an error. */
  username: string | null;
}

export interface CreateAdminAccountRequest {
  token: string;
  username: string;
  password: string;
}

export interface AdminAccountSummary {
  username: string;
  disabled: boolean;
}
export interface ListAdminAccountsRequest {
  token: string;
}
export interface ListAdminAccountsResponse {
  accounts: AdminAccountSummary[];
}

export interface SetAdminDisabledRequest {
  token: string;
  username: string;
  disabled: boolean;
}

export interface DeleteAdminAccountRequest {
  token: string;
  username: string;
}

export interface ResetAdminPasswordRequest {
  token: string;
  username: string;
  newPassword: string;
}

// ---------------------------------------------------------------- interface

/** The whole surface. Anything admin needs that is not here is a gap in this
 *  interface to close here, not a reach around it into DynamoDB directly. */
export interface AdminBackend {
  adminLogin(req: AdminLoginRequest): Promise<AdminLoginResponse>;
  adminLogout(req: AdminLogoutRequest): Promise<void>;
  currentAdmin(req: CurrentAdminRequest): Promise<CurrentAdminResponse>;
  createAdminAccount(req: CreateAdminAccountRequest): Promise<void>;
  listAdminAccounts(req: ListAdminAccountsRequest): Promise<ListAdminAccountsResponse>;
  setAdminDisabled(req: SetAdminDisabledRequest): Promise<void>;
  deleteAdminAccount(req: DeleteAdminAccountRequest): Promise<void>;
  resetAdminPassword(req: ResetAdminPasswordRequest): Promise<void>;
}
