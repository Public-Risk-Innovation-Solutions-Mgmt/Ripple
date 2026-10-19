// ============================================================================
// THE DIVIDEND / ASSESSMENT BASIS — ONE DEFINITION, READ BY THE ENGINE AND THE
// SCREEN.
//
// ⚠ THE BASIS CHANGED FROM POOL PREMIUM TO SURPLUS. Until this file existed,
// simulationEngine computed `poolPremium * dividendPct` and
// `poolPremium * assessmentPct`, so the percentage on the slider was a share of
// PREMIUM. The control now reads as a share of SURPLUS and shows the dollar
// amount beside it, and a figure shown on a screen that is not the figure the
// engine moves is the worst kind of wrong — it is wrong quietly. So the basis
// moved into the engine rather than the dollar figure being approximated on the
// page.
//
// WHICH SURPLUS, AND WHY IT IS THE OPENING ONE. A dividend paid out of the
// year's ENDING surplus is circular: the payment is itself a charge against the
// surplus it is a share of, so the equation has the dividend on both sides. The
// OPENING surplus — `lineState.surplus`, which is the prior year's
// `endingSurplus` carried forward — is known before anything in the year is
// computed, is the number the player is looking at when they move the slider,
// and makes the shown product exact rather than approximate.
//
// ⚠ THE NEGATIVE-SURPLUS CLAMP IS A SIGN GUARD, NOT A ROUNDING. A line can
// carry negative surplus in (it declined an inter-line loan). Multiplied by an
// assessment percentage, a negative basis produces a NEGATIVE assessment — the
// pool would pay members for the privilege of being underfunded, which is the
// exact opposite of what an assessment is for, and it would arrive silently
// because nothing downstream checks the sign. Clamping the basis at zero makes
// such a line charge nothing and pay nothing.
//
//   The dividend side is ALREADY blocked on this condition by
//   `ctx.dividendBlocked`, so the clamp is not what stops a broke line paying a
//   dividend. It is what stops a broke line running an assessment BACKWARDS.
//
// ⚠ AND THE SCREEN APPLIES THE SAME CLAMP, which is the whole reason this is a
// function and not two multiplications. The note under the slider shows
// `basis x pct`; if the page clamped differently from the engine — or did not
// clamp at all — the shown dollars and the paid dollars would diverge exactly
// on the lines where a player most needs them to agree.
//
// ⚠ NOT TUNED FOR, AND RECORDED RATHER THAN FIXED: member satisfaction's CASH
// LIMB (memberSatisfaction.ts term 5, and membershipEngine's retention and
// satisfaction deltas) was tuned against the OLD amounts, when the percentage
// was a share of premium. Those terms read the PERCENTAGE, not the dollars, so
// nothing about them breaks — but the dollar amount a given percentage now
// represents is a different quantity, and a 10% dividend is no longer the
// payment it was when that tuning was done. Re-tuning the limb is a measurement
// commit of its own and is NOT attempted here.
// ============================================================================

/**
 * The dollar base a dividend or assessment percentage is applied to: the line's
 * OPENING surplus, floored at zero. See this file's header for why it is the
 * opening surplus and why the floor exists.
 */
export function dividendAssessmentBasis(openingSurplus: number): number {
  return Math.max(0, openingSurplus);
}
