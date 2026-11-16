// ============================================================================
// THE MARKET STEP — one line of one year of a hosted room's market competition.
//
// PURE AND DETERMINISTIC: the server runs it once, when the host advances past a
// year, from the rates the teams posted with their locks; the result is stored
// with the room and every team's game reads it (and replays read the same stored
// result), so no browser ever runs this. The gate (scripts/diagnostics/
// market-step-check.ts) recomputes it independently from the stored inputs.
//
// By formula — no individual members. A book is MARKET_MEMBERS_PER_BOOK notional
// members (1% each) only as the grain the quality draws are made in.
//
// In order, per line:
//   0. Every team's book risk fades MARKET_BOOK_RISK_FADE of the way to 1.00.
//   1. SUPPLY — each team's willing leavers: for each cheaper rival j, the pull
//      k × (pair gap − 1%)²; the pulls averaged over the N − 1 rivals × 4, ±20%
//      drawn, capped at 15% of the book; drawn as whole members, shared among
//      the cheaper rivals by pull, each member's quality from the buckets tilted
//      by ITS pair's gap.
//   2. DEMAND — a team takes in at most New Members × its book this year.
//   3. MATCHING (no team beyond its appetite):
//      a. good leavers ask the cheaper teams with room, split by pull; teams
//         answer cheapest first, taking the best askers; repeated until nothing
//         more matches. Unmatched leavers stay (and start fresh next year).
//      b. outside supply: MARKET_OUTSIDE_SUPPLY × the room's book plus last
//         year's untaken dropped members, drawn at the even mix, SHARED BY A WIDE
//         TAPER: every team is eligible, weight 1 at or below the room's average
//         rate and 1 − (its rate ÷ the average − 1) ÷ MARKET_OUTSIDE_TAPER (20%)
//         above it, 0 from 20% above. Each team gets the supply × its weight ÷ the
//         weights of the teams with room left, never past its appetite; what a
//         full team cannot take passes to the others, again by weight, until the
//         supply or the room runs out. Every team's newcomers carry the SAME MIX
//         (MARKET_OUTSIDE_QUALITY): the average risk of the year's draw, not the
//         cheapest picking the best first.
//      c. non-renewed members (each team's Non-Renewal × its book after a and b)
//         are taken by NO team: they leave the market, and next year's outside
//         supply refills them (3b). Their quality — tilted to the worst, mean
//         1.5 − ½ × the share — is what the dropping team's relief implies.
//   4. Each team's book after the moves, its book risk (the risk mass over the
//      book; the dropped members are left for the engine, which drops them and
//      applies today's relief), and the share of that book the engine drops.
// ============================================================================

import {
  MARKET_BOOK_RISK_FADE, MARKET_BUCKET_BASE_MIX, MARKET_BUCKETS_RAW, MARKET_COUNT_SPREAD, MARKET_FULL_SKEW_GAP,
  MARKET_FULL_SKEW_MEAN, MARKET_K, MARKET_LEAVER_CAP, MARKET_MEMBERS_PER_BOOK, MARKET_MIN_GAP, MARKET_OUTSIDE_SUPPLY,
  MARKET_OUTSIDE_TAPER, MARKET_RIVAL_SCALE, NON_RENEWAL_LOSS_RELIEF, type MarketLevel,
} from '../../data/pricingParameters';
import type { CoverageLine } from '../../types/simulation';

// ---------------------------------------------------------------------------
// The buckets and their mixes
// ---------------------------------------------------------------------------

const RAW_MEAN = MARKET_BUCKETS_RAW.reduce((a, r, i) => a + r * MARKET_BUCKET_BASE_MIX[i], 0);
/** The five risk scores, scaled so the even mix averages exactly 1.00. */
export const MARKET_BUCKETS: readonly number[] = MARKET_BUCKETS_RAW.map(r => r / RAW_MEAN);
const BASE: readonly number[] = MARKET_BUCKET_BASE_MIX;

const meanOf = (mix: readonly number[]) => mix.reduce((a, p, i) => a + p * MARKET_BUCKETS[i], 0);
/** The even mix tilted by θ: p ∝ base × exp(−θ × risk) (θ > 0 favours the best, θ < 0 the worst). */
const tilt = (theta: number): number[] => {
  const w = BASE.map((p, i) => p * Math.exp(-theta * MARKET_BUCKETS[i]));
  const t = w.reduce((a, b) => a + b, 0);
  return w.map(x => x / t);
};
/**
 * A team's weight for outside supply (the wide taper): 1 at or below the room's average rate, falling in a
 * straight line to 0 at MARKET_OUTSIDE_TAPER (20%) above it.
 */
export const outsideWeight = (rate: number, average: number): number =>
  Math.max(0, Math.min(1, 1 - (rate / average - 1) / MARKET_OUTSIDE_TAPER));

/** The θ whose tilted mix averages `target` (bisection; the mean falls as θ rises). */
const solveTheta = (target: number): number => {
  let lo = -200, hi = 200;
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2;
    if (meanOf(tilt(mid)) > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
};
const THETA_CACHE = new Map<number, number>();
const thetaFor = (target: number) => {
  let t = THETA_CACHE.get(target);
  if (t === undefined) { t = solveTheta(target); THETA_CACHE.set(target, t); }
  return t;
};
/** Price-leavers' mix at a pair gap: none of the tilt at 1%, the level's full skew at 10%+. */
export function leaverMix(level: Exclude<MarketLevel, 'off'>, gap: number): number[] {
  const share = Math.min(1, Math.max(0, (gap - MARKET_MIN_GAP) / (MARKET_FULL_SKEW_GAP - MARKET_MIN_GAP)));
  return tilt(thetaFor(MARKET_FULL_SKEW_MEAN[level]) * share);
}
/** Non-renewed members' mix: tilted to the worst, mean 1.5 − ½ × the share dropped (today's relief, ½). */
export function droppedMix(share: number): number[] {
  return tilt(thetaFor(1 + NON_RENEWAL_LOSS_RELIEF - NON_RENEWAL_LOSS_RELIEF * share));
}
export const evenMix = (): number[] => [...BASE];

// ---------------------------------------------------------------------------
// Seeded draws — FNV-1a over the key, then mulberry32. Integer-only, so every
// platform draws the same numbers.
// ---------------------------------------------------------------------------

export function seededRandom(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (mix: readonly number[], u: number) => {
  let c = 0;
  for (let i = 0; i < mix.length; i++) { c += mix[i]; if (u < c) return i; }
  return mix.length - 1;
};

/** n members shared by weight, largest remainder first; equal remainders broken by the seeded draw, not list order. */
function apportion(n: number, weights: readonly number[], rnd: () => number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const quota = weights.map(w => (sum > 0 ? (w / sum) * n : 0));
  const cnt = quota.map(Math.floor);
  const tie = weights.map(() => rnd());
  const order = weights.map((_, j) => j).filter(j => weights[j] > 0)
    .sort((a, b) => (quota[b] - cnt[b]) - (quota[a] - cnt[a]) || tie[a] - tie[b]);
  for (let k = 0, left = n - cnt.reduce((a, b) => a + b, 0); k < left && k < order.length; k++) cnt[order[k]]++;
  return cnt;
}

// ---------------------------------------------------------------------------
// Inputs and results
// ---------------------------------------------------------------------------

export interface MarketTeamLineInput {
  /** The team's whole rate for the year on the line (risk control and reinsurance in), per $100. */
  readonly rate: number;
  /** The book at the start of the year, before the moves (exposure, base-year $M). */
  readonly book: number;
  /** The book risk factor carried from last year (before this year's fade); 1 in year 1. */
  readonly bookRisk: number;
  /** New Members: the most taken in this year, as a share of the book (0–0.10). */
  readonly newMembers: number;
  /** Non-Renewal: the share of the book dropped this year (0–0.10). */
  readonly nonRenewal: number;
}

export interface MarketTeamInput {
  /** The seed key for this team: stable across devices and replays (the server uses the team's number). */
  readonly key: string;
  readonly lines: Partial<Record<CoverageLine, MarketTeamLineInput>>;
}

export interface MarketStepInput {
  readonly level: Exclude<MarketLevel, 'off'>;
  /** The room's seed key (the server uses the room's code and scenario). */
  readonly seed: string;
  readonly year: number;
  readonly lines: readonly CoverageLine[];
  readonly teams: readonly MarketTeamInput[];
  /** Exposure of last year's non-renewed members nobody took, per line (refilled as outside supply). */
  readonly untakenDroppedLastYear: Partial<Record<CoverageLine, number>>;
}

/** What one team's game reads for one line of the year, and what its screens show. */
export interface MarketTeamLineResult {
  /** The book risk after the fade, before this year's moves. */
  readonly bookRiskBefore: number;
  /** Willing leavers, as a share of the book at the start of the year. */
  readonly willingShare: number;
  /** Leavers who actually left (good leavers matched to a cheaper team), share of the book. */
  readonly leftShare: number;
  /** Exposure that left / came in (good leavers, outside supply, non-renewed members). */
  readonly outExposure: number;
  readonly inGood: number;
  readonly inOutside: number;
  readonly inDropped: number;
  /** Average risk of what came in, by source, relative to 1.00 (null if none came). */
  readonly qualityGood: number | null;
  readonly qualityOutside: number | null;
  readonly qualityDropped: number | null;
  /** Average risk of the leavers relative to the team's own book (null if none left). */
  readonly qualityLeft: number | null;
  /** The appetite (New Members × book), exposure. */
  readonly appetite: number;
  /** This team's non-renewed members: offered, and how many another team took. */
  readonly droppedExposure: number;
  readonly droppedTaken: number;
  /** The book after the moves, before the engine drops this year's non-renewals. */
  readonly bookAfter: number;
  /** The book risk factor the year plays at (multiplies ordinary losses). */
  readonly bookRisk: number;
  /** The share of `bookAfter` the engine drops as this year's non-renewal (keeps today's relief). */
  readonly engineNonRenewal: number;
}

export interface MarketStepResult {
  readonly year: number;
  /** Per team key, per line. */
  readonly teams: Readonly<Record<string, Partial<Record<CoverageLine, MarketTeamLineResult>>>>;
  /** Exposure of this year's non-renewed members nobody took, per line — next year's refill. */
  readonly untakenDropped: Partial<Record<CoverageLine, number>>;
}

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

interface Member { src: number; e: number; risk: number; to: number }

export function runMarketStep(input: MarketStepInput): MarketStepResult {
  const out: Record<string, Partial<Record<CoverageLine, MarketTeamLineResult>>> = {};
  for (const t of input.teams) out[t.key] = {};
  const untaken: Partial<Record<CoverageLine, number>> = {};
  for (const line of input.lines) {
    const writers = input.teams.map((t, i) => ({ i, t, x: t.lines[line] })).filter(w => w.x && w.x.book > 0);
    if (writers.length === 0) continue;
    const res = runLine(input, line, writers.map(w => ({ key: w.t.key, x: w.x! })));
    for (const [key, r] of Object.entries(res.teams)) out[key][line] = r;
    untaken[line] = res.untaken;
  }
  return { year: input.year, teams: out, untakenDropped: untaken };
}

function runLine(input: MarketStepInput, line: CoverageLine,
  ts: { key: string; x: MarketTeamLineInput }[]): { teams: Record<string, MarketTeamLineResult>; untaken: number } {
  const { level, seed, year } = input;
  const N = ts.length;
  const k = MARKET_K[level][line];
  const r = ts.map(t => t.x.rate);
  const E = ts.map(t => t.x.book);
  // 0. fade
  const B = ts.map(t => 1 + (t.x.bookRisk - 1) * (1 - MARKET_BOOK_RISK_FADE));
  const avg = r.reduce((a, b) => a + b, 0) / N;
  const keyOf = (i: number) => ts[i].key;
  const pull = (i: number, j: number) => {
    const g = r[i] / r[j] - 1;
    return j !== i && g > MARKET_MIN_GAP ? k * (g - MARKET_MIN_GAP) ** 2 : 0;
  };

  const outE = Array(N).fill(0), outM = Array(N).fill(0), outN = Array(N).fill(0);
  const inGood = Array(N).fill(0), inGoodM = Array(N).fill(0);
  const inOut = Array(N).fill(0), inOutM = Array(N).fill(0);
  const inDrop = Array(N).fill(0), inDropM = Array(N).fill(0);
  const willing = Array(N).fill(0);
  const rem = ts.map((t, j) => Math.max(0, t.x.newMembers) * E[j]);
  const appetite = [...rem];
  const byPrice = ts.map((_, j) => j).sort((a, b) => r[a] - r[b] || keyOf(a).localeCompare(keyOf(b)));
  const fits = (j: number, e: number) => e <= rem[j] + 1e-9;

  // 1. SUPPLY
  const pool: Member[] = [];
  if (N > 1) {
    for (let i = 0; i < N; i++) {
      const fl = r.map((_, j) => pull(i, j));
      const sum = fl.reduce((a, b) => a + b, 0);
      if (sum <= 0) continue;
      const mult = 1 + MARKET_COUNT_SPREAD * (2 * seededRandom(`${seed}|n|${keyOf(i)}|${line}|${year}`)() - 1);
      const frac = Math.min(MARKET_LEAVER_CAP, sum * MARKET_RIVAL_SCALE / (N - 1) * mult);
      const n = Math.max(1, Math.round(frac * MARKET_MEMBERS_PER_BOOK));
      const e = (frac * E[i]) / n;
      const rnd = seededRandom(`${seed}|${keyOf(i)}|${line}|${year}`);
      const cnt = apportion(n, fl, rnd);
      fl.forEach((_, j) => {
        for (let m = 0; m < cnt[j]; m++) {
          pool.push({ src: i, e, risk: B[i] * MARKET_BUCKETS[pick(leaverMix(level, r[i] / r[j] - 1), rnd())], to: -1 });
        }
      });
      willing[i] = frac;
    }
  }

  // 3a. MATCHING — good leavers to cheaper teams with room
  for (let round = 0; round < 50; round++) {
    const asks: Member[][] = ts.map(() => []);
    for (let i = 0; i < N; i++) {
      const mine = pool.filter(m => m.to < 0 && m.src === i);
      if (!mine.length) continue;
      const R = ts.map((_, j) => j).filter(j => pull(i, j) > 0 && rem[j] > 1e-9);
      if (!R.length) continue;
      const cnt = apportion(mine.length, R.map(j => pull(i, j)), seededRandom(`${seed}|ask|${keyOf(i)}|${line}|${year}|${round}`));
      // the best leavers ask the cheapest of their teams first
      mine.sort((a, b) => a.risk - b.risk);
      const Rs = R.map((j, q) => [j, cnt[q]] as const).sort((a, b) => r[a[0]] - r[b[0]] || keyOf(a[0]).localeCompare(keyOf(b[0])));
      let p = 0;
      for (const [j, c] of Rs) for (let q = 0; q < c; q++) asks[j].push(mine[p++]);
    }
    let any = false;
    for (const j of byPrice) {
      asks[j].sort((a, b) => a.risk - b.risk);
      for (const m of asks[j]) if (m.to < 0 && fits(j, m.e)) { m.to = j; rem[j] -= m.e; any = true; }
    }
    if (!any) break;
  }
  for (const m of pool) {
    if (m.to < 0) continue;
    outE[m.src] += m.e; outM[m.src] += m.e * m.risk; outN[m.src]++;
    inGood[m.to] += m.e; inGoodM[m.to] += m.e * m.risk;
  }

  // 3b. OUTSIDE SUPPLY — 2% of the room plus last year's untaken non-renewals, shared by the wide taper
  const room = E.reduce((a, b) => a + b, 0);
  const unit = room / N / MARKET_MEMBERS_PER_BOOK;
  const supply = MARKET_OUTSIDE_SUPPLY * room + Math.max(0, input.untakenDroppedLastYear[line] ?? 0);
  const nOut = Math.round(supply / unit);
  if (nOut > 0) {
    // The year's newcomers, drawn at the even mix; every team's share carries their average risk (the same mix).
    const rnd = seededRandom(`${seed}|outside|${line}|${year}`);
    let drawn = 0;
    for (let q = 0; q < nOut; q++) drawn += MARKET_BUCKETS[pick(BASE, rnd())];
    const sameMix = drawn / nOut;
    const weight = r.map(x => outsideWeight(x, avg));
    const got = Array(N).fill(0) as number[];
    let left = supply;
    let open = byPrice.filter(j => weight[j] > 0 && rem[j] > 1e-9);
    while (left > 1e-9 && open.length > 0) {
      const W = open.reduce((a, j) => a + weight[j], 0);
      let given = 0;
      const still: number[] = [];
      for (const j of open) {
        const g = Math.min(rem[j] - got[j], left * weight[j] / W);
        got[j] += g; given += g;
        if (rem[j] - got[j] > 1e-9) still.push(j);
      }
      left -= given;
      if (still.length === open.length) break; // nobody filled: the supply is all given
      open = still;
    }
    for (let j = 0; j < N; j++) {
      if (got[j] <= 0) continue;
      rem[j] -= got[j]; inOut[j] += got[j]; inOutM[j] += got[j] * sameMix;
    }
  }

  // 3c. NON-RENEWED MEMBERS — no team takes them. Each team's Non-Renewal × its
  // book after a and b leaves the market; all of it is next year's refill (3b).
  // (inDrop and droppedTaken stay in the result, always 0, the shape rooms
  // already store.)
  const dropped = Array(N).fill(0), droppedTaken = Array(N).fill(0);
  let untaken = 0;
  for (let i = 0; i < N; i++) {
    const a1 = Math.max(0, ts[i].x.nonRenewal);
    if (a1 <= 0) continue;
    dropped[i] = a1 * (E[i] - outE[i] + inGood[i] + inOut[i]);
    untaken += dropped[i];
  }

  // 4. the books after the moves
  const teams: Record<string, MarketTeamLineResult> = {};
  for (let i = 0; i < N; i++) {
    const inAll = inGood[i] + inOut[i] + inDrop[i];
    const bookAfter = E[i] - outE[i] + inAll;
    const mass = B[i] * E[i] - outM[i] + inGoodM[i] + inOutM[i] + inDropM[i];
    teams[keyOf(i)] = {
      bookRiskBefore: B[i],
      willingShare: willing[i],
      leftShare: E[i] > 0 ? outE[i] / E[i] : 0,
      outExposure: outE[i],
      inGood: inGood[i], inOutside: inOut[i], inDropped: inDrop[i],
      qualityGood: inGood[i] > 0 ? inGoodM[i] / inGood[i] : null,
      qualityOutside: inOut[i] > 0 ? inOutM[i] / inOut[i] : null,
      qualityDropped: inDrop[i] > 0 ? inDropM[i] / inDrop[i] : null,
      qualityLeft: outE[i] > 0 ? outM[i] / outE[i] / B[i] : null,
      appetite: appetite[i],
      droppedExposure: dropped[i],
      droppedTaken: droppedTaken[i],
      bookAfter,
      bookRisk: bookAfter > 0 ? mass / bookAfter : 1,
      engineNonRenewal: bookAfter > 0 ? dropped[i] / bookAfter : 0,
    };
  }
  return { teams, untaken };
}
