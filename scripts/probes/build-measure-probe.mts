// THE BUILD AS IT STANDS, MEASURED — twenty scenarios, ten played years, the
// default decisions, with no setting changed: each line's designed and charged
// prior-board margin, the opening and its guardrail hits, the 2027 rate change,
// the ten-year combined ratio, surplus at years 5 and 10, the surplus path and
// status by year, the loans offered, and the pre-game's path. A probe, not a
// gate: it copies src and adds only a hook recording the designed margin
// before the floor and which guardrail moved it.
//
//   WT=<repo> COPIES=<scratch dir> TAG=build YEARS=10 N=20 npx tsx scripts/probes/build-measure-probe.mts > build.json
//
// The copies need node_modules beside them: ln -s <repo>/node_modules <COPIES>/node_modules.
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
const WT = process.env.WT!, TAG = process.env.TAG ?? 'build';
const YEARS = Number(process.env.YEARS ?? 10), N = Number(process.env.N ?? 20);
const DIR = `${process.env.COPIES}/${TAG}`;
rmSync(DIR, { recursive: true, force: true });
cpSync(`${WT}/src`, `${DIR}/src`, { recursive: true });
const patch = (f: string, a: string, b: string) => {
  const p = `${DIR}/src/${f}`, s = readFileSync(p, 'utf8');
  if (s.split(a).length !== 2) throw new Error(`patch site not unique in ${f}: ${a}`);
  writeFileSync(p, s.replace(a, b));
};
const G = '(globalThis as any).__RI';
// The designed margin before the floor, and which guardrail (if any) moved it.
patch('utils/priorHistoryEngine.ts',
  '  const designed = Math.max(PRE_GAME_MARGIN_FLOOR, solvePreGameMargin(run(\'designed\'), line).start);',
  `  const designedRaw = solvePreGameMargin(run('designed'), line).start;
  const designed = Math.max(PRE_GAME_MARGIN_FLOOR, designedRaw);
  ((${G}.pg ??= {}))[line] = { designedRaw, guard: 'none' };`);
patch('utils/priorHistoryEngine.ts',
  "  if (!(played.lineState.surplus > 0) || ps > max) return solvePreGameMargin(run('simulated', max), line).opened;",
  `  if (!(played.lineState.surplus > 0) || ps > max) { ${G}.pg[line].guard = 'thin'; return solvePreGameMargin(run('simulated', max), line).opened; }`);
patch('utils/priorHistoryEngine.ts', '  if (ps < min) {', `  if (ps < min) { ${G}.pg[line].guard = 'rich';`);

const R = `${DIR}/src`;
(globalThis as any).__RI = {};
const P = await import(R + '/data/pricingParameters.ts');
const { openSoloInstance } = await import(R + '/utils/soloGame.ts');
const { runPriorHistory, openingYear1Premium } = await import(R + '/utils/priorHistoryEngine.ts');
const { defaultDecisionSet } = await import(R + '/utils/decisionDefaults.ts');
const W = await import(R + '/utils/worlds.ts');
const ST = await import(R + '/utils/resultsStatement.ts');
const { gameShocksOn } = await import(R + '/utils/shockLosses.ts');
const LINES = ['WC', 'GL', 'Property'];
const out: any = { tag: TAG, capital: P.STARTING_CAPITAL, ranges: P.SCENARIO_RATIO_RANGE, pc: P.PROFIT_AND_CONTINGENCY_OF_RATE,
  floor: P.PRE_GAME_MARGIN_FLOOR, bounds: P.OPENING_PREMIUM_TO_SURPLUS_BOUNDS,
  scenarios: {} };
for (let n = 1; n <= N; n++) {
  const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: Math.max(YEARS, 1), startingYear: 2027, instanceId: String(n), activeLines: LINES } as any);
  const shocks = gameShocksOn(setup, instance);
  (globalThis as any).__RI.pg = {};
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const pg = JSON.parse(JSON.stringify((globalThis as any).__RI.pg));
  const s: any = {};
  for (const l of LINES) {
    const y0 = priorHistory.find((r: any) => r.yearNumber === 0).byLine[l];
    const ls = poolState.lines[l];
    const premium0 = openingYear1Premium(instance, l, ls, y0, shocks);
    const preRows = [...earlyPreGameHistory, ...priorHistory].filter((r: any) => r.byLine[l]);
    const pre = preRows.map((r: any) => r.byLine[l].endingSurplus);
    const prePath = preRows.map((r: any) => [r.yearNumber, r.byLine[l].endingSurplus, r.byLine[l].totalMemberCharge, r.byLine[l].capitalAdequacyStatus, r.byLine[l].netIncurredLoss, r.byLine[l].billedExposure ?? r.byLine[l].activeExposure]);
    s[l] = { target: P.SCENARIO_PREMIUM_TO_SURPLUS[l][n], lossMult: P.preGameLossMultiplier(n, l), prePath, reserve0: ls.netUnpaidReserve, margin: y0.decisions.fundingCushion, designedRaw: pg[l]?.designedRaw, guard: pg[l]?.guard,
      rate0: y0.finalRatePer100, premium0, surplus0: ls.surplus, ps0: premium0 / ls.surplus, preMin: Math.min(...pre),
      status0: y0.capitalAdequacyStatus, ecr0: y0.excessCapitalRatio, y0Surplus: y0.endingSurplus };
  }
  if (YEARS > 0) {
    let gs: any = W.openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as any);
    for (let y = 1; y <= YEARS; y++) {
      const played = W.playWorldsYear(gs, defaultDecisionSet(y));
      for (const o of played.loanOffers) (s.loans ??= []).push({ year: y, line: o.line, needing: o.worlds?.needing ?? 1, of: o.worlds?.of ?? 1, lenders: o.lenderShares, deficit: o.deficit });
      gs = { ...gs, ...W.commitSettledYear(gs, W.settleWorldsYear(gs, played, LINES)), currentYearNumber: y + 1 };
      if (y === 5 || y === 10) for (const l of LINES) {
        const st = ST.buildAnnualStatement(gs, l, y);
        Object.assign(s[l], { [`ccr${y}`]: ST.topCombinedRatio(st), [`surplus${y}`]: ST.topSurplus(st) });
      }
    }
    for (const l of LINES) {
      s[l].rate1 = gs.lockedResults[0].byLine[l].finalRatePer100;
      s[l].surplusPath = gs.lockedResults.map((r: any) => r.byLine[l].endingSurplus);
      s[l].premiumPath = gs.lockedResults.map((r: any) => r.byLine[l].totalMemberCharge);
      s[l].status = gs.lockedResults.map((r: any) => r.byLine[l].capitalAdequacyStatus);
      if (n === 1) s[l].ay2027 = (gs.poolState.lines[l].reserveDevelopment ?? []).find((r: any) => r.yearNumber === 1)?.ultimateByValuation;
    }
  }
  out.scenarios[n] = s;
  console.error(`${TAG} scenario ${n} done`);
}
console.log(JSON.stringify(out));
