// ============================================================================
// THE MARKET SURVEY — a hosted team's view of every team: the host's Teams table.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/market-survey.cjs      (ADMIN_TOKEN to host)
//
// A room playing WC + GL, three teams, two played years. At the opening (2026),
// after year 1 and after year 2, on the pool and on each line:
//   - every team's Market Survey shows the host's Teams table exactly: the same
//     columns (the host's but its Hand Off), the same year heading, the same
//     rows in the same order, cell for cell;
//   - each team's own row is highlighted (data-own) and no other is;
//   - no team's survey shows decisions: the page carries no funding level, no
//     cover, no dividend, no decision word at all;
//   - a viewer of a team sees the same table, that team's row highlighted;
//   - the Ripple Ranking (a placeholder, utils/rippleScore) is each team's rank by
//     the pool's net surplus, ties sharing a rank, the ordinal alone, the same
//     on every line view — and, the tables matching cell for cell, the same on
//     the host's screen and every team's. Tri-County buys a per-claim cover
//     before year 1 (carried into year 2), so its surplus differs from the two
//     teams on the defaults, which tie — from year 2: in year 1 the cover's
//     price passes through in the rate and, with no shocks, recovers nothing.
// And the tab is absent in single player and in Test player.
//
// THE ANNUAL STATEMENT'S MARKET SURVEY SECTION (pr/statement-market-survey), on
// every team's and the viewer's page at each phase, on the pool and each line:
//   - it is that page's Market Survey tab, cell for cell — the same heads, year
//     heading and rows in the same order — for the statement's year;
//   - the same row (the page's own team) is highlighted, and no other;
//   - it sits just before the Decisions section;
//   - turned back a year, it shows no other year's standings and says so.
// In single player and Test player it is one row, the player's own pool: no
// team number, the pool's name, ranked 1st, its premium to surplus and the
// year's combined ratio the statement's own, no market share.
// And after year 2, for a team and the viewer, on the pool and a line: the
// Excel and PDF downloads carry the same section — the Excel sheet's rows cell
// for cell, the PDF page's rows run for run (the pool's rate lines joined).
// CONTROLS: the section's rows read off another team's page (a different own
// row) and with one cell changed are each refused by the comparison.
// ============================================================================
const { BASE, REPO, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const fails = [];
let checks = 0;
function ok(c, w, detail = '') { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w + (detail ? `  — ${detail}` : '')); } else console.log('  ok    ' + w + (detail ? `  — ${detail}` : '')); }

const TEAMS = ['Harbour Mutual', 'Cedar Valley', 'Tri-County'];
const LINES = [['WC', "Workers' Compensation"], ['GL', 'General Liability']];

// THE RIPPLE SCORE PLACEHOLDER: rank by the pool's net surplus, 1 highest, ties shared, an ordinal alone.
const ORDINAL = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'}`;
const readRanks = (page, scope) => page.$eval(scope, root => [...root.querySelectorAll('[data-testid="teams-table"] tr')].map(r => {
  const rc = r.querySelector('[data-testid^="ripple-"]'), sc = r.querySelector('[data-testid^="surplus-"]');
  return { name: r.children[1]?.textContent.trim(), rank: rc?.getAttribute('data-rank') ? Number(rc.getAttribute('data-rank')) : null,
    text: rc?.textContent.trim() ?? null, surplus: sc?.getAttribute('data-value') ? Number(sc.getAttribute('data-value')) : null };
}));
const wantRanks = rows => {
  const all = rows.filter(r => r.surplus !== null).map(r => r.surplus);
  return rows.map(r => (r.surplus === null ? null : 1 + all.filter(o => o > r.surplus).length));
};
function rankProblems(rows, want = wantRanks(rows)) {
  const out = [];
  rows.forEach((r, i) => {
    if (r.rank !== want[i]) out.push(`${r.name} rank ${r.rank} vs ${want[i]}`);
    if (r.rank !== null && r.text !== ORDINAL(r.rank)) out.push(`${r.name} reads "${r.text}", not "${ORDINAL(r.rank)}" alone`);
  });
  return out;
}
const VIEWS = ['Pool', "Workers' Compensation", 'General Liability'];

async function join(ctx, code, name) {
  const p = await ctx.newPage();
  await p.goto(`/join/${code}`);
  await p.waitForSelector('[data-testid="team-picker"]');
  await p.fill('[data-testid="team-name"]', name);
  await p.click('[data-testid="join-team"]');
  await p.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
  return p;
}

// One table as rendered, under `scope`: its heads, its year heading and every row's cells, with whether it is "own".
const readTable = (page, scope) => page.$eval(scope, root => {
  const t = root.querySelector('[data-testid="teams-table"]');
  if (!t) return null;
  const heads = [...t.closest('table').querySelectorAll('thead th')].map(h => h.textContent.trim());
  const rows = [...t.querySelectorAll('tr')].map(r => ({
    cells: [...r.children].map(c => c.textContent.trim()),
    own: r.getAttribute('data-own') === 'true',
  }));
  return { heads, year: root.querySelector('[data-testid="teams-year"]')?.textContent.trim(), rows };
});

// The statement's Market Survey section as rendered: heads, year heading, every row's cells, own rows.
const readSection = page => page.$eval('[data-testid="statement-market-survey"]', root => {
  const body = root.querySelector('[data-testid="statement-market-survey-rows"]');
  const heads = [...root.querySelectorAll('thead th')].map(h => h.textContent.trim());
  const rows = body ? [...body.querySelectorAll('tr')].map(r => ({
    cells: [...r.children].map(c => c.textContent.trim()), own: r.getAttribute('data-own') === 'true',
  })) : [];
  const next = root.nextElementSibling;
  return {
    heads, year: root.querySelector('[data-testid="statement-market-survey-year"]')?.textContent.trim(), rows,
    note: root.querySelector('[data-testid="statement-market-survey-note"]')?.textContent.trim() ?? null,
    beforeDecisions: next?.getAttribute('data-testid') === 'statement-decisions',
  };
});
async function statementSection(page, view) {
  await page.getByRole('button', { name: 'Annual Statement', exact: true }).first().click();
  await page.waitForSelector('[data-testid="statement-market-survey"]', { timeout: 30000 });
  await page.getByRole('button', { name: view, exact: true }).first().click();
  await page.waitForTimeout(400);
  return readSection(page);
}
const sameTable = (sec, tab) => JSON.stringify({ heads: sec.heads, year: sec.year, rows: sec.rows.map(r => r.cells) })
  === JSON.stringify({ heads: tab.heads, year: tab.year, rows: tab.rows.map(r => r.cells) });

// THE DOWNLOADS' SECTION: the rows after the sheet's "Market Survey —" title, and the PDF page that opens with it.
async function downloaded(page, testId) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(`[data-testid="${testId}"]`)]);
  return fs.readFileSync(await dl.path());
}
async function excelSection(bytes, sheetName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const ws = wb.getWorksheet(sheetName);
  let at = 0;
  ws.eachRow((row, r) => { if (!at && String(row.getCell(2).value ?? '').startsWith('Market Survey — ')) at = r; });
  if (!at) return null;
  const text = v => (v === null || v === undefined ? '' : String(v)).replace(/\n/g, '');
  const heads = Array.from({ length: 9 }, (_, k) => text(ws.getCell(at + 2, 2 + k).value));
  const rows = [];
  for (let r = at + 3; text(ws.getCell(r, 3).value) !== ''; r++) rows.push(Array.from({ length: 9 }, (_, k) => text(ws.getCell(r, 2 + k).value)));
  return { year: text(ws.getCell(at, 4).value), heads, rows };
}
async function pdfSection(bytes, scopeName) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const fonts = path.join(REPO, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
  const doc = await getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: fonts, isEvalSupported: false }).promise;
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    const items = (await pg.getTextContent()).items.filter(it => it.str.trim());
    const ys = [...new Set(items.map(it => Math.round(it.transform[5] * 10) / 10))].sort((a, b) => b - a);
    const lines = ys.map(y => items.filter(it => Math.round(it.transform[5] * 10) / 10 === y).sort((a, b) => a.transform[4] - b.transform[4]).map(it => it.str.trim()));
    const t = lines.findIndex(l => l[0] === `Market Survey - ${scopeName}`);
    if (t < 0) continue;
    return { year: lines[t][1], heads: lines[t + 1], rows: lines.slice(t + 2, -2) };
  }
  return null;
}

async function viewOf(page, scope, label) {
  await page.locator(scope).getByRole('button', { name: label, exact: true }).first().click();
  await page.waitForTimeout(250);
  return readTable(page, scope);
}

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  const errs = [];
  host.on('pageerror', e => errs.push(e.message));

  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="event-name"]', 'Market Survey Session');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '3');
  await host.uncheck('[data-testid="line-Property"]');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\nroom ${code}\n`);

  const teams = [];
  for (const n of TEAMS) teams.push(await join(ctx, code, n));
  for (const p of teams) p.on('pageerror', e => errs.push(e.message));
  // A viewer of the second team, in its own page.
  const viewer = await ctx.newPage();
  viewer.on('pageerror', e => errs.push(e.message));
  await viewer.goto(`/view/${code}`);
  await viewer.waitForSelector(`[data-testid="watch-${TEAMS[1]}"]`, { timeout: 30000 });
  await viewer.click(`[data-testid="watch-${TEAMS[1]}"]`);
  const hasViewer = await viewer.waitForSelector('[data-testid="watched-team"]', { timeout: 120000 }).then(() => true).catch(() => false);

  const HOST_SCOPE = 'main, body';
  async function hostTables() {
    await host.click('[data-testid="host-tab-teams"]');
    await host.waitForSelector('[data-testid="teams-table"] tr');
    const out = {};
    for (const v of VIEWS) out[v] = await viewOf(host, HOST_SCOPE, v);
    return out;
  }
  async function surveyTables(page) {
    await page.getByRole('button', { name: 'Market Survey', exact: true }).first().click();
    await page.waitForSelector('[data-testid="market-survey"] [data-testid="teams-table"] tr', { timeout: 30000 });
    const out = {};
    for (const v of VIEWS) out[v] = await viewOf(page, '[data-testid="market-survey"]', v);
    out.text = await page.locator('[data-testid="market-survey"]').innerText();
    return out;
  }
  // The host's table without its Hand Off column, and without the market's two host-only columns
  // (Exposure moved, Book risk — pr/market-competition; the room is at the default, Medium), which a
  // team's Market Survey must not show.
  const HOST_ONLY = ['Exposure moved', 'Book risk', 'Hand Off'];
  const dropAction = t => {
    const keep = t.heads.map((h, i) => (HOST_ONLY.includes(h) ? -1 : i)).filter(i => i >= 0);
    return { heads: keep.map(i => t.heads[i]), year: t.year, rows: t.rows.map(r => ({ cells: keep.map(i => r.cells[i]) })) };
  };
  const strip = t => ({ heads: t.heads, year: t.year, rows: t.rows.map(r => ({ cells: r.cells })) });

  async function compareAll(phase, wantYear) {
    // Wait until the host shows the year, then until each team's survey does.
    await host.click('[data-testid="host-tab-teams"]');
    await host.waitForFunction(y => document.querySelector('[data-testid="teams-year"]')?.textContent.includes(y), wantYear, { timeout: 60000 }).catch(() => {});
    await host.waitForFunction(n => document.querySelectorAll('[data-testid^="surplus-"]').length >= n, 2, { timeout: 60000 }).catch(() => {});
    const hostT = await hostTables();
    ok(hostT.Pool.year === `Results for ${wantYear}`, `${phase}: the host's table shows ${wantYear}`, hostT.Pool.year);
    // THE RIPPLE SCORE on the host's table: the pool's rank, the same on every line view.
    await viewOf(host, HOST_SCOPE, 'Pool');
    const pr = await readRanks(host, HOST_SCOPE);
    const probs = rankProblems(pr);
    ok(probs.length === 0 && pr.every(r => r.rank !== null),
      `${phase}: the Ripple Ranking is each team's rank by the pool's net surplus, as an ordinal alone (${pr.map(r => `${r.name} ${r.text}`).join(', ')})`, probs.join('; '));
    const ranks = pr.map(r => r.rank);
    rippleSeen.push({ phase, ranks, tie: new Set(ranks).size < ranks.length, distinct: new Set(ranks).size > 1 });
    for (const v of VIEWS.slice(1)) {
      await viewOf(host, HOST_SCOPE, v);
      const lr = await readRanks(host, HOST_SCOPE);
      ok(JSON.stringify(lr.map(r => r.rank)) === JSON.stringify(ranks), `${phase}, ${v}: the Ripple Ranking is the pool's rank on this line view too`, lr.map(r => r.text).join(', '));
    }
    // CONTROL: ranks by row order (no ties) are refused whenever the rows tie.
    if (new Set(ranks).size < ranks.length) {
      const broken = pr.map((r, i) => ({ ...r, rank: i + 1, text: ORDINAL(i + 1) }));
      ok(rankProblems(broken, wantRanks(pr)).length > 0, `${phase}: control — ranks that split a tie are refused`);
    }
    const watchers = [...teams.map((p, i) => [TEAMS[i], p, TEAMS[i]]), ...(hasViewer ? [['viewer of ' + TEAMS[1], viewer, TEAMS[1]]] : [])];
    for (const [who, page, own] of watchers) {
      if (page.isClosed()) continue;
      await page.getByRole('button', { name: 'Market Survey', exact: true }).first().click();
      await page.waitForFunction(y => document.querySelector('[data-testid="market-survey"] [data-testid="teams-year"]')?.textContent.includes(y), wantYear, { timeout: 60000 }).catch(() => {});
      const s = await surveyTables(page);
      for (const v of VIEWS) {
        const want = dropAction(hostT[v]), got = strip(s[v]);
        ok(JSON.stringify(got) === JSON.stringify(want), `${phase}, ${who}, ${v}: the Market Survey is the host's table, cell for cell`,
          JSON.stringify(got) === JSON.stringify(want) ? `${got.rows.length} teams, ${got.year}` : `got ${JSON.stringify(got).slice(0, 300)} | want ${JSON.stringify(want).slice(0, 300)}`);
        const owns = s[v].rows.map((r, i) => (r.own ? i : -1)).filter(i => i >= 0);
        ok(owns.length === 1 && s[v].rows[owns[0]].cells[1] === own, `${phase}, ${who}, ${v}: its own row, ${own}, is highlighted and no other`, owns.map(i => s[v].rows[i].cells[1]).join(', '));
      }
      ok(!/Funding|Confidence|Reinsurance|xs \$|Dividend|Assessment|Non-renewal|New members|Risk control|Stop-Loss|Decision/i.test(s.text),
        `${phase}, ${who}: no decision shows on the Market Survey`);
      // THE ANNUAL STATEMENT'S MARKET SURVEY SECTION: this page's tab, cell for cell, on each view.
      for (const v of VIEWS) {
        const sec = await statementSection(page, v);
        ok(sameTable(sec, s[v]) && sec.note === null,
          `${phase}, ${who}, ${v}: the statement's Market Survey section is the tab, cell for cell`,
          sameTable(sec, s[v]) ? `${sec.rows.length} teams, ${sec.year}` : `got ${JSON.stringify(sec).slice(0, 300)} | tab ${JSON.stringify(strip(s[v])).slice(0, 300)}`);
        const owns = sec.rows.map((r, i) => (r.own ? i : -1)).filter(i => i >= 0);
        ok(owns.length === 1 && sec.rows[owns[0]].cells[1] === own && sec.beforeDecisions,
          `${phase}, ${who}, ${v}: its own row, ${own}, is highlighted and no other; the section sits just before Decisions`,
          owns.map(i => sec.rows[i].cells[1]).join(', '));
        // CONTROLS, once: another team's own row, and one cell changed, are refused.
        if (!controlsRun && sec.rows.length > 1) {
          controlsRun = true;
          const moved = { ...sec, rows: sec.rows.map((r, i) => ({ ...r, own: i === (owns[0] + 1) % sec.rows.length })) };
          const mOwns = moved.rows.map((r, i) => (r.own ? i : -1)).filter(i => i >= 0);
          ok(!(mOwns.length === 1 && moved.rows[mOwns[0]].cells[1] === own), 'control — a section highlighting another team\'s row is refused');
          const changed = { ...sec, rows: sec.rows.map((r, i) => (i === 0 ? { ...r, cells: r.cells.map((c, k) => (k === 3 ? c + '0' : c)) } : r)) };
          ok(!sameTable(changed, s[v]), 'control — a section with one cell changed is refused');
        }
      }
      // Turned back to an earlier year, the section shows no standings of another year, and says so.
      const options = await page.$$eval('[data-testid="statement-year"] option', os => os.map(o => o.value));
      if (options.length > 1) {
        await page.selectOption('[data-testid="statement-year"]', options[0]);
        await page.waitForTimeout(400);
        const back = await readSection(page);
        ok(back.rows.length === 0 && !!back.note && back.note.includes(wantYear),
          `${phase}, ${who}: the statement turned back to an earlier year shows no other year's standings, and says the room's are for ${wantYear}`, back.note ?? `${back.rows.length} rows`);
        await page.selectOption('[data-testid="statement-year"]', options[options.length - 1]);
        await page.waitForTimeout(300);
      }
    }
  }

  const rippleSeen = [];
  let controlsRun = false;
  await compareAll('opening', '2026');

  for (const [y, next] of [[1, '2027'], [2, '2028']]) {
    for (const p of teams) {
      await p.getByRole('button', { name: 'Decisions', exact: true }).first().click();
      // Tri-County buys the first per-claim cover on each line before year 1
      // (a hosted team's decisions carry into year 2), so its surplus differs.
      if (y === 1 && p === teams[2]) {
        for (const [l, label] of LINES) {
          await p.getByRole('button', { name: label, exact: true }).first().click();
          await p.waitForTimeout(300);
          const offered = await p.$$eval(`[data-testid^="reins-option-${l}-"]`, (els, prefix) => els.map(e => e.getAttribute('data-testid').replace(prefix, '')), `reins-option-${l}-`);
          const cover = offered.find(id => id !== 'none');
          if (cover) { await p.click(`[data-testid="reins-option-${l}-${cover}"]`); await p.waitForTimeout(300); }
          ok(!!cover, `Tri-County buys a per-claim cover on ${l} (${cover})`);
        }
      }
      await lockAndConfirm(p);
      await p.waitForSelector('[data-testid="session-strip"][data-lock="locked"]', { timeout: 30000 });
    }
    await host.click('[data-testid="host-tab-setup"]');
    await host.waitForTimeout(300);
    await host.click('[data-testid="advance"]');
    await host.waitForFunction(n => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === n, String(y + 1), { timeout: 30000 });
    for (const p of teams) {
      await p.waitForFunction(n => document.querySelector('[data-testid="session-strip"]')?.dataset.postedYear === String(n), y, { timeout: 180000 });
    }
    await compareAll(`after year ${y}`, next);
  }

  // THE DOWNLOADS (after year 2): the Excel and the PDF carry the section the tab shows.
  for (const [who, page] of [[TEAMS[0], teams[0]], ...(hasViewer ? [['viewer of ' + TEAMS[1], viewer]] : [])]) {
    for (const [v, sheet, scope] of [['Pool', 'Pool', 'Pool'], ["Workers' Compensation", 'WC', "Workers' Compensation"]]) {
      await page.getByRole('button', { name: 'Market Survey', exact: true }).first().click();
      await page.waitForSelector('[data-testid="market-survey"] [data-testid="teams-table"] tr');
      const tab = await viewOf(page, '[data-testid="market-survey"]', v);
      await statementSection(page, v);
      const want = { year: tab.year, heads: tab.heads, rows: tab.rows.map(r => r.cells) };
      const xl = await excelSection(await downloaded(page, 'statement-download'), sheet);
      ok(JSON.stringify(xl) === JSON.stringify(want), `downloads, ${who}, ${v}: the Excel file's Market Survey section is the tab, cell for cell`,
        JSON.stringify(xl) === JSON.stringify(want) ? `${xl.rows.length} teams` : `got ${JSON.stringify(xl).slice(0, 300)} | tab ${JSON.stringify(want).slice(0, 300)}`);
      // The PDF writes each cell as a run, the pool's rate lines joined by " · " (the tab's run them together).
      const pdf = await pdfSection(await downloaded(page, 'statement-download-pdf'), scope);
      // RENAMED (wip/ripple-ranking): the column is "Ripple Ranking" on the tab, the Excel and the PDF; "Ripple Score" nowhere.
      ok(want.heads[2] === 'Ripple Ranking' && (xl?.heads ?? [])[2] === 'Ripple Ranking' && (pdf?.heads ?? [])[2] === 'Ripple Ranking'
        && ![...want.heads, ...(xl?.heads ?? []), ...(pdf?.heads ?? [])].some(h => /Ripple Score/.test(h))
        && !/Ripple Score/.test(await page.locator('main').innerText()),
        `downloads, ${who}, ${v}: the column reads "Ripple Ranking" on the tab, the Excel and the PDF, and "Ripple Score" appears nowhere`,
        `${want.heads[2]} | ${(xl?.heads ?? [])[2]} | ${(pdf?.heads ?? [])[2]}`);
      const flat = c => c.replace(/ · /g, '').replace(/−/g, '-');
      const pdfRows = pdf ? pdf.rows.map(r => r.map(flat)) : null;
      const wantPdf = want.rows.map(r => r.filter(c => c !== '').map(c => c.replace(/−/g, '-')));
      ok(!!pdf && pdf.year === tab.year && JSON.stringify(pdf.heads) === JSON.stringify(tab.heads) && JSON.stringify(pdfRows) === JSON.stringify(wantPdf),
        `downloads, ${who}, ${v}: the PDF's Market Survey page is the tab, row for row`,
        pdf ? (JSON.stringify(pdfRows) === JSON.stringify(wantPdf) ? `${pdf.rows.length} teams, ${pdf.year}` : `got ${JSON.stringify(pdfRows).slice(0, 300)} | tab ${JSON.stringify(wantPdf).slice(0, 300)}`) : 'no Market Survey page');
    }
  }

  // Hosted games only: absent in single player and Test player.
  for (const mode of ['Single player', 'Test player']) {
    const page = await (await browser.newContext({ baseURL: BASE })).newPage();
    page.on('pageerror', e => errs.push(e.message));
    await page.goto('/solo');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
    await page.getByRole('button', { name: mode, exact: true }).click();
    if (mode === 'Test player') {
      await page.waitForSelector('[data-testid="test-player-setup"]', { timeout: 20000 });
      await page.click('[data-testid="start-test-player"]');
    }
    await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
    ok(await page.getByRole('button', { name: 'Market Survey', exact: true }).count() === 0 && await page.$('[data-testid="market-survey"]') === null,
      `${mode}: no Market Survey tab`);
    // THE STATEMENT'S MARKET SURVEY SECTION: one row, the player's own pool — its P/S and the year's CR the statement's own.
    const sec = await statementSection(page, 'Pool');
    const pool = await page.$eval('[data-testid="annual-statement"]', root => root.querySelector('h1')?.textContent ?? '');
    const stPts = await page.$$eval('[data-testid="statement-balance"] tr[data-row-label="Premium to Surplus Ratio"] td', tds => tds.map(t => t.textContent.trim()));
    const r = sec.rows[0]?.cells ?? [];
    const ptsShown = stPts.filter(x => /^[\d.]+$/.test(x)).at(-1);
    ok(sec.rows.length === 1 && r[0] === '—' && r[2] === '1st' && r[r.length - 1] === '—' && sec.beforeDecisions && !sec.rows[0].own,
      `${mode}: the statement's Market Survey section is one row, the player's own pool — no team number, ranked 1st, no market share`, JSON.stringify(sec.rows.map(x => x.cells)));
    ok(ptsShown !== undefined && Number(r[3]).toFixed(2) === Number(ptsShown).toFixed(2),
      `${mode}: its premium to surplus is the statement's Balance Sheet row for the year`, `${r[3]} vs ${ptsShown} (${pool.trim()})`);
    ok(/^Results for 2026$/.test(sec.year ?? '') && /^Combined ratio 2026$/.test(sec.heads[6] ?? ''),
      `${mode}: the section stands at the statement's year (the opening)`, `${sec.year} | ${sec.heads[6]}`);
    await page.context().close();
  }

  ok(hasViewer, 'a viewer joined and was checked');
  // The room's ranks: all tie at the opening; the two teams on the defaults tie
  // throughout; Tri-County's cover is a pass-through in year 1 (its price is in
  // the rate and, with no shocks, it recovers nothing), so its surplus first
  // differs after year 2 — a tie and a distinct rank there.
  ok(rippleSeen.length === 3 && rippleSeen[0].ranks.every(r => r === 1) && rippleSeen.every(r => r.tie) && rippleSeen[2].distinct,
    'Ripple Ranking: every team 1st at the opening, a tie at every phase, and a distinct rank after year 2', rippleSeen.map(r => `${r.phase}: ${r.ranks.join(',')}`).join(' | '));
  ok(errs.length === 0, 'no page errors', errs[0] ?? '');
  await browser.close();
  console.log(`\nmarket-survey: ${checks - fails.length}/${checks} checks passed`);
  console.log(fails.length === 0 ? 'MARKET SURVEY PASS' : 'FAIL');
  process.exit(fails.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
