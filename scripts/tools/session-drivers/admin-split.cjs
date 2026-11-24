// ============================================================================
// THE ANNUAL STATEMENT'S ADMIN SPLIT IN A NEW-VERSION ROOM, in a browser
// (pr/admin-fixed-variable-split). Over the stub server.
//
//   node scripts/tools/session-drivers/admin-split.cjs
//   SCREENSHOTS=1 ... also writes docs/screenshots/admin-fixed-variable-split/*.png
//
// A New-version room, Medium market, WC and GL, three teams (the dearest
// loses its book), two years. On a team's Annual Statement, for the Pool and
// each line: "General Admin Expense — Fixed", "— Variable" and "Total General
// Admin Expense" in place of the single line, then its "% of Premium"; Fixed +
// Variable = Total in every year column (to the thousand shown); Fixed above 0
// in every year, the history years' stepped back 3% a year from year 1's
// (display only: 2026 = year 1's ÷ 1.03, …); the note "Fixed admin doesn't
// shrink when your book does." under the table. The Excel download carries the
// same rows and note on every sheet, Fixed + Variable = Total in every cell; the
// PDF carries them. A Current room's team keeps the single General Admin
// Expense line and no note. A New room with ONE team (no rivals) splits its
// admin alike, Fixed above 0 in its played year. (The numbers themselves — Fixed recomputed, nothing
// else moved — are scripts/diagnostics/admin-split-check.ts.)
// ============================================================================
const { BASE, REPO, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');

const SHOTS = process.env.SCREENSHOTS ? path.join(REPO, 'docs', 'screenshots', 'admin-fixed-variable-split') : null;
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

const WC = "Workers' Compensation";
const GL = 'General Liability';
const VIEWS = ['Pool', WC, GL];
// [name, funding steps above 30% (null = Expected), New Members %]
const TEAMS = [['Alder', 0, 10], ['Birch', null, 5], ['Elm', 12, 0]];
const NOTE = 'Fixed admin doesn\'t shrink when your book does.';
const SPLIT = ['General Admin Expense — Fixed', 'General Admin Expense — Variable', 'Total General Admin Expense', '% of Premium', 'Other Admin Expense'];
const num = t => (t.trim() === '' || t.trim() === '—' ? null : Number(t.replace(/[−–]/g, '-').replace(/[^0-9.\-]/g, '')));

async function shot(locator, name) {
  if (!SHOTS) return;
  const file = path.join(SHOTS, name);
  await locator.screenshot({ path: file });
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
const posted = (page, y) => page.waitForFunction(n => document.querySelector('[data-testid="session-strip"]')?.dataset.postedYear === String(n), y, { timeout: 240000 });

async function createRoom(host, API, name, version, teams = TEAMS.length) {
  await host.goto(`/host?api=${encodeURIComponent(API)}`);
  await host.waitForSelector('[data-testid="create-room"]', { timeout: 30000 });
  await host.fill('[data-testid="event-name"]', name);
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', String(teams));
  await host.uncheck('[data-testid="line-Property"]');
  if (version) await host.selectOption('[data-testid="market-version"]', version);
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
  return (await host.textContent('[data-testid="room-code"]')).trim();
}
async function join(ctx, API, code, name) {
  const p = await ctx.newPage();
  await p.goto(`/join/${code}?api=${encodeURIComponent(API)}`);
  await p.waitForSelector('[data-testid="team-picker"]', { timeout: 30000 });
  await p.fill('[data-testid="team-name"]', name);
  await p.click('[data-testid="join-team"]');
  await p.waitForSelector('[data-testid="session-strip"]', { timeout: 240000 });
  return p;
}
async function toStatement(page, view) {
  await page.getByRole('button', { name: /^Annual Statement$/ }).first().click();
  await page.waitForSelector('[data-testid="annual-statement"]', { timeout: 30000 });
  await page.getByRole('button', { name: view, exact: true }).first().click();
  await page.waitForTimeout(500);
}
/** The Net Income Statement's rows as shown: label, key and the five year cells. */
async function operatingRows(page) {
  return page.locator('[data-testid="statement-operating"] tr[data-row-key]').evaluateAll(trs => trs.map(tr => ({
    key: tr.dataset.rowKey, label: tr.dataset.rowLabel,
    cells: [...tr.querySelectorAll('td')].slice(1, 7).map(td => td.textContent),
  })));
}

(async () => {
  await requireServer();
  const port = await freePort();
  const API = `http://localhost:${port}`;
  const stub = await startStub(port);
  stubPid = stub.pid;
  const browser = await launchBrowser();
  const opts = { baseURL: BASE, viewport: { width: 1440, height: 1600 }, deviceScaleFactor: SHOTS ? 2 : 1, acceptDownloads: true };
  const ctx = await browser.newContext(opts);
  const errs = [];
  ctx.on('page', p => p.on('pageerror', e => errs.push(e.message)));

  // ---- a New-version room, two years -------------------------------------------
  const host = await ctx.newPage();
  const code = await createRoom(host, API, 'Admin Split Driver', 'new');
  console.log(`\n  New room ${code}\n`);
  const pages = {};
  for (const [name] of TEAMS) pages[name] = await join(ctx, API, code, name);
  for (const [name, funding, nm] of TEAMS) {
    const p = pages[name];
    await p.getByRole('button', { name: 'Decisions', exact: true }).first().click();
    for (const line of [WC, GL]) {
      await p.getByRole('button', { name: line, exact: true }).first().click();
      await p.waitForTimeout(300);
      if (funding !== null) await setSlider(p, /^Funding Confidence Level$/, funding);
      if (nm) await setSlider(p, /^New Members$/, nm);
    }
  }
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
  }
  ok(true, 'three teams played two years in a New-version room (Medium)');

  // ---- the statement, Pool and each line ------------------------------------------
  for (const name of ['Elm', 'Alder']) {
    const p = pages[name];
    for (const view of VIEWS) {
      await toStatement(p, view);
      const rows = await operatingRows(p);
      const labels = rows.map(r => r.label);
      const at = labels.indexOf(SPLIT[0]);
      ok(at >= 0 && labels.slice(at, at + 5).join(' | ') === SPLIT.join(' | ') && !labels.includes('General Admin Expense'),
        `${name}, ${view}: Fixed, Variable, Total General Admin Expense, its % of Premium — no single line`, labels.slice(at, at + 5).join(' | '));
      const by = k => rows.find(r => r.key === k)?.cells.map(num) ?? [];
      const [f, v, t] = [by('adminFixed'), by('adminVariable'), by('admin')];
      const years = f.slice(1);
      const off = years.map((x, k) => (x === null || v[k + 1] === null || t[k + 1] === null ? 99 : x + v[k + 1] - t[k + 1])).filter(d => Math.abs(d) > 1);
      ok(years.length === 5 && off.length === 0, `${name}, ${view}: Fixed + Variable = Total in all five year columns (to the thousand shown)`,
        `Fixed ${f.join('/')} · Variable ${v.join('/')} · Total ${t.join('/')}`);
      // To the thousand shown: each year's Fixed is 1.03 × the year before's, history years included.
      const stepped = years.every((x, k) => x > 0 && (k === 0 || Math.abs(years[k - 1] * 1.03 - x) <= 1.5));
      ok(stepped, `${name}, ${view}: Fixed above 0 in all five years, each 1.03 × the year before — the three history years stepped back from year 1`, years.join(' / '));
      const note = await p.locator('[data-testid="statement-operating"] [data-testid="fixed-admin-note"]').allInnerTexts();
      ok(note.length === 1 && note[0].trim() === NOTE, `${name}, ${view}: the note under the table`, note.join(' | '));
      if (name === 'Elm' && view === 'Pool') await shot(p.locator('[data-testid="statement-operating"]'), '01-elm-pool-net-income.png');
      if (name === 'Elm' && view === WC) await shot(p.locator('[data-testid="statement-operating"]'), '02-elm-wc-net-income.png');
      if (name === 'Alder' && view === 'Pool') await shot(p.locator('[data-testid="statement-operating"]'), '03-alder-pool-net-income.png');
    }
  }

  // ---- the downloads (Pool view: every sheet) ---------------------------------------
  const elm = pages.Elm;
  await toStatement(elm, 'Pool');
  const [xdl] = await Promise.all([elm.waitForEvent('download', { timeout: 30000 }), elm.getByRole('button', { name: 'Download Annual Statement (Excel)' }).first().click()]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await xdl.path());
  const xlProblems = [];
  for (const ws of wb.worksheets) {
    const rowOf = label => { for (let r = 1; r <= 60; r++) if (String(ws.getCell(r, 2).value ?? '').trim() === label) return r; return -1; };
    const [rf, rv, rt] = SPLIT.slice(0, 3).map(rowOf);
    if (rf < 0 || rv !== rf + 1 || rt !== rf + 2 || rowOf('General Admin Expense') !== -1) xlProblems.push(`${ws.name}: rows ${rf}/${rv}/${rt}`);
    for (let c = 4; c <= 8; c++) {
      const n = r => Number(ws.getCell(r, c).value);
      if (Math.abs(n(rf) + n(rv) - n(rt)) > 1e-6) xlProblems.push(`${ws.name} column ${c}: ${n(rf)} + ${n(rv)} ≠ ${n(rt)}`);
    }
    const nr = rowOf(NOTE);
    if (nr < 0 || ws.getCell(nr, 2).font?.italic !== true) xlProblems.push(`${ws.name}: no italic note`);
  }
  ok(wb.worksheets.map(w => w.name).join(',') === 'Pool,WC,GL' && xlProblems.length === 0,
    'the Excel file (Pool, WC, GL): Fixed, Variable and Total on every sheet, Fixed + Variable = Total in every year cell, and the note', xlProblems.slice(0, 3).join('; '));
  const [pdl] = await Promise.all([elm.waitForEvent('download', { timeout: 30000 }), elm.getByRole('button', { name: 'Download Annual Statement (PDF)' }).first().click()]);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const fonts = path.join(REPO, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(await pdl.path())), standardFontDataUrl: fonts, isEvalSupported: false }).promise;
  let text = '';
  for (let k = 1; k <= doc.numPages; k++) text += ' ' + (await (await doc.getPage(k)).getTextContent()).items.map(it => it.str).join(' ');
  const count = s => text.split(s).length - 1;
  ok(count(SPLIT[0]) === 3 && count(SPLIT[1]) === 3 && count(SPLIT[2]) === 3 && count(NOTE) === 3,
    'the PDF: Fixed, Variable, Total General Admin Expense and the note, once per statement (Pool, WC, GL)',
    `${count(SPLIT[0])}/${count(SPLIT[1])}/${count(SPLIT[2])}/${count(NOTE)}`);

  // ---- a Current room keeps the single line --------------------------------------------
  const host2 = await ctx.newPage();
  const code2 = await createRoom(host2, API, 'Admin Split Current', null);
  const cur = await join(ctx, API, code2, 'Alder');
  for (const view of VIEWS) {
    await toStatement(cur, view);
    const labels = (await operatingRows(cur)).map(r => r.label);
    ok(labels.includes('General Admin Expense') && !labels.some(l => /Fixed|Variable|Total General Admin/.test(l))
      && await cur.locator('[data-testid="fixed-admin-note"]').count() === 0,
      `a Current room's team, ${view}: the single General Admin Expense line and no note`);
  }

  // ---- a New room with ONE team: no rivals, the fixed admin still shows -----------------
  const host3 = await ctx.newPage();
  const code3 = await createRoom(host3, API, 'Admin Split Solo', 'new', 1);
  const solo = await join(ctx, API, code3, 'Alder');
  await lockAndConfirm(solo);
  await solo.waitForSelector('[data-testid="session-strip"][data-lock="locked"]', { timeout: 60000 });
  await host3.click('[data-testid="host-tab-setup"]');
  await host3.waitForSelector('[data-testid="locked-Alder"]', { timeout: 30000 });
  await host3.click('[data-testid="advance"]');
  await host3.waitForFunction(() => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === '2', null, { timeout: 30000 });
  await posted(solo, 1);
  for (const view of VIEWS) {
    await toStatement(solo, view);
    const rows = await operatingRows(solo);
    const by = k => rows.find(r => r.key === k)?.cells.map(num) ?? [];
    const [f, v, t] = [by('adminFixed'), by('adminVariable'), by('admin')];
    const years = f.slice(1).filter(x => x !== null);
    const played = years[years.length - 1];
    const sums = f.slice(1).every((x, k) => x === null || Math.abs(x + v[k + 1] - t[k + 1]) <= 1);
    ok(years.length >= 2 && played > 0 && years.every(x => x > 0) && sums,
      `a one-team New room, ${view}: Fixed above 0 in its played year and the history years, Fixed + Variable = Total`, `Fixed ${f.join('/')}`);
  }
  if (SHOTS) { await toStatement(solo, 'Pool'); await shot(solo.locator('[data-testid="statement-operating"]'), '04-solo-pool-net-income.png'); }

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  ok(errs.length === 0, 'no page errors', errs[0] ?? '');
  await browser.close();
  killStubTree(stub.pid);
  console.log(`\nadmin-split: ${checks - fails.length}/${checks} checks passed`);
  console.log(fails.length ? 'FAIL' : 'ADMIN SPLIT PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { killStubTree(stubPid); console.error('THREW: ' + (e && e.stack ? e.stack : String(e))); process.exit(1); });
process.on('exit', () => killStubTree(stubPid));
