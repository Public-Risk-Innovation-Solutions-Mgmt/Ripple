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

## Findings — first measurement (2026-10-09, read-only, from a scratch copy)

**How the cut was made.** Every class's gross mean scaled by one factor k, chosen so the default 10/80/10
blend's NET mean is exactly two-thirds and one-half of today's (k = 0.6738 and 0.5107); SDs and fees
held. The rate is lowered from game year 1: the pre-game runs at today's rate so every arm opens on the
same book and surplus. 60 paired ten-year games per arm, all three lines; year 5 of a ten-year game IS
the five-year game (the engine never reads gameLength).

| Arm | Net mean | SD | CV | P(negative return year) |
|---|---|---|---|---|
| Today | 5.29% | 3.71% | 0.70 | 7.7% |
| A third lower | 3.53% | 3.71% | 1.05 | 17.1% |
| Half | 2.65% | 3.71% | 1.40 | 23.8% |

**Pricing does not read it — verified, not argued.** 12 paired games (default, low funding, declined
tower): every line's member charge and membership identical in all 10 years at all three rates.

**Defaults.** Pool ending surplus, year 10: $148.2M -> $117.0M -> $103.1M (year 5: $97.3M -> $84.9M ->
$78.9M). The POOL never goes negative at defaults in any arm. Lines do: WC negative at some year-end in
17% -> 23% -> 28% of games, GL 5% -> 8% -> 10%, Property 0% -> 0% -> 2%.

**By line.** Property earns the most investment income in dollars ($41.7M over ten years, against WC
$19.2M and GL $17.8M) because it holds the most surplus. WC feels the cut most in PROPORTION: its
ten-year surplus falls 47% at half rates (GL 30%, Property 26%), because its surplus is thin against the
income it loses.

**Reinsurance — does NOT rebalance.** Declined minus placed, year 10: $655.2M -> $605.1M -> $581.6M.
Investment income is $132.6M of today's gap; half rates remove $73.6M of it (11%). The declined arm's
pool goes negative in 8% of games at every rate; placed, 0%. The gap is the tower's load
(RISK_LOAD_LAMBDA = 0.60), as recorded at the declined-cover margin.

**Risk control — improves, does NOT break even.** Year 10, programme minus none: WC Safety & RTW
-$3.2M -> -$2.7M -> -$2.5M; GL Law Enforcement Analytics -$2.3M -> -$1.8M -> -$1.5M; Claims Management
System +$11.3M at every rate (already pays, almost all on Property).

**The funding slider's low end — DOES bite harder.** WC 0.10, GL and Property 0.30, against defaults.
The pool goes negative within ten years in 67% -> 83% -> 93% of games (within five: 8% -> 15% -> 22%),
and its mean ten-year surplus is -$13.4M -> -$32.3M -> -$40.6M. The PAIRED dollar gap to defaults
NARROWS (-$161.6M -> -$149.3M -> -$143.6M): investment income was rewarding the funded pool's larger
float more than it was cushioning the underfunded one.

**A lower-rate past does not move the opening.** Running the pre-game at the lower rate too: mean
opening surplus $66.2M / $66.5M / $65.8M — the opening band's redraw absorbs it.
