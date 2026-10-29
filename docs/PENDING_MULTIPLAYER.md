# Pending — text and rules waiting on later builds

The one place for player-facing text and display rules that are decided but not
yet shipped, because the build they belong to has not landed. Each entry says
what it is waiting on and where it will render. Nothing in this file renders
anywhere today.

**Bracketed figures are read from the engine and never restated.** A `[X]` here
marks a value the memo computes at render time. It must never be replaced with
a number typed into the text, here or in the code that renders it.

---

## Pricing's ALAE load fixed per line (save key v43) — wip/pricing-alae-load

Pricing loads ALAE at `PRICING_ALAE_LOAD` (WC 11%, GL 15%, Property 3.5%, each
range's middle) every year, played and pre-game, not the window's mean drawn
ratio; the ALAE booked is still drawn. Shown as "ALAE load (11.0%)" on the Rate
Indication, Model tab and Year Walkthrough.

**Owed — the seeds are to be re-picked on this build.** The openings moved with
the pre-game's rates and were accepted as they fall (ruling, option 2):
`SCENARIO_OPENING_BARS` holds scenarios-check 5 at what this build produces
(worst miss 18.5%, 4 of 20 within 5%, against 12% and 18 when the seeds were
picked) and is marked temporary; `SCENARIO_OPENINGS_v2` records the openings.
Re-pick, then restore the bars and re-record.

**Landed with:** FAST 93/93, SLOW 4/4, typecheck clean, lint identical to
861b8c7; `alae-ratio-check` 3 restated (the setting every year on every line,
controls: the old window rule, WC at 12%, and the old rule planted in the
engine); VALUE_IDENTITY_v91, SOLO_EXPORT_GUARD_v116, RENDER_IDENTITY_v118
attributed against 861b8c7 (render against 3bd6d2b, merged in); all 26 session drivers with the admin-token hook;
the contract harness on every pass. Figures: scripts/probes/alae-load-probe.mts.

## Decisions carry into the next year in single player — wip/carry-decisions

Single player and Test player now start each year from the decisions the year
before was played on, as a hosted team always has: funding, the underwriting
sliders, the reinsurance cover, the aggregate cover, the asset mix, risk
control, dividends and assessments, and loan repayment. Only the first year
opens on the defaults. `commitYear` (App.tsx) carries
`settled.played.decisions` through `carryDecisions` (a copy, re-stamped with
the next year's number); risk-control programs still come off the pool row's
echo. A new game and a save without an editing buffer are the only other
places the defaults are written. No save key change: a save replays the sets
it played and restores its editing buffer as written.

Nothing a game plays moves when its decisions are set every year: value
identity, the export guard (48 of 48) and the render harness (236 of 236, which
plays two years on the defaults) are unchanged against multiplayer 1a02966.
What moves is what a player sees when a year opens — their own choices, not the
defaults. `carry-decisions-check` (FAST) and the rate-indication driver hold it.

---

## Risk control in the divisor (save key v40) — wip/risk-control-divisor

Risk control is an expense in the divisor, beside admin:

    rate = pure premium × CLF ÷ (1 − admin share − risk control %) + reinsurance

so the charge collected is exactly the risk-control % of the rate before
reinsurance, and admin is its 20% of that same rate. This replaces the
multiplier `× (1 + risk control %)` that landed first. The average cut m is
re-sized so expected losses + LAE saved still equal the charge. At 0% the
divisor is 1 − admin, and every figure is byte-identical to before.

The Rate Indication, the Decisions panel, the Model tab and the Year
Walkthrough each show the expense ratio, risk control taken from the line's
current choice:

    Admin                      20.0%
    Risk control                2.0%
    Total expense ratio        22.0%
    Permissible loss ratio     78.0%

Measured (20 scenarios, 5 years, shocks off, the slider on every line every
year): the year-1 rate rises 0.80 ÷ 0.78 = +2.56% at 2% (the multiplier gave
+2.00%) and 0.80 ÷ 0.75 = +6.67% at 5%; losses + LAE saved over the five years
are 0.99–1.04 of the charge on each line, in both modes. Admin collected is
2.6% higher at 2% than under the multiplier, because admin is now taken on the
risk-control share as well.

A single player's decisions did not carry into the next year when this
landed (`commitYear` reset them to defaults); they do since
wip/carry-decisions, below — risk control included.

---

## The aggregate cover on attritional losses (save key v38) — wip/aggregate-cover

Each line can buy, beside its per-claim layer, an aggregate cover on the year's
attritional losses — normal losses plus the shocks' surges (A); never a large
(T) claim, Economic Inflation's uplift or the development of an older year.
None (the default; an absent choice reads as None), 110/50, 125/50, 150/50:
attachment and limit as shares of expected attritional losses (expected normal
losses x (1 + the average surge)). Priced by the pricing workbook's "Agg
Attritional" tab (`AGGREGATE_COVER_OPTIONS` and `utils/aggregateCover.ts`):
four surge cases at the shock assumptions' odds, each at the top of its A range
(`AGGREGATE_COVER_SURGE_BASIS`; midpoint moves cases and terms together),
normal luck at the line's ordinary-year CV, x load 1.2 / 1.0 / 1.0. Charged as
reinsurance (no admin); the recovery is booked once, at the year's booking.
Offered and priced the same in every game — single player, Test player and
hosted, shocks on or off, events scheduled or not — as the per-claim covers are
(COVERS_IN_EVERY_GAME); with no shocks it pays only on a bad ordinary year, and
the menu does not say so (restated on multiplayer ed62748: aggregate-cover-check
sections 1 and 6, the rate-indication driver's hosted room buying 110/50).

2027 prices at default decisions: WC $667,967 / $292,675 / $94,629; GL $675,955
/ $263,022 / $74,451; Property $879,680 / $434,590 / $188,692. ⚠ GL is $41 /
$16 / $5 below the figures agreed before the build: the rate is struck on the
book averaged over the worlds (GL 614.92), and the agreed figures were read off
world 1's own book (614.95).

**Landed with:** FAST 88/88 (the sweep alone) and SLOW 4/4, the manifest held;
typecheck clean; lint identical to multiplayer 20f85ba (its 15 errors and 7
warnings, none new); `aggregate-cover-check` (new), each section failing on a
planted defect; VALUE_IDENTITY unchanged, SOLO_EXPORT_GUARD_v110 and
RENDER_IDENTITY_v107 attributed against 20f85ba's own capture; all 24 session
drivers with the admin-token hook (rate-indication extended to the cover,
532/532); the contract harness on every pass (local, http, DynamoDB, built
handler, admin, race probes). Screenshots are in
`docs/screenshots/aggregate-cover/`.

**Owed — the prices and the game's surges disagree.** The prices assume one
surge level a year at T_COVER_FREQUENCY's odds (15% of years). The game's
surges come from its catalogue, rarer: under today's surges the expected
recovery in 2027 (aggregateCover.expectedRecoveryToday) is WC $212K / $126K /
$30K, GL $346K / $159K / $40K, Property $446K / $334K / $153K, against expected
recoveries at the priced odds of WC $557K / $293K / $95K, GL $563K / $263K /
$74K, Property $733K / $435K / $189K. Until the game's surges follow those
odds, recoveries will run below the prices.

---

## The shocks landing (save key v30) — owed checks CLEARED

Landed on multiplayer for play-testing without the full checks; those were run
on `wip/shocks-owed-checks` (cut from multiplayer 19b6f17) and landed with it.

**Cleared:**

1. **FAST and SLOW** (`npx tsx scripts/gates.ts --all`): 85 of 86 green and
   `cession-uplift-basis` expected red. 16 gates were red on 19b6f17; 15 were
   restated to the shock design, each with a control that fails when broken.
   `property-cat-check` needed no restatement: it was red on a defect.
2. **Real defects fixed, each with a control:** Property catastrophe cession
   went negative when a class attached above the layer's ceiling (attachment now
   capped at the ceiling; `property-cat-check`); a shock's dollars were keyed by
   event, so an event fired again while in force credited the year's whole cost
   to both firings and the pool summed it twice (now one record per firing;
   `shock-effects-check` 8); the dormant aggregate stop sampled T claims at table
   size while its basis grew them by trend (`aggregate-stop-check` 2).
3. **`cession-uplift-basis` stays expected red**, its reason restated. With
   None every arm ceded nothing and it passed printing NaN; it now buys
   $38M xs $2M and reads WC 23.8%, GL 24.8%, Property 1.8%, pool 10.0%, because
   the one T claim sits wholly above the attachment and all its development is
   ceded. Measured that the T claims develop with their cohorts (GL +31% against
   +38%), so it is not a routing concentration. **Ruled: it stays on the
   expected-red list until adverse development lands. When adverse development
   lands, re-derive its limits (6% per line, 1.5% pool) for the new design —
   one T claim per event-line above the attachment, developing with adverse
   development — and take it off the EXPECTED_RED list in `scripts/gates.ts`
   then.** **DONE with the adverse-development landing:** the gate now grades
   lifetime development cession against what the ceded claims' own cohort
   development would cede (ratio <= 1.10 a line, <= 1.05 pooled). Measured
   1.0000 on every line — with full-cost booking the only development left is
   adverse development, allocated proportionally — against 2.4x-12x for the
   concentration controls. It is off the EXPECTED_RED list and green.
4. **Value and export baselines** recaptured as VALUE_IDENTITY_v84 and
   SOLO_EXPORT_GUARD_v92: the control (19b6f17) moves 21,101 of 39,600 values
   and all 24 exports, the landing's own movement; the owed-checks commits move
   none.
5. **`gate-timings.json`**: `shock-effects-check` entered at 60 from the sweep.
6. **Every session driver** with the admin-token hook, the contract harness
   (local, http, DynamoDB, the built Lambda handler) and the race probes: green.
7. **The render attribution review** (cleared by the simple underwriting
   landing, recorded at RENDER_IDENTITY_v89 in render-identity-check.ts): the 89
   moves v87 absorbed are the cover list alone (31), WC and GL year-2 expected
   losses (10) and Property's figures (48). One was a defect: the Calculation
   Audit's reserve risk margin check read Review by exactly the retained
   catastrophe on Property; the audit now recalculates it, and
   audit-formula-check section 6 fails when the term is left out.

**Still owed:**

- **The shadow's cost** (`SHOCK_FREE_PRICING`): years after a shock run their
  worlds twice; measured only through the drivers' and the report's run times.
- **Known approximations, stated not fixed**: expected losses grow T by trend
  only (no year-1 base in hand); with shocks off Property sits slightly below
  the pre-landing build (Y10 $38.2M vs $39.1M over 20 scenarios) because the
  fold no longer divides by the uplift; the T covers' brief prices do not follow
  from the catalogue's odds (WC's expected loss ratio 16-27%).

The figures this landing was read on are in `scripts/tools/shocks-report.ts`
(sections 1-5 and `--growth`).

---

## The adverse-development landing (save key v32)

Landed on multiplayer with the full checks: FAST 78/78, SLOW 4/4, the manifest,
every session driver with the admin-token hook (test-player 31/31), the contract
harness on every pass, and baselines VALUE_IDENTITY_v86, SOLO_EXPORT_GUARD_v94
and RENDER_IDENTITY_v90 attributed against multiplayer ebc3b4a. Reserve
inflation is off; hosted and Test player games choose Low / Mid / High adverse
development per line; single player has none (`SOLO_ADVERSE_DEVELOPMENT`).

**Still owed:**

- **The race probe's "No room with code …" failure** (`npm run contract:races`,
  `scripts/tools/session-race-probe.ts`, section J's `advance` on a room created
  a moment before). It failed on the FIRST run after the session drivers and a
  Docker restart, twice (the adverse-development merge rounds); 6 of 6 reruns
  then passed, 3 at the landing's head and 3 at multiplayer ebc3b4a. Suspected:
  the local DynamoDB container's clock or a room expiry read just after a
  restart (`live()` in `src/session/server/rooms.ts` reads a missing header and
  one past `expiresAtSec` alike) — not yet confirmed. Treated as a flake for
  this landing by the project lead's ruling.

---

## Development pricing — reverted on multiplayer; its build is 00b45eb

Development pricing (the pre-game developing at the chosen level, learned
development in pricing, Test player taking the host's shock switch, its gate,
restatements, baselines and save key v33) is reverted on multiplayer, commit by
commit (3e9639d … ca3f57e), so it does not go to aws with the Annual Statement.
**The build with development pricing is commit 00b45eb**: multiplayer before the
revert, with the Annual Statement and test-player work as of e3bc035 merged in.
Build and test development pricing from there; to bring it back, revert the
reverts.

## Admin as a share of premium (save key v34) — wip/pricing-rework

Admin is 20% of premium on every line (`ADMIN_SHARE_OF_PREMIUM`, per line so it
can be set later): rate = pure premium x CLF / (1 - 20%) + reinsurance, the
permissible loss ratio 80%, booked admin = that admin x (1 + the year's 0-2%
overrun). Profit and contingency, the fixed and per-exposure admin and the admin
trend are removed; the pre-game prices the same way. The Rate Indication, the
Decisions panel and the Model tab show admin 20% and the permissible loss ratio
80% every year. Save key v34 (v33 retired with it: the reverted development
pricing's key, live on aws for a while).

**Landed with:** FAST 81/81 and SLOW 4/4 (the manifest held); typecheck clean;
lint identical to 8a4dae4 (its 14 errors and 7 warnings, none in a changed
file); `admin-share-check` (new, replacing `admin-trend-check`) and seven gates
and three drivers restated, each failing on a planted defect (WC's old 2% back in
the divisor, WC's share at 19%, admin on the rate including reinsurance);
baselines VALUE_IDENTITY_v89, SOLO_EXPORT_GUARD_v104 and RENDER_IDENTITY_v101,
each attributed against multiplayer (8a4dae4 reproduced v87/v100; 3686296,
merged in before landing, reproduced v103 — the downloads following the view),
no loss, claim, reserve or pure-premium figure moved; all 24 session drivers
with the admin-token hook; the contract harness on every pass (local, http,
DynamoDB, built handler, admin, race probes).

**Flagged:** WC's 2027 rate falls from 2026's in 8 of 20 scenarios, 3 by more
than 2% (worst -3.15%) — the prior board's margin now carries what the 2%
contingency did (figures at `ADMIN_SHARE_OF_PREMIUM`).
**Pre-existing, not fixed:** `scripts/tools/rate-buildup-report.ts` (a tool, not
a gate) fails its tie-out on 8a4dae4 too (its walk's exposure reads 0).

## The Annual Statement laid out as the template

The Annual Statement page and its new **Download Annual Statement (Excel)** button
follow the template cell for cell, but for a short list of deliberate
differences (below): every title, label and blank row in place, the five years
shown, and Prior and All Years in the program-year sections. The template is now **the Pool sheet of
`docs/Annual Statement Example v2.xlsx`**; the first, `docs/Annual Statement
Example.xlsx`, is kept only as a control in the gate. v1's row 15, "Profit and
Contigency", is gone, because it is a margin in the rate, not an expense; v2
carries that removal itself. The layout is `TEMPLATE_ROWS` in
`src/utils/annualStatementTemplate.ts`; its header says where every figure comes
from. The Excel file (`annualStatementExport.ts`) has one sheet for the pool and
one per line, with numbers in the cells.

**v2's two changes.**
- **All Years.** Column I is a new **All Years** column in Contributions To The
  Current Calendar Year, Program Year Totals and the Gross, Ceded and Net blocks,
  headed "All Years". On every dollar row it is the sum of Prior and the five
  years, written in Excel as `=SUM(C:H)` over its own row, as the template does,
  with the value cached. The ratio rows ("% Increase over Prior", "Loss & LAE
  Ratio") are blank there. The Contributions' All Years Total Net Incurred is the
  calendar year's Total Incurred Loss & LAE on the Net Income Statement, and the
  gate asserts it.
- **Spacing.** One blank row, not two, between the Contributions' Written
  Premium and "Previous Reported Claims", so the statement is 155 rows.

**Every deliberate difference from the template** is listed in one place,
`annualStatementTemplate.ts` (`LABEL_CHANGES`, the inserted row, `showsPrior`,
`cellBorders`, `shownFigure`); the page, the download and the gate all read it.
The template file keeps its own wording. The gate prints the list, checks each
entry against the template, and fails on any other cell that differs.
- **Seven columns, the years aligned.** Every table is seven columns wide. Net
  Income Statement For The Year, Balance Sheet at Year-End and Underwriting
  leave C (Prior) and I blank, with their lines kept, so every box is the same
  width; column I is drawn with H's lines there. Contributions, Program Year
  Totals and the Gross, Ceded and Net blocks keep Prior, the five years and All
  Years. Underwriting's first year "Change from Prior" and "% Change Over Prior"
  are blank, as there is no Prior beside them.
- **Headings.** "Net Income Statement" becomes **"Net Income Statement For The
  Year"**, so it is clear its columns are what was booked in each calendar year.
  "Reinsurance Information - Policy Year Totals" becomes **"Reinsurance
  Information - Program Year Totals"**. "Contributions To The Current Calendar
  Year - Net" and "Program Year Totals - Net" end **"- Net of Reinsurance"**.
  Gross, Ceded and Net head their blocks in bold, on the left in the label
  column (a cell style, not compared by the gate; `downloads.cjs` checks it on
  screen).
- **Net Income Statement rows.** "Premium" becomes **"Written Premium"**.
  "Additional Admin Expense (risk control)" becomes **"Other Admin Expense"**.
  The admin rows are General Admin Expense / % of Premium / Other Admin Expense
  / % of Premium; **one row is inserted** for General Admin's own share, so the
  statement is 156 rows, and each "% of Premium" is that row's own share of
  Written Premium. The template's single "% of Premium" there covered both. All
  three "% of Premium" rows in the section are indented and left-aligned, like
  "% Increase over Prior".

**Decided in the build, recorded here so nobody re-decides them:**

- **Operating Ratio's denominator is the member charge**, the combined ratio's
  own, because the reinsurance cost is a cost in its numerator. The Premium row
  is net of reinsurance, and dividing by it would count reinsurance twice.
- **Previously reported vs newly arising** (Contributions section), as specified
  in the request that asked for it. For each OLDER accident year, with D its movement this
  year and s its IBNR share of the reserve outstanding at the start of the year:
  - Newly Arising Reserve Changes = −ΔIBNR + s·D: claims moving from IBNR to
    reported (the reported pattern's emergence), plus IBNR's share of the year's
    development. Its Payments are 0, because a newly reported claim is reserved,
    not yet paid.
  - Previously Reported Payments are the year's payments, and its Reserve
    Changes are (1 − s)·D less them.
  - Change in IBNR is ΔIBNR. The three sum to D, so Total Net Incurred did not
    change.

  The current program year's claims are all newly arising. Case vs IBNR is the
  presentation split (`reserveSplit.ts`). The split is computed accident year by
  accident year and line by line before it is summed into the columns.
- **The Contributions variance.** Two re-splits, presentation only. Each
  accident year's total paid and Total Net Incurred are unchanged by them, and
  the gate checks both, with failing controls.
  - **Newly reported claims are paid in part.** Of an older accident year's
    newly reported amount, the share a new accident year pays in its first year
    is paid: by line, the current program year's paid ÷ reported, held between 0
    and the year's payments. Previously Reported Payments take the rest.
  - **Settlement differences.** A draw per line, accident year and year: mean
    zero, standard deviation `SETTLEMENT_SPREAD` (3%, a setting) of the
    previously reported payments. It comes from the game's seed, so every world
    draws the same. It adds to Previously Reported Reserve Changes and comes off
    Change in IBNR. **The program-year blocks carry the same draws:** each
    accident year's draws to date move from IBNR Reserves to Case Reserves (and
    so Reported) in Program Year Totals and the Gross and Net blocks. Ceded
    carries none, since the draw is on the retained claims, so Net = Gross −
    Ceded holds. Each year's Change in IBNR and Reserve Changes in the
    Contributions are therefore exactly the movement in those rows; the gate ties
    them, every column, against the statement a year earlier. Paid, Total
    Incurred and the reserves' total are the engine's. **Each year's draw is
    capped at the IBNR the accident year has left** (its IBNR that year less the
    draws already moved); what it would take beyond that is dropped, not carried
    over, so no IBNR cell goes below zero. The gate checks every IBNR cell, with
    a control that, uncapped, goes negative (48 of 1,404 cells across three test
    games did, the worst −$288K).
  - **Not built: LAE paid half at report, half at close.** LAE paid is the
    engine's own figure (`laePaid` = LAE share × gross paid): it is cash, it
    earns investment income, and the LAE reserve is the balance sheet's Loss
    Expense Reserves. Scheduling it would change engine figures, not only how the
    statement splits them.
- **The Contributions' Written Premium is each program year's own written
  premium** (net), with Prior the sum of the older years, so no column reads 0.
- **Underwriting's Change from Prior is a percentage** (the template's C60 is
  "%"); the old statement showed the change in $M. **Retained %** is Renewal
  Business over last year's Written Exposures; Prior's covers the years in it
  that have a year before them (2021, the pool's first, has none).
- **At pool scope the underwriting rows are the lines' sums only where the
  lines share a unit.** WC and GL are both payroll; Property is building value
  (TIV). A pool writing Property beside WC or GL shows "—" in all seven underwriting rows:
  Written Exposures, Change from Prior, New Business, Renewal Business, Retained
  %, Current Rate and % Change Over Prior. A WC and GL pool shows their sums, and
  its rate is the exposure-weighted rate. A Property-only pool is in one unit
  and shows its line's figures.
- **The header's combined-ratio chip is unchanged** (cumulative since game
  start). The statement has no Total column now, so `combined-ratio.cjs` works
  the cumulative ratio out from the statement's own cells. ⚠ It does so after
  years 1 and 2 only. Before year 1 the chip covers every pre-game year, and
  with Prior off the Net Income Statement the older years are on no cell.

**Borders, copied from the template cell for cell.** The template's lines are
the boxed year headers, the thin vertical lines on every row (label column
included), the line closing each section and the balance sheet's lines under each
group. They are read from the file by `scripts/tools/generate-statement-borders.ts`
into `src/utils/annualStatementBorders.ts`, generated and never edited by hand:
now from v2's Pool sheet, nine columns A to I, one entry per template row
(`TEMPLATE_BORDERS`). The statement's own lines are those through its
differences (`cellBorders`): the inserted row draws row 13's lines, and above
the Contributions column I draws H's. The table includes the template's last row
(155), which carries the Net block's closing line. The page draws them in CSS and the download writes them
with **exceljs** (SheetJS community writes no borders). exceljs is a dynamic
import: about 940 kB, fetched only when the button is pressed. The gate reads
the template file itself and compares every cell's border in the downloaded
file, A–I on all 156 rows, through the list. `downloads.cjs` does the same for the screen and
checks that exceljs is not loaded with the page. Re-run the generator if the
template's lines ever change; the gate fails until you do.

**The PDF** (`annualStatementPdf.ts`, the **Download Annual Statement (PDF)**
button beside the Excel one) draws the same statement cell for cell: every
section, row label, blank row, heading and border (`TEMPLATE_ROWS`,
`cellBorders`), Prior where shown, the five years, All Years, each figure as
the page writes it, negatives in red. One statement per sheet in the
workbook's order, each from a new page, landscape Letter, a header on every
page (pool, line, the year the statement stands at) and "Page n of N" in the
footer. Text is 9pt; blank rows are half height, as they only space the
sections; a section stays on one page where it fits, so a statement runs to
three pages. It is built in the browser with **jsPDF**, a dynamic import
fetched only on the press, like exceljs; the page's own bundle grows 4 kB (the
drawing code). Standard Helvetica has no "−", so negatives print "-" (still
red). `annual-statement-pdf-check` (FAST) reads the file back with pdf.js on
six games against the statements, with three failing controls;
`downloads.cjs` presses the button and opens the file, and `test-player.cjs`
and `viewer.cjs` press it in a Test player and a hosted game.

**The downloads follow the view** (`statementsForView`), the Excel file and
the PDF alike. On a line's view: that line's statement alone (one sheet, about
three PDF pages). On the Pool view: the pool's, then each line the team writes,
but a team writing one line gets the pool's alone, since its pool statement is
that line's. Each file is named by the view and the year the statement stands
at, e.g. `Annual_Statement_WC_2026.xlsx` or `Annual_Statement_Pool_2026.pdf`.
The page itself is unchanged. The template and PDF checks hold each view's file
to exactly its statements, in a three-line and a one-line game, with controls
for the wrong set; `downloads.cjs` presses both buttons on every view of both.

**Landed with:** `annual-statement-template-check` (new, in FAST): every figure
tied to the engine on six games, the Excel file against the template through the
list of deliberate differences (which it prints), the admin "% of Premium" ties,
the Contributions variance's invariants, and the operating ratio by hand on
scenario 1 WC 2027 (94.40%), each with a failing control. Also
VALUE_IDENTITY_v87 unchanged, SOLO_EXPORT_GUARD_v103 (24 Results hashes
unchanged since v94; the 24 statement hashes carry the borders from v96, the
filled blanks from v97, All Years from v98, the two renamed headings from v99,
the seven columns, row changes and variance from v100, the draws on the
program-year blocks from v101, their cap from v102, and the one-line games'
Pool file holding the pool's statement alone from v103, each attributed in
`solo-export-guard.ts`), RENDER_IDENTITY_v100 (exactly the 26 Annual Statement
screens moved at each of v92 to v95, v97, v98 and v100 — the PDF button — and 8 of them at v99 — v96 was development
pricing's, reverted with it — each attributed in
`render-identity-check.ts`; borders move none, since it fingerprints text), and
all 24 session drivers with the admin-token hook. Screenshots are in
`docs/screenshots/annual-statement/`.

---

## 0. Rules for the player-facing documents

- **The welcome memo never mentions funding levels, cushions, confidence
  levels, parameters, market share, membership or other engine detail.** Every
  figure in it is read from the game, never typed (the Pool's name, the policy
  year entered, its lines and last year's closing surplus).
- **How to Play explains what each decision is for, never how the engine
  calculates it** — no percentiles, curves, retentions, layer structures,
  pricing methods, interest rules, parameters or other engine detail.

- **Players are never told about the worlds.** The game runs several worlds and
  shows their average; no player-facing text says so. The Decisions page's
  surplus-range lines ("Ending surplus, year n across 10 worlds: min · median ·
  max" and "The figures shown are the average of the worlds") are gone. The
  range stays in the session's posted results, for the host.
- **Players never see how the engine works — on any page, including that
  results average several worlds.** Pages print plain labels and figures. No
  page explains how a figure is calculated, names an averaging or weighting
  method, or mentions worlds, solved margins or the prior board's funding
  method; a prior board's funding shows as an ordinary CLF figure. The method
  lives in the code, never on the screen. The Rate Indication
  (`src/pages/RateIndicationPage.tsx`) is built to this rule.

The first two rules also stand at the top of each document's source
(`src/data/documents/welcomeMemo.md`, `src/data/documents/howToPlay.md`).

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

### Commit 3a — the new engine, permanent, with no members (landed)

`NEW_LOSS_ENGINE` is **on** and the game's only engine (the flag itself went at
3b); `ROUTINE_LARGE_LOSSES`
stays off. Each line is **one book**: premium = rate x exposure, ordinary
losses are the aggregate cohort, large losses stay individual occurrences and
land on the book (`BOOK_MEMBER_ID`). The book's parameters are on
`docs/PARAMETERS.md` under "New loss engine".

- **`MEMBER_LEVEL` (off)** is the switch the member path sits behind. Off, there
  is no roster selection, per-member premium or loss, experience modifier, risk
  quality, rating group, member satisfaction or departure. ⚠ **Member-level
  play may return**: the code is kept, unwired, and its gates run with the
  switch on inside their own process (`scripts/tools/engine-mode/`).
- **Underwriting is exposure** (`bookUnderwriting.ts`): the renewal cut
  declines its share of the book; the intake position writes a share of the
  book as it stood at the start of the year; a Member Withdrawal removes 25%
  of what is left from the following year; the book is capped at today's full
  market. The new-business penalty is a parameter at zero.
- **Satisfaction is hidden** — Dashboard, Results, the results metrics and the
  exports — and feeds nothing. Nothing a team posts carried it, so hiding it
  is not a contract change.
- **The claims register is saved, not redrawn.** It is the year's large losses,
  a handful a line, and the old generators that redraw a stripped register did
  not draw it; `claimRegeneration` refuses on the new engine.
- **The result shrank**, and `result-size-check` holds it: one year's result
  64 KB, the save at year ten 256 KB stored.

### Between 3a and 3b — two display fixes (landed)

Found while building 3b, and landed on their own so 3b could stay
value-neutral. Neither moves a value.

- **An event that cost money without a claim is named.** The new engine's A
  raises the year's ordinary losses by exact attributed dollars and brings no
  claim, and the Results narrative, its events card and the results sheet's
  "Events This Year" row filtered on claims — so Recession, Legislation,
  Economic Inflation and Social Inflation never appeared there while the audit
  page showed their cost.
- **A regional event's large losses name the region it struck.** The claims
  export took the region from the old catalogue, which fixed one per event
  (Earthquake: Central; Wildfire and Winterstorm: North); the new engine draws
  it per firing. Measured: 215 of 600 regional claims were labelled correctly
  before, 600 of 600 after.

### Commit 3b — one switch, and the old shock placeholders deleted (landed)

Value-neutral: all three baselines are byte-identical to the fix commit
before it (VALUE_IDENTITY v63, SOLO_EXPORT_GUARD v66, RENDER_IDENTITY v43).

- **One switch.** The `NEW_LOSS_ENGINE` flag is gone. `MEMBER_LEVEL` selects
  the engine: **off** (the game as it ships) is the new loss engine with one
  book per line; **on** is the member path. The never-shipped mix of the new
  engine with members, which gave every member its exposure share of the
  line's losses, went with the flag.
- **The member path keeps the per-claim generators.** If members return they
  need their own claims and experience — exposure shares would make every
  member identical — so the WC, GL and Property generators, the per-claim
  register and its redraw, the claim closure and development walk, the roster-
  priced tower and the GL limit per claim are all kept behind `MEMBER_LEVEL`,
  and the gates that test them run with it on (`scripts/tools/engine-mode/
  member-level.ts`). ⚠ **A future member design would likely LAYER member-level
  risk over the new engine rather than reuse these generators — to be decided
  if members return.**
- **The member path has no shocks.** The old shock placeholders are deleted:
  the old catalogue (`shockCatalog.ts`), its resolver and effect vocabulary,
  and every channel that carried them into the generators — WC's injections
  and component multipliers, GL's frequency and severity multipliers and
  injections, Property's forced catastrophes and weather events. `shock-check`
  retired with them. Members get shocks only if they return.
- **Hosts schedule from the twelve.** The setup screen offers every one of the
  R model's twelve events, and Randomise draws them weighted by their catalogue
  probability, without replacement, one per three years as before. The events'
  names and grades on screen are carried over verbatim
  (`SHOCK_EVENT_LABELS`).

### Risk control — pending design

⚠ **Superseded:** risk control is live and charged in the divisor — see "Risk
control in the divisor (save key v40)" at the top. The text below is kept as
the record of the earlier plan.

**Hidden like satisfaction**, behind `RISK_CONTROL` (off): no charge and no
effect until risk control is redesigned **at pool level** — its effect on the
loss engine is being designed separately. Its effects lived in the old
per-claim generators, which the new engine does not run. Each line's slider
stays **visible on the Decisions page, disabled at 0%, labelled "coming
soon"**, so testers know it is part of the game; the old programs are hidden on
the Departments screen. The programs, the spend and their code are kept intact
and unwired for the redesign to reuse.

**When it is switched on, it must be charged as a percentage of the pure
premium**, matching the Decisions slider's label ("5% of Pure Premium" at its
right end). Today `quoteNewRateStack` loads it as a share of the loaded rate, in
the divisor; that changes before the flag comes on. Until then the slider is
disabled at 0% and its gray cost box shows $0 — never a cost the game does not
charge — and it shows the real cost once the flag is on.

### The old engine — frozen on the `legacy-engine` branch

The repository's tag protection refuses a pushed tag, so the old engine is
preserved as a **branch named `legacy-engine`, at b234c36, never committed
to**. To run it: `git checkout legacy-engine && npm ci && npm run gates`, or
`npm run dev` to play it. The `advance-single-player` branch also carries the
full old engine, as its own game.

### Open: the basis of Property's catastrophe capital

Required capital on Property now holds the **probability-weighted mean** retained
cost of one regional catastrophe event after the placed layer. The owner has
asked whether it should reflect the bad case — a severe event's retained cost,
or a 1-in-100 year — instead. Both were measured and reported; **nothing is
changed until that is decided.**

### No individual members

No roster, risk scores, size factors, prospects or experience modifier.
Underwriting moves **exposure**: a share of old business declined, and an
intake setting for new business. The new-business penalty stays as a parameter
at zero, so the mechanism exists before the calibration does. **Done at
commit 3a**, with the member code kept behind `MEMBER_LEVEL`.

### The old member engine — inactive, its gates dormant

**The old member engine is inactive and no longer maintained.** `MEMBER_LEVEL`
stays in the code, off, and everything behind it stays exactly as it is. Later
changes are **not required to keep it working**, so it may need repair before
it is switched on again. A working copy is preserved on the `legacy-engine`
branch and in `advance-single-player`. **Members return in the new engine as
book units**, not through this path.

Every gate that runs only on the member path (each imports
`scripts/tools/engine-mode/member-level.ts`, which turns `MEMBER_LEVEL` on for
its whole process) is moved out of the FAST and SLOW sweeps into **DORMANT** in
`scripts/gates.ts`. No sweep runs DORMANT; `npx tsx scripts/gates.ts --dormant`
runs all of it, and `npx tsx scripts/gates.ts <name>` runs one gate by name.
The eight that were EXPECTED_RED keep their entries, verbatim, in
`DORMANT_KNOWN_RED`. The member path's probes stay in PROBES, which no sweep
runs either. The change is value-neutral: all three baselines are
byte-identical to the previous commit.

Moved from FAST (18): `claims-memo-check`, `claims-system-check`, `claims-workbook-check`, `closure-draw-check`, `gl-cutover-check`, `gl-program-check`, `member-experience-basis-check`, `member-experience-mod-check`, `member-loss-history-check`, `member-premium-check`, `member-value-check`, `pool-aggregation-check`, `property-mitigation-check`, `reinsurance-tower-check`, `renewal-stability-check`, `tower-runtime-check`, `wc-cutover-check`, `wc-program-check`.

Moved from SLOW (9): `clf-label-backtest-check`, `experience-pricing-check`, `ibner-null-check`, `marketplace-generation-check`, `martingale-equivalence-check`, `maturity-anchor-check`, `member-satisfaction-check`, `property-tower-mc`, `wc-program-verify`.

**Three came back, forked onto the new engine.** `pool-aggregation-check`,
`reinsurance-tower-check` and `tower-runtime-check` cover what the new engine
uses — pooled fields and the reinsurance tower — so each was forked to run in
book mode and returned to FAST, with controls, and confirmed red against a real
break in the engine. Their member-path originals stay in DORMANT as
`pool-aggregation-member-check`, `reinsurance-tower-member-check` and
`tower-runtime-member-check`.

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

### Book units

**The market and the book are drawn (book units commit 2); nothing reads them
yet.** Each line's exposure is split across individual units — `BookUnit`,
`src/utils/bookUnits.ts`, never called members and never shown on any screen,
export or host view; every result stays at line level.

- **Market:** 200 units a line from the game seed — size CV 40% (summing
  exactly to the full market), true risk CV 30% (size-weighted mean exactly
  1.0), regions by share, and a noise draw for underwriting's view of risk.
- **Book:** the market in a seeded order until it first reaches 30% of the
  market's exposure — 51-69 units, about 60.5 on average. Across seeds its
  mean risk runs 0.94-1.06. With the planned 2% shared and 10% unit factors on
  ordinary losses, its line-level CV is about 2.47% (it is 2.2% today).
- **Stored once per game** as unit indices on the game's pool state
  (`PoolState.bookUnits`); no world's state or year's record carries it. The
  market is regenerated from the seed.
- The book sums to slightly more than today's opening exposure (WC and GL
  start at 30.1% and 28.8% of the market, Property 29.7%; the book is 30% plus
  the last unit's overshoot). That reaches the game when the engine reads it.

**Ordinary losses come from the units (book units commit 3).** Each unit's
expected ordinary loss is its exposure x its true risk x the line's cost; each
year it is that x a year factor every unit shares (CV 2%) x its own (CV 10%),
and the line's ordinary loss is the sum — replacing one 2.2% draw at the line.
The line's CV is the book's own, about 2.47%. Expected loss carries the book's
size-weighted true risk. A line now opens on its book's exposure — its units'
sizes summed — rather than one figure for all games: over 400 seeds WC opens
0.6% larger on average, GL 5.1% and Property 1.8% (the book is 30% of the
market plus its last unit; GL used to open at 28.8%)
(book-units-ordinary-check).

- **The funding tables do not need re-deriving for this.** Derived on the new
  engine at the old one draw and at the units, the curves agree within their
  confidence bands (funding at expected lands at WC 85.5% -> 85.2%, GL 63.4%
  -> 63.4%, Property 80.6% -> 80.9%). But the shipped tables were never calibrated on the new
  engine: WC's and GL's are supplied and Property's was derived on the member
  engine, and on the new engine they sit well above the measured curve (at the
  70% stop WC 1.140 shipped against 0.896 measured, GL 1.135 against 0.905,
  Property 1.147 against 0.899).
  That gap predates book units and is left for its own decision.


**Underwriting moves units (book units commit 4).** Each unit's observed risk
is its true risk x a noise drawn once from the seed; `UNIT_UW_VISIBILITY` (0.5)
is the share of the observed log-risk's variance that is true risk — 0 selects
at random, 1 perfectly.

- **Renewal** declines the units that look riskiest, as close as whole units
  come to the renewal cut's share of the book.
- **Intake** takes the prospects (market units the book does not hold) that
  look best, as close as whole units come to the intake position's share.
- **Member Withdrawal** removes 25% of what is left, in a seeded order blind
  to risk.
- **One book in every world:** all of it reads the game's seed and the team's
  one decision, so every world moves the same book; only loss draws differ.
- At visibility 0.5, a 5% renewal cut declines units about 48% riskier than
  the book, and 8% intake writes units about 37% safer than the prospects
  (book-units-underwriting-check, 300 seeds).

**Large losses land on units (book units commit 5).** Routine large claims
and shock T losses land on the book's units, each unit weighted by its size x
true risk; a regional T lands only on units in the struck region.

- The routine claim count is λ x exposure x the book's size-weighted risk, and
  the expected loss and the tower's layer prices carry the same factor, so a
  riskier book sees more large claims and is priced for them; underwriting
  moves both.
- A claim carries its unit's index inside the engine only. The claims workbook
  drops the Member ID, Member Name and Member Type columns on the new engine,
  so no unit reaches a sheet.

**The new-business penalty (book units commit 6).** `NEW_BUSINESS_PENALTY`
is the R model's 20%: book units written this year cost 20% more on their
actual ordinary losses, in their first year only; a unit renewed the next year
carries none.

- It is NOT in expected loss. Expected loss is the book's own exposure x risk
  x cost; the rate learns the penalty only through the history, as new
  business's losses reach the ledger. (It was 0, and it was in expected loss.)
- At default decisions no unit is written, so it changes nothing there; it
  bites when a team takes on intake.

### Regions

**Four since book units** — North 25%, South 30%, Central 25%, East 20% of every
line's exposure (`REGION_EXPOSURE_SHARE`, the R model's own; the three read from
today's roster are retired). A regional event strikes one region, **drawn by
exposure share**, and its A reaches that region's share of ordinary losses; its
T lands whole in the struck region. Drawn by share, the expected share an event
reaches is 0.255 (it was 0.334 over three near-equal regions drawn uniformly),
so a regional event's expected A falls about 23.5%; nothing else was
re-calibrated. The dormant member engine keeps its own three (`CAT_REGIONS`). **R shocks stay pool-wide**, because the
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

### Pre-game funding — the prior board's margin, solved per scenario

**Landed (stable-scenarios commit 9), replacing the 14% cushion.** Each line
starts the pre-game with `STARTING_CAPITAL` ($5M) paid in, and the prior
board funds all five pre-game years at ONE margin over expected, solved per
scenario and line so that surplus ends exactly at the scenario's opening
(year-1 premium at Expected / its premium-to-surplus ratio). It may solve
below expected: on WC it did in 15 of the 20 scenarios with profit and
contingency at 5%, and does in 2 of 20 with it at 0. Players still default
to expected.

**The year-1 rate step.** A team that locks year 1 untouched funds at
Expected, so year 1's rate on WC and GL may step UP or DOWN from the declared
year before it, by whether the scenario's solved margin sat below or above
expected. That step is real, not a modelling artefact, and it is the first
thing the Decisions panel's change column reports. No player-facing text names
the margin.

(Before: CLF 1.14, a 14% cushion over expected — the 70% stop on each line's
old table, WC 1.1400, GL 1.1350, Property 1.1471 — so year 1 always stepped
down.)

### Funding tables on the new engine (funding tables commit)

**Landed.** The WC, GL and Property funding (CLF) tables are re-derived on the
new engine, so the slider's levels are true. They are percentiles of a
VOLATILITY-ONLY ratio, (net incurred loss + LAE) / (the engine's expected
retained loss + LAE), and carry none of the experience pure premium's
shortfall. See the head of `src/data/clfTables.ts` and
`scripts/diagnostics/clf-newengine-derive.ts`; gated by `funding-table-check`.

| | at expected covers | 70% stop | 90% stop (required capital) |
|---|---|---|---|
| WC | 78.2% | 0.9638 | 1.3275 (was 1.473) |
| GL | 63.5% | 1.1678 | 1.7910 (was 1.502) |
| Property | 84.0% | 0.7675 | 1.5247 (was 1.4414) |

- **The reinsurance load is separate:** `REINSURANCE_LOAD`, 14% on every
  layer's expected loss, every line. It was each line's table read at 70%.
- **Required capital follows the new table** (unpaid reserve x (CLF90 - 1)), so
  the opening surplus — a multiple of it — moves: WC -31%, GL +58%, Property
  +2% (its requirement is mostly retained catastrophe).
- **Pending, for pricing: the experience pure premium's shortfall**, measured
  by the derivation and not fixed here. Property's five-year window misses
  catastrophes in most years; GL's pricing does not anticipate prior-year
  development, the host's 10% adverse among it; see the commit for figures.

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

**RULE — players see each option's price, never its expected recovery or how
it was priced** (UI tidy). Each package on the Decisions page shows its name
and price only: no expected recovery, load, rate on line or pricing note, and
no block restating the package, its cost or what is retained above it.

**Wired in loss engine commit 4a**, as `REINSURANCE_OPTIONS` and
`REINSURANCE_DEFAULT_OPTION` (see [docs/PARAMETERS.md](PARAMETERS.md)). A team
makes ONE choice per line from a fixed set of packages, replacing
place-or-decline on each band:

| Line | Options |
|---|---|
| GL | none · **$9M xs $1M** · $5M xs $5M · $14M xs $1M · $10M xs $5M |
| WC | the same as GL |
| Property | none · **$20M xs $5M** · $45M xs $5M · $25M xs $25M |

**Bold is the default** — the middle option, a parameter marked chosen — for
players and for the pre-game's prior board.

- **A package is a set of whole tower layers.** The tower is re-cut at every
  package's edges — WC and GL $4M xs $1M, $5M xs $5M, $5M xs $10M (top
  $15M); Property retention to $25M, then $25M xs $25M (top $50M) — so each
  package is a preset placement, and `reinsuranceOptions.ts` checks at load
  that every package tiles whole layers. Cession and price are therefore
  computed exactly as before: each placed layer's expected recovery on the
  new engine's large losses, at the line's CLF at 70%. GL's $25M pool limit
  still applies, so GL retains $15M-$25M on any package.
- **Property's earthquake keeps its own $10M retention per occurrence**
  (`PROPERTY_PERIL_DEDUCTIBLE`, unchanged), so a package attaching below it
  answers an earthquake from $10M up: $20M xs $5M gives $15M of cover against
  one. The Decisions page says so beside the packages.
- **What a team posts changes:** `reinsuranceOption` (the package id, or
  `none`) replaces `layersPlaced` and `aggregateStopLevel` on the wire, and the
  host Decisions tab shows each line's package. The handler deploys first —
  see docs/handoff/AWS_HANDLER_HANDOFF.md.
- **Saves:** the save key moved to v11; a v10 save is cleared, not migrated.

**The aggregate cover is not offered.** Its code is kept unwired — the level is
always `AGGREGATE_NOT_OFFERED` — and **it may return**: aggregate cover is what
protects against a broad surge of small losses, such as the winterstorm's,
which no per-occurrence package touches.

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

**Wired in loss engine commit 4b** (`src/utils/worlds.ts`, `WORLD_COUNT` = 10,
a parameter). Each team's year runs in ten worlds, all teams sharing the same
worlds' draws: a world is the game's instance with its own seed (world 1 keeps
the game's own), so each carries its own reserve ledger, cohorts and surplus,
with its own ordinary year factor, shock severities, routine large losses when
that switch is on, and investment returns. **The pre-game runs once and the
opening is shared.** The member path runs one world.

- **Shared:** the team's decisions; one rate (below); host-scheduled shocks,
  which fire in every world with severity — and region — drawn per world. In
  singleplayer the catalogue fires per world by probability. Dividends and
  assessments are each world's own share of its own surplus.
- **Display:** dollars are the average across worlds; **every ratio is
  recomputed from averaged numerators and denominators, never averaged.** The
  game's pool state and results ARE the average; each world's are kept
  (`GameState.worlds`). The Results and Decisions pages show the minimum,
  median and maximum ending surplus beside the average; the year's events say
  how many worlds each fired in.
- **Claim-level detail is per world.** An averaged year has no claims of its
  own; the claims workbook exports world 1's and says so.
- **Loans:** an offer is made when a line is short in any world, showing the
  mean deficit and how many worlds need it; the team's one choice applies in
  each of them. Sessions decline, as before.
- **Size and time:** one averaged year is 59 KB; the save at year ten is
  1,066 KB stored (the 3a budget of 256 KB is restated to 1,280 KB — see
  result-size-check — after dropping each world row's per-accident-year reserve
  split from the save, which nothing reads). A year takes about 65 ms for all
  ten worlds and three lines.
- **The gate is worlds-check**, with a failing control for each check.

### One rate

**Wired in loss engine commit 4b.** Struck **once per team-year, from the
averaged history** — the worlds' ledgers averaged accident year by accident
year and their books averaged — by `strikeBookRate`, the engine's own pre-movement
quote as a function, and charged in every world per $100 of that world's own
exposure. worlds-check asserts every rate field is bit-identical across worlds,
equals a rate struck on a ledger the gate averages itself, and that the
striking function reproduces the engine's own charge on one world.

### Session layer

**Wired in loss engine commit 4b.** Teams post the average in today's record
shape, plus `surplusRange` — the **minimum, median and maximum ending surplus**
across the worlds, pool scope — on every played year. The host's Teams table
shows the minimum beside the average. A contract change: the handler deploys
first (docs/handoff/AWS_HANDLER_HANDOFF.md).

**What a hosted session shows (the display commit).** Players and viewers do
not see the Results, Financial Statements or Calculation Audit tabs;
single-player keeps them, and the Result Spreadsheet stays in both, for
testing. One switch: `MULTIPLAYER_HIDDEN_TABS` in `src/game/GameShell.tsx` —
set it to `[]` to restore all three. The Annual Statement carries a year
selector and a year-label row, shows blank where a figure has no source, and
no longer prints its explanatory notes (kept in the source, hidden from
players). Decision History adds, by line, the renewal share declined, the
intake position's share of exposure and risk control.

### Performance

Measured at commit 4b, three-line games at default decisions:

| | before (plan) | one world, 3a | ten worlds, 4b |
| --- | --- | --- | --- |
| a year, every world | about 300 ms (estimated) | about 8 ms | about 65 ms |
| one year's result | 962 KB | 52 KB | 59 KB (averaged) |
| save at five years, stored | 8.1 MB raw | — | 621 KB |
| save at ten years, stored | — | 175 KB | 1,066 KB |

The per-claim and per-member detail went at 3a, which is what made ten worlds
affordable. The save budget is restated for ten worlds in result-size-check.

### Satisfaction

Becomes **one pool-level index per line**. Designed separately — not part of
this plan. **Hidden since commit 3a**, and feeding nothing, until then.

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
   gates that test them. **Brought forward as commit 3.** 3a landed: the new
   engine on and permanent, one book per line, members behind `MEMBER_LEVEL`
   (off), risk control and satisfaction hidden. 3b landed: one switch
   (`MEMBER_LEVEL`), the old shock placeholders deleted, the member path kept
   on the per-claim generators with no shocks — value-neutral.
6. Pool-level satisfaction.

**Each lands green before the next.**
