// ============================================================================
// THE ADMIN AREA — account management is the first real screen in it.
// Create, disable/enable, delete, and reset-password all go through
// admin/client/adminAuth.ts, now a real HTTP client against a real backend
// (see ADMIN_ACCOUNTS_HANDOFF.md / src/admin/server/accounts.ts) — admin
// still gates nothing but screens and options, but the accounts themselves
// are real now, not a per-browser localStorage placeholder.
//
// ⚠ YOU CANNOT DISABLE OR DELETE YOUR OWN ACCOUNT FROM THIS SCREEN. Your own
// row has no buttons for either — the UI hides the mistake, and the server
// refuses it too (accounts.ts's CANNOT_MODIFY_SELF), so this is no longer
// only a UI convenience. Resetting your own password is still allowed; that
// is not a lockout risk the way the other two are.
// ============================================================================

import { useEffect, useState } from 'react';
import { Shield, LogOut, Trash2, Ban, CheckCircle2, KeyRound, Home } from 'lucide-react';
import {
  adminLogout, currentAdmin, listAdminAccounts, createAdminAccount,
  setAdminDisabled, deleteAdminAccount, resetAdminPassword,
  type AdminAccountSummary,
} from '../../admin/client/adminAuth';
import { navigate } from '../client/navigation';

export default function AdminScreen() {
  // undefined = not checked yet; null = checked, nobody logged in.
  const [admin, setAdmin] = useState<string | null | undefined>(undefined);
  const [accounts, setAccounts] = useState<AdminAccountSummary[] | null>(null);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const [resetting, setResetting] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    currentAdmin().then(a => { if (live) setAdmin(a); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    // A direct link to /admin with no session returns to the lobby, rather
    // than rendering an area that has nothing to show.
    if (admin === null) navigate('/');
  }, [admin]);

  async function refresh() {
    setAccounts(await listAdminAccounts());
  }

  useEffect(() => {
    if (admin) void refresh();
  }, [admin]);

  async function handleCreate() {
    setCreateError(null);
    const result = await createAdminAccount(newUsername, newPassword);
    if (!result.ok) { setCreateError(result.error); return; }
    setNewUsername('');
    setNewPassword('');
    await refresh();
  }

  async function handleToggleDisabled(username: string, disabled: boolean) {
    await setAdminDisabled(username, disabled);
    await refresh();
  }

  async function handleDelete(username: string) {
    if (!window.confirm(`Delete admin "${username}"? This cannot be undone.`)) return;
    await deleteAdminAccount(username);
    await refresh();
  }

  async function handleResetPassword(username: string) {
    setResetError(null);
    const result = await resetAdminPassword(username, resetPassword);
    if (!result.ok) { setResetError(result.error); return; }
    setResetting(null);
    setResetPassword('');
  }

  if (admin === undefined || admin === null) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-white">
              <Shield size={16} />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900">Admin</span>
            <span className="text-slate-300">|</span>
            <span className="text-sm text-slate-500">Signed in as {admin}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* ⚠ HOME, NOT LOG OUT. This just navigates back to the lobby — the
                admin session stays signed in on this browser, unlike the
                button beside it. */}
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Home size={14} /> Main page
            </button>
            <button
              type="button"
              onClick={() => { void adminLogout().then(() => navigate('/')); }}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut size={14} /> Log out
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        {/* Create admin */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Create a new admin</h2>
          <p className="mt-1 text-sm text-slate-500">Give them a username and a temporary password; they can reset it themselves later from this same screen.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <input
              type="text"
              placeholder="Username"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              className="flex-1 min-w-[180px] rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
            <input
              type="text"
              placeholder="Temporary password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="flex-1 min-w-[180px] rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
            <button
              type="button"
              onClick={() => { void handleCreate(); }}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900"
            >
              Create
            </button>
          </div>
          {createError && <p className="mt-2 text-sm text-red-600">{createError}</p>}
        </div>

        {/* Admin list */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Admin accounts</h2>
          {accounts === null && <p className="mt-3 text-sm text-slate-600">Loading…</p>}
          {accounts !== null && (
            <div className="mt-4 space-y-3">
              {accounts.map(a => {
                const isSelf = a.username.toLowerCase() === admin.toLowerCase();
                return (
                  <div key={a.username} className="rounded-lg border border-slate-200 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <p className="text-sm font-semibold text-slate-900">
                          {a.username}{isSelf && <span className="ml-1.5 text-xs font-normal text-slate-600">(you)</span>}
                        </p>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                            a.disabled ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                          }`}
                        >
                          {a.disabled ? 'Disabled' : 'Active'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { setResetting(resetting === a.username ? null : a.username); setResetPassword(''); setResetError(null); }}
                          className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <KeyRound size={12} /> Reset password
                        </button>
                        {!isSelf && (
                          <>
                            <button
                              type="button"
                              onClick={() => { void handleToggleDisabled(a.username, !a.disabled); }}
                              className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              {a.disabled ? <CheckCircle2 size={12} /> : <Ban size={12} />}
                              {a.disabled ? 'Enable' : 'Disable'}
                            </button>
                            <button
                              type="button"
                              onClick={() => { void handleDelete(a.username); }}
                              className="flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {resetting === a.username && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                        <input
                          type="text"
                          placeholder="New password"
                          value={resetPassword}
                          onChange={e => setResetPassword(e.target.value)}
                          className="flex-1 min-w-[160px] rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                        />
                        <button
                          type="button"
                          onClick={() => { void handleResetPassword(a.username); }}
                          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
                        >
                          Set password
                        </button>
                        {resetError && <p className="w-full text-xs text-red-600">{resetError}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
