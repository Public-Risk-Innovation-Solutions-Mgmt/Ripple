// ============================================================================
// EVERY EVENT REACHES THE NEWS, IN THE BOARD'S WORDING — the banner, Events so
// far, NO REGION, NO FIGURE, NO DURATION, the one player name and the host's
// one label (pr/shock-events-display, pr/event-wording).
//
//   npx tsx scripts/diagnostics/event-news-coverage-check.ts
//
// Each of the catalogue's twelve events is played alone in year 2 of a
// five-year game, through the engine (processYear), on three lines and on WC
// alone (a hosted team writing one line), and its years are read the way the
// screens read them (utils/yearEvents.eventNewsByYear; the banner is the year's
// items, Events so far every year's):
//
//   1. THE BANNER, in the year it fires, names it by its player name alone (a
//      regional one too: no region) with the board's sentence, word for word
//      (WORDING) and nothing more, on the team's own lines. Investment Loss
//      and Member Withdrawal included: they act off the map.
//   2. EVENTS SO FAR lists it in that year and in no year after — no
//      later-year note for an effect still in force (that would say when it
//      ends).
//   2b. NO REGION, FIGURE OR DURATION: every player string — label and
//      description, in every year, on three lines and on WC alone, and every
//      description the game can show — is scanned for a region (REGION), a
//      figure, and a duration phrase (DURATION). The engine still places a
//      regional event's large claim; hosts keep the full details.
//   3. ON WC ALONE: an event that touches WC or the whole pool is news on WC
//      alone; one that does not is no news.
//   4. ONE NAME: the Year Walkthrough's name for every catalogue key is the
//      player's, the host's label is '#n Name', and the Year Walkthrough gives
//      Investment Loss and Member Withdrawal their rows.
//
// ⚠ THE EXPECTATIONS ARE WRITTEN OUT HERE — the names, the wording, the years —
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
// id -> the board's sentence, word for word: the whole description.
const WORDING: Record<string, string> = {
  '#1': 'A major earthquake strikes, damaging buildings and injuring people at work.',
  '#2': 'A severe winter storm brings heavy rain, snow and flooding.',
  '#3': 'A wildfire spreads, burning buildings and land.',
  '#4': 'A new law widens what injured parties can recover, on both new and existing claims.',
  '#5': 'The state raises the medical fee schedule, so treating injured workers costs more.',
  '#6': 'A recession takes hold, and members and their workforces feel the strain.',
  '#7': 'A jury returns an exceptionally large award in a liability lawsuit.',
  '#8': 'Juries and claimants push liability awards and settlements higher.',
  '#9': 'A pandemic spreads, and illness among workers rises.',
  '#10': 'Prices rise quickly, and the cost of settling claims rises with them.',
  '#11': "Financial markets fall sharply, and the pool's invested assets lose value.",
  '#12': 'A large member has left the pool.',
};
// ⚠ A REGION: the word, or any of the game's four.
const REGION = /\bregion|\b(North|Central|South|East)\b/i;
// ⚠ A FIGURE: a digit, a percent or a dollar.
const FIGURE = /[0-9%$]/;
// ⚠ A DURATION PHRASE: how long an effect lasts, or when it ends. "this year's
// claims" and "this year" (when it happens) are not.
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
    if (n.label !== name) out.push(`${id}: label "${n.label}", wanted "${name}"${regional ? ' (a regional event: no region)' : ''}`);
    if (JSON.stringify(n.lines) !== JSON.stringify(lines)) out.push(`${id}: lines ${n.lines.join(',')}, wanted ${lines.join(',')}`);
    if (id === '#11' && !/invested assets/.test(n.affects ?? '')) out.push(`#11: says it affects "${n.affects}", wanted the invested assets`);
    if (n.description !== WORDING[id]) out.push(`${id}: description "${n.description}", wanted "${WORDING[id]}"`);
    const extra = Object.keys(n).filter(k => !['key', 'label', 'description', 'lines', 'affects'].includes(k));
    if (extra.length) out.push(`${id}: an extra field on the news (${extra.join(', ')})`);
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
    for (const [what, re] of [['duration', DURATION], ['region', REGION], ['figure', FIGURE]] as const) {
      const m = text?.match(re);
      if (m) out.push(`${where}: ${what} "${m[0]}" in "${text}"`);
    }
  };
  for (const [kind, gs] of [['three lines', games], ['WC alone', wcGames]] as const) {
    for (const [id, rs] of gs) {
      for (const { y, n } of panel(newsOf(rs))) {
        for (const [f, t] of [['label', n.label], ['description', n.description]] as const) scan(`${id} ${kind} year ${y} ${f}`, t);
      }
    }
  }
  for (const name of Object.keys(EVENT_DESCRIPTIONS)) scan(`description of ${name}`, eventDescription(name));
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

console.log('1-2. Every event: the banner and Events so far, in the board\'s wording (three lines)');
check(partNews(), 'all twelve reach the banner and Events so far in the year they fire, and no later year');
console.log('2b. No region, figure or duration');
check(partNoDuration(), 'no player text names a region, gives a figure or says how long an event lasts');
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
const descs = EVENT_DESCRIPTIONS as Record<string, string>;
for (const [name, phrase] of [
  ['Economic Recession', ' The effect is felt in this year alone.'],
  ['Pandemic', ' The effect is felt in this year alone.'],
  ['Legislation Change', ' It lasts for the rest of the game.'],
] as const) {
  control(`a duration phrase back in ${name} ("${phrase.trim()}")`, () => {
    const f = descs[name]; descs[name] = f + phrase; return () => { descs[name] = f; };
  }, partNoDuration);
}
control('a region back in the name ("Earthquake — Central region")', () => {
  const real = newsOf;
  newsOf = rs => new Map([...real(rs)].map(([y, ns]) => [y, ns.map(n => (n.label === 'Earthquake' ? { ...n, label: 'Earthquake — Central region' } : n))]));
  return () => { newsOf = real; };
}, partNoDuration);
control('a region back in a description (Wildfire: "lands in the North region")', () => {
  const f = descs['Wildfire']; descs['Wildfire'] = f + ' Its large property claim lands in the North region.'; return () => { descs['Wildfire'] = f; };
}, partNoDuration);
control('a figure back (Member Withdrawal: "25% of each line\'s book")', () => {
  const f = descs['Large Member Withdrawal']; descs['Large Member Withdrawal'] = "Members leave: 25% of each line's book."; return () => { descs['Large Member Withdrawal'] = f; };
}, partNoDuration);
control('an extra line back (Social Inflation: "Older liability claims will also grow.")', () => {
  const f = descs['Social Inflation']; descs['Social Inflation'] = f + ' Older liability claims will also grow.'; return () => { descs['Social Inflation'] = f; };
}, partNews);
control('an extra field back on the news (a "lasting" line on Nuclear Verdict)', () => {
  const real = newsOf;
  newsOf = rs => new Map([...real(rs)].map(([y, ns]) => [y, ns.map(n => (n.label === 'Nuclear Verdict' ? { ...n, lasting: 'It also makes older liability claims grow.' } : n))]));
  return () => { newsOf = real; };
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
