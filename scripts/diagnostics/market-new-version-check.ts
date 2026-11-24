// ============================================================================
// MARKET VERSION NEW: THE NEW MARKET STEP AND THE FIXED ADMIN, RECOMPUTED
// INDEPENDENTLY (pr/market-new-version; utils/market/marketStep.ts marketParams,
// simulationEngine.ts processLineYear's fixed admin, pricingParameters.ts
// MARKET_NEW / MARKET_NEW_FIXED_ADMIN).
//
//   npx tsx scripts/diagnostics/market-new-version-check.ts
//
// 1. THE BRIEF'S VALUES, AS LITERALS IN THIS FILE: k per line and level, the
//    average leaver at a 10%+ gap, the leaver cap, the fade, the bucket power,
//    and the fixed admin (25%, +3% a year). The parameters file must carry
//    exactly these. The widened buckets are recomputed here ((raw ÷ 1.02)^m,
//    renormalised) and must be the engine's; the average leaver is 1.00 at a 1%
//    gap and the brief's at 10% and beyond. Current's values are untouched.
// 2. A REAL NEW-VERSION ROOM AT EACH LEVEL. Seven teams lock in a localStorage
//    room (one far dearer, at the cap; one skipping a year; one never locking),
//    four years, each posting a struck rate × its factor and the book its last
//    stored result left it — the server runs the step. Every stored year must carry version 'new', and every field of every
//    team's result must equal a SECOND IMPLEMENTATION written here from the
//    brief, reading only the literals above (1e-9). The same plan in a Current
//    room stores no version and moves members differently.
// 3. THE FIXED ADMIN, PER WORLD. Each New-room team's game is replayed year by
//    year; in every world, every year and line, the admin it books must be
//    (0.25 × year-1 admin × 1.03^(year − 1) + 0.75 × this year's admin) × (1 +
//    the year's overrun), the overrun read from a twin game on the same stored
//    market without the version (which books admin as today), and the member
//    charge (the admin priced) the same in both. A team that never locked (no
//    market result) books admin as today; so does a New-version room with the
//    market Off, byte-identical to its Current twin. (Three teams' games in
//    full — the cheapest, a middle one and the one that lost its book — and two
//    in the market-Off room: the arithmetic is the same for every team.)
//
// INTAKE AT 0.95 (pr/market-new-intake, pr/market-new-intake-095): in the
// recompute, the members a New team takes in — leavers and outside members —
// count at the brief's 0.95, while the leavers leave their team at their drawn
// quality; every stored New intake must read 0.95 and losing teams must still
// lose better members.
//
// CONTROLS, each of which must fail: a recompute on Current's values; on
// Current's buckets alone; on Current's cap alone; on Current's fade alone; a
// parameters table with one k changed; the fixed admin recomputed with no trend,
// with this year's admin as the base, with no fixed part, and at 50% (the share
// before pr/market-fixed-admin-25); a recompute with
// inherited quality back; a recompute at 1.00 (the value before 0.95); a stored
// New result with leavers taken in at 0.85.
// ============================================================================

import {
  MARKET_BOOK_RISK_FADE, MARKET_BUCKET_BASE_MIX, MARKET_BUCKETS_RAW, MARKET_COUNT_SPREAD, MARKET_FULL_SKEW_GAP,
  MARKET_FULL_SKEW_MEAN, MARKET_K, MARKET_LEAVER_CAP, MARKET_MEMBERS_PER_BOOK, MARKET_MIN_GAP, MARKET_NEW,
  MARKET_NEW_FIXED_ADMIN, MARKET_NEW_INTAKE_QUALITY, MARKET_OUTSIDE_SUPPLY, MARKET_OUTSIDE_TAPER, MARKET_RIVAL_SCALE, MARKET_VERSION_DEFAULT,
  type MarketLevel,
} from '../../src/data/pricingParameters';
import type { CoverageLine, GameState, LineResultSet } from '../../src/types/simulation';
import type { MarketLockInput, MarketTeamLineResult, StoredMarketYear } from '../../src/session/contract';

// ---------------------------------------------------------------- shim (localStorage room)
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
}
(globalThis as unknown as { localStorage: unknown }).localStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });

let passed = 0, failed = 0;
function ok(cond: boolean, label: string, detail = '') {
  if (cond) { passed++; console.log(`  OK    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
function control(label: string, problems: number) {
  ok(problems > 0, `control: ${label}`, problems > 0 ? '' : 'the broken form passed');
  if (problems > 0) console.log(`          (${problems} problem(s) when broken)`);
}

type Level = Exclude<MarketLevel, 'off'>;
const LEVELS: Level[] = ['low', 'medium', 'high'];
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

// ============================================================================
// THE BRIEF'S VALUES — literals, not read from the parameters file.
// ============================================================================
const BRIEF = {
  low: { k: { WC: 1.200, GL: 1.236, Property: 1.234 }, mean: 0.75, cap: 0.20, fade: 0.35, power: 1.25 },
  medium: { k: { WC: 2.100, GL: 2.163, Property: 2.160 }, mean: 0.65, cap: 0.25, fade: 0.25, power: 1.75 },
  high: { k: { WC: 3.600, GL: 3.708, Property: 3.702 }, mean: 0.55, cap: 0.30, fade: 0.20, power: 2.25 },
} as const;
/** pr/market-fixed-admin-25: a quarter of year-1 admin fixed (it was 50%), still growing 3% a year. */
const BRIEF_FIXED = { share: 0.25, trend: 0.03 };
/** pr/market-new-intake(-095): in New, the members a team takes in arrive at 0.95 — slightly better than average. */
const BRIEF_INTAKE = 0.95;

// ============================================================================
// THE SECOND IMPLEMENTATION — from the brief, not from marketStep.ts.
// ============================================================================

/** FNV-1a 32-bit hash of the key, then mulberry32 — the room's seeded draws. */
function draws(key: string): () => number {
  let h = 0x811c9dc5;
  for (const ch of key) { h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193); }
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 2 ** 32;
  };
}
const MIX = [0.05, 0.20, 0.50, 0.20, 0.05];
const RAW = [0.60, 0.80, 1.00, 1.25, 1.60];
const RAW_AVG = RAW.reduce((s, b, i) => s + b * MIX[i], 0);   // 1.02
/** The brief's widening: (raw ÷ 1.02)^m, renormalised so the even mix averages 1.00. m = 1 is Current's buckets. */
function widened(m: number): number[] {
  const p = RAW.map(r => (r / RAW_AVG) ** m);
  const avg = p.reduce((s, r, i) => s + r * MIX[i], 0);
  return p.map(r => r / avg);
}
const avgOf = (mix: number[], risks: number[]) => mix.reduce((s, p, i) => s + p * risks[i], 0);
const tiltedMix = (theta: number, risks: number[]) => {
  const w = MIX.map((p, i) => p * Math.exp(-theta * risks[i]));
  const t = w.reduce((a, b) => a + b, 0);
  return w.map(x => x / t);
};
function thetaAt(target: number, risks: number[]): number {
  let a = -200, b = 200;
  for (let i = 0; i < 200; i++) { const m = (a + b) / 2; if (avgOf(tiltedMix(m, risks), risks) > target) a = m; else b = m; }
  return (a + b) / 2;
}
const bucketOf = (mix: number[], u: number) => { let c = 0; for (let i = 0; i < mix.length; i++) { c += mix[i]; if (u < c) return i; } return mix.length - 1; };
function share(n: number, w: number[], rnd: () => number): number[] {
  const tot = w.reduce((a, b) => a + b, 0);
  const q = w.map(x => (tot > 0 ? (x / tot) * n : 0));
  const c = q.map(Math.floor);
  const tie = w.map(() => rnd());
  const idx = w.map((_, j) => j).filter(j => w[j] > 0).sort((a, b) => (q[b] - c[b]) - (q[a] - c[a]) || tie[a] - tie[b]);
  let left = n - c.reduce((a, b) => a + b, 0);
  for (const j of idx) { if (left <= 0) break; c[j]++; left--; }
  return c;
}
const taperWeight = (rate: number, avgRate: number) => {
  const over = rate / avgRate - 1;
  return over <= 0 ? 1 : Math.max(0, 1 - over / 0.20);
};

/** What the recompute plays on: the brief's New values, or (controls) one of Current's swapped in. */
// intake: the quality the members a team takes in arrive at (New: the brief's 0.95); null: the quality they were drawn at (Current).
interface P { k: Record<CoverageLine, number>; mean: number; cap: number; fade: number; risks: number[]; intake: number | null }
const briefP = (level: Level): P => ({ k: { ...BRIEF[level].k }, mean: BRIEF[level].mean, cap: BRIEF[level].cap, fade: BRIEF[level].fade, risks: widened(BRIEF[level].power), intake: BRIEF_INTAKE });
const CURRENT_BRIEF = { k: { WC: 0.600, GL: 0.618, Property: 0.617 }, mean: { low: 0.90, medium: 0.80, high: 0.70 }, cap: 0.15, fade: 0.50 };
const currentP = (level: Level): P => {
  const m = level === 'low' ? 0.5 : level === 'high' ? 2 : 1;
  return { k: { WC: CURRENT_BRIEF.k.WC * m, GL: CURRENT_BRIEF.k.GL * m, Property: CURRENT_BRIEF.k.Property * m },
    mean: CURRENT_BRIEF.mean[level], cap: CURRENT_BRIEF.cap, fade: CURRENT_BRIEF.fade, risks: widened(1), intake: null };
};

interface LineIn { rate: number; book: number; bookRisk: number; newMembers: number; nonRenewal: number }

function recomputeLine(p: P, seed: string, year: number, line: CoverageLine, teams: { key: string; x: LineIn }[], untakenLast: number) {
  const N = teams.length;
  const k = p.k[line];
  const rate = teams.map(t => t.x.rate), book = teams.map(t => t.x.book);
  const risk0 = teams.map(t => 1 + (t.x.bookRisk - 1) * (1 - p.fade));
  const gapPull = (i: number, j: number) => { const g = rate[i] / rate[j] - 1; return i !== j && g > 0.01 ? k * (g - 0.01) ** 2 : 0; };
  const leaverMix = (gap: number) => tiltedMix(thetaAt(p.mean, p.risks) * Math.min(1, Math.max(0, (gap - 0.01) / (0.10 - 0.01))), p.risks);
  const cheapestFirst = teams.map((_, j) => j).sort((a, b) => rate[a] - rate[b] || teams[a].key.localeCompare(teams[b].key));
  const room = teams.map(t => Math.max(0, t.x.newMembers) * t.x.book);
  const appetite = [...room];
  const z = () => Array(N).fill(0) as number[];
  const out = z(), outRisk = z(), willing = z(), good = z(), goodRisk = z(), outside = z(), outsideRisk = z();
  type M = { from: number; e: number; risk: number; to: number };
  const leavers: M[] = [];
  if (N > 1) for (let i = 0; i < N; i++) {
    const pulls = rate.map((_, j) => gapPull(i, j));
    const tot = pulls.reduce((a, b) => a + b, 0);
    if (tot <= 0) continue;
    const spread = 1 + 0.20 * (2 * draws(`${seed}|n|${teams[i].key}|${line}|${year}`)() - 1);
    const f = Math.min(p.cap, tot * 4 / (N - 1) * spread);
    const n = Math.max(1, Math.round(f * 100));
    const rnd = draws(`${seed}|${teams[i].key}|${line}|${year}`);
    const cnt = share(n, pulls, rnd);
    for (let j = 0; j < N; j++) for (let q = 0; q < cnt[j]; q++) {
      leavers.push({ from: i, e: f * book[i] / n, risk: risk0[i] * p.risks[bucketOf(leaverMix(rate[i] / rate[j] - 1), rnd())], to: -1 });
    }
    willing[i] = f;
  }
  const take = (j: number, m: M) => { if (m.to < 0 && m.e <= room[j] + 1e-9) { m.to = j; room[j] -= m.e; return true; } return false; };
  for (let round = 0; round < 50; round++) {
    const asking: M[][] = teams.map(() => []);
    for (let i = 0; i < N; i++) {
      const left = leavers.filter(m => m.from === i && m.to < 0).sort((a, b) => a.risk - b.risk);
      const to = teams.map((_, j) => j).filter(j => gapPull(i, j) > 0 && room[j] > 1e-9);
      if (!left.length || !to.length) continue;
      const cnt = share(left.length, to.map(j => gapPull(i, j)), draws(`${seed}|ask|${teams[i].key}|${line}|${year}|${round}`));
      const order = to.map((j, q) => ({ j, c: cnt[q] })).sort((a, b) => rate[a.j] - rate[b.j] || teams[a.j].key.localeCompare(teams[b.j].key));
      let q0 = 0;
      for (const { j, c } of order) for (let q = 0; q < c; q++) asking[j].push(left[q0++]);
    }
    let moved = false;
    for (const j of cheapestFirst) for (const m of asking[j].sort((a, b) => a.risk - b.risk)) moved = take(j, m) || moved;
    if (!moved) break;
  }
  for (const m of leavers) if (m.to >= 0) { out[m.from] += m.e; outRisk[m.from] += m.e * m.risk; good[m.to] += m.e; goodRisk[m.to] += m.e * (p.intake ?? m.risk); }
  const roomBook = book.reduce((a, b) => a + b, 0);
  const avgRate = rate.reduce((a, b) => a + b, 0) / N;
  const supply = 0.02 * roomBook + Math.max(0, untakenLast);
  const nNew = Math.round(supply / (roomBook / N / 100));
  if (nNew > 0) {
    const rnd = draws(`${seed}|outside|${line}|${year}`);
    let drawn = 0;
    for (let q = 0; q < nNew; q++) drawn += p.risks[bucketOf(MIX, rnd())];
    const mix = drawn / nNew;
    const w = rate.map(x => taperWeight(x, avgRate));
    const intake = z();
    const filled = new Set<number>();
    const cand = teams.map((_, j) => j).filter(j => w[j] > 0 && room[j] > 1e-9);
    for (;;) {
      const free = cand.filter(j => !filled.has(j));
      const rest = supply - [...filled].reduce((a, j) => a + room[j], 0);
      const W = free.reduce((a, j) => a + w[j], 0);
      const over = free.filter(j => W > 0 && rest * w[j] / W > room[j] + 1e-12);
      if (!over.length) { for (const j of free) intake[j] = W > 0 ? rest * w[j] / W : 0; break; }
      for (const j of over) filled.add(j);
    }
    for (const j of filled) intake[j] = room[j];
    for (let j = 0; j < N; j++) { outside[j] += intake[j]; outsideRisk[j] += intake[j] * (p.intake ?? mix); room[j] -= intake[j]; }
  }
  const dropped = z();
  let untaken = 0;
  for (let i = 0; i < N; i++) {
    const a1 = Math.max(0, teams[i].x.nonRenewal);
    if (a1 > 0) { dropped[i] = a1 * (book[i] - out[i] + good[i] + outside[i]); untaken += dropped[i]; }
  }
  const res: Record<string, MarketTeamLineResult> = {};
  for (let i = 0; i < N; i++) {
    const after = book[i] - out[i] + good[i] + outside[i];
    const mass = risk0[i] * book[i] - outRisk[i] + goodRisk[i] + outsideRisk[i];
    res[teams[i].key] = {
      bookRiskBefore: risk0[i], willingShare: willing[i], leftShare: book[i] > 0 ? out[i] / book[i] : 0, outExposure: out[i],
      inGood: good[i], inOutside: outside[i], inDropped: 0,
      qualityGood: good[i] > 0 ? goodRisk[i] / good[i] : null, qualityOutside: outside[i] > 0 ? outsideRisk[i] / outside[i] : null,
      qualityDropped: null, qualityLeft: out[i] > 0 ? outRisk[i] / out[i] / risk0[i] : null,
      appetite: appetite[i], droppedExposure: dropped[i], droppedTaken: 0, bookAfter: after,
      bookRisk: after > 0 ? mass / after : 1, engineNonRenewal: after > 0 ? dropped[i] / after : 0,
    };
  }
  return { res, untaken };
}

function recomputeYear(p: P, code: string, seed: string, s: StoredMarketYear, prev: StoredMarketYear | undefined) {
  const result: StoredMarketYear['result'] = {};
  const untaken: Partial<Record<CoverageLine, number>> = {};
  const names = Object.keys(s.inputs).sort((a, b) => s.inputs[a].teamNumber - s.inputs[b].teamNumber);
  for (const n of names) result[n] = {};
  for (const line of LINES) {
    const ts = names.filter(n => (s.inputs[n].byLine[line]?.book ?? 0) > 0).map(n => {
      const l = s.inputs[n].byLine[line]!;
      return { name: n, key: `T${s.inputs[n].teamNumber}`, x: { ...l, bookRisk: prev?.result[n]?.[line]?.bookRisk ?? 1 } };
    });
    if (!ts.length) continue;
    const { res, untaken: u } = recomputeLine(p, `${code}|${seed}`, s.year, line, ts, prev?.untakenDropped[line] ?? 0);
    for (const t of ts) result[t.name][line] = res[t.key];
    untaken[line] = u;
  }
  return { result, untaken };
}

/** New rooms: every team's intake — leavers and outside members — at the brief's 0.95; how many losing team-line-years lost better members. */
function intakeProblems(years: Record<string, StoredMarketYear>) {
  const problems: string[] = [];
  let intakes = 0, betterLeft = 0;
  for (const [y, s] of Object.entries(years)) for (const [n, r] of Object.entries(s.result)) for (const l of LINES) {
    const x = r[l];
    if (!x) continue;
    if (x.qualityGood !== null) { intakes++; if (Math.abs(x.qualityGood - BRIEF_INTAKE) > 1e-12) problems.push(`y${y} ${n} ${l}: leavers taken in at ${x.qualityGood}`); }
    if (x.qualityOutside !== null) { intakes++; if (Math.abs(x.qualityOutside - BRIEF_INTAKE) > 1e-12) problems.push(`y${y} ${n} ${l}: outside members at ${x.qualityOutside}`); }
    if (x.qualityLeft !== null && x.qualityLeft < 1 - 1e-9) betterLeft++;
  }
  return { problems, intakes, betterLeft };
}

function differences(a: StoredMarketYear['result'], b: StoredMarketYear['result'], ua?: Partial<Record<CoverageLine, number>>, ub?: Partial<Record<CoverageLine, number>>): string[] {
  const out: string[] = [];
  const same = (x: unknown, y: unknown) => (x === null || y === null || x === undefined || y === undefined)
    ? x === y : Math.abs((x as number) - (y as number)) <= 1e-9 * Math.max(1, Math.abs(x as number));
  for (const n of new Set([...Object.keys(a), ...Object.keys(b)])) for (const line of LINES) {
    const x = a[n]?.[line], y = b[n]?.[line];
    if (!x && !y) continue;
    if (!x || !y) { out.push(`${n} ${line}: present in one only`); continue; }
    for (const f of Object.keys(x) as (keyof MarketTeamLineResult)[]) if (!same(x[f], y[f])) out.push(`${n} ${line} ${f}: ${x[f]} vs ${y[f]}`);
  }
  if (ua && ub) for (const line of LINES) if (!same(ua[line] ?? 0, ub[line] ?? 0)) out.push(`untaken ${line}: ${ua[line]} vs ${ub[line]}`);
  return out;
}

async function main() {
  const { LocalSessionTransport } = await import('../../src/session/localTransport');
  const { newSessionToken } = await import('../../src/session/contract');
  const { marketByYearForEngine } = await import('../../src/session/market');
  const { buildTeamGame, replayTeamYears } = await import('../../src/session/client/buildGame');
  const { marketLockInputFor } = await import('../../src/session/client/marketLock');
  const { decisionsForYear, decisionsToJson } = await import('../../src/session/client/decisions');
  const { MARKET_BUCKETS, leaverMix, marketParams, widenedBuckets } = await import('../../src/utils/market/marketStep');

  // ==========================================================================
  // 1. THE BRIEF'S VALUES
  // ==========================================================================
  console.log('\n1. The brief\'s values');
  const tableIsBrief = (T: typeof MARKET_NEW) => LEVELS.every(l => LINES.every(line => T[l].k[line] === BRIEF[l].k[line])
    && T[l].fullSkewMean === BRIEF[l].mean && T[l].leaverCap === BRIEF[l].cap && T[l].bookRiskFade === BRIEF[l].fade && T[l].bucketPower === BRIEF[l].power);
  ok(tableIsBrief(MARKET_NEW), 'MARKET_NEW is the brief: k Low 1.200/1.236/1.234, Medium 2.100/2.163/2.160, High 3.600/3.708/3.702; '
    + 'average leaver 0.75/0.65/0.55; cap 20/25/30%; fade 35/25/20%; bucket power 1.25/1.75/2.25');
  control('a table with Medium GL k at 2.200 is refused', tableIsBrief({ ...MARKET_NEW, medium: { ...MARKET_NEW.medium, k: { ...MARKET_NEW.medium.k, GL: 2.200 } } }) ? 0 : 1);
  ok(MARKET_NEW_FIXED_ADMIN.share === BRIEF_FIXED.share && MARKET_NEW_FIXED_ADMIN.trend === BRIEF_FIXED.trend,
    'the fixed admin is 25% of the year-1 admin dollars, growing 3% a year');
  ok(MARKET_VERSION_DEFAULT === 'current', 'the default version is Current');
  ok(MARKET_NEW_INTAKE_QUALITY === BRIEF_INTAKE && LEVELS.every(l => marketParams(l, 'new').intakeQuality === BRIEF_INTAKE && marketParams(l, 'current').intakeQuality === null),
    'New takes members in at 0.95 (slightly better than average) at every level; Current keeps inherited quality');
  ok(LEVELS.every(l => Math.abs(BRIEF[l].mean - (1 - BRIEF[l].power * 0.20)) < 1e-12),
    'the average leaver at a 10%+ gap is 1 − power × 0.20 at every level (the measured widening)');
  ok(LINES.every(line => MARKET_K.medium[line] === CURRENT_BRIEF.k[line]) && MARKET_LEAVER_CAP === 0.15 && MARKET_BOOK_RISK_FADE === 0.50
    && LEVELS.every(l => MARKET_FULL_SKEW_MEAN[l] === CURRENT_BRIEF.mean[l]) && MARKET_FULL_SKEW_GAP === 0.10 && MARKET_MIN_GAP === 0.01
    && MARKET_COUNT_SPREAD === 0.20 && MARKET_RIVAL_SCALE === 4 && MARKET_OUTSIDE_SUPPLY === 0.02 && MARKET_OUTSIDE_TAPER === 0.20
    && MARKET_MEMBERS_PER_BOOK === 100 && MARKET_BUCKETS_RAW.every((r, i) => r === RAW[i]) && MARKET_BUCKET_BASE_MIX.every((m, i) => m === MIX[i]),
    'Current\'s values are untouched (k 0.600/0.618/0.617, cap 15%, fade 50%, leaver 0.90/0.80/0.70) and the shared ones are the brief\'s');
  for (const level of LEVELS) {
    const want = widened(BRIEF[level].power);
    const got = marketParams(level, 'new');
    const at = (g: number) => avgOf(leaverMix(level, g, 'new'), want);
    ok(got.buckets.every((b, i) => Math.abs(b - want[i]) < 1e-12) && widenedBuckets(BRIEF[level].power).every((b, i) => Math.abs(b - want[i]) < 1e-12)
      && Math.abs(avgOf(MIX, want) - 1) < 1e-12 && Math.abs(at(0.01) - 1) < 1e-12 && Math.abs(at(0.10) - BRIEF[level].mean) < 1e-6
      && Math.abs(at(0.30) - BRIEF[level].mean) < 1e-6,
      `${level}: the widened buckets are (raw ÷ 1.02)^${BRIEF[level].power} renormalised (${want.map(b => b.toFixed(3)).join(' / ')}); `
      + `the average leaver is 1.00 at 1% and ${BRIEF[level].mean.toFixed(2)} at 10% and beyond`);
    const cur = marketParams(level, 'current');
    ok(cur.buckets === MARKET_BUCKETS && cur.leaverCap === 0.15 && cur.bookRiskFade === 0.50 && cur.fullSkewMean === CURRENT_BRIEF.mean[level]
      && LINES.every(line => cur.k[line] === MARKET_K[level][line]), `${level}: Current reads Current's values`);
  }

  // ==========================================================================
  // 2. A REAL NEW-VERSION ROOM AT EACH LEVEL
  // ==========================================================================
  console.log('\n2. A New-version room at each level: what it stores, recomputed from the brief');
  const t = new LocalSessionTransport({ latencyMs: 0 });
  const plan = [
    { name: 'Alder', f: 0.92, nm: 0.10, nr: 0.00 },
    { name: 'Birch', f: 0.97, nm: 0.08, nr: 0.03 },
    { name: 'Cedar', f: 1.00, nm: 0.06, nr: 0.05 },
    { name: 'Dogwood', f: 1.06, nm: 0.04, nr: 0.02 },   // skips year 3
    { name: 'Elm', f: 1.40, nm: 0.00, nr: 0.10 },       // far dearer: at the leaver cap
    { name: 'Fir', f: 1.00, nm: 0.05, nr: 0.00 },       // never locks
    { name: 'Gum', f: 0.99, nm: 0.07, nr: 0.01 },
  ];
  type Played = { code: string; seed: string; room: Awaited<ReturnType<typeof t.read>>['room']; years: Record<string, StoredMarketYear>;
    tokens: string[]; decisions: Record<string, Record<string, unknown>> };
  async function playRoom(level: MarketLevel, version: 'current' | 'new'): Promise<Played> {
    const host = newSessionToken();
    const made = await t.createRoom({ hostToken: host, seed: '7', yearCount: 4, startingYear: 2027, eventName: `New ${level} ${version}`,
      expectedTeams: plan.length, lines: LINES, shocks: [], market: level, ...(version === 'new' ? { marketVersion: 'new' as const } : {}) });
    const joined = [];
    for (const p of plan) joined.push(await t.join({ code: made.code, teamName: p.name, role: 'player' }));
    const decisions: Record<string, Record<string, unknown>> = {};
    // THE POSTED INPUTS, WITHOUT PLAYING EVERY TEAM'S GAME: the step is recomputed from what the room stores,
    // so any posted rate and book will do. Each team posts the opening game's struck rate × its factor, and the
    // book its last stored result left it (after the engine's drop) — what its game would post. Section 3 plays
    // real games on the stored results.
    const room0 = (await t.read({ code: made.code, token: host })).room;
    const base = level !== 'off' ? marketLockInputFor(buildTeamGame(room0, LINES).gameState, decisionsForYear(1, undefined, false), 1)! : null;
    for (let year = 1; year <= 4; year++) {
      for (let i = 0; i < plan.length; i++) {
        const p = plan[i];
        if (p.name === 'Fir' || (p.name === 'Dogwood' && year === 3)) continue;
        const me = await t.read({ code: made.code, token: joined[i].teamToken });
        const d = decisionsForYear(year, undefined, false);
        for (const [j, line] of LINES.entries()) d.byLine[line] = { ...d.byLine[line], newMembers: Math.max(0, p.nm - 0.01 * j), nonRenewal: p.nr };
        let m: MarketLockInput | null = null;
        if (base) {
          const last = Object.keys(me.you?.marketByYear ?? {}).map(Number).sort((a, b) => b - a)[0];
          m = { byLine: {} };
          for (const line of LINES) {
            const r = last !== undefined ? me.you!.marketByYear![String(last)][line] : undefined;
            m.byLine[line] = { rate: base.byLine[line]!.rate * (1 + (p.f - 1) * (1 + 0.1 * year)),
              book: r ? r.bookAfter * (1 - r.engineNonRenewal) : base.byLine[line]!.book,
              newMembers: d.byLine[line].newMembers ?? 0, nonRenewal: d.byLine[line].nonRenewal ?? 0 };
          }
        }
        await t.submit({ code: made.code, token: joined[i].teamToken, yearNumber: year, decisions: decisionsToJson(d), ...(m ? { market: m } : {}) });
        (decisions[p.name] ??= {})[String(year)] = decisionsToJson(d);
      }
      await t.advance({ code: made.code, token: host, expectedYear: year });
    }
    const room = (await t.read({ code: made.code, token: host })).room;
    return { code: made.code, seed: room.seed, room, years: room.marketByYear ?? {}, tokens: joined.map(j => j.teamToken), decisions };
  }

  const rooms = {} as Record<Level, Played>;
  for (const level of LEVELS) rooms[level] = await playRoom(level, 'new');
  for (const level of LEVELS) {
    const { code, seed, years, room } = rooms[level];
    let diffs: string[] = [];
    let capHit = 0, moved = 0;
    for (let y = 1; y <= 4; y++) {
      const s = years[String(y)];
      if (!s) { diffs.push(`year ${y} not stored`); continue; }
      const re = recomputeYear(briefP(level), code, seed, s, years[String(y - 1)]);
      diffs = diffs.concat(differences(s.result, re.result, s.untakenDropped, re.untaken).map(d => `y${y} ${d}`));
      if (LINES.some(l => Math.abs((s.result.Elm?.[l]?.willingShare ?? 0) - BRIEF[level].cap) < 1e-12)) capHit++;
      moved += Object.values(s.result).filter(r => LINES.some(l => (r[l]?.outExposure ?? 0) > 0)).length;
    }
    ok(room.marketVersion === 'new' && [1, 2, 3, 4].every(y => years[String(y)]?.version === 'new'),
      `${level}: the room reads New, and every stored year carries version 'new'`);
    ok(diffs.length === 0, `${level}: every stored result, four years × three lines × six teams, matches the recompute on the brief's New values`, diffs.slice(0, 5).join('; '));
    ok(capHit > 0 && moved > 0, `${level}: members moved (${moved} team-years lost members); Elm, 40%+ dearer, sat at the ${BRIEF[level].cap * 100}% cap in ${capHit} year(s)`);
    ok(years['3']?.inputs.Dogwood?.stale === true && years['1']?.missing.includes('Fir'), `${level}: a stale team counts at its last lock; a team that never locked is left out`);
    const q = intakeProblems(years);
    ok(q.intakes > 0 && q.problems.length === 0 && q.betterLeft > 0,
      `${level}: every intake (${q.intakes} team-line-years, leavers and outside members) arrives at 0.95, while ${q.betterLeft} losing team-line-years `
      + 'lost better-than-their-book members (quality left below 1)', q.problems.slice(0, 3).join('; '));
  }
  {
    // CONTROL: inherited quality back — the recompute with leavers taken in at their drawn quality, and the outside at the draw's mix.
    let inherited = 0;
    for (const level of LEVELS) for (let y = 1; y <= 4; y++) {
      const { code, seed, years } = rooms[level];
      inherited += differences(years[String(y)].result, recomputeYear({ ...briefP(level), intake: null }, code, seed, years[String(y)], years[String(y - 1)]).result).length;
    }
    control('a recompute with inherited quality back (leavers taken in at their drawn quality) disagrees with the New room', inherited);
    // CONTROL: #105's 1.00 — the members taken in at exactly average.
    let atOne = 0;
    for (const level of LEVELS) for (let y = 1; y <= 4; y++) {
      const { code, seed, years } = rooms[level];
      atOne += differences(years[String(y)].result, recomputeYear({ ...briefP(level), intake: 1 }, code, seed, years[String(y)], years[String(y - 1)]).result).length;
    }
    control('a recompute with members taken in at 1.00 (the value before this change) disagrees with the New room', atOne);
    const planted: Record<string, StoredMarketYear> = JSON.parse(JSON.stringify(rooms.medium.years));
    const hit = Object.values(planted).flatMap(s => Object.values(s.result).flatMap(r => LINES.map(l => r[l]).filter(x => x && x.inGood > 0)))[0] as { qualityGood: number } | undefined;
    if (hit) hit.qualityGood = 0.85;
    control('a stored New result with a team taking leavers in at 0.85 is refused', hit ? intakeProblems(planted).problems.length : 0);
  }

  // ---- controls on the recompute: Current's values, all at once and one at a time ----
  {
    let all = 0, buckets = 0, cap = 0, fade = 0;
    for (const level of LEVELS) for (let y = 1; y <= 4; y++) {
      const { code, seed, years } = rooms[level];
      const s = years[String(y)], prev = years[String(y - 1)];
      const B = briefP(level), C = currentP(level);
      all += differences(s.result, recomputeYear(C, code, seed, s, prev).result).length;
      buckets += differences(s.result, recomputeYear({ ...B, risks: C.risks }, code, seed, s, prev).result).length;
      cap += differences(s.result, recomputeYear({ ...B, cap: C.cap }, code, seed, s, prev).result).length;
      fade += differences(s.result, recomputeYear({ ...B, fade: C.fade }, code, seed, s, prev).result).length;
    }
    control('a recompute on Current\'s values disagrees with the New room', all);
    control('a recompute on Current\'s buckets (unwidened) alone disagrees', buckets);
    control('a recompute on Current\'s 15% cap alone disagrees', cap);
    control('a recompute on Current\'s 50% fade alone disagrees', fade);
  }
  const cur = await playRoom('medium', 'current');
  ok(cur.room.marketVersion === undefined && [1, 2, 3, 4].every(y => cur.years[String(y)] && cur.years[String(y)].version === undefined)
    && differences(cur.years['1'].result, recomputeYear(currentP('medium'), cur.code, cur.seed, cur.years['1'], undefined).result).length === 0,
    'a Current room on the same plan stores no version, and its year 1 is the recompute on Current\'s values');
  ok(differences(cur.years['1'].result, rooms.medium.years['1'].result).length > 0, 'the New room moves members differently from the Current room on the same plan');

  // ==========================================================================
  // 3. THE FIXED ADMIN, PER WORLD
  // ==========================================================================
  console.log('\n3. The fixed admin, recomputed per world against a twin game on the same market without the version');
  type Row = { a: number; op: number };
  /** Each year's rows, per world and line: the admin charged and the admin booked. */
  function yearlyRows(start: GameState, decisionsByYear: Record<string, unknown> | undefined, market: ReturnType<typeof marketByYearForEngine>): Row[][][] {
    let state = start;
    const out: Row[][][] = [];
    for (let y = 1; y <= 4; y++) {
      state = replayTeamYears(state, y + 1, decisionsByYear as never, market).state;
      const ws = state.worlds && state.worlds.length ? state.worlds.map(w => w.lockedResults[w.lockedResults.length - 1]) : [state.lockedResults[state.lockedResults.length - 1]];
      out.push(ws.map(r => LINES.map(l => { const x = r.byLine[l] as LineResultSet; return { a: x.adminExpense, op: x.operatingExpense }; })));
    }
    return out;
  }
  type Fixed = { share: number; trend: number; baseIsThisYear?: boolean };
  /** The recompute's admin booked from the twin: (share × base × (1 + trend)^(y − 1) + (1 − share) × admin) × (1 + overrun). */
  function fixedProblems(nw: Row[][][], twin: Row[][][], fx: Fixed): string[] {
    const p: string[] = [];
    for (let y = 1; y <= 4; y++) for (let w = 0; w < nw[y - 1].length; w++) for (let li = 0; li < LINES.length; li++) {
      const n = nw[y - 1][w][li], c = twin[y - 1][w][li];
      if (Math.abs(n.a - c.a) > 1e-6 * Math.max(1, c.a)) { p.push(`y${y} w${w} ${LINES[li]}: the admin charged differs from the twin's`); continue; }
      const over = c.op / c.a - 1;
      const base = fx.baseIsThisYear ? n.a : nw[0][w][li].a;
      const want = (fx.share * base * (1 + fx.trend) ** (y - 1) + (1 - fx.share) * n.a) * (1 + over);
      if (Math.abs(n.op - want) > 1e-6 * Math.max(1, want)) p.push(`y${y} w${w} ${LINES[li]}: booked ${n.op.toFixed(0)} ≠ ${want.toFixed(0)}`);
    }
    return p;
  }
  {
    const M = rooms.medium;
    const strip = (gs: GameState): GameState => { const { marketVersion: _v, ...setup } = gs.setup; void _v; return { ...gs, setup }; };
    let probs: string[] = [], noTrend = 0, thisYear = 0, noFixed = 0, half = 0, worlds = 0, teamsChecked = 0, grew = 0;
    // The cheapest, a middle team and the one that lost its book (the others play the same arithmetic).
    for (const i of ['Alder', 'Dogwood', 'Elm'].map(n => plan.findIndex(p => p.name === n))) {
      const me = await t.read({ code: M.code, token: M.tokens[i] });
      const market = marketByYearForEngine(me.you?.marketByYear);
      const g0 = buildTeamGame(me.room, LINES).gameState;
      if (g0.setup.marketVersion !== 'new') probs.push(`${plan[i].name}: the team's game does not carry the New version`);
      const nw = yearlyRows(g0, me.you?.decisionsByYear, market);
      const twin = yearlyRows(strip(g0), me.you?.decisionsByYear, market);
      probs = probs.concat(fixedProblems(nw, twin, BRIEF_FIXED).map(x => `${plan[i].name} ${x}`));
      noTrend += fixedProblems(nw, twin, { ...BRIEF_FIXED, trend: 0 }).length;
      thisYear += fixedProblems(nw, twin, { ...BRIEF_FIXED, baseIsThisYear: true }).length;
      noFixed += fixedProblems(nw, twin, { share: 0, trend: 0 }).length;
      half += fixedProblems(nw, twin, { ...BRIEF_FIXED, share: 0.50 }).length;
      worlds = nw[0].length; teamsChecked++;
      if (plan[i].name === 'Elm') grew = nw[3][0][0].op / twin[3][0][0].op;
    }
    ok(probs.length === 0 && worlds > 1, `three New-room teams (${teamsChecked}), every world (${worlds}), year and line: admin booked = (0.25 × year-1 admin × 1.03^(year − 1) `
      + `+ 0.75 × this year's admin) × (1 + the overrun), and the admin charged is the twin's`, probs.slice(0, 4).join('; '));
    ok(grew > 1, `Elm, which lost its book to price, books more admin in year 4 than with all admin a share of premium (× ${grew.toFixed(3)}, world 1 WC)`);
    control('the fixed admin recomputed with no trend disagrees', noTrend);
    control('the fixed admin recomputed on this year\'s admin as the base disagrees', thisYear);
    control('the fixed admin recomputed with no fixed part (today\'s admin) disagrees', noFixed);
    control('the fixed admin recomputed at 50% (the share before pr/market-fixed-admin-25) disagrees', half);

    // A team that never locked has no market result: its admin books as today.
    const fir = await t.read({ code: M.code, token: M.tokens[plan.findIndex(p => p.name === 'Fir')] });
    const firG = buildTeamGame(fir.room, LINES).gameState;
    const a = replayTeamYears(firG, 5, fir.you?.decisionsByYear, marketByYearForEngine(fir.you?.marketByYear)).produced.map(p => JSON.stringify(p.result));
    const b = replayTeamYears(strip(firG), 5, fir.you?.decisionsByYear, marketByYearForEngine(fir.you?.marketByYear)).produced.map(p => JSON.stringify(p.result));
    ok(fir.you?.marketByYear === undefined && JSON.stringify(a) === JSON.stringify(b),
      'a team that never locked (no market result) plays byte-identical with and without the New version');
  }
  {
    // A New-version room with the market Off: no step stored, and every team's game is its Current twin's.
    const off = await playRoom('off', 'new');
    const offCur = await playRoom('off', 'current');
    let same = true;
    for (const i of [0, 4]) {
      const x = await t.read({ code: off.code, token: off.tokens[i] });
      const y = await t.read({ code: offCur.code, token: offCur.tokens[i] });
      const ra = replayTeamYears(buildTeamGame(x.room, LINES).gameState, 5, x.you?.decisionsByYear).produced.map(p => JSON.stringify(p.result));
      const rb = replayTeamYears(buildTeamGame(y.room, LINES).gameState, 5, y.you?.decisionsByYear).produced.map(p => JSON.stringify(p.result));
      if (JSON.stringify(ra) !== JSON.stringify(rb)) same = false;
    }
    ok(off.room.marketVersion === 'new' && Object.keys(off.years).length === 0 && same,
      'a New-version room with the market Off stores no step and its teams (the cheapest and the dearest) play byte-identical to their Current twins');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('\nmarket-new-version-check: FAILED'); process.exit(1); }
  console.log('\nmarket-new-version-check: PASS — the New market step and the fixed admin are the brief\'s, recomputed independently, and the controls fail.');
}

main().catch(e => { console.error(e); process.exit(1); });
