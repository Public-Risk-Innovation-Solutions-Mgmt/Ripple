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

**MEASUREMENT ONLY. Nothing on this branch changes the engine.** First round done (2026-10-09, at
`144b4f8`): what "development" means per line, a compressed game measured against today's in a scratch
copy, and what compression would break. Findings below. **The headline: compressing development alone
barely changes what a player sees booked or how pricing reacts. The pricing window is the dial.**

## The two pieces of work this pulls on, in opposite directions

- **Underwriting (`feature/uw-decisions`).** Pricing catches up slowly — about 55% on WC by year ten —
  because the pricing triangle takes ten years to mature. Faster development should mean faster
  experience.
- **Risk control (`feature/risk-control`).** The programmes give their saving back as lower premium once
  the pricing window learns the lower cost — 7% at three years, 42% at ten. Faster development means it
  learns sooner, so more is given back.

The balance between the two is part of what this branch is to establish.

## Do not touch

`aws`, `feature/uw-decisions`, `demo-2026-09`, `demo-multiplayer-2026-09`, `demo-video-2`.

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

Plus two SOLVED quantities that follow the clocks: the per-claim drift `TRIANGLE_DEVELOPMENT_DRIFT` (over
closure age) and the cohort drift `TRIANGLE_DEVELOPMENT_DRIFT_HORIZON` (over the horizon), with
`TRIANGLE_OPEN_SHARE` between them. WC's "ten years" is mostly the payout and the horizon's top; its
large claims run to 25. ⚠ The idea's targets (WC 5, GL 3–4, Property 2) are exactly the MINIMA of
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
4. **`TRIANGLE_DEVELOPMENT_DRIFT_HORIZON`** — ⚠ NO DERIVER IN THE TREE; the original bisection was never
   committed. Reconstructed in scratch as the mean over horizons of Π(1 + g·2/(a+1)·openShare(a)), which
   reproduces today's stored targets to 0.3–0.8%. Scratch re-solve: WC 0.340 → 0.533, GL 0.644 → 1.236,
   Property 0.303 → 0.790. **Build and commit the deriver before using any of these numbers.**
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

### Scratch instruments (NOT committed; rebuild from these descriptions)

- clocks: payout/closure/open share/horizon by age per line from the engine's own functions;
- the two drift solvers above (step 2 on the open-share deriver's register, step 4 on the reconstruction);
- `measure.ts`: visibility (cohort ledger and `reserveCohorts` gross vs the drawn register) and pricing
  (paired program on/off, cumulative giveback). Four arms via full scratch copies of the tree.
