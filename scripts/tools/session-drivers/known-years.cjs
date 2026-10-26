// ============================================================================
// RESULTS RUN ONE YEAR BEHIND — what a player and a host can see, a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/known-years.cjs
//
// The pool sits in the current year while the board prices the next, and
// results stop at the LATEST KNOWN YEAR — the current year less one
// (utils/knownYears). A solo game of four years, scenario 7, from Program Year
// 2027: at the start the pool is in 2026, pricing 2027, and the newest result
// is 2025; each lock completes a year, which then shows — 2026 after the first
// (the opening, a pre-game year), 2027 after the second, 2028 after the third;
// at game end the final year, 2030, since it is complete.
//
// At each of those points, on every screen that shows results — the Annual
// Statement, Financial Statements, Results, Result Spreadsheet, Calculation
// Audit and the Model tab's expected-against-simulated section — the newest
// year printed (counting year-ends "12/31/yy" and every option of the page's
// year selector) IS the latest known year: nothing later, and the newly
// completed year present, so a page that stops showing new years fails here
// as surely as one that shows too many. The Annual Statement's newest column
// and its selector's last option are that year; the Results workbook's newest
// column is that year, and the Claims workbook stops there. The top bar shows
// the CURRENT year — 2026 at the start, 2027 after the first lock — and its
// surplus and combined ratio move with every lock.
//
// Hosted (a room of four years, one team): the host's Teams tab names the
// latest known year — nothing before the first advance, the opening (2026)
// after it — and its Charts tab draws a point for every known year, one more at
// every advance; the team's own top bar moves 2026 -> 2027 on the first.
//
// The pages about pricing — Decisions, Decision History, the Rate Indication
// and the Model tab's rate — are not read: they name the program year priced.
// At the end it prints the table of what each screen showed at each point.
//
// T claims (wip/shocks): a third game, solo with shocks on, certain to draw T
// claims — see tClaimsGame.
// ============================================================================
const fs = require('node:fs');
const XLSX = require('xlsx');
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

const START = 2027, LENGTH = 4;
let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

/** Every calendar year a text names, as whole tokens (not the digits of 4.2027 or 311.2031%), and year-ends 12/31/yy. */
function yearsIn(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![\d.,$])(20[2-4]\d)(?![\d.,%])/g)) out.push(Number(m[1]));
  for (const m of text.matchAll(/\b12\/31\/(\d{2})\b/g)) out.push(2000 + Number(m[1]));
  return out;
}
const newestOf = ys => (ys.length ? Math.max(...ys) : null);

const RESULT_TABS = ['Annual Statement', 'Financial Statements', 'Results', 'Result Spreadsheet', 'Calculation Audit'];
const table = [];

async function lockAndDecline(p) {
  await p.getByRole('button', { name: /Lock Program Year/ }).first().click();
  await p.waitForTimeout(2500);
  const decline = p.getByRole('button', { name: /Decline/i }).first();
  if (await decline.count() > 0) {
    await decline.click(); await p.waitForTimeout(600);
    const confirm = p.getByRole('button', { name: /Confirm & Continue/i }).first();
    if (await confirm.count() > 0) { await confirm.click(); await p.waitForTimeout(600); }
  }
}

async function solo(browser) {
  const ctx = await browser.newContext({ baseURL: BASE, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const tab = async name => { await page.getByRole('button', { name, exact: true }).first().click(); await page.waitForTimeout(600); };

  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption('7');
  await page.locator('input[type="range"]').first().fill(String(LENGTH));
  await page.getByRole('button', { name: 'Single player', exact: true }).click();
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });

  async function readExports(known, knownNumber, name, row) {
    for (const [label, kind] of [['Download Results (.xlsx)', 'results'], ['Download Claims (.xlsx)', 'claims']]) {
      const btn = page.getByRole('button', { name: label, exact: false }).first();
      if (await btn.count() === 0) { ok(false, `${name}: the ${kind} download is offered`); continue; }
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), btn.click()]);
      const path = dl ? await dl.path() : null;
      if (!path || !fs.existsSync(path)) { ok(false, `${name}: the ${kind} workbook downloads`); continue; }
      const wb = XLSX.readFile(path);
      if (kind === 'results') {
        const heads = wb.SheetNames.flatMap(s => XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1 })[0] ?? []).slice(2);
        const newest = newestOf(heads.flatMap(h => yearsIn(String(h))));
        row['Results download'] = newest;
        ok(newest === known, `${name}: the Results workbook's newest column is ${known}`, `newest ${newest}`);
      } else {
        let worstAy = -Infinity, worstCal = -Infinity, worstVal = -Infinity;
        for (const s of wb.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1 });
          const h = rows.findIndex(r => Array.isArray(r) && r.includes('Accident Year'));
          if (h < 0) continue;
          const head = rows[h];
          const ay = head.indexOf('Accident Year'), cal = head.indexOf('Calendar Year');
          head.forEach(c => { const m = /^Yr (-?\d+)$/.exec(String(c)); if (m) worstVal = Math.max(worstVal, Number(m[1])); });
          for (const r of rows.slice(h + 1)) {
            if (ay >= 0 && typeof r[ay] === 'number') worstAy = Math.max(worstAy, r[ay]);
            if (cal >= 0 && typeof r[cal] === 'number') worstCal = Math.max(worstCal, r[cal]);
          }
        }
        row['Claims download'] = worstAy === -Infinity ? null : START + worstAy - 1;
        ok(worstAy <= knownNumber && worstVal <= knownNumber && worstCal <= known,
          `${name}: the Claims workbook stops at ${known} (year ${knownNumber})`,
          `newest accident year ${worstAy}, valuation Yr ${worstVal}, calendar year ${worstCal}`);
      }
    }
  }

  let before = null;
  async function check(name, known, knownNumber, current, priced) {
    const row = { point: name, 'Top bar year': null, 'Priced': priced };
    // The top bar: the current year, and figures that move with every lock.
    row['Top bar year'] = Number((await page.textContent('[data-testid="header-calendar"]')).trim());
    ok(row['Top bar year'] === current, `${name}: the top bar shows the current year ${current}`, String(row['Top bar year']));
    const figures = (await page.locator('header').innerText()).match(/Surplus\s+(\S+)\s+Combined Ratio\s+(\S+)/)?.slice(1).join(' / ');
    row['Top bar figures'] = figures;
    if (before !== null) ok(figures && figures !== before, `${name}: the top bar's surplus and combined ratio moved with the lock`, `${before} -> ${figures}`);
    before = figures;

    for (const t of RESULT_TABS) {
      await tab(t);
      const main = page.locator('main');
      const text = await main.innerText();
      const options = await main.locator('select option').allInnerTexts();
      const newest = newestOf([...yearsIn(text), ...options.flatMap(yearsIn)]);
      row[t] = newest;
      ok(newest === known, `${name}, ${t}: the newest year shown is ${known} — the year just completed is there, nothing later`, `newest ${newest ?? 'none'}`);
      if (t === 'Annual Statement') {
        const cols = await page.locator('[data-testid="statement-operating"] thead th').allInnerTexts();
        const yearCols = cols.map(c => c.trim()).filter(c => /^\d{4}$/.test(c)).map(Number);
        ok(yearCols.at(-1) === known, `${name}, Annual Statement: its newest column is ${known}`, yearCols.join(' '));
        const opts = await page.locator('[data-testid="statement-year"] option').allInnerTexts();
        const last = yearsIn(opts.at(-1) ?? '');
        ok(last.length > 0 && last[0] === known, `${name}, Annual Statement: the selector offers years up to ${known}`, opts.at(-1));
      }
      if (t === 'Result Spreadsheet') await readExports(known, knownNumber, name, row);
    }
    await tab('Model');
    const ids = await page.$$eval('[data-testid^="model-b-"]', els => els.map(e => e.getAttribute('data-testid')));
    const modelYears = ids.map(id => Number((/-(\d{4})-(?:exp|sim)$/.exec(id) ?? [])[1])).filter(Number.isFinite);
    row['Model (section B)'] = newestOf(modelYears);
    ok(row['Model (section B)'] === known, `${name}, Model: expected against simulated stops at ${known}`, `newest ${row['Model (section B)']}`);
    table.push(row);
  }

  // In 2026 pricing 2027: through 2025 (year -1). Each lock completes a year, which then shows.
  for (let n = 1; n <= LENGTH; n++) {
    const locks = n - 1;
    const name = locks === 0 ? 'start' : `after ${locks} lock${locks > 1 ? 's' : ''}`;
    await check(name, START + n - 3, n - 2, START + n - 2, START + n - 1);
    await lockAndDecline(page);
    if (n < LENGTH) await page.waitForSelector(`text=Lock Program Year ${START + n}`, { timeout: 120000 });
    else await page.waitForSelector('text=Game Complete', { timeout: 120000 });
  }
  // The game is over: the final year shows, since it is complete.
  await check(`game end (${LENGTH} locks)`, START + LENGTH - 1, LENGTH, START + LENGTH - 1, '—');
  ok(errors.length === 0, 'solo: no page errors', errors[0] ?? '');
  await ctx.close();
}

// ============================================================================
// T CLAIMS (wip/shocks) — a shocks-on solo game CERTAIN to have them. Scenario
// 16 over five years draws (single player, catalogue odds) a Wildfire in year
// 2 — ONE Property T claim — and a Social Inflation in year 5 — one GL T
// claim; the end workbook must hold exactly those, so a changed draw fails here
// by name rather than passing on an empty workbook. At every point the Claims
// workbook's T claims (its rows with an Event) are exactly the game's T claims
// from known years — every one, none from after the latest known year — and at
// game end the final year's appears. THE CONTROL: after the second lock year 2
// is played and is the year in progress; its claim exists (the end workbook
// has it) but must be absent, and must appear after the third.
// ============================================================================
const T_SCENARIO = '16', T_LENGTH = 5;
const T_EXPECTED = [{ sheet: /Property/, ay: 2 }, { sheet: /General Liability|GL/, ay: 5 }];

async function tClaimsGame(browser) {
  const ctx = await browser.newContext({ baseURL: BASE, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const tab = async name => { await page.getByRole('button', { name, exact: true }).first().click(); await page.waitForTimeout(600); };
  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption(T_SCENARIO);
  // All three lines: single player opens on WC alone, which no T claim here reaches.
  for (const label of ["Workers' Compensation", 'General Liability', 'Property']) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
  await page.locator('input[type="range"]').first().fill(String(T_LENGTH));
  await page.getByRole('button', { name: 'Single player', exact: true }).click();
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });

  /** The Claims workbook's T claims: its rows whose Event names an event. */
  async function tClaims() {
    await tab('Result Spreadsheet');
    const btn = page.getByRole('button', { name: 'Download Claims (.xlsx)', exact: false }).first();
    if (await btn.count() === 0) return null;
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), btn.click()]);
    const path = dl ? await dl.path() : null;
    if (!path || !fs.existsSync(path)) return null;
    if (process.env.KNOWN_YEARS_KEEP) fs.copyFileSync(path, process.env.KNOWN_YEARS_KEEP);
    const wb = XLSX.readFile(path);
    const out = [];
    for (const sheet of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1 });
      const h = rows.findIndex(r => Array.isArray(r) && r.includes('Accident Year') && r.includes('Event'));
      if (h < 0) continue;
      const [id, ay, ev] = ['Claim ID', 'Accident Year', 'Event'].map(c => rows[h].indexOf(c));
      for (const r of rows.slice(h + 1)) {
        if (typeof r[ay] === 'number' && r[ev] !== undefined && String(r[ev]).trim() !== '') {
          out.push({ sheet, id: String(r[id]), ay: r[ay], event: String(r[ev]) });
        }
      }
    }
    return out;
  }

  // Three lines can need a loan at once: decline every offer, then confirm —
  // through the DOM, since a tall dialog puts Confirm & Continue off the viewport.
  async function lockDecliningAll() {
    await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
    await page.waitForTimeout(2500);
    const declines = page.getByRole('button', { name: /Decline/i });
    for (let i = 0; i < await declines.count(); i++) { await declines.nth(i).dispatchEvent('click'); await page.waitForTimeout(300); }
    const confirm = page.getByRole('button', { name: /Confirm & Continue/i }).first();
    if (await confirm.count() > 0) { await confirm.dispatchEvent('click'); await page.waitForTimeout(600); }
  }

  const points = [];   // after each lock: the latest known year (number) and the T claims listed
  for (let n = 1; n <= T_LENGTH; n++) {
    points.push({ name: `T game, after ${n - 1} lock${n - 1 === 1 ? '' : 's'}`, known: n - 2, claims: await tClaims() });
    await lockDecliningAll();
    if (n < T_LENGTH) await page.waitForSelector(`text=Lock Program Year ${START + n}`, { timeout: 120000 });
    else await page.waitForSelector('text=Game Complete', { timeout: 120000 });
  }
  const end = await tClaims();
  ok(end !== null, 'T game, game end: the Claims workbook downloads');
  const all = end ?? [];
  for (const e of T_EXPECTED) {
    const hit = all.filter(c => e.sheet.test(c.sheet) && c.ay === e.ay);
    ok(hit.length === 1, `T game, game end: one T claim on ${e.sheet.source}, accident year ${e.ay}`,
      hit.map(c => `${c.id} (${c.event})`).join(', ') || 'none');
  }
  ok(all.length === T_EXPECTED.length, `T game, game end: the T claims are exactly the draw's`,
    all.map(c => `${c.sheet} y${c.ay} ${c.event}`).join(' · ') || 'none');
  ok(all.some(c => c.ay === T_LENGTH), `T game, game end: the final year's (year ${T_LENGTH}) T claim appears`);
  const key = c => `${c.sheet}|${c.id}`;
  for (const p of points) {
    if (p.claims === null) { ok(false, `${p.name}: the Claims workbook downloads`); continue; }
    const want = all.filter(c => c.ay <= p.known).map(key).sort();
    const got = p.claims.map(key).sort();
    ok(JSON.stringify(got) === JSON.stringify(want),
      `${p.name}: lists every T claim from known years (through year ${p.known}), and only those`,
      `listed ${got.length}, known ${want.length}`);
    ok(p.claims.every(c => c.ay <= p.known), `${p.name}: no T claim after year ${p.known}`,
      `newest ${p.claims.length ? Math.max(...p.claims.map(c => c.ay)) : 'none'}`);
  }
  const y2 = all.filter(c => c.ay === 2).map(key);
  const inProgress = points.find(p => p.known === 1), next = points.find(p => p.known === 2);
  ok(y2.length === 1 && !!inProgress?.claims && !inProgress.claims.some(c => y2.includes(key(c))),
    'control: after the second lock, year 2 is the year in progress and its T claim is absent');
  ok(y2.length === 1 && !!next?.claims && next.claims.some(c => y2.includes(key(c))),
    'control: after the third, year 2 is known and its T claim appears');
  ok(errors.length === 0, 'T game: no page errors', errors[0] ?? '');
  await ctx.close();
}

async function hosted(browser) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  const errors = [];
  host.on('pageerror', e => errors.push(e.message));
  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="event-name"]', 'Known Years');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', String(LENGTH));
  await host.fill('[data-testid="expected-teams"]', '1');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  const team = await ctx.newPage();
  team.on('pageerror', e => errors.push(e.message));
  await team.goto(`/join/${code}`);
  await team.waitForSelector('[data-testid="team-picker"]');
  await team.fill('[data-testid="team-name"]', 'Harbour Mutual');
  await team.click('[data-testid="join-team"]');
  await team.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  await host.waitForFunction(c => {
    const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
    return !!r && r.teams.length === 1 && !!(r.teams[0].resultsByYear || {})['0'];
  }, code, { timeout: 240000 });

  const COLOR = '#2a78d6';   // the first team's
  async function check(name, known, current) {
    const row = table.find(r => r.point === name) ?? {};
    await team.waitForSelector('[data-testid="header-calendar"]', { timeout: 60000 });
    const teamYear = Number((await team.textContent('[data-testid="header-calendar"]')).trim());
    ok(teamYear === current, `hosted, ${name}: the team's top bar shows the current year ${current}`, String(teamYear));
    await host.click('[data-testid="host-tab-teams"]');
    await host.waitForTimeout(800);
    const teamsYear = (await host.textContent('[data-testid="teams-year"]')).trim();
    const shown = newestOf(yearsIn(teamsYear));
    row['Host Teams tab'] = shown ?? '—';
    ok(known < START - 1 ? /No results known yet/.test(teamsYear) : shown === known,
      `hosted, ${name}: the host's Teams tab names the latest known year`, teamsYear);
    await host.click('[data-testid="host-tab-charts"]');
    await host.waitForTimeout(800);
    const marks = await host.$$eval('[data-testid="chart-surplus"] circle', (els, c) =>
      els.filter(e => e.getAttribute('fill') === c && e.getAttribute('r') === '4').length, COLOR).catch(() => 0);
    const want = Math.max(0, known - (START - 1) + 1);   // the opening (2026) is the first post
    row['Host Charts tab'] = marks ? START - 1 + marks - 1 : '—';
    ok(marks === want, `hosted, ${name}: the host's Charts tab draws a point for every known year`, `${marks} of ${want}`);
  }

  for (let n = 1; n <= LENGTH; n++) {
    const locks = n - 1;
    const name = locks === 0 ? 'start' : `after ${locks} lock${locks > 1 ? 's' : ''}`;
    await check(name, START + n - 3, START + n - 2);
    await team.getByRole('button', { name: /Lock Program Year/ }).first().click();
    await team.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
    await host.click('[data-testid="host-tab-setup"]');
    await host.waitForTimeout(300);
    await host.click('[data-testid="advance"]');
    await team.waitForFunction(y => document.querySelector('[data-testid="posted-year"]')?.textContent.includes(`year ${y} result posted`), n, { timeout: 180000 });
    await host.waitForFunction(([c, y]) => {
      const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
      return !!r && !!(r.teams[0].resultsByYear || {})[String(y)];
    }, [code, n], { timeout: 180000 });
  }
  await check(`game end (${LENGTH} locks)`, START + LENGTH - 1, START + LENGTH - 1);
  ok(errors.length === 0, 'hosted: no page errors', errors[0] ?? '');
  await ctx.close();
}

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  await solo(browser);
  await hosted(browser);
  await tClaimsGame(browser);
  await browser.close();

  const cols = ['point', 'Top bar year', 'Priced', ...RESULT_TABS, 'Model (section B)', 'Results download', 'Claims download', 'Host Teams tab', 'Host Charts tab', 'Top bar figures'];
  console.log('\n' + cols.join(' | '));
  for (const r of table) console.log(cols.map(c => r[c] ?? '—').join(' | '));
  console.log(`\nknown-years: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'KNOWN YEARS PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
