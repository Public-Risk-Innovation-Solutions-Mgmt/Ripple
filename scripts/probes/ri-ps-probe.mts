// RESERVE INFLATION, PER-LINE SETTINGS, AND RE-CENTRED SCENARIO TARGETS —
// read-only probe. Every change is made HERE: the branch's src is copied into
// the scratchpad and patched below; the worktree is untouched.
//
//   TAG       copy name
//   NYS       years of inflation priced in, per line   e.g. WC:2,GL:1,Property:2
//   PCS       profit and contingency, per line         e.g. WC:0.03,GL:0,Property:0
//   RANGE     thinnest:richest target ratios            e.g. 3.0:2.0 (unset = shipped 1.7:1.2)
//   EXPBASE   PRE_GAME_EXPERIENCE_BASE                  (unset = shipped 1.5)
//   BOUNDS    opening guardrails min:max               (unset = shipped 1.0:3.0)
//   CAP       paid-in capital, per line, $M             e.g. WC:8,GL:8,Property:9 (unset = shipped)
//   YEARS     played years (0 = the pre-game only)
//   N         scenarios (1..N)
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
const WT = process.env.WT!, TAG = process.env.TAG!;
const perLine = (s: string | undefined) => Object.fromEntries((s ?? '').split(',').filter(Boolean).map(x => { const [k, v] = x.split(':'); return [k, Number(v)]; }));
const NY = perLine(process.env.NYS), PC = perLine(process.env.PCS), CAP = perLine(process.env.CAP);
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
const TREND: Record<string, number> = { WC: 0.04, GL: 0.08, Property: 0.05 };
// Reserve inflation, booked as prior-year development on every open accident year.
patch('utils/simulationEngine.ts', '    lineShocks?.rRate ?? 0,', `    (lineShocks?.rRate ?? 0) + (${G}?.rate?.[line] ?? 0),`);
// Priced in for the first NY[line] years; later inflation is left to experience.
patch('utils/newPurePremium.ts', '    const developed = groundUpPaid * ldf;',
  `    const developed = groundUpPaid * ldf * (${G}?.remaining?.(line, ageMonths / 12) ?? 1);`);
patch('utils/newPurePremium.ts',
  'expectedLossBreakdown(line, exposure, pricingYear, undefined, bookRisk).ordinary / Math.max(exposure * 10_000, 1) + load, load);',
  `expectedLossBreakdown(line, exposure, pricingYear, undefined, bookRisk).ordinary * (${G}?.remaining?.(line, 1) ?? 1) / Math.max(exposure * 10_000, 1) + load, load);`);
// Contingency per line.
patch('utils/linePricing.ts', '  const divisor = expenseDivisor(riskControlPct);', `  const divisor = 1 - riskControlPct - (${G}.pc[line] ?? 0);`);
patch('utils/linePricing.ts', '  const contingencyPer100 = loadedBase * PROFIT_AND_CONTINGENCY_OF_RATE;', `  const contingencyPer100 = loadedBase * (${G}.pc[line] ?? 0);`);
// Scenario targets, experience base, paid-in capital.
if (process.env.RANGE) {
  const [t, r] = process.env.RANGE.split(':').map(Number);
  patch('data/pricingParameters.ts', 'export const SCENARIO_RATIO_RANGE = { thinnest: 1.7, richest: 1.2 } as const;',
    `export const SCENARIO_RATIO_RANGE = { thinnest: ${t}, richest: ${r} } as const;`);
}
if (process.env.BOUNDS) {
  const [lo, hi] = process.env.BOUNDS.split(':').map(Number);
  patch('data/pricingParameters.ts', 'export const OPENING_PREMIUM_TO_SURPLUS_BOUNDS = { min: 1.0, max: 3.0 } as const;',
    `export const OPENING_PREMIUM_TO_SURPLUS_BOUNDS = { min: ${lo}, max: ${hi} } as const;`);
}
if (process.env.EXPBASE) patch('data/pricingParameters.ts', 'export const PRE_GAME_EXPERIENCE_BASE = 1.5;', `export const PRE_GAME_EXPERIENCE_BASE = ${process.env.EXPBASE};`);
if (process.env.CAP) patch('data/pricingParameters.ts',
  'export const STARTING_CAPITAL: PerLine<number> = { WC: 12_500_000, GL: 12_500_000, Property: 17_500_000 };',
  `export const STARTING_CAPITAL: PerLine<number> = { WC: ${CAP.WC * 1e6}, GL: ${CAP.GL * 1e6}, Property: ${CAP.Property * 1e6} };`);
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
const PO = await import(R + '/utils/payoutPattern.ts');
const DA = await import(R + '/data/defaultAssumptions.ts');
const pattern = (DA as any).LINE_PAYOUT_PATTERN ?? (PO as any).LINE_PAYOUT_PATTERN;
// What a year's claims will still pick up from the end of year k, to year NY: Π_{k≤j≤NY} (1 + trend × unpaid share at j).
const remaining = (line: string, k: number) => {
  let f = 1;
  for (let j = Math.max(1, Math.round(k)); j <= (NY[line] ?? 0); j++) f *= 1 + TREND[line] * PO.unpaidShare(pattern[line], j);
  return f;
};
(globalThis as any).__RI = { rate: TREND, remaining, pc: PC };
const P = await import(R + '/data/pricingParameters.ts');
const { openSoloInstance } = await import(R + '/utils/soloGame.ts');
const { runPriorHistory, openingYear1Premium } = await import(R + '/utils/priorHistoryEngine.ts');
const { defaultDecisionSet } = await import(R + '/utils/decisionDefaults.ts');
const W = await import(R + '/utils/worlds.ts');
const ST = await import(R + '/utils/resultsStatement.ts');
const { gameShocksOn } = await import(R + '/utils/shockLosses.ts');
const LINES = ['WC', 'GL', 'Property'];
const out: any = { tag: TAG, ny: NY, pc: PC, capital: P.STARTING_CAPITAL, range: P.SCENARIO_RATIO_RANGE, expBase: P.PRE_GAME_EXPERIENCE_BASE,
  floor: P.PRE_GAME_MARGIN_FLOOR, bounds: P.OPENING_PREMIUM_TO_SURPLUS_BOUNDS,
  multiplier: Object.fromEntries(LINES.map(l => [l, remaining(l, 1)])), scenarios: {} };
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
    const pre = [...earlyPreGameHistory, ...priorHistory].map((r: any) => r.byLine[l]?.endingSurplus).filter((x: any) => x !== undefined);
    s[l] = { target: P.SCENARIO_PREMIUM_TO_SURPLUS[n], margin: y0.decisions.fundingCushion, designedRaw: pg[l]?.designedRaw, guard: pg[l]?.guard,
      rate0: y0.finalRatePer100, premium0, surplus0: ls.surplus, ps0: premium0 / ls.surplus, preMin: Math.min(...pre),
      status0: y0.capitalAdequacyStatus, ecr0: y0.excessCapitalRatio, y0Surplus: y0.endingSurplus };
  }
  if (YEARS > 0) {
    let gs: any = W.openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as any);
    for (let y = 1; y <= YEARS; y++) {
      gs = { ...gs, ...W.commitSettledYear(gs, W.settleWorldsYear(gs, W.playWorldsYear(gs, defaultDecisionSet(y)), LINES)), currentYearNumber: y + 1 };
      if (y === 5 || y === 10) for (const l of LINES) {
        const st = ST.buildAnnualStatement(gs, l, y);
        Object.assign(s[l], { [`ccr${y}`]: ST.topCombinedRatio(st), [`surplus${y}`]: ST.topSurplus(st) });
      }
    }
    for (const l of LINES) {
      s[l].rate1 = gs.lockedResults[0].byLine[l].finalRatePer100;
      s[l].surplusPath = gs.lockedResults.map((r: any) => r.byLine[l].endingSurplus);
      s[l].status = gs.lockedResults.map((r: any) => r.byLine[l].capitalAdequacyStatus);
      if (n === 1) s[l].ay2027 = (gs.poolState.lines[l].reserveDevelopment ?? []).find((r: any) => r.yearNumber === 1)?.ultimateByValuation;
    }
  }
  out.scenarios[n] = s;
  console.error(`${TAG} scenario ${n} done`);
}
console.log(JSON.stringify(out));
