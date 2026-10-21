// ============================================================================
// LOSS ADJUSTMENT EXPENSE IS BOOKED — THE GATE.
//
//   npx tsx scripts/diagnostics/lae-booking-check.ts
//
// The rate charges ALAE and ULAE on the ground-up loss cost; the engine now
// spends them (lossExpense.ts). Checked on solo ten-world games played as the
// app plays them, every world's every line-year, against figures this gate
// rebuilds from the world's own cohorts before and after the year:
//
//   1. THE SHARES are the rate's: ALAE + ULAE on every line, 5% each, since the
//      pure-premium basis (GL once booked ULAE alone, a rule from the old
//      per-claim GL model, whose claim sizes included ALAE).
//   2. INCURRED, PAID AND RESERVE are those shares of the ground-up loss
//      incurred, paid and still unpaid — the cohorts' gross ledger.
//   3. THE LAE RESERVE ROLLS FORWARD: beginning + incurred − paid = ending,
//      and each year begins where the last ended.
//   4. THE BALANCE SHEET HOLDS IT: assets = loss reserve + loss expense reserve
//      + surplus, and the surplus rollforward ties.
//   5. UNDERWRITING SPENDS IT: charge + assessments − losses − LAE − admin −
//      risk control − reinsurance − dividends.
//   6. THE OPENING HOLDS ASSETS FOR IT: cash + investments = both reserves +
//      the ruled surplus, so year 1 opens tied.
//
// And it reports the measurement this commit was asked to land: the pool's
// underwriting income a year with shocks off.
//
// ⚠ AND IT FAILS WHEN BROKEN — every check is a function over data, and THE
// CONTROLS at the foot feed each one the defect it guards against.
// ============================================================================

import { openSoloInstance } from '../../src/utils/soloGame';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { seedFromInstanceId } from '../../src/seedHash';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { laeShares, lossExpenseReserve } from '../../src/utils/lossExpense';
import { ALAE_OF_LOSS_COST, ULAE_OF_LOSS_COST } from '../../src/data/pricingParameters';
import type { CoverageLine, GameSetupSettings, GameState, LineResultSet, PoolState, ReserveCohort } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const near = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

interface Played { gs: GameState; starts: GameState[]; opening: PoolState }

function play(id: string, years: number, shocks: 'on' | 'off'): Played {
  const settings = { poolName: 'L', gameLength: years, startingYear: 2026, instanceId: id, activeLines: LINES } as GameSetupSettings;
  const solo = openSoloInstance(settings);
  const instance = shocks === 'on' ? solo.instance : generateGameInstance(id, seedFromInstanceId(id), []);
  const { poolState, priorHistory } = runPriorHistory(instance, solo.setup);
  let gs = openWorlds({
    setup: solo.setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  });
  const starts: GameState[] = [];
  // Every world's rows, collected as each year settles: a world keeps only its
  // last row in the game since stable-scenarios commit 10 (world 1 all its own).
  const full: GameState['lockedResults'][] = (gs.worlds ?? []).map(() => []);
  for (let y = 1; y <= years; y++) {
    starts.push(gs);
    const s = settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), []);
    gs = { ...gs, ...commitSettledYear(gs, s), currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
    gs.worlds?.forEach((w, i) => full[i].push(w.lockedResults[w.lockedResults.length - 1]));
  }
  return { gs: gs.worlds ? { ...gs, worlds: gs.worlds.map((w, i) => ({ ...w, lockedResults: full[i] })) } : gs, starts, opening: poolState };
}

// ---------------------------------------------------------------------------
// THE CHECKS — each takes data and returns what it found wrong.
// ---------------------------------------------------------------------------

/**
 * The ground-up ledger of a set of cohorts: paid and unpaid, net where no gross
 * is kept. A cohort closed BEFORE the year is out of it (the engine drops it);
 * one that closes DURING it is in the year's end, with the residual it paid.
 */
function gross(cohorts: readonly ReserveCohort[], dropClosed: boolean) {
  const held = dropClosed ? cohorts.filter(c => !c.closed) : cohorts;
  return {
    paid: held.reduce((s, c) => s + (c.grossPaid ?? c.netPaid), 0),
    unpaid: held.reduce((s, c) => s + Math.max(0, c.grossUnpaid ?? c.netUnpaid), 0),
  };
}

/** 2. The year's LAE against the shares of its ground-up movement, rebuilt from the cohorts. */
function laeAgainstLosses(share: number, before: readonly ReserveCohort[], after: readonly ReserveCohort[], r: LineResultSet): string[] {
  const out: string[] = [];
  const b = gross(before, true), a = gross(after, false);
  const paid = share * (a.paid - b.paid);
  const reserve = share * a.unpaid;
  const incurred = share * (a.paid + a.unpaid - b.paid - b.unpaid);
  if (!near(r.laePaid, paid, 1e-7)) out.push(`paid ${r.laePaid.toFixed(0)} vs ${paid.toFixed(0)}`);
  if (!near(r.endingLaeReserve, reserve, 1e-7)) out.push(`reserve ${r.endingLaeReserve.toFixed(0)} vs ${reserve.toFixed(0)}`);
  if (!near(r.laeIncurred, incurred, 1e-7)) out.push(`incurred ${r.laeIncurred.toFixed(0)} vs ${incurred.toFixed(0)}`);
  if (!near(r.alaeIncurred + r.ulaeIncurred, r.laeIncurred, 1e-9)) out.push('ALAE + ULAE is not LAE');
  return out;
}

/** 3. The LAE reserve's own rollforward, and its continuity from the year before. */
function laeRollforward(rows: readonly LineResultSet[]): string[] {
  const out: string[] = [];
  rows.forEach((r, i) => {
    if (!near(r.beginningLaeReserve + r.laeIncurred - r.laePaid, r.endingLaeReserve, 1e-9)) out.push(`year ${i + 1} does not roll`);
    if (i > 0 && !near(r.beginningLaeReserve, rows[i - 1].endingLaeReserve, 1e-9)) out.push(`year ${i + 1} begins off last year's end`);
  });
  return out;
}

/** 4. Assets cover both reserves and the surplus; the surplus rollforward ties. */
function balanceSheet(r: LineResultSet): string[] {
  const out: string[] = [];
  if (!near(r.totalAssets, r.endingNetReserve + r.endingLaeReserve + r.unearnedPremium + r.endingSurplus, 1e-9)) out.push('assets ≠ reserves + surplus');
  if (!near(r.totalLiabilities, r.endingNetReserve + r.endingLaeReserve + r.unearnedPremium, 1e-9)) out.push('liabilities omit a reserve');
  if (Math.abs(r.surplusTieOutDifference) > 1e-3 && Math.abs(r.surplusTieOutDifference - (r.interLineTransfer ?? 0)) > 1e-3) out.push(`tie-out ${r.surplusTieOutDifference.toFixed(2)}`);
  return out;
}

/** 5. Underwriting income spends the LAE. */
function underwriting(r: LineResultSet): boolean {
  return near(r.underwritingIncome,
    r.totalMemberCharge + r.assessments - r.netIncurredLoss - r.laeIncurred - r.operatingExpense
    - r.riskControlInvestment - r.reinsuranceCost - r.dividends, 1e-9);
}

/** 6. The opening's assets against both reserves and its surplus, pool-wide. */
function openingHolds(p: PoolState, lae: (l: CoverageLine) => number): number {
  const assets = p.cash + LINES.reduce((s, l) => s + p.lines[l].investedAssets, 0);
  const owed = LINES.reduce((s, l) => s + p.lines[l].netUnpaidReserve + lae(l) + p.lines[l].surplus, 0);
  return assets - owed;
}

// ---------------------------------------------------------------------------
console.log('=== LOSS ADJUSTMENT EXPENSE, BOOKED — solo ten-world games, three lines ===');
console.log('\n--- 1. the shares are the rate\'s ---');
for (const l of LINES) {
  const s = laeShares(l);
  const want = ALAE_OF_LOSS_COST[l] + ULAE_OF_LOSS_COST[l];
  check(near(s.total, want) && s.alae === ALAE_OF_LOSS_COST[l] && s.alae > 0, `${l}: ALAE ${s.alae} + ULAE ${s.ulae}`);
}

const games = [play('LAE1', 6, 'on'), play('LAE2', 6, 'on')];
const bad2: string[] = [], bad3: string[] = [], bad4: string[] = [];
let bad5 = 0, rows = 0, worstOpening = 0;
for (const g of games) {
  worstOpening = Math.max(worstOpening, Math.abs(openingHolds(g.opening, l => lossExpenseReserve(l, g.opening.lines[l].reserveCohorts ?? []))));
  g.gs.worlds!.forEach((w, wi) => {
    for (const l of LINES) {
      const share = laeShares(l).total;
      const lineRows = w.lockedResults.map(r => r.byLine[l]);
      lineRows.forEach((r, y) => {
        rows++;
        const before = g.starts[y].worlds![wi].poolState.lines[l].reserveCohorts ?? [];
        const after = (y + 1 < g.starts.length ? g.starts[y + 1].worlds![wi] : w).poolState.lines[l].reserveCohorts ?? [];
        bad2.push(...laeAgainstLosses(share, before, after, r).map(s => `${l} w${wi + 1} y${y + 1}: ${s}`));
        bad4.push(...balanceSheet(r).map(s => `${l} w${wi + 1} y${y + 1}: ${s}`));
        if (!underwriting(r)) bad5++;
      });
      bad3.push(...laeRollforward(lineRows).map(s => `${l} w${wi + 1}: ${s}`));
    }
  });
}
console.log(`\n--- 2-5. every world's every line-year (${rows}) ---`);
check(bad2.length === 0, 'LAE incurred, paid and reserve are the shares of the ground-up loss incurred, paid and unpaid', bad2[0] ?? '');
check(bad3.length === 0, 'the loss expense reserve rolls forward, each year from the last one\'s end', bad3[0] ?? '');
check(bad4.length === 0, 'assets = loss reserve + loss expense reserve + surplus, and the surplus rollforward ties', bad4[0] ?? '');
check(bad5 === 0, 'underwriting income spends the LAE', `${bad5} line-years off`);
console.log('\n--- 6. the opening holds assets for both reserves ---');
check(worstOpening < 1e-3, 'cash + investments = loss reserve + loss expense reserve + ruled surplus at the opening', `worst ${worstOpening.toExponential(2)}`);
{
  const r = games[0].gs.lockedResults[0];
  check(r.endingLaeReserve > 0 && near(r.endingLaeReserve, LINES.reduce((s, l) => s + r.byLine[l].endingLaeReserve, 0), 1e-9),
    'the pool row\'s loss expense reserve is its lines\' sum', `$${(r.endingLaeReserve / 1e6).toFixed(1)}M at year 1`);
}

console.log('\n--- THE MEASUREMENT: pool underwriting income, shocks off ---');
{
  const off = ['LAE1', 'LAE2', 'LAE3'].map(id => play(id, 10, 'off'));
  const perYear = Array.from({ length: 10 }, (_, y) => off.reduce((s, g) => s + g.gs.lockedResults[y].underwritingIncome, 0) / off.length);
  const lae = off.reduce((s, g) => s + g.gs.lockedResults.reduce((t, r) => t + r.laeIncurred, 0), 0) / off.length / 10;
  console.log(`  by year $M: ${perYear.map(x => (x / 1e6).toFixed(2)).join(' ')}`);
  console.log(`  mean $${(perYear.reduce((a, b) => a + b) / 10 / 1e6).toFixed(2)}M a year, after $${(lae / 1e6).toFixed(2)}M a year of LAE (3 seeds x 10 years)`);
}

// ============================================================================
// THE CONTROLS — each check, fed the defect it guards against, must fail.
// ============================================================================
console.log('\n--- CONTROLS: every check fails when broken ---');
{
  const g = games[0];
  const r = g.gs.worlds![0].lockedResults[2].byLine.WC;
  // LAE on the NET loss — what the rate does not charge it on. Scanned over every
  // world's every line-year, since a year that ceded nothing cannot tell the two
  // bases apart; it must be caught wherever cover responded.
  const glRow = g.gs.worlds![0].lockedResults[2].byLine.GL;
  const toNet = (cs: readonly ReserveCohort[]) => cs.map(c => ({ ...c, grossPaid: c.netPaid, grossUnpaid: c.netUnpaid }));
  let caughtNet = 0, cededYears = 0;
  for (const gg of games) gg.gs.worlds!.forEach((w, wi) => LINES.forEach(l => w.lockedResults.forEach((row, y) => {
    const b0 = gg.starts[y].worlds![wi].poolState.lines[l].reserveCohorts ?? [];
    const a0 = (y + 1 < gg.starts.length ? gg.starts[y + 1].worlds![wi] : w).poolState.lines[l].reserveCohorts ?? [];
    if (Math.abs(gross(a0, false).unpaid - gross(toNet(a0), false).unpaid) < 1) return;
    cededYears++;
    if (laeAgainstLosses(laeShares(l).total, toNet(b0), toNet(a0), row.byLine[l]).length > 0) caughtNet++;
  })));
  check(cededYears > 0 && caughtNet === cededYears, 'control: LAE on the net loss rather than the ground-up is caught',
    `${caughtNet} of ${cededYears} line-years whose gross and net differ`);
  // GL booking ULAE alone, as under the old rule.
  check(laeAgainstLosses(ULAE_OF_LOSS_COST.GL,
    g.starts[2].worlds![0].poolState.lines.GL.reserveCohorts ?? [], g.starts[3].worlds![0].poolState.lines.GL.reserveCohorts ?? [], glRow).length > 0,
  'control: GL booking ULAE alone, without its ALAE, is caught');
  // A reserve that does not roll: LAE paid dropped.
  const wcRows = g.gs.worlds![0].lockedResults.map(x => x.byLine.WC);
  check(laeRollforward(wcRows.map((x, i) => (i === 2 ? { ...x, laePaid: 0 } : x))).length > 0, 'control: a loss expense reserve that does not roll is caught');
  // Liabilities without the loss expense reserve.
  check(balanceSheet({ ...r, totalLiabilities: r.endingNetReserve, endingSurplus: r.totalAssets - r.endingNetReserve }).length > 0,
    'control: a balance sheet without the loss expense reserve is caught');
  // Underwriting income that never spent it.
  check(!underwriting({ ...r, underwritingIncome: r.underwritingIncome + r.laeIncurred }), 'control: underwriting income that keeps the LAE is caught');
  // An opening with no assets for the LAE reserve.
  const thin = { ...g.opening, lines: Object.fromEntries(LINES.map(l => [l, { ...g.opening.lines[l],
    investedAssets: g.opening.lines[l].investedAssets - lossExpenseReserve(l, g.opening.lines[l].reserveCohorts ?? []) }])) } as PoolState;
  check(Math.abs(openingHolds(thin, l => lossExpenseReserve(l, thin.lines[l].reserveCohorts ?? []))) > 1e3,
    'control: an opening without assets for the loss expense reserve is caught');
}

console.log(failures.length === 0
  ? '\nLOSS ADJUSTMENT EXPENSE IS BOOKED: ALL CHECKS PASS.'
  : `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
