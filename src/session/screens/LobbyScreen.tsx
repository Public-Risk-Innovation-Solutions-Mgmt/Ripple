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
// ⚠ PLAY SOLO AND HOST AN EVENT ARE BOTH SHOWN, EACH BEHIND ONE SWITCH. They
// landed hidden and were turned on by flipping the two constants below and
// nothing else — no JSX to write, no import to add, no layout to rediscover,
// which is what the switches were for. Turning either back off is the same one
// line. They stay typed `: boolean` rather than becoming literal `true`
// because a literal narrows and would make the other branch unreachable, which
// is both a lint error and the wrong claim about code that is a switch away.
//
// Play Solo goes to /solo; Host an Event goes to /host, which is also still
// reachable directly as it was while the card was off.
// ============================================================================

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Eye, Play, Plus } from 'lucide-react';
import { sessionTransport, isSessionError, type LobbyEvent, type SessionError } from '../index';
import { navigate } from '../client/navigation';

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
        <p className="mt-1 text-sm text-slate-500">Join an event your organisation is running.</p>

        {(SHOW_PLAY_SOLO || SHOW_HOST_AN_EVENT) && (
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
          <p data-testid="lobby-loading" className="mt-8 text-sm text-slate-400">Loading events…</p>
        )}

        {events !== null && (
          <>
            <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Open events</h2>
            <p className="mt-1 text-xs text-slate-400">Anyone can join these as a team leader or as a viewer.</p>
            <div data-testid="open-events" className="mt-3 space-y-3">
              {open.length === 0 && (
                <p data-testid="no-open-events" className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-center text-sm text-slate-400">
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
                    <span className="font-mono text-xs text-slate-400">{e.code}</span>
                    <button
                      data-testid={`join-${e.code}`}
                      onClick={() => navigate(`/join/${e.code}`)}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white"
                    >
                      Join
                    </button>
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
                        <span className="font-mono text-xs text-slate-400">{e.code}</span>
                        <button
                          data-testid={`watch-${e.code}`}
                          onClick={() => navigate(`/view/${e.code}`)}
                          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                        >
                          <span className="inline-flex items-center gap-1.5"><Eye size={13} /> Watch</span>
                        </button>
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
