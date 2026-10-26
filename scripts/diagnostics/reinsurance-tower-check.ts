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
//      dearer than WC's, equal layer counts, the tower cut at $1/2/10/20/40M
//      on every line, the top layer charged when placed.
//   4. The (unwired) aggregate's price responds to the occurrence layers placed,
//      and falls per $100 as the book grows.
//   5. The price is not a function of the funding confidence level.
//   6. A live game: ceded never exceeds the occurrences, a layer the bought
//      cover leaves out cedes nothing — while the same games on a cover that
//      places it DO cede through it, so the check is not vacuous — a declined
//      Property tower costs and recovers nothing, and the aggregate is unwired.
//
// ⚠ RESTATED FOR THE SHOCKS LANDING (wip/shocks, 2ae5c1a). The tower is cut
// at $1M, $2M, $10M, $20M and $40M on every line (four layers, top $40M) for
// the per-occurrence T covers ('$9M xs $1M', '$8M xs $2M', '$18M xs $2M',
// '$38M xs $2M'), and the default is None. So: 2's corridor skips the
// $8M xs $2M band; 3 asserts the new cut; 5 buys '$38M xs $2M' on WC, since
// under None both confidence levels cost $0 and the ratio was NaN; and 6
// reads the default (None) as ceding nothing on every layer, the widest
// cover ('$38M xs $2M') as ceding nothing through $1M xs $1M, which it leaves
// out, exactly its layer on every occurrence — and '$9M xs $1M' games DO
// cede through $1M xs $1M, so neither is vacuous.
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
import { AGGREGATE_STOP, MEMBER_LEVEL } from '../../src/data/pricingParameters';

// ⚠ THE PER-OCCURRENCE TOWER WAS DORMANT BEHIND AGGREGATE_STOP from
// stable-scenarios commit 6; since the shocks landing the stop is off as
// shipped and the tower carries the T covers. Held off here either way.
AGGREGATE_STOP.enabled = false;
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
const corridorGivesUpBand = (all: number, corridor: number) => Math.abs((all - corridor) - 8e6) < 1;
const loadInRegime = (mults: number[]) => (RISK_LOAD_LAMBDA > 0
  ? mults.every((m, i) => i === 0 || m > mults[i - 1])
  : mults.every(m => Math.abs(m - 1) < 1e-12));
const respondsToPlacement = (ratio: number) => ratio > 1.0;
const flatAcrossClf = (costs: number[]) => Math.abs(costs[1] / costs[0] - 1) < 0.02;
const unplacedLayerSilent = (byLayer: number[], unplaced: number) => byLayer[unplaced] === 0;
// The shocks landing's cut, written out here: $1M, $2M, $10M, $20M, $40M on every line.
const CUT = [1e6, 2e6, 10e6, 20e6, 40e6];
const cutAt = (line: CoverageLine) => [...REINSURANCE_TOWER[line as 'WC'].map(l => l.attachment), TOWER_TOP[line as 'WC']];
const towerCutAsBriefed = () => LINES.every(l => cutAt(l).join('|') === CUT.join('|')
  && REINSURANCE_TOWER[l as 'WC'].every((x, i) => x.attachment + x.limit === CUT[i + 1]));
// The worst gap, over every WC and GL line-year, between what was ceded and the
// cover att/lim on each occurrence.
const worstCededGap = (rows: ResultSet[], att: number, lim: number) => {
  let worst = 0;
  for (const r of rows) for (const line of ['WC', 'GL'] as const) {
    const lr = r.byLine[line];
    const want = occurrenceTotals(lr.claims ?? [], lr.occurrences ?? []).reduce((a, x) => a + Math.min(Math.max(x - att, 0), lim), 0);
    worst = Math.max(worst, Math.abs(lr.cededByLayer.reduce((a, b) => a + b, 0) - want));
  }
  return worst;
};
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
// The tower since the shocks landing: $1M xs $1M, $8M xs $2M, $10M xs $10M, $20M xs $20M.
const all12 = cedeOccurrences('WC', [12e6], [true, true, true, true]);
const corridor12 = cedeOccurrences('WC', [12e6], [true, false, true, true]);
{
  const none = cedeOccurrences('WC', [12e6], [false, false, false, false]);
  console.log(`  $12M occurrence: all four layers cede ${fmt$(all12.totalCeded)}, corridor ${fmt$(corridor12.totalCeded)}, none ${fmt$(none.totalCeded)}`);
  check(Math.abs(all12.totalCeded - 11e6) < 1, '2. all four layers cede 1 + 8 + 2 + 0 = $11M of a $12M occurrence');
  check(corridorGivesUpBand(all12.totalCeded, corridor12.totalCeded), '2. a corridor gives up exactly the skipped $8M xs $2M band');
  check([all12, corridor12, none].every(c => Math.abs(c.retained + c.totalCeded - 12e6) < 1e-6), '2. retained + ceded = gross');
  const big = cedeOccurrences('GL', [60e6], [true, true, true, true]);
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
  const glTop = perHundred(layerPremium('GL', 3, book(290), REF_YEAR), 290);
  const wcTop = perHundred(layerPremium('WC', 3, book(290), REF_YEAR), 290);
  check(glTop > wcTop, '3. GL\'s top layer is dearer per $100 than WC\'s', `${glTop.toFixed(5)} vs ${wcTop.toFixed(5)}`);
  check(REINSURANCE_TOWER.WC.length === REINSURANCE_TOWER.GL.length, '3. WC and GL carry the same number of layers');
  check(REINSURANCE_TOWER.WC.every(l => l.purchasable), '3. every WC layer is purchasable');
  check(towerCutAsBriefed(),
  '3. every line\'s tower is cut at $1M, $2M, $10M, $20M and $40M (top band $20M xs $20M)', LINES.map(l => `${l} ${cutAt(l).map(x => x / 1e6).join('/')}`).join('; '));
  check(occurrenceProgramCost('GL', [false, false, false, true], book(290), REF_YEAR).premium > 0, '3. the top layer is charged when placed');
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
// A cover is bought: under the default (None) both cost $0 and 0/0 is not flat.
const clfCosts = [0.60, 0.85].map(clf => play('CLFTEST', 1, d => ({
  ...d, byLine: { ...d.byLine, WC: { ...d.byLine.WC, reinsuranceOption: '$38M xs $2M', fundingConfidenceLevel: clf, fundingAtExpected: false } },
}))[0].byLine.WC.reinsuranceCost);
check(clfCosts[0] > 0 && flatAcrossClf(clfCosts), '5. WC reinsurance cost ($38M xs $2M) is flat between 60% and 85% confidence',
  `${fmt$(clfCosts[0])} vs ${fmt$(clfCosts[1])}`);

console.log('\n=== 6. LIVE GAMES: ceded reconciles; a layer not bought cedes nothing ===');
const GAMES = ['TWR0', 'TWR1', 'TWR2', 'TWR3', 'TWR4', 'TWR5', 'TWR6', 'TWR7'];
const byLayerOf = (rows: ResultSet[], line: 'WC' | 'GL') => rows.reduce((acc, r) => {
  r.byLine[line].cededByLayer.forEach((v, i) => { acc[i] += v; });
  return acc;
}, REINSURANCE_TOWER[line].map(() => 0));
const defaults = GAMES.flatMap(id => play(id, 10));
const fulls = GAMES.flatMap(id => play(id, 10, withOption(fullTowerOption)));
const lows = GAMES.flatMap(id => play(id, 10, withOption(() => '$9M xs $1M')));
const declined = GAMES.slice(0, 2).flatMap(id => play(`${id}-DECLINE`, 5, d => ({
  ...d, byLine: { ...d.byLine, Property: { ...d.byLine.Property, reinsuranceOption: 'none' } },
})));
{
  check(LINES.every(l => fullTowerOption(l) === '$38M xs $2M'), '6. the widest cover is $38M xs $2M on every line');
  let occAll = 0;
  for (const line of ['WC', 'GL'] as const) {
    let ceded = 0, gross = 0, occ = 0;
    for (const r of fulls) {
      const lr = r.byLine[line];
      const totals = occurrenceTotals(lr.claims ?? [], lr.occurrences ?? []);
      gross += totals.reduce((a, b) => a + b, 0);
      const c = lr.cededByLayer.reduce((a, b) => a + b, 0);
      ceded += c;
      occ += (lr.occurrences ?? []).length;
    }
    occAll += occ;
    const d = byLayerOf(defaults, line), f = byLayerOf(fulls, line), w = byLayerOf(lows, line);
    console.log(`  ${line}: ${occ} occurrences over ${fulls.length} years; None by layer ${d.map(fmt$).join(' | ')}; `
      + `$38M xs $2M ${f.map(fmt$).join(' | ')}; $9M xs $1M ${w.map(fmt$).join(' | ')}`);
    check(occ > 0 && ceded <= gross + 1, `6. ${line}: on $38M xs $2M ceded never exceeds the occurrences`, `${fmt$(ceded)} of ${fmt$(gross)}`);
    check(d.every(v => v === 0), `6. ${line}: the default (None) cedes nothing on any layer`);
    check(unplacedLayerSilent(f, 0), `6. ${line}: $1M xs $1M, outside $38M xs $2M, cedes nothing`);
  }
  const worstFull = worstCededGap(fulls, 2e6, 38e6);
  check(occAll > 0 && worstFull < 1, '6. on $38M xs $2M each year cedes exactly min(max(x - $2M, 0), $38M) over its occurrences',
    `worst ${fmt$(worstFull)}`);
  // Not vacuous: the same games on $9M xs $1M cede through that layer.
  const lowBottom = byLayerOf(lows, 'WC')[0] + byLayerOf(lows, 'GL')[0];
  check(lowBottom > 0, '6. the same games on $9M xs $1M DO cede through $1M xs $1M', fmt$(lowBottom));
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
check(!unplacedLayerSilent(byLayerOf(lows, 'GL'), 0) || !unplacedLayerSilent(byLayerOf(lows, 'WC'), 0),
  'control: the $9M xs $1M games, read as if $1M xs $1M were not bought, are caught by 6');
{
  const L = REINSURANCE_TOWER.GL[1]; const o = L.attachment;
  L.attachment = 3e6; L.limit = 7e6;
  const caught = !towerCutAsBriefed();
  L.attachment = o; L.limit = 8e6;
  check(caught && towerCutAsBriefed(), 'control: GL\'s $8M xs $2M moved to $7M xs $3M at runtime is caught by 3');
}
check(worstCededGap(lows, 2e6, 38e6) >= 1, 'control: the $9M xs $1M games, read as if $38M xs $2M were bought, are caught by 6',
  fmt$(worstCededGap(lows, 2e6, 38e6)));
check(!flatAcrossClf([0, 0]), 'control: a cover that costs $0 at both levels (NaN) is caught by 5');
check(!declinedSilent([...declined.map(r => r.byLine.Property), { reinsuranceCost: 1, reinsuranceRecovery: 0 }]),
  'control: a declined tower that charges $1 is caught by 6');

console.log(failed.length === 0 ? '\nALL REINSURANCE TOWER CHECKS PASS, AND EVERY CONTROL IS CAUGHT.'
  : `\n${RULE}\n${failed.length} CHECK(S) FAILED:\n  ${failed.join('\n  ')}\n${RULE}`);
process.exit(failed.length === 0 ? 0 : 1);
