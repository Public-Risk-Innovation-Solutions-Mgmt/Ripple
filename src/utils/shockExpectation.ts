// ============================================================================
// WHAT THE NEW LOSS ENGINE EXPECTS, EX ANTE — the shocks at the catalogue's
// probabilities, and routine large losses when that switch is on.
//
// Part of the new loss engine, which runs whenever MEMBER_LEVEL is off. Every figure here is an expectation over the
// SAME draw shockLosses.ts makes — the same events, levels, counts, CVs,
// scale, pool limit and occurrence grouping — integrated in closed form
// rather than simulated, so the rate and the reinsurance price are
// statements about the losses the engine actually generates:
//
//   expected ceded       = the expected recovery on the new engine's large
//                          losses, layer by layer
//   reinsurance price    = that x the line's CLF at 70% (reinsuranceTower.ts)
//
// ⚠ EX ANTE MEANS EX ANTE. Pricing does not know a host's schedule, or which
// events are already in force: every year is priced at the catalogue's
// probabilities. The one thing it does know is the rule that nothing fires
// before year 1, so an A that can only have started since then is counted
// over the years it could have had — year 1 carries no inherited A, year 3
// carries up to two years of decay.
//
// ⚠ ONE APPROXIMATION, STATED. Earthquake and Wildfire are one occurrence
// each, so the tower sees the SUM of their losses. That sum is priced as a
// lognormal with the sum's own mean and CV (Fenton-Wilkinson). The draw sums
// the individual lognormals exactly; shock-loss-check measures the gap.
// ============================================================================

import { PROPERTY_PERIL_DEDUCTIBLE, REINSURANCE_TOWER, type TowerLine } from '../data/reinsuranceTower';
import {
  ORDINARY_LOSS_CV, POOL_LIMIT_PER_OCCURRENCE, R_MODEL, REGION_EXPOSURE_SHARE, ROUTINE_LARGE_LOSSES,
  SHOCK_LOSS_COUNT, SHOCK_LOSS_CV, SHOCK_ONE_OCCURRENCE,
} from '../data/pricingParameters';
import { pwlMoments, lognormalFromMean, routineExpectation, routineLargeBasis, routineLargeCount } from './largeLosses';
import { ordinaryLossCostPer100 } from './ordinaryLoss';
import { DECAY, SHOCK_EVENTS, eventLines, poolShare, tScale, trendFactor, type ShockLevel } from './shockLosses';
import type { CoverageLine } from '../types/simulation';

// --- quadrature over the uniform T ------------------------------------------
// 24-point Gauss-Legendre on [-1, 1], by Newton on P_n. T is smooth in every
// integrand here, so this is exact to well past what any gate can resolve.
const GL_N = 24;
const GL_NODES: number[] = [];
const GL_WEIGHTS: number[] = [];
for (let i = 1; i <= GL_N; i++) {
  let x = Math.cos(Math.PI * (i - 0.25) / (GL_N + 0.5));
  let dp = 0;
  for (let iter = 0; iter < 100; iter++) {
    let p0 = 1, p1 = x;
    for (let k = 2; k <= GL_N; k++) { const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
    dp = GL_N * (x * p1 - p0) / (x * x - 1);
    const dx = p1 / dp;
    x -= dx;
    if (Math.abs(dx) < 1e-15) break;
  }
  GL_NODES.push(x);
  GL_WEIGHTS.push(2 / ((1 - x * x) * dp * dp));
}
/** E[f(U)] for U uniform on [lo, hi]. */
function overUniform(lo: number, hi: number, f: (t: number) => number): number {
  if (!(hi > lo)) return f(lo);
  let s = 0;
  for (let i = 0; i < GL_N; i++) s += GL_WEIGHTS[i] * f((hi + lo) / 2 + ((hi - lo) / 2) * GL_NODES[i]);
  return s / 2;
}

// --- the uplift on ordinary losses -----------------------------------------

/**
 * E[U] and E[U^2] for the year's total uplift on ordinary losses — every A on
 * the shock map plus Economic Inflation, over firings since year 1. Each
 * firing-year is an independent Bernoulli, so the moments add.
 */
export function upliftMoments(line: CoverageLine, yearNumber: number): {
  mean: number; second: number; byEvent: Map<string, number>;
} {
  const byEvent = new Map<string, number>();
  let mean = 0, variance = 0;
  if (yearNumber < 1) return { mean: 0, second: 0, byEvent };
  const shares = Object.values(REGION_EXPOSURE_SHARE[line]);
  const sMean = shares.reduce((a, b) => a + b, 0) / shares.length;
  const sSecond = shares.reduce((a, b) => a + b * b, 0) / shares.length;
  for (const e of SHOCK_EVENTS) {
    const rows: { m1: number; m2: number }[] = [];
    if (e.name === 'Economic Inflation') {
      const a = R_MODEL.economicInflationInitialRate;
      rows.push({ m1: a, m2: a * a });
    }
    for (const row of eventLines(e.name)) {
      if (row.line !== line || row.a === 'None') continue;
      const [lo, hi] = R_MODEL.aShock[line][row.a];
      const s1 = e.regional ? sMean : 1, s2 = e.regional ? sSecond : 1;
      rows.push({ m1: ((lo + hi) / 2) * s1, m2: ((lo * lo + lo * hi + hi * hi) / 3) * s2 });
    }
    if (rows.length === 0) continue;
    let contribution = 0;
    for (let age = 0; age < Math.min(e.duration, yearNumber); age++) {
      const d = Math.pow(DECAY, age);
      for (const r of rows) {
        contribution += e.probability * r.m1 * d;
        variance += e.probability * r.m2 * d * d - Math.pow(e.probability * r.m1 * d, 2);
      }
    }
    byEvent.set(e.name, contribution);
    mean += contribution;
  }
  return { mean, second: variance + mean * mean, byEvent };
}

// --- large losses: one engine for every function of them --------------------

export type PerLoss = (x: number, deductible: number) => number;

interface LargeMoments {
  mean: number;
  variance: number;
  /** Expected occurrences — the count the tower sees. */
  occurrences: number;
  byEvent: Map<string, number>;
  routine: number;
}

/**
 * GIVEN THAT AN EVENT ARRIVES THIS YEAR, E and E[^2] of SUM h(loss) over its T
 * losses on a line — or null if its T does not reach the line. The annual
 * figure is this times the event's probability, summed over events, so
 * shock-loss-check can hold each event's draw to its own expectation without
 * waiting for a 0.2% earthquake to happen often enough to measure.
 */
export function conditionalEventMoments(
  line: CoverageLine, eventName: string, exposure: number, yearNumber: number,
  h: PerLoss, kinks: (deductible: number) => number[],
): { c1: number; c2: number; occurrences: number } | null {
  const row = eventLines(eventName).find(r => r.line === line && r.t !== 'None');
  if (!row) return null;
  const scale = tScale(line, exposure, yearNumber);
  const n = SHOCK_LOSS_COUNT[eventName]?.[line] ?? 0;
  const one = SHOCK_ONE_OCCURRENCE.includes(eventName);
  const ded = one && line === 'Property' ? PROPERTY_PERIL_DEDUCTIBLE[eventName.toLowerCase()] ?? 0 : 0;
  const [lo, hi] = R_MODEL.tShock[line][row.t as Exclude<ShockLevel, 'None'>];
  const k = kinks(ded);
  const perT = (tModel: number) => {
    const T = tModel * scale;
    if (one) {
      const { mu, sigma } = lognormalFromMean(T, SHOCK_LOSS_CV / Math.sqrt(n));
      const r = pwlMoments(mu, sigma, 0, k, x => h(x, ded));
      return { c1: r.m1, c2: r.m2 };
    }
    const { mu, sigma } = lognormalFromMean(T / n, SHOCK_LOSS_CV);
    const r = pwlMoments(mu, sigma, 0, k, x => h(x, ded));
    return { c1: n * r.m1, c2: n * r.m2 + n * (n - 1) * r.m1 * r.m1 };
  };
  return {
    c1: overUniform(lo, hi, t => perT(t).c1),
    c2: overUniform(lo, hi, t => perT(t).c2),
    occurrences: one ? 1 : n,
  };
}

/** h for a layer's cession, and its kinks — what the seam prices each layer with. */
export function layerCession(line: CoverageLine, layer: { attachment: number; limit: number }): {
  h: PerLoss; kinks: (d: number) => number[];
} {
  return {
    h: (x, d) => cedeAboveLocal(poolShare(line, x), layer, d),
    kinks: d => [...poolKinks(line), Math.max(layer.attachment, d), layer.attachment + layer.limit],
  };
}

/**
 * E and Var of SUM h(loss) over the year's large losses on a line: each
 * event's T losses at its probability, and the routine claims when that
 * switch is on. `h` takes the GROUND-UP loss and the occurrence's deductible;
 * `kinks` are h's breakpoints. For a routine claim the excess-only booking is
 * the caller's business — `routineOffset` is subtracted from h there, since
 * h(x) - g x limit is still piecewise linear.
 */
function largeLossMoments(
  line: CoverageLine, exposure: number, yearNumber: number,
  h: PerLoss, kinks: (deductible: number) => number[], routineOffset: boolean,
  routineOn = ROUTINE_LARGE_LOSSES.enabled,
): LargeMoments {
  const byEvent = new Map<string, number>();
  let mean = 0, variance = 0, occurrences = 0, routine = 0;
  if (yearNumber >= 1 && exposure > 0) {
    for (const e of SHOCK_EVENTS) {
      const c = conditionalEventMoments(line, e.name, exposure, yearNumber, h, kinks);
      if (c === null) continue;
      const p = e.probability;
      mean += p * c.c1;
      variance += p * c.c2 - p * p * c.c1 * c.c1;
      occurrences += p * c.occurrences;
      byEvent.set(e.name, (byEvent.get(e.name) ?? 0) + p * c.c1);
    }
  }
  if (routineOn && exposure > 0) {
    const basis = routineLargeBasis(line);
    const g = trendFactor(line, yearNumber);
    const off = routineOffset ? g * basis.limit : 0;
    const r = routineExpectation(basis, g, x => h(x, 0) - off, kinks(0));
    const lambda = routineLargeCount(line, exposure);
    routine = lambda * r.m1;
    mean += routine;
    variance += lambda * r.m2;
    occurrences += lambda;
  }
  return { mean, variance, occurrences, byEvent, routine };
}

// reinsuranceTower.ts's cedeAbove, restated rather than imported: that module
// imports towerMoments, which imports this one, and a cycle through the
// pricing seam is the kind that loads in one order and not the other.
// shock-loss-check asserts the two agree.
export function cedeAboveLocal(total: number, layer: { attachment: number; limit: number }, deductible: number): number {
  const top = layer.attachment + layer.limit;
  const from = Math.max(layer.attachment, deductible);
  return from >= top ? 0 : Math.max(0, Math.min(total - from, top - from));
}

const poolKinks = (line: CoverageLine) => {
  const l = POOL_LIMIT_PER_OCCURRENCE[line];
  return l === null ? [] : [l];
};

// --- the line's expected loss ----------------------------------------------

export interface ExpectedLossBreakdown {
  ordinary: number;
  /** Expected A + Economic Inflation, in dollars. */
  uplift: number;
  /** Expected T losses the pool keeps (GL net of the $25M limit), in dollars. */
  shockLarge: number;
  /** Routine large losses' excess over the ordinary limit, pool share. */
  routineLarge: number;
  total: number;
  /** Per event: its uplift and its T, dollars. */
  byEvent: Map<string, number>;
}

/**
 * The line's expected gross loss for the accident year, ex ante: ordinary,
 * plus the expected uplift on it, plus the large losses the pool keeps. What
 * `expectedLoss` reports under the flag, so actual over expected reads 1.00
 * across many games — and what each event contributes to it.
 */
export function expectedLossBreakdown(
  line: CoverageLine, exposure: number, yearNumber: number, routineOn = ROUTINE_LARGE_LOSSES.enabled,
): ExpectedLossBreakdown {
  const ordinary = exposure * 10_000 * ordinaryLossCostPer100(line, yearNumber);
  const u = upliftMoments(line, yearNumber);
  const large = largeLossMoments(line, exposure, yearNumber, x => poolShare(line, x), () => poolKinks(line), true, routineOn);
  const byEvent = new Map<string, number>();
  for (const [k, v] of u.byEvent) byEvent.set(k, v * ordinary);
  for (const [k, v] of large.byEvent) byEvent.set(k, (byEvent.get(k) ?? 0) + v);
  const uplift = u.mean * ordinary;
  return {
    ordinary, uplift, shockLarge: large.mean - large.routine, routineLarge: large.routine,
    total: ordinary + uplift + large.mean, byEvent,
  };
}

// --- the tower ------------------------------------------------------------

export interface NewEngineLayerMoments { expected: number; sd: number; sdOverExpected: number; lambda: number; }

/**
 * Each layer's expected annual recovery and its SD, on the new engine's own
 * large losses. Bounds may be scaled (the bulk years' identity — see
 * expectedCededAtBoundsScale), which here is exact: every large loss scales
 * with the same trend.
 */
export function newEngineLayerMoments(
  line: TowerLine, exposure: number, yearNumber: number, boundsScale = 1,
): NewEngineLayerMoments[] {
  return REINSURANCE_TOWER[line].map(l => {
    const layer = { attachment: l.attachment * boundsScale, limit: l.limit * boundsScale };
    const c = layerCession(line, layer);
    const m = largeLossMoments(line, exposure, yearNumber, c.h, c.kinks, false);
    const sd = Math.sqrt(Math.max(0, m.variance));
    return { expected: m.mean, sd, sdOverExpected: m.mean > 0 ? sd / m.mean : 0, lambda: m.occurrences };
  });
}

/**
 * The SD of what the pool RETAINS over a year after the layers it placed —
 * ordinary losses with their uplift, plus every large loss less its cession.
 * The aggregate stop is priced on a lognormal with this SD around its own
 * expected retained, the same moment fit the old WC aggregate used.
 */
export function retainedSd(
  line: TowerLine, placed: readonly boolean[], exposure: number, yearNumber: number,
): number {
  const layers = REINSURANCE_TOWER[line].filter((l, i) => placed[i] && l.purchasable);
  const ordinary = exposure * 10_000 * ordinaryLossCostPer100(line, yearNumber);
  const u = upliftMoments(line, yearNumber);
  const cv = ORDINARY_LOSS_CV[line];
  const ordinaryVar = ordinary * ordinary * ((1 + cv * cv) * (1 + 2 * u.mean + u.second) - Math.pow(1 + u.mean, 2));
  const large = largeLossMoments(
    line, exposure, yearNumber,
    (x, d) => poolShare(line, x) - layers.reduce((s, l) => s + cedeAboveLocal(poolShare(line, x), l, d), 0),
    d => [...poolKinks(line), ...layers.flatMap(l => [Math.max(l.attachment, d), l.attachment + l.limit])],
    true,
  );
  return Math.sqrt(Math.max(0, ordinaryVar + large.variance));
}

/** Expected occurrences of each kind the tower will see — for the record. */
export function expectedLargeLossCount(line: CoverageLine, exposure: number, yearNumber: number): number {
  return largeLossMoments(line, exposure, yearNumber, () => 0, () => [], false).occurrences;
}

/**
 * PROPERTY'S CATASTROPHE CAPITAL ON THE NEW ENGINE — what the pool retains,
 * in expectation, from ONE regional catastrophe that happens: Earthquake,
 * Winterstorm or Wildfire, weighted by how often each occurs, after the layer
 * it placed. The old engine read the same quantity off its own catastrophe
 * model over the member roster (catCapitalRetained); with no roster, the
 * catalogue's regional events are the catastrophes there are. Zero on WC and
 * GL, as before.
 */
export function newEngineCatCapital(
  line: CoverageLine, exposure: number, yearNumber: number, placed: readonly boolean[] | null,
): number {
  if (line !== 'Property' || !(exposure > 0)) return 0;
  const layers = REINSURANCE_TOWER.Property.filter((l, i) => placed?.[i] === true && l.purchasable);
  const h: PerLoss = (x, d) => poolShare(line, x) - layers.reduce((s, l) => s + cedeAboveLocal(poolShare(line, x), l, d), 0);
  const kinks = (d: number) => layers.flatMap(l => [Math.max(l.attachment, d), l.attachment + l.limit]);
  let weight = 0, retained = 0;
  for (const e of SHOCK_EVENTS) {
    if (!e.regional) continue;
    const c = conditionalEventMoments(line, e.name, exposure, yearNumber, h, kinks);
    if (c === null) continue;
    weight += e.probability;
    retained += e.probability * c.c1;
  }
  return weight > 0 ? retained / weight : 0;
}
