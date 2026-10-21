// ============================================================================
// SAVE, RELOAD, CONTINUE — and get the same game.
//
// Run:  npx tsx scripts/diagnostics/save-round-trip-check.ts
//       YEARS=10 SAVE_AT=4 GAMES=5 npx tsx scripts/diagnostics/save-round-trip-check.ts
//
// ⚠ THE SAVE KEEPS THE AVERAGES ONLY, AND A RELOAD IS A REPLAY (stable-scenarios
// commit 10). The save holds the setup, the instance, every played year's
// decisions and loan choices, the averaged rows and world 1's claim rows — not
// the worlds, not the pool state, not the pre-game. A reload rebuilds the
// opening and replays the years (utils/saveRestore.ts). So:
//
//   1. THE RELOAD SHOWS EXACTLY WHAT THE GAME SHOWED: every figure a screen
//      reads — the averaged rows, the pre-game, the pool state, the spread at
//      every year and scope, the Annual Statement at every scope, world 1 whole
//      (the claims download) and every world's own state — is the same after
//      the reload as before it, and the replay says it matched the saved rows.
//   2. THE SAVE HOLDS THE AVERAGES ONLY: no worlds, no pool state, no pre-game.
//   3. AND THE GAME GOES ON THE SAME: continued from the reload to year N, it
//      agrees year by year with the game played straight through — the
//      averaged state, the rows, the pre-game and every world.
//
// The games vary their decisions by year, so a replay on the wrong year's
// decisions shows. ⚠ AND IT FAILS WHEN BROKEN — THE CONTROLS: a replay on the
// default decisions, a save whose world 1 claims were lost, and the codec's own
// (a flipped character, an uncompressed save).
//
// WHAT IT CANNOT SEE: anything the browser does — quota is save-size-check's
// job; the reload's progress and timing in Chromium are commit 10's report.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, surplusRange } from '../../src/utils/worlds';
import { buildAnnualStatement } from '../../src/utils/resultsStatement';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { serialiseSave, packSave, unpackSave, decodeSave, saveStrippedKeys, type SavedGame } from '../../src/utils/gameSave';
import { restoreSavedGame } from '../../src/utils/saveRestore';
import { regenerateLineYearClaims, ClaimRegenerationError } from '../../src/utils/claimRegeneration';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = Number(process.env.YEARS ?? 10);
const SAVE_AT = Number(process.env.SAVE_AT ?? 4);   // the year the old save first failed
// Two games by default since the hundred worlds (commit 10): about 50 s; GAMES=4 for more.
const GAMES = Number(process.env.GAMES ?? 2);

const STRIPPED = saveStrippedKeys();
const failed: string[] = [];
const fail = (s: string) => { if (failed.length < 30) failed.push(s); };
const RULE = '='.repeat(72);

function start(id: string, seed: number): GameState {
  const inst = generateGameInstance(id, seed);
  const setup = { poolName: 'R', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(inst, setup as never);
  return openWorlds({
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory,
  });
}

/** The year's decisions: the defaults, varied by year so a replay on the wrong ones shows. */
function decide(y: number): DecisionSet {
  const d = defaultDecisionSet(y);
  if (y % 2 === 0) { d.byLine.WC.fundingAtExpected = false; d.byLine.WC.fundingConfidenceLevel = 0.9; }
  if (y % 3 === 0) d.byLine.GL.reinsuranceOption = 'catastrophe';
  return d;
}

function advance(gs: GameState, y: number, d: (y: number) => DecisionSet = decide): GameState {
  const settled = settleWorldsYear(gs, playWorldsYear(gs, d(y)), []);
  return {
    ...gs, ...commitSettledYear(gs, settled),
    currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1),
  };
}

/**
 * WHAT A PLAYER SEES, AND WHAT THE NEXT YEAR READS — every figure a screen
 * reads: the averaged rows, the pre-game, the pool state, the spread at every
 * year and scope, the Annual Statement at every scope, world 1 whole (the
 * claims download reads its registers), and every world's own state and rows.
 */
function playerView(gs: GameState): unknown {
  const scopes = ['pool', ...LINES] as const;
  return JSON.parse(JSON.stringify({
    lockedResults: gs.lockedResults, priorHistory: gs.priorHistory, earlyPreGameHistory: gs.earlyPreGameHistory,
    poolState: gs.poolState, worlds: gs.worlds, playedYears: gs.playedYears,
    spread: gs.lockedResults.flatMap(r => scopes.map(s => surplusRange(gs, r.yearNumber, s === 'pool' ? undefined : s))),
    statements: scopes.map(s => buildAnnualStatement(gs, s)),
  }));
}

/**
 * Walk two parsed structures and report the first differences by path.
 *
 * ⚠ THE STRIPPED KEYS ARE SKIPPED, and that is the whole subtlety of this gate.
 * They are EXPECTED to differ — arm A carries them, arm B does not. Comparing
 * them would fail every run for the intended reason and drown the unintended
 * ones. Skipping them means this gate says nothing about whether their absence
 * matters, which is what the DEGRADATION section below is for.
 */
function diff(a: unknown, b: unknown, path: string, out: string[], depth = 0): void {
  if (out.length >= 12 || depth > 40) return;
  if (a === b) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return;
    if (Math.abs(a - b) > 1e-9) out.push(`${path}: ${a} !== ${b}`);
    return;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) out.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${path}: array/object mismatch`); return; }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push(`${path}: length ${a.length} !== ${b.length}`); return; }
    for (let i = 0; i < a.length; i++) diff(a[i], b[i], `${path}[${i}]`, out, depth + 1);
    return;
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (STRIPPED.includes(k)) continue;
    // ⚠ ABSENT AND PRESENT-BUT-UNDEFINED ARE THE SAME THING HERE, and this is a
    // correction to the comparison rather than a relaxation of the gate.
    // JSON.stringify DROPS a key whose value is undefined, so every optional
    // field the engine left unset — shockEvents, claimCount, claimCountsByClass
    // — is `{k: undefined}` on the straight-through arm and simply absent after
    // a round trip. `o.k === undefined` is true either way, so no consumer in
    // the codebase can distinguish them and neither should this. The first run
    // of this gate reported 24 such "differences" and none of them were real.
    //
    // The distinction that WOULD matter — a key that carried a value and lost
    // it — still fails below, because then one side is not undefined.
    const av = ao[k], bv = bo[k];
    if (av === undefined && bv === undefined) continue;
    diff(av, bv, `${path}.${k}`, out, depth + 1);
  }
}

(async () => {
console.log('=== SAVE ROUND TRIP — A RELOAD BY REPLAY ===');
console.log(`${GAMES} games, ${YEARS} years, saved after year ${SAVE_AT} and reloaded by replay, all three lines.\n`);

let compared = 0, viewsSame = 0, averagesOnly = 0, claimRows = 0;
let defaultsCaught = false, claimsCaught = false;
const reload = async (gs: GameState) => {
  const saved = (unpackSave(packSave({ gameState: gs, startingFinancials: null, initialMembers: null, currentDecisions: gs.currentDecisions })) as
    { gameState: SavedGame }).gameState;
  return { saved, restored: await restoreSavedGame(saved, null, undefined, async () => {}) };
};

for (let g = 0; g < GAMES; g++) {
  const id = `RT${g}`;
  const seed = 3_300_000 + g * 6421;

  // --- ARM A: straight through -------------------------------------------
  let a = start(id, seed);
  for (let y = 1; y <= YEARS; y++) a = advance(a, y);

  // --- ARM B: save at SAVE_AT, reload by replay, continue -----------------
  let b = start(id, seed);
  for (let y = 1; y <= SAVE_AT; y++) b = advance(b, y);
  const { saved, restored } = await reload(b);

  // --- 2. the averages only ------------------------------------------------
  const keys = Object.keys(saved);
  if (keys.some(k => ['worlds', 'poolState', 'priorHistory', 'earlyPreGameHistory'].includes(k))) {
    fail(`g${g}: the save holds more than the averages — ${keys.join(', ')}`);
  } else averagesOnly++;
  claimRows += saved.world1Claims.reduce((t, r) => t + LINES.reduce((u, l) => u + ((r[l]?.claims as unknown[] | undefined)?.length ?? 0), 0), 0);

  // --- 1. what the player sees, before and after the reload ----------------
  {
    const view: string[] = [];
    diff(playerView(b), playerView(restored.gameState), `g${g}.view`, view);
    if (view.length > 0 || !restored.matches) fail(`g${g}: the reloaded game does not show what the game showed — ${view[0] ?? 'the replay did not match the saved rows'}`);
    else viewsSame++;
    if (g === 0) {
      // THE CONTROLS: a replay on the default decisions, and a save whose
      // world 1 claims were lost, must each be caught.
      const onDefaults = await restoreSavedGame({ ...saved, playedYears: (saved.playedYears as { decisions: DecisionSet; yearNumber: number }[])
        .map(p => ({ ...p, decisions: defaultDecisionSet(p.yearNumber) })) }, null, undefined, async () => {});
      const ctl: string[] = [];
      diff(playerView(b), playerView(onDefaults.gameState), 'control', ctl);
      defaultsCaught = ctl.length > 0 && !onDefaults.matches;
      const lost = await restoreSavedGame({ ...saved, world1Claims: saved.world1Claims.map(() => ({})) }, null, undefined, async () => {});
      claimsCaught = !lost.matches;
    }
  }

  // --- 3. and the game goes on the same ------------------------------------
  let c = restored.gameState;
  for (let y = SAVE_AT + 1; y <= YEARS; y++) c = advance(c, y);
  const out: string[] = [];
  diff(a.poolState, c.poolState, `g${g}.poolState`, out);
  diff(a.lockedResults, c.lockedResults, `g${g}.lockedResults`, out);
  diff(a.priorHistory, c.priorHistory, `g${g}.priorHistory`, out);
  diff(a.worlds, c.worlds, `g${g}.worlds`, out);
  if (a.currentYearNumber !== c.currentYearNumber) out.push(`g${g}.currentYearNumber: ${a.currentYearNumber} !== ${c.currentYearNumber}`);
  compared++;
  for (const d of out) fail(d);
  console.log(`  game ${g}  ${out.length === 0 ? 'MATCH' : `${out.length} DIFFERENCE(S)`}`);
}

// Regeneration refuses on the new engine: world 1's register comes back by
// replay, never redrawn by the old generators.
{
  const a = start('RT0', 3_300_000);
  let refused = false;
  try { regenerateLineYearClaims(a.instance, a.priorHistory[0], 'GL'); } catch (e) { refused = e instanceof ClaimRegenerationError; }
  if (!refused) fail('regeneration redrew a new-engine register instead of refusing');
}

// ============================================================================
// THE CODEC, ON ITS OWN TERMS.
//
// The comparison above already runs through it, and that is the real test. This
// section covers the two things that comparison structurally cannot see: that
// the codec is byte-exact rather than merely good enough for the fields the
// engine happens to read, and that a save it did not write is REJECTED rather
// than half-understood.
// ============================================================================
{
  let a = start('CODEC', 7_711_003);
  for (let y = 1; y <= SAVE_AT; y++) a = advance(a, y);
  const env = {
    gameState: a, startingFinancials: null, initialMembers: null, currentDecisions: a.currentDecisions,
  };
  const raw = serialiseSave(env);
  const packed = packSave(env);

  // ⚠ BYTE-EXACT, NOT FIELD-EQUAL. decodeSave(packSave(x)) must reproduce
  // serialiseSave(x) CHARACTER FOR CHARACTER. Comparing parsed objects would
  // hide a codec that mangled a field nothing in the engine reads today, and
  // "nothing reads it today" is how the claims register ended up in the save.
  const back = decodeSave(packed);
  if (back !== raw) {
    const at = (() => { for (let i = 0; i < Math.max(raw.length, back.length); i++) if (raw[i] !== back[i]) return i; return -1; })();
    fail(`THE CODEC IS LOSSY: decodeSave(packSave(x)) !== serialiseSave(x), first difference at `
      + `character ${at} (${JSON.stringify(raw.slice(at, at + 40))} vs ${JSON.stringify(back.slice(at, at + 40))}). `
      + `Every simulation value on the far side of a reload is suspect.`);
  }

  // ⚠ THE POSITIVE CONTROL FOR THE COMPARISON ABOVE. Change one character of
  // the payload and the decode must NOT come back equal to the original —
  // either it throws, or it returns something different. If a corrupted payload
  // decoded cleanly to the right answer, `back !== raw` could never fire and
  // the check above would be decorative.
  const i = Math.floor(packed.length / 2);
  const corrupt = packed.slice(0, i) + (packed[i] === 'A' ? 'B' : 'A') + packed.slice(i + 1);
  let corruptDetected = false;
  try { corruptDetected = decodeSave(corrupt) !== raw; } catch { corruptDetected = true; }
  if (!corruptDetected) {
    fail('POSITIVE CONTROL FAILED: a payload with a flipped character decoded back to the '
      + 'original save, so the byte-exact comparison above cannot detect a codec fault');
  }

  // ⚠ AN UNCOMPRESSED SAVE MUST BE REJECTED, AND THAT IS THE DESIGNED
  // BEHAVIOUR RATHER THAN A GAP. There is no format detection and no migration
  // — see gameSave.ts. A save written before this commit is raw JSON, which is
  // not base64, and the loader's catch clears the key. The failure this guards
  // against is the opposite one: a decode that SUCCEEDS on raw JSON and hands
  // the engine a half-parsed object.
  let legacyRejected = false;
  try { decodeSave(raw); } catch { legacyRejected = true; }
  if (!legacyRejected) {
    fail('an uncompressed (pre-compression) save was accepted by decodeSave instead of throwing — '
      + 'the loader would hand the engine whatever that produced rather than starting a new game');
  }

  console.log('');
  console.log('THE CODEC:');
  console.log(`  ${raw.length.toLocaleString()} raw -> ${packed.length.toLocaleString()} stored `
    + `(${(raw.length / packed.length).toFixed(2)}x), byte-exact on the way back: `
    + `${back === raw ? 'yes' : 'NO'}`);
  console.log(`  corrupted payload detected: ${corruptDetected ? 'yes' : 'NO'}   `
    + `uncompressed save rejected: ${legacyRejected ? 'yes' : 'NO'}`);
}

console.log('');
console.log('WHAT A PLAYER SEES, BEFORE AND AFTER THE RELOAD:');
console.log(`  games whose reload shows exactly what the game showed: ${viewsSame} of ${GAMES}`);
console.log(`  saves holding the averages only: ${averagesOnly} of ${GAMES}; world 1 claim rows kept: ${claimRows}`);
console.log(`  control — a replay on the default decisions: ${defaultsCaught ? 'caught' : 'MISSED'}`);
console.log(`  control — a save whose world 1 claims were lost: ${claimsCaught ? 'caught' : 'MISSED'}`);
if (!defaultsCaught) fail('control: a replay on the default decisions was not caught');
if (!claimsCaught) fail('control: a save whose world 1 claims were lost was not caught');
if (claimRows === 0) fail('no world 1 claim rows in any save — the claims comparison compared nothing');

console.log('');
console.log(RULE);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log(`PASS — ${compared} games reload by replay to exactly what they showed after year ${SAVE_AT},`);
  console.log('       and agree year for year afterwards with the game that never stopped.');
  console.log(RULE);
}
})();
