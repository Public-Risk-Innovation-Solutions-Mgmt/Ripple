# State — `advance-single-player`

**Read this instead of reconstructing branch state from conversation.** Convention:
`STATE_<final branch segment>.md`, one per branch, at the repo root. This file describes **this branch
only**. `STATE_member-satisfaction.md` and `STATE_uw-decisions.md` came in with the base and describe those
branches, not this one.

**Renamed from `feature/risk-control` at `b458e04`** (2026-10-13), "Merge aws into feature/risk-control:
the Lambda session handler". The old name no longer exists on the remote. **Never push to
`feature/risk-control`.**

**Repository:** `Public-Risk-Innovation-Solutions-Mgmt/Ripple`, the only repository for this project. If
`git remote -v` reads `JanderAct/insurance-game-testingv2` on fetch or push, set both to Ripple before
anything else — the old URL redirects, so a fetch through it succeeds and looks right. Containers have
reverted it again and again; check it before every git operation, not once.

---

## What this branch is for

**The full engine, for a more complete single-player game.** Development has moved to the `multiplayer`
branch, which is building a simpler game to play sooner. This branch keeps everything the full engine has
and is **to be resumed after multiplayer is built**. Until then it receives no work. The list below is what
is waiting, recorded here so it lives in the repo and not in a chat.

⚠ **ABOUT THE FIGURES BELOW.** Where a figure is marked *(handed over)* it came with the hand-off that
created this file and was not re-measured when it was written. Where it is marked *(measured on …)* it was
measured in a scratch copy on the named branch. Re-measure any of them before relying on it — the engine
will have moved.

## Where it stands at the rename

Verified against the repo at `b458e04`:

- The claims system acts below **fixed thresholds** — WC $2M, GL $2M, Property $5M — read from no tower
  (`f780e06`). While WC and GL retain $1M, claims between $1M and $2M leak their saving to the reinsurer
  (8.93% of the saving across a three-line pool, $0.40M a year); the leak closes on any package that
  retains $2M. Recorded at the constant.
- **Required capital sees retained catastrophe, and every line opens at 2.28× it** (`b35dbe2`); members
  open where they settle (`7a529b3`).
- **`RISK_LOAD_LAMBDA` is 0** (`2e38ecd`): every layer is priced at 1× its expected cession.
- Property mitigation (`ee953aa`) and the investment-return cut (`b9d797e`) are in, as is
  `feature/uw-decisions` (`60975ba`) and the AWS Lambda session handler.
- Voluntary departures are **off** (`VOLUNTARY_DEPARTURES_ENABLED = false`).
- `feature/fast-development`'s `92888d3` is **not** in this branch yet.

---

## Waiting work, in rough priority

### 1. The converging climb — first, and the rest depend on it

`feature/fast-development` holds commit `92888d3` (value-neutral groundwork) and the **seven-commit plan**
in its `STATE_fast-development.md`. Merge it in, then build the climb (that plan's commit 2). It fixes
three things that are one cause:

- **The size distortion.** Development is size-blind and the first estimate is not, so small claims
  over-develop and large ones under-develop. Booked ÷ drawn at termination on WC runs 115% for claims under
  $100k and 63% above $10M (GL 153% down to 64%) *(measured on `feature/fast-development`)*.
- **The half-paid mega-claim.** Tower recovery on WC claims over $5M is 66% of what their drawn values would
  cede; the converging climb in scratch brings it to 97% *(measured on `feature/fast-development`)*. On
  `feature/low-rates` a $15.5M WC claim booked at $4.6M even with no cover.
- **Reinsurance recovery.** Layers are priced on drawn severity but recover on booked occurrences, so at
  zero load WC pays about $44.6M for cover and recovers about $6.3M *(handed over; the horizon is not
  recorded)*.

**Zero load and the climb are both needed; neither alone makes declining reinsurance lose.** Zero load
removes the free margin a declined pool keeps. Without the climb the cover still recovers only a fraction of
what it is priced for, so declining still looks better than it should.

The plan's later commits — the per-claim drift and open-share re-solve, WC ×2 compression, time-scaling the
revision law and the booking bias, then the downstream re-solve and recapture — follow in that file's order.
That file cut from `b0fd991` and held commits 2–7 until this branch's changes landed; they have, so expect to
**merge rather than cherry-pick**, and to recapture the baselines at each value-moving commit.

### 1a. Development drifts too far up — beside the climb, and part of the same decision

Claims book below their true cost and then drift up at **one rate per line, whatever their size**. For most
claims that overshoots: small claims end at about 115% of drawn on WC, 153% on GL, and 128–136% on Property.
Because claims always book low and climb, **prior years almost always develop adversely**, where a real pool
sees favourable years too. Property climbs about 26% from first booking, though most of its claims close
within two years.

Large claims go the other way: WC's largest end at about 63% of drawn. **Lowering the drift uniformly would
leave them further under-reserved**, so the fix cannot be a single dial turned down.

Two ways to address it, to be **considered together when the climb is built**:

- **The converging climb**, so each claim heads to its own drawn value (item 1).
- **Booking closer to true cost from the start**, so less drift is needed.

For contrast, the `multiplayer` branch uses simple prior development factors — WC 3% adverse, GL 10%
adverse, Property 2% favourable — much gentler than this. *(handed over; not checked against that branch)*

### 2. Reinsurance load

`RISK_LOAD_LAMBDA` is 0. **After the climb**, check whether cover is too cheap: at zero load more cover
should always be better, so if every placement beats declining, add load back. How much, and on which
layers, is the question the climb has to answer first.

### 3. Reinsurance packages

Measured on `feature/low-rates`, not built. Build **after the climb makes cover worth buying.** The
harness lived in a scratch copy and was not committed; these findings exist nowhere else in the repo.
Measured on the pre-capital engine at a 5.3% return and the old opening — the ordering should hold,
absolute levels will not.

- **WC packages**, written retention × limit: none, 1x9, 2x8, 2x18, 1x39 (top $40M, down from $50M).
- **GL packages**, proposed with their own tops: none, 1x9, 2x8, 2x23, 1x24. The highest stops at today's
  $25M tower, short of the Adverse Jury Verdict's $25–60M: reaching $60M cost about $8.5M a year more at
  full-market scale, for an event in 1.9% of years, and asserts a market for capacity the tower's own note
  says is hard to find.
- **Drop the WC aggregate stop.** At its cheapest attachment it costs $5.2–5.7M a year, pays in 2.8% of
  years (3.9% on 2x8) and recovers 1–2% of its price. Higher retentions do not revive it.
- **"Full" for the flat charge** should be the top package priced as one contract. A package priced as one
  contract is 3–10% below the sum of today's layers, and up to 12% on small pools.
- **At the old 0.60 load, packages did not fix declining**; each step down in cover won (WC 2x8 captured
  49% of the none-versus-top gap). Re-measure at zero load once the climb is in.
- **A WC mega-claim could not be lost by buying cheap** (the $10M top never bound in ten years); GL's
  verdict and Dangerous Condition could (worst surplus gap −$10M on a $10M-top package against −$2.7M on
  the $25M top). That is the booking problem in item 1.
- **Property**: packages make sense on limit and retention, not one number — a catastrophe exceeds $250M in
  31% of cases and $500M in 3.2%; priced against the $995M xs $5M layer, a $100M top costs 65%, $250M 86%,
  $500M 99%; a $10M retention 84%, $25M 67%, $50M 55%.

### 4. Re-derive the CLF tables

Once the engine settles. At the 90% stop they read high: WC about 2.0%, GL about 4.8%, Property about 8.8%
*(handed over)*. The climb changes what the tables measure, so do this after items 1 and 2.

### 5. Opening strength

Pools open at about 2.28× required capital and nothing goes negative within five years *(handed over)*.
Revisit the level after the climb.

### 6. The dial split

Five risk control sliders. Not started. (`riskControlCategories.ts` lists the five programme categories.)

### 7. Average risk quality is intentional in single-player

It is shown to players deliberately (`averageRiskQuality`, `src/utils/resultMetrics.ts`). **It is already
intentional:** `scripts/diagnostics/surface-privacy-check.ts` allows the pool average on purpose, on the
reasoning that a pool average is a pool statistic, while refusing `member.riskQuality`. No change to the
check is needed. **The remaining step is a note at the metric saying so.**

### 8. Members leaving

Satisfaction driving retention, its sensitivity, and switching voluntary departures on
(`VOLUNTARY_DEPARTURES_ENABLED`, currently false). `STATE_uw-decisions.md` records that this "belongs on its
own branch" and "was never committed".

### 9. Single-large-claim shock events feel flat

The mega-claim events (#15, #21, #26) barely register: on `feature/low-rates` a $15.5M WC claim cost
surplus −$1.0M in its year on full cover and −$0.3M by year ten. Consider several claims per event,
full-cost booking, and a lasting consequence. Item 1 is part of the cause.

### 10. Exposure-rated and experience-rated reinsurance

Both measured, neither built. `STATE_uw-decisions.md` records the experience-rated tower: it works, but the
tower's design note says composition is "never pricing", which needs a ruling before a commit.

---

## From multiplayer, worth bringing back

**A section to be added to as multiplayer is built.** One bullet each: what it is, and where it lives on
`multiplayer` once known. Listed as handed over; not yet checked against that branch.

- The twelve-event shock catalog.
- Stored starting seeds.
- The host screen tidy-up.
- The `data-shock-id` attributes on the shock list.

---

## When resuming

1. `git remote -v` on fetch and push, set both to Ripple if either reads the old URL, then fetch.
2. Read this file, then `STATE_fast-development.md` on `feature/fast-development`.
3. Merge `feature/fast-development` in (item 1) before anything that moves values.
4. A value-moving commit moves both value baselines: capture once and attribute every moved row. Run the
   render baseline with its control, the full FAST sweep with nothing else running, and the manifest check
   with its exit code read directly.
