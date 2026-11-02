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
//   - a viewer of a team sees the same table, that team's row highlighted.
// And the tab is absent in single player and in Test player.
// ============================================================================
const { BASE, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');
const fails = [];
let checks = 0;
function ok(c, w, detail = '') { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w + (detail ? `  — ${detail}` : '')); } else console.log('  ok    ' + w + (detail ? `  — ${detail}` : '')); }

const TEAMS = ['Harbour Mutual', 'Cedar Valley', 'Tri-County'];
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
  // The host's table without its Hand Off column.
  const dropAction = t => ({
    heads: t.heads.slice(0, -1), year: t.year,
    rows: t.rows.map(r => ({ cells: r.cells.slice(0, -1) })),
  });
  const strip = t => ({ heads: t.heads, year: t.year, rows: t.rows.map(r => ({ cells: r.cells })) });

  async function compareAll(phase, wantYear) {
    // Wait until the host shows the year, then until each team's survey does.
    await host.click('[data-testid="host-tab-teams"]');
    await host.waitForFunction(y => document.querySelector('[data-testid="teams-year"]')?.textContent.includes(y), wantYear, { timeout: 60000 }).catch(() => {});
    await host.waitForFunction(n => document.querySelectorAll('[data-testid^="surplus-"]').length >= n, 2, { timeout: 60000 }).catch(() => {});
    const hostT = await hostTables();
    ok(hostT.Pool.year === `Results for ${wantYear}`, `${phase}: the host's table shows ${wantYear}`, hostT.Pool.year);
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
    }
  }

  await compareAll('opening', '2026');

  for (const [y, next] of [[1, '2027'], [2, '2028']]) {
    for (const p of teams) {
      await p.getByRole('button', { name: 'Decisions', exact: true }).first().click();
      await lockAndConfirm(p);
      await p.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
    }
    await host.click('[data-testid="host-tab-setup"]');
    await host.waitForTimeout(300);
    await host.click('[data-testid="advance"]');
    await host.waitForFunction(n => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === n, String(y + 1), { timeout: 30000 });
    for (const p of teams) {
      await p.waitForFunction(n => new RegExp(`year ${n} result posted`).test(document.querySelector('[data-testid="posted-year"]')?.textContent || ''), y, { timeout: 180000 });
    }
    await compareAll(`after year ${y}`, next);
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
    await page.context().close();
  }

  ok(hasViewer, 'a viewer joined and was checked');
  ok(errs.length === 0, 'no page errors', errs[0] ?? '');
  await browser.close();
  console.log(`\nmarket-survey: ${checks - fails.length}/${checks} checks passed`);
  console.log(fails.length === 0 ? 'MARKET SURVEY PASS' : 'FAIL');
  process.exit(fails.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
