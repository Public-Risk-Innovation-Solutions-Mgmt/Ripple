// ============================================================================
// SIMPLE UNDERWRITING — one book per line of UNDERWRITING_MEMBERS equal
// members, with MEMBER_LEVEL off.
//
// The members exist only for their luck draws (ordinaryLoss.ts). Underwriting
// moves the line's EXPOSURE, and with it this year's ordinary loss per unit:
//
//   NON-RENEWAL  a1 of the book at the start of the year leaves; the rest runs
//                NON_RENEWAL_LOSS_RELIEF x a1 cheaper this year — and, by
//                NON_RENEWAL_PERSISTENCE, in later years too: the book
//                carries a quality Q (loss per unit f(x) x Q) that new
//                members, joining at 1, dilute.
//   WITHDRAWAL   a Member Withdrawal in force removes R_MODEL's 25% of what
//                renews, at the renewal after the event.
//   NEW MEMBERS  a2 of the book at the start of the year joins; it costs
//                1 + NEW_BUSINESS_PENALTY per unit this year.
//
//   carried    = 1 − carry x (1 − Q)                 (carry 0 · 0.5 · 1)
//   lossFactor = [ renewing x carried x (1 − 0.5 a1) + new x 1.2 ] / after
//   Q next     = [ renewing x carried x (1 − 0.5 a1) + new ] / after
//
// so with Q at 1 the year's expected ordinary loss is f(x) x after x
// lossFactor = f(x) x E x [ (1 − a1)(1 − 0.5 a1) + 1.2 a2 ] with no
// withdrawal. In the oneYear version carry is 0 and next year's factor is 1
// unless a slider is used again. ⚠ NOT IN
// PRICING'S EXPECTED LOSS — the rate learns it through the experience.
//
// Every setting is in pricingParameters.ts, under UNDERWRITING. The book is
// capped at FULL_MARKET_EXPOSURE. The pre-game neither renews, withdraws nor
// underwrites: its book GROWS by PRE_GAME_BOOK_GROWTH a year into the opening
// book (preGameBook), the growth at the penalty, with no decision in it.
//
// ⚠ IT RETURNS THE MEMBERSHIP ENGINE'S SHAPE. Everything downstream of movement
// reads a MemberMovementResult; handing it one with an empty roster and the
// book's exposure is what lets the engine run without a roster and without a
// second copy of everything after movement. The roster fields are neutral:
// no members, no counts, satisfaction and risk quality carried as they stood —
// both are hidden and feed nothing with MEMBER_LEVEL off.
// ============================================================================

import {
  FULL_MARKET_EXPOSURE, NEW_BUSINESS_PENALTY, NEW_MEMBERS_SLIDER, NON_RENEWAL_DECAY, NON_RENEWAL_LOSS_RELIEF,
  NON_RENEWAL_PERSISTENCE, NON_RENEWAL_SLIDER,
  OPENING_BOOK_EXPOSURE, PRE_GAME_BOOK_GROWTH, PRIOR_HISTORY_YEARS, R_MODEL,
} from '../data/pricingParameters';
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
  /** The share of `after` written this year. */
  newShare: number;
  /**
   * This year's ordinary loss per unit of `after`, over the line's cost:
   * [renewing x renewingQuality + written x (1 + penalty)] / after. 1 with
   * no movement. On the year's actual ordinary losses only.
   */
  lossFactor: number;
  /** The renewing book's loss per unit this year, over the line's cost: carried Q x (1 − relief x a1). */
  renewingQuality: number;
  /** The book's quality Q at year end — renewing and new blended by exposure (LinePoolState.bookQuality). */
  qualityAfter: number;
}

/** The share of last year's improvement carried into this one (NON_RENEWAL_PERSISTENCE). */
export const persistenceCarry = (): number =>
  NON_RENEWAL_PERSISTENCE.mode === 'lasting' ? 1 : NON_RENEWAL_PERSISTENCE.mode === 'decaying' ? NON_RENEWAL_DECAY : 0;

const clampTo = (v: number | undefined, r: { min: number; max: number }) => {
  const x = v ?? 0;
  return x >= r.min ? Math.min(x, r.max) : r.min;
};

/** "Non-renewal", read as the share of the book at the start of the year that leaves. */
export const nonRenewalShare = (v: number | undefined) => clampTo(v, NON_RENEWAL_SLIDER);

/** "New members", read as the share of the book at the start of the year added. */
export const newMembersShare = (v: number | undefined) => clampTo(v, NEW_MEMBERS_SLIDER);

type UwDecisions = { nonRenewal?: number; newMembers?: number };

/** The first pre-game year's number (2021): the pre-game runs to year 0. */
const FIRST_PRE_GAME_YEAR = 1 - PRIOR_HISTORY_YEARS;

/** The pre-game book in year `y` (≤ 0): the opening book x (1 + growth)^y. */
export const preGameBook = (line: CoverageLine, y: number): number =>
  OPENING_BOOK_EXPOSURE[line] * Math.pow(1 + PRE_GAME_BOOK_GROWTH, Math.min(0, y));

const lossFactorOf = (renewing: number, quality: number, written: number, after: number) =>
  after > 0 ? (renewing * quality + written * (1 + NEW_BUSINESS_PENALTY)) / after : 1;

export function moveBook(
  line: CoverageLine,
  before: number,
  decisions: UwDecisions,
  withdrawal: boolean,
  frozen: boolean,
  yearNumber: number,
  // The book's quality Q at the start of the year (LinePoolState.bookQuality); absent is 1.
  quality = 1,
): BookMovement {
  // THE PRE-GAME GROWS INTO THE OPENING BOOK (PRE_GAME_BOOK_GROWTH), its growth new exposure at the penalty.
  if (frozen && yearNumber <= 0) {
    const after = preGameBook(line, yearNumber);
    const prev = yearNumber > FIRST_PRE_GAME_YEAR ? preGameBook(line, yearNumber - 1) : after;
    const written = Math.max(0, after - prev);
    return {
      before: prev, renewedOff: 0, withdrawn: 0, written, after, newShare: after > 0 ? written / after : 0,
      lossFactor: lossFactorOf(after - written, 1, written, after), renewingQuality: 1, qualityAfter: 1,
    };
  }
  if (frozen) {
    return { before, renewedOff: 0, withdrawn: 0, written: 0, after: before, newShare: 0, lossFactor: 1,
      renewingQuality: 1, qualityAfter: quality };
  }
  const a1 = nonRenewalShare(decisions.nonRenewal);
  const renewedOff = before * a1;
  const kept = before - renewedOff;
  const withdrawn = withdrawal ? kept * R_MODEL.memberWithdrawalReduction : 0;
  const renewing = kept - withdrawn;
  const room = Math.max(0, FULL_MARKET_EXPOSURE[line] - renewing);
  const written = Math.min(room, before * newMembersShare(decisions.newMembers));
  const after = renewing + written;
  // What last year's improvement leaves this year, then this year's own on top.
  const carried = 1 - persistenceCarry() * (1 - quality);
  const renewingQuality = carried * (1 - NON_RENEWAL_LOSS_RELIEF * a1);
  return {
    before, renewedOff, withdrawn, written, after, newShare: after > 0 ? written / after : 0,
    lossFactor: lossFactorOf(renewing, renewingQuality, written, after),
    // New members join at quality 1; their penalty is first-year only.
    renewingQuality, qualityAfter: after > 0 ? (renewing * renewingQuality + written) / after : 1,
  };
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
