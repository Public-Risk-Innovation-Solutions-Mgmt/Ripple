// ============================================================================
// WHAT PROPERTY MITIGATION IS WORTH — a READING, not a gate.
//
//   GAMES=48 YEARS=5 PCT=5 npx tsx scripts/diagnostics/property-mitigation-value.ts
//   STORM_YEAR=0 to read a quiet book instead.
//
// ⚠ PAIRED WHOLE GAMES THROUGH THE ENGINE, NOT ARITHMETIC ON A REDRAW. The dial
// is set on one arm and not the other, everything else held, and the result is
// ENDING SURPLUS. That is deliberate and it is the lesson WC's sizing paid for:
// an uncharged probe read the GL and WC programs +$4.53M against $5M of
// hand-subtracted cost, and the charged engine read -$1.01M. The gap was the
// investment income the spent money no longer earned, which no arithmetic on
// claim registers carries. Here the spend leaves through riskControlInvestment,
// which is subtracted from BOTH underwriting income and cash, so the surplus
// difference below already contains the benefit, the charge, the premium
// feedback and the forgone investment income together.
//
// ⚠ THE SPEND IS NOT IN THE MEMBER'S BILL, AND THAT IS THE COST BASIS THIS
// PROGRAM WAS ASKED FOR. totalMemberCharge = poolPremiumAndAdminExpense +
// reinsuranceCost + retainedCoverMargin; riskControlInvestment is in none of
// them. The member pays the same and the loss fund shrinks by the spend. (The
// reinsurance premium, by contrast, IS passed through — which is why the
// aggregate section below reads SURPLUS rather than recovery-minus-premium.)
//
// ⚠ THE DIAL IS POOL-WIDE, SO THIS RUNS PROPERTY SOLO. Setting riskControlPct in
// a three-line game would switch on WC's and GL's generic frequency discount at
// the same time and the Property reading would be contaminated by two other
// programs. Property solo is the only configuration in which this number means
// what it says.
// ============================================================================
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { RISK_CONTROL_PARAMS } from '../../src/data/defaultAssumptions';
import { PROPERTY_MITIGATION_BUILDING_DOLLAR_SHARE } from '../../src/utils/riskControlPrograms';
import { CAT_BAND, WEATHER_BAND } from '../../src/utils/propertyClaimEngine';
import { occurrenceTotals, cedeOccurrences } from '../../src/utils/reinsuranceTower';
import { FULL_OCCURRENCE_PLACEMENT } from '../../src/data/reinsuranceTower';
import type { GameState, ResultSet } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 48);
const YEARS = Number(process.env.YEARS ?? 5);
const STORM_YEAR = Number(process.env.STORM_YEAR ?? 3);   // 0 for a quiet book
const AGG = Number(process.env.AGG ?? -1);                // -1 none, 0 or 1 a level
const M = 1e6;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };

interface Row {
  surplus: number; spend: number; e: number; gross: number;
  storm: number; attr: number; cat: number; aggRec: number;
  /** Pool premium — the channel that hands part of the saving back to members. */
  prem: number;
  /** Gross minus what the tower cedes on the DRAWN occurrences: what the pool keeps. */
  kept: number;
}

function play(pct: number): Row[][] {
  const out: Row[][] = [];
  for (let g = 0; g < GAMES; g++) {
    const id = `PMV${g}`;
    const sched = STORM_YEAR > 0 ? [{ shockId: 'WINTER-STORM', yearNumber: STORM_YEAR }] : [];
    const inst = generateGameInstance(id, 7_100_000 + g * 6379, sched);
    const setup = { poolName: 'V', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: ['Property'] };
    const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
    let gs: GameState = {
      setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    const rows: Row[] = [];
    for (let y = 1; y <= YEARS; y++) {
      const d = defaultDecisionSet(y);
      d.riskControlPct = pct;
      d.byLine.Property!.aggregateStopLevel = AGG;
      const p = processYear(gs, d);
      const r = p.result.byLine.Property! as unknown as Record<string, number> & ResultSet['byLine']['Property'];
      let storm = 0, attr = 0, cat = 0;
      for (const c of r.claims ?? []) {
        if (c.tier === CAT_BAND || c.tier === 'earthquake') cat += c.grossUltimate;
        else if (c.tier === WEATHER_BAND) storm += c.grossUltimate;
        else attr += c.grossUltimate;
      }
      const ceded = cedeOccurrences(
        'Property', occurrenceTotals(r.claims ?? [], r.occurrences ?? []), FULL_OCCURRENCE_PLACEMENT.Property,
      ).totalCeded;
      rows.push({ surplus: r.endingSurplus, spend: r.riskControlInvestment, e: r.rcEffectivenessApplied ?? 0,
        gross: r.grossUltimateLoss, storm, attr, cat, aggRec: r.aggregateRecovery ?? 0,
        prem: r.poolPremium, kept: r.grossUltimateLoss - ceded });
      gs = { ...gs, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result],
        currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1), isComplete: y >= YEARS };
    }
    out.push(rows);
  }
  return out;
}

const RULE = '='.repeat(78);
console.log(RULE);
console.log(`PROPERTY MITIGATION — WHAT IT IS WORTH. ${GAMES} games x ${YEARS} years, Property solo`);
console.log(RULE);
console.log(`book: ${STORM_YEAR > 0 ? `WINTER-STORM in year ${STORM_YEAR}` : 'quiet (no scheduled shock)'}`
  + `   aggregate: ${AGG < 0 ? 'none' : AGG === 0 ? 'level 0.83x E[R]' : 'level 1.49x E[R]'}`);
console.log(`building dollar share ${PROPERTY_MITIGATION_BUILDING_DOLLAR_SHARE}; dial lag `
  + `${RISK_CONTROL_PARAMS.lagYears}y to ${100 * RISK_CONTROL_PARAMS.maxEffectiveness}%, `
  + `decay ${100 * RISK_CONTROL_PARAMS.decayRate}%/yr\n`);

// Every arm is played ONCE and kept. The storm section below reads the same
// games rather than replaying them — six sweeps instead of eight, and the two
// sections cannot disagree about what a given arm drew.
const arms = new Map<number, Row[][]>();
for (const p of [0, 1, 2, 3, 4, 5]) arms.set(p, play(p / 100));
const off = arms.get(0)!;

console.log('  spend    rate by year (building frequency cut)        cum spend   NET SURPLUS vs off');
console.log('                                                                    yr 3        yr 5');
for (const pctInt of [1, 2, 3, 4, 5]) {
  const on = arms.get(pctInt)!;
  const eByYear = Array.from({ length: YEARS }, (_, y) => mean(on.map(g => g[y].e)));
  const cum = mean(on.map(g => g.reduce((s, r) => s + r.spend, 0)));
  const d3 = on.map((g, i) => g[Math.min(2, YEARS - 1)].surplus - off[i][Math.min(2, YEARS - 1)].surplus);
  const d5 = on.map((g, i) => g[YEARS - 1].surplus - off[i][YEARS - 1].surplus);
  const t5 = mean(d5) / (sd(d5) / Math.sqrt(d5.length));
  console.log(`  ${String(pctInt).padStart(2)}%     ${eByYear.map(e => (100 * e).toFixed(2).padStart(5)).join(' ')}   `
    + `$${(cum / M).toFixed(2).padStart(6)}M   `
    + `$${(mean(d3) / M).toFixed(3).padStart(7)}M   $${(mean(d5) / M).toFixed(3).padStart(7)}M  t=${t5.toFixed(1)}`);
}

// ---------------------------------------------------------------------------
// WHERE THE SAVING GOES. The line above is NET, which is the number that
// matters and also the number that hides the mechanism. A pool that cuts its
// losses prices off its own experience, so part of the saving leaves as lower
// contributions a year or two later — the same channel WC's program records as
// "not a leak in this program; it is the experience channel doing its job".
// This is the arithmetic that reconciles the gross saving to the net surplus,
// and it is reported because without it the net reads as the program failing
// when most of it is the program working and the money going elsewhere.
// ---------------------------------------------------------------------------
console.log(`\n--- WHERE IT GOES (cumulative over ${YEARS} years, per game) ---`);
console.log('  spend   gross avoided   POOL KEEPS   premium given back   spend     = NET');
for (const pctInt of [1, 3, 5]) {
  const on = arms.get(pctInt)!;
  const sum = (a: Row[][], f: (r: Row) => number) => mean(a.map(g => g.reduce((s, r) => s + f(r), 0)));
  const dGross = sum(off, r => r.gross) - sum(on, r => r.gross);
  const dKept = sum(off, r => r.kept) - sum(on, r => r.kept);
  const dPrem = sum(off, r => r.prem) - sum(on, r => r.prem);
  const spend = sum(on, r => r.spend);
  const net = mean(on.map((g, i) => g[YEARS - 1].surplus - off[i][YEARS - 1].surplus));
  console.log(`  ${String(pctInt).padStart(2)}%    $${(dGross / M).toFixed(2).padStart(7)}M     `
    + `$${(dKept / M).toFixed(2).padStart(6)}M      $${(dPrem / M).toFixed(2).padStart(6)}M       `
    + `$${(spend / M).toFixed(2).padStart(6)}M   $${(net / M).toFixed(2).padStart(6)}M`);
}
console.log('  (POOL KEEPS is gross avoided less the tower\'s share, on the ultimate basis.');
console.log('   PREMIUM GIVEN BACK is how much less members were charged — a transfer to them,');
console.log('   not a loss. The residual between kept - given back - spend and NET is the');
console.log('   investment income the spent money no longer earned, plus development timing.)');

// --- what a storm year looks like, with and without ------------------------
if (STORM_YEAR > 0) {
  console.log(`\n--- A STORM YEAR, WITH AND WITHOUT (year ${STORM_YEAR}) ---`);
  console.log('  spend   storm gross   attritional   catastrophe   TOTAL GROSS   agg recovery');
  for (const pctInt of [0, 3, 5]) {
    const y = arms.get(pctInt)!.map(g => g[STORM_YEAR - 1]);
    console.log(`  ${String(pctInt).padStart(2)}%    $${(mean(y.map(r => r.storm)) / M).toFixed(3).padStart(8)}M   `
      + `$${(mean(y.map(r => r.attr)) / M).toFixed(3).padStart(8)}M   `
      + `$${(mean(y.map(r => r.cat)) / M).toFixed(3).padStart(8)}M   `
      + `$${(mean(y.map(r => r.gross)) / M).toFixed(3).padStart(8)}M   `
      + `$${(mean(y.map(r => r.aggRec)) / M).toFixed(3).padStart(8)}M`);
  }
}
console.log(`\nA READING, NOT A GATE. Whether a program is worth buying is a judgement; the`);
console.log(`confinement claims are asserted by property-mitigation-check instead.`);
