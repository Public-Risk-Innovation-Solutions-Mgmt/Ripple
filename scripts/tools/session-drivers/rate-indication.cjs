// THE RATE INDICATION REPRODUCES THE RATE THE GAME CHARGES — what a player sees.
//
// Solo (scenario 7, three lines, through the real setup screen) and hosted (a
// room over the local transport, three lines), each before year 1 and after
// two played years. On every line:
//
//   the coming year   on the Decisions page, under each cover the line offers,
//                     at Expected, 70%, 80% and 90%:
//                       indicated rate at that level + the cover's price
//                         = the panel's rate (new-rate-final, its full figure)
//   each played year  chosen from the page's year dropdown:
//                       indicated rate at the level chosen that year + the
//                       price of the cover bought = the panel's rate when the
//                       year was locked; and that indicated rate is the next
//                       year's Current rate (the engine's record: the charged
//                       rate less the cover's price)
//   the dropdown      year 1 to the coming year, defaulting to the coming year
//   the window        five complete years, a year behind, stated at the
//                     current year's level: the losses row reads
//                     "5-Year Trended Average Loss at <priced - 1> Rate Level"
//   section 1         every label follows the priced year (the rate level and
//                     exposure the year before it, the projection for it);
//                     losses / exposure = the pure premium at that level; that
//                     x one year's annual trend = the projected pure premium,
//                     which is pricing's own; the indicated rate at Expected =
//                     the projection / the permissible loss ratio; and the
//                     indicated rate change is the rate at Expected / the
//                     Current rate - 1, labelled against the current year's rate
//   section 2         no investment income line; admin 20% on every line and
//                     every year, risk control the year's choice (restated at
//                     wip/risk-control-divisor: year 2 is played at 2% on every
//                     line; a hosted team's coming year carries that 2%
//                     forward, a single player's resets to 0% — App.tsx's
//                     commitYear resets every choice each year), the
//                     total expense ratio admin + risk control and the
//                     permissible loss ratio 1 - that (80% at 0%, 78% at 2%),
//                     with no profit & contingency, fixed or per-exposure admin
//                     row (restated at wip/pricing-rework from the line's
//                     contingency, WC 2%, GL 0%, Property 0%). THE CONTROL: the
//                     multiplier's permissible loss ratio, (1 - admin) / (1 +
//                     risk control), is refused
//   the years named   section 3 reads "<current> Rate" and "Indicated <priced>
//                     Rate at Expected / at 70% CLF …", the current year being
//                     the one before the priced; and for the coming year the
//                     top bar shows the CURRENT year (2026 before year 1), the
//                     lock button "Lock Program Year <priced>", and the
//                     Decisions page "Decisions for Program Year <priced>"
//   Event Likelihoods  (wip/reinsurance-layers) beside the cover prices, shocks
//                     on only: "Event Likelihoods", its note, and a row for 1 in
//                     10, 20, 50, 100 and 200 years. Solo before year 1 (growth
//                     1) each size is the one recomputed here from the catalogue
//                     written out, "—" where the line's T events are rarer;
//                     after two years every size is the same multiple (> 1) of
//                     its 2027 size — the year's growth. The hosted room
//                     schedules no shock, so its page shows none.
//
// to one part in a billion. The years are played on different choices: year 1
// at Expected under the line's second cover, year 2 at 80% under None with risk
// control at 2% on every line.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/tools/session-drivers/rate-indication.cjs
const { BASE, launchBrowser, requireServer } = require('./_shared.cjs');

const LINES = [['WC', "Workers' Compensation"], ['GL', 'General Liability'], ['Property', 'Property']];
const LEVELS = [70, 80, 90];
// Admin's share of premium by line (pricingParameters' ADMIN_SHARE_OF_PREMIUM), written out.
const ADMIN = { WC: 0.2, GL: 0.2, Property: 0.2 };
// Each line's Risk Control slider, by its program's label (DecisionsPage).
const RC_LABEL = { WC: 'Safety & Return-to-Work', GL: 'Training and Analytics', Property: 'Mitigation' };
// The expense block with risk control in the divisor beside admin.
const expenseOk = (l, x, rc) => near(x.admin, ADMIN[l]) && near(x.rc, rc) && near(x.totalExpense, ADMIN[l] + rc)
  && near(x.permissible, 1 - ADMIN[l] - rc) && near(x.totalExpense, 1 - x.permissible);
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

let passed = 0, failed = 0;
const ok = (cond, label, detail = '') => {
  if (cond) passed++; else failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

// THE CATALOGUE, WRITTEN OUT: each line's T events, [scaled yearly chance, range $M].
const T_EVENTS = {
  WC: [[1 / 144, 6, 40]],
  GL: [[5 / 288, 7, 40], [1 / 32, 1, 3], [1 / 144, 3, 7]],
  Property: [[1 / 720, 12, 40], [1 / 24, 2, 5], [7 / 288, 12, 40]],
};
const RETURN_YEARS = [10, 20, 50, 100, 200];
/** The size at 1 in n at growth 1, exactly, on the piecewise-linear exceedance curve; null where rarer. */
function exactSize(l, n) {
  const ev = T_EVENTS[l].map(([p, lo, hi]) => ({ p, lo: lo * 1e6, hi: hi * 1e6 }));
  const at = x => ev.reduce((s, e) => s + e.p * Math.min(1, Math.max(0, (e.hi - x) / (e.hi - e.lo))), 0);
  if (at(0) < 1 / n) return null;
  const xs = [...new Set([0, ...ev.flatMap(e => [e.lo, e.hi])])].sort((a, b) => a - b);
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1], fa = at(a), fb = at(b);
    if (fa >= 1 / n && fb <= 1 / n) return fa === fb ? a : a + (fa - 1 / n) / (fa - fb) * (b - a);
  }
  return null;
}

// What a player does on a game screen: the same in solo and hosted.
function screen(page, mode) {
  const tab = async name => { await page.getByRole('button', { name: new RegExp(`^${name}$`) }).first().click(); await page.waitForTimeout(500); };
  const value = async sel => Number(await page.getAttribute(sel, 'data-value'));
  const lineView = async label => { await page.getByRole('button', { name: label, exact: true }).first().click(); await page.waitForTimeout(400); };

  async function readIndication(year) {
    await tab('Rate Indication');
    await page.waitForSelector('[data-testid="rate-indication"]', { timeout: 20000 });
    if (year !== undefined) {
      await page.selectOption('[data-testid="ri-year"]', String(year));
      await page.waitForFunction(y => document.querySelector('[data-testid="rate-indication"]')?.getAttribute('data-year') === String(y), year);
    }
    const out = { year: Number(await page.getAttribute('[data-testid="rate-indication"]', 'data-year')) };
    for (const [l] of LINES) {
      const reins = {};
      for (const el of await page.$$(`[data-testid^="ri-${l}-reins-"]`)) {
        reins[(await el.getAttribute('data-testid')).replace(`ri-${l}-reins-`, '')] = Number(await el.getAttribute('data-value'));
      }
      const label = async id => (await page.locator(`[data-testid="ri-${l}-${id}"]`).locator('xpath=../span[1]').innerText()).trim();
      out[l] = {
        losses: await value(`[data-testid="ri-${l}-losses"]`),
        exposure: await value(`[data-testid="ri-${l}-exposure"]`),
        pp: await value(`[data-testid="ri-${l}-pp"]`),
        trend: await value(`[data-testid="ri-${l}-trend"]`),
        projected: await value(`[data-testid="ri-${l}-projected"]`),
        change: await value(`[data-testid="ri-${l}-change"]`),
        credit: await page.locator(`[data-testid="ri-${l}-credit"]`).count(),
        admin: await value(`[data-testid="ri-${l}-admin"]`),
        rc: await value(`[data-testid="ri-${l}-risk-control"]`),
        retired: await page.locator(`[data-testid="ri-${l}-contingency"], [data-testid="ri-${l}-fixed-admin"], [data-testid="ri-${l}-exposure-admin"]`).count(),
        totalExpense: await value(`[data-testid="ri-${l}-total-admin"]`),
        permissible: await value(`[data-testid="ri-${l}-permissible"]`),
        labels: { losses: await label('losses'), exposure: await label('exposure'), pp: await label('pp'), projected: await label('projected'), change: await label('change'),
          current: await label('current'),
          // A level's label sits beside the span that holds its figure and change.
          expected: (await page.locator(`[data-testid="ri-${l}-expected"]`).locator('xpath=../../span[1]').innerText()).trim(),
          levels: await Promise.all(LEVELS.map(async lv => (await page.locator(`[data-testid="ri-${l}-level-${lv}"]`).locator('xpath=../../span[1]').innerText()).trim())) },
        expected: await value(`[data-testid="ri-${l}-expected"]`),
        current: await value(`[data-testid="ri-${l}-current"]`),
        window: Number(await page.getAttribute(`[data-testid="ri-${l}-losses"]`, 'data-window')),
        lossesLabel: await page.locator(`[data-testid="ri-${l}-losses"]`).locator('xpath=..').innerText(),
        reins, levels: {},
      };
      for (const lv of LEVELS) out[l].levels[lv] = await value(`[data-testid="ri-${l}-level-${lv}"]`);
      // Event Likelihoods: present or not, its heading and note, each row's label, text and size.
      const box = page.locator(`[data-testid="ri-${l}-event-likelihoods"]`);
      out[l].likelihoods = (await box.count()) === 0 ? null : {
        heading: (await box.locator('h4').innerText()).trim(),
        note: (await box.locator('p').innerText()).trim(),
        rows: await Promise.all(RETURN_YEARS.map(async n => {
          const el = page.locator(`[data-testid="ri-${l}-likelihood-${n}"]`);
          const v = await el.getAttribute('data-value');
          return { n, label: (await el.locator('xpath=../span[1]').innerText()).trim(), text: (await el.innerText()).trim(), size: v === null ? null : Number(v) };
        })),
      };
    }
    out.calendar = Number((await page.$eval('[data-testid="ri-year"]', el => el.selectedOptions[0].textContent)).match(/\d{4}/)[0]);
    return out;
  }
  const options = async () => page.$$eval('[data-testid="ri-year"] option', os => os.map(o => ({ value: Number(o.value), text: o.textContent.trim() })));

  async function setLevel(lv) {
    if (lv === 'expected') {
      const reset = page.getByRole('button', { name: /^Reset to Expected/ }).first();
      if (await reset.count() > 0) { await reset.click(); await page.waitForTimeout(300); }
      return;
    }
    const s = page.locator('div.flex.flex-col.gap-2', { has: page.locator('span', { hasText: /^Funding Confidence Level$/ }) }).first().locator('input[type=range]');
    await s.focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < (lv - 30) / 5; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
  }
  const offeredOn = l => page.$$eval(`[data-testid^="reins-option-${l}-"]`,
    (els, prefix) => els.map(el => el.getAttribute('data-testid').replace(prefix, '')), `reins-option-${l}-`);

  // SECTION 1 of one indication: its labels follow the priced year, and its
  // figures chain to pricing's projected pure premium.
  let controlled = false;
  function sectionOne(ind, name, rc = 0) {
    const P = ind.calendar, level = P - 1;
    for (const [l] of LINES) {
      const x = ind[l];
      ok(x.labels.losses === `5-Year Trended Average Loss at ${level} Rate Level` && x.labels.exposure === `${level} Exposure`
        && x.labels.pp === `Indicated Pure Premium at ${level} Rate Level` && x.labels.projected === `Projected Pure Premium for Program Year ${P}`
        && x.labels.change === `Indicated Rate Change from the ${level} Rate`,
        `${mode}, ${name}, ${P}, ${l}: section 1's labels follow the priced year`, `${x.labels.losses} | ${x.labels.exposure} | ${x.labels.pp} | ${x.labels.projected} | ${x.labels.change}`);
      ok(near(x.losses / (x.exposure * 10_000), x.pp) && near(x.pp * x.trend, x.projected),
        `${mode}, ${name}, ${P}, ${l}: losses / ${level} exposure = the pure premium at ${level}'s level, x one year's trend = the projection`,
        `${x.pp.toFixed(6)} x ${x.trend} = ${(x.pp * x.trend).toFixed(6)} vs ${x.projected.toFixed(6)}`);
      ok(x.credit === 0 && near(x.expected, x.projected / x.permissible) && expenseOk(l, x, rc) && x.retired === 0,
        `${mode}, ${name}, ${P}, ${l}: the rate at Expected is the projected pure premium / the permissible loss ratio; admin 20%, risk control ${(rc * 100).toFixed(0)}% (the year's choice), total ${((ADMIN[l] + rc) * 100).toFixed(0)}%, permissible ${((1 - ADMIN[l] - rc) * 100).toFixed(0)}%; no contingency; no investment income line`,
        `${x.expected.toFixed(6)} vs ${(x.projected / x.permissible).toFixed(6)}; admin ${(x.admin * 100).toFixed(3)}%, risk control ${(x.rc * 100).toFixed(3)}%, permissible ${(x.permissible * 100).toFixed(3)}%, total expense ${(x.totalExpense * 100).toFixed(3)}%, ${x.retired} retired rows`);
      // THE CONTROL, once a year above 0% is read: the multiplier's permissible loss ratio is refused.
      if (rc > 0 && !controlled) {
        controlled = true;
        ok(!expenseOk(l, { ...x, permissible: (1 - ADMIN[l]) / (1 + rc), totalExpense: 1 - (1 - ADMIN[l]) / (1 + rc) }, rc),
          `${mode}, ${name}, ${P}, ${l}: control — the multiplier's permissible loss ratio, (1 - admin) / (1 + risk control), is refused`);
      }
      ok(near(x.change, x.expected / x.current - 1),
        `${mode}, ${name}, ${P}, ${l}: the indicated rate change is the rate at Expected / the Current rate - 1`,
        `${(x.change * 100).toFixed(4)}%`);
    }
  }

  // SECTION 3's labels name the years: the current year's rate, and the
  // priced year's indicated rates.
  function sectionThree(ind, name) {
    const P = ind.calendar;
    const want = [`${P - 1} Rate`, `Indicated ${P} Rate at Expected`, ...LEVELS.map(lv => `Indicated ${P} Rate at ${lv}% CLF`)];
    for (const [l] of LINES) {
      const got = [ind[l].labels.current, ind[l].labels.expected, ...ind[l].labels.levels];
      ok(JSON.stringify(got) === JSON.stringify(want), `${mode}, ${name}, ${P}, ${l}: section 3 names the current year's rate and the ${P} indicated rates`,
        got.join(' | '));
    }
  }

  // THE COMING YEAR'S OTHER LABELS: the top bar's current year, the lock
  // button's and the Decisions page's program year.
  async function yearNames(P, name) {
    const current = (await page.textContent('[data-testid="header-calendar"]')).trim();
    const lock = (await page.getByRole('button', { name: /Lock Program Year/ }).first().innerText()).trim();
    await tab('Decisions');
    await lineView("Workers' Compensation");
    const heading = (await page.locator('h2', { hasText: /^Decisions for Program Year/ }).first().innerText()).trim();
    ok(current === String(P - 1) && lock === `Lock Program Year ${P}` && heading === `Decisions for Program Year ${P} — Workers' Compensation`,
      `${mode}, ${name}: the top bar shows the current year ${P - 1}, the lock button and Decisions page Program Year ${P}`,
      `${current} | ${lock} | ${heading}`);
  }

  // THE COMING YEAR: every level, every cover, against the panel.
  // The Event Likelihoods: shown with shocks on only; at growth 1 each size the
  // catalogue's; at a later year every size the same multiple of it.
  function likelihoods(ind, name, shocksOn, atGrowthOne) {
    for (const [l] of LINES) {
      const t = ind[l].likelihoods;
      if (!shocksOn) { ok(t === null, `${mode}, ${name}, ${l}: no Event Likelihoods with shocks off`); continue; }
      ok(t !== null && t.heading === 'Event Likelihoods' && t.note === 'The chance in any year of a single large claim at least this size.'
        && t.rows.every((r, i) => r.label === `1 in ${RETURN_YEARS[i]} years`),
        `${mode}, ${name}, ${l}: "Event Likelihoods" beside the cover prices, its note and 1 in 10 to 1 in 200 years`, JSON.stringify(t && [t.heading, t.note]));
      if (!t) continue;
      const want = RETURN_YEARS.map(n => exactSize(l, n));
      ok(t.rows.every((r, i) => (want[i] === null) === (r.size === null) && (r.size !== null || r.text === '—')),
        `${mode}, ${name}, ${l}: a size where the line's T events reach 1 in N, "—" where they are rarer`, t.rows.map(r => r.text).join(' · '));
      const ratios = t.rows.filter((r, i) => r.size !== null && want[i] !== null).map(r => r.size / want[RETURN_YEARS.indexOf(r.n)]);
      ok(ratios.length > 0 && ratios.every(x => Math.abs(x - ratios[0]) < 1e-6 * ratios[0])
        && (atGrowthOne ? Math.abs(ratios[0] - 1) < 1e-6 : ratios[0] > 1),
        `${mode}, ${name}, ${l}: every size is the catalogue's ${atGrowthOne ? 'at growth 1 (2027)' : 'x one growth factor above 1'}`,
        ratios.map(x => x.toFixed(6)).join(', '));
    }
  }

  async function comingYear(name, programYear, shocksOn = true, rc = 0) {
    const ind = await readIndication();
    likelihoods(ind, name, shocksOn, programYear === 2027);
    sectionOne(ind, name, rc);
    sectionThree(ind, name);
    ok(ind.calendar === programYear, `${mode}, ${name}: the coming year is Program Year ${programYear}`, String(ind.calendar));
    const opts = await options();
    ok(opts.length > 0 && ind.year === opts[opts.length - 1].value,
      `${mode}, ${name}: the dropdown defaults to the coming year`, opts.map(o => o.text).join(', '));
    await yearNames(programYear, name);
    await tab('Decisions');
    for (const [l, label] of LINES) {
      await lineView(label);
      const offered = await offeredOn(l);
      ok(JSON.stringify(Object.keys(ind[l].reins).sort()) === JSON.stringify([...offered].sort()),
        `${mode}, ${name}, ${l}: the page lists exactly the covers the Decisions page offers`, offered.join(', '));
      ok(ind[l].window === 5,
        `${mode}, ${name}, ${l}: five complete years in the window`, `${ind[l].window}`);
      for (const option of offered) {
        await page.click(`[data-testid="reins-option-${l}-${option}"]`);
        await page.waitForTimeout(300);
        for (const lv of ['expected', ...LEVELS]) {
          await setLevel(lv);
          const panel = await value('[data-testid="new-rate-final"]');
          const indicated = lv === 'expected' ? ind[l].expected : ind[l].levels[lv];
          ok(near(panel, indicated + ind[l].reins[option]),
            `${mode}, ${name}, ${l}, ${option}, ${lv === 'expected' ? 'Expected' : `${lv}%`}: indicated + the cover's price = the panel's rate`,
            `${indicated.toFixed(4)} + ${ind[l].reins[option].toFixed(4)} vs ${panel.toFixed(6)}`);
        }
      }
      await page.click(`[data-testid="reins-option-${l}-${offered[0]}"]`);
      await setLevel('expected');
    }
  }

  // A line's Risk Control slider to a whole percent.
  async function setRiskControl(l, rc) {
    const s = page.locator('div.flex.flex-col.gap-2', { has: page.locator('span', { hasText: new RegExp(`^${RC_LABEL[l]}$`) }) }).first().locator('input[type=range]');
    await s.focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < Math.round(rc * 100); i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
  }

  // SET A YEAR'S CHOICES and record the rate the panel charges for them.
  async function choose(level, coverIndex, rc = 0) {
    await tab('Decisions');
    const charged = {};
    for (const [l, label] of LINES) {
      await lineView(label);
      const offered = await offeredOn(l);
      const cover = offered[Math.min(coverIndex, offered.length - 1)];
      await page.click(`[data-testid="reins-option-${l}-${cover}"]`);
      await page.waitForTimeout(300);
      await setLevel(level);
      await setRiskControl(l, rc);
      charged[l] = { level, cover, rc, rate: await value('[data-testid="new-rate-final"]') };
    }
    return charged;
  }

  // EACH PLAYED YEAR, from the dropdown, against what was charged.
  async function playedYears(name, played) {
    await readIndication();
    const opts = await options();
    ok(opts.length === played.length + 1 && opts.every((o, i) => o.value === i + 1),
      `${mode}, ${name}: the dropdown runs from year 1 to the coming year`, opts.map(o => o.text).join(', '));
    const rows = [];
    for (let i = 0; i < played.length; i++) rows.push(await readIndication(i + 1));
    rows.push(await readIndication(played.length + 1));
    for (let i = 0; i < played.length; i++) { sectionOne(rows[i], `${name}, played`, played[i].WC.rc); sectionThree(rows[i], `${name}, played`); }
    for (let i = 0; i < played.length; i++) {
      for (const [l] of LINES) {
        const c = played[i][l];
        const ind = c.level === 'expected' ? rows[i][l].expected : rows[i][l].levels[c.level];
        const price = rows[i][l].reins[c.cover];
        ok(near(ind + price, c.rate),
          `${mode}, ${name}, year ${i + 1}, ${l} (${c.level === 'expected' ? 'Expected' : `${c.level}%`}, ${c.cover}): indicated + the cover bought = the rate charged`,
          `${ind.toFixed(4)} + ${price.toFixed(4)} vs ${c.rate.toFixed(6)}`);
        ok(near(ind, rows[i + 1][l].current),
          `${mode}, ${name}, year ${i + 1}, ${l}: that indicated rate is year ${i + 2}'s Current rate`, `${ind.toFixed(6)} vs ${rows[i + 1][l].current.toFixed(6)}`);
        ok(rows[i][l].window === 5,
          `${mode}, ${name}, year ${i + 1}, ${l}: five complete years in the window`);
      }
    }
    // Back to the default for whatever follows.
    await page.selectOption('[data-testid="ri-year"]', String(played.length + 1));
  }

  return { comingYear, choose, playedYears, tab };
}

async function solo(browser) {
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/solo');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('[data-testid="scenario"]', { timeout: 20000 });
  await page.locator('[data-testid="scenario"]').selectOption('7');
  for (const [, label] of LINES) {
    const btn = page.locator('button', { hasText: label }).first();
    if (!(await btn.evaluate(el => el.className.includes('ring-1')))) await btn.click();
  }
  await page.getByRole('button', { name: 'Single player', exact: true }).click();
  await page.waitForSelector('text=Lock Program Year', { timeout: 60000 });
  const s = screen(page, 'solo');

  await s.comingYear('before year 1', 2027);
  const played = [];
  for (const [y, level, cover, rc] of [[1, 'expected', 1, 0], [2, 80, 0, 0.02]]) {
    played.push(await s.choose(level, cover, rc));
    await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
    await page.waitForTimeout(2500);
    const decline = page.getByRole('button', { name: /Decline/i }).first();
    if (await decline.count() > 0) { await decline.click(); await page.waitForTimeout(800); }
    // wip/shocks: a shock can bring a loan offer, which posts only on Confirm & Continue.
    const confirmLoan = page.getByRole('button', { name: /Confirm & Continue/ }).first();
    if (await confirmLoan.count() > 0) { await confirmLoan.click(); await page.waitForTimeout(800); }
    await page.waitForSelector(`text=Lock Program Year ${2027 + y}`, { timeout: 120000 });
  }
  // ⚠ SINGLE PLAYER DOES NOT CARRY THE YEAR'S CHOICES FORWARD: App.tsx's
  // commitYear resets every decision to its default for the next year (only
  // the old risk-control programs carry), so the coming year reads 0% here.
  // A hosted team's choices DO carry (session/client/decisions.ts), below.
  await s.comingYear('after two played years', 2029, true, 0);
  await s.playedYears('after two played years', played);
  ok(errors.length === 0, 'solo: no page errors', errors[0] ?? '');
}

async function hosted(browser) {
  const ctx = await browser.newContext({ baseURL: BASE });
  const host = await ctx.newPage();
  const page = await ctx.newPage();
  const errors = [];
  for (const p of [host, page]) p.on('pageerror', e => errors.push(e.message));
  await host.goto('/host');
  await host.waitForSelector('[data-testid="create-room"]');
  await host.fill('[data-testid="event-name"]', 'Rate Indication');
  await host.selectOption('[data-testid="seed"]', '7');
  await host.fill('[data-testid="year-count"]', '4');
  await host.fill('[data-testid="expected-teams"]', '1');
  await host.click('[data-testid="create-room"]');
  // No shock is scheduled, so the room's shocks are off (shockLosses.gameShocksOn).
  await host.waitForSelector('[data-testid="room-code"]');
  const code = (await host.textContent('[data-testid="room-code"]')).trim();
  await page.goto(`/join/${code}`);
  await page.waitForSelector('[data-testid="team-picker"]');
  await page.fill('[data-testid="team-name"]', 'Harbour Mutual');
  await page.click('[data-testid="join-team"]');
  await page.waitForSelector('[data-testid="session-strip"]', { timeout: 180000 });
  await page.waitForSelector('[data-testid="rate-indication"], button:has-text("Rate Indication")', { timeout: 60000 });
  const s = screen(page, 'hosted');

  await s.comingYear('before year 1', 2027, false);
  const played = [];
  for (const [y, level, cover, rc] of [[1, 'expected', 1, 0], [2, 80, 0, 0.02]]) {
    played.push(await s.choose(level, cover, rc));
    await page.getByRole('button', { name: /Lock Program Year/ }).first().click();
    await page.waitForSelector('[data-testid="waiting"]', { timeout: 30000 });
    await host.click('[data-testid="advance"]');
    await page.waitForFunction(n => document.querySelector('[data-testid="posted-year"]')?.textContent.includes(`year ${n} result posted`), y, { timeout: 180000 });
    await page.waitForTimeout(1000);
  }
  // Hosted: year 2's 2% carries forward to the coming year — the last submitted set.
  await s.comingYear('after two played years', 2029, false, 0.02);
  await s.playedYears('after two played years', played);
  ok(errors.length === 0, 'hosted: no page errors', errors[0] ?? '');
}

(async () => {
  await requireServer();
  const browser = await launchBrowser();
  await solo(browser);
  await hosted(browser);
  await browser.close();
  console.log(`\nrate-indication: ${passed}/${passed + failed} checks passed`);
  console.log(failed === 0 ? 'RATE INDICATION PASS' : 'FAIL');
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
