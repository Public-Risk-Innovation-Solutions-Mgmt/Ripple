// ============================================================================
// THE CLAIMS MANAGEMENT SYSTEM REACHES CLAIMS BELOW ITS FIXED THRESHOLDS AND
// NOTHING ELSE — a GATE.
//
//   GAMES=8 YEARS=4 npx tsx scripts/diagnostics/claims-system-check.ts
//
// ⚠ IT ASSERTS THE MECHANISM, NOT THE MAGNITUDE. 10% is a chosen number
// (riskControlPrograms.ts records why, and what would replace it), so an
// assertion that the cut is 10% would be a test of a preference. What is tested
// is the SHAPE: which claims move, by exactly what factor, that nothing else
// moves with them, and where the saving goes. Raising the rate must leave every
// assertion here true.
//
// ⚠ THE THRESHOLDS ARE FIXED — WC $2M, GL $2M, Property $5M — AND READ FROM NO
// TOWER, so this gate no longer asserts that the tower takes none of the saving.
// That equality was true only while the threshold sat at the retention. It now
// asserts three things instead: the thresholds ARE those values and
// riskControlPrograms.ts reads no tower (section 1b); the tower's share of the
// saving is EXACTLY what the band between a line's retention and its threshold
// predicts, claim by claim — and on Property, where the two coincide, stays
// inside 2% (section 6); and against a $2M retention the share closes back inside
// that bound, which is the accepted leak ending (section 6). Section 7 makes each
// of them fail on purpose.
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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { occurrenceTotals, cedeOccurrences, cedeToLayer } from '../../src/utils/reinsuranceTower';
import { FULL_OCCURRENCE_PLACEMENT, REINSURANCE_TOWER, TOWER_TOP } from '../../src/data/reinsuranceTower';
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
console.log('CLAIMS SYSTEM — below its fixed thresholds, and nothing else');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years, all three lines. rate ${(100 * R).toFixed(1)}% at full effect.`);
console.log(`thresholds: ${LINES.map(l => `${l} $${(CLAIMS_SYSTEM_THRESHOLD[l] / 1e6).toFixed(0)}M`).join('  ')}`);
console.log(`retentions: ${LINES.map(l => `${l} $${(REINSURANCE_TOWER[l as TowerLine][0].attachment / 1e6).toFixed(0)}M`).join('  ')}\n`);

// THE FIXED THRESHOLDS, written here as literals on purpose: this gate is the
// second place they are written, and the one that fails when the first moves.
const FIXED_THRESHOLDS: Record<CoverageLine, number> = { WC: 2_000_000, GL: 2_000_000, Property: 5_000_000 };
const thresholdsOk = (t: Record<CoverageLine, number>) => LINES.every(l => t[l] === FIXED_THRESHOLDS[l]);
// Does riskControlPrograms.ts READ a tower? Comments are stripped first — the file
// is full of prose about the tower and the question is about code.
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const readsTower = (t: string) => /REINSURANCE_TOWER|reinsuranceTower|TOWER_TOP|towerMoments/.test(stripComments(t));
const PROGRAMS_SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/utils/riskControlPrograms.ts'), 'utf8');

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

// --- 1b. THE THRESHOLDS ARE FIXED AND READ FROM NO TOWER ---------------------
console.log('\n--- 1b. the thresholds: fixed values, and no tower behind them ---');
{
  ok(thresholdsOk(CLAIMS_SYSTEM_THRESHOLD),
    `thresholds are ${JSON.stringify(CLAIMS_SYSTEM_THRESHOLD)}, wanted ${JSON.stringify(FIXED_THRESHOLDS)}`);
  ok(!readsTower(PROGRAMS_SRC),
    'riskControlPrograms.ts reads a tower — the claims system would move with the retention a package sets');
  console.log(`   ${JSON.stringify(CLAIMS_SYSTEM_THRESHOLD)}, and riskControlPrograms.ts reads no tower: OK`);
}

// --- 2. THE RULE, IN ISOLATION --------------------------------------------
console.log('\n--- 2. the rule: strictly below, exact factor, monotone ---');
for (const line of LINES) {
  const T = CLAIMS_SYSTEM_THRESHOLD[line];
  ok(claimsSystemAdjusted(line, T, R) === T, `${line}: a claim AT the threshold was reduced`);
  ok(claimsSystemAdjusted(line, T * 1.5, R) === T * 1.5, `${line}: a claim above the threshold was reduced`);
  ok(Math.abs(claimsSystemAdjusted(line, T * 0.5, R) - T * 0.5 * (1 - R)) < 1e-9,
    `${line}: a claim below the threshold was not cut by exactly the rate`);
  ok(claimsSystemAdjusted(line, T * 0.999, R) < T, `${line}: a reduced claim crossed the threshold upward`);
  ok(claimsSystemAdjusted(line, T * 0.5, 0) === T * 0.5, `${line}: a zero reduction moved a claim`);
}
console.log('   at the threshold untouched, above untouched, below cut exactly, zero is a no-op: OK');

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
  ok(aboveMoved === 0, `${aboveMoved} claims AT OR ABOVE the threshold moved`);
  ok(wrongFactor === 0, `${wrongFactor} below-threshold claims were not cut by exactly the rate`);
  ok(below > 0 && above > 0, `the sample has ${below} below and ${above} above — both must be non-empty to mean anything`);
  ok(grossOn < grossOff, 'gross did not fall at all');
  console.log(`   ${below} below the threshold (all cut by exactly ${(100 * R).toFixed(1)}%), ${above} at/above (none moved)`);
  console.log(`   gross $${(grossOff / 1e6).toFixed(1)}M -> $${(grossOn / 1e6).toFixed(1)}M, `
    + `saved $${(savedBelow / 1e6).toFixed(2)}M (${(100 * savedBelow / grossOff).toFixed(2)}% of gross)`);
}

// --- 6. WHERE THE SAVING GOES, ACCOUNTED FOR BY BAND ----------------------
console.log('\n--- 6. the tower: where the saving goes, accounted for by band ---');
// ⚠ THIS USED TO ASSERT THAT THE TOWER TAKES NONE OF THE SAVING (bound 2%), AND IT
// WAS TRUE ONLY BECAUSE THE THRESHOLD SAT AT THE RETENTION. It is replaced by an
// exact account of what the tower DOES take once the threshold is a fixed number:
//
//   a claim drawn below the retention          the pool keeps all of the cut
//   a claim drawn in [retention, threshold)    the tower takes min(claim - retention, rate x claim)
//   a claim drawn at or above the threshold    untouched
//
// On WC and GL every claim is its own occurrence, so the prediction is exact claim
// by claim and is compared to the tower's own cession, not to a restatement of it.
// On Property the threshold IS the retention, the band is empty, and the only way
// the tower takes anything is a multi-claim catastrophe occurrence — measured at
// 0.21% and bounded at 2%, as before.
const RETENTION = (l: CoverageLine) => REINSURANCE_TOWER[l as TowerLine][0].attachment;
const towerTakes = (claim: number, ret: number, T: number, rate: number) =>
  claim < ret || claim >= T ? 0 : Math.min(claim - ret, rate * claim);
const leak: Record<string, { measured: number; predicted: number; saved: number; atTwoM: number }> = {};
{
  const YRS = GAMES * YEARS;
  for (const line of LINES) {
    const ret = RETENTION(line), T = CLAIMS_SYSTEM_THRESHOLD[line];
    const top = TOWER_TOP[line as TowerLine];
    let measured = 0, predicted = 0, saved = 0, atTwoM = 0;
    for (const pl of played.filter(p => p.line === line)) {
      const off = redraw(pl, 0), on = redraw(pl, R);
      const placed = FULL_OCCURRENCE_PLACEMENT[line as TowerLine];
      const tOff = occurrenceTotals(off.claims, off.occurrences), tOn = occurrenceTotals(on.claims, on.occurrences);
      measured += cedeOccurrences(line as TowerLine, tOff, placed).totalCeded
        - cedeOccurrences(line as TowerLine, tOn, placed).totalCeded;
      // The same claims against a $2M retention: the leak should be gone.
      atTwoM += tOff.reduce((s, t) => s + cedeToLayer(t, 2_000_000, top - 2_000_000), 0)
        - tOn.reduce((s, t) => s + cedeToLayer(t, 2_000_000, top - 2_000_000), 0);
      saved += off.claims.reduce((s, c) => s + c.grossUltimate, 0) - on.claims.reduce((s, c) => s + c.grossUltimate, 0);
      if (line !== 'Property') for (const c of off.claims) predicted += towerTakes(c.grossUltimate, ret, T, R);
    }
    leak[line] = { measured, predicted, saved, atTwoM };
    const share = saved > 0 ? measured / saved : 0;
    const shareTwoM = saved > 0 ? atTwoM / saved : 0;
    if (line === 'Property') {
      ok(T === ret, `Property threshold $${T} is not its retention $${ret} — the 2% bound below assumes it is`);
      ok(Math.abs(share) < 0.02, `Property: the tower took ${(100 * share).toFixed(2)}% of the saving, bound 2%`);
    } else {
      ok(Math.abs(measured - predicted) <= 1e-6 * Math.max(1, saved),
        `${line}: the tower took ${measured.toFixed(0)} of the saving; the band [$${ret}, $${T}) predicts ${predicted.toFixed(0)}`);
      ok(Math.abs(shareTwoM) < 0.02,
        `${line}: against a $2M retention the tower still took ${(100 * shareTwoM).toFixed(2)}% of the saving, bound 2%`);
    }
    console.log(`   ${line.padEnd(8)} retention $${(ret / 1e6).toFixed(0)}M threshold $${(T / 1e6).toFixed(0)}M: `
      + `tower takes $${(measured / 1e6).toFixed(2)}M of a $${(saved / 1e6).toFixed(2)}M saving = ${(100 * share).toFixed(2)}% `
      + `($${(measured / YRS / 1e6).toFixed(2)}M a year)`
      + (line === 'Property' ? '' : `, band predicts $${(predicted / 1e6).toFixed(2)}M; against a $2M retention ${(100 * shareTwoM).toFixed(2)}%`));
  }
  const tm = LINES.reduce((s, l) => s + leak[l].measured, 0), ts = LINES.reduce((s, l) => s + leak[l].saved, 0);
  console.log(`   three lines: $${(tm / 1e6).toFixed(2)}M of $${(ts / 1e6).toFixed(2)}M = ${(100 * tm / ts).toFixed(2)}% to the reinsurer, `
    + `$${(tm / GAMES / YEARS / 1e6).toFixed(2)}M a year per pool (the accepted leak; reported, not bounded)`);
  // ⚠ THE COMPARISON FIGURE THAT USED TO SIT HERE (78.1%) WAS WRONG, and its
  // replacement is kept because it is the point of a SEVERITY cut. A uniform
  // FREQUENCY cut removes whole occurrences at random, so the tower's share of its
  // gross saving is 1 - sum min(O, retention) / sum O over the occurrences drawn,
  // on the ULTIMATE basis. Measured over 20 games x 5 years per line, solo:
  //
  //     WC        $1M retention   48,371 occurrences   tower takes 26.35%
  //     GL        $1M retention   31,813 occurrences   tower takes 46.07%
  //     Property  $5M retention    8,806 occurrences   tower takes 28.01%
  //
  // GL leaks 46.07% to a frequency cut. Even with its band leak a severity cut
  // below $2M gives GL's tower 21%, and below the retention ~0%.
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

  // (d) THE OLD ASSERTION CANNOT PASS AGAIN. The retention-coupled prediction says
  //     the tower takes nothing on WC and GL; the measurement says otherwise. If
  //     the band account in section 6 could not tell those two apart it would be
  //     testing nothing, so the old prediction is held against the measurement and
  //     must DISAGREE.
  for (const l of ['WC', 'GL'] as CoverageLine[]) {
    const oldPrediction = 0;
    ok(Math.abs(leak[l].measured - oldPrediction) > 1e-6 * Math.max(1, leak[l].saved),
      `CONTROL DID NOT FIRE: the retention-coupled prediction (tower takes nothing) matched ${l}'s measurement, `
      + 'so section 6 cannot tell a fixed threshold from a coupled one');
  }
  // (e) THE DECOUPLING CHECK FIRES ON A COUPLED SOURCE. The real file passed it in
  //     section 1b; a file that reads the tower must not.
  const coupled = `import { REINSURANCE_TOWER } from '../data/reinsuranceTower';
export const CLAIMS_SYSTEM_THRESHOLD = { WC: REINSURANCE_TOWER.WC[0].attachment };`;
  ok(readsTower(coupled), 'CONTROL DID NOT FIRE: the old coupled source was not recognised as reading a tower');
  ok(!readsTower('// REINSURANCE_TOWER appears only in this comment\nexport const X = 1;'),
    'CONTROL DID NOT FIRE: a comment mentioning the tower was treated as code');
  // (f) THE THRESHOLD CHECK FIRES ON A WRONG VALUE.
  ok(!thresholdsOk({ WC: 1_000_000, GL: 2_000_000, Property: 5_000_000 }),
    'CONTROL DID NOT FIRE: WC at $1M (the old coupled value) passed the fixed-threshold check');
  ok(!thresholdsOk({ WC: 2_000_000, GL: 2_000_000, Property: 2_000_000 }),
    'CONTROL DID NOT FIRE: Property at $2M passed the fixed-threshold check');
  console.log('   the retention-coupled prediction disagrees with the measurement, a coupled source is recognised,');
  console.log('   and a wrong threshold fails the fixed-value check: OK');
}

console.log(`\n${RULE}`);
if (failed.length) {
  console.log(`FAIL — ${failed.length} problem(s):`);
  for (const f of failed) console.log(`  ${f}`);
  console.log(RULE);
  process.exit(1);
}
console.log('THE CLAIMS SYSTEM REACHES CLAIMS BELOW ITS FIXED THRESHOLDS AND NOTHING ELSE.');
console.log(RULE);
