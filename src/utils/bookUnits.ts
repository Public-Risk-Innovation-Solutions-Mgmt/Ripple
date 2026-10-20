// ============================================================================
// BOOK UNITS — each line's exposure split across individual units.
//
// A BOOK UNIT IS NOT A MEMBER. The dormant member engine (MEMBER_LEVEL) has
// its own roster, catalogue and claim generators; a unit is the new engine's
// way of giving a line's book a composition — sizes, risks, regions — so that
// underwriting changes what the book is and not only how big it is. Units are
// NEVER SHOWN: no screen, export or host view reads one, and every result
// stays at line level.
//
// THE MARKET: UNIT_MARKET_COUNT units per line, drawn from the GAME's seed
// (the instance seed, never a world's), each quantity on its own labelled
// sub-stream so nothing else's draws move:
//   size    lognormal, CV UNIT_SIZE_CV, scaled so the market sums EXACTLY to
//           FULL_MARKET_EXPOSURE (base-year $M)
//   risk    lognormal, CV UNIT_RISK_CV, scaled so the market's SIZE-WEIGHTED
//           mean is exactly 1.0 — the market costs the line's own expected
//           ordinary loss cost, so a book that differs from it in risk
//           differs in its losses
//   region  drawn by REGION_EXPOSURE_SHARE
//   noiseZ  a standard normal, drawn once: the noise in what underwriting
//           sees of the unit's risk (read from book units commit 4)
// The market is a pure function of (seed, line). It is never stored: it is
// regenerated, and memoised per process.
//
// THE BOOK: the units the pool holds. At the opening, the market in a seeded
// order until the book first reaches UNIT_POOL_SHARE of the market's exposure
// — about 60 units. Only the indices are stored, once per game, on the game's
// pool state (PoolState.bookUnits); every world holds the same book.
// ============================================================================

import {
  FULL_MARKET_EXPOSURE, UNIT_MARKET_COUNT, UNIT_POOL_SHARE, UNIT_RISK_CV, UNIT_SIZE_CV, regionByShare,
} from '../data/pricingParameters';
import { deriveSubRng } from './random';
import { bookOrdinaryRisk } from './ordinaryLoss';
import type { CoverageLine, Region } from '../types/simulation';

/** One unit of a line's market. Never shown. */
export interface BookUnit {
  /** Its position in the line's market, 0 to UNIT_MARKET_COUNT − 1. */
  index: number;
  /** Base-year exposure, $M. */
  size: number;
  /** True risk score; the market's size-weighted mean is 1.0. */
  risk: number;
  region: Region;
  /** Standard normal: the noise in underwriting's view of its risk. */
  noiseZ: number;
}

const lognormalParams = (cv: number) => {
  const s2 = Math.log(1 + cv * cv);
  return { mu: -s2 / 2, sigma: Math.sqrt(s2) };
};

const MARKETS = new Map<string, readonly BookUnit[]>();

/** The line's market, from the game's seed. Pure; memoised. */
export function marketUnits(seed: number, line: CoverageLine): readonly BookUnit[] {
  const key = `${seed}|${line}`;
  const hit = MARKETS.get(key);
  if (hit) return hit;
  const n = UNIT_MARKET_COUNT;
  const sizeRng = deriveSubRng(seed, 0, `unit_size_${line}`);
  const riskRng = deriveSubRng(seed, 0, `unit_risk_${line}`);
  const regionRng = deriveSubRng(seed, 0, `unit_region_${line}`);
  const noiseRng = deriveSubRng(seed, 0, `unit_noise_${line}`);
  const s = lognormalParams(UNIT_SIZE_CV), r = lognormalParams(UNIT_RISK_CV);
  const rawSize = Array.from({ length: n }, () => sizeRng.lognormal(s.mu, s.sigma));
  const rawRisk = Array.from({ length: n }, () => riskRng.lognormal(r.mu, r.sigma));
  const sizeScale = FULL_MARKET_EXPOSURE[line] / rawSize.reduce((a, b) => a + b, 0);
  const size = rawSize.map(x => x * sizeScale);
  const weighted = size.reduce((a, x, i) => a + x * rawRisk[i], 0) / FULL_MARKET_EXPOSURE[line];
  const units = size.map((x, i) => ({
    index: i, size: x, risk: rawRisk[i] / weighted,
    region: regionByShare(regionRng.next()), noiseZ: noiseRng.normal(0, 1),
  }));
  MARKETS.set(key, units);
  return units;
}

/**
 * The opening book: the market in a seeded order until the book first
 * reaches UNIT_POOL_SHARE of the market's exposure. Sorted indices.
 */
export function openingBookUnits(seed: number, line: CoverageLine): number[] {
  const market = marketUnits(seed, line);
  const rng = deriveSubRng(seed, 0, `unit_pool_${line}`);
  const order = market.map(u => u.index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const target = UNIT_POOL_SHARE * FULL_MARKET_EXPOSURE[line];
  const book: number[] = [];
  let held = 0;
  for (const i of order) {
    if (held >= target) break;
    book.push(i);
    held += market[i].size;
  }
  return book.sort((a, b) => a - b);
}

/** The seed a game's market is drawn from, on any copy of its instance. */
export const marketSeedOf = (instance: { seed: number; marketSeed?: number }): number =>
  instance.marketSeed ?? instance.seed;

/** A book's exposure: its units' sizes summed, base-year $M. */
export const bookSizeOf = (seed: number, line: CoverageLine, indices: readonly number[]): number =>
  indices.reduce((a, i) => a + marketUnits(seed, line)[i].size, 0);

/** The units a book holds, from its indices. */
export const unitsOf = (seed: number, line: CoverageLine, indices: readonly number[]): BookUnit[] => {
  const market = marketUnits(seed, line);
  return indices.map(i => market[i]);
};

/**
 * A line's book's size-weighted true risk (bookOrdinaryRisk) — what its
 * expected loss and its tower's price carry — or undefined when the line holds
 * no book of units. For pricing a book outside the engine: the engine reads it
 * off the year's own units.
 */
export const lineBookRisk = (
  instance: { seed: number; marketSeed?: number },
  line: CoverageLine,
  bookUnits: Partial<Record<CoverageLine, number[]>> | undefined,
): number | undefined => {
  const indices = bookUnits?.[line];
  return indices ? bookOrdinaryRisk(unitsOf(marketSeedOf(instance), line, indices)) : undefined;
};
