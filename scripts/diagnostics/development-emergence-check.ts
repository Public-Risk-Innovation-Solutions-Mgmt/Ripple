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
//
// ⚠ RESTATED FOR wip/adverse-development: THE HOST'S PERCENTAGES ARE RETIRED.
// With ADVERSE_DEVELOPMENT on (as shipped) the engine sets every cohort's
// developmentPct to 0, in the pre-game and the played years alike, and adverse
// development by level replaces it — a yearly λ on each open prior year's
// start-of-year outstanding, held by adverse-development-check. So as shipped
// every cohort's total was 0 and sections 2-4 failed: "total == pct x base"
// against the parameter's percentage (worst $7.2e+7), no Property or WC
// cohort with a total, and no path to pin. This gate now does both, the way
// aggregate-stop-check does for its dormant stop:
//
//   0. THE RETIREMENT, as shipped: played with the host's percentages SET
//      (WC 20%, GL 20%, Property -10% — not the defaults, so a read of either
//      shows), every cohort's development total and emerged are exactly 0 —
//      the host's percentages are not read anywhere — and adverse development
//      IS booked on the played years, so the retirement is a replacement and
//      not prior years left undeveloped.
//
// and then SWITCHES ADVERSE_DEVELOPMENT OFF INSIDE ITS OWN PROCESS and grades
// 1-5 on the host's mechanism exactly as before, so it stays correct for the
// day the switch goes back. Safe only because every gate runs in its own
// process; restored before exit. Reserve inflation is off as shipped and
// stays off, so the off run is the host's development alone.
//
// ⚠ AND NOW EVERY SECTION HAS A RUNTIME CONTROL as well as the recorded
// breaks at the foot: each section is a function, and each is run once more
// on broken input that must fail it — 0 on the switched-off games (the host's
// percentages read); 1 against a total 1% short; 2 against the percentage x
// 1.1; 3 with Property's sign dropped; 4 against equal pacing (the recorded
// break 1, in the grader); 5 on the defaults' games, where things emerge.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { ADVERSE_DEVELOPMENT, PRIOR_DEVELOPMENT_DEFAULTS, RESERVE_INFLATION } from '../../src/data/pricingParameters';
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
/** One play: each cohort's last sighting, every sighting of every cohort (so
 *  the PATH can be asserted and not just its endpoint — see section 4), and
 *  the adverse development the played years booked. Per play, not global, so
 *  the shipped run and the zero run cannot leak into section 4. */
interface Played { last: Seen[]; sightings: Seen[]; adverse: number }

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
function play(pct: Record<string, number> | undefined): Played {
  const last = new Map<string, Seen>();
  const sightings: Seen[] = [];
  let adverse = 0;
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
      for (const line of LINES) adverse += p.result.byLine[line]?.newLossEngine?.adverseDevelopment ?? 0;
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
  return { last: [...last.values()], sightings, adverse };
}

console.log(RULE);
console.log('DEVELOPMENT EMERGENCE — the lifetime total, in full and only in full');
console.log(RULE);

// Each section returns its problems; `report` prints and records them.
const report = (problems: string[], label: string, detail = '') => check(problems.length === 0, label, detail + (problems.length ? `  [${problems.join('; ')}]` : ''));

// --------------------------------------------------------------------------
// 0. THE RETIREMENT (wip/adverse-development), as shipped.
const HOST_SET = { WC: 0.20, GL: 0.20, Property: -0.10 };
function sectionRetired(p: Played): { problems: string[]; detail: string } {
  const problems: string[] = [];
  const moved = p.last.filter(s => (s.cohort.developmentTotal ?? 0) !== 0 || (s.cohort.developmentEmerged ?? 0) !== 0);
  if (!ADVERSE_DEVELOPMENT.enabled) problems.push('ADVERSE_DEVELOPMENT is off');
  if (p.last.length === 0) problems.push('no cohorts');
  if (moved.length > 0) problems.push(`${moved.length} cohort(s) took the host's development`);
  if (!(p.adverse > 0)) problems.push('no adverse development booked on the played years');
  return { problems, detail: `${moved.length} of ${p.last.length} cohorts took any host development; adverse development booked $${(p.adverse / 1e6).toFixed(1)}M` };
}
console.log(`AS SHIPPED: ADVERSE_DEVELOPMENT ${ADVERSE_DEVELOPMENT.enabled ? 'on' : 'OFF'}, reserve inflation ${RESERVE_INFLATION.enabled ? 'ON' : 'off'}; `
  + `${GAMES} games x ${YEARS} years with the host's percentages set to ${LINES.map(l => `${l} ${(100 * HOST_SET[l]).toFixed(0)}%`).join(' · ')}`);
console.log('\n--- 0. THE HOST\'S PERCENTAGES ARE RETIRED: NOTHING EMERGES BY THEM, ADVERSE DEVELOPMENT DOES ---');
const shipped = play(HOST_SET);
{
  const r = sectionRetired(shipped);
  report(r.problems, 'every cohort has host total 0 and emerged 0, and adverse development is booked in its place', r.detail);
}

// SWITCHED OFF INSIDE THIS PROCESS: the host's mechanism, graded as before.
// Restored at the foot.
ADVERSE_DEVELOPMENT.enabled = false;
console.log(`\nSWITCHED OFF IN THIS PROCESS: ADVERSE_DEVELOPMENT off — the host's development, ${GAMES} games x ${YEARS} years, all-default decisions, at the parameter defaults:`);
console.log(`  ${LINES.map(l => `${l} ${(100 * PRIOR_DEVELOPMENT_DEFAULTS[l]).toFixed(0)}%`).join('  ·  ')}\n`);

const played = play(undefined);
const seen = played.last;
const sightings = played.sightings;
const based = seen.filter(s => s.cohort.developmentTotal !== undefined);

// --------------------------------------------------------------------------
console.log('--- 0b. EVERY COHORT WAS BASED ---');
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
// `total` is what the run-off cohort should have emerged; the control feeds a
// total 1% short.
function sectionRunOff(total: (c: ReserveCohort) => number): { problems: string[]; worst: number } {
  let worstGap = 0;
  for (const s of runOff) worstGap = Math.max(worstGap, Math.abs((s.cohort.developmentEmerged ?? 0) - total(s.cohort)));
  const problems: string[] = [];
  if (runOff.length === 0) problems.push('no cohort reached run-off');
  if (!(worstGap < 0.01)) problems.push(`worst $${worstGap.toExponential(2)}`);
  return { problems, worst: worstGap };
}
check(runOff.length > 0, 'cohorts have reached run-off', `${runOff.length} of ${based.length}`);
{
  const r = sectionRunOff(c => c.developmentTotal ?? 0);
  check(r.problems.length === 0, 'emerged == total, to the cent, on every run-off cohort', `worst $${r.worst.toExponential(2)}`);
}

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
// `pct` is the percentage the total should be; the control feeds it x 1.1.
function sectionPct(pct: (l: CoverageLine) => number): { problems: string[]; worst: number } {
  let worstPct = 0;
  for (const s of canDevelop) {
    const want = (s.cohort.developmentBase ?? 0) * pct(s.line);
    worstPct = Math.max(worstPct, Math.abs((s.cohort.developmentTotal ?? 0) - want));
  }
  const problems: string[] = [];
  if (canDevelop.length === 0) problems.push('no cohort with payments left to pace against');
  if (!(worstPct < 0.01)) problems.push(`worst $${worstPct.toExponential(2)}`);
  return { problems, worst: worstPct };
}
check(canDevelop.length > 0, 'there are cohorts with payments left to pace against',
  `${canDevelop.length} of ${based.length}`);
{
  const r = sectionPct(l => PRIOR_DEVELOPMENT_DEFAULTS[l]);
  check(r.problems.length === 0, 'developmentTotal == pct x base on every one of them', `worst $${r.worst.toExponential(2)}`);
}
check(cannot.every(s => (s.cohort.developmentTotal ?? 0) === 0 && (s.cohort.developmentEmerged ?? 0) === 0),
  'and a cohort past the end of its payout table takes none',
  `${cannot.length} such cohort(s)`);

// --------------------------------------------------------------------------
console.log('\n--- 3. FAVOURABLE WORKS, AND IT IS PROPERTY ---');
// `emerged` reads a cohort's emerged amount; the control drops its sign.
function sectionSign(emerged: (c: ReserveCohort) => number): { problems: string[]; pr: number; prNeg: number; wc: number; wcPos: number } {
  const pr = runOff.filter(s => s.line === 'Property' && (s.cohort.developmentTotal ?? 0) !== 0);
  const prNegative = pr.filter(s => emerged(s.cohort) < 0);
  const wc = runOff.filter(s => s.line === 'WC' && (s.cohort.developmentTotal ?? 0) !== 0);
  const wcPositive = wc.filter(s => emerged(s.cohort) > 0);
  const problems: string[] = [];
  if (pr.length === 0) problems.push('no Property run-off cohort with a base');
  if (prNegative.length !== pr.length) problems.push(`${pr.length - prNegative.length} Property cohort(s) not negative`);
  if (wc.length === 0 || wcPositive.length !== wc.length) problems.push(`WC positive ${wcPositive.length} of ${wc.length}`);
  return { problems, pr: pr.length, prNeg: prNegative.length, wc: wc.length, wcPos: wcPositive.length };
}
{
  const r = sectionSign(c => c.developmentEmerged ?? 0);
  check(r.pr > 0, 'Property has run-off cohorts with a base', `${r.pr}`);
  check(r.prNeg === r.pr,
    'every one of them emerged NEGATIVE — favourable is not an absolute value',
    `${r.prNeg} of ${r.pr}`);
  check(r.wc > 0 && r.wcPos === r.wc,
    'and WC, which is adverse, emerged POSITIVE',
    `${r.wcPos} of ${r.wc}`);
}

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
//
// `want` is the closed form; the control feeds equal pacing (total / 10 per
// year), the recorded break 1 moved into the grader.
type Want = (total: number, base: number, openNow: number, c: ReserveCohort) => number;
const closedForm: Want = (total, base, openNow) => total * (base - openNow) / base;
function sectionPath(want: Want): { problems: string[]; worst: number; n: number } {
  let worstPath = 0;
  let pathChecked = 0;
  for (const s of sightings) {
    const c = s.cohort;
    const total = c.developmentTotal ?? 0;
    const base = c.developmentBaseOpenShare ?? 0;
    if (total === 0 || !(base > 0)) continue;
    pathChecked++;
    const openNow = unpaidShare(LINE_PAYOUT_PATTERN[s.line], c.age + 1);
    worstPath = Math.max(worstPath, Math.abs((c.developmentEmerged ?? 0) - want(total, base, openNow, c)));
  }
  const problems: string[] = [];
  if (!(pathChecked > 500)) problems.push(`only ${pathChecked} sightings`);
  if (!(worstPath < 0.01)) problems.push(`worst $${worstPath.toExponential(2)}`);
  return { problems, worst: worstPath, n: pathChecked };
}
{
  const r = sectionPath(closedForm);
  check(r.n > 500, 'there are enough sightings to pin a path', `${r.n}`);
  check(r.worst < 0.01, 'emerged(age) == total x [u(base) - u(age+1)] / u(base), at every sighting',
    `worst $${r.worst.toExponential(2)}`);
}

console.log('\n--- 5. AT 0% NOTHING EMERGES ANYWHERE ---');
function sectionZero(p: Played): { problems: string[]; moved: number; of: number } {
  const anyMoved = p.last.filter(s => (s.cohort.developmentEmerged ?? 0) !== 0
    || (s.cohort.developmentTotal ?? 0) !== 0);
  return { problems: anyMoved.length === 0 && p.last.length > 0 ? [] : [`${anyMoved.length} moved`], moved: anyMoved.length, of: p.last.length };
}
const zero = play({ WC: 0, GL: 0, Property: 0 });
{
  const r = sectionZero(zero);
  check(r.problems.length === 0,
    'every cohort has total 0 and emerged 0 — which is what makes the baselines hold at 0%',
    `${r.moved} moved of ${r.of}`);
}

// --------------------------------------------------------------------------
console.log('\n--- CONTROLS — each section run on broken input, and each must FAIL ---');
const mustFail = (problems: string[], label: string) =>
  check(problems.length > 0, `control: ${label}`, problems.length ? `fails: ${problems.join('; ')}` : 'PASSED — the section cannot see the break');
// 0 runs with the switch still OFF here, so the host's development was read.
mustFail(sectionRetired(played).problems, '0 on the games played with ADVERSE_DEVELOPMENT off (the host\'s percentages read)');
mustFail(sectionRunOff(c => (c.developmentTotal ?? 0) * 0.99).problems, '1 against a total 1% short');
mustFail(sectionPct(l => PRIOR_DEVELOPMENT_DEFAULTS[l] * 1.1).problems, '2 against the percentage x 1.1');
mustFail(sectionSign(c => Math.abs(c.developmentEmerged ?? 0)).problems, "3 with Property's sign dropped");
mustFail(sectionPath((total, _b, openNow, c) => (openNow <= 0 ? total : Math.min(1, (c.age + 1) / 10) * total)).problems,
  '4 against equal pacing, a tenth of the total a year');
mustFail(sectionZero(played).problems, '5 on the defaults\' games, where development emerges');

// Restore the shipped switch.
ADVERSE_DEVELOPMENT.enabled = true;

console.log(`\n${RULE}`);
if (failed.length === 0) {
  console.log(`THE HOST'S DEVELOPMENT IS RETIRED AS SHIPPED; SWITCHED BACK ON, THE FULL PERCENTAGE EMERGES, AND NO MORE. ${checks} checks.`);
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
