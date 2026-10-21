// ============================================================================
// UNDERWRITING ON BOOK UNITS — THE GATE.
//
//   npx tsx scripts/diagnostics/book-units-underwriting-check.ts
//
// Renewal declines the units that LOOK riskiest, intake takes the prospects
// that LOOK best, Member Withdrawal removes units in a seeded order
// (moveBookUnits). What underwriting sees is true risk x a noise drawn once,
// at UNIT_UW_VISIBILITY. Over many seeds, on every line:
//
//   1. SELECTION IMPROVES WITH VISIBILITY. At 0 the units declined and written
//      are no riskier or safer than the book and the market (random); at 1
//      they are exactly the riskiest units and the safest prospects (perfect);
//      in between, the declined get riskier and the written safer as
//      visibility rises.
//   2. THE SHARES: renewal declines, and intake writes, as close to the
//      decision's share of the book as whole units come — within half a unit.
//   3. WITHDRAWAL knows nothing of risk: it removes the R model's share of
//      what is left, and the units leaving are the book's average risk.
//   4. ONE BOOK IN EVERY WORLD: in a ten-world game with renewal, intake and
//      a Member Withdrawal, every world's book after every year is the same,
//      and it is the game's; the pre-game moves nothing.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS feed each predicate a broken
// underwriting: visibility ignored, a share overshot, a risk-led withdrawal,
// and a world that moves its own book.
// ============================================================================

import { BOOK_INTAKE_SHARE, R_MODEL } from '../../src/data/pricingParameters';
import { marketUnits, openingBookUnits, type BookUnit } from '../../src/utils/bookUnits';
import { moveBookUnits, observedRiskScore, type UnitBookMovement } from '../../src/utils/bookUnderwriting';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import type { CoverageLine, DecisionSet, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SEEDS = Array.from({ length: 300 }, (_, i) => 3_000_017 + i * 7_919);
const VIS = [0, 0.25, 0.5, 0.75, 1];
// The largest renewal cut the panel offers (RENEWAL_CUT_STEPS).
const CUT = 0.05;
const INTAKE_LEVEL = 3;   // 8%
const Z = 4;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const meanSe = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return { mean: m, se: Math.sqrt(v / xs.length) };
};
const sizeRisk = (us: BookUnit[]) => {
  const s = us.reduce((a, u) => a + u.size, 0);
  return s > 0 ? us.reduce((a, u) => a + u.size * u.risk, 0) / s : NaN;
};

type Mover = typeof moveBookUnits;
interface Case { line: CoverageLine; seed: number; v: number; m: UnitBookMovement; book: BookUnit[]; market: readonly BookUnit[] }

function run(mover: Mover): Case[] {
  const out: Case[] = [];
  for (const seed of SEEDS) for (const line of LINES) {
    const market = marketUnits(seed, line);
    const idx = openingBookUnits(seed, line);
    const book = idx.map(i => market[i]);
    for (const v of VIS) {
      out.push({ line, seed, v, book, market, m: mover(line, seed, idx, { renewalCut: CUT, intakeLevel: INTAKE_LEVEL }, false, false, 1, v) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- predicates
function gradeSelection(cases: Case[], tag: string) {
  for (const line of LINES) {
    const at = (v: number) => cases.filter(c => c.line === line && c.v === v);
    // The excess risk of the declined over their book, and of the written
    // over the prospects they came from — per seed, so books cancel.
    const declinedExcess = (v: number) => at(v).map(c => sizeRisk(c.m.declinedUnits.map(i => c.market[i])) / sizeRisk(c.book) - 1);
    const writtenExcess = (v: number) => at(v).map(c => {
      const inBook = new Set(c.book.map(u => u.index));
      return sizeRisk(c.m.writtenUnits.map(i => c.market[i])) / sizeRisk(c.market.filter(u => !inBook.has(u.index))) - 1;
    });
    const d = VIS.map(v => meanSe(declinedExcess(v))), w = VIS.map(v => meanSe(writtenExcess(v)));
    const randomAtZero = Math.abs(d[0].mean) < Z * d[0].se && Math.abs(w[0].mean) < Z * w[0].se;
    const monotone = d.every((x, i) => i === 0 || x.mean > d[i - 1].mean) && w.every((x, i) => i === 0 || x.mean < w[i - 1].mean);
    // Perfect at 1: the declined ARE the riskiest by true risk, and the written
    // the safest prospects, as takeToward would choose them.
    const perfect = at(1).every(c => {
      const byRisk = [...c.book].sort((a, b) => b.risk - a.risk || a.index - b.index);
      const k = c.m.declinedUnits.length;
      const top = new Set(byRisk.slice(0, k).map(u => u.index));
      const inBook = new Set(c.book.map(u => u.index));
      const safest = [...c.market.filter(u => !inBook.has(u.index))].sort((a, b) => a.risk - b.risk || a.index - b.index);
      const best = new Set(safest.slice(0, c.m.writtenUnits.length).map(u => u.index));
      return c.m.declinedUnits.every(i => top.has(i)) && c.m.writtenUnits.every(i => best.has(i));
    });
    check(randomAtZero && monotone && perfect, `${tag}1. ${line}: selection improves with visibility — random at 0, perfect at 1`,
      `declined riskier by ${d.map(x => `${(100 * x.mean).toFixed(1)}%`).join(' / ')}; `
      + `written safer by ${w.map(x => `${(-100 * x.mean).toFixed(1)}%`).join(' / ')} at v = ${VIS.join(' / ')}`);
  }
}
function gradeShares(cases: Case[], tag: string) {
  let worst = 0;
  for (const c of cases) {
    const half = Math.max(...c.market.map(u => u.size)) / 2;
    worst = Math.max(worst,
      (Math.abs(c.m.renewedOff - CUT * c.m.before) - half) / c.m.before,
      (Math.abs(c.m.written - BOOK_INTAKE_SHARE[INTAKE_LEVEL] * c.m.before) - half) / c.m.before);
  }
  check(worst <= 0, `${tag}2. renewal declines and intake writes their share of the book, within half a unit`,
    `worst ${(100 * worst).toFixed(3)}% of the book past half a unit`);
}
function gradeWithdrawal(mover: Mover, tag: string) {
  let worstShare = 0;
  const excess: number[] = [];
  for (const seed of SEEDS) for (const line of LINES) {
    const market = marketUnits(seed, line);
    const idx = openingBookUnits(seed, line);
    const m = mover(line, seed, idx, { renewalCut: 0, intakeLevel: 0 }, true, false, 3, 1);
    const half = Math.max(...market.map(u => u.size)) / 2;
    worstShare = Math.max(worstShare, (Math.abs(m.withdrawn - R_MODEL.memberWithdrawalReduction * m.before) - half) / m.before);
    excess.push(sizeRisk(m.withdrawnUnits.map(i => market[i])) / sizeRisk(idx.map(i => market[i])) - 1);
  }
  const e = meanSe(excess);
  check(worstShare <= 0 && Math.abs(e.mean) < Z * e.se, `${tag}3. withdrawal removes ${(100 * R_MODEL.memberWithdrawalReduction).toFixed(0)}% of the book, at its average risk`,
    `share within half a unit; withdrawn risk vs book ${(100 * e.mean).toFixed(2)}% (± ${(100 * e.se).toFixed(2)}%)`);
}

console.log(`UNDERWRITING ON BOOK UNITS — ${SEEDS.length} seeds x ${LINES.length} lines, cut ${100 * CUT}%, intake ${100 * BOOK_INTAKE_SHARE[INTAKE_LEVEL]}%`);
const cases = run(moveBookUnits);
gradeSelection(cases, '');
gradeShares(cases, '');
gradeWithdrawal(moveBookUnits, '');

// ---------------------------------------------------------------- 4. the worlds
type WorldBooks = { year: number; books: string[]; game: string }[];
function playBooks(perWorldSeed: boolean): { years: WorldBooks; preGameMoved: boolean } {
  const { setup } = openSoloInstance({ poolName: 'U', gameLength: 6, startingYear: 2026, instanceId: 'BUUW', activeLines: LINES } as GameSetupSettings);
  // A Member Withdrawal in year 3, so all three movements are in play.
  const instance = generateGameInstance('BUUW', 4_747_474, [{ shockId: '#12', yearNumber: 3 }]);
  const hostSetup = { ...setup, shockTiming: 'host' as const };
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, hostSetup);
  const preGameMoved = LINES.some(l => JSON.stringify(poolState.bookUnits?.[l]) !== JSON.stringify(openingBookUnits(instance.seed, l)));
  const decide = (y: number): DecisionSet => {
    const d = defaultDecisionSet(y);
    return { ...d, byLine: Object.fromEntries(LINES.map(l => [l, { ...d.byLine[l], renewalCut: 0.05, intakeLevel: INTAKE_LEVEL }])) as DecisionSet['byLine'] };
  };
  let gs: GameState = openWorlds({ setup: hostSetup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: decide(1), priorHistory, earlyPreGameHistory });
  const years: WorldBooks = [];
  for (let y = 1; y <= 5; y++) {
    const played = playWorldsYear(perWorldSeed
      ? { ...gs, worlds: (gs.worlds ?? []).map(w => w) } : gs, decide(y));
    if (perWorldSeed) {
      // CONTROL: a world that moves its own book — world 2 reruns its year with
      // the market seed of its own world seed.
      const p1 = played.perWorld[1];
      const books = p1.updatedPoolState.bookUnits;
      if (books) p1.updatedPoolState = { ...p1.updatedPoolState, bookUnits: { ...books, WC: (books.WC ?? []).slice(1) } };
    }
    years.push({
      year: y,
      books: played.perWorld.map(p => JSON.stringify(p.updatedPoolState.bookUnits)),
      game: '',
    });
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
    years[years.length - 1].game = JSON.stringify(gs.poolState.bookUnits);
  }
  return { years, preGameMoved };
}
function gradeWorlds(r: { years: WorldBooks; preGameMoved: boolean }, tag: string) {
  const same = r.years.every(y => y.books.every(b => b === y.books[0]) && y.game === y.books[0]);
  const moved = new Set(r.years.map(y => y.game)).size === r.years.length;
  check(same && moved && !r.preGameMoved, `${tag}4. one book in every world, every year, and it is the game's; the pre-game moves nothing`,
    `${r.years.length} years x ${r.years[0].books.length} worlds; the book moved every year`);
}
gradeWorlds(playBooks(false), '');

// ---------------------------------------------------------------- controls
console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
const blind: Mover = (line, seed, book, d, w, f, y) => moveBookUnits(line, seed, book, d, w, f, y, 0);
controlFails('visibility ignored (selection always random)', () => gradeSelection(run(blind), ''), '1.');
const greedy: Mover = (...a) => {
  const m = moveBookUnits(...a);
  return { ...m, written: m.written * 1.2 };
};
controlFails('intake overshooting its share', () => gradeShares(run(greedy), ''), '2.');
const riskLed: Mover = (line, seed, book, d, w, f, y, v) => {
  const m = moveBookUnits(line, seed, book, d, w, f, y, v);
  if (!w) return m;
  // Withdraw the riskiest units instead of a seeded order.
  const market = marketUnits(seed, line);
  const order = [...book].sort((a, b) => observedRiskScore(market[b], 1) - observedRiskScore(market[a], 1));
  const gone: number[] = [];
  let held = 0;
  for (const i of order) { if (held + market[i].size / 2 > m.withdrawn) break; gone.push(i); held += market[i].size; }
  return { ...m, withdrawnUnits: gone };
};
controlFails('a withdrawal led by risk', () => gradeWithdrawal(riskLed, ''), '3.');
controlFails('a world that moves its own book', () => gradeWorlds(playBooks(true), ''), '4.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — underwriting selects by what it sees, better as it sees more; one book in every world.');
