// ============================================================================
// THE UNDERWRITING ARMS THE INTAKE-ARM PROBES PLAY — one table, shared.
//
// clf-table-derive, clf-label-backtest-check, membership-flows-report and
// new-business-appetite-derive sampled the four intake positions to get books
// of genuinely different sizes (growing, steady, shrinking). The positions are
// retired; these are the same job done with the two sliders. ONE TABLE because
// clf-table-derive and clf-label-backtest-check must sample the same arms:
// adding an arm to one file alone would grade a table on a population it was
// not fitted on.
//
//   open        0% non-renewed, 5% new members  — grows 5% a year
//   steady      0% non-renewed, 0% new members  — level (the defaults)
//   renew 5     5% non-renewed, 0% new members  — shrinks 5% a year
//   both        5% non-renewed, 5% new members  — about level, churning
//
// Since simple underwriting (the sliders move exposure; see bookUnderwriting.ts).
// The member path reads nonRenewal as its renewal cut and admits every
// applicant.
// ============================================================================

import type { CoverageLine, DecisionSet } from '../../src/types/simulation';

export interface UwArm { name: string; nonRenewal: number; newMembers: number }

export const UW_ARMS: readonly UwArm[] = [
  { name: 'open', nonRenewal: 0, newMembers: 0.05 },
  { name: 'steady', nonRenewal: 0, newMembers: 0 },
  { name: 'renew 5', nonRenewal: 0.05, newMembers: 0 },
  { name: 'both', nonRenewal: 0.05, newMembers: 0.05 },
];

/** Arm indices, in UW_ARMS order. ARM_REJECT keeps its name from uw-hybrid: it is the steady arm now. */
export const ARM_OPEN = 0, ARM_REJECT = 1, ARM_RENEW = 2, ARM_BOTH = 3;

export const armLabel = (arm: number): string => UW_ARMS[arm].name;

/** Set every given line's two sliders to the arm's. */
export function applyArm(d: DecisionSet, lines: readonly CoverageLine[], arm: number): void {
  for (const l of lines) {
    d.byLine[l].nonRenewal = UW_ARMS[arm].nonRenewal;
    d.byLine[l].newMembers = UW_ARMS[arm].newMembers;
  }
}
