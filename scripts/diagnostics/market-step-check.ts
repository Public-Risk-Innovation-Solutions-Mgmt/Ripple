// ============================================================================
// MARKET COMPETITION: THE MARKET STEP, RECOMPUTED INDEPENDENTLY FROM THE POSTED
// RATES (pr/market-competition; utils/market/marketStep.ts, session/market.ts).
//
//   npx tsx scripts/diagnostics/market-step-check.ts
//
// 1. A REAL ROOM. Seven teams play a localStorage room at each level, four years,
//    with every case the server handles: different rates, appetites, non-renewal
//    (no team takes another's non-renewed members); a team that skips a year (counted at its last lock, on
//    its book carried forward); a team unlocked and not re-locked; a team that
//    never locks (left out). What the room STORES is then recomputed here from
//    the stored inputs alone (each team's posted rate, book and decisions, last
//    year's book risk and untaken dropped members) by a SECOND IMPLEMENTATION
//    written in this file from the brief, sharing nothing with marketStep.ts but
//    the parameters. Every field of every team's result must agree (1e-9), and
//    every stored input must be what the team posted (or, stale, its last lock).
// 2. THE RULES, on every stored result: leavers out = good leavers in; nobody
//    beyond its appetite; nobody leaves the cheapest team; good leavers only to
//    a team cheaper by more than 1%; OUTSIDE SUPPLY BY THE WIDE TAPER — none to a
//    team 20% or more above the room's average rate, and among the teams not
//    filled to their appetite, outside intake ÷ taper weight the same for all
//    (the supply is shared by weight); every team's outside newcomers on a line
//    the SAME MIX (one quality); no team takes another's dropped members;
//    willing leavers within the 15% cap; the book after = the book − out + in;
//    untaken dropped = dropped − taken.
// 3. THE SPEC'S NUMBERS: the buckets ÷ 1.02 average 1.00; the full skew's
//    average leaver is 0.90 / 0.80 / 0.70; dropped members average 1.5 − ½ ×
//    the share; the calibrated k (on the stretched funding tables, with two
//    controls); one pair's willing leavers inside k ×
//    (gap − 1%)² × 4 / (N − 1) ± 20%.
// 4. THE ENGINE TAKES IT: a team's game played on its stored result ends the
//    year on the book the step gave it (less the engine's drop), and a game with
//    no market input plays byte-identical to one without the field.
//
// CONTROLS, each of which must fail: a recompute without the fade; with the
// pulls summed instead of averaged; with the team keys left out of the seeds;
// with TODAY'S CUTOFF for outside supply (only at or below the average, cheapest
// first, up to the whole appetite); with BEST-FIRST outside quality (the
// cheapest takes the best of the draw); a stored input tampered with; and stored
// results planted with each rule broken (an intake past the appetite, a leaver
// from the cheapest team, outside supply to a team 25% over the average, outside
// intake moved off the taper's shares, one team's newcomers better than the
// others', another team's dropped members taken in, a book that does not add
// up).
// ============================================================================

import {
  MARKET_BOOK_RISK_FADE, MARKET_BUCKET_BASE_MIX, MARKET_BUCKETS_RAW, MARKET_COUNT_SPREAD, MARKET_FULL_SKEW_GAP,
  MARKET_FULL_SKEW_MEAN, MARKET_K, MARKET_LEAVER_CAP, MARKET_MEMBERS_PER_BOOK, MARKET_MIN_GAP, MARKET_OUTSIDE_SUPPLY,
  MARKET_OUTSIDE_QUALITY, MARKET_OUTSIDE_TAPER, MARKET_RIVAL_SCALE, type MarketLevel,
} from '../../src/data/pricingParameters';
import type { CoverageLine } from '../../src/types/simulation';
import type { MarketLockInput, StoredMarketYear, MarketTeamLineResult } from '../../src/session/contract';

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
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

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
const RAW_AVG = MARKET_BUCKETS_RAW.reduce((s, b, i) => s + b * MARKET_BUCKET_BASE_MIX[i], 0);
const RISKS = MARKET_BUCKETS_RAW.map(b => b / RAW_AVG);
const avgRisk = (mix: number[]) => mix.reduce((s, p, i) => s + p * RISKS[i], 0);
const tilted = (theta: number) => {
  const w = MARKET_BUCKET_BASE_MIX.map((p, i) => p * Math.exp(-theta * RISKS[i]));
  const t = w.reduce((a, b) => a + b, 0);
  return w.map(x => x / t);
};
/** θ for a target average, by bisection on [−200, 200], 200 halvings (the mean falls as θ rises). */
function thetaFor(target: number): number {
  let a = -200, b = 200;
  for (let i = 0; i < 200; i++) { const m = (a + b) / 2; if (avgRisk(tilted(m)) > target) a = m; else b = m; }
  return (a + b) / 2;
}
const leaverMixAt = (level: Level, gap: number) =>
  tilted(thetaFor(MARKET_FULL_SKEW_MEAN[level]) * Math.min(1, Math.max(0, (gap - MARKET_MIN_GAP) / (MARKET_FULL_SKEW_GAP - MARKET_MIN_GAP))));
const bucketOf = (mix: number[], u: number) => { let c = 0; for (let i = 0; i < mix.length; i++) { c += mix[i]; if (u < c) return i; } return mix.length - 1; };
/** Whole members by weight: floors, then the largest remainders, ties broken by a draw per weight. */
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

interface LineIn { rate: number; book: number; bookRisk: number; newMembers: number; nonRenewal: number }
interface Variant { noFade?: boolean; summedPulls?: boolean; noTeamSeed?: boolean; cutoff?: boolean; bestFirst?: boolean }

/** The brief's taper: 1 at or below the average, 1 − (over ÷ 20%) above it, never below 0. */
const taperWeight = (rate: number, avgRate: number) => {
  const over = rate / avgRate - 1;
  return over <= 0 ? 1 : Math.max(0, 1 - over / MARKET_OUTSIDE_TAPER);
};

function recomputeLine(level: Level, seed: string, year: number, line: CoverageLine,
  teams: { key: string; x: LineIn }[], untakenLast: number, v: Variant = {}) {
  const N = teams.length;
  const k = MARKET_K[level][line];
  const rate = teams.map(t => t.x.rate), book = teams.map(t => t.x.book);
  const risk0 = teams.map(t => (v.noFade ? t.x.bookRisk : 1 + (t.x.bookRisk - 1) * (1 - MARKET_BOOK_RISK_FADE)));
  const tk = (i: number) => (v.noTeamSeed ? 'X' : teams[i].key);
  const gapPull = (i: number, j: number) => { const g = rate[i] / rate[j] - 1; return i !== j && g > MARKET_MIN_GAP ? k * (g - MARKET_MIN_GAP) ** 2 : 0; };
  const cheapestFirst = teams.map((_, j) => j).sort((a, b) => rate[a] - rate[b] || teams[a].key.localeCompare(teams[b].key));
  const room = teams.map(t => Math.max(0, t.x.newMembers) * t.x.book);
  const appetite = [...room];
  const z = () => Array(N).fill(0) as number[];
  const out = z(), outRisk = z(), willing = z();
  const good = z(), goodRisk = z(), outside = z(), outsideRisk = z(), drop = z(), dropRisk = z();
  type M = { from: number; e: number; risk: number; to: number };
  const leavers: M[] = [];
  if (N > 1) for (let i = 0; i < N; i++) {
    const pulls = rate.map((_, j) => gapPull(i, j));
    const tot = pulls.reduce((a, b) => a + b, 0);
    if (tot <= 0) continue;
    const spread = 1 + MARKET_COUNT_SPREAD * (2 * draws(`${seed}|n|${tk(i)}|${line}|${year}`)() - 1);
    const f = Math.min(MARKET_LEAVER_CAP, (v.summedPulls ? tot : tot * MARKET_RIVAL_SCALE / (N - 1)) * spread);
    const n = Math.max(1, Math.round(f * MARKET_MEMBERS_PER_BOOK));
    const rnd = draws(`${seed}|${tk(i)}|${line}|${year}`);
    const cnt = share(n, pulls, rnd);
    for (let j = 0; j < N; j++) for (let q = 0; q < cnt[j]; q++) {
      leavers.push({ from: i, e: f * book[i] / n, risk: risk0[i] * RISKS[bucketOf(leaverMixAt(level, rate[i] / rate[j] - 1), rnd())], to: -1 });
    }
    willing[i] = f;
  }
  const take = (j: number, m: { e: number; to: number }) => { if (m.to < 0 && m.e <= room[j] + 1e-9) { m.to = j; room[j] -= m.e; return true; } return false; };
  for (let round = 0; round < 50; round++) {
    const asking: M[][] = teams.map(() => []);
    for (let i = 0; i < N; i++) {
      const left = leavers.filter(m => m.from === i && m.to < 0).sort((a, b) => a.risk - b.risk);
      const to = teams.map((_, j) => j).filter(j => gapPull(i, j) > 0 && room[j] > 1e-9);
      if (!left.length || !to.length) continue;
      const cnt = share(left.length, to.map(j => gapPull(i, j)), draws(`${seed}|ask|${tk(i)}|${line}|${year}|${round}`));
      const order = to.map((j, q) => ({ j, c: cnt[q] })).sort((a, b) => rate[a.j] - rate[b.j] || teams[a.j].key.localeCompare(teams[b.j].key));
      let p = 0;
      for (const { j, c } of order) for (let q = 0; q < c; q++) asking[j].push(left[p++]);
    }
    let moved = false;
    for (const j of cheapestFirst) for (const m of asking[j].sort((a, b) => a.risk - b.risk)) moved = take(j, m) || moved;
    if (!moved) break;
  }
  for (const m of leavers) if (m.to >= 0) { out[m.from] += m.e; outRisk[m.from] += m.e * m.risk; good[m.to] += m.e; goodRisk[m.to] += m.e * m.risk; }
  const roomBook = book.reduce((a, b) => a + b, 0);
  const avgRate = rate.reduce((a, b) => a + b, 0) / N;
  const supply = MARKET_OUTSIDE_SUPPLY * roomBook + Math.max(0, untakenLast);
  const nNew = Math.round(supply / (roomBook / N / MARKET_MEMBERS_PER_BOOK));
  if (nNew > 0) {
    const rnd = draws(`${seed}|outside|${line}|${year}`);
    const risks = Array.from({ length: nNew }, () => RISKS[bucketOf([...MARKET_BUCKET_BASE_MIX], rnd())]);
    const each = supply / nNew;
    const mix = risks.reduce((a, b) => a + b, 0) / nNew;
    const intake = z();
    if (v.cutoff) {
      // CONTROL: today's cutoff — at or below the average, cheapest first, whole newcomers up to the appetite.
      for (const j of cheapestFirst) if (rate[j] <= avgRate + 1e-12) {
        for (let q = 0; q < nNew; q++) if (intake.reduce((a, b) => a + b, 0) + each <= supply + 1e-9 && each <= room[j] - intake[j] + 1e-9) intake[j] += each;
      }
    } else {
      // The wide taper, solved as "fill the teams whose share would pass their room, share the rest by weight".
      const w = rate.map(x => taperWeight(x, avgRate));
      const filled = new Set<number>();
      const cand = teams.map((_, j) => j).filter(j => w[j] > 0 && room[j] > 1e-9); // the teams with room left
      for (;;) {
        const free = cand.filter(j => !filled.has(j));
        const rest = supply - [...filled].reduce((a, j) => a + room[j], 0);
        const W = free.reduce((a, j) => a + w[j], 0);
        const over = free.filter(j => W > 0 && rest * w[j] / W > room[j] + 1e-12);
        if (!over.length) { for (const j of free) intake[j] = W > 0 ? rest * w[j] / W : 0; break; }
        for (const j of over) filled.add(j);
      }
      for (const j of filled) intake[j] = room[j];
    }
    if (v.bestFirst) {
      // CONTROL: best-first quality — the cheapest takes the best of the draw.
      const sorted = [...risks].sort((a, b) => a - b);
      let k = 0, part = 1;
      for (const j of cheapestFirst) {
        let need = intake[j] / each;
        while (need > 1e-12 && k < sorted.length) { const t = Math.min(need, part); outsideRisk[j] += t * each * sorted[k]; need -= t; part -= t; if (part <= 1e-12) { k++; part = 1; } }
      }
    } else for (let j = 0; j < N; j++) outsideRisk[j] += intake[j] * mix;
    for (let j = 0; j < N; j++) { outside[j] += intake[j]; room[j] -= intake[j]; }
  }
  // Non-renewed members: no team takes them; every one leaves the market (next year's refill).
  const dropped = z(), droppedTaken = z();
  let untaken = 0;
  for (let i = 0; i < N; i++) {
    const a1 = Math.max(0, teams[i].x.nonRenewal);
    if (a1 > 0) { dropped[i] = a1 * (book[i] - out[i] + good[i] + outside[i]); untaken += dropped[i]; }
  }
  const res: Record<string, MarketTeamLineResult> = {};
  for (let i = 0; i < N; i++) {
    const after = book[i] - out[i] + good[i] + outside[i] + drop[i];
    const mass = risk0[i] * book[i] - outRisk[i] + goodRisk[i] + outsideRisk[i] + dropRisk[i];
    res[teams[i].key] = {
      bookRiskBefore: risk0[i], willingShare: willing[i], leftShare: book[i] > 0 ? out[i] / book[i] : 0, outExposure: out[i],
      inGood: good[i], inOutside: outside[i], inDropped: drop[i],
      qualityGood: good[i] > 0 ? goodRisk[i] / good[i] : null, qualityOutside: outside[i] > 0 ? outsideRisk[i] / outside[i] : null,
      qualityDropped: drop[i] > 0 ? dropRisk[i] / drop[i] : null, qualityLeft: out[i] > 0 ? outRisk[i] / out[i] / risk0[i] : null,
      appetite: appetite[i], droppedExposure: dropped[i], droppedTaken: droppedTaken[i], bookAfter: after,
      bookRisk: after > 0 ? mass / after : 1, engineNonRenewal: after > 0 ? dropped[i] / after : 0,
    };
  }
  return { res, untaken };
}

/** A stored year, recomputed from its stored inputs and last year's stored step alone. */
function recomputeYear(code: string, seed: string, s: StoredMarketYear, prev: StoredMarketYear | undefined, v: Variant = {}) {
  const result: Record<string, Partial<Record<CoverageLine, MarketTeamLineResult>>> = {};
  const untaken: Partial<Record<CoverageLine, number>> = {};
  const names = Object.keys(s.inputs).sort((a, b) => s.inputs[a].teamNumber - s.inputs[b].teamNumber);
  for (const n of names) result[n] = {};
  for (const line of LINES) {
    const ts = names.filter(n => (s.inputs[n].byLine[line]?.book ?? 0) > 0).map(n => {
      const l = s.inputs[n].byLine[line]!;
      return { name: n, key: `T${s.inputs[n].teamNumber}`, x: { ...l, bookRisk: prev?.result[n]?.[line]?.bookRisk ?? 1 } };
    });
    if (!ts.length) continue;
    const { res, untaken: u } = recomputeLine(s.level as Level, `${code}|${seed}`, s.year, line, ts, prev?.untakenDropped[line] ?? 0, v);
    for (const t of ts) result[t.name][line] = res[t.key];
    untaken[line] = u;
  }
  return { result, untaken };
}

/** Field-by-field differences between two years' results (1e-9, relative where large). */
function differences(a: StoredMarketYear['result'], b: StoredMarketYear['result'], ua?: Partial<Record<CoverageLine, number>>, ub?: Partial<Record<CoverageLine, number>>): string[] {
  const out: string[] = [];
  const same = (x: unknown, y: unknown) => (x === null || y === null || x === undefined || y === undefined)
    ? x === y : Math.abs((x as number) - (y as number)) <= 1e-9 * Math.max(1, Math.abs(x as number));
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const n of names) for (const line of LINES) {
    const x = a[n]?.[line], y = b[n]?.[line];
    if (!x && !y) continue;
    if (!x || !y) { out.push(`${n} ${line}: present in one only`); continue; }
    for (const f of Object.keys(x) as (keyof MarketTeamLineResult)[]) if (!same(x[f], y[f])) out.push(`${n} ${line} ${f}: ${x[f]} vs ${y[f]}`);
  }
  if (ua && ub) for (const line of LINES) if (!same(ua[line] ?? 0, ub[line] ?? 0)) out.push(`untaken ${line}: ${ua[line]} vs ${ub[line]}`);
  return out;
}

/** The rules, on a stored year. */
function ruleProblems(s: StoredMarketYear): string[] {
  const p: string[] = [];
  for (const line of LINES) {
    const names = Object.keys(s.result).filter(n => s.result[n][line]);
    if (!names.length) continue;
    const rate = (n: string) => s.inputs[n].byLine[line]!.rate;
    const r = (n: string) => s.result[n][line]!;
    const avg = names.reduce((a, n) => a + rate(n), 0) / names.length;
    const cheapest = Math.min(...names.map(rate));
    const sumOut = names.reduce((a, n) => a + r(n).outExposure, 0);
    const sumGood = names.reduce((a, n) => a + r(n).inGood, 0);
    if (Math.abs(sumOut - sumGood) > 1e-6 * Math.max(1, sumOut)) p.push(`${line}: leavers out ${sumOut} ≠ good leavers in ${sumGood}`);
    const dropped = names.reduce((a, n) => a + r(n).droppedExposure - r(n).droppedTaken, 0);
    if (Math.abs(dropped - (s.untakenDropped[line] ?? 0)) > 1e-6 * Math.max(1, dropped)) p.push(`${line}: untaken dropped ≠ dropped − taken`);
    // The wide taper's shares: among the teams not filled to their appetite, outside intake ÷ weight is one number.
    const open = names.filter(n => taperWeight(rate(n), avg) > 0 && r(n).inGood + r(n).inOutside + r(n).inDropped < r(n).appetite - 1e-6);
    const per = open.map(n => r(n).inOutside / taperWeight(rate(n), avg));
    if (per.length > 1 && Math.max(...per) - Math.min(...per) > 1e-6 * Math.max(1, ...per)) p.push(`${line}: outside supply not shared by the taper's weights`);
    // The same mix: every team's outside newcomers on the line carry one quality.
    const q = names.filter(n => r(n).inOutside > 0).map(n => r(n).qualityOutside!);
    if (q.length > 1 && Math.max(...q) - Math.min(...q) > 1e-9) p.push(`${line}: outside newcomers' quality differs between teams`);
    for (const n of names) {
      const x = r(n), book = s.inputs[n].byLine[line]!.book, input = s.inputs[n].byLine[line]!;
      const intake = x.inGood + x.inOutside + x.inDropped;
      if (intake > x.appetite + 1e-6) p.push(`${n} ${line}: took ${intake} past its appetite ${x.appetite}`);
      if (Math.abs(x.appetite - input.newMembers * book) > 1e-6 * Math.max(1, book)) p.push(`${n} ${line}: appetite is not New Members × book`);
      if (rate(n) === cheapest && x.willingShare > 0) p.push(`${n} ${line}: members want to leave the cheapest team`);
      if (x.willingShare > MARKET_LEAVER_CAP + 1e-12) p.push(`${n} ${line}: willing leavers past the cap`);
      if (x.leftShare > x.willingShare + 1e-9) p.push(`${n} ${line}: more left than wanted to`);
      if (x.inGood > 0 && !names.some(m => rate(m) / rate(n) - 1 > MARKET_MIN_GAP && r(m).outExposure > 0)) p.push(`${n} ${line}: good leavers with no team dearer by over 1% losing any`);
      if (x.inOutside > 0 && rate(n) >= avg * (1 + MARKET_OUTSIDE_TAPER) - 1e-12) p.push(`${n} ${line}: outside supply to a team 20% or more above the average rate`);
      if (x.inDropped > 0 || x.droppedTaken > 0) p.push(`${n} ${line}: another team's non-renewed members taken in`);
      if (Math.abs(x.bookAfter - (book - x.outExposure + intake)) > 1e-6 * Math.max(1, book)) p.push(`${n} ${line}: book after ≠ book − out + in`);
      if (x.droppedTaken > x.droppedExposure + 1e-9) p.push(`${n} ${line}: more of its dropped members taken than it dropped`);
    }
  }
  return p;
}

// ============================================================================
// 1. A REAL ROOM, AT EACH LEVEL
// ============================================================================

async function main() {
  const { LocalSessionTransport } = await import('../../src/session/localTransport');
  const { newSessionToken } = await import('../../src/session/contract');
  const { marketByYearForEngine } = await import('../../src/session/market');
  const { buildTeamGame, replayTeamYears } = await import('../../src/session/client/buildGame');
  const { marketLockInputFor } = await import('../../src/session/client/marketLock');
  const { decisionsForYear, decisionsToJson } = await import('../../src/session/client/decisions');

  const t = new LocalSessionTransport({ latencyMs: 0 });
  const stored: Record<Level, { code: string; seed: string; years: Record<string, StoredMarketYear>; posted: Record<string, Record<string, MarketLockInput>> }> = {} as never;
  // Per team: rate factor, New Members, Non-Renewal — per line a little different.
  const plan = [
    { name: 'Alder', f: 0.94, nm: 0.10, nr: 0.00 },
    { name: 'Birch', f: 0.98, nm: 0.06, nr: 0.03 },
    { name: 'Cedar', f: 1.00, nm: 0.04, nr: 0.05 },
    { name: 'Dogwood', f: 1.05, nm: 0.02, nr: 0.08 },   // skips year 3
    { name: 'Elm', f: 1.12, nm: 0.00, nr: 0.10 },       // unlocked in year 2, not re-locked
    { name: 'Fir', f: 1.00, nm: 0.05, nr: 0.00 },        // never locks
    // A sixth team in the step, so averaging over N − 1 = 5 rivals × 4 is not the sum (at five it would be).
    { name: 'Gum', f: 0.97, nm: 0.03, nr: 0.02 },
  ];
  console.log('\n1. A room at each level: what it stores, recomputed independently from the posted rates');
  for (const level of ['low', 'medium', 'high'] as Level[]) {
    const host = newSessionToken();
    const made = await t.createRoom({ hostToken: host, seed: '7', yearCount: 4, startingYear: 2027, eventName: `Market ${level}`,
      expectedTeams: plan.length, lines: LINES, shocks: [], market: level });
    const joined = [];
    for (const p of plan) joined.push(await t.join({ code: made.code, teamName: p.name, role: 'player' }));
    const base = buildTeamGame((await t.read({ code: made.code, token: host })).room, LINES).gameState;
    const posted: Record<string, Record<string, MarketLockInput>> = {};
    for (let year = 1; year <= 4; year++) {
      for (let i = 0; i < plan.length; i++) {
        const p = plan[i];
        if (p.name === 'Fir' || (p.name === 'Dogwood' && year === 3)) continue;
        const me = await t.read({ code: made.code, token: joined[i].teamToken });
        // The team's own game, on its own stored results: the book it posts is its game's.
        const g = replayTeamYears(buildTeamGame(me.room, LINES).gameState, year, me.you?.decisionsByYear, marketByYearForEngine(me.you?.marketByYear)).state;
        const d = decisionsForYear(year, undefined, false);
        for (const [j, line] of LINES.entries()) {
          d.byLine[line] = { ...d.byLine[line], newMembers: Math.max(0, p.nm - 0.01 * j), nonRenewal: p.nr };
        }
        const m = marketLockInputFor(g, d, year)!;
        // Rates spread by the team's factor, a touch more each year so the gaps move.
        for (const line of LINES) m.byLine[line] = { ...m.byLine[line]!, rate: m.byLine[line]!.rate * (1 + (p.f - 1) * (1 + 0.1 * year)) };
        await t.submit({ code: made.code, token: joined[i].teamToken, yearNumber: year, decisions: decisionsToJson(d), market: m });
        (posted[p.name] ??= {})[String(year)] = m;
        if (p.name === 'Elm' && year === 2) {
          await t.undoLock({ code: made.code, token: host, teamName: 'Elm', yearNumber: 2 });
          delete posted[p.name]['2'];
        }
      }
      await t.advance({ code: made.code, token: host, expectedYear: year });
    }
    const room = (await t.read({ code: made.code, token: host })).room;
    stored[level] = { code: made.code, seed: room.seed, years: room.marketByYear!, posted };
    void base;
  }

  for (const level of ['low', 'medium', 'high'] as Level[]) {
    const { code, seed, years, posted } = stored[level];
    let diffs: string[] = [], rules: string[] = [];
    const inputProblems: string[] = [];
    let movedTeams = 0;
    for (let y = 1; y <= 4; y++) {
      const s = years[String(y)], prev = years[String(y - 1)];
      if (!s) { diffs.push(`year ${y} not stored`); continue; }
      const re = recomputeYear(code, seed, s, prev);
      diffs = diffs.concat(differences(s.result, re.result, s.untakenDropped, re.untaken).map(d => `y${y} ${d}`));
      rules = rules.concat(ruleProblems(s).map(d => `y${y} ${d}`));
      for (const [n, inp] of Object.entries(s.inputs)) {
        const lastLock = Object.keys(posted[n] ?? {}).map(Number).filter(k => k <= y).sort((a, b) => b - a)[0];
        if (lastLock === undefined) { inputProblems.push(`y${y} ${n} counted though it never locked`); continue; }
        if (inp.stale !== (lastLock !== y) || inp.fromYear !== lastLock) inputProblems.push(`y${y} ${n}: stale/fromYear wrong`);
        for (const line of LINES) {
          const want = posted[n][String(lastLock)].byLine[line]!;
          const got = inp.byLine[line]!;
          if (got.rate !== want.rate || got.newMembers !== want.newMembers || got.nonRenewal !== want.nonRenewal) {
            inputProblems.push(`y${y} ${n} ${line}: the stored rate or decisions are not the ones posted`);
          }
          const pr = prev?.result[n]?.[line];
          const book = inp.stale && pr ? pr.bookAfter * (1 - pr.engineNonRenewal) : want.book;
          if (Math.abs(got.book - book) > 1e-9 * book) inputProblems.push(`y${y} ${n} ${line}: book ${got.book} ≠ ${book}`);
        }
      }
      if (!s.missing.includes('Fir') || s.inputs.Fir) inputProblems.push(`y${y}: the team that never locked is not left out`);
      movedTeams += Object.values(s.result).filter(r => LINES.some(l => (r[l]?.outExposure ?? 0) > 0)).length;
    }
    ok(diffs.length === 0, `${level}: every stored result, four years × three lines × six teams, matches the independent recompute`, diffs.slice(0, 5).join('; '));
    ok(inputProblems.length === 0, `${level}: every stored input is the team's posted rate and decisions (a stale team's last lock, on its carried book; Fir left out)`, inputProblems.slice(0, 5).join('; '));
    ok(rules.length === 0, `${level}: every stored result keeps the rules`, rules.slice(0, 5).join('; '));
    ok(movedTeams > 0, `${level}: members moved (${movedTeams} team-years lost members)`);
    ok(years['2']?.inputs.Elm?.stale === true && years['2']?.inputs.Elm?.fromYear === 1, `${level}: Elm, unlocked in year 2 and not re-locked, counts at its year-1 lock`);
    ok(years['3']?.inputs.Dogwood?.stale === true, `${level}: Dogwood, which skipped year 3, counts at its year-2 lock`);
  }

  // ---- controls on the recompute ----
  const M = stored.medium;
  const y2 = M.years['2'], y1 = M.years['1'];
  control('a recompute without the book risk fade disagrees', differences(y2.result, recomputeYear(M.code, M.seed, y2, y1, { noFade: true }).result).length);
  control('a recompute with the pulls summed, not averaged over the rivals × 4, disagrees', differences(y1.result, recomputeYear(M.code, M.seed, y1, undefined, { summedPulls: true }).result).length);
  control('a recompute with the team keys left out of the seeds disagrees', differences(y1.result, recomputeYear(M.code, M.seed, y1, undefined, { noTeamSeed: true }).result).length);
  {
    // Today's rules, each on its own, must disagree with what the room stores — in every year and level together.
    let cut = 0, best = 0;
    for (const level of ['low', 'medium', 'high'] as Level[]) for (let y = 1; y <= 4; y++) {
      const st = stored[level], s = st.years[String(y)], prev = st.years[String(y - 1)];
      cut += differences(s.result, recomputeYear(st.code, st.seed, s, prev, { cutoff: true }).result).length;
      best += differences(s.result, recomputeYear(st.code, st.seed, s, prev, { bestFirst: true }).result).length;
    }
    control('a recompute with today\'s cutoff for outside supply (at or below the average, cheapest first) disagrees', cut);
    control('a recompute with best-first outside quality (the cheapest takes the best of the draw) disagrees', best);
  }
  const tampered: StoredMarketYear = JSON.parse(JSON.stringify(y1));
  tampered.inputs.Elm.byLine.WC!.rate *= 0.9;
  control('a stored rate tampered with no longer reproduces the stored result', differences(y1.result, recomputeYear(M.code, M.seed, tampered, undefined).result).length);

  // ---- controls on the rules ----
  const plant = (f: (s: StoredMarketYear) => void) => { const s: StoredMarketYear = JSON.parse(JSON.stringify(y1)); f(s); return ruleProblems(s).length; };
  control('an intake past the appetite is refused', plant(s => { const x = s.result.Alder.WC! as { inGood: number; appetite: number }; x.inGood = x.appetite * 2; }));
  control('a leaver from the cheapest team is refused', plant(s => { (s.result.Alder.WC as { willingShare: number }).willingShare = 0.02; }));
  control('outside supply to a team 25% over the average rate is refused', plant(s => {
    const names = Object.keys(s.result).filter(n => s.result[n].WC);
    const others = names.filter(n => n !== 'Elm').reduce((a, n) => a + s.inputs[n].byLine.WC!.rate, 0);
    // Elm's rate set so it sits 25% over the room's average (with itself in it): r = 1.25 × (others + r) / N.
    const N = names.length;
    s.inputs.Elm.byLine.WC!.rate = 1.25 * others / (N - 1.25);
    const x = s.result.Elm.WC as { inOutside: number; bookAfter: number; appetite: number };
    x.appetite = Math.max(x.appetite, 1); x.inOutside = 1; x.bookAfter += 1;
  }));
  {
    // One team's outside newcomers made better than the others' on a line where at least two took some.
    let problems = 0;
    for (let y = 1; y <= 4 && !problems; y++) for (const line of LINES) {
      const s: StoredMarketYear = JSON.parse(JSON.stringify(M.years[String(y)]));
      const took = Object.keys(s.result).filter(k => (s.result[k][line]?.inOutside ?? 0) > 0);
      if (took.length < 2) continue;
      (s.result[took[0]][line] as { qualityOutside: number }).qualityOutside *= 0.9;
      problems = ruleProblems(s).length;
      break;
    }
    control('one team\'s outside newcomers better than the others\' is refused', problems);
  }
  control('another team\'s dropped members taken in are refused', plant(s => { (s.result.Cedar.WC as { inDropped: number }).inDropped = 0.5; }));
  control('a book that does not add up is refused', plant(s => { (s.result.Birch.GL as { bookAfter: number }).bookAfter *= 1.01; }));

  // ============================================================================
  // 2b. A SUPPLY-SHORT LINE — where the taper's shares decide who gets what
  // ============================================================================
  // The room above rarely runs short of outside members (its appetites are small),
  // so here every team wants 10% and the supply is 2% of the room: the engine's
  // result must be the recompute's, the shares must follow the weights, and moving
  // intake off them must be refused.
  console.log('\n2b. A supply-short line: the wide taper decides the shares');
  {
    const { runMarketStep } = await import('../../src/utils/market/marketStep');
    const f = [0.92, 0.97, 1.00, 1.03, 1.08, 1.30];
    const keys = f.map((_, i) => `T${i + 1}`);
    const avgF = f.reduce((a, b) => a + b, 0) / f.length;
    const lineIn = (i: number) => ({ rate: 4 * f[i], book: 100, bookRisk: 1, newMembers: 0.10, nonRenewal: 0 });
    const eng = runMarketStep({ level: 'medium', seed: 'SHORT|7', year: 1, lines: ['WC'],
      teams: keys.map((key, i) => ({ key, lines: { WC: lineIn(i) } })), untakenDroppedLastYear: {} });
    const re = recomputeLine('medium', 'SHORT|7', 1, 'WC', keys.map((key, i) => ({ key, x: lineIn(i) })), 0);
    const engRes: StoredMarketYear['result'] = {}, reRes: StoredMarketYear['result'] = {};
    for (const k of keys) { engRes[k] = { WC: eng.teams[k].WC! }; reRes[k] = { WC: re.res[k] }; }
    const d = differences(engRes, reRes);
    ok(d.length === 0, 'the engine\'s supply-short line is the recompute\'s, field by field', d.slice(0, 4).join('; '));
    const s: StoredMarketYear = { year: 1, level: 'medium', missing: [], result: engRes, untakenDropped: { WC: eng.untakenDropped.WC ?? 0 },
      inputs: Object.fromEntries(keys.map((k, i) => [k, { teamNumber: i + 1, fromYear: 1, stale: false, byLine: { WC: { rate: 4 * f[i], book: 100, newMembers: 0.10, nonRenewal: 0 } } }])) };
    const x = (i: number) => engRes[keys[i]].WC!;
    const all = [0, 1, 2, 3, 4, 5];
    // The cheapest fill on dearer teams' leavers first; the outside supply then fills who it can and shares the rest.
    const open = all.filter(i => taperWeight(f[i], avgF) > 0 && x(i).inGood + x(i).inOutside < x(i).appetite - 1e-6);
    const full = all.filter(i => taperWeight(f[i], avgF) > 0 && !open.includes(i));
    const per = open.map(i => x(i).inOutside / taperWeight(f[i], avgF));
    const supply = all.reduce((a, i) => a + x(i).inOutside, 0);
    ok(open.length >= 2 && open.includes(4) && ruleProblems(s).length === 0 && Math.max(...per) - Math.min(...per) < 1e-9 * Math.max(...per)
      && full.every(i => Math.abs(x(i).inGood + x(i).inOutside - x(i).appetite) < 1e-6) && x(5).inOutside === 0
      && Math.abs(supply - 0.02 * 600) < 1e-9,
      `the supply (${supply.toFixed(2)}, 2% of the room) is all given: ${full.map(i => keys[i]).join(', ')} filled to their appetites, `
      + `${open.map(i => `${keys[i]} ${x(i).inOutside.toFixed(3)} at weight ${taperWeight(f[i], avgF).toFixed(3)}`).join(', ')} — intake ∝ weight; `
      + `the team ${(100 * (f[5] / avgF - 1)).toFixed(0)}% over the average gets none; the rules hold`);
    const q = [0, 1, 2, 3, 4].map(i => x(i).qualityOutside!);
    ok(Math.max(...q) - Math.min(...q) < 1e-12, `every team's outside newcomers carry the same quality (${q[0].toFixed(4)})`);
    const moved: StoredMarketYear = JSON.parse(JSON.stringify(s));
    const a = moved.result[keys[open[0]]].WC! as { inOutside: number; bookAfter: number }, b = moved.result[keys[open[1]]].WC! as { inOutside: number; bookAfter: number };
    const dd = a.inOutside * 0.25;
    a.inOutside -= dd; a.bookAfter -= dd; b.inOutside += dd; b.bookAfter += dd;
    control('outside intake moved off the taper\'s shares (a quarter of one open team\'s, to another) is refused', ruleProblems(moved).length);
    const cutRe = recomputeLine('medium', 'SHORT|7', 1, 'WC', keys.map((key, i) => ({ key, x: lineIn(i) })), 0, { cutoff: true });
    const cutRes: StoredMarketYear['result'] = {};
    for (const k of keys) cutRes[k] = { WC: cutRe.res[k] };
    control('today\'s cutoff on the supply-short line disagrees with the engine', differences(engRes, cutRes).length);
  }

  // ============================================================================
  // 3. THE SPEC'S NUMBERS
  // ============================================================================
  console.log('\n3. The spec\'s numbers');
  const { MARKET_BUCKETS, leaverMix, droppedMix, seededRandom } = await import('../../src/utils/market/marketStep');
  ok(MARKET_BUCKETS.every((b, i) => Math.abs(b - MARKET_BUCKETS_RAW[i] / 1.02) < 1e-12) && Math.abs(avgRisk([...MARKET_BUCKET_BASE_MIX]) - 1) < 1e-12,
    'the buckets are 0.60 / 0.80 / 1.00 / 1.25 / 1.60, each ÷ 1.02, and the even mix averages 1.00');
  for (const level of ['low', 'medium', 'high'] as Level[]) {
    const at = (g: number) => leaverMix(level, g).reduce((s, p, i) => s + p * MARKET_BUCKETS[i], 0);
    ok(Math.abs(at(0.10) - MARKET_FULL_SKEW_MEAN[level]) < 1e-6 && Math.abs(at(0.25) - MARKET_FULL_SKEW_MEAN[level]) < 1e-6 && Math.abs(at(0.01) - 1) < 1e-12,
      `${level}: the average leaver is 1.00 at a 1% gap and ${MARKET_FULL_SKEW_MEAN[level].toFixed(2)} at 10% and beyond`);
  }
  ok([0.01, 0.05, 0.10].every(a => Math.abs(droppedMix(a).reduce((s, p, i) => s + p * MARKET_BUCKETS[i], 0) - (1.5 - 0.5 * a)) < 1e-6),
    'dropped members average 1.5 − ½ × the share dropped (1.495 / 1.475 / 1.45)');
  // RESTATED AT pr/clf-stretch: k is the one measured on the stretched funding
  // tables (Medium WC 0.600 / GL 0.618 / Property 0.617), which land with it; it
  // was aws's interim rescale to the unstretched tables (6.159 / 1.364 / 2.242).
  const kIsStretched = (K: typeof MARKET_K) => K.medium.WC === 0.600 && K.medium.GL === 0.618 && K.medium.Property === 0.617
    && LINES.every(l => Math.abs(K.low[l] - K.medium[l] / 2) < 1e-12 && Math.abs(K.high[l] - K.medium[l] * 2) < 1e-12);
  ok(kIsStretched(MARKET_K), 'k is the calibrated one, on the stretched tables: Medium WC 0.600 / GL 0.618 / Property 0.617, Low half, High double');
  {
    const UNSTRETCHED = { low: { WC: 3.080, GL: 0.682, Property: 1.121 }, medium: { WC: 6.159, GL: 1.364, Property: 2.242 }, high: { WC: 12.318, GL: 2.728, Property: 4.484 } };
    control('k rescaled to the unstretched tables (Medium WC 6.159 / GL 1.364 / Property 2.242) is refused', kIsStretched(UNSTRETCHED) ? 0 : 1);
    const lowNotHalf = { ...MARKET_K, low: { ...MARKET_K.low, GL: MARKET_K.medium.GL * 0.6 } };
    control('a Low that is not half of Medium is refused', kIsStretched(lowNotHalf) ? 0 : 1);
  }
  ok(MARKET_FULL_SKEW_GAP === 0.10 && MARKET_MIN_GAP === 0.01 && MARKET_LEAVER_CAP === 0.15 && MARKET_COUNT_SPREAD === 0.20
    && MARKET_RIVAL_SCALE === 4 && MARKET_OUTSIDE_SUPPLY === 0.02 && MARKET_BOOK_RISK_FADE === 0.50,
    'full skew at 10%, no pull below 1%, the 15% cap, ±20%, × 4 over the rivals, 2% outside supply, 50% fade');
  {
    const { outsideWeight } = await import('../../src/utils/market/marketStep');
    const pts: [number, number][] = [[0.80, 1], [1.00, 1], [1.05, 0.75], [1.10, 0.5], [1.15, 0.25], [1.20, 0], [1.40, 0]];
    ok(MARKET_OUTSIDE_TAPER === 0.20 && MARKET_OUTSIDE_QUALITY === 'same mix'
      && pts.every(([x, w]) => Math.abs(outsideWeight(x, 1) - w) < 1e-12 && Math.abs(taperWeight(x, 1) - w) < 1e-12),
      'the wide taper: weight 1 at or below the average, 0.75 / 0.5 / 0.25 at 5 / 10 / 15% over, 0 from 20% over; the same mix');
  }
  {
    // One dear team, four rivals at one rate: four pulls of k(g − 1%)², averaged over the 4 rivals × 4, ± 20%.
    const gap = 0.06, ks = MARKET_K.medium.WC * (gap - 0.01) ** 2 * 4 / 4 * 4;
    let inBand = 0, n = 0, lo = Infinity, hi = 0;
    for (let s = 0; s < 200; s++) {
      const teams = [0, 1, 2, 3, 4].map(i => ({ key: `T${i + 1}`, x: { rate: i === 0 ? 1 + gap : 1, book: 100, bookRisk: 1, newMembers: 0.1, nonRenewal: 0 } }));
      const w = recomputeLine('medium', `S${s}`, 1, 'WC', teams, 0).res.T1.willingShare;
      lo = Math.min(lo, w / ks); hi = Math.max(hi, w / ks); n++;
      if (w >= ks * 0.8 - 1e-12 && w <= ks * 1.2 + 1e-12) inBand++;
    }
    ok(inBand === n && hi - lo > 0.3, `a team 6% dearer than four rivals: willing leavers 4 × k(g − 1%)² × 4 / 4 × (0.80–1.20), drawn (seen ${lo.toFixed(3)}–${hi.toFixed(3)} of the centre)`);
  }
  ok(seededRandom('abc')() === draws('abc')() && seededRandom('room|T3|WC|2')() === draws('room|T3|WC|2')(),
    'the engine\'s seeded draws are the brief\'s FNV-1a + mulberry32');

  // ============================================================================
  // 4. THE ENGINE TAKES IT
  // ============================================================================
  console.log('\n4. The engine plays the stored result');
  {
    const host = newSessionToken();
    const made = await t.createRoom({ hostToken: host, seed: '7', yearCount: 2, startingYear: 2027, eventName: 'Engine', expectedTeams: 2, lines: ['WC'], shocks: [], market: 'high' });
    const a = await t.join({ code: made.code, teamName: 'Cheap', role: 'player' });
    const b = await t.join({ code: made.code, teamName: 'Dear', role: 'player' });
    const r0 = (await t.read({ code: made.code, token: host })).room;
    const g0 = buildTeamGame(r0, ['WC']).gameState;
    const d = decisionsForYear(1, undefined, false);
    d.byLine.WC = { ...d.byLine.WC, newMembers: 0.10, nonRenewal: 0.03 };
    const m = marketLockInputFor(g0, d, 1)!;
    await t.submit({ code: made.code, token: a.teamToken, yearNumber: 1, decisions: decisionsToJson(d), market: m });
    await t.submit({ code: made.code, token: b.teamToken, yearNumber: 1, decisions: decisionsToJson(d), market: { byLine: { WC: { ...m.byLine.WC!, rate: m.byLine.WC!.rate * 1.15 } } } });
    await t.advance({ code: made.code, token: host, expectedYear: 1 });
    let bad = 0;
    for (const tok of [a.teamToken, b.teamToken]) {
      const me = await t.read({ code: made.code, token: tok });
      const r = me.you!.marketByYear!['1'].WC!;
      const after = replayTeamYears(buildTeamGame(me.room, ['WC']).gameState, 2, me.you?.decisionsByYear, marketByYearForEngine(me.you?.marketByYear)).state;
      const want = r.bookAfter * (1 - r.engineNonRenewal);
      if (Math.abs(after.poolState.lines.WC!.bookExposure! - want) > 1e-6 * want) bad++;
    }
    const dear = (await t.read({ code: made.code, token: b.teamToken })).you!.marketByYear!['1'].WC!;
    ok(bad === 0 && dear.outExposure > 0, 'each team\'s game ends year 1 on the book the step gave it, less the engine\'s drop — members moved');
    const plain = replayTeamYears(g0, 2, { '1': decisionsToJson(d) }).produced.map(p => JSON.stringify(p.result));
    const withEmpty = replayTeamYears(g0, 2, { '1': decisionsToJson(d) }, {}).produced.map(p => JSON.stringify(p.result));
    ok(JSON.stringify(plain) === JSON.stringify(withEmpty), 'a game with no market result for the year plays byte-identical to one without the field');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('\nmarket-step-check: FAILED'); process.exit(1); }
  console.log('\nmarket-step-check: PASS — the stored market step is the brief\'s, recomputed independently from the posted rates, and the controls fail.');
}

main().catch(e => { console.error(e); process.exit(1); });
