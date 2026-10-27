// THE MODEL TAB — what a player sees, and only in single-player.
//
// Solo (scenario 7, three lines, through the real setup screen), after two
// played years, on every line:
//
//   the year dropdown   every priced year, the first pre-game year (2021) to
//                       the coming year
//   section A           for every priced year, the rate the page builds step
//                       by step IS the rate the game charged that year, and
//                       its premium the premium charged; for the coming year,
//                       the rate the Decisions panel quotes. Its rows — pure
//                       premium x CLF, admin, Risk Control, profit &
//                       contingency, reinsurance — add to that rate; the
//                       indicated rate at Expected is the projected pure
//                       premium / the permissible loss ratio; profit &
//                       contingency is the line's (WC 2%, GL 0%, Property 0%); every window year shows its reserve
//                       inflation still to come (1 past the priced years), and
//                       there is no investment income credit
//   section B           every KNOWN year's simulated combined ratio,
//                       investment income and year-end surplus are the Annual
//                       Statement's own, at the statement's precision (0.1%,
//                       $000s); the year just played shows at once (results
//                       run through the year just completed, utils/knownYears),
//                       the coming year does not
//
// to one part in a billion where the two are numbers. Hosted (a room over the
// local transport): the top bar has no Model tab.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/model.cjs
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

const LINES = [['WC', "Workers' Compensation"], ['GL', 'General Liability'], ['Property', 'Property']];
// Profit and contingency by line (pricingParameters' PROFIT_AND_CONTINGENCY_OF_RATE), written out.
const CONTINGENCY = { WC: 0.02, GL: 0, Property: 0 };
const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

// The statement's own formats (resultsStatement.ts, cellText).
const thousands = x => { const r = Math.round(x / 1000); return `${r < 0 ? '−' : ''}${Math.abs(r).toLocaleString('en-US')}`; };
const pct1 = x => `${(x * 100).toFixed(1)}%`.replace(/^-/, '−');

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const errors = [];

  // ---- SOLO ---------------------------------------------------------------
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  page.on('pageerror', e => errors.push(e.message));
  const tab = async name => { await page.getByRole('button', { name: new RegExp(`^${name}$`) }).first().click(); await page.waitForTimeout(500); };
  const lineView = async label => { await page.getByRole('button', { name: label, exact: true }).first().click(); await page.waitForTimeout(400); };
  const value = async sel => {
    const v = await page.getAttribute(sel, 'data-value').catch(() => null);
    return v === null ? NaN : Number(v);
  };

  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption('7');
  for (const [, label] of LINES) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
  await page.getByRole('button', { name: 'Single player', exact: true }).click();
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
  for (const y of [1, 2]) {
    await tab('Decisions');
    await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
    await page.waitForTimeout(2500);
    const decline = page.getByRole('button', { name: /Decline/i }).first();
    // A loan offer, if a line ended the year below zero: declined, then confirmed.
    if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
    const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
    if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
    await page.waitForSelector(`text=Lock Program Year ${2027 + y}`, { timeout: 120000 });
  }

  // The coming year's rate, as the Decisions panel quotes it.
  await tab('Decisions');
  const panel = {};
  for (const [l, label] of LINES) { await lineView(label); panel[l] = await value('[data-testid="new-rate-final"]'); }

  ok(await page.getByRole('button', { name: /^Model$/ }).count() > 0, 'solo: the top bar has the Model tab');
  await tab('Model');
  await page.waitForSelector('[data-testid="model"]', { timeout: 20000 });
  const opts = await page.$$eval('[data-testid="model-year"] option', os => os.map(o => ({ value: Number(o.value), text: o.textContent.trim() })));
  const cal = opts.map(o => Number(o.text.match(/\d{4}/)[0]));
  ok(opts.length === 9 && cal[0] === 2021 && cal[cal.length - 1] === 2029 && cal.every((c, i) => i === 0 || c === cal[i - 1] + 1),
    'solo: the year dropdown runs from the first pre-game year to the coming year', opts.map(o => o.text).join(', '));

  const sim = {};
  for (const [l] of LINES) {
    await page.click(`[data-testid="model-line-${l}"]`);
    await page.waitForFunction(x => document.querySelector('[data-testid="model"]')?.getAttribute('data-line') === x, l);
    let worst = 0, n = 0, bad = '';
    for (const o of opts) {
      await page.selectOption('[data-testid="model-year"]', String(o.value));
      await page.waitForFunction(y => document.querySelector('[data-testid="model"]')?.getAttribute('data-year') === String(y), o.value);
      const rate = await value('[data-testid="model-a-rate"]');
      const premium = await value('[data-testid="model-a-premium"]');
      const charged = await value('[data-testid="model-a-charged-rate"]');
      const chargedPremium = await value('[data-testid="model-a-charged-premium"]');
      const coming = o.value === opts[opts.length - 1].value;
      const want = coming ? panel[l] : charged;
      const pieces = await Promise.all(['pure-premium', 'admin', 'risk-control', 'contingency', 'reins'].map(k => value(`[data-testid="model-a-piece-${k}"]`)));
      const projected = await value('[data-testid="model-a-projected"]');
      const plr = await value('[data-testid="model-a-plr"]');
      const indicated = await value('[data-testid="model-a-indicated"]');
      const contingency = await value('[data-testid="model-a-exp-contingency"]');
      const inflation = await page.$$eval('[data-testid$="-inflation"]', els => els.map(e => Number(e.getAttribute('data-value'))));
      const credit = await page.locator('[data-testid="model-a-credit"]').count();
      const sum = pieces.reduce((x, y) => x + y, 0);
      const structure = near(sum, rate) && near(indicated, projected / plr) && near(contingency, CONTINGENCY[l]) && credit === 0
        && inflation.length > 0 && inflation.every(x => x >= 1);
      if (!structure && !bad) bad = `${o.text}: rows ${sum} vs rate ${rate}; indicated ${indicated} vs ${projected / plr}; contingency ${contingency}; ${inflation.length} inflation cells; credit rows ${credit}`;
      const good = structure && (coming ? near(rate, panel[l]) : near(rate, charged) && near(premium, chargedPremium));
      n++;
      if (!good && !bad) bad = `${o.text}: ${rate} vs ${want}${coming ? ' (panel)' : `, premium ${premium} vs ${chargedPremium}`}`;
      if (!good) worst++;
    }
    ok(worst === 0 && n === opts.length,
      `solo, ${l}: section A's rate is the rate charged on every priced year (and the panel's for the coming year), its premium the premium charged; its rows add to it, the indicated rate is pure premium / permissible loss ratio, the line's contingency, inflation shown, no credit`,
      bad || `${n} years`);

    // Section B's simulated figures, by calendar year: every year but the
    // coming one, which is not played — the one just played shows at once.
    const hidden = cal[cal.length - 1], justPlayed = cal[cal.length - 2];
    ok(await page.$(`[data-testid="model-b-surplus-${hidden}-sim"]`) === null,
      `solo, ${l}: section B has no column for ${hidden}, the coming year, not played`);
    ok(await page.$(`[data-testid="model-b-surplus-${justPlayed}-sim"]`) !== null,
      `solo, ${l}: section B shows ${justPlayed}, the year just played, at once`);
    sim[l] = {};
    for (const c of cal.slice(0, -1)) {
      sim[l][c] = {
        cr: await value(`[data-testid="model-b-combinedRatio-${c}-sim"]`),
        inv: await value(`[data-testid="model-b-investmentIncome-${c}-sim"]`),
        surplus: await value(`[data-testid="model-b-surplus-${c}-sim"]`),
        expCr: await value(`[data-testid="model-b-combinedRatio-${c}-exp"]`),
      };
    }
  }

  // SECTION B against the Annual Statement, year by year and line by line.
  await tab('Annual Statement');
  await page.waitForSelector('[data-testid="annual-statement"]', { timeout: 20000 });
  for (const [l, label] of LINES) {
    await lineView(label);
    let checked = 0, bad = '';
    for (let i = 0; i < opts.length - 1; i++) {
      const c = cal[i];
      await page.selectOption('[data-testid="statement-year"]', String(opts[i].value));
      await page.waitForTimeout(250);
      // The statement's asOf year is its last column (Prior and the five years; no Total).
      const cell = async rowLabel => page.$eval(`[data-testid="annual-statement"] tr[data-row-label="${rowLabel}"]`,
        tr => { const tds = [...tr.querySelectorAll('td')]; return tds[tds.length - 1].textContent.trim(); }).catch(() => null);
      const got = { cr: await cell('Combined Ratio'), inv: await cell('Investment Income'), surplus: await cell('Net Worth') };
      const s = sim[l][c];
      const want = { cr: pct1(s.cr), inv: thousands(s.inv), surplus: thousands(s.surplus) };
      for (const k of ['cr', 'inv', 'surplus']) {
        checked++;
        if (got[k] !== want[k] && !bad) bad = `${c} ${k}: statement ${got[k]} vs model ${want[k]}`;
      }
      if (!Number.isFinite(s.expCr) && !bad) bad = `${c}: no expected combined ratio`;
    }
    ok(!bad && checked === 3 * (opts.length - 1),
      `solo, ${l}: section B's simulated combined ratio, investment income and surplus are the Annual Statement's, every year`,
      bad || `${checked} cells`);
  }

  // ---- HOSTED -------------------------------------------------------------
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  const team = await ctx.newPage();
  for (const p of [host, team]) p.on('pageerror', e => errors.push(e.message));
  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="event-name"]', 'Model');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '1');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  await team.goto(`/join/${code}`);
  await team.waitForSelector('[data-testid="team-picker"]');
  await team.fill('[data-testid="team-name"]', 'Harbour Mutual');
  await team.click('[data-testid="join-team"]');
  await team.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  await team.waitForSelector('button:has-text("Rate Indication")', { timeout: 60000 });
  ok(await team.getByRole('button', { name: /^Model$/ }).count() === 0 && await team.locator('[data-testid="model"]').count() === 0,
    'hosted: the top bar has no Model tab, and the page is not rendered');

  ok(errors.length === 0, 'no page errors', errors[0] ?? '');
  await browser.close();
  console.log(`\nmodel: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'MODEL PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
