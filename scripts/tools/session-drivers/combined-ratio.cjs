// THE COMBINED RATIO AT THE TOP IS THE STATEMENT'S NEWEST YEAR'S — what a player sees.
//
// The header's one combined-ratio chip reads "Combined ratio <year>" and shows
// the Annual Statement's Combined Ratio for its NEWEST column — the latest
// played year, or before year 1 the last history year (2026) — for the view on
// screen (resultsStatement.newestCombinedRatio). It was the cumulative since
// game start (the statement's Total), which is on no column; restated at
// wip/newest-year-combined-ratio. This drives a solo game on scenario 7, three
// lines, through the real setup screen and, on the Annual Statement tab, for
// the pool and every line, before year 1 and after years 1 and 2:
//
//   - the chip is labelled "Combined ratio" with the year of the statement's
//     newest column, and its figure is that column's Combined Ratio exactly;
//   - after year 2 it is NOT the cumulative (apart from it on at least one view
//     — a view's year can sit within rounding of its cumulative) worked out
//     from the statement's own cells (every cost — Total Incurred Loss & LAE,
//     General and Other Admin Expense, and the reinsurance cost, the Ceded
//     block's Written Premium — over Written Premium plus that cost, over the
//     played columns);
//   - the header carries one ratio chip: no "Cumulative", no old "Loss Ratio
//     (prem + admin)";
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
    ok(!/Cumulative/.test(head) && (head.match(/Combined ratio/gi) || []).length === 1, `${phase}: the header carries one combined ratio and no "Cumulative"`);
    const apart = [];
    for (const view of VIEWS) {
      await page.getByRole('button', { name: view, exact: true }).first().click();
      await page.waitForTimeout(400);
      const chip = (await page.textContent('[data-testid="header-combined-ratio"]') || '').trim();
      const chipLabel = (await page.locator('[data-testid="header-combined-ratio"]').locator('xpath=../span[1]').innerText()).trim();
      const rows = await page.locator('[data-testid="annual-statement"] tr[data-row-label]').evaluateAll(els => els.map(e => e.getAttribute('data-row-label')));
      const named = rows.filter(l => /combined ratio/i.test(l || ''));
      ok(named.length === 1 && named[0] === ROW, `${phase}, ${view}: the statement has one combined ratio`, named.join(' | '));
      const heads = (await page.locator('[data-testid="statement-operating"] tr[data-row-kind="header"] th').allInnerTexts()).map(t => t.trim());
      const op = '[data-testid="statement-operating"]';
      const cr = (await page.locator(`${op} tr[data-row-label="${ROW}"] td`).allInnerTexts()).map(t => t.trim());
      // heads: the label cell, C (blank), the years, I (blank); cr: C, the years, I. The newest year is the last before I.
      const newestYear = heads.at(-2);
      ok(/^\d{4}$/.test(newestYear) && newestYear === String(2026 + playedYears) && chipLabel === `Combined ratio ${newestYear}`,
        `${phase}, ${view}: the chip is labelled with the statement's newest year`, `"${chipLabel}" · newest column ${newestYear}`);
      ok(cr.at(-2) === chip && cr.at(-1) === '', `${phase}, ${view}: the chip is the newest column's Combined Ratio`, `chip ${chip} · ${newestYear} ${cr.at(-2)}`);
      if (playedYears === 2) {
        // A row's figure cells, by section: [C, five years, I] in thousands — C and I blank on the Net Income Statement.
        const fig = async (sel, label) => (await page.locator(`${sel} tr[data-row-label="${label}"] td`).allInnerTexts()).slice(1).map(thousandsOf);
        const [lossLae, admin, rc, prem, ceded] = await Promise.all([
          fig(op, 'Total Incurred Loss & LAE'), fig(op, 'General Admin Expense'), fig(op, 'Other Admin Expense'),
          fig(op, 'Written Premium'), fig('[data-testid="statement-ceded"]', 'Written Premium')]);
        const cols = heads.slice(1).map((h, i) => ({ h, i })).filter(c => /^\d{4}$/.test(c.h) && Number(c.h) >= 2027);
        const sum = xs => cols.reduce((a, c) => a + xs[c.i], 0);
        const cumulative = 100 * (sum(lossLae) + sum(admin) + sum(rc) + sum(ceded)) / (sum(prem) + sum(ceded));
        // A view's year can sit within rounding of its cumulative (Property's 2028 does), so this is
        // read across the views below: the chip must stand apart from the cumulative on at least one.
        if (pct(chip) !== null && Number.isFinite(cumulative)) apart.push(`${view} ${chip} vs ${cumulative.toFixed(2)}%`
          + (Math.abs(pct(chip) - cumulative) > 0.15 ? ' (apart)' : ' (within rounding)'));
      }
    }
    if (playedYears === 2) ok(apart.length === VIEWS.length && apart.some(a => a.endsWith('(apart)')),
      `${phase}: the chip is not the cumulative since game start — apart from it on at least one view`, apart.join(' · '));
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
