// THE FUNDING TABLES' STATISTIC — one definition, for the derivation and its gate.
//
//   ratio = (net incurred loss + LAE incurred) / (expected retained loss + LAE)
//
// NUMERATOR: what the year's P&L charges against the retained premium — net
// incurred loss (paid plus the change in net reserves, so prior-year development
// is in it) and the loss adjustment expense booked on it.
//
// DENOMINATOR: the ENGINE'S OWN expectation of the same thing, on the year's
// book — expected ground-up loss with its ALAE and ULAE, less the tower's
// expected cession. It is built exactly as the pure premium is (loss cost x
// (1 + ALAE + ULAE) less expected ceded), with the engine's expectation where
// the pure premium has the five-year experience.
//
// ⚠ NOT THE EXPERIENCE PURE PREMIUM, DELIBERATELY. The table measures VOLATILITY
// ONLY: a slider position means "funds the year's retained loss and LAE p% of
// the time, against a correct pure premium". Dividing by the experience pure
// premium would fold its shortfall — Property's catastrophes missing from the
// five-year window, above all — into every stop, and the slider would then be
// repairing a pricing error rather than buying confidence. The shortfall is
// reported beside the table (clf-newengine-derive) and left for pricing.
import { laeShares } from '../../src/utils/lossExpense';
import type { CoverageLine, LineResultSet } from '../../src/types/simulation';

/** The engine's expected retained loss plus LAE for the year, in dollars. */
export function expectedRetainedWithLae(line: CoverageLine, r: LineResultSet): number {
  const ceded = r.expectedCededPer100 * r.activeExposure * 10_000;
  return r.expectedLoss * (1 + laeShares(line).total) - ceded;
}

/** What the year charged against the retained premium: net incurred loss plus LAE. */
export const actualRetainedWithLae = (r: LineResultSet): number => r.netIncurredLoss + r.laeIncurred;

/** The volatility-only funding ratio the CLF tables are percentiles of. */
export function fundingRatio(line: CoverageLine, r: LineResultSet): number {
  return actualRetainedWithLae(r) / expectedRetainedWithLae(line, r);
}

/** The experience pure premium's retained funding at CLF 1, in dollars. */
export const experienceRetained = (r: LineResultSet): number => r.netPurePremiumPer100 * r.activeExposure * 10_000;
