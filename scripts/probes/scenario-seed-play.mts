// ============================================================================
// SLOT 20'S NEW SEED — PLAYING THE CANDIDATES (pr/named-scenarios). Stage 2 of 2.
//
//   npx tsx scripts/probes/scenario-seed-play.mts <candidates.jsonl> [from] [to]
//
// Each candidate from stage 1 (scenario-seed-search.mts: within 5% of slot 20's
// targets on every line) played ten years at the play defaults, as the slots
// were (SCENARIO_SEEDS' header):
//
//   SINGLE PLAYER  the seed's own catalogue shocks (single player's), no
//                  adverse development (single player has none).
//   HOSTED ROOM    adverse development Low on every line, and the schedule a
//                  room on slot 20 draws (drawShockSchedule on the room's seed,
//                  "20" — the same for every candidate, as in the game).
//
// Recorded per candidate, one JSON line:
//   y1RateDrop   a line whose 2027 rate (year 1's rateChange) falls, either mode — DISQUALIFIES
//   belowZero    a line whose ending surplus goes below zero, any year, either mode — DISQUALIFIES
//   soloShocks   events drawn in single player's ten years (the slots were chosen with at least two)
//   crSpread     the standard deviation of the pool's yearly combined ratio, each mode, averaged
//   longRuns     single player's runs of combined ratio over 100% longer than three years
//   maxDrop      the largest one-year fall in the pool's surplus, over its opening, either mode
//   score        100 x crSpread + 20 x maxDrop + 2 x longRuns — LOWER IS STEADIER. This branch's
//                composite of the same four measures the slots were scored on; the original
//                weighting was not kept in the repository, so the components are printed too.
// ============================================================================
import { readFileSync } from 'node:fs';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { buildTeamGame, replayTeamYears } from '../../src/session/client/buildGame';
import { summarize } from '../../src/session/client/results';
import { drawShockSchedule } from '../../src/session/shockDraw';
import type { RoomView, TeamYearSummary } from '../../src/session/contract';
import type { CoverageLine, GameSetupSettings, GameState } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = 10;

function solo(id: string): { years: TeamYearSummary[]; opening: number; shocks: number } {
  const { setup, instance } = openSoloInstance({ poolName: 'S', gameLength: YEARS, startingYear: 2027, instanceId: id, activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory } as GameState);
  const opening = LINES.reduce((a, l) => a + poolState.lines[l].surplus, 0);
  const years: TeamYearSummary[] = [];
  for (let y = 1; y <= YEARS; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, defaultDecisionSet(y)), [])), currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
    years.push(summarize(gs.lockedResults[y - 1], gs));
  }
  return { years, opening, shocks: (instance.scheduledShocks ?? []).filter(s => s.yearNumber <= YEARS).length };
}

function hosted(id: string): { years: TeamYearSummary[]; opening: number } {
  const room = {
    seed: id, yearCount: YEARS, startingYear: 2027, eventName: 'E', poolName: 'P', priorDevelopment: {},
    shocks: drawShockSchedule('20', YEARS), developmentLevels: { WC: 'Low', GL: 'Low', Property: 'Low' },
  } as unknown as RoomView;
  const built = buildTeamGame(room, LINES);
  const opening = LINES.reduce((a, l) => a + built.gameState.poolState.lines[l].surplus, 0);
  const r = replayTeamYears(built.gameState, YEARS + 1, undefined);
  return { years: r.produced.map(p => summarize(p.result, p.gameState, p.surplusRange)), opening };
}

const sd = (xs: number[]) => { const m = xs.reduce((a, x) => a + x, 0) / xs.length; return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length); };

const [file, from, to] = process.argv.slice(2);
const cands = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).slice(Number(from ?? 0), to ? Number(to) : undefined);
for (const c of cands) {
  const id = String(c.seed);
  const s = solo(id), h = hosted(id);
  const modes = [s, h];
  const y1RateDrop = modes.some(m => LINES.some(l => (m.years[0].byLine?.[l]?.rateChange ?? 0) < 0));
  const belowZero = modes.some(m => m.years.some(y => LINES.some(l => (y.byLine?.[l]?.endingSurplus ?? 0) < 0)));
  const crSpread = (sd(s.years.map(y => y.pool.yearCombinedRatio ?? 0)) + sd(h.years.map(y => y.pool.yearCombinedRatio ?? 0))) / 2;
  let longRuns = 0, run = 0;
  for (const y of s.years) { if ((y.pool.yearCombinedRatio ?? 0) > 1) run++; else { if (run > 3) longRuns++; run = 0; } }
  if (run > 3) longRuns++;
  const maxDrop = Math.max(...modes.map(m => {
    let worst = 0, prev = m.opening;
    for (const y of m.years) { worst = Math.max(worst, (prev - y.pool.endingSurplus) / m.opening); prev = y.pool.endingSurplus; }
    return worst;
  }));
  const score = 100 * crSpread + 20 * maxDrop + 2 * longRuns;
  console.log(JSON.stringify({
    seed: c.seed, ps: c.ps, worst: c.worst, y1RateDrop, belowZero, soloShocks: s.shocks, crSpread, longRuns, maxDrop, score,
    y1RateChange: Object.fromEntries(LINES.map(l => [l, [s.years[0].byLine?.[l]?.rateChange, h.years[0].byLine?.[l]?.rateChange]])),
    surplus: { solo: s.years.map(y => Math.round(y.pool.endingSurplus)), hosted: h.years.map(y => Math.round(y.pool.endingSurplus)), opening: [Math.round(s.opening), Math.round(h.opening)] },
    cr: { solo: s.years.map(y => y.pool.yearCombinedRatio), hosted: h.years.map(y => y.pool.yearCombinedRatio) },
  }));
}
