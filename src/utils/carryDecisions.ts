// ============================================================================
// A SINGLE-PLAYER YEAR STARTS FROM THE YEAR BEFORE'S DECISIONS.
//
// Single player and Test player carry every decision into the next year, as a
// hosted team does (session/client/decisions.ts): funding, the underwriting
// sliders, the reinsurance cover, the aggregate cover, the asset mix, risk
// control, dividends and assessments, loan repayment. Only the first year
// opens on defaultDecisionSet. A player who set a standing policy has not
// changed their mind by turning the page; resetting it would undo a choice
// somebody made on purpose and then attribute the consequences to them.
//
// ⚠ CARRIED FROM THE SET THE YEAR WAS PLAYED ON (SettledYear.played.decisions),
// NEVER FROM THE LIVE EDITING BUFFER. The year is locked on that set; reading
// the buffer instead would carry whatever was half-edited when the year
// committed.
//
// ⚠ RE-STAMPED WITH THE NEXT YEAR'S NUMBER, as decisionsForYear does: the
// engine reads DecisionSet.yearNumber, and another year's number would be a
// quietly wrong input rather than a loud one.
//
// ⚠ A DEEP COPY. The played set is kept in GameState.playedYears for the save's
// replay; the editing buffer must not share an object with it.
// ============================================================================
import type { DecisionSet } from '../types/simulation';

export function carryDecisions(
  played: DecisionSet,
  nextYearNumber: number,
  /**
   * The risk-control programs that ran this year — the pool row's own echo
   * (ResultSet.pool.riskControlProgramIds), which is what carried before every
   * other decision did. Absent falls back to the played set's own list.
   */
  programIds?: readonly string[],
): DecisionSet {
  const d = JSON.parse(JSON.stringify(played)) as DecisionSet;
  return {
    ...d,
    yearNumber: nextYearNumber,
    riskControlProgramIds: [...(programIds ?? played.riskControlProgramIds ?? [])],
  };
}
