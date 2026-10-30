// ============================================================================
// SCENARIO OPENING DRIFT — each scenario's opening, per line, as recorded, and
// a REPORT of any later change that moves one.
//
//   npx tsx scripts/diagnostics/scenario-opening-drift-check.ts            # compare
//   npx tsx scripts/diagnostics/scenario-opening-drift-check.ts --write    # re-record
//
// The fixed-seed scenarios (wip/fixed-seed-scenarios) make each scenario's
// opening whatever its fixed seed produces (SCENARIO_SEEDS); nothing fits it at
// run time. So a change anywhere in the pre-game — capital, pricing, the loss
// draws, the market — moves openings SILENTLY: no solve pulls them back to a
// target any more. This check records every scenario's opening on every line
// (surplus, year-1 premium at Expected and their ratio, shocks off — a room
// with none, the basis SCENARIO_SEEDS' table is measured on) and FAILS, naming
// each scenario and line that moved and by how much, when a change moves one.
//
// ⚠ IT NEVER RE-PICKS OR ADJUSTS ANYTHING. It reads the scenarios as the game
// builds them and compares; it writes only its own record, and only with
// --write, after a person has read the report and decided the move is
// intended. Re-recording does not change a seed: if an opening has moved too
// far from its design target, that is a decision for a person, not this
// script. (Asserted: SCENARIO_SEEDS is the same object, unchanged, after the
// run.)
//
// THE CONTROLS, each must fail: a recorded opening nudged by one part in a
// billion; scenarios 13 and 16 played on each other's seeds.
//
// RECORDS:
//   v1 (wip/fixed-seed-scenarios): first record, on the fixed seeds as chosen,
//      at capital WC $3.0M, GL $12.0M, Property $12.5M. Its premium-to-surplus
//      figures are SCENARIO_SEEDS' table in pricingParameters.ts.
//   v2 (wip/pricing-alae-load): pricing's ALAE load fixed per line
//      (PRICING_ALAE_LOAD) in place of the window's mean drawn ratio. The
//      control, multiplayer 861b8c7, opened exactly on v1. Every one of the 180
//      recorded figures moves, and only through the pre-game's rates (2023-2026
//      moved; 2021-2022, priced with no history, did not): opening surplus WC
//      -14.6% to +24.7%, GL -16.4% to +11.0%, Property -4.3% to +4.3%; year-1
//      premium WC -1.2% to +2.0%, GL -3.3% to +2.3%, Property -0.8% to +0.5%.
//      ACCEPTED AS THEY FALL by ruling; no seed changed. The seeds will be
//      re-picked on this build (SCENARIO_OPENING_BARS).
// ============================================================================
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIO_COUNT, SCENARIO_SEEDS } from '../../src/data/pricingParameters';
import { buildTeamGame } from '../../src/session/client/buildGame';
import { openingYear1Premium } from '../../src/utils/priorHistoryEngine';
import { gameShocksOn } from '../../src/utils/shockLosses';
import type { CoverageLine } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const RECORD = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../baselines/SCENARIO_OPENINGS_v2.json');
type Opening = { surplus: number; premium: number; ps: number };
type Openings = Record<string, Record<CoverageLine, Opening>>;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const seedsBefore = JSON.stringify(SCENARIO_SEEDS);
const seedsObject = SCENARIO_SEEDS;
// Every scenario's opening, as a room with no shocks builds it.
function openingsOf(id: (n: number) => string): Openings {
  const out: Openings = {};
  for (let n = 1; n <= SCENARIO_COUNT; n++) {
    const gs = buildTeamGame({ seed: id(n), yearCount: 5, startingYear: 2027, eventName: 'E', poolName: 'S', shocks: [], priorDevelopment: undefined } as never, LINES).gameState;
    const last = gs.priorHistory[gs.priorHistory.length - 1];
    out[String(n)] = Object.fromEntries(LINES.map(l => {
      const ls = gs.poolState.lines[l];
      const premium = openingYear1Premium(gs.instance, l, ls, last.byLine[l], gameShocksOn(gs.setup, gs.instance));
      return [l, { surplus: ls.surplus, premium, ps: premium / ls.surplus }];
    })) as Record<CoverageLine, Opening>;
  }
  return out;
}
const now = openingsOf(n => String(n));

if (process.argv.includes('--write')) {
  fs.writeFileSync(RECORD, JSON.stringify(now, null, 1) + '\n');
  console.log(`Recorded ${SCENARIO_COUNT} scenarios x ${LINES.length} lines -> ${path.relative(process.cwd(), RECORD)}. No seed was changed.`);
  process.exit(0);
}

const recorded: Openings = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
function gradeDrift(seen: Openings, rec: Openings, tag: string) {
  const moved: string[] = [];
  for (let n = 1; n <= SCENARIO_COUNT; n++) for (const l of LINES) {
    const a = rec[String(n)]?.[l], b = seen[String(n)]?.[l];
    if (!a || !b) { moved.push(`scenario ${n} ${l} missing`); continue; }
    for (const k of ['surplus', 'premium', 'ps'] as const) {
      if (a[k] !== b[k]) moved.push(`scenario ${n} ${l} ${k} ${a[k].toFixed(k === 'ps' ? 4 : 0)} -> ${b[k].toFixed(k === 'ps' ? 4 : 0)} (${((b[k] / a[k] - 1) * 100).toFixed(3)}%)`);
    }
  }
  check(moved.length === 0,
    `${tag}every scenario's opening on every line is where it was recorded — surplus, year-1 premium and their ratio, to the bit`,
    moved.length ? `MOVED: ${moved.slice(0, 12).join('; ')}${moved.length > 12 ? `; and ${moved.length - 12} more` : ''}` : `${SCENARIO_COUNT} scenarios x ${LINES.length} lines unmoved`);
  if (!tag) for (const m of moved) console.log(`      ${m}`);
}

console.log('SCENARIO OPENINGS, AGAINST THE RECORD');
gradeDrift(now, recorded, '');
check(SCENARIO_SEEDS === seedsObject && JSON.stringify(SCENARIO_SEEDS) === seedsBefore,
  'nothing re-picked: SCENARIO_SEEDS is unchanged by the run', '');

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  check(failures.splice(before).length > 0, `control: ${name} is caught`);
};
controlFails('a recorded opening nudged by one part in a billion', () => {
  const nudged: Openings = JSON.parse(JSON.stringify(recorded));
  nudged['7'].GL.surplus *= 1 + 1e-9;
  gradeDrift(now, nudged, 'c ');
});
controlFails('scenarios 13 and 16 played on each other\'s seeds', () => {
  const swapped = openingsOf(n => String(n === 13 ? 16 : n === 16 ? 13 : n));
  gradeDrift(swapped, recorded, 'c ');
});

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  console.log('If the move is intended, read the report, then re-record with --write. Never change a seed to make an opening fit.');
  process.exit(1);
}
console.log('PASS — every scenario opens where it was recorded; nothing was re-picked or adjusted.');
