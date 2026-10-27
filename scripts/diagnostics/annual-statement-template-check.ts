// ============================================================================
// THE ANNUAL STATEMENT AS THE TEMPLATE — THE GATE.
//
//   npx tsx scripts/diagnostics/annual-statement-template-check.ts
//
// The statement the page shows and the Excel file carries (utils/
// annualStatementTemplate, utils/annualStatementExport), on six solo ten-world
// games — scenarios 1, 7 and 12 on the defaults; STMT7 holding the widest T
// cover on every line every year so the ceded block is real; scenario 1 with Mid
// adverse development on every line, so older years develop; and scenario 1 on
// WC and GL alone, so the pool's underwriting rows are sums — at game start and
// after each of three years, at the pool and on every line:
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
//        A3 Contributions To The Current Calendar Year, RECOMPUTED here accident
//           year by accident year: Total Net Incurred is each column's movement
//           this year, Δ(paid + case + IBNR) — unchanged — and sums to the year's
//           booked net loss + LAE; Newly Arising Reserve Changes on an older year
//           is −ΔIBNR + s·D (s its IBNR share of the reserve outstanding at the
//           start of the year, D its movement), Previously Reported takes the
//           year's payments and (1 − s)·D less them, the current program year is
//           all newly arising; Newly Arising + Previously Reported + Change in
//           IBNR = Total Net Incurred in every column — at EVERY year each game's
//           statement can stand at, every scope; Written Premium is each program
//           year's own; and the All Years Total Net Incurred is the calendar
//           year's Total Incurred Loss & LAE on the Net Income Statement.
//        A4 Program years: reported = paid + case, incurred = reported + IBNR,
//           net = gross − ceded, Program Year Totals - Net = the Net block; summed
//           over every column, net case + IBNR is the balance sheet's loss and
//           loss expense reserves — the blocks meet the engine's reserves.
//        A5 Underwriting: written, new and renewal exposure and the rate the
//           engine's; Retained % = renewal over last year's written; written =
//           new + renewal; the pool's their sums when its lines share one unit
//           (WC and GL payroll, or Property alone) and "—" in every row otherwise.
//   B. THE EXCEL FILE IS THE TEMPLATE CELL FOR CELL — the v2 template's Pool
//      sheet, against the file a player downloads, built and read back: on every
//      sheet, every label in column B and every blank row is the template's, row
//      for row — but for the two headings the statement renames on purpose
//      (RENAMED_HEADINGS: "Net Income Statement For The Year", "Reinsurance
//      Information - Program Year Totals"), and only those; column I (All Years) holds the template's header and its SUM(C:H)
//      formula wherever the template does, cached at its row's sum, and nothing
//      where it holds nothing (the ratio rows); the figure cells are numbers in
//      their formats; the header rows carry Prior and the five years; and EVERY
//      CELL'S BORDER, A to I on every row, is the template's — each side and its
//      style, read from the template file itself (exceljs), never from the table
//      the app draws from.
//   C. THE OPERATING RATIO BY HAND, scenario 1, WC, 2027: its parts printed and
//      the ratio recomputed from them.
//
// ⚠ AND EACH FAILS WHEN BROKEN — the controls feed A a statement with one
// figure off the engine's (premium gross of reinsurance; the operating ratio over
// the net premium; contributions measured against the same valuation; a reserve
// dropped from the blocks; newly arising short of IBNR's share of development;
// Total Net Incurred moved with its parts; the old all-previously-reported
// split; Prior's Total Net Incurred moved, which the All Years check must catch),
// and B a workbook with "Profit and Contigency" kept, v1's two blank rows after
// Written Premium, a blank row dropped, a label altered, an All Years total
// written as a number and one summed short a column, one border missing (which
// must fail on exactly that cell) and the v1 template's lines.
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
import { allYearsCell, buildTemplateStatement, RENAMED_HEADINGS, TEMPLATE_ROWS, type Figure, type TemplateStatement } from '../../src/utils/annualStatementTemplate';
import { programYearsOf, statementYears } from '../../src/utils/resultsStatement';
import ExcelJS from 'exceljs';
import { ALL_YEARS_COLUMN, allYearsFormula, buildAnnualStatementXlsx, STATEMENT_COLUMNS, STATEMENT_NUMBER_FORMAT } from '../../src/utils/annualStatementExport';
import type { CoverageLine, DecisionSet, GameSetupSettings, GameState, LineResultSet, LineView, ResultSet } from '../../src/types/simulation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(__dirname, '../../docs/Annual Statement Example v2.xlsx');
/** v2's template is its Pool sheet (it also carries a filled WC example). */
const TEMPLATE_SHEET = 'Pool';
/** The first template — read only by a control, so v1's layout must fail against v2. */
const TEMPLATE_V1 = path.join(__dirname, '../../docs/Annual Statement Example.xlsx');
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SCOPES: LineView[] = ['pool', ...LINES];
const YEARS = 3;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const clone = (ts: TemplateStatement): TemplateStatement => ({ ...ts, figures: Object.fromEntries(Object.entries(ts.figures).map(([k, v]) => [k, [...v]])) });
/** What the run exercised, so a check that could only pass vacuously says so. */
const A3_EXERCISE = { ibnrShareOfDevelopment: 0, underwritingFigures: 0 };
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

function covered(y: number): DecisionSet {
  const d = defaultDecisionSet(y);
  for (const l of LINES) d.byLine[l].reinsuranceOption = fullTowerOption(l);
  return d;
}

function playSnapshots(id: string, decide: (y: number) => DecisionSet,
  opts: { lines?: CoverageLine[]; development?: GameSetupSettings['developmentLevels'] } = {}): GameState[] {
  const lines = opts.lines ?? LINES;
  const { setup, instance } = openSoloInstance({ poolName: 'S', gameLength: YEARS, startingYear: 2027, instanceId: id, activeLines: lines,
    ...(opts.development ? { developmentLevels: opts.development } : {}) } as GameSetupSettings);
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

  // A3. Contributions to the current calendar year — recomputed here accident
  // year by accident year from programYearsOf at the two valuations, never read
  // off the statement's own split.
  const last = ts.figures.premium.length - 1;
  const sum = (xs: Figure[]) => (xs.some(x => x === null) ? NaN : xs.reduce<number>((s, x) => s + x!, 0));
  rowTies('contributions Written Premium = the program year\'s', f['cy.premium'], f['py.premium'], out);
  const tl = timelineOf(gs).filter(r => r.yearNumber <= ts.asOf);
  if (tl.length >= 2) {
    const booked = window[window.length - 1];
    if (!near(sum(f['cy.incurred']), booked.netIncurredLoss + booked.laeIncurred)) out.push(`Σ Total Net Incurred ${sum(f['cy.incurred'])} ≠ booked ${booked.netIncurredLoss + booked.laeIncurred}`);
    const [nowR, thenR] = [tl[tl.length - 1], tl[tl.length - 2]];
    const firstAy = windowResults[0].yearNumber;
    const n = 1 + ts.years.length;
    const want = Array.from({ length: n }, () => ({ total: 0, prevPaid: 0, prevCase: 0, newPaid: 0, newCase: 0, ibnr: 0 }));
    for (const l of scope === 'pool' ? gs.setup.activeLines : [scope as CoverageLine]) {
      const now = programYearsOf(gs, l, nowR), then = programYearsOf(gs, l, thenR);
      for (const ay of new Set([...now.keys(), ...then.keys()])) {
        const i = ay < firstAy ? 0 : windowResults.findIndex(r => r.yearNumber === ay) + 1;
        if (i < 0) continue;
        const z = { paid: 0, case_: 0, ibnr: 0 };
        const a = now.get(ay)?.net ?? z, b = then.get(ay)?.net ?? z;
        const dP = a.paid - b.paid, dC = a.case_ - b.case_, dI = a.ibnr - b.ibnr, d = dP + dC + dI;
        const w = want[i];
        w.total += d; w.ibnr += dI;
        if (ay === ts.asOf) { w.newPaid += dP; w.newCase += dC; continue; }
        // The specification: IBNR's share of the reserve outstanding at the start of the year.
        const share = b.case_ + b.ibnr > 0 ? Math.min(1, Math.max(0, b.ibnr / (b.case_ + b.ibnr))) : 0;
        w.newCase += -dI + share * d;
        w.prevPaid += dP;
        w.prevCase += (1 - share) * d - dP;
        A3_EXERCISE.ibnrShareOfDevelopment += Math.abs(share * d);
      }
    }
    // TOTAL NET INCURRED UNCHANGED: each column is the year's movement, Δ(paid + case + IBNR).
    rowTies('Total Net Incurred (the year\'s movement)', f['cy.incurred'], want.map(w => w.total), out);
    rowTies('Change in IBNR', f['cy.ibnr'], want.map(w => w.ibnr), out);
    rowTies('Newly Arising Payments', f['cy.new.paid'], want.map(w => w.newPaid), out);
    rowTies('Newly Arising Reserve Changes', f['cy.new.case'], want.map(w => w.newCase), out);
    rowTies('Previously Reported Payments', f['cy.prev.paid'], want.map(w => w.prevPaid), out);
    rowTies('Previously Reported Reserve Changes', f['cy.prev.case'], want.map(w => w.prevCase), out);
    // ALL YEARS: the Contributions' Total Net Incurred over every program year is
    // the calendar year's Total Incurred Loss & LAE on the Net Income Statement.
    const cyRow = TEMPLATE_ROWS.findIndex(r => r.kind === 'figure' && r.key === 'cy.incurred');
    const allYearsIncurred = allYearsCell(TEMPLATE_ROWS[cyRow], cyRow, ts);
    if (allYearsIncurred == null || f.lossLae[last] === null || !near(allYearsIncurred, f.lossLae[last]!))
      out.push(`All Years Total Net Incurred ${allYearsIncurred} ≠ the Net Income Statement's Total Incurred Loss & LAE ${f.lossLae[last]}`);
    // AND IT FOOTS: Newly Arising + Previously Reported + Change in IBNR = Total Net Incurred, every column.
    f['cy.incurred'].forEach((x, i) => {
      const parts = f['cy.prev.reported'][i]! + f['cy.new.reported'][i]! + f['cy.ibnr'][i]!;
      if (x === null || !near(x, parts)) out.push(`contributions don't foot [${i}]: ${f['cy.new.reported'][i]} + ${f['cy.prev.reported'][i]} + ${f['cy.ibnr'][i]} ≠ ${x}`);
      if (!near(f['cy.new.reported'][i]!, f['cy.new.paid'][i]! + f['cy.new.case'][i]!)) out.push(`newly arising net reported ≠ payments + reserve changes [${i}]`);
      if (!near(f['cy.prev.reported'][i]!, f['cy.prev.paid'][i]! + f['cy.prev.case'][i]!)) out.push(`previously reported net reported ≠ payments + reserve changes [${i}]`);
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
  // A column with no program year in it (Prior, before the pool has older years) holds none.
  const held = (xs: Figure[]) => xs.reduce<number>((t, x) => t + (x ?? 0), 0);
  const reserves = held(f['net.case']) + held(f['net.ibnr']);
  if (!near(reserves, f.lossRes[last]! + f.laeRes[last]!)) out.push(`Σ net case + IBNR ${reserves} ≠ loss + loss expense reserves ${f.lossRes[last]! + f.laeRes[last]!}`);

  // A5. Underwriting: each line's own exposures and rate; the pool's their sum
  // where every line is on payroll (WC, GL), and "—" in every row with Property.
  const uwLines = scope === 'pool' ? gs.setup.activeLines : [scope as CoverageLine];
  const tlAll = timelineOf(gs).filter(r => r.yearNumber <= ts.asOf);
  if (scope === 'pool' && new Set(uwLines.map(l => (l === 'Property' ? 'TIV' : 'payroll'))).size > 1) {
    for (const k of ['exposure', 'exposureChange', 'newBusiness', 'renewal', 'retained', 'rate', 'rateChange']) if (f[k].some(x => x !== null)) out.push(`pool ${k} shows a figure with Property in it`);
  } else {
    const ln = (r: ResultSet | undefined, fn: (x: LineResultSet) => number | undefined) =>
      (r ? uwLines.reduce((t, l) => t + (fn(r.byLine[l]!) ?? NaN), 0) : NaN);
    const prevOf = (r: ResultSet) => tlAll[tlAll.indexOf(r) - 1];
    const rolledR = tlAll.filter(r => r.yearNumber < windowResults[0].yearNumber);
    const cols = [rolledR.at(-1), ...windowResults];
    const val = (x: number) => (Number.isFinite(x) ? x : null);
    rowTies('written exposure', f.exposure, cols.map(r => val(ln(r, x => x.writtenExposure))), out);
    rowTies('new business', f.newBusiness, [rolledR.length ? val(rolledR.reduce((t, r) => t + ln(r, x => x.newBusinessExposure), 0)) : null,
      ...windowResults.map(r => val(ln(r, x => x.newBusinessExposure)))], out);
    rowTies('renewal business', f.renewal, [rolledR.length ? val(rolledR.reduce((t, r) => t + ln(r, x => x.renewalExposure), 0)) : null,
      ...windowResults.map(r => val(ln(r, x => x.renewalExposure)))], out);
    rowTies('retained % = renewal ÷ last year\'s written', f.retained, windowResults.map(r => (prevOf(r) ? val(ln(r, x => x.renewalExposure) / ln(prevOf(r), x => x.writtenExposure)) : null)).reduce<(number | null)[]>((a, x) => [...a, x], [null]), out);
    // The template's own identity: Written Exposures = New Business + Renewal Business, every year shown.
    // To the engine's own rounding: it records written exposure to two decimals
    // ($M, so to $5,000) and the renewal and new business it is made of unrounded.
    windowResults.forEach((_, j) => { const i = j + 1; if (Math.abs(f.exposure[i]! - f.newBusiness[i]! - f.renewal[i]!) > 0.005 * uwLines.length + 1e-9) out.push(`written ≠ new + renewal [${i}]: ${f.exposure[i]} vs ${f.newBusiness[i]! + f.renewal[i]!}`); });
    const rate = (x: LineResultSet) => x.finalRatePer100 ?? x.ratePer100;
    rowTies('rate', f.rate, cols.map(r => (r ? val(ln(r, x => rate(x) * x.writtenExposure) / ln(r, x => x.writtenExposure)) : null)), out);
    A3_EXERCISE.underwritingFigures += f.exposure.filter(x => x !== null).length;
  }
  return out;
}

const games: { id: string; snaps: GameState[] }[] = [
  ...['1', '7', '12'].map(id => ({ id, snaps: playSnapshots(id, defaultDecisionSet) })),
  { id: 'STMT7 (covered)', snaps: playSnapshots('STMT7', covered) },
  // Adverse development on every line (as a hosted or Test player game plays it), so older
  // accident years move and the newly arising / previously reported split has development to divide.
  { id: '1 (adverse Mid)', snaps: playSnapshots('1', defaultDecisionSet, { development: { WC: 'Mid', GL: 'Mid', Property: 'Mid' } }) },
  // Payroll lines only, so the pool's underwriting rows are sums rather than "—".
  { id: '1 (WC+GL)', snaps: playSnapshots('1', defaultDecisionSet, { lines: ['WC', 'GL'] }) },
];
const scopesOf = (gs: GameState): LineView[] => ['pool', ...gs.setup.activeLines];

console.log('\nA. every figure ties to what the engine books');
let statements = 0;
const tieFails: string[] = [];
let ceded = 0;
for (const g of games) for (const [y, gs] of g.snaps.entries()) for (const scope of scopesOf(gs)) {
  const ts = buildTemplateStatement(gs, scope);
  statements++;
  ceded += Math.abs(ts.figures['ceded.incurred'].reduce<number>((s, x) => s + (x ?? 0), 0));
  for (const e of tieOut(gs, ts, scope)) tieFails.push(`${g.id} after ${y} ${scope}: ${e}`);
}
check(tieFails.length === 0, `A. ${statements} statements tie to the engine (${games.length} games × ${YEARS + 1} points × every scope)`, tieFails.slice(0, 3).join(' · '));
check(ceded > 0, 'A. the covered game cedes, so the ceded block is exercised', `Σ |ceded incurred| ${ceded.toFixed(0)}`);

// EVERY YEAR THE STATEMENT CAN STAND AT: each game's last point, at every year
// its selector offers, every scope — the contributions recomputed and footed at each.
let everyYear = 0;
const yearFails: string[] = [];
for (const g of games) {
  const gs = g.snaps[YEARS];
  for (const { yearNumber } of statementYears(gs)) for (const scope of scopesOf(gs)) {
    const ts = buildTemplateStatement(gs, scope, yearNumber);
    if (ts.figures['cy.incurred'].every(x => x === null)) continue; // the pool's first year has no year before it
    everyYear++;
    for (const e of tieOut(gs, ts, scope)) yearFails.push(`${g.id} as of ${yearNumber} ${scope}: ${e}`);
  }
}
check(yearFails.length === 0, `A. at every year each game's statement can stand at, every scope (${everyYear} statements): Total Net Incurred is the year's movement, unchanged, and Newly Arising + Previously Reported + Change in IBNR = Total Net Incurred`, yearFails.slice(0, 3).join(' · '));
check(A3_EXERCISE.ibnrShareOfDevelopment > 0, 'A. the split is exercised: older accident years develop, and IBNR\'s share of it moves to newly arising', `Σ |s·D| ${A3_EXERCISE.ibnrShareOfDevelopment.toFixed(0)}`);
check(A3_EXERCISE.underwritingFigures > 0, 'A. the pool\'s underwriting rows are checked as sums on a payroll-only pool, and on every line', `${A3_EXERCISE.underwritingFigures} exposure figures`);

// THE CONTRIBUTIONS' CONTROLS, on the adverse-development game's last point, on WC.
{
  const gs = games[4].snaps[YEARS];
  const base = buildTemplateStatement(gs, 'WC');
  // The older column where IBNR's share of the development is largest.
  const i = [1, 2, 3, 4].reduce((a, k) => (Math.abs(base.figures['cy.new.case'][k]! + base.figures['cy.ibnr'][k]!) > Math.abs(base.figures['cy.new.case'][a]! + base.figures['cy.ibnr'][a]!) ? k : a), 1);
  const cc: { name: string; breakIt: (t: TemplateStatement) => void }[] = [
    { name: 'newly arising short of IBNR\'s share of the development (the identity breaks)', breakIt: t => {
      const sd = t.figures['cy.new.case'][i]! + t.figures['cy.ibnr'][i]!; // s·D
      t.figures['cy.new.case'][i]! -= sd; t.figures['cy.new.reported'][i]! -= sd; } },
    { name: 'Total Net Incurred changed, its parts moved with it (the identity holds)', breakIt: t => {
      t.figures['cy.incurred'][i]! += 50_000; t.figures['cy.ibnr'][i]! += 50_000; } },
    { name: 'the old split: every older year\'s movement previously reported (totals hold)', breakIt: t => {
      for (let k = 0; k < t.figures['cy.new.case'].length - 1; k++) {
        const na = t.figures['cy.new.case'][k]!;
        t.figures['cy.prev.case'][k]! += na; t.figures['cy.prev.reported'][k]! += na;
        t.figures['cy.new.case'][k] = 0; t.figures['cy.new.reported'][k] = 0;
      } } },
  ];
  for (const c of cc) {
    const t = clone(base);
    c.breakIt(t);
    const errs = tieOut(gs, t, 'WC');
    check(errs.length > 0, `A control — ${c.name}: the tie-out fails`, errs[0] ?? 'NOTHING FIRED');
  }
  // All Years: one column's Total Net Incurred moved, nothing else — the All Years check itself must fire.
  {
    const t = clone(base);
    t.figures['cy.incurred'][0]! += 50_000;
    const errs = tieOut(gs, t, 'WC').filter(e => e.startsWith('All Years Total Net Incurred'));
    check(errs.length === 1, 'A control — Prior\'s Total Net Incurred moved: All Years no longer meets the Net Income Statement, and that check fails', errs[0] ?? 'NOTHING FIRED');
  }
}

// The controls: each a statement with one figure off the engine's, on the covered
// game after two years, where the reinsurance cost is real.
const g1 = games[3].snaps[2];
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
// B. The Excel file against the template (v2's Pool sheet): labels, blank rows,
// borders and the All Years formulas.
// ---------------------------------------------------------------------------
console.log('\nB. the Excel file is the v2 template cell for cell: labels, blanks, borders and the All Years formulas');
const tpl = XLSX.read(fs.readFileSync(TEMPLATE), { type: 'buffer', cellFormula: true });
const tws = tpl.Sheets[TEMPLATE_SHEET];
const tRange = XLSX.utils.decode_range(tws['!ref']!);
const cellOf = (ws: XLSX.WorkSheet, r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
const labelAt = (ws: XLSX.WorkSheet, r: number) => { const c = cellOf(ws, r, 1); return c && c.v !== undefined && c.v !== '' ? String(c.v) : null; };
const blankAt = (ws: XLSX.WorkSheet, r: number) => [1, 2, 3, 4, 5, 6, 7].every(c => { const x = cellOf(ws, r, c); return !x || x.v === undefined || x.v === ''; });
/** Column I (All Years) as a template or a statement holds it: its header, its formula, or nothing. */
const allYearsAt = (ws: XLSX.WorkSheet, r: number): string => {
  const c = cellOf(ws, r, ALL_YEARS_COLUMN - 1);
  if (!c) return '';
  if (c.f) return `=${c.f.replace(/^=/, '')}`;
  return c.v === undefined || c.v === '' ? '' : String(c.v);
};
// THE TWO HEADINGS THE STATEMENT RENAMES ON PURPOSE (RENAMED_HEADINGS): every
// other label is the template's exactly. Both must be found in the template,
// each once, and each a section title.
const expectedLabel = (r: number) => { const t = labelAt(tws, r); return t !== null && t in RENAMED_HEADINGS ? RENAMED_HEADINGS[t] : t; };
const renamedRows = Array.from({ length: tRange.e.r + 1 }, (_, r) => r).filter(r => labelAt(tws, r) !== expectedLabel(r));
check(renamedRows.length === 2 && renamedRows.every(r => TEMPLATE_ROWS[r]?.kind === 'title' && 'label' in TEMPLATE_ROWS[r] && (TEMPLATE_ROWS[r] as { label: string }).label === expectedLabel(r)),
  'B. the statement renames exactly two template cells, both section titles: "Net Income Statement For The Year" and "Reinsurance Information - Program Year Totals"',
  renamedRows.map(r => `B${r + 1} "${labelAt(tws, r)}" → "${expectedLabel(r)}"`).join(' · '));
check(!Array.from({ length: tRange.e.r + 1 }, (_, r) => labelAt(tws, r)).includes('Profit and Contigency'),
  'B. v2 carries no "Profit and Contigency" — the v1 row the statement removed is gone from the template itself');
const expectedRows = Array.from({ length: tRange.e.r + 1 }, (_, r) => r);
check(TEMPLATE_ROWS.length === expectedRows.length, `B. the statement has the template's rows: ${TEMPLATE_ROWS.length} of ${tRange.e.r + 1}`);
const templateFormulas = expectedRows.filter(r => allYearsAt(tws, r).startsWith('=')).length;
check(templateFormulas > 0 && expectedRows.every(r => { const a = allYearsAt(tws, r); return !a.startsWith('=') || a === `=${allYearsFormula(r + 1)}`; }),
  'B. every All Years cell in the template is SUM(C:H) over its own row', `${templateFormulas} formulas`);

function layoutDiffs(ws: XLSX.WorkSheet, ts: TemplateStatement): string[] {
  const out: string[] = [];
  const range = XLSX.utils.decode_range(ws['!ref']!);
  if (range.e.r + 1 !== expectedRows.length) out.push(`${range.e.r + 1} rows, template ${expectedRows.length}`);
  expectedRows.forEach(r => {
    if (labelAt(ws, r) !== expectedLabel(r)) out.push(`row ${r + 1}: "${labelAt(ws, r)}" ≠ "${expectedLabel(r)}" (template "${labelAt(tws, r)}")`);
    if (blankAt(ws, r) !== blankAt(tws, r)) out.push(`row ${r + 1}: ${blankAt(ws, r) ? 'blank' : 'not blank'}, template ${blankAt(tws, r) ? 'blank' : 'not blank'}`);
    // ALL YEARS: the same header, the same formula, or nothing — cell for cell.
    if (allYearsAt(ws, r) !== allYearsAt(tws, r)) out.push(`I${r + 1}: "${allYearsAt(ws, r)}" ≠ template "${allYearsAt(tws, r)}"`);
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
    // The formula's cached value is its row's sum, so a reader that does not recalculate sees the total.
    const ay = cellOf(ws, r, ALL_YEARS_COLUMN - 1);
    if (ay?.f) {
      const rowSum = [2, 3, 4, 5, 6, 7].reduce((t, c) => { const x = cellOf(ws, r, c); return t + (x?.t === 'n' ? Number(x.v) : 0); }, 0);
      if (ay.t !== 'n' || !near(Number(ay.v), rowSum)) out.push(`I${r + 1}: cached ${ay.v} ≠ its row's sum ${rowSum}`);
    }
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
const tBorders = texcel.getWorksheet(TEMPLATE_SHEET)!;
let templateLines = 0, allYearsLines = 0;
for (const r of expectedRows) for (let c = 1; c <= STATEMENT_COLUMNS; c++) {
  const n = sidesOf(tBorders, r + 1, c).split(':').length - 1;
  templateLines += n;
  if (c === ALL_YEARS_COLUMN) allYearsLines += n;
}
check(templateLines > 0 && allYearsLines > 0, 'B. the template draws borders to compare against, All Years included', `${templateLines} cell sides, ${allYearsLines} in column I`);

/** Every cell, A to I on every statement row, whose border is not the template's, row for row. */
function borderDiffs(ws: BorderSheet): string[] {
  const out: string[] = [];
  expectedRows.forEach(r => {
    for (let c = 1; c <= STATEMENT_COLUMNS; c++) {
      const want = sidesOf(tBorders, r + 1, c), got = sidesOf(ws, r + 1, c);
      if (want !== got) out.push(`${String.fromCharCode(64 + c)}${r + 1}: "${got}" ≠ template "${want}"`);
    }
  });
  return out;
}

for (const g of [games[0], games[3]]) for (const gs of [g.snaps[0], g.snaps[YEARS]]) {
  // THE FILE a player downloads, read back two ways: SheetJS for values, formats and formulas, exceljs for borders.
  const bytes = await buildAnnualStatementXlsx(gs);
  const wb = XLSX.read(new Uint8Array(bytes), { type: 'array', cellNF: true, cellFormula: true });
  const ex = new ExcelJS.Workbook();
  await ex.xlsx.load(bytes);
  const tag = `${g.id}, year ${gs.lockedResults.length}`;
  check(wb.SheetNames.join(',') === 'Pool,WC,GL,Property', `B. ${tag}: a sheet for the pool and one per line`, wb.SheetNames.join(','));
  const diffs = wb.SheetNames.flatMap((s, i) => layoutDiffs(wb.Sheets[s], buildTemplateStatement(gs, SCOPES[i])).map(d => `${s} ${d}`));
  check(diffs.length === 0, `B. ${tag}: every sheet matches the template label for label, blank for blank and All Years formula for formula (${expectedRows.length} rows, ${templateFormulas} formulas), figures numbers in their formats`, diffs.slice(0, 3).join(' · '));
  const bdiffs = ex.worksheets.flatMap(ws => borderDiffs(ws).map(d => `${ws.name} ${d}`));
  check(bdiffs.length === 0, `B. ${tag}: every sheet's borders are the template's, cell for cell (A–I × ${expectedRows.length} rows, ${templateLines} sides a sheet)`, bdiffs.slice(0, 3).join(' · '));
}

// The controls. Layout: the v1 row kept, v1's two blanks after Written Premium, a
// blank row dropped, a label altered, an All Years total written as a number, and
// one summed over the wrong range. Borders: one line missing, and v1's lines.
{
  const ts = buildTemplateStatement(g1, 'WC');
  const bytes = await buildAnnualStatementXlsx(g1);
  const base = XLSX.read(new Uint8Array(bytes), { type: 'array', cellNF: true, cellFormula: true }).Sheets.WC;
  const shifted = (rows: number[]) => {
    const out: XLSX.WorkSheet = {};
    rows.forEach((src, dst) => { for (let c = 0; c < STATEMENT_COLUMNS; c++) { const x = cellOf(base, src, c); if (x) out[XLSX.utils.encode_cell({ r: dst, c })] = x; } });
    out['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: STATEMENT_COLUMNS - 1 } });
    return out;
  };
  const all = TEMPLATE_ROWS.map((_, r) => r);
  const withRow = shifted([...all.slice(0, 14), -1, ...all.slice(14)]);
  withRow[XLSX.utils.encode_cell({ r: 14, c: 1 })] = { t: 's', v: 'Profit and Contigency' };
  check(layoutDiffs(withRow, ts).length > 0, 'B control — "Profit and Contigency" kept: the layout check fails');
  // v1's spacing: a second blank row after the Contributions' Written Premium (statement row 74).
  const v1Spacing = shifted([...all.slice(0, 74), -1, ...all.slice(74, -1)]);
  check(layoutDiffs(v1Spacing, ts).length > 0, 'B control — v1\'s two blank rows after Written Premium: the layout check fails', layoutDiffs(v1Spacing, ts)[0]);
  const dropped = shifted(all.filter(r => r !== 29));
  check(layoutDiffs(dropped, ts).length > 0, 'B control — one blank row dropped: the layout check fails', layoutDiffs(dropped, ts)[0]);
  // The template's old wording kept, and a third heading renamed: both must fail.
  for (const [name, r, v] of [
    ['the template\'s old wording kept ("Net Income Statement ")', renamedRows[0], labelAt(tws, renamedRows[0])],
    ['a third heading renamed ("Underwriting" → "Underwriting Results")', TEMPLATE_ROWS.findIndex(x => x.kind === 'title' && x.label === 'Underwriting'), 'Underwriting Results'],
  ] as const) {
    const t = shifted(all);
    t[XLSX.utils.encode_cell({ r, c: 1 })] = { t: 's', v: String(v) };
    check(layoutDiffs(t, ts).length > 0, `B control — ${name}: the layout check fails`, layoutDiffs(t, ts)[0]);
  }
  const altered = shifted(all);
  altered[XLSX.utils.encode_cell({ r: 38, c: 1 })] = { t: 's', v: 'Invested' };
  check(layoutDiffs(altered, ts).length > 0, 'B control — a label altered ("      Invested" → "Invested"): the layout check fails', layoutDiffs(altered, ts)[0]);
  // All Years, row 87 (the Contributions' Total Net Incurred): its total as a plain number, then a SUM short a column.
  const ayRow = TEMPLATE_ROWS.findIndex(r => r.kind === 'figure' && r.key === 'cy.incurred');
  const asValue = shifted(all);
  asValue[XLSX.utils.encode_cell({ r: ayRow, c: ALL_YEARS_COLUMN - 1 })] = { t: 'n', v: Number(cellOf(base, ayRow, ALL_YEARS_COLUMN - 1)?.v) };
  check(layoutDiffs(asValue, ts).length > 0, `B control — an All Years total written as a number, not a formula (I${ayRow + 1}): the check fails`, layoutDiffs(asValue, ts)[0]);
  const shortRange = shifted(all);
  shortRange[XLSX.utils.encode_cell({ r: ayRow, c: ALL_YEARS_COLUMN - 1 })] = { ...cellOf(base, ayRow, ALL_YEARS_COLUMN - 1)!, f: `SUM(C${ayRow + 1}:G${ayRow + 1})` };
  check(layoutDiffs(shortRange, ts).length > 0, `B control — an All Years SUM short a column (C:G): the check fails`, layoutDiffs(shortRange, ts)[0]);

  // One line missing: the bottom line that closes the Net Income Statement (row 29), on H.
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
  // v1's lines, row for row: no All Years column, and its rows unshifted by the row v2 dropped.
  const v1 = new ExcelJS.Workbook();
  await v1.xlsx.readFile(TEMPLATE_V1);
  const v1ws = v1.worksheets[0];
  const v1Lines = borderDiffs({ getCell: (r, c) => v1ws.getCell(r < 15 ? r : r + 1, c) });
  check(v1Lines.length > 0, 'B control — the v1 template\'s lines: the border check fails', `${v1Lines.length} cells, first ${v1Lines[0]}`);
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
