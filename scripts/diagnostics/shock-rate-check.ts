// ============================================================================
// SHOCKS AT 0.3 A YEAR, AND THE SCHEDULE'S COUNT — THE GATE
// (stable-scenarios commit 5).
//
//   npx tsx scripts/diagnostics/shock-rate-check.ts
//
//   1. THE CATALOGUE IS SCALED, NOT RESHAPED: every one of the twelve
//      probabilities is the R model's times one factor, they total
//      SHOCKS_PER_YEAR (0.3), and each event's share of the total is unchanged.
//   2. PRICING READS THE SCALED RATE: each line's expected uplift rate and its
//      expected shock large losses are exactly the scale times what the R
//      model's probabilities give, years 1 to 15. (The uplift's DOLLARS are
//      not checked: on Property the routine fold divides the ordinary cost by
//      1 + the expected uplift, so they are not linear in the rate, by design.)
//   3. THE COUNT: over many seeds, every schedule holds round(0.3 x years)
//      −1, 0 or +1 events, never fewer than one — 2 to 4 in ten years — and in
//      a ten-year game each of the three counts turns up about a third of the
//      time.
//   4. THE SHAPE: no event in year 1, one event a year at most, no event twice.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: one event left unscaled,
// pricing on the R model's probabilities, the old one-per-three-years count,
// and an event slipped into year 1.
// ============================================================================

import { R_MODEL, SHOCK_CATALOGUE_SCALE, SHOCKS_PER_YEAR } from '../../src/data/pricingParameters';
import { SHOCK_EVENTS } from '../../src/utils/shockLosses';
import { expectedLossBreakdown, upliftMoments } from '../../src/utils/shockExpectation';
import { drawShockSchedule, shockDrawRange, HOST_SHOCK_STREAM, SOLO_SHOCK_STREAM } from '../../src/utils/shockSchedule';
import type { ScheduledShock } from '../../src/types/shocks';
import type { CoverageLine } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
const RAW = R_MODEL.catalogue.map(([, p]) => p as number);
const RAW_TOTAL = RAW.reduce((a, p) => a + p, 0);

// ---------------------------------------------------------------- 1
function gradeCatalogue(probs: number[], tag: string) {
  const total = probs.reduce((a, p) => a + p, 0);
  const worstShare = Math.max(...probs.map((p, i) => rel(p / total, RAW[i] / RAW_TOTAL)));
  const worstScale = Math.max(...probs.map((p, i) => rel(p, RAW[i] * SHOCK_CATALOGUE_SCALE)));
  check(Math.abs(total - SHOCKS_PER_YEAR) < 1e-12 && worstShare < 1e-12 && worstScale < 1e-12,
    `${tag}1. the twelve probabilities are the R model's x ${SHOCK_CATALOGUE_SCALE.toFixed(4)}, totalling ${SHOCKS_PER_YEAR}, weights kept`,
    `total ${total.toFixed(6)} (R model ${RAW_TOTAL}); worst share off ${worstShare.toExponential(2)}`);
}

// ---------------------------------------------------------------- 2
// The shock cost at the shipped probabilities against the R model's, read by
// setting the events' probabilities in place and putting them back.
const shockCost = (l: CoverageLine, y: number) => [upliftMoments(l, y).mean, expectedLossBreakdown(l, 1000, y).shockLarge];
const setProbs = (ps: number[]) => SHOCK_EVENTS.forEach((e, i) => { (e as { probability: number }).probability = ps[i]; });
const shipped = SHOCK_EVENTS.map(e => e.probability);
const atShipped = new Map<string, number[]>();
for (const l of LINES) for (let y = 1; y <= 15; y++) atShipped.set(`${l}|${y}`, shockCost(l, y));
setProbs(RAW);
const atRaw = new Map<string, number[]>();
for (const l of LINES) for (let y = 1; y <= 15; y++) atRaw.set(`${l}|${y}`, shockCost(l, y));
setProbs(shipped);
function gradePricing(priced: Map<string, number[]>, tag: string) {
  let worst = 0;
  for (const [k, v] of priced) v.forEach((x, i) => { worst = Math.max(worst, rel(x, SHOCK_CATALOGUE_SCALE * atRaw.get(k)![i])); });
  const y1 = LINES.map(l => `${l} uplift ${(priced.get(`${l}|1`)![0] * 100).toFixed(2)}%, large $${(priced.get(`${l}|1`)![1] / 1e6).toFixed(3)}M`).join('; ');
  check(worst < 1e-12, `${tag}2. pricing reads the scaled rate: each line's expected uplift and shock large losses are ${SHOCK_CATALOGUE_SCALE.toFixed(4)} x the R model's`,
    `year 1, per $1,000M exposure: ${y1}; worst relative ${worst.toExponential(2)}`);
}

// ---------------------------------------------------------------- 3 & 4
const SEEDS = 3000;
type Draw = (seed: string, years: number, stream: string) => ScheduledShock[];
function gradeSchedules(draw: Draw, range: (y: number) => { min: number; max: number }, tag: string) {
  let outside = 0, bad = 0, total = 0;
  const tenYear: Record<number, number> = {};
  for (const years of [2, 3, 5, 8, 10, 15, 20]) {
    for (const stream of [SOLO_SHOCK_STREAM, HOST_SHOCK_STREAM]) {
      for (let i = 0; i < SEEDS / 2; i++) {
        const s = draw(`SRC${i}`, years, stream);
        total++;
        const { min, max } = range(years);
        if (s.length < min || s.length > max) outside++;
        if (years === 10) tenYear[s.length] = (tenYear[s.length] ?? 0) + 1;
        const ys = s.map(e => e.yearNumber), ids = s.map(e => e.shockId);
        if (ys.some(y => y < 2 || y > years) || new Set(ys).size !== ys.length || new Set(ids).size !== ids.length) bad++;
      }
    }
  }
  const n10 = Object.values(tenYear).reduce((a, b) => a + b, 0);
  const thirds = [2, 3, 4].every(c => Math.abs((tenYear[c] ?? 0) / n10 - 1 / 3) < 0.04);
  check(outside === 0 && thirds && Object.keys(tenYear).every(c => [2, 3, 4].includes(Number(c))),
    `${tag}3. every schedule holds round(0.3 x years) ± 1 events, at least one; ten years draw 2, 3 or 4 about equally`,
    `${total.toLocaleString('en-US')} schedules; ten years: ${[2, 3, 4].map(c => `${c}: ${(((tenYear[c] ?? 0) / n10) * 100).toFixed(1)}%`).join(', ')}`);
  check(bad === 0, `${tag}4. no event in year 1, one a year at most, no event twice`, `${bad} schedules broke the shape`);
}

console.log('SHOCKS AT 0.3 A YEAR, AND THE SCHEDULE\'S COUNT');
gradeCatalogue(shipped, '');
gradePricing(atShipped, '');
gradeSchedules(drawShockSchedule, shockDrawRange, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('one event left unscaled', () => gradeCatalogue(shipped.map((p, i) => (i === 9 ? RAW[9] : p)), ''), '1.');
controlFails('pricing on the R model\'s probabilities', () => gradePricing(atRaw, ''), '2.');
controlFails('the old one-per-three-years count', () => gradeSchedules(
  (seed, years, stream) => drawShockSchedule(seed, years, stream).slice(0, Math.max(1, Math.round(years / 3))),
  shockDrawRange, ''), '3.');
controlFails('an event slipped into year 1', () => gradeSchedules(
  (seed, years, stream) => drawShockSchedule(seed, years, stream).map((e, i) => (i === 0 ? { ...e, yearNumber: 1 } : e)),
  shockDrawRange, ''), '4.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — the catalogue scaled to 0.3 a year with its weights kept, priced so, and the schedule\'s count and shape.');
