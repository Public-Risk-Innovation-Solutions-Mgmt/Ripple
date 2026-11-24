// ============================================================================
// DECISIONS ACROSS THE WIRE.
//
// ⚠ THE SESSION LAYER NEVER INTERPRETS A DecisionSet. It is carried as an opaque
// JsonValue from submit to read and back, and this file is the ONLY place that
// knows the two are the same thing. That is deliberate: the moment the transport
// understood the engine's decision shape, every engine change would become a
// session-layer change too.
//
// ⚠ NOTHING CARRIES FORWARD ANY MORE. Every decision resets at the start of
// each new round (utils/decisionDefaults resetDecisionSet), so a year a team
// LOCKED is played on that year's own set, and a year it did NOT lock is played
// on the reset (roundStartDecisions — every round, year 1 included). It used to
// be played on the most
// recent lock before it; a missed deadline now plays the reset, and the market
// counts the team at the rate the reset strikes (the round-start market input
// its client posts with the previous year's result — contract SubmitRequest).
// ============================================================================

import { defaultDecisionSet, roundStartDecisions } from '../../utils/decisionDefaults';
import type { DecisionSet } from '../../types/simulation';
import type { JsonValue } from '../contract';

export type DecisionHistory = Record<string, JsonValue>;

// A DecisionSet is plain data — numbers, strings, nulls, arrays and nested
// objects. The round trip both converts it and asserts that, so a field that
// ever stops being JSON-safe fails here rather than silently crossing a real
// network as undefined.
export function decisionsToJson(d: DecisionSet): JsonValue {
  return JSON.parse(JSON.stringify(d)) as JsonValue;
}

export function decisionsFromJson(v: JsonValue): DecisionSet {
  return JSON.parse(JSON.stringify(v)) as DecisionSet;
}

/**
 * The year whose LOCKED decisions govern `yearNumber`: that year if it was
 * locked, otherwise none — a year that was not locked plays its round's
 * starting values (decisionsForYear), never an earlier lock.
 *
 * `reset` is the room's RoomView.decisionReset. A room created before the reset
 * (false) keeps its old rule — the most recent lock at or before the year — so
 * its replays stay what they were.
 *
 * Exported because "a missed year is played on the reset, not the last lock
 * before it" is worth testing directly rather than only through its effects.
 */
export function governingYear(yearNumber: number, history: DecisionHistory | undefined, reset = true): number | null {
  if (!history) return null;
  if (reset) return history[String(yearNumber)] !== undefined ? yearNumber : null;
  let best: number | null = null;
  for (const key of Object.keys(history)) {
    const y = Number(key);
    if (!Number.isFinite(y) || y > yearNumber) continue;
    if (best === null || y > best) best = y;
  }
  return best;
}

/**
 * What a team was playing in `yearNumber`: its locked set for that year, or the
 * round's starting values if it did not lock it (roundStartDecisions — the
 * reset, every round, year 1 included). In a room from before the reset (`reset` false), an
 * unlocked year plays the last lock before it, or the defaults if none.
 *
 * The locked set is RE-STAMPED with the target year rather than used as-is: the
 * engine reads DecisionSet.yearNumber, and handing it another year's number
 * would be a quietly wrong input rather than a loud one.
 */
export function decisionsForYear(
  yearNumber: number, history: DecisionHistory | undefined,
  /** The room's shock switch (shockLosses.gameShocksOn): the default cover is None while it is off. Absent is on. */
  shocks = true,
  /** The room's RoomView.decisionReset. Absent is on: every room from the reset on. */
  reset = true,
): DecisionSet {
  const governing = governingYear(yearNumber, history, reset);
  if (governing === null) return reset ? roundStartDecisions(yearNumber, shocks) : defaultDecisionSet(yearNumber, shocks);
  const d = decisionsFromJson(history![String(governing)]);
  return { ...d, yearNumber };
}
