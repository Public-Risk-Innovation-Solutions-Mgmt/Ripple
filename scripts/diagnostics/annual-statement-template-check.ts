// ============================================================================
// THE ANNUAL STATEMENT AS THE TEMPLATE — THE GATE.
//
//   npx tsx scripts/diagnostics/annual-statement-template-check.ts
//
// The statement the page shows and the Excel file carries (utils/
// annualStatementTemplate, utils/annualStatementExport), on four solo three-line
// ten-world games — scenarios 1, 7 and 12 on the defaults, and STMT7 holding the
// widest T cover on every line every year so the ceded block is real — at game
// start and after each of three years, at the pool and on every line:
//
//   A. EVERY FIGURE TIES TO WHAT THE ENGINE BOOKS. Each window year is read off
//      its own result, and Prior is the sum (flows) or the last year (balances)
//      of every year before the window:
//        A1 Net Income Statement: premium = member charge − reinsurance cost;
//           losses, LAE, admin, risk control, assessments − dividends, investment
//           income, net income each the engine's; Net Underwriting Income +
//           Assessments/Dividends = the engine's underwriting income; the
//           combined ratio and the operating ratio worked from engine fields.
//        A2 Balance Sheet: invested, uninvested, the reserves and net worth the
//           engine's year-end (the opening's at year 0); Assets − Liabilities =
//           Net Worth = Paid in Capital + Earned Surplus; Reserve to Surplus =
//           (Loss + Loss Expense Reserves) / Net Worth.
//        A3 Contributions To The Current Calendar Year: summed over every column,
//           Total Net Incurred is the year's booked net loss + LAE and Written
//           Premium its net premium; per column, previously reported + newly
//           arising + the IBNR change is the total; newly arising only in the
//           current program year.
//        A4 Program years: reported = paid + case, incurred = reported + IBNR,
//           net = gross − ceded, Program Year Totals - Net = the Net block; summed
//           over every column, net case + IBNR is the balance sheet's loss and
//           loss expense reserves — the blocks meet the engine's reserves.
//        A5 Underwriting (lines): written exposure and the rate the engine's.
//   B. THE EXCEL FILE IS THE TEMPLATE CELL FOR CELL — the file a player
//      downloads, built and read back: on every sheet, every label in column B
//      and every blank row is the template's, row for row, with the template's
//      row 15 ("Profit and Contigency") removed and nothing else; the figure cells
//      are numbers in their formats; the header rows carry Prior and the five
//      years; and EVERY CELL'S BORDER, A to H on every row, is the template's —
//      each side and its style, read from the template file itself (exceljs),
//      never from the table the app draws from.
//   C. THE OPERATING RATIO BY HAND, scenario 1, WC, 2027: its parts printed and
//      the ratio recomputed from them.
//
// ⚠ AND EACH FAILS WHEN BROKEN — the controls feed A a statement with one
// figure off the engine's (premium gross of reinsurance; the operating ratio over
// the net premium; contributions measured against the same valuation; a reserve
// dropped from the blocks), and B a workbook with the removed row kept, one
// blank row dropped, one label altered, one border missing (which must fail on
// exactly that cell) and the borders left unshifted when row 15 closes up.
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { fullTowerOption } from '../../src/utils/reinsuranceOptions';
import { buildTemplateStatement, TEMPLATE_ROWS, type Figure, type TemplateStatement } from '../../src/utils/annualStatementTemplate';
import ExcelJS from 'exceljs';
import { buildAnnualStatementXlsx, STATEMENT_COLUMNS, STATEMENT_NUMBER_FORMAT } from '../../src/utils/annualStatementExport';
import type { CoverageLine, DecisionSet, GameSetupSettings, GameState, LineResultSet, LineView, ResultSet } from '../../src/types/simulation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(__dirname, '../../docs/Annual Statement Example.xlsx');
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SCOPES: LineView[] = ['pool', ...LINES];
const YEARS = 3;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

function covered(y: number): DecisionSet {
  const d = defaultDecisionSet(y);
  for (const l of LINES) d.byLine[l].reinsuranceOption = fullTowerOption(l);
  return d;
}

function playSnapshots(id: string, decide: (y: number) => DecisionSet): GameState[] {
  const { setup, instance } = openSoloInstance({ poolName: 'S', gameLength: YEARS, startingYear: 2027, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory });
  const out = [gs];
  for (let y = 1; y <= YEARS; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, decide(y)), [])), currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
    out.push(gs);
  }
  return out;
}

type Scoped = ResultSet | LineResultSet;
const at = (r: ResultSet, scope: LineView): Scoped => (scope === 'pool' ? r : r.byLine[scope]!);
const timelineOf = (gs: GameState): ResultSet[] => [...(gs.earlyPreGameHistory ?? []), ...gs.priorHistory, ...gs.lockedResults];

/** The engine's figure for each column: Prior (from the years before the window), then each window year. */
function engineColumns(gs: GameState, ts: TemplateStatement, scope: LineView) {
  const tl = timelineOf(gs);
  const firstCal = ts.years[0];
  const rolled = tl.filter(r => r.calendarYear < firstCal).map(r => at(r, scope));
  const window = ts.years.map(y => at(tl.find(r => r.calendarYear === y)!, scope));
  const windowResults = ts.years.map(y => tl.find(r => r.calendarYear === y)!);
  return { rolled, window, windowResults };
}

/** Every figure cell of a row, against what the engine books: [Prior, ...years]; Prior skipped where expected is null. */
function rowTies(name: string, got: Figure[], expected: (number | null)[], out: string[]) {
  got.forEach((g, i) => {
    const e = expected[i];
    if (e === null) return;
    if (g === null || !near(g, e)) out.push(`${name}[${i}] ${g} ≠ ${e}`);
  });
}

// ---------------------------------------------------------------------------
// A. THE TIE-OUT, as one function over a statement, so the controls can feed it a broken one.
// ---------------------------------------------------------------------------
function tieOut(gs: GameState, ts: TemplateStatement, scope: LineView): string[] {
  const out: string[] = [];
  const f = ts.figures;
  const { rolled, window, windowResults } = engineColumns(gs, ts, scope);
  const flow = (fn: (x: Scoped) => number): (number | null)[] =>
    [rolled.length ? rolled.reduce((s, x) => s + fn(x), 0) : null, ...window.map(fn)];
  const sumOf = (xs: Scoped[], fn: (x: Scoped) => number) => xs.reduce((s, x) => s + fn(x), 0);
  const ratioOf = (num: (x: Scoped) => number, den: (x: Scoped) => number): (number | null)[] =>
    [rolled.length ? sumOf(rolled, num) / sumOf(rolled, den) : null, ...window.map(x => num(x) / den(x))];

  // A1. Net Income Statement.
  const costs = (x: Scoped) => x.netIncurredLoss + x.laeIncurred + x.operatingExpense + x.riskControlInvestment + x.reinsuranceCost;
  rowTies('premium', f.premium, flow(x => x.totalMemberCharge - x.reinsuranceCost), out);
  rowTies('losses', f.losses, flow(x => x.netIncurredLoss), out);
  rowTies('lae', f.lae, flow(x => x.laeIncurred), out);
  rowTies('lossLae', f.lossLae, flow(x => x.netIncurredLoss + x.laeIncurred), out);
  rowTies('admin', f.admin, flow(x => x.operatingExpense), out);
  rowTies('riskControl', f.riskControl, flow(x => x.riskControlInvestment), out);
  rowTies('assessDiv', f.assessDiv, flow(x => x.assessments - x.dividends), out);
  rowTies('investment', f.investment, flow(x => x.investmentIncome), out);
  rowTies('netIncome', f.netIncome, flow(x => x.netIncome), out);
  rowTies('nui + assessDiv', f.nui.map((x, i) => (x === null || f.assessDiv[i] === null ? null : x + f.assessDiv[i]!)), flow(x => x.underwritingIncome), out);
  rowTies('combinedRatio', f.combinedRatio, ratioOf(costs, x => x.totalMemberCharge), out);
  rowTies('operatingRatio', f.operatingRatio, ratioOf(x => costs(x) - x.investmentIncome, x => x.totalMemberCharge), out);

  // A2. Balance sheet: each window year's year-end; year 0's is the opening — year 1's beginning, or the pool state before it.
  const pos = (r: ResultSet) => {
    if (r.yearNumber !== 0) {
      const x = at(r, scope);
      return { invested: x.endingInvestments, cash: x.endingCash, lossRes: x.endingNetReserve, laeRes: x.endingLaeReserve ?? 0, surplus: x.endingSurplus };
    }
    const y1 = gs.lockedResults[0];
    if (y1) {
      const x = at(y1, scope);
      return { invested: x.beginningInvestments, cash: x.beginningCash, lossRes: x.beginningNetReserve, laeRes: x.beginningLaeReserve ?? 0, surplus: x.beginingSurplus };
    }
    return null; // before year 1 the opening is the pool state itself — held by results-statement-check (12).
  };
  windowResults.forEach((r, j) => {
    const p = pos(r); const i = j + 1;
    if (!p) return;
    for (const [k, v] of [['invested', p.invested], ['uninvested', p.cash], ['lossRes', p.lossRes], ['laeRes', p.laeRes], ['netWorth', p.surplus]] as const) {
      if (f[k][i] === null || !near(f[k][i]!, v)) out.push(`${k}[${i}] ${f[k][i]} ≠ ${v}`);
    }
  });
  f.assets.forEach((a, i) => {
    if (a === null || f.liabilities[i] === null || f.netWorth[i] === null) return;
    if (!near(a - f.liabilities[i]!, f.netWorth[i]!)) out.push(`assets − liabilities ≠ net worth [${i}]`);
    if (!near(f.paidIn[i]! + f.earned[i]!, f.netWorth[i]!)) out.push(`paid in + earned ≠ net worth [${i}]`);
    if (!near(f.resToSurplus[i]!, (f.lossRes[i]! + f.laeRes[i]!) / f.netWorth[i]!)) out.push(`reserve to surplus [${i}]`);
  });

  // A3. Contributions to the current calendar year.
  const last = ts.figures.premium.length - 1;
  const sum = (xs: Figure[]) => (xs.some(x => x === null) ? NaN : xs.reduce<number>((s, x) => s + x!, 0));
  if (timelineOf(gs).length >= 2) {
    const booked = window[window.length - 1];
    if (!near(sum(f['cy.incurred']), booked.netIncurredLoss + booked.laeIncurred)) out.push(`Σ Total Net Incurred ${sum(f['cy.incurred'])} ≠ booked ${booked.netIncurredLoss + booked.laeIncurred}`);
    if (!near(sum(f['cy.premium']), booked.totalMemberCharge - booked.reinsuranceCost)) out.push('Σ contributions Written Premium ≠ the year\'s net premium');
    f['cy.incurred'].forEach((x, i) => {
      const parts = f['cy.prev.reported'][i]! + f['cy.new.reported'][i]! + f['cy.ibnr'][i]!;
      if (!near(x!, parts)) out.push(`contributions don't foot [${i}]`);
      if (i !== last && (f['cy.new.paid'][i] !== 0 || f['cy.new.case'][i] !== 0)) out.push(`newly arising outside the current program year [${i}]`);
      if (i === last && (f['cy.prev.paid'][i] !== 0 || f['cy.prev.case'][i] !== 0)) out.push('previously reported in the current program year');
    });
  }

  // A4. Program years.
  for (const k of ['py', 'gross', 'ceded', 'net']) {
    f[`${k}.reported`].forEach((x, i) => {
      if (!near(x!, f[`${k}.paid`][i]! + f[`${k}.case`][i]!)) out.push(`${k} reported ≠ paid + case [${i}]`);
      if (!near(f[`${k}.incurred`][i]!, x! + f[`${k}.ibnr`][i]!)) out.push(`${k} incurred ≠ reported + IBNR [${i}]`);
    });
  }
  for (const r of ['premium', 'paid', 'case', 'ibnr', 'incurred']) {
    f[`net.${r}`].forEach((x, i) => {
      if (x === null) return;
      if (!near(x, f[`gross.${r}`][i]! - f[`ceded.${r}`][i]!)) out.push(`net ≠ gross − ceded: ${r} [${i}]`);
      if (!near(x, f[`py.${r}`][i]!)) out.push(`Program Year Totals - Net ≠ Net: ${r} [${i}]`);
    });
  }
  const reserves = sum(f['net.case']) + sum(f['net.ibnr']);
  if (!near(reserves, f.lossRes[last]! + f.laeRes[last]!)) out.push(`Σ net case + IBNR ${reserves} ≠ loss + loss expense reserves ${f.lossRes[last]! + f.laeRes[last]!}`);

  // A5. Underwriting, on a line (the pool's exposure has no sum and shows —).
  if (scope !== 'pool') {
    rowTies('exposure', f.exposure, [null, ...window.map(x => x.writtenExposure)], out);
    const rate = (x: Scoped) => (x as LineResultSet).finalRatePer100 ?? (x as LineResultSet).ratePer100;
    rowTies('rate', f.rate, [null, ...window.map(rate)], out);
  } else if (f.exposure.some(x => x !== null)) out.push('pool exposure shows a figure');
  return out;
}

const games: { id: string; snaps: GameState[] }[] = [
  ...['1', '7', '12'].map(id => ({ id, snaps: playSnapshots(id, defaultDecisionSet) })),
  { id: 'STMT7 (covered)', snaps: playSnapshots('STMT7', covered) },
];

console.log('\nA. every figure ties to what the engine books');
let statements = 0;
const tieFails: string[] = [];
let ceded = 0;
for (const g of games) for (const [y, gs] of g.snaps.entries()) for (const scope of SCOPES) {
  const ts = buildTemplateStatement(gs, scope);
  statements++;
  ceded += Math.abs(ts.figures['ceded.incurred'].reduce<number>((s, x) => s + (x ?? 0), 0));
  for (const e of tieOut(gs, ts, scope)) tieFails.push(`${g.id} after ${y} ${scope}: ${e}`);
}
check(tieFails.length === 0, `A. ${statements} statements tie to the engine (4 games × 4 points × 4 scopes)`, tieFails.slice(0, 3).join(' · '));
check(ceded > 0, 'A. the covered game cedes, so the ceded block is exercised', `Σ |ceded incurred| ${ceded.toFixed(0)}`);

// The controls: each a statement with one figure off the engine's, on the covered
// game after two years, where the reinsurance cost is real.
const g1 = games[3].snaps[2];
const clone = (ts: TemplateStatement): TemplateStatement => ({ ...ts, figures: Object.fromEntries(Object.entries(ts.figures).map(([k, v]) => [k, [...v]])) });
const controls: { name: string; breakIt: (ts: TemplateStatement, gs: GameState, scope: LineView) => void }[] = [
  { name: 'premium gross of reinsurance', breakIt: (ts, gs, scope) => { ts.figures.premium[5] = at(gs.lockedResults.at(-1)!, scope).totalMemberCharge; } },
  { name: 'operating ratio over the net premium', breakIt: (ts, gs, scope) => {
    const x = at(gs.lockedResults.at(-1)!, scope);
    ts.figures.operatingRatio[5] = (x.netIncurredLoss + x.laeIncurred + x.operatingExpense + x.riskControlInvestment + x.reinsuranceCost - x.investmentIncome)
      / (x.totalMemberCharge - x.reinsuranceCost);
  } },
  { name: 'contributions against the same valuation', breakIt: ts => { for (const k of ['cy.prev.paid', 'cy.prev.case', 'cy.prev.reported', 'cy.new.paid', 'cy.new.case', 'cy.new.reported', 'cy.ibnr', 'cy.incurred']) ts.figures[k] = ts.figures[k].map(() => 0); } },
  { name: 'a reserve dropped from the blocks', breakIt: ts => { for (const k of ['py', 'gross', 'net']) { ts.figures[`${k}.ibnr`][1] = 0; ts.figures[`${k}.incurred`][1] = ts.figures[`${k}.reported`][1]; } } },
];
for (const c of controls) {
  const ts = clone(buildTemplateStatement(g1, 'WC'));
  c.breakIt(ts, g1, 'WC');
  const errs = tieOut(g1, ts, 'WC');
  check(errs.length > 0, `A control — ${c.name}: the tie-out fails`, errs[0] ?? 'NOTHING FIRED');
}

// ---------------------------------------------------------------------------
// B. The Excel file against the template: labels, blank rows and borders.
// ---------------------------------------------------------------------------
console.log('\nB. the Excel file is the template cell for cell, borders included, less "Profit and Contigency"');
const tpl = XLSX.read(fs.readFileSync(TEMPLATE), { type: 'buffer' });
const tws = tpl.Sheets[tpl.SheetNames[0]];
const tRange = XLSX.utils.decode_range(tws['!ref']!);
const cellOf = (ws: XLSX.WorkSheet, r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
const labelAt = (ws: XLSX.WorkSheet, r: number) => { const c = cellOf(ws, r, 1); return c && c.v !== undefined && c.v !== '' ? String(c.v) : null; };
const blankAt = (ws: XLSX.WorkSheet, r: number) => [1, 2, 3, 4, 5, 6, 7].every(c => { const x = cellOf(ws, r, c); return !x || x.v === undefined || x.v === ''; });
const REMOVED = 14; // template row 15, zero-based
check(labelAt(tws, REMOVED) === 'Profit and Contigency', 'B. the template\'s row 15 is "Profit and Contigency" — the one row removed', String(labelAt(tws, REMOVED)));
/** The template's rows as the statement keeps them: every row through its last (157, which carries the Net block's closing line), row 15 removed. */
const expectedRows = Array.from({ length: tRange.e.r + 1 }, (_, r) => r).filter(r => r !== REMOVED);
check(TEMPLATE_ROWS.length === expectedRows.length, `B. the statement has the template's rows less one: ${TEMPLATE_ROWS.length} of ${tRange.e.r + 1}`);

function layoutDiffs(ws: XLSX.WorkSheet, ts: TemplateStatement): string[] {
  const out: string[] = [];
  const range = XLSX.utils.decode_range(ws['!ref']!);
  if (range.e.r + 1 !== expectedRows.length) out.push(`${range.e.r + 1} rows, template ${expectedRows.length}`);
  expectedRows.forEach((tr, r) => {
    if (labelAt(ws, r) !== labelAt(tws, tr)) out.push(`row ${r + 1}: "${labelAt(ws, r)}" ≠ template row ${tr + 1} "${labelAt(tws, tr)}"`);
    if (blankAt(ws, r) !== blankAt(tws, tr)) out.push(`row ${r + 1}: ${blankAt(ws, r) ? 'blank' : 'not blank'}, template row ${tr + 1} ${blankAt(tws, tr) ? 'blank' : 'not blank'}`);
  });
  TEMPLATE_ROWS.forEach((row, r) => {
    if (row.kind === 'header') {
      if (cellOf(ws, r, 2)?.v !== 'Prior') out.push(`row ${r + 1}: no Prior`);
      ts.years.forEach((_, i) => { if (cellOf(ws, r, 3 + i)?.t !== 'n') out.push(`row ${r + 1}: year ${i} not a number or date`); });
    }
    if (row.kind === 'figure') ts.figures[row.key].forEach((x, i) => {
      const c = cellOf(ws, r, 2 + i);
      if (x !== null && c?.t !== 'n') out.push(`row ${r + 1} col ${i}: a figure stored as ${c?.t}`);
      if (x === null && c?.v !== '—') out.push(`row ${r + 1} col ${i}: no figure, not "—"`);
      if (x !== null && c?.z !== STATEMENT_NUMBER_FORMAT[row.format]) out.push(`row ${r + 1} col ${i}: format ${c?.z}`);
    });
  });
  return out;
}

// BORDERS — read from the template file itself with exceljs, never from the
// generated table the app draws from, so a stale table fails here.
type BorderSheet = { getCell(r: number, c: number): { border?: Partial<Record<'left' | 'right' | 'top' | 'bottom', { style?: string }>> } };
const sidesOf = (ws: BorderSheet, r: number, c: number) => {
  const b = ws.getCell(r, c).border ?? {};
  return (['left', 'right', 'top', 'bottom'] as const).map(k => (b[k]?.style ? `${k[0].toUpperCase()}:${b[k]!.style}` : '')).join('');
};
const texcel = new ExcelJS.Workbook();
await texcel.xlsx.readFile(TEMPLATE);
const tBorders = texcel.worksheets[0];
let templateLines = 0;
for (const tr of expectedRows) for (let c = 1; c <= STATEMENT_COLUMNS; c++) templateLines += sidesOf(tBorders, tr + 1, c).split(':').length - 1;
check(templateLines > 0, 'B. the template draws borders to compare against', `${templateLines} cell sides`);
check(sidesOf(tBorders, REMOVED + 1, 2) === 'L:thinR:thin', 'B. the removed row carries only its vertical lines — nothing closes on it', sidesOf(tBorders, REMOVED + 1, 2));

/** Every cell, A to H on every statement row, whose border is not the template's row for row (row 15 removed). */
function borderDiffs(ws: BorderSheet): string[] {
  const out: string[] = [];
  expectedRows.forEach((tr, r) => {
    for (let c = 1; c <= STATEMENT_COLUMNS; c++) {
      const want = sidesOf(tBorders, tr + 1, c), got = sidesOf(ws, r + 1, c);
      if (want !== got) out.push(`${String.fromCharCode(64 + c)}${r + 1}: "${got}" ≠ template ${String.fromCharCode(64 + c)}${tr + 1} "${want}"`);
    }
  });
  return out;
}

for (const g of [games[0], games[3]]) for (const gs of [g.snaps[0], g.snaps[YEARS]]) {
  // THE FILE a player downloads, read back two ways: SheetJS for values and formats, exceljs for borders.
  const bytes = await buildAnnualStatementXlsx(gs);
  const wb = XLSX.read(new Uint8Array(bytes), { type: 'array', cellNF: true });
  const ex = new ExcelJS.Workbook();
  await ex.xlsx.load(bytes);
  const tag = `${g.id}, year ${gs.lockedResults.length}`;
  check(wb.SheetNames.join(',') === 'Pool,WC,GL,Property', `B. ${tag}: a sheet for the pool and one per line`, wb.SheetNames.join(','));
  const diffs = wb.SheetNames.flatMap((s, i) => layoutDiffs(wb.Sheets[s], buildTemplateStatement(gs, SCOPES[i])).map(d => `${s} ${d}`));
  check(diffs.length === 0, `B. ${tag}: every sheet matches the template label for label and blank for blank (${expectedRows.length} rows), figures numbers in their formats`, diffs.slice(0, 3).join(' · '));
  const bdiffs = ex.worksheets.flatMap(ws => borderDiffs(ws).map(d => `${ws.name} ${d}`));
  check(bdiffs.length === 0, `B. ${tag}: every sheet's borders are the template's, cell for cell (A–H × ${expectedRows.length} rows, ${templateLines} sides a sheet)`, bdiffs.slice(0, 3).join(' · '));
}

// The controls. Layout: the removed row kept, a blank row dropped, a label altered.
// Borders: one line missing, and the lines left where they were when row 15 closed up.
{
  const ts = buildTemplateStatement(g1, 'WC');
  const bytes = await buildAnnualStatementXlsx(g1);
  const base = XLSX.read(new Uint8Array(bytes), { type: 'array', cellNF: true }).Sheets.WC;
  const shifted = (rows: number[]) => {
    const out: XLSX.WorkSheet = {};
    rows.forEach((src, dst) => { for (let c = 0; c < 8; c++) { const x = cellOf(base, src, c); if (x) out[XLSX.utils.encode_cell({ r: dst, c })] = x; } });
    out['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: 7 } });
    return out;
  };
  const all = TEMPLATE_ROWS.map((_, r) => r);
  // "Profit and Contigency" put back at row 15 and the rest pushed down a row.
  const withRow = shifted([...all.slice(0, 14), -1, ...all.slice(14)]);
  withRow[XLSX.utils.encode_cell({ r: 14, c: 1 })] = { t: 's', v: 'Profit and Contigency' };
  check(layoutDiffs(withRow, ts).length > 0, 'B control — the removed row kept: the layout check fails');
  const dropped = shifted(all.filter(r => r !== 29));
  check(layoutDiffs(dropped, ts).length > 0, 'B control — one blank row dropped: the layout check fails', layoutDiffs(dropped, ts)[0]);
  const altered = shifted(all);
  altered[XLSX.utils.encode_cell({ r: 38, c: 1 })] = { t: 's', v: 'Invested' };
  check(layoutDiffs(altered, ts).length > 0, 'B control — a label altered ("      Invested" → "Invested"): the layout check fails', layoutDiffs(altered, ts)[0]);

  // One line missing: the bottom line that closes the Net Income Statement (statement row 29, template 30), on H.
  const ex = new ExcelJS.Workbook();
  await ex.xlsx.load(bytes);
  const ws = ex.getWorksheet('WC')!;
  // ⚠ ITS OWN STYLE OBJECT: exceljs shares one style among every loaded cell that
  // had the same style, so setting this cell's border in place would take the
  // closing line off every section at once (it did, the first time).
  const h29 = ws.getCell(29, 8);
  const rest = { ...(h29.border ?? {}) };
  delete rest.bottom;
  h29.style = { ...h29.style, border: rest };
  const missing = borderDiffs(ws);
  check(missing.length === 1, 'B control — one border missing (H29\'s closing line): the border check fails, on exactly that cell', missing.join(' · ') || 'NOTHING FIRED');
  // Not closed up: every row's lines taken from the template row of the SAME number, as if row 15 were still there.
  const stale: BorderSheet = { getCell: (r, c) => tBorders.getCell(r, c) };
  const notClosed = borderDiffs(stale);
  check(notClosed.length > 0, 'B control — the borders left in place when row 15 closes up: the border check fails', `${notClosed.length} cells, first ${notClosed[0]}`);
}

// ---------------------------------------------------------------------------
// C. The operating ratio by hand: scenario 1, WC, 2027.
// ---------------------------------------------------------------------------
console.log('\nC. the operating ratio by hand — scenario 1, WC, 2027');
{
  const gs = games[0].snaps[1];
  const r = gs.lockedResults.find(x => x.calendarYear === 2027)!.byLine.WC!;
  const ts = buildTemplateStatement(gs, 'WC');
  const i = ts.years.indexOf(2027) + 1;
  const parts = {
    'net incurred losses': r.netIncurredLoss, 'LAE': r.laeIncurred, 'admin': r.operatingExpense,
    'risk control': r.riskControlInvestment, 'reinsurance cost': r.reinsuranceCost, 'investment income': r.investmentIncome,
    'member charge': r.totalMemberCharge,
  };
  for (const [k, v] of Object.entries(parts)) console.log(`        ${k.padEnd(22)} ${v.toFixed(2).padStart(16)}`);
  const hand = (r.netIncurredLoss + r.laeIncurred + r.operatingExpense + r.riskControlInvestment + r.reinsuranceCost - r.investmentIncome) / r.totalMemberCharge;
  console.log(`        (losses + LAE + admin + risk control + reinsurance − investment) ÷ member charge = ${(hand * 100).toFixed(4)}%`);
  check(ts.years.includes(2027) && near(ts.figures.operatingRatio[i]!, hand), 'C. the statement\'s 2027 WC operating ratio is the hand computation', `${(ts.figures.operatingRatio[i]! * 100).toFixed(4)}%`);
}

console.log(failures.length === 0 ? '\nANNUAL STATEMENT TEMPLATE PASS' : `\nFAIL — ${failures.length}: ${failures.join('; ')}`);
process.exitCode = failures.length === 0 ? 0 : 1;
