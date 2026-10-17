// ============================================================================
// THE NEW LOSS ENGINE'S SHOCKS — the R model's twelve-event catalogue and its
// shock map, and the large losses they bring.
//
// Behind NEW_LOSS_ENGINE (off). Commit 2 of the loss engine plan; see
// docs/PENDING_MULTIPLAYER.md section 3. With the flag off nothing here runs
// and today's shocks (shockResolver.ts) are untouched.
//
// WHAT AN EVENT DOES, per line, on the R model's shock map:
//
//   A  raises the year's ORDINARY losses by a share drawn uniformly within
//      the level's range, decaying at 0.65 a year over the event's duration.
//      A regional event's A reaches only its region's share of the line
//      (REGION_EXPOSURE_SHARE).
//   T  arrives at onset as LARGE INDIVIDUAL LOSSES (SHOCK_LOSS_COUNT of them,
//      each lognormal around T / count), through the engine's occurrence
//      path, so the tower answers them per occurrence. T is the EXPECTED
//      aggregate; the realised total varies and is never rescaled.
//   R  extra adverse development on outstanding PRIOR-YEAR reserves, decaying
//      at 0.65, recognised in the year it applies and routed through the same
//      code as the host's development % — on top of it.
//
// And three events act off the map: Economic Inflation adds 12% to every
// line's ordinary losses, decaying; Investment Loss takes 20 points off the
// equity return in its year; Member Withdrawal removes 25% of each line's
// exposure at the following year's renewal.
//
// ⚠ T SCALING — PER LINE, AND ON A BASIS THAT DOES NOT MOVE WITH FUNDING.
// The R model's T is in ITS dollars, sized against its own book. Each line's
// T is scaled by that line's own ratio:
//
//   scale = the line's expected ORDINARY loss this year
//           / (the R model's base premium x its target loss ratio, same line)
//
// Both halves are ordinary losses — the R model's base premium times its
// target loss ratio is ITS ordinary expectation — so the ratio compares like
// with like. It moves with the book's exposure and the 5% trend and with
// nothing a team decides about price: a team that funds at 90% faces the same
// verdict as one that funds at expected. Never one pool-wide factor: the R
// model's Property book is $4.5M and its GL book $7M.
//
// ⚠ A REGIONAL T LANDS WHOLE IN ITS REGION. Its size is the event's — it is
// not cut to the region's share, because a disaster is sized by what happened
// rather than by how the book is split — and every loss lands on a member in
// the struck region, drawn in proportion to exposure. A region is drawn for
// every regional firing, uniformly, from the firing's own stream; one event's
// region is the same on every line it touches.
//
// TIMING. Multiplayer: the host's schedule (setup.shockTiming === 'host'),
// and no probability is consulted. Singleplayer: each event fires with the
// catalogue's annual probability, drawn from the labelled sub-stream
// 'nle_fire'. Either way every SIZE is drawn from a stream keyed on the event,
// the firing year and its ordinal, so the same seed gives the same shock.
//
// ⚠ NO SHOCKS BEFORE YEAR 1, in either mode. The pre-game is history the
// players inherit and is told as it stands; its expectation below is ordinary
// (plus routine large losses when that switch is on) and nothing else.
// ============================================================================

import {
  POOL_LIMIT_PER_OCCURRENCE, R_MODEL, REGION_EXPOSURE_SHARE, ROUTINE_LARGE_LOSSES,
  SEVERITY_TREND_PER_YEAR, SHOCK_LOSS_COUNT, SHOCK_LOSS_CV, SHOCK_ONE_OCCURRENCE,
} from '../data/pricingParameters';
import { CAT_REGIONS } from './propertyCatastrophe';
import { deriveSubRng, type SeededRandom } from './random';
import { getMemberExposure } from './lineHelpers';
import { ordinaryLossCostPer100 } from './ordinaryLoss';
import { drawRoutineLargeSize, lognormalFromMean, routineLargeBasis, routineLargeCount } from './largeLosses';
import { ratingGroupOf } from './wcClaimEngine';
import type { Claim, CoverageLine, GameInstance, Member, Occurrence, Region } from '../types/simulation';

export const LINES: readonly CoverageLine[] = ['WC', 'GL', 'Property'];
export type ShockLevel = 'Low' | 'Mid' | 'High' | 'None';

export interface ShockEvent {
  /** 0..11, the catalogue's order. */
  index: number;
  /** The live catalogue's id for the same event — SHOCK_CATALOG['#n']. */
  id: string;
  name: string;
  probability: number;
  duration: number;
  regional: boolean;
}

export const SHOCK_EVENTS: readonly ShockEvent[] = R_MODEL.catalogue.map(
  ([name, probability, duration, regional], index) => ({
    index, id: `#${index + 1}`, name: name as string,
    probability: probability as number, duration: duration as number, regional: regional as boolean,
  }),
);
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

/** The events that START in `yearNumber`. None before year 1. */
export function firingsStartingIn(instance: GameInstance, timing: ShockTiming, yearNumber: number): EventFiring[] {
  if (yearNumber < 1) return [];
  const started: ShockEvent[] = [];
  if (timing === 'catalogue') {
    // One draw per event per year, ALWAYS, in catalogue order — so whether
    // one event fires cannot move another's.
    const rng = deriveSubRng(instance.seed, yearNumber, 'nle_fire');
    for (const e of SHOCK_EVENTS) if (rng.next() < e.probability) started.push(e);
  } else {
    const ids = (instance.scheduledShocks ?? [])
      .filter(s => s.yearNumber === yearNumber)
      .map(s => s.shockId)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    for (const id of ids) {
      const e = SHOCK_EVENTS.find(x => x.id === id);
      if (!e) throw new Error(`shockLosses: scheduled shock '${id}' is not one of the twelve`);
      started.push(e);
    }
  }
  const seen = new Map<number, number>();
  return started.map(event => {
    const ordinal = seen.get(event.index) ?? 0;
    seen.set(event.index, ordinal + 1);
    const rng = deriveSubRng(instance.seed, yearNumber, `nle_event_${event.index}_${ordinal}`);
    const region = event.regional ? CAT_REGIONS[Math.min(2, Math.floor(rng.next() * 3))] : undefined;
    const draws = {} as EventFiring['draws'];
    for (const line of LINES) draws[line] = { a: rng.next(), r: rng.next(), t: rng.next() };
    return { event, firedYear: yearNumber, ordinal, ...(region ? { region } : {}), draws };
  });
}

const within = (range: readonly number[], u: number) => range[0] + u * (range[1] - range[0]);

/** A firing's T on one line, in the R model's dollars, before scaling. */
export interface TArrival { firing: EventFiring; line: CoverageLine; level: ShockLevel; tModel: number; count: number; oneOccurrence: boolean; }

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
  /** Added to the equity return this year. */
  equityShock: number;
  /** A Member Withdrawal fired last year, so 25% of exposure leaves at this renewal. */
  withdrawal: boolean;
}

/** Everything the shocks do in `yearNumber`. Pure in the instance and the year. */
export function resolveShockYear(instance: GameInstance, timing: ShockTiming, yearNumber: number): ShockYear {
  const byLine = {} as Record<CoverageLine, LineShockYear>;
  for (const line of LINES) byLine[line] = { uplift: 0, rRate: 0, arrivals: [], byFiring: [] };
  const inForce: ShockYear['inForce'] = [];
  let equityShock = 0;
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
      if (e.name === 'Investment Loss' && age === 0) equityShock += R_MODEL.investmentLossAdjustment;
      if (e.name === 'Member Withdrawal' && age === 1) withdrawal = true;
      for (const row of eventLines(e.name)) {
        const d = firing.draws[row.line];
        if (row.a !== 'None') {
          const share = firing.region ? REGION_EXPOSURE_SHARE[row.line][firing.region] : 1;
          add(row.line, within(R_MODEL.aShock[row.line][row.a], d.a) * decay * share, 0);
        }
        if (row.r !== 'None') add(row.line, 0, within(R_MODEL.rShock[row.r], d.r) * decay);
        if (row.t !== 'None' && age === 0) {
          const count = SHOCK_LOSS_COUNT[e.name]?.[row.line];
          if (!count) throw new Error(`shockLosses: no SHOCK_LOSS_COUNT for ${e.name} on ${row.line}`);
          byLine[row.line].arrivals.push({
            firing, line: row.line, level: row.t, count,
            tModel: within(R_MODEL.tShock[row.line][row.t], d.t),
            oneOccurrence: SHOCK_ONE_OCCURRENCE.includes(e.name),
          });
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
  return { yearNumber, timing, inForce, byLine, equityShock, withdrawal };
}

/** The R model's ORDINARY expectation for a line — its base premium x target loss ratio. */
export const rModelOrdinary = (line: CoverageLine) => R_MODEL.basePremium[line] * R_MODEL.targetLossRatio[line];

/** T_SCALE: this line's expected ordinary loss this year over the R model's. See the header. */
export function tScale(line: CoverageLine, exposure: number, yearNumber: number): number {
  return (exposure * 10_000 * ordinaryLossCostPer100(line, yearNumber)) / rModelOrdinary(line);
}

/** The year's trend factor on year-1 sizes — the same 5% ordinary losses take. */
export const trendFactor = (line: CoverageLine, yearNumber: number) =>
  Math.pow(1 + SEVERITY_TREND_PER_YEAR[line], yearNumber - 1);

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
  /** Above the GL pool limit — the member's, in no pool total. */
  memberShareAboveLimit: number;
  /** Per firing key: the pool's T losses and their count. */
  tByFiring: Map<string, { gross: number; claims: number }>;
  routine: { count: number; groundUp: number; excess: number };
}

/** A member drawn in proportion to exposure, from `pool` in id order. */
function pickMember(rng: SeededRandom, pool: { m: Member; w: number }[], total: number): Member {
  let u = rng.next() * total;
  for (const p of pool) { u -= p.w; if (u < 0) return p.m; }
  return pool[pool.length - 1].m;
}

function weighted(members: readonly Member[], line: CoverageLine, yearNumber: number, region?: Region) {
  const pool = members
    .filter(m => !region || m.region === region)
    .map(m => ({ m, w: getMemberExposure(m, line, yearNumber) }))
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
  line: CoverageLine, members: readonly Member[], yearNumber: number, calendarYear: number,
  seed: number, shocks: LineShockYear, exposure: number,
): LargeLossDraw {
  const out: LargeLossDraw = {
    claims: [], occurrences: [], grossAdded: 0, byMember: new Map(),
    memberShareAboveLimit: 0, tByFiring: new Map(), routine: { count: 0, groundUp: 0, excess: 0 },
  };
  const book = weighted(members, line, yearNumber);
  const credit = (memberId: string, amount: number) =>
    out.byMember.set(memberId, (out.byMember.get(memberId) ?? 0) + amount);
  const claimOf = (id: string, occurrenceId: string, m: Member, tier: string, amount: number, shockId?: string): Claim => ({
    id, occurrenceId, memberId: m.id, line, accidentYear: yearNumber, calendarYear, tier,
    ...(line === 'WC' && m.wcRatingGroup ? { ratingClass: ratingGroupOf(m) } : {}),
    status: 'open', reportedYear: yearNumber, grossUltimate: amount, paidToDate: 0, caseReserve: amount,
    ...(shockId !== undefined ? { shockId } : {}),
  });

  // --- T: each arriving event's large losses --------------------------------
  const scale = tScale(line, exposure, yearNumber);
  for (const arrival of shocks.arrivals) {
    const f = arrival.firing;
    const key = firingKey(f);
    const tag = `${f.event.index}-${f.ordinal}`;
    const T = arrival.tModel * scale;
    const { mu, sigma } = lognormalFromMean(T / arrival.count, SHOCK_LOSS_CV);
    const sizeRng = deriveSubRng(seed, f.firedYear, `nle_t_${f.event.index}_${f.ordinal}_${line}`);
    const whoRng = deriveSubRng(seed, f.firedYear, `nle_tm_${f.event.index}_${f.ordinal}_${line}`);
    const where = weighted(members, line, yearNumber, f.region);
    const rec = { gross: 0, claims: 0 };
    // Sizes are drawn whether or not anyone is there to take them, so the
    // stream's meaning does not depend on the book.
    const sizes = Array.from({ length: arrival.count }, () => sizeRng.lognormal(mu, sigma));
    if (where.total > 0) {
      const occId = `nle-occ-${line}-${yearNumber}-t${tag}`;
      const shared: string[] = [];
      const hit = new Set<string>();
      sizes.forEach((x, i) => {
        const m = pickMember(whoRng, where.pool, where.total);
        const pool = poolShare(line, x);
        out.memberShareAboveLimit += x - pool;
        const id = `nle-${line}-${yearNumber}-t${tag}-${i}`;
        const occurrenceId = arrival.oneOccurrence ? occId : `nle-occ-${line}-${yearNumber}-t${tag}-${i}`;
        out.claims.push(claimOf(id, occurrenceId, m, 'shock', pool, f.event.id));
        if (arrival.oneOccurrence) { shared.push(id); hit.add(m.id); } else {
          out.occurrences.push({
            id: occurrenceId, line, memberId: m.id, memberIds: [m.id], accidentYear: yearNumber, calendarYear,
            region: m.region, isCatastrophe: false, claimIds: [id],
          });
        }
        credit(m.id, pool);
        rec.gross += pool;
        rec.claims += 1;
      });
      if (arrival.oneOccurrence) {
        const ids = [...hit];
        out.occurrences.push({
          id: occId, line, ...(ids.length === 1 ? { memberId: ids[0] } : {}), memberIds: ids,
          accidentYear: yearNumber, calendarYear, region: f.region ?? where.pool[0].m.region,
          isCatastrophe: true, claimIds: shared, peril: f.event.name.toLowerCase(),
        });
      }
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
    const n = rng.poisson(routineLargeCount(line, exposure));
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
      out.grossAdded += excess;
      out.routine.count += 1;
      out.routine.groundUp += pool;
      out.routine.excess += excess;
    }
  }
  return out;
}

export { firingKey };

/** The timing a game runs on. A session marks its setup; singleplayer does not. */
export const shockTimingOf = (setup: { shockTiming?: 'host' }): ShockTiming =>
  setup.shockTiming === 'host' ? 'host' : 'catalogue';

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
