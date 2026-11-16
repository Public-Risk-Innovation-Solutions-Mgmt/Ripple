// ============================================================================
// A GAME'S SHOCK SCHEDULE — drawn ONCE, when the game is made, and written into
// its record as concrete entries: the room for a host, the save for a solo
// game. Every world reads that list, so every world faces the same events in
// the same years; only each firing's severity is drawn per world (shockLosses,
// keyed on the world's seed).
//
// ⚠ THERE ARE EXACTLY TWO CALLERS, AND WHEN THEY CALL IS THE WHOLE RULE.
// The host's Randomise (session/shockDraw, at room creation) and the solo
// game's start (soloGame). Not the engine, not per year, not per world, not a
// team's client. A draw anywhere downstream of the record would make agreement
// a matter of every caller computing identically, which is the property this
// design exists not to depend on.
//
// ⚠ AND IT IS STILL REPRODUCIBLE. The draw is a pure function of the seed
// string, the year count and the stream's purpose label, so a schedule can be
// re-derived from the record alone and checked against it. Each caller has its
// own label, so it shares no stream with the game or with the other: the seed
// that builds the instance also seeds this, without either moving the other.
//
// ⚠ PRICING NEVER READS IT. Reinsurance and every expected-loss figure use the
// catalogue's probabilities (shockExpectation) — a team prices the risk, not
// the draw it does not know.
// ============================================================================

import { SHOCK_EVENTS, SHOCK_EVENT_LABELS } from './shockLosses';
import { SHOCK_SCHEDULE_SPREAD, SHOCKS_PER_YEAR } from '../data/pricingParameters';
import { deriveSubRng } from './random';
import { seedFromInstanceId } from '../seedHash';
import type { ScheduledShock } from '../types/shocks';

/** One event a schedule can hold, as the host's screens name it. */
export interface DrawableShock {
  id: string;
  name: string;
  eventName: string;
  /** The R model's annual probability — the draw's weight. */
  probability: number;
}

// ⚠ ALL TWELVE, AND WEIGHTED BY THE CATALOGUE'S OWN PROBABILITY. Loss engine
// commit 3b retired the old catalogue, which only "built" six of the twelve and
// weighted them by a severity band. Every one of the R model's events now runs,
// so every one can be drawn, and a frequent event (Economic Inflation, 10% a
// year) comes up more often than a rare one (Earthquake, 0.2%). Fixed order, by
// id, so the draw does not depend on how anything happens to be ordered.
export function drawableShocks(): DrawableShock[] {
  return SHOCK_EVENTS
    .map(e => ({
      id: e.id,
      name: SHOCK_EVENT_LABELS[e.id]?.name ?? e.name,
      eventName: SHOCK_EVENT_LABELS[e.id]?.eventName ?? e.name,
      probability: e.probability,
    }))
    // Numeric by id, not lexicographic: '#10' sorts after '#9', not after '#1'.
    .sort((a, b) => idNumber(a.id) - idNumber(b.id));
}

/** '#10' -> 10. Non-numeric ids sort last, stably, rather than throwing. */
function idNumber(id: string): number {
  const n = Number(id.replace('#', ''));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

// THE COUNT (stable-scenarios commit 5): round(SHOCKS_PER_YEAR x years), then
// −1, 0 or +1 (SHOCK_SCHEDULE_SPREAD), equally likely, and never none — 2 to 4
// in a ten-year game. A randomise that could return an empty schedule would read
// to a host as a button that did nothing. The range is capped at one event a
// year from year 2.
export function shockDrawRange(yearCount: number): { min: number; max: number } {
  if (yearCount < 1) return { min: 0, max: 0 };
  const centre = Math.round(SHOCKS_PER_YEAR * yearCount);
  const room = Math.max(1, yearCount - 1);
  const clamp = (n: number) => Math.min(room, Math.max(1, n));
  return { min: clamp(centre - SHOCK_SCHEDULE_SPREAD), max: clamp(centre + SHOCK_SCHEDULE_SPREAD) };
}

/** The count for one draw: the centre plus an offset from −spread to +spread, read off `u` in [0, 1). */
export function shockDrawCount(yearCount: number, u: number): number {
  if (yearCount < 1) return 0;
  const centre = Math.round(SHOCKS_PER_YEAR * yearCount);
  const offset = Math.floor(u * (2 * SHOCK_SCHEDULE_SPREAD + 1)) - SHOCK_SCHEDULE_SPREAD;
  const { min, max } = shockDrawRange(yearCount);
  return Math.min(max, Math.max(min, centre + offset));
}

/** The purpose labels: one stream per caller. */
export const HOST_SHOCK_STREAM = 'host_shock_schedule';
export const SOLO_SHOCK_STREAM = 'solo_shock_schedule';

export function drawShockSchedule(seed: string, yearCount: number, stream: string): ScheduledShock[] {
  const rng = deriveSubRng(seedFromInstanceId(seed), yearCount, stream);

  // YEARS: distinct — at most one event per year, the rule in docs/PHASES.md —
  // and never year 1 when the game has another, so every team makes one full
  // round of decisions before anything lands on it.
  const years = yearCount >= 2
    ? Array.from({ length: yearCount - 1 }, (_, i) => i + 2)
    : yearCount === 1 ? [1] : [];
  const events = drawableShocks();
  // The count's offset is the stream's FIRST draw, so the years and events
  // below follow it on the same stream.
  const count = Math.min(shockDrawCount(yearCount, rng.next()), years.length, events.length);

  // Partial Fisher-Yates on the years.
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng.next() * (years.length - i));
    [years[i], years[j]] = [years[j], years[i]];
  }
  const chosenYears = years.slice(0, count).sort((a, b) => a - b);

  // EVENTS: weighted by probability, WITHOUT replacement — no event twice in
  // one schedule. A repeat of the same named event inside a short game reads as
  // a bug to a room, and with twelve events and at most seven draws (a 20-year
  // game) there is always a fresh one to take. The weights are the scaled
  // probabilities; scaling all twelve alike leaves the draw's odds unchanged.
  const pool = events.map(def => ({ def, w: def.probability }));
  const chosen: DrawableShock[] = [];
  for (let i = 0; i < count; i++) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let u = rng.next() * total;
    let k = 0;
    for (; k < pool.length - 1; k++) { u -= pool[k].w; if (u < 0) break; }
    chosen.push(pool[k].def);
    pool.splice(k, 1);
  }

  return chosenYears.map((yearNumber, i) => ({ shockId: chosen[i].id, yearNumber }));
}

/**
 * SINGLE-PLAYER'S DRAW AT THE CATALOGUE'S ODDS (SOLO_SHOCK_DRAW 'catalogue',
 * wip/shocks test build): each year from year 2, each of the twelve events
 * fires with its scaled catalogue probability, independently — so a year can
 * hold none, one, or more. Year 1 is shock-free. One stream, from the game
 * seed, drawn once; a pure function of the seed string, the year count and
 * the label, like drawShockSchedule.
 */
export function drawCatalogueSchedule(seed: string, yearCount: number, stream: string): ScheduledShock[] {
  const rng = deriveSubRng(seedFromInstanceId(seed), yearCount, stream);
  const events = drawableShocks();
  const out: ScheduledShock[] = [];
  // Every draw is taken, fired or not, so one event's firing cannot move another's.
  for (let yearNumber = 2; yearNumber <= yearCount; yearNumber++) {
    for (const e of events) if (rng.next() < e.probability) out.push({ shockId: e.id, yearNumber });
  }
  return out;
}
