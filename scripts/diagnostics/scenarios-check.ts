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
//   5. THE MARGIN IS SET ON THE DESIGNED HISTORY, AND THE OPENING IS WHERE THE
//      PLAYED ONE ENDS, INSIDE THE GUARDRAILS (PRE_GAME_MARGIN_ON_DESIGN,
//      OPENING_PREMIUM_TO_SURPLUS_BOUNDS): on every scenario and line the
//      pre-game begins at STARTING_CAPITAL and funds every year at one margin,
//      and the opening is the played pre-game's own last year-end. The margin
//      is the DESIGNED one — it lands the designed pre-game (exactly expected x
//      the scenario's multiple, at the cash-and-bond portfolio's expected
//      return) on the scenario's ratio, floored at zero (PRE_GAME_MARGIN_FLOOR)
//      — and the opening's premium to surplus is inside 1.0 to 3.0; OR the
//      played history at the designed margin would have opened outside them,
//      and the opening is exactly on that side's bound, unless reaching the
//      rich bound needs a negative margin, when the margin is zero. No margin
//      is ever below zero. (Until the designed-margin rule the opening WAS the
//      target: the margin was solved on the played history.)
//   6. THE PRE-GAME'S EXPERIENCE, SIMULATED (FLAT_PRE_GAME off): every
//      pre-game line-year's year factor is the scenario's multiple,
//      (1 + (1 - 1.5 / ratio) x 0.3), times the factor drawn on the pre-game's
//      own stream (pregame_ordinary_<line>) from the game's seed.
//   7. THE PRE-GAME'S RETURN, SIMULATED (PRE_GAME_MARKET_DRAWS): every
//      pre-game line-year holds cash and bonds only — the default allocation
//      without equities, scaled to 100% — and earns it on the AVERAGE of ten
//      markets, each drawn on its own stream (pregame_invest_<k>) from the
//      game's seed.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: a menu offering 0 to 20, a
// handler accepting "21", a hosted room built from a hashed code, the ratio
// order reversed, an opening at another scenario's ratio, a flat pre-game, a
// pre-game drawn on the played years' streams, a pre-game at 3%, a pre-game
// on the played years' market, a pre-game on one market draw, a pre-game
// holding equities, an opening forced onto the target, guardrails narrowed to
// 2.0, a guarded opening left where its history put it, and a negative
// margin.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { fileURLToPath } from 'node:url';
import {
  OPENING_PREMIUM_TO_SURPLUS_BOUNDS, PRE_GAME_MARGIN_FLOOR, PRE_GAME_EXPERIENCE_BASE, PRE_GAME_EXPERIENCE_WEIGHT, PRE_GAME_INVESTMENT_RETURN,
  PRE_GAME_MARKET_DRAWS, SCENARIO_PREMIUM_TO_SURPLUS, SCENARIOS_THIN_TO_RICH, STARTING_CAPITAL,
} from '../../src/data/pricingParameters';
import { SCENARIO_OPTIONS, randomScenarioId } from '../../src/utils/scenarios';
import { ROOM_SEEDS, newSessionToken } from '../../src/session/contract';
import { LocalSessionTransport } from '../../src/session/localTransport';
import { openSoloInstance } from '../../src/utils/soloGame';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { seedFromInstanceId } from '../../src/seedHash';
import { openingYear1Premium, runPriorHistory, simulateLineCandidate, solvePreGameMargin } from '../../src/utils/priorHistoryEngine';
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
    await t.createRoom({ hostToken: newSessionToken(), seed, yearCount: 3, startingYear: 2026, eventName: 'S', expectedTeams: 2, shocks: [], lines: ['WC'] });
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
interface Opened {
  n: number; seed: number; line: CoverageLine; premium: number; surplus: number; pre: LineResultSet[];
  // The DESIGNED margin, solved here on the designed pre-game (designedRaw)
  // and floored (designedMargin); and the played (simulated) pre-game at it —
  // its opening premium to surplus before any guardrail.
  designedRaw: number; designedMargin: number; unguardedRatio: number;
  instance: GameInstance; setup: GameSetupSettings; shocks: boolean;
}
function open(id: string, instance: GameInstance, setup: GameSetupSettings): { opened: Opened[]; gs: GameState } {
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
  const struck = strikeRates(gs, defaultDecisionSet(1, gameShocksOn(gs.setup, gs.instance)));
  const pre = [...(earlyPreGameHistory ?? []), ...priorHistory];
  return {
    gs,
    opened: LINES.map(line => {
      const rows = pre.map(r => r.byLine[line]!);
      const shocks = gameShocksOn(setup, instance);
      const ratio = SCENARIO_PREMIUM_TO_SURPLUS[Number(id)];
      const at = (m: number, kind: 'designed' | 'simulated') => simulateLineCandidate(instance, setup, line, 0, STARTING_CAPITAL[line], m, kind);
      const premiumOf = (c: ReturnType<typeof at>) =>
        openingYear1Premium(instance, line, c.poolState.lines[line], c.lineResults[c.lineResults.length - 1], shocks);
      const designedRaw = solvePreGameMargin((m: number) => {
        const c = at(m, 'designed');
        return { start: m, gap: c.poolState.lines[line].surplus - premiumOf(c) / ratio };
      }, line).start;
      const designedMargin = Math.max(PRE_GAME_MARGIN_FLOOR, designedRaw);
      const played = at(designedMargin, 'simulated');
      return {
        n: Number(id), seed: instance.seed, line, premium: struck[line]!.quote.finalRatePer100 * struck[line]!.exposure * 10_000,
        surplus: poolState.lines[line].surplus, pre: rows,
        designedRaw, designedMargin, unguardedRatio: premiumOf(played) / played.poolState.lines[line].surplus,
        instance, setup, shocks,
      };
    }),
  };
}
const settings = (id: string): GameSetupSettings => ({ poolName: 'S', gameLength: 10, startingYear: 2026, instanceId: id, activeLines: LINES } as GameSetupSettings);
const all: Opened[] = [];
const soloInstances: Record<string, GameInstance> = {};
for (const id of TWENTY) {
  const { setup, instance } = openSoloInstance(settings(id));
  soloInstances[id] = instance;
  all.push(...open(id, instance, setup).opened);
}

// ---------------------------------------------------------------- 5
type Bounds = { min: number; max: number };
function gradeOpening(rows: Opened[], ratioOf: (n: number) => number, bounds: Bounds, tag: string) {
  let worstDesigned = 0, worstOpen = 0, worstStart = 0, worstMargin = 0, offTarget = 0, worstBound = 0, guarded = 0;
  let floored = 0, belowFloor = 0;
  for (const r of rows) {
    const ps = r.premium / r.surplus;
    const margin = r.pre[0].decisions.fundingCushion ?? NaN;
    if (!(margin >= PRE_GAME_MARGIN_FLOOR)) belowFloor++;
    if (margin === PRE_GAME_MARGIN_FLOOR) floored++;
    if (Math.abs(margin - r.designedMargin) <= 1e-12 && r.designedRaw < PRE_GAME_MARGIN_FLOOR) {
      // The designed history needed a negative margin: charged at the floor,
      // and the opening inside the bounds.
      worstBound = Math.max(worstBound, ps < bounds.min ? bounds.min - ps : ps > bounds.max ? ps - bounds.max : 0);
    } else if (Math.abs(margin - r.designedMargin) <= 1e-12) {
      // The designed margin — it lands the designed history on the scenario's
      // ratio (checked by replaying it) — and the opening inside the bounds.
      const c = simulateLineCandidate(r.instance, r.setup, r.line, 0, STARTING_CAPITAL[r.line], margin, 'designed');
      const prem = openingYear1Premium(r.instance, r.line, c.poolState.lines[r.line], c.lineResults[c.lineResults.length - 1], r.shocks);
      worstDesigned = Math.max(worstDesigned, Math.abs(c.poolState.lines[r.line].surplus / (prem / ratioOf(r.n)) - 1));
      worstBound = Math.max(worstBound, ps < bounds.min ? bounds.min - ps : ps > bounds.max ? ps - bounds.max : 0);
    } else {
      // A guarded line: its history at the designed margin opened outside the
      // bounds, and the opening is exactly on that side's bound.
      guarded++;
      const want = r.unguardedRatio > bounds.max ? bounds.max : r.unguardedRatio < bounds.min ? bounds.min : NaN;
      // At the floor, the rich bound may be out of reach: the opening is then
      // richer than the bound, never thinner.
      const atFloor = margin === PRE_GAME_MARGIN_FLOOR && want === bounds.min && ps < bounds.min;
      worstBound = Math.max(worstBound, atFloor ? 0 : Number.isFinite(want) ? Math.abs(ps - want) : Infinity);
    }
    // The opening is the played history's own last year-end.
    worstOpen = Math.max(worstOpen, Math.abs(r.surplus - r.pre[r.pre.length - 1].endingSurplus));
    offTarget = Math.max(offTarget, Math.abs(r.surplus / (r.premium / ratioOf(r.n)) - 1));
    worstStart = Math.max(worstStart, Math.abs(r.pre[0].beginingSurplus - STARTING_CAPITAL[r.line]));
    const m = r.pre.map(x => x.decisions.fundingCushion ?? NaN);
    worstMargin = Math.max(worstMargin, ...m.map(x => Math.abs(x - m[0])), Number.isFinite(m[0]) ? 0 : Infinity);
  }
  // The played history moves the opening off the target — a pre-game whose
  // luck never reached it would be the flat one, or one solved to the opening.
  check(worstDesigned < 1e-9 && worstBound < 1e-9 && worstOpen < 1e-6 && worstStart < 1e-6 && worstMargin === 0 && offTarget > 0.05
    && belowFloor === 0,
    `${tag}5. one margin from the starting capital, set on the designed history unless the guardrails (${bounds.min}-${bounds.max}) `
    + `move it just to a bound; the opening is where the played history ends`,
    `${rows.length} line-scenarios, ${guarded} guarded, ${floored} at the zero floor, ${belowFloor} below it; designed history off its target ${worstDesigned.toExponential(2)}, `
    + `worst off the bounds ${worstBound.toExponential(2)}, opening off the played year-end $${worstOpen.toExponential(2)}, `
    + `start off $${worstStart.toExponential(2)}; played openings up to ${(100 * offTarget).toFixed(0)}% off the target`);
}

// ---------------------------------------------------------------- 6
/** A pre-game year factor as drawn: the scenario's multiple x the draw on `drawOf`. */
type DrawOf = (seed: number, year: number, line: CoverageLine) => number;
function gradeExperience(rows: Opened[], factorOf: (n: number) => number, drawOf: DrawOf, tag: string) {
  let worst = 0, n = 0, spread = 0;
  for (const r of rows) for (const y of r.pre) {
    n++;
    const want = factorOf(r.n) * drawOf(r.seed, y.yearNumber, r.line);
    worst = Math.max(worst, Math.abs(y.commonLossFactor / want - 1));
    spread = Math.max(spread, Math.abs(y.commonLossFactor / factorOf(r.n) - 1));
  }
  check(worst < 1e-12 && n === rows.length * 5 && spread > 0.01,
    `${tag}6. every pre-game line-year's year factor is the scenario's multiple (1 + (1 - 1.5 / ratio) x 0.3) x its draw on the pre-game's own stream`,
    `${n} pre-game line-years; worst off ${worst.toExponential(2)}; largest draw ${(spread * 100).toFixed(1)}% off the multiple`);
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
  // The hosted room's instance, built as session/client/buildGame builds it.
  const hosted = generateGameInstance('7', seedFromInstanceId('7'), []);
  const hostedOpen = open('7', hosted, { ...settings('7'), shockTiming: 'host' }).opened[0].surplus;
  const soloOpen = all.find(r => r.n === 7 && r.line === 'WC')!.surplus;
  gradeOneSeed(soloInstances['7'], hosted, soloOpen, hostedOpen, '');
  gradeTable(SCENARIO_PREMIUM_TO_SURPLUS, SCENARIOS_THIN_TO_RICH, '');
  const ratioOf = (n: number) => SCENARIO_PREMIUM_TO_SURPLUS[n];
  const factorOf = (n: number) => 1 + (1 - PRE_GAME_EXPERIENCE_BASE / ratioOf(n)) * PRE_GAME_EXPERIENCE_WEIGHT;
  gradeOpening(all, ratioOf, OPENING_PREMIUM_TO_SURPLUS_BOUNDS, '');
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
  controlFails('the ratio order reversed', () => gradeTable(
    Object.fromEntries(BRIEF_ORDER.map((n, k) => [n, 1.2 + k * 0.5 / 19])), [...BRIEF_ORDER].reverse(), ''), '4.');
  const B = OPENING_PREMIUM_TO_SURPLUS_BOUNDS;
  controlFails('a margin landing on another scenario\'s ratio', () => gradeOpening(all, n => ratioOf(n === 20 ? 1 : n), B, ''), '5.');
  controlFails('an opening forced onto the target', () => gradeOpening(
    all.map(r => ({ ...r, surplus: r.premium / ratioOf(r.n) })), ratioOf, B, ''), '5.');
  controlFails('guardrails narrowed to 2.0', () => gradeOpening(all, ratioOf, { min: B.min, max: 2.0 }, ''), '5.');
  controlFails('a negative margin', () => gradeOpening(all.map((r, i) => (i === 0
    ? { ...r, pre: r.pre.map(y => ({ ...y, decisions: { ...y.decisions, fundingCushion: -0.01 } })) } : r)), ratioOf, B, ''), '5.');
  // A line made to need the thin guardrail — its history at the designed
  // margin opening at 3.5 — but left where that history put it. Synthetic,
  // because with the rich bound at 1.0 and the margin floored no line needs
  // the guardrail today, and a control with nothing to catch is not one.
  const firstPriced = all.findIndex(r => (r.pre[0].decisions.fundingCushion ?? 0) > PRE_GAME_MARGIN_FLOOR);
  controlFails('a guarded opening left where its history put it', () => gradeOpening(
    all.map((r, i) => (i === firstPriced ? { ...r, designedMargin: r.designedMargin + 0.01, unguardedRatio: 3.5 } : r)),
    ratioOf, B, ''), '5.');
  controlFails('a flat pre-game (no draw)', () => gradeExperience(all, factorOf, () => 1, ''), '6.');
  controlFails('a pre-game drawn on the played years\' stream', () => gradeExperience(all, factorOf,
    (seed, y, l) => drawOrdinaryFactor(deriveSubRng(seed, y, `ordinary_${l}`), ordinaryYearCv(l)), ''), '6.');
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
  console.log('PASS — twenty scenarios, the only seed: offered and refused as briefed, each prior board\'s margin set on its designed history from the starting capital.');
})();
