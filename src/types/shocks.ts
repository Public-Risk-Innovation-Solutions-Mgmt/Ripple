// SHOCK EVENTS — what a schedule names, and what a fired event records.
//
// The events themselves are the R model's twelve (SHOCK_EVENTS in
// src/utils/shockLosses.ts), and what they do is that file's. Loss engine
// commit 3b deleted the old effect vocabulary, its catalogue and its resolver:
// placeholders the new engine never ran. What remains here is the shape a host
// schedules and the shape a result records, which the screens, the exports and
// the session contract read.

import type { CoverageLine, Region } from './simulation';

export type ShockHorizon = 'current' | 'future';
export type ShockBand = 'moderate' | 'high' | 'severe';

// What an instance carries. Absent by default — see GameInstance.scheduledShocks
// and the byte-identity note there.
export interface ScheduledShock {
  shockId: string;
  yearNumber: number;
  /**
   * WHERE A REGIONAL EVENT STRIKES — resolved ONCE, when the game's instance is
   * built (generateGameInstance), so every world's earthquake hits the same
   * region; only its size is drawn per world. Absent on a non-regional event,
   * on the room record (the server keeps id and year; every team resolves the
   * same region from the same seed and list), and on a save from before it.
   */
  region?: Region;
}

// ---------------------------------------------------------------------------
// Recording. A shock that changes the numbers invisibly is worse than no shock.
// ---------------------------------------------------------------------------

// What fired, known BEFORE the year is drawn.
export interface ShockFiring {
  shockId: string;
  name: string;
  // The player's name for it and the region it struck, if it struck one.
  // OPTIONAL because a save written before they existed carries neither.
  eventName?: string;
  region?: Region;
  band: ShockBand;
  horizon: ShockHorizon;
  description: string;
  yearFired: number;        // the year the event fired (may be < the result year, for future-horizon)
  linesAffected: CoverageLine[];
  // Empty on every new-engine firing; a save from the old engine carries the
  // effects it applied, by kind.
  effects: { kind: string; detail: string }[];
}

// What it cost, known AFTER.
export interface ShockLineCost {
  attributableGrossLoss: number;
  attributableClaims: number;
  expectedGrossLossAdded: number;
}

export interface ShockRecord extends ShockFiring, ShockLineCost {
  // THE PER-LINE SPLIT, on the POOL record only. mergeShockRecords sums each
  // line's record into one row per event, and this keeps what each line
  // contributed — the Property and WC halves of one earthquake — rather than
  // folding it into the total. Absent on a line's own record, which is one line.
  byLine?: Partial<Record<CoverageLine, ShockLineCost>>;
  /**
   * On an AVERAGED row (loss engine commit 4b): how many of the year's worlds
   * the event fired in. Its dollars and claim counts are then the average over
   * ALL the worlds, counting zero where it did not fire. Absent on a world's own row.
   */
  worlds?: { fired: number; of: number };
}
