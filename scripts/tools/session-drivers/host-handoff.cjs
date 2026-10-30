// ============================================================================
// DEVICE SWITCHING, PHASE 2: the HOST hands a team a one-time link (and QR
// code) from the Teams tab, and whoever opens it on a new device is dropped
// straight into driving that team — no recovery code needed. Mike's
// device-switching guide's phase 2, and its own Testing note: a two-device
// script, this time starting from the host's side instead of a saved code.
//
// ⚠ SAME THREE-PLUS-ONE SHAPE AS device-switch.cjs, AND FOR THE SAME REASON:
// a host is needed to create the room (and, here, to BE the host performing
// the hand-off — createHandoff is host-authenticated, so this driver needs a
// real admin session on /host, not just a room to exist). See that file's own
// header for the ADMIN_TOKEN / dev-admin-server setup this inherits.
//
// ⚠ THE LINK IS READ OFF THE TEAMS TAB, NEVER OUT OF A STORE OR THE WIRE. The
// whole point of HandoffModal is that `createHandoff`'s response is shown
// once, read by a human (or a QR scanner) and carried to the new device;
// reaching into localStorage or the HTTP response for it would not prove the
// thing a real host does, which is read it off the screen.
// ============================================================================
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const { REPO } = require('./_shared.cjs');

// ⚠ SYNCHRONOUS, DELIBERATELY — see device-switch.cjs's own note: a piped
// stdout on this Windows/Node combination is written asynchronously, and
// process.exit() right after console.log can truncate it.
function logSync(msg) {
  try { fs.writeSync(2, msg + '\n'); } catch { /* best effort */ }
}

/** Same taskkill-on-Windows / process-group-on-POSIX split as device-switch.cjs. */
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
    // Same Windows shell/detached split as device-switch.cjs — see its notes.
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

  // ⚠ FOUR CONTEXTS: the host (stays on the Teams tab throughout), device A
  // (the team's original device), device B (the new device the hand-off link
  // moves it to), and device C (a second, later open of the SAME link, which
  // must fail — that is what makes the link single-use).
  const hostCtx = await browser.newContext({ baseURL: BASE });
  const deviceACtx = await browser.newContext({ baseURL: BASE });
  const deviceBCtx = await browser.newContext({ baseURL: BASE });
  const deviceCCtx = await browser.newContext({ baseURL: BASE });
  const errs = [];
  for (const c of [hostCtx, deviceACtx, deviceBCtx, deviceCCtx]) c.on('page', p => p.on('pageerror', e => errs.push(e.message)));

  // ---- the room, from the host context -----------------------------------
  const host = await hostCtx.newPage();
  await host.goto(`/host?api=${encodeURIComponent(API)}`);
  await host.waitForSelector('[data-testid="create-room"]', { timeout: 30000 });
  await host.fill('[data-testid="event-name"]', 'Host Handoff Driver');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '1');
  await host.uncheck('[data-testid="line-GL"]');
  await host.uncheck('[data-testid="line-Property"]');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\n  room ${code} — created over HTTP from the host context\n`);

  // ---- device A: join the team (recovery-code dialog auto-dismissed) -----
  const deviceA = await deviceACtx.newPage();
  await deviceA.goto(`/join/${code}?api=${encodeURIComponent(API)}`);
  await deviceA.waitForSelector('[data-testid="team-picker"]', { timeout: 30000 });
  await deviceA.fill('[data-testid="team-name"]', TEAM_NAME);
  await deviceA.click('[data-testid="join-team"]');
  await deviceA.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  ok(true, 'device A is driving the newly created team');

  // ---- host: open the Teams tab and hand the team off --------------------
  ok(await host.locator('[data-testid="host-tab-teams"]').count() > 0, 'the host screen has a Teams tab');
  await host.click('[data-testid="host-tab-teams"]');
  await host.waitForSelector(`[data-testid="handoff-${TEAM_NAME}"]`, { timeout: 30000 });
  await host.click(`[data-testid="handoff-${TEAM_NAME}"]`);
  await host.waitForSelector('[data-testid="handoff-link"]', { timeout: 30000 });
  const handoffLink = (await host.textContent('[data-testid="handoff-link"]')).trim();
  ok(handoffLink.includes(`/claim/${code}/`), `the Teams tab produced a /claim/${code}/<token> link (${handoffLink})`);
  // The modal's own QR <img> — just confirm it rendered something, not its pixels.
  ok(await host.locator('img[alt^="QR code to claim"]').count() === 1, 'the modal rendered a QR code image');
  await host.click('button:has-text("Done")');

  // ⚠ SAME NON-DESTRUCTIVE READ AS device-switch.cjs's observer, aimed at the
  // reissued code ClaimScreen shows on success — see that file's own note on
  // why this is a page-global capture rather than waitForSelector + click.
  await deviceBCtx.addInitScript(() => {
    window.__capturedRecoveryCode = null;
    new MutationObserver(() => {
      if (window.__capturedRecoveryCode) return;
      const el = document.querySelector('[data-testid="recovery-code"]');
      if (el) window.__capturedRecoveryCode = el.textContent.trim();
    }).observe(document, { childList: true, subtree: true });
  });

  // ---- device B: open the hand-off link, land straight in the game -------
  const deviceB = await deviceBCtx.newPage();
  // The link the host's browser produced is absolute (window.location.origin);
  // strip that origin so Playwright resolves it against THIS context's baseURL.
  // ⚠ ?api= APPENDED HERE, NOT PART OF THE REAL LINK — index.ts's
  // configuredApi() remembers ?api= in sessionStorage per tab, which is how
  // device A/the host carried their own override across navigation; a BRAND
  // NEW context (a real second device opening this link) has no sessionStorage
  // yet and would otherwise fall back to VITE_SESSION_API (unset here). A real
  // deployment's link has no api param and needs none — this is purely how
  // THIS driver points a fresh context at the same ephemeral stub.
  const handoffPath = new URL(handoffLink).pathname;
  await deviceB.goto(`${handoffPath}?api=${encodeURIComponent(API)}`);

  await deviceB.waitForFunction(() => window.__capturedRecoveryCode !== null, null, { timeout: 30000 });
  const reissuedCode = await deviceB.evaluate(() => window.__capturedRecoveryCode);
  ok(/^\d{4}$/.test(reissuedCode), `device B was shown a freshly reissued 4-digit recovery code (${reissuedCode})`);

  await deviceB.waitForSelector('[data-testid="session-strip"]', { timeout: 30000 });
  ok(true, 'device B is driving the SAME team after opening the hand-off link — no team name or code typed');

  // ---- device A's own poller discovers it has been moved -----------------
  await deviceA.waitForSelector('[data-testid="team-moved"]', { timeout: 30000 });
  ok(true, 'device A\'s own poller discovered the rotation and showed "team was moved"');
  ok(await deviceA.locator('[data-testid="session-strip"]').count() === 0,
    'device A has dropped out of the game screen');

  // ---- device C: the SAME link, opened again, must fail -------------------
  const deviceC = await deviceCCtx.newPage();
  await deviceC.goto(`${handoffPath}?api=${encodeURIComponent(API)}`);
  await deviceC.waitForSelector('[data-testid="claim-failed"]', { timeout: 30000 });
  ok(true, 'a second open of the same hand-off link is refused, not a second successful claim');
  ok(await deviceC.locator('[data-testid="session-strip"]').count() === 0,
    'device C never gets into the game from the already-used link');

  // ---- device B still drives the team, unaffected by device C's attempt --
  const b = await (await fetch(`${API}/read`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })).json();
  const team = b.room.teams.find(t => t.name === TEAM_NAME);
  ok(!!team && team.joined, 'the team is still joined and in the room, under device B');

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  ok(errs.length === 0, 'no page errors');

  await browser.close();
  killStubTree(stub.pid);
  logSync(`\nhost-handoff: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { logSync('FAIL'); process.exit(1); }
  logSync('HOST HANDOFF PASS');
})().catch(e => {
  killStubTree(stubPid);
  logSync('THREW: ' + (e && e.stack ? e.stack : String(e)));
  process.exit(1);
});
process.on('uncaughtException', e => { logSync('UNCAUGHT: ' + (e && e.stack ? e.stack : String(e))); killStubTree(stubPid); process.exit(1); });
process.on('unhandledRejection', e => { logSync('UNHANDLED REJECTION: ' + (e && e.stack ? e.stack : String(e))); killStubTree(stubPid); process.exit(1); });

process.on('exit', () => killStubTree(stubPid));
