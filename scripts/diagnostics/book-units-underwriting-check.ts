// ============================================================================
// UNDERWRITING ON BOOK UNITS — THE GATE (uw-hybrid).
//
//   npx tsx scripts/diagnostics/book-units-underwriting-check.ts
//
// Renewals are declined on loss history, worst loss ratio first; new business
// arrives at random from the market and is rejected at random; what joins
// carries the data scientist's penalty factor in its first year
// (bookUnderwriting.ts; every setting in pricingParameters.ts). Checks:
//
//   1. THE FORMULA: 1 + 20% x (1 − min(1, r / 10%)) at every 1% step of the
//      slider — 1.20 at 0%, 1.10 at 5%, 1.00 from 10% to 15%.
//   2. THE WORKED EXAMPLE: 105% x 1.10 = 115.5%; a book renewing at 102.5%
//      (the example's 105% after declines) blended 98% / 2% with new business
//      at 115.5% is 1.0276 — through the engine's own ordinary loss on a
//      two-unit book, in a year run flat (no factor drawn). ⚠ THE FLAT YEAR IS
//      ASKED FOR, NOT ASSUMED: this read year 0 under the global FLAT_PRE_GAME
//      until the simulated pre-game turned it off (584715e), after which year 0
//      drew its year and unit factors and the example read 1.00475 — 1.0276
//      times that year's draws, the formula unmoved.
//   3. LOSS-HISTORY SELECTION, on 300 seeds x 3 lines of synthetic histories:
//      a. the declined are the worst loss ratios among the eligible;
//      b. whole units, and part of the last only;
//      c. exactly the slider's share of renewing exposure;
//      d. no unit inside its grace years is declined;
//      e. the window is the last three accident years, and a shock claim
//         counts at most $1M while routine losses count in full.
//   4. NEW BUSINESS: applicants are exactly 2% of the book (the parameter),
//      accepted exposure is short of it by exactly the rejection rate, the
//      same applicants at every rate (rejection is random), and what joins is
//      the market's risk (no selection).
//   5. THE WORLDS: in a played game every world holds the same book, shares
//      and joins; the game's history is the mean of every world's records;
//      the renewal declined something; the pre-game moved nothing.
//   6. WITHDRAWAL knows nothing of risk (unchanged).
//
// ⚠ AND EACH FAILS WHEN BROKEN — the CONTROLS at the end feed every predicate
// a broken version: the formula without its cap, savings at 5%, the ranking
// reversed, whole units only, grace ignored, the window or the cap dropped,
// rejection of the riskiest, world 1's or worlds 1-10's history instead of
// every world's, and a
// risk-led withdrawal.
// ============================================================================

import {
  FULL_SAVINGS_AT, LOSS_HISTORY_CLAIM_CAP, NEW_BUSINESS_APPLICATIONS, NEW_BUSINESS_PENALTY, NEW_BUSINESS_REJECTION_SLIDER,
  R_MODEL, RENEWALS_DECLINED_SLIDER,
} from '../../src/data/pricingParameters';
import { marketUnits, openingBookUnits, type BookUnit } from '../../src/utils/bookUnits';
import {
  averageLedgerYear, emptyLedger, heldShare, moveBookUnits, newBusinessPenaltyFactor, recordUnitYear, renewalEligible, unitLossRatio,
  type UnitBookMovement,
} from '../../src/utils/bookUnderwriting';
import { ordinaryLossCostPer100, ordinaryLossFromUnits } from '../../src/utils/ordinaryLoss';
import { deriveSubRng } from '../../src/utils/random';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import type { BookLedger, CoverageLine, DecisionSet, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SEEDS = Array.from({ length: 300 }, (_, i) => 3_000_017 + i * 7_919);
const YEAR = 4;
const Z = 4;
const TOL = 1e-9;
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
const sizeRisk = (us: { size: number; risk: number }[]) => {
  const s = us.reduce((a, u) => a + u.size, 0);
  return s > 0 ? us.reduce((a, u) => a + u.size * u.risk, 0) / s : NaN;
};
const steps = (r: { min: number; max: number; step: number }) =>
  Array.from({ length: Math.round((r.max - r.min) / r.step) + 1 }, (_, i) => +(r.min + i * r.step).toFixed(10));

// ---------------------------------------------------------------- 1. the formula
type Factor = (r: number) => number;
function gradeFormula(f: Factor, tag: string) {
  // Independent of the code: 1.20 falling 2 points per 1% to 1.00 at 10%, flat after.
  const want = (r: number) => (r < 0.10 ? 1.20 - 2 * r : 1.00);
  const worst = Math.max(...steps(NEW_BUSINESS_REJECTION_SLIDER).map(r => Math.abs(f(r) - want(r))));
  check(worst < 1e-12 && NEW_BUSINESS_PENALTY === 0.20 && FULL_SAVINGS_AT === 0.10,
    `${tag}1. the penalty factor is 1 + 20% x (1 − min(1, r / 10%)) at every step`,
    `0% ${f(0).toFixed(4)} · 5% ${f(0.05).toFixed(4)} · 10% ${f(0.10).toFixed(4)} · 15% ${f(0.15).toFixed(4)}; worst ${worst.toExponential(1)}`);
}

// ---------------------------------------------------------------- 2. the worked example
function gradeExample(f: Factor, tag: string, flat = true) {
  const newBusiness = 1.05 * f(0.05);
  // Two units, priced at the line's cost per exposure (risk 1 = a 100% loss
  // ratio): the book renewing at 102.5% and 98 of the exposure, new business
  // from the 105% market, 2 of it, carrying the factor. A flat year draws no
  // factor, so the ordinary loss is exactly exposure x risk x cost x load —
  // and the run is told it is flat, since FLAT_PRE_GAME is off.
  const units: BookUnit[] = [
    { index: 0, size: 98, risk: 1.025, region: 'Northeast' as BookUnit['region'], noiseZ: 0 },
    { index: 1, size: 2, risk: 1.05, region: 'Northeast' as BookUnit['region'], noiseZ: 0 },
  ];
  const draw = ordinaryLossFromUnits('Property', units, 100, 0, 1, new Set([1]), f(0.05) - 1, 1, flat);
  const blended = draw.realised / (100 * 10_000 * ordinaryLossCostPer100('Property', 0));
  check(Math.abs(newBusiness - 1.155) < 1e-12 && Math.abs(blended - 1.0276) < 1e-12,
    `${tag}2. the worked example: 105% x 1.10 = 115.5%; 98% at 102.5% with 2% at 115.5% = 1.0276`,
    `new business ${(100 * newBusiness).toFixed(2)}%, blended ${blended.toFixed(6)} (the engine's ordinary loss)`);
}

// ---------------------------------------------------------------- 3. selection
interface SelCase { line: CoverageLine; seed: number; book: number[]; ledger: BookLedger; lr: Map<number, number>; m: UnitBookMovement; cut: number }
type Mover = (line: CoverageLine, seed: number, book: number[], ledger: BookLedger, d: DecisionSet['byLine']['WC'] | { renewalsDeclined?: number; newBusinessRejection?: number }, w: boolean, y: number) => UnitBookMovement;
const mover: Mover = (line, seed, book, ledger, d, w, y) => moveBookUnits(line, seed, book, ledger, d, w, false, y);

/** A synthetic ledger: random loss ratios over the window, a decoy record outside it, some units recently joined and some held in part. */
function syntheticLedger(seed: number, line: CoverageLine, book: number[]): { ledger: BookLedger; lr: Map<number, number> } {
  const rng = deriveSubRng(seed, YEAR, `uw_gate_${line}`);
  const ledger = emptyLedger();
  const lr = new Map<number, number>();
  for (const i of book) {
    const k = String(i);
    const x = rng.lognormal(-0.02, 0.2);
    if (rng.next() < 0.15) ledger.joined[k] = YEAR - 1;          // inside its grace: written last year
    else if (rng.next() < 0.1) ledger.joined[k] = YEAR - 2;      // past it
    if (rng.next() < 0.1) ledger.share[k] = 0.5;
    // Recently joined units look worst, so a grace that is not applied shows.
    const ratio = ledger.joined[k] === YEAR - 1 ? x + 5 : x;
    lr.set(i, ratio);
    ledger.history[k] = [
      // Outside the window: enormous, so reading it would reorder everything.
      { year: YEAR - 4, loss: 1e9 * rng.next(), premium: 1 },
      ...[1, 2, 3].map(b => ({ year: YEAR - b, loss: ratio * 1000 * b, premium: 1000 * b })),
    ];
  }
  return { ledger, lr };
}

function selectionCases(mv: Mover): SelCase[] {
  const out: SelCase[] = [];
  for (const seed of SEEDS) for (const line of LINES) {
    const book = openingBookUnits(seed, line);
    const { ledger, lr } = syntheticLedger(seed, line, book);
    for (const cut of [0.01, 0.05, RENEWALS_DECLINED_SLIDER.max]) {
      out.push({ line, seed, book, ledger, lr, cut, m: mv(line, seed, book, ledger, { renewalsDeclined: cut, newBusinessRejection: 0 }, false, YEAR) });
    }
  }
  return out;
}

function gradeSelection(cases: SelCase[], tag: string) {
  let worstOrder = 0, partialBad = 0, worstShare = 0, graceBad = 0;
  for (const c of cases) {
    const market = marketUnits(c.seed, c.line);
    const held = (i: number) => market[i].size * heldShare(c.ledger, i);
    const after = new Set(c.m.afterUnits);
    const declined = new Set(c.m.declinedUnits);
    const eligible = c.book.filter(i => renewalEligible(c.ledger, i, YEAR));
    // a. every declined unit's ratio >= every eligible unit renewed whole.
    const minDeclined = Math.min(...c.m.declinedUnits.map(i => c.lr.get(i)!));
    const maxKept = Math.max(-Infinity, ...eligible.filter(i => !declined.has(i)).map(i => c.lr.get(i)!));
    worstOrder = Math.max(worstOrder, maxKept - minDeclined);
    // b. only one declined unit survives in part.
    if (c.m.declinedUnits.filter(i => after.has(i)).length > 1) partialBad++;
    // c. the share, exactly.
    worstShare = Math.max(worstShare, Math.abs(c.m.renewedOff - c.cut * c.m.before) / c.m.before);
    // d. no unit inside its grace.
    if (c.m.declinedUnits.some(i => !renewalEligible(c.ledger, i, YEAR))) graceBad++;
    void held;
  }
  check(worstOrder <= 0, `${tag}3a. the declined are the worst loss ratios among the eligible`, `worst inversion ${worstOrder.toFixed(4)}`);
  check(partialBad === 0, `${tag}3b. whole units, and part of the last only`, `${partialBad} cases with two partial`);
  check(worstShare < TOL, `${tag}3c. exactly the slider's share of renewing exposure`, `worst ${worstShare.toExponential(1)} of the book over ${cases.length} cases`);
  check(graceBad === 0, `${tag}3d. no unit is declined inside its grace years`, `${graceBad} cases`);
}

type Recorder = typeof recordUnitYear;
type Ratio = typeof unitLossRatio;
function gradeHistory(record: Recorder, ratio: Ratio, tag: string) {
  const unit: BookUnit = { index: 7, size: 10, risk: 1, region: 'Northeast' as BookUnit['region'], noiseZ: 0 };
  let l = emptyLedger();
  // Years 1-4: 100 of premium each; year 1 a $9M loss (out of the window at
  // year 5); year 3 a $5M shock claim (counts $1M) and a $250k routine excess
  // (counts in full); ordinary 50 a year.
  const large = (y: number) => new Map([[7, y === 3 ? { routine: 250_000, shock: [5_000_000] } : { routine: 0, shock: [] }]]);
  for (const y of [1, 2, 3, 4]) l = record(l, [unit], y, new Map([[7, y === 1 ? 9_000_000 : 50]]), large(y), 100);
  const got = ratio(l.history['7'], 5);
  const want = (50 + 50 + LOSS_HISTORY_CLAIM_CAP + 250_000 + 50) / 300;
  check(Math.abs(got! - want) < 1e-9 && l.history['7'].length === 3,
    `${tag}3e. the last three years, a shock claim at most $1M, routine losses in full`,
    `loss ratio ${got?.toFixed(2)} (want ${want.toFixed(2)}); ${l.history['7'].length} records kept`);
}

// ---------------------------------------------------------------- 4. new business
function gradeNewBusiness(mv: Mover, tag: string) {
  let worstApplied = 0, worstAccepted = 0, sameApplicants = true;
  const excess: number[] = [];
  for (const seed of SEEDS) for (const line of LINES) {
    const market = marketUnits(seed, line);
    const book = openingBookUnits(seed, line);
    const run = (r: number) => mv(line, seed, book, emptyLedger(), { renewalsDeclined: 0, newBusinessRejection: r }, false, YEAR);
    const open = run(0), strict = run(NEW_BUSINESS_REJECTION_SLIDER.max);
    worstApplied = Math.max(worstApplied, Math.abs(open.applied - NEW_BUSINESS_APPLICATIONS * open.before) / open.before);
    worstAccepted = Math.max(worstAccepted,
      Math.abs(strict.written - (1 - NEW_BUSINESS_REJECTION_SLIDER.max) * strict.applied) / strict.before,
      Math.abs(open.written - open.applied) / open.before);
    if (JSON.stringify(open.writtenUnits) !== JSON.stringify(strict.writtenUnits)) sameApplicants = false;
    const inBook = new Set(book);
    const shareOf = (m: UnitBookMovement, i: number) => m.ledger.share[String(i)] ?? 1;
    const joined = strict.writtenUnits.map(i => ({ size: market[i].size * shareOf(strict, i), risk: market[i].risk }));
    excess.push(sizeRisk(joined) / sizeRisk(market.filter(u => !inBook.has(u.index))) - 1);
  }
  const e = meanSe(excess);
  check(worstApplied < TOL, `${tag}4a. applicants are exactly ${(100 * NEW_BUSINESS_APPLICATIONS).toFixed(0)}% of the book`, `worst ${worstApplied.toExponential(1)}`);
  check(worstAccepted < TOL && sameApplicants,
    `${tag}4b. accepted exposure is short of applied by exactly the rejection rate, on the same applicants`,
    `worst ${worstAccepted.toExponential(1)}; same applicants at 0% and ${(100 * NEW_BUSINESS_REJECTION_SLIDER.max).toFixed(0)}%: ${sameApplicants}`);
  check(Math.abs(e.mean) < Z * e.se, `${tag}4c. what joins is the market's risk — no selection`,
    `joined vs market ${(100 * e.mean).toFixed(2)}% (± ${(100 * e.se).toFixed(2)}%)`);
}

// ---------------------------------------------------------------- 5. the worlds
interface WorldsRun { sameBook: boolean; declinedAny: boolean; preGameMoved: boolean; perWorld: BookLedger[][]; game: BookLedger[]; years: number[] }
function playWorlds(): WorldsRun {
  const { setup, instance } = openSoloInstance({ poolName: 'U', gameLength: 4, startingYear: 2026, instanceId: 'BUUW', activeLines: ['Property'] } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const preGameMoved = JSON.stringify(poolState.bookUnits?.Property) !== JSON.stringify(openingBookUnits(instance.seed, 'Property'));
  const decide = (y: number): DecisionSet => {
    const d = defaultDecisionSet(y);
    return { ...d, byLine: { ...d.byLine, Property: { ...d.byLine.Property, renewalsDeclined: 0.10, newBusinessRejection: 0.05 } } };
  };
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: decide(1), priorHistory, earlyPreGameHistory });
  let sameBook = true, declinedAny = false;
  const perWorld: BookLedger[][] = [], game: BookLedger[] = [], years: number[] = [];
  for (let y = 1; y <= 4; y++) {
    // Held shares at the start of the year, to see what the renewal took.
    const startBook = gs.poolState.bookUnits!.Property!;
    const startLedger = gs.poolState.bookLedger?.Property;
    const played = playWorldsYear(gs, decide(y));
    const ledgers = played.perWorld.map(p => p.updatedPoolState.bookLedger!.Property!);
    const books = played.perWorld.map(p => JSON.stringify([p.updatedPoolState.bookUnits!.Property, ledgersShape(p.updatedPoolState.bookLedger!.Property!)]));
    if (!books.every(b => b === books[0])) sameBook = false;
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
    if (JSON.stringify([gs.poolState.bookUnits!.Property, ledgersShape(gs.poolState.bookLedger!.Property!)]) !== books[0]) sameBook = false;
    // No withdrawal fires in a solo game, so a unit gone or shrunk was declined.
    const nowBook = new Set(gs.poolState.bookUnits!.Property!);
    if (startBook.some(i => !nowBook.has(i) || heldShare(gs.poolState.bookLedger!.Property, i) < heldShare(startLedger, i) - 1e-12)) declinedAny = true;
    perWorld.push(ledgers); game.push(gs.poolState.bookLedger!.Property!); years.push(y);
  }
  return { sameBook, declinedAny, preGameMoved, perWorld, game, years };
}
const ledgersShape = (l: BookLedger) => ({ share: l.share, joined: l.joined, units: Object.keys(l.history).sort() });

function gradeWorlds(r: WorldsRun, tag: string) {
  let worst = 0;
  r.years.forEach((y, k) => {
    for (const [u, recs] of Object.entries(r.game[k].history)) {
      const rec = recs.find(x => x.year === y);
      const ws = r.perWorld[k].map(l => l.history[u]?.find(x => x.year === y)).filter(Boolean) as { loss: number; premium: number }[];
      const mLoss = ws.reduce((a, x) => a + x.loss, 0) / ws.length, mPrem = ws.reduce((a, x) => a + x.premium, 0) / ws.length;
      worst = Math.max(worst, Math.abs(rec!.loss - mLoss) / Math.max(mLoss, 1), Math.abs(rec!.premium - mPrem) / Math.max(mPrem, 1));
    }
  });
  check(worst < 1e-9 && r.sameBook && r.declinedAny && !r.preGameMoved,
    `${tag}5. one book in every world; the history is the worlds' mean; renewals declined; the pre-game moved nothing`,
    `${r.perWorld[0].length} worlds x ${r.years.length} years; worst gap from the mean ${worst.toExponential(1)}; same book ${r.sameBook}`);
}

// ---------------------------------------------------------------- 6. withdrawal
function gradeWithdrawal(mv: Mover, tag: string) {
  const excess: number[] = [];
  let worstShare = 0;
  for (const seed of SEEDS) for (const line of LINES) {
    const market = marketUnits(seed, line);
    const book = openingBookUnits(seed, line);
    const m = mv(line, seed, book, emptyLedger(), { renewalsDeclined: 0, newBusinessRejection: 0 }, true, 3);
    const half = Math.max(...market.map(u => u.size)) / 2;
    worstShare = Math.max(worstShare, (Math.abs(m.withdrawn - R_MODEL.memberWithdrawalReduction * m.before) - half) / m.before);
    excess.push(sizeRisk(m.withdrawnUnits.map(i => market[i])) / sizeRisk(book.map(i => market[i])) - 1);
  }
  const e = meanSe(excess);
  check(worstShare <= 0 && Math.abs(e.mean) < Z * e.se, `${tag}6. withdrawal removes ${(100 * R_MODEL.memberWithdrawalReduction).toFixed(0)}% of the book, at its average risk`,
    `withdrawn risk vs book ${(100 * e.mean).toFixed(2)}% (± ${(100 * e.se).toFixed(2)}%)`);
}

console.log(`UNDERWRITING ON BOOK UNITS (uw-hybrid) — ${SEEDS.length} seeds x ${LINES.length} lines`);
gradeFormula(newBusinessPenaltyFactor, '');
gradeExample(newBusinessPenaltyFactor, '');
gradeSelection(selectionCases(mover), '');
gradeHistory(recordUnitYear, unitLossRatio, '');
gradeNewBusiness(mover, '');
const worlds = playWorlds();
gradeWorlds(worlds, '');
gradeWithdrawal(mover, '');

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
controlFails('the formula without its cap at full savings', () => gradeFormula(r => 1 + 0.2 * (1 - r / 0.10), ''), '1.');
controlFails('full savings at 5%', () => gradeExample(r => 1 + 0.2 * (1 - Math.min(1, r / 0.05)), ''), '2.');
controlFails('the example in a year that draws its factors', () => gradeExample(newBusinessPenaltyFactor, '', false), '2.');
const reversed: Mover = (line, seed, book, ledger, d, w, y) => {
  // Rank on the inverse: the best loss ratios go first.
  const flipped = { ...ledger, history: Object.fromEntries(Object.entries(ledger.history)
    .map(([k, rs]) => [k, rs.map(r => ({ ...r, loss: r.premium * 100 - r.loss }))])) };
  return mover(line, seed, book, flipped, d, w, y);
};
controlFails('the ranking reversed', () => gradeSelection(selectionCases(reversed), ''), '3a.');
const wholeOnly: Mover = (...a) => {
  const m = mover(...a);
  const market = marketUnits(a[1], a[0]);
  return { ...m, renewedOff: m.declinedUnits.reduce((s, i) => s + market[i].size * heldShare(a[3], i), 0) };
};
controlFails('whole units only', () => gradeSelection(selectionCases(wholeOnly), ''), '3c.');
const noGrace: Mover = (line, seed, book, ledger, d, w, y) => mover(line, seed, book, { ...ledger, joined: {} }, d, w, y);
controlFails('grace ignored', () => gradeSelection(selectionCases(noGrace), ''), '3d.');
controlFails('the window ignored', () => gradeHistory(recordUnitYear, (rs) => {
  const loss = (rs ?? []).reduce((a, r) => a + r.loss, 0), p = (rs ?? []).reduce((a, r) => a + r.premium, 0);
  return p > 0 ? (loss + 9_000_000) / (p + 100) : null;
}, ''), '3e.');
controlFails('the claim cap dropped', () => gradeHistory((l, us, y, o, lg, p) => recordUnitYear(l, us, y, o,
  new Map([...lg].map(([k, v]) => [k, { routine: v.routine + v.shock.reduce((a, x) => a + x, 0), shock: [] }])), p),
unitLossRatio, ''), '3e.');
const pickyRejection: Mover = (line, seed, book, ledger, d, w, y) => {
  // Rejects the riskiest applicants outright instead of a random share of each.
  const open = mover(line, seed, book, ledger, { ...d, newBusinessRejection: 0 }, w, y);
  const market = marketUnits(seed, line);
  const r = (d as { newBusinessRejection?: number }).newBusinessRejection ?? 0;
  if (r === 0) return open;
  const byRisk = [...open.writtenUnits].sort((a, b) => market[b].risk - market[a].risk);
  let cut = r * open.written;
  const share = { ...open.ledger.share };
  const keep: number[] = [];
  for (const i of byRisk) {
    const h = market[i].size * (share[String(i)] ?? 1);
    if (cut >= h) { cut -= h; delete share[String(i)]; continue; }
    keep.push(i);
  }
  return { ...open, writtenUnits: keep.sort((a, b) => a - b), ledger: { ...open.ledger, share } };
};
controlFails('the riskiest applicants rejected', () => gradeNewBusiness(pickyRejection, ''), '4');
controlFails("world 1's history instead of the average", () => gradeWorlds({ ...worlds, game: worlds.perWorld.map(ls => ls[0]) }, ''), '5.');
controlFails("worlds 1-10's history instead of every world's", () => gradeWorlds({ ...worlds,
  game: worlds.perWorld.map((ls, k) => averageLedgerYear(ls.slice(0, 10), worlds.years[k])) }, ''), '5.');
const riskLed: Mover = (line, seed, book, ledger, d, w, y) => {
  const m = mover(line, seed, book, ledger, d, w, y);
  if (!w) return m;
  const market = marketUnits(seed, line);
  const order = [...book].sort((a, b) => market[b].risk - market[a].risk);
  const gone: number[] = [];
  let held = 0;
  for (const i of order) { if (held + market[i].size / 2 > m.withdrawn) break; gone.push(i); held += market[i].size; }
  return { ...m, withdrawnUnits: gone };
};
controlFails('a withdrawal led by risk', () => gradeWithdrawal(riskLed, ''), '6.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — the formula, the worked example, loss-history renewals, random new business; one book in every world.');
