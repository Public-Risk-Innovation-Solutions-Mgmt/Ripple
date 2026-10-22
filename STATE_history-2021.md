# State — `wip/history-2021`

**LANDED on `multiplayer` (2026-10-22)** on `1dd0118`, as tested. Built on `wip/history-2021` as a
test build first.

## What it is

- **The pool's history begins in 2021.** No accident years before the first pre-game year: the bulk
  reserves for 2016–2020 (WC, GL) and 2019–2020 (Property), the seed cohorts and
  `OPENING_RESERVE_YEARS` are retired. The pre-game starts on its paid-in capital with no reserves.
- **Pricing reads the years there are:** 2021 on the starting expected loss with trend, at the book's
  own size-weighted risk; 2022 on one year of experience … 2025 on four; from 2026 the full five.
  2022's change is then exactly the scenario's pre-game loss multiplier × trend.
- **Paid-in capital $12.5M a line** (was $5M). The prior board's margin is solved to grow it into the
  scenario's opening and comes off when year 1 funds at Expected, so a small start made the 2026 rate
  fall from 2025's on every line. The table of $5M / $10M / $12.5M / $15M and the reason are on
  `STARTING_CAPITAL` and `docs/PARAMETERS.md`.
- **Operating cash at the pre-game's start is capped** at the paid-in balance, so invested assets never
  go negative.
- Save key v24.

## Readings a reviewer should know

- **Two solved margins sit just below expected:** WC scenario 10 at −0.35%, GL scenario 12 at −0.12%.
  Accepted as a negligible underpricing by the prior board.
- **2026's rate change from 2025, at $12.5M** (twenty scenarios): WC +1.3 to +3.8%, GL +3.0 to +6.7%,
  Property −0.3 to +3.2%. Short of trend (4 / 8 / 5%); the mean reaches trend only at about $14.2M /
  $15.4M / $16.4M, where most margins solve below expected (`paid-in-capital-solve-report`).
- **The opening moves only in its reserves.** Surplus and year-1 premium are the scenario's as before;
  no played-year rate, premium, loss or reserve moves after the history commit (the baselines commit
  has the attribution).
- **The top bar's surplus reads off the Annual Statement** (fixed after the landing): the balance
  sheet's latest Ending Surplus for the view on screen (`topSurplus`). Before, it left out the loss
  expense reserve before year 1 (scenario 7 WC $26.17M against the statement's $20.95M) and showed the
  pool's surplus on every line's view. Display only; `header-surplus` drives it on scenarios 1, 7, 12.

## Tools

- `pregame-years-report` (PART=pregame for the margins, the pre-game rates and the statement), takes
  `--set`. `opening-position-report`. `paid-in-capital-solve-report`. All PROBES.
- `history-begins-2021-check` (FAST) replaces opening-partition-check, opening-reserves-report and
  seed-cohort-shape-check.

## Checks at the landing (2026-10-22)

- Control `1dd0118` reproduced value v80, export v88 (24 of 24), render v75 (206 of 206); the new
  baselines value v81, export v89, render v76, every moved row attributed per commit in the baselines
  commit.
- FAST sweep 77/78, the expected red `cession-uplift-basis` only.
- All 16 session drivers pass; the contract harness passes on localStorage, the stub, DynamoDB
  in-process, the Lambda handler and the built zip (194/194 each), races pass; the manifest is whole.
- Typecheck clean; lint at its baseline (21 problems, unchanged).
