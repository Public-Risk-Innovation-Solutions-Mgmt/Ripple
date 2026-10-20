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

import { BOOK_INTAKE_SHARE, FULL_MARKET_EXPOSURE, R_MODEL, UNIT_RISK_CV, UNIT_UW_VISIBILITY } from '../data/pricingParameters';
import { deriveSubRng } from './random';
import { marketUnits, type BookUnit } from './bookUnits';
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
export const cutShare = (cut: number | undefined) => {
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

// ============================================================================
// UNDERWRITING ON BOOK UNITS (book units commit 4) — the book moves unit by
// unit, so what it is changes, not only how big it is.
//
//   RENEWAL     declines the units that LOOK riskiest (observedRiskScore), in
//               that order, until the declined exposure is as close as whole
//               units come to the renewal cut's share of the book.
//   WITHDRAWAL  a Member Withdrawal in force removes R_MODEL's 25% of what is
//               left, units leaving in a seeded order that knows nothing of
//               risk.
//   INTAKE      takes the prospects — market units the book does not hold and
//               did not just decline — that LOOK best, until the written
//               exposure is as close as whole units come to the intake
//               position's share of the book at the start of the year. The
//               market is the cap.
//
// ⚠ SHARED ACROSS WORLDS: everything here reads the GAME's seed (the market,
// each unit's noise, the withdrawal order) and the team's one decision, so
// every world moves the same book the same way; only loss draws differ.
// ============================================================================

const RISK_SIGMA = Math.sqrt(Math.log(1 + UNIT_RISK_CV * UNIT_RISK_CV));

/** What underwriting sees of a unit's risk, on the log scale (higher looks riskier). See UNIT_UW_VISIBILITY. */
export function observedRiskScore(u: Pick<BookUnit, 'risk' | 'noiseZ'>, visibility = UNIT_UW_VISIBILITY): number {
  const v = Math.min(1, Math.max(0, visibility));
  return Math.sqrt(v) * Math.log(u.risk) + Math.sqrt(1 - v) * RISK_SIGMA * u.noiseZ;
}

/** Take units in order while each one brings the running total closer to the target. */
function takeToward(order: readonly BookUnit[], target: number): BookUnit[] {
  const out: BookUnit[] = [];
  let held = 0;
  for (const u of order) {
    if (!(held + u.size / 2 <= target)) break;
    out.push(u);
    held += u.size;
  }
  return out;
}

export interface UnitBookMovement extends BookMovement {
  /** The book after movement, indices into the market, sorted. */
  afterUnits: number[];
  /** The units written this year — the new business. */
  writtenUnits: number[];
  declinedUnits: number[];
  withdrawnUnits: number[];
}

export function moveBookUnits(
  line: CoverageLine,
  marketSeed: number,
  book: readonly number[],
  decisions: { renewalCut?: number; intakeLevel?: number },
  withdrawal: boolean,
  frozen: boolean,
  yearNumber: number,
  visibility = UNIT_UW_VISIBILITY,
): UnitBookMovement {
  const market = marketUnits(marketSeed, line);
  const held = book.map(i => market[i]);
  const before = held.reduce((a, u) => a + u.size, 0);
  if (frozen) {
    return {
      before, renewedOff: 0, withdrawn: 0, written: 0, after: before, newShare: 0,
      afterUnits: [...book].sort((a, b) => a - b), writtenUnits: [], declinedUnits: [], withdrawnUnits: [],
    };
  }
  const score = (u: BookUnit) => observedRiskScore(u, visibility);
  // Renewal: the riskiest-looking first.
  const declined = takeToward([...held].sort((a, b) => score(b) - score(a) || a.index - b.index), before * cutShare(decisions.renewalCut));
  const declinedSet = new Set(declined.map(u => u.index));
  let kept = held.filter(u => !declinedSet.has(u.index));
  // Withdrawal: a seeded order, from the game's seed.
  let withdrawn: BookUnit[] = [];
  if (withdrawal) {
    const rng = deriveSubRng(marketSeed, yearNumber, `unit_withdraw_${line}`);
    const order = [...kept].sort((a, b) => a.index - b.index);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const keptSize = kept.reduce((a, u) => a + u.size, 0);
    withdrawn = takeToward(order, keptSize * R_MODEL.memberWithdrawalReduction);
    const gone = new Set(withdrawn.map(u => u.index));
    kept = kept.filter(u => !gone.has(u.index));
  }
  // Intake: the best-looking prospects.
  const inBook = new Set(book);
  const prospects = market.filter(u => !inBook.has(u.index));
  const written = takeToward([...prospects].sort((a, b) => score(a) - score(b) || a.index - b.index), before * intakeShare(decisions.intakeLevel));
  const sum = (us: BookUnit[]) => us.reduce((a, u) => a + u.size, 0);
  const book2 = [...kept, ...written];
  const after = sum(book2);
  return {
    before, renewedOff: sum(declined), withdrawn: sum(withdrawn), written: sum(written), after,
    newShare: after > 0 ? sum(written) / after : 0,
    afterUnits: book2.map(u => u.index).sort((a, b) => a - b),
    writtenUnits: written.map(u => u.index).sort((a, b) => a - b),
    declinedUnits: declined.map(u => u.index).sort((a, b) => a - b),
    withdrawnUnits: withdrawn.map(u => u.index).sort((a, b) => a - b),
  };
}
