// ============================================================================
// RENDER IDENTITY — THE THIRD BASELINE, AND IT IS A BASELINE RATHER THAN A TEST.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   npx tsx scripts/tools/render-identity-check.ts            # compare
//   npx tsx scripts/tools/render-identity-check.ts --write    # re-capture
//
// IT NEEDS A BUILT APP AND A SERVER, which is why there is no npm script: a
// bare `npm run render` that assumed a server would fail confusingly for anyone
// who had not started one. RENDER_URL points it elsewhere (default :4173) and
// RENDER_BASELINE points the comparison file elsewhere — together those are what
// let one commit be measured against another in a worktree, which is how the
// defect reproduction below was done.
//
// VALUE_IDENTITY answers "did any computed value move?" and SOLO_EXPORT_GUARD
// answers "did the export's shape move?". Neither can answer "did the SCREEN
// move?", because neither renders one. 27 of this repo's 86 src files — every
// page, every component, App.tsx — are reachable from no gate at all, and every
// display defect found in them this month was found by a person looking at a
// browser. This file is the instrument that looks.
//
// ⚠ IT IS NOT THE "SOLO ORACLE". That instrument is cited by name in five commit
// messages on claude/bold-bardeen-38lhp5 and exists in NO branch and NO commit of
// this repository — searched by content across all 25 remote branches and across
// the whole history for added-or-deleted files. It was run ad hoc, out of tree,
// and vanished with the sitting that produced it. This is a new instrument built
// to fill the same gap, and it deliberately differs in one way that matters: THE
// OLD ONE PLAYED WC-ONLY. Every Membership defect found this month lived in a
// configuration it never played — GL-only and Property-only opened with an empty
// roster, WC+GL opened showing 65 of 112 members — so its 46/46 proved
// CONFINEMENT and not correctness. This one plays five configurations.
//
// ============================================================================
// ⚠ THE RECAPTURE RULE IS THE OTHER TWO BASELINES', VERBATIM. A MOVED
// FINGERPRINT IS A CHANGE TO INVESTIGATE, NOT A REASON TO RE-BASELINE.
//
// `--write` exists because legitimate display changes happen, exactly as they do
// for the other two. It is not the response to a red run. The response to a red
// run is to open the named screen and find out why it moved — the key is
// Config|Tab|LineView|Year precisely so the diff tells you which screen to open.
// Re-capture only once you can say what moved and why, and say it in the commit.
// A baseline re-captured to make a run green measures nothing afterwards.
// ============================================================================
//
// WHAT A FINGERPRINT IS. Key Config|Tab|LineView|Year; value a SHA-256 of the
// page's normalised visible text. Normalisation collapses whitespace so a reflow
// is not a diff while a number is — see NORMALISE below for everything that had
// to be neutralised and why.
//
// TWO YEAR-POINTS: `y0` before any year is locked, and `y2` after two processed
// years. y0 is not decoration — two of this month's three Membership defects
// lived ONLY there, because the page falls back to `initialMembers` until a
// result exists and that fallback was reading WC unconditionally.
//
// WHY scripts/tools/ AND NOT scripts/diagnostics/: everything in diagnostics is
// under gates.ts's manifest check, which fails on a file it does not know by
// name. This is a harness, not a gate — it needs a browser and a built app.
//
// ============================================================================
// ⚠ IT REPRODUCES ALL THREE MEMBERSHIP DEFECTS, AND ONE OF THE THREE IS THE
// REASON TO TRUST IT. Measured by building each commit in a worktree, serving
// it, and comparing with RENDER_BASELINE:
//
//   DEFECT 1, the year-0 roster (76473f1^ -> 76473f1): 4 of 232 moved, and they
//   are EXACTLY GL|y0, PR|y0, WC+GL|y0 and WC+GL+PR|y0 on Membership. Exactly
//   the four configurations that commit names as broken, at exactly the
//   year-point that was wrong, with WC-ONLY UNCHANGED — which is the negative
//   that commit also asserts. Nothing at y2 moved, which is right: the fallback
//   only renders before a year is locked. This is the one that says the
//   instrument measures what it claims to.
//
//   DEFECT 2, the line view and the WC-hardcoded columns (76473f1 -> e7a3db6):
//   a KEY-SET change on all five configurations — Membership|- disappears and
//   Membership|Pool plus one key per active line appear — because the tab gained
//   the Pool/per-line bar.
//
//   DEFECT 3, roster and tiles following the view (e7a3db6 -> 741c240): 20 of
//   248 moved, every one on Membership, on the per-line views at both
//   year-points.
//
// ⚠ AND THE THREE CANNOT BE SEPARATED IF COMPARED TOGETHER. Run against the
// commit before all three (6115f33 -> 750ce12) it reports 36 moved, all on
// Membership, in all five configurations at both year-points — but every one is
// `absent -> hash` or `hash -> absent`, because defect 2's key-set change
// removes the unit defects 1 and 3 would have been measured in. The instrument
// says "Membership changed everywhere" and cannot say more. THAT IS A REAL LIMIT
// AND IT IS NOT FIXABLE BY NORMALISATION: when the set of screens changes, there
// is no before-value for the after-key to differ from. Attribution needs the
// commits taken one at a time, which is what the three runs above do.
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { chromium, type Browser, type Page } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ============================================================================
// VERSION HISTORY — AND THE OTHER TWO BASELINES' RULE APPLIES HERE TOO: THE LIVE
// PATH IS THE `BASELINE` CONSTANT BELOW, NEVER THIS COMMENT. solo-export-guard
// carries a note about a header line left behind by six recaptures while the
// code had moved on; this block starts in the shape that cannot do that.
//
// v2: THE FIRST RECAPTURE. v1 was taken at c28ec2c and carried 236 of 298 rows
// red across fourteen commits, because every commit in between reported its own
// movement and correctly declined to re-baseline. That is the rule working, but
// a baseline is only an instrument while somebody reads it: by the end each
// commit was running a CONTROL BUILD to separate its own movement from the
// inherited, three times in four commits, and that is the step that gets skipped
// first. 248 -> 298 keys.
//
// WHAT v2 ACCEPTS, attributed commit by commit by building each one and
// capturing the RENDERED TEXT rather than the hash — 50 keys added, 54 moved:
//
//   f88fc71  18 moved  the 3x satisfaction scale         Membership, Result Spreadsheet
//   3084262   9 moved  the GL underwriting cycle         GL and Pool views only
//   33fb5bc  10 moved  risk-control category boxes       Decisions|Pool
//   0fd6f03  10 moved  the slider retired                Decisions|Pool
//   1a06723  10 moved  the tiles compacted               Decisions|Pool
//   f338076  26 moved  five decision notes removed       Decisions, all views
//   b6d6767  20 moved  the Risk Control department page  Departments, Decisions|Pool
//   5cbdc2b  10 moved  descriptions and placeholder cost Decisions|Pool
//   2adc80d  +50 keys  per-document Departments coverage 0 moved, keys gained
//   56efd06  10 moved  the Underwriting document         Departments|doc:Underwriting
//   1d640c6 168 moved  WC's opening band re-translated   WC-bearing configs only
//
// The per-commit counts exceed 54 because Decisions|Pool moved six times and
// counts once. 120a94a, 3c3731e, 59e5c4b and 41aeb29 moved NOTHING.
//
// ⚠ EVERY CUMULATIVE FIGURE THOSE COMMITS CLAIMED WAS REPRODUCED, NOT TAKEN ON
// TRUST — 28 at 0fd6f03, 44 at f338076, 54 at b6d6767 and 5cbdc2b, 104 at
// 2adc80d and 56efd06, 236 at 1d640c6. The record is verified.
//
// ⚠ AND THE 18 FROM THE SCALE WERE RULED ON BEFORE THIS FILE WAS WRITTEN,
// because a recapture accepts them silently otherwise. All 18 are at y2 and none
// at y0 — satisfaction is flat at its opening value until a year is played.
// Masking every two-decimal number makes all 18 rows BYTE-IDENTICAL, so nothing
// reordered, no label moved and no screen restructured. Of 2,354 two-decimal
// numbers on those rows 1,404 changed and 950 did not, every changed one inside
// the 1-10 satisfaction scale. Solving each for the anchor it implies under an
// exact 3x, A = (3*old - new)/2, puts all 1,404 inside [7.19, 7.23] — which is
// OPENING_SATISFACTION's [7.20, 7.22] widened only by 2dp rounding, mean 7.2056.
// It is the scale, and it is nothing else.
//
// ⚠ ONE THING FOUND WHILE RULING, PRE-EXISTING AND NOT ACCEPTED BY THIS FILE:
// there are TWO satisfaction numbers on screen. MembershipPage renders the
// four-limb member model at 2dp and moved; ResultsPage and DashboardPage render
// `result.memberSatisfaction`, a separate pool-level scalar, at 1dp and did not.
// 26 y2 rows mention satisfaction and did not move — Calculation Audit's are all
// static labels and weights, but Results shows a real value that the scale never
// reached. That predates v1 and is recorded here rather than fixed.
// ============================================================================
// RENDER_BASELINE overrides the file, which is what lets one build be compared
// against another (an A/B across two commits) rather than only against the
// committed baseline. The committed path is the default and is what a bare run
// uses.
//
// ⚠ v8 -> v9: THE FIVE-BAND LOSS-RATIO SCALE. Five rows moved, all of them
// Results|Pool|y2, one per configuration, and every one a prose-only change to
// the loss sentence — attributed by diffing the text behind the hashes
// (RENDER_TEXT_DIR, which exists for exactly this) rather than asserted:
//   GL, WC+GL, WC+GL+PR   "...the year's underwriting WITH MARGIN," -> "...the
//                         year's underwriting," — these fell in the new 0.70-1.00
//                         band, which drops the clause.
//   PR                    "with margin," -> "with margin TO SPARE," — 0.50-0.70.
//   WC                    a whole sentence APPEARED where there had been none:
//                         90.8% against 82.1% priced. The old scale's 0.90-1.00
//                         band printed nothing at all, so that year's loss result
//                         was silent. That silence is the defect the fifth band
//                         fixes, and this row is the evidence it existed.
// ⚠ THE CONTROL RAN FIRST AND ON A SEPARATE PORT: 6b90859 built into its own
// worktree and served on 4174 reproduced all 298 fingerprints. That is what
// rules out "the baseline had already drifted" — and it is the check that a
// previous recapture on this project got wrong by pointing the harness at the
// wrong server and reading a false all-clear.
// ⚠ COLOUR IS NOT IN THE FINGERPRINT. innerText carries no CSS classes, so the
// emerald/sky boundary moving from 0.90 to 0.70, and HistoryPage's and
// ResultsPage's combined ratios moving to their own scale, are INVISIBLE here.
// Those changes are real and this instrument did not and cannot see them.
// ⚠ v9 -> v10: THE CLAIMS MEMO PUT ON ONE VALUATION YEAR. Ten rows moved, every
// one `Departments|doc:Claims` at y0 and y2 across all five configurations, and
// every one the SAME cause — attributed by diffing the text behind the hashes
// (RENDER_TEXT_DIR) rather than asserted:
//   the evaluation date moves BACK one year   12/31/2026 -> 12/31/2025 at y0,
//   12/31/2028 -> 12/31/2027 at y2. The listing used to be dated at the year the
//   page had SELECTED — which defaults to the unplayed `currentYearNumber` —
//   while its Paid and Incurred came from live cohort state a year earlier. It
//   is now dated where the money is, which is also where the claims workbook
//   strikes. At y0 that is the last PRE-GAME year, which is why y0 moves at all.
//   the row sets and amounts follow, because claim status now resolves at the
//   same valuation as the figures beside it.
//   plus one added sentence saying which valuation the listing is struck at and
//   that the year selector does not move it.
// ⚠ doc:Actuarial DID NOT MOVE, and that is expected rather than lucky. Its
// developed-occurrence count was also wrong — always the latest year, whatever
// year was selected — but both year-points this harness captures select the
// current year, where the memo clamps to the latest valuation anyway. The fix
// is only visible on a HISTORICAL selection, which this instrument never makes.
// actuarial-memo-check covers it across all ten years; see the control there.
// ⚠ THE CONTROL RAN FIRST AND ON A SEPARATE PORT: f27c066 built into its own
// worktree and served on 4174 reproduced all 298 fingerprints.
// ⚠ v10 -> v11: netIncurredLoss ADDED TO RESULT_METRICS, AND THE LABELS SHARED.
// Eighteen rows moved — 13 on Results (every configuration x every line scope,
// at y2) and 5 on Result Spreadsheet — attributed by diffing the text behind
// the hashes. Two causes and no third:
//   1. the added row, `Net Incurred Loss (the loss-ratio numerator)`, with its
//      figure and, on Results, its year-over-year change.
//   2. labels taken from RESULT_METRICS instead of retyped: `Pool Premium` ->
//      `Pool Premium at Selected CLF`, `Ultimate Losses (Gross)` -> `Gross
//      Ultimate Loss + LAE`, `Net Ultimate Loss` -> `... + LAE`, and the loss
//      ratio's `(prem + admin)` / `(pricing basis)` -> `(pricing basis —
//      premium + admin expense)` on both surfaces.
// ⚠ NO FIGURE CHANGED. The spreadsheet rows carry the same dollars either side;
// only a row appeared and four names were corrected.
// ⚠ Dashboard DID NOT MOVE, which is the expected result and worth recording.
// Its pricing-basis fallback was also wrong — a different numerator under a
// comment claiming it was the engine's — but the fallback fires only when
// `actualLossRatioPricingBasis` is ABSENT, and every save this harness plays
// carries it. The change is invisible here by construction, not by luck.
// ⚠ THE CONTROL RAN FIRST AND ON A SEPARATE PORT: 0655f2e built into its own
// worktree and served on 4174 reproduced all 298 fingerprints.
// ⚠ v11 -> v12: THE CLOSURE BAND PUT ON THE DRAW. 224 of 298 fingerprints
// moved, and that breadth is the point rather than a surprise: changing which
// claims are closed changes the developing set, which changes development
// allocation, which changes reserves, premium and every figure downstream.
// Classified mechanically rather than sampled — of the 224:
//   177  every changed token is a number
//    41  the same, with a suffix my first pass missed ('1.44x' -> '1.43x',
//        '$0.71M.' -> '$0.72M.')
//     6  a token COUNT change, each attributed individually:
//          3x Calculation Audit|GL|y0  the status badge going from '28 of 29
//             checks OK — 1 difference found' to 'All 29 checks OK'
//          3x Departments|doc:Claims|y2  one row of the top-ten open listing
//             REPLACED, e.g. '2024 Summit Recreation District 119' giving way
//             to '2026 Ashford County 047' — a claim's status flipped, which is
//             this change reaching the player-visible document.
// ⚠ PROPERTY-SOLO MOVED NOT AT ALL: GL 44, WC 44, WC+GL 60, WC+GL+PR 76, PR 0.
// Property has no CLOSURE_BY_SIZE split, so it has no band to resolve and the
// contraction cannot reach it. That is the confinement claim, and the export
// guard says the same thing independently — all six PR-solo workbooks are
// byte-identical across every metric, year and full-precision rendering.
// ⚠ AND TWO AUDIT CHECKS FLIP BOTH WAYS. 'Review' -> 'OK' on one row and 'OK'
// -> 'Review' on another, because their differences moved across a tolerance
// that is too tight to be stable — the bound is half a rounding unit for a
// check that sums two rounded rates. That is a SEPARATE defect, fixed in the
// commit after this one; it is recorded here because it is why some of these
// rows carry a word change rather than only numbers.
// ⚠ THE CONTROL RAN FIRST AND ON A SEPARATE PORT: ccebb95 built into its own
// worktree and served on 4174 reproduced all 298 against the committed v11.
// ⚠ v12 -> v13: THE AUDIT PAGE'S OWN CHECKS. 26 rows, every one Calculation
// Audit and nothing else, attributed by diffing the text behind the hashes:
//   line scope   the rate tolerance rises ($166 -> $609 on GL, $169 -> $410 on
//                WC, $10,170 -> $10,178 on Property) because it now carries the
//                exposure rounding as well as the rate rounding, and the note
//                names both. The badge goes '28 of 29 — 1 difference found' to
//                'All 29 checks OK'.
//   pool scope   '$NaN' -> 'n/a' and 'Review' -> the n/a reason, on the two
//                rows whose recalculation needs a per-line CLF the pool has
//                not got; the badge goes '2 differences found, 3 not
//                applicable' to '5 not applicable'.
//   everywhere   'differences under $0' -> 'differences under one cent'.
// After it: 16 captures read 'All 29 checks OK' and the ten pooled ones read
// 53-54 of 58 with the remainder n/a and ZERO differences found.
// ⚠ NO VALUE MOVED. Both value baselines are untouched by this commit; the only
// figures that changed are the printed tolerances themselves.
// ⚠ THE CONTROL RAN FIRST AND ON A SEPARATE PORT: 1330777 built into its own
// worktree and served on 4174 reproduced all 298 against the committed v12.
// ⚠ v13 -> v14: THE FLAT CHARGE AND THE TWO-PART LOSS RATIO. 44 rows, three
// causes, EVERY ONE A PURE INSERTION — classified mechanically, not sampled:
//   Results (13)            the 'Retained Cover Margin (declined layers)' row,
//                           reading $0, plus the pool-layer and total ratios.
//   Result Spreadsheet (5)  the same three rows in the workbook table.
//   Calculation Audit (26)  '+ $0' and '+ 0 (retained cover margin rate)' —
//                           the fourth term of the gross-rate row and the fifth
//                           of total operating revenues.
// ⚠ NO FIGURE CHANGED, and the margin reads $0 on every captured screen because
// the default game PLACES the whole tower. That is the same fact value-identity
// reports as "shape changed, values held": the charge only moves for a player
// who declines something, and nothing in this harness does.
// ⚠ THE CONTROL RAN FIRST AND ON A SEPARATE PORT: 3c00873 built into its own
// worktree and served on 4174 reproduced all 298 against the committed v13.
// ⚠ v14 -> v15: THE PROPERTY MERGE. 140 of 298 moved. EVERY ONE CLASSIFIED
// MECHANICALLY by diffing the text behind each hash against the text behind the
// hash it replaced — not sampled, not eyeballed:
//   102  VALUES ONLY, and every one of them in a configuration that CONTAINS
//        Property. Property's frequency and severity recalibration.
//    31  'Events This Year' added to the metric table.
//     5  'Shock Loss Incurred' removed from it.
//     5  'Catastrophe Factor' removed from it.
//     4  the narrative sentence "A shock loss event occurred this year" gone.
//     4  the new events banner, naming a drawn catastrophe and its region.
//
// ⚠ ZERO ROWS MOVED ON VALUES IN A CONFIGURATION WITHOUT PROPERTY. The WC-only
// and GL-only screens that moved moved ONLY because a row was added or removed;
// not one number on either changed. That is the same confinement value-identity
// v50 reports from the other side (WC-solo and GL-solo bit-identical, 0 of
// ~6000 values each), measured through a completely different instrument — the
// rendered text a player actually sees, rather than the engine's own fields.
// Two independent instruments agreeing is the reason this recapture is trusted.
//
// ⚠ THE CONTROL RAN FIRST AND ON A SEPARATE PORT, as it must before any diff
// this large is believed: b856340 built into its own worktree and served on
// 4174 reproduced ALL 298 against the committed v14. The harness is
// deterministic, so the 140 are real.
//
// ⚠ THE FLAT CHARGE AND THE RATIO PAIR DO NOT APPEAR ABOVE and their absence is
// correct: v14 was captured at b856340, which already carried them.
// ⚠ v15 -> v16: THE CLAIMS MANAGEMENT SYSTEM BECAME BUYABLE. 10 of 298 moved,
// every one of them Decisions|Pool, and ALL TEN HAVE THE SAME CAUSE — the
// sentence naming which tiles are live. Classified mechanically against the
// prior commit's own text, three variants:
//   4 rows  GL-only and WC-only: "is" -> "and Claims Management are", because
//           those pools went from one buyable program to two.
//   4 rows  WC+GL and WC+GL+PR: "+ and Claims Management", same cause.
//   2 rows  PROPERTY-ONLY: the whole sentence "Claims Management is live; the
//           others are not yet buyable." INSERTED, because a Property-only pool
//           previously had NO buyable program at all and so had no sentence to
//           name one. That is this program giving Property its first.
//
// ⚠ THE TILE ITSELF DOES NOT APPEAR ABOVE AND ITS ABSENCE IS CORRECT. The
// fingerprint is a hash of innerText, so a tile turning from a div into a button
// is invisible to it: the name, the scope chip and the cost were already
// rendered and are unchanged. Nothing was skipped — there is nothing to see.
//
// ⚠ THE CONTROL RAN FIRST AND ON A SEPARATE PORT: cb3b5d5 built into its own
// worktree and served on 4174 reproduced ALL 298 against the committed v15.
//
// ⚠ v16 -> v17: THE INVESTMENT RETURN CUT. 280 of 298 moved, which is the
// largest capture this file has taken, and a number that size is exactly when
// the header's "do NOT re-capture to make this green" has to be answered rather
// than quoted. It is answered in three parts.
//
//   THE CONTROL FIRED. ee953aa built into its own worktree and served on 4174
//   reproduced ALL 298 against the committed v16 on the same run of this
//   harness. So the 280 are this change and nothing else.
//
//   2 of 298 ARE THE DOCUMENT, AND THE DIFF IS THREE NUMBERS.
//   Departments|doc:Investment moved from a3d218cd64dd1fae to 6a5d6efc84f23082
//   — ONE fingerprint across every configuration and both years, because the
//   memo is static and says the same thing to every pool. Diffed as text, the
//   whole change is "4.19% -> 2.79%", "5.20% -> 3.47%", "8.26% -> 5.51%" in the
//   assumptions table. Every other word, including the allocation line, is
//   byte-identical. Both now come from the constants via buildInvestmentMemo.
//
//   8 of 298 ARE THE AUDIT PAGE'S ASSET ROW plus its game numbers. Calculation
//   Audit's "Asset Class Assumptions" row reads ASSET_CLASS_ASSUMPTIONS directly
//   and always did: Return 4.2%/5.2%/8.3% gross -> 2.8%/3.5%/5.5%.
//
//   THE REMAINING 270 ARE GAME NUMBERS, FOR THREE REASONS. Investment income is
//   lower on every screen that shows a financial figure — expected. The opening
//   book itself is different, because runLinePreGame accepts a past on ENDING
//   SURPLUS / premium, which contains investment income, so a lower rate can
//   reject a past the old rate accepted and redraw the history behind it (22 of
//   24 measured games accepted a different attempt on at least one line). AND
//   the opening LEVEL moved deliberately: OPENING_SURPLUS_BAND and
//   STARTING_CAPITAL_TO_PREMIUM were re-levelled together so every line opens at
//   1.5x annual premium. That is why screens with no investment figure on them
//   at all — Membership, Pool History — moved too.
//
//   ⚠ THE 18 THAT HELD ARE EXACTLY THE DEPARTMENTS DOCUMENTS WITH NO ENGINE
//   FIGURE IN THEM: doc:Risk Control on all five configurations, doc:Underwriting
//   on WC and PR, doc:Actuarial and doc:Claims on WC. Nothing with a number on it
//   held, and nothing without one moved — which is the shape to expect from a
//   change that moves values and no layout.
//
//   ⚠ AND THE MEMO'S FINGERPRINT IS THE SAME ONE IT TOOK BEFORE THE OPENING
//   MOVED (6a5d6efc84f23082), which is itself the evidence the document is
//   static: the pre-game re-rolled twice under it and it did not notice.
//
//   18 HELD, and they are the screens with no number and no document on them.
const BASELINE = process.env.RENDER_BASELINE
//
// ⚠ v17 -> v18: THE CATASTROPHE CAPITAL TERM AND THE COMMON OPENING MULTIPLE.
// 248 of 298 moved, and the split is cleaner than v17's because this change
// touches NO player-facing prose at all.
//
//   THE CONTROL FIRED FIRST. b9d797e built in its own worktree and served on
//   4174 reproduced ALL 298 against its own committed v17, so the 248 are this
//   change and not the instrument.
//
//   50 HELD, AND THEY ARE EVERY DEPARTMENTS DOCUMENT — Actuarial, Claims,
//   Investment, Risk Control and Underwriting, on all five configurations, both
//   years. No memo, no document and no displayed constant moved. Spot-checked
//   on the Calculation Audit: its asset row still reads 2.8% / 3.5% / 5.5%
//   gross, so the investment returns are untouched; 114 words of 4,477 differ
//   on that page and every one is a game number.
//
//   248 MOVED, for two reasons. Property's required capital gained
//   catCapitalRetained, so every capital, funding and adequacy figure on that
//   line moves. And every line's opening book re-rolled, because the pre-game
//   accepts against OPENING_SURPLUS_BAND and the band changed both basis
//   ('reserve'/'premium' -> 'required') and level (to a common 2.28x).
//
//   ⚠ ONE EXCEPTION, ADDED AFTER audit-formula-check WENT RED: the Calculation
//   Audit's "Reserve Risk Margin Needed" row now states a SUM (reserve margin
//   plus retained catastrophe) where it stated a product, because the margin
//   gained a term and the printed derivation no longer reproduced its own
//   value. So that row's TEXT moved too, on top of its numbers.
//
//   Otherwise nothing with words moved and everything with a number did. That
//   is the shape to expect from a change that moves values and no layout.
// ⚠ v18 -> v19: ZERO RISK LOAD, AND THE OPENING PIN THAT FOLLOWED IT.
// THE CONTROL RAN FIRST AND ON A SEPARATE PORT, as it must before any diff is
// read: b35dbe2 built into its own worktree, served on :4174, checked against
// the COMMITTED v18 and reproducing ALL 298 FINGERPRINTS IDENTICAL. Only then
// was the working tree built on :4173 and diffed against that same v18.
//
// 248 of 298 moved. NOTHING WAS ADDED, REMOVED OR RENAMED — 0 added, 0 removed,
// and every changed token across all 248 rows is a number, a price string or a
// re-sort. Attributed by dumping the text of both sides (RENDER_TEXT_DIR) and
// diffing them word by word:
//   - layer prices fall by the load and nothing else: GL $1M xs $1M
//     $8,701,773/yr -> $6,076,014/yr, $5M xs $5M $4,034,744 -> $2,180,750,
//     WC tower $7,720,692 -> $3,364,339, Property quake $36,025,249 ->
//     $15,854,274. Higher layers fall further, which is the load being
//     proportional to the cession's spread.
//   - TOTAL MEMBER CHARGE falls with them (GL y0 $42.48M -> $34.89M).
//   - surplus moves in BOTH directions (WC y2 $21.50M -> $19.69M, GL y2
//     $35.83M -> $36.38M) because the opening book re-rolled when the pin moved.
//   - Membership is a PURE REORDER. All 26 of those rows have a word-for-word
//     identical multiset; the roster sorts on a value that moved.
//   - the 50 rows that did NOT move are exactly the five department memo panes
//     across all 5 configurations and both years — static prose, no numbers.
//     That they held is the evidence the capture is value-only.
// ⚠ v19 -> v25: THE feature/uw-decisions MERGE. Numbered above BOTH parents:
// risk-control was at v19 and uw-decisions at v24, and the two branches' version
// numbers had COLLIDED earlier (each minted its own v52 of the value baseline on
// different content), so the merged capture takes a number neither side used.
//
// THE CONTROL RAN FIRST AND ON A SEPARATE PORT, as it must: the merge's FIRST
// PARENT 2e38ecd was built in its own worktree, served on :4174, and reproduced
// ALL 298 FINGERPRINTS IDENTICAL against the committed v19. Only then was the
// merged tree built on :4173 and diffed against that same v19.
//
// 274 of 298 moved, 0 ADDED, 0 REMOVED, 0 RENAMED. Attributed by dumping both
// sides' text (RENDER_TEXT_DIR) and comparing word by word. Of the 274:
//   233  VALUE ONLY — the alphabetic content of the page is identical
//        word-for-word; only numbers moved. This includes every row of
//        Calculation Audit, Financial Statements, Pool History, Decision
//        History, Result Spreadsheet and _header.
//    26  Membership — PURE PERMUTATIONS. Word multisets identical; the roster
//        sorts on a value that moved.
//    32  Decisions and Departments — the only REAL prose changes, and they are
//        uw-decisions' own UI: "New Business Appetite" tiers replaced by the
//        intake slider ("No New Business / Strict / Moderate / Low"), the
//        renewal decline bar replaced by the renewal slider ("Renew all /
//        Worst 5%"), and the underwriting memo rewritten to match ("drawn when
//        the year is processed" -> "each applicant is inspected").
//     8  Dashboard — a magnitude SUFFIX flip (K to M) as a figure crossed a
//        rounding boundary. Formatting following a value, not an edit.
//     1  WC|Results|Pool|y2 — the page's own conditional sentence: the loss
//        ratio crossed 100% (90.2% -> 101.1%) so "covering the year's
//        underwriting" became "so underwriting lost money this year". The UI
//        responding to a number, which is what it is built to do.
// The 24 rows that did NOT move are department memo panes with no numbers in
// them, which is the evidence nothing moved that should not have.
// ⚠ v25 -> v26: THE SATISFACTION OPENING FIX. Members are seeded at the anchor
// their own pool's opening position earns instead of a fixed 7.20-7.22, and the
// surplus-limb constants were re-solved onto where pools now sit.
//
// THE CONTROL RAN FIRST AND ON A SEPARATE PORT: 60975ba built in its own
// worktree, served on :4174, reproducing ALL 298 FINGERPRINTS against the
// committed v25. Only then was this tree built on :4173 and diffed against it.
//
// 31 of 298 moved. 0 added, 0 removed, 0 renamed, and 0 rows with any PROSE
// change — the alphabetic content of all 31 is identical word for word, so
// every one is a number. They are exactly the two screens that print member
// satisfaction, and nothing else moved anywhere:
//     Membership          26  (every configuration, both years)
//     Result Spreadsheet   5  (its member table)
// Sample, GL|Membership|GL|y0: the line's average member satisfaction reads
// 7.21 -> 8.14, and individual members 7.21 -> 7.73 and 7.20 -> 8.20.
//
// That the other ten screens are untouched is the evidence this change stayed
// in its lane: satisfaction is a scoreboard that feeds nothing, and both value
// baselines held BIT-EXACTLY across it.
// ⚠ v26 -> v27: MEMBER-LEVEL VIEWS HIDDEN, EXPOSURE AND COMBINED RATIO SHOWN.
// A KEY-SET CHANGE as well as a value change, which is why the count falls.
//
// THE CONTROL RAN FIRST AND ON A SEPARATE PORT: 09d1482 built in its own
// worktree on :4174, reproducing ALL 298 FINGERPRINTS against the committed v26.
// Only then was this tree built on :4173 and diffed against it.
//
// 272 keys, down from 298: the 26 Membership keys are GONE because the tab is
// hidden (the page itself is intact — see TABS above). Of the 272 that remain,
// 212 moved and 60 held, and EVERY ONE of the 212 is attributed:
//
//   ⚠ ALL 212 LOSE THE WORD "Membership", AND THAT IS THE TAB BAR. The nav strip
//     is part of every page's captured text, so hiding one tab moves every
//     fingerprint in the file. Six screens — Calculation Audit, Decision
//     History, Decisions, Departments, Financial Statements, Introduction —
//     changed by EXACTLY that one word and nothing else, which is the evidence
//     this stayed in its lane: those are the screens the brief said to leave.
//   Dashboard (26)          MEMBERS -> EXPOSURE, counts -> $M
//   Pool History (26)       MEMBERSHIP/Members -> EXPOSURE/Exposure, $M
//   Results (26)            Active Members, New Members, Members Withdrawn,
//                           Retention and Avg. Risk Quality out; Combined Ratio
//                           in. Member Satisfaction stays.
//   Result Spreadsheet (10) the Active Member Roster table and its ~70 member-
//                           id rows gone, with the members CSV button.
//
// 0 keys were ADDED. Nothing gained a screen; the file only lost one.
// ⚠ v27 -> v28: THE WELCOME MEMO STATES EXPOSURE BY LINE INSTEAD OF A MEMBER
// COUNT. The smallest diff this file has taken in a while, and that is the
// result worth recording.
//
// THE CONTROL RAN FIRST AND ON A SEPARATE PORT: 2709cfe built in its own
// worktree on :4174, reproducing ALL 272 FINGERPRINTS against the committed v27.
// Only then was this tree built on :4173 and diffed against it.
//
// 10 of 272 moved, 0 added, 0 removed — and all ten are Introduction, which is
// the one screen the memo is on (5 configurations x 2 years). Every other screen
// is byte-identical, which is the evidence the change stayed inside the one
// sentence it was meant to touch.
//
// The replaced sentence ("serves N of 200 eligible public entities, representing
// approximately $X in payroll and $Y in total insured value") is absent from all
// ten, and each shows one bullet per ACTIVE line: a GL-only game renders exactly
// one, with no empty sentence and no "$0" row for the lines it does not write.
//
// ⚠ v28 -> v29: RISK CONTROL MOVED OFF THE POOL TAB AND ONTO EACH LINE.
//
// THE CONTROL RAN FIRST AND ON A SEPARATE PORT: 2eabb44 built in its own
// worktree on :4174 reproduced ALL 272 FINGERPRINTS against the committed v28.
// Only then was this tree built on :4173 and diffed against it.
//
// 26 of 272 moved, 0 added, 0 removed, and EVERY ONE OF THEM IS A DECISIONS
// SCREEN. That is the whole claim this change makes — it is screen-only, the
// new field is not read by the engine, and the removed tiles all defaulted to
// off — so a single moved fingerprint anywhere else would have contradicted it.
// None did.
//
// The 26 attribute word-for-word to exactly two edits, with NO row showing
// both an addition and a removal:
//
//   16 LINE TABS (WC, GL, PR across all five configurations, y0 and y2) ADD
//   ONLY, and the added words are the new card: "Investment in Risk Control
//   Incentives", the line's own programme name, "0% of premium / None / 5% of
//   premium", the premium-source sentence, and the "Not yet active — will feed
//   the new rate indication" note. The programme name is per line and the
//   fingerprints prove it: WC's 6 rows carry "Safety & Return-to-Work", GL's 6
//   "Training and Analytics", Property's 4 "Mitigation".
//
//   10 POOL TABS (5 configurations x y0 and y2) REMOVE ONLY, and what leaves
//   is the whole Loss Prevention card: "Risk Control Programs", every tile the
//   configuration offered, "Committed this year $0/yr", the "All N available
//   programs" total and the five-independent-programs sentence. The five
//   distinct removal texts differ only by which tiles that configuration
//   showed, which is the card's own gating and not five separate edits.
//
// ⚠ y0 AND y2 MOVED TOGETHER ON EVERY ONE, which is the right negative. A
// difference between the two year-points would mean something time-dependent
// had entered the card — the defect class the y0 point exists to catch. The
// slider reads its default at both and no result feeds it.
//
// ⚠ v29 -> v30: THE DIVIDEND / ASSESSMENT CONTROL, AND ITS BASIS.
//
// THE CONTROL RAN FIRST AND ON A SEPARATE PORT: 0844296 built in its own
// worktree on :4174 reproduced ALL 272 FINGERPRINTS against the committed v29.
// Only then was this tree built on :4173 and diffed against it.
//
// 42 of 272 moved, 0 added, 0 removed, and they attribute word-for-word to
// exactly THREE edits across two screens. No other screen moved.
//
//   16 DECISIONS LINE TABS (WC, GL, PR across all five configurations, y0 and
//   y2): "None" -> "0%" at the slider's centre, plus the new note
//   "Surplus: $X 0%". The Decisions POOL tab did NOT move, which is the right
//   negative — the control is per line and the Pool tab has never carried it.
//
//   26 CALCULATION AUDIT rows, from two separate edits:
//     - the printed slider range, "-25.0%, 0.5%," -> "-15.0%, 1.0%,". This is
//       the ONLY thing that moved on the 10 Pool rows, which carry the ranges
//       but no per-line formula.
//     - the dividend and assessment FORMULA BASIS on the 16 line rows: the
//       factor changes from pool premium to the opening surplus and is now
//       labelled "(opening surplus)" — e.g. WC y0 $6,172,742 -> $15,175,300.
//       Two occurrences per page, the assessments row and the dividends row.
//
// ⚠ THE DOLLAR VALUES OF `assessments` AND `dividends` DID NOT MOVE ANYWHERE,
// and that is the evidence the basis change is inert at the default. The
// harness plays default decisions, where both percentages are 0, so both
// figures are $0 on either basis. What moved on the audit is the stated
// MULTIPLICAND, not the product — which is exactly the claim: the arithmetic
// shown is now the arithmetic performed.
//
// ⚠ THE TWO SCREENS DISAGREE ON THE SURPLUS AND BOTH ARE RIGHT. At WC y0 the
// Decisions note reads $16.51M and the audit's basis reads $15,175,300. The
// audit shows the DISPLAYED RESULT's own opening surplus; the Decisions note
// shows the opening surplus of the year being DECIDED, which is that result's
// endingSurplus carried forward. Checked rather than waved at, because a
// mismatch between them would otherwise be the first thing to suspect.
//
// ⚠ v30 -> v31: THE CLAIMS DEPARTMENT IS HIDDEN. 272 -> 262 FINGERPRINTS, AND
// THE KEY COUNT FALLING IS THE POINT RATHER THAN A SIDE EFFECT.
//
// THE CONTROL RAN FIRST AND ON A SEPARATE PORT: 896df2a built in its own
// worktree on :4174 reproduced ALL 272 FINGERPRINTS against the committed v30.
// Only then was this tree built on :4173 and diffed against it.
//
// 20 of 272 moved, and they are two halves of one edit. Nothing outside
// Departments moved at all:
//
//   10 REMOVED — `Departments|doc:Claims` at y0 and y2 across all five
//   configurations. The document is no longer reachable, so the harness has no
//   pane to fingerprint. Confirmed to be the memo and not an empty pane: the
//   control's dump opens "Claims Department — Open claim inventory, evaluated
//   12/31/2027...", and the string "Large loss listing" appears in NO subject
//   dump anywhere.
//
//   10 MOVED — `Departments|-` at y0 and y2 across all five configurations,
//   which is the department LIST. One distinct word-level diff across all ten,
//   removing "Claims Large loss listing by member and status" and adding
//   NOTHING. A row left behind, or a blank where it stood, would show here as
//   an addition; there is none.
//
// ⚠ THE OTHER FOUR DOCUMENTS DID NOT MOVE. Actuarial, Risk Control,
// Underwriting and Investment keep their own fingerprints at both year points
// in all five configurations, which is the evidence this took out one pane
// rather than disturbing the reader around it.
//
// ⚠ v33 -> v34: THE SET OPENING. 232 of 252 fingerprints moved, and the 20 that
// HELD are the reading. They are the Investment and Risk Control department
// documents at both year points in all five configurations — the only two panes
// in the capture that carry no balance-sheet figure. Every screen that shows
// money moved; the two that do not, did not. That is what an opening-balance
// change looks like and it is what this capture is.
//
// The move was taken with the control the recapture rule asks for: the parent
// commit built in its own worktree and served on :4174 reproduced v33 at
// 252/252 before any of this was trusted, so the harness is not what moved.
//
// ⚠ v34 -> v35: CASE AND IBNR COLUMNS ON THE ACTUARIAL MEMO. 10 of 252
// fingerprints moved and ALL TEN ARE THE SAME DOCUMENT: doc:Actuarial at both
// year points in all five configurations. Nothing else in the capture moved —
// not the other four department documents, not a tab, not a line view. The
// exhibit gained two columns and the engine gained six result fields that no
// screen reads yet, which is exactly the footprint this commit intended.
//
// Taken with the control the recapture rule asks for: the parent commit built
// in its own worktree and served on :4174 reproduced v34 at 252/252 first.
//
// ⚠ v35 -> v36: FIVE PRIOR YEARS. The opening balance sheet changes, so every
// screen that shows money changes with it. Taken with the control the
// recapture rule asks for — the parent built in its own worktree and served on
// :4174 reproduced v35 first. Attribution is in the commit message.
//
// ⚠ v36 -> v37: THE REINSURANCE PRICE AND THE BULK-YEAR CESSION. Both move the
// opening and the charge, so every money-bearing screen moves. Taken with the
// control — the parent on :4174 reproduced v36 first. Attribution in the
// commit message.
// v38: THE NEW RATE STACK, ON. 208 OF 252 FINGERPRINTS MOVED, AND THE 44 THAT
// DID NOT ARE THE ATTRIBUTION — every unmoved row is a screen with no priced
// figure on it: the y0 rows of the result-only tabs (Results, Result
// Spreadsheet, Decision History, _header, and Decisions' Pool view), where no
// year has been played yet, plus the Departments documents that carry no
// money — Investment and Risk Control at both year-points.
//
// ⚠ THE CONTROL WAS RUN FIRST AND IT IS WHAT MAKES THE DIFF READABLE. The
// parent commit was built in its own worktree and served on 4174, and it
// reproduced its own committed baseline 252 of 252 before this capture was
// taken. So every one of the 208 is this build's doing and none of it is the
// container's.
//
// THREE SCREENS WERE OPENED AND DIFFED RATHER THAN ASSUMED, which is what the
// recapture rule above asks for:
//   Introduction      opening surplus and the premium-to-surplus ratio in the
//                     narrative line: $46.70M / 0.27 -> $43.11M / 0.48.
//   Financial Stmts   the Year 0 statement — the last PRE-GAME year, not the
//                     game's opening. Contributions for retained risk $7.17M
//                     -> $14.66M with claims ($7,477,030) and total
//                     liabilities ($31,187,305) IDENTICAL. The game's actual
//                     opening is untouched: the header's Year 1 surplus reads
//                     $68.10M on both sides, and the opening is set from the
//                     reserve, which no rate change can move — measured
//                     separately at 8 games, bit-identical on all three lines.
//   Actuarial memo    this one was a DEFECT and was fixed before capture, not
//                     baselined. See actuarialMemo.ts: the memo differenced a
//                     new-stack charged figure against the old triangle's
//                     indication and printed the basis change as a window
//                     movement (-49.1%, "year 2 in, year -8 out").
// v39: THE DECISIONS PANEL, AND NOTHING ELSE. 16 of 252 moved, and all 16 are
// `*|Decisions|<line>|*` — every per-line Decisions view in all five
// configurations, at both year-points. No other tab moved, and neither did
// Decisions' Pool view, which hosts no rate panel.
//
// The control ran first: the parent built in its own worktree and served on
// 4174 reproduced its own committed baseline 252 of 252.
//
// TWO CHANGES, BOTH ON THAT PANEL, AND THE SECOND IS WHY THE FIRST IS WORTH
// ANYTHING. The "vs last year" cells now carry the CHANGE as a percentage with
// last year's rate beneath them in smaller text, and the panel prices off the
// live ledger instead of last year's stored pure premium. Measured on
// WC|Decisions|WC|y2, before -> after:
//
//     pure premium   $4.52 / $3.36   ->   $4.33 / $3.17
//     = Rate         $5.38 / $5.48   ->   $5.18 / $5.28
//     vs last year   +0.0% / +0.1%   ->   -3.7% from $5.3795 / -3.5% from $5.4732
//
// That "+0.1%" is the defect in one reading: the panel was comparing an
// indication built from last year's pure premium against last year's own
// indication, built from the same figure, so the change column could not move.
// v40: THE GL POOL LIMIT AND THE PRE-GAME FUNDING LEVEL. 212 of 252 moved.
// The control ran first: the parent, built in its own worktree and served on
// 4174, reproduced its own committed baseline 252 of 252.
//
// THE 40 THAT DID NOT MOVE ARE THE ATTRIBUTION, and they are the same 40 kinds
// as at v38: the Departments documents that carry no money (Investment and
// Risk Control at both year-points, Actuarial at y0) and the y0 rows of the
// result-only tabs, where no year has been played.
//
// TWO SCREENS WERE OPENED AND DIFFED RATHER THAN ASSUMED:
//   PR|Decisions|PR|y2   $20.93M -> $20.91M, and NOTHING ELSE. Property has no
//                        pool limit, so the only thing reaching it is the
//                        pre-game's premium-based opening cash split — a 0.1%
//                        move. That one screen is the clearest evidence the GL
//                        limit stayed on GL.
//   GL|Financial Stmts   surplus $140.68M -> $116.23M. GL's premium falls with
//                        its rate while most years' actual losses are
//                        unchanged — only about 9% of GL line-years have a
//                        claim above $25M — so a quiet year now earns less.
//                        That is the pool no longer charging for a tail it
//                        never covered, which is the point of the change.
// v41: THE HOST'S DEVELOPMENT %, THE SIGN CONVENTION, AND THE MEMO'S TWO
// RESTORED COLUMNS. 130 of 252 moved. The control ran first: the parent, built
// in its own worktree and served on 4174, reproduced its own committed
// baseline 252 of 252.
//
// THE SPLIT IS LEGIBLE IN THE UNMOVED SET: 13 of each main tab did not move,
// and they are the y0 rows — no year has been played, so nothing has
// developed. Financial Statements is the exception at 4 unmoved, because its
// y0 shows the pre-game Year 0 statement and that carries the one line the
// sign convention touches.
//
// TWO SCREENS WERE OPENED AND DIFFED RATHER THAN ASSUMED:
//   WC|Financial Stmts|y0   the ONLY change is "-$0" becoming "$0" on Prior
//                           year claims. A screen with no played year has no
//                           development, so what is left is the convention's
//                           own zero handling — which is the cleanest possible
//                           evidence that the engine did nothing there.
//   PR|Results|PR|y2        surplus $20.91M -> $21.76M. Property's default is
//                           2% FAVOURABLE, so its development adds to surplus;
//                           the direction is the parameter's sign.
//
// v42: LOSS ENGINE COMMIT 3a — THE NEW ENGINE, PERMANENT, ONE BOOK PER LINE.
// 242 of 252 moved. The control ran first: the parent (b234c36), built in its
// own worktree and served on 4174, reproduced v41 252 of 252. Every moved row
// was then diffed as TEXT (RENDER_TEXT_DIR on both sides), not assumed:
//
//   UNMOVED (10)   the Investment memo, every configuration and year — it
//                  reads no loss, premium or member figure.
//   ABSENT (10)    Departments|doc:Risk Control — the memo is hidden with
//                  RISK_CONTROL off, as briefed.
//   NUMBERS ONLY   _header, Introduction, Decision History, and most of
//                  Results and Result Spreadsheet: every changed token is a
//                  number — losses, reserves, rates and surplus on the new engine.
//   Dashboard (26)      the MEMBER SATISFACTION card is gone and the exposure
//                       sub-label reads "of $XM in the market" for "members";
//                       the capital words (Strong / Adequate / Deficient /
//                       Thin) move with the numbers.
//   Decisions (16 text) the membership intake and renewal text is the book's
//                       renewal and intake controls, and the risk control
//                       slider reads "coming soon".
//   Departments          "Risk Control Programs available for management
//                       consideration" is hidden; the Actuarial memo's numbers move.
//   Financial Stmts (26) "Less: reinsurance recoveries — current year" is not
//                       printed in a year that recovers nothing — the row has
//                       always been conditional on a non-zero recovery.
//   Calculation Audit    the per-occurrence cession rows follow the recovery;
//                       loss prevention reads "risk control is coming soon";
//                       and a Shock Events card appears where the catalogue
//                       fired an event (Economic Recession at y2 on this seed).
//   Pool History (26)    the trend arrows (Up / Down) and capital words move.
//   Results / Result Spreadsheet  the Member Satisfaction row and the two risk
//                       control rows are hidden; the narrative names the year's
//                       own events.
//
// ⚠ TWO DEFECTS THE DIFF FOUND, BOTH FIXED BEFORE THIS CAPTURE. (1) The
// Actuarial memo had LOST its "Indicated pure premium" section: two exposure
// reconstructions (experienceRating.ts and pricingTriangle.ts) still read the
// roster and returned 0 for a book. They now read the row's own exposure, as
// newPurePremium.ts does; no value moved. (2) The Shock Events card described
// a new-engine event in the old engine's terms — "0 injected claims", and an
// "expected added" row explaining multiplied Poisson draws. It now states the
// new attribution.
//
// v43: THE RESULTS NARRATIVE NAMES AN EVENT THAT COST MONEY WITHOUT A CLAIM.
// 14 of 242 moved. The control ran first: 3a (f376877), built in its own
// worktree and served on 4174, reproduced v42 242 of 242. Every moved row was
// diffed as text on both sides:
//
//   Result Spreadsheet (4: GL, WC, WC+GL, WC+GL+PR)  only the "Events This
//                       Year" row: "None" becomes e.g. "Economic Recession:
//                       +$957,692 losses", and a Social Inflation year names it.
//   Results, y2 (10)    the events card gains the uplift-only event — "Economic
//                       Recession, in force since year 1 — Workers'
//                       Compensation: $957,692 added to losses" — and the "What
//                       Happened This Year" narrative opens with its sentence.
//                       Nothing else on those screens moved.
//
// The new engine's A raises the year's ordinary losses by exact attributed
// dollars and brings no claim; the narrative filtered on claims and so never
// named Recession, Legislation, Economic Inflation or Social Inflation.
//
// v44: LOSS ENGINE COMMIT 4a — ONE REINSURANCE PACKAGE PER LINE. 127 of 242
// moved. The control ran first: 3b (88d1e6e), built in its own worktree and
// served on 4174, reproduced v43 242 of 242. Every moved row was diffed as
// text on both sides; three causes, nothing else:
//   - THE DECISIONS PAGE (20 rows): the per-band tower controls and the
//     aggregate stop-loss panel are replaced by one package choice per line,
//     each priced (premium and expected recovery), the note that aggregate
//     cover is not offered and may return, Property's earthquake retention,
//     and Package / Reinsurance Cost / Retained Above Package rows.
//   - THE PACKAGE NAMED WHERE THE PLACEMENT WAS: Decision History's "+ $5M xs
//     $5M + $15M xs $10M" style list and the Result Spreadsheet's placement
//     column become the package id.
//   - THE VALUES of the default package (v64 of the value baseline): Property
//     buys $20M xs $5M instead of a tower to $1B, so its reinsurance cost
//     falls and its surplus rises ($27.08M -> $39.79M by year 3); GL and WC
//     stop buying their top bands. Surplus, ratios, the header, the capital
//     labels (Strong / Adequate / Thin / Deficient), the prior board's
//     history and the narrative's "paid" / "did not pay" follow.
//
// v45: LOSS ENGINE COMMIT 4b — TEN WORLDS. 116 of 242 moved, EVERY ONE A
// YEAR-3 SCREEN: no opening (y0) screen moved, which is the pre-game running
// once and the opening being shared. The control ran first: 4a (d113666),
// built in its own worktree and served on 4174, reproduced v44 242 of 242.
// Every moved row was diffed as text on both sides. Causes, nothing else:
//   - THE VALUES are the average across ten worlds — surplus, ratios (from
//     averaged parts), the header, the capital labels, the narrative.
//   - THE SPREAD: Results and Decisions show "Ending surplus across 10
//     worlds: min · median · max" beside the average.
//   - THE EVENTS: every world's events, each with "in k of 10 worlds — averaged
//     over all 10" and averaged claim counts.
//   - THE CALCULATION AUDIT states a multi-world year's per-world rules as
//     what they are: the cash as the average of the worlds' own sweeps, the
//     dividend and assessment bases averaged over the worlds' own surpluses,
//     the admin rate at the book the rate was struck on. A loan year's
//     rollforwards include the inter-line transfer, and the investment check
//     applies the year's Investment Loss — both were pre-existing gaps in loan
//     and Investment Loss years, which ten worlds make common.
//   - THE CLAIMS DOWNLOAD reads "world 1 of 10", and a loan year's tie-out on
//     Results reads as tied after the transfer.
//   - THE LOAN PROMPT: a line short in any world raises it; this tool now
//     confirms it at its default (authorize), so the y2 screens include loan
//     years the one-world game never reached.
  ?? path.join(__dirname, '../../baselines/RENDER_IDENTITY_v45.json');
const WRITE = process.argv.includes('--write');
const BASE_URL = process.env.RENDER_URL ?? 'http://127.0.0.1:4173';
// The image ships chromium 1194; a newer `playwright` expects its own build and
// refuses to launch. Pointing at the preinstalled binary is the documented
// answer here and avoids a download the sandbox would not allow anyway.
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

// ⚠ THE INSTANCE ID IS FIXED, WHICH IS THE WHOLE DETERMINISM STORY. SetupPage
// falls back to randomInstanceId() on an empty field, so an unset seed makes
// every run a different game and every fingerprint noise. Typed in explicitly.
const INSTANCE_ID = 'RENDERBASE1';
const POOL_NAME = 'Render Identity Pool';

type Cfg = { key: string; lines: string[] };
const CONFIGS: Cfg[] = [
  { key: 'WC', lines: ["Workers' Compensation"] },
  { key: 'GL', lines: ['General Liability'] },
  { key: 'PR', lines: ['Property'] },
  { key: 'WC+GL', lines: ["Workers' Compensation", 'General Liability'] },
  { key: 'WC+GL+PR', lines: ["Workers' Compensation", 'General Liability', 'Property'] },
];
const LINE_LABEL: Record<string, string> = {
  WC: "Workers' Compensation", GL: 'General Liability', PR: 'Property',
};
// The 10 game tabs. 'Game Setup' is excluded: it is the page you leave to start.
//
// ⚠ 'Membership' CAME OFF THIS LIST BECAUSE THE TAB IS HIDDEN, not because the
// page was deleted. MembershipPage and its route are intact in GameShell, one
// commented line from returning; the multiplayer game shows the pool in
// aggregate, so the tab is not rendered and this harness cannot click it. The
// baseline loses that tab's keys with it — that is a KEY-SET change, which is
// exactly the kind this file's header says to expect and to attribute.
const TABS = ['Introduction', 'Departments', 'Pool History', 'Dashboard', 'Decisions',
  'Decision History', 'Financial Statements', 'Results', 'Result Spreadsheet',
  'Calculation Audit'];
// ⚠ WHICH TABS CARRY THE LINE BAR IS DETECTED, NOT LISTED, AND THE FIRST VERSION
// OF THIS FILE LISTED IT. That was a real mistake and it is recorded because it
// is instructive: the list was App.tsx's LINE_VIEW_PAGES as of 750ce12, which
// includes 'Membership' — and whether Membership HAS a line bar is exactly what
// one of the three fixes changed. So the harness could not run at all against
// the commit before the fix: it waited 30s for a 'Pool' button that did not
// exist there and threw. An instrument that assumes the thing it is meant to
// detect cannot detect it.
//
// Detecting instead makes the bar's PRESENCE part of what is measured. A tab
// that gains or loses its line view changes the KEY SET, and the diff reports
// that as `absent -> <hash>` rather than failing to run.

// ============================================================================
// NORMALISATION — AND AN HONEST ACCOUNT OF WHAT IT COST, WHICH WAS LESS THAN
// EXPECTED. A comment here saying each rule was "added because a run disagreed
// with itself" would be a measurement claim, and it would be false: the two
// validation runs were identical on the FIRST attempt, so nothing below was
// forced by an observed disagreement. Every rule is PREVENTIVE, and the honest
// statement is that the app turned out not to render anything non-deterministic
// into its visible text — no clocks, no elapsed times, no animation state that
// survives into innerText, no random ids in text.
//
// The four things that ARE load-bearing, none of them discovered the hard way:
//   1. whitespace collapse   — the ruling's rule: a reflow is not a diff, a
//                              number is.
//   2. innerText not textContent — fingerprints what is VISIBLE, so a hidden
//                              tooltip or aria-only string stays out.
//   3. the double rAF in settle() — networkidle alone is not enough for a built
//                              SPA served from disk: the network goes idle long
//                              before React commits. Preventive, and the one
//                              most likely to have bitten.
//   4. a FIXED instance id and viewport — SetupPage falls back to
//                              randomInstanceId() on an empty field, which would
//                              make every run a different game; a different
//                              window size can cross a responsive breakpoint and
//                              change which elements render at all.
// ============================================================================
const NORMALISE = (raw: string): string => raw
  // Whitespace: a reflow must not be a diff. Every run of space/tab/newline
  // becomes one space. This is the rule the ruling asked for.
  .replace(/\s+/g, ' ')
  .trim();

// RENDER_TEXT_DIR=<dir> keeps the TEXT behind every fingerprint, as <dir>/<hash>.txt.
// A fingerprint says THAT a screen moved and not WHAT moved; with the text kept on
// both sides of an A/B, a moved row is a plain text diff — which is how a prose-
// only change is shown to be prose-only rather than asserted to be. Off by default.
const TEXT_DIR = process.env.RENDER_TEXT_DIR;
if (TEXT_DIR) fs.mkdirSync(TEXT_DIR, { recursive: true });

function hash(s: string): string {
  const h = crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
  if (TEXT_DIR) fs.writeFileSync(path.join(TEXT_DIR, `${h}.txt`), s);
  return h;
}

async function visibleText(page: Page): Promise<string> {
  // innerText rather than textContent: innerText is what is VISIBLE, so a
  // hidden tooltip or an aria-only string does not enter the fingerprint.
  return NORMALISE(await page.locator('body').innerText());
}

async function settle(page: Page): Promise<void> {
  // ⚠ NETWORK-IDLE ALONE IS NOT ENOUGH FOR A BUILT SPA SERVED FROM DISK: the
  // network goes idle long before React has committed. Waiting on the frame's
  // own rendering is what makes a capture reproducible. PREVENTIVE — it was in
  // from the start, so it is not credited with having caught anything.
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

// ⚠ THE SOLO GAME IS AT /solo NOW, NOT AT THE ROOT. The root became the lobby
// when it landed; this harness fingerprints the SOLO game and nothing else, so
// it follows the game rather than the URL. The move was proved inert here: run
// against /solo on the subject and against / on its parent, all 262
// fingerprints are identical, which is what says a route changed and the game
// did not.
const SOLO_URL = `${BASE_URL.replace(/\/+$/, '')}/solo`;

async function startGame(page: Page, cfg: Cfg): Promise<void> {
  await page.goto(SOLO_URL, { waitUntil: 'domcontentloaded' });
  // A previous config's save would restore instead of showing setup.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.getByPlaceholder('Enter a name for your pool...').fill(POOL_NAME);
  await page.getByPlaceholder('e.g. ABC12345').fill(INSTANCE_ID);
  // WC is preselected; toggle to exactly the configuration asked for.
  for (const label of Object.values(LINE_LABEL)) {
    const on = cfg.lines.includes(label);
    const btn = page.locator('button', { hasText: label }).first();
    const checked = await btn.evaluate(el => el.className.includes('ring-1'));
    if (on !== checked) await btn.click();
  }
  await page.getByRole('button', { name: 'Start Simulation' }).click();
  await settle(page);
}

async function capture(page: Page, cfg: Cfg, year: string, out: Record<string, string>): Promise<void> {
  // The header chips travel with every screen, so they are their own row rather
  // than being folded into all eleven.
  out[`${cfg.key}|_header|-|${year}`] = hash(NORMALISE(await page.locator('header').first().innerText()));
  const views = ['Pool', ...cfg.lines];
  for (const tab of TABS) {
    await page.getByRole('button', { name: tab, exact: true }).first().click();
    await settle(page);
    // Present only on tabs App.tsx lists in LINE_VIEW_PAGES; asking the page is
    // what lets this run against a commit with a different list.
    const hasBar = await page.getByRole('button', { name: 'Pool', exact: true }).count() > 0;
    const theseViews = hasBar ? views : ['-'];
    for (const view of theseViews) {
      if (view !== '-') {
        await page.getByRole('button', { name: view, exact: true }).first().click();
        await settle(page);
      }
      const short = view === '-' ? '-' : (view === 'Pool' ? 'Pool'
        : Object.entries(LINE_LABEL).find(([, v]) => v === view)![0]);
      out[`${cfg.key}|${tab}|${short}|${year}`] = hash(await visibleText(page));
      if (tab === 'Departments') await captureDocuments(page, cfg, year, out);
    }
  }
}

// ============================================================================
// ⚠ THE DOCUMENT TABS WERE A HOLE THE SIZE OF FOUR DOCUMENTS, AND THE ROW ABOVE
// COULD NOT SEE IT. DocumentReader opens on ONE document and renders only that
// one's body, so a single capture of the Departments tab fingerprints the
// document LIST plus whichever document happens to be the default. Everything
// else on that page — four of the five documents — was uncovered. It was found
// when ~900 words of player-facing risk-control copy landed and this harness
// reported the Departments rows as unchanged.
//
// ⚠ ALL FIVE ARE CAPTURED, NOT JUST THE ONE THAT PROMPTED THIS. The gap is
// structural — a default selection hides every non-default document — so fixing
// it for the document that exposed it would leave the identical hole for the
// other three and guarantee this is rediscovered. The two generated memos
// (Actuarial, Claims) are the higher-value coverage anyway: they are built from
// engine numbers by buildActuarialMemo/buildClaimsMemo, where the risk-control
// copy is mostly static prose.
//
// ⚠ THE LIST IS DETECTED, NOT LISTED, which is the lesson the line bar already
// taught this file. Hardcoding five titles would make the harness disagree with
// the page the moment a sixth document is added — and it would disagree
// SILENTLY, by capturing five of six. The buttons are DocumentReader's own
// <nav>, and an unbuilt document renders DISABLED, so "locked" is read off the
// control rather than guessed from a title.
//
// ⚠ AND THE EXISTING `-` ROW IS LEFT EXACTLY AS IT WAS. It is captured BEFORE
// any document is selected, so it still fingerprints the page as it OPENS,
// which is itself worth pinning — if the default document ever changes, that
// row moves and says so. The per-document rows are additions. Investment is
// therefore captured twice, once as the default and once by name; that is
// deliberate, not redundancy to tidy away.
// ============================================================================
async function captureDocuments(page: Page, cfg: Cfg, year: string, out: Record<string, string>): Promise<void> {
  // ⚠ THERE ARE TWO <nav>s AND THE OBVIOUS SELECTOR PICKS THE WRONG ONE. The
  // tab bar is a nav of twelve buttons; the document list is a nav of five.
  // `nav button` matches all seventeen, which fails LOUDLY here only by luck —
  // it timed out on an index that existed at count time and not at click time.
  //
  // ⚠ THE DISCRIMINATOR IS THE DOCUMENT LIST'S OWN STRUCTURE, NOT A TAB LABEL.
  // It used to be "the nav that does not carry 'Game Setup'", which assumed the
  // tab bar always carries Game Setup. demo-video (03de3eb) hid it, the selector
  // matched the TAB BAR, clicked tab buttons and timed out on document-body.
  // DocumentReader renders its list and its `document-body` pane as siblings in
  // one grid, and the tab bar sits outside DepartmentsPage entirely — so walking
  // up from the pane, the first ancestor holding a nav holds the list and only
  // the list. Exactly one is required; anything else throws rather than guesses.
  const navs = page.locator('nav');
  const list = await page.getByTestId('document-body').evaluate(pane => {
    const all = [...document.querySelectorAll('nav')];
    for (let a = pane.parentElement; a; a = a.parentElement) {
      const inside = all.filter(n => a.contains(n));
      if (inside.length) return inside.length === 1 ? all.indexOf(inside[0]) : -1;
    }
    return -1;
  });
  if (list < 0) {
    throw new Error('render-identity-check: no single document list <nav> beside document-body on Departments. '
      + 'DocumentReader\'s markup changed — fix the discriminator rather than letting this capture the tab bar.');
  }
  const buttons = navs.nth(list).locator('button');
  const n = await buttons.count();
  // ⚠ WHICH ONE WAS OPEN ON ARRIVAL, READ OFF THE CONTROL. Restoring by
  // clicking the FIRST button was the obvious move and it is wrong: the first
  // document is not the default one, so it would leave a DIFFERENT document
  // selected than the page opens with, and the next visit's `-` row would
  // fingerprint that instead. The selected entry carries bg-blue-50.
  let openAt = -1;
  for (let i = 0; i < n; i++) {
    if ((await buttons.nth(i).getAttribute('class') ?? '').includes('bg-blue-50')) { openAt = i; break; }
  }
  for (let i = 0; i < n; i++) {
    const btn = buttons.nth(i);
    // Read synchronously off the DOM rather than with a locator: a locator
    // WAITS, so a button that does not carry the expected span hangs for the
    // full timeout instead of saying so.
    const title = NORMALISE(await btn.evaluate(el => {
      const t = el.querySelector('span.font-semibold');
      return (t?.textContent ?? el.textContent ?? '').trim();
    }));
    const key = `${cfg.key}|Departments|doc:${title}|${year}`;
    // A document with no content is disabled in the list. Recorded as LOCKED
    // rather than skipped: if one is ever BUILT, this row moves.
    if (!(await btn.isEnabled())) { out[key] = 'LOCKED'; continue; }
    await btn.click();
    await settle(page);
    // ⚠ THE PANE, NOT THE PAGE, AND THE DIFFERENCE IS LOAD-BEARING. A whole-page
    // capture folds the header chips, the tab bar and the document list into
    // every document's row. Measured, that made the INVESTMENT document — whose
    // content is a static .md identical for every pool — produce five different
    // fingerprints across five configurations. Any config-sensitivity in these
    // rows would then be chrome, and the question these rows exist to answer
    // (does the GATED program list differ by configuration?) would be
    // unanswerable from them. Scoped to the pane, Investment is identical across
    // configurations and Risk Control is not, which is the result that means
    // something.
    out[key] = hash(NORMALISE(await page.getByTestId('document-body').innerText()));
  }
  // Leave the tab as it was found, so the next visit's `-` row is the page as
  // it opens rather than whatever this loop last clicked.
  if (openAt >= 0) { await buttons.nth(openAt).click(); await settle(page); }
}

async function run(): Promise<Record<string, string>> {
  const browser: Browser = await chromium.launch({ headless: true, executablePath: EXECUTABLE });
  // A fixed viewport: a different window size reflows the layout, and while
  // whitespace normalisation absorbs that, a responsive breakpoint can change
  // which ELEMENTS render at all.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const out: Record<string, string> = {};
  for (const cfg of CONFIGS) {
    await startGame(page, cfg);
    await capture(page, cfg, 'y0', out);
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: /^Lock Year \d+$/ }).click();
      await settle(page);
      // ⚠ TEN WORLDS (loss engine commit 4b): a line short in ANY world raises
      // the loan prompt, so a year can stop at it. Confirmed at the prompt's own
      // default — every offered loan authorized — which is what a player who
      // clicks through it gets.
      const prompt = page.getByRole('button', { name: 'Confirm & Continue' });
      if (await prompt.count() > 0) { await prompt.click(); await settle(page); }
    }
    await capture(page, cfg, 'y2', out);
  }
  await browser.close();
  return out;
}

const now = await run();
const keys = Object.keys(now).sort();
if (WRITE) {
  fs.writeFileSync(BASELINE, JSON.stringify(Object.fromEntries(keys.map(k => [k, now[k]])), null, 2) + '\n');
  console.log(`Captured ${keys.length} fingerprints -> ${BASELINE}`);
  process.exit(0);
}
if (!fs.existsSync(BASELINE)) {
  console.log(`No baseline at ${BASELINE}. Run with --write to capture ${keys.length} fingerprints.`);
  process.exit(1);
}
const base: Record<string, string> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const all = [...new Set([...Object.keys(base), ...keys])].sort();
const moved = all.filter(k => base[k] !== now[k]);
console.log(`RENDER IDENTITY — ${keys.length} fingerprints, ${CONFIGS.length} configurations\n`);
for (const k of moved) {
  console.log(`  MOVED  ${k.padEnd(46)} ${(base[k] ?? 'absent')} -> ${(now[k] ?? 'absent')}`);
}
console.log('');
if (moved.length === 0) {
  console.log(`ALL ${all.length} FINGERPRINTS IDENTICAL TO BASELINE.`);
} else {
  console.log(`${moved.length} OF ${all.length} FINGERPRINTS MOVED — open the named screens. `
    + `Do NOT re-capture to make this green; see the note at the head of this file.`);
}
process.exitCode = moved.length === 0 ? 0 : 1;
