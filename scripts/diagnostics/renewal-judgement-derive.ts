// ============================================================================
// RENEWAL JUDGEMENT DERIVATION — A PROBE. It measures and prints; it asserts
// nothing and always exits 0.
//
//   npx tsx scripts/diagnostics/renewal-judgement-derive.ts            # the shipped CV
//   CVS=0,0.5,1,1.5 npx tsx scripts/diagnostics/renewal-judgement-derive.ts
//
// WHAT IT MEASURES: how much declining renewals improves the EXISTING BOOK's
// loss ratio — the units renewed into the year (not that year's new business),
// their losses over their premium as the ledger records them (the worlds'
// average), the same figures the ranking reads. At Expected, no rejection.
//
//   one year    from the same state at the start of each year 1-5 (the 0% path),
//               that year played at 0%, 5% and 10% declined: the improvement is
//               the 0% year's existing-book loss ratio less the x% year's.
//   sustained   x% declined every year from year 1: the improvement in year 5
//               against the 0% path's year 5.
//
// For each RENEWAL_JUDGEMENT_CV tried, on scenario 18 Property and on scenarios
// 7 and 13, every line.
// ============================================================================
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { RENEWAL_JUDGEMENT_CV } from '../../src/data/pricingParameters';
import type { CoverageLine, DecisionSet, GameSetupSettings, GameState } from '../../src/types/simulation';

const YEARS = 5;
const SHARES = [0, 0.05, 0.10];
const GAMES: { seed: string; lines: CoverageLine[] }[] = [
  { seed: '18', lines: ['Property'] },
  { seed: '7', lines: ['WC', 'GL', 'Property'] },
  { seed: '13', lines: ['WC', 'GL', 'Property'] },
];
const CVS = (process.env.CVS ?? String(RENEWAL_JUDGEMENT_CV.value)).split(',').map(Number);

function open(seed: string, lines: CoverageLine[]): GameState {
  const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: YEARS + 1, startingYear: 2026, instanceId: seed, activeLines: lines } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  return openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
}

function play(gs: GameState, declined: number): GameState {
  const d = defaultDecisionSet(gs.currentYearNumber) as DecisionSet;
  for (const l of gs.setup.activeLines) { d.byLine[l].renewalsDeclined = declined; d.byLine[l].newBusinessRejection = 0; }
  const y = gs.currentYearNumber;
  return { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, d), [])), currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
}

/** The existing book's loss ratio in the year just played: every unit but that year's new business. */
function existingLr(gs: GameState, line: CoverageLine): number {
  const y = gs.currentYearNumber - 1;
  const ledger = gs.poolState.bookLedger?.[line];
  if (!ledger) throw new Error(`no ledger on ${line}`);
  let loss = 0, premium = 0;
  for (const [k, recs] of Object.entries(ledger.history)) {
    if (ledger.joined[k] === y) continue;
    const r = recs.find(x => x.year === y);
    if (r) { loss += r.loss; premium += r.premium; }
  }
  return loss / premium;
}

const pts = (x: number) => (x * 100).toFixed(2).padStart(6);
for (const cv of CVS) {
  RENEWAL_JUDGEMENT_CV.value = cv;
  console.log(`\n=== RENEWAL_JUDGEMENT_CV ${cv} — existing-book loss-ratio improvement, points (0% / 5% / 10% declined)`);
  for (const g of GAMES) {
    // The 0% path, and each year's branches from it.
    let base = open(g.seed, g.lines);
    const oneYear: Record<string, number[][]> = {};   // line -> year -> [0, 5, 10] improvement
    const base5: Record<string, number> = {};
    for (let y = 1; y <= YEARS; y++) {
      const at = SHARES.map(s => play(base, s));
      for (const l of g.lines) {
        const lr = at.map(s => existingLr(s, l));
        (oneYear[l] ??= []).push(lr.map(x => lr[0] - x));
        if (y === YEARS) base5[l] = lr[0];
      }
      base = at[0];
    }
    // Sustained: x% every year.
    const sustained: Record<string, number[]> = {};
    for (const s of SHARES) {
      let gs = open(g.seed, g.lines);
      for (let y = 1; y <= YEARS; y++) gs = play(gs, s);
      for (const l of g.lines) (sustained[l] ??= []).push(base5[l] - existingLr(gs, l));
    }
    for (const l of g.lines) {
      const ys = oneYear[l];
      const mean = SHARES.map((_, i) => ys.reduce((a, r) => a + r[i], 0) / ys.length);
      console.log(`  seed ${g.seed.padStart(2)} ${l.padEnd(8)} one year: mean ${mean.map(pts).join(' /')}   year 1 ${ys[0].map(pts).join(' /')}   year 5 ${ys[YEARS - 1].map(pts).join(' /')}`
        + `   | sustained, year 5 ${sustained[l].map(pts).join(' /')}   (0% path's year-5 existing-book LR ${(base5[l] * 100).toFixed(1)}%)`);
    }
  }
}
