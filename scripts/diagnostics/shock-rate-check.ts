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
// RESTATED FOR wip/large-claims-frequency: the catalogue events no longer set
// large (T) claims — each line draws at most one a year by frequency (Low 7.5%,
// Mid 5.25%, High 2.25%), uniform across its level's range x the trend. So
// section 2 now holds the UPLIFT to the scale x the R model's as before, and
// the expected SHOCK LARGE LOSSES to NOT MOVING with the catalogue's
// probabilities at all (identical at the shipped and the R model's), and to
// the brief written out: Σ over levels of freq x the range's midpoint x
// (1 + trend)^(y - 1), WC 4%, GL 8%, Property 5%. New control: the events' T
// switched back on (LARGE_CLAIMS_BY_FREQUENCY off) is caught by 2.
//
// RESTATED FOR EVENTS_KEEPING_LARGE_CLAIMS (Nuclear Verdict keeps its own
// large claim): when NV fires, GL gets one High claim ($7-40M) on top of the
// frequency draw, and expectedLossBreakdown (shocks on) carries its expectation
// in shockLarge: p(NV) x the High range's midpoint x the GL trend (GL has no
// pool limit, so the pool's share of the claim is all of it). So section 2's
// expected large claims are now the brief's frequencies x midpoints x trend
// PLUS, on GL only, p(NV) x $23.5M x 1.08^(y - 1) — p(NV) written out as the R
// model's 2.5% x the catalogue scale; and the catalogue now moves GL's by NV's
// probability ONLY (at the R model's probabilities GL carries 2.5% x the same),
// WC's and Property's not at all. New controls: EVENTS_KEEPING_LARGE_CLAIMS
// emptied at runtime, and Pandemic added to it, are each caught by 2.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: one event left unscaled,
// pricing on the R model's probabilities, the old one-per-three-years count,
// and an event slipped into year 1.
// ============================================================================

import { EVENTS_KEEPING_LARGE_CLAIMS, LARGE_CLAIMS_BY_FREQUENCY, R_MODEL, SHOCK_CATALOGUE_SCALE, SHOCKS_PER_YEAR } from '../../src/data/pricingParameters';
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
type Costs = { shipped: Map<string, number[]>; raw: Map<string, number[]> };
function costs(): Costs {
  const atShipped = new Map<string, number[]>();
  for (const l of LINES) for (let y = 1; y <= 15; y++) atShipped.set(`${l}|${y}`, shockCost(l, y));
  setProbs(RAW);
  const atRaw = new Map<string, number[]>();
  for (const l of LINES) for (let y = 1; y <= 15; y++) atRaw.set(`${l}|${y}`, shockCost(l, y));
  setProbs(shipped);
  return { shipped: atShipped, raw: atRaw };
}
const shippedCosts = costs();
// THE BRIEF, written out: each line's one large claim a year by level.
type Lv = 'Low' | 'Mid' | 'High';
const BRIEF_FREQ: Record<Lv, number> = { Low: 0.075, Mid: 0.0525, High: 0.0225 };
const BRIEF_RANGE: Record<CoverageLine, Record<Lv, [number, number]>> = {
  WC: { Low: [1e6, 3e6], Mid: [3e6, 6e6], High: [6e6, 40e6] },
  GL: { Low: [1e6, 3e6], Mid: [3e6, 7e6], High: [7e6, 40e6] },
  Property: { Low: [2e6, 5e6], Mid: [5e6, 12e6], High: [12e6, 40e6] },
};
const BRIEF_TREND: Record<CoverageLine, number> = { WC: 0.04, GL: 0.08, Property: 0.05 };
const briefLarge = (l: CoverageLine, y: number) => Math.pow(1 + BRIEF_TREND[l], y - 1)
  * (Object.keys(BRIEF_FREQ) as Lv[]).reduce((a, lv) => a + BRIEF_FREQ[lv] * (BRIEF_RANGE[l][lv][0] + BRIEF_RANGE[l][lv][1]) / 2, 0);
// Nuclear Verdict's own GL claim (EVENTS_KEEPING_LARGE_CLAIMS), written out:
// GL High $7-40M, its midpoint x the GL trend, at the event's probability.
const NV_RAW_P = 0.025;
const nvLarge = (l: CoverageLine, y: number, p: number) => (l === 'GL' ? p * ((7e6 + 40e6) / 2) * Math.pow(1 + BRIEF_TREND.GL, y - 1) : 0);
function gradePricing(c: Costs, uplift: Map<string, number[]>, tag: string) {
  let worstUplift = 0, worstMoved = 0, worstBrief = 0;
  for (const [k, v] of uplift) worstUplift = Math.max(worstUplift, rel(v[0], SHOCK_CATALOGUE_SCALE * c.raw.get(k)![0]));
  for (const [k, v] of c.shipped) {
    const [l, y] = k.split('|');
    const line = l as CoverageLine, yr = Number(y);
    // At the R model's probabilities: the brief plus NV at its raw 2.5% (GL only) — the catalogue moves NV's share alone.
    worstMoved = Math.max(worstMoved, rel(c.raw.get(k)![1], briefLarge(line, yr) + nvLarge(line, yr, NV_RAW_P)),
      line === 'GL' ? 0 : rel(v[1], c.raw.get(k)![1]));
    worstBrief = Math.max(worstBrief, rel(v[1], briefLarge(line, yr) + nvLarge(line, yr, NV_RAW_P * SHOCK_CATALOGUE_SCALE)));
  }
  const y1 = LINES.map(l => `${l} uplift ${(uplift.get(`${l}|1`)![0] * 100).toFixed(2)}%, large $${(c.shipped.get(`${l}|1`)![1] / 1e6).toFixed(3)}M`).join('; ');
  check(worstUplift < 1e-12 && worstMoved < 1e-12 && worstBrief < 1e-12,
    `${tag}2. pricing reads the scaled rate: each line's expected uplift is ${SHOCK_CATALOGUE_SCALE.toFixed(4)} x the R model's; its expected large claims are the brief's frequencies x midpoints x trend plus, on GL, p(NV) x its claim's — the catalogue moving GL's by NV's probability only`,
    `year 1: ${y1}; worst relative — uplift ${worstUplift.toExponential(2)}, large moved by the catalogue ${worstMoved.toExponential(2)}, large off the brief ${worstBrief.toExponential(2)}`);
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
gradePricing(shippedCosts, shippedCosts.shipped, '');
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
controlFails('pricing on the R model\'s probabilities', () => gradePricing(shippedCosts, shippedCosts.raw, ''), '2.');
controlFails('the events\' T switched back on (LARGE_CLAIMS_BY_FREQUENCY off)', () => {
  LARGE_CLAIMS_BY_FREQUENCY.enabled = false;
  try { const c = costs(); gradePricing(c, c.shipped, ''); } finally { LARGE_CLAIMS_BY_FREQUENCY.enabled = true; }
}, '2.');
const keptList = EVENTS_KEEPING_LARGE_CLAIMS as string[];
const withKept = (list: string[], run: () => void) => {
  const was = [...keptList]; keptList.splice(0, keptList.length, ...list);
  try { run(); } finally { keptList.splice(0, keptList.length, ...was); }
};
controlFails('EVENTS_KEEPING_LARGE_CLAIMS emptied (NV\'s claim dropped)', () => withKept([], () => { const c = costs(); gradePricing(c, c.shipped, ''); }), '2.');
controlFails('Pandemic added to EVENTS_KEEPING_LARGE_CLAIMS', () => withKept(['Nuclear Verdict', 'Pandemic'], () => { const c = costs(); gradePricing(c, c.shipped, ''); }), '2.');
controlFails('a written-out range moved (WC High from $6M)', () => {
  const saved = BRIEF_RANGE.WC.High[0];
  BRIEF_RANGE.WC.High[0] = 7e6;
  try { gradePricing(shippedCosts, shippedCosts.shipped, ''); } finally { BRIEF_RANGE.WC.High[0] = saved; }
}, '2.');
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
