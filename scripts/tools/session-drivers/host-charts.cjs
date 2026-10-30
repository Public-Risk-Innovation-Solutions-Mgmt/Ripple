// The Charts tab: three metrics over time, three states, and the palette rule.
// ⚠ RESULTS SHOW THROUGH THE YEAR JUST COMPLETED (utils/knownYears): with the
// room in year N the charts show posts through year N - 1 — the opening from
// the start, then each year as it is played — and every year once the event is
// over. Each expectation below is the count AT that latest known year. (They
// ran a year behind, N - 2, until results stopped running a year behind.)
const { BASE, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');
const fails = [];
let checks = 0;
function ok(c, w) { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w); } else console.log('  ok    ' + w); }

const COLORS = { 'Harbour Mutual': '#2a78d6', 'Cedar Valley': '#eb6834', 'Tri-County': '#1baf7a', 'Lakeside': '#eda100' };

async function join(ctx, code, name, line) {
  const p = await ctx.newPage();
  await p.goto(`/join/${code}`);
  await p.waitForSelector('[data-testid="team-picker"]');
  await p.fill('[data-testid="team-name"]', name);
  await p.click('[data-testid="join-team"]');
  await p.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
  return p;
}

// Markers are r=4; the direct end-labels use r=3.5, so they are not counted.
const marks = (page, chart, color) =>
  page.$$eval(`[data-testid="chart-${chart}"] circle`, (els, c) =>
    els.filter(e => e.getAttribute('fill') === c && e.getAttribute('r') === '4')
       .map(e => ({ cx: +e.getAttribute('cx'), cy: +e.getAttribute('cy') })), color);

// The x-axis year labels: the text row under the plot (y = H - 22).
const axisYears = (page, chart) =>
  page.$$eval(`[data-testid="chart-${chart}"] text`, els =>
    els.filter(e => e.getAttribute('y') === '218').map(e => e.textContent.trim()));

// The y-axis tick labels: the text column left of the plot (x = 66).
const yTicks = (page, chart) =>
  page.$$eval(`[data-testid="chart-${chart}"] text`, els =>
    els.filter(e => e.getAttribute('x') === '66').map(e => e.textContent.trim()));

const runs = (page, chart, color) =>
  page.$$eval(`[data-testid="chart-${chart}"] polyline`, (els, c) =>
    els.filter(e => e.getAttribute('stroke') === c).map(e => e.getAttribute('points').trim()), color);

// Where a given year sits on the axis, read from its own label.
const axisXFor = (page, chart, year) =>
  page.$$eval(`[data-testid="chart-${chart}"] text`, (els, y) => {
    const t = els.find(e => e.getAttribute('y') === '218' && e.textContent.trim() === String(y));
    return t ? +t.getAttribute('x') : NaN;
  }, year);

async function pickView(page, label) {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await page.waitForTimeout(400);
}

// Which line-view button the bar is actually showing as selected. A fullPage
// screenshot of the sticky bar can lag the DOM, so the bar is read, not eyed.
const activeView = page => page.$$eval('nav button', bs =>
  (bs.find(b => b.className.includes('border-blue-600') && !/Game Setup|Teams|Charts/.test(b.textContent)) || {}).textContent?.trim());

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
  await host.fill('[data-testid="year-count"]', '6');
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

  ok(await host.$('[data-testid="host-tab-charts"]') !== null, 'the Charts tab exists on the host screen');
  await host.click('[data-testid="host-tab-charts"]');
  await host.waitForTimeout(400);
  ok(await host.$('[data-testid="charts-empty"]') !== null, 'with no teams it says so rather than drawing axes');

  const harbour = await join(ctx, code, 'Harbour Mutual', 'WC');
  const cedar   = await join(ctx, code, 'Cedar Valley', 'GL');
  const tri     = await join(ctx, code, 'Tri-County', 'WC');

  // ⚠ BEFORE ANY ADVANCE THERE IS ALREADY A CHART. Every team posts its opening
  // position when it builds, so year 0 is on the axis before a single decision.
  await host.waitForFunction(c => {
    const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
    return !!r && r.teams.length === 3 && r.teams.every(t => (t.resultsByYear || {})['0']);
  }, code, { timeout: 240000 });
  await host.waitForTimeout(900);
  await pickView(host, 'Pool');

  // ⚠ THE OPENING IS KNOWN FROM THE START: 2026, the prior board's last year,
  // is the year just completed, so its point is drawn before any advance.
  const opening = await marks(host, 'surplus', COLORS['Harbour Mutual']);
  ok(opening.length === 1, `before the first advance the opening's point is drawn — 2026 is known (${opening.length})`);
  const rec0 = await host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);
  const h0 = rec0.teams.find(t => t.name === 'Harbour Mutual').resultsByYear['0'];
  // ⚠ EXPOSURE, NOT A MEMBER COUNT. TeamYearFigures.activeMembers became
  // activeExposure when the game moved to showing the pool in aggregate.
  ok(h0.pool.endingSurplus > 0 && h0.pool.activeExposure > 0 && h0.pool.netUltimateLoss > 0,
     `and all THREE metrics have a real year-0 value (surplus ${Math.round(h0.pool.endingSurplus)}, exposure ${h0.pool.activeExposure}, losses ${Math.round(h0.pool.netUltimateLoss)})`);
  // ⚠ AND IT IS NOT MARKED LATE, BECAUSE NOTHING IS LATE YET. Pending means
  // "behind what could have been posted"; before the first advance the opening
  // position IS everything that could have been posted.
  ok(await host.$('[data-testid="chart-pending-Harbour Mutual"]') === null,
     'and nobody is marked behind before the first advance — there is no year to be behind on');

  // ⚠ THE OPENING IS NOT A REPORTED YEAR. The host's Reported column must not
  // tick for a team that has only turned up.
  await host.click('[data-testid="host-tab-setup"]');
  await host.waitForTimeout(400);
  ok(await host.$('[data-testid="reported-Harbour Mutual"]') === null,
     'the Game Setup tab does not report year 0 — turning up is not playing a year');
  await host.click('[data-testid="host-tab-charts"]');
  await host.waitForTimeout(500);

  // A team that turns up and is never seen again: it posts its opening position
  // and nothing else, for the whole game.
  const lake = await join(ctx, code, 'Lakeside', 'WC');
  await host.waitForFunction(c => {
    const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
    return !!r && !!(r.teams.find(t => t.name === 'Lakeside')?.resultsByYear || {})['0'];
  }, code, { timeout: 240000 });
  await lake.close();

  // ---- play three years; Tri-County drops out after year 1 -------------
  const players = [harbour, cedar, tri];
  for (let year = 1; year <= 3; year++) {
    const live = year === 1 ? players : [harbour, cedar];
    for (const p of live) {
      await lockAndConfirm(p);
      await p.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
    }
    await host.click('[data-testid="host-tab-setup"]');
    await host.waitForTimeout(250);
    await host.click('[data-testid="advance"]');
    await host.waitForFunction(y => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === String(y),
      year + 1, { timeout: 30000 });
    await host.waitForFunction(([c, y, n]) => {
      const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
      return !!r && r.teams.filter(t => (t.resultsByYear || {})[String(y)]).length >= n;
    }, [code, year, year === 1 ? 3 : 2], { timeout: 240000 });
    if (year === 1) await tri.close();
  }

  // The posted summary carries the new field the losses chart plots.
  const rec = await host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);
  const h3 = rec.teams.find(t => t.name === 'Harbour Mutual').resultsByYear['3'];
  ok(typeof h3.pool.netUltimateLoss === 'number' && h3.pool.netUltimateLoss > 0,
     `the posted summary carries netUltimateLoss (${Math.round(h3.pool.netUltimateLoss)})`);
  ok(typeof h3.byLine.WC.netUltimateLoss === 'number', 'and carries it per line as well');

  await host.click('[data-testid="host-tab-charts"]');
  await host.waitForTimeout(700);
  await pickView(host, 'Pool');

  for (const id of ['surplus', 'exposure', 'losses', 'developed']) {
    ok(await host.$(`[data-testid="chart-${id}"]`) !== null, `the ${id} chart is drawn`);
  }

  // TEAM NUMBERS: the legend and the lines' end labels pair each team's number
  // with its name, "Team 1 | Harbour Mutual", Team 1 the first to join — and
  // Lakeside, the late fourth joiner, Team 4.
  {
    const want = ['Team 1 | Harbour Mutual', 'Team 2 | Cedar Valley', 'Team 3 | Tri-County', 'Team 4 | Lakeside'];
    const legend = await host.$$eval('[data-testid^="chart-legend-"]', els => els.map(e => e.textContent.trim()));
    ok(JSON.stringify(legend) === JSON.stringify(want), `the legend pairs each team's number with its name (${legend.join(', ')})`);
    const ends = await host.$$eval('[data-testid="chart-surplus"] text', els => els.map(e => e.textContent.trim()).filter(t => /^Team \d+ \|/.test(t)));
    ok(want.every(w => ends.includes(w)), `and so do the lines' end labels, in full (${ends.join(', ')})`);
    // Inside the chart: the right margin widened for them (HostChartsTab, M.right).
    const overhang = await host.$$eval('[data-testid="chart-surplus"] text', els => Math.max(0, ...els
      .filter(e => /^Team \d+ \|/.test(e.textContent.trim()))
      .map(e => { const b = e.getBBox(); return b.x + b.width - e.ownerSVGElement.viewBox.baseVal.width; })));
    ok(overhang <= 0, `and every end label fits inside the chart (${overhang.toFixed(1)} px past its right edge)`);
    if (process.env.CHARTS_SHOT) await host.locator('[data-testid="chart-surplus"]').screenshot({ path: process.env.CHARTS_SHOT });
  }

  // ---- AS BOOKED vs AS DEVELOPED ---------------------------------------
  //
  // ⚠ UNDER FULL-COST BOOKING AN ACCIDENT YEAR'S ULTIMATE HOLDS STEADY AFTER
  // ITS FIRST BOOKING, AND THAT IS WHAT IS ASSERTED NOW. This block used to
  // require the same year to be restated UPWARDS by a later valuation (at least
  // 1.05x two valuations on, every aged point drawn above its booked point).
  // Full-cost booking removed development by design, so that read 1.00x on every
  // run: the same class as the gates repaired in the payout build, asserting a
  // movement the engine no longer makes. The two charts are therefore the same
  // figures today; the developed chart is kept because development returns with
  // the prior development factors, and these assertions are the ones to restate
  // when it does (see docs/PENDING_MULTIPLAYER.md for the sign rule).
  //
  // Checked against reintroduced development: with FULL_COST_BOOKING off, the
  // aged years move and both assertions below go red.
  const recD = await host.evaluate(c => JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);
  const hRec = recD.teams.find(t => t.name === 'Harbour Mutual');
  const booked1 = hRec.resultsByYear['1'].pool.netUltimateLoss;
  const dev1At1 = hRec.resultsByYear['1'].developed.pool['1'];
  const dev1At3 = hRec.resultsByYear['3'].developed.pool['1'];
  // ⚠ NOT EQUAL AT ITS OWN VALUATION ANY MORE, AND THAT IS THE BASIS, NOT
  // DEVELOPMENT. As developed is the team's Annual Statement's Net Ultimates,
  // loss + LAE; as booked is netUltimateLoss, excl. LAE. So at its own valuation
  // a year's developed point sits above its booked one by its LAE.
  ok(dev1At1 > booked1,
     `at its own valuation, accident year 1 as developed carries its LAE: $${Math.round(dev1At1)} over $${Math.round(booked1)} as booked`);
  // ⚠ AGED YEARS MOVE NOW, AND THAT IS THE ASSERTION. This read "hold steady",
  // on the premise that full-cost booking left the engine with no development
  // to make. The host's development % is that development: every accident year
  // develops by its line's percentage over its lifetime, so two valuations on,
  // an aged year MUST have moved. The default mix is adverse on WC and GL and
  // favourable on Property, so the pool figure is adverse on balance and the
  // direction is asserted with the movement.
  // On ONE basis — the developed column at the year's own valuation against
  // the same column later — so the movement is development and nothing else.
  const aged = ['1', '2'].map(y => ({
    y, own: hRec.resultsByYear[y].developed.pool[y], developed: hRec.resultsByYear['3'].developed.pool[y],
  }));
  ok(aged.every(a => a.developed > a.own),
     `later valuations have developed the aged years ADVERSELY: ${aged.map(a => `year ${a.y} $${Math.round(a.own)} -> $${Math.round(a.developed)}`).join(', ')}`);
  void dev1At3;

  // One domain across the pair, or the growth is invisible.
  const tB = await yTicks(host, 'losses');
  const tD = await yTicks(host, 'developed');
  ok(tB.length > 0 && tB.join(',') === tD.join(','),
     `both loss charts are on ONE y-scale (${tB.join(' ')})`);

  const devMarks = await marks(host, 'developed', COLORS['Harbour Mutual']);
  const bookMarks = await marks(host, 'losses', COLORS['Harbour Mutual']);
  ok(devMarks.length === bookMarks.length && devMarks.length === 4,
     `the developed chart covers the same accident years (${devMarks.length})`);
  // ⚠ AND THE DRAWN POINTS FOLLOW THE FIGURES BACK UP. This asserted the
  // points sat ON each other — correct while nothing developed, and it had
  // already been "ABOVE" before that. With the host's development live the
  // pool develops adversely, so a developed point sits ABOVE its booked one;
  // on the chart's inverted y-axis that is a SMALLER cy.
  // ⚠ THE AGED ONES ONLY. A year at its OWN valuation has not developed yet;
  // its developed point sits above its booked one by its LAE alone (the
  // developed column is the statement's loss + LAE), which says nothing about
  // development. Only the two that have aged can have moved.
  //
  // ⚠ AND THE TEST IS "NEVER BELOW, AT LEAST ONE CLEARLY ABOVE", because a
  // year of development on this scale is worth a pixel or two and the chart
  // is drawn in integers. Demanding a strict gap on every point asserts the
  // renderer's resolution rather than the engine's direction.
  const agedMarks = devMarks.slice(0, 2);
  const neverBelow = agedMarks.every((d, i) => d.cy <= bookMarks[i].cy);
  const oneClear = agedMarks.some((d, i) => d.cy < bookMarks[i].cy);
  ok(neverBelow && oneClear,
     'and the aged developed points are drawn ABOVE their booked points (adverse), never below');

  // ---- REPORTED, PENDING, and the line that must not fall to zero ------
  const hs = await marks(host, 'surplus', COLORS['Harbour Mutual']);
  const ts = await marks(host, 'surplus', COLORS['Tri-County']);
  ok(hs.length === 4, `a team that reported every year has a point per KNOWN year, plus the opening (${hs.length})`);
  ok(ts.length === 2, `a team that stopped after year 1 has the opening and year 1, and nothing after (${ts.length})`);
  const axis3 = await axisYears(host, 'surplus');
  ok(axis3.join(',') === '0,1,2,3,4,5,6',
     `the axis has not moved as the game progressed (${axis3.join(',')})`);
  const tRuns = await runs(host, 'surplus', COLORS['Tri-County']);
  ok(tRuns.length === 1 && tRuns[0].split(' ').length === 2,
     'its line runs from the opening to year 1 and stops — no segment travels further');
  ok(ts[ts.length - 1].cx < (await axisXFor(host, 'surplus', 4)),
     'leaving VISIBLE empty space on an axis that already reaches the last year');
  const lakeMarks = await marks(host, 'surplus', COLORS['Lakeside']);
  const lakeRuns = await runs(host, 'surplus', COLORS['Lakeside']);
  ok(lakeMarks.length === 1 && lakeRuns.length === 1 && lakeRuns[0].split(' ').length === 1,
     'a team that only ever turned up is ONE point at year 0, with no line from it');
  const lakeDev = await marks(host, 'developed', COLORS['Lakeside']);
  ok(lakeDev.length === 1, `a team that only turned up has ONE developed point too (${lakeDev.length})`);
  const triDev = await marks(host, 'developed', COLORS['Tri-County']);
  ok(triDev.length === 2,
     `a team that stopped reporting has a developed column frozen at its last post (${triDev.length})`);
  const lakeNote = (await host.textContent('[data-testid="chart-pending-Lakeside"]')).trim();
  ok(lakeNote === 'opening position only',
     `and the legend says that rather than "through year 0" (${lakeNote})`);

  const pending = await host.textContent('[data-testid="chart-pending-Tri-County"]');
  ok(/through year 1/.test(pending), `the legend says why: "${pending.trim()}"`);
  ok(ts[0].cx < hs[hs.length - 1].cx, 'the stopped line ends BEFORE the reporting one, rather than dropping');

  // ---- EVERY TEAM IS DRAWN IN EVERY VIEW NOW ---------------------------
  // ⚠ THIS CHECKED THE OPPOSITE AND COULD NOT SURVIVE THE RULING. It asserted
  // that a WC-only team is named ABSENT in the GL view and draws nothing at all.
  // ABSENT meant "does not write this line", which is unreachable once the HOST
  // sets one line set for the room: every team writes every line the room plays.
  // So the assertion inverts — nobody is ABSENT, and the team that WAS absent
  // now draws a real series, which is the stronger of the two statements.
  await pickView(host, 'General Liability');
  ok(await host.$('[data-testid="chart-absent-Harbour Mutual"]') === null,
     'GL view: no team is ABSENT — the room\'s lines are universal');
  ok(/General Liability/.test(await activeView(host) || ''),
     'and the line-view bar marks the view the charts are actually drawing');
  const hGL = await marks(host, 'surplus', COLORS['Harbour Mutual']);
  ok(hGL.length > 0, 'and the team that used to be absent here draws a real series');
  const hGLdev = await marks(host, 'developed', COLORS['Harbour Mutual']);
  ok(hGLdev.length > 0, 'the developed chart carries the same team identically — a line there too');
  const cGLdev = await marks(host, 'developed', COLORS['Cedar Valley']);
  ok(cGLdev.length === 4, `and the GL team has its own line's developed column (${cGLdev.length})`);
  const cGL = await marks(host, 'surplus', COLORS['Cedar Valley']);
  ok(cGL.length === 4, `the GL team keeps opening plus its three known years on its own line view (${cGL.length})`);

  // ---- colour follows the entity, not its rank ------------------------
  await pickView(host, 'Pool');
  const cPool = await marks(host, 'surplus', COLORS['Cedar Valley']);
  ok(cPool.length === 4, 'switching the view back does not repaint the survivors — same hue, same team');

  // ---- the numbers on the chart are the numbers in the record ---------
  const box = await host.$eval('[data-testid="chart-surplus"]', e => {
    const b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  // A known year, 2 (the latest is 3, just played).
  const h2 = rec.teams.find(t => t.name === 'Harbour Mutual').resultsByYear['2'];
  const x2 = await axisXFor(host, 'surplus', 2);
  await host.mouse.move(box.x + box.w * (x2 / 760), box.y + box.h * 0.5);
  await host.waitForTimeout(300);
  const tip = (await host.textContent('.pointer-events-none')) || '';
  const fmt = v => Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${(v / 1e3).toFixed(1)}K`;
  ok(/Year 2/.test(tip), `the hover reads the year off the axis: "${tip.slice(0, 40)}"`);
  ok(tip.includes(fmt(h2.pool.endingSurplus)),
     `and the surplus it shows is the posted one (${fmt(h2.pool.endingSurplus)})`);

  // ---- a year missing in the MIDDLE breaks the line ---------------------
  // Injected, because the product cannot produce one: a reopened tab replays and
  // re-posts every year. The chart still has to render it honestly.
  for (const p of [harbour, cedar]) await p.close();
  await host.evaluate(c => {
    const k = 'ripple.session.v1.room.' + c;
    const r = JSON.parse(localStorage.getItem(k));
    delete r.teams.find(t => t.name === 'Harbour Mutual').resultsByYear['1'];
    localStorage.setItem(k, JSON.stringify(r));
  }, code);
  await host.reload();
  await host.waitForSelector('[data-testid="host-tab-charts"]');
  await host.click('[data-testid="host-tab-charts"]');
  await host.waitForTimeout(700);
  await pickView(host, 'Pool');
  const gapRuns = await runs(host, 'surplus', COLORS['Harbour Mutual']);
  const gapMarks = await marks(host, 'surplus', COLORS['Harbour Mutual']);
  ok(gapRuns.length === 2, `the missing middle year splits the line in two (${gapRuns.length} segments)`);
  ok(gapMarks.length === 3, 'and leaves three points, not four — nothing is invented for the gap');
  const gapDev = await marks(host, 'developed', COLORS['Harbour Mutual']);
  ok(gapDev.length === 4,
     'while the developed chart is UNBROKEN — the gap is in what was posted, not in the valuation');

  // ---- A TAB THAT FALLS BEHIND ----------------------------------------
  //
  // ⚠ THE ASSERTION THE DRIVER DID NOT HAVE, AND THE REASON IT PASSED AT 43/43
  // WITH THREE CHARTS VISIBLY SPARSE. Every other block here waits for each
  // year's post to LAND before letting the host advance — so the record was
  // forced complete before anything was asserted about it, and the checks could
  // only ever have caught a rendering fault. A host does not wait, and a
  // backgrounded tab is throttled, so a tab two or more years behind is ordinary.
  // Here it is made to happen and the RECORD is checked, not just the drawing.
  await host.click('[data-testid="host-tab-setup"]');
  await host.waitForTimeout(300);
  for (let i = 0; i < 2; i++) {
    await host.click('[data-testid="advance"]');
    await host.waitForTimeout(400);
  }
  await host.waitForFunction(() => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === '6', null, { timeout: 30000 });

  const back = await join(ctx, code, 'Cedar Valley', 'GL');   // three years behind
  await host.waitForFunction(c => {
    const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
    const t = r?.teams.find(x => x.name === 'Cedar Valley');
    return !!t && !!(t.resultsByYear || {})['5'];
  }, code, { timeout: 300000 });
  await host.waitForTimeout(2000);

  const caught = await host.evaluate(c => {
    const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c));
    const t = r.teams.find(x => x.name === 'Cedar Valley');
    return Object.keys(t.resultsByYear || {}).map(Number).sort((a, b) => a - b);
  }, code);
  const holes = [0, 1, 2, 3, 4, 5].filter(y => !caught.includes(y));
  ok(holes.length === 0,
     `a tab that caught up THREE years posted every one of them, not just the newest (has [${caught.join(',')}]${holes.length ? `, missing ${holes.join(',')}` : ''})`);

  await host.click('[data-testid="host-tab-charts"]');
  await host.waitForTimeout(700);
  await pickView(host, 'General Liability');
  // The room is in year 6: posts 0 to 5 are in the record, and all are known.
  const caughtMarks = await marks(host, 'losses', COLORS['Cedar Valley']);
  ok(caughtMarks.length === 6,
     `and the as-booked chart draws a point for every KNOWN one of them (${caughtMarks.length} of 6)`);
  const caughtRuns = await runs(host, 'losses', COLORS['Cedar Valley']);
  ok(caughtRuns.length === 1, `with no gap in the line (${caughtRuns.length} segment)`);
  await back.close();

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  ok(errs.length === 0, 'no page errors');
  await browser.close();
  console.log(`\nhost-charts: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
})().catch(e => { console.log('THREW:', e); process.exit(1); });
