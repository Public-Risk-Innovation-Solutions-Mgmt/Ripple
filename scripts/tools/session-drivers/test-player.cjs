// ============================================================================
// THE TWO SOLO STARTS — Single player and Test player — and the host's
// adverse development levels (wip/adverse-development), a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/test-player.cjs
//
// 1. Single player: one click starts a game whose setup holds the development
//    level and shock schedule utils/soloGame draws from the scenario — a level
//    for every line played (computed here independently with tsx, not read
//    back from the page) — and no prior-development percentages.
// 2. Test player: opens the HOST'S OWN setup screen (HostCreateScreen, solo
//    mode) with no admin sign-in, offering Low / Mid / High per line in place of
//    the percentages. Setting WC High and GL Low (Property left at Mid), and
//    scheduling #7 in year 3 and #2 in year 4, starts a solo game whose save
//    holds exactly those levels and exactly that schedule.
// 3. After locking year 1 and RELOADING, the game is restored (not the start
//    screen) and the save still holds the same levels and schedule.
// 4. Host (only with ADMIN_TOKEN): /host offers the levels per line, not the
//    percentages, and the Create room button; no Start test game button.
//
// ⚠ THE SOLO CONTEXTS NEVER CARRY THE ADMIN TOKEN, even with ADMIN_TOKEN set:
// they are opened from a browser launched with it unset, and each asserts the
// token is absent — Test player must not need the sign-in.
//
// The save is read straight out of localStorage and decoded as the app writes
// it (base64 DEFLATE JSON, utils/gameSave).
// ============================================================================
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { BASE, REPO, launchBrowser, requireServer } = require('./_shared.cjs');

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const LINES = [['WC', "Workers' Compensation"], ['GL', 'General Liability'], ['Property', 'Property']];
const SCENARIO = '16';
const sched = list => JSON.stringify((list ?? []).map(s => [s.shockId, s.yearNumber]));

async function readSave(page) {
  const raw = await page.evaluate(() => {
    const k = Object.keys(localStorage).find(x => x.startsWith('riskpool_gamestate_'));
    return k ? localStorage.getItem(k) : null;
  });
  if (!raw) return null;
  const env = JSON.parse(zlib.inflateRawSync(Buffer.from(raw, 'base64')).toString('utf8'));
  return env.gameState ?? env;
}
async function waitForSave(page, pred = s => !!s?.setup) {
  for (let i = 0; i < 60; i++) { const s = await readSave(page).catch(() => null); if (pred(s)) return s; await page.waitForTimeout(1000); }
  return null;
}
async function fresh(page) {
  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption(SCENARIO);
  for (const [, label] of LINES) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
}
const adminTokenIn = page => page.evaluate(() => localStorage.getItem('ripple.admin.token'));

(async () => {
  await requireServer();
  // What Single player draws for this scenario, computed from the source.
  const expectedSchedule = execFileSync('npx', ['tsx', '-e',
    `import { openSoloInstance } from './src/utils/soloGame';
     const { setup, instance } = openSoloInstance({ poolName: 'x', gameLength: 5, startingYear: 2027, instanceId: '${SCENARIO}', activeLines: ['WC', 'GL', 'Property'] });
     console.log(JSON.stringify({ schedule: (instance.scheduledShocks ?? []).map(s => [s.shockId, s.yearNumber]), levels: setup.developmentLevels ?? null }));`],
  { cwd: REPO, encoding: 'utf8' }).trim().split('\n').pop();
  const expected = JSON.parse(expectedSchedule);

  const adminToken = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  const solo = await launchBrowser();
  if (adminToken) process.env.ADMIN_TOKEN = adminToken;
  const errors = [];

  // ---- 1. Single player ----
  {
    const page = await (await solo.newContext({ baseURL: BASE })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    await fresh(page);
    ok(await page.getByRole('button', { name: 'Single player', exact: true }).count() === 1, 'the start screen offers Single player');
    ok(await page.getByRole('button', { name: 'Test player', exact: true }).count() === 1, 'and Test player');
    ok(await page.getByRole('button', { name: 'Start Simulation' }).count() === 0, 'and no Start Simulation');
    await page.getByRole('button', { name: 'Single player', exact: true }).click();
    await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
    const save = await waitForSave(page);
    ok(save?.setup?.priorDevelopment === undefined, 'Single player: no prior-development percentages set');
    const lv = save?.setup?.developmentLevels ?? {};
    ok(['WC', 'GL', 'Property'].every(l => ['Low', 'Mid', 'High'].includes(lv[l])) && JSON.stringify(lv) === JSON.stringify(expected.levels),
      'Single player: a development level drawn from the scenario for every line played', JSON.stringify(lv));
    ok(save?.setup?.shockTiming === 'solo', 'Single player: solo shock timing');
    ok(expected.schedule.length > 0 && sched(save?.instance?.scheduledShocks) === JSON.stringify(expected.schedule),
      'Single player: the shock schedule drawn from the scenario', sched(save?.instance?.scheduledShocks));
    await page.context().close();
  }

  // ---- 2 and 3. Test player, then a reload ----
  {
    const page = await (await solo.newContext({ baseURL: BASE })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    await fresh(page);
    ok(await adminTokenIn(page) === null, 'Test player context: no admin token');
    await page.getByRole('button', { name: 'Test player', exact: true }).click();
    await page.waitForSelector('[data-testid="test-player-setup"]', { timeout: 20000 });
    ok(await page.locator('input[type="password"]').count() === 0 && await page.getByText('Admin login').count() === 0,
      'Test player: no admin sign-in asked for');
    ok(await page.locator('[data-testid="event-name"]').count() === 0 && await page.locator('[data-testid="expected-teams"]').count() === 0,
      'Test player: the room-only fields (event name, team count) are not shown');
    ok(await page.locator('[data-testid="create-room"]').count() === 0, 'Test player: no Create room button');
    ok(await page.locator('[data-testid="seed"]').inputValue() === SCENARIO, 'Test player: opens on the start screen\'s scenario');
    ok(await page.locator('select[data-testid^="dev-level-"]').count() === 3, 'Test player: the host\'s adverse development level, per line');
    ok(await page.locator('[data-testid^="prior-dev-pct-"]').count() === 0, 'Test player: no prior-development percentages');
    const opts = await page.locator('[data-testid="dev-level-WC"] option').allInnerTexts();
    ok(JSON.stringify(opts) === JSON.stringify(['Low', 'Mid', 'High']), 'Test player: Low, Mid and High offered', opts.join('/'));
    const note = await page.locator('[data-testid="dev-level-note"]').innerText().catch(() => '');
    ok(/grows by a rate drawn in its line's range/.test(note), 'Test player: the levels\' note says what they do', note);

    await page.selectOption('[data-testid="dev-level-WC"]', 'High');
    await page.selectOption('[data-testid="dev-level-GL"]', 'Low');
    for (const [id, yr] of [['#7', '3'], ['#2', '4']]) {
      await page.selectOption('[data-testid="shock-id"]', id);
      await page.fill('[data-testid="shock-year"]', yr);
      await page.click('[data-testid="add-shock"]');
    }
    ok(await page.locator('[data-testid="shock-list"] li').count() === 2, 'Test player: both shocks listed');
    await page.click('[data-testid="start-test-player"]');
    await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });

    const want = { levels: { WC: 'High', GL: 'Low', Property: 'Mid' }, schedule: [['#7', 3], ['#2', 4]] };
    const check = (save, when) => {
      const lv = save?.setup?.developmentLevels ?? {};
      ok(JSON.stringify(lv) === JSON.stringify(want.levels), `Test player ${when}: the levels set`, JSON.stringify(lv));
      ok(sched(save?.instance?.scheduledShocks) === JSON.stringify(want.schedule),
        `Test player ${when}: exactly the shock schedule set`, sched(save?.instance?.scheduledShocks));
      ok(save?.setup?.instanceId === SCENARIO && save?.setup?.gameLength === 5 && save?.setup?.activeLines?.join(',') === 'WC,GL,Property',
        `Test player ${when}: scenario, length and lines carried`);
    };
    check(await waitForSave(page), 'at start');

    // Lock year 1, then reload.
    await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
    await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
    await page.waitForTimeout(2500);
    const decline = page.getByRole('button', { name: /Decline/i }).first();
    if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
    const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
    if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
    await page.waitForSelector('text=Lock Program Year 2028', { timeout: 120000 });
    await waitForSave(page, s => s?.currentYearNumber === 2);

    await page.reload();
    await page.waitForSelector('text=Lock Program Year 2028', { timeout: 120000 });
    ok(await page.locator('[data-testid="open-test-player"]').count() === 0, 'after reload: the game is restored, not the start screen');
    const after = await readSave(page);
    ok(after?.currentYearNumber === 2, 'after reload: still in year 2', String(after?.currentYearNumber));
    check(after, 'after reload');
    await page.context().close();
  }
  await solo.close();

  // ---- 4. Host, unchanged (needs the admin sign-in) ----
  if (adminToken) {
    const browser = await launchBrowser();
    const page = await (await browser.newContext({ baseURL: BASE })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/host');
    await page.waitForSelector('[data-testid="create-room"]', { timeout: 20000 });
    ok(await page.locator('[data-testid="event-name"]').count() === 1 && await page.locator('[data-testid="expected-teams"]').count() === 1,
      'Host: event name and team count still there');
    ok(await page.locator('select[data-testid^="dev-level-"]').count() === 3 && await page.locator('[data-testid^="prior-dev-pct-"]').count() === 0,
      'Host: a level per line, no prior-development percentages');
    ok(await page.locator('[data-testid="start-test-player"]').count() === 0, 'Host: no Start test game button');
    await browser.close();
  } else {
    console.log('  skip  Host checks (ADMIN_TOKEN unset)');
  }

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  console.log(`\ntest-player: ${passed}/${passed + failed} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
