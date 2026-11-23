// ============================================================================
// EACH TEAM NAMES ITS OWN POOL (wip/team-chosen-names) — a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   ADMIN_TOKEN=… node scripts/tools/session-drivers/team-names.cjs
//
// A hosted room, created with no pool name (the host is not asked any more).
// Two teams join with names they choose:
//   1. the join screen explains the rule and refuses, as it is typed, a name too
//      short or too long (the server's own refusal is the contract harness's);
//   2. Team 1 joins as "Harbour Mutual"; its top bar reads "Team 1 | Harbour
//      Mutual", and its welcome memo greets "Harbour Mutual";
//   3. a second team trying "harbour MUTUAL" is told the name is taken, and the
//      Join button stays off; it joins as "Cedar Valley" (Team 2);
//   4. the host's Teams tab shows both names with their numbers; the host
//      renames Team 2 — a name another team holds is refused in the dialog —
//      to "Bayside Pool"; the change history records "Renamed Team 2: Cedar
//      Valley → Bayside Pool";
//   5. the new name reaches everywhere: Team 2's own top bar, Team 1's Market
//      Survey, the host's Teams tab;
//   6. Team 2 reloads (its device returning) and still reads "Bayside Pool".
// Screenshots of the join screen and the Teams tab go to
// docs/screenshots/team-names/ when TEAM_NAMES_SHOTS=1.
// ============================================================================
const fs = require('fs');
const path = require('path');
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const SHOTS = process.env.TEAM_NAMES_SHOTS === '1' ? path.join(__dirname, '../../../docs/screenshots/team-names') : null;
const shot = async (page, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
};

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const errors = [];
  const host = await ctx.newPage();
  host.on('pageerror', e => errors.push(e.message));

  // ---- the host: no pool name asked -------------------------------------
  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  ok(await host.locator('[data-testid="pool-name"]').count() === 0, 'the host is not asked for a pool name');
  ok(/Each team names its own pool when it joins/.test(await host.textContent('[data-testid="pool-name-note"]') ?? ''),
    'the form says each team names its own pool');
  await host.fill('[data-testid="event-name"]', 'Team Names');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '2');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();

  // ---- team 1: the rules, then a chosen name ----------------------------
  // ⚠ ONE BROWSER CONTEXT: the room lives in its localStorage, which every tab
  // of a context shares — the host and each team are tabs, as in the other drivers.
  const t1 = await ctx.newPage();
  t1.on('pageerror', e => errors.push(e.message));
  await t1.goto(`/join/${code}`);
  await t1.waitForSelector('[data-testid="team-picker"]');
  const help = (await t1.textContent('[data-testid="team-name-help"]')).replace(/\s+/g, ' ');
  ok(/3 to 30 characters/.test(help) && /Team N \| your name/.test(help), 'the join screen states the rule and how the name is shown', help);
  const joinOff = async page => page.locator('[data-testid="join-team"]').isDisabled();
  await t1.fill('[data-testid="team-name"]', 'Hb');
  ok(await joinOff(t1) && /3 to 30 characters/.test(await t1.textContent('[data-testid="team-name-problem"]') ?? ''),
    'a 2-character name is refused as typed, and Join stays off');
  await t1.fill('[data-testid="team-name"]', 'x'.repeat(40));
  ok((await t1.inputValue('[data-testid="team-name"]')).length === 30, 'the box takes no more than 30 characters');
  // (The transport's own refusal of a name sent past the screen is the contract
  // harness's: session-contract-check, TEAM-CHOSEN POOL NAMES.)
  await t1.fill('[data-testid="team-name"]', '  Harbour Mutual ');
  ok(!(await joinOff(t1)), 'a good name turns Join on');
  await shot(t1, 'join-screen.png');
  await t1.click('[data-testid="join-team"]');
  await t1.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  await t1.waitForSelector('[data-testid="header-pool-name"]', { timeout: 120000 });
  ok((await t1.textContent('[data-testid="header-pool-name"]')).trim() === 'Team 1 | Harbour Mutual',
    "team 1's top bar reads its number and its own pool name", await t1.textContent('[data-testid="header-pool-name"]'));
  await t1.getByRole('button', { name: 'Introduction', exact: true }).first().click();
  await t1.waitForTimeout(800);
  ok((await t1.locator('main').innerText()).includes('welcome to Harbour Mutual'), "its welcome memo greets its own pool by name");

  // ---- team 2: a duplicate in another case, then its own name ------------
  const t2 = await ctx.newPage();
  t2.on('pageerror', e => errors.push(e.message));
  await t2.goto(`/join/${code}`);
  await t2.waitForSelector('[data-testid="team-picker"]');
  await t2.waitForFunction(() => document.body.innerText.includes('Harbour Mutual'), null, { timeout: 30000 });
  await t2.fill('[data-testid="team-name"]', 'harbour MUTUAL');
  ok(await joinOff(t2) && /already has that name/.test(await t2.textContent('[data-testid="team-name-problem"]') ?? ''),
    'a name another team holds, in another case, is refused as typed');
  await shot(t2, 'join-screen-duplicate.png');
  await t2.fill('[data-testid="team-name"]', 'Cedar Valley');
  await t2.click('[data-testid="join-team"]');
  await t2.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  await t2.waitForSelector('[data-testid="header-pool-name"]', { timeout: 120000 });
  ok((await t2.textContent('[data-testid="header-pool-name"]')).trim() === 'Team 2 | Cedar Valley', "team 2's top bar reads Team 2 | Cedar Valley");

  // ---- the host's Teams tab and the rename --------------------------------
  await host.click('[data-testid="host-tab-teams"]');
  await host.waitForSelector('[data-testid="name-Cedar Valley"]', { timeout: 60000 });
  const names = async () => host.$$eval('[data-testid="teams-table"] tr', rows =>
    rows.map(r => [...r.children].slice(0, 2).map(c => c.textContent.trim()).join(' | ')));
  ok(JSON.stringify(await names()) === JSON.stringify(['Team 1 | Harbour Mutual', 'Team 2 | Cedar Valley']),
    "the host's Teams tab shows each team's number and chosen name", (await names()).join(', '));
  await host.click('[data-testid="rename-Cedar Valley"]');
  await host.waitForSelector('[data-testid="rename-modal"]');
  await host.fill('[data-testid="rename-input"]', 'HARBOUR mutual');
  ok(await host.locator('[data-testid="rename-save"]').isDisabled()
    && /already has that name/.test(await host.textContent('[data-testid="rename-problem"]') ?? ''),
    "a rename to another team's name is refused in the dialog");
  await host.fill('[data-testid="rename-input"]', 'Bayside Pool');
  await host.click('[data-testid="rename-save"]');
  await host.waitForSelector('[data-testid="rename-modal"]', { state: 'detached', timeout: 30000 });
  await host.waitForFunction(() => document.querySelector('[data-testid="name-Cedar Valley"]')?.textContent.trim() === 'Bayside Pool', null, { timeout: 30000 });
  ok(JSON.stringify(await names()) === JSON.stringify(['Team 1 | Harbour Mutual', 'Team 2 | Bayside Pool']),
    'the Teams tab shows the new name against the same number', (await names()).join(', '));
  await shot(host, 'teams-tab.png');
  await host.click('[data-testid="host-tab-setup"]');
  await host.waitForSelector('[data-testid="edit-history"]');
  const history = await host.$$eval('[data-testid="edit-history-row"]', rows => rows.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  ok(history.some(h => h.includes('Renamed Team 2: Cedar Valley → Bayside Pool')), 'the change history records the rename', history.join(' / '));

  // ---- the new name reaches the teams ------------------------------------
  await t2.waitForFunction(() => document.querySelector('[data-testid="header-pool-name"]')?.textContent.trim() === 'Team 2 | Bayside Pool', null, { timeout: 60000 })
    .catch(() => {});
  ok((await t2.textContent('[data-testid="header-pool-name"]')).trim() === 'Team 2 | Bayside Pool', "team 2's own top bar takes the new name");
  await t1.getByRole('button', { name: 'Market Survey', exact: true }).first().click();
  await t1.waitForFunction(() => document.querySelector('[data-testid="market-survey"] [data-testid="name-Cedar Valley"]')?.textContent.trim() === 'Bayside Pool', null, { timeout: 60000 })
    .catch(() => {});
  ok((await t1.textContent('[data-testid="market-survey"] [data-testid="name-Cedar Valley"]'))?.trim() === 'Bayside Pool',
    "team 1's Market Survey shows team 2's new name");
  await t2.reload();
  await t2.waitForSelector('[data-testid="header-pool-name"]', { timeout: 180000 });
  ok((await t2.textContent('[data-testid="header-pool-name"]')).trim() === 'Team 2 | Bayside Pool', 'after a reload (the device returning) team 2 keeps the new name');

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\nteam-names: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'TEAM NAMES PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
