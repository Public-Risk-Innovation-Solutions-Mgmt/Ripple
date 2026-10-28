// ============================================================================
// THE YEAR WALKTHROUGH — one played year, draw by draw and step by step, with a
// short code on each so two players can find the first place their games part.
//
// Two players in the same scenario who make the same decisions must get the
// same game. This lays a year out in the engine's own order — the draws the
// model made, then eleven steps from expected losses to ending surplus — and
// hashes each block's figures into a code ("7F3A-91C2"). Compare codes top to
// bottom: the first that differs is where the games part.
//
// ⚠ IT COMPUTES NOTHING NEW. Every figure is one the engine recorded, read off
// the year's averaged row, the worlds' own rows, the reserve ledger, or a
// parameter. Where the engine does not keep a draw on any row — the members'
// risk scores and luck, each asset class's market return, the admin overrun,
// the development rate λ — it is READ OFF THE ENGINE'S OWN STREAM with the
// engine's own function (the same call, on the same seed and label, that the
// engine made), as the Calculation Audit already does for the market; the
// gate (year-walkthrough-check) holds each re-read to what the engine booked.
//
// ⚠ THE WORLDS' OWN ROWS ARE KEPT FOR THE LATEST YEAR ONLY (WorldState: every
// world keeps its last row; world 1 every row). The figures that exist only
// per world — normal losses, each event's surge, the large claims — show for
// the latest played year and are marked as not kept for an earlier one.
//
// ⚠ THE SEED IS NOT SHOWN HERE. The header (walkthroughHeader) carries the
// version always and the scenario's fixed seed only when the caller says so —
// Test player and the host, never single player or a team (see GameShell).
// ============================================================================

import type {
  CoverageLine, GameInstance, GameState, LineResultSet, LineView, ResultSet,
} from '../types/simulation';
import {
  ADMIN_SHARE_OF_PREMIUM, ADVERSE_DEVELOPMENT, MEMBER_LUCK_CV, MEMBER_RISK_CV, UNDERWRITING_MEMBERS,
} from '../data/pricingParameters';
import { REINSURANCE_TOWER, type TowerLine } from '../data/reinsuranceTower';
import { SAVE_KEY } from './gameSave';
import { drawOrdinaryFactor, memberLuckRng, memberRiskRng, ordinaryLossCostPer100 } from './ordinaryLoss';
import { adminOverrunFor } from './adminOverrun';
import { adverseDevelopmentRate, developmentLevelOf } from './adverseDevelopment';
import { simulateMarketReturns } from './investmentEngine';
import { deriveSubRng } from './random';
import { applyMarketShock, eventLines, resolveShockYear, shockTimingOf, SHOCK_EVENTS } from './shockLosses';
import { placementFor } from './reinsuranceOptions';
import { marketSeedOf } from './bookUnits';
import { worldInstance } from './worlds';
import { knownResults } from './knownYears';
import { LINE_FULL_NAME } from './lineDisplay';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** How a figure is shown and hashed: dollars to the cent, everything else to ten significant figures. */
export type WalkKind = 'usd' | 'pct' | 'factor' | 'per100' | 'exposure' | 'count' | 'text';

export interface WalkRow {
  label: string;
  /** null: the engine keeps no such figure for this year (see `note`). */
  value: number | string | null;
  kind: WalkKind;
}

export interface WalkBlock {
  id: string;
  title: string;
  /** True: the same for everyone in this scenario. False: depends on the player's decisions. */
  same: boolean;
  rows: WalkRow[];
  note?: string;
  code: string;
}

export interface YearWalkthrough {
  yearNumber: number;
  /** The program year's calendar year, as every result screen labels it. */
  calendarYear: number;
  view: LineView;
  /** Whether the worlds' own rows are kept for this year (the latest played year). */
  perWorld: boolean;
  worlds: number;
  draws: WalkBlock[];
  drawsCode: string;
  steps: WalkBlock[];
  /** The year's decisions, every line and the pool-wide ones — the same whatever the view. */
  decisionsCode: string;
  /** Every view's draws and steps — the same whatever the view. */
  yearCode: string;
}

export interface WalkthroughHeader {
  /** The game's version: the save key every save of this build is written under. */
  version: string;
  /** The scenario's fixed seed — present only where the caller may show it. */
  seed?: string;
  scenario?: number;
}

const SAME = 'Same for everyone in this scenario';
const DEPENDS = 'Depends on your decisions';
export const walkMark = (same: boolean): string => (same ? SAME : DEPENDS);
const NOT_KEPT = 'The engine keeps this per world for the latest played year only.';

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/** A figure as hashed: dollars to the cent, the rest to ten significant figures, so float noise in the last bits does not split two identical games. */
function canonical(r: WalkRow): string {
  if (r.value === null) return '—';
  if (typeof r.value === 'string') return r.value;
  if (!Number.isFinite(r.value)) return String(r.value);
  if (r.kind === 'usd') return (Math.round(r.value * 100) / 100).toFixed(2);
  return r.value === 0 ? '0' : Number(r.value.toPrecision(10)).toString();
}

/** FNV-1a over the text, twice with different offsets: "XXXX-XXXX". */
export function walkCode(text: string): string {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
  }
  const hex = ((a ^ (b >>> 7)) >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

const rowsCode = (id: string, rows: WalkRow[]): string =>
  walkCode(`${id}\n${rows.map(r => `${r.label}=${canonical(r)}`).join('\n')}`);

function block(id: string, title: string, same: boolean, rows: WalkRow[], note?: string): WalkBlock {
  return { id, title, same, rows, ...(note ? { note } : {}), code: rowsCode(id, rows) };
}

/** Sorted-key JSON, so an object's code does not follow its key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

// ---------------------------------------------------------------------------
// Header and years
// ---------------------------------------------------------------------------

/**
 * The walkthrough's header. ⚠ `showSeed` is the caller's: Test player and the
 * host pass true, single player and a hosted team never do. A bare harness id
 * (no scenario) has no fixed seed to show.
 */
export function walkthroughHeader(instance: Pick<GameInstance, 'instanceId' | 'scenario'>, showSeed: boolean): WalkthroughHeader {
  return {
    version: SAVE_KEY,
    ...(instance.scenario !== undefined ? { scenario: instance.scenario } : {}),
    ...(showSeed && instance.scenario !== undefined ? { seed: instance.instanceId } : {}),
  };
}

/** The played years the walkthrough offers: the known ones (the results rule), newest last. */
export function walkthroughYears(gs: GameState): number[] {
  return knownResults(gs, gs.lockedResults).filter(r => r.yearNumber >= 1).map(r => r.yearNumber);
}

// ---------------------------------------------------------------------------
// What the engine recorded for one year
// ---------------------------------------------------------------------------

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

interface YearSource {
  gs: GameState;
  y: number;
  row: ResultSet;
  prior: ResultSet | undefined;
  /** Each world's own row for the year, or null where they are not kept. */
  worldRows: ResultSet[] | null;
  instances: GameInstance[];
  gameSeed: number;
}

function sourceFor(gs: GameState, y: number): YearSource {
  const row = gs.lockedResults.find(r => r.yearNumber === y);
  if (!row) throw new Error(`yearWalkthrough: year ${y} has not been played`);
  const prior = [...gs.priorHistory, ...gs.lockedResults].find(r => r.yearNumber === y - 1);
  let worldRows: ResultSet[] | null;
  if (gs.worlds && gs.worlds.length > 0) {
    const rows = gs.worlds.map(w => w.lockedResults.find(r => r.yearNumber === y));
    worldRows = rows.every((r): r is ResultSet => !!r) ? rows : null;
  } else {
    worldRows = [row];
  }
  const n = gs.worlds?.length ?? 1;
  const instances = Array.from({ length: n }, (_, i) => worldInstance(gs.instance, i));
  return { gs, y, row, prior, worldRows, instances, gameSeed: marketSeedOf(gs.instance) };
}

const lineRowsOf = (s: YearSource, l: CoverageLine): LineResultSet[] | null =>
  s.worldRows ? s.worldRows.map(r => r.byLine[l]).filter(Boolean) : null;

/** The members' risk scores this year — the game's stream, the same in every world. */
function memberRisk(s: YearSource, l: CoverageLine): number[] {
  const rng = memberRiskRng(s.gameSeed, s.y, l);
  return Array.from({ length: UNDERWRITING_MEMBERS }, () => drawOrdinaryFactor(rng, MEMBER_RISK_CV));
}

/** One world's members' luck this year — that world's stream. */
function memberLuck(seed: number, y: number, l: CoverageLine): number[] {
  const rng = memberLuckRng(seed, y, l);
  return Array.from({ length: UNDERWRITING_MEMBERS }, () => drawOrdinaryFactor(rng, MEMBER_LUCK_CV));
}

/** Each world's market this year, with the year's Investment Loss — as the engine takes it. */
function markets(s: YearSource): { cash: number; bonds: number; equities: number }[] {
  const timing = shockTimingOf(s.gs.setup);
  return s.instances.map(inst => {
    const drawn = simulateMarketReturns(deriveSubRng(inst.seed, s.y, 'invest'));
    return applyMarketShock(drawn, resolveShockYear(inst, timing, s.y).marketShock);
  });
}

/** The accident years open at the start of the year — the prior year-end's reserve split. */
const openAccidentYears = (s: YearSource, l: CoverageLine): number[] =>
  (s.prior?.byLine[l]?.reserveSplitByYear ?? []).map(a => a.yearNumber).filter(a => a < s.y);

/** Each accident year's development this year, off the reserve ledger: its ultimate at this valuation less the last. */
function developmentByYear(s: YearSource, l: CoverageLine): { ay: number; amount: number }[] {
  const out: { ay: number; amount: number }[] = [];
  for (const r of s.gs.poolState.lines[l]?.reserveDevelopment ?? []) {
    if (r.yearNumber >= s.y) continue;
    const v = s.y - r.firstValuationYear;
    const u = r.ultimateByValuation;
    if (v >= 1 && v < u.length) out.push({ ay: r.yearNumber, amount: u[v] - u[v - 1] });
  }
  return out.sort((a, b) => a.ay - b.ay);
}

const ayLabel = (s: YearSource, ay: number): string => `Accident year ${s.gs.setup.startingYear + ay - 1}`;

// ---------------------------------------------------------------------------
// The draws, per line
// ---------------------------------------------------------------------------

function lineDraws(s: YearSource, l: CoverageLine): WalkBlock[] {
  const a = s.row.byLine[l];
  const tag = (t: string) => `${LINE_FULL_NAME[l]}: ${t}`;
  const out: WalkBlock[] = [];

  out.push(block(`draw-year-${l}`, tag('year factor'), true, [
    { label: 'Year factor (average across the worlds)', value: a.commonLossFactor, kind: 'factor' },
  ]));

  const risk = memberRisk(s, l);
  const luck = s.instances.map(inst => mean(memberLuck(inst.seed, s.y, l)));
  out.push(block(`draw-members-${l}`, tag('members'), true, [
    { label: `Member risk score (average of ${UNDERWRITING_MEMBERS} members)`, value: mean(risk), kind: 'factor' },
    { label: `Member luck (average of ${UNDERWRITING_MEMBERS} members and the worlds)`, value: mean(luck), kind: 'factor' },
  ]));

  out.push(block(`draw-expense-${l}`, tag('ALAE ratio and admin overrun'), true, [
    { label: 'ALAE ratio', value: a.alaeRatio ?? null, kind: 'pct' },
    { label: 'Admin overrun', value: adminOverrunFor(s.gameSeed, s.y, l), kind: 'pct' },
  ]));

  // The shocks: the year's schedule, then each event in force on this line.
  const schedule = (s.gs.instance.scheduledShocks ?? []).filter(x => x.yearNumber === s.y);
  const shockRows: WalkRow[] = [
    { label: 'Schedule this year', value: schedule.length ? schedule.map(x => x.shockId).join(', ') : 'none', kind: 'text' },
  ];
  const wl = lineRowsOf(s, l);
  for (const e of a.shockEvents ?? []) {
    const catalogueName = SHOCK_EVENTS.find(x => x.id === e.shockId)?.name ?? e.name;
    const lv = eventLines(catalogueName).find(r => r.line === l);
    shockRows.push({ label: `${e.name} — level`, value: lv ? `A ${lv.a} / T ${lv.t} / R ${lv.r}` : (e.band ?? '—'), kind: 'text' });
    shockRows.push({ label: `${e.name} — region`, value: e.region ?? 'pool-wide', kind: 'text' });
    const surge = wl ? mean(wl.map(r => (r.newLossEngine?.events ?? []).filter(x => x.id === e.shockId).reduce((t, x) => t + x.uplift, 0))) : null;
    shockRows.push({ label: `${e.name} — surge %`, value: surge, kind: 'pct' });
    const claims = wl ? wl.flatMap(r => (r.claims ?? []).filter(c => c.tier === 'shock' && c.shockId === e.shockId)) : null;
    shockRows.push({
      label: `${e.name} — large-claim size (average)`,
      value: claims ? (claims.length ? mean(claims.map(c => c.grossUltimate)) : 0) : null, kind: 'usd',
    });
  }
  out.push(block(`draw-shocks-${l}`, tag('shocks'), true, shockRows, wl ? undefined : NOT_KEPT));

  // λ for each older accident year open at the start of the year.
  const level = ADVERSE_DEVELOPMENT.enabled ? developmentLevelOf(s.gs.setup, l) : null;
  const lambdaRows: WalkRow[] = [{ label: 'Level', value: level ?? 'None', kind: 'text' }];
  if (level) {
    for (const ay of openAccidentYears(s, l)) {
      lambdaRows.push({ label: `${ayLabel(s, ay)} — λ`, value: adverseDevelopmentRate(s.gameSeed, l, level, s.y, ay), kind: 'pct' });
    }
  }
  out.push(block(`draw-lambda-${l}`, tag('development rate λ'), true, lambdaRows));
  return out;
}

function marketDraw(s: YearSource): WalkBlock {
  const m = markets(s);
  return block('draw-market', 'Market returns', true, [
    { label: 'Cash (average across the worlds)', value: mean(m.map(x => x.cash)), kind: 'pct' },
    { label: 'Bonds (average across the worlds)', value: mean(m.map(x => x.bonds)), kind: 'pct' },
    { label: 'Equities (average across the worlds)', value: mean(m.map(x => x.equities)), kind: 'pct' },
  ]);
}

// ---------------------------------------------------------------------------
// The eleven steps, per line
// ---------------------------------------------------------------------------

interface LineSteps { rows: WalkRow[][]; notes: (string | undefined)[]; totals: (number | null)[] }

function lineSteps(s: YearSource, l: CoverageLine): LineSteps {
  const a = s.row.byLine[l];
  const wl = lineRowsOf(s, l);
  const nle = wl ? wl.map(r => r.newLossEngine).filter((x): x is NonNullable<typeof x> => !!x) : null;
  const perWorld = !!nle && nle.length > 0;
  const rows: WalkRow[][] = [];
  const notes: (string | undefined)[] = [];
  const totals: (number | null)[] = [];

  // 1. Expected baseline losses.
  const exposure = a.billedExposure ?? a.activeExposure;
  const cost = ordinaryLossCostPer100(l, s.y);
  const expected = perWorld ? mean(nle!.map(x => x.ordinaryExpected)) : exposure * 10_000 * cost;
  rows.push([
    { label: 'Exposure ($M)', value: exposure, kind: 'exposure' },
    { label: 'Cost per $100', value: cost, kind: 'per100' },
    { label: 'Expected baseline losses', value: expected, kind: 'usd' },
  ]);
  notes.push(undefined); totals.push(expected);

  // 2. Normal losses — underwriting's factor, the year factor, member risk and luck.
  if (perWorld) {
    const risk = memberRisk(s, l);
    const under = wl!.map((r, i) => {
      const luck = memberLuck(s.instances[i].seed, s.y, l);
      const m = mean(luck.map((u, k) => u * risk[k]));
      return r.newLossEngine!.ordinaryFactor / (r.commonLossFactor * m);
    });
    const normal = mean(nle!.map(x => x.ordinaryExpected * x.ordinaryFactor));
    rows.push([
      { label: "Underwriting's one-year factor", value: mean(under), kind: 'factor' },
      { label: 'Year factor', value: a.commonLossFactor, kind: 'factor' },
      { label: 'Combined factor (with member risk and luck)', value: mean(nle!.map(x => x.ordinaryFactor)), kind: 'factor' },
      { label: 'Normal losses', value: normal, kind: 'usd' },
    ]);
    notes.push(undefined); totals.push(normal);
  } else {
    rows.push([
      { label: 'Year factor', value: a.commonLossFactor, kind: 'factor' },
      { label: 'Normal losses', value: null, kind: 'usd' },
    ]);
    notes.push(NOT_KEPT); totals.push(null);
  }

  // 3. Shock surges (A).
  const events = a.shockEvents ?? [];
  if (perWorld) {
    const after = mean(nle!.map(x => x.ordinaryRealised));
    rows.push([
      ...events.map(e => ({
        label: `${e.name} — surge %`,
        value: mean(nle!.map(x => x.events.filter(v => v.id === e.shockId).reduce((t, v) => t + v.uplift, 0))), kind: 'pct' as const,
      })),
      { label: 'Total surge %', value: mean(nle!.map(x => x.uplift)), kind: 'pct' },
      { label: 'Losses after surges', value: after, kind: 'usd' },
    ]);
    notes.push(undefined); totals.push(after);
  } else {
    rows.push([
      ...events.map(e => ({ label: `${e.name}`, value: 'in force', kind: 'text' as const })),
      { label: 'Losses after surges', value: null, kind: 'usd' },
    ]);
    notes.push(NOT_KEPT); totals.push(null);
  }

  // 4. Large claims (T) — each event's claims, and routine large claims.
  if (perWorld) {
    const n = wl!.length;
    const tRows: WalkRow[] = [];
    for (const e of events) {
      const cs = wl!.flatMap(r => (r.claims ?? []).filter(c => c.tier === 'shock' && c.shockId === e.shockId));
      if (cs.length === 0) continue;
      tRows.push({ label: `${e.name} — claims per world`, value: cs.length / n, kind: 'count' });
      tRows.push({ label: `${e.name} — average claim size`, value: mean(cs.map(c => c.grossUltimate)), kind: 'usd' });
    }
    const large = mean(nle!.map(x => x.shockLarge + x.routineLarge));
    rows.push([
      ...tRows,
      { label: 'Event large claims (T)', value: mean(nle!.map(x => x.shockLarge)), kind: 'usd' },
      { label: 'Routine large claims', value: mean(nle!.map(x => x.routineLarge)), kind: 'usd' },
      { label: 'Gross losses this year', value: a.grossUltimateLoss, kind: 'usd' },
    ]);
    notes.push(undefined); totals.push(large);
  } else {
    rows.push([{ label: 'Gross losses this year', value: a.grossUltimateLoss, kind: 'usd' }]);
    notes.push(NOT_KEPT); totals.push(null);
  }

  // 5. Reinsurance.
  const option = a.decisions?.reinsuranceOption ?? 'none';
  let placed: boolean[] = [];
  try { placed = placementFor(l, option); } catch { placed = []; }
  const tower = REINSURANCE_TOWER[l as TowerLine] ?? [];
  rows.push([
    { label: 'Cover', value: option, kind: 'text' },
    ...tower.flatMap((t, i) => (placed[i] ? [{ label: `Recovery, ${t.name}`, value: a.cededByLayer[i] ?? 0, kind: 'usd' as const }] : [])),
    ...(a.aggregateRecovery ? [{ label: 'Recovery, aggregate', value: a.aggregateRecovery, kind: 'usd' as const }] : []),
    { label: 'Reinsurance premium', value: a.reinsuranceCost, kind: 'usd' },
    { label: 'Total recovery', value: a.reinsuranceRecovery, kind: 'usd' },
    { label: 'Gross losses', value: a.grossUltimateLoss, kind: 'usd' },
    { label: 'Net retained', value: a.netUltimateLoss, kind: 'usd' },
  ]);
  notes.push('Recoveries are recorded by layer, not per claim.'); totals.push(a.netUltimateLoss);

  // 6. Development on older years, by accident year (adverse positive).
  const dev = developmentByYear(s, l);
  rows.push([
    ...dev.map(d => ({ label: ayLabel(s, d.ay), value: d.amount, kind: 'usd' as const })),
    { label: 'Total development (adverse +)', value: -a.priorYearDevelopment, kind: 'usd' },
  ]);
  notes.push(undefined); totals.push(-a.priorYearDevelopment);

  // 7. LAE.
  rows.push([
    { label: 'ALAE ratio', value: a.alaeRatio ?? null, kind: 'pct' },
    { label: 'ALAE', value: a.alaeIncurred, kind: 'usd' },
    { label: 'ULAE', value: a.ulaeIncurred, kind: 'usd' },
  ]);
  notes.push(undefined); totals.push(a.alaeIncurred + a.ulaeIncurred);

  // 8. Premium: the rate and its build, x exposure.
  const rate = a.finalRatePer100 ?? a.ratePer100;
  rows.push([
    ...(a.newPurePremiumPer100 !== undefined ? [{ label: 'Pure premium per $100', value: a.newPurePremiumPer100, kind: 'per100' as const }] : []),
    ...(a.firstIndicationPer100 !== undefined ? [{ label: 'First indication per $100', value: a.firstIndicationPer100, kind: 'per100' as const }] : []),
    { label: 'Funding CLF', value: a.selectedFundingCLF, kind: 'factor' },
    { label: 'Rate per $100', value: rate, kind: 'per100' },
    { label: 'Exposure ($M)', value: exposure, kind: 'exposure' },
    { label: 'Premium', value: a.totalMemberCharge, kind: 'usd' },
  ]);
  notes.push(undefined); totals.push(a.totalMemberCharge);

  // 9. Admin.
  rows.push([
    { label: 'Admin share of premium', value: ADMIN_SHARE_OF_PREMIUM[l], kind: 'pct' },
    { label: 'Admin expense', value: a.adminExpense, kind: 'usd' },
    { label: 'Overrun', value: adminOverrunFor(s.gameSeed, s.y, l), kind: 'pct' },
    { label: 'Admin booked', value: a.operatingExpense, kind: 'usd' },
  ]);
  notes.push(undefined); totals.push(a.operatingExpense);

  // 10. Investment income.
  rows.push([
    { label: 'Start-of-year invested assets', value: a.investedAssets, kind: 'usd' },
    { label: 'Mix', value: `cash ${a.assetAllocation.cashPct}% / bonds ${a.assetAllocation.bondsPct}% / equities ${a.assetAllocation.equitiesPct}%`, kind: 'text' },
    { label: 'Return', value: a.investmentReturnRate, kind: 'pct' },
    { label: 'Investment income', value: a.investmentIncome, kind: 'usd' },
  ]);
  notes.push(undefined); totals.push(a.investmentIncome);

  // 11. Surplus.
  rows.push(surplusRows(a));
  notes.push('Net income is after dividends and assessments, as recorded.'); totals.push(a.endingSurplus);

  return { rows, notes, totals };
}

const surplusRows = (r: Pick<LineResultSet, 'beginingSurplus' | 'netIncome' | 'dividends' | 'assessments' | 'endingSurplus'>): WalkRow[] => [
  { label: 'Opening surplus', value: r.beginingSurplus, kind: 'usd' },
  { label: 'Net income', value: r.netIncome, kind: 'usd' },
  { label: 'Dividends', value: r.dividends, kind: 'usd' },
  { label: 'Assessments', value: r.assessments, kind: 'usd' },
  { label: 'Ending surplus', value: r.endingSurplus, kind: 'usd' },
];

export const STEP_TITLES: readonly string[] = [
  'Expected baseline losses',
  'Normal losses',
  'Shock surges (A)',
  'Large claims (T)',
  'Reinsurance',
  'Development on older years',
  'LAE',
  'Premium',
  'Admin',
  'Investment income',
  'Surplus',
];

// ---------------------------------------------------------------------------
// The walkthrough
// ---------------------------------------------------------------------------

function viewOf(s: YearSource, view: LineView): { draws: WalkBlock[]; steps: WalkBlock[] } {
  const lines = s.gs.setup.activeLines;
  if (view !== 'pool') {
    const ls = lineSteps(s, view);
    return {
      draws: [...lineDraws(s, view), marketDraw(s)],
      steps: STEP_TITLES.map((t, i) => block(`step-${i + 1}-${view}`, `${i + 1}. ${t}`, false, ls.rows[i], ls.notes[i])),
    };
  }
  // The pool: each line's rows under its name, then the pool's total.
  const per = lines.map(l => ({ l, ls: lineSteps(s, l) }));
  const steps = STEP_TITLES.map((t, i) => {
    const rows: WalkRow[] = per.flatMap(({ l, ls }) => ls.rows[i].map(r => ({ ...r, label: `${LINE_FULL_NAME[l]}: ${r.label}` })));
    if (i === STEP_TITLES.length - 1) {
      rows.push(...surplusRows(s.row).map(r => ({ ...r, label: `Pool: ${r.label}` })));
    } else {
      const parts = per.map(p => p.ls.totals[i]);
      rows.push({ label: `Pool: ${t}`, value: parts.some(x => x === null) ? null : parts.reduce<number>((a, b) => a + (b ?? 0), 0), kind: 'usd' });
    }
    const note = per.map(p => p.ls.notes[i]).find(Boolean);
    return block(`step-${i + 1}-pool`, `${i + 1}. ${t}`, false, rows, note);
  });
  return { draws: [...lines.flatMap(l => lineDraws(s, l)), marketDraw(s)], steps };
}

/** The year's decisions: the pool-wide ones and each line's, as the year recorded them. */
function decisionsCodeOf(s: YearSource): string {
  const byLine = Object.fromEntries(s.gs.setup.activeLines.map(l => [l, s.row.byLine[l]?.decisions ?? null]));
  return walkCode(`decisions\n${stable({ pool: s.row.pool, byLine })}`);
}

/** One played year's walkthrough for every view — the pool, then each line. */
export function buildYearWalkthroughs(gs: GameState, yearNumber: number): YearWalkthrough[] {
  const s = sourceFor(gs, yearNumber);
  const views: LineView[] = ['pool', ...s.gs.setup.activeLines];
  const all = views.map(v => ({ v, ...viewOf(s, v) }));
  const codesOf = (x: { draws: WalkBlock[]; steps: WalkBlock[] }) => [...x.draws, ...x.steps].map(b => `${b.id}:${b.code}`).join('\n');
  const yearCode = walkCode(all.map(codesOf).join('\n#\n'));
  const decisionsCode = decisionsCodeOf(s);
  return all.map(x => ({
    yearNumber,
    calendarYear: s.row.calendarYear,
    view: x.v,
    perWorld: !!s.worldRows,
    worlds: s.instances.length,
    draws: x.draws,
    drawsCode: walkCode(x.draws.map(b => b.code).join('|')),
    steps: x.steps,
    decisionsCode,
    yearCode,
  }));
}

/** One played year's walkthrough, for the pool or one line (the pool if the line is not played). */
export function buildYearWalkthrough(gs: GameState, yearNumber: number, view: LineView): YearWalkthrough {
  const all = buildYearWalkthroughs(gs, yearNumber);
  return all.find(w => w.view === view) ?? all[0];
}

// ---------------------------------------------------------------------------
// The download's sheet
// ---------------------------------------------------------------------------

/** The value as the sheet writes it: a number, text, or a dash for a figure not kept. */
const cell = (r: WalkRow): string | number => (r.value === null ? '—' : r.value);

/**
 * THE "Year Walkthrough" SHEET: the header (the seed only as `header` carries
 * it), then every known played year, pool and each line, its draws and steps
 * with their codes. Empty when no year has been played.
 */
export function walkthroughSheetRows(gs: GameState, header: WalkthroughHeader): (string | number)[][] {
  const years = walkthroughYears(gs);
  if (years.length === 0) return [];
  const out: (string | number)[][] = [['Year Walkthrough'], ['Version', header.version]];
  if (header.scenario !== undefined) out.push(['Scenario', header.scenario]);
  if (header.seed !== undefined) out.push(['Seed', header.seed]);
  out.push([], ['Year', 'View', 'Block', 'Same or depends', 'Figure', 'Value', 'Code']);
  for (const y of years) {
    for (const w of buildYearWalkthroughs(gs, y)) {
      const viewName = w.view === 'pool' ? 'Pool' : LINE_FULL_NAME[w.view];
      out.push([w.calendarYear, viewName, 'Year code', '', '', '', w.yearCode]);
      out.push([w.calendarYear, viewName, 'Decisions code', '', '', '', w.decisionsCode]);
      out.push([w.calendarYear, viewName, 'Draws code', '', '', '', w.drawsCode]);
      for (const b of [...w.draws, ...w.steps]) {
        out.push([w.calendarYear, viewName, b.title, walkMark(b.same), '', '', b.code]);
        for (const r of b.rows) out.push([w.calendarYear, viewName, b.title, '', r.label, cell(r), '']);
        if (b.note) out.push([w.calendarYear, viewName, b.title, '', 'Note', b.note, '']);
      }
    }
  }
  return out;
}
