// ============================================================================
// THE HOST SCREEN — the tab shell, and which tab is showing.
//
// ⚠ ONE SCREEN, TWO STATES, NOT TWO SCREENS. /host has no room yet and
// /host/CODE has one; the chrome does not change under the host as they move
// between them, because configuring and then running is one task. This is the
// component that will grow a switch as tabs land — today it has one case, and
// that is the point: the next tab is a row in HOST_TABS and a case here.
//
// ⚠ HOSTING REQUIRES AN ADMIN SESSION. Both /host and /host/CODE render the
// login modal in place of the shell when nobody is logged in as admin, rather
// than bouncing to the lobby — the point of hosting from here is to land on
// this screen, not to go looking for a login elsewhere. See adminAuth.ts for
// what "admin" means today (nothing beyond this gate).
// ============================================================================

import { useEffect, useState } from 'react';
import AdminLoginModal from './AdminLoginModal';
import HostShell from './HostShell';
import { type HostTabId } from './hostTabs';
import HostCreateScreen from './HostCreateScreen';
import HostRoomScreen from './HostRoomScreen';
import HostTeamsTab from './HostTeamsTab';
import HostChartsTab from './HostChartsTab';
import HostDecisionsTab from './HostDecisionsTab';
import { useRoom } from '../client/useRoom';
import { SESSION_POLL_INTERVAL_MS } from '../../data/pricingParameters';
import { loadActive, loadHeld } from '../client/identity';
import { currentAdmin } from '../../admin/client/adminAuth';
import { gameIdentity } from '../../utils/scenarios';
import { walkthroughHeader } from '../../utils/yearWalkthrough';

interface Props {
  /** Absent on /host, where the room does not exist yet. */
  code?: string;
}

export default function HostScreen({ code }: Props) {
  const [activeTab, setActiveTab] = useState<HostTabId>('setup');

  // undefined = not checked yet; null = checked, nobody logged in as admin.
  const [admin, setAdmin] = useState<string | null | undefined>(undefined);
  async function recheckAdmin() {
    setAdmin(await currentAdmin());
  }
  useEffect(() => { void recheckAdmin(); }, []);

  // Read only to title the bar; HostRoomScreen does its own polling and owns
  // every action. A second reader is cheap (the poll is shared per code) and
  // keeps the chrome from having to be told what the room is called.
  const hostToken = code ? (loadActive(code).hostToken ?? loadHeld(code).hostToken) : undefined;
  const { room } = useRoom(code ?? '', hostToken, code ? SESSION_POLL_INTERVAL_MS : 3_600_000);

  if (admin === undefined) return null;
  if (admin === null) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AdminLoginModal onClose={() => { void recheckAdmin(); }} onSuccess={() => { void recheckAdmin(); }} />
      </div>
    );
  }

  return (
    <HostShell
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      hasRoom={!!code}
      code={code}
      eventName={code ? room?.eventName : undefined}
      // The host sees the room's fixed seed beside the version (a team never does).
      version={code && room ? (() => {
        const id = gameIdentity(room.seed);
        return walkthroughHeader({ instanceId: id.gameId, scenario: id.scenario }, true);
      })() : undefined}
    >
      {activeTab === 'setup' && (code ? <HostRoomScreen code={code} /> : <HostCreateScreen />)}
      {activeTab === 'teams' && (
        room
          ? <HostTeamsTab room={room} />
          : <p className="text-sm text-slate-400">Loading room…</p>
      )}
      {activeTab === 'charts' && (
        room
          ? <HostChartsTab room={room} />
          : <p className="text-sm text-slate-400">Loading room…</p>
      )}
      {activeTab === 'decisions' && (
        room
          ? <HostDecisionsTab room={room} />
          : <p className="text-sm text-slate-400">Loading room…</p>
      )}
    </HostShell>
  );
}
