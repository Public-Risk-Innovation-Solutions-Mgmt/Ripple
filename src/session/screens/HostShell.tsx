// ============================================================================
// THE HOST SCREEN'S TAB CHROME.
//
// ⚠ BUILT FOR THE TABS THAT ARE NOT HERE YET. Today there is exactly one —
// Game Setup — and a single tab is not worth a component. The point is that the
// NEXT one is a row in HOST_TABS and a case in the caller's switch, rather than
// a restructure of a screen that had grown around the assumption of being
// alone. Retrofitting tabs onto a settled layout is how a screen ends up with
// one privileged view and several afterthoughts.
//
// ⚠ IT SPANS BOTH HOST ROUTES DELIBERATELY. /host (no room yet) and /host/CODE
// (a room running) are two states of one screen, not two screens: the host
// configures, creates, and then runs, without the chrome changing under them.
// The tab strip is disabled before a room exists for the tabs that need one,
// which is the same pattern GameShell already uses for the player's tabs before
// a game is started.
// ============================================================================

import React from 'react';
import { Home, Shield } from 'lucide-react';
import { HOST_TABS, type HostTabId } from './hostTabs';
import { navigate } from '../client/navigation';
import RippleBrandLogo from '../../components/RippleBrandLogo';
import type { WalkthroughHeader } from '../../utils/yearWalkthrough';

interface Props {
  activeTab: HostTabId;
  onSelectTab: (t: HostTabId) => void;
  /** False on /host, where no room has been created yet. */
  hasRoom: boolean;
  /** The room code, shown in the bar once there is one. */
  code?: string;
  eventName?: string;
  /**
   * The game's version and the room's fixed seed, once there is a room — the
   * host sees the seed, as Test player does (utils/yearWalkthrough); a team
   * never does.
   */
  version?: WalkthroughHeader;
  children: React.ReactNode;
}

export default function HostShell({ activeTab, onSelectTab, hasRoom, code, eventName, version, children }: Props) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50/30">
      <header className="border-b border-slate-200 bg-white">
        {/* ⚠ ONE ROW ON A PHONE AS ON A DESKTOP: the logo, the event and its
            details, the two links. The details are a small line under the event
            name rather than their own rows, and on a phone the links are icons
            (their names kept for screen readers and as tooltips) — so the logo
            does not add a row to a bar that already wrapped into five. */}
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex min-w-0 items-center gap-3">
            {/* The full logo, no tile: the bar is white, as the logo's own background is. */}
            <RippleBrandLogo className="h-12 sm:h-14" />
            <span className="hidden h-10 w-px bg-slate-200 sm:block" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-slate-800 sm:text-lg">
                {eventName || 'Host a session'}
              </h1>
              {(code || version) && (
                <p className="flex flex-wrap items-baseline gap-x-3 text-xs sm:text-sm">
                  {code && (
                    <span className="text-black">
                      room <span className="font-mono font-medium text-black">{code}</span>
                    </span>
                  )}
                  {version && (
                    <span data-testid="host-version-header" className="text-slate-400">
                      version <span data-testid="host-version" className="font-mono text-black">{version.version}</span>
                      {version.scenario !== undefined && (
                        <> · scenario <span data-testid="host-scenario" className="font-mono text-black">{version.scenario}</span></>
                      )}
                      {version.seed !== undefined && (
                        <> · seed <span data-testid="host-seed" className="font-mono text-black">{version.seed}</span></>
                      )}
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3 sm:gap-4">
            {/* ⚠ MAIN PAGE, NOT LOG OUT. Just navigates to the lobby — the
                admin session stays signed in, same distinction AdminScreen's
                own "Main page" vs. "Log out" buttons make. */}
            <button
              type="button"
              data-testid="host-main-page-link"
              onClick={() => navigate('/')}
              title="Main page"
              className="flex items-center gap-1.5 text-sm text-black hover:text-black"
            >
              <Home size={16} /> <span className="sr-only sm:not-sr-only">Main page</span>
            </button>
            <button
              type="button"
              data-testid="host-admin-link"
              onClick={() => navigate('/admin')}
              title="Admin"
              className="flex items-center gap-1.5 text-sm text-black hover:text-black"
            >
              <Shield size={16} /> <span className="sr-only sm:not-sr-only">Admin</span>
            </button>
          </div>
        </div>
        {/* ⚠ THE TABS SCROLL IN THEIR OWN STRIP. Left to lay out at their natural
            width, the four ran 441px on a 390px phone and widened the whole page:
            the browser then laid the page out wider and taller than the screen it
            showed, and a tap on Create room — scrolled into view by the wider
            layout, below the visible screen — landed on the Shock schedule's
            Event row above it instead. */}
        <nav className="mx-auto flex max-w-screen-2xl gap-1 overflow-x-auto px-4 pt-3 sm:px-6">
          {HOST_TABS.map(t => {
            const disabled = !!t.needsRoom && !hasRoom;
            const active = t.id === activeTab;
            return (
              <button
                key={t.id}
                type="button"
                data-testid={`host-tab-${t.id}`}
                disabled={disabled}
                onClick={() => onSelectTab(t.id)}
                className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-700'
                    : disabled
                      ? 'border-transparent text-slate-300'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <span className={active ? 'text-blue-600' : 'text-black'}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
