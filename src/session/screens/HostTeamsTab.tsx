// ============================================================================
// THE TEAMS TAB — one row per team, scanned for outliers.
//
// ⚠ A SUMMARY, NOT THE TEAM'S PAGES. The host is looking for who is in
// trouble, not diagnosing why. Per line and for the pool: Team · Ripple Score (a
// placeholder, "—" until it exists) · Premium to surplus · Rate (per $100, with
// the year's change) · Admin expense (the year's, over premium) · Combined ratio
// (the year's own — the team's statement's newest column and its top-bar figure —
// headed with the year, on the combined-ratio colour scale) · Net
// surplus (year-end) · Market share. The premium to surplus, rate, admin expense
// and combined ratio are the team's own Annual Statement figures, posted with
// its results (TeamYearFigures); a row posted before they existed shows dashes.
//
// ⚠ THE LINE VIEW IS WHAT MAKES THE TABLE COMPARABLE AT ALL. Teams pick their
// own lines, so a pooled surplus blends a WC-only book with a three-line book
// and the column stops meaning one thing. On a line view every figure in a
// column is the same line. The Pool view still shows the aggregate, which is
// what the aggregate means everywhere else in this app — it is the right answer
// to a different question, not a worse answer to this one.
//
// ⚠ THREE STATES, AND THEY ARE STRUCTURALLY DIFFERENT RATHER THAN DIFFERENTLY
// COLOURED. This is the same distinction the Membership page draws, and it was
// worth more than a shade there too:
//
//   ABSENT   the team does not write this line. Not zero, and not late. The row
//            collapses to ONE cell saying so, because five dashes across five
//            numeric columns is exactly the thing somebody reads as a result.
//   PENDING  the team writes it and has not posted this year yet. Also one cell,
//            naming the year it is waiting on.
//   REPORTED its figures.
//
// A row in any of the three is still a row: the team is always listed, because
// "which teams exist" is not the question any of these three answers.
//
// ⚠ IT SHOWS THE LAST COMPLETED YEAR, NOT THE CURRENT ONE. Results describe a
// year already played, so the host advances to year N and teams then report
// N-1. Between advances that is the newest thing there is, and a host waiting on
// a slow team should be reading it rather than a blank.
// ============================================================================

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { latestKnownRoomYear } from '../../utils/knownYears';
import { Layers, HardHat, Scale, Building2, Smartphone, Loader2 } from 'lucide-react';
import TabNav from '../../components/TabNav';
import { LINE_FULL_NAME } from '../../utils/lineDisplay';
import { colorForCombinedRatio, colorForSurplus, formatCurrency, formatPct } from '../../utils/formatters';
import type { CoverageLine, LineView } from '../../types/simulation';
import { sessionTransport, isSessionError, type RoomView, type TeamYearFigures, type TeamYearSummary, type TeamView } from '../index';

const LINE_ORDER: CoverageLine[] = ['WC', 'GL', 'Property'];

const LINE_VIEW_ICONS: Record<LineView, React.ReactNode> = {
  pool: <Layers size={14} />,
  WC: <HardHat size={14} />,
  GL: <Scale size={14} />,
  Property: <Building2 size={14} />,
};

type RowState =
  | { kind: 'absent' }
  | { kind: 'pending' }
  | { kind: 'reported'; figures: TeamYearFigures; pool?: TeamYearSummary['byLine'] };

/**
 * ⚠ THE WHOLE POINT OF THIS FUNCTION IS THE ORDER OF ITS CHECKS. Absence is
 * decided BEFORE lateness: a team that does not write GL is not "late on GL",
 * and never will be, so asking whether it has reported would be asking the wrong
 * question of it forever.
 */
function rowState(team: TeamView, view: LineView, reportingYear: number): RowState {
  if (view !== 'pool' && !team.lines.includes(view)) return { kind: 'absent' };

  // ⚠ YEAR 0 COUNTS, AND FROM THE START. Results show through the year just
  // completed (utils/knownYears), so before the first advance the latest known
  // year is 2026, the opening — the table shows it rather than nothing. A year
  // before 0 is never known (no room keeps one).
  if (reportingYear < 0) return { kind: 'pending' };

  // ⚠ THE EXACT YEAR, NOT "THE LATEST ONE, IF IT HAPPENS TO BE THIS YEAR". The
  // room keeps every year now, so this asks for the year the table is showing
  // and gets it or nothing. The old form could only ever answer for the newest
  // year, which was the same question only while the record held one slot.
  const posted = team.resultsByYear?.[String(reportingYear)];
  if (!posted) return { kind: 'pending' };

  const figures = view === 'pool' ? posted.pool : posted.byLine[view];
  // A team that writes the line but whose posted summary has no slice for it is
  // pending rather than absent — the summary predates the line, not the team.
  if (!figures) return { kind: 'pending' };
  // The pool's rate cell lists each line's, so the pool row carries the lines' figures.
  return { kind: 'reported', figures, pool: view === 'pool' ? posted.byLine : undefined };
}

/** "$3.20 (+2.1%)": a line's rate per $100 and its change on the year before. */
function rateText(f: TeamYearFigures | undefined): string | undefined {
  if (f?.ratePer100 === undefined) return undefined;
  const change = f.rateChange === undefined ? ''
    : ` (${f.rateChange >= 0 ? '+' : '−'}${Math.abs(f.rateChange * 100).toFixed(1)}%)`;
  return `$${f.ratePer100.toFixed(2)}${change}`;
}

/**
 * ⚠ ONE-TIME, LIKE THE RECOVERY CODE IT MAY REISSUE. Opened from a row's
 * action button; mints a fresh handoff link on open (never reused across
 * opens — closing and reopening gets a new one, same "ask again" shape as
 * every other one-time secret in this app) and shows it as both a link and a
 * QR code, so a player can get it onto a phone without typing anything.
 *
 * ⚠ THE QR CODE IS RENDERED ENTIRELY IN THE BROWSER. `qrcode`'s `toDataURL`
 * never leaves the page — no remote QR-image service ever sees this link,
 * because the link itself is a live bearer secret, not a URL safe to hand to
 * a third party just to get a picture back.
 */
function HandoffModal({ code, hostToken, teamName, onClose }: {
  code: string;
  hostToken: string;
  teamName: string;
  onClose: () => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [expiresAtSec, setExpiresAtSec] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await sessionTransport().createHandoff({ code, token: hostToken, teamName });
        if (cancelled) return;
        const url = `${window.location.origin}/claim/${code}/${res.handoffToken}`;
        const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
        if (cancelled) return;
        setLink(url);
        setQr(dataUrl);
        setExpiresAtSec(res.expiresAtSec);
      } catch (e) {
        if (!cancelled) setError(isSessionError(e) ? e.message : 'Could not create a hand-off link.');
      }
    })();
    return () => { cancelled = true; };
  }, [code, hostToken, teamName]);

  // A plain tick for the countdown — nothing here re-fetches on expiry, since
  // the link simply stops working server-side; this just tells the host so.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = expiresAtSec !== null ? Math.max(0, expiresAtSec - Math.floor(now / 1000)) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center gap-2">
          <span className="text-blue-600"><Smartphone size={18} /></span>
          <h2 className="text-lg font-bold text-slate-900">Move {teamName} to a new device</h2>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Scan this on the new device, or send it the link. It works once, for the next 10 minutes.
        </p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {!error && !qr && (
          <div className="mt-6 flex items-center justify-center gap-2 py-8 text-slate-500">
            <Loader2 className="animate-spin" size={18} />
            <span className="text-sm">Creating link…</span>
          </div>
        )}

        {qr && link && (
          <>
            <div className="mt-4 flex justify-center">
              <img src={qr} alt={`QR code to claim ${teamName}`} width={220} height={220} />
            </div>
            <p data-testid="handoff-link" className="mt-3 break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center font-mono text-xs text-slate-700">
              {link}
            </p>
            {secondsLeft !== null && (
              <p className="mt-1.5 text-center text-xs text-slate-500">
                {secondsLeft > 0 ? `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}` : 'Expired — close and try again for a new link.'}
              </p>
            )}
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Done
        </button>
      </div>
    </div>
  );
}

interface Props {
  room: RoomView;
  code: string;
  hostToken: string | undefined;
}

export default function HostTeamsTab({ room, code, hostToken }: Props) {
  const [view, setView] = useState<LineView>('pool');
  const [handoffTeam, setHandoffTeam] = useState<string | null>(null);

  // Only the lines SOMEBODY writes are worth offering: a room where nobody took
  // Property has no Property column to compare.
  const linesInPlay = LINE_ORDER.filter(l => room.teams.some(t => t.lines.includes(l)));
  const effectiveView: LineView = view !== 'pool' && !linesInPlay.includes(view) ? 'pool' : view;

  // The latest known year (utils/knownYears): the year just completed — the
  // opening before the first advance, then each year as it is played.
  const reportingYear = Math.min(latestKnownRoomYear(room), room.currentYear - 1);
  const teams = room.teams;

  if (teams.length === 0) {
    return (
      <p data-testid="teams-empty" className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-600">
        No teams have joined yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* The same line-view bar the game uses, from the same component. */}
      <TabNav<LineView>
        tabs={[
          { id: 'pool' as LineView, label: 'Pool', icon: LINE_VIEW_ICONS.pool },
          ...linesInPlay.map(l => ({ id: l as LineView, label: LINE_FULL_NAME[l], icon: LINE_VIEW_ICONS[l] })),
        ]}
        activeTab={effectiveView}
        onSelect={setView}
        stickyTop={0}
        zIndex={10}
      />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="text-sm font-medium text-slate-700">
            {effectiveView === 'pool' ? 'Pool' : LINE_FULL_NAME[effectiveView]}
          </p>
          <p data-testid="teams-year" className="text-xs text-slate-600">
            {reportingYear < 0 ? 'No results known yet' : `Results for ${room.startingYear + reportingYear - 1}`}
          </p>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
              <th data-testid="teams-number-head" className="px-5 py-2 font-medium">Team number</th>
              <th className="px-5 py-2 font-medium">Team</th>
              <th className="px-5 py-2 font-medium">Ripple Score</th>
              <th className="px-5 py-2 font-medium">Premium to surplus</th>
              <th className="px-5 py-2 font-medium" title="Per $100 of exposure, with this year's change">Rate</th>
              <th className="px-5 py-2 font-medium" title="This year's admin expense, as a share of premium">Admin expense</th>
              <th data-testid="teams-cr-head" className="px-5 py-2 font-medium" title="The year's own, as on the team's Annual Statement and top bar">
                {reportingYear < 0 ? 'Combined ratio' : `Combined ratio ${room.startingYear + reportingYear - 1}`}
              </th>
              <th className="px-5 py-2 font-medium" title="Surplus at the year's end">Net surplus</th>
              <th className="px-5 py-2 font-medium" title="Share of the room: exposure on a line, premium on the pool">Market share</th>
              <th className="px-5 py-2 text-right font-medium">Hand Off</th>
            </tr>
          </thead>
          <tbody data-testid="teams-table">
            {teams.map(t => {
              const state = rowState(t, effectiveView, reportingYear);
              return (
                <tr key={t.name} className="border-t border-slate-50">
                  {/* ⚠ THE NAME ALONE. The team's lines used to follow it in a second
                      span with no space between them in the text, so a team named
                      "T" read "TWC+GL+Property"; the line view shows the lines. */}
                  {/* The team's number in the room (contract teamNumbers), before its name. */}
                  <td data-testid={`number-${t.name}`} className="whitespace-nowrap px-5 py-2.5 text-slate-600">Team {t.teamNumber}</td>
                  <td data-testid={`name-${t.name}`} className="px-5 py-2.5 text-slate-700">{t.name}</td>
                  {state.kind === 'absent' && (
                    // ⚠ ONE CELL, IN WORDS. Nothing here can be read as a
                    // number, which is the requirement.
                    <td colSpan={6} data-testid={`absent-${t.name}`} className="px-5 py-2.5 text-xs italic text-slate-600">
                      does not write {effectiveView === 'pool' ? '' : effectiveView}
                    </td>
                  )}

                  {state.kind === 'pending' && (
                    <td colSpan={6} data-testid={`pending-${t.name}`} className="px-5 py-2.5 text-xs text-amber-600">
                      {reportingYear < 0 ? 'no results known yet' : `${room.startingYear + reportingYear - 1} not reported yet`}
                    </td>
                  )}

                  {state.kind === 'reported' && (
                    <>
                      <td data-testid={`ripple-${t.name}`} className="px-5 py-2.5 font-mono text-slate-600">—</td>
                      <td data-testid={`pts-${t.name}`} className="px-5 py-2.5 font-mono text-slate-700">
                        {state.figures.premiumToSurplus !== undefined ? state.figures.premiumToSurplus.toFixed(2) : <span className="text-slate-600">—</span>}
                      </td>
                      <td data-testid={`rate-${t.name}`} className="px-5 py-2.5 font-mono text-slate-700">
                        {effectiveView !== 'pool'
                          ? (rateText(state.figures) ?? <span className="text-slate-600">—</span>)
                          // THE POOL: each line's rate, since the lines' units differ.
                          : t.lines.length === 0 ? <span className="text-slate-600">—</span>
                          : t.lines.map(l => (
                            <span key={l} className="block whitespace-nowrap text-xs">
                              {l} {rateText(state.pool?.[l]) ?? <span className="text-slate-600">—</span>}
                            </span>
                          ))}
                      </td>
                      <td data-testid={`admin-${t.name}`} className="px-5 py-2.5 font-mono text-slate-700">
                        {state.figures.adminExpenseRatio !== undefined ? formatPct(state.figures.adminExpenseRatio) : <span className="text-slate-600">—</span>}
                      </td>
                      <td data-testid={`cr-${t.name}`}
                        className={`px-5 py-2.5 font-mono ${state.figures.yearCombinedRatio !== undefined ? colorForCombinedRatio(state.figures.yearCombinedRatio) : 'text-slate-600'}`}>
                        {state.figures.yearCombinedRatio !== undefined ? formatPct(state.figures.yearCombinedRatio) : '—'}
                      </td>
                      <td data-testid={`surplus-${t.name}`} className={`px-5 py-2.5 font-mono ${colorForSurplus(state.figures.endingSurplus)}`}>
                        {formatCurrency(state.figures.endingSurplus, true)}
                      </td>
                    </>
                  )}

                  {/* THE ROOM'S SET FOR THE LATEST KNOWN YEAR — the row's own year
                      (shownShares). Worked out once a year, when the last team
                      that locked in has posted; while a locked team has not, the
                      newest complete year before it. On a line, the team's
                      exposure over the room's on the line; on the pool, its
                      premium over the room's. */}
                  <td data-testid={`share-${t.name}`} className="px-5 py-2.5 font-mono text-sky-700">
                    {(() => {
                      const share = room.marketShares?.byTeam[t.name];
                      const v = share === undefined ? undefined
                        : effectiveView === 'pool' ? share.pool : share.byLine[effectiveView];
                      if (v === undefined) return <span className="text-slate-600">—</span>;
                      // The heading names the results' year; a share worked out for an
                      // earlier one (a locked team not yet posted) says which.
                      const sy = room.marketShares!.year;
                      return sy === reportingYear ? formatPct(v)
                        : <>{formatPct(v)} <span className="text-[10px] text-slate-600">({room.startingYear + sy - 1})</span></>;
                    })()}
                  </td>
                  {/* ⚠ "MOVE TO NEW DEVICE" — THE HOST'S HALF OF A HAND-OFF. A
                      QR code and a one-time link for this team, from
                      HandoffModal; see ClaimScreen.tsx for the device side.
                      Disabled without a hostToken (admin not yet confirmed
                      for this room), which should not happen once the tab
                      itself is reachable, but the button has nothing to call
                      without one. */}
                  <td className="px-5 py-2.5 text-right">
                    <button
                      type="button"
                      data-testid={`handoff-${t.name}`}
                      onClick={() => setHandoffTeam(t.name)}
                      disabled={!hostToken}
                      title="Move to new device"
                      aria-label={`Move ${t.name} to a new device`}
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Smartphone size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-600">
          {effectiveView === 'pool'
            ? 'Pooled figures. Teams writing different lines are not directly comparable here — pick a line above.'
            : `Every figure is ${effectiveView}, so the column compares like with like.`}
          {' '}Ripple Score is coming: a single score for each team, still being designed.
        </p>
      </div>

      {handoffTeam && hostToken && (
        <HandoffModal
          code={code}
          hostToken={hostToken}
          teamName={handoffTeam}
          onClose={() => setHandoffTeam(null)}
        />
      )}
    </div>
  );
}
