// ============================================================================
// THE AGGREGATE STOP, PER LINE — THE GATE (stable-scenarios commit 6).
//
//   npx tsx scripts/diagnostics/aggregate-stop-check.ts
//
//   1. THE OPTIONS: None; Working 100% / 50%; Bad-year 115% / 50%; Catastrophe
//      130% / 100% — shares of the year's expected losses — Bad-year the
//      default for players and the prior board, and no occurrence layer
//      placed by any of them. With the switch off, the per-claim packages.
//   2. THE PRICE: each option's premium is its expected recovery + 0.5 x the
//      SD of the annual recovery, no floor, over sampled accident years whose
//      average is the engine's own expected loss — and it is what the rate
//      charges, IN FULL, as reinsurance, with nothing taken off the claims cost
//      for the cover's expected recovery (STOP_RECOVERY_OFF_CLAIMS_COST off).
//   3. AT BOOKING: every played line-year's recovery is exactly the stop on its
//      booked gross total, on terms set off its expected losses.
//   4. AS IT DEVELOPS: every cohort's recovery is the stop on its developed
//      gross, and the year's change in all of them is its prior-year ceded
//      development.
//   5. WHAT PLAYERS SEE: each option's name, one sentence of what it covers, and
//      its price — e.g. "Covers the year's losses above 115% of expected, up
//      to 50% more." — and nothing of how it was priced.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: Working made the default, a
// price without the SD load, the expected recovery netted off the claims
// cost, a recovery struck on expected rather than
// actual, a recovery left where it was booked, and a wording that gives away
// the expected recovery.
//
// ⚠ RESTATED FOR THE SHOCKS LANDING (wip/shocks, 2ae5c1a): the stop is
// DORMANT as shipped — AGGREGATE_STOP off, the per-occurrence T covers
// (REINSURANCE_OPTIONS) offered in its place. So this gate now does both:
//
//   0. THE DORMANCY, as shipped: the switch off, the T covers offered (None
//      and the four layers), None the default, no stop id accepted.
//
// and then SWITCHES THE STOP ON INSIDE ITS OWN PROCESS and grades 1-5 on the
// dormant code, so it stays correct for the day it is switched back on. Off,
// "the packages" of 1 are now the T covers. A solo game's shocks are on
// (SOLO_SHOCKS), so a solo prior board holds the shocks-on default, Bad-year;
// the shocks-off default (None) is read from defaultReinsuranceOption.
// 2's sample mean is held to 4 standard errors of the samples, not a flat 1%:
// a T is now ONE fixed-dollar claim of up to $40M, and Property's 50,000
// samples carry about 0.8% of noise on their own.
// ============================================================================

import {
  AGGREGATE_STOP, AGGREGATE_STOP_DEFAULT, AGGREGATE_STOP_OPTIONS, AGGREGATE_STOP_SD_LOAD, REINSURANCE_OPTIONS,
  STOP_RECOVERY_OFF_CLAIMS_COST,
} from '../../src/data/pricingParameters';
import {
  sampledYearTotals, stopQuotes, stopRecovery, stopTerms, stopWording, type StopQuote,
} from '../../src/utils/aggregateStop';
import {
  defaultReinsuranceOption, fullTowerOption, isReinsuranceOption, placementFor, reinsuranceOptionIds,
} from '../../src/utils/reinsuranceOptions';
import { expectedLossBreakdown } from '../../src/utils/shockExpectation';
import { quoteNewRateStack } from '../../src/utils/linePricing';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import type { CoverageLine, DecisionSet, GameSetupSettings, GameState, LineResultSet, PoolState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

// ---------------------------------------------------------------- 0
// THE DORMANCY (shocks landing): as shipped the stop is off and the T covers
// are what a team is offered. Written out here, not read from the parameter.
const T_COVER_IDS = ['none', '$9M xs $1M', '$8M xs $2M', '$18M xs $2M', '$38M xs $2M'];
function gradeDormancy(tag: string) {
  const off = !AGGREGATE_STOP.enabled;
  const offered = LINES.every(l => reinsuranceOptionIds(l, true).join('|') === T_COVER_IDS.join('|')
    && reinsuranceOptionIds(l, false).join('|') === 'none');
  const defaults = LINES.every(l => defaultReinsuranceOption(l) === 'none' && defaultReinsuranceOption(l, false) === 'none');
  const noStopIds = LINES.every(l => AGGREGATE_STOP_OPTIONS.every(o => o.id === 'none' || !isReinsuranceOption(l, o.id)));
  const widest = LINES.every(l => fullTowerOption(l) === '$38M xs $2M');
  check(off && offered && defaults && noStopIds && widest,
    `${tag}0. as shipped the stop is dormant: switch off, the T covers offered, None the default, no stop id accepted`,
    `AGGREGATE_STOP ${AGGREGATE_STOP.enabled ? 'ON' : 'off'}; WC offers ${reinsuranceOptionIds('WC').join(', ')}`);
}
console.log('THE AGGREGATE STOP, PER LINE — DORMANT AS SHIPPED');
gradeDormancy('');
// ...and its CONTROL here, before the switch is thrown for 1-5.
{
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  AGGREGATE_STOP.enabled = true;
  try { gradeDormancy(''); } finally { AGGREGATE_STOP.enabled = false; console.log = saved; }
  const caught = failures.splice(before).filter(f => f.startsWith('0.'));
  check(caught.length > 0, 'control: the stop left switched on is caught by 0.');
}
// THE STOP, SWITCHED ON IN THIS PROCESS ONLY, for 1-5.
AGGREGATE_STOP.enabled = true;

// ---------------------------------------------------------------- 1
const BRIEF: Record<string, [number, number]> = { none: [0, 0], working: [1.0, 0.5], 'bad-year': [1.15, 0.5], catastrophe: [1.3, 1.0] };
function gradeOptions(defaultOf: (l: CoverageLine) => string, preGame: ResultSet[], tag: string) {
  const shapes = AGGREGATE_STOP_OPTIONS.length === 4
    && AGGREGATE_STOP_OPTIONS.every(o => BRIEF[o.id] && BRIEF[o.id][0] === o.attachment && BRIEF[o.id][1] === o.limit);
  // ⚠ THE DEFAULT FOLLOWS THE GAME'S SHOCKS (AGGREGATE_STOP_DEFAULT_SHOCKS_OFF):
  // Bad-year with them on; None with them off. Since the shocks landing a solo
  // game's shocks are on (SOLO_SHOCKS), so its prior board holds Bad-year.
  const defaults = LINES.every(l => defaultOf(l) === 'bad-year' && defaultReinsuranceOption(l, false) === 'none')
    && preGame.every(r => LINES.every(l => r.byLine[l]!.decisions.reinsuranceOption === 'bad-year'));
  const noLayers = LINES.every(l => AGGREGATE_STOP_OPTIONS.every(o => placementFor(l, o.id).every(p => !p)));
  // Off, the T covers (shocks landing): None the default, placing nothing, and
  // every other option a placement of whole tower layers.
  AGGREGATE_STOP.enabled = false;
  const dormant = LINES.every(l => isReinsuranceOption(l, defaultReinsuranceOption(l))
    && placementFor(l, defaultReinsuranceOption(l)).every(p => !p)
    && REINSURANCE_OPTIONS[l as 'WC'].every(o => o.limit === 0 || placementFor(l, o.id).some(Boolean)));
  AGGREGATE_STOP.enabled = true;
  check(AGGREGATE_STOP.enabled && shapes && defaults && noLayers && dormant,
    `${tag}1. four options as briefed, Bad-year the default with shocks on (a solo prior board too) and None with them off, no occurrence layer; off, the T covers`,
    `${preGame.length} pre-game years checked`);
}

// ---------------------------------------------------------------- 2
type Price = (q: StopQuote, totals: Float64Array) => number;
const shippedPrice: Price = (q, totals) => {
  let m1 = 0, m2 = 0;
  for (const x of totals) { const r = stopRecovery(x, q); m1 += r; m2 += r * r; }
  const mean = m1 / totals.length;
  return mean + AGGREGATE_STOP_SD_LOAD * Math.sqrt(Math.max(0, m2 / totals.length - mean * mean));
};
// `drift` scales the samples' mean check only — the control for 4 standard errors.
function gradePrice(price: Price, tag: string, drift = 1) {
  let worstPrice = 0, worstMean = 0, worstSe = 0, worstCharge = 0;
  const shown: string[] = [];
  for (const l of LINES) for (const y of [1, 5, 10]) {
    const exposure = 800 + 50 * y;
    const totals = sampledYearTotals(l, exposure, y);
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    const se = Math.sqrt(totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length / totals.length);
    const expected = expectedLossBreakdown(l, exposure, y).total * drift;
    worstMean = Math.max(worstMean, Math.abs(mean / expected - 1));
    worstSe = Math.max(worstSe, Math.abs(mean - expected) / se);
    for (const q of stopQuotes(l, exposure, y)) {
      worstPrice = Math.max(worstPrice, rel(q.premium, price(q, totals)));
      const stack = quoteNewRateStack({
        line: l, yearNumber: y, members: { exposure }, exposure, groundUpPurePremiumPer100: 5, clf: 1,
        riskControlPct: 0, layersPlaced: placementFor(l, q.optionId), aggregateStopLevel: -1, reinsuranceOption: q.optionId,
      });
      // The full price as reinsurance; the claims cost (5 per $100) untouched.
      worstCharge = Math.max(worstCharge, rel(stack.reinsuranceCost, q.premium),
        Math.abs(stack.retainedPurePremiumPer100 - 5) * exposure * 10_000, stack.expectedCededPer100 * exposure * 10_000);
      if (y === 1 && q.optionId === 'bad-year') shown.push(`${l} ${(q.premium / 1e6).toFixed(3)}M`);
    }
  }
  check(worstPrice < 1e-9 && worstSe < 4 && worstCharge < 1e-9,
    `${tag}2. price = E[recovery] + ${AGGREGATE_STOP_SD_LOAD} x SD, over samples averaging the engine's expected loss, charged in full, nothing off the claims cost`,
    `Bad-year, year 1, $1,000M+ book: ${shown.join(', ')}; samples off expected by at most ${(worstMean * 100).toFixed(2)}% `
    + `(${worstSe.toFixed(1)} standard errors)`);
}

// ---------------------------------------------------------------- games
interface Played { results: ResultSet[]; states: PoolState[]; pre: ResultSet[] }
function play(id: string, years: number, option: string): Played {
  const { setup, instance } = openSoloInstance({ poolName: 'S', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const decide = (y: number): DecisionSet => {
    const d = defaultDecisionSet(y);
    return { ...d, byLine: Object.fromEntries(LINES.map(l => [l, { ...d.byLine[l], reinsuranceOption: option }])) as DecisionSet['byLine'] };
  };
  let gs = { setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: decide(1), priorHistory, earlyPreGameHistory } as GameState;
  const results: ResultSet[] = [], states: PoolState[] = [poolState];
  for (let y = 1; y <= years; y++) {
    const p = processYear(gs, decide(y));
    results.push(p.result);
    states.push(p.updatedPoolState);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return { results, states, pre: [...(earlyPreGameHistory ?? []), ...priorHistory] };
}
const games = ['ASC1', 'ASC2', 'ASC3', 'ASC4'].flatMap(id => ['working', 'bad-year', 'catastrophe'].map(o => play(id, 8, o)));

// ---------------------------------------------------------------- 3
type Booked = (r: LineResultSet) => number;
const shippedBooked: Booked = r => stopRecovery(r.bookedGrossUltimate ?? r.grossUltimateLoss,
  stopTerms(r.decisions.reinsuranceOption, r.expectedLoss));
function gradeBooking(want: Booked, tag: string) {
  let worst = 0, n = 0, paid = 0;
  for (const g of games) for (const r of g.results) for (const l of LINES) {
    const x = r.byLine[l]!;
    n++;
    if (x.reinsuranceRecovery > 0) paid++;
    worst = Math.max(worst, rel(x.reinsuranceRecovery, want(x)));
  }
  check(worst < 1e-9, `${tag}3. at booking, each year's recovery is the stop on its booked gross total`,
    `${n} line-years, ${paid} with a recovery; worst relative ${worst.toExponential(2)}`);
}

// ---------------------------------------------------------------- 4
type Developed = (c: NonNullable<PoolState['lines'][CoverageLine]>['reserveCohorts'][number]) => number;
const shippedDeveloped: Developed = c => stopRecovery((c.grossPaid ?? 0) + (c.grossUnpaid ?? 0), c.aggregateStop!);
function gradeDevelopment(want: Developed, tag: string) {
  let worstCohort = 0, worstFlow = 0, cohorts = 0, moved = 0;
  for (const g of games) for (let y = 1; y < g.states.length; y++) for (const l of LINES) {
    const before = new Map((g.states[y - 1].lines[l]?.reserveCohorts ?? []).map(c => [c.yearNumber, c]));
    let flow = 0;
    for (const c of g.states[y].lines[l]?.reserveCohorts ?? []) {
      if (!c.aggregateStop) continue;
      cohorts++;
      // A cohort whose net reserve could not give up its whole change is
      // exempt from the identity until it catches up; none should.
      worstCohort = Math.max(worstCohort, rel(c.aggregateStop.recovered, want(c)));
      const prev = before.get(c.yearNumber)?.aggregateStop;
      if (prev) { flow += c.aggregateStop.recovered - prev.recovered; if (c.aggregateStop.recovered !== prev.recovered) moved++; }
    }
    worstFlow = Math.max(worstFlow, rel(g.results[y - 1].byLine[l]!.priorYearDevelopmentCeded ?? 0, flow));
  }
  check(worstCohort < 1e-9 && worstFlow < 1e-6 && moved > 0,
    `${tag}4. as each year develops its recovery is the stop on its developed gross; the change is prior-year ceded development`,
    `${cohorts} cohort-valuations, ${moved} moved; worst relative ${Math.max(worstCohort, worstFlow).toExponential(2)}`);
}

// ---------------------------------------------------------------- 5
function gradeWording(wording: (id: string) => string, tag: string) {
  const bad = wording('bad-year');
  const clean = AGGREGATE_STOP_OPTIONS.every(o => !/\$|expected recovery|SD|price/i.test(wording(o.id)));
  check(bad === 'Covers the year\'s losses above 115% of expected, up to 50% more.' && clean,
    `${tag}5. players see each option's name, what it covers and its price — nothing of how it was priced`, `"${bad}"`);
}

console.log('\nTHE AGGREGATE STOP, SWITCHED ON IN THIS PROCESS');
gradeOptions(defaultReinsuranceOption, games[0].pre, '');
gradePrice(shippedPrice, '');
gradeBooking(shippedBooked, '');
gradeDevelopment(shippedDeveloped, '');
gradeWording(stopWording, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('Working made the default', () => gradeOptions(() => 'working', games[0].pre, ''), '1.');
controlFails('a price without the SD load', () => gradePrice((q, t) => shippedPrice(q, t) - AGGREGATE_STOP_SD_LOAD * q.sdRecovery, ''), '2.');
controlFails('samples 2% off the engine\'s expected loss', () => gradePrice(shippedPrice, '', 1.02), '2.');
STOP_RECOVERY_OFF_CLAIMS_COST.enabled = true;
controlFails('the expected recovery netted off the claims cost', () => gradePrice(shippedPrice, ''), '2.');
STOP_RECOVERY_OFF_CLAIMS_COST.enabled = false;
controlFails('a recovery struck on expected, not actual', () => gradeBooking(r => stopRecovery(r.expectedLoss,
  stopTerms(r.decisions.reinsuranceOption, r.expectedLoss)) + (r.reinsuranceRecovery > 0 ? 1 : 0), ''), '3.');
controlFails('a recovery left where it was booked', () => gradeDevelopment(c => shippedDeveloped(c) * 1.01 + 1e4, ''), '4.');
controlFails('a wording that gives away the expected recovery', () => gradeWording(id => `${stopWording(id)} Expected recovery $1.2M.`, ''), '5.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log(`PASS — the stop's options and default (${AGGREGATE_STOP_DEFAULT}), its price, its recovery at booking and as it develops, and what players see.`);
