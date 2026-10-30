// ============================================================================
// THE ROUTE TABLE.
//
// ⚠ THE SOLO GAME IS THE DEFAULT AND IS RENDERED UNCHANGED. Every path that is
// not a session path falls through to App exactly as before, so the existing
// single-player game is reachable, unmodified, and unaffected by any of this.
// The session layer is additive — nothing above it had to be rewritten to make
// room for it.
// ============================================================================

import { useEffect, useState } from 'react';
import App from '../App';
import { onRouteChange, parseRoute, type Route } from './client/navigation';
import AdminScreen from './screens/AdminScreen';
import ClaimScreen from './screens/ClaimScreen';
import HostScreen from './screens/HostScreen';
import LobbyScreen from './screens/LobbyScreen';
import PlayScreen from './screens/PlayScreen';

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => onRouteChange(() => setRoute(parseRoute(window.location.pathname))), []);
  return route;
}

export default function SessionRouter() {
  const route = useRoute();

  switch (route.kind) {
    // ⚠ ONE COMPONENT FOR BOTH HOST ROUTES. They are two states of one tabbed
    // screen — see HostScreen.
    case 'host-create':
      return <HostScreen />;
    case 'host-room':
      return <HostScreen code={route.code} />;
    // ⚠ ONE COMPONENT, TWO ROLES. /view is the player's screen read-only, not a
    // second rendering of the same data — see PlayScreen's header.
    case 'join':
      return <PlayScreen code={route.code} role="player" />;
    case 'view':
      return <PlayScreen code={route.code} role="viewer" />;
    // ⚠ THE LOBBY IS THE ROOT AND THE SOLO GAME IS /solo. App is rendered
    // unchanged by both: the session layer stays additive, and nothing above it
    // was rewritten to make room for the lobby.
    case 'lobby':
      return <LobbyScreen />;
    case 'solo':
      return <App />;
    case 'admin':
      return <AdminScreen />;
    // ⚠ THE HOST'S HALF OF A HAND-OFF LANDS HERE — a one-time link the host
    // shows (HostTeamsTab), not a path anyone types. See ClaimScreen.
    case 'claim':
      return <ClaimScreen code={route.code} handoffToken={route.handoffToken} />;
  }
}
