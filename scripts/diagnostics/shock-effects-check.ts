// ============================================================================
// SHOCK EFFECTS — the wip/shocks test build's A and T draws, the event matrix,
// the T covers' recoveries and prices, the rate panel's rows, and the
// Investment Loss by asset class.
//
//   npx tsx scripts/diagnostics/shock-effects-check.ts
//
// ⚠ THE BRIEF'S TABLES ARE WRITTEN OUT HERE, NOT READ FROM pricingParameters.
// A check that read its expectation from the parameter it grades would pass
// whatever the parameter said. Each section is a function returning its
// problems; each has a CONTROL that breaks the thing it guards at runtime,
// asserts the section now FAILS, and restores it — a check that has never
// failed proves nothing (SESSION_PRACTICES.md §2).
// ============================================================================

import {
  INVESTMENT_LOSS_BY_ASSET, POOL_LIMIT_PER_OCCURRENCE, R_MODEL, SHOCK_COST_TREND, SHOCK_FREE_PRICING, T_COVER_FREQUENCY,
  SHOCK_T_CLAIM_RANGE, SOLO_SHOCKS, WORLD_COUNT,
} from '../../src/data/pricingParameters';
import { REINSURANCE_TOWER, type TowerLine } from '../../src/data/reinsuranceTower';
import {
  SHOCK_EVENTS, eventLines, firingsStartingIn, resolveShockYear, tClaimSize, aShare, applyMarketShock,
} from '../../src/utils/shockLosses';
import { cedeOccurrences } from '../../src/utils/reinsuranceTower';
import { optionPrice, placementFor, reinsuranceOptionIds } from '../../src/utils/reinsuranceOptions';
import { blendInvestmentReturn } from '../../src/utils/investmentEngine';
import { quoteNewRateStack } from '../../src/utils/linePricing';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { processYear } from '../../src/utils/simulationEngine';
import { shockRecordKeys } from '../../src/utils/shockLosses';
import { drawCatalogueSchedule, SOLO_SHOCK_STREAM } from '../../src/utils/shockSchedule';
import { seedFromInstanceId } from '../../src/seedHash';
import { exposureFactor } from '../../src/data/exposureTrend';
import type { ScheduledShock } from '../../src/types/shocks';
import type { CoverageLine, DecisionSet, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const M = 1e6;
const failures: string[] = [];
const check = (problems: string[], label: string, detail = '') => {
  if (problems.length) failures.push(label);
  console.log(`  ${problems.length ? 'FAIL' : 'OK  '}  ${label}${detail ? `  — ${detail}` : ''}`);
  for (const p of problems.slice(0, 5)) console.log(`          ${p}`);
};
/** The control: break, run the section, restore; it must fail. */
const control = (label: string, breakIt: () => () => void, section: () => string[]) => {
  const restore = breakIt();
  let problems: string[];
  try { problems = section(); } finally { restore(); }
  check(problems.length > 0 ? [] : ['the section passed with the thing it guards broken'], `  control: ${label}`,
    `${problems.length} problem(s) when broken`);
};

// ---- THE BRIEF -------------------------------------------------------------
type Lv = 'Low' | 'Mid' | 'High';
const BRIEF_A: Record<CoverageLine, Record<Lv, [number, number]>> = {
  GL: { Low: [0.05, 0.15], Mid: [0.15, 0.35], High: [0.35, 0.70] },
  WC: { Low: [0.05, 0.15], Mid: [0.15, 0.35], High: [0.35, 0.75] },
  Property: { Low: [0.10, 0.25], Mid: [0.25, 0.50], High: [0.50, 1.00] },
};
const BRIEF_T: Record<CoverageLine, Record<Lv, [number, number]>> = {
  GL: { Low: [1 * M, 3 * M], Mid: [3 * M, 7 * M], High: [7 * M, 40 * M] },
  WC: { Low: [1 * M, 3 * M], Mid: [3 * M, 6 * M], High: [6 * M, 40 * M] },
  Property: { Low: [2 * M, 5 * M], Mid: [5 * M, 12 * M], High: [12 * M, 40 * M] },
};
// Event -> line -> [A, T, R] ('-' none).
const BRIEF_MATRIX: Record<string, Partial<Record<CoverageLine, [string, string, string]>>> = {
  'Earthquake': { GL: ['Mid', '-', '-'], WC: ['High', '-', '-'], Property: ['High', 'High', '-'] },
  'Winterstorm': { Property: ['High', 'Low', '-'] },
  'Wildfire': { Property: ['Low', 'High', '-'] },
  'Legislation': { GL: ['Mid', '-', 'High'] },
  'WC Reform': { WC: ['High', '-', 'Mid'] },
  'Recession': { GL: ['Low', '-', '-'], WC: ['Low', '-', '-'] },
  'Nuclear Verdict': { GL: ['-', 'High', 'Mid'] },
  'Social Inflation': { GL: ['High', 'Low', 'Mid'] },
  'Pandemic': { GL: ['-', 'Mid', '-'], WC: ['High', 'High', '-'] },
  'Economic Inflation': {}, 'Investment Loss': {}, 'Member Withdrawal': {},
};
// ⚠ RESTATED FOR wip/reinsurance-layers: eight layers, and each price is the
// pricing workbook's method on the year's claims, not a fixed table. The
// method is written out here (t-cover-layers-check holds it in full); BRIEF_PRICE
// is its 2027 figure in dollars, and briefPriceAt the same at growth g.
const BRIEF_COVERS: [string, number, number][] = [
  ['$9M xs $1M', 1, 9], ['$19M xs $1M', 1, 19], ['$29M xs $1M', 1, 29], ['$39M xs $1M', 1, 39],
  ['$8M xs $2M', 2, 8], ['$18M xs $2M', 2, 18], ['$28M xs $2M', 2, 28], ['$38M xs $2M', 2, 38],
];
const MID: Record<CoverageLine, number[]> = { GL: [2, 5, 23.5], WC: [2, 4.5, 23], Property: [3.5, 8.5, 26] };
const FREQ = [0.075, 0.0525, 0.0225];
function briefPriceAt(l: CoverageLine, k: number, g: number): number {
  const [, att, lim] = BRIEF_COVERS[k];
  const cost = (a: number, w: number) => MID[l].reduce((s, m, i) => s + FREQ[i] * Math.min(Math.max(g * m - a, 0), w), 0) * 1e6;
  const top = att + lim;
  return top === 30 ? 1.25 * cost(att, 20 - att) : top === 40 ? 1.2 * cost(att, 30 - att) : cost(att, lim);
}
const BRIEF_PRICE: Record<CoverageLine, number[]> = Object.fromEntries((['GL', 'WC', 'Property'] as CoverageLine[])
  .map(l => [l, BRIEF_COVERS.map((_, k) => briefPriceAt(l, k, 1))])) as Record<CoverageLine, number[]>;
const TOP = BRIEF_COVERS.findIndex(c => c[0] === '$38M xs $2M');
const BRIEF_INVEST = { cash: 0, bonds: -0.05, equities: -0.20 };

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const instanceWith = (id: string, schedule: ScheduledShock[]) => generateGameInstance(id, seedFromInstanceId(id), schedule);

// ---- 1. A ------------------------------------------------------------------
function sectionA(): string[] {
  const out: string[] = [];
  for (const l of LINES) for (const lv of ['Low', 'Mid', 'High'] as Lv[]) {
    const [lo, hi] = BRIEF_A[l][lv];
    for (const u of [0, 0.25, 0.5, 0.999]) {
      if (!near(aShare(l, lv, u), lo + u * (hi - lo))) out.push(`${l} ${lv} u=${u}: A ${aShare(l, lv, u)} not uniform on [${lo}, ${hi}]`);
    }
  }
  // Through the engine: Legislation (3 years, GL A Mid, R High) in year 2 of a
  // game; its A is in year 2 only, on the whole line; its R runs on.
  const inst = instanceWith('4', [{ shockId: '#4', yearNumber: 2 }]);
  const f = firingsStartingIn(inst, 'host', 2)[0];
  const y2 = resolveShockYear(inst, 'host', 2).byLine.GL, y3 = resolveShockYear(inst, 'host', 3).byLine.GL;
  const [lo, hi] = BRIEF_A.GL.Mid;
  if (!near(y2.uplift, lo + f.draws.GL.a * (hi - lo))) out.push(`year 2 GL uplift ${y2.uplift}, expected the drawn A`);
  if (y3.uplift !== 0) out.push(`year 3 GL uplift ${y3.uplift}: A must last one year only`);
  if (!(y3.rRate > 0)) out.push('year 3 GL R is gone: R must run its duration as today');
  // A regional A is the whole line's: Winterstorm's Property A, no share.
  const w = instanceWith('4', [{ shockId: '#2', yearNumber: 2 }]);
  const fw = firingsStartingIn(w, 'host', 2)[0];
  const [plo, phi] = BRIEF_A.Property.High;
  if (!near(resolveShockYear(w, 'host', 2).byLine.Property.uplift, plo + fw.draws.Property.a * (phi - plo))) {
    out.push('Winterstorm\'s Property A is not the whole line\'s');
  }
  return out;
}

// ---- 2. T ------------------------------------------------------------------
function sectionTDraws(): string[] {
  const out: string[] = [];
  for (const l of LINES) for (const lv of ['Low', 'Mid', 'High'] as Lv[]) {
    const [lo, hi] = BRIEF_T[l][lv];
    for (const u of [0, 0.3, 0.999]) {
      if (!near(tClaimSize(l, lv, u), lo + u * (hi - lo))) out.push(`${l} ${lv}: T ${tClaimSize(l, lv, u)} not on [${lo}, ${hi}]`);
    }
  }
  // Over many seeds: each T is ONE arrival per event-line, uniform in range.
  const sums: Record<string, { n: number; s: number; lo: number; hi: number }> = {};
  for (let k = 1; k <= 400; k++) {
    const inst = instanceWith(`t${k}`, [{ shockId: '#7', yearNumber: 2 }, { shockId: '#9', yearNumber: 3 }]);
    for (const y of [2, 3]) {
      const sy = resolveShockYear(inst, 'host', y);
      for (const l of LINES) for (const a of sy.byLine[l].arrivals) {
        const key = `${a.firing.event.name}/${l}/${a.level}`;
        const r = BRIEF_T[l][a.level];
        if (a.size < r[0] || a.size > r[1]) out.push(`${key}: size ${a.size} outside the brief's range`);
        const e = (sums[key] ??= { n: 0, s: 0, lo: r[0], hi: r[1] });
        e.n++; e.s += a.size;
      }
    }
  }
  const want = ['Nuclear Verdict/GL/High', 'Pandemic/GL/Mid', 'Pandemic/WC/High'];
  for (const k of want) if (sums[k]?.n !== 400) out.push(`${k}: ${sums[k]?.n ?? 0} claims in 400 firings, expected exactly one each`);
  for (const [k, e] of Object.entries(sums)) {
    const mean = e.s / e.n, mid = (e.lo + e.hi) / 2, se = (e.hi - e.lo) / Math.sqrt(12 * e.n);
    if (Math.abs(mean - mid) > 4 * se) out.push(`${k}: mean ${(mean / M).toFixed(2)}M, uniform mean ${(mid / M).toFixed(2)}M`);
  }
  return out;
}

// ---- 3. THE MATRIX ---------------------------------------------------------
function sectionMatrix(): string[] {
  const out: string[] = [];
  const names = SHOCK_EVENTS.map(e => e.name);
  for (const n of Object.keys(BRIEF_MATRIX)) if (!names.includes(n)) out.push(`no event '${n}'`);
  for (const e of SHOCK_EVENTS) {
    const brief = BRIEF_MATRIX[e.name];
    if (!brief) { out.push(`event '${e.name}' is not in the brief`); continue; }
    const got: Record<string, string> = {};
    for (const r of eventLines(e.name)) {
      const f = (v: string) => (v === 'None' ? '-' : v);
      got[r.line] = [f(r.a), f(r.t), f(r.r)].join('/');
    }
    for (const l of LINES) {
      const want = brief[l] ? brief[l]!.join('/') : undefined;
      if (want !== got[l]) out.push(`${e.name} ${l}: ${got[l] ?? 'nothing'}, brief ${want ?? 'nothing'}`);
    }
    // And through the engine: fired in year 2 of a game, it touches exactly those.
    const inst = instanceWith('9', [{ shockId: e.id, yearNumber: 2 }]);
    const sy = resolveShockYear(inst, 'host', 2);
    for (const l of LINES) {
      const b = brief[l];
      const hasA = sy.byLine[l].uplift > 0 && e.name !== 'Economic Inflation';
      const hasT = sy.byLine[l].arrivals.length > 0;
      const hasR = sy.byLine[l].rRate > 0;
      if (hasA !== (!!b && b[0] !== '-')) out.push(`${e.name} ${l}: engine A ${hasA}`);
      if (hasT !== (!!b && b[1] !== '-')) out.push(`${e.name} ${l}: engine T ${hasT}`);
      if (hasR !== (!!b && b[2] !== '-')) out.push(`${e.name} ${l}: engine R ${hasR}`);
    }
  }
  return out;
}

// ---- 4. THE T COVERS -------------------------------------------------------
function sectionCoverTerms(): string[] {
  const out: string[] = [];
  for (const l of LINES) {
    if (POOL_LIMIT_PER_OCCURRENCE[l] !== null) out.push(`${l} still carries a pool limit`);
    const offered = reinsuranceOptionIds(l, true);
    const ids = ['none', ...BRIEF_COVERS.map(c => c[0])];
    if (offered.join('|') !== ids.join('|')) out.push(`${l} offers ${offered.join(', ')}`);
    if (reinsuranceOptionIds(l, false).join('|') !== 'none') out.push(`${l} with shocks off offers ${reinsuranceOptionIds(l, false).join(', ')}`);
    BRIEF_COVERS.forEach(([id, att, lim], k) => {
      if (!near(optionPrice(l, id), BRIEF_PRICE[l][k], 1e-12)) out.push(`${l} ${id}: price ${optionPrice(l, id)}, the method's ${BRIEF_PRICE[l][k]}`);
      const placed = placementFor(l, id);
      for (const x of [0.5, 1, 1.5, 2, 3, 9.99, 10, 12, 20, 25, 39, 40, 41, 60].map(v => v * M)) {
        const want = Math.min(Math.max(x - att * M, 0), lim * M);
        const got = cedeOccurrences(l as TowerLine, [x], placed, [0]).totalCeded;
        if (!near(got, want, 1e-9)) out.push(`${l} ${id} on a $${x / M}M claim: ceded ${got}, expected ${want}`);
      }
    });
    if (optionPrice(l, 'none') !== 0) out.push(`${l} None costs ${optionPrice(l, 'none')}`);
  }
  return out;
}

// ---- games -----------------------------------------------------------------
const settings = (id: string): GameSetupSettings =>
  ({ poolName: 'S', gameLength: 10, startingYear: 2026, instanceId: id, activeLines: LINES, shockTiming: 'solo' }) as GameSetupSettings;
function open(id: string, schedule: ScheduledShock[]): GameState {
  const setup = settings(id), instance = instanceWith(id, schedule);
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  return openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory });
}
/** Play to `years`, returning each year's per-world line results (and, on `starts`, the state each year began in). */
const starts = new WeakMap<object, GameState[]>();
function play(id: string, schedule: ScheduledShock[], years: number, edit: (d: DecisionSet) => void = () => {}) {
  let gs = open(id, schedule);
  const perYear: LineResultSet[][][] = [];
  const began: GameState[] = [];
  for (let y = 1; y <= years; y++) {
    began.push(gs);
    const d = defaultDecisionSet(y); edit(d);
    const played = playWorldsYear(gs, d);
    perYear.push(played.perWorld.map(p => p.lineResults.map(r => r.result)));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
  }
  starts.set(perYear, began);
  return perYear;
}
// THE BRIEF'S GROWTH RULE: table x (1 + trend)^(years since 2027, the game's
// year 1) x (this year's quoted exposure / year 1's).
const BRIEF_TREND: Record<CoverageLine, number> = { WC: 0.04, GL: 0.08, Property: 0.05 };
function briefFactor(gs: GameState, l: CoverageLine, y: number): number {
  const ls = gs.poolState.lines[l];
  return Math.pow(1 + BRIEF_TREND[l], y - 1) * ((ls.bookExposure ?? 0) * exposureFactor(l, y)) / (ls.shockCostBaseExposure ?? NaN);
}
const lineOf = (rows: LineResultSet[], l: CoverageLine) => rows.find(r => r.line === l)!;

function sectionCoverInGame(): string[] {
  const out: string[] = [];
  const top = '$38M xs $2M';
  // Wildfire in year 2: Property's ONE T claim, a catastrophe booked at its
  // drawn size, so the year's recovery is exactly the layer on it.
  const withCover = play('6', [{ shockId: '#3', yearNumber: 2 }], 2, d => { d.byLine.Property.reinsuranceOption = top; });
  const without = play('6', [{ shockId: '#3', yearNumber: 2 }], 2);
  const sizes = new Set<number>();
  // Year 2's factor, from the state the year began in, and the T claim's table size.
  const g = briefFactor(starts.get(withCover)![1], 'Property', 2);
  const table = resolveShockYear(starts.get(withCover)![1].instance, 'host', 2).byLine.Property.arrivals[0]?.size ?? NaN;
  if (!(g > 1)) out.push(`year 2's factor ${g} is not a growth`);
  withCover[1].forEach((rows, w) => {
    const r = lineOf(rows, 'Property');
    const t = (r.claims ?? []).filter(c => c.tier === 'shock' && c.accidentYear === 2);
    if (t.length !== 1) { out.push(`world ${w + 1}: ${t.length} T claims on Property`); return; }
    sizes.add(t[0].grossUltimate);
    if (!near(t[0].grossUltimate, table * g, 1e-9)) out.push(`world ${w + 1}: T claim ${t[0].grossUltimate}, table ${table} x factor ${g.toFixed(4)}`);
    const want = Math.min(Math.max(t[0].grossUltimate - 2 * M, 0), 38 * M);
    if (!near(r.reinsuranceRecovery, want, 1e-9)) out.push(`world ${w + 1}: recovery ${r.reinsuranceRecovery}, layer on the claim ${want}`);
    if (!near(r.reinsuranceCost, briefPriceAt('Property', TOP, g), 1e-9)) out.push(`world ${w + 1}: cost ${r.reinsuranceCost}, the method at factor ${g.toFixed(4)} ${briefPriceAt('Property', TOP, g)}`);
    // Year 1: the table price exactly — the base year.
    const y1 = lineOf(withCover[0][w], 'Property');
    if (!near(y1.reinsuranceCost, BRIEF_PRICE.Property[TOP], 1e-9)) out.push(`world ${w + 1}: year-1 cost ${y1.reinsuranceCost}, the method's 2027 ${BRIEF_PRICE.Property[TOP]}`);
    const n = lineOf(without[1][w], 'Property');
    if (n.reinsuranceRecovery !== 0 || n.reinsuranceCost !== 0) out.push(`world ${w + 1}: None recovered ${n.reinsuranceRecovery} at ${n.reinsuranceCost}`);
    // The rate panel's rule: reinsurance never lowers the pure premium; the
    // charge is the same pool premium + admin, plus the fixed price.
    if (!near(r.totalMemberCharge - r.reinsuranceCost, n.totalMemberCharge, 1e-9)) {
      out.push(`world ${w + 1}: charge less the cover ${r.totalMemberCharge - r.reinsuranceCost} vs None ${n.totalMemberCharge}`);
    }
  });
  if (sizes.size !== 1) out.push(`the T claim differs across worlds: ${sizes.size} sizes`);
  // An A-only year (Recession) never reaches the cover.
  const a = play('6', [{ shockId: '#6', yearNumber: 2 }], 2, d => { for (const l of LINES) d.byLine[l].reinsuranceOption = top; });
  for (const rows of a[1]) for (const l of LINES) {
    if (lineOf(rows, l).reinsuranceRecovery !== 0) out.push(`Recession: ${l} recovered ${lineOf(rows, l).reinsuranceRecovery}`);
  }
  return out;
}

// ---- 4c. THE RATE PANEL ---------------------------------------------------
// Pure premium = normal expected losses x CLF (never lowered by cover), admin
// (its share of the rate before reinsurance, which the cover does not move),
// risk control, reinsurance = the method's price at the trend's growth (not x CLF, not
// loaded); the four rows add to the rate exactly. (Profit & contingency was the
// fifth row until wip/pricing-rework retired it.)
function sectionRatePanel(): string[] {
  const out: string[] = [];
  for (const l of LINES) for (const clf of [1, 1.35]) {
    const exposure = 2000;
    const q = (opt: string) => quoteNewRateStack({
      line: l, yearNumber: 3, members: { exposure }, exposure, groundUpPurePremiumPer100: 2.5, clf, riskControlPct: 0,
      layersPlaced: placementFor(l, opt), aggregateStopLevel: -1, reinsuranceOption: opt, shocks: true,
    });
    const none = q('none');
    for (const [k, [id]] of BRIEF_COVERS.entries()) {
      const c = q(id);
      const rows = [c.retainedPurePremiumPer100 * c.clf, c.adminRatePer100, c.riskControlPer100, c.reinsRatePer100];
      if (!near(rows[0], 2.5 * clf, 1e-12)) out.push(`${l} ${id} CLF ${clf}: pure premium ${rows[0]}, expected x CLF ${2.5 * clf}`);
      // Admin is a share of the rate BEFORE reinsurance, so the cover must not move it.
      if (!near(c.adminRatePer100, none.adminRatePer100, 1e-12)) out.push(`${l} ${id}: the cover moved admin`);
      // Year 3 with no year-1 base on the book: the method on claims grown by the trend for two years.
      const want = briefPriceAt(l, k, Math.pow(1 + BRIEF_TREND[l], 2));
      if (!near(c.reinsuranceCost, want, 1e-9)) out.push(`${l} ${id} CLF ${clf}: reinsurance ${c.reinsuranceCost}, price ${want}`);
      const sum = rows.reduce((x, y) => x + y, 0);
      if (!near(sum, c.finalRatePer100, 1e-12)) out.push(`${l} ${id}: rows ${sum} vs rate ${c.finalRatePer100}`);
      if (!near(c.finalRatePer100 - c.reinsRatePer100, none.finalRatePer100, 1e-12)) out.push(`${l} ${id}: the rate less the cover differs from None's`);
    }
  }
  return out;
}

// ---- 5. INVESTMENT LOSS ----------------------------------------------------
function sectionInvestCalc(): string[] {
  const out: string[] = [];
  const inst = instanceWith('3', [{ shockId: '#11', yearNumber: 2 }]);
  const ms = resolveShockYear(inst, 'host', 2).marketShock;
  for (const k of ['cash', 'bonds', 'equities'] as const) {
    if (!near(ms[k], BRIEF_INVEST[k])) out.push(`${k}: ${ms[k]}, brief ${BRIEF_INVEST[k]}`);
  }
  const m = { cash: 0.03, bonds: 0.04, equities: 0.07 };
  for (const [c, b, e] of [[10, 80, 10], [10, 30, 60], [70, 30, 0], [100, 0, 0]]) {
    const d = blendInvestmentReturn(1, { cashPct: c, bondsPct: b, equitiesPct: e }, applyMarketShock(m, ms)).returnRate
      - blendInvestmentReturn(1, { cashPct: c, bondsPct: b, equitiesPct: e }, m).returnRate;
    const want = (c * BRIEF_INVEST.cash + b * BRIEF_INVEST.bonds + e * BRIEF_INVEST.equities) / 100;
    if (!near(d, want, 1e-12)) out.push(`${c}/${b}/${e}: return moves ${d}, brief ${want}`);
  }
  return out;
}
const ALLOCS: Record<string, [number, number, number]> = {
  default: [10, 80, 10], 'equity-heavy': [10, 30, 60], 'cash-heavy': [70, 30, 0], 'all cash': [100, 0, 0],
};
/** Per allocation: the year-2 investment income lost to the event, summed over lines, mean over worlds. */
function investmentLossDollars(id: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, [c, b, e]] of Object.entries(ALLOCS)) {
    // Year 2 only, so every allocation starts the year on the same assets.
    const set = (d: DecisionSet) => { if (d.yearNumber === 2) d.assetAllocation = { cashPct: c, bondsPct: b, equitiesPct: e }; };
    const hit = play(id, [{ shockId: '#11', yearNumber: 2 }], 2, set)[1];
    const calm = play(id, [], 2, set)[1];
    let s = 0;
    hit.forEach((rows, w) => { for (const l of LINES) s += lineOf(rows, l).investmentIncome - lineOf(calm[w], l).investmentIncome; });
    out[name] = s / hit.length;
  }
  return out;
}
function sectionInvestGame(): string[] {
  const out: string[] = [];
  const d = investmentLossDollars('3');
  if (Math.abs(d['all cash']) > 1e-6) out.push(`an all-cash pool lost $${d['all cash'].toFixed(2)}`);
  if (!(d['equity-heavy'] < d.default && d.default < d['cash-heavy'] && d['cash-heavy'] < 0)) {
    out.push(`not ordered by equity: ${Object.entries(d).map(([k, v]) => `${k} ${(v / M).toFixed(3)}M`).join(', ')}`);
  }
  // Each is the same assets x the blended hit: the ratio is one figure.
  const ratio = (k: string) => d[k] / ((ALLOCS[k][0] * BRIEF_INVEST.cash + ALLOCS[k][1] * BRIEF_INVEST.bonds + ALLOCS[k][2] * BRIEF_INVEST.equities) / 100);
  if (!near(ratio('default'), ratio('equity-heavy'), 1e-6) || !near(ratio('default'), ratio('cash-heavy'), 1e-6)) {
    out.push(`assets implied differ: ${['default', 'equity-heavy', 'cash-heavy'].map(k => (ratio(k) / M).toFixed(3)).join(' / ')}M`);
  }
  return out;
}

// ---- 6. SINGLE PLAYER ------------------------------------------------------
function sectionSolo(): string[] {
  const out: string[] = [];
  if (!SOLO_SHOCKS.enabled) out.push('SOLO_SHOCKS is off');
  let events = 0, yr1 = 0;
  const N = 4000;
  for (let k = 0; k < N; k++) {
    const s = drawCatalogueSchedule(`solo${k}`, 10, SOLO_SHOCK_STREAM);
    events += s.length; yr1 += s.filter(e => e.yearNumber < 2).length;
  }
  const perYear = events / (N * 9);
  if (yr1 > 0) out.push(`${yr1} events in year 1`);
  if (Math.abs(perYear - 0.3) > 0.02) out.push(`${perYear.toFixed(3)} events a year from year 2, expected about 0.3`);
  return out;
}

// ---- 7. SHOCKS NEVER REACH THE PURE PREMIUM ---------------------------------
// The same game with and without scheduled shocks — every route a shock has:
// A + R (Legislation), T + R (Nuclear Verdict), a regional A + T (Wildfire),
// Investment Loss, Economic Inflation and Member Withdrawal — must charge
// identical pure premiums, line by line, in every year (SHOCK_FREE_PRICING).
const PP_SHOCKS: ScheduledShock[] = [
  { shockId: '#4', yearNumber: 2 }, { shockId: '#7', yearNumber: 2 }, { shockId: '#3', yearNumber: 3 },
  { shockId: '#11', yearNumber: 3 }, { shockId: '#10', yearNumber: 4 }, { shockId: '#12', yearNumber: 4 },
];
const PP_YEARS = 8;
function purePremiums(schedule: ScheduledShock[]): Record<CoverageLine, number>[] {
  let gs = open('5', schedule);
  const out: Record<CoverageLine, number>[] = [];
  for (let y = 1; y <= PP_YEARS; y++) {
    const played = playWorldsYear(gs, defaultDecisionSet(y));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
    const row = gs.lockedResults[gs.lockedResults.length - 1];
    out.push(Object.fromEntries(LINES.map(l => [l, row.byLine[l].newPurePremiumPer100 ?? NaN])) as Record<CoverageLine, number>);
  }
  return out;
}
let ppPlain: Record<CoverageLine, number>[] | null = null;
function sectionPurePremium(): string[] {
  const out: string[] = [];
  ppPlain ??= purePremiums([]);
  const shocked = purePremiums(PP_SHOCKS);
  let moved = 0;
  shocked.forEach((r, i) => LINES.forEach(l => {
    if (!Number.isFinite(r[l]) || !Number.isFinite(ppPlain![i][l])) out.push(`year ${i + 1} ${l}: no pure premium on the row`);
    else if (r[l] !== ppPlain![i][l]) {
      moved++;
      if (out.length < 6) out.push(`year ${i + 1} ${l}: ${r[l].toFixed(6)} with the shocks, ${ppPlain![i][l].toFixed(6)} without (${((r[l] / ppPlain![i][l] - 1) * 100).toFixed(3)}%)`);
    }
  }));
  if (moved) out.push(`${moved} of ${PP_YEARS * 3} line-years moved`);
  return out;
}

// ---- 8. ONE RECORD PER FIRING ----------------------------------------------
// A host's Recession in years 2 AND 3: in year 3 both firings are in force, the
// year-2 one spent (A is one year), so the year-3 dollars belong to the year-3
// row alone. Keyed by event, both rows carried the year's whole uplift and the
// pool summed them twice. Each line row must cost its own firing's share of the
// year's uplift (newLossEngine.events), and each pool row the sum of its lines'.
type Rec = { shockId: string; yearFired: number; attributableGrossLoss: number };
function firingRecords(): { lines: { recs: Rec[]; uplift: number[] }[]; pool: Rec[] } {
  const setup = { poolName: 'P', gameLength: 4, startingYear: 2026, instanceId: 'FIRING', activeLines: ['WC'], shockTiming: 'host' } as GameSetupSettings;
  const instance = generateGameInstance('FIRING', seedFromInstanceId('FIRING'), [{ shockId: '#6', yearNumber: 2 }, { shockId: '#6', yearNumber: 3 }]);
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  let gs = { setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory } as GameState;
  let last!: ReturnType<typeof processYear>;
  for (let y = 1; y <= 3; y++) {
    last = processYear(gs, defaultDecisionSet(y));
    gs = { ...gs, currentYearNumber: y + 1, poolState: last.updatedPoolState, lockedResults: [...gs.lockedResults, last.result] };
  }
  const lines = Object.values(last.result.byLine).filter(Boolean).map(r => {
    const recs = (r!.shockEvents ?? []) as Rec[];
    const ev = r!.newLossEngine?.events ?? [];
    const evKeys = shockRecordKeys(ev.map(e => ({ shockId: e.id, yearFired: e.firedYear })));
    const recKeys = shockRecordKeys(recs);
    // A spent firing (its one A year past) has no entry: it adds nothing this year.
    return { recs, uplift: recKeys.map(k => ev[evKeys.indexOf(k)]?.uplift ?? 0) };
  });
  return { lines, pool: (last.result.shockEvents ?? []) as Rec[] };
}
function sectionFiringRecords(view = firingRecords()): string[] {
  const out: string[] = [];
  const firings = new Set<string>();
  for (const { recs, uplift } of view.lines) {
    const total = recs.reduce((a, r) => a + r.attributableGrossLoss, 0), u = uplift.reduce((a, b) => a + b, 0);
    if (!(total > 0) || !(u > 0)) { out.push(`no shock dollars on the line (${total}, uplift ${u}) — nothing measured`); continue; }
    recs.forEach((r, i) => {
      firings.add(`${r.shockId}@${r.yearFired}`);
      const want = total * uplift[i] / u;
      if (Math.abs(r.attributableGrossLoss - want) > 1) out.push(`line row ${r.shockId}@${r.yearFired}: $${r.attributableGrossLoss.toFixed(0)}, its firing's share is $${want.toFixed(0)}`);
    });
  }
  if (firings.size !== 2) out.push(`${firings.size} firing(s) recorded, 2 in force`);
  if (view.pool.length !== 2) out.push(`${view.pool.length} pool row(s), 2 firings in force`);
  for (const p of view.pool) {
    const want = view.lines.flatMap(l => l.recs).filter(r => r.shockId === p.shockId && r.yearFired === p.yearFired).reduce((a, r) => a + r.attributableGrossLoss, 0);
    if (Math.abs(p.attributableGrossLoss - want) > 1) out.push(`pool row ${p.shockId}@${p.yearFired}: $${p.attributableGrossLoss.toFixed(0)}, its lines sum to $${want.toFixed(0)}`);
  }
  return out;
}
/** The keying this replaced: every row of an event credited with all of it, the pool merged by event. */
function keyedByEvent(): ReturnType<typeof firingRecords> {
  const v = firingRecords();
  const lines = v.lines.map(l => {
    const byId = new Map<string, number>();
    l.recs.forEach(r => byId.set(r.shockId, (byId.get(r.shockId) ?? 0) + r.attributableGrossLoss));
    return { ...l, recs: l.recs.map(r => ({ ...r, attributableGrossLoss: byId.get(r.shockId)! })) };
  });
  const pool = new Map<string, Rec>();
  for (const r of lines.flatMap(l => l.recs)) {
    const p = pool.get(r.shockId);
    if (p) p.attributableGrossLoss += r.attributableGrossLoss; else pool.set(r.shockId, { ...r });
  }
  return { lines, pool: [...pool.values()] };
}

// ---- run -------------------------------------------------------------------
console.log(`shock-effects-check (${WORLD_COUNT} worlds)\n`);
check(sectionA(), '1. A: uniform within the brief\'s range, the firing year only, the whole line');
control('A range changed', () => { const o = R_MODEL.aShock.GL.Mid; (R_MODEL.aShock.GL as Record<string, unknown>).Mid = [0.15, 0.40]; return () => { (R_MODEL.aShock.GL as Record<string, unknown>).Mid = o; }; }, sectionA);
check(sectionTDraws(), '2. T: one claim, uniform within the brief\'s range, unscaled');
control('T High top at $15M', () => { const o = SHOCK_T_CLAIM_RANGE.GL.High; (SHOCK_T_CLAIM_RANGE.GL as Record<string, unknown>).High = [7e6, 15e6]; return () => { (SHOCK_T_CLAIM_RANGE.GL as Record<string, unknown>).High = o; }; }, sectionTDraws);
check(sectionMatrix(), '3. the event matrix, in the map and through the engine');
control('a map row changed', () => {
  const map = R_MODEL.shockMap as unknown as string[][]; const i = map.findIndex(r => r[0] === 'Wildfire'); const o = map[i];
  map[i] = ['Wildfire', 'Property', 'Low', 'Low', 'None']; return () => { map[i] = o; };
}, sectionMatrix);
check(sectionCoverTerms(), '4a. T covers: the eight offered, priced by the method, ceding min(max(x - att, 0), limit)');
control('a frequency changed', () => { const f = T_COVER_FREQUENCY as Record<string, number>; const o = f.Mid; f.Mid = 0.06; return () => { f.Mid = o; }; }, sectionCoverTerms);
control('a tower layer moved', () => { const L = REINSURANCE_TOWER.WC[1]; const o = L.attachment; L.attachment = 3e6; L.limit = 7e6; return () => { L.attachment = o; L.limit = 8e6; }; }, sectionCoverTerms);
check(sectionCoverInGame(), '4b. in a game: the T claim\'s recovery, size and price grown by the trend and book, the charge, A never ceded, one claim in every world');
control('the trend changed', () => { const t = SHOCK_COST_TREND as Record<string, number>; const o = t.Property; t.Property = 0.07; return () => { t.Property = o; }; }, sectionCoverInGame);
control('the $2M layer moved', () => { const L = REINSURANCE_TOWER.Property[1]; L.attachment = 3e6; L.limit = 7e6; return () => { L.attachment = 2e6; L.limit = 8e6; }; }, sectionCoverInGame);
check(sectionRatePanel(), '4c. rate panel: pure premium = expected x CLF whatever the cover, reinsurance = the price, rows add to the rate');
control('a frequency changed, on the panel', () => { const f = T_COVER_FREQUENCY as Record<string, number>; const o = f.Low; f.Low = 0.08; return () => { f.Low = o; }; }, sectionRatePanel);
check(sectionInvestCalc(), '5a. Investment Loss: cash 0, bonds -5, equities -20, through the blend');
control('cash hit', () => { const o = INVESTMENT_LOSS_BY_ASSET.cash; (INVESTMENT_LOSS_BY_ASSET as { cash: number }).cash = -0.02; return () => { (INVESTMENT_LOSS_BY_ASSET as { cash: number }).cash = o; }; }, sectionInvestCalc);
check(sectionInvestGame(), '5b. in a game: the loss follows the pool\'s allocation, all cash loses nothing');
control('cash hit, in a game', () => { const o = INVESTMENT_LOSS_BY_ASSET.cash; (INVESTMENT_LOSS_BY_ASSET as { cash: number }).cash = -0.02; return () => { (INVESTMENT_LOSS_BY_ASSET as { cash: number }).cash = o; }; }, sectionInvestGame);
check(sectionPurePremium(), '7. shocks never reach the pure premium: the same game with and without six shocks prices identically, every line, every year');
control('the shadow off — the deduction alone, R development left in', () => { const o = SHOCK_FREE_PRICING.enabled; SHOCK_FREE_PRICING.enabled = false; return () => { SHOCK_FREE_PRICING.enabled = o; }; }, sectionPurePremium);
check(sectionFiringRecords(), '8. one record per firing: an event fired again while in force is its own row, each costing its own share');
control('keyed by event, as before', () => () => {}, () => sectionFiringRecords(keyedByEvent()));
check(sectionSolo(), '6. single player: catalogue odds, about 0.3 a year, year 1 shock-free');

console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS');
process.exit(failures.length ? 1 : 0);
