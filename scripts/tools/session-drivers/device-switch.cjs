// ============================================================================
// DEVICE SWITCHING, PHASE 1: create a team on one device, reclaim it on
// another by recovery code, and confirm the first device is locked out while
// the second continues — the exact scenario Mike's device-switching guide
// asks for under Testing: "a two-device script (create on A, reclaim on B,
// confirm A is locked out and B continues)".
//
// ⚠ THREE CONTEXTS, NOT TWO. A host is still needed to create the room in the
// first place — this driver is not testing hosting, so that context does the
// minimum and is never touched again once the room exists.
//
// ⚠ THE RECOVERY CODE IS READ OFF THE SCREEN, NEVER OUT OF A STORE. The whole
// point of the one-time modal (PlayScreen.tsx's RecoveryCodeModal) is that the
// server hands it back exactly once; a driver that reached into localStorage
// or the wire for it would not be proving the thing a real second device has
// to do, which is read it off a screen and type it somewhere else.
//
// ⚠ WHAT "A IS LOCKED OUT" MEANS HERE: device A's own poller (useRoom, a
// background interval) is what discovers the token has been rotated out from
// under it — nothing on this driver forces a read. Device A's screen must
// show team-moved (PlayScreen.tsx), not a generic error, which is the other
// gap this driver and that screen change close together.
// ============================================================================
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const { REPO } = require('./_shared.cjs');

// ⚠ SYNCHRONOUS, DELIBERATELY — NOT console.error. On this Windows/Node
// combination, a redirected/piped stdout is written ASYNCHRONOUSLY, and a
// process.exit() immediately after a console.log can win the race and
// truncate it — the exact failure mode that made an early crash here look
// like dead silence. fs.writeSync bypasses that: it blocks until the bytes
// are actually written, so the message survives whatever exits right after it.
function logSync(msg) {
  try { fs.writeSync(2, msg + '\n'); } catch { /* best effort */ }
}

const { execFileSync } = require('node:child_process');

/**
 * ⚠ taskkill /T ON WINDOWS, NOT process.kill(-pid). startStub()'s spawn runs
 * under shell: true there, so `stub.pid` names the cmd.exe wrapper, not the
 * tsx/node process actually holding the port underneath it — killing only the
 * wrapper would orphan that one, still bound to the port, for the next run to
 * fail against. /T kills the whole tree under the wrapper's PID; POSIX's
 * negative-PID SIGKILL already did the equivalent for the real process group
 * `detached: true` gives it there.
 */
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
    // ⚠ shell: true ON WINDOWS ONLY — spawn() resolves `npx` by exact filename,
    // and on Windows that binary is `npx.cmd`; without a shell to do PATH-style
    // resolution the call fails with ENOENT before anything else here runs.
    // ⚠ AND detached ONLY OFF WINDOWS — shell:true plus detached:true breaks
    // stdout piping there (confirmed: the "listening" line this function
    // waits for never arrives), so Windows gets neither detached nor the
    // POSIX process-group kill that needs it; killStubTree uses `taskkill /T`
    // there instead, which finds the whole tree by PID, not by group.
    const win = process.platform === 'win32';
    const args = ['tsx', 'scripts/tools/session-stub-server.ts', '--port', String(API_PORT)];
    // ⚠ ONE STRING ON WINDOWS, NOT shell:true PLUS AN ARGS ARRAY — Node warns
    // (DEP0190) that args alongside shell:true are concatenated unescaped
    // anyway, so building the string ourselves is the same thing with no
    // warning. Safe here: every element is a fixed literal or a port number
    // this process picked itself, never anything from outside it.
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

  // ⚠ THREE CONTEXTS: separate storage, separate identity, as unrelated as
  // three machines — the host, and the two "devices" the one team is driven
  // from in turn.
  const hostCtx = await browser.newContext({ baseURL: BASE });
  const deviceACtx = await browser.newContext({ baseURL: BASE });
  const deviceBCtx = await browser.newContext({ baseURL: BASE });
  const errs = [];
  for (const c of [hostCtx, deviceACtx, deviceBCtx]) c.on('page', p => p.on('pageerror', e => errs.push(e.message)));

  // ---- the room, from the host context -----------------------------------
  const host = await hostCtx.newPage();
  await host.goto(`/host?api=${encodeURIComponent(API)}`);
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="event-name"]', 'Device Switch Driver');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '1');
  await host.uncheck('[data-testid="line-GL"]');
  await host.uncheck('[data-testid="line-Property"]');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\n  room ${code} — created over HTTP from the host context\n`);

  // ---- device A: create the team, save the recovery code off the screen --
  const deviceA = await deviceACtx.newPage();
  await deviceA.goto(`/join/${code}?api=${encodeURIComponent(API)}`);
  await deviceA.waitForSelector('[data-testid="team-picker"]', { timeout: 30000 });
  await deviceA.fill('[data-testid="team-name"]', TEAM_NAME);
  await deviceA.click('[data-testid="join-team"]');

  await deviceA.waitForSelector('[data-testid="recovery-code"]', { timeout: 30000 });
  const recoveryCode = (await deviceA.textContent('[data-testid="recovery-code"]')).trim();
  ok(/^\d{4}$/.test(recoveryCode), `device A was shown a 4-digit recovery code (${recoveryCode})`);
  await deviceA.click('[data-testid="recovery-code-saved"]');

  await deviceA.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  ok(true, 'device A is driving the team after dismissing the recovery-code dialog');

  // ⚠ A SECOND DISMISSAL MUST NEVER HAPPEN. If this selector reappeared on a
  // later poll/rejoin, the one-time guarantee (JoinResponse.recoveryCode only
  // on create) would be broken.
  await deviceA.waitForTimeout(3500);
  ok(await deviceA.locator('[data-testid="recovery-code"]').count() === 0,
    'the recovery-code dialog does not return on its own — shown exactly once');

  // ---- device B: reclaim it from the Lobby, by room code + name + code ----
  const deviceB = await deviceBCtx.newPage();
  await deviceB.goto(`/?api=${encodeURIComponent(API)}`);
  await deviceB.waitForSelector('[data-testid="reclaim-team"]', { timeout: 30000 });
  await deviceB.click('[data-testid="reclaim-team"]');
  await deviceB.fill('[data-testid="reclaim-room-code"]', code);
  await deviceB.fill('[data-testid="reclaim-team-name"]', TEAM_NAME);
  await deviceB.fill('[data-testid="reclaim-code"]', recoveryCode);
  await deviceB.click('[data-testid="submit-reclaim"]');

  await deviceB.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  ok(true, 'device B is driving the SAME team after reclaiming it from the Lobby');
  ok(await deviceB.locator('[data-testid="recovery-code"]').count() === 0,
    'device B never sees a recovery-code dialog — a reclaim never reissues one');

  // ---- confirm device A's own poller discovers it has been moved ----------
  //
  // ⚠ NOTHING HERE FORCES A READ ON DEVICE A. useRoom's background interval
  // (floor 3s — data/pricingParameters.ts's SESSION_POLL_INTERVAL_MS) is what
  // has to find the BAD_TOKEN on its own; this just waits long enough for it
  // to have had the chance.
  await deviceA.waitForSelector('[data-testid="team-moved"]', { timeout: 30000 });
  ok(true, 'device A\'s own poller discovered the rotation and showed "team was moved", not a generic error');
  const movedText = (await deviceA.textContent('[data-testid="team-moved"]')).trim();
  ok(/moved to another device/i.test(movedText), `the message names what happened ("${movedText}")`);
  ok(await deviceA.locator('[data-testid="session-strip"]').count() === 0,
    'device A has dropped out of the game screen — it no longer holds a working credential');

  // ---- device B still drives the team, unaffected ------------------------
  const b = await (await fetch(`${API}/read`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })).json();
  const team = b.room.teams.find(t => t.name === TEAM_NAME);
  ok(!!team && team.joined, 'the team is still joined and in the room, under its new device');

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  ok(errs.length === 0, 'no page errors');

  await browser.close();
  killStubTree(stub.pid);
  logSync(`\ndevice-switch: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { logSync('FAIL'); process.exit(1); }
  logSync('DEVICE SWITCH PASS');
})().catch(e => {
  // Best-effort: the stub may never have been assigned if the crash was this
  // early, in which case there is nothing running to leak.
  killStubTree(stubPid);
  logSync('THREW: ' + (e && e.stack ? e.stack : String(e)));
  process.exit(1);
});
process.on('uncaughtException', e => { logSync('UNCAUGHT: ' + (e && e.stack ? e.stack : String(e))); killStubTree(stubPid); process.exit(1); });
process.on('unhandledRejection', e => { logSync('UNHANDLED REJECTION: ' + (e && e.stack ? e.stack : String(e))); killStubTree(stubPid); process.exit(1); });

// A failed run must not leave the port held for the next one.
process.on('exit', () => killStubTree(stubPid));
