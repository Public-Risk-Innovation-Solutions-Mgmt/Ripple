// THE COMBINED RATIO AT THE TOP MATCHES THE STATEMENT'S — what a player sees.
//
// The header's one "Combined Ratio" chip is the builder's first row's Total
// (resultsStatement.topCombinedRatio) — cumulative since game start, or over
// the pre-game years before year 1 — for the view on screen. The Annual
// Statement is laid out as the template now (annualStatementTemplate.ts), its
// Net Income Statement the five years alone (C and I blank) and NO TOTAL COLUMN,
// so the cumulative is not a cell on it: this driver works it out FROM THE
// STATEMENT'S OWN CELLS — every cost (Total Incurred Loss & LAE, General Admin
// Expense, Other Admin Expense, and the reinsurance cost, which is the Ceded
// block's Written Premium) over what members were charged (Written Premium,
// which is net of reinsurance, plus that same cost), summed over the played
// columns.
//
// ⚠ NOT BEFORE YEAR 1. There the chip is cumulative over every pre-game year,
// and the statement shows only the last five: with Prior taken off the Net
// Income Statement (the seven-column layout), the older years are on no cell,
// so before year 1 this driver checks the header's chips and the statement's one
// combined ratio, not the chip's value. This drives a solo game on scenario 7,
// three lines, through the real setup screen and, on the Annual Statement tab,
// for the pool and every line, before year 1 and after years 1 and 2:
//
//   - after years 1 and 2 the chip is the statement's cumulative combined ratio,
//     to the rounding of the statement's thousands and the chip's one decimal;
//   - after year 1 it is the 2027 column's Combined Ratio exactly;
//   - the header carries one ratio chip: no "Cumulative", no latest-year chip,
//     no old "Loss Ratio (prem + admin)";
//   - the statement carries one combined ratio.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/combined-ratio.cjs
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

const ROW = 'Combined Ratio';
const VIEWS = ['Pool', "Workers' Compensation", 'General Liability', 'Property'];
const thousandsOf = t => { const x = (t || '').replace(/−/g, '-').replace(/[,\s]/g, ''); return x === '' || x === '—' ? NaN : parseFloat(x); };
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
  await page.getByRole('button', { name: 'Single player', exact: true }).click();
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
      const heads = (await page.locator('[data-testid="statement-operating"] tr[data-row-kind="header"] th').allInnerTexts()).map(t => t.trim());
      // A row's figure cells, by section: [C, five years, I] in thousands — C and I blank on the Net Income Statement.
      const fig = async (sel, label) => (await page.locator(`${sel} tr[data-row-label="${label}"] td`).allInnerTexts()).slice(1).map(thousandsOf);
      const op = '[data-testid="statement-operating"]';
      const [lossLae, admin, rc, prem, ceded] = await Promise.all([
        fig(op, 'Total Incurred Loss & LAE'), fig(op, 'General Admin Expense'), fig(op, 'Other Admin Expense'),
        fig(op, 'Written Premium'), fig('[data-testid="statement-ceded"]', 'Written Premium')]);
      // heads: the label cell, C (blank), the years, I (blank). Played columns are 2027 on.
      const cols = heads.slice(1).map((h, i) => ({ h, i })).filter(c => /^\d{4}$/.test(c.h) && (playedYears === 0 || Number(c.h) >= 2027));
      const sum = xs => cols.reduce((a, c) => a + xs[c.i], 0);
      const cumulative = 100 * (sum(lossLae) + sum(admin) + sum(rc) + sum(ceded)) / (sum(prem) + sum(ceded));
      // Each thousand rounds by up to half a thousand, over a denominator of tens of thousands; the chip shows one decimal.
      if (playedYears > 0) ok(pct(chip) !== null && Number.isFinite(cumulative) && Math.abs(pct(chip) - cumulative) <= 0.15,
        `${phase}, ${view}: the chip is the statement's cumulative combined ratio (since game start)`,
        `chip ${chip} · from the statement ${cumulative.toFixed(2)}% over ${cols.map(c => c.h).join(', ')}`);
      if (playedYears === 1) {
        const cr = (await page.locator(`${op} tr[data-row-label="${ROW}"] td`).allInnerTexts()).map(t => t.trim());
        // The last cell is I, blank on the Net Income Statement: 2027 is the one before it.
        ok(cr.at(-2) === (chip || '').trim() && cr.at(-1) === '', `${phase}, ${view}: after one played year the chip is the 2027 column's Combined Ratio`, `chip ${chip} · 2027 ${cr.at(-2)}`);
      }
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
