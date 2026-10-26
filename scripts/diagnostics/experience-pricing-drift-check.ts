// ============================================================================
// EXPERIENCE PRICING DRIFT — DOES THE CHARGED RATE MOVE WHEN NOTHING MOVES?
//
//   npx tsx scripts/diagnostics/experience-pricing-drift-check.ts
//   GAMES=40 npx tsx scripts/diagnostics/experience-pricing-drift-check.ts
//   LINE=GL MAX_EXPOSURE_MOVE=1 npx tsx ...   <- the positive control; see below
//
// ⚠ THIS GATE IS GREEN AND IT WAS COMMISSIONED AS A RED. It was asked for as
// "experience-pricing-check's loop-stability arm, which was never built, and
// which will fail the moment it exists". BOTH HALVES OF THAT WERE WRONG, and the
// file exists anyway for the reason at the bottom of this header. What follows
// is what was actually found, because a gate built on a retracted premise has to
// carry the retraction or the next reader re-derives it.
//
// ============================================================================
// ⚠ THE ARM EXISTS. IT IS ARM 3 OF experience-pricing-check AND IT PASSES.
//
// "DOES THE LOOP STAY STABLE?" — a perturbation experiment: twin games on one
// instance, one twin shocked out of Expected funding for a single year, loop
// gain read as A x B off the divergence. It asserts A < 1 and A x B < 1, reads
// 0.26 / 0.28 / 0.45 on the shipped path, and reads 12.96 on GL against the
// pre-fix double-cession engine, so its silence is a reading and not an absence.
// The gate exits 0, all three arms green, and its EXPECTED_RED entry was already
// removed. simulationEngine's comment saying the arm was owed and the flag was
// off was stale prose on both counts and is corrected at this commit; so was
// gates.ts's tier note.
//
// ============================================================================
// ⚠ AND THE DRIFT IT WAS COMMISSIONED TO CATCH IS NOT THERE. ONE SEED IS NOT A
// MEASUREMENT, WHICH IS THE WHOLE LESSON OF THIS FILE.
//
// The commission cited "Property's charged rate falls 18.1% over ten years on a
// frozen roster, 0.0917 -> 0.0873 -> 0.0751". That figure is real, reproducible,
// and ONE GAME. Across games, on the same construction:
//
//     GAMES = 8      +0.60%  +/- 2.98%
//     GAMES = 40     -0.22%  +/- 1.71%
//
// Property's charged rate does not drift. The single-seed -18.1% sits about two
// standard deviations out on a per-game spread of ~11%, which is an unlucky draw
// and not a defect. It was reported as a finding before it was averaged, and
// this file is partly the apology for that.
//
// ⚠ THE MECHANISM PROPOSED FOR IT IS ALSO WRONG, AND THAT WAS MEASURED RATHER
// THAN DROPPED. The story was that PRICING_TRIANGLE prices off the pool's own
// BOOKED triangle, FORWARD_BOOKING contracts every occurrence before the
// triangle sees it, and so each year another under-booked cohort enters the
// window and ramps the rate down. Steepening Property's contraction should then
// steepen the ramp. It does not — 12 games at each k:
//
//     k = 0.924533 (shipped)   drift +0.20%   rate 0.09932 -> 0.10000
//     k = 0.890000             drift +2.00%   rate 0.07552 -> 0.07447
//     k = 0.850000             drift +2.02%   rate 0.05427 -> 0.05543
//     k = 0.800000             drift -0.67%   rate 0.04201 -> 0.04100
//
// The contraction moves the LEVEL hard — better than halving the charged rate
// between the first row and the last — and moves the TREND not at all. On
// reflection that is what a ROLLING window of fixed length must do: once it has
// filled, every year holds the same mix of contracted cohorts, so there is a
// level shift and no accumulating ramp. There was never a ramp to find.
//
// (The level shift is its own matter and is NOT this gate's subject. A charged
// rate that halves when a booking constant moves is what
// experience-pricing-check arm 1 grades, and it grades it green at 1.024 /
// 1.038 / 0.994.)
//
// ============================================================================
// ⚠ WHY IT IS COMMITTED ANYWAY, AND THIS IS THE ONLY ARGUMENT FOR IT.
//
// Not because it found something. Because it PINS something that nothing else
// pins, and the two gates divide the subject cleanly:
//
//   arm 3 measures the LOOP — how a displacement propagates. Twin-differencing
//   is what makes it robust, and twin-differencing CANCELS anything common to
//   both twins, so an exogenous ramp in the pricing basis is invisible to it by
//   construction. Its own header declines the ambient measurement on purpose:
//   "watching an already-stable system settle proves nothing".
//
//   this file measures the AMBIENT LEVEL PATH — whether the rate sits still when
//   the book sits still. Loop gain below 1 and monotone drift are not
//   alternatives; a stable loop driven by a ramp is stable and drifting.
//
// So the claim "the charged rate is flat on a still book" is now measured rather
// than assumed, and a future change that introduces a ramp is caught by this
// file rather than by somebody noticing it in a single game — which is exactly
// how it was almost "found" this time, in the wrong direction.
//
// It also closes a hole the other gate names in its own closing line:
// "PRICING_TRIANGLE alone is a configuration nothing here has measured."
// Cell 3 below is that configuration.
//
// ============================================================================
// ⚠ PROPERTY IS THE INSTRUMENT AND IT IS THE ONLY LINE ASSERTED ON BY DEFAULT.
//
// The three lines are not equally readable, and the two that are confounded are
// confounded by their own held paths rather than by anything this gate is about.
// Measured here, ten years, PRICING_TRIANGLE OFF, zero sampling error because
// the held path is deterministic:
//
//     WC        -9.80%   the wage divisor outruns the 6% / 3.5% trends
//     GL       +14.87%   glCappedSeverityTrend, capped near 2.0%/yr, not 7%
//     Property   0.00%   PROPERTY_HELD_PURE_PREMIUM_PER_100, to the digit
//
// On WC and GL a flag-on reading has to be scored against a moving null, and
// differencing two engine configurations is the basis hazard this repo has
// retracted more findings to than anything else. Their exposure also moves 37.8%
// over ten years, so their books are not still and the statistic does not mean
// on them what it means on Property. On Property the null is a constant, the
// roster is frozen to 0.000%, and a flat reading is the EXACT expectation rather
// than a tolerance band.
//
// WC and GL are RUN AND PRINTED with their flag-off nulls beside them so the
// confound is visible and quantified rather than argued about. They are not
// graded. Asserting them needs a modelled expectation, not a second engine.
//
// ============================================================================
// ⚠ THE POSITIVE CONTROL, BECAUSE A GATE THAT HAS NEVER FIRED IS NOT A GATE.
//
// The in-file control (cell 2, PT off) reads 0.00% with zero standard error and
// proves the statistic is not manufacturing drift. That is only half of it. The
// other half is that it FIRES on real drift, and the shipped engine supplies
// some: GL's charged rate genuinely climbs.
//
//     LINE=GL MAX_EXPOSURE_MOVE=1 npx tsx scripts/diagnostics/experience-pricing-drift-check.ts
//
// reports GL at +10.97% against a firing threshold of 6.40% and EXITS 2. Both
// knobs are needed and each says something: LINE moves the assertion, and
// MAX_EXPOSURE_MOVE lifts the stillness precondition that otherwise — correctly
// — refuses to grade a line whose book moved 37.8%. Neither is a default and
// neither is a way to make the gate lenient; they only ever make it assert on
// MORE than it does by default.
//
// ⚠ AND THE FLATNESS CONTROL IS SKIPPED ON ANY LINE BUT PROPERTY, WHICH THE
// FIRST BUILD OF THIS FILE GOT WRONG. It fired on GL's held path — correctly
// finding +14.87% — and took the positive control's exit from 2 to 1, so the
// demonstration that exit 2 means the drift assertion was itself broken. The
// held path is only a constant on Property; on WC and GL a nonzero reading there
// is the held path working.
//
// ============================================================================
// ⚠ THE BAR, AND WHAT IS AND IS NOT DERIVED IN IT.
//
// On a still book with a constant true expected loss the correct drift is ZERO.
// There is no principled positive value, so the assertion is a SIGNIFICANCE test
// — |mean drift| > 3 standard errors across games — and the one positive number
// is labelled as the concession it is:
//
//   DETECTION_FLOOR exists ONLY so this does not become a thermometer for GAMES.
//   A pure 3-SE test tightens without limit as the sample grows and would
//   eventually fire on any nonzero drift however small. 2% over ten years is a
//   JUDGEMENT about what is worth a red. It is not derived and is not dressed up
//   as derived.
//
// The gate reports the threshold it actually achieved at the sample it ran, so a
// reader can see what it could and could not have caught. At the shipped GAMES
// it catches a drift of about 6.5% and up; the WC and GL drifts above are inside
// that range, which is the sensitivity check that matters.
//
// ============================================================================
// ⚠ RESTATED FOR ADVERSE DEVELOPMENT (wip/adverse-development): THE STILL-BOOK
// ASSERTION READS THE CELL WITH ADVERSE_DEVELOPMENT OFF, AND A SECOND ARM
// REQUIRES THAT ADVERSE DEVELOPMENT REACHES THE RATE.
//
// With ADVERSE_DEVELOPMENT on, every open prior accident year's reserve grows
// by a λ each played year (Mid: 5% to 15%), and pricing does NOT anticipate
// it: it reaches the rate only as it emerges in the experience. The head
// window (years 1-3) prices off experience that is mostly pre-game, where
// nothing develops; the tail window prices off played years that carry it. So
// on a still book the rate now climbs by more than the trend, by design, and
// the gate went red: Property 6.80% against a 4.20% bar. Measured, 24 games x
// 10 years, Property, shipped cell, flags flipped at runtime on one tree:
//
//     ADVERSE_DEVELOPMENT   RESERVE_INFLATION   drift     SE
//     on  (Mid, shipped)    off (shipped)       +6.80%   1.40%   <- red
//     off                   off                 +0.82%   1.34%
//     on  (Mid)             on (severity trend) +6.82%   1.40%
//     off                   on                  +0.70%   1.34%
//     Mid range set to Low  (1%-5%)   off       +2.89%   1.36%
//     Mid range set to High (15%-20%) off      +11.24%   1.47%
//
// The drift is adverse development and nothing else: off, it returns to 0.82%
// (under the bar, as it read before the branch); it rises monotonically with
// the level; and reserve inflation being off plays no part (+/- 0.12%, well
// inside one SE). ADVERSE_DEVELOPMENT draws on its own labelled stream and no
// other stream moves, so the AD-off cell is a twin of the shipped one — same
// games, same losses — and differencing them is NOT the cross-engine basis
// hazard warned of above. One thing besides λ differs, and it was measured:
// switching ADVERSE_DEVELOPMENT off restores the host's prior-development
// percentages it replaces (PRIOR_DEVELOPMENT_DEFAULTS, Property -2%). With AD
// on and every λ forced to 0, Property reads +1.25% (on - off +0.43%, paired
// SE 0.01%), so of the +5.98% about +5.55% is the λ draws and +0.43% the
// retired percentages — both part of the adverse-development design.
//
// So the gate now asks the two questions separately:
//
//   THE STILL-BOOK ASSERTION (exit 2) is graded on the AD-off twin: with nothing
//   developing, the rate must still sit at the trend. That is this file's
//   original subject, unchanged, and a ramp introduced anywhere else in the
//   pricing basis still fires it.
//
//   THE ADVERSE-DEVELOPMENT ARM (exit 1) requires the shipped cell to drift
//   ABOVE its AD-off twin, paired per game, by more than 3 paired standard
//   errors AND by more than DETECTION_FLOOR (the same 2% judgement as the
//   still-book bar; a 3-SE test alone passes the retired-percentages residue
//   of +0.43% at a paired SE of 0.01%): adverse development must reach the
//   rate through the experience. It reads +5.98% (paired SE 0.15%) at the
//   shipped Mid level. A development that stopped reaching the rate — every λ
//   0, the experience read before it is booked, or the rate anticipating it —
//   fails here. (At Low, 1%-5%, it would read about +2.07%, at the floor; the
//   harness plays Mid. At Low the first in-file control below does NOT fire —
//   +2.89% sits under a 4.03% bar — and exits 1: it is a statement about the
//   shipped level, and a lower default needs this gate re-read.)
//
// IN-FILE CONTROLS, each must FAIL and is checked every run: the shipped
// (AD-on) drifts graded by the still-book assertion (a null cell that lost its
// switch fires), and the AD-off drifts set against themselves in the AD arm (a
// development that does not reach the rate fails). The cells-agree control
// below still holds across the PT / FB cells; it was itself red on this branch
// until 7127acc paid adverse development to pattern with FORWARD_BOOKING off
// (FB off read 4.74% against 6.80%, a 9.42e-3 per $100 gap), and reads 0 since;
// 7127acc did not move the shipped cell (6.80% before and after).
//
// THE POSITIVE CONTROL, RE-READ: LINE=GL now grades GL's AD-off twin at +8.71%
// against a 6.88% bar and EXITS 2 (GL's roster no longer moves, 0.000%, so
// MAX_EXPOSURE_MOVE is not needed for it). The break "AD on, every λ 0" exits 1
// on the AD arm.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { FORWARD_BOOKING, PRICING_TRIANGLE } from '../../src/data/defaultAssumptions';
import { ADVERSE_DEVELOPMENT, NEW_RATE_STACK } from '../../src/data/pricingParameters';
import { EXPOSURE_GROWTH_PER_YEAR, SEVERITY_TREND_PER_YEAR } from '../../src/data/pricingParameters';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(84);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 24);
const YEARS = Number(process.env.YEARS ?? 10);

/** The line the gate ASSERTS on. The other two are confounded by their own held
 *  paths and by a book that moves 37.8%; they are printed, not graded. Override
 *  exists for the positive control — see the header. */
const ASSERTED_LINE = (process.env.LINE ?? 'Property') as CoverageLine;
/** Years averaged at each end, so one heavy register cannot set the reading. */
const WINDOW = 3;
/** Significance: standard errors of the across-game mean. */
const SIGMA = 3;
/** ⚠ A JUDGEMENT, NOT A DERIVATION — see the header. It exists only to stop the
 *  significance test becoming a function of GAMES. */
const DETECTION_FLOOR = 0.02;
/** The instrument needs a still book. If the roster moves, the reading is not
 *  clean and the arm reports UNEVALUATED rather than grading it — the same
 *  precondition discipline arm 3 applies with MIN_SHOCK_CHARGE. Raising this is
 *  how the positive control asserts on a line whose book does move. */
const MAX_EXPOSURE_MOVE = Number(process.env.MAX_EXPOSURE_MOVE ?? 0.005);

interface Cell { pt: boolean; fb: boolean; ad: boolean; name: string }
const CELLS: Cell[] = [
  { pt: true, fb: true, ad: true, name: 'PT on,  FB on   (SHIPPED)' },
  { pt: false, fb: true, ad: true, name: 'PT off, FB on   (held path — the in-file control)' },
  { pt: true, fb: false, ad: true, name: 'PT on,  FB off  (the cell arm 3 says nothing has measured)' },
  { pt: true, fb: true, ad: false, name: 'PT on,  FB on,  ADVERSE_DEVELOPMENT off  (the still-book twin)' },
];
/** Whether the engine as shipped develops at all; if not, every cell is the AD-off cell. */
const AD_SHIPPED = ADVERSE_DEVELOPMENT.enabled;

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, b) => s + (b - m) ** 2, 0) / (a.length - 1));
};

type Track = Record<string, { rate: number[]; exposure: number[] }>;

function playOne(seed: number): Track {
  const id = `EPD${seed}`;
  const inst = generateGameInstance(id, 6_100_000 + seed * 7919);
  const setup = { poolName: 'Drift', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const track: Track = {};
  for (const L of LINES) track[L] = { rate: [], exposure: [] };
  for (let y = 1; y <= YEARS; y++) {
    const out = processYear(gs, defaultDecisionSet(y));
    for (const L of LINES) {
      const r = (out.result as unknown as { byLine?: Record<string, Record<string, unknown>> }).byLine?.[L];
      if (!r) continue;
      const shares = r.memberPremiumShares as { exposure?: number }[] | undefined;
      track[L].rate.push((r.purePremiumPer100 as number) ?? NaN);
      track[L].exposure.push(Array.isArray(shares)
        ? shares.reduce((a, m) => a + (m.exposure ?? 0), 0) : NaN);
    }
    gs = {
      ...gs, poolState: out.updatedPoolState, lockedResults: [...gs.lockedResults, out.result],
      currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1), isComplete: y >= YEARS,
    };
  }
  return track;
}

// ⚠ DRIFT IS NET OF THE TREND NOW, AND THAT IS A RULED CHANGE RATHER THAN A
// RELAXATION. A STILL BOOK'S RATE IS MEANT TO CLIMB AT THE TREND.
//
// This read tail/head - 1 and called zero correct, which was right while the
// rate trend was ~0: WC ran -1.46%/yr, GL +2.00% and Property flat, all small
// enough that a still book looked still. Severity now trends 5%/yr against a
// LEVEL exposure base, so a correctly-behaving rate rises about 5% a year and
// the raw ratio reads ~55% over ten years on a book that has done nothing
// wrong. Property measured 24.28% against a 5.15% bar, and its CONTROL cell —
// PRICING_TRIANGLE off, which returns the held constant — read 39.19% where
// the old premise said it must be flat to the digit. Both were the trend
// arriving, not instability.
//
// The expected ratio is computed from the window MEANS rather than from the
// gap between their centres, so it is exact for a geometric rate instead of
// approximate: a rate of (1+g)^y has head mean sum((1+g)^y, y in head)/W and
// likewise for the tail, and their quotient is what a still book must produce.
const EXPECTED_RATE_TREND: Record<string, number> = {
  WC: (1 + SEVERITY_TREND_PER_YEAR.WC) / (1 + EXPOSURE_GROWTH_PER_YEAR) - 1,
  GL: (1 + SEVERITY_TREND_PER_YEAR.GL) / (1 + EXPOSURE_GROWTH_PER_YEAR) - 1,
  Property: (1 + SEVERITY_TREND_PER_YEAR.Property) / (1 + EXPOSURE_GROWTH_PER_YEAR) - 1,
};

/** What tail/head must be for a rate growing at exactly `g` a year. */
function expectedRatio(n: number, g: number): number {
  const f = (y: number) => Math.pow(1 + g, y);
  let head = 0, tail = 0;
  for (let i = 0; i < WINDOW; i++) { head += f(i); tail += f(n - WINDOW + i); }
  return head === 0 ? NaN : tail / head;
}

/** last-window mean over first-window mean, NET of the line's own rate trend.
 *  Zero on a still book whose rate is climbing at exactly the trend. */
function drift(series: number[], line: string): number {
  if (series.length < 2 * WINDOW) return NaN;
  const head = mean(series.slice(0, WINDOW));
  const tail = mean(series.slice(-WINDOW));
  if (head === 0) return NaN;
  const expected = expectedRatio(series.length, EXPECTED_RATE_TREND[line] ?? 0);
  return (tail / head) / expected - 1;
}

interface Acc { drifts: number[]; expMoves: number[]; rateByYear: number[] }

function runCell(cell: Cell): Record<string, Acc> {
  const wasP = PRICING_TRIANGLE.enabled, wasF = FORWARD_BOOKING.enabled, wasA = ADVERSE_DEVELOPMENT.enabled;
  PRICING_TRIANGLE.enabled = cell.pt;
  FORWARD_BOOKING.enabled = cell.fb;
  ADVERSE_DEVELOPMENT.enabled = AD_SHIPPED && cell.ad;
  try {
    const acc: Record<string, Acc> = {};
    for (const L of LINES) acc[L] = { drifts: [], expMoves: [], rateByYear: new Array(YEARS).fill(0) };
    for (let g = 0; g < GAMES; g++) {
      const t = playOne(g + 1);
      for (const L of LINES) {
        acc[L].drifts.push(drift(t[L].rate, L));
        const e = t[L].exposure;
        acc[L].expMoves.push(e.length && e[0] ? Math.abs(e[e.length - 1] / e[0] - 1) : NaN);
        for (let y = 0; y < YEARS; y++) acc[L].rateByYear[y] += (t[L].rate[y] ?? 0) / GAMES;
      }
    }
    return acc;
  } finally { PRICING_TRIANGLE.enabled = wasP; FORWARD_BOOKING.enabled = wasF; ADVERSE_DEVELOPMENT.enabled = wasA; }
}

// ---------------------------------------------------------------------------
console.log(RULE);
console.log('EXPERIENCE PRICING DRIFT — does the charged rate move when nothing moves?');
console.log(`${GAMES} games x ${YEARS} years x ${CELLS.length} cells. Asserts on ${ASSERTED_LINE} only.`);
console.log(RULE);

const measured = CELLS.map(c => ({ cell: c, acc: runCell(c) }));

for (const { cell, acc } of measured) {
  console.log(`\n--- ${cell.name} ---`);
  console.log('  line        drift yr1->yrN      SE      exposure move    mean rate by year (first -> last)');
  for (const L of LINES) {
    const d = acc[L].drifts.filter(Number.isFinite);
    const m = mean(d), se = sd(d) / Math.sqrt(Math.max(1, d.length));
    const em = mean(acc[L].expMoves.filter(Number.isFinite));
    const ry = acc[L].rateByYear;
    console.log(`  ${L.padEnd(10)} ${(100 * m).toFixed(2).padStart(10)}%  ${(100 * se).toFixed(2).padStart(7)}%  `
      + `${(100 * em).toFixed(3).padStart(12)}%     ${ry[0].toFixed(5)} -> ${ry[ry.length - 1].toFixed(5)}`);
  }
}

// ---------------------------------------------------------------------------
// THE ASSERTION
// ---------------------------------------------------------------------------
console.log(`\n${RULE}`);
console.log(`THE ASSERTION — ${ASSERTED_LINE}, still-book twin (ADVERSE_DEVELOPMENT off); then the adverse-development arm`);
console.log(RULE);

const failed: string[] = [];
const unevaluated: string[] = [];

const shipped = measured[0].acc[ASSERTED_LINE];
const control = measured[1].acc[ASSERTED_LINE];
const noContraction = measured[2].acc[ASSERTED_LINE];
const stillTwin = measured[3].acc[ASSERTED_LINE];

/** The still-book verdict: the drift and its bar, or null if it holds. */
function stillBookFires(drifts: number[]): { m: number; se: number; threshold: number; fires: boolean } {
  const d = drifts.filter(Number.isFinite);
  const m = mean(d);
  const se = sd(d) / Math.sqrt(Math.max(1, d.length));
  const threshold = Math.max(SIGMA * se, DETECTION_FLOOR);
  return { m, se, threshold, fires: !(Math.abs(m) <= threshold) };
}
/** The adverse-development arm: on minus off, paired per game; it must be
 *  positive by more than max(SIGMA paired standard errors, DETECTION_FLOOR). */
function adReaches(on: number[], off: number[]): { m: number; se: number; ok: boolean } {
  const diff = on.map((x, i) => x - off[i]).filter(Number.isFinite);
  const m = mean(diff);
  const se = sd(diff) / Math.sqrt(Math.max(1, diff.length));
  return { m, se, ok: diff.length > 1 && m > Math.max(SIGMA * se, DETECTION_FLOOR) };
}

if (!shipped || !control || !stillTwin) {
  console.log(`  ${ASSERTED_LINE} is not a line this run tracked. LINE must be one of ${LINES.join(', ')}.`);
  process.exitCode = 1;
} else {
  const { m, se, threshold, fires } = stillBookFires(stillTwin.drifts);
  const d = stillTwin.drifts.filter(Number.isFinite);
  const expMove = mean(stillTwin.expMoves.filter(Number.isFinite));
  const cd = mean(control.drifts.filter(Number.isFinite));
  const nd = mean(noContraction.drifts.filter(Number.isFinite));
  const sm = mean(shipped.drifts.filter(Number.isFinite));
  const ad = adReaches(shipped.drifts, stillTwin.drifts);

  console.log(`  mean drift, AD off      ${(100 * m).toFixed(2)}%   <- graded`);
  console.log(`  standard error          ${(100 * se).toFixed(2)}%  over ${d.length} games`);
  console.log(`  fires above             ${(100 * threshold).toFixed(2)}%  = max(${SIGMA} x SE, floor ${100 * DETECTION_FLOOR}%)`);
  console.log(`  shipped drift, AD on    ${(100 * sm).toFixed(2)}%   <- not graded against the still-book bar; see the AD arm`);
  console.log(`  AD arm: on - off        ${(100 * ad.m).toFixed(2)}%  paired SE ${(100 * ad.se).toFixed(2)}%  <- must exceed max(${SIGMA} x SE, floor ${100 * DETECTION_FLOOR}%)`
    + (AD_SHIPPED ? '' : '  (ADVERSE_DEVELOPMENT is off as shipped: arm not graded)'));
  console.log(`  roster movement         ${(100 * expMove).toFixed(3)}%  (instrument needs < ${(100 * MAX_EXPOSURE_MOVE).toFixed(1)}%)`);
  console.log(`  control, PT off         ${(100 * cd).toFixed(2)}%  <- ${NEW_RATE_STACK.enabled
    ? 'must EQUAL the shipped cell: neither flag is on the new rate\'s path'
    : 'must be flat, or this file is measuring itself'}`);
  console.log(`  no contraction, FB off  ${(100 * nd).toFixed(2)}%  <- the cell nothing else measures`);

  if (!Number.isFinite(expMove) || expMove > MAX_EXPOSURE_MOVE) {
    unevaluated.push(`the ${ASSERTED_LINE} roster moved ${(100 * expMove).toFixed(3)}% over the game, above the `
      + `${(100 * MAX_EXPOSURE_MOVE).toFixed(1)}% this instrument needs. A drift reading on a moving book does not mean `
      + 'what it means on a still one, and this arm declines to grade it rather than reporting a number it '
      + 'cannot defend. Raise MAX_EXPOSURE_MOVE only to run the positive control.');
  } else if (fires) {
    failed.push(`${ASSERTED_LINE}'s charged rate drifts ${(100 * m).toFixed(2)}% over ${YEARS} years, ADVERSE_DEVELOPMENT off, on a book whose `
      + `exposure moves ${(100 * expMove).toFixed(3)}%, against a firing threshold of ${(100 * threshold).toFixed(2)}%. `
      + `PT off reads ${(100 * cd).toFixed(2)}% and FB off reads ${(100 * nd).toFixed(2)}% — read those two before choosing a fix. `
      + '⚠ THIS GATE CANNOT SAY WHICH FIX. A red says the charged rate is unstable on a still book. It does not '
      + 'say whether to change the booking, damp the loop, or turn PRICING_TRIANGLE off, and TURNING IT OFF IS A '
      + 'REAL OPTION RATHER THAN A RETREAT: the held rate is stable by construction rather than by measurement, '
      + 'and experience-pricing-check arm 1 reads the held arm charging 1.024 / 1.038 / 0.994 of its own realised '
      + 'cost. What the pool would lose is pricing off its own experience, which is the whole reason the flag '
      + 'exists. That trade is a judgement for a human and this file does not make it.');
  }

  // THE ADVERSE-DEVELOPMENT ARM — see the header. Not a drift verdict, so exit 1.
  if (AD_SHIPPED && !ad.ok) {
    failed.push(`ADVERSE DEVELOPMENT DOES NOT REACH THE RATE. ${ASSERTED_LINE}'s drift with it on less its AD-off twin `
      + `reads ${(100 * ad.m).toFixed(2)}% (paired SE ${(100 * ad.se).toFixed(2)}%), and it must exceed `
      + `max(${SIGMA} paired SEs, ${100 * DETECTION_FLOOR}%): the rate is meant to pick it up as it emerges in the experience (+5.98% at Mid when this `
      + 'was restated). Either the experience is read before the development is booked, or the rate now anticipates it.');
  }

  // IN-FILE CONTROLS on the recorded drifts — each must FAIL (see the header).
  if (AD_SHIPPED) {
    const c1 = stillBookFires(shipped.drifts).fires;
    const c2 = !adReaches(stillTwin.drifts, stillTwin.drifts).ok;
    console.log(`  control: the AD-on drifts graded as the still book  ${c1 ? 'fires (caught)' : 'DOES NOT FIRE'}`);
    console.log(`  control: AD-off set against itself in the AD arm    ${c2 ? 'fails (caught)' : 'DOES NOT FAIL'}`);
    if (!c1 || !c2) {
      failed.push(`THE CONTROL IS NOT CAUGHT: ${!c1 ? `the shipped AD-on drifts (${(100 * sm).toFixed(2)}%) pass the still-book bar, so that bar can no longer see a ramp of adverse development's size — `
        + `measured at Mid it fires at 6.80%; at Low (2.89%) it would not, so if ADVERSE_DEVELOPMENT_DEFAULT_LEVEL or its range moved, re-read this control` : ''}`
        + `${!c1 && !c2 ? '; ' : ''}${!c2 ? 'the AD arm passes a cell against itself' : ''}.`);
    }
  }

  // The in-file control outranks the verdict above: if the held path is not
  // flat, the instrument is broken and nothing it says is worth anything.
  //
  // ⚠ PROPERTY ONLY, AND THAT IS NOT A CONVENIENCE. The held path is a constant
  // on Property alone; WC's carries a wage divisor and GL's a capped severity
  // trend, so a nonzero reading there is the held path working correctly and
  // asserting on it would make the positive control fail for the wrong reason.
  //
  // ⚠ FORKED WHEN THE NEW RATE STACK WENT LIVE, AND THE CONTROL IS A DIFFERENT
  // CONTROL NOW RATHER THAN A RELAXED ONE. Under the new stack all three cells
  // return the SAME rate to the last digit, so "PT off must be flat" stopped
  // being a null: PRICING_TRIANGLE and FORWARD_BOOKING no longer reach the
  // charged rate at all. That is the design and not a defect — the new rate is
  // struck from newPurePremium.ts, which reads grossPaidByValuation off the
  // ledger and develops it on the recorded paid LDFs. It never consults the
  // BOOKED triangle, so turning the triangle off changes nothing to turn off.
  //
  // Left as it was, the control asserted a null that no longer exists and read
  // the shipped cell's own 5.23% back as a broken instrument.
  //
  // WHAT REPLACES IT IS STRONGER, not weaker: the three cells must agree
  // EXACTLY. That is a checkable claim about the new stack's basis, and it
  // fails the moment anyone wires the booked triangle back into the rate —
  // which is the defect the old control would have been watching for if it
  // still could. The drift verdict above stands on its own either way.
  //
  // ⚠ IT IS EXACT, AND THAT WAS MEASURED RATHER THAN HOPED FOR. The cells read
  // 0 apart across 24 games x 10 years, and the deliberate break — multiplying
  // the shipped cell by 1 + 1e-7 — fires at 4.54e-8 per $100. A bar at exact
  // equality is only worth setting if it holds exactly, so it was checked.
  if (NEW_RATE_STACK.enabled) {
    const worst = Math.max(
      ...[control, noContraction].map(c => Math.max(
        ...shipped.rateByYear.map((r, i) => Math.abs(r - (c.rateByYear[i] ?? NaN))))));
    if (!Number.isFinite(worst) || worst > 0) {
      failed.push(`THE CELLS NO LONGER AGREE. ${ASSERTED_LINE}'s mean charged rate differs across the `
        + `PRICING_TRIANGLE / FORWARD_BOOKING cells by up to ${worst.toExponential(2)} per $100, and under the `
        + 'new rate stack it must be exactly 0: the rate is struck off the ledger by newPurePremium.ts and '
        + 'neither flag is on that path. Either something has wired the booked triangle back into the charged '
        + 'rate, or the ledger those flags write is now feeding it. Find which before reading the drift '
        + 'verdict above, because that verdict assumes the basis is the one this file thinks it is.');
    }
  } else if (ASSERTED_LINE === 'Property' && (!Number.isFinite(cd) || Math.abs(cd) > DETECTION_FLOOR)) {
    failed.push(`THE CONTROL IS NOT FLAT. Property with PRICING_TRIANGLE off drifts ${(100 * cd).toFixed(2)}%, `
      + 'and it should be zero to the digit — that cell returns PROPERTY_HELD_PURE_PREMIUM_PER_100 unchanged, '
      + 'with no trend and no wage divisor. Something upstream moved and the verdict above cannot be trusted '
      + 'until it is explained.');
  }

  console.log(`\n${RULE}`);
  if (unevaluated.length) {
    console.log('UNEVALUATED:');
    for (const u of unevaluated) console.log(`  - ${u}`);
  }
  if (failed.length) {
    console.log(`${failed.length} FAILURE(S):`);
    for (const f of failed) console.log(`  - ${f}`);
    console.log('\n⚠ EXIT 2 IS THE DRIFT ASSERTION AND NOTHING ELSE, so that a broken control or a failed');
    console.log('  precondition can never hide behind it. Those exit 1 and block.');
    // Exit 2 only when the still-book drift is the ONLY failure; a broken
    // control, the cells disagreeing or the AD arm exit 1.
    process.exitCode = failed.every(f => f.startsWith(`${ASSERTED_LINE}'s charged rate drifts`)) ? 2 : 1;
  } else if (unevaluated.length) {
    process.exitCode = 1;
  } else {
    console.log(`NO DRIFT. ${ASSERTED_LINE}'s charged rate is flat on a still book with nothing developing${AD_SHIPPED
      ? ', adverse development reaches it through the experience,' : ''} and ${NEW_RATE_STACK.enabled
      ? 'the three cells agree exactly' : 'the control is flat'}.`);
    console.log('This is the expected result and the gate is a guard, not an open item — see the header for');
    console.log('why it exists given that it was commissioned as a red and is not one.');
  }
}
