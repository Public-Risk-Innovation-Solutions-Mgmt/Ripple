// RESERVE INFLATION — read-only probe. RUN=A (today), B (inflation, priced in),
// C (inflation, not priced), P (priced in for the first NY years only);
// PC = profit and contingency (default 0). Every
// change is made HERE: the branch's src is copied into the scratchpad and
// patched below; the worktree is untouched.
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
const WT = process.env.WT!, RUN = process.env.RUN ?? 'A', PC = Number(process.env.PC ?? 0);
const NY = RUN === 'P' ? Number(process.env.NY) : 60;
const TAG = `${RUN}${RUN === 'P' ? NY : ''}${PC ? '-pc' + PC : ''}`;
const DIR = `${process.env.COPIES}/${TAG}`;
rmSync(DIR, { recursive: true, force: true });
cpSync(`${WT}/src`, `${DIR}/src`, { recursive: true });
const patch = (f: string, a: string, b: string) => {
  const p = `${DIR}/src/${f}`, s = readFileSync(p, 'utf8');
  if (s.split(a).length !== 2) throw new Error(`patch site not unique in ${f}: ${a}`);
  writeFileSync(p, s.replace(a, b));
};
const TREND: Record<string, number> = { WC: 0.04, GL: 0.08, Property: 0.05 };
if (PC) patch('data/pricingParameters.ts', 'export const PROFIT_AND_CONTINGENCY_OF_RATE = 0;', `export const PROFIT_AND_CONTINGENCY_OF_RATE = ${PC};`);
if (RUN !== 'A') {
  // Each year, every open accident year's unpaid reserve (at the start of the
  // year, before payments) grows by the line's trend — the engine's extra
  // development rate, booked as prior-year development, on top of the host's.
  patch('utils/simulationEngine.ts', '    lineShocks?.rRate ?? 0,', '    (lineShocks?.rRate ?? 0) + ((globalThis as any).__RI?.rate?.[line] ?? 0),');
}
if (RUN === 'B' || RUN === 'P') {
  // Priced in: each window year's developed losses completed to the inflation
  // still to come from its age; with no history, the full expected inflation.
  patch('utils/newPurePremium.ts', '    const developed = groundUpPaid * ldf;',
    '    const developed = groundUpPaid * ldf * ((globalThis as any).__RI?.remaining?.(line, ageMonths / 12) ?? 1);');
  patch('utils/newPurePremium.ts',
    'expectedLossBreakdown(line, exposure, pricingYear, undefined, bookRisk).ordinary / Math.max(exposure * 10_000, 1) + load, load);',
    'expectedLossBreakdown(line, exposure, pricingYear, undefined, bookRisk).ordinary * ((globalThis as any).__RI?.remaining?.(line, 1) ?? 1) / Math.max(exposure * 10_000, 1) + load, load);');
}
const R = `${DIR}/src`;
const PO = await import(R + '/utils/payoutPattern.ts');
const DA = await import(R + '/data/defaultAssumptions.ts');
const pattern = (DA as any).LINE_PAYOUT_PATTERN ?? (PO as any).LINE_PAYOUT_PATTERN;
// What a year's claims will still pick up from the end of year k: Π_{k≤j≤NY} (1 + trend × unpaid share at j).
// Run P stops at NY: inflation after year NY is left to experience.
const remaining = (line: string, k: number) => {
  let f = 1;
  for (let j = Math.max(1, Math.round(k)); j <= NY; j++) f *= 1 + TREND[line] * PO.unpaidShare(pattern[line], j);
  return f;
};
(globalThis as any).__RI = { rate: RUN === 'A' ? {} : TREND, remaining };
const P = await import(R + '/data/pricingParameters.ts');
const { openSoloInstance } = await import(R + '/utils/soloGame.ts');
const { runPriorHistory, openingYear1Premium } = await import(R + '/utils/priorHistoryEngine.ts');
const { defaultDecisionSet } = await import(R + '/utils/decisionDefaults.ts');
const W = await import(R + '/utils/worlds.ts');
const ST = await import(R + '/utils/resultsStatement.ts');
const { gameShocksOn } = await import(R + '/utils/shockLosses.ts');
const { lossExpenseReserve } = await import(R + '/utils/lossExpense.ts');
const LINES = ['WC', 'GL', 'Property'];
const out: any = { run: RUN, ny: NY, pc: P.PROFIT_AND_CONTINGENCY_OF_RATE, floor: (P as any).PRE_GAME_MARGIN_FLOOR,
  multiplier: Object.fromEntries(LINES.map(l => [l, remaining(l, 1)])), scenarios: {} };
const N = Number(process.env.N ?? 20);
for (let n = 1; n <= N; n++) {
  const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: 10, startingYear: 2027, instanceId: String(n), activeLines: LINES } as any);
  const shocks = gameShocksOn(setup, instance);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const s: any = {};
  for (const l of LINES) {
    const y0 = priorHistory.find((r: any) => r.yearNumber === 0).byLine[l];
    const ls = poolState.lines[l];
    s[l] = { margin: y0.decisions.fundingCushion, rate0: y0.finalRatePer100,
      reserve0: ls.netUnpaidReserve + lossExpenseReserve(l, ls.reserveCohorts ?? []),
      premium0: openingYear1Premium(instance, l, ls, y0, shocks), surplus0: ls.surplus };
  }
  let gs: any = W.openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as any);
  for (let y = 1; y <= 10; y++) {
    gs = { ...gs, ...W.commitSettledYear(gs, W.settleWorldsYear(gs, W.playWorldsYear(gs, defaultDecisionSet(y)), LINES)), currentYearNumber: y + 1 };
    if (y === 5 || y === 10) for (const l of LINES) {
      const st = ST.buildAnnualStatement(gs, l, y);
      const r = gs.lockedResults[y - 1].byLine[l];
      Object.assign(s[l], { [`ccr${y}`]: ST.topCombinedRatio(st), [`surplus${y}`]: ST.topSurplus(st),
        [`reserve${y}`]: r.endingNetReserve + r.endingLaeReserve, [`premium${y}`]: r.totalMemberCharge });
    }
  }
  for (const l of LINES) {
    s[l].rate1 = gs.lockedResults[0].byLine[l].finalRatePer100;
    s[l].paid = [1, 5, 10].map(y => gs.lockedResults[y - 1].byLine[l].netPaidLosses);
    if (n === 1) s[l].ay2027 = (gs.poolState.lines[l].reserveDevelopment ?? []).find((r: any) => r.yearNumber === 1)?.ultimateByValuation;
  }
  out.scenarios[n] = s;
  console.error(`${TAG} scenario ${n} done`);
}
console.log(JSON.stringify(out));
