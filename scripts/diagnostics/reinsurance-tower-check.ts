// Verification for the per-occurrence tower — ON THE NEW ENGINE (book mode,
// MEMBER_LEVEL off), as the game runs.
//
//   npx tsx scripts/diagnostics/reinsurance-tower-check.ts
//
// ============================================================================
// FORKED FROM reinsurance-tower-member-check, which is dormant with the old
// member engine. The same subjects, on a book: the tower prices off a book's
// exposure ({ exposure }) where the member gate built a roster, and the live
// games cede the new engine's large losses.
//
//   1. claimContribution collapses to grossUltimate on both lines.
//   2. Erosion and corridor retention fall out of the cession arithmetic.
//   3. The tower's shape and price: the risk load in its regime, GL's top layer
//      dearer than WC's, equal layer counts, the $5M xs $10M top band charged
//      when placed.
//   4. The (unwired) aggregate's price responds to the occurrence layers placed,
//      and falls per $100 as the book grows.
//   5. The price is not a function of the funding confidence level.
//   6. A live game: ceded never exceeds the occurrences, a layer the default
//      package leaves out cedes nothing — while the same games on the full tower
//      DO cede through it, so the check is not vacuous — a declined Property
//      tower costs and recovers nothing, and the aggregate is unwired.
//
// ⚠ AND EACH FAILS WHEN BROKEN — every assertion is a predicate, and THE
// CONTROLS feed each one the figures it guards against.
// ============================================================================

import {
  AGG_ATTACHMENT_LEVELS, REINSURANCE_TOWER, RISK_LOAD_LAMBDA, TOWER_TOP,
} from '../../src/data/reinsuranceTower';
import {
  cedeOccurrences, claimContribution, layerMask, layerPremium,
  normalizeAggregateStopLevel, occurrenceProgramCost, occurrenceTotals, quoteAggregate,
} from '../../src/utils/reinsuranceTower';
import { layerRiskMoments } from '../../src/utils/towerMoments';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { fullTowerOption } from '../../src/utils/reinsuranceOptions';
import { MEMBER_LEVEL } from '../../src/data/pricingParameters';
import type { Claim, CoverageLine, DecisionSet, GameState, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const REF_YEAR = 1;
// A book of `m` $M of the line's exposure. The member gate took ~$290M of
// roster; the same size here, as the exposure itself.
const book = (m: number) => ({ exposure: m });
const perHundred = (premium: number, m: number) => premium / (m * 1e4);

const failed: string[] = [];
const RULE = '='.repeat(72);
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failed.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const fmt$ = (x: number) => (Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : `$${(x / 1e3).toFixed(1)}k`);
const seedOf = (id: string) => { let h = 5381; for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; } return h; };

function play(id: string, years: number, mutate?: (d: DecisionSet, y: number) => DecisionSet): ResultSet[] {
  const instance = generateGameInstance(id, seedOf(id));
  const setup = { poolName: 'G', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
  for (let y = 1; y <= years; y++) {
    const d = mutate ? mutate(defaultDecisionSet(y), y) : defaultDecisionSet(y);
    const p = processYear(gs, d);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
  }
  return gs.lockedResults;
}
const withOption = (pick: (l: CoverageLine) => DecisionSet['byLine'][CoverageLine]['reinsuranceOption']) =>
  (d: DecisionSet): DecisionSet => ({
    ...d, byLine: Object.fromEntries(LINES.map(l => [l, { ...d.byLine[l], reinsuranceOption: pick(l) }])) as DecisionSet['byLine'],
  });

// ---------------------------------------------------------------- predicates
const corridorGivesUpBand = (all: number, corridor: number) => Math.abs((all - corridor) - 5e6) < 1;
const loadInRegime = (mults: number[]) => (RISK_LOAD_LAMBDA > 0
  ? mults.every((m, i) => i === 0 || m > mults[i - 1])
  : mults.every(m => Math.abs(m - 1) < 1e-12));
const respondsToPlacement = (ratio: number) => ratio > 1.0;
const flatAcrossClf = (costs: number[]) => Math.abs(costs[1] / costs[0] - 1) < 0.02;
const unplacedLayerSilent = (byLayer: number[], unplaced: number) => byLayer[unplaced] === 0;
const declinedSilent = (rows: { reinsuranceCost: number; reinsuranceRecovery: number; aggregateRecovery?: number }[]) =>
  rows.every(r => r.reinsuranceCost === 0 && r.reinsuranceRecovery === 0 && (r.aggregateRecovery ?? 0) === 0);

check(!MEMBER_LEVEL.enabled, 'running on the new engine (MEMBER_LEVEL off)');

console.log('\n=== 1. claimContribution COLLAPSES TO grossUltimate ON BOTH LINES ===');
{
  const mk = (grossUltimate: number, line: CoverageLine): Claim => ({
    id: 'c', occurrenceId: 'o', memberId: 'm', line, accidentYear: 1, calendarYear: 2026,
    tier: 'component1', status: 'open', reportedYear: 1, grossUltimate,
    paidToDate: 0, caseReserve: grossUltimate,
  });
  check(claimContribution(mk(5.9e6, 'GL')) === 5.9e6, '1. a GL claim contributes its grossUltimate');
  check(claimContribution(mk(9e6, 'WC')) === 9e6, '1. a WC claim contributes its grossUltimate');
}

console.log('\n=== 2. EROSION AND CORRIDOR RETENTION FALL OUT OF THE ARITHMETIC ===');
const all12 = cedeOccurrences('WC', [12e6], [true, true, true]);
const corridor12 = cedeOccurrences('WC', [12e6], [true, false, true]);
{
  const none = cedeOccurrences('WC', [12e6], [false, false, false]);
  console.log(`  $12M occurrence: all three layers cede ${fmt$(all12.totalCeded)}, corridor ${fmt$(corridor12.totalCeded)}, none ${fmt$(none.totalCeded)}`);
  check(Math.abs(all12.totalCeded - 11e6) < 1, '2. all three layers cede 4 + 5 + 2 = $11M of a $12M occurrence');
  check(corridorGivesUpBand(all12.totalCeded, corridor12.totalCeded), '2. a corridor gives up exactly the skipped $5M band');
  check([all12, corridor12, none].every(c => Math.abs(c.retained + c.totalCeded - 12e6) < 1e-6), '2. retained + ceded = gross');
  const big = cedeOccurrences('GL', [60e6], [true, true, true]);
  check(Math.abs(big.retainedAboveTower - (60e6 - TOWER_TOP.GL)) < 1, '2. a GL $60M occurrence keeps everything above the tower top');
}

console.log(`\n=== 3. THE TOWER'S SHAPE AND PRICE (risk load ${RISK_LOAD_LAMBDA > 0 ? 'rising with attachment' : 'zero — every layer at 1.00x'}) ===`);
const multsOf = (line: 'WC' | 'GL') => REINSURANCE_TOWER[line].map((_l, i) => 1 + RISK_LOAD_LAMBDA * layerRiskMoments(line, i, book(290), REF_YEAR).sdOverExpected);
{
  for (const line of ['WC', 'GL'] as const) {
    const mults = multsOf(line);
    console.log(`  ${line}: ${REINSURANCE_TOWER[line].map((l, i) => `${l.name} ${mults[i].toFixed(2)}x`).join('  ')}`);
    check(loadInRegime(mults), `3. ${line}'s load multiples are right for lambda ${RISK_LOAD_LAMBDA}`);
  }
  const glTop = perHundred(layerPremium('GL', 2, book(290), REF_YEAR), 290);
  const wcTop = perHundred(layerPremium('WC', 2, book(290), REF_YEAR), 290);
  check(glTop > wcTop, '3. GL\'s top layer is dearer per $100 than WC\'s', `${glTop.toFixed(5)} vs ${wcTop.toFixed(5)}`);
  check(REINSURANCE_TOWER.WC.length === REINSURANCE_TOWER.GL.length, '3. WC and GL carry the same number of layers');
  check(REINSURANCE_TOWER.WC.every(l => l.purchasable), '3. every WC layer is purchasable');
  check(REINSURANCE_TOWER.WC[2].attachment === 10e6 && REINSURANCE_TOWER.WC[2].limit === 5e6 && TOWER_TOP.WC === 15e6,
    '3. the top band is $5M xs $10M and the tower top $15M');
  check(occurrenceProgramCost('GL', [false, false, true], book(290), REF_YEAR).premium > 0, '3. the top layer is charged when placed');
  check(layerMask([true, false, true]) === 5, '3. layerMask is little-endian (layer 0 = bit 0)');
}

console.log('\n=== 4. THE AGGREGATE RESPONDS TO THE OCCURRENCE LAYERS PLACED ===');
const aggRatios: number[] = [];
{
  const EGROSS = 12.83e6;
  const allW = REINSURANCE_TOWER.WC.map(l => l.purchasable), noneW = REINSURANCE_TOWER.WC.map(() => false);
  for (let lv = 0; lv < AGG_ATTACHMENT_LEVELS.WC.length; lv++) {
    const qa = quoteAggregate('WC', allW, book(290), EGROSS, lv, REF_YEAR);
    const qn = quoteAggregate('WC', noneW, book(290), EGROSS, lv, REF_YEAR);
    const ratio = qn.premium / Math.max(qa.premium, 1);
    aggRatios.push(ratio);
    check(respondsToPlacement(ratio), `4. at a ${(AGG_ATTACHMENT_LEVELS.WC[lv] * 100).toFixed(0)}% attachment, declining every layer raises the price`,
      `${fmt$(qa.premium)} -> ${fmt$(qn.premium)} (x${ratio.toFixed(2)})`);
  }
  const small = perHundred(quoteAggregate('WC', allW, book(145), EGROSS / 2, 1, REF_YEAR).premium, 145);
  const big = perHundred(quoteAggregate('WC', allW, book(580), EGROSS * 2, 1, REF_YEAR).premium, 580);
  check(big < small, '4. the aggregate\'s price per $100 falls as the book grows', `${small.toFixed(5)} at $145M, ${big.toFixed(5)} at $580M`);
}

console.log('\n=== 5. THE PRICE IS NOT A FUNCTION OF THE FUNDING CONFIDENCE LEVEL ===');
const clfCosts = [0.60, 0.85].map(clf => play('CLFTEST', 1, d => ({
  ...d, byLine: { ...d.byLine, WC: { ...d.byLine.WC, fundingConfidenceLevel: clf, fundingAtExpected: false } },
}))[0].byLine.WC.reinsuranceCost);
check(flatAcrossClf(clfCosts), '5. WC reinsurance cost is flat between 60% and 85% confidence',
  `${fmt$(clfCosts[0])} vs ${fmt$(clfCosts[1])}`);

console.log('\n=== 6. LIVE GAMES: ceded reconciles; a layer not bought cedes nothing ===');
const GAMES = ['TWR0', 'TWR1', 'TWR2', 'TWR3', 'TWR4', 'TWR5', 'TWR6', 'TWR7'];
const byLayerOf = (rows: ResultSet[], line: 'WC' | 'GL') => rows.reduce((acc, r) => {
  r.byLine[line].cededByLayer.forEach((v, i) => { acc[i] += v; });
  return acc;
}, REINSURANCE_TOWER[line].map(() => 0));
const defaults = GAMES.flatMap(id => play(id, 10));
const fulls = GAMES.flatMap(id => play(id, 10, withOption(fullTowerOption)));
const declined = GAMES.slice(0, 2).flatMap(id => play(`${id}-DECLINE`, 5, d => ({
  ...d, byLine: { ...d.byLine, Property: { ...d.byLine.Property, reinsuranceOption: 'none' } },
})));
{
  for (const line of ['WC', 'GL'] as const) {
    let ceded = 0, gross = 0, occ = 0;
    for (const r of defaults) {
      const lr = r.byLine[line];
      gross += occurrenceTotals(lr.claims ?? [], lr.occurrences ?? []).reduce((a, b) => a + b, 0);
      ceded += lr.cededByLayer.reduce((a, b) => a + b, 0);
      occ += (lr.occurrences ?? []).length;
    }
    const d = byLayerOf(defaults, line), f = byLayerOf(fulls, line);
    console.log(`  ${line}: ${occ} occurrences over ${defaults.length} years; default package by layer ${d.map(fmt$).join(' | ')}; full tower ${f.map(fmt$).join(' | ')}`);
    check(occ > 0 && ceded <= gross + 1, `6. ${line}: ceded never exceeds the occurrences`, `${fmt$(ceded)} of ${fmt$(gross)}`);
    check(unplacedLayerSilent(d, 2), `6. ${line}: $5M xs $10M, outside the default package, cedes nothing`);
  }
  // Not vacuous: the same games on the full tower cede through that layer.
  const fullTop = byLayerOf(fulls, 'WC')[2] + byLayerOf(fulls, 'GL')[2];
  check(fullTop > 0, '6. the same games on the full tower DO cede through $5M xs $10M', fmt$(fullTop));
  const pr = defaults[0].byLine.Property;
  check(pr.cededByLayer.length === REINSURANCE_TOWER.Property.length, '6. Property is on the tower');
  check(declinedSilent(declined.map(r => r.byLine.Property)), '6. a declined Property tower costs and recovers nothing, every year');
  const unwired = fulls.every(r => LINES.every(l => (r.byLine[l].aggregatePremium ?? 0) === 0 && (r.byLine[l].aggregateRecovery ?? 0) === 0));
  check(unwired, '6. the aggregate is unwired: on the full tower it prices and pays nothing');
  check(normalizeAggregateStopLevel('Property', [true], 1) === 1 && normalizeAggregateStopLevel('Property', [false], 1) === -1
    && normalizeAggregateStopLevel('WC', [false, false, false], 1) === -1 && normalizeAggregateStopLevel('WC', [false, true, false], 1) === 1,
  '6. the aggregate\'s gate: one placed layer enables it, none disables it');
}

// ---------------------------------------------------------------- controls
console.log('\nCONTROLS — each must be caught');
check(!corridorGivesUpBand(all12.totalCeded, all12.totalCeded), 'control: a corridor that skips nothing is caught by 2');
check(!loadInRegime(RISK_LOAD_LAMBDA > 0 ? [1.2, 1.1, 1.3] : [1, 1.05, 1]), 'control: a load the regime does not allow is caught by 3');
check(!respondsToPlacement(1.0), 'control: an aggregate price that ignores the layers placed is caught by 4');
check(!flatAcrossClf([clfCosts[0], clfCosts[0] * 1.69]), 'control: the old 69% drift with confidence is caught by 5');
check(!unplacedLayerSilent(byLayerOf(fulls, 'GL'), 2) || !unplacedLayerSilent(byLayerOf(fulls, 'WC'), 2),
  'control: the full tower\'s games, read as if $5M xs $10M were not bought, are caught by 6');
check(!declinedSilent([...declined.map(r => r.byLine.Property), { reinsuranceCost: 1, reinsuranceRecovery: 0 }]),
  'control: a declined tower that charges $1 is caught by 6');

console.log(failed.length === 0 ? '\nALL REINSURANCE TOWER CHECKS PASS, AND EVERY CONTROL IS CAUGHT.'
  : `\n${RULE}\n${failed.length} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
process.exit(failed.length === 0 ? 0 : 1);
