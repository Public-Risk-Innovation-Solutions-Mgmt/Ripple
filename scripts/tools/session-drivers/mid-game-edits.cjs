// ============================================================================
// MID-GAME EDITS, HOSTED (wip/mid-game-edits) — a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   ADMIN_TOKEN=<token> node scripts/tools/session-drivers/mid-game-edits.cjs
//
// Two teams play year 1. Team 1 locks year 2. The host opens "Edit game" on the
// Game Setup tab, moves WC's adverse development to High from the CURRENT year
// on and adds a shock to a FUTURE year, and is warned that Team 1 has already
// locked — then applies anyway. The history records the changes; the teams'
// screens show nothing of it. After the advance:
//
//   - every team's posted year 1 is byte-identical to what it posted before
//     the edit (played years never change);
//   - every team's posted year 2 is EXACTLY what a rebuild from the edited room
//     gives (mid-game-replay.ts, out of the browser) — the results follow — and
//     NOT what a rebuild with the edit taken out gives (the control);
//   - a team that rejoins (its tab reloaded: the game rebuilt from the room)
//     re-posts every year byte-identical.
//
// Screenshots (--shots): the panel, the warning, the history, into
// docs/screenshots/mid-game-edits/.
// ============================================================================
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { BASE, REPO, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');

const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = path.join(REPO, 'docs', 'screenshots', 'mid-game-edits');
let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

async function join(ctx, code, name) {
  const p = await ctx.newPage();
  await p.goto(`/join/${code}`);
  await p.waitForSelector('[data-testid="team-picker"]');
  await p.fill('[data-testid="team-name"]', name);
  await p.click('[data-testid="join-team"]');
  await p.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
  return p;
}
const roomRecord = (page, code) => page.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);
const posted = (rec, name, y) => JSON.stringify(rec.teams.find(t => t.name === name)?.resultsByYear?.[String(y)] ?? null);
async function waitPosted(page, y) {
  await page.waitForFunction(yy => document.querySelector('[data-testid="session-strip"]')?.dataset.postedYear === String(yy),
    y, { timeout: 240000 });
}
/** The largest relative difference between two summaries' numbers; Infinity if their shapes differ. */
function maxRel(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? 0 : Infinity;
  const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
  let m = 0;
  for (const k of ks) m = Math.max(m, maxRel(a[k], b[k]));
  return m;
}
/**
 * Wait until the ROOM holds every named team's result for year y. ⚠ NOT THE
 * TAB'S "result posted": the tab says so when it has computed the year, and
 * the submit lands after — reading the room on the tab's word raced (seen: 1
 * run in 5 read Cedar Valley's year 1 as missing).
 */
async function waitInRoom(page, code, names, y) {
  await page.waitForFunction(([c, ns, yy]) => {
    const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
    return !!r && ns.every(n => r.teams.find(t => t.name === n)?.resultsByYear?.[String(yy)] !== undefined);
  }, [code, names, y], { timeout: 60000 });
}
function replay(rec, name, through, mode) {
  const file = process.env.MID_GAME_ROOM_FILE || path.join(require('node:os').tmpdir(), `mid-game-room-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(rec));
  const out = execFileSync('npx', ['tsx', 'scripts/tools/session-drivers/mid-game-replay.ts', file, name, String(through), ...(mode ? [mode] : [])],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 });
  return JSON.parse(out.trim().split('\n').pop());
}

(async () => {
  await requireServer();
  if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const host = await ctx.newPage();
  const errs = [];
  host.on('pageerror', e => errs.push(e.message));

  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="event-name"]', 'Mid-game edits');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '4');
  await host.fill('[data-testid="expected-teams"]', '2');
  await host.uncheck('[data-testid="line-Property"]');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\nroom ${code}\n`);

  const A = 'Harbour Mutual', B = 'Cedar Valley';
  const a = await join(ctx, code, A);
  const b = await join(ctx, code, B);
  for (const p of [a, b]) p.on('pageerror', e => errs.push(e.message));

  // ---- year 1, played by both ----
  for (const p of [a, b]) { await lockAndConfirm(p); await p.waitForSelector('[data-testid="session-strip"][data-lock="locked"]', { timeout: 30000 }); }
  await host.click('[data-testid="host-tab-setup"]');
  await host.click('[data-testid="advance"]');
  await host.waitForFunction(() => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === '2', null, { timeout: 30000 });
  for (const p of [a, b]) await waitPosted(p, 1);
  await waitInRoom(host, code, [A, B], 1);
  const before = await roomRecord(host, code);
  const cal = y => before.startingYear + y - 1;
  ok(posted(before, A, 1) !== 'null' && posted(before, B, 1) !== 'null', 'both teams posted year 1');

  // ---- Team 1 locks year 2 before the host's change ----
  await lockAndConfirm(a);
  await a.waitForSelector('[data-testid="session-strip"][data-lock="locked"]', { timeout: 30000 });

  // ---- the host's "Edit game" panel ----
  await host.click('[data-testid="host-tab-setup"]');
  await host.waitForSelector('[data-testid="edit-game"]', { timeout: 30000 });
  const rows = await host.$$eval('[data-testid^="edit-year-"]', rs => rs.map(r => r.getAttribute('data-testid')));
  ok(JSON.stringify(rows) === JSON.stringify([2, 3, 4].map(y => `edit-year-${cal(y)}`)),
    'the panel lists the current year and every later one — and no played year', rows.join(', '));
  ok(await host.locator('[data-testid="edit-history-empty"]').count() === 1, 'no changes yet');

  const cur = cal(2), fut = cal(3), last = cal(4);
  // ---- first apply: a shock added to a FUTURE year. The current year is
  // untouched, so there is no warning even though Team 1 has locked.
  const shockId = await host.locator(`[data-testid="edit-add-select-${fut}"] option`).nth(4).getAttribute('value');
  await host.selectOption(`[data-testid="edit-add-select-${fut}"]`, shockId);
  await host.click(`[data-testid="edit-add-${fut}"]`);
  ok(await host.locator(`[data-testid="edit-shock-${fut}-${shockId}"]`).count() === 1, `${shockId} added to ${fut} (a future year)`);
  await host.click('[data-testid="edit-apply"]');
  await host.waitForSelector('[data-testid="edit-saved"]', { timeout: 30000 });
  ok(await host.locator('[data-testid="edit-locked-warning"]').count() === 0, 'a change to a future year alone: no warning, though a team has locked the current one');
  await host.waitForFunction(() => document.querySelectorAll('[data-testid="edit-history-row"]').length === 1, null, { timeout: 30000 });

  // ---- second apply: WC's development from the CURRENT year on. ⚠ LAST, AND
  // ALONE: it changes nothing but levels, so an open team tab can only pick it
  // up through developmentLevelsByYear in useSessionGame's build key (the
  // control at the foot). Made together with the shock, the shock's change to
  // room.shocks would rebuild the tab anyway and hide a missing key.
  // Give the teams' tabs a poll to settle on the first edit.
  await host.waitForTimeout(3000);
  await host.selectOption(`[data-testid="edit-dev-${cur}-WC"] select`, 'High');
  const onward = await Promise.all([cur, fut, last].map(y => host.locator(`[data-testid="edit-dev-${y}-WC"] select`).inputValue()));
  ok(onward.every(v => v === 'High'), `WC set to High in ${cur} applies to ${cur} and every later year`, onward.join('/'));
  if (SHOTS) await host.locator('[data-testid="edit-game"]').screenshot({ path: path.join(SHOT_DIR, 'host-edit-game-panel.png') });

  await host.click('[data-testid="edit-apply"]');
  await host.waitForSelector('[data-testid="edit-locked-warning"]', { timeout: 10000 });
  const locked = (await host.textContent('[data-testid="edit-locked-teams"]')).trim();
  ok(/Harbour Mutual/.test(locked) && !/Cedar Valley/.test(locked), 'the host is warned which team has already locked the current year', locked);
  if (SHOTS) await host.locator('[data-testid="edit-game"]').screenshot({ path: path.join(SHOT_DIR, 'host-locked-warning.png') });
  await host.click('[data-testid="edit-apply-anyway"]');
  await host.waitForFunction(() => document.querySelectorAll('[data-testid="edit-history-row"]').length >= 4, null, { timeout: 30000 });
  const hist = await host.$$eval('[data-testid="edit-history-row"]', rs => rs.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  ok(hist.length === 4 && hist.every(h => /Host/.test(h)) && /Added/.test(hist[3]) && hist[3].includes(String(fut))
    && [cur, fut, last].every(y => hist.some(h => h.includes(`WC adverse development in ${y}: `) && h.endsWith('→ High'))),
    'the change history, newest first: who, what, which year, when — WC in three years, then the shock before them', hist.join(' | '));
  if (SHOTS) await host.locator('[data-testid="edit-game"]').screenshot({ path: path.join(SHOT_DIR, 'host-change-history.png') });

  // ---- teams aren't told ----
  for (const [p, n] of [[a, A], [b, B]]) {
    const text = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
    ok(await p.locator('[data-testid="edit-game"]').count() === 0 && !/adverse development in|Edit game/.test(text), `${n} is not told`);
  }

  // ---- year 2: Team 2 locks, the host advances, both post ----
  await lockAndConfirm(b);
  await b.waitForSelector('[data-testid="session-strip"][data-lock="locked"]', { timeout: 30000 });
  await host.click('[data-testid="advance"]');
  await host.waitForFunction(() => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === '3', null, { timeout: 30000 });
  for (const p of [a, b]) await waitPosted(p, 2);
  await waitInRoom(host, code, [A, B], 2);
  const after = await roomRecord(host, code);
  for (const n of [A, B]) ok(posted(after, n, 1) === posted(before, n, 1), `${n}: year 1 is byte-identical after the edit`);

  // ⚠ THE OUT-OF-BROWSER REBUILD AGREES TO 1e-9, NOT TO THE BYTE. Node's V8
  // and Chromium's round Math.exp/log/pow differently in the last place, so a
  // rebuild here differs from the page's in the 15th-16th digit on every year,
  // edited or not (seen on the first run: year 1 off by 3e-16). Byte identity is
  // held IN the browser instead — the rejoin below. The control must differ by
  // far more than the tolerance, so the tolerance cannot hide the edit.
  for (const n of [A, B]) {
    const edited = replay(after, n, 2), unedited = replay(after, n, 2, 'unedited');
    const mine = JSON.parse(posted(after, n, 2));
    const dEdit = maxRel(edited['2'], mine), dCtl = maxRel(unedited['2'], mine);
    ok(dEdit < 1e-9, `${n}: the posted ${cal(2)} result is a rebuild's from the edited room — the results follow`, `max relative difference ${dEdit.toExponential(1)}`);
    ok(dCtl > 1e-4, `${n}: and not a rebuild's with the edit taken out (control)`, `max relative difference ${dCtl.toExponential(1)}`);
    ok(maxRel(edited['1'], JSON.parse(posted(after, n, 1))) < 1e-9, `${n}: the rebuild's ${cal(1)} is the posted ${cal(1)}`);
  }

  // ---- a rejoining team matches: Team 2's posted results are wiped from the
  // room, then its tab is reloaded — its game rebuilt from the edited room — and
  // it must post every year back byte-identical. (Wiping them first is what
  // makes this a check: an unchanged room would otherwise pass with no re-post.)
  const beforeRejoin = await roomRecord(host, code);
  await b.evaluate(([c, n]) => {
    const k = 'ripple.session.v1.room.' + c, r = JSON.parse(localStorage.getItem(k));
    r.teams.find(t => t.name === n).resultsByYear = {};
    localStorage.setItem(k, JSON.stringify(r));
  }, [code, B]);
  ok(posted(await roomRecord(host, code), B, 2) === 'null', `${B}'s posted results wiped from the room before it rejoins`);
  await b.reload();
  await b.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
  await waitPosted(b, 2);
  await host.waitForFunction(([c, n]) => {
    const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c));
    return Object.keys(r.teams.find(t => t.name === n).resultsByYear).length >= 3;
  }, [code, B], { timeout: 60000 });
  const rejoined = await roomRecord(host, code);
  ok([0, 1, 2].every(y => posted(rejoined, B, y) === posted(beforeRejoin, B, y) && posted(rejoined, B, y) !== 'null'),
    `${B} rejoins: its rebuilt game re-posts its opening, ${cal(1)} and ${cal(2)} byte-identical`);

  ok(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));
  await browser.close();

  // --------------------------------------------------------------------
  // THE CONTROL — run by hand, recorded here: with useSessionGame's build key
  // left without developmentLevelsByYear and shocksOn, the open team tabs keep
  // the game they built before the second (levels-only) apply and play the
  // current year on the old levels: "the results follow" fails for both teams.
  // (A first version made both changes in one apply; the shock rebuilt the tabs
  // through room.shocks and that control PASSED — which is why they are split.)
  // --------------------------------------------------------------------
  console.log(`\nmid-game-edits: ${passed}/${passed + failed} checks passed`);
  if (failed) { console.log('FAIL'); process.exit(1); }
  console.log('MID-GAME EDITS PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
