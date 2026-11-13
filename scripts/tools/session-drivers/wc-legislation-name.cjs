// ============================================================================
// EVENT #5'S NAMES — "WC Reform" renamed on screen, its id and catalogue key
// unchanged (shockLosses.SHOCK_EVENT_LABELS).
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/wc-legislation-name.cjs   (ADMIN_TOKEN for the hosted half)
//
// HOST-FACING — "Workers Comp Legislation": the shock picker on Test player's
// setup and the host's setup, the Edit game panel's picker and its chips, and
// the change history.
// PLAYER-FACING — "Workers Compensation Legislation: Increased Medical Fee
// Schedule": the news banner (with the new line on the medical fee schedule),
// Events so far, and the Year Walkthrough's rows.
// And "WC Reform" shows on none of them.
//
// Test player: scenario 16, three lines, #5 in year 2; lock into 2028.
// Hosted: WC + GL, #5 in year 2, one team; after the advance into 2028 the
// host adds #5 to 2029 through Edit game.
// ============================================================================
const { BASE, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');

const HOST_NAME = 'Workers Comp Legislation';
const PLAYER_NAME = 'Workers Compensation Legislation: Increased Medical Fee Schedule';
const OLD = /WC Reform/;
const LINE_NAMES = ["Workers' Compensation", 'General Liability', 'Property'];

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const linesIn = text => LINE_NAMES.filter(n => text.includes(n));
const optionText = (page, sel) => page.$eval(`${sel} option[value="#5"]`, o => o.textContent.trim()).catch(() => null);
const bodyText = page => page.locator('body').innerText();

(async () => {
  await requireServer();
  const adminToken = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  const errors = [];

  // ---- Test player ----------------------------------------------------------
  const browser = await launchBrowser();
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption('16');
  for (const label of LINE_NAMES) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
  await page.getByRole('button', { name: 'Test player', exact: true }).click();
  await page.waitForSelector('[data-testid="test-player-setup"]', { timeout: 20000 });
  const tpOpt = await optionText(page, '[data-testid="shock-id"]');
  ok(tpOpt === `#5 — ${HOST_NAME}`, 'Test player setup: the picker names #5 "Workers Comp Legislation"', tpOpt);
  await page.selectOption('[data-testid="shock-id"]', '#5');
  await page.fill('[data-testid="shock-year"]', '2');
  await page.click('[data-testid="add-shock"]');
  const setupText = await page.locator('[data-testid="test-player-setup"]').innerText();
  ok(setupText.includes(`#5 ${HOST_NAME} — Year 2`) && !OLD.test(setupText), 'and the schedule lists it so, with no "WC Reform"', (setupText.match(/#5[^\n]*/) ?? [''])[0]);
  await page.click('[data-testid="start-test-player"]');
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });

  async function lock(next) {
    await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
    await lockAndConfirm(page);
    await page.waitForTimeout(2500);
    const decline = page.getByRole('button', { name: /Decline/i }).first();
    if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
    const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
    if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
    await page.waitForSelector(`text=Lock Program Year ${next}`, { timeout: 120000 });
  }
  await lock(2028);
  await lock(2029);
  const items = (await page.locator('[data-testid="event-news-item"]').allInnerTexts()).map(t => t.trim());
  ok(items.length === 1 && items[0].startsWith(PLAYER_NAME), 'the 2028 news banner names it in full', items.join(' | '));
  ok(/medical fee schedule/i.test(items[0] ?? '') && /workers' compensation/i.test(items[0] ?? ''), 'with its new line: a medical fee schedule raising WC costs', items[0]);
  ok(JSON.stringify(linesIn((items[0] ?? '').split('Your lines affected:')[1] ?? '')) === JSON.stringify(["Workers' Compensation"]),
    'on Workers\' Compensation alone', (items[0] ?? '').split('Your lines affected:')[1]);
  await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
  await page.waitForTimeout(500);
  const listed = (await page.locator('[data-testid="events-panel-item"]').allInnerTexts()).map(t => t.trim());
  ok(listed.length === 1 && listed[0].startsWith(`2028 ${PLAYER_NAME}`), 'Events so far lists it in full', listed.join(' | '));
  ok(!OLD.test(await bodyText(page)), 'Decisions page: no "WC Reform" anywhere');

  // The Year Walkthrough, 2028, Workers' Compensation: its rows name the event.
  await page.getByRole('button', { name: 'Year Walkthrough', exact: true }).first().click();
  await page.waitForSelector('[data-testid="year-walkthrough"] [data-testid="walk-year-code"]', { timeout: 60000 });
  await page.getByRole('button', { name: "Workers' Compensation", exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.selectOption('[data-testid="walk-year"]', '2');
  await page.waitForTimeout(1500);
  const walk = await page.locator('[data-testid="year-walkthrough"]').innerText();
  ok(walk.includes(`${PLAYER_NAME}: level`) && walk.includes(`${PLAYER_NAME}: surge %`), 'Year Walkthrough, WC 2028: its rows name it in full', (walk.match(new RegExp(`${PLAYER_NAME}: [^\\n\\t]*`, 'g')) ?? []).slice(0, 3).join(' | '));
  ok(!OLD.test(walk), 'and no "WC Reform"');

  // Test player's Edit game: the host's panel and its names.
  await page.click('[data-testid="test-edit-toggle"]');
  await page.waitForSelector('[data-testid="edit-game"]');
  const chip = await page.locator('[data-testid^="edit-shock-"][data-testid$="-#5"]').allInnerTexts().catch(() => []);
  const editOpt = await optionText(page, '[data-testid="edit-add-select-2030"]');
  ok(editOpt === `#5 ${HOST_NAME}`, 'Test player Edit game: the picker names it "Workers Comp Legislation"', editOpt);
  await page.selectOption('[data-testid="edit-add-select-2030"]', '#5');
  await page.click('[data-testid="edit-add-2030"]');
  const added = (await page.locator('[data-testid="edit-shock-2030-#5"]').innerText().catch(() => '')).trim();
  ok(added.startsWith(`#5 ${HOST_NAME}`), 'and its chip, once added', added || chip.join(' | '));
  await page.click('[data-testid="edit-apply"]');
  await page.waitForSelector('[data-testid="edit-history-row"]', { timeout: 20000 });
  const hist = (await page.locator('[data-testid="edit-history-row"]').allInnerTexts()).map(t => t.trim());
  ok(hist.some(h => h.includes(`Added #5 ${HOST_NAME} in 2030`)), 'and the change history', hist.join(' | '));
  ok(!OLD.test(await page.locator('[data-testid="edit-game"]').innerText()), 'Edit game: no "WC Reform"');
  await browser.close();

  // ---- hosted ---------------------------------------------------------------
  if (!adminToken) {
    console.log('  (hosted part skipped: no ADMIN_TOKEN)');
  } else {
    process.env.ADMIN_TOKEN = adminToken;
    const hb = await launchBrowser();
    const ctx = await hb.newContext({ baseURL: BASE });
    const host = await ctx.newPage();
    host.on('pageerror', e => errors.push(e.message));
    await host.goto('/host');
    await host.waitForSelector('[data-testid="create-room"]', { timeout: 30000 });
    await host.fill('[data-testid="event-name"]', 'WC Legislation Name');
    await host.selectOption('[data-testid="seed"]', '7');
    await host.fill('[data-testid="year-count"]', '4');
    await host.fill('[data-testid="expected-teams"]', '1');
    await host.uncheck('[data-testid="line-Property"]');
    const hOpt = await optionText(host, '[data-testid="shock-id"]');
    ok(hOpt === `#5 — ${HOST_NAME}`, 'hosted setup: the host\'s picker names #5 "Workers Comp Legislation"', hOpt);
    await host.selectOption('[data-testid="shock-id"]', '#5');
    await host.fill('[data-testid="shock-year"]', '2');
    await host.click('[data-testid="add-shock"]');
    ok(!OLD.test(await bodyText(host)), 'hosted setup: no "WC Reform"');
    await host.click('[data-testid="create-room"]');
    await host.waitForSelector('[data-testid="room-code"]');
    const code = (await host.textContent('[data-testid="room-code"]')).trim();
    const team = await ctx.newPage();
    team.on('pageerror', e => errors.push(e.message));
    await team.goto(`/join/${code}`);
    await team.waitForSelector('[data-testid="team-picker"]');
    await team.fill('[data-testid="team-name"]', 'Harbour Mutual');
    await team.click('[data-testid="join-team"]');
    await team.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
    for (const y of [1, 2]) {
      await lockAndConfirm(team);
      await team.waitForSelector('[data-testid="session-strip"][data-lock="locked"]', { timeout: 30000 });
      await host.click('[data-testid="host-tab-setup"]').catch(() => {});
      await host.waitForTimeout(300);
      await host.click('[data-testid="advance"]');
      await team.waitForFunction(n => document.querySelector('[data-testid="session-strip"]')?.dataset.postedYear === String(n), y, { timeout: 180000 });
      await team.waitForTimeout(800);
    }
    const t = (await team.locator('[data-testid="event-news-item"]').allInnerTexts()).map(x => x.trim());
    ok(t.length === 1 && t[0].startsWith(PLAYER_NAME) && /medical fee schedule/i.test(t[0]), 'hosted: the team\'s 2028 banner names it in full, with the new line', t.join(' | '));
    ok(!OLD.test(await bodyText(team)), 'hosted team: no "WC Reform"');

    // The host's Edit game: 2029 is still to play.
    await host.click('[data-testid="host-tab-setup"]');
    await host.waitForSelector('[data-testid="edit-game"]', { timeout: 30000 });
    const ho = await optionText(host, '[data-testid="edit-add-select-2029"]');
    ok(ho === `#5 ${HOST_NAME}`, 'hosted Edit game: the picker names it "Workers Comp Legislation"', ho);
    await host.selectOption('[data-testid="edit-add-select-2029"]', '#5');
    await host.click('[data-testid="edit-add-2029"]');
    await host.click('[data-testid="edit-apply"]');
    await host.waitForSelector('[data-testid="edit-saved"]', { timeout: 30000 });
    await host.waitForFunction(() => document.querySelectorAll('[data-testid="edit-history-row"]').length >= 1, null, { timeout: 30000 });
    const hh = (await host.locator('[data-testid="edit-history-row"]').allInnerTexts()).map(x => x.trim());
    ok(hh.some(h => h.includes(`Added #5 ${HOST_NAME} in 2029`)), 'hosted: the host\'s change history names it "Workers Comp Legislation"', hh.join(' | '));
    ok(!OLD.test(await bodyText(host)), 'host screen: no "WC Reform"');
    await hb.close();
  }

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  console.log(`\nwc-legislation-name: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'WC LEGISLATION NAME PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
