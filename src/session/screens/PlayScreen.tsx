// ============================================================================
// /join/CODE AND /view/CODE — ONE SCREEN, TWO ROLES.
//
// ⚠ THEY ARE THE SAME SCREEN BECAUSE THEY ARE THE SAME DATA. A viewer builds the
// same game from the same room, plays the same years through the same engine and
// renders the same GameShell — eleven tabs, the decisions page, results,
// financials, audit, spreadsheet, membership. A second component rendering the
// same state read-only would be a second rendering path for one dataset, which
// is precisely the hazard the GameShell extraction existed to remove. The role
// is a parameter, not a fork.
//
// WHAT THE ROLE ACTUALLY CHANGES, AND IT IS ALL OF IT:
//
//   joining    a player NAMES its team and CHOOSES ITS COVERAGE LINES, and that
//              join is the moment the team comes into being. A viewer picks from
//              the teams that already exist, claims nothing, and any number may
//              watch the same one.
//   submitting a player's header button submits and locks. A viewer HAS NO
//              BUTTON — not a disabled one, because a disabled control still
//              invites the click and still implies the screen might write.
//   decisions  read-only for a viewer, always. The controls RENDER rather than
//              disappear: the table is discussing what the driver chose, so the
//              watcher needs to see the settings, not an empty panel.
//
// ⚠ WHAT A VIEWER SEES IN THE DECISION CONTROLS IS THE LAST SUBMITTED SET, NOT
// THE DRIVER'S LIVE EDITS, AND THAT IS A PROPERTY OF THE ROOM RATHER THAN OF
// THIS SCREEN. Decisions reach the room on submit; there is no per-keystroke
// write and deliberately so — a post per slider drag is the thing the save
// debounce exists to avoid. So while a driver is still deciding, its watchers
// see what that team locked LAST time, and the moment it locks, the next poll
// shows this year's real choices. Live mirroring would need a presence channel
// that does not exist and that nothing else wants.
//
// ⚠ A VIEWER'S NUMBERS ARE THE DRIVER'S NUMBERS BY CONSTRUCTION. Same seed, same
// LINES, same decisions, same engine, so the same results — not copied over the
// wire, and not trusted from it. The viewer never posts (see useSessionGame):
// the scoreboard belongs to the team that drives it.
//
// ⚠ COVERAGE LINES ARE CHOSEN ONCE AND THE SCREEN SAYS SO TWICE. Before the
// choice, the form states that it is permanent; after it, the status strip shows
// the set with no control to change it. Behind both, the transport refuses a
// rejoin asking for a different set — because a team's pre-game, its roster and
// its whole claim history are a function of the lines it opened with, so
// changing them mid-game would restart its book rather than adjust it.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, Copy, Eye, KeyRound, Loader2, Lock, Users } from 'lucide-react';
import { sessionTransport, isSessionError, type SessionError } from '../index';
import { newSessionToken, eventStatusOf, mayCreateTeam, teamLabel, type EventStatus } from '../contract';
import { clearActive, forgetTeamCredential, loadActive, loadHeld, rememberTeamCredential, saveActive } from '../client/identity';
import { useRoom } from '../client/useRoom';
import { navigate } from '../client/navigation';
import { decisionsForYear, decisionsToJson } from '../client/decisions';
import { useSessionGame } from '../client/useSessionGame';
import GameShell from '../../game/GameShell';
import type { TabId } from '../../components/TabNav';
import type { DecisionSet, LineView } from '../../types/simulation';
import { LINE_FULL_NAME } from '../../utils/lineDisplay';


export type PlayRole = 'player' | 'viewer';

interface Props {
  code: string;
  role: PlayRole;
}

// ============================================================================
// TEAM LEADER OR VIEWER — the choice the lobby hands off to.
//
// ⚠ THE GREYING IS A COURTESY, NOT THE RULE. The server refuses a new team once
// the event is IN_PROGRESS (EVENT_IN_PROGRESS, from the same contract function
// this reads), so a client that skips the lobby and posts straight to /join
// meets the same answer. This exists so a player is told WHY before they type a
// name, rather than after.
//
// ⚠ IT DOES NOT GOVERN A REJOIN. A browser already holding a team's credential
// sees the resume block above this and takes its seat at any status — which is
// why this renders beside that block rather than in place of it.
function RoleChoice({ code, role, status, currentYear }: {
  code: string; role: PlayRole; status: EventStatus; currentYear: number;
}) {
  const lateForTeams = !mayCreateTeam(status);
  return (
    <div data-testid="role-choice" className="mt-4 grid grid-cols-2 gap-3">
      <div
        data-testid={lateForTeams ? 'team-leader-unavailable' : 'team-leader'}
        className={`rounded-xl border p-4 ${
          lateForTeams ? 'border-slate-200 bg-slate-50'
          : role === 'player' ? 'border-blue-300 bg-white ring-1 ring-blue-100'
          : 'border-slate-200 bg-white'}`}
      >
        <div className="flex items-center gap-2">
          <span className={lateForTeams ? 'text-slate-600' : 'text-blue-600'}>
            {lateForTeams ? <Lock size={14} /> : <Users size={14} />}
          </span>
          <p className={`text-sm font-semibold ${lateForTeams ? 'text-slate-600' : 'text-slate-900'}`}>Team Leader</p>
          {lateForTeams && (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500">UNAVAILABLE</span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {lateForTeams
            ? status === 'FINISHED'
              ? 'This event has finished, so no new teams can join. You can still watch it.'
              : `This event is already in year ${currentYear}, so no new teams can join. You can still watch it.`
            : 'Name your team and make its decisions each year.'}
        </p>
        {!lateForTeams && role === 'viewer' && (
          <button
            type="button"
            data-testid="switch-to-player"
            onClick={() => navigate(`/join/${code}`)}
            className="mt-2 text-xs font-medium text-blue-700 underline"
          >
            Join as a team instead
          </button>
        )}
      </div>

      <div
        data-testid="viewer-option"
        className={`rounded-xl border p-4 ${
          role === 'viewer' ? 'border-blue-300 bg-white ring-1 ring-blue-100' : 'border-slate-200 bg-white'}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-blue-600"><Eye size={14} /></span>
          <p className="text-sm font-semibold text-slate-900">Viewer</p>
        </div>
        <p className="mt-1 text-xs text-slate-500">Follow a team without playing. Watching claims nothing.</p>
        {role === 'player' && (
          <button
            type="button"
            data-testid="switch-to-viewer"
            onClick={() => navigate(`/view/${code}`)}
            className="mt-2 text-xs font-medium text-blue-700 underline"
          >
            Watch instead
          </button>
        )}
      </div>
    </div>
  );
}

// ⚠ SHOWN EXACTLY ONCE, AND NOTHING HERE PERSISTS IT. This renders off plain
// component state (enter()'s success branch sets it, directly from the join
// response) — never written to identity.ts, never re-derived from anything
// stored. A reload loses it, same as the server never handing it back a
// second time; the only way back into this team from a new device after that
// is a reclaim with this code, which is the whole point of saving it now.
// ⚠ EXPORTED — ClaimScreen.tsx reuses this exact component for the recovery
// code a hand-off claim reissues (contract.ts's ReclaimTeamResponse). It
// takes nothing PlayScreen-specific, so sharing it beats a second copy.
export function RecoveryCodeModal({ code, onClose }: { code: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center gap-2">
          <span className="text-blue-600"><KeyRound size={18} /></span>
          <h2 className="text-lg font-bold text-slate-900">Save your recovery code</h2>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          If you lose this device, this code is the only way back into your team from another
          one. We won&rsquo;t show it again.
        </p>
        <div className="mt-4 flex items-center justify-center gap-3 rounded-lg border border-slate-300 bg-slate-50 py-4">
          <span data-testid="recovery-code" className="font-mono text-3xl tracking-widest text-slate-900">{code}</span>
          <button
            type="button"
            onClick={() => { void navigator.clipboard?.writeText(code).then(() => setCopied(true)); }}
            className="text-slate-600 hover:text-slate-700"
            aria-label="Copy recovery code"
          >
            <Copy size={16} />
          </button>
        </div>
        {copied && <p className="mt-1.5 text-center text-xs text-emerald-600">Copied.</p>}
        <button
          type="button"
          data-testid="recovery-code-saved"
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          I&rsquo;ve saved it
        </button>
      </div>
    </div>
  );
}

export default function PlayScreen({ code, role }: Props) {
  const isViewer = role === 'viewer';

  const active = loadActive(code);
  const [token, setToken] = useState<string | undefined>(
    active.role === role ? active.teamToken : undefined,
  );
  const heldCreds = loadHeld(code).teams.filter(c => c.role === role);

  const [claiming, setClaiming] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [actionError, setActionError] = useState<SessionError | null>(null);
  // Set only on a creating join's response — see enter() and RecoveryCodeModal.
  const [showRecoveryCode, setShowRecoveryCode] = useState<string | null>(null);

  // ---- reclaiming a team on this device, by recovery code -----------------
  const [showReclaim, setShowReclaim] = useState(false);
  const [reclaimName, setReclaimName] = useState('');
  const [reclaimCode, setReclaimCode] = useState('');
  const [reclaiming, setReclaiming] = useState(false);
  const [reclaimError, setReclaimError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [decisions, setDecisions] = useState<DecisionSet | null>(null);

  const [activeTab, setActiveTab] = useState<TabId>('decisions');
  const [lineView, setLineView] = useState<LineView>('pool');

  const { room, you, error, loading, refresh } = useRoom(code, token);
  const game = useSessionGame(code, room, you, token);

  // ⚠ SET HERE, NEVER INFERRED FROM error ALONE — error.code is BAD_TOKEN for
  // this AND for a stray/forged token that never belonged to anyone, and the
  // two need different words. This only fires when `token` was already set
  // (see the guard below): a credential THIS DEVICE believed was good, that
  // the server has since stopped honouring — which, for a token minted by a
  // join or a reclaim on this very device, means another device reclaimed the
  // team out from under it. See Mike's device-switching guide, Step 7.4.
  const [movedAway, setMovedAway] = useState(false);
  useEffect(() => {
    if (error?.code === 'BAD_TOKEN' && token) {
      clearActive(code);
      forgetTeamCredential(code, token);
      setToken(undefined);
      setMovedAway(true);
    }
  }, [error, token, code]);

  // Reseed on year change, from the last submitted set. For a player that is
  // carry-forward; for a viewer it is simply what the team it watches last
  // locked, which is the most recent thing there is to show.
  const seededYear = useRef<number | null>(null);
  // Per team NAME: the token this tab minted for its first join attempt, held
  // so a retry presents the same one. See JoinRequest.token.
  const joinTokenRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!room || you?.role !== role) return;
    if (seededYear.current === room.currentYear) return;
    seededYear.current = room.currentYear;
    // Seeding the editable set is the same question the replay asks: what was
    // this team playing in this year? For an unlocked year that is the most
    // recent lock before it — carry-forward, unchanged in meaning.
    // The room's shocks: a host-scheduled room fires its schedule, so its
    // switch is whether anything is scheduled (shockLosses.gameShocksOn).
    setDecisions(decisionsForYear(room.currentYear, you.decisionsByYear, room.shocks.length > 0));
  }, [room, you, role]);

  async function enter(teamName: string) {
    setClaiming(teamName);
    setActionError(null);
    setMovedAway(false);
    try {
      const held = heldCreds.find(c => c.teamName === teamName);
      // ⚠ A TOKEN ON THE FIRST JOIN TOO, NOT ONLY ON A REJOIN. Minted here and
      // held for this team name, so a retry after a lost response presents the
      // SAME token and lands on the rejoin path instead of TEAM_TAKEN — which
      // used to lock a player out of the team they had just created, in front
      // of a room.
      if (!joinTokenRef.current[teamName]) joinTokenRef.current[teamName] = newSessionToken();
      // ⚠ NO `lines` AT ALL ANY MORE, ON A FIRST JOIN OR A REJOIN. The HOST
      // picks the room's lines and every team plays them, so a join has nothing
      // to say about coverage. The note here used to explain why a rejoin
      // omitted them (LINES_LOCKED); that error no longer exists because the
      // field does not.
      const res = await sessionTransport().join({
        code, teamName, role,
        token: held?.teamToken ?? joinTokenRef.current[teamName],
      });
      saveActive(code, { teamToken: res.teamToken, teamName: res.teamName, role, pin: res.pin });
      rememberTeamCredential(code, { teamToken: res.teamToken, teamName: res.teamName, role, pin: res.pin });
      setToken(res.teamToken);
      seededYear.current = null;
      // ⚠ ONLY ON A CREATION. res.recoveryCode is present only on the response
      // that CREATES the team (contract.ts's JoinResponse.recoveryCode) — this
      // can never fire a second time for the same team, since the server never
      // hands the code back again on a rejoin.
      if (!res.rejoined && res.recoveryCode) setShowRecoveryCode(res.recoveryCode);
      refresh();
    } catch (e) {
      setActionError(isSessionError(e) ? e : null);
    } finally {
      setClaiming(null);
    }
  }

  // ⚠ NO RecoveryCodeModal HERE — a reclaim never reissues or re-returns a
  // recovery code (contract.ts's ReclaimTeamResponse), so there is nothing to
  // show once reclaimed.
  async function reclaim() {
    setReclaiming(true);
    setReclaimError(null);
    setMovedAway(false);
    try {
      const res = await sessionTransport().reclaimTeam({
        code, teamName: reclaimName.trim(), recoveryCode: reclaimCode.trim(), token: newSessionToken(),
      });
      saveActive(code, { teamToken: res.teamToken, teamName: res.teamName, role, pin: res.pin });
      rememberTeamCredential(code, { teamToken: res.teamToken, teamName: res.teamName, role, pin: res.pin });
      setToken(res.teamToken);
      seededYear.current = null;
      setShowReclaim(false);
      refresh();
    } catch (e) {
      setReclaimError(isSessionError(e) ? e.message : 'Could not reclaim that team.');
    } finally {
      setReclaiming(false);
    }
  }

  async function submit() {
    if (isViewer || !room || !decisions || !token) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await sessionTransport().submit({
        code, token, yearNumber: room.currentYear,
        decisions: decisionsToJson(decisions),
      });
      refresh();
    } catch (e) {
      setActionError(isSessionError(e) ? e : null);
    } finally {
      setSubmitting(false);
    }
  }

  // ⚠ PREEMPTS EVERY OTHER BRANCH BELOW, DELIBERATELY. By the time this state
  // is set, the join already succeeded — the next poll may already be moving
  // this screen toward the pre-game-building or GameShell branches below, and
  // this must still be read and dismissed before any of them show. Dismissing
  // just clears the state; the normal branch for whatever has loaded by then
  // renders right after.
  if (showRecoveryCode) {
    return <RecoveryCodeModal code={showRecoveryCode} onClose={() => setShowRecoveryCode(null)} />;
  }

  if (loading && !room) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-600">
        <Loader2 className="animate-spin" size={18} />
        <span className="ml-2 text-sm">Finding room {code}…</span>
      </div>
    );
  }

  if (error?.code === 'ROOM_NOT_FOUND' || !room) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-600">
          No room with code <span className="font-mono font-semibold">{code}</span>.
        </p>
      </div>
    );
  }

  // ---- not yet in: pick from the pre-registered roster --------------------
  if (you?.role !== role) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30 p-6">
        <div className="mx-auto w-full max-w-[480px] pt-10">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Room {code}</p>
          <h1 className="text-2xl font-semibold text-slate-800">{room.eventName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {/* ⚠ "and choose the lines you will write" WAS STILL HERE after the
                picker went. The host sets the room's lines; a player names its
                team and nothing else. */}
            {isViewer ? 'Choose a team to watch. Watching claims nothing.' : 'Name your team. The host has set the lines.'}
          </p>

          {/* ⚠ THE ROLE CHOICE, AND THE PATH STILL CARRIES THE ROLE. This file's
              router note argues that a single link with a role toggle makes the
              damaging mistake (claiming a team by accident, locking out the
              person meant to drive it) exactly as easy as the harmless one.
              That still holds and this does not undo it: /join and /view remain
              two links, the lobby sends a player to /join, and this block is a
              DELIBERATE, VISIBLE switch between them rather than a default
              anyone lands on. The damaging direction is also the one the server
              refuses once the event is under way. */}
          <RoleChoice code={code} role={role} status={eventStatusOf(room.currentYear, room.yearCount)} currentYear={room.currentYear} />

          {/* ⚠ SHOWN INSTEAD OF A GENERIC ERROR, NEVER ALONGSIDE ONE — this and
              actionError are set by disjoint paths (a background poll losing
              authority vs. an explicit join/reclaim attempt failing), but
              enter()/reclaim() clear this the moment a fresh attempt starts,
              so the two never stack. */}
          {movedAway && (
            <div data-testid="team-moved" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This team was moved to another device. Name it again, or reclaim it if it was yours.
            </div>
          )}

          {actionError && (
            <div data-testid="claim-error" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {actionError.message}
            </div>
          )}

          {heldCreds.length > 0 && !isViewer && (
            <div data-testid="resume-teams" className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-medium text-blue-800">This browser has driven a team in this room before.</p>
              <div className="mt-2 space-y-1.5">
                {heldCreds.map(c => (
                  <button
                    key={c.teamToken}
                    type="button"
                    data-testid={`resume-${c.teamName}`}
                    onClick={() => {
                      saveActive(code, { teamToken: c.teamToken, teamName: c.teamName, role, pin: c.pin });
                      setToken(c.teamToken);
                      seededYear.current = null;
                    }}
                    className="w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-left text-sm text-blue-800"
                  >
                    Resume as {c.teamName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ⚠ PLAYER ONLY — a viewer never holds a recovery code (it is
              minted only for the player that creates a team). The room code
              is already implicit in this URL, so only team name + recovery
              code are asked for here — contrast the Lobby's reclaim modal,
              which needs all three because it has no room in hand yet. */}
          {!isViewer && (
            <div className="mt-3">
              {!showReclaim ? (
                <button
                  type="button"
                  data-testid="show-reclaim"
                  onClick={() => { setShowReclaim(true); setReclaimError(null); }}
                  className="text-xs font-medium text-slate-500 underline hover:text-slate-700"
                >
                  Lost access to your team?
                </button>
              ) : (
                <div data-testid="reclaim-team" className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium text-slate-700">Reclaim a team with its recovery code</p>
                  <div className="mt-2 space-y-2">
                    <input
                      data-testid="reclaim-team-name"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Team name"
                      value={reclaimName}
                      onChange={e => setReclaimName(e.target.value)}
                    />
                    <input
                      data-testid="reclaim-code"
                      inputMode="numeric"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-widest"
                      placeholder="4-digit code"
                      value={reclaimCode}
                      onChange={e => setReclaimCode(e.target.value)}
                    />
                  </div>
                  {reclaimError && <p className="mt-2 text-xs text-red-600">{reclaimError}</p>}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={reclaiming}
                      onClick={() => setShowReclaim(false)}
                      className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      data-testid="submit-reclaim"
                      disabled={reclaiming || !reclaimName.trim() || !reclaimCode.trim()}
                      onClick={() => { void reclaim(); }}
                      className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-300"
                    >
                      {reclaiming ? 'Reclaiming…' : 'Reclaim'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {isViewer ? (
            // A viewer picks from the teams that EXIST. Before anyone has
            // joined there is nothing to watch, and saying so beats an empty box.
            <div data-testid="viewer-picker" className="mt-4 space-y-2">
              {room.teams.length === 0 && (
                <p data-testid="no-teams" className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">
                  No teams have joined yet.
                </p>
              )}
              {room.teams.map(t => (
                <button
                  key={t.name}
                  type="button"
                  data-testid={`watch-${t.name}`}
                  disabled={claiming !== null}
                  onClick={() => { void enter(t.name); }}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-4 py-3 text-left text-sm text-slate-700 hover:border-blue-400 hover:bg-blue-50"
                >
                  <span>
                    <span className="font-medium">{teamLabel(t)}</span>
                    <span className="ml-2 text-xs text-slate-600">{t.lines.join(' + ')}</span>
                  </span>
                  <span className="text-xs">{claiming === t.name ? 'Opening…' : 'watch'}</span>
                </button>
              ))}
            </div>
          ) : (
            <div data-testid="team-picker" className="mt-4 space-y-4">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Team name</span>
                <input
                  data-testid="team-name"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="e.g. Harbour Mutual"
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                />
              </label>

              {/* ⚠ SHOWN, NOT CHOSEN. This was a three-button picker and a
                  warning that the choice was permanent. The HOST sets the room's
                  lines now, so there is nothing to pick and nothing to warn
                  about — the team is told what it will play before it commits a
                  name, which is the part that was actually useful. */}
              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Coverage lines</span>
                <p className="mt-1 text-xs text-slate-600">
                  Set by the host for this game. Your pool's history and claims are built from these.
                </p>
                <div className="mt-2 flex flex-wrap gap-2" data-testid="room-lines">
                  {(room.lines ?? []).map(l => (
                    <span
                      key={l}
                      data-testid={`room-line-${l}`}
                      className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-700"
                    >
                      {LINE_FULL_NAME[l]}
                    </span>
                  ))}
                </div>
              </div>

              <button
                type="button"
                data-testid="join-team"
                disabled={nameDraft.trim().length === 0 || claiming !== null}
                onClick={() => { void enter(nameDraft.trim()); }}
                className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:bg-slate-300"
              >
                {claiming !== null ? 'Joining…' : 'Join as this team'}
              </button>

              {room.teams.length > 0 && (
                <p className="text-xs text-slate-600">
                  Already in: {room.teams.map(t => `${teamLabel(t)} (${t.lines.join('+')})`).join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- in, but the pre-game is still running ------------------------------
  if (!game.gameState || !decisions) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center text-slate-500">
        <Loader2 className="animate-spin" size={20} />
        <p className="mt-3 text-sm font-medium" data-testid="game-building">
          Building {you.teamName}'s opening position…
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Three pre-game years are simulated in this browser, from the room's seed.
        </p>
        {game.error && (
          <p data-testid="game-error" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {game.error}
          </p>
        )}
      </div>
    );
  }

  const myTeam = room.teams.find(t => t.name === you.teamName);
  const locked = myTeam?.locked ?? false;
  const complete = room.status === 'complete';
  const outstanding = room.teams.filter(t => t.joined && !t.locked).map(teamLabel);
  const processing = game.phase === 'processing';

  return (
    <GameShell
      gameState={game.gameState}
      startingFinancials={game.startingFinancials}
      initialMembers={game.initialMembers}
      currentDecisions={decisions}
      onDecisionsChange={isViewer ? () => {} : setDecisions}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      // The multiplayer version: hides the tabs in GameShell's MULTIPLAYER_HIDDEN_TABS.
      multiplayer
      // The team's share of the ROOM, its own figure only (CallerView).
      roomMarketShare={you.marketShare ?? null}
      lineView={lineView}
      onSelectLineView={setLineView}
      // A viewer passes no advance handler at all, so no button renders.
      onAdvanceYear={isViewer ? undefined : () => { void submit(); }}
      canAdvance={!locked && !submitting && !complete && !processing}
      advanceLabel={
        submitting ? 'Submitting…'
          : locked ? 'Waiting for host'
          : `Lock Program Year ${room.startingYear + room.currentYear - 1}`
      }
      // ⚠ DISABLED, NOT ABSENT. The controls still render the team's settings
      // because that is what the room is discussing.
      decisionsDisabled={isViewer || locked}
      statusStrip={
        <div data-testid="session-strip" className="border-b border-slate-200 bg-white px-4 py-2">
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            {isViewer && (
              <span className="flex items-center gap-1.5 font-medium text-slate-500">
                <Eye size={13} /> Watching
              </span>
            )}
            {/* The team's number beside its name, "Team 1 | Harbour Mutual" — the
                pairing every host screen shows (contract teamNumbers). The name
                keeps its own span, as drivers and viewers read it. */}
            <span className="font-medium text-slate-700">
              {myTeam && (
                <span data-testid={isViewer ? 'watched-team-number' : 'my-team-number'} className="text-slate-500">
                  Team {myTeam.teamNumber} |{' '}
                </span>
              )}
              <span data-testid={isViewer ? 'watched-team' : 'my-team'}>{you.teamName}</span>
            </span>
            {/* ⚠ SHOWN, WITH NO CONTROL BESIDE IT. After the join the lines are
                a fact about this team rather than a setting, so the strip states
                them and offers nothing to change. */}
            <span className="text-slate-500" data-testid="my-lines">
              {(you.lines ?? []).join(' + ')}
              <span className="ml-1 text-slate-600">(fixed)</span>
            </span>
            <span className="text-slate-600">room <span className="font-mono">{code}</span></span>
            {/* ⚠ PLAYER ONLY, SAME AS THE GUARD loadActive's role check already uses.
                A viewer never holds a PIN of its own — see JoinResponse.pin — so
                there is nothing here to show one. */}
            {!isViewer && active.role === role && active.pin && (
              <span className="flex items-center gap-1 text-slate-600" data-testid="team-pin">
                viewer PIN <span className="font-mono text-slate-700">{active.pin}</span>
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard?.writeText(active.pin ?? ''); }}
                  className="text-slate-600 hover:text-slate-600"
                  aria-label="Copy viewer PIN"
                >
                  <Copy size={12} />
                </button>
              </span>
            )}
            <span className="text-slate-500">
              Year <span data-testid="player-year" className="font-medium text-slate-700">{complete ? '—' : room.currentYear}</span>
              {' '}of {room.yearCount}
            </span>

            {complete ? (
              <span data-testid="player-complete" className="flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 size={13} /> Session complete
              </span>
            ) : processing ? (
              <span data-testid="game-processing" className="flex items-center gap-1.5 text-slate-500">
                <Loader2 size={13} className="animate-spin" />
                {game.progress ? `Restoring year ${game.progress.year} of ${game.progress.of}…` : `Running year ${game.gameState.currentYearNumber}…`}
              </span>
            ) : locked ? (
              <span data-testid={isViewer ? 'viewer-locked' : 'waiting'} className="flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 size={13} />
                {isViewer ? `Locked in for Program Year ${room.startingYear + room.currentYear - 1}` : 'Locked in — waiting for the host'}
              </span>
            ) : (
              <span data-testid={isViewer ? 'viewer-open' : undefined} className="flex items-center gap-1.5 text-slate-500">
                <Clock size={13} /> {isViewer ? `Still deciding Program Year ${room.startingYear + room.currentYear - 1}` : 'Open for decisions'}
              </span>
            )}

            {isViewer && (
              <span className="text-slate-600" data-testid="viewer-basis">
                decisions as last locked
              </span>
            )}

            {!complete && outstanding.length > 0 && (
              <span className="text-slate-600">
                still deciding: <span data-testid="outstanding">{outstanding.join(', ')}</span>
              </span>
            )}

            {game.processedYear !== null && (
              <span className="text-slate-600" data-testid="posted-year">
                year {game.processedYear} result {isViewer ? 'computed' : 'posted'}
              </span>
            )}

            {actionError && (
              <span data-testid="submit-error" className="text-red-600">{actionError.message}</span>
            )}
            {error && error.code !== 'BAD_TOKEN' && (
              <span data-testid="player-poll-error" className="text-red-600">
                refresh failed ({error.code})
              </span>
            )}
            {game.error && (
              <span data-testid="game-error" className="text-red-600">{game.error}</span>
            )}
          </div>
        </div>
      }
    />
  );
}
