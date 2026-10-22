# State — `wip/uw-hybrid`

**LANDED on `multiplayer` (2026-10-22)**, rebased onto `1632ab4`, as tested: the history averaged
across ALL the worlds, applications at 5%. Built on `wip/uw-hybrid` as a test build first; a ten-world
history was tried there (`c8d4148`) and dropped because it changed nothing (below).

## What it is

Two sliders replace the renewal cut and the four intake positions (every setting is in
`src/data/pricingParameters.ts`, under UNDERWRITING, and on `docs/PARAMETERS.md`):

- **Renewals declined**, 0–10%: the worst loss ratios over the last 3 years, shock claims capped at
  $1M, the history averaged across all the worlds, so every world declines the same units. Whole
  units from the worst down, part of the last.
- **New Business, rejection rate**, 0–15%: applicants at `NEW_BUSINESS_APPLICATIONS` (5%) of the book,
  drawn at random from the market, each accepted at (1 − rate). First-year penalty
  1 + 20% × (1 − min(1, rate / 10%)).

Code: `src/utils/bookUnderwriting.ts`; ledger `PoolState.bookLedger` (shares, joins, history).

## Readings a reviewer should know

- **Grace:** a renewal is decided before the year it renews into, so a unit written in year J is safe at
  year J+1's renewal and eligible from J+2 (`renewalEligible`).
- **The history reads true risk almost exactly, at any number of worlds.** Correlation with true risk
  at each renewal is 0.96–1.00 with 1, 10 or 100 worlds (scenario 18 Property). The causes: a flat
  pre-game (every unit at exactly expected), a unit's own noise small against the risk spread
  (`UNIT_ORDINARY_OWN_CV` 10% vs `UNIT_RISK_CV` 30%), and the shared year factor cancelling in a
  ranking. Fewer worlds therefore do not bring declining 5% near the data scientist's 2.5 points: the
  year-1 gap is 2.1, year 5 is 6.7 (5.8 at one world), built up by declining every year.
- **Why no-change at 3% and 4% came in below 2% (the earlier dial):** luck in WHICH units applied.
  Applicants are drawn at random, and one seed's draw of a few units a year from 140 is noisy. By
  year 5 the business added had a true risk of 1.02 at 2%, 0.92 at 3%, 0.87 at 4% and 1.10 at 5%,
  taking the book's risk to 0.997 / 0.984 / 0.973 / 1.017. The rate per exposure is near-identical
  across them, so the loss ratio follows the book's risk. The penalty adds only about 0.4–1 point.
- **The book grows by default.** At 0% rejection every applicant joins; there is no "no new business".
- **The intake-arm probes** (`clf-table-derive`, `clf-label-backtest-check`, `membership-flows-report`,
  `new-business-appetite-derive`) run one arm table on the two sliders (`scripts/tools/uw-arms.ts`:
  open, reject 15, renew 5, both strictest). All four run on the dormant member path, whose intake
  now admits a random (1 − rejection) share of applicants. Re-derived at the landing, the arms give
  genuinely different books again: at the shipped 6% application rate the member book after 14 years
  is about 140 open, 131 reject 15, 91 renew 5, 48 both (new-business-appetite-derive), and 157 /
  148 / 97 / 43 at year 20 (membership-flows-report). `clf-label-backtest-check` stays red (dormant,
  code 1) on the same failure as on `1632ab4` — Property's 30% stop over-delivering, +54.4pp here
  against +52.1pp there — so not the landing's.
- **Property's catastrophe capital follows the shock switch** (its own commit): a solo game's year-1
  Property requirement $51.5M -> $1.3M, Deficient -> Strong.

## The table — scenario 18, Property, 5 years, at Expected, applications 5% (measured on the test build)

`npx tsx scripts/diagnostics/uw-applications-dial-report.ts` (other rates with `--set`).

| Arm | Exposure | LR y5 | LR cum | CR y5 / cum | Surplus $M |
|---|---|---|---|---|---|
| none | +27.6% | 78.1% | 77.2% | 100.6 / 101.8% | 23.39 |
| renew 5% | 0.0% | 71.4% | 71.4% | 95.6 / 96.8% | 31.33 |
| reject 15% | +23.1% | 77.5% | 76.5% | 100.3 / 101.2% | 24.42 |
| both | −25.6% | 65.6% | 67.2% | 92.3 / 93.7% | 34.31 |

The earlier 2%–5% dial (history on all 100 worlds) is in this file's history at `8252f7f`.

## Checks at the landing (2026-10-22, on `4d25f7b`)

- FAST sweep 78/80, the expected red `cession-uplift-basis` and nothing else of the landing's.
  `export-number-format-check` was red on `1632ab4` itself (the Shock Events sheet's formats one
  column late since c8ac253) and is fixed in its own commit.
- Baselines value v80, export v88, render v75; the control (`1632ab4`) reproduced v79 / v87 / v74;
  every moved row attributed in the baseline commit.
- All 16 session drivers pass; the contract harness passes on localStorage, the stub, DynamoDB
  in-process, the Lambda handler and the built zip (194/194 each), races pass; the manifest is whole.
