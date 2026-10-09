// ============================================================================
// WHAT THE ENGINE CLOSES TRACKED CLAIMS AT, BY SIZE — A PROBE. Asserts nothing.
//
//   LINE=WC npx tsx scripts/diagnostics/termination-by-size-report.ts
//   LINE=GL GAMES=48 YEARS=14 npx tsx ...
//
// Plays GAMES solo games of YEARS years on one line at default decisions, and
// follows the TRACKED (developing) claims of accident years 1-2 — the only
// cohorts old enough to have finished. reserveCohorts drops a cohort the year
// after it closes, so the developing set is snapshotted every year and the last
// sighting kept.
//
// For each claim: drawn = (reported / A)^(1/k), inverting the forward-booking
// contraction (DevelopingClaim.reported is the contracted first estimate, not
// the draw). Printed by drawn-size band:
//   booked/drawn      value-weighted current over drawn — where development
//                     TERMINATES. 100% is a claim booked at what it costs.
//   spread            sd of log(current/drawn) — the per-claim noise. A fix to
//                     the level must not erase this.
//   WC only           the tower's recovery on claims over $5M, against what the
//                     same claims would cede at their drawn value (purchasable
//                     layers, per occurrence).
//
// ⚠ CATASTROPHES ARE SKIPPED, as reviseDevelopingSet skips them.
// ⚠ TRACKED CLAIMS ONLY. The untracked remainder develops as a mass and has no
// per-claim termination to read; it is about a third of value on WC.
// Runtime about 2s per game-year on WC; ~11 min at GAMES=48 YEARS=14.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { TRIANGLE_INITIAL_CONTRACTION } from '../../src/data/defaultAssumptions';
import { REINSURANCE_TOWER } from '../../src/data/reinsuranceTower';
import type { CoverageLine, DevelopingClaim, GameState } from '../../src/types/simulation';

const LINE = (process.env.LINE ?? 'WC') as CoverageLine;
const GAMES = Number(process.env.GAMES ?? 24);
const YEARS = Number(process.env.YEARS ?? 14);
const { k, A } = TRIANGLE_INITIAL_CONTRACTION[LINE];
const drawnOf = (rep: number) => Math.pow(rep / A, 1 / k);
const layers = REINSURANCE_TOWER[LINE].filter(l => l.purchasable);
const ceded = (t: number) => layers.reduce((s, l) => s + Math.max(0, Math.min(t - l.attachment, l.limit)), 0);
const B = [[0, 1e5], [1e5, 2.5e5], [2.5e5, 1e6], [1e6, 5e6], [5e6, 1e7], [1e7, Infinity]] as const;
const agg = B.map(() => ({ n: 0, d: 0, c: 0, l: [] as number[] }));
let megaN = 0, megaDue = 0, megaGot = 0;

for (let g = 0; g < GAMES; g++) {
  const id = `TRM${g}`; const inst = generateGameInstance(id, 7_300_000 + g * 4421);
  const setup = { poolName: 'T', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: [LINE] };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  let gs: GameState = { setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory };
  const snap: Record<number, DevelopingClaim[]> = {};
  for (let y = 1; y <= YEARS; y++) {
    const p = processYear(gs, defaultDecisionSet(y));
    gs = { ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result], currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
    for (const c of gs.poolState.lines[LINE].reserveCohorts) {
      if (!c.seeded && c.yearNumber <= 2 && c.developingClaims) snap[c.yearNumber] = c.developingClaims.map(d => ({ ...d }));
    }
  }
  for (const ay of [1, 2]) for (const d of snap[ay] ?? []) {
    if (d.catastrophe) continue;
    const x = drawnOf(d.reported); const i = B.findIndex(b => x >= b[0] && x < b[1]);
    agg[i].n++; agg[i].d += x; agg[i].c += d.current; if (d.current > 0) agg[i].l.push(Math.log(d.current / x));
    if (LINE === 'WC' && x >= 5e6) { megaN++; megaDue += ceded(x); megaGot += ceded(d.current); }
  }
}

const pct = (v: number) => (100 * v).toFixed(1).padStart(6) + '%';
const bn = (b: readonly [number, number]) => (b[0] >= 1e6 ? '$' + b[0] / 1e6 + 'M' : '$' + b[0] / 1e3 + 'k') + '+';
const sdl = (a: number[]) => { if (a.length < 2) return NaN; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
console.log(`${LINE} tracked claims, AY1-2 after ${YEARS} yrs, ${GAMES} games — booked/drawn by drawn-size band:`);
console.log('   ' + B.map((b, i) => `${bn(b)} (n${agg[i].n}) ${agg[i].d > 0 ? pct(agg[i].c / agg[i].d) : '   -  '}`).join('   '));
console.log('   spread, sd of log(booked/drawn): ' + B.map((b, i) => `${bn(b)} ${sdl(agg[i].l).toFixed(3)}`).join('   '));
const tot = agg.reduce((s, a) => ({ d: s.d + a.d, c: s.c + a.c }), { d: 0, c: 0 });
console.log(`   all tracked: ${pct(tot.c / tot.d).trim()}`);
if (LINE === 'WC') console.log(`   claims over $5M: ${megaN}, tower recovers ${megaDue > 0 ? pct(megaGot / megaDue) : '-'} of what their drawn values would cede`);
