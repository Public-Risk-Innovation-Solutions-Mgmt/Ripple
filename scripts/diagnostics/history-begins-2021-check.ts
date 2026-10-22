// ============================================================================
// THE POOL'S HISTORY BEGINS IN 2021 — A GATE.
//
//   npx tsx scripts/diagnostics/history-begins-2021-check.ts
//
// There are no accident years before the first pre-game year. On played
// openings, every line:
//
//   1. THE PRE-GAME STARTS EMPTY: its first year begins with no net reserve
//      and on the paid-in capital (STARTING_CAPITAL) alone.
//   2. THE OPENING HOLDS EXACTLY THE PRE-GAME'S YEARS: one cohort and one ledger
//      row for each of the PRE_GAME_DEPTH played accident years (2021 to 2025
//      for a 2026 start), and nothing older.
//   3. NO JUMP: the last pre-game year ends on the opening's net reserve.
//   4. PRICING READS THE YEARS THERE ARE: the window the year-y rate reads,
//      rebuilt from the opening's ledger as it stood then, holds 0 usable years
//      in 2021 (so the first year prices on the starting expected loss, trended,
//      at the book's own risk — exactly bookPurePremium's with no history),
//      then 1, 2, 3, 4, and the full 5 at year 1.
//
// Replaces opening-partition-check, whose subject — played and BULK accident
// years partitioning the opening — is retired with the bulk years.
//
// ⚠ AND EACH FAILS WHEN BROKEN: the controls feed every predicate an opening
// with an older year added, a pre-game that starts with a reserve, a jump, and
// a ledger carrying a pre-2021 row.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory, PRE_GAME_DEPTH } from '../../src/utils/priorHistoryEngine';
import { bookPurePremium, newPurePremiumPer100 } from '../../src/utils/newPurePremium';
import { STARTING_CAPITAL, PRICING_WINDOW_YEARS_NEW } from '../../src/data/pricingParameters';
import { lineBookRisk } from '../../src/utils/bookUnits';
import type { CoverageLine, LineResultSet, ReserveCohort, ReserveDevelopmentRow, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 4);
const FIRST = -(PRE_GAME_DEPTH - 1);   // the first pre-game year's yearNumber
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

interface Opening {
  line: CoverageLine; game: number;
  firstYear: LineResultSet; years: LineResultSet[];          // every pre-game year, oldest first
  cohorts: ReserveCohort[]; ledger: ReserveDevelopmentRow[]; netReserve: number; startingSurplus: number;
  /** The book's true risk — the pre-game moves no unit, so the opening's is 2021's. */
  risk: number;
}

function openings(): Opening[] {
  const out: Opening[] = [];
  for (let g = 0; g < GAMES; g++) {
    const id = `H21${g}`;
    const inst = generateGameInstance(id, 6_100_000 + g * 7919);
    const setup = { poolName: 'H', gameLength: 6, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(inst, setup as never);
    const all: ResultSet[] = [...(earlyPreGameHistory ?? []), ...priorHistory];
    for (const line of LINES) {
      const ls = poolState.lines[line];
      const years = all.map(r => r.byLine[line]!);
      out.push({
        line, game: g, firstYear: years[0], years, cohorts: ls.reserveCohorts ?? [], ledger: ls.reserveDevelopment ?? [],
        netReserve: ls.netUnpaidReserve, startingSurplus: years[0].beginingSurplus,
        risk: lineBookRisk(inst, line, poolState.bookUnits, poolState.bookLedger) ?? 1,
      });
    }
  }
  return out;
}

function gradeStart(os: Opening[], tag: string) {
  const bad = os.filter(o => o.firstYear.beginningNetReserve !== 0 || Math.abs(o.startingSurplus - STARTING_CAPITAL[o.line]) > 0.01);
  check(bad.length === 0, `${tag}1. the pre-game starts empty: no reserve, on its paid-in capital alone`,
    bad.length ? `${bad[0].line} g${bad[0].game}: reserve $${bad[0].firstYear.beginningNetReserve.toFixed(0)}, surplus $${bad[0].startingSurplus.toFixed(0)}`
      : `${os.length} line-openings, first year ${2026 + FIRST - 1} begins at $0 reserve and $${(STARTING_CAPITAL.WC / 1e6).toFixed(0)}M`);
}

function gradeOpening(os: Opening[], tag: string) {
  const want = Array.from({ length: PRE_GAME_DEPTH }, (_, i) => FIRST + i).join(',');
  const bad = os.filter(o =>
    [...o.cohorts.map(c => c.yearNumber)].sort((a, b) => a - b).join(',') !== want
    || [...o.ledger.map(r => r.yearNumber)].sort((a, b) => a - b).join(',') !== want);
  const oldest = Math.min(...os.flatMap(o => o.cohorts.map(c => c.calendarYear)));
  check(bad.length === 0, `${tag}2. the opening holds exactly the pre-game's ${PRE_GAME_DEPTH} accident years, and nothing older`,
    bad.length ? `${bad[0].line} g${bad[0].game}: cohorts ${bad[0].cohorts.map(c => c.yearNumber).join(',')}`
      : `oldest accident year ${oldest}`);
}

function gradeJump(os: Opening[], tag: string) {
  const bad = os.filter(o => Math.abs(o.years[o.years.length - 1].endingNetReserve - o.netReserve) > 1e-6 * Math.max(1, o.netReserve));
  check(bad.length === 0, `${tag}3. no jump: the last pre-game year ends on the opening's net reserve`, `${bad.length} jumps`);
}

/** The ledger as it stood at the start of year y: rows for earlier accident years, valuations up to y - 1. */
function ledgerAt(ledger: ReserveDevelopmentRow[], y: number): ReserveDevelopmentRow[] {
  return ledger.filter(r => r.yearNumber < y).map(r => {
    const n = y - r.firstValuationYear;
    return {
      ...r,
      ultimateByValuation: r.ultimateByValuation.slice(0, n),
      paidByValuation: (r.paidByValuation ?? []).slice(0, n),
      grossPaidByValuation: (r.grossPaidByValuation ?? []).slice(0, n),
    };
  });
}

function gradePricing(os: Opening[], tag: string) {
  const counts: string[] = [];
  let wrong = 0, firstOff = 0;
  for (const o of os) {
    const got: number[] = [];
    for (let y = FIRST; y <= 1; y++) {
      const r = newPurePremiumPer100(o.line, y, { rows: ledgerAt(o.ledger, y), allMarketMembers: [], membershipHistory: {} });
      got.push(r?.points.length ?? 0);
    }
    const want = got.map((_, i) => Math.min(i, PRICING_WINDOW_YEARS_NEW));
    if (got.join() !== want.join()) wrong++;
    if (counts.length === 0) counts.push(got.join(' / '));
    // The first year's rate is the no-history figure on the book's own risk, exactly.
    const f = o.firstYear;
    const expect = bookPurePremium(o.line, FIRST, { rows: [], allMarketMembers: [], membershipHistory: {} }, f.activeExposure, o.risk).purePremiumPer100;
    if (Math.abs((f.newPurePremiumPer100 ?? NaN) / expect - 1) > 1e-9) firstOff++;
  }
  check(wrong === 0 && firstOff === 0,
    `${tag}4. pricing reads the years there are: 0 in 2021 (the starting expected loss), then 1, 2, 3, 4, and 5 at year 1`,
    `usable years by pricing year ${counts[0]}; ${wrong} openings off; first-year rate off the no-history figure on ${firstOff}`);
}

console.log(`THE POOL'S HISTORY BEGINS IN ${2026 + FIRST - 1} — ${GAMES} games x ${LINES.length} lines`);
const os = openings();
gradeStart(os, '');
gradeOpening(os, '');
gradeJump(os, '');
gradePricing(os, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('a pre-game that starts with a reserve', () => gradeStart(os.map(o => ({
  ...o, firstYear: { ...o.firstYear, beginningNetReserve: 1e6 } })), ''), '1.');
controlFails('an opening with a 2020 accident year in it', () => gradeOpening(os.map(o => ({
  ...o, cohorts: [{ ...o.cohorts[0], yearNumber: FIRST - 1, calendarYear: o.cohorts[0].calendarYear - 1 }, ...o.cohorts] })), ''), '2.');
controlFails('a reserve that jumps at the opening', () => gradeJump(os.map(o => ({ ...o, netReserve: o.netReserve * 1.1 + 1 })), ''), '3.');
controlFails('a ledger carrying a pre-2021 row', () => gradePricing(os.map(o => ({
  ...o, ledger: [{ ...o.ledger.find(r => r.yearNumber === FIRST)!, yearNumber: FIRST - 1, firstValuationYear: FIRST - 1 }, ...o.ledger] })), ''), '4.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — the pre-game starts empty, the opening is its years and no older, and pricing reads the years there are.');
