// ============================================================================
// WHAT A TEAM POSTS BACK — five figures, per scope, and nothing else.
//
// ⚠ THE FULL ResultSet IS FAR TOO LARGE TO POST. It carries every line's
// decisions echoed, the reinsurance layer breakdown, the claim register slices
// and the whole funding derivation — 422 KB for a WC-only team-year, 858 KB
// across three lines, measured. The host's table needs to know who is an outlier
// and roughly how; it does not need the register.
//
// ⚠ AND THE FULL RESULT IS NOT LOST — IT IS JUST NOT SHARED. Every browser holds
// its own complete GameState with every locked ResultSet in it, because every
// browser ran processYear itself. What crosses the wire is the scoreboard.
//
// ⚠ EVERY FIELD IS A RESULT_METRICS KEY. See TeamYearFigures in the contract for
// the field-by-field mapping and for why poolPremium replaced grossPremium.
//
// ⚠ PER LINE AS WELL AS POOLED, BECAUSE TEAMS PLAY DIFFERENT BOOKS. A pooled
// figure blends different things for different teams once each picks its own
// lines, so the host's table is comparable only on a line view — and a line view
// needs the line's own slice. Only the lines the team WRITES get an entry;
// absence is what lets the table say "does not write GL" rather than showing a
// zero somebody could read as a result.
// ============================================================================

import type { CoverageLine, GameState, LineResultSet, ResultSet } from '../../types/simulation';
import { buildAnnualStatement, netUltimatesByProgramYear, newestCombinedRatio, topCombinedRatio } from '../../utils/resultsStatement';
import { gameHistory } from '../../utils/gameHistory';
import type {
  DevelopedUltimates, TeamYearDecisions, TeamYearFigures, TeamYearSummary,
} from '../contract';

/** A LINE's figures. The funding level is that line's own and always present. */
function figuresOf(r: LineResultSet): TeamYearFigures {
  return {
    endingSurplus: r.endingSurplus,
    actualLossRatioPricingBasis: r.actualLossRatioPricingBasis,
    poolPremium: r.poolPremium,
    activeExposure: r.activeExposure,
    selectedFundingConfidenceLevel: r.selectedFundingConfidenceLevel,
    netUltimateLoss: r.netUltimateLoss,
  };
}

/**
 * THE POOL'S figures — and the funding level is present only when there IS one.
 *
 * ⚠ THIS COLUMN USED TO BE THE FIRST ACTIVE LINE'S CONFIDENCE LEVEL, POSTED AS
 * THE TEAM'S. `summarize` called the same `figuresOf` for the pool row as for a
 * line, so a three-line team reporting WC at 60% and GL at 80% posted "60%" and
 * the host's Teams tab printed it under Funding. The reader had no way to tell
 * that from a team that really had chosen 60% everywhere.
 *
 * ⚠ AND IT IS AN HONEST POOL FIGURE WHEN THE LINES AGREE, WHICH IS WHY THIS IS A
 * CONSTRUCTION RATHER THAN A DELETION. A team writing one line, or writing three
 * at the same stop, HAS a pool funding level and it is that number — the common
 * case in play, and blanking it would have thrown away a true figure to avoid a
 * false one. When the lines disagree there is no pool level and the field is
 * ABSENT, which the host renders as a dash. Absent means "these differ, open the
 * team"; it does not mean zero.
 */
function poolFiguresOf(r: ResultSet, lineFigures: TeamYearFigures[]): TeamYearFigures {
  const levels = lineFigures
    .map(f => f.selectedFundingConfidenceLevel)
    .filter((v): v is number => v !== undefined);
  const agreed = levels.length > 0 && levels.every(v => v === levels[0]) ? levels[0] : undefined;
  return {
    endingSurplus: r.endingSurplus,
    actualLossRatioPricingBasis: r.actualLossRatioPricingBasis,
    poolPremium: r.poolPremium,
    activeExposure: r.activeExposure,
    ...(agreed === undefined ? {} : { selectedFundingConfidenceLevel: agreed }),
    netUltimateLoss: r.netUltimateLoss,
  };
}

/**
 * ⚠ THE DEVELOPED COLUMN IS THE TEAM'S OWN ANNUAL STATEMENT: each program
 * year's NET ULTIMATE, loss + LAE, at this valuation — the Net block's
 * Ultimates row, read by the statement's own netUltimatesByProgramYear. So the
 * host's views print, for every year as currently valued, the figure the
 * team's statement prints. It used to be the reserve ledger's net ultimate
 * (actuarialMemo's exhibitRows), which carries no LAE, and so sat about 10%
 * below the statement for the same year.
 *
 * ⚠ THE FROZEN FIGURES BESIDE IT STAY FROZEN. netUltimateLoss is the year as
 * booked at its own close, excl. LAE; earlier posts are never rewritten. Only
 * the newest post's column is current, and the host reads that one.
 *
 * ⚠ ACCIDENT YEARS BELOW 0 ARE DROPPED AFTER the pool sum, not before it: the
 * pre-game years and the seeded cohorts are off the session's axis, but they
 * are real rows of the ledger; they are just not plottable.
 */
/**
 * THE HOST'S TEAMS-TABLE FIGURES (TeamYearFigures' optional six), off the
 * team's own Annual Statement as it stood at year `r` — so a tab catching up
 * several years posts each one as it was, not as it is now. The year's combined
 * ratio (yearCombinedRatio) is the statement's newest column, the team's
 * top-bar figure and the host's; combinedRatio stays the cumulative, shown
 * nowhere now; premium to surplus is its balance sheet's row for the year; the
 * admin expense ratio is
 * the operating section's "% of Premium" under the two admin rows, for the
 * year. A line also carries its rate
 * and the change on the year before.
 */
function statementFiguresOf(gs: GameState, r: ResultSet, scope: 'pool' | CoverageLine): Partial<TeamYearFigures> {
  const st = buildAnnualStatement(gs, scope, r.yearNumber);
  const row = st.sections.find(s => s.key === 'balance')?.rows.find(x => x.label === 'Premium to Surplus');
  // The year shown is the last column before Total.
  const pts = row?.cells[row.cells.length - 2];
  const op = st.sections.find(s => s.key === 'operating')?.rows ?? [];
  const adminRow = op[op.findIndex(x => x.label === 'Additional Admin Expense (risk control)') + 1];
  const admin = adminRow?.label === '% of Premium' ? adminRow.cells[adminRow.cells.length - 2] : undefined;
  const combined = topCombinedRatio(st);
  // The year's own: the statement's newest column, the team's top-bar figure.
  const yearCombined = newestCombinedRatio(st);
  const out: Partial<TeamYearFigures> = {
    ...(combined !== undefined && Number.isFinite(combined) ? { combinedRatio: combined } : {}),
    ...(yearCombined ? { yearCombinedRatio: yearCombined.value } : {}),
    ...(pts?.kind === 'value' ? { premiumToSurplus: pts.v } : {}),
    ...(admin?.kind === 'value' && Number.isFinite(admin.v) ? { adminExpenseRatio: admin.v } : {}),
  };
  if (scope !== 'pool') {
    const rate = r.byLine[scope]?.finalRatePer100;
    const before = gameHistory(gs).find(x => x.yearNumber === r.yearNumber - 1)?.byLine[scope]?.finalRatePer100;
    if (rate !== undefined && Number.isFinite(rate)) {
      out.ratePer100 = rate;
      if (before !== undefined && Number.isFinite(before) && before > 0) out.rateChange = rate / before - 1;
    }
  }
  return out;
}

function developedAt(gs: GameState, lines: CoverageLine[]): {
  pool: DevelopedUltimates;
  byLine: Partial<Record<CoverageLine, DevelopedUltimates>>;
} {
  const onAxis = (m: Map<number, number>): DevelopedUltimates => {
    const out: DevelopedUltimates = {};
    for (const [ay, v] of [...m.entries()].sort((a, b) => a[0] - b[0])) if (ay >= 0) out[String(ay)] = v;
    return out;
  };
  const pool = new Map<number, number>();
  const byLine: Partial<Record<CoverageLine, DevelopedUltimates>> = {};
  for (const line of lines) {
    const m = netUltimatesByProgramYear(gs, line);
    for (const [ay, v] of m) pool.set(ay, (pool.get(ay) ?? 0) + v);
    byLine[line] = onAxis(m);
  }
  return { pool: onAxis(pool), byLine };
}

/**
 * The decisions a played year ran on, projected into the contract's shape.
 *
 * ⚠ READ OFF THE RESULT, NOT PASSED IN ALONGSIDE IT, and that is what makes it
 * impossible to post one year's figures beside another year's choices. Every
 * LineResultSet already ECHOES the LineDecisionSet it was produced from — the
 * field exists because programTenure reads commitments back off played years —
 * so the decisions travel with the result by construction rather than by a
 * caller remembering to pair them.
 *
 * ⚠ YEAR 0 GETS NOTHING. The opening position is posted before anybody has
 * decided anything; its echoed decisions are whatever defaults built the game,
 * and publishing those as "what the team chose" would be inventing choices.
 * Returns undefined, which TeamYearSummary.decisions documents as meaning
 * exactly that.
 */
function decisionsOf(r: ResultSet, lines: CoverageLine[]): TeamYearDecisions | undefined {
  if (r.yearNumber <= 0) return undefined;
  const out: TeamYearDecisions = {};
  for (const line of lines) {
    const slice = r.byLine[line];
    // A line the team does not write has no decisions, exactly as it has no
    // figures. Absent, never zeroed — the host table's two states again.
    if (!slice) continue;
    const d = slice.decisions;
    out[line] = {
      confidenceLevel: d.fundingConfidenceLevel,
      atExpected: d.fundingAtExpected,
      reinsuranceOption: d.reinsuranceOption,
      // The aggregate cover on attritional losses, only when bought: a row
      // without it is the row it always was.
      ...(d.aggregateCover !== undefined && d.aggregateCover !== 'none' ? { aggregateCover: d.aggregateCover } : {}),
      // Absent reads as 0 on the engine side; each is written as 0 here so the
      // host renders 0% rather than an empty cell.
      nonRenewal: d.nonRenewal ?? 0,
      newMembers: d.newMembers ?? 0,
      // The line's Risk Control slider (wip/risk-control) — not the retired
      // pool-wide spend, which is pinned at 0. Absent reads as 0%.
      riskControlPct: d.riskControlIncentivePct ?? 0,
      dividendAmount: d.dividendAmount,
      assessmentAmount: d.assessmentAmount,
      allocation: {
        cashPct: d.assetAllocation.cashPct,
        bondsPct: d.assetAllocation.bondsPct,
        equitiesPct: d.assetAllocation.equitiesPct,
      },
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * ⚠ gs IS THE VALUATION, AND IT IS WHY THIS TAKES A SECOND ARGUMENT: the game as
 * it stands after the year `r` describes. The ResultSet is the year's own news;
 * the statement over gs is what that news did to every earlier program year.
 */
export function summarize(
  r: ResultSet, gs: GameState,
  /** The worlds' ending-surplus spread for this year — see TeamYearSummary.surplusRange. */
  range?: { min: number; median: number; max: number } | null,
): TeamYearSummary {
  const lines = gs.setup.activeLines;
  const byLine: Partial<Record<CoverageLine, TeamYearFigures>> = {};
  for (const line of lines) {
    const slice = r.byLine[line];
    // A line the team does not write has no slice to report. Skipping it rather
    // than writing zeroes is the entire basis of the host table's "absent" state.
    if (slice) byLine[line] = { ...figuresOf(slice), ...statementFiguresOf(gs, r, line) };
  }
  return {
    yearNumber: r.yearNumber,
    calendarYear: r.calendarYear,
    pool: { ...poolFiguresOf(r, Object.values(byLine)), ...statementFiguresOf(gs, r, 'pool') },
    byLine,
    developed: developedAt(gs, lines),
    decisions: decisionsOf(r, lines),
    ...(range ? { surplusRange: { min: range.min, median: range.median, max: range.max } } : {}),
  };
}
