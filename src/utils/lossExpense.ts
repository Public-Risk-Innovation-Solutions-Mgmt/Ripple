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

/** The shares of ground-up loss a line books as ALAE and ULAE — what its rate charges. */
export function laeShares(line: CoverageLine): { alae: number; ulae: number; total: number } {
  const alae = ALAE_ALREADY_IN_LOSSES[line] ? 0 : ALAE_OF_LOSS_COST[line];
  const ulae = ULAE_OF_LOSS_COST[line];
  return { alae, ulae, total: alae + ulae };
}

const grossPaid = (c: ReserveCohort) => c.grossPaid ?? c.netPaid;
const grossUnpaid = (c: ReserveCohort) => Math.max(0, c.grossUnpaid ?? c.netUnpaid);

/** The ground-up loss still unpaid across a line's open cohorts. */
export function grossUnpaidLoss(cohorts: readonly ReserveCohort[]): number {
  return cohorts.filter(c => !c.closed).reduce((s, c) => s + grossUnpaid(c), 0);
}

/** The loss expense reserve a line holds against its cohorts. */
export function lossExpenseReserve(line: CoverageLine, cohorts: readonly ReserveCohort[]): number {
  return laeShares(line).total * grossUnpaidLoss(cohorts);
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
 */
export function laeForYear(
  line: CoverageLine, before: readonly ReserveCohort[], after: readonly ReserveCohort[],
): LaeYear {
  const s = laeShares(line);
  const opened = before.filter(c => !c.closed);
  const paidBefore = opened.reduce((a, c) => a + grossPaid(c), 0);
  const paidAfter = after.reduce((a, c) => a + grossPaid(c), 0);
  const beginningLaeReserve = s.total * opened.reduce((a, c) => a + grossUnpaid(c), 0);
  const endingLaeReserve = s.total * after.reduce((a, c) => a + grossUnpaid(c), 0);
  const laePaid = s.total * (paidAfter - paidBefore);
  const laeIncurred = laePaid + endingLaeReserve - beginningLaeReserve;
  const alaeShare = s.total > 0 ? s.alae / s.total : 0;
  return {
    alaeIncurred: laeIncurred * alaeShare,
    ulaeIncurred: laeIncurred * (1 - alaeShare),
    laeIncurred,
    laePaid,
    beginningLaeReserve,
    endingLaeReserve,
  };
}
