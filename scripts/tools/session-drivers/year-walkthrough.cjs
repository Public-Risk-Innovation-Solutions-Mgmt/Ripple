// ============================================================================
// THE YEAR WALKTHROUGH — the whole of its tab, in every mode — a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/year-walkthrough.cjs        (ADMIN_TOKEN for the hosted part)
//
// Scenario 16, all three lines, one year locked at the defaults:
//
// 1. Single player: the "Year Walkthrough" tab is the walkthrough alone (none
//    of the old Calculation Audit), with the version and the scenario and NO
//    seed; every stage in the engine's order, each with its code and how the
//    decisions reach it; no screen shows the scenario's fixed seed; "Download
//    Year Walkthrough (Excel)" gives Year_Walkthrough_<year> with every year
//    and view, the version, no seed. ⚠ The Results download, which carried the
//    walkthrough as a sheet, went with the Result Spreadsheet tab (the tab
//    cleanup, src/game/tabs.tsx HIDDEN_TABS): it is asserted absent in every
//    mode, and the walkthrough's own download carries the checks.
// 2. Test player, in TWO browser contexts with the same setup and decisions:
//    each shows the version, the scenario and the fixed seed — the same in
//    both — and every code is identical between them; its download carries
//    the seed.
//    No "Aggregate cover recovery" row (the retired dormant stop) on the
//    screen or in either download.
// 3. Hosted (only with ADMIN_TOKEN): the host's header shows the version, the
//    scenario and the same fixed seed; two teams in their own contexts lock
//    the same decisions, the host advances, and each team's Year Walkthrough
//    shows the version, no seed, and codes identical between the teams; no
//    team screen or download — the walkthrough's own included — shows the seed.
//
// ⚠ THE SOLO CONTEXTS NEVER CARRY THE ADMIN TOKEN (as test-player.cjs). The
// hosted part runs against the session stub server (as two-contexts.cjs), so
// the host and the two team contexts share one room.
// ============================================================================
const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
const net = require('node:net');
const XLSX = require('xlsx');
const { BASE, REPO, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const SCENARIO = '16';
const LINE_NAMES = ["Workers' Compensation", 'General Liability', 'Property'];
const TABS = ['Introduction', 'Rate Indication', 'Annual Statement', 'Decisions', 'Decision History', 'Year Walkthrough'];
// The stages in the engine's order (utils/yearWalkthrough STAGES), as the page's data-stage carries them.
const ORDER = ['decisions', 'pricing', 'book', 'premium', 'draws', 'losses', 'reinsurance', 'booking', 'development',
  'reserves', 'lae', 'admin', 'riskControl', 'investment', 'dividends', 'loans', 'surplus', 'capital', 'marketShare'];

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
  await lockAndConfirm(page);
  await page.waitForTimeout(2500);
  const decline = page.getByRole('button', { name: /Decline/i }).first();
  if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
  const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
  if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
  await page.waitForSelector('text=Lock Program Year 2028', { timeout: 120000 });
}
// Every code on the walkthrough, in order, with its block.
async function walk(page) {
  await page.getByRole('button', { name: 'Year Walkthrough', exact: true }).first().click();
  await page.waitForSelector('[data-testid="year-walkthrough"] [data-testid="walk-year-code"]', { timeout: 60000 });
  // Every stage with a code — the market share, information only, carries none.
  const blocks = await page.locator('[data-testid="walk-block"]:not([data-stage="marketShare"])').evaluateAll(els =>
    els.map(e => `${e.getAttribute('data-block')}:${e.querySelector('[data-testid="walk-code"]')?.textContent}`));
  const share = await page.locator('[data-stage="marketShare"]').count()
    ? { text: await page.locator('[data-stage="marketShare"]').first().innerText(), codes: await page.locator('[data-stage="marketShare"] [data-testid="walk-code"]').count(),
      last: await page.locator('[data-testid="walk-block"]').last().getAttribute('data-stage') }
    : null;
  const stages = await page.locator('[data-testid="walk-block"]').evaluateAll(els => els.map(e => e.getAttribute('data-stage')));
  const feeds = await page.locator('[data-testid="walk-feed"]').allInnerTexts();
  const mainText = await page.locator('main').innerText().catch(() => '');
  const t = id => page.locator(`[data-testid="${id}"]`).first().textContent().catch(() => null);
  return {
    version: await t('walk-version'),
    seed: await page.locator('[data-testid="walk-seed"]').count() ? await t('walk-seed') : null,
    yearCode: await t('walk-year-code'), decisionsCode: await t('walk-decisions-code'), drawsCode: await t('walk-draws-code'),
    scenario: await page.locator('[data-testid="walk-scenario"]').count() ? await t('walk-scenario') : null,
    blocks, stages, feeds, mainText, share,
  };
}
// The Year Walkthrough's own download: its name, its rows, every cell.
async function walkDownload(page) {
  await page.getByRole('button', { name: 'Year Walkthrough', exact: true }).first().click();
  await page.waitForTimeout(600);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }).catch(() => null),
    page.locator('[data-testid="walk-download"]').click(),
  ]);
  if (!dl) return null;
  const wb = XLSX.read(fs.readFileSync(await dl.path()));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const cells = wb.SheetNames.flatMap(n => Object.entries(wb.Sheets[n]).filter(([k]) => !k.startsWith('!')).map(([, c]) => String(c.v ?? '')));
  return { name: dl.suggestedFilename(), sheets: wb.SheetNames, rows, cells };
}
// The stages in the engine's order, every one explained: same-for-everyone with its source, or the decisions and working.
function stagesOk(w) {
  const order = w.stages.filter((k, i, a) => a.indexOf(k) === i);
  const inOrder = order.every((k, i) => i === 0 || ORDER.indexOf(order[i - 1]) < ORDER.indexOf(k));
  const explained = w.feeds.length === w.stages.length
    && w.feeds.every(f => /^Same for everyone in this scenario — drawn from|^Decisions:|^Depends on your decisions only through|^Not part of the model — depends on the room/.test(f.trim()));
  return { inOrder, explained, count: order.length };
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
// The Results download went with the Result Spreadsheet tab (the tab cleanup):
// true when neither the tab nor its button is anywhere a player can reach.
async function noResultsDownload(page) {
  const bar = (await page.locator('nav').first().locator('button').allInnerTexts()).map(t => t.trim());
  return !bar.includes('Result Spreadsheet') && await page.getByRole('button', { name: /Download Results/ }).count() === 0;
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
    ok(w.version === truth.version && w.scenario === SCENARIO, 'Single player: the walkthrough shows the version and the scenario', `${w.version} · scenario ${w.scenario}`);
    ok(w.seed === null, 'Single player: and no seed');
    ok(!/Temporary debug page|Calculation checks/.test(w.mainText) && await page.getByRole('button', { name: 'Calculation Audit', exact: true }).count() === 0,
      'Single player: the tab is the Year Walkthrough alone — no tab or section of the old Calculation Audit');
    const so = stagesOk(w);
    ok(so.count >= 18 && so.inOrder, 'Single player: every stage, in the engine\'s order', `${so.count} stages`);
    ok(so.explained, 'Single player: each stage says it is the same for everyone (and from what) or which decisions reach it');
    ok(w.feeds.some(f => /Funding .* → CLF [\d.]+/.test(f)) && w.feeds.some(f => /Mix \d+\/\d+\/\d+ → .*=/.test(f)),
      'Single player: the working shows the decisions turned into results (funding → CLF → rate, mix → return)');
    ok(w.blocks.every(b => /:[0-9A-F]{4}-[0-9A-F]{4}$/.test(b)), 'Single player: every stage carries a code', `${w.blocks.length} stages`);
    ok([w.yearCode, w.decisionsCode, w.drawsCode].every(c => /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(c ?? '')), 'Single player: year, decisions and draws codes', `${w.yearCode} ${w.decisionsCode} ${w.drawsCode}`);
    const marks = await page.locator('[data-testid="year-walkthrough"]').innerText();
    ok(marks.includes('Same for everyone in this scenario') && marks.includes('Depends on your decisions'), 'Single player: each block is marked same-for-everyone or depends-on-decisions');
    const hits = await seedOnAnyScreen(page);
    ok(hits.length === 0, `Single player: the fixed seed ${truth.seed} is on no screen`, hits.join(', '));
    ok(await noResultsDownload(page), 'Single player: no Result Spreadsheet tab and no Results download (the tab cleanup)');
    const wd = await walkDownload(page);
    ok(!!wd && /^Year_Walkthrough_2027\.xlsx$/.test(wd.name) && wd.sheets.join(',') === 'Year Walkthrough',
      'Single player: "Download Year Walkthrough (Excel)" gives Year_Walkthrough_2027 with its one sheet', wd ? `${wd.name} · ${wd.sheets.join(', ')}` : 'no file');
    const views = wd ? [...new Set(wd.rows.slice(1).map(r => r[1]).filter(v => typeof v === 'string' && v !== 'View' && v !== ''))] : [];
    ok(!!wd && ['Pool', ...LINE_NAMES].every(v => views.includes(v)) && wd.rows.some(r => r[0] === 'Version' && r[1] === truth.version),
      'Single player: the workbook has every view and the version', views.join(', '));
    ok(!!wd && seedCells(wd).length === 0, 'Single player: and no seed', wd ? seedCells(wd).slice(0, 3).join(', ') : '');
    // The retired dormant stop's row is gone (wip/aggregate-cover): only the Aggregate Stop-Loss rows remain.
    const oldRow = rows => rows.some(r => r.some(c => c === 'Aggregate cover recovery'));
    ok(!marks.includes('Aggregate cover recovery') && !!wd && !oldRow(wd.rows),
      'Single player: no "Aggregate cover recovery" row on the screen or in the download');
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
  ok(await noResultsDownload(tp[0].page), 'Test player: no Result Spreadsheet tab and no Results download (the tab cleanup)');
  const twd = await walkDownload(tp[0].page);
  ok(!!twd && /^Year_Walkthrough_2027\.xlsx$/.test(twd.name) && twd.rows.some(r => r[0] === 'Seed' && String(r[1]) === truth.seed),
    'Test player: "Download Year Walkthrough (Excel)" carries the seed', twd?.name);
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
    const hsc = await host.locator('[data-testid="host-scenario"]').count() ? (await host.textContent('[data-testid="host-scenario"]')).trim() : null;
    ok(hv === truth.version && hs === truth.seed && hsc === SCENARIO, 'Host: the header shows the version, the scenario and the same fixed seed as Test player', `${hv} · ${hsc} · ${hs} (Test player ${t1.seed})`);

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
      await lockAndConfirm(page);
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
      // ⚠ NO WAIT FOR THE ROOM'S SHARE: it is information only and in no code,
      // so two teams match whenever each happens to read the page.
      const w = await walk(page);
      tw.push(w);
      ok(w.version === truth.version && w.seed === null, `Team ${k + 1}: the version and no seed`, `${w.version} · ${w.seed}`);
      const auditText = await page.locator('main').innerText().catch(() => '');
      ok(!/Temporary debug page/.test(auditText), `Team ${k + 1}: the Year Walkthrough tab is the walkthrough alone`);
      const hits = await seedOnAnyScreen(page);
      ok(hits.length === 0, `Team ${k + 1}: the fixed seed is on no screen`, hits.join(', '));
      ok(await noResultsDownload(page), `Team ${k + 1}: no Result Spreadsheet tab and no Results download (the tab cleanup)`);
      const wd = await walkDownload(page);
      ok(!!wd && /^Year_Walkthrough_2027\.xlsx$/.test(wd.name) && seedCells(wd).length === 0 && wd.rows.some(r => r[0] === 'Version'),
        `Team ${k + 1}: "Download Year Walkthrough (Excel)" — the version, no seed`, wd ? `${wd.name} ${seedCells(wd).slice(0, 2).join(', ')}` : 'no file');
      ok(!!w.share && w.share.last === 'marketShare' && w.share.codes === 0 && w.share.text.includes('Not part of the model — depends on the room'),
        `Team ${k + 1}: the room's market share at the end, marked not part of the model, with no code`);
    }
    ok(JSON.stringify(tw[0].blocks) === JSON.stringify(tw[1].blocks) && tw[0].yearCode === tw[1].yearCode && tw[0].decisionsCode === tw[1].decisionsCode,
      'Hosted: two teams, same decisions — every code identical',
      `${tw[0].yearCode} / ${tw[1].yearCode}; first differing: ${tw[0].blocks.find((b, i) => b !== tw[1].blocks[i]) ?? 'none'} / ${tw[1].blocks.find((b, i) => b !== tw[0].blocks[i]) ?? 'none'}`);
    await tb.close();
    await hb.close();
  }

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  console.log(`\nyear-walkthrough: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'YEAR WALKTHROUGH PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
