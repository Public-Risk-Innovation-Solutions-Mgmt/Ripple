// ============================================================================
// THE AGGREGATE COVER ON ATTRITIONAL LOSSES (wip/aggregate-cover) — the gate.
//
//   npx tsx scripts/diagnostics/aggregate-cover-check.ts
//
//   1. OPTIONS: None, 110/50, 125/50 and 150/50 on every line, with the
//      brief's attachments, limits and loads; None the default and what an
//      absent choice reads as; ALL FOUR IN EVERY GAME, shocks on or off — the
//      per-claim covers' rule (COVERS_IN_EVERY_GAME) — and a quote with the
//      shocks off prices each exactly as with them on. Control: the switch
//      off (None alone with the shocks off, a cover then refused) must fail.
//   2. PRICE, RECOMPUTED INDEPENDENTLY: four cases a year (no surge 85%, Low
//      7.5%, Mid 5.25%, High 2.25%), each surge at the top of its range (or the
//      middle, with the switch), ordinary luck normal around the case's level
//      at the line's ordinary-year CV x that level; the expected layer loss by
//      numerical integration of the normal density (not the module's closed
//      form), x the load. Held to the dollar against the brief's 2027 table and
//      to 1e-7 at other books and years, at both switch settings.
//   3. IN A GAME, every world, line and year (three scenarios, five years,
//      the options bought in turn): the price charged is section 2's on the
//      quoted book; the terms are the shares x expected attritional; the
//      attritional losses are the engine's ordinary losses as booked less any
//      Economic Inflation uplift — no large claim; the recovery is
//      min(max(attritional - attachment, 0), limit).
//   4. AGAINST THE SAME GAME WITH NONE: the reinsurance cost differs by the
//      price and the recovery by the cover's recovery, exactly; the gross
//      losses, the large claims, the development ceded and every accident
//      year's gross ledger are identical — the cover never reaches a large
//      claim or the development of an older year, and it is never
//      recalculated; the Annual Statement's ceded losses by program year differ
//      by the recovery and its Reinsurance Premium by the price.
//   5. NONE IS NONE: a game holding 'none' explicitly plays exactly as one
//      that never chose (results compared with the decision echo set aside).
//   6. A GAME WITH ITS SHOCKS OFF (single player, SOLO_SHOCKS off): the cover is
//      bought, priced and booked exactly as section 3 holds — no surge, so it
//      pays only on a bad ordinary year, and it does pay in some.
//   7. THE WORDING, WRITTEN OUT HERE: the title, note and footnote, and each
//      option's label — "110% / 50% — Covers losses from 110% to 160% of
//      expected" — built from the option's attachment and limit. Control: an
//      attachment moved at runtime relabels the option, so the written-out
//      wording fails.
//
// ⚠ THE BRIEF IS WRITTEN OUT HERE — options, loads, odds, surge ranges, the
// ordinary-year CVs' inputs and the 2027 prices — not read from
// pricingParameters, so a changed parameter fails rather than moving the
// expectation with it. Sections 1 and 2 carry RUNTIME controls (a load, the
// surge basis, a surge range and the odds changed in place, the section
// required to fail, then restored). Sections 3 and 4 compare engine output to
// the rule; their controls feed each comparator a record carrying one defect a
// person might write — a recovery that counts the year's large claims, one
// recalculated on a developed year, terms struck on expected losses including
// the large claims — and require it to fail.
// ============================================================================

import {
  AGGREGATE_COVER_OPTIONS, AGGREGATE_COVER_SURGE_BASIS, COVERS_IN_EVERY_GAME, R_MODEL, SOLO_SHOCKS, T_COVER_FREQUENCY,
} from '../../src/data/pricingParameters';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { buildYearWalkthrough } from '../../src/utils/yearWalkthrough';
import {
  AGGREGATE_COVER_FOOTNOTE, AGGREGATE_COVER_NOTE, AGGREGATE_COVER_TITLE,
  aggregateCoverLabel, aggregateCoverOf, aggregateCoverOptionIds, aggregateCoverQuote,
} from '../../src/utils/aggregateCover';
import { ordinaryLossCostPer100 } from '../../src/utils/ordinaryLoss';
import { quoteNewRateStack } from '../../src/utils/linePricing';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet, defaultLineDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { programYearsOf, buildAnnualStatement } from '../../src/utils/resultsStatement';
import type { CoverageLine, GameState, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const failures: string[] = [];
const check = (problems: string[], label: string, detail = '') => {
  if (problems.length) failures.push(label);
  console.log(`  ${problems.length ? 'FAIL' : 'OK  '}  ${label}${detail ? `  — ${detail}` : ''}`);
  for (const p of problems.slice(0, 5)) console.log(`          ${p}`);
};
const control = (label: string, breakIt: () => () => void, section: () => string[]) => {
  const restore = breakIt();
  let problems: string[];
  try { problems = section(); } finally { restore(); }
  check(problems.length > 0 ? [] : ['the section passed with the thing it guards broken'], `  control: ${label}`,
    `${problems.length} problem(s) when broken`);
};
const near = (a: number, b: number, rel = 1e-9, abs = 1e-6) => Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b));

// ---- THE BRIEF ---------------------------------------------------------------
const BRIEF_OPTIONS: [string, number, number, number][] = [
  // [id, attachment, limit, load] — shares of expected attritional losses.
  ['none', 0, 0, 0], ['agg-110-50', 1.10, 0.50, 1.2], ['agg-125-50', 1.25, 0.50, 1.0], ['agg-150-50', 1.50, 0.50, 1.0],
];
type Lv = 'Low' | 'Mid' | 'High';
const BRIEF_ODDS: Record<Lv, number> = { Low: 0.075, Mid: 0.0525, High: 0.0225 };
const BRIEF_A: Record<CoverageLine, Record<Lv, [number, number]>> = {
  GL: { Low: [0.05, 0.15], Mid: [0.15, 0.35], High: [0.35, 0.70] },
  WC: { Low: [0.05, 0.15], Mid: [0.15, 0.35], High: [0.35, 0.75] },
  Property: { Low: [0.10, 0.25], Mid: [0.25, 0.50], High: [0.50, 1.00] },
};
// The ordinary-year CV: the year factor's (BASELINE_CV), member luck 10%,
// member risk 30%, 100 equal members — sqrt((1+Y²)(1+((1+U²)(1+R²)−1)/n) − 1).
const BRIEF_YEAR_CV: Record<CoverageLine, number> = { WC: 0.06, GL: 0.10, Property: 0.08 };
const briefCv = (l: CoverageLine) => {
  const member = (1 + 0.1 ** 2) * (1 + 0.3 ** 2) - 1;
  return Math.sqrt((1 + BRIEF_YEAR_CV[l] ** 2) * (1 + member / 100) - 1);
};
/**
 * The brief's 2027 prices at default decisions, to the dollar, as the game
 * charges them. ⚠ GL IS $41 / $16 / $5 BELOW THE $675,996 / $263,038 / $74,456
 * AGREED, AND THAT IS THE BOOK, NOT THE METHOD: the rate is struck once per
 * team-year on the book averaged over the worlds (614.92 in 2027), and the
 * agreed figures were read off world 1's own book (614.95). WC and Property
 * write the same book in every world.
 */
const BRIEF_2027: Record<CoverageLine, [number, number, number]> = {
  WC: [667_967, 292_675, 94_629],
  GL: [675_955, 263_022, 74_451],
  Property: [879_680, 434_590, 188_692],
};

// E[min(max(X − a, 0), L)] for X ~ N(m, s²), by Simpson's rule on the density —
// ∫ min(max(x − a, 0), L) φ((x − m)/s)/s dx over m ± 12s — so the gate does not
// share the module's closed form.
function layerByIntegration(m: number, s: number, a: number, L: number): number {
  const lo = m - 12 * s, hi = m + 12 * s, n = 24_000, h = (hi - lo) / n;
  const f = (x: number) => Math.min(Math.max(x - a, 0), L) * Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
  let sum = f(lo) + f(hi);
  for (let i = 1; i < n; i++) sum += f(lo + i * h) * (i % 2 ? 4 : 2);
  return sum * h / 3;
}
/** The brief's price for a book, independently. */
function briefQuote(l: CoverageLine, id: string, expectedNormal: number, basis: 'maximum' | 'midpoint') {
  const [, att, lim, load] = BRIEF_OPTIONS.find(o => o[0] === id)!;
  const surge = (lv: Lv) => basis === 'maximum' ? BRIEF_A[l][lv][1] : (BRIEF_A[l][lv][0] + BRIEF_A[l][lv][1]) / 2;
  const cases: [number, number][] = [[1 - 0.15, 0], ...(['Low', 'Mid', 'High'] as Lv[]).map(lv => [BRIEF_ODDS[lv], surge(lv)] as [number, number])];
  const avg = cases.reduce((s, [p, a]) => s + p * a, 0);
  const a = att * (1 + avg), L = lim * (1 + avg);
  const per = lim === 0 ? 0 : cases.reduce((s, [p, x]) => s + p * layerByIntegration(1 + x, briefCv(l) * (1 + x), a, L), 0);
  return { attachment: a * expectedNormal, limit: L * expectedNormal, expectedAttritional: (1 + avg) * expectedNormal, price: per * expectedNormal * load };
}

// ---- 1. OPTIONS --------------------------------------------------------------
console.log('\n1. Options');
function sectionOptions(): string[] {
  const p: string[] = [];
  const ids = AGGREGATE_COVER_OPTIONS.map(o => o.id);
  if (JSON.stringify(ids) !== JSON.stringify(BRIEF_OPTIONS.map(o => o[0]))) p.push(`options ${ids.join(', ')}`);
  for (const [id, att, lim, load] of BRIEF_OPTIONS) {
    const o = AGGREGATE_COVER_OPTIONS.find(x => x.id === id);
    if (!o || o.attachment !== att || o.limit !== lim || o.load !== load) p.push(`${id}: ${JSON.stringify(o)}`);
  }
  for (const l of LINES) {
    if (defaultLineDecisionSet(l).aggregateCover !== undefined) p.push(`${l}: the default writes aggregateCover`);
    if (aggregateCoverOf(defaultLineDecisionSet(l)) !== 'none') p.push(`${l}: an absent choice does not read as None`);
  }
  // In every game, shocks on or off: the same four, at the same prices.
  for (const shocks of [true, false]) {
    if (JSON.stringify(aggregateCoverOptionIds(shocks)) !== JSON.stringify(BRIEF_OPTIONS.map(o => o[0]))) {
      p.push(`shocks ${shocks ? 'on' : 'off'}: offered ${aggregateCoverOptionIds(shocks).join(', ')}`);
    }
  }
  for (const l of LINES) for (const [id] of BRIEF_OPTIONS) {
    const q = (shocks: boolean) => {
      try {
        return quoteNewRateStack({
          line: l, yearNumber: 1, members: { exposure: 900 }, exposure: 900, groundUpPurePremiumPer100: 3, clf: 1,
          riskControlPct: 0, layersPlaced: [], aggregateStopLevel: -1, reinsuranceOption: 'none', shocks, aggregateCover: id,
        }).reinsuranceCost;
      } catch { return undefined; }
    };
    const on = q(true), off = q(false);
    if (off === undefined) p.push(`${l} ${id}: refused with the shocks off`);
    else if (on !== off) p.push(`${l} ${id}: priced ${off} with the shocks off, ${on} with them on`);
  }
  return p;
}
check(sectionOptions(), 'four options, None the default and absent; all four in every game, shocks on or off, at the same prices');
control('the covers not in every game (COVERS_IN_EVERY_GAME off)', () => {
  const was = COVERS_IN_EVERY_GAME.enabled; COVERS_IN_EVERY_GAME.enabled = false;
  return () => { COVERS_IN_EVERY_GAME.enabled = was; };
}, sectionOptions);
control('the 110/50 attachment at 1.15', () => {
  const o = AGGREGATE_COVER_OPTIONS[1] as { attachment: number }; const was = o.attachment; o.attachment = 1.15;
  return () => { o.attachment = was; };
}, sectionOptions);

// ---- 2. PRICE ------------------------------------------------------------------
console.log('\n2. Price, recomputed by integration');
// The 2027 book at default decisions (the engine's own; section 3 reads it from a game).
let book2027: Record<CoverageLine, number> = { WC: 0, GL: 0, Property: 0 };
function sectionPrice(basis: 'maximum' | 'midpoint', withTable: boolean): string[] {
  const p: string[] = [];
  for (const l of LINES) {
    for (const [y, scale] of [[1, 1], [3, 1.07], [6, 0.93]] as [number, number][]) {
      const exposure = (book2027[l] || 900) * scale;
      const en = exposure * 10_000 * ordinaryLossCostPer100(l, y);
      for (const [id] of BRIEF_OPTIONS) {
        const q = aggregateCoverQuote(l, id, exposure, y, basis);
        const b = briefQuote(l, id, en, basis);
        if (!near(q.expectedNormal, en)) p.push(`${l} y${y} ${id}: expected normal ${q.expectedNormal} vs ${en}`);
        if (!near(q.price, b.price, 1e-7, 0.01)) p.push(`${l} y${y} ${id} ${basis}: price ${q.price.toFixed(2)} vs ${b.price.toFixed(2)}`);
        if (!near(q.attachment, b.attachment) || !near(q.limit, b.limit)) p.push(`${l} y${y} ${id}: terms ${q.attachment}/${q.limit} vs ${b.attachment}/${b.limit}`);
      }
    }
    if (withTable) {
      BRIEF_OPTIONS.slice(1).forEach(([id], i) => {
        const price = aggregateCoverQuote(l, id, book2027[l], 1, basis).price;
        if (Math.abs(price - BRIEF_2027[l][i]) > 1) p.push(`${l} 2027 ${id}: $${price.toFixed(2)} vs the brief's $${BRIEF_2027[l][i].toLocaleString('en-US')}`);
      });
    }
  }
  return p;
}

// ---- the games -------------------------------------------------------------------
type YearLines = Record<CoverageLine, LineResultSet[]>;   // per world
interface Played { gs: GameState; byYear: YearLines[] }
const OPTION_BY_YEAR = ['agg-110-50', 'agg-110-50', 'agg-125-50', 'agg-150-50', 'agg-110-50'];
const YEARS = 5;
function play(scenario: string, mode: 'cover' | 'absent' | 'none'): Played {
  const dec = (y: number) => {
    const d = defaultDecisionSet(y);
    if (mode !== 'absent') for (const l of LINES) d.byLine[l].aggregateCover = mode === 'none' ? 'none' : OPTION_BY_YEAR[y - 1];
    return d;
  };
  const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: YEARS, startingYear: 2027, instanceId: scenario, activeLines: LINES } as never);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [],
    currentDecisions: dec(1), priorHistory, earlyPreGameHistory } as GameState);
  const byYear: YearLines[] = [];
  for (let y = 1; y <= YEARS; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, dec(y)), LINES)), currentYearNumber: y + 1 };
    // A world keeps only its latest result, so each is read as it is played.
    byYear.push(Object.fromEntries(LINES.map(l => [l, gs.worlds!.map(w => w.lockedResults.at(-1)!.byLine[l]!)])) as YearLines);
  }
  return { gs, byYear };
}

const SCENARIOS = ['8', '13', '15'];
const games = SCENARIOS.map(s => ({ s, cover: play(s, 'cover'), absent: play(s, 'absent'), none: play(s, 'none') }));
book2027 = Object.fromEntries(LINES.map(l => {
  const ac = games[0].cover.byYear[0][l][0].attritionalCover!;
  return [l, ac.expectedNormal / (10_000 * ordinaryLossCostPer100(l, 1))];
})) as Record<CoverageLine, number>;

const basis = AGGREGATE_COVER_SURGE_BASIS.basis;
check(basis === 'maximum' ? [] : [`switch at ${basis}`], 'the surge basis is the maximum (the workbook\'s)');
check(sectionPrice('maximum', true), 'prices at the maximum: the method, and the 2027 table to the dollar',
  `2027: ${LINES.map(l => `${l} ${BRIEF_OPTIONS.slice(1).map(([id]) => `$${Math.round(aggregateCoverQuote(l, id, book2027[l], 1).price).toLocaleString('en-US')}`).join(' / ')}`).join('; ')}`);
check(sectionPrice('midpoint', false), 'prices at the midpoint: the switch moves the cases and the terms together');
// Runtime controls: each changes the thing in place and requires the section to fail.
control('the 110/50 load at 1.1', () => {
  const o = AGGREGATE_COVER_OPTIONS[1] as { load: number }; const was = o.load; o.load = 1.1;
  return () => { o.load = was; };
}, () => sectionPrice('maximum', true));
control('WC\'s High surge range topping at 0.70', () => {
  const r = R_MODEL.aShock.WC.High as unknown as number[]; const was = r[1]; r[1] = 0.70;
  return () => { r[1] = was; };
}, () => sectionPrice('maximum', true));
control('the Mid odds at 5%', () => {
  const f = T_COVER_FREQUENCY as Record<Lv, number>; const was = f.Mid; f.Mid = 0.05;
  return () => { f.Mid = was; };
}, () => sectionPrice('maximum', true));
control('the module priced at the midpoint while the brief reads the maximum', () => {
  const was = AGGREGATE_COVER_SURGE_BASIS.basis; AGGREGATE_COVER_SURGE_BASIS.basis = 'midpoint';
  return () => { AGGREGATE_COVER_SURGE_BASIS.basis = was; };
}, () => {
  // The brief at the maximum against the module at its (broken) default.
  const p: string[] = [];
  for (const l of LINES) BRIEF_OPTIONS.slice(1).forEach(([id], i) => {
    if (Math.abs(aggregateCoverQuote(l, id, book2027[l], 1).price - BRIEF_2027[l][i]) > 1) p.push(`${l} ${id}`);
  });
  return p;
});

// ---- 3. IN A GAME ------------------------------------------------------------------
console.log('\n3. In a game: price, terms, attritional losses and recovery, every world');
interface Row { tag: string; r: LineResultSet; year: number; line: CoverageLine; option: string }
const coverRows: Row[] = [];
for (const g of games) g.cover.byYear.forEach((yl, i) => LINES.forEach(l => yl[l].forEach((r, w) =>
  coverRows.push({ tag: `s${g.s} w${w} y${i + 1} ${l}`, r, year: i + 1, line: l, option: OPTION_BY_YEAR[i] }))));

function sectionGame(rows: Row[]): string[] {
  const p: string[] = [];
  for (const { tag, r, year, line, option } of rows) {
    const ac = r.attritionalCover, ne = r.newLossEngine;
    if (!ac || !ne) { p.push(`${tag}: no cover record`); continue; }
    if (ac.optionId !== option) p.push(`${tag}: option ${ac.optionId} vs ${option}`);
    // The price and terms are section 2's on the quoted book.
    const b = briefQuote(line, option, ac.expectedNormal, 'maximum');
    if (!near(ac.price, b.price, 1e-7, 0.01)) p.push(`${tag}: price ${ac.price} vs ${b.price}`);
    if (!near(ac.attachment, b.attachment) || !near(ac.limit, b.limit)) p.push(`${tag}: terms`);
    if (!near(ac.expectedAttritional, b.expectedAttritional)) p.push(`${tag}: expected attritional`);
    void year;
    // Attritional = the ordinary losses as booked, less Economic Inflation's uplift on them (cut 0 at default).
    const inflation = ne.events.filter(e => e.name === 'Economic Inflation').reduce((s, e) => s + e.uplift, 0);
    const attritional = ne.ordinaryRealised * (1 + ne.uplift - inflation) / (1 + ne.uplift);
    if (!near(ac.attritional, attritional, 1e-9, 0.01)) p.push(`${tag}: attritional ${ac.attritional} vs ${attritional}`);
    if (!near(ac.normalLoss + ac.surgeLoss, ac.attritional, 1e-12, 1e-6)) p.push(`${tag}: normal + surge != attritional`);
    // Never a large claim: the attritional losses are the gross less every large claim and any inflation uplift.
    if (ac.attritional > r.grossUltimateLoss - ne.shockLarge - ne.routineLarge + 0.01) p.push(`${tag}: attritional above gross less large claims`);
    const recovery = Math.min(Math.max(ac.attritional - ac.attachment, 0), ac.limit);
    if (!near(ac.recovery, recovery, 1e-12, 1e-6)) p.push(`${tag}: recovery ${ac.recovery} vs ${recovery}`);
  }
  return p;
}
const paid = coverRows.filter(x => (x.r.attritionalCover?.recovery ?? 0) > 0);
check(sectionGame(coverRows), 'every world-line-year: price, terms, attritional = ordinary less inflation, recovery = the layer',
  `${coverRows.length} world-line-years, ${paid.length} paid (${paid.filter(x => x.r.attritionalCover!.recovery === x.r.attritionalCover!.limit).length} at the limit), `
  + `${coverRows.filter(x => (x.r.newLossEngine?.shockLarge ?? 0) > 0).length} with large claims, `
  + `${coverRows.filter(x => (x.r.attritionalCover?.surge ?? 0) > 0).length} with a surge, `
  + `${coverRows.filter(x => x.r.newLossEngine?.events.some(e => e.name === 'Economic Inflation' && e.uplift > 0)).length} with Economic Inflation`);
// One price a team-year: the rate is struck once, on the averaged book, and charged in every world.
check(games.flatMap(g => g.cover.byYear.flatMap((yl, i) => LINES.flatMap(l => {
  const ps = yl[l].map(r => r.attritionalCover!.price);
  return ps.every(x => x === ps[0]) ? [] : [`s${g.s} y${i + 1} ${l}: prices ${Math.min(...ps)}–${Math.max(...ps)} across worlds`];
}))), 'one price and one set of terms a team-year, in every world');
// Comparator controls: a defect a person might write, fed through the comparator.
const withLarge = coverRows.filter(x => (x.r.newLossEngine?.shockLarge ?? 0) > 0).slice(0, 50);
control('a recovery that counts the year\'s large claims', () => () => {}, () => sectionGame(withLarge.map(x => {
  const ac = x.r.attritionalCover!; const ne = x.r.newLossEngine!;
  const attritional = ac.attritional + ne.shockLarge;
  return { ...x, r: { ...x.r, attritionalCover: { ...ac, attritional, surgeLoss: ac.surgeLoss + ne.shockLarge,
    recovery: Math.min(Math.max(attritional - ac.attachment, 0), ac.limit) } } };
})));
control('terms struck on expected losses including the large claims', () => () => {}, () => sectionGame(coverRows.slice(0, 30).map(x => {
  const ac = x.r.attritionalCover!; const k = x.r.expectedLoss / ac.expectedAttritional;
  return { ...x, r: { ...x.r, attritionalCover: { ...ac, attachment: ac.attachment * k, limit: ac.limit * k,
    recovery: Math.min(Math.max(ac.attritional - ac.attachment * k, 0), ac.limit * k) } } };
})));

// ---- 4. AGAINST NONE ------------------------------------------------------------------
console.log('\n4. Against the same game with None');
function sectionAgainstNone(gamesIn: typeof games): string[] {
  const p: string[] = [];
  for (const g of gamesIn) {
    g.cover.byYear.forEach((yl, i) => LINES.forEach(l => yl[l].forEach((r, w) => {
      const n = g.absent.byYear[i][l][w];
      const ac = r.attritionalCover!;
      const tag = `s${g.s} w${w} y${i + 1} ${l}`;
      if (!near(r.reinsuranceCost - n.reinsuranceCost, ac.price, 1e-9, 0.01)) p.push(`${tag}: cost moved ${r.reinsuranceCost - n.reinsuranceCost} vs price ${ac.price}`);
      if (!near(r.reinsuranceRecovery - n.reinsuranceRecovery, ac.recovery, 1e-9, 0.01)) p.push(`${tag}: recovery moved ${r.reinsuranceRecovery - n.reinsuranceRecovery} vs ${ac.recovery}`);
      if (r.grossUltimateLoss !== n.grossUltimateLoss) p.push(`${tag}: gross moved`);
      if (r.newLossEngine!.shockLarge !== n.newLossEngine!.shockLarge) p.push(`${tag}: large claims moved`);
      if (r.priorYearDevelopmentCeded !== n.priorYearDevelopmentCeded) p.push(`${tag}: development ceded moved ${r.priorYearDevelopmentCeded - n.priorYearDevelopmentCeded}`);
    })));
    // Every accident year's gross ledger, and its net ultimate apart by exactly that year's recovery at every valuation.
    g.cover.gs.worlds!.forEach((w, wi) => LINES.forEach(l => {
      const lc = w.poolState.lines[l].reserveDevelopment ?? [], ln = g.absent.gs.worlds![wi].poolState.lines[l].reserveDevelopment ?? [];
      for (const rc of lc.filter(x => x.yearNumber >= 1)) {
        const rn = ln.find(x => x.yearNumber === rc.yearNumber)!;
        if (JSON.stringify(rc.grossPaidByValuation) !== JSON.stringify(rn.grossPaidByValuation)) p.push(`s${g.s} w${wi} ${l} AY${rc.yearNumber}: gross ledger moved`);
        const rec = g.cover.byYear[rc.yearNumber - 1][l][wi].attritionalCover!.recovery;
        rc.ultimateByValuation.forEach((u, k) => {
          if (!near(rn.ultimateByValuation[k] - u, rec, 1e-9, 0.01)) p.push(`s${g.s} w${wi} ${l} AY${rc.yearNumber} val ${k}: net apart by ${rn.ultimateByValuation[k] - u}, recovery ${rec}`);
        });
      }
    }));
    // The Annual Statement (the averaged game): ceded losses by program year, and the Reinsurance Premium.
    for (const l of LINES) {
      const latest = g.cover.gs.lockedResults.at(-1)!;
      const pc = programYearsOf(g.cover.gs, l, latest), pn = programYearsOf(g.absent.gs, l, g.absent.gs.lockedResults.at(-1)!);
      const t = (x: { paid: number; case_: number; ibnr: number }) => x.paid + x.case_ + x.ibnr;
      for (let y = 1; y <= YEARS; y++) {
        const rec = g.cover.gs.lockedResults[y - 1].byLine[l]!.attritionalCover!.recovery;
        if (!near(t(pc.get(y)!.ceded) - t(pn.get(y)!.ceded), rec, 1e-9, 0.01)) p.push(`s${g.s} ${l} AY${y}: statement ceded apart by ${t(pc.get(y)!.ceded) - t(pn.get(y)!.ceded)}, recovery ${rec}`);
      }
      const sc = buildAnnualStatement(g.cover.gs, l, YEARS), sn = buildAnnualStatement(g.absent.gs, l, YEARS);
      // The Reinsurance Premium row's cell for the last program year.
      const prem = (st: typeof sc): number | undefined => {
        const sec = st.sections.find(x => x.key === 'ceded');
        const cell = sec?.rows.find(r => r.label === 'Reinsurance Premium')?.cells[(sec.hasPrior ? 1 : 0) + sec.windowYears.indexOf(YEARS)];
        return cell?.kind === 'value' ? cell.v : undefined;
      };
      const price = g.cover.gs.lockedResults[YEARS - 1].byLine[l]!.attritionalCover!.price;
      const va = prem(sc), vb = prem(sn);
      if (typeof va !== 'number' || typeof vb !== 'number' || !near(va - vb, price, 1e-9, 0.01)) p.push(`s${g.s} ${l}: statement Reinsurance Premium apart by ${String(va)} − ${String(vb)}, price ${price}`);
    }
  }
  return p;
}
check(sectionAgainstNone(games), 'cost + price, recovery + the cover\'s; gross, large claims, development ceded and gross ledgers unmoved; the statement\'s ceded block');
control('a recovery recalculated on the year as it develops', () => () => {}, () => sectionAgainstNone(games.slice(0, 1).map(g => ({
  ...g,
  cover: { ...g.cover, byYear: g.cover.byYear.map((yl, i) => Object.fromEntries(LINES.map(l => [l, yl[l].map(r => ({
    ...r, attritionalCover: { ...r.attritionalCover!, recovery: r.attritionalCover!.recovery * (i === 0 ? 1.02 : 1) },
  }))])) as YearLines) },
}))));

// ---- 5. NONE IS NONE --------------------------------------------------------------------
console.log('\n5. None is None');
const stripEcho = (x: unknown): string => JSON.stringify(x, (k, v) => (k === 'decisions' || k === 'currentDecisions' ? undefined : v));
function sectionNone(gamesIn: typeof games): string[] {
  const p: string[] = [];
  for (const g of gamesIn) {
    if (stripEcho(g.none.gs.lockedResults) !== stripEcho(g.absent.gs.lockedResults)) p.push(`s${g.s}: results differ`);
    if (stripEcho(g.none.gs.worlds) !== stripEcho(g.absent.gs.worlds)) p.push(`s${g.s}: worlds differ`);
    if (stripEcho(g.none.gs.lockedResults).includes('attritionalCover')) p.push(`s${g.s}: a None game carries a cover record`);
  }
  return p;
}
check(sectionNone(games), '\'none\' chosen plays exactly as never chosen; no cover record with None');
control('the cover game compared as if it were None', () => () => {}, () => sectionNone(games.slice(0, 1).map(g => ({ ...g, none: g.cover }))));

// ---- 6. A GAME WITH ITS SHOCKS OFF ---------------------------------------------------------
console.log('\n6. A game with its shocks off');
const wasSolo = SOLO_SHOCKS.enabled;
SOLO_SHOCKS.enabled = false;
let off: Played;
let offShocks: boolean;
try { off = play('8', 'cover'); offShocks = gameShocksOn(off.gs.setup, off.gs.instance); } finally { SOLO_SHOCKS.enabled = wasSolo; }
const offRows: Row[] = [];
off.byYear.forEach((yl, i) => LINES.forEach(l => yl[l].forEach((r, w) =>
  offRows.push({ tag: `off w${w} y${i + 1} ${l}`, r, year: i + 1, line: l, option: OPTION_BY_YEAR[i] }))));
const offPaid = offRows.filter(x => (x.r.attritionalCover?.recovery ?? 0) > 0);
const offProblems = [
  ...(offShocks ? ['the game\'s shocks are on'] : []),
  ...sectionGame(offRows),
  ...offRows.filter(x => (x.r.attritionalCover?.surge ?? 1) !== 0).map(x => `${x.tag}: a surge of ${x.r.attritionalCover?.surge}`),
  ...(offPaid.length > 0 ? [] : ['it never paid']),
];
check(offProblems, 'bought, priced and booked as with shocks on; no surge; it pays on a bad ordinary year',
  `${offRows.length} world-line-years, ${offPaid.length} paid; 2027 WC 110/50 $${Math.round(off.byYear[0].WC[0].attritionalCover!.price).toLocaleString('en-US')}`);
// Control: with the covers not in every game, the same shocks-off game cannot buy it.
{
  const wasCovers = COVERS_IN_EVERY_GAME.enabled;
  SOLO_SHOCKS.enabled = false; COVERS_IN_EVERY_GAME.enabled = false;
  let refused = false;
  try { play('8', 'cover'); } catch { refused = true; } finally { SOLO_SHOCKS.enabled = wasSolo; COVERS_IN_EVERY_GAME.enabled = wasCovers; }
  check(refused ? [] : ['the shocks-off game bought the cover with the switch off'],
    '  control: COVERS_IN_EVERY_GAME off — the shocks-off game\'s cover is refused', refused ? 'refused' : 'bought');
}

// ---- 7. THE WORDING ---------------------------------------------------------------------------
console.log('\n7. The wording');
const BRIEF_WORDING = {
  title: 'Aggregate Stop-Loss Coverage',
  note: 'Protects against annual attritional losses exceeding a selected percentage of expected losses, up to the coverage limit.',
  footnote: 'Coverage pays 100% of eligible losses between the attachment point and the exhaustion point.',
  labels: {
    'none': 'None — No Coverage',
    'agg-110-50': '110% / 50% — Covers losses from 110% to 160% of expected',
    'agg-125-50': '125% / 50% — Covers losses from 125% to 175% of expected',
    'agg-150-50': '150% / 50% — Covers losses from 150% to 200% of expected',
  } as Record<string, string>,
};
function sectionWording(): string[] {
  const p: string[] = [];
  if (AGGREGATE_COVER_TITLE !== BRIEF_WORDING.title) p.push(`title "${AGGREGATE_COVER_TITLE}"`);
  if (AGGREGATE_COVER_NOTE !== BRIEF_WORDING.note) p.push(`note "${AGGREGATE_COVER_NOTE}"`);
  if (AGGREGATE_COVER_FOOTNOTE !== BRIEF_WORDING.footnote) p.push(`footnote "${AGGREGATE_COVER_FOOTNOTE}"`);
  for (const [id, want] of Object.entries(BRIEF_WORDING.labels)) {
    const got = aggregateCoverLabel(id).label;
    if (got !== want) p.push(`${id}: "${got}", want "${want}"`);
  }
  return p;
}
check(sectionWording(), 'title, note, footnote and each option\'s label, as written', Object.values(BRIEF_WORDING.labels).join(' · '));
// The Year Walkthrough of a year that bought it: its reinsurance stage names the cover by title and label.
check(games[0].cover.gs.lockedResults.flatMap(r => LINES.flatMap(l => {
  const row = buildYearWalkthrough(games[0].cover.gs, r.yearNumber, l).stages.find(st => st.key === 'reinsurance')?.rows
    .find(x => x.label === BRIEF_WORDING.title);
  const want = BRIEF_WORDING.labels[OPTION_BY_YEAR[r.yearNumber - 1]];
  return row?.value === want ? [] : [`y${r.yearNumber} ${l}: "${String(row?.value)}", want "${want}"`];
})), 'the Year Walkthrough names the cover bought by its title and label');
control('the 125/50 attachment moved to 1.30 — its label follows the layer', () => {
  const o = AGGREGATE_COVER_OPTIONS[2] as { attachment: number; name: string }; const was = { a: o.attachment, n: o.name };
  // The name is struck from the layer when the options are made, so it is struck again here as they make it.
  o.attachment = 1.30; o.name = '130% / 50%';
  return () => { o.attachment = was.a; o.name = was.n; };
}, sectionWording);

// ---- verdict ------------------------------------------------------------------------------
console.log('\n' + '='.repeat(78));
if (failures.length) {
  console.log(`${failures.length} CHECK(S) FAILED:\n  ${failures.join('\n  ')}`);
  console.log('='.repeat(78));
  process.exit(1);
}
console.log('aggregate-cover-check: all checks passed');
console.log('='.repeat(78));
