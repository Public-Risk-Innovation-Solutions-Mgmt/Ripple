// ============================================================================
// THE RATE INDICATION'S PAST YEARS REPRODUCE THE RATE THE ENGINE CHARGED
// (wip/rate-indication-years) — the gate.
//
//   npx tsx scripts/diagnostics/rate-indication-years-check.ts
//
// Three scenarios (1, 7, 15), single player, three lines, three played years
// on varied choices (a cover and an aggregate cover bought, a funding level
// off Expected). On every line:
//
//   1. THE YEARS: the selector lists every history year (2021–2026), every
//      played year and the coming year, oldest first, defaulting (last) to the
//      coming year.
//   2. EACH PAST YEAR'S BUILD (buildRateIndication(...).built): its rate is the
//      rate the engine charged that year (the row's finalRatePer100), to 1e-9;
//      its steps chain — the window's paid x development = developed, x
//      reserve inflation / exposure = loss cost, x trend = trended; their
//      average x the trend to the year + the catastrophe load = the projected
//      loss cost; + ALAE + ULAE = the pure premium the year recorded; the rate's
//      pieces add to the rate. A year with no window (the first history years)
//      shows its expected-loss basis instead.
//   3. EACH PLAYED YEAR, as the page lays it out: the indicated rate at the
//      level chosen + the cover's price + the aggregate cover's = the rate
//      charged.
//   4. THE ANNUAL TREND AS A PERCENTAGE: the page, rendered, prints each
//      line's Annual Trend as one year's trend in percent (1.04 -> "4%"); its
//      control reads the factor form ("1.04") and must fail.
//
// ⚠ THE CONTROL: admin's share of premium moved to 21% at runtime AFTER the
// games are played — the rate rebuilt from it no longer is the one charged, and
// sections 2 and 3 must fail; then restored.
// ============================================================================

import { ADMIN_SHARE_OF_PREMIUM } from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { buildRateIndication, rateIndicationYears } from '../../src/utils/rateIndication';
import { gameHistory } from '../../src/utils/gameHistory';
import { lossCostTrendPerYear } from '../../src/utils/newPurePremium';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

// ⚠ tsx compiles the app's .tsx with the classic JSX runtime here, so the page
// looks for a global React — set before it loads, hence the dynamic import.
(globalThis as unknown as { React: typeof React }).React = React;
const { default: RateIndicationPage } = await import('../../src/pages/RateIndicationPage');

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SCENARIOS = ['1', '7', '15'];
const START = 2027, YEARS = 3;
const failures: string[] = [];
const check = (problems: string[], label: string, detail = '') => {
  if (problems.length) failures.push(label);
  console.log(`  ${problems.length ? 'FAIL' : 'OK  '}  ${label}${detail ? `  — ${detail}` : ''}`);
  for (const p of problems.slice(0, 6)) console.log(`          ${p}`);
};
const near = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

/** Year 1: a cover and the 110/50 aggregate cover; year 2: 80% funding; year 3: the defaults. */
function decide(y: number): DecisionSet {
  const d = defaultDecisionSet(y);
  for (const l of LINES) {
    if (y === 1) { d.byLine[l].reinsuranceOption = '$9M xs $1M'; d.byLine[l].aggregateCover = 'agg-110-50'; }
    if (y === 2) { d.byLine[l].fundingAtExpected = false; d.byLine[l].fundingConfidenceLevel = 0.8; }
  }
  return d;
}
function play(id: string): GameState {
  const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: 10, startingYear: START, instanceId: id, activeLines: LINES } as never);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [],
    currentDecisions: decide(1), priorHistory, earlyPreGameHistory } as GameState);
  for (let y = 1; y <= YEARS; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, decide(y)), LINES)), currentYearNumber: y + 1 };
  }
  return gs;
}
const games = SCENARIOS.map(s => ({ s, gs: play(s) }));

// ---- 1. the years ---------------------------------------------------------------
console.log('\n1. The years');
check(games.flatMap(({ s, gs }) => {
  const got = rateIndicationYears(gs).map(y => y.calendarYear);
  const want = [2021, 2022, 2023, 2024, 2025, 2026, ...Array.from({ length: YEARS }, (_, i) => START + i), START + YEARS];
  return JSON.stringify(got) === JSON.stringify(want) ? [] : [`scenario ${s}: ${got.join(' ')}`];
}), 'every history year, every played year and the coming year, oldest first (the last the default)',
`${rateIndicationYears(games[0].gs).map(y => y.calendarYear).join(' ')}`);

// ---- 2 and 3. the past years ----------------------------------------------------------
function sectionBuilt(): string[] {
  const p: string[] = [];
  for (const { s, gs } of games) for (const row of gameHistory(gs)) for (const l of LINES) {
    const tag = `s${s} ${START + row.yearNumber - 1} ${l}`;
    const lr = row.byLine[l]!;
    const ri = buildRateIndication(gs, l, gs.currentDecisions, row.yearNumber);
    const b = ri?.built;
    if (!ri || !b || ri.chargedPer100 === null) { p.push(`${tag}: no build`); continue; }
    if (!near(b.ratePer100, lr.finalRatePer100!)) p.push(`${tag}: built ${b.ratePer100} vs charged ${lr.finalRatePer100}`);
    if (ri.chargedPer100 !== lr.finalRatePer100) p.push(`${tag}: the page's charged rate is not the row's`);
    if (!near(b.projectedPurePremiumPer100, lr.newPurePremiumPer100!)) p.push(`${tag}: pure premium ${b.projectedPurePremiumPer100} vs recorded ${lr.newPurePremiumPer100}`);
    for (const w of b.window) {
      if (!near(w.paid * w.ldf, w.developed)) p.push(`${tag} AY${w.accidentYear}: paid x development != developed`);
      if (!near(w.developed * w.reserveInflation / (w.exposure * 1e4), w.lossCostPer100)) p.push(`${tag} AY${w.accidentYear}: loss cost`);
      if (!near(w.lossCostPer100 * w.trendToLatest, w.trendedToLatestPer100)) p.push(`${tag} AY${w.accidentYear}: trended`);
    }
    if (b.window.length > 0) {
      if (!near(b.averageTrendedToLatestPer100! * b.trendToPriced + b.catastropheLoadPer100, b.projectedLossCostPer100)) p.push(`${tag}: average x trend + cat != loss cost`);
    } else if (!b.noHistory) p.push(`${tag}: no window and no expected-loss basis`);
    if (!near(b.projectedLossCostPer100 + b.alaePer100 + b.ulaePer100, b.projectedPurePremiumPer100)) p.push(`${tag}: loss cost + ALAE + ULAE != pure premium`);
    const pieces = b.pieces.purePremium + b.pieces.admin + b.pieces.riskControl + b.pieces.reins;
    if (!near(pieces, b.ratePer100)) p.push(`${tag}: the pieces add to ${pieces}, the rate ${b.ratePer100}`);
  }
  return p;
}
function sectionPlayed(): string[] {
  const p: string[] = [];
  for (const { s, gs } of games) for (const r of gs.lockedResults) for (const l of LINES) {
    const tag = `s${s} ${START + r.yearNumber - 1} ${l}`;
    const lr = r.byLine[l]!;
    const ri = buildRateIndication(gs, l, gs.currentDecisions, r.yearNumber)!;
    const d = lr.decisions;
    const at = d.fundingAtExpected ? ri.positions[0] : ri.positions.find(x => x.position === d.fundingConfidenceLevel);
    const layer = ri.reinsurance.find(x => x.id === d.reinsuranceOption)?.pricePer100;
    const agg = ri.aggregateCovers.find(x => x.id === (d.aggregateCover ?? 'none'))?.pricePer100;
    if (!at || layer === undefined || agg === undefined) { p.push(`${tag}: the page lacks the level or a cover bought`); continue; }
    if (!near(at.ratePer100 + layer + agg, lr.finalRatePer100!)) p.push(`${tag}: ${at.ratePer100} + ${layer} + ${agg} vs charged ${lr.finalRatePer100}`);
  }
  return p;
}

console.log('\n2. Each past year as it was built');
const n = games.reduce((t, g) => t + gameHistory(g.gs).length, 0) * LINES.length;
const noHist = games.flatMap(({ gs }) => gameHistory(gs).flatMap(r => LINES.filter(l => buildRateIndication(gs, l, gs.currentDecisions, r.yearNumber)?.built?.noHistory)
  .map(() => START + r.yearNumber - 1)));
check(sectionBuilt(), 'every history and played year, every line: the build chains to the rate charged',
  `${n} line-years; expected-loss basis in ${[...new Set(noHist)].join(', ')}`);
console.log('\n3. Each played year: indicated + the covers bought = charged');
check(sectionPlayed(), 'the level chosen + the cover + the aggregate cover = the rate charged');

console.log('\n4. The Annual Trend as a percentage');
// The page as rendered (it opens on the coming year; the trend is the line's, every year alike).
const trendCells = (gs: GameState) => {
  const html = renderToStaticMarkup(React.createElement(RateIndicationPage, { gameState: gs, decisions: gs.currentDecisions }));
  return Object.fromEntries(LINES.map(l => [l, html.match(new RegExp(`data-testid="ri-${l}-trend"[^>]*>([^<]*)<`))?.[1]?.trim()]));
};
const sectionTrend = (want: (t: number) => string) => games.flatMap(({ s, gs }) => {
  const got = trendCells(gs);
  return LINES.flatMap(l => (got[l] === want(lossCostTrendPerYear(l)) ? [] : [`s${s} ${l}: "${got[l]}", want "${want(lossCostTrendPerYear(l))}"`]));
});
const asPct = (t: number) => `${Number(((t - 1) * 100).toFixed(2))}%`;
check(sectionTrend(asPct), 'each line\'s Annual Trend reads as a percentage', LINES.map(l => `${l} ${trendCells(games[0].gs)[l]}`).join(' · '));
{
  const wrong = sectionTrend(t => String(Number(t.toFixed(4))));
  check(wrong.length > 0 ? [] : ['the page passed read as factors'], '  control: the factor form ("1.04") fails', `${wrong.length} problem(s)`);
}

const control = (label: string, section: () => string[]) => {
  const was = ADMIN_SHARE_OF_PREMIUM.WC;
  (ADMIN_SHARE_OF_PREMIUM as Record<CoverageLine, number>).WC = 0.21;
  let problems: string[];
  try { problems = section(); } finally { (ADMIN_SHARE_OF_PREMIUM as Record<CoverageLine, number>).WC = was; }
  check(problems.length > 0 ? [] : ['passed with the rebuild broken'], `  control: ${label}`, `${problems.length} problem(s) with WC's admin at 21%`);
};
control('section 2 with the rebuild off the year\'s basis', sectionBuilt);
control('section 3 with the rebuild off the year\'s basis', sectionPlayed);

console.log('\n' + '='.repeat(78));
if (failures.length) {
  console.log(`${failures.length} CHECK(S) FAILED:\n  ${failures.join('\n  ')}`);
  console.log('='.repeat(78));
  process.exit(1);
}
console.log('rate-indication-years-check: all checks passed');
console.log('='.repeat(78));
