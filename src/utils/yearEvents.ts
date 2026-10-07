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
import { SHOCK_CATALOG } from '../data/shockCatalog';
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

/** "Earthquake — Central region", or the bare name when the event struck no one region. */
export function eventLabel(name: string, region?: Region): string {
  return region ? `${name} — ${region} region` : name;
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
}

const LINE_ORDER: readonly CoverageLine[] = ['Property', 'WC', 'GL'];

function shockName(rec: { shockId: string; eventName?: string; name: string }): string {
  return rec.eventName ?? SHOCK_CATALOG[rec.shockId]?.eventName ?? rec.name;
}

function shockRegion(rec: { shockId: string; region?: Region }): Region | undefined {
  if (rec.region) return rec.region;
  const def = SHOCK_CATALOG[rec.shockId];
  const struck = def?.effects.find(e => 'region' in e && e.region) as { region?: Region } | undefined;
  return struck?.region;
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
    lines: lines.filter(l => l.claims > 0 || l.expectedGrossLossAdded > 0),
    claims: rec.attributableClaims,
    grossLoss: rec.attributableGrossLoss,
    expectedGrossLossAdded: rec.expectedGrossLossAdded,
  };
}

/** Every event a player should learn about in this year's result, pool or line. */
export function yearEvents(result: AnyResult): YearEvent[] {
  const out: YearEvent[] = [];
  for (const rec of result.shockEvents ?? []) {
    const ev = fromShock(rec, result);
    if (ev.claims > 0 || ev.expectedGrossLossAdded > 0) out.push(ev);
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
    const def = SHOCK_CATALOG[claim.shockId];
    // The region the event struck ON THIS LINE: a GL injection names none.
    const effect = def?.effects.find(e => 'line' in e && e.line === claim.line && 'region' in e && e.region) as
      { region?: Region } | undefined;
    return eventLabel(def?.eventName ?? claim.shockId, effect?.region);
  }
  if (claim.line === 'Property' && claim.tier === CAT_TIER && occurrence?.isCatastrophe) {
    return eventLabel(drawnEventName(occurrence.peril), occurrence.region);
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
  for (const l of expected) {
    parts.push(`expected ${LINE_FULL_NAME[l.line]} losses up ${usd(l.expectedGrossLossAdded)}`);
  }
  return `${where}${since}: ${parts.join('; ')}.`;
}
