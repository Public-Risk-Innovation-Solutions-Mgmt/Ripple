// ============================================================================
// THE YEAR WALKTHROUGH — one played year, every stage the engine goes through,
// in the engine's order, each with its inputs, its working and its result, and
// a short code so two players can find the first stage where their games part.
//
// THE STAGES, AS processYear AND processLineYear RUN THEM:
//
//   decisions      the year's choices, per line and pool-wide
//   pricing        the rate, struck once per line on the averaged state before
//                  the book moves (worlds.ts strikeRates -> strikeBookRate):
//                  the experience pure premium (newPurePremium.bookPurePremium,
//                  each window accident year), then the rate stack
//                  (linePricing.quoteNewRateStack)
//   book           the book moves (bookUnderwriting.moveBook): non-renewal,
//                  any Member Withdrawal, new members; underwriting's one-year
//                  factor on this year's loss per unit
//   premium        the rate on the book billed, and the cover's price
//   draws          every value the model draws for the year and line
//   losses         ordinary losses from the book's members
//                  (ordinaryLoss.ordinaryLossFromMembers), each event's surge,
//                  the large claims (shockLosses.drawLargeLosses), gross
//   reinsurance    the cover's layers, recoveries and the net retained
//   booking        the year's own accident year booked: the booking bias at
//                  the funding CLF, what is paid this year and reserved
//   development    each older accident year's development (processIbner),
//                  λ per year where adverse development is on
//   reserves       by accident year, start and end of year: paid, case, IBNR,
//                  LAE reserves
//   lae            ALAE and ULAE incurred and paid (lossExpense.laeForYear)
//   admin          admin's share of the rate, the year's overrun, booked
//   riskControl    the slider, its charge (Other Admin Expense), the mean cut,
//                  the draw, the cut and the losses and LAE saved (riskControl.ts)
//   investment     the market drawn (processYear, before the lines), the mix,
//                  the income
//   dividends      the basis (opening surplus) and the two percentages
//   loans          between lines (processYear, after the lines)
//   surplus        opening -> underwriting -> investment -> dividends and
//                  assessments -> loans -> ending
//   capital        required capital, the ratio, the status
//   marketShare    a hosted team's share of the room — INFORMATION ONLY: not
//                  part of the model (worked out from what the teams post, and
//                  it can depend on when they post), so it has no code and is
//                  in no comparison
//
// ⚠ IT COMPUTES NOTHING NEW. Every figure is one the engine recorded — on the
// year's averaged row, the reserve ledger, the worlds' rows — or one RE-READ
// WITH THE ENGINE'S OWN FUNCTION on the same seed and the same inputs: the
// pure premium and the rate stack, the book's movement, each world's ordinary
// losses, surges and large claims, the market, the overrun, λ. The gate
// (year-walkthrough-check) holds every re-read to what the engine booked.
//
// ⚠ THE SEED IS NOT SHOWN HERE. The header (walkthroughHeader) carries the
// version always and the scenario's fixed seed only when the caller says so —
// Test player and the host, never single player or a team (see GameShell).
// ============================================================================

import type {
  CoverageLine, GameInstance, GameState, LineDecisionSet, LineView, ReserveDevelopmentRow, ResultSet,
} from '../types/simulation';
import {
  ADMIN_SHARE_OF_PREMIUM, ADVERSE_DEVELOPMENT, MEMBER_LUCK_CV, MEMBER_RISK_CV, NEW_BUSINESS_PENALTY,
  NON_RENEWAL_LOSS_RELIEF, RISK_CONTROL_CUT, ROUTINE_LARGE_LOSSES, SHOCK_FREE_PRICING, UNDERWRITING_MEMBERS,
} from '../data/pricingParameters';
import { CAPITAL_ADEQUACY_THRESHOLDS, LINE_PAYOUT_PATTERN } from '../data/defaultAssumptions';
import { hasStaticClf, RESERVE_MARGIN_CONFIDENCE, staticClf } from '../data/clfTables';
import { REINSURANCE_TOWER, type TowerLine } from '../data/reinsuranceTower';
import { exposureFactor } from '../data/exposureTrend';
import { SAVE_KEY } from './gameSave';
import {
  drawOrdinaryFactor, memberLuckRng, memberRiskRng, ordinaryLossCostPer100, ordinaryLossFromMembers,
} from './ordinaryLoss';
import { adminOverrunFor } from './adminOverrun';
import { alaeRatioFor } from './alaeRatio';
import { adverseDevelopmentRate, developmentLevelOf } from './adverseDevelopment';
import { simulateMarketReturns } from './investmentEngine';
import { deriveSubRng } from './random';
import {
  applyMarketShock, eventLines, gameShocksOn, poolShare, resolveShockYear, shockTimingOf, SHOCK_EVENTS,
  type ShockYear,
} from './shockLosses';
import { shockCostFactor } from './shockCost';
import { AGGREGATE_NOT_OFFERED, placementFor } from './reinsuranceOptions';
import { effectiveRiskControlIncentivePct, quoteNewRateStack, type NewStackQuote } from './linePricing';
import { aggregateCoverOption } from './aggregateCover';
import { riskControlCutFor, riskControlDraw } from './riskControl';
import { bookPurePremium, type NewPurePremiumResult } from './newPurePremium';
import { moveBook, newMembersShare, nonRenewalShare, type BookMovement } from './bookUnderwriting';
import { laeShares } from './lossExpense';
import { unpaidShare } from './payoutPattern';
import { ibnerBookingBias, lookupCLF, selectedClfFor } from './simulationEngine';
import { marketSeedOf } from './bookUnits';
import { worldInstance } from './worlds';
import { knownResults } from './knownYears';
import { LINE_FULL_NAME } from './lineDisplay';
import { formatCurrency } from './formatters';
import * as XLSX from 'xlsx';
import type { TeamMarketShareOfYear } from '../session/contract';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** How a figure is shown and hashed: dollars to the cent, everything else to ten significant figures. */
export type WalkKind = 'usd' | 'pct' | 'factor' | 'per100' | 'exposure' | 'count' | 'text';

export interface WalkRow {
  label: string;
  /** null: the engine keeps no such figure (see the stage's note). */
  value: number | string | null;
  kind: WalkKind;
}

/** How the player's decisions reach a stage. */
export interface WalkFeed {
  /** Decisions that feed the stage directly, with this year's values. */
  decisions: { name: string; value: string }[];
  /** Earlier stages that carry decisions into this one. */
  through: string[];
  /** For a stage nothing the player chose reaches: what it is drawn from. */
  sameFrom?: string;
  /** The working, line by line, with this year's figures. */
  working: string[];
}

export type StageKey =
  | 'decisions' | 'pricing' | 'book' | 'premium' | 'draws' | 'losses' | 'reinsurance' | 'booking'
  | 'development' | 'reserves' | 'lae' | 'admin' | 'riskControl' | 'investment' | 'dividends' | 'loans'
  | 'surplus' | 'capital' | 'marketShare';

export interface WalkStage {
  id: string;
  key: StageKey;
  title: string;
  /** True: the same for everyone in this scenario — no decision reaches it, directly or through an earlier stage. */
  same: boolean;
  feed: WalkFeed;
  rows: WalkRow[];
  note?: string;
  /** '' on an information-only stage (`info`), which no code covers. */
  code: string;
  /**
   * INFORMATION ONLY — not part of the model, and in no code or comparison:
   * the market share, which the room works out from what the teams post.
   */
  info?: boolean;
}

export interface YearWalkthrough {
  yearNumber: number;
  /** The program year's calendar year, as every result screen labels it. */
  calendarYear: number;
  view: LineView;
  worlds: number;
  stages: WalkStage[];
  /** The draws stage's code(s) — the same for everyone in a scenario. */
  drawsCode: string;
  /** The year's decisions, every line and the pool-wide ones — the same whatever the view. */
  decisionsCode: string;
  /** Every view's stages — the same whatever the view. */
  yearCode: string;
}

export interface WalkthroughHeader {
  /** The game's version: the save key every save of this build is written under. */
  version: string;
  /** The scenario's fixed seed — present only where the caller may show it. */
  seed?: string;
  scenario?: number;
}

/** The stages in the engine's order, with their titles. */
export const STAGES: readonly { key: StageKey; title: string }[] = [
  { key: 'decisions', title: 'Decisions' },
  { key: 'pricing', title: 'Pricing' },
  { key: 'book', title: 'Book movement' },
  { key: 'premium', title: 'Premium billed' },
  { key: 'draws', title: 'Draws' },
  { key: 'losses', title: 'Losses' },
  { key: 'reinsurance', title: 'Reinsurance' },
  { key: 'booking', title: "The year's own losses booked" },
  { key: 'development', title: 'Development on older years' },
  { key: 'reserves', title: 'Reserves by accident year' },
  { key: 'lae', title: 'Loss adjustment expense (LAE)' },
  { key: 'admin', title: 'Admin' },
  { key: 'riskControl', title: 'Risk control' },
  { key: 'investment', title: 'Investment income' },
  { key: 'dividends', title: 'Dividends and assessments' },
  { key: 'loans', title: 'Loans between lines' },
  { key: 'surplus', title: 'Surplus' },
  { key: 'capital', title: 'Capital' },
  { key: 'marketShare', title: 'Market share' },
];
const titleOf = (k: StageKey) => STAGES.find(s => s.key === k)!.title;

/**
 * THE FIRST STAGE EACH DECISION FEEDS — read by the stages' text and by the
 * gate, which changes one decision and asserts no stage before this one moves.
 */
export const FIRST_STAGE_FED: Readonly<Record<string, StageKey>> = {
  funding: 'pricing',
  reinsurance: 'pricing',
  nonRenewal: 'book',
  newMembers: 'book',
  assetMix: 'investment',
  dividend: 'dividends',
  assessment: 'dividends',
  loanRepayment: 'loans',
  // The Risk Control slider is charged in the rate (wip/risk-control).
  riskControl: 'pricing',
};

const SAME = 'Same for everyone in this scenario';
const INFO = 'Not part of the model — depends on the room';
export const walkMark = (same: boolean, info = false): string => (info ? INFO : same ? SAME : 'Depends on your decisions');

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

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const usd = (v: number) => formatCurrency(v);
const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;
const per100 = (v: number) => `$${v.toFixed(4)}`;
const fac = (v: number) => v.toFixed(4);
const expM = (v: number) => `$${v.toFixed(2)}M`;

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
// What the engine recorded for one year, and the re-reads
// ---------------------------------------------------------------------------

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

interface YearSource {
  gs: GameState;
  y: number;
  row: ResultSet;
  prior: ResultSet | undefined;
  instances: GameInstance[];
  gameSeed: number;
  shockYears: ShockYear[];
  market: { cash: number; bonds: number; equities: number }[];
  marketShare?: TeamMarketShareOfYear | null;
}

function sourceFor(gs: GameState, y: number, marketShare?: TeamMarketShareOfYear | null): YearSource {
  const row = gs.lockedResults.find(r => r.yearNumber === y);
  if (!row) throw new Error(`yearWalkthrough: year ${y} has not been played`);
  const prior = [...gs.priorHistory, ...gs.lockedResults].find(r => r.yearNumber === y - 1);
  const n = gs.worlds?.length ?? 1;
  const instances = Array.from({ length: n }, (_, i) => worldInstance(gs.instance, i));
  const timing = shockTimingOf(gs.setup);
  // The year's shocks and market in each world, as processYear resolves them.
  const shockYears = instances.map(inst => resolveShockYear(inst, timing, y));
  const market = instances.map((inst, i) =>
    applyMarketShock(simulateMarketReturns(deriveSubRng(inst.seed, y, 'invest')), shockYears[i].marketShock));
  return { gs, y, row, prior, instances, gameSeed: marketSeedOf(gs.instance), shockYears, market, marketShare };
}

/**
 * The ledger the year was priced from (worlds.ts pricingLineState): the game's
 * own, or the shock-free shadow's once a shock had been in force in an earlier
 * played year (the shadow starts the year a shock first is, and prices the year
 * after).
 */
function pricingLedger(s: YearSource, l: CoverageLine): ReserveDevelopmentRow[] {
  const own = s.gs.poolState.lines[l]?.reserveDevelopment ?? [];
  const shadow = s.gs.pricingShadow?.poolState.lines[l]?.reserveDevelopment;
  if (!SHOCK_FREE_PRICING.enabled || !shadow || s.gs.instance.shockFree) return own;
  const timing = shockTimingOf(s.gs.setup);
  for (let y0 = 1; y0 < s.y; y0++) if (resolveShockYear(s.gs.instance, timing, y0).inForce.length > 0) return shadow;
  return own;
}

interface Pricing { pp: NewPurePremiumResult; quote: NewStackQuote; exposure: number }

/** The year's rate, re-struck as strikeBookRate struck it: the pure premium on the pricing ledger, then the stack. */
function pricingOf(s: YearSource, l: CoverageLine): Pricing | null {
  const a = s.row.byLine[l];
  const exposure = a.ratedExposure ?? a.rateBasis?.pricedExposure;
  if (exposure === undefined) return null;
  const pp = bookPurePremium(l, s.y, {
    rows: pricingLedger(s, l),
    allMarketMembers: s.gs.poolState.allMarketMembers,
    membershipHistory: s.gs.poolState.membershipHistory,
  }, exposure, 1);
  const d = a.decisions;
  const quote = quoteNewRateStack({
    line: l, yearNumber: s.y,
    members: { exposure, ...(a.rateBasis?.risk !== undefined ? { risk: a.rateBasis.risk } : {}) },
    exposure,
    groundUpPurePremiumPer100: pp.purePremiumPer100,
    clf: selectedClfFor(l, d),
    riskControlPct: effectiveRiskControlIncentivePct(d),
    layersPlaced: placementFor(l, d.reinsuranceOption),
    aggregateStopLevel: AGGREGATE_NOT_OFFERED,
    reinsuranceOption: d.reinsuranceOption,
    shocks: gameShocksOn(s.gs.setup, s.gs.instance),
    aggregateCover: d.aggregateCover,
  });
  return { pp, quote, exposure };
}

/** The book's movement, as moveBook made it: the book at the start of the year is the one the rate was struck on. */
function bookOf(s: YearSource, l: CoverageLine): BookMovement | null {
  const a = s.row.byLine[l];
  const struck = a.ratedExposure ?? a.rateBasis?.pricedExposure;
  if (struck === undefined) return null;
  const before = struck / exposureFactor(l, s.y);
  return moveBook(l, before, a.decisions, s.shockYears[0].withdrawal, false, s.y);
}

interface WorldLoss {
  expected: number; yearFactor: number; lossFactor: number; risk: number; luck: number; normal: number;
  /** The risk control cut on this year's normal losses (riskControl.ts), 0 at 0%. */
  cut: number; meanCut: number;
  uplift: number; byEvent: Map<string, number>; afterSurge: number;
  claims: { id: string; name: string; regional: boolean; drawn: number; booked: number }[];
  gross: number;
}

/**
 * Each world's losses, re-read with the engine's own draws (processLineYear's
 * new-loss-engine path). `riskControlPer100` is the struck rate's risk control
 * charge (pricingOf): the engine charges it on the book billed and sizes the cut
 * on that charge, so the cut is re-read the same way.
 */
function lossesOf(s: YearSource, l: CoverageLine, m: BookMovement, riskControlPer100 = 0): WorldLoss[] {
  const a = s.row.byLine[l];
  const billed = m.after * exposureFactor(l, s.y);
  const struck = a.ratedExposure ?? billed;
  const base = s.gs.poolState.lines[l]?.shockCostBaseExposure;
  const tFactor = shockCostFactor(l, s.y, struck, base);
  return s.instances.map((inst, i) => {
    const o = ordinaryLossFromMembers(l, billed, s.y, inst.seed, m.lossFactor, false, s.gameSeed);
    const ls = s.shockYears[i].byLine[l];
    const byEvent = new Map<string, number>();
    for (const b of ls.byFiring) byEvent.set(b.firing.event.id, (byEvent.get(b.firing.event.id) ?? 0) + b.uplift);
    const claims = ls.arrivals.map(t => ({
      id: t.firing.event.id, name: t.firing.event.name, regional: t.firing.event.regional,
      drawn: t.size, booked: poolShare(l, t.size * tFactor),
    }));
    const charge = billed * riskControlPer100 * 10_000;
    const rc = charge > 0 ? riskControlCutFor(l, s.y, s.gameSeed, charge, o) : { cut: 0, meanCut: 0 };
    // The cut comes off the normal losses only; the surges are added on the uncut year.
    const afterSurge = o.realised * (1 - rc.cut + ls.uplift);
    return {
      expected: o.expected, yearFactor: o.yearFactor ?? 1, lossFactor: o.lossFactor,
      risk: mean(o.risk), luck: mean(o.luck), normal: o.realised, cut: rc.cut, meanCut: rc.meanCut,
      uplift: ls.uplift, byEvent, afterSurge,
      claims, gross: Math.max(0, afterSurge + claims.reduce((t, c) => t + c.booked, 0)),
    };
  });
}

/** The ledger row of an accident year and its figure at a valuation year (clamped as the engine clamps). */
const ledgerAt = (row: ReserveDevelopmentRow | undefined, series: 'ultimateByValuation' | 'paidByValuation' | 'grossPaidByValuation', valuation: number): number | null => {
  const xs = row?.[series];
  if (!row || !xs || xs.length === 0) return null;
  const k = valuation - row.firstValuationYear;
  if (k < 0) return null;
  return xs[Math.min(k, xs.length - 1)];
};

const ayLabel = (s: YearSource, ay: number): string => `${s.gs.setup.startingYear + ay - 1}`;

// ---------------------------------------------------------------------------
// The stages, per line
// ---------------------------------------------------------------------------

interface LineStage { key: StageKey; rows: WalkRow[]; feed: WalkFeed; note?: string }

const fundingText = (d: LineDecisionSet) => (d.fundingAtExpected ? 'Expected' : pct(d.fundingConfidenceLevel, 0));
const mixText = (d: LineDecisionSet) =>
  `${d.assetAllocation.cashPct}/${d.assetAllocation.bondsPct}/${d.assetAllocation.equitiesPct}`;

function lineStages(s: YearSource, l: CoverageLine): LineStage[] {
  const a = s.row.byLine[l];
  const p = s.prior?.byLine[l];
  const d = a.decisions;
  const name = LINE_FULL_NAME[l];
  const out: LineStage[] = [];
  const feed = (f: Partial<WalkFeed>): WalkFeed => ({ decisions: [], through: [], working: [], ...f });
  const clf = selectedClfFor(l, d);
  const authorized = (s.gs.playedYears ?? []).find(py => py.yearNumber === s.y)?.authorizedLines.includes(l) ?? false;

  // ---- decisions ----
  out.push({
    key: 'decisions',
    rows: [
      { label: 'Funding level', value: fundingText(d), kind: 'text' },
      { label: 'Funding CLF', value: clf, kind: 'factor' },
      { label: 'Non-renewal', value: nonRenewalShare(d.nonRenewal), kind: 'pct' },
      { label: 'New members', value: newMembersShare(d.newMembers), kind: 'pct' },
      { label: 'Reinsurance cover', value: d.reinsuranceOption, kind: 'text' },
      { label: 'Asset mix (cash/bonds/equities)', value: mixText(d), kind: 'text' },
      { label: 'Dividend', value: d.dividendPct, kind: 'pct' },
      { label: 'Assessment', value: d.assessmentPct, kind: 'pct' },
      { label: 'Risk control (share of the rate)', value: effectiveRiskControlIncentivePct(d), kind: 'pct' },
      { label: 'Loan repayment (share of net income)', value: d.loanRepaymentAggressiveness, kind: 'pct' },
      { label: 'Loan authorized this year', value: authorized ? 'Yes' : 'No', kind: 'text' },
    ],
    feed: feed({ decisions: [{ name: 'Every decision for the year', value: 'as listed' }], working: ['The choices made for this year, as the year recorded them.'] }),
  });

  // ---- pricing ----
  const pr = pricingOf(s, l);
  if (pr) {
    const { pp, quote } = pr;
    const rows: WalkRow[] = [];
    for (const pt of pp.points) {
      const ay = ayLabel(s, pt.accidentYear);
      rows.push(
        { label: `${ay}: paid seen (shock paid taken out)`, value: pt.groundUpPaid, kind: 'usd' },
        { label: `${ay}: development factor (LDF at ${pt.ageMonths} months)`, value: pt.ldf, kind: 'factor' },
        { label: `${ay}: reserve inflation to come`, value: pt.reserveInflation, kind: 'factor' },
        { label: `${ay}: exposure ($M)`, value: pt.exposure, kind: 'exposure' },
        { label: `${ay}: loss cost per $100`, value: pt.lossCostPer100, kind: 'per100' },
        { label: `${ay}: trend factor`, value: pt.trendFactor, kind: 'factor' },
        { label: `${ay}: trended loss cost per $100`, value: pt.trendedLossCostPer100, kind: 'per100' },
      );
    }
    const avg = pp.points.length ? mean(pp.points.map(x => x.trendedLossCostPer100)) : null;
    const loaded = quote.retainedPurePremiumPer100 * quote.clf / quote.divisor;
    const slider = effectiveRiskControlIncentivePct(d);
    rows.push(
      { label: 'Average trended loss cost per $100', value: avg, kind: 'per100' },
      { label: 'Catastrophe load per $100', value: pp.catastropheLoadPer100, kind: 'per100' },
      { label: 'ALAE ratio (window average)', value: pp.alaeRatio, kind: 'pct' },
      { label: 'ALAE load per $100', value: pp.alaePer100, kind: 'per100' },
      { label: 'ULAE load per $100', value: pp.ulaePer100, kind: 'per100' },
      { label: 'Pure premium per $100', value: pp.purePremiumPer100, kind: 'per100' },
      { label: 'Expected ceded per $100 (the cover)', value: quote.expectedCededPer100, kind: 'per100' },
      { label: 'Retained pure premium per $100', value: quote.retainedPurePremiumPer100, kind: 'per100' },
      { label: 'Funding CLF', value: quote.clf, kind: 'factor' },
      { label: 'Admin share of the rate', value: quote.adminShare, kind: 'pct' },
      { label: 'Divisor (1 − admin)', value: quote.divisor, kind: 'factor' },
      { label: 'Rate before reinsurance and risk control per $100', value: loaded, kind: 'per100' },
      { label: 'Risk control charge per $100 (that rate × the slider)', value: quote.riskControlPer100, kind: 'per100' },
      { label: 'Reinsurance price per $100', value: quote.reinsRatePer100, kind: 'per100' },
      { label: 'Rate per $100 (member charge rate)', value: quote.finalRatePer100, kind: 'per100' },
      { label: "Last year's rate per $100", value: p ? (p.finalRatePer100 ?? p.ratePer100) : null, kind: 'per100' },
      { label: 'Exposure priced on ($M)', value: pr.exposure, kind: 'exposure' },
    );
    out.push({
      key: 'pricing', rows,
      feed: feed({
        decisions: [
          { name: 'Funding', value: `${fundingText(d)} → CLF ${fac(clf)}` },
          { name: 'Reinsurance cover', value: d.reinsuranceOption },
          { name: 'Risk control', value: `${pct(slider, 0)} → × ${fac(1 + slider)}` },
        ],
        through: ["earlier years' experience (the pricing window)"],
        working: [
          `Pure premium = average trended loss cost ${per100(avg ?? 0)} + catastrophe ${per100(pp.catastropheLoadPer100)} + ALAE ${per100(pp.alaePer100)} + ULAE ${per100(pp.ulaePer100)} = ${per100(pp.purePremiumPer100)}`,
          `Cover ${d.reinsuranceOption} → expected ceded ${per100(quote.expectedCededPer100)} → retained ${per100(pp.purePremiumPer100)} − ${per100(quote.expectedCededPer100)} = ${per100(quote.retainedPurePremiumPer100)}`,
          `Funding ${fundingText(d)} → CLF ${fac(quote.clf)} → rate = ${per100(quote.retainedPurePremiumPer100)} × ${fac(quote.clf)} ÷ ${quote.divisor.toFixed(2)} = ${per100(loaded)}`,
          `Risk control ${pct(slider, 0)} → + ${per100(loaded)} × ${pct(slider, 0)} = ${per100(quote.riskControlPer100)} (admin is not taken on it)`,
          `+ reinsurance ${per100(quote.reinsRatePer100)} = ${per100(quote.finalRatePer100)} per $100`,
        ],
      }),
      note: 'Struck once for the year on the book before it moves, from experience a year old (the pricing window).',
    });
  } else {
    out.push({ key: 'pricing', rows: [{ label: 'Rate per $100', value: a.finalRatePer100 ?? a.ratePer100, kind: 'per100' }], feed: feed({ working: [] }), note: 'This year was saved before its pricing basis was kept.' });
  }

  // ---- book movement ----
  const m = bookOf(s, l);
  const f = exposureFactor(l, s.y);
  if (m) {
    const a1 = nonRenewalShare(d.nonRenewal), a2 = newMembersShare(d.newMembers);
    const renewing = m.before - m.renewedOff - m.withdrawn;
    out.push({
      key: 'book',
      rows: [
        { label: "Last year's exposure ($M)", value: m.before * f, kind: 'exposure' },
        { label: 'Non-renewed ($M)', value: m.renewedOff * f, kind: 'exposure' },
        { label: 'Withdrawn by a Member Withdrawal ($M)', value: m.withdrawn * f, kind: 'exposure' },
        { label: 'Renewed ($M)', value: renewing * f, kind: 'exposure' },
        { label: 'New ($M)', value: m.written * f, kind: 'exposure' },
        { label: "This year's exposure ($M)", value: m.after * f, kind: 'exposure' },
        { label: "Underwriting's one-year factor", value: m.lossFactor, kind: 'factor' },
      ],
      feed: feed({
        decisions: [{ name: 'Non-renewal', value: pct(a1, 0) }, { name: 'New members', value: pct(a2, 0) }],
        through: ["earlier years' book"],
        working: [
          `Non-renewal ${pct(a1, 0)} → non-renewed = ${expM(m.before * f)} × ${pct(a1, 0)} = ${expM(m.renewedOff * f)}`,
          `New members ${pct(a2, 0)} → new = ${expM(m.before * f)} × ${pct(a2, 0)} (capped at the market) = ${expM(m.written * f)}`,
          `Factor = [renewed ${expM(renewing * f)} × (1 − ${NON_RENEWAL_LOSS_RELIEF} × ${pct(a1, 0)}) + new ${expM(m.written * f)} × ${1 + NEW_BUSINESS_PENALTY}] ÷ ${expM(m.after * f)} = ${fac(m.lossFactor)}`,
        ],
      }),
    });
  }

  // ---- premium ----
  const billed = a.billedExposure ?? a.activeExposure;
  out.push({
    key: 'premium',
    rows: [
      { label: 'Exposure billed ($M)', value: billed, kind: 'exposure' },
      { label: 'Pool premium', value: a.poolPremium, kind: 'usd' },
      { label: 'Admin charged', value: a.adminExpense, kind: 'usd' },
      { label: 'Risk control charged', value: a.riskControlInvestment, kind: 'usd' },
      { label: 'Reinsurance price', value: a.reinsuranceCost, kind: 'usd' },
      { label: 'Member charge (premium)', value: a.totalMemberCharge, kind: 'usd' },
    ],
    feed: feed({
      through: [titleOf('pricing'), titleOf('book')],
      working: [
        `Member charge = rate ${per100(a.finalRatePer100 ?? a.ratePer100)} × ${expM(billed)} × 10,000 = ${usd(a.totalMemberCharge)}`,
        `= pool premium ${usd(a.poolPremium)} + admin ${usd(a.adminExpense)} + risk control ${usd(a.riskControlInvestment)} + reinsurance ${usd(a.reinsuranceCost)}`,
      ],
    }),
  });

  // ---- draws ----
  const risk = (() => {
    const rng = memberRiskRng(s.gameSeed, s.y, l);
    return Array.from({ length: UNDERWRITING_MEMBERS }, () => drawOrdinaryFactor(rng, MEMBER_RISK_CV));
  })();
  const luck = s.instances.map(inst => {
    const rng = memberLuckRng(inst.seed, s.y, l);
    return mean(Array.from({ length: UNDERWRITING_MEMBERS }, () => drawOrdinaryFactor(rng, MEMBER_LUCK_CV)));
  });
  const level = ADVERSE_DEVELOPMENT.enabled ? developmentLevelOf(s.gs.setup, l) : null;
  const openAys = (p?.reserveSplitByYear ?? []).map(x => x.yearNumber).filter(x => x < s.y);
  const schedule = (s.gs.instance.scheduledShocks ?? []).filter(x => x.yearNumber === s.y);
  const drawRows: WalkRow[] = [
    { label: 'Year factor (average across the worlds)', value: a.commonLossFactor, kind: 'factor' },
    { label: `Member risk score (average of ${UNDERWRITING_MEMBERS} members)`, value: mean(risk), kind: 'factor' },
    { label: `Member luck (average of ${UNDERWRITING_MEMBERS} members and the worlds)`, value: mean(luck), kind: 'factor' },
    { label: 'ALAE ratio', value: alaeRatioFor(s.gameSeed, s.y, l), kind: 'pct' },
    { label: 'Admin overrun', value: adminOverrunFor(s.gameSeed, s.y, l), kind: 'pct' },
    { label: 'Market return, cash (average across the worlds)', value: mean(s.market.map(x => x.cash)), kind: 'pct' },
    { label: 'Market return, bonds (average across the worlds)', value: mean(s.market.map(x => x.bonds)), kind: 'pct' },
    { label: 'Market return, equities (average across the worlds)', value: mean(s.market.map(x => x.equities)), kind: 'pct' },
    { label: 'Shock schedule this year', value: schedule.length ? schedule.map(x => x.shockId).join(', ') : 'none', kind: 'text' },
    { label: 'Risk control draw z', value: riskControlDraw(s.gameSeed, s.y, l), kind: 'factor' },
  ];
  const inForce = s.shockYears[0].inForce;
  for (const { firing } of inForce) {
    const e = firing.event;
    const lv = eventLines(e.name).find(r => r.line === l);
    if (!lv && !['Economic Inflation', 'Large Investment Loss', 'Large Member Withdrawal'].includes(e.name)) continue;
    const surge = mean(s.shockYears.map(sy => sy.byLine[l].byFiring.filter(b => b.firing.event.id === e.id).reduce((t, b) => t + b.uplift, 0)));
    const sizes = s.shockYears.flatMap(sy => sy.byLine[l].arrivals.filter(t => t.firing.event.id === e.id).map(t => t.size));
    drawRows.push(
      { label: `${e.name}: level`, value: lv ? `A ${lv.a} / T ${lv.t} / R ${lv.r}` : 'pool-wide', kind: 'text' },
      { label: `${e.name}: region`, value: firing.region ?? 'pool-wide', kind: 'text' },
      { label: `${e.name}: surge % (average across the worlds)`, value: surge, kind: 'pct' },
      { label: `${e.name}: large-claim size drawn (average)`, value: sizes.length ? mean(sizes) : 0, kind: 'usd' },
    );
  }
  drawRows.push({ label: 'Adverse development level', value: level ?? 'None', kind: 'text' });
  if (level) for (const ay of openAys) drawRows.push({ label: `${ayLabel(s, ay)}: λ`, value: adverseDevelopmentRate(s.gameSeed, l, level, s.y, ay), kind: 'pct' });
  out.push({
    key: 'draws', rows: drawRows,
    feed: feed({
      sameFrom: "the scenario's seed: the year factor, luck and market on each world's own stream; member risk, the ALAE ratio, the overrun, λ and the risk control draw on the game's; the shocks from the year's schedule",
      working: [],
    }),
  });

  // ---- losses ----
  if (m) {
    const ws = lossesOf(s, l, m, pr?.quote.riskControlPer100 ?? 0);
    const n = ws.length;
    const events = [...new Set(ws.flatMap(w => [...w.byEvent.keys()]))];
    const claimIds = [...new Set(ws.flatMap(w => w.claims.map(c => c.id)))];
    const normal = mean(ws.map(w => w.normal));
    const after = mean(ws.map(w => w.afterSurge));
    const rows: WalkRow[] = [
      { label: 'Exposure ($M)', value: m.after * f, kind: 'exposure' },
      { label: 'Cost per $100', value: ordinaryLossCostPer100(l, s.y), kind: 'per100' },
      { label: 'Expected baseline losses', value: mean(ws.map(w => w.expected)), kind: 'usd' },
      { label: "Underwriting's one-year factor", value: m.lossFactor, kind: 'factor' },
      { label: 'Year factor (average)', value: mean(ws.map(w => w.yearFactor)), kind: 'factor' },
      { label: 'Normal losses (after the factor, member risk and luck)', value: normal, kind: 'usd' },
      { label: 'Risk control cut', value: mean(ws.map(w => w.cut)), kind: 'pct' },
      { label: 'Normal losses after risk control', value: mean(ws.map(w => w.normal * (1 - w.cut))), kind: 'usd' },
    ];
    for (const id of events) {
      const nm = SHOCK_EVENTS.find(e => e.id === id)?.name ?? id;
      const u = mean(ws.map(w => w.byEvent.get(id) ?? 0));
      rows.push({ label: `${nm}: surge %`, value: u, kind: 'pct' });
      rows.push({ label: `${nm}: surge $`, value: mean(ws.map(w => (w.byEvent.get(id) ?? 0) * w.normal)), kind: 'usd' });
    }
    rows.push({ label: 'Losses after surges', value: after, kind: 'usd' });
    for (const id of claimIds) {
      const cs = ws.flatMap(w => w.claims.filter(c => c.id === id));
      const nm = cs[0]?.name ?? id;
      rows.push(
        { label: `${nm}: large claims per world`, value: cs.length / n, kind: 'count' },
        { label: `${nm}: large-claim size booked (average)`, value: mean(cs.map(c => c.booked)), kind: 'usd' },
        { label: `${nm}: large claims $ (average per world)`, value: cs.reduce((t, c) => t + c.booked, 0) / n, kind: 'usd' },
      );
    }
    const cat = ws.reduce((t, w) => t + w.claims.filter(c => c.regional).reduce((u, c) => u + c.booked, 0), 0) / n;
    rows.push(
      { label: 'Routine large claims', value: ROUTINE_LARGE_LOSSES.enabled ? null : 0, kind: 'usd' },
      { label: 'Catastrophe (regional events’ large claims)', value: cat, kind: 'usd' },
      { label: 'Gross losses', value: mean(ws.map(w => w.gross)), kind: 'usd' },
    );
    out.push({
      key: 'losses', rows,
      feed: feed({
        through: [titleOf('book'), "earlier years' book (large claims scale with it)"],
        working: [
          `Expected = ${expM(m.after * f)} × ${per100(ordinaryLossCostPer100(l, s.y))} × 10,000 = ${usd(mean(ws.map(w => w.expected)))}`,
          `Normal = expected × underwriting ${fac(m.lossFactor)} × year factor × each member's risk × luck = ${usd(normal)} (average)`,
          `After risk control and surges = normal × (1 − cut ${pct(mean(ws.map(w => w.cut)))} + surge) = ${usd(after)} — the cut never touches a surge or a large claim; + large claims = gross ${usd(mean(ws.map(w => w.gross)))}`,
        ],
      }),
      note: ROUTINE_LARGE_LOSSES.enabled ? undefined : 'Routine large claims are off in this build.',
    });
  }

  // ---- reinsurance ----
  let placed: boolean[] = [];
  try { placed = placementFor(l, d.reinsuranceOption); } catch { placed = []; }
  const tower = REINSURANCE_TOWER[l as TowerLine] ?? [];
  const reinsRows: WalkRow[] = [{ label: 'Cover', value: d.reinsuranceOption, kind: 'text' }];
  tower.forEach((t, i) => {
    reinsRows.push(
      { label: `${t.name}: attachment`, value: t.attachment, kind: 'usd' },
      { label: `${t.name}: limit`, value: t.limit, kind: 'usd' },
      { label: `${t.name}: bought`, value: placed[i] ? 'Yes' : 'No', kind: 'text' },
      { label: `${t.name}: recovery`, value: a.cededByLayer[i] ?? 0, kind: 'usd' },
    );
  });
  // THE AGGREGATE COVER ON ATTRITIONAL LOSSES (wip/aggregate-cover), when the
  // year bought one: the year's attritional losses, the terms in dollars and
  // what it paid — each the mean over worlds. Absent with None.
  const ac = a.attritionalCover;
  if (ac) {
    reinsRows.push(
      { label: 'Aggregate cover on attritional losses', value: aggregateCoverOption(ac.optionId).name, kind: 'text' },
      { label: 'Attritional: normal losses', value: ac.normalLoss, kind: 'usd' },
      { label: 'Attritional: surges', value: ac.surgeLoss, kind: 'usd' },
      { label: 'Attritional losses', value: ac.attritional, kind: 'usd' },
      { label: 'Expected attritional losses', value: ac.expectedAttritional, kind: 'usd' },
      { label: 'Aggregate cover: attachment', value: ac.attachment, kind: 'usd' },
      { label: 'Aggregate cover: limit', value: ac.limit, kind: 'usd' },
      { label: 'Aggregate cover: price', value: ac.price, kind: 'usd' },
      { label: 'Aggregate cover: recovery on attritional losses', value: ac.recovery, kind: 'usd' },
    );
  }
  reinsRows.push(
    { label: 'Aggregate cover recovery', value: a.aggregateRecovery, kind: 'usd' },
    { label: 'Retained above the tower', value: a.retainedAboveTower, kind: 'usd' },
    { label: 'Ceded premium', value: a.reinsuranceCost, kind: 'usd' },
    { label: 'Gross losses', value: a.grossUltimateLoss, kind: 'usd' },
    { label: 'Gross booked (forward booking)', value: a.bookedGrossUltimate ?? a.grossUltimateLoss, kind: 'usd' },
    { label: 'Total recovery', value: a.reinsuranceRecovery, kind: 'usd' },
    { label: 'Net retained', value: a.netUltimateLoss, kind: 'usd' },
  );
  out.push({
    key: 'reinsurance', rows: reinsRows,
    feed: feed({
      decisions: [
        { name: 'Reinsurance cover', value: d.reinsuranceOption },
        ...(ac ? [{ name: 'Aggregate cover', value: aggregateCoverOption(ac.optionId).name }] : []),
      ],
      through: [titleOf('losses')],
      working: [
        `Cover ${d.reinsuranceOption} → layers bought: ${tower.filter((_, i) => placed[i]).map(t => t.name).join(', ') || 'none'}`,
        ...(ac ? [
          `Attritional = normal ${usd(ac.normalLoss)} + surges ${usd(ac.surgeLoss)} = ${usd(ac.attritional)} (large claims and development excluded)`,
          `Aggregate cover pays min(max(${usd(ac.attritional)} − attachment ${usd(ac.attachment)}, 0), limit ${usd(ac.limit)}) = ${usd(ac.recovery)}`
            + ' (each figure the mean over worlds)',
        ] : []),
        `Net = gross booked ${usd(a.bookedGrossUltimate ?? a.grossUltimateLoss)} − recovery ${usd(a.reinsuranceRecovery)} = ${usd(a.netUltimateLoss)}`,
      ],
    }),
    note: 'Recoveries are recorded by layer; each layer answers each large claim above its attachment, up to its limit.',
  });

  // ---- booking ----
  const ledger = s.gs.poolState.lines[l]?.reserveDevelopment ?? [];
  const own = ledger.find(r => r.yearNumber === s.y);
  const bias = ibnerBookingBias(a.selectedFundingCLF);
  const booked = ledgerAt(own, 'ultimateByValuation', s.y);
  const paidNow = ledgerAt(own, 'paidByValuation', s.y);
  out.push({
    key: 'booking',
    rows: [
      { label: 'Net retained', value: a.netUltimateLoss, kind: 'usd' },
      { label: 'Booking bias at the funding CLF', value: bias, kind: 'pct' },
      { label: 'Booked ultimate', value: booked, kind: 'usd' },
      { label: 'Share paid in the first year', value: 1 - unpaidShare(LINE_PAYOUT_PATTERN[l], 1), kind: 'pct' },
      { label: 'Paid this year', value: paidNow, kind: 'usd' },
      { label: 'Reserved at year end', value: booked !== null && paidNow !== null ? booked - paidNow : null, kind: 'usd' },
    ],
    feed: feed({
      decisions: [{ name: 'Funding', value: `${fundingText(d)} → CLF ${fac(a.selectedFundingCLF)} → booking bias ${pct(bias)}` }],
      through: [titleOf('reinsurance')],
      working: [`Booked = net ${usd(a.netUltimateLoss)} × (1 − ${pct(bias)}) less any development given back = ${booked === null ? '—' : usd(booked)}`],
    }),
  });

  // ---- development ----
  const devRows: WalkRow[] = [];
  const priorSplit = new Map((p?.reserveSplitByYear ?? []).map(x => [x.yearNumber, x]));
  for (const ay of openAys) {
    const row = ledger.find(r => r.yearNumber === ay);
    const now = ledgerAt(row, 'ultimateByValuation', s.y), was = ledgerAt(row, 'ultimateByValuation', s.y - 1);
    const sp = priorSplit.get(ay);
    devRows.push(
      { label: `${ayLabel(s, ay)}: reserve at the start (net)`, value: sp?.unpaidNet ?? null, kind: 'usd' },
      ...(level ? [{ label: `${ayLabel(s, ay)}: λ`, value: adverseDevelopmentRate(s.gameSeed, l, level, s.y, ay), kind: 'pct' as const }] : []),
      { label: `${ayLabel(s, ay)}: development booked`, value: now !== null && was !== null ? now - was : null, kind: 'usd' },
    );
  }
  devRows.push({ label: 'Total development (adverse +)', value: -a.priorYearDevelopment, kind: 'usd' });
  out.push({
    key: 'development', rows: devRows,
    feed: feed({
      through: ["earlier years' reserves (and the decisions that booked them)"],
      working: level
        ? [`Each open year's outstanding grows by its own λ (the ${level} level's range) — development = λ × the year's gross outstanding at the start, net of what the cover takes back.`]
        : ['No adverse development on this line (None).'],
    }),
  });

  // ---- reserves ----
  const endSplit = new Map((a.reserveSplitByYear ?? []).map(x => [x.yearNumber, x]));
  const ays = [...new Set([...priorSplit.keys(), ...endSplit.keys()])].sort((x, y) => x - y);
  const resRows: WalkRow[] = [];
  for (const ay of ays) {
    const row = ledger.find(r => r.yearNumber === ay);
    const shares = laeShares(l, row?.alaeRatio);
    const st = priorSplit.get(ay), en = endSplit.get(ay);
    const tag = ayLabel(s, ay);
    resRows.push(
      { label: `${tag}: paid to date, start`, value: ay < s.y ? ledgerAt(row, 'paidByValuation', s.y - 1) : 0, kind: 'usd' },
      { label: `${tag}: paid to date, end`, value: ledgerAt(row, 'paidByValuation', s.y), kind: 'usd' },
      { label: `${tag}: case reserve, start`, value: st?.caseNet ?? 0, kind: 'usd' },
      { label: `${tag}: case reserve, end`, value: en?.caseNet ?? 0, kind: 'usd' },
      { label: `${tag}: IBNR, start`, value: st?.ibnrNet ?? 0, kind: 'usd' },
      { label: `${tag}: IBNR, end`, value: en?.ibnrNet ?? 0, kind: 'usd' },
      { label: `${tag}: LAE reserve, start`, value: shares.total * Math.max(0, st?.unpaidGross ?? 0), kind: 'usd' },
      { label: `${tag}: LAE reserve, end`, value: shares.total * Math.max(0, en?.unpaidGross ?? 0), kind: 'usd' },
    );
  }
  resRows.push(
    { label: 'Loss reserve (net), start', value: a.beginningNetReserve, kind: 'usd' },
    { label: 'Loss reserve (net), end', value: a.endingNetReserve, kind: 'usd' },
    { label: 'LAE reserve, start', value: a.beginningLaeReserve, kind: 'usd' },
    { label: 'LAE reserve, end', value: a.endingLaeReserve, kind: 'usd' },
  );
  out.push({
    key: 'reserves', rows: resRows,
    feed: feed({ through: [titleOf('booking'), titleOf('development')], working: ['End = start − paid this year + development + the year\'s own reserve; LAE reserve = (ALAE ratio + ULAE share) × gross outstanding.'] }),
  });

  // ---- LAE ----
  out.push({
    key: 'lae',
    rows: [
      { label: "This year's ALAE ratio", value: alaeRatioFor(s.gameSeed, s.y, l), kind: 'pct' },
      { label: 'ALAE incurred', value: a.alaeIncurred, kind: 'usd' },
      { label: 'ULAE incurred', value: a.ulaeIncurred, kind: 'usd' },
      { label: 'LAE paid', value: a.laePaid, kind: 'usd' },
      { label: 'LAE reserve, start', value: a.beginningLaeReserve, kind: 'usd' },
      { label: 'LAE reserve, end', value: a.endingLaeReserve, kind: 'usd' },
      { label: 'LAE incurred', value: a.laeIncurred, kind: 'usd' },
    ],
    feed: feed({
      through: [titleOf('losses'), titleOf('reserves')],
      working: [`LAE incurred = paid ${usd(a.laePaid)} + reserve end ${usd(a.endingLaeReserve)} − start ${usd(a.beginningLaeReserve)} = ${usd(a.laeIncurred)}`],
    }),
  });

  // ---- admin ----
  const overrun = adminOverrunFor(s.gameSeed, s.y, l);
  out.push({
    key: 'admin',
    rows: [
      { label: 'Admin share of the rate', value: ADMIN_SHARE_OF_PREMIUM[l], kind: 'pct' },
      { label: 'Admin charged', value: a.adminExpense, kind: 'usd' },
      { label: 'Overrun drawn', value: overrun, kind: 'pct' },
      { label: 'Admin booked', value: a.operatingExpense, kind: 'usd' },
    ],
    feed: feed({
      through: [titleOf('premium')],
      working: [`Booked = charged ${usd(a.adminExpense)} × (1 + ${pct(overrun)}) = ${usd(a.operatingExpense)}`],
    }),
  });

  // ---- risk control ----
  // The slider (wip/risk-control): charged in the rate, booked as Other Admin
  // Expense, and cutting this year's normal losses by a cut drawn once per year
  // per line off the game's seed. Every figure is the engine's record; at 0%
  // there is no charge, no cut and nothing saved.
  {
    const slider = effectiveRiskControlIncentivePct(d);
    const lossSaved = a.riskControlLossSaved ?? 0, laeSaved = a.riskControlLaeSaved ?? 0;
    const z = riskControlDraw(s.gameSeed, s.y, l);
    out.push({
      key: 'riskControl',
      rows: [
        { label: 'Risk control slider (share of the rate)', value: slider, kind: 'pct' },
        { label: 'Cost — the charge, booked as Other Admin Expense', value: a.riskControlInvestment, kind: 'usd' },
        { label: 'Mean cut m', value: a.riskControlMeanCut ?? 0, kind: 'pct' },
        { label: 'Draw z (same for everyone in this scenario)', value: z, kind: 'factor' },
        { label: 'Cut drawn', value: a.riskControlCut ?? 0, kind: 'pct' },
        { label: 'Normal losses saved', value: lossSaved, kind: 'usd' },
        { label: 'LAE saved', value: laeSaved, kind: 'usd' },
        { label: 'Losses + LAE saved', value: lossSaved + laeSaved, kind: 'usd' },
        { label: 'Saved less the cost', value: lossSaved + laeSaved - a.riskControlInvestment, kind: 'usd' },
      ],
      feed: slider > 0
        ? feed({
          decisions: [{ name: 'Risk control', value: pct(slider, 0) }],
          through: [titleOf('pricing'), titleOf('premium')],
          working: [
            `Cost = the charge = rate before reinsurance and risk control × ${pct(slider, 0)} × exposure = ${usd(a.riskControlInvestment)}`,
            `m = cost ÷ (expected normal losses × (1 + expected ALAE + ULAE)) = ${pct(a.riskControlMeanCut ?? 0)} — on average the losses and LAE saved equal the cost`,
            `Cut = max(0, m × (1 + ${RISK_CONTROL_CUT.sdOfMean} × z ${fac(z)})) = ${pct(a.riskControlCut ?? 0)}, off this year's normal losses only`,
            `Saved = normal losses × cut = ${usd(lossSaved)}, + LAE on them ${usd(laeSaved)} = ${usd(lossSaved + laeSaved)}`,
          ],
        })
        : feed({ decisions: [{ name: 'Risk control', value: '0%' }], working: ['At 0% there is no charge, no cut and nothing saved.'] }),
    });
  }

  // ---- investment ----
  const mk = { cash: mean(s.market.map(x => x.cash)), bonds: mean(s.market.map(x => x.bonds)), equities: mean(s.market.map(x => x.equities)) };
  const mix = a.assetAllocation;
  const tot = mix.cashPct + mix.bondsPct + mix.equitiesPct;
  const blended = tot > 0 ? (mix.cashPct * mk.cash + mix.bondsPct * mk.bonds + mix.equitiesPct * mk.equities) / tot : 0;
  out.push({
    key: 'investment',
    rows: [
      { label: 'Start-of-year invested assets', value: a.investedAssets, kind: 'usd' },
      { label: 'Mix (cash/bonds/equities)', value: mixText(d), kind: 'text' },
      { label: 'Cash return', value: mk.cash, kind: 'pct' },
      { label: 'Bonds return', value: mk.bonds, kind: 'pct' },
      { label: 'Equities return', value: mk.equities, kind: 'pct' },
      { label: 'Return on the mix (average across the worlds)', value: blended, kind: 'pct' },
      { label: 'Investment income', value: a.investmentIncome, kind: 'usd' },
    ],
    feed: feed({
      decisions: [{ name: 'Asset mix', value: mixText(d) }],
      through: ["earlier years' surplus (the assets at the start of the year)"],
      working: [
        `Mix ${mixText(d)} → ${mix.cashPct}% × ${pct(mk.cash)} + ${mix.bondsPct}% × ${pct(mk.bonds)} + ${mix.equitiesPct}% × ${pct(mk.equities)} = ${pct(blended)}`,
        `Income = each world's assets × its own return, averaged = ${usd(a.investmentIncome)}`,
      ],
    }),
  });

  // ---- dividends and assessments ----
  const basis = s.row.worldSummary?.audit[l]?.dividendBasis ?? Math.max(0, a.beginingSurplus);
  const aBasis = s.row.worldSummary?.audit[l]?.assessmentBasis ?? Math.max(0, a.beginingSurplus);
  out.push({
    key: 'dividends',
    rows: [
      { label: 'Basis (opening surplus, not below zero)', value: basis, kind: 'usd' },
      { label: 'Dividend %', value: d.dividendPct, kind: 'pct' },
      { label: 'Dividends', value: a.dividends, kind: 'usd' },
      { label: 'Assessment %', value: d.assessmentPct, kind: 'pct' },
      { label: 'Assessments', value: a.assessments, kind: 'usd' },
    ],
    feed: feed({
      decisions: [{ name: 'Dividend', value: pct(d.dividendPct) }, { name: 'Assessment', value: pct(d.assessmentPct) }],
      through: ["earlier years' surplus (the basis)"],
      working: [
        `Dividends = ${pct(d.dividendPct)} × ${usd(basis)} = ${usd(a.dividends)} (none where last year ended below zero)`,
        `Assessments = ${pct(d.assessmentPct)} × ${usd(aBasis)} = ${usd(a.assessments)}`,
      ],
    }),
  });

  // ---- loans ----
  out.push({
    key: 'loans',
    rows: [
      { label: 'Loan originated this year', value: a.loanOriginatedThisYear, kind: 'usd' },
      { label: 'Interest accrued', value: a.loanInterestAccrued, kind: 'usd' },
      { label: 'Repayment applied', value: a.loanRepaymentApplied, kind: 'usd' },
      { label: 'Outstanding balance', value: a.outstandingLoanBalance, kind: 'usd' },
      { label: 'Transfer between lines', value: a.interLineTransfer, kind: 'usd' },
    ],
    feed: feed({
      decisions: [
        { name: 'Loan repayment', value: pct(d.loanRepaymentAggressiveness, 0) },
        { name: 'Loan authorized', value: authorized ? 'Yes' : 'No' },
      ],
      through: [titleOf('surplus') + ' before loans'],
      working: [`Repayment = ${pct(d.loanRepaymentAggressiveness, 0)} × positive net income, up to the balance = ${usd(a.loanRepaymentApplied)}`],
    }),
  });

  // ---- surplus ----
  const uwBefore = a.underwritingIncome + a.dividends - a.assessments;
  out.push({
    key: 'surplus',
    rows: [
      { label: 'Opening surplus', value: a.beginingSurplus, kind: 'usd' },
      { label: 'Premium', value: a.totalMemberCharge, kind: 'usd' },
      { label: 'Net incurred losses', value: a.netIncurredLoss, kind: 'usd' },
      { label: 'LAE incurred', value: a.laeIncurred, kind: 'usd' },
      { label: 'Admin booked', value: a.operatingExpense, kind: 'usd' },
      { label: 'Risk control', value: a.riskControlInvestment, kind: 'usd' },
      { label: 'Reinsurance', value: a.reinsuranceCost, kind: 'usd' },
      { label: 'Underwriting income', value: uwBefore, kind: 'usd' },
      { label: 'Investment income', value: a.investmentIncome, kind: 'usd' },
      { label: 'Dividends', value: a.dividends, kind: 'usd' },
      { label: 'Assessments', value: a.assessments, kind: 'usd' },
      { label: 'Net income', value: a.netIncome, kind: 'usd' },
      { label: 'Transfer between lines (loans)', value: a.interLineTransfer, kind: 'usd' },
      { label: 'Ending surplus', value: a.endingSurplus, kind: 'usd' },
    ],
    feed: feed({
      through: [titleOf('premium'), titleOf('booking'), titleOf('lae'), titleOf('admin'), titleOf('investment'), titleOf('dividends'), titleOf('loans')],
      working: [
        `Underwriting = premium ${usd(a.totalMemberCharge)} − losses ${usd(a.netIncurredLoss)} − LAE ${usd(a.laeIncurred)} − admin ${usd(a.operatingExpense)} − risk control ${usd(a.riskControlInvestment)} − reinsurance ${usd(a.reinsuranceCost)} = ${usd(uwBefore)}`,
        `Ending = opening ${usd(a.beginingSurplus)} + underwriting ${usd(uwBefore)} + investment ${usd(a.investmentIncome)} − dividends ${usd(a.dividends)} + assessments ${usd(a.assessments)} + transfers ${usd(a.interLineTransfer)} = ${usd(a.endingSurplus)}`,
      ],
    }),
  });

  // ---- capital ----
  const marginClf = hasStaticClf(l) ? staticClf(l, RESERVE_MARGIN_CONFIDENCE) : lookupCLF(RESERVE_MARGIN_CONFIDENCE);
  out.push({
    key: 'capital',
    rows: [
      { label: 'Loss reserve (net), end', value: a.endingNetReserve, kind: 'usd' },
      { label: `Reserve margin factor (CLF at ${pct(RESERVE_MARGIN_CONFIDENCE, 0)})`, value: marginClf, kind: 'factor' },
      { label: 'Retained catastrophe capital', value: a.catCapitalNeeded, kind: 'usd' },
      { label: 'Required capital', value: a.reserveRiskMarginNeeded, kind: 'usd' },
      { label: 'Surplus', value: a.availableSurplus, kind: 'usd' },
      { label: 'Excess over required', value: a.excessAvailableSurplus, kind: 'usd' },
      { label: 'Capital ratio (excess ÷ required)', value: a.capitalAdequacyRatio, kind: 'pct' },
      { label: 'Status', value: a.capitalAdequacyStatus, kind: 'text' },
    ],
    feed: feed({
      through: [titleOf('reserves'), titleOf('reinsurance'), titleOf('surplus')],
      working: [
        `Required = reserve ${usd(a.endingNetReserve)} × (${fac(marginClf)} − 1) + catastrophe ${usd(a.catCapitalNeeded)} = ${usd(a.reserveRiskMarginNeeded)}`,
        `Status: Strong at ${pct(CAPITAL_ADEQUACY_THRESHOLDS.strong, 0)} or more, Adequate at ${pct(CAPITAL_ADEQUACY_THRESHOLDS.adequate, 0)}, Thin at ${pct(CAPITAL_ADEQUACY_THRESHOLDS.thin, 0)}, else Deficient`,
      ],
    }),
  });

  // ---- market share (hosted) ----
  const ms = s.marketShare && s.marketShare.year === s.y ? s.marketShare.byLine[l] : undefined;
  if (s.marketShare) {
    out.push({
      key: 'marketShare',
      rows: [{ label: `${name}: share of the room`, value: ms ?? null, kind: 'pct' }],
      feed: feed({ working: ["This team's exposure ÷ every team's in the room, as the room works it out from what the teams post."] }),
      ...(ms === undefined ? { note: 'The room works out its shares for the latest known year only.' } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The walkthrough
// ---------------------------------------------------------------------------

/** The stages that are information only: shown at the end, with no code, in no comparison. */
export const INFO_STAGES: StageKey[] = ['marketShare'];

function toStage(key: StageKey, view: LineView, rows: WalkRow[], feed: WalkFeed, note?: string): WalkStage {
  const id = `${key}-${view}`;
  const info = INFO_STAGES.includes(key);
  const same = !info && feed.decisions.length === 0 && feed.through.length === 0;
  return {
    id, key, title: titleOf(key), same, feed, rows, ...(note ? { note } : {}),
    code: info ? '' : rowsCode(id, rows), ...(info ? { info: true } : {}),
  };
}

function viewOf(s: YearSource, view: LineView): WalkStage[] {
  const lines = s.gs.setup.activeLines;
  if (view !== 'pool') return lineStages(s, view).map(x => toStage(x.key, view, x.rows, x.feed, x.note));
  // The pool: each line's rows under its name, the pool's own totals where the pool has one.
  const per = lines.map(l => ({ l, st: lineStages(s, l) }));
  const keys = STAGES.map(x => x.key).filter(k => per.some(p => p.st.some(x => x.key === k)));
  const r = s.row;
  const poolRows: Partial<Record<StageKey, WalkRow[]>> = {
    premium: [{ label: 'Pool: member charge', value: r.totalMemberCharge, kind: 'usd' }],
    losses: [{ label: 'Pool: gross losses', value: r.grossUltimateLoss, kind: 'usd' }],
    reinsurance: [{ label: 'Pool: net retained', value: r.netUltimateLoss, kind: 'usd' }],
    investment: [{ label: 'Pool: investment income', value: r.investmentIncome, kind: 'usd' }],
    surplus: [
      { label: 'Pool: opening surplus', value: r.beginingSurplus, kind: 'usd' },
      { label: 'Pool: net income', value: r.netIncome, kind: 'usd' },
      { label: 'Pool: ending surplus', value: r.endingSurplus, kind: 'usd' },
    ],
    capital: [
      { label: 'Pool: required capital', value: r.reserveRiskMarginNeeded, kind: 'usd' },
      { label: 'Pool: status', value: r.capitalAdequacyStatus, kind: 'text' },
    ],
    marketShare: s.marketShare ? [{ label: 'Pool: share of the room', value: s.marketShare.year === s.y ? s.marketShare.pool : null, kind: 'pct' }] : undefined,
  };
  return keys.map(k => {
    const parts = per.map(p => ({ l: p.l, st: p.st.find(x => x.key === k) })).filter(x => x.st);
    const rows = parts.flatMap(({ l, st }) => st!.rows.map(row => ({ ...row, label: `${LINE_FULL_NAME[l]}: ${row.label}` })));
    rows.push(...(poolRows[k] ?? []));
    const feed: WalkFeed = {
      decisions: parts.flatMap(({ l, st }) => st!.feed.decisions.map(x => ({ name: `${LINE_FULL_NAME[l]}: ${x.name}`, value: x.value }))),
      through: [...new Set(parts.flatMap(({ st }) => st!.feed.through))],
      ...(parts.every(({ st }) => st!.feed.sameFrom) ? { sameFrom: parts[0].st!.feed.sameFrom } : {}),
      working: parts.flatMap(({ l, st }) => st!.feed.working.map(w => `${LINE_FULL_NAME[l]}: ${w}`)),
    };
    return toStage(k, 'pool', rows, feed, parts.map(x => x.st!.note).find(Boolean));
  });
}

/** The year's decisions: the pool-wide ones and each line's, as the year recorded them. */
function decisionsCodeOf(s: YearSource): string {
  const byLine = Object.fromEntries(s.gs.setup.activeLines.map(l => [l, s.row.byLine[l]?.decisions ?? null]));
  const authorized = (s.gs.playedYears ?? []).find(py => py.yearNumber === s.y)?.authorizedLines ?? [];
  return walkCode(`decisions\n${stable({ pool: s.row.pool, byLine, authorized })}`);
}

/** Sorted-key JSON, so an object's code does not follow its key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** One played year's walkthrough for every view — the pool, then each line. */
export function buildYearWalkthroughs(gs: GameState, yearNumber: number, marketShare?: TeamMarketShareOfYear | null): YearWalkthrough[] {
  const s = sourceFor(gs, yearNumber, marketShare);
  const views: LineView[] = ['pool', ...gs.setup.activeLines];
  const all = views.map(v => ({ v, stages: viewOf(s, v) }));
  // ⚠ THE INFORMATION-ONLY STAGES ARE NOT IN THE YEAR CODE.
  const yearCode = walkCode(all.map(x => x.stages.filter(st => !st.info).map(st => `${st.id}:${st.code}`).join('\n')).join('\n#\n'));
  const decisionsCode = decisionsCodeOf(s);
  return all.map(x => ({
    yearNumber,
    calendarYear: s.row.calendarYear,
    view: x.v,
    worlds: s.instances.length,
    stages: x.stages,
    drawsCode: walkCode(x.stages.filter(st => st.key === 'draws').map(st => st.code).join('|')),
    decisionsCode,
    yearCode,
  }));
}

/** One played year's walkthrough, for the pool or one line (the pool if the line is not played). */
export function buildYearWalkthrough(gs: GameState, yearNumber: number, view: LineView, marketShare?: TeamMarketShareOfYear | null): YearWalkthrough {
  const all = buildYearWalkthroughs(gs, yearNumber, marketShare);
  return all.find(w => w.view === view) ?? all[0];
}

/** The text that says how a stage's decisions reach it. */
export function feedText(st: WalkStage): string[] {
  const f = st.feed;
  if (st.info) return [`${INFO}: information only, in no code.`, ...f.working];
  if (st.same) return [`${SAME} — drawn from ${f.sameFrom ?? 'the scenario'}.`];
  const out: string[] = [];
  if (f.decisions.length) out.push(`Decisions: ${f.decisions.map(x => `${x.name} ${x.value}`).join('; ')}.`);
  if (f.through.length) out.push(`${f.decisions.length ? 'Also through' : 'Depends on your decisions only through'}: ${f.through.join(', ')}.`);
  return [...out, ...f.working];
}

// ---------------------------------------------------------------------------
// The downloads
// ---------------------------------------------------------------------------

/** The value as a sheet writes it: a number, text, or a dash for a figure not kept. */
const cell = (r: WalkRow): string | number => (r.value === null ? '—' : r.value);

/**
 * THE "Year Walkthrough" SHEET: the header (the seed only as `header` carries
 * it), then every known played year, pool and each line, each stage with its
 * code, how decisions reach it and its figures. Empty when no year has been
 * played.
 */
export function walkthroughSheetRows(gs: GameState, header: WalkthroughHeader, marketShare?: TeamMarketShareOfYear | null): (string | number)[][] {
  const years = walkthroughYears(gs);
  if (years.length === 0) return [];
  const out: (string | number)[][] = [['Year Walkthrough'], ['Version', header.version]];
  if (header.scenario !== undefined) out.push(['Scenario', header.scenario]);
  if (header.seed !== undefined) out.push(['Seed', header.seed]);
  out.push([], ['Year', 'View', 'Stage', 'Same or depends', 'Figure', 'Value', 'Code']);
  for (const y of years) {
    for (const w of buildYearWalkthroughs(gs, y, marketShare)) {
      const viewName = w.view === 'pool' ? 'Pool' : LINE_FULL_NAME[w.view];
      out.push([w.calendarYear, viewName, 'Year code', '', '', '', w.yearCode]);
      out.push([w.calendarYear, viewName, 'Decisions code', '', '', '', w.decisionsCode]);
      out.push([w.calendarYear, viewName, 'Draws code', '', '', '', w.drawsCode]);
      for (const st of w.stages) {
        out.push([w.calendarYear, viewName, st.title, walkMark(st.same, st.info), '', '', st.code]);
        for (const t of feedText(st)) out.push([w.calendarYear, viewName, st.title, '', 'How', t, '']);
        for (const r of st.rows) out.push([w.calendarYear, viewName, st.title, '', r.label, cell(r), '']);
        if (st.note) out.push([w.calendarYear, viewName, st.title, '', 'Note', st.note, '']);
      }
    }
  }
  return out;
}

/**
 * THE "Download Year Walkthrough (Excel)" WORKBOOK: one sheet, every year and
 * view the game can show, under the same seed rule as the screen (`header`).
 */
export function buildWalkthroughWorkbook(gs: GameState, header: WalkthroughHeader, marketShare?: TeamMarketShareOfYear | null): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(walkthroughSheetRows(gs, header, marketShare)), 'Year Walkthrough');
  return wb;
}

/** The download's file name: "Year_Walkthrough_<newest year shown>". */
export function walkthroughFilename(gs: GameState): string {
  const years = walkthroughYears(gs);
  const y = years[years.length - 1];
  return `Year_Walkthrough_${y === undefined ? gs.setup.startingYear : gs.setup.startingYear + y - 1}.xlsx`;
}
