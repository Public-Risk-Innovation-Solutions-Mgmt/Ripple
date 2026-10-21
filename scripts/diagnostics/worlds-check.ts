// ============================================================================
// TEN WORLDS — THE GATE (loss engine commit 4b).
//
//   npx tsx scripts/diagnostics/worlds-check.ts
//
// What the averaging promises, checked on real ten-world games:
//
//   1. WORLDS DIFFER ONLY IN THEIR DRAWS. Each world's instance is the game's
//      with its own seed and nothing else; every world plays the same
//      decisions; a world replayed ALONE, as a one-world game on its own seed
//      and the same struck rates, reproduces itself exactly — nothing leaks
//      between worlds; the opening every world shares is never written to;
//      and the worlds' results really do differ.
//   2. THE RATE IS IDENTICAL ACROSS WORLDS AND IS THE AVERAGED HISTORY'S. Every
//      rate field is bit-identical in every world, and equals the rate struck
//      on a ledger this gate averages for itself. And the striking function
//      prices like the engine: on one world, in a year its book does not move,
//      it reproduces the rate the engine charged. And the Decisions panel, on
//      the averaged state, shows the player that same rate.
//   3. AVERAGED DOLLARS ARE THE MEAN OF THE WORLDS, line and pool.
//   4. RATIOS COME FROM AVERAGED PARTS. Each averaged ratio is its averaged
//      numerator over its averaged denominator — never the mean of the worlds'
//      ratios, which differs whenever the worlds do — and deriveLineRatios
//      reproduces every world row's OWN ratios exactly, so a formula changed in
//      the engine and not in worlds.ts fails here.
//   5. TWO TEAMS ON IDENTICAL DECISIONS MATCH EXACTLY — every world and the
//      average.
//   6. SHOCKS: a solo game's schedule and a host's both fire in every world,
//      with severity drawn per world (solo-shock-schedule-check has the rest).
//
// ⚠ AND IT FAILS WHEN BROKEN — every check is a function over data, and THE
// CONTROLS at the foot feed each one a deliberately broken input and require it
// to fail. A control that passes is a check that cannot.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear, strikeBookRate } from '../../src/utils/simulationEngine';
import {
  averageLedger, commitSettledYear, deriveLineRatios, LINE_RATIO_FIELDS, openWorlds, playWorldsYear,
  settleWorldsYear, strikeRates, worldInstance, worldCount,
} from '../../src/utils/worlds';
import { lineBookRisk, marketSeedOf } from '../../src/utils/bookUnits';
import { WORLD_COUNT } from '../../src/data/pricingParameters';
import { exposureFactor } from '../../src/data/exposureTrend';
import { computeFundingConsequence } from '../../src/utils/fundingConsequence';
import { bookPurePremium } from '../../src/utils/newPurePremium';
import { effectiveRiskControlIncentivePct } from '../../src/utils/linePricing';
import { AGGREGATE_NOT_OFFERED, placementFor } from '../../src/utils/reinsuranceOptions';
import type {
  CoverageLine, DecisionSet, GameState, LineResultSet, ResultSet,
} from '../../src/types/simulation';
import { SOLO_SHOCKS } from '../../src/data/pricingParameters';
// ⚠ SHOCKS ARE OFF IN SINGLE-PLAYER (SOLO_SHOCKS, pending the data scientist),
// and this gate tests how fired shocks are handled — which hosted games still
// do — through solo games. Their schedule is switched on here so it has
// shocks to test, rather than passing on none.
SOLO_SHOCKS.enabled = true;

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = Number(process.env.YEARS ?? 6);
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

/** A game's decisions by year: defaults, with a non-default cover and funding on GL. */
function decisionsFor(y: number): DecisionSet {
  const d = defaultDecisionSet(y);
  d.byLine.GL.reinsuranceOption = 'catastrophe';
  d.byLine.GL.fundingAtExpected = false;
  d.byLine.GL.fundingConfidenceLevel = 0.75;
  return d;
}

interface Played { gs: GameState; starts: GameState[]; openingJson: string }

/** A solo game as the app builds it, or — given a host's schedule — a session team's. */
function play(id: string, seed: number, opts: { shocks?: Array<{ shockId: string; yearNumber: number }> } = {}): Played {
  const base = { poolName: 'W', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { setup, instance: inst } = opts.shocks
    ? { setup: { ...base, shockTiming: 'host' as const }, instance: generateGameInstance(id, seed, opts.shocks) }
    : openSoloInstance(base as never);
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  // Every world opens on this ONE object; snapshotted to prove no world writes to it.
  const openingJson = JSON.stringify(poolState);
  let gs = openWorlds({
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: decisionsFor(1), priorHistory,
  });
  const starts: GameState[] = [];
  for (let y = 1; y <= YEARS; y++) {
    starts.push(gs);
    const played = playWorldsYear(gs, decisionsFor(y));
    const s = settleWorldsYear(gs, played, []);
    gs = { ...gs, ...commitSettledYear(gs, s), currentYearNumber: y + 1 };
  }
  return { gs, starts, openingJson };
}

// ---------------------------------------------------------------------------
// THE CHECKS — each takes data and returns what it found wrong.
// ---------------------------------------------------------------------------

const RATE_FIELDS = ['finalRatePer100', 'ratePer100', 'purePremiumPer100', 'firstIndicationPer100',
  'expectedCededPer100', 'netPurePremiumPer100', 'newPurePremiumPer100'] as const;

function rateIdentical(worldRows: LineResultSet[]): string[] {
  const out: string[] = [];
  for (const f of RATE_FIELDS) {
    const v = worldRows.map(r => r[f as keyof LineResultSet]);
    if (!v.every(x => x === v[0])) out.push(`${f} differs across worlds (${new Set(v).size} values)`);
  }
  return out;
}

const DOLLARS = ['poolPremium', 'adminExpense', 'totalMemberCharge', 'reinsuranceCost', 'reinsuranceRecovery',
  'netIncurredLoss', 'grossUltimateLoss', 'netPaidLosses', 'endingNetReserve', 'investmentIncome',
  'underwritingIncome', 'netIncome', 'dividends', 'assessments', 'endingSurplus', 'totalAssets',
  'reserveRiskMarginNeeded', 'activeExposure'] as const;

function dollarsAreMeans(avg: { [k: string]: unknown }, worlds: { [k: string]: unknown }[]): string[] {
  const out: string[] = [];
  for (const f of DOLLARS) {
    const m = worlds.reduce((s, w) => s + (w[f] as number), 0) / worlds.length;
    const a = avg[f] as number;
    if (Math.abs(a - m) > 1e-9 * Math.max(1, Math.abs(m))) out.push(`${f}: averaged ${a} vs mean ${m}`);
  }
  return out;
}

const RATIO_PARTS: Array<[string, (r: LineResultSet | ResultSet) => number]> = [
  ['actualLossRatio', r => r.netIncurredLoss / Math.max(r.totalMemberCharge, 1)],
  ['actualExpenseRatio', r => (r.adminExpense + r.reinsuranceCost) / Math.max(r.totalMemberCharge, 1)],
  ['actualLossRatioPricingBasis', r => r.netIncurredLoss / Math.max(r.poolPremiumAndAdminExpense, 1)],
  ['poolLayerLossRatio', r => r.poolLayerLoss / Math.max(r.poolPremiumAndAdminExpense, 1)],
];

/** Averaged ratios are their averaged parts; reports a ratio that is a mean of the worlds' instead. */
function ratiosFromParts(avg: LineResultSet | ResultSet, worlds: (LineResultSet | ResultSet)[]): string[] {
  const out: string[] = [];
  for (const [f, fromParts] of RATIO_PARTS) {
    const a = (avg as unknown as Record<string, number>)[f];
    const p = fromParts(avg);
    if (Math.abs(a - p) > 1e-12 * Math.max(1, Math.abs(p))) out.push(`${f}: ${a} is not its averaged parts ${p}`);
  }
  const ecr = avg.reserveRiskMarginNeeded > 0 ? avg.excessAvailableSurplus / avg.reserveRiskMarginNeeded : null;
  if (ecr !== null && Math.abs((avg.excessCapitalRatio ?? NaN) - ecr) > 1e-12 * Math.max(1, Math.abs(ecr))) {
    out.push(`excessCapitalRatio: ${avg.excessCapitalRatio} is not its averaged parts ${ecr}`);
  }
  void worlds;
  return out;
}

/** deriveLineRatios on a world row reproduces that row's own ratios — the engine's formulas. */
function ratioFormulaParity(row: LineResultSet): string[] {
  const d = deriveLineRatios(row) as Record<string, unknown>;
  return LINE_RATIO_FIELDS.filter(f => d[f] !== (row as unknown as Record<string, unknown>)[f])
    .map(f => `${f}: engine ${(row as unknown as Record<string, unknown>)[f]} vs deriveLineRatios ${d[f]}`);
}

function worldsDiffer(worldRows: (LineResultSet | ResultSet)[]): boolean {
  return new Set(worldRows.map(r => r.netIncurredLoss)).size > 1
    && new Set(worldRows.map(r => r.investmentIncome)).size > 1;
}

// ---------------------------------------------------------------------------
console.log(`=== TEN WORLDS — WORLD_COUNT ${WORLD_COUNT}, three-line solo games, ${YEARS} years ===`);
check(worldCount() === WORLD_COUNT && WORLD_COUNT > 1, `the new engine runs ${WORLD_COUNT} worlds`);
const A = play('WCHK1', 5_150_515);
const gs = A.gs;
const W = gs.worlds!;

console.log('\n--- 1. worlds differ only in their draws ---');
{
  const insts = W.map((_, i) => worldInstance(gs.instance, i));
  // ⚠ AND ITS MARKET SEED, which is the GAME's in every world (book units
  // commit 3): world 1 reads it off its own seed, the others carry it.
  const sansSeed = insts.map(x => JSON.stringify({ ...x, seed: 0, marketSeed: marketSeedOf(x) }));
  check(sansSeed.every(x => x === sansSeed[0]) && insts.every(x => marketSeedOf(x) === gs.instance.seed),
    'every world\'s instance is the game\'s, but for its seed — its book of units\' market is the game\'s');
  check(new Set(insts.map(x => x.seed)).size === insts.length && insts[0].seed === gs.instance.seed,
    'every world has its own seed, and world 1 is the game\'s own');
  let decisionsSame = true;
  for (let y = 0; y < YEARS; y++) for (const l of LINES) {
    const ds = W.map(w => JSON.stringify(w.lockedResults[y].byLine[l].decisions));
    if (!ds.every(d => d === ds[0])) decisionsSame = false;
  }
  check(decisionsSame, 'every world played the same decisions, every line, every year');
  let differ = true;
  for (let y = 0; y < YEARS; y++) if (!worldsDiffer(W.map(w => w.lockedResults[y]))) differ = false;
  check(differ, 'the worlds\' losses and investment returns differ in every year');
  // A world replayed ALONE, on its own seed and the same struck rates.
  const k = 3;
  let alone: GameState = { ...A.starts[0], worlds: undefined, instance: worldInstance(gs.instance, k) };
  let identical = true;
  for (let y = 1; y <= YEARS; y++) {
    const struckRates = strikeRates(A.starts[y - 1], decisionsFor(y));
    const p = processYear(alone, decisionsFor(y), { struckRates });
    if (JSON.stringify(p.result) !== JSON.stringify(W[k].lockedResults[y - 1])) identical = false;
    alone = { ...alone, poolState: p.updatedPoolState, lockedResults: [...alone.lockedResults, p.result], currentYearNumber: y + 1 };
  }
  check(identical, `world ${k + 1} replayed alone reproduces itself exactly — nothing passes between worlds`);
  // ⚠ THE REPLAY ABOVE CANNOT SEE A WRITE TO THE SHARED OPENING — it starts from
  // the same object — so the opening every world shares is checked directly.
  check(JSON.stringify(A.starts[0].poolState) === A.openingJson,
    'the opening every world shares is untouched after the game — no world wrote to it');
}

console.log('\n--- 2. one rate, identical across worlds, struck from the averaged history ---');
{
  const bad: string[] = [];
  let struckOk = true;
  for (let y = 1; y <= YEARS; y++) {
    const start = A.starts[y - 1];
    for (const l of LINES) {
      bad.push(...rateIdentical(W.map(w => w.lockedResults[y - 1].byLine[l])).map(e => `Y${y} ${l} ${e}`));
      // The averaged ledger, built here from the worlds' own ledgers.
      const own = start.worlds!.map(w => w.poolState.lines[l].reserveDevelopment ?? []);
      // ⚠ EVERY SERIES, NOT ONLY THE ULTIMATES. The pure premium reads paid-to-date
      // too; this construction once averaged the ultimates alone — the same
      // omission averageLedger had — so it agreed with a rate struck on world
      // 1's paid history and caught nothing (up to 29.5% off, measured).
      const avgSeries = (pick: (r: typeof own[0][0]) => number[] | undefined, i: number) => {
        const first = pick(own[0][i]);
        if (!first) return undefined;
        return first.map((_, k) => own.reduce((s, w) => {
          const a = pick(w[i])!;
          return s + a[Math.min(k, a.length - 1)];
        }, 0) / own.length);
      };
      const ledger = own[0].map((row, i) => ({
        ...row,
        ...(row.exposure !== undefined ? { exposure: own.reduce((s, w) => s + (w[i].exposure ?? 0), 0) / own.length } : {}),
        ultimateByValuation: avgSeries(r => r.ultimateByValuation, i)!,
        ...(row.paidByValuation ? { paidByValuation: avgSeries(r => r.paidByValuation, i) } : {}),
        ...(row.grossPaidByValuation ? { grossPaidByValuation: avgSeries(r => r.grossPaidByValuation, i) } : {}),
        // The worlds' mean shock dollars, a world with none counting 0 (stable-scenarios commit 7).
        shockGross: own.reduce((s, w) => s + (w[i].shockGross ?? 0), 0) / own.length,
      }));
      const book = start.worlds!.reduce((s, w) => s + (w.poolState.lines[l].bookExposure ?? 0), 0) / start.worlds!.length;
      const mine = strikeBookRate(l, { ...start.poolState.lines[l], reserveDevelopment: ledger, bookExposure: book },
        decisionsFor(y).byLine[l], y, { allMarketMembers: [], membershipHistory: {} },
        lineBookRisk(start.instance, l, start.poolState.bookUnits));
      const charged = W[0].lockedResults[y - 1].byLine[l].finalRatePer100;
      if (!mine || Math.abs(mine.quote.finalRatePer100 - (charged ?? NaN)) > 1e-12 * mine.quote.finalRatePer100) struckOk = false;
    }
  }
  check(bad.length === 0, 'every rate field is bit-identical in every world, every line, every year', bad[0] ?? '');
  check(struckOk, 'and equals the rate struck on a ledger this gate averages for itself');
  // The striking function prices like the engine: one world, a year with no book movement.
  const one = { ...A.starts[0], worlds: undefined };
  let ok = 0, tried = 0;
  const p1 = processYear(one, decisionsFor(1));
  for (const l of LINES) {
    const r = p1.result.byLine[l];
    const s = strikeBookRate(l, one.poolState.lines[l], decisionsFor(1).byLine[l], 1, { allMarketMembers: [], membershipHistory: {} },
      lineBookRisk(one.instance, l, one.poolState.bookUnits));
    // The book moved (a withdrawal): the bill is struck on the moved book, not comparable.
    if (p1.updatedPoolState.lines[l].bookExposure !== one.poolState.lines[l].bookExposure) continue;
    tried++;
    if (s && Math.abs(s.quote.finalRatePer100 - (r.finalRatePer100 ?? NaN)) < 1e-12 * s.quote.finalRatePer100) ok++;
  }
  check(tried > 0 && ok === tried, `strikeBookRate reproduces the engine's own charge on one world (${ok} of ${tried} lines)`);
  // THE RATE THE PLAYER IS SHOWN IS THE RATE EVERY WORLD IS CHARGED. The
  // Decisions panel, given the averaged state exactly as derivations.ts gives it
  // (a book's exposure and the ledger's pure premium), quotes the struck rate.
  let panelOk = 0, panelTried = 0, panelWorst = 0;
  for (let y = 1; y <= YEARS; y++) {
    const start = A.starts[y - 1];
    for (const l of LINES) {
      const ls = start.poolState.lines[l];
      const d = decisionsFor(y).byLine[l];
      const exposure = (ls.bookExposure ?? 0) * exposureFactor(l, y);
      const c = computeFundingConsequence(d.fundingConfidenceLevel, ls.ratePer100, l, d.fundingAtExpected, {
        yearNumber: y, members: { exposure, risk: lineBookRisk(start.instance, l, start.poolState.bookUnits) ?? 1 }, exposure,
        layersPlaced: placementFor(l, d.reinsuranceOption), aggregateStopLevel: AGGREGATE_NOT_OFFERED, reinsuranceOption: d.reinsuranceOption,
        pricingAdjustment: ls.rateLevel / 100, priorPurePremiumPer100: ls.purePremiumPer100,
        lossTrend: start.instance.lossEnvironment.lossTrend, priorRcEffectiveness: ls.riskControlEffectiveness,
        riskControlPct: d.riskControlPct,
        groundUpPurePremiumPer100: bookPurePremium(l, y, {
          rows: ls.reserveDevelopment ?? [], allMarketMembers: start.poolState.allMarketMembers,
          membershipHistory: start.poolState.membershipHistory,
        }, exposure).purePremiumPer100,
        newStackRiskControlPct: effectiveRiskControlIncentivePct(d),
      });
      const shown = c.newStack?.finalRatePer100;
      const charged = W[0].lockedResults[y - 1].byLine[l].finalRatePer100;
      panelTried++;
      if (shown !== undefined && charged !== undefined) {
        const rel = Math.abs(shown / charged - 1);
        panelWorst = Math.max(panelWorst, rel);
        if (rel < 1e-12) panelOk++;
      }
    }
  }
  check(panelTried > 0 && panelOk === panelTried,
    `the Decisions panel on the averaged state shows the rate every world is charged (${panelOk} of ${panelTried})`,
    `worst ${panelWorst.toExponential(2)}`);
}

console.log('\n--- 3. averaged dollars are the mean of the worlds ---');
{
  const bad: string[] = [];
  for (let y = 0; y < YEARS; y++) {
    bad.push(...dollarsAreMeans(gs.lockedResults[y] as never, W.map(w => w.lockedResults[y]) as never).map(e => `Y${y + 1} pool ${e}`));
    for (const l of LINES) {
      bad.push(...dollarsAreMeans(gs.lockedResults[y].byLine[l] as never, W.map(w => w.lockedResults[y].byLine[l]) as never)
        .map(e => `Y${y + 1} ${l} ${e}`));
    }
  }
  check(bad.length === 0, `${DOLLARS.length} dollar fields, pool and every line, every year`, bad[0] ?? '');
  const ledgerOk = LINES.every(l => JSON.stringify(gs.poolState.lines[l].reserveDevelopment)
    === JSON.stringify(averageLedger(W.map(w => w.poolState.lines[l].reserveDevelopment ?? []))));
  check(ledgerOk, 'the averaged state\'s ledger is the worlds\' ledgers averaged');
  // Independently of averageLedger: each accident year's latest paid-to-date,
  // net and gross, is the mean of the worlds' own — the paid series were world
  // 1's until the results page found it.
  const lastOf = (a?: number[]) => (a && a.length > 0 ? a[a.length - 1] : 0);
  const paidBad: string[] = [];
  for (const l of LINES) {
    for (const row of gs.poolState.lines[l].reserveDevelopment ?? []) {
      for (const key of ['paidByValuation', 'grossPaidByValuation'] as const) {
        const m = W.reduce((acc, w) => acc + lastOf(w.poolState.lines[l].reserveDevelopment?.find(r => r.yearNumber === row.yearNumber)?.[key]), 0) / W.length;
        if (Math.abs(lastOf(row[key]) - m) > 1e-6 * Math.max(1, Math.abs(m))) paidBad.push(`${l} AY${row.yearNumber} ${key}`);
      }
    }
  }
  check(paidBad.length === 0, 'and every accident year\'s paid-to-date, net and gross, is the worlds\' mean', paidBad[0] ?? '');
}

console.log('\n--- 4. ratios come from averaged parts, never averaged ---');
{
  const bad: string[] = [];
  let differs = 0;
  for (let y = 0; y < YEARS; y++) {
    bad.push(...ratiosFromParts(gs.lockedResults[y], W.map(w => w.lockedResults[y])).map(e => `Y${y + 1} pool ${e}`));
    for (const l of LINES) {
      const rows = W.map(w => w.lockedResults[y].byLine[l]);
      bad.push(...ratiosFromParts(gs.lockedResults[y].byLine[l], rows).map(e => `Y${y + 1} ${l} ${e}`));
      // The capital ratio's denominator differs by world every year, so its mean
      // and its ratio of means part company; the loss ratio's differs only once
      // a withdrawal has moved a world's exposure.
      const meanRatio = rows.reduce((s, r) => s + (r.excessCapitalRatio ?? 0), 0) / rows.length;
      if (Math.abs(meanRatio - (gs.lockedResults[y].byLine[l].excessCapitalRatio ?? 0)) > 1e-9) differs++;
    }
  }
  check(bad.length === 0, 'every checked ratio is its averaged numerator over its averaged denominator', bad[0] ?? '');
  check(differs > 0, `and differs from the mean of the worlds' ratios (${differs} line-years), so the test has teeth`);
  const parity: string[] = [];
  for (const w of W) for (const r of w.lockedResults) for (const l of LINES) parity.push(...ratioFormulaParity(r.byLine[l]));
  check(parity.length === 0, `deriveLineRatios reproduces every world row's own ${LINE_RATIO_FIELDS.length} ratios exactly`, parity[0] ?? '');
}

console.log('\n--- 5. two teams on identical decisions match exactly ---');
const B = play('WCHK1', 5_150_515);
check(JSON.stringify(B.gs.lockedResults) === JSON.stringify(gs.lockedResults)
  && JSON.stringify(B.gs.worlds) === JSON.stringify(gs.worlds), 'every world and the average, byte for byte');

console.log('\n--- 6. shocks ---');
{
  const fired = gs.lockedResults.flatMap(r => r.shockEvents ?? []).map(e => e.worlds?.fired ?? 0);
  check(fired.length > 0 && fired.every(f => f === WORLD_COUNT), 'a solo game\'s drawn events fire in every world',
    `fired-in counts ${[...new Set(fired)].sort((a, b) => a - b).join(',')}`);
  const H = play('WCHK2', 7_070_707, { shocks: [{ shockId: '#2', yearNumber: 2 }] });
  const ev = (H.gs.lockedResults[1].shockEvents ?? []).find(e => e.shockId === '#2');
  check(ev?.worlds?.fired === WORLD_COUNT, `a host-scheduled event fires in every world (${ev?.worlds?.fired ?? 0} of ${WORLD_COUNT})`);
  const sev = H.gs.worlds!.map(w => (w.lockedResults[1].shockEvents ?? []).find(e => e.shockId === '#2')?.attributableGrossLoss ?? 0);
  check(new Set(sev).size === sev.length, 'with its severity drawn per world', `${new Set(sev).size} distinct of ${sev.length}`);
}

// ============================================================================
// THE CONTROLS — each check, fed a broken input, must fail.
// ============================================================================
console.log('\n--- CONTROLS: every check fails when broken ---');
{
  const y = 2, l: CoverageLine = 'GL';
  const rows = W.map(w => w.lockedResults[y].byLine[l]);
  // A per-world rate: one world charges a different rate.
  const perWorldRate = rows.map((r, i) => (i === 4 ? { ...r, finalRatePer100: (r.finalRatePer100 ?? 0) * 1.01 } : r));
  check(rateIdentical(perWorldRate).length > 0, 'control: a world charging its own rate is caught');
  // A dollar figure taken from one world instead of averaged.
  const avg = gs.lockedResults[y].byLine[l];
  check(dollarsAreMeans({ ...avg, netIncome: rows[0].netIncome } as never, rows as never).length > 0,
    'control: a dollar figure taken from one world is caught');
  // A ratio averaged across worlds instead of recomputed.
  const averagedRatio = rows.reduce((s, r) => s + (r.excessCapitalRatio ?? 0), 0) / rows.length;
  check(ratiosFromParts({ ...avg, excessCapitalRatio: averagedRatio }, rows).length > 0,
    'control: a ratio averaged across worlds is caught');
  // A ratio formula changed in one place and not the other.
  check(ratioFormulaParity({ ...rows[0], actualExpenseRatio: rows[0].actualExpenseRatio * 1.0000001 }).length > 0,
    'control: a ratio formula that drifted from the engine\'s is caught');
  // Worlds that share their draws.
  check(!worldsDiffer(W.map(() => W[0].lockedResults[y])), 'control: worlds with identical draws are caught');
  // A ledger's paid taken from one world rather than averaged.
  {
    const row = gs.poolState.lines.GL.reserveDevelopment!.find(r => r.yearNumber === 2)!;
    const w0 = W[0].poolState.lines.GL.reserveDevelopment!.find(r => r.yearNumber === 2)!;
    const m = W.reduce((acc, w) => acc + (w.poolState.lines.GL.reserveDevelopment!.find(r => r.yearNumber === 2)!.paidByValuation!.slice(-1)[0]), 0) / W.length;
    check(Math.abs(w0.paidByValuation!.slice(-1)[0] - m) > 1e-6 && Math.abs(row.paidByValuation!.slice(-1)[0] - m) < 1e-6 * m,
      'control: one world\'s paid-to-date in place of the mean is caught');
  }
  // An opening a world wrote to.
  const touched = { ...A.starts[0].poolState, cash: A.starts[0].poolState.cash + 1 };
  check(JSON.stringify(touched) !== A.openingJson, 'control: an opening one world wrote to is caught');
  // The panel quoting a package the team did not choose.
  const ls = A.starts[2].poolState.lines.GL;
  const exposure = (ls.bookExposure ?? 0) * exposureFactor('GL', 3);
  const wrong = computeFundingConsequence(0.75, ls.ratePer100, 'GL', false, {
    yearNumber: 3, members: { exposure, risk: lineBookRisk(gs.instance, 'GL', A.starts[2].poolState.bookUnits) ?? 1 }, exposure,
    layersPlaced: placementFor('GL', 'none'), aggregateStopLevel: AGGREGATE_NOT_OFFERED, reinsuranceOption: 'none',
    pricingAdjustment: ls.rateLevel / 100, priorPurePremiumPer100: ls.purePremiumPer100,
    lossTrend: gs.instance.lossEnvironment.lossTrend, priorRcEffectiveness: ls.riskControlEffectiveness,
    riskControlPct: 0,
    groundUpPurePremiumPer100: bookPurePremium('GL', 3, {
      rows: ls.reserveDevelopment ?? [], allMarketMembers: [], membershipHistory: {},
    }, exposure).purePremiumPer100,
    newStackRiskControlPct: 0,
  });
  check(wrong.newStack?.finalRatePer100 !== W[0].lockedResults[2].byLine.GL.finalRatePer100,
    'control: a panel quoting a package the team did not buy does not match the charged rate');
  // Two teams that do not match.
  const C = play('WCHK3', 5_150_516);
  check(JSON.stringify(C.gs.lockedResults) !== JSON.stringify(gs.lockedResults),
    'control: two teams on different seeds do not match — the identity test can fail');
}

console.log(failures.length === 0
  ? '\nTEN WORLDS: ALL CHECKS PASS.'
  : `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
