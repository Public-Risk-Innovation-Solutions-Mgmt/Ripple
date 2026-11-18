// ============================================================================
// LEGISLATION CHANGE AND WORKERS COMP LEGISLATION — the one-time claim, the
// development step and its cap (pr/legislation-step).
//
//   npx tsx scripts/diagnostics/event-development-step-check.ts
//
// The design, written out here and NOT read from pricingParameters (a check
// that read its expectation from the parameter it grades passes whatever the
// parameter says):
//
//   ONE-TIME, IN THE EVENT YEAR — Legislation Change (#4): one High GL large
//     claim, uniform on $7–40M (year-1 dollars), and no GL surge. WC Reform /
//     Workers Comp Legislation (#5): its WC surge (High, 35–75%), no claim.
//   CONTINUOUS, EVENT YEAR TO THE END OF THE GAME — the line's development
//     rate is 2 points higher (GL for #4, WC for #5), every year, undecayed;
//     steps on one line add, capped at 3 points; no fading R any more.
//   UNPRICED — the same game with and without the events strikes the same
//     rates, every line, every year.
//
// Sections:
//   1. the map: the two rows changed, every other row the R model's, and the
//      R model's own rows kept as supplied;
//   2. one-time, through resolveShockYear: the claim, its size, no surge, the
//      WC surge, nothing after the event year;
//   3. the step: 0 before the event year, exactly +2 points from it to year
//      12 on the event's line only, attributed to the firing — in force or
//      past its duration;
//   4. the cap: two firings on a line 2 then 3, three still 3, the second
//      firing credited the remaining point, lines never pooled;
//   5. through the engine: one game played, λ fixed at 3 points (Low) and 6
//      (Mid, an Edit game's level from year 4): the step's dollars are exactly
//      2/3 then 2/6 of λ's on the same base, every year from the event on;
//      the claim lands once, in year 2;
//   6. unpriced: the game with both events and without strikes identical
//      rates and pure premiums, every line, every year.
//
// Each section has a CONTROL that breaks what it guards at runtime, asserts
// the section now FAILS, and restores it (SESSION_PRACTICES.md §2).
// ============================================================================

import {
  ADVERSE_DEVELOPMENT_RANGE, EVENT_DEVELOPMENT_STEP, GAME_SHOCK_MAP, R_MODEL, SHOCK_FREE_PRICING, WORLD_COUNT,
} from '../../src/data/pricingParameters';
import { aShare, eventLines, firingsStartingIn, resolveShockYear, SHOCK_EVENTS } from '../../src/utils/shockLosses';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { seedFromInstanceId } from '../../src/seedHash';
import type { ScheduledShock } from '../../src/types/shocks';
import type { CoverageLine, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const M = 1e6;
const failures: string[] = [];
const check = (problems: string[], label: string, detail = '') => {
  if (problems.length) failures.push(label);
  console.log(`  ${problems.length ? 'FAIL' : 'OK  '}  ${label}${detail ? `  — ${detail}` : ''}`);
  for (const p of problems.slice(0, 6)) console.log(`          ${p}`);
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
const instanceWith = (id: string, schedule: ScheduledShock[]) => generateGameInstance(id, seedFromInstanceId(id), schedule);

// ---- THE DESIGN, WRITTEN OUT ------------------------------------------------
const STEP = 0.02, CAP = 0.03, LAST_YEAR = 12;
const GL_T_HIGH: [number, number] = [7 * M, 40 * M];
const WC_A_HIGH: [number, number] = [0.35, 0.75];
// Event -> line -> [A, T, R], 'None' none: the game's two changed rows.
const DESIGN: Record<string, [CoverageLine, string, string, string]> = {
  'Legislation': ['GL', 'None', 'High', 'None'],
  'WC Reform': ['WC', 'High', 'None', 'None'],
};
// The R model's rows for them, kept as supplied in R_MODEL.shockMap.
const R_MODEL_ROWS: Record<string, string[]> = {
  'Legislation': ['Legislation', 'GL', 'Mid', 'None', 'High'],
  'WC Reform': ['WC Reform', 'WC', 'High', 'None', 'Mid'],
};
const STEPPED: Record<string, CoverageLine> = { 'Legislation': 'GL', 'WC Reform': 'WC' };
const LEG = '#4', WCR = '#5';

// ---- 1. THE MAP --------------------------------------------------------------
function sectionMap(): string[] {
  const out: string[] = [];
  const rm = R_MODEL.shockMap as unknown as string[][];
  for (const [name, row] of Object.entries(R_MODEL_ROWS)) {
    const got = rm.filter(r => r[0] === name);
    if (got.length !== 1 || got[0].join('|') !== row.join('|')) out.push(`R_MODEL.shockMap's ${name} row is ${got.map(r => r.join('/')).join(' + ')}, supplied ${row.join('/')}`);
  }
  for (const e of SHOCK_EVENTS) {
    const rows = eventLines(e.name).map(r => [r.line, r.a, r.t, r.r].join('/'));
    const want = DESIGN[e.name]
      ? [DESIGN[e.name].join('/')]
      : rm.filter(r => r[0] === e.name).map(r => r.slice(1).join('/'));
    if (rows.join(' + ') !== want.join(' + ')) out.push(`${e.name}: the game's map reads ${rows.join(' + ') || 'nothing'}, wanted ${want.join(' + ') || 'nothing'}`);
  }
  return out;
}

// ---- 2. ONE-TIME ---------------------------------------------------------------
function sectionOneTime(): string[] {
  const out: string[] = [];
  // Legislation Change in year 2: one High GL claim, no surge, nothing after.
  const leg = instanceWith('7', [{ shockId: LEG, yearNumber: 2 }]);
  const f = firingsStartingIn(leg, 'host', 2)[0];
  for (let y = 1; y <= 6; y++) {
    const sy = resolveShockYear(leg, 'host', y);
    for (const l of LINES) {
      if (sy.byLine[l].uplift !== 0) out.push(`Legislation year ${y} ${l}: surge ${sy.byLine[l].uplift}, wanted none`);
      const n = sy.byLine[l].arrivals.length, want = l === 'GL' && y === 2 ? 1 : 0;
      if (n !== want) out.push(`Legislation year ${y} ${l}: ${n} large claim(s), wanted ${want}`);
    }
  }
  const t = resolveShockYear(leg, 'host', 2).byLine.GL.arrivals[0];
  if (t) {
    const want = GL_T_HIGH[0] + f.draws.GL.t * (GL_T_HIGH[1] - GL_T_HIGH[0]);
    if (t.level !== 'High') out.push(`Legislation's claim is ${t.level}, wanted High`);
    if (!near(t.size, want)) out.push(`Legislation's claim $${(t.size / M).toFixed(2)}M, the draw on $7–40M is $${(want / M).toFixed(2)}M`);
  }
  // WC Reform in year 2: the WC surge in year 2 only, no claim.
  const wr = instanceWith('7', [{ shockId: WCR, yearNumber: 2 }]);
  const fw = firingsStartingIn(wr, 'host', 2)[0];
  for (let y = 1; y <= 6; y++) {
    const sy = resolveShockYear(wr, 'host', y);
    for (const l of LINES) {
      const want = l === 'WC' && y === 2 ? WC_A_HIGH[0] + fw.draws.WC.a * (WC_A_HIGH[1] - WC_A_HIGH[0]) : 0;
      if (!near(sy.byLine[l].uplift, want)) out.push(`WC Reform year ${y} ${l}: surge ${sy.byLine[l].uplift}, wanted ${want}`);
      if (sy.byLine[l].arrivals.length) out.push(`WC Reform year ${y} ${l}: a large claim`);
    }
  }
  if (!near(aShare('WC', 'High', 0.5), 0.55)) out.push(`WC High surge mid-draw ${aShare('WC', 'High', 0.5)}, wanted 0.55`);
  return out;
}

// ---- 3. THE STEP ---------------------------------------------------------------
/** Each line's rate and its firings' shares, by year, for a schedule. */
const rates = (id: string, schedule: ScheduledShock[]) => {
  const inst = instanceWith(id, schedule);
  return Array.from({ length: LAST_YEAR }, (_, i) => resolveShockYear(inst, 'host', i + 1));
};
function sectionStep(): string[] {
  const out: string[] = [];
  for (const [id, name] of [[LEG, 'Legislation'], [WCR, 'WC Reform']] as const) {
    for (const fired of [2, 5]) {
      const ys = rates('7', [{ shockId: id, yearNumber: fired }]);
      ys.forEach((sy, i) => {
        const y = i + 1;
        for (const l of LINES) {
          const want = l === STEPPED[name] && y >= fired ? STEP : 0;
          if (!near(sy.byLine[l].rRate, want)) out.push(`${name} fired in year ${fired}, year ${y} ${l}: rate ${sy.byLine[l].rRate.toFixed(4)}, wanted ${want}`);
          // Attributed to the firing, in force or not.
          const credited = sy.byLine[l].byFiring.filter(b => b.firing.event.id === id).reduce((s, b) => s + b.rRate, 0);
          if (!near(credited, want)) out.push(`${name} fired in year ${fired}, year ${y} ${l}: ${credited.toFixed(4)} credited to the firing, wanted ${want}`);
        }
      });
    }
  }
  // A game with neither: no rate on any line, any year (the other R events are not stepped).
  const none = rates('7', [{ shockId: '#6', yearNumber: 2 }, { shockId: '#1', yearNumber: 3 }]);
  none.forEach((sy, i) => LINES.forEach(l => {
    if (sy.byLine[l].rRate !== 0) out.push(`Recession + Earthquake, year ${i + 1} ${l}: rate ${sy.byLine[l].rRate}, wanted 0`);
  }));
  return out;
}

// ---- 4. THE CAP ----------------------------------------------------------------
function sectionCap(): string[] {
  const out: string[] = [];
  const cases: { label: string; sched: ScheduledShock[]; want: (y: number, l: CoverageLine) => number }[] = [
    { label: 'Legislation in years 2 and 4', sched: [{ shockId: LEG, yearNumber: 2 }, { shockId: LEG, yearNumber: 4 }],
      want: (y, l) => (l !== 'GL' ? 0 : y >= 4 ? CAP : y >= 2 ? STEP : 0) },
    { label: 'Legislation twice in year 3', sched: [{ shockId: LEG, yearNumber: 3 }, { shockId: LEG, yearNumber: 3 }],
      want: (y, l) => (l === 'GL' && y >= 3 ? CAP : 0) },
    { label: 'Legislation in years 2, 3 and 4', sched: [2, 3, 4].map(yearNumber => ({ shockId: LEG, yearNumber })),
      want: (y, l) => (l !== 'GL' ? 0 : y >= 3 ? CAP : y >= 2 ? STEP : 0) },
    { label: 'WC Reform in years 2 and 6', sched: [{ shockId: WCR, yearNumber: 2 }, { shockId: WCR, yearNumber: 6 }],
      want: (y, l) => (l !== 'WC' ? 0 : y >= 6 ? CAP : y >= 2 ? STEP : 0) },
    { label: 'Legislation and WC Reform in year 2 (two lines, no pooling)', sched: [{ shockId: LEG, yearNumber: 2 }, { shockId: WCR, yearNumber: 2 }],
      want: (y, l) => (l !== 'Property' && y >= 2 ? STEP : 0) },
  ];
  for (const c of cases) {
    rates('7', c.sched).forEach((sy, i) => LINES.forEach(l => {
      const w = c.want(i + 1, l);
      if (!near(sy.byLine[l].rRate, w)) out.push(`${c.label}, year ${i + 1} ${l}: rate ${sy.byLine[l].rRate.toFixed(4)}, wanted ${w}`);
      const credited = sy.byLine[l].byFiring.reduce((s, b) => s + b.rRate, 0);
      if (!near(credited, sy.byLine[l].rRate)) out.push(`${c.label}, year ${i + 1} ${l}: firings credited ${credited.toFixed(4)} of ${sy.byLine[l].rRate.toFixed(4)}`);
    }));
  }
  // Oldest first: in year 8 the year-2 firing carries its 2 points, the year-4 one the remaining 1.
  const y8 = rates('7', cases[0].sched)[7].byLine.GL.byFiring;
  const share = (fy: number) => y8.filter(b => b.firing.firedYear === fy).reduce((s, b) => s + b.rRate, 0);
  if (!near(share(2), STEP) || !near(share(4), CAP - STEP)) out.push(`year 8: the year-2 firing credited ${share(2)}, the year-4 ${share(4)}; wanted ${STEP} and ${CAP - STEP}`);
  return out;
}

// ---- 5. THROUGH THE ENGINE ----------------------------------------------------
// λ fixed (Low 3 points, Mid 6) so the base is read off adverse development:
// the step's dollars (rDevelopment) are exactly STEP/λ of λ's (adverseDevelopment),
// prior year by prior year, on the same base. GL Low throughout; an Edit game's
// level Mid from year 4.
const LAMBDA = { Low: 0.03, Mid: 0.06 };
interface EngineYear { rRate: number; rDev: number; adverse: number; shockLarge: number; claims: number; uplift: number }
function engineGame(schedule: ScheduledShock[], years = 6): EngineYear[] {
  const id = 'STEP';
  const setup = {
    poolName: 'S', gameLength: 10, startingYear: 2026, instanceId: id, activeLines: ['GL'], shockTiming: 'host',
    developmentLevels: { GL: 'Low' }, developmentLevelsByYear: { '4': { GL: 'Mid' }, '5': { GL: 'Mid' }, '6': { GL: 'Mid' } },
  } as unknown as GameSetupSettings;
  const instance = instanceWith(id, schedule);
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  let gs = { setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory } as GameState;
  const out: EngineYear[] = [];
  for (let y = 1; y <= years; y++) {
    const r = processYear(gs, defaultDecisionSet(y));
    const n = r.result.byLine.GL!.newLossEngine!;
    out.push({ rRate: n.rRate, rDev: n.rDevelopment, adverse: n.adverseDevelopment ?? 0, shockLarge: n.shockLarge, claims: n.shockLargeClaims, uplift: n.uplift });
    gs = { ...gs, currentYearNumber: y + 1, poolState: r.updatedPoolState, lockedResults: [...gs.lockedResults, r.result] };
  }
  return out;
}
function withFixedLambda<T>(f: () => T): T {
  const R = ADVERSE_DEVELOPMENT_RANGE as unknown as Record<string, [number, number]>;
  const o = { Low: R.Low, Mid: R.Mid };
  R.Low = [LAMBDA.Low, LAMBDA.Low]; R.Mid = [LAMBDA.Mid, LAMBDA.Mid];
  try { return f(); } finally { R.Low = o.Low; R.Mid = o.Mid; }
}
function sectionEngine(): string[] {
  const out: string[] = [];
  const g = withFixedLambda(() => engineGame([{ shockId: LEG, yearNumber: 2 }]));
  const plain = withFixedLambda(() => engineGame([]));
  g.forEach((r, i) => {
    const y = i + 1, lambda = y >= 4 ? LAMBDA.Mid : LAMBDA.Low;
    if (!(r.adverse > 0)) { out.push(`year ${y}: no adverse development to read the base from`); return; }
    const want = y >= 2 ? STEP / lambda : 0;
    if (!near(r.rDev / r.adverse, want, 1e-6)) out.push(`year ${y}: step dollars ${(r.rDev / M).toFixed(3)}M are ${(r.rDev / r.adverse).toFixed(4)} of λ's ${(r.adverse / M).toFixed(3)}M, wanted ${want.toFixed(4)}`);
    if (!near(r.rRate, y >= 2 ? STEP : 0)) out.push(`year ${y}: the record's rate ${r.rRate}, wanted ${y >= 2 ? STEP : 0}`);
    if (r.claims !== (y === 2 ? 1 : 0)) out.push(`year ${y}: ${r.claims} event claim(s), wanted ${y === 2 ? 1 : 0}`);
    if (y === 2 && !(r.shockLarge >= GL_T_HIGH[0])) out.push(`year 2: the event claim $${(r.shockLarge / M).toFixed(2)}M, below $7M`);
    if (r.uplift !== 0) out.push(`year ${y}: GL surge ${r.uplift}, wanted none`);
  });
  // The plain game: no step dollars, and λ's alone in year 2 (same base: the claim is year 2's own).
  plain.forEach((r, i) => { if (r.rDev !== 0) out.push(`no events, year ${i + 1}: step dollars ${r.rDev}`); });
  if (!near(g[1].adverse, plain[1].adverse, 1e-9)) out.push(`year 2: λ's dollars ${g[1].adverse} with the event, ${plain[1].adverse} without — the level must be untouched`);
  return out;
}

// ---- 6. UNPRICED -------------------------------------------------------------
const PRICED_SCHEDULE: ScheduledShock[] = [{ shockId: LEG, yearNumber: 2 }, { shockId: WCR, yearNumber: 3 }];
const PRICED_YEARS = 7;
function struckRates(schedule: ScheduledShock[]): Record<CoverageLine, [number, number]>[] {
  const id = '5';
  const setup = { poolName: 'S', gameLength: 10, startingYear: 2026, instanceId: id, activeLines: LINES, shockTiming: 'host',
    developmentLevels: { WC: 'Low', GL: 'Low', Property: 'Low' } } as unknown as GameSetupSettings;
  const instance = instanceWith(id, schedule);
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory });
  const out: Record<CoverageLine, [number, number]>[] = [];
  for (let y = 1; y <= PRICED_YEARS; y++) {
    const played = playWorldsYear(gs, defaultDecisionSet(y));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
    const row = gs.lockedResults[gs.lockedResults.length - 1];
    out.push(Object.fromEntries(LINES.map(l => {
      const r = row.byLine[l] as LineResultSet;
      return [l, [r.finalRatePer100 ?? NaN, r.newPurePremiumPer100 ?? NaN]];
    })) as Record<CoverageLine, [number, number]>);
  }
  return out;
}
let pricedPlain: ReturnType<typeof struckRates> | null = null;
function sectionUnpriced(): string[] {
  const out: string[] = [];
  pricedPlain ??= struckRates([]);
  const shocked = struckRates(PRICED_SCHEDULE);
  shocked.forEach((r, i) => LINES.forEach(l => {
    const [rate, pp] = r[l], [rate0, pp0] = pricedPlain![i][l];
    if (!Number.isFinite(rate) || !Number.isFinite(pp)) out.push(`year ${i + 1} ${l}: no rate on the row`);
    else if (rate !== rate0 || pp !== pp0) out.push(`year ${i + 1} ${l}: rate ${rate.toFixed(6)} / pure premium ${pp.toFixed(6)} with the events, ${rate0.toFixed(6)} / ${pp0.toFixed(6)} without`);
  }));
  return out;
}

// ---- run -------------------------------------------------------------------
const mutableMap = GAME_SHOCK_MAP as unknown as string[][];
const swapRow = (name: string, row: string[]) => () => {
  const i = mutableMap.findIndex(r => r[0] === name); const o = mutableMap[i];
  mutableMap[i] = row; return () => { mutableMap[i] = o; };
};
const setStep = (k: 'step' | 'cap' | 'enabled', v: number | boolean) => () => {
  const s = EVENT_DEVELOPMENT_STEP as unknown as Record<string, unknown>; const o = s[k];
  s[k] = v; return () => { s[k] = o; };
};
const setLines = (lines: Record<string, string[]>) => () => {
  const s = EVENT_DEVELOPMENT_STEP as unknown as { lines: Record<string, string[]> }; const o = s.lines;
  s.lines = lines; return () => { s.lines = o; };
};

console.log(`event-development-step-check (${WORLD_COUNT} worlds)\n`);
check(sectionMap(), '1. the map: Legislation GL –/High/–, WC Reform WC High/–/–, every other row and the R model\'s own as supplied');
control('Legislation\'s row back to the R model\'s (GL Mid/–/High)', swapRow('Legislation', R_MODEL_ROWS['Legislation']), sectionMap);
control('WC Reform keeps its R (WC High/–/Mid)', swapRow('WC Reform', R_MODEL_ROWS['WC Reform']), sectionMap);
check(sectionOneTime(), '2. one-time: Legislation one GL claim on $7–40M and no surge, WC Reform its WC surge and no claim, in the event year only');
control('Legislation keeps its surge, no claim', swapRow('Legislation', ['Legislation', 'GL', 'Mid', 'None', 'None']), sectionOneTime);
control('Legislation\'s claim at Mid ($3–7M)', swapRow('Legislation', ['Legislation', 'GL', 'None', 'Mid', 'None']), sectionOneTime);
control('WC Reform loses its surge', swapRow('WC Reform', ['WC Reform', 'WC', 'None', 'None', 'None']), sectionOneTime);
check(sectionStep(), '3. the step: +2 points on the event\'s line from the event year to year 12, undecayed, credited to the firing');
control('step at 3 points', setStep('step', 0.03), sectionStep);
control('step off', setStep('enabled', false), sectionStep);
control('Legislation steps WC, not GL', setLines({ Legislation: ['WC'], 'WC Reform': ['WC'] }), sectionStep);
control('the fading R back (Legislation R High)', swapRow('Legislation', ['Legislation', 'GL', 'None', 'High', 'High']), sectionStep);
control('Recession steps too', setLines({ Legislation: ['GL'], 'WC Reform': ['WC'], Recession: ['GL'] }), sectionStep);
check(sectionCap(), '4. the cap: steps on a line add to at most 3 points, oldest firing first, lines never pooled');
control('no cap', setStep('cap', Infinity), sectionCap);
control('cap at 4 points', setStep('cap', 0.04), sectionCap);
control('cap at 2 points', setStep('cap', 0.02), sectionCap);
check(sectionEngine(), '5. through the engine: the step\'s dollars are 2 points on λ\'s base every year from the event, on top of the year\'s level (Low, then Mid by edit); one claim, in year 2');
control('step at 1 point', setStep('step', 0.01), sectionEngine);
control('step off', setStep('enabled', false), sectionEngine);
check(sectionUnpriced(), '6. unpriced: the same game with and without both events strikes identical rates and pure premiums, every line, every year');
control('the shock-free shadow off', () => { const o = SHOCK_FREE_PRICING.enabled; SHOCK_FREE_PRICING.enabled = false; return () => { SHOCK_FREE_PRICING.enabled = o; }; }, sectionUnpriced);

console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS');
process.exit(failures.length ? 1 : 0);
