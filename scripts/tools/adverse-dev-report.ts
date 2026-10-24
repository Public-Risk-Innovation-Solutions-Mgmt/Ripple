// ============================================================================
// THE ADVERSE DEVELOPMENT REPORT (wip/adverse-development) — twenty scenarios,
// ten years, shocks off, default decisions, single player, every world.
//
//   npx tsx scripts/tools/adverse-dev-report.ts --level High   every line at one level
//   npx tsx scripts/tools/adverse-dev-report.ts                the build's default (or the baseline)
//
// ⚠ PORTABLE TO THE BASELINE: it imports only what multiplayer's head also has,
// so run in a worktree of that head it gives "today's build" on identical
// terms (the level is then ignored). Shocks are switched off at runtime.
//
// Per line: net reserves at the opening and at years 5 and 10 (mean of the
// scenarios' averaged state); scenario 1's 2027 accident year's ultimate at
// each valuation to 2036; the 2027 rate per $100 and how many scenarios it
// DROPS in (below the last pre-game year's rate); the ten-year combined ratio;
// surplus at years 5 and 10 (mean, lowest world); scenarios whose average ever
// went below zero.
// ============================================================================

import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { gameShocksOn } from '../../src/utils/shockLosses';
import * as P from '../../src/data/pricingParameters';
import type { CoverageLine, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

(P as unknown as { SOLO_SHOCKS: { enabled: boolean } }).SOLO_SHOCKS.enabled = false;
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const LEVEL = arg('level') as 'Low' | 'Mid' | 'High' | undefined;
const YEARS = 10, SCENARIOS = 20;
const M = 1e6;
const fm = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(v / M).toFixed(1)}M`;
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

type Acc = { res0: number[]; res5: number[]; res10: number[]; rate1: number[]; drops: number; crN: number[]; crD: number[];
  s5: number[]; s10: number[]; min5: number; min10: number; below: number; ay1: number[] };
const acc = Object.fromEntries(LINES.map(l => [l, { res0: [], res5: [], res10: [], rate1: [], drops: 0, crN: [], crD: [],
  s5: [], s10: [], min5: Infinity, min10: Infinity, below: 0, ay1: [] } as Acc])) as Record<CoverageLine, Acc>;
const rateOf = (r: LineResultSet) => r.finalRatePer100 ?? r.totalMemberCharge / Math.max(r.activeExposure * 10_000, 1);

const t0 = Date.now();
for (let sc = 1; sc <= SCENARIOS; sc++) {
  const settings = { poolName: 'R', gameLength: YEARS, startingYear: 2027, instanceId: String(sc), activeLines: LINES,
    ...(LEVEL ? { developmentLevels: { WC: LEVEL, GL: LEVEL, Property: LEVEL } } : {}) } as GameSetupSettings;
  const { setup, instance } = openSoloInstance(settings);
  const shocks = gameShocksOn(setup, instance);
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1, shocks), priorHistory });
  const preLast = priorHistory[priorHistory.length - 1];
  for (const l of LINES) acc[l].res0.push(gs.poolState.lines[l].netUnpaidReserve);
  const below = Object.fromEntries(LINES.map(l => [l, false])) as Record<CoverageLine, boolean>;
  const crN = Object.fromEntries(LINES.map(l => [l, 0])) as Record<CoverageLine, number>;
  const crD = Object.fromEntries(LINES.map(l => [l, 0])) as Record<CoverageLine, number>;
  for (let y = 1; y <= YEARS; y++) {
    const played = playWorldsYear(gs, defaultDecisionSet(y, shocks));
    for (const p of played.perWorld) for (const { line, result } of p.lineResults) {
      const r = result as LineResultSet;
      crN[line] += r.actualCombinedRatio * r.totalMemberCharge; crD[line] += r.totalMemberCharge;
      if (y === 5) { acc[line].s5.push(r.endingSurplus); acc[line].min5 = Math.min(acc[line].min5, r.endingSurplus); }
      if (y === 10) { acc[line].s10.push(r.endingSurplus); acc[line].min10 = Math.min(acc[line].min10, r.endingSurplus); }
    }
    const settled = settleWorldsYear(gs, played, []);
    for (const l of LINES) {
      const avg = settled.result.byLine[l];
      if (avg.endingSurplus < 0) below[l] = true;
      if (y === 1) {
        acc[l].rate1.push(rateOf(avg));
        if (preLast && rateOf(avg) < rateOf(preLast.byLine[l])) acc[l].drops++;
      }
    }
    gs = { ...gs, ...commitSettledYear(gs, settled), currentYearNumber: y + 1 };
    for (const l of LINES) {
      if (y === 5) acc[l].res5.push(gs.poolState.lines[l].netUnpaidReserve);
      if (y === 10) acc[l].res10.push(gs.poolState.lines[l].netUnpaidReserve);
    }
  }
  for (const l of LINES) {
    acc[l].crN.push(crN[l]); acc[l].crD.push(crD[l]);
    if (below[l]) acc[l].below++;
    if (sc === 1) acc[l].ay1 = (gs.poolState.lines[l].reserveDevelopment ?? []).find(r => r.yearNumber === 1)?.ultimateByValuation ?? [];
  }
  process.stderr.write(`scenario ${sc} done, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}

console.log(`ADVERSE DEVELOPMENT REPORT — ${SCENARIOS} scenarios x ${YEARS} years, shocks off, default decisions; level ${LEVEL ?? 'build default / baseline'}`);
for (const l of LINES) {
  const a = acc[l];
  const crs = a.crN.map((n, i) => n / a.crD[i]);
  const ay = a.ay1.length ? a.ay1.map((v, k) => `${2027 + k} ${fm(v)}`).join(', ') : 'none';
  const rise = a.ay1.length > 1 ? `${(100 * (a.ay1[a.ay1.length - 1] / a.ay1[0] - 1)).toFixed(1)}%` : '—';
  console.log(`${l}`);
  console.log(`  net reserves: opening ${fm(mean(a.res0))} · Y5 ${fm(mean(a.res5))} · Y10 ${fm(mean(a.res10))}`);
  console.log(`  scenario 1's 2027 AY ultimate: ${ay}  (2027 -> last ${rise})`);
  console.log(`  2027 rate $${mean(a.rate1).toFixed(3)} per $100 · drops in ${a.drops}/${SCENARIOS} · 10-yr CR ${(100 * mean(crs)).toFixed(1)}% (worst ${(100 * Math.max(...crs)).toFixed(1)}%)`);
  console.log(`  surplus Y5 ${fm(mean(a.s5))} / lowest ${fm(a.min5)} · Y10 ${fm(mean(a.s10))} / lowest ${fm(a.min10)} · scenarios ever below zero ${a.below}`);
}
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s`);
