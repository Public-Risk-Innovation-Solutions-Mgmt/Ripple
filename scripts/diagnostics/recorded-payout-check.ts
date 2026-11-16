// ============================================================================
// THE ENGINE PAYS THE WAY THE RECORDED PATTERNS SAY — MEASURED OFF ITS OWN
// LEDGER, NOT OFF THE TABLE IT WAS GIVEN.
//
//   npx tsx scripts/diagnostics/recorded-payout-check.ts
//   GAMES=4 YEARS=14 npx tsx scripts/diagnostics/recorded-payout-check.ts
//
// ⚠ THIS IS THE ACCEPTANCE TEST FOR WIRING THE RECORDED PATTERNS, AND IT HAS TO
// READ THE LEDGER RATHER THAN THE PATTERN. Asserting that LINE_PAYOUT_PATTERN
// returns the recorded factors would assert that an array holds what it holds.
// The claim being made is bigger: that a PLAYED pool, developed by its own
// chain ladder off its own paid history, now reproduces the factors pricing
// develops with. That claim is what makes the new pure premium comparable to
// the charged rate, and nothing but a played ledger can test it.
//
// ⚠ GROSS, NOT NET. The recorded patterns are ground-up. Running this on
// `paidByValuation` would measure the reinsurance tower's payment timing as
// much as the pool's, so it reads `grossPaidByValuation` — the parallel
// ground-up series the ledger grew for exactly this reason. A row without one
// is skipped and counted, never quietly substituted.
//
// ⚠ WHAT THE TOLERANCE IS AND WHY IT IS NOT TIGHT. The engine does not replay
// the pattern; it pays off it and then DEVELOPS, so a cohort whose ultimate
// moved between two valuations shows a link ratio that is the pattern's step
// times the development. The chain ladder also averages over cohorts of
// different sizes and ages. Both are real and neither is a defect, so the bar
// is on the AGE-TO-ULTIMATE factor at the ages a game actually reaches, which
// is what pricing reads, and it is set where the old Weibull fit misses by a
// wide margin — WC at 12 months read 4.671 against the recorded 12.777 before
// this change. A tolerance that this passes and that does not is the whole
// point; see the printed table for the margin on each line.
//
// ⚠ RESTATED FOR wip/adverse-development: reserve inflation is OFF
// (RESERVE_INFLATION_PER_YEAR 0) and ADVERSE DEVELOPMENT (ADVERSE_DEVELOPMENT)
// replaces it: each played year every open prior accident year's start-of-
// year outstanding grows by its own λ, drawn from the game seed per line,
// valuation year and accident year in the line's level's range (these games
// set Mid, 5-15%, explicitly — the default is Low; see the setup). It runs on the same route reserve inflation
// did, so the allowance below is the same product with the rate replaced by
// the λ the engine DREW — no shock schedule turns it off, so "nothing
// develops" no longer holds in a no-shocks game. Unallowed, the ledger read
// WC's 12-month factor 48.5% above the recorded one and GL's 25.6%, ten ages
// outside 12%, every one on the long-tailed lines and falling with age — the
// shape of compounding on what is still open — while section 3 put paid
// against the CURRENT ultimate on the pattern to the digit on every line. The
// payment is right; the ultimate under it grows by design. So:
//
//   growth(a -> L) = product over ledger ages k = a .. L-1 of
//                    (1 + (inflation rate + λ̄_k) x unpaid share at pattern age k + 1)
//
// where λ̄_k is the λ the engine drew for each row stepping from ledger age k
// to k + 1 (adverseDevelopmentRate at that valuation year and the row's
// accident year; 0 on a pre-game step, where nothing develops), weighted by
// the row's gross paid at k — the same weights the chain ladder's link ratio
// at k uses. The bar stays 12%. Reserve inflation's term is kept, at its
// shipped 0, so the allowance stays right if it is switched back on.
//
// THE CONTROLS: the recorded factors with no allowance at all (the failure
// above); every λ doubled, which must also fail — the allowance has to be the
// λ the engine drew, not merely some growth; and the ledger's valuation years
// must be where the allowance reads λ (firstValuationYear == accident year +
// ageAtFirstValuation on every row), asserted, since a λ read a year off would
// be a different uniform.
//
// GAINED, 2b: with the drawn λ allowed the ratio came out 1 to 7e-16 at every
// age, so with no shocks the identity is also held EXACTLY (1e-9), with
// controls the 12% bar cannot see — the λ read one valuation year late, and 5%
// high. With SHOCKS=catalogue 2b is reported, not asserted.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { paidLdfAt, PAID_DEVELOPMENT_PATTERN } from '../../src/data/paidDevelopmentPatterns';
import { LINE_PAYOUT_PATTERN } from '../../src/data/defaultAssumptions';
import { unpaidShare } from '../../src/utils/payoutPattern';
import { ADVERSE_DEVELOPMENT, newLossEngineRuns, RESERVE_INFLATION_PER_YEAR } from '../../src/data/pricingParameters';
import { adverseDevelopmentRate, developmentLevelOf } from '../../src/utils/adverseDevelopment';
import { marketSeedOf } from '../../src/utils/bookUnits';
import type { CoverageLine, GameState, ReserveDevelopmentRow } from '../../src/types/simulation';

// ============================================================================
// ⚠ ON THE NEW LOSS ENGINE THE GAMES RUN WITH NO SHOCKS, AND THAT IS THE
// QUESTION BEING ASKED, NOT A WAY ROUND IT. This gate tests that the engine
// PAYS on the recorded patterns. The new engine's R shocks (Social Inflation,
// Tort Reform, Economic Inflation…) also DEVELOP an accident year's ultimate
// upward after it is booked — a real effect the old engine did not have — and
// the pool's own chain ladder then reads that development as payment.
// Section 3 shows which it is: paid against the CURRENT ultimate sits on the
// pattern to the digit, and only the ultimate under it moves. So the gate
// plays a host-timed game with an empty schedule, where nothing develops, and
// holds the payment to the recorded factors at the same 12%.
//
// THE DEVELOPMENT IS REPORTED, NOT ASSERTED, and it is a pricing finding:
// run with SHOCKS=catalogue to see it. Measured on these seeds at commit 3,
// the pool's own GL age-to-L factor ran 17.0% above the recorded one at 12
// months, 15.0% at 24 and 12.3% at 36; WC and Property stayed inside 12%.
// Pricing develops with the recorded factors, so a GL year that a shock
// develops is under-developed by that margin until the ledger catches up.
// ============================================================================
const NO_SHOCKS = newLossEngineRuns() && process.env.SHOCKS !== 'catalogue';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
// ⚠ 2 x 10 IS THE SHORTEST RUN THAT STILL ANSWERS THE QUESTION, and it is
// chosen to keep this in the every-commit tier rather than for speed's own
// sake. An acceptance test that runs once a release is not one. 4 x 14 reads
// the same table — WC's 12-month ratio 2.0579 against 2.1554 here — and the
// extra time buys only the ages past 204 months, which no game reaches.
const GAMES = Number(process.env.GAMES ?? 2);
const YEARS = Number(process.env.YEARS ?? 10);

// ⚠ RESERVE INFLATION GROWS EVERY OPEN YEAR'S ULTIMATE, AND THE BAR ALLOWS FOR
// IT (the reserve-inflation landing). Each year the line's trend
// (RESERVE_INFLATION_PER_YEAR) lands on the year's start-of-year unpaid, and
// the true-up pays the pattern's share of the higher ultimate. So paid stays
// on the pattern against the CURRENT ultimate (section 3, to the digit), and
// the chain ladder, which develops to the LATER one, reads the recorded factor
// TIMES the growth inflation adds between the two ages:
//
//   growth(a -> L) = product over ledger ages k = a .. L-1 of
//                    (1 + trend x unpaid share at pattern age k + 1)
//
// Measured before this allowance: WC's 12-month factor 20.9% above the recorded
// one, GL's 32.1%, every line inside 12% at the ages past three years. With it,
// see the table. The control holds the ledger to the recorded factors with no
// allowance, which is that failure.
// (RESTATED: + λ̄_k, adverse development's drawn rate — see the header.)
const inflationGrowth = (line: CoverageLine, fromAge: number, toAge: number, lambda: (line: CoverageLine, k: number) => number,
  rate = RESERVE_INFLATION_PER_YEAR[line]): number => {
  let g = 1;
  for (let k = fromAge; k < toAge; k++) g *= 1 + (rate + lambda(line, k)) * unpaidShare(LINE_PAYOUT_PATTERN[line], k + 1);
  return g;
};

// ⚠ THE BAR IS ON THE RATIO, NOT THE DIFFERENCE, because an LDF of 12.777 and
// one of 1.02 cannot share an absolute tolerance. 12% either way: comfortably
// inside the development noise the header describes and nowhere near the 2.7x
// the retired Weibull fit missed WC's first factor by.
const TOLERANCE = 0.12;

// Ages a five-to-ten year game actually reaches with enough cohorts behind them
// to chain-ladder. Past this the ledger holds one or two rows and the factor is
// an anecdote.
const MIN_OBSERVATIONS = 6;

let failures = 0;
const fail = (s: string) => { failures++; console.log(`  FAIL  ${s}`); };

console.log('=== RECORDED PAYOUT CHECK ===\n');
if (newLossEngineRuns()) {
  console.log(NO_SHOCKS
    ? '  New loss engine: games play with NO SHOCKS (host timing, empty schedule) — the payment alone.\n'
    : '  New loss engine, SHOCKS=catalogue: shock development included — REPORTED; the bar is for the payment alone.\n');
}

// --------------------------------------------------------------------------
console.log('--- 0. THE ENGINE IS ON THE RECORDED PATTERNS AT ALL ---');
for (const line of LINES) {
  const pat = LINE_PAYOUT_PATTERN[line];
  if (pat.kind !== 'recorded') {
    fail(`${line} pays on a '${pat.kind}' pattern — LINE_PAYOUT_PATTERN is not the recorded set`);
  } else if (pat.line !== line) {
    fail(`${line} pays on ${pat.line}'s recorded pattern`);
  }
}
if (failures === 0) console.log('  OK    all three lines resolve to their own recorded paid pattern');

// --------------------------------------------------------------------------
// Play the games and pool every cohort's GROSS paid history by age.
//
// AGE CONVENTION, and it is the ledger's rather than the pattern's: a row's
// `ageAtFirstValuation + k` indexes the k-th valuation, and valuation at ledger
// age a is (a + 1) x 12 months from the start of the accident year. So ledger
// age 0 is the 12-month valuation.
const num: Record<string, number[]> = {};
const den: Record<string, number[]> = {};
const obs: Record<string, number[]> = {};
// Σ gross[k] x the λ drawn for the step k -> k + 1, per ledger age: over
// den, the paid-weighted λ̄ the allowance uses.
const lamNum: Record<string, number[]> = {};
let misdatedRows = 0;
const MAX_AGE = 40;
for (const l of LINES) {
  lamNum[l] = new Array(MAX_AGE).fill(0);
  num[l] = new Array(MAX_AGE).fill(0);
  den[l] = new Array(MAX_AGE).fill(0);
  obs[l] = new Array(MAX_AGE).fill(0);
}
let skippedRows = 0;
let usedRows = 0;
// Kept so section 3 can re-read the same rows on the net/ultimate series.
const ledgerRows: Record<string, ReserveDevelopmentRow[]> = { WC: [], GL: [], Property: [] };

for (let g = 0; g < GAMES; g++) {
  const id = `PAYOUT${g}`;
  const inst = generateGameInstance(id, 7_700_000 + g * 4211);
  // No shocks: the host's timing, with nothing scheduled. See the header.
  if (NO_SHOCKS) inst.scheduledShocks = [];
  const setup = {
    poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES,
    ...(NO_SHOCKS ? { shockTiming: 'host' as const } : {}),
    // Mid, set rather than defaulted: the default became Low (1-5%), where a
    // doubled λ stays inside the 12% bar and the doubling control could not
    // fail. At Mid (5-15%) it does, so the allowance is still shown to be the
    // λ the engine drew and not merely some growth.
    developmentLevels: { WC: 'Mid', GL: 'Mid', Property: 'Mid' } as const,
  };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  let last = poolState;
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    last = p.updatedPoolState;
    gs = { ...gs, poolState: last, currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
  }
  for (const line of LINES) {
    const rows: ReserveDevelopmentRow[] = last.lines[line].reserveDevelopment ?? [];
    for (const r of rows) {
      ledgerRows[line].push(r);
      const gross = r.grossPaidByValuation;
      if (!gross || gross.length < 2) { skippedRows++; continue; }
      usedRows++;
      const a0 = r.ageAtFirstValuation ?? 0;
      if (r.firstValuationYear !== r.yearNumber + a0) misdatedRows++;
      for (let k = 0; k + 1 < gross.length; k++) {
        const age = a0 + k;
        if (age + 1 >= MAX_AGE) continue;
        if (gross[k] > 0) {
          // The step k -> k + 1 is valuation year firstValuationYear + k + 1;
          // only a PLAYED year (>= 1) develops.
          const v = r.firstValuationYear + k + 1;
          // A line set Off (single player) develops nothing: λ 0.
          const level = developmentLevelOf(setup as never, line);
          const lambda = ADVERSE_DEVELOPMENT.enabled && v >= 1 && level
            ? adverseDevelopmentRate(marketSeedOf(inst), line, level, v, r.yearNumber) : 0;
          lamNum[line][age] += gross[k] * lambda;
          den[line][age] += gross[k];
          num[line][age] += gross[k + 1];
          obs[line][age] += 1;
        }
      }
    }
  }
}

console.log(`\n--- 1. THE LEDGER: ${GAMES} games x ${YEARS} years, ${usedRows} rows used, ${skippedRows} skipped for want of a ground-up series ---`);
if (usedRows === 0) fail('no ledger rows carried grossPaidByValuation — nothing was measured');
if (misdatedRows > 0) fail(`${misdatedRows} row(s) whose first valuation year is not accident year + age at first valuation — the allowance would read λ off the wrong year`);
else console.log(`  OK    every row's valuation years are accident year + age, where the allowance reads λ`);
// The paid-weighted λ̄ per ledger age (see the header).
const drawnLambda = (line: CoverageLine, k: number) => (den[line][k] > 0 ? lamNum[line][k] / den[line][k] : 0);
console.log(`  adverse development ${ADVERSE_DEVELOPMENT.enabled ? 'on' : 'OFF'}; λ̄ drawn at ledger ages 0-4: `
  + LINES.map(l => `${l} ${[0, 1, 2, 3, 4].map(k => drawnLambda(l, k).toFixed(3)).join('/')}`).join(', '));

// --------------------------------------------------------------------------
// ⚠ BOTH SIDES ARE CUT AT THE LAST AGE THE LEDGER OBSERVES, AND THAT
// CORRECTION IS THE INSTRUMENT RATHER THAN THE BAR.
//
// A chain ladder cannot see past its own data. Its product of link ratios
// carries an implicit 1.0 tail from the last observed age onward, so what it
// actually computes is paid-at-a to paid-at-L, not paid-at-a to ULTIMATE.
// Comparing that against a recorded AGE-TO-ULTIMATE factor is comparing two
// different quantities, and the error is exactly the recorded factor at L.
//
// IT WAS MEASURED BEFORE IT WAS CORRECTED, which is what says this is an
// instrument fault and not a bar being moved to fit. With the tails mismatched
// WC read a ratio of 0.8465 at EVERY age from 84 months to 276 — flat to four
// decimals across sixteen ages. A development problem varies with age; a
// constant can only be multiplicative, and 1/0.8465 = 1.18133 against the
// recorded WC factor at 312 months, 1.18131. One part in fifty thousand.
// GL and Property never showed it because their tails are worth 1% and 0%,
// which is how the fault survived the first run.
//
// So the recorded side is cut at L too: recorded LDF(a) / recorded LDF(L) is
// the age-to-L factor the table implies, and that is what the ledger's own
// age-to-L factor is compared against. Nothing is extrapolated on either side.
// The age-to-ultimate column is printed beside it so the tail that cannot be
// observed is visible rather than quietly dropped.
// `growth` is the reserve inflation and adverse development allowed between
// two ledger ages; the controls pass none, and the drawn λ doubled. Returns the
// failures, printing only when `show`; `worstRatio` keeps the worst |ratio - 1| (2b).
let worstRatio = 0;
function gradeLedger(growth: (line: CoverageLine, a: number, L: number) => number, show: boolean): string[] {
const out: string[] = [];
const log = (x: string) => { if (show) console.log(x); };
log('\n--- 2. THE POOL\'S OWN PAID LDF AGAINST THE RECORDED ONE x RESERVE INFLATION AND ADVERSE DEVELOPMENT, BY LINE AND AGE ---');
log('  Both sides cut at the last age the ledger reaches. age-to-ULT is printed for reference only.');
log('  line      age(mo)   recorded a->L   x inf+adv     pool\'s own   ratio   rows    recorded a->ULT');
for (const line of LINES) {
  const link = num[line].map((_, a) => (den[line][a] > 0 ? num[line][a] / den[line][a] : 1));
  const lastRecorded = PAID_DEVELOPMENT_PATTERN[line][PAID_DEVELOPMENT_PATTERN[line].length - 1].ageMonths;
  // The last ledger age that carries a link ratio at all. Past it the chain
  // ladder is multiplying by 1 and the comparison would be against a tail the
  // pool has not lived.
  let lastObserved = 0;
  for (let a = 0; a < MAX_AGE; a++) if (obs[line][a] > 0 && (a + 1) * 12 <= lastRecorded) lastObserved = a;
  const ownToL = (age: number) => {
    let v = 1;
    for (let a = age; a < lastObserved; a++) v *= link[a];
    return v;
  };
  const ldfAtAge = (a: number) => paidLdfAt(line, (a + 1) * 12);
  log(`  ${line} — ledger reaches ledger age ${lastObserved} (${(lastObserved + 1) * 12} months); `
    + `the unobservable tail past it is worth x${ldfAtAge(lastObserved).toFixed(4)}`);
  let checked = 0;
  for (let age = 0; age < lastObserved; age++) {
    if (obs[line][age] < MIN_OBSERVATIONS) continue;
    const ageMonths = (age + 1) * 12;
    const recordedToUlt = paidLdfAt(line, ageMonths);
    const recordedToL = recordedToUlt / ldfAtAge(lastObserved);
    const inflation = growth(line, age, lastObserved);
    const own = ownToL(age);
    const ratio = own / (recordedToL * inflation);
    worstRatio = Math.max(worstRatio, Math.abs(ratio - 1));
    const ok = Math.abs(ratio - 1) <= TOLERANCE;
    checked++;
    log(`  ${line.padEnd(9)} ${String(ageMonths).padStart(7)} ${recordedToL.toFixed(4).padStart(15)} `
      + `${inflation.toFixed(4).padStart(13)} ${own.toFixed(4).padStart(12)} ${ratio.toFixed(4).padStart(7)} ${String(obs[line][age]).padStart(6)} `
      + `${recordedToUlt.toFixed(4).padStart(18)}`
      + `${ok ? '' : '   <-- OUTSIDE TOLERANCE'}`);
    if (!ok) {
      out.push(`${line} at ${ageMonths}mo: the pool's own age-to-${(lastObserved + 1) * 12}mo factor ${own.toFixed(4)} is `
        + `${((ratio - 1) * 100).toFixed(1)}% from the recorded ${recordedToL.toFixed(4)} x inflation and adverse development ${inflation.toFixed(4)} — `
        + 'the engine is not paying the way pricing develops');
    }
  }
  if (checked === 0) out.push(`${line}: no age had ${MIN_OBSERVATIONS} observations — nothing was compared`);
}
return out;
}
worstRatio = 0;
for (const f of gradeLedger((line, a, L) => inflationGrowth(line, a, L, drawnLambda), true)) fail(f);

// 2b. EXACT, WITH NO SHOCKS (gained on wip/adverse-development). Measured: with
// the drawn λ allowed, every ratio above is 1 to 7e-16 — in a no-shocks game
// nothing but the pattern and adverse development moves the gross paid. So
// the identity is held to 1e-9 as well as the 12% bar, which cannot see a λ
// read a year late (0.9% at worst) or 5% high (1.9%). With the catalogue's
// shocks the R development is real movement on top and this is reported only.
const EXACT = 1e-9;
const exactWorst = (growth: (line: CoverageLine, a: number, L: number) => number) => { worstRatio = 0; gradeLedger(growth, false); return worstRatio; };
{
  const w = exactWorst((line, a, L) => inflationGrowth(line, a, L, drawnLambda));
  if (NO_SHOCKS && !(w < EXACT)) fail(`2b. with no shocks the ledger is not EXACTLY the recorded factors x the drawn development: worst |ratio - 1| ${w.toExponential(2)}`);
  else console.log(`\n  ${NO_SHOCKS ? 'OK   ' : 'INFO '} 2b. exact with no shocks: worst |ratio - 1| ${w.toExponential(2)} against ${EXACT.toExponential(0)}${NO_SHOCKS ? '' : ' (shocks on — reported, not asserted)'}`);
}

// THE CONTROLS: the same ledger held to the recorded factors with no
// allowance for development must fail the 12% bar; and so must an allowance
// of twice the λ the engine drew. The exact bar must catch a λ read one
// valuation year late, and one 5% high.
console.log('');
for (const [name, growth] of [
  ['the recorded factors with no reserve inflation or adverse development allowed', () => 1],
  ['the allowance at twice the λ the engine drew', (line: CoverageLine, a: number, L: number) => inflationGrowth(line, a, L, (l, k) => 2 * drawnLambda(l, k))],
] as [string, (line: CoverageLine, a: number, L: number) => number][]) {
  const caught = gradeLedger(growth, false);
  if (caught.length === 0) fail(`control: ${name} are NOT caught`);
  else console.log(`  OK    control: ${name} — caught (${caught.length} ages outside ${(TOLERANCE * 100).toFixed(0)}%)`);
}
if (NO_SHOCKS) {
  for (const [name, growth] of [
    ['the λ read one valuation year late', (line: CoverageLine, a: number, L: number) => inflationGrowth(line, a, L, (l, k) => drawnLambda(l, k + 1))],
    ['the λ 5% high', (line: CoverageLine, a: number, L: number) => inflationGrowth(line, a, L, (l, k) => 1.05 * drawnLambda(l, k))],
  ] as [string, (line: CoverageLine, a: number, L: number) => number][]) {
    const w = exactWorst(growth);
    if (w < EXACT) fail(`control: ${name} is NOT caught by 2b (worst ${w.toExponential(2)})`);
    else console.log(`  OK    control: ${name} — caught by 2b (worst |ratio - 1| ${w.toExponential(2)})`);
  }
}

// --------------------------------------------------------------------------
// ⚠ SECTION 3 EXISTS BECAUSE SECTION 2 FAILED AND THE REASON HAD TO BE
// MEASURED RATHER THAN REASONED TO. Two candidate explanations for a gap
// between the pattern the engine pays on and the factors its ledger produces:
//
//   (a) THE PAYMENT IS WRONG — paid-to-date is not the pattern's share of the
//       ultimate the cohort is carrying. That would be a wiring defect.
//   (b) THE ULTIMATE MOVED — paid-to-date IS the pattern's share of the CURRENT
//       booked ultimate, but the chain ladder develops to the FINAL one, and
//       the engine's booking walk makes those two different numbers.
//
// They are distinguishable: (a) shows up as paid/current-ultimate departing
// from the pattern's own cumulative, (b) as a current-to-final ultimate ratio
// above 1. Both are measured below, on the same rows section 2 used.
console.log('\n--- 3. WHICH OF THE TWO IT IS: THE PAYMENT, OR THE ULTIMATE UNDER IT ---');
console.log('  line      age(mo)   pattern cum%   paid / CURRENT ult   paid / FINAL ult   ult(final)/ult(here)');
const walkNote: string[] = [];
for (const line of LINES) {
  const pat = LINE_PAYOUT_PATTERN[line];
  for (const age of [0, 1, 2, 4]) {
    let sumPaidHere = 0, sumUltHere = 0, sumUltFinal = 0, n = 0;
    for (const r of ledgerRows[line]) {
      const paid = r.paidByValuation ?? [];
      const ult = r.ultimateByValuation ?? [];
      const a0 = r.ageAtFirstValuation ?? 0;
      const k = age - a0;
      if (k < 0 || k >= paid.length || k >= ult.length) continue;
      if (!(ult[k] > 0) || !(ult[ult.length - 1] > 0)) continue;
      sumPaidHere += paid[k];
      sumUltHere += ult[k];
      sumUltFinal += ult[ult.length - 1];
      n++;
    }
    if (n < MIN_OBSERVATIONS) continue;
    const patternCum = 1 - unpaidShare(pat, age + 1);
    const vsCurrent = sumPaidHere / sumUltHere;
    const vsFinal = sumPaidHere / sumUltFinal;
    const develop = sumUltFinal / sumUltHere;
    console.log(`  ${line.padEnd(9)} ${String((age + 1) * 12).padStart(7)} `
      + `${(patternCum * 100).toFixed(2).padStart(13)}% ${(vsCurrent * 100).toFixed(2).padStart(19)}% `
      + `${(vsFinal * 100).toFixed(2).padStart(17)}% ${develop.toFixed(4).padStart(21)}`);
    if (age === 0) {
      walkNote.push(`${line}: paid at 12mo is ${(vsCurrent * 100).toFixed(2)}% of the ultimate booked then `
        + `(pattern says ${(patternCum * 100).toFixed(2)}%), and ${(vsFinal * 100).toFixed(2)}% of the final one; `
        + `the ultimate grew x${develop.toFixed(3)} over the cohort's life`);
    }
  }
}
console.log('\n  THE READING:');
for (const s of walkNote) console.log(`    ${s}`);

// --------------------------------------------------------------------------
console.log(`\n  tolerance ${(TOLERANCE * 100).toFixed(0)}% on the ratio, at ages with at least ${MIN_OBSERVATIONS} cohort-valuations.`);
console.log(failures === 0
  ? '\nRECORDED PAYOUT HOLDS — the played ledger develops on the factors pricing uses.\n'
  : `\n${failures} FAILURE(S).\n`);
process.exit(failures === 0 ? 0 : 1);
