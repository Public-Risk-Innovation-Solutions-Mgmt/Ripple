// PER-OCCURRENCE REINSURANCE TOWER — structure, measured expected-loss constants
// and the aggregate stop-loss parameters.
//
// ============================================================================
// ⚠ LOSS ENGINE COMMIT 4a CUT THE TOWER AT THE PACKAGES' EDGES. A team now buys
// ONE PACKAGE per line (REINSURANCE_OPTIONS in pricingParameters.ts) instead of
// placing or declining each band, and every package is a set of whole layers
// below: WC and GL $4M xs $1M, $5M xs $5M and $5M xs $10M (the packages end at
// $15M); Property $20M xs $5M and $25M xs $25M (they end at $50M). Above the
// top is retained, as above any tower — GL to its $25M pool limit. The aggregate
// stop-loss is no longer offered; its parameters below are kept, unwired.
// Much of what follows records the tower before the cut and is kept for its
// reasoning: read the layer figures in it as history.
// ============================================================================
//
// Replaces the aggregate quota-share model (REINSURANCE_PROGRAMS) for WC, GL and
// (as of the retention/aggregate commit) Property. REINSURANCE_PROGRAMS and
// reinsuranceEngine.ts are gone — Property was the model's last consumer.
//
// ============================================================================
// ⚠ PROPERTY'S TOWER IS ONE TREATY: $995M xs $5M PER OCCURRENCE. A CATASTROPHE
// CLAIM IS A CLAIM.
//
// Every Property occurrence — an attritional claim, or a regional catastrophe
// summed into one occurrence — retains the same $5M and is covered above it to
// a $1B top. One occurrence per region stays, because that is the geography:
// an event across two regions is two occurrences and retains $10M, which is
// what a real programme does.
//
// WHAT CAME OUT, AND WHY (the ruling, not a re-tune): a separate cat layer
// attaching at $37.5M, a $500M cat ceiling, and the rule that each layer
// answered only one KIND of occurrence (TowerLayer.responds). The $37.5M was a
// game lever invented to create volatility; the $500M was sized by sweeping
// exceedance; and the do-not-stack rule existed only because two layers
// overlapped on $37.5M-$75M. With one layer there is nothing to stack.
//
// THE TOP IS $1B, THE REAL PROGRAMME'S PER-OCCURRENCE LIMIT, and it is NOT the
// severity cap. The two coincided ($75M) only while occurrence == claim; a
// regional event summed into one occurrence broke that. An attritional claim
// still cannot exceed the $75M cap, so on attritional loss this layer cedes
// exactly what $70M xs $5M did — the extra limit is reached only by events.
//
// The paragraphs below are the one-layer record, kept for the reasoning; read
// them with the above in mind.
// ============================================================================
//
// ============================================================================
// PROPERTY'S TOWER IS ONE LAYER, NOT THREE, AND THAT IS THE WHOLE STRUCTURE.
//
// $70M xs $5M, to the fitted severity mixture's own cap ($75M) — see
// PROPERTY_LOSS_MODEL.severityCap. There is no band above it to retain
// unlimited, unlike WC/GL: the model itself caps every claim at $75M, so
// TOWER_TOP.Property equals the severity cap exactly and `retainedAboveTower`
// is always ~0 by construction, not a market-capacity choice.
//
// RETENTION IS $5M, decided before this commit (perRiskRetention in
// PROPERTY_LOSS_MODEL was $2M, inherited from roster v3 and explicitly flagged
// there as needing re-derivation "when Property gets its per-occurrence tower" —
// this is that commit, and $5M supersedes it).
//
// OCCURRENCE == CLAIM for the fitted (attritional) severity mixture, so
// min(claim, $5M) is the correct per-occurrence retained amount today. THIS IS
// NOT GUARANTEED TO STAY TRUE. If a cat band is ever added, a single
// catastrophe must be modeled as ONE OCCURRENCE whose claims (one per member
// hit) share that occurrence's id — see the Occurrence/Claim note below. Get
// the grouping wrong and a $74M storm hitting 20 members becomes 20 claims
// averaging $3.7M each, none of which reaches the $5M retention, and the
// programme cedes nothing on the exact event it exists to cover.
//
// THE MECHANISM ALREADY HANDLES THIS CORRECTLY, TODAY, WITH ZERO CAT CLAIMS.
// `occurrenceTotals` (below) groups by `occurrenceId` and sums every claim in
// an occurrence BEFORE the layer sees it — it does not assume one claim per
// occurrence, it is simply never exercised on more than one because
// `generatePropertyClaims` does not yet emit a multi-claim occurrence. A future
// cat band only has to construct its Occurrence/Claim objects correctly
// (multiple claims, one shared occurrenceId, all in `occurrence.claimIds`); the
// tower requires no change to layer them as one event. This is written here,
// now, so the requirement is load-bearing on the generator from day one rather
// than discovered the day the first cat claim silently under-cedes.
// ============================================================================
//
// ============================================================================
// THE TOWER, AND WHY IT IS ASYMMETRIC
//
//   WC:  $4M xs $1M | $5M xs $5M | $15M xs $10M | $25M xs $25M
//   GL:  $4M xs $1M | $5M xs $5M | $15M xs $10M | NOTHING ABOVE $25M
//
// ⚠ GL STOPS AT $25M BECAUSE MARKET CAPACITY ABOVE THAT IS HARD TO FIND. That
// is a MARKET constraint, not a statement that the exposure is remote — the
// opposite: GL law-enforcement severity is Pareto(alpha 1.3), infinite
// variance, and the generator produces occurrences past $1 BILLION. The pool
// retains everything above $25M on GL, unlimited, and that band is what surplus
// stands behind. It is surfaced as `retainedAboveTower` precisely because it
// exceeds the top layer the pool actually buys.
//
// DO NOT "FIX" THIS ASYMMETRY by extending GL to match WC. The gap is the point.
// Adding an unlimited GL top layer asserts that a market exists to write it, and
// that assertion needs its own evidence.
// ============================================================================
//
// OCCURRENCE BASIS (J14). Layers attach to the OCCURRENCE total, not to any one
// claim — a GL abuse batch is one occurrence across several claimant claims and
// the treaty sees their sum. Two rules interact and are easy to transpose:
//
//   the STATUTORY CAP applies to INDEMNITY ONLY, per claim, stateLaw only
//   the RETENTION applies to INDEMNITY + ALAE COMBINED, per occurrence
//
// So a state-law claim can be capped on damages and still reach the treaty on
// defense costs. Order: cap each claim's indemnity, add its ALAE, sum the claims
// in the occurrence, then layer that total.
//
// ============================================================================
// ⚠ KNOWN SIMPLIFICATION: NO ANNUAL AGGREGATE LIMIT MEANS NO REINSTATEMENTS.
//
// Every layer here responds to every qualifying occurrence, without limit, all
// year. Real excess-of-loss treaties cap that with an annual aggregate limit or
// one to two reinstatements, so THIS TOWER IS MORE GENEROUS THAN MARKET — it
// understates cost and overstates protection.
//
// This is not a rare edge. Share of years seeing 2+ penetrations of a layer,
// every one covered in full:
//   GL $4M xs $1M    62.6%
//   WC $4M xs $1M    18.0%
//   GL $5M xs $5M     9.9%
//   GL $15M xs $10M   3.7%
//
// DELIBERATELY NOT BUILT. Recorded so it is a known simplification rather than
// an unnoticed one. Adding reinstatements would need a mechanic (annual
// consumption tracked per layer) and would change every price here.
// ============================================================================



export type TowerLine = 'WC' | 'GL' | 'Property';

export interface TowerLayer {
  name: string;
  attachment: number;
  limit: number;
  // Layers that exist but cannot currently be bought. See WC's top layer.
  purchasable: boolean;
}

// THE TOP OF PROPERTY'S TOWER, $1B PER OCCURRENCE — the real programme's limit,
// and the one number in this structure with a source. It replaces the $500M
// cat ceiling, which was sized by sweeping exceedance on one enrolled book.
// What a single occurrence draws above it lands in retainedAboveTower,
// visibly.
// ⚠ $50M SINCE LOSS ENGINE COMMIT 4a — the top of the largest package. It
// was $1B, one treaty to the real programme's limit; see the history above.
export const PROPERTY_TOWER_TOP = 50_000_000;

// PER-PERIL DEDUCTIBLES — a Property occurrence of a named peril retains this
// much before the tower responds, instead of the layer's own $5M attachment.
// A peril not listed inherits the attachment, so the next peril with its own
// deductible is a row here rather than a branch in the cession.
//
// EARTHQUAKE $10M, PER OCCURRENCE — and a cat occurrence is one region, so per
// region. The real programme's structure: earthquake carries a higher
// deductible than every other peril because it is the correlated tail the
// reinsurer prices hardest. NOT the retired $37.5M catastrophe retention,
// which applied to every catastrophe and was a volatility lever; this applies
// to one peril and comes from the programme. Flat, not a percentage: a
// percentage of affected value would need which members were hit, which the
// exact event distribution does not keep.
//
// The top does not move: a $10M deductible makes the earthquake's layer
// $990M xs $10M under the same $1B occurrence limit.
export const PROPERTY_PERIL_DEDUCTIBLE: Readonly<Record<string, number>> = {
  earthquake: 10_000_000,
};

// ============================================================================
// ⚠ THERE ARE NO PRICING CONSTANTS IN THIS FILE ANY MORE. A LAYER IS ITS BOUNDS.
//
// `expectedCededPer100` and `sdOverExpected` used to live on TowerLayer, measured
// from the generators and frozen. Both are gone; the price is computed at runtime
// from the enrolled book and the current year in src/utils/towerMoments.ts. The
// full argument is in that module's header, but the short version, because the
// second half of it is the part that was missed for a long time:
//
//   expectedCededPer100 FROZE LEGITIMATELY BUT WENT STALE. A per-occurrence
//   layer's expected ceded loss really is LINEAR in exposure (verified across a
//   4.4x range, within 2%), so a per-$100 constant was the right SHAPE. But it
//   was multiplied by NOMINAL exposure, which grows at the wage rate, while the
//   actual ceded loss grows with the SEVERITY trend through a convex layer.
//   Over a decade: GL +22% / +33% / +41% by layer, WC +17% on its top layer.
//
//   sdOverExpected NEVER FROZE LEGITIMATELY AT ALL. SD/E scales as
//   ~1/sqrt(exposure) — its basis IS its value, so a single stored number is
//   wrong at every book size but one. Frozen at GL's stored 0.97, an $82M pool
//   was undercharged 19.9% and the full market overcharged 24.5%. The pools with
//   the least surplus standing behind the retention were paying the least for it.
//   The two lines were not even on the same basis: GL's figures came from a
//   ~$380M enrolled book, WC's from full market.
//
// WHAT STILL INVALIDATES THE *STRUCTURE* (attachments, limits, purchasability) —
// these are judgment calls, not measurements, and should be revisited if:
//   - the layer attachments or limits change
//   - a band's pierce frequency moves far enough to change whether it is a real
//     purchase decision (WC merged its top two layers when $25M xs $25M fell to
//     once per 27 years; GL's top layer pierces every 1.2 years and stays)
//   - market capacity above GL's $25M changes
// Severity, frequency, trend and roster changes NO LONGER invalidate anything
// here — that is the point of computing the price. GL_SEVERITY_CAP in particular
// is EXACTLY irrelevant to every band inside the tower: every GL layer bound is
// <= $25M and the cap is $100M, so min(X, cap) > 25M exactly when X > 25M and a
// cession is bit-identical either way (measured: 0.0e+0 relative difference). It
// reaches only the retained band above the tower, which it bounds at $75M.
// ============================================================================

// A purchasable layer, NAMED FROM ITS OWN TERMS. The names were literals beside
// the numbers they describe ("$4M xs $1M" next to attachment 1e6, limit 4e6) —
// the same restatement Property's entry already avoided by building its name.
// A re-pinned attachment now renames the layer on every screen that shows it.
function layer(attachment: number, limit: number): TowerLayer {
  return { name: `$${limit / 1e6}M xs $${attachment / 1e6}M`, attachment, limit, purchasable: true };
}

// ⚠ EVERY LINE IS CUT AT $1M, $2M, $10M, $20M, $30M AND $40M — the edges of the
// eight T covers (pricingParameters REINSURANCE_OPTIONS: 9, 19, 29 and 39 xs 1;
// 8, 18, 28 and 38 xs 2), so each cover is whole layers (wip/reinsurance-layers
// added the $30M cut). The cuts the earlier packages needed, and the notes on
// them, are in this file's history.
const T_COVER_TOWER = (): TowerLayer[] => [
  layer(1e6, 1e6), layer(2e6, 8e6), layer(10e6, 10e6), layer(20e6, 10e6), layer(30e6, 10e6),
];
export const REINSURANCE_TOWER: Record<TowerLine, TowerLayer[]> = {
  WC: T_COVER_TOWER(),
  GL: T_COVER_TOWER(),
  Property: T_COVER_TOWER(),
};

// Top of each tower — the top of the widest T cover. Above it the pool retains,
// unlimited. (PROPERTY_TOWER_TOP stays the old engine's, read by propertyCatastrophe.)
export const TOWER_TOP: Record<TowerLine, number> = { WC: 40e6, GL: 40e6, Property: 40e6 };

// ============================================================================
// THE RISK LOAD — one market parameter, not four chosen multiples.
//
//   premium = E[ceded] + RISK_LOAD_LAMBDA x SD[ceded]
//
// A standard-deviation risk load. It RISES WITH ATTACHMENT automatically,
// because SD/E rises with remoteness — the reinsurer charges for CAPITAL, and SD
// is the capital proxy. Nothing here was hand-tuned per layer.
//
// Resulting multiples at lambda 0.60, and the measured SD/E behind each:
//   WC 4xs1    SD/E 1.54 -> 1.92x     GL 4xs1    SD/E 0.97 -> 1.58x
//   WC 5xs5    SD/E 2.32 -> 2.39x     GL 5xs5    SD/E 1.51 -> 1.91x
//   WC 15xs10  SD/E 3.87 -> 3.32x     GL 15xs10  SD/E 2.16 -> 2.29x
//
// WHY 0.60: it lands working layers at 1.6-1.9x and top layers at 2.3-3.3x,
// against real-market multiples of roughly 1.2-1.6x for working layers and 2-3x
// for middle layers. The top-layer multiples look modest for "high excess"
// because THESE LAYERS ARE NOT REMOTE IN THIS BOOK — GL's top layer is
// penetrated 0.30 times a year, once every three years. That is a working layer,
// and a 6-10x multiple would be wrong for it.
//
// THE BEHAVIOUR THAT VALIDATES THE APPROACH: GL's top layer prices at 1.6155 per
// $100 against WC's 0.2874, despite a LOWER multiple (2.29x vs 3.32x), because
// it is genuinely more exposed. A uniform loading would have been wrong in both
// directions at once — too dear on WC's top layer and far too cheap on GL's.
// ============================================================================
// ⚠ ZERO. EVERY LAYER IS PRICED AT 1x ITS EXPECTED CESSION, AND THE REASON IS A
// MEASURED DEFECT RATHER THAN A VIEW ABOUT REINSURANCE PRICING.
//
// AT 0.60, DECLINING COVER WON ON BOTH MONEY AND SAFETY, WHICH MAKES THE WHOLE
// DECISION A TRAP. Measured on WC solo over ten years: full cover ended at $23M
// with a 12% chance a line went negative; NO cover ended at $118M with 1%. No
// player should ever have bought a layer.
//
// THE MECHANISM IS THE DECLINED-COVER MARGIN, NOT THE LOAD ITSELF. A pool that
// declines still CHARGES its members the tower price — see
// retainedCoverMargin and DECLINED_COVER_MARGIN_ENABLED — and keeps it as
// surplus. Most of that price was load, so declining pocketed the load for free
// while the expected cession it gave up was, by construction, only the expected
// cession. Buying cover meant paying the load; declining meant being paid it.
//
// AT ZERO, a declined pool keeps exactly the EXPECTED cession as its margin and
// no more. It therefore keeps the same money in expectation and takes on all of
// the volatility, which is the trade a reinsurance decision is supposed to be.
// Members pay the tower either way, so cheaper cover also lowers their bill.
//
// ⚠ A STARTING POINT, NOT THE ANSWER, AND IT IS DELIBERATELY TOO GENEROUS. At
// lambda 0 reinsurance is actuarially free: no reinsurer prices at its own
// expected loss, and more cover is now weakly better at every attachment. If
// cover proves too cheap in play, load comes back — and the thing to watch is
// whether every placement beats declining, which is the signal that the price
// carries no cost at all.
//
// ⚠ AND IT APPLIES TO EVERY LAYER ON EVERY LINE, not only the catastrophe
// layer. The three readers are reinsuranceTower.ts (occurrence layers),
// propertyAggregate.ts (the aggregate stop) and nothing else; all three read
// this constant rather than restating it, so one edit moves all of them.
//
// ⚠ WHAT THIS DOES NOT FIX, AND IT MATTERS FOR READING THE RESULT. Large claims
// are booked well below their eventual cost and develop slowly, so the
// catastrophic years that should punish a declined pool arrive understated
// inside a ten-year game. Zero load removes the free money; it does not make a
// declined pool feel the tail it has taken on. That is the converging-climb work
// on feature/fast-development, and the two are additive rather than
// alternatives. NEITHER ALONE MAKES DECLINING LOSE — stated flatly so the next
// reader does not assume this constant settled it.
//
// MEASURED, 10-year horizon, full cover against none, at lambda 0:
//   WC        $29.3M vs $71.8M   (was -$99.3M of advantage, now -$42.5M)
//   GL        $38.3M vs $144.5M  (was -$207.0M, now -$106.2M)
//   Property  $45.0M vs $121.7M  (was -$321.6M, now -$76.7M)
// Zero load HALVES declining's advantage and does not reverse it. The residue is
// not the load. A fully covered pool pays and recovers, at lambda 0:
//   WC  $44.62M paid / $6.31M recovered (0.14)
//   GL  $128.64M / $16.04M (0.12)
//   Property  $137.20M / $102.10M (0.74)
// Layers are priced on the DRAWN severity and recover on the BOOKED occurrence,
// and forward booking contracts the booked figure below the attachment. Property
// fares far better only because catastrophes book at full severity. Ever-negative
// surplus, full against none: WC 0%/0%, GL 0%/0%, Property 17%/25%.
// ============================================================================
// ⚠ DEFINED IN pricingParameters.ts NOW, re-exported here. Same value (0).
export { REINSURANCE_RISK_LOAD_LAMBDA as RISK_LOAD_LAMBDA } from './pricingParameters';

// ============================================================================
// WC AGGREGATE STOP-LOSS — priced at runtime, deliberately.
//
// SCOPE: total annual RETAINED loss, INCLUDING loss retained through UNPLACED
// occurrence layers, not merely loss below the $1M retention. That scope is
// load-bearing: an aggregate covering only sub-retention loss would not respond
// to the layer selection at all, and the interaction below is the whole reason
// the cover exists.
//
// WHY THE PRICE IS COMPUTED AND NOT LOOKED UP. Its expected cost depends on the
// VOLATILITY of retained loss, which pools as 1/sqrt(exposure), and it
// additionally depends on a decision made in the same turn — which occurrence
// layers the player bought.
//
// ⚠ THIS NOTE USED TO SAY "the per-occurrence constants above freeze safely" as
// the contrast. They did not, and they are gone — see the header. The aggregate
// was right to be computed; the occurrence layers have now joined it.
//
// Declining occurrence layers puts catastrophic claims back into the retention,
// raising retained volatility, raising the aggregate's expected cost. Measured
// on the enrolled book at a 125% attachment, E[ceded] by selection:
//   all four occurrence layers bought   $50k
//   none bought                       $1,058k
// A 21x swing. Freezing this price would make "decline every occurrence layer,
// buy the aggregate at 110%" free volatility transfer: the pool would shed its
// year-to-year swing at a price set for a book that had already capped every
// large claim. DESIGN INTENT: "retain more per occurrence, cap the annual
// total" IS a viable alternative strategy, and it is priced fairly rather than
// blocked.
//
// GL GETS NO AGGREGATE, and there is a second reason beyond market capacity: the
// lognormal fit below is valid for WC (retained-loss CV 0.15-0.41) and FAILS for
// GL (CV > 1, Pareto tail). Checked against the empirical, the closed form ran
// up to +195% wrong on GL. A pricing model that cannot price the cover honestly
// is a reason not to sell it.
//
// THE MODEL. Annual retained loss R is a compound sum, then
// lognormal-approximated for the layer integral:
//   E[R]     = E[gross] - E[ceded by the placed occurrence layers]
//   CV[R]    = from towerMoments.retainedRiskMoments, at the current year
//   SD[R]    = E[R] x CV[R]
// then the aggregate layer expectation and its SD come from lognormal partial
// moments in closed form (claimMath.lognormalPartialMoment).
//
// VALIDATION vs the empirical, WC, all selections at three attachments: the
// closed form tracked the simulation closely at low attachments and low CV
// (e.g. no layers at 110%: $1,434k empirical vs $1,445k closed form; all layers
// at 125%: $50k vs $52k). It drifts where the value is small and the tail thin,
// which is the safe direction to be wrong.
//
// ============================================================================
// ⚠ TWO CONSTANTS WERE DELETED HERE, AND THE SECOND DELETION FIXED A REAL BUG.
//
// AGG_OCC_FREQ_PER_1M (1.3733) was WC occurrences per $1M, applied at the call
// site to NOMINAL (wage-inflated) exposure. WC's occurrence COUNT tracks REAL
// (frozen) payroll x wcFrequencyTrend — payroll growth is pure wage inflation and
// letting claim counts ride it asserts that paying people more injures more of
// them. So modelled lambda grew 3.63%/yr while true lambda grew at the frequency
// trend. This was NOT a staleness problem and would have survived any
// re-measurement of the table: the constant was fine, the basis it was applied
// to was wrong. Worse, E[R] came from the correctly-trended expectedGrossLoss
// while SD[R] came from this lambda, so the CV handed to the lognormal was wrong
// in a way neither input revealed on its own.
//
// AGG_OVERDISPERSION (1.05) was a fudge back-solved to widen a pure-Poisson SD
// into the measured one, standing in for per-member Gamma frequency noise the
// stored table could not represent. retainedRiskMoments carries that noise
// analytically (its B2 term), so keeping the multiplier would double-count it.
//
// WC_RETAINED_SECOND_MOMENT was an 8-entry table indexed by placement bitmask,
// frozen at year-1 dollars. Retained loss is a SECOND moment, so it grows roughly
// as trend^2 and the table understated SD[R] by more every year — the aggregate
// got cheaper in real terms exactly as the risk grew. It is now integrated in
// closed form band by band (retained loss is piecewise linear in the occurrence
// total, so this is exact, not an approximation), which also retires the
// bitmask-index hazard the old comment warned about: there is no index to get
// wrong, because there is no table.
// ============================================================================

// ATTACHMENT SET, as a multiple of EXPECTED RETAINED LOSS — recalculated from
// the player's occurrence-layer selection every year, never a fixed dollar
// figure (which would go stale as the book grows and would ignore the retention
// structure entirely).
//
// 110 / 125 / 150 spans the market range for aggregate stop-loss. Measured
// E[ceded] across the set shows why all three are meaningful choices when
// occurrence layers are declined ($1,434k / $1,058k / $588k with none bought)
// and why only the lowest is meaningful once they are bought ($263k / $50k /
// $1k with all four). THAT IS THE CORRECT SIGNAL, NOT A BUG: an aggregate on top
// of full occurrence cover genuinely is nearly worthless, and the price says so.
//
// ⚠ ONLY WC AND PROPERTY HAVE AN AGGREGATE. GL does not (market capacity, and —
// separately — its retained-loss CV fails the lognormal fit quoteAggregate uses
// for WC; see that function's header). Keyed on the two lines that actually
// have one rather than carrying a meaningless GL entry.
export const AGG_ATTACHMENT_LEVELS: Record<'WC' | 'Property', readonly number[]> = {
  WC: [1.10, 1.25, 1.50],

  // TWO LEVELS, chosen for a WIDE FREQUENCY SPREAD rather than a market-range
  // triple like WC's — two levels close together would be one decision with a
  // nudge. Derived by Monte Carlo against the roster v6 enrolled book
  // (scripts/diagnostics/property-tower-mc.ts), NOT the pre-rescale plan's
  // figures — the roster moved twice since that plan and would have made those
  // numbers wrong by construction, not just stale.
  //
  // Measured at that book (E[retained[ $12.12M, occurrence layer purchased):
  //   0.83 x E[R] -> attachment rounds to $10M, fires ~61% of years (~3-in-5,
  //                  matching the real-market aggregate reference the decision
  //                  to build one at all was argued from)
  //   1.49 x E[R] -> attachment rounds to $18M, fires ~14% of years (~1-in-7)
  // A >4x gap in firing frequency and an $8M gap in dollar attachment — a real
  // choice between "smooths a bad year" and "catastrophe backstop only", not
  // two numbers a player would treat as the same decision.
  Property: [0.83, 1.49],
};

// LIMIT, as a multiple of expected retained loss. A LIMIT IS REQUIRED: an
// unlimited aggregate is hard to price honestly and would make the upper
// occurrence layers pointless, since the annual cap would absorb any single
// large occurrence too.
//
// 100% of expected retained loss, because it covers roughly a +3 sigma year on
// the smoothed configurations (enrolled E[R] $10.4M, SD $1.6M with all layers
// bought) while leaving a single catastrophic occurrence LARGELY RETAINED — a
// $37M occurrence against a ~$12.8M limit still leaves the pool most of it. So
// the aggregate complements the occurrence tower instead of substituting for it,
// and it scales with the book automatically.
//
// SHARED ACROSS WC AND PROPERTY, not re-derived per line — a limit expressed as
// a multiple of the line's OWN expected retained loss already scales with that
// line's book, which is the property that made re-deriving it for Property
// unnecessary. Re-derive it separately only if a line-specific reason to differ
// ever appears.
export const AGG_LIMIT_MULTIPLE = 1.00;

// Default placement for a NEW game and for any save that predates the tower:
// every PURCHASABLE layer placed, no aggregate. KEYED PER LINE, not one flat
// array — a flat array sized to WC's layer count silently discarded every
// placement decision on any line whose tower has a different number of layers,
// via normalizeLayersPlaced's length check (`placed.length !== layers.length`
// -> revert to all-purchasable). Property's one-layer tower is exactly that
// case: reusing WC's 3-element array would have made every Property placement
// a no-op.
/**
 * Every PURCHASABLE occurrence layer placed — the tower as offered, independent
 * of what the player chose.
 *
 * ⚠ IT IS NOT DEFAULT_LAYERS_PLACED, THOUGH THEY HAPPEN TO AGREE TODAY. That
 * one is a DECISION's opening position and may be changed as a game-design
 * choice; this one is the REFERENCE the declined-cover margin and the pool-layer
 * loss split are measured against, and it must stay "all of it" whatever the
 * opening position becomes. Deriving it from `purchasable` is what keeps the two
 * from drifting into each other.
 */
export const FULL_OCCURRENCE_PLACEMENT: Record<TowerLine, boolean[]> = {
  WC: REINSURANCE_TOWER.WC.map(l => l.purchasable),
  GL: REINSURANCE_TOWER.GL.map(l => l.purchasable),
  Property: REINSURANCE_TOWER.Property.map(l => l.purchasable),
};

export const DEFAULT_LAYERS_PLACED: Record<TowerLine, boolean[]> = {
  WC: REINSURANCE_TOWER.WC.map(l => l.purchasable),
  GL: REINSURANCE_TOWER.GL.map(l => l.purchasable),
  Property: REINSURANCE_TOWER.Property.map(l => l.purchasable),
};
