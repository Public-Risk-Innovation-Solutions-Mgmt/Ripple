// ============================================================================
// THE MARKET SURVEY — a hosted team's (and a viewer's) view of every team's
// standing: the host's Teams table, the same figures, labels, year and line
// view, built from the same posted results (RoomView.standings, session/
// standings), with the viewing team's own row highlighted. Hosted games only
// (game/tabs.ts SOLO_HIDDEN_TABS): single player and Test player have no room.
//
// ⚠ READ ONLY, AND NOTHING THE HOST'S TABLE DOES NOT SHOW: no decisions reach a
// team, its own or another's, through this view.
// ============================================================================

import StandingsTable from './StandingsTable';
import type { RoomView } from '../index';

export default function MarketSurveyTab({ room, ownTeam }: { room: RoomView; ownTeam?: string }) {
  return (
    <div data-testid="market-survey" className="mx-auto max-w-screen-2xl space-y-4 px-4 py-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Market Survey</h1>
        <p className="text-sm text-gray-600">Every team in the room, as the host sees them.</p>
        {(room.market ?? 'off') !== 'off' && (
          <p data-testid="market-survey-market-note" className="mt-1 text-xs text-gray-600">
            Market competition is on: members move between teams on price each year, so market shares move with them.
          </p>
        )}
      </div>
      {room.standings ? (
        <StandingsTable
          teams={room.standings.teams}
          marketShares={room.standings.marketShares}
          startingYear={room.startingYear}
          currentYear={room.currentYear}
          yearCount={room.yearCount}
          ownTeam={ownTeam}
        />
      ) : (
        <p data-testid="market-survey-unavailable" className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-600">
          The room&rsquo;s standings are not available yet.
        </p>
      )}
    </div>
  );
}
