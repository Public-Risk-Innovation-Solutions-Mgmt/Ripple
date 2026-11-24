// ============================================================================
// THE ANNUAL STATEMENT'S ADMIN SPLIT — FIXED AND VARIABLE (pr/admin-fixed-variable-split;
// utils/fixedAdmin.ts, utils/annualStatementTemplate.ts ADMIN_SPLIT_ROWS).
//
//   npx tsx scripts/diagnostics/admin-split-check.ts
//
// A real New-version room, and an older one from before #110's level rescale (no
// scale stamp; it plays the original level table), on the localStorage transport, Medium market, three lines,
// five teams over four years: one far dearer, one that skips year 3, one that
// never locks) and the same plan in a Current room and in a New room with the
// market Off. Each team's game is replayed to year 4, and its statement built
// as of every year it has (history years included), for the pool and each line.
//
// 1. SPLIT ONLY WHERE ADMIN IS FIXED: every New-room team's statement has
//    ADMIN_SPLIT_ROWS — "General Admin Expense — Fixed", "— Variable", "Total
//    General Admin Expense", then its "% of Premium", and the note "Fixed admin
//    doesn't shrink when your book does." under the table. Current-room and
//    New-room-with-the-market-Off games keep TEMPLATE_ROWS (one General Admin
//    Expense line, no note); so does any setup without the version (single
//    player and Test player carry none).
// 2. FIXED + VARIABLE = TOTAL in every column — Prior, each year, and All Years
//    where shown — at every as-of year and scope.
// 3. FIXED IS THE ENGINE'S, recomputed here: per line, 0.25 × year-1 admin ×
//    1.03^(year − 1) in a played year with the line's market result, 0 in one
//    without (a team that never locked); the pool's the lines' sum. A HISTORY
//    YEAR (pr/admin-split-history; display only) reads the same formula
//    backwards — year 1's fixed admin ÷ 1.03 a year (2026 ÷ 1.03, 2025 ÷ 1.03²)
//    — read from the whole game so every as-of view splits it alike, 0 for a
//    line with no market result in any year, and "—" before year 1 is played.
//    Variable is never negative. And it
//    ties to what the engine booked: (Fixed + 0.75 × the admin charged) × (1 +
//    the year's overrun) = General Admin Expense, the overrun read from a twin
//    game on the same stored market without the version.
// 4. NOTHING ELSE MOVES: every other figure of the split statement — the Total
//    (today's General Admin Expense), every ratio, every other line — equals the
//    statement built from the same results without the split.
// 3c. ONE TEAM: a hosted New room with a single team (no rivals) gets a
//    market result every year, and its statement shows Fixed above 0 in every
//    played year, as the brief recomputes it.
// 5. THE DOWNLOADS: the Excel file, read back, carries the three admin rows and
//    the note where the rows say, Fixed + Variable = Total in every cell; the
//    PDF's cell text carries them too.
//
// CONTROLS, each of which must fail: Variable off by $1,000 in one year (the
// sum check); Fixed recomputed at 50%; with no trend; the split shown in a
// Current room; the note left out; history Fixed not stepped back; history
// Fixed left at 0 (the old all-Variable history); a one-team game without its
// market results.
// ============================================================================
import ExcelJS from 'exceljs';
import type { CoverageLine, GameState, LineResultSet, LineView, ResultSet } from '../../src/types/simulation';
import type { StoredMarketYear } from '../../src/session/contract';

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
}
(globalThis as unknown as { localStorage: unknown }).localStorage = new MemoryStorage();
Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });

let passed = 0, failed = 0;
function ok(cond: boolean, label: string, detail = '') {
  if (cond) { passed++; console.log(`  OK    ${label}`); } else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
function control(label: string, problems: number) {
  ok(problems > 0, `control: ${label}`, problems > 0 ? '' : 'the broken form passed');
  if (problems > 0) console.log(`          (${problems} problem(s) when broken)`);
}

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const SCOPES: LineView[] = ['pool', ...LINES];
/** The brief, as literals: a quarter of year-1 admin fixed, growing 3% a year. */
const BRIEF = { share: 0.25, trend: 0.03 };
const NOTE = 'Fixed admin doesn\'t shrink when your book does.';
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

(async () => {
  const { LocalSessionTransport, ROOM_KEY_PREFIX } = await import('../../src/session/localTransport');
  const { MARKET_NEW_FIXED_ADMIN } = await import('../../src/data/pricingParameters');
  const { newSessionToken } = await import('../../src/session/contract');
  const { marketByYearForEngine } = await import('../../src/session/market');
  const { buildTeamGame, replayTeamYears } = await import('../../src/session/client/buildGame');
  const { marketLockInputFor } = await import('../../src/session/client/marketLock');
  const { decisionsForYear, decisionsToJson } = await import('../../src/session/client/decisions');
  const T = await import('../../src/utils/annualStatementTemplate');
  const { showsAdminSplit } = await import('../../src/utils/fixedAdmin');
  const { buildAnnualStatementXlsx } = await import('../../src/utils/annualStatementExport');
  const { pdfCellText, pdfPagePlan } = await import('../../src/utils/annualStatementPdf');
  type TS = ReturnType<typeof T.buildTemplateStatement>;

  const t = new LocalSessionTransport({ latencyMs: 0 });
  const plan = [
    { name: 'Alder', f: 0.92, nm: 0.10, nr: 0.00 },
    { name: 'Cedar', f: 1.00, nm: 0.06, nr: 0.05 },
    { name: 'Dogwood', f: 1.06, nm: 0.04, nr: 0.02 },   // skips year 3
    { name: 'Elm', f: 1.40, nm: 0.00, nr: 0.10 },       // far dearer: loses its book
    { name: 'Fir', f: 1.00, nm: 0.05, nr: 0.00 },       // never locks
  ];
  /** A room played four years; each team's game replayed to the end, with a twin without the version. */
  async function playRoom(level: 'off' | 'medium', version: 'current' | 'new', createdBeforeRescale = false, teams = plan) {
    const plan = teams;
    const host = newSessionToken();
    const made = await t.createRoom({ hostToken: host, seed: '7', yearCount: 4, startingYear: 2027, eventName: `Split ${level} ${version}`,
      expectedTeams: plan.length, lines: LINES, shocks: [], market: level, ...(version === 'new' ? { marketVersion: 'new' as const } : {}) });
    if (version === 'current') {
      // AN OLDER CURRENT ROOM (pr/market-new-only): every room created now plays New, so a Current room is one created
      // before — its stored record carries no version and no scale, as the contract harness makes older rooms.
      const key = ROOM_KEY_PREFIX + made.code;
      const rec = JSON.parse(globalThis.localStorage.getItem(key)!) as { marketVersion?: string; marketScale?: number };
      delete rec.marketVersion; delete rec.marketScale;
      globalThis.localStorage.setItem(key, JSON.stringify(rec));
    }
    if (createdBeforeRescale) {
      // A New room created before pr/market-level-rescale (#110): its record has no scale stamp, as
      // market-new-version-check and the contract harness make older rooms. It plays the original level table.
      const key = ROOM_KEY_PREFIX + made.code;
      const rec = JSON.parse(globalThis.localStorage.getItem(key)!) as { marketScale?: number };
      delete rec.marketScale;
      globalThis.localStorage.setItem(key, JSON.stringify(rec));
    }
    const joined = [];
    for (const p of plan) joined.push(await t.join({ code: made.code, teamName: p.name, role: 'player' }));
    const room0 = (await t.read({ code: made.code, token: host })).room;
    const base = level !== 'off' ? marketLockInputFor(buildTeamGame(room0, LINES).gameState, decisionsForYear(1, undefined, false), 1)! : null;
    for (let year = 1; year <= 4; year++) {
      for (let i = 0; i < plan.length; i++) {
        const p = plan[i];
        if (p.name === 'Fir' || (p.name === 'Dogwood' && year === 3)) continue;
        const me = await t.read({ code: made.code, token: joined[i].teamToken });
        const d = decisionsForYear(year, undefined, false);
        for (const [j, line] of LINES.entries()) d.byLine[line] = { ...d.byLine[line], newMembers: Math.max(0, p.nm - 0.01 * j), nonRenewal: p.nr };
        let m: { byLine: Record<string, { rate: number; book: number; newMembers: number; nonRenewal: number }> } | null = null;
        if (base) {
          const last = Object.keys(me.you?.marketByYear ?? {}).map(Number).sort((a, b) => b - a)[0];
          m = { byLine: {} };
          for (const line of LINES) {
            const r = last !== undefined ? me.you!.marketByYear![String(last)][line] : undefined;
            m.byLine[line] = { rate: base.byLine[line]!.rate * (1 + (p.f - 1) * (1 + 0.1 * year)),
              book: r ? r.bookAfter * (1 - r.engineNonRenewal) : base.byLine[line]!.book,
              newMembers: d.byLine[line].newMembers ?? 0, nonRenewal: d.byLine[line].nonRenewal ?? 0 };
          }
        }
        await t.submit({ code: made.code, token: joined[i].teamToken, yearNumber: year, decisions: decisionsToJson(d), ...(m ? { market: m as never } : {}) });
      }
      await t.advance({ code: made.code, token: host, expectedYear: year });
    }
    const games: { name: string; gs: GameState; twin: GameState; stored: Record<string, unknown> | undefined }[] = [];
    for (let i = 0; i < plan.length; i++) {
      const me = await t.read({ code: made.code, token: joined[i].teamToken });
      const market = marketByYearForEngine(me.you?.marketByYear);
      const g0 = buildTeamGame(me.room, LINES).gameState;
      const strip = (gs: GameState): GameState => { const { marketVersion: _v, ...setup } = gs.setup; void _v; return { ...gs, setup }; };
      games.push({
        name: plan[i].name,
        gs: replayTeamYears(g0, 5, me.you?.decisionsByYear, market).state,
        twin: replayTeamYears(strip(g0), 5, me.you?.decisionsByYear, market).state,
        stored: me.you?.marketByYear as Record<string, StoredMarketYear> | undefined,
      });
    }
    return { room: (await t.read({ code: made.code, token: host })).room, games };
  }

  const allOf = (gs: GameState): ResultSet[] => [...(gs.earlyPreGameHistory ?? []), ...(gs.priorHistory ?? []), ...gs.lockedResults];
  const strip = (gs: GameState): GameState => { const { marketVersion: _v, ...setup } = gs.setup; void _v; return { ...gs, setup }; };
  /** Every statement of a game: each as-of year, each scope. */
  const statementsOf = (gs: GameState): TS[] => allOf(gs).flatMap(r => SCOPES.map(s => T.buildTemplateStatement(gs, s, r.yearNumber)));

  /** The brief's fixed admin for a year at a scope, from the results alone. */
  function briefFixed(gs: GameState, r: ResultSet, scope: LineView, fx = BRIEF, step = true): number | null {
    const y1 = gs.lockedResults.find(x => x.yearNumber === 1);
    if (r.yearNumber < 1) {
      // A history year, display only: year 1's fixed admin stepped back the trend a year; no figure before year 1.
      if (!y1) return null;
      return (scope === 'pool' ? LINES : [scope as CoverageLine]).reduce((t, l) =>
        t + (Object.values(gs.setup.marketByYear ?? {}).every(m => m?.[l] === undefined) ? 0
          : fx.share * (y1.byLine[l] as LineResultSet).adminExpense * (1 + fx.trend) ** (step ? r.yearNumber - 1 : 0)), 0);
    }
    if (!y1) return 0;
    return (scope === 'pool' ? LINES : [scope as CoverageLine]).reduce((t, l) =>
      t + (gs.setup.marketByYear?.[String(r.yearNumber)]?.[l] === undefined ? 0
        : fx.share * (y1.byLine[l] as LineResultSet).adminExpense * (1 + fx.trend) ** (r.yearNumber - 1)), 0);
  }

  /** Fixed + Variable = Total in every column shown (Prior where shown, the years, All Years). */
  function sumProblems(ts: TS): string[] {
    const p: string[] = [];
    const f = ts.figures.adminFixed, v = ts.figures.adminVariable, a = ts.figures.admin;
    if (!f || !v) return [`${ts.scope} as of ${ts.asOf}: no Fixed or Variable figures`];
    a.forEach((x, k) => {
      if ((x === null) !== (f[k] === null) || (x === null) !== (v[k] === null)) p.push(`${ts.scope}@${ts.asOf} ${ts.columns[k]}: a part shows where the total does not`);
      else if (x !== null && !near(f[k]! + v[k]!, x)) p.push(`${ts.scope}@${ts.asOf} ${ts.columns[k]}: ${f[k]!.toFixed(0)} + ${v[k]!.toFixed(0)} ≠ ${x.toFixed(0)}`);
    });
    const at = (key: string) => ts.rows.findIndex(r => r.kind === 'figure' && r.key === key);
    const ay = (key: string) => T.allYearsCell(ts.rows[at(key)], at(key), ts);
    const [fa, va, ta] = [ay('adminFixed'), ay('adminVariable'), ay('admin')];
    if (ta !== undefined && ta !== null && !near((fa ?? 0) + (va ?? 0), ta)) p.push(`${ts.scope}@${ts.asOf} All Years: parts ≠ total`);
    return p;
  }
  /** Fixed as the brief recomputes it, column by column (Prior the rolled years summed). */
  function fixedProblems(gs: GameState, ts: TS, fx = BRIEF, step = true): string[] {
    const p: string[] = [];
    const all = allOf(gs).filter(r => r.yearNumber <= ts.asOf);
    const window = ts.years.map(y => all.find(r => r.calendarYear === y)!);
    const rolled = all.filter(r => r.calendarYear < ts.years[0]);
    const priors = rolled.map(r => briefFixed(gs, r, ts.scope, fx, step));
    const want = [priors.some(x => x === null) ? null : priors.reduce((t, x) => t! + x!, 0), ...window.map(r => briefFixed(gs, r, ts.scope, fx, step))];
    ts.figures.adminFixed?.forEach((x, k) => {
      if (x === null && ts.figures.admin[k] === null) return;
      if (x === null || want[k] === null ? x !== want[k] : !near(x, want[k]!)) p.push(`${ts.scope}@${ts.asOf} ${ts.columns[k]}: Fixed ${x?.toFixed(0) ?? '—'} ≠ ${want[k]?.toFixed(0) ?? '—'}`);
    });
    return p;
  }

  // ==========================================================================
  console.log('1. A New-version room, Medium market: every team, as of every year, pool and each line');
  ok(MARKET_NEW_FIXED_ADMIN.share === BRIEF.share && MARKET_NEW_FIXED_ADMIN.trend === BRIEF.trend,
    'the parameter is #109\'s: 25% of year-1 admin fixed, growing 3% a year');
  const nw = await playRoom('medium', 'new');
  // An older New room (no scale stamp, from before #110): it plays the original level table, and its admin splits alike.
  const old = await playRoom('medium', 'new', true);
  const cur = await playRoom('medium', 'current');
  const off = await playRoom('off', 'new');
  ok(nw.room.marketScale === 2 && old.room.marketScale === undefined && old.room.marketVersion === 'new',
    'the New room carries #110\'s scale stamp; the older New room carries none');
  let statements = 0, sums: string[] = [], fixed: string[] = [];
  const same: string[] = [], layout: string[] = [];
  let fixedYears = 0, firZero = true, historyCells = 0, negVar = 0;
  const tagged = [...nw.games, ...old.games.map(g => ({ ...g, name: `older ${g.name}` }))];
  const differ = old.games.some((g, i) => JSON.stringify(g.gs.lockedResults.map(r => r.byLine.WC.operatingExpense))
    !== JSON.stringify(nw.games[i].gs.lockedResults.map(r => r.byLine.WC.operatingExpense)));
  ok(differ, 'the older room plays differently from the new one (its own level table), so it is a second room, not a copy');
  for (const g of tagged) {
    if (!showsAdminSplit(g.gs)) layout.push(`${g.name}: the game does not read New`);
    for (const ts of statementsOf(g.gs)) {
      statements++;
      if (ts.rows !== T.ADMIN_SPLIT_ROWS) layout.push(`${g.name} ${ts.scope}@${ts.asOf}: not the split rows`);
      sums = sums.concat(sumProblems(ts).map(x => `${g.name} ${x}`));
      fixed = fixed.concat(fixedProblems(g.gs, ts).map(x => `${g.name} ${x}`));
      ts.figures.adminFixed!.forEach((x, k) => {
        if (k > 0 && x !== null && x > 0) fixedYears++;
        if (g.name.endsWith('Fir') && x !== null && x !== 0) firZero = false;
        if (k > 0 && ts.years[k - 1] < g.gs.setup.startingYear && x !== null && x > 0) historyCells++;
        if (ts.figures.adminVariable![k] !== null && ts.figures.adminVariable![k]! < 0) negVar++;
      });
      // 4. Every other figure equals the statement without the split.
      const plain = T.buildTemplateStatement(strip(g.gs), ts.scope, ts.asOf);
      if (plain.rows !== T.TEMPLATE_ROWS) layout.push('the stripped game still splits');
      for (const [key, xs] of Object.entries(plain.figures)) {
        if (JSON.stringify(xs) !== JSON.stringify(ts.figures[key])) same.push(`${g.name} ${ts.scope}@${ts.asOf} ${key}`);
      }
      if (Object.keys(ts.figures).length !== Object.keys(plain.figures).length + 2) same.push(`${g.name} ${ts.scope}@${ts.asOf}: figures other than Fixed and Variable added`);
    }
  }
  const rows = T.ADMIN_SPLIT_ROWS.map(r => (r.kind === 'blank' ? '' : r.label.trim()));
  const ai = rows.indexOf('General Admin Expense — Fixed');
  ok(rows.slice(ai, ai + 5).join(' | ') === 'General Admin Expense — Fixed | General Admin Expense — Variable | Total General Admin Expense | % of Premium | Other Admin Expense'
    && !rows.includes('General Admin Expense') && T.ADMIN_SPLIT_ROWS.length === T.TEMPLATE_ROWS.length + 2,
    'the split rows: Fixed, Variable, Total General Admin Expense, its % of Premium, then Other Admin Expense; two rows longer than the template', rows.slice(ai, ai + 5).join(' | '));
  /** The note: the second row under Operating Ratio (the first, a blank, closes the table), its words exactly, no lines. */
  const noteProblems = (rs: typeof T.ADMIN_SPLIT_ROWS): number => {
    const n = rs.findIndex(r => r.kind === 'note'), o = rs.findIndex(r => r.kind === 'figure' && r.key === 'operatingRatio');
    return n === o + 2 && (rs[n] as { label: string }).label === NOTE && rs[o + 1].kind === 'blank'
      && [1, 2, 3, 4, 5, 6, 7, 8, 9].every(c => T.cellBorders(n, c, rs) === '') ? 0 : 1;
  };
  const noteAt = T.ADMIN_SPLIT_ROWS.findIndex(r => r.kind === 'note');
  ok(noteProblems(T.ADMIN_SPLIT_ROWS) === 0, `the note "${NOTE}" under the Net Income Statement's table (below its closing row), with no lines`);
  ok(layout.length === 0 && nw.room.marketVersion === 'new', `every statement of both New rooms, the older one included (${statements}), has the split rows`, layout.slice(0, 3).join('; '));
  ok(sums.length === 0 && statements > 300, `2. Fixed + Variable = Total in every column, Prior and All Years included (${statements} statements)`, sums.slice(0, 3).join('; '));
  ok(fixed.length === 0 && fixedYears > 200, `3. Fixed is 0.25 × year-1 admin × 1.03^(year − 1) in each year with the line's market result (${fixedYears} year-cells above 0), the pool the lines' sum`, fixed.slice(0, 3).join('; '));
  ok(historyCells > 100, `   a history year (display only) shows year 1's fixed admin stepped back 3% a year — 2026 = ÷ 1.03, 2025 = ÷ 1.03², … (${historyCells} history year-cells above 0)`);
  // The step-back read straight off one statement: each history year's Fixed × 1.03 = the next year's, 2026's × 1.03 = year 1's.
  const stepTs = T.buildTemplateStatement(nw.games[0].gs, 'WC', 2);
  const fx = stepTs.figures.adminFixed.slice(1) as number[];
  const stepOk = fx.every((x, k) => k === 0 || near(fx[k - 1] * 1.03, x)) && stepTs.years[0] < 2027 && stepTs.years.includes(2027);
  ok(stepOk, `   Alder's WC as of year 2, ${stepTs.years.join(', ')}: Fixed ${fx.map(x => x.toFixed(0)).join(' → ')} — each year 1.03 × the one before, across the start of play`);
  ok(negVar === 0, '   Variable is never negative, history years included');
  ok(firZero, '   Fir, which never locked (no market result), shows Fixed 0 in every year, history included');
  // Before year 1 is played there is no year-1 fixed admin to step back from: the history years' Fixed and Variable show no figure.
  const pre = buildTeamGame(nw.room, LINES).gameState;
  const preTs = SCOPES.map(s => T.buildTemplateStatement(pre, s));
  ok(pre.lockedResults.length === 0 && preTs.every(ts => ts.rows === T.ADMIN_SPLIT_ROWS
    && ts.figures.admin.slice(1).every(x => x !== null) && ts.figures.adminFixed.every(x => x === null) && ts.figures.adminVariable.every(x => x === null)),
    '   before year 1 is played: the split rows, the Total as today, and Fixed and Variable "—" (nothing yet to step back from)');
  ok(same.length === 0, '4. every other figure — the Total, every ratio, every other line — equals the statement without the split', same.slice(0, 3).join('; '));

  // 3b. Fixed ties to the admin the engine booked: (Fixed + 0.75 × charged) × (1 + overrun) = booked.
  const tie: string[] = [];
  let tied = 0;
  for (const g of tagged) for (const r of g.gs.lockedResults) for (const l of LINES) {
    const tw = g.twin.lockedResults.find(x => x.yearNumber === r.yearNumber)!.byLine[l] as LineResultSet;
    const x = r.byLine[l] as LineResultSet;
    const over = tw.operatingExpense / tw.adminExpense - 1;
    const f = briefFixed(g.gs, r, l)!;
    const want = f > 0 ? (f + (1 - BRIEF.share) * x.adminExpense) * (1 + over) : x.adminExpense * (1 + over);
    if (!near(x.operatingExpense, want)) tie.push(`${g.name} y${r.yearNumber} ${l}: booked ${x.operatingExpense.toFixed(0)} ≠ ${want.toFixed(0)}`);
    else tied++;
  }
  ok(tie.length === 0, `   and ties to what the engine booked: (Fixed + 0.75 × the admin charged) × (1 + the overrun) = General Admin Expense (${tied} team-year-lines)`, tie.slice(0, 3).join('; '));
  const elm = nw.games.find(g => g.name === 'Elm')!;
  const elmTs = T.buildTemplateStatement(elm.gs, 'pool');
  const share = elmTs.figures.adminFixed.slice(1).map((f, k) => (f ?? 0) / (elmTs.figures.admin[k + 1] ?? 1));
  ok(share[4] > share[1] && share[4] > BRIEF.share, `   Elm, which lost its book, shows Fixed a growing share of its admin (${share.slice(1).map(s => `${(s * 100).toFixed(0)}%`).join(' → ')})`);

  // ==========================================================================
  console.log('\n1b. The single line where no admin is fixed');
  let curSplit = 0, offSplit = 0, curN = 0;
  for (const g of cur.games) for (const ts of statementsOf(g.gs)) { curN++; if (ts.rows !== T.TEMPLATE_ROWS || 'adminFixed' in ts.figures) curSplit++; }
  for (const g of off.games) for (const ts of statementsOf(g.gs)) { if (ts.rows !== T.TEMPLATE_ROWS || 'adminFixed' in ts.figures) offSplit++; }
  ok(curSplit === 0 && curN > 100, `a Current room: every statement (${curN}) keeps the single General Admin Expense line and no note`);
  ok(off.room.marketVersion === 'new' && off.games.every(g => g.gs.setup.marketVersion === undefined) && offSplit === 0,
    'a New-version room with the market Off (no admin fixed): its games carry no version, and keep the single line');
  ok(!showsAdminSplit({ ...cur.games[0].gs, setup: { ...cur.games[0].gs.setup, testPlayer: true } } as GameState),
    'a setup without the version (single player, Test player) keeps the single line');

  // ==========================================================================
  console.log('\n1c. A hosted New room with ONE team: no rivals, and the fixed admin still shows in its played years');
  const solo = await playRoom('medium', 'new', false, [{ name: 'Alder', f: 1.00, nm: 0.05, nr: 0.02 }]);
  const sg = solo.games[0];
  /** Played year-cells, at every scope, whose Fixed is not the brief's figure above 0. */
  const soloProblems = (gs: GameState): string[] => {
    const p: string[] = [];
    for (const s of SCOPES) {
      const ts = T.buildTemplateStatement(gs, s);
      ts.years.forEach((y, k) => {
        if (y < gs.setup.startingYear) return;
        const r = gs.lockedResults.find(x => x.calendarYear === y)!;
        const f = ts.figures.adminFixed?.[k + 1];
        const want = briefFixed(sg.gs, r, s);
        if (!(f !== null && f !== undefined && f > 0 && want !== null && near(f, want))) p.push(`${s} ${y}: Fixed ${f ?? '—'} (want ${want?.toFixed(0)})`);
      });
      p.push(...sumProblems(ts).map(x => `solo ${x}`), ...fixedProblems(sg.gs, ts).map(x => `solo ${x}`));
    }
    return p;
  };
  const soloP = soloProblems(sg.gs);
  ok(Object.keys(sg.stored ?? {}).length === 4 && LINES.every(l => [1, 2, 3, 4].every(y => sg.gs.setup.marketByYear?.[String(y)]?.[l] !== undefined)),
    'the one team gets a market result every year, on every line, with no rivals');
  ok(sg.gs.setup.marketVersion === 'new' && soloP.length === 0,
    'its statement splits: Fixed above 0 and the brief\'s in every played year at every scope, Fixed + Variable = Total, history stepped back', soloP.slice(0, 3).join('; '));

  // ==========================================================================
  console.log('\n5. The downloads');
  const g = nw.games.find(x => x.name === 'Elm')!;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildAnnualStatementXlsx(g.gs, undefined, 'pool'));
  const xl: string[] = [];
  let sheets = 0;
  for (const ts of T.statementsForView(g.gs, 'pool')) {
    const ws = wb.getWorksheet(ts.scopeName === 'Pool' ? 'Pool' : wb.worksheets[sheets].name)!;
    sheets++;
    const label = (r: number) => String(ws.getCell(r + 1, 2).value ?? '').trim();
    ts.rows.forEach((row, i) => {
      if (row.kind === 'figure' || row.kind === 'note') { if (label(i) !== row.label.trim()) xl.push(`${ws.name} row ${i + 1}: "${label(i)}" ≠ "${row.label.trim()}"`); }
    });
    const at = (key: string) => ts.rows.findIndex(r => r.kind === 'figure' && r.key === key) + 1;
    for (let c = 4; c <= 8; c++) {
      const n = (r: number) => Number(ws.getCell(r, c).value);
      if (!near(n(at('adminFixed')) + n(at('adminVariable')), n(at('admin')))) xl.push(`${ws.name} col ${c}: parts ≠ total`);
    }
    if (label(noteAt) !== NOTE || ws.getCell(noteAt + 1, 2).font?.italic !== true) xl.push(`${ws.name}: no italic note at row ${noteAt + 1}`);
  }
  ok(xl.length === 0 && sheets === 4, `the Excel file (${sheets} sheets): the split rows and the note where the rows say, Fixed + Variable = Total in every year cell`, xl.slice(0, 3).join('; '));
  const pts = T.buildTemplateStatement(g.gs, 'pool');
  const planned = pdfPagePlan(pts.rows).flat();
  const pdfLabels = planned.map(i => pdfCellText(pts.rows[i], i, 2, pts));
  ok(['General Admin Expense — Fixed', 'General Admin Expense — Variable', 'Total General Admin Expense', NOTE].every(l => pdfLabels.includes(l))
    && !pdfLabels.includes('General Admin Expense') && pdfPagePlan(pts.rows).flat().length >= pdfPagePlan().flat().length + 2,
    'the PDF: its pages carry Fixed, Variable, Total General Admin Expense and the note, with no single line');
  const fi = pts.rows.findIndex(r => r.kind === 'figure' && r.key === 'adminFixed');
  ok([4, 5, 6, 7, 8].every(c => pdfCellText(pts.rows[fi], fi, c, pts) !== ''), '   and Fixed\'s figures in every year column');

  // ==========================================================================
  console.log('\nControls');
  {
    const ts = T.buildTemplateStatement(g.gs, 'pool');
    const broken = { ...ts, figures: { ...ts.figures, adminVariable: ts.figures.adminVariable.map((x, k) => (k === 3 && x !== null ? x + 1000 : x)) } };
    control('Variable off by $1,000 in one year: the sum check fails', sumProblems(broken).length);
    let half = 0, flat = 0;
    for (const x of tagged) for (const s of statementsOf(x.gs)) {
      half += fixedProblems(x.gs, s, { ...BRIEF, share: 0.50 }).length;
      flat += fixedProblems(x.gs, s, { ...BRIEF, trend: 0 }).length;
    }
    control('Fixed recomputed at 50% disagrees', half);
    control('Fixed recomputed with no trend disagrees', flat);
    let noStep = 0, histZero = 0;
    for (const x of tagged) for (const s of statementsOf(x.gs)) {
      noStep += fixedProblems(x.gs, s, BRIEF, false).length;
      const zeroed = { ...s, figures: { ...s.figures, adminFixed: s.figures.adminFixed.map((f, k) => (k > 0 && s.years[k - 1] < 2027 && f !== null ? 0 : f)) } };
      histZero += fixedProblems(x.gs, zeroed).length;
    }
    control('history Fixed not stepped back (year 1\'s fixed admin in every history year) disagrees', noStep);
    control('history Fixed left at 0 (the old all-Variable history) disagrees', histZero);
    const { marketByYear: _m, ...noMarket } = sg.gs.setup; void _m;
    control('a one-team game without its market results (the fixed admin dropped) fails the one-team check', soloProblems({ ...sg.gs, setup: noMarket }).length);
    const wrongly = cur.games.map(x => ({ ...x.gs, setup: { ...x.gs.setup, marketVersion: 'new' as const } }));
    control('the split shown in a Current room is caught (its Fixed is 0 where the brief has none, or its rows split)',
      wrongly.filter(x => T.buildTemplateStatement(x, 'pool').rows === T.ADMIN_SPLIT_ROWS).length);
    control('the note left out (a blank in its place): the note check fails', noteProblems(T.ADMIN_SPLIT_ROWS.map(r => (r.kind === 'note' ? { kind: 'blank' as const } : r))));
    const plain = T.buildTemplateStatement(strip(g.gs), 'pool');
    const asVariable: Record<string, unknown> = { ...ts.figures, admin: ts.figures.adminVariable };
    control('the Total row reading Variable alone: the nothing-else-moves check fails',
      Object.entries(plain.figures).filter(([k, xs]) => JSON.stringify(xs) !== JSON.stringify(asVariable[k])).length);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('\nadmin-split-check: FAILED'); process.exit(1); }
  console.log('\nadmin-split-check: PASS — Fixed + Variable = Total everywhere, Fixed is the engine\'s, nothing else moves, and the controls fail.');
})().catch(e => { console.error(e); process.exit(1); });
