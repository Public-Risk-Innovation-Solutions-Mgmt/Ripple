// THE COMBINED RATIO AT THE TOP MATCHES THE STATEMENT'S — what a player sees.
//
// The header's one "Combined Ratio" chip is the Annual Statement's first row's
// Total (resultsStatement.topCombinedRatio) — cumulative since game start, or
// over the pre-game years before year 1 — for the view on screen. This drives
// a solo game on scenario 7, three lines, through the real setup screen and, on
// the Annual Statement tab, for the pool and every line, before year 1 and
// after years 1 and 2:
//
//   - the chip is the statement's combined ratio Total;
//   - the header carries one ratio chip: no "Cumulative", no latest-year chip,
//     no old "Loss Ratio (prem + admin)";
//   - the statement carries one combined ratio, its first row.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/combined-ratio.cjs
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

const ROW = 'Combined Ratio';
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
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });

  const headerText = async () => (await page.locator('header').innerText()).replace(/\s+/g, ' ');
  async function compare(phase, playedYears) {
    await page.getByRole('button', { name: /^Annual Statement$/ }).first().click();
    await page.waitForSelector('[data-testid="annual-statement"]', { timeout: 20000 });
    const head = await headerText();
    ok(!/Loss Ratio \(prem \+ admin\)/.test(head), `${phase}: the old loss-ratio chip is gone from the header`);
    ok(!/Cumulative/.test(head) && (head.match(/Combined Ratio/g) || []).length === 1, `${phase}: the header carries one "Combined Ratio" and no "Cumulative"`);
    for (const view of VIEWS) {
      await page.getByRole('button', { name: view, exact: true }).first().click();
      await page.waitForTimeout(400);
      const chip = await page.textContent('[data-testid="header-combined-ratio"]');
      const rows = await page.locator('[data-testid="annual-statement"] tr[data-row-label]').evaluateAll(els => els.map(e => e.getAttribute('data-row-label')));
      const named = rows.filter(l => /combined ratio/i.test(l || ''));
      ok(named.length === 1 && named[0] === ROW, `${phase}, ${view}: the statement has one combined ratio`, named.join(' | '));
      const first = await page.locator('[data-testid="statement-operating"] tbody tr').first().getAttribute('data-row-label');
      ok(first === ROW, `${phase}, ${view}: it is the statement's first row`, first ?? '');
      const cells = await page.locator(`[data-testid="statement-operating"] tr[data-row-label="${ROW}"] td`).allInnerTexts();
      const total = cells[cells.length - 1];
      ok(pct(chip) !== null && pct(chip) === pct(total),
        `${phase}, ${view}: the chip is the statement's cumulative Total${playedYears === 0 ? ' (over the pre-game years)' : ' (since game start)'}`, `chip ${chip} · statement ${total}`);
    }
  }

  await compare('before year 1', 0);
  for (const y of [1, 2]) {
    await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
    await page.waitForTimeout(2500);
    const decline = page.getByRole('button', { name: /Decline/i }).first();
    // A loan offer, if a line ended the year below zero (the Line Surplus Deficit
    // prompt): declined, then CONFIRMED — Decline only selects the choice, and the
    // year does not post until Confirm & Continue. Scenario 7's General Liability
    // ends year 2 (2028) about $4.1M short on the six-year simulated pre-game.
    if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
    const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
    if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
    await page.waitForSelector(`text=Lock Program Year ${2027 + y}`, { timeout: 60000 });
    await compare(`after year ${y}`, y);
  }

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\ncombined-ratio: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'COMBINED RATIO PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
