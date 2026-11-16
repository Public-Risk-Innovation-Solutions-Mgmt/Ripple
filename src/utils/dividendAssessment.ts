// ============================================================================
// THE DIVIDEND AND THE ASSESSMENT, IN DOLLARS — ONE RULE, READ BY THE ENGINE,
// THE SLIDER AND THE YEAR WALKTHROUGH.
//
// ⚠ THEY ARE DOLLAR AMOUNTS NOW (wip/dividends-in-dollars), $1M a notch, $0 to
// $15M each way (DIVIDEND_ASSESSMENT_RANGE). They were percentages of the
// opening surplus — and before that of pool premium — which made an assessment
// worth nothing to a pool with no surplus, the one pool that most needs to
// raise money.
//
//   THE ASSESSMENT is charged to the members, in full, whatever the surplus: a
//   pool at zero or below can assess (assessmentCharged).
//
//   THE DIVIDEND is paid out of surplus, so it stays limited to the surplus
//   available, as it was: no more than the line's OPENING surplus (the prior
//   year's ending surplus carried forward — known before anything in the year is
//   computed, so not circular), nothing when that is zero or below, and nothing
//   at all when the line carried a negative surplus in (`blocked`, the engine's
//   dividendBlocked) — dividendPaid.
//
// ⚠ THE SCREEN SHOWS WHAT THESE FUNCTIONS RETURN, so the dollars beside the
// slider are the dollars the engine moves, including the cap on a dividend.
//
// ⚠ NOT TUNED FOR, AND RECORDED: member satisfaction's CASH LIMB
// (memberSatisfaction.ts term 5, and membershipEngine's retention and
// satisfaction deltas) reads a SHARE. It is given the dollars as a share of the
// line's member charge — the premium basis it was tuned on — and acts only at
// member level (MEMBER_LEVEL), off in this build.
// ============================================================================

/**
 * The surplus available for a dividend: the line's OPENING surplus, floored at
 * zero. A dividend is paid out of it and limited to it.
 */
export function dividendAssessmentBasis(openingSurplus: number): number {
  return Math.max(0, openingSurplus);
}

/** The dividend paid: the amount chosen, limited to the surplus available, and none while blocked. */
export function dividendPaid(amount: number, openingSurplus: number, blocked: boolean): number {
  if (blocked) return 0;
  return Math.min(Math.max(0, amount), dividendAssessmentBasis(openingSurplus));
}

/** The assessment charged: the amount chosen, in full, whatever the surplus. */
export function assessmentCharged(amount: number): number {
  return Math.max(0, amount);
}
