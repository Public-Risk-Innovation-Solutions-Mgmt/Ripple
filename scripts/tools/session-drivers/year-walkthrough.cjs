// ============================================================================
// THE YEAR WALKTHROUGH ON THE CALCULATION AUDIT — a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/year-walkthrough.cjs        (ADMIN_TOKEN for the hosted part)
//
// Scenario 16, all three lines, one year locked at the defaults:
//
// 1. Single player: the walkthrough shows the version (the save key) and NO
//    seed; every block carries a code; no screen of the game shows the
//    scenario's fixed seed; the Results download has a "Year Walkthrough"
//    sheet with the version and no seed, and no cell anywhere equal to it.
// 2. Test player, in TWO browser contexts with the same setup and the same
//    decisions: each shows the version and the fixed seed — the same in both —
//    and every code is identical between them; its download carries the seed.
// 3. Hosted (only with ADMIN_TOKEN): the host's header shows the version and
//    the same fixed seed; two teams in their own contexts lock the same
//    decisions, the host advances, and each team's Calculation Audit is the
//    walkthrough alone — the version, no seed, and codes identical between
//    the teams; no team screen or download shows the seed.
//
// ⚠ THE SOLO CONTEXTS NEVER CARRY THE ADMIN TOKEN (as test-player.cjs). The
// hosted part runs against the session stub server (as two-contexts.cjs), so
// the host and the two team contexts share one room.
// ============================================================================
const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
const net = require('node:net');
const XLSX = require('xlsx');
const { BASE, REPO, launchBrowser, requireServer } = require('./_shared.cjs');

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const SCENARIO = '16';
const LINE_NAMES = ["Workers' Compensation", 'General Liability', 'Property'];
const TABS = ['Introduction', 'Rate Indication', 'Model', 'Annual Statement', 'Decisions', 'Decision History', 'Result Spreadsheet', 'Calculation Audit'];

// The scenario's fixed seed and the save key, from the source.
const truth = JSON.parse(execFileSync('npx', ['tsx', '-e',
  `import { SCENARIO_SEEDS } from './src/data/pricingParameters';
   import { SAVE_KEY } from './src/utils/gameSave';
   console.log(JSON.stringify({ seed: String(SCENARIO_SEEDS[${SCENARIO}]), version: SAVE_KEY }));`],
{ cwd: REPO, encoding: 'utf8' }).trim().split('\n').pop());
const seedToken = new RegExp(`(^|[^0-9.,])${truth.seed}([^0-9.,]|$)`);

async function openSolo(page, mode) {
  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption(SCENARIO);
  for (const label of LINE_NAMES) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
  if (mode === 'test') {
    await page.getByRole('button', { name: 'Test player', exact: true }).click();
    await page.waitForSelector('[data-testid="test-player-setup"]', { timeout: 20000 });
    await page.click('[data-testid="start-test-player"]');
  } else {
    await page.getByRole('button', { name: 'Single player', exact: true }).click();
  }
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
}
async function lock(page) {
  await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
  await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
  await page.waitForTimeout(2500);
  const decline = page.getByRole('button', { name: /Decline/i }).first();
  if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
  const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
  if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
  await page.waitForSelector('text=Lock Program Year 2028', { timeout: 120000 });
}
// Every code on the walkthrough, in order, with its block.
async function walk(page) {
  await page.getByRole('button', { name: 'Calculation Audit', exact: true }).first().click();
  await page.waitForSelector('[data-testid="year-walkthrough"] [data-testid="walk-year-code"]', { timeout: 60000 });
  const blocks = await page.locator('[data-testid="walk-block"]').evaluateAll(els =>
    els.map(e => `${e.getAttribute('data-block')}:${e.querySelector('[data-testid="walk-code"]')?.textContent}`));
  const t = id => page.locator(`[data-testid="${id}"]`).first().textContent().catch(() => null);
  return {
    version: await t('walk-version'),
    seed: await page.locator('[data-testid="walk-seed"]').count() ? await t('walk-seed') : null,
    yearCode: await t('walk-year-code'), decisionsCode: await t('walk-decisions-code'), drawsCode: await t('walk-draws-code'),
    blocks,
  };
}
// Every tab's visible text, for the fixed seed as a token.
async function seedOnAnyScreen(page) {
  const hits = [];
  for (const tab of TABS) {
    const b = page.getByRole('button', { name: tab, exact: true }).first();
    if (await b.count() === 0) continue;
    await b.click();
    await page.waitForTimeout(700);
    if (seedToken.test(await page.locator('body').innerText())) hits.push(tab);
  }
  return hits;
}
// The Results download: its sheets, and every cell's text.
async function resultsDownload(page) {
  await page.getByRole('button', { name: 'Result Spreadsheet', exact: true }).first().click();
  await page.waitForTimeout(800);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
    page.getByRole('button', { name: /Download Results/ }).first().click(),
  ]);
  if (!dl) return null;
  const wb = XLSX.read(fs.readFileSync(await dl.path()));
  const cells = wb.SheetNames.flatMap(n => Object.entries(wb.Sheets[n]).filter(([k]) => !k.startsWith('!')).map(([, c]) => String(c.v ?? '')));
  const rows = wb.Sheets['Year Walkthrough'] ? XLSX.utils.sheet_to_json(wb.Sheets['Year Walkthrough'], { header: 1 }) : [];
  return { sheets: wb.SheetNames, cells, rows };
}
const seedCells = d => d.cells.filter(c => c === truth.seed || /^seed$/i.test(c.trim()));

// The session stub server, on a port the OS hands out, in its own process group.
let stubPid = 0;
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
  });
}
process.on('exit', () => { try { if (stubPid) process.kill(-stubPid, 'SIGKILL'); } catch { /* already gone */ } });

(async () => {
  await requireServer();
  const adminToken = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  const solo = await launchBrowser();
  const errors = [];

  // ---- 1. Single player ----
  {
    const page = await (await solo.newContext({ baseURL: BASE, acceptDownloads: true })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    await openSolo(page, 'single');
    await lock(page);
    const w = await walk(page);
    ok(w.version === truth.version, 'Single player: the walkthrough shows the version', w.version);
    ok(w.seed === null, 'Single player: and no seed');
    ok(w.blocks.length >= 11 && w.blocks.every(b => /:[0-9A-F]{4}-[0-9A-F]{4}$/.test(b)), 'Single player: every draw and step carries a code', `${w.blocks.length} blocks`);
    ok([w.yearCode, w.decisionsCode, w.drawsCode].every(c => /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(c ?? '')), 'Single player: year, decisions and draws codes', `${w.yearCode} ${w.decisionsCode} ${w.drawsCode}`);
    const marks = await page.locator('[data-testid="year-walkthrough"]').innerText();
    ok(marks.includes('Same for everyone in this scenario') && marks.includes('Depends on your decisions'), 'Single player: each block is marked same-for-everyone or depends-on-decisions');
    const hits = await seedOnAnyScreen(page);
    ok(hits.length === 0, `Single player: the fixed seed ${truth.seed} is on no screen`, hits.join(', '));
    const d = await resultsDownload(page);
    ok(!!d && d.sheets.includes('Year Walkthrough'), 'Single player: the Results download has the Year Walkthrough sheet', d?.sheets.join(', '));
    ok(!!d && d.rows.some(r => r[0] === 'Version' && r[1] === truth.version), 'Single player: the sheet carries the version');
    ok(!!d && seedCells(d).length === 0, 'Single player: the download holds no seed', d ? seedCells(d).slice(0, 3).join(', ') : '');
    await page.context().close();
  }

  // ---- 2. Test player, two contexts ----
  const tp = [];
  for (const k of [1, 2]) {
    const page = await (await solo.newContext({ baseURL: BASE, acceptDownloads: true })).newPage();
    page.on('pageerror', e => errors.push(e.message));
    await openSolo(page, 'test');
    await lock(page);
    tp.push({ page, w: await walk(page) });
  }
  for (const [k, { w }] of tp.entries()) {
    ok(w.version === truth.version && w.seed === truth.seed, `Test player context ${k + 1}: the version and the scenario's fixed seed`, `${w.version} · ${w.seed}`);
  }
  const [t1, t2] = tp.map(x => x.w);
  ok(JSON.stringify(t1.blocks) === JSON.stringify(t2.blocks) && t1.yearCode === t2.yearCode && t1.decisionsCode === t2.decisionsCode && t1.drawsCode === t2.drawsCode,
    'Test player: two contexts, same setup and decisions — every code identical', `${t1.yearCode} / ${t2.yearCode}`);
  const td = await resultsDownload(tp[0].page);
  ok(!!td && td.rows.some(r => r[0] === 'Seed' && String(r[1]) === truth.seed), 'Test player: its download carries the seed');
  for (const { page } of tp) await page.context().close();
  await solo.close();

  // ---- 3. Hosted ----
  if (!adminToken) {
    console.log('  skip  hosted part (ADMIN_TOKEN unset)');
  } else {
    const API = `http://localhost:${await freePort()}`;
    stubPid = (await startStub(Number(API.split(':').pop()))).pid;
    const q = `?api=${encodeURIComponent(API)}`;
    process.env.ADMIN_TOKEN = adminToken;
    const hb = await launchBrowser();
    const hctx = await hb.newContext({ baseURL: BASE });
    const host = await hctx.newPage();
    host.on('pageerror', e => errors.push(e.message));
    await host.goto(`/host${q}`);
    await host.waitForSelector('[data-testid="create-room"]', { timeout: 30000 });
    await host.fill('[data-testid="event-name"]', 'Walkthrough');
    await host.selectOption('[data-testid="seed"]', SCENARIO);
    await host.fill('[data-testid="year-count"]', '3');
    await host.fill('[data-testid="expected-teams"]', '2');
    await host.click('[data-testid="create-room"]');
    await host.waitForSelector('[data-testid="room-code"]');
    const code = (await host.textContent('[data-testid="room-code"]')).trim();
    await host.waitForSelector('[data-testid="host-version"]', { timeout: 30000 });
    const hv = (await host.textContent('[data-testid="host-version"]')).trim();
    const hs = await host.locator('[data-testid="host-seed"]').count() ? (await host.textContent('[data-testid="host-seed"]')).trim() : null;
    ok(hv === truth.version && hs === truth.seed, 'Host: the header shows the version and the same fixed seed as Test player', `${hv} · ${hs} (Test player ${t1.seed})`);

    // Two teams, each in its own context, without the admin token.
    delete process.env.ADMIN_TOKEN;
    const tb = await launchBrowser();
    const teams = [];
    for (const name of ['Harbour Mutual', 'Ridge Pool']) {
      const ctx = await tb.newContext({ baseURL: BASE, acceptDownloads: true });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`/join/${code}${q}`);
      await page.waitForSelector('[data-testid="team-picker"]');
      await page.fill('[data-testid="team-name"]', name);
      await page.click('[data-testid="join-team"]');
      await page.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
      teams.push(page);
    }
    for (const page of teams) {
      await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
      await page.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
    }
    await host.click('[data-testid="host-tab-setup"]').catch(() => {});
    await host.waitForTimeout(500);
    await host.click('[data-testid="advance"]');
    for (const page of teams) {
      await page.waitForFunction(() => document.querySelector('[data-testid="posted-year"]')?.textContent.includes('year 1 result posted'), null, { timeout: 180000 });
      await page.waitForTimeout(800);
    }
    const tw = [];
    for (const [k, page] of teams.entries()) {
      const w = await walk(page);
      tw.push(w);
      ok(w.version === truth.version && w.seed === null, `Team ${k + 1}: the version and no seed`, `${w.version} · ${w.seed}`);
      const auditText = await page.locator('main').innerText().catch(() => '');
      ok(!/Temporary debug page/.test(auditText), `Team ${k + 1}: the Calculation Audit is the walkthrough alone`);
      const hits = await seedOnAnyScreen(page);
      ok(hits.length === 0, `Team ${k + 1}: the fixed seed is on no screen`, hits.join(', '));
      const d = await resultsDownload(page);
      ok(!!d && d.sheets.includes('Year Walkthrough') && seedCells(d).length === 0, `Team ${k + 1}: the download has the walkthrough and no seed`, d ? seedCells(d).slice(0, 3).join(', ') : 'no file');
    }
    ok(JSON.stringify(tw[0].blocks) === JSON.stringify(tw[1].blocks) && tw[0].yearCode === tw[1].yearCode && tw[0].decisionsCode === tw[1].decisionsCode,
      'Hosted: two teams, same decisions — every code identical', `${tw[0].yearCode} / ${tw[1].yearCode}`);
    await tb.close();
    await hb.close();
  }

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  console.log(`\nyear-walkthrough: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'YEAR WALKTHROUGH PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
