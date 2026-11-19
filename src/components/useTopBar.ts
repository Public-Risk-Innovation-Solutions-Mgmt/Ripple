// ============================================================================
// THE TOP BAR'S HEIGHT, SHARED — and whether it is compact.
//
// The bar is taller at the top of the page, so the logo (and its "Powered by
// PRISM") can be read, and shrinks to its old height once the page is scrolled,
// growing back at the top. Two things follow from a bar whose height changes:
//
//   1. --top-bar-h. Everything that sticks below the bar (the tab strips, the
//      Annual Statement's index, the host's inner tab strips) must sit under it
//      at both heights, so the bar's live height is published on <html> as a
//      CSS variable, measured by a ResizeObserver — through the shrink's
//      transition too — rather than assumed.
//   2. compact. Shrinking moves the page's content up by the difference, which
//      at a single threshold would push the scroll back across it and flicker.
//      So it shrinks past COMPACT_AT and grows back only under EXPAND_BELOW.
//
// Used by the game's Header (single player, Test player, teams, viewers) and
// the host's HostShell — one bar on a page at a time.
// ============================================================================
import { useEffect, useRef, useState } from 'react';

/** Scrolled further than this, the bar is compact... */
export const COMPACT_AT = 40;
/** ...and it grows back only once the page is within this of the top. */
export const EXPAND_BELOW = 4;

export function useTopBar<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const onScroll = () => setCompact(c => (c ? window.scrollY > EXPAND_BELOW : window.scrollY > COMPACT_AT));
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--top-bar-h', `${el.getBoundingClientRect().height}px`);
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    window.addEventListener('resize', publish);
    return () => { ro?.disconnect(); window.removeEventListener('resize', publish); root.style.removeProperty('--top-bar-h'); };
  }, []);

  return { ref, compact };
}

/** Desktop and tablet (Tailwind's sm and up): the bar grows at the top and shrinks on scroll. A phone keeps today's bar. */
export function useWide(): boolean {
  const query = '(min-width: 640px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}
