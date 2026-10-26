// ============================================================================
// THE NEWS OF AN EVENT — a banner the moment it happens, and a list to look
// back on.
//
// ⚠ AT ONCE, NOT A YEAR LATER. Results run one year behind (utils/knownYears),
// so a year's financial effect — its claims, its dollars — appears when its
// results come in, as it always did. The NEWS does not wait: when a player
// advances into a year in which an event begins, the banner names it, says in
// one line what it is, and which of the team's own lines it touches. Nothing
// about its size (utils/yearEvents' eventNews holds that line).
//
// Read off the WHOLE game, not the known view: the year just played is the one
// the news is about. The same component in single-player, Test player and a
// hosted game; a hosted team's result carries only its own lines.
// ============================================================================
import { useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import type { ResultSet } from '../types/simulation';
import { eventNewsByYear, type EventNews } from '../utils/yearEvents';
import { LINE_FULL_NAME } from '../utils/lineDisplay';

const linesText = (n: EventNews) => n.lines.map(l => LINE_FULL_NAME[l]).join(', ');

/** The banner: the events new in the year just played, until dismissed. */
export function EventNewsBanner({ played, startingYear }: { played: ResultSet[]; startingYear: number }) {
  const [dismissed, setDismissed] = useState<number | null>(null);
  const latest = played.at(-1);
  if (!latest || latest.yearNumber < 1 || dismissed === latest.yearNumber) return null;
  const news = eventNewsByYear(played).get(latest.yearNumber) ?? [];
  if (news.length === 0) return null;
  const year = startingYear + latest.yearNumber - 1;
  return (
    <div data-testid="event-news" data-year={year} className="max-w-screen-2xl mx-auto px-4 pt-4">
      <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
        <Megaphone size={18} className="mt-0.5 flex-shrink-0 text-amber-600" />
        <div className="flex-1 space-y-1.5">
          <p className="font-semibold">News for {year}</p>
          {news.map(n => (
            <p key={n.key} data-testid="event-news-item">
              <span className="font-medium">{n.label}.</span>{' '}
              {n.description}{' '}
              <span className="text-amber-700">Your lines affected: {linesText(n)}.</span>
            </p>
          ))}
          <p className="text-xs text-amber-700">Its effect on your results will show when {year}&rsquo;s results come in.</p>
        </div>
        <button data-testid="event-news-dismiss" onClick={() => setDismissed(latest.yearNumber)}
          className="rounded p-1 text-amber-600 hover:bg-amber-100" aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

/** Every event so far, by the year it began — shown once there is one. */
export function EventsPanel({ played, startingYear }: { played: ResultSet[]; startingYear: number }) {
  const rows = [...eventNewsByYear(played)].flatMap(([y, news]) => news.map(n => ({ year: startingYear + y - 1, n })));
  if (rows.length === 0) return null;
  return (
    <div data-testid="events-panel" className="max-w-screen-2xl mx-auto px-4 pt-4">
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-800">Events so far</h3>
        <ul className="mt-1.5 space-y-1 text-sm text-gray-700">
          {rows.map(({ year, n }) => (
            <li key={`${year}-${n.key}`} data-testid="events-panel-item">
              <span className="font-mono text-gray-500">{year}</span>{' '}
              <span className="font-medium">{n.label}</span> — {n.description}{' '}
              <span className="text-gray-500">({linesText(n)})</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
