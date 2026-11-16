// ============================================================================
// MID-GAME EDITS NEVER CHANGE A PLAYED YEAR — A GATE (wip/mid-game-edits).
//
//   npx tsx scripts/diagnostics/mid-game-edit-check.ts
//
// A hosted team's game, built from the room and replayed as every reload,
// rejoin and viewer replays it (buildTeamGame + replayTeamYears):
//
//   1. PLAYED YEARS ARE BYTE-IDENTICAL AFTER AN EDIT. Two years played; the
//      host then edits the CURRENT year (3) and a FUTURE one (4) through
//      applyGameEdit — a shock added to each, a line's development level moved
//      — and a second device rebuilds from the edited room: the opening and
//      years 1-2 come back byte-identical (every field of every result).
//   2. AND THE EDIT TAKES: year 3 differs between the two rooms, so the
//      identity in 1 is not a game that ignores its settings.
//   3. THE SWITCH IS PINNED: a room set up with NO shocks, a shock added to a
//      future year — played years still byte-identical (the pin, shocksOn).
//   4. THE RULES REFUSE A PLAYED YEAR: applyGameEdit throws on year 2 once
//      year 3 is current, and a year past the game.
//   5. A ROOM NEVER EDITED BUILDS AS BEFORE: no levels by year, no pin.
//
// ⚠ AND EACH FAILS WHEN BROKEN: the controls rebuild from a room whose
// PLAYED year 2 was edited (the rule bypassed), and from the no-shock room with
// the shock added but the switch NOT pinned — both must break section 1's
// identity — and feed 2 an "edit" that changes nothing.
// ============================================================================

import { buildTeamGame, replayTeamYears } from '../../src/session/client/buildGame';
import { applyGameEdit, GameEditError, type YearSettings } from '../../src/utils/gameEdits';
import { SHOCK_EVENTS } from '../../src/utils/shockLosses';
import type { RoomView } from '../../src/session/contract';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

type Room = Pick<RoomView, 'seed' | 'yearCount' | 'startingYear' | 'eventName' | 'poolName' | 'shocks' | 'priorDevelopment'
  | 'developmentLevels' | 'developmentLevelsByYear' | 'shocksOn'>;
const base = (shocks: { shockId: string; yearNumber: number }[]): Room => ({
  seed: '7', yearCount: 5, startingYear: 2027, eventName: 'E', poolName: 'P', shocks, priorDevelopment: {},
  developmentLevels: { WC: 'Low', GL: 'Low', Property: 'Low' },
});

/** The opening and every played year's result, as JSON, through `to` - 1. */
function played(room: Room, to: number): { years: Map<number, string>; state: GameState } {
  const built = buildTeamGame(room as RoomView, LINES);
  const years = new Map<number, string>([[0, JSON.stringify(built.opening?.result ?? null)]]);
  const r = replayTeamYears(built.gameState, to, undefined);
  for (const p of r.produced) years.set(p.result.yearNumber, JSON.stringify(p.result));
  return { years, state: r.state };
}

/** Years 0..n-1 identical between two plays: the names of those that differ. */
const differing = (a: Map<number, string>, b: Map<number, string>, upTo: number) =>
  Array.from({ length: upTo }, (_, y) => y).filter(y => a.get(y) === undefined || a.get(y) !== b.get(y));

/** Apply an edit as the host would: the shared rules, the switch pinned. */
function edited(room: Room, years: Record<string, YearSettings>, firstEditable: number, pin = true): Room {
  const out = applyGameEdit(
    { developmentLevels: room.developmentLevels ?? {}, developmentLevelsByYear: room.developmentLevelsByYear, shocks: room.shocks },
    years, { firstEditable, yearCount: room.yearCount, lines: LINES, by: 'Host', now: 0 },
  );
  return {
    ...room, shocks: out.settings.shocks,
    ...(out.settings.developmentLevelsByYear ? { developmentLevelsByYear: out.settings.developmentLevelsByYear } : {}),
    ...(pin ? { shocksOn: room.shocksOn ?? room.shocks.length > 0 } : {}),
  };
}

const ids = SHOCK_EVENTS.map(e => e.id);
const [A, B] = [ids[1], ids[4]];
console.log(`MID-GAME EDITS — seed 7, five years, three lines; shocks ${A}, ${B}`);

// ---- 1 & 2: a room with a shock in year 2; years 1-2 played; edit years 3 and 4
const room0 = base([{ shockId: A, yearNumber: 2 }]);
const before = played(room0, 3);
const cur = 3;
const edit: Record<string, YearSettings> = {
  '3': { developmentLevels: { WC: 'High', GL: 'Low', Property: 'Mid' }, shocks: [B] },
  '4': { developmentLevels: { WC: 'High', GL: 'Low', Property: 'Mid' }, shocks: [A, B] },
};
const room1 = edited(room0, edit, cur);
const after = played(room1, 3);
function gradeIdentity(a: Map<number, string>, b: Map<number, string>, tag: string) {
  const d = differing(a, b, cur);
  check(d.length === 0 && a.size === cur, `${tag}1. the opening and every played year (1-${cur - 1}) are byte-identical after the host edits years ${cur} and ${cur + 1}`,
    d.length ? `differ: ${d.join(', ')}` : `${a.size} results, every field`);
}
gradeIdentity(before.years, after.years, '');
function gradeTakes(a: Room, b: Room, tag: string) {
  const x = played(a, cur + 1).years.get(cur), y = played(b, cur + 1).years.get(cur);
  check(x !== undefined && y !== undefined && x !== y, `${tag}2. and the edit takes: year ${cur} plays differently on the edited room`);
}
gradeTakes(room0, room1, '');

// ---- 3: no shocks at setup, one added to year 4 — the pinned switch holds the played years
const quiet0 = base([]);
const quietBefore = played(quiet0, 3);
const quietEdit: Record<string, YearSettings> = { '4': { developmentLevels: { WC: 'Low', GL: 'Low', Property: 'Low' }, shocks: [A] } };
const quiet1 = edited(quiet0, quietEdit, cur);
const qd = differing(quietBefore.years, played(quiet1, 3).years, cur);
check(qd.length === 0 && quiet1.shocksOn === false,
  '3. a room set up with no shocks, one added to year 4: played years byte-identical, the switch pinned off',
  qd.length ? `differ: ${qd.join(', ')}` : `shocksOn ${quiet1.shocksOn}`);

// ---- 4: the rules refuse a played year and a year past the game
const refuses = (years: Record<string, YearSettings>) => {
  try { applyGameEdit({ developmentLevels: {}, shocks: [] }, years, { firstEditable: cur, yearCount: 5, lines: LINES, by: 'Host', now: 0 }); return false; }
  catch (e) { return e instanceof GameEditError; }
};
check(refuses({ '2': edit['3'] }) && refuses({ '6': edit['3'] }) && !refuses({ '3': edit['3'] }),
  '4. the rules refuse a played year (2, with 3 current) and a year past the game (6), and accept the current year');

// ---- 5: a room never edited builds as before
const plain = buildTeamGame(room0 as RoomView, LINES).gameState.setup;
check(plain.developmentLevelsByYear === undefined && plain.shocksOn === undefined,
  '5. a room never edited carries no levels by year and no pinned switch');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const n = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  check(failures.splice(n).some(f => f.startsWith(expect)), `control: ${name} is caught by ${expect}`);
};
controlFails('a PLAYED year (2) edited, the rule bypassed', () => {
  const bad = edited(room0, { '2': { developmentLevels: { WC: 'High', GL: 'High', Property: 'High' }, shocks: [A, B] } }, 2);
  gradeIdentity(before.years, played(bad, 3).years, '');
}, '1.');
controlFails('the no-shock room with a shock added and the switch NOT pinned', () => {
  gradeIdentity(quietBefore.years, played(edited(quiet0, quietEdit, cur, false), 3).years, '');
}, '1.');
controlFails('an "edit" that changes nothing', () => gradeTakes(room0, room0, ''), '2.');

console.log('');
if (failures.length) {
  console.log('='.repeat(72));
  console.log(`${failures.length} CHECK(S) FAILED:\n  ${failures.join('\n  ')}`);
  console.log('='.repeat(72));
  process.exit(1);
}
console.log('PASS — an edit to the current or a later year leaves the opening and every played year byte-identical on a rebuild, and takes in its own year.');
