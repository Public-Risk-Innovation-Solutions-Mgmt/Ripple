// ============================================================================
// THE STANDINGS' ROWS, AS FIGURES AND TEXT — the one place the host's Teams
// table, a team's Market Survey tab (session/screens/StandingsTable) and the
// Annual Statement's Market Survey section (utils/statementMarketSurvey) read a
// team's row from. Pure: no React, so the statement's Excel and PDF downloads
// read the very same rule and the very same text as the screens.
//
// Moved here from StandingsTable unchanged (pr/statement-market-survey), so the
// table and the statement section cannot drift: the year shown, a row's state,
// the rate's text and the market share's are each written once.
// ============================================================================

import { latestKnownRoomYear } from '../utils/knownYears';
import { formatPct } from '../utils/formatters';
import type { CoverageLine, LineView } from '../types/simulation';
import type { RoomMarketShares, StandingFigures, StandingSummary, StandingTeam } from './contract';

export type RowState =
  | { kind: 'absent' }
  | { kind: 'pending' }
  | { kind: 'reported'; figures: StandingFigures; pool?: StandingSummary['byLine'] };

/**
 * THE YEAR THE TABLE SHOWS — the latest known year (utils/knownYears): the year
 * just completed — the opening before the first advance, then each year as it
 * is played.
 */
export const reportingYearOf = (currentYear: number, yearCount: number): number =>
  Math.min(latestKnownRoomYear({ currentYear, yearCount }), currentYear - 1);

/**
 * ⚠ THE WHOLE POINT OF THIS FUNCTION IS THE ORDER OF ITS CHECKS. Absence is
 * decided BEFORE lateness: a team that does not write GL is not "late on GL",
 * and never will be, so asking whether it has reported would be asking the wrong
 * question of it forever.
 */
export function rowState(team: StandingTeam, view: LineView, reportingYear: number): RowState {
  if (view !== 'pool' && !team.lines.includes(view)) return { kind: 'absent' };

  // ⚠ YEAR 0 COUNTS, AND FROM THE START. Results show through the year just
  // completed (utils/knownYears), so before the first advance the latest known
  // year is 2026, the opening — the table shows it rather than nothing. A year
  // before 0 is never known (no room keeps one).
  if (reportingYear < 0) return { kind: 'pending' };

  // ⚠ THE EXACT YEAR, NOT "THE LATEST ONE, IF IT HAPPENS TO BE THIS YEAR". The
  // room keeps every year now, so this asks for the year the table is showing
  // and gets it or nothing. The old form could only ever answer for the newest
  // year, which was the same question only while the record held one slot.
  const posted = team.resultsByYear?.[String(reportingYear)];
  if (!posted) return { kind: 'pending' };

  const figures = view === 'pool' ? posted.pool : posted.byLine[view];
  // A team that writes the line but whose posted summary has no slice for it is
  // pending rather than absent — the summary predates the line, not the team.
  if (!figures) return { kind: 'pending' };
  // The pool's rate cell lists each line's, so the pool row carries the lines' figures.
  return { kind: 'reported', figures, pool: view === 'pool' ? posted.byLine : undefined };
}

/** "$3.20 (+2.1%)": a line's rate per $100 and its change on the year before. */
export function rateText(f: StandingFigures | undefined): string | undefined {
  if (f?.ratePer100 === undefined) return undefined;
  const change = f.rateChange === undefined ? ''
    : ` (${f.rateChange >= 0 ? '+' : '−'}${Math.abs(f.rateChange * 100).toFixed(1)}%)`;
  return `$${f.ratePer100.toFixed(2)}${change}`;
}

/**
 * A row's rate cell, as lines of text: a line view's own rate, or on the pool
 * each line's ("WC $3.20 (+2.1%)"), since the lines' units differ. "—" for none.
 */
export function rateLines(state: Extract<RowState, { kind: 'reported' }>, view: LineView, lines: readonly CoverageLine[]): string[] {
  if (view !== 'pool') return [rateText(state.figures) ?? '—'];
  if (lines.length === 0) return ['—'];
  return lines.map(l => `${l} ${rateText(state.pool?.[l]) ?? '—'}`);
}

/**
 * THE ROOM'S MARKET SHARE for a team, on the view: on a line, its exposure over
 * the room's on the line; on the pool, its premium over the room's. With the year
 * it is from — the newest complete year, which the heading's year may run ahead of.
 */
export function shareOf(
  marketShares: RoomMarketShares | undefined, team: string, view: LineView,
): { value: number; year: number } | undefined {
  const share = marketShares?.byTeam[team];
  const v = share === undefined ? undefined : view === 'pool' ? share.pool : share.byLine[view];
  return v === undefined ? undefined : { value: v, year: marketShares!.year };
}

/** The share's text: "31.2%", and its own year in brackets where it is not the heading's ("31.2% (2027)"). */
export function shareText(
  share: { value: number; year: number } | undefined, reportingYear: number, startingYear: number,
): string {
  if (!share) return '—';
  return share.year === reportingYear ? formatPct(share.value) : `${formatPct(share.value)} (${startingYear + share.year - 1})`;
}
