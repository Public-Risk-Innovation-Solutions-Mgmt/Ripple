// A YEAR'S EVENTS, AS A PLAYER SEES THEM.
//
// Two sources, one reading. A SCHEDULED event (a shock: #2, WILDFIRE, ...) is
// recorded on `shockEvents`; a DRAWN catastrophe on Property's
// `drawnCatastrophes`. A player learns about both the same way — when the year
// processes — and must not be able to tell which was which: the name is the
// same ('Earthquake', from ShockDefinition.eventName or drawnEventName), the
// facts are the same kind (where, which lines, how many claims, how much), and
// the order is by size. The shock id, its band and its catalog description are
// the host's, and nothing here returns them.
//
// WHAT A PLAYER CAN TELL, AND NOTHING MORE: that an event happened, in which
// year, and which claims came from it (claimEventLabel, the claims workbook's
// Event column).
//
// ⚠ AN EVENT THAT TOUCHED NO ENROLLED MEMBER IS NOT AN EVENT HERE. A drawn
// catastrophe that strikes nobody in the pool emits no occurrence and so is
// never recorded; a scheduled one that lands no claim and adds no expected loss
// is dropped below for the same reason. Otherwise a scheduled miss would show
// and a drawn miss would not, which is the scheduling showing.

import type { Claim, CoverageLine, LineResultSet, Occurrence, Region, ResultSet } from '../types/simulation';
import type { ShockRecord } from '../types/shocks';
import { eventLines, POOL_WIDE_EVENTS, SHOCK_EVENTS, SHOCK_EVENT_LABELS } from './shockLosses';
import { PROPERTY_CAT_EARTHQUAKE } from '../data/defaultAssumptions';
import { LINE_FULL_NAME } from './lineDisplay';

// The tier a catastrophe claim carries — propertyClaimEngine's CAT_BAND,
// repeated rather than imported so this display module does not pull in a
// generator.
const CAT_TIER = 'cat';

// A drawn catastrophe is an earthquake or it is not (PROPERTY_CAT_EARTHQUAKE).
// The earthquake's name here and #2's eventName are the SAME string, and
// shock-check holds them together: a scheduled earthquake and a drawn one must
// read identically.
const DRAWN_EVENT_NAME: Readonly<Record<string, string>> = {
  [PROPERTY_CAT_EARTHQUAKE.peril]: 'Earthquake',
};
export function drawnEventName(peril: string | undefined): string {
  return (peril !== undefined ? DRAWN_EVENT_NAME[peril] : undefined) ?? 'Catastrophe';
}

/**
 * An event as a player reads it on the Results card, the "Events This Year"
 * row and the claims: its player name alone. ⚠ NO REGION (pr/event-wording):
 * players are not told where a regional event struck; the engine still places
 * its large claim, and the Year Walkthrough keeps its region row.
 */
export function eventLabel(name: string): string {
  return name;
}

export interface YearEventLine {
  line: CoverageLine;
  claims: number;
  grossLoss: number;
  /** Analytic, for an event that raises a rate rather than adding claims. */
  expectedGrossLossAdded: number;
}

export interface YearEvent {
  /** Stable within the year: the shock id or the drawn occurrence id. Not for display. */
  key: string;
  name: string;
  region?: Region;
  /** Set when the event began in an EARLIER year and is still in force. */
  sinceYear?: number;
  lines: YearEventLine[];
  claims: number;
  grossLoss: number;
  expectedGrossLossAdded: number;
  /** On an averaged row: the worlds it fired in. Its figures are then averages over all the worlds. */
  worlds?: { fired: number; of: number };
}

const LINE_ORDER: readonly CoverageLine[] = ['Property', 'WC', 'GL'];

// The region the retired shock catalogue fixed per event and line — exactly
// what it held. Only a FALLBACK now: a regional event's claim names the region
// its occurrence records, and a record carries its own region; this answers for
// a save written before either did, as the catalogue did until loss engine
// commit 3b deleted it.
const RETIRED_CATALOGUE_REGION: Readonly<Record<string, Partial<Record<CoverageLine, Region>>>> = {
  '#1': { Property: 'Central', WC: 'Central' },
  '#2': { Property: 'North' },
  '#3': { Property: 'North', WC: 'North' },
};

// ⚠ BY ID FIRST, THEN THE RECORD'S OWN: a record copies the name it was played
// under, so a save or room from before a rename (#5, "WC Reform") would keep
// the old one. The labels hold the current name for every id they know.
function shockName(rec: { shockId: string; eventName?: string; name: string }): string {
  return SHOCK_EVENT_LABELS[rec.shockId]?.eventName ?? rec.eventName ?? rec.name;
}

function shockRegion(rec: { shockId: string; region?: Region }): Region | undefined {
  if (rec.region) return rec.region;
  // A save from before the record carried its region: the catalogue's first.
  const fixed = RETIRED_CATALOGUE_REGION[rec.shockId];
  return fixed ? Object.values(fixed)[0] : undefined;
}

// A pool result (with byLine) or a line's own (without). The metric rows pass
// either, typed as the line shape.
//
// ⚠ NAMED BY WHAT THIS FILE READS, NOT BY A ROW TYPE, AND THE MERGE IS WHY.
// This was `Omit<ResultSet, 'byLine'>`, written when `ResultSet` WAS the row
// type and so meant "any row". The other branch of this merge split that type:
// `ResultSet` is now the POOL row and carries `pool`, which no line row has, so
// the old spelling quietly began demanding a pool-only field from line rows and
// resultMetrics and the Results page stopped compiling. Both are true rows and
// neither was wrong — the TYPE had moved under a file that never mentioned it.
// Listing the four fields actually read cannot drift that way again, and it
// states the contract: an event belongs to a year, a scope and a set of lines,
// and a drawn catastrophe is recorded on the line that drew it.
type AnyResult = Pick<LineResultSet, 'yearNumber' | 'shockEvents' | 'drawnCatastrophes'> & {
  line?: CoverageLine;
  byLine?: ResultSet['byLine'];
};

function fromShock(rec: ShockRecord, result: AnyResult): YearEvent {
  // The pool record carries the per-line split; a line's own record is one
  // line; a save from before the split carries only the total.
  const lines: YearEventLine[] = rec.byLine
    ? LINE_ORDER.filter(l => rec.byLine![l]).map(l => ({
        line: l,
        claims: rec.byLine![l]!.attributableClaims,
        grossLoss: rec.byLine![l]!.attributableGrossLoss,
        expectedGrossLossAdded: rec.byLine![l]!.expectedGrossLossAdded,
      }))
    : result.line
      ? [{ line: result.line, claims: rec.attributableClaims, grossLoss: rec.attributableGrossLoss, expectedGrossLossAdded: rec.expectedGrossLossAdded }]
      : [];
  return {
    key: rec.shockId,
    name: shockName(rec),
    region: shockRegion(rec),
    ...(rec.yearFired < result.yearNumber ? { sinceYear: rec.yearFired } : {}),
    // ⚠ A LINE THAT COST MONEY WITHOUT A CLAIM IS STILL A LINE THE EVENT HIT.
    // The new engine's A raises the year's ordinary losses — exact dollars,
    // attributed to the event — and brings no claim of its own, so filtering on
    // claims dropped Recession, Legislation, Economic Inflation and the rest
    // from the Results narrative while the audit page showed their cost.
    lines: lines.filter(l => l.claims > 0 || l.grossLoss > 0 || l.expectedGrossLossAdded > 0),
    claims: rec.attributableClaims,
    grossLoss: rec.attributableGrossLoss,
    expectedGrossLossAdded: rec.expectedGrossLossAdded,
    ...(rec.worlds ? { worlds: rec.worlds } : {}),
  };
}

/** Every event a player should learn about in this year's result, pool or line. */
export function yearEvents(result: AnyResult): YearEvent[] {
  const out: YearEvent[] = [];
  for (const rec of result.shockEvents ?? []) {
    const ev = fromShock(rec, result);
    if (ev.claims > 0 || ev.grossLoss > 0 || ev.expectedGrossLossAdded > 0) out.push(ev);
  }
  const property = result.line === 'Property' ? result : result.line ? undefined : result.byLine?.Property;
  for (const d of property?.drawnCatastrophes ?? []) {
    out.push({
      key: d.occurrenceId,
      name: drawnEventName(d.peril),
      region: d.region,
      lines: [{ line: 'Property', claims: d.claims, grossLoss: d.grossLoss, expectedGrossLossAdded: 0 }],
      claims: d.claims,
      grossLoss: d.grossLoss,
      expectedGrossLossAdded: 0,
    });
  }
  // By size, then key — never by source, which would group scheduled events.
  return out.sort((a, b) =>
    (b.grossLoss + b.expectedGrossLossAdded) - (a.grossLoss + a.expectedGrossLossAdded) || a.key.localeCompare(b.key));
}

/** The event a claim came from, as a player reads it — or undefined for an ordinary claim. */
export function claimEventLabel(claim: Claim, occurrence?: Occurrence): string | undefined {
  if (claim.shockId !== undefined) {
    // ⚠ THE NAME ALONE, NO REGION (pr/event-wording) — eventLabel.
    return eventLabel(SHOCK_EVENT_LABELS[claim.shockId]?.eventName ?? claim.shockId);
  }
  if (claim.line === 'Property' && claim.tier === CAT_TIER && occurrence?.isCatastrophe) {
    return eventLabel(drawnEventName(occurrence.peril));
  }
  return undefined;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** One sentence, written from what happened. The same template for every event. */
export function eventSentence(ev: YearEvent): string {
  const where = ev.region ? `${ev.name} in the ${ev.region} region` : ev.name;
  const since = ev.sinceYear !== undefined ? ` (in force since year ${ev.sinceYear})` : '';
  const withClaims = ev.lines.filter(l => l.claims > 0);
  const expected = ev.lines.filter(l => l.expectedGrossLossAdded > 0);
  // Lines it raised with no claim of its own — the new engine's A uplift.
  const raised = ev.lines.filter(l => l.claims === 0 && l.grossLoss > 0);
  const parts: string[] = [];
  if (withClaims.length === 1) {
    const l = withClaims[0];
    parts.push(`${plural(l.claims, `${LINE_FULL_NAME[l.line]} claim`)} totalling ${usd(l.grossLoss)}`);
  } else if (withClaims.length > 1) {
    const total = withClaims.reduce((t, l) => t + l.claims, 0);
    const gross = withClaims.reduce((t, l) => t + l.grossLoss, 0);
    const split = withClaims.map(l => `${l.claims} ${LINE_FULL_NAME[l.line]} (${usd(l.grossLoss)})`);
    parts.push(`${plural(total, 'claim')} totalling ${usd(gross)}: ${split.slice(0, -1).join(', ')} and ${split[split.length - 1]}`);
  }
  for (const l of raised) {
    parts.push(`${LINE_FULL_NAME[l.line]} losses up ${usd(l.grossLoss)}`);
  }
  for (const l of expected) {
    parts.push(`expected ${LINE_FULL_NAME[l.line]} losses up ${usd(l.expectedGrossLossAdded)}`);
  }
  return `${where}${since}: ${parts.join('; ')}.`;
}

// ============================================================================
// THE NEWS — what a player is told the moment a year in which an event began
// is played. The event's player name, one plain sentence of what happened, and
// which of the team's own lines it touched: NOTHING ELSE. No region, no size,
// no level, no dollars, no duration — those are in the year's results, which
// show at the same time (utils/knownYears), or are the host's. The line list
// is the team's: a result carries only the lines its team writes, so a hosted
// team never learns another's.
//
// ⚠ ONE DESCRIPTION PER EVENT NAME, AND IT IS THE PLAYER'S NAME, so a scheduled
// earthquake and a drawn one read identically (the rule at the head of this
// file). Written to say what happened, never how bad: nothing here may hint at
// a band or a level.
//
// ⚠ THE WORDING IS THE BOARD'S, VERBATIM (pr/event-wording). One sentence per
// event; no region anywhere in the news (the name carries none, the sentence
// names none — the engine still places a regional event's large claim in the
// region it draws); no figure; no duration; no extra line on older claims or
// on what to expect. The banner's "Your lines affected" line stays.
//
// ⚠ EVERY EVENT IS NEWS (pr/shock-events-display). Investment Loss and Member
// Withdrawal act off the shock map — on the returns, and on next year's book —
// so they put no claim, loss or expected loss on a line and yearEvents drops
// them; they are read from the year's records in the year they fire. An event
// is listed once, in the year it fires: no later-year note while an effect is
// in force, which would tell players when it ends. Hosts keep the full details
// (the schedule, Charts' Events key).
// ============================================================================

/**
 * WHAT EACH EVENT DOES, IN A PLAYER'S WORDS — by the player's name. The board's
 * wording, verbatim; no region, figure or duration.
 */
export const EVENT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'Earthquake': 'A major earthquake strikes, damaging buildings and injuring people at work.',
  'Winterstorm': 'A severe winter storm brings heavy rain, snow and flooding.',
  'Wildfire': 'A wildfire spreads, burning buildings and land.',
  'Legislation Change': 'A new law widens what injured parties can recover, on both new and existing claims.',
  'Workers Compensation Legislation: Increased Medical Fee Schedule':
    'The state raises the medical fee schedule, so treating injured workers costs more.',
  'Economic Recession': 'A recession takes hold, and members and their workforces feel the strain.',
  'Nuclear Verdict': 'A jury returns an exceptionally large award in a liability lawsuit.',
  'Social Inflation': 'Juries and claimants push liability awards and settlements higher.',
  'Pandemic': 'A pandemic spreads, and illness among workers rises.',
  'Economic Inflation': 'Prices rise quickly, and the cost of settling claims rises with them.',
  'Large Investment Loss': "Financial markets fall sharply, and the pool's invested assets lose value.",
  'Large Member Withdrawal': 'A large member has left the pool.',
  // A drawn property catastrophe that is not an earthquake (none today): named, no region.
  'Catastrophe': 'A natural catastrophe strikes.',
};
/** The description of an event by its player name. */
export function eventDescription(name: string): string {
  return EVENT_DESCRIPTIONS[name] ?? EVENT_DESCRIPTIONS['Catastrophe'];
}
/**
 * The off-map events whose news names no lines: Investment Loss touches the
 * invested assets, which its sentence already says, so the banner has no
 * "Your lines affected" line for it and Events so far no lines in brackets.
 */
const NO_LINES: readonly string[] = ['Investment Loss'];

export interface EventNews {
  /** Stable within the year. Not for display. */
  key: string;
  /** The player's name, "Earthquake" — never a region. */
  label: string;
  description: string;
  /** The team's own lines the event touched, in the game's line order. Empty for Investment Loss (NO_LINES): nothing more is said. */
  lines: CoverageLine[];
}

const NEWS_LINE_ORDER: readonly CoverageLine[] = ['WC', 'GL', 'Property'];

/** The catalogue's entry for a record, by its id. */
const catalogueOf = (shockId: string) => SHOCK_EVENTS.find(e => e.id === shockId);

/** The team's lines a pool record reaches: its per-line split (the team's own lines), else what it lists. */
const recordLines = (rec: ShockRecord): CoverageLine[] => {
  const have = rec.byLine ? (Object.keys(rec.byLine) as CoverageLine[]) : rec.linesAffected;
  return NEWS_LINE_ORDER.filter(l => have.includes(l));
};



/**
 * EACH EVENT AS NEWS, IN THE FIRST YEAR IT TOUCHES THE TEAM: played years
 * (yearNumber >= 1) in order -> the events new that year. No later-year note
 * for an effect still in force: that would tell the player when it ends
 * (pr/shock-events-display). An event
 * is its key and the year it began (`sinceYear`, or the year itself), so one
 * that is still in force is not repeated, a second firing of the same event is
 * news again, and one whose effect starts a year late is told the first year
 * it has one. A line counts as touched when the event put a claim, a loss or
 * an expected loss on it; an event that acts off the map (Investment Loss,
 * Member Withdrawal) is news in the year it fires, on the lines its record
 * reaches.
 */
export function eventNewsByYear(results: readonly AnyResult[]): Map<number, EventNews[]> {
  const out = new Map<number, EventNews[]>();
  const seen = new Set<string>();
  for (const r of [...results].filter(x => x.yearNumber >= 1).sort((a, b) => a.yearNumber - b.yearNumber)) {
    const news: EventNews[] = [];
    const told = (key: string, name: string, lines: CoverageLine[]) => {
      // ⚠ THE PLAYER'S NAME ALONE — no region (pr/event-wording).
      news.push({ key, label: name, description: eventDescription(name), lines });
    };
    for (const ev of yearEvents(r)) {
      const id = `${ev.key}|${ev.sinceYear ?? r.yearNumber}`;
      if (seen.has(id)) continue;
      const lines = NEWS_LINE_ORDER.filter(l => ev.lines.some(x => x.line === l && (x.claims > 0 || x.grossLoss > 0 || x.expectedGrossLossAdded > 0)));
      if (lines.length === 0) continue;
      seen.add(id);
      told(ev.key, ev.name, lines);
    }
    const recs = r.shockEvents ?? [];
    // The events that act off the map: in the year they fire, on the lines their record reaches.
    for (const rec of recs) {
      const e = catalogueOf(rec.shockId);
      if (!e || rec.yearFired !== r.yearNumber || eventLines(e.name).length > 0 || !POOL_WIDE_EVENTS.includes(e.name)) continue;
      const id = `${rec.shockId}|${rec.yearFired}`;
      if (seen.has(id)) continue;
      const lines = recordLines(rec);
      if (lines.length === 0) continue;
      seen.add(id);
      told(rec.shockId, shockName(rec), NO_LINES.includes(e.name) ? [] : lines);
    }
    out.set(r.yearNumber, news);
  }
  return out;
}
