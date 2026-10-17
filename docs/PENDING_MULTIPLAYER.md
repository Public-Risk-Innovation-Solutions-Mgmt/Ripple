# Pending — text and rules waiting on later builds

The one place for player-facing text and display rules that are decided but not
yet shipped, because the build they belong to has not landed. Each entry says
what it is waiting on and where it will render. Nothing in this file renders
anywhere today.

**Bracketed figures are read from the engine and never restated.** A `[X]` here
marks a value the memo computes at render time. It must never be replaced with
a number typed into the text, here or in the code that renders it.

---

## 1. The pool-level Underwriting memo

**Ships with:** pool-level underwriting.
**Renders:** nowhere yet. The Underwriting department is hidden on the
Departments tab (`src/pages/DepartmentsPage.tsx`); the per-member memo it used
to show (`src/utils/underwritingMemo.ts`) is kept, untouched, and is not this
text.
**Shape:** one section per line the game uses, absent for lines it does not.

> **Underwriting**
>
> How your book changes from year to year — what you renew, and what new
> business you write. The settings are on the Decisions tab.
>
> **[Line name]**
>
> **Renewing your book.** Each year you can decline a share of your existing
> business at renewal, from none to 5% of exposure. Declined business leaves the
> pool. It makes the book smaller; it doesn't change the quality of what
> remains.
>
> **Writing new business.** Your intake setting decides how much new business
> the pool takes on each year.
>
> **What changes your size.** Your renewal and intake settings — and events
> outside your control, such as a large member withdrawal.
>
> **This year:** current exposure [X] · declined at renewal ~[Y] · new business
> ~[Z] · next year ~[W]

The `[Line name]` section repeats for each line the game uses.

**Left out deliberately:** new business may later carry additional unseen risk.
That is not stated in the memo for now.

---

## 2. The sign of reserve development

**SHIPPED.** The host's development % is wired, the Actuarial exhibit's 1-year
and total development columns are back, and the convention below is applied to
all three displays at once — the exhibit, the income statement and the results
page — through one shared formatter, `src/utils/developmentDisplay.ts`. The
engine's `priorYearDevelopment` keeps its own favourable-positive sign; only
the printing changed. The record below stands as what was agreed.

**Ships with:** the return of development. Full-cost booking leaves every
accident year at its initial estimate, so the Actuarial exhibit currently shows
no development columns (`src/utils/actuarialMemo.ts`).
**Applies to:** this exhibit, the income statement and the results page, all at
once.

**One convention everywhere:**

| Development | Colour | Sign and word | Example |
|---|---|---|---|
| Adverse (the estimate rose) | red | plus sign | **+$0.6M adverse** |
| Favourable (the estimate fell) | green | minus sign | **−$0.6M favourable** |

**The income statement currently uses the opposite sign** and must change at the
same time. `priorYearDevelopment` is favourable-positive (it is subtracted from
incurred loss), and the Financial Statements and Results pages print it that way.
Restoring the exhibit's development columns without changing those two pages
would put two opposite signs for the same event on adjacent tabs. The engine's
field can keep its own sign; what changes is how every page prints it.

---

## 3. New loss engine — plan and rulings

**Ships with:** itself. Approved, and waiting on **pricing commits 3 and 4** —
commit 3 because the one rate below is struck from the new pricing stack, and
commit 4 because T needs the tower's per-occurrence pricing.

⚠ **This entry is an engineering plan, not player-facing text**, which is the
one thing in this file that is not. It lives here because it is decided and not
yet shipped, which is what the file is for, and because the alternative was a
plan in a chat log.

⚠ **Every R-model value is on `docs/PARAMETERS.md`, under "R model (data
scientist)", and is not restated here.** That page carries each parameter's
value, unit, basis and a status saying what this game did with it — ADOPTED,
ADOPTED SCALED, ADAPTED, SUPERSEDED or NOT USED. A number typed into this
section would be a second copy free to drift from the one the page generates.

### Basis

The data scientist's R model, **adapted for structure, not ported line for
line**. The game keeps its own expected losses, from exposure and pure premium.
The R model contributes the shock structure, the decay and the fractional
effects.

### Ordinary losses

Aggregate and exposure-based. **One parameter per line: the year-to-year CV of
ordinary losses, starting at about 2.2%** — the value the R model actually
produces once its member factor has averaged over 100 members, rather than
either of its two input CVs. **No notional exposure units**: the CV is stated
directly at the line, so nothing has to invent a population to get a variance.
Severity trend 5% a year, as today.

**Built in commit 1, behind `NEW_LOSS_ENGINE` (off).** Per line per year, one
aggregate: expected = exposure × the expected ordinary loss cost per $100,
trended by accident year; realised = expected × a lognormal year factor with
mean exactly 1 and the line's CV. Each claim is limited at the line's lowest
reinsurance attachment — WC and GL $1M, Property $5M — and Property is the
attritional band only, today's catastrophe band excluded. The cost per $100 was
derived once from today's distributions on the full market at neutral risk
quality in year 1, and is recorded on `docs/PARAMETERS.md` as sourced, with the
script that derived it. It is drawn from its own labelled sub-stream, never the
sequential bootstrap. The pre-game uses the same engine under the flag.

### Reinsurance under the new engine — what it will actually pay

**Ruled.** The rate deducts what the reinsurance will **actually** pay, and the
reinsurance is priced on the same basis. Under `NEW_LOSS_ENGINE` both are
computed from the losses **the new engine generates**, never from today's
member distributions:

- **expected ceded** = the expected recovery on the new engine's own losses;
- **reinsurance price** = that expected recovery × the line's CLF at 70%.

Before commit 2 every ordinary loss sits below every attachment, so both are
**zero**, and the code says so at the seam (`layerRiskMomentsFor` in
`towerMoments.ts`). In commit 2 they become the expected recovery on the shock
losses, and its price. Placement decisions stay stored and visible; they take
effect once there are losses to cede.

### What now waits for the shocks

Measured by the same derivation, unlimited against limited, on the same basis.
This is the share of today's expected loss that **ordinary losses no longer
carry**, and that commit 2's shocks must bring back:

| Line | Waits for the shocks |
|---|---:|
| WC | 25.8% |
| GL | 49.4% |
| Property | 33.1% — 12.0% the catastrophe band, 21.1% attritional claims above $5M |

⚠ **Property was first reported as "about 12%". That was the catastrophe band
alone.** Limiting attritional claims at $5M moves a further 21.1% out of
ordinary, and the measured total is 33.1%.

**Open question for commit 2:** do large losses arrive **only** with shocks,
or as **routine large claims every year with shocks on top**? With shocks
alone, a quiet year carries a quarter to a half of today's expected loss less
than it does now, and the shocks have to be frequent enough to bring it back on
average. With routine large claims, the shocks are the tail above them.

### Commit 2 — shocks, large losses, regions (landed, flag off)

Built behind `NEW_LOSS_ENGINE`, with `ROUTINE_LARGE_LOSSES` (off) as the
switch for the open question above. Held by `shock-loss-check`. The rulings
and choices it made, so they are not re-decided:

- **T arrives as individual losses** through the occurrence path, each
  lognormal around T / count — counts per event on `docs/PARAMETERS.md`.
  **Earthquake and Wildfire are one occurrence each**, as today's catastrophe
  band books them, so the tower answers the event total and an earthquake
  keeps its $10M peril deductible. Their sum is priced as one lognormal with
  the sum's own mean and CV; the gate measures the gap and it is inside the
  noise.
- **T scaling is stable**: the line's expected ordinary loss over the R
  model's base premium x target loss ratio — ordinary against ordinary, so it
  moves with exposure and trend and never with a team's funding level.
- **A regional T lands whole in its region**, on members there by exposure;
  it is not cut to the region's share. A regional A is cut to it.
- **R is recognised in the year it applies** — its rate on each prior year's
  opening outstanding — and runs through the host's development code, on top
  of it, without touching the host's lifetime total.
- **Member Withdrawal removes members**, a quarter of each line's exposure at
  the next renewal, since members exist until commit 5.
- **Nothing fires before year 1**, in either mode: the pre-game and the bulk
  years are ordinary losses plus routine large losses when that switch is on.
- **Pricing is ex ante** at the catalogue's probabilities, counting only the
  years since year 1 an A could have started in. The GL pool limit applies to
  every large loss at the draw.

**Measured for the team discussion** (`scripts/tools/new-engine-report.ts`,
40 games x 10 years), against today's ACTUAL losses rather than today's
expected figure, which runs short of them by the trend gap below: shocks alone
carry about three-quarters of today's loss on WC, three-fifths on GL and
about 85% on Property, with a steady rate and reinsurance paying in under one
year in ten. Routine large losses bring all three back to about today's, the
tower pays most years, and GL's rate moves more than 20% in about one year in
seven.
Property's minimum surplus goes negative even placing every layer: a
Winterstorm's ten losses each sit under the $5M retention.

### No individual members

No roster, risk scores, size factors, prospects or experience modifier.
Underwriting moves **exposure**: a share of old business declined, and an
intake setting for new business. The new-business penalty stays as a parameter
at zero, so the mechanism exists before the calibration does.

### Shocks

The twelve-event catalogue with its A / T / R effects.

- **A** raises the year's ordinary losses and decays at 0.65 a year.
- **R** adds adverse development to outstanding prior-year reserves.
- **Economic inflation, the investment shock and member withdrawal** behave as
  in the R model.
- **T arrives as LARGE INDIVIDUAL LOSSES**, through the engine's existing
  occurrence path, so the tower responds per occurrence as it does to any other
  occurrence. This is the reason the R model's single aggregate stop is
  superseded rather than carried over.

**The loss count is set PER EVENT** — a nuclear verdict is one large loss, an
earthquake many — with starting counts proposed when the work begins.

⚠ **T is the EXPECTED aggregate. Realised totals vary, and are never rescaled
to sum exactly to it.** Forcing the sum would destroy the independence between
occurrences that the tower prices on, and the cession would be wrong in a way
no gate on the total would show.

### T scaling

**Per line, by that line's own premium ratio** — the game's premium for the
line against the R model's base premium for the *same* line. **Never one
pool-wide factor.** The R model's Property book is $4.5M and its GL book $7M,
so a single factor scales them unevenly. Recorded at the T-shocks parameter on
the parameters page as well, which is where it bites.

### Shock timing

**Multiplayer:** scheduled by the host, as today. **Singleplayer:** drawn by the
catalogue's own probabilities. No probability is consulted in multiplayer.

### Regions

The game's three. Each line's exposure is split across them, and **a regional A
or T hits that region's share only**. **R shocks stay pool-wide**, because the
reserve ledger has no regional split — the R model refuses a regional R for the
same reason.

### Development

**No routine development.** The R model's ±7% draw is dropped. Development comes
from the host's development setting, still to be wired, plus the R shocks, and
from nothing else. Removing the engine's own development machinery folds into
the member-cut commit, since full-cost booking has already switched it off.

### Coverage limit — GL at $25M per claim

**Landed, not pending.** The pool covers GL to $25M per claim; above that the
loss is the member's. It is recorded here because the loss engine prices off
the ledger this limit now caps, and because the engine must not reintroduce
the error it fixes: `cedeOccurrences` returned `retained = gross - ceded`,
which counted everything above the tower as the pool's — $655.5M over 30 games
x 10 years on GL, 7.83% of gross, worst year $103.9M. The excess is reported
as `memberShareAboveLimit` and enters no pool total. WC and Property have no
limit. See `POOL_LIMIT_PER_OCCURRENCE` and the **Coverage and the pre-game**
section of [docs/PARAMETERS.md](PARAMETERS.md).

### Pre-game funding level — 70%

**Landed, not pending.** The declared years were funded at the 70% confidence
level, on each line's own CLF table; players still default to expected. The
year-1 rate is unchanged by this — only the figure it is compared against
moves, from +41.7% / +18.5% / +35.7% to -7.0% / -4.9% / -3.9% on WC / GL /
Property. See `PRE_GAME_FUNDING_LEVEL` and the same page section; the welcome
memo reads the constant rather than naming a number.

### Development is a lifetime total

Recorded in code as `DEVELOPMENT_IS_LIFETIME_TOTAL`, **not yet wired** — see
the **Decided with the loss engine, not yet wired** section of
[docs/PARAMETERS.md](PARAMETERS.md). The percentage is how much an accident
year grows from where it stands to where it settles, over its REMAINING
LIFETIME, emerging with the payments: a year 60% paid has seen about 60% of
its development. It is not a rate per year, and reading it as one compounds to
roughly +54% on GL and +171% on WC at today's settings — a different model
rather than a refinement. It can be changed.

### Reinsurance options a team may buy

**Not yet wired**, recorded as `REINSURANCE_OPTIONS_PLANNED` and shown on
[docs/PARAMETERS.md](PARAMETERS.md). A choice of structure, replacing today's
place-or-decline on each band:

| Line | Options |
|---|---|
| GL | none · $9M xs $1M · $5M xs $5M · $14M xs $1M · $10M xs $5M |
| WC | the same as GL |
| Property | none · $20M xs $5M · $45M xs $5M · $25M xs $25M |

### GL ordinary losses — the $0-1M layer

**Not yet wired**, recorded as `GL_ORDINARY_LOSS_BAND_PLANNED`. GL's ordinary
losses are the $0-1M layer and are paid on **that limited layer's own payout
pattern**, not the whole account's. The matched pattern is the point: the
account pattern is dominated by the large claims above this band and would pay
ordinary losses out too slowly.

### Payout

The recorded paid and incurred patterns, with case and IBNR as the existing
derived presentation. Unchanged by this work.

### Averaging

Each team's year runs across **10 simulated worlds** — a parameter — with all
teams sharing the same draws. Each world carries its own reserve ledger and
surplus. **The pre-game runs once and the opening is shared**, so the fixed cost
is paid once rather than ten times.

Displayed dollars are averages. **Ratios are recomputed from averaged
numerators and denominators, never averaged.** **Each world's results are kept,
not only the average**, so a range can be shown later. Host-scheduled shocks hit
all ten worlds, with **severity drawn per world** — shared severity would move
the ten together and collapse the range this exists to show.

### One rate

Set **once per team-year, from the averaged history**, and applied in all ten
worlds. The commit-3 pricing stack carries over unchanged apart from its history
source, provided the averaging happens before the rate is struck.

### Session layer

Teams post the average in today's record shape, plus the **minimum, median and
maximum ending surplus** across the worlds.

### Performance

Measured on the current build, not estimated:

| | today |
| --- | --- |
| `processYear`, three lines | about 30 ms |
| ten worlds | about 300 ms a round |
| save at five years | 8.1 MB |
| one ResultSet | 962 KB |

The ResultSet is almost all per-claim and per-member detail, so **ten worlds are
affordable only once that detail goes**. Budget the stripped ResultSet and gate
it; do not take the 300 ms as the whole cost while the 962 KB stands.

### Satisfaction

Becomes **one pool-level index per line**. Designed separately — not part of
this plan.

### What the trend test measured, and why the flag is off

Before commit 3 landed, the new stack was priced against the old one at three
severity trends over six games, with `PRIOR_HISTORY_YEARS` at 5. **Nothing was
committed for the measurement** — it ran in a scratch worktree.

| trend | WC rate | GL | Property | WC actual/expected | GL | Property |
| --- | --- | --- | --- | --- | --- | --- |
| 0% | +51% | +20% | +7% | 1.246x | 1.193x | **0.998x** |
| 3% | +77% | +38% | +23% | 1.429x | 1.330x | 1.122x |
| 5% | +91% | +48% | +34% | 1.527x | 1.400x | 1.197x |

**THE TREND GAP.** The engine's own *expected* figure does not keep pace with
trending losses, and today's rate is built on it. Property's gap **vanishes
entirely at 0%** — 0.998x — and grows with the trend, so on that line the gap
is trend and nothing else. The new pricing trends the history properly; today's
does not.

**THE RESIDUAL ON WC AND GL.** About 20-25% survives at 0% on those two lines
and not on Property. **It is not isolated.** The likeliest reading is their
heavy large-loss tail, which the held figure does not fully carry, but that was
not demonstrated and should not be repeated as though it were. The new loss
engine replaces those losses anyway.

**The gap does not grow during a game** — year by year it is noisy around a
level, not a drift. It is a level difference between two estimators.

**WHY THE FLAG IS OFF.** Today's rate underprices; the new one prices
correctly. But on today's losses the new pure premium **swings 3-5x between
otherwise identical games**, because the old engine's losses are that lumpy. A
rate that moves 3x between two runs of the same game reads as broken; steady
underpricing reads as a tough book. So `NEW_RATE_STACK` ships off.

**IT TURNS ON WHEN THE NEW LOSS ENGINE LANDS.** That engine should make
ordinary losses **average exactly to their expected figure by construction**,
which removes both halves at once — the trend gap, because expected and drawn
are the same quantity, and the swings, because the losses are stable.

### What commit 4 does not have to wait for

Reinsurance pricing **does not read the stale figure**: `occurrenceProgramCost`
sums `allLayerRiskMoments`, computed at runtime from severity-trended
parameters. Required capital reads `expectedNetUnpaidLoss`, the booked reserve,
which under full-cost booking is realised rather than held. The CLF tables are
derived from the same trended distributions. **So commit 4 can price
reinsurance at expected layer loss on today's engine.**

### Three readouts that move off the Decisions panel

The new panel replaces the old one whole. Three of its readouts are not
obsolete and need homes when the flag turns on:

- **Expected combined ratio** and the **excess capital ratio** move to the
  **results page**.
- The **reserve margin standard** (90% confidence and its CLF) moves to the
  **parameters page**.

Until then they render as they always did, because the old panel is still the
one on screen.

### Ten-world averages will flatter teams that decline reinsurance

**Measured, flag on, 8 games x 6 years:** declining every layer RAISES mean
ending surplus — GL $44.1M placed against $73.7M declined, Property $17.6M
against $68.1M, WC $92.2M against $99.4M. That is not a defect in the price.
Reinsurance now carries a **14% load** (expected layer loss x the line's CLF
multiplier at 70%), so in expectation a team pays 1.14x what it recovers and
the mean must favour self-funding. Cover pays in the **tail**, not the mean.

⚠ **SO THE TEN-WORLD AVERAGE IS THE WRONG NUMBER TO SHOW ALONE.** Averaging ten
worlds is exactly the operation that hides a tail, and a team that declined its
whole tower will look better than one that bought cover in almost every
average the game can display. **The MINIMUM surplus across the ten worlds must
be shown beside the average**, on any screen that reports a team's position.
Without it the game teaches the opposite of what reinsurance is for.

### Assessments are a percentage of surplus — decided

Assessments are taken as a **% of surplus**, not of premium or of the deficit.
Recorded here because it is a decision rather than a derivation, and because
the parameter's own range (`assessmentPct`, 0 to 0.25) does not say which base
it applies to.

### Order and commits

After pricing commits 3 and 4:

1. Exposure base and ordinary losses, behind a flag, old path still live.
   **Landed, flag off**; held by `ordinary-loss-check`.
2. Shock catalogue, with T as occurrences.
   **Landed, flag off**, with regions and the routine large-loss switch;
   held by `shock-loss-check`.
3. Regions — **brought into commit 2**, at the brief's request.
4. Ten worlds, averaging, and per-world retention.
5. Cut members and the per-claim walk; remove routine development; fork the
   gates that test them.
6. Pool-level satisfaction.

**Each lands green before the next.**
