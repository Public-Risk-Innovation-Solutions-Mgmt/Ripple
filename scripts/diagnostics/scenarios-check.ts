// ============================================================================
// THE TWENTY SCENARIOS AND THE NAMED ONES — THE GATE (stable-scenarios commit 9;
// the named scenarios and slot 20's new seed, pr/named-scenarios).
//
//   npx tsx scripts/diagnostics/scenarios-check.ts
//
//   1. SETUP OFFERS 1 TO 20 AND THE NAMED SCENARIOS: solo setup and the host's
//      room offer "1" to "20" and the named "21" Staff Retreat and "22" Test
//      Seed and nothing else — a menu, no free seed field — each named one
//      LABELLED BY ITS NAME in both menus, never as a number; and their random
//      option picks only among the twenty (all twenty over draws, never a named one).
//   2. THE HANDLER REFUSES ANY OTHER SEED: createRoom accepts "1", "20", "21"
//      and "22" and refuses "0", "23", "07", "7 ", "", an eight-character code,
//      a name ("Staff Retreat") and a raw seed ("82670") — on the local transport
//      here, and the server's createRoom runs the same test (the contract
//      harness drives it on DynamoDB and the built zip).
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
//      guardrails — all retired; restated again for the prior board,
//      pr/pregame-65): on every scenario and line the pre-game begins at
//      STARTING_CAPITAL, and every pre-game year records the prior board's
//      decisions (PRIOR_BOARD) — funding at 65% (the margin exactly the
//      line's CLF at 65% − 1, the level 65%), Non-Renewal 0, the per-claim
//      cover $19M xs $1M and the aggregate cover 125/50 — and the opening is
//      the played pre-game's own last year-end — NOT on its target (nothing
//      fits it), yet near it, by the bars in SCENARIO_OPENING_BARS: within
//      20% on every line, and 5% on all three for 0 scenarios — what the
//      seeds achieve on the round paid-in capital (pr/round-paid-in-capital:
//      WC $2M from $0 lifts every WC opening about $2.4M; worst 19.8%,
//      scenario 10's WC; the seeds kept). The 5% leg is restated to 0, so the
//      20% bar is the one that bites; it was 7.5% and 13 (pr/asset-mix-20-75-5:
//      worst 7.3%, scenario 6's WC).
//      The premium is year 1's at Expected with no cover (atExpectedDecisionSet),
//      the basis the seeds were chosen on. Were 5% and all 20 (pr/pregame-65),
//      10.5% and 16 (pr/seed-switch), 18.5% and 4 (pr/alae-load), and 12% and
//      18 before it.
//      scenario-opening-drift-check holds the exact openings.
//   6. THE PRE-GAME'S EXPERIENCE, SIMULATED AT TRUE COST (FLAT_PRE_GAME off):
//      every pre-game line-year's year factor is the factor drawn on the
//      pre-game's own stream (pregame_ordinary_<line>) from the game's seed,
//      and nothing else (restated: it was the scenario's multiple x that draw;
//      the multiple is retired).
//   7. THE PRE-GAME'S RETURN, SIMULATED (PRE_GAME_MARKET_DRAWS): every
//      pre-game line-year holds the prior board's 20% cash / 75% bonds / 5%
//      equities (restated, pr/asset-mix-20-75-5: it held cash and bonds only,
//      about 11/89) and earns it on the AVERAGE of ten markets, each drawn on
//      its own stream (pregame_invest_<k>) from the game's seed, class by
//      class — the equities on the average of the ten equity draws too.
//   8. THE PLAY DEFAULT IS THE SAME MIX, IN EVERY MODE (pr/asset-mix-20-75-5):
//      20/75/5 in the default decision set every year, in the Expected-basis
//      set, in a solo game's and a hosted room's year-1 decisions, and in a
//      session team's decisions for a year it never locked.
//
//   9. THE NAMED SCENARIOS: Staff Retreat plays seed 82670 and Test Seed 53781,
//      solo and hosted alike, each on its own fixed seed; Test Seed opens to
//      within 5e-5 of scenario 20's opening before slot 20 was re-picked (and
//      scenario-opening-drift-check holds it to the bit); slot 20 plays a new
//      seed (76975); neither is a designed slot. (Restated,
//      pr/round-paid-in-capital: "as scenario 20 did" is seed 53781's opening
//      on today's capital — 1.9614 / 1.9228 / 1.5635; on aws 61fcf79's capital
//      it was 2.2715 / 1.9141 / 1.5605, the premium unmoved. Restated again,
//      wip/cover-price-double: with the pre-game paying the doubled cover
//      price it is 1.9639 / 1.9255 / 1.5663, the premium unmoved.)
//  10. THE PAID-IN CAPITAL IS ROUND (pr/round-paid-in-capital): STARTING_CAPITAL
//      is WC $2.0M, GL $8.0M, Property $8.5M — not the solved $0 / $8.06M /
//      $8.53M before — and section 5 holds every pre-game beginning on it.
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: a menu offering 0 to 20, the
// named scenarios offered as numbers, a random pick that can draw a named one,
// a handler accepting "23", refusing "21" or accepting a raw seed, Staff
// Retreat on another seed, slot 20 still on 53781, Test Seed's opening taken
// from the new slot 20, a hosted room built from a hashed code, a room built
// on the old mapping (the number's own hash), the ratio order reversed, one
// table for every line, an opening forced onto the target, a pre-game at a 1%
// margin (and at Expected, a pre-game at 70%, one without the per-claim
// cover, one without the aggregate cover, one non-renewing 2%, and the opening
// priced at the play defaults), a pre-game begun off the capital, scenarios 12 and 16 on each
// other's seeds, a flat pre-game, a pre-game drawn on the played years'
// streams, the retired scenario multiple put back, a pre-game at 3%, a
// pre-game on the played years' market, a pre-game on one market draw, a
// pre-game on the old cash-and-bonds 11/89, a pre-game at the old play default
// 10/80/10, a pre-game whose equities earn one draw rather than the average,
// (8) a default left at 10/80/10 in one mode, (5) an opening a point past
// the 20% bar, and (10) the capital before ($0 / $8.06M / $8.53M). (The guardrail, floor and designed-margin
// controls went with that machinery.)
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { fileURLToPath } from 'node:url';
import {
  PRE_GAME_INVESTMENT_RETURN, PRE_GAME_MARKET_DRAWS, PRIOR_BOARD, SCENARIO_PREMIUM_TO_SURPLUS, SCENARIO_SEEDS, SCENARIOS_THIN_TO_RICH, SOLO_SHOCKS, STARTING_CAPITAL,
  SCENARIO_OPENING_BARS,
} from '../../src/data/pricingParameters';
import { SCENARIO_OPTIONS, gameIdentity, randomScenarioId, scenarioName, scenarioOptionLabel } from '../../src/utils/scenarios';
import { ROOM_SEEDS, newSessionToken } from '../../src/session/contract';
import { LocalSessionTransport } from '../../src/session/localTransport';
import { openSoloInstance } from '../../src/utils/soloGame';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { buildTeamGame } from '../../src/session/client/buildGame';
import { seedFromInstanceId } from '../../src/seedHash';
import { PRE_GAME_DEPTH, openingYear1Premium, runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { atExpectedDecisionSet, defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { decisionsForYear } from '../../src/session/client/decisions';
import { staticClf } from '../../src/data/clfTables';
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
/** The named scenarios' ids, and their names and seeds as briefed — written out here, not read from NAMED_SCENARIOS. */
const NAMED = ['21', '22'];
const BRIEFED_NAMED: Record<string, { name: string; seed: number }> = { '21': { name: 'Staff Retreat', seed: 82670 }, '22': { name: 'Test Seed', seed: 53781 } };
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------- 1
function gradeSetup(options: readonly string[], draws: string[], setupSource: string, hostSource: string, tag: string,
  labelOf: (id: string) => string = scenarioOptionLabel, hostLabelOf: (id: string) => string = scenarioName) {
  // The solo screen renders the shared menu, offers no free text seed field,
  // and its random picks from it; the host screen reads the same menu.
  const menu = /SCENARIO_OPTIONS\.map\(/.test(setupSource) && !/type="text"[^>]*\n?[^>]*instanceId|value=\{instanceId\}[\s\S]{0,80}type="text"/.test(setupSource)
    && !/<input[^>]*value=\{instanceId\}/.test(setupSource) && /randomScenarioId\(\)/.test(setupSource)
    && /SEED_OPTIONS = SCENARIO_OPTIONS/.test(hostSource)
    // Each option labelled through the one naming function: solo "Scenario 7" or the name; the host the number or the name.
    && /<option key=\{n\} value=\{n\}>\{scenarioOptionLabel\(n\)\}<\/option>/.test(setupSource)
    && /<option key=\{n\} value=\{n\}>\{scenarioName\(n\)\}<\/option>/.test(hostSource);
  // THE NAMED SCENARIOS BY NAME, NEVER AS A NUMBER, in both menus; the twenty as before.
  const labels = NAMED.every(id => labelOf(id) === BRIEFED_NAMED[id].name && hostLabelOf(id) === BRIEFED_NAMED[id].name)
    && TWENTY.every(id => labelOf(id) === `Scenario ${id}` && hostLabelOf(id) === id);
  const drawn = new Set(draws);
  const offered = [...TWENTY, ...NAMED];
  check(same(options, offered) && same(ROOM_SEEDS, offered) && menu && labels && drawn.size === 20 && [...drawn].every(d => TWENTY.includes(d)),
    `${tag}1. setup offers the scenarios 1 to 20 and the named Staff Retreat and Test Seed (by name, never a number), as a menu, and its random option picks among the twenty only`,
    `${options.length} options (${options.filter(o => NAMED.includes(o)).map(o => labelOf(o)).join(', ')}), ${drawn.size} distinct of ${draws.length} random picks`);
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
const ACCEPTED = ['1', '20', '21', '22'];
const TRIED = [...ACCEPTED, '0', '23', '07', '7 ', '', 'MAMC6EA4', 'Staff Retreat', '82670'];
function gradeHandler(outcome: Outcome, serverSource: string, tag: string) {
  const ok = ACCEPTED.every(s => outcome[s] === 'accepted')
    && TRIED.filter(s => !ACCEPTED.includes(s)).every(s => outcome[s] === 'refused')
    && /if \(!isRoomSeed\(req\.seed\)\)/.test(serverSource);
  check(ok, `${tag}2. the handler accepts 1 to 20 and the named 21 and 22, and refuses any other seed (a name, a raw seed, 23)`, TRIED.map(s => `"${s}" ${outcome[s]}`).join(', '));
}

// ---------------------------------------------------------------- 9
/**
 * THE NAMED SCENARIOS (pr/named-scenarios): each plays its briefed seed, solo
 * and hosted alike; Test Seed opens exactly as scenario 20 did before (its
 * seed, 53781, measured on this build and against the table's figures); slot
 * 20 plays a different seed now; neither is a designed slot (no target, not in
 * the thin-to-rich order).
 */
interface NamedOpened { id: string; solo: GameInstance; hosted: GameInstance; soloOpen: number; hostedOpen: number; ps: Record<CoverageLine, number> }
function gradeNamed(rows: NamedOpened[], seedOf: (id: string) => number, slot20: number, oldSlot20Ps: Record<CoverageLine, number>, tag: string) {
  const out: string[] = [];
  for (const r of rows) {
    const want = BRIEFED_NAMED[r.id];
    if (seedOf(r.id) !== want.seed) out.push(`${want.name} on seed ${seedOf(r.id)}, not ${want.seed}`);
    if (r.solo.instanceId !== String(want.seed) || r.hosted.instanceId !== r.solo.instanceId || r.solo.seed !== r.hosted.seed
      || r.solo.scenario !== Number(r.id) || r.hosted.scenario !== Number(r.id) || r.soloOpen !== r.hostedOpen) out.push(`${want.name}: solo and hosted differ`);
    if (SCENARIOS_THIN_TO_RICH.includes(Number(r.id)) || LINES.some(l => SCENARIO_PREMIUM_TO_SURPLUS[l][Number(r.id)] !== undefined)) out.push(`${want.name} is a designed slot`);
  }
  const test = rows.find(r => r.id === '22');
  if (test) {
    const off = Math.max(...LINES.map(l => Math.abs(test.ps[l] - oldSlot20Ps[l])));
    if (off > 5e-5) out.push(`Test Seed opens ${LINES.map(l => test.ps[l].toFixed(4)).join('/')}, scenario 20's was ${LINES.map(l => oldSlot20Ps[l].toFixed(4)).join('/')}`);
  }
  if (slot20 === BRIEFED_NAMED['22'].seed) out.push('slot 20 still plays 53781');
  check(out.length === 0, `${tag}9. the named scenarios: Staff Retreat plays 82670 and Test Seed 53781, solo and hosted alike; Test Seed opens as scenario 20 did; slot 20 plays a new seed; neither is a designed slot`,
    out[0] ?? rows.map(r => `${BRIEFED_NAMED[r.id].name} ${r.solo.instanceId}: ${LINES.map(l => `${l} ${r.ps[l].toFixed(4)}`).join(' ')}`).join('; '));
}

// ---------------------------------------------------------------- 10
/** The paid-in capital, as briefed (pr/round-paid-in-capital). */
const BRIEFED_CAPITAL: Record<CoverageLine, number> = { WC: 2_000_000, GL: 8_000_000, Property: 8_500_000 };
function gradeCapital(cap: Record<CoverageLine, number>, tag: string) {
  const off = LINES.filter(l => cap[l] !== BRIEFED_CAPITAL[l]);
  check(off.length === 0, `${tag}10. the paid-in capital is round: WC $2.0M, GL $8.0M, Property $8.5M`,
    off.length ? off.map(l => `${l} $${(cap[l] / 1e6).toFixed(2)}M`).join(', ') : LINES.map(l => `${l} $${(cap[l] / 1e6).toFixed(1)}M`).join(', '));
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
  /** Year 1's premium at Expected with no cover as the game states it (openingYear1Premium), whatever `pricing` was. */
  atExpected: number;
}
// The opening's premium: year 1's at Expected with no cover (atExpectedDecisionSet), the seeds' basis.
function open(id: string, instance: GameInstance, setup: GameSetupSettings,
  pricing?: (y: number, shocks: boolean) => ReturnType<typeof defaultDecisionSet>): { opened: Opened[]; gs: GameState } {
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
  const struck = strikeRates(gs, (pricing ?? atExpectedDecisionSet)(1, gameShocksOn(gs.setup, gs.instance)));
  const pre = [...(earlyPreGameHistory ?? []), ...priorHistory];
  return {
    gs,
    opened: LINES.map(line => ({
      n: Number(id), seed: instance.seed, line, premium: struck[line]!.quote.finalRatePer100 * struck[line]!.exposure * 10_000,
      surplus: poolState.lines[line].surplus, pre: pre.map(r => r.byLine[line]!),
      atExpected: openingYear1Premium(gs.instance, line, gs.poolState.lines[line], priorHistory[priorHistory.length - 1].byLine[line]!, gameShocksOn(gs.setup, gs.instance)),
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
// The control's arm: the same, priced at the play defaults rather than at Expected with no cover.
const atPlayDefaults: Opened[] = [];
SOLO_SHOCKS.enabled = false;
try {
  for (const id of TWENTY) {
    const { setup, instance } = openSoloInstance(settings(id));
    atPlayDefaults.push(...open(id, instance, setup, defaultDecisionSet).opened);
  }
} finally { SOLO_SHOCKS.enabled = true; }

// ---------------------------------------------------------------- 5
// The premium to surplus each scenario opens at is measured with shocks off
// (a room with none), as SCENARIO_SEEDS' table is; the game's own strike may
// differ by the shock switch's catastrophe load, which moves premium, never
// the opening's surplus.
function gradeOpening(rows: Opened[], ratioOf: (n: number, line: CoverageLine) => number, tag: string) {
  let worstOpen = 0, worstStart = 0, worstMargin = 0, offTarget = 0, worstBasis = 0;
  const missBy = new Map<number, number>();
  for (const r of rows) {
    const off = Math.abs(r.surplus / (r.premium / ratioOf(r.n, r.line)) - 1);
    offTarget = Math.max(offTarget, off);
    // ⚠ THE PREMIUM'S BASIS, PINNED (pr/round-paid-in-capital): year 1's at Expected with no cover. The
    // play-defaults control was caught only by the 7.5% bar before; at 20% the bar cannot see it.
    worstBasis = Math.max(worstBasis, Math.abs(r.premium / r.atExpected - 1));
    missBy.set(r.n, Math.max(missBy.get(r.n) ?? 0, Math.abs((r.premium / r.surplus) / ratioOf(r.n, r.line) - 1)));
    // The opening is the played history's own last year-end.
    worstOpen = Math.max(worstOpen, Math.abs(r.surplus - r.pre[r.pre.length - 1].endingSurplus));
    worstStart = Math.max(worstStart, Math.abs(r.pre[0].beginingSurplus - STARTING_CAPITAL[r.line]));
    // The prior board's recorded decisions (PRIOR_BOARD), every pre-game year.
    const want = staticClf(r.line as 'WC', PRIOR_BOARD.fundingLevel) - 1;
    worstMargin = Math.max(worstMargin, ...r.pre.map(x => Math.abs((x.decisions.fundingCushion ?? Infinity) - want)
      + Math.abs((x.decisions.fundingConfidenceLevel ?? Infinity) - PRIOR_BOARD.fundingLevel)
      + (x.decisions.fundingAtExpected ? 1 : 0) + Math.abs(x.decisions.nonRenewal ?? Infinity)
      + (x.decisions.reinsuranceOption === PRIOR_BOARD.reinsuranceOption ? 0 : 1)
      + (x.decisions.aggregateCover === PRIOR_BOARD.aggregateCover ? 0 : 1)));
  }
  const worstMiss = Math.max(...missBy.values());
  const within5 = [...missBy.values()].filter(m => m <= 0.05).length;
  // Not on the target — nothing fits it — and near it.
  const bars = SCENARIO_OPENING_BARS;
  check(worstOpen < 1e-6 && worstStart < 1e-6 && worstMargin === 0 && worstBasis < 1e-9 && offTarget > 0.05 && worstMiss <= bars.worstMiss && within5 >= bars.within5,
    `${tag}5. the opening is the fixed seed's: from the starting capital, the prior board at 65% with its covers every year, where the played history ends — not on its target, within ${(100 * bars.worstMiss).toFixed(1)}% of it on every line and 5% on all three for ${bars.within5} scenarios${bars.temporary ? ' (TEMPORARY bars — seeds to be re-picked)' : ''}`,
    `${rows.length} line-scenarios; the prior board's decisions off by ${worstMargin.toExponential(2)}; premium off year 1's at Expected by ${worstBasis.toExponential(2)}; opening off the played year-end $${worstOpen.toExponential(2)}, `
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
    `${tag}7. every pre-game line-year holds the prior board's ${mix.cashPct}/${mix.bondsPct}/${mix.equitiesPct} and earns it on the average of ${PRE_GAME_MARKET_DRAWS} markets, class by class, each on its own pre-game stream`,
    `${n} line-years; worst return off ${worst.toExponential(2)}; allocation off ${worstMix.toExponential(2)}; ${rates.size} distinct returns`);
}

// ---------------------------------------------------------------- 8
/** Every play default's allocation, by mode, against the mix. */
function gradeDefaults(sets: Record<string, AssetAllocation>, mix: AssetAllocation, tag: string) {
  const off = Object.entries(sets).filter(([, a]) => a.cashPct !== mix.cashPct || a.bondsPct !== mix.bondsPct || a.equitiesPct !== mix.equitiesPct);
  check(off.length === 0,
    `${tag}8. the play default holds ${mix.cashPct}/${mix.bondsPct}/${mix.equitiesPct} in every mode — the default set every year, the Expected basis, a solo game, a hosted room, a session year never locked`,
    `${Object.keys(sets).length} sets${off.length ? `; off: ${off.map(([k, a]) => `${k} ${a.cashPct}/${a.bondsPct}/${a.equitiesPct}`).join(', ')}` : ''}`);
}

(async () => {
  console.log('THE TWENTY SCENARIOS, AND THE NAMED ONES');
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
  // The prior board's mix, written out here rather than read from PRIOR_BOARD.
  const MIX: AssetAllocation = { cashPct: 20, bondsPct: 75, equitiesPct: 5 };
  gradeExperience(all, factorOf, drawOf, '');
  gradeReturn(all, marketOf, MIX, '');
  // 8. Every mode's play default.
  const soloGs = open('1', soloInstances['1'], openSoloInstance(settings('1')).setup).gs;
  const defaultSets: Record<string, AssetAllocation> = {
    ...Object.fromEntries([1, 2, 5, 10].flatMap(y => [
      [`defaultDecisionSet(${y})`, defaultDecisionSet(y).assetAllocation],
      [`defaultDecisionSet(${y}) shocks off`, defaultDecisionSet(y, false).assetAllocation],
      ...LINES.map(l => [`defaultDecisionSet(${y}).${l}`, defaultDecisionSet(y).byLine[l].assetAllocation]),
    ])),
    'atExpectedDecisionSet(1)': atExpectedDecisionSet(1).assetAllocation,
    'solo game, year 1': soloGs.currentDecisions.assetAllocation,
    'hosted room, year 1': room.currentDecisions.assetAllocation,
    'session year never locked': decisionsForYear(3, undefined).assetAllocation,
  };
  gradeDefaults(defaultSets, MIX, '');
  // 9. The named scenarios, solo and hosted, opened as section 5 opens the twenty (shocks off, at Expected).
  const named: NamedOpened[] = [];
  SOLO_SHOCKS.enabled = false;
  try {
    for (const id of NAMED) {
      const { setup, instance } = openSoloInstance(settings(id));
      const opened = open(id, instance, setup).opened;
      const hostedGs = buildTeamGame({ seed: id, yearCount: 10, startingYear: 2027, eventName: 'E', poolName: 'S', shocks: [], priorDevelopment: undefined } as never, LINES).gameState;
      named.push({
        id, solo: instance, hosted: hostedGs.instance, soloOpen: opened[0].surplus, hostedOpen: hostedGs.poolState.lines.WC.surplus,
        ps: Object.fromEntries(opened.map(o => [o.line, o.premium / o.surplus])) as Record<CoverageLine, number>,
      });
    }
  } finally { SOLO_SHOCKS.enabled = true; }
  const seedOf = (id: string) => Number(gameIdentity(id).gameId);
  // Scenario 20's opening on seed 53781 before pr/named-scenarios (WC, GL, Property), on today's
  // paid-in capital (pr/round-paid-in-capital). On aws 61fcf79's capital ($0 / $8.06M / $8.53M) it was
  // 2.2715124 / 1.91407235 / 1.56049157 (measured on aws 7af0fc6); the year-1 premium is unmoved.
  // With the pre-game at the doubled cover price (wip/cover-price-double; COVER_PRICE_FACTOR) — the
  // premium unmoved, the surplus down by the history's cover cost. At the table's price (aws cb0ac7e)
  // it was 1.96137098 / 1.92280804 / 1.56352989.
  const OLD_SLOT_20: Record<CoverageLine, number> = { WC: 1.96389748, GL: 1.92550409, Property: 1.56625716 };
  gradeNamed(named, seedOf, SCENARIO_SEEDS[20], OLD_SLOT_20, '');
  gradeCapital(STARTING_CAPITAL, '');

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
  controlFails('a handler accepting "23"', () => gradeHandler({ ...outcome, '23': 'accepted' }, serverSource, ''), '2.');
  controlFails('a handler refusing Staff Retreat ("21")', () => gradeHandler({ ...outcome, '21': 'refused' }, serverSource, ''), '2.');
  controlFails('a handler accepting a raw seed ("82670")', () => gradeHandler({ ...outcome, '82670': 'accepted' }, serverSource, ''), '2.');
  controlFails('the named scenarios offered as numbers ("Scenario 21")', () => gradeSetup(SCENARIO_OPTIONS, draws, setupSource, hostSource, '', id => `Scenario ${id}`, id => id), '1.');
  controlFails('a random pick that can draw a named scenario', () => gradeSetup(SCENARIO_OPTIONS, [...draws, '21'], setupSource, hostSource, ''), '1.');
  controlFails('Staff Retreat on another seed (82671)', () => gradeNamed(named, id => (id === '21' ? 82671 : seedOf(id)), SCENARIO_SEEDS[20], OLD_SLOT_20, ''), '9.');
  controlFails('slot 20 still on 53781', () => gradeNamed(named, seedOf, 53781, OLD_SLOT_20, ''), '9.');
  controlFails('Test Seed opening off scenario 20\'s (the new slot 20\'s seed in its place)', () => gradeNamed(
    named.map(r => (r.id === '22' ? { ...r, ps: Object.fromEntries(atNoShocks.filter(o => o.n === 20).map(o => [o.line, o.premium / o.surplus])) as Record<CoverageLine, number> } : r)),
    seedOf, SCENARIO_SEEDS[20], OLD_SLOT_20, ''), '9.');
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
  const board = (f: (d: LineResultSet['decisions']) => LineResultSet['decisions']) => atNoShocks.map((r, i) => (i === 0
    ? { ...r, pre: r.pre.map(y => ({ ...y, decisions: f(y.decisions) })) } : r));
  controlFails('a pre-game at a 1% margin', () => gradeOpening(board(d => ({ ...d, fundingCushion: 0.01 })), ratioOf, ''), '5.');
  controlFails('a pre-game at Expected (the board before)', () => gradeOpening(board(d => ({ ...d, fundingCushion: 0, fundingAtExpected: true })), ratioOf, ''), '5.');
  controlFails('a pre-game at 70%', () => gradeOpening(board(d => ({ ...d, fundingConfidenceLevel: 0.70 })), ratioOf, ''), '5.');
  controlFails('a pre-game without the per-claim cover', () => gradeOpening(board(d => ({ ...d, reinsuranceOption: 'none' })), ratioOf, ''), '5.');
  controlFails('a pre-game without the aggregate cover', () => gradeOpening(board(d => ({ ...d, aggregateCover: 'none' })), ratioOf, ''), '5.');
  controlFails('a pre-game non-renewing 2%', () => gradeOpening(board(d => ({ ...d, nonRenewal: 0.02 })), ratioOf, ''), '5.');
  controlFails('the opening priced at the play defaults (65% with the covers), not at Expected', () => gradeOpening(atPlayDefaults, ratioOf, ''), '5.');
  const pastBar = (r: Opened) => r.premium / (ratioOf(10, 'WC') * 0.79);
  controlFails('an opening a point past the 20% bar (scenario 10\'s WC 21% under target)', () => gradeOpening(atNoShocks.map(r => (r.n === 10 && r.line === 'WC'
    ? { ...r, surplus: pastBar(r), pre: r.pre.map((y, k) => (k === r.pre.length - 1 ? { ...y, endingSurplus: pastBar(r) } : y)) } : r)), ratioOf, ''), '5.');
  controlFails('the capital before ($0 / $8.06M / $8.53M)', () => gradeCapital({ WC: 0, GL: 8_060_000, Property: 8_530_000 }, ''), '10.');
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
  controlFails('a pre-game on the old cash and bonds (11/89)', () => gradeReturn(all, marketOf, { cashPct: 100 * 10 / 90, bondsPct: 100 * 80 / 90, equitiesPct: 0 }, ''), '7.');
  controlFails('a pre-game at the old play default (10/80/10)', () => gradeReturn(all, marketOf, { cashPct: 10, bondsPct: 80, equitiesPct: 10 }, ''), '7.');
  controlFails('a pre-game whose equities earn one draw, not the average', () => gradeReturn(all,
    (seed, y) => ({ ...marketOf(seed, y), equities: simulateMarketReturns(deriveSubRng(seed, y, 'pregame_invest_0')).equities }), MIX, ''), '7.');
  controlFails('a hosted room left at the old 10/80/10', () => gradeDefaults({ ...defaultSets,
    'hosted room, year 1': { cashPct: 10, bondsPct: 80, equitiesPct: 10 } }, MIX, ''), '8.');

  console.log('');
  if (failures.length) {
    console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log('PASS — twenty scenarios, each on its fixed seed: offered and refused as briefed, each opening where its own history ends, from the starting capital with the prior board at 65% and its covers.');
})();
