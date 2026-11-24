// ============================================================================
// THE POOL'S MARKET SHARE IS THE AVERAGE OF THE LINE SHARES — A GATE
// (pr/pool-share-average).
//
//   npx tsx scripts/diagnostics/pool-share-average-check.ts
//
// A hosted team's market share on the pool is the simple AVERAGE of its line
// market shares, over the lines in the room — each line's share being its
// share of the room's exposure on that line. It was its share of the room's
// premium. Here, on rooms built so the two measures disagree:
//
//   1. WORKED OUT (roomSharesFor): every team's pool share is recomputed here,
//      from its own and the room's exposures, as the average of its line shares
//      — never from premium — and the set matches, line by line and on the
//      pool. The brief's example: 52% WC, 48% GL, 50% Property reads 50%.
//   2. A ONE-LINE ROOM: the pool share is the WC share.
//   3. READ BACK (shownShares): a set stored BEFORE the change, its pool still
//      the premium share, reads back as the average — the screens, the
//      downloads and the top bar all read through it.
//   4. THE READERS: the host's and the Market Survey's (standingsRows.shareOf)
//      and a hosted team's (roomShareFor, CallerView) give the same figure.
//
// ⚠ AND IT FAILS WHEN BROKEN — controls: the old premium share put back as
// the pool share, and a read-back that keeps the stored pool unchanged, must
// each fail 1-4's grading.
// ============================================================================
import { poolShareOf, roomSharesFor, roomShareFor, shownShares, type RoomSharesByYear, type ShareTeam } from '../../src/session/marketShares';
import { shareOf } from '../../src/session/standingsRows';
import type { RoomMarketShares, TeamYearSummary } from '../../src/session/contract';
import type { CoverageLine } from '../../src/types/simulation';

const failures: string[] = [];
const check = (ok: boolean, label: string, detail = '') => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-12;
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

/** A posted year as the share reads it: each line's exposure, and the pool's premium. */
function summary(exposure: Partial<Record<CoverageLine, number>>, premium: number): TeamYearSummary {
  return {
    pool: { poolPremium: premium },
    byLine: Object.fromEntries(Object.entries(exposure).map(([l, e]) => [l, { activeExposure: e }])),
  } as unknown as TeamYearSummary;
}
interface RoomSpec { name: string; lines: CoverageLine[]; teams: { name: string; exposure: Partial<Record<CoverageLine, number>>; premium: number }[] }

const ROOMS: RoomSpec[] = [
  {
    // The brief's example for Harbour: 52% WC, 48% GL, 50% Property -> 50%. Its premium share is 75%.
    name: 'three lines, two teams', lines: ['WC', 'GL', 'Property'],
    teams: [
      { name: 'Harbour', exposure: { WC: 52, GL: 48, Property: 50 }, premium: 300 },
      { name: 'Cedar', exposure: { WC: 48, GL: 52, Property: 50 }, premium: 100 },
    ],
  },
  {
    name: 'three lines, three teams, uneven', lines: ['WC', 'GL', 'Property'],
    teams: [
      { name: 'Harbour', exposure: { WC: 900, GL: 20, Property: 40 }, premium: 5_000_000 },
      { name: 'Cedar', exposure: { WC: 300, GL: 70, Property: 35 }, premium: 3_000_000 },
      { name: 'Tri-County', exposure: { WC: 800, GL: 10, Property: 25 }, premium: 9_000_000 },
    ],
  },
  {
    name: 'WC only', lines: ['WC'],
    teams: [
      { name: 'Harbour', exposure: { WC: 610 }, premium: 2_000_000 },
      { name: 'Cedar', exposure: { WC: 390 }, premium: 6_000_000 },
    ],
  },
];

const teamsOf = (r: RoomSpec, year: number): ShareTeam[] => r.teams.map(t => ({
  name: t.name, lockedYear: true, results: { [String(year)]: summary(t.exposure, t.premium) },
}));

/** Every way a set differs from the shares worked out here — the line shares from exposure, the pool their average. */
function grade(r: RoomSpec, set: RoomMarketShares | null | undefined): string[] {
  const out: string[] = [];
  if (!set) return ['no set'];
  for (const t of r.teams) {
    const got = set.byTeam[t.name];
    if (!got) { out.push(`${t.name}: no share`); continue; }
    const lineShares = r.lines.map(l => t.exposure[l]! / r.teams.reduce((a, u) => a + u.exposure[l]!, 0));
    r.lines.forEach((l, k) => { if (!near(got.byLine[l] ?? NaN, lineShares[k])) out.push(`${t.name} ${l}: ${got.byLine[l]} ≠ ${lineShares[k]}`); });
    const want = lineShares.reduce((a, v) => a + v, 0) / lineShares.length;
    if (!near(got.pool, want)) out.push(`${t.name} pool: ${pct(got.pool)} ≠ the average of its line shares ${pct(want)}`);
    // The readers: the tables' (shareOf) and a hosted team's own (roomShareFor).
    const viaTable = shareOf(set, t.name, 'pool')?.value;
    const viaTeam = roomShareFor({ year: set.year, pool: got.pool, byLine: got.byLine }, set.year, 'pool');
    if (viaTable === undefined || !near(viaTable, want)) out.push(`${t.name}: the tables read ${viaTable}`);
    if (viaTeam === undefined || !near(viaTeam, want)) out.push(`${t.name}: the team's own share reads ${viaTeam}`);
  }
  return out;
}

/** The premium share — what the pool was until this change — for the controls. */
function premiumSet(r: RoomSpec, year: number): RoomMarketShares {
  const set = roomSharesFor(year, teamsOf(r, year), r.lines)!;
  const total = r.teams.reduce((a, t) => a + t.premium, 0);
  return { year, byTeam: Object.fromEntries(r.teams.map(t => [t.name, { ...set.byTeam[t.name], pool: t.premium / total }])) };
}

console.log('THE POOL\'S MARKET SHARE — the average of the team\'s line shares');
for (const r of ROOMS) {
  const set = roomSharesFor(1, teamsOf(r, 1), r.lines);
  const d = grade(r, set);
  const premium = premiumSet(r, 1);
  const shown = r.teams.map(t => `${t.name} ${pct(set!.byTeam[t.name].pool)} (premium ${pct(premium.byTeam[t.name].pool)})`).join(', ');
  check(d.length === 0, `1${r.lines.length === 1 ? '-2' : ''}. ${r.name}: worked out, every team's pool is the average of its line shares, and every reader agrees`, d[0] ?? shown);
}
{
  const ex = roomSharesFor(1, teamsOf(ROOMS[0], 1), ROOMS[0].lines)!.byTeam.Harbour;
  check(near(ex.byLine.WC!, 0.52) && near(ex.byLine.GL!, 0.48) && near(ex.byLine.Property!, 0.5) && near(ex.pool, 0.5),
    '1. the brief\'s example: 52% WC, 48% GL, 50% Property reads 50% on the pool', `${pct(ex.pool)}`);
  const wc = roomSharesFor(1, teamsOf(ROOMS[2], 1), ROOMS[2].lines)!.byTeam.Harbour;
  check(near(wc.pool, wc.byLine.WC!) && near(wc.pool, 0.61), '2. a WC-only room: the pool is the WC share', `${pct(wc.pool)} = WC ${pct(wc.byLine.WC!)}`);
}
// 3. A set stored before the change (its pool the premium share) reads back as the average.
for (const r of ROOMS) {
  const legacy = premiumSet(r, 1);
  const stored: RoomSharesByYear = { '1': legacy.byTeam };
  const shown = shownShares({ currentYear: 2, yearCount: 5 }, stored);
  const d = grade(r, shown);
  check(d.length === 0, `3. ${r.name}: a set stored with the premium share reads back as the average`, d[0] ?? 'every team');
}
check(near(poolShareOf({}), 0), 'a team with no line share reads 0, as an empty set did before');

console.log('\nCONTROLS — each must FAIL');
for (const r of ROOMS.slice(0, 2)) {
  const d = grade(r, premiumSet(r, 1));
  check(d.length > 0, `control: ${r.name}, the premium share put back as the pool share`, d[0] ?? 'NOTHING FIRED');
}
{
  // A read-back that keeps the stored pool unchanged: the legacy set as stored.
  const r = ROOMS[0];
  const legacy = premiumSet(r, 1);
  const unchanged: RoomMarketShares = { year: 1, byTeam: structuredClone(legacy.byTeam) };
  const d = grade(r, unchanged);
  check(d.length > 0, 'control: a read-back that keeps a stored premium share', d[0] ?? 'NOTHING FIRED');
}

console.log('');
if (failures.length) { console.log(`${failures.length} CHECK(S) FAILED:\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('PASS — the pool\'s market share is the average of the team\'s line shares, worked out and read back, and every reader agrees.');
