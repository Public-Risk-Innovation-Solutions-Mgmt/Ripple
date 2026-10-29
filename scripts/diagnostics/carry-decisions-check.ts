// ============================================================================
// SINGLE PLAYER CARRIES EVERY DECISION INTO THE NEXT YEAR (wip/carry-decisions;
// utils/carryDecisions.ts, App.tsx's commitYear).
//
//   npx tsx scripts/diagnostics/carry-decisions-check.ts
//
// 1. EVERY DECISION CARRIES. A single-player game and a Test player game are
//    each played four years: year 1 on a set that differs from the defaults in
//    EVERY field the defaults have (funding level and at-expected, non-renewal
//    and new members, dividends and assessments, risk control, the reinsurance
//    cover, the asset mix, loan repayment — per line, and the pool's own) plus
//    the aggregate cover and a risk-control program; each later year on what
//    carryDecisions hands it. Every year is played on exactly year 1's set,
//    re-stamped with its own year number, and the carried set is a copy, not
//    the played object. The coverage is checked, not assumed: a field the
//    defaults gain that year 1 does not move fails here.
// 2. APP.TSX CARRIES WITH IT. commitYear builds the next year's set with
//    carryDecisions from settled.played.decisions and never calls
//    defaultDecisionSet; the game's first year still opens on
//    defaultDecisionSet(1, ...); and no other setCurrentDecisions in App.tsx
//    resets a game in play to the defaults (new game and a save without a
//    buffer only).
//
// CONTROLS, each of which must fail: the reset this replaced (defaults plus the
// program list); a carry that drops one field (the aggregate cover); a carry
// that keeps the played year's number; a carry that shares the played object;
// and App.tsx's commitYear with the reset written back in.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../../src/data/pricingParameters';
import { SLIDER_RANGES } from '../../src/data/defaultAssumptions';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { reinsuranceOptionIds } from '../../src/utils/reinsuranceOptions';
import { carryDecisions } from '../../src/utils/carryDecisions';
import { openWorlds, playWorldsYear, settleWorldsYear, commitSettledYear } from '../../src/utils/worlds';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = 4;

let passed = 0, failed = 0;
function ok(cond: boolean, label: string, detail = '') {
  if (cond) { passed++; console.log(`  OK    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
/** A check that must FAIL on a planted defect: counts the problems the check finds. */
function control(label: string, problems: number) {
  ok(problems > 0, `control: ${label}`, problems > 0 ? '' : 'the broken form passed');
  if (problems > 0) console.log(`          (${problems} problem(s) when broken)`);
}

// Every leaf path of a decision set, with its value.
function leaves(x: unknown, at = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (x !== null && typeof x === 'object' && !Array.isArray(x)) {
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      for (const [p, w] of leaves(v, at ? `${at}.${k}` : k)) out.set(p, w);
    }
  } else out.set(at, Array.isArray(x) ? JSON.stringify(x) : x);
  return out;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** How many fields of `got` differ from `want` re-stamped to `year`. */
function mismatches(got: DecisionSet, want: DecisionSet, year: number): string[] {
  const w = leaves({ ...want, yearNumber: year }), g = leaves(got);
  const bad: string[] = [];
  for (const p of new Set([...w.keys(), ...g.keys()])) if (!same(w.get(p), g.get(p))) bad.push(`${p}: ${JSON.stringify(g.get(p))} vs ${JSON.stringify(w.get(p))}`);
  return bad;
}

// YEAR 1: a different value in every field the defaults have, each one a choice
// the Decisions page offers.
function chosenSet(shocks: boolean): DecisionSet {
  const d = defaultDecisionSet(1, shocks);
  const mix = { cashPct: 20, bondsPct: 50, equitiesPct: 30 };
  for (const [i, l] of LINES.entries()) {
    const ids = reinsuranceOptionIds(l, shocks);
    const cover = ids.find(id => id !== d.byLine[l].reinsuranceOption)!;
    d.byLine[l] = {
      ...d.byLine[l],
      fundingConfidenceLevel: [0.7, 0.8, 0.9][i],
      fundingAtExpected: false,
      nonRenewal: 0.01 * (i + 1),
      newMembers: 0.01 * (i + 2),
      dividendPct: 0.02 + 0.005 * i,
      assessmentPct: 0.01 + 0.005 * i,
      riskControlPct: 0.01 * (i + 1),
      riskControlIncentivePct: 0.01 * (i + 1),
      reinsuranceOption: cover,
      aggregateCover: ['agg-110-50', 'agg-125-50', 'agg-150-50'][i],
      assetAllocation: { ...mix },
      loanRepaymentAggressiveness: [0.25, 0.75, 1][i],
    };
  }
  d.assetAllocation = { ...mix };
  d.riskControlPct = 0.03;
  d.riskControlProgramIds = ['gl-law-enforcement-analytics'];
  return d;
}

function openGame(id: string, test: boolean): GameState {
  const settings = { poolName: 'Carry', gameLength: YEARS + 1, startingYear: 2027, instanceId: id, activeLines: [...LINES], ...(test ? { testPlayer: true } : {}) } as never;
  const { setup, instance } = openSoloInstance(settings, test ? { schedule: [] } : undefined);
  const pre = runPriorHistory(instance, setup);
  return openWorlds({
    setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState: pre.poolState, lockedResults: [],
    currentDecisions: defaultDecisionSet(1, gameShocksOn(setup, instance)), priorHistory: pre.priorHistory, earlyPreGameHistory: pre.earlyPreGameHistory,
  } as GameState);
}

// ----------------------------------------------------------------------------
console.log('\n1. Every decision carries, in a single-player game and a Test player game');
P.SOLO_SHOCKS.enabled = true;
let brokenReset = 0, brokenDrop = 0, brokenYear = 0, brokenShared = 0;
for (const [name, id, test] of [['single player', '3', false], ['Test player', '7', true]] as const) {
  let gs = openGame(id, test);
  const shocks = gameShocksOn(gs.setup, gs.instance);
  ok(shocks, `${name}: the game's shocks are on, so the aggregate cover is offered`);
  const year1 = chosenSet(shocks);
  // Coverage: year 1 moves every field the defaults have, and adds the cover and a program.
  const dflt = leaves(defaultDecisionSet(1, shocks)), mine = leaves(year1);
  const unmoved = [...dflt.keys()].filter(p => p !== 'yearNumber' && same(dflt.get(p), mine.get(p)));
  ok(unmoved.length === 0, `${name}: year 1 differs from the defaults in all ${dflt.size - 1} of their fields`, unmoved.join(', '));
  ok(LINES.every(l => mine.get(`byLine.${l}.aggregateCover`) !== undefined) && mine.get('riskControlProgramIds') !== '[]',
    `${name}: year 1 also buys an aggregate cover on every line and commits a risk-control program`);

  let next: DecisionSet = year1;
  for (let y = 1; y <= YEARS; y++) {
    const played = playWorldsYear(gs, next);
    const settled = settleWorldsYear(gs, played, []);
    const programs = settled.result.pool?.riskControlProgramIds ?? [];
    const carried = carryDecisions(settled.played.decisions, y + 1, programs);
    const bad = mismatches(carried, year1, y + 1);
    ok(bad.length === 0, `${name}, year ${y} -> ${y + 1}: the carried set is year 1's set, every field, re-stamped ${y + 1}`, bad.slice(0, 3).join('; '));
    ok(carried !== settled.played.decisions && carried.byLine.WC !== settled.played.decisions.byLine.WC
      && carried.byLine.WC.assetAllocation !== settled.played.decisions.byLine.WC.assetAllocation,
      `${name}, year ${y}: the carried set is a copy, not the played object`);
    // CONTROLS on the same year.
    brokenReset += mismatches({ ...defaultDecisionSet(y + 1, shocks), riskControlProgramIds: [...programs] }, year1, y + 1).length;
    const dropped = carryDecisions(settled.played.decisions, y + 1, programs);
    delete dropped.byLine.GL.aggregateCover;
    brokenDrop += mismatches(dropped, year1, y + 1).length;
    brokenYear += mismatches({ ...carried, yearNumber: y }, year1, y + 1).length;
    brokenShared += Number(({ ...settled.played.decisions, yearNumber: y + 1 }).byLine === settled.played.decisions.byLine);

    gs = { ...gs, ...commitSettledYear(gs, settled), currentYearNumber: y + 1, currentDecisions: carried };
    next = gs.currentDecisions;
  }
  const playedSets = (gs.playedYears ?? []).map(p => p.decisions);
  ok(playedSets.length === YEARS && playedSets.every((d, i) => mismatches(d, year1, i + 1).length === 0),
    `${name}: all ${YEARS} years were played on year 1's choices (GameState.playedYears)`);
}
control('the reset this replaced (defaults plus the program list) is refused', brokenReset);
control('a carry that drops the GL aggregate cover is refused', brokenDrop);
control("a carry that keeps the played year's number is refused", brokenYear);
control('a shallow carry that shares the played object is refused', brokenShared);

// ----------------------------------------------------------------------------
console.log('\n2. App.tsx carries with it');
const APP = fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8');
function body(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i);
  return j < 0 ? '' : src.slice(i, j);
}
const code = (s: string) => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
function appProblems(src: string): string[] {
  const out: string[] = [];
  const commit = code(body(src, 'const commitYear = useCallback(', '}, [startingFinancials'));
  if (!commit) out.push('commitYear not found');
  if (!/carryDecisions\(\s*settled\.played\.decisions\s*,\s*nextYearNumber/.test(commit)) out.push('commitYear does not carry settled.played.decisions to nextYearNumber');
  if (/defaultDecisionSet\(/.test(commit)) out.push('commitYear calls defaultDecisionSet');
  if (!/currentDecisions:\s*nextDecisions/.test(commit) || !/setCurrentDecisions\(nextDecisions\)/.test(commit)) out.push('commitYear does not install the carried set');
  const start = code(body(src, 'const handleStartGame = useCallback(', 'const commitYear'));
  if (!/currentDecisions:\s*defaultDecisionSet\(1,/.test(start) || !/const cd = defaultDecisionSet\(1,/.test(start)) out.push('the first year does not open on defaultDecisionSet(1, ...)');
  // Every setCurrentDecisions in App.tsx, by argument. A default may appear only
  // where no game is in play (new game) or a save carried no buffer.
  const calls = [...code(src).matchAll(/setCurrentDecisions\(([^;]*)\);/g)].map(m => m[1].trim());
  const allowed = [
    /^r\.currentDecisions \?\? defaultDecisionSet\(/,  // a save without an editing buffer
    /^cd$/,                                              // the first year, defaults (above)
    /^nextDecisions$/,                                   // commitYear, carried
    /^defaultDecisionSet\(1\)$/,                         // new game: nothing in play
    /^d$/,                                               // the player's own edit
  ];
  for (const c of calls) if (!allowed.some(r => r.test(c))) out.push(`setCurrentDecisions(${c}) is not one of the five known writes`);
  if (calls.length !== allowed.length) out.push(`${calls.length} setCurrentDecisions calls, ${allowed.length} expected`);
  return out;
}
const now = appProblems(APP);
ok(now.length === 0, 'commitYear carries settled.played.decisions with carryDecisions, never defaultDecisionSet; the first year opens on the defaults; no other write resets a game in play', now.join('; '));
const RESET = `const nextDecisions: DecisionSet = {
      ...defaultDecisionSet(nextYearNumber, gameShocksOn(baseGs.setup, baseGs.instance)),
      riskControlProgramIds: [...(result.pool?.riskControlProgramIds ?? [])],
    };`;
const planted = APP.replace(/const nextDecisions: DecisionSet = carryDecisions\([\s\S]*?\);/, RESET);
control('App.tsx with the reset written back into commitYear is refused', planted === APP ? 0 : appProblems(planted).length);
const extra = APP.replace('setActiveTab(\'results\');', 'setActiveTab(\'results\');\n    setCurrentDecisions(defaultDecisionSet(nextYearNumber));');
control('a second write of the defaults after a year locks is refused', extra === APP ? 0 : appProblems(extra).length);

// Ranges stay in force: every carried slider value is one the page offers.
const r = SLIDER_RANGES;
const y1 = chosenSet(true);
ok(LINES.every(l => y1.byLine[l].dividendPct <= r.dividendPct.max && y1.byLine[l].assessmentPct <= r.assessmentPct.max
  && (y1.byLine[l].riskControlIncentivePct ?? 0) <= r.riskControlIncentivePct.max && y1.byLine[l].riskControlPct <= r.riskControlPct.max),
  'year 1\'s choices are inside the Decisions page\'s slider ranges');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\ncarry-decisions-check: FAILED'); process.exit(1); }
console.log('\ncarry-decisions-check: PASS — every decision carries into the next year in single player and Test player, and the controls fail.');
