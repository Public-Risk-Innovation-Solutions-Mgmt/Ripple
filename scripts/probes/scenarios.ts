// TWENTY STARTING SCENARIOS (measurement only), on the four changes, under flat-loader.
//   ARM=change WC_ONLY_9X1=1 GAME=three|property PSCALE=<target T scale for Property, or 'today'> \
//   NODE_OPTIONS="--import <abs>/flat-register.mjs" npx tsx scripts/probes/scenarios.ts
// Scenario n: seed n for everything after year 1; every line opens at factor x $35M; pre-game
// ordinary losses at expected x (1 + (1 - factor) x 0.3), flat; Randomise draws 2-4 shocks.
// The engine's own solve sets the pre-game's starting surplus so year 0 ends at the opening.
import { ARM, LINES as ALL } from './flat-setup';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { drawShockSchedule, SOLO_SHOCK_STREAM } from '../../src/utils/shockSchedule';
import { seedFromInstanceId } from '../../src/seedHash';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { reinsuranceOptionsFor, placementFor } from '../../src/utils/reinsuranceOptions';
import { occurrenceProgramCost } from '../../src/utils/reinsuranceTower';
import { expectedLossBreakdown } from '../../src/utils/shockExpectation';
import { exposureFactor } from '../../src/data/exposureTrend';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { tScale, SHOCK_EVENTS, drawLargeLosses, eventLines, type EventFiring, type LineShockYear } from '../../src/utils/shockLosses';
import { R_MODEL, SHOCK_LOSS_COUNT, SHOCK_ONE_OCCURRENCE, REGION_EXPOSURE_SHARE, regionByShare } from '../../src/data/pricingParameters';
import { ordinaryLossCostPer100 } from '../../src/utils/ordinaryLoss';
import { SeededRandom } from '../../src/utils/random';
import type { CoverageLine, GameState, LineResultSet } from '../../src/types/simulation';

if (ARM !== 'change') throw new Error('scenarios: run on ARM=change');
const G = globalThis as any;
const LINES: CoverageLine[] = process.env.GAME === 'property' ? ['Property'] : ALL;
const CENTRE = 35_000_000, YEARS = 10, W = 10;
const factors = Array.from({ length: 20 }, (_, i) => 0.75 + i * (0.5 / 19));
new SeededRandom(20261020).shuffle(factors);
G.__SHOCK_COUNT = (seed: string) => 2 + (seedFromInstanceId(seed) % 3);
const out: Record<string, unknown>[] = [];
let tMult = 1, tToday = NaN;
const M = (x: number) => (x / 1e6).toFixed(1);
for (let n = 1; n <= 20; n++) {
  const f = factors[n - 1], id = `SCENARIO-${n}`;
  G.__OPEN_SURPLUS = Object.fromEntries(LINES.map(l => [l, f * CENTRE]));
  G.__PREGAME_LOSS_MULT = 1 + (1 - f) * 0.3;
  const schedule = drawShockSchedule(id, YEARS, SOLO_SHOCK_STREAM);
  const instance = generateGameInstance(id, n, schedule);
  const setup = { poolName: 'P', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES, shockTiming: 'solo' } as never;
  const ph = runPriorHistory(instance, setup);
  G.__PREGAME_LOSS_MULT = undefined; G.__OPEN_SURPLUS = undefined;
  const pre = [...ph.earlyPreGameHistory, ...ph.priorHistory];
  // Property's catastrophe scale, set once from the first scenario's opening book (pre-game has no shocks)
  if (n === 1 && LINES.includes('Property')) {
    const e = (ph.poolState.lines.Property.bookExposure ?? 0) * exposureFactor('Property', 1);
    tToday = tScale('Property', e, 1);
    tMult = process.env.PSCALE && process.env.PSCALE !== 'today' ? Number(process.env.PSCALE) / tToday : 1;
    G.__T_MULT = { Property: tMult };
  }
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState: ph.poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory: ph.priorHistory } as GameState);
  const per: Record<string, LineResultSet[][]> = {}; for (const l of LINES) per[l] = Array.from({ length: W }, () => []);
  const pool: number[][] = Array.from({ length: W }, () => []);
  for (let y = 1; y <= YEARS; y++) {
    const settled = settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), []);
    gs = { ...gs, ...commitSettledYear(gs, settled), currentYearNumber: y + 1 };
    settled.worlds!.forEach((w, i) => { for (const l of LINES) per[l][i].push(w.lockedResults[y - 1].byLine[l] as LineResultSet); pool[i].push(w.lockedResults[y - 1].endingSurplus); });
  }
  const row: Record<string, unknown> = { n, factor: f, shocks: schedule.length, lossMult: 1 + (1 - f) * 0.3 };
  for (const l of LINES) {
    const ls = ph.poolState.lines[l], rs = per[l];
    const exp = (ls.bookExposure ?? 0) * exposureFactor(l, 1);
    row[l] = {
      openSurplus: ls.surplus, openReserve: ls.netUnpaidReserve,
      preLR: pre.reduce((a, r) => a + (r.byLine[l] as LineResultSet).actualLossRatio, 0) / pre.length,
      rate1: gs.lockedResults[0].byLine[l].ratePer100,
      rateAvg: gs.lockedResults.reduce((a, r) => a + r.byLine[l].ratePer100, 0) / YEARS,
      expLoss1: expectedLossBreakdown(l, exp, 1, false, 1).total,
      s5: rs.map(w => w[4].endingSurplus), s10: rs.map(w => w[9].endingSurplus), neg: rs.filter(w => w.some(r => r.endingSurplus < 0)).length,
      prices: reinsuranceOptionsFor(l).filter(o => o.limit > 0).map(o => ({ id: o.id, ...occurrenceProgramCost(l as never, placementFor(l, o.id), { exposure: exp } as never, 1) })),
      statement: pre.map(r => { const x = r.byLine[l] as LineResultSet; return { year: r.yearNumber, premium: x.totalMemberCharge, incurred: x.netIncurredLoss, lae: x.laeIncurred,
        uw: x.underwritingIncome, inv: x.investmentIncome, net: x.netIncome, reserve: x.endingNetReserve, surplus: x.endingSurplus, lr: x.actualLossRatio, rate: x.ratePer100 }; }),
    };
  }
  row.pool = { open: LINES.reduce((a, l) => a + ph.poolState.lines[l].surplus, 0), s5: pool.map(w => w[4]), s10: pool.map(w => w[9]), neg: pool.filter(w => w.some(x => x < 0)).length };
  out.push(row);
  console.error(`scenario ${n} done (factor ${f.toFixed(4)}, ${schedule.length} shocks)`);
}
// a wildfire on Property's opening book, at this run's scale: T (drawn by the engine) + A
let wildfire: unknown = null;
if (LINES.includes('Property')) {
  const ev = SHOCK_EVENTS.find(e => e.name === 'Wildfire')!, row = eventLines('Wildfire').find(r => r.line === 'Property')!;
  const exp = (out[0] as any).Property.expLoss1 > 0 ? undefined : undefined; void exp;
  const e0 = Number(process.env.P_EXPOSURE ?? 0) || NaN; void e0;
  const rng = new SeededRandom(99); const tv: number[] = [], av: number[] = [];
  const instance0 = generateGameInstance('SCENARIO-1', 1, []);
  const ph0 = runPriorHistory(instance0, { poolName: 'P', gameLength: YEARS, startingYear: 2026, instanceId: 'SCENARIO-1', activeLines: LINES } as never);
  const ex = (ph0.poolState.lines.Property.bookExposure ?? 0) * exposureFactor('Property', 1);
  const [lo, hi] = R_MODEL.tShock.Property[row.t as 'Low'], [alo, ahi] = R_MODEL.aShock.Property[row.a as 'Low'];
  for (let i = 0; i < 20_000; i++) {
    const u = { a: rng.next(), r: rng.next(), t: rng.next() };
    const region = regionByShare(rng.next());
    const firing = { event: ev, firedYear: 1, ordinal: 0, region, draws: { WC: u, GL: u, Property: u } } as EventFiring;
    const shocks = { uplift: 0, rRate: 0, byFiring: [], arrivals: [{ firing, line: 'Property', level: row.t, tModel: lo + u.t * (hi - lo),
      count: SHOCK_LOSS_COUNT.Wildfire.Property!, oneOccurrence: SHOCK_ONE_OCCURRENCE.includes('Wildfire') }] } as unknown as LineShockYear;
    tv.push(drawLargeLosses('Property', null, 1, 2026, 5_000_000 + i, shocks, ex).grossAdded);
    av.push((alo + u.a * (ahi - alo)) * REGION_EXPOSURE_SHARE[region] * ex * 10_000 * ordinaryLossCostPer100('Property', 1));
  }
  tv.sort((a, b) => a - b);
  wildfire = { exposure: ex, tScaleToday: tToday, tScaleNow: tScale('Property', ex, 1), tMedian: tv[10_000], tP90: tv[18_000], tMean: tv.reduce((a, b) => a + b, 0) / tv.length, aMean: av.reduce((a, b) => a + b, 0) / av.length };
}
console.log(`Measured at ${process.env.MEASURE_SHA}; arm ${ARM}; game ${LINES.join('+')}; Property scale ${process.env.PSCALE ?? 'today'} (multiplier ${tMult.toFixed(4)}); no inter-line loans`);
console.log('FACTORS ' + JSON.stringify(factors.map((f, i) => ({ n: i + 1, factor: Number(f.toFixed(4)) }))));
console.log('WILDFIRE ' + JSON.stringify(wildfire));
console.log('JSON ' + JSON.stringify(out));
