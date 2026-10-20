// PROBE SETUP (measurement only) — import FIRST, and run under flat-loader
// (NODE_OPTIONS="--import <abs>/flat-register.mjs" npx tsx ...). ARM=today
// leaves the engine as it is; ARM=change applies the four changes, in this
// process only:
//   1. routine large losses off; each line-year's expected routine cost folded
//      into the ordinary cost as  routine(y) / (1 + E[uplift](y)),  so the A
//      uplift on the larger base gives back exactly the routine cost — and the
//      shocks' T is scaled off the UNFOLDED cost (loader), so T does not grow;
//   2. every catalogue probability x (0.3 / sum), relative weights kept;
//   3. layer price = E + 0.5 x SD of annual recovery (loader), no floor; WC's
//      $5M xs $5M and $10M xs $5M withdrawn;
//   4. pre-game years (<= 0): expected asset-class returns net of fee, and
//      ordinary losses at exactly expected — no year or unit factor (loader).
import { ROUTINE_LARGE_LOSSES, REINSURANCE_OPTIONS } from '../../src/data/pricingParameters';
import { ASSET_CLASS_ASSUMPTIONS } from '../../src/data/defaultAssumptions';
import { SHOCK_EVENTS } from '../../src/utils/shockLosses';
import { expectedLossBreakdown, upliftMoments } from '../../src/utils/shockExpectation';
import type { CoverageLine } from '../../src/types/simulation';
import '../../src/utils/simulationEngine';
import '../../src/utils/reinsuranceTower';
import '../../src/utils/priorHistoryEngine';
import '../../src/utils/shockSchedule';

const applied: string[] = (globalThis as any).__FLAT_LOADER_APPLIED ?? [];
for (const m of ['ordinaryLoss.ts', 'shockLosses.ts', 'reinsuranceTower.ts', 'simulationEngine.ts', 'priorHistoryEngine.ts', 'shockSchedule.ts']) {
  if (!applied.some(a => a.endsWith(m))) throw new Error(`flat-setup: ${m} not rewritten — run under flat-loader (see header)`);
}
export const ARM = process.env.ARM === 'change' ? 'change' : 'today';
export const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const E = 1000, YEARS = Array.from({ length: 10 }, (_, i) => i + 1);
const exp = (l: CoverageLine, y: number) => expectedLossBreakdown(l, E, y, ROUTINE_LARGE_LOSSES.enabled, 1).total;
export const CHECK: Record<string, { today: number[]; scaledOnly?: number[]; change?: number[] }> = {};
for (const l of LINES) CHECK[l] = { today: YEARS.map(y => exp(l, y)) };
export const SHOCK_SUM_TODAY = SHOCK_EVENTS.reduce((a, e) => a + e.probability, 0);
export const FOLD: Record<string, Record<number, number>> = {};

if (ARM === 'change') {
  const k = 0.3 / SHOCK_SUM_TODAY;
  for (const e of SHOCK_EVENTS) (e as { probability: number }).probability *= k;
  for (const l of LINES) CHECK[l].scaledOnly = YEARS.map(y => exp(l, y));      // routine still on
  for (const l of LINES) {
    FOLD[l] = {};
    for (let y = -10; y <= 15; y++) {
      const routine = expectedLossBreakdown(l, E, y, true, 1).routineLarge / (E * 10_000);
      FOLD[l][y] = routine / (1 + upliftMoments(l, y).mean);
    }
  }
  ROUTINE_LARGE_LOSSES.enabled = false;
  (globalThis as any).__FOLD = (line: string, y: number) => FOLD[line]?.[y] ?? (() => { throw new Error(`no fold for ${line} ${y}`); })();
  for (const l of LINES) CHECK[l].change = YEARS.map(y => exp(l, y));
  (globalThis as any).__REINS_LAMBDA = 0.5;
  const wc = REINSURANCE_OPTIONS.WC as { id: string }[];
  for (const id of ['$5M xs $5M', '$10M xs $5M', ...(process.env.WC_ONLY_9X1 === '1' ? ['$14M xs $1M'] : [])]) { const i = wc.findIndex(o => o.id === id); if (i < 0) throw new Error(`no WC ${id}`); wc.splice(i, 1); }
  (globalThis as any).__FLAT_PREGAME = true;
  const net = (a: { expectedReturn: number; feeRate: number }) => a.expectedReturn - a.feeRate;
  (globalThis as any).__FLAT_MARKET = { cash: net(ASSET_CLASS_ASSUMPTIONS.cash), bonds: net(ASSET_CLASS_ASSUMPTIONS.bonds), equities: net(ASSET_CLASS_ASSUMPTIONS.equities) };
}
export const SHOCK_SUM_NOW = SHOCK_EVENTS.reduce((a, e) => a + e.probability, 0);
