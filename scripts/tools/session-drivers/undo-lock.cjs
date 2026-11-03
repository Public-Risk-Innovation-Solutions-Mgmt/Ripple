// ============================================================================
// UNDO LOCK — the HOST reopens a team's current-year decisions, from the Game
// Setup tab's team table. A team locks its own year by submitting decisions;
// only the host can undo that lock, and the team's decisions are left
// untouched (the form reopens on what was submitted, not a reset).
//
// ⚠ TWO CONTEXTS: the host (stays on the Game Setup tab throughout) and the
// team (whose Decisions tab must re-enable the moment the host's undo lands,
// on its own next poll — nothing on this driver forces a read on that side).
// ============================================================================
const { BASE, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const { REPO } = require('./_shared.cjs');

function logSync(msg) {
  try { fs.writeSync(2, msg + '\n'); } catch { /* best effort */ }
}

function killStubTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

let API_PORT = 0;
let API = '';
let stubPid = 0;
const TEAM_NAME = 'Harbour Mutual';

const fails = [];
let checks = 0;
function ok(c, w) { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w); } else console.log('  ok    ' + w); }

function freePort() {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startStub() {
  return new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const args = ['tsx', 'scripts/tools/session-stub-server.ts', '--port', String(API_PORT)];
    const child = win
      ? spawn(['npx', ...args].join(' '), [], { cwd: REPO, shell: true })
      : spawn('npx', args, { cwd: REPO, detached: true });
    const bail = setTimeout(() => reject(new Error('stub did not start')), 60000);
    child.stdout.on('data', d => {
      process.stdout.write('  [stub] ' + d);
      if (String(d).includes('listening')) { clearTimeout(bail); resolve(child); }
    });
    child.stderr.on('data', d => process.stdout.write('  [stub:err] ' + d));
  });
}

(async () => {
  await requireServer();
  API_PORT = await freePort();
  API = `http://localhost:${API_PORT}`;
  const stub = await startStub();
  stubPid = stub.pid;
  const browser = await launchBrowser();

  const hostCtx = await browser.newContext({ baseURL: BASE });
  const deviceCtx = await browser.newContext({ baseURL: BASE });
  const errs = [];
  for (const c of [hostCtx, deviceCtx]) c.on('page', p => p.on('pageerror', e => errs.push(e.message)));

  // ---- the room, WC-only ----------------------------------------------------
  const host = await hostCtx.newPage();
  await host.goto(`/host?api=${encodeURIComponent(API)}`);
  await host.waitForSelector('[data-testid="create-room"]', { timeout: 30000 });
  await host.fill('[data-testid="event-name"]', 'Undo Lock Driver');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '1');
  await host.uncheck('[data-testid="line-GL"]');
  await host.uncheck('[data-testid="line-Property"]');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\n  room ${code} — created over HTTP from the host context\n`);

  // ---- the team joins and locks its year ------------------------------------
  const device = await deviceCtx.newPage();
  await device.goto(`/join/${code}?api=${encodeURIComponent(API)}`);
  await device.waitForSelector('[data-testid="team-picker"]', { timeout: 30000 });
  await device.fill('[data-testid="team-name"]', TEAM_NAME);
  await device.click('[data-testid="join-team"]');
  await device.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  ok(true, 'the team is driving');

  // Host's Game Setup tab (the default tab) shows "open" before any lock.
  await host.waitForSelector(`[data-testid="joined-${TEAM_NAME}"]`, { timeout: 30000 });
  ok(await host.locator(`[data-testid="locked-${TEAM_NAME}"]`).count() === 0,
    'the host sees "open", not "locked", before the team locks anything');

  await lockAndConfirm(device);
  await device.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
  ok(true, 'the team locked its year and sees "Waiting for host"');

  // ---- the host sees it locked, and undoes it -------------------------------
  await host.waitForSelector(`[data-testid="locked-${TEAM_NAME}"]`, { timeout: 30000 });
  ok(true, 'the host now sees the team as locked');
  const undoBtn = host.locator(`[data-testid="undo-lock-${TEAM_NAME}"]`);
  await undoBtn.waitFor({ timeout: 10000 });
  await undoBtn.click();
  await host.waitForSelector(`[data-testid="locked-${TEAM_NAME}"]`, { state: 'detached', timeout: 30000 });
  ok(true, 'the host\'s undo reopened the lock — the row reads "open" again');

  // ---- the team's own screen re-enables on its next poll --------------------
  await device.waitForSelector('[data-testid="waiting"]', { state: 'detached', timeout: 30000 });
  ok(true, 'the team\'s own screen left the locked state, with no action from this device');
  await device.waitForSelector('button:has-text("Lock Program Year")', { timeout: 30000 });
  const relockBtn = device.getByRole('button', { name: /Lock Program Year/ });
  ok(await relockBtn.isEnabled(), 'the Lock button is enabled again — the team can re-lock');

  // The reinsurance panel (editable only while unlocked) is reachable again —
  // confirms decisionsDisabled actually flipped, not just the button label.
  await device.getByRole('button', { name: "Workers' Compensation" }).click();
  const anyOption = device.locator('[data-testid^="reins-option-WC-"]').first();
  await anyOption.waitFor({ timeout: 10000 });
  ok(!(await anyOption.isDisabled()), 'the Decisions tab controls are editable again, not just the button');

  // ---- re-lock works normally after an undo ---------------------------------
  await lockAndConfirm(device);
  await device.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
  ok(true, 're-locking the same year after an undo succeeds normally');
  await host.waitForSelector(`[data-testid="locked-${TEAM_NAME}"]`, { timeout: 30000 });
  ok(true, 'the host sees it locked again');

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  ok(errs.length === 0, 'no page errors');

  await browser.close();
  killStubTree(stub.pid);
  logSync(`\nundo-lock: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { logSync('FAIL'); process.exit(1); }
  logSync('UNDO LOCK PASS');
})().catch(e => {
  killStubTree(stubPid);
  logSync('THREW: ' + (e && e.stack ? e.stack : String(e)));
  process.exit(1);
});
process.on('uncaughtException', e => { logSync('UNCAUGHT: ' + (e && e.stack ? e.stack : String(e))); killStubTree(stubPid); process.exit(1); });
process.on('unhandledRejection', e => { logSync('UNHANDLED REJECTION: ' + (e && e.stack ? e.stack : String(e))); killStubTree(stubPid); process.exit(1); });

process.on('exit', () => killStubTree(stubPid));
