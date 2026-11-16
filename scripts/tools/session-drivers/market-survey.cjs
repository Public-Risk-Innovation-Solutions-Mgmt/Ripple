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
//   - the Ripple Score (a placeholder, utils/rippleScore) is each team's rank by
//     the pool's net surplus, ties sharing a rank, the ordinal alone, the same
//     on every line view — and, the tables matching cell for cell, the same on
//     the host's screen and every team's. Tri-County buys a per-claim cover
//     before year 1 (carried into year 2), so its surplus differs from the two
//     teams on the defaults, which tie — from year 2: in year 1 the cover's
//     price passes through in the rate and, with no shocks, recovers nothing.
// And the tab is absent in single player and in Test player.
// ============================================================================
const { BASE, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');
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
      `${phase}: the Ripple Score is each team's rank by the pool's net surplus, as an ordinal alone (${pr.map(r => `${r.name} ${r.text}`).join(', ')})`, probs.join('; '));
    const ranks = pr.map(r => r.rank);
    rippleSeen.push({ phase, ranks, tie: new Set(ranks).size < ranks.length, distinct: new Set(ranks).size > 1 });
    for (const v of VIEWS.slice(1)) {
      await viewOf(host, HOST_SCOPE, v);
      const lr = await readRanks(host, HOST_SCOPE);
      ok(JSON.stringify(lr.map(r => r.rank)) === JSON.stringify(ranks), `${phase}, ${v}: the Ripple Score is the pool's rank on this line view too`, lr.map(r => r.text).join(', '));
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
    }
  }

  const rippleSeen = [];
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
  // The room's ranks: all tie at the opening; the two teams on the defaults tie
  // throughout; Tri-County's cover is a pass-through in year 1 (its price is in
  // the rate and, with no shocks, it recovers nothing), so its surplus first
  // differs after year 2 — a tie and a distinct rank there.
  ok(rippleSeen.length === 3 && rippleSeen[0].ranks.every(r => r === 1) && rippleSeen.every(r => r.tie) && rippleSeen[2].distinct,
    'Ripple Score: every team 1st at the opening, a tie at every phase, and a distinct rank after year 2', rippleSeen.map(r => `${r.phase}: ${r.ranks.join(',')}`).join(' | '));
  ok(errs.length === 0, 'no page errors', errs[0] ?? '');
  await browser.close();
  console.log(`\nmarket-survey: ${checks - fails.length}/${checks} checks passed`);
  console.log(fails.length === 0 ? 'MARKET SURVEY PASS' : 'FAIL');
  process.exit(fails.length === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
