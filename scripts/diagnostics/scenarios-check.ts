// ============================================================================
// THE TWENTY SCENARIOS — THE GATE (stable-scenarios commit 9).
//
//   npx tsx scripts/diagnostics/scenarios-check.ts
//
//   1. SETUP OFFERS EXACTLY 1 TO 20: solo setup and the host's room offer the
//      scenarios "1" to "20" and nothing else — a menu, no free seed field —
//      and their random option picks only among them (all twenty, over draws).
//   2. THE HANDLER REFUSES ANY OTHER SEED: createRoom accepts "1" and "20" and
//      refuses "0", "21", "07", "7 ", "" and an eight-character code — on the
//      local transport here, and the server's createRoom runs the same test
//      (the contract harness drives it on DynamoDB and the built zip).
//   3. THE SCENARIO IS THE ONLY SEED: a solo game and a hosted room on the same
//      number build the same instance — scenario, seed and opening alike.
//   4. THE TABLE: twenty premium-to-surplus ratios evenly spaced from 1.7
//      (scenario 12, thinnest) to 1.2 (scenario 16, richest), in the briefed
//      order.
//   5. THE OPENING: on every scenario and line, opening surplus = the year-1
//      premium at Expected, struck on the opening, / the scenario's ratio; the
//      pre-game begins at STARTING_CAPITAL, and funds every year at one margin.
//   6. THE PRE-GAME'S EXPERIENCE: every pre-game line-year's ordinary losses
//      are expected x (1 + (1 - 1.5 / ratio) x 0.3).
//   7. THE PRE-GAME'S RETURN: every pre-game line-year earns 3% on its invested
//      assets.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: a menu offering 0 to 20, a
// handler accepting "21", a hosted room built from a hashed code, the ratio
// order reversed, an opening at another scenario's ratio, a pre-game at
// expected losses, and a pre-game at the market's expected return.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { fileURLToPath } from 'node:url';
import {
  PRE_GAME_EXPERIENCE_BASE, PRE_GAME_EXPERIENCE_WEIGHT, PRE_GAME_INVESTMENT_RETURN, SCENARIO_PREMIUM_TO_SURPLUS,
  SCENARIOS_THIN_TO_RICH, STARTING_CAPITAL,
} from '../../src/data/pricingParameters';
import { SCENARIO_OPTIONS, randomScenarioId } from '../../src/utils/scenarios';
import { ROOM_SEEDS, newSessionToken } from '../../src/session/contract';
import { LocalSessionTransport } from '../../src/session/localTransport';
import { openSoloInstance } from '../../src/utils/soloGame';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { seedFromInstanceId } from '../../src/seedHash';
import { PRE_GAME_DEPTH, runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { openWorlds, strikeRates } from '../../src/utils/worlds';
import type { CoverageLine, GameInstance, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const TWENTY = Array.from({ length: 20 }, (_, i) => String(i + 1));
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------- 1
function gradeSetup(options: readonly string[], draws: string[], setupSource: string, hostSource: string, tag: string) {
  // The solo screen renders the shared menu, offers no free text seed field,
  // and its random picks from it; the host screen reads the same menu.
  const menu = /SCENARIO_OPTIONS\.map\(/.test(setupSource) && !/type="text"[^>]*\n?[^>]*instanceId|value=\{instanceId\}[\s\S]{0,80}type="text"/.test(setupSource)
    && !/<input[^>]*value=\{instanceId\}/.test(setupSource) && /randomScenarioId\(\)/.test(setupSource)
    && /SEED_OPTIONS = SCENARIO_OPTIONS/.test(hostSource);
  const drawn = new Set(draws);
  check(same(options, TWENTY) && same(ROOM_SEEDS, TWENTY) && menu && drawn.size === 20 && [...drawn].every(d => TWENTY.includes(d)),
    `${tag}1. setup offers exactly the scenarios 1 to 20, as a menu, and its random option picks among them`,
    `${options.length} options, ${drawn.size} distinct of ${draws.length} random picks`);
}

// ---------------------------------------------------------------- 2
// The local transport keeps its rooms in localStorage; Node has none, so a
// memory one stands in (as the contract harness's does).
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};
type Outcome = Record<string, 'accepted' | 'refused' | string>;
// ⚠ ONLY AN INVALID_REQUEST IS A REFUSAL — a transport that failed for any
// other reason must not pass as one that refused the seed.
async function createWith(seed: string): Promise<string> {
  const t = new LocalSessionTransport({ latencyMs: 0 });
  try {
    await t.createRoom({ hostToken: newSessionToken(), seed, yearCount: 3, startingYear: 2027, eventName: 'S', expectedTeams: 2, shocks: [], lines: ['WC'] });
    return 'accepted';
  } catch (e) { return (e as { code?: string }).code === 'INVALID_REQUEST' ? 'refused' : `failed (${(e as Error).message})`; }
}
const TRIED = ['1', '20', '0', '21', '07', '7 ', '', 'MAMC6EA4'];
function gradeHandler(outcome: Outcome, serverSource: string, tag: string) {
  const ok = outcome['1'] === 'accepted' && outcome['20'] === 'accepted'
    && TRIED.filter(s => s !== '1' && s !== '20').every(s => outcome[s] === 'refused')
    && /if \(!isRoomSeed\(req\.seed\)\)/.test(serverSource);
  check(ok, `${tag}2. the handler refuses any seed but 1 to 20`, TRIED.map(s => `"${s}" ${outcome[s]}`).join(', '));
}

// ---------------------------------------------------------------- 3
function gradeOneSeed(solo: GameInstance, hosted: GameInstance, soloOpen: number, hostedOpen: number, tag: string) {
  check(solo.scenario === 7 && hosted.scenario === 7 && solo.seed === hosted.seed && soloOpen === hostedOpen,
    `${tag}3. scenario 7 solo and hosted: one instance and one opening`,
    `scenario ${solo.scenario}/${hosted.scenario}, seed ${solo.seed}/${hosted.seed}, opening $${(soloOpen / 1e6).toFixed(4)}M/$${(hostedOpen / 1e6).toFixed(4)}M`);
}

// ---------------------------------------------------------------- 4
const BRIEF_ORDER = [12, 19, 10, 14, 3, 8, 15, 11, 20, 6, 9, 5, 4, 1, 18, 7, 17, 2, 13, 16];
function gradeTable(ratio: Record<number, number>, order: readonly number[], tag: string) {
  const step = 0.5 / 19;
  const worst = Math.max(...BRIEF_ORDER.map((n, k) => Math.abs(ratio[n] - (1.7 - k * step))));
  check(worst < 1e-12 && same(order.map(String), BRIEF_ORDER.map(String)) && ratio[12] === 1.7 && Math.abs(ratio[16] - 1.2) < 1e-12,
    `${tag}4. twenty ratios evenly spaced from 1.7 (scenario 12) to 1.2 (scenario 16), in the briefed order`,
    `worst off ${worst.toExponential(2)}`);
}

// ---------------------------------------------------------------- games
interface Opened { n: number; line: CoverageLine; premium: number; surplus: number; pre: LineResultSet[] }
function open(id: string, instance: GameInstance, setup: GameSetupSettings): { opened: Opened[]; gs: GameState } {
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
  const struck = strikeRates(gs, defaultDecisionSet(1, gameShocksOn(gs.setup, gs.instance)));
  const pre = [...(earlyPreGameHistory ?? []), ...priorHistory];
  return {
    gs,
    opened: LINES.map(line => ({
      n: Number(id), line, premium: struck[line]!.quote.finalRatePer100 * struck[line]!.exposure * 10_000,
      surplus: poolState.lines[line].surplus, pre: pre.map(r => r.byLine[line]!),
    })),
  };
}
const settings = (id: string): GameSetupSettings => ({ poolName: 'S', gameLength: 10, startingYear: 2027, instanceId: id, activeLines: LINES } as GameSetupSettings);
const all: Opened[] = [];
const soloInstances: Record<string, GameInstance> = {};
for (const id of TWENTY) {
  const { setup, instance } = openSoloInstance(settings(id));
  soloInstances[id] = instance;
  all.push(...open(id, instance, setup).opened);
}

// ---------------------------------------------------------------- 5
function gradeOpening(rows: Opened[], ratioOf: (n: number) => number, tag: string) {
  let worstOpen = 0, worstStart = 0, worstMargin = 0;
  for (const r of rows) {
    worstOpen = Math.max(worstOpen, Math.abs(r.surplus / (r.premium / ratioOf(r.n)) - 1));
    worstStart = Math.max(worstStart, Math.abs(r.pre[0].beginingSurplus - STARTING_CAPITAL[r.line]));
    const m = r.pre.map(x => x.decisions.fundingCushion ?? NaN);
    worstMargin = Math.max(worstMargin, ...m.map(x => Math.abs(x - m[0])), Number.isFinite(m[0]) ? 0 : Infinity);
  }
  check(worstOpen < 1e-9 && worstStart < 1e-6 && worstMargin === 0,
    `${tag}5. every scenario and line opens at year-1 premium / its ratio, from the starting capital, at one margin`,
    `${rows.length} line-scenarios; worst opening off ${worstOpen.toExponential(2)}, start off $${worstStart.toExponential(2)}`);
}

// ---------------------------------------------------------------- 6
function gradeExperience(rows: Opened[], factorOf: (n: number) => number, tag: string) {
  let worst = 0, n = 0;
  for (const r of rows) for (const y of r.pre) {
    const e = y.newLossEngine;
    if (!e || e.ordinaryExpected <= 0) continue;
    n++;
    worst = Math.max(worst, Math.abs(e.ordinaryRealised / e.ordinaryExpected - factorOf(r.n)));
  }
  check(worst < 1e-9 && n === rows.length * PRE_GAME_DEPTH,
    `${tag}6. every pre-game line-year's ordinary losses are expected x (1 + (1 - 1.5 / ratio) x 0.3)`,
    `${n} pre-game line-years; worst off ${worst.toExponential(2)}`);
}

// ---------------------------------------------------------------- 7
function gradeReturn(rows: Opened[], want: number, tag: string) {
  const rates = rows.flatMap(r => r.pre.map(y => y.investmentReturnRate));
  const worst = Math.max(...rates.map(x => Math.abs(x - want)));
  check(worst < 1e-12, `${tag}7. every pre-game line-year earns ${(PRE_GAME_INVESTMENT_RETURN * 100).toFixed(0)}% on its invested assets`,
    `${rates.length} line-years; worst off ${worst.toExponential(2)}`);
}

(async () => {
  console.log('THE TWENTY SCENARIOS');
  const setupSource = fs.readFileSync(path.join(SRC, 'pages/SetupPage.tsx'), 'utf8');
  const hostSource = fs.readFileSync(path.join(SRC, 'session/screens/HostCreateScreen.tsx'), 'utf8');
  const serverSource = fs.readFileSync(path.join(SRC, 'session/server/rooms.ts'), 'utf8');
  const draws = Array.from({ length: 2000 }, () => randomScenarioId());
  gradeSetup(SCENARIO_OPTIONS, draws, setupSource, hostSource, '');
  const outcome: Outcome = {};
  for (const s of TRIED) outcome[s] = await createWith(s);
  gradeHandler(outcome, serverSource, '');
  // The hosted room's instance, built as session/client/buildGame builds it.
  const hosted = generateGameInstance('7', seedFromInstanceId('7'), []);
  const hostedOpen = open('7', hosted, { ...settings('7'), shockTiming: 'host' }).opened[0].surplus;
  const soloOpen = all.find(r => r.n === 7 && r.line === 'WC')!.surplus;
  gradeOneSeed(soloInstances['7'], hosted, soloOpen, hostedOpen, '');
  gradeTable(SCENARIO_PREMIUM_TO_SURPLUS, SCENARIOS_THIN_TO_RICH, '');
  const ratioOf = (n: number) => SCENARIO_PREMIUM_TO_SURPLUS[n];
  const factorOf = (n: number) => 1 + (1 - PRE_GAME_EXPERIENCE_BASE / ratioOf(n)) * PRE_GAME_EXPERIENCE_WEIGHT;
  gradeOpening(all, ratioOf, '');
  gradeExperience(all, factorOf, '');
  gradeReturn(all, 0.03, '');

  console.log('\nCONTROLS — each must FAIL');
  const controlFails = (name: string, run: () => void, expect: string) => {
    const before = failures.length;
    const saved = console.log; console.log = () => {};
    run();
    console.log = saved;
    const caught = failures.splice(before).filter(f => f.startsWith(expect));
    check(caught.length > 0, `control: ${name} is caught by ${expect}`);
  };
  controlFails('a menu offering 0 to 20', () => gradeSetup(['0', ...SCENARIO_OPTIONS], draws, setupSource, hostSource, ''), '1.');
  controlFails('a free seed field', () => gradeSetup(SCENARIO_OPTIONS, draws,
    setupSource.replace('SCENARIO_OPTIONS.map(', 'OPTIONS.map(') + '<input type="text" value={instanceId} />', hostSource, ''), '1.');
  controlFails('a handler accepting "21"', () => gradeHandler({ ...outcome, '21': 'accepted' }, serverSource, ''), '2.');
  const hashed = generateGameInstance('MAMC6EA4', seedFromInstanceId('MAMC6EA4'), []);
  controlFails('a hosted room built from a hashed code', () => gradeOneSeed(soloInstances['7'], hashed, soloOpen, hostedOpen, ''), '3.');
  controlFails('the ratio order reversed', () => gradeTable(
    Object.fromEntries(BRIEF_ORDER.map((n, k) => [n, 1.2 + k * 0.5 / 19])), [...BRIEF_ORDER].reverse(), ''), '4.');
  controlFails('an opening at another scenario\'s ratio', () => gradeOpening(all, n => ratioOf(n === 20 ? 1 : n), ''), '5.');
  controlFails('a pre-game at expected losses', () => gradeExperience(all, () => 1, ''), '6.');
  controlFails('a pre-game at the market\'s expected return', () => gradeReturn(all, 0.0349, ''), '7.');

  console.log('');
  if (failures.length) {
    console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('PASS — twenty scenarios, the only seed: offered and refused as briefed, each opening at its ratio from the starting capital.');
})();
