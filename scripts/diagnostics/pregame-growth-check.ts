// ============================================================================
// THE PRE-GAME BOOK GROWS INTO THE OPENING — A GATE (PRE_GAME_BOOK_GROWTH).
//
//   npx tsx scripts/diagnostics/pregame-growth-check.ts
//
// Single-player, three lines, the pre-game, on four scenarios:
//
//   1. STEADY GROWTH: every pre-game year's exposure is the 2026 book's x
//      (1 + PRE_GAME_BOOK_GROWTH)^(year - 2026) — 2021 holds 1 / 1.02^5 of it.
//   2. ENDING EXACTLY AT TODAY'S OPENING BOOK: the book the game opens on is
//      the opening book (openingBookUnits) — the same units, every one wholly
//      held — and so is 2026's.
//   3. NEW BUSINESS: each year from 2022 writes exactly the year's growth as
//      new units (preGameBookShares), joined that year; 2021 writes none; and
//      every unit 2021 holds is in the opening book.
//
// ⚠ AND EACH FAILS WHEN BROKEN: the controls feed 1 a flat book and growth
// compounded the wrong way, 2 an opening a unit short, and 3 a year that
// writes nothing.
// ============================================================================

import { PRE_GAME_BOOK_GROWTH, PRIOR_HISTORY_YEARS } from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { marketSeedOf, marketUnits, openingBookUnits } from '../../src/utils/bookUnits';
import { preGameBookShares } from '../../src/utils/bookUnderwriting';
import type { BookLedger, CoverageLine, GameSetupSettings, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SCENARIOS = ['3', '8', '13', '18'];
const FIRST = 1 - PRIOR_HISTORY_YEARS;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

interface Opened { seed: number; line: CoverageLine; years: LineResultSet[]; book: number[]; ledger: BookLedger | undefined }
const opened: Opened[] = [];
for (const id of SCENARIOS) {
  const { setup, instance } = openSoloInstance({ poolName: 'G', gameLength: 5, startingYear: 2027, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const pre = [...(earlyPreGameHistory ?? []), ...priorHistory];
  for (const l of LINES) opened.push({
    seed: marketSeedOf(instance), line: l, years: pre.map(r => r.byLine[l]!),
    book: poolState.bookUnits?.[l] ?? [], ledger: poolState.bookLedger?.[l],
  });
}
const exposureOf = (r: LineResultSet) => r.billedExposure ?? r.activeExposure;

// ---------------------------------------------------------------- 1
function gradeGrowth(os: Opened[], growth: number, tag: string) {
  let worst = 0, n = 0;
  for (const o of os) {
    const last = exposureOf(o.years[o.years.length - 1]);
    for (const r of o.years) { n++; worst = Math.max(worst, Math.abs(exposureOf(r) / last / Math.pow(1 + growth, r.yearNumber) - 1)); }
  }
  const first = os.map(o => exposureOf(o.years[0]) / exposureOf(o.years[o.years.length - 1]));
  check(worst < 1e-9 && n > 0,
    `${tag}1. every pre-game year's exposure is 2026's x ${(1 + PRE_GAME_BOOK_GROWTH).toFixed(2)}^(year - 2026)`,
    `${n} line-years; worst off ${worst.toExponential(2)}; 2021 / 2026 ${Math.min(...first).toFixed(4)} (1 / 1.02^5 = ${Math.pow(1 + PRE_GAME_BOOK_GROWTH, FIRST).toFixed(4)})`);
}

// ---------------------------------------------------------------- 2
function gradeOpening(os: Opened[], tag: string) {
  let off = 0;
  for (const o of os) {
    const want = openingBookUnits(o.seed, o.line);
    const partial = Object.keys(o.ledger?.share ?? {}).length;
    if (o.book.join() !== want.join() || partial > 0) off++;
  }
  check(off === 0 && os.length > 0, `${tag}2. the game opens on exactly the opening book: the same units, every one wholly held`,
    `${os.length} line-openings, ${off} off`);
}

// ---------------------------------------------------------------- 3
type Shares = (seed: number, line: CoverageLine, y: number) => Map<number, number>;
function gradeWritten(os: Opened[], shares: Shares, tag: string) {
  let worst = 0, n = 0, outside = 0, joinedOff = 0;
  for (const o of os) {
    const market = marketUnits(o.seed, o.line);
    const open = new Set(openingBookUnits(o.seed, o.line));
    const size = (m: Map<number, number>) => [...m].reduce((a, [i, sh]) => a + market[i].size * sh, 0);
    const full = size(shares(o.seed, o.line, 0));
    for (let y = FIRST; y <= 0; y++) {
      const now = shares(o.seed, o.line, y);
      for (const i of now.keys()) if (!open.has(i)) outside++;
      const prev = y > FIRST ? shares(o.seed, o.line, y - 1) : null;
      const written = prev ? size(now) - size(prev) : 0;
      const want = y > FIRST ? full * (Math.pow(1 + PRE_GAME_BOOK_GROWTH, y) - Math.pow(1 + PRE_GAME_BOOK_GROWTH, y - 1)) : 0;
      n++;
      worst = Math.max(worst, Math.abs(written - want) / full);
      // A unit wholly written in year y is joined in year y on the book the game opens with.
      if (prev) for (const [i, sh] of now) if ((prev.get(i) ?? 0) === 0 && sh === 1 && o.ledger?.joined[String(i)] !== y && y > FIRST) {
        // Joined later only if topped up again; the opening ledger keeps its last write.
        const later = [...Array(-y).keys()].some(k => (shares(o.seed, o.line, y + k + 1).get(i) ?? 0) > sh);
        if (!later) joinedOff++;
      }
    }
  }
  check(worst < 1e-9 && outside === 0 && joinedOff === 0 && n > 0,
    `${tag}3. each year from 2022 writes exactly its growth as new units of the opening book, joined that year; 2021 writes none`,
    `${n} line-years; written worst off ${worst.toExponential(2)} of the book; ${outside} units outside the opening book; ${joinedOff} joined off`);
}

console.log(`PRE-GAME BOOK GROWTH — ${(PRE_GAME_BOOK_GROWTH * 100).toFixed(0)}% a year, scenarios ${SCENARIOS.join(', ')}, three lines`);
gradeGrowth(opened, PRE_GAME_BOOK_GROWTH, '');
gradeOpening(opened, '');
gradeWritten(opened, preGameBookShares, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('a flat book', () => gradeGrowth(opened, 0, ''), '1.');
controlFails('growth compounded the wrong way', () => gradeGrowth(opened, -PRE_GAME_BOOK_GROWTH, ''), '1.');
controlFails('an opening a unit short', () => gradeOpening(opened.map((o, i) => (i === 0 ? { ...o, book: o.book.slice(1) } : o)), ''), '2.');
controlFails('a year that writes nothing', () => gradeWritten(opened,
  (seed, line, y) => preGameBookShares(seed, line, y === -2 ? -3 : y), ''), '3.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — the pre-game book grows 2% a year as new business into exactly the opening book.');
