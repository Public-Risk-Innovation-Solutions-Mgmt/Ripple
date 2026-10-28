// ============================================================================
// SIMPLE UNDERWRITING — THE BRIEF'S FORMULA, ONE YEAR ONLY, 100 EQUAL MEMBERS
// WITH A YEARLY RISK SCORE.
//
//   npx tsx scripts/diagnostics/simple-underwriting-check.ts
//
// WHAT IT ASSERTS, in order:
//
//   1. THE FORMULA. For every non-renewal a1 and new-members a2 the sliders
//      offer (0-5% in 1% steps), moveBook's exposure is E(1 − a1 + a2) and
//      after x lossFactor is E x [(1 − a1)(1 − 0.5 a1) + 1.2 a2], to float
//      precision. Then THROUGH THE ENGINE: year 1 of played games at four
//      settings, each line's ordinary realised against the same game at 0/0 —
//      the same streams, so the ratio IS the bracket — and ordinary expected
//      against E x (1 − a1 + a2), the bracket kept out of it.
//   2. ONE YEAR ONLY. The same games, sliders used in year 1 and back to 0 in
//      year 2: year 2's ordinary actual over expected is exactly the plain
//      draw (lossFactor 1), and the exposure stays where year 1 left it.
//   3. 100 EQUAL MEMBERS. The draw has UNDERWRITING_MEMBERS luck factors and
//      as many risk scores, the realised loss is expected x lossFactor x year
//      factor x the mean of risk x luck, and over 20,000 seeds the mean luck's
//      variance is MEMBER_LUCK_CV^2 / 100 — equal shares, not unequal ones
//      (which would raise it).
//   3b. MEMBER RISK. Over 4,000 game seeds the scores have mean 1 and CV
//      MEMBER_RISK_CV; they are the GAME's — two worlds of one game hold the
//      same scores and different luck; they are redrawn every year and differ
//      by member; and through the engine a world of a multi-world game draws
//      its ordinary loss on the game's scores, not on its own seed's.
//   4. THE PRE-GAME. 2021 holds the opening book / 1.02^5, each year grows 2%,
//      2026 holds the opening book exactly, and each year's lossFactor is
//      (last year + 1.2 x the growth) / this year — the penalty on growth.
//
// ⚠ AND IT FAILS WHEN BROKEN — see THE CONTROLS at the foot.
// ============================================================================

import {
  MEMBER_LEVEL, MEMBER_LUCK_CV, MEMBER_RISK_CV, NEW_BUSINESS_PENALTY, NEW_MEMBERS_SLIDER, NON_RENEWAL_LOSS_RELIEF, NON_RENEWAL_SLIDER,
  OPENING_BOOK_EXPOSURE, PRE_GAME_BOOK_GROWTH, PRIOR_HISTORY_YEARS, UNDERWRITING_MEMBERS,
} from '../../src/data/pricingParameters';
import { moveBook } from '../../src/utils/bookUnderwriting';
import { ordinaryLossFromMembers } from '../../src/utils/ordinaryLoss';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { worldInstance } from '../../src/utils/worlds';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const failed: string[] = [];
function check(ok: boolean, label: string, detail = '') {
  if (!ok) failed.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}
MEMBER_LEVEL.enabled = false;

const bracket = (a1: number, a2: number) => (1 - a1) * (1 - NON_RENEWAL_LOSS_RELIEF * a1) + (1 + NEW_BUSINESS_PENALTY) * a2;
const steps = (r: { min: number; max: number; step: number }) =>
  Array.from({ length: Math.round((r.max - r.min) / r.step) + 1 }, (_, i) => r.min + i * r.step);

// --------------------------------------------------------------------------
console.log('--- 1. THE FORMULA ---');
{
  let worst = 0, worstExp = 0, cases = 0;
  for (const line of LINES) {
    for (const a1 of steps(NON_RENEWAL_SLIDER)) {
      for (const a2 of steps(NEW_MEMBERS_SLIDER)) {
        const E = OPENING_BOOK_EXPOSURE[line];
        const m = moveBook(line, E, { nonRenewal: a1, newMembers: a2 }, false, false, 1);
        worstExp = Math.max(worstExp, Math.abs(m.after / (E * (1 - a1 + a2)) - 1));
        worst = Math.max(worst, Math.abs(m.after * m.lossFactor / (E * bracket(a1, a2)) - 1));
        cases++;
      }
    }
  }
  check(worstExp < 1e-12, 'exposure after movement is E x (1 − a1 + a2)', `worst ${worstExp.toExponential(2)} over ${cases} cases`);
  check(worst < 1e-12, 'after x lossFactor is E x [(1 − a1)(1 − 0.5 a1) + 1.2 a2]', `worst ${worst.toExponential(2)}`);
  check(Math.abs(bracket(0.05, 0) - 0.92625) < 1e-12 && Math.abs(bracket(0, 0.05) / 1.05 - 1.00952) < 1e-5,
    'per unit: non-renewal 5% runs 2.5% cheaper, new members 5% about 0.95% dearer',
    `${(bracket(0.05, 0) / 0.95).toFixed(4)} / ${(bracket(0, 0.05) / 1.05).toFixed(5)}`);
}

interface Game { instance: ReturnType<typeof generateGameInstance>; start: GameState }
const games: Game[] = Array.from({ length: 4 }, (_, g) => {
  const id = `SIMPLEUW${g}`;
  const instance = generateGameInstance(id, 3_100_000 + g * 7919);
  const setup = { poolName: 'UW', gameLength: 3, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  return { instance, start: {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  } };
});
const decide = (y: number, a1: number, a2: number): DecisionSet => {
  const d = defaultDecisionSet(y);
  for (const l of LINES) { d.byLine[l].nonRenewal = a1; d.byLine[l].newMembers = a2; }
  return d;
};
const SETTINGS: Array<[number, number]> = [[0, 0], [0.05, 0], [0, 0.05], [0.05, 0.05]];

// Year 1 and year 2 of each game at each setting (year 2 always at 0/0).
const runs = games.map(g => SETTINGS.map(([a1, a2]) => {
  const p1 = processYear(g.start, decide(1, a1, a2));
  const gs2: GameState = { ...g.start, poolState: p1.updatedPoolState, currentYearNumber: 2, lockedResults: [p1.result] };
  const p2 = processYear(gs2, decide(2, 0, 0));
  return { p1, p2, before: g.start.poolState.lines };
}));

console.log('\n--- 1b. THROUGH THE ENGINE, year 1 against 0/0 ---');
{
  let worstRatio = 0, worstExpected = 0;
  for (const r of runs) {
    for (let k = 1; k < SETTINGS.length; k++) {
      const [a1, a2] = SETTINGS[k];
      for (const line of LINES) {
        const base = r[0].p1.result.byLine[line]!.newLossEngine!;
        const n = r[k].p1.result.byLine[line]!.newLossEngine!;
        worstRatio = Math.max(worstRatio, Math.abs(n.ordinaryRealised / base.ordinaryRealised / bracket(a1, a2) - 1));
        worstExpected = Math.max(worstExpected, Math.abs(n.ordinaryExpected / base.ordinaryExpected / (1 - a1 + a2) - 1));
      }
    }
  }
  check(worstRatio < 1e-9, 'year-1 ordinary realised over the 0/0 game IS the bracket, on every line',
    `worst ${worstRatio.toExponential(2)} over ${games.length} games x 3 settings x 3 lines`);
  check(worstExpected < 1e-9, 'and ordinary EXPECTED moves with exposure only: the bracket is not in it',
    `worst ${worstExpected.toExponential(2)}`);
}

// --------------------------------------------------------------------------
console.log('\n--- 2. ONE YEAR ONLY ---');
{
  let worstPlain = 0, worstExposure = 0;
  for (let g = 0; g < games.length; g++) {
    for (let k = 0; k < SETTINGS.length; k++) {
      const { p1, p2 } = runs[g][k];
      for (const line of LINES) {
        const n = p2.result.byLine[line]!.newLossEngine!;
        const plain = ordinaryLossFromMembers(line, 100, 2, games[g].instance.seed).factor;
        worstPlain = Math.max(worstPlain, Math.abs(n.ordinaryRealised / (n.ordinaryExpected * (1 + n.uplift)) / plain - 1));
        worstExposure = Math.max(worstExposure,
          Math.abs((p2.updatedPoolState.lines[line].bookExposure ?? 0) / (p1.updatedPoolState.lines[line].bookExposure ?? 0) - 1));
      }
    }
  }
  check(worstPlain < 1e-9, 'year 2 at 0/0: ordinary actual over expected is the plain draw — no carry-over',
    `worst ${worstPlain.toExponential(2)}`);
  check(worstExposure < 1e-12, 'and the book stays where year 1 left it', `worst ${worstExposure.toExponential(2)}`);
}

// --------------------------------------------------------------------------
console.log('\n--- 3. 100 EQUAL MEMBERS ---');
{
  const o = ordinaryLossFromMembers('GL', 100, 3, 12345, 1.07);
  const meanRiskLuck = o.luck.reduce((a, f, i) => a + f * o.risk[i], 0) / o.luck.length;
  check(o.luck.length === UNDERWRITING_MEMBERS && o.risk.length === UNDERWRITING_MEMBERS && UNDERWRITING_MEMBERS === 100,
    'the draw has 100 members, each with its luck and its risk score', `${o.luck.length} / ${o.risk.length}`);
  check(Math.abs(o.realised / (o.expected * 1.07 * (o.yearFactor ?? NaN) * meanRiskLuck) - 1) < 1e-12,
    'realised = expected x lossFactor x year factor x the members\' mean of risk x luck');
  const means: number[] = [];
  for (let s = 0; s < 20_000; s++) {
    const x = ordinaryLossFromMembers('WC', 100, 1, 500_000 + s * 7919);
    means.push(x.luck.reduce((a, b) => a + b, 0) / x.luck.length);
  }
  const mu = means.reduce((a, b) => a + b, 0) / means.length;
  const v = means.reduce((a, b) => a + (b - mu) ** 2, 0) / (means.length - 1);
  const want = MEMBER_LUCK_CV ** 2 / UNDERWRITING_MEMBERS;
  // The sample variance's relative SE is about sqrt(2 / n) = 1.0%; four of them.
  check(Math.abs(v / want - 1) < 0.04, 'the mean luck\'s variance is CV^2 / 100: equal shares',
    `${v.toExponential(4)} against ${want.toExponential(4)} (${(100 * (v / want - 1)).toFixed(2)}%)`);
}

// --------------------------------------------------------------------------
console.log('\n--- 3b. MEMBER RISK ---');
{
  const scores: number[] = [];
  for (let s = 0; s < 4000; s++) scores.push(...ordinaryLossFromMembers('GL', 100, 2, 1, 1, false, 700_000 + s * 7919).risk);
  const n = scores.length, m = scores.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)), cv = sd / m;
  // SE of the mean is sd / sqrt(n); of a lognormal's sample CV, wider than normal — 4% of the CV is about 10 SE here.
  check(Math.abs(m - 1) < 4 * sd / Math.sqrt(n) && Math.abs(cv / MEMBER_RISK_CV - 1) < 0.04,
    `the scores are mean 1, CV ${MEMBER_RISK_CV}`, `mean ${m.toFixed(5)}, CV ${cv.toFixed(4)} over ${n.toLocaleString('en-US')}`);
  const w1 = ordinaryLossFromMembers('WC', 100, 4, 111, 1, false, 4242);
  const w2 = ordinaryLossFromMembers('WC', 100, 4, 222, 1, false, 4242);
  check(w1.risk.every((r, i) => r === w2.risk[i]) && w1.luck.some((f, i) => f !== w2.luck[i]),
    'two worlds of one game: the same risk scores, different luck');
  const y5 = ordinaryLossFromMembers('WC', 100, 5, 111, 1, false, 4242);
  check(y5.risk.every((r, i) => r !== w1.risk[i]), 'redrawn every year: no member keeps its score');
  check(new Set(w1.risk).size === UNDERWRITING_MEMBERS, 'and every member draws its own');
  // Through the engine: world 1 of a game, its seed not the game's.
  const g = games[0], wi = worldInstance(g.instance, 1);
  const pw = processYear({ ...g.start, instance: wi }, defaultDecisionSet(1));
  let worst = 0, wrong = 0;
  for (const line of LINES) {
    const n1 = pw.result.byLine[line]!.newLossEngine!;
    const onGame = ordinaryLossFromMembers(line, 100, 1, wi.seed, 1, false, g.instance.seed).factor;
    const onWorld = ordinaryLossFromMembers(line, 100, 1, wi.seed, 1, false, wi.seed).factor;
    const got = n1.ordinaryRealised / (n1.ordinaryExpected * (1 + n1.uplift));
    worst = Math.max(worst, Math.abs(got / onGame - 1));
    wrong = Math.max(wrong, Math.abs(got / onWorld - 1));
  }
  check(wi.seed !== g.instance.seed && worst < 1e-9 && wrong > 1e-6,
    'through the engine, a world draws on the GAME\'s risk scores', `worst ${worst.toExponential(2)} (on its own seed's it would be off ${wrong.toExponential(2)})`);
}

// --------------------------------------------------------------------------
console.log('\n--- 4. THE PRE-GAME ---');
{
  const first = 1 - PRIOR_HISTORY_YEARS;
  let worstSize = 0, worstFactor = 0;
  for (const line of LINES) {
    const O = OPENING_BOOK_EXPOSURE[line];
    for (let y = first; y <= 0; y++) {
      const m = moveBook(line, 0, defaultDecisionSet(y).byLine[line], false, true, y);
      worstSize = Math.max(worstSize, Math.abs(m.after / (O * (1 + PRE_GAME_BOOK_GROWTH) ** y) - 1));
      const prev = y > first ? O * (1 + PRE_GAME_BOOK_GROWTH) ** (y - 1) : m.after;
      const want = (prev + (1 + NEW_BUSINESS_PENALTY) * (m.after - prev)) / m.after;
      worstFactor = Math.max(worstFactor, Math.abs(m.lossFactor / want - 1));
    }
  }
  check(worstSize < 1e-12, 'the pre-game book is the opening book x 1.02^y, 2026 exactly the opening',
    `worst ${worstSize.toExponential(2)}`);
  check(worstFactor < 1e-12, 'and each year\'s growth carries the 20% penalty (2021 writes none)',
    `worst ${worstFactor.toExponential(2)}`);
  // Through the engine: the opening game's year-0 book is the opening book.
  const ex = games.map(g => LINES.map(l => (g.start.poolState.lines[l].bookExposure ?? 0) / OPENING_BOOK_EXPOSURE[l] - 1)).flat();
  check(ex.every(x => Math.abs(x) < 1e-12), 'through runPriorHistory: every game opens on the opening book');
}

console.log(`\n${failed.length === 0 ? 'ALL OK' : `${failed.length} FAILED`}`);

// ============================================================================
// ⚠ THE CONTROLS — RUN AND RECORDED. Each break applied alone, the gate run,
// the code restored and the gate green again.
//
//   1. THE FORMULA: the relief read as 1 x a1, not NON_RENEWAL_LOSS_RELIEF x
//      a1, in moveBook: EXIT 1 — section 1's formula and 1b's engine ratio
//      fail, worst 2.56e-2 each.
//   2. ONE YEAR ONLY: the relief made to stick to the book (a1 + 1 − E /
//      the opening book, so a book shrunk last year still runs cheaper):
//      EXIT 1 — section 2's plain-draw check fails, worst 2.50e-2. Year 1
//      passes, as it should: the break is only in the carry-over.
//   3. 100 MEMBERS: UNDERWRITING_MEMBERS 50: EXIT 1 — section 3's count fails
//      (50). The variance check follows the parameter, so it passes.
//   4. THE PRE-GAME: lossFactor 1 on the pre-game's growth: EXIT 1 — section
//      4's penalty check fails, worst 3.91e-3.
//   5. MEMBER RISK OFF THE WORLD'S SEED: the engine passing instance.seed, not
//      marketSeedOf(instance), as the game seed: EXIT 1 — 3b's engine check
//      fails (off 3.39e-2).
//   6. MEMBER RISK NOT REDRAWN: the risk stream keyed to year 1 whatever the
//      year: EXIT 1 — 3b's "redrawn every year" fails.
//   7. MEMBER RISK AT 20%: the draw at a CV of 0.20, not MEMBER_RISK_CV: EXIT 1
//      — 3b's spread check fails (CV 0.2001).
// ============================================================================
process.exit(failed.length === 0 ? 0 : 1);
