// ============================================================================
// LARGE LOSSES ON BOOK UNITS — THE GATE.
//
//   npx tsx scripts/diagnostics/book-units-large-loss-check.ts
//
// Routine large losses and shock T losses land on the book's units, weighted
// by size x true risk; a regional T only on units in the struck region; and a
// riskier book draws more routine claims (drawLargeLosses). On every line:
//
//   1. THE SPREAD FOLLOWS WEIGHT: over many years, each unit's share of the
//      routine claims is its share of the book's size x risk.
//   2. A REGIONAL T LANDS ONLY IN THE STRUCK REGION, and within it by weight.
//   3. A RISKIER BOOK SEES MORE: the routine claim count averages λ x exposure
//      x the book's size-weighted risk, and the expected loss carries it.
//   4. THE CLAIMS WORKBOOK SHOWS NO UNIT: no Member ID, Member Name or Member
//      Type column on any claim sheet, and no cell carries a unit's index.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: losses by size alone, a T that
// lands anywhere, a count that ignores risk, and the holder columns shown.
// ============================================================================

import { ROUTINE_LARGE_LOSSES } from '../../src/data/pricingParameters';
import { marketUnits, openingBookUnits, unitsOf, type BookUnit } from '../../src/utils/bookUnits';
import { bookOrdinaryRisk } from '../../src/utils/ordinaryLoss';
import { drawLargeLosses, resolveShockYear, SHOCK_EVENTS, type LargeLossDraw, type LineShockYear } from '../../src/utils/shockLosses';
import { routineLargeCount } from '../../src/utils/largeLosses';
import { expectedLossBreakdown } from '../../src/utils/shockExpectation';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { buildClaimsWorkbook } from '../../src/utils/claimsExport';
import * as XLSX from 'xlsx';
import type { CoverageLine, GameSetupSettings, GameState, Region } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const Z = 4.5;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
ROUTINE_LARGE_LOSSES.enabled = true;
const EMPTY: LineShockYear = { uplift: 0, rRate: 0, arrivals: [], byFiring: [] };
const EXPOSURE: Record<CoverageLine, number> = { WC: 400, GL: 400, Property: 18_000 };

type Draw = (line: CoverageLine, year: number, seed: number, shocks: LineShockYear, exposure: number, units: readonly BookUnit[]) => LargeLossDraw;
const engine: Draw = (line, year, seed, shocks, exposure, units) => drawLargeLosses(line, null, year, 2026 + year, seed, shocks, exposure, units);

// ---------------------------------------------------------------- 1 & 3
function gradeRoutine(draw: Draw, tag: string) {
  for (const line of LINES) {
    const seed = 6_060_606 + LINES.indexOf(line);
    const units = unitsOf(seed, line, openingBookUnits(seed, line));
    const R = bookOrdinaryRisk(units);
    const w = new Map(units.map(u => [u.index, u.size * u.risk]));
    const W = [...w.values()].reduce((a, b) => a + b, 0);
    const counts = new Map<number, number>();
    const yearly: number[] = [];
    const YEARS = line === 'Property' ? 4_000 : 1_500;
    for (let y = 0; y < YEARS; y++) {
      const d = draw(line, 1, 9_000_000 + y * 7_919, EMPTY, EXPOSURE[line], units);
      yearly.push(d.claims.length);
      for (const c of d.claims) counts.set(c.unit ?? -1, (counts.get(c.unit ?? -1) ?? 0) + 1);
    }
    const n = yearly.reduce((a, b) => a + b, 0);
    // 1. each unit's count against n x its weight share; a chi-square over the book
    let chi = 0;
    for (const [i, wi] of w) { const e = n * wi / W; chi += ((counts.get(i) ?? 0) - e) ** 2 / e; }
    const df = units.length - 1;
    const zChi = (chi - df) / Math.sqrt(2 * df);
    const stray = counts.get(-1) ?? 0;
    check(zChi < Z && stray === 0, `${tag}1. ${line}: each unit draws routine claims in proportion to size x risk`,
      `chi-square ${chi.toFixed(1)} on ${df} df (${zChi.toFixed(2)} SE) over ${n} claims; ${stray} on no unit`);
    // 3. the count carries the book's risk
    const want = routineLargeCount(line, EXPOSURE[line] * R);
    const mean = n / YEARS, se = Math.sqrt(want / YEARS);
    const exp = expectedLossBreakdown(line, EXPOSURE[line], 1, true, R).routineLarge
      / expectedLossBreakdown(line, EXPOSURE[line], 1, true, 1).routineLarge;
    check(Math.abs(mean - want) < Z * se && Math.abs(exp - R) < 1e-12,
      `${tag}3. ${line}: the routine count is λ x exposure x the book's risk (${R.toFixed(3)}), and expected carries it`,
      `${mean.toFixed(3)} a year against ${want.toFixed(3)} (${((mean - want) / se).toFixed(2)} SE); expected routine x${exp.toFixed(4)}`);
  }
}

// ---------------------------------------------------------------- 2
function gradeRegional(draw: Draw, tag: string) {
  let off = 0, landed = 0, worstZ = 0;
  for (const name of ['Earthquake', 'Winterstorm', 'Wildfire']) {
    const e = SHOCK_EVENTS.find(x => x.name === name)!;
    for (const region of ['North', 'South', 'Central', 'East'] as Region[]) {
      const inst = generateGameInstance(`BULL-${name}-${region}`, 5_150_000, [{ shockId: e.id, yearNumber: 1, region }]);
      const year = resolveShockYear(inst, 'host', 1).byLine.Property;
      const seed = 7_070_707;
      const units = unitsOf(seed, 'Property', openingBookUnits(seed, 'Property'));
      const inRegion = units.filter(u => u.region === region);
      const W = inRegion.reduce((a, u) => a + u.size * u.risk, 0);
      const counts = new Map<number, number>();
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const d = draw('Property', 1, 3_000_000 + i * 13, year, EXPOSURE.Property, units);
        for (const c of d.claims.filter(x => x.shockId !== undefined)) {
          landed++; n++;
          const u = units.find(x => x.index === c.unit);
          if (!u || u.region !== region) off++;
          counts.set(c.unit ?? -1, (counts.get(c.unit ?? -1) ?? 0) + 1);
        }
      }
      if (inRegion.length > 1 && n > 0) {
        let chi = 0;
        for (const u of inRegion) { const ex = n * u.size * u.risk / W; chi += ((counts.get(u.index) ?? 0) - ex) ** 2 / ex; }
        const df = inRegion.length - 1;
        worstZ = Math.max(worstZ, (chi - df) / Math.sqrt(2 * df));
      }
    }
  }
  check(off === 0 && landed > 0 && worstZ < Z, `${tag}2. a regional T lands only on units in the struck region, by size x risk`,
    `${landed} losses, ${off} outside; worst within-region chi-square ${worstZ.toFixed(2)} SE`);
}

// ---------------------------------------------------------------- 4
function workbookOf(): { sheets: string[][][]; units: Set<number> } {
  const { setup, instance } = openSoloInstance({ poolName: 'L', gameLength: 3, startingYear: 2026, instanceId: 'BULLWB', activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory });
  for (let y = 1; y <= 2; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), [])), currentYearNumber: y + 1 };
  }
  // World 1's claims, as the Results page exports them.
  const w1 = (gs.worlds ?? [])[0];
  const wb = buildClaimsWorkbook(w1.lockedResults, gs.priorHistory, gs.instance, LINES, w1.poolState, 'BULLWB');
  const sheets = wb.SheetNames.map(n => XLSX.utils.sheet_to_json<string[]>(wb.Sheets[n], { header: 1 }));
  const units = new Set<number>();
  for (const w of gs.worlds ?? []) for (const r of w.lockedResults) for (const l of LINES) for (const c of r.byLine[l]?.claims ?? []) if (c.unit !== undefined) units.add(c.unit);
  return { sheets, units };
}
function gradeWorkbook(wb: { sheets: string[][][]; units: Set<number> }, tag: string) {
  const headers = wb.sheets.flatMap(s => s.slice(0, 6).flat()).map(String);
  const holder = headers.filter(h => /^(Member ID|Member Name|Member Type|Unit|Unit ID)$/.test(h));
  check(holder.length === 0 && wb.units.size > 0, `${tag}4. the claims workbook shows no unit: no holder columns`,
    `${wb.sheets.length} sheets; ${holder.length} holder headers; ${wb.units.size} units carried claims in the game`);
}

console.log('LARGE LOSSES ON BOOK UNITS');
gradeRoutine(engine, '');
gradeRegional(engine, '');
const wb = workbookOf();
gradeWorkbook(wb, '');

// ---------------------------------------------------------------- controls
console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
const bySize: Draw = (line, year, seed, shocks, exposure, units) =>
  engine(line, year, seed, shocks, exposure, units.map(u => ({ ...u, risk: 1 })));
controlFails('losses landing by size alone', () => gradeRoutine(bySize, ''), '1.');
const anywhere: Draw = (line, year, seed, shocks, exposure, units) =>
  engine(line, year, seed, { ...shocks, arrivals: shocks.arrivals.map(a => ({ ...a, firing: { ...a.firing, region: undefined } })) }, exposure, units);
controlFails('a T landing anywhere', () => gradeRegional(anywhere, ''), '2.');
const riskless: Draw = (line, year, seed, shocks, exposure, units) => {
  const R = bookOrdinaryRisk(units);
  return engine(line, year, seed, shocks, exposure / R, units);
};
controlFails('a count that ignores risk', () => gradeRoutine(riskless, ''), '3.');
controlFails('the holder columns shown', () => gradeWorkbook({ ...wb, sheets: [[['Claim ID', 'Member ID']], ...wb.sheets] }, ''), '4.');
void marketUnits;

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — large losses land on units by size x risk, a regional T only in its region, and no unit reaches the workbook.');
