// ============================================================================
// EVERY DECISION RESETS AT THE START OF EACH NEW ROUND (pr/decision-reset;
// utils/decisionDefaults resetDecisionSet / roundStartDecisions, App.tsx's
// commitYear, session/client/decisions.ts decisionsForYear). Restated from
// carry-decisions-check, which held the opposite: that every decision carried.
//
//   npx tsx scripts/diagnostics/decision-reset-check.ts
//
// 1. THE RESET IS WHAT WAS ASKED. resetDecisionSet holds, on every line:
//    funding at Expected; no cover (per-claim none, aggregate none); New
//    Members, Non-Renewal and risk control 0%; no dividend or assessment; the
//    asset mix 20% cash / 75% bonds / 5% equities — and the pool's own mix and
//    risk control, no risk-control program. Every year opens on it, year 1
//    included (roundStartDecisions); the prior board's 65% and covers
//    (defaultDecisionSet) are the pre-game's alone.
// 2. NOTHING CARRIES, SINGLE PLAYER AND TEST PLAYER. Each is played four years:
//    year 1 on a set that differs from the reset in EVERY field the reset has,
//    each later year on what commitYear hands it (roundStartDecisions). Every
//    later year is played on exactly the reset, re-stamped with its own year,
//    and not one field of year 1's set survives into it; the year's record
//    (GameState.playedYears, which the Annual Statement's Decisions section
//    reads through the results) holds what was actually played each year.
// 3. APP.TSX RESETS. A new game opens year 1 on roundStartDecisions(1, ...);
//    commitYear installs roundStartDecisions(nextYearNumber, ...) and never reads
//    settled.played.decisions; no other setCurrentDecisions in App.tsx writes a
//    carried set.
// 4. HOSTED. A team that locks a year plays its lock; a year it did not lock
//    plays the reset — year 1 included — never an earlier lock; in a room
//    from before the reset (decisionReset absent) the old rule still holds, so
//    its replays do not move.
//
// CONTROLS, each of which must fail: carry-forward put back (the played set,
// re-stamped, as carryDecisions did); a reset that leaves one field carried (the
// aggregate cover); App.tsx with carry-forward written back into commitYear; and
// hosted decisionsForYear with the old rule in a room with the reset.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet, resetDecisionSet, roundStartDecisions } from '../../src/utils/decisionDefaults';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { reinsuranceOptionIds } from '../../src/utils/reinsuranceOptions';
import { decisionsForYear, decisionsToJson } from '../../src/session/client/decisions';
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

// YEAR 1: a different value from the RESET in every field it has, each one a
// choice the Decisions page offers.
function chosenSet(shocks: boolean): DecisionSet {
  const d = defaultDecisionSet(1, shocks);
  // ⚠ NOT 20% CASH: the default is 20/75/5 since pr/asset-mix-20-75-5, and every field must differ from it.
  const mix = { cashPct: 30, bondsPct: 40, equitiesPct: 30 };
  for (const [i, l] of LINES.entries()) {
    const ids = reinsuranceOptionIds(l, shocks);
    const cover = ids.find(id => id !== 'none')!;
    d.byLine[l] = {
      ...d.byLine[l],
      fundingConfidenceLevel: [0.7, 0.8, 0.9][i],
      // Off Expected: the reset is at Expected.
      fundingAtExpected: false,
      nonRenewal: 0.01 * (i + 1),
      newMembers: 0.01 * (i + 2),
      dividendAmount: (2 + i) * 1_000_000,
      assessmentAmount: (1 + i) * 1_000_000,
      riskControlPct: 0.01 * (i + 1),
      riskControlIncentivePct: 0.01 * (i + 1),
      reinsuranceOption: cover,
      // A cover on every line: the reset has none.
      aggregateCover: ['agg-110-50', 'agg-150-50', 'agg-125-50'][i],
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
  const settings = { poolName: 'Reset', gameLength: YEARS + 1, startingYear: 2027, instanceId: id, activeLines: [...LINES], ...(test ? { testPlayer: true } : {}) } as never;
  const { setup, instance } = openSoloInstance(settings, test ? { schedule: [] } : undefined);
  const pre = runPriorHistory(instance, setup);
  return openWorlds({
    setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState: pre.poolState, lockedResults: [],
    currentDecisions: defaultDecisionSet(1, gameShocksOn(setup, instance)), priorHistory: pre.priorHistory, earlyPreGameHistory: pre.earlyPreGameHistory,
  } as GameState);
}

/** What carry-forward did (the deleted utils/carryDecisions): the played set, re-stamped. The controls put it back. */
function carryForward(played: DecisionSet, nextYearNumber: number): DecisionSet {
  return { ...JSON.parse(JSON.stringify(played)) as DecisionSet, yearNumber: nextYearNumber };
}

// ----------------------------------------------------------------------------
console.log('\n1. The reset is what was asked; every year opens on it, year 1 included');
function resetProblems(d: DecisionSet): string[] {
  const out: string[] = [];
  const mix = (m: { cashPct: number; bondsPct: number; equitiesPct: number }) => m.cashPct === 20 && m.bondsPct === 75 && m.equitiesPct === 5;
  for (const l of LINES) {
    const x = d.byLine[l];
    if (x.fundingAtExpected !== true) out.push(`${l} funding not at Expected`);
    if (x.reinsuranceOption !== 'none') out.push(`${l} per-claim cover ${x.reinsuranceOption}`);
    if ((x.aggregateCover ?? 'none') !== 'none') out.push(`${l} aggregate cover ${x.aggregateCover}`);
    if ((x.newMembers ?? 0) !== 0 || (x.nonRenewal ?? 0) !== 0) out.push(`${l} underwriting ${x.newMembers}/${x.nonRenewal}`);
    if (x.riskControlPct !== 0 || (x.riskControlIncentivePct ?? 0) !== 0) out.push(`${l} risk control ${x.riskControlPct}/${x.riskControlIncentivePct}`);
    if (x.dividendAmount !== 0 || x.assessmentAmount !== 0) out.push(`${l} dividend ${x.dividendAmount} / assessment ${x.assessmentAmount}`);
    if (!mix(x.assetAllocation)) out.push(`${l} asset mix ${JSON.stringify(x.assetAllocation)}`);
  }
  if (!mix(d.assetAllocation)) out.push(`pool asset mix ${JSON.stringify(d.assetAllocation)}`);
  if (d.riskControlPct !== 0) out.push(`pool risk control ${d.riskControlPct}`);
  if ((d.riskControlProgramIds ?? []).length) out.push(`programs ${JSON.stringify(d.riskControlProgramIds)}`);
  return out;
}
for (const shocks of [true, false]) {
  const r = resetProblems(resetDecisionSet(2, shocks));
  ok(r.length === 0, `shocks ${shocks ? 'on' : 'off'}: the reset holds every asked value on every line and the pool`, r.join('; '));
  ok([1, 2, 3, 7].every(y => same(roundStartDecisions(y, shocks), resetDecisionSet(y, shocks)) && roundStartDecisions(y, shocks).yearNumber === y),
    `shocks ${shocks ? 'on' : 'off'}: every year opens on the reset, year 1 included, stamped with its own year`);
  ok(resetProblems(defaultDecisionSet(1, shocks)).length > 0, `shocks ${shocks ? 'on' : 'off'}: the prior board's set (the pre-game's) is not the reset`);
}
control('the opening defaults offered as the reset are refused', resetProblems(defaultDecisionSet(2, true)).length);

// ----------------------------------------------------------------------------
console.log('\n2. Nothing carries, in a single-player game and a Test player game');
P.SOLO_SHOCKS.enabled = true;
let brokenCarry = 0, brokenOneField = 0;
for (const [name, id, test] of [['single player', '3', false], ['Test player', '7', true]] as const) {
  let gs = openGame(id, test);
  const shocks = gameShocksOn(gs.setup, gs.instance);
  ok(shocks, `${name}: the game's shocks are on`);
  const year1 = chosenSet(shocks);
  // Coverage: year 1 moves every field the reset has, so a field that carried would show.
  const rst = leaves(resetDecisionSet(1, shocks)), mine = leaves(year1);
  const unmoved = [...rst.keys()].filter(p => p !== 'yearNumber' && same(rst.get(p), mine.get(p)));
  ok(unmoved.length === 0, `${name}: year 1 differs from the reset in all ${rst.size - 1} of its fields`, unmoved.join(', '));

  let next: DecisionSet = year1;
  for (let y = 1; y <= YEARS; y++) {
    const played = playWorldsYear(gs, next);
    const settled = settleWorldsYear(gs, played, []);
    // What App.tsx's commitYear installs for the next round.
    const opened = roundStartDecisions(y + 1, shocks);
    const bad = mismatches(opened, resetDecisionSet(y + 1, shocks), y + 1);
    ok(bad.length === 0 && opened.yearNumber === y + 1, `${name}, year ${y} -> ${y + 1}: the next round opens on the reset, every field, stamped ${y + 1}`, bad.slice(0, 3).join('; '));
    const survived = [...leaves(opened)].filter(([p, v]) => p !== 'yearNumber' && same(v, leaves(year1).get(p)));
    ok(survived.length === 0, `${name}, year ${y}: not one field of year 1's set survives into year ${y + 1}`, survived.map(([p]) => p).slice(0, 4).join(', '));
    // CONTROLS on the same year: carry-forward put back, and a reset that leaves one field carried.
    brokenCarry += mismatches(carryForward(settled.played.decisions, y + 1), resetDecisionSet(y + 1, shocks), y + 1).length;
    const leaky = roundStartDecisions(y + 1, shocks);
    leaky.byLine.GL.aggregateCover = settled.played.decisions.byLine.GL.aggregateCover;
    // Year 1 only: later years are played on the reset, whose cover is already none.
    if (y === 1) brokenOneField += mismatches(leaky, resetDecisionSet(y + 1, shocks), y + 1).length;

    gs = { ...gs, ...commitSettledYear(gs, settled), currentYearNumber: y + 1, currentDecisions: opened };
    next = gs.currentDecisions;
  }
  const playedSets = (gs.playedYears ?? []).map(p => p.decisions);
  ok(playedSets.length === YEARS && mismatches(playedSets[0], year1, 1).length === 0
    && playedSets.slice(1).every((d, i) => mismatches(d, resetDecisionSet(i + 2, shocks), i + 2).length === 0),
    `${name}: the record holds what was played — year 1 its choices, every later year the reset (GameState.playedYears)`);
  const echo = gs.lockedResults.map(r => r.byLine.GL.decisions?.aggregateCover);
  ok(echo[0] === year1.byLine.GL.aggregateCover && echo.slice(1).every(c => (c ?? 'none') === 'none'),
    `${name}: each year's result echoes the decisions it was played on — what the Annual Statement's Decisions section reads`, JSON.stringify(echo));
}
control('carry-forward put back (the played set, re-stamped) is refused', brokenCarry);
control('a reset that leaves the GL aggregate cover carried is refused', brokenOneField);

// ----------------------------------------------------------------------------
console.log('\n3. App.tsx resets');
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
  if (!/const nextDecisions: DecisionSet = roundStartDecisions\(\s*nextYearNumber/.test(commit)) out.push('commitYear does not open the next round on roundStartDecisions(nextYearNumber, ...)');
  if (/played\.decisions|carryDecisions|carryForward/.test(commit)) out.push('commitYear reads the played set into the next round');
  if (!/currentDecisions:\s*nextDecisions/.test(commit) || !/setCurrentDecisions\(nextDecisions\)/.test(commit)) out.push('commitYear does not install the reset');
  const start = code(body(src, 'const handleStartGame = useCallback(', 'const commitYear'));
  if (!/currentDecisions:\s*roundStartDecisions\(1,/.test(start) || !/const cd = roundStartDecisions\(1,/.test(start)) out.push('the first year does not open on roundStartDecisions(1, ...)');
  const calls = [...code(src).matchAll(/setCurrentDecisions\(([^;]*)\);/g)].map(m => m[1].trim());
  const allowed = [
    /^r\.currentDecisions \?\? roundStartDecisions\(/,  // a save without an editing buffer: the round's start
    /^cd$/,                                                 // the first year, the reset (above)
    /^nextDecisions$/,                                      // commitYear, the reset
    /^defaultDecisionSet\(1\)$/,                           // new game: nothing in play
    /^d$/,                                                  // the player's own edit
  ];
  for (const c of calls) if (!allowed.some(r => r.test(c))) out.push(`setCurrentDecisions(${c}) is not one of the five known writes`);
  if (calls.length !== allowed.length) out.push(`${calls.length} setCurrentDecisions calls, ${allowed.length} expected`);
  return out;
}
const now = appProblems(APP);
ok(now.length === 0, 'a new game opens year 1 on roundStartDecisions, commitYear opens every next round on it and never reads the played set; no other write carries a set', now.join('; '));
const OLD_START = APP.replace('const cd = roundStartDecisions(1,', 'const cd = defaultDecisionSet(1,');
control('a new game opening year 1 on the prior board\'s defaults is refused', OLD_START === APP ? 0 : appProblems(OLD_START).length);
const CARRY = `const nextDecisions: DecisionSet = { ...settled.played.decisions, yearNumber: nextYearNumber };`;
const planted = APP.replace(/const nextDecisions: DecisionSet = roundStartDecisions\([\s\S]*?\);/, CARRY);
control('App.tsx with carry-forward written back into commitYear is refused', planted === APP ? 0 : appProblems(planted).length);

// ----------------------------------------------------------------------------
console.log('\n4. Hosted: an unlocked year plays the reset, never an earlier lock');
const y1 = chosenSet(true);
const history = { '1': decisionsToJson(y1), '3': decisionsToJson({ ...y1, yearNumber: 3 }) };
const hostedProblems = (rule: (y: number) => DecisionSet): string[] => {
  const out: string[] = [];
  if (mismatches(rule(1), y1, 1).length) out.push('locked year 1 does not play its lock');
  if (mismatches(rule(2), resetDecisionSet(2, true), 2).length) out.push('unlocked year 2 does not play the reset');
  if (mismatches(rule(3), y1, 3).length) out.push('locked year 3 does not play its lock');
  if (mismatches(rule(4), resetDecisionSet(4, true), 4).length) out.push('unlocked year 4 does not play the reset');
  return out;
};
const hp = hostedProblems(y => decisionsForYear(y, history, true));
ok(hp.length === 0, 'a room with the reset: locked years play their locks, unlocked years 2 and 4 the reset', hp.join('; '));
ok(mismatches(decisionsForYear(1, undefined, true), resetDecisionSet(1, true), 1).length === 0,
  'a team that never locks year 1 plays the reset too');
const legacy = decisionsForYear(2, history, true, false);
ok(mismatches(legacy, y1, 2).length === 0, 'a room from before the reset (decisionReset absent) still plays the last lock, so its replays do not move');
control('hosted decisionsForYear with the old rule in a room with the reset is refused', hostedProblems(y => decisionsForYear(y, history, true, false)).length);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\ndecision-reset-check: FAILED'); process.exit(1); }
console.log('\ndecision-reset-check: PASS — every decision resets at the start of each new round in single player, Test player and hosted rooms, and the controls fail.');
