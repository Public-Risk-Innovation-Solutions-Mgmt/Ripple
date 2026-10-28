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
//      number build the same instance — scenario, its fixed seed and opening
//      alike (restated for the fixed-seed scenarios: the room is built as
//      session/client/buildGame builds it, on SCENARIO_SEEDS).
//   4. THE DESIGN TARGETS, PER LINE: twenty premium-to-surplus ratios evenly
//      spaced, in the briefed order, from scenario 12 (thinnest) to scenario 16
//      (richest) — WC 3.0 to 1.5, GL 2.3 to 1.3, Property 1.7 to 1.2. They are
//      what the fixed seeds were chosen against; the game reads them nowhere.
//   5. THE OPENING IS THE FIXED SEED'S (restated for the fixed-seed scenarios;
//      it was a margin set on a designed history, floored, and moved by
//      guardrails — all retired): on every scenario and line the pre-game
//      begins at STARTING_CAPITAL, funds every year at Expected (a margin of
//      exactly 0), and the opening is the played pre-game's own last year-end
//      — NOT on its target (nothing fits it), yet near it: every line within
//      12% of its design target, and 18 of the 20 scenarios within 5% on all
//      three lines (13 and 16, the richest, miss on WC and GL — accepted;
//      SCENARIO_SEEDS records the misses, scenario-opening-drift-check the
//      exact openings).
//   6. THE PRE-GAME'S EXPERIENCE, SIMULATED AT TRUE COST (FLAT_PRE_GAME off):
//      every pre-game line-year's year factor is the factor drawn on the
//      pre-game's own stream (pregame_ordinary_<line>) from the game's seed,
//      and nothing else (restated: it was the scenario's multiple x that draw;
//      the multiple is retired).
//   7. THE PRE-GAME'S RETURN, SIMULATED (PRE_GAME_MARKET_DRAWS): every
//      pre-game line-year holds cash and bonds only — the default allocation
//      without equities, scaled to 100% — and earns it on the AVERAGE of ten
//      markets, each drawn on its own stream (pregame_invest_<k>) from the
//      game's seed.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: a menu offering 0 to 20, a
// handler accepting "21", a hosted room built from a hashed code, a room built
// on the old mapping (the number's own hash), the ratio order reversed, one
// table for every line, an opening forced onto the target, a pre-game at a 1%
// margin, a pre-game begun off the capital, scenarios 12 and 16 on each
// other's seeds, a flat pre-game, a pre-game drawn on the played years'
// streams, the retired scenario multiple put back, a pre-game at 3%, a
// pre-game on the played years' market, a pre-game on one market draw, and a
// pre-game holding equities. (The guardrail, floor and designed-margin
// controls went with that machinery.)
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { fileURLToPath } from 'node:url';
import {
  PRE_GAME_INVESTMENT_RETURN, PRE_GAME_MARKET_DRAWS, SCENARIO_PREMIUM_TO_SURPLUS, SCENARIO_SEEDS, SCENARIOS_THIN_TO_RICH, SOLO_SHOCKS, STARTING_CAPITAL,
} from '../../src/data/pricingParameters';
import { SCENARIO_OPTIONS, randomScenarioId } from '../../src/utils/scenarios';
import { ROOM_SEEDS, newSessionToken } from '../../src/session/contract';
import { LocalSessionTransport } from '../../src/session/localTransport';
import { openSoloInstance } from '../../src/utils/soloGame';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { buildTeamGame } from '../../src/session/client/buildGame';
import { seedFromInstanceId } from '../../src/seedHash';
import { PRE_GAME_DEPTH, runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { openWorlds, strikeRates } from '../../src/utils/worlds';
import { drawOrdinaryFactor, ordinaryLossRng, ordinaryYearCv } from '../../src/utils/ordinaryLoss';
import { blendInvestmentReturn, simulateMarketReturns, type MarketReturns } from '../../src/utils/investmentEngine';
import { deriveSubRng } from '../../src/utils/random';
import type { AssetAllocation, CoverageLine, GameInstance, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

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
  check(solo.scenario === 7 && hosted.scenario === 7 && solo.seed === hosted.seed && solo.instanceId === String(SCENARIO_SEEDS[7])
    && hosted.instanceId === solo.instanceId && soloOpen === hostedOpen,
    `${tag}3. scenario 7 solo and hosted: one instance on its fixed seed, and one opening`,
    `scenario ${solo.scenario}/${hosted.scenario}, seed ${solo.seed}/${hosted.seed}, opening $${(soloOpen / 1e6).toFixed(4)}M/$${(hostedOpen / 1e6).toFixed(4)}M`);
}

// ---------------------------------------------------------------- 4
const BRIEF_ORDER = [12, 19, 10, 14, 3, 8, 15, 11, 20, 6, 9, 5, 4, 1, 18, 7, 17, 2, 13, 16];
const BRIEF_RANGE: Record<CoverageLine, [number, number]> = { WC: [3.0, 1.5], GL: [2.3, 1.3], Property: [1.7, 1.2] };
function gradeTable(ratio: Record<CoverageLine, Record<number, number>>, order: readonly number[], tag: string) {
  let worst = 0, ends = true;
  for (const l of LINES) {
    const [thin, rich] = BRIEF_RANGE[l];
    const step = (thin - rich) / 19;
    worst = Math.max(worst, ...BRIEF_ORDER.map((n, k) => Math.abs(ratio[l][n] - (thin - k * step))));
    ends &&= ratio[l][12] === thin && Math.abs(ratio[l][16] - rich) < 1e-12;
  }
  check(worst < 1e-12 && ends && same(order.map(String), BRIEF_ORDER.map(String)),
    `${tag}4. the design targets: twenty ratios a line evenly spaced from scenario 12 (thinnest) to scenario 16 (richest), in the briefed order: `
    + LINES.map(l => `${l} ${BRIEF_RANGE[l][0]}-${BRIEF_RANGE[l][1]}`).join(', '),
    `worst off ${worst.toExponential(2)}`);
}

// ---------------------------------------------------------------- games
interface Opened {
  n: number; seed: number; line: CoverageLine; premium: number; surplus: number; pre: LineResultSet[];
}
function open(id: string, instance: GameInstance, setup: GameSetupSettings): { opened: Opened[]; gs: GameState } {
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
  const struck = strikeRates(gs, defaultDecisionSet(1, gameShocksOn(gs.setup, gs.instance)));
  const pre = [...(earlyPreGameHistory ?? []), ...priorHistory];
  return {
    gs,
    opened: LINES.map(line => ({
      n: Number(id), seed: instance.seed, line, premium: struck[line]!.quote.finalRatePer100 * struck[line]!.exposure * 10_000,
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
// The same twenty with shocks off — single player's SOLO_SHOCKS off, as a room
// with none plays — for the opening's premium to surplus (5), the basis
// SCENARIO_SEEDS' table is measured on.
const atNoShocks: Opened[] = [];
SOLO_SHOCKS.enabled = false;
try {
  for (const id of TWENTY) {
    const { setup, instance } = openSoloInstance(settings(id));
    atNoShocks.push(...open(id, instance, setup).opened);
  }
} finally { SOLO_SHOCKS.enabled = true; }

// ---------------------------------------------------------------- 5
// The premium to surplus each scenario opens at is measured with shocks off
// (a room with none), as SCENARIO_SEEDS' table is; the game's own strike may
// differ by the shock switch's catastrophe load, which moves premium, never
// the opening's surplus.
function gradeOpening(rows: Opened[], ratioOf: (n: number, line: CoverageLine) => number, tag: string) {
  let worstOpen = 0, worstStart = 0, worstMargin = 0, offTarget = 0;
  const missBy = new Map<number, number>();
  for (const r of rows) {
    const off = Math.abs(r.surplus / (r.premium / ratioOf(r.n, r.line)) - 1);
    offTarget = Math.max(offTarget, off);
    missBy.set(r.n, Math.max(missBy.get(r.n) ?? 0, Math.abs((r.premium / r.surplus) / ratioOf(r.n, r.line) - 1)));
    // The opening is the played history's own last year-end.
    worstOpen = Math.max(worstOpen, Math.abs(r.surplus - r.pre[r.pre.length - 1].endingSurplus));
    worstStart = Math.max(worstStart, Math.abs(r.pre[0].beginingSurplus - STARTING_CAPITAL[r.line]));
    worstMargin = Math.max(worstMargin, ...r.pre.map(x => Math.abs(x.decisions.fundingCushion ?? Infinity)));
  }
  const worstMiss = Math.max(...missBy.values());
  const within5 = [...missBy.values()].filter(m => m <= 0.05).length;
  // Not on the target — nothing fits it — and near it.
  check(worstOpen < 1e-6 && worstStart < 1e-6 && worstMargin === 0 && offTarget > 0.05 && worstMiss <= 0.12 && within5 >= 18,
    `${tag}5. the opening is the fixed seed's: from the starting capital, at Expected every year, where the played history ends — not on its target, within 12% of it on every line and 5% on all three for 18 scenarios`,
    `${rows.length} line-scenarios; margin off 0 by ${worstMargin.toExponential(2)}; opening off the played year-end $${worstOpen.toExponential(2)}, `
    + `start off $${worstStart.toExponential(2)}; worst miss ${(100 * worstMiss).toFixed(1)}%, ${within5} scenarios within 5% on every line`);
}

// ---------------------------------------------------------------- 6
/** A pre-game year factor as drawn: the draw on `drawOf`, times `factorOf` (1 at true cost). */
type DrawOf = (seed: number, year: number, line: CoverageLine) => number;
function gradeExperience(rows: Opened[], factorOf: (n: number, line: CoverageLine) => number, drawOf: DrawOf, tag: string) {
  let worst = 0, n = 0, spread = 0;
  for (const r of rows) for (const y of r.pre) {
    n++;
    const want = factorOf(r.n, r.line) * drawOf(r.seed, y.yearNumber, r.line);
    worst = Math.max(worst, Math.abs(y.commonLossFactor / want - 1));
    spread = Math.max(spread, Math.abs(y.commonLossFactor / factorOf(r.n, r.line) - 1));
  }
  check(worst < 1e-12 && n === rows.length * PRE_GAME_DEPTH && spread > 0.01 && rows.every(r => factorOf(r.n, r.line) === 1),
    `${tag}6. every pre-game line-year's year factor is its draw on the pre-game's own stream, at true cost — no scenario multiple`,
    `${n} pre-game line-years (${PRE_GAME_DEPTH} a line); worst off ${worst.toExponential(2)}; largest draw ${(spread * 100).toFixed(1)}% off the multiple`);
}

// ---------------------------------------------------------------- 7
function gradeReturn(rows: Opened[], marketOf: (seed: number, year: number) => MarketReturns, mix: AssetAllocation, tag: string) {
  let worst = 0, n = 0, worstMix = 0;
  const rates = new Set<number>();
  for (const r of rows) for (const y of r.pre) {
    n++;
    const a = y.assetAllocation;
    worstMix = Math.max(worstMix, Math.abs(a.cashPct - mix.cashPct), Math.abs(a.bondsPct - mix.bondsPct), Math.abs(a.equitiesPct - mix.equitiesPct));
    const want = blendInvestmentReturn(1, mix, marketOf(r.seed, y.yearNumber)).returnRate;
    worst = Math.max(worst, Math.abs(y.investmentReturnRate - want));
    rates.add(Number(y.investmentReturnRate.toFixed(6)));
  }
  check(worst < 1e-12 && worstMix < 1e-9 && rates.size > 5,
    `${tag}7. every pre-game line-year holds cash and bonds only and earns them on the average of ${PRE_GAME_MARKET_DRAWS} markets, each on its own pre-game stream`,
    `${n} line-years; worst return off ${worst.toExponential(2)}; allocation off ${worstMix.toExponential(2)}; ${rates.size} distinct returns`);
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
  // The hosted room's game, built as session/client/buildGame builds it.
  const room = buildTeamGame({ seed: '7', yearCount: 10, startingYear: 2027, eventName: 'E', poolName: 'S', shocks: [], priorDevelopment: undefined } as never, LINES).gameState;
  const hosted = room.instance;
  const hostedOpen = room.poolState.lines.WC.surplus;
  const soloOpen = all.find(r => r.n === 7 && r.line === 'WC')!.surplus;
  gradeOneSeed(soloInstances['7'], hosted, soloOpen, hostedOpen, '');
  gradeTable(SCENARIO_PREMIUM_TO_SURPLUS, SCENARIOS_THIN_TO_RICH, '');
  const ratioOf = (n: number, l: CoverageLine) => SCENARIO_PREMIUM_TO_SURPLUS[l][n];
  // At true cost: no scenario multiple.
  const factorOf = () => 1;
  // The retired multiple, rebuilt from the briefed range for its control.
  const retiredFactorOf = (n: number, l: CoverageLine) => 1 + (1 - (BRIEF_RANGE[l][0] + BRIEF_RANGE[l][1]) / 2 / ratioOf(n, l)) * 0.3;
  gradeOpening(atNoShocks, ratioOf, '');
  const drawOf: DrawOf = (seed, y, l) => drawOrdinaryFactor(ordinaryLossRng(seed, y, l), ordinaryYearCv(l));
  // The average of PRE_GAME_MARKET_DRAWS markets, each on its own stream — rebuilt here, not read from the engine.
  const avgOf = (labels: string[]) => (seed: number, y: number): MarketReturns => {
    const ms = labels.map(l => simulateMarketReturns(deriveSubRng(seed, y, l)));
    const avg = (f: (m: MarketReturns) => number) => ms.reduce((a, m) => a + f(m), 0) / ms.length;
    return { cash: avg(m => m.cash), bonds: avg(m => m.bonds), equities: avg(m => m.equities) };
  };
  const marketOf = avgOf(Array.from({ length: PRE_GAME_MARKET_DRAWS }, (_, k) => `pregame_invest_${k}`));
  // The default 10/80/10 without equities, scaled to 100%.
  const MIX: AssetAllocation = { cashPct: 100 * 10 / 90, bondsPct: 100 * 80 / 90, equitiesPct: 0 };
  gradeExperience(all, factorOf, drawOf, '');
  gradeReturn(all, marketOf, MIX, '');

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
  controlFails('a room built on the old mapping (the number\'s own hash)', () => gradeOneSeed(soloInstances['7'],
    generateGameInstance('7', seedFromInstanceId('7'), []), soloOpen, hostedOpen, ''), '3.');
  controlFails('the ratio order reversed', () => gradeTable(
    { ...SCENARIO_PREMIUM_TO_SURPLUS, WC: Object.fromEntries(BRIEF_ORDER.map((n, k) => [n, 1.5 + k * 1.5 / 19])) }, [...BRIEF_ORDER].reverse(), ''), '4.');
  controlFails('one table for every line', () => gradeTable(
    { WC: SCENARIO_PREMIUM_TO_SURPLUS.Property, GL: SCENARIO_PREMIUM_TO_SURPLUS.Property, Property: SCENARIO_PREMIUM_TO_SURPLUS.Property }, BRIEF_ORDER, ''), '4.');
  controlFails('an opening forced onto the target', () => gradeOpening(
    atNoShocks.map(r => ({ ...r, surplus: r.premium / ratioOf(r.n, r.line) })), ratioOf, ''), '5.');
  controlFails('a pre-game at a 1% margin', () => gradeOpening(atNoShocks.map((r, i) => (i === 0
    ? { ...r, pre: r.pre.map(y => ({ ...y, decisions: { ...y.decisions, fundingCushion: 0.01 } })) } : r)), ratioOf, ''), '5.');
  controlFails('a pre-game begun off the capital', () => gradeOpening(atNoShocks.map((r, i) => (i === 0
    ? { ...r, pre: r.pre.map((y, k) => (k === 0 ? { ...y, beginingSurplus: y.beginingSurplus + 1e6 } : y)) } : r)), ratioOf, ''), '5.');
  controlFails('scenarios 12 and 16 on each other\'s seeds', () => gradeOpening(atNoShocks,
    (n, l) => ratioOf(n === 12 ? 16 : n === 16 ? 12 : n, l), ''), '5.');
  controlFails('a flat pre-game (no draw)', () => gradeExperience(all, factorOf, () => 1, ''), '6.');
  controlFails('a pre-game drawn on the played years\' stream', () => gradeExperience(all, factorOf,
    (seed, y, l) => drawOrdinaryFactor(deriveSubRng(seed, y, `ordinary_${l}`), ordinaryYearCv(l)), ''), '6.');
  controlFails('the retired scenario multiple put back', () => gradeExperience(all, retiredFactorOf, drawOf, ''), '6.');
  const flat = PRE_GAME_INVESTMENT_RETURN;
  controlFails('a pre-game at 3%', () => gradeReturn(all, () => ({ cash: flat, bonds: flat, equities: flat }), MIX, ''), '7.');
  controlFails('a pre-game on the played years\' market', () => gradeReturn(all,
    (seed, y) => simulateMarketReturns(deriveSubRng(seed, y, 'invest')), MIX, ''), '7.');
  controlFails('a pre-game on one market draw', () => gradeReturn(all, avgOf(['pregame_invest_0']), MIX, ''), '7.');
  controlFails('a pre-game holding equities', () => gradeReturn(all, marketOf, { cashPct: 10, bondsPct: 80, equitiesPct: 10 }, ''), '7.');

  console.log('');
  if (failures.length) {
    console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('PASS — twenty scenarios, each on its fixed seed: offered and refused as briefed, each opening where its own history ends, from the starting capital at Expected.');
})();
