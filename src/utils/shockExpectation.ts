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
// ⚠ wip/shocks: A is the firing year's only, on the whole line (SHOCK_A_YEARS),
// and a T is ONE claim uniform on its range (SHOCK_T_CLAIM_RANGE), so each
// event's T moments are integrated exactly, piece by piece between the kinks
// of whatever h is asked — no lognormal, no scale, no approximation.
// ============================================================================

import { REINSURANCE_TOWER, type TowerLine } from '../data/reinsuranceTower';
import {
  POOL_LIMIT_PER_OCCURRENCE, POOL_LOSS_COST_LAYERS, R_MODEL, ROUTINE_FOLD_NET_OF_UPLIFT, ROUTINE_LARGE_LOSSES, SHOCK_A_YEARS,
  SHOCK_T_CLAIM_RANGE, UP_FRONT_TREND, AGGREGATE_STOP, AGGREGATE_STOP_OPTIONS,
} from '../data/pricingParameters';
import { routineExpectation, routineLargeBasis, routineLargeCount } from './largeLosses';
import { shockTrendFactor } from './shockCost';
import { ordinaryLossCostPer100, typicalBookOrdinaryCv } from './ordinaryLoss';
import { DECAY, SHOCK_EVENTS, eventLines, poolShare, trendFactor, type ShockLevel } from './shockLosses';
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
/**
 * E[f(U)] for U uniform on [lo, hi], f piecewise smooth with breaks at
 * `kinks`: Gauss-Legendre on each piece, so a piecewise-linear f (a layer's
 * cession) and its square are integrated exactly.
 */
function overUniformPw(lo: number, hi: number, kinks: readonly number[], f: (t: number) => number): number {
  if (!(hi > lo)) return f(lo);
  const cuts = [lo, ...kinks.filter(k => k > lo && k < hi).sort((a, b) => a - b), hi];
  let s = 0;
  for (let j = 0; j + 1 < cuts.length; j++) s += ((cuts[j + 1] - cuts[j]) / (hi - lo)) * overUniform(cuts[j], cuts[j + 1], f);
  return s;
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
  for (const e of SHOCK_EVENTS) {
    // Each row: its moments and how many years it lasts. An A lasts its firing
    // year only (SHOCK_A_YEARS) on the whole line; Economic Inflation its
    // duration, decaying.
    const rows: { m1: number; m2: number; years: number }[] = [];
    if (e.name === 'Economic Inflation') {
      const a = R_MODEL.economicInflationInitialRate;
      rows.push({ m1: a, m2: a * a, years: e.duration });
    }
    for (const row of eventLines(e.name)) {
      if (row.line !== line || row.a === 'None') continue;
      const [lo, hi] = R_MODEL.aShock[line][row.a];
      rows.push({ m1: (lo + hi) / 2, m2: (lo * lo + lo * hi + hi * hi) / 3, years: Math.min(SHOCK_A_YEARS, e.duration) });
    }
    if (rows.length === 0) continue;
    let contribution = 0;
    for (let age = 0; age < Math.min(e.duration, yearNumber); age++) {
      const d = Math.pow(DECAY, age);
      // One firing-year's rows together — they are one Bernoulli.
      let m1 = 0, m2 = 0;
      for (const r of rows) {
        if (age >= r.years) continue;
        const dd = e.name === 'Economic Inflation' && r.years === e.duration ? d : 1;
        m1 += r.m1 * dd;
        m2 += r.m2 * dd * dd;
      }
      contribution += e.probability * m1;
      variance += e.probability * m2 - Math.pow(e.probability * m1, 2);
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
  line: CoverageLine, eventName: string, _exposure: number, yearNumber: number,
  h: PerLoss, kinks: (deductible: number) => number[],
): { c1: number; c2: number; occurrences: number } | null {
  // ONE claim, uniform on the level's range (SHOCK_T_CLAIM_RANGE), no
  // deductible: E[h(U)] and E[h(U)^2], exact on each piece between kinks.
  const row = eventLines(eventName).find(r => r.line === line && r.t !== 'None');
  if (!row) return null;
  // ⚠ GROWN BY THE LINE'S TREND ONLY (shockCost.shockTrendFactor), not by the
  // book: an expectation is asked of a book with no year-1 base in hand. A book
  // that has grown since year 1 draws its T a little larger than this.
  const g = shockTrendFactor(line, yearNumber);
  const [lo, hi] = SHOCK_T_CLAIM_RANGE[line][row.t as Exclude<ShockLevel, 'None'>].map(v => v * g);
  const k = kinks(0);
  return {
    c1: overUniformPw(lo, hi, k, x => h(x, 0)),
    c2: overUniformPw(lo, hi, k, x => h(x, 0) ** 2),
    occurrences: 1,
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
  // THE BOOK'S SIZE-WEIGHTED TRUE RISK (book units commit 5): a riskier book
  // draws more routine large claims — its count is on exposure x risk. T is
  // the event's own size and does not carry it.
  routineRisk = 1,
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
    const basis = routineLargeBasis(line);
    const g = trendFactor(line, yearNumber);
    const off = routineOffset ? g * basis.limit : 0;
    const r = routineExpectation(basis, g, x => h(x, 0) - off, kinks(0));
    const lambda = routineLargeCount(line, exposure * routineRisk);
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

// --- the routine fold ------------------------------------------------------

/**
 * THE ROUTINE FOLD, per $100 of exposure, for a line-year (stable-scenarios
 * build, commit 1). With ROUTINE_LARGE_LOSSES off, the expected cost routine
 * large claims carried — the pool's share above the ordinary limit, trended to
 * the year — is added to the ordinary cost as
 *
 *     routine(y) / (1 + E[A uplift](y))
 *
 * so the uplift, which multiplies the ordinary losses, gives back exactly
 * routine(y): the line's expected loss is unchanged, year by year. Zero with
 * the switch ON, when the routine claims are drawn instead.
 *
 * Memoised per line-year; the key carries the switch and the catalogue's total
 * probability, so a gate or probe that moves either reads a fresh value.
 */
const foldMemo = new Map<string, number>();
export function routineFoldPer100(line: CoverageLine, yearNumber: number): number {
  // ⚠ NOT ON A LINE PRICED ON THE POOL'S LAYERS (commit 2): its ordinary cost
  // already carries the $1M – $5M layer, and what lies above $5M arrives only
  // with the shocks. Property, still on its derived cost, keeps the fold.
  if (ROUTINE_LARGE_LOSSES.enabled || POOL_LOSS_COST_LAYERS[line]) return 0;
  const key = `${line}|${yearNumber}|${SHOCK_EVENTS.reduce((a, e) => a + e.probability, 0)}|${UP_FRONT_TREND.enabled}|${ROUTINE_FOLD_NET_OF_UPLIFT.enabled}`;
  const hit = foldMemo.get(key);
  if (hit !== undefined) return hit;
  const basis = routineLargeBasis(line);
  const g = trendFactor(line, yearNumber);
  // The pool's share of each claim's excess over the ordinary limit — the same
  // h the routine expectation in expectedLossBreakdown uses (routineOffset).
  const r = routineExpectation(basis, g, x => poolShare(line, x) - g * basis.limit, poolKinks(line));
  const routinePer100 = routineLargeCount(line, 1) * r.m1 / 10_000;
  // ⚠ NOT NET OF THE SHOCKS' UPLIFT (wip/shocks; ROUTINE_FOLD_NET_OF_UPLIFT):
  // the fold is the routine claims' cost, whatever the shock switch says, and
  // an A lands on top of it. Divided by (1 + the expected uplift) it moved
  // Property's normal losses with the shock catalogue even in a game whose
  // shocks are off.
  const fold = ROUTINE_FOLD_NET_OF_UPLIFT.enabled
    ? routinePer100 / (1 + upliftMoments(line, yearNumber).mean) : routinePer100;
  foldMemo.set(key, fold);
  return fold;
}

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
  // THE BOOK'S SIZE-WEIGHTED MEAN TRUE RISK (bookOrdinaryRisk), since book
  // units commit 3: each unit's ordinary loss is its exposure x its risk x the
  // line's cost, so the book's expected ordinary loss — and the uplift on it —
  // carries its risk. 1 is the market's, and what a reader with no book means.
  // ⚠ AND ITS ROUTINE LARGE LOSSES SINCE BOOK UNITS COMMIT 5: they land on the
  // units by size x risk, and their count is on exposure x risk.
  bookRisk = 1,
  // ⚠ THE GAME'S SHOCK SWITCH (shockLosses.gameShocksOn). Off, the expectation
  // is what the game can draw: ordinary losses and any routine large losses,
  // with no uplift and no shock large losses. On (the default — a hosted game
  // with a schedule, or a harness on the catalogue), the shocks at the
  // catalogue's probabilities, as before.
  shocks = true,
): ExpectedLossBreakdown {
  const ordinary = exposure * 10_000 * ordinaryLossCostPer100(line, yearNumber) * bookRisk;
  const large = largeLossMoments(line, exposure, yearNumber, x => poolShare(line, x), () => poolKinks(line), true, routineOn,
    false, bookRisk);
  if (!shocks) {
    return { ordinary, uplift: 0, shockLarge: 0, routineLarge: large.routine, total: ordinary + large.routine, byEvent: new Map() };
  }
  const u = upliftMoments(line, yearNumber);
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
 * large losses.
 *
 * ⚠ EX ANTE IN EVERY YEAR, THE PRE-GAME INCLUDED (Prompt A commit 2). A price
 * is struck before the year on the catalogue's probabilities, so a pre-game
 * year's tower is priced exactly as a game year's: the prior board paid the
 * market price for shock cover and simply had quiet years. Until then the
 * shocks were left out before year 1 — "nothing fires then" — which priced
 * Property's layers at the routine claims alone and its Prior ceded premium
 * at nothing beside game years' $1M. `exAnte = false` asks instead what the
 * year's losses actually were expected to cede, which before year 1 is the
 * routine claims only.
 */
export function newEngineLayerMoments(
  line: TowerLine, exposure: number, yearNumber: number, exAnte = true,
  // The book's size-weighted true risk, on the routine claims (see largeLossMoments).
  routineRisk = 1,
): NewEngineLayerMoments[] {
  return REINSURANCE_TOWER[line].map(l => {
    const c = layerCession(line, l);
    const m = largeLossMoments(line, exposure, yearNumber, c.h, c.kinks, false, ROUTINE_LARGE_LOSSES.enabled, exAnte, routineRisk);
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
  // A typical book's line-level CV: the aggregate is priced with no book in hand.
  const cv = typicalBookOrdinaryCv(line);
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
 *
 * ⚠ AND ZERO WHEN THE GAME'S SHOCKS ARE OFF (shockLosses.gameShocksOn), like
 * the expectation: a game in which no catastrophe can fire holds no capital
 * for one. With a schedule, or on a harness's catalogue, it returns.
 */
export function newEngineCatCapital(
  line: CoverageLine, exposure: number, yearNumber: number, placed: readonly boolean[] | null,
  // The team's reinsurance option. With AGGREGATE_STOP on it names the stop,
  // and the retained catastrophe is what the stop leaves (stopCatRetained).
  stopOptionId?: string,
  /** The game's shock switch (shockLosses.gameShocksOn); absent is on. */
  shocks = true,
): number {
  if (line !== 'Property' || !(exposure > 0) || !shocks) return 0;
  if (AGGREGATE_STOP.enabled && stopOptionId !== undefined) return stopCatRetained(line, exposure, yearNumber, stopOptionId);
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

/**
 * PROPERTY'S CATASTROPHE CAPITAL BEHIND THE AGGREGATE STOP (stable-scenarios
 * commit 6): what the pool retains, in expectation, from ONE regional
 * catastrophe that happens, weighted by how often each occurs — the year's
 * total taken as its expected losses plus the catastrophe, and the stop paying
 * on that total under the terms the year is written on. Each catastrophe's
 * losses are taken together, as one lognormal around its size (the one-
 * occurrence form above), since the stop sees the year's sum, not each claim.
 */
function stopCatRetained(line: CoverageLine, exposure: number, yearNumber: number, optionId: string): number {
  const o = AGGREGATE_STOP_OPTIONS.find(x => x.id === optionId);
  if (!o) throw new Error(`newEngineCatCapital: '${optionId}' is not an aggregate stop option`);
  const e = expectedLossBreakdown(line, exposure, yearNumber).total;
  const attachment = o.attachment * e, limit = o.limit * e;
  // Retained of a catastrophe x: x less what the stop pays on e + x.
  const h = (x: number) => x - Math.min(Math.max(e + x - attachment, 0), limit);
  const kinks = limit > 0 ? [attachment - e, attachment - e + limit].filter(k => k > 0) : [];
  let weight = 0, retained = 0;
  for (const ev of SHOCK_EVENTS) {
    if (!ev.regional) continue;
    const row = eventLines(ev.name).find(r => r.line === line && r.t !== 'None');
    if (!row) continue;
    const g = shockTrendFactor(line, yearNumber);
    const [lo, hi] = SHOCK_T_CLAIM_RANGE[line][row.t as Exclude<ShockLevel, 'None'>].map(v => v * g);
    weight += ev.probability;
    retained += ev.probability * overUniformPw(lo, hi, kinks, h);
  }
  return weight > 0 ? retained / weight : 0;
}
