// VALUE-IDENTITY CHECK — did any simulated VALUE move?
//
//   npx tsx scripts/diagnostics/value-identity-check.ts            # compare
//   npx tsx scripts/diagnostics/value-identity-check.ts --write    # re-capture
//
// ============================================================================
// THE DIVISION OF LABOUR — read before "improving" either gate.
//
// There are TWO export guards and they answer DIFFERENT questions. Neither
// subsumes the other, and collapsing them is the mistake this comment exists
// to prevent.
//
//   THIS SCRIPT (value identity)      solo-export-guard.ts (shape identity)
//   -----------------------------     ------------------------------------
//   "did any VALUE move?"             "did the export SHAPE change?"
//   keyed by FIELD NAME               SHA-256 of the exported CSV
//   order-independent                 order-sensitive
//   label-independent                 label-sensitive
//   new fields are reported,          any new row, renamed label or
//     NOT a failure                     reordering turns it red
//
// A DISPLAY-LAYER FIX should be GREEN here and RED on the hash guard: it
// corrects what is shown without touching what is computed.
// AN ENGINE REGRESSION should be RED here — that is the signal that matters.
//
// This distinction is not theoretical. The expected-combined-ratio fix
// corrected two exported metric values, added one metric and renamed six
// labels. The hash guard went red on all 12 exports, which by its construction
// it HAD to, and that told us nothing about whether the engine had moved.
// This check answered it in one run: 14,400 numeric fields bit-identical, with
// movement confined to the two metrics the fix targeted plus the one it added.
//
// So: THIS is the primary gate for display-layer work. The hash guard is the
// shape check — still valuable, because an unintended column reorder or a
// dropped row is invisible here. Do NOT "fix" a red hash guard by re-hashing
// without first confirming this check is green, and do NOT delete the hash
// guard because this one is stricter about values. They are complementary.
// ============================================================================
//
// Coverage matches the hash guard exactly — same 3 seeds x 4 line
// configurations x 5 years — so the two are directly comparable. Every finite
// numeric field on every line result AND on the pool result is captured, which
// is roughly 14,850 values.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE } from '../../src/data/defaultAssumptions';
import type { CoverageLine, DecisionSet, GameState, LineResultSet, ResultSet } from '../../src/types/simulation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// v6: retired v5 at the per-member RNG stream change plus the deriveSubRng
// finalizer that change proved necessary (finding 26).
//
// Measured for the PER-MEMBER KEYING ALONE, which is the diagnostically useful
// decomposition: 6,404 of 14,850 fields moved across WC-solo/GL-solo/tri, and
// PR-solo moved 0 of 2,970 — Property is not on the claim-generator path, so
// that was the no-leak assertion, and it held. Field count stayed at 14,850
// with 0 added and 0 removed. Within the three moved scopes the ONLY field
// names that did not move are the same 28 structurally invariant ones in each:
// the HELD purePremium/purePremiumPer100 and the rate/CLF figures derived from
// it, decision inputs at defaults, and fields that are constant or identically
// zero (commonLossFactor and catastropheFactor are the legacy aggregate-path
// fields WC and GL no longer read). That is what a TOTAL move looks like — 43%
// of all fields reads as partial until it is partitioned by scope.
//
// The finalizer then moved everything again, Property included, because it
// changes seed derivation for every label. v6 reflected both.
//
// v7: MARKETPLACE-WIDE GENERATION, and it is an ADDITIVE SHAPE CHANGE ONLY —
// 0 of 14,850 values moved. Claims are now generated for all 200 canonical
// members, but per-member stream keying means a prospect's draws come from that
// prospect's own stream and cannot touch an enrolled member's, so every pool
// figure is bit-identical to v6. The only difference is 60 new kLineApplied
// fields. That zero-movement result IS the containment proof for stage 2, on
// top of a 40-seed attribution run showing the enrolled drawn/expected ratio
// unchanged to four decimals.
//
// v8: CLF-ONLY PRICING (decision-surface work). The Rate Change decision was
// deleted and the funding-confidence-level default moved from 0.75 to 0.60 —
// ISOLATED AND CONFIRMED SEPARATELY: with the default temporarily held at its
// old 0.75 value, this check read 0/14,910 changed, so the mechanical
// deletion of the three now-dead rateChange terms (all already zero at
// rateChange=0 defaults) moved nothing on its own. Every one of the 11,051
// changed values at the real 0.60 default was downstream of that one
// deliberate default change, not a side effect of the field removal.
//
// v9: TWO CORRECTIONS TO THE v8 WORK, EACH ISOLATED THE SAME WAY.
//   (1) updateSatisfaction's (fundingConfidenceLevel - 0.75) term went from
//       inert (zero at the old 0.75 default) to live AND BACKWARDS at the new
//       0.60 default — charging members less was making them unhappier.
//       Neutralised to coefficient 0 rather than sign-corrected: the 0.75
//       anchor is now arbitrary, and the whole term is slated for replacement
//       by bill-based satisfaction (Stage 2.5). Isolated with fix (2) held
//       back (CLF still 1.003): 2,302 changed across 71 fields, led by
//       memberSatisfaction itself (150 instances, e.g. 7 -> 7.4 — moving UP,
//       i.e. the wrong-signed drag being removed) and its retention/surplus
//       cascade.
//   (2) FUNDING_CLF_TABLE[0.60] moved from 1.003 to the reference chart's
//       1.000 — the chart is the authority. Isolated with fix (1) held back
//       (satisfaction coefficient still 0.5): 7,256 changed across 76 fields,
//       led by selectedFundingCLF itself (150 instances, 1.003 -> 1) and the
//       entire pricing/premium/reserve cascade at the 60% default.
// Combined (both fixes, the real shipped state): 8,135 changed across 77
// fields — NOT the sum of the two isolated runs (2,302 + 7,256 = 9,558),
// because the two channels interact nonlinearly (satisfaction feeds
// retention feeds exposure feeds premium, which the CLF fix also moves).
//
// v11: EIGHT ENGINE COMMITS, RECAPTURED TOGETHER RATHER THAN AFTER EACH ONE.
// aa0838a (per-occurrence reinsurance tower for WC AND GL) through a08b88e
// (wage inflation on WC's exposure base) — see the recapture commit for the
// full list. This baseline was allowed to go stale across all eight so that
// intermediate work could be isolated against its own parent commit instead
// (worktree + temporary capture script, five times); this is the first
// recapture since v10.
//
// 14,910 -> 16,110 fields (1,200 added, 0 removed): eight new fields
// (aggregateAttachment, aggregatePremium, aggregateRecovery,
// emergedPriorYearLoss, ibnrAccrual, ibnrReserve, retainedAboveTower,
// unreportedClaimCount) from the tower rebuild and the IBNR provision, each
// present on every scope regardless of active line (Property carries them at
// a fixed default — it is still on the legacy aggregate path).
//
// 7,863 of the 14,910 pre-existing fields changed, across 81 field names —
// entirely pricing/loss/reserve/membership cascade fields, nothing
// structural. By config: WC-solo 2,318/3,225 moved, GL-solo 2,045/3,225
// moved, tri 3,500/6,450 moved, PR-solo 0/3,210 moved.
//
// GL-solo moving is NOT a leak: aa0838a explicitly rebuilt GL's reinsurance
// from the old aggregate quota-share model to the same per-occurrence tower
// shape as WC, so GL's attachment/poolLosses/excessLosses/quotaShareLosses/
// netUltimateLoss/reinsuranceCost all changed model, and the resulting rate
// change cascades into memberSatisfaction, averageRiskQuality, activeExposure
// and marketShare through the ordinary retention/pricing feedback loop. The
// other seven commits (3181b18, 19d04e7, b4805bc, d66e8fb, cd154e2, 332cae4,
// a08b88e) touch WC only.
//
// PR-solo staying at 0/3,210 changed (0 added beyond the 240 shared new
// fields) IS the leak check this recapture needed: Property's engine was not
// touched by any of the eight commits, and this baseline proves it.
//
// v12: SIX MORE COMMITS, RECAPTURED TOGETHER: 23da65c, 72ecaa0, 4f695a0,
// 326e275, c1cec1b (GL's own rebuild — fitted-mixture severity, k_GL
// neutralised, severity trend, the $100M cap, GL's own CLF grid) and a21d01b
// (an "Expected" funding option, defaulting BOTH WC and GL to CLF = 1.000 in
// place of a fixed percentile stop). Plus 8c0ae6f, a UI-only squash-merge
// (the Welcome-to-Ripple setup modal) — CONFIRMED GATE-INERT: this script's
// full stdout, diffed byte-for-byte against a21d01b before the merge and
// after, came back empty.
//
// 16,110 -> 16,140 fields (30 added, 0 removed BY THIS TOOL'S COUNT — but
// that undercounts what actually changed shape: 23da65c replaced GL's
// claimCountsBySub (an object) with a scalar claimCount, and this script only
// ever tracks `typeof v === 'number'` fields, so the object-valued field's
// removal is invisible to it. The 30 additions are all one field name,
// claimCount, at 15 instances each in GL-solo and tri (3 seeds x 5 years).
//
// 6,393 of the 16,110 pre-existing fields changed, across 79 field names. By
// config: WC-solo 1,315/3,225 moved (0 new fields), GL-solo 2,155/3,225 moved
// (15 new), tri 2,923/6,450 moved (15 new), PR-solo 0/3,210 moved (0 new).
//
// WC-SOLO'S MOVEMENT IS ATTRIBUTABLE TO EXACTLY ONE MECHANISM — cross-checked
// against solo-export-guard.ts's v12 note, which bisected it directly: WC-solo
// held byte-identical through c1cec1b (the first five of the six commits are
// GL-only) and only started moving at a21d01b, whose sole WC-facing change is
// the fundingAtExpected ternary in simulationEngine.ts's selectedFundingCLF
// dispatch. GL-solo's 2,155/3,225 reflects the CUMULATIVE effect of all five
// GL-only commits plus a21d01b's GL-side default change — not isolated
// per-commit here, since none of the five were recaptured on their own (the
// same "recapture together, not after each" choice v11 made).
//
// PR-solo staying at 0/3,210 changed (0 new fields) IS the leak check this
// recapture needed: none of the six commits, nor the UI squash, touch
// Property.
//
// v13: ONE COMMIT, f5ece4d — moved WC and GL from frozen per-layer
// reinsurance constants to runtime computation of E[ceded] and SD[ceded] from
// the enrolled book and the current year, plus a fix to the WC aggregate's
// occurrence-frequency basis (nominal exposure -> real payroll x
// wcFrequencyTrend). A PRICING-BASIS change: no claim generator, severity,
// frequency or roster parameter moved, so every field that changed did so
// through the reinsuranceCost -> totalMemberCharge -> premium/reserve/
// membership cascade, not through a different loss draw.
//
// 16,140 -> 16,140 fields, 0 added, 0 removed. The six retired constants
// (expectedCededPer100, sdOverExpected, AGG_OCC_FREQ_PER_1M,
// AGG_OVERDISPERSION, WC_RETAINED_SECOND_MOMENT and its bitmask index) were
// all INTERNAL to reinsuranceTower.ts / towerMoments.ts — none was itself an
// exported LineResultSet/ResultSet field, so retiring them could not change
// export shape, only the values downstream of them. Confirmed rather than
// assumed: this scan's own added/removed counts are both zero.
//
// 3,820 of the 16,140 fields changed, across 71 field names. By config:
// WC-solo 953/3,225 moved, GL-solo 1,146/3,240 moved, tri 1,721/6,465 moved,
// PR-solo 0/3,210 moved. Led by reinsuranceCost itself (105 instances, e.g.
// $5,681,786 -> $8,025,186 on one WC line-year) and its cascade into
// totalMemberCharge, ratePer100, the loss/expense/combined ratios, and from
// there into retention, exposure and market share the ordinary way.
//
// PR-solo staying at 0/3,210 (0 new fields) IS the leak check this recapture
// needed: Property runs the legacy REINSURANCE_PROGRAMS path, untouched by
// f5ece4d, and this proves it was not reached.
//
// v14: EIGHT COMMITS — see solo-export-guard.ts's matching v13->v14 note for
// the full per-commit attribution; this note covers only what differs at the
// field-value level.
//
// 16,140 -> 15,540 fields, 0 added, 600 removed: ibnrReserve, ibnrAccrual,
// emergedPriorYearLoss, unreportedClaimCount, all from 962ef60 (WC's report
// lag and IBNR removed). 150 instances each (matching any other fully-
// populated field), NOT a WC-only 30 or 60 — these were LineResultSet fields
// present at 0 on every line ("WC only; 0 on GL and Property, which have no
// report lag", per the old type comment), so they populated every line's own
// scope AND the pool scope, on every config. None of the four was ever in
// RESULT_METRICS (checked against 962ef60^'s resultMetrics.ts — zero
// matches), which is why solo-export-guard's hash of the actual exported
// workbook never saw them and could not have caught this removal on its own;
// this scan's added/removed count is what does.
//
// 10,590 of the 16,140 baseline fields changed, across 78 field names. By
// config (numerator excludes the 4 removed fields; denominator is the v13
// baseline count for that config): WC-solo 2,113/3,225, GL-solo 2,133/3,240,
// PR-solo 2,068/3,210, tri 4,276/6,465.
//
// PR-solo MOVING IS NOT A LEAK — the opposite of the v13 pattern, and
// expected: fdc747c and bdc98ec are membership/pricing machinery shared by
// all three lines (each commit's own message says so, and the mechanism null
// test is the isolation used in place of a line control), and a3d7760's
// opening band applies per line to all three. The other five commits in this
// range (875cb75, fab85e4, f328d65, 3d3fbcc, 962ef60) are confirmed WC/GL-only
// by solo-export-guard's per-commit PR-solo hash check; this scan cannot
// separate their contribution from fdc747c/bdc98ec/a3d7760's inside one
// cumulative diff, which is why the hash guard's per-commit run is the
// isolation tool here, not this one.
//
// v19: retired v18 at the feature/ibner merge. Friedland IBNER replaces reserve
// development on ALL THREE LINES, so 9,120 of 15,300 fields moved and there is
// NO LINE CONTROL in this range for the first time — every previous recapture
// had a line that could not move and served as the leak test. The isolation was
// the MECHANISM NULL TEST instead: make both mechanisms inert and ask whether
// the trees agree. They do, once two non-mechanism channels are removed, and
// the ladder is in the lineage doc.
//
// ⚠ TWO THINGS A READER WILL GET WRONG FROM THE NUMBERS ABOVE THE LINE.
//
// FIRST, "0 added, 0 removed" DOES NOT MEAN THE DATA MODEL HELD. ReserveCohort
// gained five fields and lost `developmentFactor` in this range, and
// ReserveDevelopmentState was deleted outright. Cohorts live on poolState; this
// script walks ResultSet and LineResultSet, and the hash guard is scoped to
// RESULT_METRICS. Neither gate can see a cohort. The shape columns answer a
// narrower question than they look like they answer — fifth occurrence.
//
// SECOND, TWO COMMITS IN THE RANGE READ 0 OF 15,300 AND ARE STILL CORRECT.
// 4fbbb5a raised the booking-bias coefficient 1.6x and a84d854 rewrote the
// unwind schedule; both are invisible here because premiumFundingRatio is a
// hardcoded 1, so bookingBias is 0 on every cohort this gate ever constructs.
// ibner-null-check sections 3 and 4 squeeze funding to each line's reachable
// minimum stop and prove them there. Do not read a green gate as evidence a
// mechanism is inert when the gate cannot reach it.
// v20: retired v19 at the pool-scope aggregation audit.
//
// ⚠ THIS ONE MOVED THIS GATE WHILE BEING DISPLAY-ONLY, AND THAT IS NOT A
// CONTRADICTION — it is what this script captures. It records the POOLED row
// alongside each line, and the pooled row is precisely what was corrected. The
// decomposition is the whole proof:
//
//   37 changed, ALL in `tri`, ALL at `pool` scope, across four field names
//     (activeMembers 15, memberRetentionRate 15, withdrawnMembers 4, newMembers 3)
//   0 at ANY line scope        -> no aggregation feeds the engine
//   0 in WC-solo/GL-solo/PR-solo -> with one active line every aggregation is the
//                                   identity, so a solo pool cannot move unless
//                                   the aggregation itself is broken
//   150 added: enrolmentCount
//
// So "did a VALUE move" needs the scope partition to answer here. A red line
// scope would have meant the engine moved; a red solo config would have meant
// the aggregation broke. Both were green.
// v21: retired v20 across SEVEN commits, and it is the most boring range in this
// file's history — ZERO values moved at any of them. Every commit was diagnostic
// or display: the Calculation Audit page audited row by row, three new checks
// built over it, and every disagreement they found repaired.
//
// The whole range produced ONE shape change, at ebdb147: 300 removed
// (fundingAdequacyRatio and premiumFundingRatio, 150 instances each). FIVE fields
// were deleted there — the other three are STRINGS and this gate captures numbers
// only, so a five-field deletion reads as two here. That asymmetry is a property
// of the instrument, not of the change.
//
// ⚠ AND CLEARING THE PHANTOM IS PART OF THE POINT. That shape change sat in the
// v20 baseline for seven commits, so every run printed a standing "removed 300"
// line while still declaring HOLDS. A permanent informational line is not free:
// it is exactly what trains a reader to skim, and skimming is how the Market
// Share defect survived a release with a guard on it — its failure was sitting in
// a list of legitimately-moving fields. This capture reads 0 added, 0 removed.
//
// ⚠ MEASURED PER COMMIT EVEN THOUGH SIX ROWS WERE PREDICTED TO BE NOTHING, which
// is the case for doing it: a range where every row is expected to be zero is the
// one nobody verifies. All seven were run against the fixed v20 reference (valid
// because nothing in baselines/ and neither guard script changed in range), and
// solo-export-guard was run at every intermediate commit too — 84 hashes, all
// matching.
// v22: THE FIRST RANGE SINCE v11 IN WHICH THE ENGINE ITSELF MOVED, and it moved
// on every line at once. Reserve development now lands on CLAIMS and cedes
// through the occurrence tower, so 6,577 of 14,400 values changed across 74
// fields and all 12 export hashes differ. There is NO LINE CONTROL — the
// mechanism reaches WC, GL and Property identically — so the null test is the
// MECHANISM SWITCH: DEVELOPMENT_CESSION_ENABLED = false reproduces v21
// bit-for-bit, 0 values changed, 12/12 hashes matching.
//
// ⚠ TWO SHAPE ADDITIONS, BOTH MEMO FIELDS: priorYearDevelopmentCeded (what the
// tower absorbed of prior-year development) and bookingGiveBack (the recovery
// forfeited by booking the claim register low). NEITHER MAY BE ADDED TO INCOME —
// netUltimateLoss is already net of the first and priorYearDevelopment of the
// second, exactly as reinsuranceRecovery has always worked.
//
// ⚠ AND ONE SHAPE CHANGE THIS GATE CANNOT SEE. 1e05a55 added the
// reserveDevelopment ledger, which lives on LinePoolState rather than ResultSet,
// so it is invisible here — the sixth time this instrument's scope has mattered.
// It is a recording, not a value: 0 changed at that commit.
// v23: NO VALUE MOVED. The capture DOUBLED, from 14,400 fields to 28,800, because
// this gate gained a SQUEEZED ARM — see THE ARMS below. Every v22 key reappears
// under a `def|` prefix with a bit-identical value; everything new is `sqz|`.
//
// ⚠ THE ARM AND ITS BASELINE HAD TO LAND TOGETHER, and the laundering risk that
// normally argues against that is controlled a different way here. A recapture
// blesses whatever is in the tree, so the discipline is to separate the
// instrument change from the capture — but an arm with no baseline is a gate
// that cannot run, so there was nothing to separate them into. Instead the
// defaults half was diffed against v22 key-for-key BEFORE this file was written:
// 14,400 keys, 14,400 matched, 0 changed. The new content is a new arm on an
// unchanged tree, and that is checkable rather than asserted.
// v24: NOTHING MOVED HERE AT ALL. The recapture exists only so this file and
// SOLO_EXPORT_GUARD stay on the same version number — the export gained three
// columns and renamed two labels, which moved all 24 hashes and 0 of these
// 28,800 values. Captured and diffed key-for-key against v23: 28,800 keys,
// 28,800 matched, 0 changed.
// v25: SHAPE ONLY. shockLossAmount removed — 300 keys (150 instances x 2 arms),
// 0 values changed. It was `shockOccurred && !isClaimLine`, structurally false
// since Property got its claim generator, and this gate had it on the bit-exact
// list under BOTH arms — which is the report shape that says "structurally dead"
// rather than "inactive in this configuration". bookingGiveBack, zero in `def`
// and live in `sqz`, is the contrast the per-arm split exists to draw.
// v30: THE DEVELOPING SUBSET NOW FOLLOWS CLOSURE — 11,748 of 29,400 changed
// across 72 fields, 0 added, 0 removed.
//
// ⚠ AND THIS ONE HAS A REAL CONTROL, WHICH NO CAPTURE SINCE sizeWeighted HAS
// HAD. The standing caveat is that a selection change spends RNG and reseeds the
// `ibner` stream, so a line-by-line diff cannot separate mechanism from reseed.
// It does not apply here: the reselection draws were routed onto their own
// streams keyed on (seed, valuation year, line, accident year, purpose), and
// `ibner` still takes exactly ten developing-set picks at inception in the same order.
//
// So the control is CLOSURE FORCED OFF rather than the mechanism switch. With
// `isClosed` stubbed to `() => false`, reselection is a no-op that spends no
// draw, and the mechanism-ON tree is BIT-IDENTICAL to v29: 29,400 fields, 0
// added, 0 removed, 0 differing. Every one of the 11,748 moved values is
// therefore closure driving reselection and nothing else. The mechanism-off
// before-and-after was run too and is also 0 differing.
// v31: the developing set is sized to hold its own movement, the spill stops
// landing on settled claims, and "carrier" is gone. 9,367 of 29,400 changed
// across 37 fields, 0 added, 0 removed.
//
// ⚠ THREE CAUSES IN ONE CAPTURE, AND THEY WERE MEASURED SEPARATELY AS THEY WENT
// IN, because a recapture blesses whatever is in the tree:
//   the RENAME moved values, which is not obvious — the reselection stream is
//     keyed on a purpose string and `carriers` became `developing`, so that
//     stream re-rolls. Sign-symmetry: WC 1.07x -> 1.06x, GL and Property
//     unchanged.
//   the SPILL EXCLUDING CLOSED OCCURRENCES is the behavioural fix. Property
//     0.88x -> 1.07x, WC and GL within 0.01x.
//   the SIZING RULE moved set sizes (11-16 against a floor of 10 on 1.06% of
//     developing cohort-valuations) and moved no ratio and no cession level:
//     WC 51.0%/51.0%, GL 60.2%/60.2%, Property 14.2%/14.2% before and after.
//
// The mechanism-off before-and-after reads 29,400 fields, 0 differing, so
// nothing outside the mechanism moved. v30's closure-forced-off control is NOT
// available here and would not be meaningful: the sizing rule does not depend on
// closure, so stubbing the predicate no longer reduces the commit to a no-op.
// v32: the developing set is DRAWN FRESH at every valuation instead of
// persisting between them — 8,413 of 29,400 changed across 37 fields, 0 added,
// 0 removed.
//
// ⚠ THE CLOSURE-FORCED-OFF CONTROL FROM v30 NO LONGER ISOLATES, and saying so is
// the point of this note. It worked because reselection was a no-op when nothing
// closed; a set that redraws every valuation redraws whether or not anything
// closed, so stubbing the closure predicate leaves the mechanism running. What
// survives is the mechanism switch: DEVELOPMENT_CESSION_ENABLED = false,
// parent vs child, reads 29,400 fields and 0 differing.
// v33: GL's occurrence id became per-member. The id feeds isClaimClosed, closure
// feeds reselectDevelopingSet, and 38 fields moved down the development ->
// cession -> reserve -> surplus chain. No GL claim AMOUNT moved; established
// three ways, recorded in the lineage.
// v34: STARTING_CAPITAL_TO_PREMIUM re-centred — 17,785 of 29,400 changed across
// 77 fields, 0 added, 0 removed. THIS ONE IS A WHOLE-TREE RE-ROLL AND THE FIELD
// LIST SHOULD BE READ AS ONE. The pre-game is a reject-and-redraw search on
// (seed + attempt x 997); moving the pin moves which attempt is accepted, so a
// different past is simulated, a different roster enrols, and every draw-side
// quantity re-rolls with it — activeMembers 59 -> 58, claimCount 43 -> 24.
// There is no subset of this diff to attribute, and a field-by-field reading of
// it would be reading noise.
//
// ⚠ SO THE ATTRIBUTION IS THE SEPARATION, NOT THE DIFF. dbcfed7 was measured
// alone first: it adds rcEffectivenessApplied (180 fields, the +180 in this
// capture's SHAPE line) and moves 0 of 29,400 values. Every one of the 17,785 is
// therefore the pin. What the pin change is FOR is asserted by
// opening-centring-check, which measures the unfiltered candidate median against
// the band midpoint directly and can fail; this capture only records that the
// tree moved, which for a re-roll is the one thing it can honestly say.
// v35: THE LOSS-RATIO BASIS FIX, AND THIS CAPTURE IS THE EVIDENCE IT STAYED IN
// THE DISPLAY LAYER. 600 fields ADDED (actualLossRatioPricingBasis and
// actualLossRatioRetainedPremium, 2 x 150 instances x 2 configurations), 0
// removed, and 0 of the 29,580 pre-existing values changed. That last number is
// the point of recapturing here rather than arguing: the change adds two
// derived quotients of dollar figures that already existed, so if any loss,
// premium, reserve or surplus figure had moved, it would have reached the
// engine and that would have been the finding instead. It did not.
//
// ⚠ CONTRAST v33 AND v34 DELIBERATELY. Both were whole-tree re-rolls where no
// field-by-field reading was possible. This one is the opposite shape — a pure
// addition — and a capture that shows 0 changed values is a STRONGER statement
// than one that shows a plausible-looking subset moved.
// v36: THE PER-CLAIM FLIP. PER_CLAIM_REVISION.enabled false -> true. A WHOLE-TREE
// RE-ROLL and there is no field-by-field reading to be had: 15,840 of 30,180
// values moved across 79 fields, 0 added, 0 removed.
//
// ⚠ THE RE-ROLL IS NOT THE MECHANISM AND THE DISTINCTION IS MEASURABLE. The flag
// alone does not shift the RNG stream — `factor` is drawn in both arms whether or
// not the enabled arm uses it, which was deliberate at 42b2c2b. What re-rolls
// every game is that the PRE-GAME ACCEPTANCE SEARCH takes a different number of
// attempts on the two arms (measured at the flip: WC mean 2.93 -> 2.70, GL 3.06
// -> 3.05, Property 3.97 -> 4.12), and each rejected candidate past consumes
// draws. So the tree moves for two reasons at once and this capture cannot
// separate them.
//
// WHAT IS ASSERTED INSTEAD, because a re-roll capture cannot carry it: the shape
// of the flip was measured paired, same seeds both arms, 300 games x 10 years —
// ending pool surplus 0.9886x, insolvency 5.3% on BOTH arms, net unpaid reserve
// within 1% on every line, actual loss ratio within 0.5pp on every line and
// basis. The mechanism's own correctness is held by cohort-ledger-check (three
// identities, both arms), martingale-equivalence-check (term by term) and
// terminal-severity-check (phi on its anchor), all green at this commit.
// v48: WC'S OPENING SURPLUS BAND RE-TRANSLATED ONTO ITS CURRENT J (0.3294 ->
// 0.4730) AND ITS PIN RE-SOLVED WITH IT (0.3254 -> 0.4718). 2,084 of 31,200
// fields moved across 19 fields, 0 added, 0 removed.
//
// ⚠ THE CONFINEMENT IS THE POINT AND IT IS READABLE OFF THE FIELD LIST ALONE.
// Every one of the 19 is on the capital/investment chain: endingSurplus,
// availableSurplus, availableFunding, beginingSurplus, surplusFromIncome, the
// four funding-gap aliases (fundingGap, capitalFundingGap,
// excessAvailableSurplus and its ratio), excessCapitalRatio,
// capitalAdequacyRatio, beginning/endingInvestments, investedAssets,
// totalAssets, investmentIncome, netIncome. NO loss, premium, reserve, rate or
// membership field moved. That is what a starting-capital change must look
// like: the pin adds surplus, surplus is the invested base, investment income
// follows — and nothing reaches the underwriting side.
//
// THREE OF THE 19 MOVE IN THEIR LAST BITS ONLY and are not a value change:
// surplusTieOutDifference (-3.7e-9 -> -1.9e-9), beginningCash (...422 -> ...424)
// and investmentReturnRate (...695 -> ...6947). Those are re-association at a
// different magnitude, not arithmetic that decided anything.
//
// A REPRESENTATIVE ROW, and the defect being fixed: excessCapitalRatio
// -0.2100 -> +0.1166 — Deficient to Adequate. WC opened at 0.570..0.827 of its
// own required margin on 100 of 100 seeds and now opens 0.813..1.188.
//
// ⚠ THE LEAK CHECK IS SOLO_EXPORT_GUARD v48'S, NOT THIS FILE'S, and it is the
// stronger statement: all 6 GL-solo and all 6 PR-solo exports are BYTE-IDENTICAL
// while all 6 WC-solo and all 6 tri moved. This baseline is pool-level and
// cannot separate the lines that way, so read the two notes together — the same
// pairing v46 and v47 record.
//
// v47: GL'S TRIANGLE CONTRACTION RE-SOLVED, A 2.156982 -> 2.295852 (+6.44%), to
// close a 6% mean-preservation failure — a claim developed to its terminal was
// averaging 0.9395 of the value drawn. 8,260 of 31,200 fields moved across 78
// fields, 0 added, 0 removed.
//
// ⚠ IT IS A REPRICING, NOT A RESERVE CORRECTION, AND THAT WAS ESTABLISHED BY
// PERTURBATION BEFORE SOLVING ANYTHING. GL's rate reads the pool's own played
// paid triangle (currentPurePremiumPer100's ExperienceBasis — the S3 path), so
// the contraction feeds the rate. poolPremium and purePremiumPer100 are in the
// moved list for that reason, not as a side effect of reserves. Measured:
// GL booked reserve +9.14%, GL premium +8.39%, ending surplus +0.22%.
//
// ⚠ AND THE MOVE IS CONFINED TO GL. solo-export-guard moved GL-solo 6 of 6 and
// tri 6 of 6, with WC-SOLO AND PR-SOLO BYTE-IDENTICAL — the mirror image of
// v46, where WC moved and GL did not. Two commits in a row where the export
// split is what proves the scope claim rather than an argument for it.
//
// v46: WC'S AGGREGATE LOSS VOLATILITY RAISED TO 0.30 ON THE CALENDAR BASIS, via
// a shared year factor (WC_LOSS_MODEL.wcYearFactor, Gamma shape 6.28, mean
// exactly 1) multiplying every WC member's arrival rate. 8,796 of 31,200 fields
// moved across 77 fields, 0 added, 0 removed.
//
// ⚠ THE MEAN DID NOT MOVE AND THAT IS ASSERTED, NOT ASSUMED. wc-cutover-check
// perturbs the factor's shape by 4x and requires expectedWcGrossLossForPricing
// to come back BIT-IDENTICAL, which it does at 48608807.629813. So no held pure
// premium, held class rate or k_line re-derives, and every field that moved here
// moved through VARIANCE rather than through level.
//
// WHAT MOVED, and it is three distinct channels rather than one:
//   1. the losses themselves, year to year, which is the point;
//   2. the reinsurance risk load — WC's layer SD/E gained a floor at
//      sqrt(1/6.28) = 0.399, HIGHER than GL's 0.200, so towerMoments prices WC's
//      tower differently. This is the only place the change touches a price;
//   3. SATISFACTION.surplusComfortable 0.0258 -> 0.1385 and surplusWeight
//      0.0344 -> 0.0516, re-solved because excessCapitalRatio's denominator
//      moved again. Second consecutive commit in which those two re-solve.
//
// ⚠ AND THE OPENING PIN DID NOT MOVE, WHICH IS THE INTERESTING ONE.
// opening-centring-check went red on WC at 1.7 SE and the pin is correct:
// measured at 2,400 seeds the shipped 0.3254 sits 0.18 SE off its band
// midpoint. The gate's sample was too small for its own tolerance and has been
// raised 400 -> 1,600; STARTING_CAPITAL_TO_PREMIUM is untouched. See that file.
//
// v45: WC TOOK A SUPPLIED CLF CURVE, AND THE SURPLUS LIMB WAS RE-SOLVED BEHIND
// IT. WC now prices off a real public-entity pool's measured percentile curve
// over 45-95, extended down to 10 on a fitted lognormal; WC_DERIVED is retained
// out of force as GL_DERIVED is.
//
// ⚠ THIS CAPTURE IS LARGER THAN v44'S AND THE REASON IS NOT THE FUNDING SLIDER.
// v44 moved only 3,948 of 31,200 fields because at all-defaults
// fundingAtExpected pins selectedFundingCLF to 1.000 and the table is never
// consulted. That still holds — ending surplus at Expected is BIT-IDENTICAL
// across this swap, checksum 3316958079.914983 over 40 games. What moves the
// extra fields is the OTHER reader: reserveMarginCLF is staticClf(line, 0.90),
// WC's 90% stop went 1.3120 -> 1.4730, and reserveRiskMarginNeeded =
// expectedNetUnpaidLoss x (reserveMarginCLF - 1) rose about 52% on WC. That is a
// default-game quantity, so it moves whether or not anyone touches the slider.
//
// ⚠ AND IT REACHED SATISFACTION. excessCapitalRatio has reserveRiskMarginNeeded
// as its denominator, so WC's median fell 0.1831 -> -0.2196 and the pooled
// median 0.2399 -> 0.0258. SATISFACTION.surplusComfortable and surplusWeight
// were re-solved to 0.0258 and 0.0344 in the same commit, because leaving them
// put member-satisfaction-check red on its own 25% cancellation bound at 31.6%.
// Those fields move here too. A CLF table reached a satisfaction constant
// through the reserve margin, in one commit, with no edit to either file.
//
// v44: WC'S CLF TABLE RE-DERIVED AT THE SMALL BAND. The shipped default writes
// no new business on a frozen pre-game roster, so a player who touches nothing
// plays a book frozen at ~62 — and WC's table was derived at 72-88. It is now
// derived on 6,371 line-years of the small band across 2,000 games and FIVE
// appetite arms, the fifth being the shipped default.
//
// 0 added, 0 removed, and only 3,948 of 31,200 moved across 63 fields — THE
// SMALLEST CAPTURE IN THIS FILE'S RECENT HISTORY, against 21,481 at v43 and
// 22,559 at v42.
//
// ⚠ AND THE SMALLNESS IS THE STRUCTURAL PROPERTY CONFIRMING ITSELF, NOT A WEAK
// CHANGE. At all-defaults fundingAtExpected is TRUE, which pins selectedFundingCLF
// to exactly 1.000, so the table is NEVER CONSULTED in a default game. The moved
// fields are the ones that read it — fundingGap and capitalFundingGap lead the
// list. A table re-derivation that moved the default game's own losses or
// membership would mean the table had reached somewhere it must not.
//
// ⚠ ENDING SURPLUS OFF EXPECTED IS THE SAME NUMBER BEFORE AND AFTER. Measured,
// 150 games x 10 years, full pool: Expected $83.435M on both arms, bit-identical.
// At the 75% stop it goes $177.280M -> $182.198M, +$4.918M (+2.8%) — a GAIN in
// funding rather than a cost, because the small-band curve is heavier (the 75%
// stop moves 1.1373 -> 1.1716).
//
// THE COST OF THE RULING IS IN THE LABEL, NOT THE SURPLUS, and it is recorded at
// WC_DERIVED: small -8.7 -> -3.1pp, mid +4.3 -> +9.3pp, large +13.0 -> +18.4pp.
// WC goes from one band outside tolerance to two.
//
// v43: NO NEW BUSINESS AS THE DEFAULT APPETITE. One capture for a sequence of
// four commits, and it MIXES EXACTLY ONE ENGINE CHANGE WITH THREE THAT MOVE
// NOTHING — which is why the capture is taken once at the end rather than after
// each.
//
//   dab4d62  save-round-trip-check's positive controls made deterministic
//            DIAGNOSTIC ONLY. No engine file. Cannot move a value.
//   81e68da  newBusinessAppetite defaults to NO_NEW_BUSINESS
//            THE ONLY COMMIT IN THIS CAPTURE THAT MOVES A NUMBER.
//   9c5e18d  the CLF re-derivation measured and declined
//            TWO RECORDS — clfTables.ts and gates.ts. No table moved, so no
//            value could.
//   this one recapture
//
// 0 added, 0 removed, 21,481 of 31,200 moved across 80 fields. activeMembers
// 71 -> 65 and newMembers 6 -> 0 in the first instance: intake stopped.
//
// ⚠ AND THE OPENING BOOK DID NOT MOVE, WHICH IS THE POINT OF THE CAPTURE RATHER
// THAN AN ASIDE. The pre-game runs at these same defaults, so before the roster
// was frozen structurally at v42 this would have changed the opening and
// therefore the pin. Measured against the parent on the same seeds: WC 63.9,
// GL 62.4, Property 64.4, member ids identical, and opening-centring-check
// unchanged at -0.6 / -0.7 / +0.1 SE. Every moved field below is a PLAYED year.
//
// ⚠ A CORRECTION TO v42'S OWN RECORD. That note states the opening book as
// 60.3 / 56.8 / 67.8. Those were measured BEFORE the pin was re-solved inside
// that same commit and were never re-taken; the shipped figures have always been
// 63.9 / 62.4 / 64.4. The error was reporting a mid-commit measurement as if it
// described the commit. Corrected here rather than edited there, so the mistake
// stays visible.
//
// THE LEAK CHECK: 0 added, 0 removed, every absolute identity bit-exact, no
// suspected partial identity.
//
// v42: THE PRE-GAME ROSTER IS FROZEN, AND THE PIN WAS RE-SOLVED ON ALL THREE
// LINES BEHIND IT. The pre-game no longer moves membership: no joins, no
// departures, no declines, so the year-1 book IS the starting enrolment
// generateStartingPoolState drew — verified member for member, 8 games x 3
// lines, every id identical.
//
// 0 added, 0 removed, 22,559 of 31,200 moved across 80 fields. activeMembers
// 131 -> 71 in the first instance: v41's ten pre-game years of intake with no
// outflow are gone.
//
// ⚠ THIS CAPTURE CARRIES TWO CHANGES AND THEY ARE NOT SEPARABLE, WHICH IS
// STATED RATHER THAN GLOSSED. Freezing the roster moves the opening book, which
// moves the reserve and the premium the opening surplus is measured against,
// which puts STARTING_CAPITAL_TO_PREMIUM out of centre on all three lines —
// opening-centring-check read -6.1 / -6.3 / +4.0 SE. The pin HAD to be
// re-solved in the same commit or the gate could not pass, so no arm isolates
// the freeze from the re-solve. The freeze is the cause and the re-solve is its
// consequence; a reader wanting them apart would have to re-run with the old
// pins, and the numbers to do that are in the constant's own record.
//
// ⚠ AND THIS COMMIT TURNS THREE OF v41's FIVE UNEXPECTED REDS GREEN, WHICH IS
// THE REASON THE TWO SIT TOGETHER. v41's sweep read 58/68: save-size-check
// (a doubled book doubles the save), market-conditions-check,
// marketplace-generation-check, opening-centring-check and pin-vs-band-check.
// The first three are fixed by the freeze alone; the last two needed the pin.
//
// THE LEAK CHECK: 0 added, 0 removed, every absolute identity bit-exact, no
// suspected partial identity — on a change that moved 72% of the fields.
//
// v41: VOLUNTARY DEPARTURES SWITCHED OFF. VOLUNTARY_DEPARTURES_ENABLED = false,
// so the only way out of the pool is a renewal decline. The count that was
// suspended was book x (1 - retentionProb), and retentionProb is BASE_RETENTION
// = 0.95 — a constant from the root commit that has never been derived in this
// repository. See the constant's own record for why an undeclared number could
// not be left setting the book's trajectory once No New Business is a default.
//
// 0 fields added, 0 removed, 23,243 of 31,200 moved across 82 fields. That is
// the largest capture in this file's history — half again the pin re-solve's
// 14,744 — and the reason is that it moves the OPENING BOOK, not just the
// played years.
//
// ⚠ THE PRE-GAME IS WHY IT IS THIS BIG. priorHistoryEngine plays PRE_GAME_DEPTH
// = 10 years through the same processYear, so ten years of intake now run with
// no outflow before the player sees year 1. activeMembers 62 -> 131 in the first
// instance is that: the game does not start where it used to start.
//
// ⚠ AND THE CONFINEMENT IS CHECKABLE THE SAME WAY v40's WAS.
// VOLUNTARY_DEPARTURES_ENABLED is read in exactly ONE place in src/:
//
//   membershipEngine.ts   the slice count in simulateMemberMovement
//
// Nothing else reads it. Every moved value is downstream of a different
// enrolled book, and there is no second channel.
//
// ⚠ THE DRAWS ARE RETAINED, WHICH IS WHY "DIFFERENT BOOK" IS THE WHOLE STORY
// AND NOT HALF OF IT. Both draw sites still run — the count multiplier
// rng.range(0.4, 1.6) and departureRisks' one draw per member — so the
// membership stream is not re-phased and no value moved because a draw landed
// somewhere new. Guarding the draw instead of the slice would have made this
// capture uninterpretable.
//
// THE LEAK CHECK: 0 added and 0 removed, all 38 absolute identities bit-exact
// on every instance (including sqz|declinedMembers = 0 and
// sqz|retainedAboveTower = 0), and no suspected partial identity. A change that
// moved three-quarters of the fields introduced no new one and retired none.
//
// ⚠ ratePer100 5.2289 -> 4.6435, AND THAT FALL IS THE FINDING TO CARRY FORWARD.
// A book roughly twice the size spreads the tower and admin over twice the
// exposure, so the rate drops about 11%. clfTables.ts is derived at the band
// containing each line's median book and says to re-derive if the membership
// trajectory moves materially — it has, and by more than the band is wide.
//
// v40: STARTING_CAPITAL_TO_PREMIUM RE-SOLVED — WC 0.3250 -> 0.2503, GL 0.2062 ->
// 0.1418. Property untouched. opening-centring-check had gone red on WC and GL:
// the unfiltered candidate median sat +0.101 and +0.105 off its band midpoint,
// 9.4 and 6.1 standard errors, against +0.015 / -0.003 / +0.022 when the pin was
// last solved.
//
// 0 fields added, 0 removed, 14,744 of 31,200 moved — far more than the CLF
// re-derivation's 7,566, and on a much wider set of fields.
//
// ⚠ EVERYTHING MOVED, AND THAT IS THE CORRECT OUTCOME RATHER THAN A LEAK. Losses,
// claim counts, exposure, premium, membership and every ratio built on them are
// all in the moved list. The reason is that the pin does not adjust a surplus
// number on an otherwise fixed opening: it changes which pre-game ATTEMPT the
// band accepts, and a different accepted attempt is a different pre-game history
// — a different enrolled roster carried through the maturation years, different
// claims, different reserves. activeMembers 73 -> 62 in the first instance is
// that, not a membership change.
//
// ⚠ THE CONFINEMENT IS STRUCTURAL AND CHECKABLE BY GREP, which is the only
// argument worth making when this much moves. STARTING_CAPITAL_TO_PREMIUM is read
// in exactly TWO places in src/, and both construct the OPENING POSITION:
//
//   instanceGenerator.ts:547   targetSurplus for the seeded opening state
//   priorHistoryEngine.ts:247  targetSurplus inside the pre-game search
//
// simulationEngine.ts never reads it. No played-year path can see the constant;
// the played years see only the pre-game's OUTPUT. So every moved value is
// downstream of a different opening, and there is no second channel for it to
// have reached them by.
//
// investmentReturnRate moves on 25 instances at the sixteenth decimal
// (0.0997962961556695 -> 0.09979629615566948) — summation magnitude, same draw,
// the same signature recorded at v38 and v39.
//
// v39: THE CLF TABLES WERE RE-DERIVED ONTO THE NEW MEMBERSHIP TRAJECTORY.
// WC_DERIVED, GL_DERIVED and PROPERTY_DERIVED are re-measured at the book band
// containing each line's own median book — WC and GL at 72-88, Property at 88+.
// GL_SUPPLIED, which is the curve GL actually prices off, is untouched.
//
// 0 fields added, 0 removed, 7,566 of 31,200 moved.
//
// ⚠ THE MOVEMENT SPLITS EXACTLY ALONG THE TWO ARMS, AND THAT IS THE WHOLE
// CONFINEMENT ARGUMENT. Counted from the two baselines directly:
//
//     def   735 values, and SEVEN field names, nothing else
//     sqz 6,831 values
//
// The seven are reserveRiskMarginNeeded, fundingMarginNeeded, fundingGap,
// capitalFundingGap, excessAvailableSurplus, excessCapitalRatio and
// capitalAdequacyRatio — 105 instances each. Every one is the same quantity or a
// ratio built on it: simulationEngine reads staticClf(line, 0.90) on EVERY run to
// size the reserve risk margin, so a re-derived 90th stop moves it whatever the
// player decides. AT DEFAULTS NOT ONE DOLLAR OF PREMIUM, LOSS, SURPLUS, CASH,
// RESERVE OR MEMBERSHIP MOVES, which is the direct evidence that the margin is a
// DISCLOSURE figure and not a charge — endingSurplus is computed independently of
// it (availableSurplus = endingSurplus, not the reverse). The margin moved by
// exactly the factor ratio: 7958396.25 -> 6706893.74 is 0.8428, against WC's
// 0.2776/0.3294 = 0.8427.
//
// The sqz arm is where the PRICING channel lives, because that is the only arm
// with fundingAtExpected off — at defaults the CLF is pinned to 1.000 and the
// table is never consulted for price at all. selectedFundingCLF 0.6698 -> 0.7913
// on WC is the change itself; poolPremium, surplus, reserves and every ratio
// follow from it. activeMembers, withdrawnMembers and memberRetentionRate move
// there too (35 / 21 / 32 instances) and that is EXPECTED rather than a leak:
// membership responds to price, so a different premium is a different book. They
// do NOT move in the def arm, where the premium is identical, which is the
// control that makes the sqz-arm movement readable.
//
// investmentReturnRate moves on 12 instances at the sixteenth decimal
// (0.06703899471230997 -> 0.06703899471230995) — summation magnitude, same draw,
// the same signature recorded at v38.
//
// v38: THE MEMBERSHIP TARGET CAME OUT, AND THE BOOK IS NOW AN OUTCOME.
// MEMBERSHIP_EQUILIBRIUM_ENROLLMENT, its two calibration constants, and both
// movement caps are deleted. Intake is no longer a demand term steered toward a
// level — it is a share of the unenrolled marketplace, filtered by the appetite
// bar, written up to a capacity guard. Departures are proportional and uncapped.
//
// 540 fields ADDED (applicants / eligibleApplicants / intakeRoom, 3 x 180),
// 0 removed, and 75 fields moved.
//
// ⚠ THE MOVEMENT IS CONFINED TO ONE CHANNEL AND IT IS CHECKABLE, WHICH IS WHY
// THIS CAPTURE IS NOT A WHOLE-TREE RE-ROLL LIKE v36. The rng handed to
// simulateMemberMovement is deriveSubRng(seed, year, 'members|<line>') — its own
// stream, one consumer — so adding or removing a draw there cannot re-phase any
// other stream. Every one of the 75 moved fields traces to a DIFFERENT BOOK:
// activeMembers 49 -> 73 in the first instance, and exposure, premium, expense,
// losses and every ratio built on them follow from it.
//
// ⚠ THE ONE FIELD THAT LOOKED LIKE AN INDEPENDENT DRAW WAS CHECKED RATHER THAN
// ASSUMED. investmentReturnRate appears in the moved list, which would mean the
// market draw had shifted. It moved on 32 of 300 instances, by
// 0.09979629615566948 -> 0.0997962961556695 — the sixteenth decimal place. Same
// draw, different summation magnitude. Nothing else in the list is independent
// of the enrolled book.

// v37: THE DEPARTURE REBUILD. Who LEAVES the pool changed basis entirely —
// from `satisfaction + 0.3 x riskQuality` ascending to a price-shock x
// marketability model with fresh annual noise, sorted descending. Different
// members leave, so a different book is enrolled every year from year 1, and
// everything downstream of the roster moves with it: 22,174 values across 79
// fields, 0 added, 0 removed.
//
// ⚠ THERE IS NO NULL ARM THAT REPRODUCES v36, AND THAT IS A PROPERTY OF THE
// CHANGE RATHER THAN A GAP IN THE TESTING. Setting DEPARTURE.priceWeight to 0
// removes the economic term but leaves the fresh annual noise, which is
// itself a stream change against a draw frozen at enrolment. The old key
// cannot be recovered by any constant because the model it belonged to is
// gone. So this capture is justified by CONFINEMENT rather than by a null.
//
// CONFINEMENT, CHECKED: every one of the 79 changed fields is downstream of
// the enrolled roster — exposure, premium, losses, reserves, capital, the
// ratios, and the membership counts themselves. Nothing that should be
// roster-INDEPENDENT moved: no held pure premium, no class rate, no CLF
// table, no reinsurance term. And 0 values are NaN or Infinity, which is the
// check that catches a roster change that quietly divided by an empty book.
//
// ⚠ READ WITH solo-export-guard v37, WHICH MOVED FOR THE SAME REASON. Neither
// capture is sufficient alone here: the hash guard cannot tell "different
// members enrolled" from "the arithmetic broke", and this one says the
// changed set is exactly the set a roster change explains.
// ⚠ v49 -> v50: THE PROPERTY MERGE. Both branches moved this capture, so it
// could not be merged and was recaptured. WHAT IT COST AND WHAT IT BOUGHT:
//   added   1200  poolLayerLoss, poolLayerLossRatio, retainedCoverMargin,
//                 totalLossRatioGross — the flat charge and the ratio pair.
//   removed  300  catastropheFactor, deleted outright by the other branch
//                 because it read 1.0000 on every line in every year.
//   changed 8754  across 79 fields — Property's frequency and severity
//                 recalibration and everything downstream of it.
//
// ⚠ AND CONFINEMENT SURVIVED, WHICH IS WHY THIS RECAPTURE IS NOT A BLANK
// CHEQUE. A merge that moved every line somewhere cannot be checked the usual
// way, so the old capture was diffed against the new one PER CONFIGURATION
// before it was replaced:
//     WC-solo     0 of 5970 values moved — bit-identical
//     GL-solo     0 of 6000 values moved — bit-identical
//     PR-solo  4188 of 6000 moved (69.8%)
//     tri      4566 of 12570 moved (36.3%)
// Property's recalibration is therefore EXACTLY confined to Property. Inside
// the three-line configuration WC moves in 17 fields and GL in 18, and every
// one of them is a CAPITAL quantity — beginningCash, availableSurplus,
// investedAssets, investmentIncome, endingSurplus, totalAssets. Not one loss,
// premium, rate, claim count, cession or reserve field moves on either line.
// The lines share one balance sheet, so a bigger Property book moves the cash
// every line is funded out of; that coupling is the design, and its absence
// from the underwriting fields is the evidence nothing leaked.
// ⚠ v50 -> v51: THE INVESTMENT RETURN CUT, AND THE CAPTURE IS LARGER THAN THE
// CHANGE. INVESTMENT_RETURN_SCALE takes every asset class's mean to two-thirds,
// so investment income and everything downstream of it moves by construction —
// that part is the point. What needs explaining is why CHARGES AND RATES MOVED
// TOO, because the rate does not reach pricing and the capture looks as though
// it does.
//
//   added   180  programSeverityApplied — INHERITED from aada492, not this
//                change; it was already pending against v50.
//   changed      82 field names, including totalMemberCharge (180 instances),
//                poolPremium (180) and ratePer100 (100).
//
// ⚠ THE RATE REACHES THE PRE-GAME ACCEPTANCE SEARCH, NOT PRICING, AND THE
// DIFFERENCE IS MEASURABLE RATHER THAN RHETORICAL. runLinePreGame accepts the
// first candidate past whose ENDING SURPLUS / premium lands in
// OPENING_SURPLUS_BAND; ending surplus contains investment income; a rejected
// attempt re-seeds at (seed + attempt * 997). So a lower return can reject a
// past the old rate accepted, and the whole history — including the opening
// roster — is redrawn. Measured over 24 free-running games, 22 of 24 accepted a
// DIFFERENT attempt on at least one line.
//
// THE ISOLATING TEST, because free-running games cannot answer this: the old
// tree's {instance, setup, poolState, priorHistory} were serialised and replayed
// through the NEW tree's engine. Given the SAME past,
//
//     charges, pool premium and membership   IDENTICAL in 24 of 24 games,
//                                            all 5 years, to 6 decimal places
//     investment income                      DIFFERENT in 24 of 24
//
// So pricing and membership are rate-independent, and every charge that moved in
// this capture moved because the BOOK is different, not because the price of a
// given book is. The 2 of 24 free-running games that happened to accept the same
// attempt also came out bit-identical on charges, which is the same result
// reached the weaker way.
// ⚠ v51 -> v52: REQUIRED CAPITAL GAINS A CATASTROPHE TERM, AND THE OPENING MOVES
// TO A COMMON MULTIPLE OF IT. Two changes, one capture, because the second is
// calibrated against the first and splitting them would mean two captures with
// the middle one attributable to nothing.
//   reserveRiskMarginNeeded += catCapitalRetained — Property only; WC and GL
//     have no catastrophe band, so their margin is unchanged to the dollar.
//   OPENING_SURPLUS_BAND moves to a 'required' basis at 2.28x on all three, and
//     STARTING_CAPITAL_TO_PREMIUM is re-solved with it.
//   catCapitalNeeded is ADDED as a line result field, so the audit page can
//     state this row's derivation from the engine's own figure rather than
//     recompute it. audit-formula-check caught the row's formula still saying
//     expectedNetUnpaidLoss x (CLF - 1) — 384 row-instances where the NUMBER
//     was right and the stated derivation was not.
// So every Property figure moves, and every line's opening book re-rolls
// (the pre-game accepts against the band, and the band changed).
//
// ⚠ THE CORRECTION THIS CAPTURE CARRIES. b9d797e's message says the pool opened
// below its required capital at -7.7%. That was WC ALONE, from a probe that read
// the first line of a loop and labelled it the pool. The pool opened at +97.6%,
// nearly DOUBLE its requirement. The same bug produced that message's -12.9% and
// +41.3%; the pool figures are +97.6%, +159% and +159%.
// ⚠ v52 -> v53: THE REINSURANCE RISK LOAD GOES TO ZERO, AND THE OPENING PIN
// FOLLOWS IT. Every layer on every line is priced at 1x its expected cession, so
// reinsuranceCost, totalMemberCharge, retainedCoverMargin and everything
// downstream of them moves in every game. The pin moved too — cheaper cover is a
// smaller member charge, so the pre-game accumulates less surplus and the
// candidate distribution slid 60% of a band width off centre. The BAND did not
// move; 2.28x of required capital is still the design.
//
// ⚠ WHAT THIS CAPTURE DOES NOT CONTAIN, STATED SO IT IS NOT INFERRED: declining
// cover still WINS. Zero load halves its advantage and does not reverse it —
// WC full $29.3M against none $71.8M, GL $38.3M against $144.5M, Property $45.0M
// against $121.7M. The residue is not the load: at lambda 0 a fully covered pool
// pays $44.62M and recovers $6.31M on WC (0.14), $128.64M and $16.04M on GL
// (0.12). Layers are priced on the DRAWN severity and recover on the BOOKED
// occurrence, which forward booking contracts below the attachment. That is the
// converging-climb work on feature/fast-development, and it is additive to this.
// ⚠ v53 -> v54: THE feature/uw-decisions MERGE. Numbered above BOTH parents —
// the branches' numbering had collided, each having minted its own v52 on
// different content, so this takes a number neither side used.
//
// Both sides move this capture, and they move it for unrelated reasons.
// From risk-control: zero risk load, required capital with a catastrophe term,
// the investment return cut, Property mitigation, the claims system's fixed
// thresholds. From uw-decisions: the book-mix normaliser OUT OF THE DRAW (so
// composition now reaches losses at all), the steepened risk-quality slope,
// adverse selection on intake, the renewal and intake sliders, the quote fix.
// Plus one quantity re-derived BY the merge: Property's market target back to
// 0.65, because its 0.60 was derived from a catastrophe load that zero risk
// load has set to zero. See marketConditions.ts.
//
// ⚠ THE OPENING PIN WAS RE-SOLVED AND DELIBERATELY HELD. Both branches changed
// how pre-game pasts end, so a re-solve was run as a matter of course and came
// back already centred — solver pass 0 at +0.0010 / -0.0316 / +0.0401 against
// its own 0.053 tolerance. The pins are unchanged, so opening books re-roll
// here only because the ENGINE moved, not because the pin did.
// v56: THE SET OPENING. The pre-game search, the opening pin and its
// acceptance band are retired. Prior history still plays PRIOR_HISTORY_YEARS
// years from the seed, but everything older is now a BULK cohort held NET at
// its expected ultimate times the unpaid share at its age, taken from the
// game's own recorded patterns over each pattern's full length — WC 37 years,
// GL 21, Property 11. Opening surplus is set, not searched: 2.28 x the line's
// own required capital.
//
// 17714 cells across 83 fields, shape unchanged (0 added, 0 removed). The
// direction is the larger WC book: WC's opening reserve goes 13.5 cohorts to
// 37 and its invested assets rise with it, so every balance-sheet and
// investment-income field downstream re-rolls. Nothing changed about how a
// played year develops, which is why the field LIST is identical.
// v57: CASE AND IBNR, AND NOTHING ELSE. A PURE ADDITION — 1800 field readings
// added (six scalars x 300 instances: caseReservesNet, ibnrNet,
// caseReservesGross, ibnrGross, caseReservesCeded, ibnrCeded), 0 removed, and
// 0 CHANGED. Every field present in v56 is bit-identical here.
//
// That is the whole claim of pricing commit 5(c): the split is a PRESENTATION
// derived from the recorded patterns, read by nothing economic. This capture is
// one of the two places that claim is tested — reserve-split-check is the
// other, and it makes the stronger version by inverting the split and
// requiring the same bit-identity.
//
// Recaptured so the new fields are gated from here on rather than sitting
// outside the baseline, which is how an addition rots.
// v58: FIVE PRIOR YEARS, NOT TEN — ONE PARAMETER, AND NOTHING ELSE MOVED IT.
// PRIOR_HISTORY_YEARS drops to 5 and the pre-game's depth is DERIVED from it
// now, so the pre-game plays exactly the history the pricing reads and every
// older accident year is a bulk reserve. 17160 cells across 67 fields, shape
// unchanged (0 added, 0 removed).
//
// ⚠ THE NEW RATE STACK IS IN THIS COMMIT AND MOVED NONE OF IT. NEW_RATE_STACK
// ships off, and the control that proves it is the one worth recording: with
// PRIOR_HISTORY_YEARS alone put back to 10 and every other line of the commit
// in place, this capture read 0 added, 0 removed, 0 CHANGED against v57. So
// each of the 17160 cells belongs to the parameter and none to the new stack.
//
// The direction is a SMALLER opening: bulk years are held at EXPECTED ultimate
// while played years hold their simulated one, and realised gross ultimate
// runs above expected on this engine, so trading five played years for five
// bulk years lowers the reserve. WC and GL fall about 8%, Property is flat.
// v59: REINSURANCE PRICED AT EXPECTED LAYER LOSS x CLF AT 70%, AND THE
// BULK-YEAR CESSION FIX. Two changes, both in the tower.
//
// The price was E[ceded] + lambda x SD with lambda 0 — the tower was
// actuarially FREE. It is now expected x the line's CLF multiplier at 70%, so
// every placed layer costs 14.0% more on WC, 13.5% on GL, 14.7% on Property,
// and that load is a real cost to members for the first time.
//
// The bulk accident years no longer take year 1's cession ratio. Each is
// priced at layer bounds scaled by (1.05)^age, so an older, cheaper year cedes
// less through a fixed-dollar attachment and keeps more net reserve: bulk
// reserve WC +17.9%, GL +7.7%, Property +0.4%.
// v60: THE NEW RATE STACK, ON. ONE FLAG, AND IT MOVES EVERY PRICED FIGURE —
// which is the point of the commit rather than a side effect of it.
//
// 12,845 readings changed across 47 fields, every one of them downstream of
// the charge. In four groups, and nothing falls outside them:
//
//   THE CHARGE ITSELF (300 each)  poolPremium, adminExpense, the two sums,
//     totalMemberCharge, grossPremium, operatingExpense; and per line-year
//     (180 each) ratePer100, purePremiumPer100, purePremium,
//     netPurePremiumPer100. WC's opening rate goes 2.859 -> 6.177.
//   WHAT THE CHARGE BUYS  the balance sheet and the surplus path — invested
//     assets, investment income, cash both ends, total assets, ending surplus,
//     net income, underwriting income, the funding gap and the two capital
//     ratios. Reserves and claims do NOT move: the loss side is untouched.
//   RATIOS  fourteen of them, because premium is the denominator of all but
//     one. expectedExpenseRatio 0.465 -> 0.264 is the clearest reading of what
//     the new stack does — the same admin dollars over a much larger premium.
//   SATISFACTION  285 instances, 7.1 -> 6.8, because members read the rate.
//
// AND THREE THAT ARE NOT VALUE MOVES, STATED SO THEY ARE NOT MISREAD AS ONE:
// surplusTieOutDifference (247, 1.5e-8 -> -4.5e-8), expectedCombinedRatio
// (179, 0.9999999999999998 -> 1) and investmentReturnRate (35, one ulp) are
// float reassociation on quantities of a different magnitude, not movement.
//
// ⚠ marketShare MOVES ON 39 INSTANCES WITH NO ROSTER MOVEMENT, AND THAT IS NOT
// A CONTRADICTION. newMembers, withdrawnMembers and declinedMembers are all
// bit-exactly 0 across all 150 instances, and no per-line marketShare moved.
// The 39 are POOL rows: the pool's share is the premium-weighted average of
// the lines' shares, weighted by totalMemberCharge, and the new stack changes
// the charge mix between lines (WC +116%, GL +57%, Property +40%). The weights
// moved; the shares did not.
//
// 1,080 fields are ADDED and are not a value change: expectedToSurplus,
// finalRatePer100, firstIndicationPer100, lossPurePremiumPer100 and the two
// prior-year panel fields.
// v61: THE GL POOL LIMIT AND THE PRE-GAME FUNDING LEVEL. Two changes, and the
// INSTANCE COUNTS separate them cleanly — which is why they could be captured
// together rather than one at a time.
//
//   300 instances (every line-year)  the pre-game funding level. Surplus,
//     invested assets, investment income, the capital ratios and the cash both
//     ends move on ALL THREE LINES by about 0.03%. The opening SURPLUS is
//     unchanged — it is set from the reserve, which no funding level can move
//     — but the opening CASH is a share of premium, so funding the declared
//     years at 70% leaves a different cash/invested split, and the investment
//     income on it compounds from there.
//   72-88 instances (GL only)  the pool limit. Reserves, paid, case and IBNR
//     both bases, expected loss, premium, the charge and seven ratios. GL's
//     gross falls 7.83% and its rate 5.6%, because the pool no longer prices
//     for a tail it never covered.
//   285 instances  memberSatisfaction, 6.8 -> 6.9, because rates fell.
//
// 600 fields are ADDED and are not a value change: memberShareAboveLimit and
// claimsAboveLimit. WC and Property see no loss, reserve or premium move at
// all — their limit is null and the engine does not even re-sum their gross.
// v62: THE HOST'S DEVELOPMENT % GOES LIVE, AND THE SIGN CONVENTION WITH IT.
//
// ⚠ AT 0% ON EVERY LINE THIS BASELINE IS BYTE-IDENTICAL TO v61 — checked, not
// claimed, by running this file with PRIOR_DEVELOPMENT_DEFAULTS overridden to
// zero against the previous capture: VALUE IDENTITY HOLDS. The mechanism
// takes no draw and no branch at 0%, so the engine is inert; what moves below
// is the defaults (WC 3% adverse, GL 10% adverse, Property 2% favourable)
// doing what they say.
//
// Reserves, ultimates, paid and the surplus path move on all three lines, in
// the direction of each line's sign. The two development rows on the results
// sheet also change their PRINTED SIGN: they were favourable-positive and are
// now adverse-positive, the one convention every display now uses. That is a
// presentation change on a field the engine did not touch.
// v63: LOSS ENGINE COMMIT 3a — THE NEW ENGINE, PERMANENT, ONE BOOK PER LINE.
// 25,623 instances across 98 fields move; none added, none dropped. Every one
// is attributed to one of five causes, field by field:
//
//   THE ENGINE (NEW_LOSS_ENGINE on). Losses are the aggregate ordinary cohort
//     plus the shocks' large losses; nothing else arrives. So the gross and net
//     ultimates, incurred, paid, reserves (case and IBNR, both bases), prior-
//     year development, the loss ratios and every surplus, asset, cash and
//     income figure downstream move. Ordinary losses sit below every
//     attachment, so the ceded reserves, priorYearDevelopmentCeded, recovery
//     (282 of 300 now 0), reinsuranceCost and expectedCededPer100 fall to
//     about nothing; developmentAbovePoolLimit, memberShareAboveLimit and
//     claimsAboveLimit to 0; claimCount to 0 (a quiet year has no large loss).
//     expectedLoss is the engine's ex-ante expectation; catCapitalNeeded is
//     newEngineCatCapital's (the basis is an open question to the owner — see
//     PENDING_MULTIPLAYER). The expense ratios fall with the reinsurance cost.
//   MEMBERS CUT (MEMBER_LEVEL off). activeMembers, enrolmentCount, applicants
//     and intakeRoom go to 0; activeExposure, writtenExposure and marketShare
//     become the opening book's mean (OPENING_BOOK_EXPOSURE), unmoved at
//     default decisions. memberSatisfaction and averageRiskQuality are carried
//     at their opening values, hidden and read by nothing — the 6.9 -> 7.4 and
//     4.0999... -> 4.1 are the opening value, no longer moved by members.
//   PRICING ON THE NEW LOSSES. ratePer100, the pure premiums, the indications,
//     the prior-year indications, expectedToSurplus and newLossCostPer100 are
//     the new stack's on the ledger the new engine writes.
//   THE STORED LOSS RATE. lossPurePremiumPer100 is now read back off
//     expectedLoss, which under the new engine is not exposure x a rate — the
//     audit page's Pure Premium row needs the rate that produces it.
//   REASSOCIATION. surplusTieOutDifference (+/-1.49e-8), expectedCombinedRatio
//     (1 -> 1.0000000000000002) and investmentReturnRate (32 instances, last
//     digit) are the same quantities reached on different figures.
//
// ⚠ THE OLD ENGINE STILL REPRODUCES v62 BYTE FOR BYTE: run this file with
// --import ./scripts/tools/engine-mode/legacy-engine.ts against v62 and it
// holds. Checked before the recapture, not claimed.
// (Commit 3b removed legacy-engine.ts with the old shocks; the old engine is
// reproducible now only from the legacy-engine branch. 3b itself is
// value-neutral: this baseline holds unchanged across it.)
//
// v64: LOSS ENGINE COMMIT 4a — ONE REINSURANCE PACKAGE PER LINE, THE MIDDLE ONE
// BY DEFAULT. 13,249 instances across 70 fields move; none added, none
// dropped. The control ran first: 3b (88d1e6e), in its own worktree,
// reproduced v63 exactly. Every move is the default package replacing the
// full tower — $9M xs $1M on WC and GL (was to $50M / $25M), $20M xs $5M on
// Property (was to $1B) — on the tower re-cut at the packages' edges:
//
//   WC   the $10M-$50M band is no longer bought. Its cost was tiny on this
//        book, so only reinsuranceCost and expectedCededPer100 move by more
//        than 1e-6 relative (netIncome and underwritingIncome on 1-2
//        instances); everything else on WC moves in the last digits.
//   GL   the $10M-$25M band is no longer bought: reinsuranceCost (673,345 ->
//        402,266 in year 1), the net pure premium, the rate, premium, the
//        ratios and every surplus, asset and income figure downstream.
//   Property  the cover stops at $25M instead of $1B: reinsuranceCost
//        (7,511,174 -> 1,031,666), the rate and everything downstream; the one
//        catastrophe year on two instances recovers 15,000,000 instead of
//        109,448,263 (the earthquake keeps its $10M retention, so the package
//        answers it from $10M to $25M), retains 69,448,263 above the $50M top,
//        and its net reserves, paid, incurred and liabilities rise with it;
//        catCapitalNeeded, reserveRiskMarginNeeded and fundingMarginNeeded
//        rise because the pool now retains the catastrophe above $25M.
//   marketShare (tri pool) follows the rates.
//   REASSOCIATION: surplusTieOutDifference (+/-1.49e-8 -> 0), expectedCombined
//        Ratio (1.0000000000000002 -> 1), investmentReturnRate and prior-
//        YearDevelopment (last digit only).
//
// ⚠ ONE IDENTITY BROKE, AND IT IS INTENDED: retainedAboveTower was 0 on all
// 300 instances because Property's tower reached $1B. It now reads 69,448,263
// on the two Property catastrophe-year instances (pool and line, both
// configurations): the loss above the $50M top that every package retains.
//
// LOSS ENGINE COMMIT 4b (ten worlds) IS VALUE-NEUTRAL HERE, AND v64 HOLDS
// UNCHANGED: this harness drives the engine one world at a time through
// processYear, and the struck-rate seam is inert without a struck rate — no
// field moved, none was added. What ten worlds change is what the app SHOWS,
// the average, and that is RENDER_IDENTITY_v45 and SOLO_EXPORT_GUARD_v68.
//
// v65: BULK COHORTS OPEN AT THEIR OWN AGE. They stored their PATTERN age as
// `age`, a step older than the convention the engine steps by, so year 1 paid
// them two years' worth and they ran a year ahead of their pattern after. The
// control ran first: 1431cd7, in its own worktree, reproduced v64 exactly. 43
// fields move, no field added or removed, and every one is the payment timing
// or follows from it:
//   - PAID: netPaidLosses (e.g. year 1 9,426,968 -> 7,543,683) — the bulk
//     years now pay one step a year.
//   - WHAT IS NOT PAID STAYS: endingNetReserve and everything struck on it
//     (beginningNetReserve, case and IBNR, expectedNetUnpaidLoss, the reserve
//     risk margin and funding targets, totalLiabilities, nextYearPaydownRate),
//     the cash and investments it is held in, investment income on them, and
//     totalAssets.
//   - DEVELOPMENT on the larger unpaid balances: priorYearDevelopment, and so
//     netIncurredLoss, the loss and combined ratios and underwriting income, by
//     a few thousand dollars a line-year.
//   - SURPLUS, net income and the capital ratios that follow.
// No rate, premium or pricing field moved: pricing reads the five played and
// prior years, never the bulk.
//
// v66: LOSS ADJUSTMENT EXPENSE IS BOOKED (lossExpense.ts) — incurred, paid and
// reserved as the rate's shares of the ground-up loss (ULAE alone on GL). The
// control ran first: e8333a5 reproduced v65 exactly. SEVEN FIELDS ADDED on
// every row — alaeIncurred, ulaeIncurred, laeIncurred, laePaid,
// beginningLaeReserve, endingLaeReserve, actualLaeRatio — none removed. 24
// fields move, each the LAE or what follows it:
//   - UNDERWRITING spends it: underwritingIncome (e.g. 2,221,770 -> 414,000),
//     netIncome, and actualCombinedRatio / combinedRatio, which now carry the
//     LAE ratio (e.g. 0.856 -> 0.973).
//   - THE BALANCE SHEET holds it: totalLiabilities rise by the loss expense
//     reserve; the opening holds assets for it, so totalAssets, investments
//     (beginning, ending, invested) and the income they earn rise with it.
//   - SURPLUS and the capital ratios that follow (year 1's beginning surplus is
//     the ruled opening and does not move — 240 of 300 beginning-surplus
//     instances do, the later years).
//   - surplusTieOutDifference reads 0 where it carried float noise; cash moves
//     by one ulp on 87 instances.
// NO loss, paid, reserve, development, rate or premium field moved.
//
// v67: THE ANNUAL STATEMENT'S TWO RESULT FIELDS. The engine computed the book's
// movement and kept only the retention rate; the results page needs the split,
// so every line row — and the pool row, in mixed units like writtenExposure —
// now carries renewalExposure (the book kept after the renewal cut and any
// withdrawal) and newBusinessExposure (the book newly written), in written-
// exposure units, summing to writtenExposure. The control ran first: 6549695
// reproduced v66 exactly. 600 field instances ADDED — those two, on every row —
// none removed, and 0 changed: every field present in both is bit-identical.
// v68: ROUTINE LARGE LOSSES ON (Prompt A commit 1). The control ran first:
// 21e96e7 reproduced v67 exactly. Shape unchanged (38,760 fields, none added
// or removed); 24,196 instances moved across 92 fields, every one downstream of
// the switch: claims above the ordinary limit now arrive every year, pre-game
// included, so losses, cessions and reserves rise, the experience rate reads
// them (ratePer100, the indication fields, the pure premiums), and premium,
// capital, the ratios and the balance sheet follow. claimCount reads the
// routine claims; marketShare (34 instances) moves with the rate against the
// market; investmentReturnRate (23) by an ulp through the asset weights.
// ⚠ ONE IDENTITY LEFT ITS VALUE, AND IT IS INTENDED: priorYearDevelopmentCeded
// was 0 on all 300 instances and now is not on 210 (worst $777K). Nothing
// reached the tower in these games before; routine claims now pierce the
// retention, and the tower answers their development as the accident year's
// own cover — which is what the field exists to record.
// v69: PROPERTY OPENS ON ITS FULL REQUIREMENT (Prompt A commit 3) — the
// retained-catastrophe charge joins the reserve margin in the opening rule.
// The control ran first: 4e44465 reproduced v68 exactly. Shape unchanged;
// 2,479 instances moved across 20 fields, all of them surplus and what holds
// or earns it — surplus, invested assets and cash, investment income and net
// income, the funding gaps and capital ratios, the tie-out's float noise. NO
// loss, premium, rate, reserve or cession field moved, and no identity left
// its value: the pre-game's losses do not read surplus, so a larger opening
// changes what the pool holds and earns on, not what it pays.
// v70: THE OPENING HOLDS TEN YEARS AT 2x, AND THE PRE-GAME HAS YEARS BEHIND IT
// (Prompt A commit 2). The control ran first: 8a9db53 reproduced v69 exactly.
// Shape unchanged; 14,325 instances moved across 54 fields, none an identity.
// The opening reserve is the ten-year window the pre-game carried (WC's older
// runoff is closed), so the reserves, their split, paid losses, prior-year
// development and the LAE on them move, and net incurred and the loss ratios
// with them; surplus opens at 2x (was 2.28x), so invested assets, investment
// income, the funding gaps and the capital ratios move; the bulk years carry a
// gross ledger, so ceded case and IBNR move; and the pre-game's own last
// indication and rate (priorFirstIndicationPer100, priorFinalRatePer100) move
// with its steadier history and its ex-ante reinsurance price. NOT moved: any
// game year's rate, pure premium or premium — year 1 prices off the five
// played pre-game years, whose losses are the same draws.
// v71: FOUR REGIONS (book units commit 1). The control ran first: 8c370a9
// reproduced v70 exactly. Shape unchanged; 10,631 instances moved across 86
// fields, none an identity. A regional event now strikes one of four regions
// drawn by exposure share (25/30/25/20), so the expected share its A reaches
// falls from 0.334 to 0.255: expected loss and the pure premium and rate struck
// from it move a little (Property year 1 -0.25%, WC and GL under $2K), and a
// fired event's A lands on a different share — its ultimate, net incurred,
// reserves, surplus and what they drive move with it.
// v72: ORDINARY LOSSES FROM BOOK UNITS (book units commit 3). The control ran
// first: b1142b1 reproduced v71 exactly. Shape unchanged; 26,104 instances
// moved across 98 fields, none an identity. A line opens on its book's
// exposure — its units' sizes summed — so exposure, the market share and
// everything struck on exposure move (premium, rates, reinsurance cost);
// ordinary losses are the units' draws and expected loss carries the book's
// risk, so losses, reserves, surplus and the ratios move with them.
// v73: LARGE LOSSES ON BOOK UNITS (book units commit 5). The control ran
// first: caea33d reproduced v72 exactly. Shape unchanged; 15,986 instances
// moved across 91 fields, none an identity. Routine large claims are counted
// on the book's size-weighted risk and land on its units by size x risk, and
// expected loss and the tower's layer prices carry that risk: expected loss,
// the pure premium and rates struck from it, reinsurance cost, the large
// losses drawn, and the reserves, surplus and ratios downstream move.
// v74: FUNDING TABLES ON THE NEW ENGINE. The control ran first: 33fdde8
// reproduced v73 exactly. Shape unchanged; 12,320 instances moved across 53
// fields, none an identity. Required capital reads the re-derived tables' 90%
// stop (WC 1.473 -> 1.3275, GL 1.502 -> 1.7910, Property 1.4414 -> 1.5247), so
// the opening surplus set on it, investments, investment income and every
// capital row move; the squeezed arm funds off the new stops, so its rates,
// premium and ratios move; the pre-game funds at a 14% cushion (GL and Property
// were 1.135 and 1.1471). The reinsurance cost moves in its last bit only
// (1 + 0.14 against 1.14), as do marketShare and investmentReturnRate.
// v75: DEVELOPMENT SPEED — WC AND GL DEVELOP 1.5x FASTER. The control ran
// first: da5a3e5 reproduced v74 exactly. Shape unchanged; 14,484 instances moved
// across 78 fields, none an identity (expectedCombinedRatio still 1 on all 150;
// surplusTieOutDifference moves by float noise only, e.g. 0 -> 7.5e-9). What
// moved, and why: paid losses, paydown, case and IBNR (net, gross and ceded),
// the net and LAE reserves, and the funding targets and reserve margin read
// off them, because the compressed patterns pay faster and hold less unpaid;
// opening and later surplus, invested assets and investment income, because a
// smaller opening reserve sets a smaller required capital and opening surplus;
// and the pure premium and rates from year 2 on, by the two causes recorded
// at DEVELOPMENT_SPEED (the host's development priced sooner; less open balance
// for shock R development). Year-1 rates are unchanged.
// v76: THE FUNDING TABLES WIRED — BASELINE_CV DRIVES THE ENGINE AND PICKS THE
// TABLE; THE OPENING SET AT $35M. The control ran first: fecbb08 reproduced v75
// exactly. Shape unchanged; 23,045 instances moved across 87 fields, none an
// identity. What moved, and why: every loss, paid, reserve, LAE and ratio
// figure, because the ordinary year factor is drawn at WC 6% / GL 10% /
// Property 8% instead of 2% (same streams, wider factor) — in the pre-game
// too, so the loss history, the pure premium and every rate struck from it
// move from year 1; beginingSurplus is 35,000,000 on every line and with it
// invested assets, investment income, net income and every surplus row;
// required capital reads the BaselineCV tables' 90% stop (WC 1.0802, GL
// 1.1320, Property 1.1060), so the reserve margin, funding gap and capital
// ratios move; and the squeezed arm funds off the new 30% stop (WC 0.8515 ->
// 0.9664), moving selectedFundingCLF and clfAdjustedExpectedLoss. Float noise
// only: ibnrCeded, caseReservesCeded, priorYearDevelopmentCeded,
// surplusTieOutDifference, expectedCombinedRatio, marketShare,
// investmentReturnRate.
// v77: STABLE-SCENARIOS BLOCK A (commits 1-4). The control ran first: 061b476
// reproduced v76. Shape unchanged; 24,690 instances moved across 93 fields,
// none an identity, attributed by running the check at each commit in turn:
// 85 fields moved at commits 1, 2 and 3; 5 at commit 1 only; 1 at 1 and 3; 1
// at 2 and 3; 1 at 3 only; commit 4 moved nothing. Commit 1 (routine large
// losses folded, flat pre-game): the pre-game's losses and returns sit at
// expected, so the loss history, every rate and reserve move, and with no
// routine claim to cede, reinsuranceRecovery and every ceded reserve read 0.
// Commit 2 (the pool's loss costs, required capital at 80%): WC and GL's
// losses, lossPurePremiumPer100 and the reserve margin. Commit 3 (no tail,
// trend per line, booked up to reporting): every loss, paid, reserve and rate
// again, and Property's catCapitalNeeded. surplusTieOutDifference moves from 0
// to -1.5e-8 at commit 2: float rounding.
// v78: STABLE-SCENARIOS BLOCK B (commits 5-7). The control ran first: ab87580
// reproduced v77. Shape unchanged; 19,753 instances moved across 92 fields,
// none an identity, attributed by running the check at each commit in turn:
// 46 fields moved at commits 5, 6 and 7; 22 at 5 and 6; 15 at 5 only; 6 at 5
// and 7; 3 at 6 only. Commit 5 (shocks at 0.3 a year, the schedule's count):
// every loss, LAE and reserve figure and the expected loss. Commit 6 (the
// aggregate stop): the recoveries, ceded and net reserves, the reinsurance
// cost and Property's catastrophe capital — aggregateRecovery,
// reinsuranceRecovery and priorYearDevelopmentCeded at it alone. Commit 7 (the
// catastrophe load): the pure premium and the first indication.
// v79: STABLE-SCENARIOS BLOCK C (the small fix through commit 11, the
// give-back fix and the contingency at 0). The control ran first: 330c525
// reproduced v78. 300 fields added, none removed: expectedReinsuranceRecovery
// (commit 11). 26,027 instances moved across 100 fields, none an identity,
// attributed row by row from each commit's own dump: 77e3449 (exposure to
// $30M) 25,217 rows; 0d65606 (catastrophe load removed) 13,549; ed7e89d
// (year 1 on the pure premium) 23,955; 715fe14 (re-scale) 25,111; 58af20e
// (the cover's full price, shocks sized on claims) 14,242; 665410f (re-scale)
// 25,001; 3df8453 (twenty scenarios: the seed, the $5M start, the solved
// margin, the 3% pre-game return) 20,122; fbecad4 (commit 11) 480 — the 300
// new fields and commonLossFactor reading the year factor on 180; 7a369a7
// (contingency 0, re-scale) 25,237. Moved nothing here, by construction: the
// shocks-off switch (58cd3b9; this harness draws no solo schedule), the
// hundred worlds (b3011df; it drives one world at a time) and the give-back
// fix (e6e0e93, display only).
// v80: THE UNDERWRITING LANDING (the two sliders; Property's catastrophe
// capital on the shock switch; the intake-arm probes). The control ran first:
// 1632ab4 reproduced v79, with export v87 (24 of 24) and render v74 (206 of
// 206). Run at each commit in turn. No field added or removed. The underwriting
// commit moved 25,337 instances across 99 fields, every one downstream of the
// book now growing by default: applicants at NEW_BUSINESS_APPLICATIONS (5%) of
// the book, none rejected, so activeExposure, writtenExposure and
// marketShare rise 5% a year (922.61 -> 968.74 at year 1) and premium, losses,
// reserves, cession, capital and income follow. ⚠ ONE IDENTITY RETIRED ON
// PURPOSE: newBusinessExposure was 0 on all 300 instances because the old
// default wrote nobody; it is now exactly 5% of the book (46.13 at year 1).
// The catastrophe-capital commit moved nothing: this harness runs bare
// instances on the catalogue, where shocks stay on. The probes commit moved
// nothing: it touches only the dormant member path.
// v81: THE HISTORY LANDING (the pool's history begins in 2021; the cash cap
// at the pre-game's start; the no-history rate on the book's own risk; paid-in
// capital $10M then $12.5M). The control ran first: 1dd0118 reproduced v80,
// with export v88 (24 of 24) and render v75 (206 of 206). Run at each commit
// in turn, each against the one before. No field added or removed.
//   the history commit, 13,483 instances across 52 fields: no bulk accident
//     years before 2021, so every reserve is smaller (beginningNetReserve
//     $74.78M -> $55.39M on the first instance) and paid losses, LAE,
//     development, IBNR and case, invested assets and investment income,
//     capital and the ratios follow. Year-1 beginning surplus does not move —
//     the opening is still the scenario's.
//   the cash cap, 3,834 across 21: the pre-game's cash and invested-asset
//     split, so investment income, surplus after year 1, and capital.
//   the book's-risk fix, 5,101 across 21: 2021's rate moves, the pre-game
//     margin re-solves, and the same 21 fields follow (priorFinalRatePer100,
//     2025's rate, on the 36 year-1 instances).
//   $10M, 5,105 across 21; $12.5M, 5,097 across the same 21: the margin
//     re-solves on a larger start; the same asset-split fields.
//   The pricing report commit moved nothing. No played-year rate, premium,
//   loss or reserve moves after the history commit: year 1 prices on a full
//   five-year window of flat pre-game losses either way.
// v82: THE POLICY-YEAR LANDING (policy year 2027, the simulated pre-game, the
// investment income credit, admin trends, ALAE by year, Property capital
// $17.5M), rebased on multiplayer 96fe2a2. The control ran first: 96fe2a2
// reproduced v81, with export v89 (24 of 24) and render v80 (236 of 236). Run
// at each commit in turn, each against the one before. 21,427 of 39,780
// values differ from the control at head; every one is attributed to a commit.
// Four fields added, 180 each (720): billedExposure, investmentIncomeCredit,
// alaeRatio, pricingAlaeRatio. None removed.
//   the 2027 policy year and data lag, 18,619: a sixth pre-game year and a
//     one-year lag, so every reserve, asset and surplus field moves.
//   the welcome memo and pool name, 0.
//   the investment income credit, 13,007: premium and charge on every
//     instance, and everything that follows them.
//   the Model tab, 180 — billedExposure added, no existing value moves.
//   admin trends 3%, 10,894: funding, surplus and capital.
//   the simulated pre-game merge, 20,297: premiums, losses, reserves, IBNR.
//   ALAE by line and year, 15,823: premium, LAE and what follows.
//   the credit fix (no invested assets), 1,181 on 59 instances.
//   Property $15M, 2,335 on 137; $17.5M, 2,722 on 151: opening surplus and
//     the funding and capital fields that follow.
//   the credit floored at zero, 1,950 on 8 instances, years 3-5: the 24
//     credits that were negative (as low as -5.59%) are 0, so premium, income,
//     surplus and capital follow. No negative credit remains.
//   The driver and gate commits moved nothing.
// v83: THE RESERVE-INFLATION LANDING (reserve inflation booked and priced;
// the per-line opening; the investment income credit off; the admin overrun;
// profit and contingency, priced inflation years and paid-in capital per line),
// rebased on multiplayer 91559fd. The control ran first: 91559fd reproduced
// v82, with export v90 (24 of 24) and render v84 (236 of 236). Captured at each
// commit in turn and compared with the one before. 21,361 of 39,600 values
// differ from the control at head; every one is attributed to a commit. One
// field removed, 180 values: investmentIncomeCredit. None added.
//   reserve inflation, 21,250 across 80 fields on all 300 instances: open
//     years inflate, so reserves, paid losses, development and IBNR move, and
//     pricing two years of it moves every rate (tri Y1 WC 3.283 -> 3.586, GL
//     4.967 -> 5.568 per $100).
//   the opening (per-line targets, guardrails, pre-game growth, capital),
//     20,689 across 78: the pre-game's book and margin, so reserves, surplus
//     and premium.
//   the credit off and 5% profit and contingency, 13,393 across 50: premium,
//     admin charged (grossed up by the new divisor: +5.263% on GL and
//     Property, +2.105% on WC) and everything after; investmentIncomeCredit
//     removed.
//   the admin overrun, 6,906 across 26: the admin booked (operatingExpense)
//     and the income, surplus and capital that follow; the admin charged does
//     not move.
//   profit and contingency, priced years and capital per line, 13,496 across
//     54: premium and admin charged (-5.000% on GL and Property, -3.061% on
//     WC), and the openings at WC $3.0M, GL $12.0M, Property $12.5M (tri Y1
//     rates WC 3.632, GL 5.665, Property 0.3082).
//   The probes, panel-driver and audit-row commits moved nothing, nor did
//   paying inflation by the pattern whatever FORWARD_BOOKING says (the
//   shipped game has the flag on) or the gate restatements. Exposure moves in
//   none of them.
// v84: THE SHOCKS PLAY-TEST LANDING, OWED (landed on multiplayer without the
// full checks; recaptured with them, wip/shocks-owed-checks). The control is
// multiplayer 19b6f17, captured here: against v83 it moves 21,101 of 39,600
// values in 94 fields on all 24 configurations and every year; none added or
// removed. All of it is the landing itself — the new loss engine's shocks
// (catalogue firings, A on the whole line for one year, one T claim per
// event-line), the T covers with None the default (tri Y1 pool reinsurance
// cost $5.22M -> $0) and the shock-free pricing shadow (tri Y1 rates WC 3.632
// -> 3.532, GL 5.665 -> 5.379, Property 0.3082 -> 0.2858 per $100). Head was
// then captured at each owed-checks commit in turn: 3fdae5e (Property cat
// cession capped at the ceiling, five gates restated) and a4a841b (shock
// records per firing, the stop's samples grown, eleven gates restated) each
// reproduce the control bit for bit — no baselined game repeats an event in
// force, cedes Property cat or prices the dormant stop.
// v85: THE SIMPLE UNDERWRITING LANDING (100 equal members, each with a yearly
// risk score; non-renewal and new members, 0-5%, one year each; every game on
// the standard opening book; the audit's retained catastrophe). The control ran
// first: multiplayer ee1ea6c, in its own worktree, reproduced v84 39,600 of
// 39,600 (and export v92 24 of 24). 25,272 of 39,600 values differ at head,
// across 91 fields; none added or removed. Attributed by a null test: with
// MEMBER_RISK_CV set to 0 the head reproduces, bit for bit, its own capture
// taken before member risk existed — so the two parts separate exactly:
//   the book, 25,278 values across 91 fields against the control: every game
//     opens on the standard opening book (OPENING_BOOK_EXPOSURE; WC-solo Y1
//     exposure 968.74 -> 916.11) and the defaults no longer grow it
//     (newBusinessExposure to 0 on all 300; Y5 1,177.51 -> 916.11), so
//     exposure, written and billed exposure, market share, premium, the
//     per-exposure admin, and every loss, reserve, rate, cash and capital
//     field after them; ordinary losses drawn on 100 equal members at risk 1;
//     the T claims landing on the line by region share.
//   member risk, 22,246 values across 81 fields against that: the ordinary
//     loss draw and what it feeds — ultimates, reserves, LAE, the rate as it
//     learns, cash, surplus, capital. No exposure, admin or premium-at-opening
//     field moves by it.
//   The audit fix is display only and the two merges moved nothing. Float
//   order only: investmentReturnRate, 23 values within 3.6e-16; the surplus
//   tie-out stays within $5e-8.
// v86: THE ADVERSE-DEVELOPMENT LANDING, on multiplayer ebc3b4a (simple
// underwriting). The control ran first: ebc3b4a reproduces v85 here. Against
// it 20,136 of 39,600 values move across 74 fields on all 300 instances; none
// added or removed. With BOTH switches turned back in process — reserve
// inflation restored at the severity trend, ADVERSE_DEVELOPMENT off — the
// landing reproduces v85 exactly, so those two are the only movers:
//   reserve inflation off (unbooked and unpriced), alone: 20,142 across 74 —
//     every rate (the priced inflation gone), reserves, development, IBNR;
//   adverse development, alone: 17,269 across 74. These games are built here,
//     not as single player builds them, and set no level, so each line plays
//     the harness default, Mid; and the host's lifetime percentages are
//     retired, so the openings carry none.
// Single player itself (SOLO_ADVERSE_DEVELOPMENT off) develops nothing — see
// SOLO_EXPORT_GUARD_v94, whose games are built as the app builds them.
// v87: ADVERSE DEVELOPMENT DEFAULTS TO LOW (was Mid). This harness's games set
// no development level, so they play the default. The control ran first:
// 4ac52b5 reproduced v86 exactly. Each commit against the one before: the
// results-delay commits moved nothing (display only — byte-identical); the
// default's commit moved 17,248 instances across 74 fields, every one
// downstream of less development on the open prior years (1-5% a year where
// Mid drew 5-15%): prior-year development, net incurred and paid losses, the
// reserves, IBNR and case, the funding target and reserve risk margin, LAE,
// and the income, surplus and capital that follow (first instance's
// priorYearDevelopment -$5.17M -> -$1.47M, net incurred $27.34M -> $23.65M).
// No field added or removed. No rate moved: the pure premium reads development
// only as it emerges, and these are year-1 rows struck before any.
// v89: ADMIN IS A SHARE OF PREMIUM (wip/pricing-rework). v88 is skipped: it
// was the reverted development-pricing build's. Admin is 20% of premium on every
// line; profit and contingency, the fixed and per-exposure admin and the admin
// trend are gone. The control ran first: multiplayer 8a4dae4 reproduced v87
// exactly. The rework moved 12,937 instances across 49 fields, every one a
// price, admin, or downstream of them: adminExpense, operatingExpense, the
// member charge and grossPremium, the rates (ratePer100, firstIndication,
// finalRate and their priors), poolPremium, expectedToSurplus (now the CLF
// cushion alone: 0 at Expected), the loss, expense and combined ratios
// (expectedLossRatio 0.8815 -> 0.8 and expectedExpenseRatio 0.1185 -> 0.2 on
// the first instance — the permissible loss ratio and admin's share), and the
// income, cash, investments, surplus and capital that follow (first instance's
// adminExpense $3.67M -> $6.69M, member charge $30.99M -> $33.47M). marketShare
// (36) and investmentReturnRate (22) move by an ulp — a premium-weighted share
// and an income/assets ratio on the moved figures. NO LOSS, CLAIM, RESERVE OR
// PURE PREMIUM FIELD MOVED, and no field was added or removed.
// v90: THE FIXED-SEED SCENARIOS (wip/fixed-seed-scenarios), on multiplayer
// 985f365. The control ran first: 985f365 reproduces v89 here. Each commit
// against the one before, each captured in its own worktree:
//   4effbc3  each scenario plays a fixed seed — moves nothing: this harness's
//            games are bare ids (MAMC6EA4, 6KA6WGLJ, ZZTEST99), not scenarios.
//   12e7c54  every run-time fitting removed — 19,963 of 39,600 across 76
//            fields on all 24 instance-configurations, Y1 to Y5. A bare id used
//            to fall on scenario seed % 20 + 1 (the retired fallback) and play
//            that scenario's scaled pre-game at a solved margin; it now plays
//            its own seed at true cost with the prior board at Expected and
//            opens where that history ends. So the pre-game's losses, the
//            opening balance sheet and everything priced or earned on them
//            move: first instance's WC year-1 rate $3.6530 -> $3.6342, pool
//            ending surplus $45.20M -> $34.48M, WC prior-year development
//            -$1.473M -> -$1.466M. 69 fields do not move (counts, exposure,
//            membership, the cover's terms). No field added or removed.
//   854ed47, 083e5c0 (gates, save key) — nothing.
// v91: LARGE CLAIMS BY FREQUENCY (wip/large-claims-frequency), on multiplayer
// e698c79, RE-TAKEN AFTER MERGING multiplayer ba409c1 (which reproduces v90
// here): identical, value for value, to the capture before the merge. The control ran first: e698c79 reproduces v90 here, and this build
// with LARGE_CLAIMS_BY_FREQUENCY switched off at run time reproduces v90
// exactly. With the switch on, each line draws at most one large claim a year,
// at Low 7.5% / Mid 5.25% / High 2.25%, sized by the existing ranges × the
// year's growth factor; catalogue events no longer bring large claims. This
// moves 10,932 of 39,600 values across 89 fields, on all 300 instance-years
// (Y1 1,292 · Y2 2,048 · Y3 2,050 · Y4 2,635 · Y5 2,907). They are the losses,
// reserves, LAE, income, surplus and capital that follow (first instance's WC
// Y1 gross ultimate $22.18M -> $23.93M; tri Y5 pool ending surplus -$0.31M ->
// -$6.19M). Exposure, membership, the covers' terms and recoveries do not move
// (both arms buy no cover). No field is added or removed.
// RATES: finalRatePer100 and the fields priced on it move in 36 line-years,
// Y3 to Y5, by 0.03%–0.25%. This is the harness, not a leak. It calls
// processYear alone, without the shock-free pricing shadow that playWorldsYear
// keeps, so its rates read the game's own ledger. That ledger carried the
// catalogue's large claims in v90 just as it carries these now (with the
// frequencies zeroed, 16 Property line-years move instead). On the game's own
// path the rate is struck from the shadow, which draws no large claims.
// large-claim-frequency-check proves that, with a control that fails when the
// shadow is bypassed.
// NUCLEAR VERDICT KEEPS ITS OWN LARGE CLAIM (EVENTS_KEEPING_LARGE_CLAIMS),
// captured into this same v91 before landing. Against the capture without it,
// 300 values move, all on GL: expectedLoss and clfAdjustedExpectedLoss (GL and
// pool rows) and lossPurePremiumPer100, in every GL-solo and tri instance-year,
// carrying NV's claim at its catalogue odds (first instance's GL Y1 $21.79M ->
// $22.20M). No Nuclear Verdict fires in these games, so no loss or rate moves.
// LARGE CLAIMS IN EVERY GAME (LARGE_CLAIMS_EVERY_GAME) moves nothing here:
// every game in this harness has its shocks on.
// BACK TO v90: LARGE CLAIMS COME ONLY FROM T-SHOCK EVENTS (wip/large-claims-
// from-events), on multiplayer e93c7ea, which reproduces v91 here. The
// separate draw is gone, so every v91 move above is undone: against v91, the
// same 10,932 of 39,600 values across 89 fields move back, and the result is
// v90 value for value (0 of 39,600 differ). Every game here has its shocks
// on, so COVERS_IN_EVERY_GAME moves nothing; they hold None, so the covers'
// prices reach nothing. v91 is retired.
// v94: PRICING'S ALAE LOAD IS FIXED PER LINE (pr/alae-load, from aws a7d480d):
// ⚠ REBASED onto aws 6941ade (team numbers, #73), which reproduces its
// predecessor exactly; this baseline holds unchanged there, nothing re-captured.
// PRICING_ALAE_LOAD (WC 11%, GL 15%, Property 3.5%) in place of the window's
// mean drawn ratio. (Numbered past every value baseline on multiplayer and on
// pr/clf-stretch, so no two pull requests share one.) The control ran first:
// aws a7d480d reproduced v90 exactly. 13,338 instances move across 54 fields,
// every one the load or downstream of it: pricingAlaeRatio (180, e.g. 0.0987 ->
// 0.11), the pure premium it is part of (newPurePremiumPer100,
// netPurePremiumPer100, purePremium(Per100)), the rates (ratePer100, first
// indication, final rate and their priors), the premium and admin at 20% of it,
// the loss, LAE and combined ratios over the new premium, and the opening's
// surplus — the pre-game's rates moved, so every opening did (beginingSurplus
// $8.59M -> $10.91M on the first instance) — with the cash, investments,
// income, capital and funding that follow. expectedLossRatio,
// expectedExpenseRatio, expectedCombinedRatio, actual/expenseRatio,
// marketShare and investmentReturnRate move by an ulp. NO CLAIM, LOSS,
// RESERVE, DRAWN-ALAE OR BOOKED-ALAE FIELD MOVED, and no field was added or
// removed.
const BASELINE = path.join(__dirname, '../../baselines/VALUE_IDENTITY_v94.json');

function seedOf(id: string) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) { h = ((h << 5) + h) ^ id.charCodeAt(i); h = h >>> 0; }
  return h;
}

const SEEDS = ['MAMC6EA4', '6KA6WGLJ', 'ZZTEST99'];
const CONFIGS: { lines: CoverageLine[]; name: string }[] = [
  { lines: ['WC'], name: 'WC-solo' },
  { lines: ['GL'], name: 'GL-solo' },
  { lines: ['Property'], name: 'PR-solo' },
  { lines: ['WC', 'GL', 'Property'], name: 'tri' },
];

// ============================================================================
// THE ARMS. BOTH, NOT JUST DEFAULTS.
//
// ⚠ THIS GATE WAS BLIND TO A REAL CHANGE AND READ CLEAN. At 932246f a field was
// split in two, moving 171 instances under squeezed funding — and this script
// and solo-export-guard BOTH reported 0 changed and 12/12 matching, because
// bookingGiveBack is bit-exactly 0 at default decisions and the split was
// therefore invisible at the only configuration either of them exercised.
//
// "Both gates identical" was a statement about ONE configuration, and this is
// the pair every commit is measured against. THIRD INSTRUMENT WITH THIS
// BLINDNESS: audit-formula-check had it and was given a squeezed arm at 118b1fb
// (which turned one reported defect into eleven), the absolute identity check
// has it and reports it, and this is the one that mattered most.
//
// The squeeze uses EACH LINE'S OWN REACHABLE MINIMUM, not a flat value — WC
// stops at 0.10 (WC_FUNDING_CONFIDENCE_RANGE), GL and Property at 0.30
// (SLIDER_RANGES). Driving all three to 0.10 would test Property at a booking
// bias the UI cannot produce, which overstates the exercise and tests nothing a
// player can reach. Same reasoning, same constants, as audit-formula-check.
// ============================================================================
const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};
const ARMS: { name: string; decisions: (y: number, lines: CoverageLine[]) => DecisionSet }[] = [
  { name: 'def', decisions: y => defaultDecisionSet(y) },
  {
    name: 'sqz',
    decisions: (y, lines) => {
      const d = defaultDecisionSet(y);
      return {
        ...d,
        byLine: Object.fromEntries(lines.map(l =>
          [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }])) as never,
      };
    },
  },
];

const out: Record<string, number> = {};
for (const arm of ARMS) {
for (const id of SEEDS) {
  for (const { lines, name } of CONFIGS) {
    const instance = generateGameInstance(id, seedOf(id));
    const setup = { poolName: 'G', gameLength: 5, startingYear: 2026, instanceId: id, activeLines: lines };
    const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
    let gs: GameState = {
      setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
      poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
    };
    for (let y = 1; y <= 5; y++) {
      const p = processYear(gs, arm.decisions(y, lines));
      const scopes: [string, ResultSet | LineResultSet][] = [
        ['pool', p.result],
        ...lines.map(l => [l, p.result.byLine[l]] as [string, LineResultSet]),
      ];
      for (const [scope, r] of scopes) {
        for (const [k, v] of Object.entries(r)) {
          if (typeof v === 'number' && Number.isFinite(v)) out[`${arm.name}|${id}|${name}|Y${y}|${scope}|${k}`] = v;
        }
      }
      gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    }
  }
}
}

if (process.argv.includes('--write')) {
  fs.writeFileSync(BASELINE, JSON.stringify(out, null, 0) + '\n');
  console.log(`Captured ${Object.keys(out).length} numeric fields -> ${BASELINE}`);
  process.exit(0);
}

const base: Record<string, number> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const baseKeys = new Set(Object.keys(base));
const nowKeys = new Set(Object.keys(out));
const added = [...nowKeys].filter(k => !baseKeys.has(k));
const removed = [...baseKeys].filter(k => !nowKeys.has(k));
const changed = [...nowKeys].filter(k => baseKeys.has(k) && base[k] !== out[k]);
// Raised by the ABSOLUTE identity check below. Kept separate from `changed` so
// the two failure modes stay distinguishable in the exit code's reason: values
// moving is one thing, an identity being untrue is another.
let identityFailures = 0;

const fieldNames = (keys: string[]) => [...new Set(keys.map(k => k.split('|').pop()!))].sort();

console.log(`fields: baseline ${baseKeys.size}, now ${nowKeys.size}`);
console.log(`\nSHAPE (informational — new or dropped fields are not a value change):`);
console.log(`  added   ${added.length}${added.length ? `  fields: ${fieldNames(added).join(', ')}` : ''}`);
console.log(`  removed ${removed.length}${removed.length ? `  fields: ${fieldNames(removed).join(', ')}` : ''}`);

console.log(`\nVALUES — THE GATE:`);
if (changed.length === 0) {
  console.log(`  0 changed. Every field present in both is bit-identical.`);
} else {
  const byField = new Map<string, string[]>();
  for (const k of changed) {
    const f = k.split('|').pop()!;
    if (!byField.has(f)) byField.set(f, []);
    byField.get(f)!.push(k);
  }
  console.log(`  ${changed.length} changed across ${byField.size} field(s):`);
  for (const [f, keys] of [...byField.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const ex = keys[0];
    console.log(`    ${f.padEnd(34)} ${String(keys.length).padStart(4)} instances   e.g. ${base[ex]} -> ${out[ex]}`);
  }

  // ==========================================================================
  // BROKEN IDENTITIES — reported SEPARATELY from ordinary movement, because
  // they are not the same kind of event and reading them as the same kind is
  // how a real defect shipped.
  //
  // ⚠ THIS RULE EXISTS BECAUSE THE GATE ALREADY CAUGHT THE BUG AND NOBODY
  // NOTICED. At the net-funding chain this script logged
  //   expectedCombinedRatio   111 instances   e.g. 1 -> 1.1734760163189506
  // in the middle of a list of 78 legitimately-moving fields, and it was read
  // as intended movement like everything around it. It was not: that field sat
  // at EXACTLY 1 on every line and every year because
  // poolPremium + admin + reinsurance is identically totalMemberCharge. A
  // field pinned to exactly 1.000 or exactly 0.000 across EVERY instance is a
  // CLOSED IDENTITY, not a value that happens to be round, and its departure
  // is a defect by construction rather than a change to be explained.
  //
  // The test is deliberately conservative — it fires only when the baseline
  // was exactly 1 or exactly 0 at EVERY instance of that field name, so a
  // quantity that is merely usually-zero (dividends, assessments, shock loss)
  // does not trip it. A field that legitimately leaves an identity will still
  // be listed here; the point is that it must be argued for explicitly rather
  // than disappearing into the ordinary list.
  // ==========================================================================
  const allByField = new Map<string, string[]>();
  for (const k of baseKeys) {
    const f = k.split('|').pop()!;
    if (!allByField.has(f)) allByField.set(f, []);
    allByField.get(f)!.push(k);
  }
  //
  // ⚠ "EXACTLY 1" MEANS TO FLOAT PRECISION, NOT BIT-EXACTLY, and that
  // distinction was nearly fatal to this rule. A closed identity evaluated by
  // SUMMING per-line terms picks up ordering noise: at the v15 measurement 6 of
  // 150 expectedCombinedRatio instances sat at 1 +/- 2e-16 rather than exactly
  // 1. A bit-exact test would therefore have refused to arm on the very field
  // this rule was written for, silently, from the first recapture onward.
  //
  // THE ASYMMETRY BETWEEN 1 AND 0 IS DELIBERATE. A value that should be 1 is a
  // RATIO — dimensionless — so 1e-12 is a meaningful scale-free bound. A value
  // that should be 0 has UNITS, so no scale-free epsilon exists for it; exact
  // is the only defensible test there and it errs toward firing, which is the
  // right direction for a guard.
  //
  // ⚠ BUT THE SAME BOUND MUST APPLY ON BOTH SIDES, and it did not. The rule
  // used 1e-12 to decide the baseline "was 1" and then STRICT INEQUALITY to
  // decide an instance had moved, so 1 -> 0.9999999999999999 counted as a break
  // of the identity. It fired that way during the TIV rescale, on pure float
  // noise, and a guard that cries wolf gets ignored — which is operationally
  // the same as a guard that cannot fire. That failure mode is the one this
  // project keeps rediscovering, and the rule had it two commits after being
  // written to prevent it.
  //
  // So `realMoved` re-tests each changed instance against the identity itself
  // rather than against its own baseline value. `changed` is still the right
  // input — it is the ordinary value gate and must stay strict — but leaving an
  // identity is a different question from moving at all.
  const IDENTITY_EPS = 1e-12;
  const broken: { field: string; was: number; moved: number; of: number; worst: number }[] = [];
  for (const [f, keys] of byField) {
    const every = allByField.get(f) ?? [];
    const wasAllOne = every.length > 0 && every.every(k => Math.abs(base[k] - 1) <= IDENTITY_EPS);
    const wasAllZero = every.length > 0 && every.every(k => base[k] === 0);
    if (!wasAllOne && !wasAllZero) continue;
    const target = wasAllOne ? 1 : 0;
    // Zero keeps its exact test, for the units reason above.
    const realMoved = wasAllOne
      ? keys.filter(k => Math.abs(out[k] - target) > IDENTITY_EPS)
      : keys.filter(k => out[k] !== target);
    if (realMoved.length === 0) continue;
    const worst = Math.max(...realMoved.map(k => Math.abs(out[k] - target)));
    broken.push({ field: f, was: target, moved: realMoved.length, of: every.length, worst });
  }
  if (broken.length > 0) {
    console.log(`\n  ⚠ BROKEN IDENTITIES — ${broken.length} field(s) left a value that was EXACTLY`);
    console.log(`  constant across every instance in the baseline. Treat each as a defect until`);
    console.log(`  argued otherwise; do NOT recapture past one without deciding it is intended.`);
    for (const b of broken) {
      const ex = byField.get(b.field)![0];
      console.log(`    ${b.field.padEnd(34)} was ${b.was} on all ${b.of} instances; ` +
        `${b.moved} left it by more than ${IDENTITY_EPS}, worst ${b.worst.toExponential(2)}, e.g. -> ${out[ex]}`);
    }
  }
}


// ============================================================================
// ABSOLUTE IDENTITY CHECK — is the identity TRUE, not merely UNMOVED?
//
// ⚠ THIS RUNS UNCONDITIONALLY, AND THAT IS THE WHOLE POINT. The BROKEN
// IDENTITIES rule above walks the CHANGED list, so it answers "did this
// depart from baseline" and can only speak when something departed. Two
// consequences, both real:
//
//   1. WHEN NOTHING CHANGES IT CANNOT FIRE, so its silence is not evidence.
//      The entire v20 -> v21 range moved 0 of 15,150 values across seven
//      commits. The relative rule was silent for all seven, and that silence
//      said nothing whatever about whether expectedCombinedRatio was still 1.
//      Verifying it by hand at the v21 recapture was the right instinct and is
//      the reason this section exists.
//
//   2. AN IDENTITY ALREADY WRONG WHEN FIRST BASELINED STAYS WRONG AND SILENT
//      FOREVER. The relative rule requires the baseline to be uniform to arm
//      at all, so a partly-broken identity is invisible to it by construction
//      — it is not in the changed list and it was never uniform.
//
// So: candidates are DETECTED from the baseline (the same uniformity test the
// relative rule uses) and then ASSERTED against the CURRENT capture, every run,
// whether or not anything moved. Case 2 is covered by the SUSPECTED PARTIAL
// section below, which looks for near-uniformity rather than uniformity.
//
// ⚠ AND BIT-EXACTNESS IS CLASSIFIED, NOT PASSED. A genuine identity computed
// two ways carries float noise: expectedCombinedRatio sums per-line terms and
// lands within 2.22e-16 of 1, never ON it. A field that is bit-exact on every
// single instance was not computed twice — it is a value minus itself, an
// inactive quantity, or a pinned constant. That is how Expense Ratio Check
// Difference was caught: exactly 0.0 on 480 of 480 scope-years, against a
// neighbour showing real 1e-16 noise on 289 of the same 480. Passing a
// tautology as a satisfied identity is the failure mode this whole file exists
// to prevent, so bit-exactness is reported separately rather than counted as a
// pass.
//
// ⚠ SCOPE LIMIT, SO THE PRECEDENT IS NOT MISREAD. This section sees RESULTSET
// FIELDS. Expense Ratio Check Difference is an AUDIT-PAGE ROW computed inside
// CalculationAuditPage, so it would never have appeared here — it is named above
// as the archetype of the pattern, not as something this check would have
// caught. Audit-page reconciliations are covered by audit-formula-check, which
// gained its own arms and prose checks for the same reason. Two files, two
// populations; neither is a substitute for the other.
// ============================================================================
{
  const IDENTITY_EPS_ABS = 1e-12;
  // ⚠ GROUPED BY (ARM, FIELD), NOT BY FIELD — AND POOLING THE ARMS SILENTLY
  // DROPPED FOUR DETECTIONS, INCLUDING THE ONLY GENUINELY HELD IDENTITY THIS
  // SECTION ASSERTS.
  //
  // Detection keys on UNIFORMITY across every instance. Adding the squeezed arm at
  // af5788a doubled the instance set with a configuration where several quantities
  // legitimately stop being uniform — so expectedCombinedRatio (= 1, the one real
  // identity here), fundingCLF, selectedFundingCLF and bookingGiveBack all fell
  // out of detection and their assertions vanished with no diagnostic. An arm
  // added to widen coverage had narrowed it.
  //
  // Per-arm grouping restores all four AND says something the pooled form could
  // not: bookingGiveBack is bit-exactly 0 in `def` and LIVE in `sqz`. Pooled, it
  // read as a probable tautology. Split, "inactive at defaults, live under
  // squeeze" is visible on the face of the report — which is the whole point of
  // having two arms.
  const byFieldAll = (keys: string[]) => {
    const m = new Map<string, string[]>();
    for (const k of keys) {
      const parts = k.split('|');
      const f = `${parts[0]}|${parts[parts.length - 1]}`;   // arm|field
      if (!m.has(f)) m.set(f, []);
      m.get(f)!.push(k);
    }
    return m;
  };
  const baseFields = byFieldAll([...baseKeys]);
  const nowFields = byFieldAll([...nowKeys]);

  // ⚠ DETECT LOOSE, ASSERT TIGHT — and that asymmetry is what closes the "already
  // wrong when first baselined" gap. If detection used the SAME 1e-12 band as the
  // assertion, a field baselined at a uniform 1.000000001 would not be recognised
  // as an identity at all: not in the changed list (it never moves), not uniform
  // at 1 (it is uniform at 1+1e-9), and therefore silent in both rules forever.
  // Recognising it as identity-SHAPED at 1e-6 and then holding it to 1e-12 is what
  // makes that case fail instead.
  //
  // THE BAND IS ONE-SIDED ON PURPOSE. A value that should be 1 is a RATIO, so a
  // dimensionless band is meaningful. A value that should be 0 has UNITS — there
  // is no scale-free epsilon for it — so zero keeps an EXACT test on both sides,
  // the same reasoning the relative rule above already records.
  const DETECT_BAND = 1e-6;
  const shapedLikeOne = (v: number) => Math.abs(v - 1) <= DETECT_BAND;
  const nearOne = (v: number) => Math.abs(v - 1) <= IDENTITY_EPS_ABS;
  const nearZero = (v: number) => v === 0;

  type Verdict = {
    field: string; target: 0 | 1; n: number;
    violations: number; worst: number;
    bitExact: number; noisy: number;
  };
  const held: Verdict[] = [];
  const violated: Verdict[] = [];
  const tautologies: Verdict[] = [];

  for (const [f, bKeys] of baseFields) {
    // DETECTED FROM THE BASELINE — the same uniformity test the relative rule
    // applies, so the two rules agree on what an identity IS and differ only in
    // what they do about it.
    const allOne = bKeys.length > 0 && bKeys.every(k => shapedLikeOne(base[k]));
    const allZero = bKeys.length > 0 && bKeys.every(k => nearZero(base[k]));
    if (!allOne && !allZero) continue;
    const target: 0 | 1 = allOne ? 1 : 0;

    // ASSERTED AGAINST THE CURRENT CAPTURE, every instance, every run.
    const cur = nowFields.get(f) ?? [];
    if (cur.length === 0) continue;   // field removed; the shape report covers that
    const bad = cur.filter(k => target === 1 ? !nearOne(out[k]) : !nearZero(out[k]));
    const bitExact = cur.filter(k => out[k] === target).length;
    const v: Verdict = {
      field: f, target, n: cur.length,
      violations: bad.length,
      worst: bad.length ? Math.max(...bad.map(k => Math.abs(out[k] - target))) : 0,
      bitExact, noisy: cur.length - bitExact,
    };
    if (bad.length > 0) violated.push(v);
    else if (bitExact === cur.length) tautologies.push(v);
    else held.push(v);
  }

  const total = held.length + violated.length + tautologies.length;
  console.log(`\nABSOLUTE IDENTITIES — asserted every run, independent of what moved:`);
  console.log(`  ${total} field(s) detected as an identity in the baseline (uniformly 1 or uniformly 0).`);

  if (held.length) {
    console.log(`\n  HELD, computed two ways (float noise present — the signature of a real identity):`);
    for (const v of held.sort((a, b) => a.field.localeCompare(b.field))) {
      console.log(`    ${v.field.padEnd(34)} = ${v.target} on all ${String(v.n).padStart(4)} instances   ` +
        `${v.noisy} carry noise, ${v.bitExact} bit-exact`);
    }
  }

  if (tautologies.length) {
    console.log(`\n  ⚠ BIT-EXACT ON EVERY INSTANCE — reported, NOT passed as satisfied identities.`);
    console.log(`  A quantity computed two ways does not land bit-exactly every time. Each of these`);
    console.log(`  is a value minus itself, a quantity that is simply inactive, or a pinned constant`);
    console.log(`  — and only reading it says which. A reconciliation-shaped NAME on this list is the`);
    console.log(`  strong signal: that is what Expense Ratio Check Difference looked like.`);
    const looksLikeCheck = (f: string) => /Difference|Check|TieOut|tieOut/.test(f);
    const suspicious = tautologies.filter(v => looksLikeCheck(v.field));
    const inactive = tautologies.filter(v => !looksLikeCheck(v.field));
    if (suspicious.length) {
      console.log(`\n    RECONCILIATION-SHAPED (a check that may be unable to fail):`);
      for (const v of suspicious.sort((a, b) => a.field.localeCompare(b.field))) {
        console.log(`      ${v.field.padEnd(34)} = ${v.target} bit-exactly on all ${v.n} instances`);
      }
    }
    if (inactive.length) {
      console.log(`\n    NOT RECONCILIATION-SHAPED (more likely inactive or pinned, still unverified):`);
      for (const v of inactive.sort((a, b) => a.field.localeCompare(b.field))) {
        console.log(`      ${v.field.padEnd(34)} = ${v.target} bit-exactly on all ${v.n} instances`);
      }
    }
  }

  if (violated.length) {
    identityFailures += violated.length;
    console.log(`\n  ⚠ IDENTITY VIOLATED — a field the baseline holds to be exactly ${''}1 or 0 does not read it NOW.`);
    console.log(`  This fires whether or not the field moved, which is what the relative rule cannot do.`);
    for (const v of violated.sort((a, b) => b.worst - a.worst)) {
      console.log(`    ${v.field.padEnd(34)} should be ${v.target}; ${v.violations} of ${v.n} instances are not, ` +
        `worst departure ${v.worst.toExponential(2)}`);
    }
  }

  // --- CASE 2: an identity that was ALREADY WRONG when first baselined -------
  //
  // Uniformity detection cannot see this by construction, so near-uniformity is
  // the only available signal. NOT GATED: a field that is merely usually-zero
  // (dividends, assessments, shock loss at default decisions) looks identical
  // from here, and gating on it would be the cry-wolf failure this file already
  // warns about twice. Reported so a real one can be recognised.
  const NEAR = 0.90;
  const partial: { field: string; target: 0 | 1; at: number; n: number; worst: number }[] = [];
  for (const [f, cur] of nowFields) {
    if (cur.length < 10) continue;
    for (const target of [1, 0] as const) {
      const hit = cur.filter(k => target === 1 ? nearOne(out[k]) : nearZero(out[k]));
      if (hit.length === cur.length) continue;               // uniform: handled above
      if (hit.length / cur.length < NEAR) continue;          // not identity-shaped
      const off = cur.filter(k => !hit.includes(k));
      partial.push({ field: f, target, at: hit.length, n: cur.length, worst: Math.max(...off.map(k => Math.abs(out[k] - target))) });
    }
  }
  if (partial.length) {
    console.log(`\n  SUSPECTED PARTIAL IDENTITY — ${NEAR * 100}%+ of instances sit exactly on 1 or 0 and the rest`);
    console.log(`  do not. This is the shape of an identity that was ALREADY BROKEN when it was first`);
    console.log(`  baselined, which uniformity detection can never see. NOT GATED: a merely`);
    console.log(`  usually-zero quantity looks the same from here.`);
    for (const p of partial.sort((a, b) => b.at / b.n - a.at / a.n)) {
      console.log(`    ${p.field.padEnd(34)} ${p.at}/${p.n} at exactly ${p.target}, worst outlier ${p.worst.toExponential(2)}`);
    }
  } else {
    console.log(`\n  SUSPECTED PARTIAL IDENTITY: none — no field sits on 1 or 0 for ${NEAR * 100}%+ of its`);
    console.log(`  instances without doing so for all of them.`);
  }
}

// ⚠ TWO GATES, TWO QUESTIONS, AND BOTH ARE KEPT. The relative rule answers "did
// this MOVE"; the absolute one answers "is this TRUE". Neither subsumes the
// other: a range that moves nothing silences the first, and an identity broken
// before it was ever baselined is invisible to it permanently. The v20 -> v21
// range is exactly the case where only the second one speaks.
// ⚠ THE TWO VERDICTS ARE STATED SEPARATELY BECAUSE THEY CAN DISAGREE, and the
// disagreement is the interesting case: "no value moved" and "an identity is
// false" are both true at once when a broken identity was baselined. Printing an
// unqualified HOLDS above a failure line would be the report contradicting
// itself.
const movedVerdict = changed.length === 0
  ? `VALUES UNMOVED${added.length || removed.length ? ' (shape changed — expected for a display-layer fix)' : ''}`
  : 'VALUES MOVED — if this was meant to be a display-only change, it was not one';
if (identityFailures > 0) {
  console.log(`\n${movedVerdict}, BUT ${identityFailures} ABSOLUTE IDENTITY FAILURE(S):`);
  console.log(`a field that must read exactly 1 or 0 does not. An unmoved wrong value is still`);
  console.log(`wrong — this is precisely what the relative rule cannot report.`);
} else if (changed.length === 0) {
  console.log(`\nVALUE IDENTITY HOLDS${added.length || removed.length ? ' (shape changed — expected for a display-layer fix)' : ''}.`);
} else {
  console.log(`\n${movedVerdict}.`);
}
process.exitCode = (changed.length === 0 && identityFailures === 0) ? 0 : 1;
