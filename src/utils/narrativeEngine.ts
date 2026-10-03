// Rule-based narrative explanation engine for Risk Pool Simulation v1

import type { CoverageLine, ResultSet } from '../types/simulation';
import { REINSURANCE_TOWER, type TowerLine } from '../data/reinsuranceTower';
import { LINE_FULL_NAME } from './lineDisplay';
import { eventSentence, yearEvents } from './yearEvents';

export function generateNarrative(result: ResultSet, _priorResult?: ResultSet): string {
  const parts: string[] = [];

  const { assetAllocation, actualCombinedRatio, netIncome,
    actualLossRatioPricingBasis, expectedLossRatio,
    reinsuranceRecovery, investmentIncome,
    newMembers, withdrawnMembers,
    priorYearDevelopment, endingSurplus } = result;

  // --- Rate Change --- REMOVED. The Rate Change decision it narrated is gone
  // (CLF-only pricing); a narrative describing the funding-confidence-level
  // decision instead is a pending replacement, not invented here.

  // --- Underwriting --- REMOVED WITH THE SLIDER IT NARRATED. Both branches
  // described the pool in RISK-QUALITY terms ("improved average risk
  // quality"), which is an attribute the player can no longer see per member
  // and which the retired strictness screen selected on directly. A narrative
  // for the experience modifier is a pending replacement, not invented here —
  // the same treatment the Rate Change narrative got above.

  // --- Events ---
  // FIRST, because it is what a player most needs from the year and the first
  // thing they read. One sentence per event, written from what happened —
  // where, which lines, how many claims, how much — by the same template for a
  // scheduled event and a drawn catastrophe (yearEvents.ts), so the two read
  // alike and the cause never shows.
  //
  // ⚠ THIS REPLACES "A shock loss event occurred this year, significantly
  // increasing gross losses", which fired on `shockLossIncurred`: a WC or GL
  // claim over $1M, so nearly every year, and never on a Property catastrophe.
  for (const ev of yearEvents(result)) parts.push(eventSentence(ev));

  // --- Loss Performance ---
  // ⚠ THIS WAS A FOURTH BASIS AND IT CONTRADICTED THE SCREEN IT SAT ON.
  // It read `grossUltimateLoss / totalMemberCharge` — a GROSS numerator over the
  // MEMBER-CHARGE denominator, a combination used nowhere else in the app — and
  // printed the result as "a loss ratio of X". With the headline on the pricing
  // basis, the same year could show 73% in the chip and prose calling it "a
  // favorable loss ratio of 52%". Two numbers, two bases, one screen.
  //
  // ⚠ AND IT WAS NOT INERT, CONTRARY TO A REPORT OF MINE. That report said the
  // prose "sits permanently in the silent middle and never fires", reasoning
  // from the 66.8% POOLED DOLLAR-WEIGHTED average to the per-year firing rate.
  // Those are different statistics. Measured per year over 1,200 pooled
  // observations it fired low on 38.8% and high on 16.7%, silent on 44.6% — so
  // it fired on more than half of all years, on the wrong basis, in prose a
  // player reads. The correction matters because it makes this a live defect
  // rather than dead code.
  //
  // THE THRESHOLDS ARE ANCHORED ON THE PRICED EXPECTATION, NOT FITTED TO THE
  // DISTRIBUTION. expectedLossRatio shares this exact denominator and runs
  // 80.9% pooled (78.9-82.4% across seeds), so 0.65 and 0.95 sit roughly
  // symmetrically either side of what the year was PRICED to produce. Measured
  // firing on the new basis: low 31.5%, high 15.2%, silent 53.3%.
  const lossRatio = actualLossRatioPricingBasis;
  if (lossRatio > 0.95) {
    parts.push(`Net loss performance was unfavorable at ${pct(lossRatio)} of premium and admin expense, against roughly ${pct(expectedLossRatio)} priced.`);
  } else if (lossRatio < 0.65) {
    parts.push(`Net loss performance was strong at ${pct(lossRatio)} of premium and admin expense, against roughly ${pct(expectedLossRatio)} priced.`);
  }

  // --- Combined Ratio ---
  if (actualCombinedRatio > 1.0) {
    parts.push(`The actual combined ratio was ${pct(actualCombinedRatio)}, so the year was underfunded and consumed surplus.`);
  } else if (actualCombinedRatio < 1.0) {
    parts.push(`The actual combined ratio was ${pct(actualCombinedRatio)}, leaving a funding margin that supports surplus.`);
  }

  // --- Reinsurance ---
  // ONE PRODUCT NOW. Every line runs the per-occurrence tower, so
  // resultUsesTower(result) is always true; the percentage-of-premium branch
  // this used to fall back to (keyed on the now-removed `reinsuranceLevel`)
  // is deleted rather than narrated, per the same reasoning as
  // reinsuranceDisplay.ts: a narrative describing a quota share on a line
  // with a tower would be worse than no narrative.
  {
    const anyPlaced = (result.cededByLayer ?? []).length > 0
      && (result.decisions.layersPlaced ?? []).some(Boolean);
    if (reinsuranceRecovery > 0) {
      parts.push(`The reinsurance tower recovered $${fmt(reinsuranceRecovery)}, reducing net losses.`);
    } else if (anyPlaced) {
      // Each line's OWN retention, read from its tower. This said "the $1M
      // retention" on every line, including Property, which retains $5M.
      parts.push(`Occurrence layers were placed but no single occurrence reached its line's retention (${retentionList(result)}).`);
    } else {
      parts.push(`No occurrence layers were placed — the pool retained every loss in full.`);
    }
    const above = result.retainedAboveTower ?? 0;
    if (above > 0) {
      parts.push(`$${fmt(above)} fell ABOVE the top of the tower and could not be reinsured at any price.`);
    }
  }

  // --- Investment ---
  if (assetAllocation.equitiesPct >= 50) {
    if (investmentIncome > 0) {
      parts.push(`An equities-heavy allocation generated strong investment income of $${fmt(investmentIncome)}.`);
    } else {
      parts.push(`An equities-heavy allocation resulted in an investment loss this year.`);
    }
  } else if (assetAllocation.equitiesPct <= 15) {
    parts.push(`A cash/bonds-heavy allocation produced modest but stable investment income of $${fmt(investmentIncome)}.`);
  }

  // --- Membership ---
  if (newMembers > 3) {
    parts.push(`${newMembers} new members joined the pool this year.`);
  }
  if (withdrawnMembers > 3) {
    parts.push(`${withdrawnMembers} members withdrew from the pool.`);
  }

  // --- Funding ---
  if (result.capitalAdequacyStatus !== 'N/A') {
    if (result.capitalAdequacyStatus === 'Deficient') {
      parts.push(`The pool's excess capital position is rated ${result.capitalAdequacyStatus}, indicating a deficit relative to the required reserve margin.`);
    } else if (result.capitalAdequacyStatus === 'Thin') {
      parts.push(`The pool's excess capital position is rated ${result.capitalAdequacyStatus}, slightly below the required reserve margin.`);
    } else {
      parts.push(`The pool's excess capital position is rated ${result.capitalAdequacyStatus}.`);
    }
  }

  // --- Prior Year Development ---
  if (Math.abs(priorYearDevelopment) > 10000) {
    if (priorYearDevelopment > 0) {
      parts.push(`Prior year reserves developed favorably, releasing $${fmt(priorYearDevelopment)} to income.`);
    } else {
      parts.push(`Prior year reserves developed adversely, requiring $${fmt(Math.abs(priorYearDevelopment))} of strengthening.`);
    }
  }

  // --- Net outcome ---
  if (netIncome > 0) {
    parts.push(`Overall, the pool generated net income of $${fmt(netIncome)}, strengthening surplus to $${fmt(endingSurplus)}.`);
  } else {
    parts.push(`Overall, the pool experienced a net loss of $${fmt(Math.abs(netIncome))}, reducing surplus to $${fmt(endingSurplus)}.`);
  }

  return parts.join(' ');
}

// "Workers' Compensation $1M, Property $5M" — the lines in this result.
function retentionList(result: ResultSet): string {
  const lines: CoverageLine[] = result.line ? [result.line] : (Object.keys(result.byLine ?? {}) as CoverageLine[]);
  return lines
    .filter(l => REINSURANCE_TOWER[l as TowerLine]?.length)
    .map(l => `${LINE_FULL_NAME[l]} $${Math.min(...REINSURANCE_TOWER[l as TowerLine].map(x => x.attachment)) / 1e6}M`)
    .join(', ');
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
