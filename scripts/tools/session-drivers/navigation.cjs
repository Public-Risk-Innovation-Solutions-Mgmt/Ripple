// THE TOP BAR — its order and its hidden tabs, solo and multiplayer.
//
// The order and the hidden tabs live in src/game/tabs.tsx; this reads what a
// player is actually shown. Solo: the bar after the game starts, Game Setup
// still the page a game starts from, and a restored save (which asks for the hidden Dashboard)
// landing on the first listed tab. Multiplayer: a team's bar in a hosted room.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/navigation.cjs
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

const SOLO = ['Introduction', 'Rate Indication', 'Model', 'Annual Statement', 'Decisions', 'Decision History',
  'Financial Statements', 'Results', 'Result Spreadsheet', 'Calculation Audit'];
const MULTI = ['Introduction', 'Rate Indication', 'Annual Statement', 'Decisions', 'Decision History',
  'Result Spreadsheet'];
// Investments is hidden too: its memorandum is in the Introduction tab (introduction.cjs).
const HIDDEN = ['Game Setup', 'Investments', 'Dashboard', 'Departments'];
const MULTI_HIDDEN = [...HIDDEN, 'Financial Statements', 'Results', 'Calculation Audit'];

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
// The top bar is the first <nav> under the header: its buttons, in order.
const bar = page => page.locator('nav').first().locator('button').allInnerTexts().then(ts => ts.map(t => t.trim()));
const active = page => page.locator('nav').first().locator('button.border-blue-600').innerText().then(t => t.trim());

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const errors = [];

  // ---- SOLO -------------------------------------------------------------
  const solo = await (await browser.newContext({ baseURL: BASE })).newPage();
  solo.on('pageerror', e => errors.push(e.message));
  await solo.goto('/solo');
  await solo.evaluate(() => localStorage.clear());
  await solo.reload();
  await solo.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  ok(true, 'solo: a game still starts from the Game Setup page');
  await solo.getByRole('button', { name: 'Start Simulation' }).click();
  await solo.waitForSelector('text=Lock Year', { timeout: 60000 });
  const s = await bar(solo);
  ok(JSON.stringify(s) === JSON.stringify(SOLO), 'solo: the top bar, in order', s.join(' | '));
  ok(HIDDEN.every(t => !s.includes(t)), `solo: ${HIDDEN.join(', ')} are not on the bar`);

  await solo.getByRole('button', { name: 'Rate Indication', exact: true }).click();
  await solo.waitForTimeout(500);
  ok(/^Actuarial Rate Indication for Program Year \d{4}$/.test((await solo.locator('[data-testid="rate-indication"] h1').innerText()).trim()),
    'solo: Rate Indication opens on its own page, titled for the program year');

  // A restored save asks for the hidden Dashboard; the first listed tab shows.
  await solo.getByRole('button', { name: /Lock Year/ }).first().click();
  await solo.waitForSelector('text=Lock Year 2', { timeout: 120000 });
  await solo.reload();
  await solo.waitForSelector('text=Lock Year 2', { timeout: 120000 });
  await solo.waitForTimeout(800);
  const landed = await active(solo);
  const body = (await solo.locator('main').innerText()).trim();
  ok(landed === SOLO[0] && body.length > 100, 'solo: a restored save lands on the first listed tab, not a blank page', landed);
  ok(JSON.stringify(await bar(solo)) === JSON.stringify(SOLO), 'solo: the same bar after a restore');

  // ---- MULTIPLAYER ------------------------------------------------------
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  const team = await ctx.newPage();
  for (const p of [host, team]) p.on('pageerror', e => errors.push(e.message));
  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="event-name"]', 'Navigation');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '1');
  await host.uncheck('[data-testid="line-GL"]');
  await host.uncheck('[data-testid="line-Property"]');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  await team.goto(`/join/${code}`);
  await team.waitForSelector('[data-testid="team-picker"]');
  await team.fill('[data-testid="team-name"]', 'Harbour Mutual');
  await team.click('[data-testid="join-team"]');
  await team.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  await team.waitForSelector('button:has-text("Rate Indication")', { timeout: 60000 });
  const m = await bar(team);
  ok(JSON.stringify(m) === JSON.stringify(MULTI), 'multiplayer: the top bar, in order', m.join(' | '));
  ok(MULTI_HIDDEN.every(t => !m.includes(t)), `multiplayer: ${MULTI_HIDDEN.join(', ')} are not on the bar`);

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\nnavigation: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'NAVIGATION PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
