// ============================================================================
// THE LOBBY — what the main URL opens.
//
// ⚠ THE MARKUP IS THE APPROVED MOCKUP'S, not a second design. The mockup on
// wip/screenshots (docs/screenshots/lobby/) is what was signed off; this is the
// same structure and the same classes, reading a real listing instead of
// invented rows. Where the two differ, the mockup is the drawing and this is
// the thing — but they should not differ, and a deliberate change here belongs
// in the mockup too.
//
// ⚠ PLAY SOLO AND HOST AN EVENT ARE BOTH SHOWN, EACH BEHIND ONE SWITCH — AND
// BOTH NOW ALSO REQUIRE AN ADMIN SESSION. They landed hidden and were turned
// on by flipping the two constants below and nothing else; turning either
// back off is still the same one line. What changed is that even with a
// switch on, neither card renders for a visitor who is not logged in as
// admin — running a game (solo or hosted) is an admin action now, joining one
// someone else is running is not.
//
// Play Solo goes to /solo; Host an Event goes to /host, which is also still
// reachable directly as it was while the card was off.
// ============================================================================

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Eye, KeyRound, LogOut, Play, Plus, Shield, Trash2 } from 'lucide-react';
import { sessionTransport, isSessionError, type LobbyEvent, type SessionError } from '../index';
import { newSessionToken } from '../contract';
import { navigate } from '../client/navigation';
import { loadActive, loadHeld, rememberTeamCredential, saveActive } from '../client/identity';
import { adminLogout, currentAdmin } from '../../admin/client/adminAuth';
import AdminLoginModal from './AdminLoginModal';

// ⚠ VIEWER-ONLY, AND RESOLVED WITH NO ROOM CODE IN HAND — see contract.ts's
// JoinRequest.pin. This modal is why: it is the one place in the app a caller
// names a team before naming a room at all.
function WatchByPinModal({ onClose }: { onClose: () => void }) {
  const [pin, setPin] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setJoining(true);
    setError(null);
    try {
      const token = newSessionToken();
      const res = await sessionTransport().join({ pin, role: 'viewer', token } as never);
      saveActive(res.room.code, { teamToken: res.teamToken, teamName: res.teamName, role: 'viewer' });
      rememberTeamCredential(res.room.code, { teamToken: res.teamToken, teamName: res.teamName, role: 'viewer' });
      navigate(`/view/${res.room.code}`);
    } catch (e) {
      setError(isSessionError(e) ? e.message : 'Could not find a team with that PIN.');
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-900">Watch a team</h2>
        <p className="mt-2 text-sm text-slate-500">
          Enter the PIN a team leader gave you. You&rsquo;ll watch that team only — nothing you
          enter here can claim or change its decisions.
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={e => setPin(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && pin.trim() && !joining) void submit(); }}
          placeholder="6-digit PIN"
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-widest text-slate-900"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={joining}
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={joining || !pin.trim()}
            onClick={() => { void submit(); }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {joining ? 'Finding team…' : 'Watch'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ⚠ SCOPED DOWN, DELIBERATELY. An admin can delete (hide) an event only when
// THIS BROWSER holds that room's host token — the same token HostRoomScreen's
// own hide toggle already requires. There is no way yet for an admin to act
// on an event someone else hosted: setEventHidden's write is conditioned on
// that specific room's hostTokenHash, and the admin backend and the session
// backend share no credentials by design (ADMIN_ACCOUNTS_HANDOFF.md, Option
// B). Closing that gap for real needs the session Lambda to verify an admin
// token against the admin Lambda over the wire — a deliberate follow-up, not
// done here.
function hostTokenFor(code: string): string | null {
  return loadActive(code).hostToken ?? loadHeld(code).hostToken ?? null;
}

/** ⚠ ONE LINE EACH. See the header. Both are ON. */
const SHOW_PLAY_SOLO: boolean = true;
const SHOW_HOST_AN_EVENT: boolean = true;

function StatusBadge({ status }: { status: 'OPEN' | 'IN_PROGRESS' }) {
  const open = status === 'OPEN';
  return (
    <span
      data-testid={`status-${status}`}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        open ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
             : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
      }`}
    >
      {open ? <CheckCircle2 size={12} /> : <Clock size={12} />}
      {open ? 'OPEN' : 'IN PROGRESS'}
    </span>
  );
}

export default function LobbyScreen() {
  const [events, setEvents] = useState<LobbyEvent[] | null>(null);
  const [error, setError] = useState<SessionError | null>(null);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  // undefined = not checked yet; null = checked, nobody logged in as admin.
  const [admin, setAdmin] = useState<string | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<LobbyEvent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showWatchByPin, setShowWatchByPin] = useState(false);

  useEffect(() => {
    let live = true;
    currentAdmin().then(a => { if (live) setAdmin(a); });
    return () => { live = false; };
  }, []);

  // ⚠ FETCHED ONCE, NOT POLLED. A lobby is a page somebody reads and then acts
  // on; a poll here would be a request per viewer per interval for a list that
  // changes when a host creates or advances an event. The refresh is the
  // browser's own, which is also what a player does without being told.
  useEffect(() => {
    let live = true;
    sessionTransport().listEvents({})
      .then(res => { if (live) setEvents(res.events); })
      .catch((e: unknown) => {
        if (!live) return;
        if (isSessionError(e)) setError(e);
        else setError(null);
        setEvents([]);
      });
    return () => { live = false; };
  }, []);

  const open = (events ?? []).filter(e => e.status === 'OPEN');
  const running = (events ?? []).filter(e => e.status === 'IN_PROGRESS');
  const isAdmin = !!admin;

  async function confirmDelete() {
    if (!deleteTarget) return;
    const token = hostTokenFor(deleteTarget.code);
    if (!token) { setDeleteError('This browser no longer holds the host token for this event.'); return; }
    setDeleting(true);
    setDeleteError(null);
    try {
      await sessionTransport().setEventHidden({ code: deleteTarget.code, token, hidden: true });
      setEvents(prev => (prev ?? []).filter(e => e.code !== deleteTarget.code));
      setDeleteTarget(null);
    } catch (e) {
      setDeleteError(isSessionError(e) ? e.message : 'Could not delete this event.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">R</div>
            <span className="text-lg font-bold tracking-tight text-slate-900">RIPPLE</span>
            <span className="text-slate-300">|</span>
            <span className="text-sm text-slate-500">Public entity risk pool simulation</span>
          </div>
          {/* ⚠ LOGGED IN, THIS GOES TO /admin DIRECTLY — not the login modal
              again. Logged out, it still opens the modal; a separate Log out
              button only appears once there is a session to end. */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              data-testid="admin-login"
              onClick={() => { if (isAdmin) navigate('/admin'); else setShowAdminLogin(true); }}
              className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-600"
            >
              <Shield size={14} /> Admin
            </button>
            {isAdmin && (
              <button
                type="button"
                data-testid="admin-logout"
                onClick={() => { void adminLogout().then(() => setAdmin(null)); }}
                className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-600"
              >
                <LogOut size={14} /> Log out
              </button>
            )}
          </div>
        </div>
      </div>

      {showAdminLogin && (
        <AdminLoginModal
          onClose={() => setShowAdminLogin(false)}
          onSuccess={() => { setShowAdminLogin(false); navigate('/admin'); }}
        />
      )}

      {showWatchByPin && <WatchByPinModal onClose={() => setShowWatchByPin(false)} />}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">Delete &ldquo;{deleteTarget.eventName}&rdquo;?</h2>
            <p className="mt-2 text-sm text-slate-500">
              This removes it from the lobby list. It does not stop the game, and direct links
              (join/view/host) keep working.
            </p>
            {deleteError && <p className="mt-2 text-sm text-red-600">{deleteError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => { void confirmDelete(); }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-screen-2xl px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Welcome</h1>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-500">Join an event your organisation is running.</p>
          <button
            type="button"
            data-testid="watch-by-pin"
            onClick={() => setShowWatchByPin(true)}
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
          >
            <KeyRound size={14} /> Have a PIN? Watch a team
          </button>
        </div>

        {isAdmin && (SHOW_PLAY_SOLO || SHOW_HOST_AN_EVENT) && (
          <div className="mt-6 grid grid-cols-2 gap-4">
            {SHOW_PLAY_SOLO && (
              <button
                data-testid="play-solo"
                onClick={() => navigate('/solo')}
                className="rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm hover:border-blue-400"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Play size={18} /></div>
                <p className="mt-3 text-base font-semibold text-slate-900">Play Solo</p>
                <p className="mt-1 text-sm text-slate-500">Run your own pool at your own pace. Nobody else joins, and you advance the years yourself.</p>
              </button>
            )}
            {SHOW_HOST_AN_EVENT && (
              <button
                data-testid="host-an-event"
                onClick={() => navigate('/host')}
                className="rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm hover:border-blue-400"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Plus size={18} /></div>
                <p className="mt-3 text-base font-semibold text-slate-900">Host an Event</p>
                <p className="mt-1 text-sm text-slate-500">Set up a session for a group. You choose the lines and the schedule, and advance the table together.</p>
              </button>
            )}
          </div>
        )}

        {error && (
          <div data-testid="lobby-error" className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error.message}
          </div>
        )}

        {events === null && (
          <p data-testid="lobby-loading" className="mt-8 text-sm text-slate-600">Loading events…</p>
        )}

        {events !== null && (
          <>
            <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Open events</h2>
            <p className="mt-1 text-xs text-slate-600">Anyone can join these as a team leader or as a viewer.</p>
            <div data-testid="open-events" className="mt-3 space-y-3">
              {open.length === 0 && (
                <p data-testid="no-open-events" className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-center text-sm text-slate-600">
                  No events are open right now.
                </p>
              )}
              {open.map(e => (
                <div
                  key={e.code}
                  data-testid={`event-${e.code}`}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm hover:border-blue-400"
                >
                  <div>
                    <div className="flex items-center gap-2.5">
                      <p className="text-base font-semibold text-slate-900">{e.eventName}</p>
                      <StatusBadge status="OPEN" />
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {e.teams} {e.teams === 1 ? 'team' : 'teams'} so far · waiting to start
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-slate-600">{e.code}</span>
                    {/* ⚠ AN ADMIN RUNS THE EVENT, NOT JOINS IT. Everyone else gets
                        Join; an admin gets Host, straight to that event's host
                        screen (HostScreen's own admin gate is already satisfied,
                        so this never bounces through a second login). */}
                    {isAdmin ? (
                      <>
                        <button
                          data-testid={`host-link-${e.code}`}
                          onClick={() => navigate(`/host/${e.code}`)}
                          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white"
                        >
                          Host
                        </button>
                        {/* ⚠ ONLY WHEN THIS BROWSER HOLDS THE HOST TOKEN — see
                            hostTokenFor's header. Not shown otherwise, rather
                            than shown and failing with NOT_HOST. */}
                        {hostTokenFor(e.code) && (
                          <button
                            data-testid={`delete-${e.code}`}
                            onClick={() => { setDeleteError(null); setDeleteTarget(e); }}
                            className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                          >
                            <Trash2 size={14} /> Delete
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        data-testid={`join-${e.code}`}
                        onClick={() => navigate(`/join/${e.code}`)}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white"
                      >
                        Join
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* ⚠ RENDERED ONLY WHEN THERE IS ONE. An empty "Already under way"
                heading would advertise a section the lobby usually has nothing
                in — unlike Open events, which is the page's subject and says so
                when it is empty. */}
            {running.length > 0 && (
              <>
                <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Already under way</h2>
                <div data-testid="running-events" className="mt-3 space-y-3">
                  {running.map(e => (
                    <div
                      key={e.code}
                      data-testid={`event-${e.code}`}
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-5 py-4"
                    >
                      <div>
                        <div className="flex items-center gap-2.5">
                          <p className="text-base font-semibold text-slate-700">{e.eventName}</p>
                          <StatusBadge status="IN_PROGRESS" />
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">VIEWERS ONLY</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                          Year {e.currentYear} of {e.yearCount} · {e.teams} {e.teams === 1 ? 'team' : 'teams'} · no new teams can join
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-slate-600">{e.code}</span>
                        {/* ⚠ AN ADMIN STILL RUNS A STARTED EVENT, SAME AS AN
                            OPEN ONE. Advancing the year, checking the Teams/
                            Charts/Decisions tabs, or deleting it don't stop
                            once the event is under way — Host still goes
                            straight to this event's host screen. */}
                        {isAdmin ? (
                          <button
                            data-testid={`host-link-${e.code}`}
                            onClick={() => navigate(`/host/${e.code}`)}
                            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white"
                          >
                            Host
                          </button>
                        ) : (
                          <button
                            data-testid={`watch-${e.code}`}
                            onClick={() => navigate(`/view/${e.code}`)}
                            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                          >
                            <span className="inline-flex items-center gap-1.5"><Eye size={13} /> Watch</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
