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
//   NO GAP       every age from 1 to the line's pattern length is covered by
//                exactly one of the two.
//   NO STRAYS    nothing is held past the age its own pattern runs to.
//
// ⚠ IT ASSERTS COVERAGE BY AGE, NOT BY COUNT. A count test — "played + bulk
// equals the pattern length" — passes on a set that double-counts one year and
// omits another, which is the shape of the defect it is written against.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory, PRE_GAME_DEPTH, PRE_GAME_YEARS, MATURATION_YEARS } from '../../src/utils/priorHistoryEngine';
import { patternLengthYears, bulkAccidentYearAges } from '../../src/utils/openingReserves';
import { PRIOR_HISTORY_YEARS } from '../../src/data/pricingParameters';
import type { CoverageLine, LinePoolState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 4);

let failures = 0;
const fail = (s: string) => { failures++; if (failures <= 24) console.log(`  FAIL  ${s}`); };

console.log('=== OPENING PARTITION CHECK ===\n');
console.log(`  PRIOR_HISTORY_YEARS ${PRIOR_HISTORY_YEARS} · PRE_GAME_DEPTH ${PRE_GAME_DEPTH} `
  + `· PRE_GAME_YEARS ${PRE_GAME_YEARS} · MATURATION_YEARS ${MATURATION_YEARS} (derived)\n`);

// --------------------------------------------------------------------------
// 1. THE CONSTANTS THEMSELVES, before any game is played. If these disagree no
//    opening can be right, and the message says which way they drifted.
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
  if (lastBulkAge !== undefined && lastBulkAge !== patternLengthYears(line)) {
    fail(`${line}: bulk ends at age ${lastBulkAge}, not the pattern's ${patternLengthYears(line)}`);
  }
}
console.log(`  bulk begins at age ${PRIOR_HISTORY_YEARS + 1} on every line; `
  + `pattern lengths WC ${patternLengthYears('WC')} GL ${patternLengthYears('GL')} `
  + `Property ${patternLengthYears('Property')}.`);

// --------------------------------------------------------------------------
console.log('\n--- 2. THE OPENING ITSELF, ON PLAYED GAMES ---');
let checked = 0, dupTotal = 0;
for (let g = 0; g < GAMES; g++) {
  const id = `PT${g}`;
  const inst = generateGameInstance(id, 6_100_000 + g * 7919);
  const setup = {
    poolName: 'A', gameLength: 6, startingYear: 2026, instanceId: id, activeLines: LINES,
  };
  const { poolState } = runPriorHistory(inst, setup as never);

  for (const line of LINES) {
    checked++;
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
    // ⚠ AND THE TWO KINDS OF COHORT STORE `age` ON DIFFERENT CONVENTIONS,
    // which this gate got wrong first time and is worth stating because it is
    // a live trap. An ENGINE-BORN cohort holds a 0-based age: `age = a` is the
    // valuation at (a+1)x12 months, so its pattern age is `age + 1`. A SEEDED
    // cohort — instanceGenerator's and the bulk reserves alike — stores the
    // PATTERN AGE DIRECTLY, because that is what it was built from
    // (`age: ageYears`, paid at `cumulativePaid(ageYears)`). Reading `age + 1`
    // on both made the bulk set look one year too old: age 6 held by nothing
    // and a stray at the pattern's length plus one, on every line.
    const patternAge = (c: { age: number; seeded?: boolean }) =>
      c.seeded === true ? c.age : c.age + 1;
    const byAge = new Map<number, number>();
    for (const c of cohorts) byAge.set(patternAge(c), (byAge.get(patternAge(c)) ?? 0) + 1);
    const len = patternLengthYears(line);
    const missing: number[] = [];
    for (let a = 1; a <= len; a++) if (!byAge.has(a)) missing.push(a);
    if (missing.length > 0) {
      fail(`${line} g${g}: ${missing.length} age(s) held by NOTHING — ${missing.slice(0, 8).join(', ')}`);
    }
    const strays = [...byAge.keys()].filter(a => a < 1 || a > len);
    if (strays.length > 0) {
      fail(`${line} g${g}: ${strays.length} cohort age(s) past the pattern's ${len} — ${strays.slice(0, 6).join(', ')}`);
    }

    if (g === 0) {
      console.log(`  ${line.padEnd(9)} ${String(cohorts.length).padStart(3)} cohorts = `
        + `${String(played.length).padStart(2)} played (ages 1-${PRIOR_HISTORY_YEARS}) `
        + `+ ${String(bulk.length).padStart(2)} bulk (ages ${PRIOR_HISTORY_YEARS + 1}-${len})`);
    }
  }
}
console.log(`\n  ${checked} line-openings checked; ${dupTotal} duplicated accident year(s).`);

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
  ? 'PLAYED AND BULK PARTITION THE OPENING: NO YEAR TWICE, NO AGE UNCOVERED, NOTHING PAST ITS PATTERN.'
  : `${failures} FAILURE(S).`}`);
process.exit(failures === 0 ? 0 : 1);
