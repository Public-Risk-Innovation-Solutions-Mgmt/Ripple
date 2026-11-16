// THE ALAE LOAD, MEASURED BEFORE AND AFTER (wip/pricing-alae-load) — the twenty
// scenarios, five played years, the default decisions, per line: every
// pre-game year's rate (2021-2026), the opening (surplus, year-1 premium at
// Expected and their ratio, as scenario-opening-drift-check reads it), the
// 2027 rate and its change on 2026's, the ALAE load 2027 was priced at, the
// five-year combined ratio (the Annual Statement's) and surplus at year 5.
// A probe, not a gate, and it patches nothing: it imports WT's src, so the same
// file runs on multiplayer's head (the control) and on the change.
//
//   WT=<repo> MODE=single|hosted N=20 YEARS=5 npx tsx scripts/probes/alae-load-probe.mts > out.json
//
//   MODE=single   openSoloInstance: single player as the build ships it.
//   MODE=hosted   buildTeamGame — the room's own path — every line at adverse
//                 development Low, no shocks scheduled.
const WT = process.env.WT!, MODE = process.env.MODE ?? 'single';
const YEARS = Number(process.env.YEARS ?? 5), N = Number(process.env.N ?? 20);
const R = `${WT}/src`;
const { openSoloInstance } = await import(R + '/utils/soloGame.ts');
const { runPriorHistory, openingYear1Premium } = await import(R + '/utils/priorHistoryEngine.ts');
const { buildTeamGame } = await import(R + '/session/client/buildGame.ts');
const { defaultDecisionSet } = await import(R + '/utils/decisionDefaults.ts');
const W = await import(R + '/utils/worlds.ts');
const ST = await import(R + '/utils/resultsStatement.ts');
const { gameShocksOn } = await import(R + '/utils/shockLosses.ts');
const LINES = ['WC', 'GL', 'Property'];
const rateOf = (r: any) => r.finalRatePer100 ?? r.totalMemberCharge / Math.max(r.activeExposure * 10_000, 1);
const out: any = { mode: MODE, scenarios: {} };
for (let n = 1; n <= N; n++) {
  let gs: any, shocks: boolean;
  if (MODE === 'hosted') {
    gs = buildTeamGame({ seed: String(n), yearCount: YEARS, startingYear: 2027, eventName: 'P', poolName: 'P',
      shocks: [], developmentLevels: { WC: 'Low', GL: 'Low', Property: 'Low' } } as any, LINES).gameState;
    shocks = gameShocksOn(gs.setup, gs.instance);
  } else {
    const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: YEARS, startingYear: 2027, instanceId: String(n), activeLines: LINES } as any);
    shocks = gameShocksOn(setup, instance);
    const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
    gs = W.openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [],
      currentDecisions: defaultDecisionSet(1, shocks), priorHistory, earlyPreGameHistory } as any);
  }
  const s: any = {};
  const pre = [...(gs.earlyPreGameHistory ?? []), ...gs.priorHistory];
  const last = gs.priorHistory[gs.priorHistory.length - 1];
  for (const l of LINES) {
    const ls = gs.poolState.lines[l];
    const premium0 = openingYear1Premium(gs.instance, l, ls, last.byLine[l], shocks);
    s[l] = { preRates: pre.map((r: any) => [r.yearNumber, rateOf(r.byLine[l]), r.byLine[l].pricingAlaeRatio ?? null]),
      surplus0: ls.surplus, premium0, ps0: premium0 / ls.surplus, rate0: rateOf(last.byLine[l]) };
  }
  for (let y = 1; y <= YEARS; y++) {
    const played = W.playWorldsYear(gs, defaultDecisionSet(y, shocks));
    const settled = W.settleWorldsYear(gs, played, LINES);
    if (y === 1) for (const l of LINES) {
      const r = settled.result.byLine[l];
      Object.assign(s[l], { rate1: rateOf(r), alaeLoad1: r.pricingAlaeRatio ?? null, pp1: r.newPurePremiumPer100 });
    }
    gs = { ...gs, ...W.commitSettledYear(gs, settled), currentYearNumber: y + 1 };
    if (y === YEARS) for (const l of LINES) {
      const st = ST.buildAnnualStatement(gs, l, y);
      Object.assign(s[l], { cr: ST.topCombinedRatio(st), surplus: ST.topSurplus(st) });
    }
  }
  out.scenarios[n] = s;
  console.error(`${MODE} scenario ${n} done`);
}
console.log(JSON.stringify(out));
