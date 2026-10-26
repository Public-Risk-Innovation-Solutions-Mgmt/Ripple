import type { CoverageLine, LinePoolState, LineResultSet, LineView, Member, ResultSet } from '../types/simulation';
import { exposureFactor } from '../data/exposureTrend';

// A member's exposure in THIS YEAR'S DOLLARS — the NOMINAL, rating-side figure.
//
// ⚠ THE TWO BASES NOW COINCIDE, AND THE DISTINCTION IS KEPT ANYWAY. The
// exposure base is LEVEL from this commit (EXPOSURE_GROWTH_PER_YEAR = 0), so
// exposureFactor is 1 and this returns the raw roster figure. The split is
// still worth stating, because it is what a future exposure trend would need:
//
//   NOMINAL (here)      frozen roster payroll x exposureFactor(line, year).
//                       Premium, member charge, market share, every display.
//
//   REAL (raw           `member.exposureByLine.WC` read directly, no factor.
//    exposureByLine)    CLAIM FREQUENCY, and only claim frequency.
//                       wcClaimEngine reads it raw.
//
// WHY FREQUENCY MUST NOT SEE THE FACTOR, whenever there is one again: the
// roster is frozen, so growth here is pure base inflation — same members, same
// workers, same injuries. Letting claim counts rise with it would assert that
// paying people more injures more of them.
//
// yearNumber is REQUIRED, with no default. A default would silently price some
// call site at year 1 forever, which is exactly the class of defect the
// frequency-trend fix corrected (finding 37).
export function getMemberExposure(member: Member, line: CoverageLine, yearNumber: number): number {
  return (member.exposureByLine[line] ?? 0) * exposureFactor(line, yearNumber);
}

/**
 * WHAT THE NEW LOSS ENGINE PRICES AND DRAWS ON — a roster, or one book's
 * exposure. With MEMBER_LEVEL off a line is one book and has no roster, so
 * every function that only ever summed its members' exposure takes the sum
 * itself. The exposure is the year's own, already through exposureFactor.
 */
// A book is a roster, or the line's exposure — with an optional risk, which
// its routine large losses' count and their price carry. Absent reads as 1,
// and since simple underwriting nothing sets it (book units did).
export type Book = readonly Member[] | {
  readonly exposure: number; readonly risk?: number;
  /** Year 1's quoted exposure, for the shock cost factor (utils/shockCost) — absent: no exposure term. */
  readonly shockBase?: number;
};
/** The shock cost base a book carries (shockCost.shockCostFactor), if any. */
export const shockBaseOf = (book: Book): number | undefined => (Array.isArray(book) ? undefined : (book as { shockBase?: number }).shockBase);

/** A book's size-weighted true risk; 1 for a roster or a book that does not say. */
export const bookRiskOf = (book: Book): number => (Array.isArray(book) ? 1 : (book as { risk?: number }).risk ?? 1);

export const isRoster = (book: Book): book is readonly Member[] => Array.isArray(book);

/** The book's exposure in `yearNumber`, in $M. */
export function bookExposureOf(book: Book, line: CoverageLine, yearNumber: number): number {
  if (!isRoster(book)) return book.exposure;
  let e = 0;
  for (const m of book) e += getMemberExposure(m, line, yearNumber);
  return e;
}

/**
 * A roster for code that only a roster can serve — the old engine's paths.
 * Reaching one with a book is a wiring defect, so it throws rather than
 * pricing an empty roster at zero.
 */
export function rosterOf(book: Book, where: string): Member[] {
  if (!isRoster(book)) throw new Error(`${where}: needs a member roster, and MEMBER_LEVEL is off`);
  return book as Member[];
}

// Stage 2.1 view filter: 'pool' returns lockedResults unchanged (by reference —
// this is what makes the Pool view provably identical to pre-Stage-2.1
// behavior, not just tested to match). A specific line maps each locked
// year to that line's own unaggregated slice.
// ⚠ THE RETURN TYPE USED TO BE `LineResultSet[]` FOR BOTH VIEWS, AND THAT ONE
// SIGNATURE IS WHY THE PLACEHOLDER READS SPREAD AS FAR AS THEY DID. It handed
// every caller a pool row wearing a line row's type, so `rows[0].ratePer100` at
// pool scope compiled everywhere and returned the first active line's rate. The
// overloads below give a caller that knows its view statically the exact type,
// and a caller that does not the union it actually has — which is what makes the
// compiler ask the question at each site instead of at none of them.
export function selectResultView(lockedResults: ResultSet[], view: 'pool'): ResultSet[];
export function selectResultView(lockedResults: ResultSet[], view: CoverageLine): LineResultSet[];
export function selectResultView(
  lockedResults: ResultSet[], view: LineView,
): Array<ResultSet | LineResultSet>;
export function selectResultView(
  lockedResults: ResultSet[], view: LineView,
): Array<ResultSet | LineResultSet> {
  if (view === 'pool') return lockedResults;
  return lockedResults.map(r => r.byLine[view]);
}

/**
 * NARROW A VIEW ROW TO A LINE ROW, OR null IF IT IS THE POOL.
 *
 * ⚠ `byLine` IS THE DISCRIMINATOR AND IT IS THE ONLY HONEST ONE. A pool row is
 * the only row that carries a per-line breakdown; every other candidate (a line
 * field being present, a count, a label) is a guess about shape. This narrows
 * for the compiler and at runtime with the same test.
 *
 * A page holding a view row cannot know whether it is pooled — that is the
 * reader's question, and before the result type was split nothing made them ask
 * it. `const line = asLineRow(r); line ? line.ratePer100 : '—'` is the shape of
 * the answer: the per-line figure where one exists, and a dash where none does.
 */
export function isPoolRow(r: ResultSet | LineResultSet): r is ResultSet {
  return 'byLine' in r;
}

/** The value form of the same test, for `const line = asLineRow(r)` reads. */
export function asLineRow(r: ResultSet | LineResultSet): LineResultSet | null {
  return isPoolRow(r) ? null : r;
}

export function emptyLinePoolState(): LinePoolState {
  return {
    rateLevel: 100,
    ratePer100: 0,
    purePremiumPer100: 0,
    purePremium: 0,
    memberSatisfaction: 0,
    averageRiskQuality: 0,
    riskControlEffectiveness: 0,
    reserveCohorts: [],
    members: [],
    netUnpaidReserve: 0,
    surplus: 0,
    investedAssets: 0,
    totalMarketExposure: 0,
  };
}

