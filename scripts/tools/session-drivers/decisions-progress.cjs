// ============================================================================
// THE DECISIONS SUB-MENU'S PROGRESS BADGE — HOW THE POOL STEP COUNTS. A driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   ADMIN_TOKEN=... node scripts/tools/session-drivers/decisions-progress.cjs
//
// A hosted room, one team, all three lines (the badge — "n of 4" — is the
// hosted team's only; single player and Test player show none). Each step on a
// fresh team in the same room:
//
// 1. LEAVING POOL FOR A LINE COUNTS POOL AS DONE: the team opens on Pool at
//    "0 of 4"; selecting Workers' Compensation in the sub-menu, the investment
//    mix untouched, reads "1 of 4" — keeping the mix is a valid choice. The
//    line selected is not counted by being selected: moving on to General
//    Liability and back to Pool stays at "1 of 4" (lines count as before).
// 2. NEXT PAST POOL still counts it ("1 of 4"), as before.
// 3. CHANGING THE MIX still counts Pool without leaving it ("1 of 4").
// 4. A LINE still counts when its funding level changes: after step 1, one
//    step of Workers' Compensation's funding slider reads "2 of 4".
// 5. Nothing of it is a decision: leaving Pool sends no submit, and the
//    room's decisions for the team are unchanged (the badge is display only).
//
// ⚠ VALIDATED AGAINST THE BROKEN CODE: on aws a7f4131 (Pool counted only by
// its mix or Next), step 1 reads "0 of 4" and fails.
//
// SHOTS_DIR=<dir> writes the bar on Pool (on-pool.png) and after moving to
// Workers' Compensation with the mix untouched (moved-to-a-line.png).
//
// ⚠ THE HOSTED ROOM NEEDS ADMIN_TOKEN (the host screen's sign-in); run it with
// the admin-token hook, as the other host drivers are.
// ============================================================================
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { BASE, REPO, launchBrowser, requireServer } = require('./_shared.cjs');

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const BADGE = '[data-testid="line-activity-badge"]';
const SHOTS = process.env.SHOTS_DIR;

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

const badge = async page => (await page.locator(BADGE).innerText()).trim();
// The sub-menu's tabs: the bar holding the badge, so the top tabs' names never match.
const subTab = (page, name) => page.locator(`${BADGE}`).locator('xpath=ancestor::*[.//button][1]')
  .getByRole('button', { name, exact: true }).first();
async function waitBadge(page, want) {
  for (let i = 0; i < 20; i++) { if (await badge(page) === want) return want; await page.waitForTimeout(150); }
  return badge(page);
}
async function shot(page, name) {
  if (!SHOTS) return;
  const bar = page.locator(BADGE).locator('xpath=ancestor::*[.//button][1]');
  await bar.screenshot({ path: path.join(SHOTS, name) });
}

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const port = await freePort();
  const API = `http://localhost:${port}`;
  const stub = await startStub(port);
  try {
    const host = await (await browser.newContext({ baseURL: BASE })).newPage();
    await host.goto(`/host?api=${encodeURIComponent(API)}`);
    await host.waitForSelector('[data-testid="create-room"]');
    await host.fill('[data-testid="event-name"]', 'Pool Progress');
    await host.selectOption('[data-testid="seed"]', '16');
    await host.fill('[data-testid="year-count"]', '3');
    await host.fill('[data-testid="expected-teams"]', '4');
    await host.click('[data-testid="create-room"]');
    await host.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
    const code = (await host.textContent('[data-testid="room-code"]')).trim();
    const hostToken = await host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.held.' + c) || '{}').hostToken, code);
    const read = async () => (await (await fetch(`${API}/read`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, token: hostToken }),
    })).json()).room;

    const errors = [];
    const submits = [];
    async function joinTeam(name) {
      const team = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } })).newPage();
      team.on('pageerror', e => errors.push(`${name}: ${e.message}`));
      team.on('request', r => {
        if (r.method() !== 'POST' || !/\/submit$/.test(r.url())) return;
        try { if (JSON.parse(r.postData() || '{}').decisions !== undefined) submits.push(name); } catch { /* not JSON */ }
      });
      await team.goto(`/join/${code}?api=${encodeURIComponent(API)}`);
      await team.waitForSelector('[data-testid="team-picker"]', { timeout: 30000 });
      await team.fill('[data-testid="team-name"]', name);
      await team.click('[data-testid="join-team"]');
      await team.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
      await team.waitForSelector('text=Lock Program Year 2027', { timeout: 120000 });
      await team.getByRole('button', { name: 'Decisions', exact: true }).first().click();
      await team.waitForSelector(BADGE, { timeout: 30000 });
      await subTab(team, 'Pool').click();
      await team.waitForTimeout(300);
      return team;
    }

    // 1. Leaving Pool for a line counts Pool as done; selecting lines counts nothing more.
    const a = await joinTeam('Harbour Mutual');
    const opened = await badge(a);
    ok(opened === '0 of 4', '1. the team opens on Pool at "0 of 4"', opened);
    await shot(a, 'on-pool.png');
    await subTab(a, "Workers' Compensation").click();
    const afterLeave = await waitBadge(a, '1 of 4');
    ok(afterLeave === '1 of 4', '1. selecting Workers\' Compensation, the mix untouched, counts Pool: "1 of 4"', afterLeave);
    await shot(a, 'moved-to-a-line.png');
    await subTab(a, 'General Liability').click();
    await a.waitForTimeout(300);
    await subTab(a, 'Pool').click();
    await a.waitForTimeout(300);
    const stays = await badge(a);
    ok(stays === '1 of 4', '1. moving on to General Liability and back to Pool counts no line: still "1 of 4"', stays);

    // 4. A line still counts on its funding level (on the same team).
    await subTab(a, "Workers' Compensation").click();
    await a.waitForTimeout(300);
    const fundingBox = a.locator('div.flex.flex-col.gap-2', { has: a.locator('span', { hasText: /^Funding Confidence Level$/ }) }).first();
    await fundingBox.locator('input[type=range]').focus();
    await a.keyboard.press('ArrowRight');
    const afterFunding = await waitBadge(a, '2 of 4');
    ok(afterFunding === '2 of 4', '4. a line still counts when its funding level changes: "2 of 4"', afterFunding);

    // 2. Next past Pool still counts it (a fresh team).
    const b = await joinTeam('Cedar Pool');
    await b.getByRole('button', { name: /next/i }).last().click();
    const afterNext = await waitBadge(b, '1 of 4');
    ok(afterNext === '1 of 4', '2. Next past Pool still counts it: "1 of 4"', afterNext);

    // 3. Changing the mix still counts Pool without leaving it (a fresh team).
    const c = await joinTeam('Birch Mutual');
    const divider = c.getByLabel('Cash / Bonds divider');
    const box = await divider.boundingBox();
    await c.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await c.mouse.down();
    await c.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
    await c.mouse.up();
    const afterMix = await waitBadge(c, '1 of 4');
    const onPool = await c.locator(BADGE).count() > 0;
    ok(afterMix === '1 of 4' && onPool, '3. changing the mix still counts Pool, still on Pool: "1 of 4"', afterMix);

    // 5. Display only: no decision was sent by any of it.
    const room = await read();
    ok(submits.length === 0, '5. leaving Pool sends no decisions — no submit', `${submits.length} submit(s)`);
    ok(room?.teams?.every(t => t.lockedYear == null), '5. and the room holds no lock for any team', JSON.stringify(room?.teams?.map(t => t.lockedYear)));
    ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  } finally {
    try { process.kill(-stub.pid); } catch { /* already gone */ }
    await browser.close();
  }
  console.log(`\ndecisions-progress: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'DECISIONS PROGRESS PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
