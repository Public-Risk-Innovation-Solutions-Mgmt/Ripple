// ============================================================================
// THE BROWSER DRIVERS FOR THE SESSION LAYER — shared setup.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/solo-oracle.cjs
//   node scripts/tools/session-drivers/host-charts.cjs        # ... and the rest
//
// ⚠ THEY NEED A BUILT APP AND A SERVER, WHICH IS WHY THERE IS NO npm SCRIPT.
// This is render-identity-check.ts's call, made for the same reason: a bare
// `npm run drivers` that assumed a server would fail confusingly for anyone who
// had not started one. SESSION_URL points them elsewhere (default :4173).
//
// ⚠ AND THEY EXIST IN THE REPOSITORY BECAUSE THE SOLO ORACLE DID NOT. Eight
// instruments produced every count quoted in 22 commit messages on this branch
// while living in a session scratchpad, which made all 22 unreproducible by
// anyone reading the repo. That is SESSION_PRACTICES.md §1 — recorded, then
// left open on eight instruments rather than one. This directory closes it.
//
// THE NINE, AND WHAT EACH IS FOR:
//
//   solo-oracle       46  the SOLO game's UI, 11 tabs x 2 line views x 2 year
//                         points, fingerprinted. ⚠ WC-ONLY — see the caveat below.
//   host-charts       45  the Charts tab: four charts, three states, the fixed
//                         axis, the developed column, a tab three years behind.
//   full-session      33  a whole game end to end, four tabs, one browser.
//   viewer            33  /view as a read-only flag: no writes, and after each of
//                         three years the viewer's statement is the player's
//                         and the host's developed column is its Net Ultimates.
//   two-contexts      16  a full session across two browser CONTEXTS against the
//                         stub server. Starts and stops the stub itself.
//   four-tabs         15  four tabs sharing one localStorage — the arrangement
//                         that found the identity leak and the lost update.
//   host-teams        13  the Teams tab's three states on three line views.
//   replay-fidelity    8  vary decisions across three years, reload, and require
//                         the rebuilt results to match what was posted AT THE TIME.
//   downloads          7  clicks all three export buttons and requires a file to
//                         arrive with no page error. ⚠ THE ONLY ONE THAT CLICKS A
//                         DOWNLOAD. Added after the Results workbook was broken
//                         for a week behind a green solo-export-guard: the guard
//                         calls the builder itself and the builder was correct,
//                         so the defect lived entirely in the PAGE'S CALL and
//                         nothing in the repo exercised it.
//
// ⚠ THE SOLO ORACLE'S 46/46 PROVES CONFINEMENT, NOT CORRECTNESS, and shipping it
// does not change that. It plays WC-only. Every Membership defect found this
// month lived in a configuration it never plays — GL-only and Property-only open
// with an empty roster, WC+GL opened showing 65 of 112 members. The instrument
// that covers those is render-identity-check.ts on feature/member-satisfaction,
// which plays five configurations; this one is kept because it is what the 46/46
// in the commit messages refers to, and a cited number with no instrument behind
// it is the failure being fixed here.
//
// ⚠ .cjs AND NOT .js, AND THE RENAME IS ITSELF ONE OF THE FINDINGS. These ran
// in a scratchpad whose package.json had no "type": "module", so `.js` meant
// CommonJS there. This repo's package.json DOES set it, so the first run from
// the repository failed on every one of the eight at `require is not defined in
// ES module scope`. They were never portable; nothing had ever asked them to be.
// The extension states what they are rather than leaving it to a directory.
//
// ============================================================================
// ⚠ WHAT SURVIVES THE MERGE INTO feature/member-satisfaction, AND WHAT DOES NOT.
//
// That branch carries four engine changes these drivers have never run against:
// WC's supplied CLF curve, WC's shared year factor, GL's triangle contraction
// re-solve, and the satisfaction scale. Every number this layer displays will
// move. Almost none of these assertions care, and the reason is worth stating
// because it is what makes the merge checkable rather than a guess:
//
// VALUE-DEPENDENT — expect these to go red, and re-take rather than debug:
//
//   · solo-oracle, ALL 46 FINGERPRINTS. Each is a SHA-256 of a page's visible
//     text, and every tab that shows a number will hash differently. 46/46 will
//     become 0/46. That is a RE-CAPTURE, and it is only legitimate once you can
//     say which engine change moved which screen — the same rule the value
//     baselines carry. A re-capture to make a run green measures nothing after.
//   · host-charts.cjs, ONE assertion: that an aged accident year's ultimate
//     holds steady after its first booking. It was `dev1At3 > booked1 * 1.05`,
//     growth of at least 5% over two valuations, until full-cost booking removed
//     development; it is restated when development returns. If it goes red,
//     an aged year has moved: either development has come back (restate the
//     assertion, deliberately) or something is restating prior years that
//     should not be (a real defect).
//
// STRUCTURAL — these should pass unchanged, and a red one is a REAL defect:
//
//   Everything else, and not by luck. They assert RELATIONSHIPS rather than
//   magnitudes: that two independent computations of the same engine agree
//   (replay-fidelity's field-for-field match, viewer's output equalling the
//   driver's, the host's cell equalling the player's header), that a state is
//   distinct from another state (absent vs pending vs reported), that a count of
//   points or teams or locks is right, that a control is present and disabled.
//   None of those has an engine value in it. Change what the engine computes and
//   they are all still true — which is the property that lets a session layer be
//   tested at all while the engine underneath is moving.
//
// So the merge check is: run all eight, expect solo-oracle to go fully red and
// one host-charts line to be at risk, and treat ANY other red as the session
// layer having broken.
// ============================================================================
//
// ⚠ CHROMIUM IS PREINSTALLED AND MUST NOT BE DOWNLOADED. The container keeps it
// at PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, where `chromium` is a symlink to
// the build Playwright would otherwise fetch. `npx playwright install` is never
// the answer here; PLAYWRIGHT_CHROMIUM overrides the path if this ever runs
// somewhere that keeps it elsewhere.
// ============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

/** The repo root, from this file rather than from a hardcoded absolute path. */
const REPO = path.resolve(__dirname, '..', '..', '..');

/** Where the built app is being served. The preview port, not vite's dev port. */
const BASE = process.env.SESSION_URL || 'http://localhost:4173';

/**
 * ⚠ RESOLVED, NOT ASSUMED. The pinned Playwright expects one Chromium build and
 * the container ships another; launching without a path downloads a browser, and
 * on a machine with no network that is a confusing failure a long way from its
 * cause. Undefined at the end is deliberate: somewhere with its own browsers,
 * Playwright's own lookup is the right answer.
 */
function chromiumPath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM,
    '/opt/pw-browsers/chromium',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* keep looking */ }
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    const build = fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
    if (build) {
      const exe = path.join(root, build, 'chrome-linux', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  } catch { /* fall through */ }
  return undefined;
}

// ⚠ HOSTING NEEDS AN ADMIN SINCE THE ADMIN ACCOUNTS (aws 20efa6e): /host
// shows a login in place of the create form when nobody is logged in. With
// ADMIN_TOKEN set (a token from the admin service's adminLogin — locally,
// scripts/tools/dev-admin-server.ts, with the build's VITE_ADMIN_API pointing
// at it) every context this browser opens carries it in localStorage before
// any page script runs, so the host screens open as a logged-in admin. Unset,
// nothing changes.
const ADMIN_TOKEN_KEY = 'ripple.admin.token';
const AS_PLAYER_KEY = 'ripple.driver.asPlayer';

/**
 * From here on this page's context is NOT an admin: the admin token is
 * removed and the launcher stops putting it back. For a driver that plays a
 * team in the same context it hosted from — on aws's lobby an admin's event
 * rows offer host and delete, a player's offer join.
 */
/** Undo asPlayer: the context is the admin again (ADMIN_TOKEN), for a host step. */
async function asAdmin(page) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return;
  await page.evaluate(([k, p, t]) => { localStorage.removeItem(p); localStorage.setItem(k, t); }, [ADMIN_TOKEN_KEY, AS_PLAYER_KEY, token]);
}

async function asPlayer(page) {
  await page.evaluate(([k, p]) => { localStorage.setItem(p, '1'); localStorage.removeItem(k); }, [ADMIN_TOKEN_KEY, AS_PLAYER_KEY]);
}

async function launchBrowser() {
  const executablePath = chromiumPath();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const token = process.env.ADMIN_TOKEN;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    const ctx = await newContext(opts);
    // Skipped while the context is acting as a player (asPlayer below).
    if (token) await ctx.addInitScript(([k, t, p]) => {
      try { if (localStorage.getItem(p) === null) localStorage.setItem(k, t); } catch { /* opaque origin */ }
    }, [ADMIN_TOKEN_KEY, token, AS_PLAYER_KEY]);
    // ⚠ THE RECOVERY CODE (aws 45a7342): a team's creating join shows it once,
    // in a modal that holds the game screen back until "I've saved it". No
    // driver asserts it, so every context dismisses it as it appears.
    await ctx.addInitScript(() => {
      const dismiss = () => { const b = document.querySelector('[data-testid="recovery-code-saved"]'); if (b) b.click(); };
      new MutationObserver(dismiss).observe(document, { childList: true, subtree: true });
    });
    return ctx;
  };
  return browser;
}

/** Fail loudly and early if nothing is serving, rather than 30s into a timeout. */
async function requireServer() {
  try {
    const res = await fetch(BASE, { method: 'GET' });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (e) {
    console.error(`\nNothing is serving ${BASE} (${e instanceof Error ? e.message : e}).\n`
      + `  npm run build && npx vite preview --port 4173 --strictPort &\n`
      + `  SESSION_URL=<url> to point elsewhere.\n`);
    process.exit(2);
  }
}

/**
 * THE ANNUAL STATEMENT PDF AGAINST THE SCREEN, from a page on the Annual
 * Statement: on the Pool view, it presses "Download Annual Statement (PDF)",
 * reads the file with pdf.js, and returns what differs — the file landscape
 * Letter, the pool's sheet first, every page's header the year the screen
 * stands at, its first page's Written Premium row the screen's. Empty when it
 * matches. The statement's results rule (utils/knownYears) is the page's, so the
 * file follows it in any mode the page runs in.
 */
async function statementPdfDiffs(page) {
  const out = [];
  const pool = page.getByRole('button', { name: 'Pool', exact: true }).first();
  if (await pool.count() > 0) { await pool.click(); await page.waitForTimeout(400); }
  const heads = (await page.locator('[data-testid="statement-operating"] tr[data-row-kind="header"] th').allInnerTexts()).map(t => t.trim()).filter(t => /^\d{4}$/.test(t));
  const premium = (await page.locator('[data-testid="statement-operating"] tr[data-row-label="Written Premium"] td').allInnerTexts()).map(t => t.trim().replace(/−/g, '-')).filter(Boolean).slice(1);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
    page.getByRole('button', { name: 'Download Annual Statement (PDF)' }).first().click(),
  ]);
  if (!dl) return ['no PDF arrived'];
  const file = await dl.path();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const fonts = path.join(REPO, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), standardFontDataUrl: fonts, isEvalSupported: false }).promise;
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    const vp = pg.getViewport({ scale: 1 });
    const items = (await pg.getTextContent()).items;
    const text = items.map(it => it.str).join(' ');
    if (vp.width !== 792 || vp.height !== 612) out.push(`page ${p}: ${vp.width}x${vp.height}`);
    const m = text.match(/ - ([^-]+?) - Annual Statement as of 12\/31\/(\d{4})/);
    if (!m || m[2] !== heads.at(-1)) out.push(`page ${p}: header "${m ? m[0] : 'none'}", the screen stands at ${heads.at(-1)}`);
    if (p === 1) {
      if (!m || m[1] !== 'Pool') out.push('the first page is not the pool\'s');
      // The Written Premium row: the item and the figures on its baseline, left to right.
      const label = items.find(it => it.str === 'Written Premium');
      const row = label ? items.filter(it => Math.abs(it.transform[5] - label.transform[5]) < 0.5 && it !== label).sort((a, b) => a.transform[4] - b.transform[4]).map(it => it.str.trim()).filter(Boolean) : [];
      if (row.join(' ') !== premium.join(' ')) out.push(`Written Premium: the PDF's ${row.join(' ')} ≠ the screen's ${premium.join(' ')}`);
    }
  }
  if (doc.numPages === 0) out.push('no pages');
  return out;
}

// THE LOCK CONFIRMATION (components/LockConfirmModal): the lock button opens a
// box first, and only its "Lock decisions" locks the year — single player, Test
// player and hosted. Every driver that locks a year comes through here.
async function lockAndConfirm(page) {
  await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
  const box = page.locator('[data-testid="lock-confirm"]');
  await box.waitFor({ timeout: 10000 });
  await box.getByRole('button', { name: 'Lock decisions', exact: true }).click();
  await box.waitFor({ state: 'detached', timeout: 10000 });
}

module.exports = { BASE, REPO, launchBrowser, requireServer, asPlayer, asAdmin, statementPdfDiffs, lockAndConfirm };
