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
// ⚠ APPROXIMATIONS, STATED. Earthquake, Wildfire and Winterstorm are one
// event each, so the tower sees SUMS of their losses, and a sum is not
// integrated exactly:
//   - an event's total is priced as a lognormal with its own mean and CV
//     (Fenton-Wilkinson);
//   - what Property's per-risk layer leaves of an event, n·a − D + B, is
//     priced with D (the claims' shortfall below the per-risk attachment) a
//     fitted lognormal and B (their excess above its top) by how many claims
//     exceed it — one exactly, more as a fitted lognormal — the two taken as
//     independent (conditionalEventTiers);
//   - an earthquake's deductible is taken off each claim at the share it
//     would keep of an event of exactly T (1 − d/T), where the draw takes it
//     at the share of the event it drew.
// The draw sums the individual lognormals exactly; shock-loss-check and
// property-cat-cover-check hold each layer's expectation to the draws.
// ============================================================================

import { REINSURANCE_TOWER, type TowerLayer, type TowerLine } from '../data/reinsuranceTower';
import {
  ORDINARY_LOSS_CV, POOL_LIMIT_PER_OCCURRENCE, R_MODEL, REGION_EXPOSURE_SHARE, ROUTINE_LARGE_LOSSES,
  SHOCK_LOSS_COUNT, SHOCK_LOSS_CV, SHOCK_ONE_OCCURRENCE,
} from '../data/pricingParameters';
import { pwlMoments, lognormalFromMean, routineExpectation, routineLargeBasis, routineLargeCount } from './largeLosses';
import { normalCdf } from './claimMath';
import { ordinaryLossCostPer100 } from './ordinaryLoss';
import { DECAY, SHOCK_EVENTS, eventDeductible, eventLines, poolShare, tScale, trendFactor, type ShockLevel } from './shockLosses';
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
/** P(K = j) for K ~ Binomial(n, p), in logs so a small p or a large n stays finite. */
function binomialPmf(n: number, j: number, p: number): number {
  if (p <= 0) return j === 0 ? 1 : 0;
  if (p >= 1) return j === n ? 1 : 0;
  let lc = 0;
  for (let i = 1; i <= j; i++) lc += Math.log((n - j + i) / i);
  return Math.exp(lc + j * Math.log(p) + (n - j) * Math.log(1 - p));
}
/** overUniform's nodes and weights, for a caller taking several expectations from each node. */
function uniformNodes(lo: number, hi: number): [number, number][] {
  if (!(hi > lo)) return [[lo, 1]];
  return GL_NODES.map((x, i) => [(hi + lo) / 2 + ((hi - lo) / 2) * x, GL_WEIGHTS[i] / 2]);
}
/** E[f(Z)] for Z standard normal, as nodes and weights: the same rule on [−6, 6] against the density, renormalised. */
const STD_NORMAL_NODES: [number, number][] = (() => {
  const raw = GL_NODES.map((x, i) => [6 * x, 6 * GL_WEIGHTS[i] * Math.exp(-18 * x * x) / Math.sqrt(2 * Math.PI)] as [number, number]);
  const total = raw.reduce((s, [, w]) => s + w, 0);
  return raw.map(([z, w]) => [z, w / total]);
})();

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
  const ded = eventDeductible(line, eventName, one);
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
  // Count the catalogue's events in a year before year 1 too — what a PRICE
  // does (ex ante); what HAPPENED there does not, since nothing fires then.
  shocksInEveryYear = false,
): LargeMoments {
  const byEvent = new Map<string, number>();
  let mean = 0, variance = 0, occurrences = 0, routine = 0;
  if ((yearNumber >= 1 || shocksInEveryYear) && exposure > 0) {
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
    const r = routineMoments(line, exposure, yearNumber, x => h(x, 0), kinks(0), routineOffset);
    routine = r.mean;
    mean += routine;
    variance += r.variance;
    occurrences += r.lambda;
  }
  return { mean, variance, occurrences, byEvent, routine };
}

/** The routine large claims' part of largeLossMoments: E and Var of SUM h(claim), and the count. */
function routineMoments(
  line: CoverageLine, exposure: number, yearNumber: number,
  h: (x: number) => number, kinks: readonly number[], routineOffset: boolean,
): { mean: number; variance: number; lambda: number } {
  const basis = routineLargeBasis(line);
  const g = trendFactor(line, yearNumber);
  const off = routineOffset ? g * basis.limit : 0;
  const r = routineExpectation(basis, g, x => h(x) - off, kinks);
  const lambda = routineLargeCount(line, exposure);
  return { mean: lambda * r.m1, variance: lambda * r.m2, lambda };
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
  // An event's deductible comes off its ground-up total first (eventDeductible);
  // every other loss has none, and keeps exactly the pool share it always had.
  const large = largeLossMoments(
    line, exposure, yearNumber,
    (x, d) => (d > 0 ? poolShare(line, Math.max(0, x - d)) : poolShare(line, x)),
    d => (d > 0 ? [...poolKinks(line), d] : poolKinks(line)), true, routineOn,
  );
  const byEvent = new Map<string, number>();
  for (const [k, v] of u.byEvent) byEvent.set(k, v * ordinary);
  for (const [k, v] of large.byEvent) byEvent.set(k, (byEvent.get(k) ?? 0) + v);
  const uplift = u.mean * ordinary;
  return {
    ordinary, uplift, shockLarge: large.mean - large.routine, routineLarge: large.routine,
    total: ordinary + uplift + large.mean, byEvent,
  };
}

// --- Property's two kinds of cover ----------------------------------------
//
// PER-RISK answers each claim; CATASTROPHE answers an event's total net of
// the per-risk recoveries on its claims, and never a routine claim alone. So
// on Property a layer's expectation is not a function of one loss: the
// catastrophe layer's depends on the per-risk cover in force in front of it.
// Given an event of size T with n claims, each claim Y is lognormal around
// k·T/n with CV SHOCK_LOSS_CV (k = 1 − d/T, the deductible's share, 1 without
// one) and independent of the others, so
//
//   per-risk layer L     n·E[L(Y)], second moment n·E[L(Y)²] + n(n−1)·E[L(Y)]²
//   what per-risk leaves N = Σ r(Y_i), r(y) = y − Σ placed per-risk L(y):
//                        with the band [a, b) placed, n·a − D + B (see
//                        conditionalEventTiers); with none, the event's total
//   catastrophe layer C  E[C(N)]
//   the pool keeps       E[N − Σ placed C(N)]
//
// and each is integrated over T uniform, at the event's probability.

type Bounds = { attachment: number; limit: number };
const cedeTo = (x: number, l: Bounds) => Math.max(0, Math.min(x - l.attachment, l.limit));
const boundsKinks = (ls: readonly Bounds[]) => ls.flatMap(l => [l.attachment, l.attachment + l.limit]);

/** E and E[^2] of one quantity, given an event arrives. */
export interface EventMoment { c1: number; c2: number }

/** Given an event arrives on Property: each per-risk layer, each catastrophe layer, and what the pool keeps. */
export interface EventTiers {
  perRisk: EventMoment[];
  cat: EventMoment[];
  retained: EventMoment;
}

/**
 * GIVEN THAT A ONE-OCCURRENCE EVENT ARRIVES THIS YEAR ON A LINE WITH
 * CATASTROPHE LAYERS — Property's Earthquake, Winterstorm or Wildfire — the
 * moments of each per-risk layer's recovery (`perRisk`, all reported), of each
 * catastrophe layer's recovery behind the per-risk layers in force
 * (`perRiskInForce`), and of what the pool keeps after both kinds in force.
 * null if the event's T does not reach the line or it is not one occurrence.
 */
export function conditionalEventTiers(
  line: CoverageLine, eventName: string, exposure: number, yearNumber: number,
  perRisk: readonly Bounds[], perRiskInForce: readonly boolean[],
  cat: readonly Bounds[], catInForce: readonly boolean[],
): EventTiers | null {
  const row = eventLines(eventName).find(r => r.line === line && r.t !== 'None');
  if (!row || !SHOCK_ONE_OCCURRENCE.includes(eventName)) return null;
  const scale = tScale(line, exposure, yearNumber);
  const n = SHOCK_LOSS_COUNT[eventName]?.[line] ?? 0;
  const ded = eventDeductible(line, eventName, true);
  const [lo, hi] = R_MODEL.tShock[line][row.t as Exclude<ShockLevel, 'None'>];
  // ⚠ MEMOISED ON EVERY NUMBER THE ANSWER READS — the event's scale, count,
  // CV, range and deductible, the pool limit and each layer's bounds and
  // whether it is in force — never on the year or the exposure as such, so a
  // harness that changes a parameter gets a fresh answer, not a stale one. A
  // Property price reads these for each event; worlds sharing a book, and the
  // Decisions panel re-rendering, ask the same question many times.
  const key = [line, eventName, scale, n, SHOCK_LOSS_CV, lo, hi, ded, poolKinks(line).join(','),
    perRisk.map((l, i) => `${l.attachment}:${l.limit}:${perRiskInForce[i] ? 1 : 0}`).join(','),
    cat.map((l, i) => `${l.attachment}:${l.limit}:${catInForce[i] ? 1 : 0}`).join(',')].join('|');
  const hit = TIERS_CACHE.get(key);
  if (hit) return hit;
  const prOn = perRisk.filter((_l, i) => perRiskInForce[i]);
  const catOn = cat.filter((_l, i) => catInForce[i]);
  const pk = poolKinks(line);
  const r = (y: number) => poolShare(line, y) - prOn.reduce((a, l) => a + cedeTo(poolShare(line, y), l), 0);
  // The per-risk cover in force as ONE band [a, b), when it is one — every
  // option offered is. Then what per-risk leaves of a claim is
  // a − (a − y)⁺ + (y − b)⁺, and of the event n·a − D + B.
  const a = prOn.length ? Math.min(...prOn.map(l => l.attachment)) : 0;
  const b = prOn.length ? Math.max(...prOn.map(l => l.attachment + l.limit)) : 0;
  const oneBand = prOn.length > 0 && pk.length === 0 && Math.abs(prOn.reduce((s, l) => s + l.limit, 0) - (b - a)) < 1e-6;
  const zero = (): EventTiers => ({ perRisk: perRisk.map(() => ({ c1: 0, c2: 0 })), cat: cat.map(() => ({ c1: 0, c2: 0 })), retained: { c1: 0, c2: 0 } });
  const perT = (tModel: number): EventTiers => {
    const T = tModel * scale;
    const k = ded > 0 ? Math.max(0, 1 - ded / T) : 1;
    if (!(k > 0) || !(T > 0) || n <= 0) return zero();
    const y = lognormalFromMean((k * T) / n, SHOCK_LOSS_CV);
    const sumOf = (m: { m1: number; m2: number }): EventMoment => ({ c1: n * m.m1, c2: n * m.m2 + n * (n - 1) * m.m1 * m.m1 });
    const pr = perRisk.map(l => sumOf(pwlMoments(y.mu, y.sigma, 0, [...pk, ...boundsKinks([l])], x => cedeTo(poolShare(line, x), l))));
    // E and E[^2] of g(N) for each g the catastrophe side needs.
    let onN: (g: (x: number) => number, ks: number[]) => EventMoment;
    if (oneBand) {
      // N = n·a − D + B: D the event's shortfall below the per-risk
      // attachment, B its excess above the per-risk top, each a sum of n
      // independent parts (a lognormal fitted to N whole spreads it across
      // the band's edges, where the sum bunches). D is a fitted lognormal; B
      // is taken by its count, below. D and B are taken as independent: one
      // claim adds to at most one of them, so their covariance is
      // −n·E[d]·E[b], small.
      const fit = (m: { m1: number; m2: number }) => {
        const mean = n * m.m1, v = Math.max(0, n * (m.m2 - m.m1 * m.m1));
        return mean > 1e-9 * a ? { mean, ...lognormalFromMean(mean, Math.sqrt(v) / mean) } : null;
      };
      const D = fit(pwlMoments(y.mu, y.sigma, 0, [a], x => Math.max(0, a - x)));
      // B BY HOW MANY CLAIMS EXCEED b: most events have none, so B is zero
      // with a large mass and a lognormal fits it badly. K ~ Binomial(n, p);
      // one excess is exact (the claim's own lognormal above b); two or more
      // are a fitted lognormal of their sum. Every count to n, skipping those
      // too unlikely to move a dollar.
      const pAbove = 1 - normalCdf((Math.log(b) - y.mu) / y.sigma);
      const ex = pAbove > 0 ? pwlMoments(y.mu, y.sigma, b, [], x => x - b) : { m1: 0, m2: 0 };
      const e1 = pAbove > 0 ? ex.m1 / pAbove : 0, e2 = pAbove > 0 ? ex.m2 / pAbove : 0;
      const K_MAX = n;
      const binom: number[] = [];
      for (let j = 0; j <= n; j++) binom.push(binomialPmf(n, j, pAbove));
      const base = n * a;
      onN = (g, ks) => {
        const inner = (delta: number) => {
          const shift = base - delta;
          const v0 = g(shift);
          let m1 = binom[0] * v0, m2 = binom[0] * v0 * v0;
          for (let j = 1; j <= K_MAX; j++) {
            const pj = binom[j];
            if (!(pj > 1e-12)) continue;
            let r1: { m1: number; m2: number };
            if (j === 1) {
              const raw = pwlMoments(y.mu, y.sigma, b, ks.map(q => q - shift + b), x => g(shift + x - b));
              r1 = { m1: raw.m1 / pAbove, m2: raw.m2 / pAbove };
            } else {
              const mean = j * e1, v = Math.max(0, j * (e2 - e1 * e1));
              const S = lognormalFromMean(mean, Math.sqrt(v) / mean);
              r1 = pwlMoments(S.mu, S.sigma, 0, ks.map(q => q - shift), x => g(shift + x));
            }
            m1 += pj * r1.m1; m2 += pj * r1.m2;
          }
          return { m1, m2 };
        };
        if (!D) { const m = inner(0); return { c1: m.m1, c2: m.m2 }; }
        let c1 = 0, c2 = 0;
        for (const [z, w] of STD_NORMAL_NODES) {
          const m = inner(Math.exp(D.mu + D.sigma * z));
          c1 += w * m.m1; c2 += w * m.m2;
        }
        return { c1, c2 };
      };
    } else {
      // Otherwise N whole, fitted lognormal (Fenton-Wilkinson).
      const rm = pwlMoments(y.mu, y.sigma, 0, [...pk, ...boundsKinks(prOn)], r);
      const mean = n * rm.m1, variance = Math.max(0, n * (rm.m2 - rm.m1 * rm.m1));
      if (!(mean > 0)) return { ...zero(), perRisk: pr };
      const N = lognormalFromMean(mean, Math.sqrt(variance) / mean);
      onN = (g, ks) => { const m = pwlMoments(N.mu, N.sigma, 0, ks, g); return { c1: m.m1, c2: m.m2 }; };
    }
    return {
      perRisk: pr,
      cat: cat.map(l => onN(x => cedeTo(x, l), boundsKinks([l]))),
      retained: onN(x => x - catOn.reduce((s, l) => s + cedeTo(x, l), 0), boundsKinks(catOn)),
    };
  };
  // Each T node once, every quantity accumulated from it.
  const out = zero();
  const add = (acc: EventMoment, m: EventMoment, w: number) => { acc.c1 += w * m.c1; acc.c2 += w * m.c2; };
  for (const [t, w] of uniformNodes(lo, hi)) {
    const at = perT(t);
    at.perRisk.forEach((m, i) => add(out.perRisk[i], m, w));
    at.cat.forEach((m, i) => add(out.cat[i], m, w));
    add(out.retained, at.retained, w);
  }
  if (TIERS_CACHE.size >= TIERS_CACHE_LIMIT) TIERS_CACHE.clear();
  TIERS_CACHE.set(key, out);
  return out;
}
const TIERS_CACHE = new Map<string, EventTiers>();
const TIERS_CACHE_LIMIT = 4096;

/** The tower's layers split by kind, bounds scaled, with what is in force. */
function tieredLayers(line: TowerLine, placed: readonly boolean[] | null, boundsScale = 1) {
  const pick = (basis: TowerLayer['basis']) => REINSURANCE_TOWER[line]
    .map((l, i) => ({ l, i })).filter(({ l }) => l.basis === basis)
    .map(({ l, i }) => ({
      i, bounds: { attachment: l.attachment * boundsScale, limit: l.limit * boundsScale },
      inForce: placed === null ? l.purchasable : placed[i] === true && l.purchasable,
    }));
  return { perRisk: pick('claim'), cat: pick('event') };
}

/**
 * EVERY PROPERTY LAYER'S EXPECTED ANNUAL RECOVERY, AND ITS SD — the events at
 * their probabilities (conditionalEventTiers), and the routine claims, which
 * reach the per-risk layer only. Each catastrophe layer is priced behind the
 * per-risk cover in `placed` (null: the whole tower's purchasable layers),
 * since what per-risk takes first the catastrophe layer never sees.
 */
function tieredLayerMoments(
  line: TowerLine, exposure: number, yearNumber: number, boundsScale: number, exAnte: boolean,
  placed: readonly boolean[] | null,
): NewEngineLayerMoments[] {
  const t = tieredLayers(line, placed, boundsScale);
  const layers = REINSURANCE_TOWER[line];
  const mean = layers.map(() => 0), variance = layers.map(() => 0), lambda = layers.map(() => 0);
  if ((yearNumber >= 1 || exAnte) && exposure > 0) {
    for (const e of SHOCK_EVENTS) {
      const c = conditionalEventTiers(
        line, e.name, exposure, yearNumber,
        t.perRisk.map(x => x.bounds), t.perRisk.map(x => x.inForce),
        t.cat.map(x => x.bounds), t.cat.map(() => true),
      );
      if (c === null) continue;
      const p = e.probability;
      const add = (i: number, m: EventMoment) => {
        mean[i] += p * m.c1; variance[i] += p * m.c2 - p * p * m.c1 * m.c1; lambda[i] += p;
      };
      t.perRisk.forEach((x, j) => add(x.i, c.perRisk[j]));
      t.cat.forEach((x, j) => add(x.i, c.cat[j]));
    }
  }
  if (ROUTINE_LARGE_LOSSES.enabled && exposure > 0) {
    for (const x of t.perRisk) {
      const r = routineMoments(line, exposure, yearNumber, y => cedeTo(poolShare(line, y), x.bounds),
        [...poolKinks(line), ...boundsKinks([x.bounds])], false);
      mean[x.i] += r.mean; variance[x.i] += r.variance; lambda[x.i] += r.lambda;
    }
  }
  return layers.map((_l, i) => {
    const sd = Math.sqrt(Math.max(0, variance[i]));
    return { expected: mean[i], sd, sdOverExpected: mean[i] > 0 ? sd / mean[i] : 0, lambda: lambda[i] };
  });
}

// --- the tower ------------------------------------------------------------

export interface NewEngineLayerMoments { expected: number; sd: number; sdOverExpected: number; lambda: number; }

/**
 * Each layer's expected annual recovery and its SD, on the new engine's own
 * large losses. Bounds may be scaled (the bulk years' identity — see
 * expectedCededAtBoundsScale), which here is exact: every large loss scales
 * with the same trend.
 *
 * ⚠ EX ANTE IN EVERY YEAR, THE PRE-GAME INCLUDED (Prompt A commit 2). A price
 * is struck before the year on the catalogue's probabilities, so a pre-game
 * year's tower is priced exactly as a game year's: the prior board paid the
 * market price for shock cover and simply had quiet years. Until then the
 * shocks were left out before year 1 — "nothing fires then" — which priced
 * Property's layers at the routine claims alone and its Prior ceded premium
 * at nothing beside game years' $1M. `exAnte = false` asks instead what the
 * year's losses actually were expected to cede, which before year 1 is the
 * routine claims only: the bulk years' net ultimates are struck on that.
 */
export function newEngineLayerMoments(
  line: TowerLine, exposure: number, yearNumber: number, boundsScale = 1, exAnte = true,
  // PROPERTY ONLY: the placement the catastrophe layers are priced behind —
  // see tieredLayerMoments. Absent: every purchasable layer, the whole tower.
  placed: readonly boolean[] | null = null,
): NewEngineLayerMoments[] {
  if (REINSURANCE_TOWER[line].some(l => l.basis === 'event')) {
    return tieredLayerMoments(line, exposure, yearNumber, boundsScale, exAnte, placed);
  }
  return REINSURANCE_TOWER[line].map(l => {
    const layer = { attachment: l.attachment * boundsScale, limit: l.limit * boundsScale };
    const c = layerCession(line, layer);
    const m = largeLossMoments(line, exposure, yearNumber, c.h, c.kinks, false, ROUTINE_LARGE_LOSSES.enabled, exAnte);
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
  if (REINSURANCE_TOWER[line].some(l => l.basis === 'event')) {
    return Math.sqrt(Math.max(0, ordinaryVar + tieredRetained(line, placed, exposure, yearNumber).variance));
  }
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
  // ⚠ NET OF THE COVER HELD, BOTH KINDS (Property catastrophe cover). The
  // per-risk layer in force answers each of the event's claims, the
  // catastrophe layer in force the total it leaves, and the charge is what
  // the pool keeps after both — so a pool that buys less cover needs more
  // surplus. `placed` null holds none.
  const t = tieredLayers('Property', placed ?? REINSURANCE_TOWER.Property.map(() => false));
  let weight = 0, retained = 0;
  for (const e of SHOCK_EVENTS) {
    if (!e.regional) continue;
    const c = conditionalEventTiers(
      line, e.name, exposure, yearNumber,
      t.perRisk.map(x => x.bounds), t.perRisk.map(x => x.inForce),
      t.cat.map(x => x.bounds), t.cat.map(x => x.inForce),
    );
    if (c === null) continue;
    weight += e.probability;
    retained += e.probability * c.retained.c1;
  }
  return weight > 0 ? retained / weight : 0;
}

/**
 * What Property keeps of its large losses over a year after the layers in
 * `placed`, E and Var: each event's retained at its probability, and each
 * routine claim less the per-risk layer in force. For retainedSd.
 */
function tieredRetained(
  line: TowerLine, placed: readonly boolean[], exposure: number, yearNumber: number,
): { mean: number; variance: number } {
  const t = tieredLayers(line, placed);
  let mean = 0, variance = 0;
  if (yearNumber >= 1 && exposure > 0) {
    for (const e of SHOCK_EVENTS) {
      const c = conditionalEventTiers(
        line, e.name, exposure, yearNumber,
        t.perRisk.map(x => x.bounds), t.perRisk.map(x => x.inForce),
        t.cat.map(x => x.bounds), t.cat.map(x => x.inForce),
      );
      if (c === null) continue;
      const p = e.probability;
      mean += p * c.retained.c1;
      variance += p * c.retained.c2 - p * p * c.retained.c1 * c.retained.c1;
    }
  }
  if (ROUTINE_LARGE_LOSSES.enabled && exposure > 0) {
    const on = t.perRisk.filter(x => x.inForce).map(x => x.bounds);
    const r = routineMoments(line, exposure, yearNumber,
      y => poolShare(line, y) - on.reduce((a, l) => a + cedeTo(poolShare(line, y), l), 0),
      [...poolKinks(line), ...boundsKinks(on)], true);
    mean += r.mean; variance += r.variance;
  }
  return { mean, variance };
}
