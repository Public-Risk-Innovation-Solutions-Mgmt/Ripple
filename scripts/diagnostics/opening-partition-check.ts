// ============================================================================
// PLAYED YEARS AND BULK YEARS PARTITION THE OPENING — NO OVERLAP, NO GAP.
//
//   npx tsx scripts/diagnostics/opening-partition-check.ts
//
// ⚠ THIS GATE EXISTS BECAUSE THE COUPLING IT ASSERTS WAS NEVER WRITTEN DOWN.
// The pre-game's depth and the age bulk reserves begin at were two separate
// constants that happened to agree: PRE_GAME_DEPTH was a fixed 10 and bulk
// began at PRIOR_HISTORY_YEARS + 1 = 11, so the pre-game's last played year sat
// exactly one short of the first bulk year. Nothing said they had to.
//
// Dropping PRIOR_HISTORY_YEARS to 5 while the pre-game went on playing ten
// years put accident years 6 to 10 in BOTH sets — the opening held each of them
// twice and double-counted the reserve. The depth is derived from the one
// parameter now, and this gate is what keeps the two from drifting apart again.
//
// THE PARTITION, stated as the three things that must all hold:
//
//   NO OVERLAP   no accident year is both a played cohort and a bulk cohort,
//                and no year appears twice in the opening at all.
//   NO GAP       every age from 1 to the OPENING WINDOW — OPENING_RESERVE_YEARS,
//                or the line's pattern if that is shorter — is covered by
//                exactly one of the two.
//   NO STRAYS    nothing is held past the window: older accident years are
//                closed (Prompt A commit 2; the window was each pattern's
//                full length before).
//
// AND THE OPENING PAYS FROM WHERE IT SAYS IT IS:
//
//   AGE = PAID   every opening cohort's unpaid share is its pattern's unpaid
//                share at its own pattern age (`age + 1`), on ONE convention for
//                played and bulk cohorts alike.
//   ONE STEP     year 1 pays each bulk cohort one pattern step, not two.
//
// AND THE PRE-GAME CARRIES THE BULK YEARS, so the opening is no jump:
//
//   NO JUMP      the last pre-game year's ending net reserve IS the opening
//                net reserve, and the first pre-game year opens with the bulk
//                years on its books (Prompt A commit 2).
//
// ⚠ IT ASSERTS COVERAGE BY AGE, NOT BY COUNT. A count test — "played + bulk
// equals the pattern length" — passes on a set that double-counts one year and
// omits another, which is the shape of the defect it is written against.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory, PRE_GAME_DEPTH, PRE_GAME_YEARS, MATURATION_YEARS } from '../../src/utils/priorHistoryEngine';
import { patternLengthYears, bulkAccidentYearAges } from '../../src/utils/openingReserves';
import { LINE_PAYOUT_PATTERN } from '../../src/data/defaultAssumptions';
import { cohortCloseBelow, conditionalPaydown, unpaidShare } from '../../src/utils/payoutPattern';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { openWorlds, playWorldsYear, settleWorldsYear, commitSettledYear } from '../../src/utils/worlds';
import type { GameState, ReserveCohort } from '../../src/types/simulation';
import { OPENING_RESERVE_YEARS, PRIOR_HISTORY_YEARS } from '../../src/data/pricingParameters';
import type { CoverageLine, LinePoolState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 4);

let failures = 0;
/** The opening reserve is not the pre-game's last year-end reserve. */
const jumps = (endOfPreGame: number, opening: number) => Math.abs(endOfPreGame - opening) > 1e-6 * Math.max(1, opening);
const fail = (s: string) => { failures++; if (failures <= 24) console.log(`  FAIL  ${s}`); };

console.log('=== OPENING PARTITION CHECK ===\n');
console.log(`  PRIOR_HISTORY_YEARS ${PRIOR_HISTORY_YEARS} · PRE_GAME_DEPTH ${PRE_GAME_DEPTH} `
  + `· PRE_GAME_YEARS ${PRE_GAME_YEARS} · MATURATION_YEARS ${MATURATION_YEARS} (derived)\n`);

// --------------------------------------------------------------------------
// 1. THE CONSTANTS THEMSELVES, before any game is played. If these disagree no
//    opening can be right, and the message says which way they drifted.
/** The opening window on a line: OPENING_RESERVE_YEARS, or its pattern if shorter. */
function windowOf(line: CoverageLine): number { return Math.min(OPENING_RESERVE_YEARS, patternLengthYears(line)); }
/**
 * An age the engine has CLOSED by the opening: its pattern's unpaid share is
 * under the close floor (cohortCloseBelow, as a share of ultimate), so the
 * cohort paid out its remainder and left. Since the bulk years run through
 * the pre-game (Prompt A commit 2) they meet that rule like any cohort —
 * Property's oldest close inside the pre-game — so NO GAP excuses exactly
 * these ages and no others.
 */
function closedByOpening(line: CoverageLine, patternAge: number): boolean {
  return unpaidShare(LINE_PAYOUT_PATTERN[line], patternAge) < cohortCloseBelow(LINE_PAYOUT_PATTERN[line], 1);
}

console.log('--- 1. THE TWO PARTITIONS MEET, AT THE PARAMETER LEVEL ---');
if (PRE_GAME_DEPTH !== PRIOR_HISTORY_YEARS) {
  fail(`PRE_GAME_DEPTH ${PRE_GAME_DEPTH} is not PRIOR_HISTORY_YEARS ${PRIOR_HISTORY_YEARS} — `
    + 'the pre-game plays a different number of years than the pricing reads');
}
for (const line of LINES) {
  const firstBulkAge = bulkAccidentYearAges(line)[0];
  const expected = PRIOR_HISTORY_YEARS + 1;
  if (firstBulkAge !== undefined && firstBulkAge !== expected) {
    fail(`${line}: bulk begins at age ${firstBulkAge}, not ${expected} — it must start one past the `
      + 'last played year');
  }
  const lastBulkAge = bulkAccidentYearAges(line).slice(-1)[0];
  if (lastBulkAge !== undefined && lastBulkAge !== windowOf(line)) {
    fail(`${line}: bulk ends at age ${lastBulkAge}, not the window's ${windowOf(line)}`);
  }
}
console.log(`  bulk begins at age ${PRIOR_HISTORY_YEARS + 1} on every line and ends at the window: `
  + `WC ${windowOf('WC')} GL ${windowOf('GL')} Property ${windowOf('Property')} `
  + `(OPENING_RESERVE_YEARS ${OPENING_RESERVE_YEARS}; patterns ${patternLengthYears('WC')}/${patternLengthYears('GL')}/${patternLengthYears('Property')}).`);

// --------------------------------------------------------------------------
console.log('\n--- 2. THE OPENING ITSELF, ON PLAYED GAMES ---');
let checked = 0, dupTotal = 0;
for (let g = 0; g < GAMES; g++) {
  const id = `PT${g}`;
  const inst = generateGameInstance(id, 6_100_000 + g * 7919);
  const setup = {
    poolName: 'A', gameLength: 6, startingYear: 2026, instanceId: id, activeLines: LINES,
  };
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(inst, setup as never);
  const firstPreGame = (earlyPreGameHistory ?? [])[0] ?? priorHistory[0];

  for (const line of LINES) {
    checked++;
    // NO JUMP — the last pre-game year ends on the opening's reserve, and the
    // first begins with the bulk years already on the books.
    const endOfPreGame = priorHistory.at(-1)!.byLine[line].endingNetReserve;
    const openingReserve = (poolState.lines[line] as LinePoolState).netUnpaidReserve;
    if (jumps(endOfPreGame, openingReserve)) {
      fail(`${line} g${g}: the reserve JUMPS at the opening — $${(endOfPreGame / 1e6).toFixed(2)}M at the last pre-game `
        + `year-end, $${(openingReserve / 1e6).toFixed(2)}M at the opening`);
    }
    if (!(firstPreGame.byLine[line].beginningNetReserve > 0)) {
      fail(`${line} g${g}: the first pre-game year opens with no reserve — the bulk years are not on its books`);
    }
    const cohorts = (poolState.lines[line] as LinePoolState).reserveCohorts ?? [];
    const played = cohorts.filter(c => c.seeded !== true);
    const bulk = cohorts.filter(c => c.seeded === true);

    // NO OVERLAP — by accident year, across the whole opening.
    const seen = new Map<number, number>();
    for (const c of cohorts) seen.set(c.yearNumber, (seen.get(c.yearNumber) ?? 0) + 1);
    const dups = [...seen.entries()].filter(([, n]) => n > 1);
    dupTotal += dups.length;
    if (dups.length > 0) {
      fail(`${line} g${g}: ${dups.length} accident year(s) held TWICE — `
        + `${dups.slice(0, 6).map(([y, n]) => `AY${y} x${n}`).join(', ')}`);
    }
    const playedYears = new Set(played.map(c => c.yearNumber));
    const both = bulk.filter(c => playedYears.has(c.yearNumber));
    if (both.length > 0) {
      fail(`${line} g${g}: ${both.length} year(s) are BOTH played and bulk — `
        + `${both.slice(0, 6).map(c => `AY${c.yearNumber}`).join(', ')}`);
    }

    // NO GAP — every age 1..patternLength covered exactly once.
    //
    // ⚠ AGE, NOT yearNumber. Counting years would not notice a missing middle.
    //
    // ⚠ ONE CONVENTION FOR EVERY COHORT: `age` counts steps taken, so the
    // pattern age is `age + 1`. This gate used to read a SEEDED cohort's `age`
    // as its pattern age directly, because the bulk reserves stored it that way
    // (`age: ageYears`) — and that was the defect, not a second convention: the
    // engine steps every cohort to `age + 2`, so a bulk cohort skipped a year
    // and year 1 paid it two years' worth. Section 3 now asserts the convention
    // against the paid-to-date, which is what the age has to agree with.
    const patternAge = (c: { age: number }) => c.age + 1;
    const byAge = new Map<number, number>();
    for (const c of cohorts) byAge.set(patternAge(c), (byAge.get(patternAge(c)) ?? 0) + 1);
    const len = windowOf(line);
    const missing: number[] = [];
    for (let a = 1; a <= len; a++) if (!byAge.has(a) && !closedByOpening(line, a)) missing.push(a);
    if (missing.length > 0) {
      fail(`${line} g${g}: ${missing.length} age(s) held by NOTHING — ${missing.slice(0, 8).join(', ')}`);
    }
    const strays = [...byAge.keys()].filter(a => a < 1 || a > len);
    if (strays.length > 0) {
      fail(`${line} g${g}: ${strays.length} cohort age(s) past the window's ${len} — ${strays.slice(0, 6).join(', ')}`);
    }

    if (g === 0) {
      console.log(`  ${line.padEnd(9)} ${String(cohorts.length).padStart(3)} cohorts = `
        + `${String(played.length).padStart(2)} played (ages 1-${PRIOR_HISTORY_YEARS}) `
        + `+ ${String(bulk.length).padStart(2)} bulk (ages ${PRIOR_HISTORY_YEARS + 1}-${len}`
        + `${[...Array(len).keys()].map(i => i + 1).some(a => closedByOpening(line, a)) ? `; closed from age ${[...Array(len).keys()].map(i => i + 1).find(a => closedByOpening(line, a))}` : ''})`);
    }
  }
}
console.log(`\n  ${checked} line-openings checked; ${dupTotal} duplicated accident year(s).`);

// THE NO-JUMP CONTROL — the opening this replaced: WC's pre-game ended 2025 at
// $38.7M of reserve and opened at $74.7M once the runoff was swapped in.
if (!jumps(38.7e6, 74.7e6)) fail('control: the old reserve jump at the opening was not caught');
else console.log('  control: the old jump ($38.7M at year-end, $74.7M at the opening) is caught');

// --------------------------------------------------------------------------
// 3 and 4. THE AGE AGREES WITH THE PAID-TO-DATE, AND YEAR 1 PAYS ONE STEP.
// Each is a function over data, so the control can feed it the defect.

/** Opening cohorts whose unpaid share is not their pattern's at `age + 1`. */
function ageDisagrees(line: CoverageLine, cohorts: readonly ReserveCohort[]): string[] {
  // A closed cohort paid its remainder at the close; its unpaid is 0 by design.
  return cohorts.filter(c => c.netUltimate > 0 && !(c.closed || c.netUnpaid === 0 && closedByOpening(line, c.age + 1))).flatMap(c => {
    const want = unpaidShare(LINE_PAYOUT_PATTERN[line], c.age + 1);
    const got = c.netUnpaid / c.netUltimate;
    return Math.abs(got - want) > 1e-9 ? [`AY${c.yearNumber} age ${c.age}: unpaid share ${got.toFixed(4)}, pattern ${want.toFixed(4)}`] : [];
  });
}

/** Year 1's payment on the bulk cohorts ÷ one pattern step on their opening balances. */
function yearOneStepRatio(line: CoverageLine, opening: readonly ReserveCohort[], after: readonly ReserveCohort[]): number {
  let paid = 0, step = 0;
  for (const c of opening.filter(x => x.seeded === true)) {
    const a = after.find(x => x.yearNumber === c.yearNumber);
    paid += a ? a.netPaid - c.netPaid : c.netUnpaid;
    step += c.netUnpaid * conditionalPaydown(LINE_PAYOUT_PATTERN[line], c.age + 2);
  }
  return paid / step;
}

/** Play year 1 in its worlds from an opening; world 1's cohorts after it. */
function playYearOne(base: GameState): Record<string, ReserveCohort[]> {
  const gs = openWorlds(base);
  const s = settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(1)), []);
  const w = commitSettledYear(gs, s).worlds![0];
  return Object.fromEntries(LINES.map(l => [l, (w.poolState.lines[l] as LinePoolState).reserveCohorts ?? []]));
}

// Year 1 pays its bulk cohorts within this of one step. The cohorts' own
// development and the forward-booking true-up move it a few points (WC 1.02,
// GL 1.09 measured); the defect paid 1.6-2.0x.
const STEP_TOLERANCE = 1.15;

console.log('\n--- 3. EVERY OPENING COHORT\'S PAID-TO-DATE IS ITS AGE\'S ---');
console.log('--- 4. YEAR 1 PAYS EACH BULK COHORT ONE PATTERN STEP ---');
let control: { opening: GameState; ages: Record<string, ReserveCohort[]> } | undefined;
for (let g = 0; g < 2; g++) {
  const id = `PS${g}`;
  const inst = generateGameInstance(id, 6_300_000 + g * 7919);
  const setup = { poolName: 'A', gameLength: 6, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  const base: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const after = playYearOne(base);
  for (const line of LINES) {
    const opening = (poolState.lines[line] as LinePoolState).reserveCohorts ?? [];
    const bad = ageDisagrees(line, opening);
    if (bad.length > 0) fail(`${line} g${g}: ${bad.length} cohort(s) whose age disagrees with their paid — ${bad[0]}`);
    const r = yearOneStepRatio(line, opening, after[line]);
    if (!(r > 1 / STEP_TOLERANCE && r < STEP_TOLERANCE)) fail(`${line} g${g}: year 1 paid the bulk cohorts ${r.toFixed(2)}x one step`);
    if (g === 0) console.log(`  ${line.padEnd(9)} ${opening.length} cohorts agree with their age; year 1 paid bulk ${r.toFixed(3)}x one step`);
  }
  if (g === 0) control = { opening: base, ages: Object.fromEntries(LINES.map(l => [l, (poolState.lines[l] as LinePoolState).reserveCohorts ?? []])) };
}

// THE CONTROL — the defect itself: bulk cohorts a year older than their paid.
console.log('\n--- CONTROL: the old bulk ages (pattern age stored as `age`) ---');
{
  const { opening } = control!;
  const bumped: GameState = {
    ...opening,
    poolState: {
      ...opening.poolState,
      lines: Object.fromEntries(Object.entries(opening.poolState.lines).map(([l, ls]) => [l, {
        ...(ls as LinePoolState),
        reserveCohorts: ((ls as LinePoolState).reserveCohorts ?? []).map(c => (c.seeded ? { ...c, age: c.age + 1 } : c)),
      }])) as GameState['poolState']['lines'],
    },
  };
  const after = playYearOne(bumped);
  for (const line of ['WC', 'GL'] as CoverageLine[]) {
    const coh = (bumped.poolState.lines[line] as LinePoolState).reserveCohorts ?? [];
    const caught3 = ageDisagrees(line, coh).length > 0;
    const r = yearOneStepRatio(line, coh.map(c => (c.seeded ? { ...c, age: c.age - 1 } : c)), after[line]);
    const caught4 = !(r > 1 / STEP_TOLERANCE && r < STEP_TOLERANCE);
    console.log(`  ${line}: age-vs-paid ${caught3 ? 'caught' : 'MISSED'}; year 1 paid ${r.toFixed(2)}x one step — ${caught4 ? 'caught' : 'MISSED'}`);
    if (!caught3 || !caught4) fail(`control on ${line}: the old bulk ages were not caught`);
  }
}

// --------------------------------------------------------------------------
// THE CONTROL — run by hand against the defect this was written for, recorded
// here rather than run every time.
//
//   Restore the old coupling: `export const PRE_GAME_DEPTH = 10` in place of
//   the derivation, leaving PRIOR_HISTORY_YEARS at 5. MEASURED: exit 1, 24
//   failures — "5 accident year(s) held TWICE" and "5 year(s) are BOTH played
//   and bulk" on WC and GL, 2 each on Property, in every game, plus the
//   parameter-level failure at section 1.
// --------------------------------------------------------------------------
console.log(`\n${failures === 0
  ? 'PLAYED AND BULK PARTITION THE OPENING: NO YEAR TWICE, NO AGE UNCOVERED, NOTHING PAST THE WINDOW, NO JUMP.'
  : `${failures} FAILURE(S).`}`);
process.exit(failures === 0 ? 0 : 1);
