// ============================================================================
// ADVERSE DEVELOPMENT (wip/adverse-development) — the λ draws, the compounding
// on outstanding only, paid untouched and no pre-game development.
//
//   npx tsx scripts/diagnostics/adverse-development-check.ts
//
// ⚠ THE BRIEF'S RANGES ARE WRITTEN OUT HERE, not read from pricingParameters,
// so a changed parameter fails rather than moving the expectation with it.
// Each section is a function returning its problems; each has a CONTROL that
// breaks the thing it guards, asserts the section FAILS, and restores it.
//
// The game: scenario 3, all three lines at different levels (WC High, GL Mid,
// Property Low), no shocks scheduled — so the only development on prior years
// is adverse development (R is 0, reserve inflation is off, the host's
// percentages are retired).
//
// 5. SINGLE PLAYER HAS NONE (SOLO_ADVERSE_DEVELOPMENT off): the solo game the
// app opens stores every line Off, draws no level, and books no adverse
// development in any world in any year, while a Test player game opened the
// same way keeps the levels chosen. Section 1's level draw is what single
// player would use switched on.
// ============================================================================

import {
  ADVERSE_DEVELOPMENT, ADVERSE_DEVELOPMENT_RANGE, RESERVE_INFLATION_PER_YEAR, SOLO_ADVERSE_DEVELOPMENT,
} from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { adverseDevelopmentRate, adverseDevelopmentUniform, drawDevelopmentLevels } from '../../src/utils/adverseDevelopment';
import { developmentBaseOf } from '../../src/utils/hostDevelopment';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { marketSeedOf } from '../../src/utils/bookUnits';
import { seedFromInstanceId } from '../../src/seedHash';
import type { CoverageLine, GameSetupSettings, GameState, LineResultSet, ReserveCohort } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
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

// ---- THE BRIEF -------------------------------------------------------------
const BRIEF: Record<'Low' | 'Mid' | 'High', [number, number]> = { Low: [0.01, 0.05], Mid: [0.05, 0.15], High: [0.15, 0.20] };
const LEVELS: Record<CoverageLine, 'Low' | 'Mid' | 'High'> = { WC: 'High', GL: 'Mid', Property: 'Low' };
const ID = '3', YEARS = 4;

// ---- the game, played once per run of a section ----------------------------
interface Played { pre: LineResultSet[]; years: { before: GameState; perWorld: LineResultSet[][]; after: GameState }[] }
function playGame(): Played {
  const setup = { poolName: 'A', gameLength: 10, startingYear: 2027, instanceId: ID, activeLines: LINES, shockTiming: 'solo',
    developmentLevels: LEVELS } as GameSetupSettings;
  const instance = generateGameInstance(ID, seedFromInstanceId(ID), []);
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory });
  const pre = priorHistory.flatMap(r => LINES.map(l => r.byLine[l]).filter(Boolean));
  const years: Played['years'] = [];
  for (let y = 1; y <= YEARS; y++) {
    const before = gs;
    const played = playWorldsYear(gs, defaultDecisionSet(y));
    const perWorld = played.perWorld.map(p => p.lineResults.map(r => r.result));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
    years.push({ before, perWorld, after: gs });
  }
  return { pre, years };
}
const worldCohorts = (gs: GameState, w: number, l: CoverageLine): ReserveCohort[] =>
  (gs.worlds ? gs.worlds[w].poolState : gs.poolState).lines[l].reserveCohorts;
const gross = (c: ReserveCohort) => (c.grossPaid ?? c.netPaid) + (c.grossUnpaid ?? c.netUnpaid);

// ---- 1. THE λ DRAWS ----------------------------------------------------------
function sectionDraws(): string[] {
  const out: string[] = [];
  for (const level of ['Low', 'Mid', 'High'] as const) {
    const [lo, hi] = BRIEF[level];
    let n = 0, s = 0;
    for (let seed = 1; seed <= 60; seed++) for (const l of LINES) for (let v = 1; v <= 10; v++) for (let a = -6; a < v; a++) {
      const lam = adverseDevelopmentRate(seed, l, level, v, a);
      if (lam < lo || lam > hi) { out.push(`${level} ${l} v${v} a${a}: λ ${lam} outside [${lo}, ${hi}]`); continue; }
      n++; s += lam;
    }
    const mean = s / n, mid = (lo + hi) / 2, se = (hi - lo) / Math.sqrt(12 * n);
    if (Math.abs(mean - mid) > 4 * se) out.push(`${level}: mean λ ${mean.toFixed(5)}, uniform mean ${mid}`);
  }
  // Each (line, valuation year, accident year) its own draw: not one λ for the whole year.
  const u = new Set([1, 2, 3, 4].map(a => adverseDevelopmentUniform(7, 'WC', 5, a)));
  if (u.size !== 4) out.push('accident years share a λ');
  // Single player's levels, were SOLO_ADVERSE_DEVELOPMENT on: each of Low / Mid / High about a third.
  const counts: Record<string, number> = { Low: 0, Mid: 0, High: 0 };
  for (let k = 0; k < 3000; k++) for (const v of Object.values(drawDevelopmentLevels(`s${k}`))) counts[v]++;
  for (const [k, c] of Object.entries(counts)) if (Math.abs(c / 9000 - 1 / 3) > 0.02) out.push(`single player draws ${k} ${(c / 90).toFixed(1)}% of the time`);
  return out;
}

// ---- 2. COMPOUNDING ON OUTSTANDING ONLY, THE SAME IN EVERY WORLD -------------
// Each open prior cohort's gross ultimate rises by EXACTLY its own λ x its gross
// outstanding at the start of the year; the year's total is the sum; the
// current year's cohort gets none in its own year.
let game: Played | null = null;
function sectionCompounding(): string[] {
  const out: string[] = [];
  const g = playGame();
  const seed = marketSeedOf(g.years[0].before.instance);
  for (const [i, yr] of g.years.entries()) {
    const y = i + 1;
    yr.perWorld.forEach((rows, w) => {
      for (const l of LINES) {
        const before = worldCohorts(yr.before, w, l).filter(c => !c.closed);
        const after = new Map(worldCohorts(yr.after, w, l).map(c => [c.yearNumber, c]));
        let want = 0;
        for (const c of before) {
          const added = adverseDevelopmentRate(seed, l, LEVELS[l], y, c.yearNumber) * developmentBaseOf(c);
          want += added;
          const a = after.get(c.yearNumber);
          if (a && Math.abs(gross(a) - (gross(c) + added)) > 1) {
            out.push(`world ${w + 1} ${l} y${y} AY${c.yearNumber}: ultimate ${gross(c).toFixed(0)} -> ${gross(a).toFixed(0)}, expected +${added.toFixed(0)}`);
          }
        }
        const cur = after.get(y);
        const r = rows.find(x => x.line === l)!;
        const booked = r.newLossEngine?.adverseDevelopment ?? 0;
        if (Math.abs(booked - want) > 1) out.push(`world ${w + 1} ${l} y${y}: booked ${booked.toFixed(0)}, λ x outstanding ${want.toFixed(0)}`);
        if (cur && before.some(c => c.yearNumber === y)) out.push(`${l} y${y}: the current year was developed in its own year`);
      }
    });
  }
  game = g;
  return out;
}

// ---- 3. PAID TO DATE IS NEVER RESTATED ---------------------------------------
function sectionPaid(g: Played | null = game): string[] {
  const out: string[] = [];
  if (!g) return ['no game played'];
  for (const yr of g.years) {
    for (const l of LINES) {
      const w = 0;
      const before = new Map(worldCohorts(yr.before, w, l).map(c => [c.yearNumber, c]));
      for (const a of worldCohorts(yr.after, w, l)) {
        const b = before.get(a.yearNumber);
        if (!b) continue;
        if ((a.grossPaid ?? 0) + 1e-6 < (b.grossPaid ?? 0)) out.push(`${l} AY${a.yearNumber}: gross paid fell ${b.grossPaid} -> ${a.grossPaid}`);
      }
      // The ledger's paid series: every earlier valuation unchanged.
      const rowsBefore = new Map((yr.before.poolState.lines[l].reserveDevelopment ?? []).map(r => [r.yearNumber, r]));
      for (const r of yr.after.poolState.lines[l].reserveDevelopment ?? []) {
        const p = rowsBefore.get(r.yearNumber);
        if (!p?.grossPaidByValuation || !r.grossPaidByValuation) continue;
        p.grossPaidByValuation.forEach((v, k) => {
          if (Math.abs((r.grossPaidByValuation![k] ?? NaN) - v) > 1e-6) out.push(`${l} AY${r.yearNumber} valuation ${k}: paid restated ${v} -> ${r.grossPaidByValuation![k]}`);
        });
      }
    }
  }
  return out;
}

// ---- 4. NO DEVELOPMENT IN THE PRE-GAME ---------------------------------------
function sectionPreGame(): string[] {
  const out: string[] = [];
  const g = playGame();
  for (const r of g.pre) {
    const ad = r.newLossEngine?.adverseDevelopment ?? 0, ri = r.newLossEngine?.reserveInflation ?? 0;
    if (ad !== 0 || ri !== 0 || Math.abs(r.priorYearDevelopment ?? 0) > 1e-6) {
      out.push(`pre-game ${r.line} y${r.yearNumber}: adverse ${ad.toFixed(0)}, inflation ${ri.toFixed(0)}, prior-year development ${(r.priorYearDevelopment ?? 0).toFixed(0)}`);
    }
  }
  if (g.pre.length === 0) out.push('no pre-game rows');
  // And nothing struck at the opening to emerge later: the host's lifetime
  // percentage is set on the pre-game cohorts at game start, so it must be 0.
  for (const l of LINES) {
    for (const c of worldCohorts(g.years[0].before, 0, l)) {
      if (Math.abs(c.developmentTotal ?? 0) > 1e-6) out.push(`${l} AY${c.yearNumber}: ${c.developmentTotal!.toFixed(0)} of host development struck at the opening`);
    }
  }
  return out;
}

// ---- 5. SINGLE PLAYER HAS NONE ----------------------------------------------
function playSolo(test: boolean, years: number): { setup: GameSetupSettings; booked: number[] } {
  const settings = { poolName: 'S', gameLength: 10, startingYear: 2027, instanceId: ID, activeLines: LINES,
    ...(test ? { developmentLevels: LEVELS } : {}) } as GameSetupSettings;
  const { setup, instance } = openSoloInstance(settings, test ? { schedule: [] } : undefined);
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory });
  const booked: number[] = [];
  for (let y = 1; y <= years; y++) {
    const played = playWorldsYear(gs, defaultDecisionSet(y));
    // Every world's every line: what adverse development booked this year.
    booked.push(played.perWorld.reduce((a, p) => a + p.lineResults.reduce((b, r) => b + Math.abs(r.result.newLossEngine?.adverseDevelopment ?? 0), 0), 0));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
  }
  return { setup, booked };
}
function sectionSolo(): string[] {
  const out: string[] = [];
  const solo = playSolo(false, 3);
  const lv = solo.setup.developmentLevels ?? {};
  if (JSON.stringify(lv) !== JSON.stringify({ WC: 'Off', GL: 'Off', Property: 'Off' })) out.push(`single player's setup holds ${JSON.stringify(lv)}, not every line Off`);
  solo.booked.forEach((b, i) => { if (b !== 0) out.push(`single player year ${i + 1}: $${b.toFixed(0)} of adverse development booked across the worlds`); });
  const test = playSolo(true, 2);
  if (JSON.stringify(test.setup.developmentLevels) !== JSON.stringify(LEVELS)) out.push(`Test player's setup holds ${JSON.stringify(test.setup.developmentLevels)}, not the levels chosen`);
  if (!(test.booked[0] > 0)) out.push('Test player books no adverse development — nothing measured');
  return out;
}

// ---- run -------------------------------------------------------------------
console.log('adverse-development-check\n');
check(sectionDraws(), '1. λ: uniform within the brief\'s range per level, one draw per line, valuation and accident year; levels a third each');
control('the Mid range changed', () => { const r = ADVERSE_DEVELOPMENT_RANGE as Record<string, readonly number[]>; const o = r.Mid; r.Mid = [0.05, 0.25]; return () => { r.Mid = o; }; }, sectionDraws);
check(sectionCompounding(), '2. each open prior year rises by its own λ x its outstanding at the start of the year, in every world; the current year none');
control('reserve inflation left on', () => { const r = RESERVE_INFLATION_PER_YEAR as Record<string, number>; const o = r.WC; r.WC = 0.04; return () => { r.WC = o; }; }, sectionCompounding);
check(sectionPaid(), '3. paid to date is never restated');
control('a restated paid', () => {
  const g = game!; const rows = g.years[1].after.poolState.lines.WC.reserveDevelopment ?? [];
  const row = rows.find(r => (r.grossPaidByValuation?.length ?? 0) > 1)!; const o = row.grossPaidByValuation![0];
  row.grossPaidByValuation![0] = o + 1000; return () => { row.grossPaidByValuation![0] = o; };
}, () => sectionPaid(game));
check(sectionPreGame(), '4. no development in the pre-game years');
control('reserve inflation left on, in the pre-game', () => { const r = RESERVE_INFLATION_PER_YEAR as Record<string, number>; const o = r.GL; r.GL = 0.08; return () => { r.GL = o; }; }, sectionPreGame);
control('the host\'s percentages back on', () => { const o = ADVERSE_DEVELOPMENT.enabled; ADVERSE_DEVELOPMENT.enabled = false; return () => { ADVERSE_DEVELOPMENT.enabled = o; }; }, sectionPreGame);

check(sectionSolo(), '5. single player has none: every line Off, no level drawn, nothing booked in any world; Test player keeps its levels and develops');
control('single player\'s adverse development switched on', () => { const o = SOLO_ADVERSE_DEVELOPMENT.enabled; SOLO_ADVERSE_DEVELOPMENT.enabled = true; return () => { SOLO_ADVERSE_DEVELOPMENT.enabled = o; }; }, sectionSolo);

console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS');
process.exit(failures.length ? 1 : 0);
