// ============================================================================
// DEVELOPMENT PRICING (wip/development-pricing) — the pre-game develops at the
// game's level, pricing learns the pool's own development, Test player is a
// hosted team, and single player is untouched.
//
//   npx tsx scripts/diagnostics/development-pricing-check.ts
//
// Each section is a function returning its problems; each has a CONTROL that
// breaks the thing it guards, asserts the section FAILS, and restores it.
//
// 1. LEARNED FACTORS: a hosted team at Mid, three played years. For the year
//    being priced, each line's age-to-age factors are recounted here from the
//    ledger by the rule written out below — each accident year's estimated
//    ultimate (ground-up paid x the recorded paid factor at its age) at each
//    year-end, its growth to the next, both year-ends at or before the latest
//    data year (the one-year lag), the pre-game's included, averaged by age —
//    and pricing's must match, factor for factor, with the same observations.
//    Every window year's development to come is the product of those factors
//    from its age to the pattern's last, 1 where an age has none.
//    Controls: a learner that reads one year past the lag; one that drops the
//    pre-game's years.
// 2. THE PRE-GAME DEVELOPS: every pre-game year after the first books adverse
//    development on every line, at Mid. Control: the pre-game switch off.
// 3. SINGLE PLAYER IS UNCHANGED: a single player game — pre-game, opening and
//    two played years — is byte-identical with both switches off. Control: the
//    same game with a level forced on.
// 4. TEST PLAYER IS A HOSTED TEAM: on the same seed, levels and schedule —
//    empty, and drawn — the Test player game and the hosted team match byte for
//    byte on the pre-game, the opening and two played years. Control: Test
//    player on the old 'solo' timing, which differs on the empty schedule.
// ============================================================================

import { buildTeamGame } from '../../src/session/client/buildGame';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { drawShockSchedule, SOLO_SHOCK_STREAM } from '../../src/utils/shockSchedule';
import { bookPurePremium, learnedDevelopmentFactors, type LearnedFactor } from '../../src/utils/newPurePremium';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { PAID_DEVELOPMENT_PATTERN } from '../../src/data/paidDevelopmentPatterns';
import { LEARNED_DEVELOPMENT, PRE_GAME_ADVERSE_DEVELOPMENT } from '../../src/data/pricingParameters';
import type { CoverageLine, GameSetupSettings, GameState, ReserveDevelopmentRow } from '../../src/types/simulation';
import type { ScheduledShock } from '../../src/types/shocks';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const MID = { WC: 'Mid', GL: 'Mid', Property: 'Mid' } as const;
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

const play = (gs: GameState, years: number, shocks: boolean): GameState => {
  for (let y = 1; y <= years; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y, shocks)), gs.setup.activeLines)),
      currentYearNumber: y + 1 };
  }
  return gs;
};
const hosted = (seed: string, schedule: ScheduledShock[], levels: Record<CoverageLine, string>) =>
  buildTeamGame({ seed, yearCount: 5, startingYear: 2027, eventName: 'E', poolName: 'P', shocks: schedule,
    priorDevelopment: undefined, developmentLevels: levels } as never, LINES).gameState;
const opened = (setup: GameSetupSettings, instance: GameState['instance']): GameState => {
  const pre = runPriorHistory(instance, setup);
  return openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState: pre.poolState,
    lockedResults: [], currentDecisions: defaultDecisionSet(1, gameShocksOn(setup, instance)),
    priorHistory: pre.priorHistory, earlyPreGameHistory: pre.earlyPreGameHistory });
};
const bytes = (gs: GameState) => JSON.stringify({ p: gs.priorHistory, e: gs.earlyPreGameHistory, r: gs.lockedResults, s: gs.poolState },
  (k, v) => (k === 'setup' || k === 'instance' ? undefined : v));

// ---- 1. LEARNED FACTORS ----------------------------------------------------
// THE RULE, WRITTEN OUT: the recorded paid factor at an age, the last one past
// the pattern's end; the latest data year two before the year priced.
const paidFactor = (line: CoverageLine, ageMonths: number) => {
  const rows = PAID_DEVELOPMENT_PATTERN[line];
  return (rows.find(r => r.ageMonths === ageMonths) ?? rows[rows.length - 1]).ldf;
};
function recount(line: CoverageLine, rows: ReserveDevelopmentRow[], priced: number): Map<number, number[]> {
  const latest = priced - 2;
  const by = new Map<number, number[]>();
  for (const r of rows) {
    const paid = r.grossPaidByValuation ?? [];
    for (let k = 0; k + 1 < paid.length; k++) {
      if (r.firstValuationYear + k + 1 > latest) break;
      const age = (r.ageAtFirstValuation ?? 0) + k;
      const from = paid[k] * paidFactor(line, (age + 1) * 12);
      if (!(from > 0)) continue;
      by.set(age, [...(by.get(age) ?? []), paid[k + 1] * paidFactor(line, (age + 2) * 12) / from]);
    }
  }
  return by;
}
let learner: (line: CoverageLine, rows: ReserveDevelopmentRow[], priced: number) => LearnedFactor[] = learnedDevelopmentFactors;
const H = play(hosted('3', [], MID), 3, false);
const PRICED = H.currentYearNumber;
function learnedFactors(): string[] {
  const out: string[] = [];
  for (const line of LINES) {
    const rows = H.poolState.lines[line].reserveDevelopment ?? [];
    const want = recount(line, rows, PRICED);
    const got = learner(line, rows, PRICED);
    if (got.length !== want.size) out.push(`${line}: ${got.length} ages learned, ${want.size} in the recount`);
    for (const f of got) {
      const xs = want.get(f.age);
      if (!xs) { out.push(`${line} age ${f.age}: learned, not in the recount`); continue; }
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      if (Math.abs(f.factor - mean) > 1e-12 || f.observations !== xs.length) {
        out.push(`${line} age ${f.age}: ${f.factor.toFixed(6)} on ${f.observations}, recount ${mean.toFixed(6)} on ${xs.length}`);
      }
    }
    // The pre-game's years are in it: transitions whose later year-end is in the pre-game, developing at Mid.
    let preGame = 0;
    for (const r of rows) {
      const paid = r.grossPaidByValuation ?? [];
      for (let k = 0; k + 1 < paid.length && r.firstValuationYear + k + 1 <= 0; k++) {
        const age = (r.ageAtFirstValuation ?? 0) + k;
        const from = paid[k] * paidFactor(line, (age + 1) * 12);
        if (from > 0 && paid[k + 1] * paidFactor(line, (age + 2) * 12) / from > 1 + 1e-9) preGame++;
      }
    }
    if (preGame === 0) out.push(`${line}: no pre-game transition shows development`);
    // The window's development to come: the product of the factors from each year's age to the pattern's last.
    const lastAge = Math.round(PAID_DEVELOPMENT_PATTERN[line][PAID_DEVELOPMENT_PATTERN[line].length - 1].ageMonths / 12) - 1;
    const pp = bookPurePremium(line, PRICED, { rows, allMarketMembers: [], membershipHistory: {}, learnDevelopment: true },
      H.poolState.lines[line].bookExposure ?? 1);
    for (const p of pp.points) {
      const age = p.ageMonths / 12 - 1;
      let toCome = 1;
      for (let a = age; a < lastAge; a++) {
        const xs = want.get(a);
        toCome *= xs ? xs.reduce((s, x) => s + x, 0) / xs.length : 1;
      }
      if (Math.abs((p.learnedDevelopment ?? NaN) / toCome - 1) > 1e-12) {
        out.push(`${line} AY ${p.accidentYear}: development to come ${p.learnedDevelopment} against ${toCome}`);
      }
    }
    if (!(pp.learned && pp.learned.windowFactor > 1)) out.push(`${line}: the window carries no learned development at Mid`);
  }
  return out;
}

// ---- 2. THE PRE-GAME DEVELOPS ----------------------------------------------
function preGameDevelops(): string[] {
  const out: string[] = [];
  const gs = hosted('3', [], MID);
  const pre = [...(gs.earlyPreGameHistory ?? []), ...gs.priorHistory].sort((a, b) => a.yearNumber - b.yearNumber);
  for (const line of LINES) {
    for (const r of pre.slice(1)) {
      const dev = r.byLine[line]?.newLossEngine?.adverseDevelopment ?? 0;
      if (!(dev > 0)) out.push(`${line} pre-game year ${r.yearNumber}: no adverse development booked`);
    }
  }
  return out;
}

// ---- 3. SINGLE PLAYER IS UNCHANGED -----------------------------------------
let soloLevels: Record<CoverageLine, string> | undefined;
const solo = () => {
  const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: 5, startingYear: 2027, instanceId: '3', activeLines: LINES,
    ...(soloLevels ? { developmentLevels: soloLevels } : {}) } as GameSetupSettings);
  return bytes(play(opened(setup, instance), 2, gameShocksOn(setup, instance)));
};
function singlePlayer(): string[] {
  const on = solo();
  LEARNED_DEVELOPMENT.enabled = false; PRE_GAME_ADVERSE_DEVELOPMENT.enabled = false;
  let off: string;
  // Plain single player, switches off: what the game was before this build.
  const forced = soloLevels;
  try { soloLevels = undefined; off = solo(); } finally { soloLevels = forced; LEARNED_DEVELOPMENT.enabled = true; PRE_GAME_ADVERSE_DEVELOPMENT.enabled = true; }
  return on === off ? [] : ['single player differs with the switches off'];
}

// ---- 4. TEST PLAYER IS A HOSTED TEAM ---------------------------------------
let testTiming: 'host' | 'solo' | undefined;
function testIsHosted(): string[] {
  const out: string[] = [];
  for (const [name, schedule] of [['empty', []], ['drawn', drawShockSchedule('3', 5, SOLO_SHOCK_STREAM)]] as const) {
    const h = hosted('3', [...schedule], MID);
    const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: 5, startingYear: 2027, instanceId: '3', activeLines: LINES,
      developmentLevels: MID } as GameSetupSettings, { schedule: [...schedule] });
    const s = testTiming ? { ...setup, shockTiming: testTiming } : setup;
    const shocks = gameShocksOn(h.setup, h.instance);
    if (bytes(play(h, 2, shocks)) !== bytes(play(opened(s, instance), 2, shocks))) out.push(`schedule ${name}: the two games differ`);
  }
  return out;
}

console.log('DEVELOPMENT PRICING — scenario 3, three lines');
console.log('\n1. LEARNED FACTORS');
check(learnedFactors(), 'pricing learns each age\'s factor from every year-end it may see, and develops each window year by them');
control('a learner reading one year past the lag', () => { const was = learner; learner = (l, r, p) => learnedDevelopmentFactors(l, r, p + 1); return () => { learner = was; }; }, learnedFactors);
control('a learner that drops the pre-game', () => {
  const was = learner;
  learner = (l, r, p) => learnedDevelopmentFactors(l, r.map(row => {
    const k = Math.max(0, 1 - row.firstValuationYear);
    return { ...row, firstValuationYear: row.firstValuationYear + k, ageAtFirstValuation: (row.ageAtFirstValuation ?? 0) + k,
      grossPaidByValuation: (row.grossPaidByValuation ?? []).slice(k) };
  }), p);
  return () => { learner = was; };
}, learnedFactors);
console.log('\n2. THE PRE-GAME DEVELOPS');
check(preGameDevelops(), 'every pre-game year after the first books adverse development on every line, at Mid');
control('the pre-game switch off', () => { PRE_GAME_ADVERSE_DEVELOPMENT.enabled = false; return () => { PRE_GAME_ADVERSE_DEVELOPMENT.enabled = true; }; }, preGameDevelops);
console.log('\n3. SINGLE PLAYER IS UNCHANGED');
check(singlePlayer(), 'single player is byte-identical with both switches off: pre-game, opening, two played years');
control('single player with a level forced on', () => { soloLevels = MID; return () => { soloLevels = undefined; }; }, singlePlayer);
console.log('\n4. TEST PLAYER IS A HOSTED TEAM');
check(testIsHosted(), 'Test player and a hosted team on the same seed, levels and schedule are byte-identical, empty schedule and drawn');
control('Test player on the old solo timing', () => { testTiming = 'solo'; return () => { testTiming = undefined; }; }, testIsHosted);

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — the pre-game develops, pricing learns the pool\'s own development, Test player is a hosted team, single player is untouched.');
