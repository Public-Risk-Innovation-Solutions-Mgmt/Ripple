// ============================================================================
// THE NEWS OF A SHOCK, THE MOMENT IT HAPPENS — a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/shock-news.cjs
//
// Test player (the host's setup in solo, no sign-in), scenario 16, three lines,
// Nuclear Verdict (#7) scheduled in year 2 and an Earthquake (#1) in year 3:
//
//   1. after the first lock (into 2027, a quiet year) there is no banner;
//   2. on the lock into 2028 the banner appears AT ONCE — with 2028's results,
//      which show at once too (utils/knownYears: the year just completed is
//      known) — naming the event, saying in one line what it is and which of
//      the team's lines it touches, and showing no dollars, no other figure
//      and no level; the statement stands at 2028;
//   3. the Decisions page lists it under "Events so far", and it stays listed
//      after the banner is dismissed;
//   4. the lock into 2029 brings the Earthquake's banner; both are listed;
//   5. after the later locks, 2028's event is still listed under "Events so
//      far" on exactly the lines the banner named, and the Results tab is off
//      the bar. ⚠ RESTATED AT THE TAB CLEANUP: this read the Results page's own
//      event block, with its figures; Results is hidden since (src/game/tabs.tsx
//      HIDDEN_TABS). The panel takes its lines from the same news the banner
//      does, so this now holds that the listing persists, not that a second,
//      figured page agrees.
//
// Hosted (only with ADMIN_TOKEN — hosting needs the sign-in): a room playing WC
// and GL only, an Earthquake scheduled in year 2, one team. No banner after the
// first advance; on the advance into 2028 the team's banner names the
// Earthquake on its OWN lines — Workers' Compensation and General Liability,
// never Property, which the Earthquake strikes but this team does not write.
// ============================================================================
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const LINE_NAMES = ["Workers' Compensation", 'General Liability', 'Property'];

(async () => {
  await requireServer();
  // ⚠ NO ADMIN TOKEN for Test player, which must not need the sign-in; the
  // hosted part below launches its own browser with it.
  const adminToken = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  const browser = await launchBrowser();
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  const errors = [];
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
  for (const [id, yr] of [['#7', '2'], ['#1', '3']]) {
    await page.selectOption('[data-testid="shock-id"]', id);
    await page.fill('[data-testid="shock-year"]', yr);
    await page.click('[data-testid="add-shock"]');
  }
  await page.click('[data-testid="start-test-player"]');
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });

  async function lock(next) {
    await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
    await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
    await page.waitForTimeout(2500);
    const decline = page.getByRole('button', { name: /Decline/i }).first();
    if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
    const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
    if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
    await page.waitForSelector(`text=Lock Program Year ${next}`, { timeout: 120000 });
  }
  const banner = () => page.locator('[data-testid="event-news"]');
  const items = async () => (await page.locator('[data-testid="event-news-item"]').allInnerTexts()).map(t => t.trim());
  const linesIn = text => LINE_NAMES.filter(n => text.includes(n));

  // 1. A quiet year: no banner.
  ok(await banner().count() === 0, 'before any lock: no banner');
  await lock(2028);
  ok(await banner().count() === 0, 'after the lock into 2027, a quiet year: no banner');

  // 2. The lock into 2028: the banner at once.
  await lock(2029);
  ok(await banner().count() === 1, 'on the lock into 2028 the banner appears at once');
  const year = await banner().getAttribute('data-year');
  ok(year === '2028', 'and it is the news for 2028', year);
  const its = await items();
  const verdict = its.find(t => t.startsWith('Nuclear Verdict'));
  ok(its.length === 1 && verdict !== undefined, 'it names the event: Nuclear Verdict', its.join(' | '));
  const bannerLines = linesIn((verdict ?? '').split('Your lines affected:')[1] ?? '');
  ok(bannerLines.length > 0, 'and the team\'s lines it touches', bannerLines.join(', '));
  ok(/jury|award|verdict/i.test(verdict ?? ''), 'with one plain line saying what it is', verdict);
  const text = (await banner().innerText()).trim();
  ok(!/\$/.test(text) && !/\b\d[\d,.]*\b/.test(text.replace(/\b2028\b/g, '')), 'no dollars and no other figure — the year alone', text.replace(/\s+/g, ' '));
  ok(!/\b(severe|high|moderate|low|mid|level|band|size)\b/i.test(text), 'no level, band or size', '');
  // The year's results are in at once, beside the news: the newest result year is 2028.
  await page.getByRole('button', { name: 'Annual Statement', exact: true }).first().click();
  await page.waitForTimeout(600);
  const cols = (await page.locator('[data-testid="statement-operating"] tr[data-row-kind="header"] th').allInnerTexts()).map(c => c.trim()).filter(c => /^\d{4}$/.test(c));
  ok(cols.at(-1) === '2028', 'and 2028\'s results are in at once — the statement stands at 2028', cols.join(' '));

  // 3. Listed on the Decisions page; dismissing the banner keeps it listed.
  await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
  await page.waitForTimeout(500);
  let listed = await page.locator('[data-testid="events-panel-item"]').allInnerTexts();
  ok(listed.length === 1 && /^2028\s+Nuclear Verdict/.test(listed[0].trim()), 'the Decisions page lists it under Events so far', listed.join(' | '));
  await page.click('[data-testid="event-news-dismiss"]');
  await page.waitForTimeout(300);
  ok(await banner().count() === 0, 'the banner can be dismissed');
  ok(await page.locator('[data-testid="events-panel-item"]').count() === 1, 'and the event stays listed');

  // 4. The lock into 2029: the Earthquake's banner; both listed.
  await lock(2030);
  const its3 = await items();
  ok(await banner().count() === 1 && (await banner().getAttribute('data-year')) === '2029' && its3.length === 1 && its3[0].startsWith('Earthquake'),
    'on the lock into 2029 the Earthquake\'s banner — and only it', its3.join(' | '));
  await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
  await page.waitForTimeout(500);
  listed = (await page.locator('[data-testid="events-panel-item"]').allInnerTexts()).map(t => t.trim());
  ok(listed.length === 2 && /^2028\s+Nuclear Verdict/.test(listed[0]) && /^2029\s+Earthquake/.test(listed[1]),
    'both are listed, by year', listed.join(' | '));

  // 5. After the later locks 2028's event is still listed, on the banner's lines;
  //    the Results tab, which once showed its figures, is off the bar.
  await lock(2031);
  const barNow = (await page.locator('nav').first().locator('button').allInnerTexts()).map(t => t.trim());
  ok(!barNow.includes('Results'), 'Test player: the Results tab is off the bar (the tab cleanup)', barNow.join(' | '));
  await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
  await page.waitForTimeout(500);
  const later = (await page.locator('[data-testid="events-panel-item"]').allInnerTexts()).map(t => t.trim());
  const row2028 = later.find(t => /^2028\s+Nuclear Verdict/.test(t)) ?? '';
  const panelLines = linesIn((row2028.match(/\(([^)]*)\)\s*$/) ?? [])[1] ?? '');
  ok(row2028 !== '', 'after the later locks 2028\'s Nuclear Verdict is still listed', later.join(' | '));
  ok(JSON.stringify(panelLines) === JSON.stringify(bannerLines),
    'on exactly the lines the banner named', `listed ${panelLines.join(', ')} / banner ${bannerLines.join(', ')}`);

  ok(errors.length === 0, 'Test player: no page errors', errors[0] ?? '');
  await browser.close();

  // ---- hosted ------------------------------------------------------------
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
    await host.fill('[data-testid="event-name"]', 'Shock News');
    await host.selectOption('[data-testid="seed"]', '7');
    await host.fill('[data-testid="year-count"]', '3');
    await host.fill('[data-testid="expected-teams"]', '1');
    await host.uncheck('[data-testid="line-Property"]');
    await host.selectOption('[data-testid="shock-id"]', '#1');
    await host.fill('[data-testid="shock-year"]', '2');
    await host.click('[data-testid="add-shock"]');
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
      await team.getByRole('button', { name: /Lock Program Year/ }).first().click();
      await team.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
      await host.click('[data-testid="host-tab-setup"]').catch(() => {});
      await host.waitForTimeout(300);
      await host.click('[data-testid="advance"]');
      await team.waitForFunction(n => document.querySelector('[data-testid="posted-year"]')?.textContent.includes(`year ${n} result posted`), y, { timeout: 180000 });
      await team.waitForTimeout(800);
      const n = await team.locator('[data-testid="event-news"]').count();
      if (y === 1) ok(n === 0, 'hosted: after the advance into 2027, a quiet year: no banner');
      else {
        const t = (await team.locator('[data-testid="event-news-item"]').allInnerTexts()).map(x => x.trim());
        const lines = linesIn((t[0] ?? '').split('Your lines affected:')[1] ?? '');
        ok(n === 1 && t.length === 1 && t[0].startsWith('Earthquake'), 'hosted: on the advance into 2028 the team\'s banner names the Earthquake', t.join(' | '));
        ok(JSON.stringify(lines) === JSON.stringify(["Workers' Compensation", 'General Liability']),
          'hosted: on the team\'s own lines only — not Property, which it does not write', lines.join(', '));
        ok(!/\$/.test(t[0] ?? ''), 'hosted: no dollars');
      }
    }
    ok(errors.length === 0, 'hosted: no page errors', errors[0] ?? '');
    await hb.close();
  }
  console.log(`\nshock-news: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'SHOCK NEWS PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
