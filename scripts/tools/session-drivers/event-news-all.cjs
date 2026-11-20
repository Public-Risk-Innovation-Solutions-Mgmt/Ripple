// ============================================================================
// EVERY EVENT IN THE CATALOGUE REACHES THE BANNER AND EVENTS SO FAR — a driver
// (pr/shock-events-display).
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/event-news-all.cjs [--shots DIR]
//
// Test player (the host's setup in solo, no sign-in), scenario 16, three
// lines, one game per event: the event alone in year 2. After the second lock
// the banner names it by its player name (a regional one with its region,
// saying the large claim lands there and the whole line's costs rise) on the
// lines it touches, with no figure; the Decisions page lists it under Events
// so far. Investment Loss says what it touched is the invested assets; Member
// Withdrawal that a quarter of each line's book leaves from next year. Nuclear
// Verdict's and Social Inflation's banners carry the lasting line; Social
// Inflation's game plays two more years and Events so far gains a note in each
// ("still growing", year 2 of 3, year 3 of 3), Nuclear Verdict's one more and
// gains none. With --shots, each banner is saved as <id>-<name>.png.
//
// The same twelve, through the engine on three lines and on WC alone, with
// controls: scripts/diagnostics/event-news-coverage-check.ts.
// ============================================================================
const path = require('node:path');
const fs = require('node:fs');
const { BASE, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const LINE_NAMES = ["Workers' Compensation", 'General Liability', 'Property'];
const linesIn = text => LINE_NAMES.filter(n => text.includes(n));
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// id -> [player name, regional, lines named on the banner (three lines in play), the text it must carry]
const EVENTS = {
  '#1': ['Earthquake', true, LINE_NAMES, /whole of each line/],
  '#2': ['Winterstorm', true, ['Property'], /whole line/],
  '#3': ['Wildfire', true, ['Property'], /whole line/],
  '#4': ['Legislation Change', false, ['General Liability'], /rest of the game/],
  '#5': ['Workers Compensation Legislation: Increased Medical Fee Schedule', false, ["Workers' Compensation"], /rest of the game/],
  '#6': ['Economic Recession', false, ["Workers' Compensation", 'General Liability'], /this year alone/],
  '#7': ['Nuclear Verdict', false, ['General Liability'], /this year only/],
  '#8': ['Social Inflation', false, ['General Liability'], /three years/],
  '#9': ['Pandemic', false, ["Workers' Compensation", 'General Liability'], /large liability claim.*this year alone/],
  '#10': ['Economic Inflation', false, LINE_NAMES, /settling claims/],
  '#11': ['Large Investment Loss', false, [], /investment returns fall sharply this year.*Affects your pool's invested assets/],
  '#12': ['Large Member Withdrawal', false, LINE_NAMES, /a quarter of each line's book from next year/],
};

(async () => {
  await requireServer();
  delete process.env.ADMIN_TOKEN;
  const browser = await launchBrowser();
  const errors = [];
  for (const [id, [name, regional, lines, must]] of Object.entries(EVENTS)) {
    console.log(`${id} ${name}`);
    const page = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })).newPage();
    page.on('pageerror', e => errors.push(`${id}: ${e.message}`));
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
    await page.selectOption('[data-testid="shock-id"]', id);
    await page.fill('[data-testid="shock-year"]', '2');
    await page.click('[data-testid="add-shock"]');
    await page.click('[data-testid="start-test-player"]');
    await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
    const lock = async () => {
      await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
      const before = (await page.locator('text=/Lock Program Year \\d{4}/').first().innerText()).match(/\d{4}/)[0];
      await lockAndConfirm(page);
      await page.waitForTimeout(2000);
      const decline = page.getByRole('button', { name: /Decline/i }).first();
      if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(600); }
      const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
      if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(600); }
      await page.waitForSelector(`text=Lock Program Year ${Number(before) + 1}`, { timeout: 120000 });
    };
    await lock();
    ok(await page.locator('[data-testid="event-news"]').count() === 0, 'a quiet first year: no banner');
    await lock();
    const banner = page.locator('[data-testid="event-news"]');
    ok(await banner.count() === 1, 'the banner, after the year it fires');
    const year = await banner.getAttribute('data-year');
    const items = (await page.locator('[data-testid="event-news-item"]').allInnerTexts()).map(t => t.trim().replace(/\s+/g, ' '));
    const it = items.find(t => t.startsWith(name)) ?? '';
    ok(items.length === 1 && it !== '', `it names ${name}`, items.join(' | '));
    if (regional) {
      const region = (it.match(/— (\w+) region\./) ?? [])[1];
      ok(!!region && it.includes(`lands in the ${region} region`), 'its region, and that its large claim lands there', it);
    }
    ok(must.test(it), 'and says what happened', it);
    const named = linesIn((it.split('Your lines affected:')[1] ?? ''));
    ok(JSON.stringify(named) === JSON.stringify(lines), 'on the lines it touches', named.join(', ') || '(none)');
    ok(!/\$|\d/.test(it), 'no figure', '');
    if (SHOTS) {
      const slug = name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-+$/, '');
      await banner.screenshot({ path: path.join(SHOTS, `${id.slice(1).padStart(2, '0')}-${slug}.png`) });
    }
    await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
    await page.waitForTimeout(400);
    const listed = (await page.locator('[data-testid="events-panel-item"]').allInnerTexts()).map(t => t.trim().replace(/\s+/g, ' '));
    ok(listed.length === 1 && listed[0].startsWith(`${year} ${name}`), 'Events so far lists it in its year', listed.join(' | '));
    if (id === '#7' || id === '#8') {
      const extra = id === '#8' ? 2 : 1;
      for (let i = 0; i < extra; i++) await lock();
      await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
      await page.waitForTimeout(400);
      const later = (await page.locator('[data-testid="events-panel-item"]').allInnerTexts()).map(t => t.trim().replace(/\s+/g, ' '));
      const notes = later.filter(t => /still growing/.test(t));
      const after = await page.locator('[data-testid="event-news"]').count();
      if (id === '#8') {
        ok(notes.length === 2 && /year 2 of 3/.test(notes[0]) && /year 3 of 3/.test(notes[1]) && notes.every(n => n.includes(`(since ${year})`)),
          'Events so far: a note in each later year it lasts', later.join(' | '));
        if (SHOTS) await page.locator('[data-testid="events-panel"]').screenshot({ path: path.join(SHOTS, '08-social-inflation-events-so-far.png') });
      } else {
        ok(notes.length === 0 && later.length === 1, 'Events so far: no later note — its effect is its own year\'s', later.join(' | '));
      }
      ok(after === 0, 'and no banner in a year it only continues', '');
    }
    await page.context().close();
  }
  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\nevent-news-all: ${passed}/${passed + failed} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
