// ============================================================================
// THE NEW MARKET — a hosted room on it, end to end in a browser
// (pr/market-new-version; since pr/market-new-only the only version for new
// rooms). Over the stub server, so a second device can rejoin.
//
//   node scripts/tools/session-drivers/market-new-version.cjs
//   SCREENSHOTS=1 ... also writes docs/screenshots/market-new-version/*.png
//
// Room setup offers the market's level (Medium by default) and NO version
// choice; its note says a quarter of each team's admin is fixed. Game Setup and
// the change history name the level and no version. Four teams priced from 30%
// funding to the dearest, two years: members move (the dearest team's book
// shrinks, the cheapest's grows) on the host's Teams tab; the teams' screens show
// no market results; a rejoin on a second device replays the years exactly (its
// Annual Statement is the first device's). An OLDER Current room — made in the
// browser's own localStorage room store, its stored version taken off — keeps the
// short Current note on Game Setup and in the change history. A Test player setup
// offers no market at all.
// ============================================================================
const { BASE, REPO, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const SHOTS = process.env.SCREENSHOTS ? path.join(REPO, 'docs', 'screenshots', 'market-new-version') : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const fails = [];
let checks = 0;
function ok(c, w, detail = '') { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w + (detail ? ` — ${detail}` : '')); } else console.log('  ok    ' + w); }

let stubPid = 0;
function killStubTree(pid) { if (!pid) return; try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }
const freePort = () => new Promise(r => { const p = net.createServer(); p.listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => r(port)); }); });
function startStub(port) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'scripts/tools/session-stub-server.ts', '--port', String(port)], { cwd: REPO, detached: true });
    const bail = setTimeout(() => reject(new Error('stub did not start')), 60000);
    child.stdout.on('data', d => { if (String(d).includes('listening')) { clearTimeout(bail); resolve(child); } });
    child.stderr.on('data', d => process.stdout.write('  [stub:err] ' + d));
  });
}

// Four teams, cheapest to dearest: [name, funding steps above 30% (null = Expected), New Members %].
const TEAMS = [
  ['Alder', 0, 10],
  ['Birch', null, 5],
  ['Cedar', 8, 3],
  ['Elm', 12, 0],
];
const WC = "Workers' Compensation";

/**
 * THE ROOM'S STORED MARKET RESULTS FOR A YEAR (RoomView.marketByYear, host only),
 * read as the host's own screen reads the room. ⚠ THE HOST'S MARKET COLUMNS WERE
 * TAKEN OFF THE SCREEN (pr/pool-share-average); the results are still stored and
 * played, so this driver checks them where they live.
 */
async function storedMarket(host, api, code, year) {
  const token = await host.evaluate(c => {
    for (const k of ['active', 'held']) {
      const v = localStorage.getItem(`ripple.session.v1.${k}.${c}`);
      if (v) { const j = JSON.parse(v); if (j.hostToken) return j.hostToken; }
    }
    return null;
  }, code);
  const res = await fetch(`${api}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ code, token }) });
  const view = await res.json();
  return view.room?.marketByYear?.[String(year)];
}
/** A line's exposure moved in the year — in less out, of the book at its start — as the Teams column worked it. */
function movedOf(x) {
  const before = x.bookAfter + x.outExposure - x.inGood - x.inOutside - x.inDropped;
  return before > 0 ? (x.inGood + x.inOutside + x.inDropped - x.outExposure) / before : 0;
}

async function shot(page, name, locator) {
  if (!SHOTS) return;
  const file = path.join(SHOTS, name);
  if (locator) await locator.screenshot({ path: file }); else await page.screenshot({ path: file, fullPage: true });
  console.log('  shot  ' + path.relative(REPO, file));
}
const sliderBox = (page, label) => page.locator('div.flex.flex-col.gap-2', { has: page.locator('span', { hasText: label }) }).first();
async function setSlider(page, label, steps) {
  const input = sliderBox(page, label).locator('input[type=range]');
  await input.focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
}
async function toDecisionsWC(page) {
  await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
  await page.getByRole('button', { name: WC, exact: true }).first().click();
  await page.waitForTimeout(300);
}
const posted = (page, y) => page.waitForFunction(n => document.querySelector('[data-testid="session-strip"]')?.dataset.postedYear === String(n), y, { timeout: 240000 });
const num = t => Number(String(t).replace(/[−–]/g, '-').replace(/[^0-9.\-]/g, ''));

async function setupRoom(host, API, name, version) {
  await host.goto(`/host?api=${encodeURIComponent(API)}`);
  await host.waitForSelector('[data-testid="create-room"]', { timeout: 30000 });
  await host.fill('[data-testid="event-name"]', name);
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', String(TEAMS.length));
  await host.uncheck('[data-testid="line-GL"]');
  await host.uncheck('[data-testid="line-Property"]');
}

(async () => {
  await requireServer();
  const port = await freePort();
  const API = `http://localhost:${port}`;
  const stub = await startStub(port);
  stubPid = stub.pid;
  const browser = await launchBrowser();
  const opts = { baseURL: BASE, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: SHOTS ? 2 : 1 };
  const ctx = await browser.newContext(opts);
  const errs = [];
  ctx.on('page', p => p.on('pageerror', e => errs.push(e.message)));
  await ctx.addInitScript(() => {
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="recovery-code"]');
      if (el) window.__lastCode = el.textContent.trim();
    }).observe(document, { childList: true, subtree: true });
  });

  // ---- the host's setup: the level, and no version ---------------------------
  const host = await ctx.newPage();
  await setupRoom(host, API, 'Market New Version Driver', null);
  ok(await host.locator('[data-testid="market-version"]').count() === 0 && !/Market version/i.test(await host.textContent('body')),
    'room setup offers no Market version choice: every room created plays the New market');
  const levels = await host.$$eval('[data-testid="market-level"] option', os => os.map(o => o.textContent.trim()));
  ok(await host.inputValue('[data-testid="market-level"]') === 'medium' && levels.join('/') === 'Off/Low/Medium/High',
    'the market\'s level stays: Off / Low / Medium / High, Medium by default', levels.join('/'));
  const note = await host.textContent('[data-testid="market-admin-note"]');
  ok(/25% of each team.s admin is fixed at its year-1 dollars, growing\s+3% a year/.test(note), 'the setup says a quarter of each team\'s admin is fixed, growing 3% a year', note);
  await host.selectOption('[data-testid="market-level"]', 'off');
  ok(await host.locator('[data-testid="market-admin-note"]').count() === 0, 'with the market Off, no admin note');
  await host.selectOption('[data-testid="market-level"]', 'medium');
  await shot(host, '01-room-setup-market.png',
    host.locator('div', { has: host.locator('[data-testid="market-level"]') }).filter({ has: host.locator('[data-testid="market-admin-note"]') }).last());
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\n  room ${code}\n`);

  // ---- Game Setup and the change history name the level, and no version --------
  const levelNote = await host.textContent('[data-testid="market-level-note"]');
  ok(/Market competition: Medium\./.test(levelNote) && !/version|Current/i.test(levelNote) && await host.locator('[data-testid="market-current-note"]').count() === 0,
    'Game Setup names the level ("Market competition: Medium.") with no version wording', levelNote);
  ok(/25% of each team.s admin is fixed/.test(levelNote), 'and says what is fixed of each team\'s admin');
  const hist = (await host.textContent('[data-testid="edit-history-note"]')).trim();
  ok(hist === 'Market competition: Medium (set when the room was created).', 'the change history opens with the level alone', hist);
  await shot(host, '02-game-setup.png');

  // ---- four teams join and set their year -------------------------------------
  const pages = {};
  const codes = {};
  for (const [name] of TEAMS) {
    const p = await ctx.newPage();
    await p.goto(`/join/${code}?api=${encodeURIComponent(API)}`);
    await p.waitForSelector('[data-testid="team-picker"]', { timeout: 30000 });
    await p.fill('[data-testid="team-name"]', name);
    await p.click('[data-testid="join-team"]');
    await p.waitForSelector('[data-testid="session-strip"]', { timeout: 240000 });
    codes[name] = await p.evaluate(() => window.__lastCode);
    pages[name] = p;
  }
  ok(Object.values(codes).every(c => /^\d{4}$/.test(c || '')), 'four teams joined');

  // ---- two years ---------------------------------------------------------------
  // ⚠ EACH YEAR'S DECISIONS ARE SET THAT YEAR (pr/decision-reset): every round
  // opens on the reset, so each team sets its funding and New Members again
  // before each lock — they used to be set once and carried into year 2.
  const moved = {};
  for (const year of [1, 2]) {
    for (const [name, funding, nm] of TEAMS) {
      const p = pages[name];
      await toDecisionsWC(p);
      if (funding !== null) await setSlider(p, /^Funding Confidence Level$/, funding);
      if (nm) await setSlider(p, /^New Members$/, nm);
      if (name === 'Alder' && year === 1) {
        ok(!/New version|Market version|admin is fixed/.test(await p.textContent('body')), 'a team\'s Decisions page says nothing of the version');
      }
    }
    for (const [name] of TEAMS) {
      await lockAndConfirm(pages[name]);
      await pages[name].waitForSelector('[data-testid="session-strip"][data-lock="locked"]', { timeout: 60000 });
    }
    await host.click('[data-testid="host-tab-setup"]');
    await host.waitForSelector('[data-testid="locked-Elm"]', { timeout: 30000 });
    await host.click('[data-testid="advance"]');
    await host.waitForFunction(n => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === String(n), year + 1, { timeout: 30000 });
    for (const name of Object.keys(pages)) await posted(pages[name], year);
    ok(true, `every team played year ${year} on its New-version market result and posted it`);
  }

  // The host's Teams tab: no market columns (taken off the screen); the stored results carry the moves.
  await host.click('[data-testid="host-tab-teams"]');
  await host.waitForSelector('[data-testid="teams-table"] tr', { timeout: 30000 });
  await host.getByRole('button', { name: WC, exact: true }).first().click();
  await host.waitForTimeout(400);
  ok(await host.locator('[data-testid="teams-moved-head"], [data-testid="teams-bookrisk-head"], [data-testid^="moved-"], [data-testid^="bookrisk-"]').count() === 0,
    'the host\'s Teams tab shows no Exposure moved or Book risk column');
  const year2 = await storedMarket(host, API, code, 2);
  const risk = {};
  for (const [name] of TEAMS) {
    const x = year2?.result?.[name]?.WC;
    moved[name] = x ? movedOf(x) : undefined;
    risk[name] = x?.bookRisk;
  }
  console.log('  stored: moved', JSON.stringify(moved), 'book risk', JSON.stringify(risk));
  ok(moved.Elm < 0 && moved.Alder > 0,
    'still stored: members moved — the dearest team lost exposure, the cheapest gained', `${moved.Elm} / ${moved.Alder}`);
  ok(Object.values(risk).every(r => typeof r === 'number') && risk.Elm > 1,
    'still stored: every team\'s book risk; the dearest team kept the worse risks (above 1.00)', JSON.stringify(risk));
  await shot(host, '03-new-version-teams-tab.png');

  // A team is shown no market results.
  ok(!/Your market results|Wanting to leave|Appetite filled/.test(await pages.Elm.textContent('body')), 'the dearest team is shown no market results');

  // ---- a rejoin on a second device replays the New-version years exactly --------
  const statementText = async page => {
    await page.getByRole('button', { name: /^Annual Statement$/ }).first().click();
    await page.waitForSelector('[data-testid="annual-statement"]', { timeout: 30000 });
    await page.getByRole('button', { name: 'Pool', exact: true }).first().click();
    await page.waitForTimeout(400);
    return (await page.locator('[data-testid="annual-statement"]').innerText()).replace(/\s+/g, ' ').trim();
  };
  const before = await statementText(pages.Elm);
  const ctx2 = await browser.newContext(opts);
  ctx2.on('page', p => p.on('pageerror', e => errs.push(e.message)));
  const dev2 = await ctx2.newPage();
  await dev2.goto(`/?api=${encodeURIComponent(API)}`);
  await dev2.waitForSelector('[data-testid="reclaim-team"]', { timeout: 30000 });
  await dev2.click('[data-testid="reclaim-team"]');
  await dev2.fill('[data-testid="reclaim-room-code"]', code);
  await dev2.fill('[data-testid="reclaim-team-name"]', 'Elm');
  await dev2.fill('[data-testid="reclaim-code"]', codes.Elm);
  await dev2.click('[data-testid="submit-reclaim"]');
  await dev2.waitForSelector('[data-testid="session-strip"]', { timeout: 240000 });
  await posted(dev2, 2);
  const after = await statementText(dev2);
  ok(before.length > 200 && after === before, 'Elm rejoins on a second device and its Annual Statement — two New-version years — is exactly the first\'s');

  // ---- an OLDER Current room keeps its note -----------------------------------------
  // No new room can be Current, so this one is made as an older room is: created in the browser's own localStorage
  // room store (no ?api=), its stored version and level table taken off, and the page reloaded.
  const host2 = await ctx.newPage();
  await host2.goto('/host');
  await host2.waitForSelector('[data-testid="create-room"]', { timeout: 30000 });
  await host2.fill('[data-testid="event-name"]', 'Older Current Room');
  await host2.fill('[data-testid="expected-teams"]', '2');
  await host2.click('[data-testid="create-room"]');
  await host2.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
  const oldCode = (await host2.textContent('[data-testid="room-code"]')).trim();
  const stored = await host2.evaluate(c => {
    const k = 'ripple.session.v1.room.' + c;
    const r = JSON.parse(localStorage.getItem(k));
    const was = { v: r.marketVersion, s: r.marketScale };
    delete r.marketVersion; delete r.marketScale;
    localStorage.setItem(k, JSON.stringify(r));
    return was;
  }, oldCode);
  ok(stored.v === 'new' && stored.s === 2, 'a room created in the browser\'s own room store is New too (stored New, scale 2)', JSON.stringify(stored));
  await host2.reload();
  await host2.waitForSelector('[data-testid="market-current-note"]', { timeout: 30000 });
  ok(/older Current market/.test(await host2.textContent('[data-testid="market-current-note"]'))
    && !/admin is fixed/.test(await host2.textContent('[data-testid="market-level-note"]'))
    && /the older Current market/.test(await host2.textContent('[data-testid="edit-history-note"]')),
    'an older Current room keeps a short note on Game Setup and in the change history, and no fixed-admin line');
  await shot(host2, '04-older-current-room.png', host2.locator('[data-testid="market-level-note"]'));

  // ---- Test player: no market, no version ------------------------------------------
  const solo = await ctx.newPage();
  await solo.goto('/solo');
  await solo.waitForSelector('[data-testid="open-test-player"]', { timeout: 30000 });
  await solo.click('[data-testid="open-test-player"]');
  await solo.waitForSelector('[data-testid="year-count"]', { timeout: 30000 });
  ok(await solo.locator('[data-testid="market-version"]').count() === 0 && await solo.locator('[data-testid="market-level"]').count() === 0,
    'Test player\'s setup offers no market and no market version');

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  ok(errs.length === 0, 'no page errors', errs[0] ?? '');
  await browser.close();
  killStubTree(stub.pid);
  console.log(`\nmarket-new-version: ${checks - fails.length}/${checks} checks passed`);
  console.log(fails.length ? 'FAIL' : 'MARKET NEW VERSION PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { killStubTree(stubPid); console.error('THREW: ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
process.on('exit', () => killStubTree(stubPid));
