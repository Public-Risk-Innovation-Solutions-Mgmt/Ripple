// ============================================================================
// THE NEW LOSS ENGINE'S SHOCKS — the R model's twelve-event catalogue and its
// shock map, and the large losses they bring.
//
// The game's loss engine since loss engine commit 3, with ordinaryLoss.ts and
// largeLosses.ts; commit 2 of the plan built it. See docs/PENDING_MULTIPLAYER.md
// section 3. Each line is one book: with MEMBER_LEVEL off (the default) a large
// loss lands on the book itself (BOOK_MEMBER_ID), not on a member.
//
// ⚠ THE OLD ENGINE IS FROZEN ON THE `legacy-engine` BRANCH (b234c36), never
// committed to: `git checkout legacy-engine && npm ci && npm run gates`, or
// `npm run dev` to play it. The advance-single-player branch also carries the
// full old engine, as its own game.
//
// WHAT AN EVENT DOES, per line, on the R model's shock map (wip/shocks test
// build — see SHOCK_A_YEARS and SHOCK_T_CLAIM_RANGE in pricingParameters.ts):
//
//   A  raises the program year's ORDINARY losses x (1 + A), A drawn uniformly
//      within the level's range — in the year the event fires ONLY, on the
//      whole line (no decay, no regional share).
//   T  ONE additional large claim in the year it fires, its size drawn
//      uniformly within the level's range, unscaled, its own occurrence —
//      the claim the per-occurrence T covers answer. A regional event's claim
//      lands in the struck region.
//   R  extra adverse development on outstanding PRIOR-YEAR reserves, decaying
//      at 0.65, recognised in the year it applies and routed through the same
//      code as the host's development % — on top of it. Unchanged.
//
// And three events act off the map: Economic Inflation adds 12% to every
// line's ordinary losses, decaying (unchanged); Investment Loss hits each
// asset class's return in its year (INVESTMENT_LOSS_BY_ASSET); Member
// Withdrawal removes 25% of each line's exposure at the following year's
// renewal (unchanged).
//
// TIMING. Multiplayer: the host's schedule (setup.shockTiming === 'host').
// Singleplayer: the schedule the game drew once at its start
// (setup.shockTiming === 'solo'; utils/soloGame, SOLO_SHOCK_DRAW). Both are the
// instance's scheduledShocks, so every world fires the same events in the same
// years. Only a harness's bare instance, unmarked, fires each event with the
// catalogue's annual probability on the labelled sub-stream 'nle_fire'.
// ⚠ EVERY SHOCK DRAW IS KEYED ON THE GAME'S SEED (shockSeedOf), not the
// world's: every world shares the same events AND the same sizes.
//
// ⚠ NO SHOCKS BEFORE YEAR 1, in either mode. The pre-game is history the
// players inherit and is told as it stands; its expectation below is ordinary
// (plus routine large losses when that switch is on) and nothing else.
// ============================================================================

import {
  GAME_REGIONS, INVESTMENT_LOSS_BY_ASSET, POOL_LIMIT_PER_OCCURRENCE, R_MODEL, REGION_EXPOSURE_SHARE, ROUTINE_LARGE_LOSSES,
  regionByShare, SHOCK_A_YEARS, SHOCK_CATALOGUE_SCALE, SHOCK_T_CLAIM_RANGE, SOLO_SHOCKS,
} from '../data/pricingParameters';
import { deriveSubRng, type SeededRandom } from './random';
import { getMemberExposure } from './lineHelpers';
import { bookOrdinaryRisk, bookedCostLevel } from './ordinaryLoss';
import type { BookUnit } from './bookUnits';
import { drawRoutineLargeSize, routineLargeBasis, routineLargeCount } from './largeLosses';
import { ratingGroupOf } from './wcClaimEngine';
import type { Claim, CoverageLine, GameInstance, Member, Occurrence, Region } from '../types/simulation';
import type { ShockBand, ShockHorizon } from '../types/shocks';

export const LINES: readonly CoverageLine[] = ['WC', 'GL', 'Property'];
export type ShockLevel = 'Low' | 'Mid' | 'High' | 'None';

export interface ShockEvent {
  /** 0..11, the catalogue's order. */
  index: number;
  /** The event's id, '#1' to '#12' in catalogue order — what a host schedules. */
  id: string;
  name: string;
  probability: number;
  duration: number;
  regional: boolean;
}

// ⚠ EACH PROBABILITY SCALED BY SHOCK_CATALOGUE_SCALE (stable-scenarios commit
// 5), so the twelve total SHOCKS_PER_YEAR and keep the R model's weights.
export const SHOCK_EVENTS: readonly ShockEvent[] = R_MODEL.catalogue.map(
  ([name, probability, duration, regional], index) => ({
    index, id: `#${index + 1}`, name: name as string,
    probability: (probability as number) * SHOCK_CATALOGUE_SCALE, duration: duration as number, regional: regional as boolean,
  }),
);
/**
 * HOW EACH EVENT IS NAMED AND GRADED ON SCREEN — the twelve, by id. Carried
 * over VERBATIM from the retired shock catalogue at loss engine commit 3b, so
 * every screen, record and host list reads exactly as it did; the catalogue's
 * effects, which this engine never ran, went with it. `name` is the record's
 * own, `eventName` the player's, and band and horizon are the grades the
 * audit page prints.
 */
export const SHOCK_EVENT_LABELS: Readonly<Record<string, {
  name: string; eventName: string; band: ShockBand; horizon: ShockHorizon;
}>> = {
  '#1': { name: 'Earthquake', eventName: 'Earthquake', band: 'severe', horizon: 'current' },
  '#2': { name: 'Winterstorm/Rainstorm', eventName: 'Winterstorm', band: 'high', horizon: 'current' },
  '#3': { name: 'Wildfire', eventName: 'Wildfire', band: 'high', horizon: 'current' },
  '#4': { name: 'Legislation Change impacting both old and new claims', eventName: 'Legislation Change', band: 'severe', horizon: 'current' },
  '#5': { name: 'WC Reform', eventName: 'WC Reform', band: 'moderate', horizon: 'current' },
  '#6': { name: 'Economic Recession', eventName: 'Economic Recession', band: 'moderate', horizon: 'current' },
  '#7': { name: 'Nuclear Verdict', eventName: 'Nuclear Verdict', band: 'severe', horizon: 'current' },
  '#8': { name: 'Social Inflation (GL)', eventName: 'Social Inflation', band: 'high', horizon: 'future' },
  '#9': { name: 'Pandemic', eventName: 'Pandemic', band: 'high', horizon: 'current' },
  '#10': { name: 'Economic Inflation', eventName: 'Economic Inflation', band: 'moderate', horizon: 'current' },
  '#11': { name: 'Large Investment Loss', eventName: 'Large Investment Loss', band: 'severe', horizon: 'current' },
  '#12': { name: 'Large Member Withdrawal', eventName: 'Large Member Withdrawal', band: 'severe', horizon: 'current' },
};

const MAX_DURATION = Math.max(...SHOCK_EVENTS.map(e => e.duration));
export const DECAY = R_MODEL.shockDecayRate;

/** The shock map's rows for one event: line, and its A / T / R levels. */
export function eventLines(name: string): { line: CoverageLine; a: ShockLevel; t: ShockLevel; r: ShockLevel }[] {
  return R_MODEL.shockMap
    .filter(([e]) => e === name)
    .map(([, line, a, t, r]) => ({
      line: line as CoverageLine, a: a as ShockLevel, t: t as ShockLevel, r: r as ShockLevel,
    }));
}

export type ShockTiming = 'host' | 'catalogue';

/** One event that fired, with every size draw it will ever need, made at once. */
export interface EventFiring {
  event: ShockEvent;
  firedYear: number;
  /** Which firing of this event this is within its year — 0 unless a host scheduled it twice. */
  ordinal: number;
  region?: Region;
  /** Uniform fractions within each level's range, per line, in WC/GL/Property order. */
  draws: Record<CoverageLine, { a: number; r: number; t: number }>;
}

const firingKey = (f: EventFiring) => `${f.event.index}_${f.ordinal}`;

/**
 * THE GAME'S SEED, which every shock draw is keyed on (wip/shocks test build):
 * a world's instance carries its own seed and the game's as marketSeed
 * (worlds.worldInstance), so every world fires the same events with the same
 * A, T and R sizes and lands each T on the same unit. Only the ordinary year
 * and the market remain each world's own.
 */
export const shockSeedOf = (instance: Pick<GameInstance, 'seed' | 'marketSeed'>): number =>
  instance.marketSeed ?? instance.seed;

/** The events that START in `yearNumber`. None before year 1. */
export function firingsStartingIn(instance: GameInstance, timing: ShockTiming, yearNumber: number): EventFiring[] {
  // A shock-free shadow (SHOCK_FREE_PRICING): nothing fires.
  if (yearNumber < 1 || instance.shockFree) return [];
  const started: { event: ShockEvent; region?: Region }[] = [];
  if (timing === 'catalogue') {
    // One draw per event per year, ALWAYS, in catalogue order — so whether
    // one event fires cannot move another's.
    const rng = deriveSubRng(shockSeedOf(instance), yearNumber, 'nle_fire');
    for (const e of SHOCK_EVENTS) if (rng.next() < e.probability) started.push({ event: e });
  } else {
    // A stable sort, so two entries of one event keep their order — the order
    // generateGameInstance resolved their regions in.
    const entries = (instance.scheduledShocks ?? [])
      .filter(s => s.yearNumber === yearNumber)
      .sort((a, b) => Number(a.shockId.slice(1)) - Number(b.shockId.slice(1)));
    for (const s of entries) {
      const e = SHOCK_EVENTS.find(x => x.id === s.shockId);
      if (!e) throw new Error(`shockLosses: scheduled shock '${s.shockId}' is not one of the twelve`);
      started.push({ event: e, ...(s.region ? { region: s.region } : {}) });
    }
  }
  const seen = new Map<number, number>();
  return started.map(({ event, region: scheduled }) => {
    const ordinal = seen.get(event.index) ?? 0;
    seen.set(event.index, ordinal + 1);
    const rng = deriveSubRng(shockSeedOf(instance), yearNumber, `nle_event_${event.index}_${ordinal}`);
    // ⚠ THE WORLD'S OWN REGION DRAW IS STILL TAKEN, AND THEN SET ASIDE FOR THE
    // SCHEDULE'S. A scheduled regional event strikes the region the schedule
    // resolved once (generateGameInstance), in every world; consuming the draw
    // anyway keeps every size draw below exactly where it was, so severity is
    // still the world's own and nothing but the region moves. The drawn region
    // stands only where there is no scheduled one: catalogue timing, and a save
    // from before regions were scheduled.
    const drawn = event.regional ? regionByShare(rng.next()) : undefined;
    const region = event.regional ? (scheduled ?? drawn) : undefined;
    const draws = {} as EventFiring['draws'];
    for (const line of LINES) draws[line] = { a: rng.next(), r: rng.next(), t: rng.next() };
    return { event, firedYear: yearNumber, ordinal, ...(region ? { region } : {}), draws };
  });
}

const within = (range: readonly number[], u: number) => range[0] + u * (range[1] - range[0]);

/** A firing's T on one line: ONE claim of `size` dollars (SHOCK_T_CLAIM_RANGE). */
export interface TArrival { firing: EventFiring; line: CoverageLine; level: Exclude<ShockLevel, 'None'>; size: number; }

/** The T claim's size for a level and a uniform draw — the one rule the engine and the gates share. */
export const tClaimSize = (line: CoverageLine, level: Exclude<ShockLevel, 'None'>, u: number) =>
  within(SHOCK_T_CLAIM_RANGE[line][level], u);

/** The A for a level and a uniform draw (R_MODEL.aShock). */
export const aShare = (line: CoverageLine, level: Exclude<ShockLevel, 'None'>, u: number) =>
  within(R_MODEL.aShock[line][level], u);

/** What the Investment Loss adds to each asset class's return in its year. */
export interface MarketShock { cash: number; bonds: number; equities: number }
export const NO_MARKET_SHOCK: MarketShock = { cash: 0, bonds: 0, equities: 0 };
export const marketShockOn = (m: MarketShock) => m.cash !== 0 || m.bonds !== 0 || m.equities !== 0;
/** A market's returns with the year's Investment Loss on each class. The same object when none fired. */
export function applyMarketShock<T extends MarketShock>(market: T, shock: MarketShock): T {
  if (!marketShockOn(shock)) return market;
  return { ...market, cash: market.cash + shock.cash, bonds: market.bonds + shock.bonds, equities: market.equities + shock.equities };
}

export interface LineShockYear {
  /** Total share added to ordinary losses this year — every A and Economic Inflation. */
  uplift: number;
  /** The extra development rate on prior-year outstanding reserves. */
  rRate: number;
  /** T arriving this year. */
  arrivals: TArrival[];
  /** Per firing in force: what it adds, for the record. */
  byFiring: { firing: EventFiring; age: number; uplift: number; rRate: number }[];
}

export interface ShockYear {
  yearNumber: number;
  timing: ShockTiming;
  /** Every firing in force this year, with its age (0 at onset). */
  inForce: { firing: EventFiring; age: number }[];
  byLine: Record<CoverageLine, LineShockYear>;
  /** Added to each asset class's return this year — the Investment Loss (INVESTMENT_LOSS_BY_ASSET). */
  marketShock: MarketShock;
  /** A Member Withdrawal fired last year, so 25% of exposure leaves at this renewal. */
  withdrawal: boolean;
}

/** Everything the shocks do in `yearNumber`. Pure in the instance and the year. */
export function resolveShockYear(instance: GameInstance, timing: ShockTiming, yearNumber: number): ShockYear {
  const byLine = {} as Record<CoverageLine, LineShockYear>;
  for (const line of LINES) byLine[line] = { uplift: 0, rRate: 0, arrivals: [], byFiring: [] };
  const inForce: ShockYear['inForce'] = [];
  const marketShock: MarketShock = { ...NO_MARKET_SHOCK };
  let withdrawal = false;
  for (let age = MAX_DURATION - 1; age >= 0; age--) {
    for (const firing of firingsStartingIn(instance, timing, yearNumber - age)) {
      const e = firing.event;
      if (age >= e.duration) continue;
      inForce.push({ firing, age });
      const decay = Math.pow(DECAY, age);
      const perLine: Partial<Record<CoverageLine, { uplift: number; rRate: number }>> = {};
      const add = (line: CoverageLine, uplift: number, rRate: number) => {
        const p = perLine[line] ?? { uplift: 0, rRate: 0 };
        p.uplift += uplift; p.rRate += rRate;
        perLine[line] = p;
      };
      if (e.name === 'Economic Inflation') for (const line of LINES) add(line, R_MODEL.economicInflationInitialRate * decay, 0);
      if (e.name === 'Investment Loss' && age === 0) {
        marketShock.cash += INVESTMENT_LOSS_BY_ASSET.cash;
        marketShock.bonds += INVESTMENT_LOSS_BY_ASSET.bonds;
        marketShock.equities += INVESTMENT_LOSS_BY_ASSET.equities;
      }
      if (e.name === 'Member Withdrawal' && age === 1) withdrawal = true;
      for (const row of eventLines(e.name)) {
        const d = firing.draws[row.line];
        // A: the firing year only (SHOCK_A_YEARS), on the whole line, undecayed.
        if (row.a !== 'None' && age < SHOCK_A_YEARS) add(row.line, aShare(row.line, row.a, d.a), 0);
        if (row.r !== 'None') add(row.line, 0, within(R_MODEL.rShock[row.r], d.r) * decay);
        if (row.t !== 'None' && age === 0) {
          byLine[row.line].arrivals.push({ firing, line: row.line, level: row.t, size: tClaimSize(row.line, row.t, d.t) });
        }
      }
      for (const line of LINES) {
        const p = perLine[line];
        if (!p) continue;
        byLine[line].uplift += p.uplift;
        byLine[line].rRate += p.rRate;
        byLine[line].byFiring.push({ firing, age, uplift: p.uplift, rRate: p.rRate });
      }
    }
  }
  return { yearNumber, timing, inForce, byLine, marketShock, withdrawal };
}

/** The year's factor on year-1 sizes — the booked cost level ordinary losses
 *  take (the line's trend, and the inflation up to reporting booked up front). */
export const trendFactor = (line: CoverageLine, yearNumber: number) => bookedCostLevel(line, yearNumber);

/** What the POOL keeps of a ground-up claim — GL is limited per claim, the rest are not. */
export const poolShare = (line: CoverageLine, x: number) => {
  const limit = POOL_LIMIT_PER_OCCURRENCE[line];
  return limit === null ? x : Math.min(x, limit);
};

// --- the draw ----------------------------------------------------------------

export interface LargeLossDraw {
  claims: Claim[];
  occurrences: Occurrence[];
  /** What the line's GROSS gains: every T loss in full, every routine claim's excess. */
  grossAdded: number;
  /** Per member, the same. */
  byMember: Map<string, number>;
  /**
   * Per book unit, for its loss history (bookUnderwriting.ts): each shock
   * claim's pool amount, and the routine claims' excess. Empty with no units.
   */
  byUnit: Map<number, { routine: number; shock: number[] }>;
  /** Above the GL pool limit — the member's, in no pool total. */
  memberShareAboveLimit: number;
  /** Per firing key: the pool's T losses and their count. */
  tByFiring: Map<string, { gross: number; claims: number }>;
  routine: { count: number; groundUp: number; excess: number };
}

/**
 * WHERE A LARGE LOSS LANDS. A member (MEMBER_LEVEL on), or — with no roster —
 * the line's book in one of its regions, carrying BOOK_MEMBER_ID.
 */
type Lander = Pick<Member, 'id' | 'region'> & { wcRatingGroup?: Member['wcRatingGroup']; unit?: number };

/** The id a large loss carries when there is no member to carry it. */
export const BOOK_MEMBER_ID = 'book';

/** A lander drawn in proportion to exposure, from `pool` in id order. */
function pickMember(rng: SeededRandom, pool: { m: Lander; w: number }[], total: number): Lander {
  let u = rng.next() * total;
  for (const p of pool) { u -= p.w; if (u < 0) return p.m; }
  return pool[pool.length - 1].m;
}

/**
 * The pool losses land on. A book of UNITS (book units commit 5): each unit,
 * weighted by its size x its true risk — a riskier unit draws more of the
 * book's large losses — and for a regional T only the units in the struck
 * region. A roster: each member by exposure. Neither: the book's four regions
 * at REGION_EXPOSURE_SHARE. A unit's loss carries BOOK_MEMBER_ID and its
 * index on Claim.unit; it is never shown.
 */
function weighted(
  members: readonly Member[] | null, line: CoverageLine, yearNumber: number, region?: Region,
  units?: readonly BookUnit[],
) {
  if (members === null && units) {
    const pool = units
      .filter(u => !region || u.region === region)
      .map(u => ({ m: { id: BOOK_MEMBER_ID, region: u.region, unit: u.index } as Lander, w: u.size * u.risk }))
      .filter(p => p.w > 0);
    return { pool, total: pool.reduce((s, p) => s + p.w, 0) };
  }
  const pool: { m: Lander; w: number }[] = members === null
    ? GAME_REGIONS
      .filter(r => !region || r === region)
      .map(r => ({ m: { id: BOOK_MEMBER_ID, region: r }, w: REGION_EXPOSURE_SHARE[r] }))
    : members
      .filter(m => !region || m.region === region)
      .map(m => ({ m: m as Lander, w: getMemberExposure(m, line, yearNumber) }))
      .filter(p => p.w > 0)
      .sort((a, b) => (a.m.id < b.m.id ? -1 : a.m.id > b.m.id ? 1 : 0));
  return { pool, total: pool.reduce((s, p) => s + p.w, 0) };
}

/**
 * The year's large losses on one line: the T losses of every event arriving
 * now, and — with ROUTINE_LARGE_LOSSES on — the routine claims above the
 * ordinary limit. Returned as claims and occurrences the engine's occurrence
 * path takes exactly as it takes any other.
 */
export function drawLargeLosses(
  // null with MEMBER_LEVEL off: losses land on the book, by region.
  line: CoverageLine, members: readonly Member[] | null, yearNumber: number, calendarYear: number,
  seed: number, shocks: LineShockYear, exposure: number,
  // THE BOOK'S UNITS (book units commit 5): losses land on them by size x
  // true risk, and the book's routine claim count carries its risk.
  units?: readonly BookUnit[],
  // The GAME's seed (shockSeedOf), for where each T claim lands. Absent: `seed`.
  gameSeed: number = seed,
  // The year's shock cost factor (utils/shockCost): each T claim is its drawn
  // table size x this. Absent: 1, the table.
  tFactor = 1,
): LargeLossDraw {
  const out: LargeLossDraw = {
    claims: [], occurrences: [], grossAdded: 0, byMember: new Map(), byUnit: new Map(),
    memberShareAboveLimit: 0, tByFiring: new Map(), routine: { count: 0, groundUp: 0, excess: 0 },
  };
  const book = weighted(members, line, yearNumber, undefined, units);
  const credit = (memberId: string, amount: number) =>
    out.byMember.set(memberId, (out.byMember.get(memberId) ?? 0) + amount);
  const onUnit = (m: Lander) => {
    if (m.unit === undefined) return undefined;
    let u = out.byUnit.get(m.unit);
    if (!u) out.byUnit.set(m.unit, (u = { routine: 0, shock: [] }));
    return u;
  };
  const claimOf = (id: string, occurrenceId: string, m: Lander, tier: string, amount: number, shockId?: string): Claim => ({
    id, occurrenceId, memberId: m.id, line, accidentYear: yearNumber, calendarYear, tier,
    ...(line === 'WC' && m.wcRatingGroup ? { ratingClass: ratingGroupOf(m as Member) } : {}),
    status: 'open', reportedYear: yearNumber, grossUltimate: amount, paidToDate: 0, caseReserve: amount,
    ...(shockId !== undefined ? { shockId } : {}),
    ...(m.unit !== undefined ? { unit: m.unit } : {}),
  });

  // --- T: each arriving event's ONE claim ---------------------------------
  // Its size was drawn with the firing (tClaimSize); where it lands is drawn
  // from the GAME's seed, so every world puts it on the same unit.
  for (const arrival of shocks.arrivals) {
    const f = arrival.firing;
    const key = firingKey(f);
    const tag = `${f.event.index}-${f.ordinal}`;
    const whoRng = deriveSubRng(gameSeed, f.firedYear, `nle_tm_${f.event.index}_${f.ordinal}_${line}`);
    const where = weighted(members, line, yearNumber, f.region, units);
    const rec = { gross: 0, claims: 0 };
    if (where.total > 0) {
      const x = arrival.size * tFactor;
      const m = pickMember(whoRng, where.pool, where.total);
      const pool = poolShare(line, x);
      out.memberShareAboveLimit += x - pool;
      const id = `nle-${line}-${yearNumber}-t${tag}-0`;
      const occurrenceId = `nle-occ-${line}-${yearNumber}-t${tag}`;
      out.claims.push(claimOf(id, occurrenceId, m, 'shock', pool, f.event.id));
      // No peril: the T covers answer the claim from their own attachment, with
      // no peril deductible ahead of them. A regional event's claim is a
      // catastrophe, booked at its drawn size (bookedOccurrenceTotals).
      out.occurrences.push({
        id: occurrenceId, line, memberId: m.id, memberIds: [m.id], accidentYear: yearNumber, calendarYear,
        region: m.region, isCatastrophe: f.event.regional, claimIds: [id],
      });
      credit(m.id, pool);
      onUnit(m)?.shock.push(pool);
      rec.gross += pool;
      rec.claims += 1;
    }
    out.grossAdded += rec.gross;
    const prior = out.tByFiring.get(key);
    out.tByFiring.set(key, prior ? { gross: prior.gross + rec.gross, claims: prior.claims + rec.claims } : rec);
  }

  // --- routine large losses -------------------------------------------------
  if (ROUTINE_LARGE_LOSSES.enabled && book.total > 0) {
    const basis = routineLargeBasis(line);
    const g = trendFactor(line, yearNumber);
    const rng = deriveSubRng(seed, yearNumber, `nle_routine_${line}`);
    const whoRng = deriveSubRng(seed, yearNumber, `nle_routine_m_${line}`);
    // A riskier book draws more routine large claims: the count is on its
    // exposure x its size-weighted true risk (1 with no units).
    const n = rng.poisson(routineLargeCount(line, exposure * (units ? bookOrdinaryRisk(units) : 1)));
    for (let i = 0; i < n; i++) {
      const x = g * drawRoutineLargeSize(rng, basis);
      const m = pickMember(whoRng, book.pool, book.total);
      const pool = poolShare(line, x);
      out.memberShareAboveLimit += x - pool;
      // ⚠ REGISTERED AT ITS FULL GROUND-UP SIZE, BOOKED BY ITS EXCESS. The
      // first g x limit of it is already in ordinary losses; the tower
      // attaches to the whole claim. See largeLosses.ts's header.
      const excess = pool - g * basis.limit;
      const id = `nle-${line}-${yearNumber}-r${i}`;
      const occurrenceId = `nle-occ-${line}-${yearNumber}-r${i}`;
      out.claims.push(claimOf(id, occurrenceId, m, 'large', pool));
      out.occurrences.push({
        id: occurrenceId, line, memberId: m.id, memberIds: [m.id], accidentYear: yearNumber, calendarYear,
        region: m.region, isCatastrophe: false, claimIds: [id],
      });
      credit(m.id, excess);
      const onU = onUnit(m);
      if (onU) onU.routine += excess;
      out.grossAdded += excess;
      out.routine.count += 1;
      out.routine.groundUp += pool;
      out.routine.excess += excess;
    }
  }
  return out;
}

export { firingKey };

/**
 * The timing a game runs on. A session marks its setup 'host' and a solo game
 * 'solo'; both fire the instance's schedule ('host' timing — the schedule, not
 * who drew it). An unmarked setup is a harness's bare instance.
 */
export const shockTimingOf = (setup: { shockTiming?: 'host' | 'solo' }): ShockTiming =>
  setup.shockTiming === 'host' || setup.shockTiming === 'solo' ? 'host' : 'catalogue';

/**
 * ARE THIS GAME'S SHOCKS ON? — the switch every reader of expected loss follows.
 *
 * On when shocks can fire: a game on the schedule ('host' timing — a hosted
 * room, or a solo game with SOLO_SHOCKS on) that has at least one event
 * scheduled, or a harness's bare instance, which fires at the catalogue's
 * probabilities. Off otherwise — a solo game with SOLO_SHOCKS off carries no
 * schedule, and neither does a room whose host scheduled none.
 *
 * ⚠ WITH SHOCKS OFF, THE EXPECTATION IS THE ORDINARY LOSSES ONLY, EVERYWHERE:
 * the Expected Losses rows, the reserve basis, the expected loss ratio, the
 * aggregate stop's attachment and each cover's price and recovery distribution
 * (expectedLossBreakdown and stopQuotes take this flag). An expectation that
 * carried the catalogue's shocks in a game where none can fire read 4-6% above
 * every simulated year, attached the covers that far above the real mean and
 * priced them for recoveries that never came.
 */
//
// ⚠ A SOLO GAME WITH SOLO_SHOCKS ON IS ALWAYS ON (wip/shocks), whatever its
// draw. At the catalogue's odds a ten-year game draws no event about one time
// in fifteen; read off the schedule, that game would hide the covers and its
// shock expectation — telling the player nothing will fire.
export const gameShocksOn = (
  setup: { shockTiming?: 'host' | 'solo' }, instance: { scheduledShocks?: readonly unknown[] },
): boolean => shockTimingOf(setup) === 'catalogue' || (setup.shockTiming === 'solo' && SOLO_SHOCKS.enabled)
  || (instance.scheduledShocks?.length ?? 0) > 0;

/**
 * MEMBER WITHDRAWAL: 25% of the line's exposure leaves at this renewal.
 * Members leave in an order drawn from the year's stream until the share
 * leaving reaches the reduction; the last one leaves whole. Members are kept
 * until commit 5, so the exposure leaves AS members — premium, claims and
 * the record all follow without a second mechanism.
 */
export function withdrawForShock(
  members: readonly Member[], line: CoverageLine, yearNumber: number, seed: number,
): { retained: Member[]; withdrawn: Member[] } {
  const rng = deriveSubRng(seed, yearNumber, `nle_withdraw_${line}`);
  const order = [...members]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(m => ({ m, key: rng.next() }))
    .sort((a, b) => a.key - b.key);
  const total = members.reduce((s, m) => s + getMemberExposure(m, line, yearNumber), 0);
  const target = total * R_MODEL.memberWithdrawalReduction;
  const leaving = new Set<string>();
  let gone = 0;
  for (const { m } of order) {
    if (gone >= target) break;
    leaving.add(m.id);
    gone += getMemberExposure(m, line, yearNumber);
  }
  return {
    retained: members.filter(m => !leaving.has(m.id)),
    withdrawn: members.filter(m => leaving.has(m.id)).map(m => ({ ...m, status: 'withdrawn' as const, yearWithdrawn: yearNumber })),
  };
}
