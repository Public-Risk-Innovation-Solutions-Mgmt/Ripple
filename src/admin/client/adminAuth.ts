// ============================================================================
// THE ADMIN API CLIENT — real HTTP calls now, against VITE_ADMIN_API.
//
// ⚠ MOVED FROM src/session/client/adminAuth.ts, SAME SEVEN FUNCTION
// SIGNATURES. This is the migration ADMIN_ACCOUNTS_HANDOFF.md promised: every
// screen that calls these (AdminLoginModal, AdminScreen, LobbyScreen,
// HostScreen) needed zero changes beyond its import path, because this file
// was already async everywhere and already returned exactly these shapes.
// Only what happens INSIDE each function changed — localStorage reads became
// fetch calls to src/admin/server/handler.ts.
//
// ⚠ THE TOKEN IS THE ONE REAL PIECE OF STATE THIS FILE NOW OWNS: a server-
// issued bearer token, kept in localStorage (not sessionStorage — logging in
// on one tab should still be logged in on another, the way a real login
// usually behaves). Lost or expired, `currentAdmin` finds out from the server
// and clears it; nothing here decides a token is good on its own.
// ============================================================================

import type { AdminAccountSummary } from '../contract';

export type { AdminAccountSummary };

type Result = { ok: true } | { ok: false; error: string };

const TOKEN_KEY = 'ripple.admin.token';

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function getToken(): string | null {
  return storage()?.getItem(TOKEN_KEY) ?? null;
}

function setToken(token: string): void {
  storage()?.setItem(TOKEN_KEY, token);
}

function clearToken(): void {
  storage()?.removeItem(TOKEN_KEY);
}

function adminApiBase(): string | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_ADMIN_API ?? null;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

/** POSTs to one endpoint; throws a plain Error with the server's message, or a transport one. */
async function call<Req extends object, Res>(endpoint: string, req: Req): Promise<Res> {
  const base = adminApiBase();
  if (!base) throw new Error('The admin service is not configured (VITE_ADMIN_API is unset).');

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/+$/, '')}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch (e) {
    throw new Error(`Could not reach the admin service: ${e instanceof Error ? e.message : String(e)}`);
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null; // an HTML error page from something in the middle
  }

  if (!res.ok) {
    const err = (body as ErrorBody | null)?.error;
    throw new Error(err?.message ?? `The admin service returned ${res.status}.`);
  }
  return (body ?? {}) as Res;
}

/** Same as `call`, but turns a thrown error into a Result instead of rejecting. */
async function attempt<Req extends object, Res>(endpoint: string, req: Req): Promise<{ ok: true; data: Res } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await call<Req, Res>(endpoint, req) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createAdminAccount(username: string, password: string): Promise<Result> {
  const token = getToken();
  if (!token) return { ok: false, error: 'Not logged in.' };
  const r = await attempt<{ token: string; username: string; password: string }, void>(
    'createAdminAccount', { token, username, password },
  );
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function adminLogin(username: string, password: string): Promise<Result> {
  const r = await attempt<{ username: string; password: string }, { token: string; username: string }>(
    'adminLogin', { username, password },
  );
  if (!r.ok) return { ok: false, error: r.error };
  setToken(r.data.token);
  return { ok: true };
}

export async function adminLogout(): Promise<void> {
  const token = getToken();
  // Best-effort — the token is cleared locally either way, which is what
  // actually logs this browser out. A failed revoke on the server just means
  // the token expires on its own later instead of being deleted now.
  if (token) await attempt('adminLogout', { token });
  clearToken();
}

/** The logged-in admin's username, or null if nobody is logged in on this browser. */
export async function currentAdmin(): Promise<string | null> {
  const token = getToken();
  if (!token) return null;
  const r = await attempt<{ token: string }, { username: string | null }>('currentAdmin', { token });
  if (!r.ok) return null;
  if (r.data.username === null) clearToken(); // the server no longer honours this token
  return r.data.username;
}

/** Every admin account, sorted by username. Passwords are never returned. */
export async function listAdminAccounts(): Promise<AdminAccountSummary[]> {
  const token = getToken();
  if (!token) return [];
  const r = await attempt<{ token: string }, { accounts: AdminAccountSummary[] }>('listAdminAccounts', { token });
  return r.ok ? r.data.accounts : [];
}

export async function setAdminDisabled(username: string, disabled: boolean): Promise<Result> {
  const token = getToken();
  if (!token) return { ok: false, error: 'Not logged in.' };
  const r = await attempt<{ token: string; username: string; disabled: boolean }, void>(
    'setAdminDisabled', { token, username, disabled },
  );
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function deleteAdminAccount(username: string): Promise<Result> {
  const token = getToken();
  if (!token) return { ok: false, error: 'Not logged in.' };
  const r = await attempt<{ token: string; username: string }, void>('deleteAdminAccount', { token, username });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function resetAdminPassword(username: string, newPassword: string): Promise<Result> {
  const token = getToken();
  if (!token) return { ok: false, error: 'Not logged in.' };
  const r = await attempt<{ token: string; username: string; newPassword: string }, void>(
    'resetAdminPassword', { token, username, newPassword },
  );
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
