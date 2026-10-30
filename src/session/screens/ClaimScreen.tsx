// ============================================================================
// /claim/CODE/HANDOFFTOKEN — THE DEVICE SIDE OF A HOST HAND-OFF.
//
// ⚠ A LINK, NOT A FORM. The host's "Move to new device" (HostTeamsTab.tsx)
// hands out this exact URL (and its QR code); nobody types a team name or a
// recovery code here — the handoffToken in the path already names the team
// (server/rooms.ts's reclaimTeam), which is what makes this screen a single
// automatic action rather than another picker.
//
// ⚠ ONE SHOT, LIKE JOINING. This mints its own device token once and calls
// reclaimTeam exactly once; there is no retry button, because a dead link
// (expired, already used) needs a NEW one from the host, not another attempt
// at the same one.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { sessionTransport, isSessionError, type SessionError } from '../index';
import { newSessionToken } from '../contract';
import { navigate } from '../client/navigation';
import { rememberTeamCredential, saveActive } from '../client/identity';
import { RecoveryCodeModal } from './PlayScreen';

interface Props {
  code: string;
  handoffToken: string;
}

export default function ClaimScreen({ code, handoffToken }: Props) {
  const [error, setError] = useState<SessionError | null>(null);
  // Set only when the claim reissued a fresh recovery code — see
  // contract.ts's ReclaimTeamResponse. Shown once, same as PlayScreen's own.
  const [showRecoveryCode, setShowRecoveryCode] = useState<string | null>(null);
  // Held once, not re-minted per render — a StrictMode double-invoke of the
  // effect below must present the SAME token both times, or the second call
  // would read as a different device claiming an already-claimed link rather
  // than the idempotent retry reclaimTeam is built to recognise.
  const [token] = useState(() => newSessionToken());
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const res = await sessionTransport().reclaimTeam({ code, handoffToken, token } as never);
        saveActive(code, { teamToken: res.teamToken, teamName: res.teamName, role: 'player', pin: res.pin });
        rememberTeamCredential(code, { teamToken: res.teamToken, teamName: res.teamName, role: 'player', pin: res.pin });
        // ⚠ THE MODAL, NOT AN IMMEDIATE NAVIGATE, WHEN A CODE CAME BACK. Same
        // "shown once, nothing persists it" rule PlayScreen's own creation
        // path follows — see RecoveryCodeModal. Dismissing it is what
        // proceeds into the game.
        if (res.recoveryCode) setShowRecoveryCode(res.recoveryCode);
        else navigate(`/join/${code}`);
      } catch (e) {
        setError(isSessionError(e) ? e : null);
      }
    })();
  }, [code, handoffToken, token]);

  if (showRecoveryCode) {
    return (
      <RecoveryCodeModal code={showRecoveryCode} onClose={() => navigate(`/join/${code}`)} />
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
        <p className="text-sm font-medium text-slate-800" data-testid="claim-failed">
          {error.code === 'BAD_RECOVERY_CODE'
            ? "This hand-off link is invalid, expired, or was already used."
            : error.message}
        </p>
        <p className="text-xs text-slate-500">
          Ask your host for a new link — this one can&rsquo;t be retried.
        </p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Back to the Lobby
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
      <Loader2 className="animate-spin" size={18} />
      <span className="ml-2 text-sm">Claiming your team…</span>
    </div>
  );
}
