// ============================================================================
// THE DECISIONS PAGE'S DOLLAR FIGURES ARE THE ENGINE'S.
//
//   npx tsx scripts/diagnostics/decision-figures-check.ts
//
// The page prints four kinds of figure that nothing else asserted: the premium
// the renewal slider turns away, the premium the new-business slider lets in,
// the risk control slider's cost, and the "Your rate" column's pieces. All four
// come from the exported functions in src/game/derivations.ts that the page
// itself calls; this check calls the same functions and compares them with
// INDEPENDENT engine calls, so a figure the page could show and the engine
// would not book goes red.
//
//   1. UNDERWRITING. The page's exposure after movement (the pre-movement book
//      less the non-renewed premium's exposure plus the new business's) equals
//      what processYear writes, for the non-renewal and rejection settings
//      tried. The rate the dollars are priced at equals strikeBookRate's, the
//      engine's own pre-movement quote.
//   2. RISK CONTROL. With RISK_CONTROL off, as it ships, the page's cost is $0
//      at every stored value — the game charges nothing, so the box shows
//      nothing charged — and the stored slider moves nothing the engine
//      returns (the two processYear results are identical). With the flag
//      forced on, the page's cost equals the engine's: strikeBookRate's quote
//      at the slider's value gives (final rate - reinsurance) x the incentive
//      x exposure.
//   3. YOUR RATE. At Expected and at 50%, 70%, 80% and 90% funding, the pure
//      premium shown is the retained pure premium x the CLF, the CLF is
//      selectedClfFor's, and pure premium + admin + risk control &
//      contingency + reinsurance equals the rate charged (strikeBookRate's) to
//      1e-12. Indicated is the ground-up figure at every level.
//
// ⚠ IT CAN FAIL: section 4 feeds section 3's predicates the page's OLD rows —
// the retained pure premium without the CLF — and requires them to be caught.
//
// ⚠ IT FLIPS RISK_CONTROL AT RUNTIME and restores it in a `finally`, safe only
// because every gate runs in its own process.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear, selectedClfFor, strikeBookRate } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { RISK_CONTROL } from '../../src/data/pricingParameters';
import { lineBookRisk } from '../../src/utils/bookUnits';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { gameHistory, investmentIncomeCredit } from '../../src/utils/investmentIncomeCredit';
import { computeFundingConsequence } from '../../src/utils/fundingConsequence';
import { fundingConsequenceInput, pricingBookFor, ratePieces, riskControlCost, underwritingFigures } from '../../src/game/derivations';
import type { CoverageLine, DecisionSet, GameState, LineDecisionSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const GAMES = Number(process.env.GAMES ?? 3);

let failures = 0;
let checks = 0;
const fail = (s: string) => { failures++; if (failures <= 30) console.log(`  FAIL  ${s}`); };
const check = (ok: boolean, what: string) => { checks++; if (!ok) fail(what); };

console.log('=== DECISION FIGURES CHECK ===\n');

function openGame(g: number): GameState {
  const id = `DF${g}`;
  const inst = generateGameInstance(id, 7_300_000 + g * 7919);
  const setup = { poolName: 'A', gameLength: 4, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
  return {
    setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true,
    isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
}

const withLine = (ds: DecisionSet, line: CoverageLine, patch: Partial<LineDecisionSet>): DecisionSet => ({
  ...ds, byLine: { ...ds.byLine, [line]: { ...ds.byLine[line], ...patch } },
});

/** The engine's own pre-movement quote for a line at a decision — what the page's rate must be. */
function struck(gs: GameState, line: CoverageLine, d: LineDecisionSet) {
  const ps = gs.poolState;
  const s = strikeBookRate(
    line, ps.lines[line], d, gs.currentYearNumber,
    {
      allMarketMembers: ps.allMarketMembers, membershipHistory: ps.membershipHistory,
      // The credit the game strikes the rate with (worlds.strikeRates): last year's realised return.
      investmentIncomeCredit: investmentIncomeCredit(line, gameHistory(gs), gs.currentYearNumber),
    },
    lineBookRisk(gs.instance, line, ps.bookUnits, ps.bookLedger), gameShocksOn(gs.setup, gs.instance),
  );
  if (!s) throw new Error('strikeBookRate returned null — the new loss engine and rate stack are expected on');
  return s;
}

/** The panel's figures, built exactly as useGameDerivations builds them. */
function panel(gs: GameState, line: CoverageLine, ds: DecisionSet) {
  const d = ds.byLine[line];
  const c = computeFundingConsequence(
    d.fundingConfidenceLevel, gs.poolState.lines[line].ratePer100, line, d.fundingAtExpected,
    fundingConsequenceInput(gs, line, ds).book,
  );
  if (!c.newStack) throw new Error('no newStack on the panel');
  return c.newStack;
}

const stateOf = (gs: GameState, ds: DecisionSet) => ({ ...gs, currentDecisions: ds });

const games = Array.from({ length: GAMES }, (_, g) => openGame(g));

// --------------------------------------------------------------------------
console.log('--- 1. UNDERWRITING: THE EXPOSURE MOVEMENT IS THE ENGINE\'S, THE RATE IS THE ENGINE\'S ---');
const UW_SETTINGS: Array<[number, number]> = [[0, 0], [0.05, 0], [0, 0.1], [0.05, 0.1], [0.1, 0.15]];
let uwChecked = 0, worstExposure = 0;
for (const gs of games) {
  for (const line of LINES) {
    for (const [ren, rej] of UW_SETTINGS) {
      const ds = withLine(defaultDecisionSet(1), line, { renewalsDeclined: ren, newBusinessRejection: rej });
      const d = ds.byLine[line];
      const rate = panel(gs, line, ds).finalRatePer100;
      check(rate === struck(gs, line, d).quote.finalRatePer100,
        `${line} ren ${ren} rej ${rej}: the panel's rate is not strikeBookRate's`);
      const figs = underwritingFigures(stateOf(gs, ds), line, d, rate);
      if (!figs) { fail(`${line}: no underwriting figures on the book path`); continue; }
      const before = pricingBookFor(gs, line);
      const exposureBefore = (before as { exposure: number }).exposure;
      const unit = 10_000 * rate;
      const afterPage = exposureBefore - figs.nonRenewedPremium / unit + figs.newBusinessPremium / unit;
      // The engine's own year, on the same decisions: its post-movement exposure.
      const engine = processYear(stateOf(gs, ds), ds).result.byLine[line]!.writtenExposure;
      // writtenExposure is stored to 0.01 ($M), so the bar is half of that.
      const gap = Math.abs(afterPage - engine);
      worstExposure = Math.max(worstExposure, gap);
      uwChecked++;
      check(gap <= 0.0051, `${line} ren ${ren} rej ${rej}: page's post-movement exposure ${afterPage.toFixed(4)} vs engine ${engine}`);
      if (ren === 0) check(figs.nonRenewedPremium === 0, `${line}: a 0% non-renewal shows $${figs.nonRenewedPremium}`);
      if (rej < 0.15 && ren === 0 && rej === 0) check(figs.newBusinessPremium > 0, `${line}: nothing is written at 0% rejection`);
      check(figs.nonRenewedPremium >= 0 && figs.newBusinessPremium >= 0, `${line}: a negative premium`);
    }
    // More rejection brings in less, more non-renewal turns away more.
    const lo = underwritingFigures(stateOf(gs, defaultDecisionSet(1)), line, withLine(defaultDecisionSet(1), line, { newBusinessRejection: 0 }).byLine[line], 1)!;
    const hi = underwritingFigures(stateOf(gs, defaultDecisionSet(1)), line, withLine(defaultDecisionSet(1), line, { newBusinessRejection: 0.15 }).byLine[line], 1)!;
    check(hi.newBusinessPremium < lo.newBusinessPremium, `${line}: rejecting more does not bring in less`);
  }
}
console.log(`  ${uwChecked} line x setting cases; worst exposure gap against processYear ${worstExposure.toExponential(2)} $M (stored to 0.01)`);

// --------------------------------------------------------------------------
console.log('\n--- 2. RISK CONTROL: THE COST IS THE ENGINE\'S RATE LOADING ON THE EXPOSURE ---');
let rcChecked = 0, worstRc = 0;
for (const gs of games) {
  for (const line of LINES) {
    for (const rc of [0, 0.01, 0.03, 0.05]) {
      const ds = withLine(defaultDecisionSet(1), line, { riskControlIncentivePct: rc, fundingAtExpected: false, fundingConfidenceLevel: 0.8 });
      const d = ds.byLine[line];
      // Off (as it ships): the engine charges nothing, so the box shows $0
      // whatever is stored — never a cost the game does not charge.
      check(!RISK_CONTROL.enabled, 'RISK_CONTROL is expected off for the page\'s call');
      const off = riskControlCost(stateOf(gs, ds), line, ds);
      check(off === 0, `${line} rc ${rc}: the box shows $${off} with RISK_CONTROL off`);
      // On: the box is the engine's own charge for the incentive.
      let page: number | null, engine: number;
      const was = RISK_CONTROL.enabled;
      try {
        RISK_CONTROL.enabled = true;
        page = riskControlCost(stateOf(gs, ds), line, ds);
        const s = struck(gs, line, d);
        engine = (s.quote.finalRatePer100 - s.quote.reinsRatePer100) * rc * s.exposure * 10_000;
      } finally {
        RISK_CONTROL.enabled = was;
      }
      rcChecked++;
      const gap = Math.abs((page ?? NaN) - engine);
      worstRc = Math.max(worstRc, gap);
      check(page !== null && gap <= 1e-6 * Math.max(1, engine), `${line} rc ${rc}: page $${page} vs engine $${engine}`);
      if (rc === 0) check(page === 0, `${line}: 0% shows $${page}`);
      if (rc > 0) check((page ?? 0) > 0, `${line} rc ${rc}: no cost shown`);
    }
    // With the flag off the stored slider must move nothing the engine returns.
    const a = processYear(stateOf(gs, withLine(defaultDecisionSet(1), line, { riskControlIncentivePct: 0 })), withLine(defaultDecisionSet(1), line, { riskControlIncentivePct: 0 })).result;
    const b = processYear(stateOf(gs, withLine(defaultDecisionSet(1), line, { riskControlIncentivePct: 0.05 })), withLine(defaultDecisionSet(1), line, { riskControlIncentivePct: 0.05 })).result;
    // The decisions are echoed on the result; everything else must be equal.
    const strip = (r: typeof a) => JSON.stringify(r, (k, v) => (k === 'decisions' || k === 'riskControlIncentivePct' ? undefined : v));
    check(strip(a) === strip(b), `${line}: a stored risk control slider moved the engine's result with the flag off`);
  }
}
console.log(`  ${rcChecked} line x level cases; worst departure from the engine's loading ${worstRc.toExponential(2)} dollars`);

// --------------------------------------------------------------------------
console.log('\n--- 3. YOUR RATE: PURE PREMIUM x CLF, AND THE PIECES SUM TO THE RATE CHARGED ---');
const LEVELS: Array<'expected' | number> = ['expected', 0.5, 0.7, 0.8, 0.9];
let rateChecked = 0, worstSum = 0;
for (const gs of games) {
  for (const line of LINES) {
    const seen: number[] = [];
    for (const lvl of LEVELS) {
      const ds = withLine(defaultDecisionSet(1), line,
        lvl === 'expected' ? { fundingAtExpected: true } : { fundingAtExpected: false, fundingConfidenceLevel: lvl });
      const d = ds.byLine[line];
      const n = panel(gs, line, ds);
      const p = ratePieces(n);
      const engine = struck(gs, line, d).quote;
      const clf = selectedClfFor(line, d);
      rateChecked++;
      check(n.clf === clf, `${line} ${lvl}: panel CLF ${n.clf} vs selectedClfFor ${clf}`);
      check(p.yours.purePremium === engine.retainedPurePremiumPer100 * clf,
        `${line} ${lvl}: Your-rate pure premium ${p.yours.purePremium} vs engine retained x CLF ${engine.retainedPurePremiumPer100 * clf}`);
      check(p.yours.rate === engine.finalRatePer100, `${line} ${lvl}: rate ${p.yours.rate} vs engine ${engine.finalRatePer100}`);
      const sum = p.yours.purePremium + p.yours.admin + p.yours.rcAndContingency + p.yours.reins;
      worstSum = Math.max(worstSum, Math.abs(sum - engine.finalRatePer100));
      check(Math.abs(sum - engine.finalRatePer100) <= 1e-12, `${line} ${lvl}: pieces sum ${sum} vs charged ${engine.finalRatePer100}`);
      const isum = p.indicated.purePremium + p.indicated.admin + p.indicated.rcAndContingency;
      check(Math.abs(isum - engine.firstIndicationPer100) <= 1e-12, `${line} ${lvl}: Indicated pieces sum ${isum} vs ${engine.firstIndicationPer100}`);
      check(p.indicated.purePremium === engine.groundUpPurePremiumPer100,
        `${line} ${lvl}: Indicated pure premium is not the ground-up figure at Expected`);
      seen.push(p.yours.purePremium);
    }
    // Expected is CLF 1: Your-rate pure premium there is the retained figure itself.
    // Funding up moves it up; it used to stay fixed.
    check(seen[1] < seen[2] && seen[2] < seen[3] && seen[3] < seen[4], `${line}: Your-rate pure premium does not rise with the funding level (${seen.join(', ')})`);
  }
}
console.log(`  ${rateChecked} line x level cases; worst departure of the pieces' sum from the charged rate ${worstSum.toExponential(2)}`);

// --------------------------------------------------------------------------
console.log('\n--- 4. CONTROL: THE OLD ROWS (RETAINED, NOT x CLF) MUST BE CAUGHT ---');
{
  const gs = games[0];
  const line: CoverageLine = 'WC';
  const ds = withLine(defaultDecisionSet(1), line, { fundingAtExpected: false, fundingConfidenceLevel: 0.9 });
  const n = panel(gs, line, ds);
  const old = n.purePremiumRetained + n.adminRatePer100 + n.riskControlAndContingencyPer100 + n.reinsRatePer100;
  check(Math.abs(old - n.finalRatePer100) > 1e-3, 'the old rows summed to the rate at 90% — the control cannot detect the defect');
  console.log(`  at 90% the old rows summed to ${old.toFixed(4)} against ${n.finalRatePer100.toFixed(4)} charged: caught`);
}

console.log(`\n${checks} checks.`);
console.log(failures === 0
  ? 'EVERY FIGURE THE DECISIONS PAGE PRINTS IS THE ENGINE\'S, AND YOUR RATE\'S PIECES SUM TO THE RATE.'
  : `${failures} FAILURE(S).`);
process.exit(failures === 0 ? 0 : 1);
