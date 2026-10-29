// ============================================================================
// THE DIVIDEND AND THE ASSESSMENT, IN DOLLARS (wip/dividends-in-dollars;
// utils/dividendAssessment.ts).
//
//   npx tsx scripts/diagnostics/dividend-dollars-check.ts
//
// One game, scenario 16, all three lines, two years at the defaults; then the
// third year is played from that same state several ways and every world's
// ending surplus compared with the year played at no dividend or assessment.
//
// 1. AN ASSESSMENT OF $X MOVES SURPLUS UP BY EXACTLY $X, in every world and on
//    the averaged row; a DIVIDEND OF $X within the surplus moves it DOWN by
//    exactly $X. Nothing else on the line moves with it: premium, losses,
//    expenses and investment income are those of the year without.
// 2. A DIVIDEND ABOVE THE SURPLUS AVAILABLE is paid only up to it: the line's
//    surplus falls by its opening surplus and no more.
// 3. A POOL WITH ZERO SURPLUS CAN ASSESS, NOT PAY A DIVIDEND: with the line's
//    opening surplus at $0 in every world, $X assessed is charged in full and
//    moves surplus by $X; $X of dividend pays nothing.
// 4. A POOL WITH NEGATIVE SURPLUS CAN ASSESS, NOT PAY A DIVIDEND: with the line
//    carrying a negative surplus in (the dividend blocked), the same.
// 5. THE SLIDER: 31 notches, -$15M to +$15M, $1M each, zero at the centre — the
//    notches it had as -15% to +15% in 1% steps.
//
// Each section has a CONTROL that breaks what it guards and must fail.
// ============================================================================

import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { DIVIDEND_ASSESSMENT_RANGE } from '../../src/data/pricingParameters';
import { SLIDER_RANGES } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const L: CoverageLine = 'GL';
const failures: string[] = [];
const check = (problems: string[], label: string, detail = '') => {
  if (problems.length) failures.push(label);
  console.log(`  ${problems.length ? 'FAIL' : 'OK  '}  ${label}${detail ? `  — ${detail}` : ''}`);
  for (const p of problems.slice(0, 5)) console.log(`          ${p}`);
};
const control = (label: string, section: () => string[]) => {
  const problems = section();
  check(problems.length > 0 ? [] : ['the section passed with the thing it guards broken'], `  control: ${label}`,
    `${problems.length} problem(s) when broken`);
};

// ---- the game: two years at the defaults ------------------------------------
const settings = { poolName: 'D', gameLength: 5, startingYear: 2027, instanceId: '16', activeLines: LINES } as GameSetupSettings;
const { setup, instance } = openSoloInstance(settings);
const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
let base: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState,
  lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory });
for (let y = 1; y <= 2; y++) {
  const played = playWorldsYear(base, defaultDecisionSet(y));
  base = { ...base, ...commitSettledYear(base, settleWorldsYear(base, played, [])), currentYearNumber: y + 1 };
}
const Y = 3;

/** Year 3 played from `gs`, the line given `amounts`; each world's row and the averaged one. */
function play(gs: GameState, amounts: { dividendAmount?: number; assessmentAmount?: number }) {
  const d = defaultDecisionSet(Y);
  const decisions: DecisionSet = { ...d, byLine: { ...d.byLine, [L]: { ...d.byLine[L], ...amounts } } };
  const played = playWorldsYear(gs, decisions);
  const settled = settleWorldsYear(gs, played, []);
  return { worlds: played.perWorld.map(p => p.result.byLine[L]), avg: settled.result.byLine[L] };
}

/** A copy of the state with the line's opening surplus set in every world (and, when below zero, carried in so the dividend is blocked). */
function withSurplus(gs: GameState, surplus: number): GameState {
  const clone = structuredClone(gs);
  for (const w of clone.worlds ?? []) {
    w.poolState.lines[L].surplus = surplus;
    const last = w.lockedResults[w.lockedResults.length - 1];
    if (last) last.byLine[L].endingSurplus = surplus;
  }
  clone.poolState.lines[L].surplus = surplus;
  const last = clone.lockedResults[clone.lockedResults.length - 1];
  if (last) last.byLine[L].endingSurplus = surplus;
  return clone;
}

const X = 3_000_000;
const zero = play(base, {});
const near = (a: number, b: number) => Math.abs(a - b) <= 0.01;
const UNMOVED: (keyof LineResultSet)[] = ['totalMemberCharge', 'grossUltimateLoss', 'netIncurredLoss', 'operatingExpense', 'laeIncurred', 'investmentIncome'];

/** Every world's ending surplus moved by exactly `by` against the year without, and nothing else on the line moved. */
function movedBy(run: ReturnType<typeof play>, against: ReturnType<typeof play>, by: number, what: string): string[] {
  const out: string[] = [];
  run.worlds.forEach((r, i) => {
    const dS = r.endingSurplus - against.worlds[i].endingSurplus;
    if (!near(dS, by)) out.push(`${what}: world ${i + 1} surplus moved ${dS.toFixed(2)}, not ${by}`);
    for (const k of UNMOVED) if (!near(r[k] as number, against.worlds[i][k] as number)) out.push(`${what}: world ${i + 1} ${k} moved`);
  });
  if (!near(run.avg.endingSurplus - against.avg.endingSurplus, by)) out.push(`${what}: the averaged row moved ${(run.avg.endingSurplus - against.avg.endingSurplus).toFixed(2)}, not ${by}`);
  return out;
}

// ---- 1. $X MOVES SURPLUS BY EXACTLY $X ----------------------------------------
const assess = play(base, { assessmentAmount: X });
const DIV = 2_000_000;
const minOpening = Math.min(...(base.worlds ?? []).map(w => w.poolState.lines[L].surplus));
const divRun = play(base, { dividendAmount: DIV });
function sectionExact(assessRun = assess, assessBy = X): string[] {
  const out = movedBy(assessRun, zero, assessBy, `assessment $${X / 1e6}M`);
  assessRun.worlds.forEach((r, i) => { if (!near(r.assessments, X)) out.push(`world ${i + 1}: assessments ${r.assessments}, not ${X}`); });
  if (!(minOpening > DIV)) out.push(`every world's opening surplus must exceed the $${DIV / 1e6}M dividend to test it (lowest ${minOpening.toFixed(0)})`);
  out.push(...movedBy(divRun, zero, -DIV, `dividend $${DIV / 1e6}M`));
  return out;
}
check(sectionExact(), `1. an assessment of $${X / 1e6}M moves every world's surplus up by exactly $${X / 1e6}M, a dividend of $${DIV / 1e6}M down by exactly $${DIV / 1e6}M; nothing else moves`);
control('the assessment compared at $1M more than was charged', () => sectionExact(assess, X + 1_000_000));
control('a $4M assessment run compared as if it were $3M', () => sectionExact(play(base, { assessmentAmount: X + 1_000_000 }), X));

// ---- 2. A DIVIDEND ABOVE THE SURPLUS AVAILABLE ------------------------------
const BIG = 15_000_000;
const lowSurplus = withSurplus(base, 1_500_000);
const lowZero = play(lowSurplus, {});
const lowBig = play(lowSurplus, { dividendAmount: BIG });
function sectionCap(run = lowBig): string[] {
  const out: string[] = [];
  run.worlds.forEach((r, i) => { if (!near(r.dividends, 1_500_000)) out.push(`world ${i + 1}: paid ${r.dividends}, the surplus available is 1500000`); });
  out.push(...movedBy(run, lowZero, -1_500_000, `$${BIG / 1e6}M dividend on $1.5M of surplus`));
  return out;
}
check(sectionCap(), `2. a $${BIG / 1e6}M dividend on $1.5M of surplus pays $1.5M — limited to the surplus available`);
control('the dividend paid in full past the surplus (a $15M dividend on ample surplus)', () => sectionCap(play(withSurplus(base, 50_000_000), { dividendAmount: BIG })));

// ---- 3 and 4. ZERO AND NEGATIVE SURPLUS: ASSESS, NO DIVIDEND ------------------
function sectionBroke(opening: number, gsFor: GameState = withSurplus(base, opening)): string[] {
  const out: string[] = [];
  const none = play(gsFor, {});
  const a = play(gsFor, { assessmentAmount: X });
  const dv = play(gsFor, { dividendAmount: X });
  a.worlds.forEach((r, i) => { if (!near(r.assessments, X)) out.push(`opening ${opening}: world ${i + 1} assessed ${r.assessments}, not ${X}`); });
  out.push(...movedBy(a, none, X, `opening ${opening}: assessment`));
  dv.worlds.forEach((r, i) => { if (r.dividends !== 0) out.push(`opening ${opening}: world ${i + 1} paid a dividend of ${r.dividends}`); });
  out.push(...movedBy(dv, none, 0, `opening ${opening}: dividend`));
  return out;
}
check(sectionBroke(0), `3. a pool at zero surplus: $${X / 1e6}M assessed is charged in full and moves surplus by $${X / 1e6}M; a dividend pays nothing`);
control('the pool given surplus (a dividend then pays)', () => sectionBroke(0, withSurplus(base, 20_000_000)));
check(sectionBroke(-5_000_000), `4. a pool carrying a negative surplus in: $${X / 1e6}M assessed in full; a dividend pays nothing`);
control('the pool given surplus (a dividend then pays)', () => sectionBroke(-5_000_000, withSurplus(base, 20_000_000)));

// ---- 5. THE SLIDER ------------------------------------------------------------
function sectionSlider(r = SLIDER_RANGES.dividendAssessment): string[] {
  const out: string[] = [];
  const notches = Math.round((r.max - r.min) / r.step) + 1;
  if (notches !== 31) out.push(`${notches} notches, not 31`);
  if (r.step !== 1_000_000) out.push(`step ${r.step}, not $1M`);
  if (r.min !== -15_000_000 || r.max !== 15_000_000 || r.default !== 0) out.push(`range ${r.min} to ${r.max}, default ${r.default}`);
  if (r !== DIVIDEND_ASSESSMENT_RANGE) out.push('the Decisions page\'s range is not the parameter');
  if (SLIDER_RANGES.dividendAmount.max !== r.max || SLIDER_RANGES.assessmentAmount.max !== -r.min) out.push('the engine fields\' ranges do not match the control');
  return out;
}
check(sectionSlider(), '5. the slider: 31 notches, -$15M to +$15M, $1M each, zero at the centre');
control('the old percentage range', () => sectionSlider({ min: -0.15, max: 0.15, step: 0.01, default: 0 }));

console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS');
process.exit(failures.length ? 1 : 0);
