// THE SPREAD BEHIND THE AVERAGE (loss engine commit 4b). Every dollar on the
// page is the average across the team's worlds; this line shows the minimum,
// median and maximum ending surplus beside it, so the average is never read as
// the only outcome. Renders nothing on a one-world game.
import { formatCurrency, colorForSurplus } from '../utils/formatters';
import type { SurplusRange } from '../utils/worlds';

interface Props {
  range: SurplusRange | undefined;
  /** What the range is of, e.g. "Ending surplus, year 3". */
  label: string;
  testId?: string;
}

export default function WorldsSurplusRange({ range, label, testId = 'worlds-surplus-range' }: Props) {
  if (!range) return null;
  return (
    <div data-testid={testId} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <span className="font-medium text-slate-700">{label} across {range.worlds} worlds:</span>{' '}
      min <span data-testid={`${testId}-min`} className={`font-mono ${colorForSurplus(range.min)}`}>{formatCurrency(range.min, true)}</span>
      {' · '}median <span data-testid={`${testId}-median`} className="font-mono">{formatCurrency(range.median, true)}</span>
      {' · '}max <span data-testid={`${testId}-max`} className="font-mono">{formatCurrency(range.max, true)}</span>
      <span className="block text-slate-400 mt-0.5">The figures shown are the average of the worlds.</span>
    </div>
  );
}
