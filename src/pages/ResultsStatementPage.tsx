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

interface Props {
  gameState: GameState;
  lineView: LineView;
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
const BLOCK_ID: Record<string, string> = { Gross: 'statement-gross', Ceded: 'statement-ceded', Net: 'statement-net' };

/** A statement row and its index in TEMPLATE_ROWS — the index is its row in the file, and its borders. */
interface At { row: TemplateRow; i: number }

/** The template's rows, cut at each title: [title, rows under it]. Row 1, above the first title, carries no line. */
function sections(): { title: string; rows: At[] }[] {
  const out: { title: string; rows: At[] }[] = [];
  TEMPLATE_ROWS.forEach((row, i) => {
    if (row.kind === 'title') out.push({ title: row.label.trim(), rows: [] });
    else if (out.length > 0) out[out.length - 1].rows.push({ row, i });
  });
  return out;
}
const SECTIONS = sections();

const yearEnd = (calendarYear: number) => `12/31/${String(calendarYear % 100).padStart(2, '0')}`;
/** The template indents a sub-item by leading spaces; the screen indents it. */
const indented = (label: string) => /^\s/.test(label);

/**
 * A cell's lines, as the statement draws them: column c (B = 1 … H = 7, I = 8) of
 * row i (cellBorders, which takes A = 1). The tables collapse their borders, so a
 * line two neighbours both carry is one line, as in Excel.
 */
const LINE = '1px solid #000';
function edges(i: number, c: number): CSSProperties {
  const s = cellBorders(i, c + 1);
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
          {Array.from({ length: 1 + cols }, (_, c) => <td key={c} className="h-5" style={edges(i, c + 1)} />)}
        </tr>
      );
    case 'header':
      return (
        <tr data-row-kind="header" {...data}>
          {/* The Reinsurance blocks' names — Gross, Ceded, Net — sit on the left, in bold. */}
          <th className={`px-3 py-1 ${isBlockName(row.label) ? 'text-left font-bold' : 'text-right font-semibold'} text-black whitespace-pre`} style={edges(i, 1)}>{row.label.trim()}</th>
          {ts.columns.map((c, k) => (
            <th key={c} className="px-3 py-1 text-center font-semibold text-black whitespace-nowrap" style={edges(i, k + 2)}>
              {k === 0 ? (showsPrior(i) ? c : '') : row.dates ? yearEnd(ts.years[k - 1]) : c}
            </th>
          ))}
          <th className="px-3 py-1 text-center font-semibold text-black whitespace-nowrap" style={edges(i, ay)}>{row.allYears ? ALL_YEARS_LABEL : ''}</th>
        </tr>
      );
    case 'heading':
      return (
        <tr data-row-kind="heading" {...data}>
          <td className="px-3 py-1 text-black whitespace-nowrap" style={edges(i, 1)}>{row.label.trim()}</td>
          {Array.from({ length: cols }, (_, k) => <td key={k} style={edges(i, k + 2)} />)}
        </tr>
      );
    case 'figure': {
      return (
        <tr data-row-label={row.label.trim()} data-row-key={row.key} {...data}>
          <td className={`px-3 py-1 text-black ${indented(row.label) ? 'pl-10' : ''}`} style={edges(i, 1)}>{row.label.trim()}</td>
          {ts.figures[row.key].map((_, k) => {
            // Blank where the statement shows nothing (shownFigure): Prior in the
            // first three sections, the first year's change in Underwriting.
            const x = shownFigure(row, i, k, ts);
            // Red by the figure AS SHOWN: a few cents below zero shows 0, in black.
            const text = x === undefined ? '' : figureText(x, row.format);
            return (
              <td key={k} className={`px-3 py-1 text-right tabular-nums whitespace-nowrap ${text.startsWith('−') ? 'text-red-600' : 'text-black'}`} style={edges(i, k + 2)}>
                {text}
              </td>
            );
          })}
          <AllYearsCell row={row} i={i} ts={ts} style={edges(i, ay)} />
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

/** The index's entries: every section of the statement, in order, then Decisions. */
const INDEX: { id: string; title: string }[] = [
  ...SECTIONS.map(s => ({ id: SECTION_ID[s.title], title: s.title })),
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

export default function ResultsStatementPage({ gameState, lineView }: Props) {
  // The year the statement stands at; null follows the latest year as the game moves on.
  const [chosen, setChosen] = useState<number | null>(null);
  const years = useMemo(() => statementYears(gameState), [gameState]);
  const latest = years.at(-1)?.yearNumber ?? 0;
  const asOf = chosen !== null && years.some(y => y.yearNumber === chosen) ? chosen : latest;
  const ts = useMemo(() => buildTemplateStatement(gameState, lineView, asOf), [gameState, lineView, asOf]);
  const decisions = useMemo(() => buildDecisionsTable(gameState, ts), [gameState, ts]);

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
        ? [await buildAnnualStatementXlsx(gameState, asOf, lineView), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', statementFilename(lineView, year, 'xlsx')]
        : [await buildAnnualStatementPdf(gameState, asOf, lineView), 'application/pdf', statementFilename(lineView, year, 'pdf')];
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
        {SECTIONS.map(s => <SectionTable key={s.title} title={s.title} rows={s.rows} ts={ts} />)}
        <DecisionsSection table={decisions} />
      </div>
    </div>
  );
}
