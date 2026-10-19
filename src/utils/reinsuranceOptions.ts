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
// The aggregate stop-loss is not a package and is not offered: its level is
// always AGGREGATE_NOT_OFFERED (-1, "none"), and its code is kept unwired.
// ============================================================================

import { REINSURANCE_DEFAULT_OPTION, REINSURANCE_OPTIONS, type ReinsuranceOption } from '../data/pricingParameters';
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

/** The package that places every layer of the line's tower. */
export function fullTowerOption(line: CoverageLine): string {
  return FULL_TOWER[line as TowerLine];
}

/** The packages a line offers, in display order. */
export function reinsuranceOptionsFor(line: CoverageLine): readonly ReinsuranceOption[] {
  return REINSURANCE_OPTIONS[line as TowerLine];
}

export function isReinsuranceOption(line: CoverageLine, id: unknown): id is string {
  return typeof id === 'string' && PLACEMENT[line as TowerLine].has(id);
}

export function defaultReinsuranceOption(line: CoverageLine): string {
  return REINSURANCE_DEFAULT_OPTION[line as TowerLine];
}

/**
 * The tower placement a package buys — a fresh array, one boolean per
 * REINSURANCE_TOWER layer. Throws on a package the line does not offer: a
 * misspelt id defaulting to "none" would be a team silently uninsured.
 */
export function placementFor(line: CoverageLine, optionId: string): boolean[] {
  const placed = PLACEMENT[line as TowerLine].get(optionId);
  if (!placed) throw new Error(`reinsuranceOptions: '${optionId}' is not a ${line} package`);
  return [...placed];
}
