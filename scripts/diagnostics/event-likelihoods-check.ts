// ============================================================================
// EVENT LIKELIHOODS (wip/reinsurance-layers) — the Rate Indication's table of
// a single large (T) claim's size at 1 in 10, 20, 50, 100 and 200 years.
//
//   npx tsx scripts/diagnostics/event-likelihoods-check.ts
//
//   1. THE TABLE, RECOMPUTED: from the catalogue written out here — each T
//      event's scaled yearly chance and its T level on the line — with claims
//      spread evenly across the level's range x the growth factor, the size at
//      1 in N is the x where Σ chance x share of range above x = 1/N, solved
//      EXACTLY on the piecewise-linear curve (the page bisects); null where
//      every T event together is rarer than 1 in N.
//   2. ON THE PAGE, IN A GAME: buildRateIndication's table for the year being
//      priced is (1) at the growth factor the claims and the cover prices use
//      — the coming year's: trend since 2027 x the book's growth; a played
//      year's: the factor its cover prices on that page are quoted at — and it
//      is absent when the game's shocks are off.
//
// ⚠ THE CATALOGUE IS WRITTEN OUT HERE, not read: a changed chance, level or
// range fails rather than moving the expectation. Each section has a CONTROL
// that breaks the thing it guards at runtime, requires the section to FAIL,
// and restores it.
// ============================================================================

import { SHOCK_T_CLAIM_RANGE, SHOCK_COST_TREND } from '../../src/data/pricingParameters';
import { eventLikelihoods, RETURN_PERIODS } from '../../src/utils/eventLikelihoods';
import { SHOCK_EVENTS } from '../../src/utils/shockLosses';
import { buildRateIndication } from '../../src/utils/rateIndication';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { exposureFactor } from '../../src/data/exposureTrend';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { seedFromInstanceId } from '../../src/seedHash';
import type { CoverageLine, GameSetupSettings, GameState } from '../../src/types/simulation';

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

// ---- THE CATALOGUE, WRITTEN OUT -------------------------------------------------
// Each line's T events: [scaled yearly chance, claim range $M].
const T_EVENTS: Record<CoverageLine, [number, number, number][]> = {
  WC: [[1 / 144, 6, 40]],                                          // Pandemic, High
  GL: [[5 / 288, 7, 40], [1 / 32, 1, 3], [1 / 144, 3, 7]],         // Nuclear Verdict High, Social Inflation Low, Pandemic Mid
  Property: [[1 / 720, 12, 40], [1 / 24, 2, 5], [7 / 288, 12, 40]], // Earthquake High, Winterstorm Low, Wildfire High
};

/** The size at 1 in n, exactly: walk the piecewise-linear exceedance curve between its breakpoints. */
function exactSize(l: CoverageLine, g: number, n: number): number | null {
  const ev = T_EVENTS[l].map(([p, lo, hi]) => ({ p, lo: lo * g * M, hi: hi * g * M }));
  const at = (x: number) => ev.reduce((s, e) => s + e.p * Math.min(1, Math.max(0, (e.hi - x) / (e.hi - e.lo))), 0);
  const target = 1 / n;
  if (at(0) < target) return null;
  const xs = [...new Set([0, ...ev.flatMap(e => [e.lo, e.hi])])].sort((a, b) => a - b);
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1], fa = at(a), fb = at(b);
    if (fa >= target && fb <= target) return fa === fb ? a : a + (fa - target) / (fa - fb) * (b - a);
  }
  return null;
}
// The lines' trends, written out (SHOCK_COST_TREND is the severity trend).
const TREND: Record<CoverageLine, number> = { WC: 0.04, GL: 0.08, Property: 0.05 };
const sameTable = (got: { years: number; size: number | null }[], l: CoverageLine, g: number, where: string): string[] => {
  const out: string[] = [];
  if (got.map(e => e.years).join(',') !== '10,20,50,100,200') out.push(`${where}: return periods ${got.map(e => e.years)}`);
  for (const e of got) {
    const want = exactSize(l, g, e.years);
    if (want === null ? e.size !== null : e.size === null || Math.abs(e.size - want) > 1) {
      out.push(`${where} ${l} 1 in ${e.years}: ${e.size === null ? '—' : `$${(e.size / M).toFixed(3)}M`}, recomputed ${want === null ? '—' : `$${(want / M).toFixed(3)}M`}`);
    }
  }
  return out;
};

// ---- 1. THE TABLE ----------------------------------------------------------------
function sectionTable(): string[] {
  const out: string[] = [];
  for (const l of LINES) for (const g of [1, 1.17, 1.3605, 1.9]) out.push(...sameTable(eventLikelihoods(l, g), l, g, `growth ${g}`));
  // Not vacuous: a size and a "—" on the page's own lines.
  const gl = eventLikelihoods('GL', 1);
  if (!(gl.some(e => e.size !== null) && gl.some(e => e.size === null))) out.push('GL shows no mix of sizes and "—"');
  return out;
}

// ---- 2. ON THE PAGE, IN A GAME -----------------------------------------------------
const YEARS = 4;
let games: { on: GameState; off: GameState } | null = null;
// Shocks on: a single player game as the app opens it. Off: a hosted game with
// no schedule (shockLosses.gameShocksOn).
function playTo(shocksOff: boolean): GameState {
  const settings = { poolName: 'E', gameLength: 6, startingYear: 2027, instanceId: '7', activeLines: LINES } as GameSetupSettings;
  const { setup, instance } = shocksOff
    ? { setup: { ...settings, shockTiming: 'host' } as GameSetupSettings, instance: generateGameInstance('7', seedFromInstanceId('7'), []) }
    : openSoloInstance(settings);
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1,
    isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory });
  for (let y = 1; y < YEARS; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), [])), currentYearNumber: y + 1 };
  }
  return gs;
}
function sectionPage(): string[] {
  const out: string[] = [];
  games ??= { on: playTo(false), off: playTo(true) };
  const gs = games.on;
  for (const l of LINES) {
    // The coming year: the claims' and charges' factor — trend x the book's growth since year 1.
    const ls = gs.poolState.lines[l];
    const y = gs.currentYearNumber;
    const g = Math.pow(1 + TREND[l], y - 1) * ((ls.bookExposure ?? 0) * exposureFactor(l, y)) / (ls.shockCostBaseExposure ?? NaN);
    const ri = buildRateIndication(gs, l, defaultDecisionSet(y), y);
    if (!ri?.eventLikelihoods) { out.push(`${l} year ${y}: no Event Likelihoods with shocks on`); continue; }
    out.push(...sameTable(ri.eventLikelihoods, l, g, `year ${y} (coming)`));
    // A played year: its cover prices on the page are quoted on its rated book alone, at the trend's growth.
    const py = y - 1;
    const past = buildRateIndication(gs, l, defaultDecisionSet(y), py);
    if (past?.eventLikelihoods) out.push(...sameTable(past.eventLikelihoods, l, Math.pow(1 + TREND[l], py - 1), `year ${py} (played)`));
    else out.push(`${l} year ${py}: no Event Likelihoods on a played year`);
  }
  for (const l of LINES) {
    const off = buildRateIndication(games.off, l, defaultDecisionSet(games.off.currentYearNumber), games.off.currentYearNumber);
    if (off && off.eventLikelihoods !== null) out.push(`${l}: Event Likelihoods shown with shocks off`);
    if (!off) out.push(`${l}: no Rate Indication with shocks off — nothing measured`);
  }
  return out;
}

// ---- run -----------------------------------------------------------------------------
console.log('event-likelihoods-check\n');
check(sectionTable(), '1. the table: each 1 in N size recomputed exactly from the catalogue written out, at four growth factors; "—" where the line\'s T events are rarer');
control('Nuclear Verdict twice as likely', () => {
  const e = SHOCK_EVENTS.find(x => x.name === 'Nuclear Verdict')! as { probability: number }; const o = e.probability; e.probability = o * 2;
  return () => { e.probability = o; };
}, sectionTable);
control('Property\'s High range to $50M', () => {
  const r = SHOCK_T_CLAIM_RANGE.Property as Record<string, readonly number[]>; const o = r.High; r.High = [12e6, 50e6];
  return () => { r.High = o; };
}, sectionTable);
check(sectionPage(), `2. on the Rate Indication in a game (year ${YEARS} coming, ${YEARS - 1} played): the table at the factor its claims and cover prices use; none with shocks off`);
control('the page\'s table read at no growth', () => {
  const t = SHOCK_COST_TREND as Record<string, number>; const o = { ...t }; for (const k of Object.keys(t)) t[k] = 0;
  return () => { Object.assign(t, o); };
}, () => { const g = games; games = null; try { return sectionPage(); } finally { games = g; } });

void RETURN_PERIODS;
console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS');
process.exit(failures.length ? 1 : 0);
