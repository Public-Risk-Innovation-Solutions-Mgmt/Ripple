// ============================================================================
// ONE REINSURANCE PACKAGE PER LINE — what a team chooses, as the tower reads it.
//
// Loss engine commit 4a. A team picks one package per line from
// REINSURANCE_OPTIONS; the engine, the panel and every display still speak in
// tower placements (one boolean per REINSURANCE_TOWER layer), because that is
// how the cession and its price are computed. This file is the ONE place a
// package becomes a placement.
//
// ⚠ A PACKAGE IS EXACTLY A SET OF WHOLE TOWER LAYERS, AND THAT IS CHECKED AT
// LOAD, NOT ASSUMED. The tower is cut at every package's edges; a package that
// began or ended inside a layer could not be expressed, and this module throws
// the moment the two disagree rather than quietly placing a neighbour.
//
// The old aggregate stop-loss is not a package and is not offered: its level
// is always AGGREGATE_NOT_OFFERED (-1, "none"), and its code is kept unwired.
//
// ⚠ WITH AGGREGATE_STOP ON (stable-scenarios commit 6) THE OPTIONS ARE THE
// STOP'S, NOT THESE PACKAGES. A team's `reinsuranceOption` is then one of
// AGGREGATE_STOP_OPTIONS ('none', 'working', 'bad-year', 'catastrophe'), it
// places no occurrence layer, and the stop is priced and ceded by
// aggregateStop.ts. The packages below stay built and checked, dormant.
// ============================================================================

import {
  AGGREGATE_STOP, AGGREGATE_STOP_DEFAULT, AGGREGATE_STOP_DEFAULT_SHOCKS_OFF, AGGREGATE_STOP_OFFERED_SHOCKS_OFF,
  AGGREGATE_STOP_OPTIONS, REINSURANCE_DEFAULT_OPTION, REINSURANCE_OPTIONS,
  type ReinsuranceOption,
} from '../data/pricingParameters';
import { REINSURANCE_TOWER, type TowerLine } from '../data/reinsuranceTower';
import type { CoverageLine } from '../types/simulation';

/** The aggregate stop-loss level: always none. See the header. */
export const AGGREGATE_NOT_OFFERED = -1;

const LINES: readonly TowerLine[] = ['WC', 'GL', 'Property'];

function placementOf(line: TowerLine, option: ReinsuranceOption): boolean[] {
  const layers = REINSURANCE_TOWER[line];
  if (option.limit === 0) return layers.map(() => false);
  const top = option.attachment + option.limit;
  const placed = layers.map(l => l.attachment >= option.attachment && l.attachment + l.limit <= top);
  // The placed layers must tile the package exactly: start at its attachment,
  // run without a gap, and end at its top.
  let edge = option.attachment;
  for (let i = 0; i < layers.length; i++) {
    if (!placed[i]) continue;
    if (layers[i].attachment !== edge) {
      throw new Error(`reinsuranceOptions: ${line} '${option.id}' is not whole tower layers (gap at $${edge / 1e6}M)`);
    }
    edge = layers[i].attachment + layers[i].limit;
  }
  if (edge !== top) {
    throw new Error(`reinsuranceOptions: ${line} '${option.id}' is not whole tower layers (ends at $${edge / 1e6}M, not $${top / 1e6}M)`);
  }
  return placed;
}

// Built and checked once, at load.
const PLACEMENT: Record<TowerLine, Map<string, boolean[]>> = {
  WC: new Map(), GL: new Map(), Property: new Map(),
};
for (const line of LINES) {
  for (const option of REINSURANCE_OPTIONS[line]) PLACEMENT[line].set(option.id, placementOf(line, option));
  if (!PLACEMENT[line].has(REINSURANCE_DEFAULT_OPTION[line])) {
    throw new Error(`reinsuranceOptions: ${line}'s default '${REINSURANCE_DEFAULT_OPTION[line]}' is not one of its packages`);
  }
}

// The package that places EVERY layer of the line's tower — the widest cover
// a team can buy. Checked at load: a tower re-cut so no package spans it would
// leave scripts that compare "no reinsurance" against "all of it" with no arm.
const FULL_TOWER: Record<TowerLine, string> = { WC: '', GL: '', Property: '' };
for (const line of LINES) {
  const full = REINSURANCE_OPTIONS[line].find(o => PLACEMENT[line].get(o.id)!.every(Boolean));
  if (!full) throw new Error(`reinsuranceOptions: no ${line} package places the whole tower`);
  FULL_TOWER[line] = full.id;
}

/** The widest cover a team can buy: the package placing the whole tower, or the stop's largest. */
export function fullTowerOption(line: CoverageLine): string {
  return AGGREGATE_STOP.enabled ? 'catastrophe' : FULL_TOWER[line as TowerLine];
}

/** The per-claim packages a line offers, in display order (dormant with AGGREGATE_STOP on). */
export function reinsuranceOptionsFor(line: CoverageLine): readonly ReinsuranceOption[] {
  return REINSURANCE_OPTIONS[line as TowerLine];
}

/**
 * The ids a team is OFFERED on a line: the stop's options, or the per-claim
 * packages. While the game's shocks are off (shockLosses.gameShocksOn), only
 * AGGREGATE_STOP_OFFERED_SHOCKS_OFF — None and the Low-attachment cover (id `working`).
 */
export function reinsuranceOptionIds(line: CoverageLine, shocks = true): readonly string[] {
  if (!AGGREGATE_STOP.enabled) return REINSURANCE_OPTIONS[line as TowerLine].map(o => o.id);
  return shocks ? AGGREGATE_STOP_OPTIONS.map(o => o.id) : AGGREGATE_STOP_OFFERED_SHOCKS_OFF;
}

export function isReinsuranceOption(line: CoverageLine, id: unknown): id is string {
  return typeof id === 'string' && (AGGREGATE_STOP.enabled
    ? AGGREGATE_STOP_OPTIONS.some(o => o.id === id)
    : PLACEMENT[line as TowerLine].has(id));
}

/** What a team holds until it chooses, and the prior board plays: None while the game's shocks are off. */
export function defaultReinsuranceOption(line: CoverageLine, shocks = true): string {
  if (!AGGREGATE_STOP.enabled) return REINSURANCE_DEFAULT_OPTION[line as TowerLine];
  return shocks ? AGGREGATE_STOP_DEFAULT : AGGREGATE_STOP_DEFAULT_SHOCKS_OFF;
}

/**
 * The tower placement a package buys — a fresh array, one boolean per
 * REINSURANCE_TOWER layer. Throws on a package the line does not offer: a
 * misspelt id defaulting to "none" would be a team silently uninsured.
 */
export function placementFor(line: CoverageLine, optionId: string): boolean[] {
  // The stop places no occurrence layer: it is ceded on the year's total.
  if (AGGREGATE_STOP.enabled) {
    if (!AGGREGATE_STOP_OPTIONS.some(o => o.id === optionId)) {
      throw new Error(`reinsuranceOptions: '${optionId}' is not an aggregate stop option`);
    }
    return REINSURANCE_TOWER[line as TowerLine].map(() => false);
  }
  const placed = PLACEMENT[line as TowerLine].get(optionId);
  if (!placed) throw new Error(`reinsuranceOptions: '${optionId}' is not a ${line} package`);
  return [...placed];
}
