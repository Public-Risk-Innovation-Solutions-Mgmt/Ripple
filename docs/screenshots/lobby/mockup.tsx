// ============================================================================
// LOBBY MOCKUP — THE REAL SCREENS, WITH THE NEW PARTS AROUND THEM.
//
// ⚠ NOTHING HERE IS REACHABLE FROM THE GAME. This file lives under docs/, not
// src/, is in no route, and is imported by nothing the app builds. It exists to
// be screenshotted. The lobby does not exist yet; everything else on these
// screens does.
//
// ============================================================================
// ⚠ THE RULE: WHERE A SCREEN ALREADY EXISTS, RENDER THE REAL COMPONENT.
//
// The first version of this mockup REDREW the host setup from copied classes,
// and in doing so quietly changed its prior-development section. Nothing here
// redraws an existing screen. `HostScreen` and `PlayScreen` are imported from
// src/ and rendered as the app renders them, against a REAL room created
// through the REAL local transport — the same transport the app uses in the
// browser and the same one the session drivers drive. If the app's host setup
// changes, these screenshots change with it, which is the property the copied
// version did not have.
//
// WHAT IS ADDED, AND IT IS ONLY EVER ADDED — never inserted into a real
// screen's markup, never restyled around it:
//
//   01  the lobby. Wholly new; there is no lobby today, so there is nothing to
//       reuse and this is the one screen drawn from scratch.
//   02  the role choice, rendered ABOVE the real join screen.
//   03  the same, with Team Leader unavailable.
//   04  the required "Event name" field, rendered ABOVE the real host setup.
//   05  the "Hide from lobby" control and the status, rendered BELOW the real
//       host room screen.
//
// ⚠ 04 SHOWS TWO EVENT FIELDS AND THAT IS DELIBERATE. The real host setup
// already carries an OPTIONAL "Event" input, lower down, sharing a two-column
// grid with the seed. The brief's addition is a REQUIRED "Event name" at the
// top. Moving or re-labelling the existing one would be rearranging a screen
// this mockup is supposed to leave alone, so both are shown: the new field
// above, the real screen untouched beneath it. Whoever builds this decides
// whether the old field then goes — the mockup does not decide it for them.
//
// ⚠ THE ROOM IS REAL AND SO ARE ITS NUMBERS. createRoom, join and advance are
// the actual transport calls, so the room code, the teams, the year and the
// lines on screens 02, 03 and 05 are a real session's, not captions. Only the
// LOBBY's event list (01) is invented, because no lobby exists to read from.
// ============================================================================

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Play, Plus, Users, Eye, EyeOff, Lock, Clock, CheckCircle2 } from 'lucide-react';

import HostScreen from '../../../src/session/screens/HostScreen';
import PlayScreen from '../../../src/session/screens/PlayScreen';
import { sessionTransport } from '../../../src/session';
import { newSessionToken, DEFAULT_PRIOR_DEVELOPMENT } from '../../../src/session/contract';
import { rememberHostToken, saveActive } from '../../../src/session/client/identity';
import './mockup.css';

// ---------------------------------------------------------------- sample data
// INVENTED, and only for the lobby list — see the header.
const OPEN_EVENTS = [
  { code: 'PRSM24', name: 'PRISM Spring Workshop', teams: 6 },
  { code: 'CNTY11', name: 'County Risk Managers Roundtable', teams: 3 },
  { code: 'SCHL07', name: 'Schools Pool Onboarding', teams: 9 },
];
const IN_PROGRESS_EVENT = { code: 'FINC03', name: 'Finance Committee Session', teams: 4, year: 3, years: 5 };

const TEAM_NAMES = [
  'Harbour Mutual', 'Cedar Valley JPA', 'Northgate Risk Pool',
  'Tri-County Authority', 'Lakeshore Schools Trust', 'Summit Public Entities',
];

// ---------------------------------------------------------------- the lobby
function StatusBadge({ status }: { status: 'OPEN' | 'IN PROGRESS' }) {
  const open = status === 'OPEN';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
      open ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
           : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'}`}
    >
      {open ? <CheckCircle2 size={12} /> : <Clock size={12} />}{status}
    </span>
  );
}

function Lobby() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">R</div>
          <span className="text-lg font-bold tracking-tight text-slate-900">RIPPLE</span>
          <span className="text-slate-300">|</span>
          <span className="text-sm text-slate-500">Public entity risk pool simulation</span>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-2xl font-bold text-slate-900">Welcome</h1>
        <p className="mt-1 text-sm text-slate-500">Play on your own, or join an event your organisation is running.</p>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <button className="rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm hover:border-blue-400">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Play size={18} /></div>
            <p className="mt-3 text-base font-semibold text-slate-900">Play Solo</p>
            <p className="mt-1 text-sm text-slate-500">Run your own pool at your own pace. Nobody else joins, and you advance the years yourself.</p>
          </button>
          <button className="rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm hover:border-blue-400">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Plus size={18} /></div>
            <p className="mt-3 text-base font-semibold text-slate-900">Host an Event</p>
            <p className="mt-1 text-sm text-slate-500">Set up a session for a group. You choose the lines and the schedule, and advance the table together.</p>
          </button>
        </div>

        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Open events</h2>
        <p className="mt-1 text-xs text-slate-400">Anyone can join these as a team leader or as a viewer.</p>
        <div className="mt-3 space-y-3">
          {OPEN_EVENTS.map(e => (
            <div key={e.code} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm hover:border-blue-400">
              <div>
                <div className="flex items-center gap-2.5">
                  <p className="text-base font-semibold text-slate-900">{e.name}</p>
                  <StatusBadge status="OPEN" />
                </div>
                <p className="mt-1 text-sm text-slate-500">{e.teams} teams so far · waiting to start</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-slate-400">{e.code}</span>
                <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">Join</button>
              </div>
            </div>
          ))}
        </div>

        <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Already under way</h2>
        <div className="mt-3">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
            <div>
              <div className="flex items-center gap-2.5">
                <p className="text-base font-semibold text-slate-700">{IN_PROGRESS_EVENT.name}</p>
                <StatusBadge status="IN PROGRESS" />
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">VIEWERS ONLY</span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Year {IN_PROGRESS_EVENT.year} of {IN_PROGRESS_EVENT.years} · {IN_PROGRESS_EVENT.teams} teams · no new teams can join
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-slate-400">{IN_PROGRESS_EVENT.code}</span>
              <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700">Watch</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------- the additions, as banners
// ⚠ ABOVE THE REAL SCREEN, NEVER INSIDE IT. Everything below renders as its own
// block; no real component's markup is touched, so nothing existing can shift.
function RoleChoice({ eventName, inProgress, teams }: {
  eventName: string; inProgress: boolean; teams: string[];
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 pt-8">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Event</p>
      <div className="flex items-center gap-2.5">
        <h1 className="text-2xl font-bold text-slate-900">{eventName}</h1>
        <StatusBadge status={inProgress ? 'IN PROGRESS' : 'OPEN'} />
      </div>

      <p className="mt-5 text-sm font-semibold uppercase tracking-wide text-slate-500">How are you joining?</p>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div className={`rounded-xl border p-5 shadow-sm ${
          inProgress ? 'border-slate-200 bg-slate-50' : 'border-blue-300 bg-white ring-1 ring-blue-100'}`}
        >
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            inProgress ? 'bg-slate-200 text-slate-400' : 'bg-blue-50 text-blue-600'}`}
          >
            {inProgress ? <Lock size={16} /> : <Users size={16} />}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <p className={`text-base font-semibold ${inProgress ? 'text-slate-400' : 'text-slate-900'}`}>Team Leader</p>
            {inProgress && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">UNAVAILABLE</span>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {inProgress
              ? 'This event is already in Year 3. Teams can only be created before the first year is locked.'
              : 'Name your team below and make its decisions each year.'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Eye size={16} /></div>
          <p className="mt-3 text-base font-semibold text-slate-900">Viewer</p>
          <p className="mt-1 text-sm text-slate-500">Follow a team without playing. Watching claims nothing.</p>
          <div className="mt-3 space-y-1.5">
            {teams.slice(0, 4).map(t => (
              <button key={t} className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-left text-sm text-slate-700">
                <span>{t}</span><span className="text-xs text-slate-400">watch</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-6 border-t border-slate-200 pt-4 text-xs uppercase tracking-wide text-slate-400">
        {inProgress ? 'Viewers continue below' : 'The join screen, as it is today'}
      </p>
    </div>
  );
}

function EventNameField() {
  return (
    <div className="mx-auto max-w-3xl px-6 pt-8">
      <div className="rounded-xl border border-blue-300 bg-white p-6 shadow-sm ring-1 ring-blue-100">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Event name <span className="text-red-500">*</span>
          </span>
          <input
            readOnly
            value="PRISM Spring Workshop"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
          />
          <span className="mt-1 block text-xs text-slate-400">
            Required. This is how the event appears in the lobby and on every player&rsquo;s screen.
          </span>
        </label>
      </div>
      <p className="mt-6 text-xs uppercase tracking-wide text-slate-400">
        The host setup below is the real screen, unchanged
      </p>
    </div>
  );
}

function HideFromLobby() {
  return (
    <div className="mx-auto max-w-3xl px-6 pb-10">
      <div className="flex items-center justify-between rounded-xl border border-blue-300 bg-white px-5 py-4 shadow-sm ring-1 ring-blue-100">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-slate-400"><EyeOff size={16} /></div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-slate-800">Hide from lobby</p>
              <StatusBadge status="OPEN" />
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Listed now, and open to new teams. Hiding removes it from the lobby list; anyone with the code
              can still join.
            </p>
          </div>
        </div>
        <button role="switch" aria-checked="false" className="relative h-6 w-11 flex-shrink-0 rounded-full bg-slate-200">
          <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the room
// Builds a REAL room through the REAL transport, so the screens below render
// against real data rather than props invented here.
async function buildRoom(opts: { eventName: string; teams: number; advanceTo: number }) {
  // ⚠ sessionTransport IS A FUNCTION, NOT THE OBJECT. It resolves the
  // implementation on first call — local in the browser, HTTP when
  // VITE_SESSION_API is set — which is the one line the session layer's whole
  // swap claim rests on. Calling it per use keeps the mockup on whichever the
  // app itself would use.
  const transport = sessionTransport();
  const hostToken = newSessionToken();
  const created = await transport.createRoom({
    seed: '7',
    yearCount: 5,
    startingYear: 2026,
    eventName: opts.eventName,
    expectedTeams: 6,
    lines: ['WC', 'GL', 'Property'],
    priorDevelopment: { ...DEFAULT_PRIOR_DEVELOPMENT },
    shocks: [],
    hostToken,
  });
  const code = created.code;
  rememberHostToken(code, hostToken);
  saveActive(code, { hostToken });

  const tokens: string[] = [];
  for (const name of TEAM_NAMES.slice(0, opts.teams)) {
    const j = await transport.join({ code, teamName: name, role: 'player' });
    tokens.push(j.teamToken);
  }

  // Years are advanced by every team submitting, then the host advancing —
  // the real sequence, so `currentYear` on screen is genuinely that year.
  for (let y = 1; y < opts.advanceTo; y++) {
    for (const teamToken of tokens) {
      // ⚠ THE FIELD IS `token`, NOT `teamToken`. Passing the latter sends
      // undefined and the room refuses it with "Only a team player may submit",
      // which is the server being right about an empty credential rather than
      // about the role.
      // At least one of decisions/result must be present — an empty call is
      // refused with "Nothing to submit". Decisions are opaque on the wire,
      // so a marker object is a legitimate payload here.
      await transport.submit({ code, token: teamToken, yearNumber: y, decisions: { mockup: true } });
    }
    // expectedYear is REQUIRED — the server compare-and-swaps on it so a
    // retried advance cannot skip a year.
    await transport.advance({ code, token: hostToken, expectedYear: y });
  }
  return code;
}

function WithRoom({ build, children }: {
  build: () => Promise<string>;
  children: (code: string) => React.JSX.Element;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { build().then(setCode).catch(e => setErr(String(e))); }, []);
  if (err) return <pre className="p-8 text-sm text-red-700">{err}</pre>;
  if (!code) return <div className="p-8 text-sm text-slate-400">building room…</div>;
  return children(code);
}

// ---------------------------------------------------------------------- mount
const SCREENS: Record<string, () => React.JSX.Element> = {
  '1': Lobby,

  // 02 — the REAL join screen, role choice added above it.
  '2': () => (
    <WithRoom build={() => buildRoom({ eventName: 'PRISM Spring Workshop', teams: 6, advanceTo: 1 })}>
      {code => (
        <div className="min-h-screen bg-slate-50">
          <RoleChoice eventName="PRISM Spring Workshop" inProgress={false} teams={TEAM_NAMES} />
          <PlayScreen code={code} role="player" />
        </div>
      )}
    </WithRoom>
  ),

  // 03 — the same real screen on a room genuinely advanced to Year 3.
  '3': () => (
    <WithRoom build={() => buildRoom({ eventName: 'Finance Committee Session', teams: 4, advanceTo: 3 })}>
      {code => (
        <div className="min-h-screen bg-slate-50">
          <RoleChoice eventName="Finance Committee Session" inProgress teams={TEAM_NAMES} />
          <PlayScreen code={code} role="viewer" />
        </div>
      )}
    </WithRoom>
  ),

  // 04 — the REAL host setup, the required Event name field added above it.
  '4': () => (
    <div className="min-h-screen bg-slate-50">
      <EventNameField />
      <HostScreen />
    </div>
  ),

  // 05 — the REAL host room screen, Hide from lobby added below it.
  '5': () => (
    <WithRoom build={() => buildRoom({ eventName: 'PRISM Spring Workshop', teams: 6, advanceTo: 1 })}>
      {code => (
        <div className="min-h-screen bg-slate-50">
          <HostScreen code={code} />
          <HideFromLobby />
        </div>
      )}
    </WithRoom>
  ),

  // A control, not a mockup: the REAL host setup with NOTHING added, so 04 can
  // be diffed against it and the only difference shown to be the new field.
  'control-04': () => <HostScreen />,
};

const which = new URLSearchParams(window.location.search).get('s') ?? '1';
const Screen = SCREENS[which];
if (!Screen) throw new Error(`lobby mockup: no screen "${which}" — use ?s=1 .. ?s=5, or ?s=control-04`);

createRoot(document.getElementById('root')!).render(
  <StrictMode><Screen /></StrictMode>,
);
