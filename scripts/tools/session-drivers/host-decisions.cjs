// The Decisions tab: nothing before an advance, every team's choices after it.
//
// ⚠ THE TIMING ASSERTION IS THE ONE WORTH DRIVING A BROWSER FOR. The contract
// harness already proves the host's READ carries no decisions before the year
// is advanced; what it cannot show is that the SCREEN says so rather than
// rendering an empty grid that reads as "nobody chose anything". This walks
// the tab across the advance and asserts both sides of it.
//
// ⚠ AND IT MUST BE ABLE TO FAIL — see THE CONTROL at the foot.
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');
const fails = [];
let checks = 0;
function ok(c, w) { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w); } else console.log('  ok    ' + w); }

async function join(ctx, code, name) {
  const p = await ctx.newPage();
  await p.goto(`/join/${code}`);
  await p.waitForSelector('[data-testid="team-picker"]');
  await p.fill('[data-testid="team-name"]', name);
  await p.click('[data-testid="join-team"]');
  await p.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });
  return p;
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
  await host.fill('[data-testid="event-name"]', 'Decisions Driver');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '3');
  await host.fill('[data-testid="expected-teams"]', '2');
  await host.uncheck('[data-testid="line-Property"]');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\nroom ${code}\n`);

  ok(await host.$('[data-testid="host-tab-decisions"]') !== null, 'the Decisions tab exists on the host screen');

  await host.click('[data-testid="host-tab-decisions"]');
  await host.waitForTimeout(400);
  ok(await host.$('[data-testid="decisions-empty"]') !== null, 'with no teams it says so rather than rendering a grid');

  const a = await join(ctx, code, 'Harbour Mutual');
  const b = await join(ctx, code, 'Cedar Valley');

  // ⚠ BEFORE THE ADVANCE. Teams have joined and year 1 is live; there is no
  // completed year, so the tab must say that and show no table at all.
  await host.click('[data-testid="host-tab-decisions"]');
  await host.waitForFunction(
    () => document.querySelector('[data-testid="decisions-no-year"]') !== null,
    null, { timeout: 30000 });
  const note = (await host.textContent('[data-testid="decisions-no-year"]')).trim();
  ok(/No year has been completed/.test(note), `before any advance: "${note.split('.')[0]}."`);
  ok(await host.$('[data-testid="decisions-table"]') === null,
     'and NO decisions table is rendered — an empty grid would read as "nobody chose anything"');

  // Both teams lock year 1 and the host advances.
  for (const p of [a, b]) {
    await p.getByRole('button', { name: /Lock Year/ }).first().click();
    await p.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
  }

  // ⚠ STILL NOTHING, EVEN THOUGH BOTH TEAMS HAVE LOCKED. This is the assertion
  // the whole design turns on: locking is not posting. The decisions exist on
  // the teams' own clients and in the opaque stream, and the host must not see
  // them until the year is advanced and the result posted.
  await host.click('[data-testid="host-tab-decisions"]');
  await host.waitForTimeout(600);
  ok(await host.$('[data-testid="decisions-table"]') === null,
     'both teams LOCKED and the host still sees no decisions — locking is not posting');

  await host.click('[data-testid="host-tab-setup"]');
  await host.waitForTimeout(300);
  await host.click('[data-testid="advance"]');
  await host.waitForFunction(
    () => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === '2',
    null, { timeout: 30000 });
  for (const p of [a, b]) {
    await p.waitForFunction(
      () => /year 1 result posted/.test(document.querySelector('[data-testid="posted-year"]')?.textContent || ''),
      null, { timeout: 180000 });
  }

  // ⚠ AFTER THE ADVANCE AND THE POST. Wait on the condition, never a clock —
  // the host's poll backs off while the room is quiet.
  await host.click('[data-testid="host-tab-decisions"]');
  await host.waitForFunction(
    () => document.querySelector('[data-testid="decisions-table"]') !== null,
    null, { timeout: 60000 });
  // ⚠ WAIT FOR BOTH ROWS TO BE REPORTED, NOT MERELY PRESENT. A team that has
  // not posted yet still has a row — the collapsed "Not reported yet" span —
  // and a team's "result posted" label goes up when the year is PROCESSED,
  // before its post is awaited. Waiting on two rows of any kind read the table
  // between the two posts as soon as the engine got fast enough for them to
  // land apart (loss engine commit 3a: Harbour Mutual "Not reported yet";
  // re-read after a pause, both reported). The assertion below is unchanged;
  // if a post never lands, this wait expires and the assertion fails.
  await host.waitForFunction(
    () => {
      const rs = [...document.querySelectorAll('[data-testid^="decisions-row-"]')];
      return rs.length >= 2 && rs.every(r => r.children.length === 8);
    },
    null, { timeout: 60000 }).catch(() => {});

  const rows = await host.$$eval('[data-testid^="decisions-row-"]', rs =>
    rs.map(r => [...r.children].map(c => c.textContent.trim())));
  console.log('\n  --- Decisions, year 1 ---');
  for (const cells of rows) console.log(`    ${cells.join(' | ')}`);

  ok(rows.length === 2, `both teams appear (${rows.length} rows)`);
  // A reported row has a cell per decision column; a non-reported one collapses
  // to a single spanning cell, exactly as the Teams tab does.
  ok(rows.every(r => r.length === 8),
     'every row is REPORTED — eight cells, not a collapsed "not reported" span');
  ok(rows.every(r => !/Decisions not recorded/.test(r.join(' '))),
     'and none reads "not recorded" — the posted rows carry their decisions block');
  // Loss engine commit 4a: the Reinsurance column is each line's PACKAGE. Both
  // teams locked on the defaults, so it reads the default package by name —
  // not a placed-of-total count, which is what the per-band shape rendered.
  ok(rows.every(r => r[2] === '$9M xs $1M'),
     `the Reinsurance column shows the package the team chose (${rows.map(r => r[2]).join(', ')})`);

  // ⚠ ADDED AFTER THIS DRIVER FOUND THE BUG. The allocation column rendered
  // "1000% / 8000% / 1000%" on the first run: AssetAllocation is 0-100 and it
  // had been put through a fraction formatter. The driver PRINTED it and
  // asserted nothing, so it would have shipped. No percentage on this row can
  // exceed 100.
  const pcts = rows.flatMap(r => [...r.join(' ').matchAll(/(\d+(?:\.\d+)?)%/g)].map(m => Number(m[1])));
  const overflow = pcts.filter(v => v > 100);
  ok(overflow.length === 0,
     `every percentage on the row is a real percentage (worst ${Math.max(0, ...pcts)}%)`);

  const yearSel = await host.$('[data-testid="decisions-year"]');
  ok(yearSel !== null, 'a year selector is offered');
  const opts = await host.$$eval('[data-testid="decisions-year"] option', o => o.map(x => x.textContent.trim()));
  console.log('  year options  :', opts);
  ok(opts.length === 1 && /^1/.test(opts[0]),
     'and it offers COMPLETED years only — year 1, not the live year 2');

  // The drill-down: decisions beside that year's results, from the same row.
  await host.click('[data-testid="decisions-row-Harbour Mutual"]');
  await host.waitForFunction(
    () => document.querySelector('[data-testid="decisions-drill-Harbour Mutual"]') !== null,
    null, { timeout: 15000 });
  const drill = (await host.textContent('[data-testid="decisions-drill-Harbour Mutual"]')).replace(/\s+/g, ' ').trim();
  console.log('  drill-down    :', drill.slice(0, 140));
  ok(/Ending surplus/.test(drill) && /Funding/.test(drill),
     "the drill-down shows that year's decisions BESIDE that year's results");

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  ok(errs.length === 0, 'no page errors');
  await browser.close();

  // --------------------------------------------------------------------
  // THE CONTROL — run by hand, recorded here, not run every time.
  //
  // Two were run, and BOTH failed EARLIER than predicted, which is worth
  // recording because the prediction was wrong in an instructive way.
  //
  //   1. Year list starts at 0 (`for (let y = latestCompleted; y >= 0; y--)`).
  //      PREDICTED: the "COMPLETED years only" assertion fails with two
  //      options. MEASURED: exit 1 at the PRE-ADVANCE wait — admitting year 0
  //      makes effectiveYear non-null before any advance, so the "no year
  //      completed" branch never renders and the driver times out waiting for
  //      it. The selector assertion is never reached.
  //
  //   2. The `effectiveYear === null` early return disabled, so the tab tries
  //      to render a table with no completed year. MEASURED: exit 1, same
  //      place and for the plainer reason — the note is gone.
  //
  // Both prove the driver fails when the behaviour breaks. Neither proves the
  // selector assertion fails on its own; that one is held by the year-options
  // check reading exactly one option, and a third control would be needed to
  // exercise it in isolation.
  // --------------------------------------------------------------------
  console.log(`\nhost-decisions: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log('HOST DECISIONS PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
