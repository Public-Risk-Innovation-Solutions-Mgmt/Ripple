// ============================================================================
// WHAT FULL-COST BOOKING MOVES — A PAIRED READING, NOT A GATE.
//
//   npx tsx scripts/diagnostics/full-cost-booking-report.ts
//   GAMES=6 YEARS=10 npx tsx scripts/diagnostics/full-cost-booking-report.ts
//
// ⚠ IT ASSERTS NOTHING AND EXITS 0. recorded-payout-check is the bar; this is
// the inventory of everything else the booking walk was feeding, measured
// rather than reasoned about, so a reader who finds one of these numbers moved
// has somewhere to see that it was expected and by how much.
//
// ⚠ A PAIRED CONTROL, THE SAME INSTANCES PLAYED TWICE. FULL_COST_BOOKING is
// flipped at runtime between the two passes and nothing else changes — same
// seeds, same decisions, same roster. The difference between two independent
// game sets would be instance spread with the effect somewhere inside it; this
// is the effect. (Commit 2's first shock measurement made exactly that mistake
// and had to be redone, which is why the pairing is spelled out here.)
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { FULL_COST_BOOKING } from '../../src/data/defaultAssumptions';
import type { CoverageLine, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 6);
const YEARS = Number(process.env.YEARS ?? 10);

interface Readings {
  openingReserve: number;
  reserveByYear: number[];
  development: number;
  developmentCeded: number;
  recovery: number;
  satisfaction: number;
  claimsOpen: number;
  claimsClosed: number;
}

function play(fullCost: boolean): Readings {
  FULL_COST_BOOKING.enabled = fullCost;
  const out: Readings = {
    openingReserve: 0, reserveByYear: new Array(YEARS).fill(0), development: 0,
    developmentCeded: 0, recovery: 0, satisfaction: 0, claimsOpen: 0, claimsClosed: 0,
  };
  let satN = 0;
  for (let g = 0; g < GAMES; g++) {
    const id = `FCB${g}`;
    const inst = generateGameInstance(id, 3_100_000 + g * 7919);
    const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    const open = poolState as unknown as { lines: Record<string, { reserveCohorts?: { netUnpaid: number }[] }> };
    for (const l of LINES) {
      for (const c of open.lines[l].reserveCohorts ?? []) out.openingReserve += c.netUnpaid;
    }
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      const st = p.updatedPoolState as unknown as {
        lines: Record<string, { reserveCohorts?: { netUnpaid: number }[] }>;
      };
      const r = p.result as unknown as {
        byLine?: Record<string, {
          priorYearDevelopment?: number; priorYearDevelopmentCeded?: number; reinsuranceRecovery?: number;
        }>;
        memberSatisfaction?: number;
      };
      for (const l of LINES) {
        for (const c of st.lines[l].reserveCohorts ?? []) out.reserveByYear[y - 1] += c.netUnpaid;
        const lr = r.byLine?.[l];
        out.development += lr?.priorYearDevelopment ?? 0;
        out.developmentCeded += lr?.priorYearDevelopmentCeded ?? 0;
        out.recovery += lr?.reinsuranceRecovery ?? 0;
      }
      if (typeof r.memberSatisfaction === 'number') { out.satisfaction += r.memberSatisfaction; satN++; }
      gs = {
        ...gs, poolState: p.updatedPoolState, currentYearNumber: y + 1,
        currentDecisions: defaultDecisionSet(y + 1),
      };
    }
  }
  out.satisfaction = satN > 0 ? out.satisfaction / satN : 0;
  return out;
}

const was = FULL_COST_BOOKING.enabled;
const off = play(false);
const on = play(true);
FULL_COST_BOOKING.enabled = was;

const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? '0.0%' : 'n/a') : `${(((a / b) - 1) * 100).toFixed(1)}%`);
const m = (x: number) => `$${(x / 1e6).toFixed(1)}M`;

console.log('=== FULL-COST BOOKING: WHAT IT MOVES ===\n');
console.log(`paired control, ${GAMES} games x ${YEARS} years, default decisions, same seeds both passes\n`);
console.log('                                      walk ON (before)     full cost (after)      change');
console.log(`  opening reserve, all lines        ${m(off.openingReserve).padStart(18)} ${m(on.openingReserve).padStart(21)} ${pct(on.openingReserve, off.openingReserve).padStart(11)}`);
for (const y of [0, 1, 2, 4, YEARS - 1]) {
  if (y >= YEARS) continue;
  console.log(`  reserve at end of year ${String(y + 1).padEnd(2)}         ${m(off.reserveByYear[y]).padStart(18)} ${m(on.reserveByYear[y]).padStart(21)} ${pct(on.reserveByYear[y], off.reserveByYear[y]).padStart(11)}`);
}
console.log(`  prior-year development, total     ${m(off.development).padStart(18)} ${m(on.development).padStart(21)} ${pct(on.development, off.development).padStart(11)}`);
console.log(`  of it ceded to the tower          ${m(off.developmentCeded).padStart(18)} ${m(on.developmentCeded).padStart(21)} ${pct(on.developmentCeded, off.developmentCeded).padStart(11)}`);
console.log(`  reinsurance recovery, total       ${m(off.recovery).padStart(18)} ${m(on.recovery).padStart(21)} ${pct(on.recovery, off.recovery).padStart(11)}`);
console.log(`  member satisfaction, mean         ${off.satisfaction.toFixed(3).padStart(18)} ${on.satisfaction.toFixed(3).padStart(21)} ${(on.satisfaction - off.satisfaction >= 0 ? '+' : '') + (on.satisfaction - off.satisfaction).toFixed(3)}`);
console.log('\n  DEVELOPMENT AT EXACTLY ZERO IS THE POINT, not a rounding. Prior years do not');
console.log('  move at all until the host\'s prior development factors are wired, and they are');
console.log('  then the only source.\n');
