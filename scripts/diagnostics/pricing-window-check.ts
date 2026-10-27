// ============================================================================
// PRICING KEEPS ITS ONE-YEAR DATA LAG — A GATE, and a dump of every rate.
//
//   npx tsx scripts/diagnostics/pricing-window-check.ts            # the gate
//   RATES_OUT=<file> npx tsx scripts/diagnostics/pricing-window-check.ts
//
// Results stopped running a year behind (utils/knownYears: the latest known
// year is the year just completed). That is a DISPLAY rule, and this holds the
// pricing side still. On every scenario, single-player, three lines, four
// played years at the defaults:
//
//   1. THE WINDOW: the pure premium for pricing year P (game year y) reads the
//      accident years y-6 to y-2 — for 2027, 2021 to 2025 — valued at the end
//      of y-2, the latest data year, from the pool's own ledger as it stood.
//   2. THE TREND: each of those years is trended from its own accident year to
//      P — 2021 by six years, 2025 by two: trendFactor = trend^(y - AY).
//   3. THE RATE THE ENGINE STRUCK IS THAT WINDOW'S: the year's struck pure
//      premium ingredients exist for every line and year.
//
// RATES_OUT writes every rate the engine struck — the final rate, the first
// indication, the new pure premium and loss cost, the pure premium, the ceded
// and net pure premium — per scenario, line and year, as JSON. Run it on the
// commit before a change and on the change, and compare the files byte for
// byte: a display-only change must leave every one of them exactly where it
// was.
//
// ⚠ AND EACH FAILS WHEN BROKEN: the controls feed the window predicate a
// window shifted one year forward (no data lag) and a trend counted from the
// latest data year rather than each accident year.
// ============================================================================

import * as fs from 'node:fs';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { SCENARIO_OPTIONS } from '../../src/utils/scenarios';
import { lossCostTrendPerYear, newPurePremiumPer100 } from '../../src/utils/newPurePremium';
import type { CoverageLine, GameSetupSettings, GameState, ReserveDevelopmentRow } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = 4;
const RATE_FIELDS = [
  'finalRatePer100', 'firstIndicationPer100', 'newPurePremiumPer100', 'newLossCostPer100',
  'purePremiumPer100', 'lossPurePremiumPer100', 'expectedCededPer100', 'netPurePremiumPer100',
] as const;

const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

/** The ledger as it stood when year y was priced: accident years before y, valuations up to y - 1. */
function ledgerAt(ledger: ReserveDevelopmentRow[], y: number): ReserveDevelopmentRow[] {
  return ledger.filter(r => r.yearNumber < y).map(r => {
    const n = y - r.firstValuationYear;
    return {
      ...r,
      ultimateByValuation: r.ultimateByValuation.slice(0, n),
      paidByValuation: (r.paidByValuation ?? []).slice(0, n),
      grossPaidByValuation: (r.grossPaidByValuation ?? []).slice(0, n),
    };
  });
}

interface Window { line: CoverageLine; scenario: string; y: number; years: number[]; factors: number[] }

function play(id: string): GameState {
  const { setup, instance } = openSoloInstance({
    poolName: 'P', gameLength: YEARS + 2, startingYear: 2027, instanceId: id, activeLines: LINES,
  } as GameSetupSettings);
  const shocks = gameShocksOn(setup, instance);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({
    setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [],
    currentDecisions: defaultDecisionSet(1, shocks), priorHistory, earlyPreGameHistory,
  } as GameState);
  for (let y = 1; y <= YEARS; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y, shocks)), [])), currentYearNumber: y + 1 };
  }
  return gs;
}

const windows: Window[] = [];
const rates: Record<string, Record<string, Record<string, Record<string, number | null>>>> = {};
for (const id of SCENARIO_OPTIONS) {
  const gs = play(id);
  rates[id] = {};
  for (const line of LINES) {
    rates[id][line] = {};
    const ledger = gs.poolState.lines[line].reserveDevelopment ?? [];
    for (let y = 1; y <= YEARS; y++) {
      const r = newPurePremiumPer100(line, y, { rows: ledgerAt(ledger, y), allMarketMembers: [], membershipHistory: {} });
      windows.push({ line, scenario: id, y, years: r?.points.map(p => p.accidentYear) ?? [], factors: r?.points.map(p => p.trendFactor) ?? [] });
      const row = gs.lockedResults.find(x => x.yearNumber === y)?.byLine[line] as unknown as Record<string, number | undefined> | undefined;
      rates[id][line][String(y)] = Object.fromEntries(RATE_FIELDS.map(f => [f, row?.[f] ?? null]));
    }
  }
}

function gradeWindow(ws: Window[], tag: string) {
  const bad = ws.filter(w => w.years.join(',') !== [w.y - 6, w.y - 5, w.y - 4, w.y - 3, w.y - 2].join(','));
  check(bad.length === 0, `${tag}1. pricing year P reads accident years P-6 to P-2 (2027: 2021-2025)`,
    bad.length ? `${bad[0].scenario} ${bad[0].line} y${bad[0].y}: [${bad[0].years.join(',')}]` : `${ws.length} line-years`);
}
function gradeTrend(ws: Window[], tag: string) {
  const bad = ws.filter(w => w.factors.some((f, i) => Math.abs(f / Math.pow(lossCostTrendPerYear(w.line), w.y - w.years[i]) - 1) > 1e-12));
  check(bad.length === 0, `${tag}2. each year trended from its own accident year to P (2021 by six years, 2025 by two)`,
    bad.length ? `${bad[0].scenario} ${bad[0].line} y${bad[0].y}` : `${ws.reduce((a, w) => a + w.factors.length, 0)} points`);
}

console.log(`PRICING KEEPS ITS DATA LAG — ${SCENARIO_OPTIONS.length} scenarios x ${LINES.length} lines x ${YEARS} years`);
gradeWindow(windows, '');
gradeTrend(windows, '');
const missing = Object.values(rates).flatMap(s => Object.values(s).flatMap(l => Object.values(l)))
  .filter(r => r.finalRatePer100 === null || r.newPurePremiumPer100 === null);
check(missing.length === 0, '3. every line-year has a struck rate and its new pure premium', `${missing.length} missing`);

console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('no data lag (the window one year forward)', () => gradeWindow(windows.map(w => ({ ...w, years: w.years.map(a => a + 1) })), ''), '1.');
controlFails('trend counted from the latest data year', () => gradeTrend(windows.map(w => ({ ...w, factors: w.factors.map(() => lossCostTrendPerYear(w.line)) })), ''), '2.');

if (process.env.RATES_OUT) {
  fs.writeFileSync(process.env.RATES_OUT, JSON.stringify(rates, null, 1) + '\n');
  console.log(`\nrates written: ${process.env.RATES_OUT}`);
}
console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — pricing reads P-6 to P-2, each year trended to P; every rate written for comparison.');
