// ============================================================================
// THE ANNUAL STATEMENT'S DECISIONS SECTION — the decisions behind each column
// of the statement, at its foot: the same columns (Prior, then the five years
// the statement shows, the history years before play included — those carry
// the prior board's decisions), one row per decision.
//
// ⚠ READ FROM WHAT THE GAME RECORDED, NOTHING DERIVED. Every year the
// statement shows is a ResultSet — the pre-game history (earlyPreGameHistory,
// priorHistory) and the played years (lockedResults) alike — and each carries
// the decisions it was played on: the line's echo (byLine[line].decisions) and
// the pool-wide ones (pool). This reads those and formats them; it computes
// nothing. Prior is every year before the window combined, and decisions do
// not combine, so its cells are blank.
//
// A line's statement shows that line's decisions. The pool's shows the
// pool-wide decision (the asset mix), then each line's decisions under the
// line's name.
//
// ONE BUILDER, THREE READERS: the page (ResultsStatementPage), the Excel file
// (annualStatementExport) and the PDF (annualStatementPdf) all lay out these
// rows, so the three cannot disagree about a decision.
// ============================================================================
import { AGGREGATE_COVER_OPTIONS, AGGREGATE_STOP_OPTIONS } from '../data/pricingParameters';
import { newMembersShare, nonRenewalShare } from './bookUnderwriting';
import { LINE_FULL_NAME } from './lineDisplay';
import type { TemplateStatement } from './annualStatementTemplate';
import type { CoverageLine, GameState, LineDecisionSet, PoolWideDecisions, ResultSet } from '../types/simulation';

export const DECISIONS_TITLE = 'Decisions';

/** How a cell's value reads: a percentage (0 or 1 place), dollars (in the statement's thousands), or text. */
export type DecisionFormat = 'pct0' | 'pct1' | 'dollars' | 'text';

/** One cell: the text every reader shows, and, for a number, the number and its format (the Excel file writes numbers). */
export interface DecisionCell { text: string; value?: number; format: DecisionFormat }

export type DecisionRow =
  /** A group's name: "Pool-Wide", or a line's name, on the pool's statement. */
  | { kind: 'heading'; label: string }
  /** One decision. `cells` runs Prior, then the five years; null is blank (Prior, or a year with nothing recorded). */
  | { kind: 'decision'; key: string; label: string; cells: (DecisionCell | null)[] };

export interface DecisionsTable {
  /** The statement's own columns: "Prior", then the five calendar years. */
  columns: string[];
  years: number[];
  rows: DecisionRow[];
}

const pct = (v: number, places: 0 | 1): DecisionCell =>
  ({ text: `${(v * 100).toFixed(places)}%`, value: v, format: places === 0 ? 'pct0' : 'pct1' });
const text = (t: string): DecisionCell => ({ text: t, format: 'text' });

/** The per-claim cover by the name the team chose it by; "None" when declined. */
export function perClaimCoverName(id: string): string {
  if (id === 'none') return 'None';
  return AGGREGATE_STOP_OPTIONS.find(o => o.id === id)?.name ?? id;
}
/** The aggregate cover by its name ("110% / 50%"); absent or "none" is None. */
export function aggregateCoverName(id: string | undefined): string {
  if (id === undefined || id === 'none') return 'None';
  return AGGREGATE_COVER_OPTIONS.find(o => o.id === id)?.name ?? id;
}

/** The dividend as a positive figure, the assessment as a negative one — the Decisions tab's one control. Dollars, unscaled. */
export const dividendAssessmentOf = (d: LineDecisionSet): number => (d.dividendAmount ?? 0) - (d.assessmentAmount ?? 0);

/** One line's decision rows: label, then a cell from a year's recorded decisions. */
const LINE_DECISIONS: { key: string; label: string; cell: (d: LineDecisionSet) => DecisionCell }[] = [
  // "Expected" is a mode, not a stop: printing the fallback percentile would name a stop the team did not choose.
  { key: 'funding', label: 'Funding Level', cell: d => (d.fundingAtExpected ? text('Expected') : pct(d.fundingConfidenceLevel, 0)) },
  { key: 'nonRenewal', label: 'Non-Renewal', cell: d => pct(nonRenewalShare(d.nonRenewal), 0) },
  { key: 'newMembers', label: 'New Members', cell: d => pct(newMembersShare(d.newMembers), 0) },
  { key: 'perClaimCover', label: 'Per-Claim Cover', cell: d => text(perClaimCoverName(d.reinsuranceOption)) },
  { key: 'aggregateCover', label: 'Aggregate Cover', cell: d => text(aggregateCoverName(d.aggregateCover)) },
  { key: 'riskControl', label: 'Risk Control', cell: d => pct(d.riskControlIncentivePct ?? 0, 1) },
  {
    key: 'dividendAssessment', label: 'Dividend / (Assessment)',
    cell: d => {
      const v = dividendAssessmentOf(d);
      return { text: dollarsText(v), value: v, format: 'dollars' };
    },
  },
];

/** The asset mix, the pool-wide decision. Its percentages are whole numbers (10 = 10%). */
const POOL_DECISIONS: { key: string; label: string; cell: (p: PoolWideDecisions) => DecisionCell }[] = [
  { key: 'cash', label: 'Cash', cell: p => pct(p.assetAllocation.cashPct / 100, 0) },
  { key: 'bonds', label: 'Bonds', cell: p => pct(p.assetAllocation.bondsPct / 100, 0) },
  { key: 'equities', label: 'Equities', cell: p => pct(p.assetAllocation.equitiesPct / 100, 0) },
];

/** Dollars in the statement's thousands, as its figures read ("1,000", "−2,000"; 0 for none). */
export function dollarsText(dollars: number): string {
  const k = Math.round(dollars / 1000);
  return `${k < 0 ? '−' : ''}${Math.abs(k).toLocaleString('en-US')}`;
}

/** Every year a statement can show, at its valuation, by calendar year. */
function recordedYears(gs: GameState, asOf: number): Map<number, ResultSet> {
  const all = [...(gs.earlyPreGameHistory ?? []), ...(gs.priorHistory ?? []), ...gs.lockedResults].filter(r => r.yearNumber <= asOf);
  return new Map(all.map(r => [r.calendarYear, r]));
}

/** The Decisions section of a statement: its columns, and a row per decision. */
export function buildDecisionsTable(gs: GameState, ts: TemplateStatement): DecisionsTable {
  const byYear = recordedYears(gs, ts.asOf);
  const window = ts.years.map(y => byYear.get(y));
  const lineRows = (line: CoverageLine, prefix: string): DecisionRow[] => LINE_DECISIONS.map(r => ({
    kind: 'decision', key: `${prefix}${r.key}`, label: r.label,
    cells: [null, ...window.map(res => {
      const d = res?.byLine[line]?.decisions;
      return d ? r.cell(d) : null;
    })],
  }));
  const rows: DecisionRow[] = [];
  if (ts.scope === 'pool') {
    rows.push({ kind: 'heading', label: 'Pool-Wide: Asset Mix' });
    for (const r of POOL_DECISIONS) {
      rows.push({ kind: 'decision', key: `pool.${r.key}`, label: r.label, cells: [null, ...window.map(res => (res?.pool ? r.cell(res.pool) : null))] });
    }
    for (const line of gs.setup.activeLines) {
      rows.push({ kind: 'heading', label: LINE_FULL_NAME[line] });
      rows.push(...lineRows(line, `${line}.`));
    }
  } else {
    rows.push(...lineRows(ts.scope, `${ts.scope}.`));
  }
  return { columns: ts.columns, years: ts.years, rows };
}
