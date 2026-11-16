// ============================================================================
// THE LOBBY WALK — create an event, see it listed, join as a leader, join as a
// viewer, advance, confirm a NEW leader is refused and a viewer is not, hide
// it, finish it.
//
// ⚠ IT DRIVES THE SCREENS, NOT THE TRANSPORT. Every assertion below is made
// against what a browser renders or what a real click does, because the thing
// being checked is that the lobby, the join screen and the host's control agree
// with the server — and a test that called the transport directly would agree
// with itself no matter what the screens did.
//
// ⚠ ONE EXCEPTION, AND IT IS DELIBERATE: the LATE-JOIN refusal is asserted
// BOTH ways. The screen greys Team Leader out, which is what a player sees; the
// SERVER refusal is checked by posting a join straight through the transport,
// because a greyed card proves nothing about a client that skips the lobby. The
// brief asks for the server to refuse, not only the screen, so both are here.
//
//   node scripts/tools/session-drivers/lobby.cjs
//
// CONFIRMED TO FAIL — each assertion was turned red against a deliberately
// broken build before this file was committed; see the commit message for the
// six and what each one read.
// ============================================================================

const { BASE, launchBrowser, requireServer, asPlayer, asAdmin } = require('./_shared.cjs');

const EVENT = `Lobby Walk ${Math.floor(Math.random() * 9000 + 1000)}`;
const LEADER = 'Harbour Mutual';

let failures = 0;
const ok = (label) => console.log(`  ok    ${label}`);
const bad = (label, detail) => { failures++; console.log(`  FAIL  ${label}\n        ${detail}`); };
const check = (cond, label, detail) => (cond ? ok(label) : bad(label, detail));

// ⚠ THE LISTING ITSELF, NOT THE SCREEN'S VIEW OF IT. The lobby renders OPEN
// rows and IN_PROGRESS rows and nothing else, so a FINISHED event the transport
// wrongly returned would be filtered out by the SCREEN and the walk would pass
// on a leak. Asked of the transport, the question is the one being claimed.
async function listedCodes(page) {
  return page.evaluate(async () => {
    const res = await window.__ripple.transport.listEvents({});
    return res.events.map(e => `${e.code}:${e.status}`);
  });
}

async function lobbyRows(page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="open-events"]');
  return page.evaluate(() => {
    const read = (sel) => [...document.querySelectorAll(`${sel} [data-testid^="event-"]`)]
      .map(el => ({
        code: el.getAttribute('data-testid').replace('event-', ''),
        text: el.innerText.replace(/\s+/g, ' ').trim(),
      }));
    return { open: read('[data-testid="open-events"]'), running: read('[data-testid="running-events"]') };
  });
}

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1000 } });

  // ⚠ EVERY PAGE UP FRONT, as the viewer driver does. A page opened later in
  // the same context starts with whatever credentials the others have already
  // written, which changes what its join screen offers.
  const host = await ctx.newPage();
  const viewerA = await ctx.newPage();
  const viewerB = await ctx.newPage();

  // ---- 1. the host creates an event ---------------------------------------
  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');

  // ⚠ THE EVENT NAME IS REQUIRED NOW, so the button must be dead before it is
  // typed. Checked here rather than in its own driver because this is the one
  // place the field's being required actually matters to anything.
  const disabledWhenUnnamed = await host.isDisabled('[data-testid="create-room"]');
  check(disabledWhenUnnamed, 'create is refused with no event name',
    'the Create button was enabled before any event name was typed');

  await host.fill('[data-testid="event-name"]', EVENT);
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="expected-teams"]', '2');
  await host.click('[data-testid="create-room"]');
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  ok(`created ${code}`);

  // ---- 2. it is listed, OPEN ----------------------------------------------
  const player = await ctx.newPage();
  let rows = await lobbyRows(player);
  let row = rows.open.find(r => r.code === code);
  check(!!row, 'the new event is listed under Open events',
    `lobby showed open=[${rows.open.map(r => r.code)}] running=[${rows.running.map(r => r.code)}]`);
  check(!!row && row.text.includes(EVENT), 'the row carries the event name',
    `row read: ${row ? row.text : '(absent)'}`);
  check(!!row && /0 teams so far/.test(row.text), 'the row reads 0 teams so far',
    `row read: ${row ? row.text : '(absent)'}`);

  // ---- 2b. Play Solo and Host an Event are SHOWN and go somewhere ---------
  // ⚠ THERE WAS NO ASSERTION HERE WHEN THEY WERE HIDDEN, so turning them on
  // moved nothing and no test noticed. Both cards shipped behind a switch; a
  // switch with nothing watching it is a switch that gets flipped back by
  // accident. These check that each renders AND that its click lands on the
  // right screen — a card that rendered and went nowhere would pass a
  // presence-only check.
  check(await player.isVisible('[data-testid="play-solo"]'), 'Play Solo is shown on the lobby',
    'the Play Solo card did not render — SHOW_PLAY_SOLO is off');
  check(await player.isVisible('[data-testid="host-an-event"]'), 'Host an Event is shown on the lobby',
    'the Host an Event card did not render — SHOW_HOST_AN_EVENT is off');

  await player.click('[data-testid="play-solo"]');
  await player.waitForTimeout(800);
  check(new URL(player.url()).pathname === '/solo', 'Play Solo leads to /solo',
    `Play Solo landed on ${new URL(player.url()).pathname}`);

  await lobbyRows(player);
  await player.click('[data-testid="host-an-event"]');
  await player.waitForTimeout(800);
  const hostLanded = new URL(player.url()).pathname === '/host'
    && await player.isVisible('[data-testid="create-room"]');
  check(hostLanded, 'Host an Event leads to host setup',
    `Host an Event landed on ${new URL(player.url()).pathname}, create-room visible: `
    + `${await player.isVisible('[data-testid="create-room"]')}`);

  // ---- 3. join as a team leader, from the lobby ---------------------------
  // ⚠ AS A PLAYER, NOT AN ADMIN: since aws's admin accounts an admin's event
  // row offers host and delete, a player's offers join. The steps above ran
  // as the admin (ADMIN_TOKEN); everything from here is a team's.
  if (process.env.ADMIN_TOKEN) { await asPlayer(player); await player.reload(); }
  await lobbyRows(player);
  await player.click(`[data-testid="join-${code}"]`);
  await player.waitForSelector('[data-testid="role-choice"]');
  check(await player.isVisible('[data-testid="team-leader"]'),
    'Team Leader is offered while the event is OPEN',
    'the Team Leader card rendered as unavailable on an OPEN event');
  await player.fill('input[placeholder*="Harbour"]', LEADER);
  await player.click('button:has-text("Join as this team")');
  await player.waitForTimeout(1500);
  ok(`joined as ${LEADER}`);

  rows = await lobbyRows(player);
  row = rows.open.find(r => r.code === code);
  check(!!row && /1 team so far/.test(row.text), 'the row now reads 1 team so far',
    `row read: ${row ? row.text : '(absent)'}`);

  // ---- 4. join as a viewer ------------------------------------------------
  // ⚠ WAIT FOR THE SESSION STRIP, NOT FOR THE PICKER TO VANISH. Entering as a
  // viewer builds the whole game before the screen changes, which is slower
  // than any fixed timeout worth writing — the first version of this driver
  // waited 1.2s, read the picker still there and reported a refusal that had
  // not happened. The strip is the screen saying it is in.
  await viewerA.goto(`/view/${code}`);
  await viewerA.waitForSelector(`[data-testid="watch-${LEADER}"]`, { timeout: 30000 });
  await viewerA.click(`[data-testid="watch-${LEADER}"]`);
  const followedOpen = await viewerA.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 })
    .then(() => true).catch(() => false);
  check(followedOpen, 'a viewer can follow a team while the event is OPEN',
    'the viewer never reached the session strip after choosing a team');

  // ---- 5. the host advances: OPEN -> IN PROGRESS --------------------------
  // The host is the admin again (one context: asPlayer above logged it out).
  await asAdmin(host);
  await host.reload();
  await host.waitForSelector('[data-testid="advance"]');
  await host.click('[data-testid="advance"]');
  await host.waitForTimeout(1500);

  rows = await lobbyRows(player);
  check(!rows.open.some(r => r.code === code), 'it has left Open events after the first advance',
    'the advanced event was still listed as open');
  row = rows.running.find(r => r.code === code);
  check(!!row, 'it is listed under Already under way',
    `lobby showed running=[${rows.running.map(r => r.code)}]`);
  check(!!row && /VIEWERS ONLY/.test(row.text) && /no new teams can join/.test(row.text),
    'the in-progress row says viewers only',
    `row read: ${row ? row.text : '(absent)'}`);

  // ---- 6. a NEW leader is refused; a viewer is not ------------------------
  const latecomer = await ctx.newPage();
  await latecomer.goto(`/join/${code}`);
  await latecomer.waitForSelector('[data-testid="role-choice"]');
  check(await latecomer.isVisible('[data-testid="team-leader-unavailable"]'),
    'the screen shows Team Leader unavailable once in progress',
    'the Team Leader card was still offered on an in-progress event');

  // ⚠ AND THE SERVER REFUSES IT, which is the half a greyed card cannot prove.
  const refusal = await latecomer.evaluate(async (c) => {
    const handle = window.__ripple;
    if (!handle || !handle.transport) return { noHandle: true };
    try {
      await handle.transport.join({ code: c, teamName: 'Johnny Come Lately', role: 'player' });
      return { code: 'NO_ERROR' };
    } catch (e) {
      return { code: e && e.code ? e.code : String(e) };
    }
  }, code);
  if (refusal.noHandle) {
    bad('the SERVER refuses a late team', 'no transport on window.__ripple — see installFaultHandle');
  } else {
    check(refusal.code === 'EVENT_IN_PROGRESS', 'the SERVER refuses a late team',
      `join returned ${refusal.code}, expected EVENT_IN_PROGRESS`);
  }

  await viewerB.goto(`/view/${code}`);
  await viewerB.waitForSelector(`[data-testid="watch-${LEADER}"]`, { timeout: 30000 });
  await viewerB.click(`[data-testid="watch-${LEADER}"]`);
  const followedLate = await viewerB.waitForSelector('[data-testid="session-strip"]', { timeout: 120000 })
    .then(() => true).catch(() => false);
  check(followedLate, 'a viewer may still join once in progress',
    'the viewer was refused on an in-progress event');

  // ---- 7. hide it ---------------------------------------------------------
  await asAdmin(host);
  await host.reload();
  await host.waitForSelector('[data-testid="hide-toggle"]');
  await host.click('[data-testid="hide-toggle"]');
  await host.waitForTimeout(1200);

  rows = await lobbyRows(player);
  check(!rows.open.concat(rows.running).some(r => r.code === code),
    'a hidden event leaves the lobby',
    'the hidden event was still listed');
  const whileHidden = await listedCodes(player);
  check(!whileHidden.some(e => e.startsWith(`${code}:`)),
    'a hidden event is out of the listing itself',
    `listEvents still returned [${whileHidden}]`);

  // ⚠ AND ITS DIRECT LINK STILL WORKS. Hiding is about who can FIND it.
  const direct = await ctx.newPage();
  await direct.goto(`/view/${code}`);
  await direct.waitForSelector('[data-testid="viewer-picker"], [data-testid="claim-error"]');
  check(await direct.isVisible('[data-testid="viewer-picker"]'),
    'a direct link to a hidden event still works',
    'the hidden room could not be reached by its code');

  // ---- 8. finish it -------------------------------------------------------
  // Unhide first, so FINISHED is what takes it off the lobby rather than hidden.
  await host.click('[data-testid="hide-toggle"]');
  await host.waitForTimeout(900);
  rows = await lobbyRows(player);
  check(rows.running.some(r => r.code === code), 'unhiding puts it back on the lobby',
    'the unhidden event did not return to the listing');

  for (let i = 0; i < 8; i++) {
    await host.reload();
    await host.waitForTimeout(600);
    const advance = await host.$('[data-testid="advance"]');
    if (!advance) break;
    if (await advance.isDisabled()) break;
    await advance.click();
    await host.waitForTimeout(900);
  }
  rows = await lobbyRows(player);
  check(!rows.open.concat(rows.running).some(r => r.code === code),
    'a finished event is off the lobby screen',
    'the finished event was still rendered');
  const afterFinish = await listedCodes(player);
  check(!afterFinish.some(e => e.startsWith(`${code}:`)),
    'a finished event is out of the listing itself',
    `listEvents still returned [${afterFinish}]`);

  await browser.close();
  console.log();
  if (failures > 0) { console.log(`LOBBY WALK FAILED — ${failures} assertion(s).`); process.exit(1); }
  console.log('LOBBY WALK PASS');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
