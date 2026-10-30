// THE MODEL TAB — hidden from every player since the tab cleanup.
//
// The Model tab showed every input to the rate, step by step, and every
// expectation against the simulation. It is hidden in single player, Test
// player and a hosted room alike (src/game/tabs.tsx HIDDEN_TABS), with Results,
// Result Spreadsheet and Financial Statements; ModelPage and modelRate.ts are
// kept, unrouted. This holds that no player can reach it:
//
//   Single player   scenario 7, three lines, one year played: no Model on the
//                   bar, and the page is not rendered
//   Test player     the host's setup played solo, one year played: the same
//   Hosted          a room over the local transport, one team: the same
//
// ⚠ RESTATED AT THE TAB CLEANUP. This driver held the page to the engine:
// section A's rate the rate charged on every priced year, its expense block,
// and section B against the Annual Statement. With the tab unreachable those
// checks hold nothing a player sees; they are in this file's history (before
// the tab cleanup) for the day the tab comes back.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/model.cjs
const { BASE, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');

const LINES = ["Workers' Compensation", 'General Liability', 'Property'];

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const bar = page => page.locator('nav').first().locator('button').allInnerTexts().then(ts => ts.map(t => t.trim()));
const absent = async (page, who) => {
  const b = await bar(page);
  ok(b.length > 0 && !b.includes('Model') && await page.locator('[data-testid="model"]').count() === 0,
    `${who}: the top bar has no Model tab, and the page is not rendered`, b.join(' | '));
};

async function lockOne(page) {
  await lockAndConfirm(page);
  await page.waitForTimeout(2500);
  const decline = page.getByRole('button', { name: /Decline/i }).first();
  if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
  const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
  if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
  await page.waitForSelector('text=Lock Program Year 2028', { timeout: 120000 });
}

async function soloStart(browser, errors, mode) {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption('7');
  for (const label of LINES) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
  if (mode === 'test') {
    await page.getByRole('button', { name: 'Test player', exact: true }).click();
    await page.waitForSelector('[data-testid="test-player-setup"]', { timeout: 20000 });
    await page.click('[data-testid="start-test-player"]');
  } else {
    await page.getByRole('button', { name: 'Single player', exact: true }).click();
  }
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
  await lockOne(page);
  return page;
}

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const errors = [];

  await absent(await soloStart(browser, errors, 'single'), 'Single player');
  await absent(await soloStart(browser, errors, 'test'), 'Test player');

  // ---- HOSTED -------------------------------------------------------------
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  const team = await ctx.newPage();
  for (const p of [host, team]) p.on('pageerror', e => errors.push(e.message));
  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="event-name"]', 'Model');
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
  await team.waitForSelector('button:has-text("Rate Indication")', { timeout: 60000 });
  await absent(team, 'Hosted');

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\nmodel: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'MODEL PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
