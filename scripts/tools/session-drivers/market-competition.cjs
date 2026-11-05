// ============================================================================
// MARKET COMPETITION — a hosted room of five teams, end to end in a browser
// (pr/market-competition). Over the stub server, so a second device can rejoin.
//
//   node scripts/tools/session-drivers/market-competition.cjs
//   SCREENSHOTS=1 ... also writes docs/screenshots/market-competition/*.png
//
// The host's setting (Medium by default) on room setup; five teams priced from
// 30% to 90% funding, with different appetites and non-renewal; the Decisions
// page in market mode (the appetite label, no Accept switch — no team takes
// another's non-renewed members); REAL LOCKING — the host sees who has not locked, unlocks a team,
// the team re-locks on a new appetite; the advance; members moving (the dearest
// team's book shrinks, the cheapest's grows); the host's two Teams columns and
// the Charts book risk line; each team's own market results; the Market Survey,
// with no market columns, its shares moved; a rejoin on a second device that
// shows exactly what the first did; and a team that skips a year flagged to the
// host as counted at its last lock.
// ============================================================================
const { BASE, REPO, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const SHOTS = process.env.SCREENSHOTS ? path.join(REPO, 'docs', 'screenshots', 'market-competition') : null;
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

// Five teams, cheapest to dearest: [name, funding steps above 30% (null = Expected), New Members %, Non-Renewal %].
const TEAMS = [
  ['Alder', 0, 10, 0],
  ['Birch', 4, 5, 0],
  ['Cedar', null, 3, 0],
  ['Dogwood', 8, 0, 3],
  ['Elm', 12, 0, 5],
];
const WC = "Workers' Compensation";

async function shot(page, name, locator) {
  if (!SHOTS) return;
  const file = path.join(SHOTS, name);
  if (locator) await locator.screenshot({ path: file }); else await page.screenshot({ path: file, fullPage: true });
  console.log('  shot  ' + path.relative(REPO, file));
}
const sliderBox = (page, label) => page.locator('div.flex.flex-col.gap-2', { has: page.locator('span', { hasText: label }) }).first();
async function setSlider(page, label, steps, end = false) {
  const input = sliderBox(page, label).locator('input[type=range]');
  await input.focus();
  await page.keyboard.press(end ? 'End' : 'Home');
  for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
}
async function toDecisionsWC(page) {
  await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
  await page.getByRole('button', { name: WC, exact: true }).first().click();
  await page.waitForTimeout(300);
}
const posted = (page, y) => page.waitForFunction(n => new RegExp(`year ${n} result posted`).test(document.querySelector('[data-testid="posted-year"]')?.textContent || ''), y, { timeout: 240000 });
const num = t => Number(String(t).replace(/[−–]/g, '-').replace(/[^0-9.\-]/g, ''));

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
  // Each team's one-time recovery code, captured as it appears (see device-switch.cjs).
  await ctx.addInitScript(() => {
    window.__codes = window.__codes || {};
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="recovery-code"]');
      if (el) window.__lastCode = el.textContent.trim();
    }).observe(document, { childList: true, subtree: true });
  });

  // ---- the host's setup -----------------------------------------------------
  const host = await ctx.newPage();
  await host.goto(`/host?api=${encodeURIComponent(API)}`);
  await host.waitForSelector('[data-testid="create-room"]', { timeout: 30000 });
  ok(await host.inputValue('[data-testid="market-level"]') === 'medium', 'room setup offers Market competition, Medium by default');
  const levels = await host.$$eval('[data-testid="market-level"] option', os => os.map(o => o.textContent.trim()));
  ok(levels.join('/') === 'Off/Low/Medium/High', 'Off / Low / Medium / High', levels.join('/'));
  await host.fill('[data-testid="event-name"]', 'Market Competition Driver');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '5');
  await host.uncheck('[data-testid="line-GL"]');
  await host.uncheck('[data-testid="line-Property"]');
  await shot(host, '01-setup-market-setting.png');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  ok((await host.textContent('body')).includes('Market competition: Medium'), 'the host\'s Game Setup names the room\'s level');
  console.log(`\n  room ${code}\n`);

  // ---- five teams join and set their year -----------------------------------
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
  ok(Object.values(codes).every(c => /^\d{4}$/.test(c || '')), 'five teams joined');

  for (const [name, funding, nm, nr] of TEAMS) {
    const p = pages[name];
    await toDecisionsWC(p);
    if (name === 'Alder') {
      ok(await p.locator('[data-testid="market-mode-note"]').count() === 1, 'the Decisions page is in market mode');
      ok(await sliderBox(p, 'New Members: appetite').count() === 1 && await sliderBox(p, 'Non-Renewal: members you drop (they leave the market)').count() === 1,
        'New Members reads as the appetite, Non-Renewal as members dropped from the market');
      ok(await p.locator('[data-testid^="accept-non-renewed"]').count() === 0 && !/Accept non-renewed/.test(await p.textContent('body')),
        'there is no "Accept non-renewed members" control');
      ok(await p.locator('[data-testid="market-results-empty"]').count() === 1, 'no market results before the first advance');
    }
    if (funding !== null) await setSlider(p, /^Funding Confidence Level$/, funding);
    if (nm) await setSlider(p, 'New Members: appetite', nm);
    if (nr) await setSlider(p, 'Non-Renewal: members you drop (they leave the market)', nr);
  }

  // ---- locking, and the host's unlock ---------------------------------------
  for (const name of ['Alder', 'Birch', 'Cedar', 'Dogwood']) {
    await lockAndConfirm(pages[name]);
    await pages[name].waitForSelector('[data-testid="waiting"]', { timeout: 60000 });
  }
  await host.click('[data-testid="host-tab-setup"]');
  await host.waitForSelector('[data-testid="locked-Dogwood"]', { timeout: 30000 });
  ok((await host.textContent('[data-testid="outstanding"]')).includes('Elm'), 'the host sees who has not locked: Elm');
  ok(await host.locator('[data-testid="outstanding-note"]').count() === 1, 'and what advancing now would do to it');
  ok((await host.textContent('[data-testid="undo-lock-Cedar"]')).trim() === 'Unlock', 'each locked team has an Unlock control');
  await shot(host, '04-unlock-control.png');
  await host.click('[data-testid="undo-lock-Cedar"]');
  await host.waitForSelector('[data-testid="locked-Cedar"]', { state: 'detached', timeout: 30000 });
  await pages.Cedar.waitForSelector('[data-testid="waiting"]', { state: 'detached', timeout: 30000 });
  ok(true, 'the host unlocks Cedar and Cedar\'s screen reopens');
  await toDecisionsWC(pages.Cedar);
  await setSlider(pages.Cedar, 'New Members: appetite', 6);
  await lockAndConfirm(pages.Cedar);
  await pages.Cedar.waitForSelector('[data-testid="waiting"]', { timeout: 60000 });
  await host.waitForSelector('[data-testid="locked-Cedar"]', { timeout: 30000 });
  ok(true, 'Cedar re-locks on a 6% appetite');
  await lockAndConfirm(pages.Elm);
  await pages.Elm.waitForSelector('[data-testid="waiting"]', { timeout: 60000 });
  await host.waitForSelector('[data-testid="locked-Elm"]', { timeout: 30000 });

  // ---- the advance: the market step ----------------------------------------
  await host.click('[data-testid="advance"]');
  await host.waitForFunction(() => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === '2', null, { timeout: 30000 });
  for (const name of Object.keys(pages)) await posted(pages[name], 1);
  ok(true, 'every team played year 1 on its market result and posted it');

  // The host's Teams tab: two market columns.
  await host.click('[data-testid="host-tab-teams"]');
  await host.waitForSelector('[data-testid="teams-moved-head"]', { timeout: 30000 });
  await host.getByRole('button', { name: WC, exact: true }).first().click();
  await host.waitForFunction(() => document.querySelectorAll('[data-testid^="moved-"]').length >= 5, null, { timeout: 60000 });
  const moved = {}, risk = {};
  for (const [name] of TEAMS) {
    moved[name] = (await host.textContent(`[data-testid="moved-${name}"]`)).trim();
    risk[name] = (await host.textContent(`[data-testid="bookrisk-${name}"]`)).trim();
  }
  console.log('  moved', JSON.stringify(moved), 'book risk', JSON.stringify(risk));
  ok(moved.Elm.startsWith('−') && moved.Alder.startsWith('+') && num(moved.Alder) > 0, 'members moved: the dearest team lost exposure, the cheapest gained', `${moved.Elm} / ${moved.Alder}`);
  ok(Object.values(risk).every(r => /^\d\.\d{3}$/.test(r)) && num(risk.Elm) > 1, 'every team\'s book risk is shown; the dearest team kept the worse risks (above 1.00)', JSON.stringify(risk));
  await shot(host, '02-teams-columns.png');

  // The Charts tab: the book risk line.
  await host.click('[data-testid="host-tab-charts"]');
  await host.waitForSelector('[data-testid="chart-bookRisk"]', { timeout: 30000 });
  ok(true, 'the Charts tab draws a Book risk chart');

  // Each team's own market results.
  await toDecisionsWC(pages.Alder);
  await pages.Alder.waitForSelector('[data-testid="market-row-1"]', { timeout: 30000 });
  const filled = (await pages.Alder.textContent('[data-testid="market-filled-1"]')).trim();
  ok(/% of 10\.0%$/.test(filled) && num(filled.split(' of ')[0]) > 0, 'Alder sees its appetite filled', filled);
  ok((await pages.Alder.textContent('[data-testid="market-good-1"]')).includes('risk'), 'with its good leavers and their average risk');
  await shot(pages.Alder, '05-team-market-results.png', pages.Alder.locator('[data-testid="market-results"]'));
  await toDecisionsWC(pages.Elm);
  await pages.Elm.waitForSelector('[data-testid="market-row-1"]', { timeout: 30000 });
  const elmWilling = num(await pages.Elm.textContent('[data-testid="market-willing-1"]'));
  const elmLeft = (await pages.Elm.textContent('[data-testid="market-left-1"]')).trim();
  ok(elmWilling > 0 && num(elmLeft.split(' ')[0]) > 0, 'Elm sees members wanting to leave and members that left', `${elmWilling}% / ${elmLeft}`);
  ok(/No appetite/.test(await pages.Elm.textContent('[data-testid="market-filled-1"]')), 'Elm, with no appetite, took nobody in');
  ok(!/Dropped members/.test(await pages.Alder.textContent('[data-testid="market-results"]')), 'the results panel has no dropped-members intake: no team takes them');

  // The Market Survey: no market columns; shares moved.
  const survey = pages.Birch;
  await survey.getByRole('button', { name: 'Market Survey', exact: true }).first().click();
  await survey.waitForSelector('[data-testid="market-survey"] [data-testid="teams-table"] tr', { timeout: 30000 });
  await survey.locator('[data-testid="market-survey"]').getByRole('button', { name: WC, exact: true }).first().click();
  await survey.waitForTimeout(400);
  ok(await survey.locator('[data-testid="teams-moved-head"]').count() === 0 && await survey.locator('[data-testid="teams-bookrisk-head"]').count() === 0,
    'a team\'s Market Survey shows neither market column');
  ok(await survey.locator('[data-testid="market-survey-market-note"]').count() === 1, 'and says shares move with the market');
  await survey.waitForFunction(() => !/—/.test(document.querySelector('[data-testid="market-survey"] [data-testid="share-Elm"]')?.textContent || '—'), null, { timeout: 120000 }).catch(() => {});
  const shareOf = async n => num(await survey.textContent(`[data-testid="market-survey"] [data-testid="share-${n}"]`));
  const [sA, sE] = [await shareOf('Alder'), await shareOf('Elm')];
  ok(sA > 20 && sE < 20, 'the Market Survey\'s shares reflect the moves (cheapest above a fifth, dearest below)', `${sA}% / ${sE}%`);
  await shot(survey, '06-market-survey-after-moves.png');

  // ---- a rejoin on a second device ------------------------------------------
  await toDecisionsWC(pages.Birch);
  await pages.Birch.waitForSelector('[data-testid="market-row-1"]', { timeout: 30000 });
  const before = (await pages.Birch.textContent('[data-testid="market-results"]')).trim();
  const ctx2 = await browser.newContext(opts);
  ctx2.on('page', p => p.on('pageerror', e => errs.push(e.message)));
  const dev2 = await ctx2.newPage();
  await dev2.goto(`/?api=${encodeURIComponent(API)}`);
  await dev2.waitForSelector('[data-testid="reclaim-team"]', { timeout: 30000 });
  await dev2.click('[data-testid="reclaim-team"]');
  await dev2.fill('[data-testid="reclaim-room-code"]', code);
  await dev2.fill('[data-testid="reclaim-team-name"]', 'Birch');
  await dev2.fill('[data-testid="reclaim-code"]', codes.Birch);
  await dev2.click('[data-testid="submit-reclaim"]');
  await dev2.waitForSelector('[data-testid="session-strip"]', { timeout: 240000 });
  await posted(dev2, 1);
  await toDecisionsWC(dev2);
  await dev2.waitForSelector('[data-testid="market-row-1"]', { timeout: 60000 });
  const after = (await dev2.textContent('[data-testid="market-results"]')).trim();
  ok(after === before, 'Birch rejoins on a second device and its market results are exactly what the first showed');
  pages.Birch = dev2;

  // ---- year 2: Dogwood does not lock ----------------------------------------
  for (const name of ['Alder', 'Birch', 'Cedar', 'Elm']) {
    await lockAndConfirm(pages[name]);
    await pages[name].waitForSelector('[data-testid="waiting"]', { timeout: 60000 });
  }
  await host.click('[data-testid="host-tab-setup"]');
  await host.waitForSelector('[data-testid="locked-Elm"]', { timeout: 30000 });
  ok((await host.textContent('[data-testid="outstanding"]')).trim().includes('Dogwood'), 'year 2: the host sees Dogwood has not locked');
  await host.click('[data-testid="advance"]');
  await host.waitForFunction(() => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === '3', null, { timeout: 30000 });
  for (const name of Object.keys(pages)) await posted(pages[name], 2);
  await host.click('[data-testid="host-tab-teams"]');
  await host.getByRole('button', { name: WC, exact: true }).first().click();
  await host.waitForSelector('[data-testid="market-flag-Dogwood"]', { timeout: 60000 });
  ok((await host.textContent('[data-testid="market-flag-Dogwood"]')).includes('counted at its 2027 lock'), 'the host\'s Teams tab flags Dogwood as counted at its last lock');
  // The Charts line, two years drawn.
  await host.click('[data-testid="host-tab-charts"]');
  await host.waitForSelector('[data-testid="chart-bookRisk"]', { timeout: 30000 });
  await host.waitForTimeout(500);
  ok(await host.locator('[data-testid="chart-bookRisk"] path, [data-testid="chart-bookRisk"] polyline').count() > 0, 'after two years the Book risk chart draws each team\'s line');
  await shot(host, '03-charts-book-risk.png', host.locator('div.relative', { has: host.locator('[data-testid="chart-expand-bookRisk"]') }).first());

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  ok(errs.length === 0, 'no page errors', errs[0] ?? '');
  await browser.close();
  killStubTree(stub.pid);
  console.log(`\nmarket-competition: ${checks - fails.length}/${checks} checks passed`);
  console.log(fails.length ? 'FAIL' : 'MARKET COMPETITION PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { killStubTree(stubPid); console.error('THREW: ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
process.on('exit', () => killStubTree(stubPid));
