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
  AGGREGATE_STOP_OPTIONS, REINSURANCE_DEFAULT_OPTION, REINSURANCE_OFFERED_SHOCKS_OFF, REINSURANCE_OPTIONS,
  REINSURANCE_PRICE, type ReinsuranceOption,
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

// THE WIDEST COVER A TEAM CAN BUY — the option with the highest top, then the
// most limit (38 xs 2 on every line in the wip/shocks build). Since the T
// covers overlap, no one option need place every layer.
const FULL_TOWER: Record<TowerLine, string> = { WC: '', GL: '', Property: '' };
for (const line of LINES) {
  const widest = [...REINSURANCE_OPTIONS[line]]
    .sort((a, b) => (b.attachment + b.limit) - (a.attachment + a.limit) || b.limit - a.limit)[0];
  if (!widest || widest.limit === 0) throw new Error(`reinsuranceOptions: ${line} offers no cover`);
  FULL_TOWER[line] = widest.id;
}

/** The widest cover a team can buy: the widest T cover, or the stop's largest. */
export function fullTowerOption(line: CoverageLine): string {
  return AGGREGATE_STOP.enabled ? 'catastrophe' : FULL_TOWER[line as TowerLine];
}

// ============================================================================
// EACH TOWER LAYER'S FIXED PRICE, derived from the options' fixed prices
// (REINSURANCE_PRICE) and checked at load. The prices add across layers, so a
// layer's price is solved from the options one unknown layer at a time, and
// then every option must equal the sum of its layers' — or the module throws,
// rather than charging a team a price nobody set.
// ============================================================================
const LAYER_PRICE: Record<TowerLine, number[]> = { WC: [], GL: [], Property: [] };
for (const line of LINES) {
  const n = REINSURANCE_TOWER[line].length;
  const price: (number | undefined)[] = new Array(n).fill(undefined);
  const priced = REINSURANCE_OPTIONS[line].filter(o => o.limit > 0)
    .map(o => {
      const p = REINSURANCE_PRICE[line][o.id];
      if (p === undefined) throw new Error(`reinsuranceOptions: no REINSURANCE_PRICE for ${line} '${o.id}'`);
      return { o, p, placed: PLACEMENT[line].get(o.id)! };
    });
  for (let pass = 0; pass < n; pass++) {
    for (const { p, placed } of priced) {
      const unknown = placed.map((on, i) => on && price[i] === undefined ? i : -1).filter(i => i >= 0);
      if (unknown.length !== 1) continue;
      price[unknown[0]] = p - placed.reduce((s, on, i) => s + (on && i !== unknown[0] ? price[i]! : 0), 0);
    }
  }
  LAYER_PRICE[line] = price.map(p => p ?? 0);
  for (const { o, p, placed } of priced) {
    const sum = placed.reduce((s, on, i) => s + (on ? LAYER_PRICE[line][i] : 0), 0);
    if (Math.abs(sum - p) > 0.5 || placed.some((on, i) => on && price[i] === undefined)) {
      throw new Error(`reinsuranceOptions: ${line} '${o.id}' costs $${p} but its layers add to $${sum}`);
    }
  }
}

/** A placement's fixed price a year: the sum of its layers' (LAYER_PRICE). */
export function fixedPlacementPrice(line: TowerLine, placed: readonly boolean[]): number {
  return REINSURANCE_TOWER[line].reduce((s, l, i) => s + (placed[i] && l.purchasable ? LAYER_PRICE[line][i] : 0), 0);
}

/** An option's fixed price a year — what a player sees beside its name. */
export function optionPrice(line: CoverageLine, optionId: string): number {
  return optionId === 'none' ? 0 : REINSURANCE_PRICE[line as TowerLine][optionId] ?? fixedPlacementPrice(line as TowerLine, placementFor(line, optionId));
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
  if (!AGGREGATE_STOP.enabled) return shocks ? REINSURANCE_OPTIONS[line as TowerLine].map(o => o.id) : REINSURANCE_OFFERED_SHOCKS_OFF;
  return shocks ? AGGREGATE_STOP_OPTIONS.map(o => o.id) : AGGREGATE_STOP_OFFERED_SHOCKS_OFF;
}

export function isReinsuranceOption(line: CoverageLine, id: unknown): id is string {
  return typeof id === 'string' && (AGGREGATE_STOP.enabled
    ? AGGREGATE_STOP_OPTIONS.some(o => o.id === id)
    : PLACEMENT[line as TowerLine].has(id));
}

/** What a team holds until it chooses, and the prior board plays: None while the game's shocks are off. */
export function defaultReinsuranceOption(line: CoverageLine, shocks = true): string {
  if (!AGGREGATE_STOP.enabled) return shocks ? REINSURANCE_DEFAULT_OPTION[line as TowerLine] : REINSURANCE_OFFERED_SHOCKS_OFF[0];
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
