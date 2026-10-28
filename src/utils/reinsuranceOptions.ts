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
  SHOCK_T_CLAIM_RANGE, T_COVER_30M_MULTIPLIER, T_COVER_40M_MULTIPLIER, T_COVER_FREQUENCY, type ReinsuranceOption,
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
// most limit: 39 xs 1 on every line (wip/reinsurance-layers), which places every
// layer of the tower — FULL_OCCURRENCE_PLACEMENT is exactly its placement.
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
// EACH OPTION'S PRICE FOR A YEAR — the pricing workbook's method on that
// year's claims (wip/reinsurance-layers; the rule and its reason are at
// T_COVER_FREQUENCY in pricingParameters.ts). `g` is the year's growth factor,
// shockCost.shockCostFactor — the same factor the T claims are drawn at — so
// claims and prices move together; 1 is year 1, 2027.
//
// ⚠ PRICES DO NOT ADD ACROSS LAYERS (the 30M and 40M multipliers), so a price
// belongs to an OPTION, not to its tower layers: a placement is priced as the
// option it is, and each option's placement is unique — checked at load.
// ============================================================================
const LEVELS = ['Low', 'Mid', 'High'] as const;

/** One level's mean T claim on a line in a year: its range's midpoint x the growth factor. */
export const tMeanClaim = (line: CoverageLine, level: typeof LEVELS[number], g: number): number => {
  const [lo, hi] = SHOCK_T_CLAIM_RANGE[line as TowerLine][level];
  return g * (lo + hi) / 2;
};

/** A layer's expected cost: the sum over levels of frequency x min(max(mean claim - attachment, 0), limit). */
export function tLayerExpectedCost(line: CoverageLine, attachment: number, limit: number, g: number): number {
  return LEVELS.reduce((s, lv) => s + T_COVER_FREQUENCY[lv] * Math.min(Math.max(tMeanClaim(line, lv, g) - attachment, 0), limit), 0);
}

/**
 * An option's price for a year: its expected cost, except the 30M layers —
 * 1.25 x the 20M layer from the same attachment — and the 40M layers — 1.2 x
 * the UNMULTIPLIED 30M layer from the same attachment. None costs nothing.
 */
export function tCoverPrice(line: CoverageLine, optionId: string, g = 1): number {
  if (optionId === 'none') return 0;
  const o = REINSURANCE_OPTIONS[line as TowerLine].find(x => x.id === optionId);
  if (!o) throw new Error(`reinsuranceOptions: '${optionId}' is not a ${line} option`);
  if (o.limit === 0) return 0;
  const top = o.attachment + o.limit;
  if (top === 30e6) return T_COVER_30M_MULTIPLIER * tLayerExpectedCost(line, o.attachment, 20e6 - o.attachment, g);
  if (top === 40e6) return T_COVER_40M_MULTIPLIER * tLayerExpectedCost(line, o.attachment, 30e6 - o.attachment, g);
  return tLayerExpectedCost(line, o.attachment, o.limit, g);
}

/** Which option a placement is: the one whose layers it places, exactly; 'none' when it places nothing. */
export function optionOfPlacement(line: TowerLine, placed: readonly boolean[]): string {
  if (!placed.some(Boolean)) return 'none';
  for (const [id, p] of PLACEMENT[line]) if (p.length === placed.length && p.every((on, i) => on === placed[i])) return id;
  throw new Error(`reinsuranceOptions: ${line} placement [${placed.map(Number).join('')}] is not one of its options`);
}
// Each option places its own set of layers — or a placement could not name its price.
for (const line of LINES) {
  const seen = new Map<string, string>();
  for (const [id, p] of PLACEMENT[line]) {
    const key = p.map(Number).join('');
    if (seen.has(key)) throw new Error(`reinsuranceOptions: ${line} '${id}' and '${seen.get(key)}' place the same layers`);
    seen.set(key, id);
  }
}

/** A placement's price for a year: the option it is, priced by tCoverPrice at growth factor `g`. */
export function placementPrice(line: TowerLine, placed: readonly boolean[], g = 1): number {
  return tCoverPrice(line, optionOfPlacement(line, placed), g);
}

/**
 * An option's price for a year — what a player sees beside its name, and what
 * the engine charges: tCoverPrice at the year's growth factor `factor`
 * (shockCost.shockCostFactor; 1 is year 1).
 */
export function optionPrice(line: CoverageLine, optionId: string, factor = 1): number {
  return tCoverPrice(line, optionId, factor);
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
