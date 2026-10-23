// ============================================================================
// THE SHOCKS REPORT (wip/shocks test build) — twenty scenarios, ten years,
// default decisions, single player, played as the app plays them (every world).
//
//   npx tsx scripts/tools/shocks-report.ts                 > runlogs/shocks-report.log
//   npx tsx scripts/tools/shocks-report.ts --cover '$38M xs $2M'   every line on one cover
//   npx tsx scripts/tools/shocks-report.ts --json out.json          the figures, for comparing runs
//   npx tsx scripts/tools/shocks-report.ts --shocks-off             this build, single-player shocks off
//   npx tsx scripts/tools/shocks-report.ts --invest                 only section 5: the Investment Loss in dollars
//
// ⚠ PORTABLE TO THE BASELINE ON PURPOSE. It imports only what multiplayer's head
// also has, so the same file run in a worktree of that head gives "today's
// build with shocks off" (SOLO_SHOCKS off there) on identical terms. The shock
// sections (events, T claims, covers) read only claims and records, and print
// nothing where there are none.
//
// The T covers' figures are counterfactual on each T claim's ULTIMATE size:
// every world shares the same T claims, so one cover's recovery is one figure
// per claim, whatever the team bought — what each option would have paid.
// ============================================================================

import fs from 'node:fs';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import { gameShocksOn, eventLines, SHOCK_EVENTS } from '../../src/utils/shockLosses';
import * as P from '../../src/data/pricingParameters';
import type { CoverageLine, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const COVER = arg('cover');
// --shocks-off: this build with single-player shocks off — what should reproduce the baseline.
if (process.argv.includes('--shocks-off')) (P as unknown as { SOLO_SHOCKS: { enabled: boolean } }).SOLO_SHOCKS.enabled = false;
const JSON_OUT = arg('json');
const YEARS = 10, SCENARIOS = 20;
const M = 1e6;
const fmtM = (v: number) => `${v < 0 ? '-' : ''}$${Math.abs(v / M).toFixed(1)}M`;

interface TClaim { scenario: number; year: number; line: CoverageLine; event: string; level: string; size: number }
const fired: Record<string, number> = {};
const tClaims: TClaim[] = [];
const byLine = Object.fromEntries(LINES.map(l => [l, {
  crNum: [] as number[], crDen: [] as number[],
  s5: [] as number[], s10: [] as number[], min5: Infinity, min10: Infinity,
  belowZeroScenarios: 0, belowZeroWorlds: 0, deficientYears: 0, loanWorlds: 0, worlds: 0,
  reinsCost: 0, reinsRecovered: 0,
}])) as Record<CoverageLine, {
  crNum: number[]; crDen: number[]; s5: number[]; s10: number[]; min5: number; min10: number;
  belowZeroScenarios: number; belowZeroWorlds: number; deficientYears: number; loanWorlds: number; worlds: number;
  reinsCost: number; reinsRecovered: number;
}>;

// ---- 5. THE INVESTMENT LOSS IN DOLLARS -------------------------------------
// Each scenario played to year 3 twice — the Investment Loss forced in year 3,
// and no events — with the allocation set in year 3 only, so both start the
// year on the same assets. The difference in investment income, summed over
// lines and averaged over worlds, is what the event cost.
if (process.argv.includes('--invest')) {
  const ALLOCS: Record<string, [number, number, number]> = { 'default 10/80/10': [10, 80, 10], 'equity-heavy 10/30/60': [10, 30, 60], 'cash-heavy 70/30/0': [70, 30, 0] };
  const incomeY3 = (sc: number, schedule: { shockId: string; yearNumber: number }[], alloc: [number, number, number]) => {
    const settings = { poolName: 'R', gameLength: YEARS, startingYear: 2026, instanceId: String(sc), activeLines: LINES } as GameSetupSettings;
    const opened = openSoloInstance(settings);
    const instance = { ...opened.instance, scheduledShocks: schedule };
    const { poolState, priorHistory } = runPriorHistory(instance, opened.setup);
    let gs: GameState = openWorlds({ setup: opened.setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory });
    let inc = 0;
    for (let y = 1; y <= 3; y++) {
      const d = defaultDecisionSet(y, true);
      if (y === 3) d.assetAllocation = { cashPct: alloc[0], bondsPct: alloc[1], equitiesPct: alloc[2] };
      const played = playWorldsYear(gs, d);
      if (y === 3) for (const p of played.perWorld) for (const r of p.lineResults) inc += (r.result as LineResultSet).investmentIncome / played.perWorld.length;
      gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
    }
    return inc;
  };
  console.log('5. INVESTMENT LOSS IN A YEAR IT FIRES (year 3, pool total, mean over worlds)');
  for (const sc of [1, 12, 16]) {
    const cells = Object.entries(ALLOCS).map(([k, a]) => `${k} ${fmtM(incomeY3(sc, [{ shockId: '#11', yearNumber: 3 }], a) - incomeY3(sc, [], a))}`);
    console.log(`   scenario ${sc}: ${cells.join(' · ')}`);
  }
  process.exit(0);
}

const t0 = Date.now();
for (let sc = 1; sc <= SCENARIOS; sc++) {
  const settings = { poolName: 'R', gameLength: YEARS, startingYear: 2026, instanceId: String(sc), activeLines: LINES } as GameSetupSettings;
  const { setup, instance } = openSoloInstance(settings);
  const shocks = gameShocksOn(setup, instance);
  for (const s of instance.scheduledShocks ?? []) {
    const name = SHOCK_EVENTS.find(e => e.id === s.shockId)?.name ?? s.shockId;
    fired[name] = (fired[name] ?? 0) + 1;
  }
  const { poolState, priorHistory } = runPriorHistory(instance, setup);
  const decisions = (y: number) => {
    const d = defaultDecisionSet(y, shocks);
    if (COVER) for (const l of LINES) d.byLine[l].reinsuranceOption = COVER;
    return d;
  };
  let gs: GameState = openWorlds({ setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: decisions(1), priorHistory });
  const nW = gs.worlds?.length ?? 1;
  const everBelow = Object.fromEntries(LINES.map(l => [l, new Set<number>()])) as Record<CoverageLine, Set<number>>;
  const everLoan = Object.fromEntries(LINES.map(l => [l, new Set<number>()])) as Record<CoverageLine, Set<number>>;
  const avgBelow = Object.fromEntries(LINES.map(l => [l, false])) as Record<CoverageLine, boolean>;
  const crNum = Object.fromEntries(LINES.map(l => [l, 0])) as Record<CoverageLine, number>;
  const crDen = Object.fromEntries(LINES.map(l => [l, 0])) as Record<CoverageLine, number>;
  for (let y = 1; y <= YEARS; y++) {
    const played = playWorldsYear(gs, decisions(y));
    played.perWorld.forEach((p, w) => {
      for (const { line, result } of p.lineResults) {
        const r = result as LineResultSet;
        const b = byLine[line];
        crNum[line] += r.actualCombinedRatio * r.totalMemberCharge;
        crDen[line] += r.totalMemberCharge;
        b.reinsCost += r.reinsuranceCost / nW;
        b.reinsRecovered += r.reinsuranceRecovery / nW;
        if (r.endingSurplus < 0) everBelow[line].add(w);
        if (y === 5) { b.s5.push(r.endingSurplus); b.min5 = Math.min(b.min5, r.endingSurplus); }
        if (y === 10) { b.s10.push(r.endingSurplus); b.min10 = Math.min(b.min10, r.endingSurplus); }
        // The T claims, once: every world shares them, so world 1's.
        if (w === 0) {
          for (const c of r.claims ?? []) {
            if (c.tier !== 'shock' || c.accidentYear !== y) continue;
            const ev = SHOCK_EVENTS.find(e => e.id === c.shockId);
            const level = ev ? eventLines(ev.name).find(x => x.line === line)?.t ?? '?' : '?';
            tClaims.push({ scenario: sc, year: y, line, event: ev?.name ?? String(c.shockId), level, size: c.grossUltimate });
          }
        }
      }
      for (const o of p.loanOffers) everLoan[o.line].add(w);
    });
    const settled = settleWorldsYear(gs, played, []);
    for (const l of LINES) {
      const avg = settled.result.byLine[l];
      if (avg.endingSurplus < 0) avgBelow[l] = true;
      if (avg.capitalAdequacyStatus === 'Deficient') byLine[l].deficientYears++;
    }
    gs = { ...gs, ...commitSettledYear(gs, settled), currentYearNumber: y + 1, currentDecisions: decisions(y + 1) };
  }
  for (const l of LINES) {
    const b = byLine[l];
    b.crNum.push(crNum[l]); b.crDen.push(crDen[l]);
    if (avgBelow[l]) b.belowZeroScenarios++;
    b.belowZeroWorlds += everBelow[l].size;
    b.loanWorlds += everLoan[l].size;
    b.worlds += nW;
  }
  process.stderr.write(`scenario ${sc} done, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(a.length, 1);
console.log(`SHOCKS REPORT — ${SCENARIOS} scenarios x ${YEARS} years, default decisions${COVER ? `, every line on ${COVER}` : ''}, `
  + `single player, ${byLine.WC.worlds / SCENARIOS} worlds; SOLO_SHOCKS ${(P as unknown as { SOLO_SHOCKS?: { enabled: boolean } }).SOLO_SHOCKS?.enabled ? 'on' : 'off'}`);

console.log('\n1. EVENTS FIRED (all 20 games; every world shares them)');
console.log('   ' + (Object.entries(fired).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'));
console.log(`   total ${Object.values(fired).reduce((a, b) => a + b, 0)} in ${SCENARIOS * (YEARS - 1)} scenario-years from year 2`);
console.log('   T claims by line and level (count, mean size, largest):');
for (const l of LINES) {
  const cells = ['Low', 'Mid', 'High'].map(lv => {
    const c = tClaims.filter(t => t.line === l && t.level === lv);
    return `${lv} ${c.length}${c.length ? ` (mean ${fmtM(mean(c.map(t => t.size)))}, max ${fmtM(Math.max(...c.map(t => t.size)))})` : ''}`;
  });
  console.log(`   ${l.padEnd(9)}${cells.join(' · ')}`);
}

const options = (P as unknown as { REINSURANCE_OPTIONS?: Record<CoverageLine, readonly { id: string; attachment: number; limit: number }[]> }).REINSURANCE_OPTIONS;
const prices = (P as unknown as { REINSURANCE_PRICE?: Record<CoverageLine, Record<string, number>> }).REINSURANCE_PRICE;
const cover2: Record<string, unknown> = {};
if (options && prices && tClaims.length) {
  console.log('\n2. EACH COVER ON THE T CLAIMS, by line (counterfactual on ultimate; price x 200 scenario-years)');
  for (const l of LINES) {
    for (const o of options[l].filter(x => x.limit > 0)) {
      const rec = tClaims.filter(t => t.line === l).map(t => Math.min(Math.max(t.size - o.attachment, 0), o.limit));
      const paid = rec.reduce((a, b) => a + b, 0), n = rec.filter(r => r > 0).length;
      const premium = prices[l][o.id] * SCENARIOS * YEARS;
      cover2[`${l} ${o.id}`] = { paid, n, premium };
      console.log(`   ${l.padEnd(9)}${o.id.padEnd(13)} paid ${fmtM(paid).padStart(8)} on ${String(n).padStart(2)} claims · `
        + `premium ${fmtM(premium).padStart(7)} · loss ratio ${(100 * paid / premium).toFixed(0)}%`);
    }
  }
}

console.log('\n3. BY LINE — cumulative combined ratio (mean of scenarios, worst), surplus (mean / lowest world)');
const out3: Record<string, unknown> = {};
for (const l of LINES) {
  const b = byLine[l];
  const crs = b.crNum.map((n, i) => n / b.crDen[i]);
  out3[l] = { cr: mean(crs), crWorst: Math.max(...crs), s5: mean(b.s5), min5: b.min5, s10: mean(b.s10), min10: b.min10,
    belowZeroScenarios: b.belowZeroScenarios, belowZeroWorlds: b.belowZeroWorlds, deficientYears: b.deficientYears,
    loanWorlds: b.loanWorlds, worlds: b.worlds, reinsCost: b.reinsCost, reinsRecovered: b.reinsRecovered };
  console.log(`   ${l.padEnd(9)}CR ${(100 * mean(crs)).toFixed(1)}% (worst ${(100 * Math.max(...crs)).toFixed(1)}%) · `
    + `Y5 ${fmtM(mean(b.s5))} / ${fmtM(b.min5)} · Y10 ${fmtM(mean(b.s10))} / ${fmtM(b.min10)} · `
    + `avg ever <0: ${b.belowZeroScenarios} scen · worlds ever <0: ${b.belowZeroWorlds}/${b.worlds} · `
    + `Deficient: ${b.deficientYears}/${SCENARIOS * YEARS} · loan worlds: ${b.loanWorlds}/${b.worlds} · `
    + `reins paid ${fmtM(b.reinsCost)} recovered ${fmtM(b.reinsRecovered)} (booked, per scenario-avg sum)`);
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ fired, tClaims, cover2, out3 }, null, 1));
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s`);
