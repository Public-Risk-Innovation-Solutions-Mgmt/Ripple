// ============================================================================
// THE NEW-BUSINESS PENALTY ON BOOK UNITS — THE GATE.
//
//   npx tsx scripts/diagnostics/book-units-penalty-check.ts
//
// Book units written this year cost NEW_BUSINESS_PENALTY more on their ACTUAL
// ordinary losses, in their first year only; expected loss does not carry it,
// so the rate learns it only through the history. In ten-world games with
// intake at 8%, every line and world:
//
//   1. ACTUAL INCLUDES IT: each year's ordinary loss is the units' draw with
//      the units written that year loaded by the penalty — exactly.
//   2. EXPECTED DOES NOT: the year's expected loss is the book's expectation
//      with no penalty term.
//   3. FIRST YEAR ONLY: a unit written last year and renewed carries none.
//   4. NEW UNITS ONLY: a unit the book already held carries none.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS rebuild each year's figures
// with the penalty in expected, on every unit, and lingering a second year.
// ============================================================================

import { NEW_BUSINESS_PENALTY } from '../../src/data/pricingParameters';
import { exposureFactor } from '../../src/data/exposureTrend';
import { marketSeedOf, unitsOf } from '../../src/utils/bookUnits';
import { bookOrdinaryRisk, ordinaryLossFromUnits } from '../../src/utils/ordinaryLoss';
import { expectedLossBreakdown } from '../../src/utils/shockExpectation';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear, worldInstance } from '../../src/utils/worlds';
import type { CoverageLine, DecisionSet, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

/** One line-year in one world, as the engine reported it and as the books say it should be. */
interface Obs {
  line: CoverageLine; world: number; year: number;
  ordinary: number; expected: number;
  before: number[]; after: number[]; seed: number; marketSeed: number; exposure: number;
  /** The game's shock switch (gameShocksOn): its expected loss is struck on it. */
  shocks: boolean;
}

function play(id: string): Obs[] {
  const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: 5, startingYear: 2026, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const decide = (y: number): DecisionSet => {
    const d = defaultDecisionSet(y);
    return { ...d, byLine: Object.fromEntries(LINES.map(l => [l, { ...d.byLine[l], intakeLevel: 3 }])) as DecisionSet['byLine'] };
  };
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: decide(1), priorHistory, earlyPreGameHistory });
  const out: Obs[] = [];
  for (let y = 1; y <= 4; y++) {
    const before = gs.poolState.bookUnits!;
    const played = playWorldsYear(gs, decide(y));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
    const after = gs.poolState.bookUnits!;
    played.perWorld.forEach((p, w) => {
      for (const line of LINES) {
        const r = p.result.byLine[line];
        const n = r.newLossEngine!;
        out.push({
          line, world: w, year: y,
          ordinary: n.ordinaryRealised / (1 + n.uplift), expected: r.expectedLoss,
          before: before[line]!, after: after[line]!, seed: worldInstance(instance, w).seed,
          shocks: gameShocksOn(setup, instance),
          marketSeed: marketSeedOf(instance),
          // The book's own exposure this year — its units' sizes x the year's
          // trend — exactly as the draw took it (the result's is rounded).
          exposure: unitsOf(marketSeedOf(instance), line, after[line]!).reduce((a, u) => a + u.size, 0) * exposureFactor(line, y),
        });
      }
    });
  }
  return out;
}

type Rebuild = (o: Obs) => { ordinary: number; expected: number };
// The figures the books say: the year's draw on the book after movement, the
// units it did not hold before loaded; and expected on its risk, unloaded.
const truth: Rebuild = o => {
  const units = unitsOf(o.marketSeed, o.line, o.after);
  const held = new Set(o.before);
  const fresh = new Set(o.after.filter(i => !held.has(i)));
  const draw = ordinaryLossFromUnits(o.line, units, o.exposure, o.year, o.seed, fresh, NEW_BUSINESS_PENALTY);
  return { ordinary: draw.realised, expected: expectedLossBreakdown(o.line, o.exposure, o.year, undefined, bookOrdinaryRisk(units), o.shocks).total };
};

function grade(obs: Obs[], rebuild: Rebuild, tag: string) {
  let worstActual = 0, worstExpected = 0, years = 0, withNew = 0, loaded = 0;
  for (const o of obs) {
    const t = rebuild(o);
    worstActual = Math.max(worstActual, Math.abs(o.ordinary / t.ordinary - 1));
    worstExpected = Math.max(worstExpected, Math.abs(o.expected / t.expected - 1));
    years++;
    const fresh = o.after.filter(i => !o.before.includes(i));
    if (fresh.length) {
      withNew++;
      const plain = ordinaryLossFromUnits(o.line, unitsOf(o.marketSeed, o.line, o.after), o.exposure, o.year, o.seed).realised;
      if (o.ordinary > plain) loaded++;
    }
  }
  check(worstActual < 1e-12 && withNew > 0 && loaded === withNew,
    `${tag}1. actual ordinary loss loads the units written that year, exactly; 3-4. first year and new units only`,
    `worst ${worstActual.toExponential(2)} over ${years} line-years, ${withNew} with new units, every one loaded`);
  check(worstExpected < 1e-12, `${tag}2. expected loss carries no penalty`, `worst ${worstExpected.toExponential(2)}`);
}

console.log(`THE NEW-BUSINESS PENALTY — ${NEW_BUSINESS_PENALTY * 100}% on new units' first-year actual ordinary losses`);
const obs = [...play('BUPEN1'), ...play('BUPEN2')];
grade(obs, truth, '');

// ---------------------------------------------------------------- controls
console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, rebuild: Rebuild, expect: string) => {
  const before = failures.length;
  const saved = console.log; console.log = () => {};
  grade(obs, rebuild, '');
  console.log = saved;
  const caught = failures.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
controlFails('the penalty in expected loss', o => {
  const t = truth(o);
  const units = unitsOf(o.marketSeed, o.line, o.after);
  const freshSize = o.after.filter(i => !o.before.includes(i)).reduce((a, i) => a + units.find(u => u.index === i)!.size, 0);
  const share = freshSize / units.reduce((a, u) => a + u.size, 0);
  const b = expectedLossBreakdown(o.line, o.exposure, o.year, undefined, bookOrdinaryRisk(units), o.shocks);
  return { ...t, expected: t.expected + NEW_BUSINESS_PENALTY * share * (b.ordinary + b.uplift) };
}, '2.');
controlFails('the penalty on every unit', o => {
  const units = unitsOf(o.marketSeed, o.line, o.after);
  return { ...truth(o), ordinary: ordinaryLossFromUnits(o.line, units, o.exposure, o.year, o.seed, new Set(o.after), NEW_BUSINESS_PENALTY).realised };
}, '1.');
controlFails('the penalty lingering a second year', o => {
  // Loads the units written last year as well: every unit not in the opening book.
  const units = unitsOf(o.marketSeed, o.line, o.after);
  const opening = new Set(obs.find(x => x.line === o.line && x.year === 1 && x.world === o.world)!.before);
  const fresh = new Set(o.after.filter(i => !opening.has(i)));
  return { ...truth(o), ordinary: ordinaryLossFromUnits(o.line, units, o.exposure, o.year, o.seed, fresh, NEW_BUSINESS_PENALTY).realised };
}, '1.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — new units carry the penalty on their actual losses in their first year only, and expected carries none.');
