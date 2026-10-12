// ============================================================================
// RENEWAL UNDERWRITING — the pool non-renews the WORST X% of its book on each
// member's own EXPERIENCE RATIO, X being the renewal slider. See
// RENEWAL_CUT_STEPS for the steps and the ruling that replaced the threshold
// tiles; the history below records how the ratio basis was chosen, and it
// still governs what the ranking reads.
//
// ⚠ THE THRESHOLD IS ON THE RATIO, NOT ON THE MODIFIER, AND THAT IS A CHANGE.
// It used to compare the displayed modifier against 1.25 / 1.15 / 1.10. Those
// are the right shape for a modifier and meaningless as an underwriting
// decision, because the modifier is DELIBERATELY DAMPED: Z is 0.155 on WC, so
// 84.5% of what a member is charged is the class average and only 15.5% is
// them. Measured over 3,506 rated WC member-years, a member running 3x their
// own expected cost displays at about 1.31 and the whole displayed range is
// 0.93 to 1.35. Nothing in that band looks like a decision because nothing in
// that band IS one — it is a billing consequence.
//
// The ratio is what an underwriter judges: actual primary loss over the
// member's own expected primary loss, on their own class basis, over the
// window. It runs 0.24 to 5.48 on WC. See renewal-threshold-derive.ts for the
// distribution and for how the shipped level was picked off it.
//
// This is the lever that manages adverse selection. memberDeparture.ts is the
// pressure: when the price rises, the members with the best experience have
// somewhere to go and leave. This is the pool's answer — it cannot keep the
// good risks by wanting to, but it can decline the worst.
//
// ⚠ ONE STATISTIC, TWO OPPOSITE PRESSURES, AND THAT IS THE MECHANISM RATHER
// THAN A COINCIDENCE. The market poaches LOW-mod members; the pool declines
// HIGH-mod ones. Both read the same number off the same ledger.
//
// ============================================================================
// THE BASIS: RAW, AND IT IS NOW THE SAME ONE NEW BUSINESS APPETITE USES.
//
// The two controls read one ledger and used to read it two ways — this file
// compared `clampedRatio` (Mahler's rule 3, [0.5, 3.0]) and
// newBusinessAppetite.ts compared `rawRatio`. Measured before choosing, 8 games
// x 14 years, warm years only, every rated member-year, BOTH readings taken
// from the same call on the same member:
//
//   the two readings differ as NUMBERS on 20.4% of WC member-years and 23.4%
//   of GL's — 19.0% / 21.4% below the floor, 1.4% / 2.0% above the ceiling.
//
//   they differ as DECISIONS, at every level either control offers, on ZERO.
//
//     threshold   0.75  1.00  1.50  2.00  2.50  2.75  |  3.00
//     disagree       0     0     0     0     0     0  |   101 (WC), 142 (GL)
//
// ⚠ SO THE BASIS WAS NEVER THE DIFFERENCE IT LOOKED LIKE. The clamp is
// monotone, so for any threshold strictly inside (0.5, 3.0) `clamped > t` and
// `raw > t` are the same statement about the same member — not usually, not to
// a tolerance, identically. The choice therefore costs nothing at any shipped
// level and is decided entirely on what happens at the edges.
//
// RAW WINS ON TWO COUNTS, ONE OF WHICH IS THE PLAYER'S:
//
//   IT IS THE NUMBER ON THE SCREEN. The Membership page's Loss Ratio column is
//   the raw ratio and the control's own note points at it. A threshold
//   comparing something else needed a paragraph explaining that it did; it no
//   longer does.
//
//   THE CEILING DEAD ZONE GOES. On the clamped basis every value at or above
//   3.00 declined nobody on any book, ever — measured, 80 of 80 line-years at
//   exactly 0 — while raw declines 1.26 (WC) and 1.77 (GL) per line-year there.
//   A control that is silently inert at a settable value is a hazard; this file
//   carried a warning about it instead of not having it.
//
// ⚠ WHAT THE CLAMPED BASIS LOSES, NAMED RATHER THAN WAVED AT. Two things, and
// the first is real:
//
//   THE UNREACHABLE BOUND STOPS BEING STRUCTURAL. `clampedRatio` could not
//   exceed 3.0 by construction, so "a threshold that declines nobody" had a
//   proof. Ap/Ep is unbounded above, so the same statement is now an EMPIRICAL
//   bound — the observed maximum is 6.96 (WC) and 5.40 (GL). renewal-stability
//   -check's null arm is re-derived on that basis and says so at the constant.
//
//   MAHLER'S RULE 3 NO LONGER APPLIES TO THE COMPARISON. It still governs the
//   MODIFIER, which is where it belongs — a rebased billing weight is exactly
//   the quantity stability protects. What is given up here is the guarantee,
//   not a behaviour: measured, the clamp changes no decision at any level.
//
// ============================================================================
// ⚠ AND THE GAP THAT SURVIVES IS NOT THIS ONE. It is bigger, and choosing a
// reading cannot close it.
//
// An applicant's claims are drawn at kLine = 1 with riskControlEffectiveness =
// 0; an enrolled member's carry the book's own k and whatever risk control the
// pool has bought. Both legs of the ratio see k, so the MODIFIER is k-invariant
// — every member of a line-year shares one k and the rebase divisor absorbs it.
// A THRESHOLD IS NOT REBASED, so k does not cancel there.
//
// Measured on the same member observed both ways — a window drawn entirely
// before they joined against one drawn entirely after, paired within member:
//
//   line   paired mean diff (member - prospect)   aggregate ratio   placebo
//   WC        -0.1388   (t -4.65)                    0.916          +0.042 (t 1.59)
//   GL        -0.1540   (t -4.44)                    0.929          -0.023 (t -0.72)
//
// The placebo runs the identical estimator on members who were NEVER enrolled,
// early windows against late, so it carries the time gap and not the basis
// change. It reads null on both lines, so the -0.14 is the basis.
//
// ⚠ THE SAME MEMBER READS ABOUT 0.92x ENROLLED WHAT THEY READ AS AN APPLICANT.
// So a renewal bar of 2.50 is roughly a 2.72 bar on the applicant scale, and
// the factor MOVES with the book because k does. Nothing here is wrong — an
// applicant's loss run is their own and must not carry the pool's mix
// correction — but the two ladders are not on one scale and cannot be made so
// by picking a reading. Closing it means dividing the member's ratio by k_line,
// which changes every renewal decision, and that is a design ruling rather than
// a basis choice.
//
// ⚠ AND THE CROSS-SECTIONAL FIGURE GETS THE SIGN WRONG. Comparing enrolled
// members against available applicants in the same year reads members HIGHER —
// 0.981 against 0.912 on WC — which is the composition of the two groups, not
// the basis, and it points the opposite way to the paired estimate above.
// newBusinessAppetite.ts records that cross-section (0.918 against 0.958); it
// is a true statement about who those people are and it is not a measurement of
// the basis gap. Marked at that constant.
//
// ============================================================================
// WHERE IT SITS, AND WHY BESIDE simulateMemberMovement RATHER THAN INSIDE IT.
//
// Movement decides how many members LEAVE (calcRetentionProbability) and
// which (departureRisks). A decline is not a departure: it is the pool's
// decision, not the member's, and it must not consume the withdrawal budget.
// Run through that budget, declining a member would SAVE a member who would
// otherwise have left, and a strict renewal policy would show up as improved
// retention. So declines run after movement returns, on the book it produced.
//
// ⚠ AND EACH DECLINE WRITES closeInterval, OR IT MEANS NOTHING. Recruitment
// eligibility reads membershipHistory, not Member.status
// (see membershipHistory.ts). A declined member who is not written to the
// ledger is eligible to be recruited straight back the following year — the
// pool would decline them in year 5 and re-accept them in year 6, having paid
// nothing for the decision. The two-year cooldown is what makes a decline a
// decision.
//
// ============================================================================
// ⚠ THE MODIFIER IS EVALUATED TWICE, AND THE OBVIOUS IMPLEMENTATION EVALUATES
// IT ONCE.
//
// The decision reads the mod on the PRE-DECLINE book — that is the only book
// that exists when the decision is made, and it is the one the player saw
// when they set the threshold. Pricing then reads it again on the
// POST-DECLINE book, because the rebase divisor M is computed over whoever is
// actually enrolled and the surviving members' mods have to sum back to the
// allocation.
//
// Evaluate once and the difference is INVISIBLE until someone declines a lot
// of members: with two or three declines out of sixty, M barely moves and
// both readings agree to three decimals. Decline fifteen and the pre-decline
// mods are wrong for pricing by several points, in the direction that
// under-charges the survivors. The failure appears only at the setting a
// player reaches when the mechanism is working hardest.
//
// ============================================================================
// ⚠ THE RATCHET, WHICH IS THE REAL RISK AND IS NOT THE LOOP THAT WAS WATCHED
// FOR.
//
// The loop flagged twice in planning was: decline high-mod members -> the
// enrolled mix improves -> k_line moves -> expected moves -> next year's mods
// move. THAT LOOP DOES NOT EXIST. k appears in both legs of the ratio
// deliberately (see memberLossHistory.ts), so Ap and Ep scale together and
// the modifier is k-invariant.
//
// The real loop is the REBASE DIVISOR. mod = 1 + Z(c/M - 1) and M is the mean
// clamped ratio over the current book. Decline the worst members and M falls,
// so every survivor's c/M rises, so every survivor's mod rises, so more of
// them sit above the threshold next year. Tighter than the loop that was
// being watched for, and through a completely different term.
//
// renewal-stability-check measures whether it runs away, with four controls.
//
// ⚠ A SHARE CANNOT RATCHET IN COUNT, WHICH IS ONE THING THE SLIDER BUYS. The
// count each year is round(share x book) by construction, so the loop above can
// no longer push MORE members over a fixed bar — there is no bar. What it can
// still do is move WHICH members are the worst, and the gate now asserts the
// count is exactly the share and that cut 0 is identical to renewal off.
// ============================================================================

import { closeInterval } from './membershipHistory';
import { memberExperienceMods } from './memberExperienceMod';
import type {
  CoverageLine, Member, MemberLossHistory, MembershipHistory,
} from '../types/simulation';

/**
 * THE RENEWAL SLIDER: THE SHARE OF THE BOOK NOT RENEWED EACH YEAR, WORST FIRST.
 *
 * ⚠ A SHARE, NOT A THRESHOLD, AND THAT IS THE DESIGN RULING THIS REPLACES THE
 * TWO TILES WITH. Zero keeps every member. Rising, the pool non-renews the worst
 * X% of its book on the member's own multi-year loss ratio — the RAW Ap/Ep over
 * EXPERIENCE_MOD.windowYears, the Loss Ratio column on Membership, the same
 * window the experience modifier reads. Ranked, so "the worst 5%" means the
 * same thing in a good year and a bad one; a threshold's count moved with the
 * book and with luck, which is why the old table carried a "the screen count is
 * higher than a held level produces" warning that a share does not need.
 *
 * STEPS 0 / 1 / 2 / 3 / 4 / 5%, NARROWED FROM 0 / 2.5 / 5 / 7.5 / 10%. One-percent
 * steps are the risk-control dials' step, so a player learns one step size across
 * the Decisions page; and the old top step read more like a mistake than a
 * decision — at 10% with no intake the WC book fell from 66 to 22 in ten years.
 *
 * A threshold SETTLES because the worst members go and fewer clear the bar; a
 * share DOES NOT — the worst 5% of any book is always 5% of it. Against the
 * levels the slider replaced (renewal-threshold-derive, mean book ~90): 2.50
 * settled near 1.2% of the book once held and 2.00 near 2.6%, so 1-3% spans the
 * old controls and 5% is about twice the old strict level held.
 *
 * MEASURED, 16 games x 10 years, year 10, normaliser out of the draw, WC (GL
 * alike); cost = the book's expected loss against an all-neutral book:
 *
 *              no intake                              intake at bar 5 (level 3)
 *   cut    book   cost   rate/$100  surplus      book   cost   rate/$100  surplus
 *    0%    65.8   1.017    4.956    $146.6M      90.9   1.013    4.708    $178.9M
 *    1%    56.9   1.006    4.997    $144.6M      82.0   1.008    4.740    $178.6M
 *    3%    48.0   0.982    5.071    $140.1M      71.0   0.987    4.805    $169.2M
 *    5%    39.5   0.947    5.183    $133.1M      59.6   0.960    4.832    $163.1M
 *   (10%   22.4   0.874    5.628    $116.2M      38.6   0.904    5.159    $142.7M — the old top)
 *
 * THE RATE RISES FROM THE FIRST STEP on a closed book: each step trades book for
 * a smaller fall in expected cost, and a smaller book loses the tower's size
 * discount faster than its composition gains. At 5% the book is down 40% for a
 * 7% fall in cost and a 4.6% RISE in the rate — still plainly "it shrinks the
 * book, it does not clean it", without gutting the pool.
 *
 * ⚠ 1% IS ONE MEMBER A YEAR, AND ZERO ON A BOOK UNDER 50. The count is
 * round(cut x book), so on the books this game makes the 1% step names one
 * member a year (0.89 on WC with no intake) and rounds to nobody once the book
 * falls below 50 — which is why 1% and 2% read alike on a book of ~55. Stated
 * so a player who sees "0 not renewed" at 1% is reading the arithmetic, not a
 * fault.
 *
 * ⚠ WHAT IT TEACHES, WHICH IS WHY IT SHIPS. A member's loss ratio barely
 * persists: the modifier's measured credibility is Z = 0.155 (WC) and 0.076
 * (GL), and true risk quality ranks the loss run at 0.33. So the worst 5% by
 * last three years are mostly members who had a bad three years, and next
 * year's book is not much better — the slider SHRINKS the book far more than it
 * CLEANS it. That is a true lesson about pools, and it is the one this control
 * exists to let a player discover.
 *
 * Property is inert by construction: its credibility measured 0.000, no Property
 * member is ever rated, and ranking members on a ratio the Membership page shows
 * blank would be selecting on a number the player cannot see.
 */
export const RENEWAL_CUT_STEPS = [0, 0.01, 0.02, 0.03, 0.04, 0.05] as const;

/** Share of the book non-renewed this year, worst first. 0 renews everyone. */
export type RenewalCut = number;

export interface RenewalDecision {
  memberId: string;
  /** What the member actually cost, Ap/Ep, UNCLAMPED — and what the ranking
   *  was taken on. See THE BASIS in the header. */
  rawRatio: number;
  /** The same quantity under Mahler's rule 3. RECORDED, NOT RANKED: it is what
   *  the member's BILL is computed from, so a reader reconciling a decline
   *  against a premium needs both. Nothing compares it. */
  clampedRatio: number;
}

/**
 * Which members this cut would non-renew, on the book as it stands.
 *
 * PURE, and shared by the engine and the UI — the DecisionsPage renders the
 * count from this same function, so the number the player is shown is the
 * number they get rather than a second estimate of it.
 *
 * THE COUNT is round(cut x book), the book being every active member on the
 * line, rated or not — "the worst X% of the book". THE CANDIDATES are the RATED
 * members only: a member with fewer than EXPERIENCE_MOD.minYears of history has
 * no loss run to rank, and an unrated member is never non-renewed (the guard is
 * `rated`, for the reason the threshold version recorded — a filler is not a
 * measurement). If fewer members are rated than the count asks for, every rated
 * member is non-renewed and no more.
 *
 * ⚠ RANKED ON THE RAW RATIO, NOT THE CLAMPED ONE. The clamp ties every member
 * above 3.0 at 3.0, so a clamped ranking would choose among the very worst
 * arbitrarily. Ties on the raw ratio break on memberId so the choice is a pure
 * function of the book.
 */
export function renewalDeclines(
  members: readonly Member[],
  line: CoverageLine,
  history: MemberLossHistory,
  yearNumber: number,
  cut: RenewalCut,
): RenewalDecision[] {
  if (!(cut > 0)) return [];
  const count = Math.round(cut * members.length);
  if (count <= 0) return [];
  const rated: RenewalDecision[] = [];
  for (const m of memberExperienceMods(members, line, history, yearNumber)) {
    if (!m.rated || m.rawRatio === null) continue;
    rated.push({ memberId: m.memberId, rawRatio: m.rawRatio, clampedRatio: m.clampedRatio });
  }
  rated.sort((a, b) => (b.rawRatio - a.rawRatio) || (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0));
  return rated.slice(0, count);
}

/**
 * Apply the declines: remove them from the book and CLOSE THEIR INTERVAL.
 *
 * Mutates `membershipHistory`, which is the working clone processYear already
 * maintains — the same object openInterval and closeInterval are called on
 * for joins and withdrawals.
 */
export function applyRenewalDeclines(
  activeMembers: readonly Member[],
  line: CoverageLine,
  yearNumber: number,
  declines: readonly RenewalDecision[],
  membershipHistory: MembershipHistory,
): { retained: Member[]; declined: Member[] } {
  if (declines.length === 0) return { retained: [...activeMembers], declined: [] };
  const ids = new Set(declines.map(d => d.memberId));
  const retained: Member[] = [];
  const declined: Member[] = [];
  for (const m of activeMembers) {
    if (ids.has(m.id)) {
      declined.push({ ...m, status: 'withdrawn' as const, yearWithdrawn: yearNumber });
      // ⚠ lastActiveYear is yearNumber - 1: the decline takes effect at THIS
      // renewal, so the member's last covered year is the one just ended.
      // Same convention as a withdrawal, and it is what starts the two-year
      // cooldown from the right year.
      closeInterval(membershipHistory, m.id, line, yearNumber - 1);
    } else {
      retained.push(m);
    }
  }
  return { retained, declined };
}
