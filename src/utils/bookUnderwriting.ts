// ============================================================================
// UNDERWRITING AS EXPOSURE — one book per line, with MEMBER_LEVEL off.
//
// Loss engine commit 3. With no members, the three things that moved the
// roster move the book's exposure instead:
//
//   RENEWAL     the renewal cut declines that share of the book.
//   WITHDRAWAL  a Member Withdrawal in force removes R_MODEL's 25% of what is
//               left, at the renewal after the event.
//   INTAKE      the intake position writes BOOK_INTAKE_SHARE of the book as it
//               stood at the start of the year, as new business.
//
// The book is capped at FULL_MARKET_EXPOSURE: intake stops at today's whole
// market. The pre-game moves nothing — its book is the opening, as its roster
// was.
//
// ⚠ IT RETURNS THE MEMBERSHIP ENGINE'S SHAPE. Everything downstream of movement
// reads a MemberMovementResult; handing it one with an empty roster and the
// book's exposure is what lets the engine run without members and without a
// second copy of everything after movement. The member-level fields are
// neutral: no members, no counts, satisfaction and risk quality carried as
// they stood — both are hidden and feed nothing with MEMBER_LEVEL off.
// ============================================================================

import { BOOK_INTAKE_SHARE, FULL_MARKET_EXPOSURE, R_MODEL } from '../data/pricingParameters';
import { RENEWAL_CUT_STEPS } from './renewalUnderwriting';
import type { CoverageLine } from '../types/simulation';
import type { MemberMovementResult } from './membershipEngine';

export interface BookMovement {
  /** Base-year exposure, $M, at the start of the year. */
  before: number;
  renewedOff: number;
  withdrawn: number;
  written: number;
  /** Base-year exposure, $M, after movement and the cap. */
  after: number;
  /** The share of `after` written this year — what a new-business penalty bites on. */
  newShare: number;
}

/** The renewal cut, read as the share of the book it declines. */
const cutShare = (cut: number | undefined) => {
  const c = cut ?? 0;
  if (!(c >= 0)) return 0;
  return Math.min(c, RENEWAL_CUT_STEPS[RENEWAL_CUT_STEPS.length - 1]);
};

/** The intake position, read as the share of the book written. */
export const intakeShare = (level: number | undefined) =>
  BOOK_INTAKE_SHARE[Math.max(0, Math.min(BOOK_INTAKE_SHARE.length - 1, Math.floor(level ?? 0)))];

export function moveBook(
  line: CoverageLine,
  before: number,
  decisions: { renewalCut?: number; intakeLevel?: number },
  withdrawal: boolean,
  frozen: boolean,
): BookMovement {
  if (frozen) return { before, renewedOff: 0, withdrawn: 0, written: 0, after: before, newShare: 0 };
  const renewedOff = before * cutShare(decisions.renewalCut);
  const kept = before - renewedOff;
  const withdrawn = withdrawal ? kept * R_MODEL.memberWithdrawalReduction : 0;
  const room = Math.max(0, FULL_MARKET_EXPOSURE[line] - (kept - withdrawn));
  const written = Math.min(room, before * intakeShare(decisions.intakeLevel));
  const after = kept - withdrawn + written;
  return { before, renewedOff, withdrawn, written, after, newShare: after > 0 ? written / after : 0 };
}

/**
 * The movement as the engine reads it. `factor` is the year's exposureFactor,
 * so the exposures are the year's own as a roster's would be.
 */
export function bookMovementResult(
  line: CoverageLine, m: BookMovement, factor: number, memberSatisfaction: number, riskQuality: number,
): MemberMovementResult {
  return {
    activeMembers: [],
    newMembers: [],
    withdrawnMembers: [],
    intakeRoom: 0,
    applicantCount: 0,
    eligibleCount: 0,
    retentionRate: m.before > 0 ? (m.before - m.renewedOff - m.withdrawn) / m.before : 1,
    // The POOL-LEVEL scalar, carried as it stood — not any member's own score.
    memberSatisfaction,
    averageRiskQuality: riskQuality,
    activeExposure: m.after * factor,
    totalMarketExposure: FULL_MARKET_EXPOSURE[line] * factor,
  };
}
