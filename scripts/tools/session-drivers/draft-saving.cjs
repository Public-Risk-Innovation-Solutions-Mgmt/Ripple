// ============================================================================
// DEVICE SWITCHING, PHASE 3: a team's current-year decisions auto-save every
// few seconds, survive a reload, and disappear the instant the year locks —
// Mike's device-switching guide's Step 5, and the one piece of this phase a
// contract-harness run cannot prove: that a REAL edit in the REAL Decisions UI
// actually reaches saveDraft, and that a REAL reload actually restores it.
//
// ⚠ ONE DEVICE, NOT TWO. Unlike device-switch.cjs/host-handoff.cjs, nothing
// here changes which device drives the team — this is the SAME browser
// context reloading itself, which is exactly what "crash or reload mid-year"
// means for this feature.
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

  // ---- the room, WC-only so there is exactly one reinsurance-option panel ---
  const host = await hostCtx.newPage();
  await host.goto(`/host?api=${encodeURIComponent(API)}`);
  await host.waitForSelector('[data-testid="create-room"]', { timeout: 30000 });
  await host.fill('[data-testid="event-name"]', 'Draft Saving Driver');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '1');
  await host.uncheck('[data-testid="line-GL"]');
  await host.uncheck('[data-testid="line-Property"]');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\n  room ${code} — created over HTTP from the host context\n`);

  // ---- the team, landing straight on the Decisions tab (the default) -------
  const device = await deviceCtx.newPage();
  await device.goto(`/join/${code}?api=${encodeURIComponent(API)}`);
  await device.waitForSelector('[data-testid="team-picker"]', { timeout: 30000 });
  await device.fill('[data-testid="team-name"]', TEAM_NAME);
  await device.click('[data-testid="join-team"]');
  await device.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  ok(true, 'the team is driving, on the Decisions tab by default');

  // A player's strip no longer SHOWS "Saving…"/"Saved"; it carries the state as data-draft.
  ok(await device.locator('[data-testid="session-strip"][data-draft]').count() === 0,
    'no saving/saved draft state before any edit');

  // ---- edit a decision: WC's reinsurance-option panel, a one-click control --
  // ⚠ "DECISIONS" OPENS ON THE POOL SUB-VIEW (investment allocation only); the
  // reinsurance panel is under the per-line tab, same as a real player would
  // click to get there.
  await device.getByRole('button', { name: "Workers' Compensation" }).click();
  const options = device.locator('[data-testid^="reins-option-WC-"]');
  await options.first().waitFor({ timeout: 30000 });
  const n = await options.count();
  ok(n >= 2, `WC offers at least two reinsurance options to choose between (found ${n})`);
  // Pick whichever of the first two is NOT already selected, so this edit is
  // guaranteed to be a real change rather than a no-op re-click of the default.
  const already = await options.first().getAttribute('class');
  const target = (already ?? '').includes('border-blue-500') ? options.nth(1) : options.first();
  const targetTestId = await target.getAttribute('data-testid');
  await target.click();
  ok((await target.getAttribute('class') ?? '').includes('border-blue-500'),
    `clicking ${targetTestId} selected it`);

  // ---- the debounced auto-save: "Saving…" then "Saved", inside ~3-4s --------
  await device.waitForSelector('[data-testid="session-strip"][data-draft]', { timeout: 10000 });
  const statusText = await device.getAttribute('[data-testid="session-strip"]', 'data-draft');
  ok(/^(saving|saved)$/.test(statusText ?? ''), `the draft state appeared ("${statusText}")`);
  await device.waitForFunction(
    () => document.querySelector('[data-testid="session-strip"]')?.dataset.draft === 'saved',
    null, { timeout: 10000 },
  );
  ok(true, 'the draft state settled on saved');

  // ---- confirm the server actually holds it, independent of the UI ---------
  const readBack = await (await fetch(`${API}/read`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, token: await device.evaluate(c => {
      const raw = sessionStorage.getItem('ripple.session.v1.active.' + c);
      return raw ? JSON.parse(raw).teamToken : null;
    }, code) }),
  })).json();
  const draftDecisions = readBack?.you?.draft?.decisions;
  const wcReins = draftDecisions?.byLine?.WC?.reinsuranceOption;
  ok(typeof readBack?.you?.draft?.savedAt === 'number', "the server's read carries a draft with a savedAt");
  ok(!!wcReins, `the draft's WC decisions carry a reinsuranceOption ("${wcReins}")`);

  // ---- reload: the SAME device, as if it crashed and came back -------------
  await device.reload();
  await device.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  await device.getByRole('button', { name: "Workers' Compensation" }).click();
  const restored = device.locator(`[data-testid="${targetTestId}"]`);
  await restored.waitFor({ timeout: 30000 });
  ok((await restored.getAttribute('class') ?? '').includes('border-blue-500'),
    'after a reload, the SAVED option is still selected — restored from the draft, not the engine default');

  // ---- lock the year: the draft must disappear with it ---------------------
  await lockAndConfirm(device);
  await device.waitForSelector('[data-testid="session-strip"][data-lock="locked"]', { timeout: 30000 });
  ok(await device.locator('[data-testid="session-strip"][data-draft]').count() === 0,
    'the draft state is gone once the year is locked');
  const afterLock = await (await fetch(`${API}/read`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, token: await device.evaluate(c => {
      const raw = sessionStorage.getItem('ripple.session.v1.active.' + c);
      return raw ? JSON.parse(raw).teamToken : null;
    }, code) }),
  })).json();
  ok(afterLock?.you?.draft === undefined, "the server's own read confirms the draft is gone, not just the UI");

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  ok(errs.length === 0, 'no page errors');

  await browser.close();
  killStubTree(stub.pid);
  logSync(`\ndraft-saving: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { logSync('FAIL'); process.exit(1); }
  logSync('DRAFT SAVING PASS');
})().catch(e => {
  killStubTree(stubPid);
  logSync('THREW: ' + (e && e.stack ? e.stack : String(e)));
  process.exit(1);
});
process.on('uncaughtException', e => { logSync('UNCAUGHT: ' + (e && e.stack ? e.stack : String(e))); killStubTree(stubPid); process.exit(1); });
process.on('unhandledRejection', e => { logSync('UNHANDLED REJECTION: ' + (e && e.stack ? e.stack : String(e))); killStubTree(stubPid); process.exit(1); });

process.on('exit', () => killStubTree(stubPid));
