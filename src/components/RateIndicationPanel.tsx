// THE RATE INDICATION — at the top of the Actuarial department, one card per
// line for the coming year. Figures and labels only; every figure is
// buildRateIndication's, which reads the engine's own pricing (see its header).
import { useMemo } from 'react';
import type { CoverageLine, DecisionSet, GameState } from '../types/simulation';
import { buildRateIndication, type RateIndication } from '../utils/rateIndication';
import { lineDisplayName } from '../utils/lineDisplay';
import { formatCurrency } from '../utils/formatters';

const rate = (x: number) => x.toFixed(3);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signed = (x: number | null) => (x === null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);

function Cell({ testId, value, children, className = '' }: { testId?: string; value?: number; children: React.ReactNode; className?: string }) {
  return (
    <td data-testid={testId} data-value={value} className={`px-3 py-1.5 text-right font-mono tabular-nums whitespace-nowrap ${className}`}>{children}</td>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</h4>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function LineCard({ ri }: { ri: RateIndication }) {
  const l = ri.line;
  const e = ri.experience;
  const x = ri.expenses;
  const th = 'px-3 py-1.5 text-right text-xs font-semibold text-gray-500 whitespace-nowrap';
  const label = 'px-3 py-1.5 text-left text-gray-700 whitespace-nowrap';
  return (
    <div data-testid={`rate-indication-${l}`} className="rounded-lg border border-gray-200 p-4 space-y-4">
      <h3 className="text-sm font-bold text-gray-900">{lineDisplayName(l)} — Rate Indication, {ri.calendarYear}</h3>

      <Section title="Experience">
        <table className="w-full text-sm">
          <thead><tr>
            <th className={th}>Loss &amp; LAE</th><th className={th}>Exposure ($M)</th><th className={th}>Pure Premium</th>
            <th className={th}>Annual Trend</th><th className={th}>Trend Factor to {ri.calendarYear}</th><th className={th}>Projected Pure Premium</th>
          </tr></thead>
          <tbody><tr>
            <Cell value={e?.lossAndLae}>{e ? formatCurrency(e.lossAndLae, true) : '—'}</Cell>
            <Cell value={e?.exposure}>{e ? e.exposure.toFixed(1) : '—'}</Cell>
            <Cell value={e?.purePremiumPer100}>{e ? rate(e.purePremiumPer100) : '—'}</Cell>
            <Cell value={e?.annualTrend}>{e ? signed(e.annualTrend - 1) : '—'}</Cell>
            <Cell value={e?.trendFactor}>{e ? e.trendFactor.toFixed(4) : '—'}</Cell>
            <Cell testId={`ri-${l}-projected`} value={ri.purePremiumPer100}>{rate(ri.purePremiumPer100)}</Cell>
          </tr></tbody>
        </table>
      </Section>

      <Section title="Expenses">
        <table className="w-full text-sm"><tbody>
          <tr><td className={label}>Fixed Admin</td><Cell value={x.fixedAdmin}>{pct(x.fixedAdmin)}</Cell></tr>
          <tr><td className={label}>Per-Exposure Admin</td><Cell value={x.perExposureAdmin}>{pct(x.perExposureAdmin)}</Cell></tr>
          <tr><td className={label}>Risk Control</td><Cell value={x.riskControl}>{pct(x.riskControl)}</Cell></tr>
          {x.contingency > 0 && <tr><td className={label}>Profit &amp; Contingency</td><Cell value={x.contingency}>{pct(x.contingency)}</Cell></tr>}
          <tr className="font-semibold"><td className={label}>Total Admin Expense Ratio</td><Cell value={x.totalAdmin}>{pct(x.totalAdmin)}</Cell></tr>
          <tr className="font-semibold"><td className={label}>Permissible Loss Ratio</td><Cell value={x.permissibleLossRatio}>{pct(x.permissibleLossRatio)}</Cell></tr>
        </tbody></table>
      </Section>

      <Section title="Indication at Expected">
        <table className="w-full text-sm"><tbody>
          <tr className="font-semibold"><td className={label}>Indicated Rate</td><Cell testId={`ri-${l}-expected`} value={ri.atExpected.indicatedPer100}>{rate(ri.atExpected.indicatedPer100)}</Cell></tr>
          <tr><td className={label}>Current Rate</td><Cell value={ri.atExpected.currentPer100 ?? undefined}>{ri.atExpected.currentPer100 === null ? '—' : rate(ri.atExpected.currentPer100)}</Cell></tr>
          <tr><td className={label}>Indicated Change</td><Cell value={ri.atExpected.change ?? undefined}>{signed(ri.atExpected.change)}</Cell></tr>
        </tbody></table>
      </Section>

      <Section title="Other Funding Levels">
        <table className="w-full text-sm">
          <thead><tr>
            <th className={`${th} text-left`}>Funding Level</th><th className={th}>CLF</th><th className={th}>Permissible Loss Ratio</th>
            <th className={th}>Indicated Rate</th><th className={th}>Indicated Change</th>
          </tr></thead>
          <tbody>
            {ri.positions.map(p => (
              <tr key={p.level}>
                <td className={label}>{Math.round(p.level * 100)}%</td>
                <Cell value={p.clf}>{p.clf.toFixed(4)}</Cell>
                <Cell value={p.permissibleLossRatio}>{pct(p.permissibleLossRatio)}</Cell>
                <Cell testId={`ri-${l}-level-${Math.round(p.level * 100)}`} value={p.indicatedPer100}>{rate(p.indicatedPer100)}</Cell>
                <Cell value={p.change ?? undefined}>{signed(p.change)}</Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Reinsurance">
        <table className="w-full text-sm"><tbody>
          {ri.reinsurance.map(r => (
            <tr key={r.id}><td className={label}>{r.name}</td><Cell testId={`ri-${l}-reins-${r.id}`} value={r.pricePer100}>{rate(r.pricePer100)}</Cell></tr>
          ))}
        </tbody></table>
      </Section>
    </div>
  );
}

export default function RateIndicationPanel({ gameState, decisions }: { gameState: GameState; decisions: DecisionSet }) {
  const cards = useMemo(
    () => gameState.setup.activeLines
      .map((l: CoverageLine) => buildRateIndication(gameState, l, decisions))
      .filter((x): x is RateIndication => x !== null),
    [gameState, decisions],
  );
  if (cards.length === 0) return null;
  return (
    <div data-testid="rate-indication" className="space-y-4 mb-8 not-prose">
      <h2 className="text-lg font-bold text-gray-900">Rate Indication</h2>
      {cards.map(ri => <LineCard key={ri.line} ri={ri} />)}
    </div>
  );
}
