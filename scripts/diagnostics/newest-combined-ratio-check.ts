// ============================================================================
// THE TOP BAR'S AND THE HOST'S COMBINED RATIO ARE THE STATEMENT'S NEWEST YEAR'S
// (wip/newest-year-combined-ratio) — the gate.
//
//   npx tsx scripts/diagnostics/newest-combined-ratio-check.ts
//
// A solo game on scenario 7, three lines, a hundred worlds, before year 1 and
// after each of three played years. At each:
//
//   1. THE TOP BAR (components/Header, rendered to markup as the app renders
//      it), on the pool and on each line: its one combined-ratio chip reads
//      "Combined ratio <year>" for the year the Annual Statement's newest column
//      shows — the last history year (2026) before year 1, the latest played
//      year after — and its figure is that column's Combined Ratio cell, read
//      here off buildAnnualStatement by column label (not through the header's
//      own reader).
//   2. THE HOST'S TEAMS TABLE (session/screens/HostTeamsTab, rendered to markup
//      on a room holding the team's posted summaries, one per year, built by
//      session/client/results.summarize as a team posts them): its combined-
//      ratio column is headed "Combined ratio <year>" and the team's cell is the
//      same cell, on the pool; each line's posted figure is that line's cell.
//
// ⚠ THE CONTROL: the same comparison fed the CUMULATIVE figure (the statement's
// Total, what both used to show) as if it were on screen must FAIL — and it can
// only fail where the cumulative and the year's own differ, so the gate also
// requires that they differ somewhere among the points it reads.
// ============================================================================

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { buildAnnualStatement, COMBINED_RATIO_LABEL, topCombinedRatio } from '../../src/utils/resultsStatement';
import { summarize } from '../../src/session/client/results';
import { formatPct } from '../../src/utils/formatters';
import type { CoverageLine, GameState, LineView } from '../../src/types/simulation';
import type { RoomView, TeamYearSummary } from '../../src/session/contract';

// ⚠ tsx compiles the app's .tsx with the classic JSX runtime here (the root
// tsconfig sets no jsx), so the components look for a global React. Set before
// they load — hence the dynamic imports.
(globalThis as unknown as { React: typeof React }).React = React;
const { default: Header } = await import('../../src/components/Header');
const { default: HostTeamsTab } = await import('../../src/session/screens/HostTeamsTab');
const { createElement } = React;

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const VIEWS: LineView[] = ['pool', ...LINES];
const START = 2027, YEARS = 3;
const failures: string[] = [];
const check = (problems: string[], label: string, detail = '') => {
  if (problems.length) failures.push(label);
  console.log(`  ${problems.length ? 'FAIL' : 'OK  '}  ${label}${detail ? `  — ${detail}` : ''}`);
  for (const p of problems.slice(0, 6)) console.log(`          ${p}`);
};

/** The statement's Combined Ratio cell in the column for `calendar` — by label, independently of the app's reader. */
function statementCell(gs: GameState, view: LineView, calendar: number): number | undefined {
  const sec = buildAnnualStatement(gs, view).sections.find(s => s.key === 'operating')!;
  const i = sec.columns.indexOf(String(calendar));
  const c = sec.rows.find(r => r.label === COMBINED_RATIO_LABEL)?.cells[i];
  return i >= 0 && c?.kind === 'value' ? c.v : undefined;
}

interface Point {
  tag: string; calendar: number;
  expected: number;             // the statement's cell
  cumulative: number;           // the statement's Total
  headerLabel: string; headerValue: string;  // what the top bar printed
  teams?: { head: string; cell: string };    // what the Teams table printed (pool)
  posted?: number;              // the posted yearCombinedRatio (lines)
}
const points: Point[] = [];

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/\s+/g, ' ');
function readHeader(gs: GameState, view: LineView): { label: string; value: string } {
  const html = renderToStaticMarkup(createElement(Header, {
    gameState: gs, onNewGame: () => {}, onAdvanceYear: () => {}, canAdvance: true, advanceLabel: 'Lock', lineView: view,
  }));
  const m = html.match(/<span[^>]*>([^<]*)<\/span><span data-testid="header-combined-ratio"[^>]*>([^<]*)<\/span>/);
  const chips = (text(html).match(/Combined ratio/gi) ?? []).length;
  if (!m || chips !== 1) return { label: `(${chips} chips)`, value: '' };
  return { label: m[1].trim(), value: m[2].trim() };
}
function readTeams(summaries: Record<string, TeamYearSummary>, y: number): { head: string; cell: string } {
  const room = {
    currentYear: y + 1, yearCount: 10, startingYear: START,
    teams: [{ name: 'Harbour Mutual', lines: LINES, resultsByYear: summaries }],
  } as unknown as RoomView;
  const html = renderToStaticMarkup(createElement(HostTeamsTab, { room }));
  const head = html.match(/data-testid="teams-cr-head"[^>]*>([^<]*)</)?.[1]?.trim() ?? '(none)';
  const cell = html.match(/data-testid="cr-Harbour Mutual"[^>]*>([^<]*)</)?.[1]?.trim() ?? '(none)';
  return { head, cell };
}

// ---- the game ----------------------------------------------------------------
const { setup, instance } = openSoloInstance({ poolName: 'P', gameLength: 10, startingYear: START, instanceId: '7', activeLines: LINES } as never);
const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [],
  currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
const summaries: Record<string, TeamYearSummary> = {};
for (let y = 0; y <= YEARS; y++) {
  if (y > 0) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), LINES)), currentYearNumber: y + 1 };
  }
  // The year the newest column shows: the latest played year, or the last history year (year 0).
  const latest = [...gs.priorHistory, ...gs.lockedResults].at(-1)!;
  const calendar = START + latest.yearNumber - 1;
  summaries[String(latest.yearNumber)] = summarize(latest, gs);
  for (const view of VIEWS) {
    const expected = statementCell(gs, view, calendar);
    const cumulative = topCombinedRatio(buildAnnualStatement(gs, view));
    if (expected === undefined || cumulative === undefined) { failures.push(`y${y} ${view}: no statement cell`); continue; }
    const h = readHeader(gs, view);
    points.push({
      tag: `y${y} ${view}`, calendar, expected, cumulative, headerLabel: h.label, headerValue: h.value,
      ...(view === 'pool' ? { teams: readTeams(summaries, latest.yearNumber) }
        : { posted: summaries[String(latest.yearNumber)].byLine[view]?.yearCombinedRatio }),
    });
  }
}

// ---- the comparison, and its control ----------------------------------------------
/** `shown(p)` is the figure the comparison takes to be the statement's — the year's cell, or (control) the cumulative. */
function compare(shown: (p: Point) => number): { header: string[]; teams: string[] } {
  const header: string[] = [], teams: string[] = [];
  for (const p of points) {
    const want = formatPct(shown(p));
    if (p.headerLabel !== `Combined ratio ${p.calendar}`) header.push(`${p.tag}: chip labelled "${p.headerLabel}", want "Combined ratio ${p.calendar}"`);
    if (p.headerValue !== want) header.push(`${p.tag}: chip ${p.headerValue}, statement ${want}`);
    if (p.teams) {
      if (p.teams.head !== `Combined ratio ${p.calendar}`) teams.push(`${p.tag}: Teams column headed "${p.teams.head}"`);
      if (p.teams.cell !== want) teams.push(`${p.tag}: Teams cell ${p.teams.cell}, statement ${want}`);
    }
    if (p.posted !== undefined || !p.teams) {
      if (p.posted === undefined || Math.abs(p.posted - shown(p)) > 1e-12) teams.push(`${p.tag}: posted ${p.posted}, statement ${shown(p)}`);
    }
  }
  return { header, teams };
}

console.log(`\nnewest-combined-ratio-check: scenario 7, three lines, before year 1 and after years 1-${YEARS}, ${points.length} points`);
const real = compare(p => p.expected);
check(real.header, 'the top bar: "Combined ratio <year>", the statement\'s newest column, pool and each line',
  points.filter(p => p.tag.endsWith('pool')).map(p => `${p.headerLabel} ${p.headerValue}`).join(' · '));
check(real.teams, 'the Teams table: headed with the year, the same cell (pool); each line\'s posted figure the line\'s cell',
  points.filter(p => p.teams).map(p => `${p.teams!.head} ${p.teams!.cell}`).join(' · '));
const differ = points.filter(p => formatPct(p.expected) !== formatPct(p.cumulative));
check(differ.length > 0 ? [] : ['the cumulative equals the year\'s own at every point read — the control could not fire'],
  'the cumulative and the year\'s own differ somewhere', `${differ.length} of ${points.length} points`);
const ctl = compare(p => p.cumulative);
check(ctl.header.length > 0 ? [] : ['the top bar passed against the cumulative'], '  control: the top bar compared with the cumulative fails',
  `${ctl.header.length} problem(s)`);
check(ctl.teams.length > 0 ? [] : ['the Teams table passed against the cumulative'], '  control: the Teams table compared with the cumulative fails',
  `${ctl.teams.length} problem(s)`);

console.log('\n' + '='.repeat(78));
if (failures.length) {
  console.log(`${failures.length} CHECK(S) FAILED:\n  ${failures.join('\n  ')}`);
  console.log('='.repeat(78));
  process.exit(1);
}
console.log('newest-combined-ratio-check: all checks passed');
console.log('='.repeat(78));
