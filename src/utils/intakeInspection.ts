// ============================================================================
// THE INTAKE SLIDER — who gets in, decided by a NOISY INSPECTION of risk
// quality, the bar loosening as the slider rises.
//
// Replaces New Business Appetite's five tiers, which screened applicants on
// their own three-year loss run. That screen selected on noise: the loss run
// ranks true risk quality at 0.33, and the Strict tier measured
// indistinguishable from accepting everyone once composition reached losses.
//
//   level 0          No New Business — nobody is written. The default.
//   levels 1..5      an applicant is written if their INSPECTED quality clears
//                    the bar, the bar loosening 7 -> 6 -> 5 -> 4 -> 3
//   level 6          fully open — every applicant is written, no inspection
//
// Applicants still arrive as before (APPLICATION_RATE of the available pool,
// skewed toward worse risks by APPLICANT_ADVERSE_SELECTION) and the intake room
// still caps how many are written. Only the bar between them changed.
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

/** The bar at each slider level, on the INSPECTED quality. null at level 0
 *  (nobody) and at the top (everybody, uninspected). */
export const INTAKE_BARS: ReadonlyArray<number | null> = [null, 7, 6, 5, 4, 3, null];

/** No New Business. The default — see decisionDefaults. */
export const INTAKE_NONE = 0;
/** Every applicant is written, uninspected. */
export const INTAKE_OPEN = INTAKE_BARS.length - 1;

/** The slider's labels, most closed to most open. */
export function intakeLabel(level: number): string {
  if (level <= INTAKE_NONE) return 'No new business';
  if (level >= INTAKE_OPEN) return 'Open — write every applicant';
  return `Inspected quality ${INTAKE_BARS[level]}+`;
}

function inspectedQuality(m: Member, line: CoverageLine, yearNumber: number, seed: number): number {
  const rng = deriveSubRng(seed, yearNumber, `intake_inspection|${line}|${m.id}`);
  return m.riskQuality + INSPECTION_SIGMA * rng.normal(0, 1);
}

/**
 * The applicants this level writes, before the intake room caps them.
 *
 * ⚠ ORDER IS PRESERVED. The caller hands over applicants in their shuffled
 * arrival order and takes a prefix up to the room; reordering here would make
 * the room a second screen.
 */
export function intakeEligible(
  applicants: readonly Member[],
  line: CoverageLine,
  yearNumber: number,
  seed: number,
  level: number,
): Member[] {
  if (!(level > INTAKE_NONE)) return [];
  if (level >= INTAKE_OPEN) return [...applicants];
  const bar = INTAKE_BARS[level];
  if (bar === null || bar === undefined) return [...applicants];
  return applicants.filter(m => inspectedQuality(m, line, yearNumber, seed) >= bar);
}

/**
 * The probability one applicant clears this level's inspection —
 * P(riskQuality + sigma.z >= bar) = Phi((riskQuality - bar) / sigma). For the
 * Decisions page's forecast, which must not draw: the engine draws the
 * inspection, the page states its expectation.
 *
 * ENGINE-SIDE: it reads the hidden attribute and returns a probability, which
 * the page only ever SUMS over the applicant pool. No per-member figure reaches
 * a surface.
 */
export function intakePassProbability(m: Member, level: number): number {
  if (!(level > INTAKE_NONE)) return 0;
  if (level >= INTAKE_OPEN) return 1;
  const bar = INTAKE_BARS[level];
  if (bar === null || bar === undefined) return 1;
  return normalCdf((m.riskQuality - bar) / INSPECTION_SIGMA);
}
