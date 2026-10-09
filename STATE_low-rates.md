# State — `feature/low-rates`

**Read this instead of reconstructing branch state from conversation.** Convention:
`STATE_<final branch segment>.md`, one per branch, at the repo root. This file describes **this branch
only**. (`STATE_member-satisfaction.md` beside it is inherited from the parent line and describes that
branch, not this one.)

**Cut from:** `feature/risk-control` at `b0fd991` (2026-10-09), "Fix the Results download — the caller
passed a pooled list, and pooling is lossy".

**Remote:** `Public-Risk-Innovation-Solutions-Mgmt/Ripple`, the only repository for this project. Check
`git remote -v` on both fetch and push before every git operation; containers have reverted it to
`JanderAct/insurance-game-testingv2`, which redirects and so looks right.

---

## What this branch is for

**Testing the game in a lower-interest-rate market.** The mean investment return is cut by a third and
by half, with its standard deviation held where it is, to see whether a smaller and noisier market
rebalances today's findings:

- **Reinsurance.** Declining the whole tower currently wins on mean ending surplus — $821.26M declined
  against $134.89M placed (12 x 10, recorded at the declined-cover margin in `defaultAssumptions.ts`).
  Part of that is the retained margin compounding through investment income.
- **Risk control programmes.** Their measured cost includes the investment income the spend no longer
  earns, so a lower rate should make them look better.
- **The funding slider.** Underfunding is partly cushioned by investment income, so a lower rate may make
  the low end hurt more.
- **By line.** WC is long-tail and earns most from reserves.

The question is whether changing the MARKET, rather than the parameters, makes reinsurance worth buying,
underfunding visibly costly, or risk control break even.

## What it holds

**Nothing but this file.** The first piece of work is READ AND REPORT ONLY: the arms are run from a
scratch copy that lowers the rate in-process, and no engine constant on this branch changes. If the
measurement argues for a lower-rate market, changing `ASSET_CLASS_ASSUMPTIONS` is a separate, explicit
step.

## The rate, as found at the cut

- **Three asset classes, not one rate**, each drawn once a year and shared by every line
  (`ASSET_CLASS_ASSUMPTIONS`, `investmentEngine.ts`): cash 4.19% gross / 0.40% SD, bonds 5.20% / 4.04%,
  equities 8.26% / 18.25%, less fees of 0.04% / 0.124% / 0.124%. Each line blends them by its own
  allocation, default 10 / 80 / 10, which nets **5.29%** with an SD of 3.71%. No term structure and no
  duration. The parameters cite no source (recorded at the constant).
- **What reads it:** investment income on each line's invested assets (surplus plus reserves, through
  `blendInvestmentReturn`), the inter-line loan rate (`poolReturnRateThisYear`), and the Calculation
  Audit page's display. **Pricing does not**: no investment offset in the rate, no discounted reserve, and
  the CLF tables and funding stops are loss-distribution quantiles with no rate in them. A lower rate
  changes outcomes, not the charge.

## Findings

To be recorded here when the measurement is done.
