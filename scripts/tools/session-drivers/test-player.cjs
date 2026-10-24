// ============================================================================
// THE TWO SOLO STARTS AND THE HOST'S LEVELS (wip/adverse-development), a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/test-player.cjs
//
// 1. Single player: one click starts a game, and its save holds a development
//    level drawn for every line played and its drawn shock schedule.
// 2. Test player: the host's rules open on the start screen — a Low / Mid /
//    High choice per line and the shock schedule. Setting WC High and GL Low and
//    adding a Nuclear Verdict in year 3 starts a solo game whose save holds
//    exactly those levels and that one shock.
// 3. Host: the setup screen offers Low / Mid / High per line, and no longer
//    the prior-development percentage fields.
// The save is read straight out of localStorage and decoded as the app writes
// it (base64 DEFLATE JSON, utils/gameSave).
// ============================================================================
const zlib = require('node:zlib');
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const LINES = [['WC', "Workers' Compensation"], ['GL', 'General Liability'], ['Property', 'Property']];

async function readSave(page) {
  const raw = await page.evaluate(() => {
    const k = Object.keys(localStorage).find(x => x.startsWith('riskpool_gamestate_'));
    return k ? localStorage.getItem(k) : null;
  });
  if (!raw) return null;
  const env = JSON.parse(zlib.inflateRawSync(Buffer.from(raw, 'base64')).toString('utf8'));
  return env.gameState ?? env;
}
async function fresh(page) {
  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  for (const [, label] of LINES) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
}
async function waitForSave(page) {
  for (let i = 0; i < 60; i++) { const s = await readSave(page).catch(() => null); if (s?.setup) return s; await page.waitForTimeout(1000); }
  return null;
}

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const errors = [];

  // ---- 1. Single player ----
  {
    const page = await (await browser.newContext({ baseURL: BASE })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    await fresh(page);
    // Scenario 16's five-year draw holds events (year 2 and year 5): a draw
    // with none writes no schedule field, so a random scenario could not tell.
    await page.locator('[data-testid="scenario"]').selectOption('16');
    ok(await page.getByRole('button', { name: 'Single player', exact: true }).count() === 1, 'the start screen offers Single player');
    ok(await page.getByRole('button', { name: 'Test player', exact: true }).count() === 1, 'and Test player');
    await page.getByRole('button', { name: 'Single player', exact: true }).click();
    await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
    const save = await waitForSave(page);
    const lv = save?.setup?.developmentLevels ?? {};
    ok(['WC', 'GL', 'Property'].every(l => ['Low', 'Mid', 'High'].includes(lv[l])), 'Single player: a level drawn for every line', JSON.stringify(lv));
    ok((save?.instance?.scheduledShocks?.length ?? 0) > 0, 'Single player: a drawn shock schedule on the instance',
      `${save?.instance?.scheduledShocks?.length ?? 'none'} events`);
    await page.context().close();
  }

  // ---- 2. Test player ----
  {
    const page = await (await browser.newContext({ baseURL: BASE })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    await fresh(page);
    await page.getByRole('button', { name: 'Test player', exact: true }).click();
    await page.waitForSelector('[data-testid="test-player-setup"]');
    ok(await page.locator('[data-testid^="dev-level-"]').count() === 3, 'Test player: a level per line played');
    await page.selectOption('[data-testid="dev-level-WC"]', 'High');
    await page.selectOption('[data-testid="dev-level-GL"]', 'Low');
    await page.selectOption('[data-testid="shock-id"]', '#7');
    await page.fill('[data-testid="shock-year"]', '3');
    await page.click('[data-testid="add-shock"]');
    ok(await page.locator('[data-testid="shock-list"] li[data-shock-id="#7"][data-shock-year="3"]').count() === 1, 'Test player: the shock is listed');
    await page.click('[data-testid="start-test-player"]');
    await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
    const save = await waitForSave(page);
    const lv = save?.setup?.developmentLevels ?? {};
    ok(lv.WC === 'High' && lv.GL === 'Low' && lv.Property === 'Mid', 'Test player: the game carries the levels set', JSON.stringify(lv));
    const sch = save?.instance?.scheduledShocks ?? [];
    ok(sch.length === 1 && sch[0].shockId === '#7' && sch[0].yearNumber === 3, 'Test player: and exactly the schedule set', JSON.stringify(sch));
    await page.context().close();
  }

  // ---- 3. Host ----
  {
    const page = await (await browser.newContext({ baseURL: BASE })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/host');
    await page.waitForSelector('[data-testid="create-room"]');
    const opts = await page.locator('[data-testid="dev-level-WC"] option').allInnerTexts();
    ok(opts.join(',') === 'Low,Mid,High', 'Host: Low / Mid / High per line', opts.join(','));
    ok(await page.locator('[data-testid^="prior-dev-"]').count() === 0, 'Host: the prior-development percentage fields are gone');
    await page.context().close();
  }

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\ntest-player: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
