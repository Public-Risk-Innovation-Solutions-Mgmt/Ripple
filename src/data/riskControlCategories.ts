// ============================================================================
// RISK CONTROL, AS FIVE CATEGORIES INSTEAD OF ONE INTENSITY DIAL.
//
// ⚠ TWO OF THE FIVE NOW REACH THE ENGINE. THIS FILE IS NO LONGER INERT.
//
// `gl-law-enforcement-analytics` reduces GL CLAIM FREQUENCY on a three-year
// ramp, and `wc-safety-rtw` cuts WC frequency and converts lost-time WC claims
// to medical-only. The mechanisms, the magnitude and the rule for composing with a shock
// live in src/utils/riskControlPrograms.ts; this file still holds only the
// DESCRIPTION — id, name, scope, term, benefit shape — and the engine reads the
// program by id rather than reading these fields.
//
// ⚠ SO `commitmentYears` AND `benefit` ARE STILL DESCRIPTIONS, NOT THE
// SCHEDULE, AND THAT SPLIT IS DELIBERATE RATHER THAN UNFINISHED. The catalog
// says the GL program is three years and `ramped`; riskControlPrograms.ts says
// the ramp is [0, 0.5, 1] and the reduction is 5%. A reader changing
// `benefit: 'ramped'` here changes what the department page SAYS and not what
// the engine DOES. If that ever becomes confusing enough to matter, the fix is
// to derive one from the other — not to duplicate the numbers into this file.
//
// ⚠ AND THE WC ENTRY'S `benefit: 'immediate'` IS NOW ONLY HALF TRUE. Both of
// its levers act from year one, which is what the label says — but safety
// ramps 25/60/100 and RTW 75/100/100. Left as `immediate` because changing it
// changes the department page's text, which this engine change must not do;
// see riskControlPrograms.ts for the real schedule.
//
// ⚠ THE COUNT ABOVE IS STALE AND THE CORRECTION IS WORTH READING, BECAUSE THE
// FOURTH PROGRAM IS NOT SHAPED LIKE THE FIRST THREE. FOUR of the five now reach
// the engine: the claims system joined as a THIRD TILE, and property-mitigation
// has joined as something else entirely.
//
// ONLY member-services reaches nothing. WIRED_PROGRAM_IDS in
// riskControlPrograms.ts is the list that decides for the TILE programs, and it
// has three entries; which of those a player can COMMIT is a separate list,
// BUYABLE_PROGRAM_IDS, which has the same three, each with its own standing and
// charge.
//
// ⚠ property-mitigation IS IN NEITHER LIST, AND THAT IS THE POINT RATHER THAN AN
// OVERSIGHT. It is not a tile. It is what the pool-wide dial,
// SLIDER_RANGES.riskControlPct, now BUYS on Property: 0 to 8% of that line's own
// pool premium, in 1% steps, taken from the loss fund rather than added to the
// member's bill, buying a cut in BUILDING claim frequency that reaches scheduled
// winter storms and does not reach catastrophes. The mechanism, the building
// scaling and the measurements are in riskControlPrograms.ts under PROPERTY LOSS
// PREVENTION & MITIGATION.
//
// So the sentence this replaces — "the two mechanisms are independent" — is no
// longer true of Property. It is still true of WC and GL, where the dial does
// what it always did. A future commit that retires riskControlPct must say what
// replaces it ON PROPERTY, which is now a harder question than it was.
//
// ⚠ AND THE DIAL STILL HAS NO UI, SO NO PLAYER CAN BUY MITIGATION YET. It is
// pinned at 0, nothing in the shipped game sets it, and both value baselines are
// unmoved by this commit for exactly that reason. Exposing it is a separate
// decision because the dial is POOL-WIDE: a slider on the Decisions page would
// switch on WC's and GL's generic frequency discount at the same time, and those
// two have tile programs of their own that overlap it. This commit builds what
// the dial does on Property and leaves when a player may touch it to the commit
// that answers that.
//
// WHY THE TILES SHIPPED INERT, kept because it is still the rule for the
// remaining one: risk control reaches the DRAW. Deleting the slider and
// replacing it with boxes that do nothing would remove a working lever and move
// both value baselines for what is, that commit, a display change. Instead the
// slider keeps working and keeps spending while these boxes are rearranged; ONE
// later commit swaps the spend across and removes the slider, and no commit in
// between has to put a lever back.
//
// ============================================================================
// WHAT THE CATEGORIES ARE FOR, AND WHY THEY ARE NOT ONE NUMBER.
//
// A dial says "spend 4% of premium on safety" and cannot express the two things
// that make risk control a real decision for a public-entity pool:
//
//   1. IT IS BOUGHT IN PROGRAMS, NOT IN INTENSITY. A pool commits to a
//      three-year return-to-work program; it does not commit to 4%.
//   2. THE BENEFIT ARRIVES ON THE PROGRAM'S OWN CLOCK. WC safety pays back
//      quickly because WC losses report quickly. Liability losses emerge over
//      years, so law-enforcement analytics cannot pay back in year one whatever
//      is spent. A capital system pays back NOTHING until it is finished.
//
// A single intensity dial collapses all three timings into one, which is what
// makes the current control unteachable: the player cannot get the timing wrong,
// so they cannot learn it.
//
// ============================================================================
// ⚠ MULTI-YEAR COMMITMENTS DEFAULT TO CONTINUING, AND THAT IS THE POINT.
//
// A player chooses to STOP, not to continue. That is how a real program
// behaves — nobody re-signs a safety consultant every January — and it is the
// only arrangement under which abandoning a program partway is a decision the
// player has to actually make rather than one they make by forgetting. The
// opt-out is also where the teaching is: stopping a three-year program in
// year two should cost the years already spent.
//
// NONE OF THAT BEHAVIOR IS BUILT. `commitmentYears` and `benefit` below are
// DESCRIPTIONS for the display, not a schedule the engine runs.
// ============================================================================

import type { CoverageLine } from '../types/simulation';

/** Which book a category's spend and benefit land on. 'Pool' is every line. */
export type RiskControlScope = CoverageLine | 'Pool';

/** How the benefit arrives once the money is committed. DISPLAY ONLY. */
export type BenefitShape =
  /** Full effect from the first year of the commitment. */
  | 'immediate'
  /** Builds across the years of the commitment — slow-emerging losses. */
  | 'ramped'
  /** Nothing until the commitment completes, then the full effect. */
  | 'onCompletion';

export interface RiskControlCategory {
  id: string;
  /**
   * THE AUTHOR'S NAME FOR THE PROGRAM, as it heads the supplied description in
   * riskControlProgramCopy.ts. Authoritative — the department page and this
   * field must not disagree.
   */
  name: string;
  /**
   * The same program, abbreviated for the compact tile.
   *
   * ⚠ TWO NAMES IS A COMPROMISE AND IT IS STATED RATHER THAN HIDDEN. The tiles
   * sit five-across in half a card; "Workers' Compensation Safety &
   * Return-to-Work Program" does not fit one at a readable size. The full name
   * is what the department page shows and what a player reads when deciding;
   * this is the label on the chip. If the tiles ever get more room, delete this
   * field and render `name`.
   */
  tileName: string;
  scope: RiskControlScope;
  /**
   * Years the commitment runs.
   *
   * ⚠ WAS `number | readonly [number, number]`, AND THE RANGE IS GONE BECAUSE
   * NOTHING USES IT. Claims Management was the only range at 2-4 years and is
   * now a fixed 3, so the tuple arm and commitmentLabel's Array.isArray branch
   * were both dead. Removed with the data change rather than left as a shape
   * waiting for a case that no longer exists.
   */
  commitmentYears: number;
  /** Whether it re-commits by default — see the opt-out note above. */
  renewal: 'opt-out' | 'yearly';
  benefit: BenefitShape;
  /**
   * ⚠ `what` AND `why` ARE GONE. They were this session's own one-line
   * summaries, written before the author's descriptions existed, and they
   * described the same five programs in different words. Keeping them beside
   * riskControlProgramCopy.ts would have been two sources for one thing, with
   * the unused one free to drift. The supplied copy is the only description.
   */
  /** ⚠ 'placeholder' means the scoping itself is not settled, not that the
   *  code is missing — every entry here is missing its code. */
  status: 'scoped' | 'placeholder';
}

/**
 * ⚠ A PLACEHOLDER. NOBODY CHOSE THIS FIGURE AND IT IS NOT A COST ESTIMATE.
 *
 * $1,000,000 per program per year, IDENTICAL ACROSS ALL FIVE, and the sameness
 * is the tell rather than a finding: a three-year law-enforcement analytics
 * build, a two-year roof-hardening capital project and a yearly training and
 * hotline service do not cost the same amount, and nothing here claims they do.
 * One number was needed so the tiles could show a cost and a total at all.
 *
 * ⚠ AND IT QUIETLY ANSWERS A STRUCTURAL QUESTION THAT IS ACTUALLY OPEN. A flat
 * per-program figure asserts that program cost does NOT scale with the book.
 * That is a real modelling choice and it was made by default, not on purpose.
 * Real costs would likely be mixed: some scaling on exposure — a safety program
 * across a bigger payroll costs more to deliver — and some genuinely flat, like
 * a software build whose price does not care how many members use it. Which
 * programs fall on which side is undecided. Replacing this constant means
 * deciding that, not just substituting five numbers.
 *
 * ⚠ IT SAYS SO HERE BECAUSE OF THIS REPOSITORY'S OWN HISTORY. Three constants
 * once arrived in a single commit with no derivation recorded and were still
 * being traced back months later. A placeholder that does not announce itself
 * becomes one of those. This one announces itself.
 *
 * ⚠ AND THE FLAT CHOICE IS NOT NEUTRAL — MEASURED, THE BURDEN RUNS BACKWARDS.
 * Because the figure does not scale with the book, the SMALLEST pool pays the
 * MOST in relative terms. Year 1 at defaults, 8 games, the whole available menu
 * against the pool's own premium:
 *
 *   config          programs   menu/yr   total member charge   pool premium
 *   WC only              3       $3M        21.66M  13.8%       10.74M  27.9%
 *   GL only              3       $3M        33.86M   8.9%       13.73M  21.8%
 *   Property only        3       $3M        28.20M  10.6%       14.59M  20.6%
 *   WC+GL                4       $4M        55.53M   7.2%       24.47M  16.3%
 *   all three            5       $5M        83.73M   6.0%       39.06M  12.8%
 *
 * A one-line pool carries more than twice the relative cost of a three-line one
 * for programs it has fewer of. That is the flat-versus-scaling question showing
 * up as a number rather than as a caveat, and it is an artefact of the stand-in,
 * not a designed property.
 *
 * WHAT REPLACES IT: per-program costs in dollars, with the flat-versus-scaling
 * question settled per program and each figure's basis recorded at the entry.
 * Until then, five identical numbers.
 *
 * ⚠ AND THE WC PROGRAM IS SIZED AGAINST IT, SO MOVING IT MOVES A DECISION. At
 * RTW 12.5% and $1M/yr, charged by the engine, the WC safety & RTW program nets
 * -$0.10M over five years (SE $0.21M — break-even) and keeps $11.01M over the
 * claims' full life. RTW was raised from 10% to get there, rather than this cost
 * lowered, because this cost has no basis and the effect has a source. A
 * replacement figure materially below $1M turns the program into an obvious yes
 * and one materially above into an obvious no. The table is at
 * WC_RTW_TARGET_REDUCTION in riskControlPrograms.ts. The GL program was measured
 * against it too (0.28x, gl-program-value.ts).
 *
 * ⚠ WHAT IS CHARGED. BOTH ARE, EACH WITH ITS OWN CONSTANT, AND NEITHER READS
 * THIS ONE. GL: GL_ANALYTICS_BUILD_ANNUAL_COST for three years, then
 * GL_ANALYTICS_MAINTENANCE_ANNUAL_COST. WC: WC_SAFETY_RTW_ANNUAL_COST, flat,
 * every committed year — people, not a platform, so no maintenance tier. Both
 * equal $1M today because both were sized against this placeholder, and both
 * are equally without a basis.
 *
 * ⚠ THE WC FIGURES ABOVE ARE THE ENGINE'S, NET OF THE CHARGE. The earlier gross
 * arithmetic (+$4.53M - $5M at RTW 10%) understated the cost by the investment
 * income the spent money stops earning — -$1.01M measured against -$0.47M
 * arithmetic — which is why RTW moved to 12.5%.
 */
export const RISK_CONTROL_PLACEHOLDER_ANNUAL_COST = 1_000_000;

export const RISK_CONTROL_CATEGORIES: readonly RiskControlCategory[] = [
  {
    id: 'wc-safety-rtw',
    name: 'Workers\' Compensation Safety & Return-to-Work Program',
    tileName: 'Safety & Return-to-Work',
    scope: 'WC',
    commitmentYears: 3,
    renewal: 'opt-out',
    benefit: 'immediate',
    status: 'scoped',
  },
  {
    id: 'gl-law-enforcement-analytics',
    name: 'Law Enforcement Early Intervention & Analytics',
    tileName: 'Law Enforcement Analytics',
    scope: 'GL',
    commitmentYears: 3,
    renewal: 'opt-out',
    benefit: 'ramped',
    status: 'scoped',
  },
  {
    // ⚠ WIRED, BUT NOT AS A TILE — see the header. This row describes a program
    // whose intensity is a DIAL (riskControlPct), so `commitmentYears` and
    // `renewal` describe nothing the engine does: there is no term to commit to
    // and nothing to renew, only a percentage set each year. They are left as
    // they were because this file is the department page's TEXT and changing
    // them changes what a player reads; the engine has never looked at either.
    //
    // `benefit: 'immediate'` is the one field here that is now exactly right.
    // Mitigation has no ramp: the dial's own lag (RISK_CONTROL_PARAMS, three
    // years to full effect with a 20% annual decay) is what makes spending it a
    // question about horizon, and that lag is a property of the dial rather
    // than of this program.
    //
    // ⚠ `status` MOVED FROM 'placeholder' TO 'scoped' AND THAT IS NOT A CLAIM
    // ABOUT WIRING. `member-services` is already 'scoped' and reaches nothing,
    // so the field has never meant "wired" — WIRED_PROGRAM_IDS is the list that
    // says that, and this program is in neither list because it is not a tile.
    // Nothing reads `status` at all: it appears in this file's type and its five
    // literals and nowhere else, which is also why changing it cannot move the
    // render baseline.
    id: 'property-mitigation',
    name: 'Property Loss Prevention & Mitigation',
    tileName: 'Property Mitigation',
    scope: 'Property',
    commitmentYears: 2,
    renewal: 'opt-out',
    benefit: 'immediate',
    status: 'scoped',
  },
  {
    id: 'claims-management-system',
    name: 'Claims Management Modernization',
    tileName: 'Claims Management',
    scope: 'Pool',
    commitmentYears: 3,
    renewal: 'opt-out',
    // ⚠ WAS 'onCompletion', AND THE WIRING IS WHY IT MOVED. The benefit arrives
    // on CLAIMS_SYSTEM_RAMP — nothing in year one, 0.60 in year two, all of it
    // from year three — so it ramps rather than landing whole at the end of the
    // term. 'onCompletion' would have told a player to expect nothing until
    // year three and then everything, which is not what the engine does.
    benefit: 'ramped',
    status: 'scoped',
  },
  {
    id: 'member-services',
    name: 'Member Services & Risk Education',
    tileName: 'Member Services',
    scope: 'Pool',
    commitmentYears: 1,
    renewal: 'yearly',
    benefit: 'immediate',
    status: 'scoped',
  },
];

/**
 * The programs a pool can actually be offered, given the lines it writes.
 *
 * ⚠ THIS IS A MECHANIC AND NOT COPY. The department page states that
 * line-specific programs are only available if the pool provides that coverage.
 * If the tiles did not gate, the page would say something the screen
 * contradicts, so BOTH read this one function — a GL-only pool sees three
 * programs, a three-line pool sees five.
 *
 * It is a filter over data that was already there: every entry has carried a
 * `scope` since the catalog was written, so nothing new is stored to make this
 * work and there is no second list to keep in step.
 */
export function availableCategories(
  activeLines: readonly CoverageLine[],
): readonly RiskControlCategory[] {
  return RISK_CONTROL_CATEGORIES.filter(
    c => c.scope === 'Pool' || activeLines.includes(c.scope),
  );
}

/**
 * What running every AVAILABLE program would cost for one year.
 *
 * ⚠ GATED LIKE THE TILES, which is the whole reason this is a function and not
 * five times the constant. A pool that writes one line is offered three
 * programs, so its total is $3M, not $5M. Reading the ungated five would
 * overstate the number for every pool that is not writing all three lines.
 *
 * ⚠ AND IT IS WHAT SELECTING THEM WOULD COST, NOT A SPEND THAT HAPPENS. The
 * spend a pool actually incurs is programAnnualCost, per line, and it is not
 * this figure.
 *
 * ⚠ THIS NOTE USED TO SAY THE TILES WERE INERT AND NOTHING WAS CHARGED, and both
 * went stale when the GL program became buyable and charged. The WC program is
 * now buyable and charged the same way: both tiles are buttons in a pool that
 * writes their line, and both costs leave cash and underwriting income. No
 * program anywhere delivers a benefit it does not pay for.
 */
export function totalAnnualCost(activeLines: readonly CoverageLine[]): number {
  return availableCategories(activeLines).length * RISK_CONTROL_PLACEHOLDER_ANNUAL_COST;
}

/** "3 years", "1 year", "Yearly". DISPLAY ONLY. */
export function commitmentLabel(c: RiskControlCategory): string {
  if (c.renewal === 'yearly') return 'Yearly';
  return `${c.commitmentYears} year${c.commitmentYears === 1 ? '' : 's'}`;
}

/** How the benefit arrives, in words. DISPLAY ONLY. */
export function benefitLabel(c: RiskControlCategory): string {
  switch (c.benefit) {
    case 'immediate': return 'Benefit from year one';
    case 'ramped': return 'Benefit ramps over years 1-3';
    case 'onCompletion': return 'No benefit until complete';
  }
}
