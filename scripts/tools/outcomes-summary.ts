// ============================================================================
// OUTCOMES BY DECISION PROFILE — what a pool actually experiences, per line,
// under each of the choices a team can make.
//
//   npx tsx scripts/tools/outcomes-summary.ts
//   npx tsx scripts/tools/outcomes-summary.ts --games 24
//   npx tsx scripts/tools/outcomes-summary.ts --set SEVERITY_TREND_PER_YEAR.WC=0.07
//   npx tsx scripts/tools/outcomes-summary.ts --profile 'funding: 90%' --games 40
//
// Flags: --games N (default 12), --years N (default 10, and 10 is the minimum
// for the year-10 surplus column), --profile NAME to run one of them alone,
// and any number of --set NAME=VALUE overrides — see
// pricing-overrides-install.ts for what those reach.
//
// A typical run is 17 seconds, measured: 7 profiles x 12 games x 10 years x 3
// lines, played through the real engine. It scales linearly in both --games
// and the profile count — --games 48 is about 70s, one profile at --games 40
// about 8s.
//
// ============================================================================
// ⚠ THE COMBINED RATIO HERE IS WORKED OUT, NOT READ OFF THE RESULT, AND THE
// REASON IS THAT ONE OF THE ENGINE'S TWO IS PINNED.
//
// `expectedCombinedRatio` is expectedLossRatioMemberBasis + expectedExpenseRatio,
// and at CLF 1.000 that is exactly 1.0000 BY CONSTRUCTION — pool premium plus
// admin plus reinsurance is identically the member charge, so the identity
// closes and the figure carries no information about how the year went. Read
// as an outcome it says every pool at expected funding broke even exactly,
// which is not a finding, it is an algebraic restatement of the billing.
//
// So this computes
//
//     combined = (net incurred loss + admin + reinsurance) / member charge
//
// from the realised dollars. That is the engine's `actualCombinedRatio` — the
// unpinned one — and section 0 asserts the two agree rather than asking the
// reader to take it on trust. The point of recomputing is not distrust of the
// engine; it is that a reader of this table should be able to see which of the
// two figures it is.
//
// ⚠ AND THE SURPLUS COLUMNS CARRY A MINIMUM, NOT JUST A MEAN. Averaging over
// ten worlds flatters a profile that is cheap most of the time and ruinous
// occasionally — which is exactly the shape of declining reinsurance. The
// minimum and the 10th percentile are what separate "cheaper" from "cheaper
// until it is not", and the two frequency columns at the right say how often
// the pool ended a year unable to cover its own reserve risk margin, or short.
// ============================================================================

// ⚠ FIRST IMPORT — it re-execs with the override loader when --set is present.
import { argvWithoutOverrides, overridesBanner, pricingOverrides } from './pricing-overrides-install';
import { startRunLog } from './runlog';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { NEW_RATE_STACK } from '../../src/data/pricingParameters';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const RULE = '='.repeat(118);

function flag(name: string, fallback: string): string {
  const i = argvWithoutOverrides.indexOf(`--${name}`);
  return i >= 0 && argvWithoutOverrides[i + 1] !== undefined ? argvWithoutOverrides[i + 1] : fallback;
}
const GAMES = Number(flag('games', '12'));
const YEARS = Number(flag('years', '10'));
const ONLY = argvWithoutOverrides.includes('--profile') ? flag('profile', '') : null;

// ---------------------------------------------------------------------------
// THE PROFILES. One knob moved at a time from all-defaults, so a difference
// between two rows has one cause. The defaults are named rather than implied:
// "funding: expected", "layers: all placed" and "risk control: 0%" ARE the
// default decisions, and they are listed so the reader can see what the other
// rows are being compared against without going to look it up.
// ---------------------------------------------------------------------------
interface Profile { name: string; apply: (d: DecisionSet) => void }

const PROFILES: Profile[] = [
  { name: 'funding: expected (default)', apply: d => { for (const l of LINES) { d.byLine[l].fundingAtExpected = true; } } },
  { name: 'funding: 70%', apply: d => { for (const l of LINES) { d.byLine[l].fundingAtExpected = false; d.byLine[l].fundingConfidenceLevel = 0.70; } } },
  { name: 'funding: 90%', apply: d => { for (const l of LINES) { d.byLine[l].fundingAtExpected = false; d.byLine[l].fundingConfidenceLevel = 0.90; } } },
  { name: 'layers: all placed (default)', apply: d => { for (const l of LINES) { d.byLine[l].layersPlaced = d.byLine[l].layersPlaced.map(() => true); } } },
  { name: 'layers: all declined', apply: d => { for (const l of LINES) { d.byLine[l].layersPlaced = d.byLine[l].layersPlaced.map(() => false); } } },
  { name: 'risk control: 0% (default)', apply: d => { for (const l of LINES) { d.byLine[l].riskControlIncentivePct = 0; } } },
  { name: 'risk control: 5%', apply: d => { for (const l of LINES) { d.byLine[l].riskControlIncentivePct = 0.05; } } },
];

const chosen = ONLY === null ? PROFILES : PROFILES.filter(p => p.name.startsWith(ONLY));
if (chosen.length === 0) {
  console.error(`--profile "${ONLY}" matches none of:\n  ${PROFILES.map(p => p.name).join('\n  ')}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = sorted(xs);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
const share = (xs: boolean[]) => (xs.length === 0 ? NaN : xs.filter(Boolean).length / xs.length);
const m$ = (v: number) => (Number.isFinite(v) ? `${v < 0 ? '-' : ''}$${Math.abs(v / 1e6).toFixed(1)}M` : '—');
const p1 = (v: number) => (Number.isFinite(v) ? `${(100 * v).toFixed(1)}%` : '—');
const n2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');
const n3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '—');

interface Cell {
  rates: number[];
  changes: number[];
  lossRatios: number[];
  combined: number[];
  engineCombined: number[];
  surplusAt: Map<number, number[]>;
  belowRequired: boolean[];
  belowZero: boolean[];
}
const emptyCell = (): Cell => ({
  rates: [], changes: [], lossRatios: [], combined: [], engineCombined: [],
  surplusAt: new Map(), belowRequired: [], belowZero: [],
});

function run(profile: Profile): Record<string, Cell> {
  const cells: Record<string, Cell> = {};
  for (const l of LINES) cells[l] = emptyCell();

  for (let g = 0; g < GAMES; g++) {
    const id = `OUT${g}`;
    const instance = generateGameInstance(id, 2_600_000 + g * 7919);
    const setup = {
      poolName: 'Outcomes', gameLength: YEARS + 1, startingYear: 2026,
      instanceId: id, activeLines: LINES,
    };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    const lastRate: Record<string, number | undefined> = {};

    for (let y = 1; y <= YEARS; y++) {
      const d = defaultDecisionSet(y);
      profile.apply(d);
      const processed = processYear(gs, d);
      for (const l of LINES) {
        const r = processed.result.byLine[l];
        if (r === undefined) continue;
        const c = cells[l];
        c.rates.push(r.ratePer100);
        const prev = lastRate[l];
        if (prev !== undefined && prev > 0) c.changes.push(r.ratePer100 / prev - 1);
        lastRate[l] = r.ratePer100;

        c.lossRatios.push(r.netIncurredLoss / Math.max(r.totalMemberCharge, 1));
        // The real one — see the header. Worked out from the realised dollars.
        c.combined.push((r.netIncurredLoss + r.adminExpense + r.reinsuranceCost)
          / Math.max(r.totalMemberCharge, 1));
        c.engineCombined.push(r.actualCombinedRatio);

        if (y === 5 || y === 10) {
          if (!c.surplusAt.has(y)) c.surplusAt.set(y, []);
          c.surplusAt.get(y)!.push(r.endingSurplus);
        }
        c.belowRequired.push(r.endingSurplus < r.reserveRiskMarginNeeded);
        c.belowZero.push(r.endingSurplus < 0);
      }
      gs = {
        ...gs, poolState: processed.updatedPoolState, currentYearNumber: y + 1,
        currentDecisions: defaultDecisionSet(y + 1),
        lockedResults: [...gs.lockedResults, processed.result],
      };
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
const RUN_LOG = startRunLog('outcomes-summary', pricingOverrides,
  [`${chosen.length === PROFILES.length ? 'all' : chosen.length}profiles`, `${GAMES}g`, `${YEARS}y`]);
const started = Date.now();
console.log(RULE);
console.log('OUTCOMES BY DECISION PROFILE');
console.log(RULE);
console.log(overridesBanner);
console.log(`${chosen.length} profile(s) x ${GAMES} games x ${YEARS} years x ${LINES.length} lines. `
  + `NEW_RATE_STACK is ${NEW_RATE_STACK.enabled ? 'ON' : 'OFF'}.`);
console.log('Every figure is per line-year across all games unless the column says otherwise.\n');

const all = new Map<string, Record<string, Cell>>();
for (const p of chosen) {
  process.stdout.write(`  running ${p.name} ...`);
  const t = Date.now();
  all.set(p.name, run(p));
  console.log(` ${((Date.now() - t) / 1000).toFixed(1)}s`);
}

// --- 0. two controls, then the tables ---------------------------------------
// ⚠ THREE PROFILES ARE NAMED "(default)" AND THEY ARE THE SAME DECISIONS. That
// looks like waste and it is paid for here: each one moves a DIFFERENT knob to
// the value it already has, so if `apply` ever wrote to the wrong line, the
// wrong field, or leaked state between profiles, these three would stop
// agreeing. They are run three times and asserted identical — a control that
// costs about 7 of the 17 seconds and catches the one defect that would make
// every other row in this report quietly wrong.
//
// CONTROL, RUN AND RECORDED: set the "risk control: 0% (default)" profile to
// write 0.01 instead of 0. MEASURED: exit 1, three FAIL lines — one per line —
// and the summary line red. It can fail.
console.log('\n--- 0. THE CONTROLS ---');
const defaults = [...all.entries()].filter(([n]) => n.includes('(default)'));
let defaultsAgree = true;
if (defaults.length > 1) {
  const [, base] = defaults[0];
  for (const [name, cells] of defaults.slice(1)) {
    for (const l of LINES) {
      const a = base[l].rates;
      const b = cells[l].rates;
      const same = a.length === b.length && a.every((v, i) => v === b[i]);
      if (!same) {
        defaultsAgree = false;
        console.log(`  FAIL  "${name}" ${l} differs from "${defaults[0][0]}" — the three profiles `
          + 'that re-set a default to its own value must play identical games');
      }
    }
  }
}
console.log(`  ${defaultsAgree ? 'OK  ' : 'FAIL'}  the ${defaults.length} "(default)" profiles play `
  + 'bit-identical games');

let worstGap = 0;
for (const cells of all.values()) {
  for (const l of LINES) {
    for (let i = 0; i < cells[l].combined.length; i++) {
      worstGap = Math.max(worstGap, Math.abs(cells[l].combined[i] - cells[l].engineCombined[i]));
    }
  }
}
const gapOk = worstGap < 1e-9;
console.log(`  worked out from (net incurred loss + admin + reinsurance) / member charge.`);
console.log(`  ${gapOk ? 'OK  ' : 'FAIL'}  it equals the engine's actualCombinedRatio — worst gap `
  + `${worstGap.toExponential(2)}`);
console.log('  It is NOT expectedCombinedRatio, which is pinned to 1.0000 at CLF 1.000 by the');
console.log('  billing identity and would report every pool as breaking even exactly.');

// --- 1. rates ---------------------------------------------------------------
console.log('\n--- 1. THE RATE MEMBERS PAY, per $100 ---');
console.log('  profile                        line         median      p10      p90'
  + '    |  yr/yr change  median   |change|>20%  >50%');
for (const [name, cells] of all) {
  for (const l of LINES) {
    const c = cells[l];
    console.log(`  ${name.padEnd(30)} ${l.padEnd(9)} ${n3(quantile(c.rates, 0.5)).padStart(10)}`
      + ` ${n3(quantile(c.rates, 0.1)).padStart(8)} ${n3(quantile(c.rates, 0.9)).padStart(8)}`
      + `    |  ${p1(quantile(c.changes, 0.5)).padStart(14)}`
      + `   ${p1(share(c.changes.map(x => Math.abs(x) > 0.20))).padStart(12)}`
      + `  ${p1(share(c.changes.map(x => Math.abs(x) > 0.50))).padStart(5)}`);
  }
}

// --- 2. loss ratio and the real combined ratio -----------------------------
console.log('\n--- 2. LOSS RATIO AND THE REAL COMBINED RATIO ---');
console.log('  profile                        line       loss ratio                 combined ratio'
  + '                over 1.00');
console.log('                                            median    p10    p90       median    p10    p90');
for (const [name, cells] of all) {
  for (const l of LINES) {
    const c = cells[l];
    console.log(`  ${name.padEnd(30)} ${l.padEnd(9)} ${n2(quantile(c.lossRatios, 0.5)).padStart(8)}`
      + ` ${n2(quantile(c.lossRatios, 0.1)).padStart(6)} ${n2(quantile(c.lossRatios, 0.9)).padStart(6)}`
      + `     ${n2(quantile(c.combined, 0.5)).padStart(8)} ${n2(quantile(c.combined, 0.1)).padStart(6)}`
      + ` ${n2(quantile(c.combined, 0.9)).padStart(6)}`
      + `       ${p1(share(c.combined.map(x => x > 1))).padStart(7)}`);
  }
}

// --- 3. surplus -------------------------------------------------------------
console.log('\n--- 3. SURPLUS AT YEARS 5 AND 10, AND HOW OFTEN IT IS SHORT ---');
console.log('  ⚠ THE MINIMUM IS THE COLUMN THAT MATTERS on any profile that declines cover: a mean');
console.log('    over many worlds hides the one that ruins a pool. Both frequencies are per line-year,');
console.log('    over every year played, not just years 5 and 10.\n');
console.log('  profile                        line      ---------- year 5 ----------   --------- year 10 ----------'
  + '   below required   below 0');
console.log('                                              mean      min      p10        mean      min      p10');
for (const [name, cells] of all) {
  for (const l of LINES) {
    const c = cells[l];
    const at = (y: number, f: (xs: number[]) => number) => {
      const xs = c.surplusAt.get(y) ?? [];
      return xs.length === 0 ? NaN : f(xs);
    };
    const minOf = (xs: number[]) => Math.min(...xs);
    console.log(`  ${name.padEnd(30)} ${l.padEnd(9)} ${m$(at(5, mean)).padStart(9)}`
      + ` ${m$(at(5, minOf)).padStart(8)} ${m$(at(5, xs => quantile(xs, 0.1))).padStart(8)}`
      + `   ${m$(at(10, mean)).padStart(9)} ${m$(at(10, minOf)).padStart(8)}`
      + ` ${m$(at(10, xs => quantile(xs, 0.1))).padStart(8)}`
      + `   ${p1(share(c.belowRequired)).padStart(14)}  ${p1(share(c.belowZero)).padStart(8)}`);
  }
}

console.log(`\n${RULE}`);
const ok = gapOk && defaultsAgree;
console.log(`${ok ? 'DONE' : 'DONE — WITH A FAILED CONTROL, see section 0'} `
  + `in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
console.log(RULE);
console.log(`log: ${RUN_LOG}`);
process.exit(ok ? 0 : 1);
