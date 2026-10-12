# State — `feature/uw-decisions`

**Read this instead of reconstructing branch state from conversation.** Convention:
`STATE_<final branch segment>.md`, one per branch, at the repo root. This file describes **this branch
only**. `STATE_member-satisfaction.md` came in with the base and describes that branch, not this one.

**Cut from:** `feature/risk-control` at `b0fd991` (2026-10-09). Pushed bare before anything landed on it.

---

## What this branch is for

Measurements, and probably a redesign, of **both underwriting controls**: New Business Appetite (who
gets in) and Renewal Underwriting (who stays). It exists so `feature/risk-control` stays deployable while
that work is in flight.

The first question it carries is whether New Business Appetite should select on **risk quality**
(a bar on what kind of applicant) instead of on the applicant's own loss run, and underneath that,
whether any underwriting setting can give growth a cost. As of the cut, growth costs nothing, so the
default appetite beats every stricter one.

## How it moves to `feature/risk-control`: by cherry-pick, not by merge

**Each commit below moves on its own, by cherry-pick.** Three merges in this project auto-merged
cleanly and were wrong, so nothing here is merged wholesale. Each commit holds one change and nothing
else, so that the pick onto `feature/risk-control` can be reviewed against this statement of what it is
for.

(The original note said "merge back early and often". The early part still stands, since the property
branch diverged for three weeks and its merge took four hours. The mechanism is now cherry-pick.)

## Not this branch's to touch

`aws`, `feature/fast-development`, `feature/low-rates`, `demo-2026-09`, `demo-multiplayer-2026-09`,
`demo-video`, `demo-video-2`. `feature/risk-control` receives these commits only by a reviewed
cherry-pick; nothing on this branch writes to it directly.

## Remote

`origin` must read `Public-Risk-Innovation-Solutions-Mgmt/Ripple` for **both** fetch and push. It has
repeatedly reverted to `JanderAct/insurance-game-testingv2`. That URL redirects, so a fetch through it
succeeds and looks correct. Check `git remote -v` before any git operation.

---

## What has landed, in order, and why that order

| # | Commit | What it is | Needs |
|---|---|---|---|
| 1 | `61a36cf` | Property's own market target, 0.60, derived from its catastrophe load | — |
| 2 | `aa19853` | `retainedCoverMargin` in `quoteLineRates`, the fourth term the realised charge has | — |
| 3 | `400a815` | The book-mix normaliser out of the draw (`BOOK_MIX_NORMALISER.inDraw = false`) | — |
| 4 | `124f439` | Adverse selection on who applies (`APPLICANT_ADVERSE_SELECTION = 0.35`) | 3, for it to matter |
| 5 | `772c4b7` | The renewal slider: non-renew the worst X% on the multi-year loss ratio | — |
| 6 | `778326d` | The intake slider: a noisy inspection of risk quality (`INSPECTION_SIGMA = 2`) | 4 and 5 in the tree |
| 5b | `12c5340` — narrow the renewal slider to 0-5% in 1% steps | `RENEWAL_CUT_STEPS` 0 / 1 / 2 / 3 / 4 / 5% | **5 — always with it, never without** |
| 6b | `fd3fe07` — intake as one four-position slider, a bar and a cap per position | No New Business / Strict / Moderate / Low; Low's cap is `MAX_NEW_MEMBER_SHARE` | **6 — always with it, never without** |
| 7 | `4965bce` — bill the tower on the book it covers: joiners in, leavers out | Re-quotes the tower, cession credit and aggregate on the post-movement book | — (a fix; stands alone) |
| 8 | `66f1b12` — steepen how risk quality drives losses, re-centred | WC 2x freq + sev; GL 3.5x freq, 1x sev; Property 1x | after 6b (baseline renames) |

**5 and 5b are one change in two commits.** `772c4b7` was pushed with the range 0 / 2.5 / 5 / 7.5 / 10%.
It was narrowed afterwards, in its own commit, rather than rewriting pushed history. **Picking `772c4b7`
alone ships the old range.** Pick 5b in the same review as 5, every time. On this branch 5b comes after
6 and renames the render baseline v21 → v22, and v21 is 6's file. So the clean order is 5, 6, 5b, with
the render baseline recaptured on the target as usual. If 6 is not being picked, pick 5 and 5b together
and recapture.

**6 and 6b are one change in two commits.** `778326d` was pushed with seven bar-only levels under one
10% guard. Applicants are about 7-8 per line a year, so the guard capped every loose level at the same
count, and most of the slider changed nothing. 6b replaced the levels with four positions, each a bar
and a cap, and it rewrites the memo's "Who wants in" sentence. **Picking `778326d` alone ships the
slider that does nothing across most of its range.** Pick 6b in the same review as 6, every time. 6b
renames the render baseline v22 → v23, and v22 is 5b's file, so the clean order is **5, 6, 5b, 6b**.

**7 is a fix and stands alone.** The tower used to be billed on the book from before movement, so
joiners were covered all year and priced for none of it, while leavers and renewal declines were priced
and not covered. It touches no baseline file and changes nothing at defaults. It edits `simulationEngine.ts`,
`linePricing.ts` and `market-conditions-check.ts`, and depends on no other commit here, so it should pick at any point. That has not been
tried on the target, so check the pick applies cleanly there. Pick it **before** anything that measures intake or renewal on top of the tower (the
exposure-rated tower, an experience factor), since it raises members' rate at every open intake
position (0.5-0.8% at Strict, 1.0-1.6% at Low). The defect undercharged members, not the pool. Surplus moves by under $0.4M,
because the triangle funds the pool on a net rate and the cession credit cancels inside the
gross-up.

**8 steepens risk quality so a member's loss ratio persists.** Split-half reliability goes from 0.07 / 0.03
to 0.28 on both WC and GL, and the 5% renewal cut now cleans the book (cost −21% on both lines) instead of
removing unlucky members. GL steepens frequency only, because a steeper GL severity tilt broke the real
pool's 2.29 settled-claim anchor (`terminal-severity-check`). Each line is re-centred on the fixed
marketplace's mean, so an average member stays average and the RQ-5 rate card (the pure premium) does not
move. It renames all three baselines: value v51 → v52 and solo export v53 → v54 (both 3's files), render
v23 → v24 (6b's file). So pick it **after 6b**, and recapture on the target. It also raises
`member-experience-mod-check` to 24 games; that gate's runtime goes from 31s to about 2 minutes.

**1 and 2 are fixes.** Satisfaction misjudged Property's price against the market, and the quote missed
a term, so a pool that declined its tower read a phantom rate cut. Neither changes a default game.

**3 is what makes 4 to 6 mean anything.** With the normaliser in the draw, a book's composition never
reaches its losses: a better intake, a stricter renewal and a worse applicant pool all cost exactly the
same. 3 is safe on its own. It was measured before it was built: no spiral, saves load, and pricing
follows a few years late through the triangle.

**4 is what makes screening worth doing.** Without it, applicants have the book's own average quality
and an inspection has little to find. The direction is sourced; the size is a judgement, recorded at
the constant.

**5 and 6 are the two controls the design ruling asked for.** At zero on both, the book's membership
does not change by choice. 6 reads `applicantWeight` / `applicantInclusion` (from 4) and restates
`member-experience-mod-check` section 8 on the renewal cut (from 5), so it must be picked after both.

## What each pick must show on the target

- **The baselines are versioned by rename** (`RENDER_IDENTITY_v17` → `v24`, `VALUE_IDENTITY_v52`,
  `SOLO_EXPORT_GUARD_v54`). If the target's baseline versions differ, the rename will conflict.
  Recapture on the target and attribute every moved row again, rather than carrying the file across.
- **1:** `market-conditions-check` green. Property's cushion is about −5% at Expected and crosses zero
  inside the slider. `member-satisfaction-check` carries Property [5, 10] as an accepted breach (see its
  `ACCEPTED_BREACH` note). Values identical; render: 6 Property satisfaction screens at y2.
- **2:** values and render identical at defaults; `panel-engine-parity-check` green, now with an eighth
  component.
- **3:** every value moves (losses, reserves, premium, surplus); membership does not. Render: 268 of 298;
  the 30 that do not move are the Departments documents. Control: `inDraw: true` reproduces the previous
  baseline. `marketplace-generation-check` (trap 1 inverted), `member-loss-history-check` (section 3 plays
  an ablation arm) and `market-conditions-check` (section 5 at 48 games) were changed with it.
- **4:** values identical (nobody joins at defaults). Render: the WC/GL Decisions tiles only. Control:
  skew 0 reproduces the previous baseline.
- **5:** values identical (the cut defaults to 0). Render: Decisions plus the underwriting memo.
  `renewal-stability-check` is restated for a share.
- **5b:** values identical (the cut still defaults to 0). Render: 12 rows, the WC and GL Decisions pages
  at y0 and y2, where the slider's range and right label changed. Control: the same tree with the old
  steps reproduces the previous baseline. `renewal-stability-check` reads its strongest step from the
  constant; only its comment about the 30% control's multiple changed.
- **6:** values identical (intake defaults to 0). Render: Decisions plus the underwriting memo.
  `newBusinessAppetite.ts` is deleted, and `surface-privacy-check` watches `renewalUnderwriting.ts` in its
  place.
- **6b:** values identical (intake still defaults to No New Business). Render: 24 rows, the 16 Decisions
  pages (every line, y0 and y2) and the 8 underwriting memos. Control: the same tree at 5b reproduces the
  previous baseline. Measured joins per line-year at the four positions: 0 / ~1.2 / ~2.8 / ~4.3.
- **7:** values, solo exports and render all identical (nobody joins or leaves at defaults).
  `market-conditions-check` carries GL and Property as ACCEPTED_BREACH in section 5, inverted: the fix
  took the joiner-count jitter out of an intake-open pool's rate (GL 3.25% -> 2.45%, Property
  3.05% -> 1.92%, under a ~2.9% benchmark). Revisit when satisfaction drives departures.
- **8:** every value downstream of WC and GL losses moves; Property's never does. Value: 15,705 values across
  81 fields. Solo export: 18 of 24, all six Property-solo identical. Render: 232 of 298, every screen of every
  configuration holding WC or GL, except the Investment and Risk Control documents. Control: the parent
  reproduces the previous render baseline. The opening roster differs in about half the games on WC and GL,
  because the pre-game's opening band accepts a different attempt (mean 6.2 → 7.7). Check the marketplace's
  average cost against the RQ-5 card: WC 1.036483 and GL 1.029397, unchanged. Control:
  the parent built separately reproduces the same 298. Check on the target with intake open: pool
  premium unchanged to float noise, reinsurance cost up by roughly the joiners' share.

## Deliberately NOT on this branch

- **Members leaving** (retention reading the satisfaction stock, its sensitivity, voluntary departures
  on). That belongs on its own branch. It was never committed here.
- **The experience-rated reinsurance tower.** It is measured and it works, but the tower's design note
  says composition is "never pricing", and that needs a ruling, not a commit that slips past it. Until
  it lands, opening the intake beats closing it on surplus and on rate. A bigger book earns the tower's
  size discount, and the tower ignores what is in the book.

## Open for a ruling

- `market-conditions-check`'s GL and Property accepted breaches (commit 7). They are RULED: accepted,
  not open. Listed here because the gate records a concern for later. Once satisfaction drives
  departures, members judging the pool against a market louder than its rate would carry swings the
  player cannot control. The likely remedy is comparing against a smoothed market.

- `member-satisfaction-check`'s Property [5, 10] accepted breach (commit 1). Property's defaults drift
  is a transient to the anchor's happy offset, which its wrong market target used to hide. It is
  accepted by name and inverted. A ruling could instead re-centre the opening disposition.
- The shipped CLF tables were derived on the retired appetite tiers. The derivation scripts now play
  the intake levels as analogues; re-deriving the tables on them is its own commit.

