// THE ROOM MARKET SHARE — a hosted room of three teams, three years.
//
// In a hosted game a team's market share is its share of the ROOM: per line,
// its exposure over every team's exposure on the line; on the pool, its premium
// over the room's (RoomMarketShares, contract.ts). Each team plays different
// underwriting (Harbour Mutual at the defaults, Cedar Valley declining 10% of
// renewals, Tri-County rejecting 15% of new business, on every line). Checked:
//
//   - before year 1, every team reads one third on every line and the pool;
//   - nothing changes until the host advances, even after every team locks in;
//   - after each advance the shares shown are the LATEST KNOWN year's — one
//     year behind, like every other result (the year just completed is stored
//     once its last locked team posts, and shows at the next advance; at game
//     end the final year shows) — each the team's figure / the room's total,
//     summing to 100%;
//   - the host's Teams table and each player's chip agree, view by view;
//   - a player's screen has no other team's figures: no Teams table, and the
//     one share it shows is its own.
//
// ROOM_SHARE_STOP=1 (room-market-share-stop.cjs): Tri-County stops after year
// 1 — it locks nothing more — and its last reported figures stay in the totals.
// ROOM_SHARE_TIMING=1: only time the advances (for a build without the change).
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/room-market-share.cjs
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

const STOP = process.env.ROOM_SHARE_STOP === '1';
const TIMING = process.env.ROOM_SHARE_TIMING === '1';
const NAME = STOP ? 'room-market-share-stop' : 'room-market-share';
const TEAMS = ['Harbour Mutual', 'Cedar Valley', 'Tri-County'];
const STOPPER = 'Tri-County';
const LINES = ['WC', 'GL', 'Property'];
const VIEW = { pool: 'Pool', WC: "Workers' Compensation", GL: 'General Liability', Property: 'Property' };
const YEARS = 3;
const pct = v => `${(v * 100).toFixed(1)}%`;

const fails = [];
let checks = 0;
function ok(c, w, detail = '') {
  checks++;
  if (!c) fails.push(w);
  console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${w}${detail ? `  — ${detail}` : ''}`);
}

const roomRecord = (page, code) => page.evaluate(c =>
  JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);

async function join(ctx, code, name) {
  const p = await ctx.newPage();
  await p.goto(`/join/${code}`);
  await p.waitForSelector('[data-testid="team-picker"]');
  await p.fill('[data-testid="team-name"]', name);
  await p.click('[data-testid="join-team"]');
  await p.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
  return p;
}

// Step a labelled slider on the Decisions page by `presses` (1% each).
async function nudge(page, label, presses) {
  // ⚠ THE SLIDER NEAREST ITS LABEL. The first range input with the label
  // anywhere in its ancestors was the funding slider (a shared container holds
  // both), which moved funding to 90% and left underwriting at 0.
  const el = await page.evaluateHandle(lbl => {
    let best = null, bestDepth = Infinity;
    for (const input of document.querySelectorAll('input[type=range]')) {
      let n = input.parentElement;
      for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
        if (n.textContent && n.textContent.includes(lbl)) { if (i < bestDepth) { best = input; bestDepth = i; } break; }
      }
    }
    return best;
  }, label);
  const input = el.asElement();
  if (!input) return null;
  await input.focus();
  for (let i = 0; i < presses; i++) await page.keyboard.press('ArrowRight');
  return input.evaluate(e => e.value);
}

async function decisionsTab(page) {
  await page.getByRole('button', { name: 'Decisions', exact: true }).click();
  await page.waitForTimeout(300);
}

// The player's chip on each view: { pool, WC, GL, Property } as text, or null when absent.
async function playerChips(page) {
  await decisionsTab(page);
  const out = {};
  for (const v of ['pool', ...LINES]) {
    await page.getByRole('button', { name: VIEW[v], exact: true }).first().click();
    await page.waitForTimeout(250);
    const head = (await page.locator('header').innerText()).replace(/\s+/g, ' ');
    out[v] = (head.match(/Market Share\s+([\d.]+%)/) || [])[1] ?? null;
  }
  return out;
}

// The host's Teams table share column on each view: { view: { team: text } }.
async function hostShares(host) {
  await host.click('[data-testid="host-tab-teams"]');
  await host.waitForTimeout(300);
  const out = {};
  for (const v of ['pool', ...LINES]) {
    await host.getByRole('button', { name: VIEW[v], exact: true }).first().click();
    await host.waitForTimeout(250);
    out[v] = {};
    for (const t of TEAMS) out[v][t] = (await host.textContent(`[data-testid="share-${t}"]`)).trim();
  }
  return out;
}

// What the shares must be for `year`, from the room's posted results: a team
// that locked the year on its year figures, a stopped one on its newest post.
function expectedShares(rec, year) {
  const fig = {};
  for (const t of rec.teams) {
    const keys = Object.keys(t.resultsByYear).map(Number).filter(y => y <= year);
    const use = year === 0 ? 0 : (t.decisionsByYear[String(year)] !== undefined ? year : Math.max(...keys));
    fig[t.name] = t.resultsByYear[String(use)];
  }
  const tot = { pool: 0 };
  for (const l of LINES) tot[l] = 0;
  for (const s of Object.values(fig)) {
    tot.pool += s.pool.poolPremium;
    for (const l of LINES) tot[l] += s.byLine[l].activeExposure;
  }
  const out = {};
  for (const [n, s] of Object.entries(fig)) {
    out[n] = { pool: s.pool.poolPremium / tot.pool };
    for (const l of LINES) out[n][l] = s.byLine[l].activeExposure / tot[l];
  }
  return out;
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
  await host.fill('[data-testid="event-name"]', STOP ? 'Share Room, one stops' : 'Share Room');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', String(YEARS));
  await host.fill('[data-testid="expected-teams"]', '3');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\nroom ${code}${STOP ? ` — ${STOPPER} stops after year 1` : ''}\n`);

  const players = {};
  for (const t of TEAMS) {
    players[t] = await join(ctx, code, t);
    players[t].on('pageerror', e => errs.push(`${t}: ${e.message}`));
  }

  // Different underwriting, every line.
  for (const v of LINES) {
    // The sliders' on-screen names since the Decisions layout: renewalsDeclined
    // and newBusinessRejection underneath, as before.
    for (const [t, label, presses] of [['Cedar Valley', 'Existing Book: Non-Renewal Assumption', 10], ['Tri-County', 'New Business: Growth Assumption', 15]]) {
      const p = players[t];
      await decisionsTab(p);
      await p.getByRole('button', { name: VIEW[v], exact: true }).first().click();
      await p.waitForTimeout(250);
      const got = await nudge(p, label, presses);
      const want = (presses / 100).toFixed(2);
      if (!TIMING) ok(got !== null && Number(got).toFixed(2) === want, `${t} sets ${label} on ${v}`, `slider at ${got}`);
    }
  }

  // ⚠ SHOWN ONE YEAR BEHIND, like every other result (marketShares.ts's
  // shownShares): the room deciding year N shows year N - 2's set, the opening
  // posts standing in before that year exists; the newest once the game is over.
  const shownYearOf = rec => {
    const held = Object.keys(rec.marketSharesByYear ?? {}).map(Number);
    const known = rec.currentYear > rec.yearCount ? rec.currentYear - 1 : Math.max(0, rec.currentYear - 2);
    const ok1 = held.filter(y => y <= known);
    return ok1.length ? Math.max(...ok1) : undefined;
  };
  const sharesYear = async () => shownYearOf(await roomRecord(host, code));
  const table = [];

  async function checkSet(label, year) {
    const rec = await roomRecord(host, code);
    const stored = { year, byTeam: rec.marketSharesByYear?.[String(year)] };
    ok(shownYearOf(rec) === year && stored.byTeam !== undefined, `${label}: the set shown is year ${year}'s`, `shown year ${shownYearOf(rec)}`);
    const want = expectedShares(rec, year);
    for (const t of TEAMS) for (const v of ['pool', ...LINES]) {
      const got = v === 'pool' ? stored.byTeam[t].pool : stored.byTeam[t].byLine[v];
      if (Math.abs(got - want[t][v]) > 1e-12) ok(false, `${label}: ${t} ${v} = its figure / the room's total`, `${got} vs ${want[t][v]}`);
    }
    ok(true, `${label}: every stored share is the team's figure / the room's total`);
    for (const v of ['pool', ...LINES]) {
      const sum = TEAMS.reduce((a, t) => a + (v === 'pool' ? stored.byTeam[t].pool : stored.byTeam[t].byLine[v]), 0);
      ok(Math.abs(sum - 1) < 1e-12, `${label}: ${v} shares sum to 100%`, `${sum}`);
    }
    // Each chip shows the stored figure; the host's table agrees with every chip.
    const hs = await hostShares(host);
    for (const t of TEAMS) {
      const want1 = v => pct(v === 'pool' ? stored.byTeam[t].pool : stored.byTeam[t].byLine[v]);
      if (players[t].isClosed()) {
        ok(['pool', ...LINES].every(v => hs[v][t] === want1(v)), `${label}: the host's table shows ${t}'s kept share on every view`,
          ['pool', ...LINES].map(v => `${v} host ${hs[v][t]} / stored ${want1(v)}`).join('; '));
        table.push(`${label.padEnd(16)} ${t.padEnd(15)} ` + ['pool', ...LINES].map(v => `${v} ${want1(v)}`).join('  ') + '  (stopped)');
        continue;
      }
      const chips = await playerChips(players[t]);
      const agree = ['pool', ...LINES].every(v => chips[v] === want1(v) && hs[v][t] === want1(v));
      ok(agree, `${label}: ${t}'s chip and the host's table agree with the stored share on every view`,
        ['pool', ...LINES].map(v => `${v} chip ${chips[v]} / host ${hs[v][t]} / stored ${want1(v)}`).join('; '));
      table.push(`${label.padEnd(16)} ${t.padEnd(15)} ` + ['pool', ...LINES].map(v => `${v} ${want1(v)}`).join('  '));
    }
    return stored;
  }

  // A player's chip follows the room only on its next read; wait for the one we expect.
  async function waitChip(page, text) {
    await decisionsTab(page);
    await page.getByRole('button', { name: VIEW.pool, exact: true }).first().click();
    await page.waitForFunction(t => {
      const m = (document.querySelector('header')?.innerText || '').replace(/\s+/g, ' ').match(/Market Share\s+([\d.]+%)/);
      return m && m[1] === t;
    }, text, { timeout: 60000 }).catch(() => {});
  }

  // ---- before year 1: the opening books -----------------------------------
  if (!TIMING) {
    await host.waitForFunction(c => {
      const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c));
      return r?.marketSharesByYear?.['0'] && Object.keys(r.marketSharesByYear['0']).length === 3;
    }, code, { timeout: 180000 });
    for (const t of TEAMS) await waitChip(players[t], '33.3%');
    const s0 = await checkSet('before year 1', 0);
    ok(TEAMS.every(t => Math.abs(s0.byTeam[t].pool - 1 / 3) < 1e-12 && LINES.every(l => Math.abs(s0.byTeam[t].byLine[l] - 1 / 3) < 1e-12)),
      'before year 1 every team holds exactly one third on every line and the pool');
    // ⚠ NO PLAYER SEES ANOTHER TEAM'S FIGURES. The wire redaction is the contract
    // harness's (no RoomView.marketShares, no other team's resultsByYear for a
    // player); on screen, a player has no Teams table and one share — its own.
    for (const t of TEAMS) {
      ok(await players[t].$('[data-testid="teams-table"]') === null && await players[t].$('[data-testid^="share-"]') === null,
        `${t}'s screen carries no Teams table and no other team's share`);
    }
  }

  const timings = [];
  for (let y = 1; y <= YEARS; y++) {
    const locking = TEAMS.filter(t => !(STOP && t === STOPPER && y >= 2));
    const before = TIMING ? null : await sharesYear();
    const chipsBefore = TIMING ? null : await playerChips(players[TEAMS[0]]);
    for (const t of locking) {
      await players[t].getByRole('button', { name: /Lock Program Year/ }).first().click();
      await players[t].waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
    }
    if (!TIMING) {
      // Two polls' worth: every screen has read the locked room.
      await host.waitForTimeout(7000);
      const chipsAfter = await playerChips(players[TEAMS[0]]);
      ok((await sharesYear()) === before && JSON.stringify(chipsAfter) === JSON.stringify(chipsBefore),
        `year ${y}: every team locked in and nothing changed before the advance`, `stored year ${await sharesYear()}`);
    }

    await host.click('[data-testid="host-tab-setup"]');
    await host.waitForTimeout(300);
    const t0 = Date.now();
    await host.click('[data-testid="advance"]');
    await host.waitForFunction(n => {
      const el = document.querySelector('[data-testid="current-year"]');
      return (el && el.textContent.trim() === String(n)) || document.querySelector('[data-testid="room-complete"]') !== null;
    }, y + 1, { timeout: 60000 });
    const tAdvance = Date.now() - t0;
    await host.waitForFunction(([c, yr, who]) => {
      const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c));
      return who.every(n => r.teams.find(t => t.name === n)?.resultsByYear?.[String(yr)]);
    }, [code, y, locking], { timeout: 300000 });
    const tResults = Date.now() - t0;
    let tShares = null;
    if (!TIMING) {
      await host.waitForFunction(([c, yr]) => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c))?.marketSharesByYear?.[String(yr)] !== undefined,
        [code, y], { timeout: 120000 });
      tShares = Date.now() - t0;
    }
    timings.push({ y, tAdvance, tResults, tShares });
    console.log(`  year ${y}: advance ${tAdvance} ms, locked teams' results in ${tResults} ms${tShares !== null ? `, shares stored ${tShares} ms` : ''}`);

    if (!TIMING) {
      // The year just completed is stored; what shows is the latest KNOWN year —
      // the one before it while the game runs, this one once it is over.
      const showing = y === YEARS ? y : y - 1;
      const rec = await roomRecord(host, code);
      ok(shownYearOf(rec) === Math.max(0, showing),
        `after advance ${y}: year ${y}'s shares are stored, and year ${Math.max(0, showing)}'s show — one year behind${y === YEARS ? ' until the game ends' : ''}`,
        `shown ${shownYearOf(rec)}`);
      const s = { byTeam: rec.marketSharesByYear[String(Math.max(0, showing))] };
      for (const t of TEAMS) if (!players[t].isClosed()) await waitChip(players[t], pct(s.byTeam[t].pool));
      const stored = await checkSet(`after advance ${y}`, Math.max(0, showing));
      if (STOP && showing >= 2) {
        const st = rec.teams.find(t => t.name === STOPPER);
        ok(st.decisionsByYear[String(showing)] === undefined, `year ${showing}: ${STOPPER} did not lock in (stopped)`);
        const last = Math.max(...Object.keys(st.resultsByYear).map(Number).filter(k => k <= showing));
        ok(stored.byTeam[STOPPER] !== undefined,
          `year ${showing}: ${STOPPER} stays in the totals on its last reported figures (year ${last})`,
          `WC ${pct(stored.byTeam[STOPPER].byLine.WC)}, pool ${pct(stored.byTeam[STOPPER].pool)}`);
      }
    }
    // ⚠ THE TEAM STOPS PLAYING: its browser goes, so it locks and posts nothing more.
    if (STOP && y === 1) { await players[STOPPER].close(); console.log(`  ${STOPPER} stops playing after year 1`); }
  }

  console.log('\n  --- shares by team, line and pool ---');
  for (const r of table) console.log('    ' + r);
  console.log('\n  --- advance timings (ms) ---');
  for (const t of timings) console.log(`    year ${t.y}: advance ${t.tAdvance}, results ${t.tResults}, shares ${t.tShares ?? '—'}`);

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  ok(errs.length === 0, 'no page errors');
  await browser.close();
  console.log(`\n${NAME}: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log(TIMING ? 'TIMING DONE' : 'ROOM MARKET SHARE PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
