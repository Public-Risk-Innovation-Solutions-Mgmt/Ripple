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
// Verdict's and Social Inflation's banners carry the line on older claims, word
// for word, and the two law changes say older claims will also cost more.
// ⚠ NO DURATION: players are not told how long an event lasts, so no banner and
// no Events so far row may carry a duration phrase (DURATION, the same list as
// event-news-coverage-check), and Social Inflation's game plays two more years
// and Nuclear Verdict's one more with no later-year note and no banner — a note
// would tell them when the effect ends. With --shots, each banner is saved as
// <id>-<name>.png, and Social Inflation's Events so far two years on.
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
  '#4': ['Legislation Change', false, ['General Liability'], /older liability claims will also cost more\. Your lines/],
  '#5': ['Workers Compensation Legislation: Increased Medical Fee Schedule', false, ["Workers' Compensation"], /older WC claims will also cost more\. Your lines/],
  '#6': ['Economic Recession', false, ["Workers' Compensation", 'General Liability'], /liability claims cost more\. Your lines/],
  '#7': ['Nuclear Verdict', false, ['General Liability'], /one very large liability claim this year\. It also makes older liability claims grow\. Your lines/],
  '#8': ['Social Inflation', false, ['General Liability'], /a large liability claim is brought\. Older liability claims will also grow\. Your lines/],
  '#9': ['Pandemic', false, ["Workers' Compensation", 'General Liability'], /large liability claim is brought over the illness\. Your lines/],
  '#10': ['Economic Inflation', false, LINE_NAMES, /settling claims/],
  '#11': ['Large Investment Loss', false, [], /investment returns fall sharply this year.*Affects your pool's invested assets/],
  '#12': ['Large Member Withdrawal', false, LINE_NAMES, /a quarter of each line's book from next year/],
};

// ⚠ A DURATION PHRASE (the coverage check's list): how long an effect lasts or when it ends.
const DURATION = new RegExp([
  'this year alone', 'this year only', 'in this year', 'rest of the game', 'for (the )?(good|ever)', 'permanent',
  '\\b(one|two|three|four|five|six|seven|eight|nine|ten|\\d+) (more )?years?\\b', 'year \\d+ of \\d+',
  'still (growing|in force)', 'each year', 'every year', 'until', 'no longer', '\\bends?\\b', '\\blasts?\\b', 'temporar',
].join('|'), 'i');
const noDuration = text => { const m = text.match(DURATION); return m ? `"${m[0]}" in: ${text}` : ''; };
// The control: the check above must catch each phrase the banners used to carry.
for (const was of ['The effect is felt in this year alone.', 'It also makes older liability claims grow, in this year only.',
  'Older liability claims will keep growing for three years: this year and the next two, a little less each year.',
  'older WC claims will keep costing more for the rest of the game.', 'Older liability claims are still growing: year 2 of 3.']) {
  ok(noDuration(was) !== '', `control: the duration check catches "${was}"`);
}

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
    ok(noDuration(it) === '', 'no duration', noDuration(it));
    if (SHOTS) {
      const slug = name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-+$/, '');
      await banner.screenshot({ path: path.join(SHOTS, `${id.slice(1).padStart(2, '0')}-${slug}.png`) });
    }
    await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
    await page.waitForTimeout(400);
    const listed = (await page.locator('[data-testid="events-panel-item"]').allInnerTexts()).map(t => t.trim().replace(/\s+/g, ' '));
    ok(listed.length === 1 && listed[0].startsWith(`${year} ${name}`), 'Events so far lists it in its year', listed.join(' | '));
    ok(listed.every(t => noDuration(t) === ''), 'Events so far: no duration', listed.map(noDuration).filter(Boolean).join(' | '));
    if (id === '#7' || id === '#8') {
      const extra = id === '#8' ? 2 : 1;
      for (let i = 0; i < extra; i++) await lock();
      await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
      await page.waitForTimeout(400);
      const later = (await page.locator('[data-testid="events-panel-item"]').allInnerTexts()).map(t => t.trim().replace(/\s+/g, ' '));
      const after = await page.locator('[data-testid="event-news"]').count();
      ok(later.length === 1 && later[0] === listed[0], `Events so far ${extra} year${extra > 1 ? 's' : ''} on: the one row, no later note`, later.join(' | '));
      ok(later.every(t => noDuration(t) === ''), 'and no duration', later.map(noDuration).filter(Boolean).join(' | '));
      if (id === '#8' && SHOTS) await page.locator('[data-testid="events-panel"]').screenshot({ path: path.join(SHOTS, '08-social-inflation-events-so-far.png') });
      ok(after === 0, 'and no banner in a year it only continues', '');
    }
    await page.context().close();
  }
  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\nevent-news-all: ${passed}/${passed + failed} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
