// ============================================================================
// THE STANDINGS TABLE — the host's Teams tab and a team's Market Survey tab
// (wip/market-survey) render this one component, so the two cannot drift: the
// same columns, labels, year, line view and results rule. See the note at the
// head of HostTeamsTab for what each column is and the three states a row
// takes. The host passes its TeamViews and the room's shares; a team passes
// RoomView.standings, the same figures slimmed to the table's (session/
// standings) — StandingTeam is the shape both are read through.
// ============================================================================

import { useState } from 'react';
import { POOL_SHARE_NOTE, rateText, reportingYearOf, rowState, shareOf } from '../standingsRows';
import { ordinal, rippleScoreRanks } from '../../utils/rippleScore';
import { Layers, HardHat, Scale, Building2 } from 'lucide-react';
import TabNav from '../../components/TabNav';
import { LINE_FULL_NAME } from '../../utils/lineDisplay';
import { colorForCombinedRatio, colorForSurplus, formatCurrency, formatPct } from '../../utils/formatters';
import type { CoverageLine, LineView } from '../../types/simulation';
import type { RoomMarketShares, StandingTeam } from '../index';

const LINE_ORDER: CoverageLine[] = ['WC', 'GL', 'Property'];

const LINE_VIEW_ICONS: Record<LineView, React.ReactNode> = {
  pool: <Layers size={14} />,
  WC: <HardHat size={14} />,
  GL: <Scale size={14} />,
  Property: <Building2 size={14} />,
};

export interface StandingsTableProps {
  teams: readonly StandingTeam[];
  marketShares?: RoomMarketShares;
  startingYear: number;
  currentYear: number;
  yearCount: number;
  /** The viewing team's own row, highlighted (data-own) — a team's Market Survey; none for the host. */
  ownTeam?: string;
  /** A last column — the host's hand-off button; none on a team's screen. */
  actionHead?: string;
  renderAction?: (teamName: string) => React.ReactNode;
}

export default function StandingsTable({
  teams, marketShares, startingYear, currentYear, yearCount, ownTeam, actionHead, renderAction,
}: StandingsTableProps) {
  const [view, setView] = useState<LineView>('pool');

  // Only the lines SOMEBODY writes are worth offering: a room where nobody took
  // Property has no Property column to compare.
  const linesInPlay = LINE_ORDER.filter(l => teams.some(t => t.lines.includes(l)));
  const effectiveView: LineView = view !== 'pool' && !linesInPlay.includes(view) ? 'pool' : view;

  // The latest known year (utils/knownYears): the year just completed — the
  // opening before the first advance, then each year as it is played.
  const reportingYear = reportingYearOf(currentYear, yearCount);

  // ⚠ THE RIPPLE SCORE IS A PLACEHOLDER (utils/rippleScore): each team's rank by
  // the pool's net surplus for the year shown, ties sharing a rank — the pool's
  // rank on every line view. From the standings already posted; nothing else.
  const rippleRanks = rippleScoreRanks(Object.fromEntries(teams.map(t =>
    [t.name, reportingYear < 0 ? undefined : t.resultsByYear?.[String(reportingYear)]?.pool?.endingSurplus])));

  if (teams.length === 0) {
    return (
      <p data-testid="teams-empty" className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-black">
        No teams have joined yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* The same line-view bar the game uses, from the same component. */}
      <TabNav<LineView>
        tabs={[
          { id: 'pool' as LineView, label: 'Pool', icon: LINE_VIEW_ICONS.pool },
          ...linesInPlay.map(l => ({ id: l as LineView, label: LINE_FULL_NAME[l], icon: LINE_VIEW_ICONS[l] })),
        ]}
        activeTab={effectiveView}
        onSelect={setView}
        stickyTop="var(--content-top, 0px)"
        zIndex={10}
      />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="text-sm font-medium text-slate-700">
            {effectiveView === 'pool' ? 'Pool' : LINE_FULL_NAME[effectiveView]}
          </p>
          <p data-testid="teams-year" className="text-xs text-black">
            {reportingYear < 0 ? 'No results known yet' : `Results for ${startingYear + reportingYear - 1}`}
          </p>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-black">
              <th data-testid="teams-number-head" className="px-5 py-2 font-medium">Team number</th>
              <th className="px-5 py-2 font-medium">Team</th>
              <th className="px-5 py-2 font-medium">Ripple Ranking</th>
              <th className="px-5 py-2 font-medium">Premium to surplus</th>
              <th className="px-5 py-2 font-medium" title="Per $100 of exposure, with this year's change">Rate</th>
              <th className="px-5 py-2 font-medium" title="This year's admin expense, as a share of premium">Admin expense</th>
              <th data-testid="teams-cr-head" className="px-5 py-2 font-medium" title="The year's own, as on the team's Annual Statement and top bar">
                {reportingYear < 0 ? 'Combined ratio' : `Combined ratio ${startingYear + reportingYear - 1}`}
              </th>
              <th className="px-5 py-2 font-medium" title="Surplus at the year's end">Net surplus</th>
              <th className="px-5 py-2 font-medium" title="Share of the room: exposure on a line; on the pool, the average of the team's line shares">Market share</th>
              {renderAction && <th className="px-5 py-2 text-right font-medium">{actionHead}</th>}
            </tr>
          </thead>
          <tbody data-testid="teams-table">
            {teams.map(t => {
              const state = rowState(t, effectiveView, reportingYear);
              return (
                <tr key={t.name} data-testid={`row-${t.name}`} data-own={t.name === ownTeam ? 'true' : undefined}
                  className={`border-t border-slate-50 ${t.name === ownTeam ? 'bg-blue-50 font-semibold' : ''}`}>
                  {/* ⚠ THE NAME ALONE. The team's lines used to follow it in a second
                      span with no space between them in the text, so a team named
                      "T" read "TWC+GL+Property"; the line view shows the lines. */}
                  {/* The team's number in the room (contract teamNumbers), before its name. */}
                  <td data-testid={`number-${t.name}`} className="whitespace-nowrap px-5 py-2.5 text-black">Team {t.teamNumber}</td>
                  <td data-testid={`name-${t.name}`} className="px-5 py-2.5 text-slate-700">{t.name}</td>
                  {state.kind === 'absent' && (
                    // ⚠ ONE CELL, IN WORDS. Nothing here can be read as a
                    // number, which is the requirement.
                    <td colSpan={6} data-testid={`absent-${t.name}`} className="px-5 py-2.5 text-xs italic text-black">
                      does not write {effectiveView === 'pool' ? '' : effectiveView}
                    </td>
                  )}

                  {state.kind === 'pending' && (
                    <td colSpan={6} data-testid={`pending-${t.name}`} className="px-5 py-2.5 text-xs text-amber-600">
                      {reportingYear < 0 ? 'no results known yet' : `${startingYear + reportingYear - 1} not reported yet`}
                    </td>
                  )}

                  {state.kind === 'reported' && (
                    <>
                      {/* The placeholder Ripple Ranking: the rank alone, an ordinal, no figure beside it. */}
                      <td data-testid={`ripple-${t.name}`} data-rank={rippleRanks[t.name]} className="px-5 py-2.5 font-mono text-slate-700">
                        {rippleRanks[t.name] !== undefined ? ordinal(rippleRanks[t.name]) : <span className="text-black">—</span>}
                      </td>
                      <td data-testid={`pts-${t.name}`} className="px-5 py-2.5 font-mono text-slate-700">
                        {state.figures.premiumToSurplus !== undefined ? state.figures.premiumToSurplus.toFixed(2) : <span className="text-black">—</span>}
                      </td>
                      <td data-testid={`rate-${t.name}`} className="px-5 py-2.5 font-mono text-slate-700">
                        {effectiveView !== 'pool'
                          ? (rateText(state.figures) ?? <span className="text-black">—</span>)
                          // THE POOL: each line's rate, since the lines' units differ.
                          : t.lines.length === 0 ? <span className="text-black">—</span>
                          : t.lines.map(l => (
                            <span key={l} className="block whitespace-nowrap text-xs">
                              {l} {rateText(state.pool?.[l]) ?? <span className="text-black">—</span>}
                            </span>
                          ))}
                      </td>
                      <td data-testid={`admin-${t.name}`} className="px-5 py-2.5 font-mono text-slate-700">
                        {state.figures.adminExpenseRatio !== undefined ? formatPct(state.figures.adminExpenseRatio) : <span className="text-black">—</span>}
                      </td>
                      <td data-testid={`cr-${t.name}`}
                        className={`px-5 py-2.5 font-mono ${state.figures.yearCombinedRatio !== undefined ? colorForCombinedRatio(state.figures.yearCombinedRatio) : 'text-black'}`}>
                        {state.figures.yearCombinedRatio !== undefined ? formatPct(state.figures.yearCombinedRatio) : '—'}
                      </td>
                      <td data-testid={`surplus-${t.name}`} data-value={state.figures.endingSurplus} className={`px-5 py-2.5 font-mono ${colorForSurplus(state.figures.endingSurplus)}`}>
                        {formatCurrency(state.figures.endingSurplus, true)}
                      </td>
                    </>
                  )}

                  {/* THE ROOM'S SET FOR THE LATEST KNOWN YEAR — the row's own year
                      (shownShares). Worked out once a year, when the last team
                      that locked in has posted; while a locked team has not, the
                      newest complete year before it. On a line, the team's
                      exposure over the room's on the line; on the pool, the
                      simple average of its line shares, over the room's lines
                      (marketShares.poolShareOf). */}
                  <td data-testid={`share-${t.name}`} className="px-5 py-2.5 font-mono text-sky-700">
                    {(() => {
                      const share = shareOf(marketShares, t.name, effectiveView);
                      if (!share) return <span className="text-black">—</span>;
                      // The heading names the results' year; a share worked out for an
                      // earlier one (a locked team not yet posted) says which.
                      return share.year === reportingYear ? formatPct(share.value)
                        : <>{formatPct(share.value)} <span className="text-[10px] text-black">({startingYear + share.year - 1})</span></>;
                    })()}
                  </td>
                  {renderAction && <td className="px-5 py-2.5 text-right">{renderAction(t.name)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-black">
          {effectiveView === 'pool'
            ? 'Pooled figures. Teams writing different lines are not directly comparable here — pick a line above.'
            : `Every figure is ${effectiveView}, so the column compares like with like.`}
          {effectiveView === 'pool' ? <>{' '}{POOL_SHARE_NOTE}</> : null}
          {' '}Ripple Ranking is for now each team&rsquo;s rank by the pool&rsquo;s net surplus; the full ranking is still being designed.
        </p>
      </div>

    </div>
  );
}
