// ============================================================================
// MARKET COMPETITION: THE MARKET STEP, RECOMPUTED INDEPENDENTLY FROM THE POSTED
// RATES (pr/market-competition; utils/market/marketStep.ts, session/market.ts).
//
//   npx tsx scripts/diagnostics/market-step-check.ts
//
// 1. A REAL ROOM. Seven teams play a localStorage room at each level, four years,
//    with every case the server handles: different rates, appetites, non-renewal
//    and Accept switches; a team that skips a year (counted at its last lock, on
//    its book carried forward); a team unlocked and not re-locked; a team that
//    never locks (left out). What the room STORES is then recomputed here from
//    the stored inputs alone (each team's posted rate, book and decisions, last
//    year's book risk and untaken dropped members) by a SECOND IMPLEMENTATION
//    written in this file from the brief, sharing nothing with marketStep.ts but
//    the parameters. Every field of every team's result must agree (1e-9), and
//    every stored input must be what the team posted (or, stale, its last lock).
// 2. THE RULES, on every stored result: leavers out = good leavers in; nobody
//    beyond its appetite; nobody leaves the cheapest team; good leavers only to
//    a team cheaper by more than 1%; outside supply only at or below the room's
//    average rate; dropped members only to a team that accepts them and never
//    back to their own; willing leavers within the 15% cap; the book after = the
//    book − out + in; untaken dropped = dropped − taken.
// 3. THE SPEC'S NUMBERS: the buckets ÷ 1.02 average 1.00; the full skew's
//    average leaver is 0.90 / 0.80 / 0.70; dropped members average 1.5 − ½ ×
//    the share; the calibrated k; one pair's willing leavers inside k ×
//    (gap − 1%)² × 4 / (N − 1) ± 20%.
// 4. THE ENGINE TAKES IT: a team's game played on its stored result ends the
//    year on the book the step gave it (less the engine's drop), and a game with
//    no market input plays byte-identical to one without the field.
//
// CONTROLS, each of which must fail: a recompute without the fade; with the
// pulls summed instead of averaged; with the team keys left out of the seeds; a
// stored input tampered with; and stored results planted with each rule broken
// (an intake past the appetite, a leaver from the cheapest team, outside supply
// to a dear team, dropped members to a team that declines them, a book that
// does not add up).
// ============================================================================

import {
  MARKET_BOOK_RISK_FADE, MARKET_BUCKET_BASE_MIX, MARKET_BUCKETS_RAW, MARKET_COUNT_SPREAD, MARKET_FULL_SKEW_GAP,
  MARKET_FULL_SKEW_MEAN, MARKET_K, MARKET_LEAVER_CAP, MARKET_MEMBERS_PER_BOOK, MARKET_MIN_GAP, MARKET_OUTSIDE_SUPPLY,
  MARKET_RIVAL_SCALE, NON_RENEWAL_LOSS_RELIEF, type MarketLevel,
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
const droppedMixAt = (share: number) => tilted(thetaFor(1 + NON_RENEWAL_LOSS_RELIEF * (1 - share)));
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

interface LineIn { rate: number; book: number; bookRisk: number; newMembers: number; nonRenewal: number; acceptDropped: boolean }
interface Variant { noFade?: boolean; summedPulls?: boolean; noTeamSeed?: boolean }

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
    const newcomers = Array.from({ length: nNew }, () => ({ e: supply / nNew, risk: RISKS[bucketOf([...MARKET_BUCKET_BASE_MIX], rnd())], to: -1 }))
      .sort((a, b) => a.risk - b.risk);
    for (const j of cheapestFirst) if (rate[j] <= avgRate + 1e-12) for (const m of newcomers) take(j, m);
    for (const m of newcomers) if (m.to >= 0) { outside[m.to] += m.e; outsideRisk[m.to] += m.e * m.risk; }
  }
  const dropped = z(), droppedTaken = z();
  const droppedPool: M[] = [];
  for (let i = 0; i < N; i++) {
    const a1 = Math.max(0, teams[i].x.nonRenewal);
    if (a1 <= 0) continue;
    const e1 = book[i] - out[i] + good[i] + outside[i];
    const r1 = (risk0[i] * book[i] - outRisk[i] + goodRisk[i] + outsideRisk[i]) / e1;
    const n = Math.max(1, Math.round(a1 * MARKET_MEMBERS_PER_BOOK));
    const rnd = draws(`${seed}|drop|${tk(i)}|${line}|${year}`);
    const mix = droppedMixAt(a1);
    for (let q = 0; q < n; q++) droppedPool.push({ from: i, e: a1 * e1 / n, risk: r1 * RISKS[bucketOf(mix, rnd())], to: -1 });
    dropped[i] = a1 * e1;
  }
  droppedPool.sort((a, b) => a.risk - b.risk);
  for (const j of cheapestFirst) if (teams[j].x.acceptDropped) for (const m of droppedPool) if (m.from !== j) take(j, m);
  let untaken = 0;
  for (const m of droppedPool) { if (m.to < 0) untaken += m.e; else { drop[m.to] += m.e; dropRisk[m.to] += m.e * m.risk; droppedTaken[m.from] += m.e; } }
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
    for (const n of names) {
      const x = r(n), book = s.inputs[n].byLine[line]!.book, input = s.inputs[n].byLine[line]!;
      const intake = x.inGood + x.inOutside + x.inDropped;
      if (intake > x.appetite + 1e-6) p.push(`${n} ${line}: took ${intake} past its appetite ${x.appetite}`);
      if (Math.abs(x.appetite - input.newMembers * book) > 1e-6 * Math.max(1, book)) p.push(`${n} ${line}: appetite is not New Members × book`);
      if (rate(n) === cheapest && x.willingShare > 0) p.push(`${n} ${line}: members want to leave the cheapest team`);
      if (x.willingShare > MARKET_LEAVER_CAP + 1e-12) p.push(`${n} ${line}: willing leavers past the cap`);
      if (x.leftShare > x.willingShare + 1e-9) p.push(`${n} ${line}: more left than wanted to`);
      if (x.inGood > 0 && !names.some(m => rate(m) / rate(n) - 1 > MARKET_MIN_GAP && r(m).outExposure > 0)) p.push(`${n} ${line}: good leavers with no team dearer by over 1% losing any`);
      if (x.inOutside > 0 && rate(n) > avg + 1e-12) p.push(`${n} ${line}: outside supply to a team above the average rate`);
      if (x.inDropped > 0 && !input.acceptDropped) p.push(`${n} ${line}: dropped members to a team that declines them`);
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
  // Per team: rate factor, New Members, Non-Renewal, Accept — per line a little different.
  const plan = [
    { name: 'Alder', f: 0.94, nm: 0.10, nr: 0.00, acc: true },
    { name: 'Birch', f: 0.98, nm: 0.06, nr: 0.03, acc: true },
    { name: 'Cedar', f: 1.00, nm: 0.04, nr: 0.05, acc: false },
    { name: 'Dogwood', f: 1.05, nm: 0.02, nr: 0.08, acc: true },   // skips year 3
    { name: 'Elm', f: 1.12, nm: 0.00, nr: 0.10, acc: false },       // unlocked in year 2, not re-locked
    { name: 'Fir', f: 1.00, nm: 0.05, nr: 0.00, acc: true },        // never locks
    // A sixth team in the step, so averaging over N − 1 = 5 rivals × 4 is not the sum (at five it would be).
    { name: 'Gum', f: 0.97, nm: 0.03, nr: 0.02, acc: false },
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
          d.byLine[line] = { ...d.byLine[line], newMembers: Math.max(0, p.nm - 0.01 * j), nonRenewal: p.nr, acceptNonRenewed: p.acc };
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
    let diffs: string[] = [], inputProblems: string[] = [], rules: string[] = [];
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
          if (got.rate !== want.rate || got.newMembers !== want.newMembers || got.nonRenewal !== want.nonRenewal || got.acceptDropped !== want.acceptDropped) {
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
  const tampered: StoredMarketYear = JSON.parse(JSON.stringify(y1));
  tampered.inputs.Elm.byLine.WC!.rate *= 0.9;
  control('a stored rate tampered with no longer reproduces the stored result', differences(y1.result, recomputeYear(M.code, M.seed, tampered, undefined).result).length);

  // ---- controls on the rules ----
  const plant = (f: (s: StoredMarketYear) => void) => { const s: StoredMarketYear = JSON.parse(JSON.stringify(y1)); f(s); return ruleProblems(s).length; };
  control('an intake past the appetite is refused', plant(s => { const x = s.result.Alder.WC! as { inGood: number; appetite: number }; x.inGood = x.appetite * 2; }));
  control('a leaver from the cheapest team is refused', plant(s => { (s.result.Alder.WC as { willingShare: number }).willingShare = 0.02; }));
  control('outside supply to a team above the average rate is refused', plant(s => { (s.result.Elm.WC as { inOutside: number }).inOutside = 1; }));
  control('dropped members to a team that declines them are refused', plant(s => { (s.result.Cedar.WC as { inDropped: number }).inDropped = 0.5; }));
  control('a book that does not add up is refused', plant(s => { (s.result.Birch.GL as { bookAfter: number }).bookAfter *= 1.01; }));

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
  ok(MARKET_K.medium.WC === 6.159 && MARKET_K.medium.GL === 1.364 && MARKET_K.medium.Property === 2.242
    && LINES.every(l => Math.abs(MARKET_K.low[l] - MARKET_K.medium[l] / 2) < 0.001 && Math.abs(MARKET_K.high[l] - MARKET_K.medium[l] * 2) < 0.001),
    'k is the calibrated one: Medium WC 6.159 / GL 1.364 / Property 2.242, Low half, High double');
  ok(MARKET_FULL_SKEW_GAP === 0.10 && MARKET_MIN_GAP === 0.01 && MARKET_LEAVER_CAP === 0.15 && MARKET_COUNT_SPREAD === 0.20
    && MARKET_RIVAL_SCALE === 4 && MARKET_OUTSIDE_SUPPLY === 0.02 && MARKET_BOOK_RISK_FADE === 0.50,
    'full skew at 10%, no pull below 1%, the 15% cap, ±20%, × 4 over the rivals, 2% outside supply, 50% fade');
  {
    // One dear team, four rivals at one rate: four pulls of k(g − 1%)², averaged over the 4 rivals × 4, ± 20%.
    const gap = 0.06, ks = MARKET_K.medium.WC * (gap - 0.01) ** 2 * 4 / 4 * 4;
    let inBand = 0, n = 0, lo = Infinity, hi = 0;
    for (let s = 0; s < 200; s++) {
      const teams = [0, 1, 2, 3, 4].map(i => ({ key: `T${i + 1}`, x: { rate: i === 0 ? 1 + gap : 1, book: 100, bookRisk: 1, newMembers: 0.1, nonRenewal: 0, acceptDropped: false } }));
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
