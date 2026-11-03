// ============================================================================
// THE TEAMS TAB — one row per team, scanned for outliers.
//
// ⚠ A SUMMARY, NOT THE TEAM'S PAGES. The host is looking for who is in
// trouble, not diagnosing why. Per line and for the pool: Team · Ripple Score (a
// PLACEHOLDER until the real score is designed: the team's rank by the pool's
// net surplus, "1st" for the highest, ties sharing a rank — utils/rippleScore)
// · Premium to surplus · Rate (per $100, with
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
import { Smartphone, Loader2, Copy } from 'lucide-react';
import StandingsTable from './StandingsTable';
import { sessionTransport, isSessionError, type RoomView } from '../index';

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
  const [copied, setCopied] = useState(false);

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
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p data-testid="handoff-link" className="flex-1 break-all font-mono text-xs text-slate-700">
                {link}
              </p>
              <button
                type="button"
                onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)); }}
                className="shrink-0 text-slate-600 hover:text-slate-700"
                aria-label="Copy hand-off link"
              >
                <Copy size={16} />
              </button>
            </div>
            {copied && <p className="mt-1.5 text-center text-xs text-emerald-600">Copied.</p>}
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

// The table itself is StandingsTable's — the same one a team's Market Survey
// renders. The host adds its hand-off column.
export default function HostTeamsTab({ room, code, hostToken }: Props) {
  const [handoffTeam, setHandoffTeam] = useState<string | null>(null);
  return (
    <>
      <StandingsTable
        teams={room.teams}
        marketShares={room.marketShares}
        startingYear={room.startingYear}
        currentYear={room.currentYear}
        yearCount={room.yearCount}
        actionHead="Hand Off"
        // ⚠ "MOVE TO NEW DEVICE" — THE HOST'S HALF OF A HAND-OFF. A QR code and a
        // one-time link for this team, from HandoffModal; see ClaimScreen.tsx for
        // the device side. Disabled without a hostToken (admin not yet confirmed
        // for this room), which should not happen once the tab itself is
        // reachable, but the button has nothing to call without one.
        renderAction={name => (
          <button
            type="button"
            data-testid={`handoff-${name}`}
            onClick={() => setHandoffTeam(name)}
            disabled={!hostToken}
            title="Move to new device"
            aria-label={`Move ${name} to a new device`}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Smartphone size={14} />
          </button>
        )}
      />

      {handoffTeam && hostToken && (
        <HandoffModal
          code={code}
          hostToken={hostToken}
          teamName={handoffTeam}
          onClose={() => setHandoffTeam(null)}
        />
      )}
    </>
  );
}
