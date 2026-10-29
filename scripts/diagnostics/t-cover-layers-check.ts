// ============================================================================
// THE T COVERS' LAYERS AND PRICES (wip/reinsurance-layers) — the gate.
//
//   npx tsx scripts/diagnostics/t-cover-layers-check.ts
//
//   1. OPTIONS: every line offers None and the eight layers — 9, 19, 29 and
//      39 xs 1; 8, 18, 28 and 38 xs 2 ($M), per occurrence — None the default;
//      with the game's shocks off, the same (restated below).
//   2. RECOVERY: each option cedes exactly min(max(claim - attachment, 0),
//      limit) on a claim, at every size from below the attachment to above
//      the tower; the layers are fixed in dollars.
//   3. PRICE, THE METHOD: each option's price is the pricing workbook's method
//      on the year's claims — mean claim per level = the T range's midpoint x
//      the growth factor; expected cost = sum of frequency (Low 7.5%, Mid
//      5.25%, High 2.25%) x min(max(mean - attachment, 0), limit); the 30M
//      layers 1.25 x the 20M layer, the 40M layers 1.2 x the unmultiplied 30M
//      — checked at year 1 against the brief's 2027 table, to the dollar and to
//      its $K, and at grown factors.
//   4. IN A GAME, EVERY YEAR: the cost each line is charged is the method at
//      that year's growth factor — the brief's (trend since 2027 x the book's
//      growth) — and the T claim drawn that year is its table size x the SAME
//      factor, so claims and prices grow together; the recovery on every T
//      claim is the layer on it.
//
// RESTATED FOR LARGE_CLAIMS_EVERY_GAME: large claims are now drawn in every
// game, shocks on or off, so all eight covers and None are offered and priced
// the same in every game. 1 used to want None alone with the game's shocks
// off; it now wants None and the eight layers with the shocks off too, None
// still the default either way, and the same prices: a hosted game with NO
// schedule (gameShocksOn false, asserted), each line buying a different cover
// each year, is charged the method at the year's growth, its large claims the
// table x the same growth, recovered the layer on each — 4's check, on the
// shocks-off game. New control: LARGE_CLAIMS_EVERY_GAME.enabled = false at
// runtime must fail 1.
//
// ⚠ THE BRIEF IS WRITTEN OUT HERE — options, ranges, frequencies, multipliers
// and the 2027 table — not read from pricingParameters, so a changed
// parameter fails rather than moving the expectation with it. Each section
// has a CONTROL that breaks the thing it guards at runtime, requires the
// section to FAIL, and restores it.
// ============================================================================

import { LARGE_CLAIMS_EVERY_GAME, REINSURANCE_OPTIONS, SHOCK_T_CLAIM_RANGE, T_COVER_FREQUENCY, type ReinsuranceOption } from '../../src/data/pricingParameters';
import { REINSURANCE_TOWER, type TowerLine } from '../../src/data/reinsuranceTower';
import { cedeOccurrences } from '../../src/utils/reinsuranceTower';
import { defaultReinsuranceOption, optionPrice, placementFor, reinsuranceOptionIds } from '../../src/utils/reinsuranceOptions';
import { gameShocksOn, resolveShockYear } from '../../src/utils/shockLosses';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { seedFromInstanceId } from '../../src/seedHash';
import { exposureFactor } from '../../src/data/exposureTrend';
import type { ScheduledShock } from '../../src/types/shocks';
import type { CoverageLine, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const M = 1e6;
const failures: string[] = [];
const check = (problems: string[], label: string, detail = '') => {
  if (problems.length) failures.push(label);
  console.log(`  ${problems.length ? 'FAIL' : 'OK  '}  ${label}${detail ? `  — ${detail}` : ''}`);
  for (const p of problems.slice(0, 5)) console.log(`          ${p}`);
};
const control = (label: string, breakIt: () => () => void, section: () => string[]) => {
  const restore = breakIt();
  let problems: string[];
  try { problems = section(); } finally { restore(); }
  check(problems.length > 0 ? [] : ['the section passed with the thing it guards broken'], `  control: ${label}`,
    `${problems.length} problem(s) when broken`);
};
const near = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

// ---- THE BRIEF ---------------------------------------------------------------
// [id, attachment $M, limit $M], in display order.
const BRIEF_COVERS: [string, number, number][] = [
  ['$9M xs $1M', 1, 9], ['$19M xs $1M', 1, 19], ['$29M xs $1M', 1, 29], ['$39M xs $1M', 1, 39],
  ['$8M xs $2M', 2, 8], ['$18M xs $2M', 2, 18], ['$28M xs $2M', 2, 28], ['$38M xs $2M', 2, 38],
];
type Lv = 'Low' | 'Mid' | 'High';
const BRIEF_RANGE: Record<CoverageLine, Record<Lv, [number, number]>> = {
  GL: { Low: [1, 3], Mid: [3, 7], High: [7, 40] },
  WC: { Low: [1, 3], Mid: [3, 6], High: [6, 40] },
  Property: { Low: [2, 5], Mid: [5, 12], High: [12, 40] },
};
const BRIEF_FREQ: Record<Lv, number> = { Low: 0.075, Mid: 0.0525, High: 0.0225 };
const MULT_30 = 1.25, MULT_40 = 1.2;
/** The brief's 2027 table, $K, as given (order as BRIEF_COVERS). */
const BRIEF_2027_K: Record<CoverageLine, number[]> = {
  WC: [461, 686, 858, 904, 311, 536, 670, 724],
  GL: [488, 712, 891, 950, 338, 562, 703, 770],
  Property: [784, 1009, 1261, 1372, 634, 859, 1073, 1192],
};
/** The method, independently: dollars a year at growth factor g. */
function briefPrice(l: CoverageLine, attM: number, limM: number, g: number): number {
  const cost = (a: number, lim: number) => (['Low', 'Mid', 'High'] as Lv[]).reduce((s, lv) => {
    const mean = g * (BRIEF_RANGE[l][lv][0] + BRIEF_RANGE[l][lv][1]) / 2 * M;
    return s + BRIEF_FREQ[lv] * Math.min(Math.max(mean - a * M, 0), lim * M);
  }, 0);
  const top = attM + limM;
  if (top === 30) return MULT_30 * cost(attM, 20 - attM);
  if (top === 40) return MULT_40 * cost(attM, 30 - attM);
  return cost(attM, limM);
}

// ---- 1. OPTIONS ----------------------------------------------------------------
function sectionOptions(): string[] {
  const out: string[] = [];
  for (const l of LINES) {
    const want = ['none', ...BRIEF_COVERS.map(c => c[0])].join('|');
    if (reinsuranceOptionIds(l, true).join('|') !== want) out.push(`${l} offers ${reinsuranceOptionIds(l, true).join(', ')}`);
    // LARGE_CLAIMS_EVERY_GAME: the same nine with the shocks off, None the default.
    if (reinsuranceOptionIds(l, false).join('|') !== want) out.push(`${l} with shocks off offers ${reinsuranceOptionIds(l, false).join(', ')}`);
    if (defaultReinsuranceOption(l, true) !== 'none') out.push(`${l}'s default is ${defaultReinsuranceOption(l, true)}`);
    if (defaultReinsuranceOption(l, false) !== 'none') out.push(`${l}'s default with shocks off is ${defaultReinsuranceOption(l, false)}`);
    if (optionPrice(l, 'none', 1.7) !== 0) out.push(`${l} None costs ${optionPrice(l, 'none', 1.7)}`);
  }
  // The same prices with the shocks off: a hosted game with no schedule, charged the method.
  offGame ??= playGame([], OFF_YEARS);
  if (gameShocksOn(offGame.began[0].setup, offGame.began[0].instance)) out.push('the no-schedule hosted game has its shocks on — not a shocks-off game');
  out.push(...sectionInGame(0, offGame, OFF_YEARS).map(p => `shocks off: ${p}`));
  return out;
}

// ---- 2. RECOVERY ---------------------------------------------------------------
function sectionRecovery(): string[] {
  const out: string[] = [];
  const sizes = [0.5, 1, 1.5, 2, 3, 9.99, 10, 11, 19, 20, 21, 25, 29, 30, 31, 39, 40, 41, 60, 120].map(v => v * M);
  for (const l of LINES) for (const [id, att, lim] of BRIEF_COVERS) {
    const placed = placementFor(l, id);
    for (const x of sizes) {
      const want = Math.min(Math.max(x - att * M, 0), lim * M);
      const got = cedeOccurrences(l as TowerLine, [x], placed, [0]).totalCeded;
      if (!near(got, want)) out.push(`${l} ${id} on a $${x / M}M claim: ceded ${got}, the layer ${want}`);
    }
  }
  return out;
}

// ---- 3. THE METHOD -------------------------------------------------------------
function sectionMethod(): string[] {
  const out: string[] = [];
  for (const l of LINES) BRIEF_COVERS.forEach(([id, att, lim], k) => {
    const p = optionPrice(l, id, 1), want = briefPrice(l, att, lim, 1);
    if (!near(p, want)) out.push(`${l} ${id} 2027: $${p.toFixed(2)}, the method's $${want.toFixed(2)}`);
    // The brief's $K, to its rounding: within half a thousand (its halves round down).
    if (Math.abs(p / 1000 - BRIEF_2027_K[l][k]) > 0.5 + 1e-9) out.push(`${l} ${id} 2027: $${(p / 1000).toFixed(1)}K, the brief's table ${BRIEF_2027_K[l][k]}K`);
    for (const g of [1.04, 1.37, 2.2]) {
      const pg = optionPrice(l, id, g), wg = briefPrice(l, att, lim, g);
      if (!near(pg, wg)) out.push(`${l} ${id} at growth ${g}: $${pg.toFixed(2)}, the method's $${wg.toFixed(2)}`);
    }
  });
  return out;
}

// ---- 4. IN A GAME, EVERY YEAR ----------------------------------------------------
const YEARS = 8;
const BRIEF_TREND: Record<CoverageLine, number> = { WC: 0.04, GL: 0.08, Property: 0.05 };
/** The brief's growth: (1 + trend)^(year - 1) x (this year's quoted book / year 1's). */
function briefFactor(gs: GameState, l: CoverageLine, y: number): number {
  const ls = gs.poolState.lines[l];
  return Math.pow(1 + BRIEF_TREND[l], y - 1) * ((ls.bookExposure ?? 0) * exposureFactor(l, y)) / (ls.shockCostBaseExposure ?? NaN);
}
// T claims on every line, every year from 2: a Winterstorm (#2, T on
// Property), a Nuclear Verdict (#7, GL) and a Pandemic (#9, GL and WC).
const SCHEDULE: ScheduledShock[] = [];
for (let y = 2; y <= YEARS; y++) for (const id of ['#2', '#7', '#9']) SCHEDULE.push({ shockId: id, yearNumber: y });
interface GameRun { began: GameState[]; perYear: LineResultSet[][][] }
let globalGame: GameRun | null = null;
let offGame: GameRun | null = null;
const OFF_YEARS = 5;
function playGame(schedule: ScheduledShock[] = SCHEDULE, years = YEARS): GameRun {
  const id = '9';
  const setup = { poolName: 'L', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES, shockTiming: 'host' } as GameSetupSettings;
  const instance = generateGameInstance(id, seedFromInstanceId(id), schedule);
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory });
  const began: GameState[] = [], perYear: LineResultSet[][][] = [];
  for (let y = 1; y <= years; y++) {
    began.push(gs);
    // Each line buys a different option each year, so every option is charged on every line.
    const d = defaultDecisionSet(y);
    LINES.forEach((l, i) => { d.byLine[l].reinsuranceOption = BRIEF_COVERS[(y + 3 * i) % BRIEF_COVERS.length][0]; });
    const played = playWorldsYear(gs, d);
    perYear.push(played.perWorld.map(p => p.lineResults.map(r => r.result)));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
  }
  return { began, perYear };
}
/** `lag` reads the factor that many years late — the control's broken basis. */
function sectionInGame(lag = 0, run?: GameRun, years: number = YEARS): string[] {
  const out: string[] = [];
  const game = run ?? (globalGame ??= playGame());
  let tSeen = 0, coversSeen = 0;
  for (let y = 1; y <= years; y++) {
    const gs = game.began[y - 1];
    const gy = Math.max(1, y - lag);
    for (const l of LINES) {
      const g = briefFactor(game.began[gy - 1], l, gy);
      const [id, att, lim] = BRIEF_COVERS[(y + 3 * LINES.indexOf(l)) % BRIEF_COVERS.length];
      const price = briefPrice(l, att, lim, g);
      const table = resolveShockYear(gs.instance, 'host', y).byLine[l].arrivals.map(a => a.size);
      game.perYear[y - 1].forEach((rows, w) => {
        const r = rows.find(x => x.line === l)!;
        if (r.decisions?.reinsuranceOption !== id) out.push(`year ${y} ${l} world ${w + 1}: held ${r.decisions?.reinsuranceOption}, bought ${id}`);
        if (!near(r.reinsuranceCost, price)) out.push(`year ${y} ${l} world ${w + 1}: charged $${r.reinsuranceCost.toFixed(0)}, the method at growth ${g.toFixed(4)} $${price.toFixed(0)}`);
        if (y === 1 && !near(g, 1, 1e-12)) out.push(`year 1 ${l}: growth ${g}, not 1`);
        const t = (r.claims ?? []).filter(c => c.tier === 'shock' && c.accidentYear === y).map(c => c.grossUltimate).sort((a, b) => a - b);
        const want = [...table].map(s => s * g).sort((a, b) => a - b);
        if (t.length !== want.length || t.some((x, i) => !near(x, want[i]))) {
          out.push(`year ${y} ${l} world ${w + 1}: T claims ${t.map(x => (x / M).toFixed(3))}, the table x the price's growth ${want.map(x => (x / M).toFixed(3))}`);
        }
        const ceded = t.reduce((s, x) => s + Math.min(Math.max(x - att * M, 0), lim * M), 0);
        if (!near(r.reinsuranceRecovery, ceded)) out.push(`year ${y} ${l} world ${w + 1}: recovered ${r.reinsuranceRecovery.toFixed(0)}, the layer on its T claims ${ceded.toFixed(0)}`);
        tSeen += t.length; coversSeen++;
      });
    }
  }
  if (tSeen === 0) out.push('no T claim arrived — nothing measured');
  const grown = LINES.some(l => briefFactor(game.began[years - 1], l, years) > (run ? 1 : 1.2));
  if (!grown) out.push(`no line grew past ${run ? 1 : 1.2} — the growth is not tested`);
  if (coversSeen === 0) out.push('no cover bought');
  return out;
}

// ---- run -------------------------------------------------------------------------
console.log('t-cover-layers-check\n');
check(sectionOptions(), `1. every line offers None and the eight layers, None the default — with shocks off too, and a no-schedule hosted game (${OFF_YEARS} years) charged the same prices`);
control('a layer dropped from the options', () => {
  const opts = REINSURANCE_OPTIONS.GL as ReinsuranceOption[]; const o = [...opts];
  opts.splice(opts.findIndex(x => x.id === '$29M xs $1M'), 1); return () => { opts.splice(0, opts.length, ...o); };
}, sectionOptions);
control('LARGE_CLAIMS_EVERY_GAME switched off (None alone with shocks off)', () => {
  LARGE_CLAIMS_EVERY_GAME.enabled = false; return () => { LARGE_CLAIMS_EVERY_GAME.enabled = true; };
}, sectionOptions);
check(sectionRecovery(), '2. each option cedes exactly min(max(claim − attachment, 0), limit), every line, claims $0.5M to $120M');
control('the $20M–$30M layer moved to attach at $25M', () => {
  const L = REINSURANCE_TOWER.WC[3]; const o = { a: L.attachment, l: L.limit }; L.attachment = 25e6; L.limit = 5e6;
  return () => { L.attachment = o.a; L.limit = o.l; };
}, sectionRecovery);
check(sectionMethod(), '3. each price is the method — 2027 to the dollar and to the brief\'s $K table, and at grown factors');
control('the High frequency at 2.34%, not 2.25%', () => {
  const f = T_COVER_FREQUENCY as Record<string, number>; const of = f.High; f.High = 0.0234;
  return () => { f.High = of; };
}, sectionMethod);
control('a T range\'s midpoint moved (Mid on WC $3M–$7M)', () => {
  const r = SHOCK_T_CLAIM_RANGE.WC as Record<string, readonly number[]>; const o = r.Mid; r.Mid = [3e6, 7e6];
  return () => { r.Mid = o; };
}, sectionMethod);
check(sectionInGame(), `4. in a game, every year to ${YEARS}: each line charged the method at the year's growth, its T claims the table x the same growth, recovered the layer on each`);
control('the price read at the year before\'s growth', () => () => {}, () => sectionInGame(1));
control('the price read at no growth (the 2027 table every year)', () => () => {}, () => sectionInGame(YEARS));

console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS');
process.exit(failures.length ? 1 : 0);
