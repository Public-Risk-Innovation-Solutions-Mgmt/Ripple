// ============================================================================
// LOBBY MOCKUP — STATIC. NOT WIRED TO ANYTHING, AND NOT PART OF THE APP.
//
// ⚠ NOTHING HERE IS REACHABLE FROM THE GAME. This file lives under docs/, not
// src/, is in no route, and is imported by nothing the app builds. It exists to
// be screenshotted. The planned lobby does not exist yet; this is what it would
// look like, drawn in the app's own idiom so the screenshots can be read as a
// design and not as a sketch.
//
// ⚠ EVERY FIGURE ON THESE SCREENS IS INVENTED. Event names, team names, counts
// and years are sample data chosen to look like a real session. No engine ran.
//
// WHY IT COPIES THE APP'S MARKUP RATHER THAN IMPORTING ITS SCREENS: the real
// HostCreateScreen talks to the session transport on mount and would need a
// server, a room and a token to render at all. A mockup that needed the live
// stack to take a picture of a screen that does not exist yet would be the
// wrong shape. The classes below are lifted from the real screens — the same
// slate palette, the same rounded-xl cards, the same blue-600 primary — so the
// look tracks the app even though the wiring does not.
//
// Screens are selected by query string: ?s=1 .. ?s=5. See README.md.
// ============================================================================

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Play, Users, Eye, Plus, Shuffle, Zap, Trash2, EyeOff, Clock, CheckCircle2, Lock,
} from 'lucide-react';
import './mockup.css';

// ---------------------------------------------------------------- sample data
const EVENTS = [
  {
    code: 'PRSM24',
    name: 'PRISM Spring Workshop',
    status: 'OPEN' as const,
    teams: 6,
    year: null,
    years: 5,
    lines: 'WC + GL + Property',
  },
  {
    code: 'FINC03',
    name: 'Finance Committee Session',
    status: 'IN PROGRESS' as const,
    teams: 4,
    year: 3,
    years: 5,
    lines: 'WC + GL',
  },
];

const OPEN_EVENT_TEAMS = [
  'Harbour Mutual', 'Cedar Valley JPA', 'Northgate Risk Pool',
  'Tri-County Authority', 'Lakeshore Schools Trust', 'Summit Public Entities',
];

const IN_PROGRESS_TEAMS = [
  'Riverbend Consortium', 'Fairfield Municipal Pool', 'Oakridge JPA', 'Western Slope Alliance',
];

// ---------------------------------------------------------------- shared bits
function StatusBadge({ status }: { status: 'OPEN' | 'IN PROGRESS' }) {
  const open = status === 'OPEN';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        open ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
             : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
      }`}
    >
      {open ? <CheckCircle2 size={12} /> : <Clock size={12} />}
      {status}
    </span>
  );
}

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
            R
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900">RIPPLE</span>
          <span className="text-slate-300">|</span>
          <span className="text-sm text-slate-500">{subtitle ?? 'Public entity risk pool simulation'}</span>
        </div>
      </div>
      <div className="mx-auto max-w-4xl px-6 py-8">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- 01 the lobby
function Lobby() {
  return (
    <Shell>
      <h1 className="text-2xl font-bold text-slate-900">Welcome</h1>
      <p className="mt-1 text-sm text-slate-500">
        Play on your own, or join an event your organisation is running.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <button className="rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:border-blue-400 hover:shadow">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Play size={18} />
          </div>
          <p className="mt-3 text-base font-semibold text-slate-900">Play Solo</p>
          <p className="mt-1 text-sm text-slate-500">
            Run your own pool at your own pace. Nobody else joins, and you advance the years yourself.
          </p>
        </button>

        <button className="rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:border-blue-400 hover:shadow">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Plus size={18} />
          </div>
          <p className="mt-3 text-base font-semibold text-slate-900">Host an Event</p>
          <p className="mt-1 text-sm text-slate-500">
            Set up a session for a group. You choose the lines and the schedule, and advance the table together.
          </p>
        </button>
      </div>

      <div className="mt-8 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Current events</h2>
        <span className="text-xs text-slate-400">{EVENTS.length} listed</span>
      </div>

      <div className="mt-3 space-y-3">
        {EVENTS.map(e => (
          <div
            key={e.code}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-blue-400"
          >
            <div>
              <div className="flex items-center gap-2.5">
                <p className="text-base font-semibold text-slate-900">{e.name}</p>
                <StatusBadge status={e.status} />
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {e.status === 'OPEN'
                  ? `${e.teams} teams joined · waiting to start`
                  : `Year ${e.year} of ${e.years} · ${e.teams} teams`}
                {' · '}{e.lines}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-slate-400">{e.code}</span>
              <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">
                {e.status === 'OPEN' ? 'Join' : 'Watch'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Events appear here while their host has them listed. A host can hide an event from the lobby at any
        time; hidden events are still reachable with their code.
      </p>
    </Shell>
  );
}

// ---------------------------------------------- 02 / 03 the role choice screens
function RoleChoice({ inProgress }: { inProgress: boolean }) {
  const e = inProgress ? EVENTS[1] : EVENTS[0];
  const teams = inProgress ? IN_PROGRESS_TEAMS : OPEN_EVENT_TEAMS;
  return (
    <Shell subtitle="Joining an event">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-slate-900">{e.name}</h1>
            <StatusBadge status={e.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {inProgress
              ? `Year ${e.year} of ${e.years} · ${e.teams} teams · ${e.lines}`
              : `${e.teams} teams joined · ${e.years} years · ${e.lines}`}
          </p>
        </div>
        <span className="font-mono text-sm text-slate-400">{e.code}</span>
      </div>

      <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">How are you joining?</p>

      <div className="mt-3 grid grid-cols-2 gap-4">
        {/* ---- TEAM LEADER ---- */}
        <div
          className={`rounded-xl border p-6 shadow-sm ${
            inProgress ? 'border-slate-200 bg-slate-50' : 'border-blue-300 bg-white ring-1 ring-blue-100'
          }`}
        >
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg ${
              inProgress ? 'bg-slate-200 text-slate-400' : 'bg-blue-50 text-blue-600'
            }`}
          >
            {inProgress ? <Lock size={18} /> : <Users size={18} />}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <p className={`text-base font-semibold ${inProgress ? 'text-slate-400' : 'text-slate-900'}`}>
              Team Leader
            </p>
            {inProgress && (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                UNAVAILABLE
              </span>
            )}
          </div>

          {inProgress ? (
            <p className="mt-2 text-sm text-slate-500">
              This event is already in Year {e.year}. Teams can only be created before the first year is
              locked, because a team joining later would have no decisions on record for the years already
              played.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-500">
                Name your team and make its decisions each year.
              </p>
              <label className="mt-4 block">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Team name</span>
                <input
                  readOnly
                  value="Brookfield Regional JPA"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
                />
              </label>
              <button className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white">
                Join as this team
              </button>
            </>
          )}
        </div>

        {/* ---- VIEWER ---- */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Eye size={18} />
          </div>
          <p className="mt-3 text-base font-semibold text-slate-900">Viewer</p>
          <p className="mt-1 text-sm text-slate-500">
            Follow a team without playing. Watching claims nothing and changes nothing.
          </p>

          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">Pick a team to follow</p>
          <div className="mt-2 space-y-1.5">
            {teams.map(t => (
              <button
                key={t}
                className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-blue-400 hover:bg-blue-50"
              >
                <span>{t}</span>
                <span className="text-xs text-slate-400">watch</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- 04 host setup
function HostSetup() {
  return (
    <Shell subtitle="Hosting an event">
      <h1 className="text-2xl font-bold text-slate-900">Host an Event</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every team plays the same instance. Teams name themselves when they join; you choose the coverage
        lines below.
      </p>

      <div className="mt-5 space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {/* ⚠ THE NEW FIELD, AND IT IS FIRST AND REQUIRED. The event name is what
            the lobby lists, so a room without one cannot appear there at all —
            which is why it is promoted out of the two-column grid it shared with
            the seed and marked required rather than left optional. */}
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

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Seed</span>
            <select disabled className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-800">
              <option>7</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Years</span>
            <input readOnly value={5} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" />
            <span className="mt-1 block text-xs text-slate-400">How many rounds the game will run.</span>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Starting year</span>
            <input readOnly value={2026} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" />
            <span className="mt-1 block text-xs text-slate-400">Year 0 of the game.</span>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Number of Teams</span>
            <input readOnly value={6} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" />
            <span className="mt-1 block text-xs text-slate-400">How many to expect, so you know when everyone has arrived.</span>
          </label>
        </div>

        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Coverage lines</span>
          <p className="mt-1 text-xs text-slate-400">Every team plays these lines. At least one.</p>
          <div className="mt-2 space-y-2">
            {[
              ["Workers' Compensation", '3%'],
              ['General Liability', '10%'],
              ['Property', '-2%'],
            ].map(([line, dev]) => (
              <div key={line} className="flex items-center justify-between rounded-lg border border-blue-300 bg-blue-50 px-3 py-2">
                <span className="text-sm font-medium text-slate-800">{line}</span>
                <span className="text-xs text-slate-500">
                  prior development <span className="font-mono text-slate-700">{dev}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Shock schedule</span>
            <button className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600">
              <Shuffle size={12} /> Draw a schedule
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {[['Year 2', 'Wildfire — regional'], ['Year 4', 'Medical inflation step']].map(([yr, name]) => (
              <div key={yr} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="flex items-center gap-2 text-sm text-slate-700">
                  <Zap size={13} className="text-amber-500" />
                  <span className="font-medium">{yr}</span>
                  <span className="text-slate-500">{name}</span>
                </span>
                <Trash2 size={13} className="text-slate-400" />
              </div>
            ))}
          </div>
        </div>

        <button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white">
          Create event
        </button>
      </div>
    </Shell>
  );
}

// ------------------------------------------------------- 05 host's event screen
function HostEvent() {
  return (
    <Shell subtitle="Your event">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Room code</p>
            <p className="font-mono text-4xl font-semibold tracking-[0.2em] text-slate-800">PRSM24</p>
            <div className="mt-2 flex items-center gap-2.5">
              <p className="text-sm text-slate-500">
                PRISM Spring Workshop · seed <span className="font-mono">7</span> · 5 years
              </p>
              <StatusBadge status="OPEN" />
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Current year</p>
            <p className="text-4xl font-semibold text-slate-800">1</p>
            <p className="text-xs text-slate-400">of 5</p>
          </div>
        </div>

        <div className="mt-4 flex gap-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
          <span>Players join at <span className="font-mono text-slate-700">/join/PRSM24</span></span>
          <span>Watchers at <span className="font-mono text-slate-700">/view/PRSM24</span></span>
        </div>
      </div>

      {/* ⚠ THE LOBBY CONTROL. Hiding does not close the event or turn anyone
          away — it only takes the row out of the lobby list, so a session that
          has filled up stops inviting strangers while its own players keep the
          code they already have. */}
      <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-slate-400"><EyeOff size={16} /></div>
          <div>
            <p className="text-sm font-medium text-slate-800">Hide from lobby</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Listed now. Hiding removes it from the lobby list; anyone with the code can still join.
            </p>
          </div>
        </div>
        <button
          role="switch"
          aria-checked="false"
          className="relative h-6 w-11 flex-shrink-0 rounded-full bg-slate-200 transition"
        >
          <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Teams</p>
          <p className="text-xs text-slate-400">6 of 6 expected · 4 locked</p>
        </div>
        <div className="mt-3 space-y-1.5">
          {OPEN_EVENT_TEAMS.map((t, i) => (
            <div key={t} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <span className="text-sm text-slate-700">{t}</span>
              <span className={`text-xs ${i < 4 ? 'font-medium text-emerald-700' : 'text-slate-400'}`}>
                {i < 4 ? 'locked Year 1' : 'still deciding'}
              </span>
            </div>
          ))}
        </div>
        <button className="mt-4 w-full rounded-lg bg-slate-200 px-4 py-2.5 text-sm font-medium text-slate-500">
          Advance to Year 2 — waiting on 2 teams
        </button>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------- mount
const SCREENS: Record<string, () => React.JSX.Element> = {
  '1': Lobby,
  '2': () => <RoleChoice inProgress={false} />,
  '3': () => <RoleChoice inProgress />,
  '4': HostSetup,
  '5': HostEvent,
};

const which = new URLSearchParams(window.location.search).get('s') ?? '1';
const Screen = SCREENS[which];
if (!Screen) throw new Error(`lobby mockup: no screen "${which}" — use ?s=1 .. ?s=5`);

createRoot(document.getElementById('root')!).render(
  <StrictMode><Screen /></StrictMode>,
);
