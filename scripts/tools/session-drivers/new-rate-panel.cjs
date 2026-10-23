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

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  // The same route solo-oracle takes — /solo, start, then the Decisions tab.
  await page.goto('/solo');
  await page.waitForSelector('[data-testid="scenario"], input[placeholder="e.g. ABC12345"]', { timeout: 20000 });
  await page.getByRole('button', { name: /Start/i }).last().click();
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

  ok(/Pure premium/.test(body) && /\+ Admin/.test(body) && /\+ Risk Control/.test(body)
    && /\+ Profit & contingency/.test(body) && /\+ Reinsurance/.test(body) && /= Rate/.test(body)
    && !/Risk control & contingency/.test(body),
     'each piece its own row: Pure premium, Admin, Risk Control, Profit & contingency, Reinsurance, = Rate');
  // ⚠ EACH COLUMN ADDS EXACTLY TO ITS RATE, in the cents printed; Risk Control
  // reads $0.00 in both while risk control is off.
  {
    const cents = async id => { const t = await page.textContent(`[data-testid="${id}"]`); return Math.round(money(t) * 100); };
    const rows = ['pure-premium', 'admin', 'risk-control', 'contingency'];
    const ind = await Promise.all(rows.map(r => cents(`new-rate-indicated-${r}`)));
    const yours = await Promise.all([...rows, 'reins'].map(r => cents(`new-rate-yours-${r}`)));
    const indRate = await cents('new-rate-indicated'), yourRate = await cents('new-rate-final');
    ok(ind.reduce((a, b) => a + b, 0) === indRate, `the Indicated rows add to the Indicated rate (${ind.join(' + ')} = ${indRate} cents)`);
    ok(yours.reduce((a, b) => a + b, 0) === yourRate, `Your rate's rows add to Your rate (${yours.join(' + ')} = ${yourRate} cents)`);
    ok(ind[2] === 0 && yours[2] === 0, 'Risk Control reads $0.00 in both columns while risk control is off');
    ok(ind[3] > 0 && yours[3] > 0, 'Profit & contingency is charged in both columns');
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
  // The aggregate stop's covers (stable-scenarios commit 6). A solo game's
  // shocks are off, so only None and the Working cover are offered and None is
  // the default (AGGREGATE_STOP_OFFERED_SHOCKS_OFF / _DEFAULT_SHOCKS_OFF).
  ok(await chosen('none'), 'WC opens on the default cover, None (a solo game\'s shocks are off)');
  ok(await page.$('[data-testid="reins-option-WC-working"]') !== null,
     'the Low-attachment cover is offered');
  ok(await page.$('[data-testid="reins-option-WC-bad-year"]') === null
     && await page.$('[data-testid="reins-option-WC-catastrophe"]') === null,
     'the Medium- and High-attachment covers are hidden while the shocks are off');
  const atDefault = await panelText();
  await page.click('[data-testid="reins-option-WC-working"]');
  await page.waitForTimeout(800);
  const atWorking = await panelText();
  ok(await chosen('working') && !(await chosen('none')), 'clicking the Low-attachment cover selects it, and only it');
  ok(reinsLine(atWorking) !== reinsLine(atDefault),
     `the Reinsurance line moves with the package ("${reinsLine(atDefault)}" -> "${reinsLine(atWorking)}")`);
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
  // ⚠ THE RESULTS PAGE NO LONGER SHOWS THE RANGE EITHER — players are never
  // told about the worlds, on any page. The range stays for the host.
  await page.getByRole('button', { name: /^Results$/ }).first().click();
  await page.waitForTimeout(1000);
  ok(await page.$('[data-testid="worlds-surplus-range"]') === null, 'Results: no surplus range across the worlds');
  ok(!/\bworlds?\b/i.test((await page.locator('main').innerText()).replace(/\s+/g, ' ')), 'Results: the page never mentions the worlds');
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
