// ============================================================================
// THE ANNUAL STATEMENT AS A PDF — THE GATE.
//
//   npx tsx scripts/diagnostics/annual-statement-pdf-check.ts
//
// The PDF a player downloads (utils/annualStatementPdf), built and READ BACK
// with pdf.js, page by page, on solo games — scenario 1 at game start and after
// three years, STMT7 with the widest cover after two, scenario 1 with Mid adverse
// development after three and as of year 1, and a WC+GL pool — against each
// statement's own figures (buildTemplateStatement), never the PDF module's:
//
//   · EVERY SHEET, IN THE WORKBOOK'S ORDER: one statement per sheet, the pool's
//     then each line's, each starting on a new page, every page's header naming
//     the pool, the line and the year the statement stands at, every footer
//     "Page n of N", every page landscape Letter.
//   · THE TEXT IS THE STATEMENT'S: read off the page by position into rows and
//     the eight columns B to I, every non-blank row in order — each title,
//     heading and label; the header rows' Prior (only where the section shows
//     it), years or year-ends and All Years; every figure as the page writes it
//     (figureText, "-" for "−"), blank where the statement shows a blank, and the
//     All Years totals.
//   · NEGATIVES IN RED, AND ONLY THEM: every text run's fill colour, read from
//     the page's drawing operators.
//
// ⚠ AND EACH FAILS WHEN BROKEN: a PDF built from a statement with one figure
// off, one with a sheet left out, and one with negatives drawn black must each
// fail the check.
// ============================================================================

import * as path from 'path';
import { createRequire } from 'module';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { fullTowerOption } from '../../src/utils/reinsuranceOptions';
import {
  ALL_YEARS_LABEL, allYearsCell, figureText, showsPrior, shownFigure, templateStatements, TEMPLATE_ROWS, type TemplateStatement,
} from '../../src/utils/annualStatementTemplate';
import { buildAnnualStatementPdf, buildStatementsPdf } from '../../src/utils/annualStatementPdf';
import type { CoverageLine, DecisionSet, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
/** pdf.js's own metrics for the standard fonts (Helvetica), so it reads the file without warnings. */
const STANDARD_FONTS = path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
const POOL = 'Harbour Mutual';
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

function play(id: string, years: number, opts: { lines?: CoverageLine[]; development?: GameSetupSettings['developmentLevels']; covered?: boolean } = {}): GameState {
  const lines = opts.lines ?? LINES;
  const { setup, instance } = openSoloInstance({ poolName: POOL, gameLength: 3, startingYear: 2027, instanceId: id, activeLines: lines,
    ...(opts.development ? { developmentLevels: opts.development } : {}) } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory });
  const decide = (y: number): DecisionSet => {
    const d = defaultDecisionSet(y);
    if (opts.covered) for (const l of lines) d.byLine[l].reinsuranceOption = fullTowerOption(l);
    return d;
  };
  for (let y = 1; y <= years; y++) gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, decide(y)), [])), currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
  return gs;
}

// ---------------------------------------------------------------------------
// Reading the PDF back.
// ---------------------------------------------------------------------------
/** Column bounds on the page, B then C to I (points from the left): the layout's, as the reader must know it. */
const COL_LEFT = [30, 258, 330, 402, 474, 546, 618, 690], COL_RIGHT = 762;
const columnOf = (cx: number) => { for (let c = COL_LEFT.length - 1; c >= 0; c--) if (cx >= COL_LEFT[c]) return cx <= COL_RIGHT ? c : -1; return -1; };
interface Page { width: number; height: number; header: string; footer: string; rows: string[][]; runs: { text: string; rgb: string }[] }

async function readPdf(bytes: ArrayBuffer): Promise<Page[]> {
  const doc = await getDocument({ data: new Uint8Array(bytes.slice(0)), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl: STANDARD_FONTS }).promise;
  const pages: Page[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const items = (await page.getTextContent()).items.filter((x): x is TextItem => 'str' in x && x.str.trim() !== '');
    // Header (top band), footer (bottom band), and the table's rows by baseline, top first.
    const fromTop = (it: { transform: number[] }) => vp.height - it.transform[5];
    const header = items.filter(it => fromTop(it) < 34).sort((a, b) => a.transform[4] - b.transform[4]).map(it => it.str).join(' | ');
    const footer = items.filter(it => fromTop(it) > vp.height - 30).map(it => it.str).join(' ');
    const body = items.filter(it => fromTop(it) >= 34 && fromTop(it) <= vp.height - 30);
    const ys = [...new Set(body.map(it => Math.round(fromTop(it) * 10) / 10))].sort((a, b) => a - b);
    const rows = ys.map(y => {
      const cells = Array.from({ length: 8 }, () => '');
      for (const it of body.filter(x => Math.round(fromTop(x) * 10) / 10 === y)) {
        const c = columnOf(it.transform[4] + it.width / 2);
        cells[c < 0 ? 0 : c] += (cells[c < 0 ? 0 : c] ? ' ' : '') + it.str.trim();
      }
      return cells;
    });
    // Each text run's fill colour, from the drawing operators.
    const ops = await page.getOperatorList();
    let rgb = '#000000';
    const runs: { text: string; rgb: string }[] = [];
    ops.fnArray.forEach((fn, k) => {
      const args = ops.argsArray[k] as unknown[];
      if (fn === OPS.setFillRGBColor) rgb = typeof args[0] === 'string' ? (args[0] as string) : `#${(args as number[]).slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
      if (fn === OPS.showText) {
        const text = (args[0] as ({ unicode?: string } | number)[]).map(g => (typeof g === 'object' && g ? g.unicode ?? '' : '')).join('');
        if (text.trim()) runs.push({ text: text.trim(), rgb });
      }
    });
    pages.push({ width: vp.width, height: vp.height, header, footer, rows, runs });
  }
  return pages;
}

// ---------------------------------------------------------------------------
// What each statement must read, row by row — from the statement, not the PDF module.
// ---------------------------------------------------------------------------
const dash = (s: string) => s.replace(/−/g, '-');
const yearEnd = (y: number) => `12/31/${String(y % 100).padStart(2, '0')}`;
function expectedRows(ts: TemplateStatement): string[][] {
  const out: string[][] = [];
  TEMPLATE_ROWS.forEach((row, i) => {
    if (row.kind === 'blank') return;
    const cells = [row.label.trim(), '', '', '', '', '', '', ''];
    if (row.kind === 'header') {
      cells[1] = showsPrior(i) ? 'Prior' : '';
      ts.years.forEach((y, k) => { cells[2 + k] = row.dates ? yearEnd(y) : String(y); });
      cells[7] = row.allYears ? ALL_YEARS_LABEL : '';
    }
    if (row.kind === 'figure') {
      for (let k = 0; k < 6; k++) { const x = shownFigure(row, i, k, ts); cells[1 + k] = x === undefined ? '' : dash(figureText(x, row.format)); }
      const t = allYearsCell(row, i, ts);
      cells[7] = t === undefined ? '' : dash(figureText(t, row.format));
    }
    out.push(cells);
  });
  return out;
}
const RED = '#dc2626';

/** Every way the PDF differs from the statements it should carry. */
async function pdfDiffs(bytes: ArrayBuffer, statements: TemplateStatement[]): Promise<string[]> {
  const out: string[] = [];
  const pages = await readPdf(bytes);
  pages.forEach((p, k) => {
    if (p.width !== 792 || p.height !== 612) out.push(`page ${k + 1}: ${p.width}x${p.height}, not landscape Letter`);
    if (p.footer !== `Page ${k + 1} of ${pages.length}`) out.push(`page ${k + 1}: footer "${p.footer}"`);
  });
  // Pages by statement, in order, each statement's pages consecutive and opening with its first title.
  let at = 0;
  for (const ts of statements) {
    const head = `${POOL} - ${ts.scopeName} - Annual Statement as of 12/31/${ts.years.at(-1)} | Dollars in thousands. Exposure in $M; rates per $100 of exposure.`;
    const mine: Page[] = [];
    while (at < pages.length && pages[at].header === head) mine.push(pages[at++]);
    if (mine.length === 0) { out.push(`${ts.scopeName}: no page with its header (next page reads "${pages[at]?.header ?? 'nothing'}")`); continue; }
    const got = mine.flatMap(p => p.rows), want = expectedRows(ts);
    if (got.length !== want.length) out.push(`${ts.scopeName}: ${got.length} rows on its pages, the statement has ${want.length}`);
    want.forEach((w, r) => {
      const g = got[r];
      if (!g) return;
      w.forEach((cell, c) => { if (g[c] !== cell) out.push(`${ts.scopeName} row ${r + 1} (${w[0]}) col ${'BCDEFGHI'[c]}: "${g[c]}" ≠ "${cell}"`); });
    });
    if (mine[0].rows[0]?.[0] !== want[0][0]) out.push(`${ts.scopeName}: does not open its own page with "${want[0][0]}"`);
    // Colour: in the table, a figure is red exactly when it is negative.
    const figures = new Set(want.flatMap(w => w.slice(1)).filter(x => /^-?[\d.,]+%?$/.test(x)));
    for (const p of mine) for (const run of p.runs) {
      if (!figures.has(run.text)) continue;
      const neg = run.text.startsWith('-');
      if (neg !== (run.rgb.toLowerCase() === RED)) out.push(`${ts.scopeName}: "${run.text}" drawn ${run.rgb}, ${neg ? 'a negative not red' : 'red but not negative'}`);
    }
  }
  if (at !== pages.length) out.push(`${pages.length - at} page(s) after the last statement`);
  return out;
}

// ---------------------------------------------------------------------------
console.log('\nthe Annual Statement PDF against the statements');
const games: { name: string; gs: GameState; asOf?: number }[] = [
  { name: 'scenario 1, game start', gs: play('1', 0) },
  { name: 'scenario 1, after three years', gs: play('1', 3) },
  { name: 'STMT7 covered, after two years', gs: play('STMT7', 2, { covered: true }) },
  { name: 'scenario 1 Mid development, after three years', gs: play('1', 3, { development: { WC: 'Mid', GL: 'Mid', Property: 'Mid' } }) },
  { name: 'scenario 1 Mid development, as of year 1', gs: play('1', 3, { development: { WC: 'Mid', GL: 'Mid', Property: 'Mid' } }), asOf: 1 },
  { name: 'scenario 1 WC+GL, after two years', gs: play('1', 2, { lines: ['WC', 'GL'] }) },
];
let negatives = 0;
for (const g of games) {
  const statements = templateStatements(g.gs, g.asOf);
  const bytes = await buildAnnualStatementPdf(g.gs, g.asOf);
  const pages = await readPdf(bytes);
  const diffs = await pdfDiffs(bytes, statements);
  negatives += pages.flatMap(p => p.runs).filter(r => r.rgb.toLowerCase() === RED).length;
  check(diffs.length === 0, `${g.name}: ${statements.length} sheets (${statements.map(s => s.scopeName).join(', ')}) on ${pages.length} pages, every row and figure the statement's, negatives red`, diffs.slice(0, 3).join(' · '));
}
check(negatives > 0, 'the colour check is exercised: negatives are drawn', `${negatives} red figures`);

console.log('\ncontrols');
{
  const gs = games[1].gs;
  const statements = templateStatements(gs);
  // One figure off: one column of WC's Contributions Total Net Incurred.
  const off = statements.map(ts => ({ ...ts, figures: Object.fromEntries(Object.entries(ts.figures).map(([k, v]) => [k, [...v]])) }));
  off[1].figures['cy.incurred'][3] = (off[1].figures['cy.incurred'][3] ?? 0) + 7_000;
  const e1 = await pdfDiffs(await buildStatementsPdf(off, POOL), statements);
  check(e1.length > 0, 'control — one figure off (WC, Contributions\' Total Net Incurred): the check fails', e1[0] ?? 'NOTHING FIRED');
  const e2 = await pdfDiffs(await buildStatementsPdf(statements.filter(s => s.scope !== 'GL'), POOL), statements);
  check(e2.length > 0, 'control — a sheet left out (GL): the check fails', e2[0] ?? 'NOTHING FIRED');
  const e3 = await pdfDiffs(await buildStatementsPdf(statements, POOL, { negativeRgb: [0, 0, 0] }), statements);
  check(e3.length > 0 && e3.every(e => / drawn /.test(e)), 'control — negatives drawn black: the check fails, on colour alone', e3[0] ?? 'NOTHING FIRED');
}

console.log(failures.length === 0 ? '\nANNUAL STATEMENT PDF PASS' : `\nFAIL — ${failures.length}: ${failures.join('; ')}`);
process.exitCode = failures.length === 0 ? 0 : 1;
