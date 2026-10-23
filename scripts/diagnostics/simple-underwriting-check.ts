// ============================================================================
// SIMPLE UNDERWRITING — THE BRIEF'S FORMULA, ITS PERSISTENCE, 100 EQUAL MEMBERS.
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
//   2. PERSISTENCE, THROUGH THE ENGINE, in the version in force
//      (NON_RENEWAL_PERSISTENCE). The same games, sliders used in year 1 and
//      back to 0 in year 2: year 2's ordinary actual over expected is the
//      plain draw x what the version carries of year 1's improvement —
//      1 − carry x (1 − Q1), Q1 = [(1 − a1)(1 − 0.5 a1) + a2] / (1 − a1 + a2),
//      the new members joining at 1 — and the exposure stays put.
//   3. 100 EQUAL MEMBERS. The draw has UNDERWRITING_MEMBERS luck factors, the
//      realised loss is expected x lossFactor x year factor x their mean, and
//      over 20,000 seeds the mean luck's variance is MEMBER_LUCK_CV^2 / 100 —
//      equal shares, not unequal ones (which would raise it).
//   4. THE PRE-GAME. 2021 holds the opening book / 1.02^5, each year grows 2%,
//      2026 holds the opening book exactly, and each year's lossFactor is
//      (last year + 1.2 x the growth) / this year — the penalty on growth.
//   5. ALL THREE VERSIONS, ON THE BOOK. A one-off 5% non-renewal: oneYear
//      leaves nothing in year 2; decaying leaves 2.5%, then 1.25%, 0.625%,
//      halving; lasting keeps 2.5% for good. Held every year with no new
//      members, lasting compounds to 0.975^t and decaying settles at 0.951.
//      New members at 5% a year dilute a lasting improvement by exposure.
//
// ⚠ AND IT FAILS WHEN BROKEN — see THE CONTROLS at the foot.
// ============================================================================

import {
  MEMBER_LEVEL, MEMBER_LUCK_CV, NEW_BUSINESS_PENALTY, NEW_MEMBERS_SLIDER, NON_RENEWAL_LOSS_RELIEF, NON_RENEWAL_SLIDER,
  NON_RENEWAL_DECAY, NON_RENEWAL_PERSISTENCE, OPENING_BOOK_EXPOSURE, PRE_GAME_BOOK_GROWTH, PRIOR_HISTORY_YEARS,
  UNDERWRITING_MEMBERS,
} from '../../src/data/pricingParameters';
import { moveBook, persistenceCarry } from '../../src/utils/bookUnderwriting';
import { ordinaryLossFromMembers } from '../../src/utils/ordinaryLoss';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
// The share of an improvement each version carries a year — stated here, not read from the module.
const CARRY = { oneYear: 0, decaying: 0.5, lasting: 1 } as const;
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
console.log(`\n--- 2. PERSISTENCE THROUGH THE ENGINE — ${NON_RENEWAL_PERSISTENCE.mode} ---`);
{
  let worstPlain = 0, worstExposure = 0;
  for (let g = 0; g < games.length; g++) {
    for (let k = 0; k < SETTINGS.length; k++) {
      const { p1, p2 } = runs[g][k];
      for (const line of LINES) {
        const n = p2.result.byLine[line]!.newLossEngine!;
        const plain = ordinaryLossFromMembers(line, 100, 2, games[g].instance.seed).factor;
        const [a1, a2] = SETTINGS[k];
        const q1 = ((1 - a1) * (1 - NON_RENEWAL_LOSS_RELIEF * a1) + a2) / (1 - a1 + a2);
        const carried = 1 - CARRY[NON_RENEWAL_PERSISTENCE.mode] * (1 - q1);
        worstPlain = Math.max(worstPlain,
          Math.abs(n.ordinaryRealised / (n.ordinaryExpected * (1 + n.uplift)) / (plain * carried) - 1));
        worstExposure = Math.max(worstExposure,
          Math.abs((p2.updatedPoolState.lines[line].bookExposure ?? 0) / (p1.updatedPoolState.lines[line].bookExposure ?? 0) - 1));
      }
    }
  }
  check(worstPlain < 1e-9, `year 2 at 0/0: actual over expected is the plain draw x what ${NON_RENEWAL_PERSISTENCE.mode} carries`,
    `worst ${worstPlain.toExponential(2)}`);
  check(worstExposure < 1e-12, 'and the book stays where year 1 left it', `worst ${worstExposure.toExponential(2)}`);
}

// --------------------------------------------------------------------------
console.log('\n--- 3. 100 EQUAL MEMBERS ---');
{
  const o = ordinaryLossFromMembers('GL', 100, 3, 12345, 1.07);
  const meanLuck = o.luck.reduce((a, b) => a + b, 0) / o.luck.length;
  check(o.luck.length === UNDERWRITING_MEMBERS && UNDERWRITING_MEMBERS === 100, 'the draw has 100 members',
    `${o.luck.length}`);
  check(Math.abs(o.realised / (o.expected * 1.07 * (o.yearFactor ?? NaN) * meanLuck) - 1) < 1e-12,
    'realised = expected x lossFactor x year factor x the members\' mean luck');
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

// --------------------------------------------------------------------------
console.log('\n--- 5. ALL THREE VERSIONS, ON THE BOOK ---');
{
  const inForce = NON_RENEWAL_PERSISTENCE.mode;
  check(persistenceCarry() === CARRY[inForce] && NON_RENEWAL_DECAY === CARRY.decaying,
    `the version in force (${inForce}) carries ${CARRY[inForce]}`);
  // Ten years of moveBook on one line; the renewing book's loss per unit each year.
  const play = (mode: keyof typeof CARRY, a1At: (t: number) => number, a2: number) => {
    NON_RENEWAL_PERSISTENCE.mode = mode;
    let E = OPENING_BOOK_EXPOSURE.WC, Q = 1;
    const out: number[] = [];
    for (let t = 1; t <= 10; t++) {
      const m = moveBook('WC', E, { nonRenewal: a1At(t), newMembers: a2 }, false, false, t, Q);
      out.push(m.renewingQuality);
      E = m.after; Q = m.qualityAfter;
    }
    NON_RENEWAL_PERSISTENCE.mode = inForce;
    return out;
  };
  const once = (t: number) => (t === 1 ? 0.05 : 0), held = () => 0.05;
  const near = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
  const yrs = Array.from({ length: 10 }, (_, i) => i + 1);
  const r = NON_RENEWAL_LOSS_RELIEF * 0.05;
  check(near(play('oneYear', once, 0), yrs.map(t => (t === 1 ? 1 - r : 1))) < 1e-12,
    'oneYear: a one-off non-renewal is gone in year 2');
  check(near(play('decaying', once, 0), yrs.map(t => 1 - r * 0.5 ** (t - 1))) < 1e-12,
    'decaying: full, then half, a quarter, ... of 2.5%');
  check(near(play('lasting', once, 0), yrs.map(() => 1 - r)) < 1e-12, 'lasting: a one-off 2.5% stays');
  check(near(play('lasting', held, 0), yrs.map(t => (1 - r) ** t)) < 1e-12, 'lasting, held: 0.975^t',
    `year 10 ${play('lasting', held, 0)[9].toFixed(4)}`);
  // Year 1 ends 95% renewed at 0.975 and 5% new at 1; each later year adds 5% at 1.
  check(near(play('lasting', once, 0.05), yrs.map(t => (t === 1 ? 1 - r : 1 - r * 0.95 / 1.05 ** (t - 2)))) < 1e-12,
    'lasting, with 5% new members a year: the improvement dilutes by exposure, 1 / 1.05 a year');
  // q = 0.975 x (1 − 0.5 (1 − q))  =>  q = 0.4875 / 0.5125.
  check(near(play('decaying', held, 0).slice(-1), [0.4875 / 0.5125]) < 1e-4,
    'decaying, held: settles at 0.4875 / 0.5125 = 0.951',
    `year 10 ${play('decaying', held, 0)[9].toFixed(4)}`);
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
// ============================================================================
process.exit(failed.length === 0 ? 0 : 1);
