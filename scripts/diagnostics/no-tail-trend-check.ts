// ============================================================================
// NO TAIL, AND TREND PER LINE BOOKED UP FRONT — THE GATE
// (stable-scenarios commit 3).
//
//   npx tsx scripts/diagnostics/no-tail-trend-check.ts
//
//   1. NO TAIL, PAID: every line's paid pattern is the compressed pattern
//      closed at its last row — share paid / share paid at the end — so it
//      reaches 100% there, and the engine's payments over the pattern sum to
//      exactly 100%.
//   2. NO TAIL, REPORTED: the reported pattern closes on paid's last step — at
//      each age the larger of the recorded share reported and the closed share
//      paid — never behind paid, 100% at the last row, and GL keeps IBNR at
//      every age before its last row.
//   3. PRICING DEVELOPS TO THE END OF THE PATTERN: across played games, every
//      accident year in the pricing window is developed with the closed
//      pattern's factor at its age, and a year past the pattern by 1.
//   4. TREND PER LINE: WC 4%, GL 8%, Property 5%, and the ordinary cost, the
//      shocks' scale and pricing's loss-cost trend all grow at it, years -10
//      to 15.
//   5. THE TREND BOOKED UP FRONT: each line's factor is the sum over
//      development years of the share newly REPORTED that year x
//      (1 + trend)^(k - 1) — inflation up to reporting, not payment — every
//      accident year's ordinary cost and shock scale carry it, and the
//      parameters page states it.
//   6. OLDER YEARS DO NOT DEVELOP FOR TREND: the same WC games played with the
//      factor and without it hold every accident year's ground-up paid, at
//      every valuation, in the ratio of the factor — the ratio does not grow as
//      a year ages.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: the tail kept, reported closed
// on its own end, pricing with a tail factor, GL at 5%, the lag counted from k
// rather than k - 1, the factor run along the paid pattern, and a year that
// develops for trend.
// ============================================================================

import { PRICING_PARAMETER_SECTIONS, SEVERITY_TREND_PER_YEAR, UP_FRONT_TREND } from '../../src/data/pricingParameters';
import {
  INCURRED_DEVELOPMENT_PATTERN, PAID_DEVELOPMENT_PATTERN, UNCLOSED_PATTERNS, paymentInYearEndingAt,
  upFrontTrendFactor, type DevelopmentRow,
} from '../../src/data/paidDevelopmentPatterns';
import { EXPECTED_ORDINARY_LOSS_COST_PER_100 } from '../../src/data/pricingParameters';
import { baseOrdinaryLossCostPer100 } from '../../src/utils/ordinaryLoss';
import { tScale } from '../../src/utils/shockLosses';
import { lossCostTrendPerYear, newPurePremiumPer100 } from '../../src/utils/newPurePremium';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import type { CoverageLine, GameSetupSettings, GameState, PoolState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = Array.from({ length: 26 }, (_, i) => i - 10);
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
type Patterns = Readonly<Record<CoverageLine, readonly DevelopmentRow[]>>;

// ---------------------------------------------------------------- 1 & 2
function gradePatterns(paid: Patterns, reported: Patterns, tag: string) {
  let worstPaid = 0, worstSum = 0, worstRep = 0, behind = 0;
  for (const l of LINES) {
    const raw = UNCLOSED_PATTERNS.paid[l];
    const end = 1 / raw[raw.length - 1].ldf;
    paid[l].forEach((r, i) => { worstPaid = Math.max(worstPaid, Math.abs(1 / r.ldf - (1 / raw[i].ldf) / end)); });
    worstPaid = Math.max(worstPaid, Math.abs(paid[l][paid[l].length - 1].ldf - 1));
    worstSum = Math.max(worstSum, Math.abs(paid[l].reduce((a, r) => a + paymentInYearEndingAt(l, r.ageMonths), 0) - 1));
    reported[l].forEach((r, i) => {
      const want = Math.max(1 / UNCLOSED_PATTERNS.incurred[l][i].ldf, 1 / paid[l][i].ldf);
      worstRep = Math.max(worstRep, Math.abs(1 / r.ldf - want));
      if (r.ldf > paid[l][i].ldf + 1e-12) behind++;
    });
    worstRep = Math.max(worstRep, Math.abs(reported[l][reported[l].length - 1].ldf - 1));
  }
  const gl = reported.GL;
  const glIbnr = gl.slice(0, -1).map(r => 1 - 1 / r.ldf);
  const glLate = glIbnr[glIbnr.length - 1];
  check(worstPaid < 1e-12 && worstSum < 1e-12,
    `${tag}1. paid closes at the last row, shape kept, and the engine pays exactly 100%`,
    `worst share off ${worstPaid.toExponential(2)}, payments off 100% by ${worstSum.toExponential(2)}`);
  check(worstRep < 1e-12 && behind === 0 && glIbnr.every(x => x > 0),
    `${tag}2. reported closes on paid's last step, never behind paid; GL keeps IBNR at every age before its last`,
    `worst share off ${worstRep.toExponential(2)}; GL IBNR at ${gl[gl.length - 2].ageMonths} months ${(glLate * 100).toFixed(2)}%`);
}

// ---------------------------------------------------------------- games
// The pool state at the end of each played year.
interface Played { states: PoolState[] }
function play(id: string, years: number, lines: CoverageLine[]): Played {
  const { setup, instance } = openSoloInstance({ poolName: 'T', gameLength: years, startingYear: 2026, instanceId: id, activeLines: lines } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = { setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState;
  const states: PoolState[] = [];
  for (let y = 1; y <= years; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    states.push(p.updatedPoolState);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return { states };
}

// ---------------------------------------------------------------- 3
const priced = ['NTT1', 'NTT2'].map(id => play(id, 10, LINES));
function gradePricing(ldfAt: (l: CoverageLine, months: number) => number, tag: string) {
  let worst = 0, points = 0;
  for (const g of priced) g.states.forEach((st, i) => { for (const l of LINES) {
    // Priced for the next year off the ledger as it stands — as the engine does.
    const rows = st.lines[l]?.reserveDevelopment ?? [];
    const pp = newPurePremiumPer100(l, i + 2, { rows, allMarketMembers: [], membershipHistory: {} as never });
    for (const p of pp?.points ?? []) {
      points++;
      worst = Math.max(worst, rel(p.ldf, ldfAt(l, p.ageMonths)));
    }
  } });
  check(points > 0 && worst < 1e-12, `${tag}3. pricing develops each window year to the end of the closed pattern, no tail factor`,
    `${points} priced accident years; worst relative ${worst.toExponential(2)}`);
}
const closedLdf = (l: CoverageLine, months: number) => {
  const rows = PAID_DEVELOPMENT_PATTERN[l];
  return rows.find(x => x.ageMonths === months)?.ldf ?? (months > rows[rows.length - 1].ageMonths ? 1 : NaN);
};

// ---------------------------------------------------------------- 4 & 5
const SHIPPED_TREND = { WC: 0.04, GL: 0.08, Property: 0.05 };
// Row k (0-based) is development year k + 1, paid after k years of trend.
// Along the closed REPORTED pattern: the share newly reported in each year.
type Basis = (l: CoverageLine) => readonly DevelopmentRow[];
const reportedBasis: Basis = l => INCURRED_DEVELOPMENT_PATTERN[l];
const factorFrom = (l: CoverageLine, trend: number, lagFrom: number, basis: Basis = reportedBasis) =>
  basis(l).reduce((a, r, k, rows) => a + (1 / r.ldf - (k === 0 ? 0 : 1 / rows[k - 1].ldf)) * Math.pow(1 + trend, k + lagFrom), 0);
const pageEntry = PRICING_PARAMETER_SECTIONS.flatMap(x => x.entries).find(([n]) => n === 'Trend booked up front')?.[1];
function gradeTrend(trend: Record<CoverageLine, number>, lagFrom: number, tag: string, basis: Basis = reportedBasis) {
  let worstGrowth = 0, worstFactor = 0, worstBooked = 0;
  for (const l of LINES) {
    const t = trend[l];
    const F = factorFrom(l, t, lagFrom, basis);
    worstFactor = Math.max(worstFactor, rel(upFrontTrendFactor(l), F));
    worstGrowth = Math.max(worstGrowth, rel(lossCostTrendPerYear(l), 1 + t));
    for (const y of YEARS) {
      const level = Math.pow(1 + t, y - 1) * F;
      worstBooked = Math.max(worstBooked,
        rel(baseOrdinaryLossCostPer100(l, y), EXPECTED_ORDINARY_LOSS_COST_PER_100[l] * level),
        rel(tScale(l, 1000, y) / tScale(l, 1000, 1), level / F));
    }
  }
  check(worstGrowth < 1e-12 && LINES.every(l => SEVERITY_TREND_PER_YEAR[l] === SHIPPED_TREND[l]),
    `${tag}4. trend per line — WC 4%, GL 8%, Property 5% — in losses, shocks and pricing alike`,
    `worst relative ${worstGrowth.toExponential(2)}`);
  const stated = LINES.every(l => pageEntry?.what.includes(`${l} ${upFrontTrendFactor(l).toFixed(4)}`));
  check(worstFactor < 1e-12 && worstBooked < 1e-12 && stated,
    `${tag}5. each accident year is booked with its inflation up to reporting, along the closed reported pattern`,
    `${LINES.map(l => `${l} ${upFrontTrendFactor(l).toFixed(4)}`).join(', ')}; worst relative ${Math.max(worstFactor, worstBooked).toExponential(2)}`);
}

// ---------------------------------------------------------------- 6
// WC alone: no per-claim limit, so every dollar it books scales with its cost
// level and the ratio is exact.
const ids = ['NTW1', 'NTW2', 'NTW3'];
const withF = ids.map(id => play(id, 10, ['WC']));
UP_FRONT_TREND.enabled = false;
const withoutF = ids.map(id => play(id, 10, ['WC']));
UP_FRONT_TREND.enabled = true;
const F_WC = upFrontTrendFactor('WC');
type Series = (st: PoolState) => { ay: number; paid: number[] }[];
const grossSeries: Series = st => (st.lines.WC?.reserveDevelopment ?? [])
  .map(x => ({ ay: x.yearNumber, paid: x.grossPaidByValuation ?? [] }));
function gradeNoTrendDevelopment(series: Series, tag: string) {
  let worst = 0, cells = 0;
  withF.forEach((g, gi) => g.states.forEach((st, si) => {
    const a = series(st), b = grossSeries(withoutF[gi].states[si]);
    a.forEach((row, i) => row.paid.forEach((v, k) => {
      const w = b[i]?.paid[k];
      if (!(w > 0)) return;
      cells++;
      worst = Math.max(worst, rel(v / w, F_WC));
    }));
  }));
  check(cells > 0 && worst < 1e-9, `${tag}6. older years do not develop for trend: ground-up paid is the factor x, at every age`,
    `${cells} accident-year valuations in ${ids.length} WC games; worst relative ${worst.toExponential(2)}`);
}

console.log('NO TAIL, AND TREND PER LINE BOOKED UP FRONT');
gradePatterns(PAID_DEVELOPMENT_PATTERN, INCURRED_DEVELOPMENT_PATTERN, '');
gradePricing(closedLdf, '');
gradeTrend(SHIPPED_TREND, 0, '');
gradeNoTrendDevelopment(grossSeries, '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
const reportedOnOwnEnd = Object.fromEntries(LINES.map(l => {
  const rows = UNCLOSED_PATTERNS.incurred[l];
  const end = rows[rows.length - 1].ldf;
  return [l, rows.map(r => ({ ...r, ldf: r.ldf / end }))];
})) as unknown as Patterns;
controlFails('the tail kept', () => gradePatterns(UNCLOSED_PATTERNS.paid, INCURRED_DEVELOPMENT_PATTERN, ''), '1.');
controlFails('reported closed on its own end', () => gradePatterns(PAID_DEVELOPMENT_PATTERN, reportedOnOwnEnd, ''), '2.');
controlFails('pricing with a tail factor', () => gradePricing((l, m) => {
  const raw = UNCLOSED_PATTERNS.paid[l];
  return closedLdf(l, m) * raw[raw.length - 1].ldf;
}, ''), '3.');
controlFails('GL at 5%', () => gradeTrend({ ...SHIPPED_TREND, GL: 0.05 }, 0, ''), '4.');
controlFails('payment lag counted from k', () => gradeTrend(SHIPPED_TREND, 1, ''), '5.');
controlFails('the factor run along the paid pattern', () => gradeTrend(SHIPPED_TREND, 0, '', l => PAID_DEVELOPMENT_PATTERN[l]), '5.');
controlFails('a year that develops for trend', () => gradeNoTrendDevelopment(r => grossSeries(r)
  .map(x => ({ ...x, paid: x.paid.map((v, k) => v * Math.pow(1.04, k)) })), ''), '6.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — no tail in pricing or the engine, trend per line, booked up front, and older years undeveloped for trend.');
