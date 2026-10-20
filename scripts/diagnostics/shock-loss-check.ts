// ============================================================================
// THE NEW LOSS ENGINE'S SHOCKS AND LARGE LOSSES: THEY FIRE AS OFTEN AS THE
// CATALOGUE SAYS, ARRIVE AS WHAT IS DRAWN, DECAY AS STATED, LAND WHERE THEY
// STRUCK, AND THE RATE DEDUCTS WHAT THE REINSURANCE WILL ACTUALLY PAY.
//
//   npx tsx scripts/diagnostics/shock-loss-check.ts
//
// Runs with MEMBER_LEVEL held OFF, so the new loss engine runs (and
// ROUTINE_LARGE_LOSSES flipped where
// a section needs it), both restored in a `finally` — safe only because every
// gate runs in its own process.
//
// WHAT IT ASSERTS, in order:
//
//   1. FREQUENCY. Singleplayer: over 60,000 seed-years each event fires at its
//      catalogue probability, within four standard errors. Multiplayer: the
//      host's schedule fires exactly as scheduled and nothing else does. The
//      same seed gives the same shock.
//   2. COUNTS AND SEVERITIES. Every T arrives as its SHOCK_LOSS_COUNT of
//      losses, each lognormal around T / count — mean and CV of loss / (T /
//      count) within their intervals on the uncapped lines — and the realised
//      total averages T without being rescaled to it. Earthquake and Wildfire
//      are one catastrophe occurrence; every other loss is its own. On GL the
//      pool keeps $25M of a claim and the rest is reported as the member's.
//      Routine large claims arrive at the parameter's count with the mixture's
//      mean excess, and the parameter IS the re-derivation.
//   3. DECAY. A and R in force at 0.65^age of their onset draw for exactly the
//      event's duration, then nothing; T at onset only. Through the engine,
//      the R development booked each year IS the rate times every open prior
//      year's opening outstanding.
//   4. REGIONS. A regional A is its draw times its region's exposure share;
//      every loss of a regional T lands on a member in the struck region.
//   5. WITHDRAWAL, INFLATION, INVESTMENT. A Member Withdrawal removes at least
//      25% of each line's exposure at the next renewal and not a member more
//      than it takes; Economic Inflation lifts every line's ordinary losses by
//      12% x 0.65^age; Investment Loss takes 20 points off the equity return
//      in its year and moves nothing else.
//   6. THE DEDUCTION IS THE EXPECTED RECOVERY. For every event that brings T
//      to a line, and for routine large losses, the mean cession the draw
//      actually produces through the tower — layer by layer — matches the
//      expectation the rate deducts, within four standard errors. The pricing
//      seam IS the sum of those expectations at the catalogue's probabilities,
//      the engine's deduction IS the seam, and the price IS it x the CLF at 70%.
//   7. THE WHOLE LINE. Played games, both routine settings: actual over the
//      ex-ante expected averages 1 within its interval.
//
// ⚠ AND IT FAILS WHEN BROKEN — see THE CONTROL at the foot.
// ============================================================================

import {
  GAME_REGIONS, MEMBER_LEVEL, ORDINARY_LOSS_LIMIT, R_MODEL, REGION_EXPOSURE_SHARE, REINSURANCE_LOAD_CLF_AT_70, ROUTINE_LARGE_LOSSES,
  ROUTINE_LARGE_LOSS_FREQUENCY_PER_1M, SHOCK_LOSS_COUNT, SHOCK_LOSS_CV, SHOCK_ONE_OCCURRENCE,
} from '../../src/data/pricingParameters';
import { REINSURANCE_TOWER, type TowerLine } from '../../src/data/reinsuranceTower';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import { getMemberExposure } from '../../src/utils/lineHelpers';
import { developmentBaseOf } from '../../src/utils/hostDevelopment';
import { allLayerRiskMoments } from '../../src/utils/towerMoments';
import { cedeAbove, cedeOccurrences, layerPremium, occurrenceDeductibles, occurrenceProgramCost, occurrenceTotals } from '../../src/utils/reinsuranceTower';
import { routineLargeBasis } from '../../src/utils/largeLosses';
import {
  DECAY, SHOCK_EVENTS, drawLargeLosses, eventLines, firingsStartingIn, resolveShockYear, tScale,
  type EventFiring, type LineShockYear, type ShockLevel,
} from '../../src/utils/shockLosses';
import {
  cedeAboveLocal, conditionalEventMoments, expectedLossBreakdown, layerCession, newEngineLayerMoments,
} from '../../src/utils/shockExpectation';
import { SeededRandom } from '../../src/utils/random';
import { marketSeedOf, unitsOf } from '../../src/utils/bookUnits';
import type { CoverageLine, GameInstance, GameState, Region, ResultSet, PoolState } from '../../src/types/simulation';
import type { ScheduledShock } from '../../src/types/shocks';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const RULE = '='.repeat(78);
const failed: string[] = [];
let checks = 0;
function check(ok: boolean, label: string, detail = '') {
  checks++;
  if (!ok) failed.push(`${label}${detail ? '  — ' + detail : ''}`);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}
const Z = 4;
const meanSe = (xs: number[]) => {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  return { n, mean, sd, se: sd / Math.sqrt(n) };
};
const within = (r: readonly number[], u: number) => r[0] + u * (r[1] - r[0]);
const rel = (a: number, b: number) => (b === 0 ? Math.abs(a) : Math.abs(a / b - 1));

/** Play `years` years of a three-line game, host-scheduled when a schedule is given. */
function play(seed: number, years: number, schedule: ScheduledShock[] | null) {
  const id = `SHK${seed}`;
  const instance = generateGameInstance(id, seed, schedule ?? []);
  const setup = {
    poolName: 'Shock', gameLength: years + 1, startingYear: 2026, instanceId: id, activeLines: LINES,
    ...(schedule ? { shockTiming: 'host' as const } : {}),
  };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const results: ResultSet[] = [];
  const before: PoolState[] = [];
  for (let y = 1; y <= years; y++) {
    before.push(gs.poolState);
    const p = processYear(gs, defaultDecisionSet(y));
    results.push(p.result);
    gs = {
      ...gs, poolState: p.updatedPoolState, currentYearNumber: y + 1,
      currentDecisions: defaultDecisionSet(y + 1), lockedResults: [...gs.lockedResults, p.result],
    };
  }
  return { instance, results, before };
}
/** The largest unit's share of the line's book in force before year 3. */
function largestUnitShare(g: ReturnType<typeof play>, line: CoverageLine): number {
  const units = unitsOf(marketSeedOf(g.instance), line, g.before[2].bookUnits?.[line] ?? []);
  return Math.max(...units.map(u => u.size)) / units.reduce((a, u) => a + u.size, 0);
}

/** A firing built by hand, for drawing one event's losses on demand. */
function firing(eventName: string, year: number, t: number, region?: Region): EventFiring {
  const event = SHOCK_EVENTS.find(e => e.name === eventName)!;
  const d = { a: 0.5, r: 0.5, t };
  return { event, firedYear: year, ordinal: 0, ...(region ? { region } : {}), draws: { WC: d, GL: d, Property: d } };
}
function arrivalYear(eventName: string, line: CoverageLine, f: EventFiring): LineShockYear {
  const row = eventLines(eventName).find(r => r.line === line && r.t !== 'None')!;
  return {
    uplift: 0, rRate: 0, byFiring: [],
    arrivals: [{
      firing: f, line, level: row.t,
      tModel: within(R_MODEL.tShock[line][row.t as Exclude<ShockLevel, 'None'>], f.draws[line].t),
      count: SHOCK_LOSS_COUNT[eventName]![line]!, oneOccurrence: SHOCK_ONE_OCCURRENCE.includes(eventName),
    }],
  };
}
const EMPTY: LineShockYear = { uplift: 0, rRate: 0, arrivals: [], byFiring: [] };

// The new loss engine runs whenever MEMBER_LEVEL is off; held off here.
const wasMembers = MEMBER_LEVEL.enabled;
const wasRoutine = ROUTINE_LARGE_LOSSES.enabled;
try {
  MEMBER_LEVEL.enabled = false;
  ROUTINE_LARGE_LOSSES.enabled = false;
  const market = getPredefinedMarketMembers();
  const exposureOf = (line: CoverageLine, y: number) => market.reduce((s, m) => s + getMemberExposure(m, line, y), 0);

  console.log(RULE);
  console.log('SHOCKS AND LARGE LOSSES — the new loss engine, flag on');
  console.log(RULE);

  // --------------------------------------------------------------------------
  console.log('\n--- 1. FREQUENCY ---');
  const N_SEEDS = 6_000, N_YEARS = 10;
  const counts = new Map<string, number>();
  for (let s = 0; s < N_SEEDS; s++) {
    const inst = { seed: 40_000_000 + s * 104_729 } as GameInstance;
    for (let y = 1; y <= N_YEARS; y++) {
      for (const f of firingsStartingIn(inst, 'catalogue', y)) counts.set(f.event.name, (counts.get(f.event.name) ?? 0) + 1);
    }
  }
  const trials = N_SEEDS * N_YEARS;
  let worstZ = 0, worstName = '';
  for (const e of SHOCK_EVENTS) {
    const f = (counts.get(e.name) ?? 0) / trials;
    const z = (f - e.probability) / Math.sqrt(e.probability * (1 - e.probability) / trials);
    if (Math.abs(z) > Math.abs(worstZ)) { worstZ = z; worstName = e.name; }
    console.log(`        ${e.name.padEnd(18)} ${(100 * f).toFixed(3)}% against ${(100 * e.probability).toFixed(1)}%  (${z.toFixed(2)} SE)`);
  }
  check(Math.abs(worstZ) < Z, 'singleplayer: every event fires at its catalogue probability',
    `worst ${worstName} at ${worstZ.toFixed(2)} SE over ${trials} seed-years`);
  const schedule: ScheduledShock[] = [{ shockId: '#7', yearNumber: 2 }, { shockId: '#2', yearNumber: 5 }, { shockId: '#7', yearNumber: 5 }];
  const hostInst = generateGameInstance('HOSTSCHED', 777, schedule);
  const fired: string[] = [];
  for (let y = 1; y <= 10; y++) for (const f of firingsStartingIn(hostInst, 'host', y)) fired.push(`${f.event.id}@${y}`);
  check(fired.join(',') === '#7@2,#2@5,#7@5',
    'multiplayer: the host\'s schedule fires exactly as scheduled, and nothing else', fired.join(', '));
  const again = JSON.stringify(resolveShockYear(hostInst, 'catalogue', 4)) === JSON.stringify(resolveShockYear(hostInst, 'catalogue', 4))
    && JSON.stringify(firingsStartingIn(hostInst, 'host', 5)) === JSON.stringify(firingsStartingIn(hostInst, 'host', 5));
  check(again, 'the same seed gives the same shock');
  check(firingsStartingIn(hostInst, 'catalogue', 0).length === 0 && firingsStartingIn(hostInst, 'host', -1).length === 0,
    'nothing fires before year 1');

  // --------------------------------------------------------------------------
  console.log('\n--- 2. COUNTS AND SEVERITIES ---');
  const Y = 3;
  const M = 2_000;
  for (const [name, byLine] of Object.entries(SHOCK_LOSS_COUNT)) {
    for (const line of Object.keys(byLine) as CoverageLine[]) {
      const n = byLine[line]!;
      const exposure = exposureOf(line, Y);
      const ratios: number[] = [], totals: number[] = [];
      let countOk = true, shapeOk = true;
      for (let i = 0; i < M; i++) {
        const regional = SHOCK_EVENTS.find(e => e.name === name)!.regional;
        const f = firing(name, Y, (i + 0.5) / M, regional ? (['North', 'Central', 'South'] as const)[i % 3] : undefined);
        const shocks = arrivalYear(name, line, f);
        const d = drawLargeLosses(line, market, Y, 2028, 9_000_000 + i * 7919, shocks, exposure);
        const T = shocks.arrivals[0].tModel * tScale(line, exposure, Y);
        if (d.claims.length !== n) countOk = false;
        const one = SHOCK_ONE_OCCURRENCE.includes(name);
        if (one ? !(d.occurrences.length === 1 && d.occurrences[0].isCatastrophe && d.occurrences[0].claimIds.length === n)
          : d.occurrences.length !== n) shapeOk = false;
        const raw = d.claims.reduce((s, c) => s + c.grossUltimate, 0) + d.memberShareAboveLimit;
        totals.push(raw / T);
        if (line !== 'GL') for (const c of d.claims) ratios.push(c.grossUltimate / (T / n));
      }
      check(countOk && shapeOk, `${name} on ${line}: ${n} loss(es), ${SHOCK_ONE_OCCURRENCE.includes(name) ? 'ONE catastrophe occurrence' : 'each its own occurrence'}`);
      const t = meanSe(totals);
      check(Math.abs(t.mean - 1) < Z * t.se && t.sd > 0, `${name} on ${line}: realised total averages T and is not rescaled`,
        `${t.mean.toFixed(4)} (${((t.mean - 1) / t.se).toFixed(2)} SE), CV ${(t.sd / t.mean).toFixed(3)}`);
      if (ratios.length > 0) {
        const r = meanSe(ratios);
        const cv = r.sd / r.mean;
        check(Math.abs(r.mean - 1) < Z * r.se && Math.abs(cv - SHOCK_LOSS_CV) < 0.03,
          `${name} on ${line}: each loss is lognormal around T / ${n}, CV ${SHOCK_LOSS_CV}`,
          `mean ${r.mean.toFixed(4)} (${((r.mean - 1) / r.se).toFixed(2)} SE), CV ${cv.toFixed(3)}`);
      }
    }
  }
  {
    // GL: the pool keeps $25M of any one claim; the rest is the member's.
    let worst = 0, above = 0;
    for (let i = 0; i < 500; i++) {
      const f = firing('Nuclear Verdict', Y, (i + 0.5) / 500);
      const d = drawLargeLosses('GL', market, Y, 2028, 7_000_000 + i, arrivalYear('Nuclear Verdict', 'GL', f), exposureOf('GL', Y));
      for (const c of d.claims) worst = Math.max(worst, c.grossUltimate);
      above += d.memberShareAboveLimit;
    }
    check(worst <= 25_000_000 + 1e-6 && above > 0, 'GL: the pool keeps at most $25M of a claim, the excess is reported as the member\'s',
      `largest pool claim $${(worst / 1e6).toFixed(2)}M, member's share $${(above / 1e6).toFixed(0)}M over 500 verdicts`);
  }
  ROUTINE_LARGE_LOSSES.enabled = true;
  for (const line of LINES) {
    const basis = routineLargeBasis(line);
    check(rel(ROUTINE_LARGE_LOSS_FREQUENCY_PER_1M[line], basis.frequencyPer1M) < 1e-9,
      `${line}: the routine frequency parameter IS today's mixture re-derived`,
      `${ROUTINE_LARGE_LOSS_FREQUENCY_PER_1M[line]} vs ${basis.frequencyPer1M.toPrecision(12)}`);
    const exposure = exposureOf(line, Y);
    const nCounts: number[] = [];
    for (let i = 0; i < 3_000; i++) {
      nCounts.push(drawLargeLosses(line, market, Y, 2028, 11_000_000 + i * 31, EMPTY, exposure).routine.count);
    }
    const lam = ROUTINE_LARGE_LOSS_FREQUENCY_PER_1M[line] * exposure;
    const c = meanSe(nCounts);
    check(Math.abs(c.mean - lam) < Z * Math.sqrt(lam / c.n), `${line}: routine large claims arrive at the parameter's count`,
      `${c.mean.toFixed(3)} a year against ${lam.toFixed(3)}`);
    const totalsPerYear = (() => {
      const xs: number[] = [];
      for (let i = 0; i < 3_000; i++) xs.push(drawLargeLosses(line, market, Y, 2028, 11_000_000 + i * 31, EMPTY, exposure).routine.excess);
      return meanSe(xs);
    })();
    const want = expectedLossBreakdown(line, exposure, Y).routineLarge;
    check(Math.abs(totalsPerYear.mean - want) < Z * totalsPerYear.se,
      `${line}: routine large losses' booked excess averages its expectation`,
      `$${(totalsPerYear.mean / 1e6).toFixed(2)}M against $${(want / 1e6).toFixed(2)}M (${((totalsPerYear.mean - want) / totalsPerYear.se).toFixed(2)} SE)`);
  }
  ROUTINE_LARGE_LOSSES.enabled = false;

  // --------------------------------------------------------------------------
  console.log('\n--- 3. DECAY ---');
  {
    const inst = generateGameInstance('DECAY', 31_337, [{ shockId: '#8', yearNumber: 2 }, { shockId: '#10', yearNumber: 2 }]);
    const f8 = firingsStartingIn(inst, 'host', 2).find(f => f.event.name === 'Social Inflation')!;
    const a = within(R_MODEL.aShock.GL.High, f8.draws.GL.a);
    const r = within(R_MODEL.rShock.Mid, f8.draws.GL.r);
    let worst = 0, tOnsetOnly = true;
    for (let y = 1; y <= 7; y++) {
      const sy = resolveShockYear(inst, 'host', y);
      const age = y - 2;
      const live = age >= 0 && age < 3;
      const wantUplift = live ? (a + R_MODEL.economicInflationInitialRate) * Math.pow(DECAY, age) : 0;
      const wantR = live ? r * Math.pow(DECAY, age) : 0;
      worst = Math.max(worst, Math.abs(sy.byLine.GL.uplift - wantUplift), Math.abs(sy.byLine.GL.rRate - wantR),
        Math.abs(sy.byLine.WC.uplift - (live ? R_MODEL.economicInflationInitialRate * Math.pow(DECAY, age) : 0)));
      if ((sy.byLine.GL.arrivals.length > 0) !== (y === 2)) tOnsetOnly = false;
    }
    check(worst < 1e-15, 'A and R run at 0.65^age of their draw for the event\'s duration, then nothing', `worst ${worst.toExponential(2)}`);
    check(tOnsetOnly, 'T arrives at onset only');
  }
  {
    const g = play(51_001, 7, [{ shockId: '#4', yearNumber: 3 }]);
    const twin = play(51_001, 7, []);
    let worst = 0, sawR = 0, twinR = 0;
    g.results.forEach((res, i) => {
      const rec = res.byLine.GL!.newLossEngine!;
      const base = g.before[i].lines.GL.reserveCohorts.filter(c => !c.closed).reduce((s, c) => s + developmentBaseOf(c), 0);
      worst = Math.max(worst, Math.abs(rec.rDevelopment - rec.rRate * base) / Math.max(1, base));
      if (rec.rRate > 0) sawR++;
      twinR += Math.abs(twin.results[i].byLine.GL!.newLossEngine!.rDevelopment);
    });
    check(sawR === 3 && worst < 1e-12 && twinR === 0,
      'through the engine, R books its rate x every open prior year\'s opening outstanding, and nothing without it',
      `${sawR} year(s) with R, worst ${worst.toExponential(2)} of base, twin $${twinR.toFixed(2)}`);
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 4. REGIONS ---');
  {
    let worst = 0, n = 0;
    for (let s = 0; s < 40; s++) {
      const inst = generateGameInstance(`REG${s}`, 60_000 + s, [{ shockId: '#1', yearNumber: 1 }]);
      const sy = resolveShockYear(inst, 'host', 1);
      const f = sy.inForce[0].firing;
      for (const line of LINES) {
        const row = eventLines('Earthquake').find(r => r.line === line)!;
        const want = within(R_MODEL.aShock[line][row.a as Exclude<ShockLevel, 'None'>], f.draws[line].a) * REGION_EXPOSURE_SHARE[f.region!];
        worst = Math.max(worst, Math.abs(sy.byLine[line].uplift - want));
        n++;
      }
    }
    check(worst < 1e-15, 'a regional A is its draw x its region\'s exposure share', `${n} line-firings, worst ${worst.toExponential(2)}`);
  }
  {
    // THE STRUCK REGION IS DRAWN BY EXPOSURE SHARE, over the game's four
    // regions — in the schedule (generateGameInstance) and in the catalogue's
    // own draw (firingsStartingIn) alike.
    const N = 8_000;
    const sched = new Map<string, number>(), cat = new Map<string, number>();
    for (let s = 0; s < N; s++) {
      const inst = generateGameInstance(`RGN${s}`, 70_000 + s * 7, [{ shockId: '#2', yearNumber: 1 }]);
      const r = inst.scheduledShocks![0].region!;
      sched.set(r, (sched.get(r) ?? 0) + 1);
      const f = firingsStartingIn({ seed: 90_000 + s * 13 } as GameInstance, 'catalogue', 1).find(x => x.event.regional);
      if (f?.region) cat.set(f.region, (cat.get(f.region) ?? 0) + 1);
    }
    const worstZ = (m: Map<string, number>) => {
      const total = [...m.values()].reduce((a, b) => a + b, 0);
      return Math.max(...GAME_REGIONS.map(r => {
        const p = REGION_EXPOSURE_SHARE[r], f = (m.get(r) ?? 0) / total;
        return Math.abs(f - p) / Math.sqrt(p * (1 - p) / total);
      }), [...m.keys()].some(k => !GAME_REGIONS.includes(k as never)) ? Infinity : 0);
    };
    const show = (m: Map<string, number>) => GAME_REGIONS.map(r => `${r} ${(100 * (m.get(r) ?? 0) / [...m.values()].reduce((a, b) => a + b, 0)).toFixed(1)}%`).join(' ');
    check(worstZ(sched) < Z && worstZ(cat) < Z, 'the struck region is drawn by exposure share, over four regions',
      `schedule ${show(sched)} (worst ${worstZ(sched).toFixed(2)} SE); catalogue ${show(cat)} (worst ${worstZ(cat).toFixed(2)} SE)`);
    // The control: a uniform draw over the four is caught.
    const uniform = new Map(GAME_REGIONS.map(r => [r as string, N / 4]));
    check(!(worstZ(uniform) < Z), 'control: a uniform draw over the four regions is caught', `worst ${worstZ(uniform).toFixed(2)} SE`);
  }
  {
    let off = 0, landed = 0;
    for (const name of ['Earthquake', 'Winterstorm', 'Wildfire']) {
      for (const region of ['North', 'Central', 'South'] as const) {
        for (let i = 0; i < 30; i++) {
          const d = drawLargeLosses('Property', market, Y, 2028, 3_000 + i,
            arrivalYear(name, 'Property', firing(name, Y, (i + 0.5) / 30, region)), exposureOf('Property', Y));
          for (const c of d.claims) {
            landed++;
            if (market.find(m => m.id === c.memberId)!.region !== region) off++;
          }
        }
      }
    }
    check(off === 0 && landed > 0, 'every loss of a regional T lands in the struck region', `${landed} losses, ${off} outside`);
  }
  {
    // On the book (no roster) — the game as it runs — over all four regions.
    let off = 0, landed = 0;
    for (const name of ['Earthquake', 'Winterstorm', 'Wildfire']) {
      for (const region of GAME_REGIONS) {
        for (let i = 0; i < 10; i++) {
          const d = drawLargeLosses('Property', null, Y, 2028, 4_000 + i,
            arrivalYear(name, 'Property', firing(name, Y, (i + 0.5) / 10, region)), exposureOf('Property', Y));
          for (const o of d.occurrences) { landed++; if (o.region !== region) off++; }
        }
      }
    }
    check(off === 0 && landed > 0, 'on the book, every regional T lands in the struck region, all four', `${landed} occurrences, ${off} outside`);
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 5. WITHDRAWAL, INFLATION, INVESTMENT ---');
  {
    const g = play(52_002, 4, [{ shockId: '#12', yearNumber: 2 }]);
    let ok = true;
    const detail: string[] = [];
    for (const line of LINES) {
      const recs = g.results.map(r => r.byLine[line]!);
      const w = recs[2].newLossEngine!.withdrawnExposure;
      const stayed = recs[2].activeExposure;
      const share = w / (w + stayed);
      const others = recs.filter((_, i) => i !== 2).every(r => r.newLossEngine!.withdrawnExposure === 0);
      // A book of units loses whole units, as near a quarter as whole units
      // come — within half its largest unit (book units commit 4); a roster
      // loses whole members until it has lost at least a quarter, and not a
      // member more.
      const members = g.before[2].lines[line].members;
      const book = g.before[2].lines[line].bookExposure;
      const ok3 = book !== undefined
        ? Math.abs(share - 0.25) <= 0.5 * largestUnitShare(g, line) + 1e-9
        : share >= 0.25 && share < 0.25 + Math.max(...members.map(m => getMemberExposure(m, line, 3))) / (w + stayed) + 1e-9;
      if (!(ok3 && others)) ok = false;
      detail.push(`${line} ${(100 * share).toFixed(1)}%`);
    }
    check(ok, 'Member Withdrawal: 25% of each line\'s exposure leaves at the next renewal, not a member more, and only then', detail.join(', '));
  }
  {
    const g = play(53_003, 5, [{ shockId: '#10', yearNumber: 2 }]);
    let worst = 0;
    g.results.forEach((r, i) => {
      const age = i + 1 - 2;
      const want = age >= 0 && age < 3 ? R_MODEL.economicInflationInitialRate * Math.pow(DECAY, age) : 0;
      for (const line of LINES) worst = Math.max(worst, Math.abs(r.byLine[line]!.newLossEngine!.uplift - want));
    });
    check(worst < 1e-15, 'Economic Inflation: every line\'s ordinary losses x (1 + 12% x 0.65^age), three years', `worst ${worst.toExponential(2)}`);
  }
  {
    const g = play(54_004, 4, [{ shockId: '#11', yearNumber: 2 }]);
    const twin = play(54_004, 4, []);
    let worst = 0, quiet = 0;
    g.results.forEach((r, i) => {
      for (const line of LINES) {
        const d = r.byLine[line]!.investmentReturnRate - twin.results[i].byLine[line]!.investmentReturnRate;
        if (i === 1) worst = Math.max(worst, Math.abs(d - R_MODEL.investmentLossAdjustment * 0.10));
        else quiet = Math.max(quiet, Math.abs(d));
      }
    });
    check(worst < 1e-12 && quiet === 0, 'Investment Loss: -20 points on the equity return in its year (10% in equities), nothing else',
      `worst ${worst.toExponential(2)}, other years ${quiet.toExponential(2)}`);
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 6. THE DEDUCTION IS THE EXPECTED RECOVERY ---');
  for (const x of [0, 4e5, 1e6, 3.2e6, 5e6, 9e6, 1e7, 1.4e7, 2.6e7, 1e9]) {
    for (const layer of [{ attachment: 1e6, limit: 4e6 }, { attachment: 5e6, limit: 995e6 }]) {
      for (const d of [0, 1e7]) {
        if (cedeAboveLocal(x, layer, d) !== cedeAbove(x, layer, d)) failed.push(`cedeAboveLocal != cedeAbove at ${x}`);
      }
    }
  }
  check(!failed.some(f => f.startsWith('cedeAboveLocal')), 'the expectation\'s cession IS the tower\'s, on a grid');
  let worstEvent = 0, worstEventLabel = '';
  const MC = 3_000;
  for (const [name, byLine] of Object.entries(SHOCK_LOSS_COUNT)) {
    for (const line of Object.keys(byLine) as CoverageLine[]) {
      const tl = line as TowerLine;
      const exposure = exposureOf(line, Y);
      const layers = REINSURANCE_TOWER[tl];
      const samples = layers.map(() => [] as number[]);
      const regional = SHOCK_EVENTS.find(e => e.name === name)!.regional;
      const u = new SeededRandom(88_000 + name.length);
      for (let i = 0; i < MC; i++) {
        const f = firing(name, Y, u.next(), regional ? (['North', 'Central', 'South'] as const)[i % 3] : undefined);
        const d = drawLargeLosses(line, market, Y, 2028, 21_000_000 + i * 13, arrivalYear(name, line, f), exposure);
        const totals = occurrenceTotals(d.claims, d.occurrences);
        const ceded = cedeOccurrences(tl, totals, layers.map(() => true), occurrenceDeductibles(tl, d.occurrences)).cededByLayer;
        ceded.forEach((c, k) => samples[k].push(c));
      }
      layers.forEach((l, k) => {
        if (!l.purchasable) return;
        const c = layerCession(line, l);
        const want = conditionalEventMoments(line, name, exposure, Y, c.h, c.kinks)!.c1;
        const got = meanSe(samples[k]);
        // A layer every draw exhausted (a verdict nearly always fills $4M xs $1M)
        // shows no variance to test against. The expectation still allows for the
        // rare loss that falls short, so the two must agree to within what ONE of
        // the M draws falling short could move the mean — no further.
        const z = got.se > 0 ? (got.mean - want) / got.se : (rel(got.mean, want) < 1 / MC ? 0 : Infinity);
        const label = `${name} ${line} layer ${k + 1}`;
        console.log(`        ${label.padEnd(36)} drawn $${(got.mean / 1e6).toFixed(3)}M  expected $${(want / 1e6).toFixed(3)}M  (${z.toFixed(2)} SE)`);
        if (Math.abs(z) > Math.abs(worstEvent)) { worstEvent = z; worstEventLabel = label; }
      });
    }
  }
  check(Math.abs(worstEvent) < Z, 'every event: the mean cession drawn through the tower IS the expected recovery, layer by layer',
    `worst ${worstEventLabel} at ${worstEvent.toFixed(2)} SE`);
  ROUTINE_LARGE_LOSSES.enabled = true;
  let worstRoutine = 0, worstRoutineLabel = '';
  for (const line of LINES) {
    const tl = line as TowerLine;
    const exposure = exposureOf(line, Y);
    const layers = REINSURANCE_TOWER[tl];
    const on = newEngineLayerMoments(tl, exposure, Y);
    ROUTINE_LARGE_LOSSES.enabled = false;
    const off = newEngineLayerMoments(tl, exposure, Y);
    ROUTINE_LARGE_LOSSES.enabled = true;
    const samples = layers.map(() => [] as number[]);
    for (let i = 0; i < MC; i++) {
      const d = drawLargeLosses(line, market, Y, 2028, 31_000_000 + i * 17, EMPTY, exposure);
      const ceded = cedeOccurrences(tl, occurrenceTotals(d.claims, d.occurrences), layers.map(() => true)).cededByLayer;
      ceded.forEach((c, k) => samples[k].push(c));
    }
    layers.forEach((_l, k) => {
      const want = on[k].expected - off[k].expected;
      const got = meanSe(samples[k]);
      const z = (got.mean - want) / got.se;
      const label = `routine ${line} layer ${k + 1}`;
      console.log(`        ${label.padEnd(36)} drawn $${(got.mean / 1e6).toFixed(3)}M  expected $${(want / 1e6).toFixed(3)}M  (${z.toFixed(2)} SE)`);
      if (Math.abs(z) > Math.abs(worstRoutine)) { worstRoutine = z; worstRoutineLabel = label; }
    });
  }
  check(Math.abs(worstRoutine) < Z, 'routine large losses: the mean cession drawn IS the expected recovery, layer by layer',
    `worst ${worstRoutineLabel} at ${worstRoutine.toFixed(2)} SE`);
  // The seam is the sum: probability x conditional, plus routine.
  let worstSeam = 0, worstPrice = 0;
  for (const routine of [false, true]) {
    ROUTINE_LARGE_LOSSES.enabled = routine;
    for (const line of LINES) {
      const tl = line as TowerLine;
      const exposure = exposureOf(line, Y);
      const seam = allLayerRiskMoments(tl, market, Y);
      ROUTINE_LARGE_LOSSES.enabled = true;
      const withR = newEngineLayerMoments(tl, exposure, Y);
      ROUTINE_LARGE_LOSSES.enabled = false;
      const without = newEngineLayerMoments(tl, exposure, Y);
      ROUTINE_LARGE_LOSSES.enabled = routine;
      REINSURANCE_TOWER[tl].forEach((l, k) => {
        const c = layerCession(line, l);
        let sum = routine ? withR[k].expected - without[k].expected : 0;
        for (const e of SHOCK_EVENTS) {
          const m = conditionalEventMoments(line, e.name, exposure, Y, c.h, c.kinks);
          if (m) sum += e.probability * m.c1;
        }
        worstSeam = Math.max(worstSeam, rel(seam[k].expected, sum));
        if (l.purchasable) worstPrice = Math.max(worstPrice, rel(layerPremium(tl, k, market, Y), seam[k].expected * REINSURANCE_LOAD_CLF_AT_70[tl]));
      });
    }
  }
  check(worstSeam < 1e-12, 'the pricing seam IS each event\'s expected recovery x its probability, plus routine', `worst ${worstSeam.toExponential(2)}`);
  check(worstPrice < 1e-12, 'each layer\'s price IS its expected recovery x the CLF at 70%', `worst ${worstPrice.toExponential(2)}`);
  ROUTINE_LARGE_LOSSES.enabled = false;
  {
    // The engine's deduction IS the seam, on GL — which has no aggregate, so the
    // occurrence layers are the whole of what it nets off.
    const g = play(55_005, 4, null);
    let worst = 0;
    g.results.forEach((res, i) => {
      const r = res.byLine.GL!;
      const ids = new Set(r.memberLossResults.map(m => m.memberId));
      const book = g.before[i].allMarketMembers.filter(m => ids.has(m.id));
      const placed = REINSURANCE_TOWER.GL.map(() => true);
      const want = occurrenceProgramCost('GL', placed, book, i + 1).expectedCeded;
      // The per-$100 figure times the book's own exposure — r.activeExposure is
      // rounded for display and would read a 1e-5 gap that is not there.
      const got = r.expectedCededPer100 * book.reduce((t, m) => t + getMemberExposure(m, 'GL', i + 1), 0) * 10_000;
      worst = Math.max(worst, rel(got, want));
    });
    check(worst < 1e-9, 'the engine deducts exactly the seam\'s expected recovery (GL, four years)', `worst ${worst.toExponential(2)}`);
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 7. THE WHOLE LINE, BOTH ROUTINE SETTINGS ---');
  for (const routine of [false, true]) {
    ROUTINE_LARGE_LOSSES.enabled = routine;
    const ae: Record<string, number[]> = { WC: [], GL: [], Property: [] };
    let floorBit = 0;
    for (let s = 0; s < 16; s++) {
      const g = play(70_000 + s * 7919, 10, null);
      for (const res of g.results) {
        for (const line of LINES) {
          const r = res.byLine[line]!;
          ae[line].push(r.grossUltimateLoss / r.expectedLoss);
          const n = r.newLossEngine!;
          if (n.ordinaryRealised < n.routineLargeClaims * ORDINARY_LOSS_LIMIT[line] * Math.pow(1.05, res.yearNumber - 1)) floorBit++;
        }
      }
    }
    for (const line of LINES) {
      const m = meanSe(ae[line]);
      check(Math.abs(m.mean - 1) < Z * m.se, `routine ${routine ? 'ON ' : 'OFF'} ${line}: actual / ex-ante expected averages 1`,
        `${m.mean.toFixed(4)} over ${m.n} line-years (${((m.mean - 1) / m.se).toFixed(2)} SE)`);
    }
    if (routine) console.log(`        untracked remainder floored in ${floorBit} line-year(s)`);
  }
} finally {
  MEMBER_LEVEL.enabled = wasMembers;
  ROUTINE_LARGE_LOSSES.enabled = wasRoutine;
}

console.log(`\n${RULE}`);
if (failed.length === 0) {
  console.log(`THE SHOCKS AND LARGE LOSSES ARE WHAT THEY SAY, AND THE RATE DEDUCTS WHAT THEY PAY. ${checks} checks.`);
} else {
  console.log(`${failed.length} FAILURE(S) of ${checks}:`);
  for (const f of failed) console.log(`  - ${f}`);
}
console.log(RULE);

// ============================================================================
// ⚠ THE CONTROL — RUN AND RECORDED. Each break applied alone, the gate run,
// the code restored and the gate green again.
//
//   1. FIRE AT 1.5x THE CATALOGUE PROBABILITY (firingsStartingIn): EXIT 1 —
//      section 1, worst Economic Inflation at 40.80 SE.
//   2. ONE LOSS TOO MANY PER T (drawLargeLosses): EXIT 1 — section 2's
//      counts on every event, and the realised totals (Earthquake +16 SE,
//      Winterstorm +26 SE).
//   3. DECAY AT 0.70, NOT 0.65 (resolveShockYear): EXIT 1 — section 3's
//      decay (worst 4.96e-2) and section 5's Economic Inflation (8.10e-3).
//   4. A REGIONAL T LANDS ANYWHERE (drawLargeLosses): EXIT 1 — section 4,
//      3,000 of 4,500 losses outside the struck region.
//   5. PRICE T LOSSES ON CV 0.4 WHILE DRAWING AT 0.5 (shockExpectation): EXIT 1
//      — section 6, Pandemic GL layer 1 at -16.07 SE. The deduction and the
//      draw must be one distribution, and this is the gate that says so.
// ============================================================================
process.exit(failed.length === 0 ? 0 : 1);
