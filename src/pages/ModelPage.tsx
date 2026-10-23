// THE MODEL — a top-bar page, SOLO ONLY (src/game/tabs.tsx: hidden in
// multiplayer; one line in HIDDEN_TABS hides it everywhere). For checking the
// rate indication by hand: section A lays out every input to the chosen year's
// rate for the chosen line, in order, each step's figure to at least four
// decimals with its operation; section B sets each year's expected figures
// beside what the simulation produced. Figures and labels only — every figure
// is modelRate.ts's, which reads the engine's own (see its header).
import { useMemo, useState } from 'react';
import type { CoverageLine, DecisionSet, GameState } from '../types/simulation';
import { buildModelRate, buildModelVariance, modelYears, type ModelRate, type ModelVarianceYear } from '../utils/modelRate';
import { lineDisplayName } from '../utils/lineDisplay';

const f4 = (x: number) => x.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).replace(/^-/, '−');
const pct4 = (x: number) => `${f4(x * 100)}%`;

function Step({ label, op, value, testId, strong }: { label: string; op?: string; value: number; testId?: string; strong?: boolean }) {
  return (
    <tr className={`border-b border-gray-50 ${strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
      <td className="px-3 py-1">{label}</td>
      <td className="px-3 py-1 text-gray-500 font-mono text-xs whitespace-nowrap">{op ?? ''}</td>
      <td data-testid={testId} data-value={value} className="px-3 py-1 text-right font-mono tabular-nums whitespace-nowrap">{f4(value)}</td>
    </tr>
  );
}

function Heading({ n, title }: { n: number; title: string }) {
  return (
    <tr><td colSpan={3} className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{n}. {title}</td></tr>
  );
}

function SectionA({ m }: { m: ModelRate }) {
  const trendPct = ((m.annualTrend - 1) * 100).toFixed(1);
  return (
    <div data-testid="model-a" className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
      <h2 className="text-base font-bold text-gray-900">A. The rate, step by step — {lineDisplayName(m.line)}, Program Year {m.calendarYear}</h2>

      <div className="overflow-x-auto">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 pb-1">1. The experience window — valued as at 12/31/{m.latestDataYear}</h3>
        {m.window.length === 0 ? (
          <p data-testid="model-a-no-history" className="text-sm text-gray-700 py-2">
            No usable accident year: the rate is struck on the starting expected loss cost for the book&rsquo;s risk, trended to {m.calendarYear},{' '}
            <span className="font-mono" data-value={m.noHistory?.startingPer100}>{f4(m.noHistory?.startingPer100 ?? 0)}</span>,
            {' '}× the reserve inflation its claims pick up in their first {m.reserveInflationYears} years,{' '}
            <span className="font-mono" data-testid="model-a-no-history-inflation" data-value={m.noHistory?.reserveInflation}>{f4(m.noHistory?.reserveInflation ?? 1)}</span>:{' '}
            <span className="font-mono" data-value={m.noHistory?.lossCostPer100}>{f4(m.noHistory?.lossCostPer100 ?? 0)}</span> per $100.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500">
                {['Accident year', 'Valued', 'Paid losses as valued', 'Paid LDF', 'Developed losses',
                  `Reserve inflation to come (first ${m.reserveInflationYears} years)`, 'Exposure ($M)', 'Loss cost per $100',
                  `Years to ${m.latestDataYear}`, 'Trend factor', `Trended loss cost (${m.latestDataYear} level)`, 'ALAE ratio drawn'].map(h => (
                  <th key={h} className="px-2 py-1 text-right font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.window.map(w => (
                <tr key={w.accidentYear} data-testid={`model-a-window-${w.accidentYear}`} className="border-b border-gray-50 font-mono tabular-nums text-right whitespace-nowrap">
                  <td className="px-2 py-1">{w.accidentYear}</td>
                  <td className="px-2 py-1">{w.valuationDate} ({w.ageMonths} mo)</td>
                  <td className="px-2 py-1" data-value={w.paid}>{f4(w.paid)}</td>
                  <td className="px-2 py-1" data-value={w.ldf}>× {f4(w.ldf)}</td>
                  <td className="px-2 py-1" data-value={w.developed}>{f4(w.developed)}</td>
                  <td className="px-2 py-1" data-testid={`model-a-window-${w.accidentYear}-inflation`} data-value={w.reserveInflation}>× {f4(w.reserveInflation)}</td>
                  <td className="px-2 py-1" data-value={w.exposure}>÷ {f4(w.exposure)}</td>
                  <td className="px-2 py-1" data-value={w.lossCostPer100}>{f4(w.lossCostPer100)}</td>
                  <td className="px-2 py-1">{w.yearsToLatest}</td>
                  <td className="px-2 py-1" data-value={w.trendToLatest}>× {f4(w.trendToLatest)}</td>
                  <td className="px-2 py-1" data-value={w.trendedToLatestPer100}>{f4(w.trendedToLatestPer100)}</td>
                  <td className="px-2 py-1" data-value={w.alaeRatio}>{pct4(w.alaeRatio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {m.window.some(w => w.shockPaid > 0) && (
          <p className="text-xs text-gray-500 pt-1">Paid losses are shown with the year&rsquo;s shock dollars taken out on the paid basis.</p>
        )}
      </div>

      <table className="w-full max-w-3xl text-sm">
        <tbody>
          <Heading n={2} title="The projected pure premium" />
          {m.averageTrendedToLatestPer100 !== null && (
            <Step label={`Average trended loss cost, ${m.window.length} years (${m.latestDataYear} level)`} op={`mean of ${m.window.length}`} value={m.averageTrendedToLatestPer100} />
          )}
          <Step label="Book risk applied" op={m.window.length === 0 ? '× the starting expected loss' : 'in the experience — not applied again'} value={m.bookRisk} />
          <Step label={`Trend to ${m.calendarYear}`} op={`× ${f4(m.trendToPriced)} (${trendPct}% for ${m.trendYears} years)`} value={m.trendToPriced} />
          {m.catastropheLoadPer100 !== 0 && <Step label="Catastrophe load" op="+" value={m.catastropheLoadPer100} />}
          <Step label="Projected loss cost per $100" value={m.projectedLossCostPer100} testId="model-a-loss-cost" />
          <Step label={`Projected pure premium for Program Year ${m.calendarYear} per $100 (with the LAE loads, step 3)`} op="loss cost + ALAE + ULAE" value={m.projectedPurePremiumPer100} testId="model-a-projected" strong />
          <Step label={`Indicated pure premium at ${m.calendarYear - 1} rate level`} op={`÷ ${f4(m.annualTrend)} (one year's trend)`} value={m.currentLevelPurePremiumPer100} testId="model-a-current-level" />

          <Heading n={3} title="LAE loads (inside the projected pure premium)" />
          <Step label="ALAE ratio priced" op={m.window.length > 0 ? `mean of the window's ${m.window.length} drawn ratios` : 'the middle of the line\'s range (no history)'}
            value={m.alaeShare} testId="model-a-alae-ratio" />
          <Step label="ALAE" op={`loss cost × ${pct4(m.alaeShare)}`} value={m.alaePer100} />
          <Step label="ULAE" op={`loss cost × ${pct4(m.ulaeShare)}`} value={m.ulaePer100} />

          <Heading n={4} title="Admin" />
          <Step label={`Fixed admin, dollars a year (set for ${m.adminTrend.baseYear})`} value={m.adminFixed} />
          <Step label={`Per-exposure admin, per $100 (set for ${m.adminTrend.baseYear})`} value={m.adminPerExposurePer100} />
          <Step label={`Admin trend to ${m.calendarYear}`}
            op={`× ${f4(m.adminTrend.factor)} (${(m.adminTrend.perYear * 100).toFixed(1)}% for ${m.adminTrend.years} year${Math.abs(m.adminTrend.years) === 1 ? '' : 's'})`}
            value={m.adminTrend.factor} testId="model-a-admin-trend" />
          <Step label={`Fixed admin, trended to ${m.calendarYear}`} op={`${f4(m.adminFixed)} × ${f4(m.adminTrend.factor)}`} value={m.adminFixedTrended} />
          <Step label={`Per-exposure admin, trended to ${m.calendarYear}`} op={`${f4(m.adminPerExposurePer100)} × ${f4(m.adminTrend.factor)}`} value={m.adminPerExposureTrendedPer100} />
          <Step label="Exposure priced on ($M)" value={m.quotedExposure} />
          <Step label="Admin per $100" op={`${f4(m.adminFixedTrended)} ÷ (${f4(m.quotedExposure)} × 10,000) + ${f4(m.adminPerExposureTrendedPer100)}`} value={m.adminPer100} testId="model-a-admin" />

          <Heading n={5} title="Expenses, as shares of the rate at Expected" />
          <Step label="Fixed admin" value={m.expenses.fixedAdmin} testId="model-a-exp-fixed" />
          <Step label="Per-exposure admin" value={m.expenses.perExposureAdmin} testId="model-a-exp-exposure" />
          <Step label="Risk control" value={m.expenses.riskControl} testId="model-a-exp-risk-control" />
          <Step label="Profit & contingency" value={m.expenses.contingency} testId="model-a-exp-contingency" />
          <Step label="Total expense ratio" op="sum" value={m.expenses.total} testId="model-a-exp-total" strong />
          <Step label="Permissible loss ratio" op="1 − total expense ratio" value={m.expenses.permissibleLossRatio} testId="model-a-plr" strong />
          <Step label="Indicated rate at Expected per $100" op={`${f4(m.projectedPurePremiumPer100)} ÷ ${f4(m.expenses.permissibleLossRatio)}`}
            value={m.indicatedRatePer100} testId="model-a-indicated" strong />

          <Heading n={6} title="Funding and reinsurance" />
          <Step label={`Funding level: ${m.funding.label}`} op="CLF" value={m.funding.clf} testId="model-a-clf" />
          <Step label="Expense divisor" op={`1 − risk control ${pct4(m.riskControl)} − profit & contingency`} value={m.divisor} />
          <Step label="Reinsurance price per $100" value={m.reinsurancePer100} testId="model-a-reins" />

          <Heading n={7} title="The rate" />
          <Step label="Pure premium × CLF" op={`retained × ${f4(m.funding.clf)}`} value={m.pieces.purePremium} testId="model-a-piece-pure-premium" />
          <Step label="+ Admin" value={m.pieces.admin} testId="model-a-piece-admin" />
          <Step label="+ Risk Control" value={m.pieces.riskControl} testId="model-a-piece-risk-control" />
          <Step label="+ Profit & contingency" value={m.pieces.contingency} testId="model-a-piece-contingency" />
          <Step label="+ Reinsurance" value={m.pieces.reins} testId="model-a-piece-reins" />
          <Step label="= Rate per $100" op={`(${f4(m.pieces.purePremium)} + ${f4(m.pieces.admin)}) ÷ ${f4(m.divisor)} + ${f4(m.pieces.reins)}`}
            value={m.ratePer100} testId="model-a-rate" strong />
          <Step label="Exposure charged ($M)" value={m.chargedExposure} />
          <Step label="Premium" op={`${f4(m.ratePer100)} × ${f4(m.chargedExposure)} × 10,000`} value={m.premium} testId="model-a-premium" strong />
          {m.charged && <Step label="Rate the game charged per $100" value={m.charged.ratePer100} testId="model-a-charged-rate" />}
          {m.charged && <Step label="Premium the game charged" value={m.charged.premium} testId="model-a-charged-premium" />}
          {m.panelRatePer100 !== null && <Step label="Rate the Decisions panel quotes now per $100" value={m.panelRatePer100} testId="model-a-panel-rate" />}
        </tbody>
      </table>
    </div>
  );
}

const B_ROWS: { key: keyof Omit<ModelVarianceYear, 'yearNumber' | 'calendarYear'>; label: string; pct?: boolean }[] = [
  { key: 'claims', label: 'Losses, claims only' },
  { key: 'alaeRatio', label: 'ALAE ratio (priced / drawn and booked)', pct: true },
  { key: 'alae', label: 'ALAE' },
  { key: 'ulae', label: 'ULAE' },
  { key: 'lossAndLae', label: 'Loss + LAE' },
  { key: 'admin', label: 'Admin (charged / incurred)' },
  { key: 'reinsurance', label: 'Reinsurance (price / recovery)' },
  { key: 'investmentIncome', label: 'Investment income' },
  { key: 'combinedRatio', label: 'Combined ratio', pct: true },
  { key: 'surplus', label: 'Surplus, year-end' },
];

function SectionB({ years, line }: { years: ModelVarianceYear[]; line: CoverageLine }) {
  return (
    <div data-testid="model-b" className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-3">
      <h2 className="text-base font-bold text-gray-900">B. Expected against simulated — {lineDisplayName(line)}</h2>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-xs text-gray-500">
              <th className="px-2 py-1" />
              {years.map(y => <th key={y.yearNumber} colSpan={3} className="px-2 py-1 text-center font-semibold border-l border-gray-200">{y.calendarYear}</th>)}
            </tr>
            <tr className="text-xs text-gray-500 border-b border-gray-200">
              <th className="px-2 py-1" />
              {years.map(y => ['Expected', 'Simulated', 'Difference'].map((h, i) => (
                <th key={`${y.yearNumber}-${h}`} className={`px-2 py-1 text-right font-semibold whitespace-nowrap ${i === 0 ? 'border-l border-gray-200' : ''}`}>{h}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {B_ROWS.map(r => (
              <tr key={r.key} className="border-b border-gray-50">
                <td className="px-2 py-1 text-gray-700 whitespace-nowrap">{r.label}</td>
                {years.map(y => {
                  const [e, s] = y[r.key] as [number, number | null];
                  const d = s === null ? null : s - e;
                  const fmt = (x: number | null) => (x === null ? '—' : r.pct ? pct4(x) : f4(x));
                  return [
                    <td key={`${y.yearNumber}-e`} data-testid={`model-b-${r.key}-${y.calendarYear}-exp`} data-value={e} className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap border-l border-gray-100">{fmt(e)}</td>,
                    <td key={`${y.yearNumber}-s`} data-testid={`model-b-${r.key}-${y.calendarYear}-sim`} data-value={s ?? undefined} className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">{fmt(s)}</td>,
                    <td key={`${y.yearNumber}-d`} data-value={d ?? undefined} className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap text-gray-500">{fmt(d)}</td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// `knownState` is the game cut at the latest known year (utils/knownYears):
// section A is pricing and reads the whole game; section B is results and
// stops where results stop.
export default function ModelPage({ gameState, knownState, decisions }: { gameState: GameState; knownState: GameState; decisions: DecisionSet }) {
  const lines = gameState.setup.activeLines;
  const [line, setLine] = useState<CoverageLine>(lines[0]);
  const years = useMemo(() => modelYears(gameState), [gameState]);
  // null follows the default — the coming year, or the last played once the game is over.
  const [chosen, setChosen] = useState<number | null>(null);
  const yearNumber = chosen !== null && years.some(y => y.yearNumber === chosen) ? chosen : years.at(-1)?.yearNumber;
  const shownLine = lines.includes(line) ? line : lines[0];
  const rate = useMemo(
    () => (yearNumber === undefined ? null : buildModelRate(gameState, shownLine, decisions, yearNumber)),
    [gameState, shownLine, decisions, yearNumber],
  );
  const variance = useMemo(() => buildModelVariance(knownState, shownLine), [knownState, shownLine]);
  return (
    <div data-testid="model" data-year={yearNumber} data-line={shownLine} className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="flex gap-2">
          {lines.map(l => (
            <button key={l} data-testid={`model-line-${l}`} onClick={() => setLine(l)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${l === shownLine ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}>
              {lineDisplayName(l)}
            </button>
          ))}
        </div>
        <select
          data-testid="model-year"
          value={yearNumber ?? ''}
          onChange={e => setChosen(parseInt(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white"
        >
          {years.map(y => <option key={y.yearNumber} value={y.yearNumber}>Program Year {y.calendarYear}{y.yearNumber <= 0 ? ' (pre-game)' : ''}</option>)}
        </select>
      </div>
      {rate ? <SectionA m={rate} /> : <p className="text-sm text-gray-500">No rate to show for this year.</p>}
      <SectionB years={variance} line={shownLine} />
    </div>
  );
}
