// ============================================================================
// MID-GAME EDITS, TEST PLAYER (wip/mid-game-edits) — a driver.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/test-player-edits.cjs [--shots]
//
// Two Test player games on the same scenario, played the same way. Game E plays
// 2027, then opens "Edit game" — the host's panel, the same rules — moves WC
// to High from the CURRENT year (2028) on and adds a shock to a FUTURE year
// (2029), and plays 2028. Game C (the control) plays both years untouched.
//
//   - the panel lists 2028 onward and no played year, and records the changes
//     ('Test player', the year, the change) in its history;
//   - the save carries the year's levels, the history and the added shock, and
//     the setup's own levels are unchanged;
//   - 2027 is byte-identical in E (after the edit, and after a reload) and C;
//   - 2028's WC differs between E and C — the edit took — and GL, untouched,
//     matches;
//   - after a reload the edit is still the game's, and the panel shows it.
//
// ⚠ AND IT CAN FAIL: if the edit were ignored, 2028's WC check fails; if it
// rewrote a played year, the 2027 check does. Single player has no panel — the
// strip is absent there (checked).
//
// Screenshot (--shots): Test player's panel, into docs/screenshots/mid-game-edits/.
// ============================================================================
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { BASE, REPO, launchBrowser, requireServer, lockAndConfirm } = require('./_shared.cjs');

const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = path.join(REPO, 'docs', 'screenshots', 'mid-game-edits');
const SCENARIO = '5';
let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

async function readSave(page) {
  const raw = await page.evaluate(() => {
    const k = Object.keys(localStorage).find(x => x.startsWith('riskpool_gamestate_'));
    return k ? localStorage.getItem(k) : null;
  });
  if (!raw) return null;
  const env = JSON.parse(zlib.inflateRawSync(Buffer.from(raw, 'base64')).toString('utf8'));
  return env.gameState ?? env;
}
async function waitForSave(page, pred) {
  for (let i = 0; i < 90; i++) { const s = await readSave(page).catch(() => null); if (s && pred(s)) return s; await page.waitForTimeout(1000); }
  return null;
}
async function start(page, testPlayer) {
  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption(SCENARIO);
  if (!testPlayer) {
    await page.getByRole('button', { name: 'Single player', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Test player', exact: true }).click();
    await page.waitForSelector('[data-testid="test-player-setup"]', { timeout: 20000 });
    await page.click('[data-testid="start-test-player"]');
  }
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
}
async function lockYear(page, next) {
  await page.getByRole('button', { name: 'Decisions', exact: true }).first().click();
  await lockAndConfirm(page);
  await page.waitForTimeout(2500);
  const decline = page.getByRole('button', { name: /Decline/i }).first();
  if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
  const confirm = page.getByRole('button', { name: /Confirm & Continue/ }).first();
  if (await confirm.count() > 0) { await confirm.click(); await page.waitForTimeout(800); }
  await page.waitForSelector(`text=Lock Program Year ${2026 + next}`, { timeout: 120000 });
  return waitForSave(page, s => s.currentYearNumber === next);
}
const year = (save, i) => JSON.stringify(save?.lockedResults?.[i] ?? null);
const lineOf = (save, i, l) => JSON.stringify(save?.lockedResults?.[i]?.byLine?.[l] ?? null);

(async () => {
  await requireServer();
  if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });
  // Test player needs no admin; the token is kept out of these contexts.
  const adminToken = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  const browser = await launchBrowser();
  if (adminToken) process.env.ADMIN_TOKEN = adminToken;
  const errs = [];
  const newPage = async () => {
    const p = await (await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    return p;
  };

  // ---- Single player: unchanged, no panel ----
  {
    const p = await newPage();
    await start(p, false);
    ok(await p.locator('[data-testid="test-edit-strip"]').count() === 0 && await p.locator('[data-testid="edit-game"]').count() === 0,
      'Single player: no Edit game');
    await p.context().close();
  }

  // ---- C: the control, untouched ----
  const c = await newPage();
  await start(c, true);
  await lockYear(c, 2);
  const cSave = await lockYear(c, 3);

  // ---- E: 2027 played, then the edit ----
  const e = await newPage();
  await start(e, true);
  const e1 = await lockYear(e, 2);
  const setupLevels = JSON.stringify(e1.setup.developmentLevels);
  const scheduleBefore = JSON.stringify(e1.instance.scheduledShocks ?? []);
  await e.click('[data-testid="test-edit-toggle"]');
  await e.waitForSelector('[data-testid="edit-game"]');
  const rows = await e.$$eval('[data-testid^="edit-year-"]', rs => rs.map(r => r.getAttribute('data-testid').replace('edit-year-', '')));
  ok(JSON.stringify(rows) === JSON.stringify(['2028', '2029', '2030', '2031']), 'the panel lists 2028 (current) onward and no played year', rows.join(', '));
  ok(await e.locator('[data-testid="edit-history-empty"]').count() === 1, 'no changes yet');
  await e.selectOption('[data-testid="edit-dev-2028-WC"] select', 'High');
  const shockId = await e.locator('[data-testid="edit-add-select-2029"] option').nth(2).getAttribute('value');
  await e.selectOption('[data-testid="edit-add-select-2029"]', shockId);
  await e.click('[data-testid="edit-add-2029"]');
  if (SHOTS) await e.locator('[data-testid="test-edit-strip"]').screenshot({ path: path.join(SHOT_DIR, 'test-player-edit-game-panel.png') });
  await e.click('[data-testid="edit-apply"]');
  ok(await e.locator('[data-testid="edit-locked-warning"]').count() === 0, 'Test player: no locked-teams warning (there are no teams)');
  await e.waitForSelector('[data-testid="edit-history-row"]', { timeout: 20000 });
  const hist = await e.$$eval('[data-testid="edit-history-row"]', rs => rs.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  ok(hist.length === 5 && hist.every(h => /Test player/.test(h)) && hist.some(h => /Added/.test(h) && /2029/.test(h))
    && ['2028', '2029', '2030', '2031'].every(y => hist.some(h => h.includes(`WC adverse development in ${y}: `) && h.endsWith('→ High'))),
    'the history: Test player, WC from 2028 on, the shock in 2029', `${hist.length} rows`);

  const edited = await waitForSave(e, s => (s.setup.gameEdits ?? []).length === 5);
  ok(edited && ['2', '3', '4', '5'].every(y => edited.setup.developmentLevelsByYear?.[y]?.WC === 'High')
    && edited.setup.developmentLevelsByYear?.['1'] === undefined && JSON.stringify(edited.setup.developmentLevels) === setupLevels,
    'the save: WC High in years 2-5, nothing for the played year, the setup\'s own levels unchanged', JSON.stringify(edited?.setup.developmentLevelsByYear));
  const schedAfter = (edited?.instance.scheduledShocks ?? []).map(s => [s.shockId, s.yearNumber]);
  ok(JSON.stringify(schedAfter.slice(0, JSON.parse(scheduleBefore).length)) === JSON.stringify(JSON.parse(scheduleBefore).map(s => [s.shockId, s.yearNumber]))
    && schedAfter.length === JSON.parse(scheduleBefore).length + 1 && JSON.stringify(schedAfter[schedAfter.length - 1]) === JSON.stringify([shockId, 3]),
    'the save: the shock appended for 2029, every earlier entry where it was', JSON.stringify(schedAfter));
  ok(typeof edited?.setup.shocksOn === 'boolean', 'the save: the shock switch pinned at the first edit', String(edited?.setup.shocksOn));
  ok(year(edited, 0) === year(e1, 0) && year(e1, 0) === year(cSave, 0), '2027 is byte-identical: before the edit, after it, and in the untouched game');

  // ---- a reload: the edit is the game's ----
  await e.reload();
  await e.waitForSelector('text=Lock Program Year 2028', { timeout: 60000 });
  const reloaded = await readSave(e);
  ok(JSON.stringify(reloaded?.setup.developmentLevelsByYear) === JSON.stringify(edited?.setup.developmentLevelsByYear)
    && (reloaded?.setup.gameEdits ?? []).length === 5 && year(reloaded, 0) === year(cSave, 0),
    'after a reload: the edit holds, and 2027 is unchanged');
  await e.click('[data-testid="test-edit-toggle"]');
  ok(await e.locator('[data-testid="edit-dev-2028-WC"] select').inputValue() === 'High'
    && await e.locator(`[data-testid="edit-shock-2029-${shockId}"]`).count() === 1
    && await e.locator('[data-testid="edit-history-row"]').count() === 5,
    'after a reload: the panel shows the edit and its history');
  await e.click('[data-testid="test-edit-toggle"]');

  // ---- 2028 played on the edited settings ----
  const e2 = await lockYear(e, 3);
  ok(year(e2, 0) === year(cSave, 0), '2027 still byte-identical once 2028 is played');
  ok(lineOf(e2, 1, 'WC') !== lineOf(cSave, 1, 'WC'), '2028: WC plays differently from the untouched game — the edit took');
  const pyd = s => s?.lockedResults?.[1]?.byLine?.WC?.priorYearDevelopment;
  // Magnitudes, as test-player.cjs reads them: the engine books development signed.
  ok(Math.abs(pyd(e2)) > Math.abs(pyd(cSave)), '2028: and WC\'s prior-year development is larger at High (in size)', `${Math.round(pyd(e2))} vs ${Math.round(pyd(cSave))}`);
  ok(lineOf(e2, 1, 'GL') === lineOf(cSave, 1, 'GL'), '2028: GL, untouched, is byte-identical to the untouched game');

  ok(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' | '));
  await browser.close();
  console.log(`\ntest-player-edits: ${passed}/${passed + failed} checks passed`);
  if (failed) { console.log('FAIL'); process.exit(1); }
  console.log('TEST PLAYER EDITS PASS');
})().catch(err => { console.error('THREW:', err); process.exit(1); });
