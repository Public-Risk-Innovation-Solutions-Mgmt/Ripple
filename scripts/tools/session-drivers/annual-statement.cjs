// ============================================================================
// THE ANNUAL STATEMENT TAB: ITS DECISIONS SECTION AND ITS STICKY INDEX
// (pr/statement-decisions) — a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   ADMIN_TOKEN=<token> node scripts/tools/session-drivers/annual-statement.cjs
//
// In Single player, Test player and a hosted game, on decisions that change
// from year to year (Non-Renewal moved before each lock):
//
//   - THE DECISIONS TABLE IS THE RECORD. Every played year's cell, for every
//     decision on every line and the pool's asset mix, is what the game
//     recorded — read from the save (the year's lockedResults entry) in single
//     player and Test player, and from the room's stored decisions for a hosted
//     team — formatted here, independently of the page. The history years
//     before play show the prior board's decisions (every cell filled), Prior is
//     blank, and the columns are the statement's own.
//   - A line's view shows that line's decisions alone; the Pool view the asset
//     mix and each line's.
//   - THE INDEX: one link per section, in order, Decisions last; each click
//     brings its section's top to just under the app's bars (and the index),
//     marks that link current, and the index stays where it is while the page
//     scrolls. At the bottom, Decisions is the one marked. On a phone-width
//     screen the same, with the page not scrolling sideways.
//
// ⚠ AND IT CAN FAIL: Non-Renewal is moved every year, so a column one year off
// fails the record check; a section the index skips, or a link that lands
// elsewhere, fails the index check.
// ============================================================================
const fs = require('node:fs');
const zlib = require('node:zlib');
const { BASE, launchBrowser, requireServer, lockAndConfirm, asPlayer } = require('./_shared.cjs');

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

const SECTIONS = ['statement-operating', 'statement-balance', 'statement-underwriting', 'statement-contributions', 'statement-program', 'statement-reinsurance', 'statement-decisions'];
const TITLES = ['Net Income Statement For The Year', 'Balance Sheet at Year-End', 'Underwriting', 'Contributions To The Current Calendar Year - Net of Reinsurance',
  'Program Year Totals - Net of Reinsurance', 'Reinsurance Information - Program Year Totals', 'Decisions'];
const FULL = { WC: "Workers' Compensation", GL: 'General Liability', Property: 'Property' };
const AGG = { 'agg-110-50': '110% / 50%', 'agg-125-50': '125% / 50%', 'agg-150-50': '150% / 50%' };

// ---- what a recorded decision reads as, from the record alone ----
const pct0 = v => `${Math.round(v * 100)}%`;
const pct1 = v => `${(v * 100).toFixed(1)}%`;
const k$ = v => { const n = Math.round(v / 1000); return `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')}`; };
const LINE_EXPECT = {
  funding: d => (d.fundingAtExpected ? 'Expected' : pct0(d.fundingConfidenceLevel)),
  nonRenewal: d => pct0(d.nonRenewal ?? 0),
  newMembers: d => pct0(d.newMembers ?? 0),
  perClaimCover: d => (d.reinsuranceOption === 'none' ? 'None' : d.reinsuranceOption),
  aggregateCover: d => (!d.aggregateCover || d.aggregateCover === 'none' ? 'None' : AGG[d.aggregateCover] ?? d.aggregateCover),
  riskControl: d => pct1(d.riskControlIncentivePct ?? 0),
  dividendAssessment: d => k$((d.dividendAmount ?? 0) - (d.assessmentAmount ?? 0)),
};
const POOL_EXPECT = { cash: a => pct0(a.cashPct / 100), bonds: a => pct0(a.bondsPct / 100), equities: a => pct0(a.equitiesPct / 100) };

/** The Decisions table on screen: key -> calendar year -> text; and the years its header shows. */
async function screenTable(page) {
  return page.evaluate(() => {
    const sec = document.querySelector('[data-testid="statement-decisions"]');
    if (!sec) return null;
    const years = [...sec.querySelectorAll('tr[data-row-kind="header"] th')].map(th => th.textContent.trim()).filter(t => /^\d{4}$/.test(t));
    const rows = {};
    for (const tr of sec.querySelectorAll('tr[data-decision-key]')) {
      rows[tr.dataset.decisionKey] = Object.fromEntries([...tr.querySelectorAll('td[data-decision-year]')].map(td => [td.dataset.decisionYear, td.textContent.trim()]));
    }
    const headings = [...sec.querySelectorAll('tr[data-row-kind="heading"]')].map(tr => tr.textContent.trim());
    return { years, rows, headings };
  });
}

/**
 * The table against the record. `record(calendarYear)` gives a played year's
 * { byLine: {line: LineDecisionSet}, assetAllocation } or null for a history
 * year (those must be filled, not compared here — statement-decisions-check
 * reads them against the engine's record).
 */
function tableDiffs(t, lines, pool, record) {
  const out = [];
  if (!t) return ['no Decisions section'];
  const wantKeys = [...(pool ? Object.keys(POOL_EXPECT).map(k => `pool.${k}`) : []), ...lines.flatMap(l => Object.keys(LINE_EXPECT).map(k => `${l}.${k}`))];
  if (JSON.stringify(Object.keys(t.rows)) !== JSON.stringify(wantKeys)) out.push(`rows ${Object.keys(t.rows).join(',')} ≠ ${wantKeys.join(',')}`);
  let played = 0;
  for (const key of wantKeys) {
    const [who, what] = key.split('.');
    const row = t.rows[key] ?? {};
    if ((row.prior ?? '') !== '') out.push(`${key}: Prior "${row.prior}"`);
    for (const y of t.years) {
      const got = row[y];
      const rec = record(Number(y));
      if (!rec) { if (!got) out.push(`${key} ${y} (history): blank`); continue; }
      played++;
      const want = who === 'pool' ? POOL_EXPECT[what](rec.assetAllocation) : LINE_EXPECT[what](rec.byLine[who]);
      if (got !== want) out.push(`${key} ${y}: "${got}" ≠ recorded "${want}"`);
    }
  }
  if (played === 0) out.push('no played year compared');
  return out;
}

async function openStatement(page, view = 'Pool') {
  await page.getByRole('button', { name: 'Annual Statement', exact: true }).first().click();
  await page.waitForSelector('[data-testid="statement-decisions"]', { timeout: 30000 });
  await page.getByRole('button', { name: view, exact: true }).first().click();
  await page.waitForTimeout(600);
}

/** Move a line's Non-Renewal one step right (the Decisions tab must be open). */
async function bumpNonRenewal(page) {
  // Non-Renewal is a line's decision: on the first line's view.
  const first = page.getByRole('button', { name: /^(Workers' Compensation|General Liability|Property)$/ }).first();
  await first.click();
  await page.waitForTimeout(300);
  const slider = page.locator('span', { hasText: /^Non-Renewal$/ }).first()
    .locator('xpath=ancestor::div[contains(@class,"flex-col")][1]').locator('input[type="range"]');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
}

/** The index, at the page's current width: every link, each landing its section, the current marked, sticky. */
async function indexChecks(page, tag) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const links = await page.$$eval('[data-testid="statement-index"] a', as => as.map(a => ({ id: a.getAttribute('href').slice(1), text: a.textContent.trim() })));
  ok(JSON.stringify(links.map(l => l.id)) === JSON.stringify(SECTIONS) && JSON.stringify(links.map(l => l.text)) === JSON.stringify(TITLES),
    `${tag}: the index links every section in order, Decisions last`, links.map(l => l.text).join(' | '));
  const landed = [];
  for (const id of SECTIONS) {
    await page.click(`[data-testid="statement-index-${id}"]`);
    await page.waitForTimeout(1200);
    const r = await page.evaluate(i => {
      const nav = document.querySelector('[data-testid="statement-index"]');
      const n = nav.getBoundingClientRect(), stuckTop = parseFloat(getComputedStyle(nav).top);
      const wide = window.matchMedia('(min-width: 1024px)').matches;
      const line = wide ? stuckTop : stuckTop + n.height;
      const top = document.getElementById(i).getBoundingClientRect().top;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const current = [...nav.querySelectorAll('a[aria-current="location"]')].map(a => a.getAttribute('href').slice(1));
      return { top, line, atBottom, current, navTop: n.top, stuckTop, visible: top < window.innerHeight };
    }, id);
    const placed = Math.abs(r.top - r.line) <= 16 || (r.atBottom && r.top >= r.line - 16 && r.visible);
    landed.push({ id, placed, ...r });
  }
  const bad = landed.filter(l => !l.placed || l.current.join() !== l.id);
  ok(bad.length === 0, `${tag}: each link brings its section to the top, under the bars, and marks itself current`,
    bad.map(b => `${b.id}: top ${Math.round(b.top)} vs ${Math.round(b.line)}, current ${b.current.join()}`).join(' · ') || `${landed.length} sections`);
  ok(landed.every(l => Math.abs(l.navTop - l.stuckTop) <= 1), `${tag}: the index stays in place while the page scrolls`,
    landed.map(l => Math.round(l.navTop)).join(','));
  // Scrolling by hand: to the Balance Sheet, then to the very bottom.
  const mid = await page.evaluate(() => { const el = document.getElementById('statement-balance'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 300); return true; });
  await page.waitForTimeout(500);
  const bottom = async () => { await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(500); };
  const curAt = () => page.$$eval('[data-testid="statement-index"] a[aria-current="location"]', as => as.map(a => a.getAttribute('href').slice(1)).join());
  const midCur = mid && await curAt();
  await bottom();
  const endCur = await curAt();
  ok(SECTIONS.includes(midCur) && endCur === 'statement-decisions', `${tag}: scrolling by hand moves the highlight — mid-page a section, at the bottom Decisions`, `${midCur} → ${endCur}`);
}

async function readSave(page) {
  const raw = await page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.startsWith('riskpool_gamestate_')); return k ? localStorage.getItem(k) : null; });
  if (!raw) return null;
  const env = JSON.parse(zlib.inflateRawSync(Buffer.from(raw, 'base64')).toString('utf8'));
  return env.gameState ?? env;
}
async function lockSolo(page, next) {
  await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
  await bumpNonRenewal(page);
  await lockAndConfirm(page);
  await page.waitForTimeout(2500);
  const decline = page.getByRole('button', { name: /Decline/i }).first();
  if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
  const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
  if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
  await page.waitForSelector(`text=Lock Program Year ${2026 + next}`, { timeout: 120000 });
}

async function soloGame(browser, testPlayer, errs) {
  const tag = testPlayer ? 'Test player' : 'Single player';
  const page = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } })).newPage();
  page.on('pageerror', e => errs.push(`${tag}: ${e.message}`));
  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption('5');
  for (const label of Object.values(FULL)) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
  if (testPlayer) {
    await page.getByRole('button', { name: 'Test player', exact: true }).click();
    await page.waitForSelector('[data-testid="test-player-setup"]', { timeout: 20000 });
    await page.click('[data-testid="start-test-player"]');
  } else {
    await page.getByRole('button', { name: 'Single player', exact: true }).click();
  }
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });

  // At the start: every column a history year, every cell filled.
  await openStatement(page);
  const t0 = await screenTable(page);
  ok(tableDiffs(t0, Object.keys(FULL), true, () => null).filter(d => d !== 'no played year compared').length === 0 && t0.years.every(y => Number(y) < 2027),
    `${tag}, at the start: Decisions shows the history years, the prior board's decisions in every cell`, t0?.years.join(', '));

  await lockSolo(page, 2);
  await lockSolo(page, 3);
  const save = await readSave(page);
  const start = save.setup.startingYear;
  const record = y => {
    const r = (save.lockedResults ?? []).find(x => x.calendarYear === y);
    return r ? { byLine: Object.fromEntries(Object.keys(r.byLine).map(l => [l, r.byLine[l].decisions])), assetAllocation: r.pool.assetAllocation } : null;
  };
  ok(record(start)?.byLine.WC.nonRenewal !== record(start + 1)?.byLine.WC.nonRenewal, `${tag}: the two played years were locked on different Non-Renewal`,
    `${record(start)?.byLine.WC.nonRenewal} / ${record(start + 1)?.byLine.WC.nonRenewal}`);
  await openStatement(page);
  const tp = await screenTable(page);
  const dp = tableDiffs(tp, save.setup.activeLines, true, record);
  ok(dp.length === 0, `${tag}, Pool view after two years: the asset mix and each line's decisions are the save's record, year by year`, dp.slice(0, 3).join(' · ') || tp.years.join(', '));
  ok(JSON.stringify(tp.headings) === JSON.stringify(['Pool-Wide: Asset Mix', ...save.setup.activeLines.map(l => FULL[l])]), `${tag}, Pool view: the asset mix, then each line by name`, tp.headings.join(' | '));
  await openStatement(page, FULL.GL);
  const tl = await screenTable(page);
  const dl = tableDiffs(tl, ['GL'], false, record);
  ok(dl.length === 0 && tl.headings.length === 0, `${tag}, General Liability view: GL's decisions alone, the save's record`, dl.slice(0, 3).join(' · '));
  // A column off fails: the table read one year to the left must not match.
  const shifted = { ...tp, rows: Object.fromEntries(Object.entries(tp.rows).map(([k, r]) => [k, Object.fromEntries(tp.years.map((y, i) => [y, r[tp.years[i - 1]] ?? '']))])) };
  ok(tableDiffs(shifted, save.setup.activeLines, true, record).length > 0, `${tag}: control — the table one year off fails the record check`);

  await openStatement(page);
  await indexChecks(page, `${tag}, desktop`);
  await page.context().close();
}

(async () => {
  await requireServer();
  const errs = [];
  const adminToken = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  const solo = await launchBrowser();
  if (adminToken) process.env.ADMIN_TOKEN = adminToken;

  console.log('\nSingle player');
  await soloGame(solo, false, errs);
  console.log('\nTest player');
  await soloGame(solo, true, errs);

  // ---- phone width: the index along the top, the page not scrolling sideways ----
  console.log('\nPhone width');
  {
    const page = await (await solo.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })).newPage();
    page.on('pageerror', e => errs.push(`phone: ${e.message}`));
    await page.goto('/solo');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
    await page.getByRole('button', { name: 'Single player', exact: true }).click();
    await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
    await openStatement(page);
    const shape = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="statement-index"]').getBoundingClientRect();
      return { w: nav.width, h: nav.height, pageW: document.documentElement.scrollWidth, vw: window.innerWidth };
    });
    ok(shape.h < 80 && shape.w <= shape.vw + 1, 'phone: the index is one bar along the top, within the screen', `${Math.round(shape.w)}x${Math.round(shape.h)}`);
    ok(shape.pageW <= shape.vw + 1, 'phone: the page does not scroll sideways (the tables scroll in their own boxes)', `${shape.pageW} vs ${shape.vw}`);
    await indexChecks(page, 'phone');
    await page.context().close();
  }
  await solo.close();

  // ---- hosted: a team's statement against the room's stored decisions ----
  console.log('\nHosted');
  if (!process.env.ADMIN_TOKEN) ok(false, 'hosted: ADMIN_TOKEN is set (hosting needs an admin)');
  else {
    const browser = await launchBrowser();
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 } });
    const host = await ctx.newPage();
    host.on('pageerror', e => errs.push(`host: ${e.message}`));
    await host.goto('/host');
    await host.waitForSelector('[data-testid="create-room"]');
    await host.fill('[data-testid="event-name"]', 'Statement Decisions');
    await host.selectOption('[data-testid="seed"]', '7');
    await host.fill('[data-testid="year-count"]', '3');
    await host.fill('[data-testid="expected-teams"]', '1');
    await host.click('[data-testid="create-room"]');
    await host.waitForSelector('[data-testid="room-code"]');
    const code = (await host.textContent('[data-testid="room-code"]')).trim();
    const team = await ctx.newPage();
    team.on('pageerror', e => errs.push(`team: ${e.message}`));
    await team.goto(`/join/${code}`);
    await team.waitForSelector('[data-testid="team-picker"]');
    await team.fill('[data-testid="team-name"]', 'Harbour Mutual');
    await team.click('[data-testid="join-team"]');
    await team.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
    for (const y of [1, 2]) {
      await team.getByRole('button', { name: 'Decisions', exact: true }).first().click();
      await bumpNonRenewal(team);
      await lockAndConfirm(team);
      await team.waitForSelector('[data-testid="session-strip"][data-lock="locked"]', { timeout: 30000 });
      await host.click('[data-testid="host-tab-setup"]');
      await host.click('[data-testid="advance"]');
      await host.waitForFunction(n => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === String(n), y + 1, { timeout: 30000 });
      // The strip carries the year the team's tab has computed as data-posted-year.
      await team.waitForFunction(yy => document.querySelector('[data-testid="session-strip"]')?.dataset.postedYear === String(yy), y, { timeout: 240000 });
    }
    const room = await host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);
    const t = room.teams.find(x => x.name === 'Harbour Mutual');
    const record = cal => {
      const d = t.decisionsByYear[String(cal - room.startingYear + 1)];
      return d ? { byLine: d.byLine, assetAllocation: d.assetAllocation } : null;
    };
    ok(record(room.startingYear)?.byLine[t.lines[0]].nonRenewal !== record(room.startingYear + 1)?.byLine[t.lines[0]].nonRenewal, 'hosted: the two years were locked on different Non-Renewal');
    await openStatement(team);
    const tt = await screenTable(team);
    const d = tableDiffs(tt, t.lines, true, record);
    ok(d.length === 0, `hosted team, Pool view after two years: every played year's decisions are the room's stored decisions (${t.lines.join(', ')})`, d.slice(0, 3).join(' · ') || tt.years.join(', '));
    await indexChecks(team, 'hosted team, desktop');
    await browser.close();
  }

  ok(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));
  console.log(`\nannual-statement: ${passed}/${passed + failed} checks passed`);
  if (failed) { console.log('FAIL'); process.exit(1); }
  console.log('ANNUAL STATEMENT PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
