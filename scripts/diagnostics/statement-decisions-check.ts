// ============================================================================
// THE ANNUAL STATEMENT'S DECISIONS SECTION IS WHAT THE GAME RECORDED — A GATE
// (pr/statement-decisions).
//
//   npx tsx scripts/diagnostics/statement-decisions-check.ts
//
// A game played on decisions that change every year — funding (a stop, then
// Expected), Non-Renewal, New Members, each cover, risk control, a dividend and
// an assessment, the asset mix — and buildDecisionsTable read against the
// RECORDED decisions directly (each year's ResultSet: byLine[line].decisions
// and pool), not against what the table's own formatter would say:
//
//   1. THE COLUMNS ARE THE STATEMENT'S: Prior and the five years, the same
//      calendar years, for the pool and every line, at the start (the history
//      years alone — the prior board's decisions) and after five years.
//   2. EVERY CELL IS ITS YEAR'S RECORD: each decision, each year, each scope,
//      read from the raw recorded fields and compared to the cell; Prior blank.
//   3. THE POOL SHOWS THE ASSET MIX AND EACH LINE'S DECISIONS; a line shows its
//      own alone.
//   4. THE PLAYED DECISIONS REACH IT: what this script chose for year 3 is what
//      year 3's cells say (so 2 is not a table agreeing with an empty record).
//
// ⚠ AND IT FAILS WHEN BROKEN — controls: a table built one year off (each
// column reading the year before's record), a line's decisions read from
// another line, and the dividend's sign flipped.
// ============================================================================
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { buildTemplateStatement } from '../../src/utils/annualStatementTemplate';
import { buildDecisionsTable, type DecisionsTable } from '../../src/utils/statementDecisions';
import { AGGREGATE_COVER_OPTIONS } from '../../src/data/pricingParameters';
import type { CoverageLine, DecisionSet, GameSetupSettings, GameState, LineView, ResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const YEARS = 5;
const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};

/** The per-claim covers: each id is the cover's name ("$9M xs $1M"). */
const STOPS = ['none', '$9M xs $1M', '$19M xs $1M', '$18M xs $2M'];
const AGGS = ['none', 'agg-110-50', 'agg-125-50', 'agg-150-50'];
/** Year y's decisions: every one different from the year before's, and from line to line. */
function decide(y: number): DecisionSet {
  const d = defaultDecisionSet(y);
  LINES.forEach((l, k) => {
    const x = d.byLine[l];
    d.byLine[l] = {
      ...x,
      fundingConfidenceLevel: 0.55 + 0.05 * ((y + k) % 5),
      fundingAtExpected: (y + k) % 4 === 0,
      nonRenewal: 0.01 * ((y + k) % 6),
      newMembers: 0.01 * ((y + 2 * k) % 7),
      reinsuranceOption: STOPS[(y + k) % 4],
      aggregateCover: AGGS[(y + 2 * k) % 4],
      riskControlIncentivePct: 0.01 * ((y + k) % 6),
      dividendAmount: (y + k) % 3 === 1 ? 1_000_000 : 0,
      assessmentAmount: (y + k) % 3 === 2 ? 2_000_000 : 0,
    };
  });
  d.assetAllocation = { cashPct: 10 + y, bondsPct: 80 - 2 * y, equitiesPct: 10 + y };
  return d;
}

function play(): GameState[] {
  const { setup, instance } = openSoloInstance({ poolName: 'S', gameLength: YEARS, startingYear: 2027, instanceId: '1', activeLines: LINES } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  let gs = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory, earlyPreGameHistory });
  const out = [gs];
  for (let y = 1; y <= YEARS; y++) {
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, playWorldsYear(gs, decide(y)), [])), currentYearNumber: y + 1, currentDecisions: defaultDecisionSet(y + 1) };
    out.push(gs);
  }
  return out;
}

// ---- what each cell must read, from the record alone ----
const pct0 = (v: number) => `${Math.round(v * 100)}%`;
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const k$ = (v: number) => { const n = Math.round(v / 1000); return `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')}`; };
const lineExpect: Record<string, (r: ResultSet, l: CoverageLine) => string> = {
  funding: (r, l) => (r.byLine[l].decisions.fundingAtExpected ? 'Expected' : pct0(r.byLine[l].decisions.fundingConfidenceLevel)),
  nonRenewal: (r, l) => pct0(r.byLine[l].decisions.nonRenewal ?? 0),
  newMembers: (r, l) => pct0(r.byLine[l].decisions.newMembers ?? 0),
  perClaimCover: (r, l) => { const id = r.byLine[l].decisions.reinsuranceOption; return id === 'none' ? 'None' : id; },
  aggregateCover: (r, l) => { const id = r.byLine[l].decisions.aggregateCover; return !id || id === 'none' ? 'None' : AGGREGATE_COVER_OPTIONS.find(o => o.id === id)!.name; },
  riskControl: (r, l) => pct1(r.byLine[l].decisions.riskControlIncentivePct ?? 0),
  dividendAssessment: (r, l) => k$((r.byLine[l].decisions.dividendAmount ?? 0) - (r.byLine[l].decisions.assessmentAmount ?? 0)),
};
const poolExpect: Record<string, (r: ResultSet) => string> = {
  cash: r => pct0(r.pool.assetAllocation.cashPct / 100),
  bonds: r => pct0(r.pool.assetAllocation.bondsPct / 100),
  equities: r => pct0(r.pool.assetAllocation.equitiesPct / 100),
};

/** Every way a table differs from the record: columns, rows, cells. */
function diffs(gs: GameState, scope: LineView, t: DecisionsTable): string[] {
  const out: string[] = [];
  const ts = buildTemplateStatement(gs, scope);
  if (JSON.stringify(t.columns) !== JSON.stringify(ts.columns) || JSON.stringify(t.years) !== JSON.stringify(ts.years)) out.push(`columns ${t.columns.join(',')} ≠ the statement's ${ts.columns.join(',')}`);
  const timeline = [...(gs.earlyPreGameHistory ?? []), ...gs.priorHistory, ...gs.lockedResults];
  const rec = ts.years.map(y => timeline.find(r => r.calendarYear === y)!);
  const lines = scope === 'pool' ? gs.setup.activeLines : [scope];
  const wantKeys = [...(scope === 'pool' ? Object.keys(poolExpect).map(k => `pool.${k}`) : []), ...lines.flatMap(l => Object.keys(lineExpect).map(k => `${l}.${k}`))];
  const gotKeys = t.rows.flatMap(r => (r.kind === 'decision' ? [r.key] : []));
  if (JSON.stringify(gotKeys) !== JSON.stringify(wantKeys)) out.push(`rows ${gotKeys.join(',')} ≠ ${wantKeys.join(',')}`);
  for (const r of t.rows) {
    if (r.kind !== 'decision') continue;
    const [who, what] = r.key.split('.');
    if (r.cells[0] !== null) out.push(`${r.key}: Prior "${r.cells[0]?.text}", not blank`);
    rec.forEach((res, k) => {
      const want = who === 'pool' ? poolExpect[what](res) : lineExpect[what](res, who as CoverageLine);
      const got = r.cells[k + 1]?.text;
      if (got !== want) out.push(`${r.key} ${ts.years[k]}: "${got}" ≠ recorded "${want}"`);
    });
  }
  return out;
}

const snaps = play();
const start = snaps[0], end = snaps[YEARS];
console.log('STATEMENT DECISIONS — scenario 1, three lines, five years on decisions that change every year');
for (const [tag, gs] of [['at the start (history years only)', start], [`after ${YEARS} years`, end]] as const) {
  for (const scope of ['pool', ...LINES] as LineView[]) {
    const d = diffs(gs, scope, buildDecisionsTable(gs, buildTemplateStatement(gs, scope)));
    check(d.length === 0, `1-3. ${tag}, ${scope}: the statement's columns, every decision every year from the record, Prior blank`, d.slice(0, 2).join(' · ') || 'every cell');
  }
}
// 4. the played decisions reach the table: year 3's (calendar 2029) WC funding and GL per-claim cover are what was chosen.
{
  const t = buildDecisionsTable(end, buildTemplateStatement(end, 'pool'));
  const col = t.years.indexOf(2029) + 1;
  const cell = (key: string) => t.rows.find(r => r.kind === 'decision' && r.key === key);
  const wc = cell('WC.funding'), gl = cell('GL.perClaimCover'), cash = cell('pool.cash');
  const chose = decide(3);
  const wantWc = chose.byLine.WC.fundingAtExpected ? 'Expected' : pct0(chose.byLine.WC.fundingConfidenceLevel);
  const wantGl = chose.byLine.GL.reinsuranceOption === 'none' ? 'None' : chose.byLine.GL.reinsuranceOption;
  check(wc?.kind === 'decision' && wc.cells[col]?.text === wantWc && gl?.kind === 'decision' && gl.cells[col]?.text === wantGl
    && cash?.kind === 'decision' && cash.cells[col]?.text === `${chose.assetAllocation.cashPct}%`,
    '4. what was chosen for 2029 is what 2029 says: WC\'s funding, GL\'s per-claim cover, the cash share',
    `${wc?.kind === 'decision' ? wc.cells[col]?.text : '?'} / ${gl?.kind === 'decision' ? gl.cells[col]?.text : '?'} / ${cash?.kind === 'decision' ? cash.cells[col]?.text : '?'}`);
  // and at the start every column is a history year, carrying the prior board's decisions, not blanks
  const t0 = buildDecisionsTable(start, buildTemplateStatement(start, 'pool'));
  const hist = t0.years.filter(y => y < 2027).map(y => t0.years.indexOf(y) + 1);
  check(hist.length === t0.years.length && hist.every(c => t0.rows.every(r => r.kind !== 'decision' || (r.cells[c]?.text ?? '') !== '')),
    'at the start, every column is a history year and shows the prior board\'s decisions, every row filled', `${hist.length} of ${t0.years.length} columns: ${t0.years.join(', ')}`);
}

console.log('\nCONTROLS — each must FAIL');
{
  const base = buildDecisionsTable(end, buildTemplateStatement(end, 'pool'));
  // A year off: each column reads the previous column's cells.
  const shifted: DecisionsTable = { ...base, rows: base.rows.map(r => (r.kind === 'decision' ? { ...r, cells: [null, null, ...r.cells.slice(1, -1)] } : r)) };
  check(diffs(end, 'pool', shifted).length > 0, 'control: each column one year off', diffs(end, 'pool', shifted)[0] ?? 'NOTHING FIRED');
  // GL's decisions read from WC.
  const wcRows = base.rows.filter(r => r.kind === 'decision' && r.key.startsWith('WC.'));
  const swapped: DecisionsTable = { ...base, rows: base.rows.map(r => (r.kind === 'decision' && r.key.startsWith('GL.') ? { ...r, cells: (wcRows.find(w => w.kind === 'decision' && w.key.slice(3) === r.key.slice(3)) as typeof r).cells } : r)) };
  check(diffs(end, 'pool', swapped).length > 0, 'control: GL\'s decisions read from WC', diffs(end, 'pool', swapped).find(d => d.startsWith('GL.')) ?? 'NOTHING FIRED');
  // The dividend's sign flipped.
  const flipped: DecisionsTable = { ...base, rows: base.rows.map(r => (r.kind === 'decision' && r.key.endsWith('dividendAssessment')
    ? { ...r, cells: r.cells.map(c => (c && c.value ? { ...c, text: k$(-c.value) } : c)) } : r)) };
  check(diffs(end, 'pool', flipped).length > 0, 'control: the dividend / assessment sign flipped', diffs(end, 'pool', flipped)[0] ?? 'NOTHING FIRED');
}

console.log('');
if (failures.length) { console.log(`${failures.length} CHECK(S) FAILED:\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('PASS — the statement\'s Decisions section is what the game recorded, year by year, the history years included.');
