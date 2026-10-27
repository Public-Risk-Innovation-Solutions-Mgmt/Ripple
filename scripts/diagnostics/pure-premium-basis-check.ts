// ============================================================================
// YEAR-1 PRICING ON THE POOL'S OWN PURE PREMIUM — THE GATE.
//
//   npx tsx scripts/diagnostics/pure-premium-basis-check.ts
//
// The pool's supplied loss costs are its PURE PREMIUM at the year-1 level —
// WC $2.50 + $0.118 = $2.618, GL $2.50 + $0.95 = $3.45 per $100 — ultimate,
// INCLUDING ULAE and EXCLUDING ALAE.
//
//   1. CLAIMS + ULAE = THE PURE PREMIUM: on WC and GL the engine's year-1
//      expected ordinary claims per $100 are the pure premium / 1.05, and with
//      ULAE at 5% of them give $2.618 and $3.45 back exactly. Property's cost
//      is loss only and is not divided.
//   2. LAE: ULAE 5% of claims on every line; ALAE in its line's range (WC 7-15%,
//      GL 10-20%, Property 2-5%, drawn by year — alae-ratio-check holds the
//      draw), the middle of it before any history; no line's losses are read as
//      already holding ALAE.
//   3. TREND ONCE: no inflation to settlement on top (UP_FRONT_TREND off), so
//      with RESERVE INFLATION AT 0 year-1 pricing lands on the pure premium:
//      the rate's loss cost + ULAE is the pure premium x the book's own risk x
//      the scenario's pre-game experience (preGameLossMultiplier,
//      stable-scenarios commit 9 — every year in the window ran at it), within
//      1%. ⚠ RESTATED FOR RESERVE INFLATION (RESERVE_INFLATION_PER_YEAR): open
//      years now inflate after their accident year, so the window's experience
//      carries the inflation each year has emerged and pricing adds what is
//      still to come in the priced years. With it on, the landing rises by a
//      factor between the priced years' (reserveInflationToCome from age 1,
//      the least any window year carries) and the window's mean of what each
//      year carries in full by its age, within 1% either side — the only thing
//      added on top of the pure premium is reserve inflation.
//   4. ACTUAL TRACKS EXPECTED: over twelve ten-year games, each line's ordinary
//      claims drawn — before the shocks' uplift, which the record's
//      ordinaryRealised includes — are within 2% of its expected ordinary claims.
//      The totals with the shocks are reported beside them, not gated: the
//      schedule, not the catalogue, decides what fires.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: claims at the full pure premium
// (ULAE on top), GL left without ALAE, inflation to settlement left on, and
// claims drawn 5% over expected; and for 3 also the window's reserve
// inflation dropped from pricing.
//
// ⚠ RESTATED FOR wip/adverse-development: RESERVE INFLATION IS OFF
// (RESERVE_INFLATION.enabled false, every line's rate 0) and ADVERSE
// DEVELOPMENT (ADVERSE_DEVELOPMENT, by level) replaces it, which PRICING DOES
// NOT ANTICIPATE — it reaches the rate only as it emerges in the experience.
// Nothing develops in the pre-game, so the year-1 window holds none of it.
// The old 3 asked for a rise "between the priced years' factor and the
// window's mean" that is 1 to 1 at a rate of 0, so it held trivially, and its
// control ("the window's reserve inflation dropped") compared the shipped
// strike with an identical one and could no longer fail. 3 now reads:
//
//   3. TREND ONCE, AND NOTHING ON TOP: as shipped, year-1 pricing's loss cost
//      + ULAE is the pure premium x the book's own risk x the scenario's
//      pre-game experience, within 1% (the same bar as before; at a rate of 0
//      the old "flat" strike IS the shipped one); reserve inflation is off —
//      reserveInflationToCome is exactly 1 on every line — and the year-1
//      strike is BIT-IDENTICAL whether every line develops Low or High, on
//      every line and game: pricing does not anticipate adverse development.
//
// 3's controls: inflation to settlement left on (as before); reserve
// inflation SWITCHED BACK ON INSIDE THIS PROCESS at the severity trend and
// the year-1 rates struck again, which must fail the landing (restored at
// once); and a strike that loads the High level's λ (its range's middle),
// which must fail the level identity.
//
// ⚠ RESTATED FOR wip/development-pricing: THE PRE-GAME NOW DEVELOPS AT THE
// GAME'S LEVEL (PRE_GAME_ADVERSE_DEVELOPMENT) AND PRICING LEARNS THE POOL'S OWN
// AGE-TO-AGE FACTORS (LEARNED_DEVELOPMENT), so a game at High opens on a
// heavier, learned window than one at Low — the strike differs by level BY
// DESIGN (up to ~50% on these games). The old "bit-identical at every level"
// no longer holds as shipped. What it guarded still does: pricing never reads
// the level itself. 3 now reads:
//
//   3. as before for the landing and reserve inflation (plain single player,
//      every line Off: unchanged); WITH BOTH SWITCHES OFF the year-1 strike is
//      BIT-IDENTICAL at Low and High on every line and game — nothing prices
//      the level directly; and WITH THEM ON (as shipped) the mean strike at
//      High is above Low on every line — the level reaches the rate only
//      through the pre-game's developed experience, which pricing learns.
//
// 3's new control: the switches-off strikes standing in for the shipped ones,
// which must fail "High above Low". The λ-load control now loads the
// switches-off High strike and still fails the level identity.
// ============================================================================

import {
  ALAE_OF_LOSS_COST, ALAE_RATIO_RANGE, POOL_LOSS_COST_LAYERS, preGameLossMultiplier, ULAE_OF_LOSS_COST, UP_FRONT_TREND,
  RESERVE_INFLATION, RESERVE_INFLATION_PER_YEAR, SEVERITY_TREND_PER_YEAR, ADVERSE_DEVELOPMENT, ADVERSE_DEVELOPMENT_RANGE,
  PRE_GAME_ADVERSE_DEVELOPMENT, LEARNED_DEVELOPMENT,
  type DevelopmentLevel,
} from '../../src/data/pricingParameters';
import { reserveInflationToCome } from '../../src/utils/newPurePremium';
import { scenarioOf } from '../../src/utils/scenarios';
import { ALAE_ALREADY_IN_LOSSES } from '../../src/utils/newPurePremium';
import { laeShares } from '../../src/utils/lossExpense';
import { ordinaryLossCostPer100 } from '../../src/utils/ordinaryLoss';
import { upFrontTrendFactor } from '../../src/data/paidDevelopmentPatterns';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, strikeRates } from '../../src/utils/worlds';
import type { CoverageLine, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SUPPLIED: Partial<Record<CoverageLine, number>> = { WC: 2.618, GL: 3.45 };
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));

// ---------------------------------------------------------------- 1
type Claims = (l: CoverageLine) => number;
function gradeClaims(claims: Claims, tag: string) {
  let worst = 0;
  const shown: string[] = [];
  for (const l of ['WC', 'GL'] as CoverageLine[]) {
    const layers = (POOL_LOSS_COST_LAYERS[l] ?? []).reduce((a, x) => a + x.per100, 0);
    worst = Math.max(worst, rel(layers, SUPPLIED[l]!), rel(claims(l) * (1 + ULAE_OF_LOSS_COST[l]), SUPPLIED[l]!));
    shown.push(`${l} claims $${claims(l).toFixed(4)} + ULAE $${(claims(l) * ULAE_OF_LOSS_COST[l]).toFixed(4)} = $${(claims(l) * (1 + ULAE_OF_LOSS_COST[l])).toFixed(4)}`);
  }
  check(worst < 1e-12, `${tag}1. year-1 claims + ULAE equal the supplied pure premium on WC and GL`, shown.join('; '));
}

// ---------------------------------------------------------------- 2
type Shares = (l: CoverageLine) => { alae: number; ulae: number };
function gradeLae(shares: Shares, tag: string) {
  const mid = (l: CoverageLine) => (ALAE_RATIO_RANGE[l].min + ALAE_RATIO_RANGE[l].max) / 2;
  const ok = LINES.every(l => shares(l).alae === mid(l) && shares(l).ulae === 0.05 && !ALAE_ALREADY_IN_LOSSES[l]
    && ALAE_OF_LOSS_COST[l] === mid(l) && ULAE_OF_LOSS_COST[l] === 0.05
    && ALAE_RATIO_RANGE[l].min > 0 && ALAE_RATIO_RANGE[l].max > ALAE_RATIO_RANGE[l].min);
  check(ok, `${tag}2. ULAE is 5% of claims on every line; ALAE is in its line's range, at its middle before history; GL takes ALAE too`,
    LINES.map(l => `${l} ${shares(l).alae} + ${shares(l).ulae}`).join(', '));
}

// ---------------------------------------------------------------- games
const SEEDS = 12;
interface Seen { pp: number; ulae: number; risk: number; experience: number }
const atYear1: Record<CoverageLine, Seen[]> = { WC: [], GL: [], Property: [] };
const drawn: Record<CoverageLine, { real: number; exp: number }> = { WC: { real: 0, exp: 0 }, GL: { real: 0, exp: 0 }, Property: { real: 0, exp: 0 } };
const totals: Record<CoverageLine, { real: number; exp: number }> = { WC: { real: 0, exp: 0 }, GL: { real: 0, exp: 0 }, Property: { real: 0, exp: 0 } };
for (let g = 0; g < SEEDS; g++) {
  const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: 10, startingYear: 2026, instanceId: `PPB${g}`, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
  const struck = strikeRates(gs, defaultDecisionSet(1));
  for (const l of LINES) {
    const s = struck[l]!;
    atYear1[l].push({ pp: s.newPp.lossCostPer100, ulae: s.newPp.ulaePer100, risk: 1, experience: preGameLossMultiplier(scenarioOf(instance), l) });
  }
  for (let y = 1; y <= 10; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), LINES)), currentYearNumber: y + 1 };
    for (const w of gs.worlds ?? []) for (const l of LINES) {
      // The year just settled: a world keeps only its last row (commit 10).
      const x = w.lockedResults[w.lockedResults.length - 1].byLine[l]!, n = x.newLossEngine!;
      drawn[l].real += n.ordinaryRealised / (1 + n.uplift);
      drawn[l].exp += n.ordinaryExpected;
      totals[l].real += x.bookedGrossUltimate ?? x.grossUltimateLoss;
      totals[l].exp += x.expectedLoss;
    }
  }
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// THE SAME YEAR-1 STRIKE ON THE SAME GAMES, varied one thing at a time. With
// every line at one development level (setup.developmentLevels); and, for
// 3's control, with reserve inflation switched back on at the severity trend
// (RESERVE_INFLATION's "on"), restored at once.
function strikeYear1(levels?: DevelopmentLevel): Record<CoverageLine, Seen[]> {
  const out: Record<CoverageLine, Seen[]> = { WC: [], GL: [], Property: [] };
  for (let g = 0; g < SEEDS; g++) {
    const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: 10, startingYear: 2026, instanceId: `PPB${g}`, activeLines: LINES,
      ...(levels ? { developmentLevels: { WC: levels, GL: levels, Property: levels } } : {}) } as GameSetupSettings);
    const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
    const gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
    const struck = strikeRates(gs, defaultDecisionSet(1));
    for (const l of LINES) {
      const s = struck[l]!;
      out[l].push({ pp: s.newPp.lossCostPer100, ulae: s.newPp.ulaePer100, risk: 1, experience: preGameLossMultiplier(scenarioOf(instance), l) });
    }
  }
  return out;
}
const atYear1Low = strikeYear1('Low');
const atYear1High = strikeYear1('High');
// Both development switches off inside this process, restored at once.
const switchedOff = <T>(run: () => T): T => {
  const saved = [PRE_GAME_ADVERSE_DEVELOPMENT.enabled, LEARNED_DEVELOPMENT.enabled];
  PRE_GAME_ADVERSE_DEVELOPMENT.enabled = false; LEARNED_DEVELOPMENT.enabled = false;
  try { return run(); } finally { [PRE_GAME_ADVERSE_DEVELOPMENT.enabled, LEARNED_DEVELOPMENT.enabled] = saved; }
};
const offLow = switchedOff(() => strikeYear1('Low'));
const offHigh = switchedOff(() => strikeYear1('High'));
const atYear1Inflated = (() => {
  const inflation = RESERVE_INFLATION_PER_YEAR as Record<CoverageLine, number>;
  const saved = { ...inflation };
  RESERVE_INFLATION.enabled = true;
  for (const l of LINES) inflation[l] = SEVERITY_TREND_PER_YEAR[l];
  try { return strikeYear1(); } finally { RESERVE_INFLATION.enabled = false; Object.assign(inflation, saved); }
})();

// ---------------------------------------------------------------- 3
type ByLevel = Record<string, Record<CoverageLine, Seen[]>>;
function gradeLanding(seen: Record<CoverageLine, Seen[]>, byLevel: ByLevel, shipped: { Low: Record<CoverageLine, Seen[]>; High: Record<CoverageLine, Seen[]> }, upFront: (l: CoverageLine) => number, tag: string) {
  let worst = 0, worstLevel = 0;
  const shown: string[] = [];
  const landedOf = (xs: Seen[]) => mean(xs.map(s => (s.pp + s.ulae) / s.risk / s.experience));
  for (const l of ['WC', 'GL'] as CoverageLine[]) {
    const landed = landedOf(seen[l]) * upFront(l);
    worst = Math.max(worst, rel(landed, SUPPLIED[l]!));
    shown.push(`${l} $${landed.toFixed(4)}`);
  }
  const [first, ...rest] = Object.values(byLevel);
  for (const level of rest) for (const l of LINES) first[l].forEach((s, g) => {
    worstLevel = Math.max(worstLevel, rel(level[l][g].pp + level[l][g].ulae, s.pp + s.ulae));
  });
  const meanOf = (xs: Seen[]) => mean(xs.map(s => s.pp + s.ulae));
  const rise = LINES.map(l => meanOf(shipped.High[l]) / meanOf(shipped.Low[l]) - 1);
  const noInflation = !RESERVE_INFLATION.enabled && LINES.every(l => reserveInflationToCome(l, 1) === 1);
  const switchesOn = PRE_GAME_ADVERSE_DEVELOPMENT.enabled && LEARNED_DEVELOPMENT.enabled;
  check(worst < 0.01 && !UP_FRONT_TREND.enabled && noInflation && worstLevel < 1e-12 && ADVERSE_DEVELOPMENT.enabled && switchesOn && rise.every(r => r > 0),
    `${tag}3. trend once and nothing on top: year-1 pricing's loss cost + ULAE lands on the pure premium (per unit of book risk and of the scenario's pre-game experience), reserve inflation off; with the development switches off the strike is the same at every level — nothing prices the level itself; as shipped, High strikes above Low on every line — through the learned pre-game only`,
    `${shown.join(', ')} against $2.618 and $3.45, worst ${(worst * 100).toFixed(2)}%; reserve inflation ${noInflation ? 'off, factor 1' : 'ON'}; `
    + `switches off, ${Object.keys(byLevel).join(' against ')}, ${SEEDS} games x 3 lines, worst ${worstLevel.toExponential(2)}; `
    + `as shipped, High over Low ${LINES.map((l, i) => `${l} ${(rise[i] * 100).toFixed(1)}%`).join(', ')}`);
}

// ---------------------------------------------------------------- 4
function gradeTracking(d: typeof drawn, tag: string) {
  const ratios = LINES.map(l => d[l].real / d[l].exp);
  check(ratios.every(r => Math.abs(r - 1) < 0.02),
    `${tag}4. over ten years, ordinary claims drawn track expected on every line, within 2%`,
    LINES.map((l, i) => `${l} ${ratios[i].toFixed(4)}`).join(', ') + ` (actual / expected, ${SEEDS} games x 10 years x 10 worlds); `
    + `with the shocks, gross / ex-ante expected: ${LINES.map(l => `${l} ${(totals[l].real / totals[l].exp).toFixed(4)}`).join(', ')}`);
}

console.log('YEAR-1 PRICING ON THE POOL\'S OWN PURE PREMIUM');
gradeClaims(l => ordinaryLossCostPer100(l, 1), '');
gradeLae(laeShares, '');
const LEVELS = { 'all Low': offLow, 'all High': offHigh };
const SHIPPED = { Low: atYear1Low, High: atYear1High };
gradeLanding(atYear1, LEVELS, SHIPPED, () => 1, '');
gradeTracking(drawn, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('claims at the full pure premium (ULAE on top)', () => gradeClaims(l => ordinaryLossCostPer100(l, 1) * 1.05, ''), '1.');
controlFails('GL left without ALAE', () => gradeLae(l => (l === 'GL' ? { alae: 0, ulae: 0.05 } : laeShares(l)), ''), '2.');
UP_FRONT_TREND.enabled = true;
const dormantF = Object.fromEntries(LINES.map(l => [l, upFrontTrendFactor(l)])) as Record<CoverageLine, number>;
UP_FRONT_TREND.enabled = false;
controlFails('inflation to settlement left on', () => gradeLanding(atYear1, LEVELS, SHIPPED, l => dormantF[l], ''), '3.');
controlFails('reserve inflation switched back on at the trend and priced', () => gradeLanding(atYear1Inflated, LEVELS, SHIPPED, () => 1, ''), '3.');
{
  const [lo, hi] = ADVERSE_DEVELOPMENT_RANGE.High;
  const loaded = Object.fromEntries(LINES.map(l => [l, offHigh[l].map(s => ({ ...s, pp: s.pp * (1 + (lo + hi) / 2) }))])) as Record<CoverageLine, Seen[]>;
  controlFails("a strike that loads the High level's λ", () => gradeLanding(atYear1, { 'all Low': offLow, 'all High': loaded }, SHIPPED, () => 1, ''), '3.');
}
controlFails('the switches-off strikes standing in for the shipped ones', () => gradeLanding(atYear1, LEVELS, { Low: offLow, High: offHigh }, () => 1, ''), '3.');
controlFails('claims drawn 5% over expected', () => gradeTracking(
  Object.fromEntries(LINES.map(l => [l, { real: drawn[l].real * 1.05, exp: drawn[l].exp }])) as typeof drawn, ''), '4.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — claims + ULAE are the pool\'s pure premium, ALAE on top in its range, trend once with nothing on top (no reserve inflation; the level reaches the rate only through the learned pre-game), and claims track expected.');
