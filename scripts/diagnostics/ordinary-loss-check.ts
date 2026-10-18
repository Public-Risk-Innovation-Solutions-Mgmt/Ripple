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
//   1. THE YEAR FACTOR, DIRECTLY. Across 400,000 draws per line, the mean is
//      1 and the CV is ORDINARY_LOSS_CV, each within four standard errors.
//      This is the distribution on its own, at a sample large enough to see a
//      missing -sigma^2/2 (a 2.4e-4 bias, about seven standard errors here).
//   2. THROUGH THE LABELLED STREAM. The same two moments over 6,000 instance
//      seeds x 10 accident years, drawn by ordinaryLossYear itself — so the
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

import { MEMBER_LEVEL, ORDINARY_LOSS_CV } from '../../src/data/pricingParameters';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { drawOrdinaryFactor, ordinaryLossRng, ordinaryLossYear } from '../../src/utils/ordinaryLoss';
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
  console.log('\n--- 1. THE YEAR FACTOR, 400,000 draws per line ---');
  for (const line of LINES) {
    const rng = new SeededRandom(9_100_000 + LINES.indexOf(line));
    const xs = Array.from({ length: 400_000 }, () => drawOrdinaryFactor(rng, ORDINARY_LOSS_CV[line]));
    const m = moments(xs);
    check(Math.abs(m.mean - 1) < Z * m.seMean, `${line}: mean factor is 1`,
      `${m.mean.toFixed(6)} (${((m.mean - 1) / m.seMean).toFixed(2)} SE)`);
    check(Math.abs(m.cv - ORDINARY_LOSS_CV[line]) < Z * m.seCv, `${line}: CV is ${ORDINARY_LOSS_CV[line]}`,
      `${m.cv.toFixed(6)} (${((m.cv - ORDINARY_LOSS_CV[line]) / m.seCv).toFixed(2)} SE)`);
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 2. THROUGH THE LABELLED STREAM, 6,000 seeds x 10 years ---');
  // A fixed synthetic book, so the ratio isolates the draw: one member's
  // worth of exposure is enough, because the factor does not depend on it.
  const book = getPredefinedMarketMembers().slice(0, 40);
  for (const line of LINES) {
    const ratios: number[] = [];
    for (let s = 0; s < 6_000; s++) {
      for (let y = 1; y <= 10; y++) {
        const o = ordinaryLossYear(line, book, y, 1_000_000 + s * 7919);
        if (o.expected > 0) ratios.push(o.realised / o.expected);
      }
    }
    const m = moments(ratios);
    check(Math.abs(m.mean - 1) < Z * m.seMean, `${line}: realised / expected averages 1`,
      `${m.mean.toFixed(6)} over ${m.n} (${((m.mean - 1) / m.seMean).toFixed(2)} SE)`);
    check(Math.abs(m.cv - ORDINARY_LOSS_CV[line]) < Z * m.seCv, `${line}: and its CV is the parameter`,
      `${m.cv.toFixed(6)} (${((m.cv - ORDINARY_LOSS_CV[line]) / m.seCv).toFixed(2)} SE)`);
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
        // 4. the draw's own scale, recomputed from the same stream
        const factor = drawOrdinaryFactor(ordinaryLossRng(instance.seed, y, line), ORDINARY_LOSS_CV[line]);
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
  const members = getPredefinedMarketMembers();
  for (const line of LINES) {
    const moms = allLayerRiskMoments(line as never, members, 0);
    const exp = moms.reduce((s, m) => s + m.expected, 0);
    check(exp === 0, `${line}: ordinary losses only, so expected recovery and its price are zero`,
      `$${exp.toFixed(2)} across ${moms.length} layer(s), year 0`);
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
