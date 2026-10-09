// ============================================================================
// WHAT A FIVE-YEAR GAME SHOWS OF DEVELOPMENT, AND HOW MUCH OF A PROGRAMME'S
// SAVING PRICING HANDS BACK — A PROBE. Asserts nothing.
//
//   MODE=visibility GAMES=24 npx tsx scripts/diagnostics/development-visibility-report.ts
//   MODE=pricing    GAMES=24 npx tsx scripts/diagnostics/development-visibility-report.ts
//
// visibility  Each line solo, GAMES x 5 years, default decisions. At the end of
//             year 5, for every PLAYED accident year, by valuations seen:
//               NET   booked ultimate and paid (reserveDevelopment, the cohort's
//                     own ledger) against the TRUE net ultimate — drawn gross less
//                     the tower on the drawn occurrences, never netUltimateLoss;
//               GROSS booked (grossPaid + grossUnpaid) and paid (reserveCohorts)
//                     against drawn gross.
//             Plus crossings: a valuation where net paid exceeds the booked
//             ultimate. Expected 0 — payout pays a share of the booked reserve.
//             ⚠ READ IT GROSS. On the net ledger GL's oldest cohort can read over
//             100% of truth, and that is the tower basis (development cession
//             under-cedes — the standing cession-uplift-basis red), not
//             over-development.
//
// pricing     WC solo, GAMES x 10 years, the wc-safety-rtw programme on vs off,
//             paired on seed. Per year: the keep it saves (true net, ultimate
//             basis) and the premium it hands back. CUMULATIVE GIVEBACK = sum
//             premium handed back / sum keep saved.
//             ⚠ THIS IS ALSO UNDERWRITING'S CATCH-UP. How far the experience rate
//             has moved toward a changed true cost is one quantity; whatever makes
//             pricing learn faster raises the giveback one for one. Reproduces the
//             quoted risk-control figures: 7.4% at year 3, 40.3% at year 10 at
//             b0fd991 (quoted 7% / 42%).
// Runtime: visibility ~2 min, pricing ~4 min, at GAMES=24.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { cedeOccurrences, occurrenceTotals, normalizeLayersPlaced } from '../../src/utils/reinsuranceTower';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const MODE = process.env.MODE ?? 'visibility';
const GAMES = Number(process.env.GAMES ?? 24);

const play = (g: number, line: CoverageLine, years: number, ids: string[]) => {
  const id = `FDV${g}`; const inst = generateGameInstance(id, 9_100_000 + g * 6271);
  const setup = { poolName: 'F', gameLength: years, startingYear: 2026, instanceId: id, activeLines: [line] };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = { instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, setup: setup as never };
  const rows: { y: number; trueNet: number; drawnGross: number; prem: number }[] = [];
  for (let y = 1; y <= years; y++) {
    const d: DecisionSet = { ...defaultDecisionSet(y), riskControlProgramIds: ids };
    const p = processYear(gs, d);
    const r = p.result.byLine[line];
    const placed = normalizeLayersPlaced(line, d.byLine[line].layersPlaced);
    const trueNet = r.grossUltimateLoss - cedeOccurrences(line, occurrenceTotals(r.claims ?? [], r.occurrences ?? []), placed).totalCeded;
    rows.push({ y, trueNet, drawnGross: r.grossUltimateLoss, prem: r.poolPremium });
    gs = { ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result], currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
  }
  return { rows, ledger: gs.poolState.lines[line].reserveDevelopment ?? [], cohorts: gs.poolState.lines[line].reserveCohorts };
};

if (MODE === 'visibility') {
  for (const line of ['WC', 'GL', 'Property'] as const) {
    const agg: Record<number, { t: number; b: number; p: number }> = {};
    const gagg: Record<number, { d: number; b: number; p: number }> = {};
    let cross = 0, nvals = 0, T = 0, B = 0, P = 0, GD = 0, GB = 0, GP = 0;
    for (let g = 0; g < GAMES; g++) {
      const { rows, ledger, cohorts } = play(g, line, 5, []);
      for (const row of ledger) {
        if (row.seeded || !row.paidByValuation) continue;
        const pv = row.paidByValuation;
        row.ultimateByValuation.forEach((u, i) => { nvals++; if (pv[i] > u + 1) cross++; });
      }
      for (const r of rows) {
        const row = ledger.find(x => x.yearNumber === r.y && !x.seeded);
        if (!row) continue;
        const booked = row.ultimateByValuation[row.ultimateByValuation.length - 1];
        const paid = row.paidByValuation?.[row.paidByValuation.length - 1] ?? 0;
        const v = row.ultimateByValuation.length;
        agg[v] = agg[v] ?? { t: 0, b: 0, p: 0 };
        agg[v].t += r.trueNet; agg[v].b += booked; agg[v].p += paid;
        T += r.trueNet; B += booked; P += paid;
        const co = cohorts.find(x => x.yearNumber === r.y && !x.seeded);
        if (co && co.grossPaid !== undefined) {
          const gb = co.grossPaid + (co.grossUnpaid ?? 0);
          gagg[v] = gagg[v] ?? { d: 0, b: 0, p: 0 };
          gagg[v].d += r.drawnGross; gagg[v].b += gb; gagg[v].p += co.grossPaid;
          GD += r.drawnGross; GB += gb; GP += co.grossPaid;
        }
      }
    }
    const ks = Object.keys(agg).map(Number).sort((a, b) => b - a);
    const cell = (x: number) => (100 * x).toFixed(1).padStart(9) + '%';
    console.log(`${line.padEnd(9)} valuations seen:   ${ks.map(k => String(k).padStart(10)).join('')}     ALL FIVE`);
    console.log(`${''.padEnd(9)} NET booked/true:   ${ks.map(k => cell(agg[k].b / agg[k].t)).join('')}     ${(100 * B / T).toFixed(1)}%`);
    console.log(`${''.padEnd(9)} NET paid/true:     ${ks.map(k => cell(agg[k].p / agg[k].t)).join('')}     ${(100 * P / T).toFixed(1)}%`);
    console.log(`${''.padEnd(9)} GROSS booked/drawn:${ks.map(k => (gagg[k] ? cell(gagg[k].b / gagg[k].d) : '         -')).join('')}     ${(100 * GB / GD).toFixed(1)}%`);
    console.log(`${''.padEnd(9)} GROSS paid/drawn:  ${ks.map(k => (gagg[k] ? cell(gagg[k].p / gagg[k].d) : '         -')).join('')}     ${(100 * GP / GD).toFixed(1)}%`);
    console.log(`${''.padEnd(9)} crossings (net paid > booked ultimate): ${cross} of ${nvals} played cohort-valuations`);
  }
} else {
  const YEARS = 10, line: CoverageLine = 'WC';
  const dP = Array(YEARS).fill(0), dK = Array(YEARS).fill(0);
  for (let g = 0; g < GAMES; g++) {
    const off = play(g, line, YEARS, []).rows, on = play(g, line, YEARS, ['wc-safety-rtw']).rows;
    for (let y = 0; y < YEARS; y++) { dP[y] += (off[y].prem - on[y].prem) / GAMES; dK[y] += (off[y].trueNet - on[y].trueNet) / GAMES; }
  }
  let cp = 0, ck = 0;
  for (let y = 0; y < YEARS; y++) {
    cp += dP[y]; ck += dK[y];
    console.log(`  ${String(y + 1).padStart(2)}   keep saved ${(dK[y] / 1e6).toFixed(3)}M   premium back ${(dP[y] / 1e6).toFixed(3)}M   that year ${(100 * dP[y] / dK[y]).toFixed(1).padStart(5)}%   CUMULATIVE GIVEBACK ${(100 * cp / ck).toFixed(1).padStart(5)}%`);
  }
}
