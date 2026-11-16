// THE SURPLUS AT THE TOP MATCHES THE STATEMENT'S, AND THE MARKET SHARE
// FOLLOWS THE VIEW — what a player sees.
//
// The header's "Surplus" chip is the Annual Statement's balance-sheet Net Worth
// (the builder's Ending Surplus, resultsStatement.topSurplus, laid out as the
// template's "Net Worth") for the latest year: the opening before
// year 1, each played year's year-end after it. This drives a solo game, three
// lines, through the real setup screen on scenarios 1, 7 and 12, before year 1
// and after years 1 and 2.
//
// ⚠ THE TOP BAR READS THE POOL ON EVERY TAB BUT A LINE ON DECISIONS (it used
// to follow the last line picked onto every tab). Checked: on the Annual
// Statement, whatever line view is selected, the chip is the POOL's latest Net
// Worth and the "Showing" chip says Pool; on Decisions with a line selected, the
// chip is that line's Net Worth and "Showing" names the line; and with a line
// left selected, every other tab reads the pool (surplus and combined ratio).
//
// ⚠ AND NO "Market Share" CHIP AT ALL, ON ANY VIEW: single player has no room
// to share. (In a hosted game the chip is the team's share of the room —
// room-market-share.cjs.) Checked at the same points, on the Calculation Audit
// tab, where the full-market share used to be compared.
//
// The chip is in $M to two places and the statement in thousands, so the two
// are equal when they agree within the chip's own rounding (half a cent of a
// million, plus the statement's half a thousand). The defect this was written
// for read high by the whole loss expense reserve, millions, before year 1.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/header-surplus.cjs
const { BASE, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');

const SCENARIOS = ['1', '7', '12'];
const ROW = 'Net Worth';
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
    await page.getByRole('button', { name: 'Single player', exact: true }).click();
    await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });

    const SHORT = { Pool: 'Pool', "Workers' Compensation": 'WC', 'General Liability': 'GL', Property: 'Property' };
    const bar = async () => {
      const head = (await page.locator('header').innerText()).replace(/\s+/g, ' ');
      return {
        surplus: (head.match(/Surplus\s+(-?\$[-\d,.]+[MKB]?)/) || [])[1],
        cr: (await page.locator('[data-testid="header-combined-ratio"]').innerText().catch(() => '')).trim(),
        scope: (await page.locator('[data-testid="header-scope"]').innerText().catch(() => '')).trim(),
      };
    };
    async function compare(phase) {
      // 1. The statement's latest Net Worth on every view; the bar reads the POOL on every one.
      await page.getByRole('button', { name: /^Annual Statement$/ }).first().click();
      await page.waitForSelector('[data-testid="annual-statement"]', { timeout: 20000 });
      const worth = {};
      let poolBar = null;
      for (const view of VIEWS) {
        await page.getByRole('button', { name: view, exact: true }).first().click();
        await page.waitForTimeout(400);
        const cells = await page.locator(`[data-testid="statement-balance"] tr[data-row-label="${ROW}"] td`).allInnerTexts();
        worth[view] = cells[cells.length - 2];   // C and I blank on the balance sheet: the newest year is the cell before I
        const b = await bar();
        if (view === 'Pool') poolBar = b;
        const a = chipM(b.surplus), w = thousandsM(worth.Pool ?? worth[view]);
        ok(a !== null && w !== null && Math.abs(a - w) <= TOLERANCE_M && b.scope === 'Pool',
          `scenario ${scenario}, ${phase}, Annual Statement on ${view}: the bar reads the POOL's latest Net Worth and says so`,
          `chip ${b.surplus} · pool ${worth.Pool} (thousands) · showing ${b.scope}`);
      }
      // 2. Decisions: a line selected is that line's figures, named; the pool view is the pool's.
      await page.getByRole('button', { name: /^Decisions$/ }).first().click();
      await page.waitForTimeout(500);
      for (const view of VIEWS) {
        await page.getByRole('button', { name: view, exact: true }).first().click();
        await page.waitForTimeout(400);
        const b = await bar();
        const a = chipM(b.surplus), w = thousandsM(worth[view]);
        ok(a !== null && w !== null && Math.abs(a - w) <= TOLERANCE_M && b.scope === SHORT[view],
          `scenario ${scenario}, ${phase}, Decisions on ${view}: the bar reads ${view === 'Pool' ? 'the pool' : 'that line'} and names it`,
          `chip ${b.surplus} · statement ${worth[view]} (thousands) · showing ${b.scope}`);
      }
      // 3. A line left selected (General Liability, from Decisions): every other tab reads the pool.
      await page.getByRole('button', { name: 'General Liability', exact: true }).first().click();
      await page.waitForTimeout(300);
      for (const tab of ['Introduction', 'Rate Indication', 'Annual Statement', 'Decision History', 'Year Walkthrough']) {
        const btn = page.getByRole('button', { name: new RegExp(`^${tab}$`) }).first();
        if (await btn.count() === 0) continue;
        await btn.click();
        await page.waitForTimeout(500);
        const b = await bar();
        ok(b.scope === 'Pool' && b.surplus === poolBar.surplus && b.cr === poolBar.cr,
          `scenario ${scenario}, ${phase}, ${tab} with General Liability selected: the bar reads the pool`,
          `showing ${b.scope} · surplus ${b.surplus} vs ${poolBar.surplus} · CR ${b.cr} vs ${poolBar.cr}`);
      }
      await page.getByRole('button', { name: /^Year Walkthrough$/ }).first().click();
      await page.waitForTimeout(800);
      for (const view of VIEWS) {
        await page.getByRole('button', { name: view, exact: true }).first().click();
        await page.waitForTimeout(500);
        const head = (await page.locator('header').innerText()).replace(/\s+/g, ' ');
        const chip = (head.match(/Market Share\s+([\d.]+%)/) || [])[1];
        ok(chip === undefined && !/Market Share/.test(head),
          `scenario ${scenario}, ${phase}, ${view}: no market share chip — single player has no room to share`, chip ? `chip ${chip}` : '');
      }
    }

    await compare('before year 1');
    for (const y of [1, 2]) {
      await lockAndConfirm(page);
      await page.waitForTimeout(2500);
      const decline = page.getByRole('button', { name: /Decline/i }).first();
      // A loan offer, if a line ended the year below zero (the Line Surplus Deficit
      // prompt): declined, then CONFIRMED — Decline only selects the choice, and the
      // year does not post until Confirm & Continue. Measured: scenario 1 stalled
      // here after year 1 on the six-year simulated pre-game.
      if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
      const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
      if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
      await page.waitForSelector(`text=Lock Program Year ${2027 + y}`, { timeout: 60000 });
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
