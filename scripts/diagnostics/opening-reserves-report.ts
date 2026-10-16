// ============================================================================
// THE SET OPENING, BESIDE TODAY'S — A READING, NOT A GATE.
//
//   npx tsx scripts/diagnostics/opening-reserves-report.ts
//
// ⚠ IT ASSERTS NOTHING AND EXITS 0 ON ANY NUMBER. openingReserves.ts is
// recorded and unwired at commit (a); there is no bar these figures are
// supposed to clear until commit (b) makes them the opening. A gate with an
// invented threshold would be a number somebody tunes TO.
//
// What it is FOR is making commit (b) predictable. (b) moves every baseline,
// and a baseline move whose size was not known beforehand cannot be checked —
// it can only be accepted. This prints what the set opening will be, against
// what the search produces today, so (b)'s recapture is a confirmation rather
// than a discovery.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import {
  bulkAccidentYearAges, bulkOpeningCohorts, bulkOpeningReserve,
  expectedGrossUltimateAtAge, heldGrossPurePremiumPer100, patternLengthYears,
  rateTrendPerYear, towerCessionRatio, unpaidShareAtAge,
} from '../../src/utils/openingReserves';
import {
  OPENING_SURPLUS_MULTIPLE_OF_REQUIRED, PRIOR_HISTORY_YEARS,
} from '../../src/data/pricingParameters';
import { staticClf } from '../../src/data/clfTables';
import type { CoverageLine, LinePoolState, Member } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 6);
const m$ = (x: number) => `$${(x / 1e6).toFixed(1)}M`;
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);

console.log('=== THE SET OPENING, BESIDE TODAY\'S SEARCH ===\n');
console.log(`  prior history ${PRIOR_HISTORY_YEARS} years with real claims; everything older is a BULK cohort.`);
console.log(`  opening surplus = ${OPENING_SURPLUS_MULTIPLE_OF_REQUIRED} x required capital,`);
console.log('  where required capital = expectedNetUnpaidLoss x (staticClf(line, 0.90) - 1).\n');

// --------------------------------------------------------------------------
console.log('--- 1. THE SHAPE OF THE RUNOFF ---');
console.log('  line      pattern   bulk ages   rate trend   cession@yr1   cession@yr10   bias');
const inst0 = generateGameInstance('OPEN0', 6_100_000);
const setup0 = { poolName: 'A', gameLength: 10, startingYear: 2026, instanceId: 'OPEN0', activeLines: LINES };
const { poolState: ps0 } = runPriorHistory(inst0, setup0 as never);
const openingMembers: Record<string, Member[]> = {};
for (const l of LINES) openingMembers[l] = (ps0.lines[l] as LinePoolState).members ?? [];

for (const line of LINES) {
  const members = openingMembers[line];
  const ages = bulkAccidentYearAges(line);
  const c1 = towerCessionRatio(line, members, 1);
  const c10 = towerCessionRatio(line, members, 10);
  console.log(`  ${line.padEnd(9)} ${String(patternLengthYears(line)).padStart(5)}y `
    + `${(ages.length ? `${ages[0]}-${ages[ages.length - 1]}` : 'none').padStart(11)} `
    + `${((rateTrendPerYear(line) * 100).toFixed(2) + '%').padStart(12)} `
    + `${((c1 * 100).toFixed(2) + '%').padStart(13)} ${((c10 * 100).toFixed(2) + '%').padStart(14)} `
    + `${((c10 - c1 >= 0 ? '+' : '') + ((c10 - c1) * 100).toFixed(2) + 'pp').padStart(8)}`);
}
console.log('\n  ⚠ THE CESSION BIAS, MEASURED RATHER THAN ASSERTED. Bulk cohorts take year 1\'s');
console.log('    cession ratio because every severity trend floors at year 1 and the tower');
console.log('    cannot be asked for a deflated level. The year-10 column is the same ratio at');
console.log('    a level 55% higher; the gap is how much a fixed-dollar attachment moves with');
console.log('    the trend, and it bounds the error on the OLDER years in the other direction.');

// --------------------------------------------------------------------------
console.log('\n--- 2. THE BULK COHORTS, PER LINE ---');
for (const line of LINES) {
  const members = openingMembers[line];
  const cohorts = bulkOpeningCohorts(line, members);
  const total = bulkOpeningReserve(line, members);
  const y1Gross = expectedGrossUltimateAtAge(line, 0, members);
  console.log(`\n  ${line} — held gross rate ${heldGrossPurePremiumPer100(line, members).toFixed(4)}/100, `
    + `year-1 expected gross ultimate ${m$(y1Gross)}`);
  console.log(`    ${cohorts.length} bulk cohorts, total NET reserve ${m$(total)}`);
  console.log('      age   unpaid%    net ultimate    net unpaid');
  for (const c of cohorts.slice(0, 4)) {
    console.log(`     ${String(c.ageYears).padStart(4)}y ${((unpaidShareAtAge(line, c.ageYears) * 100).toFixed(2) + '%').padStart(9)} `
      + `${m$(c.netUltimate).padStart(15)} ${m$(c.netUnpaid).padStart(13)}`);
  }
  if (cohorts.length > 6) console.log(`      ... ${cohorts.length - 6} more ...`);
  for (const c of cohorts.slice(-2)) {
    console.log(`     ${String(c.ageYears).padStart(4)}y ${((unpaidShareAtAge(line, c.ageYears) * 100).toFixed(2) + '%').padStart(9)} `
      + `${m$(c.netUltimate).padStart(15)} ${m$(c.netUnpaid).padStart(13)}`);
  }
}

// --------------------------------------------------------------------------
console.log('\n--- 3. AGAINST TODAY\'S SEARCHED OPENING ---');
console.log('  line       today reserve   today surplus   + bulk reserve   set surplus   reserve x');
for (const line of LINES) {
  const todayRes: number[] = [], todaySur: number[] = [];
  let members: Member[] = [];
  for (let g = 0; g < GAMES; g++) {
    const id = `OPEN${g}`;
    const inst = generateGameInstance(id, 6_100_000 + g * 7919);
    const setup = { poolName: 'A', gameLength: 10, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState } = runPriorHistory(inst, setup as never);
    const ls = poolState.lines[line] as LinePoolState;
    todayRes.push((ls.reserveCohorts ?? []).reduce((a, c) => a + c.netUnpaid, 0));
    todaySur.push(ls.surplus ?? 0);
    if (g === 0) members = ls.members ?? [];
  }
  const bulk = bulkOpeningReserve(line, members);
  const played = mean(todayRes);
  const setRes = played + bulk;
  const margin = staticClf(line as 'WC', 0.90) - 1;
  const setSur = setRes * margin * OPENING_SURPLUS_MULTIPLE_OF_REQUIRED;
  console.log(`  ${line.padEnd(9)} ${m$(played).padStart(14)} ${m$(mean(todaySur)).padStart(15)} `
    + `${m$(bulk).padStart(16)} ${m$(setSur).padStart(13)} ${(setRes / Math.max(played, 1)).toFixed(2).padStart(10)}`);
}
console.log('\n  ⚠ "today reserve" IS THE SEARCHED OPENING AND STILL CONTAINS SEED COHORTS. At');
console.log('    commit (b) those are replaced by the played prior years plus the bulk ones, so');
console.log('    the "+ bulk reserve" column is an ADDITION to the played years only once the');
console.log('    seeds come out. The reserve multiple on the right is the honest comparison.');
console.log('\n  ASSERTS NOTHING. Commit (b) makes these the opening and recaptures the baselines.\n');
