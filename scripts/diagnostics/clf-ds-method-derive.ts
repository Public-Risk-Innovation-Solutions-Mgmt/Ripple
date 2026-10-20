// ============================================================================
// FUNDING TABLES BY THE DATA SCIENTIST'S CLF METHOD — a generator, not a check.
//
//   npx tsx scripts/diagnostics/clf-ds-method-derive.ts            # write the tables
//   BOOKS=20 YEARS=2000 npx tsx scripts/diagnostics/clf-ds-method-derive.ts   # quick
//
// ⚠ NOT WIRED. It writes clf-ds-method-tables.json beside itself and nothing in
// the game reads it. The tables go in with the twenty starting scenarios.
//
// THE METHOD, from Ripple_Game_CLF_100_Background_Simulations.R. The CLF covers
// ORDINARY losses only: no shocks, no inflation. Each simulated year a line's
// ordinary loss is the sum over its book of
//
//   expected loss x Y x f_i
//
// where Y is ONE year factor shared by the whole book (lognormal, mean 1, CV
// BaselineCV) and f_i is the member's own (lognormal, mean 1, CV MemberLossCV).
// The ratio is that total over the book's expected ordinary loss, and the table
// is the ratio's percentiles. "Expected" is the percentile at which the ratio
// equals 1.0.
//
// THE GAME'S OWN BOOK UNITS. A book here is a game's OPENING book of units
// (openingBookUnits, off the game's market seed), and a unit's expected
// ordinary loss is size x risk x the line's cost (ordinaryLoss.ts). The cost is
// common to every unit of a line, so it cancels from the ratio; only the units'
// SHARES of size x risk reach the table.
//
// ⚠ ONE NORMAL PER BOOK-YEAR DRIVES EVERY BaselineCV (common random numbers).
// The unit sum S = sum w_i f_i does not depend on BaselineCV, so it is drawn
// once per simulated year and each table's ratio is exp(-s^2/2 + s z) x S for
// its own s. Each table's distribution is exactly the method's; sharing the
// draws only makes the seven tables comparable with each other row for row.
//
// THE ANALYTIC CHECK is the data scientist's own closed form:
//   CV  = sqrt(B^2 + M^2 H + B^2 M^2 H),  H = sum e_i^2 / (sum e_i)^2
//   factor(p) = exp(-sigma^2/2 + sigma z_p),  sigma = sqrt(ln(1 + CV^2))
//   Expected  = Phi(sigma / 2)
//
// THE RATE EFFECT reads the live rate stack's year-1 split on real default
// games: at Expected the factor is 1.0, so funding at a factor f raises the
// line's rate by poolPremium x (f - 1) / totalCharge. ⚠ The engine applies the
// factor to the whole retained pure premium, which is more than ordinary loss;
// that is a wiring question for when the tables go in, and is reported as is.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import { marketSeedOf, openingBookUnits, unitsOf } from '../../src/utils/bookUnits';
import { deriveSubRng } from '../../src/utils/random';
import { normalCdf, normalInvCdf } from '../../src/utils/claimMath';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'clf-ds-method-tables.json');

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const BASELINE_CVS = [0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.15];
const MEMBER_LOSS_CV = 0.10;
const PCTS = [30, 40, 50, 60, 70, 80, 90, 95, 99];
const YEARS = Number(process.env.YEARS ?? 10_000);
const BOOKS = Number(process.env.BOOKS ?? 200);
const RATE_GAMES = Number(process.env.RATE_GAMES ?? 40);

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: number[]) => { const m = mean(v); return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)); };
const sigmaOf = (cv: number) => Math.sqrt(Math.log(1 + cv * cv));
// Linear interpolation between order statistics, as R's default quantile (type 7).
function quantile(sorted: Float64Array, p: number): number {
  const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

// --- the books -------------------------------------------------------------
function bookWeights(g: number, line: CoverageLine): { w: number[]; h: number; units: number } {
  const instance = generateGameInstance(`CLFDS${g}`, 61_000_000 + g * 7_919);
  const seed = marketSeedOf(instance);
  const units = unitsOf(seed, line, openingBookUnits(seed, line));
  const e = units.map(u => u.size * u.risk);
  const total = e.reduce((a, b) => a + b, 0);
  const w = e.map(x => x / total);
  return { w, h: w.reduce((a, x) => a + x * x, 0), units: units.length };
}

// --- one book, every BaselineCV ----------------------------------------------
interface BookResult { h: number; units: number; byCv: { pct: number[]; expected: number; analytic: number[]; analyticExpected: number }[] }

function simulateBook(g: number, line: CoverageLine): BookResult {
  const { w, h, units } = bookWeights(g, line);
  const rng = deriveSubRng(4_242_000 + g, 1, `clf_ds_${line}`);
  const sm = sigmaOf(MEMBER_LOSS_CV), mm = -sm * sm / 2;
  const S = new Float64Array(YEARS), Z = new Float64Array(YEARS);
  for (let y = 0; y < YEARS; y++) {
    Z[y] = rng.normal(0, 1);
    let s = 0;
    for (let i = 0; i < w.length; i++) s += w[i] * Math.exp(mm + sm * rng.normal(0, 1));
    S[y] = s;
  }
  const byCv = BASELINE_CVS.map(b => {
    const sb = sigmaOf(b), mb = -sb * sb / 2;
    const r = new Float64Array(YEARS);
    let atOrBelow = 0;
    for (let y = 0; y < YEARS; y++) { r[y] = Math.exp(mb + sb * Z[y]) * S[y]; if (r[y] <= 1) atOrBelow++; }
    r.sort();
    const cv = Math.sqrt(b * b + MEMBER_LOSS_CV ** 2 * h + b * b * MEMBER_LOSS_CV ** 2 * h);
    const s = sigmaOf(cv);
    return {
      pct: PCTS.map(p => quantile(r, p / 100)),
      expected: atOrBelow / YEARS,
      analytic: PCTS.map(p => Math.exp(-s * s / 2 + s * normalInvCdf(p / 100))),
      analyticExpected: normalCdf(s / 2),
    };
  });
  return { h, units, byCv };
}

// --- year-1 rate split on the live stack --------------------------------------
function year1Split(): Record<string, { poolShare: number; clfApplied: number[] }> {
  const acc: Record<string, { share: number[]; clf: number[] }> = {};
  for (const l of LINES) acc[l] = { share: [], clf: [] };
  for (let g = 0; g < RATE_GAMES; g++) {
    const id = `CLFR${g}`;
    const instance = generateGameInstance(id, 62_000_000 + g * 4_931);
    const setup = { poolName: 'C', gameLength: 10, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    const gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    const p = processYear(gs, defaultDecisionSet(1));
    for (const lr of p.lineResults) {
      const x = lr.result as never as Record<string, number>;
      acc[lr.line].share.push(x.poolPremium / x.totalMemberCharge);
      acc[lr.line].clf.push(x.selectedFundingCLF ?? NaN);
    }
  }
  return Object.fromEntries(LINES.map(l => [l, { poolShare: mean(acc[l].share), clfApplied: [Math.min(...acc[l].clf), Math.max(...acc[l].clf)] }]));
}

// --- run -------------------------------------------------------------------
console.log(`=== CLF TABLES, DATA SCIENTIST'S METHOD: ${BOOKS} books x ${YEARS.toLocaleString()} years per line, MemberLossCV ${MEMBER_LOSS_CV} ===\n`);
const results: Record<string, BookResult[]> = {};
for (const line of LINES) {
  results[line] = Array.from({ length: BOOKS }, (_, g) => simulateBook(g, line));
  const hs = results[line].map(r => r.h), us = results[line].map(r => r.units);
  console.log(`  ${line.padEnd(8)} units per book ${Math.min(...us)}-${Math.max(...us)} (mean ${mean(us).toFixed(1)}), H mean ${mean(hs).toFixed(5)} sd ${sd(hs).toFixed(5)}`);
}

const tables: Record<string, Record<string, Record<string, number>>> = {};
const report: Record<string, unknown> = {};
let worstAnalytic = 0, worstAnalyticExpected = 0;
for (const [k, b] of BASELINE_CVS.entries()) {
  const key = `${Math.round(b * 100)}%`;
  tables[key] = {};
  console.log(`\n--- BaselineCV ${key} ---  (mean over books; book-to-book SD in brackets; analytic at the line's mean H)`);
  console.log(`  line      ${PCTS.map(p => `${p}%`.padStart(16)).join('')}   Expected`);
  for (const line of LINES) {
    const rs = results[line].map(r => r.byCv[k]);
    const row: Record<string, number> = {};
    const cells = PCTS.map((p, j) => {
      const v = rs.map(r => r.pct[j]);
      row[`${p}%`] = Number(mean(v).toFixed(4));
      for (const r of rs) worstAnalytic = Math.max(worstAnalytic, Math.abs(r.pct[j] - r.analytic[j]));
      return ` ${mean(v).toFixed(4)} (${sd(v).toFixed(4)})`.padStart(16);
    });
    const ex = rs.map(r => r.expected);
    for (const r of rs) worstAnalyticExpected = Math.max(worstAnalyticExpected, Math.abs(r.expected - r.analyticExpected));
    row.Expected = Number(mean(ex).toFixed(4));
    tables[key][line] = row;
    console.log(`  ${line.padEnd(9)} ${cells.join('')}   ${(100 * mean(ex)).toFixed(1)}% (${(100 * sd(ex)).toFixed(1)})`);
    const hMean = mean(results[line].map(r => r.h));
    const cv = Math.sqrt(b * b + MEMBER_LOSS_CV ** 2 * hMean + b * b * MEMBER_LOSS_CV ** 2 * hMean);
    const s = sigmaOf(cv);
    console.log(`  ${'analytic'.padEnd(9)} ${PCTS.map(p => Math.exp(-s * s / 2 + s * normalInvCdf(p / 100)).toFixed(4).padStart(16)).join('')}   ${(100 * normalCdf(s / 2)).toFixed(1)}%`);
    report[`${key}|${line}`] = { bookToBookSd: Object.fromEntries(PCTS.map((p, j) => [`${p}%`, sd(rs.map(r => r.pct[j]))])) };
  }
}
console.log(`\n  worst |simulated - analytic| over every book, table and percentile: ${worstAnalytic.toFixed(4)}`);
console.log(`  worst |simulated - analytic| on Expected:                            ${(100 * worstAnalyticExpected).toFixed(2)} points`);

console.log('\n--- YEAR-1 RATE EFFECT on the live stack, default games ---');
const split = year1Split();
for (const line of LINES) {
  console.log(`  ${line.padEnd(9)} pool premium ${(100 * split[line].poolShare).toFixed(1)}% of the year-1 charge; CLF applied at defaults ${split[line].clfApplied.map(x => x.toFixed(4)).join('-')}`);
}
console.log(`\n  ${'BaselineCV'.padEnd(11)} ${LINES.map(l => `${l} +70% / +90%`.padStart(22)).join('')}`);
for (const b of BASELINE_CVS) {
  const key = `${Math.round(b * 100)}%`;
  console.log(`  ${key.padEnd(11)} ${LINES.map(l => {
    const t = tables[key][l];
    return `${(100 * split[l].poolShare * (t['70%'] - 1)).toFixed(2)}% / ${(100 * split[l].poolShare * (t['90%'] - 1)).toFixed(2)}%`.padStart(22);
  }).join('')}`);
}

fs.writeFileSync(OUT, JSON.stringify({
  source: 'Ripple_Game_CLF_100_Background_Simulations.R, by simulation on the game\'s opening book units',
  generator: 'scripts/diagnostics/clf-ds-method-derive.ts',
  wired: false,
  memberLossCV: MEMBER_LOSS_CV,
  booksPerLine: BOOKS,
  yearsPerBook: YEARS,
  note: 'Each cell is the mean over books of that book\'s percentile of (ordinary loss / expected ordinary loss). "Expected" is the fraction of years at or below a ratio of 1.0.',
  tables,
}, null, 2) + '\n');
console.log(`\nWrote ${path.relative(process.cwd(), OUT)}: ${BASELINE_CVS.length} tables x ${LINES.length} lines x ${PCTS.length + 1} columns.`);
