// ============================================================================
// A TEAM'S OWN MARKET RESULTS — hosted rooms with market competition on. For the
// line being viewed, every year the server's market step has run: how much of
// the book wanted to leave, how much left, and how the New Members appetite
// was filled — good leavers from dearer teams, new business from outside the
// room, members other teams did not renew — each with its average risk
// (1.00 = an average member). Only the team's own figures: the result comes
// from CallerView.marketByYear, which carries this team's slice alone.
// ============================================================================

import type { CoverageLine } from '../types/simulation';
import type { MarketTeamLineResult } from '../utils/market/marketStep';

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const risk = (v: number | null) => (v === null ? '—' : v.toFixed(2));

/** The book at the start of the year the step ran on. */
const marketBookBefore = (r: MarketTeamLineResult) =>
  r.bookAfter + r.outExposure - r.inGood - r.inOutside - r.inDropped;

export default function MarketResultsPanel({ line, byYear, startingYear }: {
  line: CoverageLine;
  byYear: Record<string, Partial<Record<CoverageLine, MarketTeamLineResult>>> | undefined;
  startingYear: number;
}) {
  const rows = Object.entries(byYear ?? {})
    .map(([y, l]) => [Number(y), l[line]] as const)
    .filter((x): x is readonly [number, MarketTeamLineResult] => x[1] !== undefined)
    .sort((a, b) => a[0] - b[0]);
  return (
    <div data-testid="market-results" className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <p className="text-sm font-medium text-gray-800">Your market results</p>
      {rows.length === 0 ? (
        <p data-testid="market-results-empty" className="text-xs text-gray-600">
          The market moves members when the host advances a year. Your results appear here after the first one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1 pr-3 font-medium">Year</th>
                <th className="py-1 pr-3 font-medium">Wanting to leave</th>
                <th className="py-1 pr-3 font-medium">Left</th>
                <th className="py-1 pr-3 font-medium">Appetite filled</th>
                <th className="py-1 pr-3 font-medium">Good leavers</th>
                <th className="py-1 pr-3 font-medium">New business</th>
                <th className="py-1 pr-3 font-medium">Dropped members</th>
                <th className="py-1 pr-3 font-medium">Book risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([y, r]) => {
                const book = marketBookBefore(r);
                const of = (e: number) => (book > 0 ? e / book : 0);
                const taken = r.inGood + r.inOutside + r.inDropped;
                const cell = (e: number, q: number | null, id: string) => (
                  <td data-testid={`market-${id}-${y}`} className="py-1 pr-3">
                    {e > 0 ? <>{pct(of(e))} <span className="text-gray-500">(risk {risk(q)})</span></> : '—'}
                  </td>
                );
                return (
                  <tr key={y} data-testid={`market-row-${y}`} className="border-t border-gray-100 text-gray-800">
                    <td className="py-1 pr-3">{startingYear + y - 1}</td>
                    <td data-testid={`market-willing-${y}`} className="py-1 pr-3">{pct(r.willingShare)}</td>
                    <td data-testid={`market-left-${y}`} className="py-1 pr-3">
                      {r.leftShare > 0 ? <>{pct(r.leftShare)} <span className="text-gray-500">(risk {risk(r.qualityLeft)})</span></> : '—'}
                    </td>
                    <td data-testid={`market-filled-${y}`} className="py-1 pr-3">
                      {r.appetite > 0 ? `${pct(of(taken))} of ${pct(of(r.appetite))}` : 'No appetite'}
                    </td>
                    {cell(r.inGood, r.qualityGood, 'good')}
                    {cell(r.inOutside, r.qualityOutside, 'outside')}
                    {cell(r.inDropped, r.qualityDropped, 'dropped')}
                    <td data-testid={`market-bookrisk-${y}`} className="py-1 pr-3">{r.bookRisk.toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1.5 text-xs text-gray-600">
            Shares are of your book at the start of the year. Risk is the members&rsquo; average loss cost, 1.00 being an
            average member. Book risk multiplies your losses for the year; it fades halfway back to 1.00 each year.
          </p>
        </div>
      )}
    </div>
  );
}
