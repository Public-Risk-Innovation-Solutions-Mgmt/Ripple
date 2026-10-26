// The Teams tab: three states at once, on three line views.
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');
const fails = [];
let checks = 0;
function ok(c, w) { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w); } else console.log('  ok    ' + w); }

async function join(ctx, code, name, line) {
  const p = await ctx.newPage();
  await p.goto(`/join/${code}`);
  await p.waitForSelector('[data-testid="team-picker"]');
  await p.fill('[data-testid="team-name"]', name);
  await p.click('[data-testid="join-team"]');
  await p.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
  return p;
}

// Read the Teams table as {team: cells}. The first cell is the team's name alone.
const readTable = page => page.$$eval('[data-testid="teams-table"] tr', rows =>
  Object.fromEntries(rows.map(r => {
    const cells = [...r.children].map(c => c.textContent.trim());
    return [cells[0], cells.slice(1)];
  })));
const COLUMNS = ['Team', 'Market share', 'Combined ratio', 'Surplus', 'Premium to surplus', 'Rate', 'Funding', 'Ripple Score'];
const RATE = /^\$\d+\.\d{2}( \([+−]\d+\.\d%\))?$/;

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  const errs = [];
  host.on('pageerror', e => errs.push(e.message));

  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  // ⚠ THE EVENT NAME IS REQUIRED NOW — a driver that types none gets a
  // dead Create button. It used to default to 'Ripple Game'.
  await host.fill('[data-testid="event-name"]', 'Driver Session');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '3');
  // ⚠ THE HOST SETS THE LINES NOW, AND THIS ROOM NEEDS TWO OF THEM. Teams used
  // to pick their own, so this driver had a WC-only team and a GL-only team and
  // checked that each read ABSENT in the other's view. They cannot differ any
  // more, so the ROOM plays WC + GL and every team writes both — which is what
  // the ABSENT assertions below became.
  await host.uncheck('[data-testid="line-Property"]');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\nroom ${code}\n`);

  // Tab exists and is gated before a room... (we already have one, so just check it is there)
  ok(await host.$('[data-testid="host-tab-teams"]') !== null, 'the Teams tab exists on the host screen');

  // Before any year: the table should say so rather than blank.
  await host.click('[data-testid="host-tab-teams"]');
  await host.waitForTimeout(500);
  ok((await host.textContent('[data-testid="teams-empty"]')).includes('No teams'), 'with no teams it says so');

  const wcTeam = await join(ctx, code, 'Harbour Mutual', 'WC');
  const glTeam = await join(ctx, code, 'Cedar Valley', 'GL');
  const slow   = await join(ctx, code, 'Tri-County', 'WC');

  await host.waitForFunction(() => document.querySelectorAll('[data-testid="teams-table"] tr').length === 3, null, { timeout: 30000 });
  // ⚠ RESULTS SHOW THROUGH THE YEAR JUST COMPLETED (utils/knownYears): before
  // any advance that is 2026, the opening every team posts when it builds its
  // game — so the table shows it from the start. (It said "No results known
  // yet" while results ran a year behind.)
  await host.waitForFunction(() => document.querySelectorAll('[data-testid^="surplus-"]').length === 3, null, { timeout: 60000 });
  const y0 = await host.textContent('[data-testid="teams-year"]');
  ok(/^Results for 2026$/.test(y0.trim()), `before any advance the opening, 2026, is the latest known year: "${y0.trim()}"`);
  ok(await host.$('[data-testid="surplus-Harbour Mutual"]') !== null && await host.$('[data-testid="pending-Harbour Mutual"]') === null,
    'and every team shows its opening figures, not pending');

  // Two teams lock and play; the third is closed so it never computes or posts.
  for (const p of [wcTeam, glTeam]) {
    await p.getByRole('button', { name: /Lock Program Year/ }).first().click();
    await p.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
  }
  await slow.close();

  await host.click('[data-testid="host-tab-setup"]');
  await host.waitForTimeout(300);
  await host.click('[data-testid="advance"]');
  await host.waitForFunction(() => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === '2', null, { timeout: 30000 });
  for (const p of [wcTeam, glTeam]) {
    await p.waitForFunction(() => /year 1 result posted/.test(document.querySelector('[data-testid="posted-year"]')?.textContent || ''), null, { timeout: 180000 });
  }

  // The first advance completes 2027, year 1, and it is the latest known year
  // at once: the two teams that played it show it.
  await host.click('[data-testid="host-tab-teams"]');
  await host.waitForFunction(() => document.querySelectorAll('[data-testid^="surplus-"]').length >= 1, null, { timeout: 30000 });
  const y1 = await host.textContent('[data-testid="teams-year"]');
  ok(/^Results for 2027$/.test(y1.trim()), `after one advance the year just played, 2027, is the latest known year: "${y1.trim()}"`);
  ok(await host.$('[data-testid="surplus-Harbour Mutual"]') !== null, 'and the teams that played it show its figures');

  // A second year: the two live teams lock and post year 2, known at once.
  for (const p of [wcTeam, glTeam]) {
    await p.getByRole('button', { name: /Lock Program Year/ }).first().click();
    await p.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
  }
  await host.click('[data-testid="host-tab-setup"]');
  await host.waitForTimeout(300);
  await host.click('[data-testid="advance"]');
  await host.waitForFunction(() => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === '3', null, { timeout: 30000 });
  for (const p of [wcTeam, glTeam]) {
    await p.waitForFunction(() => /year 2 result posted/.test(document.querySelector('[data-testid="posted-year"]')?.textContent || ''), null, { timeout: 180000 });
  }

  await host.click('[data-testid="host-tab-teams"]');
  // ⚠ WAIT FOR THE FIGURES, NOT FOR A CLOCK. A fixed 900ms sleep here was a bet
  // that the host's next poll would have landed by then — true at a flat three
  // seconds, and a coin toss once the poll backs off while the room is quiet.
  // The condition is what the assertion is about, so the condition is what this
  // waits on; the sleep was measuring the poller rather than the table.
  await host.waitForFunction(() => document.querySelectorAll('[data-testid^="surplus-"]').length >= 1,
    null, { timeout: 30000 });
  const yr = await host.textContent('[data-testid="teams-year"]');
  ok(/^Results for 2028$/.test(yr.trim()), `after the second advance one heading line names the latest KNOWN year, the one just played: "${yr.trim()}"`);
  const heads = await host.$$eval('[data-testid="teams-table"]', ([t]) => [...t.closest('table').querySelectorAll('thead th')].map(h => h.textContent.trim()));
  ok(JSON.stringify(heads) === JSON.stringify(COLUMNS), `the columns, in order: ${heads.join(' · ')}`);
  ok(await host.$('[data-testid="teams-shares-year"]') === null, 'and no second heading line');

  const views = await host.$$eval('nav button, [role="tablist"] button', b => b.map(x => x.textContent.trim()));
  console.log('  line-view bar :', views.filter(v => /Pool|Compensation|Liability|Property/.test(v)));

  for (const [label, sel] of [['Pool', 'Pool'], ['WC', "Workers' Compensation"], ['GL', 'General Liability']]) {
    await host.getByRole('button', { name: sel, exact: true }).first().click();
    // The view switch is local state, so this only waits for React to paint.
    await host.waitForTimeout(250);
    const t = await readTable(host);
    console.log(`\n  --- ${label} view ---`);
    for (const [name, cells] of Object.entries(t)) console.log(`    ${name.padEnd(18)} ${cells.join(' | ')}`);
    if (label === 'WC') {
      // ⚠ NO TEAM IS ABSENT ANY MORE, AND THAT IS THE ASSERTION. ABSENT meant
      // "this team does not write this line", which was reachable only while
      // teams chose their own. The room's lines are universal, so every team
      // writes every line the room plays — and a team that somehow did not
      // would fail here.
      ok(await host.$('[data-testid="absent-Cedar Valley"]') === null, 'WC view: no team is ABSENT — the room\'s lines are universal');
      ok(await host.$('[data-testid="pending-Tri-County"]') !== null, 'WC view: the team that never reported reads PENDING');
      ok(await host.$('[data-testid="surplus-Harbour Mutual"]') !== null, 'WC view: the reporting team shows figures');
      const pnd = (await host.textContent('[data-testid="pending-Tri-County"]')).trim();
      ok(!/^0|—$/.test(pnd), `pending "${pnd}" is a state, not a number`);
      const rate = (await host.textContent('[data-testid="rate-Harbour Mutual"]')).trim();
      ok(RATE.test(rate) && /\(/.test(rate), `WC view: the rate per $100 with this year's change beside it ("${rate}")`);
      const fund = (await host.textContent('[data-testid="funding-Harbour Mutual"]')).trim();
      ok(fund === 'Expected', `WC view: a team funding at Expected reads "Expected", not its slider's 60% ("${fund}")`);
    }
    if (label === 'GL') {
      ok(await host.$('[data-testid="absent-Harbour Mutual"]') === null, 'GL view: no team is ABSENT either');
      ok(await host.$('[data-testid="surplus-Cedar Valley"]') !== null, 'GL view: the GL team shows figures');
    }
    if (label === 'Pool') {
      ok(await host.$('[data-testid="surplus-Harbour Mutual"]') !== null, 'Pool view: reporting teams show the aggregate');
      // THE NAME ALONE — a team once read "TWC+GL+Property", its lines run onto its name.
      const name = (await host.textContent('[data-testid="name-Harbour Mutual"]')).trim();
      ok(name === 'Harbour Mutual', `Pool view: the team column is the name alone ("${name}")`);
      const cr = (await host.textContent('[data-testid="cr-Harbour Mutual"]')).trim();
      ok(/^\d+\.\d%$/.test(cr), `Pool view: the combined ratio since the game began ("${cr}")`);
      // AND IT IS THE TEAM'S OWN: its top bar stands at the same latest known year.
      const teamCr = (await wcTeam.locator('header').innerText()).match(/Combined Ratio\s+(\S+)/)?.[1];
      ok(teamCr === cr, `Pool view: the host's combined ratio is the team's own top-bar figure (${cr} vs ${teamCr})`);
      const pts = (await host.textContent('[data-testid="pts-Harbour Mutual"]')).trim();
      ok(/^\d+\.\d{2}$/.test(pts), `Pool view: premium to surplus ("${pts}")`);
      const rates = await host.$$eval('[data-testid="rate-Harbour Mutual"] span.block', els => els.map(e => e.textContent.trim()));
      ok(rates.length === 2 && rates.every((r, i) => r.startsWith(['WC ', 'GL '][i]) && RATE.test(r.slice(3))),
        `Pool view: the rate shows each line's, the lines' units differing (${rates.join(' · ')})`);
      const fund = (await host.textContent('[data-testid="funding-Harbour Mutual"]')).trim();
      ok(fund === 'Expected', `Pool view: funding at Expected on every line reads "Expected" ("${fund}")`);
      const ripple = (await host.textContent('[data-testid="ripple-Harbour Mutual"]')).trim();
      ok(ripple === '—' && /Ripple Score is coming/.test(await host.textContent('[data-testid="teams-table"] >> xpath=ancestor::div[1]')),
        `Pool view: the Ripple Score is a placeholder, with its note ("${ripple}")`);
      ok(await host.$('[data-testid="pending-Tri-County"]') !== null, 'Pool view: the non-reporter is still pending');
    }
  }

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  await browser.close();
  console.log(`\nhost-teams: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log('HOST TEAMS PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
