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
//      row for each of the PRE_GAME_DEPTH played accident years (2021 to 2026
//      for a 2027 start), and nothing older.
//   3. NO JUMP: the last pre-game year ends on the opening's net reserve.
//   4. PRICING READS THE COMPLETE YEARS THERE ARE, A YEAR BEHIND: the window
//      the year-y rate reads, rebuilt from the opening's ledger as it stood
//      then, holds 0 usable years in 2021 and 2022 (so both price on the
//      starting expected loss, trended, at the book's own risk — exactly
//      bookPurePremium's with no history), then 1, 2, 3, 4, and the full 5 at
//      year 1 (2027).
//   5. THE DATA LAG (PRICING_DATA_LAG_YEARS): every window year is an accident
//      year ending two years before the priced year, and is valued as at the
//      end of the latest data year — 2027's window is 2021-2025, with 2025 at
//      12 months and 2021 at 60 — so nothing from the year in progress prices.
//
// Replaces opening-partition-check, whose subject — played and BULK accident
// years partitioning the opening — is retired with the bulk years.
//
// ⚠ AND EACH FAILS WHEN BROKEN: the controls feed every predicate an opening
// with an older year added, a pre-game that starts with a reserve, a jump, a
// ledger carrying a pre-2021 row, a window ending on the year just closed (no
// lag), and a window valued at the end of the year in progress.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory, PRE_GAME_DEPTH } from '../../src/utils/priorHistoryEngine';
import { bookPurePremium, newPurePremiumPer100 } from '../../src/utils/newPurePremium';
import { STARTING_CAPITAL, PRICING_WINDOW_YEARS_NEW, PRICING_DATA_LAG_YEARS } from '../../src/data/pricingParameters';
import { lineBookRisk } from '../../src/utils/bookUnits';
import type { CoverageLine, LineResultSet, ReserveCohort, ReserveDevelopmentRow, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 4);
const FIRST = -(PRE_GAME_DEPTH - 1);   // the first pre-game year's yearNumber
const START = 2027;                    // the first played year
const cal = (y: number) => START + y - 1;
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
    const setup = { poolName: 'H', gameLength: 6, startingYear: START, instanceId: id, activeLines: LINES };
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
      : `${os.length} line-openings, first year ${cal(FIRST)} begins at $0 reserve and $${(STARTING_CAPITAL.WC / 1e6).toFixed(0)}M`);
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

type Pricer = (line: CoverageLine, y: number, rows: ReserveDevelopmentRow[]) => ReturnType<typeof newPurePremiumPer100>;
const shipped: Pricer = (line, y, rows) => newPurePremiumPer100(line, y, { rows, allMarketMembers: [], membershipHistory: {} });

function gradePricing(os: Opening[], tag: string, price: Pricer = shipped) {
  const counts: string[] = [];
  let wrong = 0, noHistoryOff = 0;
  for (const o of os) {
    const got: number[] = [];
    for (let y = FIRST; y <= 1; y++) got.push(price(o.line, y, ledgerAt(o.ledger, y))?.points.length ?? 0);
    // A year behind: the year-y window holds the complete years before y - 1.
    const want = got.map((_, i) => Math.max(0, Math.min(i - PRICING_DATA_LAG_YEARS, PRICING_WINDOW_YEARS_NEW)));
    if (got.join() !== want.join()) wrong++;
    if (counts.length === 0) counts.push(got.join(' / '));
    // The years with no usable history price on the no-history figure on the book's own risk, exactly.
    // ⚠ THE YEAR'S OWN BOOK, NOT THE OPENING'S: with PRE_GAME_BOOK_GROWTH the
    // pre-game's early books are smaller subsets of the opening book, each with
    // its own size-weighted risk, and the engine prices each on its own
    // (rateBasis). Until the growth they were the opening book.
    want.forEach((n, i) => {
      if (n > 0) return;
      const yr = o.years[i];
      const expect = bookPurePremium(o.line, FIRST + i, { rows: [], allMarketMembers: [], membershipHistory: {} },
        yr.rateBasis?.pricedExposure ?? yr.activeExposure, yr.rateBasis?.risk ?? o.risk).purePremiumPer100;
      if (Math.abs((yr.newPurePremiumPer100 ?? NaN) / expect - 1) > 1e-9) noHistoryOff++;
    });
  }
  check(wrong === 0 && noHistoryOff === 0,
    `${tag}4. pricing reads the complete years there are, a year behind: 0 in ${cal(FIRST)} and ${cal(FIRST + 1)} (the starting expected loss), then 1, 2, 3, 4, and 5 at year 1 (${cal(1)})`,
    `usable years by pricing year ${counts[0]}; ${wrong} openings off; no-history years off the starting expected loss on ${noHistoryOff}`);
}

function gradeLag(os: Opening[], tag: string, price: Pricer = shipped) {
  let bad = 0, years = 0;
  let sample = '';
  for (const o of os) for (let y = FIRST; y <= 1; y++) {
    const latest = y - 1 - PRICING_DATA_LAG_YEARS;
    for (const p of price(o.line, y, ledgerAt(o.ledger, y))?.points ?? []) {
      years++;
      const row = o.ledger.find(r => r.yearNumber === p.accidentYear)!;
      const k = Math.min(latest - row.firstValuationYear, row.grossPaidByValuation!.length - 1);
      const ok = p.accidentYear <= latest
        && p.ageMonths === (latest - p.accidentYear + 1) * 12
        && p.groundUpPaid === Math.max(0, row.grossPaidByValuation![k] - p.shockPaid);
      if (!ok) bad++;
    }
    if (y === 1 && !sample) {
      sample = (price(o.line, y, ledgerAt(o.ledger, y))?.points ?? []).map(p => `${cal(p.accidentYear)}@${p.ageMonths}`).join(' ');
    }
  }
  check(bad === 0 && years > 0,
    `${tag}5. the data lag: every window year ends ${1 + PRICING_DATA_LAG_YEARS} years before the priced year and is valued at the end of the latest data year`,
    `${years} window years, ${bad} off; ${cal(1)}'s window ${sample}`);
}

console.log(`THE POOL'S HISTORY BEGINS IN ${cal(FIRST)} — ${GAMES} games x ${LINES.length} lines`);
const os = openings();
gradeStart(os, '');
gradeOpening(os, '');
gradeJump(os, '');
gradePricing(os, '');
gradeLag(os, '');

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
// No lag: the year-y rate read as the year after's would be — the window ending
// on the year just closed, valued at its end.
const noLag: Pricer = (line, y, rows) => shipped(line, y + PRICING_DATA_LAG_YEARS, rows);
controlFails('a window ending on the year just closed (no lag)', () => gradePricing(os, '', noLag), '4.');
controlFails("a no-history year priced on the opening book's risk", () => gradePricing(os.map(o => ({
  ...o, years: o.years.map((yr, i) => (i > PRICING_DATA_LAG_YEARS ? yr : {
    ...yr, newPurePremiumPer100: bookPurePremium(o.line, FIRST + i, { rows: [], allMarketMembers: [], membershipHistory: {} },
      yr.rateBasis?.pricedExposure ?? yr.activeExposure, o.risk).purePremiumPer100,
  })),
})), ''), '4.');
controlFails('a window ending on the year just closed (no lag)', () => gradeLag(os, '', noLag), '5.');
// Valued a year late: every row's valuations relabelled a year earlier, so the
// index read is the year in progress's.
const valuedLate: Pricer = (line, y, rows) => shipped(line, y, rows.map(r => ({ ...r, firstValuationYear: r.firstValuationYear - 1 })));
controlFails('a window valued at the end of the year in progress', () => gradeLag(os, '', valuedLate), '5.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — the pre-game starts empty, the opening is its years and no older, and pricing reads the complete years there are, a year behind.');
