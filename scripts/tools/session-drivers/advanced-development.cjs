// ============================================================================
// ADVANCED ADVERSE DEVELOPMENT AT SETUP (pr/advanced-development) — a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/advanced-development.cjs   (ADMIN_TOKEN for the hosted half)
//
// TEST PLAYER (the host's form, played solo), scenario 16, three lines, 4 years:
//   - Simple is the default: one select per line, no table;
//   - Advanced starts the table from the simple choices, a row per year and a
//     column per line; a level set in a year applies from that year onward
//     (Edit game's rule);
//   - Simple again warns; "Keep Advanced" keeps the table;
//   - the started game's Edit game shows the table year by year, and its change
//     history opens with each year's starting settings;
//   - EACH YEAR PLAYS AT ITS SET LEVEL: years 1 to 3 played, the Year
//     Walkthrough's "Adverse development level" on each line in each year is the
//     table's — and again after a reload, which replays them from the save.
// HOSTED (with ADMIN_TOKEN), WC + GL, 3 years:
//   - "Switch to Simple" drops the table — Advanced again starts afresh from the
//     simple choices;
//   - the room stores the table as its settings by year, and the host's change
//     history opens with the starting settings;
//   - the host's Edit game shows the table, and still does after a played year.
// ============================================================================
const { BASE, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const LINE_NAMES = { WC: "Workers' Compensation", GL: 'General Liability', Property: 'Property' };
const SHOWN = v => (v === 'Off' ? 'None' : v);
const json = x => JSON.stringify(x);

/** The setup table as shown: { 2027: { WC: 'Mid', ... }, ... }, or null when there is none. */
async function readTable(page, lines) {
  if (await page.locator('[data-testid="dev-by-year"]').count() === 0) return null;
  const years = await page.$$eval('[data-testid^="dev-year-"]', rs => rs.map(r => r.getAttribute('data-testid')).filter(t => /^dev-year-\d{4}$/.test(t)).map(t => t.slice(9)));
  const out = {};
  for (const y of years) {
    out[y] = {};
    for (const l of lines) out[y][l] = await page.$eval(`[data-testid="dev-year-${y}-${l}"]`, e => e.value);
  }
  return out;
}
/** Edit game's development column, the same shape. */
async function readEdit(page, years, lines) {
  const out = {};
  for (const y of years) {
    out[y] = {};
    for (const l of lines) out[y][l] = await page.$eval(`[data-testid="edit-dev-${y}-${l}"] select`, e => e.value).catch(() => null);
  }
  return out;
}
const historyRows = async page => (await page.locator('[data-testid="edit-history-row"]').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
const startLine = (y, row, lines) => `Starting settings for ${y}: adverse development ${lines.map(l => `${l} ${SHOWN(row[l])}`).join(' · ')}`;

(async () => {
  await requireServer();
  const adminToken = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  const errors = [];

  // ---- Test player -----------------------------------------------------------
  const browser = await launchBrowser();
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption('16');
  for (const label of Object.values(LINE_NAMES)) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
  await page.getByRole('button', { name: 'Test player', exact: true }).click();
  await page.waitForSelector('[data-testid="test-player-setup"]', { timeout: 20000 });
  await page.fill('[data-testid="year-count"]', '4');
  const L3 = ['WC', 'GL', 'Property'];

  ok(await page.getAttribute('[data-testid="dev-mode-simple"]', 'aria-pressed') === 'true' && await readTable(page, L3) === null
    && await page.locator('[data-testid="dev-level-WC"]').count() === 1, 'Simple is the default: one level per line, no table');
  await page.selectOption('[data-testid="dev-level-WC"]', 'Mid');
  await page.selectOption('[data-testid="dev-level-GL"]', 'Low');
  await page.selectOption('[data-testid="dev-level-Property"]', 'Off');
  await page.click('[data-testid="dev-mode-advanced"]');
  let t = await readTable(page, L3);
  const simpleRow = { WC: 'Mid', GL: 'Low', Property: 'Off' };
  ok(t && json(Object.keys(t)) === json(['2027', '2028', '2029', '2030']) && Object.values(t).every(r => json(r) === json(simpleRow)),
    'Advanced: a row per year, 2027 to 2030, each started from the simple choices', json(t));
  ok(await page.locator('[data-testid="dev-level-WC"]').count() === 0, 'and the simple selects give way to the table');
  // Edit game's rule: from the chosen year onward.
  await page.selectOption('[data-testid="dev-year-2028-WC"]', 'High');
  await page.selectOption('[data-testid="dev-year-2030-GL"]', 'High');
  await page.selectOption('[data-testid="dev-year-2029-Property"]', 'Low');
  const TABLE = {
    2027: { WC: 'Mid', GL: 'Low', Property: 'Off' },
    2028: { WC: 'High', GL: 'Low', Property: 'Off' },
    2029: { WC: 'High', GL: 'Low', Property: 'Low' },
    2030: { WC: 'High', GL: 'High', Property: 'Low' },
  };
  t = await readTable(page, L3);
  ok(json(t) === json(TABLE), 'a level set in a year applies from that year onward, not before', json(t));
  await page.click('[data-testid="dev-mode-simple"]');
  ok(await page.locator('[data-testid="dev-mode-warning"]').count() === 1
    && /per-year choices will be lost/i.test(await page.locator('[data-testid="dev-mode-warning"]').innerText()),
    'back to Simple warns that the per-year choices will be lost');
  await page.click('[data-testid="dev-mode-keep-advanced"]');
  ok(await page.locator('[data-testid="dev-mode-warning"]').count() === 0 && json(await readTable(page, L3)) === json(TABLE),
    '"Keep Advanced" keeps the table as it was');

  await page.click('[data-testid="start-test-player"]');
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
  await page.click('[data-testid="test-edit-toggle"]');
  await page.waitForSelector('[data-testid="edit-game"]');
  ok(json(await readEdit(page, Object.keys(TABLE), L3)) === json(TABLE), 'Test player\'s Edit game shows the table, year by year');
  const h = await historyRows(page);
  const wantHist = Object.entries(TABLE).map(([y, r]) => startLine(y, r, L3));
  ok(wantHist.every(w => h.some(r => r.includes(w))) && h.length === 4, 'its change history opens with each year\'s starting settings', h.join(' | '));
  await page.click('[data-testid="test-edit-toggle"]');

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
  for (const next of [2028, 2029, 2030]) await lock(next);

  // Each played year at its set level: the Year Walkthrough, line by line.
  await page.getByRole('button', { name: 'Year Walkthrough', exact: true }).first().click();
  await page.waitForSelector('[data-testid="year-walkthrough"] [data-testid="walk-year-code"]', { timeout: 60000 });
  const played = {};
  for (const l of L3) {
    await page.getByRole('button', { name: LINE_NAMES[l], exact: true }).first().click();
    await page.waitForTimeout(400);
    for (const [y, cal] of [[1, '2027'], [2, '2028'], [3, '2029']]) {
      await page.selectOption('[data-testid="walk-year"]', String(y));
      await page.waitForTimeout(700);
      const lv = await page.$$eval('[data-testid="year-walkthrough"] tr', rs => {
        const r = rs.find(x => x.children[0]?.textContent.trim() === 'Adverse development level');
        return r ? r.children[1].textContent.trim() : null;
      });
      (played[cal] ??= {})[l] = lv;
    }
  }
  const wantPlayed = Object.fromEntries(['2027', '2028', '2029'].map(y => [y, Object.fromEntries(L3.map(l => [l, SHOWN(TABLE[y][l])]))]));
  ok(json(played) === json(wantPlayed), 'each played year plays at its set level, on every line (Year Walkthrough)', json(played));
  // A RELOAD replays every year from the save: the same levels.
  await page.reload();
  await page.waitForSelector('text=Lock Program Year', { timeout: 120000 });
  await page.getByRole('button', { name: 'Year Walkthrough', exact: true }).first().click();
  await page.waitForSelector('[data-testid="year-walkthrough"] [data-testid="walk-year-code"]', { timeout: 60000 });
  const again = {};
  for (const l of L3) {
    await page.getByRole('button', { name: LINE_NAMES[l], exact: true }).first().click();
    await page.waitForTimeout(400);
    for (const [y, cal] of [[1, '2027'], [2, '2028'], [3, '2029']]) {
      await page.selectOption('[data-testid="walk-year"]', String(y));
      await page.waitForTimeout(700);
      (again[cal] ??= {})[l] = await page.$$eval('[data-testid="year-walkthrough"] tr', rs => {
        const r = rs.find(x => x.children[0]?.textContent.trim() === 'Adverse development level');
        return r ? r.children[1].textContent.trim() : null;
      });
    }
  }
  ok(json(again) === json(wantPlayed), 'after a reload the replayed years read the same levels', json(again));
  await browser.close();

  // ---- hosted ------------------------------------------------------------------
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
    await host.fill('[data-testid="event-name"]', 'Advanced Development');
    await host.selectOption('[data-testid="seed"]', '7');
    await host.fill('[data-testid="year-count"]', '3');
    await host.fill('[data-testid="expected-teams"]', '1');
    await host.uncheck('[data-testid="line-Property"]');
    const L2 = ['WC', 'GL'];
    await host.selectOption('[data-testid="dev-level-WC"]', 'Low');
    await host.selectOption('[data-testid="dev-level-GL"]', 'Mid');
    await host.click('[data-testid="dev-mode-advanced"]');
    await host.selectOption('[data-testid="dev-year-2028-GL"]', 'Off');
    ok(json(await readTable(host, L2)) === json({ 2027: { WC: 'Low', GL: 'Mid' }, 2028: { WC: 'Low', GL: 'Off' }, 2029: { WC: 'Low', GL: 'Off' } }),
      'hosted: the table, a column per played line, set from 2028 onward');
    await host.click('[data-testid="dev-mode-simple"]');
    await host.click('[data-testid="dev-mode-confirm-simple"]');
    ok(await readTable(host, L2) === null && await host.$eval('[data-testid="dev-level-WC"]', e => e.value) === 'Low'
      && await host.$eval('[data-testid="dev-level-GL"]', e => e.value) === 'Mid', '"Switch to Simple" drops the table and keeps the simple choices');
    await host.click('[data-testid="dev-mode-advanced"]');
    ok(Object.values(await readTable(host, L2)).every(r => json(r) === json({ WC: 'Low', GL: 'Mid' })),
      'and Advanced again starts afresh from them: the per-year choices were lost');
    await host.selectOption('[data-testid="dev-year-2028-GL"]', 'Off');
    await host.selectOption('[data-testid="dev-year-2029-WC"]', 'High');
    const HT = { 2027: { WC: 'Low', GL: 'Mid' }, 2028: { WC: 'Low', GL: 'Off' }, 2029: { WC: 'High', GL: 'Off' } };
    ok(json(await readTable(host, L2)) === json(HT), 'hosted: the table as set', json(await readTable(host, L2)));
    await host.click('[data-testid="create-room"]');
    await host.waitForSelector('[data-testid="room-code"]');
    const code = (await host.textContent('[data-testid="room-code"]')).trim();
    const rec = await host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);
    const byYear = { 1: HT[2027], 2: HT[2028], 3: HT[2029] };
    ok(rec && json(rec.developmentLevelsByYear) === json(byYear), 'the room stores the table as its settings by year', json(rec?.developmentLevelsByYear));
    ok(rec && json(rec.developmentLevels) === json(HT[2027]), 'and its setup levels are the first year\'s', json(rec?.developmentLevels));
    await host.click('[data-testid="host-tab-setup"]');
    await host.waitForSelector('[data-testid="edit-game"]', { timeout: 30000 });
    ok(json(await readEdit(host, Object.keys(HT), L2)) === json(HT), 'the host\'s Edit game shows the table');
    const hh = await historyRows(host);
    ok(Object.entries(HT).every(([y, r]) => hh.some(x => x.includes(startLine(y, r, L2)))) && hh.length === 3,
      'and the host\'s change history opens with the starting settings', hh.join(' | '));

    const team = await ctx.newPage();
    team.on('pageerror', e => errors.push(e.message));
    await team.goto(`/join/${code}`);
    await team.waitForSelector('[data-testid="team-picker"]');
    await team.fill('[data-testid="team-name"]', 'Harbour Mutual');
    await team.click('[data-testid="join-team"]');
    await team.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
    await lockAndConfirm(team);
    await team.waitForSelector('[data-testid="session-strip"][data-lock="locked"]', { timeout: 30000 });
    await host.click('[data-testid="advance"]');
    await team.waitForFunction(() => document.querySelector('[data-testid="session-strip"]')?.dataset.postedYear === '1', null, { timeout: 180000 });
    await host.click('[data-testid="host-tab-setup"]').catch(() => {});
    await host.waitForSelector('[data-testid="edit-year-2028"]', { timeout: 30000 });
    ok(json(await readEdit(host, ['2028', '2029'], L2)) === json({ 2028: HT[2028], 2029: HT[2029] }) && await host.locator('[data-testid="edit-year-2027"]').count() === 0,
      'after year 1 is played, Edit game shows 2028 on with the table\'s levels');
    await hb.close();
  }

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  console.log(`\nadvanced-development: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'ADVANCED DEVELOPMENT PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
