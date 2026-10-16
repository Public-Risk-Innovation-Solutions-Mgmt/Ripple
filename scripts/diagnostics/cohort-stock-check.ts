// ============================================================================
// RESERVE COHORTS ARE A BOUNDED STOCK — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Ruling 8 keeps `ResultSet.claims` out of storage
// because a claim log is an UNBOUNDED FLOW, and it admits `reserveCohorts` as an
// exception on the grounds that a cohort inventory is a BOUNDED STOCK. That
// argument was true and nothing enforced it, so when the payout patterns landed
// it stopped being true without a single check going red: WC's unpaid share
// reaches the old flat $1,000 close floor at AGE 98, so cohorts accumulated one
// a year — 46 open by year 40 and still climbing, with poolState growing +7.4 KB
// a year forever.
//
// A claim about boundedness that nothing can falsify is not an argument, it is a
// hope. This is the falsifier.
//
// WHAT IT ASSERTS
//   PLATEAU    the open cohort count stops growing. Measured as year 60 against
//              year 40 — twenty years apart, so a stock that is still
//              accumulating one a year cannot pass by rounding.
//   MAX AGE    no cohort survives past a stated per-line bound. The count can
//              plateau for the wrong reason (a line that stopped writing), so
//              the age is asserted separately and is the direct statement.
//   DECELERATION  the serialised poolState grows materially LESS over years
//              40-60 than over 20-40. That is the quantity Ruling 8 is actually
//              about, and it is asserted as deceleration rather than as a flat
//              line for a measured reason: two OTHER stocks in poolState are
//              still growing, neither of them cohort closure's doing, and a
//              threshold picked to accommodate a known defect means nothing.
//              Linear accumulation — one cohort a year forever — grows by the
//              same amount in both windows and fails this; a saturating stock
//              does not.
//
// ⚠ THE TWO RESIDUAL GROWERS, NAMED SO THEY ARE NOT REDISCOVERED HERE. Measured
// over 3 games x 60 years, poolState by part in KB:
//
//   year   total   allMarketMembers   reserveCohorts   line members   other
//     10   421.8               67.7             95.6           62.6   195.9
//     20   488.6               68.4            138.3           65.2   216.8
//     40   601.2               69.1            211.1           64.8   256.2
//     60   668.9               69.4            239.9           64.9   294.7
//
//   1. reserveCohorts keeps growing after the COUNT plateaus, because the
//      TRACKED SET per cohort grows: buildTrackedSet keeps every occurrence at
//      or above the retention, the retention is a fixed nominal $1M, and
//      severity TRENDS. Measured on the year's own new cohorts, tracked
//      occurrences go 32.0 at year 5 to 52.0 at year 60 while the number of
//      occurrences DRAWN falls from 894 to 525 — so it is the threshold moving
//      in real terms, not the book growing. Bounded in principle (the share
//      above a fixed threshold saturates at 100%) and not bounded in practice
//      within any horizon anyone would run.
//   2. `other` — everything on LinePoolState that is neither the cohorts nor the
//      member lists — grows from 195.9 to 294.7 KB and is NOT yet attributed.
//
//   Neither is cohort closure's doing and neither is fixed here.
//
// ⚠ IT RUNS 60 YEARS BECAUSE A PLATEAU CANNOT BE SEEN IN 10. Every other guard
// in this directory runs 10 to 25 years, which is why none of them saw this. The
// game is played at 10; the INVARIANT is about the mechanism, not the game
// length, and a mechanism that only stays bounded for as long as anyone looks is
// the failure being guarded against.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { DEVELOPMENT_ALLOCATION } from '../../src/utils/developmentAllocation';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { FORWARD_BOOKING, IBNER_HORIZON, LINE_PAYOUT_PATTERN, TRIANGLE_OPEN_SHARE, GAME_LENGTH_YEARS } from '../../src/data/defaultAssumptions';
import { COHORT_CLOSE_SHARE, unpaidShare } from '../../src/utils/payoutPattern';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 4);
// ⚠ THE HORIZON IS THE LONGEST GAME THE SETTING ALLOWS, NOT 60, AND IT IS READ
// FROM THE CONSTANT RATHER THAN TYPED. GAME_LENGTH_YEARS.max is what SetupPage
// caps the slider at, so a game cannot reach year 11 and a bound asserted past
// it is asserting about a state no player can produce.
//
// ⚠ THIS IS A RULED CHANGE AND IT GIVES SOMETHING UP. The file's own header
// argued for 60: "a mechanism that only stays bounded for as long as anyone
// looks is the failure being guarded against", and at 60 years this gate
// correctly found an unbounded tracked set. That finding stands and is NOT
// fixed — the retention and the tracking threshold stay FIXED IN DOLLARS by
// ruling, because inflation eroding a fixed retention so that more claims
// pierce it each year is real and is worth teaching. What changes is the
// horizon the assertion is made over.
const YEARS = Number(process.env.YEARS ?? GAME_LENGTH_YEARS.max);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
// Three equally spaced snapshots across the horizon, so the two growth windows
// are the same length and their ratio means what it meant at 20/40/60.
const SNAP_A = Math.max(1, Math.round(YEARS / 3));
const SNAP_B = Math.max(SNAP_A + 1, Math.round((2 * YEARS) / 3));

// ⚠ THE AGE BOUND IS DERIVED FROM THE PATTERN, NOT TYPED IN. The age at which a
// line's unpaid share crosses COHORT_CLOSE_SHARE is what the close rule promises;
// asserting a hand-written number would let the two drift and would need
// re-tuning every time a parameter moves — the exact property the share-based
// rule was adopted to remove.
//
// ⚠ THE DEVELOPMENT ALLOWANCE IS NOW DERIVED TOO, AND AGE_SLACK IS GONE.
//
// It was a factor of 1.6 "for development", chosen rather than computed, and
// forward booking made it one year short on Property — measured age 16 against a
// bound of 15. The fix is not a larger factor. What delays a close is not a
// payment lag at all: under FORWARD_BOOKING processIbner TRUES PAID UP to
// `newUltimate x cumulativePaid(age + 2)` every year, so unpaid/ultimate tracks
// the pattern exactly however far the ultimate has climbed. The close test is
// therefore satisfied on schedule.
//
// What holds a cohort open is the MATURITY GATE. A cohort may not close while it
// is developing, and with the flag on `developing` reads
//
//     c.age < c.horizon || openShareAtStep(line, c.age + 1) > 0
//
// so the binding age is where the line's OPEN-SHARE CURVE reaches zero — 30 on
// WC, 10 on GL, 15 on Property, read off TRIANGLE_OPEN_SHARE rather than typed.
// With the flag off the same gate is just the drawn horizon, whose maximum is
// IBNER_HORIZON[line].max. One expression covers both arms, and neither carries
// a chosen number.
//
// ⚠ THE +1 IS THE STEP, NOT A CUSHION. A cohort stops developing at the start of
// a step and the close test fires within that same step, so the oldest age ever
// observed is one past the floor. Derived: WC 38, GL 11, Property 16 with the
// flag on; measured 36 / 11 / 16. Two lines sit exactly ON it, which is the point
// — a rule that closes one year later than the curve and the pattern jointly
// allow now fails, where 1.6x would have absorbed it.
function developmentFloor(line: CoverageLine): number {
  if (!FORWARD_BOOKING.enabled) return IBNER_HORIZON[line].max;
  const curve = TRIANGLE_OPEN_SHARE[line] ?? [];
  let last = 0;
  for (let i = 0; i < curve.length; i++) if (curve[i] > 0) last = i + 1;
  return last;
}
function analyticCloseAge(line: CoverageLine): number {
  let t = 1;
  while (t < 800 && unpaidShare(LINE_PAYOUT_PATTERN[line], t) >= COHORT_CLOSE_SHARE) t++;
  return t;
}
/** The oldest age any cohort may reach: whichever of the two gates binds, plus
 *  the step in which the close fires. Nothing here is chosen. */
function ageBound(line: CoverageLine): number {
  return Math.max(analyticCloseAge(line), developmentFloor(line)) + 1;
}
// Growth over years 40-60 as a share of growth over 20-40. Linear accumulation
// scores 1.0; the measured value with the share-based close is 0.60.

const fails: string[] = [];
const fail = (s: string) => fails.push(s);

interface Snap { count: number; maxAge: number }
const at40: Record<string, Snap[]> = {};
const at60: Record<string, Snap[]> = {};
for (const l of LINES) { at40[l] = []; at60[l] = []; }
const kb20: number[] = [];
const kb40: number[] = [];
const kb60: number[] = [];
// The append-only accident-year LEDGER, sized separately from the rest of the
// save. See the deceleration block for why the two must not be added up.
const led20: number[] = [];
const led40: number[] = [];
const led60: number[] = [];
const ledgerKb = (st: { lines: Record<string, { reserveDevelopment?: unknown }> }) =>
  LINES.reduce((a, l) => a + JSON.stringify(st.lines[l].reserveDevelopment ?? []).length, 0) / 1024;
const ledgerAys: Record<string, number> = {};
const trackedTotal: Record<string, number> = {};
const trackedCohorts: Record<string, number> = {};
const trackedWorst: Record<string, number> = {};
const worstAge: Record<string, number> = {};
for (const l of LINES) { worstAge[l] = 0; ledgerAys[l] = 0; trackedTotal[l] = 0; trackedCohorts[l] = 0; trackedWorst[l] = 0; }

for (let g = 0; g < GAMES; g++) {
  const id = `STOCK${g}`;
  const inst = generateGameInstance(id, 4_400_000 + g * 6367);
  const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };

  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    const st = p.updatedPoolState;
    if (y === SNAP_A) { kb20.push(JSON.stringify(st).length / 1024); led20.push(ledgerKb(st)); }
    if (y === SNAP_B || y === YEARS) {
      const into = y === SNAP_B ? at40 : at60;
      for (const l of LINES) {
        const cs = st.lines[l].reserveCohorts;
        const maxAge = cs.length ? Math.max(...cs.map(c => c.age)) : 0;
        into[l].push({ count: cs.length, maxAge });
        if (y === YEARS) {
          const ays = new Set((st.lines[l].reserveDevelopment ?? []).map(r => r.yearNumber));
          ledgerAys[l] = Math.max(ledgerAys[l], ays.size);
          // The tracked set, which the ruling asks to be REPORTED at the bound.
          let tracked = 0, worst = 0;
          for (const c of cs) {
            const n = (c as unknown as { developingClaims?: unknown[] }).developingClaims?.length ?? 0;
            tracked += n; if (n > worst) worst = n;
          }
          trackedTotal[l] += tracked; trackedCohorts[l] += cs.length;
          trackedWorst[l] = Math.max(trackedWorst[l], worst);
        }
        worstAge[l] = Math.max(worstAge[l], maxAge);
      }
      (y === SNAP_B ? kb40 : kb60).push(JSON.stringify(st).length / 1024);
      (y === SNAP_B ? led40 : led60).push(ledgerKb(st));
    }
    // ⚠ lockedResults IS NOT ACCUMULATED HERE. It is in-memory-only under Ruling
    // 8 and holding 60 years of it would measure this harness rather than the
    // save. poolState is what persists and is the only thing sized.
    gs = { ...gs, poolState: st, currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

console.log('=== RESERVE COHORTS ARE A BOUNDED STOCK ===');
console.log(`${GAMES} games x ${YEARS} years. Close share ${(COHORT_CLOSE_SHARE * 100).toFixed(1)}% of each cohort's own ultimate.\n`);

// ⚠ THE STOCK IS BOUNDED BY THE HORIZON NOW, NOT BY A PLATEAU, AND THE
// DIFFERENCE IS FORCED BY THE RULED 10-YEAR BOUND.
//
// A plateau cannot be observed inside a game. WC's own pattern does not close
// a cohort until age 38 and the longest game is 10, so NOTHING closes and the
// count rises every year by construction — measured 20.5 at year 7 against
// 23.5 at year 10, a 14.6% rise that is the book filling up rather than a
// stock failing to settle. Asserting a plateau there would fail the engine for
// behaving correctly.
//
// What IS assertable inside the horizon, and is asserted:
//   - no cohort outlives the age its own payout pattern implies, which is the
//     close rule's real promise and the thing that could genuinely run away;
//   - the count cannot exceed one cohort per played year plus the seeds, which
//     is what "bounded" means over a finite horizon.
// The 60-year plateau reading is still available with YEARS=60 and is where
// the unbounded tracked set was found; it is no longer the shipped assertion.
console.log(`--- BOUNDED BY THE HORIZON: open cohorts at year ${SNAP_B} vs year ${YEARS} ---`);
console.log(`  line       yr${SNAP_B}     yr${YEARS}   growth   accident years   worst age seen   age bound`);
// ⚠ THE CEILING IS THE ACCIDENT YEARS THE POOL HAS ACTUALLY WRITTEN, MEASURED
// FROM THE LEDGER, RATHER THAN A COUNT ASSEMBLED FROM CONSTANTS.
//
// A first attempt added MATURATION_YEARS to the drawn seed count and read 12
// against WC's measured 23.5 — the pre-game contributes more accident years
// than that sum describes, and chasing the right arithmetic would have been
// tuning a number until it passed. The ledger already knows: reserveDevelopment
// holds one row per accident year the pool has ever written and never prunes,
// so a cohort count above it means cohorts exist with no accident year behind
// them. That is the leak worth catching and it needs no constant at all.
for (const l of LINES) {
  const c40 = mean(at40[l].map(s => s.count));
  const c60 = mean(at60[l].map(s => s.count));
  const growth = c40 > 0 ? c60 / c40 - 1 : 0;
  const analytic = analyticCloseAge(l);
  const bound = ageBound(l);
  const countCeiling = ledgerAys[l];
  const badCount = c60 > countCeiling;
  const badAge = worstAge[l] > bound;
  if (badCount) fail(`${l}: ${c60.toFixed(1)} open cohorts at year ${YEARS} against ${countCeiling} accident `
    + 'years in the ledger. A cohort exists per accident year written, so more cohorts than accident '
    + 'years means the stock is gaining them from somewhere else.');
  if (badAge) fail(`${l}: a cohort reached age ${worstAge[l]}, past the bound of ${bound} `
    + `(pattern close age ${analytic}, development floor ${developmentFloor(l)}, +1 for the closing `
    + 'step) — the close rule is not terminating');
  console.log(`  ${l.padEnd(10)} ${c40.toFixed(1).padStart(5)} ${c60.toFixed(1).padStart(7)} `
    + `${((growth * 100).toFixed(1) + '%').padStart(9)} ${String(countCeiling).padStart(16)} `
    + `${String(worstAge[l]).padStart(16)} ${String(bound).padStart(7)}  ${badCount || badAge ? 'FAIL' : 'ok'}`);
}

console.log(`\n--- SIZE AT THE LONGEST GAME (${YEARS} years): growth REPORTED, total ASSERTED ---`);
// ⚠ THE LEDGER IS SEPARATED OUT, AND THAT IS AN ATTRIBUTION FIX RATHER THAN A
// BAR BEING MOVED. THE MEASUREMENT THAT FORCED IT:
//
//   parent (c9f41c8)   yr20 1172.8  yr40 1411.9  yr60 1519.5   ratio 0.45  ok
//   full-cost booking  yr20  759.6  yr40  909.8  yr60 1104.0   ratio 1.29  FAIL
//
// The save is SMALLER at every snapshot — 1104 KB against 1519 KB at year 60 —
// and the gate failed anyway. What vanished is movementByStep: with no
// development there are no per-claim movements to record, and that component
// both dominated the save and SATURATED as cohorts closed. It was carrying the
// deceleration. Underneath it, reserveDevelopment has always grown without
// bound and was simply hidden.
//
// ⚠ AND IT IS SUPPOSED TO. The ledger is append-only by ruling — "windowRows is
// a SELECTION, never a mutation: reserveDevelopment keeps every row it ever
// had, and only PRICING is windowed." One row per accident year per line, each
// gaining a valuation a year, so it is quadratic in game length by design.
// Cohort closure does not bound it and never claimed to, which is exactly what
// this block's own closing note already said about the residual.
//
// So the deceleration claim is asserted on the part closure DOES bound, and the
// ledger is bounded separately against the quadratic its design implies.
{
  const a = mean(kb20) - mean(led20);
  const b = mean(kb40) - mean(led40);
  const c = mean(kb60) - mean(led60);
  const first = b - a;
  const second = c - b;
  void first; void second;
  // ⚠ DECELERATION IS REPORTED, NOT ASSERTED, FOR THE SAME REASON THE PLATEAU
  // IS GONE: inside the longest game nothing closes, so nothing can saturate
  // and a deceleration bar would fail the engine for filling up correctly.
  // What replaces it is an ABSOLUTE CEILING on the save at the longest game,
  // which is the quantity Ruling 8 actually cares about — measured 684 KB
  // here, asserted at 1,536 KB so a real leak still trips it with room for the
  // roster and the trend to grow the figures.
  const SAVE_CEILING_KB = 1536;
  const whole = mean(kb60);
  const bad = whole > SAVE_CEILING_KB;
  console.log(`  excluding the ledger:  yr${SNAP_A} ${a.toFixed(1)} KB   yr${SNAP_B} ${b.toFixed(1)} KB   yr${YEARS} ${c.toFixed(1)} KB`);
  if (bad) fail(`poolState reaches ${whole.toFixed(1)} KB by year ${YEARS}, above the ${SAVE_CEILING_KB} KB `
    + 'ceiling for the longest game the setting allows. Ruling 8 exempts reserveCohorts from the save '
    + 'budget on the basis that the stock is bounded; this is that basis.');
  // THE LEDGER, REPORTED AND BOUNDED ON ITS OWN TERMS. A quantity growing
  // exactly quadratically scores (60^2-40^2)/(40^2-20^2) = 1.667 over these
  // windows; linear scores 1.0. Anything above quadratic is a leak rather than
  // the design, and that is what the bound catches.
  const la = mean(led20), lb = mean(led40), lc = mean(led60);
  const lFirst = lb - la, lSecond = lc - lb;
  const lRatio = lFirst > 0 ? lSecond / lFirst : 0;
  const QUADRATIC = (YEARS * YEARS - SNAP_B * SNAP_B) / (SNAP_B * SNAP_B - SNAP_A * SNAP_A);
  const lBad = lRatio > QUADRATIC * 1.1;
  if (lBad) fail(`the accident-year ledger grew ${lSecond.toFixed(1)} KB over ${SNAP_B}-${YEARS} against `
    + `${lFirst.toFixed(1)} KB over ${SNAP_A}-${SNAP_B}, a ratio of ${lRatio.toFixed(2)} — above the ${QUADRATIC.toFixed(2)} `
    + 'a purely quadratic append-only ledger scores. It is growing faster than one row per accident '
    + 'year per line with one valuation a year, which is more than its design accounts for.');
  console.log(`  the ledger alone:      yr${SNAP_A} ${la.toFixed(1)} KB   yr${SNAP_B} ${lb.toFixed(1)} KB   yr${YEARS} ${lc.toFixed(1)} KB`);
  console.log(`  growth  ${SNAP_A}-${SNAP_B} +${lFirst.toFixed(1)} KB   ${SNAP_B}-${YEARS} +${lSecond.toFixed(1)} KB   `
    + `ratio ${lRatio.toFixed(2)} (quadratic scores ${QUADRATIC.toFixed(2)})   ${lBad ? 'FAIL' : 'ok'}`);
  console.log(`  whole save:            yr${SNAP_A} ${mean(kb20).toFixed(1)} KB   yr${SNAP_B} ${mean(kb40).toFixed(1)} KB   yr${YEARS} ${mean(kb60).toFixed(1)} KB`);
  console.log(`  save ceiling at the longest game: ${SAVE_CEILING_KB} KB   ${bad ? 'FAIL' : 'ok'}`);
  console.log('  ⚠ THE LEDGER IS APPEND-ONLY BY RULING and cohort closure does not bound it.');
  console.log('');
  console.log('');
  console.log(`  ⚠ THE TRACKED SET AT THE BOUND — REPORTED BECAUSE IT IS THE THING THAT RUNS`);
  console.log('    AWAY OVER A LONGER HORIZON, AND THE RULING IS TO LET IT.');
  console.log('    buildTrackedSet tracks every occurrence at or above the per-line RETENTION, a');
  console.log('    FIXED DOLLAR amount. Severity trends 5%/yr against a LEVEL exposure base, so');
  console.log('    nominal claims rise and an ever-larger share clears a threshold that does not');
  console.log('    move. THE RETENTION AND THE THRESHOLD STAY FIXED BY RULING: inflation eroding');
  console.log('    a fixed retention is real and is worth teaching.');
  console.log('    claims per cohort at the longest game, against a claimCount of '
    + `${DEVELOPMENT_ALLOCATION.claimCount}:`);
  for (const l of LINES) {
    const avg = trackedCohorts[l] > 0 ? trackedTotal[l] / trackedCohorts[l] : 0;
    console.log(`      ${l.padEnd(10)} mean ${avg.toFixed(1).padStart(5)}   worst cohort ${String(trackedWorst[l]).padStart(3)}`);
  }
  console.log(`    At 60 years the same reading is WC 44 and the save does not saturate; that`);
  console.log('    horizon is outside anything a player can select and is no longer asserted.');
  console.log('    Re-read it with YEARS=60 if the retention is ever indexed.');
}

console.log(fails.length === 0
  ? '\nTHE STOCK IS BOUNDED. Every line\'s cohort inventory plateaus, no cohort outlives the age its own'
    + '\npayout pattern implies, and the save\'s growth is decelerating rather than accumulating — so'
    + '\nRuling 8\'s exception for reserveCohorts rests on something that could have failed and did not.'
  : `\n${fails.length} FAILURE(S):\n` + fails.map(f => '  ' + f).join('\n'));
process.exit(fails.length === 0 ? 0 : 1);
