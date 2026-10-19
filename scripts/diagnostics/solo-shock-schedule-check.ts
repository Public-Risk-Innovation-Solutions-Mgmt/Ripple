// ============================================================================
// THE SOLO SHOCK SCHEDULE — THE GATE.
//
//   npx tsx scripts/diagnostics/solo-shock-schedule-check.ts
//
// A solo game draws its shock schedule ONCE, at its start, by the host's
// Randomise rule on its own labelled stream (utils/soloGame), keeps it on the
// instance and so in the save, and every world reads it. Checked on a solo game
// built and played exactly as the app builds and plays it:
//
//   1. THE SCHEDULE is the Randomise rule's: one event per three years, distinct
//      years from year 2, no event twice — and re-derivable from the seed alone.
//   2. EVERY WORLD FIRES THE SAME EVENTS IN THE SAME YEARS — the schedule's, and
//      nothing else — WITH SEVERITY DIFFERING: each firing's size draws are the
//      world's own, and its loss differs across worlds.
//   3. THE SAME SEED GIVES THE SAME SCHEDULE; another seed another.
//   4. THE SCHEDULE SURVIVES A SAVE AND RELOAD: out through packSave, back
//      through unpackSave at year 3, the reloaded game carries the same schedule
//      and its timing, and plays on to exactly the game that never stopped.
//   6. A REGIONAL EVENT STRIKES ONE REGION IN EVERY WORLD — the region the
//      instance resolved once with the schedule — on a solo schedule and a
//      host's alike, while its size is still drawn per world.
//   5. PRICING NEVER READS IT: a game whose schedule differs only in a year's
//      event charges the same rate and the same reinsurance in that year —
//      reinsurance and expected losses use the catalogue's probabilities.
//
// ⚠ AND IT FAILS WHEN BROKEN — every check is a function over data, and THE
// CONTROLS at the foot feed each one a deliberately broken input and require it
// to fail. A control that passes is a check that cannot.
// ============================================================================

import { openSoloInstance } from '../../src/utils/soloGame';
import { drawShockSchedule, shockDrawCount, SOLO_SHOCK_STREAM } from '../../src/utils/shockSchedule';
import { firingsStartingIn, SHOCK_EVENTS } from '../../src/utils/shockLosses';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, worldInstance } from '../../src/utils/worlds';
import { packSave, unpackSave } from '../../src/utils/gameSave';
import { seedFromInstanceId } from '../../src/seedHash';
import { WORLD_COUNT } from '../../src/data/pricingParameters';
import type { ScheduledShock } from '../../src/types/shocks';
import type { CoverageLine, GameInstance, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = 10;
const SAVE_AT = 3;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const settingsFor = (id: string): GameSetupSettings =>
  ({ poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES }) as GameSetupSettings;

/** Open a game on a given setup and instance, as App does after openSoloInstance. */
function open(setup: GameSetupSettings, instance: GameInstance): GameState {
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  return openWorlds({
    setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  });
}

function advance(gs: GameState, y: number): GameState {
  const settled = settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), []);
  return { ...gs, ...commitSettledYear(gs, settled), currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
}

function playTo(gs: GameState, from: number, to: number): GameState {
  for (let y = from; y <= to; y++) gs = advance(gs, y);
  return gs;
}

// ---------------------------------------------------------------------------
// THE CHECKS — each takes data and returns what it found wrong.
// ---------------------------------------------------------------------------

/** 1. The Randomise rule's shape. */
function scheduleShape(s: readonly ScheduledShock[], years: number): string[] {
  const out: string[] = [];
  if (s.length !== shockDrawCount(years)) out.push(`${s.length} events, the rule draws ${shockDrawCount(years)}`);
  const ys = s.map(e => e.yearNumber);
  if (new Set(ys).size !== ys.length) out.push(`a year holds two events (${ys.join(',')})`);
  if (ys.some(y => y < 2 || y > years)) out.push(`a year outside 2..${years} (${ys.join(',')})`);
  const ids = s.map(e => e.shockId);
  if (new Set(ids).size !== ids.length) out.push(`an event drawn twice (${ids.join(',')})`);
  return out;
}

/** The events that STARTED in each year, in one world's rows: "y:id,id". */
function startedByYear(rows: GameState['lockedResults']): string[] {
  return rows.map((r, i) => `${i + 1}:${(r.shockEvents ?? [])
    .filter(e => e.yearFired === r.yearNumber).map(e => e.shockId).sort().join(',')}`);
}

/** 2a. Every world fires exactly the schedule's events, in its years. */
function sameEventsEveryWorld(worldRows: GameState['lockedResults'][], schedule: readonly ScheduledShock[]): string[] {
  const out: string[] = [];
  const years = worldRows[0].length;
  const expected = Array.from({ length: years }, (_, i) => `${i + 1}:${schedule
    .filter(s => s.yearNumber === i + 1).map(s => s.shockId).sort().join(',')}`);
  worldRows.forEach((rows, w) => {
    const got = startedByYear(rows);
    const bad = got.filter((g, i) => g !== expected[i]);
    if (bad.length) out.push(`world ${w + 1}: ${bad[0]} where the schedule says ${expected[got.indexOf(bad[0])]}`);
  });
  return out;
}

/** 2b. Severity is per world: each firing's size draws differ across worlds. */
function severityPerWorld(instances: GameInstance[], schedule: readonly ScheduledShock[]): string[] {
  const out: string[] = [];
  for (const s of schedule) {
    const draws = instances.map(inst => JSON.stringify(
      firingsStartingIn(inst, 'host', s.yearNumber).find(f => f.event.id === s.shockId)?.draws ?? null));
    if (new Set(draws).size !== draws.length) out.push(`${s.shockId} in year ${s.yearNumber}: ${new Set(draws).size} distinct draws of ${draws.length}`);
  }
  return out;
}

/** 2c. And the loss each world books to a scheduled event differs. */
function lossesDiffer(worldRows: GameState['lockedResults'][], schedule: readonly ScheduledShock[]): number {
  let differing = 0;
  for (const s of schedule) {
    const losses = worldRows.map(rows => (rows[s.yearNumber - 1]?.shockEvents ?? [])
      .find(e => e.shockId === s.shockId && e.yearFired === s.yearNumber)?.attributableGrossLoss ?? 0);
    if (new Set(losses).size > 1) differing++;
  }
  return differing;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 5. The pricing fields of one line-year. */
const PRICE_FIELDS = ['finalRatePer100', 'ratePer100', 'purePremiumPer100', 'expectedCededPer100', 'reinsuranceCost', 'totalMemberCharge'] as const;
function pricingOf(gs: GameState, y: number): string {
  return JSON.stringify(LINES.map(l => PRICE_FIELDS.map(f => gs.lockedResults[y - 1].byLine[l][f as never])));
}

// ---------------------------------------------------------------------------
console.log(`=== SOLO SHOCK SCHEDULE — ${WORLD_COUNT} worlds, three lines, ${YEARS} years ===`);
const ID = 'SSCHK1';
const solo = openSoloInstance(settingsFor(ID));
const schedule = solo.instance.scheduledShocks ?? [];
const A = playTo(open(solo.setup, solo.instance), 1, YEARS);
const worldRows = A.worlds!.map(w => w.lockedResults);
const worldInstances = A.worlds!.map((_, i) => worldInstance(A.instance, i));
console.log(`  schedule: ${schedule.map(s => `${s.shockId} in year ${s.yearNumber}`).join('; ')}`);

console.log('\n--- 1. the schedule is the Randomise rule\'s, drawn once ---');
check(solo.setup.shockTiming === 'solo', 'the solo setup is marked to fire its schedule');
check(scheduleShape(schedule, YEARS).length === 0, `${shockDrawCount(YEARS)} events, distinct years from 2, no event twice`, scheduleShape(schedule, YEARS)[0] ?? '');
const idYear = (s: readonly ScheduledShock[]) => s.map(e => ({ shockId: e.shockId, yearNumber: e.yearNumber }));
check(same(idYear(schedule), drawShockSchedule(ID, YEARS, SOLO_SHOCK_STREAM)), 're-derived from the seed alone, on the solo stream');
check(worldInstances.every(i => same(i.scheduledShocks, schedule)) && new Set(worldInstances.map(i => i.seed)).size === WORLD_COUNT,
  'every world\'s instance carries the one schedule, on its own seed');

console.log('\n--- 2. every world fires the same events in the same years, severity differing ---');
{
  const bad = sameEventsEveryWorld(worldRows, schedule);
  check(bad.length === 0, `all ${WORLD_COUNT} worlds fire exactly the schedule's events, in its years`, bad[0] ?? '');
  const avg = A.lockedResults.flatMap(r => (r.shockEvents ?? []).filter(e => e.yearFired === r.yearNumber));
  check(avg.length === schedule.length && avg.every(e => e.worlds?.fired === WORLD_COUNT),
    `the averaged year says each fired in ${WORLD_COUNT} of ${WORLD_COUNT} worlds`, avg.map(e => `${e.shockId} ${e.worlds?.fired}`).join(', '));
  const sev = severityPerWorld(worldInstances, schedule);
  check(sev.length === 0, 'each firing\'s size draws are the world\'s own', sev[0] ?? '');
  const differing = lossesDiffer(worldRows, schedule);
  check(differing > 0, `and the loss it books differs across worlds (${differing} of ${schedule.length} events)`);
}

console.log('\n--- 6. a regional event strikes one region in every world ---');
/**
 * Each scheduled regional firing's region in every world — at the engine's
 * firing, k-th entry of an event in a year against its k-th firing, so two of
 * one event in a year are told apart — and, where an event fires once that
 * year, as the world's results record it.
 */
function regionsByWorld(insts: GameInstance[], rows: GameState['lockedResults'][], sched: readonly ScheduledShock[]): string[] {
  const out: string[] = [];
  const seenK = new Map<string, number>();
  for (const s of sched) {
    const key = `${s.shockId}_${s.yearNumber}`;
    const k = seenK.get(key) ?? 0; seenK.set(key, k + 1);
    if (!REGIONAL.has(s.shockId)) continue;
    const fired = insts.map(i => firingsStartingIn(i, 'host', s.yearNumber).filter(f => f.event.id === s.shockId)[k]?.region ?? 'none');
    if (new Set(fired).size !== 1 || fired[0] !== s.region) out.push(`${s.shockId} #${k + 1} in year ${s.yearNumber}: schedule ${s.region}, worlds fire ${[...new Set(fired)].join('/')}`);
    if (sched.filter(e => e.shockId === s.shockId && e.yearNumber === s.yearNumber).length === 1) {
      const recorded = rows.map(r => (r[s.yearNumber - 1]?.shockEvents ?? [])
        .find(e => e.shockId === s.shockId && e.yearFired === s.yearNumber)?.region ?? 'none');
      if (new Set(recorded).size !== 1 || recorded[0] !== s.region) out.push(`${s.shockId} in year ${s.yearNumber}: schedule ${s.region}, worlds record ${[...new Set(recorded)].join('/')}`);
    }
  }
  return out;
}
const REGIONAL = new Set(SHOCK_EVENTS.filter(e => e.regional).map(e => e.id));
// A host's schedule: hand-picked, all three regional events, one of them twice in a year.
const HOST_LIST = [{ shockId: '#1', yearNumber: 2 }, { shockId: '#2', yearNumber: 3 }, { shockId: '#3', yearNumber: 3 }, { shockId: '#3', yearNumber: 3 }];
const hostInst = generateGameInstance('SSHOST', seedFromInstanceId('SSHOST'), HOST_LIST);
const H = playTo(open({ ...settingsFor('SSHOST'), shockTiming: 'host' }, hostInst), 1, 3);
const hostRows = H.worlds!.map(w => w.lockedResults);
const hostSched = hostInst.scheduledShocks ?? [];
{
  const soloRegional = schedule.filter(s => REGIONAL.has(s.shockId));
  check(schedule.every(s => REGIONAL.has(s.shockId) === (s.region !== undefined)),
    'every regional event in the solo schedule carries a region, and no other does', `${soloRegional.length} regional`);
  const bad = regionsByWorld(worldInstances, worldRows, schedule);
  check(bad.length === 0, `the solo schedule's regional events strike its region in all ${WORLD_COUNT} worlds`, bad[0] ?? soloRegional.map(s => `${s.shockId} ${s.region}`).join(', '));
  check(hostSched.every(s => s.region !== undefined), 'a host\'s hand-picked regional events are each given a region when the game is built');
  const badH = regionsByWorld(H.worlds!.map((_, i) => worldInstance(H.instance, i)), hostRows, hostSched);
  check(badH.length === 0, `and strike it in all ${WORLD_COUNT} worlds, the same event twice in one year included`, badH[0] ?? hostSched.map(s => `${s.shockId}y${s.yearNumber} ${s.region}`).join(', '));
  check(same(generateGameInstance('SSHOST', seedFromInstanceId('SSHOST'), HOST_LIST).scheduledShocks, hostSched),
    'every team building from the same seed and list resolves the same regions');
  const sevH = severityPerWorld(H.worlds!.map((_, i) => worldInstance(H.instance, i)), hostSched);
  check(sevH.length === 0, 'with each firing\'s size still drawn per world', sevH[0] ?? '');
}

console.log('\n--- 3. the same seed gives the same schedule ---');
const again = openSoloInstance(settingsFor(ID));
check(same(again.instance.scheduledShocks, schedule), 'the same seed, drawn again, gives the same schedule');
const other = openSoloInstance(settingsFor('SSCHK2'));
check(!same(other.instance.scheduledShocks, schedule), 'another seed gives another');
check(!same(drawShockSchedule(ID, YEARS, 'host_shock_schedule'), schedule), 'and the solo stream is its own, not the host\'s');

console.log('\n--- 4. the schedule survives a save and reload ---');
let reloaded: GameState;
{
  const atSave = playTo(open(solo.setup, solo.instance), 1, SAVE_AT);
  const env = unpackSave(packSave({ gameState: atSave, startingFinancials: null, initialMembers: [], currentDecisions: defaultDecisionSet(SAVE_AT + 1) })) as { gameState: GameState };
  reloaded = env.gameState;
  check(same(reloaded.instance.scheduledShocks, schedule) && reloaded.setup.shockTiming === 'solo',
    'the reloaded game carries the schedule and its timing');
  const finished = playTo(reloaded, SAVE_AT + 1, YEARS);
  check(same(startedByYear(finished.lockedResults), startedByYear(A.lockedResults))
    && same(finished.worlds!.map(w => startedByYear(w.lockedResults)), worldRows.map(startedByYear)),
    `played on from year ${SAVE_AT + 1}, it fires what the game that never stopped fires, in every world`);
  check(Math.abs(finished.lockedResults[YEARS - 1].endingSurplus - A.lockedResults[YEARS - 1].endingSurplus) < 1e-6,
    'and ends on the same surplus');
}

console.log('\n--- 5. pricing never reads the schedule ---');
const first = schedule[0];
let quiet: GameState;
{
  // The same game with the first event moved out of the game: everything up to
  // and including that year's pricing has seen the same history.
  const moved = schedule.filter(s => s !== first);
  const inst = generateGameInstance(ID, seedFromInstanceId(ID), moved);
  quiet = playTo(open(solo.setup, inst), 1, first.yearNumber);
  check(pricingOf(quiet, first.yearNumber) === pricingOf(A, first.yearNumber),
    `in year ${first.yearNumber}, with and without ${first.shockId} scheduled: the same rate and reinsurance on every line`);
}

// ============================================================================
// THE CONTROLS — each check, fed a broken input, must fail.
// ============================================================================
console.log('\n--- CONTROLS: every check fails when broken ---');
{
  // Timing drawn per world: the bare instance, fired by the catalogue in each world.
  const bareSetup = { ...settingsFor(ID) };
  const bare = playTo(open(bareSetup, generateGameInstance(ID, seedFromInstanceId(ID))), 1, YEARS);
  check(sameEventsEveryWorld(bare.worlds!.map(w => w.lockedResults), schedule).length > 0,
    'control: shock timing drawn per world is caught');
  // A schedule breaking the rule.
  check(scheduleShape([...schedule, { ...schedule[0] }], YEARS).length > 0, 'control: a schedule outside the rule is caught');
  // Severity shared by every world.
  check(severityPerWorld(worldInstances.map(() => worldInstances[0]), schedule).length > 0,
    'control: one severity in every world is caught');
  // Regions drawn per world: the same host list on an instance whose entries carry none.
  const unresolved = { ...hostInst, scheduledShocks: HOST_LIST.map(s => ({ ...s })) };
  const P = playTo(open({ ...settingsFor('SSHOST'), shockTiming: 'host' }, unresolved), 1, 3);
  check(regionsByWorld(P.worlds!.map((_, i) => worldInstance(P.instance, i)), P.worlds!.map(w => w.lockedResults), hostSched).length > 0,
    'control: a region drawn per world is caught');
  check(lossesDiffer(worldRows.map(() => worldRows[0]), schedule) === 0,
    'control: one world\'s losses in every world are caught');
  // A schedule redrawn per load: a reload that loses it.
  const lost = { ...reloaded!, instance: { ...reloaded!.instance, scheduledShocks: drawShockSchedule('SSCHK2', YEARS, SOLO_SHOCK_STREAM) } };
  const lostFinished = playTo(lost, SAVE_AT + 1, YEARS);
  check(!same(startedByYear(lostFinished.lockedResults), startedByYear(A.lockedResults)),
    'control: a reload on a different schedule is caught');
  // Pricing that read the schedule: the year after the event, history differs and so does the rate.
  const after = first.yearNumber + 1;
  const quietOn = playTo(quiet!, first.yearNumber + 1, after);
  check(pricingOf(quietOn, after) !== pricingOf(A, after),
    `control: the pricing comparison sees a difference when there is one (year ${after}, after ${first.shockId} landed)`);
}

console.log(failures.length === 0
  ? '\nSOLO SHOCK SCHEDULE: ALL CHECKS PASS.'
  : `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
