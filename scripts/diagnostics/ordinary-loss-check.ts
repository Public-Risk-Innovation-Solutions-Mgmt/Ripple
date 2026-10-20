// ============================================================================
// THE NEW LOSS ENGINE'S ORDINARY LOSSES: THE MEAN IS EXPECTED AND THE CV IS
// THE PARAMETER, AND NOTHING ELSE IS HELD.
//
//   npx tsx scripts/diagnostics/ordinary-loss-check.ts
//
// Runs with MEMBER_LEVEL held OFF, so the new loss engine runs, restored in a
// `finally` — safe only
// because every gate runs in its own process.
//
// WHAT IT ASSERTS, in order:
//
//   1. THE TWO FACTORS, DIRECTLY. Across 400,000 draws each, the mean is 1
//      and the CV is UNIT_ORDINARY_YEAR_CV / UNIT_ORDINARY_OWN_CV, each within
//      four standard errors (book units commit 3; it was one 2.2% factor).
//      This is the distribution on its own, at a sample large enough to see a
//      missing -sigma^2/2 (a 2.4e-4 bias, about seven standard errors here).
//   2. THROUGH THE LABELLED STREAMS. The line's two moments over 6,000 instance
//      seeds x 10 accident years on a fixed book, drawn by ordinaryLossFromUnits — so the
//      stream keying, the trend and the exposure scaling are in the loop.
//   3. THROUGH THE ENGINE. Played games, flag on: ORDINARY actual over
//      ordinary expected per line-year — the uplift in force taken out —
//      averages to 1 within its confidence interval. From commit 2 the line
//      also carries shocks and large losses, so the ordinary component is
//      read off the year's NewLossEngineRecord rather than the line total.
//   4. EXPECTED IS THE DRAW'S OWN SCALE. On every line-year the ordinary
//      actual over expected IS the factor its labelled stream draws — to float
//      precision. That is the whole of "no separate held figure". And the
//      record adds up: ordinary + T + routine excess is the line's gross, the
//      members' records sum to it, and a year with no large loss recovers
//      nothing from the tower — ordinary losses sit below every attachment.
//   5. THE REINSURANCE RULE WHERE ONLY ORDINARY LOSSES CAN ARISE. Before year
//      1 nothing fires and (routine large losses off) the expected recovery,
//      and so the price, is zero. Where large losses arise, shock-loss-check
//      holds the deduction to the recovery.
//
// ⚠ AND IT FAILS WHEN BROKEN — see THE CONTROL at the foot.
// ============================================================================

import { MEMBER_LEVEL, ROUTINE_LARGE_LOSSES, UNIT_ORDINARY_OWN_CV, UNIT_ORDINARY_YEAR_CV } from '../../src/data/pricingParameters';
import { newEngineLayerMoments } from '../../src/utils/shockExpectation';
import { bookExposureOf } from '../../src/utils/lineHelpers';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { bookOrdinaryCv, drawOrdinaryFactor, ordinaryLossFromUnits } from '../../src/utils/ordinaryLoss';
import { marketSeedOf, openingBookUnits, unitsOf } from '../../src/utils/bookUnits';
import { allLayerRiskMoments } from '../../src/utils/towerMoments';
import { SeededRandom } from '../../src/utils/random';
import { getPredefinedMarketMembers } from '../../src/data/memberCatalog';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const RULE = '='.repeat(78);
const failed: string[] = [];
let checks = 0;
function check(ok: boolean, label: string, detail = '') {
  checks++;
  if (!ok) failed.push(`${label}${detail ? '  — ' + detail : ''}`);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}

/** Mean, CV and their standard errors from a sample. */
function moments(xs: number[]) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const cv = sd / mean;
  // SE of the mean is sd/sqrt(n); SE of a near-normal sample SD is about
  // sd/sqrt(2(n-1)), and the CV's SE follows it at mean ~ 1.
  return { n, mean, cv, seMean: sd / Math.sqrt(n), seCv: cv / Math.sqrt(2 * (n - 1)) };
}

const Z = 4;
// The new loss engine runs whenever MEMBER_LEVEL is off; held off here even
// if a caller imported the member path.
const was = MEMBER_LEVEL.enabled;
try {
  MEMBER_LEVEL.enabled = false;

  console.log(RULE);
  console.log('ORDINARY LOSSES — mean equals expected, CV equals the parameter');
  console.log(RULE);

  // --------------------------------------------------------------------------
  // ⚠ TWO FACTORS SINCE BOOK UNITS COMMIT 3 — the year factor every unit
  // shares and each unit's own (ordinaryLossFromUnits). Both checked here as
  // distributions; book-units-ordinary-check holds the line and each unit to
  // the closed form.
  console.log('\n--- 1. THE TWO FACTORS, 400,000 draws each ---');
  for (const [name, cv] of [['year', UNIT_ORDINARY_YEAR_CV], ['unit', UNIT_ORDINARY_OWN_CV]] as const) {
    const rng = new SeededRandom(9_100_000 + (name === 'year' ? 0 : 1));
    const xs = Array.from({ length: 400_000 }, () => drawOrdinaryFactor(rng, cv));
    const m = moments(xs);
    check(Math.abs(m.mean - 1) < Z * m.seMean, `${name} factor: mean is 1`,
      `${m.mean.toFixed(6)} (${((m.mean - 1) / m.seMean).toFixed(2)} SE)`);
    check(Math.abs(m.cv - cv) < Z * m.seCv, `${name} factor: CV is ${cv}`,
      `${m.cv.toFixed(6)} (${((m.cv - cv) / m.seCv).toFixed(2)} SE)`);
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 2. THROUGH THE LABELLED STREAMS, 6,000 seeds x 10 years ---');
  // One fixed book of units per line, so the ratio isolates the draw; its CV
  // is that book's own (bookOrdinaryCv).
  for (const line of LINES) {
    const units = unitsOf(4_242_424, line, openingBookUnits(4_242_424, line));
    const want = bookOrdinaryCv(units);
    const ratios: number[] = [];
    for (let s = 0; s < 6_000; s++) {
      for (let y = 1; y <= 10; y++) {
        const o = ordinaryLossFromUnits(line, units, 100, y, 1_000_000 + s * 7919);
        if (o.expected > 0) ratios.push(o.realised / o.expected);
      }
    }
    const m = moments(ratios);
    check(Math.abs(m.mean - 1) < Z * m.seMean, `${line}: realised / expected averages 1`,
      `${m.mean.toFixed(6)} over ${m.n} (${((m.mean - 1) / m.seMean).toFixed(2)} SE)`);
    check(Math.abs(m.cv - want) < Z * m.seCv, `${line}: and its CV is the book's own`,
      `${m.cv.toFixed(6)} against ${want.toFixed(6)} (${((m.cv - want) / m.seCv).toFixed(2)} SE)`);
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 3 & 4. THROUGH THE ENGINE, 12 games x 10 years ---');
  const ae: Record<string, number[]> = { WC: [], GL: [], Property: [] };
  let worstScale = 0, ceded = 0, lineYears = 0;
  let quietCeded = 0, quietYears = 0, worstRecord = 0, bookYears = 0;
  for (let g = 0; g < 12; g++) {
    const id = `ORDCHK${g}`;
    const instance = generateGameInstance(id, 2_700_000 + g * 7919);
    const setup = { poolName: 'Ord', gameLength: 11, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= 10; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      for (const line of LINES) {
        const r = p.result.byLine[line];
        const n = r?.newLossEngine;
        if (!r || !n || !(n.ordinaryExpected > 0)) continue;
        lineYears++;
        // 3. ordinary actual over ordinary expected, the uplift in force taken out
        const ratio = n.ordinaryRealised / (n.ordinaryExpected * (1 + n.uplift));
        ae[line].push(ratio);
        // 4. the draw's own scale, recomputed from the same streams on the
        // game's book — scale-free, so any exposure gives the factor
        const units = unitsOf(marketSeedOf(instance), line, gs.poolState.bookUnits?.[line] ?? []);
        const factor = ordinaryLossFromUnits(line, units, 100, y, instance.seed).factor;
        worstScale = Math.max(worstScale, Math.abs(ratio / factor - 1), Math.abs(n.ordinaryFactor / factor - 1));
        // the record adds up to the line's gross: ordinary + T + routine excess
        worstRecord = Math.max(worstRecord,
          Math.abs((n.ordinaryRealised + n.shockLarge + n.routineLarge) / r.grossUltimateLoss - 1));
        // A BOOK carries no member records at all — the line is the record.
        if (r.memberLossResults.length === 0) bookYears++;
        // ordinary losses cede nothing: a year with no large loss recovers nothing per occurrence
        if (n.shockLargeClaims === 0 && n.routineLargeClaims === 0) {
          quietYears++;
          quietCeded += r.cededByLayer.reduce((a, b) => a + Math.abs(b), 0);
        }
        ceded += Math.abs(r.reinsuranceRecovery);
      }
      gs = {
        ...gs, poolState: p.updatedPoolState, currentYearNumber: y + 1,
        currentDecisions: defaultDecisionSet(y + 1), lockedResults: [...gs.lockedResults, p.result],
      };
    }
  }
  for (const line of LINES) {
    const m = moments(ae[line]);
    check(Math.abs(m.mean - 1) < Z * m.seMean, `${line}: ordinary actual / expected through the engine averages 1`,
      `${m.mean.toFixed(4)} over ${m.n} line-years (${((m.mean - 1) / m.seMean).toFixed(2)} SE)`);
  }
  check(worstScale < 1e-9, 'expected IS the draw\'s own scale: ordinary actual / expected == the stream\'s factor',
    `worst relative ${worstScale.toExponential(2)} on ${lineYears} line-years`);
  check(worstRecord < 1e-9, 'ordinary + T + routine excess IS the line\'s gross',
    `worst relative ${worstRecord.toExponential(2)}`);
  check(bookYears === lineYears, 'one book per line: no member records on any line-year',
    `${bookYears} of ${lineYears} line-years carry none`);
  check(quietYears > 0 && quietCeded === 0, 'ordinary losses cede nothing: no occurrence recovery in a year without a large loss',
    `$${quietCeded.toFixed(2)} over ${quietYears} quiet line-years (all years: $${(ceded / 1e6).toFixed(1)}M, from large losses)`);

  // --------------------------------------------------------------------------
  console.log('\n--- 5. THE REINSURANCE RULE, WHERE ONLY ORDINARY LOSSES CAN ARISE ---');
  // Before year 1 nothing fires, and with routine large losses off the only
  // losses are ordinary — so the expected recovery the rate deducts and the
  // price is struck on must be zero there. Where large losses can arise,
  // shock-loss-check holds the deduction to the recovery.
  //
  // ⚠ ROUTINE LARGE LOSSES ARE HELD OFF FOR THIS SECTION, because they are ON
  // in the game since Prompt A commit 1 and they arrive in every year, the
  // pre-game included — so with them on, year 0 is not a year of ordinary
  // losses only and its recovery is rightly not zero. The rule this section
  // states is about ordinary losses, so it is asked where they are alone.
  const routineWas = ROUTINE_LARGE_LOSSES.enabled;
  try {
    ROUTINE_LARGE_LOSSES.enabled = false;
    // ⚠ AND THE PRICE IS NOT THE LOSSES (Prompt A commit 2). A price is struck
    // ex ante on the catalogue's probabilities in every year, the pre-game
    // included, so year 0's TOWER PRICE is the shocks' cover and is not zero.
    // What ordinary losses alone cede is asked with exAnte off: nothing.
    const members = getPredefinedMarketMembers();
    for (const line of LINES) {
      const exposure = bookExposureOf(members, line, 0);
      const actual = newEngineLayerMoments(line as never, exposure, 0, 1, false).reduce((s, m) => s + m.expected, 0);
      check(actual === 0, `${line}: ordinary losses only, so the year's expected recovery is zero`,
        `$${actual.toFixed(2)}, year 0, routine large losses held off`);
      const priced = allLayerRiskMoments(line as never, members, 0).reduce((s, m) => s + m.expected, 0);
      check(priced > 0, `${line}: and the year is still PRICED ex ante, on the catalogue's shocks`,
        `$${(priced / 1e6).toFixed(3)}M expected recovery priced at year 0`);
    }
  } finally {
    ROUTINE_LARGE_LOSSES.enabled = routineWas;
  }
} finally {
  MEMBER_LEVEL.enabled = was;
}

console.log(`\n${RULE}`);
if (failed.length === 0) {
  console.log(`ORDINARY LOSSES ARE WHAT THEY SAY. ${checks} checks.`);
} else {
  console.log(`${failed.length} FAILURE(S) of ${checks}:`);
  for (const f of failed) console.log(`  - ${f}`);
}
console.log(RULE);

// ============================================================================
// ⚠ THE CONTROL — RUN AND RECORDED. Each break applied alone, the gate run,
// the code restored and the gate green again.
//
//   1. DROP -sigma^2/2 (mu = 0 in ordinaryFactorParams, so E[F] = 1 + cv^2/2):
//      EXIT 1 — section 1's mean fails on every line, WC 1.000301 (8.64 SE),
//      GL 1.000241 (6.94 SE), Property 1.000220 (6.32 SE).
//   2. DOUBLE THE CV (sigma^2 = ln(1 + 4cv^2)): EXIT 1 — sections 1 and 2's
//      CV checks fail on every line, 0.0440 against 0.022 (about 447 SE in
//      section 1, 174 SE in section 2).
//   3. HOLD A SEPARATE EXPECTED (ordinaryLossYear reports expected x 1.01,
//      the draw unchanged): EXIT 1 — section 2 at about -111 SE on every
//      line, and through the engine section 3 (WC -6.37 SE) and section 4,
//      where actual over expected stops being the stream's factor. Re-run at
//      commit 2, after sections 3-5 moved to the ordinary component; 1 and 2
//      read exactly as before.
// ============================================================================
process.exit(failed.length === 0 ? 0 : 1);
