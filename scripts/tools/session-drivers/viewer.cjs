// THE VIEWER IS THE PLAYER'S SCREEN, READ-ONLY — and its numbers are the
// driver's numbers because they are the same computation, not a copy.
const { BASE, launchBrowser, requireServer, statementPdfDiffs } = require('./_shared.cjs');
const crypto = require('crypto');
const TEAMS = ['Harbour Mutual', 'Cedar Valley'];
// Three played years, checked after each; the room runs one more so year 3 is not its last.
const PLAYED = 3;
const YEARS = PLAYED + 1;

const fails = [];
let checks = 0;
function ok(c, w) { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w); } else console.log('  ok    ' + w); }
const h = s => crypto.createHash('sha256').update(s.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);

async function tabText(page, tab) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(500);
  return page.locator('main').innerText();
}

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  const driver = await ctx.newPage();
  const viewer = await ctx.newPage();
  for (const p of [host, driver, viewer]) p.on('pageerror', e => { fails.push('page error: ' + e.message); console.log('  PAGE ERROR:', e.message); });

  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  // ⚠ THE EVENT NAME IS REQUIRED NOW — a driver that types none gets a
  // dead Create button. It used to default to 'Ripple Game'.
  await host.fill('[data-testid="event-name"]', 'Driver Session');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', String(YEARS));
  await host.fill('[data-testid="expected-teams"]', String(TEAMS.length));
  // ⚠ THE HOST SETS THE LINES NOW. Every team in this room used to click WC
  // for itself; the room declares it instead, and the picker is gone from the
  // join screen. All three are ticked by default, so WC-only means unticking.
  await host.uncheck('[data-testid="line-GL"]');
  await host.uncheck('[data-testid="line-Property"]');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\nroom ${code}\n`);

  // driver claims Harbour Mutual
  await driver.goto(`/join/${code}`);
  await driver.waitForSelector('[data-testid="team-picker"]');
  await driver.fill('[data-testid="team-name"]', TEAMS[0]);
  await driver.click('[data-testid="join-team"]');
  await driver.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });

  // viewer watches the SAME team — already claimed, which must be allowed
  await viewer.goto(`/view/${code}`);
  await viewer.waitForSelector(`[data-testid="watch-${TEAMS[0]}"]`, { timeout: 30000 });
  const watchBtn = viewer.locator(`[data-testid="watch-${TEAMS[0]}"]`);
  ok(await watchBtn.isEnabled(), 'a claimed team is still watchable — a viewer claims nothing');
  await watchBtn.click();
  await viewer.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
  ok((await viewer.textContent('[data-testid="watched-team"]')).trim() === TEAMS[0], 'viewer is bound to the team it watches');

  // ---- IT IS THE SAME SCREEN ----------------------------------------------
  // ⚠ 'Membership' CAME OFF: the tab is hidden while the game shows the pool in
  // aggregate. ⚠ AND THE MULTIPLAYER VERSION HIDES Results, Financial Statements
  // and Calculation Audit from players and viewers alike (GameShell's
  // MULTIPLAYER_HIDDEN_TABS). The PAGES are intact. Dashboard and Departments
  // are hidden in both (src/game/tabs.tsx), and Investments; Rate Indication joined.
  const TABS = ['Introduction', 'Rate Indication', 'Annual Statement', 'Decisions',
                'Decision History', 'Result Spreadsheet'];
  const HIDDEN = ['Financial Statements', 'Results', 'Calculation Audit', 'Dashboard', 'Departments', 'Investments'];
  let present = 0;
  for (const t of TABS) if (await viewer.getByRole('button', { name: t, exact: true }).count() > 0) present++;
  ok(present === TABS.length, `viewer has all ${TABS.length} multiplayer tabs (${present}/${TABS.length})`);
  let leaked = 0;
  for (const t of HIDDEN) if (await viewer.getByRole('button', { name: t, exact: true }).count() > 0) leaked++;
  ok(leaked === 0, `the viewer sees none of ${HIDDEN.join(', ')} (${leaked} shown)`);

  // ---- IT CANNOT WRITE -----------------------------------------------------
  ok(await viewer.getByRole('button', { name: /Lock Program Year/ }).count() === 0, 'viewer has NO Lock Program Year button at all');
  ok(await viewer.getByRole('button', { name: 'New Game', exact: true }).count() === 0, 'viewer has no New Game');
  ok(await viewer.getByRole('button', { name: 'Game Setup', exact: true }).count() === 0, 'viewer has no Game Setup tab');

  // decision controls render, and are disabled
  await viewer.getByRole('button', { name: 'Decisions', exact: true }).click();
  await viewer.waitForTimeout(500);
  // Funding confidence and the CLF panel are PER-LINE controls; the Pool view
  // hosts the pool-wide pair. Select the line, as a reader discussing the
  // team's pricing would.
  const wcTab = viewer.getByRole('button', { name: "Workers' Compensation", exact: true }).first();
  if (await wcTab.count() > 0) { await wcTab.click(); await viewer.waitForTimeout(500); }
  const vMain = await viewer.locator('main').innerText();
  ok(vMain.includes('Funding Confidence Level'), 'viewer sees the real decisions page');
  // ⚠ FORKED ON THE BUILD, for the reason full-session.cjs states at the same
  // assertion: under NEW_RATE_STACK the two-column rate panel replaces the
  // funding-consequence panel and "CLF Multiplier" is a retired readout. What
  // this driver is actually asserting — that the VIEWER sees the live priced
  // panel and not a blank — holds either way, so it asks for whichever panel
  // the build renders.
  const vNewPanel = await viewer.$('[data-testid="new-rate-panel"]');
  ok(vNewPanel ? vMain.includes('Expected to surplus') : vMain.includes('CLF Multiplier'),
     `viewer sees the live ${vNewPanel ? 'two-column rate' : 'funding-consequence'} panel`);
  const ranges = await viewer.$$eval('input[type=range]', els => els.map(e => e.disabled));
  ok(ranges.length > 0 && ranges.every(Boolean), `every decision slider is disabled but present (${ranges.length} sliders)`);
  const enabledInputs = await viewer.$$eval('main input:not([type=range]), main select',
    els => els.filter(e => !e.disabled).length);
  ok(enabledInputs === 0, `no enabled decision inputs on the viewer's page (${enabledInputs})`);

  // ---- AFTER EACH OF SEVERAL YEARS: ONE SET OF FIGURES ---------------------
  //
  // ⚠ THE PLAYER, THE VIEWER AND THE HOST PRINT THE SAME FIGURE FOR EVERY YEAR,
  // AS CURRENTLY VALUED. After each played year: the viewer's Annual Statement
  // is the player's, and the newest posted developed column — what the host's
  // as-developed views read — is the statement's Net Ultimates (loss + LAE) for
  // every program year shown, to the statement's own thousand. The driver moves
  // its funding each year, so the replay is checked on decisions that differ.
  const room = () => host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);
  // The Net block of Reinsurance Information, laid out as the template: its
  // header row ("Net", Prior, the five years) and its Total Incurred Loss & LAE —
  // the builder's Net Ultimates, loss + LAE.
  const netUltimates = p => p.$eval('[data-testid="statement-net"]', el => ({
    heads: [...el.querySelectorAll('tr[data-row-kind="header"] th')].map(t => t.textContent.trim()),
    cells: [...el.querySelector('tr[data-row-label="Total Incurred Loss & LAE"]').querySelectorAll('td')].map(t => t.textContent.trim()),
  }));
  const thousands = x => { const r = Math.round(x / 1000); return `${r < 0 ? '−' : ''}${Math.abs(r).toLocaleString('en-US')}`; };

  for (let y = 1; y <= PLAYED; y++) {
    // The driver's own choice this year: the funding slider, a different stop each year.
    await driver.getByRole('button', { name: 'Decisions', exact: true }).click();
    await driver.waitForTimeout(400);
    const dWc = driver.getByRole('button', { name: "Workers' Compensation", exact: true }).first();
    if (await dWc.count() > 0) { await dWc.click(); await driver.waitForTimeout(400); }
    const slider = driver.locator('div.flex.flex-col.gap-2', { has: driver.locator('span', { hasText: /^Funding Confidence Level$/ }) }).first().locator('input[type=range]');
    if (await slider.count() > 0) {
      await slider.focus();
      await driver.keyboard.press('Home');
      for (let i = 0; i < 4 + 2 * y; i++) await driver.keyboard.press('ArrowRight');
      await driver.waitForTimeout(300);
    }

    await driver.getByRole('button', { name: /Lock Program Year/ }).first().click();
    await driver.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
    await host.click('[data-testid="advance"]');
    await host.waitForFunction(n => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === String(n), y + 1, { timeout: 30000 });
    await driver.waitForFunction(n => document.querySelector('[data-testid="posted-year"]')?.textContent.includes(`year ${n} result posted`), y, { timeout: 180000 });
    await viewer.waitForFunction(n => document.querySelector('[data-testid="posted-year"]')?.textContent.includes(`year ${n} result computed`), y, { timeout: 180000 });
    ok(true, `year ${y}: the viewer computed it on its own, from the watched team's decisions`);

    // Mid-turn (the next year open, nobody locked): the viewer reads real results.
    const vResults = await tabText(viewer, 'Annual Statement');
    ok(vResults.length > 200, `year ${y}: mid-turn the viewer reads real results, not a spinner (${vResults.length} chars)`);

    // Both panes on the SAME line view, or the comparison is between two pages.
    for (const p of [driver, viewer]) {
      const pool = p.getByRole('button', { name: 'Pool', exact: true }).first();
      if (await pool.count() > 0) { await pool.click(); await p.waitForTimeout(400); }
    }
    for (const tab of ['Annual Statement', 'Decision History', 'Rate Indication']) {
      const d = await tabText(driver, tab);
      const v = await tabText(viewer, tab);
      ok(h(d) === h(v), `year ${y}, ${tab}: the viewer's is identical to the player's (${h(d)} / ${h(v)})`);
    }

    // The host's figure: the developed column posted at the LATEST KNOWN year,
    // against the player's statement, every program year the statement shows by
    // itself. ⚠ RESULTS SHOW THROUGH THE YEAR JUST COMPLETED (utils/knownYears):
    // with year y just played the statement stands at year y, so it is that
    // year's post — valued then — that it must match, over accident years 0 to
    // y. (It was year y - 1's while results ran a year behind.)
    await tabText(driver, 'Annual Statement');
    // The PDF download in a hosted game, after the last played year: the
    // statement the team's screen shows, at the year it stands at.
    if (y === PLAYED) {
      const pdf = await statementPdfDiffs(driver);
      ok(pdf.length === 0, `year ${y}: a hosted team's "Download Annual Statement (PDF)" gives the screen's statement, at the year it stands at${pdf.length ? ` — ${pdf.slice(0, 2).join(' · ')}` : ''}`);
    }
    const st = await netUltimates(driver);
    const rec = await room();
    const posted = rec.teams.find(t => t.name === TEAMS[0]).resultsByYear[String(y)];
    const year0Calendar = rec.startingYear - 1;
    const compared = [];
    st.heads.forEach((head, i) => {
      if (!/^\d{4}$/.test(head)) return;               // the block's name and Prior are not one year
      const ay = Number(head) - year0Calendar;
      if (ay < 0) return;                               // pre-game years are off the session's axis
      compared.push({ ay, screen: st.cells[i], host: thousands(posted.developed.pool[String(ay)]) });
    });
    ok(compared.length === y + 1 && compared.every(c => c.screen === c.host),
      `year ${y}: the host's as-developed figure is the statement's Net Ultimates for every year — `
      + compared.map(c => `year ${c.ay} ${c.screen}${c.screen === c.host ? '' : ` vs host ${c.host}`}`).join(', '));
  }

  // ---- THE VIEWER NEVER WROTE ---------------------------------------------
  const rec = await host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);
  const team = rec.teams.find(t => t.name === TEAMS[0]);
  ok(rec.viewers.length === 1, `the room records one viewer (${rec.viewers.length})`);
  // The record keeps a result PER YEAR now, so "the viewer wrote nothing" is
  // said more strongly than it was: exactly the played years, all the driver's.
  // The opening position (year 0) is posted at build by the DRIVER too; a viewer
  // posts neither it nor anything else, so the record is exactly those.
  const posted = Object.keys(team.resultsByYear || {}).sort();
  ok(posted.join(',') === [0, ...Array.from({ length: PLAYED }, (_, i) => i + 1)].join(','),
     `the team's posted results are the DRIVER's opening and its ${PLAYED} played years (years ${posted.join(',') || 'none'})`);
  ok(await viewer.$('[data-testid="submit-error"]') === null, 'no transport error on the viewer screen');
  ok(await viewer.$('[data-testid="game-error"]') === null, 'no game error on the viewer screen');

  await browser.close();
  console.log(`\nviewer: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log('VIEWER PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
