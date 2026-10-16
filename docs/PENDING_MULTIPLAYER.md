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
