// THE TEST THE DEFECT WOULD HAVE FAILED.
// A team varies its decisions across several years, reloads, and the rebuilt
// results must match WHAT WAS POSTED AT THE TIME — not merely be self-consistent.
//
// ⚠ NOTHING HERE NAMES AN EVENT OR A YEAR, AND THAT IS A REPAIR, NOT A
// LOOSENING. This driver used to pin the shock draw: a seed chosen so that
// Randomise returned WILDFIRE in year 2, asserted by name in three places.
// Adding nine events to the catalog changed what a uniform draw returns and all
// three failed — for a legitimate reason, which is the worst kind of red,
// because the next person to meet it is being invited to delete an assertion.
//
// The replacement reads the SCHEDULE BACK FROM THE ROOM and then looks for THAT
// on the screen. It still asserts the two things that matter and it asserts them
// harder: the schedule is NON-EMPTY and took effect before the reload (the drawn
// event is named on its own year's Results), and it is the SAME schedule
// afterwards, entry for entry, read from the record rather than inferred.
// "A schedule exists" would have been the dangerous loosening — it passes on a
// game whose schedule never fired — and that is exactly what is not asserted.
const { BASE, REPO, launchBrowser, requireServer } = require('./_shared.cjs');
const { execFileSync } = require('node:child_process');
const TEAM = 'Harbour Mutual';
const YEARS = 4;
// ⚠ A SEED, NOT A FIXTURE, AND THAT DISTINCTION IS WHY THIS DRIVER BROKE ONCE.
// It used to be chosen so the draw returned a NAMED event in a CONVENIENT year,
// and both halves of that were pinned below: WILDFIRE, and year 2. Adding nine
// events to the catalog changed what a uniform draw returns — WINTER-STORM now —
// and three assertions failed for a reason that was not a defect. Nothing below
// names an event or a year any more; everything is read back from the room.
const SEED = 'RFHZCGF2';

// id -> THE NAME A PLAYER SEES, which is `eventName`, NOT the catalog's `name`.
//
// ⚠ THIS DRIVER HAD TWO STALE PINS, NOT ONE, AND THIS IS THE SECOND. It
// asserted "Major Wildfire" on the PLAYER'S screen. That is WILDFIRE's `name` —
// what the HOST picks from. The player is shown `eventName`, which for WILDFIRE
// is "Wildfire", because a scheduled event is deliberately made to read exactly
// like a drawn one: showing the catalog name would tell a player which events
// were scheduled and which were drawn. So the screen assertion had ALREADY
// become wrong when the two names were split apart, independently of the draw
// changing — it would fail today even if the draw still returned WILDFIRE.
//
// Reading `eventName ?? name` here is the same fallback shockName() applies in
// utils/yearEvents.ts, so the driver follows the app's rule rather than keeping
// a second copy of it. Spawned once; session-drivers already start tsx children
// (two-contexts runs the stub server that way), and the alternative — restating
// 17 names in a test file — is the staleness this commit removes, one layer on.
function catalogNames() {
  const out = execFileSync('npx', ['tsx', '-e',
    "import{drawableShocks}from'./src/session/shockDraw';" +
    "console.log(JSON.stringify(Object.fromEntries(drawableShocks().map(d=>[d.id,d.eventName??d.name]))))",
  ], { cwd: REPO, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

// ONE EVENT PER THREE YEARS, rounded, never none — shockDrawCount in
// session/shockDraw.ts. Restated as an expectation rather than imported so that
// a change to the RULE is a visible failure here and not a silently tracked one.
const expectedDrawCount = y => Math.max(1, Math.round(y / 3));

const sameSchedule = (a, b) =>
  JSON.stringify((a || []).map(s => [s.shockId, s.yearNumber])) ===
  JSON.stringify((b || []).map(s => [s.shockId, s.yearNumber]));

const fails = [];
let checks = 0;
function ok(c, w) { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w); } else console.log('  ok    ' + w); }

async function nudge(page, label, presses) {
  const el = await page.evaluateHandle((lbl) => {
    for (const input of document.querySelectorAll('input[type=range]')) {
      let n = input.parentElement;
      for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
        if (n.textContent && n.textContent.includes(lbl)) return input;
      }
    }
    return null;
  }, label);
  const input = el.asElement();
  if (!input) return null;
  await input.focus();
  for (let i = 0; i < presses; i++) await page.keyboard.press('ArrowRight');
  return input.evaluate(e => e.value);
}

const room = (page, code) => page.evaluate(c =>
  JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c)), code);

// The player's own Results page for one year, as text. Parameterised because
// the year this driver cares about is now whatever the room says was drawn.
async function resultsYearText(page, year) {
  const rx = new RegExp(`Year ${year} `);
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await page.waitForTimeout(600);
  // ⚠ PIN THE LINE VIEW TO POOL, AND THIS IS NOT COSMETIC. The line view is
  // shared state: the decision loop above selects a LINE tab, and that selection
  // was still in force here, so this read landed on "Annual Results — Workers'
  // Compensation". A Property event correctly does not appear on the WC view, so
  // the page was right and the read was wrong. The old driver never met this
  // because it only ever read AFTER a reload, where the view has reset to Pool —
  // which means the pass was an accident of ordering, not a property of the test.
  const pool = page.getByRole('button', { name: 'Pool', exact: true }).first();
  if (await pool.count() > 0) { await pool.click(); await page.waitForTimeout(350); }
  const sel = page.locator('select').filter({ has: page.locator('option', { hasText: rx }) }).first();
  await sel.selectOption({ label: (await sel.locator('option', { hasText: rx }).first().textContent()).trim() });
  await page.waitForTimeout(500);
  return page.locator('main').innerText();
}

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  let player = await ctx.newPage();
  const errs = [];
  for (const p of [host, player]) p.on('pageerror', e => errs.push(e.message));

  const NAMES = catalogNames();
  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="seed"]', SEED);
  await host.fill('[data-testid="year-count"]', String(YEARS));
  await host.fill('[data-testid="expected-teams"]', '1');

  // ---- THE HOST RANDOMISES, AND THE ROOM HOLDS WHAT THE HOST SAW -----------
  // The draw is the host client's, once, here. What the room carries has to be
  // exactly the list the host was shown — concrete entries, not a recipe that a
  // client re-runs — or teams could face a schedule nobody saw.
  await host.click('[data-testid="randomise-shocks"]');
  await host.waitForSelector('[data-testid="shock-list"]');
  const shown = await host.$$eval('[data-testid="shock-list"] li', lis => lis.map(li => li.textContent.replace(/\s+/g, ' ').trim()));
  console.log(`  host sees the draw: ${JSON.stringify(shown)}`);
  // ⚠ NON-EMPTY IS THE HALF THAT MATTERS, AND IT IS NOT ENOUGH ON ITS OWN. A
  // driver that only asked "is there a schedule" would pass on a game with no
  // schedule the moment the assertion was written wrongly, so the COUNT is
  // pinned to the rule (one per three years) and the YEARS are pinned to the
  // range the drawer promises — never year 1, so every team makes one full round
  // of decisions before anything lands. Neither pins WHICH event.
  ok(shown.length === expectedDrawCount(YEARS)
     && shown.every(t => /year (\d+)/.test(t) && +t.match(/year (\d+)/)[1] >= 2 && +t.match(/year (\d+)/)[1] <= YEARS),
    `Randomise drew a non-empty schedule the host can see — ${shown.length} entry/entries for a ${YEARS}-year game, none in year 1`);
  ok(await host.locator('[data-testid="shock-drawn-note"]').count() === 1, 'the host is told what the schedule was drawn from');

  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  console.log(`\nroom ${code}\n`);
  const carried = (await room(host, code)).shocks;
  // The room must carry EXACTLY the list the host was shown — concrete entries,
  // not a recipe a client re-runs. Checked against the host's own rendered list
  // rather than against a literal, so the two surfaces are tied to each other
  // and neither is tied to a particular catalog.
  ok((carried || []).length > 0
     && carried.length === shown.length
     && carried.every(s => shown.some(t => t.includes(s.shockId) && t.includes(`year ${s.yearNumber}`))),
    `the room record carries exactly what the host was shown, entry for entry (${JSON.stringify(carried)})`);

  // ⚠ PLAY FAR ENOUGH TO REACH THE EVENT. The old driver played three years of a
  // four-year game while the drawer picks from years 2..4, so a draw landing in
  // year 4 could never have appeared on any screen — the seed was quietly doing
  // a SECOND job, pinning a convenient year as well as a convenient event.
  // Measured over eight seeds on a four-year game the draw lands in year 4 twice,
  // so that was not hypothetical, it was unlucky. The number of years played is
  // now read from the schedule.
  const drawnYears = carried.map(s => s.yearNumber);
  const PLAY = Math.max(3, ...drawnYears);
  const eventName = s => NAMES[s.shockId] || s.shockId;
  console.log(`  schedule: ${carried.map(s => `${eventName(s)} (${s.shockId}) in year ${s.yearNumber}`).join('; ')}`);
  console.log(`  playing ${PLAY} years so every drawn year is reached\n`);

  await player.goto(`/join/${code}`);
  await player.waitForSelector('[data-testid="team-picker"]');
  await player.fill('[data-testid="team-name"]', TEAM);
  // ⚠ ALL THREE LINES: the wildfire's property catastrophe lands on Property,
  // and a WC-only book would see only its secondary WC claims.
  await player.click('[data-testid="pick-line-WC"]');
  await player.click('[data-testid="pick-line-GL"]');
  await player.click('[data-testid="pick-line-Property"]');
  await player.click('[data-testid="join-team"]');
  await player.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 });

  const postedAt = {};
  const fcValues = [];

  for (let year = 1; year <= PLAY; year++) {
    await player.getByRole('button', { name: /Lock Year/ }).first().waitFor({ timeout: 120000 });
    // ⚠ A DIFFERENT SET EVERY YEAR. Without variation the two replay rules give
    // the same answer and the test proves nothing.
    {
      await player.getByRole('button', { name: 'Decisions', exact: true }).click();
      await player.waitForTimeout(400);
      // ⚠ REPOINTED FROM 'Risk Control Investment' TO 'Funding Confidence Level'
      // WHEN THE RISK CONTROL SLIDER WAS RETIRED, AND FOR THIS DRIVER THAT WAS
      // NOT OPTIONAL. The risk control slider was this driver's ONLY source of
      // year-to-year variation, and the note above says why that matters:
      // without variation the two replay rules give the same answer and the test
      // proves nothing. Deleting the nudge would have left the driver green and
      // empty — the exact failure mode the label collision was avoided to
      // prevent — so it is repointed at another real decision rather than
      // dropped.
      //
      // Funding confidence is the stronger choice anyway: it is the pool's only
      // pricing lever, so it moves premium, surplus and loss ratio together,
      // which is what the endingSurplus assertion below actually needs.
      //
      // THE TAB MOVED TOO. The Pool tab now carries NO range input — AllocationBar
      // is not one, and the retired slider was its only SliderInput — so the old
      // 'Pool' click would have searched a tab with nothing to find. The line tab
      // is DETECTED by display name rather than assumed.
      //
      // ⚠ YEAR 1 NOW READS THE SLIDER INSTEAD OF ASSUMING IT. It used to push a
      // literal '0', which was the RETIRED risk-control slider's default and is
      // NOT funding confidence's (0.60). Left alone, the set-size assertion below
      // would have compared a fabricated year-1 value against two real ones and
      // passed on it. Reading with zero presses finds the same input and returns
      // its value without moving it.
      const lineBtn = player.getByRole('button', { name: /Workers' Compensation|General Liability|^Property$/ }).first();
      if (await lineBtn.count() > 0) { await lineBtn.click(); await player.waitForTimeout(350); }
      const v = await nudge(player, 'Funding Confidence Level', year > 1 ? 3 : 0);
      fcValues.push(v);
    }
    await player.getByRole('button', { name: /Lock Year/ }).first().click();
    await player.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });

    await host.click('[data-testid="advance"]');
    await host.waitForFunction(y => document.querySelector('[data-testid="current-year"]')?.textContent.trim() === String(y), year + 1, { timeout: 30000 });
    // ⚠ WAIT ON THE RECORD, NOT ON THE STRIP. The strip reads processedYear,
    // which is set when the result is PRODUCED — before the submit that carries
    // it has landed. Reading the room then captures the PREVIOUS year's summary
    // and silently compares the wrong two things.
    await host.waitForFunction(([c, y]) => {
      const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
      return !!r && !!(r.teams[0]?.resultsByYear || {})[String(y)];
    }, [code, year], { timeout: 240000 });

    const rec = await room(host, code);
    postedAt[year] = JSON.parse(JSON.stringify(rec.teams[0].resultsByYear[String(year)]));
    console.log(`  year ${year}: fundingConfidence=${fcValues[year - 1]}  postedYear=${postedAt[year].yearNumber}  surplus=${postedAt[year].pool.endingSurplus.toFixed(2)}  lossRatio=${postedAt[year].pool.actualLossRatioPricingBasis.toFixed(4)}`);
  }

  ok(new Set(fcValues).size === PLAY, `the ${PLAY} years used ${PLAY} DIFFERENT decision sets (${fcValues.join(', ')})`);
  ok(postedAt[1].pool.endingSurplus !== postedAt[PLAY].pool.endingSurplus, 'and those choices moved the numbers');

  const histBefore = (await room(host, code)).teams[0].decisionsByYear;
  const wantHist = Array.from({ length: PLAY }, (_, i) => String(i + 1)).join(',');
  ok(Object.keys(histBefore || {}).map(Number).sort((a, b) => a - b).join(',') === wantHist, `the room holds a decision history (${Object.keys(histBefore || {}).join(',')})`);

  // ---- THE SCHEDULE TOOK EFFECT AT ALL, BEFORE ANY RELOAD -----------------
  // ⚠ THIS IS THE HALF THE OLD DRIVER DID NOT HAVE, AND IT IS WHAT MAKES THE
  // LOOSENING SAFE. Reading the room for "a schedule exists" would pass on a
  // game where the schedule was carried and never fired. Naming the drawn event
  // on its own year's Results BEFORE the reload proves it reached the engine;
  // the same read AFTER proves the rebuild kept it. Neither read knows which
  // event it is looking for until the room tells it.
  const namedBefore = [];
  for (const s of carried) {
    const txt = await resultsYearText(player, s.yearNumber);
    console.log(`  year ${s.yearNumber} before the reload: names ${JSON.stringify(eventName(s))} = ${txt.includes(eventName(s))}`);
    namedBefore.push(txt.includes(eventName(s)));
  }
  ok(namedBefore.length > 0 && namedBefore.every(Boolean),
    `BEFORE THE RELOAD each drawn event is named on its own year's Results (${carried.map(s => `${eventName(s)} y${s.yearNumber}`).join('; ')})`);

  const playerSurplusBefore = (await player.locator('header').innerText()).match(/Surplus\s*\n?\s*(\S+)/)?.[1];

  // ---- RELOAD: rebuild from the seed and replay ---------------------------
  await player.reload();
  await player.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  // Same discipline after the reload: wait for the re-post to be IN the record.
  // ⚠ PLAY IS PASSED IN, NOT CLOSED OVER. This callback is serialised and run in
  // the PAGE, where a node-side const does not exist; the year used to be a
  // literal '3' so the distinction never came up.
  await host.waitForFunction(([c, p]) => {
    const r = JSON.parse(localStorage.getItem('ripple.session.v1.room.' + c) || 'null');
    return !!r && !!(r.teams[0]?.resultsByYear || {})[String(p)];
  }, [code, PLAY], { timeout: 300000 });
  await player.waitForTimeout(1200);

  const rebuilt = (await room(host, code)).teams[0].resultsByYear[String(PLAY)];
  console.log(`\n  posted at the time : surplus=${postedAt[PLAY].pool.endingSurplus.toFixed(2)} lossRatio=${postedAt[PLAY].pool.actualLossRatioPricingBasis.toFixed(4)}`);
  console.log(`  after the reload   : surplus=${rebuilt.pool.endingSurplus.toFixed(2)} lossRatio=${rebuilt.pool.actualLossRatioPricingBasis.toFixed(4)}`);

  ok(rebuilt.pool.endingSurplus === postedAt[PLAY].pool.endingSurplus, 'REBUILT SURPLUS === WHAT WAS POSTED AT THE TIME');
  const roomAfter = await room(host, code);
  ok(carried.every(s => JSON.stringify(roomAfter.teams[0].resultsByYear[String(s.yearNumber)]) === JSON.stringify(postedAt[s.yearNumber])),
    `the drawn year${carried.length > 1 ? 's' : ''} (${drawnYears.join(', ')}) rebuilt field for field as posted`);

  // ---- THE SCHEDULE ITSELF SURVIVED, ENTRY FOR ENTRY ----------------------
  // ⚠ THE OLD DRIVER NEVER CHECKED THIS. It compared RESULTS across the reload
  // and inferred the schedule from them, which it could do only because it knew
  // the answer in advance. Reading the record directly is both stronger and the
  // thing that no longer needs a fixture: a rebuild that re-drew the schedule
  // instead of reading the room would change it here even when the drawn event
  // happened to be the same.
  ok((roomAfter.shocks || []).length > 0 && sameSchedule(roomAfter.shocks, carried),
    `AFTER THE RELOAD the room still carries the SAME schedule, entry for entry (${JSON.stringify(roomAfter.shocks)})`);

  // ---- AND IT IS STILL ON THE PLAYER'S OWN SCREEN -------------------------
  // The identities above would ALSO hold if both the first play and the rebuild
  // had dropped the schedule. This is the check that separates the two.
  const namedAfter = [];
  for (const s of carried) namedAfter.push((await resultsYearText(player, s.yearNumber)).includes(eventName(s)));
  ok(namedAfter.length > 0 && namedAfter.every(Boolean),
    `AFTER THE RELOAD the player's Results still name each drawn event in its own year — the rebuild did not drop the schedule`);

  // Year 1 is never drawn (shockDraw excludes it so every team makes one full
  // round of decisions first), so it is a negative control the drawer guarantees
  // rather than one this driver had to arrange.
  const y1Text = await resultsYearText(player, 1);
  ok(carried.every(s => !y1Text.includes(eventName(s))), 'and year 1 names none of them — each event fired in its own year only');
  ok(rebuilt.pool.actualLossRatioPricingBasis === postedAt[PLAY].pool.actualLossRatioPricingBasis, 'rebuilt loss ratio matches too');
  ok(JSON.stringify(rebuilt) === JSON.stringify(postedAt[PLAY]), `the whole year-${PLAY} summary is identical, field for field`);

  // ---- two paths to one number -------------------------------------------
  const playerSurplusAfter = (await player.locator('header').innerText()).match(/Surplus\s*\n?\s*(\S+)/)?.[1];
  ok(playerSurplusAfter === playerSurplusBefore, `the player's own screen is unchanged by the reload (${playerSurplusBefore} -> ${playerSurplusAfter})`);

  await host.click('[data-testid="host-tab-teams"]');
  await host.waitForTimeout(900);
  const hostCell = (await host.textContent(`[data-testid="surplus-${TEAM}"]`)).trim();
  console.log(`\n  player header cell : ${playerSurplusAfter}`);
  console.log(`  host Teams cell    : ${hostCell}`);
  ok(hostCell === playerSurplusAfter, 'HOST AND PLAYER AGREE EXACTLY — two paths, one number');

  console.log('\n  page errors        :', errs.length ? errs : 'none');
  await browser.close();
  console.log(`\nreplay-fidelity: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log('REPLAY FIDELITY PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
