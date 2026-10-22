// ============================================================================
// THE FUNDING TABLES ON THE NEW ENGINE — THE GATE.
//
//   npx tsx scripts/diagnostics/funding-table-check.ts
//
// The WC, GL and Property funding (CLF) tables in force are the BaselineCV
// tables (clfTables.ts, BASELINE_CV_TABLES): percentiles of a line's ORDINARY
// loss over its expected ordinary loss, by the data scientist's method. On
// every line:
//
//   1. THE SLIDER'S LEVELS ARE TRUE ON ORDINARY LOSSES, OUT OF SAMPLE: on games
//      the derivation never drew, the table's CLF at each stop covers that
//      share of line-years' ordinary loss ratio — the engine's own
//      ordinaryFactor, realised over expected, before any shock's uplift —
//      within 5pp; and "at expected" (CLF 1.000) covers what the table's own
//      `expected` says.
//
//   ⚠ ORDINARY LOSSES, NOT THE WHOLE RETAINED LOSS, AND THAT IS THE RULING.
//   The tables cover ordinary losses only, by design: shocks and large losses
//   are surplus's and reinsurance's job, not the funding factor's. Until the
//   funding tables wiring this check scored the stops on the whole retained
//   loss + LAE (scripts/tools/funding-ratio.ts), which was the right basis
//   for the new-engine tables it was written for. Against the BaselineCV
//   tables that basis reads WC +35.7pp at 30% and GL -24.1pp at 90% — the
//   large losses and shocks the tables deliberately leave out, measured, not a
//   defect in the tables.
//   2. REQUIRED CAPITAL READS THE SAME TABLE: the reserve margin is expected
//      net unpaid x (the table at RESERVE_MARGIN_CONFIDENCE - 1), exactly.
//   3. THE REINSURANCE LOAD READS NO TABLE: every placed layer costs its
//      expected cession x (1 + REINSURANCE_LOAD), and does with the tables
//      swapped for others.
//   4. THE PRE-GAME FUNDS AT ITS SOLVED MARGIN AND READS NO TABLE: every
//      pre-game year charges CLF exactly 1 + the prior board's margin, one
//      margin across a game's pre-game years (solved per scenario and line,
//      stable-scenarios commit 9; it was the fixed 14% cushion), and the
//      pre-game is unchanged with the tables swapped.
//
// ⚠ AND EACH FAILS WHEN BROKEN — THE CONTROLS: the member-engine tables, each
// line graded against the BaselineCV table four points from its own (WC and
// Property up to 10% and 12%, GL down to 6%), a margin off a different stop, a
// load read off the 70% stop, and a pre-game funded at the 70% stop.
//
// AND WITH THE ENGINE BROKEN BY HAND, MEASURED: ordinaryLossFromUnits drawing
// its year factor at the old 0.02 instead of the line's BASELINE_CV — exit 1,
// all three lines fail 1 (worst WC -21.3pp, GL -29.0pp, Property -27.3pp at
// the 30% stop; GAMES=40).
// ============================================================================

import {
  BASELINE_CV_TABLES, GL_SUPPLIED, PROPERTY_DERIVED, RESERVE_MARGIN_CONFIDENCE, STATIC_CLF_TABLE, WC_SUPPLIED,
  baselineCvKey, crossingOf, staticClf, type ClfTable, type StaticClfLine,
} from '../../src/data/clfTables';
import { BASELINE_CV, FULL_SAVINGS_AT, REINSURANCE_LOAD } from '../../src/data/pricingParameters';
import { REINSURANCE_TOWER } from '../../src/data/reinsuranceTower';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { allLayerRiskMoments } from '../../src/utils/towerMoments';
import { layerPremium } from '../../src/utils/reinsuranceTower';
import type { GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

const LINES: StaticClfLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 120);
const YEARS = 10;
const TOL = 5;
const STOPS = [30, 50, 70, 90, 95];
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

// The tables in force before the re-derivation — the controls' broken tables.
const PREVIOUS: Record<StaticClfLine, ClfTable> = { WC: WC_SUPPLIED, GL: GL_SUPPLIED, Property: PROPERTY_DERIVED };
const SHIPPED = { ...STATIC_CLF_TABLE };
const withTables = <T>(tables: Record<StaticClfLine, ClfTable>, run: () => T): T => {
  Object.assign(STATIC_CLF_TABLE, tables);
  try { return run(); } finally { Object.assign(STATIC_CLF_TABLE, SHIPPED); }
};

interface LineYear { ratio: number; marginFactor: number; clfNinety: number }
interface PreGameYear { clf: number; premium: number; margin: number; game: number }
interface Played { years: Record<StaticClfLine, LineYear[]>; preGame: Record<StaticClfLine, PreGameYear[]> }

/** Solo games of each line at defaults, on seeds the derivation never drew. */
function play(games: number): Played {
  const years = { WC: [], GL: [], Property: [] } as Played['years'];
  const preGame = { WC: [], GL: [], Property: [] } as Played['preGame'];
  for (const line of LINES) {
    for (let g = 0; g < games; g++) {
      const id = `FTC${line}${g}`;
      const inst = generateGameInstance(id, 8_300_000 + g * 6_011);
      const setup = { poolName: 'F', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: [line] } as GameSetupSettings;
      const { poolState, priorHistory } = runPriorHistory(inst, setup);
      for (const h of priorHistory) {
        const r = h.byLine[line] as LineResultSet | undefined;
        if (r) preGame[line].push({ clf: r.selectedFundingCLF, premium: r.poolPremium, margin: r.decisions.fundingCushion ?? NaN, game: g });
      }
      // ⚠ AT FULL SAVINGS ON NEW BUSINESS (rejection FULL_SAVINGS_AT). The
      // default writes new business at the 20% first-year penalty, which by
      // design is not in expected loss, so its ordinary ratio sits about
      // newShare x 20% (~1%) above 1 — a known first-year bias, not the
      // distribution these tables describe. At full savings the penalty is 1.
      const decide = (y: number) => {
        const d = defaultDecisionSet(y);
        d.byLine[line].newBusinessRejection = FULL_SAVINGS_AT;
        return d;
      };
      let gs = { setup, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: decide(1), priorHistory } as GameState;
      for (let y = 1; y <= YEARS; y++) {
        const p = processYear(gs, decide(y));
        const r = p.result.byLine[line] as LineResultSet;
        // The ordinary loss ratio the tables describe — see the header.
        const ordinary = r.newLossEngine?.ordinaryFactor;
        if (ordinary === undefined) throw new Error(`${id} ${line} year ${y}: no new-engine record — the tables describe the new engine's ordinary losses`);
        years[line].push({
          ratio: ordinary,
          marginFactor: (r.reserveRiskMarginNeeded - r.catCapitalNeeded) / r.expectedNetUnpaidLoss,
          clfNinety: staticClf(line, RESERVE_MARGIN_CONFIDENCE),
        });
        gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
      }
    }
  }
  return { years, preGame };
}

// ---------------------------------------------------------------- 1
function gradeLevels(played: Played, tables: Record<StaticClfLine, ClfTable>, tag: string) {
  for (const line of LINES) {
    const xs = played.years[line].map(r => r.ratio);
    const covered = (clf: number) => 100 * xs.filter(x => x <= clf).length / xs.length;
    const errs = STOPS.map(p => covered(withTables(tables, () => staticClf(line, p / 100))) - p);
    const crossingErr = covered(1) - 100 * crossingOf(tables[line]);
    const worst = [...errs, crossingErr].reduce((a, e) => (Math.abs(e) > Math.abs(a) ? e : a), 0);
    check(Math.abs(worst) <= TOL, `${tag}1. ${line}: each stop covers its share of line-years' ordinary losses, and "at expected" its crossing, out of sample`,
      `${STOPS.map((p, i) => `${p}% ${errs[i] >= 0 ? '+' : ''}${errs[i].toFixed(1)}`).join(', ')}; at expected `
      + `${covered(1).toFixed(1)}% vs ${(100 * crossingOf(tables[line])).toFixed(1)}% — worst ${worst.toFixed(1)}pp over ${xs.length} line-years`);
  }
}

// ---------------------------------------------------------------- 2
function gradeMargin(played: Played, stop: number, tag: string) {
  let worst = 0;
  for (const line of LINES) for (const r of played.years[line]) worst = Math.max(worst, Math.abs(r.marginFactor / (staticClf(line, stop) - 1) - 1));
  check(worst < 1e-9, `${tag}2. required capital's reserve margin is expected net unpaid x (the table at ${RESERVE_MARGIN_CONFIDENCE * 100}% - 1)`,
    `worst relative ${worst.toExponential(2)}; CLF90 ${LINES.map(l => `${l} ${staticClf(l, RESERVE_MARGIN_CONFIDENCE).toFixed(4)}`).join(', ')}`);
}

// ---------------------------------------------------------------- 3
type Price = (line: StaticClfLine, k: number, expected: number) => number;
function gradeLoad(price: Price, tag: string) {
  let worst = 0, n = 0;
  const swapped = { WC: PREVIOUS.WC, GL: PREVIOUS.GL, Property: PREVIOUS.Property };
  for (const tables of [SHIPPED, swapped]) {
    withTables(tables as Record<StaticClfLine, ClfTable>, () => {
      for (const line of LINES) for (const y of [1, 5, 10]) {
        const book = { exposure: line === 'Property' ? 18_000 : 400 };
        const moments = allLayerRiskMoments(line, book, y);
        REINSURANCE_TOWER[line].forEach((l, k) => {
          if (!l.purchasable) return;
          n++;
          worst = Math.max(worst, Math.abs(price(line, k, moments[k].expected) / layerPremium(line, k, book, y) - 1));
        });
      }
    });
  }
  check(worst < 1e-12 && n > 0, `${tag}3. every layer costs its expected cession x (1 + ${REINSURANCE_LOAD}), whatever the tables say`,
    `${n} layer-years over the shipped and the previous tables; worst relative ${worst.toExponential(2)}`);
}

// ---------------------------------------------------------------- 4
function gradePreGame(played: Played, swapped: Played, want: (line: StaticClfLine, p: PreGameYear) => number, tag: string) {
  let worstClf = 0, worstSwap = 0, n = 0, spread = 0;
  const margins: number[] = [];
  for (const line of LINES) {
    played.preGame[line].forEach((p, i) => {
      n++;
      worstClf = Math.max(worstClf, Math.abs(p.clf - want(line, p)));
      worstSwap = Math.max(worstSwap, Math.abs(swapped.preGame[line][i].premium / p.premium - 1));
      const first = played.preGame[line].find(q => q.game === p.game)!;
      spread = Math.max(spread, Math.abs(p.margin - first.margin));
      margins.push(p.margin);
    });
  }
  check(worstClf < 1e-12 && spread === 0 && worstSwap === 0 && n > 0,
    `${tag}4. every pre-game year funds at CLF 1 + the prior board's one solved margin, and swapping the tables moves no pre-game premium`,
    `${n} pre-game line-years, margins ${(Math.min(...margins) * 100).toFixed(1)}% to ${(Math.max(...margins) * 100).toFixed(1)}%; `
    + `worst CLF off ${worstClf.toExponential(2)}, worst premium moved ${worstSwap.toExponential(2)}`);
}

console.log(`THE FUNDING TABLES — ${GAMES} solo games x ${YEARS} years per line, seeds the derivation never drew`);
const played = play(GAMES);
const swappedPreGame = withTables(PREVIOUS, () => play(4));
const firstFour = { ...played, preGame: Object.fromEntries(LINES.map(l => [l, played.preGame[l].slice(0, swappedPreGame.preGame[l].length)])) } as Played;
gradeLevels(played, SHIPPED as Record<StaticClfLine, ClfTable>, '');
gradeMargin(played, RESERVE_MARGIN_CONFIDENCE, '');
const loadPrice: Price = (_line, _k, expected) => expected * (1 + REINSURANCE_LOAD);
gradeLoad(loadPrice, '');
gradePreGame(firstFour, swappedPreGame, (_l, p) => 1 + p.margin, '');

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
controlFails('the member-engine tables', () => gradeLevels(played, PREVIOUS, ''), '1.');
// Four points off each line's own BaselineCV: the wrong table for the losses drawn.
const OFF_BY_FOUR = { WC: 0.04, GL: -0.04, Property: 0.04 } as Record<StaticClfLine, number>;
const wrongCv = Object.fromEntries(LINES.map(l => [l, BASELINE_CV_TABLES[baselineCvKey(BASELINE_CV[l] + OFF_BY_FOUR[l])][l]])) as Record<StaticClfLine, ClfTable>;
controlFails('each line graded against the table four points off its BaselineCV', () => gradeLevels(played, wrongCv, ''), '1.');
controlFails('a margin read off the 95% stop', () => gradeMargin(played, 0.95, ''), '2.');
controlFails('a load read off the table at 70%', () => gradeLoad((line, _k, e) => e * staticClf(line, 0.70), ''), '3.');
controlFails('a pre-game funded at the 70% stop', () => gradePreGame(firstFour, swappedPreGame, l => staticClf(l, 0.70), ''), '4.');

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS — the slider\'s levels are true on ordinary losses out of sample, required capital reads the same table, and neither the load nor the pre-game reads one.');
