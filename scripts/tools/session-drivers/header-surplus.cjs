// THE SURPLUS AT THE TOP MATCHES THE STATEMENT'S, AND THE MARKET SHARE
// FOLLOWS THE VIEW — what a player sees.
//
// The header's "Surplus" chip is the Annual Statement's balance-sheet Ending
// Surplus for the latest year (resultsStatement.topSurplus): the opening before
// year 1, each played year's year-end after it, for the view on screen. This
// drives a solo game, three lines, through the real setup screen on scenarios
// 1, 7 and 12 and, on the Annual Statement tab, for the pool and every line,
// before year 1 and after years 1 and 2, checks the chip against the
// statement's latest-year Ending Surplus.
//
// The "Market Share" chip is a line's own exposure share on its view — the
// same figure the Calculation Audit's Market Share row shows for that line at
// the latest year — and absent on the pool view, where the three lines'
// markets are not comparable. Checked at the same points, on the Calculation
// Audit tab.
//
// The chip is in $M to two places and the statement in thousands, so the two
// are equal when they agree within the chip's own rounding (half a cent of a
// million, plus the statement's half a thousand). The defect this was written
// for read high by the whole loss expense reserve, millions, before year 1.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/header-surplus.cjs
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

const SCENARIOS = ['1', '7', '12'];
const ROW = 'Ending Surplus';
const VIEWS = ['Pool', "Workers' Compensation", 'General Liability', 'Property'];
const TOLERANCE_M = 0.0055;
// "$26.17M", "-$1.20M", "$950.0K"; the statement's "26,170" or "(1,200)" in thousands.
const chipM = t => {
  const m = (t || '').replace(/−/g, '-').match(/(-?)\$(-?[\d,.]+)([MKB]?)/);
  if (!m) return null;
  const x = parseFloat(m[2].replace(/,/g, '')) * (m[1] === '-' ? -1 : 1);
  return m[3] === 'B' ? x * 1000 : m[3] === 'K' ? x / 1000 : m[3] === 'M' ? x : x / 1e6;
};
const thousandsM = t => {
  const s = (t || '').replace(/−/g, '-').replace(/[$,\s]/g, '');
  if (s === '' || s === '—') return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const x = parseFloat(s.replace(/[()-]/g, ''));
  return Number.isFinite(x) ? (neg ? -x : x) / 1000 : null;
};

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const errors = [];

  for (const scenario of SCENARIOS) {
    const page = await (await browser.newContext({ baseURL: BASE })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/solo');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
    await page.locator('[data-testid="scenario"]').selectOption(scenario);
    for (const label of ["Workers' Compensation", 'General Liability', 'Property']) {
      const btn = page.locator('button', { hasText: label }).first();
      if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
    }
    await page.getByRole('button', { name: 'Start Simulation' }).click();
    await page.waitForSelector('text=Lock Year', { timeout: 60000 });

    async function compare(phase) {
      await page.getByRole('button', { name: /^Annual Statement$/ }).first().click();
      await page.waitForSelector('[data-testid="annual-statement"]', { timeout: 20000 });
      for (const view of VIEWS) {
        await page.getByRole('button', { name: view, exact: true }).first().click();
        await page.waitForTimeout(400);
        const head = (await page.locator('header').innerText()).replace(/\s+/g, ' ');
        const chip = (head.match(/Surplus\s+(-?\$[-\d,.]+[MKB]?)/) || [])[1];
        const cells = await page.locator(`[data-testid="statement-balance"] tr[data-row-label="${ROW}"] td`).allInnerTexts();
        const latest = cells[cells.length - 2];   // the last column is Total
        const a = chipM(chip), b = thousandsM(latest);
        ok(a !== null && b !== null && Math.abs(a - b) <= TOLERANCE_M,
          `scenario ${scenario}, ${phase}, ${view}: the chip is the statement's latest Ending Surplus`,
          `chip ${chip} · statement ${latest} (thousands)`);
      }
      await page.getByRole('button', { name: /^Calculation Audit$/ }).first().click();
      await page.waitForTimeout(800);
      for (const view of VIEWS) {
        await page.getByRole('button', { name: view, exact: true }).first().click();
        await page.waitForTimeout(500);
        const head = (await page.locator('header').innerText()).replace(/\s+/g, ' ');
        const chip = (head.match(/Market Share\s+([\d.]+%)/) || [])[1];
        if (view === 'Pool') {
          ok(chip === undefined && !/Market Share/.test(head),
            `scenario ${scenario}, ${phase}, Pool: no market share chip — the lines' markets are not comparable`, chip ? `chip ${chip}` : '');
          continue;
        }
        const audit = await page.evaluate(() => {
          for (const tr of document.querySelectorAll('main tr')) {
            const tds = [...tr.querySelectorAll('td, th')].map(td => td.textContent.trim());
            const i = tds.indexOf('Market Share');
            if (i >= 0 && tds[i + 1]) return tds[i + 1];
          }
          return null;
        });
        ok(chip !== undefined && chip === audit,
          `scenario ${scenario}, ${phase}, ${view}: the market share chip is the line's own, as the Calculation Audit shows it`,
          `chip ${chip} · audit ${audit}`);
      }
    }

    await compare('before year 1');
    for (const y of [1, 2]) {
      await page.getByRole('button', { name: /Lock Year/ }).first().click();
      await page.waitForTimeout(2500);
      const decline = page.getByRole('button', { name: /Decline/i }).first();
      // A loan offer, if a line ended the year below zero (the Line Surplus Deficit
      // prompt): declined, then CONFIRMED — Decline only selects the choice, and the
      // year does not post until Confirm & Continue. Measured: scenario 1 stalled
      // here after year 1 on the six-year simulated pre-game.
      if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
      const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
      if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
      await page.waitForSelector(`text=Lock Year ${y + 1}`, { timeout: 60000 });
      await compare(`after year ${y}`);
    }
    await page.context().close();
  }

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\nheader-surplus: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'HEADER SURPLUS PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
