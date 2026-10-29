// THE RATE INDICATION — a top-bar page: for the program year chosen, each line's
// pure premium, expenses and indication side by side, its covers below.
// Figures and labels only; every figure is buildRateIndication's, which reads
// the engine's own pricing (see its header).
import { useMemo, useState } from 'react';
import type { CoverageLine, DecisionSet, GameState } from '../types/simulation';
import { buildRateIndication, rateIndicationYears, type RateIndication } from '../utils/rateIndication';
import { AGGREGATE_COVER_TITLE } from '../utils/aggregateCover';
import { lineDisplayName } from '../utils/lineDisplay';
import { formatCurrency, formatMillions } from '../utils/formatters';

const rate = (x: number) => x.toFixed(3);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
// One year's trend as a percentage, to the places it has: 1.04 is "4%", 1.045 "4.5%".
// Multi-year trend factors (1.04² = 1.0816) stay factors.
const trendPct = (x: number) => `${Number(((x - 1) * 100).toFixed(2))}%`;
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

// ============================================================================
// A PAST YEAR'S RATE AS IT WAS BUILT (ri.built — modelRate's figures, the
// engine's own record of the year): the window with each year's value,
// development and trend, the average, the loads, the pure premium, the
// funding, the expense shares and the rate, against the rate the engine
// charged. Labels and figures only. A history year with no accident year to
// price from shows the expected-loss basis it was priced on, and says so.
// ============================================================================
const f4 = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

function BuiltRow({ label, testId, value, children, strong }: { label: string; testId?: string; value?: number; children: React.ReactNode; strong?: boolean }) {
  return (
    <tr className={`border-b border-gray-50 ${strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
      <td className="py-1 pr-4">{label}</td>
      <td data-testid={testId} data-value={value} className="py-1 text-right font-mono tabular-nums whitespace-nowrap">{children}</td>
    </tr>
  );
}

function Built({ ri }: { ri: RateIndication }) {
  const b = ri.built!;
  const l = ri.line;
  // The prior board funded its history years on a margin of 0: Expected.
  const funding = b.funding.label.startsWith("Prior board's margin") && b.funding.clf === 1 ? 'Expected (the prior board)' : b.funding.label;
  return (
    <div data-testid={`ri-${l}-built`} className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-800 pb-2 border-b border-gray-300">How the {ri.calendarYear} rate was built</h4>
      {b.window.length === 0 ? (
        <p data-testid={`ri-${l}-built-no-history`} className="text-sm text-gray-700">
          No accident year to price from: the {ri.calendarYear} rate was struck on the expected loss cost for the book,{' '}
          <span className="font-mono" data-value={b.noHistory?.lossCostPer100}>{rate(b.noHistory?.lossCostPer100 ?? 0)}</span> per $100.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid={`ri-${l}-built-window`}>
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500">
                {['Accident year', 'Valued', 'Paid losses', 'Development factor', 'Developed losses', 'Reserve inflation', 'Exposure ($M)',
                  'Loss cost per $100', 'Trend factor', `Trended to ${b.latestDataYear}`].map(h => (
                  <th key={h} className="px-2 py-1 text-right font-semibold whitespace-nowrap first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.window.map(w => (
                <tr key={w.accidentYear} data-testid={`ri-${l}-built-${w.accidentYear}`} className="border-b border-gray-50 font-mono tabular-nums text-right whitespace-nowrap">
                  <td className="px-2 py-1 text-left">{w.accidentYear}</td>
                  <td className="px-2 py-1">{w.valuationDate}</td>
                  <td className="px-2 py-1" data-value={w.paid}>{formatCurrency(w.paid)}</td>
                  <td className="px-2 py-1" data-value={w.ldf}>{f4(w.ldf)}</td>
                  <td className="px-2 py-1" data-value={w.developed}>{formatCurrency(w.developed)}</td>
                  <td className="px-2 py-1" data-value={w.reserveInflation}>{f4(w.reserveInflation)}</td>
                  <td className="px-2 py-1" data-value={w.exposure}>{formatMillions(w.exposure, 1)}</td>
                  <td className="px-2 py-1" data-value={w.lossCostPer100}>{f4(w.lossCostPer100)}</td>
                  <td className="px-2 py-1" data-value={w.trendToLatest}>{f4(w.trendToLatest)}</td>
                  <td className="px-2 py-1" data-value={w.trendedToLatestPer100}>{f4(w.trendedToLatestPer100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {b.window.some(w => w.shockPaid > 0) && (
            <p className="text-xs text-gray-500 pt-1">Paid losses are shown with the year&rsquo;s shock dollars taken out.</p>
          )}
        </div>
      )}
      <table className="w-full max-w-xl text-sm">
        <tbody>
          {b.averageTrendedToLatestPer100 !== null && (
            <BuiltRow label={`Average trended loss cost (${b.latestDataYear} level)`} testId={`ri-${l}-built-average`} value={b.averageTrendedToLatestPer100}>
              {f4(b.averageTrendedToLatestPer100)}
            </BuiltRow>
          )}
          <BuiltRow label={`Trend to ${ri.calendarYear}`} testId={`ri-${l}-built-trend`} value={b.trendToPriced}>{f4(b.trendToPriced)}</BuiltRow>
          {b.catastropheLoadPer100 > 0 && (
            <BuiltRow label="Catastrophe load per $100" testId={`ri-${l}-built-cat`} value={b.catastropheLoadPer100}>{f4(b.catastropheLoadPer100)}</BuiltRow>
          )}
          <BuiltRow label={`Projected loss cost per $100`} testId={`ri-${l}-built-loss-cost`} value={b.projectedLossCostPer100}>{f4(b.projectedLossCostPer100)}</BuiltRow>
          <BuiltRow label={`ALAE load (${pct(b.alaeShare)})`} testId={`ri-${l}-built-alae`} value={b.alaePer100}>{f4(b.alaePer100)}</BuiltRow>
          <BuiltRow label={`ULAE load (${pct(b.ulaeShare)})`} testId={`ri-${l}-built-ulae`} value={b.ulaePer100}>{f4(b.ulaePer100)}</BuiltRow>
          <BuiltRow label="Pure premium per $100" testId={`ri-${l}-built-pp`} value={b.projectedPurePremiumPer100} strong>{f4(b.projectedPurePremiumPer100)}</BuiltRow>
          <BuiltRow label={`Funding: ${funding}`} testId={`ri-${l}-built-clf`} value={b.funding.clf}>{f4(b.funding.clf)}</BuiltRow>
          <BuiltRow label="Admin, share of the rate" testId={`ri-${l}-built-admin`} value={b.expenses.admin}>{pct(b.expenses.admin)}</BuiltRow>
          <BuiltRow label="Risk control, share of the rate" testId={`ri-${l}-built-risk-control`} value={b.expenses.riskControl}>{pct(b.expenses.riskControl)}</BuiltRow>
          <BuiltRow label="Permissible loss ratio" testId={`ri-${l}-built-plr`} value={b.expenses.permissibleLossRatio}>{pct(b.expenses.permissibleLossRatio)}</BuiltRow>
          <BuiltRow label="Pure premium × funding" testId={`ri-${l}-built-piece-pp`} value={b.pieces.purePremium}>{f4(b.pieces.purePremium)}</BuiltRow>
          <BuiltRow label="+ Admin" testId={`ri-${l}-built-piece-admin`} value={b.pieces.admin}>{f4(b.pieces.admin)}</BuiltRow>
          <BuiltRow label="+ Risk control" testId={`ri-${l}-built-piece-risk-control`} value={b.pieces.riskControl}>{f4(b.pieces.riskControl)}</BuiltRow>
          <BuiltRow label="+ Reinsurance" testId={`ri-${l}-built-piece-reins`} value={b.pieces.reins}>{f4(b.pieces.reins)}</BuiltRow>
          <BuiltRow label={`= ${ri.calendarYear} rate per $100`} testId={`ri-${l}-built-rate`} value={b.ratePer100} strong>{f4(b.ratePer100)}</BuiltRow>
          {ri.chargedPer100 !== null && (
            <BuiltRow label={`Rate charged in ${ri.calendarYear}`} testId={`ri-${l}-built-charged`} value={ri.chargedPer100}>{f4(ri.chargedPer100)}</BuiltRow>
          )}
        </tbody>
      </table>
    </div>
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
          <Row label="Annual Trend" testId={`ri-${l}-trend`} value={p.annualTrend}>{trendPct(p.annualTrend)}</Row>
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

      {ri.built && <Built ri={ri} />}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="max-w-md">
          <h4 className="text-sm font-semibold text-gray-800 pb-2 mb-2 border-b border-gray-300">Reinsurance</h4>
          {ri.reinsurance.map(r => (
            <Row key={r.id} label={r.name} testId={`ri-${l}-reins-${r.id}`} value={r.pricePer100}>{rate(r.pricePer100)}</Row>
          ))}
          {/* THE AGGREGATE COVER ON ATTRITIONAL LOSSES, beside the per-claim covers (utils/aggregateCover). */}
          <h4 className="text-sm font-semibold text-gray-800 pt-4 pb-2 mb-2 border-b border-gray-300" data-testid={`ri-${l}-agg-covers`}>{AGGREGATE_COVER_TITLE}</h4>
          {ri.aggregateCovers.map(r => (
            <Row key={r.id} label={r.name} testId={`ri-${l}-agg-${r.id}`} value={r.pricePer100}>{rate(r.pricePer100)}</Row>
          ))}
        </div>
        {/* EVENT LIKELIHOODS, beside the cover prices — in every game (COVERS_IN_EVERY_GAME; utils/eventLikelihoods). */}
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
