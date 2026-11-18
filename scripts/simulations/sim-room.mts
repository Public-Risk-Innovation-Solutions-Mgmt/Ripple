// ============================================================================
// ONE HOSTED ROOM, PLAYED ON THE REAL SESSION PATH — the market-measurement
// harness. Not a gate: it measures, it does not pass or fail.
//
// LocalSessionTransport (an in-memory localStorage), createRoom / join / submit
// with each team's market lock / advance (the server's market step) / read,
// then each team's own game replayed with replayTeamYears on its stored market
// results — exactly what a browser does. Room codes and tokens are drawn from
// a seeded stream, so a room plays the same market draws on every run.
//
//   ROOT   the checkout to play (default: this repository)
//   SCEN   the scenario / room seed (default 6)
//   YEARS  years to play (default 5)
//   DEV    development level on every line: Low | Mid | High (default Low)
//   MARKET off | low | medium | high (default medium)
//   SCHED  the host's shock schedule, JSON [{"shockId":"#4","yearNumber":2}, ...] (default none)
//   TEAMS  JSON [{"name","funding":"expected"|0.65,"cover":"$9M xs $1M"|"none","agg":"agg-110-50"|"none",
//                 "newMembers":0.05,"nonRenewal":0}] (default: Expected / 65% / 80%, each with and without covers)
//   OUT    where to write the JSON (required)
//
// Writes, per year and team: year-end pool surplus and combined ratio (from the
// Annual Statement, as the player sees them), and per line the rate, premium,
// gross ultimate, net incurred, prior-year development, reinsurance cost and
// recoveries, and the events in force.
//
//   npx tsx scripts/simulations/sim-room.mts            (with the env above)
// ============================================================================
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCEN = process.env.SCEN ?? '6';
const YEARS = Number(process.env.YEARS ?? 5);
const DEV = process.env.DEV ?? 'Low';
const MARKET = process.env.MARKET ?? 'medium';
const OUT = process.env.OUT;
if (!OUT) throw new Error('sim-room: set OUT');
const SCHED: { shockId: string; yearNumber: number }[] = JSON.parse(process.env.SCHED ?? '[]');
interface TeamPlan { name: string; funding: 'expected' | number; cover?: string; agg?: string; newMembers?: number; nonRenewal?: number }
const TEAMS: TeamPlan[] = process.env.TEAMS ? JSON.parse(process.env.TEAMS) : [
  { name: 'Expected · none', funding: 'expected' }, { name: 'Expected · covers', funding: 'expected', cover: '$9M xs $1M', agg: 'agg-110-50' },
  { name: '65% · none', funding: 0.65 }, { name: '65% · covers', funding: 0.65, cover: '$9M xs $1M', agg: 'agg-110-50' },
  { name: '80% · none', funding: 0.80 }, { name: '80% · covers', funding: 0.80, cover: '$9M xs $1M', agg: 'agg-110-50' },
];

// The room lives in localStorage, as in a browser: an in-memory one here (the market gate's shim).
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
// Fixed room codes and tokens: the market's draws are keyed on the room code.
{
  let s = (0x9e3779b9 ^ Number(SCEN)) >>> 0;
  const orig = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  (globalThis.crypto as unknown as { getRandomValues: (a: unknown) => unknown }).getRandomValues = (a: unknown) => {
    if (!(a instanceof Uint8Array)) return orig(a as Uint8Array);
    for (let i = 0; i < a.length; i++) { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; a[i] = s & 0xff; }
    return a;
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const { LocalSessionTransport } = await import(`${ROOT}/src/session/localTransport.ts`);
const { newSessionToken } = await import(`${ROOT}/src/session/contract.ts`);
const { marketByYearForEngine } = await import(`${ROOT}/src/session/market.ts`);
const { buildTeamGame, replayTeamYears } = await import(`${ROOT}/src/session/client/buildGame.ts`);
const { marketLockInputFor } = await import(`${ROOT}/src/session/client/marketLock.ts`);
const { decisionsToJson } = await import(`${ROOT}/src/session/client/decisions.ts`);
const { defaultDecisionSet } = await import(`${ROOT}/src/utils/decisionDefaults.ts`);
const { buildAnnualStatement, topSurplus, newestCombinedRatio } = await import(`${ROOT}/src/utils/resultsStatement.ts`);

const LINES = ['WC', 'GL', 'Property'] as const;
const t = new LocalSessionTransport({ latencyMs: 0 });
const host = newSessionToken();
const made = await t.createRoom({ hostToken: host, seed: SCEN, yearCount: YEARS, startingYear: 2027, eventName: `Sim ${SCEN}`,
  expectedTeams: TEAMS.length, lines: [...LINES], developmentLevels: { WC: DEV, GL: DEV, Property: DEV },
  shocks: SCHED, market: MARKET });
const teams: any[] = [];
for (let i = 0; i < TEAMS.length; i++) {
  const j = await t.join({ code: made.code, teamName: `T${String(i + 1).padStart(2, '0')}`, role: 'player' });
  teams.push({ plan: TEAMS[i], token: j.teamToken, hist: {} as Record<string, unknown> });
}
const base = buildTeamGame((await t.read({ code: made.code, token: host })).room, [...LINES]).gameState;
for (const tm of teams) tm.gs = base;
const opening = topSurplus(buildAnnualStatement(base, 'pool')) ?? null;
const rows: any[] = [];
for (let y = 1; y <= YEARS; y++) {
  for (const tm of teams) {
    const p: TeamPlan = tm.plan;
    const d = defaultDecisionSet(y, true);
    for (const l of LINES) {
      d.byLine[l] = { ...d.byLine[l],
        ...(p.funding === 'expected' ? { fundingAtExpected: true } : { fundingAtExpected: false, fundingConfidenceLevel: p.funding }),
        newMembers: p.newMembers ?? 0.05, nonRenewal: p.nonRenewal ?? 0, riskControlIncentivePct: 0,
        reinsuranceOption: p.cover ?? 'none', aggregateCover: p.agg ?? 'none' };
    }
    tm.hist[String(y)] = decisionsToJson(d);
    const m = marketLockInputFor(tm.gs, d, y);
    await t.submit({ code: made.code, token: tm.token, yearNumber: y, decisions: tm.hist[String(y)], ...(m ? { market: m } : {}) });
  }
  await t.advance({ code: made.code, token: host, expectedYear: y });
  const yr: any[] = [];
  for (const tm of teams) {
    const me = await t.read({ code: made.code, token: tm.token });
    const r = replayTeamYears(tm.gs, y + 1, tm.hist, marketByYearForEngine(me.you?.marketByYear));
    tm.gs = r.state;
    const res = r.produced.at(-1)!.result;
    const ps = buildAnnualStatement(tm.gs, 'pool');
    const per: any = { team: tm.plan.name, surplus: topSurplus(ps) ?? null, cr: newestCombinedRatio(ps)?.value ?? null, lines: {} };
    for (const l of LINES) {
      const x = res.byLine[l];
      if (!x) continue;
      per.lines[l] = {
        rate: x.finalRatePer100, premium: x.totalMemberCharge, grossUltimate: x.grossUltimateLoss, netIncurred: x.netIncurredLoss,
        priorDev: x.priorYearDevelopment, reinsuranceCost: x.reinsuranceCost ?? 0, reinsuranceRecovery: x.reinsuranceRecovery ?? 0,
        aggRecovery: x.aggregateRecovery ?? 0, exposure: x.activeExposure,
        market: me.you?.marketByYear?.[String(y)]?.[l] ?? null,
        events: (x.shockEvents ?? []).map((e: any) => `${e.eventName ?? e.name}@${e.yearFired}`),
      };
    }
    yr.push(per);
  }
  rows.push({ year: y, teams: yr });
  process.stderr.write(`scen ${SCEN} year ${y} done\n`);
}
writeFileSync(OUT, JSON.stringify({ scen: SCEN, dev: DEV, market: MARKET, sched: SCHED, opening, teams: TEAMS, rows }));
process.stderr.write(`written ${OUT}\n`);
