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
//   2. RISK CONTROL (restated at wip/risk-control, where the slider went live,
//      and at wip/risk-control-divisor, where it moved into the divisor). The
//      page's cost equals the engine's: strikeBookRate's quote at the slider's
//      value gives the rate before reinsurance (final rate - reinsurance), and
//      the charge is exactly the slider's share of it, x exposure — $0 at 0%.
//      And the slider reaches the engine: the year played at 5% books a cost,
//      the year at 0% none. (It used to assert the box showed $0 and the slider
//      moved nothing, with RISK_CONTROL off.)
//   3. THE RATE PANEL, BOTH COLUMNS, EACH PIECE ITS OWN ROW. At Expected and
//      at 50%, 70%, 80% and 90% funding: Your rate's pure premium is the
//      retained pure premium x selectedClfFor's CLF; its admin, Risk Control
//      and reinsurance are the engine quote's (strikeBookRate's); admin is the
//      line's share of the rate before reinsurance (20% on every line —
//      restated at wip/pricing-rework from profit and contingency, retired);
//      the rows add to the rate the game charges to 1e-12, and in printed
//      cents to the printed rate exactly. Indicated is the ground-up pure
//      premium, its own admin and risk control, adding to the
//      indicated rate the same two ways. The Risk Control row is the Risk
//      Control box's cost per $100 at the current exposure — $0.00 at 0%, and
//      at 1-5% the box's dollars / (exposure x 10,000). The expense block's
//      permissible loss ratio, 1 - admin - the line's slider, is the pure
//      premium's share of the rate before reinsurance.
//
// ⚠ IT CAN FAIL: section 4 feeds section 3's predicates the page's OLD rows —
// the retained pure premium without the CLF; an extra cent in Risk Control;
// WC's old 2% profit and contingency taken out of admin; a Risk Control row
// priced on the Indicated rate rather than the box's; the charge priced as
// wip/risk-control's multiplier, (1 + slider) on the rate — and requires each
// to be caught.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { processYear, selectedClfFor, strikeBookRate } from '../../src/utils/simulationEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { computeFundingConsequence } from '../../src/utils/fundingConsequence';
import { fundingConsequenceInput, pieceCents, pricingBookFor, ratePieces, riskControlCost, underwritingFigures, type RatePieceColumn } from '../../src/game/derivations';
import { ADMIN_SHARE_OF_PREMIUM } from '../../src/data/pricingParameters';
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
    { allMarketMembers: ps.allMarketMembers, membershipHistory: ps.membershipHistory },
    1, gameShocksOn(gs.setup, gs.instance),
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
/** The risk control charge per $100: the slider's share of the rate before reinsurance (it is in the divisor). */
const engineCharge = (rateBeforeReins: number, rc: number) => rateBeforeReins * rc;

const games = Array.from({ length: GAMES }, (_, g) => openGame(g));

// --------------------------------------------------------------------------
console.log('--- 1. UNDERWRITING: THE EXPOSURE MOVEMENT IS THE ENGINE\'S, THE RATE IS THE ENGINE\'S ---');
const UW_SETTINGS: Array<[number, number]> = [[0, 0], [0.05, 0], [0, 0.05], [0.03, 0.02], [0.05, 0.05]];
let uwChecked = 0, worstExposure = 0;
for (const gs of games) {
  for (const line of LINES) {
    for (const [ren, add] of UW_SETTINGS) {
      const ds = withLine(defaultDecisionSet(1), line, { nonRenewal: ren, newMembers: add });
      const d = ds.byLine[line];
      const rate = panel(gs, line, ds).finalRatePer100;
      check(rate === struck(gs, line, d).quote.finalRatePer100,
        `${line} ren ${ren} add ${add}: the panel's rate is not strikeBookRate's`);
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
      check(gap <= 0.0051, `${line} ren ${ren} add ${add}: page's post-movement exposure ${afterPage.toFixed(4)} vs engine ${engine}`);
      if (ren === 0) check(figs.nonRenewedPremium === 0, `${line}: a 0% non-renewal shows $${figs.nonRenewedPremium}`);
      if (add === 0) check(figs.newBusinessPremium === 0, `${line}: 0% new members shows $${figs.newBusinessPremium}`);
      else check(figs.newBusinessPremium > 0, `${line}: nothing is written at ${add} new members`);
      check(figs.nonRenewedPremium >= 0 && figs.newBusinessPremium >= 0, `${line}: a negative premium`);
    }
    // More new members brings in more.
    const lo = underwritingFigures(stateOf(gs, defaultDecisionSet(1)), line, withLine(defaultDecisionSet(1), line, { newMembers: 0.01 }).byLine[line], 1)!;
    const hi = underwritingFigures(stateOf(gs, defaultDecisionSet(1)), line, withLine(defaultDecisionSet(1), line, { newMembers: 0.05 }).byLine[line], 1)!;
    check(hi.newBusinessPremium > lo.newBusinessPremium, `${line}: adding more members does not bring in more`);
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
      // The box is the engine's own charge: the slider's share of the rate before reinsurance.
      const page = riskControlCost(stateOf(gs, ds), line, ds);
      const s = struck(gs, line, d);
      const engine = engineCharge(s.quote.finalRatePer100 - s.quote.reinsRatePer100, rc) * s.exposure * 10_000;
      rcChecked++;
      const gap = Math.abs((page ?? NaN) - engine);
      worstRc = Math.max(worstRc, gap);
      check(page !== null && gap <= 1e-6 * Math.max(1, engine), `${line} rc ${rc}: page $${page} vs engine $${engine}`);
      if (rc === 0) check(page === 0, `${line}: 0% shows $${page}`);
      if (rc > 0) check((page ?? 0) > 0, `${line} rc ${rc}: no cost shown`);
    }
    // The slider reaches the engine: a cost at 5%, none at 0%.
    const a = processYear(stateOf(gs, withLine(defaultDecisionSet(1), line, { riskControlIncentivePct: 0 })), withLine(defaultDecisionSet(1), line, { riskControlIncentivePct: 0 })).result;
    const b = processYear(stateOf(gs, withLine(defaultDecisionSet(1), line, { riskControlIncentivePct: 0.05 })), withLine(defaultDecisionSet(1), line, { riskControlIncentivePct: 0.05 })).result;
    check(a.byLine[line]!.riskControlInvestment === 0 && b.byLine[line]!.riskControlInvestment > 0,
      `${line}: the slider does not reach the engine (cost ${a.byLine[line]!.riskControlInvestment} at 0%, ${b.byLine[line]!.riskControlInvestment} at 5%)`);
  }
}
console.log(`  ${rcChecked} line x level cases; worst departure from the engine's loading ${worstRc.toExponential(2)} dollars`);

// --------------------------------------------------------------------------
console.log('\n--- 3. THE RATE PANEL: EACH PIECE ITS OWN ROW, EACH COLUMN ADDING TO ITS RATE ---');
const LEVELS: Array<'expected' | number> = ['expected', 0.5, 0.7, 0.8, 0.9];
const sumOf = (c: RatePieceColumn) => c.purePremium + c.admin + c.riskControl + c.reins;
/** Predicates over one column, so section 4 can feed them broken columns. */
const addsUp = (c: RatePieceColumn, rate: number) => Math.abs(sumOf(c) - rate) <= 1e-12;
const centsAddUp = (c: RatePieceColumn) => {
  const k = pieceCents(c);
  return k.purePremium + k.admin + k.riskControl + k.reins === k.rate
    && k.rate === (Math.round(c.rate * 100) || 0)
    && Math.abs(k.admin - Math.round(c.admin * 100)) <= 1;
};
// The line's admin share, written out rather than read from the parameter.
const BRIEFED_ADMIN: Record<CoverageLine, number> = { WC: 0.2, GL: 0.2, Property: 0.2 };
// Admin is its share of the whole rate before reinsurance, risk control
// included — both are in the divisor (wip/risk-control-divisor).
const adminIsTheLines = (c: RatePieceColumn, line: CoverageLine) =>
  ADMIN_SHARE_OF_PREMIUM[line] === BRIEFED_ADMIN[line] && Math.abs(c.admin - (c.rate - c.reins) * BRIEFED_ADMIN[line]) <= 1e-12;
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
      // Your rate: every row is the engine's, and the rate is what the game charges.
      check(p.yours.purePremium === engine.retainedPurePremiumPer100 * clf,
        `${line} ${lvl}: Your-rate pure premium ${p.yours.purePremium} vs engine retained x CLF ${engine.retainedPurePremiumPer100 * clf}`);
      check(p.yours.admin === engine.adminRatePer100, `${line} ${lvl}: admin is not the engine's`);
      check(p.yours.riskControl === engine.riskControlPer100, `${line} ${lvl}: Risk Control is not the engine's loading`);
      check(p.yours.reins === engine.reinsRatePer100, `${line} ${lvl}: reinsurance is not the engine's`);
      check(p.yours.rate === engine.finalRatePer100, `${line} ${lvl}: rate ${p.yours.rate} vs engine ${engine.finalRatePer100}`);
      worstSum = Math.max(worstSum, Math.abs(sumOf(p.yours) - engine.finalRatePer100), Math.abs(sumOf(p.indicated) - engine.firstIndicationPer100));
      check(addsUp(p.yours, engine.finalRatePer100), `${line} ${lvl}: Your-rate rows sum ${sumOf(p.yours)} vs charged ${engine.finalRatePer100}`);
      check(centsAddUp(p.yours), `${line} ${lvl}: Your-rate rows in cents do not add to the printed rate`);
      check(adminIsTheLines(p.yours, line), `${line} ${lvl}: Your-rate admin is not the line's share of the rate before reinsurance`);
      // These decisions hold the slider at 0%: the row is $0.00, as the box is.
      check(p.yours.riskControl === 0 && pieceCents(p.yours).riskControl === 0, `${line} ${lvl}: Risk Control is not $0.00 at 0%`);
      // Indicated: at Expected, self-funded, adding to the indicated rate.
      check(p.indicated.purePremium === engine.groundUpPurePremiumPer100,
        `${line} ${lvl}: Indicated pure premium is not the ground-up figure at Expected`);
      check(p.indicated.reins === 0, `${line} ${lvl}: Indicated carries reinsurance`);
      check(addsUp(p.indicated, engine.firstIndicationPer100), `${line} ${lvl}: Indicated rows sum ${sumOf(p.indicated)} vs ${engine.firstIndicationPer100}`);
      check(centsAddUp(p.indicated), `${line} ${lvl}: Indicated rows in cents do not add to the printed rate`);
      check(adminIsTheLines(p.indicated, line), `${line} ${lvl}: Indicated admin is not the line's share`);
      seen.push(p.yours.purePremium);
    }
    // Expected is CLF 1: Your-rate pure premium there is the retained figure itself.
    // Funding up moves it up; it used to stay fixed.
    check(seen[1] < seen[2] && seen[2] < seen[3] && seen[3] < seen[4], `${line}: Your-rate pure premium does not rise with the funding level (${seen.join(', ')})`);
  }
}
console.log(`  ${rateChecked} line x level cases; worst departure of a column's rows from its rate ${worstSum.toExponential(2)}`);

// The panel's expense block (wip/risk-control-divisor): Admin, Risk control (the
// line's choice), Total expense ratio, Permissible loss ratio = 1 - the total —
// as DecisionsPage's NewRatePanel computes it.
const plrShown = (n: ReturnType<typeof panel>) => 1 - (n.adminShare + n.riskControlPct);
const plrIsThePurePremiumsShare = (c: RatePieceColumn, plr: number) => Math.abs(c.purePremium / (c.rate - c.reins) - plr) <= 1e-12;
// At 1-5%: the Risk Control row is the box's cost per $100.
let boxChecked = 0, worstBox = 0;
const boxRow = (gs: GameState, line: CoverageLine, ds: DecisionSet, pick: (n: ReturnType<typeof panel>) => number) => {
  const n = panel(gs, line, ds);
  const box = riskControlCost(stateOf(gs, ds), line, ds) ?? NaN;
  const exposure = (fundingConsequenceInput(gs, line, ds).book as { exposure: number }).exposure;
  return { row: pick(n), box: box / (exposure * 10_000), n };
};
for (const gs of games) for (const line of LINES) for (const rc of [0.01, 0.03, 0.05]) {
  const ds = withLine(defaultDecisionSet(1), line, { riskControlIncentivePct: rc, fundingAtExpected: false, fundingConfidenceLevel: 0.8 });
  const { row, box, n } = boxRow(gs, line, ds, x => ratePieces(x).yours.riskControl);
  boxChecked++;
  worstBox = Math.max(worstBox, Math.abs(row - box));
  check(row > 0 && Math.abs(row - box) <= 1e-12 * Math.max(1, box), `${line} rc ${rc}: Risk Control row ${row} vs the box per $100 ${box}`);
  check(addsUp(ratePieces(n).yours, n.finalRatePer100), `${line} rc ${rc}: with risk control on, Your-rate rows do not add to the rate`);
  check(adminIsTheLines(ratePieces(n).yours, line), `${line} rc ${rc}: admin is not 20% of the rate before reinsurance with risk control in it`);
  // The panel's expense block: admin + the line's slider, and the permissible
  // loss ratio 1 - that, which is exactly the pure premium's share of the rate
  // before reinsurance.
  check(plrIsThePurePremiumsShare(ratePieces(n).yours, plrShown(n)), `${line} rc ${rc}: the panel's permissible loss ratio ${plrShown(n)} is not the pure premium's share of the rate`);
  check(n.riskControlPct === rc, `${line} rc ${rc}: the panel's Risk control row is not the line's choice (${n.riskControlPct})`);
}
console.log(`  risk control at 1-5%: ${boxChecked} cases, the Risk Control row against the box per $100, worst ${worstBox.toExponential(2)}`);

// --------------------------------------------------------------------------
console.log('\n--- 4. CONTROLS: THE BROKEN PANELS MUST BE CAUGHT ---');
{
  const gs = games[0];
  const line: CoverageLine = 'WC';
  const ds = withLine(defaultDecisionSet(1), line, { fundingAtExpected: false, fundingConfidenceLevel: 0.9 });
  const n = panel(gs, line, ds);
  const p = ratePieces(n);
  // The old rows: the retained pure premium without the CLF.
  const old = { ...p.yours, purePremium: n.purePremiumRetained };
  check(!addsUp(old, n.finalRatePer100), 'control: the retained pure premium without the CLF was not caught');
  // A cent too much in Risk Control.
  const extra = { ...p.yours, riskControl: p.yours.riskControl + 0.01 };
  check(!addsUp(extra, n.finalRatePer100), 'control: an extra cent in Risk Control was not caught');
  // WC's old 2% profit and contingency taken out of admin: the share predicate must see it.
  check(!adminIsTheLines({ ...p.yours, admin: p.yours.admin - (p.yours.rate - p.yours.reins) * 0.02 }, line),
    'control: WC admin less the old 2% profit and contingency was not caught');
  // A Risk Control row priced on the Indicated rate, not the box's.
  const on = boxRow(gs, line, withLine(ds, line, { riskControlIncentivePct: 0.05 }), x => ratePieces(x).indicated.riskControl);
  check(Math.abs(on.row - on.box) > 1e-6, 'control: a Risk Control row priced on the Indicated rate was not caught');
  // The charge priced as wip/risk-control's multiplier: (1 + slider) on the
  // rate, so the slider's part of the rate before reinsurance was slider / (1 + slider).
  {
    const rds = withLine(ds, line, { riskControlIncentivePct: 0.05 });
    const s = struck(gs, line, rds.byLine[line]);
    const old = (s.quote.finalRatePer100 - s.quote.reinsRatePer100) * 0.05 / 1.05 * s.exposure * 10_000;
    const box = riskControlCost(stateOf(gs, rds), line, rds) ?? NaN;
    check(Math.abs(old - box) > 1e-6 * box, 'control: the charge priced as the multiplier, (1 + slider), was not caught');
  }
  // The multiplier's permissible loss ratio, (1 - admin) / (1 + slider), against a panel at 5%.
  {
    const rds = withLine(ds, line, { riskControlIncentivePct: 0.05 });
    const n5 = panel(gs, line, rds);
    check(!plrIsThePurePremiumsShare(ratePieces(n5).yours, (1 - n5.adminShare) / (1 + n5.riskControlPct)),
      'control: the multiplier\'s permissible loss ratio, (1 - admin) / (1 + slider), was not caught');
  }
  console.log('  six broken panels: the old pure premium, an extra cent in Risk Control, admin less the old contingency, Risk Control off the box, the multiplier charge, the multiplier\'s permissible loss ratio');
}

console.log(`\n${checks} checks.`);
console.log(failures === 0
  ? 'EVERY FIGURE THE DECISIONS PAGE PRINTS IS THE ENGINE\'S, AND YOUR RATE\'S PIECES SUM TO THE RATE.'
  : `${failures} FAILURE(S).`);
process.exit(failures === 0 ? 0 : 1);
