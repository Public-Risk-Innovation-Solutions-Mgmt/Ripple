// ============================================================================
// THE DEVELOPMENT CLOCKS, PER LINE — A PROBE. Asserts nothing.
//
//   npx tsx scripts/diagnostics/development-clocks-report.ts
//
// "Ten years of development on WC" is five different clocks, and they do not
// agree. This prints each one from the engine's own constants and functions,
// so a compression (feature/fast-development) can be read against them rather
// than against prose:
//
//   PAID       value paid by age          LINE_PAYOUT_PATTERN (FITTED_PAYOUT_PATTERN)
//   CLOSED     claim count closed by age  FITTED_CLOSURE_CURVE
//   CLOSED >   the large-claim band       CLOSURE_BY_SIZE.large (WC, GL; at CLOSURE_SIZE_THRESHOLD)
//   OPEN SHARE value still developing     TRIANGLE_OPEN_SHARE (open-share-derive.ts)
//   HORIZON    cohort development stop    IBNER_HORIZON, drawn per cohort
//   WINDOW     the pricing triangle       TRIANGLE_HISTORY_YEARS
//
// ⚠ PAID IS VALUE AND CLOSED IS COUNT. A line can close most of its files
// while paying little of its value — that is the large-claim tail, and it is
// why closed-by-value must never run ahead of paid (claim-drift-derive and the
// threshold reading in STATE_fast-development.md both rely on it).
// ============================================================================
import {
  LINE_PAYOUT_PATTERN, FITTED_CLOSURE_CURVE, CLOSURE_BY_SIZE, CLOSURE_SIZE_THRESHOLD,
  IBNER_HORIZON, TRIANGLE_OPEN_SHARE, TRIANGLE_HISTORY_YEARS,
} from '../../src/data/defaultAssumptions';
import { cumulativePaid } from '../../src/utils/payoutPattern';
import { closedShare } from '../../src/utils/claimClosure';

const ages = [1, 2, 3, 5, 8, 10, 15];
const first = (f: (t: number) => number, x: number) => { for (let t = 1; t <= 60; t++) if (f(t) >= x) return t; return '>60'; };
const row = (f: (t: number) => number) => ages.map(a => (100 * f(a)).toFixed(1).padStart(6)).join('');

for (const L of ['WC', 'GL', 'Property']) {
  const pay = (t: number) => cumulativePaid(LINE_PAYOUT_PATTERN[L], t);
  const clo = (t: number) => closedShare(FITTED_CLOSURE_CURVE[L], t);
  console.log(`\n${L}`);
  console.log(`  age                     ${ages.map(a => String(a).padStart(6)).join('')}`);
  console.log(`  PAID (value)            ${row(pay)}   90% paid by age ${first(pay, 0.9)}, 99% by ${first(pay, 0.99)}`);
  console.log(`  CLOSED (count, all)     ${row(clo)}   90% closed by ${first(clo, 0.9)}`);
  const sp = CLOSURE_BY_SIZE[L];
  if (sp) {
    const big = (t: number) => closedShare(sp.large, t);
    console.log(`  CLOSED (>$${CLOSURE_SIZE_THRESHOLD / 1e3}k claims) ${row(big)}   90% closed by ${first(big, 0.9)}`);
  }
  const os = TRIANGLE_OPEN_SHARE[L];
  console.log(`  OPEN SHARE (value, dev) ${row(a => os[a - 1] ?? 0)}   last nonzero step ${os.reduce((m, v, i) => (v > 0 ? i + 1 : m), 0)}`);
  console.log(`  IBNER HORIZON           cohort drawn uniformly ${IBNER_HORIZON[L].min}-${IBNER_HORIZON[L].max} years (mean ${(IBNER_HORIZON[L].min + IBNER_HORIZON[L].max) / 2})`);
}
console.log(`\nPRICING WINDOW (all lines): ${TRIANGLE_HISTORY_YEARS} accident years`);
