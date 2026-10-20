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

import {
  PROPERTY_CATASTROPHE_DEFAULT_OPTION, PROPERTY_CATASTROPHE_OPTIONS, REINSURANCE_DEFAULT_OPTION, REINSURANCE_OPTIONS,
  type ReinsuranceOption,
} from '../data/pricingParameters';
import { REINSURANCE_TOWER, type TowerLayer, type TowerLine } from '../data/reinsuranceTower';
import type { CoverageLine } from '../types/simulation';

/** The aggregate stop-loss level: always none. See the header. */
export const AGGREGATE_NOT_OFFERED = -1;

const LINES: readonly TowerLine[] = ['WC', 'GL', 'Property'];

// ⚠ PROPERTY'S TWO CHOICES TILE TWO DIFFERENT SETS OF LAYERS (Property
// catastrophe cover). Its per-risk packages are cut from the claim-basis layer
// and its catastrophe packages from the event-basis layers; a package may only
// tile layers of its own kind. WC and GL have one kind and one choice.
type Kind = 'package' | 'catastrophe';
const inKind = (kind: Kind) => (l: TowerLayer) =>
  kind === 'catastrophe' ? l.basis === 'event' : l.basis !== 'event';

function placementOf(line: TowerLine, option: ReinsuranceOption, kind: Kind = 'package'): boolean[] {
  const layers = REINSURANCE_TOWER[line];
  if (option.limit === 0) return layers.map(() => false);
  const top = option.attachment + option.limit;
  const mine = inKind(kind);
  const placed = layers.map(l => mine(l) && l.attachment >= option.attachment && l.attachment + l.limit <= top);
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

const PLACEMENT: Record<TowerLine, Map<string, boolean[]>> = {
  WC: new Map(), GL: new Map(), Property: new Map(),
};
for (const line of LINES) {
  for (const option of REINSURANCE_OPTIONS[line]) PLACEMENT[line].set(option.id, placementOf(line, option));
  if (!PLACEMENT[line].has(REINSURANCE_DEFAULT_OPTION[line])) {
    throw new Error(`reinsuranceOptions: ${line}'s default '${REINSURANCE_DEFAULT_OPTION[line]}' is not one of its packages`);
  }
}
const CAT_PLACEMENT = new Map<string, boolean[]>();
for (const option of PROPERTY_CATASTROPHE_OPTIONS) CAT_PLACEMENT.set(option.id, placementOf('Property', option, 'catastrophe'));
if (!CAT_PLACEMENT.has(PROPERTY_CATASTROPHE_DEFAULT_OPTION)) {
  throw new Error(`reinsuranceOptions: Property's catastrophe default '${PROPERTY_CATASTROPHE_DEFAULT_OPTION}' is not one of its options`);
}

const FULL_TOWER: Record<TowerLine, string> = { WC: '', GL: '', Property: '' };
for (const line of LINES) {
  const mine = inKind('package');
  const full = REINSURANCE_OPTIONS[line].find(o => PLACEMENT[line].get(o.id)!.every((p, i) => p || !mine(REINSURANCE_TOWER[line][i])));
  if (!full) throw new Error(`reinsuranceOptions: no ${line} package places the whole tower`);
  FULL_TOWER[line] = full.id;
}
const FULL_CAT = PROPERTY_CATASTROPHE_OPTIONS.find(o => CAT_PLACEMENT.get(o.id)!
  .every((p, i) => p || !inKind('catastrophe')(REINSURANCE_TOWER.Property[i])))?.id ?? 'none';

/** The package that places every layer of the line's tower (Property: its per-risk layer). */
export function fullTowerOption(line: CoverageLine): string {
  return FULL_TOWER[line as TowerLine];
}

/** The packages a line offers, in display order (Property: its per-risk choice). */
export function reinsuranceOptionsFor(line: CoverageLine): readonly ReinsuranceOption[] {
  return REINSURANCE_OPTIONS[line as TowerLine];
}

export function isReinsuranceOption(line: CoverageLine, id: unknown): id is string {
  return typeof id === 'string' && PLACEMENT[line as TowerLine].has(id);
}

export function defaultReinsuranceOption(line: CoverageLine): string {
  return REINSURANCE_DEFAULT_OPTION[line as TowerLine];
}

/** Property's catastrophe options, in display order; none on WC and GL. */
export function catastropheOptionsFor(line: CoverageLine): readonly ReinsuranceOption[] {
  return line === 'Property' ? PROPERTY_CATASTROPHE_OPTIONS : [];
}

export function isCatastropheOption(line: CoverageLine, id: unknown): id is string {
  return line === 'Property' && typeof id === 'string' && CAT_PLACEMENT.has(id);
}

/** Property's default catastrophe cover; undefined on WC and GL, which have none. */
export function defaultCatastropheOption(line: CoverageLine): string | undefined {
  return line === 'Property' ? PROPERTY_CATASTROPHE_DEFAULT_OPTION : undefined;
}

/** The catastrophe option that places every event layer; undefined on WC and GL. */
export function fullCatastropheOption(line: CoverageLine): string | undefined {
  return line === 'Property' ? FULL_CAT : undefined;
}

/**
 * The tower placement a team's choices buy — a fresh array, one boolean per
 * REINSURANCE_TOWER layer. Throws on a package the line does not offer: a
 * misspelt id defaulting to "none" would be a team silently uninsured.
 *
 * On Property the second argument, the catastrophe option, adds the event
 * layers it places to the per-risk layer the package places. ABSENT MEANS NONE:
 * a decision that never chose catastrophe cover holds none, said here once.
 */
export function placementFor(line: CoverageLine, optionId: string, catastropheOptionId?: string): boolean[] {
  const placed = PLACEMENT[line as TowerLine].get(optionId);
  if (!placed) throw new Error(`reinsuranceOptions: '${optionId}' is not a ${line} package`);
  if (line !== 'Property' || catastropheOptionId === undefined) return [...placed];
  const cat = CAT_PLACEMENT.get(catastropheOptionId);
  if (!cat) throw new Error(`reinsuranceOptions: '${catastropheOptionId}' is not a Property catastrophe option`);
  return placed.map((p, i) => p || cat[i]);
}
