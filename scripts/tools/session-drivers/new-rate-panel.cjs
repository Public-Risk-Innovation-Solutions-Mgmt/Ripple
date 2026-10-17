// The new Decisions rate panel — two columns, per $100, behind NEW_RATE_STACK.
//
// ⚠ IT NEEDS A FLAG-ON BUILD, AND IT SAYS SO RATHER THAN FAILING. NEW_RATE_STACK
// is off in every shipped build, so against a normal build the new panel does
// not render and there is nothing here to drive. This SKIPS in that case, loudly
// and with exit 0, so it can sit in the driver list without going red every run
// — and so that a reader of the log can see it did not test anything.
//
// To run it for real: flip `NEW_RATE_STACK.enabled` to true in
// src/data/pricingParameters.ts, `npm run build`, serve, then run this. That is
// how it was run before the commit that added it; see the commit message.
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
  await page.waitForSelector('text=Instance ID / Seed', { timeout: 20000 });
  await page.getByRole('button', { name: /Start/i }).last().click();
  await page.waitForSelector('text=Lock Year', { timeout: 60000 });
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

  ok(/Pure premium/.test(body) && /\+ Admin/.test(body)
    && /\+ Risk control & contingency/.test(body) && /= Rate/.test(body),
     'all four build-up rows render');
  ok(/vs last year/.test(body), 'the vs-last-year row renders');

  // ⚠ NO CLF NOTE BESIDE THE PURE PREMIUM — the brief removed it, and a
  // multiplier printed there invites the reading that the row is pre-CLF.
  ok(!/CLF|×\s*1\./.test(body), 'no CLF multiplier is printed beside the pure premium');

  const surplus = await page.textContent('[data-testid="expected-to-surplus"]');
  ok(/Expected to surplus/.test(surplus), 'the expected-to-surplus line renders');
  ok(/\$\d/.test(surplus) && /M/.test(surplus),
     `it is in DOLLARS, not a rate — "${surplus.trim()}"`);

  // The retired readouts must be gone from this panel.
  for (const gone of ['Expected Combined Ratio', 'Marginal Cost', 'Reserve Margin Standard',
    'Excess Capital Ratio', 'The Load', 'CLF Multiplier']) {
    ok(!body.includes(gone), `"${gone}" is not on the new panel`);
  }

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
