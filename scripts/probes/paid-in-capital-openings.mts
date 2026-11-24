// ============================================================================
// EVERY SCENARIO'S OPENING AT TODAY'S PAID-IN CAPITAL (pr/round-paid-in-capital).
//
//   npx tsx scripts/probes/paid-in-capital-openings.mts [out.json]
//
// Per scenario (the twenty, then the named 21 Staff Retreat and 22 Test Seed)
// and line: the opening surplus, year-1 premium at Expected (no cover, shocks
// off — openingYear1Premium, as scenarios-check and the drift record read it)
// and their ratio, premium to surplus, against the design target. The named
// scenarios have no target of their own: Test Seed is read against slot 20's
// (the slot it was), Staff Retreat against the designed slot it opens nearest
// (smallest worst-line miss). Run once on aws's head and once on the branch to
// set the before and after side by side.
// ============================================================================
import * as fs from 'node:fs';
import { NAMED_SCENARIOS, SCENARIO_COUNT, SCENARIO_PREMIUM_TO_SURPLUS, STARTING_CAPITAL } from '../../src/data/pricingParameters';
import { buildTeamGame } from '../../src/session/client/buildGame';
import { openingYear1Premium } from '../../src/utils/priorHistoryEngine';
import { gameShocksOn } from '../../src/utils/shockLosses';
import type { CoverageLine } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const IDS = [...Array.from({ length: SCENARIO_COUNT }, (_, i) => i + 1), ...Object.keys(NAMED_SCENARIOS).map(Number)];
const SLOTS = Array.from({ length: SCENARIO_COUNT }, (_, i) => i + 1);
type Line = { surplus: number; premium: number; ps: number };
const missAgainst = (ps: Record<CoverageLine, number>, slot: number) =>
  Math.max(...LINES.map(l => Math.abs(ps[l] / SCENARIO_PREMIUM_TO_SURPLUS[l][slot] - 1)));

const out: Record<string, unknown> = { capital: STARTING_CAPITAL };
for (const n of IDS) {
  const gs = buildTeamGame({ seed: String(n), yearCount: 5, startingYear: 2027, eventName: 'E', poolName: 'S', shocks: [], priorDevelopment: undefined } as never, LINES).gameState;
  const last = gs.priorHistory[gs.priorHistory.length - 1];
  const lines = Object.fromEntries(LINES.map(l => {
    const ls = gs.poolState.lines[l];
    const premium = openingYear1Premium(gs.instance, l, ls, last.byLine[l], gameShocksOn(gs.setup, gs.instance));
    return [l, { surplus: ls.surplus, premium, ps: premium / ls.surplus }];
  })) as Record<CoverageLine, Line>;
  const ps = Object.fromEntries(LINES.map(l => [l, lines[l].ps])) as Record<CoverageLine, number>;
  const slot = n <= SCENARIO_COUNT ? n : n === 22 ? 20 : [...SLOTS].sort((a, b) => missAgainst(ps, a) - missAgainst(ps, b))[0];
  out[n] = {
    slot, lines,
    target: Object.fromEntries(LINES.map(l => [l, SCENARIO_PREMIUM_TO_SURPLUS[l][slot]])),
    miss: missAgainst(ps, slot),
    byLineMiss: Object.fromEntries(LINES.map(l => [l, ps[l] / SCENARIO_PREMIUM_TO_SURPLUS[l][slot] - 1])),
  };
}
const file = process.argv[2];
if (file) fs.writeFileSync(file, JSON.stringify(out, null, 1));
const within = SLOTS.filter(n => (out[n] as { miss: number }).miss <= 0.05).length;
console.log(`capital ${JSON.stringify(STARTING_CAPITAL)} — ${within} of ${SCENARIO_COUNT} within 5% on every line`);
for (const n of IDS) {
  const o = out[n] as { slot: number; miss: number; lines: Record<CoverageLine, Line> };
  console.log(String(n).padStart(3), `slot ${String(o.slot).padStart(2)}`,
    LINES.map(l => `${l} $${(o.lines[l].surplus / 1e6).toFixed(2)}M ${o.lines[l].ps.toFixed(3)}`).join('  '),
    `worst ${(100 * o.miss).toFixed(1)}%`);
}
