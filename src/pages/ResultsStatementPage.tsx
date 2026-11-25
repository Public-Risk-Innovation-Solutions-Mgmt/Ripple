// THE ANNUAL STATEMENT — the players' results page, replacing Pool History.
// Laid out as the template (docs/Annual Statement Example v2.xlsx) row for row:
// TEMPLATE_ROWS (utils/annualStatementTemplate) gives every title, label and
// blank row, buildTemplateStatement every figure — read from buildAnnualStatement
// (utils/resultsStatement), which reads the engine — and cellBorders every
// cell's lines, the template's through the statement's deliberate differences.
// This file only lays the cells out; the Excel download writes the same rows and
// lines (annualStatementExport), and the PDF download draws them
// (annualStatementPdf). Each file's library is fetched only on its button's press.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { Download } from 'lucide-react';
import type { GameState, LineView } from '../types/simulation';
import { statementYears } from '../utils/resultsStatement';
import {
  ALL_YEARS_LABEL, allYearsCell, buildTemplateStatement, statementFilename, cellBorders, figureText, isBlockName, RENAMED_HEADINGS, showsPrior, shownFigure,
  TEMPLATE_ROWS, type TemplateRow, type TemplateStatement,
} from '../utils/annualStatementTemplate';
import { buildAnnualStatementXlsx } from '../utils/annualStatementExport';
import { buildAnnualStatementPdf } from '../utils/annualStatementPdf';
import { lineDisplayName } from '../utils/lineDisplay';
import { buildDecisionsTable, DECISIONS_TITLE, type DecisionsTable } from '../utils/statementDecisions';
import {
  buildMarketSurveyTable, MARKET_SURVEY_TITLE, type MarketSurveyStandings, type MarketSurveyTable,
} from '../utils/statementMarketSurvey';

interface Props {
  gameState: GameState;
  lineView: LineView;
  /**
   * A hosted game's standings — the Market Survey tab's own (RoomView.standings),
   * with the viewing team. Absent in single player and Test player, whose Market
   * Survey section shows the player's own pool.
   */
  standings?: MarketSurveyStandings;
}

/** The test id of the table each title opens; the reinsurance blocks take their own by their header. */
const SECTION_ID: Record<string, string> = {
  'Net Income Statement For The Year': 'statement-operating',
  'Balance Sheet at Year-End': 'statement-balance',
  'Underwriting': 'statement-underwriting',
  [RENAMED_HEADINGS['Contributions To The Current Calendar Year - Net'].trim()]: 'statement-contributions',
  [RENAMED_HEADINGS['Program Year Totals - Net'].trim()]: 'statement-program',
  'Reinsurance Information - Program Year Totals': 'statement-reinsurance',
};
const DECISIONS_ID = 'statement-decisions';
const MARKET_SURVEY_ID = 'statement-market-survey';
const BLOCK_ID: Record<string, string> = { Gross: 'statement-gross', Ceded: 'statement-ceded', Net: 'statement-net' };

/** A statement row and its index in the statement's rows (ts.rows) — the index is its row in the file, and its borders. */
interface At { row: TemplateRow; i: number }

/**
 * The statement's rows (TEMPLATE_ROWS, or ADMIN_SPLIT_ROWS in a New-version
 * market room), cut at each title: [title, rows under it]. Row 1, above the
 * first title, carries no line.
 */
function sections(rows: readonly TemplateRow[]): { title: string; rows: At[] }[] {
  const out: { title: string; rows: At[] }[] = [];
  rows.forEach((row, i) => {
    if (row.kind === 'title') out.push({ title: row.label.trim(), rows: [] });
    else if (out.length > 0) out[out.length - 1].rows.push({ row, i });
  });
  return out;
}
const SECTIONS_OF = new Map<readonly TemplateRow[], ReturnType<typeof sections>>();
const sectionsOf = (rows: readonly TemplateRow[]) => {
  if (!SECTIONS_OF.has(rows)) SECTIONS_OF.set(rows, sections(rows));
  return SECTIONS_OF.get(rows)!;
};

const yearEnd = (calendarYear: number) => `12/31/${String(calendarYear % 100).padStart(2, '0')}`;
/** The template indents a sub-item by leading spaces; the screen indents it. */
const indented = (label: string) => /^\s/.test(label);

/**
 * A cell's lines, as the statement draws them: column c (B = 1 … H = 7, I = 8) of
 * row i (cellBorders, which takes A = 1). The tables collapse their borders, so a
 * line two neighbours both carry is one line, as in Excel.
 */
const LINE = '1px solid #000';
function edges(i: number, c: number, rows: readonly TemplateRow[]): CSSProperties {
  const s = cellBorders(i, c + 1, rows);
  return {
    ...(s.includes('L') ? { borderLeft: LINE } : {}),
    ...(s.includes('R') ? { borderRight: LINE } : {}),
    ...(s.includes('T') ? { borderTop: LINE } : {}),
    ...(s.includes('B') ? { borderBottom: LINE } : {}),
  };
}

function Row({ at: { row, i }, ts }: { at: At; ts: TemplateStatement }) {
  // Every row has all its cells, B to I, so the vertical lines run down blank
  // rows and headings too and every box is the same width — I is All Years in the
  // program-year sections and a blank, bordered column in the first three, whose
  // C (Prior) is blank as well.
  const cols = ts.columns.length + 1;
  const data = { 'data-template-row': i + 1 };
  const ay = 1 + ts.columns.length + 1; // All Years' border column: I
  switch (row.kind) {
    case 'blank': case 'title':
      return (
        <tr data-row-kind="blank" aria-hidden="true" {...data}>
          {Array.from({ length: 1 + cols }, (_, c) => <td key={c} className="h-5" style={edges(i, c + 1, ts.rows)} />)}
        </tr>
      );
    case 'header':
      return (
        <tr data-row-kind="header" {...data}>
          {/* The Reinsurance blocks' names — Gross, Ceded, Net — sit on the left, in bold. */}
          <th className={`px-3 py-1 ${isBlockName(row.label) ? 'text-left font-bold' : 'text-right font-semibold'} text-black whitespace-pre`} style={edges(i, 1, ts.rows)}>{row.label.trim()}</th>
          {ts.columns.map((c, k) => (
            <th key={c} className="px-3 py-1 text-center font-semibold text-black whitespace-nowrap" style={edges(i, k + 2, ts.rows)}>
              {k === 0 ? (showsPrior(i, ts.rows) ? c : '') : row.dates ? yearEnd(ts.years[k - 1]) : c}
            </th>
          ))}
          <th className="px-3 py-1 text-center font-semibold text-black whitespace-nowrap" style={edges(i, ay, ts.rows)}>{row.allYears ? ALL_YEARS_LABEL : ''}</th>
        </tr>
      );
    case 'note':
      // The admin split's note (ADMIN_SPLIT_ROWS): its words across the row, no lines.
      return (
        <tr data-row-kind="note" data-testid="fixed-admin-note" {...data}>
          <td colSpan={1 + cols} className="px-3 py-1 text-black italic whitespace-nowrap">{row.label}</td>
        </tr>
      );
    case 'heading':
      return (
        <tr data-row-kind="heading" {...data}>
          <td className="px-3 py-1 text-black whitespace-nowrap" style={edges(i, 1, ts.rows)}>{row.label.trim()}</td>
          {Array.from({ length: cols }, (_, k) => <td key={k} style={edges(i, k + 2, ts.rows)} />)}
        </tr>
      );
    case 'figure': {
      return (
        <tr data-row-label={row.label.trim()} data-row-key={row.key} {...data}>
          <td className={`px-3 py-1 text-black ${indented(row.label) ? 'pl-10' : ''}`} style={edges(i, 1, ts.rows)}>{row.label.trim()}</td>
          {ts.figures[row.key].map((_, k) => {
            // Blank where the statement shows nothing (shownFigure): Prior in the
            // first three sections, the first year's change in Underwriting.
            const x = shownFigure(row, i, k, ts);
            // Red by the figure AS SHOWN: a few cents below zero shows 0, in black.
            const text = x === undefined ? '' : figureText(x, row.format);
            return (
              <td key={k} className={`px-3 py-1 text-right tabular-nums whitespace-nowrap ${text.startsWith('−') ? 'text-red-600' : 'text-black'}`} style={edges(i, k + 2, ts.rows)}>
                {text}
              </td>
            );
          })}
          <AllYearsCell row={row} i={i} ts={ts} style={edges(i, ay, ts.rows)} />
        </tr>
      );
    }
  }
}

/** A row's All Years cell: the total on a dollar row, blank on a ratio row (allYearsCell). */
function AllYearsCell({ row, i, ts, style }: { row: TemplateRow; i: number; ts: TemplateStatement; style: CSSProperties }) {
  const total = allYearsCell(row, i, ts);
  const text = total === undefined || row.kind !== 'figure' ? '' : figureText(total, row.format);
  return (
    <td data-all-years="" className={`px-3 py-1 text-right tabular-nums whitespace-nowrap ${text.startsWith('−') ? 'text-red-600' : 'text-black'}`} style={style}>
      {text}
    </td>
  );
}

/** One section's rows; a header row opens a new body, so each reinsurance block is its own. */
function SectionTable({ title, rows, ts }: { title: string; rows: At[]; ts: TemplateStatement }) {
  const bodies: { header?: string; rows: At[] }[] = [{ rows: [] }];
  for (const at of rows) {
    const r = at.row;
    if (r.kind === 'header' && bodies[bodies.length - 1].rows.some(x => x.row.kind === 'header')) bodies.push({ header: r.label.trim(), rows: [] });
    else if (r.kind === 'header') bodies[bodies.length - 1].header = r.label.trim();
    bodies[bodies.length - 1].rows.push(at);
  }
  return (
    <section id={SECTION_ID[title]} data-testid={SECTION_ID[title]} className="overflow-x-auto" style={{ scrollMarginTop: 'var(--statement-index-offset, 0px)' }}>
      <h2 className="px-3 text-base font-semibold text-black">{title}</h2>
      <table className="text-sm text-black border-collapse">
        <colgroup>
          <col className="w-[340px]" />
          {ts.columns.map(c => <col key={c} className="w-[110px]" />)}
          <col className="w-[110px]" />
        </colgroup>
        {bodies.map((b, k) => (
          <tbody key={k} data-testid={b.header ? BLOCK_ID[b.header] : undefined}>
            {b.rows.map(at => <Row key={at.i} at={at} ts={ts} />)}
          </tbody>
        ))}
      </table>
    </section>
  );
}

/**
 * THE DECISIONS SECTION (utils/statementDecisions): the statement's own columns,
 * a row per decision, at the foot of the statement. Laid out as the sections
 * above it — the title, a header of Prior and the years, each column boxed — but
 * its cells are words and percentages as well as dollars, so it is its own table
 * rather than TEMPLATE_ROWS.
 */
function DecisionsSection({ table }: { table: DecisionsTable }) {
  const box: CSSProperties = { borderLeft: LINE, borderRight: LINE };
  const cols = table.columns.length + 1; // Prior, the five years, and the blank All Years column the sections above carry
  return (
    <section id={DECISIONS_ID} data-testid={DECISIONS_ID} className="overflow-x-auto" style={{ scrollMarginTop: 'var(--statement-index-offset, 0px)' }}>
      <div className="h-5" aria-hidden="true" />
      <h2 className="px-3 text-base font-semibold text-black">{DECISIONS_TITLE}</h2>
      <table className="text-sm text-black border-collapse">
        <colgroup>
          <col className="w-[340px]" />
          {table.columns.map(c => <col key={c} className="w-[110px]" />)}
          <col className="w-[110px]" />
        </colgroup>
        <tbody>
          <tr data-row-kind="header">
            <th className="px-3 py-1 text-right font-semibold text-black whitespace-pre" style={{ ...box, borderTop: LINE, borderBottom: LINE }}>Program Year:</th>
            {table.columns.map((c, k) => (
              <th key={c} className="px-3 py-1 text-center font-semibold text-black whitespace-nowrap" style={{ ...box, borderTop: LINE, borderBottom: LINE }}>
                {k === 0 ? '' : c}
              </th>
            ))}
            <th style={{ ...box, borderTop: LINE, borderBottom: LINE }} />
          </tr>
          {table.rows.map((r, n) => {
            const last = n === table.rows.length - 1 ? { borderBottom: LINE } : {};
            if (r.kind === 'heading') {
              return (
                <tr key={`h${n}`} data-row-kind="heading">
                  <td className="px-3 pt-3 pb-1 font-semibold text-black whitespace-nowrap" style={{ ...box, ...last }}>{r.label}</td>
                  {Array.from({ length: cols }, (_, k) => <td key={k} style={{ ...box, ...last }} />)}
                </tr>
              );
            }
            return (
              <tr key={r.key} data-decision-key={r.key} data-row-label={r.label}>
                <td className="px-3 py-1 text-black pl-10" style={{ ...box, ...last }}>{r.label}</td>
                {r.cells.map((c, k) => (
                  <td key={k} data-decision-year={k === 0 ? 'prior' : table.years[k - 1]}
                    className={`px-3 py-1 text-right tabular-nums whitespace-nowrap ${c?.text.startsWith('−') ? 'text-red-600' : 'text-black'}`}
                    style={{ ...box, ...last }}>
                    {c?.text ?? ''}
                  </td>
                ))}
                <td style={{ ...box, ...last }} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/**
 * THE MARKET SURVEY SECTION (utils/statementMarketSurvey): the Market Survey
 * tab's table for the statement's year and view, just before Decisions — every
 * team in a hosted room, the viewing team's row marked; the player's own pool in
 * single player and Test player. Laid out as the Decisions section — the title,
 * a boxed header, each column boxed — its cells the tab's own text.
 */
function MarketSurveySection({ table }: { table: MarketSurveyTable }) {
  const box: CSSProperties = { borderLeft: LINE, borderRight: LINE };
  const headBox: CSSProperties = { ...box, borderTop: LINE, borderBottom: LINE };
  return (
    <section id={MARKET_SURVEY_ID} data-testid={MARKET_SURVEY_ID} className="overflow-x-auto" style={{ scrollMarginTop: 'var(--statement-index-offset, 0px)' }}>
      <div className="h-5" aria-hidden="true" />
      <div className="flex items-baseline justify-between gap-3 px-3">
        <h2 className="text-base font-semibold text-black">{MARKET_SURVEY_TITLE} — {table.scopeName}</h2>
        <p data-testid="statement-market-survey-year" className="text-xs text-black">{table.yearText}</p>
      </div>
      {table.note ? (
        <p data-testid="statement-market-survey-note" className="px-3 py-2 text-sm text-black">{table.note}</p>
      ) : (
        // ⚠ THE STATEMENT'S WIDTH, NOT WIDER: eight columns, so the heads wrap rather than push Market share off the page.
        <table className="w-full text-sm text-black border-collapse">
          <thead>
            <tr data-row-kind="header">
              {table.heads.map((h, k) => (
                <th key={h} data-testid={k === 5 ? 'statement-market-survey-cr-head' : undefined}
                  className={`px-2 py-1 align-bottom font-semibold text-black ${k < 1 ? 'text-left' : 'text-right'}`} style={headBox}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody data-testid="statement-market-survey-rows">
            {table.rows.map((r, n) => {
              const last = n === table.rows.length - 1 ? { borderBottom: LINE } : {};
              const cellStyle: CSSProperties = { ...box, ...last };
              const f = r.figures;
              return (
                <tr key={r.team} data-testid={`statement-market-survey-row-${r.team}`} data-own={r.own ? 'true' : undefined}
                  className={r.own ? 'bg-blue-50 font-semibold' : undefined}>
                  <td className="px-2 py-1 whitespace-nowrap" style={cellStyle}>{r.team}</td>
                  {'absent' in f || 'pending' in f ? (
                    <td colSpan={6} className={`px-2 py-1 text-xs ${'absent' in f ? 'italic' : 'text-amber-700'}`} style={cellStyle}>
                      {'absent' in f ? f.absent : f.pending}
                    </td>
                  ) : (
                    <>
                      <td data-testid={`statement-market-survey-ripple-${r.team}`} className="px-2 py-1 text-right tabular-nums" style={cellStyle}>{f.ripple}</td>
                      <td data-testid={`statement-market-survey-pts-${r.team}`} className="px-2 py-1 text-right tabular-nums" style={cellStyle}>{f.premiumToSurplus}</td>
                      <td data-testid={`statement-market-survey-rate-${r.team}`} className="px-2 py-1 text-right tabular-nums" style={cellStyle}>
                        {f.rate.map(x => <span key={x} className="block whitespace-nowrap">{x}</span>)}
                      </td>
                      <td data-testid={`statement-market-survey-admin-${r.team}`} className="px-2 py-1 text-right tabular-nums" style={cellStyle}>{f.admin}</td>
                      <td data-testid={`statement-market-survey-cr-${r.team}`} className="px-2 py-1 text-right tabular-nums" style={cellStyle}>{f.combinedRatio}</td>
                      <td data-testid={`statement-market-survey-surplus-${r.team}`}
                        className={`px-2 py-1 text-right tabular-nums ${r.surplus !== undefined && r.surplus < 0 ? 'text-red-600' : ''}`} style={cellStyle}>{f.netSurplus}</td>
                    </>
                  )}
                  <td data-testid={`statement-market-survey-share-${r.team}`} className="px-2 py-1 text-right tabular-nums whitespace-nowrap" style={cellStyle}>{r.marketShare}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="px-3 pt-1 text-[11px] text-black">{table.footnote}</p>
      {table.shareNote && <p data-testid="survey-share-note" className="px-3 text-[11px] text-black">{table.shareNote}</p>}
    </section>
  );
}

/** The index's entries: every section of the statement, in order, then the Market Survey and Decisions. */
const INDEX: { id: string; title: string }[] = [
  ...sectionsOf(TEMPLATE_ROWS).map(s => ({ id: SECTION_ID[s.title], title: s.title })),
  { id: MARKET_SURVEY_ID, title: MARKET_SURVEY_TITLE },
  { id: DECISIONS_ID, title: DECISIONS_TITLE },
];

/**
 * How far down the viewport the app's own sticky bars reach — the header and
 * the tab bars above this page — so the index sits under them and a section
 * scrolled to lands below them. Measured, not assumed: their heights change
 * with the screen's width (the tabs wrap) and with the mode (hosted adds none,
 * the line-view bar shows on this tab).
 */
function stickyStackBottom(exclude: Element | null): number {
  let bottom = 0;
  for (const el of Array.from(document.querySelectorAll('header, nav'))) {
    if (exclude && exclude.contains(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position !== 'sticky' && cs.position !== 'fixed') continue;
    const top = parseFloat(cs.top);
    if (!Number.isFinite(top)) continue;
    bottom = Math.max(bottom, top + el.getBoundingClientRect().height);
  }
  return bottom;
}

/**
 * THE STICKY INDEX: a link to each section, the one in view highlighted. On a
 * wide screen it is a column beside the statement; on a narrow one, a bar above
 * it that scrolls sideways. Either way it stays put under the app's bars.
 */
function StatementIndex({ offset, active, onGo, navRef }: {
  offset: number; active: string; onGo: (id: string) => void; navRef: MutableRefObject<HTMLElement | null>;
}) {
  return (
    <nav ref={navRef} data-testid="statement-index" aria-label="Annual Statement sections"
      className="sticky z-10 -mx-4 mb-3 border-b border-gray-200 bg-white/95 px-4 py-2 backdrop-blur lg:mx-0 lg:mb-0 lg:w-60 lg:shrink-0 lg:self-start lg:rounded-lg lg:border lg:p-3"
      style={{ top: offset }}>
      <p className="hidden lg:block px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Sections</p>
      <ol className="flex gap-1 overflow-x-auto whitespace-nowrap lg:flex-col lg:whitespace-normal">
        {INDEX.map(e => (
          <li key={e.id} className="shrink-0">
            <a href={`#${e.id}`} data-testid={`statement-index-${e.id}`} aria-current={active === e.id ? 'location' : undefined}
              onClick={ev => { ev.preventDefault(); onGo(e.id); }}
              className={`block rounded-md px-2 py-1 text-xs leading-snug ${active === e.id
                ? 'bg-brand-600 font-semibold text-white' : 'text-black hover:bg-gray-100'}`}>
              {e.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default function ResultsStatementPage({ gameState, lineView, standings }: Props) {
  // The year the statement stands at; null follows the latest year as the game moves on.
  const [chosen, setChosen] = useState<number | null>(null);
  const years = useMemo(() => statementYears(gameState), [gameState]);
  const latest = years.at(-1)?.yearNumber ?? 0;
  const asOf = chosen !== null && years.some(y => y.yearNumber === chosen) ? chosen : latest;
  const ts = useMemo(() => buildTemplateStatement(gameState, lineView, asOf), [gameState, lineView, asOf]);
  const decisions = useMemo(() => buildDecisionsTable(gameState, ts), [gameState, ts]);
  const survey = useMemo(() => buildMarketSurveyTable(gameState, ts, standings), [gameState, ts, standings]);

  // ---- the sticky index: where it sits, and which section is in view ----
  const navRef = useRef<HTMLElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [active, setActive] = useState(INDEX[0].id);
  /** The line a section's top must cross to be "in view": under the app's bars, and under the index on a narrow screen. */
  const threshold = useCallback(() => {
    const nav = navRef.current;
    const wide = window.matchMedia('(min-width: 1024px)').matches;
    return (wide || !nav ? offset : offset + nav.getBoundingClientRect().height) + 8;
  }, [offset]);
  useEffect(() => {
    const measure = () => setOffset(stickyStackBottom(navRef.current));
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    for (const el of Array.from(document.querySelectorAll('header, nav'))) if (!navRef.current?.contains(el)) ro?.observe(el);
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, []);
  useEffect(() => {
    let frame = 0;
    const spy = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const line = threshold();
        let current = INDEX[0].id;
        for (const e of INDEX) {
          const el = document.getElementById(e.id);
          if (el && el.getBoundingClientRect().top <= line) current = e.id;
        }
        // At the very bottom the last sections may never reach the line: the last one is then in view.
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = INDEX[INDEX.length - 1].id;
        setActive(current);
      });
    };
    spy();
    window.addEventListener('scroll', spy, { passive: true });
    window.addEventListener('resize', spy);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', spy); window.removeEventListener('resize', spy); };
  }, [threshold, ts]);
  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - threshold() + 4, behavior: 'smooth' });
    setActive(id);
  };
  const scope = lineView === 'pool' ? 'Pool' : lineDisplayName(lineView);
  // The same choices as the Financial Statements tab's selector, latest last.
  const options = years.map(y => ({
    value: y.yearNumber,
    label: y.yearNumber > 0 ? `Year ${y.yearNumber} — ${yearEnd(y.calendarYear)}`
      : y.yearNumber === 0 ? `Year 0 — ${yearEnd(y.calendarYear)} (Opening)`
      : `${yearEnd(y.calendarYear)} (History)`,
  }));
  // Each file holds the statements of the view the player is on (statementsForView)
  // and is named by it. Each file is built on demand: its library (exceljs, jsPDF) is fetched on the first press, not with the page.
  const [building, setBuilding] = useState<'xlsx' | 'pdf' | null>(null);
  const download = async (kind: 'xlsx' | 'pdf') => {
    setBuilding(kind);
    try {
      const year = ts.years.at(-1) ?? gameState.setup.startingYear;
      const [bytes, type, name] = kind === 'xlsx'
        ? [await buildAnnualStatementXlsx(gameState, asOf, lineView, standings), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', statementFilename(lineView, year, 'xlsx')]
        : [await buildAnnualStatementPdf(gameState, asOf, lineView, standings), 'application/pdf', statementFilename(lineView, year, 'pdf')];
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } finally {
      setBuilding(null);
    }
  };
  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 lg:flex lg:gap-4" data-testid="annual-statement"
      style={{ ['--statement-index-offset' as string]: `${offset}px` }}>
      <StatementIndex offset={offset} active={active} onGo={go} navRef={navRef} />
      <div className="min-w-0 flex-1 bg-white text-black border border-gray-300 rounded-lg p-6 space-y-2">
        <div className="flex items-end justify-between flex-wrap gap-3 px-3">
          <div>
            <h1 className="text-lg font-semibold text-black">Annual Statement — {scope}</h1>
            <p className="text-xs text-black mt-1">Dollars in thousands. Exposure in $M; rates per $100 of exposure.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              data-testid="statement-year"
              value={String(asOf)}
              onChange={e => { const y = parseInt(e.target.value); setChosen(y === latest ? null : y); }}
              className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-black bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button
              type="button"
              data-testid="statement-download"
              onClick={() => { void download('xlsx'); }}
              disabled={building !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <Download size={16} />
              Download Annual Statement (Excel)
            </button>
            <button
              type="button"
              data-testid="statement-download-pdf"
              onClick={() => { void download('pdf'); }}
              disabled={building !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <Download size={16} />
              Download Annual Statement (PDF)
            </button>
          </div>
        </div>
        {sectionsOf(ts.rows).map(s => <SectionTable key={s.title} title={s.title} rows={s.rows} ts={ts} />)}
        <MarketSurveySection table={survey} />
        <DecisionsSection table={decisions} />
      </div>
    </div>
  );
}
