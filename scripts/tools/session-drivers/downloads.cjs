// ============================================================================
// THE DOWNLOADS ACTUALLY DOWNLOAD — a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/downloads.cjs
//
// ⚠ ITS OWN DRIVER, NOT A SECTION OF ANOTHER ONE, AND THE REASON IS THE DEFECT
// IT WAS WRITTEN FOR. The Results workbook was broken for a week by a caller
// passing a pooled metric list into a builder that needs the raw one. Every
// instrument missed it:
//
//   solo-export-guard   hashes buildResultsWorkbook's OUTPUT and was green —
//                       it calls the builder correctly, so the builder, which
//                       was never wrong, produced a byte-identical workbook.
//   pool-row-metric-check  asserted the pool direction only; the mirror did not
//                       exist. It does now, and it caught a SECOND instance.
//   solo-oracle         walks that very page and fingerprints its text — but
//                       text is not a file, and nothing anywhere clicked.
//
// So this is the gap those three leave between them: a builder that is correct,
// a page that calls it wrongly, and a button whose failure is a thrown
// exception rather than a changed pixel. It belongs in its own file because it
// is the only driver whose subject is the BROWSER'S download pipe rather than
// the session contract — the other eight are host/player/room drivers and this
// shares no fixture with them.
//
// WHAT IT ASSERTS, per button: a download event arrives, the file is non-empty,
// and NO page error fires. The third is the one that was failing — the throw
// happened before XLSX.writeFile, so the symptom was silence.
// ============================================================================
const { launchBrowser, requireServer, BASE, REPO } = require('./_shared.cjs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const fs = require('node:fs');
const XLSX = require('xlsx');

const fails = [];
let checks = 0;
function ok(c, w, d = '') { checks++; const line = w + (d ? `  — ${d}` : ''); if (!c) { fails.push(line); console.log('  FAIL  ' + line); } else console.log('  ok    ' + line); }

// Every download the app offers. A new one belongs here the day it ships.
const BUTTONS = [
  { name: 'Download Results (.xlsx)', min: 10_000, tab: 'Result Spreadsheet' },
  // ⚠ NO LONGER NAMES ITS WORLD: the workbook is still world 1's (an averaged
  // year has no claims of its own), but players are never told about the worlds.
  { name: 'Download Claims (.xlsx)', min: 10_000, tab: 'Result Spreadsheet' },
  // The template-laid-out statement (annualStatementExport.ts), on its own page:
  // the file must open as a workbook whose first sheet is the pool's.
  { name: 'Download Annual Statement (Excel)', min: 5_000, tab: 'Annual Statement', sheets: true },
  // ⚠ 'Download Members CSV' CAME OFF. The button is hidden with the other
  // member-level views (SHOW_MEMBER_VIEWS in ResultSpreadsheetPage); buildMemberCsv
  // still runs, so restoring the flag restores the download and this row.
];

/**
 * THE SCREEN'S LINES ARE THE TEMPLATE'S. Every rendered statement row carries
 * its row in the file (data-template-row); each of its cells — B to H, and I
 * (All Years) in the program-year sections — must draw exactly the sides the
 * TEMPLATE FILE draws on that cell: the Pool sheet of docs/Annual Statement
 * Example v2.xlsx, read here itself, not from the table the page draws from. And
 * every template row that carries a line must be on the screen, with a cell for
 * every bordered column.
 */
async function screenBordersMatchTemplate(page) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(REPO, 'docs', 'Annual Statement Example v2.xlsx'));
  const tws = wb.getWorksheet('Pool');
  const sidesAt = (r, c) => { const b = tws.getCell(r, c).border || {}; return ['left', 'right', 'top', 'bottom'].filter(k => b[k] && b[k].style).map(k => k[0].toUpperCase()).join(''); };
  const rows = await page.$$eval('[data-testid="annual-statement"] tr[data-template-row]', trs => trs.map(tr => ({
    r: Number(tr.dataset.templateRow),
    cells: [...tr.children].map(td => { const s = getComputedStyle(td); return [['L', s.borderLeftWidth], ['R', s.borderRightWidth], ['T', s.borderTopWidth], ['B', s.borderBottomWidth]].filter(([, w]) => w !== '0px').map(([k]) => k).join(''); }),
  })));
  const bad = [];
  for (const { r, cells } of rows) {
    // B..H always; I wherever the template draws a line in it on this row.
    const want = [2, 3, 4, 5, 6, 7, 8, 9].map(c => sidesAt(r, c));
    // Seven cells, B to H — and an eighth wherever the template draws in I. A
    // blank row of a program-year section may carry an I cell with no line,
    // exactly as the template's empty I is there.
    if (cells.length < 7 || cells.length > 8 || (want[7] && cells.length !== 8)) bad.push(`row ${r}: ${cells.length} cells`);
    cells.forEach((got, c) => { if (got !== want[c]) bad.push(`${String.fromCharCode(66 + c)}${r}: "${got}" ≠ template "${want[c]}"`); });
  }
  const shown = new Set(rows.map(x => x.r));
  const unshown = [];
  for (let r = 1; r <= tws.rowCount; r++) if (!shown.has(r) && [2, 3, 4, 5, 6, 7, 8, 9].some(c => sidesAt(r, c))) unshown.push(r);
  const allYearsCells = rows.filter(x => x.cells.length === 8).length;
  ok(rows.length > 0 && bad.length === 0, `Annual Statement: every cell on screen draws the v2 template's lines (${rows.length} rows, ${allYearsCells} with All Years)`, bad.slice(0, 3).join(' · '));
  ok(unshown.length === 0, 'Annual Statement: every template row with a line is on the screen', unshown.join(', '));
  const heads = await page.$$eval('[data-testid="annual-statement"] tr[data-row-kind="header"]', trs => trs.map(tr => tr.lastElementChild.textContent.trim()));
  ok(heads.filter(h => h === 'All Years').length === 5, 'Annual Statement: "All Years" heads Contributions, Program Year Totals and the Gross, Ceded and Net blocks', heads.join(' | '));
}

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  // ⚠ acceptDownloads, OR waitForEvent('download') NEVER FIRES and every button
  // reads as broken. The failure mode of forgetting it looks exactly like the
  // defect this driver exists to catch, so it is stated rather than assumed.
  const ctx = await browser.newContext({ acceptDownloads: true, baseURL: BASE });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  // Every script the page fetches: the statement's Excel library must be fetched on the button, never with the page.
  const scripts = [];
  page.on('request', r => { if (r.resourceType() === 'script') scripts.push(r.url()); });

  // ⚠ /solo, NOT /. The root is the LOBBY now; this driver drives the SOLO
  // game, so it follows the game rather than the URL.
  await page.goto('/solo');
  // The scenario menu (stable-scenarios commit 9) or, on a tree from before it,
  // the free seed field.
  await page.waitForSelector('[data-testid="scenario"], input[placeholder="e.g. ABC12345"]', { timeout: 20000 });
  if (await page.locator('[data-testid="scenario"]').count() > 0) await page.locator('[data-testid="scenario"]').selectOption('7');
  else await page.locator('input[placeholder="e.g. ABC12345"]').fill('MAMC6EA4');
  await page.getByRole('button', { name: 'Single player', exact: true }).click();
  await page.waitForSelector('text=Lock Program Year', { timeout: 30000 });

  // ⚠ TWO LOCKED YEARS. A played year's results — and the spreadsheet's
  // downloads with them — show as soon as it is locked (utils/knownYears: the
  // year just completed is known), so one would do; two give the exports a
  // played year with a year after it, as they had while results ran a year
  // behind. A third would only make the driver slower.
  for (const next of [2028, 2029]) {
    await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
    await page.waitForTimeout(2500);
    const decline = page.getByRole('button', { name: /Decline/i }).first();
    if (await decline.count() > 0) {
      await decline.click(); await page.waitForTimeout(600);
      const confirm = page.getByRole('button', { name: /Confirm & Continue/i }).first();
      if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(600); }
    }
    await page.waitForSelector(`text=Lock Program Year ${next}`, { timeout: 120000 });
  }

  let onTab = null;
  for (const { name, min, tab, sheets } of BUTTONS) {
    if (tab !== onTab) {
      await page.getByRole('button', { name: tab, exact: true }).first().click();
      await page.waitForTimeout(1200);
      console.log(`\n  on the ${tab} page\n`);
      onTab = tab;
      if (tab === 'Annual Statement') {
        ok(!scripts.some(u => /exceljs/i.test(u)), 'Annual Statement: its Excel library (exceljs) is not loaded with the page');
        await screenBordersMatchTemplate(page);
      }
    }
    const before = errs.length;
    const btn = page.getByRole('button', { name, exact: false }).first();
    if (await btn.count() === 0) { ok(false, `${name}: the button is not on the page`); continue; }

    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      btn.click(),
    ]);
    await page.waitForTimeout(600);
    const thrown = errs.slice(before);

    if (!dl) {
      ok(false, `${name}: no file arrived${thrown.length ? ` — ${thrown[0]}` : ''}`);
      continue;
    }
    const path = await dl.path().catch(() => null);
    const size = path && fs.existsSync(path) ? fs.statSync(path).size : 0;
    ok(size >= min, `${name}: ${dl.suggestedFilename()}, ${size} bytes (>= ${min})`);
    if (sheets) ok(scripts.some(u => /exceljs/i.test(u)), `${name}: its Excel library (exceljs) was fetched for the file`);
    if (sheets && size > 0) {
      const names = XLSX.read(fs.readFileSync(path), { type: 'buffer' }).SheetNames;
      ok(names[0] === 'Pool' && names.length >= 2, `${name}: opens as a workbook, the pool's sheet first and one per line (${names.join(', ')})`);
    }
    ok(thrown.length === 0, `${name}: no page error${thrown.length ? ` — ${thrown.join('; ')}` : ''}`);
  }

  ok(errs.length === 0, `no page errors over the whole run${errs.length ? ` — ${errs.join('; ')}` : ''}`);
  await browser.close();

  console.log(`\ndownloads: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log('DOWNLOADS PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
