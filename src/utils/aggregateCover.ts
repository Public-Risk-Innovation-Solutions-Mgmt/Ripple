// ============================================================================
// THE AGGREGATE COVER ON ATTRITIONAL LOSSES (wip/aggregate-cover).
//
// One option per line per year, bought beside the per-claim layer. It covers
// the year's ATTRITIONAL losses — normal losses plus the shocks' surges (A) —
// and nothing else. See AGGREGATE_COVER_OPTIONS in pricingParameters.ts for the
// rule, the reason and the source (the pricing workbook's "Agg Attritional" tab).
//
//   TERMS      struck with the price, on the book the rate is quoted on:
//              expected normal losses (exposure x the ordinary cost per $100)
//              x (1 + the average surge), times each option's shares
//              (aggregateCoverQuote).
//   RECOVERY   min(max(actual attritional - attachment, 0), limit), once, when
//              the accident year is booked (aggregateCoverRecovery). Actual
//              attritional is the year's normal losses as booked x (1 + its A
//              surges) — attritionalLoss. Large claims and the development of
//              older years never reach it, so it is never recalculated.
//   PRICE      the four-case method below, x the option's load.
//
// ⚠ THE PRICE ASSUMES SURGES AT THE SHOCK ASSUMPTIONS' ODDS (T_COVER_FREQUENCY,
// one surge level a year at most). The game's surges come from its event
// catalogue, at other odds; expectedRecoveryToday measures what they give, so
// the screens can show the two side by side until they agree.
// ============================================================================

import {
  AGGREGATE_COVER_DEFAULT, AGGREGATE_COVER_OPTIONS, AGGREGATE_COVER_SURGE_BASIS, R_MODEL, SHOCK_A_YEARS, coversInEveryGame,
  T_COVER_FREQUENCY, type AggregateCoverOption,
} from '../data/pricingParameters';
import { ordinaryLossCostPer100, typicalBookOrdinaryCv } from './ordinaryLoss';
import { SHOCK_EVENTS, eventLines, type ShockLevel } from './shockLosses';
import { deriveSubRng } from './random';
import type { CoverageLine } from '../types/simulation';

const LEVELS = ['Low', 'Mid', 'High'] as const;
type Level = typeof LEVELS[number];

export function aggregateCoverOption(optionId: string): AggregateCoverOption {
  const o = AGGREGATE_COVER_OPTIONS.find(x => x.id === optionId);
  if (!o) throw new Error(`aggregateCover: '${optionId}' is not an aggregate cover option`);
  return o;
}

// --- the wording ----------------------------------------------------------------
// What players read wherever the cover is offered or shown — the Decisions page,
// the Rate Indication, the Year Walkthrough, the Model tab and the host's table.
// Every percentage is built from the option's attachment and limit, so a changed
// layer relabels itself.
export const AGGREGATE_COVER_TITLE = 'Aggregate Stop-Loss Coverage';
export const AGGREGATE_COVER_NOTE =
  'Protects against annual attritional losses exceeding a selected percentage of expected losses, up to the coverage limit.';
export const AGGREGATE_COVER_FOOTNOTE =
  'Coverage pays 100% of eligible losses between the attachment point and the exhaustion point.';

const pctOf = (x: number) => `${Number((x * 100).toFixed(2))}%`;

/**
 * An option's label: its name — "110% / 50%", or "None" — and what it covers —
 * "Covers losses from 110% to 160% of expected" (attachment to attachment +
 * limit), or "No Coverage" — and the two as one line, "<name> — <covers>".
 */
export function aggregateCoverLabel(optionId: string): { name: string; covers: string; label: string } {
  const o = aggregateCoverOption(optionId);
  const covers = o.limit > 0
    ? `Covers losses from ${pctOf(o.attachment)} to ${pctOf(o.attachment + o.limit)} of expected`
    : 'No Coverage';
  return { name: o.name, covers, label: `${o.name} — ${covers}` };
}

export const isAggregateCoverOption = (id: unknown): id is string =>
  typeof id === 'string' && AGGREGATE_COVER_OPTIONS.some(o => o.id === id);

/** A line's choice, absent read as the default (None). */
export const aggregateCoverOf = (d: { aggregateCover?: string }): string => d.aggregateCover ?? AGGREGATE_COVER_DEFAULT;

/**
 * The options offered. ⚠ THE SAME RULE AS THE PER-CLAIM COVERS
 * (COVERS_IN_EVERY_GAME): on, all four in every game — single player, Test
 * player and hosted, shocks on or off, events scheduled or not — at the same
 * prices; off, None alone while the game's shocks are off. With no shocks the
 * cover can still pay, on a bad ordinary year.
 */
export const aggregateCoverOptionIds = (shocks = true): string[] =>
  shocks || coversInEveryGame() ? AGGREGATE_COVER_OPTIONS.map(o => o.id) : [AGGREGATE_COVER_DEFAULT];

// --- the surge cases --------------------------------------------------------

/** A level's surge as priced: the top of its range, or its middle (AGGREGATE_COVER_SURGE_BASIS). */
export function pricedSurge(line: CoverageLine, level: Level, basis = AGGREGATE_COVER_SURGE_BASIS.basis): number {
  const [lo, hi] = R_MODEL.aShock[line][level];
  return basis === 'maximum' ? hi : (lo + hi) / 2;
}

/** The four cases a year, as [chance, surge]: no surge, then Low, Mid and High at the shock assumptions' odds. */
export function surgeCases(line: CoverageLine, basis = AGGREGATE_COVER_SURGE_BASIS.basis): [number, number][] {
  const surged = LEVELS.map(l => [T_COVER_FREQUENCY[l], pricedSurge(line, l, basis)] as [number, number]);
  return [[1 - surged.reduce((s, c) => s + c[0], 0), 0], ...surged];
}

/** The average surge the terms are struck on — over the same cases the price is. */
export const averageSurge = (line: CoverageLine, basis = AGGREGATE_COVER_SURGE_BASIS.basis): number =>
  surgeCases(line, basis).reduce((s, [p, a]) => s + p * a, 0);

// --- the normal layer -------------------------------------------------------

// Φ to about 1e-15: the series for erf inside |z| < 3, the continued fraction
// for erfc beyond. claimMath.normalCdf's 1.5e-7 would put a few dollars of
// error on a price the workbook states to the dollar.
function erfc(x: number): number {
  const ax = Math.abs(x);
  let r: number;
  if (ax < 3) {
    let term = ax, sum = ax;
    for (let n = 1; n < 200; n++) {
      term *= -ax * ax / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17) break;
    }
    r = 1 - (2 / Math.sqrt(Math.PI)) * sum;
  } else {
    // Lentz on erfc(x) = exp(-x²)/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + ...))))
    let f = ax, c = ax, d = 0;
    for (let k = 1; k < 300; k++) {
      const a = k / 2;
      d = ax + a * d; d = 1 / d;
      c = ax + a / c;
      const delta = c * d;
      f *= delta;
      if (Math.abs(delta - 1) < 1e-16) break;
    }
    r = Math.exp(-ax * ax) / Math.sqrt(Math.PI) / f;
  }
  return x >= 0 ? r : 2 - r;
}
const Phi = (z: number) => 0.5 * erfc(-z / Math.SQRT2);
const phi = (z: number) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);

/** E[max(X - k, 0)] for X normal, mean m, SD s. */
function excess(m: number, s: number, k: number): number {
  const z = (m - k) / s;
  return (m - k) * Phi(z) + s * phi(z);
}

/** E[min(max(X - a, 0), limit)] for X normal, mean m, SD s. */
export const normalLayer = (m: number, s: number, a: number, limit: number): number =>
  excess(m, s, a) - excess(m, s, a + limit);

// --- the quote ---------------------------------------------------------------

export interface AggregateCoverQuote {
  optionId: string;
  /** The year's expected normal losses: exposure x the ordinary cost per $100. */
  expectedNormal: number;
  /** The average surge the terms are struck on. */
  averageSurge: number;
  /** expectedNormal x (1 + averageSurge). */
  expectedAttritional: number;
  attachment: number;
  limit: number;
  /** At the shock assumptions' odds, in dollars. */
  expectedRecovery: number;
  /** expectedRecovery x the option's load. */
  price: number;
}

/** An option's quote for a book of `exposure` ($M) in accident year `yearNumber`. None is all zeros. */
export function aggregateCoverQuote(
  line: CoverageLine, optionId: string, exposure: number, yearNumber: number,
  basis = AGGREGATE_COVER_SURGE_BASIS.basis,
): AggregateCoverQuote {
  const o = aggregateCoverOption(optionId);
  const expectedNormal = exposure * 10_000 * ordinaryLossCostPer100(line, yearNumber);
  const avg = averageSurge(line, basis);
  const expectedAttritional = expectedNormal * (1 + avg);
  if (o.limit <= 0) {
    return { optionId, expectedNormal, averageSurge: avg, expectedAttritional, attachment: 0, limit: 0, expectedRecovery: 0, price: 0 };
  }
  // In units of expected normal losses: the attachment and limit, and each case's level.
  const a = o.attachment * (1 + avg), l = o.limit * (1 + avg);
  const cv = typicalBookOrdinaryCv(line);
  const perUnit = surgeCases(line, basis).reduce((s, [p, surge]) => s + p * normalLayer(1 + surge, cv * (1 + surge), a, l), 0);
  const expectedRecovery = perUnit * expectedNormal;
  return {
    optionId, expectedNormal, averageSurge: avg, expectedAttritional,
    attachment: o.attachment * expectedAttritional, limit: o.limit * expectedAttritional,
    expectedRecovery, price: expectedRecovery * o.load,
  };
}

/**
 * The year's actual attritional losses, as the engine books them: the drawn
 * normal losses x (1 - the risk control cut + the A surges) x underwriting's
 * new-business factor. Returns the normal part, the surge part and their sum.
 */
export function attritionalLoss(drawnNormal: number, cut: number, aSurge: number, penalty: number): {
  normalLoss: number; surgeLoss: number; attritional: number;
} {
  const normalLoss = drawnNormal * (1 - cut) * penalty;
  const surgeLoss = drawnNormal * aSurge * penalty;
  return { normalLoss, surgeLoss, attritional: normalLoss + surgeLoss };
}

/** The A surges in a line's year: every firing's uplift but Economic Inflation's, which is not an A. */
export const aSurgeOf = (byFiring: readonly { firing: { event: { name: string } }; uplift: number }[]): number =>
  byFiring.reduce((s, b) => s + (b.firing.event.name === 'Economic Inflation' ? 0 : b.uplift), 0);

/** What the cover pays on a year's attritional losses. */
export const aggregateCoverRecovery = (attritional: number, t: { attachment: number; limit: number }): number =>
  Math.min(Math.max(attritional - t.attachment, 0), t.limit);

// --- today's surges ----------------------------------------------------------

const TODAY_SAMPLES = 200_000;
const todayCache = new Map<string, Float64Array>();

/**
 * The year's A surge on a line under the game's own catalogue, sampled once per
 * line: each event fires with its scaled probability, independently, and an
 * event with an A on the line adds its level drawn evenly in its range — as
 * resolveShockYear draws a firing year (SHOCK_A_YEARS). Economic Inflation is
 * not an A, so it is not here.
 */
function todaySurges(line: CoverageLine): Float64Array {
  const key = `${line}|${SHOCK_EVENTS.reduce((s, e) => s + e.probability, 0)}`;
  const hit = todayCache.get(key);
  if (hit) return hit;
  const events = SHOCK_EVENTS.flatMap(e => eventLines(e.name)
    .filter(r => r.line === line && r.a !== 'None')
    .map(r => ({ p: e.probability, range: R_MODEL.aShock[line][r.a as Exclude<ShockLevel, 'None'>] })));
  const rng = deriveSubRng(20_261_029, 0, `aggregate_cover_today_${line}`);
  const out = new Float64Array(TODAY_SAMPLES);
  for (let i = 0; i < TODAY_SAMPLES; i++) {
    let s = 0;
    for (const e of events) {
      const fires = rng.next() < e.p;
      const u = rng.next();
      if (fires && SHOCK_A_YEARS > 0) s += e.range[0] + u * (e.range[1] - e.range[0]);
    }
    out[i] = s;
  }
  todayCache.set(key, out);
  return out;
}

/**
 * THE EXPECTED RECOVERY UNDER TODAY'S SURGES — the same terms and the same
 * normal luck, with the year's surge drawn from the game's catalogue instead of
 * the shock assumptions' four cases. Display only: what the game's recoveries
 * average while its surges keep their own odds.
 */
export function expectedRecoveryToday(line: CoverageLine, q: AggregateCoverQuote): number {
  if (q.limit <= 0 || q.expectedNormal <= 0) return 0;
  const a = q.attachment / q.expectedNormal, l = q.limit / q.expectedNormal;
  // Per unit of expected normal losses it depends only on the line and the
  // terms' shares, so one pass serves every book and year.
  const key = `${line}|${a}|${l}|${SHOCK_EVENTS.reduce((s, e) => s + e.probability, 0)}`;
  let perUnit = todayPerUnit.get(key);
  if (perUnit === undefined) {
    const surges = todaySurges(line);
    const cv = typicalBookOrdinaryCv(line);
    let sum = 0;
    for (let i = 0; i < surges.length; i++) sum += normalLayer(1 + surges[i], cv * (1 + surges[i]), a, l);
    perUnit = sum / surges.length;
    if (todayPerUnit.size > 256) todayPerUnit.clear();
    todayPerUnit.set(key, perUnit);
  }
  return perUnit * q.expectedNormal;
}
const todayPerUnit = new Map<string, number>();
