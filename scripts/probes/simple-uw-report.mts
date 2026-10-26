// SIMPLE UNDERWRITING — THE TEST BUILD'S READING (wip/simple-underwriting).
//
//   YEARS=5 FUNDING=0.70 A1=0.05 A2=0 npx tsx scripts/probes/simple-uw-report.mts > out.json
//
// Twenty scenarios, ten years, single player (a hundred worlds), shocks off,
// every line's two sliders held at A1 (non-renewal) and A2 (new members) every
// year, at FUNDING (a confidence level such as 0.70; absent is Expected), for
// YEARS (absent is ten). The persistence, fade and fixed-admin switches it
// once took were removed at landing; their findings are beside
// NEW_BUSINESS_PENALTY in pricingParameters.ts.
// Per scenario and line: each year's loss ratio
// and rate, the ten-year combined ratio
// (the statement's cumulative), surplus at years 5 and 10 (the worlds' mean,
// and the lowest world at year 10). A design reading with no threshold; the
// comparison across settings is made by the reader.
import { SOLO_SHOCKS } from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import * as W from '../../src/utils/worlds';
import * as ST from '../../src/utils/resultsStatement';
import type { CoverageLine, GameState } from '../../src/types/simulation';

SOLO_SHOCKS.enabled = false;
const FUNDING = process.env.FUNDING ? Number(process.env.FUNDING) : null;
const A1 = Number(process.env.A1 ?? 0), A2 = Number(process.env.A2 ?? 0);
const YEARS = Number(process.env.YEARS ?? 10), N = Number(process.env.N ?? 20);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const decide = (y: number) => {
  const d = defaultDecisionSet(y, false);
  for (const l of LINES) {
    d.byLine[l].nonRenewal = A1; d.byLine[l].newMembers = A2;
    if (FUNDING !== null) { d.byLine[l].fundingAtExpected = false; d.byLine[l].fundingConfidenceLevel = FUNDING; }
  }
  return d;
};
const out: Record<string, unknown> = {
  funding: FUNDING ?? 'Expected', years: YEARS, a1: A1, a2: A2, scenarios: {},
};
for (let n = 1; n <= N; n++) {
  const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: YEARS, startingYear: 2027, instanceId: String(n), activeLines: LINES } as never);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = W.openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [],
    currentDecisions: decide(1), priorHistory, earlyPreGameHistory } as GameState);
  const s: Record<string, Record<string, unknown>> = Object.fromEntries(LINES.map(l => [l, {}]));
  for (let y = 1; y <= YEARS; y++) {
    const played = W.playWorldsYear(gs, decide(y));
    gs = { ...gs, ...W.commitSettledYear(gs, W.settleWorldsYear(gs, played, LINES)), currentYearNumber: y + 1 };
    if (y === 5 || y === 10) for (const l of LINES) {
      const st = ST.buildAnnualStatement(gs, l, y);
      Object.assign(s[l], { [`surplus${y}`]: ST.topSurplus(st), [`ccr${y}`]: ST.topCombinedRatio(st) });
    }
  }
  for (const l of LINES) {
    const rows = gs.lockedResults.map(r => r.byLine[l]!);
    Object.assign(s[l], {
      lr: rows.map(r => r.lossRatio),
      rate: rows.map(r => r.finalRatePer100),
      exposure: rows.map(r => r.writtenExposure),
      adminExpense: rows.map(r => r.adminExpense),
      worldMinSurplusEnd: gs.worlds ? Math.min(...gs.worlds.map(w => w.poolState.lines[l].surplus)) : null,
    });
  }
  (out.scenarios as Record<number, unknown>)[n] = s;
  console.error(`${FUNDING ?? 'E'} a1 ${A1} a2 ${A2}: scenario ${n} done`);
}
console.log(JSON.stringify(out));
