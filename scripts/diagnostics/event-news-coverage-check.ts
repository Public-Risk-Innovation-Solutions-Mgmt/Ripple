// ============================================================================
// EVERY EVENT REACHES THE NEWS — the banner, Events so far, the line on older
// claims, NO DURATION, the one player name and the host's one label
// (pr/shock-events-display).
//
//   npx tsx scripts/diagnostics/event-news-coverage-check.ts
//
// Each of the catalogue's twelve events is played alone in year 2 of a
// five-year game, through the engine (processYear), on three lines and on WC
// alone (a hosted team writing one line), and its years are read the way the
// screens read them (utils/yearEvents.eventNewsByYear; the banner is the year's
// items, Events so far every year's):
//
//   1. THE BANNER, in the year it fires, names it by its player name — and a
//      regional one with its region, saying its large claim lands there and
//      the whole line's costs rise — on the team's own lines. Investment Loss
//      and Member Withdrawal included: they act off the map and used to reach
//      neither.
//   2. EVENTS SO FAR lists it in that year and in no year after — no
//      later-year note for an effect still in force (that would say when it
//      ends). Nuclear Verdict and Social Inflation carry the line on older
//      claims, word for word, with no length; no other event has one.
//      Legislation Change and WC Legislation say older claims will also cost
//      more; Member Withdrawal keeps "from next year".
//   2b. NO DURATION: every player string — label, description, the older-claims
//      line, in every year, on three lines and on WC alone, and every
//      description the game can show — is scanned for a duration phrase
//      (DURATION below). Players are not told how long an event lasts; hosts
//      keep the full details.
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
import { eventDescription, eventNewsByYear, EVENT_DESCRIPTIONS, type EventNews } from '../../src/utils/yearEvents';
import {
  catalogueDisplayName, hostShockLabel, POOL_WIDE_EVENTS, SHOCK_EVENTS, SHOCK_EVENT_LABELS,
} from '../../src/utils/shockLosses';
import { buildYearWalkthrough } from '../../src/utils/yearWalkthrough';
import type { CoverageLine, GameSetupSettings, GameState, Region, ResultSet } from '../../src/types/simulation';

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
// id -> the banner's line on older claims, word for word (no other event has one).
const LASTING: Record<string, string> = {
  '#7': 'It also makes older liability claims grow.',
  '#8': 'Older liability claims will also grow.',
};
// id -> what the description must say (the older-claims effect, with no length).
const SAYS: Record<string, RegExp> = {
  '#4': /older liability claims will also cost more\.$/,
  '#5': /older WC claims will also cost more\.$/,
  '#12': /a quarter of each line's book from next year/,
};
// ⚠ A DURATION PHRASE: how long an effect lasts, or when it ends. "this year's
// claims" and "this year" (when it happens) are not; "from next year" (when
// Member Withdrawal starts) is not.
const DURATION = new RegExp([
  'this year alone', 'this year only', 'in this year', 'rest of the game', 'for (the )?(good|ever)', 'permanent',
  '\\b(one|two|three|four|five|six|seven|eight|nine|ten|\\d+) (more )?years?\\b', 'year \\d+ of \\d+',
  'still (growing|in force)', 'each year', 'every year', 'until', 'no longer', '\\bends?\\b', '\\blasts?\\b', 'temporar',
].join('|'), 'i');
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

// The screens' read, swappable so a control can put a later-year note back.
let newsOf = (rs: ResultSet[]) => eventNewsByYear(rs);
const banner = (news: Map<number, EventNews[]>, y: number) => news.get(y) ?? [];
const panel = (news: Map<number, EventNews[]>) => [...news].flatMap(([y, ns]) => ns.map(n => ({ y, n })));

// ---- 1 + 2. ALL THREE LINES ---------------------------------------------------
function partNews(): string[] {
  const out: string[] = [];
  for (const [id, [name, , regional, lines]] of Object.entries(DESIGN)) {
    const news = newsOf(games.get(id)!);
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
    if (SAYS[id] && !SAYS[id].test(n.description)) out.push(`${id}: "${n.description}", wanted ${SAYS[id]}`);
    if ((n.lasting ?? null) !== (LASTING[id] ?? null)) out.push(`${id}: older-claims line ${n.lasting ? `"${n.lasting}"` : 'absent'}, wanted ${LASTING[id] ? `"${LASTING[id]}"` : 'none'}`);
    const rows = panel(news);
    if (!rows.some(r => r.y === FIRE && r.n.label === n.label)) out.push(`${id}: not in Events so far for ${2025 + FIRE}`);
    const later = rows.filter(r => r.y !== FIRE);
    if (later.length) out.push(`${id}: Events so far has later-year rows (${later.map(r => `${r.y}: ${r.n.label} — ${r.n.description}`).join(' | ')})`);
    if (rows.length !== 1) out.push(`${id}: Events so far has ${rows.length} rows, wanted 1`);
  }
  return out;
}

// ---- 2b. NO DURATION ------------------------------------------------------------
function partNoDuration(): string[] {
  const out: string[] = [];
  const scan = (where: string, text: string | undefined) => {
    const m = text?.match(DURATION);
    if (m) out.push(`${where}: "${m[0]}" in "${text}"`);
  };
  for (const [kind, gs] of [['three lines', games], ['WC alone', wcGames]] as const) {
    for (const [id, rs] of gs) {
      for (const { y, n } of panel(newsOf(rs))) {
        for (const [f, t] of [['label', n.label], ['description', n.description], ['older-claims line', n.lasting]] as const) scan(`${id} ${kind} year ${y} ${f}`, t);
      }
    }
  }
  for (const name of Object.keys(EVENT_DESCRIPTIONS)) for (const r of [undefined, 'Central' as Region]) scan(`description of ${name}`, eventDescription(name, r));
  return out;
}

// ---- 3. WC ALONE ----------------------------------------------------------------
function partWcAlone(): string[] {
  const out: string[] = [];
  for (const [id, [name, , , , wc]] of Object.entries(DESIGN)) {
    const news = newsOf(wcGames.get(id)!);
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

console.log('1-2. Every event: the banner, Events so far, the older-claims line (three lines)');
check(partNews(), 'all twelve reach the banner and Events so far in the year they fire, and no later year');
console.log('2b. No duration');
check(partNoDuration(), 'no player text says how long an event lasts');
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
control('a later-year note put back (Social Inflation, "year 2 of 3")', () => {
  const real = newsOf;
  newsOf = rs => {
    const m = real(rs);
    if (rs.some(r => r.shockEvents?.some(e => e.shockId === '#8'))) {
      m.set(FIRE + 1, [...(m.get(FIRE + 1) ?? []), { key: '#8@2', label: 'Social Inflation', lines: ['GL'],
        description: 'Older liability claims are still growing: year 2 of 3.' }]);
    }
    return m;
  };
  return () => { newsOf = real; };
}, partNews);
const descs = EVENT_DESCRIPTIONS as Record<string, (r?: Region) => string>;
for (const [name, phrase] of [
  ['Economic Recession', ' The effect is felt in this year alone.'],
  ['Pandemic', ' The effect is felt in this year alone.'],
  ['Legislation Change', ' It lasts for the rest of the game.'],
] as const) {
  control(`a duration phrase back in ${name} ("${phrase.trim()}")`, () => {
    const f = descs[name]; descs[name] = r => f(r) + phrase; return () => { descs[name] = f; };
  }, partNoDuration);
}
control('a duration back on the older-claims line ("for three years")', () => {
  const real = newsOf;
  newsOf = rs => new Map([...real(rs)].map(([y, ns]) => [y, ns.map(n => (n.lasting ? { ...n, lasting: n.lasting.replace(/\.$/, ' for three years.') } : n))]));
  return () => { newsOf = real; };
}, partNoDuration);
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
