// ============================================================================
// LARGE CLAIMS COME ONLY FROM T-SHOCK EVENTS (wip/large-claims-from-events) —
// THE GATE. It replaces large-claim-frequency-check, whose frequency draw is
// gone from src.
//
//   npx tsx scripts/diagnostics/large-claims-from-events-check.ts
//
// THE BRIEF, WRITTEN OUT HERE (not read from pricingParameters):
//   - A large claim comes only when a T-shock event fires: the events a host
//     schedules in a hosted game; the catalogue in single player and Test
//     player. Each event at its T level from the event map — one claim per line
//     the map gives a T level, in the firing year:
//         Earthquake        Property High     Nuclear Verdict   GL High
//         Winterstorm       Property Low      Social Inflation  GL Low
//         Wildfire          Property High     Pandemic          GL Mid, WC High
//     and no other event (Legislation, WC Reform, Recession, Economic
//     Inflation, Investment Loss, Member Withdrawal) brings one.
//   - Its size drawn evenly within the line's range for the level ($M):
//         WC        Low 1-3   Mid 3-6    High 6-40
//         GL        Low 1-3   Mid 3-7    High 7-40
//         Property  Low 2-5   Mid 5-12   High 12-40
//     x the year's growth factor: (1 + trend)^(y - 1) x the book's quoted
//     exposure / year 1's, trend WC 4%, GL 8%, Property 5%.
//   - There is no separate draw: a hosted game with no schedule (shocks off)
//     has no large claims at all — but is still offered the nine covers.
//   - The pricing odds — Low 7.5%, Mid 5.25%, High 2.25% — price the covers
//     and build the Event Likelihoods, and never draw. The price: mean claim
//     per level = the range's midpoint x growth; expected cost = Σ odds x
//     min(max(mean − attachment, 0), limit); 30M layers 1.25 x the 20M layer,
//     40M layers 1.2 x the unmultiplied 30M layer. The 2027 table below.
//   - The covers and the Event Likelihoods in every game (COVERS_IN_EVERY_GAME).
//
//   1. THE T RANGES: SHOCK_T_CLAIM_RANGE is the table above, exactly, every
//      line and level (and tClaimSize spans it).
//   2. THE PRICING ODDS: T_COVER_FREQUENCY is 7.5 / 5.25 / 2.25%, and every
//      2027 cover price, recomputed here by the method, is the brief's table to
//      $0.1K — and tCoverPrice / optionPrice at factor 1 agree to the cent.
//   3. NO SEPARATE DRAW: a hosted game with no schedule (shocks off, asserted),
//      five years, every world: no shock-tier claim on any line, year or world,
//      no shock record of any kind, and the nine covers still offered.
//   4. ONLY THE EVENTS' T: a hosted game with Nuclear Verdict (#7), Pandemic
//      (#9) and Legislation (#4, no T) scheduled, and two single player games
//      on the catalogue (scenario 19: Legislation (no T) in year 2, Wildfire
//      in year 4; scenario 11: Nuclear Verdict in year 3). Every shock
//      claim belongs to a firing whose event has a T level on its line, sits at
//      that level, inside the range x the year's growth factor (and exactly the
//      firing's draw there), one per line per firing, in the firing year, the
//      same in every world. Nuclear Verdict brings exactly one GL High claim;
//      Legislation none. No record or claim carries shockId 'T'.
//   5. COVERS AND LIKELIHOODS IN EVERY GAME: in the shocks-off hosted game,
//      reinsuranceOptionIds gives the nine; each one's struck charge is
//      optionPrice at the game's growth factor, as each one's is in the
//      shocks-on hosted game at its own; and the Rate Indication's
//      eventLikelihoods is non-null and equals eventLikelihoods(line, factor)
//      — the factor its own cover prices and the engine's charge use (trend x
//      the book's growth) — and the shocks-off game's table is the shocks-on
//      game's (the two share a seed, decisions and so a book).
//
// ⚠ SECTION 5 FAILS AS SRC STANDS (found writing this gate, NOT fixed here —
// src is out of this gate's scope): buildRateIndication passes
// fundingConsequenceInput(...).book — the FundingConsequenceBook wrapper — to
// pricedGrowthFactor, whose shockBaseOf reads `.shockBase` off it; the base is
// on `.book.members`. So the coming year's Event Likelihoods grow by the trend
// alone, while the same page's cover prices and the engine's charge grow by
// trend x book growth. It shows wherever the book has grown (here 5% new
// members a year); event-likelihoods-check's games add none, so it passes.
//
// ⚠ EACH SECTION HAS CONTROLS that break the thing it guards at runtime,
// require the section to FAIL, and restore it.
// ============================================================================

import {
  COVERS_IN_EVERY_GAME, R_MODEL, SHOCK_T_CLAIM_RANGE, T_COVER_FREQUENCY, WORLD_COUNT,
} from '../../src/data/pricingParameters';
import { SHOCK_EVENTS, eventLines, firingsStartingIn, gameShocksOn, tClaimSize } from '../../src/utils/shockLosses';
import { defaultReinsuranceOption, optionPrice, reinsuranceOptionIds, tCoverPrice } from '../../src/utils/reinsuranceOptions';
import { eventLikelihoods } from '../../src/utils/eventLikelihoods';
import { buildRateIndication } from '../../src/utils/rateIndication';
import { openSoloInstance } from '../../src/utils/soloGame';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, strikeRates } from '../../src/utils/worlds';
import { seedFromInstanceId } from '../../src/seedHash';
import { exposureFactor } from '../../src/data/exposureTrend';
import type { ScheduledShock } from '../../src/types/shocks';
import type { Claim, CoverageLine, DecisionSet, GameInstance, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

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
const BRIEF_RANGE: Record<CoverageLine, Record<Lv, [number, number]>> = {
  WC: { Low: [1 * M, 3 * M], Mid: [3 * M, 6 * M], High: [6 * M, 40 * M] },
  GL: { Low: [1 * M, 3 * M], Mid: [3 * M, 7 * M], High: [7 * M, 40 * M] },
  Property: { Low: [2 * M, 5 * M], Mid: [5 * M, 12 * M], High: [12 * M, 40 * M] },
};
const BRIEF_ODDS: Record<Lv, number> = { Low: 0.075, Mid: 0.0525, High: 0.0225 };
const BRIEF_TREND: Record<CoverageLine, number> = { WC: 0.04, GL: 0.08, Property: 0.05 };
// The event map's T column, by event id: line -> level. Absent: no T.
const BRIEF_T: Record<string, Partial<Record<CoverageLine, Lv>>> = {
  '#1': { Property: 'High' }, '#2': { Property: 'Low' }, '#3': { Property: 'High' },
  '#4': {}, '#5': {}, '#6': {},
  '#7': { GL: 'High' }, '#8': { GL: 'Low' }, '#9': { GL: 'Mid', WC: 'High' },
  '#10': {}, '#11': {}, '#12': {},
};
// [id, attachment $M, limit $M], in display order.
const BRIEF_COVERS: [string, number, number][] = [
  ['$9M xs $1M', 1, 9], ['$19M xs $1M', 1, 19], ['$29M xs $1M', 1, 29], ['$39M xs $1M', 1, 39],
  ['$8M xs $2M', 2, 8], ['$18M xs $2M', 2, 18], ['$28M xs $2M', 2, 28], ['$38M xs $2M', 2, 38],
];
const NINE = ['none', ...BRIEF_COVERS.map(c => c[0])].join('|');
const MULT = { m30: 1.25, m40: 1.2 };
/** The brief's 2027 cover prices, $K at growth 1 (order as BRIEF_COVERS). */
const BRIEF_2027_K: Record<CoverageLine, number[]> = {
  WC: [461.3, 686.3, 857.8, 904.5, 311.3, 536.3, 670.3, 724.5],
  GL: [487.5, 712.5, 890.6, 949.5, 337.5, 562.5, 703.1, 769.5],
  Property: [783.8, 1008.8, 1260.9, 1372.5, 633.8, 858.8, 1073.4, 1192.5],
};
/** The method, independently: a cover's price in dollars at growth factor g. */
function briefPrice(l: CoverageLine, attM: number, limM: number, g: number): number {
  const cost = (a: number, lim: number) => LEVELS.reduce((s, lv) => {
    const mean = g * (BRIEF_RANGE[l][lv][0] + BRIEF_RANGE[l][lv][1]) / 2;
    return s + BRIEF_ODDS[lv] * Math.min(Math.max(mean - a * M, 0), lim * M);
  }, 0);
  const top = attM + limM;
  if (top === 30) return MULT.m30 * cost(attM, 20 - attM);
  if (top === 40) return MULT.m40 * cost(attM, 30 - attM);
  return cost(attM, limM);
}
/** The brief's growth: (1 + trend)^(y − 1) x (this year's quoted book / year 1's), on the state the year began in. */
type Factor = (gs: GameState, l: CoverageLine, y: number) => number;
const briefFactor: Factor = (gs, l, y) => {
  const ls = gs.poolState.lines[l];
  return Math.pow(1 + BRIEF_TREND[l], y - 1) * ((ls.bookExposure ?? 0) * exposureFactor(l, y)) / (ls.shockCostBaseExposure ?? NaN);
};
const trendOnly: Factor = (_gs, l, y) => Math.pow(1 + BRIEF_TREND[l], y - 1);

// ---- 1. THE T RANGES ---------------------------------------------------------------
function sectionRanges(): string[] {
  const out: string[] = [];
  const lines = Object.keys(SHOCK_T_CLAIM_RANGE).sort().join(',');
  if (lines !== 'GL,Property,WC') out.push(`SHOCK_T_CLAIM_RANGE holds lines ${lines}`);
  for (const l of LINES) {
    const levels = Object.keys(SHOCK_T_CLAIM_RANGE[l]).sort().join(',');
    if (levels !== 'High,Low,Mid') out.push(`${l} holds levels ${levels}`);
    for (const lv of LEVELS) {
      const got = SHOCK_T_CLAIM_RANGE[l][lv], want = BRIEF_RANGE[l][lv];
      if (got.length !== 2 || got[0] !== want[0] || got[1] !== want[1]) {
        out.push(`${l} ${lv}: $${(got[0] / M)}M–$${(got[1] / M)}M, the brief's $${want[0] / M}M–$${want[1] / M}M`);
      }
      // The draw's rule spans it: u = 0 the bottom, u → 1 the top, evenly between.
      for (const u of [0, 0.5, 0.999999]) {
        if (!near(tClaimSize(l, lv, u), want[0] + u * (want[1] - want[0]), 1e-12)) out.push(`${l} ${lv} u=${u}: tClaimSize ${tClaimSize(l, lv, u)}`);
      }
    }
  }
  return out;
}

// ---- 2. THE PRICING ODDS -----------------------------------------------------------
type PriceFn = (l: CoverageLine, id: string, g: number) => number;
function sectionOdds(price: PriceFn = (l, id, g) => tCoverPrice(l, id, g)): string[] {
  const out: string[] = [];
  const keys = Object.keys(T_COVER_FREQUENCY).sort().join(',');
  if (keys !== 'High,Low,Mid') out.push(`T_COVER_FREQUENCY holds ${keys}`);
  for (const lv of LEVELS) {
    if (T_COVER_FREQUENCY[lv] !== BRIEF_ODDS[lv]) out.push(`T_COVER_FREQUENCY.${lv} ${T_COVER_FREQUENCY[lv]}, the brief's ${BRIEF_ODDS[lv]}`);
  }
  for (const l of LINES) BRIEF_COVERS.forEach(([id, att, lim], k) => {
    const mine = briefPrice(l, att, lim, 1);
    // The method recomputed here, against the brief's table to $0.1K.
    if (Math.abs(mine / 1000 - BRIEF_2027_K[l][k]) > 0.05 + 1e-9) out.push(`${l} ${id} 2027: the method gives $${(mine / 1000).toFixed(2)}K, the brief's table $${BRIEF_2027_K[l][k]}K`);
    // src's price at factor 1, to the cent, and to the table.
    const src = price(l, id, 1), shown = optionPrice(l, id, 1);
    if (Math.abs(src - mine) > 0.005) out.push(`${l} ${id} 2027: tCoverPrice $${src.toFixed(2)}, the method's $${mine.toFixed(2)}`);
    if (Math.abs(shown - src) > 0.005) out.push(`${l} ${id} 2027: optionPrice $${shown.toFixed(2)}, tCoverPrice $${src.toFixed(2)}`);
    if (Math.abs(src / 1000 - BRIEF_2027_K[l][k]) > 0.05 + 1e-9) out.push(`${l} ${id} 2027: $${(src / 1000).toFixed(2)}K, the brief's table $${BRIEF_2027_K[l][k]}K`);
  });
  for (const l of LINES) if (price(l, 'none', 1) !== 0) out.push(`${l} None costs ${price(l, 'none', 1)}`);
  return out;
}

// ---- games ---------------------------------------------------------------------------
const YEARS = 5;
interface Run { setup: GameSetupSettings; began: GameState[]; end: GameState; perWorld: LineResultSet[][][] }
/** A cover per line-year, rotating so every option is bought; 5% new members a year so the book grows. */
const coverOf = (l: CoverageLine, y: number) => BRIEF_COVERS[(y + 3 * LINES.indexOf(l)) % BRIEF_COVERS.length][0];
const decide = (y: number): DecisionSet => {
  const d = defaultDecisionSet(y);
  for (const l of LINES) { d.byLine[l].reinsuranceOption = coverOf(l, y); d.byLine[l].newMembers = 0.05; }
  return d;
};
function playFrom(setup: GameSetupSettings, instance: GameInstance, years = YEARS): Run {
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: decide(1), priorHistory });
  const began: GameState[] = [], perWorld: LineResultSet[][][] = [];
  for (let y = 1; y <= years; y++) {
    began.push(gs);
    const played = playWorldsYear(gs, decide(y));
    perWorld.push(played.perWorld.map(p => p.lineResults.map(r => r.result)));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
  }
  began.push(gs);
  return { setup, began, end: gs, perWorld };
}
const HOST_ID = 'LCE7';
const hostSetup = (): GameSetupSettings =>
  ({ poolName: 'E', gameLength: YEARS + 1, startingYear: 2026, instanceId: HOST_ID, activeLines: LINES, shockTiming: 'host' }) as GameSetupSettings;
const hosted = (schedule: ScheduledShock[]) => ({ setup: hostSetup(), instance: generateGameInstance(HOST_ID, seedFromInstanceId(HOST_ID), schedule) });
const SCHEDULE: ScheduledShock[] = [
  { shockId: '#7', yearNumber: 2 }, { shockId: '#4', yearNumber: 2 }, { shockId: '#9', yearNumber: 3 }, { shockId: '#7', yearNumber: 5 },
];
const T_LESS = '#4';
// Single player on the catalogue (SOLO_SHOCKS): scenario 19 draws #4 in year 2
// and #3 (Wildfire) in year 4; scenario 11 draws #7 (Nuclear Verdict) in year 3.
const SOLO_IDS = ['19', '11'];
let offRun: Run | null = null, onRun: Run | null = null;
const soloRuns = new Map<string, Run>();
const offGame = () => (offRun ??= (() => { const g = hosted([]); return playFrom(g.setup, g.instance); })());
const onGame = () => (onRun ??= (() => { const g = hosted(SCHEDULE); return playFrom(g.setup, g.instance); })());
const soloGame = (id: string): Run => {
  let r = soloRuns.get(id);
  if (!r) {
    const { setup, instance } = openSoloInstance({ poolName: 'E', gameLength: YEARS + 1, startingYear: 2026, instanceId: id, activeLines: LINES } as GameSetupSettings);
    r = playFrom(setup, instance);
    soloRuns.set(id, r);
  }
  return r;
};
const shockClaims = (r: LineResultSet): Claim[] => (r.claims ?? []).filter(c => c.tier === 'shock' || c.shockId !== undefined);
const recordsOf = (r: { shockEvents?: readonly { shockId: string }[] }) => r.shockEvents ?? [];

// ---- 3. NO SEPARATE DRAW -------------------------------------------------------------
function sectionNoDraw(perWorldIn?: LineResultSet[][][]): string[] {
  const out: string[] = [];
  const run = offGame();
  const perWorld = perWorldIn ?? run.perWorld;
  if (gameShocksOn(run.setup, run.end.instance)) out.push('the hosted game with no schedule has its shocks on — not a shocks-off game');
  if ((run.end.instance.scheduledShocks ?? []).length) out.push('the hosted game carries a schedule');
  let rows = 0, claims = 0;
  perWorld.forEach((worlds, yi) => worlds.forEach((lineRows, w) => lineRows.forEach(r => {
    rows++;
    claims += (r.claims ?? []).length;
    const s = shockClaims(r);
    if (s.length) out.push(`year ${yi + 1} ${r.line} world ${w + 1}: ${s.length} shock claim(s), e.g. ${s[0].id} $${(s[0].grossUltimate / M).toFixed(3)}M (${s[0].shockId ?? 'no id'})`);
    if (recordsOf(r as never).length) out.push(`year ${yi + 1} ${r.line} world ${w + 1}: shock record(s) ${recordsOf(r as never).map(x => x.shockId).join(', ')}`);
  })));
  for (const r of run.end.lockedResults) {
    if (recordsOf(r as never).length) out.push(`year ${r.yearNumber}: the pool's shock record(s) ${recordsOf(r as never).map(x => x.shockId).join(', ')}`);
    for (const l of LINES) if (recordsOf((r.byLine[l] ?? {}) as never).length) out.push(`year ${r.yearNumber} ${l}: an averaged shock record`);
  }
  for (const l of LINES) {
    const ids = reinsuranceOptionIds(l, gameShocksOn(run.setup, run.end.instance)).join('|');
    if (ids !== NINE) out.push(`${l}: the shocks-off game is offered ${ids}`);
    if (defaultReinsuranceOption(l, false) !== 'none') out.push(`${l}: the shocks-off default is ${defaultReinsuranceOption(l, false)}`);
  }
  const want = YEARS * WORLD_COUNT * LINES.length;
  if (rows !== want) out.push(`${rows} line-world-years read, ${want} played`);
  void claims;
  // Not vacuous: the same reader finds the shock claims of the scheduled game (section 4's).
  if (!onGame().perWorld.flat(2).some(r => shockClaims(r).length > 0)) out.push('the reader finds no shock claim even in the scheduled game — the check is vacuous');
  return out;
}

// ---- 4. ONLY THE EVENTS' T -----------------------------------------------------------
interface Want { line: CoverageLine; eventId: string; level: Lv; size: number; lo: number; hi: number }
/** What each year's T claims must be, from the firings and the brief, at factor `f`. */
function wanted(run: Run, y: number, f: Factor): Want[] {
  const timing = run.setup.shockTiming === 'host' || run.setup.shockTiming === 'solo' ? 'host' : 'catalogue';
  const out: Want[] = [];
  for (const firing of firingsStartingIn(run.began[y - 1].instance, timing, y)) {
    for (const l of LINES) {
      const lv = BRIEF_T[firing.event.id]?.[l];
      if (!lv) continue;
      const g = f(run.began[y - 1], l, y);
      const [lo, hi] = BRIEF_RANGE[l][lv];
      out.push({ line: l, eventId: firing.event.id, level: lv, size: (lo + firing.draws[l].t * (hi - lo)) * g, lo: lo * g, hi: hi * g });
    }
  }
  return out;
}
interface Tally { claims: number; nvGL: number; firingsWithT: number; tLessFired: number; grown: number }
function gradeRun(run: Run, tag: string, f: Factor, perWorldIn: LineResultSet[][][] | undefined, tally: Tally): string[] {
  const out: string[] = [];
  const perWorld = perWorldIn ?? run.perWorld;
  const timing = run.setup.shockTiming === 'host' || run.setup.shockTiming === 'solo' ? 'host' : 'catalogue';
  for (let y = 1; y <= YEARS; y++) {
    const want = wanted(run, y, f);
    const firings = firingsStartingIn(run.began[y - 1].instance, timing, y);
    tally.firingsWithT += firings.filter(x => Object.keys(BRIEF_T[x.event.id] ?? {}).length > 0).length;
    tally.tLessFired += firings.filter(x => x.event.id === T_LESS).length;
    for (const l of LINES) if (Math.abs(briefFactor(run.began[y - 1], l, y) - trendOnly(run.began[y - 1], l, y)) > 1e-6) tally.grown++;
    const forms = new Set<string>();
    perWorld[y - 1].forEach((rows, w) => {
      const all = rows.flatMap(r => shockClaims(r).map(c => ({ r, c })));
      // Only this year's accident-year claims are the year's arrivals; a carried claim must be an earlier year's.
      const mine = all.filter(({ c }) => c.accidentYear === y);
      for (const { r, c } of all) {
        if (c.accidentYear > y) out.push(`${tag} year ${y} ${r.line} world ${w + 1}: claim ${c.id} from accident year ${c.accidentYear}`);
        if (c.shockId === 'T') out.push(`${tag} year ${y} ${r.line} world ${w + 1}: claim ${c.id} carries shockId 'T'`);
        if (c.tier !== 'shock') out.push(`${tag} year ${y} ${r.line} world ${w + 1}: claim ${c.id} carries an event but tier '${c.tier}'`);
      }
      for (const r of rows) for (const rec of recordsOf(r as never)) if (rec.shockId === 'T') out.push(`${tag} year ${y} ${r.line} world ${w + 1}: a record with shockId 'T'`);
      const left = [...want];
      for (const { r, c } of mine) {
        const lv = BRIEF_T[c.shockId ?? '']?.[r.line as CoverageLine];
        if (!lv) { out.push(`${tag} year ${y} ${r.line} world ${w + 1}: claim ${c.id} attributed to ${c.shockId ?? 'nothing'}, which has no T on ${r.line}`); continue; }
        // That level's range x the year's growth, and exactly the firing's draw inside it.
        const i = left.findIndex(x => x.line === r.line && x.eventId === c.shockId && near(c.grossUltimate, x.size, 1e-9));
        if (i < 0) {
          const cand = want.find(x => x.line === r.line && x.eventId === c.shockId);
          out.push(`${tag} year ${y} ${r.line} world ${w + 1}: ${c.shockId} claim $${(c.grossUltimate / M).toFixed(4)}M, `
            + (cand ? `the firing's ${lv} draw x growth $${(cand.size / M).toFixed(4)}M (range $${(cand.lo / M).toFixed(3)}–${(cand.hi / M).toFixed(3)}M)` : 'no such firing this year'));
          continue;
        }
        const x = left.splice(i, 1)[0];
        if (c.grossUltimate < x.lo - 1e-6 || c.grossUltimate > x.hi + 1e-6) out.push(`${tag} year ${y} ${r.line}: claim outside ${lv}'s range x growth`);
        tally.claims++;
        if (r.line === 'GL' && c.shockId === '#7' && w === 0) tally.nvGL++;
        if (c.shockId === '#7' && (r.line !== 'GL' || lv !== 'High')) out.push(`${tag} year ${y}: Nuclear Verdict's claim on ${r.line} at ${lv}`);
      }
      for (const x of left) out.push(`${tag} year ${y} world ${w + 1}: ${x.eventId}'s ${x.line} ${x.level} claim missing ($${(x.size / M).toFixed(4)}M)`);
      forms.add(JSON.stringify(mine.map(({ r, c }) => [r.line, c.shockId, c.grossUltimate]).sort()));
    });
    if (forms.size !== 1) out.push(`${tag} year ${y}: the T claims in ${forms.size} forms over the worlds`);
  }
  for (const r of run.end.lockedResults) for (const rec of recordsOf(r as never)) if (rec.shockId === 'T') out.push(`${tag} year ${r.yearNumber}: a pool record with shockId 'T'`);
  return out;
}
let lastTally: Tally | null = null;
function sectionEvents(f: Factor = briefFactor, onPerWorld?: LineResultSet[][][]): string[] {
  const out: string[] = [];
  // The event map agrees with the T column written out here.
  for (const e of SHOCK_EVENTS) {
    const got = JSON.stringify(eventLines(e.name).filter(r => r.t !== 'None').map(r => [r.line, r.t]).sort());
    const want = JSON.stringify(Object.entries(BRIEF_T[e.id] ?? {}).sort());
    if (got !== want) out.push(`${e.id} ${e.name}: the map's T ${got}, the brief's ${want}`);
  }
  const on = onGame();
  if (!gameShocksOn(on.setup, on.end.instance)) out.push('the scheduled hosted game has its shocks off');
  const tally: Tally = { claims: 0, nvGL: 0, firingsWithT: 0, tLessFired: 0, grown: 0 };
  out.push(...gradeRun(on, 'hosted', f, onPerWorld, tally));
  const hostedNV = tally.nvGL, hostedTLess = tally.tLessFired;
  let soloT = 0;
  for (const id of SOLO_IDS) {
    const solo = soloGame(id);
    if (!gameShocksOn(solo.setup, solo.end.instance)) out.push(`solo ${id}: its shocks are off`);
    out.push(...gradeRun(solo, `solo ${id}`, f, undefined, tally));
    soloT += (solo.end.instance.scheduledShocks ?? []).filter(s => Object.keys(BRIEF_T[s.shockId] ?? {}).length && s.yearNumber <= YEARS).length;
  }
  // Nuclear Verdict: exactly one GL High claim per firing (it fires twice in the hosted game).
  const nvFirings = SCHEDULE.filter(s => s.shockId === '#7').length;
  if (hostedNV !== nvFirings) out.push(`Nuclear Verdict fired ${nvFirings} time(s) but brought ${hostedNV} GL claim(s) in world 1`);
  if (hostedTLess === 0) out.push('the T-less event never fired — "none from it" not measured');
  if (tally.claims === 0) out.push('no T claim in either game — nothing measured');
  if (tally.grown === 0) out.push('no line-year grew off the trend alone — the book growth is not tested');
  if (soloT === 0) out.push('the solo game drew no T-bearing event in its years — the catalogue path not measured');
  lastTally = tally;
  return out;
}

// ---- 5. COVERS AND LIKELIHOODS IN EVERY GAME ------------------------------------------
function sectionEveryGame(): string[] {
  const out: string[] = [];
  const off = offGame(), on = onGame();
  let charged = 0;
  for (const [run, tag] of [[off, 'shocks off'], [on, 'shocks on']] as const) {
    const shocks = gameShocksOn(run.setup, run.end.instance);
    if (shocks !== (tag === 'shocks on')) out.push(`${tag}: gameShocksOn is ${shocks}`);
    // Every year played: the charge for the cover bought is optionPrice at the year's factor (the method).
    for (let y = 1; y <= YEARS; y++) for (const l of LINES) {
      const g = briefFactor(run.began[y - 1], l, y);
      const id = coverOf(l, y), c = BRIEF_COVERS.find(x => x[0] === id)!;
      const price = optionPrice(l, id, g), method = briefPrice(l, c[1], c[2], g);
      if (!near(price, method)) out.push(`${tag} year ${y} ${l} ${id}: optionPrice $${price.toFixed(2)}, the method's $${method.toFixed(2)}`);
      const r = run.perWorld[y - 1][0].find(x => x.line === l)!;
      if (r.decisions?.reinsuranceOption !== id) out.push(`${tag} year ${y} ${l}: held ${r.decisions?.reinsuranceOption}, bought ${id}`);
      else if (!near(r.reinsuranceCost, price)) out.push(`${tag} year ${y} ${l} ${id}: charged $${r.reinsuranceCost.toFixed(2)}, optionPrice at growth ${g.toFixed(4)} $${price.toFixed(2)}`);
      else charged++;
    }
    // The coming year: each of the nine offered, struck at the game's factor; the Rate Indication's table.
    const gs = run.end, y = gs.currentYearNumber;
    for (const l of LINES) {
      const ids = reinsuranceOptionIds(l, shocks);
      if (ids.join('|') !== NINE) { out.push(`${tag} ${l}: offered ${ids.join(', ')}`); }
      const g = briefFactor(gs, l, y);
      for (const id of ids) {
        const d = defaultDecisionSet(y);
        d.byLine[l].reinsuranceOption = id;
        const struck = strikeRates(gs, d)[l];
        const want = optionPrice(l, id, g);
        if (!struck) { out.push(`${tag} ${l} ${id}: no rate struck`); continue; }
        if (!near(struck.quote.reinsuranceCost, want)) out.push(`${tag} year ${y} ${l} ${id}: struck $${struck.quote.reinsuranceCost.toFixed(2)}, optionPrice at growth ${g.toFixed(4)} $${want.toFixed(2)}`);
      }
      const ri = buildRateIndication(gs, l, defaultDecisionSet(y), y);
      if (!ri) { out.push(`${tag} ${l}: no Rate Indication`); continue; }
      if (ri.reinsurance.map(x => x.id).join('|') !== NINE) out.push(`${tag} ${l}: the Rate Indication lists ${ri.reinsurance.map(x => x.id).join(', ')}`);
      if (!ri.eventLikelihoods) { out.push(`${tag} ${l} year ${y}: no Event Likelihoods`); continue; }
      const table = eventLikelihoods(l, g);
      const same = ri.eventLikelihoods.length === table.length && ri.eventLikelihoods.every((e, i) =>
        e.years === table[i].years && e.size !== null && table[i].size !== null && Math.abs(e.size - table[i].size!) <= 1);
      if (!same) out.push(`${tag} ${l} year ${y}: Event Likelihoods ${JSON.stringify(ri.eventLikelihoods.map(e => e.size && +(e.size / M).toFixed(3)))}, eventLikelihoods at ${g.toFixed(4)} ${JSON.stringify(table.map(e => e.size && +(e.size / M).toFixed(3)))}`);
    }
  }
  // The shocks-off game's table is the shocks-on game's: one seed, one book.
  for (const l of LINES) {
    const y = off.end.currentYearNumber;
    const a = buildRateIndication(off.end, l, defaultDecisionSet(y), y)?.eventLikelihoods;
    const b = buildRateIndication(on.end, l, defaultDecisionSet(y), y)?.eventLikelihoods;
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${l} year ${y}: the shocks-off game's Event Likelihoods are not the shocks-on game's`);
  }
  if (charged === 0) out.push('no cover charged — nothing measured');
  return out;
}

// ---- run -------------------------------------------------------------------------------
console.log(`large-claims-from-events-check (${WORLD_COUNT} worlds)\n`);
check(sectionRanges(), '1. the T ranges: SHOCK_T_CLAIM_RANGE is the brief\'s table exactly, every line and level');
control('one range drifted (GL Mid to $3M–$8M at runtime)', () => {
  const r = SHOCK_T_CLAIM_RANGE.GL as Record<string, readonly number[]>; const o = r.Mid; r.Mid = [3e6, 8e6];
  return () => { r.Mid = o; };
}, sectionRanges);
control('R_MODEL.tShock\'s values swapped in (Highs to $15M / $12M / $25M)', () => {
  const saved = LINES.map(l => ({ ...SHOCK_T_CLAIM_RANGE[l] }));
  for (const l of LINES) Object.assign(SHOCK_T_CLAIM_RANGE[l] as object, R_MODEL.tShock[l]);
  return () => { LINES.forEach((l, i) => Object.assign(SHOCK_T_CLAIM_RANGE[l] as object, saved[i])); };
}, sectionRanges);

check(sectionOdds(), '2. the pricing odds: T_COVER_FREQUENCY 7.5 / 5.25 / 2.25%; every 2027 price, by the method recomputed here, the brief\'s table to $0.1K, and tCoverPrice / optionPrice agree',
  LINES.map(l => `${l} 9xs1 $${(tCoverPrice(l, '$9M xs $1M', 1) / 1000).toFixed(1)}K`).join(', '));
control('the 30M multiplier at 1.3 (the price\'s 30M layers rescaled)', () => () => {},
  () => sectionOdds((l, id, g) => tCoverPrice(l, id, g) * (/\$(29M xs \$1M|28M xs \$2M)/.test(id) ? 1.3 / 1.25 : 1)));
control('the gate\'s own 30M multiplier at 1.3 (the method moved, src not)', () => { MULT.m30 = 1.3; return () => { MULT.m30 = 1.25; }; }, () => sectionOdds());
control('an odds value changed (T_COVER_FREQUENCY.High to 2.5% at runtime)', () => {
  const f = T_COVER_FREQUENCY as Record<string, number>; const o = f.High; f.High = 0.025;
  return () => { f.High = o; };
}, () => sectionOdds());

check(sectionNoDraw(), `3. no separate draw: a hosted game with no schedule (shocks off), ${YEARS} years x ${WORLD_COUNT} worlds — no shock claim on any line, year or world, no shock record, the nine covers offered`);
control('a fake shock claim injected into one world\'s results', () => () => {}, () => {
  const run = offGame();
  const pw = run.perWorld.map(ws => ws.map(rows => rows.map(r => ({ ...r }))));
  const r = pw[2][WORLD_COUNT - 1][1];
  r.claims = [...(r.claims ?? []), { id: 'fake-t', occurrenceId: 'fake', memberId: 'book', line: r.line, accidentYear: 3, calendarYear: 2028, tier: 'shock',
    status: 'open', reportedYear: 3, grossUltimate: 5e6, paidToDate: 0, caseReserve: 5e6, shockId: 'T' } as Claim];
  return sectionNoDraw(pw);
});
control('COVERS_IN_EVERY_GAME switched off (None alone offered with shocks off)', () => {
  COVERS_IN_EVERY_GAME.enabled = false; return () => { COVERS_IN_EVERY_GAME.enabled = true; };
}, () => sectionNoDraw());

check(sectionEvents(), `4. only the events' T: a hosted game (#7 years 2 and 5, #4 year 2, #9 year 3) and solo scenarios ${SOLO_IDS.join(' and ')} on the catalogue — every shock claim its firing's T level on its line, the draw x the year's growth, one per line per firing, in the firing year, alike in every world; NV one GL High; #4 none; no 'T'`,
  (() => { const t = lastTally as Tally | null; return t ? `${t.claims} claims matched across both games' worlds, ${t.firingsWithT} T-bearing firings` : ''; })());
control('the claims expected at trend alone (no book growth)', () => () => {}, () => sectionEvents(trendOnly));
control('a claim attributed to a T-less event (#4)', () => () => {}, () => {
  const run = onGame();
  const pw = run.perWorld.map(ws => ws.map(rows => rows.map(r => ({ ...r, claims: [...(r.claims ?? [])] }))));
  const y = pw.findIndex(ws => ws[0].some(r => shockClaims(r).some(c => c.accidentYear === pw.indexOf(ws) + 1)));
  const r = pw[y][0].find(x => shockClaims(x).length)!;
  const i = r.claims!.findIndex(c => c.tier === 'shock');
  r.claims![i] = { ...r.claims![i], shockId: T_LESS };
  return sectionEvents(briefFactor, pw);
});
control('a large claim drawn on its own (a shockId \'T\' claim added in every world)', () => () => {}, () => {
  const run = onGame();
  const pw = run.perWorld.map(ws => ws.map(rows => rows.map(r => ({ ...r, claims: [...(r.claims ?? [])] }))));
  for (const ws of pw) for (const rows of ws) rows[0].claims!.push({ id: 'freq-t', occurrenceId: 'freq', memberId: 'book', line: rows[0].line, accidentYear: 1,
    calendarYear: 2026, tier: 'shock', status: 'open', reportedYear: 1, grossUltimate: 2e6, paidToDate: 0, caseReserve: 2e6, shockId: 'T' } as Claim);
  return sectionEvents(briefFactor, pw);
});

check(sectionEveryGame(), '5. covers and likelihoods in every game: the shocks-off hosted game offers the nine, charges and strikes optionPrice at its factor as the shocks-on game does at its own, and its Rate Indication\'s Event Likelihoods are eventLikelihoods(line, factor)');
control('COVERS_IN_EVERY_GAME switched off', () => {
  COVERS_IN_EVERY_GAME.enabled = false; return () => { COVERS_IN_EVERY_GAME.enabled = true; };
}, sectionEveryGame);

console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS');
process.exit(failures.length ? 1 : 0);
