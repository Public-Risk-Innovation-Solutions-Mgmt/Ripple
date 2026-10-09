// ============================================================================
// THE CLAIMS MANAGEMENT SYSTEM REACHES CLAIMS BELOW EACH RETENTION AND NOTHING
// ELSE — a GATE.
//
//   GAMES=8 YEARS=4 npx tsx scripts/diagnostics/claims-system-check.ts
//
// ⚠ IT ASSERTS THE MECHANISM, NOT THE MAGNITUDE. 10% is a chosen number
// (riskControlPrograms.ts records why, and what would replace it), so an
// assertion that the cut is 10% would be a test of a preference. What is tested
// is the SHAPE: which claims move, by exactly what factor, that nothing else
// moves with them, and that the tower sees none of it. Raising the rate must
// leave every assertion here true.
//
// ⚠ EVERY ARM IS A REDRAW OF A PLAYED YEAR, NOT A SECOND GAME. Each line-year
// the engine actually played is redrawn through claimRegeneration with ONE field
// overridden on a copy of its result — the same roster, k, seed and shock the
// engine used. So the difference between arms is the program and nothing else,
// and the null arm can be compared claim-for-claim rather than in aggregate.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { regenerateLineYearClaims } from '../../src/utils/claimRegeneration';
import { occurrenceTotals, cedeOccurrences } from '../../src/utils/reinsuranceTower';
import { FULL_OCCURRENCE_PLACEMENT } from '../../src/data/reinsuranceTower';
import {
  CLAIMS_SYSTEM_ID, CLAIMS_SYSTEM_SEVERITY_REDUCTION, CLAIMS_SYSTEM_THRESHOLD,
  CLAIMS_SYSTEM_RAMP, CLAIMS_SYSTEM_TERM_YEARS, CLAIMS_SYSTEM_TIER_COST,
  claimsSystemAdjusted, claimsSystemStanding, claimsSystemSeverityReduction,
  claimsSystemPoolCost, programAnnualCost,
} from '../../src/utils/riskControlPrograms';
import type { CoverageLine, GameState, ResultSet } from '../../src/types/simulation';
import type { TowerLine } from '../../src/data/reinsuranceTower';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 8);
const YEARS = Number(process.env.YEARS ?? 4);
const R = CLAIMS_SYSTEM_SEVERITY_REDUCTION;

const failed: string[] = [];
const fail = (s: string) => { if (failed.length < 30) failed.push(s); };
const ok = (cond: boolean, msg: string) => { if (!cond) fail(msg); };
const RULE = '='.repeat(72);

console.log(RULE);
console.log('CLAIMS SYSTEM — below each retention, and nothing else');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years, all three lines. rate ${(100 * R).toFixed(1)}% at full effect.`);
console.log(`thresholds: ${LINES.map(l => `${l} $${(CLAIMS_SYSTEM_THRESHOLD[l] / 1e6).toFixed(0)}M`).join('  ')}\n`);

// --- 1. THE STANDING: ramp, term, tier, lapse -----------------------------
console.log('--- 1. the standing: ramp, term, tiered charge, lapse ---');
{
  const seq = (n: number) => Array.from({ length: n - 1 }, () => [CLAIMS_SYSTEM_ID]);
  for (let t = 1; t <= 5; t++) {
    const st = claimsSystemStanding([CLAIMS_SYSTEM_ID], seq(t), 3);
    const want = CLAIMS_SYSTEM_RAMP[Math.min(t, CLAIMS_SYSTEM_RAMP.length) - 1];
    ok(st.level === want, `tenure ${t}: level ${st.level} wanted ${want}`);
    const wantCost = t <= CLAIMS_SYSTEM_TERM_YEARS ? CLAIMS_SYSTEM_TIER_COST[3] : 0;
    ok(st.poolAnnualCost === wantCost, `tenure ${t}: charged ${st.poolAnnualCost} wanted ${wantCost}`);
  }
  // YEAR ONE BUYS NOTHING. The whole shape rests on it, so it is asserted
  // rather than left to the ramp array's first element being read correctly.
  ok(claimsSystemStanding([CLAIMS_SYSTEM_ID], [], 1).level === 0, 'year one bought something');
  ok(claimsSystemSeverityReduction([CLAIMS_SYSTEM_ID], []) === 0, 'year one applied a reduction');
  // The tier, and that it is NOT a per-line multiple.
  ok(claimsSystemPoolCost(1) === 1_000_000, 'one-line tier');
  ok(claimsSystemPoolCost(2) === 1_500_000, 'two-line tier');
  ok(claimsSystemPoolCost(3) === 2_000_000, 'three-line tier');
  ok(claimsSystemPoolCost(3) < 3 * claimsSystemPoolCost(1), 'the three-line tier is a per-line multiple');
  // Split evenly across the lines the engine bills.
  const perLine = programAnnualCost('Property', [CLAIMS_SYSTEM_ID], [], 3);
  ok(Math.abs(perLine * 3 - 2_000_000) < 1e-6, `three lines x ${perLine} != the three-line tier`);
  ok(Math.abs(programAnnualCost('WC', [CLAIMS_SYSTEM_ID], [], 3) - perLine) < 1e-6, 'the split is not even');
  // Nothing committed: nothing charged, on every line.
  for (const l of LINES) ok(programAnnualCost(l, [], [], 3) === 0, `${l} charged with nothing committed`);
  // Lapse decays rather than cliffs.
  const lapsed = claimsSystemStanding([], [[CLAIMS_SYSTEM_ID], [CLAIMS_SYSTEM_ID], [CLAIMS_SYSTEM_ID]], 3);
  ok(lapsed.level > 0 && lapsed.level < 1, `a lapsed year read ${lapsed.level}, wanted a decaying residual`);
  ok(lapsed.poolAnnualCost === 0, 'a lapsed year was charged');
  console.log(`   ramp ${JSON.stringify(CLAIMS_SYSTEM_RAMP)}, term ${CLAIMS_SYSTEM_TERM_YEARS}y, `
    + `tiers 1/1.5/2 $M, per line at 3 lines $${(perLine / 1e6).toFixed(3)}M, lapse -> ${lapsed.level}: OK`);
}

// --- 2. THE RULE, IN ISOLATION --------------------------------------------
console.log('\n--- 2. the rule: strictly below, exact factor, monotone ---');
for (const line of LINES) {
  const T = CLAIMS_SYSTEM_THRESHOLD[line];
  ok(claimsSystemAdjusted(line, T, R) === T, `${line}: a claim AT the retention was reduced`);
  ok(claimsSystemAdjusted(line, T * 1.5, R) === T * 1.5, `${line}: a claim above the retention was reduced`);
  ok(Math.abs(claimsSystemAdjusted(line, T * 0.5, R) - T * 0.5 * (1 - R)) < 1e-9,
    `${line}: a claim below the retention was not cut by exactly the rate`);
  ok(claimsSystemAdjusted(line, T * 0.999, R) < T, `${line}: a reduced claim crossed the threshold upward`);
  ok(claimsSystemAdjusted(line, T * 0.5, 0) === T * 0.5, `${line}: a zero reduction moved a claim`);
}
console.log('   at the retention untouched, above untouched, below cut exactly, zero is a no-op: OK');

// --- 3. PLAY, THEN REDRAW BOTH ARMS ---------------------------------------
interface Played { line: CoverageLine; result: ResultSet; instance: ReturnType<typeof generateGameInstance> }
const played: Played[] = [];
for (let g = 0; g < GAMES; g++) {
  const id = `CSG${g}`;
  const inst = generateGameInstance(id, 5_400_000 + g * 7717);
  const setup = { poolName: 'C', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    for (const line of LINES) played.push({ line, result: p.result, instance: inst });
    gs = {
      ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
      currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1), isComplete: y >= YEARS,
    };
  }
}

/** Redraw one played line-year with the severity reduction overridden. */
function redraw(pl: Played, reduction: number) {
  const copy = JSON.parse(JSON.stringify(pl.result)) as ResultSet;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (copy.byLine[pl.line] as any).programSeverityApplied = reduction;
  return regenerateLineYearClaims(pl.instance, copy, pl.line);
}

// --- 4. THE NULL ARM, CLAIM FOR CLAIM -------------------------------------
console.log('\n--- 4. the null arm: the redraw reproduces what the ENGINE drew ---');
{
  // ⚠ AGAINST THE ENGINE, NOT AGAINST A SECOND REDRAW. Two redraws agreeing
  // proves the redraw is deterministic and nothing more; it would still agree if
  // both reproduced the wrong register. The line-year's OWN grossUltimateLoss is
  // what the engine booked, so comparing against it is the claim being made:
  // with no program committed, the redraw is the engine's draw.
  //
  // ⚠ AND THE ENGINE-LEVEL STATEMENT IS value-identity's, NOT THIS FILE'S. That
  // capture reports 0 of 31,440 fields changed across this commit, which is the
  // proof that adding the program moved nothing while nobody has bought it.
  // This part proves the narrower thing this file can prove on its own.
  let compared = 0, mismatched = 0, idUnstable = 0;
  for (const pl of played) {
    const a = redraw(pl, 0);
    const engineGross = pl.result.byLine[pl.line]?.grossUltimateLoss ?? NaN;
    const redrawGross = a.claims.reduce((s, c) => s + c.grossUltimate, 0);
    compared++;
    if (!(Math.abs(redrawGross - engineGross) < 0.01)) mismatched++;
    const b = redraw(pl, 0);
    if (a.claims.length !== b.claims.length
      || a.claims.some((c, i) => c.id !== b.claims[i].id || c.grossUltimate !== b.claims[i].grossUltimate)) {
      idUnstable++;
    }
  }
  ok(mismatched === 0, `${mismatched} of ${compared} line-years redrew a different gross than the engine booked`);
  ok(idUnstable === 0, `${idUnstable} line-years were not stable across two identical redraws`);
  ok(compared > 0, 'the null arm compared no line-years at all — the probe is vacuous');
  console.log(`   ${compared} line-years: ${mismatched} differ from the engine, ${idUnstable} unstable: OK`);
}

// --- 5. CONFINEMENT: ONLY BELOW-THRESHOLD CLAIMS MOVE ----------------------
console.log('\n--- 5. confinement: which claims move, and by how much ---');
{
  let below = 0, above = 0, wrongFactor = 0, aboveMoved = 0, countChanged = 0, idChanged = 0;
  let grossOff = 0, grossOn = 0, savedBelow = 0;
  for (const pl of played) {
    const off = redraw(pl, 0);
    const on = redraw(pl, R);
    const T = CLAIMS_SYSTEM_THRESHOLD[pl.line];
    if (off.claims.length !== on.claims.length) { countChanged++; continue; }
    for (let i = 0; i < off.claims.length; i++) {
      const a = off.claims[i], b = on.claims[i];
      if (a.id !== b.id) { idChanged++; continue; }
      grossOff += a.grossUltimate; grossOn += b.grossUltimate;
      if (a.grossUltimate < T) {
        below++;
        const want = a.grossUltimate * (1 - R);
        if (Math.abs(b.grossUltimate - want) > 1e-6) wrongFactor++;
        savedBelow += a.grossUltimate - b.grossUltimate;
      } else {
        above++;
        if (b.grossUltimate !== a.grossUltimate) aboveMoved++;
      }
    }
  }
  ok(countChanged === 0, `${countChanged} line-years changed CLAIM COUNT — this is severity, not frequency`);
  ok(idChanged === 0, `${idChanged} claims changed id — the draw was re-phased`);
  ok(aboveMoved === 0, `${aboveMoved} claims AT OR ABOVE the retention moved`);
  ok(wrongFactor === 0, `${wrongFactor} below-threshold claims were not cut by exactly the rate`);
  ok(below > 0 && above > 0, `the sample has ${below} below and ${above} above — both must be non-empty to mean anything`);
  ok(grossOn < grossOff, 'gross did not fall at all');
  console.log(`   ${below} below (all cut by exactly ${(100 * R).toFixed(1)}%), ${above} at/above (none moved)`);
  console.log(`   gross $${(grossOff / 1e6).toFixed(1)}M -> $${(grossOn / 1e6).toFixed(1)}M, `
    + `saved $${(savedBelow / 1e6).toFixed(2)}M (${(100 * savedBelow / grossOff).toFixed(2)}% of gross)`);
}

// --- 6. THE TOWER SEES NONE OF IT -----------------------------------------
console.log('\n--- 6. the tower: its share of the saving ---');
{
  let cededOff = 0, cededOn = 0, grossSaved = 0;
  for (const pl of played) {
    const off = redraw(pl, 0);
    const on = redraw(pl, R);
    const placed = FULL_OCCURRENCE_PLACEMENT[pl.line as TowerLine];
    const cOff = cedeOccurrences(pl.line as TowerLine, occurrenceTotals(off.claims, off.occurrences), placed);
    const cOn = cedeOccurrences(pl.line as TowerLine, occurrenceTotals(on.claims, on.occurrences), placed);
    cededOff += cOff.totalCeded; cededOn += cOn.totalCeded;
    grossSaved += off.claims.reduce((s, c) => s + c.grossUltimate, 0)
      - on.claims.reduce((s, c) => s + c.grossUltimate, 0);
  }
  const towerShare = grossSaved > 0 ? (cededOff - cededOn) / grossSaved : 0;
  // ⚠ NOT ASSERTED AS EXACTLY ZERO, AND THE MEASUREMENT SAYS WHY. A Property
  // catastrophe is ONE occurrence carrying many claims, so a below-threshold
  // claim CAN sit inside an occurrence that pierces. Measured at 0.0% on a
  // default book and 0.6% with an earthquake scheduled into every game. The
  // bound is 2%: comfortably above both, far below what a frequency cut leaks,
  // and tight enough that a genuine leak fails it.
  //
  // ⚠ THE COMPARISON FIGURE HERE WAS 78.1% AND IT WAS WRONG. It arrived with
  // this file, cited no script and no basis, and does not reproduce on any
  // reading of "a frequency cut's leak" that could be reconstructed from the
  // repository. It is replaced by a MEASURED figure on a STATED basis:
  //
  //   A uniform frequency cut removes whole occurrences at random, so the
  //   tower's share of its gross saving is  1 - sum min(O, retention) / sum O
  //   over the occurrences drawn, on the ULTIMATE basis (the tower against the
  //   DRAWN occurrences, not the booked ones — wc-program-value's header has
  //   why that distinction roughly doubles the apparent share if you get it
  //   wrong). Measured over 20 games x 5 years per line, solo:
  //
  //     WC        $1M retention   48,371 occurrences   tower takes 26.35%
  //     GL        $1M retention   31,813 occurrences   tower takes 46.07%
  //     Property  $5M retention    8,806 occurrences   tower takes 28.01%
  //
  // GL is the line this comment was about and it leaks 46.07%. The point the
  // sentence was making survives intact and is if anything clearer: a
  // below-retention SEVERITY cut leaks ~0%, where a frequency cut on the same
  // line gives nearly half its saving away. A number quoted with no instrument
  // behind it is the failure scripts/tools/session-drivers/_shared.cjs was
  // written to close, and this one was an instance of it.
  ok(Math.abs(towerShare) < 0.02,
    `the tower took ${(100 * towerShare).toFixed(2)}% of the saving, bound 2%`);
  console.log(`   ceded $${(cededOff / 1e6).toFixed(2)}M -> $${(cededOn / 1e6).toFixed(2)}M on a `
    + `$${(grossSaved / 1e6).toFixed(2)}M saving: tower share ${(100 * towerShare).toFixed(2)}%`);
}

// --- 7. POSITIVE CONTROLS: EACH ASSERTION ABOVE CAN FAIL ------------------
console.log('\n--- 7. controls: every rule above fires when broken ---');
{
  // A probe that cannot fail is worse than none, so each rule is re-run against
  // a deliberately wrong implementation and must come back false.
  const line: CoverageLine = 'WC';
  const T = CLAIMS_SYSTEM_THRESHOLD[line];
  // (a) a rule that cuts AT the threshold breaks "strictly below".
  const atThreshold = (d: number) => (d <= T ? d * (1 - R) : d);
  ok(atThreshold(T) !== T, 'CONTROL DID NOT FIRE: a cut-at-threshold rule passed the strictly-below test');
  // (b) a rule with the wrong threshold moves claims the real one does not.
  const tooHigh = (d: number) => (d < T * 2 ? d * (1 - R) : d);
  ok(tooHigh(T * 1.5) !== claimsSystemAdjusted(line, T * 1.5, R),
    'CONTROL DID NOT FIRE: a doubled threshold was indistinguishable from the real one');
  // (c) a rule applied to EVERY claim leaks to the tower. Measured, not asserted
  //     by construction: redraw one book cutting everything and show the tower
  //     takes a share the 2% bound would reject.
  let cededOff = 0, cededOn = 0, saved = 0;
  for (const pl of played.filter(p => p.line === 'Property').slice(0, 24)) {
    const off = redraw(pl, 0);
    const placed = FULL_OCCURRENCE_PLACEMENT.Property;
    const cut = off.claims.map(c => ({ ...c, grossUltimate: c.grossUltimate * (1 - R) }));
    cededOff += cedeOccurrences('Property', occurrenceTotals(off.claims, off.occurrences), placed).totalCeded;
    cededOn += cedeOccurrences('Property', occurrenceTotals(cut, off.occurrences), placed).totalCeded;
    saved += off.claims.reduce((s, c) => s + c.grossUltimate, 0) - cut.reduce((s, c) => s + c.grossUltimate, 0);
  }
  const unboundedShare = saved > 0 ? (cededOff - cededOn) / saved : 0;
  ok(unboundedShare > 0.02,
    `CONTROL DID NOT FIRE: cutting EVERY claim leaked only ${(100 * unboundedShare).toFixed(2)}% to the tower, `
    + 'so the 2% bound in part 6 proves nothing');
  console.log(`   cut-at-threshold fires, doubled threshold fires, unbounded cut leaks `
    + `${(100 * unboundedShare).toFixed(1)}% to the tower (bound 2%): OK`);
}

console.log(`\n${RULE}`);
if (failed.length) {
  console.log(`FAIL — ${failed.length} problem(s):`);
  for (const f of failed) console.log(`  ${f}`);
  console.log(RULE);
  process.exit(1);
}
console.log('THE CLAIMS SYSTEM REACHES CLAIMS BELOW EACH RETENTION AND NOTHING ELSE.');
console.log(RULE);
