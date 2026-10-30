// The new Decisions rate panel — two columns, per $100, behind NEW_RATE_STACK.
//
// ⚠ THE FLAG IS NOW ON AND THIS DRIVER RUNS FOR REAL — 15 of 15 against the
// shipped build. The paragraph that stood here said "NEW_RATE_STACK is off in
// every shipped build, so this SKIPS", which was true when it was written and
// is not now. The skip below is KEPT, deliberately: it is what makes this file
// safe to run against a build with the flag switched back, which is the one
// line pricingParameters.ts says it takes. A reader of the log can still see
// whether it tested anything.
//
// To run it against a flag-off build: flip `NEW_RATE_STACK.enabled` to false in
// src/data/pricingParameters.ts, `npm run build`, serve, then run this — it
// will report SKIPPED and exit 0.
//
// ⚠ AND IT MUST BE ABLE TO FAIL — see THE CONTROL at the foot.
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');
const fails = [];
let checks = 0;
function ok(c, w) { checks++; if (!c) { fails.push(w); console.log('  FAIL  ' + w); } else console.log('  ok    ' + w); }

const money = t => Number(String(t).replace(/[^0-9.-]/g, ''));
// The expense block at a slider: Admin 20.0%, Risk control, Total expense
// ratio, Permissible loss ratio = 1 - the total — each row in both columns.
const p1 = v => `${(v * 100).toFixed(1)}%`;
function expenseBlockReads(body, rc) {
  const row = (label, v) => new RegExp(`${label}\\s*${p1(v).replace('.', '\\.')}\\s*${p1(v).replace('.', '\\.')}`).test(body);
  return row('Admin', 0.2) && row('Risk control', rc) && row('Total expense ratio', 0.2 + rc) && row('Permissible loss ratio', 0.8 - rc);
}
let page;
async function plrIs(rc) {
  const i = Number(await page.getAttribute('[data-testid="new-rate-indicated-plr"]', 'data-value'));
  const y = Number(await page.getAttribute('[data-testid="new-rate-yours-plr"]', 'data-value'));
  return Math.abs(i - (0.8 - rc)) < 1e-12 && Math.abs(y - (0.8 - rc)) < 1e-12;
}

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE });
  page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  // The same route solo-oracle takes — /solo, start, then the Decisions tab.
  await page.goto('/solo');
  await page.waitForSelector('[data-testid="scenario"], input[placeholder="e.g. ABC12345"]', { timeout: 20000 });
  await page.getByRole('button', { name: 'Single player', exact: true }).click();
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
  await page.getByRole('button', { name: /^Decisions$/ }).first().click();
  await page.waitForTimeout(1500);
  // ⚠ A LINE VIEW IS REQUIRED. The funding panel is per line and the page opens
  // on Pool, where NEITHER panel renders — the first version of this driver
  // reported SKIPPED against a flag-ON build for that reason alone, which would
  // have read as "the flag is off" forever.
  await page.getByRole('button', { name: /Compensation/ }).first().click();
  await page.waitForTimeout(1500);

  const panel = await page.$('[data-testid="new-rate-panel"]');
  if (!panel) {
    console.log('\n  SKIPPED — NEW_RATE_STACK is off in this build, so the new panel does not render.');
    console.log('  Nothing was tested. Flip the flag, rebuild and re-run to exercise it.');
    await browser.close();
    console.log('\nnew-rate-panel: SKIPPED (0 checks)');
    process.exit(0);
  }

  // ---- the panel is live: drive it ----------------------------------------
  const indicated = money(await page.textContent('[data-testid="new-rate-indicated"]'));
  const final = money(await page.textContent('[data-testid="new-rate-final"]'));
  console.log(`\n  indicated $${indicated.toFixed(2)}  ·  your rate $${final.toFixed(2)}`);

  ok(Number.isFinite(indicated) && indicated > 0, 'the Indicated column shows a positive rate');
  ok(Number.isFinite(final) && final > 0, 'Your rate shows a positive rate');

  // ⚠ THE REINSURANCE CELL IS A DASH IN THE INDICATED COLUMN, NOT A ZERO. The
  // indication is self-funded; "—" and "$0.00" are different statements.
  const body = (await page.textContent('[data-testid="new-rate-panel"]')).replace(/\s+/g, ' ');
  ok(/\+ Reinsurance\s*—/.test(body) || body.includes('+ Reinsurance —'),
     'the Indicated column shows a dash for reinsurance, not $0.00');

  // RESTATED at wip/pricing-rework: Profit & contingency is retired, admin is
  // 20% of premium and labelled so, and the permissible loss ratio (80%) is
  // printed under the rate.
  ok(/Pure premium/.test(body) && /\+ Admin \(20% of premium\)/.test(body) && /\+ Risk Control/.test(body)
    && /\+ Reinsurance/.test(body) && /= Rate/.test(body)
    && !/contingency/i.test(body),
     'each piece its own row: Pure premium, Admin (20% of premium), Risk Control, Reinsurance, = Rate — no Profit & contingency');
  // ⚠ EACH COLUMN ADDS EXACTLY TO ITS RATE, in the cents printed; Risk Control
  // reads $0.00 in both at the default 0%.
  {
    const cents = async id => { const t = await page.textContent(`[data-testid="${id}"]`); return Math.round(money(t) * 100); };
    const rows = ['pure-premium', 'admin', 'risk-control'];
    const ind = await Promise.all(rows.map(r => cents(`new-rate-indicated-${r}`)));
    const yours = await Promise.all([...rows, 'reins'].map(r => cents(`new-rate-yours-${r}`)));
    const indRate = await cents('new-rate-indicated'), yourRate = await cents('new-rate-final');
    ok(ind.reduce((a, b) => a + b, 0) === indRate, `the Indicated rows add to the Indicated rate (${ind.join(' + ')} = ${indRate} cents)`);
    ok(yours.reduce((a, b) => a + b, 0) === yourRate, `Your rate's rows add to Your rate (${yours.join(' + ')} = ${yourRate} cents)`);
    ok(ind[2] === 0 && yours[2] === 0, 'Risk Control reads $0.00 in both columns at 0%');
    // Admin is 20% of the rate before reinsurance in both columns, to the cent
    // the printed rows can carry (admin takes the rounding, a cent at most).
    const yourBefore = yourRate - yours[3];
    ok(Math.abs(ind[1] - Math.round(indRate * 0.2)) <= 1 && Math.abs(yours[1] - Math.round(yourBefore * 0.2)) <= 1,
      `Admin is 20% of the rate before reinsurance in both columns (${ind[1]} of ${indRate}, ${yours[1]} of ${yourBefore} cents)`);
    // THE EXPENSE RATIO BLOCK (restated at wip/risk-control-divisor): Admin
    // 20.0%, Risk control (the line's choice), Total expense ratio, Permissible
    // loss ratio = 1 - the total, in both columns, to one decimal.
    ok(expenseBlockReads(body, 0) && await plrIs(0), 'the expense block reads Admin 20.0%, Risk control 0.0%, Total 20.0%, Permissible loss ratio 80.0% in both columns');
  }

  // ---- the Risk Control slider at 2%: the divisor (wip/risk-control-divisor) --
  // Drive WC's slider to 2%. Risk control is in the divisor beside admin, so
  // the block reads 20.0 / 2.0 / 22.0 / 78.0%, the Risk Control row is 2% of
  // the rate before reinsurance and admin 20% of it, to the cent the printed
  // rows carry; then back to 0%, and the panel is exactly as it was.
  {
    const before0 = (await page.textContent('[data-testid="new-rate-panel"]')).replace(/\s+/g, ' ');
    const box = page.locator('div.flex.flex-col.gap-2', { has: page.locator('span', { hasText: /^Safety & Return-to-Work$/ }) }).first();
    const input = box.locator('input[type=range]');
    await input.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(800);
    ok(Number(await input.inputValue()) === 0.02, `the WC Risk Control slider moves to 2% (${await input.inputValue()})`);
    const at2 = (await page.textContent('[data-testid="new-rate-panel"]')).replace(/\s+/g, ' ');
    ok(expenseBlockReads(at2, 0.02) && await plrIs(0.02), 'at 2%: Admin 20.0%, Risk control 2.0%, Total expense ratio 22.0%, Permissible loss ratio 78.0% in both columns');
    const cents = async id => Math.round(money(await page.textContent(`[data-testid="${id}"]`)) * 100);
    const yourRate = await cents('new-rate-final'), reins = await cents('new-rate-yours-reins');
    const rc = await cents('new-rate-yours-risk-control'), admin = await cents('new-rate-yours-admin');
    const before = yourRate - reins;
    ok(Math.abs(rc - Math.round(before * 0.02)) <= 1 && Math.abs(admin - Math.round(before * 0.2)) <= 1,
      `at 2%: Risk Control is 2% and admin 20% of the rate before reinsurance (${rc} and ${admin} of ${before} cents)`);
    // The line "Average saving equals the cost." is removed (wip/display-removals); the cost in dollars stays.
    ok(!/Average saving equals the cost/.test(await page.locator('main').innerText())
      && await page.locator('[data-testid="risk-control-neutral"]').count() === 0
      && money(await page.textContent('[data-testid="risk-control-cost"]')) > 0,
      'at 2%: the box shows the cost in dollars, and no longer says the average saving equals the cost');
    await input.focus();
    await page.keyboard.press('Home');
    await page.waitForTimeout(800);
    ok((await page.textContent('[data-testid="new-rate-panel"]')).replace(/\s+/g, ' ') === before0, 'back at 0%, the panel is exactly as it was');
    // THE CONTROL: wip/risk-control's multiplier gave a permissible loss ratio of
    // (1 - admin) / (1 + slider) = 78.4% at 2%. The block's predicate must refuse it.
    ok(!expenseBlockReads(at2.replace(/78\.0%/g, '78.4%'), 0.02), 'control: the multiplier\'s 78.4% is refused by the expense block\'s predicate');
  }
  ok(/vs last year/.test(body), 'the vs-last-year row renders');

  // ⚠ THE vs-last-year CELLS ARE A PERCENTAGE, NOT A RATE, AND THAT IS WHAT IS
  // ASSERTED. The cell carries a signed percentage and, beneath it in smaller
  // text, the rate it was measured against — so a test for "does a dollar
  // figure appear here" would pass on both the right answer and the wrong one.
  // What separates them is that the percentage must be THE CELL'S OWN LEADING
  // FIGURE. These regexes anchor on that: the cell must START with +N.N% or
  // -N.N%, which a cell showing only last year's rate cannot do.
  //
  // CONTROL, RUN AND RECORDED: render the cell as `{d4(before)}` alone — the
  // raw rate, which is the shape the brief asked to replace. MEASURED: exit 1,
  // 15 of 21, with all SIX assertions below red — "the indicated cell leads
  // with a signed percentage, not a rate — got "$7.6266"", the 4dp footnote
  // gone with it, and the arithmetic pair NaN because there is no percentage
  // left to read. So these can fail, and they fail on exactly that change.
  for (const [testid, label] of [['new-rate-vs-indicated', 'indicated'], ['new-rate-vs-final', 'final rate']]) {
    const cell = (await page.textContent(`[data-testid="${testid}"]`)).trim();
    ok(/^[+-]\d+(\.\d+)?%/.test(cell),
       `the ${label} cell leads with a signed percentage, not a rate — got "${cell.replace(/\s+/g, ' ')}"`);
    // And last year's rate is still READABLE, beneath it — the brief asked for
    // both, and a percentage with nothing to anchor it is a number without a
    // basis. 4dp, because 2dp cannot reconstruct the percentage on Property.
    ok(/from \$\d+\.\d{4}/.test(cell.replace(/\s+/g, ' ')),
       `last year's ${label} is shown beneath it to 4dp — got "${cell.replace(/\s+/g, ' ')}"`);
  }

  // ⚠ AND THE PERCENTAGE MUST BE ABLE TO MOVE. It read +0.0% / +0.1% every year
  // before this commit, because the panel built its indication from the same
  // pure premium that produced the indication it was comparing against. A
  // column that cannot move is not a change column, and a shape test alone
  // would never have caught it — so this asserts the arithmetic instead: the
  // percentage must be what the two rates in the cell actually imply.
  for (const [testid, label] of [['new-rate-vs-indicated', 'indicated'], ['new-rate-vs-final', 'final rate']]) {
    const cell = (await page.textContent(`[data-testid="${testid}"]`)).replace(/\s+/g, ' ');
    const shown = Number(/^([+-]\d+(?:\.\d+)?)%/.exec(cell)?.[1]);
    const was = Number(/from \$(\d+\.\d{4})/.exec(cell)?.[1]);
    const now = money(await page.textContent(
      `[data-testid="${testid === 'new-rate-vs-indicated' ? 'new-rate-indicated' : 'new-rate-final'}"]`));
    const implied = ((now / was) - 1) * 100;
    // The "= Rate" cell is rounded to cents, so the reconstruction carries that
    // rounding: half a cent on a $4 rate is about 0.12 percentage points.
    ok(Math.abs(implied - shown) < 0.2,
       `the ${label} percentage ${shown}% is what $${was} -> $${now} implies (${implied.toFixed(2)}%)`);
  }

  // ⚠ BOTH COLUMNS AGAINST LAST YEAR'S ACTUAL RATE (UI tidy): the final rate
  // members paid, so the two cells' footnotes are the same figure.
  {
    const base = async t => /from \$(\d+\.\d{4})/.exec((await page.textContent(`[data-testid="${t}"]`)).replace(/\s+/g, ' '))?.[1];
    const a = await base('new-rate-vs-indicated'), b = await base('new-rate-vs-final');
    ok(a !== undefined && a === b, `both columns compare against last year's final rate ($${a} and $${b})`);
  }

  // ⚠ NO CLF NOTE BESIDE THE PURE PREMIUM — the brief removed it, and a
  // multiplier printed there invites the reading that the row is pre-CLF.
  ok(!/CLF|×\s*1\./.test(body), 'no CLF multiplier is printed beside the pure premium');

  const surplus = await page.textContent('[data-testid="expected-to-surplus"]');
  ok(/Expected to surplus/.test(surplus), 'the expected-to-surplus line renders');
  ok(/\$\d/.test(surplus) && /M/.test(surplus),
     `it is in DOLLARS, not a rate — "${surplus.trim()}"`);

  // Players see each package's price, never its expected recovery or how it was
  // priced (UI tidy) — and the block restating the package and its cost is gone.
  {
    const page_ = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    for (const gone of ['expected recovery', ' load', 'Aggregate cover is not offered', 'Retained Above Package', 'Reinsurance Cost',
      'The spend comes out of this line', 'Coming soon', 'is not renewed', 'of new exposure this year']) {
      ok(!page_.includes(gone), `"${gone.trim()}" is not on the Decisions page`);
    }
  }

  // The retired readouts must be gone from this panel.
  for (const gone of ['Expected Combined Ratio', 'Marginal Cost', 'Reserve Margin Standard',
    'Excess Capital Ratio', 'The Load', 'CLF Multiplier']) {
    ok(!body.includes(gone), `"${gone}" is not on the new panel`);
  }

  // ---- the reinsurance package (loss engine commit 4a) ---------------------
  // One choice per line. Choosing NONE must move the panel's build-up — the
  // package's cost is its Reinsurance line — and mark the choice; choosing the
  // default back must restore the panel exactly, because the price is a
  // function of the package. (The final RATE is not compared: in year 1 it
  // reads $4.00 on either package.)
  const chosen = async id => (await page.getAttribute(`[data-testid="reins-option-WC-${id}"]`, 'class') || '')
    .includes('border-blue-500');
  const panelText = async () => (await page.textContent('[data-testid="new-rate-panel"]')).replace(/\s+/g, ' ');
  const reinsLine = t => (t.match(/\+ Reinsurance[^+=]*/g) || []).join(' | ');
  // THE T COVERS (wip/shocks). A solo game's shocks are on, so None and all
  // four covers are offered, None the default; each shows its name and price.
  // Choosing one moves only the Reinsurance row: the pure premium is never
  // lowered by cover.
  const T_COVERS = ['$9M xs $1M', '$19M xs $1M', '$29M xs $1M', '$39M xs $1M', '$8M xs $2M', '$18M xs $2M', '$28M xs $2M', '$38M xs $2M'];
  ok(await chosen('none'), 'WC opens on the default cover, None');
  const offered = [];
  for (const id of T_COVERS) if (await page.$(`[data-testid="reins-option-WC-${id}"]`) !== null) offered.push(id);
  ok(offered.length === 8, `all eight T covers are offered (${offered.join(', ')})`);
  const wcPrice = (await page.textContent('[data-testid="reins-option-WC-$38M xs $2M"]')).replace(/\s+/g, ' ');
  // wip/reinsurance-layers: priced by the workbook's method on the year's claims —
  // year 1, growth 1: WC 38 xs 2 = 1.2 x (5.25% x $2.5M + 2.25% x $21M) = $724,500.
  ok(/\$724,500\/yr/.test(wcPrice), `38 xs 2 on WC shows its year-1 price by the method ("${wcPrice}")`);
  const ppLine = t => (t.match(/Pure premium[^+]*/) || [''])[0];
  const atDefault = await panelText();
  await page.click('[data-testid="reins-option-WC-$38M xs $2M"]');
  await page.waitForTimeout(800);
  const atWorking = await panelText();
  ok(await chosen('$38M xs $2M') && !(await chosen('none')), 'clicking 38 xs 2 selects it, and only it');
  ok(reinsLine(atWorking) !== reinsLine(atDefault),
     `the Reinsurance line moves with the cover ("${reinsLine(atDefault)}" -> "${reinsLine(atWorking)}")`);
  ok(ppLine(atWorking) === ppLine(atDefault), `the pure premium does not move ("${ppLine(atDefault)}")`);
  await page.click('[data-testid="reins-option-WC-none"]');
  await page.waitForTimeout(800);
  ok(await panelText() === atDefault, 'and the panel returns exactly when the default is chosen again');

  // ---- ten worlds (loss engine commit 4b) ----------------------------------
  // Lock a year. Players are never told about the worlds: neither the Results
  // page nor the Decisions page shows the surplus range across them, or says
  // they exist. The range stays in the session's posted results, for the host.
  await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
  await page.waitForTimeout(2500);
  const decline = page.getByRole('button', { name: /Decline/i }).first();
  if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
  // wip/shocks: a shock can bring a loan offer, which posts only on Confirm & Continue.
  const confirmLoan = page.getByRole('button', { name: /Confirm & Continue/ }).first();
  if (await confirmLoan.count() > 0) { await confirmLoan.click(); await page.waitForTimeout(800); }
  // ⚠ THE RESULTS PAGE IS HIDDEN SINCE THE TAB CLEANUP (multiplayer 3bd6d2b,
  // tabs.tsx HIDDEN_TABS), so a player cannot reach it to be told about the
  // worlds there. This step clicked its tab and timed out on multiplayer
  // itself; restated at wip/clf-stretch to hold that the tab is not offered.
  ok(await page.getByRole('button', { name: /^Results$/ }).count() === 0, 'Results: the tab is not offered (hidden), so no player reaches a range there');
  await page.getByRole('button', { name: /^Decisions$/ }).first().click();
  await page.waitForTimeout(1000);
  // ⚠ PLAYERS ARE NEVER TOLD ABOUT THE WORLDS (the documents commit): the
  // Decisions page carries no surplus range and no mention of worlds. The range
  // stays in the session's posted results, for the host (host-teams holds that).
  ok(await page.$('[data-testid="worlds-surplus-range"]') === null, 'Decisions: no surplus range across the worlds');
  const decisionsText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  ok(!/\bworlds?\b/i.test(decisionsText), 'Decisions: the page never mentions the worlds');
  // Nor does the Annual Statement: its surplus-range row came off.
  await page.getByRole('button', { name: /^Annual Statement$/ }).first().click();
  await page.waitForSelector('[data-testid="annual-statement"]', { timeout: 20000 });
  const statementText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  ok(!/\bworlds?\b/i.test(statementText), 'Annual Statement: the page never mentions the worlds');

  console.log('\n  page errors   :', errs.length ? errs : 'none');
  ok(errs.length === 0, 'no page errors');
  await browser.close();

  // --------------------------------------------------------------------
  // THE CONTROL — run by hand against a flag-on build, recorded here.
  //
  // In DecisionsPage's NewRatePanel, render the reinsurance cell as
  // `{d2(0)}` instead of the dash. MEASURED: exit 1, the dash assertion
  // fails — "the Indicated column shows a dash for reinsurance, not $0.00".
  //
  // And drop the `data-testid="expected-to-surplus"` paragraph. MEASURED:
  // exit 1, both surplus assertions fail.
  // --------------------------------------------------------------------
  console.log(`\nnew-rate-panel: ${checks - fails.length}/${checks} checks passed`);
  if (fails.length) { console.log('FAIL'); process.exit(1); }
  console.log('NEW RATE PANEL PASS');
})().catch(e => { console.error('THREW:', e); process.exit(1); });
