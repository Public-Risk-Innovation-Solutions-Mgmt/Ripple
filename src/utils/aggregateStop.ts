// ============================================================================
// THE AGGREGATE STOP, PER LINE (stable-scenarios commit 6).
//
// A stop on the ACCIDENT-YEAR TOTAL — ordinary losses, the shocks' uplift and
// their large losses together — attaching at a share of the year's expected
// losses and paying up to a further share. See AGGREGATE_STOP in
// pricingParameters.ts for the options and the rule.
//
//   TERMS      fixed when the year is written: attachment and limit in dollars,
//              each its share x the year's expected losses (stopTerms).
//   RECOVERY   min(max(total - attachment, 0), limit) on the year's gross
//              ultimate (stopRecovery) — at booking, and again at every
//              valuation as the year develops, the change booked as a
//              prior-year reinsurance adjustment (simulationEngine).
//   PRICE      E[recovery] + AGGREGATE_STOP_SD_LOAD x SD[recovery], no floor,
//              over the accident year's distribution (stopQuote).
//
// ⚠ THE DISTRIBUTION IS SAMPLED ONCE PER LINE, IN STANDARD UNITS, AND RESCALED.
// Each sample holds the year's ordinary factor, its uplift (for an accident
// year one, two, or three-plus years into the game, since a shock's uplift
// lasts its duration) and the sizes of its shock large losses in units of the
// line's T scale. A book and year then cost one pass: ordinary = the book's
// expected ordinary x factor x (1 + uplift), large = the sum of each size x
// the T scale, capped per claim where the pool's limit applies. The draw
// mirrors the engine's: a lognormal year factor at the typical book's CV, each
// event's A uniform in its range (regional ones on the struck region's share,
// drawn by share), and each event's T as `count` lognormal claims around its
// uniform-drawn size — at the catalogue's probabilities, which is what a price
// is (ex ante; the pre-game years are priced as year 1's).
// ============================================================================

import {
  AGGREGATE_STOP_OPTIONS, AGGREGATE_STOP_SAMPLES, AGGREGATE_STOP_SD_LOAD, R_MODEL, SHOCK_A_YEARS,
  SHOCK_T_CLAIM_RANGE, type AggregateStopOption,
} from '../data/pricingParameters';
import { DECAY, SHOCK_EVENTS, eventLines, poolShare, type ShockLevel } from './shockLosses';
import { ordinaryFactorParams, ordinaryLossCostPer100, typicalBookOrdinaryCv } from './ordinaryLoss';
import { expectedLossBreakdown } from './shockExpectation';
import { shockTrendFactor } from './shockCost';
import { deriveSubRng } from './random';
import type { CoverageLine } from '../types/simulation';

/** The stop's terms for one accident year, in dollars. */
export interface StopTerms { optionId: string; attachment: number; limit: number }

export function stopOption(optionId: string): AggregateStopOption {
  const o = AGGREGATE_STOP_OPTIONS.find(x => x.id === optionId);
  if (!o) throw new Error(`aggregateStop: '${optionId}' is not an aggregate stop option`);
  return o;
}

export const isStopOption = (id: unknown): id is string =>
  typeof id === 'string' && AGGREGATE_STOP_OPTIONS.some(o => o.id === id);

/** The terms a year is written on: each share x the year's expected losses. */
export function stopTerms(optionId: string, expectedLoss: number): StopTerms {
  const o = stopOption(optionId);
  return { optionId, attachment: o.attachment * expectedLoss, limit: o.limit * expectedLoss };
}

/** What the stop pays on a year's total. */
export const stopRecovery = (total: number, t: { attachment: number; limit: number }): number =>
  Math.min(Math.max(total - t.attachment, 0), t.limit);

/** The player's wording, e.g. "Covers the year's losses above 115% of expected, up to 50% more." */
export function stopWording(optionId: string): string {
  const o = stopOption(optionId);
  if (o.limit === 0) return 'No cover: the Pool keeps every loss.';
  return `Covers the year's losses above ${Math.round(o.attachment * 100)}% of expected, up to ${Math.round(o.limit * 100)}% more.`;
}

// --- the samples ------------------------------------------------------------

interface LineSamples {
  /** The year's ordinary factor, mean 1. */
  factor: Float64Array;
  /** The uplift on ordinary losses, by how many years of firings reach the year: [1, 2, 3+]. */
  uplift: [Float64Array, Float64Array, Float64Array];
  /** Shock large-loss claims: sample i's sizes are sizes[start[i] .. start[i + 1]), in T-scale units. */
  start: Int32Array;
  sizes: Float64Array;
}

const MAX_AGES = 3;
const SAMPLE_SEED = 20_261_021;
const sampleCache = new Map<string, LineSamples>();

function samplesFor(line: CoverageLine): LineSamples {
  const key = `${line}|${SHOCK_EVENTS.reduce((a, e) => a + e.probability, 0)}|${typicalBookOrdinaryCv(line)}`;
  const hit = sampleCache.get(key);
  if (hit) return hit;
  const n = AGGREGATE_STOP_SAMPLES;
  const rng = deriveSubRng(SAMPLE_SEED, 0, `aggregate_stop_${line}`);
  const { mu, sigma } = ordinaryFactorParams(typicalBookOrdinaryCv(line));
  const factor = new Float64Array(n);
  const uplift: [Float64Array, Float64Array, Float64Array] = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  const start = new Int32Array(n + 1);
  const sizes: number[] = [];
  // Per event, what it does to this line.
  const events = SHOCK_EVENTS.map(e => {
    const rows = eventLines(e.name).filter(r => r.line === line);
    const a = rows.filter(r => r.a !== 'None').map(r => R_MODEL.aShock[line][r.a as Exclude<ShockLevel, 'None'>]);
    const tRow = rows.find(r => r.t !== 'None');
    return {
      e,
      a,
      inflation: e.name === 'Economic Inflation' ? R_MODEL.economicInflationInitialRate : 0,
      t: tRow ? SHOCK_T_CLAIM_RANGE[line][tRow.t as Exclude<ShockLevel, 'None'>] : null,
    };
  });
  for (let i = 0; i < n; i++) {
    factor[i] = rng.lognormal(mu, sigma);
    let u1 = 0, u2 = 0, u3 = 0;
    for (const ev of events) {
      for (let age = 0; age < Math.min(ev.e.duration, MAX_AGES); age++) {
        if (!(rng.next() < ev.e.probability)) continue;
        // Economic Inflation decays over its duration; an A lasts its firing
        // year only, on the whole line (SHOCK_A_YEARS) — as the engine draws them.
        let a = ev.inflation * Math.pow(DECAY, age);
        for (const [lo, hi] of ev.a) { const x = lo + rng.next() * (hi - lo); if (age < SHOCK_A_YEARS) a += x; }
        const d = a;
        // An event `age` years old reaches an accident year at least age + 1 into the game.
        if (age < 1) u1 += d;
        if (age < 2) u2 += d;
        u3 += d;
        // Its large losses land in the year it fires.
        if (age === 0 && ev.t) sizes.push(ev.t[0] + rng.next() * (ev.t[1] - ev.t[0]));
      }
    }
    uplift[0][i] = u1; uplift[1][i] = u2; uplift[2][i] = u3;
    start[i + 1] = sizes.length;
  }
  const out: LineSamples = { factor, uplift, start, sizes: Float64Array.from(sizes) };
  sampleCache.set(key, out);
  return out;
}

// --- the quote --------------------------------------------------------------

export interface StopQuote {
  optionId: string;
  /** The year's expected losses the terms are shares of. */
  expectedLoss: number;
  attachment: number;
  limit: number;
  expectedRecovery: number;
  sdRecovery: number;
  /** The share of years in which the stop pays anything. */
  payFrequency: number;
  /** expectedRecovery + AGGREGATE_STOP_SD_LOAD x sdRecovery. */
  premium: number;
  /** premium / limit — the rate on line. */
  rateOnLine: number;
}

/** The accident year's total in each sample, in dollars, for a book and year. */
export function sampledYearTotals(
  line: CoverageLine, exposure: number, yearNumber: number, bookRisk = 1,
  // The game's shock switch (shockLosses.gameShocksOn). Off, each sample is
  // the ordinary year alone — the same draws, with no uplift and no shock
  // large losses — which is all a game with its shocks off can produce.
  shocks = true,
): Float64Array {
  const s = samplesFor(line);
  const ordinary = exposure * 10_000 * ordinaryLossCostPer100(line, yearNumber) * bookRisk;
  const out = new Float64Array(s.factor.length);
  if (!shocks) {
    for (let i = 0; i < out.length; i++) out[i] = ordinary * s.factor[i];
    return out;
  }
  const ages = Math.min(MAX_AGES, Math.max(1, yearNumber)) - 1;
  const u = s.uplift[ages];
  // ⚠ THE T SIZES ARE THE TABLE'S, GROWN HERE BY THE LINE'S TREND as the
  // expectation grows them (shockExpectation.conditionalEventMoments): unscaled,
  // the stop was struck on a year up to 7% lighter than its own attachment
  // basis by year 10 (aggregate-stop-check 2).
  const g = shockTrendFactor(line, yearNumber);
  for (let i = 0; i < out.length; i++) {
    let large = 0;
    for (let k = s.start[i]; k < s.start[i + 1]; k++) large += poolShare(line, s.sizes[k] * g);
    out[i] = ordinary * s.factor[i] * (1 + u[i]) + large;
  }
  return out;
}

const quoteCache = new Map<string, StopQuote[]>();

/** Every option's quote for a book and year. */
export function stopQuotes(
  line: CoverageLine, exposure: number, yearNumber: number, bookRisk = 1,
  // ⚠ THE GAME'S SHOCK SWITCH — the terms (attachment and limit are shares of
  // the expectation) and the distribution the price is struck on both follow
  // it, so a game with its shocks off attaches at its own ordinary mean and
  // pays for recoveries it can actually have.
  shocks = true,
): StopQuote[] {
  const key = `${line}|${yearNumber}|${exposure}|${bookRisk}|${shocks}|${SHOCK_EVENTS.reduce((a, e) => a + e.probability, 0)}`;
  const hit = quoteCache.get(key);
  if (hit) return hit;
  const expectedLoss = expectedLossBreakdown(line, exposure, yearNumber, undefined, bookRisk, shocks).total;
  const totals = sampledYearTotals(line, exposure, yearNumber, bookRisk, shocks);
  const quotes = AGGREGATE_STOP_OPTIONS.map(o => {
    const t = stopTerms(o.id, expectedLoss);
    let m1 = 0, m2 = 0, pays = 0;
    if (t.limit > 0) {
      for (let i = 0; i < totals.length; i++) {
        const r = stopRecovery(totals[i], t);
        m1 += r; m2 += r * r;
        if (r > 0) pays++;
      }
    }
    const n = totals.length;
    const mean = m1 / n;
    const sd = Math.sqrt(Math.max(0, m2 / n - mean * mean));
    const premium = mean + AGGREGATE_STOP_SD_LOAD * sd;
    return {
      optionId: o.id, expectedLoss, attachment: t.attachment, limit: t.limit,
      expectedRecovery: mean, sdRecovery: sd, payFrequency: pays / n, premium,
      rateOnLine: t.limit > 0 ? premium / t.limit : 0,
    };
  });
  if (quoteCache.size > 4096) quoteCache.clear();
  quoteCache.set(key, quotes);
  return quotes;
}

export function stopQuote(
  line: CoverageLine, optionId: string, exposure: number, yearNumber: number, bookRisk = 1, shocks = true,
): StopQuote {
  stopOption(optionId);
  return stopQuotes(line, exposure, yearNumber, bookRisk, shocks).find(q => q.optionId === optionId)!;
}
