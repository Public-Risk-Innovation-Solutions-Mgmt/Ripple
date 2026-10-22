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
//   1. THE SWITCH: solo off; a room with a schedule on, without one off; a
//      harness's bare instance on.
//   2. THE EXPECTATION OFF: no uplift, no shock large losses — ordinary plus
//      routine large losses — and on, the same as it ever was.
//   3. THE COVER OFF: every option's attachment and limit are its shares of the
//      ordinary expectation, and its price is E + load over the ordinary year
//      alone; on, over the year with its shocks.
//   4. A SOLO GAME: each year's Expected Losses (averaged) is within 1% of its
//      Simulated Losses, and the struck cover's price is the shocks-off quote.
//   5. A HOSTED GAME WITH A SCHEDULE keeps the shocks in its expectation.
//   6. THE OFFER: shocks off, only None and the Working cover are offered and
//      the default is None; on, all four and the default is the Bad-year cover.
//   7. THE PRIOR BOARD holds the default: None through a solo game's pre-game,
//      the Bad-year cover through a scheduled room's.
// Each with a control that must fail.
// ============================================================================
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, strikeRates } from '../../src/utils/worlds';
import { expectedLossBreakdown } from '../../src/utils/shockExpectation';
import { sampledYearTotals, stopQuotes, stopRecovery } from '../../src/utils/aggregateStop';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { drawShockSchedule } from '../../src/utils/shockSchedule';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { seedFromInstanceId } from '../../src/seedHash';
import { lineBookRisk } from '../../src/utils/bookUnits';
import { AGGREGATE_STOP_OPTIONS, AGGREGATE_STOP_SD_LOAD, FULL_SAVINGS_AT } from '../../src/data/pricingParameters';
import { defaultReinsuranceOption, reinsuranceOptionIds } from '../../src/utils/reinsuranceOptions';
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
function gradeSwitch(f: typeof gameShocksOn, tag: string) {
  const got = [f(solo.setup, solo.instance), f(hostedWith.setup, hostedWith.instance), f(hostedWithout.setup, hostedWithout.instance), f(bare.setup, bare.instance)];
  check(JSON.stringify(got) === JSON.stringify([false, true, false, true]),
    `${tag}1. the switch: solo off, a room with a schedule on, a room without one off, a bare instance on`, got.join(' '));
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
// ⚠ AT FULL SAVINGS ON NEW BUSINESS (rejection FULL_SAVINGS_AT): the default
// writes new business at the 20% first-year penalty, which by design is not
// in expected loss, so Simulated would sit about newShare x 20% above Expected
// for a reason that is not the shock switch. At full savings the penalty is 1.
const decide = (y: number) => {
  const d = defaultDecisionSet(y);
  d.byLine.WC.newBusinessRejection = FULL_SAVINGS_AT;
  return d;
};
function play(setup: GameSetupSettings, instance: GameInstance, years: number) {
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: decide(1), priorHistory, earlyPreGameHistory } as GameState);
  const struckPrice: number[] = [], quotedOff: number[] = [];
  for (let y = 1; y <= years; y++) {
    const s = strikeRates(gs, decide(y)).WC!;
    struckPrice.push(s.quote.reinsuranceCost);
    // The book's risk at its held shares (the underwriting ledger).
    quotedOff.push(stopQuotes('WC', s.exposure, y, lineBookRisk(gs.instance, 'WC', gs.poolState.bookUnits, gs.poolState.bookLedger), false)
      .find(q => q.optionId === decide(y).byLine.WC.reinsuranceOption)!.premium);
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, decide(y)), ['WC'])), currentYearNumber: y + 1 };
  }
  return { rows: gs.lockedResults.map(r => r.byLine.WC!), struckPrice, quotedOff };
}

// ---------------------------------------------------------------- 4
const soloGame = play(solo.setup, solo.instance, 4);
function gradeSolo(rows: typeof soloGame.rows, struck: number[], quoted: number[], tag: string) {
  const gaps = rows.map(r => (r.aggregateMemberLoss ?? r.grossUltimateLoss) / r.expectedLoss - 1);
  check(gaps.every(g => Math.abs(g) < 0.01), `${tag}4a. a solo game: each year's Expected Losses is within 1% of its Simulated Losses`,
    gaps.map(g => `${(100 * g).toFixed(2)}%`).join(' '));
  check(struck.every((p, i) => near(p, quoted[i], 1e-9)), `${tag}4b. a solo game: the struck cover's price is the shocks-off quote`,
    struck.map((p, i) => `${(p / 1e6).toFixed(3)} vs ${(quoted[i] / 1e6).toFixed(3)}`).join(', '));
}
gradeSolo(soloGame.rows, soloGame.struckPrice, soloGame.quotedOff, '');

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
  const ok = off.every(x => x === 'none,working') && on.every(x => x === 'none,working,bad-year,catastrophe')
    && dflt(false) === 'none' && dflt(true) === 'bad-year'
    && (['WC', 'GL', 'Property'] as const).every(l => decOff.byLine[l].reinsuranceOption === dflt(false) && decOn.byLine[l].reinsuranceOption === dflt(true));
  check(ok, `${tag}6. shocks off: None and the Working cover offered, None the default; on: all four, the Bad-year cover the default`,
    `off ${off[0]} / ${dflt(false)}; on ${on[0]} / ${dflt(true)}`);
}
gradeOffer(reinsuranceOptionIds, sh => defaultReinsuranceOption('WC', sh), '');

// ---------------------------------------------------------------- 7
const preGameCovers = (setup: GameSetupSettings, instance: GameInstance) => {
  const { priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  return [...new Set([...(earlyPreGameHistory ?? []), ...priorHistory].map(r => r.byLine.WC!.decisions.reinsuranceOption))];
};
const soloBoard = preGameCovers(solo.setup, solo.instance), roomBoard = preGameCovers(hostedWith.setup, hostedWith.instance);
function gradeBoard(soloCovers: string[], roomCovers: string[], tag: string) {
  check(soloCovers.join() === 'none' && roomCovers.join() === 'bad-year',
    `${tag}7. the prior board holds the default: None in a solo game, the Bad-year cover in a scheduled room`,
    `solo ${soloCovers.join('/')}; room ${roomCovers.join('/')}`);
}
gradeBoard(soloBoard, roomBoard, '');

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
controlFails('an expectation that keeps the shocks with the switch off',
  () => gradeExpectation((l, e, y, r, b) => expectedLossBreakdown(l, e, y, r, b, true), ''), '2.');
controlFails('a cover priced with the shocks while the switch is off',
  () => gradeCover((l, e, y, b) => stopQuotes(l, e, y, b, true), ''), '3.');
controlFails('a solo game reading the shock-inclusive expectation',
  () => gradeSolo(soloGame.rows.map(r => ({ ...r, expectedLoss: expectedLossBreakdown('WC', r.activeExposure, r.yearNumber, undefined, 1, true).total })), soloGame.struckPrice, soloGame.quotedOff, ''), '4a.');
controlFails('a solo game charged the shock-inclusive cover price',
  () => gradeSolo(soloGame.rows, soloGame.struckPrice.map((p, i) => p + 1e5 * (i + 1)), soloGame.quotedOff, ''), '4b.');
controlFails('a hosted game whose expectation dropped its shocks',
  () => gradeHosted(hostedGame.rows.map(r => ({ ...r, expectedLoss: expectedLossBreakdown('WC', r.activeExposure, r.yearNumber, undefined, 1, false).total })), ''), '5.');

controlFails('every option offered with the shocks off', () => gradeOffer(l => reinsuranceOptionIds(l, true), sh => defaultReinsuranceOption('WC', sh), ''), '6.');
controlFails('the Bad-year default with the shocks off', () => gradeOffer(reinsuranceOptionIds, () => 'bad-year', ''), '6.');
controlFails('a solo prior board on the Bad-year cover', () => gradeBoard(['bad-year'], roomBoard, ''), '7.');

console.log(failures.length === 0 ? '\nTHE EXPECTATION FOLLOWS THE SHOCK SWITCH: ALL CHECKS PASS.' : `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
