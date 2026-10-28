// ============================================================================
// RISK CONTROL — the slider per line per year (wip/risk-control;
// RISK_CONTROL_CHARGE and RISK_CONTROL_CUT in pricingParameters.ts,
// utils/riskControl.ts).
//
//   npx tsx scripts/diagnostics/risk-control-check.ts
//
// 1. THE CHARGE IS IN THE RATE AND THE COST IS THE CHARGE. Rate = (pure premium
//    x CLF / (1 - admin share)) x (1 + slider) + reinsurance at every setting,
//    0% to 5%; the pool premium and admin do not move with the slider (admin is
//    not taken on the charge). In a played game the charge in (the member
//    charge less pool premium, admin and reinsurance) is the cost out
//    (riskControlInvestment, Other Admin Expense), every line and year, and
//    the expense ratios carry it (expected combined ratio 1.0000 at Expected).
// 2. THE CUT IS SHARED. The draw z is the game's: in a single-player game every
//    one of the hundred worlds books the same m, z and cut every line-year; a
//    hosted team on the same scenario draws the same z; a second player at
//    another setting draws the same z, and in the first year (the same book
//    and rate before risk control) m in proportion to the slider.
// 3. IT NEVER TOUCHES SHOCKS OR OLDER YEARS. A game with shocks in force in
//    year 3 played twice, at 0% and with the slider at 5% in year 3 only: years
//    1 and 2 are identical; in year 3 every world's shock surge dollars, event
//    large claims and routine large claims are identical, its normal losses
//    fall by exactly the cut, and every older accident year's ledger
//    (ultimate and paid at every valuation) and the year's development on
//    them are identical.
// 4. NEUTRAL ON AVERAGE. (a) Sizing: in every line-year of the played games, m
//    x expected normal losses x (1 + expected ALAE + ULAE) is the charge. (b)
//    The draw over 2,000 game seeds x 8 years x 3 lines: the mean of max(0, 1 +
//    0.5 z) is 1.0043 (the floor's accepted lift) within four standard
//    errors, about 2.3% of draws floor at zero, and the lines' draws are
//    uncorrelated. (c) Across eight scenarios x six years at 5%: the expected
//    saving at the cuts the engine drew is the cost x the mean cut / m, within
//    four standard errors of 1.0043; the realised losses + LAE saved are within
//    10% of the cost.
// 5. AT 0% NOTHING MOVES. A game at 0% carries no risk control field on any
//    row of any world, books no cost, and charges exactly pool premium + admin
//    + reinsurance; it is byte-identical to the same game with the slider
//    absent from every decision (a save from before the slider). The build
//    against multiplayer's head is measured outside this gate (80 games
//    byte-identical, wip/risk-control's report) and held by value identity.
//
// THE CONTROLS, each must fail: admin taken on the charge (the old divisor);
// the cost not the charge; z drawn off each world's own seed; the cut taken off
// the shocks' dollars; the cut reaching an older accident year; m sized without
// the LAE; the draw biased; the 0% game charged 1% in one year.
// ============================================================================

import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, worldInstance } from '../../src/utils/worlds';
import { buildTeamGame } from '../../src/session/client/buildGame';
import { quoteNewRateStack } from '../../src/utils/linePricing';
import { riskControlDraw, riskControlMeanCut } from '../../src/utils/riskControl';
import { marketSeedOf } from '../../src/utils/bookUnits';
import { laeShares } from '../../src/utils/lossExpense';
import { buildYearWalkthroughs } from '../../src/utils/yearWalkthrough';
import { ADMIN_SHARE_OF_PREMIUM, RISK_CONTROL_CUT, RISK_CONTROL_INCENTIVE_RANGE, SOLO_SHOCKS } from '../../src/data/pricingParameters';
import { SLIDER_RANGES } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const failures: string[] = [];
const check = (problems: string[], label: string, detail = '') => {
  if (problems.length) failures.push(label);
  console.log(`  ${problems.length ? 'FAIL' : 'OK  '}  ${label}${detail ? `  — ${detail}` : ''}`);
  for (const p of problems.slice(0, 5)) console.log(`          ${p}`);
};
const control = (label: string, breakIt: () => () => void, section: () => string[]) => {
  const restore = breakIt();
  let problems: string[];
  try { problems = section(); } finally { restore(); }
  check(problems.length > 0 ? [] : ['the section passed with the thing it guards broken'], `  control: ${label}`,
    `${problems.length} problem(s) when broken`);
};
const near = (a: number, b: number, rel = 1e-9, abs = 1e-6) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);

// ---- the games -------------------------------------------------------------
type Decide = (y: number) => DecisionSet;
const withSlider = (d: DecisionSet, s: number | undefined, lines = LINES): DecisionSet => ({
  ...d, byLine: Object.fromEntries(LINES.map(l => {
    const ld = { ...d.byLine[l] };
    if (lines.includes(l)) { if (s === undefined) delete ld.riskControlIncentivePct; else ld.riskControlIncentivePct = s; }
    return [l, ld];
  })) as DecisionSet['byLine'],
});
const at = (s: number | undefined, years?: number[]): Decide => y => {
  const d = defaultDecisionSet(y);
  return years && !years.includes(y) ? d : withSlider(d, s);
};
function playFrom(gs: GameState, decide: Decide, years: number): GameState {
  for (let y = 1; y <= years; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, decide(y)), [])), currentYearNumber: y + 1 };
  }
  return gs;
}
function soloGame(scenario: string, decide: Decide, years: number, schedule?: { shockId: string; yearNumber: number }[]): GameState {
  const settings = { poolName: 'R', gameLength: Math.max(5, years), startingYear: 2027, instanceId: scenario, activeLines: LINES } as GameSetupSettings;
  const { setup, instance } = openSoloInstance(settings, schedule ? { schedule: schedule as never } : undefined);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  return playFrom(openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState,
    lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory }), decide, years);
}
const teamGame = (scenario: string, decide: Decide, years: number): GameState =>
  playFrom(buildTeamGame({ seed: scenario, yearCount: 5, startingYear: 2027, eventName: 'R', poolName: 'R', shocks: [], priorDevelopment: {} } as never, LINES).gameState, decide, years);
const rowsOf = (gs: GameState): LineResultSet[] => gs.lockedResults.flatMap(r => LINES.map(l => r.byLine[l]));

// ---- 1. THE CHARGE -----------------------------------------------------------
// Off by default; a control sets these to break the rule each guards.
let adminOnCharge = false, costNotCharge = false;
function sectionCharge(G: GameState): string[] {
  const out: string[] = [];
  if (RISK_CONTROL_INCENTIVE_RANGE.min !== 0 || RISK_CONTROL_INCENTIVE_RANGE.max !== 0.05 || RISK_CONTROL_INCENTIVE_RANGE.step !== 0.01
    || RISK_CONTROL_INCENTIVE_RANGE.default !== 0) out.push('the slider is not 0% to 5% in 1% steps, default 0%');
  if (JSON.stringify(SLIDER_RANGES.riskControlIncentivePct) !== JSON.stringify(RISK_CONTROL_INCENTIVE_RANGE)) out.push('the screen\'s slider range is not the parameter\'s');
  for (const l of LINES) {
    const base = { line: l, yearNumber: 1, members: { exposure: 300 }, exposure: 300, groundUpPurePremiumPer100: 2.5, clf: 1.06,
      layersPlaced: [], aggregateStopLevel: 0, reinsuranceOption: 'none', shocks: false } as never as Parameters<typeof quoteNewRateStack>[0];
    const q0 = quoteNewRateStack({ ...base, riskControlPct: 0 });
    for (let k = 0; k <= 5; k++) {
      const rc = k / 100;
      const q = quoteNewRateStack({ ...base, riskControlPct: rc });
      const a = ADMIN_SHARE_OF_PREMIUM[l];
      const before = q.retainedPurePremiumPer100 * q.clf / (adminOnCharge ? 1 - rc - a : 1 - a);
      const want = before * (1 + rc) + q.reinsRatePer100;
      if (!near(q.finalRatePer100, want, 1e-12)) out.push(`${l} ${k}%: rate ${q.finalRatePer100} against (pp x CLF / (1 - admin)) x (1 + slider) + reins ${want}`);
      if (!near(q.riskControlPer100, before * rc, 1e-12)) out.push(`${l} ${k}%: charge ${q.riskControlPer100} against ${before * rc}`);
      if (q.poolPremiumRatePer100 !== q0.poolPremiumRatePer100 || q.adminRatePer100 !== q0.adminRatePer100) out.push(`${l} ${k}%: the pool premium or admin moved with the slider`);
    }
  }
  // The played game: the charge in is the cost out, and the ratios carry it.
  let charged = 0;
  for (const r of rowsOf(G)) {
    const chargeIn = r.totalMemberCharge - r.poolPremium - r.adminExpense - r.reinsuranceCost - r.retainedCoverMargin;
    const costOut = costNotCharge ? r.poolPremium * (r.decisions.riskControlIncentivePct ?? 0) : r.riskControlInvestment;
    if (!near(chargeIn, costOut, 1e-9, 0.01)) out.push(`${r.line} year ${r.yearNumber}: charged ${chargeIn.toFixed(2)}, booked ${costOut.toFixed(2)}`);
    if ((r.decisions.riskControlIncentivePct ?? 0) > 0) charged++;
    const want = (r.adminExpense + r.reinsuranceCost + r.riskControlInvestment) / r.totalMemberCharge;
    if (!near(r.expectedExpenseRatio, want, 1e-9)) out.push(`${r.line} year ${r.yearNumber}: the expected expense ratio leaves risk control out`);
    if (r.selectedFundingCLF === 1 && !near(r.expectedCombinedRatio, 1, 1e-9)) out.push(`${r.line} year ${r.yearNumber}: expected combined ratio ${r.expectedCombinedRatio} at Expected`);
  }
  if (charged === 0) out.push('the game charged no risk control — the section is vacuous');
  return out;
}

// ---- 2. SHARED ---------------------------------------------------------------
let worldSeedDraw = false;
function sectionShared(solo: GameState, team: GameState, other: GameState, sTeam: number, sOther: number): string[] {
  const out: string[] = [];
  const gameSeed = marketSeedOf(solo.instance);
  const y = solo.lockedResults.at(-1)!.yearNumber;
  for (const l of LINES) {
    // Every world: the same m, z and cut (the worlds keep their rows for the latest year).
    const ws = solo.worlds!.map((w, i) => {
      const r = w.lockedResults.find(x => x.yearNumber === y)!.byLine[l];
      const z = worldSeedDraw ? riskControlDraw(worldInstance(solo.instance, i).seed, y, l) : r.riskControlDraw;
      return `${r.riskControlMeanCut}|${z}|${r.riskControlCut}`;
    });
    if (new Set(ws).size !== 1) out.push(`${l} year ${y}: ${new Set(ws).size} different cuts across the ${ws.length} worlds`);
    for (const r of solo.lockedResults) {
      const a = r.byLine[l];
      if (a.riskControlDraw === undefined) { out.push(`${l} year ${r.yearNumber}: no draw recorded`); continue; }
      const z = riskControlDraw(gameSeed, r.yearNumber, l);
      if (a.riskControlDraw !== z) out.push(`${l} year ${r.yearNumber}: z ${a.riskControlDraw}, the game's draw is ${z}`);
      const t = team.lockedResults.find(x => x.yearNumber === r.yearNumber)!.byLine[l];
      if (t.riskControlDraw !== a.riskControlDraw) out.push(`${l} year ${r.yearNumber}: the hosted team drew ${t.riskControlDraw}, single player ${a.riskControlDraw}`);
      const o = other.lockedResults.find(x => x.yearNumber === r.yearNumber)!.byLine[l];
      if (o.riskControlDraw !== a.riskControlDraw) out.push(`${l} year ${r.yearNumber}: the second player drew ${o.riskControlDraw}`);
    }
    // Year 1: the same book and rate before risk control, so m in proportion to the slider.
    const t1 = team.lockedResults[0].byLine[l], o1 = other.lockedResults[0].byLine[l];
    if (!near(o1.riskControlMeanCut! / t1.riskControlMeanCut!, sOther / sTeam, 1e-9)) out.push(`${l} year 1: m ${o1.riskControlMeanCut} at ${sOther} against ${t1.riskControlMeanCut} at ${sTeam}`);
  }
  return out;
}

// ---- 3. NEVER SHOCKS OR OLDER YEARS -------------------------------------------
let cutOnShocks = false, cutOnOlder = false;
const SHOCK_YEAR = 3;
function sectionUntouched(off: GameState, on: GameState): string[] {
  const out: string[] = [];
  for (let y = 1; y < SHOCK_YEAR; y++) {
    const a = off.lockedResults.find(r => r.yearNumber === y), b = on.lockedResults.find(r => r.yearNumber === y);
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`year ${y}: the year before the slider moved`);
  }
  let shockDollars = 0, largeDollars = 0;
  for (const l of LINES) {
    const cut = on.lockedResults.find(r => r.yearNumber === SHOCK_YEAR)!.byLine[l].riskControlCut ?? 0;
    if (!(cut > 0)) out.push(`${l}: no cut in year ${SHOCK_YEAR} — the section is vacuous`);
    off.worlds!.forEach((w, i) => {
      const a = w.lockedResults.find(r => r.yearNumber === SHOCK_YEAR)!.byLine[l].newLossEngine!;
      const b = on.worlds![i].lockedResults.find(r => r.yearNumber === SHOCK_YEAR)!.byLine[l].newLossEngine!;
      // The surge dollars: the uplift on the uncut year, as the engine adds it.
      const normalA = a.ordinaryExpected * a.ordinaryFactor, normalB = b.ordinaryExpected * b.ordinaryFactor;
      const surgeA = a.ordinaryRealised - normalA;
      const surgeB = b.ordinaryRealised - normalB * (1 - cut);
      // Broken: a cut on the whole year, surges included, books the surge at (1 - cut).
      const surgeBooked = cutOnShocks ? surgeB * (1 - cut) : surgeB;
      shockDollars += Math.abs(surgeA); largeDollars += a.shockLarge + a.routineLarge;
      if (!near(surgeBooked, surgeA, 1e-9, 0.01)) out.push(`${l} world ${i + 1}: surge dollars ${surgeBooked} against ${surgeA} at 0%`);
      if (a.shockLarge !== b.shockLarge || a.routineLarge !== b.routineLarge) out.push(`${l} world ${i + 1}: large claims moved`);
      if (a.uplift !== b.uplift) out.push(`${l} world ${i + 1}: the uplift moved`);
      if (normalA !== normalB) out.push(`${l} world ${i + 1}: the normal losses before the cut moved`);
    });
    // Older accident years: every valuation of their ledger rows, and the year's development on them.
    const la = off.poolState.lines[l].reserveDevelopment ?? [], lb = on.poolState.lines[l].reserveDevelopment ?? [];
    for (const ra of la.filter(r => r.yearNumber < SHOCK_YEAR)) {
      const rb = lb.find(r => r.yearNumber === ra.yearNumber);
      const ub = cutOnOlder && rb ? rb.ultimateByValuation.map(u => u * (1 - cut)) : rb?.ultimateByValuation;
      if (!rb || JSON.stringify(ra.ultimateByValuation) !== JSON.stringify(ub) || JSON.stringify(ra.paidByValuation) !== JSON.stringify(rb.paidByValuation)) {
        out.push(`${l}: accident year ${ra.yearNumber}'s ledger moved`);
      }
    }
    const da = off.lockedResults.find(r => r.yearNumber === SHOCK_YEAR)!.byLine[l].priorYearDevelopment;
    const db = on.lockedResults.find(r => r.yearNumber === SHOCK_YEAR)!.byLine[l].priorYearDevelopment;
    if (da !== db) out.push(`${l}: development on older years ${db} against ${da} at 0%`);
  }
  if (!(shockDollars > 0) || !(largeDollars > 0)) out.push(`no surge (${shockDollars}) or no large claims (${largeDollars}) in year ${SHOCK_YEAR} — the section is vacuous`);
  return out;
}

// ---- 4. NEUTRAL ON AVERAGE ----------------------------------------------------
let mWithoutLae = false, drawBias = 0;
const FLOORED_MEAN = 1.0043;   // E[max(0, 1 + 0.5 z)], z ~ N(0, 1): the floor's accepted lift
function sectionSizing(games: GameState[]): string[] {
  const out: string[] = [];
  let n = 0;
  for (const gs of games) {
    for (const r of gs.lockedResults) {
      if (r.yearNumber < 1) continue;
      for (const w of buildYearWalkthroughs(gs, r.yearNumber).filter(x => x.view !== 'pool')) {
        const l = w.view as CoverageLine, a = r.byLine[l];
        if (!(a.riskControlInvestment > 0)) continue;
        const rows = w.stages.find(s => s.key === 'losses')!.rows;
        const v = (label: string) => rows.find(x => x.label === label)!.value as number;
        const expected = v('Expected baseline losses') * v("Underwriting's one-year factor");
        const m = mWithoutLae ? a.riskControlInvestment / expected : riskControlMeanCut(l, a.riskControlInvestment, expected);
        if (!near(m * expected * (1 + laeShares(l).total), a.riskControlInvestment, 1e-9, 0.01) || !near(m, a.riskControlMeanCut!, 1e-9)) {
          out.push(`${l} year ${r.yearNumber}: m ${a.riskControlMeanCut} x expected ${expected.toFixed(0)} x (1 + LAE) is not the charge ${a.riskControlInvestment.toFixed(0)}`);
        }
        n++;
      }
    }
  }
  if (n === 0) out.push('no line-year was charged — the section is vacuous');
  return out;
}
function sectionDraw(): string[] {
  const out: string[] = [];
  const f: number[] = [], zw: number[] = [], zg: number[] = [];
  for (let seed = 1; seed <= 2000; seed++) {
    for (let y = 1; y <= 8; y++) {
      for (const l of LINES) {
        const z = riskControlDraw(seed * 7919, y, l) + drawBias;
        f.push(Math.max(RISK_CONTROL_CUT.floor, 1 + RISK_CONTROL_CUT.sdOfMean * z));
        if (l === 'WC') zw.push(z); if (l === 'GL') zg.push(z);
      }
    }
  }
  const m = mean(f), sd = Math.sqrt(mean(f.map(x => (x - m) ** 2))), se = sd / Math.sqrt(f.length);
  if (Math.abs(m - FLOORED_MEAN) > 4 * se) out.push(`mean cut / m ${m.toFixed(5)} against ${FLOORED_MEAN} (SE ${se.toFixed(5)})`);
  const floored = f.filter(x => x === 0).length / f.length;
  if (Math.abs(floored - 0.0228) > 0.004) out.push(`${(floored * 100).toFixed(2)}% of draws floored, against 2.28%`);
  const mw = mean(zw), mg = mean(zg);
  const corr = mean(zw.map((x, i) => (x - mw) * (zg[i] - mg))) / Math.sqrt(mean(zw.map(x => (x - mw) ** 2)) * mean(zg.map(x => (x - mg) ** 2)));
  if (Math.abs(corr) > 4 / Math.sqrt(zw.length)) out.push(`WC and GL draws correlate at ${corr.toFixed(4)}`);
  return out;
}
function sectionNeutral(games: GameState[]): string[] {
  const out: string[] = [];
  let cost = 0, expectedSaving = 0, saved = 0;
  const ratios: number[] = [];
  for (const gs of games) {
    for (const r of rowsOf(gs)) {
      if (!(r.riskControlInvestment > 0)) continue;
      // Broken: m sized on the charge over the losses alone cuts (1 + LAE) times
      // as deep, so it saves (1 + LAE) times as much, expected and realised.
      const k = mWithoutLae ? 1 + laeShares(r.line as CoverageLine).total : 1;
      const ratio = k * r.riskControlCut! / r.riskControlMeanCut!;
      cost += r.riskControlInvestment; expectedSaving += r.riskControlInvestment * ratio; ratios.push(ratio);
      saved += k * ((r.riskControlLossSaved ?? 0) + (r.riskControlLaeSaved ?? 0));
    }
  }
  const sd = Math.sqrt(mean(ratios.map(x => (x - mean(ratios)) ** 2)));
  const se = sd / Math.sqrt(ratios.length);
  const e = expectedSaving / cost;
  if (Math.abs(e - FLOORED_MEAN) > 4 * se) out.push(`expected saving / cost ${e.toFixed(4)} against ${FLOORED_MEAN} ± ${(4 * se).toFixed(4)} over ${ratios.length} line-years`);
  if (Math.abs(saved / cost - 1) > 0.10) out.push(`realised losses + LAE saved / cost ${(saved / cost).toFixed(4)}`);
  console.log(`          ${ratios.length} line-years: expected saving / cost ${e.toFixed(4)}, realised ${(saved / cost).toFixed(4)}`);
  return out;
}

// ---- 5. AT 0% ------------------------------------------------------------------
const RC_KEYS = ['riskControlMeanCut', 'riskControlDraw', 'riskControlCut', 'riskControlLossSaved', 'riskControlLaeSaved'];
function sectionZero(zero: GameState, absent: GameState): string[] {
  const out: string[] = [];
  const all = [...zero.lockedResults, ...zero.worlds!.flatMap(w => w.lockedResults)];
  for (const r of all) {
    for (const l of LINES) {
      const a = r.byLine[l] as unknown as Record<string, unknown>;
      for (const k of RC_KEYS) if (k in a) out.push(`year ${r.yearNumber} ${l}: ${k} on a 0% row`);
      const b = r.byLine[l];
      if (b.riskControlInvestment !== 0) out.push(`year ${r.yearNumber} ${l}: cost ${b.riskControlInvestment} at 0%`);
      if (b.totalMemberCharge !== b.poolPremium + b.adminExpense + b.reinsuranceCost + b.retainedCoverMargin) out.push(`year ${r.yearNumber} ${l}: charge is not pool + admin + reinsurance at 0%`);
    }
  }
  const strip = (gs: GameState) => JSON.stringify({ r: gs.lockedResults, p: gs.poolState, w: gs.worlds!.map(w => w.lockedResults) },
    (k, v) => (k === 'riskControlIncentivePct' ? undefined : v));
  if (strip(zero) !== strip(absent)) out.push('the 0% game is not byte-identical to the game with the slider absent');
  return out;
}

// ---- run -------------------------------------------------------------------
console.log('risk-control-check\n');
const SC = '16';
const G = soloGame(SC, y => withSlider(defaultDecisionSet(y), y === 1 ? 0.05 : y === 2 ? 0.02 : 0, ['WC', 'GL']), 3);
check(sectionCharge(G), '1. rate = (pure premium x CLF / (1 - admin)) x (1 + slider) + reinsurance, 0% to 5%; the charge in is the cost out every line-year; the expense ratios carry it');
control('admin taken on the charge (the old divisor, 1 - risk control - admin)', () => { adminOnCharge = true; return () => { adminOnCharge = false; }; }, () => sectionCharge(G));
control('the cost booked on the pool premium, not the charge', () => { costNotCharge = true; return () => { costNotCharge = false; }; }, () => sectionCharge(G));

const solo3 = soloGame(SC, at(0.03), 3), team3 = teamGame(SC, at(0.03), 3), team5 = teamGame(SC, at(0.05), 3);
check(sectionShared(solo3, team3, team5, 0.03, 0.05), `2. scenario ${SC}: every world the same m, z and cut; the hosted team and a second player at 5% the same z; year-1 m in proportion to the slider`);
control('z drawn off each world\'s own seed', () => { worldSeedDraw = true; return () => { worldSeedDraw = false; }; }, () => sectionShared(solo3, team3, team5, 0.03, 0.05));

const SCHEDULE = [{ shockId: '#7', yearNumber: SHOCK_YEAR }, { shockId: '#2', yearNumber: SHOCK_YEAR }];
const off = soloGame('9', at(0), SHOCK_YEAR, SCHEDULE), on = soloGame('9', at(0.05, [SHOCK_YEAR]), SHOCK_YEAR, SCHEDULE);
check(sectionUntouched(off, on), `3. shocks in force in year ${SHOCK_YEAR}, the slider at 5% that year only: earlier years identical; surges, event and routine large claims identical in every world; older accident years untouched`);
control('the cut taken off the shocks\' surge dollars too', () => { cutOnShocks = true; return () => { cutOnShocks = false; }; }, () => sectionUntouched(off, on));
control('the cut reaching an older accident year', () => { cutOnOlder = true; return () => { cutOnOlder = false; }; }, () => sectionUntouched(off, on));

SOLO_SHOCKS.enabled = false;
const many = Array.from({ length: 8 }, (_, i) => soloGame(String(i + 1), at(0.05), 6));
SOLO_SHOCKS.enabled = true;
check(sectionSizing([G, solo3, ...many.slice(0, 2)]), '4a. every charged line-year: m x expected normal losses x (1 + expected ALAE + ULAE) is the charge');
control('m sized without the LAE', () => { mWithoutLae = true; return () => { mWithoutLae = false; }; }, () => sectionSizing([G]));
check(sectionDraw(), '4b. the draw over 2,000 seeds x 8 years x 3 lines: mean cut / m 1.0043 (the floor), 2.3% floored, lines uncorrelated');
control('the draw biased by +0.1', () => { drawBias = 0.1; return () => { drawBias = 0; }; }, sectionDraw);
check(sectionNeutral(many), '4c. eight scenarios x six years at 5%: the expected saving at the drawn cuts is the cost x 1.0043; the realised saving within 10% of the cost');
control('m sized without the LAE', () => { mWithoutLae = true; return () => { mWithoutLae = false; }; }, () => sectionNeutral(many));

const zero = soloGame(SC, at(0), 3), absent = soloGame(SC, at(undefined), 3), one = soloGame(SC, y => (y === 2 ? withSlider(defaultDecisionSet(y), 0.01) : defaultDecisionSet(y)), 3);
check(sectionZero(zero, absent), '5. at 0%: no risk control field on any row of any world, no cost, charge = pool + admin + reinsurance; byte-identical to the slider absent');
control('the 0% game charged 1% in year 2', () => () => {}, () => sectionZero(one, absent));

console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS');
process.exit(failures.length ? 1 : 0);
