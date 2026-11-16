// ============================================================================
// SIMPLE UNDERWRITING — one book per line of UNDERWRITING_MEMBERS equal
// members, with MEMBER_LEVEL off.
//
// The members exist only for their luck draws (ordinaryLoss.ts). Underwriting
// moves the line's EXPOSURE, and with it this year's ordinary loss per unit:
//
//   NON-RENEWAL  a1 of the book at the start of the year leaves; the rest runs
//                NON_RENEWAL_LOSS_RELIEF x a1 cheaper this year.
//   WITHDRAWAL   a Member Withdrawal in force removes R_MODEL's 25% of what
//                renews, at the renewal after the event.
//   NEW MEMBERS  a2 of the book at the start of the year joins; it costs
//                1 + NEW_BUSINESS_PENALTY per unit this year.
//
//   lossFactor = [ renewing x (1 − 0.5 a1) + new x 1.2 ] / after
//
// so the year's expected ordinary loss is f(x) x after x lossFactor =
// f(x) x E x [ (1 − a1)(1 − 0.5 a1) + 1.2 a2 ] with no withdrawal. One year
// only: next year's factor is 1 unless a slider is used again. ⚠ NOT IN
// PRICING'S EXPECTED LOSS — the rate learns it through the experience.
//
// Every setting is in pricingParameters.ts, under UNDERWRITING. The book is
// capped at FULL_MARKET_EXPOSURE. The pre-game neither renews nor withdraws:
// its book GROWS by the prior board's New Members each year (PRIOR_BOARD —
// drawn around 5% per scenario, preGameNewMembers) into today's opening book
// (preGameBook), the growth at the penalty.
//
// ⚠ IT RETURNS THE MEMBERSHIP ENGINE'S SHAPE. Everything downstream of movement
// reads a MemberMovementResult; handing it one with an empty roster and the
// book's exposure is what lets the engine run without a roster and without a
// second copy of everything after movement. The roster fields are neutral:
// no members, no counts, satisfaction and risk quality carried as they stood —
// both are hidden and feed nothing with MEMBER_LEVEL off.
// ============================================================================

import {
  FULL_MARKET_EXPOSURE, NEW_BUSINESS_PENALTY, NEW_MEMBERS_SLIDER, NON_RENEWAL_LOSS_RELIEF, NON_RENEWAL_SLIDER,
  OPENING_BOOK_EXPOSURE, PRIOR_BOARD, PRIOR_HISTORY_YEARS, R_MODEL,
} from '../data/pricingParameters';
import { deriveSubRng } from './random';
import type { CoverageLine, MarketLineInput } from '../types/simulation';
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
   * [renewing x (1 − relief x a1) + written x (1 + penalty)] / after. 1 with
   * no movement. On the year's actual ordinary losses only.
   */
  lossFactor: number;
}

const clampTo = (v: number | undefined, r: { min: number; max: number }) => {
  const x = v ?? 0;
  return x >= r.min ? Math.min(x, r.max) : r.min;
};

/** "Non-renewal", read as the share of the book at the start of the year that leaves. */
export const nonRenewalShare = (v: number | undefined) => clampTo(v, NON_RENEWAL_SLIDER);

/** "New members", read as the share of the book at the start of the year added. */
export const newMembersShare = (v: number | undefined) => clampTo(v, NEW_MEMBERS_SLIDER);

type UwDecisions = { nonRenewal?: number; newMembers?: number };

/**
 * THE YEAR'S MARKET RESULT FOR ONE LINE (hosted games with market competition;
 * the server's stored result, src/utils/market/marketStep.ts). Absent — single
 * player, Test player, a room with the market Off, the pre-game — and the book
 * moves exactly as it always has.
 *
 * With it, the book moves by the market instead of the sliders:
 *   - `leftShare` of the book at the start of the year left for cheaper teams;
 *   - `intake` came in (good leavers, outside supply, other teams' non-renewed
 *     members), bringing its own quality — inside `bookRisk`, never the flat
 *     NEW_BUSINESS_PENALTY;
 *   - `engineNonRenewal` of the moved book is this year's non-renewal, dropped
 *     here with today's relief (NON_RENEWAL_LOSS_RELIEF) on what remains;
 *   - `bookRisk` multiplies the year's ordinary loss per unit (lossFactor), so
 *     pricing learns it only through the experience.
 * The New Members slider grows nothing itself: in a market it is the appetite
 * the server already used.
 */
export type { MarketLineInput };

/** The first pre-game year's number (2021): the pre-game runs to year 0. */
const FIRST_PRE_GAME_YEAR = 1 - PRIOR_HISTORY_YEARS;

/**
 * THE PRIOR BOARD'S NEW MEMBERS IN PRE-GAME YEAR `y` (PRIOR_BOARD): a normal
 * draw around newMembersMean with newMembersSpread, cut to the slider's range,
 * on the game seed's own stream for the line and year. The first pre-game year
 * (2021) has no book before it to grow from, so it adds none; played years
 * (y > 0) are the team's and read 0 here.
 */
export function preGameNewMembers(seed: number, line: CoverageLine, y: number): number {
  if (y <= FIRST_PRE_GAME_YEAR || y > 0) return 0;
  const z = deriveSubRng(seed, y, `pregame_new_members_${line}`).normal(0, 1);
  return Math.min(NEW_MEMBERS_SLIDER.max, Math.max(NEW_MEMBERS_SLIDER.min,
    PRIOR_BOARD.newMembersMean + PRIOR_BOARD.newMembersSpread * z));
}

/**
 * The pre-game book in year `y` (≤ 0): today's opening book in 2026, and each
 * earlier year the next year's book over (1 + that next year's New Members) —
 * so the history ends exactly on OPENING_BOOK_EXPOSURE whatever was drawn.
 */
export function preGameBook(line: CoverageLine, y: number, seed: number): number {
  let book = OPENING_BOOK_EXPOSURE[line];
  for (let k = 0; k > Math.max(FIRST_PRE_GAME_YEAR, Math.min(0, y)); k--) book /= 1 + preGameNewMembers(seed, line, k);
  return book;
}

const lossFactorOf = (renewing: number, relief: number, written: number, after: number) =>
  after > 0 ? (renewing * (1 - relief) + written * (1 + NEW_BUSINESS_PENALTY)) / after : 1;

export function moveBook(
  line: CoverageLine,
  before: number,
  decisions: UwDecisions,
  withdrawal: boolean,
  frozen: boolean,
  yearNumber: number,
  market?: MarketLineInput,
  /** The game seed — the pre-game's New Members are drawn on it (preGameNewMembers). Read only in the pre-game. */
  seed = 0,
): BookMovement {
  if (market && !frozen) return moveBookByMarket(before, market, withdrawal);
  // THE PRE-GAME GROWS INTO THE OPENING BOOK by the prior board's New Members, its growth new exposure at the penalty.
  if (frozen && yearNumber <= 0) {
    const after = preGameBook(line, yearNumber, seed);
    const prev = yearNumber > FIRST_PRE_GAME_YEAR ? preGameBook(line, yearNumber - 1, seed) : after;
    const written = Math.max(0, after - prev);
    return {
      before: prev, renewedOff: 0, withdrawn: 0, written, after, newShare: after > 0 ? written / after : 0,
      lossFactor: lossFactorOf(after - written, 0, written, after),
    };
  }
  if (frozen) return { before, renewedOff: 0, withdrawn: 0, written: 0, after: before, newShare: 0, lossFactor: 1 };
  const a1 = nonRenewalShare(decisions.nonRenewal);
  const renewedOff = before * a1;
  const kept = before - renewedOff;
  const withdrawn = withdrawal ? kept * R_MODEL.memberWithdrawalReduction : 0;
  const renewing = kept - withdrawn;
  const room = Math.max(0, FULL_MARKET_EXPOSURE[line] - renewing);
  const written = Math.min(room, before * newMembersShare(decisions.newMembers));
  const after = renewing + written;
  return {
    before, renewedOff, withdrawn, written, after, newShare: after > 0 ? written / after : 0,
    lossFactor: lossFactorOf(renewing, NON_RENEWAL_LOSS_RELIEF * a1, written, after),
  };
}

/**
 * THE BOOK MOVED BY THE MARKET (MarketLineInput). `renewedOff` is everything
 * that left — to cheaper teams and as non-renewal — and `written` everything that
 * came in, so before − renewedOff − withdrawn + written = after still holds.
 */
function moveBookByMarket(before: number, m: MarketLineInput, withdrawal: boolean): BookMovement {
  const moved = before * (1 - m.leftShare) + m.intake;
  const a1 = Math.max(0, m.engineNonRenewal);
  const dropped = moved * a1;
  const kept = moved - dropped;
  const withdrawn = withdrawal ? kept * R_MODEL.memberWithdrawalReduction : 0;
  const after = kept - withdrawn;
  const written = m.intake;
  return {
    before, renewedOff: before * m.leftShare + dropped, withdrawn, written, after,
    newShare: after > 0 ? Math.min(1, written / after) : 0,
    lossFactor: after > 0 ? m.bookRisk * (1 - NON_RENEWAL_LOSS_RELIEF * a1) : 1,
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
