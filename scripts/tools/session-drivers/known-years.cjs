// ============================================================================
// RESULTS RUN ONE YEAR BEHIND — what a player can see, a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/known-years.cjs
//
// The pool sits in the current year while the board prices the next, and
// results stop at the LATEST KNOWN YEAR — the current year less one
// (utils/knownYears). A solo game of three years, scenario 7, from Program Year
// 2027: in 2026 the newest result is 2025; after one advance 2026; after two
// 2027; at game end the final year, 2029, since it is complete.
//
// At each of those four points, on every screen that shows results — the
// Annual Statement, Financial Statements, Results, Result Spreadsheet,
// Calculation Audit and the Model tab's expected-against-simulated section —
// every year printed (and every year-end "12/31/yy", and every option of the
// page's year selector) is at or before the latest known year; and the Annual
// Statement's newest column IS that year, so the check cannot pass on a page
// that shows nothing. Where the spreadsheet offers its downloads, the Results
// workbook's columns and the Claims workbook's accident, calendar and valuation
// years stop there too. The pages that are about pricing — Decisions, Decision
// History, the Rate Indication and the Model tab's rate — are not read: they
// name the program year being priced.
// ============================================================================
const fs = require('node:fs');
const XLSX = require('xlsx');
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

const START = 2027, LENGTH = 3;
let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

/** Every calendar year a text names: 2021-2049, and year-ends 12/31/yy. */
function yearsIn(text) {
  const out = [];
  // Whole tokens only: not the digits of a figure such as 4.2027 or 311.2031%.
  for (const m of text.matchAll(/(?<![\d.,$])(20[2-4]\d)(?![\d.,%])/g)) out.push(Number(m[1]));
  for (const m of text.matchAll(/\b12\/31\/(\d{2})\b/g)) out.push(2000 + Number(m[1]));
  return out;
}

const RESULT_TABS = ['Annual Statement', 'Financial Statements', 'Results', 'Result Spreadsheet', 'Calculation Audit'];

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const tab = async name => { await page.getByRole('button', { name, exact: true }).first().click(); await page.waitForTimeout(600); };

  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption('7');
  await page.locator('input[type="range"]').first().fill(String(LENGTH));
  await page.getByRole('button', { name: 'Start Simulation' }).click();
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });

  async function readExports(known, knownNumber, name) {
    for (const [label, kind] of [['Download Results (.xlsx)', 'results'], ['Download Claims (.xlsx)', 'claims']]) {
      const btn = page.getByRole('button', { name: label, exact: false }).first();
      if (await btn.count() === 0) { ok(false, `${name}: the ${kind} download is offered`); continue; }
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), btn.click()]);
      const path = dl ? await dl.path() : null;
      if (!path || !fs.existsSync(path)) { ok(false, `${name}: the ${kind} workbook downloads`); continue; }
      const wb = XLSX.readFile(path);
      if (kind === 'results') {
        const years = wb.SheetNames.flatMap(s => XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1 })[0] ?? [])
          .flatMap(h => [...String(h).matchAll(/^Year (-?\d+) \/ (\d{4})$/g)].map(m => Number(m[2])));
        ok(years.length > 0 && Math.max(...years) === known,
          `${name}: the Results workbook's columns stop at ${known}`, `${years.length} year columns, newest ${Math.max(...years)}`);
      } else {
        let worstAy = -Infinity, worstCal = -Infinity, worstVal = -Infinity;
        for (const s of wb.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1 });
          const h = rows.findIndex(r => Array.isArray(r) && r.includes('Accident Year'));
          if (h < 0) continue;
          const head = rows[h];
          const ay = head.indexOf('Accident Year'), cal = head.indexOf('Calendar Year');
          head.forEach(c => { const m = /^Yr (-?\d+)$/.exec(String(c)); if (m) worstVal = Math.max(worstVal, Number(m[1])); });
          for (const r of rows.slice(h + 1)) {
            if (ay >= 0 && typeof r[ay] === 'number') worstAy = Math.max(worstAy, r[ay]);
            if (cal >= 0 && typeof r[cal] === 'number') worstCal = Math.max(worstCal, r[cal]);
          }
        }
        ok(worstAy <= knownNumber && worstVal <= knownNumber && worstCal <= known,
          `${name}: the Claims workbook stops at ${known} (year ${knownNumber})`,
          `newest accident year ${worstAy}, valuation Yr ${worstVal}, calendar year ${worstCal}`);
      }
    }
  }

  async function check(name, known, knownNumber) {
    for (const t of RESULT_TABS) {
      await tab(t);
      const main = page.locator('main');
      const text = await main.innerText();
      const options = await main.locator('select option').allInnerTexts();
      const ys = [...yearsIn(text), ...options.flatMap(yearsIn)];
      const newest = ys.length ? Math.max(...ys) : null;
      ok(newest === null || newest <= known, `${name}, ${t}: no year after ${known}`, `newest shown ${newest ?? 'none'}`);
      if (t === 'Annual Statement') {
        const cols = await page.locator('[data-testid="statement-operating"] thead th').allInnerTexts();
        const yearCols = cols.map(c => c.trim()).filter(c => /^\d{4}$/.test(c)).map(Number);
        ok(yearCols.at(-1) === known, `${name}, Annual Statement: its newest column is ${known}`, yearCols.join(' '));
        const opts = await page.locator('[data-testid="statement-year"] option').allInnerTexts();
        const last = yearsIn(opts.at(-1) ?? '');
        ok(last.length > 0 && last[0] === known, `${name}, Annual Statement: the selector offers years up to ${known}`, opts.at(-1));
      }
      if (t === 'Result Spreadsheet' && knownNumber >= 1) await readExports(known, knownNumber, name);
    }
    await tab('Model');
    const ids = await page.$$eval('[data-testid^="model-b-"]', els => els.map(e => e.getAttribute('data-testid')));
    const modelYears = ids.map(id => Number((/-(\d{4})-(?:exp|sim)$/.exec(id) ?? [])[1])).filter(Number.isFinite);
    ok(modelYears.length > 0 && Math.max(...modelYears) === known, `${name}, Model: expected against simulated stops at ${known}`,
      `newest ${Math.max(...modelYears)}`);
  }

  // In 2026 pricing 2027: through 2025 (year -1). Each advance adds a year.
  for (let n = 1; n <= LENGTH; n++) {
    const known = START + n - 3;
    await check(`in ${START + n - 2}, pricing ${START + n - 1}`, known, n - 2);
    await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
    await page.waitForTimeout(2500);
    const decline = page.getByRole('button', { name: /Decline/i }).first();
    if (await decline.count() > 0) {
      await decline.click(); await page.waitForTimeout(600);
      const confirm = page.getByRole('button', { name: /Confirm & Continue/i }).first();
      if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(600); }
    }
    if (n < LENGTH) await page.waitForSelector(`text=Lock Program Year ${START + n}`, { timeout: 120000 });
    else await page.waitForSelector('text=Game Complete', { timeout: 120000 });
  }
  // The game is over: the final year shows, since it is complete.
  await check('at game end', START + LENGTH - 1, LENGTH);

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\nknown-years: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'KNOWN YEARS PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
