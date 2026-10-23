// ============================================================================
// THE SOLO SHOCK SCHEDULE — THE GATE.
//
//   npx tsx scripts/diagnostics/solo-shock-schedule-check.ts
//
//   0. SHOCKS ARE OFF IN SINGLE-PLAYER (SOLO_SHOCKS off, pending the data
//      scientist): the app's solo game carries no schedule and no event fires
//      in any world in any year, while a hosted game still fires the host's
//      list. The checks below then switch the solo schedule ON and test it as
//      it will return.
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
//      through unpackSave and the replay at year 3, the reloaded game carries the same schedule
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
import { drawShockSchedule, shockDrawRange, SOLO_SHOCK_STREAM } from '../../src/utils/shockSchedule';
import { firingsStartingIn, SHOCK_EVENTS } from '../../src/utils/shockLosses';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, worldInstance } from '../../src/utils/worlds';
import { packSave, unpackSave, type SavedGame } from '../../src/utils/gameSave';
import { restoreSavedGame } from '../../src/utils/saveRestore';
import { seedFromInstanceId } from '../../src/seedHash';
import { INVESTMENT_INCOME_CREDIT, PRICING_DATA_LAG_YEARS, SHOCKS_OUT_OF_EXPERIENCE, SOLO_SHOCKS, WORLD_COUNT } from '../../src/data/pricingParameters';
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
  const next = { ...gs, ...commitSettledYear(gs, settled), currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
  // ⚠ EVERY WORLD'S ROWS, KEPT FOR THE CHECKS (stable-scenarios commit 10): a
  // world keeps only its last row in the game (world 1 all of its own), and the
  // engine reads no more; the checks below read every world's every year.
  return { ...next, worlds: next.worlds?.map((w, i) => (i === 0 ? w
    : { ...w, lockedResults: [...gs.worlds![i].lockedResults, w.lockedResults[w.lockedResults.length - 1]] })) };
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
  const { min, max } = shockDrawRange(years);
  if (s.length < min || s.length > max) out.push(`${s.length} events, the rule draws ${min} to ${max}`);
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

console.log('\n--- 0. shocks are off in single-player ---');
/** Problems with a solo game that must fire nothing: a schedule, or any world's firing. */
function firesNothing(gs: GameState): string[] {
  const bad: string[] = [];
  if ((gs.instance.scheduledShocks ?? []).length > 0) bad.push(`the instance carries ${gs.instance.scheduledShocks!.length} scheduled event(s)`);
  for (const [i, w] of (gs.worlds ?? []).entries()) for (const r of w.lockedResults) {
    const fired = (r.shockEvents ?? []).filter(e => e.yearFired === r.yearNumber);
    if (fired.length > 0) bad.push(`world ${i + 1} year ${r.yearNumber}: ${fired.map(e => e.shockId).join(', ')} fired`);
  }
  return bad;
}
const offSolo = openSoloInstance(settingsFor('SSOFF1'));
const OFF = playTo(open(offSolo.setup, offSolo.instance), 1, YEARS);
check(!SOLO_SHOCKS.enabled && firesNothing(OFF).length === 0,
  `a single-player game draws no schedule and fires nothing in any of ${WORLD_COUNT} worlds over ${YEARS} years`, firesNothing(OFF)[0] ?? '');
SOLO_SHOCKS.enabled = true;
const onSolo = openSoloInstance(settingsFor('SSOFF1'));
SOLO_SHOCKS.enabled = false;

// From here the solo schedule is switched ON and tested as it will return.
SOLO_SHOCKS.enabled = true;
const ID = 'SSCHK1';
const solo = openSoloInstance(settingsFor(ID));
const schedule = solo.instance.scheduledShocks ?? [];
const A = playTo(open(solo.setup, solo.instance), 1, YEARS);
const worldRows = A.worlds!.map(w => w.lockedResults);
const worldInstances = A.worlds!.map((_, i) => worldInstance(A.instance, i));
console.log(`  schedule: ${schedule.map(s => `${s.shockId} in year ${s.yearNumber}`).join('; ')}`);

console.log('\n--- 1. the schedule is the Randomise rule\'s, drawn once ---');
check(solo.setup.shockTiming === 'solo', 'the solo setup is marked to fire its schedule');
check(scheduleShape(schedule, YEARS).length === 0, `${shockDrawRange(YEARS).min}-${shockDrawRange(YEARS).max} events, distinct years from 2, no event twice`, scheduleShape(schedule, YEARS)[0] ?? '');
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
SOLO_SHOCKS.enabled = false;
{
  const Hoff = playTo(open({ ...settingsFor('SSHOST'), shockTiming: 'host' }, hostInst), 1, 3);
  // The same event twice in a year is one record, so compare event-years.
  const fired = [...new Set(Hoff.lockedResults.flatMap(r => (r.shockEvents ?? [])
    .filter(e => e.yearFired === r.yearNumber).map(e => `${e.shockId}y${e.yearFired}`)))].sort();
  const listed = [...new Set(HOST_LIST.map(h => `${h.shockId}y${h.yearNumber}`))].sort();
  check(same(fired, listed),
    `0. with single-player shocks off, a hosted game still fires the host's schedule`, fired.join(', '));
}
SOLO_SHOCKS.enabled = true;
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
  // The save keeps the averages only; the reload replays the years (commit 10).
  const env = unpackSave(packSave({ gameState: atSave, startingFinancials: null, initialMembers: [], currentDecisions: defaultDecisionSet(SAVE_AT + 1) })) as { gameState: SavedGame };
  const restored = await restoreSavedGame(env.gameState, null, undefined, async () => {});
  reloaded = restored.gameState;
  check(same(reloaded.instance.scheduledShocks, schedule) && reloaded.setup.shockTiming === 'solo' && restored.matches,
    'the reloaded game carries the schedule and its timing, and replays to the saved rows');
  const finished = playTo(reloaded, SAVE_AT + 1, YEARS);
  // A reloaded world's rows begin again at the reload; world 1 keeps all.
  const after = (rows: GameState['lockedResults']) => rows.filter(r => r.yearNumber > SAVE_AT);
  check(same(startedByYear(finished.lockedResults), startedByYear(A.lockedResults))
    && same(finished.worlds!.map(w => startedByYear(after(w.lockedResults))), worldRows.map(rows => startedByYear(after(rows)))),
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
  // Shocks left on in single-player: the same game, drawn with the switch on.
  check(firesNothing({ ...OFF, instance: onSolo.instance }).length > 0,
    'control: a single-player game with a schedule is caught');
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
  // Pricing that read the shock: with the shocks LEFT IN the experience, the
  // year after the event the history differs and so does the rate.
  // ⚠ THIS USED TO COMPARE THE SHIPPED GAMES THE YEAR AFTER, AND HAS BEEN
  // VACUOUS SINCE STABLE-SCENARIOS COMMIT 7: with the shocks out of the
  // experience a landed shock never moves the next rate, by design, and the
  // control passed on a last-digit float difference until commit 8 removed it.
  // ⚠ AND THE FIRST RATE THAT CAN SEE IT IS LATER BY THE DATA LAG (the 2027
  // policy year, 3ab9980): a year is priced on experience through the year
  // PRICING_DATA_LAG_YEARS before the one before it, so with a one-year lag the
  // year straight after the event still prices without it, by design, and this
  // control read no difference there. It compares the first year whose window
  // holds the event, and asserts the year before it cannot see it yet.
  // ⚠ AND THE INVESTMENT INCOME CREDIT IS HELD OFF FOR BOTH GAMES (ff57131):
  // the credit is last year's realised return, and a landed shock's payments
  // move the pool's assets and so that return — in the seventh decimal
  // (3.65234% against 3.65239% here) — so with the credit on, the year-5 rate
  // differs with the shocks kept OUT of the experience too and this control
  // could not fail. With it off, nothing else reaches year 5: kept out, the two
  // rates are identical (measured). Shock R development, which stays in the
  // history by design, does not reach year 5 either — zeroing it changes
  // nothing there; it and a smaller residual on WC and GL arrive from year 6.
  const after = first.yearNumber + 1 + PRICING_DATA_LAG_YEARS;
  SHOCKS_OUT_OF_EXPERIENCE.enabled = false;
  INVESTMENT_INCOME_CREDIT.enabled = false;
  const withShock = playTo(open(solo.setup, solo.instance), 1, after);
  const withoutShock = playTo(open(solo.setup, generateGameInstance(ID, seedFromInstanceId(ID), schedule.filter(s => s !== first))), 1, after);
  SHOCKS_OUT_OF_EXPERIENCE.enabled = true;
  INVESTMENT_INCOME_CREDIT.enabled = true;
  if (PRICING_DATA_LAG_YEARS > 0) {
    check(pricingOf(withoutShock, after - 1) === pricingOf(withShock, after - 1),
      `control: inside the data lag (year ${after - 1}) the rate cannot see ${first.shockId} yet, even left in the experience`);
  }
  check(pricingOf(withoutShock, after) !== pricingOf(withShock, after),
    `control: the pricing comparison sees a difference when there is one (year ${after}, ${first.shockId} landed, shocks left in the experience)`);
}

console.log(failures.length === 0
  ? '\nSOLO SHOCK SCHEDULE: ALL CHECKS PASS.'
  : `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
