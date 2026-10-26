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
//      ordinary expectation, and its price is E + load over the ordinary year
//      alone; on, over the year with its shocks. ⚠ SINCE THE SHOCKS LANDING
//      THE AGGREGATE STOP IS DORMANT (AGGREGATE_STOP.enabled false — the T
//      covers are offered instead); 3 holds its still-built code to the switch.
//   4. A SOLO GAME. ⚠ RESTATED FOR THE SHOCKS LANDING: with SOLO_SHOCKS off
//      (switched off at runtime here) each year's Expected Losses (averaged)
//      is within 1% of its Simulated Losses, as it was — once the game's
//      member risk is divided out (simple underwriting: the risk scores are
//      the game's, so the worlds' average keeps them). With SOLO_SHOCKS on
//      (shipped) the game's shocks are on, so its Expected Losses keeps them
//      (above the ordinary-only, as 5) — Simulated no longer averages them,
//      every world sharing the game seed's events — and a T cover it holds is
//      charged the table price grown by shockCost.shockCostFactor. (It was:
//      solo Expected within 1% of Simulated, the struck cover the shocks-off
//      aggregate-stop quote.)
//   5. A HOSTED GAME WITH A SCHEDULE keeps the shocks in its expectation.
//   6. THE OFFER. ⚠ RESTATED FOR THE SHOCKS LANDING (per-occurrence T covers):
//      shocks off, only None is offered; on, None and the four T covers; the
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
// ============================================================================
import { ordinaryLossFromMembers } from '../../src/utils/ordinaryLoss';
import { marketSeedOf } from '../../src/utils/bookUnits';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, strikeRates } from '../../src/utils/worlds';
import { expectedLossBreakdown, newEngineCatCapital } from '../../src/utils/shockExpectation';
import { sampledYearTotals, stopQuotes, stopRecovery } from '../../src/utils/aggregateStop';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { drawShockSchedule } from '../../src/utils/shockSchedule';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { seedFromInstanceId } from '../../src/seedHash';
import { AGGREGATE_STOP_OPTIONS, AGGREGATE_STOP_SD_LOAD, SHOCK_COST_TREND, SOLO_SHOCKS } from '../../src/data/pricingParameters';
import { shockCostFactor } from '../../src/utils/shockCost';
import { defaultReinsuranceOption, optionPrice, placementFor, reinsuranceOptionIds } from '../../src/utils/reinsuranceOptions';
import type { GameInstance, GameSetupSettings, GameState } from '../../src/types/simulation';

const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const near = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

// ---------------------------------------------------------------- 1
console.log('THE EXPECTATION FOLLOWS THE GAME\'S SHOCKS');
const solo = openSoloInstance({ poolName: 'X', gameLength: 5, startingYear: 2026, instanceId: '7', activeLines: ['WC'] } as GameSetupSettings);
const schedule = drawShockSchedule('7', 5, 'expectation-switch-check');
const hostedWith = { setup: { ...solo.setup, shockTiming: 'host' as const }, instance: generateGameInstance('7', seedFromInstanceId('7'), schedule) };
const hostedWithout = { setup: { ...solo.setup, shockTiming: 'host' as const }, instance: generateGameInstance('7', seedFromInstanceId('7'), []) };
const bare = { setup: { ...solo.setup, shockTiming: undefined }, instance: solo.instance };
// ⚠ THE SHOCKS LANDING: SOLO_SHOCKS is on, so the solo games here draw at the
// catalogue's odds. Instance '9' draws no event over five years — the "whatever
// its draw" case — and '7' draws one. A SOLO_SHOCKS-off game is opened (and,
// below, played) with the switch flipped off at runtime and restored.
const withSoloShocks = <T>(on: boolean, run: () => T): T => {
  const was = SOLO_SHOCKS.enabled;
  SOLO_SHOCKS.enabled = on;
  try { return run(); } finally { SOLO_SHOCKS.enabled = was; }
};
const soloQuiet = openSoloInstance({ ...solo.setup, instanceId: '9' } as GameSetupSettings);
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
function gradeExpectation(br: typeof expectedLossBreakdown, tag: string) {
  let ok = true; let worst = '';
  for (const line of ['WC', 'GL', 'Property'] as const) for (const y of [1, 3, 6]) {
    const off = br(line, 900, y, undefined, 0.95, false), on = br(line, 900, y, undefined, 0.95, true);
    const good = off.uplift === 0 && off.shockLarge === 0 && near(off.total, off.ordinary + off.routineLarge)
      && near(off.ordinary, on.ordinary) && on.total > off.total;
    if (!good) { ok = false; worst = `${line} y${y}: off ${off.total.toFixed(0)} on ${on.total.toFixed(0)}`; }
  }
  check(ok, `${tag}2. shocks off, the expectation is ordinary + routine large only; on, it carries the shocks above it`, worst);
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
  check(ok, `${tag}3. shocks off, each cover attaches at its share of the ordinary expectation and is priced on the ordinary year alone`, detail);
}
gradeCover(stopQuotes, '');

// ---------------------------------------------------------------- games
// ⚠ AT THE DEFAULTS, WHICH ADD NO NEW MEMBERS (simple underwriting): the
// first-year penalty is not in expected loss, so a book that grew would sit
// about newShare x 20% above Expected for a reason that is not the shock switch.
const decide = (y: number) => defaultDecisionSet(y);
// ⚠ THE SHOCKS LANDING: `cover` is the WC option held each year (the default,
// None, unless a T cover is named), and `quoted` is the price the switch-on
// game owes for it — its table price x shockCostFactor (trend from year 1 x
// the quoted book against year 1's). The stop's shocks-off quote it was
// compared with is dormant.
function play(setup: GameSetupSettings, instance: GameInstance, years: number, cover?: string) {
  const dec = (y: number) => { const d = decide(y); if (cover) d.byLine.WC.reinsuranceOption = cover; return d; };
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: dec(1), priorHistory, earlyPreGameHistory } as GameState);
  const struckPrice: number[] = [], quoted: number[] = [];
  for (let y = 1; y <= years; y++) {
    const s = strikeRates(gs, dec(y)).WC!;
    struckPrice.push(s.quote.reinsuranceCost);
    const base = gs.poolState.lines.WC.shockCostBaseExposure;
    quoted.push(optionPrice('WC', dec(y).byLine.WC.reinsuranceOption, shockCostFactor('WC', y, s.exposure, base ?? s.exposure)));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, dec(y)), ['WC'])), currentYearNumber: y + 1 };
  }
  return { rows: gs.lockedResults.map(r => r.byLine.WC!), struckPrice, quoted };
}

// ---------------------------------------------------------------- 4
const T_COVER = '$38M xs $2M';
const soloOffGame = withSoloShocks(false, () => play(soloOff.setup, soloOff.instance, 4));
const soloGame = play(solo.setup, solo.instance, 4, T_COVER);
function gradeSolo(offRows: typeof soloGame.rows, onRows: typeof soloGame.rows, struck: number[], quoted: number[], tag: string) {
  // ⚠ WITH THE GAME'S MEMBER RISK DIVIDED OUT (simple underwriting). Each
  // member's yearly risk score is the GAME's (MEMBER_RISK_CV, off its seed), so
  // averaging the worlds removes the year factor and the luck but not the
  // risk: a year's Simulated sits at Expected x the members' mean score (about
  // 3% either way). The 1% is the switch's, on what is left.
  const riskOf = (y: number) => {
    const r = ordinaryLossFromMembers('WC', 1, y, 1, 1, 1, false, marketSeedOf(soloOff.instance)).risk;
    return r.reduce((a, b) => a + b, 0) / r.length;
  };
  const gaps = offRows.map(r => (r.aggregateMemberLoss ?? r.grossUltimateLoss) / (r.expectedLoss * riskOf(r.yearNumber)) - 1);
  check(gaps.every(g => Math.abs(g) < 0.01), `${tag}4a. a solo game with SOLO_SHOCKS off: each year's Expected Losses (x the game's member risk) is within 1% of its Simulated Losses`,
    gaps.map(g => `${(100 * g).toFixed(2)}%`).join(' '));
  const over = onRows.map(r => r.expectedLoss / expectedLossBreakdown('WC', r.activeExposure, r.yearNumber, undefined, 1, false).total);
  // Year 2 on, the cover's price must have grown (the trend), so a flat table price shows.
  check(over.every(x => x > 1.01) && struck.every((p, i) => p > 0 && near(p, quoted[i], 1e-9)) && struck[1] > struck[0],
    `${tag}4b. a solo game with SOLO_SHOCKS on: Expected Losses keeps the shocks, and its T cover is charged the table price x the shock cost factor`,
    `expected over ordinary-only ${over.map(x => x.toFixed(3)).join(' ')}; ${T_COVER} ${struck.map((p, i) => `${(p / 1e6).toFixed(3)} vs ${(quoted[i] / 1e6).toFixed(3)}`).join(', ')}`);
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
  const ok = off.every(x => x === 'none') && on.every(x => x === 'none,$9M xs $1M,$8M xs $2M,$18M xs $2M,$38M xs $2M')
    && dflt(false) === 'none' && dflt(true) === 'none'
    && (['WC', 'GL', 'Property'] as const).every(l => decOff.byLine[l].reinsuranceOption === dflt(false) && decOn.byLine[l].reinsuranceOption === dflt(true));
  check(ok, `${tag}6. shocks off: only None offered; on: None and the four T covers; None the default either way`,
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
  const off = reinsuranceOptionIds('Property', true).map(id => cat('Property', exposure, 1, placementFor('Property', id), id, false));
  const on = cat('Property', exposure, 1, null, 'none', true);
  check(off.every(x => x === 0) && on > 0, `${tag}8a. Property's catastrophe capital: none with the shocks off, under every cover; it returns with them on`,
    `off ${off.map(x => x.toFixed(0)).join(' / ')}; on, no cover, $${(on / 1e6).toFixed(2)}M`);
  check(soloRows.every(r => r.catCapitalNeeded === 0 && r.reserveRiskMarginNeeded > 0)
    && soloOnRows.every(r => (r.catCapitalNeeded ?? 0) > 0) && roomRows.every(r => (r.catCapitalNeeded ?? 0) > 0),
    `${tag}8b. through the engine: a solo Property game with SOLO_SHOCKS off carries no catastrophe charge; one with SOLO_SHOCKS on, and a scheduled room, carry one every year`,
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
controlFails('a SOLO_SHOCKS-on game whose expectation dropped its shocks',
  () => gradeSolo(soloOffGame.rows, soloGame.rows.map(r => ({ ...r, expectedLoss: expectedLossBreakdown('WC', r.activeExposure, r.yearNumber, undefined, 1, false).total })), soloGame.struckPrice, soloGame.quoted, ''), '4b.');
controlFails('a T cover charged off its price',
  () => gradeSolo(soloOffGame.rows, soloGame.rows, soloGame.struckPrice.map((p, i) => p + 1e5 * (i + 1)), soloGame.quoted, ''), '4b.');
// Through the engine: the cover's trend zeroed at runtime, the solo game replayed.
controlFails('a T cover whose price does not grow (the trend zeroed in the engine)', () => {
  const t = SHOCK_COST_TREND as Record<string, number>; const was = t.WC; t.WC = 0;
  let g: ReturnType<typeof play>;
  try { g = play(solo.setup, solo.instance, 2, T_COVER); } finally { t.WC = was; }
  gradeSolo(soloOffGame.rows, soloGame.rows, g.struckPrice, soloGame.quoted.slice(0, 2), '');
}, '4b.');
controlFails('a hosted game whose expectation dropped its shocks',
  () => gradeHosted(hostedGame.rows.map(r => ({ ...r, expectedLoss: expectedLossBreakdown('WC', r.activeExposure, r.yearNumber, undefined, 1, false).total })), ''), '5.');

controlFails('every option offered with the shocks off', () => gradeOffer(l => reinsuranceOptionIds(l, true), sh => defaultReinsuranceOption('WC', sh), ''), '6.');
controlFails('a T cover default with the shocks on', () => gradeOffer(reinsuranceOptionIds, sh => (sh ? '$18M xs $2M' : 'none'), ''), '6.');
controlFails('the retired stop\'s offer (the Working cover with the shocks off)', () => gradeOffer((l, sh) => (sh ? reinsuranceOptionIds(l, true) : ['none', 'working']), sh => defaultReinsuranceOption('WC', sh), ''), '6.');
controlFails('a solo prior board on a T cover', () => gradeBoard(['$8M xs $2M'], roomBoard, ''), '7.');
controlFails('a scheduled room\'s prior board on a T cover', () => gradeBoard(soloBoard, ['none', '$38M xs $2M'], ''), '7.');
controlFails('catastrophe capital that ignores the switch',
  () => gradeCapital((l, e, y, p, o) => newEngineCatCapital(l, e, y, p, o, true), soloCap, roomCap, ''), '8a.');
controlFails('a solo game still charged for a catastrophe',
  () => gradeCapital(newEngineCatCapital, soloCap.map((r, i) => ({ ...r, catCapitalNeeded: roomCap[i].catCapitalNeeded })), roomCap, ''), '8b.');
controlFails('a scheduled room whose charge dropped',
  () => gradeCapital(newEngineCatCapital, soloCap, roomCap.map(r => ({ ...r, catCapitalNeeded: 0 })), ''), '8b.');
controlFails('a SOLO_SHOCKS-on game whose charge dropped (the retired solo-off design)',
  () => gradeCapital(newEngineCatCapital, soloCap, roomCap, '', soloOnCap.map(r => ({ ...r, catCapitalNeeded: 0 }))), '8b.');

console.log(failures.length === 0 ? '\nTHE EXPECTATION FOLLOWS THE SHOCK SWITCH: ALL CHECKS PASS.' : `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
