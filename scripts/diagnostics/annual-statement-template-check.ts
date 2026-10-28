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
//           all newly arising; then the two variances — newly reported claims
//           paid at the line's first-year paid share (held between 0 and the
//           year's payments), taken off Previously Reported Payments, and the
//           settlement draw (the game's seed, mean 0, SETTLEMENT_SPREAD of the
//           previously reported payments, capped at the IBNR the accident year has
//           left, nothing carried over) added to Previously Reported and taken
//           off Change in IBNR — with each accident year's payments and Total Net
//           Incurred unchanged by them; Newly Arising + Previously Reported + Change in
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
//   B. THE EXCEL FILE IS THE TEMPLATE CELL FOR CELL, BUT FOR A LIST — the v2
//      template's Pool sheet, against the file a player downloads, built and read
//      back. The statement differs from the template on purpose, and only as
//      annualStatementTemplate.ts lists it (printed here): the label changes
//      (LABEL_CHANGES — four headings, "Written Premium", "Other Admin Expense",
//      the three "% of Premium" indented), one row inserted (General Admin
//      Expense's own "% of Premium"), Prior and All Years blank in the first
//      three sections with column I drawn as H, and the first year's two
//      Underwriting changes blank. The expected grid is the template's through
//      exactly that list, so ANY OTHER CELL THAT DIFFERS FAILS: on every sheet,
//      every label in column B and every blank row; column I (All Years) the
//      template's header and its SUM(C:H) formula wherever the template has one,
//      cached at its row's sum, and nothing where it holds nothing; the figure
//      cells numbers in their formats, blank where the statement shows a blank;
//      the header rows Prior where the section shows it and the five years; and
//      EVERY CELL'S BORDER, A to I on every row — each side and its style, read
//      from the template file itself (exceljs), never from the table the app
//      draws from. Each listed label change must be one the template has.
//   C. THE OPERATING RATIO BY HAND, scenario 1, WC, 2027: its parts printed and
//      the ratio recomputed from them.
//
// ⚠ AND EACH FAILS WHEN BROKEN — the controls feed A a statement with one
// figure off the engine's (premium gross of reinsurance; the operating ratio over
// the net premium; contributions measured against the same valuation; a reserve
// dropped from the blocks; newly arising short of IBNR's share of development;
// Total Net Incurred moved with its parts; the old all-previously-reported
// split; Prior's Total Net Incurred moved, which the All Years check must catch;
// newly reported claims paid twice, or left unpaid; a settlement difference not
// balanced through Change in IBNR; an admin "% of Premium" over the gross
// premium, a year out, or swapped), and B a workbook with "Profit and
// Contigency" kept, v1's two blank rows after Written Premium, a blank row
// dropped, the inserted row left out, each label change undone in turn, a label
// altered and a heading renamed off the list, Prior back in the first three
// sections (a header and a figure), a first year's change filled, a value in a
// blank column I, an All Years total written as a number and one summed short a
// column, one border missing and one added column-I line missing (each must fail
// on exactly that cell), the template's lines with no column I added, and the
// v1 template's lines.
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
import {
  allYearsCell, buildTemplateStatement, hasAllYears, INSERTED_AFTER_TEMPLATE_ROW, INSERTED_LABEL, isInsertedRow, LABEL_CHANGES, SETTLEMENT_SPREAD,
  showsPrior, shownFigure, TEMPLATE_ROW_OF, TEMPLATE_ROWS, type Figure, type TemplateStatement,
} from '../../src/utils/annualStatementTemplate';
import { deriveSubRng } from '../../src/utils/random';
import { marketSeedOf } from '../../src/utils/bookUnits';
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
const A3_EXERCISE = { ibnrShareOfDevelopment: 0, underwritingFigures: 0, newlyReportedPaid: 0, settlement: 0, capped: 0 };

/** One accident year's year, as the gate recomputes it from the specification. */
interface GateYear { current: boolean; dP: number; dC: number; dI: number; d: number; share: number; newPaid: number; newReported: number; prevPaid: number; raw: number; settle: number }
/**
 * THE GATE'S OWN SPLIT AND DRAWS, one line, every year of the timeline `tl` to
 * its last: each older accident year's newly reported share paid at the line's
 * first-year paid share, and its settlement draw (the game's seed, mean 0,
 * SETTLEMENT_SPREAD of the previously reported payments) — CAPPED, when
 * `capped`, at the IBNR it has left (its IBNR now less its draws before), the
 * excess dropped. Returns the last year's rows and every accident year's draws
 * to date.
 */
function drawsOf(gs: GameState, l: CoverageLine, tl: ResultSet[], capped: boolean): { last: Map<number, GateYear>; settled: Map<number, number> } {
  const settled = new Map<number, number>();
  let last = new Map<number, GateYear>();
  const valued = tl.map(r => programYearsOf(gs, l, r));
  for (let k = 1; k < tl.length; k++) {
    const now = valued[k], then = valued[k - 1], yn = tl[k].yearNumber;
    const fy = now.get(yn)?.net;
    const paidShare = fy && fy.paid + fy.case_ > 0 ? Math.min(1, Math.max(0, fy.paid / (fy.paid + fy.case_))) : 0;
    const year = new Map<number, GateYear>();
    for (const ay of new Set([...now.keys(), ...then.keys()])) {
      const z = { paid: 0, case_: 0, ibnr: 0 };
      const a = now.get(ay)?.net ?? z, b = then.get(ay)?.net ?? z;
      const dP = a.paid - b.paid, dC = a.case_ - b.case_, dI = a.ibnr - b.ibnr, d = dP + dC + dI;
      if (ay === yn) { year.set(ay, { current: true, dP, dC, dI, d, share: 0, newPaid: 0, newReported: 0, prevPaid: 0, raw: 0, settle: 0 }); continue; }
      // The specification: IBNR's share of the reserve outstanding at the start of the year.
      const share = b.case_ + b.ibnr > 0 ? Math.min(1, Math.max(0, b.ibnr / (b.case_ + b.ibnr))) : 0;
      const newReported = -dI + share * d;
      const newPaid = Math.min(Math.max(0, dP), Math.max(0, paidShare * newReported));
      const prevPaid = dP - newPaid;
      const raw = (SETTLEMENT_SPREAD === 0 ? 0 : deriveSubRng(marketSeedOf(gs.instance), yn, `statement-settlement:${l}:${ay}`).normal(0, 1) * SETTLEMENT_SPREAD) * prevPaid;
      const settle = capped ? Math.min(raw, a.ibnr - (settled.get(ay) ?? 0)) : raw;
      settled.set(ay, (settled.get(ay) ?? 0) + settle);
      year.set(ay, { current: false, dP, dC, dI, d, share, newPaid, newReported, prevPaid, raw, settle });
    }
    last = year;
  }
  return { last, settled };
}

/** Every IBNR cell of the program-year blocks below zero (to the cent). */
function negativeIbnr(ts: TemplateStatement): string[] {
  const out: string[] = [];
  for (const k of ['py', 'gross', 'ceded', 'net']) ts.figures[`${k}.ibnr`].forEach((x, i) => { if (x !== null && x < -0.01) out.push(`${k} IBNR [${i}] ${x.toFixed(0)} below zero`); });
  return out;
}
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
  // Each admin row's "% of Premium" is that row's own share of Written Premium, column by column.
  const shareOf = (xs: Figure[]) => xs.map((x, i) => (x === null || f.premium[i] === null || f.premium[i] === 0 ? null : x / f.premium[i]!));
  rowTies('General Admin Expense % of Premium = admin ÷ Written Premium', f.adminPct, shareOf(f.admin), out);
  rowTies('Other Admin Expense % of Premium = other admin ÷ Written Premium', f.otherAdminPct, shareOf(f.riskControl), out);

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
    const firstAy = windowResults[0].yearNumber;
    const n = 1 + ts.years.length;
    const want = Array.from({ length: n }, () => ({ total: 0, paid: 0, prevPaid: 0, prevCase: 0, newPaid: 0, newCase: 0, ibnr: 0 }));
    for (const l of scope === 'pool' ? gs.setup.activeLines : [scope as CoverageLine]) {
      for (const [ay, x] of drawsOf(gs, l, tl, true).last) {
        const i = ay < firstAy ? 0 : windowResults.findIndex(r => r.yearNumber === ay) + 1;
        if (i < 0) continue;
        const w = want[i];
        w.total += x.d; w.paid += x.dP;
        if (x.current) { w.newPaid += x.dP; w.newCase += x.dC; w.ibnr += x.dI; continue; }
        w.newPaid += x.newPaid;
        w.newCase += x.newReported - x.newPaid;
        w.prevPaid += x.prevPaid;
        w.prevCase += (1 - x.share) * x.d + x.settle - x.prevPaid;
        w.ibnr += x.dI - x.settle;
        A3_EXERCISE.ibnrShareOfDevelopment += Math.abs(x.share * x.d);
        A3_EXERCISE.newlyReportedPaid += x.newPaid;
        A3_EXERCISE.settlement += Math.abs(x.settle);
        if (x.settle < x.raw - 1e-9) A3_EXERCISE.capped++;
      }
    }
    // TOTAL NET INCURRED UNCHANGED: each column is the year's movement, Δ(paid + case + IBNR).
    rowTies('Total Net Incurred (the year\'s movement)', f['cy.incurred'], want.map(w => w.total), out);
    // EACH ACCIDENT YEAR'S PAYMENTS UNCHANGED BY THE VARIANCE: Newly Arising +
    // Previously Reported Payments is the year's Δpaid, column by column — read off
    // the statement's own rows, so a variance that pays twice fails here.
    rowTies('total paid (Newly Arising + Previously Reported Payments = Δpaid)',
      f['cy.new.paid'].map((x, i) => (x === null || f['cy.prev.paid'][i] === null ? null : x + f['cy.prev.paid'][i]!)), want.map(w => w.paid), out);
    // And Total Net Incurred, likewise from the statement's own parts: reported + Change in IBNR = Δ(paid + case + IBNR).
    rowTies('Total Net Incurred from its parts (= the year\'s movement)',
      f['cy.incurred'].map((_, i) => f['cy.new.reported'][i]! + f['cy.prev.reported'][i]! + f['cy.ibnr'][i]!), want.map(w => w.total), out);
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
  // THE BLOCKS AGAINST THE ENGINE, column by column: Paid and Total Incurred are
  // the engine's (programYearsOf), and so is the reserve, Case + IBNR — the
  // settlement draws only move it from IBNR to Case; the Ceded block is the
  // engine's row for row.
  {
    const nowR = timelineOf(gs).find(r => r.yearNumber === ts.asOf)!;
    const calOf = (yn: number) => yn + nowR.calendarYear - nowR.yearNumber;
    const engine = { gross: [] as number[][], ceded: [] as number[][], net: [] as number[][] };
    const n = 1 + ts.years.length;
    for (const k of ['gross', 'ceded', 'net'] as const) engine[k] = Array.from({ length: n }, () => [0, 0, 0]);
    for (const l of scope === 'pool' ? gs.setup.activeLines : [scope as CoverageLine]) for (const [ay, b] of programYearsOf(gs, l, nowR)) {
      const y = calOf(ay);
      const i = y < ts.years[0] ? 0 : ts.years.indexOf(y) + 1;
      if (i < 0) continue;
      for (const k of ['gross', 'ceded', 'net'] as const) { engine[k][i][0] += b[k].paid; engine[k][i][1] += b[k].case_; engine[k][i][2] += b[k].ibnr; }
    }
    const v = (x: Figure) => x ?? 0;
    for (const k of ['gross', 'ceded', 'net'] as const) for (let i = 0; i < n; i++) {
      const [paid, case_, ibnr] = engine[k][i];
      if (!near(v(f[`${k}.paid`][i]), paid)) out.push(`${k} paid [${i}] ${f[`${k}.paid`][i]} ≠ the engine's ${paid}`);
      if (!near(v(f[`${k}.case`][i]) + v(f[`${k}.ibnr`][i]), case_ + ibnr)) out.push(`${k} case + IBNR [${i}] ≠ the engine's ${case_ + ibnr}`);
      if (!near(v(f[`${k}.incurred`][i]), paid + case_ + ibnr)) out.push(`${k} Total Incurred [${i}] ≠ the engine's ${paid + case_ + ibnr}`);
      if (k === 'ceded' && (!near(v(f['ceded.case'][i]), case_) || !near(v(f['ceded.ibnr'][i]), ibnr))) out.push(`ceded case / IBNR [${i}] ≠ the engine's: the draw is on the retained claims`);
    }
  }
  // NO IBNR BELOW ZERO: the settlement draws are capped at the IBNR left.
  out.push(...negativeIbnr(ts));
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

/**
 * A program-year row's movement over the year, column by column of `ts`: each
 * column's accident years as `ts` values them, less the same accident years in
 * `prev`, the statement a year earlier (its Prior and its older columns fold
 * into `ts`'s Prior; the year's own program year was not there).
 */
function movement(ts: TemplateStatement, prev: TemplateStatement, key: string): number[] {
  const v = (t: TemplateStatement, k: number) => t.figures[key][k] ?? 0;
  return ts.figures[key].map((_, k) => {
    if (k === 0) return v(ts, 0) - (v(prev, 0) + prev.years.reduce((t, y, j) => t + (y < ts.years[0] ? v(prev, j + 1) : 0), 0));
    const j = prev.years.indexOf(ts.years[k - 1]);
    return v(ts, k) - (j >= 0 ? v(prev, j + 1) : 0);
  });
}
/**
 * THE CONTRIBUTIONS ARE THE PROGRAM YEAR TOTALS' MOVEMENT, settlement draws
 * included: Change in IBNR = Δ IBNR Reserves, Reserve Changes (both groups) =
 * Δ Case Reserves, Payments = Δ Paid, Total Net Incurred = Δ Total Incurred —
 * every column.
 */
function programYearTie(ts: TemplateStatement, prev: TemplateStatement): string[] {
  const out: string[] = [];
  const f = ts.figures;
  const sum2 = (a: Figure[], b: Figure[]) => a.map((x, i) => (x ?? 0) + (b[i] ?? 0));
  for (const [name, got, key] of [
    ['Change in IBNR = the movement in IBNR Reserves', f['cy.ibnr'].map(x => x ?? 0), 'py.ibnr'],
    ['Reserve Changes = the movement in Case Reserves', sum2(f['cy.prev.case'], f['cy.new.case']), 'py.case'],
    ['Payments = the movement in Paid Loss & LAE', sum2(f['cy.prev.paid'], f['cy.new.paid']), 'py.paid'],
    ['Total Net Incurred = the movement in Total Incurred Loss & LAE', f['cy.incurred'].map(x => x ?? 0), 'py.incurred'],
  ] as const) {
    const want = movement(ts, prev, key);
    got.forEach((g, i) => { if (!near(g, want[i])) out.push(`${name} [${i}]: ${g} ≠ ${want[i]}`); });
  }
  return out;
}

// EVERY YEAR THE STATEMENT CAN STAND AT: each game's last point, at every year
// its selector offers, every scope — the contributions recomputed and footed at each.
let everyYear = 0, pyTies = 0;
const yearFails: string[] = [], pyFails: string[] = [];
for (const g of games) {
  const gs = g.snaps[YEARS];
  for (const { yearNumber } of statementYears(gs)) for (const scope of scopesOf(gs)) {
    const ts = buildTemplateStatement(gs, scope, yearNumber);
    if (ts.figures['cy.incurred'].every(x => x === null)) continue; // the pool's first year has no year before it
    everyYear++;
    for (const e of tieOut(gs, ts, scope)) yearFails.push(`${g.id} as of ${yearNumber} ${scope}: ${e}`);
    if (!statementYears(gs).some(y => y.yearNumber === yearNumber - 1)) continue;
    const prev = buildTemplateStatement(gs, scope, yearNumber - 1);
    pyTies++;
    for (const e of programYearTie(ts, prev)) pyFails.push(`${g.id} as of ${yearNumber} ${scope}: ${e}`);
  }
}
check(pyTies > 0 && pyFails.length === 0, `A. the Contributions are the Program Year Totals' movement, settlement differences included — Change in IBNR = Δ IBNR Reserves, Reserve Changes = Δ Case Reserves, Payments = Δ Paid, Total Net Incurred = Δ Total Incurred — every column (${pyTies} statements against the year before)`, pyFails.slice(0, 3).join(' · '));
check(yearFails.length === 0, `A. at every year each game's statement can stand at, every scope (${everyYear} statements): Total Net Incurred is the year's movement, unchanged, and Newly Arising + Previously Reported + Change in IBNR = Total Net Incurred`, yearFails.slice(0, 3).join(' · '));
check(A3_EXERCISE.ibnrShareOfDevelopment > 0, 'A. the split is exercised: older accident years develop, and IBNR\'s share of it moves to newly arising', `Σ |s·D| ${A3_EXERCISE.ibnrShareOfDevelopment.toFixed(0)}`);
check(A3_EXERCISE.newlyReportedPaid > 0, 'A. the variance is exercised: newly reported claims on older accident years are paid in part', `Σ newly reported paid ${A3_EXERCISE.newlyReportedPaid.toFixed(0)}`);
check(A3_EXERCISE.settlement > 0, `A. the variance is exercised: settlement differences are drawn (SETTLEMENT_SPREAD ${SETTLEMENT_SPREAD})`, `Σ |settlement| ${A3_EXERCISE.settlement.toFixed(0)}`);
check(A3_EXERCISE.capped > 0, 'A. the cap is exercised: some draws are held to the IBNR left', `${A3_EXERCISE.capped} capped draws`);
{
  // THE CAP'S CONTROL: every game's statements at every year, with the draws
  // uncapped (the rule before), must show an IBNR cell below zero — and the
  // no-negative check must catch it.
  let caught = 0, first = '';
  for (const g of games) {
    const gs = g.snaps[YEARS];
    for (const { yearNumber } of statementYears(gs)) for (const scope of scopesOf(gs)) {
      const ts = clone(buildTemplateStatement(gs, scope, yearNumber));
      const tl = timelineOf(gs).filter(r => r.yearNumber <= ts.asOf);
      const nowR = tl[tl.length - 1];
      const off = nowR.calendarYear - nowR.yearNumber;
      for (const l of scope === 'pool' ? gs.setup.activeLines : [scope as CoverageLine]) {
        const capped = drawsOf(gs, l, tl, true).settled, uncapped = drawsOf(gs, l, tl, false).settled;
        for (const [ay, s] of uncapped) {
          const i = ay + off < ts.years[0] ? 0 : ts.years.indexOf(ay + off) + 1;
          if (i < 0) continue;
          const extra = s - (capped.get(ay) ?? 0);
          for (const k of ['py', 'gross', 'net']) {
            if (ts.figures[`${k}.ibnr`][i] === null) continue;
            ts.figures[`${k}.ibnr`][i]! -= extra; ts.figures[`${k}.case`][i]! += extra; ts.figures[`${k}.reported`][i]! += extra;
          }
        }
      }
      const errs = tieOut(gs, ts, scope).filter(e => / below zero$/.test(e));
      if (errs.length) { caught++; first ||= `${g.id} as of ${yearNumber} ${scope}: ${errs[0]}`; }
    }
  }
  check(caught > 0, 'A control — the settlement draws uncapped: an IBNR cell goes below zero and the no-negative check fails', `${caught} statements, first ${first || 'NOTHING FIRED'}`);
}
{
  // On a solo game with no adverse development — where an older year's own
  // development is small — Previously Reported still moves, by the settlement draw.
  const ts = buildTemplateStatement(games[0].snaps[YEARS], 'WC');
  const moved = ts.figures['cy.prev.reported'].slice(0, -1).filter(x => x !== null && Math.abs(x) >= 0.5);
  check(moved.length > 0, 'A. single player, no adverse development: Previously Reported Net Reported is not zero on the older years', ts.figures['cy.prev.reported'].map(x => x?.toFixed(0)).join(' / '));
}
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
  // The variance's own: paid twice, and a settlement draw not balanced through Change in IBNR.
  cc.push(
    { name: 'newly reported claims paid without taking it off Previously Reported Payments (an accident year paid twice)', breakIt: t => {
      const x = 10_000;
      t.figures['cy.new.paid'][i]! += x; t.figures['cy.new.case'][i]! -= x; } },
    { name: 'a settlement difference not balanced through Change in IBNR (Total Net Incurred moves)', breakIt: t => {
      const x = 10_000;
      t.figures['cy.prev.case'][i]! += x; t.figures['cy.prev.reported'][i]! += x; t.figures['cy.incurred'][i]! += x; } },
    { name: 'newly reported claims left unpaid, as before the variance (totals hold)', breakIt: t => {
      for (let k = 0; k < t.figures['cy.new.paid'].length - 1; k++) {
        const np = t.figures['cy.new.paid'][k]!;
        t.figures['cy.prev.paid'][k]! += np; t.figures['cy.prev.case'][k]! -= np;
        t.figures['cy.new.paid'][k] = 0; t.figures['cy.new.case'][k]! += np;
      } } },
  );
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

// THE PROGRAM YEAR TIE'S CONTROLS, on the adverse-development game's last point,
// WC, against the year before.
{
  const gs = games[4].snaps[YEARS];
  const base = buildTemplateStatement(gs, 'WC'), prev = buildTemplateStatement(gs, 'WC', base.asOf - 1);
  check(programYearTie(base, prev).length === 0, 'A. (the tie\'s controls start from a statement that ties)');
  const tie: { name: string; breakIt: (t: TemplateStatement, gs: GameState) => void }[] = [
    { name: 'the blocks without the settlement differences (the engine\'s case and IBNR, as before)', breakIt: (t, gs) => {
      const nowR = timelineOf(gs).find(r => r.yearNumber === t.asOf)!;
      const off = nowR.calendarYear - nowR.yearNumber;
      for (const k of ['py', 'gross', 'net']) { t.figures[`${k}.case`] = t.figures[`${k}.case`].map(x => (x === null ? null : 0)); t.figures[`${k}.ibnr`] = t.figures[`${k}.ibnr`].map(x => (x === null ? null : 0)); }
      for (const [ay, b] of programYearsOf(gs, 'WC', nowR)) {
        const i = ay + off < t.years[0] ? 0 : t.years.indexOf(ay + off) + 1;
        if (i < 0) continue;
        for (const [k, side] of [['py', 'net'], ['gross', 'gross'], ['net', 'net']] as const) { t.figures[`${k}.case`][i]! += b[side].case_; t.figures[`${k}.ibnr`][i]! += b[side].ibnr; }
      }
    } },
    { name: 'case moved from IBNR on one column of the blocks (totals hold)', breakIt: t => {
      for (const k of ['py', 'gross', 'net']) { t.figures[`${k}.case`][3]! += 10_000; t.figures[`${k}.ibnr`][3]! -= 10_000; t.figures[`${k}.reported`][3]! += 10_000; }
    } },
  ];
  for (const c of tie) {
    const t = clone(base);
    c.breakIt(t, gs);
    const errs = programYearTie(t, prev);
    // The draws only move case and IBNR: the engine's totals hold either way, so only the tie may catch it.
    check(errs.length > 0 && tieOut(gs, t, 'WC').filter(e => /case \+ IBNR|Total Incurred|paid \[/.test(e)).length === 0,
      `A control — ${c.name}: the Program Year tie fails, and the engine's totals still hold`, errs[0] ?? 'NOTHING FIRED');
  }
  {
    const t = clone(base);
    t.figures['ceded.case'][3]! += 10_000; t.figures['ceded.ibnr'][3]! -= 10_000;
    const errs = tieOut(gs, t, 'WC').filter(e => e.startsWith('ceded case / IBNR'));
    check(errs.length > 0, 'A control — a settlement difference put on the Ceded block: the engine check fails', errs[0] ?? 'NOTHING FIRED');
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
  { name: 'General Admin Expense % of Premium over the premium before reinsurance', breakIt: (ts, gs, scope) => {
    const x = at(gs.lockedResults.at(-1)!, scope);
    ts.figures.adminPct[5] = x.operatingExpense / x.totalMemberCharge;
  } },
  { name: 'General Admin Expense % of Premium a year out (the year before\'s share)', breakIt: ts => { ts.figures.adminPct[5] = ts.figures.adminPct[4]; } },
  { name: 'Other Admin Expense % of Premium swapped for General Admin\'s', breakIt: ts => { ts.figures.otherAdminPct = [...ts.figures.adminPct]; } },
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
// EVERY DELIBERATE DIFFERENCE FROM THE TEMPLATE (annualStatementTemplate.ts:
// LABEL_CHANGES, the inserted row, Prior and All Years blank in the first three
// sections with column I drawn as H, a first year's change blank). The expected
// grid is the template's through exactly these, so ANY OTHER CELL THAT DIFFERS
// fails below — and each listed difference must be one the template really has
// (its old text is the template's), so a stale entry fails too.
/** The template row (0-based) each statement row stands on; the inserted row stands on the row above's. */
const tRowOf = (r: number) => TEMPLATE_ROW_OF[r] - 1;
const changeAt = (r: number) => (isInsertedRow(r) ? undefined : LABEL_CHANGES.find(c => c.templateRow === TEMPLATE_ROW_OF[r]));
const expectedLabel = (r: number) => (isInsertedRow(r) ? INSERTED_LABEL : changeAt(r)?.to ?? labelAt(tws, tRowOf(r)));
const staleChanges = LABEL_CHANGES.filter(c => labelAt(tws, c.templateRow - 1) !== c.from || c.from === c.to);
console.log('  The statement\'s deliberate differences from the template:');
for (const c of LABEL_CHANGES) console.log(`        B${c.templateRow}  "${c.from}" → "${c.to.replace(/^\s+/, m => '·'.repeat(m.length))}" — ${c.why}`);
console.log(`        a row inserted after template row ${INSERTED_AFTER_TEMPLATE_ROW}: "${INSERTED_LABEL.trim()}" (General Admin Expense's own share), its lines the row above's`);
console.log('        Net Income Statement, Balance Sheet and Underwriting: Prior (C) blank, no All Years (I); I drawn with H\'s lines');
console.log('        Underwriting: the first year\'s "Change from Prior" and "% Change Over Prior" blank');
console.log('        Reinsurance Gross / Ceded / Net: bold (cell styles, not compared)');
check(staleChanges.length === 0, `B. every listed label change is one the template has (${LABEL_CHANGES.length}), its old text the template's`,
  staleChanges.map(c => `B${c.templateRow} template "${labelAt(tws, c.templateRow - 1)}", listed "${c.from}"`).join(' · '));
check(!Array.from({ length: tRange.e.r + 1 }, (_, r) => labelAt(tws, r)).includes('Profit and Contigency'),
  'B. v2 carries no "Profit and Contigency" — the v1 row the statement removed is gone from the template itself');
const templateRows = Array.from({ length: tRange.e.r + 1 }, (_, r) => r);
/** The statement's rows: the template's, and the one inserted. */
const expectedRows = Array.from({ length: templateRows.length + 1 }, (_, r) => r);
check(TEMPLATE_ROWS.length === expectedRows.length && expectedRows.every(r => isInsertedRow(r) || TEMPLATE_ROW_OF[r] === (r < INSERTED_AFTER_TEMPLATE_ROW ? r + 1 : r)),
  `B. the statement has the template's rows and the one inserted: ${TEMPLATE_ROWS.length} of ${templateRows.length} + 1`);
const templateFormulas = templateRows.filter(r => allYearsAt(tws, r).startsWith('=')).length;
check(templateFormulas > 0 && templateRows.every(r => { const a = allYearsAt(tws, r); return !a.startsWith('=') || a === `=${allYearsFormula(r + 1)}`; }),
  'B. every All Years cell in the template is SUM(C:H) over its own row', `${templateFormulas} formulas`);
/** Column I as the statement must hold it: the template's, its SUM over the statement's own row. */
const expectedAllYears = (r: number) => {
  if (isInsertedRow(r)) return '';
  const a = allYearsAt(tws, tRowOf(r));
  return a.startsWith('=') ? `=${allYearsFormula(r + 1)}` : a;
};

function layoutDiffs(ws: XLSX.WorkSheet, ts: TemplateStatement): string[] {
  const out: string[] = [];
  const range = XLSX.utils.decode_range(ws['!ref']!);
  if (range.e.r + 1 !== expectedRows.length) out.push(`${range.e.r + 1} rows, template ${expectedRows.length}`);
  expectedRows.forEach(r => {
    if (labelAt(ws, r) !== expectedLabel(r)) out.push(`row ${r + 1}: "${labelAt(ws, r)}" ≠ "${expectedLabel(r)}" (template "${isInsertedRow(r) ? '' : labelAt(tws, tRowOf(r))}")`);
    const wantBlank = !isInsertedRow(r) && blankAt(tws, tRowOf(r));
    if (blankAt(ws, r) !== wantBlank) out.push(`row ${r + 1}: ${blankAt(ws, r) ? 'blank' : 'not blank'}, template ${wantBlank ? 'blank' : 'not blank'}`);
    // ALL YEARS: the same header, the same formula, or nothing — cell for cell.
    if (allYearsAt(ws, r) !== expectedAllYears(r)) out.push(`I${r + 1}: "${allYearsAt(ws, r)}" ≠ template "${expectedAllYears(r)}"`);
  });
  TEMPLATE_ROWS.forEach((row, r) => {
    // Nothing in C, D–H or I of a blank, title or heading row.
    if (row.kind === 'blank' || row.kind === 'title' || row.kind === 'heading') for (let c = 2; c < STATEMENT_COLUMNS; c++) {
      const x = cellOf(ws, r, c);
      if (x && x.v !== undefined && x.v !== '') out.push(`${String.fromCharCode(65 + c)}${r + 1}: "${x.v}" where the template holds nothing`);
    }
    if (row.kind === 'header') {
      // Prior only where the section shows it: the first three leave C blank.
      const prior = cellOf(ws, r, 2)?.v;
      if (showsPrior(r) ? prior !== 'Prior' : prior !== undefined && prior !== '') out.push(`C${r + 1}: "${prior ?? ''}", ${showsPrior(r) ? 'not Prior' : 'Prior where the section shows none'}`);
      ts.years.forEach((_, i) => { if (cellOf(ws, r, 3 + i)?.t !== 'n') out.push(`row ${r + 1}: year ${i} not a number or date`); });
    }
    if (row.kind === 'figure') ts.figures[row.key].forEach((_, i) => {
      const x = shownFigure(row, r, i, ts);
      const c = cellOf(ws, r, 2 + i);
      if (x === undefined) { if (c && c.v !== undefined && c.v !== '') out.push(`${String.fromCharCode(67 + i)}${r + 1}: "${c.v}" where the statement shows a blank`); return; }
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
for (const r of templateRows) for (let c = 1; c <= STATEMENT_COLUMNS; c++) {
  const n = sidesOf(tBorders, r + 1, c).split(':').length - 1;
  templateLines += n;
  if (c === ALL_YEARS_COLUMN) allYearsLines += n;
}
check(templateLines > 0 && allYearsLines > 0, 'B. the template draws borders to compare against, All Years included', `${templateLines} cell sides, ${allYearsLines} in column I`);

/**
 * A statement cell's lines as the template draws them, through the deliberate
 * differences: the template row it stands on (the inserted row the row above's),
 * and column I as column H where the section has no All Years.
 */
const expectedSides = (r: number, c: number) => sidesOf(tBorders, tRowOf(r) + 1, c === ALL_YEARS_COLUMN && !hasAllYears(r) ? ALL_YEARS_COLUMN - 1 : c);
let addedLines = 0;
for (const r of expectedRows) {
  if (!hasAllYears(r)) addedLines += expectedSides(r, ALL_YEARS_COLUMN).split(':').length - 1 - (sidesOf(tBorders, tRowOf(r) + 1, ALL_YEARS_COLUMN).split(':').length - 1);
}
check(addedLines > 0, 'B. the first three sections\' column I is drawn — the lines the statement adds to the template', `${addedLines} cell sides added`);

/** Every cell, A to I on every statement row, whose border is not the template's through the deliberate differences. */
function borderDiffs(ws: BorderSheet): string[] {
  const out: string[] = [];
  expectedRows.forEach(r => {
    for (let c = 1; c <= STATEMENT_COLUMNS; c++) {
      const want = expectedSides(r, c), got = sidesOf(ws, r + 1, c);
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

// EACH DOWNLOAD HOLDS ITS VIEW'S STATEMENTS, AND ONLY THOSE: on a line's view,
// that line's sheet alone; on the Pool view, Pool then each line — Pool alone
// when the team writes one line (its pool statement is that line's). Each
// sheet's cells are its statement's, through the layout check. Expected here
// from the game's lines, not from statementsForView.
{
  const expectedSheets = (gs: GameState, view: LineView): string[] => (view !== 'pool' ? [view] : gs.setup.activeLines.length === 1 ? ['Pool'] : ['Pool', ...gs.setup.activeLines]);
  const viewsOf = (gs: GameState): LineView[] => ['pool', ...gs.setup.activeLines];
  /** The sheet check: the file's sheets against the view's set, in order. */
  const sheetSetDiff = (names: string[], gs: GameState, view: LineView) =>
    (names.join(',') === expectedSheets(gs, view).join(',') ? [] : [`${view}: sheets ${names.join(',')}, want ${expectedSheets(gs, view).join(',')}`]);
  const sheetsFor = async (gs: GameState, view: LineView) => {
    const wb = XLSX.read(new Uint8Array(await buildAnnualStatementXlsx(gs, undefined, view)), { type: 'array', cellNF: true, cellFormula: true });
    return wb;
  };
  const oneLine = playSnapshots('1', defaultDecisionSet, { lines: ['WC'] })[2];
  for (const [name, gs] of [['three lines, after three years', games[0].snaps[YEARS]], ['WC alone, after two years', oneLine]] as const) {
    const bad: string[] = [];
    for (const view of viewsOf(gs)) {
      const wb = await sheetsFor(gs, view);
      bad.push(...sheetSetDiff(wb.SheetNames, gs, view));
      wb.SheetNames.forEach(sh => { for (const d of layoutDiffs(wb.Sheets[sh], buildTemplateStatement(gs, sh === 'Pool' ? 'pool' : sh as LineView))) bad.push(`${view} ${sh} ${d}`); });
    }
    check(bad.length === 0, `B. ${name}: each view's download holds exactly its statements (${viewsOf(gs).map(v => `${v}: ${expectedSheets(gs, v).join('+')}`).join('; ')}), each the template cell for cell`, bad.slice(0, 3).join(' · '));
  }
  // The control: the wrong set — the Pool view's file taken for a line's, and
  // the old one-line Pool file (Pool and WC both) — must fail the sheet check.
  const multi = games[0].snaps[YEARS];
  const c1 = sheetSetDiff((await sheetsFor(multi, 'pool')).SheetNames, multi, 'GL');
  check(c1.length > 0, 'B control — the Pool view\'s file on the GL view: the sheet check fails', c1[0] ?? 'NOTHING FIRED');
  const c2 = sheetSetDiff(['Pool', ...oneLine.setup.activeLines], oneLine, 'pool');
  check(c2.length > 0, 'B control — a one-line team\'s Pool file with the line\'s sheet too (the old set): the sheet check fails', c2[0] ?? 'NOTHING FIRED');
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
  // v1's spacing: a second blank row after the Contributions' Written Premium.
  const afterCyPremium = TEMPLATE_ROWS.findIndex(r => r.kind === 'figure' && r.key === 'cy.premium') + 2;
  const v1Spacing = shifted([...all.slice(0, afterCyPremium), -1, ...all.slice(afterCyPremium, -1)]);
  check(layoutDiffs(v1Spacing, ts).length > 0, 'B control — v1\'s two blank rows after Written Premium: the layout check fails', layoutDiffs(v1Spacing, ts)[0]);
  const firstBlank = TEMPLATE_ROWS.findIndex((r, i) => i > 5 && r.kind === 'blank');
  const dropped = shifted(all.filter(r => r !== firstBlank));
  check(layoutDiffs(dropped, ts).length > 0, 'B control — one blank row dropped: the layout check fails', layoutDiffs(dropped, ts)[0]);
  const noInserted = shifted(all.filter(r => !isInsertedRow(r)));
  check(layoutDiffs(noInserted, ts).length > 0, 'B control — General Admin Expense\'s own "% of Premium" row left out: the layout check fails', layoutDiffs(noInserted, ts)[0]);
  // Each deliberate label change undone (the template's old text kept), and an undeclared one: every one must fail.
  const rowOfTemplate = (t: number) => TEMPLATE_ROW_OF.findIndex((x, i) => x === t && !isInsertedRow(i));
  const undone = LABEL_CHANGES.map(c => {
    const t = shifted(all);
    t[XLSX.utils.encode_cell({ r: rowOfTemplate(c.templateRow), c: 1 })] = { t: 's', v: c.from };
    return layoutDiffs(t, ts).length > 0;
  });
  check(undone.every(Boolean), `B control — each of the ${LABEL_CHANGES.length} label changes undone, one at a time: the layout check fails on every one`,
    LABEL_CHANGES.filter((_, k) => !undone[k]).map(c => `B${c.templateRow} NOTHING FIRED`).join(' · '));
  for (const [name, r, v] of [
    ['a heading renamed that is not on the list ("Underwriting" → "Underwriting Results")', TEMPLATE_ROWS.findIndex(x => x.kind === 'title' && x.label === 'Underwriting'), 'Underwriting Results'],
    ['a label altered ("      Invested" → "Invested")', TEMPLATE_ROWS.findIndex(x => x.kind === 'figure' && x.key === 'invested'), 'Invested'],
  ] as const) {
    const t = shifted(all);
    t[XLSX.utils.encode_cell({ r, c: 1 })] = { t: 's', v: String(v) };
    check(layoutDiffs(t, ts).length > 0, `B control — ${name}: the layout check fails`, layoutDiffs(t, ts)[0]);
  }
  // The columns: Prior back in a first-three-sections header, a figure in their Prior, a first year's change filled, a stray value in a blank I.
  const nisHeader = TEMPLATE_ROWS.findIndex(r => r.kind === 'header');
  const premiumRow = TEMPLATE_ROWS.findIndex(r => r.kind === 'figure' && r.key === 'premium');
  const changeRow = TEMPLATE_ROWS.findIndex(r => r.kind === 'figure' && r.key === 'exposureChange');
  for (const [name, r, c, cell] of [
    ['"Prior" written over the Net Income Statement', nisHeader, 2, { t: 's', v: 'Prior' }],
    ['a Prior figure under the Net Income Statement', premiumRow, 2, { t: 'n', v: 1, z: STATEMENT_NUMBER_FORMAT.dollars }],
    ['the first year\'s Change from Prior filled', changeRow, 3, { t: 'n', v: 0.05, z: STATEMENT_NUMBER_FORMAT.pct }],
    ['a value in the Net Income Statement\'s blank column I', premiumRow, ALL_YEARS_COLUMN - 1, { t: 'n', v: 1 }],
  ] as const) {
    const t = shifted(all);
    t[XLSX.utils.encode_cell({ r, c })] = { ...cell } as XLSX.CellObject;
    check(layoutDiffs(t, ts).length > 0, `B control — ${name}: the layout check fails`, layoutDiffs(t, ts)[0] ?? 'NOTHING FIRED');
  }
  // All Years, row 87 (the Contributions' Total Net Incurred): its total as a plain number, then a SUM short a column.
  const ayRow = TEMPLATE_ROWS.findIndex(r => r.kind === 'figure' && r.key === 'cy.incurred');
  const asValue = shifted(all);
  asValue[XLSX.utils.encode_cell({ r: ayRow, c: ALL_YEARS_COLUMN - 1 })] = { t: 'n', v: Number(cellOf(base, ayRow, ALL_YEARS_COLUMN - 1)?.v) };
  check(layoutDiffs(asValue, ts).length > 0, `B control — an All Years total written as a number, not a formula (I${ayRow + 1}): the check fails`, layoutDiffs(asValue, ts)[0]);
  const shortRange = shifted(all);
  shortRange[XLSX.utils.encode_cell({ r: ayRow, c: ALL_YEARS_COLUMN - 1 })] = { ...cellOf(base, ayRow, ALL_YEARS_COLUMN - 1)!, f: `SUM(C${ayRow + 1}:G${ayRow + 1})` };
  check(layoutDiffs(shortRange, ts).length > 0, `B control — an All Years SUM short a column (C:G): the check fails`, layoutDiffs(shortRange, ts)[0]);

  // One line missing: the bottom line that closes the Net Income Statement (statement row 30 — template 29, below the inserted row), on H.
  const ex = new ExcelJS.Workbook();
  await ex.xlsx.load(bytes);
  const ws = ex.getWorksheet('WC')!;
  // ⚠ ITS OWN STYLE OBJECT: exceljs shares one style among every loaded cell that
  // had the same style, so setting this cell's border in place would take the
  // closing line off every section at once (it did, the first time).
  const unline = (r: number, c: number, side: 'bottom' | 'right') => {
    const cell = ws.getCell(r, c);
    const rest = { ...(cell.border ?? {}) };
    delete rest[side];
    cell.style = { ...cell.style, border: rest };
  };
  unline(30, 8, 'bottom');
  const missing = borderDiffs(ws);
  check(missing.length === 1 && missing[0].startsWith('H30'), 'B control — one border missing (H30\'s closing line): the border check fails, on exactly that cell', missing.join(' · ') || 'NOTHING FIRED');
  // Column I's line, the one the statement adds, taken off one cell of the Net Income Statement.
  unline(10, ALL_YEARS_COLUMN, 'right');
  const missingI = borderDiffs(ws).filter(d => !d.startsWith('H30'));
  check(missingI.length === 1 && missingI[0].startsWith('I10'), 'B control — the added column I line missing on I10: the border check fails, on exactly that cell', missingI.join(' · ') || 'NOTHING FIRED');
  // v1's lines, row for row: no All Years column, and its rows unshifted by the row v2 dropped.
  const v1 = new ExcelJS.Workbook();
  await v1.xlsx.readFile(TEMPLATE_V1);
  const v1ws = v1.worksheets[0];
  const v1Lines = borderDiffs({ getCell: (r, c) => v1ws.getCell(TEMPLATE_ROW_OF[r - 1] < 15 ? TEMPLATE_ROW_OF[r - 1] : TEMPLATE_ROW_OF[r - 1] + 1, c) });
  // And the template's own lines, unmapped: column I left as the template draws it (no line) in the first three sections.
  const rawTemplate = borderDiffs({ getCell: (r, c) => tBorders.getCell(TEMPLATE_ROW_OF[r - 1], c) });
  check(rawTemplate.length > 0 && rawTemplate.every(d => d.startsWith('I')), 'B control — the template\'s lines with no column I added: the border check fails, on column I only', `${rawTemplate.length} cells, first ${rawTemplate[0]}`);
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
