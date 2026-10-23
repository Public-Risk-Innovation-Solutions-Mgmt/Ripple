// ============================================================================
// LOSS ADJUSTMENT EXPENSE — BOOKED AS A REAL COST.
//
// The rate charges ALAE and ULAE on the ground-up loss cost (newPurePremium:
// loss cost x (1 + ALAE + ULAE), 5% each on every line since the pure-premium
// basis; on WC and GL the ULAE is inside the supplied pure premium, the claims
// being the pure premium / 1.05). Until this module nothing spent either, so every
// dollar of it fell to underwriting income — $9.3M a year at the pool, the
// largest single margin the measurement found. Now the engine books both:
//
//   ALAE  with the losses it is allocated to, on the same ground-up basis,
//         paying on the loss pattern — as each dollar of loss is paid.
//   ULAE  claims-handling cost, paid as losses are paid.
//
// Both are a share of the GROUND-UP loss, because that is what the rate charges
// them on: the pool handles every claim, the ceded part included, and the
// reinsurer reimburses no expense. So for every accident year
//
//   LAE incurred   = share x gross incurred loss
//   LAE paid       = share x gross loss paid
//   LAE reserve    = share x gross loss unpaid      (the "Loss Expense Reserves")
//
// ⚠ IT IS A FUNCTION OF THE COHORTS, NOT A NEW STOCK. The reserve is read off
// the cohorts' gross unpaid balances wherever it is needed — the year's
// accounting, the opening balance sheet — so there is no second balance to save
// and nothing that can drift from the losses it is a share of. A cohort that
// carries no gross ledger is taken at its net (none does since the bulk years,
// held net, were retired).
// ============================================================================

import { ALAE_OF_LOSS_COST, ULAE_OF_LOSS_COST } from '../data/pricingParameters';
import { ALAE_ALREADY_IN_LOSSES } from './newPurePremium';
import type { CoverageLine, ReserveCohort } from '../types/simulation';

/**
 * The shares of ground-up loss a line books as ALAE and ULAE — at `alaeRatio`,
 * an accident year's drawn ratio (alaeRatio.ts); absent, the middle of the
 * line's range (ALAE_OF_LOSS_COST).
 */
export function laeShares(line: CoverageLine, alaeRatio?: number): { alae: number; ulae: number; total: number } {
  const alae = ALAE_ALREADY_IN_LOSSES[line] ? 0 : alaeRatio ?? ALAE_OF_LOSS_COST[line];
  const ulae = ULAE_OF_LOSS_COST[line];
  return { alae, ulae, total: alae + ulae };
}

/** A cohort's shares: its own accident year's ALAE ratio. */
const sharesOf = (line: CoverageLine, c: ReserveCohort) => laeShares(line, c.alaeRatio);

const grossPaid = (c: ReserveCohort) => c.grossPaid ?? c.netPaid;
const grossUnpaid = (c: ReserveCohort) => Math.max(0, c.grossUnpaid ?? c.netUnpaid);

/** The ground-up loss still unpaid across a line's open cohorts. */
export function grossUnpaidLoss(cohorts: readonly ReserveCohort[]): number {
  return cohorts.filter(c => !c.closed).reduce((s, c) => s + grossUnpaid(c), 0);
}

/** The loss expense reserve a line holds against its cohorts — each at its own accident year's shares. */
export function lossExpenseReserve(line: CoverageLine, cohorts: readonly ReserveCohort[]): number {
  return cohorts.filter(c => !c.closed).reduce((s, c) => s + sharesOf(line, c).total * grossUnpaid(c), 0);
}

export interface LaeYear {
  alaeIncurred: number;
  ulaeIncurred: number;
  laeIncurred: number;
  laePaid: number;
  beginningLaeReserve: number;
  endingLaeReserve: number;
}

/**
 * A line's LAE for one year, from its cohorts before and after it. `before` is
 * what the year opened with; `after` is every cohort it ends with, the year's
 * own included. A cohort closed before the year began is not in the engine's
 * step and is not here either; one that closes during it is, with its residual
 * paid. Gross incurred is the movement in gross ultimate (paid + unpaid), so
 * paid + the change in reserve is incurred exactly.
 *
 * ⚠ COHORT BY COHORT, EACH AT ITS OWN ACCIDENT YEAR'S ALAE RATIO: a year's ALAE
 * is its claims x its drawn ratio, and a development on an older year books
 * that year's ALAE at that year's ratio. With one ratio throughout this is the
 * old line-level arithmetic exactly.
 */
export function laeForYear(
  line: CoverageLine, before: readonly ReserveCohort[], after: readonly ReserveCohort[],
): LaeYear {
  const opened = before.filter(c => !c.closed);
  const sum = (cs: readonly ReserveCohort[], f: (c: ReserveCohort) => number) => cs.reduce((a, c) => a + f(c), 0);
  // Gross ultimate (paid + unpaid) and paid, each weighted by the cohort's share.
  const ult = (c: ReserveCohort) => grossPaid(c) + grossUnpaid(c);
  const alaeIncurred = sum(after, c => sharesOf(line, c).alae * ult(c)) - sum(opened, c => sharesOf(line, c).alae * ult(c));
  const ulaeIncurred = sum(after, c => sharesOf(line, c).ulae * ult(c)) - sum(opened, c => sharesOf(line, c).ulae * ult(c));
  const beginningLaeReserve = sum(opened, c => sharesOf(line, c).total * grossUnpaid(c));
  const endingLaeReserve = sum(after, c => sharesOf(line, c).total * grossUnpaid(c));
  const laePaid = sum(after, c => sharesOf(line, c).total * grossPaid(c)) - sum(opened, c => sharesOf(line, c).total * grossPaid(c));
  return {
    alaeIncurred,
    ulaeIncurred,
    laeIncurred: laePaid + endingLaeReserve - beginningLaeReserve,
    laePaid,
    beginningLaeReserve,
    endingLaeReserve,
  };
}
