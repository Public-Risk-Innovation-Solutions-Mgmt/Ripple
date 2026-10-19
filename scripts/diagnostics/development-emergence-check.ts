// ============================================================================
// THE HOST'S DEVELOPMENT EMERGES IN FULL, AND ONLY IN FULL.
//
//   npx tsx scripts/diagnostics/development-emergence-check.ts
//
// Each accident year develops by its line's percentage of a base outstanding,
// IN TOTAL over its remaining lifetime, arriving in step with the payments.
// The mechanism is a telescoping sum (see hostDevelopment.ts), so there is one
// identity worth asserting and this file asserts it per accident year:
//
//   emerged by run-off  ==  the line's %  x  the base outstanding
//
// ⚠ IT IS A CLOSED IDENTITY, SO THE BAR IS ROUNDING AND NOT A TOLERANCE. Every
// term is deterministic — no draw enters this mechanism anywhere — so the only
// gap that may appear is float dust on a sum of ten or so increments. A bar
// that had to be widened to pass would mean the pacing had stopped summing to
// one, which is the whole mechanism.
//
// WHAT IT CHECKS, in order:
//
//   1. RUN-OFF. Played to run-off, every cohort's `developmentEmerged` equals
//      its `developmentTotal`. This is the headline.
//   2. THE TOTAL IS THE STATED PERCENTAGE of the cohort's own base, which is
//      the other half: emerging fully against a WRONG total would pass (1).
//   3. FAVOURABLE WORKS. Property's default is negative and its cohorts must
//      emerge negative, to the same bar. A mechanism that quietly took an
//      absolute value, or floored at zero, passes every adverse test.
//   4. THE PACE. The cumulative emerged matches the closed form the pacing
//      implies, at EVERY age of every cohort. This is the section that tests
//      the mechanism — see its own note for why section 1 cannot.
//   5. ZERO IS ZERO. At 0% nothing emerges anywhere, which is what makes the
//      baselines byte-identical at 0% and is asserted here rather than only
//      in a commit message.
//
// ⚠ AND IT FAILS WHEN BROKEN — MEASURED, NOT ASSUMED. See THE CONTROL at the
// foot for the three deliberate breaks and what each one reddens.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { PRIOR_DEVELOPMENT_DEFAULTS } from '../../src/data/pricingParameters';
import { LINE_PAYOUT_PATTERN } from '../../src/data/defaultAssumptions';
import { unpaidShare } from '../../src/utils/payoutPattern';
import type { CoverageLine, GameState, ReserveCohort } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 6);
// ⚠ LONG ENOUGH TO RUN OFF, WHICH IS THE WHOLE POINT. The recorded payout
// tables reach zero unpaid by age 11 on Property and later on WC and GL; a
// game short enough to leave cohorts open would assert nothing about a TOTAL.
//
// ⚠ 30 SINCE PROMPT A COMMIT 2, WAS 24. The opening holds ten accident years
// now (OPENING_RESERVE_YEARS), not each pattern's full runoff, so the oldest
// WC cohort a game starts with is 10 years old rather than 37. WC's pattern
// runs to 37, so 24 years left every WC cohort open — section 3's adverse WC
// sample was empty (0 of 0) — and 30 is the first round figure past 37 - 10.
const YEARS = Number(process.env.YEARS ?? 30);
const RULE = '='.repeat(78);

const failed: string[] = [];
let checks = 0;
function check(ok: boolean, label: string, detail = '') {
  checks++;
  if (!ok) failed.push(`${label}${detail ? '  — ' + detail : ''}`);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}

interface Seen { line: CoverageLine; game: number; cohort: ReserveCohort; finished: boolean }
/** Every sighting of every cohort, so the PATH can be asserted and not just
 *  its endpoint — see section 4. */
const sightings: Seen[] = [];

/**
 * Play, and keep each cohort's LAST SEEN state.
 *
 * ⚠ A COHORT THAT CLOSES IS DROPPED FROM THE LIST, which is why this snapshots
 * every year rather than reading the pool at the end. processIbner filters
 * `!c.closed` before it maps, so a cohort that finishes mid-game simply stops
 * being there — and the first version of this gate, which read only the
 * surviving cohorts, found 12 of 396 at run-off and NOT ONE Property cohort,
 * because Property's pattern settles soonest and its cohorts were gone. A
 * favourable-development test that silently had no subjects is the exact shape
 * of a check that passes while testing nothing.
 *
 * `finished` means the cohort has no more development to take: its unpaid
 * share has reached zero, or it has left the list.
 */
function play(pct: Record<string, number> | undefined): Seen[] {
  const last = new Map<string, Seen>();
  for (let g = 0; g < GAMES; g++) {
    const id = `DEVEM${g}`;
    const instance = generateGameInstance(id, 3_900_000 + g * 7919);
    const setup = {
      poolName: 'Dev', gameLength: YEARS + 1, startingYear: 2026,
      instanceId: id, activeLines: LINES,
      ...(pct === undefined ? {} : { priorDevelopment: pct }),
    };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    const snapshot = () => {
      for (const line of LINES) {
        for (const c of gs.poolState.lines[line].reserveCohorts ?? []) {
          const seen1: Seen = {
            line, game: g, cohort: c,
            finished: unpaidShare(LINE_PAYOUT_PATTERN[line], c.age + 1) <= 0,
          };
          last.set(`${g}|${line}|${c.yearNumber}`, seen1);
          sightings.push(seen1);
        }
      }
    };
    snapshot();
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      gs = {
        ...gs, poolState: p.updatedPoolState, currentYearNumber: y + 1,
        currentDecisions: defaultDecisionSet(y + 1),
        lockedResults: [...gs.lockedResults, p.result],
      };
      snapshot();
    }
    // Anything whose last sighting is not in the final pool has closed, and a
    // closed cohort has finished developing by definition.
    const live = new Set<string>();
    for (const line of LINES) {
      for (const c of gs.poolState.lines[line].reserveCohorts ?? []) live.add(`${g}|${line}|${c.yearNumber}`);
    }
    for (const [k, v] of last) {
      if (k.startsWith(`${g}|`) && !live.has(k)) last.set(k, { ...v, finished: true });
    }
  }
  return [...last.values()];
}

console.log(RULE);
console.log('DEVELOPMENT EMERGENCE — the lifetime total, in full and only in full');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years, all-default decisions, at the parameter defaults:`);
console.log(`  ${LINES.map(l => `${l} ${(100 * PRIOR_DEVELOPMENT_DEFAULTS[l]).toFixed(0)}%`).join('  ·  ')}\n`);

const seen = play(undefined);
const based = seen.filter(s => s.cohort.developmentTotal !== undefined);

// --------------------------------------------------------------------------
console.log('--- 0. EVERY COHORT WAS BASED ---');
check(based.length === seen.length,
  'every cohort carries a development base',
  `${based.length} of ${seen.length}`);
check(based.length > 0, 'there are cohorts to assert on', `${based.length}`);

// --------------------------------------------------------------------------
console.log('\n--- 1. BY RUN-OFF, EXACTLY THE FULL AMOUNT HAS EMERGED ---');
// ⚠ ONLY COHORTS THAT HAVE ACTUALLY RUN OFF. A cohort still carrying unpaid
// balance has not finished emerging and asserting on it would be asserting
// that the mechanism finishes early. "Run off" is the pattern's own statement:
// the unpaid share at this cohort's age is zero.
const runOff = based.filter(s => s.finished);
let worstGap = 0;
for (const s of runOff) {
  worstGap = Math.max(worstGap, Math.abs((s.cohort.developmentEmerged ?? 0) - (s.cohort.developmentTotal ?? 0)));
}
check(runOff.length > 0, 'cohorts have reached run-off', `${runOff.length} of ${based.length}`);
check(worstGap < 0.01, 'emerged == total, to the cent, on every run-off cohort',
  `worst $${worstGap.toExponential(2)}`);

// --------------------------------------------------------------------------
console.log('\n--- 2. THE TOTAL IS THE LINE\'S % OF THE BASE ---');
// ⚠ A COHORT PAST THE END OF ITS PAYOUT TABLE IS EXEMPT, AND IT IS A REAL
// CASE RATHER THAN AN EXCUSE. A few very old bulk cohorts — WC at age 37, GL
// at 21 — still carry a residual balance although their pattern says they are
// fully paid. The development is PACED BY PAYMENTS, so a cohort with no
// payment increments left has nothing to pace against and takes none at all.
// Those are checked for exactly that instead: base or no base, they must take
// nothing. Asserting the percentage on them would be asserting that a
// mechanism driven by payments works where there are no payments.
const canDevelop = based.filter(s => (s.cohort.developmentBaseOpenShare ?? 0) > 0);
const cannot = based.filter(s => !((s.cohort.developmentBaseOpenShare ?? 0) > 0));
let worstPct = 0;
for (const s of canDevelop) {
  const want = (s.cohort.developmentBase ?? 0) * PRIOR_DEVELOPMENT_DEFAULTS[s.line];
  worstPct = Math.max(worstPct, Math.abs((s.cohort.developmentTotal ?? 0) - want));
}
check(canDevelop.length > 0, 'there are cohorts with payments left to pace against',
  `${canDevelop.length} of ${based.length}`);
check(worstPct < 0.01, 'developmentTotal == pct x base on every one of them',
  `worst $${worstPct.toExponential(2)}`);
check(cannot.every(s => (s.cohort.developmentTotal ?? 0) === 0 && (s.cohort.developmentEmerged ?? 0) === 0),
  'and a cohort past the end of its payout table takes none',
  `${cannot.length} such cohort(s)`);

// --------------------------------------------------------------------------
console.log('\n--- 3. FAVOURABLE WORKS, AND IT IS PROPERTY ---');
const pr = runOff.filter(s => s.line === 'Property' && (s.cohort.developmentTotal ?? 0) !== 0);
const prNegative = pr.filter(s => (s.cohort.developmentEmerged ?? 0) < 0);
check(pr.length > 0, 'Property has run-off cohorts with a base', `${pr.length}`);
check(prNegative.length === pr.length,
  'every one of them emerged NEGATIVE — favourable is not an absolute value',
  `${prNegative.length} of ${pr.length}`);
const wc = runOff.filter(s => s.line === 'WC' && (s.cohort.developmentTotal ?? 0) !== 0);
check(wc.length > 0 && wc.every(s => (s.cohort.developmentEmerged ?? 0) > 0),
  'and WC, which is adverse, emerged POSITIVE',
  `${wc.filter(s => (s.cohort.developmentEmerged ?? 0) > 0).length} of ${wc.length}`);

// --------------------------------------------------------------------------
console.log('\n--- 4. THE PACE IS THE PAYMENT PACE, AT EVERY AGE ---');
// ⚠ THIS IS THE SECTION THAT TESTS THE MECHANISM; SECTION 1 ONLY TESTS WHERE
// IT ENDS UP, AND THAT TURNED OUT TO BE ALMOST NOTHING. The emerging step
// releases the whole remainder once the pattern's unpaid share reaches zero,
// so the last step SNAPS to the total however badly the earlier ones were
// paced — and both of the first two deliberate breaks below passed section 1
// for exactly that reason. The endpoint cannot be the test.
//
// So the cumulative is asserted at EVERY SIGHTING of every cohort, against
// the closed form the pacing implies:
//
//   emerged(age)  ==  total x [ u(base) - u(age + 1) ] / u(base)
//
// which is the telescoping sum written out. It pins the whole path, it is
// where a mis-paced mechanism shows, and it is what the controls at the foot
// of this file redden.
let worstPath = 0;
let pathChecked = 0;
for (const s of sightings) {
  const c = s.cohort;
  const total = c.developmentTotal ?? 0;
  const base = c.developmentBaseOpenShare ?? 0;
  if (total === 0 || !(base > 0)) continue;
  pathChecked++;
  const openNow = unpaidShare(LINE_PAYOUT_PATTERN[s.line], c.age + 1);
  const want = total * (base - openNow) / base;
  worstPath = Math.max(worstPath, Math.abs((c.developmentEmerged ?? 0) - want));
}
check(pathChecked > 500, 'there are enough sightings to pin a path', `${pathChecked}`);
check(worstPath < 0.01, 'emerged(age) == total x [u(base) - u(age+1)] / u(base), at every sighting',
  `worst $${worstPath.toExponential(2)}`);

console.log('\n--- 5. AT 0% NOTHING EMERGES ANYWHERE ---');
const zero = play({ WC: 0, GL: 0, Property: 0 });
const anyMoved = zero.filter(s => (s.cohort.developmentEmerged ?? 0) !== 0
  || (s.cohort.developmentTotal ?? 0) !== 0);
check(anyMoved.length === 0,
  'every cohort has total 0 and emerged 0 — which is what makes the baselines hold at 0%',
  `${anyMoved.length} moved of ${zero.length}`);

console.log(`\n${RULE}`);
if (failed.length === 0) {
  console.log(`THE FULL PERCENTAGE EMERGES, AND NO MORE. ${checks} checks.`);
} else {
  console.log(`${failed.length} FAILURE(S) of ${checks}:`);
  for (const f of failed) console.log(`  - ${f}`);
}
console.log(RULE);

// ============================================================================
// ⚠ THE CONTROL — four deliberate breaks, RUN and recorded, because an
// identity that cannot go red is a decoration.
//
// ⚠ AND THE FIRST TWO PASSED AGAINST AN EARLIER VERSION OF THIS FILE, which
// is why section 4 exists in the form it does. Section 1 asserts only where
// the emergence ENDS UP, and developmentEmergingAtStep releases the whole
// remainder on the step where the pattern's unpaid share reaches zero — so
// the final step snaps to the total however badly the earlier ones were
// paced. Both pacing breaks below sailed through sections 1 to 3. The path
// assertion in section 4 is what actually holds the mechanism, and it was
// added because the controls said the rest did not.
//
//   1. EQUAL PACING instead of the payment increment — return `total / 10`.
//      MEASURED: exit 1, section 4 red at $2.54e+6. Sections 1, 2, 3 and 5
//      all stayed GREEN.
//   2. DROP THE SIGN — return `Math.abs(total * share)`. MEASURED: exit 1,
//      section 4 red at $6.38e+6. Again the only section that moved; even
//      section 3, which exists to catch a lost sign, stayed green, because
//      the final snap restores the right endpoint for Property too.
//   3. A TOTAL THAT IS NOT THE STATED PERCENTAGE — `base * pct * 1.1`.
//      MEASURED: exit 1, section 2 red at $9.97e+5.
//   4. SOMETHING EMERGES AT 0% — return 1000 when the total is zero.
//      MEASURED: exit 1, three sections red at once, section 5 reporting 828
//      of 846 cohorts moved. That is the section the "byte-identical at 0%"
//      claim rests on, and it fires.
//
// ⚠ ONE THING THAT DID NOT BREAK ANYTHING, recorded so it is not retried:
// removing the `developmentTotal !== undefined` guard in
// withLifetimeDevelopment. It reads like a compounding break and is not one —
// the function is called once per cohort, at creation or at the opening, so
// there is no second call for the guard to stop. The guard earns its place
// against a FUTURE caller, not against today's.
process.exit(failed.length === 0 ? 0 : 1);
