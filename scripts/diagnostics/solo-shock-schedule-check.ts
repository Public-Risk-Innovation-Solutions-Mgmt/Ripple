// ============================================================================
// THE SOLO SHOCK SCHEDULE — THE GATE.
//
//   npx tsx scripts/diagnostics/solo-shock-schedule-check.ts
//
//   0. SHOCKS ARE ON IN SINGLE-PLAYER (SOLO_SHOCKS on since the shocks
//      play-test landing): the app's solo game draws a schedule and fires it.
//      Switched off, it would carry none and fire nothing — that path is
//      checked too — while a hosted game fires the host's list either way.
//
// A solo game draws its shock schedule ONCE, at its start, at the catalogue's
// odds (SOLO_SHOCK_DRAW 'catalogue') on its own labelled stream
// (utils/soloGame), keeps it on the instance and so in the save, and every
// world reads it. Checked on a solo game built and played exactly as the app
// builds and plays it:
//
//   1. THE SCHEDULE is the catalogue draw's: every firing in years 2.., no
//      event twice in one year — and re-derivable from the seed alone.
//   2. EVERY WORLD FIRES THE SAME EVENTS IN THE SAME YEARS — the schedule's, and
//      nothing else — WITH THE SAME SIZES: each firing's A, R and T draws are
//      keyed on the GAME's seed (shockSeedOf), so every world strikes alike;
//      only the ordinary year is each world's own, so its loss still differs.
//   3. THE SAME SEED GIVES THE SAME SCHEDULE; another seed another.
//   4. THE SCHEDULE SURVIVES A SAVE AND RELOAD: out through packSave, back
//      through unpackSave and the replay at year 3, the reloaded game carries the same schedule
//      and its timing, and plays on to exactly the game that never stopped.
//   6. A REGIONAL EVENT STRIKES ONE REGION IN EVERY WORLD — the region the
//      instance resolved once with the schedule — on a solo schedule and a
//      host's alike, at the one size every world shares.
//   5. PRICING NEVER READS IT: a game whose schedule differs only in a year's
//      event charges the same rate and the same reinsurance in that year and
//      every later one checked — the price is struck on the shock-free shadow
//      (SHOCK_FREE_PRICING), and the cover's price is the table's.
//
// RESTATED FOR wip/large-claims-frequency: a large claim now arrives by
// frequency (not with an event) and is recorded as a shock record of its own,
// shockId LARGE_CLAIM_ID ('T'), "Large claim", one per line per year it
// arrives. Those records are not schedule events, so sections 2 and 0 compare
// the CATALOGUE events (records other than 'T') with the schedule, as before,
// and a new check 2d holds the 'T' records to the game's large-claim draw:
// in every world, a line-year carries one 'T' record exactly when
// largeClaimArrivals drew that line a claim that year, attributed exactly the
// dollars of that line-year's large claims (claims with shockId 'T'), alike in
// every world; and the averaged year says each fired in every world. The
// shocks-off solo game (section 0) still fires nothing — no 'T' record either.
// New controls: a world missing a large claim's record, a record carrying the
// wrong dollars, and one on a line that drew none are each caught by 2d.
//
// RESTATED FOR LARGE_CLAIMS_EVERY_GAME: large claims are now drawn in every
// game, shocks on or off — "shocks off" means only that no catalogue event
// fires. So section 0's shocks-off solo game (SOLO_SHOCKS off) still draws no
// schedule and fires no CATALOGUE event in any world, but it now carries 'T'
// records exactly where largeClaimArrivals drew, held by 2d's own check
// (largeClaimRecords: in every world, one exactly on each line-year drawn,
// carrying its dollars, alike in all worlds). New control:
// LARGE_CLAIMS_EVERY_GAME.enabled = false at runtime, the shocks-off game
// replayed (no 'T' record) must fail 0.
//
// ⚠ AND IT FAILS WHEN BROKEN — every check is a function over data, and THE
// CONTROLS at the foot feed each one a deliberately broken input and require it
// to fail. A control that passes is a check that cannot.
// ============================================================================

import { openSoloInstance } from '../../src/utils/soloGame';
import { drawCatalogueSchedule, SOLO_SHOCK_STREAM } from '../../src/utils/shockSchedule';
import { eventLines, firingsStartingIn, LARGE_CLAIM_ID, largeClaimArrivals, SHOCK_EVENTS } from '../../src/utils/shockLosses';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, worldInstance } from '../../src/utils/worlds';
import { packSave, unpackSave, type SavedGame } from '../../src/utils/gameSave';
import { restoreSavedGame } from '../../src/utils/saveRestore';
import { seedFromInstanceId } from '../../src/seedHash';
import { LARGE_CLAIMS_EVERY_GAME, PRICING_DATA_LAG_YEARS, SHOCK_FREE_PRICING, SHOCKS_OUT_OF_EXPERIENCE, SOLO_SHOCK_DRAW, SOLO_SHOCKS, WORLD_COUNT } from '../../src/data/pricingParameters';
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

/** 1. The catalogue draw's shape: years 2.., no event twice in a year, at least one firing (not vacuous). */
function scheduleShape(s: readonly ScheduledShock[], years: number): string[] {
  const out: string[] = [];
  if (s.length === 0) out.push('no event drawn — nothing to check');
  const ys = s.map(e => e.yearNumber);
  if (ys.some(y => y < 2 || y > years)) out.push(`a year outside 2..${years} (${ys.join(',')})`);
  const keys = s.map(e => `${e.shockId}y${e.yearNumber}`);
  if (new Set(keys).size !== keys.length) out.push(`an event drawn twice in one year (${keys.join(',')})`);
  if (s.some(e => !SHOCK_EVENTS.some(x => x.id === e.shockId))) out.push('an event outside the twelve');
  return out;
}

/** The events that STARTED in each year, in one world's rows: "y:id,id". */
function startedByYear(rows: GameState['lockedResults']): string[] {
  return rows.map((r, i) => `${i + 1}:${(r.shockEvents ?? [])
    .filter(e => e.yearFired === r.yearNumber && e.shockId !== LARGE_CLAIM_ID).map(e => e.shockId).sort().join(',')}`);
}

/**
 * 2d. The large claims' records (wip/large-claims-frequency): per world, per
 * line-year, [has a 'T' record, its attributed dollars, the dollars of the
 * line-year's large claims] — against the game's draw, `drawn` ("y|line").
 */
type LcView = { has: boolean; recorded: number; claims: number }[][];
function largeClaimView(worldRows: GameState['lockedResults'][]): LcView {
  return worldRows.map(rows => rows.flatMap((r, yi) => LINES.map(l => {
    const lr = r.byLine[l];
    const recs = (lr?.shockEvents ?? []).filter(e => e.shockId === LARGE_CLAIM_ID && e.yearFired === yi + 1);
    return {
      has: recs.length === 1 ? true : recs.length === 0 ? false : (NaN as unknown as boolean),
      recorded: recs.reduce((a, e) => a + e.attributableGrossLoss, 0),
      claims: (lr?.claims ?? []).filter(c => c.shockId === LARGE_CLAIM_ID && c.accidentYear === yi + 1).reduce((a, c) => a + c.grossUltimate, 0),
    };
  })));
}
function largeClaimRecords(view: LcView, drawn: Set<string>, years: number): string[] {
  const out: string[] = [];
  if (drawn.size === 0) out.push('the game drew no large claim — nothing measured');
  view.forEach((cells, w) => cells.forEach((c, i) => {
    const y = Math.floor(i / LINES.length) + 1, l = LINES[i % LINES.length];
    const want = drawn.has(`${y}|${l}`);
    if (c.has !== want) out.push(`world ${w + 1} year ${y} ${l}: ${c.has ? 'a' : 'no'} Large claim record, the game drew ${want ? 'one' : 'none'}`);
    else if (want && !(c.claims > 0 && Math.abs(c.recorded - c.claims) <= 1e-6 * c.claims)) {
      out.push(`world ${w + 1} year ${y} ${l}: the record carries $${c.recorded.toFixed(0)}, its large claim $${c.claims.toFixed(0)}`);
    }
  }));
  const forms = new Set(view.map(cells => JSON.stringify(cells.map(c => [c.has, c.recorded]))));
  if (forms.size !== 1) out.push(`the large claims' records differ across worlds (${forms.size} forms)`);
  if (view[0] && view[0].length !== years * LINES.length) out.push(`${view[0].length} line-years read, ${years * LINES.length} played`);
  return out;
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

/** 2b. Severity is the game's: each firing's size draws are the same in every world. */
function severityShared(instances: GameInstance[], schedule: readonly ScheduledShock[]): string[] {
  const out: string[] = [];
  for (const s of schedule) {
    const draws = instances.map(inst => JSON.stringify(
      firingsStartingIn(inst, 'host', s.yearNumber).find(f => f.event.id === s.shockId)?.draws ?? null));
    if (draws.includes('null')) out.push(`${s.shockId} in year ${s.yearNumber}: not fired in every world`);
    else if (new Set(draws).size !== 1) out.push(`${s.shockId} in year ${s.yearNumber}: ${new Set(draws).size} distinct draws of ${draws.length}`);
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

console.log('\n--- 0. shocks are on in single-player ---');
/**
 * Problems with a solo game that must fire no catalogue event: a schedule, or
 * any world's catalogue firing — and (LARGE_CLAIMS_EVERY_GAME) its 'T' records
 * not exactly where largeClaimArrivals drew (2d's check).
 */
function firesNothing(gs: GameState): string[] {
  const bad: string[] = [];
  if ((gs.instance.scheduledShocks ?? []).length > 0) bad.push(`the instance carries ${gs.instance.scheduledShocks!.length} scheduled event(s)`);
  for (const [i, w] of (gs.worlds ?? []).entries()) for (const r of w.lockedResults) {
    const fired = (r.shockEvents ?? []).filter(e => e.yearFired === r.yearNumber && e.shockId !== LARGE_CLAIM_ID);
    if (fired.length > 0) bad.push(`world ${i + 1} year ${r.yearNumber}: ${fired.map(e => e.shockId).join(', ')} fired`);
  }
  const years = gs.lockedResults.length;
  const drawn = new Set<string>();
  for (let y = 1; y <= years; y++) for (const a of largeClaimArrivals(gs.instance, y)) drawn.add(`${y}|${a.line}`);
  bad.push(...largeClaimRecords(largeClaimView((gs.worlds ?? []).map(w => w.lockedResults)), drawn, years).map(p => `large claims: ${p}`));
  return bad;
}
const onSolo = openSoloInstance(settingsFor('SSOFF1'));
check(SOLO_SHOCKS.enabled && SOLO_SHOCK_DRAW === 'catalogue' && (onSolo.instance.scheduledShocks ?? []).length > 0,
  'single-player shocks are on, drawn at the catalogue\'s odds, and the app\'s solo game carries a schedule',
  `${(onSolo.instance.scheduledShocks ?? []).length} event(s)`);
// Switched off, the same game draws nothing and fires no catalogue event — but
// its large claims arrive where its seed drew them (LARGE_CLAIMS_EVERY_GAME).
SOLO_SHOCKS.enabled = false;
const offSolo = openSoloInstance(settingsFor('SSOFF1'));
const OFF = playTo(open(offSolo.setup, offSolo.instance), 1, YEARS);
SOLO_SHOCKS.enabled = true;
check(firesNothing(OFF).length === 0,
  `switched off, a single-player game draws no schedule and fires no catalogue event in any of ${WORLD_COUNT} worlds over ${YEARS} years; its 'T' records exactly where largeClaimArrivals drew`,
  firesNothing(OFF)[0] ?? `T in ${[...new Set(OFF.lockedResults.flatMap(r => (r.shockEvents ?? []).filter(e => e.shockId === LARGE_CLAIM_ID).map(e => `${r.yearNumber}|${e.linesAffected.join('+')}`)))].join(', ') || 'none'}`);

const ID = 'SSCHK1';
const solo = openSoloInstance(settingsFor(ID));
const schedule = solo.instance.scheduledShocks ?? [];
const A = playTo(open(solo.setup, solo.instance), 1, YEARS);
const worldRows = A.worlds!.map(w => w.lockedResults);
const worldInstances = A.worlds!.map((_, i) => worldInstance(A.instance, i));
const drawnA = new Set<string>();
for (let y = 1; y <= YEARS; y++) for (const a of largeClaimArrivals(A.instance, y)) drawnA.add(`${y}|${a.line}`);
console.log(`  schedule: ${schedule.map(s => `${s.shockId} in year ${s.yearNumber}`).join('; ')}`);

console.log('\n--- 1. the schedule is the catalogue draw\'s, drawn once ---');
check(solo.setup.shockTiming === 'solo', 'the solo setup is marked to fire its schedule');
check(scheduleShape(schedule, YEARS).length === 0, `${schedule.length} firing(s), years 2-${YEARS}, no event twice in a year`, scheduleShape(schedule, YEARS)[0] ?? '');
const idYear = (s: readonly ScheduledShock[]) => s.map(e => ({ shockId: e.shockId, yearNumber: e.yearNumber }));
check(same(idYear(schedule), drawCatalogueSchedule(ID, YEARS, SOLO_SHOCK_STREAM)), 're-derived from the seed alone, on the solo stream');
check(worldInstances.every(i => same(i.scheduledShocks, schedule)) && new Set(worldInstances.map(i => i.seed)).size === WORLD_COUNT,
  'every world\'s instance carries the one schedule, on its own seed');

console.log('\n--- 2. every world fires the same events in the same years, at the same sizes ---');
{
  const bad = sameEventsEveryWorld(worldRows, schedule);
  check(bad.length === 0, `all ${WORLD_COUNT} worlds fire exactly the schedule's events, in its years`, bad[0] ?? '');
  const avgAll = A.lockedResults.flatMap(r => (r.shockEvents ?? []).filter(e => e.yearFired === r.yearNumber));
  const avg = avgAll.filter(e => e.shockId !== LARGE_CLAIM_ID);
  check(avg.length === schedule.length && avg.every(e => e.worlds?.fired === WORLD_COUNT),
    `the averaged year says each fired in ${WORLD_COUNT} of ${WORLD_COUNT} worlds`, avg.map(e => `${e.shockId} ${e.worlds?.fired}`).join(', '));
  const sev = severityShared(worldInstances, schedule);
  check(sev.length === 0, 'each firing\'s size draws are the game\'s, the same in every world', sev[0] ?? '');
  const differing = lossesDiffer(worldRows, schedule);
  check(differing > 0, `and the loss it books differs across worlds (${differing} of ${schedule.length} events)`);
  const lc = largeClaimRecords(largeClaimView(worldRows), drawnA, YEARS);
  const avgT = avgAll.filter(e => e.shockId === LARGE_CLAIM_ID);
  check(lc.length === 0 && avgT.length > 0 && avgT.every(e => e.worlds?.fired === WORLD_COUNT && e.name === 'Large claim'),
    `2d. large claims by frequency: a "Large claim" record exactly where the game drew one (${[...drawnA].join(', ')}), carrying its dollars, alike in all ${WORLD_COUNT} worlds`,
    lc[0] ?? avgT.map(e => `T${e.yearFired} ${e.worlds?.fired}`).join(', '));
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
    .filter(e => e.yearFired === r.yearNumber && e.shockId !== LARGE_CLAIM_ID).map(e => `${e.shockId}y${e.yearFired}`)))].sort();
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
  const sevH = severityShared(H.worlds!.map((_, i) => worldInstance(H.instance, i)), hostSched);
  check(sevH.length === 0, 'at each firing\'s one size, the same in every world', sevH[0] ?? '');
}

console.log('\n--- 3. the same seed gives the same schedule ---');
const again = openSoloInstance(settingsFor(ID));
check(same(again.instance.scheduledShocks, schedule), 'the same seed, drawn again, gives the same schedule');
const other = openSoloInstance(settingsFor('SSCHK2'));
check(!same(other.instance.scheduledShocks, schedule), 'another seed gives another');
check(!same(drawCatalogueSchedule(ID, YEARS, 'host_shock_schedule'), idYear(schedule)), 'and the solo stream is its own, not the host\'s');

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
  // Single-player shocks switched off: the solo game the app builds carries no schedule.
  check(!((offSolo.instance.scheduledShocks ?? []).length > 0),
    'control: single-player shocks switched off are caught by 0 (no schedule)');
  // LARGE_CLAIMS_EVERY_GAME switched off: the shocks-off game, replayed to its
  // first large claim's year (kept short for the FAST budget), records none.
  {
    const firstT = Array.from({ length: YEARS }, (_, i) => i + 1).find(y => largeClaimArrivals(offSolo.instance, y).length > 0) ?? YEARS;
    LARGE_CLAIMS_EVERY_GAME.enabled = false; SOLO_SHOCKS.enabled = false;
    let noLarge: GameState;
    try { noLarge = playTo(open(offSolo.setup, offSolo.instance), 1, firstT); } finally { LARGE_CLAIMS_EVERY_GAME.enabled = true; SOLO_SHOCKS.enabled = true; }
    check(firesNothing(noLarge).length > 0, 'control: LARGE_CLAIMS_EVERY_GAME switched off (no \'T\' record in the shocks-off game) is caught by 0');
  }
  // A catalogue event in the shocks-off game's rows is caught by 0.
  check(firesNothing({ ...OFF, worlds: OFF.worlds!.map((w, i) => (i === 0 ? { ...w, lockedResults: w.lockedResults.map((r, yi) => (yi === 2
    ? { ...r, shockEvents: [...(r.shockEvents ?? []), { ...(r.shockEvents?.[0] ?? {}), shockId: '#3', yearFired: r.yearNumber } as never] } : r)) } : w)) }).length > 0,
    'control: a catalogue event fired in the shocks-off game is caught by 0');
  // Timing drawn per world: the bare instance, fired by the catalogue in each world.
  const bareSetup = { ...settingsFor(ID) };
  const bare = playTo(open(bareSetup, generateGameInstance(ID, seedFromInstanceId(ID))), 1, YEARS);
  check(sameEventsEveryWorld(bare.worlds!.map(w => w.lockedResults), schedule).length > 0,
    'control: shock timing drawn per world is caught');
  // A schedule breaking the rule.
  check(scheduleShape([...schedule, { ...schedule[0] }], YEARS).length > 0, 'control: a schedule outside the rule is caught');
  // Severity drawn per world: each world's instance without the game's seed, so its own keys the draws.
  check(severityShared(worldInstances.map(i => ({ ...i, marketSeed: undefined })), schedule).length > 0,
    'control: severity drawn per world is caught');
  check(scheduleShape([], YEARS).length > 0, 'control: an empty schedule is caught as nothing checked');
  // Regions drawn per world: the same host list on an instance whose entries carry none.
  const unresolved = { ...hostInst, scheduledShocks: HOST_LIST.map(s => ({ ...s })) };
  const P = playTo(open({ ...settingsFor('SSHOST'), shockTiming: 'host' }, unresolved), 1, 3);
  check(regionsByWorld(P.worlds!.map((_, i) => worldInstance(P.instance, i)), P.worlds!.map(w => w.lockedResults), hostSched).length > 0,
    'control: a region drawn per world is caught');
  check(lossesDiffer(worldRows.map(() => worldRows[0]), schedule) === 0,
    'control: one world\'s losses in every world are caught');
  {
    const v = largeClaimView(worldRows);
    const at = v[0].findIndex(c => c.has === true);
    const edit = (f: (c: LcView[0][0]) => LcView[0][0], w = 0, i = at) => v.map((cells, wi) => cells.map((c, ci) => (wi === w && ci === i ? f(c) : c)));
    check(at >= 0 && largeClaimRecords(edit(c => ({ ...c, has: false, recorded: 0 }), WORLD_COUNT - 1), drawnA, YEARS).length > 0,
      'control: a world missing a large claim\'s record is caught by 2d');
    check(at >= 0 && largeClaimRecords(v.map(cells => cells.map((c, ci) => (ci === at ? { ...c, recorded: c.recorded * 0.5 } : c))), drawnA, YEARS).length > 0,
      'control: a large claim\'s record carrying the wrong dollars (in every world) is caught by 2d');
    const none = v[0].findIndex(c => c.has === false);
    check(none >= 0 && largeClaimRecords(v.map(cells => cells.map((c, ci) => (ci === none ? { has: true, recorded: 1e6, claims: 1e6 } : c))), drawnA, YEARS).length > 0,
      'control: a large claim recorded on a line-year that drew none is caught by 2d');
  }
  // A schedule redrawn per load: a reload that loses it.
  const lost = { ...reloaded!, instance: { ...reloaded!.instance, scheduledShocks: drawCatalogueSchedule('SSCHK2', YEARS, SOLO_SHOCK_STREAM) } };
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
  // ⚠ SINCE THE SHOCKS LANDING THE PRICE IS STRUCK ON THE SHOCK-FREE SHADOW
  // (SHOCK_FREE_PRICING), so the switch this control flips is that one: with
  // the shadow off and the shocks left in the experience, the landed event
  // reaches the rate. Shipped (shadow on), check 5's years all price alike.
  // ⚠ AND ON AN EVENT THAT ACTS ON A LINE: an Investment Loss (this seed's
  // first event) never reaches the rate whatever the switches, by design, so
  // the control could not fail on it.
  const onLine = schedule.find(s => eventLines(SHOCK_EVENTS.find(e => e.id === s.shockId)!.name).length > 0)!;
  const after = onLine.yearNumber + 1 + PRICING_DATA_LAG_YEARS;
  const withoutOnLine = generateGameInstance(ID, seedFromInstanceId(ID), schedule.filter(s => s !== onLine));
  {
    // A is this very game, shipped, already played to the last year.
    const shipped = A;
    const shippedWithout = playTo(open(solo.setup, withoutOnLine), 1, after);
    check(pricingOf(shippedWithout, after) === pricingOf(shipped, after),
      `5. and in year ${after}, after ${onLine.shockId} (year ${onLine.yearNumber}) has landed: the same rate and reinsurance, shipped`);
  }
  SHOCK_FREE_PRICING.enabled = false;
  SHOCKS_OUT_OF_EXPERIENCE.enabled = false;
  const withShock = playTo(open(solo.setup, solo.instance), 1, after);
  const withoutShock = playTo(open(solo.setup, withoutOnLine), 1, after);
  SHOCKS_OUT_OF_EXPERIENCE.enabled = true;
  SHOCK_FREE_PRICING.enabled = true;
  if (PRICING_DATA_LAG_YEARS > 0) {
    check(pricingOf(withoutShock, after - 1) === pricingOf(withShock, after - 1),
      `control: inside the data lag (year ${after - 1}) the rate cannot see ${onLine.shockId} yet, even left in the experience`);
  }
  check(pricingOf(withoutShock, after) !== pricingOf(withShock, after),
    `control: the pricing comparison sees a difference when there is one (year ${after}, ${onLine.shockId} landed, shadow off, shocks left in the experience)`);
}

console.log(failures.length === 0
  ? '\nSOLO SHOCK SCHEDULE: ALL CHECKS PASS.'
  : `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
