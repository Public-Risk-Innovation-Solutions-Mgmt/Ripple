// THE INTRODUCTION TAB — its four documents, what a player sees.
//
// Solo (scenario 7, three lines) and hosted (a room over the local transport):
// the Introduction tab lists the Welcome memorandum, How to Play, the Investment
// memorandum and the Underwriting memorandum, in that order. The Investment
// memorandum's table is Asset class, Expected return and Fee — before year 1
// and after it (no year's-return column: see the investment memo's header) —
// every figure filled, and the allocation it says the Pool holds is the one
// Decision History shows for the year just played. The Underwriting memorandum
// is its source text, exactly.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/introduction.cjs
const fs = require('node:fs');
const path = require('node:path');
const { BASE, REPO, launchBrowser, requireServer } = require('./_shared.cjs');

const DOCS = ['Welcome Memorandum', 'How to Play', 'Investment Memorandum', 'Underwriting Memorandum'];
const norm = s => s.replace(/\s+/g, ' ').trim();
// The underwriting memo as rendered: the source without its comment and its markdown marks.
const UW_EXPECTED = norm(fs.readFileSync(path.join(REPO, 'src/data/documents/underwritingMemorandum.md'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/^#+\s*/gm, '').replace(/\*\*/g, ''));

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

function intro(page, mode) {
  const tab = async name => { await page.getByRole('button', { name, exact: true }).first().click(); await page.waitForTimeout(500); };
  const titles = async () => page.$$eval('[data-testid="document-body"]', ([pane]) => {
    for (let a = pane.parentElement; a; a = a.parentElement) {
      const nav = a.querySelector('nav');
      if (nav) return [...nav.querySelectorAll('button span.font-semibold')].map(s => s.textContent.trim());
    }
    return [];
  });
  const open = async title => {
    await page.locator('[data-testid="document-body"]').locator('xpath=../..').locator('nav button', { hasText: title }).first().click();
    await page.waitForTimeout(400);
  };
  async function investment(name) {
    await open('Investment Memorandum');
    const body = page.locator('[data-testid="document-body"]');
    const head = (await body.locator('table thead th').allInnerTexts()).map(t => t.trim());
    const rows = await body.locator('table tbody tr').evaluateAll(trs => trs.map(tr => [...tr.cells].map(c => c.textContent.trim())));
    const text = norm(await body.innerText());
    ok(JSON.stringify(head) === JSON.stringify(['Asset class', 'Expected return', 'Fee']),
      `${mode}, ${name}: the investment table is Asset class, Expected return, Fee`, head.join(' | '));
    ok(rows.length === 3 && rows.map(r => r[0]).join() === 'Cash,Bonds,Equities' && rows.every(r => r.slice(1).every(c => /^\d+\.\d+%$/.test(c))),
      `${mode}, ${name}: each class's expected return and fee are filled`, rows.map(r => r.join(' ')).join('; '));
    ok(!/\{\{/.test(text) && !/liquidity|early-sale|early sale/i.test(text), `${mode}, ${name}: no unfilled token, and nothing on liquidity or early sale`);
    const m = text.match(/currently holds (\d+)% cash, (\d+)% bonds and (\d+)% equities/);
    return m ? m.slice(1).map(Number) : null;
  }
  return { tab, titles, open, investment };
}

async function checkUnderwriting(page, s, mode) {
  await s.open('Underwriting Memorandum');
  const got = norm(await page.locator('[data-testid="document-body"]').innerText());
  ok(got === UW_EXPECTED, `${mode}: the Underwriting memorandum is its text, exactly`,
    got === UW_EXPECTED ? '' : `first difference at ${[...got].findIndex((c, i) => c !== UW_EXPECTED[i])}`);
}

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const errors = [];

  // ---- SOLO ---------------------------------------------------------------
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
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
  const s = intro(page, 'solo');

  await s.tab('Introduction');
  const t = await s.titles();
  ok(JSON.stringify(t) === JSON.stringify(DOCS), 'solo: the Introduction tab lists the four memos, in order', t.join(' | '));
  const before = await s.investment('before year 1');
  ok(before !== null && before.reduce((a, b) => a + b, 0) === 100, 'solo, before year 1: the allocation the Pool holds is stated', String(before));
  await checkUnderwriting(page, s, 'solo');

  await page.getByRole('button', { name: /Lock Year/ }).first().click();
  await page.waitForTimeout(2500);
  const decline = page.getByRole('button', { name: /Decline/i }).first();
  if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
  await page.waitForSelector('text=Lock Year 2', { timeout: 120000 });

  await s.tab('Decision History');
  const pool = page.getByRole('button', { name: 'Pool', exact: true }).first();
  if (await pool.count() > 0) { await pool.click(); await page.waitForTimeout(400); }
  const histRow = await page.locator('main table tbody tr').first().evaluate(tr => [...tr.cells].map(c => c.textContent.trim()));
  const held = histRow.slice(2, 5).map(c => Number(c.replace('%', '')));
  await s.tab('Introduction');
  const after = await s.investment('after year 1');
  ok(after !== null && JSON.stringify(after) === JSON.stringify(held),
    'solo, after year 1: the allocation is the one Decision History shows for the year played', `${after} vs ${held}`);

  // ---- HOSTED -------------------------------------------------------------
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  const team = await ctx.newPage();
  for (const p of [host, team]) p.on('pageerror', e => errors.push(e.message));
  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="event-name"]', 'Introduction');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '1');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  await team.goto(`/join/${code}`);
  await team.waitForSelector('[data-testid="team-picker"]');
  await team.fill('[data-testid="team-name"]', 'Harbour Mutual');
  await team.click('[data-testid="join-team"]');
  await team.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  await team.waitForSelector('button:has-text("Introduction")', { timeout: 60000 });
  const h = intro(team, 'hosted');
  await h.tab('Introduction');
  const ht = await h.titles();
  ok(JSON.stringify(ht) === JSON.stringify(DOCS), 'hosted: the Introduction tab lists the four memos, in order', ht.join(' | '));
  await h.investment('before year 1');
  await checkUnderwriting(team, h, 'hosted');

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\nintroduction: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'INTRODUCTION PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
