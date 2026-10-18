// ============================================================================
// THE NEW LOSS ENGINE, SIDE BY SIDE — shocks only, against routine large
// losses every year with the shocks on top. Read-only; asserts nothing.
//
//   npx tsx scripts/tools/new-engine-report.ts [--games 40]
//
// Plays the same seeds, singleplayer (the catalogue's probabilities), ten
// years, under each ROUTINE_LARGE_LOSSES setting — once for a team PLACING
// every layer and once for a team DECLINING every layer. The old engine it
// used to print beside them is frozen on the legacy-engine branch, where this
// report still runs its "Today" column.
// Prints Markdown: by line, the expected loss and what each event contributes
// to it, the rate and how often it swings, how often reinsurance pays, and
// surplus at years 5 and 10, mean and minimum across games.
//
// Written for the team discussion on the open question in
// docs/PENDING_MULTIPLAYER.md section 3: do large losses arrive only with
// shocks, or every year with shocks on top?
// ============================================================================

import { MEMBER_LEVEL, ROUTINE_LARGE_LOSSES } from '../../src/data/pricingParameters';
import { REINSURANCE_TOWER, type TowerLine } from '../../src/data/reinsuranceTower';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { expectedLossBreakdown } from '../../src/utils/shockExpectation';
import type { CoverageLine, DecisionSet, GameState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const GAMES = arg('games', 40);
const YEARS = 10;

function decisions(y: number, place: boolean): DecisionSet {
  const d = defaultDecisionSet(y);
  for (const line of LINES) {
    d.byLine[line] = {
      ...d.byLine[line],
      layersPlaced: REINSURANCE_TOWER[line as TowerLine].map(l => place && l.purchasable),
      aggregateStopLevel: -1,
    };
  }
  return d;
}

function playAll(place: boolean): ResultSet[][] {
  const games: ResultSet[][] = [];
  for (let g = 0; g < GAMES; g++) {
    const id = `NER${g}`;
    const instance = generateGameInstance(id, 8_100_000 + g * 7919);
    const setup = { poolName: 'Report', gameLength: YEARS + 1, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: decisions(1, place), priorHistory,
    };
    const out: ResultSet[] = [];
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, decisions(y, place));
      out.push(p.result);
      gs = {
        ...gs, poolState: p.updatedPoolState, currentYearNumber: y + 1,
        currentDecisions: decisions(y + 1, place), lockedResults: [...gs.lockedResults, p.result],
      };
    }
    games.push(out);
  }
  return games;
}

interface Summary {
  expected: number; actual: number; rate1: number; rate10: number;
  swing20: number; swing50: number; pays: number;
  s5: number; s5min: number; s10: number; s10min: number;
}
function summarise(games: ResultSet[][], line: CoverageLine): Summary {
  let expected = 0, actual = 0, n = 0, swings = 0, s20 = 0, s50 = 0, pays = 0;
  let rate1 = 0, rate10 = 0;
  const s5: number[] = [], s10: number[] = [];
  for (const g of games) {
    g.forEach((res, i) => {
      const r = res.byLine[line]!;
      expected += r.expectedLoss; actual += r.grossUltimateLoss; n++;
      if (r.reinsuranceRecovery > 0) pays++;
      if (i > 0) {
        const prev = g[i - 1].byLine[line]!.ratePer100;
        const ch = Math.abs(r.ratePer100 / prev - 1);
        swings++;
        if (ch > 0.2) s20++;
        if (ch > 0.5) s50++;
      }
    });
    rate1 += g[0].byLine[line]!.ratePer100;
    rate10 += g[YEARS - 1].byLine[line]!.ratePer100;
    s5.push(g[4].byLine[line]!.endingSurplus);
    s10.push(g[YEARS - 1].byLine[line]!.endingSurplus);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    expected: expected / n, actual: actual / n, rate1: rate1 / games.length, rate10: rate10 / games.length,
    swing20: s20 / swings, swing50: s50 / swings, pays: pays / n,
    s5: mean(s5), s5min: Math.min(...s5), s10: mean(s10), s10min: Math.min(...s10),
  };
}

const M = (x: number) => `$${(x / 1e6).toFixed(1)}M`;
const P = (x: number) => `${(100 * x).toFixed(0)}%`;

const wasRoutine = ROUTINE_LARGE_LOSSES.enabled, wasMembers = MEMBER_LEVEL.enabled;
const runs: Record<string, { place: ResultSet[][]; decline: ResultSet[][] }> = {};
try {
  // The new loss engine runs whenever MEMBER_LEVEL is off.
  MEMBER_LEVEL.enabled = false;
  ROUTINE_LARGE_LOSSES.enabled = false;
  runs.shocks = { place: playAll(true), decline: playAll(false) };
  ROUTINE_LARGE_LOSSES.enabled = true;
  runs.routine = { place: playAll(true), decline: playAll(false) };

  console.log(`# The new loss engine — shocks only, or routine large losses with shocks on top\n`);
  console.log(`${GAMES} singleplayer games x ${YEARS} years, the same seeds in every column; events fire at the `
    + `catalogue's probabilities. Dollars are per line, per year.\n`);
  for (const line of LINES) {
    const cols = [
      ['Shocks only', runs.shocks], ['Routine + shocks', runs.routine],
    ] as const;
    const S = cols.map(([, r]) => ({ place: summarise(r.place, line), decline: summarise(r.decline, line) }));
    console.log(`## ${line}\n`);
    console.log(`| | ${cols.map(c => c[0]).join(' | ')} |`);
    console.log(`|---|${cols.map(() => '---:').join('|')}|`);
    const row = (label: string, f: (s: { place: Summary; decline: Summary }) => string) =>
      console.log(`| ${label} | ${S.map(f).join(' | ')} |`);
    row('Actual loss a year', s => M(s.place.actual));
    row('Expected loss a year', s => M(s.place.expected));
    row('Actual ÷ expected', s => (s.place.actual / s.place.expected).toFixed(2));
    row('Rate per $100, year 1 → 10', s => `${s.place.rate1.toFixed(2)} → ${s.place.rate10.toFixed(2)}`);
    row('Rate moves > 20% / > 50% a year', s => `${P(s.place.swing20)} / ${P(s.place.swing50)}`);
    row('Years reinsurance pays', s => P(s.place.pays));
    row('Surplus yr 5, placing: mean (min)', s => `${M(s.place.s5)} (${M(s.place.s5min)})`);
    row('Surplus yr 10, placing: mean (min)', s => `${M(s.place.s10)} (${M(s.place.s10min)})`);
    row('Surplus yr 5, declining: mean (min)', s => `${M(s.decline.s5)} (${M(s.decline.s5min)})`);
    row('Surplus yr 10, declining: mean (min)', s => `${M(s.decline.s10)} (${M(s.decline.s10min)})`);

    // Each event's contribution, on the average year-1 book of these games.
    const exposure = runs.shocks.place.reduce((t, g) => t + g[0].byLine[line]!.activeExposure, 0) / GAMES;
    const off = expectedLossBreakdown(line, exposure, 5, false);
    const on = expectedLossBreakdown(line, exposure, 5, true);
    console.log(`\n**What makes up expected loss** — year 5, the average book ($${exposure.toFixed(0)}M exposure):\n`);
    console.log(`| | Shocks only | Routine + shocks |`);
    console.log(`|---|---:|---:|`);
    console.log(`| Ordinary losses | ${M(off.ordinary)} | ${M(on.ordinary)} |`);
    console.log(`| Routine large losses | — | ${M(on.routineLarge)} (${P(on.routineLarge / on.total)}) |`);
    const names = [...off.byEvent.keys()].sort((a, b) => (off.byEvent.get(b)! - off.byEvent.get(a)!));
    for (const name of names) {
      const v = off.byEvent.get(name)!;
      console.log(`| ${name} | ${M(v)} (${P(v / off.total)}) | ${M(v)} (${P(v / on.total)}) |`);
    }
    console.log(`| **Total** | **${M(off.total)}** | **${M(on.total)}** |\n`);
  }
} finally {
  ROUTINE_LARGE_LOSSES.enabled = wasRoutine;
  MEMBER_LEVEL.enabled = wasMembers;
}
