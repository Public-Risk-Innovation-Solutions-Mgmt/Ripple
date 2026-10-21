// ============================================================================
// BOOK UNITS: THE MARKET AND THE BOOK — THE GATE.
//
//   npx tsx scripts/diagnostics/book-units-market-check.ts
//
// Each line's market is UNIT_MARKET_COUNT units drawn from the game seed, and
// the opening book about UNIT_POOL_SHARE of it (src/utils/bookUnits.ts). Over
// many seeds, on every line:
//
//   1. SIZES: the market sums EXACTLY to FULL_MARKET_EXPOSURE, and the sizes'
//      CV is UNIT_SIZE_CV.
//   2. RISK: the market's size-weighted mean risk is EXACTLY 1.0, and the risk
//      scores' CV is UNIT_RISK_CV.
//   3. REGIONS: units fall in each region at REGION_EXPOSURE_SHARE.
//   4. THE BOOK: it holds UNIT_POOL_SHARE of the market's exposure, overshooting
//      by less than its last unit, about 60 units.
//   5. DETERMINISM: the same seed gives the same market and book; another seed
//      gives another.
//   6. ONCE PER GAME: after a played year the book is on the game's pool state
//      only — no world's state and no year's record carries it — and it
//      survives a save round trip.
//
// ⚠ AND EACH FAILS WHEN BROKEN — every assertion is a predicate, and THE
// CONTROLS feed each one the figures it guards against.
// ============================================================================

import {
  FULL_MARKET_EXPOSURE, GAME_REGIONS, REGION_EXPOSURE_SHARE, UNIT_MARKET_COUNT, UNIT_POOL_SHARE, UNIT_RISK_CV,
  UNIT_SIZE_CV,
} from '../../src/data/pricingParameters';
import { marketUnits, openingBookUnits, type BookUnit } from '../../src/utils/bookUnits';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { packSave, unpackSave, type SavedGame } from '../../src/utils/gameSave';
import { restoreSavedGame } from '../../src/utils/saveRestore';
import type { CoverageLine, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SEEDS = Array.from({ length: 200 }, (_, i) => 1_000_003 + i * 7_919);
const Z = 4;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const meanSe = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return { mean: m, se: Math.sqrt(v / xs.length) };
};
const cvOf = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) / m;
};

type Market = { line: CoverageLine; units: readonly BookUnit[]; book: number[] };

// ---------------------------------------------------------------- predicates
function grade(markets: Market[], tag: string) {
  for (const line of LINES) {
    const ms = markets.filter(m => m.line === line);
    // 1. sizes
    const sumMiss = Math.max(...ms.map(m => Math.abs(m.units.reduce((a, u) => a + u.size, 0) / FULL_MARKET_EXPOSURE[line] - 1)));
    const sizeCv = meanSe(ms.map(m => cvOf(m.units.map(u => u.size))));
    check(sumMiss < 1e-12 && ms.every(m => m.units.length === UNIT_MARKET_COUNT), `${tag}1. ${line}: ${UNIT_MARKET_COUNT} units summing exactly to the full market`,
      `worst ${sumMiss.toExponential(2)}`);
    // The sample CV of 200 lognormals sits a little under the population CV;
    // the bar is the population figure within 4 SE plus that small-sample bias.
    check(Math.abs(sizeCv.mean - UNIT_SIZE_CV) < Z * sizeCv.se + 0.01, `${tag}1. ${line}: size CV ${UNIT_SIZE_CV}`,
      `mean ${sizeCv.mean.toFixed(4)} (± ${sizeCv.se.toFixed(4)})`);
    // 2. risk
    const riskMiss = Math.max(...ms.map(m => Math.abs(m.units.reduce((a, u) => a + u.size * u.risk, 0) / m.units.reduce((a, u) => a + u.size, 0) - 1)));
    const riskCv = meanSe(ms.map(m => cvOf(m.units.map(u => u.risk))));
    check(riskMiss < 1e-12, `${tag}2. ${line}: the market's size-weighted mean risk is exactly 1.0`, `worst ${riskMiss.toExponential(2)}`);
    check(Math.abs(riskCv.mean - UNIT_RISK_CV) < Z * riskCv.se + 0.01, `${tag}2. ${line}: risk CV ${UNIT_RISK_CV}`,
      `mean ${riskCv.mean.toFixed(4)} (± ${riskCv.se.toFixed(4)})`);
    // 3. regions, by count of units over every seed
    const all = ms.flatMap(m => m.units);
    const worstZ = Math.max(...GAME_REGIONS.map(r => {
      const p = REGION_EXPOSURE_SHARE[r], f = all.filter(u => u.region === r).length / all.length;
      return Math.abs(f - p) / Math.sqrt(p * (1 - p) / all.length);
    }), all.some(u => !GAME_REGIONS.includes(u.region)) ? Infinity : 0);
    check(worstZ < Z, `${tag}3. ${line}: units fall in each region at its share`,
      GAME_REGIONS.map(r => `${r} ${(100 * all.filter(u => u.region === r).length / all.length).toFixed(1)}%`).join(' ') + ` (worst ${worstZ.toFixed(2)} SE)`);
    // 4. the book
    let worstBook = 0;
    const counts: number[] = [];
    for (const m of ms) {
      const held = m.book.reduce((a, i) => a + m.units[i].size, 0);
      const target = UNIT_POOL_SHARE * FULL_MARKET_EXPOSURE[line];
      const last = Math.max(...m.book.map(i => m.units[i].size));
      const ok = held >= target && held - target < last;
      if (!ok) worstBook++;
      counts.push(m.book.length);
    }
    const c = meanSe(counts);
    check(worstBook === 0 && Math.abs(c.mean - UNIT_POOL_SHARE * UNIT_MARKET_COUNT) < 6,
      `${tag}4. ${line}: the book holds ${(100 * UNIT_POOL_SHARE).toFixed(0)}% of the market, overshooting by less than one unit`,
      `${worstBook} books off, ${c.mean.toFixed(1)} units on average (${Math.min(...counts)}-${Math.max(...counts)})`);
  }
}

// ---------------------------------------------------------------- the markets
const markets: Market[] = SEEDS.flatMap(seed => LINES.map(line => ({ line, units: marketUnits(seed, line), book: openingBookUnits(seed, line) })));
console.log(`BOOK UNITS — ${SEEDS.length} seeds x ${LINES.length} lines`);
grade(markets, '');

// 5. determinism
{
  const again = SEEDS.slice(0, 20).every(seed => LINES.every(line =>
    JSON.stringify(openingBookUnits(seed, line)) === JSON.stringify(openingBookUnits(seed, line))
    && JSON.stringify(marketUnits(seed, line)) === JSON.stringify(markets.find(m => m.line === line && m.units === marketUnits(seed, line))?.units)));
  const differ = LINES.every(line => JSON.stringify(openingBookUnits(SEEDS[0], line)) !== JSON.stringify(openingBookUnits(SEEDS[1], line))
    && marketUnits(SEEDS[0], line)[0].size !== marketUnits(SEEDS[1], line)[0].size);
  check(again && differ, '5. the same seed gives the same market and book; another seed another');
}

// 6. once per game, through a played year and a save
let played: GameState;
{
  const { setup, instance } = openSoloInstance({ poolName: 'B', gameLength: 2, startingYear: 2026, instanceId: 'BUMKT', activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory });
  gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(1)), [])), currentYearNumber: 2 };
  played = gs;
  const fromSeed = LINES.every(l => JSON.stringify(gs.poolState.bookUnits?.[l]) === JSON.stringify(openingBookUnits(instance.seed, l)));
  const env = { gameState: gs, startingFinancials: null, initialMembers: [], currentDecisions: defaultDecisionSet(2) };
  // The save keeps the averages only and a reload replays (commit 10): the
  // book must come back from the replay as it was.
  const back = unpackSave(packSave(env)) as { gameState: SavedGame };
  const reloaded = (await restoreSavedGame(back.gameState, null, undefined, async () => {})).gameState;
  const survives = JSON.stringify(reloaded.poolState.bookUnits) === JSON.stringify(gs.poolState.bookUnits);
  check(onceOnly(gs) && fromSeed && survives, '6. the book is on the game\'s pool state only, from the game seed, and survives a save',
    `${(gs.worlds ?? []).length} worlds without it; ${JSON.stringify(gs).split('"bookUnits"').length - 1} copy in the state`);
}
function onceOnly(gs: GameState): boolean {
  const json = JSON.stringify(gs);
  return !!gs.poolState.bookUnits && json.split('"bookUnits"').length - 1 === 1
    && (gs.worlds ?? []).every(w => w.poolState.bookUnits === undefined)
    && !JSON.stringify(gs.lockedResults).includes('"bookUnits"');
}

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
const alter = (f: (m: Market) => Market) => markets.map(f);
controlFails('sizes not scaled to the market', () => grade(alter(m => ({ ...m, units: m.units.map(u => ({ ...u, size: u.size * 1.01 })) })), ''), '1.');
controlFails('equal sizes', () => grade(alter(m => ({ ...m, units: m.units.map(u => ({ ...u, size: FULL_MARKET_EXPOSURE[m.line] / UNIT_MARKET_COUNT })) })), ''), '1.');
controlFails('risk not centred on the market', () => grade(alter(m => ({ ...m, units: m.units.map(u => ({ ...u, risk: u.risk * 1.05 })) })), ''), '2.');
controlFails('one region for every unit', () => grade(alter(m => ({ ...m, units: m.units.map(u => ({ ...u, region: 'North' as const })) })), ''), '3.');
controlFails('a book of half the market', () => grade(alter(m => ({ ...m, book: m.units.map(u => u.index).slice(0, 100) })), ''), '4.');
controlFails('the book copied into every world', () => {
  const gs = { ...played, worlds: (played.worlds ?? []).map(w => ({ ...w, poolState: { ...w.poolState, bookUnits: played.poolState.bookUnits } })) };
  check(onceOnly(gs), '6. once');
}, '6.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — every line\'s market and book are drawn as stated, from the game seed, and kept once per game.');
