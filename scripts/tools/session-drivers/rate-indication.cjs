// THE RATE INDICATION REPRODUCES THE RATE THE GAME CHARGES — what a player sees.
//
// A solo game on scenario 7, three lines, through the real setup screen. On
// every line, before year 1 and after a played year, the Rate Indication
// (Departments, Actuarial) is read, and on the Decisions page the panel's rate
// (new-rate-final, its full figure) is read with the funding slider at
// Expected and at 70%, 80% and 90%, under each cover the line offers:
//
//   indicated rate at that position + the cover's price  =  the panel's rate
//
// to one part in a billion. Also: the page lists exactly the covers the
// Decisions page offers, and None is priced at nothing.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/rate-indication.cjs
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

const LINES = [['WC', "Workers' Compensation"], ['GL', 'General Liability'], ['Property', 'Property']];
const LEVELS = [70, 80, 90];
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

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
  for (const [, label] of LINES) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
  await page.getByRole('button', { name: 'Start Simulation' }).click();
  await page.waitForSelector('text=Lock Year', { timeout: 60000 });

  const tab = async name => { await page.getByRole('button', { name: new RegExp(`^${name}$`) }).first().click(); await page.waitForTimeout(500); };
  const value = async sel => Number(await page.getAttribute(sel, 'data-value'));

  async function readIndication() {
    await tab('Departments');
    await page.getByRole('button', { name: /Actuarial/ }).first().click();
    await page.waitForSelector('[data-testid="rate-indication"]', { timeout: 20000 });
    const out = {};
    for (const [l] of LINES) {
      const reins = {};
      for (const el of await page.$$(`[data-testid^="ri-${l}-reins-"]`)) {
        reins[(await el.getAttribute('data-testid')).replace(`ri-${l}-reins-`, '')] = Number(await el.getAttribute('data-value'));
      }
      out[l] = { expected: await value(`[data-testid="ri-${l}-expected"]`), reins, levels: {} };
      for (const lv of LEVELS) out[l].levels[lv] = await value(`[data-testid="ri-${l}-level-${lv}"]`);
    }
    return out;
  }

  async function slider() {
    return page.locator('div.flex.flex-col.gap-2', { has: page.locator('span', { hasText: /^Funding Confidence Level$/ }) }).first().locator('input[type=range]');
  }
  async function setLevel(lv) {
    if (lv === 'expected') {
      const reset = page.getByRole('button', { name: /^Reset to Expected/ }).first();
      if (await reset.count() > 0) { await reset.click(); await page.waitForTimeout(300); }
      return;
    }
    const s = await slider();
    await s.focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < (lv - 30) / 5; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
  }

  async function phase(name) {
    const ind = await readIndication();
    await tab('Decisions');
    for (const [l, label] of LINES) {
      await page.getByRole('button', { name: label, exact: true }).first().click();
      await page.waitForTimeout(400);
      const offered = [];
      for (const el of await page.$$(`[data-testid^="reins-option-${l}-"]`)) offered.push((await el.getAttribute('data-testid')).replace(`reins-option-${l}-`, ''));
      const listed = Object.keys(ind[l].reins);
      ok(JSON.stringify([...listed].sort()) === JSON.stringify([...offered].sort()),
        `${name}, ${l}: the page lists exactly the covers the Decisions page offers`, `${listed.join(', ')} | ${offered.join(', ')}`);
      ok(ind[l].reins.none === 0, `${name}, ${l}: None is priced at nothing`);
      for (const option of offered) {
        await page.click(`[data-testid="reins-option-${l}-${option}"]`);
        await page.waitForTimeout(300);
        for (const lv of ['expected', ...LEVELS]) {
          await setLevel(lv);
          const panel = await value('[data-testid="new-rate-final"]');
          const indicated = lv === 'expected' ? ind[l].expected : ind[l].levels[lv];
          const want = indicated + ind[l].reins[option];
          ok(near(panel, want), `${name}, ${l}, ${option}, ${lv === 'expected' ? 'Expected' : `${lv}%`}: indicated + the cover's price = the panel's rate`,
            `${indicated.toFixed(4)} + ${ind[l].reins[option].toFixed(4)} = ${want.toFixed(6)} vs ${panel.toFixed(6)}`);
        }
      }
      // Back to the default for the next phase: None at Expected.
      await page.click(`[data-testid="reins-option-${l}-${offered[0]}"]`);
      await setLevel('expected');
    }
  }

  await phase('before year 1');
  await page.getByRole('button', { name: /Lock Year/ }).first().click();
  await page.waitForTimeout(2500);
  const decline = page.getByRole('button', { name: /Decline/i }).first();
  if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
  await page.waitForSelector('text=Lock Year 2', { timeout: 60000 });
  await phase('after year 1');

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\nrate-indication: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'RATE INDICATION PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
