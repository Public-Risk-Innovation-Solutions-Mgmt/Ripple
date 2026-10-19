// ============================================================================
// LARGE INDIVIDUAL LOSSES FOR THE NEW LOSS ENGINE — the routine ones, and the
// one piece of arithmetic every large loss is priced with.
//
// Part of the new loss engine, which runs whenever MEMBER_LEVEL is off. Commit 2 of the loss engine plan; see
// docs/PENDING_MULTIPLAYER.md section 3.
//
// TWO THINGS LIVE HERE.
//
//   1. ROUTINE LARGE LOSSES — claims ABOVE the ordinary limit, every year,
//      behind ROUTINE_LARGE_LOSSES (off). Their count is Poisson at
//      ROUTINE_LARGE_LOSS_FREQUENCY_PER_1M x exposure, and each size is drawn
//      from TODAY'S severity mixture conditioned above the limit — the same
//      components, weights and caps the old engine prices with, on the full
//      market at neutral risk quality in year 1. So the count times the
//      conditional mean excess is, by construction, the share of today's
//      expected loss that ordinary losses left out ("what waits for the
//      shocks"), and the gate re-derives it to show so.
//
//   2. pwlMoments — E[h(X)] and E[h(X)^2] for a lognormal X and any
//      PIECEWISE-LINEAR h, in closed form from partial moments. A layer's
//      cession, the pool's share under the GL limit, and what the pool
//      retains after the layers it placed are all piecewise linear in the
//      ground-up loss, so ONE function prices every large loss the engine
//      draws. That is what makes "the rate deducts what the reinsurance will
//      actually pay" a statement about the draw rather than about a second
//      distribution.
//
// ⚠ THE SPLIT WITH ORDINARY LOSSES. Ordinary losses carry each claim up to
// the ordinary limit; a routine large claim carries only what lies ABOVE it.
// The claim itself is registered at its full ground-up size, because that is
// what the tower attaches to — a $3M claim pierces a $1M attachment by $2M,
// not by $2M less the $1M ordinary losses already hold — and the line's gross
// adds only the excess. See the engine's flag branch.
//
// ⚠ THE TREND IS A SCALE ON THE YEAR-1 DRAW. Ordinary losses trend at 5% a
// year in whole, which moves their limit with them; a routine claim is the
// year-1 draw times the same factor, so the split stays at the trended limit
// and the two together are today's unlimited loss trended. The tower's
// attachments do not trend, so by year 10 the split sits at $1.55M on WC and
// GL: a claim between $1M and the trended limit pierces a layer in reality
// but sits wholly in ordinary here and cedes nothing. Stated, not hidden.
// ============================================================================

import {
  GL_LOSS_MODEL, GL_SEVERITY_COMPONENTS, PROPERTY_LOSS_MODEL, WC_LOSS_MODEL, WC_SEVERITY_COMPONENTS,
} from '../data/defaultAssumptions';
import { ORDINARY_LOSS_LIMIT, ROUTINE_LARGE_LOSS_FREQUENCY_PER_1M } from '../data/pricingParameters';
import { getPredefinedMarketMembers } from '../data/memberCatalog';
import { normalCdf, normalInvCdf } from './claimMath';
import { glSeverityCap, thetaGl, untiltedGlWeights } from './glClaimEngine';
import { ratingGroupOf, thetaWc, wcSeverityCap } from './wcClaimEngine';
import { propertyInternals } from './propertyClaimEngine';
import type { SeededRandom } from './random';
import type { CoverageLine } from '../types/simulation';

/** One lognormal, by its log-location and log-scale, with a mixture weight. */
export interface LognormalComponent { mu: number; sigma: number; weight: number; }

/** mu and sigma of a lognormal with the given mean and CV. */
export function lognormalFromMean(mean: number, cv: number): { mu: number; sigma: number } {
  const s2 = Math.log(1 + cv * cv);
  return { mu: Math.log(mean) - s2 / 2, sigma: Math.sqrt(s2) };
}

// E[X^k 1{X <= t}], t = Infinity for the full moment.
function partial(mu: number, sigma: number, k: number, t: number): number {
  if (!(t > 0)) return 0;
  const full = Math.exp(k * mu + (k * k * sigma * sigma) / 2);
  if (!Number.isFinite(t)) return full;
  return full * normalCdf((Math.log(t) - mu - k * sigma * sigma) / sigma);
}

/**
 * E[h(X) 1{X > lower}] and E[h(X)^2 1{X > lower}] for X ~ LogNormal(mu, sigma)
 * and h piecewise linear between `breakpoints`.
 *
 * ⚠ h MUST BE LINEAR BETWEEN CONSECUTIVE BREAKPOINTS, and every caller passes
 * every kink: the layer bounds, the cap, the pool limit. Within a segment the
 * slope and intercept are read off two interior points, so h is evaluated
 * rather than described twice. On the last, unbounded segment h must be FLAT
 * (every caller caps), or the second moment of a heavy component would be
 * the whole of the answer.
 */
export function pwlMoments(
  mu: number, sigma: number, lower: number, breakpoints: readonly number[], h: (x: number) => number,
): { m1: number; m2: number } {
  const lo = Math.max(0, lower);
  const edges = [lo, ...[...new Set(breakpoints)].filter(b => b > lo && Number.isFinite(b)).sort((a, b) => a - b), Infinity];
  let m1 = 0, m2 = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i], b = edges[i + 1];
    const x1 = Number.isFinite(b) ? a + (b - a) / 3 : 2 * a + 1;
    const x2 = Number.isFinite(b) ? a + (2 * (b - a)) / 3 : 3 * a + 2;
    const h1 = h(x1), h2 = h(x2);
    const beta = (h2 - h1) / (x2 - x1);
    const alpha = h1 - beta * x1;
    const d0 = partial(mu, sigma, 0, b) - partial(mu, sigma, 0, a);
    if (!(d0 > 0)) continue;
    const d1 = beta === 0 ? 0 : partial(mu, sigma, 1, b) - partial(mu, sigma, 1, a);
    const d2 = beta === 0 ? 0 : partial(mu, sigma, 2, b) - partial(mu, sigma, 2, a);
    m1 += alpha * d0 + beta * d1;
    m2 += alpha * alpha * d0 + 2 * alpha * beta * d1 + beta * beta * d2;
  }
  return { m1, m2 };
}

// --- routine large losses --------------------------------------------------

export interface RoutineLargeBasis {
  line: CoverageLine;
  /** The ordinary limit the claims are conditioned above, year-1 dollars. */
  limit: number;
  /** Today's per-claim ceiling, year-1 dollars. */
  cap: number;
  /** Claims above the limit per $1M of exposure a year, re-derived. */
  frequencyPer1M: number;
  /** Mixture over X | X > limit: weights are each component's share of the count. */
  components: LognormalComponent[];
  /** E[min(X, cap) - limit | X > limit], year-1 dollars. */
  meanExcess: number;
}

const basisCache = new Map<CoverageLine, RoutineLargeBasis>();

/**
 * Today's severity mixture conditioned above the ordinary limit — full
 * market, neutral risk quality, untilted weights, year 1: the same basis the
 * ordinary cost was derived on, so the two halves of a claim come from one
 * distribution. Memoized; it depends on nothing that moves.
 */
export function routineLargeBasis(line: CoverageLine): RoutineLargeBasis {
  const hit = basisCache.get(line);
  if (hit) return hit;
  const raw: { mu: number; sigma: number; lam: number }[] = [];
  let exposure = 0;
  for (const m of getPredefinedMarketMembers()) {
    const e = m.exposureByLine[line] ?? 0;
    if (e <= 0) continue;
    exposure += e;
    if (line === 'GL') {
      const lam = e * GL_LOSS_MODEL.ratePer1M * thetaGl(5);
      const w = untiltedGlWeights();
      GL_SEVERITY_COMPONENTS.forEach((c, j) => raw.push({ mu: c.mu, sigma: c.sigma, lam: lam * w[j] }));
    } else if (line === 'WC') {
      const spec = WC_LOSS_MODEL.ratingGroups[ratingGroupOf(m)];
      const lam = e * spec.ratePer1M * thetaWc(5);
      for (const { component, weight } of spec.mix) {
        const c = WC_SEVERITY_COMPONENTS[component];
        raw.push({ mu: c.mu, sigma: c.sigma, lam: lam * weight });
      }
    } else {
      const lam = e * PROPERTY_LOSS_MODEL.frequencyPer1mTiv * propertyInternals.thetaFrequency(5);
      for (const c of PROPERTY_LOSS_MODEL.severityMixture) raw.push({ mu: c.mu, sigma: c.sigma, lam: lam * c.weight });
    }
  }
  // Merge identical components — WC's four groups share four components.
  const merged = new Map<string, { mu: number; sigma: number; lam: number }>();
  for (const r of raw) {
    const k = `${r.mu}|${r.sigma}`;
    const cur = merged.get(k);
    if (cur) cur.lam += r.lam; else merged.set(k, { ...r });
  }
  const limit = ORDINARY_LOSS_LIMIT[line];
  const cap = line === 'GL' ? glSeverityCap(1) : line === 'WC' ? wcSeverityCap(1) : PROPERTY_LOSS_MODEL.severityCap;
  let above = 0;
  const conditioned: { mu: number; sigma: number; rate: number }[] = [];
  for (const c of merged.values()) {
    const rate = c.lam * (1 - normalCdf((Math.log(limit) - c.mu) / c.sigma));
    if (rate > 0) { conditioned.push({ mu: c.mu, sigma: c.sigma, rate }); above += rate; }
  }
  const components = conditioned.map(c => ({ mu: c.mu, sigma: c.sigma, weight: c.rate / above }));
  const basis: RoutineLargeBasis = {
    line, limit, cap, frequencyPer1M: above / exposure, components, meanExcess: 0,
  };
  basis.meanExcess = routineExpectation(basis, 1, x => Math.min(x, cap) - limit).m1;
  basisCache.set(line, basis);
  return basis;
}

/**
 * E[h(scale x min(X, cap)) | X > limit] over the conditioned mixture, and its
 * second moment. `h` receives the SCALED, CAPPED ground-up claim; `kinks`
 * are h's breakpoints in those same scaled dollars.
 */
export function routineExpectation(
  basis: RoutineLargeBasis, scale: number, h: (claim: number) => number, kinks: readonly number[] = [],
): { m1: number; m2: number } {
  let m1 = 0, m2 = 0;
  const breaks = [basis.cap, ...kinks.map(k => k / scale)];
  for (const c of basis.components) {
    const sAbove = 1 - normalCdf((Math.log(basis.limit) - c.mu) / c.sigma);
    if (!(sAbove > 0)) continue;
    const r = pwlMoments(c.mu, c.sigma, basis.limit, breaks, x => h(scale * Math.min(x, basis.cap)));
    m1 += c.weight * r.m1 / sAbove;
    m2 += c.weight * r.m2 / sAbove;
  }
  return { m1, m2 };
}

/** The year's expected count of routine large claims on `exposure` ($M). */
export const routineLargeCount = (line: CoverageLine, exposure: number): number =>
  ROUTINE_LARGE_LOSS_FREQUENCY_PER_1M[line] * exposure;

/**
 * One routine large claim's YEAR-1 ground-up size, capped. The caller scales
 * it by the year's trend. Component by its share of the count, then the
 * component's lognormal truncated below at the limit, drawn by inverting the
 * UPPER tail so a small survival keeps its precision.
 */
export function drawRoutineLargeSize(rng: SeededRandom, basis: RoutineLargeBasis): number {
  const j = rng.categorical(basis.components.map(c => c.weight));
  const c = basis.components[j];
  const tail = 1 - normalCdf((Math.log(basis.limit) - c.mu) / c.sigma);
  const w = (1 - rng.next()) * tail;
  const x = Math.exp(c.mu - c.sigma * normalInvCdf(w));
  return Math.min(Math.max(x, basis.limit), basis.cap);
}
