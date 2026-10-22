// ============================================================================
// UNDERWRITING AS EXPOSURE — one book per line, with MEMBER_LEVEL off.
//
// With no members, the three things that moved the roster move the book's
// exposure instead:
//
//   RENEWAL     "Renewals declined" declines that share of the renewing book,
//               worst loss ratio first (on units; below).
//   WITHDRAWAL  a Member Withdrawal in force removes R_MODEL's 25% of what is
//               left, at the renewal after the event.
//   NEW         applicants arrive at NEW_BUSINESS_APPLICATIONS of the book as
//               it stood at the start of the year; "New Business, rejection
//               rate" turns that share of them away, at random.
//
// Every setting is in pricingParameters.ts, under UNDERWRITING. The book is
// capped at FULL_MARKET_EXPOSURE. The pre-game moves nothing — its book is the
// opening, as its roster was.
//
// ⚠ IT RETURNS THE MEMBERSHIP ENGINE'S SHAPE. Everything downstream of movement
// reads a MemberMovementResult; handing it one with an empty roster and the
// book's exposure is what lets the engine run without members and without a
// second copy of everything after movement. The member-level fields are
// neutral: no members, no counts, satisfaction and risk quality carried as
// they stood — both are hidden and feed nothing with MEMBER_LEVEL off.
// ============================================================================

import {
  FULL_MARKET_EXPOSURE, FULL_SAVINGS_AT, LOSS_HISTORY_CLAIM_CAP, LOSS_HISTORY_YEARS, NEW_BUSINESS_APPLICATIONS,
  NEW_BUSINESS_PENALTY, NEW_BUSINESS_REJECTION_SLIDER, NEW_MEMBER_GRACE_YEARS, R_MODEL, RENEWAL_JUDGEMENT_CV,
  RENEWALS_DECLINED_SLIDER,
} from '../data/pricingParameters';
import { deriveSubRng } from './random';
import { marketUnits, type BookUnit } from './bookUnits';
import type { BookLedger, CoverageLine, UnitYearRecord } from '../types/simulation';
import type { MemberMovementResult } from './membershipEngine';

export interface BookMovement {
  /** Base-year exposure, $M, at the start of the year. */
  before: number;
  renewedOff: number;
  withdrawn: number;
  written: number;
  /** Base-year exposure, $M, after movement and the cap. */
  after: number;
  /** The share of `after` written this year — what a new-business penalty bites on. */
  newShare: number;
}

const clampTo = (v: number | undefined, r: { min: number; max: number }) => {
  const x = v ?? 0;
  return x >= r.min ? Math.min(x, r.max) : r.min;
};

/** "Renewals declined", read as the share of renewing exposure it declines. */
export const declinedShare = (v: number | undefined) => clampTo(v, RENEWALS_DECLINED_SLIDER);

/** "New Business, rejection rate", read as the share of applicants turned away. */
export const rejectionShare = (v: number | undefined) => clampTo(v, NEW_BUSINESS_REJECTION_SLIDER);

/**
 * THE DATA SCIENTIST'S FORMULA — what new business carries on its actual
 * ordinary losses in its first year: 1 + NEW_BUSINESS_PENALTY x (1 − savings),
 * savings = min(1, rejection / FULL_SAVINGS_AT). 1.20 at 0%, 1.10 at 5%, 1.00
 * from 10%.
 */
export function newBusinessPenaltyFactor(rejection: number | undefined): number {
  const savings = Math.min(1, rejectionShare(rejection) / FULL_SAVINGS_AT);
  return 1 + NEW_BUSINESS_PENALTY * (1 - savings);
}

type UwDecisions = { renewalsDeclined?: number; newBusinessRejection?: number };

export function moveBook(
  line: CoverageLine,
  before: number,
  decisions: UwDecisions,
  withdrawal: boolean,
  frozen: boolean,
): BookMovement {
  if (frozen) return { before, renewedOff: 0, withdrawn: 0, written: 0, after: before, newShare: 0 };
  const renewedOff = before * declinedShare(decisions.renewalsDeclined);
  const kept = before - renewedOff;
  const withdrawn = withdrawal ? kept * R_MODEL.memberWithdrawalReduction : 0;
  const room = Math.max(0, FULL_MARKET_EXPOSURE[line] - (kept - withdrawn));
  const written = Math.min(room, before * NEW_BUSINESS_APPLICATIONS * (1 - rejectionShare(decisions.newBusinessRejection)));
  const after = kept - withdrawn + written;
  return { before, renewedOff, withdrawn, written, after, newShare: after > 0 ? written / after : 0 };
}

/**
 * The movement as the engine reads it. `factor` is the year's exposureFactor,
 * so the exposures are the year's own as a roster's would be.
 */
export function bookMovementResult(
  line: CoverageLine, m: BookMovement, factor: number, memberSatisfaction: number, riskQuality: number,
): MemberMovementResult {
  return {
    activeMembers: [],
    newMembers: [],
    withdrawnMembers: [],
    intakeRoom: 0,
    applicantCount: 0,
    eligibleCount: 0,
    retentionRate: m.before > 0 ? (m.before - m.renewedOff - m.withdrawn) / m.before : 1,
    // The POOL-LEVEL scalar, carried as it stood — not any member's own score.
    memberSatisfaction,
    averageRiskQuality: riskQuality,
    activeExposure: m.after * factor,
    totalMarketExposure: FULL_MARKET_EXPOSURE[line] * factor,
  };
}

// ============================================================================
// UNDERWRITING ON BOOK UNITS — the book moves unit by unit, so what it is
// changes, not only how big it is. A unit may be held IN PART
// (BookLedger.share): its exposure, losses and premium are its size x the
// share held.
//
//   RENEWAL     ranks the eligible units — in the book at least
//               NEW_MEMBER_GRACE_YEARS at the decision, with a premium on record — by their
//               loss ratio over the last LOSS_HISTORY_YEARS (unitLossRatio) times the
//               underwriter's judgement (renewalJudgement; 1 at RENEWAL_JUDGEMENT_CV 0),
//               worst first, and declines whole units down that order and PART
//               of the last, so the declined exposure is EXACTLY the slider's
//               share of the book at the start of the year. A unit it cannot
//               rank is not declined; if too few rank, all that do go.
//   WITHDRAWAL  removes R_MODEL's 25% of what is left, whole units in a seeded
//               order that knows nothing of risk — as before.
//   NEW         applicants are the market units the book did not hold at the
//               start of the year, in a seeded random order: whole units and
//               PART of the last, to exactly NEW_BUSINESS_APPLICATIONS of the
//               book at the start of the year. Each is accepted at
//               (1 − rejection) of its share — random rejection, exactly the
//               rate. The market is the cap.
//
// ⚠ SHARED ACROSS WORLDS: everything here reads the GAME's seed (the market,
// the withdrawal and application orders), the team's one decision and the
// ledger's history, which is the worlds' average — so every world moves the
// same book the same way; only loss draws differ.
// ============================================================================

const EPS = 1e-9;
const key = (i: number) => String(i);

/** A ledger with nothing in it — the opening book, wholly held, no history. */
export const emptyLedger = (): BookLedger => ({ share: {}, joined: {}, history: {} });

/** The share of a unit the book holds: 1 unless the ledger says less. */
export const heldShare = (ledger: BookLedger | undefined, index: number): number =>
  ledger?.share[key(index)] ?? 1;

/** The units a book holds, each at its HELD size (size x share). */
export function heldUnits(seed: number, line: CoverageLine, indices: readonly number[], ledger?: BookLedger): BookUnit[] {
  const market = marketUnits(seed, line);
  return indices.map(i => {
    const sh = heldShare(ledger, i);
    return sh === 1 ? market[i] : { ...market[i], size: market[i].size * sh };
  });
}

/** A unit's loss ratio over the LOSS_HISTORY_YEARS before `yearNumber`, or null with no premium on record. */
export function unitLossRatio(records: readonly UnitYearRecord[] | undefined, yearNumber: number): number | null {
  let loss = 0, premium = 0;
  for (const r of records ?? []) {
    if (r.year < yearNumber - LOSS_HISTORY_YEARS || r.year >= yearNumber) continue;
    loss += r.loss;
    premium += r.premium;
  }
  return premium > 0 ? loss / premium : null;
}

/**
 * The underwriter's judgement on a unit at `yearNumber`'s renewal: a factor on
 * its loss history, lognormal with mean 1 and RENEWAL_JUDGEMENT_CV's spread,
 * drawn once per unit per year from the game's seed — keyed on the unit, so
 * every world and every order of ranking draws the same one. 1 at a CV of 0.
 */
export function renewalJudgement(marketSeed: number, line: CoverageLine, index: number, yearNumber: number): number {
  const cv = RENEWAL_JUDGEMENT_CV.value;
  if (!(cv > 0)) return 1;
  const sigma = Math.sqrt(Math.log(1 + cv * cv));
  return deriveSubRng(marketSeed, yearNumber, `renewal_judgement_${line}_${index}`).lognormal(-sigma * sigma / 2, sigma);
}

/**
 * Whether a unit may be declined at `yearNumber`'s renewal. ⚠ THE RENEWAL IS
 * DECIDED BEFORE THE YEAR IT RENEWS INTO, so a unit written in year J has been
 * in the book less than a year when year J+1's renewal is decided: with
 * NEW_MEMBER_GRACE_YEARS at 1 it is safe at its first renewal and eligible
 * from its second. The opening book is always eligible.
 */
export const renewalEligible = (ledger: BookLedger | undefined, index: number, yearNumber: number): boolean => {
  const j = ledger?.joined[key(index)];
  return j === undefined || yearNumber - j > NEW_MEMBER_GRACE_YEARS;
};

/** Take `order` whole, in turn, and part of the last, to exactly `target` of exposure. `part` is the share of the unit's held size taken. */
function takeExactly(order: readonly { index: number; held: number }[], target: number): { index: number; part: number }[] {
  const out: { index: number; part: number }[] = [];
  let taken = 0;
  for (const { index, held } of order) {
    if (taken >= target - EPS) break;
    if (held <= 0) continue;
    const part = Math.min(1, (target - taken) / held);
    out.push({ index, part });
    taken += held * part;
  }
  return out;
}

export interface UnitBookMovement extends BookMovement {
  /** The book after movement, indices into the market, sorted. */
  afterUnits: number[];
  /** The units written this year — the new business — sorted. */
  writtenUnits: number[];
  /** Units declined, wholly or in part. */
  declinedUnits: number[];
  withdrawnUnits: number[];
  /** Applicant exposure before rejection, base-year $M. */
  applied: number;
  /** What the units written carry on their first-year ordinary losses (newBusinessPenaltyFactor). */
  penaltyFactor: number;
  /** The ledger after movement: shares and joins updated, departed units' history dropped. */
  ledger: BookLedger;
}

export function moveBookUnits(
  line: CoverageLine,
  marketSeed: number,
  book: readonly number[],
  ledger: BookLedger | undefined,
  decisions: UwDecisions,
  withdrawal: boolean,
  frozen: boolean,
  yearNumber: number,
): UnitBookMovement {
  const market = marketUnits(marketSeed, line);
  const base = ledger ?? emptyLedger();
  const share = new Map(book.map(i => [i, heldShare(base, i)]));
  const heldSize = (i: number) => market[i].size * (share.get(i) ?? 0);
  const before = book.reduce((a, i) => a + heldSize(i), 0);
  if (frozen) {
    return {
      before, renewedOff: 0, withdrawn: 0, written: 0, after: before, newShare: 0, applied: 0, penaltyFactor: 1,
      afterUnits: [...book].sort((a, b) => a - b), writtenUnits: [], declinedUnits: [], withdrawnUnits: [], ledger: base,
    };
  }
  // RENEWAL — the worst loss ratio first, among the eligible, as the
  // underwriter judges it: the history times renewalJudgement's factor.
  const ranked = book
    .filter(i => renewalEligible(base, i, yearNumber))
    .map(i => {
      const lr = unitLossRatio(base.history[key(i)], yearNumber);
      return { i, lr: lr === null ? null : lr * renewalJudgement(marketSeed, line, i, yearNumber) };
    })
    .filter((x): x is { i: number; lr: number } => x.lr !== null)
    .sort((a, b) => b.lr - a.lr || a.i - b.i);
  const declines = takeExactly(ranked.map(x => ({ index: x.i, held: heldSize(x.i) })),
    before * declinedShare(decisions.renewalsDeclined));
  let renewedOff = 0;
  for (const d of declines) {
    renewedOff += heldSize(d.index) * d.part;
    const left = (share.get(d.index) ?? 0) * (1 - d.part);
    if (left > EPS) share.set(d.index, left); else share.delete(d.index);
  }
  // WITHDRAWAL — a seeded order, from the game's seed; whole units.
  const withdrawnUnits: number[] = [];
  let withdrawn = 0;
  if (withdrawal) {
    const rng = deriveSubRng(marketSeed, yearNumber, `unit_withdraw_${line}`);
    const order = [...share.keys()].sort((a, b) => a - b);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const goal = order.reduce((a, i) => a + heldSize(i), 0) * R_MODEL.memberWithdrawalReduction;
    for (const i of order) {
      const h = heldSize(i);
      if (!(withdrawn + h / 2 <= goal)) break;
      withdrawn += h;
      withdrawnUnits.push(i);
    }
    for (const i of withdrawnUnits) share.delete(i);
  }
  // NEW BUSINESS — applicants in a seeded random order from the units the book
  // did not hold, to exactly the applications share; each accepted at (1 − r).
  const inBook = new Set(book);
  const prospects = market.filter(u => !inBook.has(u.index)).map(u => u.index);
  const rng = deriveSubRng(marketSeed, yearNumber, `unit_apply_${line}`);
  for (let i = prospects.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [prospects[i], prospects[j]] = [prospects[j], prospects[i]];
  }
  const applicants = takeExactly(prospects.map(i => ({ index: i, held: market[i].size })),
    before * NEW_BUSINESS_APPLICATIONS);
  const accept = 1 - rejectionShare(decisions.newBusinessRejection);
  let applied = 0, written = 0;
  const writtenUnits: number[] = [];
  for (const a of applicants) {
    applied += market[a.index].size * a.part;
    const s = a.part * accept;
    if (s <= EPS) continue;
    share.set(a.index, s);
    written += market[a.index].size * s;
    writtenUnits.push(a.index);
  }
  const afterUnits = [...share.keys()].sort((a, b) => a - b);
  const after = afterUnits.reduce((a, i) => a + heldSize(i), 0);
  const isNew = new Set(writtenUnits);
  const next = emptyLedger();
  for (const i of afterUnits) {
    const k = key(i);
    const sh = share.get(i)!;
    if (sh < 1 - EPS) next.share[k] = sh;
    const j = isNew.has(i) ? yearNumber : base.joined[k];
    if (j !== undefined) next.joined[k] = j;
    if (base.history[k]) next.history[k] = base.history[k];
  }
  return {
    before, renewedOff, withdrawn, written, after, applied,
    penaltyFactor: newBusinessPenaltyFactor(decisions.newBusinessRejection),
    newShare: after > 0 ? written / after : 0,
    afterUnits, writtenUnits: [...writtenUnits].sort((a, b) => a - b),
    declinedUnits: declines.map(d => d.index).sort((a, b) => a - b),
    withdrawnUnits: withdrawnUnits.sort((a, b) => a - b), ledger: next,
  };
}

// ============================================================================
// THE LOSS HISTORY — one record per held unit per accident year, then the
// worlds' average.
// ============================================================================

/** One unit's large losses this year: routine claims' excess (what is booked over ordinary), and each shock claim. */
export interface UnitLargeLosses { routine: number; shock: number[] }

/**
 * The ledger with this accident year's record for every held unit: its
 * ordinary loss (with the year's uplift and its penalty), its routine large
 * excess, and its shock claims each capped at LOSS_HISTORY_CLAIM_CAP — against
 * its share of the line's premium by held exposure. Records older than
 * LOSS_HISTORY_YEARS are dropped.
 */
export function recordUnitYear(
  ledger: BookLedger,
  units: readonly BookUnit[],
  yearNumber: number,
  ordinaryByUnit: ReadonlyMap<number, number>,
  largeByUnit: ReadonlyMap<number, UnitLargeLosses>,
  premium: number,
): BookLedger {
  const total = units.reduce((a, u) => a + u.size, 0);
  const history: Record<string, UnitYearRecord[]> = {};
  for (const u of units) {
    const k = key(u.index);
    const large = largeByUnit.get(u.index);
    const loss = (ordinaryByUnit.get(u.index) ?? 0) + (large?.routine ?? 0)
      + (large?.shock ?? []).reduce((a, x) => a + Math.min(x, LOSS_HISTORY_CLAIM_CAP), 0);
    const rec: UnitYearRecord = { year: yearNumber, loss, premium: total > 0 ? premium * u.size / total : 0 };
    history[k] = [
      ...(ledger.history[k] ?? []).filter(r => r.year > yearNumber - LOSS_HISTORY_YEARS && r.year !== yearNumber),
      rec,
    ];
  }
  return { ...ledger, history };
}

/**
 * THE WORLDS' AVERAGE: every world shares the book and the prior history, and
 * differs only in this year's record. Each unit's `yearNumber` record becomes
 * the mean over the worlds of its loss and of its premium.
 */
export function averageLedgerYear(ledgers: readonly BookLedger[], yearNumber: number): BookLedger {
  const first = ledgers[0];
  if (ledgers.length <= 1) return first;
  const history: Record<string, UnitYearRecord[]> = {};
  for (const [k, recs] of Object.entries(first.history)) {
    let loss = 0, premium = 0, n = 0;
    for (const l of ledgers) {
      const r = l.history[k]?.find(x => x.year === yearNumber);
      if (r) { loss += r.loss; premium += r.premium; n += 1; }
    }
    history[k] = recs.map(r => (r.year === yearNumber && n > 0 ? { year: r.year, loss: loss / n, premium: premium / n } : r));
  }
  return { ...first, history };
}
