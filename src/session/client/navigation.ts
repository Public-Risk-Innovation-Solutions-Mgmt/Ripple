// ============================================================================
// A ROUTER, KEPT DELIBERATELY SMALL.
//
// Four paths and no nesting, so this is roughly forty lines against a
// dependency, a lockfile change and a bundle. The existing app is a tab-based
// single page that does not route at all; adding a routing library to serve four
// session URLs would put a framework in the tree for one screen's worth of need.
//
// ⚠ THE PATH CARRIES THE ROOM CODE AND THE ROLE, AND BOTH ARE DELIBERATE. The
// code in the path is what makes a refresh return to the same room instead of a
// lobby. The role in the path — /join/CODE against /view/CODE — rather than a
// button on a shared landing page is because THE FAILURE MODES ARE NOT
// SYMMETRIC: landing as a player by accident claims a team and blocks the person
// who was supposed to drive it, while landing as a viewer by accident affects
// nobody. A single link with a role toggle makes the damaging mistake exactly as
// easy as the harmless one.
// ============================================================================

export type Route =
  | { kind: 'lobby' }
  | { kind: 'solo' }
  | { kind: 'host-create' }
  | { kind: 'host-room'; code: string }
  | { kind: 'join'; code: string }
  | { kind: 'view'; code: string }
  | { kind: 'admin' }
  | { kind: 'claim'; code: string; handoffToken: string };

const NAV_EVENT = 'ripple:navigate';

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(p => p.length > 0);

  // ⚠ THE ROOT IS THE LOBBY NOW, AND THE SOLO GAME MOVED TO /solo. It is the
  // one path whose meaning changed: everything else below is untouched, and
  // ANY OTHER unrecognised path still falls through to the solo game, so a
  // deep link into it keeps working.
  //
  // ⚠ THE SOLO GAME ITSELF IS NOT TOUCHED BY THIS — only the door it is behind.
  // Proved rather than asserted: the render harness was repointed from / to
  // /solo and all 262 fingerprints held, which is what says the move is a
  // routing change and not a change to the game.
  if (parts.length === 0) return { kind: 'lobby' };
  if (parts[0] === 'solo' && parts.length === 1) return { kind: 'solo' };

  if (parts[0] === 'host') {
    // Codes are uppercased on the way in so a link typed in lower case still
    // finds the room — the alphabet has no lower-case members.
    if (parts.length === 1) return { kind: 'host-create' };
    return { kind: 'host-room', code: parts[1].toUpperCase() };
  }
  if (parts[0] === 'join' && parts.length >= 2) return { kind: 'join', code: parts[1].toUpperCase() };
  if (parts[0] === 'view' && parts.length >= 2) return { kind: 'view', code: parts[1].toUpperCase() };
  if (parts[0] === 'admin' && parts.length === 1) return { kind: 'admin' };
  // ⚠ THE TOKEN IS NOT UPPERCASED, UNLIKE THE CODE. A room code is read aloud
  // and typed by hand, so it is case-insensitive by design (CODE_ALPHABET has
  // no lower-case members); a hand-off token is an opaque 32-character secret
  // that only ever arrives via a link or a QR scan, never typed, and folding
  // its case could turn a valid token into an invalid one.
  if (parts[0] === 'claim' && parts.length >= 3) {
    return { kind: 'claim', code: parts[1].toUpperCase(), handoffToken: parts[2] };
  }

  // Anything else is the existing single-player game, untouched.
  return { kind: 'solo' };
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event(NAV_EVENT));
}

// Both events matter: popstate for the back button, the custom one for our own
// pushes (pushState deliberately does not fire popstate).
export function onRouteChange(fn: () => void): () => void {
  window.addEventListener('popstate', fn);
  window.addEventListener(NAV_EVENT, fn);
  return () => {
    window.removeEventListener('popstate', fn);
    window.removeEventListener(NAV_EVENT, fn);
  };
}
