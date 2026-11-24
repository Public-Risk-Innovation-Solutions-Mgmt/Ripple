// ============================================================================
// MARKET VERSION NEW — a hosted room on the New market, end to end in a browser
// (pr/market-new-version). Over the stub server, so a second device can rejoin.
//
//   node scripts/tools/session-drivers/market-new-version.cjs
//   SCREENSHOTS=1 ... also writes docs/screenshots/market-new-version/*.png
//
// Room setup offers "Market version", Current by default, Current / New; its note
// says what New changes. The host picks New (Medium); Game Setup names the level
// and the version, and the change history opens with them. Four teams priced from
// 30% funding to the dearest, two years: members move (the dearest team's book
// shrinks, the cheapest's grows) on the host's Teams tab; the teams' screens show
// no market results, as in every market room; a rejoin on a second device replays
// the New-version years exactly (its Annual Statement is the first device's). A
// second room left on Current says Current, and a Test player setup offers no
// market version at all.
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
  if (version) await host.selectOption('[data-testid="market-version"]', version);
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

  // ---- the host's setup: the option ------------------------------------------
  const host = await ctx.newPage();
  await setupRoom(host, API, 'Market New Version Driver', null);
  ok(await host.inputValue('[data-testid="market-version"]') === 'current', 'room setup offers Market version, Current by default');
  const versions = await host.$$eval('[data-testid="market-version"] option', os => os.map(o => o.textContent.trim()));
  ok(versions.join('/') === 'Current/New', 'Current / New', versions.join('/'));
  ok(/Current: the market as it plays today/.test(await host.textContent('[data-testid="market-version-note"]')), 'Current\'s note: the market as it plays today');
  await host.selectOption('[data-testid="market-version"]', 'new');
  const note = await host.textContent('[data-testid="market-version-note"]');
  ok(/New \(for review\)/.test(note) && /Half of each team.s admin is fixed at its year-1 dollars/.test(note) && /3% a year/.test(note),
    'New\'s note says what changes: stronger, more selective leaving, and half the admin fixed growing 3% a year', note);
  ok(await host.inputValue('[data-testid="market-level"]') === 'medium', 'with the market at Medium');
  await shot(host, '01-setup-market-version.png',
    host.locator('div', { has: host.locator('[data-testid="market-version"]') }).filter({ has: host.locator('[data-testid="market-level"]') }).last());
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\n  room ${code}\n`);

  // ---- Game Setup and the change history name the version ---------------------
  const levelNote = await host.textContent('[data-testid="market-level-note"]');
  ok(/Market competition: Medium/.test(levelNote) && (await host.textContent('[data-testid="market-version-shown"]')).trim() === 'New version',
    'Game Setup names the level and the version: "Market competition: Medium · New version"', levelNote);
  ok(/Half of each team.s admin is fixed/.test(levelNote), 'and says what the version does to admin');
  const hist = (await host.textContent('[data-testid="edit-history-note"]')).trim();
  ok(/Market competition: Medium · New version/.test(hist), 'the change history opens with the market and its version', hist);
  await shot(host, '02-game-setup-version.png');

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
  for (const [name, funding, nm] of TEAMS) {
    const p = pages[name];
    await toDecisionsWC(p);
    if (funding !== null) await setSlider(p, /^Funding Confidence Level$/, funding);
    if (nm) await setSlider(p, /^New Members$/, nm);
    if (name === 'Alder') {
      ok(!/New version|Market version|admin is fixed/.test(await p.textContent('body')), 'a team\'s Decisions page says nothing of the version');
    }
  }

  // ---- two years ---------------------------------------------------------------
  const moved = {};
  for (const year of [1, 2]) {
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

  // ---- a room left on Current says Current ---------------------------------------
  const host2 = await ctx.newPage();
  await setupRoom(host2, API, 'Market Current Driver', null);
  await host2.click('[data-testid="create-room"]');
  await host2.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
  ok((await host2.textContent('[data-testid="market-version-shown"]')).trim() === 'Current version'
    && /Current version/.test(await host2.textContent('[data-testid="edit-history-note"]'))
    && !/admin is fixed/.test(await host2.textContent('[data-testid="market-level-note"]')),
    'a room left on Current names the Current version on Game Setup and in the change history');

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
