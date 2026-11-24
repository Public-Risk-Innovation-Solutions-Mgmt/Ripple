// ============================================================================
// THE PRICE OF COVER, x 2 IN EVERY YEAR (wip/cover-price-double) — the gate.
//
//   npx tsx scripts/diagnostics/cover-price-factor-check.ts
//
// COVER_PRICE_FACTOR (pricingParameters) multiplies every cover's price — the
// per-occurrence layers (tCoverPrice, the base table) and the aggregate covers
// (expected recovery x load) — by 2.0 in every year: the played years and the
// prior board's history (yearNumber <= 0) alike. Recoveries, attachments and
// limits are untouched: only what a team (or the prior board) pays and is shown.
//
// (Restated 2026-11-24, wip/cover-price-double, pre-game too: the factor was
// 2 in played years and 1 in the pre-game; it is now 2 in both, so the
// pre-game years below are held at 2 x, the opening moves — surplus down by
// the history's extra cover cost, the year-1 premium at Expected unmoved — and
// the old rule, played years only, is a control that must fail.)
//
//   1. PER-OCCURRENCE: every option on every line (REINSURANCE_OPTIONS, None
//      included) costs exactly 2 x tCoverPrice in played years 1-10 at several
//      growth factors, through optionPrice AND placementPrice — the placement
//      built here from the option's own layers (and equal to placementFor's) —
//      and exactly 2 x tCoverPrice in pre-game years 0, -1 and -5 too.
//   2. AGGREGATE: every option on every line (AGGREGATE_COVER_OPTIONS): in every
//      year, price = 2 x expectedRecovery x load, with expectedRecovery,
//      attachment and limit bit-identical to the same call with the factor at 1,
//      and — per unit of expected normal losses, which is what the year moves —
//      identical to the same call in pre-game year 0 at the same exposure and
//      basis, the price per unit the same as year 0's (both 2 x). In years 0,
//      -1 and -5, price = 2 x expectedRecovery x load too.
//   3. A PLAYED SOLO GAME (scenario 13 of five years: T claims on GL and
//      Property in year 2;
//      all three lines, a per-occurrence cover and an aggregate cover bought on
//      each, three years, every world), against the same game with
//      COVER_PRICE_FACTOR.factor = 1 at runtime:
//        - each world-line-year's charged reinsuranceCost is exactly 2 x the
//          factor-1 run's (the base prices the engine used), and so is its
//          aggregate cover's price; the price is 2 x the record's expected
//          recovery x load;
//        - the recoveries (per-occurrence, aggregate cover, aggregate stop) and
//          gross losses are identical, and some are non-zero;
//        - the opening: each pre-game year's reinsuranceCost is exactly 2 x the
//          factor-1 run's (every line-year with cover; none without), its
//          recoveries, gross losses and exposure identical to it; the opening
//          surplus is LOWER than the factor-1 run's on every line (the history
//          paid more for cover), and the year-1 premium at Expected
//          (openingYear1Premium) is identical.
//
// ⚠ THE FACTOR IS WRITTEN OUT HERE (CP_FACTOR = 2.0), not read from
// COVER_PRICE_FACTOR, so a changed factor fails rather than moving the
// expectation with it. CONTROLS: COVER_PRICE_FACTOR.factor = 1 at runtime must
// fail 1, 2 and 3 (3a replays its game; 3b holds the factor-1 run against
// itself), then is restored; the factor in played years only — the pre-game at
// the table's price, as before (wip/cover-price-double before the pre-game
// change): the gate's own expectation at 1 x in years <= 0 — must fail 1, 2
// and 3's opening; and a recovery doubled with the price must fail 3a.
// ============================================================================

import {
  AGGREGATE_COVER_OPTIONS, COVER_PRICE_FACTOR, REINSURANCE_OPTIONS, WORLD_COUNT,
} from '../../src/data/pricingParameters';
import { REINSURANCE_TOWER, type TowerLine } from '../../src/data/reinsuranceTower';
import { optionPrice, placementFor, placementPrice, tCoverPrice } from '../../src/utils/reinsuranceOptions';
import { aggregateCoverQuote } from '../../src/utils/aggregateCover';
import { openSoloInstance } from '../../src/utils/soloGame';
import { openingYear1Premium, runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { gameShocksOn } from '../../src/utils/shockLosses';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import type { CoverageLine, GameSetupSettings, GameState, LineResultSet, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
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
const near = (a: number, b: number, rel = 1e-12) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

// ---- THE FACTOR, WRITTEN OUT -------------------------------------------------
const CP_FACTOR = 2.0;
/** The gate's expectation: x 2 in every year, the prior board's history included. */
const PAID = { factorFor: ((() => CP_FACTOR) as (y: number) => number) };
const PLAYED = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const PRE_GAME = [0, -1, -5];
const GROWTH = [1, 1.04, 1.37, 2.2];
const factorOne = () => { const o = COVER_PRICE_FACTOR.factor; COVER_PRICE_FACTOR.factor = 1; return () => { COVER_PRICE_FACTOR.factor = o; }; };
/** The control: the old rule — x 2 in played years only, the pre-game at the table's price. */
const playedOnly = () => { const o = PAID.factorFor; PAID.factorFor = (y: number) => (y >= 1 ? CP_FACTOR : 1); return () => { PAID.factorFor = o; }; };

// ---- 1. PER-OCCURRENCE ----------------------------------------------------------
/** The option's placement from its own layers: each tower layer wholly inside [attachment, attachment + limit]. */
const layersOf = (l: CoverageLine, att: number, lim: number) =>
  REINSURANCE_TOWER[l as TowerLine].map(x => lim > 0 && x.attachment >= att && x.attachment + x.limit <= att + lim);
function sectionOccurrence(): string[] {
  const out: string[] = [];
  let priced = 0;
  for (const l of LINES) {
    const ids = REINSURANCE_OPTIONS[l].map(o => o.id);
    if (!ids.includes('none') || ids.length !== 9) out.push(`${l}: options ${ids.join(', ')} — not None and the eight`);
    for (const o of REINSURANCE_OPTIONS[l]) {
      const placed = layersOf(l, o.attachment, o.limit);
      if (placed.join() !== placementFor(l, o.id).join()) out.push(`${l} ${o.id}: its layers ${placed.map(Number).join('')}, placementFor ${placementFor(l, o.id).map(Number).join('')}`);
      for (const y of [...PLAYED, ...PRE_GAME]) for (const g of GROWTH) {
        const base = tCoverPrice(l, o.id, g), want = PAID.factorFor(y) * base;
        const shown = optionPrice(l, o.id, g, y), charged = placementPrice(l as TowerLine, placed, g, y);
        if (shown !== want) out.push(`${l} ${o.id} year ${y} growth ${g}: optionPrice ${shown}, ${PAID.factorFor(y)} x tCoverPrice ${base} = ${want}`);
        if (charged !== want) out.push(`${l} ${o.id} year ${y} growth ${g}: placementPrice ${charged}, ${PAID.factorFor(y)} x tCoverPrice ${base} = ${want}`);
        if (o.id !== 'none' && !(base > 0)) out.push(`${l} ${o.id}: tCoverPrice ${base} — nothing measured`);
        priced++;
      }
    }
  }
  if (priced === 0) out.push('nothing priced');
  return out;
}

// ---- 2. AGGREGATE ---------------------------------------------------------------
const EXPOSURES = [400, 900, 2500];
type Quote = ReturnType<typeof aggregateCoverQuote>;
const quoteAtFactorOne = (l: CoverageLine, id: string, e: number, y: number): Quote => {
  const restore = factorOne();
  try { return aggregateCoverQuote(l, id, e, y); } finally { restore(); }
};
function sectionAggregate(): string[] {
  const out: string[] = [];
  let paying = 0;
  if (AGGREGATE_COVER_OPTIONS.length < 2) out.push(`only ${AGGREGATE_COVER_OPTIONS.length} aggregate option(s)`);
  for (const l of LINES) for (const o of AGGREGATE_COVER_OPTIONS) for (const e of EXPOSURES) {
    const y0 = aggregateCoverQuote(l, o.id, e, 0);
    for (const y of [...PLAYED, ...PRE_GAME]) {
      const q = aggregateCoverQuote(l, o.id, e, y), tag = `${l} ${o.id} $${e}M year ${y}`;
      const want = PAID.factorFor(y) * (q.expectedRecovery * o.load);
      if (q.price !== want) out.push(`${tag}: price ${q.price}, ${PAID.factorFor(y)} x expected recovery x load = ${want}`);
      // The terms and expected recovery: identical to the same call with the factor at 1 ...
      const b = quoteAtFactorOne(l, o.id, e, y);
      for (const k of ['expectedNormal', 'expectedAttritional', 'attachment', 'limit', 'expectedRecovery'] as const) {
        if (q[k] !== b[k]) out.push(`${tag}: ${k} ${q[k]} with the factor, ${b[k]} without`);
      }
      // ... and, per unit of expected normal losses (all the year moves), to pre-game year 0's.
      const unit = (x: Quote, k: 'attachment' | 'limit' | 'expectedRecovery' | 'price') => x[k] / x.expectedNormal;
      for (const k of ['attachment', 'limit', 'expectedRecovery'] as const) {
        if (!near(unit(q, k), unit(y0, k))) out.push(`${tag}: ${k} per unit ${unit(q, k)}, year 0's ${unit(y0, k)}`);
      }
      // (The price per unit: the year's factor over year 0's — 1 now, both 2 x.)
      if (!near(unit(q, 'price'), PAID.factorFor(y) / PAID.factorFor(0) * unit(y0, 'price'))) {
        out.push(`${tag}: price per unit ${unit(q, 'price')}, ${PAID.factorFor(y) / PAID.factorFor(0)} x year 0's ${unit(y0, 'price')}`);
      }
      if (o.limit > 0 && q.expectedRecovery > 0) paying++;
    }
  }
  if (paying === 0) out.push('no aggregate option with an expected recovery — nothing measured');
  return out;
}

// ---- 3. A PLAYED SOLO GAME -------------------------------------------------------
const SCENARIO = '13';
const YEARS = 3;
// A five-year game: the catalogue's draw depends on the length, and at five years scenario 13
// draws Winterstorm (Property Low T) and Legislation Change (GL High T) in year 2.
const GAME_LENGTH = 5;
const PER_CLAIM: Record<CoverageLine, string> = { WC: '$19M xs $1M', GL: '$18M xs $2M', Property: '$38M xs $2M' };
const AGGREGATE: Record<CoverageLine, string> = { WC: 'agg-110-50', GL: 'agg-125-50', Property: 'agg-150-50' };
interface Game { opening: GameState; perYear: LineResultSet[][][] }
function playGame(): Game {
  const dec = (y: number) => {
    const d = defaultDecisionSet(y);
    for (const l of LINES) { d.byLine[l].reinsuranceOption = PER_CLAIM[l]; d.byLine[l].aggregateCover = AGGREGATE[l]; }
    return d;
  };
  const { setup, instance } = openSoloInstance({ poolName: 'C', gameLength: GAME_LENGTH, startingYear: 2027, instanceId: SCENARIO, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const opening = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [],
    currentDecisions: dec(1), priorHistory, earlyPreGameHistory } as GameState);
  let gs = opening;
  const perYear: LineResultSet[][][] = [];
  for (let y = 1; y <= YEARS; y++) {
    const played = playWorldsYear(gs, dec(y));
    perYear.push(played.perWorld.map(p => p.lineResults.map(r => r.result)));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
  }
  return { opening, perYear };
}
let doubled: Game | null = null, base: Game | null = null;
const doubledGame = () => (doubled ??= playGame());
const baseGame = () => { if (!base) { const restore = factorOne(); try { base = playGame(); } finally { restore(); } } return base; };
const preGameRows = (g: Game): ResultSet[] => [...(g.opening.earlyPreGameHistory ?? []), ...g.opening.priorHistory];
const loadOf = (id: string) => AGGREGATE_COVER_OPTIONS.find(o => o.id === id)!.load;

/** `game` is the shipped run, `ref` the factor-1 run; `recoveryX` scales the game's recoveries (the control's defect). */
function sectionGame(game: Game = doubledGame(), ref: Game = baseGame(), recoveryX = 1): string[] {
  const out: string[] = [];
  let charged = 0, perClaim = 0, aggregate = 0;
  for (let y = 1; y <= YEARS; y++) game.perYear[y - 1].forEach((rows, w) => rows.forEach(r => {
    const b = ref.perYear[y - 1][w].find(x => x.line === r.line)!, tag = `year ${y} ${r.line} world ${w + 1}`;
    const line = r.line as CoverageLine;
    if (r.decisions?.reinsuranceOption !== PER_CLAIM[line] || r.decisions?.aggregateCover !== AGGREGATE[line]) {
      out.push(`${tag}: held ${r.decisions?.reinsuranceOption} / ${r.decisions?.aggregateCover}`);
    }
    const ac = r.attritionalCover, bc = b.attritionalCover;
    if (!ac || !bc) { out.push(`${tag}: no aggregate cover record`); return; }
    // Charged: 2 x the base prices the engine used (the factor-1 run's), the whole charge and the aggregate cover's part.
    const want = PAID.factorFor(y) * b.reinsuranceCost;
    if (!near(r.reinsuranceCost, want)) out.push(`${tag}: charged ${r.reinsuranceCost.toFixed(2)}, ${PAID.factorFor(y)} x the base ${b.reinsuranceCost.toFixed(2)} = ${want.toFixed(2)}`);
    if (!near(ac.price, PAID.factorFor(y) * bc.price)) out.push(`${tag}: aggregate cover price ${ac.price.toFixed(2)}, ${PAID.factorFor(y)} x the base ${bc.price.toFixed(2)}`);
    if (!near(ac.price, PAID.factorFor(y) * ac.expectedRecovery * loadOf(ac.optionId))) out.push(`${tag}: aggregate cover price ${ac.price.toFixed(2)}, ${PAID.factorFor(y)} x expected recovery x load ${(ac.expectedRecovery * loadOf(ac.optionId)).toFixed(2)}`);
    if (!(r.reinsuranceCost > ac.price && ac.price > 0)) out.push(`${tag}: no per-claim or aggregate price in the charge (${r.reinsuranceCost} / ${ac.price})`);
    // Recovered: identical to the factor-1 run, as are the gross losses and the cover's terms.
    const rec = { per: r.reinsuranceRecovery * recoveryX, agg: ac.recovery * recoveryX, stop: (r.aggregateRecovery ?? 0) * recoveryX };
    if (rec.per !== b.reinsuranceRecovery) out.push(`${tag}: recovered ${rec.per}, the factor-1 run ${b.reinsuranceRecovery}`);
    if (rec.agg !== bc.recovery) out.push(`${tag}: aggregate cover recovered ${rec.agg}, the factor-1 run ${bc.recovery}`);
    if (rec.stop !== (b.aggregateRecovery ?? 0)) out.push(`${tag}: aggregate stop recovered ${rec.stop}, the factor-1 run ${b.aggregateRecovery ?? 0}`);
    if (r.grossUltimateLoss !== b.grossUltimateLoss) out.push(`${tag}: gross ${r.grossUltimateLoss}, the factor-1 run ${b.grossUltimateLoss}`);
    if (ac.attachment !== bc.attachment || ac.limit !== bc.limit || ac.expectedRecovery !== bc.expectedRecovery) out.push(`${tag}: the aggregate cover's terms moved`);
    charged++;
    if (r.reinsuranceRecovery > 0) perClaim++;
    if (ac.recovery > 0) aggregate++;
  }));
  if (charged === 0) out.push('no line-year charged — nothing measured');
  if (perClaim === 0) out.push('no per-claim recovery in any world-line-year — not measured');
  if (aggregate === 0) out.push('no aggregate cover recovery in any world-line-year — not measured');
  return out;
}
const LINE_FIELDS = ['grossUltimateLoss', 'reinsuranceRecovery', 'aggregateRecovery', 'activeExposure', 'expectedLoss'] as const;
const year1Premium = (g: Game, l: CoverageLine) => {
  const last = g.opening.priorHistory[g.opening.priorHistory.length - 1];
  return openingYear1Premium(g.opening.instance, l, g.opening.poolState.lines[l]!, last?.byLine[l], gameShocksOn(g.opening.setup, g.opening.instance));
};
function sectionOpening(game: Game = doubledGame(), ref: Game = baseGame()): string[] {
  const out: string[] = [];
  const a = preGameRows(game), b = preGameRows(ref);
  let covered = 0;
  if (a.length === 0) out.push('no pre-game year — nothing measured');
  if (a.length !== b.length) out.push(`${a.length} pre-game years, the factor-1 run ${b.length}`);
  a.forEach((r, i) => LINES.forEach(l => {
    const x = r.byLine[l], z = b[i]?.byLine[l], tag = `year ${r.yearNumber} ${l}`;
    if (!x || !z) { out.push(`${tag}: missing`); return; }
    // Paid: exactly 2 x the factor-1 run's (the table's price) where the prior board bought cover.
    const want = PAID.factorFor(r.yearNumber) * z.reinsuranceCost;
    if (!near(x.reinsuranceCost, want)) out.push(`${tag}: pre-game reinsuranceCost ${x.reinsuranceCost}, ${PAID.factorFor(r.yearNumber)} x the factor-1 run's ${z.reinsuranceCost} = ${want}`);
    if (z.reinsuranceCost > 0) covered++;
    // Recovered, lost and written: identical to the factor-1 run.
    for (const k of LINE_FIELDS) if ((x[k] ?? 0) !== (z[k] ?? 0)) out.push(`${tag}: ${k} ${x[k]}, the factor-1 run ${z[k]}`);
    if ((x.attritionalCover?.recovery ?? 0) !== (z.attritionalCover?.recovery ?? 0)) out.push(`${tag}: aggregate cover recovered ${x.attritionalCover?.recovery}, the factor-1 run ${z.attritionalCover?.recovery}`);
  }));
  if (covered === 0) out.push('the prior board paid nothing for cover in any line-year — nothing measured');
  // The opening: surplus lower than the factor-1 run's on every line, the year-1 premium at Expected identical.
  for (const l of LINES) {
    const s = game.opening.poolState.lines[l]!.surplus, t = ref.opening.poolState.lines[l]!.surplus;
    if (!(s < t)) out.push(`${l}: opening surplus ${s.toFixed(0)}, the factor-1 run ${t.toFixed(0)} — not lower`);
    const p = year1Premium(game, l), q = year1Premium(ref, l);
    if (!(p > 0) || p !== q) out.push(`${l}: year-1 premium at Expected ${p}, the factor-1 run ${q}`);
  }
  return out;
}

// ---- run -------------------------------------------------------------------------
console.log(`cover-price-factor-check (x ${CP_FACTOR} in every year, the pre-game included, ${WORLD_COUNT} worlds)\n`);
check(sectionOccurrence(), `1. per-occurrence: every option on every line, None included, costs exactly ${CP_FACTOR} x tCoverPrice in years 1-10 and in pre-game years 0, -1, -5, through optionPrice and placementPrice, growth ${GROWTH.join(' / ')}`,
  `WC $19M xs $1M year 1: $${optionPrice('WC', '$19M xs $1M', 1, 1).toFixed(0)}, year 0: $${optionPrice('WC', '$19M xs $1M', 1, 0).toFixed(0)}`);
control('COVER_PRICE_FACTOR at 1', factorOne, sectionOccurrence);
control('the factor in played years only — the pre-game at the table\'s price, as before (wip/cover-price-double before the pre-game change)', playedOnly, sectionOccurrence);

check(sectionAggregate(), `2. aggregate: every option on every line — price ${CP_FACTOR} x expected recovery x load in years 1-10 and in pre-game years 0, -1, -5 (terms and expected recovery as at factor 1, and per unit as in year 0)`,
  `WC 110/50 $900M year 1: $${aggregateCoverQuote('WC', 'agg-110-50', 900, 1).price.toFixed(0)}, year 0: $${aggregateCoverQuote('WC', 'agg-110-50', 900, 0).price.toFixed(0)}`);
control('COVER_PRICE_FACTOR at 1', factorOne, sectionAggregate);
control('the factor in played years only — the pre-game at the table\'s price, as before (wip/cover-price-double before the pre-game change)', playedOnly, sectionAggregate);

check(sectionGame(), `3a. a solo game (scenario ${SCENARIO}, ${YEARS} years, a per-claim and an aggregate cover on each line, every world): each line-year charged ${CP_FACTOR} x the factor-1 run's prices, its recoveries and gross identical`,
  (() => {
    const g = doubledGame(), b = baseGame(), r = g.perYear[1][0].find(x => x.line === 'GL')!, z = b.perYear[1][0].find(x => x.line === 'GL')!;
    const all = g.perYear.flat(2);
    const per = all.filter(x => x.reinsuranceRecovery > 0).length, agg = all.filter(x => (x.attritionalCover?.recovery ?? 0) > 0).length;
    return `GL year 2 world 1 charged $${r.reinsuranceCost.toFixed(0)} vs $${z.reinsuranceCost.toFixed(0)}, recovered $${r.reinsuranceRecovery.toFixed(0)} both; ${per} world-line-years with a per-claim recovery, ${agg} with an aggregate one`;
  })());
control('COVER_PRICE_FACTOR at 1, the game replayed', factorOne, () => sectionGame(playGame()));
control('a recovery doubled with the price', () => () => {}, () => sectionGame(doubledGame(), baseGame(), CP_FACTOR));
check(sectionOpening(), `3b. the opening: each pre-game year's reinsuranceCost ${CP_FACTOR} x the factor-1 run's, its recoveries, gross losses and exposure identical; the opening surplus lower on every line, the year-1 premium at Expected identical`,
  (() => {
    const g = doubledGame(), b = baseGame(), rows = preGameRows(g);
    const drop = LINES.map(l => `${l} $${((b.opening.poolState.lines[l]!.surplus - g.opening.poolState.lines[l]!.surplus) / 1e3).toFixed(0)}K`).join(', ');
    return `${rows.length} pre-game years; year 0 WC $${rows.at(-1)!.byLine.WC!.reinsuranceCost.toFixed(0)} vs $${preGameRows(b).at(-1)!.byLine.WC!.reinsuranceCost.toFixed(0)}; surplus down ${drop}`;
  })());
control('COVER_PRICE_FACTOR at 1 (the factor-1 run held against itself)', () => () => {}, () => sectionOpening(baseGame(), baseGame()));
control('the factor in played years only — the pre-game at the table\'s price, as before (wip/cover-price-double before the pre-game change)', playedOnly, () => sectionOpening());

console.log(failures.length ? `\nFAIL — ${failures.length}: ${failures.join('; ')}` : '\nPASS');
process.exit(failures.length ? 1 : 0);
