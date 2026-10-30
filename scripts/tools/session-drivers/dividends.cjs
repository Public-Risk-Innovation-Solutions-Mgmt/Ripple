// ============================================================================
// THE DIVIDEND / ASSESSMENT SLIDER, IN DOLLARS — a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/dividends.cjs
//
// Single player, scenario 16, all three lines, on General Liability:
//
// 1. The slider runs -$15M to +$15M in $1M notches — 31 of them, zero at the
//    centre — and opens at $0, "No dividend or assessment" beside it.
// 2. Moved to -$3M it reads "Assessment $3.00M" with "Assessment charged:
//    $3.00M" beside it; to +$2M, "Dividend $2.00M" with "Dividend paid: $2.00M".
// 3. Locked at -$3M: the save's decision is $3,000,000 and the year charged
//    exactly $3,000,000 of assessments on the line.
// 4. Moved to +$15M in the next year: the dollars beside it are what the engine
//    would pay — the full $15M if the surplus available covers it, else the
//    surplus available and "(limited to the surplus available)".
// ============================================================================
const zlib = require('node:zlib');
const { BASE, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const LINE_NAMES = ["Workers' Compensation", 'General Liability', 'Property'];

async function readSave(page) {
  const raw = await page.evaluate(() => {
    const k = Object.keys(localStorage).find(x => x.startsWith('riskpool_gamestate_'));
    return k ? localStorage.getItem(k) : null;
  });
  if (!raw) return null;
  const env = JSON.parse(zlib.inflateRawSync(Buffer.from(raw, 'base64')).toString('utf8'));
  return env.gameState ?? env;
}
const slider = page => page.locator('input[type="range"][min="-15000000"]').first();
async function setSlider(page, v) {
  await slider(page).evaluate((el, val) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, String(val));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await page.waitForTimeout(300);
}
const dollars = async page => (await page.locator('[data-testid="dividend-assessment-dollars"]').innerText()).replace(/\s+/g, ' ');
const money = s => { const m = /\$([\d.,]+)([MK]?)/.exec(s); if (!m) return NaN; const n = Number(m[1].replace(/,/g, '')); return m[2] === 'M' ? n * 1e6 : m[2] === 'K' ? n * 1e3 : n; };

(async () => {
  await requireServer();
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
  await page.getByRole('button', { name: 'Single player', exact: true }).click();
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
  await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
  await page.getByRole('button', { name: 'General Liability', exact: true }).first().click();
  await page.waitForTimeout(500);

  // 1. The range.
  const attrs = await slider(page).evaluate(el => ({ min: +el.min, max: +el.max, step: +el.step, value: +el.value }));
  ok(attrs.min === -15e6 && attrs.max === 15e6 && attrs.step === 1e6 && (attrs.max - attrs.min) / attrs.step + 1 === 31,
    'the slider runs -$15M to +$15M in $1M notches — 31 of them', JSON.stringify(attrs));
  ok(attrs.value === 0 && /No dividend or assessment/.test(await dollars(page)), 'it opens at $0, "No dividend or assessment" beside it', await dollars(page));

  // 2. The dollars beside it.
  await setSlider(page, -3e6);
  ok(/Assessment \$3\.00M/.test(await page.locator('main').innerText()) && /Assessment charged: \$3\.00M/.test(await dollars(page)),
    'at -$3M: "Assessment $3.00M", and "Assessment charged: $3.00M" beside it', await dollars(page));
  await setSlider(page, 2e6);
  const d2 = await dollars(page);
  ok(/Dividend \$2\.00M/.test(await page.locator('main').innerText()) && /Dividend paid: \$2\.00M/.test(d2),
    'at +$2M: "Dividend $2.00M", and "Dividend paid: $2.00M" beside it', d2);

  // 3. Locked at -$3M: the decision and the charge are $3M exactly.
  await setSlider(page, -3e6);
  await lockAndConfirm(page);
  await page.waitForTimeout(2500);
  const decline = page.getByRole('button', { name: /Decline/i }).first();
  if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
  const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
  if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
  await page.waitForSelector('text=Lock Program Year 2028', { timeout: 120000 });
  let save = null;
  for (let i = 0; i < 30 && !(save?.lockedResults?.length >= 1); i++) { save = await readSave(page); await page.waitForTimeout(500); }
  const gl = save?.lockedResults?.[0]?.byLine?.GL;
  ok(gl?.decisions?.assessmentAmount === 3e6 && gl?.decisions?.dividendAmount === 0, 'the save\'s decision is a $3,000,000 assessment', JSON.stringify({ a: gl?.decisions?.assessmentAmount, d: gl?.decisions?.dividendAmount }));
  ok(gl && Math.abs(gl.assessments - 3e6) < 0.01, 'and the year charged exactly $3,000,000 of assessments', String(gl?.assessments));

  // 4. +$15M next year: the dollars shown are what the engine would pay.
  await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
  await page.getByRole('button', { name: 'General Liability', exact: true }).first().click();
  await page.waitForTimeout(500);
  await setSlider(page, 15e6);
  const d4 = await dollars(page);
  const available = money(d4.split('Dividend paid')[0]);
  const paid = money(d4.split('Dividend paid')[1] ?? '');
  const want = Math.min(15e6, Math.max(0, available));
  ok(Number.isFinite(available) && Math.abs(paid - want) <= 0.01e6 && (available >= 15e6 || /limited to the surplus available/.test(d4)),
    'at +$15M the dividend shown is $15M or, below it, the surplus available and "(limited to the surplus available)"', d4);

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\ndividends: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'DIVIDENDS PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
