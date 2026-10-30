// ============================================================================
// THE LOCK CONFIRMATION (components/LockConfirmModal; game/GameShell) — a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/lock-confirm.cjs
//
// In each mode — single player, Test player and a hosted room (on the session
// stub server, started here) — the year's lock button opens a box first:
//
// 1. It reads "Lock your <year> decisions?" and "Once locked, they can't be
//    changed this year.", with a summary per line (funding, underwriting,
//    covers, risk control, dividend / assessment) and the asset mix — the GL
//    assessment set before opening it reads "Assessment $3.00M".
// 2. "Go back", Escape and a click outside the box each close it and change
//    nothing: the year is not locked (single player and Test player: the save
//    holds no locked year and the button still names the same year; hosted: no
//    submit request leaves the page, the room holds no lock for the team and
//    the room's year does not move).
// 3. "Lock decisions" locks the year once: solo, exactly one locked year and the
//    next year's button; hosted, exactly one submit request and the team
//    waiting, the room holding its lock for the year.
// ⚠ THE HOSTED ROOM NEEDS ADMIN_TOKEN (the host screen's sign-in); run it with
// the admin-token hook, as the other host drivers are.
//
// 4. Single player, in a window 420px tall: the box fits inside the window and
//    scrolls, and "Lock decisions" can be scrolled to.
// ============================================================================
const zlib = require('node:zlib');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { BASE, REPO, launchBrowser, requireServer } = require('./_shared.cjs');

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const LINE_NAMES = ["Workers' Compensation", 'General Liability', 'Property'];
const BOX = '[data-testid="lock-confirm"]';
const lockButton = page => page.getByRole('button', { name: /Lock Program Year/ }).first();

async function readSave(page) {
  const raw = await page.evaluate(() => {
    const k = Object.keys(localStorage).find(x => x.startsWith('riskpool_gamestate_'));
    return k ? localStorage.getItem(k) : null;
  });
  if (!raw) return null;
  const env = JSON.parse(zlib.inflateRawSync(Buffer.from(raw, 'base64')).toString('utf8'));
  return env.gameState ?? env;
}
async function setAssessment(page, v) {
  await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
  await page.getByRole('button', { name: 'General Liability', exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.locator('input[type="range"][min="-15000000"]').first().evaluate((el, val) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, String(val));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await page.waitForTimeout(300);
}
async function soloStart(page) {
  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption('16');
  for (const label of LINE_NAMES) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
}

/** 1. The box's words and summary. */
async function checkBox(page, mode, year) {
  await lockButton(page).click();
  const box = page.locator(BOX);
  await box.waitFor({ timeout: 10000 });
  const text = (await box.innerText()).replace(/\s+/g, ' ');
  ok(text.includes(`Lock your ${year} decisions?`) && text.includes("Once locked, they can't be changed this year."),
    `${mode}: the lock button opens "Lock your ${year} decisions? Once locked, they can't be changed this year."`, text.slice(0, 90));
  const lines = await box.locator('[data-testid^="lock-confirm-line-"]').count();
  const labelsOk = ['Funding', 'Underwriting', 'Covers', 'Risk control', 'Dividend / assessment', 'Asset mix']
    .every(l => text.includes(l));
  ok(lines === 3 && labelsOk && /Cash \d+% · Bonds \d+% · Equities \d+%/.test(text),
    `${mode}: a summary per line — funding, underwriting, covers, risk control, dividend / assessment — and the asset mix`, `${lines} lines`);
  const gl = (await box.locator('[data-testid="lock-confirm-line-GL"]').innerText()).replace(/\s+/g, ' ');
  ok(/Assessment \$3\.00M/.test(gl), `${mode}: GL's assessment set to $3M reads "Assessment $3.00M" in the box`, gl);
  ok(await box.getByRole('button', { name: 'Lock decisions', exact: true }).count() === 1
    && await box.getByRole('button', { name: 'Go back', exact: true }).count() === 1,
    `${mode}: "Lock decisions" and "Go back"`);
}

/** 2. Go back, Escape and a click outside: the box closes. The caller checks nothing changed. */
async function dismissAllWays(page) {
  const box = page.locator(BOX);
  const closed = [];
  await box.getByRole('button', { name: 'Go back', exact: true }).click();
  closed.push(await box.count() === 0);
  await lockButton(page).click(); await box.waitFor();
  await page.keyboard.press('Escape');
  closed.push(await box.count() === 0);
  await lockButton(page).click(); await box.waitFor();
  await page.mouse.click(5, 5);
  closed.push(await box.count() === 0);
  await page.waitForTimeout(2500);
  return closed;
}

async function confirmLock(page) {
  await lockButton(page).click();
  const box = page.locator(BOX);
  await box.waitFor();
  await box.getByRole('button', { name: 'Lock decisions', exact: true }).click();
  return box;
}

async function soloMode(browser, mode, start) {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await soloStart(page);
  await start(page);
  await page.waitForSelector('text=Lock Program Year 2027', { timeout: 60000 });
  await setAssessment(page, -3e6);

  await checkBox(page, mode, 2027);
  const closed = await dismissAllWays(page);
  const save = await readSave(page);
  ok(closed.every(Boolean), `${mode}: "Go back", Escape and a click outside each close the box`, JSON.stringify(closed));
  ok(save?.currentYearNumber === 1 && (save?.lockedResults?.length ?? 0) === 0 && /Lock Program Year 2027/.test(await lockButton(page).innerText()),
    `${mode}: and the year is not locked — no locked year in the save, the button still "Lock Program Year 2027"`,
    JSON.stringify({ year: save?.currentYearNumber, locked: save?.lockedResults?.length }));

  if (mode === 'single player') {
    // 4. A short window: the box fits and scrolls.
    await page.setViewportSize({ width: 1000, height: 420 });
    await lockButton(page).click();
    const box = page.locator(BOX);
    await box.waitFor();
    const m = await box.evaluate(el => ({ sh: el.scrollHeight, ch: el.clientHeight, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom }));
    const btn = box.getByRole('button', { name: 'Lock decisions', exact: true });
    await btn.scrollIntoViewIfNeeded();
    const b = await btn.boundingBox();
    ok(m.sh > m.ch && m.top >= 0 && m.bottom <= 420 && b && b.y >= 0 && b.y + b.height <= 420,
      'single player: in a 420px window the box fits, scrolls, and "Lock decisions" scrolls into view', JSON.stringify(m));
    await box.getByRole('button', { name: 'Go back', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  // 3. Lock decisions: the year locks once.
  const box = await confirmLock(page);
  ok(await box.count() === 0, `${mode}: "Lock decisions" closes the box`);
  await page.waitForTimeout(2500);
  const decline = page.getByRole('button', { name: /Decline/i }).first();
  if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
  const cont = page.getByRole('button', { name: /Confirm & Continue/ }).first();
  if (await cont.count() > 0) { await cont.click(); await page.waitForTimeout(800); }
  await page.waitForSelector('text=Lock Program Year 2028', { timeout: 120000 });
  let after = null;
  for (let i = 0; i < 30 && !(after?.lockedResults?.length >= 1); i++) { after = await readSave(page); await page.waitForTimeout(500); }
  await page.waitForTimeout(2000);
  after = await readSave(page);
  ok(after?.currentYearNumber === 2 && after?.lockedResults?.length === 1 && after.lockedResults[0].byLine.GL.decisions.assessmentAmount === 3e6,
    `${mode}: "Lock decisions" locks the year once — one locked year, with the decisions the box showed`,
    JSON.stringify({ year: after?.currentYearNumber, locked: after?.lockedResults?.length }));
  ok(errors.length === 0, `${mode}: no page errors`, errors[0] ?? '');
  await page.context().close();
}

function freePort() {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}
function startStub(port) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'scripts/tools/session-stub-server.ts', '--port', String(port)], { cwd: REPO, detached: true });
    const bail = setTimeout(() => reject(new Error('stub did not start')), 60000);
    child.stdout.on('data', d => { if (String(d).includes('listening')) { clearTimeout(bail); resolve(child); } });
    child.stderr.on('data', d => process.stdout.write('  [stub:err] ' + d));
  });
}

async function hostedMode(browser) {
  const port = await freePort();
  const API = `http://localhost:${port}`;
  const stub = await startStub(port);
  try {
    const host = await (await browser.newContext({ baseURL: BASE })).newPage();
    await host.goto(`/host?api=${encodeURIComponent(API)}`);
    await host.waitForSelector('[data-testid="create-room"]');
    await host.fill('[data-testid="event-name"]', 'Lock Confirm');
    await host.selectOption('[data-testid="seed"]', '16');
    await host.fill('[data-testid="year-count"]', '3');
    await host.fill('[data-testid="expected-teams"]', '1');
    await host.click('[data-testid="create-room"]');
    await host.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
    const code = (await host.textContent('[data-testid="room-code"]')).trim();
    const hostToken = await host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.held.' + c) || '{}').hostToken, code);
    const read = async () => (await (await fetch(`${API}/read`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, token: hostToken }),
    })).json()).room;

    const team = await (await browser.newContext({ baseURL: BASE })).newPage();
    const errors = [];
    team.on('pageerror', e => errors.push(e.message));
    const submits = [];
    // ⚠ ONLY A SUBMIT CARRYING DECISIONS IS A LOCK. The client also posts its
    // opening (year 0) result on joining (useSessionGame), with no decisions.
    team.on('request', r => {
      if (r.method() !== 'POST' || !/\/submit$/.test(r.url())) return;
      try { if (JSON.parse(r.postData() || '{}').decisions !== undefined) submits.push(r.url()); } catch { /* not JSON */ }
    });
    await team.goto(`/join/${code}?api=${encodeURIComponent(API)}`);
    await team.waitForSelector('[data-testid="team-picker"]', { timeout: 30000 });
    await team.fill('[data-testid="team-name"]', 'Harbour Mutual');
    await team.click('[data-testid="join-team"]');
    await team.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
    await team.waitForSelector('text=Lock Program Year 2027', { timeout: 120000 });
    await setAssessment(team, -3e6);

    await checkBox(team, 'hosted', 2027);
    const closed = await dismissAllWays(team);
    const room = await read();
    ok(closed.every(Boolean), 'hosted: "Go back", Escape and a click outside each close the box', JSON.stringify(closed));
    ok(submits.length === 0 && await team.locator('[data-testid="waiting"]').count() === 0,
      'hosted: and nothing is sent — no decisions submitted, the team not waiting', `${submits.length} submit(s)`);
    ok(room?.currentYear === 1 && room.teams.every(t => t.lockedYear == null),
      'hosted: the room holds no lock for the team and its year does not move',
      JSON.stringify({ year: room?.currentYear, locked: room?.teams?.map(t => t.lockedYear) }));

    await confirmLock(team);
    await team.waitForSelector('[data-testid="waiting"]', { timeout: 60000 });
    await team.waitForTimeout(2500);
    const after = await read();
    ok(submits.length === 1, 'hosted: "Lock decisions" sends the decisions once — one submit request', `${submits.length} submit(s)`);
    ok(after?.currentYear === 1 && after.teams.length === 1 && after.teams[0].lockedYear === 1,
      'hosted: the room holds the team\'s lock for the year, and waits for the host to advance',
      JSON.stringify({ year: after?.currentYear, locked: after?.teams?.map(t => t.lockedYear) }));
    ok(errors.length === 0, 'hosted: no page errors', errors[0] ?? '');
  } finally {
    try { process.kill(-stub.pid); } catch { /* already gone */ }
  }
}

(async () => {
  await requireServer();
  // The solo games are played without the admin token; the hosted room's host
  // screen needs it (ADMIN_TOKEN, the admin-token hook), from a second browser.
  const adminToken = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  const browser = await launchBrowser();
  console.log('\n  single player');
  await soloMode(browser, 'single player', page => page.getByRole('button', { name: 'Single player', exact: true }).click());
  console.log('\n  Test player');
  await soloMode(browser, 'Test player', async page => {
    await page.getByRole('button', { name: 'Test player', exact: true }).click();
    await page.waitForSelector('[data-testid="test-player-setup"]', { timeout: 20000 });
    await page.click('[data-testid="start-test-player"]');
  });
  await browser.close();
  console.log('\n  hosted');
  if (adminToken) process.env.ADMIN_TOKEN = adminToken;
  const hosted = await launchBrowser();
  await hostedMode(hosted);
  await hosted.close();
  console.log(`\nlock-confirm: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'LOCK CONFIRM PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
