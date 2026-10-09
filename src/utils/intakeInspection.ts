// ============================================================================
// THE INTAKE SLIDER — four named positions, each a QUALITY BAR on a noisy
// inspection AND A CAP on how many join that year.
//
//     No New Business   nobody is written. The default.
//     Strict            a high bar and a small cap
//     Moderate          a middle bar and a middle cap
//     Low               a low bar and the largest cap — MAX_NEW_MEMBER_SHARE,
//                       the pool's existing capacity guard, so growth is bounded
//                       at every setting
//
// An applicant joins if they pass the position's bar AND there is room under its
// cap. If more pass than the cap allows, the pool takes the BEST BY INSPECTED
// QUALITY — what an underwriter with a full book does.
//
// ⚠ WHY TWO DIALS PER POSITION, WHICH IS THE DEFECT THIS REPLACES. The first
// version had seven positions, each a bar alone, under one capacity guard of
// 10% of the book (about six members). About six to eight apply per line a year,
// so once the bar was loose enough nearly everyone passed and the guard capped
// the loose positions identically: a player moved the slider and saw nothing
// change across most of it. A cap per position separates the counts where the
// bar alone cannot, and the bar keeps each position's QUALITY distinct where the
// cap alone would not. See INTAKE_POSITIONS for the measurement each was set
// against.
//
// Applicants arrive as before (APPLICATION_RATE of the available pool, skewed
// toward worse risks by APPLICANT_ADVERSE_SELECTION).
//
// ============================================================================
// ⚠ A NOISY INSPECTION, NOT TRUE QUALITY, AND THAT IS THE WHOLE RULING.
//
// Screening on true risk quality is the oracle Underwriting Strictness was
// retired for (c1e6822): exact selection on a hidden truth at zero information
// cost. An inspection — what an application, a site visit or a loss-control
// survey reveals — is the honest middle: it sees the risk, imperfectly.
//
//     inspected = riskQuality + INSPECTION_SIGMA x z,   z ~ N(0, 1)
//
// One inspection per applicant per line per year: a member declined this year
// is inspected afresh if they apply again, as a real applicant would be.
//
// ⚠ THE ERROR IS A LABELLED SUB-STREAM AND CONSUMES NOTHING ELSE. Each
// inspection draws from deriveSubRng(seed, year, 'intake_inspection|line|id'),
// its own hashed purpose label, so no existing stream is re-phased and an
// applicant's inspection does not depend on who else applied. Same rule the GL
// program work established for a new random quantity.
// ============================================================================

import { deriveSubRng } from './random';
import { normalCdf } from './claimMath';
import { MAX_NEW_MEMBER_SHARE } from '../data/defaultAssumptions';
import type { CoverageLine, Member } from '../types/simulation';

/**
 * The inspection's error, in risk-quality points.
 *
 * ⚠ 2, AND IT IS CHOSEN TO BE CLEARLY NOT AN ORACLE. The marketplace's risk
 * quality has a standard deviation of 1.82, so the inspection's correlation
 * with the truth is rho = 1.82 / sqrt(1.82^2 + sigma^2):
 *
 *     sigma   rho     share of the oracle's quality gain kept
 *                     (no skew)        (applicants skewed hard, s = 1.0)
 *      0      1.00       100%              100%
 *      1      0.88        85%               44%
 *      2      0.67        65%       below the applicants' own mean
 *      4      0.41        46%                —
 *      7      0.25        28%                —
 *     ~5      0.33     the loss run's own ranking power, for comparison
 *
 * At 1 the inspection is nearly the oracle — 88% correlated, 85% of the gain.
 * At 2 it is a third wrong: an applicant one point below a bar clears it 31% of
 * the time and one a point above fails it 31% of the time. It still sees twice
 * what the loss run sees. Measured in a scratch copy with the normaliser out,
 * 40 games x 15 years.
 *
 * ⚠ AND THE BASE RATE IS WHAT MAKES IT A DECISION. When applicants are mostly
 * bad, a noisy bar admits mostly lucky bad risks: at a hard skew the sigma-2
 * bar wrote members WORSE than the applicants it screened. At the shipped skew
 * it does not, and the tight end of the slider costs volume for a modest gain
 * in quality — the trade the control exists for.
 */
export const INSPECTION_SIGMA = 2;

/** One position on the intake slider. */
export interface IntakePosition {
  name: string;
  /** The bar on INSPECTED quality; null admits every applicant to the cap. */
  bar: number | null;
  /** The cap, as a share of the book entering the year: floor(book x capShare). */
  capShare: number;
}

/**
 * THE FOUR POSITIONS, MOST CLOSED TO MOST OPEN. Set against the measurement
 * recorded below them; see the commit that introduced them for the full table.
 *
 * MEASURED, 16 games x 10 years, normaliser out, applicants skewed at 0.35;
 * about 7-8 apply per line a year (6.4-8.2, falling as the book grows):
 *
 *   position    bar   cap     joins/yr (WC/GL/Pr)    joiner RQ   bar binds  cap binds
 *   None         —    0       0 / 0 / 0                  —           —          —
 *   Strict       6    3%      1.31 / 1.19 / 1.03       5.88-5.91    23-41%     31-42%
 *   Moderate     4.5  6%      2.76 / 2.81 / 2.86       5.10-5.25    55-76%     11-18%
 *   Low          3    10%     4.29 / 4.44 / 4.30       4.72-4.81    89-94%      2-6%
 *
 * (applicants average RQ ~3.9 under the skew; standard error on each join rate
 * ~0.1, so adjacent positions sit 10+ standard errors apart.) Every position
 * writes a visibly different number AND a different quality. The caps are
 * shares of the book, so on a book of ~65 they are 1 / 3 / 6.
 *
 * ⚠ LOW'S CAP IS MAX_NEW_MEMBER_SHARE, READ RATHER THAN RESTATED. It is the
 * pool's existing capacity guard — a share of the book, not a count — and it is
 * the overall maximum: no position can write more. Strict and Moderate sit
 * below it.
 */
export const INTAKE_POSITIONS: ReadonlyArray<IntakePosition> = [
  { name: 'No New Business', bar: null, capShare: 0 },
  { name: 'Strict', bar: 6, capShare: 0.03 },
  { name: 'Moderate', bar: 4.5, capShare: 0.06 },
  { name: 'Low', bar: 3, capShare: MAX_NEW_MEMBER_SHARE },
];

/** No New Business. The default — see decisionDefaults. */
export const INTAKE_NONE = 0;
export const INTAKE_STRICT = 1;
export const INTAKE_MODERATE = 2;
/** The most open position, and the overall maximum. */
export const INTAKE_LOW = INTAKE_POSITIONS.length - 1;

function positionAt(level: number): IntakePosition {
  return INTAKE_POSITIONS[Math.max(INTAKE_NONE, Math.min(INTAKE_LOW, Math.round(level)))];
}

/** The slider's label at a position: its name. */
export function intakeLabel(level: number): string {
  return positionAt(level).name;
}

/** The position's cap on a book of this size. */
export function intakeCap(level: number, bookSize: number): number {
  if (!(level > INTAKE_NONE)) return 0;
  return Math.floor(bookSize * positionAt(level).capShare);
}

function inspectedQuality(m: Member, line: CoverageLine, yearNumber: number, seed: number): number {
  const rng = deriveSubRng(seed, yearNumber, `intake_inspection|${line}|${m.id}`);
  return m.riskQuality + INSPECTION_SIGMA * rng.normal(0, 1);
}

/**
 * Who this position writes from this year's applicants.
 *
 * `passed` is everyone who cleared the bar, in arrival order — recorded so a
 * year limited by the STANDARD can be told apart from one limited by the CAP.
 * `admitted` is who joins: all of `passed` if they fit under the cap, otherwise
 * the best `cap` of them by inspected quality.
 *
 * ⚠ ONE INSPECTION PER APPLICANT, LINE AND YEAR, ON ITS OWN LABELLED SUB-STREAM,
 * read for the bar and for the ranking alike — the same draw, so an applicant's
 * rank cannot disagree with whether they passed.
 */
export function intakeAdmit(
  applicants: readonly Member[],
  line: CoverageLine,
  yearNumber: number,
  seed: number,
  level: number,
  bookSize: number,
): { passed: Member[]; admitted: Member[]; cap: number } {
  if (!(level > INTAKE_NONE)) return { passed: [], admitted: [], cap: 0 };
  const { bar } = positionAt(level);
  const cap = intakeCap(level, bookSize);
  const scored = applicants.map((m, i) => ({ m, i, q: inspectedQuality(m, line, yearNumber, seed) }));
  const passing = bar === null ? scored : scored.filter(x => x.q >= bar);
  const passed = passing.map(x => x.m);
  if (passing.length <= cap) return { passed, admitted: passed, cap };
  const admitted = [...passing].sort((a, b) => (b.q - a.q) || (a.i - b.i)).slice(0, cap).map(x => x.m);
  return { passed, admitted, cap };
}

/**
 * The probability one applicant clears this position's bar —
 * P(riskQuality + sigma.z >= bar) = Phi((riskQuality - bar) / sigma). For the
 * Decisions page's forecast, which must not draw.
 *
 * ENGINE-SIDE: it reads the hidden attribute and returns a probability, which
 * the page only ever combines over the applicant pool. No per-member figure
 * reaches a surface.
 */
export function intakePassProbability(m: Member, level: number): number {
  if (!(level > INTAKE_NONE)) return 0;
  const { bar } = positionAt(level);
  if (bar === null) return 1;
  return normalCdf((m.riskQuality - bar) / INSPECTION_SIGMA);
}

/**
 * The forecast's join count: E[min(cap, number passing)], with the number
 * passing modelled as Binomial(applications, p) — p being the average chance an
 * applicant clears the bar, expectedPassing / applications. Also the
 * probability the cap binds, so the page can say whether the CAP or the
 * STANDARD is what limits this year's intake.
 *
 * ⚠ BINOMIAL OVER THE FIXED APPLICATION COUNT, NOT A SUM OVER THE WHOLE POOL.
 * The count of applicants is deterministic (round(pool x APPLICATION_RATE)); only
 * WHO applies is drawn. Treating each of ~140 non-members as an independent
 * Bernoulli over-disperses the passing count, puts too much mass above the cap,
 * and measured 7-10% LOW on the join count; the expected passing count itself
 * was right (Rosen's inclusion probabilities match the exact draw to 0.01).
 */
export function intakeForecast(applications: number, expectedPassing: number, cap: number): {
  expectedPassing: number; expectedJoins: number; capBindsProbability: number;
} {
  const n = Math.max(0, Math.round(applications));
  if (n === 0 || cap <= 0) return { expectedPassing, expectedJoins: 0, capBindsProbability: expectedPassing > 0 && cap <= 0 ? 1 : 0 };
  const p = Math.min(1, Math.max(0, expectedPassing / n));
  let expectedJoins = 0, capBindsProbability = 0;
  let pk = Math.pow(1 - p, n);
  for (let k = 0; k <= n; k++) {
    if (k > 0) pk = p >= 1 ? (k === n ? 1 : 0) : pk * ((n - k + 1) / k) * (p / (1 - p));
    expectedJoins += pk * Math.min(cap, k);
    if (k > cap) capBindsProbability += pk;
  }
  return { expectedPassing, expectedJoins, capBindsProbability };
}
