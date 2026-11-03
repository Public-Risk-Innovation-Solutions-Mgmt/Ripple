// ============================================================================
// MID-GAME EDITS — the shock schedule and each line's adverse development
// level, changed by the host (or Test player) for the CURRENT year and any
// later year, never a played one (wip/mid-game-edits).
//
// ⚠ SETTINGS ARE KEPT BY YEAR, SO A REPLAY NEVER CHANGES A PLAYED YEAR. A
// hosted team keeps no save: every reload, rejoin on another device and viewer
// rebuilds the game from the room and replays each year. If the room held one
// set of settings, an edit would rewrite every year that set had been in force
// for. So the room keeps what was in force in each year:
//
//   THE SHOCKS    the schedule is already a list of (event, year) entries; an
//                 edit adds or removes entries for editable years only, and
//                 never touches, moves or reorders an entry of a played year.
//   DEVELOPMENT   `developmentLevelsByYear`, year -> each line's level. A year
//                 with no entry reads the setup's `developmentLevels`, so a
//                 room written before this reads its setup for every year.
//   THE SWITCH    whether the game prices for shocks at all (gameShocksOn) was
//                 read off whether the schedule was empty. Adding a shock to a
//                 game set up without any would then flip it for EVERY year on
//                 replay — the opening and every played rate with it — and
//                 removing the last would flip it back. So the switch is pinned
//                 as it stood at setup (`shocksOn`), the first time a game is
//                 edited: a shock added later fires in its year, and pricing and
//                 the covers offered stay as the game began.
//
// ⚠ ONE IMPLEMENTATION OF THE RULES, read by both transports, the server and
// Test player, so the four cannot disagree about what may be changed.
// ============================================================================

import { SHOCK_EVENTS } from './shockLosses';
import type { DevelopmentSetting } from '../data/pricingParameters';
import type { CoverageLine } from '../types/simulation';

export type LevelsByLine = Partial<Record<CoverageLine, DevelopmentSetting>>;

/** One year's settings as the editor shows and sends them. */
export interface YearSettings {
  /** Each played line's level ('Off' is None). */
  developmentLevels: LevelsByLine;
  /** The year's shock events by catalogue id, repeats allowed, in schedule order. */
  shocks: string[];
}

/** One change, as the history records it. */
export interface GameEdit {
  /** Epoch millis. */
  at: number;
  /** Who made it: 'Host' in a room, 'Test player' in a Test player game. */
  by: string;
  yearNumber: number;
  kind: 'shock-added' | 'shock-removed' | 'development';
  shockId?: string;
  line?: CoverageLine;
  from?: DevelopmentSetting;
  to?: DevelopmentSetting;
}

/** What a game's settings are made of — the room's fields, or a Test player game's. */
export interface EditableSettings {
  /** The setup's levels: every year without its own entry reads these. */
  developmentLevels: LevelsByLine;
  developmentLevelsByYear?: Record<string, LevelsByLine>;
  shocks: { shockId: string; yearNumber: number }[];
}

const isSetting = (v: unknown): v is DevelopmentSetting => v === 'Low' || v === 'Mid' || v === 'High' || v === 'Off';

/** The level in force on a line in a year: the year's own, else the setup's. Absent reads the setup's absence. */
export function levelInForce(s: Pick<EditableSettings, 'developmentLevels' | 'developmentLevelsByYear'>, line: CoverageLine, yearNumber: number): DevelopmentSetting | undefined {
  return s.developmentLevelsByYear?.[String(yearNumber)]?.[line] ?? s.developmentLevels?.[line];
}

/** A year's settings as they stand. */
export function settingsForYear(s: EditableSettings, lines: readonly CoverageLine[], yearNumber: number): YearSettings {
  const developmentLevels: LevelsByLine = {};
  for (const l of lines) {
    const v = levelInForce(s, l, yearNumber);
    if (v !== undefined) developmentLevels[l] = v;
  }
  return { developmentLevels, shocks: s.shocks.filter(x => x.yearNumber === yearNumber).map(x => x.shockId) };
}

export class GameEditError extends Error {}

/**
 * APPLY AN EDIT: `years` gives the wanted settings for some editable years
 * (absent years are untouched). Refuses a year before `firstEditable` or past
 * `yearCount`, an unknown event or level, and a line the game does not play.
 * Returns the new settings and the history entries for what actually changed —
 * none when nothing did. Never touches a played year's entry.
 */
export function applyGameEdit(
  current: EditableSettings,
  years: Record<string, YearSettings>,
  opts: { firstEditable: number; yearCount: number; lines: readonly CoverageLine[]; by: string; now: number },
): { settings: EditableSettings; edits: GameEdit[] } {
  const { firstEditable, yearCount, lines, by, now } = opts;
  if (firstEditable > yearCount) throw new GameEditError('The game is over: no year is left to change.');
  const byYear: Record<string, LevelsByLine> = Object.fromEntries(
    Object.entries(current.developmentLevelsByYear ?? {}).map(([y, v]) => [y, { ...v }]));
  let shocks = current.shocks.map(s => ({ shockId: s.shockId, yearNumber: s.yearNumber }));
  const edits: GameEdit[] = [];
  const ids = new Set(SHOCK_EVENTS.map(e => e.id));
  const years_ = Object.keys(years).map(Number).sort((a, b) => a - b);
  for (const y of years_) {
    if (!Number.isInteger(y)) throw new GameEditError(`"${y}" is not a year.`);
    if (y < firstEditable) throw new GameEditError(`Year ${y} has been played and cannot be changed.`);
    if (y > yearCount) throw new GameEditError(`Year ${y} is past the game's last year, ${yearCount}.`);
    const want = years[String(y)];
    if (!want || typeof want !== 'object' || !Array.isArray(want.shocks) || typeof want.developmentLevels !== 'object' || want.developmentLevels === null) {
      throw new GameEditError(`Year ${y}'s settings are malformed.`);
    }
    // ---- development: each played line's level in force this year
    for (const [l, v] of Object.entries(want.developmentLevels)) {
      if (!lines.includes(l as CoverageLine)) throw new GameEditError(`${l} is not a line this game plays.`);
      if (!isSetting(v)) throw new GameEditError(`"${String(v)}" is not a development level.`);
      const line = l as CoverageLine;
      const was = levelInForce({ developmentLevels: current.developmentLevels, developmentLevelsByYear: byYear }, line, y);
      if (was === v) continue;
      byYear[String(y)] = { ...(byYear[String(y)] ?? {}), [line]: v };
      edits.push({ at: now, by, yearNumber: y, kind: 'development', line, ...(was !== undefined ? { from: was } : {}), to: v });
    }
    // ---- shocks: the year's entries, as a multiset, made equal to the wanted list
    for (const id of want.shocks) if (typeof id !== 'string' || !ids.has(id)) throw new GameEditError(`"${String(id)}" is not one of the shock events.`);
    const have = shocks.filter(s => s.yearNumber === y).map(s => s.shockId);
    const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
    const h = count(have), w = count(want.shocks);
    for (const [id, n] of h) {
      // Remove the year's LAST entries of this event first, so an earlier one keeps its place.
      for (let k = 0; k < n - (w.get(id) ?? 0); k++) {
        let idx = -1;
        shocks.forEach((s, i) => { if (s.yearNumber === y && s.shockId === id) idx = i; });
        shocks = shocks.filter((_, i) => i !== idx);
        edits.push({ at: now, by, yearNumber: y, kind: 'shock-removed', shockId: id });
      }
    }
    for (const [id, n] of w) {
      for (let k = 0; k < n - (h.get(id) ?? 0); k++) {
        shocks.push({ shockId: id, yearNumber: y });
        edits.push({ at: now, by, yearNumber: y, kind: 'shock-added', shockId: id });
      }
    }
  }
  return {
    settings: {
      developmentLevels: { ...current.developmentLevels },
      ...(Object.keys(byYear).length > 0 ? { developmentLevelsByYear: byYear } : {}),
      shocks,
    },
    edits,
  };
}

/** One history line, as the host and Test player read it. */
export function describeEdit(e: GameEdit, calendarYearOf: (y: number) => number, shockName: (id: string) => string): string {
  const year = calendarYearOf(e.yearNumber);
  const name = (s?: DevelopmentSetting) => (s === 'Off' ? 'None' : s ?? 'default');
  if (e.kind === 'development') return `${e.line} adverse development in ${year}: ${name(e.from)} → ${name(e.to)}`;
  return `${e.kind === 'shock-added' ? 'Added' : 'Removed'} ${shockName(e.shockId ?? '')} in ${year}`;
}
