// THE RATE INDICATION — a top-bar page: for the program year chosen, each line's
// pure premium, expenses and indication side by side, its covers below.
// Figures and labels only; every figure is buildRateIndication's, which reads
// the engine's own pricing (see its header).
import { useMemo, useState } from 'react';
import type { CoverageLine, DecisionSet, GameState } from '../types/simulation';
import { buildRateIndication, rateIndicationYears, type RateIndication } from '../utils/rateIndication';
import { lineDisplayName } from '../utils/lineDisplay';
import { formatCurrency, formatMillions } from '../utils/formatters';

const rate = (x: number) => x.toFixed(3);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
// A factor as itself, to the places it has: 1.04, 1.08, 1.05.
const factor = (x: number) => String(Number(x.toFixed(4)));
const signed = (x: number | null) => (x === null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);

function Row({ label, testId, value, window, children, strong }: {
  label: string; testId?: string; value?: number; window?: number; children: React.ReactNode; strong?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 text-sm ${strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
      <span>{label}</span>
      <span data-testid={testId} data-value={value} data-window={window} className="font-mono tabular-nums whitespace-nowrap">{children}</span>
    </div>
  );
}

const Space = () => <div className="h-3" />;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-0 py-3 md:px-5 md:py-0">
      <h4 className="text-sm font-semibold text-gray-800 pb-2 mb-2 border-b border-gray-300">{title}</h4>
      {children}
    </div>
  );
}

// THE EVENT LIKELIHOODS' SMALL CHART: claim size ($M) against the return
// period, 1 in 10 to 1 in 200 years on a log scale, the points joined. Its
// y-axis runs to the largest size shown, so the curve rises with the year's
// growth factor along with the table.
function LikelihoodChart({ line, rows }: { line: CoverageLine; rows: { years: number; size: number | null }[] }) {
  const pts = rows.filter((r): r is { years: number; size: number } => r.size !== null);
  if (pts.length === 0) return null;
  const W = 260, H = 130, L = 34, B = 22, T = 8, Rr = 8;
  const xOf = (y: number) => L + (Math.log(y / 10) / Math.log(20)) * (W - L - Rr);
  const top = Math.max(...pts.map(p => p.size)) / 1e6;
  const step = top > 40 ? 20 : top > 20 ? 10 : 5;
  const yMax = Math.ceil(top / step) * step;
  const yOf = (m: number) => H - B - (m / yMax) * (H - B - T);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.years).toFixed(1)},${yOf(p.size / 1e6).toFixed(1)}`).join(' ');
  return (
    <svg data-testid={`ri-${line}-likelihood-chart`} viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full max-w-xs" role="img"
      aria-label={`Claim size against return period, ${line}`}>
      {Array.from({ length: yMax / step + 1 }, (_, i) => i * step).map(m => (
        <g key={m}>
          <line x1={L} x2={W - Rr} y1={yOf(m)} y2={yOf(m)} className="stroke-gray-200" strokeWidth={1} />
          <text x={L - 4} y={yOf(m) + 3} textAnchor="end" className="fill-gray-500" fontSize={9}>{`$${m}M`}</text>
        </g>
      ))}
      {rows.map(r => (
        <text key={r.years} x={xOf(r.years)} y={H - 6} textAnchor="middle" className="fill-gray-500" fontSize={9}>{`1/${r.years}`}</text>
      ))}
      <path d={path} fill="none" className="stroke-blue-600" strokeWidth={2} />
      {pts.map(p => <circle key={p.years} cx={xOf(p.years)} cy={yOf(p.size / 1e6)} r={3} className="fill-blue-600" />)}
    </svg>
  );
}

function LineCard({ ri }: { ri: RateIndication }) {
  const l = ri.line;
  const p = ri.pure;
  const x = ri.expenses;
  // Section 3 names its years: the program year priced (ri.calendarYear) and
  // the current year before it, whose rate is in force — "2026 Rate" and
  // "Indicated 2027 Rate at …" at the start, following the year shown.
  const programYear = ri.calendarYear;
  const levelLabel = (pos: RateIndication['positions'][number]['position']) =>
    pos === 'expected' ? `Indicated ${programYear} Rate at Expected` : `Indicated ${programYear} Rate at ${Math.round(pos * 100)}% CLF`;
  const levelId = (pos: RateIndication['positions'][number]['position']) =>
    pos === 'expected' ? `ri-${l}-expected` : `ri-${l}-level-${Math.round(pos * 100)}`;
  return (
    <div data-testid={`rate-indication-${l}`} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-5">
      <h3 className="text-base font-bold text-gray-900">{lineDisplayName(l)}</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-200">
        <Section title="Pure Premium">
          <Row label={`${p.windowYears}-Year Trended Average Loss at ${p.rateLevelYear} Rate Level`}
            testId={`ri-${l}-losses`} value={p.trendedAverageLosses} window={p.windowYears}>
            {p.windowYears > 0 ? formatCurrency(p.trendedAverageLosses, true) : '—'}
          </Row>
          <Row label={`${p.rateLevelYear} Exposure`} testId={`ri-${l}-exposure`} value={p.exposure}>
            {p.windowYears > 0 ? formatMillions(p.exposure, 1) : '—'}
          </Row>
          <Row label={`Indicated Pure Premium at ${p.rateLevelYear} Rate Level`} testId={`ri-${l}-pp`} value={p.purePremiumPer100}>
            {rate(p.purePremiumPer100)}
          </Row>
          <Space />
          <Row label="Annual Trend" testId={`ri-${l}-trend`} value={p.annualTrend}>{factor(p.annualTrend)}</Row>
          <Space />
          <Row label={`Projected Pure Premium for Program Year ${ri.calendarYear}`} testId={`ri-${l}-projected`}
            value={p.projectedPer100} strong>
            {rate(p.projectedPer100)}
          </Row>
          <Space />
          <Row label={`Indicated Rate Change from the ${p.rateLevelYear} Rate`} testId={`ri-${l}-change`} value={ri.indicatedRateChange ?? undefined}>
            {signed(ri.indicatedRateChange)}
          </Row>
        </Section>

        <Section title="Expenses">
          <Row label="Admin" testId={`ri-${l}-admin`} value={x.admin}>{pct(x.admin)}</Row>
          <Row label="Risk control" testId={`ri-${l}-risk-control`} value={x.riskControl}>{pct(x.riskControl)}</Row>
          <Space />
          <Row label="Total expense ratio" testId={`ri-${l}-total-admin`} value={x.totalAdmin} strong>{pct(x.totalAdmin)}</Row>
          <Space />
          <Row label="Permissible loss ratio" testId={`ri-${l}-permissible`} value={x.permissibleLossRatio} strong>{pct(x.permissibleLossRatio)}</Row>
        </Section>

        <Section title="Indication at Various CLF">
          <Row label={`${programYear - 1} Rate`} testId={`ri-${l}-current`} value={ri.currentPer100 ?? undefined}>
            {ri.currentPer100 === null ? '—' : rate(ri.currentPer100)}
          </Row>
          <Space />
          {ri.positions.map(pos => (
            <div key={String(pos.position)} className="flex items-baseline justify-between gap-4 py-1 text-sm text-gray-700">
              <span>{levelLabel(pos.position)}</span>
              <span className="flex gap-4 font-mono tabular-nums whitespace-nowrap">
                <span data-testid={levelId(pos.position)} data-value={pos.ratePer100}>{rate(pos.ratePer100)}</span>
                <span className="w-14 text-right" data-value={pos.change ?? undefined}>{signed(pos.change)}</span>
              </span>
            </div>
          ))}
        </Section>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="max-w-md">
          <h4 className="text-sm font-semibold text-gray-800 pb-2 mb-2 border-b border-gray-300">Reinsurance</h4>
          {ri.reinsurance.map(r => (
            <Row key={r.id} label={r.name} testId={`ri-${l}-reins-${r.id}`} value={r.pricePer100}>{rate(r.pricePer100)}</Row>
          ))}
        </div>
        {/* EVENT LIKELIHOODS, beside the cover prices — in every game (LARGE_CLAIMS_EVERY_GAME; utils/eventLikelihoods). */}
        {ri.eventLikelihoods && (
          <div className="max-w-md" data-testid={`ri-${l}-event-likelihoods`}>
            <h4 className="text-sm font-semibold text-gray-800 pb-2 mb-1 border-b border-gray-300">Event Likelihoods</h4>
            <p className="text-xs text-gray-500 mb-1">The chance in any year of a single large claim at least this size.</p>
            {/* A table: return period against the claim size. */}
            <table className="w-full text-sm" data-testid={`ri-${l}-likelihood-table`}>
              <thead>
                <tr className="text-xs text-gray-500">
                  <th className="text-left font-medium py-1">Return period</th>
                  <th className="text-right font-medium py-1">Claim size</th>
                </tr>
              </thead>
              <tbody>
                {ri.eventLikelihoods.map(e => (
                  <tr key={e.years} className="text-gray-700">
                    <td className="py-1">{`1 in ${e.years} years`}</td>
                    <td className="py-1 text-right font-mono tabular-nums" data-testid={`ri-${l}-likelihood-${e.years}`} data-value={e.size ?? undefined}>
                      {e.size === null ? '—' : formatMillions(e.size / 1e6, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LikelihoodChart line={l} rows={ri.eventLikelihoods} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function RateIndicationPage({ gameState, decisions }: { gameState: GameState; decisions: DecisionSet }) {
  const years = useMemo(() => rateIndicationYears(gameState), [gameState]);
  // null follows the default — the coming year, or the last played once the game is over.
  const [chosen, setChosen] = useState<number | null>(null);
  const yearNumber = chosen !== null && years.some(y => y.yearNumber === chosen) ? chosen : years.at(-1)?.yearNumber;
  const shown = years.find(y => y.yearNumber === yearNumber);
  const cards = useMemo(
    () => (yearNumber === undefined ? [] : gameState.setup.activeLines
      .map((l: CoverageLine) => buildRateIndication(gameState, l, decisions, yearNumber))
      .filter((x): x is RateIndication => x !== null)),
    [gameState, decisions, yearNumber],
  );
  return (
    <div data-testid="rate-indication" data-year={yearNumber} className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <h1 className="text-lg font-semibold text-gray-900">
          Actuarial Rate Indication for Program Year {shown?.calendarYear ?? ''}
        </h1>
        <select
          data-testid="ri-year"
          value={yearNumber ?? ''}
          onChange={e => setChosen(parseInt(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {years.map(y => <option key={y.yearNumber} value={y.yearNumber}>Program Year {y.calendarYear}</option>)}
        </select>
      </div>
      {cards.map(ri => <LineCard key={ri.line} ri={ri} />)}
    </div>
  );
}
