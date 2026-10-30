// ============================================================================
// THE YEAR'S MAIN DECISIONS, ONE ROW PER LINE — what the lock confirmation box
// (components/LockConfirmModal) shows before a year is locked, so the player
// can check before they cannot change it.
//
// ⚠ DISPLAY ONLY. Every value is read off the DecisionSet the lock would send,
// through the same readings the Decisions page and Decision History use
// (placementSummary, aggregateCoverLabel, nonRenewalShare, newMembersShare);
// nothing here feeds the engine.
// ============================================================================

import type { CoverageLine, DecisionSet } from '../types/simulation';
import { placementSummary } from './reinsuranceDisplay';
import { aggregateCoverLabel, aggregateCoverOf } from './aggregateCover';
import { newMembersShare, nonRenewalShare } from './bookUnderwriting';
import { formatCurrency } from './formatters';
import { LINE_FULL_NAME } from './lineDisplay';

const pct = (v: number, dp = 0) => `${Number((v * 100).toFixed(dp))}%`;

export interface LockSummaryLine {
  line: CoverageLine;
  name: string;
  funding: string;
  underwriting: string;
  covers: string;
  riskControl: string;
  dividendAssessment: string;
}

export interface LockSummary {
  lines: LockSummaryLine[];
  /** Pool-wide: one policy, each line applying it to its own assets. */
  assetMix: string;
}

export function lockSummary(decisions: DecisionSet, activeLines: CoverageLine[]): LockSummary {
  const lines = activeLines.filter(l => decisions.byLine[l]).map(line => {
    const d = decisions.byLine[line];
    const aggregate = aggregateCoverOf(d);
    const dividendAssessment = d.dividendAmount > 0 ? `Dividend ${formatCurrency(d.dividendAmount, true)}`
      : d.assessmentAmount > 0 ? `Assessment ${formatCurrency(d.assessmentAmount, true)}`
      : 'No dividend or assessment';
    return {
      line,
      name: LINE_FULL_NAME[line],
      funding: d.fundingAtExpected ? 'Expected' : `${pct(d.fundingConfidenceLevel)} confidence`,
      underwriting: `Non-renewal ${pct(nonRenewalShare(d.nonRenewal))} · New members ${pct(newMembersShare(d.newMembers))}`,
      covers: aggregate === 'none'
        ? placementSummary(line, d)
        : `${placementSummary(line, d)} · Aggregate: ${aggregateCoverLabel(aggregate).name}`,
      riskControl: `${pct(d.riskControlIncentivePct ?? 0, 1)} of the rate`,
      dividendAssessment,
    };
  });
  const a = decisions.assetAllocation;
  return {
    lines,
    assetMix: `Cash ${a.cashPct.toFixed(0)}% · Bonds ${a.bondsPct.toFixed(0)}% · Equities ${a.equitiesPct.toFixed(0)}%`,
  };
}
