// ============================================================================
// THE TWO SOLO STARTS — Single player and Test player — and the host's
// adverse development levels (wip/adverse-development), a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/test-player.cjs
//
// 1. Single player: one click starts a game with NO ADVERSE DEVELOPMENT
//    (SOLO_ADVERSE_DEVELOPMENT off): its setup holds every line Off, no level
//    drawn, no prior-development percentages, and the shock schedule
//    utils/soloGame draws from the scenario (computed here independently with
//    tsx, not read back from the page). After year 1 is locked, the saved
//    prior-year development is the one a replay with every line Off books,
//    and not the one a replay at Mid books — so the game developed nothing;
//    by the second lock the Annual Statement's "Contributions To The Current
//    Calendar Year - Net" reads 0 Total Net Incurred on every older year.
// 2a. Test player at Mid on every line: by the second lock both played years
//    book prior-year development in the save, and the statement's Total Net
//    Incurred is above 0 on every older year — the levels chosen on its setup
//    screen are the game's (a tester read them as 0; this holds them).
// 2. Test player: opens the HOST'S OWN setup screen (HostCreateScreen, solo
//    mode) with no admin sign-in, offering Low / Mid / High per line in place of
//    the percentages. Setting WC High and GL Low (Property left at the default, Low), and
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
async function lockYear1(page) { return lockYear(page, 2); }
// Lock the current year; `next` is the year number the game then stands in (calendar 2026 + next).
async function lockYear(page, next) {
  await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
  await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
  await page.waitForTimeout(2500);
  const decline = page.getByRole('button', { name: /Decline/i }).first();
  if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
  const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
  if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
  await page.waitForSelector(`text=Lock Program Year ${2026 + next}`, { timeout: 120000 });
  return waitForSave(page, s => s?.currentYearNumber === next);
}
// The Annual Statement's "Contributions To The Current Calendar Year - Net":
// Total Net Incurred for each OLDER program year (Prior and every window year
// before the statement's own), read off the screen, in dollars.
async function olderYearsIncurred(page) {
  await page.getByRole('button', { name: 'Annual Statement', exact: true }).first().click();
  await page.waitForSelector('[data-testid="statement-contributions"]', { timeout: 30000 });
  const rows = (await page.locator('[data-testid="statement-contributions"] tr').allInnerTexts()).map(r => r.replace(/\s+/g, ' ').trim());
  const total = rows.find(r => r.startsWith('Total Net Incurred'));
  const cells = (total ?? '').replace('Total Net Incurred', '').trim().split(' ').map(x => Number(x.replace(/,/g, '').replace('−', '-')) * 1000);
  // The row ends with the statement's own program year and then All Years (the
  // v2 template's column I, the row's total): both are dropped, leaving Prior
  // and the older window years.
  return cells.slice(0, -2);
}
// Prior-year development by year, every line, from the save.
const pydByYear = save => (save?.lockedResults ?? []).map(r => ['WC', 'GL', 'Property'].reduce((a, l) => a + Math.abs(r.byLine?.[l]?.priorYearDevelopment ?? 0), 0));
// Year 1's prior-year development by line, replayed out of the browser on the
// solo game's own setup with the given levels: as App opens it and plays the
// default decisions.
function replayYear1(levels) {
  const out = execFileSync('npx', ['tsx', '-e',
    `import { openSoloInstance } from './src/utils/soloGame';
     import { runPriorHistory } from './src/utils/priorHistoryEngine';
     import { defaultDecisionSet } from './src/utils/decisionDefaults';
     import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from './src/utils/worlds';
     const { setup, instance } = openSoloInstance({ poolName: 'Ripple Public Entity Risk Pool', gameLength: 5, startingYear: 2027,
       instanceId: '${SCENARIO}', activeLines: ['WC', 'GL', 'Property'], developmentLevels: ${JSON.stringify(levels)} });
     const { poolState, priorHistory } = runPriorHistory(instance, setup);
     const gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory });
     const done = commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(1)), []));
     const r = done.lockedResults[0];
     console.log(JSON.stringify(Object.fromEntries(['WC', 'GL', 'Property'].map(l => [l, r.byLine[l].priorYearDevelopment]))));`],
  { cwd: REPO, encoding: 'utf8' }).trim().split('\n').pop();
  return JSON.parse(out);
}
const devOf = save => Object.fromEntries(['WC', 'GL', 'Property'].map(l => [l, save?.lockedResults?.[0]?.byLine?.[l]?.priorYearDevelopment]));
const sameDev = (a, b) => ['WC', 'GL', 'Property'].every(l => Number.isFinite(a[l]) && Math.abs(a[l] - b[l]) <= 1e-6 * Math.max(1, Math.abs(b[l])));

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
    ok(JSON.stringify(lv) === JSON.stringify({ WC: 'Off', GL: 'Off', Property: 'Off' }) && JSON.stringify(lv) === JSON.stringify(expected.levels),
      'Single player: no adverse development — every line Off, no level drawn', JSON.stringify(lv));
    ok(await page.locator('select[data-testid^="dev-level-"]').count() === 0, 'Single player: no level is offered');
    ok(save?.setup?.shockTiming === 'solo', 'Single player: solo shock timing');
    ok(expected.schedule.length > 0 && sched(save?.instance?.scheduledShocks) === JSON.stringify(expected.schedule),
      'Single player: the shock schedule drawn from the scenario', sched(save?.instance?.scheduledShocks));
    const played = await lockYear1(page);
    const got = devOf(played), off = replayYear1({ WC: 'Off', GL: 'Off', Property: 'Off' }), mid = replayYear1({ WC: 'Mid', GL: 'Mid', Property: 'Mid' });
    ok(sameDev(got, off) && !sameDev(got, mid),
      'Single player: year 1 develops the older years by nothing — its prior-year development is the Off replay\'s, not the Mid replay\'s',
      `played ${JSON.stringify(got)}; Off ${JSON.stringify(off)}; Mid ${JSON.stringify(mid)}`);
    // And by the second lock, on the statement a player reads: every older year's Total Net Incurred is 0.
    const second = await lockYear(page, 3);
    const older = await olderYearsIncurred(page);
    ok(older.length > 0 && older.every(x => x === 0) && pydByYear(second).every(x => Math.abs(x) < 1),
      'Single player: by the second lock no older year develops — the statement\'s older years read 0 Total Net Incurred, the save no prior-year development',
      `statement ${JSON.stringify(older)}; save ${JSON.stringify(pydByYear(second).map(Math.round))}`);
    await page.context().close();
  }

  // ---- 2a. Test player at Mid develops the older years, on the statement too ----
  {
    const page = await (await solo.newContext({ baseURL: BASE })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    await fresh(page);
    await page.getByRole('button', { name: 'Test player', exact: true }).click();
    await page.waitForSelector('[data-testid="test-player-setup"]', { timeout: 20000 });
    for (const l of ['WC', 'GL', 'Property']) await page.selectOption(`[data-testid="dev-level-${l}"]`, 'Mid');
    await page.click('[data-testid="start-test-player"]');
    await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
    await lockYear(page, 2);
    const second = await lockYear(page, 3);
    const lv = second?.setup?.developmentLevels ?? {};
    const older = await olderYearsIncurred(page);
    ok(JSON.stringify(lv) === JSON.stringify({ WC: 'Mid', GL: 'Mid', Property: 'Mid' }) && pydByYear(second).length === 2 && pydByYear(second).every(x => x > 1000),
      'Test player at Mid: the levels chosen are the game\'s, and both played years book prior-year development',
      `levels ${JSON.stringify(lv)}; save ${JSON.stringify(pydByYear(second).map(Math.round))}`);
    ok(older.length > 0 && older.every(x => Number.isFinite(x) && x > 0),
      'Test player at Mid: by the second lock every older year shows development on the statement (Total Net Incurred above 0)',
      JSON.stringify(older));
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
    // ⚠ LOW IS THE DEFAULT ON EVERY LINE (ADVERSE_DEVELOPMENT_DEFAULT_LEVEL), was
    // Mid: a line the tester does not touch plays Low.
    const opening = await Promise.all(['WC', 'GL', 'Property'].map(l => page.locator(`[data-testid="dev-level-${l}"]`).inputValue()));
    ok(opening.every(v => v === 'Low'), 'Test player: every line opens on Low', opening.join('/'));
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

    // Property is left at the default, Low (it was Mid).
    const want = { levels: { WC: 'High', GL: 'Low', Property: 'Low' }, schedule: [['#7', 3], ['#2', 4]] };
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
    await lockYear1(page);

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
