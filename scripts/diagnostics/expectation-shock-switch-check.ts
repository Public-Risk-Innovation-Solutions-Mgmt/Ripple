// ============================================================================
// THE EXPECTATION FOLLOWS THE GAME'S SHOCKS.
//
//   npx tsx scripts/diagnostics/expectation-shock-switch-check.ts
//
// A game whose shocks are off — single-player with SOLO_SHOCKS off, or a room
// whose host scheduled none — reads the ordinary-loss expectation only: the
// Expected Losses rows, the reserve basis on them, the aggregate stop's
// attachment and each cover's price and recovery distribution. A hosted game
// with a schedule, and a harness on the catalogue, keep the shock-inclusive
// expectation (shockLosses.gameShocksOn; docs/PARAMETERS.md).
//
//   1. THE SWITCH: a room with a schedule on, without one off; a harness's
//      bare instance on. ⚠ RESTATED FOR THE SHOCKS LANDING (2ae5c1a): a solo
//      game with SOLO_SHOCKS on is ON whatever its catalogue draw — one that
//      drew events and one that drew none alike — and one with SOLO_SHOCKS
//      off is off. (It was: solo off, SOLO_SHOCKS being off.)
//   2. THE EXPECTATION OFF: no uplift, no shock large losses — ordinary plus
//      routine large losses — and on, the same as it ever was.
//   3. THE COVER OFF: every option's attachment and limit are its shares of the
//      shocks-off expectation (ordinary, plus the large claims while
//      LARGE_CLAIMS_EVERY_GAME is on), and its price is E + load over that year
//      alone; on, over the year with its shocks. ⚠ SINCE THE SHOCKS LANDING
//      THE AGGREGATE STOP IS DORMANT (AGGREGATE_STOP.enabled false — the T
//      covers are offered instead); 3 holds its still-built code to the switch.
//   4. A SOLO GAME. ⚠ RESTATED FOR THE SHOCKS LANDING: with SOLO_SHOCKS off
//      (switched off at runtime here) each year's Expected Losses (averaged)
//      is within 2% of its Simulated Losses and the years' mean within 1%
//      (restated for the fixed-seed scenarios from 1% a year: 3 SD of the
//      worlds' measured sampling noise, see 4a) — once the game's
//      member risk is divided out (simple underwriting: the risk scores are
//      the game's, so the worlds' average keeps them). With SOLO_SHOCKS on
//      (shipped) the game's shocks are on, so its Expected Losses keeps them
//      (above the ordinary-only, as 5) — Simulated no longer averages them,
//      every world sharing the game seed's events — and a T cover it holds is
//      charged its price by the method at shockCost.shockCostFactor. (It was:
//      solo Expected within 1% of Simulated, the struck cover the shocks-off
//      aggregate-stop quote.)
//   5. A HOSTED GAME WITH A SCHEDULE keeps the shocks in its expectation.
//   6. THE OFFER. ⚠ RESTATED FOR THE SHOCKS LANDING (per-occurrence T covers):
//      shocks off, only None is offered; on, None and the eight T covers; the
//      default None either way. (It was the stop's: off, None and the Working
//      cover, None the default; on, all four, the Bad-year cover the default.)
//   7. THE PRIOR BOARD holds the default — ⚠ since the shocks landing None
//      through every pre-game: a solo game's, shocks on or off, and a
//      scheduled room's. (It was: the Bad-year cover in a scheduled room.)
//   8. PROPERTY'S CATASTROPHE CAPITAL: none with the shocks off, under every
//      cover; with them on, it returns. Through the engine, a solo Property
//      game with SOLO_SHOCKS off carries no catastrophe charge in any year, and
//      ⚠ (restated for the shocks landing) a solo game with SOLO_SHOCKS on, as
//      a scheduled room, carries one in every year.
// Each with a control that must fail.
//
// ⚠ RESTATED FOR wip/reinsurance-layers: (a) the T covers are now None plus
// EIGHT layers — 9, 19, 29 and 39 xs 1; 8, 18, 28 and 38 xs 2 — so 6.'s
// written-out menu is the eight (None still the default, None alone with the
// shocks off); a control puts the wip/shocks four-cover menu back and must
// fail 6. (b) The fixed price table (REINSURANCE_PRICE) is gone: a cover's
// price is re-worked each year by the pricing workbook's method at the T
// claims' own growth factor (reinsuranceOptions.tCoverPrice at
// shockCost.shockCostFactor) — no longer "table price x factor", which the
// method is not (it is not linear in the factor). So 4b's `quoted` is now the
// METHOD, re-derived here from its written-out frequencies (7.5% / 5.25% /
// 2.25%) and multipliers (30M x1.25 the 20M, 40M x1.2 the unmultiplied 30M) on
// SHOCK_T_CLAIM_RANGE's midpoints, and 4b also asserts optionPrice agrees with
// it and that WC 9 xs 1 at factor 1 is the documented $461,250. A control
// charges the retired fixed-table price grown by the factor and must fail 4b.
//
// ⚠ RESTATED FOR LARGE_CLAIMS_EVERY_GAME: large claims are now drawn in every
// game, shocks on or off — "shocks off" means only that no catalogue event
// fires. So, with the shocks off:
//   2. the expectation has NO UPLIFT, but its shockLarge EQUALS shocks-on's
//      (total = ordinary + routine large + shockLarge), still below shocks-on.
//   4a. a SOLO_SHOCKS-off game's Expected Losses is the shocks-off expectation
//      (with shockLarge), its 'T' records are exactly where largeClaimArrivals
//      drew on WC, fired in every world, and the 2% / 1% bar is held on what
//      the worlds average: Simulated less the drawn large claims against
//      Expected less its shockLarge (x the member risk) — the large claims, as
//      the shocks with SOLO_SHOCKS on, are the game seed's, shared by every
//      world, so the worlds' average cannot average them.
//   6. None and the eight T covers are offered with the shocks off too, None
//      the default either way (prices: optionPrice takes no shock switch).
//   8a. Property's catastrophe (large-claim) capital with the shocks off EQUALS
//      the shocks-on capital under every cover, and is > 0.
//   8b. a SOLO_SHOCKS-off Property game carries the same charge every year as
//      one with SOLO_SHOCKS on and a scheduled room.
// Controls now include LARGE_CLAIMS_EVERY_GAME.enabled = false at runtime,
// which must fail 2, 4a (the game replayed), 6, 8a and 8b (replayed). The
// controls that encoded the retired rule as the BREAK ("every option offered
// with the shocks off", "catastrophe capital that ignores the switch", "a solo
// game still charged for a catastrophe") are now the new rule, so they are
// turned round: None alone with the shocks off, capital zeroed with the shocks
// off, a solo SOLO_SHOCKS-off game whose charge dropped — each must fail.
//
// ⚠ RESTATED FOR EVENTS_KEEPING_LARGE_CLAIMS (Nuclear Verdict keeps its own
// GL High claim, on top of the frequency draw, in the shocks-ON expectation
// only): 2.'s shocks-off shockLarge now equals shocks-on's LESS NV's share on
// GL — p(NV) (the R model's 2.5% x SHOCK_CATALOGUE_SCALE) x the GL High
// range's midpoint ($23.5M) x 1.08^(y - 1), written out — and equals it
// exactly on WC and Property. New controls: EVENTS_KEEPING_LARGE_CLAIMS emptied
// at runtime, and Pandemic added to it, each fail 2.
// ============================================================================
import { ordinaryLossFromMembers } from '../../src/utils/ordinaryLoss';
import { marketSeedOf } from '../../src/utils/bookUnits';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, strikeRates } from '../../src/utils/worlds';
import { expectedLossBreakdown, newEngineCatCapital } from '../../src/utils/shockExpectation';
import { sampledYearTotals, stopQuotes, stopRecovery } from '../../src/utils/aggregateStop';
import { LARGE_CLAIM_ID, gameShocksOn, largeClaimArrivals } from '../../src/utils/shockLosses';
import { drawShockSchedule } from '../../src/utils/shockSchedule';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { seedFromInstanceId } from '../../src/seedHash';
import {
  AGGREGATE_STOP_OPTIONS, AGGREGATE_STOP_SD_LOAD, EVENTS_KEEPING_LARGE_CLAIMS, LARGE_CLAIMS_EVERY_GAME, SHOCK_CATALOGUE_SCALE, REINSURANCE_OPTIONS, SHOCK_COST_TREND, SHOCK_T_CLAIM_RANGE, SOLO_SHOCKS,
} from '../../src/data/pricingParameters';
import { shockCostFactor } from '../../src/utils/shockCost';
import { defaultReinsuranceOption, optionPrice, placementFor, reinsuranceOptionIds } from '../../src/utils/reinsuranceOptions';
import type { GameInstance, GameSetupSettings, GameState } from '../../src/types/simulation';

const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const near = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

// THE COVER PRICE BY THE PRICING WORKBOOK'S METHOD (wip/reinsurance-layers),
// re-derived here from the written-out rule, not read from reinsuranceOptions:
// mean claim per level = the midpoint of the line's T range x g; a layer's
// expected cost = sum of frequency x min(max(mean - attachment, 0), limit);
// the 30M-top layers 1.25 x the 20M-top layer from the same attachment, the
// 40M-top layers 1.2 x the UNMULTIPLIED 30M-top layer.
const METHOD_FREQ = { Low: 0.075, Mid: 0.0525, High: 0.0225 } as const;
const methodLayerCost = (line: 'WC' | 'GL' | 'Property', att: number, lim: number, g: number) =>
  (['Low', 'Mid', 'High'] as const).reduce((sum, lv) => {
    const [lo, hi] = SHOCK_T_CLAIM_RANGE[line][lv];
    return sum + METHOD_FREQ[lv] * Math.min(Math.max(g * (lo + hi) / 2 - att, 0), lim);
  }, 0);
function methodPrice(line: 'WC' | 'GL' | 'Property', optionId: string, g: number): number {
  if (optionId === 'none') return 0;
  const o = REINSURANCE_OPTIONS[line].find(x => x.id === optionId);
  if (!o) throw new Error(`methodPrice: no ${line} option ${optionId}`);
  const top = o.attachment + o.limit;
  if (top === 30e6) return 1.25 * methodLayerCost(line, o.attachment, 20e6 - o.attachment, g);
  if (top === 40e6) return 1.2 * methodLayerCost(line, o.attachment, 30e6 - o.attachment, g);
  return methodLayerCost(line, o.attachment, o.limit, g);
}

// ---------------------------------------------------------------- 1
console.log('THE EXPECTATION FOLLOWS THE GAME\'S SHOCKS');
const solo = openSoloInstance({ poolName: 'X', gameLength: 5, startingYear: 2026, instanceId: '5', activeLines: ['WC'] } as GameSetupSettings);
const schedule = drawShockSchedule('7', 5, 'expectation-switch-check');
const hostedWith = { setup: { ...solo.setup, shockTiming: 'host' as const }, instance: generateGameInstance('7', seedFromInstanceId('7'), schedule) };
const hostedWithout = { setup: { ...solo.setup, shockTiming: 'host' as const }, instance: generateGameInstance('7', seedFromInstanceId('7'), []) };
const bare = { setup: { ...solo.setup, shockTiming: undefined }, instance: solo.instance };
// ⚠ THE SHOCKS LANDING: SOLO_SHOCKS is on, so the solo games here draw at the
// catalogue's odds. Scenario 7 draws no event over five years — the "whatever
// its draw" case — and scenario 5 draws one (restated for the fixed-seed
// scenarios: on the old mapping '7' drew one and '9' none; each scenario now
// draws on its fixed seed). A SOLO_SHOCKS-off game is opened (and, below,
// played) with the switch flipped off at runtime and restored.
const withSoloShocks = <T>(on: boolean, run: () => T): T => {
  const was = SOLO_SHOCKS.enabled;
  SOLO_SHOCKS.enabled = on;
  try { return run(); } finally { SOLO_SHOCKS.enabled = was; }
};
const soloQuiet = openSoloInstance({ ...solo.setup, instanceId: '7' } as GameSetupSettings);
const soloOff = withSoloShocks(false, () => openSoloInstance({ ...solo.setup, instanceId: '7' } as GameSetupSettings));
function gradeSwitch(f: typeof gameShocksOn, tag: string) {
  const got = [
    f(solo.setup, solo.instance), f(soloQuiet.setup, soloQuiet.instance),
    withSoloShocks(false, () => f(soloOff.setup, soloOff.instance)),
    f(hostedWith.setup, hostedWith.instance), f(hostedWithout.setup, hostedWithout.instance), f(bare.setup, bare.instance),
  ];
  const drew = `${solo.instance.scheduledShocks?.length ?? 0}/${soloQuiet.instance.scheduledShocks?.length ?? 0} events`;
  check(JSON.stringify(got) === JSON.stringify([true, true, false, true, false, true]) && drew === '1/0 events',
    `${tag}1. the switch: solo on whatever its draw (SOLO_SHOCKS on), solo off with SOLO_SHOCKS off, a room with a schedule on, a room without one off, a bare instance on`,
    `${got.join(' ')}; solo draws ${drew}`);
}
gradeSwitch(gameShocksOn, '');

// ---------------------------------------------------------------- 2
// Nuclear Verdict's own GL claim (EVENTS_KEEPING_LARGE_CLAIMS), written out: shocks on only.
const nvShare = (line: 'WC' | 'GL' | 'Property', y: number) =>
  (line === 'GL' ? 0.025 * SHOCK_CATALOGUE_SCALE * ((7e6 + 40e6) / 2) * Math.pow(1.08, y - 1) : 0);
function gradeExpectation(br: typeof expectedLossBreakdown, tag: string) {
  let ok = true; let worst = '';
  for (const line of ['WC', 'GL', 'Property'] as const) for (const y of [1, 3, 6]) {
    const off = br(line, 900, y, undefined, 0.95, false), on = br(line, 900, y, undefined, 0.95, true);
    // LARGE_CLAIMS_EVERY_GAME: no uplift off, but the large claims' expectation
    // stays — all but NV's own GL claim, which is shocks-on only.
    const good = off.uplift === 0 && off.shockLarge > 0 && near(off.shockLarge + nvShare(line, y), on.shockLarge)
      && near(off.total, off.ordinary + off.routineLarge + off.shockLarge)
      && near(off.ordinary, on.ordinary) && on.total > off.total;
    if (!good) { ok = false; worst = `${line} y${y}: off ${off.total.toFixed(0)} on ${on.total.toFixed(0)}`; }
  }
  check(ok, `${tag}2. shocks off, the expectation is ordinary + routine large + shockLarge (shocks-on's, less NV's GL claim), no uplift; on, it carries the uplift above it`, worst);
}
gradeExpectation(expectedLossBreakdown, '');

// ---------------------------------------------------------------- 3
function gradeCover(quotes: typeof stopQuotes, tag: string) {
  let ok = true; let detail = '';
  for (const line of ['WC', 'GL', 'Property'] as const) {
    const ordinary = expectedLossBreakdown(line, 900, 2, undefined, 1, false).total;
    const totals = sampledYearTotals(line, 900, 2, 1, false);
    for (const q of quotes(line, 900, 2, 1, false)) {
      const o = AGGREGATE_STOP_OPTIONS.find(x => x.id === q.optionId)!;
      let m1 = 0, m2 = 0;
      if (q.limit > 0) for (const t of totals) { const r = stopRecovery(t, q); m1 += r; m2 += r * r; }
      const mean = m1 / totals.length, sd = Math.sqrt(Math.max(0, m2 / totals.length - mean * mean));
      const good = near(q.attachment, o.attachment * ordinary) && near(q.limit, o.limit * ordinary)
        && near(q.premium, mean + AGGREGATE_STOP_SD_LOAD * sd, 1e-9);
      if (!good) { ok = false; detail = `${line} ${q.optionId}: attachment ${q.attachment.toFixed(0)} vs ${(o.attachment * ordinary).toFixed(0)}, price ${q.premium.toFixed(0)}`; }
    }
  }
  check(ok, `${tag}3. shocks off, each cover attaches at its share of the shocks-off expectation (ordinary, with the large claims under LARGE_CLAIMS_EVERY_GAME) and is priced on it`, detail);
}
gradeCover(stopQuotes, '');

// ---------------------------------------------------------------- games
// ⚠ AT THE DEFAULTS, WHICH ADD NO NEW MEMBERS (simple underwriting): the
// first-year penalty is not in expected loss, so a book that grew would sit
// about newShare x 20% above Expected for a reason that is not the shock switch.
const decide = (y: number) => defaultDecisionSet(y);
// ⚠ THE SHOCKS LANDING: `cover` is the WC option held each year (the default,
// None, unless a T cover is named), and `quoted` is the price the switch-on
// game owes for it — RESTATED (wip/reinsurance-layers): its price by the
// method (methodPrice above) at shockCostFactor (trend from year 1 x the quoted
// book against year 1's); `src` is optionPrice at the same factor, which must
// agree. The stop's shocks-off quote it was compared with is dormant.
function play(setup: GameSetupSettings, instance: GameInstance, years: number, cover?: string) {
  const dec = (y: number) => { const d = decide(y); if (cover) d.byLine.WC.reinsuranceOption = cover; return d; };
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: dec(1), priorHistory, earlyPreGameHistory } as GameState);
  const struckPrice: number[] = [], quoted: number[] = [], src: number[] = [], factors: number[] = [];
  for (let y = 1; y <= years; y++) {
    const s = strikeRates(gs, dec(y)).WC!;
    struckPrice.push(s.quote.reinsuranceCost);
    const base = gs.poolState.lines.WC.shockCostBaseExposure;
    const g = shockCostFactor('WC', y, s.exposure, base ?? s.exposure);
    factors.push(g);
    quoted.push(methodPrice('WC', dec(y).byLine.WC.reinsuranceOption, g));
    src.push(optionPrice('WC', dec(y).byLine.WC.reinsuranceOption, g));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, dec(y)), ['WC'])), currentYearNumber: y + 1 };
  }
  return { rows: gs.lockedResults.map(r => r.byLine.WC!), struckPrice, quoted, src, factors };
}

// ---------------------------------------------------------------- 4
const T_COVER = '$38M xs $2M';
const soloOffGame = withSoloShocks(false, () => play(soloOff.setup, soloOff.instance, 4));
const soloGame = play(solo.setup, solo.instance, 4, T_COVER);
function gradeSolo(offRows: typeof soloGame.rows, onRows: typeof soloGame.rows, struck: number[], quoted: number[], tag: string, srcPrice: number[] = soloGame.src.slice(0, quoted.length)) {
  // ⚠ LARGE_CLAIMS_EVERY_GAME: the SOLO_SHOCKS-off game draws its seed's large
  // claims (shared by every world), so its 'T' records must be exactly where
  // largeClaimArrivals drew on WC, fired in every world; its Expected Losses is
  // the shocks-off expectation, shockLarge in; and the bar below is held on
  // what the worlds average — Simulated less the drawn large claims against
  // Expected less its shockLarge.
  const tProblems: string[] = [];
  const largeOf = (r: typeof offRows[number]) => (r.shockEvents ?? []).filter(e => e.shockId === LARGE_CLAIM_ID);
  for (const r of offRows) {
    const drew = largeClaimArrivals(soloOff.instance, r.yearNumber).some(a => a.line === 'WC');
    const recs = largeOf(r);
    if (drew !== (recs.length === 1)) tProblems.push(`year ${r.yearNumber}: ${recs.length} 'T' record(s), drew ${drew}`);
    if (recs.some(e => e.worlds && e.worlds.fired !== e.worlds.of)) tProblems.push(`year ${r.yearNumber}: 'T' not in every world`);
    if ((r.shockEvents ?? []).some(e => e.shockId !== LARGE_CLAIM_ID)) tProblems.push(`year ${r.yearNumber}: a catalogue event fired`);
    const b = expectedLossBreakdown('WC', r.activeExposure, r.yearNumber, undefined, 1, false);
    if (!(b.shockLarge > 0) || !near(r.expectedLoss, b.total, 1e-4)) tProblems.push(`year ${r.yearNumber}: Expected ${r.expectedLoss.toFixed(0)}, the shocks-off expectation ${b.total.toFixed(0)}`);
  }
  if (!offRows.some(r => largeOf(r).length)) tProblems.push('no large claim in the SOLO_SHOCKS-off game — the large-claim adjustment is untested');
  // ⚠ WITH THE GAME'S MEMBER RISK DIVIDED OUT (simple underwriting). Each
  // member's yearly risk score is the GAME's (MEMBER_RISK_CV, off its seed), so
  // averaging the worlds removes the year factor and the luck but not the
  // risk: a year's Simulated sits at Expected x the members' mean score (about
  // 3% either way). The 1% is the switch's, on what is left.
  const riskOf = (y: number) => {
    const r = ordinaryLossFromMembers('WC', 1, y, 1, 1, false, marketSeedOf(soloOff.instance)).risk;
    return r.reduce((a, b) => a + b, 0) / r.length;
  };
  const gaps = offRows.map(r => {
    const drawn = largeOf(r).reduce((s, e) => s + (e.attributableGrossLoss ?? 0), 0);
    const shockLarge = expectedLossBreakdown('WC', r.activeExposure, r.yearNumber, undefined, 1, false).shockLarge;
    return ((r.aggregateMemberLoss ?? r.grossUltimateLoss) - drawn) / ((r.expectedLoss - shockLarge) * riskOf(r.yearNumber)) - 1;
  });
  // ⚠ RESTATED FOR THE FIXED-SEED SCENARIOS: what is left is the worlds'
  // sampling noise — measured over 160 game-years (the twenty scenarios and
  // twenty bare games, four years each), mean +0.03%, SD 0.63%, 14% of single
  // years beyond 1%. The old 1% on every one of four years passed on this
  // fixture's luck (scenario 7's old seed) and failed on its fixed seed
  // (-1.55%, +0.46%, -0.29%, -1.50%). The bar is now 3 SD: each year within
  // 2%, and the four years' mean within 1%.
  const mean = gaps.reduce((a, g) => a + g, 0) / gaps.length;
  check(tProblems.length === 0 && gaps.every(g => Math.abs(g) < 0.02) && Math.abs(mean) < 0.01,
    `${tag}4a. a solo game with SOLO_SHOCKS off: Expected Losses is the shocks-off expectation (shockLarge in), 'T' records exactly where the large claims drew; less the large claims, each year's Expected (x the game's member risk) within 2% of Simulated, their mean within 1%`,
    gaps.map(g => `${(100 * g).toFixed(2)}%`).join(' ') + `; mean ${(100 * mean).toFixed(2)}%; T in years ${offRows.filter(r => largeOf(r).length).map(r => r.yearNumber).join(',') || 'none'}`
    + (tProblems.length ? `; ${tProblems.slice(0, 3).join('; ')}` : ''));
  const over = onRows.map(r => r.expectedLoss / expectedLossBreakdown('WC', r.activeExposure, r.yearNumber, undefined, 1, false).total);
  // Year 2 on, the cover's price must have grown (the trend), so a price that stood still shows.
  // The method's anchor: WC 9 xs 1 at factor 1 is 75,000 + 183,750 + 202,500 = $461,250.
  const anchor = methodPrice('WC', '$9M xs $1M', 1);
  const srcAgrees = srcPrice.every((p, i) => near(p, quoted[i], 1e-9));
  check(over.every(x => x > 1.01) && struck.every((p, i) => p > 0 && near(p, quoted[i], 1e-9)) && struck[1] > struck[0]
    && srcAgrees && near(anchor, 461_250, 1e-12),
    `${tag}4b. a solo game with SOLO_SHOCKS on: Expected Losses keeps the shocks, and its T cover is charged its price by the method at the year's shock cost factor`,
    `expected over ordinary-only ${over.map(x => x.toFixed(3)).join(' ')}; ${T_COVER} charged vs method ${struck.map((p, i) => `${(p / 1e6).toFixed(3)} vs ${(quoted[i] / 1e6).toFixed(3)}`).join(', ')}; optionPrice agrees ${srcAgrees}; WC 9 xs 1 at g=1 $${anchor.toFixed(0)}`);
}
gradeSolo(soloOffGame.rows, soloGame.rows, soloGame.struckPrice, soloGame.quoted, '');

// ---------------------------------------------------------------- 5
const hostedGame = play(hostedWith.setup, hostedWith.instance, 4);
function gradeHosted(rows: typeof hostedGame.rows, tag: string) {
  const over = rows.map(r => r.expectedLoss / expectedLossBreakdown('WC', r.activeExposure, r.yearNumber, undefined, 1, false).total);
  check(over.every(x => x > 1.01), `${tag}5. a hosted game with a schedule keeps the shocks in its expectation (above the ordinary-only)`,
    over.map(x => x.toFixed(3)).join(' '));
}
gradeHosted(hostedGame.rows, '');

// ---------------------------------------------------------------- 6
function gradeOffer(ids: typeof reinsuranceOptionIds, dflt: (shocks: boolean) => string, tag: string) {
  const off = (['WC', 'GL', 'Property'] as const).map(l => ids(l, false).join(','));
  const on = (['WC', 'GL', 'Property'] as const).map(l => ids(l, true).join(','));
  const decOff = defaultDecisionSet(1, false), decOn = defaultDecisionSet(1, true);
  // The brief's T covers, written out (not read from REINSURANCE_OPTIONS).
  // LARGE_CLAIMS_EVERY_GAME: the same nine with the shocks off.
  const NINE = 'none,$9M xs $1M,$19M xs $1M,$29M xs $1M,$39M xs $1M,$8M xs $2M,$18M xs $2M,$28M xs $2M,$38M xs $2M';
  const ok = off.every(x => x === NINE) && on.every(x => x === NINE)
    && dflt(false) === 'none' && dflt(true) === 'none'
    && (['WC', 'GL', 'Property'] as const).every(l => decOff.byLine[l].reinsuranceOption === dflt(false) && decOn.byLine[l].reinsuranceOption === dflt(true));
  check(ok, `${tag}6. shocks on or off: None and the eight T covers offered; None the default either way`,
    `off ${off[0]} / ${dflt(false)}; on ${on[0]} / ${dflt(true)}`);
}
gradeOffer(reinsuranceOptionIds, sh => defaultReinsuranceOption('WC', sh), '');

// ---------------------------------------------------------------- 7
const preGameCovers = (setup: GameSetupSettings, instance: GameInstance) => {
  const { priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  return [...new Set([...(earlyPreGameHistory ?? []), ...priorHistory].map(r => r.byLine.WC!.decisions.reinsuranceOption))];
};
const soloBoard = [...new Set([...preGameCovers(solo.setup, solo.instance),
  ...withSoloShocks(false, () => preGameCovers(soloOff.setup, soloOff.instance))])];
const roomBoard = preGameCovers(hostedWith.setup, hostedWith.instance);
function gradeBoard(soloCovers: string[], roomCovers: string[], tag: string) {
  check(soloCovers.join() === 'none' && roomCovers.join() === 'none',
    `${tag}7. the prior board holds the default: None in a solo game (shocks on or off) and in a scheduled room`,
    `solo ${soloCovers.join('/')}; room ${roomCovers.join('/')}`);
}
gradeBoard(soloBoard, roomBoard, '');

// ---------------------------------------------------------------- 8
type CatFn = typeof newEngineCatCapital;
function playCapital(setup: GameSetupSettings, instance: GameInstance) {
  const s = { ...setup, activeLines: ['Property' as const] };
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, s);
  const shocks = gameShocksOn(s, instance);
  let gs = openWorlds({ setup: s, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1, shocks), priorHistory, earlyPreGameHistory } as GameState);
  for (let y = 1; y <= 3; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y, shocks)), [])), currentYearNumber: y + 1 };
  }
  return gs.lockedResults.map(r => r.byLine.Property!);
}
const soloCap = withSoloShocks(false, () => playCapital(soloOff.setup, soloOff.instance));
const soloOnCap = playCapital(solo.setup, solo.instance), roomCap = playCapital(hostedWith.setup, hostedWith.instance);
type CapRow = { catCapitalNeeded?: number };
function gradeCapital(cat: CatFn, soloRows: { catCapitalNeeded?: number; reserveRiskMarginNeeded: number }[],
  roomRows: CapRow[], tag: string, soloOnRows: CapRow[] = soloOnCap) {
  const exposure = 10_000;
  // Under every cover a Property team can hold since the shocks landing: the T covers' placements.
  // LARGE_CLAIMS_EVERY_GAME: with the shocks off, the same large-claim capital as on, cover by cover.
  const ids = reinsuranceOptionIds('Property', true);
  const off = ids.map(id => cat('Property', exposure, 1, placementFor('Property', id), id, false));
  const onBy = ids.map(id => cat('Property', exposure, 1, placementFor('Property', id), id, true));
  const on = cat('Property', exposure, 1, null, 'none', true);
  check(off.every((x, i) => x > 0 && near(x, onBy[i])) && on > 0,
    `${tag}8a. Property's catastrophe capital: with the shocks off the same as with them on, under every cover, and > 0`,
    `off ${off.map(x => x.toFixed(0)).join(' / ')}; on ${onBy.map(x => x.toFixed(0)).join(' / ')}; on, no cover, $${(on / 1e6).toFixed(2)}M`);
  check(soloRows.every((r, i) => (r.catCapitalNeeded ?? 0) > 0 && near(r.catCapitalNeeded ?? 0, soloOnRows[i]?.catCapitalNeeded ?? NaN) && r.reserveRiskMarginNeeded > 0)
    && soloRows.length === soloOnRows.length
    && soloOnRows.every(r => (r.catCapitalNeeded ?? 0) > 0) && roomRows.every(r => (r.catCapitalNeeded ?? 0) > 0),
    `${tag}8b. through the engine: a solo Property game with SOLO_SHOCKS off carries the same large-claim charge as one with SOLO_SHOCKS on; it, and a scheduled room, carry one every year`,
    `solo off ${soloRows.map(r => r.catCapitalNeeded?.toFixed(0)).join(' / ')}; solo on $${soloOnRows.map(r => ((r.catCapitalNeeded ?? 0) / 1e6).toFixed(2)).join(' / ')}M; room $${roomRows.map(r => ((r.catCapitalNeeded ?? 0) / 1e6).toFixed(2)).join(' / ')}M`);
}
gradeCapital(newEngineCatCapital, soloCap, roomCap, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('a switch that ignores the schedule (every game on)', () => gradeSwitch(() => true, ''), '1.');
// The retired rule: a solo game read off its draw — off when it drew no event.
controlFails('a solo game switched by its draw (the retired rule)',
  () => gradeSwitch((s, i) => s.shockTiming === undefined || (i.scheduledShocks?.length ?? 0) > 0, ''), '1.');
controlFails('a solo game on whatever SOLO_SHOCKS says',
  () => gradeSwitch((s, i) => s.shockTiming === 'solo' || gameShocksOn(s, i), ''), '1.');
controlFails('an expectation that keeps the shocks with the switch off',
  () => gradeExpectation((l, e, y, r, b) => expectedLossBreakdown(l, e, y, r, b, true), ''), '2.');
controlFails('a cover priced with the shocks while the switch is off',
  () => gradeCover((l, e, y, b) => stopQuotes(l, e, y, b, true), ''), '3.');
controlFails('a SOLO_SHOCKS-off game reading the shock-inclusive expectation',
  () => gradeSolo(soloOffGame.rows.map(r => ({ ...r, expectedLoss: expectedLossBreakdown('WC', r.activeExposure, r.yearNumber, undefined, 1, true).total })), soloGame.rows, soloGame.struckPrice, soloGame.quoted, ''), '4a.');
controlFails('LARGE_CLAIMS_EVERY_GAME switched off (the expectation)', () => {
  LARGE_CLAIMS_EVERY_GAME.enabled = false;
  try { gradeExpectation(expectedLossBreakdown, ''); } finally { LARGE_CLAIMS_EVERY_GAME.enabled = true; }
}, '2.');
{
  const kept = EVENTS_KEEPING_LARGE_CLAIMS as string[];
  const withKept = (list: string[], run: () => void) => {
    const was = [...kept]; kept.splice(0, kept.length, ...list);
    try { run(); } finally { kept.splice(0, kept.length, ...was); }
  };
  controlFails('EVENTS_KEEPING_LARGE_CLAIMS emptied (NV\'s claim dropped)', () => withKept([], () => gradeExpectation(expectedLossBreakdown, '')), '2.');
  controlFails('Pandemic added to EVENTS_KEEPING_LARGE_CLAIMS', () => withKept(['Nuclear Verdict', 'Pandemic'], () => gradeExpectation(expectedLossBreakdown, '')), '2.');
}
controlFails('LARGE_CLAIMS_EVERY_GAME switched off (the SOLO_SHOCKS-off game replayed)', () => {
  LARGE_CLAIMS_EVERY_GAME.enabled = false;
  let g: ReturnType<typeof play>;
  try { g = withSoloShocks(false, () => play(soloOff.setup, soloOff.instance, 4)); } finally { LARGE_CLAIMS_EVERY_GAME.enabled = true; }
  gradeSolo(g.rows, soloGame.rows, soloGame.struckPrice, soloGame.quoted, '');
}, '4a.');
controlFails('a SOLO_SHOCKS-off game whose large claims went unrecorded',
  () => gradeSolo(soloOffGame.rows.map(r => ({ ...r, shockEvents: [] })), soloGame.rows, soloGame.struckPrice, soloGame.quoted, ''), '4a.');
controlFails('a SOLO_SHOCKS-on game whose expectation dropped its shocks',
  () => gradeSolo(soloOffGame.rows, soloGame.rows.map(r => ({ ...r, expectedLoss: expectedLossBreakdown('WC', r.activeExposure, r.yearNumber, undefined, 1, false).total })), soloGame.struckPrice, soloGame.quoted, ''), '4b.');
controlFails('a T cover charged off its price',
  () => gradeSolo(soloOffGame.rows, soloGame.rows, soloGame.struckPrice.map((p, i) => p + 1e5 * (i + 1)), soloGame.quoted, ''), '4b.');
// Through the engine: the cover's trend zeroed at runtime, the solo game replayed.
// The retired wip/shocks fixed table (WC 38 xs 2 $590K) grown by the factor — the old rule.
controlFails('a T cover charged the retired fixed-table price x the factor',
  () => gradeSolo(soloOffGame.rows, soloGame.rows, soloGame.factors.map(g => 590_000 * g), soloGame.quoted, ''), '4b.');
// optionPrice drifted off the method (the 40M multiplier on the multiplied 30M layer).
controlFails('optionPrice off the method (40M layer on the 1.25x-multiplied 30M)',
  () => gradeSolo(soloOffGame.rows, soloGame.rows, soloGame.struckPrice, soloGame.quoted, '', soloGame.src.map(p => p * 1.25)), '4b.');
controlFails('a T cover whose price does not grow (the trend zeroed in the engine)', () => {
  const t = SHOCK_COST_TREND as Record<string, number>; const was = t.WC; t.WC = 0;
  let g: ReturnType<typeof play>;
  try { g = play(solo.setup, solo.instance, 2, T_COVER); } finally { t.WC = was; }
  gradeSolo(soloOffGame.rows, soloGame.rows, g.struckPrice, soloGame.quoted.slice(0, 2), '');
}, '4b.');
controlFails('a hosted game whose expectation dropped its shocks',
  () => gradeHosted(hostedGame.rows.map(r => ({ ...r, expectedLoss: expectedLossBreakdown('WC', r.activeExposure, r.yearNumber, undefined, 1, false).total })), ''), '5.');

// Turned round for LARGE_CLAIMS_EVERY_GAME: every option offered with the shocks off is now the rule.
controlFails('None alone with the shocks off (the retired offer)', () => gradeOffer((l, sh) => (sh ? reinsuranceOptionIds(l, true) : ['none']), sh => defaultReinsuranceOption('WC', sh), ''), '6.');
controlFails('LARGE_CLAIMS_EVERY_GAME switched off (the offer)', () => {
  LARGE_CLAIMS_EVERY_GAME.enabled = false;
  try { gradeOffer(reinsuranceOptionIds, sh => defaultReinsuranceOption('WC', sh), ''); } finally { LARGE_CLAIMS_EVERY_GAME.enabled = true; }
}, '6.');
controlFails('the wip/shocks four-cover menu offered with the shocks on',
  () => gradeOffer((_l, sh) => (sh ? ['none', '$9M xs $1M', '$8M xs $2M', '$18M xs $2M', '$38M xs $2M'] : ['none']), sh => defaultReinsuranceOption('WC', sh), ''), '6.');
controlFails('a T cover default with the shocks on', () => gradeOffer(reinsuranceOptionIds, sh => (sh ? '$18M xs $2M' : 'none'), ''), '6.');
controlFails('the retired stop\'s offer (the Working cover with the shocks off)', () => gradeOffer((l, sh) => (sh ? reinsuranceOptionIds(l, true) : ['none', 'working']), sh => defaultReinsuranceOption('WC', sh), ''), '6.');
controlFails('a solo prior board on a T cover', () => gradeBoard(['$8M xs $2M'], roomBoard, ''), '7.');
controlFails('a scheduled room\'s prior board on a T cover', () => gradeBoard(soloBoard, ['none', '$38M xs $2M'], ''), '7.');
// Turned round for LARGE_CLAIMS_EVERY_GAME: the capital ignoring the switch is now the rule.
controlFails('catastrophe capital zeroed with the shocks off (the retired rule)',
  () => gradeCapital((l, e, y, p, o, sh) => (sh ? newEngineCatCapital(l, e, y, p, o, true) : 0), soloCap, roomCap, ''), '8a.');
controlFails('LARGE_CLAIMS_EVERY_GAME switched off (the capital)', () => {
  LARGE_CLAIMS_EVERY_GAME.enabled = false;
  try { gradeCapital(newEngineCatCapital, soloCap, roomCap, ''); } finally { LARGE_CLAIMS_EVERY_GAME.enabled = true; }
}, '8a.');
controlFails('a SOLO_SHOCKS-off game whose charge dropped (the retired rule)',
  () => gradeCapital(newEngineCatCapital, soloCap.map(r => ({ ...r, catCapitalNeeded: 0 })), roomCap, ''), '8b.');
controlFails('LARGE_CLAIMS_EVERY_GAME switched off (the SOLO_SHOCKS-off Property game replayed)', () => {
  LARGE_CLAIMS_EVERY_GAME.enabled = false;
  let rows: ReturnType<typeof playCapital>;
  try { rows = withSoloShocks(false, () => playCapital(soloOff.setup, soloOff.instance)); } finally { LARGE_CLAIMS_EVERY_GAME.enabled = true; }
  gradeCapital(newEngineCatCapital, rows, roomCap, '');
}, '8b.');
controlFails('a scheduled room whose charge dropped',
  () => gradeCapital(newEngineCatCapital, soloCap, roomCap.map(r => ({ ...r, catCapitalNeeded: 0 })), ''), '8b.');
controlFails('a SOLO_SHOCKS-on game whose charge dropped (the retired solo-off design)',
  () => gradeCapital(newEngineCatCapital, soloCap, roomCap, '', soloOnCap.map(r => ({ ...r, catCapitalNeeded: 0 }))), '8b.');

console.log(failures.length === 0 ? '\nTHE EXPECTATION FOLLOWS THE SHOCK SWITCH: ALL CHECKS PASS.' : `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
