// ============================================================================
// PROPERTY'S TWO KINDS OF COVER — THE GATE.
//
//   npx tsx scripts/diagnostics/property-cat-cover-check.ts
//
// Property buys PER-RISK cover ($20M xs $5M), applied to each claim, and
// CATASTROPHE cover ($50M xs $25M or $100M xs $25M), applied to each shock
// event's total after the per-risk recoveries. On every option pair, on drawn
// events and routine claims and in live games:
//
//   1. PER-RISK APPLIES PER CLAIM: on every unit the tower answers — a routine
//      claim, or an event of many claims — the per-risk layer recovers the sum
//      of each claim through it, never the unit's total through it.
//   2. CATASTROPHE APPLIES TO EACH EVENT'S TOTAL NET OF PER-RISK: an event's
//      catastrophe recovery is the layer on (total − per-risk recovered); a
//      routine claim alone, a single risk, recovers nothing from it.
//   3. RECOVERIES NEVER EXCEED THE LOSS: on every unit and every year.
//   4. EACH PRICE IS EXPECTED RECOVERY x THE CLF AT 70%: every per-risk and
//      catastrophe option, the catastrophe layer behind each per-risk choice,
//      and the price the engine charged; and the expected recovery is what
//      the draws recover.
//   5. REQUIRED CAPITAL IS NET OF THE COVER HELD: the engine's catastrophe
//      charge is the retained cost behind the placement the team holds, it
//      rises as cover is given up, and the opening is set on the charge net
//      of the default cover.
//
// The checks are written here from the treaty's words, not from the engine's
// cession function, so a cession that drifted from the words fails them.
//
// ⚠ AND EACH FAILS WHEN BROKEN. Every assertion is a predicate over figures;
// THE CONTROLS feed each predicate the figures a broken treaty would produce.
// ============================================================================

import { REINSURANCE_TOWER } from '../../src/data/reinsuranceTower';
import { R_MODEL, REINSURANCE_LOAD_CLF_AT_70, ROUTINE_LARGE_LOSSES } from '../../src/data/pricingParameters';
import { FORWARD_BOOKING } from '../../src/data/defaultAssumptions';
import { exposureFactor } from '../../src/data/exposureTrend';
import {
  cedeOccurrences, occurrenceDeductibles, occurrenceEventClaims, occurrenceProgramCost, occurrenceTotals,
} from '../../src/utils/reinsuranceTower';
import { cedeDevelopment } from '../../src/utils/developmentAllocation';
import { initialEstimate } from '../../src/utils/claimTriangle';
import {
  catastropheOptionsFor, defaultCatastropheOption, defaultReinsuranceOption, placementFor, reinsuranceOptionsFor,
} from '../../src/utils/reinsuranceOptions';
import { conditionalEventTiers, newEngineCatCapital, newEngineLayerMoments } from '../../src/utils/shockExpectation';
import { SHOCK_EVENTS, drawLargeLosses, resolveShockYear, type LineShockYear, type TArrival } from '../../src/utils/shockLosses';
import { openingCatCapital } from '../../src/utils/openingReserves';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SeededRandom } from '../../src/utils/random';
import type { Claim, DecisionSet, GameState, Occurrence, ResultSet } from '../../src/types/simulation';

const LAYERS = REINSURANCE_TOWER.Property;
const PR = LAYERS.map((l, i) => ({ l, i })).filter(x => x.l.basis === 'claim');
const CAT = LAYERS.map((l, i) => ({ l, i })).filter(x => x.l.basis === 'event');
const DOLLAR = 1;
const Z = 4;
const failed: string[] = [];
const RULE = '='.repeat(76);
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failed.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const M = (x: number) => `$${(x / 1e6).toFixed(2)}M`;
const through = (x: number, a: number, lim: number) => Math.max(0, Math.min(x - a, lim));

// Every option pair the panel offers.
const PAIRS = reinsuranceOptionsFor('Property').flatMap(p =>
  catastropheOptionsFor('Property').map(c => ({ p: p.id, c: c.id, placed: placementFor('Property', p.id, c.id) })));

// ---------------------------------------------------------------- the units
/** One unit the tower answered: its claims (one for a routine claim), whether it is an event, and what each layer recovered. */
interface Unit { claims: number[]; event: boolean; placed: boolean[]; ceded: number[]; label: string }

// ---------------------------------------------------------------- predicates
// ⚠ WITHIN A DOLLAR A CLAIM, not a dollar a unit: an event's claims are kept
// in whole dollars for its development (occurrenceEventClaims) and scaled to
// the event's total, so each claim may sit a fraction of a dollar from its
// draw. Every control below misses by millions.
/** 1. Worst miss, per claim, of the per-risk recovery from the sum of each claim through the layer. */
function perRiskMiss(units: Unit[]): number {
  let worst = 0;
  for (const u of units) for (const { l, i } of PR) {
    const want = u.placed[i] ? u.claims.reduce((s, c) => s + through(c, l.attachment, l.limit), 0) : 0;
    worst = Math.max(worst, Math.abs(u.ceded[i] - want) / u.claims.length);
  }
  return worst;
}
/** 2. Worst miss of each catastrophe layer from the layer on the event's total net of per-risk; zero on a single claim. */
function catMiss(units: Unit[]): number {
  let worst = 0;
  for (const u of units) {
    const total = u.claims.reduce((a, b) => a + b, 0);
    const perRisk = PR.reduce((s, { i }) => s + (u.placed[i] ? u.ceded[i] : 0), 0);
    for (const { l, i } of CAT) {
      const want = u.placed[i] && u.event ? through(total - perRisk, l.attachment, l.limit) : 0;
      worst = Math.max(worst, Math.abs(u.ceded[i] - want));
    }
  }
  return worst;
}
/** 3. Worst excess of a unit's recoveries over its loss (positive is a breach). */
function overRecovery(units: Unit[]): number {
  let worst = -Infinity;
  for (const u of units) {
    const total = u.claims.reduce((a, b) => a + b, 0);
    worst = Math.max(worst, u.ceded.reduce((a, b) => a + b, 0) - total);
  }
  return worst;
}

// ---------------------------------------------------------------- 1-3: drawn units
console.log(RULE);
console.log("PROPERTY'S TWO KINDS OF COVER — per-risk on each claim, catastrophe on each event's remainder");
console.log(RULE);

// A Property book of the market's size at the opening, read off a game.
const probeId = 'PCC-BOOK';
const probe = generateGameInstance(probeId, 4242);
const probeSetup = { poolName: 'G', gameLength: 10, startingYear: 2026, instanceId: probeId, activeLines: ['Property'] };
const opening = runPriorHistory(probe, probeSetup as never).poolState;
const EXPOSURE = (opening.lines.Property.bookExposure ?? 0) * exposureFactor('Property', 1);
const YEAR = 1;
console.log(`  book: ${EXPOSURE.toFixed(0)} of Property exposure at year ${YEAR}`);

// An event arriving: the year's shocks with only this event in it, its T
// pinned at the fraction u of its range and its region chosen, so a sweep of
// u covers the event's whole range.
const pinned = (a: TArrival, u: number, region: 'North' | 'Central' | 'South'): TArrival => {
  const [lo, hi] = R_MODEL.tShock.Property[a.level as Exclude<typeof a.level, 'None'>];
  return { ...a, tModel: lo + u * (hi - lo), firing: { ...a.firing, region } };
};
const eventYear = (name: string, tag: string): LineShockYear => {
  const e = SHOCK_EVENTS.find(x => x.name === name)!;
  const inst = generateGameInstance(`PCC-${tag}-${name}`, 99, [{ shockId: e.id, yearNumber: YEAR }]);
  return resolveShockYear(inst, 'host', YEAR).byLine.Property;
};
function arrival(name: string, u: number, region: 'North' | 'Central' | 'South'): LineShockYear {
  const year = eventYear(name, 'SWEEP');
  return { ...year, arrivals: year.arrivals.map(a => pinned(a, u, region)) };
}

/** The units of one draw, ceded on `placed` through the engine's own cession. */
function unitsOf(claims: Claim[], occs: Occurrence[], placed: boolean[], label: string): Unit[] {
  const byId = new Map(claims.map(c => [c.id, c]));
  const out: Unit[] = [];
  occs.forEach((o, j) => {
    const one = cedeOccurrences(
      'Property', [occurrenceTotals(claims, [o])[0]], placed, occurrenceDeductibles('Property', [o]),
      [occurrenceEventClaims('Property', claims, occs)[j]],
    );
    out.push({ claims: o.claimIds.map(id => byId.get(id)!.grossUltimate), event: o.isCatastrophe, placed, ceded: one.cededByLayer, label: `${label} ${o.id}` });
  });
  return out;
}

const drawn: Unit[] = [];
const EVENTS = ['Earthquake', 'Winterstorm', 'Wildfire'];
for (const name of EVENTS) {
  for (let i = 0; i < 60; i++) {
    const shocks = arrival(name, (i + 0.5) / 60, (['North', 'Central', 'South'] as const)[i % 3]);
    const d = drawLargeLosses('Property', null, YEAR, 2026, 5_000_000 + i * 7919, shocks, EXPOSURE);
    for (const pair of PAIRS) drawn.push(...unitsOf(d.claims, d.occurrences, pair.placed, `${name} ${pair.p}+${pair.c}`));
  }
}
ROUTINE_LARGE_LOSSES.enabled = true;
for (let i = 0; i < 40; i++) {
  const d = drawLargeLosses('Property', null, YEAR, 2026, 6_000_000 + i * 104_729, { arrivals: [], uplift: 0, rRate: 0, byFiring: [] } as never, EXPOSURE);
  for (const pair of PAIRS) drawn.push(...unitsOf(d.claims, d.occurrences, pair.placed, `routine ${pair.p}+${pair.c}`));
}
const events = drawn.filter(u => u.event), singles = drawn.filter(u => !u.event);
console.log(`  drawn: ${events.length / PAIRS.length} events and ${singles.length / PAIRS.length} routine claims, each on ${PAIRS.length} option pairs`);
check(events.length > 0 && singles.length > 0 && events.some(u => u.claims.length > 1), 'the draws hold events of many claims and routine single claims');

function gradeUnits(units: Unit[], tag: string) {
  check(perRiskMiss(units) <= DOLLAR, `${tag}1. per-risk applies to EACH CLAIM`, `worst $${perRiskMiss(units).toFixed(3)} a claim from the sum of each claim through $20M xs $5M`);
  check(catMiss(units) <= DOLLAR, `${tag}2. catastrophe applies to each EVENT's total net of per-risk, never to a single claim`, `worst $${catMiss(units).toFixed(3)}`);
  check(overRecovery(units) <= DOLLAR, `${tag}3. recoveries never exceed the loss`, `largest recovery less loss ${M(overRecovery(units))}`);
}
console.log('\n--- 1-3. EVERY OPTION PAIR, ON DRAWN EVENTS AND ROUTINE CLAIMS ---');
gradeUnits(drawn, '');
{
  // How each kind pays on the default pair, for the record.
  const def = placementFor('Property', defaultReinsuranceOption('Property'), defaultCatastropheOption('Property'));
  const on = events.filter(u => u.placed.join() === def.join());
  const sum = (k: number[]) => on.reduce((s, u) => s + k.reduce((a, i) => a + u.ceded[i], 0), 0);
  const gross = on.reduce((s, u) => s + u.claims.reduce((a, b) => a + b, 0), 0);
  console.log(`        default pair on ${on.length} events: per-risk ${M(sum(PR.map(x => x.i)) / on.length)}, catastrophe `
    + `${M(sum(CAT.map(x => x.i)) / on.length)}, pool keeps ${M((gross - sum(LAYERS.map((_l, i) => i))) / on.length)} of ${M(gross / on.length)} a event`);
  const routineCat = singles.reduce((s, u) => s + CAT.reduce((a, { i }) => a + u.ceded[i], 0), 0);
  check(routineCat === 0 && singles.some(u => u.claims[0] > 25e6 + 25e6),
    'a routine claim — one risk — reaches no catastrophe layer, even one larger than the catastrophe attachment',
    `largest routine claim ${M(Math.max(...singles.map(u => u.claims[0])))}, catastrophe recovered ${M(routineCat)}`);
}

// Development cedes an event's movement on the same terms: per-risk on each
// claim moved in proportion, catastrophe on what is left.
{
  const sample = events.filter(u => u.claims.length > 1).slice(0, 30);
  let worst = 0;
  for (const u of sample) {
    const total = u.claims.reduce((a, b) => a + b, 0);
    for (const f of [0.8, 1.15]) {
      const record = { claimId: 'c', occurrenceId: 'o', reported: total, original: total, current: total, developing: false, catastrophe: true as const, eventClaims: u.claims.map(Math.round) };
      const got = cedeDevelopment('Property', [record], [total * (f - 1)], 0, u.placed).ceded;
      const at = (s: number): number => {
        const cl = u.claims.map(c => c * s);
        const pr = PR.reduce((a, { l, i }) => a + (u.placed[i] ? cl.reduce((t, c) => t + through(c, l.attachment, l.limit), 0) : 0), 0);
        return pr + CAT.reduce((a, { l, i }) => a + (u.placed[i] ? through(total * s - pr, l.attachment, l.limit) : 0), 0);
      };
      worst = Math.max(worst, Math.abs(got - (at(f) - at(1))));
    }
  }
  check(worst <= DOLLAR, 'and development cedes an event\'s movement on the same terms', `worst ${M(worst)} over ${sample.length} events moved -20% and +15%`);
}

// ---------------------------------------------------------------- 4. prices
console.log('\n--- 4. EACH PRICE IS EXPECTED RECOVERY x THE CLF AT 70% ---');
const CLF = REINSURANCE_LOAD_CLF_AT_70.Property;
const book = { exposure: EXPOSURE };
/** Worst relative miss of a program's price from CLF x the expected recovery of the layers it places. */
function priceMiss(price: (placed: boolean[]) => number): { worst: number; rows: string[] } {
  let worst = 0;
  const rows: string[] = [];
  for (const pair of PAIRS) {
    const moments = newEngineLayerMoments('Property', EXPOSURE, YEAR, 1, true, pair.placed);
    const expected = LAYERS.reduce((s, _l, i) => s + (pair.placed[i] ? moments[i].expected : 0), 0);
    const p = price(pair.placed);
    worst = Math.max(worst, expected > 0 ? Math.abs(p / (expected * CLF) - 1) : Math.abs(p));
    rows.push(`        ${(pair.p + ' + ' + pair.c).padEnd(30)} price ${M(p)}  expected recovery ${M(expected)}`);
  }
  return { worst, rows };
}
{
  const r = priceMiss(placed => occurrenceProgramCost('Property', placed, book, YEAR).premium);
  for (const row of r.rows) console.log(row);
  check(r.worst < 1e-12, 'every option pair is priced at its expected recovery x the CLF at 70%', `worst ${r.worst.toExponential(2)}, CLF ${CLF}`);
}
// The catastrophe layer behind per-risk sees less than behind nothing, so it
// must cost less there: the price depends on what is in front of it.
{
  const cat100 = CAT.map(x => x.i);
  const behind = newEngineLayerMoments('Property', EXPOSURE, YEAR, 1, true, placementFor('Property', '$20M xs $5M', '$100M xs $25M'));
  const alone = newEngineLayerMoments('Property', EXPOSURE, YEAR, 1, true, placementFor('Property', 'none', '$100M xs $25M'));
  const b = cat100.reduce((s, i) => s + behind[i].expected, 0), a = cat100.reduce((s, i) => s + alone[i].expected, 0);
  check(b < a && b > 0, 'the catastrophe layer is priced behind the per-risk cover in front of it', `$100M xs $25M expects ${M(b)} behind per-risk, ${M(a)} alone`);
}
// The expected recovery is what the draws recover: each event's mean
// recovery, layer by layer, on every pair, against the event's expectation.
{
  let worst = 0, at = '';
  const MC = 1500;
  // The event alone: routine claims are their own units and priced apart.
  ROUTINE_LARGE_LOSSES.enabled = false;
  for (const name of EVENTS) {
    const base = eventYear(name, 'MC');
    const rng = new SeededRandom(31_337 + name.length);
    const samples = PAIRS.map(() => LAYERS.map(() => [] as number[]));
    for (let i = 0; i < MC; i++) {
      const u = rng.next();
      const shocks: LineShockYear = { ...base, arrivals: base.arrivals.map(a => pinned(a, u, (['North', 'Central', 'South'] as const)[i % 3])) };
      const d = drawLargeLosses('Property', null, YEAR, 2026, 8_000_000 + i * 31, shocks, EXPOSURE);
      PAIRS.forEach((pair, k) => {
        const c = cedeOccurrences('Property', occurrenceTotals(d.claims, d.occurrences), pair.placed, undefined, occurrenceEventClaims('Property', d.claims, d.occurrences)).cededByLayer;
        c.forEach((v, li) => samples[k][li].push(v));
      });
    }
    PAIRS.forEach((pair, k) => {
      const tiers = conditionalEventTiers('Property', name, EXPOSURE, YEAR,
        PR.map(x => x.l), PR.map(x => pair.placed[x.i]), CAT.map(x => x.l), CAT.map(x => pair.placed[x.i]))!;
      LAYERS.forEach((l, li) => {
        if (!pair.placed[li]) return;
        const xs = samples[k][li];
        const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
        const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
        const want = l.basis === 'claim' ? tiers.perRisk[PR.findIndex(x => x.i === li)].c1 : tiers.cat[CAT.findIndex(x => x.i === li)].c1;
        // A layer every draw left alike — always exhausted, or never reached —
        // shows no spread to test against. Then the two must agree to within
        // what ONE draw could move the mean (shock-loss-check's rule), or, on
        // an exhausted catastrophe layer, the 0.2% the fitted lognormal may
        // leave it short (see shock-loss-check).
        const allowed = Math.max(l.limit / MC, 0.002 * mean);
        const z = sd > 1e-9 * Math.max(1, mean) ? (mean - want) / (sd / Math.sqrt(xs.length)) : (Math.abs(mean - want) <= allowed ? 0 : Infinity);
        if (process.env.PCC_VERBOSE) console.log(`        ${`${name} ${pair.p}+${pair.c} ${l.name}`.padEnd(56)} drawn ${M(mean)} expected ${M(want)} (${z.toFixed(2)} SE)`);
        if (Math.abs(z) > Math.abs(worst)) { worst = z; at = `${name} ${pair.p}+${pair.c} ${l.name}`; }
      });
    });
  }
  ROUTINE_LARGE_LOSSES.enabled = true;
  check(Math.abs(worst) < Z, 'the expected recovery IS what the draws recover, every event, every pair, layer by layer', `worst ${at} at ${worst.toFixed(2)} SE`);
}

// ---------------------------------------------------------------- 5. capital
console.log('\n--- 5. REQUIRED CAPITAL IS NET OF THE COVER HELD ---');
/** True when the charge rises as cover is given up: fewer layers placed, never a smaller charge. */
function risesAsCoverFalls(charge: (placed: boolean[]) => number): boolean {
  for (const a of PAIRS) for (const b of PAIRS) {
    const subset = a.placed.every((on, i) => !on || b.placed[i]);
    if (subset && a !== b && !(charge(a.placed) > charge(b.placed))) return false;
  }
  return true;
}
const charge = (placed: boolean[]) => newEngineCatCapital('Property', EXPOSURE, YEAR, placed);
for (const pair of PAIRS) console.log(`        ${(pair.p + ' + ' + pair.c).padEnd(30)} catastrophe charge ${M(charge(pair.placed))}`);
check(risesAsCoverFalls(charge), 'the catastrophe charge rises as cover is given up, on every pair');
const defaultPlaced = placementFor('Property', defaultReinsuranceOption('Property'), defaultCatastropheOption('Property'));
const openingMiss = Math.abs(openingCatCapital('Property', { exposure: (opening.lines.Property.bookExposure ?? 0) * exposureFactor('Property', 1) }) - charge(defaultPlaced));
check(openingMiss < 1e-6, 'the opening is set on the charge net of the default cover', `miss ${openingMiss.toExponential(2)}`);

// ---------------------------------------------------------------- live games
console.log('\n--- LIVE GAMES: every Property year, on four option pairs, events scheduled ---');
const LIVE_PAIRS = [
  { p: '$20M xs $5M', c: '$100M xs $25M' },
  { p: '$20M xs $5M', c: 'none' },
  { p: 'none', c: '$50M xs $25M' },
  { p: 'none', c: 'none' },
];
const SCHEDULE = [{ shockId: '#1', yearNumber: 2 }, { shockId: '#3', yearNumber: 3 }, { shockId: '#2', yearNumber: 5 }, { shockId: '#3', yearNumber: 7 }];
interface Year { r: ResultSet; exposure: number; placed: boolean[]; y: number }
const live: Unit[] = [];
const years: Year[] = [];
for (const [g, pair] of LIVE_PAIRS.entries()) {
  for (const seed of [1, 2]) {
    const id = `PCC-LIVE-${g}-${seed}`;
    const instance = generateGameInstance(id, 1000 * g + seed, SCHEDULE);
    const setup = { poolName: 'G', gameLength: 8, startingYear: 2026, instanceId: id, activeLines: ['Property'], shockTiming: 'host' };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    const decide = (y: number): DecisionSet => {
      const d = defaultDecisionSet(y);
      return { ...d, byLine: { ...d.byLine, Property: { ...d.byLine.Property, reinsuranceOption: pair.p, catastropheOption: pair.c } } };
    };
    let gs: GameState = { setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: decide(1), priorHistory };
    for (let y = 1; y <= 8; y++) {
      const exposure = (gs.poolState.lines.Property.bookExposure ?? 0) * exposureFactor('Property', y);
      const p = processYear(gs, decide(y));
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
      const lr = p.result.byLine.Property;
      const placed = placementFor('Property', pair.p, pair.c);
      years.push({ r: p.result, exposure, placed, y });
      // The units as the tower met them at inception: an event at its drawn
      // total, a single claim at its booked value (FORWARD_BOOKING).
      const claims = lr.claims ?? [], occs = lr.occurrences ?? [];
      const byId = new Map(claims.map(c => [c.id, c]));
      const yearUnits: Unit[] = [];
      for (const o of occs) {
        const raw = o.claimIds.map(id => byId.get(id)?.grossUltimate ?? 0);
        const booked = o.isCatastrophe || !FORWARD_BOOKING.enabled ? raw : raw.map(x => initialEstimate('Property', x));
        yearUnits.push({ claims: booked, event: o.isCatastrophe, placed, ceded: [], label: `${id} y${y} ${o.id}` });
      }
      // The year's cession by layer is the engine's; the units' own split is
      // the treaty's words. Compare the year's totals layer by layer.
      const want = LAYERS.map(() => 0);
      for (const u of yearUnits) {
        const perRisk = PR.map(({ l, i }) => (placed[i] ? u.claims.reduce((s, c) => s + through(c, l.attachment, l.limit), 0) : 0));
        PR.forEach(({ i }, k) => { want[i] += perRisk[k]; });
        const total = u.claims.reduce((a, b) => a + b, 0), pr = perRisk.reduce((a, b) => a + b, 0);
        CAT.forEach(({ l, i }) => { if (placed[i] && u.event) want[i] += through(total - pr, l.attachment, l.limit); });
      }
      const nClaims = yearUnits.reduce((s, u) => s + u.claims.length, 0);
      live.push({ claims: [yearUnits.reduce((s, u) => s + u.claims.reduce((a, b) => a + b, 0), 0)], event: false, placed, ceded: lr.cededByLayer, label: `${id} y${y}` });
      Object.assign(live.at(-1)!, { want, nClaims });
    }
  }
}
const liveEvents = years.filter(x => (x.r.byLine.Property.occurrences ?? []).some(o => o.isCatastrophe)).length;
console.log(`  ${years.length} Property years, ${liveEvents} with an event`);
{
  let worst = 0, at = '';
  for (const u of live as (Unit & { want: number[]; nClaims: number })[]) {
    // Within a dollar a claim — see perRiskMiss.
    u.ceded.forEach((v, i) => { const m = Math.abs(v - u.want[i]) / Math.max(1, u.nClaims); if (m > worst) { worst = m; at = u.label; } });
  }
  check(worst <= DOLLAR && liveEvents > 0, 'live: each year\'s recovery, layer by layer, IS per-risk on each claim and catastrophe on each event\'s remainder',
    `worst $${worst.toFixed(3)} a claim${at ? ` (${at})` : ''}`);
  check(overRecovery(live) <= DOLLAR, 'live: a year\'s recoveries never exceed its large losses', `largest recovery less loss ${M(overRecovery(live))}`);
}
{
  let worstPrice = 0, worstCharge = 0;
  for (const { r, exposure, placed, y } of years) {
    const lr = r.byLine.Property;
    void lr.activeExposure;
    // The engine quotes the tower on the book as it stood before the year's
    // movement when the book did not move — the case on every year here.
    const quoted = occurrenceProgramCost('Property', placed, { exposure }, y).premium;
    worstPrice = Math.max(worstPrice, Math.abs(lr.reinsuranceCost - quoted) / Math.max(1, quoted));
    worstCharge = Math.max(worstCharge, Math.abs(lr.catCapitalNeeded - newEngineCatCapital('Property', exposure, y, placed)));
  }
  check(worstPrice < 1e-9, 'live: the engine charges each year the quoted price of the pair held', `worst ${worstPrice.toExponential(2)}`);
  check(worstCharge < 1e-3, 'live: the engine\'s catastrophe charge is the one behind the pair held', `worst ${M(worstCharge)}`);
  const byPair = LIVE_PAIRS.map(pair => {
    const ys = years.filter(x => x.placed.join() === placementFor('Property', pair.p, pair.c).join() && x.y === 1);
    return ys.reduce((s, x) => s + x.r.byLine.Property.catCapitalNeeded, 0) / ys.length;
  });
  console.log(`        year-1 catastrophe charge: ${LIVE_PAIRS.map((p, i) => `${p.p}+${p.c} ${M(byPair[i])}`).join(' · ')}`);
}

// ---------------------------------------------------------------- controls
console.log('\nCONTROLS — each must FAIL');
const controlFails = (name: string, run: () => void, expect: string) => {
  const before = failed.length;
  const saved = console.log; console.log = () => {};
  run();
  console.log = saved;
  const caught = failed.splice(before).filter(f => f.startsWith(expect));
  check(caught.length > 0, `control: ${name} is caught by ${expect}`);
};
// The old per-occurrence treaty: per-risk on the event's total.
controlFails('per-risk on the event total (one occurrence)', () => gradeUnits(drawn.map(u => {
  const total = u.claims.reduce((a, b) => a + b, 0);
  const ceded = [...u.ceded];
  for (const { l, i } of PR) ceded[i] = u.placed[i] ? through(total, l.attachment, l.limit) : 0;
  return { ...u, ceded };
}), ''), '1.');
// Catastrophe on the gross event, ignoring what per-risk took first.
controlFails('catastrophe on the event\'s gross total', () => gradeUnits(drawn.map(u => {
  const total = u.claims.reduce((a, b) => a + b, 0);
  const ceded = [...u.ceded];
  for (const { l, i } of CAT) ceded[i] = u.placed[i] && u.event ? through(total, l.attachment, l.limit) : 0;
  return { ...u, ceded };
}), ''), '2.');
// Catastrophe on a routine claim, as if one risk were an event.
controlFails('catastrophe on a routine claim', () => gradeUnits(drawn.map(u => {
  if (u.event) return u;
  const ceded = [...u.ceded];
  for (const { l, i } of CAT) ceded[i] = u.placed[i] ? through(u.claims[0], l.attachment, l.limit) : 0;
  return { ...u, ceded };
}), ''), '2.');
// Both kinds on the gross: they can recover more than the loss.
controlFails('both kinds on the gross event', () => gradeUnits(drawn.map(u => {
  const total = u.claims.reduce((a, b) => a + b, 0);
  const ceded = [...u.ceded];
  for (const { l, i } of CAT) ceded[i] = u.placed[i] && u.event ? through(total, l.attachment, l.limit) : 0;
  return { ...u, ceded };
}), ''), '3.');
controlFails('a price at the expected recovery, unloaded', () => {
  const r = priceMiss(placed => occurrenceProgramCost('Property', placed, book, YEAR).premium / CLF);
  check(r.worst < 1e-12, '4. every option pair is priced at its expected recovery x the CLF at 70%');
}, '4.');
controlFails('a charge gross of the cover held', () => {
  check(risesAsCoverFalls(() => charge(LAYERS.map(() => false))), '5. the catastrophe charge rises as cover is given up');
}, '5.');

console.log('');
if (failed.length) {
  console.log(`FAIL — ${failed.length}: ${failed.join('; ')}`);
  process.exit(1);
}
console.log("PASS — per-risk on each claim, catastrophe on each event's remainder, never more than the loss, priced at expected recovery x CLF 70%, and capital net of the cover held.");
