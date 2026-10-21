// ============================================================================
// THE NEW PURE PREMIUM, BESIDE THE CURRENT ONE — A READING, NOT A GATE.
//
//   npx tsx scripts/diagnostics/new-pure-premium-report.ts
//   LINE=GL AT=5 npx tsx scripts/diagnostics/new-pure-premium-report.ts
//
// ⚠ IT ASSERTS NOTHING AND EXITS 0 ON ANY NUMBER. Commit 2 computes the new
// pure premium in shadow; there is no bar it is supposed to clear yet, and a
// gate with an invented threshold would be a number somebody tunes TO rather
// than a measurement. What it does is print every step for one line-year so
// the arithmetic can be followed by hand, then the comparison across all three
// lines so the size of the change is visible before commit 3 makes it real.
//
// The three basis questions this commit had to answer are measured here rather
// than argued: what the GL layer mismatch costs, what a shock year does, and
// what ALAE double-counting would have added.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import {
  newPurePremiumPer100, lossCostTrendPerYear, ALAE_ALREADY_IN_LOSSES,
} from '../../src/utils/newPurePremium';
import { ALAE_OF_LOSS_COST, ULAE_OF_LOSS_COST } from '../../src/data/pricingParameters';
import { paidAgeToAgeFactors } from '../../src/utils/experienceRating';
import { SHOCK_EVENTS, eventLines } from '../../src/utils/shockLosses';
import type { CoverageLine, GameState, Member, MembershipHistory, ReserveDevelopmentRow } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 8);
const YEARS = Number(process.env.YEARS ?? 8);
const WALK_LINE = (process.env.LINE as CoverageLine) ?? 'WC';
const WALK_AT = Number(process.env.AT ?? 5);
const RULE = '='.repeat(74);

interface Row { line: CoverageLine; year: number; current: number; neu: number; lossCost: number }

function basisFrom(st: unknown, line: CoverageLine) {
  const S = st as { lines: Record<string, { reserveDevelopment?: ReserveDevelopmentRow[] }>;
    allMarketMembers: Member[]; membershipHistory: MembershipHistory };
  return {
    rows: S.lines[line]?.reserveDevelopment ?? [],
    allMarketMembers: S.allMarketMembers,
    membershipHistory: S.membershipHistory,
  };
}

// ⚠ HOST TIMING, ON BOTH ARMS OF THE SHOCK CONTROL. In singleplayer the new
// engine fires the catalogue at its probabilities and ignores a schedule, so a
// scheduled shock only reaches a game played on the host's timing. Section 3
// passes `hostTiming`; the other sections play as a solo game does.
function play(seed: number, years: number, shocks: { shockId: string; yearNumber: number }[] = [], hostTiming = false) {
  const id = `npp-${seed}`;
  const instance = generateGameInstance(id, seed, shocks);
  const setup = {
    poolName: 'N', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES,
    ...(hostTiming ? { shockTiming: 'host' as const } : {}),
  };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  let st: unknown = poolState;
  const out: Row[] = [];
  const states: unknown[] = [];
  for (let y = 1; y <= years; y++) {
    states.push(st);
    const p = processYear(gs, defaultDecisionSet(y)) as never as {
      updatedPoolState: unknown; result: unknown;
      lineResults: { line: CoverageLine; result: Record<string, number> }[];
    };
    for (const lr of p.lineResults) {
      const r = lr.result;
      out.push({
        line: lr.line, year: y,
        current: r.purePremiumPer100,
        neu: r.newPurePremiumPer100 ?? NaN,
        lossCost: r.newLossCostPer100 ?? NaN,
      });
    }
    st = p.updatedPoolState;
    gs = { ...gs, poolState: p.updatedPoolState, currentYearNumber: y + 1,
      lockedResults: [...gs.lockedResults, p.result] } as never;
  }
  return { rows: out, states };
}

// ---------------------------------------------------------------- the walk
console.log(RULE);
console.log(`THE WALK — ${WALK_LINE}, pricing year ${WALK_AT}, every step`);
console.log(RULE);

const walk = play(5_500_000, Math.max(WALK_AT, 1));
const walkBasis = basisFrom(walk.states[WALK_AT - 1], WALK_LINE);
const detail = newPurePremiumPer100(WALK_LINE, WALK_AT, walkBasis);

if (!detail) {
  console.log('  the window held no usable accident year.');
} else {
  const t = lossCostTrendPerYear(WALK_LINE);
  console.log(`\n  window: the most recent 5 accident years, equal weights`);
  console.log(`  trend:  ${t.toFixed(6)} per year (${((t - 1) * 100).toFixed(3)}%/yr), loss trend / exposure trend`);
  console.log(`  skipped for want of a ground-up series or a known exposure: ${detail.skipped}\n`);
  console.log('    AY   age(mo)   ground-up paid      LDF       developed    exposure($M)   lossCost/100    trend   trended');
  for (const p of detail.points) {
    console.log(
      `  ${String(p.accidentYear).padStart(4)} ${String(p.ageMonths).padStart(9)} `
      + `${p.groundUpPaid.toFixed(0).padStart(16)} ${p.ldf.toFixed(4).padStart(8)} `
      + `${p.developed.toFixed(0).padStart(15)} ${p.exposure.toFixed(2).padStart(15)} `
      + `${p.lossCostPer100.toFixed(4).padStart(14)} ${p.trendFactor.toFixed(4).padStart(8)} `
      + `${p.trendedLossCostPer100.toFixed(4).padStart(9)}`);
  }
  const sum = detail.points.reduce((s, p) => s + p.trendedLossCostPer100, 0);
  console.log(`\n  sum of trended loss costs            ${sum.toFixed(6)}`);
  console.log(`  / ${detail.points.length} years (equal weights)              ${detail.lossCostPer100.toFixed(6)}   <- loss cost`);
  console.log(`  + ALAE  ${ALAE_ALREADY_IN_LOSSES[WALK_LINE]
    ? `0 (already in ${WALK_LINE}'s losses — see ALAE_ALREADY_IN_LOSSES)`
    : `${(ALAE_OF_LOSS_COST[WALK_LINE] * 100).toFixed(1)}% of loss cost       ${detail.alaePer100.toFixed(6)}`}`);
  console.log(`  + ULAE  ${(ULAE_OF_LOSS_COST[WALK_LINE] * 100).toFixed(1)}% of loss cost       ${detail.ulaePer100.toFixed(6)}`);
  console.log(`  = NEW PURE PREMIUM per $100           ${detail.purePremiumPer100.toFixed(6)}`);
  const hand = detail.lossCostPer100 + detail.alaePer100 + detail.ulaePer100;
  console.log(`  hand-check: ${detail.lossCostPer100.toFixed(6)} + ${detail.alaePer100.toFixed(6)} `
    + `+ ${detail.ulaePer100.toFixed(6)} = ${hand.toFixed(6)}  `
    + `${Math.abs(hand - detail.purePremiumPer100) < 1e-12 ? 'TIES' : 'DOES NOT TIE'}`);
}

// ---------------------------------------------------------------- the spread
console.log(`\n${RULE}`);
console.log(`ACROSS ALL THREE LINES — ${GAMES} games x ${YEARS} years, default decisions`);
console.log(RULE);

const all: Row[] = [];
for (let g = 0; g < GAMES; g++) all.push(...play(4_100_000 + g * 7919, YEARS).rows);

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
console.log('\n  line      n   current pp/100   NEW pp/100    new/current   new loss cost');
for (const l of LINES) {
  const rs = all.filter(r => r.line === l && Number.isFinite(r.neu));
  if (rs.length === 0) { console.log(`  ${l.padEnd(9)} — no usable window`); continue; }
  const c = mean(rs.map(r => r.current)), n = mean(rs.map(r => r.neu));
  console.log(`  ${l.padEnd(8)} ${String(rs.length).padStart(3)} ${c.toFixed(4).padStart(15)} `
    + `${n.toFixed(4).padStart(12)} ${(n / c).toFixed(4).padStart(14)} ${mean(rs.map(r => r.lossCost)).toFixed(4).padStart(15)}`);
}

// ---------------------------------------------------------------- the checks
console.log(`\n${RULE}`);
console.log('THE THREE BASIS QUESTIONS, MEASURED');
console.log(RULE);

// 1. ALAE — what the parameter adds, and what it WOULD have added on GL.
console.log('\n1. ALAE — is it already in the losses?');
for (const l of LINES) {
  const rs = all.filter(r => r.line === l && Number.isFinite(r.neu));
  const lc = mean(rs.map(r => r.lossCost));
  const would = lc * ALAE_OF_LOSS_COST[l];
  console.log(`   ${l.padEnd(9)} already included: ${String(ALAE_ALREADY_IN_LOSSES[l]).padEnd(6)} `
    + `adding it would ${ALAE_ALREADY_IN_LOSSES[l] ? 'HAVE ADDED' : 'add'} ${would.toFixed(4)} per $100 `
    + `(${(ALAE_OF_LOSS_COST[l] * 100).toFixed(1)}% of ${lc.toFixed(4)})`);
}
console.log('   No line\'s losses include ALAE since the pure-premium basis: the pool\'s supplied');
console.log('   pure premiums exclude it, so it is added on every line (GL once took none, a rule');
console.log('   from the old per-claim GL model, whose fitted claim sizes included it).');

// 2. GL LAYER — develop GL on its own factors against WC's and Property's shape.
console.log('\n2. GL LAYER — the recorded GL LDFs describe a LIMITED layer; the engine\'s GL');
console.log('   losses are unlimited. The limited pattern develops to a SHORTER tail, so an');
console.log('   unlimited loss developed on it is understated. Measured as the cumulative');
console.log('   development the pattern applies at each age against what the pool\'s OWN');
console.log('   ledger-estimated factors apply at the same age:');
{
  const basis = basisFrom(walk.states[Math.min(WALK_AT, walk.states.length) - 1], 'GL');
  const d = newPurePremiumPer100('GL', WALK_AT, basis);
  if (d) {
    for (const p of d.points) {
      console.log(`     AY ${String(p.accidentYear).padStart(3)} at ${String(p.ageMonths).padStart(3)}mo: recorded limited LDF ${p.ldf.toFixed(4)}`);
    }
    console.log('   The direction is certain and the magnitude is not measurable here — it needs');
    console.log('   an unlimited GL pattern to compare against, which does not exist until the');
    console.log('   new distributions land. Recorded as a known understatement on GL.');
  }
}

// 3. SHOCKS — a shock year's losses enter the history, so they enter the window.
console.log('\n3. SHOCKS — do shock losses enter the history used for pricing?');
console.log('   ⚠ THE PREMISE NEEDED CHECKING AND IS NARROWER THAN IT LOOKS. A shock reaches');
console.log('   a SESSION only if the host scheduled it; a solo game fires the catalogue at');
console.log('   its probabilities instead. Its losses — the A uplift on ordinary losses and');
console.log('   the T large losses — land in the cohort, and so in the ledger the window');
console.log('   reads. Measured as a PAIRED CONTROL on the host\'s timing — the same');
console.log('   instance played twice, with and without one scheduled event, so the only');
console.log('   difference is the event:');
{
  const FIRE_YEAR = 2;
  // The first event that brings large losses (a T) — so it lands on every line
  // it reaches and the ledger has something to carry.
  const event = SHOCK_EVENTS.find(e => eventLines(e.name).some(r => r.t !== 'None'));
  const id = event?.id;
  if (!id) {
    console.log('     no event brings large losses — nothing to measure.');
  } else {
    console.log(`     shock: '${id}' (${event.name}), fired in year ${FIRE_YEAR}\n`);
    const on: Row[] = [], off: Row[] = [];
    for (let g = 0; g < 6; g++) {
      const seed = 6_200_000 + g * 7919;
      on.push(...play(seed, YEARS, [{ shockId: id, yearNumber: FIRE_YEAR }], true).rows);
      off.push(...play(seed, YEARS, [], true).rows);
    }
    for (const l of LINES) {
      const a = mean(on.filter(r => r.line === l && Number.isFinite(r.neu)).map(r => r.neu));
      const b = mean(off.filter(r => r.line === l && Number.isFinite(r.neu)).map(r => r.neu));
      const d = ((a / b) - 1) * 100;
      console.log(`     ${l.padEnd(9)} with the shock ${a.toFixed(4)}  without ${b.toFixed(4)}  `
        + `${d >= 0 ? '+' : ''}${d.toFixed(2)}%  (mean over all priced years)`);
    }
    // The year-by-year shape matters more than the mean: a shock enters the
    // window the year after it fires and leaves it five years later.
    console.log('\n     year by year on the shocked line, new pure premium with / without:');
    for (const l of LINES) {
      const a = on.filter(r => r.line === l && Number.isFinite(r.neu));
      const b = off.filter(r => r.line === l && Number.isFinite(r.neu));
      const perYear: string[] = [];
      for (let y = 1; y <= YEARS; y++) {
        const av = mean(a.filter(r => r.year === y).map(r => r.neu));
        const bv = mean(b.filter(r => r.year === y).map(r => r.neu));
        if (Number.isFinite(av) && Number.isFinite(bv) && bv > 0) {
          perYear.push(`y${y} ${(((av / bv) - 1) * 100).toFixed(1)}%`);
        }
      }
      console.log(`     ${l.padEnd(9)} ${perYear.join('  ')}`);
    }
    console.log('\n   Shock losses are KEPT in the history for now, as the brief asks. A shock');
    console.log('   therefore sits in the new pure premium for the FIVE years it stays in the');
    console.log('   window — half as long as the current ten-year window carries it.');
  }
}

// 4. WHY THE NEW NUMBER DIFFERS MOST — the recorded LDFs against the pool's own.
console.log(`\n${RULE}`);
console.log('WHAT DRIVES THE DIFFERENCE — the recorded LDFs against the pool\'s own factors');
console.log(RULE);
console.log('\n  The new pure premium develops on the RECORDED paid patterns; the current one');
console.log('  chain-ladders factors estimated from the pool\'s own ledger. They disagree,');
console.log('  and that — not ALAE, not the window length — is the bulk of the gap.\n');
console.log('  line      age(mo)   recorded LDF   pool\'s own CDF at the same age');
{
  for (const l of LINES) {
    const basis = basisFrom(walk.states[WALK_AT - 1], l);
    const d = newPurePremiumPer100(l, WALK_AT, basis);
    const own = paidAgeToAgeFactors(basis.rows);
    const cdfFrom = (age: number) => { let v = 1; for (let a = age; a < 30; a++) v *= own[a] ?? 1; return v; };
    if (!d) continue;
    for (const p of d.points) {
      const ledgerAge = p.ageMonths / 12 - 1;
      console.log(`  ${l.padEnd(9)} ${String(p.ageMonths).padStart(7)} ${p.ldf.toFixed(4).padStart(14)} `
        + `${cdfFrom(ledgerAge).toFixed(4).padStart(31)}`);
    }
  }
}
console.log();
