// DERIVATION of the funding (CLF) tables ON THE NEW ENGINE — a generator.
//
//   npx tsx scripts/diagnostics/clf-newengine-derive.ts
//   GAMES=1000 LINES=WC npx tsx scripts/diagnostics/clf-newengine-derive.ts
//   DEV0=1 ...   the same games with no host prior development (the GL check)
//
// Solo games of one line at default decisions, ten years, one world: each line
// alone so no inter-line loan couples two derivations. For every line-year, the
// volatility-only ratio (scripts/tools/funding-ratio.ts):
//
//   (net incurred loss + LAE) / (the engine's expected retained loss + LAE)
//
// and the table is its percentiles at STOPS. CIs are a block bootstrap over
// whole games — a pool's years share a book, a ledger and a reserve.
//
// ⚠ NO CIRCULARITY, AND NO FIXED POINT TO CHASE. Neither side of the ratio reads
// a CLF: the numerator is losses, the denominator the engine's expectation, so
// the funding slider, the pre-game's cushion (PRE_GAME_FUNDING_CUSHION) and the
// reinsurance load (REINSURANCE_LOAD) cannot reach it. The table's one remaining
// reader that feeds back is the reserve margin at RESERVE_MARGIN_CONFIDENCE,
// which moves required capital and so the opening surplus — and surplus reaches
// neither losses nor expectation on a solo line. Run it twice anyway: the second
// pass, with the table installed, must reproduce the first.
//
// ALSO REPORTED, NOT FIXED: THE EXPERIENCE PURE PREMIUM'S SHORTFALL. Actual over
// the experience pure premium's retained funding (what the rate charges at CLF
// 1), the experience over the engine's expectation, and that split by whether a
// shock landed in the five-year pricing window.
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SeededRandom } from '../../src/utils/random';
import { actualRetainedWithLae, experienceRetained, expectedRetainedWithLae, fundingRatio } from '../tools/funding-ratio';
import type { CoverageLine, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 1000);
const YEARS = 10;
const BOOT = 400;
const DEV0 = process.env.DEV0 === '1';
const STOPS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 97.5, 99];
const WINDOW = 5;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
function q(sorted: number[], p: number): number {
  const i = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (i - lo) * (sorted[hi] - sorted[lo]);
}

interface Row { ratio: number; actualOverExperience: number; experienceOverExpected: number; shockInWindow: boolean; year: number; actual: number; experience: number; expected: number }

function collect(line: CoverageLine): Row[][] {
  const games: Row[][] = [];
  for (let g = 0; g < GAMES; g++) {
    const id = `CLFN${line}${g}`;
    const inst = generateGameInstance(id, 1_700_000 + g * 7013);
    const setup = {
      poolName: 'D', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: [line],
      ...(DEV0 ? { priorDevelopment: { WC: 0, GL: 0, Property: 0 } } : {}),
    } as GameSetupSettings;
    const { poolState, priorHistory } = runPriorHistory(inst, setup);
    let gs = {
      setup, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    } as GameState;
    // Years a shock landed on the line, pre-game included, for the window split.
    const shocked = priorHistory
      .filter(h => (h.byLine[line]?.newLossEngine?.shockLargeClaims ?? 0) > 0)
      .map(h => h.yearNumber);
    const rows: Row[] = [];
    for (let y = 1; y <= YEARS; y++) {
      const p = processYear(gs, defaultDecisionSet(y));
      const r = p.result.byLine[line] as LineResultSet;
      const expected = expectedRetainedWithLae(line, r);
      rows.push({
        ratio: fundingRatio(line, r),
        actualOverExperience: actualRetainedWithLae(r) / experienceRetained(r),
        experienceOverExpected: experienceRetained(r) / expected,
        shockInWindow: shocked.some(k => k >= y - WINDOW && k < y),
        year: y,
        actual: actualRetainedWithLae(r), experience: experienceRetained(r), expected,
      });
      if ((r.newLossEngine?.shockLargeClaims ?? 0) > 0) shocked.push(y);
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
    games.push(rows);
  }
  return games;
}

function derive(line: CoverageLine) {
  const t0 = Date.now();
  const games = collect(line);
  const all = games.flat();
  const sorted = all.map(r => r.ratio).sort((a, b) => a - b);
  const rng = new SeededRandom(515151);
  const boot: number[][] = STOPS.map(() => []);
  const crossBoot: number[] = [];
  for (let b = 0; b < BOOT; b++) {
    const sample: number[] = [];
    for (let i = 0; i < games.length; i++) for (const r of games[Math.floor(rng.next() * games.length)]) sample.push(r.ratio);
    sample.sort((a, c) => a - c);
    STOPS.forEach((p, k) => boot[k].push(q(sample, p)));
    crossBoot.push(sample.filter(x => x <= 1).length / sample.length);
  }
  const ci = (xs: number[]) => { const s = [...xs].sort((a, c) => a - c); return [s[Math.floor(0.025 * (s.length - 1))], s[Math.floor(0.975 * (s.length - 1))]]; };

  console.log(`\n=== ${line}${DEV0 ? ' (no host prior development)' : ''} — ${all.length.toLocaleString()} line-years, ${GAMES} games, ${((Date.now() - t0) / 1000).toFixed(0)}s ===`);
  console.log('  stop     CLF      95% CI');
  const table = STOPS.map((p, k) => {
    const v = q(sorted, p);
    const [lo, hi] = ci(boot[k]);
    console.log(`  ${String(p).padStart(5)}   ${v.toFixed(4)}   [${lo.toFixed(4)}, ${hi.toFixed(4)}]`);
    return v;
  });
  const cross = all.filter(r => r.ratio <= 1).length / all.length;
  const [clo, chi] = ci(crossBoot);
  console.log(`  "at expected" (CLF 1.000) covers ${(100 * cross).toFixed(1)}% of line-years [${(100 * clo).toFixed(1)}, ${(100 * chi).toFixed(1)}]`);
  console.log(`  mean ratio ${mean(all.map(r => r.ratio)).toFixed(4)}, median ${q(sorted, 50).toFixed(4)}`);
  console.log('  covered at CLF 1 by year: ' + Array.from({ length: YEARS }, (_, i) => {
    const yr = all.filter(r => r.year === i + 1);
    return `Y${i + 1} ${(100 * yr.filter(r => r.ratio <= 1).length / yr.length).toFixed(0)}%`;
  }).join(' '));

  const inWin = all.filter(r => r.shockInWindow), outWin = all.filter(r => !r.shockInWindow);
  console.log('  THE EXPERIENCE PURE PREMIUM — reported, not fixed:');
  console.log(`    actual / experience funding: mean ${mean(all.map(r => r.actualOverExperience)).toFixed(4)}`);
  console.log(`    experience / the engine's expectation: mean ${mean(all.map(r => r.experienceOverExpected)).toFixed(4)}`
    + ` — a shock in the ${WINDOW}-year window ${mean(inWin.map(r => r.experienceOverExpected)).toFixed(4)} (${(100 * inWin.length / all.length).toFixed(0)}% of years),`
    + ` none ${mean(outWin.map(r => r.experienceOverExpected)).toFixed(4)}`);
  const sum = (f: (r: Row) => number) => all.reduce((a, r) => a + f(r), 0);
  console.log(`    in aggregate (sums over all line-years): actual / experience ${(sum(r => r.actual) / sum(r => r.experience)).toFixed(4)},`
    + ` experience / expectation ${(sum(r => r.experience) / sum(r => r.expected)).toFixed(4)}, actual / expectation ${(sum(r => r.actual) / sum(r => r.expected)).toFixed(4)}`);
  console.log(`\n  ${line}: [${table.map(v => v.toFixed(4)).join(', ')}],`);
}

console.log(`=== FUNDING TABLES ON THE NEW ENGINE — ${GAMES} solo games x ${YEARS} years per line, defaults ===`);
for (const l of (process.env.LINES ?? 'WC,GL,Property').split(',').map(x => x.trim()) as CoverageLine[]) derive(l);
console.log('\nDONE — derivation only. Nothing written; copy the literals by hand.');
