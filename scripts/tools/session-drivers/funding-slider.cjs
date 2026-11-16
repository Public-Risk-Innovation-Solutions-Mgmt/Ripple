// THE FUNDING SLIDER — 5% STEPS, AND PERCENTAGES WITHOUT WORDS.
//
// Drives a solo game on scenario 7, three lines, through the real setup screen
// and, on each line's Decisions page, walks the Funding Confidence Level
// slider from its minimum to its maximum by the keyboard, one step at a time:
//
//   - the slider opens on the play default, 65%, labelled "(65%)";
//   - it steps 30%, 35% … 90% — thirteen positions, 5% apart;
//   - each position reads "(N%)" and nothing else (no "Above Average");
//   - "Reset to Expected (~X%)" puts it on Expected, labelled "Expected (~X%)"
//     at the X its button named.
//
// ⚠ RESTATED FOR pr/pregame-65: the play default is now 65% (PLAY_DEFAULTS),
// not Expected, so the slider opens on "(65%)" and "Reset to Expected" is
// offered from the start. The reset check reads X from the button's own label
// rather than from an Expected opening that no longer exists. Against the aws
// build (opens on Expected) the opening check fails, as it must.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/funding-slider.cjs
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

const LINES = ["Workers' Compensation", 'General Liability', 'Property'];
const WANT = Array.from({ length: 13 }, (_, i) => 30 + 5 * i);

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption('7');
  for (const label of LINES) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
  await page.getByRole('button', { name: 'Single player', exact: true }).click();
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
  await page.getByRole('button', { name: /^Decisions$/ }).first().click();

  for (const line of LINES) {
    await page.getByRole('button', { name: line, exact: true }).first().click();
    await page.waitForTimeout(500);
    const box = page.locator('div.flex.flex-col.gap-2', { has: page.locator('span', { hasText: /^Funding Confidence Level$/ }) }).first();
    const input = box.locator('input[type=range]');
    const shown = async () => ((await box.locator('span.font-bold').first().innerText()) || '').trim();

    const opening = await shown();
    ok(opening === '(65%)', `${line}: opens on the play default, labelled "(65%)"`, opening);
    const attrs = await input.evaluate(el => ({ min: el.min, max: el.max, step: el.step }));
    ok(attrs.min === '0.3' && attrs.max === '0.9' && attrs.step === '0.05', `${line}: the slider runs 30% to 90% in 5% steps`, JSON.stringify(attrs));

    await input.focus();
    await page.keyboard.press('Home');
    await page.waitForTimeout(150);
    const seen = [];
    for (let i = 0; i < WANT.length; i++) {
      if (i > 0) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(120); }
      seen.push({ value: Number(await input.inputValue()), label: await shown() });
    }
    const values = seen.map(s => Math.round(s.value * 100));
    ok(JSON.stringify(values) === JSON.stringify(WANT), `${line}: one step at a time it visits every 5% from 30% to 90%`, values.join(' '));
    const labels = seen.map(s => s.label);
    ok(labels.every((l, i) => l === `(${WANT[i]}%)`), `${line}: every position reads "(N%)" and nothing else`, labels.join(' '));
    ok(labels.every(l => !/[A-Za-z]/.test(l)), `${line}: no descriptive words on any position`);

    const reset = page.getByRole('button', { name: /^Reset to Expected/ }).first();
    ok(await reset.count() > 0, `${line}: "Reset to Expected" is offered off Expected`);
    if (await reset.count() > 0) {
      const named = ((await reset.innerText()) || '').trim().match(/^Reset to Expected \(~(\d+)%\)$/);
      await reset.click();
      await page.waitForTimeout(300);
      const back = await shown();
      ok(named !== null && back === `Expected (~${named[1]}%)`, `${line}: Reset puts it on Expected, at the position its button named`, `${named ? named[0] : 'no (~X%) on the button'} -> ${back}`);
      ok(await page.getByRole('button', { name: /^Reset to Expected/ }).count() === 0, `${line}: and on Expected the reset is no longer offered`);
    }
  }

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\nfunding-slider: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'FUNDING SLIDER PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
