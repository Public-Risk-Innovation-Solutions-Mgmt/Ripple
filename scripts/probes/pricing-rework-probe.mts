// THE PRICING REWORK, MEASURED BEFORE AND AFTER (wip/pricing-rework) — twenty
// scenarios, five played years, the default decisions, per line: the 2027
// rate, admin in 2027 (priced and booked), the 2027 pure premium, the prior
// board's designed margin (before the floor; range and floor hits), the
// opening's premium to surplus (range) and which guardrail moved it, the 2027
// rate's change on the last pre-game year (drops, and any over 2%), the
// five-year combined ratio (the Annual Statement's) and surplus at year 5.
// A probe, not a gate: it copies src and adds only the hook
// build-measure-probe.mts adds, so it runs unchanged on multiplayer's head
// (the control) and on the rework.
//
//   WT=<repo> COPIES=<scratch dir> TAG=after MODE=single|hosted N=20 YEARS=5 \
//     npx tsx scripts/probes/pricing-rework-probe.mts > after-single.json
//
//   MODE=single   openSoloInstance: single player as the build ships it
//                 (development Off, the solo shock draw).
//   MODE=hosted   buildTeamGame — the room's own path — with every line at
//                 adverse development Low and no shocks scheduled.
//
// The copies need node_modules beside them: ln -s <repo>/node_modules <COPIES>/node_modules.
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
const WT = process.env.WT!, TAG = process.env.TAG ?? 'probe', MODE = process.env.MODE ?? 'single';
const YEARS = Number(process.env.YEARS ?? 5), N = Number(process.env.N ?? 20);
const DIR = `${process.env.COPIES}/${TAG}-${MODE}`;
rmSync(DIR, { recursive: true, force: true });
cpSync(`${WT}/src`, `${DIR}/src`, { recursive: true });
if (!existsSync(`${process.env.COPIES}/node_modules`)) symlinkSync(`${WT}/node_modules`, `${process.env.COPIES}/node_modules`);
const patch = (f: string, a: string, b: string) => {
  const p = `${DIR}/src/${f}`, s = readFileSync(p, 'utf8');
  if (s.split(a).length !== 2) throw new Error(`patch site not unique in ${f}: ${a}`);
  writeFileSync(p, s.replace(a, b));
};
const G = '(globalThis as any).__RI';
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
const { buildTeamGame } = await import(R + '/session/client/buildGame.ts');
const { defaultDecisionSet } = await import(R + '/utils/decisionDefaults.ts');
const W = await import(R + '/utils/worlds.ts');
const ST = await import(R + '/utils/resultsStatement.ts');
const { gameShocksOn } = await import(R + '/utils/shockLosses.ts');
const LINES = ['WC', 'GL', 'Property'];
const rateOf = (r: any) => r.finalRatePer100 ?? r.totalMemberCharge / Math.max(r.activeExposure * 10_000, 1);
const out: any = { tag: TAG, mode: MODE, floor: P.PRE_GAME_MARGIN_FLOOR, bounds: P.OPENING_PREMIUM_TO_SURPLUS_BOUNDS, scenarios: {} };
for (let n = 1; n <= N; n++) {
  (globalThis as any).__RI.pg = {};
  let gs: any, shocks: boolean;
  if (MODE === 'hosted') {
    const built = buildTeamGame({ seed: String(n), yearCount: YEARS, startingYear: 2027, eventName: 'P', poolName: 'P',
      shocks: [], developmentLevels: { WC: 'Low', GL: 'Low', Property: 'Low' } } as any, LINES);
    gs = built.gameState;
    shocks = gameShocksOn(gs.setup, gs.instance);
  } else {
    const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: YEARS, startingYear: 2027, instanceId: String(n), activeLines: LINES } as any);
    shocks = gameShocksOn(setup, instance);
    const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
    gs = W.openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [],
      currentDecisions: defaultDecisionSet(1, shocks), priorHistory, earlyPreGameHistory } as any);
  }
  const pg = JSON.parse(JSON.stringify((globalThis as any).__RI.pg));
  const s: any = {};
  const preLast = gs.priorHistory[gs.priorHistory.length - 1];
  for (const l of LINES) {
    const y0 = gs.priorHistory.find((r: any) => r.yearNumber === 0).byLine[l];
    const ls = gs.poolState.lines[l];
    const premium0 = openingYear1Premium(gs.instance, l, ls, y0, shocks);
    s[l] = { margin: y0.decisions.fundingCushion, designedRaw: pg[l]?.designedRaw, guard: pg[l]?.guard,
      ps0: premium0 / ls.surplus, rate0: rateOf(preLast.byLine[l]) };
  }
  for (let y = 1; y <= YEARS; y++) {
    const played = W.playWorldsYear(gs, defaultDecisionSet(y, shocks));
    const settled = W.settleWorldsYear(gs, played, LINES);
    if (y === 1) for (const l of LINES) {
      const r = settled.result.byLine[l];
      Object.assign(s[l], { rate1: rateOf(r), admin1: r.adminExpense, opex1: r.operatingExpense, pp1: r.newPurePremiumPer100,
        charge1: r.totalMemberCharge, reins1: r.reinsuranceCost });
    }
    gs = { ...gs, ...W.commitSettledYear(gs, settled), currentYearNumber: y + 1 };
    if (y === YEARS) for (const l of LINES) {
      const st = ST.buildAnnualStatement(gs, l, y);
      Object.assign(s[l], { cr: ST.topCombinedRatio(st), surplus: ST.topSurplus(st) });
    }
  }
  out.scenarios[n] = s;
  console.error(`${TAG} ${MODE} scenario ${n} done`);
}
console.log(JSON.stringify(out));
