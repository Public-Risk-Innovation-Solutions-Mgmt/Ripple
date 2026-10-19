// ============================================================================
// THE HOST'S RANDOMISED SHOCK SCHEDULE — drawn ONCE, at room creation, by the
// host's client, and written into the room as concrete entries.
//
// ⚠ THIS IS THE ONE PLACE A SHOCK SCHEDULE IS EVER DRAWN, AND WHERE IT IS
// CALLED FROM IS THE WHOLE RULE. HostCreateScreen calls it; nothing else may.
// Not a player's client, not the engine, not per year. The room record carries
// the result as a plain list and every team's build reads THAT list
// (buildGame.ts -> generateGameInstance), so every team faces the same
// schedule because they all read the same record — not because they all ran the
// same draw. A draw anywhere downstream of the room would make agreement a
// matter of every client computing identically, which is the property this
// design exists not to depend on.
//
// ⚠ AND IT IS STILL REPRODUCIBLE. The draw is a pure function of the room's
// seed and year count, both of which the room record holds, so the schedule a
// room carries can be re-derived from the record alone and checked against it.
// It is keyed on its own purpose label, so it shares no stream with the game:
// the seed that builds the instance also seeds this, without either moving the
// other.
// ============================================================================

import { SHOCK_EVENTS, SHOCK_EVENT_LABELS } from '../utils/shockLosses';
import { deriveSubRng } from '../utils/random';
import { seedFromInstanceId } from '../seedHash';
import type { ScheduledShockSpec } from './contract';

/** One event a host can schedule, as the host's screens name it. */
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
// year) comes up more often than a rare one (Earthquake, 0.2%) — the same odds
// a singleplayer game fires them at. Fixed order, by id, so the draw does not
// depend on how anything happens to be ordered.
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

// ONE EVENT PER THREE YEARS, rounded, and never none: 3 years -> 1, 5 -> 2,
// 10 -> 3, 20 -> 7. A randomise that could return an empty schedule would read
// to a host as a button that did nothing.
export function shockDrawCount(yearCount: number): number {
  return yearCount >= 1 ? Math.max(1, Math.round(yearCount / 3)) : 0;
}

export function drawShockSchedule(roomSeed: string, yearCount: number): ScheduledShockSpec[] {
  const rng = deriveSubRng(seedFromInstanceId(roomSeed), yearCount, 'host_shock_schedule');

  // YEARS: distinct — at most one event per year, the rule in docs/PHASES.md —
  // and never year 1 when the game has another, so every team makes one full
  // round of decisions before anything lands on it.
  const years = yearCount >= 2
    ? Array.from({ length: yearCount - 1 }, (_, i) => i + 2)
    : yearCount === 1 ? [1] : [];
  const events = drawableShocks();
  const count = Math.min(shockDrawCount(yearCount), years.length, events.length);

  // Partial Fisher-Yates on the years.
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng.next() * (years.length - i));
    [years[i], years[j]] = [years[j], years[i]];
  }
  const chosenYears = years.slice(0, count).sort((a, b) => a - b);

  // EVENTS: weighted by probability, WITHOUT replacement — no event twice in
  // one schedule. A repeat of the same named event inside a short game reads as
  // a bug to a room, and with twelve events and at most seven draws (a 20-year
  // game) there is always a fresh one to take.
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
