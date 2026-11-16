// ============================================================================
// THE DEVELOPMENT-CESSION UPLIFT — A GATE, AND THE SINGLE-ARM ASSERTION.
//
// Exit 0 green, 1 on ANY failure (a limit, a NOT MEASURED line, the basis
// check, or a control). There is no exit 2 and no EXPECTED_RED entry: the
// re-derivation below is what that entry deferred, and it is done.
//
// It began as the test of whether the uplift a developed-register price would
// need is decision-dependent (it is not; the apparent dependence was the
// give-back on the wrong side of the decomposition), and it carries the
// SINGLE-ARM DOLLAR ASSERTION that development cession is not a free lunch.
//
// ============================================================================
// ⚠ RE-DERIVED FOR A DEVELOPING BOOK (wip/adverse-development). THE GATE NO
// LONGER GRADES THE UPLIFT; IT GRADES DEVELOPMENT CESSION AGAINST A BENCHMARK.
//
// WHY THE OLD LIMITS COULD NOT STAND. They bounded UPLIFT = lifetime
// development cession / inception cession at 6% per line and 1.5% pooled, set
// "above the measured value (4.1% WC) and below the defect (9.9% under the
// retired asymmetric routing)" on a book whose development was mean-one noise.
// The book now DEVELOPS: ADVERSE_DEVELOPMENT grows every open prior year's
// outstanding by its λ, booked on the reserve-inflation route, allocated
// PROPORTIONALLY across the register and ceded under the year's own cover.
// Every arm buys '$38M xs $2M', and with ROUTINE_LARGE_LOSSES off the only
// claims a layer reaches are the shocks' T claims ($1M-$40M, usually wholly
// inside the layer), so nearly every dollar a T claim develops by is ceded.
// The uplift then measures HOW MUCH THE BOOK DEVELOPED, not whether cession is
// routed fairly: 30 games x 20 years, matured cohorts, defaults —
//
//     uplift   WC 60.6%   GL 22.7%   Property 5.8%   pool 14.6%
//
// all of it the cover answering real development (the whole register grows
// 1.517x / 1.331x / 1.088x over those cohorts' lives). No absolute uplift
// limit separates that from a defect: a book that develops more cedes more.
//
// THE BASIS. For each cohort, the cession its ceded claims' development WOULD
// produce if each developed at its own cohort's rate:
//
//     F          = whole-register gross at the last valuation seen
//                  / whole-register gross at inception
//                  (sum of developingClaims.current + untrackedTotal, against
//                   sum of .original + untrackedTotal as written — it agrees
//                   with grossPaid + grossUnpaid to the cent)
//     BENCHMARK  = sum over the INCEPTION tracked claims of
//                  cede(original x F) - cede(original)
//                  through placedAtInception, each claim's own deductible —
//                  cedeDevelopment's arithmetic exactly (cedeAbove per layer)
//     ACTUAL     = lifetime development cession = final cededDevelopmentToDate
//                  less the opening give-back (the increments; the benchmark
//                  starts from `original`, the booked value, so the give-back is
//                  not on its side. It is zero in every arm today.)
//     RATIO      = sum ACTUAL / sum BENCHMARK, per line and pooled, over
//                  matured cohorts in the default arm.
//
// The tracked claims at inception ARE the ceded set: the gate first checks that
// cede(original) summed over them reproduces the year's cededByLayer (BASIS
// CHECK, exit 1 if it does not — the benchmark would be on the wrong claims).
//
// MEASURED (30 games x 20 years, defaults, runlogs/cub-*.log):
//
//     ratio    WC 1.0000   GL 1.0000   Property 1.0000   pool 1.0000
//     per-game spread: min = max = 1.0000 on every line (WC 2 games carry
//     matured ceded cohorts, GL 13, Property 13); largest per-cohort
//     |actual - benchmark| $0.00; game-jackknife 95% interval [1.0000, 1.0000].
//
// It is an IDENTITY on the shipped design, not a statistic, and that is the
// finding: FULL_COST_BOOKING gates off the stochastic step, the unwind, the
// per-claim revision law (reviseDevelopingSet) and the settlement true-up
// (processIbner's gates 1-3), so the only development left is adverse
// development, and the proportional allocation moves every occurrence by the
// cohort's own factor. The T claims develop EXACTLY with their cohorts
// (tracked factor = whole factor to four places on every line).
//
// THE LIMIT: ratio <= 1.10 per line, <= 1.05 pooled. Above the measured 1.0000
// with room for the legitimate sources of a gap that are switched off or
// unexercised today (a mean-one per-claim revision if FULL_COST_BOOKING is ever
// lifted, promoted bench claims crossing the attachment, the GL pool-limit trim
// — which only pushes the ratio DOWN); far below the defect. One-sided: a
// ratio below 1 is development the reinsurer did NOT pay for, which is not the
// free lunch this gate exists to forbid.
//
// CONTROLS (section 6), each fed the figures it guards against:
//   DEVELOPING ROUTING — the defect class: the cohort's whole development
//     landed on its tracked claims (each tracked claim takes ΔW x its share of
//     the tracked originals). Reads WC 2.55x, GL 12.19x, Property 4.16x, pool
//     6.99x — every line and the pool CAUGHT.
//   TILT — the T claims develop 1.25x as fast as their cohort: reads WC 1.25x,
//     GL 1.23x (a few claims saturate at the layer top), Property 1.25x, pool
//     1.24x — CAUGHT on every line and the pool (asserted on the pool).
//   RETIRED ASYMMETRIC ROUTING — 9.9% against 4.1%, i.e. 2.41x the benchmark:
//     CAUGHT on every line and the pool.
//   NONE — no cover placed: benchmark 0/0 on every line, caught as NOT
//     MEASURED (exit 1), never passed vacuously.
//   NOTHING CEDED — development that cedes nothing reads ratio 0 and PASSES.
// Clean run: exit 0, ~15s at GAMES=30 YEARS=20 (the uplift gate it replaces
// ran ~15s here and exited 2).
// ============================================================================
//
// ⚠ WHY THE ASSERTION IS HERE AND NOT IN development-sign-symmetry. That script
// measures recovery per dollar of movement over a fixed WINDOW, and a window is
// the wrong unit: it counts a cohort's adverse phase and cuts off its
// settlement, so it reads +6.2% at defaults with a perfectly symmetric
// mechanism. Only a COMPLETE cohort life is a fair statement, and only against
// inception cession is it scale-free. That is what is asserted below.
//
// ⚠ IT IS NOT ASSERTED TO BE ZERO, and it must not be. Cession is a CONVEX
// function of occurrence size, so a driftless walk through it has positive
// expected cession by Jensen — that is the option value of an excess-of-loss
// treaty on a claim that is still moving, and it is real. What the gate forbids
// is the ROUTING asymmetry that manufactured recovery on top of it: WC read
// +9.9% before symmetric routing and +4.1% after, against the then limit of
// 6% (retired; the gate now grades against a benchmark — see the top).
//
// READ-ONLY on the engine. Nothing here changes it.
//
// allocation-grid measured the uplift a developed-register price would need as
// +3.1% at defaults and +15.4% squeezed, and concluded a single constant cannot
// serve both arms. That conclusion is under test here, because 6c535d1
// established that TOTAL cession is path-independent: the booking bias moves
// cession between inception and development without changing the sum.
//
// ============================================================================
// ⚠ THE GIVE-BACK IS AN INCEPTION-SIDE ITEM AND THE EARLIER FIGURE PUT IT ON THE
// DEVELOPMENT SIDE. That is the whole suspected artefact, and it is a one-field
// mistake.
//
// A cohort's `cededDevelopmentToDate` OPENS at markDownForBooking's give-back —
// negative, the recoverable the pool forfeits by booking its claims low — and
// then accumulates development cession on top. So:
//
//     final cededDevelopmentToDate  =  giveBack  +  lifetime development cession
//
// `priorYearDevelopmentCeded` reports only the INCREMENTS, so summing it over a
// cohort's life gives (final - giveBack): the development cession GROSS of the
// inception-side deferral it is earning back. At defaults the bias is zero, the
// give-back is zero, and the two agree. Under squeeze they cannot.
//
// So the corrected decomposition is simply to use the cohort's FINAL
// cededDevelopmentToDate, which already nets the give-back where it belongs:
//
//     INCEPTION    cede(drawn register)              = sum of cededByLayer that year
//     DEVELOPMENT  giveBack + lifetime increments    = final cededDevelopmentToDate
//     TOTAL        the two added
//
// ============================================================================
// ⚠ AND THE ARMS DO NOT HAVE THE SAME BOOK. Squeezed funding charges less, more
// members enrol, more claims are drawn — so absolute cession differs between the
// arms for a reason that has nothing to do with development. Every headline here
// is therefore a RATIO with the cohort's own inception cession as denominator,
// and the arm comparison is PAIRED on (game, line) with an interval, not two
// totals side by side. The enrolment gap is reported so the confound is visible
// rather than assumed away.
//
// ⚠ AND A COHORT MUST BE ALLOWED TO FINISH. WC's horizon runs to 12 years, so a
// 10-year game truncates most of its development and understates the uplift in
// both arms. This runs 20 years and splits MATURED cohorts (age >= horizon) from
// those the game end cut off.
//
// The aggregate stop-loss is excluded throughout: it attaches to current-year
// retained loss and development never reaches it. This is the occurrence tower's
// price and nothing else.
//
// ⚠ RESTATED FOR THE SHOCKS LANDING (wip/shocks, 2ae5c1a). The tower now
// carries the per-occurrence T covers, the default is None, and with
// ROUTINE_LARGE_LOSSES off a shock's ONE T claim is the only claim a layer can
// reach. At defaults nothing ceded, every ratio was 0/0, and the gate printed
// NaN% and passed — vacuous. So every arm now BUYS '$38M xs $2M' on every line
// and the games' catalogue shocks supply the T claims; and the gate FAILS
// LOUDLY (exit 1) on a line with nothing to measure. (The controls of that
// commit — None as NOT MEASURED, nothing-ceded passes, 10%-of-inception caught
// — are carried onto the benchmark basis in section 6; the last is replaced by
// the routing controls the header lists.)
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameState, ReserveCohort } from '../../src/types/simulation';
import { AGGREGATE_STOP } from '../../src/data/pricingParameters';
import { REINSURANCE_TOWER, type TowerLine } from '../../src/data/reinsuranceTower';
import { cedeAbove } from '../../src/utils/reinsuranceTower';

// ⚠ THIS MEASURES THE PER-OCCURRENCE TOWER'S DEVELOPMENT CESSION, dormant behind
// AGGREGATE_STOP from stable-scenarios commit 6 (with the stop on, nothing is
// ceded at inception and every ratio here is 0/0). Since the shocks landing the
// stop is off as shipped and the tower carries the T covers; held off here.
AGGREGATE_STOP.enabled = false;

// GATE THRESHOLDS on ACTUAL / BENCHMARK development cession — see the header.
// Measured 1.0000 on every line and pooled, zero spread across games; the
// defect class reads 2.5x-12x and the retired asymmetric routing 2.4x.
// (The retired absolute limits were 6% per line and 1.5% pooled on the uplift.)
const MAX_LINE_RATIO = 1.10;
const MAX_POOL_RATIO = 1.05;
// The basis check: inception cession recomputed from the tracked originals must
// reproduce the engine's cededByLayer to this relative tolerance.
const BASIS_TOLERANCE = 1e-6;
// The defect-class multipliers the controls apply.
const TILT = 1.25;
const RETIRED_ASYMMETRY = 0.099 / 0.041;

const GAMES = Number(process.env.GAMES ?? 30);
const YEARS = Number(process.env.YEARS ?? 20);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];

const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};
interface Arm { name: string; decisions: (d: DecisionSet) => DecisionSet }
// ⚠ A THIRD ARM AT HALF THE SQUEEZE, because a residual that is REAL must scale
// with the booking bias and a residual that is noise must not. Two arms cannot
// tell those apart; three can.
const half = (l: CoverageLine) => (MIN_STOP[l] + SLIDER_RANGES.fundingConfidenceLevel.max) / 2;
const ARMS: Arm[] = [
  { name: 'def', decisions: d => d },
  {
    name: 'mid',
    decisions: d => ({
      ...d,
      byLine: Object.fromEntries(LINES.map(l =>
        [l, { ...d.byLine[l], fundingConfidenceLevel: half(l), fundingAtExpected: false }])) as never,
    }),
  },
  {
    name: 'sqz',
    decisions: d => ({
      ...d,
      byLine: Object.fromEntries(LINES.map(l =>
        [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }])) as never,
    }),
  },
];

// ⚠ EVERY ARM BUYS THE WIDEST T COVER ON EVERY LINE (shocks landing). The
// default is None, which cedes nothing at inception or in development: every
// ratio below was 0/0 and the gate printed NaN% and passed. With the cover the
// tower cedes on the T claims, the only claims there are, and on the
// development that lands on them.
const COVER = '$38M xs $2M';
const withCover = (d: DecisionSet): DecisionSet => ({
  ...d, byLine: Object.fromEntries(LINES.map(l => [l, { ...d.byLine[l], reinsuranceOption: COVER }])) as never,
});

// ONE ACCIDENT YEAR, FOLLOWED FROM INCEPTION TO WHEREVER IT GETS TO.
interface Cohort {
  arm: string; game: number; line: CoverageLine; ay: number;
  inceptionCeded: number;      // cede(drawn register), the price basis today
  giveBack: number;            // negative; opening cededDevelopmentToDate
  finalCededDev: number;       // giveBack + lifetime development increments
  registerSum: number;
  horizon: number; lastAge: number; matured: boolean;
  // --- THE BENCHMARK'S INPUTS (section 6) ---
  tracked: { original: number; deductible: number }[];  // the INCEPTION tracked set
  placed: boolean[];           // placedAtInception
  wholeAtInception: number;    // sum(original) + untrackedTotal as written
  wholeNow: number;            // sum(current) + untrackedTotal at the last valuation seen
}
const cohorts: Cohort[] = [];

// THE COHORT'S WHOLE GROSS REGISTER: every tracked occurrence at its current
// value plus the untracked mass. Its ratio over the cohort's life is the
// cohort's own development factor F.
const wholeGross = (c: ReserveCohort) =>
  (c.developingClaims ?? []).reduce((s, d) => s + d.current, 0) + (c.untrackedTotal ?? 0);

// Book size, so the enrolment confound is visible.
const book: Record<string, { members: number; gross: number; n: number }> = {};

for (const arm of ARMS) {
  for (let g = 0; g < GAMES; g++) {
    const id = `CUB${g}`;   // SAME instance id in both arms: same seeds, same roster.
    const inst = generateGameInstance(id, 5_900_000 + g * 9769);
    const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };

    // ay -> the record being accumulated, per line.
    const open = new Map<string, Cohort>();

    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, arm.decisions(withCover(defaultDecisionSet(y))));

      for (const line of LINES) {
        const lr = p.result.byLine[line];
        const after = p.updatedPoolState.lines[line].reserveCohorts;
        const born = after.find(c => c.yearNumber === y);
        const key = `${line}|${y}`;

        if (born) {
          open.set(key, {
            arm: arm.name, game: g, line, ay: y,
            inceptionCeded: (lr.cededByLayer ?? []).reduce((s, v) => s + v, 0),
            // ⚠ THE OPENING BALANCE IS THE GIVE-BACK, read the year the cohort is
            // written and before any development increment can have touched it.
            giveBack: born.cededDevelopmentToDate ?? 0,
            finalCededDev: born.cededDevelopmentToDate ?? 0,
            registerSum: born.registerSum,
            horizon: born.horizon, lastAge: born.age, matured: false,
            tracked: (born.developingClaims ?? []).map(d => ({ original: d.original, deductible: d.deductible ?? 0 })),
            placed: born.placedAtInception ?? [],
            wholeAtInception: wholeGross(born),
            wholeNow: wholeGross(born),
          });
        }

        const bk = book[`${arm.name}|${line}`] ?? { members: 0, gross: 0, n: 0 };
        bk.members += lr.memberLossResults?.length ?? 0;
        bk.gross += lr.grossUltimateLoss;
        bk.n++;
        book[`${arm.name}|${line}`] = bk;

        // Refresh every cohort still visible. A cohort is dropped from the array
        // the year after it closes, so the last value seen is its final one.
        for (const c of after) {
          const rec = open.get(`${line}|${c.yearNumber}`);
          if (!rec) continue;
          rec.finalCededDev = c.cededDevelopmentToDate ?? 0;
          rec.lastAge = c.age;
          rec.matured = c.age >= c.horizon;
          rec.wholeNow = wholeGross(c);
        }
      }

      gs = {
        ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
        currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1),
      };
    }
    for (const c of open.values()) cohorts.push(c);
  }
}

// ---------------------------------------------------------------- helpers
const m = (v: number) => `${v < 0 ? '-' : ''}$${(Math.abs(v) / 1e6).toFixed(2)}M`;
const p1 = (v: number) => `${(v * 100).toFixed(1)}%`;

function sum<T>(xs: T[], f: (x: T) => number): number { return xs.reduce((s, x) => s + f(x), 0); }

// Paired 95% interval on a per-(game,line) difference.
function pairedCI(diffs: number[]): { mean: number; lo: number; hi: number } {
  const n = diffs.length;
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const varc = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(varc / n);
  return { mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se };
}

console.log('=== CESSION UPLIFT: WHICH SIDE DOES THE GIVE-BACK BELONG ON? ===');
console.log(`${GAMES} games x ${YEARS} years x 3 lines x 2 arms, SAME instance ids in both arms.`);
console.log(`${cohorts.length} accident-year cohorts followed from inception.\n`);

// --- 0. THE CONFOUND, STATED ------------------------------------------------
console.log('--- 0. THE ARMS DO NOT HAVE THE SAME BOOK ---');
for (const line of LINES) {
  const d = book[`def|${line}`];
  const s = book[`sqz|${line}`];
  console.log(`  ${line.padEnd(9)} mean enrolled  def ${(d.members / d.n).toFixed(1).padStart(6)}  `
    + `sqz ${(s.members / s.n).toFixed(1).padStart(6)}  (${d.members > 0 ? `${((s.members / d.members - 1) * 100).toFixed(1)}%` : 'n/a — no member roster on a book'})   `
    + `gross loss  def ${m(d.gross).padStart(10)}  sqz ${m(s.gross).padStart(10)}  `
    + `(${((s.gross / d.gross - 1) * 100).toFixed(1)}%)`);
}
console.log('  -> every figure below is a RATIO with the cohort\'s own inception cession as denominator.\n');

// --- 1. MATURITY ------------------------------------------------------------
{
  const mat = cohorts.filter(c => c.matured);
  console.log('--- 1. HOW MANY COHORTS ACTUALLY FINISHED ---');
  for (const line of LINES) {
    const all = cohorts.filter(c => c.line === line);
    const mm = all.filter(c => c.matured);
    console.log(`  ${line.padEnd(9)} ${mm.length} of ${all.length} matured (horizon ${Math.min(...all.map(c => c.horizon))}-${Math.max(...all.map(c => c.horizon))})`);
  }
  console.log(`  ${mat.length} of ${cohorts.length} overall. Everything below is MATURED COHORTS ONLY `
    + 'unless it says otherwise — a truncated cohort understates its own uplift.\n');
}

// --- 2. THE DECOMPOSITION, THE OLD WAY AND THE CORRECTED WAY ----------------
console.log('--- 2. THE DECOMPOSITION, BOTH WAYS ---');
console.log('  OLD  = lifetime development increments only  (= final cededDevToDate - giveBack),');
console.log('         which is what summing priorYearDevelopmentCeded gives and what allocation-grid used.');
console.log('  NEW  = final cededDevToDate, so the give-back nets against the development it is earning back.\n');
console.log('  arm  line       inception ceded     give-back   dev increments |  OLD uplift   NEW uplift');
console.log('  ' + '-'.repeat(98));
const upliftRows: Record<string, { old: number; nw: number }> = {};
for (const arm of ARMS) {
  for (const line of LINES) {
    const cs = cohorts.filter(c => c.matured && c.arm === arm.name && c.line === line);
    if (cs.length === 0) continue;
    const inc = sum(cs, c => c.inceptionCeded);
    const gb = sum(cs, c => c.giveBack);
    const dev = sum(cs, c => c.finalCededDev - c.giveBack);
    const oldU = dev / inc;
    const newU = (gb + dev) / inc;
    upliftRows[`${arm.name}|${line}`] = { old: oldU, nw: newU };
    console.log(`  ${arm.name}  ${line.padEnd(9)} ${m(inc).padStart(14)} ${m(gb).padStart(13)} ${m(dev).padStart(16)} | `
      + `${p1(oldU).padStart(10)}   ${p1(newU).padStart(10)}`);
  }
}
{
  for (const arm of ARMS) {
    const cs = cohorts.filter(c => c.matured && c.arm === arm.name);
    const inc = sum(cs, c => c.inceptionCeded);
    const gb = sum(cs, c => c.giveBack);
    const dev = sum(cs, c => c.finalCededDev - c.giveBack);
    console.log(`  ${arm.name}  ${'ALL'.padEnd(9)} ${m(inc).padStart(14)} ${m(gb).padStart(13)} ${m(dev).padStart(16)} | `
      + `${p1(dev / inc).padStart(10)}   ${p1((gb + dev) / inc).padStart(10)}`);
  }
}

// --- 3. THE TEST: IS THE UPLIFT THE SAME IN BOTH ARMS? ----------------------
console.log('\n--- 3. PAIRED ON (game, line): DOES THE UPLIFT DIFFER BY ARM? ---');
console.log('  A CI containing zero says the uplift is a per-line CONSTANT and the arm split was the');
console.log('  artefact. A CI excluding zero says Option 3 is a genuine coupling to the funding decision.\n');
for (const which of ['OLD (development increments only)', 'NEW (give-back on the inception side)'] as const) {
  const useNew = which.startsWith('NEW');
  console.log(`  ${which}`);
  for (const line of LINES) {
   for (const other of ['mid', 'sqz']) {
    const diffs: number[] = [];
    for (let g = 0; g < GAMES; g++) {
      const pick = (arm: string) => cohorts.filter(c => c.matured && c.arm === arm && c.line === line && c.game === g);
      const D = pick('def');
      const S = pick(other);
      if (D.length === 0 || S.length === 0) continue;
      const u = (cs: Cohort[]) => {
        const inc = sum(cs, c => c.inceptionCeded);
        return inc === 0 ? NaN : (useNew ? sum(cs, c => c.finalCededDev) : sum(cs, c => c.finalCededDev - c.giveBack)) / inc;
      };
      const d = u(S) - u(D);
      if (Number.isFinite(d)) diffs.push(d);
    }
    const ci = pairedCI(diffs);
    const verdict = ci.lo <= 0 && ci.hi >= 0 ? 'CONTAINS ZERO' : 'EXCLUDES ZERO';
    console.log(`    ${line.padEnd(9)} n=${String(diffs.length).padStart(3)}  ${other} - def uplift `
      + `${p1(ci.mean).padStart(8)}  95% CI [${p1(ci.lo).padStart(8)}, ${p1(ci.hi).padStart(8)}]  ${verdict}`);
   }
  }
  console.log('');
}

// ⚠ THE DIRECT PATH-INDEPENDENCE STATEMENT, PAIRED. Section 4 below shows this
// unpaired; this is the same quantity with an interval on it, which is the only
// form that can distinguish a real shift from between-book noise.
console.log('  TOTAL CESSION / registerSum, the quantity 6c535d1 says is fixed');
for (const line of LINES) {
  for (const other of ['mid', 'sqz']) {
    const diffs: number[] = [];
    for (let g = 0; g < GAMES; g++) {
      const pick = (arm: string) => cohorts.filter(c => c.matured && c.arm === arm && c.line === line && c.game === g);
      const share = (cs: Cohort[]) => sum(cs, c => c.registerSum) === 0 ? NaN
        : (sum(cs, c => c.inceptionCeded) + sum(cs, c => c.finalCededDev)) / sum(cs, c => c.registerSum);
      const d = share(pick(other)) - share(pick('def'));
      if (Number.isFinite(d)) diffs.push(d);
    }
    const ci = pairedCI(diffs);
    console.log(`    ${line.padEnd(9)} n=${String(diffs.length).padStart(3)}  ${other} - def share `
      + `${p1(ci.mean).padStart(8)}  95% CI [${p1(ci.lo).padStart(8)}, ${p1(ci.hi).padStart(8)}]  `
      + `${ci.lo <= 0 && ci.hi >= 0 ? 'CONTAINS ZERO' : 'EXCLUDES ZERO'}`);
  }
}
console.log('');

// --- 4. TOTAL CESSION, THE PATH-INDEPENDENCE STATEMENT ITSELF ---------------
console.log('--- 4. TOTAL CESSION AS A SHARE OF THE REGISTER, which is what path-independence says is fixed ---');
console.log('  arm  line       total ceded / registerSum   (inception + final cededDevToDate, over the drawn register)');
for (const line of LINES) {
  const vals: Record<string, number> = {};
  for (const arm of ARMS) {
    const cs = cohorts.filter(c => c.matured && c.arm === arm.name && c.line === line);
    vals[arm.name] = (sum(cs, c => c.inceptionCeded) + sum(cs, c => c.finalCededDev)) / sum(cs, c => c.registerSum);
  }
  console.log(`       ${line.padEnd(9)} def ${p1(vals.def).padStart(8)}   mid ${p1(vals.mid).padStart(8)}   `
    + `sqz ${p1(vals.sqz).padStart(8)}   sqz-def ${p1(vals.sqz - vals.def).padStart(8)}`);
}

// --- 5. WHAT THE PRICE WOULD HAVE TO BE -------------------------------------
console.log('\n--- 5. THE NUMBER OPTION 3 WOULD NEED, on the corrected basis ---');
console.log('  ⚠ MONOTONE IN THE BIAS = a real coupling. FLAT = the arm split was the give-back artefact.');
for (const line of LINES) {
  const d = upliftRows[`def|${line}`];
  const i = upliftRows[`mid|${line}`];
  const s = upliftRows[`sqz|${line}`];
  console.log(`  ${line.padEnd(9)} NEW basis  def ${p1(d.nw).padStart(7)}  mid ${p1(i.nw).padStart(7)}  sqz ${p1(s.nw).padStart(7)}`
    + `   spread ${p1(Math.abs(s.nw - d.nw)).padStart(7)}`);
  console.log(`  ${' '.repeat(9)} OLD basis  def ${p1(d.old).padStart(7)}  mid ${p1(i.old).padStart(7)}  sqz ${p1(s.old).padStart(7)}`
    + `   spread ${p1(Math.abs(s.old - d.old)).padStart(7)}`);
}


// ============================================================================
// 6. THE GATE: ACTUAL DEVELOPMENT CESSION AGAINST THE PROPORTIONAL BENCHMARK.
// ============================================================================
// See the header for the derivation. The verdict is fenced so no neighbouring
// paragraph can be read as covering it.
const RULE = '='.repeat(72);
console.log('\n--- 6. GATE: DEVELOPMENT CESSION AGAINST WHAT THE CEDED CLAIMS\' OWN DEVELOPMENT WOULD CEDE, AT DEFAULTS ---');

/** What the year's own placement cedes on one occurrence at value v —
 *  cedeDevelopment's arithmetic: cedeAbove per placed, purchasable layer. */
function cedeOf(line: CoverageLine, v: number, placed: boolean[], deductible: number): number {
  return REINSURANCE_TOWER[line as TowerLine].reduce(
    (s, l, i) => s + (placed[i] && l.purchasable ? cedeAbove(Math.max(0, v), l, deductible) : 0), 0);
}
/** A ROUTING: each inception tracked claim's developed value. */
type Routing = (c: Cohort) => number[];
const factorOf = (c: Cohort) => (c.wholeAtInception > 0 ? c.wholeNow / c.wholeAtInception : 1);
// THE BENCHMARK'S ROUTING: every ceded claim develops at its cohort's own rate.
const proportional: Routing = c => c.tracked.map(t => t.original * factorOf(c));
// THE DEFECT CLASS: the cohort's whole development lands on its tracked claims,
// shared by their originals — 'developing' routing with every tracked claim a carrier.
const concentrated: Routing = c => {
  const t0 = c.tracked.reduce((s, t) => s + t.original, 0);
  const dW = c.wholeNow - c.wholeAtInception;
  return c.tracked.map(t => t.original + (t0 > 0 ? (dW * t.original) / t0 : 0));
};
// A MILDER ONE: the tracked claims develop TILT times as fast as their cohort.
const tilted: Routing = c => c.tracked.map(t => t.original * (1 + TILT * (factorOf(c) - 1)));

const inceptionOf = (c: Cohort) => c.tracked.reduce((s, t) => s + cedeOf(c.line, t.original, c.placed, t.deductible), 0);
function benchmarkOf(c: Cohort, routing: Routing = proportional): number {
  const dev = routing(c);
  return c.tracked.reduce((s, t, i) =>
    s + cedeOf(c.line, dev[i], c.placed, t.deductible) - cedeOf(c.line, t.original, c.placed, t.deductible), 0);
}
// ACTUAL: lifetime development increments (the give-back is not on the
// benchmark's side; it is zero in every arm today).
const actualOf = (c: Cohort) => c.finalCededDev - c.giveBack;

interface Graded { line: CoverageLine; game: number; actual: number; bench: number }
const graded = (cs: Cohort[], actual: (c: Cohort) => number = actualOf, bench: (c: Cohort) => number = benchmarkOf): Graded[] =>
  cs.map(c => ({ line: c.line, game: c.game, actual: actual(c), bench: bench(c) }));

/** Ratio of sums, its per-game spread and a game-jackknife 95% interval. */
function readRatio(rows: Graded[]) {
  const A = sum(rows, r => r.actual), B = sum(rows, r => r.bench);
  const ratio = A / B;
  const games = new Map<number, { a: number; b: number }>();
  for (const r of rows) {
    const g = games.get(r.game) ?? { a: 0, b: 0 };
    g.a += r.actual; g.b += r.bench; games.set(r.game, g);
  }
  const gs = [...games.values()].filter(g => g.b > 0);
  const per = gs.map(g => g.a / g.b);
  let lo = NaN, hi = NaN;
  if (gs.length >= 2) {
    const loo = gs.map(g => (A - g.a) / (B - g.b)).filter(Number.isFinite);
    const mean = loo.reduce((s, v) => s + v, 0) / loo.length;
    const se = Math.sqrt(((loo.length - 1) / loo.length) * loo.reduce((s, v) => s + (v - mean) ** 2, 0));
    lo = ratio - 1.96 * se; hi = ratio + 1.96 * se;
  }
  return { A, B, ratio, n: gs.length, min: Math.min(...per), max: Math.max(...per), lo, hi };
}
const r4 = (v: number) => (Number.isFinite(v) ? v.toFixed(4) : 'n/a');

/** The gate on a graded set: the named failures, and the readings. */
function gateOf(rows: Graded[], print: boolean): { failed: string[]; ratios: Record<string, number> } {
  // ⚠ NAMED, NOT COUNTED — see WORKING_PRACTICES.
  const failed: string[] = [];
  const ratios: Record<string, number> = {};
  // ⚠ NOT MEASURED IS A FAILURE: a line whose ceded claims would cede nothing
  // on their own development reads 0/0, and NaN > limit is false — the way this
  // gate once passed while measuring nothing.
  const measure = (name: string, t: Graded[], limit: number) => {
    const r = readRatio(t);
    ratios[name] = r.ratio;
    const unmeasured = !(r.B > 0) || !Number.isFinite(r.ratio);
    const bad = !unmeasured && r.ratio > limit;
    if (unmeasured) failed.push(`NOT MEASURED: ${name} has no benchmark development cession over ${t.length} matured cohort(s) (ratio ${r4(r.ratio)})`);
    if (bad) failed.push(`${name} development cession is ${r4(r.ratio)}x what its ceded claims' own development cedes (limit ${limit.toFixed(2)}x)`);
    if (print) {
      console.log(`  ${name.padEnd(9)} actual ${m(r.A).padStart(9)}  benchmark ${m(r.B).padStart(9)}  ratio ${r4(r.ratio)}  `
        + `95% CI [${r4(r.lo)}, ${r4(r.hi)}]  per-game ${r4(r.min)}-${r4(r.max)} (n=${r.n})   `
        + `${unmeasured ? 'FAIL — NOT MEASURED' : bad ? `FAIL (limit ${limit.toFixed(2)})` : `ok (limit ${limit.toFixed(2)})`}`);
    }
  };
  for (const line of LINES) measure(line, rows.filter(r => r.line === line), MAX_LINE_RATIO);
  measure('POOL', rows, MAX_POOL_RATIO);
  return { failed, ratios };
}

{
  const def = cohorts.filter(c => c.arm === 'def');
  const mat = def.filter(c => c.matured);
  const failed: string[] = [];

  // --- THE BASIS CHECK: the tracked set at inception IS the ceded set. -------
  console.log('  BASIS CHECK — cede(tracked originals) against the year\'s cededByLayer, every default-arm cohort');
  for (const line of LINES) {
    const cs = def.filter(c => c.line === line);
    const eng = sum(cs, c => c.inceptionCeded), re = sum(cs, c => inceptionOf(c));
    const worst = Math.max(0, ...cs.map(c => Math.abs(inceptionOf(c) - c.inceptionCeded)));
    const ok = Math.abs(re - eng) <= BASIS_TOLERANCE * Math.max(1, eng) && worst <= BASIS_TOLERANCE * Math.max(1, eng);
    console.log(`    ${line.padEnd(9)} engine ${m(eng).padStart(9)}  recomputed ${m(re).padStart(9)}  worst cohort |diff| ${m(worst)}  ${ok ? 'ok' : 'FAIL'}`);
    if (!ok) failed.push(`BASIS: ${line} inception cession recomputed from the tracked claims (${m(re)}) does not reproduce the engine's ${m(eng)}`);
  }

  // --- WHAT THE BENCHMARK STANDS ON: the cohorts' own factors. -------------
  console.log('\n  THE COHORTS\' OWN DEVELOPMENT, matured default-arm cohorts');
  for (const line of LINES) {
    const cs = mat.filter(c => c.line === line);
    const W0 = sum(cs, c => c.wholeAtInception), W = sum(cs, c => c.wholeNow);
    const inc = sum(cs, c => c.inceptionCeded), act = sum(cs, c => actualOf(c));
    console.log(`    ${line.padEnd(9)} whole register ${(W / W0).toFixed(3)}x   uplift (the retired measure) ${p1(act / inc)}`);
  }
  {
    const inc = sum(mat, c => c.inceptionCeded), act = sum(mat, c => actualOf(c));
    console.log(`    ${'POOL'.padEnd(9)} uplift ${p1(act / inc)}`);
  }

  console.log('\n  THE GATE — ratio = sum actual / sum benchmark, matured default-arm cohorts');
  const main = gateOf(graded(mat), true);
  failed.push(...main.failed);
  {
    const worst = Math.max(0, ...mat.map(c => Math.abs(actualOf(c) - benchmarkOf(c))));
    console.log(`  largest per-cohort |actual - benchmark| $${worst.toFixed(2)}`);
  }

  // CONTROLS — each fed the figures it guards against; a control that does not
  // react is a failure (exit 1).
  console.log('\n  CONTROLS');
  const controlFailed: string[] = [];
  const control = (label: string, ok: boolean, detail: string) => {
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  control: ${label}  — ${detail}`);
    if (!ok) controlFailed.push(`control: ${label}`);
  };
  const show = (r: Record<string, number>) => Object.entries(r).map(([k, v]) => `${k} ${r4(v)}`).join('  ');
  const isLimit = (f: string) => !f.startsWith('NOT MEASURED');

  const conc = gateOf(graded(mat, c => benchmarkOf(c, concentrated)), false);
  control('DEVELOPING ROUTING (the cohort\'s whole development on its tracked claims) is caught on every line and the pool',
    conc.failed.length === LINES.length + 1 && conc.failed.every(isLimit), show(conc.ratios));

  const tilt = gateOf(graded(mat, c => benchmarkOf(c, tilted)), false);
  control(`TILT (tracked claims develop ${TILT}x as fast as their cohort) is caught on the pool`,
    tilt.failed.some(f => f.startsWith('POOL')) && tilt.failed.every(isLimit), show(tilt.ratios));

  const retired = gateOf(graded(mat, c => RETIRED_ASYMMETRY * benchmarkOf(c)), false);
  control(`the RETIRED ASYMMETRIC ROUTING's ${RETIRED_ASYMMETRY.toFixed(2)}x is caught on every line and the pool`,
    retired.failed.length === LINES.length + 1 && retired.failed.every(isLimit), show(retired.ratios));

  const none = gateOf(graded(mat.map(c => ({ ...c, placed: c.placed.map(() => false), finalCededDev: 0, giveBack: 0, inceptionCeded: 0 }))), false);
  control('the None figures (no cover placed, 0/0) are caught as NOT MEASURED',
    none.failed.length === LINES.length + 1 && none.failed.every(f => f.startsWith('NOT MEASURED')), `${none.failed.length} not measured`);

  const flat = gateOf(graded(mat, () => 0), false);
  control('a book whose development cedes nothing passes', flat.failed.length === 0, `${flat.failed.length} failure(s); ${show(flat.ratios)}`);

  const all = [...failed, ...controlFailed];
  console.log(all.length === 0
    ? '\nDEVELOPMENT CESSION IS NOT A FREE LUNCH. Over complete cohort lives at defaults, the reinsurer'
      + '\npays on development exactly what the ceded claims\' own development at their cohort\'s rate'
      + '\ncedes — nothing routed onto them beyond it.'
    : `\n${RULE}\n${all.length} FAILURE(S) — exit 1:\n  ${all.join('\n  ')}\n${RULE}`);
  process.exit(all.length > 0 ? 1 : 0);
}
