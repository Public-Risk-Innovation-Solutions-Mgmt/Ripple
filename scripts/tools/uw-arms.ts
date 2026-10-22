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
//   open        0% declined, 0% rejected    — every applicant joins: grows
//   reject 15   0% declined, 15% rejected   — grows more slowly
//   renew 5     5% declined, 0% rejected    — about level
//   both        10% declined, 15% rejected  — both strictest: shrinks
//
// On the member path the rejection rate admits a random (1 − rate) share of
// that year's applicants (membershipEngine); renewals decline the worst
// members on their own loss run.
// ============================================================================

import type { CoverageLine, DecisionSet } from '../../src/types/simulation';

export interface UwArm { name: string; renewalsDeclined: number; newBusinessRejection: number }

export const UW_ARMS: readonly UwArm[] = [
  { name: 'open', renewalsDeclined: 0, newBusinessRejection: 0 },
  { name: 'reject 15', renewalsDeclined: 0, newBusinessRejection: 0.15 },
  { name: 'renew 5', renewalsDeclined: 0.05, newBusinessRejection: 0 },
  { name: 'both', renewalsDeclined: 0.10, newBusinessRejection: 0.15 },
];

/** Arm indices, in UW_ARMS order. */
export const ARM_OPEN = 0, ARM_REJECT = 1, ARM_RENEW = 2, ARM_BOTH = 3;

export const armLabel = (arm: number): string => UW_ARMS[arm].name;

/** Set every given line's two sliders to the arm's. */
export function applyArm(d: DecisionSet, lines: readonly CoverageLine[], arm: number): void {
  for (const l of lines) {
    d.byLine[l].renewalsDeclined = UW_ARMS[arm].renewalsDeclined;
    d.byLine[l].newBusinessRejection = UW_ARMS[arm].newBusinessRejection;
  }
}
