# State — `feature/fast-development`

**Read this instead of reconstructing branch state from conversation.** Convention:
`STATE_<final branch segment>.md`, one per branch, at the repo root. This file describes **this branch
only**.

**Cut from:** `feature/risk-control` at `b0fd991` (2026-10-09), its head when cut.
**Repository:** `Public-Risk-Innovation-Solutions-Mgmt/Ripple`. If `git remote -v` reads
`JanderAct/insurance-game-testingv2` on fetch or push, set both to Ripple before anything else — the old
URL redirects, so a fetch through it succeeds and looks right.

---

## What this branch is for

**Compressing claim development so a five-year game can see it.** Workers' Comp from about ten years to
five, General Liability to three or four, Property to two.

⚠ **A PLAYABILITY CHOICE, NOT A REALISM ONE.** Real WC develops for decades. The point is that a five-year
session cannot show ten-year development — everything that matters happens after the game ends. Anything
built here should say so at its constants, so nobody later "corrects" the development back to realism
without knowing why it was compressed.

## Status

**Commit 1 of the seven-commit plan is in: value-neutral groundwork.** Nothing executing changed — the dead
`TRIANGLE_DEVELOPMENT_DRIFT_HORIZON` is deleted, the four measuring instruments are committed as probes,
and this file carries the findings and the plan. Both value baselines byte-identical, render identical.
**Commits 2–7 move values and must wait for `feature/risk-control` to merge in** (Property mitigation, an
investment-rate cut and a risk-control dial split are landing there; every baseline here would be
re-captured twice otherwise).

Findings so far: three rounds, all in scratch copies, recorded below. The headline is unchanged from
round one: **compressing development alone barely changes what a player sees booked or how pricing
reacts; the pricing window is the dial.** Round three adds what blocks compression from being a clean
re-solve: **development today does not terminate at the drawn value, and the error is by size.**

## The two pieces of work this pulls on, in opposite directions

- **Underwriting (`feature/uw-decisions`).** Pricing catches up slowly — about 55% on WC by year ten —
  because the pricing triangle takes ten years to mature. Faster development should mean faster
  experience.
- **Risk control (`feature/risk-control`).** The programmes give their saving back as lower premium once
  the pricing window learns the lower cost — 7% at three years, 42% at ten. Faster development means it
  learns sooner, so more is given back.

The balance between the two is part of what this branch is to establish.

## Do not touch

`aws`, `feature/risk-control`, `feature/uw-decisions`, `feature/low-rates`, `demo-2026-09`,
`demo-multiplayer-2026-09`, `demo-video-2`. Only commit 1 is safe before `feature/risk-control` merges in.

---

## Findings — first round

All in a scratch copy of `b0fd991`; none of it is on this branch. 24 games per arm unless stated.

### 1. "Ten years on WC" is five different clocks, and they do not agree

| clock (constant) | WC | GL | Property |
|---|---|---|---|
| payout — 90% paid by (`FITTED_PAYOUT_PATTERN`, Weibull) | 11 yrs | 6 | 4 |
| development horizon (`IBNER_HORIZON`, drawn per cohort) | 5–12 | 3–8 | 2–4 |
| closure, all claims — 90% closed by (`FITTED_CLOSURE_CURVE`) | 7 | 5 | 4 |
| closure, claims > $100k (`CLOSURE_BY_SIZE.large`) | 25 | 8 | — |
| pricing window (`TRIANGLE_HISTORY_YEARS`, all lines) | 10 | 10 | 10 |

Plus the SOLVED quantities that follow the clocks: the per-claim drift `TRIANGLE_DEVELOPMENT_DRIFT` (over
closure age) and `TRIANGLE_OPEN_SHARE`, which dilutes it onto the cohort. (A third,
`TRIANGLE_DEVELOPMENT_DRIFT_HORIZON`, was listed here; it was dead and is deleted — see finding 4.)
WC's "ten years" is mostly the payout and the horizon's top; its large claims run to 25. ⚠ The idea's targets (WC 5, GL 3–4, Property 2) are exactly the MINIMA of
today's `IBNER_HORIZON`, not a new regime for that clock.

**The idea means all of them together** — a time-scale, here ×2 on every clock. Compressing one alone is
incoherent:
- closure faster than payout: files close with money unpaid — `claimPaidSplit`'s "tie wins over cap" case;
- horizon shorter, drift not re-solved: booked never climbs back to drawn — the forward-booking
  contraction stops unwinding, a permanent under-reserve;
- payout faster alone: the development base (`netUnpaid`) shrinks sooner, so development dollars fall;
- window vs development: a window SHORTER than development is today's case on WC (payout runs past the
  window — the 9.8% paid-triangle tail deficiency at `TRIANGLE_HISTORY_YEARS`); a window LONGER than
  development is coherent, just slow.

### 2. What a five-year game shows, today vs compressed (×2, all three re-solves below applied)

GROSS booked ÷ drawn, end of year 5, all five played cohorts (oldest cohort in brackets):

| | today | compressed |
|---|---|---|
| WC | 57% (67%) | 62% (78%) |
| GL | 57% (89%) | 66% (102%) |
| Property | 94% (99%) | 96% (100%) |

GROSS paid ÷ drawn: WC 37% → 49%, GL 33% → 57%, Property 78% → 91%.

**Paid visibility improves a lot; booked visibility barely.** What hides WC's cost from a player is the
FIRST booking — the contracted first estimate, ~40–60% of drawn — which no development speed touches;
WC's newest cohort books LOWER compressed (39% vs 42%). ⚠ Read these gross: on the net ledger GL's
oldest cohort reads 113% of the ultimate-basis truth today, and that is the tower basis (development
cession under-cedes — the standing `cession-uplift-basis` red), not over-development.

### 3. Underwriting and risk control are ONE number, and the window moves it — not development

Instrument: WC solo, ten-year games, the WC program on vs off, paired. Cumulative premium handed back ÷
cumulative loss the pool keeps (ultimate basis). It REPRODUCES the quoted risk-control figures: today
7.4% at year 3, 40.3% at year 10 (quoted 7% / 42%).

| cumulative giveback | yr 3 | yr 5 (game end) | yr 10 |
|---|---|---|---|
| today, window 10 | 7.4% | 16.2% | 40.3% |
| compressed, window 10 | 9.0% | 16.4% | 43.4% |
| today, window 5 | 9.5% | 21.4% | 42.5% |
| compressed, window 5 | 14.1% | 30.8% | 59.0% |

- **Pricing's catch-up and the programmes' giveback are the same quantity** — how far the experience
  rate has moved toward a changed true cost. Whatever closes underwriting's gap raises the giveback one
  for one; there is no balance to strike between two mechanisms, only where to set one dial.
- **Compression alone does NOT close underwriting's gap.** The lag is the ten-year window diluting new
  years with old ones; the chain ladder already develops immature years to an estimated ultimate.
- **A shorter window does**, and with compression the most. That would roughly double the giveback inside
  a five-year game (16% → 31%) and break WC's break-even sizing (`WC_RTW_TARGET_REDUCTION`) — on the
  order of $1.5M more premium back over five years, ESTIMATED from the table, not measured.
- ⚠ The underwriting branch's "55% by year ten" is NOT reproduced: this instrument's single-year ratio
  reads ~80% at year 10 today. Its definition is not recorded on Ripple; do not assume this is it.

### 4. What compression breaks, and the re-solve ORDER (each step reads the one before)

1. **The clocks** — payout Weibull scale, closure scales (both size bands), `IBNER_HORIZON`.
2. **`TRIANGLE_DEVELOPMENT_DRIFT`** (per-claim, over closure age), holding Σ first-estimate × cumulative
   at today's level. `TRIANGLE_INITIAL_CONTRACTION` HOLDS — A and k are a property of claim size, not of
   time. Scratch re-solve: WC 0.263 → 0.384, GL 0.587 → 1.139, Property 0.261 → 0.656.
3. **`TRIANGLE_OPEN_SHARE`** — `open-share-derive.ts`, which reads step 2. Passes its identity at
   0.9999–1.0000 under compression.
4. ~~`TRIANGLE_DEVELOPMENT_DRIFT_HORIZON`~~ — ⚠ **RETRACTED: THE CONSTANT WAS DEAD.** It had no reader;
   its own comment recorded it as wired once, measured worse on all three lines, and reverted. The
   engine's cohort drift is the per-claim g diluted by `TRIANGLE_OPEN_SHARE` (step 3). This step said
   "build and commit the deriver" — wrong; there was nothing to derive for. Deleted in commit 1 (see
   below). The scratch "re-solve" numbers that stood here re-solved a constant nothing reads, so the
   compressed arm of the first-round tables above did not depend on them.
5. **The per-claim revision law's age axis** — magnitude 2/(age+1), frequency, headroom exponent, the
   settlement factor — fitted on GL movement-by-age experience (`composition-table-check`). Compressed
   ages either re-fit it or time-scale its age argument. `reserveStepSigma` re-derives the per-step scale
   from the pattern on its own; `IBNER_TOTAL_SD` as a target holds.
6. **Booking bias and its unwind** (`IBNER_BOOKING_BIAS_COEFF`, `IBNER_UNWIND_DECAY`) — per-year rates.
7. **Downstream calibrations** — reserves roughly halve, so the opening pin and bands (anchored to
   reserves on WC and GL) need re-solving; investment income falls with them; every baseline moves; WC's
   program sizing if the window changes.
8. **Acceptance**: `forward-booking-climb-report`, `triangle-check`, the IBNER gates, then a sweep.

⚠ **A FLOOR NO RE-SOLVE REMOVES: development steps are ANNUAL.** A claim closing at age 1 takes no
development. Under ×2 compression 72% of Property's value (and 19% of WC's, 15% of GL's) closes at age 1
and stays at its contracted first estimate; the rest must climb 2.5× faster to hold the total. The
aggregate holds; the claims are distorted. Going much below two years on Property needs sub-annual steps.

### Instruments — COMMITTED as probes in commit 1 (`scripts/gates.ts` PROBES)

A number cited in a commit needs its tool in the repo. These four produced every number in this file:

| probe | what it reads |
|---|---|
| `development-clocks-report` | every clock per line from the engine's own constants (finding 1) |
| `claim-drift-derive` | the per-claim drift's deriver — `FACTOR=1` round-trips the shipped g exactly; `FACTOR=F` re-solves for closure F× faster |
| `termination-by-size-report` | where tracked claims close against drawn, by size band, with spread and WC mega-claim tower recovery; `LINE=WC\|GL\|Property` |
| `development-visibility-report` | `MODE=visibility` (finding 2) and `MODE=pricing` — the giveback (finding 3) |

Not committed, because what they measured needs engine code that does not exist on this branch: the
converging-climb arm and the compressed arms. Each is a scratch patch to `claimRevision.ts` /
`simulationEngine.ts`, described in commit 2 below precisely enough to rebuild.

---

## Findings — second round: the long-tail closure threshold ($100k) — REJECTED as a lever

Proposal tested: move `CLOSURE_SIZE_THRESHOLD` from $100k to $10M on WC and GL, so mid-size claims close
on the fast curve. Read only, scratch.

- **The slow curve is not a mis-fit.** `CLOSURE_BY_SIZE.large` was fitted to the pool's own claims over
  $100k (WC: 0% closed at age 1, 2.5% by age 3). A $150k and a $3M claim close identically BY
  CONSTRUCTION — one curve per band — so "the slow curve only belongs to mega-claims" has no support in
  the data it was fitted on.
- **Moving it closes value faster than it is paid.** At $10M, WC closes 42% of value by age 1 against
  41% paid; GL 20% closed against 10% paid. Closed files that have not been paid — incoherent.
- **It locks under-booking in.** A claim that closes early stops developing: moved claims terminate at
  45–66% of drawn with g held, and re-solving g to hold the line total over-develops the small claims.
- **It barely moves what it was for:** visibility barely moves, giveback 16.2 → 15.9% at year 5.

## Findings — third round: development does not TERMINATE at drawn, and the error is BY SIZE

Instrument: `termination-by-size-report` (tracked claims of AY1–2 after 14 years, 48 games), then a
scratch converging-climb arm and compressed arms.

### Today, booked ÷ drawn at termination, by drawn size

| line | $0–100k | 100–250k | 250k–1M | 1–5M | 5–10M | 10M+ | all tracked |
|---|---|---|---|---|---|---|---|
| WC | 115% | 103% | 93% | 79% | 66% | 63% | |
| GL | 153% | 135% | 115% | 92% | 80% | 64% | |
| Property (measured in commit 1) | 128% | 126% | 114% | 102% | 97% | 85% | 95.6% |

Tower recovery on WC claims over $5M: **66%** of what their drawn values would cede. Spread (sd of
log booked/drawn): WC 0.48 / 0.30 / 0.32 / 0.30 / 0.15 / 0.13; Property 0.24 / 0.28 / 0.25 / 0.21 /
0.21 / 0.17.

**Cause, one sentence: the climb is size-blind and the first estimate is not.** Every claim on a line
gets the same cumulative development (`developmentDrift` to its closure age), but
`TRIANGLE_INITIAL_CONTRACTION` books a small claim much closer to its drawn value than a large one
(initial ÷ drawn = A·x^(k−1)). So small claims over-develop and large ones under-develop. The
aggregate is held by the drift solve; the claims are not.

### The converging climb (scratch) — what commit 2 builds

Each tracked claim climbs `(drawn/reported)^w(a)`, with `w(a)` ∝ 2/(a+1) over its steps 1..T and summing
to one, T = min(closure age − 2, cohort horizon). Revision noise multiplies on top, unchanged. A claim with
T < 1 (closed before its first step) is trued up at settlement. Ultimate basis: drawn gross minus the
tower on the drawn claims.

| | $0–100k | 100–250k | 250k–1M | 1–5M | 5–10M | 10M+ |
|---|---|---|---|---|---|---|
| WC converging | 97.5% | 97.5% | 98.1% | 97.4% | 96.5% | 97.7% |
| GL converging | 110% | 106% | 98.6% | 99.1% | 99.7% | 105% |
| WC spread, today → converging | 0.48 → 0.48 | 0.30 → 0.29 | 0.32 → 0.30 | 0.30 → 0.27 | | |

Tower recovery on WC claims over $5M: 66% → **97%**. Spread preserved. Paid never crosses booked (0
crossings in every arm — payout pays a share of the booked reserve, so faster booking cannot cross).

### Compression on WC only (GL closure untouched), on top of the converging climb

| | today | converging | + ×2 | + ×3 |
|---|---|---|---|---|
| WC 90% paid by | 11 yrs | 11 | 6 | 4 |
| WC gross booked ÷ drawn at game end (5 cohorts) | 57% | 64.5% | 72% | 79.5% |
| WC gross paid ÷ drawn at game end | 37% | 42% | 58% | 69% |
| GL gross booked ÷ drawn (unchanged by WC compression) | 57% | 72% | 72% | 72% |
| cumulative giveback, year 5 | 16.2% | 16.5% | 15.5% | 19.8% |

Re-solved per-claim drift (WC): ×2 **0.38429**, ×3 **0.50889** (`claim-drift-derive FACTOR=2|3`).
Horizon: 3–6 (×2), 2–4 (×3). **What breaks first is the spread** — it falls 15–30% in WC's middle and
large bands under ×2/×3, because the revision law's ages are not time-scaled (commit 5). Second is the
**year-1 floor**: value closing at age 1 takes no development, 19% of WC's under ×2 and 27% under ×3.
**Recommendation: ×2.**

### The three things commit 1 was asked to explain (stable engine, scratch arms; NONE FIXED)

**1. WC "≈2.5% low in every band" under convergence — NOT the settlement factor, and not one uniform
effect.**
- The settlement factor is mean-neutral: `settlementFactorMean()` = 0.9999997, and on the reserve basis its
  expected effect is 1 + h·(E[f] − 1) = 1. Realised mean f on settling tracked claims 1.002 (h ≈ 0.27).
  **Guess rejected.**
- The revision factor is mean-1 (measured directly: 0.998–1.002 ± 0.001 across ages, values, headroom).
- Two things make it up, split by switching revision noise off and pairing claims (48 games, fresh seeds,
  game-bootstrap SE):

  | WC converging, booked ÷ drawn | noise ON | noise OFF |
  |---|---|---|
  | tracked from inception | 100.4 ± 1.6% | 99.2 ± 0.6% |
  | **promoted from the bench** (a third of tracked value) | 98.2 ± 1.4% | **96.5 ± 0.5%** |
  | band SE with noise on | ±1.5–3.6% per band | ±0.6–1.4% |

  (a) **Sampling.** On the original seed set, noise off restores 99–101% in every band; on fresh seeds
  noise on reads 103 / 96 / 98 / 100 / 104%. A uniform −2.5% is inside the band standard errors.
  (b) **A real ~3.5% shortfall on PROMOTED claims** — the same mechanism as GL below, the opposite sign.

**2. GL's two smallest bands 6–10% high — PROMOTION FROM THE BENCH.** A benched claim's `current` is its
share of the untracked mass, and the mass develops at ONE size-blind rate. At promotion GL claims sit
at **~200–210% of reported whatever their size** — which for a $0–100k claim is already 96% of drawn
(it needs only ×2.07), and for a 100–250k claim 85%. The converging climb then applies its remaining
weight as `(drawn/reported)^w`, relative to where the claim WOULD be on its own schedule rather than
where it IS, and overshoots: promoted $0–100k 109–110%, 100–250k 106–109%, consistent across seed sets
and with noise off. Claims tracked from inception land at 100–103% with noise off. WC's mass develops
more slowly (promoted at ~150% of reported, 55–70% of drawn on mid/large claims), so the same error
lands LOW there — explanation 1(b).
- ⚠ GL's inception-tracked $0–100k band swings 92–111% between seed sets: sd of log 0.6, too noisy to
  read alone.

**3. Property's tracked claims, measured today** (48 games, 14 years): 128 / 126 / 114 / 102 / 97 / 85%,
all tracked 95.6%, spread 0.17–0.28. **The same size-blind cause, and it fits almost exactly.**
Property's contraction books small claims AT OR ABOVE drawn (initial ÷ drawn 1.075 at $50k, 0.99 at
$150k, 0.68 at $20M), yet every claim takes the line's ~1.26 cumulative climb. Predicted 1.26 ÷ need:
135 / 125 / 113 / 101 / 93 / 86% against 128 / 126 / 114 / 102 / 97 / 85% measured.
- ⚠ Consequence for commit 2: Property's small claims must climb DOWN. The converging law must
  allow drawn < reported (a ratio below one), not assume a climb.

## THE PLAN — seven commits, in this order

1. **Value-neutral groundwork. DONE.** Dead constant deleted; four probes committed; this file.
   Nothing moved. The only commit safe before `feature/risk-control` merges.
2. **Converging climb on tracked claims plus settlement true-up.** Store `drawn` on `DevelopingClaim`
   (and `BenchClaim`) rather than inverting `reported`. **Climb from where the claim IS, not from
   `reported`:** the step is `(drawn/current_noise-free)^(w(a)/Σ_{j≥a} w(j))`, so a promoted claim takes
   exactly its remaining gap. That fixes explanations 1(b) and 2 together. Allow a falling climb
   (Property, explanation 3). Converge the untracked remainder on its drawn total. Moves every baseline
   on all three lines, the opening pin and bands; `cession-uplift-basis` (expected red) may turn green.
   Acceptance: `termination-by-size-report` within ±3% by band on all three lines with inception and
   promoted claims both in range, spread unchanged.
3. **Re-solve the per-claim drift for the untracked remainder** (`claim-drift-derive`), then re-derive
   the open share (`open-share-derive`).
4. **WC ×2 compression** — payout, all closure scales, horizon 3–6 — in the same commit as the drift and
   open-share re-solve (g 0.38429).
5. **Time-scale the revision law's age argument on WC** to restore the spread. Acceptance:
   `composition-table-check` and the spread line of `termination-by-size-report`.
6. **Time-scale booking bias and its unwind on WC** (`IBNER_BOOKING_BIAS_COEFF`, `IBNER_UNWIND_DECAY`).
7. **Downstream.** Opening pin and bands, re-measure WC programme sizing (`WC_RTW_TARGET_REDUCTION`,
   `development-visibility-report MODE=pricing`), recapture all three baselines, then a sweep.

