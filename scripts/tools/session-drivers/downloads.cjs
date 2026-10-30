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
const { launchBrowser, requireServer, BASE, REPO, lockAndConfirm } = require('./_shared.cjs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const fs = require('node:fs');
const XLSX = require('xlsx');

const fails = [];
let checks = 0;
function ok(c, w, d = '') { checks++; const line = w + (d ? `  — ${d}` : ''); if (!c) { fails.push(line); console.log('  FAIL  ' + line); } else console.log('  ok    ' + line); }

// Every download the app offers. A new one belongs here the day it ships.
// ⚠ 'Download Results (.xlsx)' AND 'Download Claims (.xlsx)' CAME OFF WITH THE
// RESULT SPREADSHEET TAB (the tab cleanup, tabs.tsx HIDDEN_TABS): ruled fine to
// lose, the Annual Statement covering what players need. Their builders still run
// (solo-export-guard). Below, the tab is asserted absent so neither button can be
// reached by any player.
const GONE = ['Result Spreadsheet', 'Results', 'Financial Statements', 'Model'];
const BUTTONS = [
  // The template-laid-out statement (annualStatementExport.ts), on its own page:
  // the file must open as a workbook whose first sheet is the pool's.
  { name: 'Download Annual Statement (Excel)', min: 5_000, tab: 'Annual Statement', sheets: true },
  // The same statement as a PDF (annualStatementPdf.ts), its library (jsPDF)
  // fetched only on the press: the file must open as a PDF, landscape Letter,
  // one statement per sheet in the workbook's order, each page headed with the
  // year the statement stands at and numbered.
  { name: 'Download Annual Statement (PDF)', min: 5_000, tab: 'Annual Statement', pdf: true },
  // The Year Walkthrough's own workbook: every year and view, the version, no seed
  // in single player (year-walkthrough.cjs reads it in every mode).
  { name: 'Download Year Walkthrough (Excel)', min: 5_000, tab: 'Year Walkthrough', walk: true },
  // ⚠ 'Download Members CSV' CAME OFF. The button is hidden with the other
  // member-level views (SHOW_MEMBER_VIEWS in ResultSpreadsheetPage); buildMemberCsv
  // still runs, so restoring the flag restores the download and this row.
];

/**
 * THE SCREEN'S LINES ARE THE TEMPLATE'S, THROUGH ITS TWO LINE DIFFERENCES. Every
 * rendered statement row carries its row in the file (data-template-row); each
 * of its eight cells, B to I, must draw exactly the sides the TEMPLATE FILE
 * draws on that cell — the Pool sheet of docs/Annual Statement Example v2.xlsx,
 * read here itself, not from the table the page draws from — but for the
 * statement's deliberate differences: the row it inserts after template row 13
 * (General Admin Expense's own "% of Premium") draws row 13's lines, and every
 * row after it stands on the template row one above; and above the Contributions
 * the sections have no All Years, so I draws H's lines, every box the same
 * width. And every template row that carries a line must be on the screen.
 */
/**
 * EACH VIEW'S DOWNLOADS HOLD ITS STATEMENTS. From the Annual Statement page, on
 * the Pool view and on every line's view of `lines`: both buttons pressed, each
 * file named by the view and the year the statement stands at
 * ("Annual_Statement_WC_2028.xlsx"), the workbook's sheets and the PDF's
 * statements (read from its page headers) exactly the view's — a line's alone;
 * on the Pool view the pool's then each line's, or the pool's alone for a
 * one-line team.
 */
const VIEW_SHORT = { Pool: 'Pool', "Workers' Compensation": 'WC', 'General Liability': 'GL', Property: 'Property' };
async function downloadsByView(page, tag, lines) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const fonts = path.join(REPO, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
  for (const view of ['Pool', ...lines]) {
    await page.getByRole('button', { name: view, exact: true }).first().click();
    await page.waitForTimeout(500);
    const year = (await page.locator('[data-testid="statement-operating"] tr[data-row-kind="header"] th').allInnerTexts()).map(t => t.trim()).filter(t => /^\d{4}$/.test(t)).at(-1);
    const v = VIEW_SHORT[view];
    const want = v !== 'Pool' ? [v] : lines.length === 1 ? ['Pool'] : ['Pool', ...lines.map(l => VIEW_SHORT[l])];
    for (const [button, ext] of [['Download Annual Statement (Excel)', 'xlsx'], ['Download Annual Statement (PDF)', 'pdf']]) {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), page.getByRole('button', { name: button }).first().click()]);
      if (!dl) { ok(false, `${tag}, ${view} view, ${ext}: no file arrived`); continue; }
      const file = await dl.path();
      let got = [];
      if (ext === 'xlsx') got = XLSX.read(fs.readFileSync(file), { type: 'buffer' }).SheetNames;
      else {
        const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), standardFontDataUrl: fonts, isEvalSupported: false }).promise;
        for (let p = 1; p <= doc.numPages; p++) {
          const text = (await (await doc.getPage(p)).getTextContent()).items.map(it => it.str).join(' ');
          const m = text.match(/ - (Pool|Workers' Compensation|General Liability|Property) - Annual Statement as of 12\/31\/(\d{4})/);
          const sh = m ? VIEW_SHORT[m[1]] : '?';
          if (got.at(-1) !== sh) got.push(sh);
        }
      }
      ok(dl.suggestedFilename() === `Annual_Statement_${v}_${year}.${ext}` && got.join(',') === want.join(','),
        `${tag}, ${view} view: "${button}" holds the view's statements (${want.join(', ')})`, `${dl.suggestedFilename()}: ${got.join(', ')}`);
    }
  }
}

async function screenBordersMatchTemplate(page) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(REPO, 'docs', 'Annual Statement Example v2.xlsx'));
  const tws = wb.getWorksheet('Pool');
  const sidesAt = (r, c) => { const b = tws.getCell(r, c).border || {}; return ['left', 'right', 'top', 'bottom'].filter(k => b[k] && b[k].style).map(k => k[0].toUpperCase()).join(''); };
  const INSERTED_AFTER = 13;
  const templateRowOf = r => (r <= INSERTED_AFTER ? r : r === INSERTED_AFTER + 1 ? INSERTED_AFTER : r - 1);
  let contributionsRow = 0;
  for (let r = 1; r <= tws.rowCount; r++) if (String(tws.getCell(r, 2).value || '').startsWith('Contributions To The Current Calendar Year')) { contributionsRow = r; break; }
  const rows = await page.$$eval('[data-testid="annual-statement"] tr[data-template-row]', trs => trs.map(tr => ({
    s: Number(tr.dataset.templateRow),
    cells: [...tr.children].map(td => { const s = getComputedStyle(td); return [['L', s.borderLeftWidth], ['R', s.borderRightWidth], ['T', s.borderTopWidth], ['B', s.borderBottomWidth]].filter(([, w]) => w !== '0px').map(([k]) => k).join(''); }),
  })));
  const bad = [];
  for (const { s, cells } of rows) {
    const r = templateRowOf(s);
    // B..I; above the Contributions, I is drawn as H.
    const want = [2, 3, 4, 5, 6, 7, 8, r < contributionsRow ? 8 : 9].map(c => sidesAt(r, c));
    if (cells.length !== 8) bad.push(`row ${s}: ${cells.length} cells`);
    cells.forEach((got, c) => { if (got !== want[c]) bad.push(`${String.fromCharCode(66 + c)}${s} (template ${r}): "${got}" ≠ template "${want[c]}"`); });
  }
  ok(contributionsRow > 0, 'Annual Statement: the template\'s Contributions title found, where All Years begins', `row ${contributionsRow}`);
  const shown = new Set(rows.map(x => templateRowOf(x.s)));
  const unshown = [];
  for (let r = 1; r <= tws.rowCount; r++) if (!shown.has(r) && [2, 3, 4, 5, 6, 7, 8, 9].some(c => sidesAt(r, c))) unshown.push(r);
  const allYearsRows = rows.filter(x => templateRowOf(x.s) > contributionsRow).length;
  ok(rows.length > 0 && bad.length === 0, `Annual Statement: every cell on screen draws the v2 template's lines through the statement's differences (${rows.length} rows, ${allYearsRows} with All Years)`, bad.slice(0, 3).join(' · '));
  ok(unshown.length === 0, 'Annual Statement: every template row with a line is on the screen', unshown.join(', '));
  const heads = await page.$$eval('[data-testid="annual-statement"] tr[data-row-kind="header"]', trs => trs.map(tr => tr.lastElementChild.textContent.trim()));
  ok(heads.filter(h => h === 'All Years').length === 5, 'Annual Statement: "All Years" heads Contributions, Program Year Totals and the Gross, Ceded and Net blocks', heads.join(' | '));
  // THE COLUMNS AND HEADINGS AS ASKED: every table seven columns wide (label, C,
  // five years, I); the first three sections' C and I blank; "% of Premium"
  // indented and left-aligned; the Reinsurance blocks' names bold, on the left.
  const layout = await page.evaluate(() => {
    const sec = id => document.querySelector(`[data-testid="${id}"]`);
    const headOf = id => [...sec(id).querySelector('tr[data-row-kind="header"]').children].map(th => th.textContent.trim());
    const pct = [...sec('statement-operating').querySelectorAll('tr[data-row-label="% of Premium"] td:first-child')].map(td => getComputedStyle(td).textAlign);
    const blocks = ['statement-gross', 'statement-ceded', 'statement-net'].map(id => { const th = sec(id).querySelector('tr[data-row-kind="header"] th'); const st = getComputedStyle(th); return { t: th.textContent.trim(), w: Number(st.fontWeight), a: st.textAlign }; });
    const titles = [...document.querySelectorAll('[data-testid="annual-statement"] section h2')].map(h => h.textContent.trim());
    const labels = [...sec('statement-operating').querySelectorAll('tr[data-row-label]')].map(tr => tr.dataset.rowLabel);
    return { op: headOf('statement-operating'), bal: headOf('statement-balance'), uw: headOf('statement-underwriting'), cy: headOf('statement-contributions'), pct, blocks, titles, labels };
  });
  const sevenWide = h => h.length === 8;
  ok([layout.op, layout.bal, layout.uw].every(h => sevenWide(h) && h[1] === '' && h[7] === ''), 'Annual Statement: the first three tables are seven columns wide, C and I blank', [layout.op, layout.bal, layout.uw].map(h => h.join('|')).join(' / '));
  ok(sevenWide(layout.cy) && layout.cy[1] === 'Prior' && layout.cy[7] === 'All Years', 'Annual Statement: the Contributions keep Prior and All Years, the years in the same columns', layout.cy.join('|'));
  ok(layout.pct.length === 4 && layout.pct.every(a => a === 'left' || a === 'start'), 'Annual Statement: the four "% of Premium" rows are left-aligned', layout.pct.join(' '));
  ok(layout.blocks.map(b => b.t).join() === 'Gross,Ceded,Net' && layout.blocks.every(b => b.w >= 700 && (b.a === 'left' || b.a === 'start')), 'Annual Statement: Gross, Ceded and Net head their blocks in bold, on the left', JSON.stringify(layout.blocks));
  ok(layout.titles.includes('Contributions To The Current Calendar Year - Net of Reinsurance') && layout.titles.includes('Program Year Totals - Net of Reinsurance'), 'Annual Statement: the two "- Net of Reinsurance" headings', layout.titles.join(' | '));
  const adminRows = layout.labels.slice(layout.labels.indexOf('General Admin Expense'), layout.labels.indexOf('General Admin Expense') + 4);
  ok(layout.labels[0] === 'Written Premium' && adminRows.join('|') === 'General Admin Expense|% of Premium|Other Admin Expense|% of Premium', 'Annual Statement: Written Premium, and the admin rows General / % / Other / %', `${layout.labels[0]} · ${adminRows.join('|')}`);
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
    await lockAndConfirm(page);
    await page.waitForTimeout(2500);
    const decline = page.getByRole('button', { name: /Decline/i }).first();
    if (await decline.count() > 0) {
      await decline.click(); await page.waitForTimeout(600);
      const confirm = page.getByRole('button', { name: /Confirm & Continue/i }).first();
      if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(600); }
    }
    await page.waitForSelector(`text=Lock Program Year ${next}`, { timeout: 120000 });
  }

  const bar = (await page.locator('nav').first().locator('button').allInnerTexts()).map(t => t.trim());
  ok(GONE.every(t => !bar.includes(t)), `the bar offers none of ${GONE.join(', ')}, so their downloads are unreachable`, bar.join(' | '));
  ok(await page.getByRole('button', { name: /Download (Results|Claims) \(\.xlsx\)/ }).count() === 0, 'no Results or Claims download anywhere on the page');

  let onTab = null;
  let workbookSheets = null, statementYear = null;
  for (const { name, min, tab, sheets, pdf, walk } of BUTTONS) {
    if (tab !== onTab) {
      await page.getByRole('button', { name: tab, exact: true }).first().click();
      await page.waitForTimeout(1200);
      console.log(`\n  on the ${tab} page\n`);
      onTab = tab;
      if (tab === 'Annual Statement') {
        ok(!scripts.some(u => /exceljs/i.test(u)), 'Annual Statement: its Excel library (exceljs) is not loaded with the page');
        ok(!scripts.some(u => /jspdf/i.test(u)), 'Annual Statement: its PDF library (jsPDF) is not loaded with the page');
        const heads = (await page.locator('[data-testid="statement-operating"] tr[data-row-kind="header"] th').allInnerTexts()).map(t => t.trim()).filter(t => /^\d{4}$/.test(t));
        statementYear = heads.at(-1);
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
    const dlPath = await dl.path().catch(() => null);
    const size = dlPath && fs.existsSync(dlPath) ? fs.statSync(dlPath).size : 0;
    ok(size >= min, `${name}: ${dl.suggestedFilename()}, ${size} bytes (>= ${min})`);
    if (sheets) ok(scripts.some(u => /exceljs/i.test(u)), `${name}: its Excel library (exceljs) was fetched for the file`);
    if (sheets && size > 0) {
      const names = XLSX.read(fs.readFileSync(dlPath), { type: 'buffer' }).SheetNames;
      // This game writes one line, so the Pool view's file is the pool's statement alone (statementsForView).
      ok(names.join(',') === 'Pool', `${name}: opens as a workbook — on a one-line team's Pool view, the pool's sheet alone (${names.join(', ')})`);
      workbookSheets = names;
    }
    if (walk && size > 0) {
      const wb = XLSX.read(fs.readFileSync(dlPath), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      ok(/^Year_Walkthrough_\d{4}\.xlsx$/.test(dl.suggestedFilename()) && wb.SheetNames.join(',') === 'Year Walkthrough',
        `${name}: named Year_Walkthrough_<year>, one Year Walkthrough sheet`, `${dl.suggestedFilename()} · ${wb.SheetNames.join(', ')}`);
      ok(rows.some(r => r[0] === 'Version') && !rows.some(r => r[0] === 'Seed'), `${name}: carries the version and, in single player, no seed`);
    }
    if (pdf) ok(scripts.some(u => /jspdf/i.test(u)), `${name}: its PDF library (jsPDF) was fetched for the file`);
    if (pdf && size > 0) {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const fonts = path.join(REPO, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
      const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(dlPath)), standardFontDataUrl: fonts, isEvalSupported: false }).promise;
      const pages = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const pg = await doc.getPage(p);
        const vp = pg.getViewport({ scale: 1 });
        const text = (await pg.getTextContent()).items.map(it => it.str).join(' ');
        pages.push({ w: vp.width, h: vp.height, scope: (text.match(/ - (Pool|Workers' Compensation|General Liability|Property) - Annual Statement as of 12\/31\/(\d{4})/) || []), text });
      }
      ok(pages.length > 0 && pages.every(p => p.w === 792 && p.h === 612), `${name}: opens as a PDF, ${pages.length} pages, landscape Letter`);
      // The sheets, in order of first appearance, are the workbook's: Pool, then each line.
      const SHORT = { Pool: 'Pool', "Workers' Compensation": 'WC', 'General Liability': 'GL', Property: 'Property' };
      const order = []; for (const p of pages) { const s = SHORT[p.scope[1]]; if (s && order.at(-1) !== s) order.push(s); }
      ok(workbookSheets && order.join(',') === workbookSheets.join(','), `${name}: one statement per sheet, in the workbook's order (${order.join(', ')})`, `workbook ${workbookSheets && workbookSheets.join(', ')}`);
      ok(pages.every(p => p.scope[2] === statementYear), `${name}: every page's header names the year the statement stands at (${statementYear})`, [...new Set(pages.map(p => p.scope[2]))].join(', '));
      ok(pages.every((p, k) => p.text.includes(`Page ${k + 1} of ${pages.length}`)), `${name}: every page numbered "Page n of ${pages.length}"`);
      ok(pages[0].text.includes('Written Premium') && pages[0].text.includes('Net Income Statement For The Year'), `${name}: the first page opens with the pool's Net Income Statement`);
    }
    ok(thrown.length === 0, `${name}: no page error${thrown.length ? ` — ${thrown.join('; ')}` : ''}`);
  }

  // The statement downloads by view: this one-line game, then a three-line one.
  await page.getByRole('button', { name: 'Annual Statement', exact: true }).first().click();
  await page.waitForTimeout(800);
  await downloadsByView(page, 'one-line game (WC)', ["Workers' Compensation"]);
  {
    const multi = await ctx.newPage();
    multi.on('pageerror', e => errs.push(e.message));
    await multi.goto('/solo');
    await multi.evaluate(() => localStorage.clear());
    await multi.reload();
    await multi.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
    await multi.locator('[data-testid="scenario"]').selectOption('7');
    for (const label of ["Workers' Compensation", 'General Liability', 'Property']) {
      const btn = multi.locator('button', { hasText: label }).first();
      if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
    }
    await multi.getByRole('button', { name: 'Single player', exact: true }).click();
    await multi.waitForSelector('text=Lock Program Year', { timeout: 60000 });
    await lockAndConfirm(multi);
    await multi.waitForTimeout(2500);
    const decline = multi.getByRole('button', { name: /Decline/i }).first();
    if (await decline.count() > 0) {
      await decline.click(); await multi.waitForTimeout(600);
      const confirm = multi.getByRole('button', { name: /Confirm & Continue/i }).first();
      if (await confirm.count() > 0) { await confirm.click(); await multi.waitForTimeout(600); }
    }
    await multi.waitForSelector('text=Lock Program Year 2028', { timeout: 120000 });
    await multi.getByRole('button', { name: 'Annual Statement', exact: true }).first().click();
    await multi.waitForTimeout(800);
    await downloadsByView(multi, 'three-line game', ["Workers' Compensation", 'General Liability', 'Property']);
  }

  ok(errs.length === 0, `no page errors over the whole run${errs.length ? ` — ${errs.join('; ')}` : ''}`);
  await browser.close();

  console.log(`\ndownloads: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log('DOWNLOADS PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
