// ============================================================================
// MARKET COMPETITION, THE SESSION SIDE — shared by every transport (localStorage,
// the stub, DynamoDB, the Lambda handler), so the step a room stores is the same
// whichever server ran it.
//
// The server runs one market step per year, when the host advances past the
// year, from what each team sent with its lock (MarketLockInput: the struck
// rate, the book, the three market decisions). It is stored ONCE with the room;
// every team's game reads its own slice when it plays and replays the year
// (client/buildGame.ts), so a rejoin on another device lands in the same place.
// The step itself is utils/market/marketStep.ts.
// ============================================================================

import { MARKET_DEFAULT_LEVEL, NEW_MEMBERS_SLIDER, NON_RENEWAL_SLIDER, type MarketLevel } from '../data/pricingParameters';
import type { CoverageLine, MarketLineInput } from '../types/simulation';
import { runMarketStep, type MarketTeamInput, type MarketTeamLineResult } from '../utils/market/marketStep';
import type { MarketLockInput, MarketLockLine, StoredMarketTeamInput, StoredMarketYear } from './contract';

const LEVELS: readonly MarketLevel[] = ['off', 'low', 'medium', 'high'];

/** A stored room's level: absent (a room from before the setting) reads 'off'. */
export const marketLevelOf = (v: unknown): MarketLevel =>
  typeof v === 'string' && (LEVELS as readonly string[]).includes(v) ? (v as MarketLevel) : 'off';

/** A create request's level: absent reads 'off' too (the form always sends one; MARKET_DEFAULT_LEVEL is its default). */
export const requestedMarketLevel = (v: unknown): MarketLevel | null =>
  v === undefined ? 'off' : (LEVELS as readonly string[]).includes(v as string) ? (v as MarketLevel) : null;
export { MARKET_DEFAULT_LEVEL };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A lock's market input, checked: every played line present, rate and book
 * positive and finite, the two shares clamped to their sliders, the switch a
 * boolean. Null if it is not usable (the submit is refused as INVALID_REQUEST).
 */
export function validMarketLockInput(x: unknown, lines: readonly CoverageLine[]): MarketLockInput | null {
  if (!x || typeof x !== 'object') return null;
  const byLine = (x as { byLine?: unknown }).byLine;
  if (!byLine || typeof byLine !== 'object') return null;
  const out: Partial<Record<CoverageLine, MarketLockLine>> = {};
  for (const line of lines) {
    const v = (byLine as Record<string, unknown>)[line] as Partial<MarketLockLine> | undefined;
    if (!v || !finitePositive(v.rate) || !finitePositive(v.book) || !finite(v.newMembers) || !finite(v.nonRenewal)) return null;
    out[line] = {
      rate: v.rate, book: v.book,
      newMembers: clamp(v.newMembers, NEW_MEMBERS_SLIDER.min, NEW_MEMBERS_SLIDER.max),
      nonRenewal: clamp(v.nonRenewal, NON_RENEWAL_SLIDER.min, NON_RENEWAL_SLIDER.max),
    };
  }
  return { byLine: out };
}

export interface MarketRosterEntry {
  name: string;
  teamNumber: number;
  /** The team's latest lock's market input at or before the year, and that lock's year. */
  latest?: { year: number; input: MarketLockInput };
}

/**
 * THE YEAR'S MARKET STEP, FROM THE ROOM'S STATE — what advance stores. A team
 * that locked the year counts at its own figures. One that did not counts at its
 * LAST locked rate and decisions (it plays them too), on its book carried
 * forward from last year's step (the book after the moves, less the engine's
 * drop), and is flagged `stale`. One that never locked is left out (`missing`):
 * its game plays without a market result, as a team outside the market would.
 */
export function marketYearForAdvance(a: {
  code: string;
  seed: string;
  level: Exclude<MarketLevel, 'off'>;
  lines: readonly CoverageLine[];
  year: number;
  roster: readonly MarketRosterEntry[];
  previous?: StoredMarketYear;
}): StoredMarketYear {
  const inputs: Record<string, StoredMarketTeamInput> = {};
  const missing: string[] = [];
  const teams: MarketTeamInput[] = [];
  const keyOf = (n: number) => `T${n}`;
  const nameOfKey: Record<string, string> = {};
  for (const t of [...a.roster].sort((x, y) => x.teamNumber - y.teamNumber)) {
    if (!t.latest) { missing.push(t.name); continue; }
    const stale = t.latest.year !== a.year;
    const byLine: Partial<Record<CoverageLine, MarketLockLine>> = {};
    for (const line of a.lines) {
      const l = t.latest.input.byLine[line];
      if (!l) continue;
      const prev = a.previous?.result[t.name]?.[line];
      const book = stale && prev ? prev.bookAfter * (1 - prev.engineNonRenewal) : l.book;
      byLine[line] = { ...l, book };
    }
    inputs[t.name] = { teamNumber: t.teamNumber, fromYear: t.latest.year, stale, byLine };
    teams.push({
      key: keyOf(t.teamNumber),
      lines: Object.fromEntries(Object.entries(byLine).map(([line, l]) => [line, {
        rate: l!.rate, book: l!.book, newMembers: l!.newMembers, nonRenewal: l!.nonRenewal,
        bookRisk: a.previous?.result[t.name]?.[line as CoverageLine]?.bookRisk ?? 1,
      }])),
    });
    nameOfKey[keyOf(t.teamNumber)] = t.name;
  }
  const step = runMarketStep({
    level: a.level, seed: `${a.code}|${a.seed}`, year: a.year, lines: a.lines, teams,
    untakenDroppedLastYear: a.previous?.untakenDropped ?? {},
  });
  const result: Record<string, Partial<Record<CoverageLine, MarketTeamLineResult>>> = {};
  for (const [key, r] of Object.entries(step.teams)) result[nameOfKey[key]] = r;
  return { year: a.year, level: a.level, inputs, missing, result, untakenDropped: step.untakenDropped };
}

/** One team's stored results, by year — CallerView.marketByYear. */
export function teamMarketByYear(
  years: Record<string, StoredMarketYear> | undefined, teamName: string,
): Record<string, Partial<Record<CoverageLine, MarketTeamLineResult>>> | undefined {
  if (!years) return undefined;
  const out: Record<string, Partial<Record<CoverageLine, MarketTeamLineResult>>> = {};
  for (const [y, s] of Object.entries(years)) if (s.result[teamName]) out[y] = s.result[teamName];
  return Object.keys(out).length ? out : undefined;
}

/** What the engine reads of a stored result (setup.marketByYear; bookUnderwriting.ts moveBook). */
export const marketLineInputOf = (r: MarketTeamLineResult): MarketLineInput => ({
  leftShare: r.leftShare,
  intake: r.inGood + r.inOutside + r.inDropped,
  engineNonRenewal: r.engineNonRenewal,
  bookRisk: r.bookRisk,
});

/** The engine's per-year market input from a team's stored results. */
export function marketByYearForEngine(
  byYear: Record<string, Partial<Record<CoverageLine, MarketTeamLineResult>>> | undefined,
): Record<string, Partial<Record<CoverageLine, MarketLineInput>>> | undefined {
  if (!byYear) return undefined;
  const out: Record<string, Partial<Record<CoverageLine, MarketLineInput>>> = {};
  for (const [y, lines] of Object.entries(byYear)) {
    out[y] = Object.fromEntries(Object.entries(lines).map(([l, r]) => [l, marketLineInputOf(r!)]));
  }
  return out;
}
