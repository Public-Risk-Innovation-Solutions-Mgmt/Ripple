// ============================================================================
// ONE BASELINE CV PER LINE, READ BY BOTH THE ENGINE AND THE FUNDING TABLE —
// THE GATE.
//
//   npx tsx scripts/diagnostics/baseline-cv-table-check.ts
//
// BASELINE_CV sets two things: the CV of the year factor every unit of a
// line's book shares in its ordinary losses, and which funding table the line
// reads. A line whose losses wobble at one CV and are funded off a table built
// at another is priced for a risk it does not run. On every line:
//
//   1. THE TABLE IN FORCE IS THE ONE FILED UNDER THE LINE'S BASELINE_CV —
//      STATIC_CLF_TABLE[line] is BASELINE_CV_TABLES[BaselineCV][line], the
//      same object.
//   2. AND ITS CONTENTS ARE THAT CV'S: every stop from 30% to 90%, and where
//      Expected sits, against the closed form — ordinary loss / expected is a
//      mean-1 lognormal with CV sqrt((1 + B^2)(1 + M^2 H) − 1), H at the
//      market's typical book. Within 0.003 on a stop and 1 point on Expected;
//      neighbouring tables differ by 0.009 or more at the 70% stop and 0.025 or
//      more at 90% (the 6% and 8% tables), so a table filed under the wrong
//      CV cannot pass.
//   3. THE ENGINE DRAWS THE YEAR FACTOR AT THE SAME VALUE: ordinaryLossFromMembers'
//      year factor, recovered from its units, is exactly the draw on the line's
//      labelled stream at BASELINE_CV — on many seeds and years, bit for bit.
//   4. AND THE SLIDER AND REQUIRED CAPITAL READ THAT TABLE: staticClf at each
//      stop is the table's own column, and requiredCapital is the unpaid
//      reserve x (the CLF at RESERVE_MARGIN_CONFIDENCE − 1) — 80% since
//      stable-scenarios commit 2.
//
// ⚠ AND IT FAILS WHEN BROKEN — the CONTROLS feed the same predicates a table
// filed under the wrong CV (each line given its neighbour's) and an engine
// drawing its year factor at the old 2%. Each must be caught.
//
// AND WITH THE SOURCE BROKEN BY HAND, MEASURED: BASELINE_CV.WC moved to 0.07,
// which has no table — exit 1, tableAtBaselineCv throws at load. WC's
// STATIC_CLF_TABLE pointed at GL's — exit 1, WC fails 1 and 2 (0.0518 off at
// 90%). ordinaryLossFromMembers drawing its year factor at 0.02 — exit 1, all
// three lines fail 3 (14-35% off).
// ============================================================================

import { BASELINE_CV, MEMBER_LUCK_CV, UNDERWRITING_MEMBERS } from '../../src/data/pricingParameters';
import {
  BASELINE_CV_TABLES, baselineCvKey, crossingOf, RESERVE_MARGIN_CONFIDENCE, staticClf, STATIC_CLF_TABLE, type ClfTable,
  type StaticClfLine,
} from '../../src/data/clfTables';
import {
  drawOrdinaryFactor, ordinaryLossFromMembers, ordinaryLossRng, ordinaryYearCv,
} from '../../src/utils/ordinaryLoss';
import { requiredCapital } from '../../src/utils/openingReserves';
import { normalCdf, normalInvCdf } from '../../src/utils/claimMath';

const LINES: StaticClfLine[] = ['WC', 'GL', 'Property'];
// Every slider stop, 30% to 90% in fives (FUNDING_SLIDER_RANGE) — each must be a column.
const STOPS = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
const STOP_TOL = 0.003;
const EXPECTED_TOL = 0.01;

const failures: string[] = [];
function check(ok: boolean, what: string, detail = ''): void {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(what);
}

// The closed form. H over the book's equal members, from the parameters alone.
const H = 1 / UNDERWRITING_MEMBERS;
function analytic(b: number) {
  const cv = Math.sqrt((1 + b * b) * (1 + MEMBER_LUCK_CV ** 2 * H) - 1);
  const s = Math.sqrt(Math.log(1 + cv * cv));
  return {
    at: (p: number) => Math.exp(-s * s / 2 + s * normalInvCdf(p)),
    expected: normalCdf(s / 2),
  };
}

// The engine's year factor for one line-year, from its own draw on the
// book's members: realised / expected is the year factor x the members' mean luck.
function engineYearFactor(line: StaticClfLine, seed: number, year: number): number {
  const o = ordinaryLossFromMembers(line, 100, year, seed);
  return o.realised / o.expected / (o.luck.reduce((a, b) => a + b, 0) / o.luck.length);
}

type TableOf = (line: StaticClfLine) => ClfTable;
type YearFactorOf = (line: StaticClfLine, seed: number, year: number) => number;

function grade(tableOf: TableOf, yearFactorOf: YearFactorOf, tag: string): void {
  for (const line of LINES) {
    const b = BASELINE_CV[line];
    console.log(`\n${tag}${line} — BASELINE_CV ${b}`);

    // 1. Filed under its own CV.
    const filed = BASELINE_CV_TABLES[baselineCvKey(b)]?.[line];
    check(filed !== undefined && tableOf(line) === filed, `1. ${line}: the table in force is the one filed under ${baselineCvKey(b)}`);

    // 2. Its contents are that CV's.
    const t = tableOf(line);
    const a = analytic(b);
    let worst = 0, worstAt = 0;
    for (const p of STOPS) {
      const i = t.stops.indexOf(p);
      const got = i >= 0 ? t.clf[i] : NaN;
      const d = Math.abs(got - a.at(p / 100));
      if (!(d <= worst)) { worst = d; worstAt = p; }
    }
    check(worst <= STOP_TOL, `2. ${line}: every stop 30-90% is the closed form at CV ${b}`,
      `worst ${worst.toFixed(4)} at ${worstAt}% (tolerance ${STOP_TOL})`);
    const e = crossingOf(t);
    check(Math.abs(e - a.expected) <= EXPECTED_TOL, `2. ${line}: Expected sits where CV ${b} puts it`,
      `${(100 * e).toFixed(1)}% against ${(100 * a.expected).toFixed(1)}%`);

    // 3. The engine draws its year factor at the same value, bit for bit.
    let worstDraw = 0;
    for (let s = 0; s < 200; s++) {
      for (let y = 1; y <= 10; y += 3) {
        const seed = 9_000_000 + s * 7919;
        const want = drawOrdinaryFactor(ordinaryLossRng(seed, y, line), b);
        worstDraw = Math.max(worstDraw, Math.abs(yearFactorOf(line, seed, y) / want - 1));
      }
    }
    check(worstDraw < 1e-12, `3. ${line}: the engine's year factor is the draw at BASELINE_CV ${b}`,
      `worst relative gap ${worstDraw.toExponential(2)} over 800 line-years`);

    // 4. The slider and required capital read that table.
    const slider = STOPS.every(p => staticClf(line, p / 100) === t.clf[t.stops.indexOf(p)]);
    check(slider, `4. ${line}: the slider's stops 30-90% in fives are the table's own columns`);
    // At the reserve margin's confidence — 80% since stable-scenarios commit 2.
    const level = Math.round(RESERVE_MARGIN_CONFIDENCE * 100);
    const clfM = t.clf[t.stops.indexOf(level)];
    const rc = requiredCapital(line, 100_000_000);
    check(Math.abs(rc - 100_000_000 * (clfM - 1)) < 1e-6, `4. ${line}: required capital is unpaid x (CLF${level} - 1)`,
      `$100M unpaid -> $${(rc / 1e6).toFixed(2)}M at CLF${level} ${clfM.toFixed(4)}`);
  }
}

console.log('BASELINE CV — the engine\'s year factor and the funding table, one value per line');
console.log(`  BASELINE_CV: WC ${BASELINE_CV.WC}, GL ${BASELINE_CV.GL}, Property ${BASELINE_CV.Property}; ordinaryYearCv: `
  + LINES.map(l => `${l} ${ordinaryYearCv(l)}`).join(', '));
grade(l => STATIC_CLF_TABLE[l], engineYearFactor, '');

// ---------------------------------------------------------------- controls
console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, tableOf: TableOf, yearFactorOf: YearFactorOf, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  grade(tableOf, yearFactorOf, '');
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length >= LINES.length, `control: ${name} is caught by ${expect} on every line`, `${caught.length} caught`);
};
const NEIGHBOUR: Record<StaticClfLine, StaticClfLine> = { WC: 'Property', Property: 'GL', GL: 'WC' };
controlFails('each line funded off its neighbour\'s table', l => STATIC_CLF_TABLE[NEIGHBOUR[l]], engineYearFactor, '2.');
controlFails('the engine drawing its year factor at the old 2%',
  l => STATIC_CLF_TABLE[l], (l, seed, y) => drawOrdinaryFactor(ordinaryLossRng(seed, y, l), 0.02), '3.');

console.log(`\n${failures.length === 0 ? 'BASELINE CV HOLDS: ENGINE AND TABLE AGREE ON EVERY LINE.' : `FAIL — ${failures.length}: ${failures.join('; ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
