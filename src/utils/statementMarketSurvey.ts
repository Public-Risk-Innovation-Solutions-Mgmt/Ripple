// ============================================================================
// THE ANNUAL STATEMENT'S MARKET SURVEY SECTION — just before Decisions: the
// Market Survey tab's table (session/screens/StandingsTable) for the
// statement's year, on the statement's view — a line's standings on a line's
// statement, the pool's on the Pool's.
//
// ⚠ HOSTED TEAMS AND VIEWERS READ THE ROOM'S OWN STANDINGS AND NOTHING ELSE —
// RoomView.standings, the same figures the Market Survey tab shows (session/
// standings: the host's Teams-table fields alone, for the room's latest known
// year), with the viewing team's row marked. Nothing extra about other teams
// is fetched or derived: the room keeps one year of standings for a team, so
// a statement turned back to an earlier year says the room's standings are
// for its latest year rather than inventing another's.
//
// ⚠ SINGLE PLAYER AND TEST PLAYER HAVE NO ROOM: one row, the player's own pool,
// built from its own game by the SAME summary a hosted team posts (session/
// client/results.summarize) and slimmed by the same standings rule — so its
// figures are the ones its Market Survey row would show in a room. No market
// share: single player shows none anywhere.
//
// ONE BUILDER, THREE READERS, as the Decisions section: the page
// (ResultsStatementPage), the Excel file (annualStatementExport) and the PDF
// (annualStatementPdf) lay out these rows. Its text is the tab's text, written
// once (session/standingsRows), so the section cannot drift from the tab.
// ============================================================================

import { buildStandings } from '../session/standings';
import { rateLines, reportingYearOf, rowState, shareOf, shareText } from '../session/standingsRows';
import { summarize } from '../session/client/results';
import { gameHistory } from './gameHistory';
import { lineDisplayName } from './lineDisplay';
import { ordinal, rippleScoreRanks } from './rippleScore';
import { formatCurrency, formatPct } from './formatters';
import type { RoomMarketShares, StandingTeam } from '../session/contract';
import type { GameState } from '../types/simulation';
import type { TemplateStatement } from './annualStatementTemplate';

export const MARKET_SURVEY_TITLE = 'Market Survey';

/** A hosted game's standings, as the Market Survey tab is handed them (RoomView.standings and the room's years). */
export interface MarketSurveyStandings {
  teams: readonly StandingTeam[];
  marketShares?: RoomMarketShares;
  startingYear: number;
  currentYear: number;
  yearCount: number;
  /** The viewing team — a player's own, or the team a viewer watches — its row marked. */
  ownTeam?: string;
}

/** A row's seven figure cells, as the tab writes them. Rate is one line per line on the pool. */
export interface MarketSurveyFigures {
  ripple: string;
  premiumToSurplus: string;
  rate: string[];
  admin: string;
  combinedRatio: string;
  netSurplus: string;
}

export interface MarketSurveyRow {
  /** "Team 3"; "—" for the one pool of single player and Test player. */
  teamNumber: string;
  team: string;
  own: boolean;
  /** The figures, or the tab's words for a team that does not write the line or has not reported. */
  figures: MarketSurveyFigures | { absent: string } | { pending: string };
  marketShare: string;
  /** The net surplus, for its sign (red when negative); absent with no figures. */
  surplus?: number;
}

export interface MarketSurveyTable {
  /** "Pool", or the line's name. */
  scopeName: string;
  /** The tab's "Results for 2028", or "No results known yet". */
  yearText: string;
  /** The nine column heads, the tab's own. */
  heads: string[];
  rows: MarketSurveyRow[];
  /** Said in place of the rows when the room's standings are for another year than the statement's. */
  note?: string;
  /** The tab's note under the table. */
  footnote: string;
}

const absentText = (view: string) => `does not write ${view === 'pool' ? '' : view}`;

/** The section for a statement: its view and year (ts.scope, ts.asOf), from the room's standings or, with none, the player's own pool. */
export function buildMarketSurveyTable(gs: GameState, ts: TemplateStatement, standings?: MarketSurveyStandings): MarketSurveyTable {
  const view = ts.scope;
  const startingYear = standings?.startingYear ?? gs.setup.startingYear;
  let teams: readonly StandingTeam[];
  let reportingYear: number;
  let note: string | undefined;
  if (standings) {
    reportingYear = reportingYearOf(standings.currentYear, standings.yearCount);
    teams = standings.teams;
    if (reportingYear !== ts.asOf) {
      note = reportingYear < 0
        ? 'The room has no results known yet.'
        : `The room's standings are for its latest year, ${startingYear + reportingYear - 1}. Choose that year to see them here, or open the Market Survey tab.`;
    }
  } else {
    // The player's own pool, for the statement's year, as a hosted team would post it.
    reportingYear = ts.asOf;
    const r = gameHistory(gs).find(y => y.yearNumber === ts.asOf);
    teams = buildStandings([{
      name: gs.setup.poolName, teamNumber: 0, lines: [...gs.setup.activeLines],
      ...(r && ts.asOf >= 0 ? { results: { [String(ts.asOf)]: summarize(r, gs) } } : {}),
    }], ts.asOf + 1).teams;
  }
  const calendar = startingYear + reportingYear - 1;
  const shares = standings?.marketShares;
  const ranks = rippleScoreRanks(Object.fromEntries(teams.map(t =>
    [t.name, reportingYear < 0 ? undefined : t.resultsByYear?.[String(reportingYear)]?.pool?.endingSurplus])));
  const rows: MarketSurveyRow[] = note ? [] : teams.map(t => {
    const state = rowState(t, view, reportingYear);
    const base = {
      teamNumber: standings ? `Team ${t.teamNumber}` : '—',
      team: t.name,
      own: !!standings?.ownTeam && t.name === standings.ownTeam,
      marketShare: shareText(shareOf(shares, t.name, view), reportingYear, startingYear),
    };
    if (state.kind === 'absent') return { ...base, figures: { absent: absentText(view) } };
    if (state.kind === 'pending') {
      return { ...base, figures: { pending: reportingYear < 0 ? 'no results known yet' : `${calendar} not reported yet` } };
    }
    const f = state.figures;
    return {
      ...base,
      surplus: f.endingSurplus,
      figures: {
        ripple: ranks[t.name] !== undefined ? ordinal(ranks[t.name]) : '—',
        premiumToSurplus: f.premiumToSurplus !== undefined ? f.premiumToSurplus.toFixed(2) : '—',
        rate: rateLines(state, view, t.lines),
        admin: f.adminExpenseRatio !== undefined ? formatPct(f.adminExpenseRatio) : '—',
        combinedRatio: f.yearCombinedRatio !== undefined ? formatPct(f.yearCombinedRatio) : '—',
        netSurplus: formatCurrency(f.endingSurplus, true),
      },
    };
  });
  return {
    scopeName: view === 'pool' ? 'Pool' : lineDisplayName(view),
    yearText: reportingYear < 0 ? 'No results known yet' : `Results for ${calendar}`,
    heads: ['Team number', 'Team', 'Ripple Ranking', 'Premium to surplus', 'Rate', 'Admin expense',
      reportingYear < 0 ? 'Combined ratio' : `Combined ratio ${calendar}`, 'Net surplus', 'Market share'],
    rows,
    ...(note ? { note } : {}),
    footnote: (view === 'pool'
      ? 'Pooled figures. Teams writing different lines are not directly comparable here — pick a line above.'
      : `Every figure is ${view}, so the column compares like with like.`)
      + ' Ripple Ranking is for now each team’s rank by the pool’s net surplus; the full ranking is still being designed.',
  };
}

/** A row's nine cells as text, in the heads' order — the downloads' reading; the rate's lines joined. */
export function marketSurveyCells(row: MarketSurveyRow, joinRate = '\n'): string[] {
  const f = row.figures;
  const figures = 'absent' in f ? [f.absent, '', '', '', '', '']
    : 'pending' in f ? [f.pending, '', '', '', '', '']
    : [f.ripple, f.premiumToSurplus, f.rate.join(joinRate), f.admin, f.combinedRatio, f.netSurplus];
  return [row.teamNumber, row.team, ...figures, row.marketShare];
}
