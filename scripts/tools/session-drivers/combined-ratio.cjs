// THE COMBINED RATIO AT THE TOP MATCHES THE STATEMENT'S — what a player sees.
//
// The header's "Combined ratio" and "Cumulative" chips are read off the Annual
// Statement's first row (resultsStatement.topCombinedRatio), for the view on
// screen. This drives a solo game on scenario 7, three lines, through the real
// setup screen and, on the Annual Statement tab, for the pool and every line:
//
//   - before year 1, the chip is the last pre-game year's cell and Cumulative
//     is blank (the statement's Total reads "—");
//   - after years 1 and 2, the chip is the latest year's cell and Cumulative is
//     the row's Total;
//   - the old "Loss Ratio (prem + admin)" chip is gone from the header.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/combined-ratio.cjs
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

const ROW = 'Combined Ratio (all costs over member charge)';
const VIEWS = ['Pool', "Workers' Compensation", 'General Liability', 'Property'];
const pct = t => { const m = (t || '').replace(/−/g, '-').trim(); return m === '' || m === '—' ? null : parseFloat(m); };

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption('7');
  for (const label of ["Workers' Compensation", 'General Liability', 'Property']) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
  await page.getByRole('button', { name: 'Start Simulation' }).click();
  await page.waitForSelector('text=Lock Year', { timeout: 60000 });

  const headerText = async () => (await page.locator('header').innerText()).replace(/\s+/g, ' ');
  async function compare(phase, playedYears) {
    await page.getByRole('button', { name: /^Annual Statement$/ }).first().click();
    await page.waitForSelector('[data-testid="annual-statement"]', { timeout: 20000 });
    const head = await headerText();
    ok(!/Loss Ratio \(prem \+ admin\)/.test(head), `${phase}: the old loss-ratio chip is gone from the header`);
    for (const view of VIEWS) {
      await page.getByRole('button', { name: view, exact: true }).first().click();
      await page.waitForTimeout(400);
      const chip = await page.textContent('[data-testid="header-combined-ratio"]');
      const cum = await page.textContent('[data-testid="header-combined-cumulative"]');
      const cells = await page.locator(`[data-testid="statement-operating"] tr[data-row-label="${ROW}"] td`).allInnerTexts();
      if (cells.length < 3) { ok(false, `${phase}, ${view}: the statement's first row is the combined ratio`, `${cells.length} cells`); continue; }
      const first = await page.locator('[data-testid="statement-operating"] tbody tr').first().getAttribute('data-row-label');
      ok(first === ROW, `${phase}, ${view}: the combined ratio is the statement's first row`, first ?? '');
      const latest = cells[cells.length - 2], total = cells[cells.length - 1];
      ok(pct(chip) !== null && pct(chip) === pct(latest), `${phase}, ${view}: the chip is the statement's latest year`, `chip ${chip} · statement ${latest}`);
      if (playedYears === 0) {
        ok(pct(cum) === null && (cum || '').trim() === '', `${phase}, ${view}: Cumulative is blank before year 1`, `"${cum}" · statement Total "${total}"`);
      } else {
        ok(pct(cum) !== null && pct(cum) === pct(total), `${phase}, ${view}: Cumulative is the statement's Total`, `chip ${cum} · statement ${total}`);
      }
    }
  }

  await compare('before year 1', 0);
  for (const y of [1, 2]) {
    await page.getByRole('button', { name: /Lock Year/ }).first().click();
    await page.waitForTimeout(2500);
    const decline = page.getByRole('button', { name: /Decline/i }).first();
    if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
    await page.waitForSelector(`text=Lock Year ${y + 1}`, { timeout: 60000 });
    await compare(`after year ${y}`, y);
  }

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\ncombined-ratio: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'COMBINED RATIO PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
