// ============================================================================
// LARGE CLAIMS BY FREQUENCY (wip/large-claims-frequency) — THE GATE.
//
//   npx tsx scripts/diagnostics/large-claim-frequency-check.ts
//
// THE BRIEF, WRITTEN OUT HERE (not read from pricingParameters):
//   - Each played year (year >= 1), each line draws AT MOST ONE large claim:
//     Low with 7.5%, Mid 5.25%, High 2.25% a year (15% in all) — u < .075 Low,
//     u < .1275 Mid, u < .15 High, none otherwise.
//   - Its size uniform across the line's range for that level ($M):
//         WC        Low 1-3   Mid 3-6    High 6-40
//         GL        Low 1-3   Mid 3-7    High 7-40
//         Property  Low 2-5   Mid 5-12   High 12-40
//     x the year's growth factor: (1 + trend)^(y - 1) x the book's quoted
//     exposure / year 1's, trend WC 4%, GL 8%, Property 5%.
//   - Two uniforms (level, then size) on the GAME's seed, stream
//     `large_claim_<line>`, so every world shares the claim. In every game,
//     shocks on or off (LARGE_CLAIMS_EVERY_GAME); never in the shock-free pricing shadow; no load —
//     large claims stay out of the rate entirely.
//   - Catalogue events keep their A and R but set no T claim.
//   - Expected shock large losses = Σ over levels of freq x the range's
//     midpoint x (1 + trend)^(y - 1).
//
//   1. THE DRAW, DIRECT: 20,000 game seeds x 10 years x 3 lines through
//      largeClaimArrivals — at most one per line-year; each level's frequency
//      within 4 SE of the brief's; sizes inside the level's range and uniform
//      there (mean within 4 SE of the midpoint); on 2,000 seeds the draw is
//      re-derived EXACTLY from the stream and the thresholds written out; none
//      before year 1 or in a shock-free instance; a world's instance (its own
//      seed, the game's as marketSeed) draws the game's claims.
//   2. EVENTS BRING NO T: 2,000 instances with Earthquake, Nuclear Verdict,
//      Pandemic, Winterstorm, Wildfire and Social Inflation scheduled — every
//      T-bearing event — resolveShockYear's arrivals are only LARGE_CLAIM_ID
//      firings, exactly largeClaimArrivals' draw, while the events are in force;
//      with largeClaims=false (shocks off) none at all.
//   3. IN A PLAYED SOLO GAME (LCF21, 5 years, a hundred worlds, a cover bought
//      on each line, 5% new members a year so the book grows): each world's large claims are the table draw x the
//      year's growth factor, the same in every world, each recovered exactly
//      min(max(x − att, 0), limit); no other shock claim exists. A hosted game
//      with no schedule (shocks off) draws exactly its seed's claims too, and
//      they stay out of its rate (restated below).
//   4. OUT OF THE RATE, ON THE REAL GAME PATH (playWorldsYear / settle, with
//      the shadow): the same solo game at default decisions played twice, as
//      built and with LARGE_CLAIM_FREQUENCY zeroed at runtime (same schedule,
//      so the only difference is the large claims): a large claim arrived in
//      the as-built run, and every year's struck rate (finalRatePer100,
//      purePremiumPer100, newPurePremiumPer100) is identical, every line.
//   5. EXPECTED LOSSES: expectedLossBreakdown's shockLarge is the brief's
//      Σ p x mid x trend, years 1-15; 0 before year 1; the same with shocks off.
//   6. THE POOL ROW: the year's one "Large claim" pool record names every line
//      a large claim landed on (mergeShockRecords unions linesAffected); there
//      must be a year with two.
//
// RESTATED FOR LARGE_CLAIMS_EVERY_GAME: large claims are now drawn in every
// game, shocks on or off ("shocks off" now means only that no catalogue event
// fires). So:
//   3. the hosted game with no schedule (gameShocksOn false, asserted) no
//      longer draws none: it draws EXACTLY its seed's largeClaimArrivals x the
//      year's growth factor, alike in every world, with no other shock claim
//      and no record but "Large claim" ones; and its rate stays out of it — the
//      same hosted game with LARGE_CLAIM_FREQUENCY zeroed strikes the same rate
//      every line-year (the shadow now starts in shocks-off games too). New
//      controls: LARGE_CLAIMS_EVERY_GAME.enabled = false at runtime (the game
//      replayed, drawing none) must fail 3; the hosted game's claims dropped
//      (the retired rule) must fail 3; the shadow bypassed in the hosted runs
//      (SHOCK_FREE_PRICING off) must fail 3.
//   5. shockLarge with shocks off is no longer 0: it equals the shocks-on value
//      (the brief's). New control: LARGE_CLAIMS_EVERY_GAME.enabled = false at
//      runtime must fail 5.
// Section 2's "none with shocks off" is unchanged: there resolveShockYear is
// called with largeClaims=false explicitly (the caller says).
//
// RESTATED FOR EVENTS_KEEPING_LARGE_CLAIMS: Nuclear Verdict is the one
// catalogue event that keeps its own large claim — when it fires, GL gets ONE
// claim at its map level (High, $7-40M, written out), sized $7M + u x $33M on
// the firing's own GL draw (u = draws.GL.t) x the year's growth factor,
// carrying the firing (event '#7', not 'T'), ON TOP of the frequency draw.
//   2. the arrivals are now exactly the frequency draw PLUS one GL High claim
//      per NV onset, of that size; no other event brings one. With
//      largeClaims=false (the frequency draw off) NV's claim alone remains.
//   3. in LCF21 (NV fires in year 2) GL carries NV's claim beside its large
//      claims, the same in every world, sized as above x the growth factor;
//      the recovery is the layer on every one of them. No other shock claim.
//   5. shocks on, GL's shockLarge adds p(NV) x $23.5M x 1.08^(y - 1) (p(NV) =
//      the R model's 2.5% x SHOCK_CATALOGUE_SCALE); shocks off it is the brief.
// New controls: EVENTS_KEEPING_LARGE_CLAIMS emptied at runtime (2, 3 replayed,
// 5) and Pandemic added to it (2, 5) must each fail.
//
// ⚠ EACH SECTION HAS CONTROLS that break the thing it guards at runtime,
// require the section to FAIL, and restore it.
// ============================================================================

import {
  EVENTS_KEEPING_LARGE_CLAIMS, LARGE_CLAIM_FREQUENCY, LARGE_CLAIMS_BY_FREQUENCY, LARGE_CLAIMS_EVERY_GAME, SHOCK_CATALOGUE_SCALE, SHOCK_FREE_PRICING,
} from '../../src/data/pricingParameters';
import { LARGE_CLAIM_ID, firingsStartingIn, gameShocksOn, largeClaimArrivals, resolveShockYear } from '../../src/utils/shockLosses';
import { expectedLossBreakdown } from '../../src/utils/shockExpectation';
import { deriveSubRng } from '../../src/utils/random';
import { openSoloInstance } from '../../src/utils/soloGame';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { seedFromInstanceId } from '../../src/seedHash';
import { exposureFactor } from '../../src/data/exposureTrend';
import type { ScheduledShock } from '../../src/types/shocks';
import type { CoverageLine, DecisionSet, GameInstance, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const M = 1e6;
const failures: string[] = [];
const check = (problems: string[], label: string, detail = '') => {
  if (problems.length) failures.push(label);
  console.log(`  ${problems.length ? 'FAIL' : 'OK  '}  ${label}${detail ? `  — ${detail}` : ''}`);
  for (const p of problems.slice(0, 5)) console.log(`          ${p}`);
};
/** The control: break, run the section, restore; it must fail. */
const control = (label: string, breakIt: () => () => void, section: () => string[]) => {
  const restore = breakIt();
  let problems: string[];
  try { problems = section(); } finally { restore(); }
  check(problems.length > 0 ? [] : ['the section passed with the thing it guards broken'], `  control: ${label}`,
    `${problems.length} problem(s) when broken`);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ---- THE BRIEF ------------------------------------------------------------------
type Lv = 'Low' | 'Mid' | 'High';
const LEVELS: Lv[] = ['Low', 'Mid', 'High'];
const BRIEF_FREQ: Record<Lv, number> = { Low: 0.075, Mid: 0.0525, High: 0.0225 };
const BRIEF_RANGE: Record<CoverageLine, Record<Lv, [number, number]>> = {
  WC: { Low: [1 * M, 3 * M], Mid: [3 * M, 6 * M], High: [6 * M, 40 * M] },
  GL: { Low: [1 * M, 3 * M], Mid: [3 * M, 7 * M], High: [7 * M, 40 * M] },
  Property: { Low: [2 * M, 5 * M], Mid: [5 * M, 12 * M], High: [12 * M, 40 * M] },
};
const BRIEF_TREND: Record<CoverageLine, number> = { WC: 0.04, GL: 0.08, Property: 0.05 };
/** The level for a uniform u, by the brief's thresholds (.075, .1275, .15). */
function briefLevel(u: number): Lv | null {
  let edge = 0;
  for (const lv of LEVELS) { edge += BRIEF_FREQ[lv]; if (u < edge) return lv; }
  return null;
}
const bare = (seed: number, extra: Partial<GameInstance> = {}) => ({ seed, ...extra }) as GameInstance;
// NUCLEAR VERDICT'S OWN CLAIM (EVENTS_KEEPING_LARGE_CLAIMS), written out: GL,
// High, $7-40M on the firing's GL draw; at the R model's 2.5% x the scale.
const NV_NAME = 'Nuclear Verdict', NV_RANGE: [number, number] = [7 * M, 40 * M];
/** NV's GL claims (unscaled) starting in year y: one per onset, $7M + u x $33M. */
const nvClaims = (inst: GameInstance, y: number): number[] => firingsStartingIn(inst, 'host', y)
  .filter(f => f.event.name === NV_NAME).map(f => NV_RANGE[0] + f.draws.GL.t * (NV_RANGE[1] - NV_RANGE[0]));
const kept = EVENTS_KEEPING_LARGE_CLAIMS as string[];
const withKept = (list: string[]) => { const was = [...kept]; kept.splice(0, kept.length, ...list); return () => { kept.splice(0, kept.length, ...was); }; };

// ---- 1. THE DRAW, DIRECT -----------------------------------------------------------
const SEEDS = 20_000, DRAW_YEARS = 10, EXACT_SEEDS = 2_000;
let lastCounts: Record<string, number> = {};
function sectionDraw(): string[] {
  const out: string[] = [];
  const n = SEEDS * DRAW_YEARS;
  const count: Record<string, number> = {}, uSum: Record<string, number> = {};
  let multiple = 0, outside = 0, inexact = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const inst = bare(s);
    for (let y = 1; y <= DRAW_YEARS; y++) {
      const arr = largeClaimArrivals(inst, y);
      for (const l of LINES) {
        const mine = arr.filter(a => a.line === l);
        if (mine.length > 1) multiple++;
        for (const a of mine) {
          const k = `${l}/${a.level}`;
          const [lo, hi] = BRIEF_RANGE[l][a.level];
          if (a.size < lo || a.size > hi) { outside++; if (outside <= 3) out.push(`${k}: size ${a.size} outside [${lo}, ${hi}]`); }
          count[k] = (count[k] ?? 0) + 1;
          uSum[k] = (uSum[k] ?? 0) + (a.size - lo) / (hi - lo);
        }
        if (s <= EXACT_SEEDS) {
          // The rule, re-derived: two uniforms on the game seed's stream, level then size.
          const rng = deriveSubRng(s, y, `large_claim_${l}`);
          const u = rng.next(), v = rng.next();
          const lv = briefLevel(u);
          const want = lv ? `${lv}:${BRIEF_RANGE[l][lv][0] + v * (BRIEF_RANGE[l][lv][1] - BRIEF_RANGE[l][lv][0])}` : '';
          const got = mine.map(a => `${a.level}:${a.size}`).join(',');
          const ok = lv ? mine.length === 1 && mine[0].level === lv && near(mine[0].size, BRIEF_RANGE[l][lv][0] + v * (BRIEF_RANGE[l][lv][1] - BRIEF_RANGE[l][lv][0]), 1e-12) : mine.length === 0;
          if (!ok) { inexact++; if (inexact <= 3) out.push(`seed ${s} year ${y} ${l}: drew ${got || 'none'}, the rule ${want || 'none'}`); }
        }
      }
      if (arr.some(a => a.firing.event.id !== LARGE_CLAIM_ID)) out.push(`seed ${s} year ${y}: an arrival not marked LARGE_CLAIM_ID`);
    }
  }
  lastCounts = count;
  if (multiple) out.push(`${multiple} line-years with more than one large claim`);
  if (inexact > 3) out.push(`${inexact} line-years off the written-out rule`);
  for (const l of LINES) for (const lv of LEVELS) {
    const k = `${l}/${lv}`, c = count[k] ?? 0, p = BRIEF_FREQ[lv];
    const se = Math.sqrt(p * (1 - p) / n);
    if (Math.abs(c / n - p) > 4 * se) out.push(`${k}: frequency ${(c / n * 100).toFixed(3)}%, the brief's ${(p * 100).toFixed(2)}% (4 SE ${(4 * se * 100).toFixed(3)}%)`);
    const mean = c ? uSum[k] / c : NaN, seU = Math.sqrt(1 / 12 / c);
    if (!(Math.abs(mean - 0.5) <= 4 * seU)) out.push(`${k}: mean position in the range ${mean.toFixed(4)}, uniform 0.5 (4 SE ${(4 * seU).toFixed(4)})`);
  }
  // None before year 1, none in the shadow; a world's instance draws the game's.
  for (let s = 1; s <= 500; s++) {
    for (const y of [0, -1, -5]) if (largeClaimArrivals(bare(s), y).length) out.push(`seed ${s} year ${y}: a large claim before year 1`);
    for (let y = 1; y <= 4; y++) {
      if (largeClaimArrivals(bare(s, { shockFree: true } as Partial<GameInstance>), y).length) out.push(`seed ${s} year ${y}: a large claim in the shock-free shadow`);
      const w = JSON.stringify(largeClaimArrivals(bare(s * 7919 + 1, { marketSeed: s }), y).map(a => [a.line, a.level, a.size]));
      if (w !== JSON.stringify(largeClaimArrivals(bare(s), y).map(a => [a.line, a.level, a.size]))) out.push(`seed ${s} year ${y}: a world's instance draws other large claims than the game's`);
    }
  }
  return out;
}
function drawSummary(): string {
  const n = SEEDS * DRAW_YEARS * LINES.length;
  const c = Object.fromEntries(LEVELS.map(lv => [lv, LINES.reduce((s, l) => s + (lastCounts[`${l}/${lv}`] ?? 0), 0)])) as Record<Lv, number>;
  return `${n.toLocaleString('en-US')} line-years: ${LEVELS.map(lv => `${lv} ${(c[lv] / n * 100).toFixed(3)}%`).join(', ')}`;
}

// ---- 2. EVENTS BRING NO T ------------------------------------------------------------
// Every event with a T level on the shock map, scheduled.
const T_EVENTS: ScheduledShock[] = [
  { shockId: '#1', yearNumber: 2 }, { shockId: '#7', yearNumber: 2 }, { shockId: '#9', yearNumber: 3 },
  { shockId: '#2', yearNumber: 3 }, { shockId: '#3', yearNumber: 4 }, { shockId: '#8', yearNumber: 4 },
];
function sectionEvents(): string[] {
  const out: string[] = [];
  let inForce = 0, large = 0, nvSeen = 0;
  for (let s = 1; s <= 2_000; s++) {
    const inst = bare(s, { scheduledShocks: T_EVENTS });
    for (let y = 1; y <= 5; y++) {
      const sy = resolveShockYear(inst, 'host', y);
      inForce += sy.inForce.filter(f => f.age === 0).length;
      const all = LINES.flatMap(l => sy.byLine[l].arrivals);
      // EVENTS_KEEPING_LARGE_CLAIMS: Nuclear Verdict's own GL High claim, and no other event's.
      const ev = all.find(a => a.firing.event.id !== LARGE_CLAIM_ID && a.firing.event.name !== NV_NAME);
      if (ev) { out.push(`seed ${s} year ${y}: ${ev.firing.event.name} brought a T claim on ${ev.line} (${ev.level})`); continue; }
      const nvWant = JSON.stringify(nvClaims(inst, y).map(x => ['GL', 'High', '#7', x]).sort());
      const nvGot = (arr: typeof all) => JSON.stringify(arr.filter(a => a.firing.event.id !== LARGE_CLAIM_ID).map(a => [a.line, a.level, a.firing.event.id, a.size]).sort());
      if (nvGot(all) !== nvWant) out.push(`seed ${s} year ${y}: NV's arrivals ${nvGot(all)}, its onsets want ${nvWant}`);
      nvSeen += nvClaims(inst, y).length;
      const arr = all.filter(a => a.firing.event.id === LARGE_CLAIM_ID);
      const want = JSON.stringify(largeClaimArrivals(inst, y).map(a => [a.line, a.level, a.size]).sort());
      if (JSON.stringify(arr.map(a => [a.line, a.level, a.size]).sort()) !== want) out.push(`seed ${s} year ${y}: arrivals are not the large-claim draw`);
      large += arr.length;
      // largeClaims=false (the frequency draw off): NV's own claim alone.
      const off = resolveShockYear(inst, 'host', y, false);
      const offAll = LINES.flatMap(l => off.byLine[l].arrivals);
      if (offAll.some(a => a.firing.event.id === LARGE_CLAIM_ID) || nvGot(offAll) !== nvWant) out.push(`seed ${s} year ${y}: with large claims off, arrivals other than NV's own`);
    }
  }
  if (inForce !== 2_000 * T_EVENTS.length) out.push(`${inForce} event onsets, ${2_000 * T_EVENTS.length} scheduled — the events did not fire`);
  if (large === 0) out.push('no large claim drawn — nothing measured');
  if (nvSeen === 0) out.push('no Nuclear Verdict onset — its claim not measured');
  return out;
}

// ---- games ---------------------------------------------------------------------------
const GAME_ID = 'LCF21', GAME_YEARS = 5;
const COVERS: Record<CoverageLine, [string, number, number]> = {
  WC: ['$9M xs $1M', 1, 9], GL: ['$18M xs $2M', 2, 18], Property: ['$38M xs $2M', 2, 38],
};
interface Run { began: GameState[]; end: GameState; perWorld: LineResultSet[][][] }
function playSolo(years: number, edit: (d: DecisionSet) => void = () => {}): Run {
  const { setup, instance } = openSoloInstance({ poolName: 'F', gameLength: years, startingYear: 2026, instanceId: GAME_ID, activeLines: LINES } as GameSetupSettings);
  return playFrom(setup, instance, years, edit);
}
function playFrom(setup: GameSetupSettings, instance: GameInstance, years: number, edit: (d: DecisionSet) => void): Run {
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory });
  const began: GameState[] = [], perWorld: LineResultSet[][][] = [];
  for (let y = 1; y <= years; y++) {
    began.push(gs);
    const d = defaultDecisionSet(y); edit(d);
    const played = playWorldsYear(gs, d);
    perWorld.push(played.perWorld.map(p => p.lineResults.map(r => r.result)));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
  }
  return { began, end: gs, perWorld };
}
/** The brief's growth: (1 + trend)^(y - 1) x (this year's quoted book / year 1's). */
type Factor = (gs: GameState, l: CoverageLine, y: number) => number;
const briefFactor: Factor = (gs, l, y) => {
  const ls = gs.poolState.lines[l];
  return Math.pow(1 + BRIEF_TREND[l], y - 1) * ((ls.bookExposure ?? 0) * exposureFactor(l, y)) / (ls.shockCostBaseExposure ?? NaN);
};

// ---- 3. IN A PLAYED GAME ---------------------------------------------------------------
type Cell = { sizes: number[]; nv: number[]; other: number; recovery: number };
/** Per year, per world, per line: the large claims' sizes, any other shock claim, the recovery. */
function cellsOf(run: Run): Cell[][][] {
  return run.perWorld.map((worlds, yi) => worlds.map(rows => LINES.map(l => {
    const r = rows.find(x => x.line === l)!;
    const shock = (r.claims ?? []).filter(c => c.tier === 'shock' && c.accidentYear === yi + 1);
    return {
      sizes: shock.filter(c => c.shockId === LARGE_CLAIM_ID).map(c => c.grossUltimate).sort((a, b) => a - b),
      // Nuclear Verdict's own claim (EVENTS_KEEPING_LARGE_CLAIMS), event '#7'.
      nv: shock.filter(c => c.shockId === '#7').map(c => c.grossUltimate).sort((a, b) => a - b),
      other: shock.filter(c => c.shockId !== LARGE_CLAIM_ID && c.shockId !== '#7').length + (r.claims ?? []).filter(c => c.shockId === LARGE_CLAIM_ID && c.tier !== 'shock').length,
      recovery: r.reinsuranceRecovery,
    };
  })));
}
let covered: { run: Run; cells: Cell[][][] } | null = null;
let hostedOff: { run: Run; cells: Cell[][][]; wouldDraw: number; none: Run } | null = null;
// A hosted game with no schedule: its shocks are off (no catalogue event).
const HOSTED_YEARS = 3;
const hostedOffGame = () => ({
  setup: { poolName: 'F', gameLength: HOSTED_YEARS, startingYear: 2026, instanceId: GAME_ID, activeLines: LINES, shockTiming: 'host' } as GameSetupSettings,
  instance: generateGameInstance(GAME_ID, seedFromInstanceId(GAME_ID), []),
});
function playHostedOff(): NonNullable<typeof hostedOff> {
  const { setup, instance } = hostedOffGame();
  const run = playFrom(setup, instance, HOSTED_YEARS, () => {});
  const none = zeroed(() => { const g = hostedOffGame(); return playFrom(g.setup, g.instance, HOSTED_YEARS, () => {}); });
  let wouldDraw = 0;
  for (let y = 1; y <= HOSTED_YEARS; y++) wouldDraw += largeClaimArrivals(instance, y).length;
  return { run, cells: cellsOf(run), wouldDraw, none };
}
function sectionGame(factor: Factor = briefFactor, covers = COVERS, cellsIn?: Cell[][][], offIn?: Cell[][][], hostedOffIn?: NonNullable<typeof hostedOff>): string[] {
  const out: string[] = [];
  // A cover on each line, and 5% new members a year so the book grows (the
  // defaults add none) and the growth factor's book term is exercised.
  if (!covered) {
    const run = playSolo(GAME_YEARS, d => { for (const l of LINES) { d.byLine[l].reinsuranceOption = COVERS[l][0]; d.byLine[l].newMembers = 0.05; } });
    covered = { run, cells: cellsOf(run) };
  }
  const cells = cellsIn ?? covered.cells;
  let seen = 0, grown = 0, nvSeen = 0;
  const seenLines = new Set<CoverageLine>();
  for (let y = 1; y <= GAME_YEARS; y++) {
    const drawn = largeClaimArrivals(covered.run.began[y - 1].instance, y);
    const nvDrawn = nvClaims(covered.run.began[y - 1].instance, y);
    LINES.forEach((l, li) => {
      const g = factor(covered!.run.began[y - 1], l, y);
      if (Math.abs(g - Math.pow(1 + BRIEF_TREND[l], y - 1)) > 1e-6) grown++;
      const want = drawn.filter(a => a.line === l).map(a => a.size * g).sort((a, b) => a - b);
      const [, att, lim] = covers[l];
      // NV's own claim on GL, x the same growth factor (EVENTS_KEEPING_LARGE_CLAIMS).
      const nvWant = l === 'GL' ? nvDrawn.map(x => x * g).sort((a, b) => a - b) : [];
      nvSeen += nvWant.length;
      const forms = new Set<string>();
      cells[y - 1].forEach((row, w) => {
        const c = row[li];
        forms.add(JSON.stringify([c.sizes, c.nv]));
        if (c.nv.length !== nvWant.length || c.nv.some((x, i) => !near(x, nvWant[i]))) {
          out.push(`year ${y} ${l} world ${w + 1}: NV claims ${c.nv.map(x => (x / M).toFixed(4))}, its onsets x growth ${nvWant.map(x => (x / M).toFixed(4))}`);
        }
        if (c.other) out.push(`year ${y} ${l} world ${w + 1}: ${c.other} shock claim(s) that are not large claims`);
        if (c.sizes.length !== want.length || c.sizes.some((x, i) => !near(x, want[i]))) {
          out.push(`year ${y} ${l} world ${w + 1}: large claims ${c.sizes.map(x => (x / M).toFixed(4))}, the table x growth ${g.toFixed(4)} ${want.map(x => (x / M).toFixed(4))}`);
        }
        const ceded = [...c.sizes, ...c.nv].reduce((s, x) => s + Math.min(Math.max(x - att * M, 0), lim * M), 0);
        if (!near(c.recovery, ceded)) out.push(`year ${y} ${l} world ${w + 1}: recovered ${c.recovery.toFixed(0)}, the layer on its large claims ${ceded.toFixed(0)}`);
      });
      if (forms.size !== 1) out.push(`year ${y} ${l}: large claims in ${forms.size} forms over the worlds`);
      if (want.length) { seen += want.length; seenLines.add(l); }
    });
  }
  if (!cellsIn && nvSeen === 0) out.push('Nuclear Verdict did not fire in the game — its claim not measured');
  if (seenLines.size !== LINES.length) out.push(`large claims on ${[...seenLines].join(', ') || 'no line'} only — not every line measured`);
  if (grown === 0) out.push('no line-year grew off the trend alone — the book growth is not tested');
  // ⚠ RESTATED FOR LARGE_CLAIMS_EVERY_GAME: a hosted game with no schedule
  // (shocks off) DRAWS its seed's large claims — exactly the draw x the growth
  // factor, alike in every world, nothing else — and they stay out of its rate.
  hostedOff ??= playHostedOff();
  const ho = hostedOffIn ?? hostedOff;
  const off = offIn ?? ho.cells;
  const hg = hostedOffGame();
  if (gameShocksOn(hg.setup, hg.instance)) out.push('the hosted game with no schedule has its shocks on — not a shocks-off game');
  let offSeen = 0;
  for (let y = 1; y <= HOSTED_YEARS; y++) {
    const drawn = largeClaimArrivals(ho.run.began[y - 1].instance, y);
    LINES.forEach((l, li) => {
      const g = factor(ho.run.began[y - 1], l, y);
      const want = drawn.filter(a => a.line === l).map(a => a.size * g).sort((a, b) => a - b);
      offSeen += want.length;
      const forms = new Set<string>();
      off[y - 1].forEach((row, w) => {
        const c = row[li];
        forms.add(JSON.stringify(c.sizes));
        if (c.other || c.nv.length) out.push(`shocks off year ${y} ${l} world ${w + 1}: ${c.other + c.nv.length} shock claim(s) that are not large claims`);
        if (c.sizes.length !== want.length || c.sizes.some((x, i) => !near(x, want[i]))) {
          out.push(`shocks off year ${y} ${l} world ${w + 1}: large claims ${c.sizes.map(x => (x / M).toFixed(4))}, the table x growth ${g.toFixed(4)} ${want.map(x => (x / M).toFixed(4))}`);
        }
        // At the defaults (None) nothing is recovered.
        if (c.recovery !== 0) out.push(`shocks off year ${y} ${l} world ${w + 1}: recovered ${c.recovery.toFixed(0)} under None`);
      });
      if (forms.size !== 1) out.push(`shocks off year ${y} ${l}: large claims in ${forms.size} forms over the worlds`);
    });
  }
  const offOther = ho.run.perWorld.flat(2).flatMap(r => (r.shockEvents ?? []).filter(e => e.shockId !== LARGE_CLAIM_ID));
  if (offOther.length) out.push(`the hosted game with no schedule recorded ${offOther.length} catalogue shock record(s) (${offOther[0].shockId})`);
  if (ho.wouldDraw === 0 || offSeen === 0) out.push('the shocks-off game\'s seed draws no large claim — the shocks-off test is vacuous');
  // Out of the rate: the same hosted game with LARGE_CLAIM_FREQUENCY zeroed strikes the same rate.
  const a = ratesOf(ho.run), b = ratesOf(ho.none);
  let moved = 0;
  a.forEach((x, i) => { if (x !== b[i]) { moved++; if (moved <= 2) out.push(`shocks off: as built ${x}; zeroed ${b[i]}`); } });
  if (moved) out.push(`shocks off: ${moved} of ${a.length} line-years struck a different rate with the large claims zeroed`);
  if (seen === 0) out.push('no large claim in the game — nothing measured');
  return out;
}

// ---- 4. OUT OF THE RATE, ON THE REAL GAME PATH -----------------------------------------
const RATE_FIELDS = ['finalRatePer100', 'purePremiumPer100', 'newPurePremiumPer100'] as const;
function ratesOf(run: Run): string[] {
  // Every year's struck rate on every line, on the averaged row and world 1's.
  return run.end.lockedResults.flatMap((r, yi) => LINES.map(l =>
    `${yi + 1}|${l}|${RATE_FIELDS.map(f => r.byLine[l][f as never]).join('|')}|${RATE_FIELDS.map(f => run.perWorld[yi][0].find(x => x.line === l)![f as never]).join('|')}`));
}
function zeroed<T>(f: () => T): T {
  const fr = LARGE_CLAIM_FREQUENCY as Record<Lv, number>; const o = { ...fr };
  for (const lv of LEVELS) fr[lv] = 0;
  try { return f(); } finally { Object.assign(fr, o); }
}
let rateRuns: { built: Run; none: Run } | null = null;
function sectionRate(runs?: { built: Run; none: Run }): string[] {
  const out: string[] = [];
  rateRuns ??= { built: playSolo(GAME_YEARS), none: zeroed(() => playSolo(GAME_YEARS)) };
  const { built, none } = runs ?? rateRuns;
  const arrived = built.perWorld.flat(2).filter(r => (r.claims ?? []).some(c => c.shockId === LARGE_CLAIM_ID)).length;
  const zeroArrived = none.perWorld.flat(2).filter(r => (r.claims ?? []).some(c => c.shockId === LARGE_CLAIM_ID)).length;
  if (arrived === 0) out.push('no large claim arrived in the as-built run — nothing measured');
  if (zeroArrived > 0) out.push(`${zeroArrived} line-world-years with a large claim in the zeroed run`);
  const sched = (r: Run) => JSON.stringify(r.end.instance.scheduledShocks ?? []);
  if (sched(built) !== sched(none)) out.push('the two runs carry different schedules');
  const a = ratesOf(built), b = ratesOf(none);
  let moved = 0;
  a.forEach((x, i) => { if (x !== b[i]) { moved++; if (moved <= 4) out.push(`as built ${x}; zeroed ${b[i]}`); } });
  if (moved) out.push(`${moved} of ${a.length} line-years struck a different rate`);
  if (!a.every(x => x.split('|').slice(2).every(v => Number.isFinite(Number(v))))) out.push('a rate field missing on a row');
  return out;
}

// ---- 5. EXPECTED LOSSES ----------------------------------------------------------------
const briefExpected = (l: CoverageLine, y: number) => Math.pow(1 + BRIEF_TREND[l], y - 1)
  * LEVELS.reduce((s, lv) => s + BRIEF_FREQ[lv] * (BRIEF_RANGE[l][lv][0] + BRIEF_RANGE[l][lv][1]) / 2, 0);
function sectionExpected(): string[] {
  const out: string[] = [];
  for (const l of LINES) {
    for (let y = 1; y <= 15; y++) {
      // Shocks on: the brief plus, on GL, NV's own claim (EVENTS_KEEPING_LARGE_CLAIMS).
      const nv = l === 'GL' ? 0.025 * SHOCK_CATALOGUE_SCALE * (NV_RANGE[0] + NV_RANGE[1]) / 2 * Math.pow(1 + BRIEF_TREND.GL, y - 1) : 0;
      const got = expectedLossBreakdown(l, 1000, y).shockLarge;
      if (!near(got, briefExpected(l, y) + nv, 1e-12)) out.push(`${l} year ${y}: shockLarge $${(got / M).toFixed(6)}M, the brief's $${(briefExpected(l, y) / M).toFixed(6)}M + NV $${(nv / M).toFixed(6)}M`);
      // LARGE_CLAIMS_EVERY_GAME: with shocks off, the brief (no NV: no catalogue event fires).
      const off = expectedLossBreakdown(l, 1000, y, undefined, 1, false).shockLarge;
      if (!near(off, briefExpected(l, y), 1e-12) || !(off > 0)) out.push(`${l} year ${y}: shockLarge ${off} with shocks off, the brief's ${briefExpected(l, y)}`);
    }
    for (const y of [0, -3]) if (expectedLossBreakdown(l, 1000, y).shockLarge !== 0) out.push(`${l} year ${y}: shockLarge before year 1`);
  }
  return out;
}

// ---- run -------------------------------------------------------------------------------
console.log('large-claim-frequency-check\n');
// ---- 6. THE POOL ROW NAMES EVERY LINE A LARGE CLAIM LANDED ON -------------------------
// mergeShockRecords folds the lines' "Large claim" records into one pool record
// per year; a large claim's line record names its own line alone, so the pool's
// linesAffected must be the union — every line in its byLine.
type PoolRec = { y: number; lines: CoverageLine[]; byLine: CoverageLine[] };
function poolRecs(run: Run): PoolRec[] {
  return run.end.lockedResults.flatMap(r => (r.shockEvents ?? []).filter(e => e.shockId === LARGE_CLAIM_ID)
    .map(e => ({ y: r.yearNumber, lines: [...e.linesAffected].sort(), byLine: (Object.keys(e.byLine ?? {}) as CoverageLine[]).sort() })));
}
function sectionPoolLines(recs?: PoolRec[]): string[] {
  recs ??= poolRecs(rateRuns!.built);
  const out = recs.filter(r => r.lines.join() !== r.byLine.join())
    .map(r => `year ${r.y}: linesAffected ${r.lines.join('+')} but byLine ${r.byLine.join('+')}`);
  if (!recs.some(r => r.byLine.length > 1)) out.push('no year with large claims on two lines — the check is vacuous');
  return out;
}

check(sectionDraw(), '1. the draw: at most one a line-year, the brief\'s frequencies within 4 SE, sizes uniform in range, the rule re-derived exactly; none before year 1 or in the shadow; worlds share it', drawSummary());
control('Mid\'s frequency moved to 6%', () => {
  const f = LARGE_CLAIM_FREQUENCY as Record<Lv, number>; const o = f.Mid; f.Mid = 0.06; return () => { f.Mid = o; };
}, sectionDraw);
control('a written-out range moved (GL Mid from $3-7M to $3-8M)', () => {
  const r = BRIEF_RANGE.GL.Mid; const o = r[1]; r[1] = 8 * M; return () => { r[1] = o; };
}, sectionDraw);
check(sectionEvents(), '2. events bring no T but NV: with every T-bearing event scheduled, the arrivals are the large-claim draw plus one GL High claim per Nuclear Verdict onset; with the draw off, NV\'s alone');
control('EVENTS_KEEPING_LARGE_CLAIMS emptied (NV\'s claim dropped)', () => withKept([]), sectionEvents);
control('Pandemic added to EVENTS_KEEPING_LARGE_CLAIMS', () => withKept([NV_NAME, 'Pandemic']), sectionEvents);
control('an event\'s T switched back on (LARGE_CLAIMS_BY_FREQUENCY off)', () => {
  LARGE_CLAIMS_BY_FREQUENCY.enabled = false; return () => { LARGE_CLAIMS_BY_FREQUENCY.enabled = true; };
}, sectionEvents);
check(sectionGame(), `3. in a played solo game (${GAME_ID}, ${GAME_YEARS} years, every world): large claims = the table draw x the growth factor, alike in every world, plus NV's own GL claim where it fired, recovered min(max(x − att, 0), limit); with shocks off (hosted, no schedule) exactly the draw too, alike in every world, out of the rate`);
control('the claims expected at the trend alone (no book growth)', () => () => {},
  () => sectionGame((_gs, l, y) => Math.pow(1 + BRIEF_TREND[l], y - 1)));
control('the claims expected a year late in the growth', () => () => {},
  () => sectionGame((gs, l, y) => briefFactor(gs, l, Math.max(1, y - 1))));
control('one world\'s large claim differs', () => () => {}, () => {
  const c = covered!.cells.map(ws => ws.map(row => row.map(x => ({ ...x, sizes: [...x.sizes] }))));
  const at = c.findIndex(ws => ws[0].some(x => x.sizes.length > 0));
  const li = c[at][0].findIndex(x => x.sizes.length > 0);
  c[at][c[at].length - 1][li].sizes[0] *= 1.001;
  return sectionGame(briefFactor, COVERS, c);
});
control('GL\'s recovery expected at $1M rather than $2M', () => () => {},
  () => sectionGame(briefFactor, { ...COVERS, GL: ['$18M xs $2M', 1, 18] }));
control('EVENTS_KEEPING_LARGE_CLAIMS emptied (the game replayed)', () => withKept([]), () => {
  const run = playSolo(GAME_YEARS, d => { for (const l of LINES) { d.byLine[l].reinsuranceOption = COVERS[l][0]; d.byLine[l].newMembers = 0.05; } });
  const c = cellsOf(run);
  // Graded against the shipped list (restored): the replay's GL lacks NV's claim.
  const restore = withKept([NV_NAME]);
  try { return sectionGame(briefFactor, COVERS, c); } finally { restore(); }
});
control('a shocks-off game with another game\'s claims (the solo game\'s in its place)', () => () => {},
  () => sectionGame(briefFactor, COVERS, undefined, covered!.cells.slice(0, 3)));
control('a shocks-off game that draws none (the retired rule)', () => () => {},
  () => sectionGame(briefFactor, COVERS, undefined, hostedOff!.cells.map(ws => ws.map(row => row.map(x => ({ ...x, sizes: [] }))))));
control('LARGE_CLAIMS_EVERY_GAME switched off (the hosted game replayed)', () => {
  LARGE_CLAIMS_EVERY_GAME.enabled = false; return () => { LARGE_CLAIMS_EVERY_GAME.enabled = true; };
}, () => sectionGame(briefFactor, COVERS, undefined, undefined, playHostedOff()));
control('the shadow bypassed in the shocks-off game (SHOCK_FREE_PRICING off, both hosted runs)', () => {
  const o = SHOCK_FREE_PRICING.enabled; SHOCK_FREE_PRICING.enabled = false; return () => { SHOCK_FREE_PRICING.enabled = o; };
}, () => sectionGame(briefFactor, COVERS, undefined, undefined, playHostedOff()));
check(sectionRate(), `4. out of the rate, on the real game path: ${GAME_ID} at default decisions, as built and with LARGE_CLAIM_FREQUENCY zeroed, strikes the same rate every line-year`,
  `${rateRuns!.built.perWorld.flat(2).filter(r => (r.claims ?? []).some(c => c.shockId === LARGE_CLAIM_ID)).length} line-world-years with a large claim as built`);
control('the shadow bypassed (SHOCK_FREE_PRICING off, both runs)', () => () => {}, () => {
  const o = SHOCK_FREE_PRICING.enabled; SHOCK_FREE_PRICING.enabled = false;
  try { return sectionRate({ built: playSolo(GAME_YEARS), none: zeroed(() => playSolo(GAME_YEARS)) }); } finally { SHOCK_FREE_PRICING.enabled = o; }
});
check(sectionExpected(), '5. expected losses: shockLarge = Σ freq x the range\'s midpoint x (1 + trend)^(y − 1), years 1-15; plus NV\'s on GL with shocks on; 0 before year 1; the brief with shocks off',
  LINES.map(l => `${l} year 1 $${(briefExpected(l, 1) / M).toFixed(4)}M`).join(', '));
control('High\'s frequency moved to 3%', () => {
  const f = LARGE_CLAIM_FREQUENCY as Record<Lv, number>; const o = f.High; f.High = 0.03; return () => { f.High = o; };
}, sectionExpected);
control('a written-out range moved (Property High from $12M to $14M)', () => {
  const r = BRIEF_RANGE.Property.High; const o = r[0]; r[0] = 14 * M; return () => { r[0] = o; };
}, sectionExpected);
control('EVENTS_KEEPING_LARGE_CLAIMS emptied (no NV in shocks-on GL)', () => withKept([]), sectionExpected);
control('Pandemic added to EVENTS_KEEPING_LARGE_CLAIMS (the expectation)', () => withKept([NV_NAME, 'Pandemic']), sectionExpected);
control('LARGE_CLAIMS_EVERY_GAME switched off (no shockLarge with shocks off)', () => {
  LARGE_CLAIMS_EVERY_GAME.enabled = false; return () => { LARGE_CLAIMS_EVERY_GAME.enabled = true; };
}, sectionExpected);

check(sectionPoolLines(), '6. the pool row\'s "Large claim" record names every line one landed on (linesAffected = its byLine)',
  poolRecs(rateRuns!.built).map(r => `Y${r.y} ${r.lines.join('+')}`).join(', '));
control('the pool record keeps its first line only (the merge before the fix)', () => () => {},
  () => sectionPoolLines(poolRecs(rateRuns!.built).map(r => ({ ...r, lines: r.lines.slice(0, 1) }))));

console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS');
process.exit(failures.length ? 1 : 0);
