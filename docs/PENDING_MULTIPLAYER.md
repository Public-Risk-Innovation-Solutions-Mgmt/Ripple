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

### Order and commits

After pricing commits 3 and 4:

1. Exposure base and ordinary losses, behind a flag, old path still live.
2. Shock catalogue, with T as occurrences.
3. Regions.
4. Ten worlds, averaging, and per-world retention.
5. Cut members and the per-claim walk; remove routine development; fork the
   gates that test them.
6. Pool-level satisfaction.

**Each lands green before the next.**
