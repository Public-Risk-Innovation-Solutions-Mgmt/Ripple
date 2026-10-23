// RESERVE INFLATION, PER-LINE SETTINGS, AND RE-CENTRED SCENARIO TARGETS —
// read-only probe. Every change is made HERE: the branch's src is copied into
// the scratchpad and patched below; the worktree is untouched.
//
//   TAG       copy name
//   NYS       years of inflation priced in, per line   e.g. WC:2,GL:1,Property:2
//   PCS       profit and contingency, per line         e.g. WC:0.03,GL:0,Property:0
//   RANGES    per line thinnest:richest target ratios   e.g. WC:3.0:1.5,GL:2.6:1.4,Property:1.7:1.2
//             (each line's pre-game experience base is its range's midpoint)
//   BOUNDS    opening guardrails min:max               (unset = shipped 1.0:3.0)
//   CAP       paid-in capital, per line, $M             e.g. WC:8,GL:8,Property:9 (unset = shipped)
//   GROWTH    pre-game book growth a year (0 = frozen, as shipped): the opening book in a seeded
//             order; 2021 holds the first 1/(1+g)^5 of its exposure, each later year writes the
//             next units in as new business (first-year penalty as in play); 2026 holds it all
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
const RANGES: Record<string, [number, number]> = Object.fromEntries((process.env.RANGES ?? '').split(',').filter(Boolean)
  .map(x => { const [l, t, r] = x.split(':'); return [l, [Number(t), Number(r)]]; }));
// Each line's own target and pre-game experience multiple, by scenario.
patch('utils/priorHistoryEngine.ts', '  const ratio = SCENARIO_PREMIUM_TO_SURPLUS[scenarioOf(instance)];',
  `  const ratio = ${G}.ratio(line, scenarioOf(instance));`);
for (let i = 0; i < 2; i++) patch('utils/simulationEngine.ts', i === 0
  ? '        newUnits, unitPenalty, preGameLossFactor(instance, yearNumber), ctx.flatPreGame)'
  : '        preGameLossFactor(instance, yearNumber), ctx.flatPreGame);',
  i === 0
  ? `        newUnits, unitPenalty, (yearNumber <= 0 && instance.scenario !== undefined ? ${G}.lossMult(line, instance.scenario) : 1), ctx.flatPreGame)`
  : `        (yearNumber <= 0 && instance.scenario !== undefined ? ${G}.lossMult(line, instance.scenario) : 1), ctx.flatPreGame);`);
if (process.env.BOUNDS) {
  const [lo, hi] = process.env.BOUNDS.split(':').map(Number);
  patch('data/pricingParameters.ts', 'export const OPENING_PREMIUM_TO_SURPLUS_BOUNDS = { min: 1.0, max: 3.0 } as const;',
    `export const OPENING_PREMIUM_TO_SURPLUS_BOUNDS = { min: ${lo}, max: ${hi} } as const;`);
}
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

const GROWTH = Number(process.env.GROWTH ?? 0);
if (GROWTH > 0) patch('utils/bookUnderwriting.ts', '  if (frozen) {',
  `  if (frozen && ${G}?.growthMove && yearNumber <= 0) return ${G}.growthMove({ line, marketSeed, market, base, yearNumber,
    penaltyFactor: newBusinessPenaltyFactor(decisions.newBusinessRejection), emptyLedger });
  if (frozen) {`);
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
const ratio = (line: string, n: number) => {
  const [t, r] = RANGES[line], k = P.SCENARIOS_THIN_TO_RICH.indexOf(n);
  return t - k * (t - r) / (P.SCENARIO_COUNT - 1);
};
const lossMult = (line: string, n: number) => 1 + (1 - ((RANGES[line][0] + RANGES[line][1]) / 2) / ratio(line, n)) * P.PRE_GAME_EXPERIENCE_WEIGHT;
Object.assign((globalThis as any).__RI, { ratio, lossMult });
const PH = await import(R + '/utils/priorHistoryEngine.ts');
const FIRST = -(PH.PRE_GAME_DEPTH - 1);
if (GROWTH > 0) {
  const BU = await import(R + '/utils/bookUnits.ts');
  const RN = await import(R + '/utils/random.ts');
  const EPS = 1e-9;
  const memo = new Map<string, Map<number, number>>();
  // The share of each opening-book unit held in pre-game year y.
  const sharesAt = (seed: number, line: string, y: number) => {
    const k = `${seed}|${line}|${y}`;
    if (memo.has(k)) return memo.get(k)!;
    const market = BU.marketUnits(seed, line as any);
    const order = BU.openingBookUnits(seed, line as any);
    const rng = RN.deriveSubRng(seed, 0, `pregame_growth_${line}`);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const full = order.reduce((a: number, i: number) => a + market[i].size, 0);
    const out = new Map<number, number>();
    if (y >= 0) for (const i of order) out.set(i, 1);
    else {
      const target = full * Math.pow(1 + GROWTH, y);
      let taken = 0;
      for (const i of order) {
        if (taken >= target - EPS) break;
        const part = Math.min(1, (target - taken) / market[i].size);
        out.set(i, part); taken += market[i].size * part;
      }
    }
    memo.set(k, out);
    return out;
  };
  (globalThis as any).__RI.growthMove = ({ line, marketSeed, market, base, yearNumber, penaltyFactor, emptyLedger }: any) => {
    const now = sharesAt(marketSeed, line, yearNumber);
    const prev = yearNumber > FIRST ? sharesAt(marketSeed, line, yearNumber - 1) : null;
    const size = (m: Map<number, number>) => [...m].reduce((a, [i, sh]) => a + market[i].size * sh, 0);
    const writtenUnits = prev ? [...now.keys()].filter(i => now.get(i)! > (prev.get(i) ?? 0) + EPS).sort((a, b) => a - b) : [];
    const written = prev ? writtenUnits.reduce((a, i) => a + market[i].size * (now.get(i)! - (prev.get(i) ?? 0)), 0) : 0;
    const after = size(now), before = prev ? size(prev) : after;
    const ledger = emptyLedger();
    const isNew = new Set(writtenUnits);
    for (const [i, sh] of now) {
      const k = String(i);
      if (sh < 1 - EPS) ledger.share[k] = sh;
      const j = isNew.has(i) ? yearNumber : base.joined[k];
      if (j !== undefined) ledger.joined[k] = j;
      if (base.history[k]) ledger.history[k] = base.history[k];
    }
    ((globalThis as any).__RI.penalties ??= new Set()).add(penaltyFactor);
    return { before, renewedOff: 0, withdrawn: 0, written, after, applied: written, penaltyFactor,
      newShare: after > 0 ? written / after : 0, afterUnits: [...now.keys()].sort((a, b) => a - b), writtenUnits,
      declinedUnits: [], withdrawnUnits: [], ledger };
  };
}
const { openSoloInstance } = await import(R + '/utils/soloGame.ts');
const { runPriorHistory, openingYear1Premium } = PH;
const { defaultDecisionSet } = await import(R + '/utils/decisionDefaults.ts');
const W = await import(R + '/utils/worlds.ts');
const ST = await import(R + '/utils/resultsStatement.ts');
const { gameShocksOn } = await import(R + '/utils/shockLosses.ts');
const LINES = ['WC', 'GL', 'Property'];
const out: any = { growth: GROWTH, firstPreGameYear: FIRST, tag: TAG, ny: NY, pc: PC, capital: P.STARTING_CAPITAL, ranges: RANGES,
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
    const preRows = [...earlyPreGameHistory, ...priorHistory].filter((r: any) => r.byLine[l]);
    const pre = preRows.map((r: any) => r.byLine[l].endingSurplus);
    const prePath = preRows.map((r: any) => [r.yearNumber, r.byLine[l].endingSurplus, r.byLine[l].totalMemberCharge, r.byLine[l].capitalAdequacyStatus, r.byLine[l].netIncurredLoss, r.byLine[l].billedExposure ?? r.byLine[l].activeExposure]);
    s[l] = { target: ratio(l, n), lossMult: lossMult(l, n), prePath, reserve0: ls.netUnpaidReserve, margin: y0.decisions.fundingCushion, designedRaw: pg[l]?.designedRaw, guard: pg[l]?.guard,
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
out.penalties = [...((globalThis as any).__RI.penalties ?? [])];
console.log(JSON.stringify(out));
