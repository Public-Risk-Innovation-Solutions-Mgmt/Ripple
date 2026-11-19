// ============================================================================
// EVERY EVENT REACHES THE NEWS — the banner, Events so far, the lasting notes,
// the one player name and the host's one label (pr/shock-events-display).
//
//   npx tsx scripts/diagnostics/event-news-coverage-check.ts
//
// Each of the catalogue's twelve events is played alone in year 2 of a
// five-year game, through the engine (processYear), on three lines and on WC
// alone (a hosted team writing one line), and its years are read the way the
// screens read them (utils/yearEvents.eventNewsByYear; the banner is the year's
// items that are not `continuing`, Events so far all of them):
//
//   1. THE BANNER, in the year it fires, names it by its player name — and a
//      regional one with its region, saying its large claim lands there and
//      the whole line's costs rise — on the team's own lines. Investment Loss
//      and Member Withdrawal included: they act off the map and used to reach
//      neither.
//   2. EVENTS SO FAR lists it in that year, and no year after unless its
//      effect lasts: Social Inflation has a note in years 3 and 4 (its three
//      years in force), Nuclear Verdict none (one year); both have the
//      banner's lasting line. No other event has either.
//   3. ON WC ALONE: an event that touches WC or the whole pool is news on WC
//      alone; one that does not is no news.
//   4. ONE NAME: the Year Walkthrough's name for every catalogue key is the
//      player's, the host's label is '#n Name', and the Year Walkthrough gives
//      Investment Loss and Member Withdrawal their rows.
//
// ⚠ THE EXPECTATIONS ARE WRITTEN OUT HERE — the names, the years, the notes —
// not read from the code they grade. Each part has a CONTROL that breaks it at
// runtime, asserts the part now FAILS, and restores it.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import { seedFromInstanceId } from '../../src/seedHash';
import { eventNewsByYear, type EventNews } from '../../src/utils/yearEvents';
import {
  catalogueDisplayName, hostShockLabel, POOL_WIDE_EVENTS, SHOCK_EVENTS, SHOCK_EVENT_LABELS,
} from '../../src/utils/shockLosses';
import { buildYearWalkthrough } from '../../src/utils/yearWalkthrough';
import type { CoverageLine, GameSetupSettings, GameState, ResultSet } from '../../src/types/simulation';

// ---- THE DESIGN, WRITTEN OUT ------------------------------------------------
// id -> [player name, host name, regional, lines it touches (all three lines in play), WC alone touched?]
const DESIGN: Record<string, [string, string, boolean, CoverageLine[], boolean]> = {
  '#1': ['Earthquake', 'Earthquake', true, ['WC', 'GL', 'Property'], true],
  '#2': ['Winterstorm', 'Winterstorm/Rainstorm', true, ['Property'], false],
  '#3': ['Wildfire', 'Wildfire', true, ['Property'], false],
  '#4': ['Legislation Change', 'Legislation Change impacting both old and new claims', false, ['GL'], false],
  '#5': ['Workers Compensation Legislation: Increased Medical Fee Schedule', 'Workers Comp Legislation', false, ['WC'], true],
  '#6': ['Economic Recession', 'Economic Recession', false, ['WC', 'GL'], true],
  '#7': ['Nuclear Verdict', 'Nuclear Verdict', false, ['GL'], false],
  '#8': ['Social Inflation', 'Social Inflation (GL)', false, ['GL'], false],
  '#9': ['Pandemic', 'Pandemic', false, ['WC', 'GL'], true],
  '#10': ['Economic Inflation', 'Economic Inflation', false, ['WC', 'GL', 'Property'], true],
  '#11': ['Large Investment Loss', 'Large Investment Loss', false, [], true],
  '#12': ['Large Member Withdrawal', 'Large Member Withdrawal', false, ['WC', 'GL', 'Property'], true],
};
// id -> the years (of five, fired in 2) Events so far carries a lasting note in.
const NOTES: Record<string, number[]> = { '#8': [3, 4] };
// id -> the banner carries a lasting line.
const LASTING = new Set(['#7', '#8']);
const FIRE = 2, YEARS = 5;

const failures: string[] = [];
const check = (problems: string[], label: string) => {
  if (problems.length) failures.push(label);
  console.log(`  ${problems.length ? 'FAIL' : 'OK  '}  ${label}`);
  for (const p of problems.slice(0, 6)) console.log(`          ${p}`);
};
const control = (label: string, breakIt: () => () => void, part: () => string[]) => {
  const restore = breakIt();
  let caught: string[];
  try { caught = part(); } finally { restore(); }
  const ok = caught.length > 0;
  if (!ok) failures.push(`control: ${label}`);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  control — ${label}: ${ok ? `caught (${caught[0]})` : 'NOT caught'}`);
};

function play(id: string, lines: CoverageLine[], years = YEARS): GameState {
  const iid = `NEWS${id.slice(1)}${lines.join('')}`;
  const setup = { poolName: 'N', gameLength: 10, startingYear: 2026, instanceId: iid, activeLines: lines, shockTiming: 'host' } as unknown as GameSetupSettings;
  const instance = generateGameInstance(iid, seedFromInstanceId(iid), [{ shockId: id, yearNumber: FIRE }]);
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  let gs = { setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory } as GameState;
  for (let y = 1; y <= years; y++) {
    const r = processYear(gs, defaultDecisionSet(y));
    gs = { ...gs, currentYearNumber: y + 1, poolState: r.updatedPoolState, lockedResults: [...gs.lockedResults, r.result] };
  }
  return gs;
}

const ALL: CoverageLine[] = ['WC', 'GL', 'Property'];
const games = new Map<string, ResultSet[]>();
const wcGames = new Map<string, ResultSet[]>();
for (const id of Object.keys(DESIGN)) {
  games.set(id, play(id, ALL).lockedResults);
  wcGames.set(id, play(id, ['WC']).lockedResults);
}

const banner = (news: Map<number, EventNews[]>, y: number) => (news.get(y) ?? []).filter(n => !n.continuing);
const panel = (news: Map<number, EventNews[]>) => [...news].flatMap(([y, ns]) => ns.map(n => ({ y, n })));

// ---- 1 + 2. ALL THREE LINES ---------------------------------------------------
function partNews(): string[] {
  const out: string[] = [];
  for (const [id, [name, , regional, lines]] of Object.entries(DESIGN)) {
    const news = eventNewsByYear(games.get(id)!);
    const b = banner(news, FIRE).filter(n => n.label.startsWith(name));
    if (b.length !== 1) { out.push(`${id}: the ${2025 + FIRE} banner has ${b.length} items named "${name}" (${banner(news, FIRE).map(n => n.label).join(' | ')})`); continue; }
    const n = b[0];
    for (let y = 1; y <= YEARS; y++) if (y !== FIRE && banner(news, y).length) out.push(`${id}: a banner in year ${y} (${banner(news, y).map(x => x.label).join(' | ')})`);
    if (regional) {
      const region = n.label.match(/— (\w+) region$/)?.[1];
      if (!region) out.push(`${id}: the label names no region ("${n.label}")`);
      else if (!n.description.includes(`lands in the ${region} region`) || !n.description.includes('whole')) {
        out.push(`${id}: the description does not say the claim lands in ${region} and the whole line's costs rise ("${n.description}")`);
      }
    } else if (n.label !== name) out.push(`${id}: label "${n.label}", wanted "${name}"`);
    if (JSON.stringify(n.lines) !== JSON.stringify(lines)) out.push(`${id}: lines ${n.lines.join(',')}, wanted ${lines.join(',')}`);
    if (id === '#11' && !/invested assets/.test(n.affects ?? '')) out.push(`#11: says it affects "${n.affects}", wanted the invested assets`);
    if (id === '#11' && !/investment returns fall sharply this year/i.test(n.description)) out.push(`#11: "${n.description}"`);
    if (id === '#12' && !/a quarter of each line's book from next year/.test(n.description)) out.push(`#12: "${n.description}"`);
    if (id === '#9' && !/liability claim/.test(n.description)) out.push(`#9: no liability claim in "${n.description}"`);
    if ((id === '#6' || id === '#9') && !/this year alone/.test(n.description)) out.push(`${id}: does not say it acts in one year ("${n.description}")`);
    if (LASTING.has(id) !== !!n.lasting) out.push(`${id}: lasting line ${n.lasting ? `"${n.lasting}"` : 'absent'}, wanted ${LASTING.has(id) ? 'one' : 'none'}`);
    if (id === '#8' && !/three years/.test(n.lasting ?? '')) out.push(`#8: lasting "${n.lasting}", wanted three years`);
    if (id === '#7' && !/this year only/.test(n.lasting ?? '')) out.push(`#7: lasting "${n.lasting}", wanted this year only`);
    const rows = panel(news);
    if (!rows.some(r => r.y === FIRE && !r.n.continuing && r.n.label === n.label)) out.push(`${id}: not in Events so far for ${2025 + FIRE}`);
    const notes = rows.filter(r => r.n.continuing).map(r => r.y);
    const want = NOTES[id] ?? [];
    if (JSON.stringify(notes) !== JSON.stringify(want)) out.push(`${id}: Events so far notes in years [${notes}], wanted [${want}]`);
    for (const r of rows.filter(x => x.n.continuing)) {
      if (r.n.continuing!.sinceYear !== FIRE || !/still growing/.test(r.n.description)) out.push(`${id}: note "${r.n.description}" since ${r.n.continuing!.sinceYear}`);
    }
    if (rows.length !== 1 + want.length) out.push(`${id}: Events so far has ${rows.length} rows, wanted ${1 + want.length}`);
  }
  return out;
}

// ---- 3. WC ALONE ----------------------------------------------------------------
function partWcAlone(): string[] {
  const out: string[] = [];
  for (const [id, [name, , , , wc]] of Object.entries(DESIGN)) {
    const news = eventNewsByYear(wcGames.get(id)!);
    const b = banner(news, FIRE).filter(n => n.label.startsWith(name));
    if (wc && b.length !== 1) out.push(`${id}: WC alone, no banner for "${name}"`);
    if (!wc && panel(news).length) out.push(`${id}: WC alone, news for an event that does not touch WC (${panel(news).map(r => r.n.label).join(' | ')})`);
    for (const n of b) if (n.lines.some(l => l !== 'WC')) out.push(`${id}: WC alone, lines ${n.lines}`);
  }
  return out;
}

// ---- 4. ONE NAME ---------------------------------------------------------------
function partNames(): string[] {
  const out: string[] = [];
  for (const e of SHOCK_EVENTS) {
    const [name, host] = DESIGN[e.id];
    if (catalogueDisplayName(e.name) !== name) out.push(`${e.id} key "${e.name}": walkthrough name "${catalogueDisplayName(e.name)}", wanted "${name}"`);
    if (SHOCK_EVENT_LABELS[e.id].eventName !== name) out.push(`${e.id}: player name "${SHOCK_EVENT_LABELS[e.id].eventName}", wanted "${name}"`);
    if (hostShockLabel(e.id) !== `${e.id} ${host}`) out.push(`${e.id}: host label "${hostShockLabel(e.id)}", wanted "${e.id} ${host}"`);
  }
  return out;
}
const walkGame = play('#11', ALL, FIRE);
const withdrawGame = play('#12', ALL, FIRE);
function partWalkthrough(): string[] {
  const out: string[] = [];
  for (const [gs, name] of [[walkGame, 'Large Investment Loss'], [withdrawGame, 'Large Member Withdrawal']] as const) {
    const w = buildYearWalkthrough(gs, FIRE, 'WC');
    const labels = w.stages.flatMap(st => ((st as unknown as { rows?: { label: string }[] }).rows ?? []).map(r => r.label));
    if (!labels.some(l => l === `${name}: level`)) out.push(`the Year Walkthrough has no "${name}: level" row`);
  }
  return out;
}

console.log('1-2. Every event: the banner, Events so far, the lasting notes (three lines)');
check(partNews(), 'all twelve reach the banner and Events so far, as written out');
console.log('3. A team writing WC alone');
check(partWcAlone(), 'an event is news on WC alone exactly when it touches WC or the pool');
console.log('4. One name');
check(partNames(), "every catalogue key reads the player's name; the host's label is '#n Name'");
check(partWalkthrough(), 'the Year Walkthrough gives Investment Loss and Member Withdrawal rows');

console.log('Controls');
const pool = POOL_WIDE_EVENTS as string[];
control('Investment Loss off the pool-wide list (the off-map read)', () => {
  const i = pool.indexOf('Investment Loss'); pool.splice(i, 1); return () => { pool.splice(i, 0, 'Investment Loss'); };
}, partNews);
control("Social Inflation's catalogue duration 1 (no later notes)", () => {
  const e = SHOCK_EVENTS.find(x => x.id === '#8') as { duration: number };
  const d = e.duration; e.duration = 1; return () => { e.duration = d; };
}, partNews);
control("#11's player name put back to the catalogue key", () => {
  const l = SHOCK_EVENT_LABELS['#11'] as { eventName: string };
  const n = l.eventName; l.eventName = 'Investment Loss'; return () => { l.eventName = n; };
}, partNames);
control('the Year Walkthrough reading the old list (player names against keys)', () => {
  const saved = [...pool]; pool.splice(0, pool.length, 'Economic Inflation', 'Large Investment Loss', 'Large Member Withdrawal');
  return () => { pool.splice(0, pool.length, ...saved); };
}, partWalkthrough);

console.log(failures.length ? `\nFAILED: ${failures.join('; ')}` : '\nALL OK');
process.exit(failures.length ? 1 : 0);
