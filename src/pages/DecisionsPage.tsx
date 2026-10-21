import React from 'react';
import { DollarSign, TrendingUp, BarChart2, Shield, RotateCcw, Info } from 'lucide-react';
import type { DecisionSet, LineDecisionSet, CoverageLine, LineView, LineResultSet, Member, MemberLossHistory, MembershipHistory } from '../types/simulation';
import SliderInput from '../components/SliderInput';
import AllocationBar from '../components/AllocationBar';
// ⚠ RiskControlCategoryBoxes IS NO LONGER IMPORTED. The Risk Control Programs
// card it rendered is gone from the Pool tab — see the note where it stood.
import { SLIDER_RANGES, ASSET_ALLOCATION_DEFAULT } from '../data/defaultAssumptions';
import { formatCurrency } from '../utils/formatters';
import { defaultLineDecisionSet } from '../utils/decisionDefaults';
import { dividendAssessmentBasis } from '../utils/dividendAssessment';
import { hasTractableCeded } from '../utils/reinsuranceDisplay';
import { PROPERTY_PERIL_DEDUCTIBLE, type TowerLine } from '../data/reinsuranceTower';
import { occurrenceProgramCost } from '../utils/reinsuranceTower';
import { placementFor, reinsuranceOptionsFor } from '../utils/reinsuranceOptions';
import { bookExposureOf, bookRiskOf, type Book } from '../utils/lineHelpers';
import { stopQuote, stopWording } from '../utils/aggregateStop';
import { lineDisplayName } from '../utils/lineDisplay';
import { lookupCLF } from '../utils/simulationEngine';
import { hasStaticClf, RESERVE_MARGIN_CONFIDENCE, staticClf } from '../data/clfTables';
import type { FundingConsequence } from '../utils/fundingConsequence';
import { RENEWAL_CUT_STEPS, renewalDeclines } from '../utils/renewalUnderwriting';
import { EXPERIENCE_MOD } from '../utils/memberExperienceMod';
import {
  INTAKE_LOW, INTAKE_NONE, INTAKE_POSITIONS, intakeCap, intakeForecast, intakeLabel, intakePassProbability,
} from '../utils/intakeInspection';
import { APPLICATION_RATE } from '../data/defaultAssumptions';
import { canReenroll, REENROLLMENT_COOLDOWN_YEARS } from '../utils/membershipHistory';
import { applicantInclusion } from '../utils/membershipEngine';
import { AGGREGATE_STOP, AGGREGATE_STOP_OPTIONS, MEMBER_LEVEL, RISK_CONTROL } from '../data/pricingParameters';
import { intakeShare } from '../utils/bookUnderwriting';

export interface LineLoanInfo {
  balance: number;
  dividendBlocked: boolean;
}

interface DecisionsPageProps {
  decisions: DecisionSet;
  onChange: (d: DecisionSet) => void;
  yearNumber: number;
  disabled?: boolean;
  // 'pool' hosts the two pool-wide decisions (investment allocation, risk
  // control); each coverage line's tab edits that line's own decisions.
  lineView: LineView;
  // ⚠ activeLines AND priorProgramIds ARE BOTH GONE FROM THIS SCREEN. They fed
  // the Risk Control Programs tiles and nothing else here: activeLines gated
  // which tiles were offered, priorProgramIds gave each its tenure. With the
  // card removed they had no remaining reader, and a prop kept "in case" would
  // be a reader the next person has to disprove. GameShell still derives
  // priorProgramIds nowhere — its one call site went with them.
  lineLoanInfo: Record<CoverageLine, LineLoanInfo>;
  // Last computed result for the line being edited — informational only
  // (excessCapitalRatio / capitalAdequacyStatus for the consequence panel).
  // Undefined only before the pre-game bootstrap has produced anything.
  lastLineResult?: LineResultSet;
  // Precomputed CLF-only pricing consequences for the line's CURRENTLY
  // SELECTED funding confidence level and reinsurance level. Null only
  // before a game exists.
  fundingConsequence: FundingConsequence | null;
  /** The rolling loss ledger, for Renewal Underwriting's live decline counts.
   *  Same source MembershipPage reads — see its note on why not the shares. */
  memberLossHistory: MemberLossHistory;
  // The full canonical marketplace and the per-line enrolment ledger — the two
  // inputs New Business Appetite needs to build the applicant pool the same way
  // simulateMemberMovement does, rather than estimating it.
  allMarketMembers: Member[];
  membershipHistory: MembershipHistory;
  // What the line's reinsurance is priced on: its one book, or with
  // MEMBER_LEVEL on its roster — derivations.ts builds it as the engine does.
  book: Book;
}

// THE FUNDING SLIDER'S LABELS: THE PERCENTAGE ALONE — "(80%)". The descriptive
// ladder that stood here ('Above Average', 'Balanced', 'Critical' …) is gone:
// it named a percentile as if it were a judgement, and the words drifted from
// what each stop delivers whenever the tables moved. Expected keeps its word,
// "Expected (~X%)", because it is a different kind of position — CLF exactly
// 1.000, wherever that falls on the line — not a stop on the grid.
const fundingStopLabel = (v: number) => `(${(v * 100).toFixed(0)}%)`;


// Reset only the given line to defaults (Model A strict per-line: resetting on
// one line's tab must not clobber the other lines' choices).
function resetLineToDefaults(decisions: DecisionSet, line: CoverageLine): DecisionSet {
  return {
    ...decisions,
    byLine: {
      ...decisions.byLine,
      [line]: defaultLineDecisionSet(line),
    },
  };
}

export default function DecisionsPage({ decisions, onChange, yearNumber, disabled = false, lineView, lineLoanInfo, lastLineResult, fundingConsequence, book, memberLossHistory, allMarketMembers, membershipHistory }: DecisionsPageProps) {
  // Pool tab: ONE pool-wide decision now — the investment allocation. The
  // risk-control card that sat beside it has moved onto each line as a slider.
  if (lineView === 'pool') {
    return <PoolDecisionsView decisions={decisions} onChange={onChange} yearNumber={yearNumber} disabled={disabled} />;
  }

  // Stage 2.7: every active line's remaining decisions are edited on its own
  // tab, strict per-line (Model A) — no cross-line "apply to all".
  const selectedLine: CoverageLine = lineView;
  const d = decisions.byLine[selectedLine];
  const selectedLoanInfo = lineLoanInfo[selectedLine];

  // `null` is in the union for renewalThreshold, whose "Renew All" position
  // is an explicit null rather than an absent key.
  const set = (key: keyof LineDecisionSet, val: number | boolean | boolean[] | null | LineDecisionSet['assetAllocation']) =>
    onChange({ ...decisions, byLine: { ...decisions.byLine, [selectedLine]: { ...d, [key]: val } } });

  // ⚠ FOR CHANGING TWO FIELDS AT ONCE. `set` closes over `d` as it stood at
  // render, so two calls in a row both write from the same stale snapshot and
  // the second silently drops the first. The tower's layer/aggregate gate has
  // to move both together, so it uses this.
  const setMany = (patch: Partial<LineDecisionSet>) =>
    onChange({ ...decisions, byLine: { ...decisions.byLine, [selectedLine]: { ...d, ...patch } } });

  // WC/GL ONLY: dragging the slider always exits Expected mode (a manual
  // percentile choice), landing exactly on the dragged value. Selecting
  // "Expected" back is the separate button rendered below the slider.
  const setFundingLevel = (v: number) =>
    onChange({ ...decisions, byLine: { ...decisions.byLine, [selectedLine]: { ...d, fundingConfidenceLevel: v, fundingAtExpected: false } } });
  const setFundingAtExpected = () => set('fundingAtExpected', true);

  // COMBINED DIVIDEND/ASSESSMENT CONTROL (Part 1). One slider, zero at centre:
  // positive is a dividend, negative is an assessment. dividendPct and
  // assessmentPct stay separate engine fields — setting one always zeros the
  // other, which is what makes both-in-one-year structurally impossible where
  // the engine previously permitted it. Assessments remain OUTSIDE
  // totalMemberCharge in the engine (unchanged) — folding them in would
  // improve the loss ratio for the very members being billed.
  const dividendAssessmentValue = d.dividendPct > 0 ? d.dividendPct : -d.assessmentPct;
  const setDividendAssessment = (v: number) => {
    onChange({
      ...decisions,
      byLine: {
        ...decisions.byLine,
        [selectedLine]: {
          ...d,
          dividendPct: v > 0 ? v : 0,
          assessmentPct: v < 0 ? -v : 0,
        },
      },
    });
  };
  // ⚠ "0%" AT CENTRE, NOT "None". The slider is a percentage of surplus along
  // its whole length and the note below it prints that percentage; a centre
  // reading "None" made the one position the player starts on the only one that
  // did not say what it was a percentage OF. Zero is a percentage like the rest.
  const dividendAssessmentDisplay = (v: number) => {
    if (v > 0.0001) return `Dividend ${(v * 100).toFixed(0)}%`;
    if (v < -0.0001) return `Assessment ${(-v * 100).toFixed(0)}%`;
    return '0%';
  };
  // THE SURPLUS THE PERCENTAGE IS A SHARE OF, read from the engine's own figure
  // rather than recomputed here. This line's opening surplus for the year IS
  // last year's endingSurplus carried forward (simulationEngine assigns
  // `updatedLineState.surplus = result.endingSurplus`), and the engine applies
  // the percentage to exactly this number through the same clamp — see
  // dividendAssessment.ts. Undefined only before the pre-game has produced
  // anything, where there is no surplus to show and the note is omitted.
  const dividendAssessmentSurplus = lastLineResult
    ? dividendAssessmentBasis(lastLineResult.endingSurplus)
    : null;
  // Dividend side clamped to 0 while blocked (negative surplus carried in);
  // the assessment side stays fully available, unlike disabling the whole
  // control would allow.
  const dividendAssessmentMax = selectedLoanInfo.dividendBlocked ? 0 : SLIDER_RANGES.dividendAssessment.max;

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Year {yearNumber} Decisions — {lineDisplayName(lineView)}</h2>
          <p className="text-gray-500 text-sm">Configure this line's strategy for the year</p>
        </div>
        {!disabled && (
          <button onClick={() => onChange(resetLineToDefaults(decisions, selectedLine))} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100">
            <RotateCcw size={14} /> Reset {lineDisplayName(selectedLine)} to Defaults
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title="Pricing & Funding" icon={<DollarSign size={16} />}>
          {/* Rate Change REMOVED — CLF-only pricing. Funding Confidence Level
              is now the sole pricing lever; the consequence panel below
              replaces the information the deleted lever used to carry. */}
          <FundingLevelControl
            d={d}
            fundingConsequence={fundingConsequence}
            setFundingLevel={setFundingLevel}
            setFundingAtExpected={setFundingAtExpected}
            disabled={disabled}
          />
          <FundingConsequencePanel c={fundingConsequence} lastLineResult={lastLineResult} line={selectedLine} />
          <SliderInput label="Dividend / Assessment" value={dividendAssessmentValue} min={SLIDER_RANGES.dividendAssessment.min} max={dividendAssessmentMax} step={SLIDER_RANGES.dividendAssessment.step} onChange={setDividendAssessment} formatValue={dividendAssessmentDisplay} leftLabel="Assessment" rightLabel="Dividend" valueColor={dividendAssessmentValue > 0 ? 'text-emerald-600' : dividendAssessmentValue < 0 ? 'text-red-600' : 'text-gray-500'} disabled={disabled} helpText="One combined control: positive returns value to members as a dividend; negative calls additional funds beyond premium as an assessment. Exactly one may apply in a given year — this is structural, not a suggestion. Assessments are never counted toward the loss ratio of the members being billed." />
          <DividendAssessmentNote surplus={dividendAssessmentSurplus} pct={dividendAssessmentValue} />
          {/* ⚠ PLAYERS ARE NEVER TOLD ABOUT THE WORLDS. The surplus-range line ("…
              across 10 worlds: min · median · max" and "The figures shown are the
              average of the worlds") came off; the range stays in the session's
              posted results, for the host (docs/PENDING_MULTIPLAYER.md). */}
          {selectedLoanInfo.dividendBlocked && (
            <p className="text-xs text-red-600 -mt-3">Dividend blocked: this line carried a negative surplus in from last year.</p>
          )}
        </SectionCard>

        {/* ⚠ ONE GRID CELL HOLDING TWO CARDS, so "Investment in Risk Control
            Incentives" sits DIRECTLY UNDER the underwriting sliders rather than
            wherever the grid's flow would drop it. Left as two siblings it
            would wrap into the left column under Pricing & Funding — the right
            number of cards in the wrong place. */}
        <div className="space-y-5">
        <SectionCard title="Growth & Underwriting" icon={<TrendingUp size={16} />}>
          {/* ⚠ THE UNDERWRITING STRICTNESS SLIDER IS DELETED. It said "Strict
              underwriting improves risk quality" and it did exactly that, by
              sorting applicants on the member's true risk quality and keeping
              the best 60% — perfect selection on a number the player can no
              longer see anywhere per member. See membershipEngine.ts at the
              deleted screen.

              ⚠ AND THE PARAGRAPH THAT ANNOUNCED ITS REMOVAL IS GONE TOO. It
              opened "The pool no longer sets a general underwriting standard"
              — which narrates the software's history rather than a mechanism
              the player is deciding against. A player who never saw the slider
              does not need to be told it is gone, and one who did will notice.
              The test applied across this screen: does the note explain a
              MECHANISM being decided against, or the product's changelog? The
              GL retention note below survives it because an uncapped exposure
              is a live financial fact. This one did not. */}
          {MEMBER_LEVEL.enabled ? (
            <>
              <RenewalUnderwriting
                line={selectedLine}
                members={lastLineResult?.memberList ?? []}
                history={memberLossHistory}
                yearNumber={yearNumber}
                value={d.renewalCut ?? 0}
                onChange={v => set('renewalCut', v)}
                disabled={disabled}
              />
              <IntakeSlider
                line={selectedLine}
                members={lastLineResult?.memberList ?? []}
                allMarketMembers={allMarketMembers}
                membershipHistory={membershipHistory}
                yearNumber={yearNumber}
                value={d.intakeLevel ?? INTAKE_NONE}
                onChange={v => set('intakeLevel', v)}
                disabled={disabled}
              />
            </>
          ) : (
            <>
              {/* ONE BOOK PER LINE: renewal and intake move the book's exposure,
                  not members. See bookUnderwriting.ts. */}
              <BookRenewal
                value={d.renewalCut ?? 0}
                onChange={v => set('renewalCut', v)}
                disabled={disabled}
              />
              <BookIntake
                value={d.intakeLevel ?? INTAKE_NONE}
                onChange={v => set('intakeLevel', v)}
                disabled={disabled}
              />
            </>
          )}
        </SectionCard>

        <SectionCard title="Investment in Risk Control Incentives" icon={<Shield size={16} />}>
          {/* ⚠ PENDING DESIGN WHILE RISK_CONTROL IS OFF: shown so testers see it
              is part of the game, held at 0% and disabled, labelled "coming
              soon". The stored decision is untouched and nothing reads it. */}
          <RiskControlIncentives
            line={selectedLine}
            value={RISK_CONTROL.enabled ? (d.riskControlIncentivePct ?? SLIDER_RANGES.riskControlIncentivePct.default) : 0}
            onChange={v => set('riskControlIncentivePct', v)}
            disabled={disabled || !RISK_CONTROL.enabled}
            comingSoon={!RISK_CONTROL.enabled}
          />
        </SectionCard>
        </div>

        {outstandingLoanSlider(d, set, selectedLoanInfo, disabled)}

        <SectionCard title="Reinsurance Program" icon={<Shield size={16} />}>
          {/* REINSURANCE_PROGRAMS RETIRED. Every CoverageLine runs the
              per-occurrence tower now — hasTractableCeded(selectedLine) is
              exhaustively true — so the percentage-of-premium branch that used
              to render here is gone rather than kept dead. hasTractableCeded
              stays imported and checked (thrown on else) so a future line
              without one fails loudly here instead of rendering nothing. */}
          {hasTractableCeded(selectedLine) ? (
            <PackageControls
              line={selectedLine}
              d={d}
              setMany={setMany}
              disabled={disabled}
              book={book}
              yearNumber={yearNumber}
            />
          ) : (() => { throw new Error(`DecisionsPage: ${selectedLine} has no tractable ceded reinsurance`); })()}
        </SectionCard>

      </div>
    </div>
  );
}

// Pool tab: the two pool-wide decisions. Portfolios remain segregated per
// line (Stage 2.9) — every line applies this one allocation policy to its own
// invested assets, and the one risk-control intensity to its own premium.
function PoolDecisionsView({ decisions, onChange, yearNumber, disabled }: {
  decisions: DecisionSet;
  onChange: (d: DecisionSet) => void;
  yearNumber: number;
  disabled: boolean;
}) {
  // ⚠ RESET DOES NOT CANCEL A PROGRAM, AND THAT IS DELIBERATE. This button
  // returns the year's POLICIES to their defaults. A risk-control program is a
  // three-year commitment, not a policy for the year, and dropping it silently
  // through a control labelled "reset" would end a commitment by accident —
  // the exact failure the opt-out default exists to prevent. Stopping is the
  // tile, which says what it is doing.
  const resetPool = () => onChange({
    ...decisions,
    assetAllocation: { ...ASSET_ALLOCATION_DEFAULT },
    riskControlPct: SLIDER_RANGES.riskControlPct.default,
  });

  return (
    <div className="max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Year {yearNumber} Decisions — Pool</h2>
          <p className="text-gray-500 text-sm">Pool-wide policies applied by every line to its own base</p>
        </div>
        {!disabled && (
          <button onClick={resetPool} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-100">
            <RotateCcw size={14} /> Reset Pool to Defaults
          </button>
        )}
      </div>
      {/* No worlds line here either — players are never told about the worlds. */}

      {/* ⚠ THE RISK CONTROL SLIDER IS RETIRED HERE, PENDING THE BOXES BELOW, AND
          THE FIELD IS LIVE AND PINNED.

          `decisions.riskControlPct` STAYS in the decision set. It is still read
          by the engine and still reaches the loss draw through
          riskControlEffectiveness — the CONTROL is gone, not the decision. It
          now holds SLIDER_RANGES.riskControlPct.default for the whole game,
          which is 0, so the default game is unchanged and both value baselines
          hold. That was established before this commit was written rather than
          discovered after: neither baseline arm sets the field (`def` runs
          defaultDecisionSet, `sqz` overrides only the two funding fields), so
          it reads 0 in all 28,800 captured values either way.

          THE FIELD IS DELIBERATELY NOT DELETED. The category boxes are going to
          drive it, and a field deleted and re-added is a worse path than one
          that was never touched — it would move the save shape twice and put a
          migration between the two halves of one change.

          ⚠ ONE CONSEQUENCE NOT HANDLED HERE, DELIBERATELY. A game SAVED BEFORE
          this commit with a non-zero riskControlPct restores that value, and
          there is now no control to change it — the spend would continue for the
          rest of that game. Nothing normalises it on load, because silently
          rewriting a player's saved decisions is a worse failure than a stuck
          lever on a pre-existing save, and the commit that gives the boxes the
          field is where that normalisation belongs. New games are unaffected. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title="Investment Allocation" icon={<BarChart2 size={16} />}>
          <AllocationBar
            value={decisions.assetAllocation}
            onChange={allocation => onChange({ ...decisions, assetAllocation: allocation })}
            disabled={disabled}
          />
        </SectionCard>

        {/* ⚠ THE RISK CONTROL PROGRAMS CARD STOOD HERE AND IS REMOVED — ALL
            FIVE TILES, Pool Claims Management and Pool Member Services with
            them. Risk control is a PER-LINE spend now, a slider under each
            line's underwriting sliders; see RiskControlIncentives below.

            ⚠ THE ENGINE CODE BEHIND THE TILES IS KEPT, SWITCHED OFF, NOT
            DELETED. These tiles were the only writer of
            `decisions.riskControlProgramIds` anywhere in the app. The field
            stays on DecisionSet and LineDecisionSet, defaultDecisionSet still
            seeds it `[]`, and simulationEngine still reads it — so the three
            WIRED programs (gl-law-enforcement-analytics, wc-safety-rtw,
            claims-management-system) now receive an empty list on every played
            year and their multipliers are identity. Nothing changes in a played
            game, because every tile already defaulted to off.

            WHAT THIS MAKES UNREACHABLE FROM THE GAME: riskControlPrograms.ts's
            ramp, tenure, standing, cost and effect paths —
            programFreqMultiplier, programAnnualCost, programRtwConversion,
            claimsSystemSeverityReduction and the standings they call — can no
            longer be reached with a non-empty list by any player action, and
            RiskControlCategoryBoxes, riskControlCategories.ts and
            riskControlProgramCopy.ts have no remaining render site. They are
            NOT unexercised: wc-program-check, gl-program-check,
            claims-system-check and the two program-value diagnostics build the
            ids by hand, so the gates still cover the code a future control
            would drive.

            ⚠ ONE CONSEQUENCE LEFT UNHANDLED, as the retired intensity slider's
            note above leaves its own: a game SAVED with programs committed
            restores with them committed and now has no control to stop them.
            Nothing normalises it on load, for the reason recorded there —
            silently rewriting a player's saved decisions is the worse failure.
            New games are unaffected. */}
      </div>
    </div>
  );
}

// The loan-repayment slider is only shown while the selected line carries an
// outstanding inter-line loan balance.
function outstandingLoanSlider(
  d: LineDecisionSet,
  set: (key: keyof LineDecisionSet, val: number) => void,
  loanInfo: LineLoanInfo,
  disabled: boolean
) {
  if (loanInfo.balance <= 0) return null;
  return (
    <SectionCard title="Inter-Line Loan Repayment" icon={<Shield size={16} />}>
      <p className="text-xs text-amber-700">
        This line has an outstanding inter-line loan of {formatCurrency(loanInfo.balance)}.
      </p>
      <SliderInput
        label="Loan Repayment Aggressiveness"
        value={d.loanRepaymentAggressiveness}
        min={0} max={1} step={0.05}
        onChange={v => set('loanRepaymentAggressiveness', v)}
        formatValue={v => `${(v * 100).toFixed(0)}%`}
        leftLabel="Slow" rightLabel="Fast"
        disabled={disabled}
        helpText="Share of this line's positive net income used to repay the loan before it flows to the line's own surplus."
      />
    </SectionCard>
  );
}

// THE FUNDING CONFIDENCE LEVEL CONTROL. Every line: the native
// range input's thumb renders at whatever `value` it is given even when that
// value is not a multiple of `step` (only manual dragging snaps to the step
// grid), so while fundingAtExpected is true the slider's value is bound to
// fundingConsequence.expectedPercentile — the marker sits at its TRUE,
// book-dependent position on the track, labeled 'Expected (~X%)', without any
// custom slider component. Dragging the thumb calls setFundingLevel, which
// lands exactly on the dragged value AND clears fundingAtExpected in the same
// update — the natural, and only, way to leave Expected mode. A separate
// button re-selects Expected directly, since a dragged slider can never land
// back on an arbitrary fractional percentage on its own.
// `line` and `set` are gone from the signature with Property's branch: the
// remaining path is line-agnostic and never writes fundingConfidenceLevel
// directly (setFundingLevel does, and clears fundingAtExpected with it).
function FundingLevelControl({ d, fundingConsequence, setFundingLevel, setFundingAtExpected, disabled }: {
  d: LineDecisionSet;
  fundingConsequence: FundingConsequence | null;
  setFundingLevel: (v: number) => void;
  setFundingAtExpected: () => void;
  disabled: boolean;
}) {
  // ⚠ PROPERTY'S SEPARATE CONTROL IS GONE. It rendered the original slider with
  // a fixed "60% is expected" label, correct only while Property read the
  // generic FUNDING_CLF_TABLE whose 0.60 entry is literally 1.000. It has its
  // own derived table now, crossing at 54.0%, so a hardcoded 60% would mislabel
  // the stop by 6 points — exactly the error the derived tables exist to
  // prevent, and the reason WC and GL never had such a label.
  //
  // ALL THREE LINES: break-even is not a fixed percent — it moves with the enrolled
  // book's own CV (WC) or expected claim count (GL). expectedPercentile is
  // cross-checked against the same grid computeWcClf/computeGlClf use (see
  // wcClfCrossingPercentile/glClfCrossingPercentile), never derived separately.
  const expectedPct = fundingConsequence?.expectedPercentile ?? d.fundingConfidenceLevel;
  const sliderValue = d.fundingAtExpected ? expectedPct : d.fundingConfidenceLevel;
  const isAdequate = !fundingConsequence || fundingConsequence.isAdequate;

  return (
    <div className="flex flex-col gap-1">
      <SliderInput
        label="Funding Confidence Level"
        value={sliderValue}
        min={SLIDER_RANGES.fundingConfidenceLevel.min} max={SLIDER_RANGES.fundingConfidenceLevel.max} step={SLIDER_RANGES.fundingConfidenceLevel.step}
        onChange={setFundingLevel}
        formatValue={v => d.fundingAtExpected ? `Expected (~${Math.round(v * 100)}%)` : fundingStopLabel(v)}
        leftLabel="Underfunded" rightLabel="Higher Confidence"
        valueColor={isAdequate ? 'text-gray-700' : 'text-red-600'}
        disabled={disabled}
        helpText="Sets the funding confidence level, applied as a multiplier (CLF) on expected losses to set pool premium. This line's break-even (CLF exactly 1.000) is not a fixed percent — it moves with the enrolled book's size and composition. 'Expected' tracks that true position directly; a percentile stop instead prices at that exact confidence level regardless of where break-even currently falls."
      />
      {!d.fundingAtExpected && (
        <button
          type="button"
          onClick={setFundingAtExpected}
          disabled={disabled}
          className="self-start text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed -mt-1"
        >
          Reset to Expected (~{Math.round(expectedPct * 100)}%)
        </button>
      )}
    </div>
  );
}

// CLF-only pricing consequence panel (Part 2). Everything here comes from
// src/utils/fundingConsequence.ts, which calls quoteLineRates — literally the
// same function simulationEngine calls to build its own quote. This renders
// that object; it does not recompute anything.
//
// ⚠ THE CLAIM ABOVE USED TO BE FALSE AND IS NOW ASSERTED. It previously said
// the panel used "the SAME formulas simulationEngine.ts actually prices with"
// while the panel funded GROSS and charged a percentage-of-premium
// reinsurance rate — GL's pool premium rate read $5.63 here against the
// engine's $3.26. It is kept only because parity is now structural (one shared
// function) AND checked component by component in
// scripts/diagnostics/panel-engine-parity-check.ts. If that check is ever
// deleted, delete this claim with it.
//
// ONE RESIDUAL, STATED: these are PRE-MOVEMENT figures. The engine settles the
// year's premium on the post-movement book, so the final rate differs by
// whoever joins or leaves — measured at a median 1.0% on WC, 3.2% on GL, 0.0%
// on Property. That is not closable: the panel is asked the question before the
// answer exists.

// ============================================================================
// THE NEW RATE PANEL — two columns, per $100, behind NEW_RATE_STACK.
//
// ⚠ TWO COLUMNS BECAUSE THERE ARE TWO QUESTIONS, and the old panel answered
// only the second. "Indicated" is what the risk costs the pool before it
// decides anything — at expected, self-funded, no reinsurance. "Your rate" is
// what the team's own funding level and tower placement turn that into. A
// player who cannot see the first cannot tell whether a high rate is the book
// or their own choices.
//
// ⚠ NO CLF NOTE BESIDE THE PURE PREMIUM. The CLF is already inside "Your
// rate"'s pure premium figure — it is the funding level — and printing the
// multiplier beside it invited the reading that the row was pre-CLF and the
// number got applied twice somewhere downstream.
//
// ⚠ THE REINSURANCE CELL IS A DASH IN THE INDICATED COLUMN, NOT A ZERO. The
// indication is SELF-FUNDED: there is no reinsurance in it, which is a
// different statement from reinsurance costing nothing. The same empty-cell-is-
// not-a-zero rule the Actuarial exhibit follows.
// ============================================================================
function NewRatePanel({ n, prior }: {
  n: NonNullable<FundingConsequence['newStack']>;
  prior?: LineResultSet;
}) {
  const d2 = (v: number) => `$${v.toFixed(2)}`;
  // ⚠ THE CHANGE IS THE FIGURE; LAST YEAR'S RATE IS THE FOOTNOTE TO IT. A rate
  // on its own asks the reader to do the subtraction, and the subtraction is
  // the only part they actually want — "my rate went up 7%" is the sentence,
  // not "last year it was $8.80". So the percentage is the cell and the rate it
  // was measured against sits beneath it in smaller text, and on the cell's
  // title for a reader who hovers. ⚠ BOTH COLUMNS ARE MEASURED AGAINST LAST
  // YEAR'S ACTUAL RATE — the final rate members paid (UI tidy). It used to match
  // like for like, the indication against last year's indication; but last
  // year's indication is a figure no member ever paid, and the question a
  // player asks of either column is "against what we charged last year".
  //
  // ⚠ 4 DECIMAL PLACES ON THE FOOTNOTE, NOT 2. The rows above are rounded to
  // cents for reading; this one has to RECONSTRUCT the percentage beside it, and
  // at $0.39 on Property two decimals cannot — $0.39 to $0.40 is anything from
  // 1.3% to 3.8%. A footnote that contradicts the figure it explains is worse
  // than no footnote.
  const d4 = (v: number) => `$${v.toFixed(4)}`;
  const chg = (now: number, before: number | undefined, what: string) => {
    if (before === undefined || !(before > 0)) {
      return <span className="text-gray-400" title={`no ${what} was recorded for last year`}>—</span>;
    }
    const pct = ((now / before) - 1) * 100;
    return (
      <span title={`last year's ${what} ${d4(before)} → ${d4(now)}`}>
        <span className={pct >= 0 ? 'text-red-600' : 'text-green-700'}>
          {`${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}
        </span>
        <span className="block font-normal text-[10px] text-gray-500 tabular-nums">
          from {d4(before)}
        </span>
      </span>
    );
  };

  const rows: Array<[string, string, string]> = [
    ['Pure premium', d2(n.purePremiumGroundUp), d2(n.purePremiumRetained)],
    ['+ Admin', d2(n.adminRatePer100), d2(n.adminRatePer100)],
    ['+ Risk control & contingency',
      d2(n.firstIndicationPer100 - n.purePremiumGroundUp - n.adminRatePer100),
      d2(n.riskControlAndContingencyPer100)],
  ];

  return (
    <div data-testid="new-rate-panel" className="bg-gray-50 rounded-lg p-3 border border-gray-200 text-xs space-y-2 -mt-1">
      <table className="w-full">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="font-medium py-1" />
            <th className="font-medium py-1 text-right">Indicated<div className="font-normal text-[10px]">expected, self-funded</div></th>
            <th className="font-medium py-1 text-right">Your rate<div className="font-normal text-[10px]">funding level, with reinsurance</div></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label} className="border-t border-gray-200/70">
              <td className="py-1 text-gray-600">{label}</td>
              <td className="py-1 text-right tabular-nums">{a}</td>
              <td className="py-1 text-right tabular-nums">{b}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-200/70">
            <td className="py-1 text-gray-600">+ Reinsurance</td>
            <td className="py-1 text-right text-gray-400">—</td>
            <td className="py-1 text-right tabular-nums">{d2(n.reinsRatePer100)}</td>
          </tr>
          <tr className="border-t border-gray-300 font-medium">
            <td className="py-1">= Rate</td>
            <td data-testid="new-rate-indicated" className="py-1 text-right tabular-nums">{d2(n.firstIndicationPer100)}</td>
            <td data-testid="new-rate-final" className="py-1 text-right tabular-nums">{d2(n.finalRatePer100)}</td>
          </tr>
          <tr className="border-t border-gray-200/70">
            <td className="py-1 text-gray-600">vs last year</td>
            <td data-testid="new-rate-vs-indicated" className="py-1 text-right tabular-nums align-top">
              {chg(n.firstIndicationPer100, prior?.finalRatePer100, 'final rate')}
            </td>
            <td data-testid="new-rate-vs-final" className="py-1 text-right tabular-nums align-top">
              {chg(n.finalRatePer100, prior?.finalRatePer100, 'final rate')}
            </td>
          </tr>
        </tbody>
      </table>
      {/* ⚠ DOLLARS, NOT A RATE, and underwriting only — see quoteNewRateStack. */}
      <p data-testid="expected-to-surplus" className="pt-1">
        Expected to surplus:{' '}
        <span className={n.expectedToSurplus >= 0 ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>
          {n.expectedToSurplus >= 0 ? '+' : '-'}${Math.abs(n.expectedToSurplus / 1e6).toFixed(2)}M
        </span>
      </p>
    </div>
  );
}

function FundingConsequencePanel({ c, lastLineResult, line }: { c: FundingConsequence | null; lastLineResult?: LineResultSet; line: CoverageLine }) {
  if (!c) return null;
  const pct1 = (v: number) => `${v.toFixed(1)}%`;
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  // PER LINE, mirroring simulationEngine's reserveMarginCLF dispatch. An
  // unconditional lookupCLF(0.90) here read 1.951 — Property's table — on every
  // line, against WC's actual 1.3709 and GL's 1.5020, i.e. the same
  // wrong-curve-on-the-display defect clfFor above this file was written to fix,
  // surviving in the one readout that did not go through it.
  const reserveMarginCLF = hasStaticClf(line) ? staticClf(line, RESERVE_MARGIN_CONFIDENCE) : lookupCLF(RESERVE_MARGIN_CONFIDENCE);

  // ⚠ THE NEW PANEL REPLACES THIS ONE WHOLE, rather than adding rows to it.
  // Eight readouts go with the old stack — the CLF multiplier, the net and
  // pool pure premium, the load, the expected combined ratio, the marginal
  // cost, the reserve margin standard, the excess capital ratio and the
  // underfunding sentence. Two of those move elsewhere rather than vanishing;
  // see docs/PENDING_MULTIPLAYER.md.
  if (c.newStack) {
    return <NewRatePanel n={c.newStack} prior={lastLineResult} />;
  }

  return (
    <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 text-xs space-y-2 -mt-1">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <DataRow label="CLF Multiplier" value={`×${c.clf.toFixed(3)}`} />
        {/* ⚠ THE BUILD-UP STARTS NET, AND THE GROSS DECOMPOSITION IS GONE.
            "Pure Premium Rate / $100 (gross)" and "Less Expected Ceded / $100"
            were removed: a funding decision does not need them, and showing the
            gross figure at the top invites reading the pool's exposure as the
            whole of it rather than the part it retains. The tower's price is
            still on the panel — as the Reinsurance row below, which is what a
            member actually pays for it.

            ⚠ AND THE MIDDLE OF THE BUILD-UP IS NOW SHOWN, which is the point of
            this change. Pool Premium $3.50 became a Total Member Charge of
            $9.07 with nothing in between, so the $5.57 read as overhead. It is
            not: admin is ~10% of the charge and reinsurance ~50%.

            ⚠ THESE ARE THE INCOME STATEMENT'S OWN FIGURES, NOT A RATIO APPLIED
            TO THE DISPLAY. quoteLineRates defines
            totalMemberChargeRatePer100 = pool + admin + reins + retained
            cover margin, and the engine defines totalMemberCharge =
            (poolPremium + adminExpense) + reinsuranceCost + retainedCoverMargin
            from the same four quantities. The fourth row renders only when a
            layer is declined — it is an exact 0 otherwise — reinsurance off the
            runtime tower quote, admin off ADMIN_EXPENSE_RATIO_OF_PURE_PREMIUM.
            So the four rows below add up exactly rather than approximately, and
            panel-engine-parity-check asserts both components against the engine
            to 0.00e+0.

            ⚠ ONE BASIS NOTE, now that the gross row is not on screen to show it:
            ADMIN IS ON THE GROSS PURE PREMIUM while the pool premium rate is on
            the NET. That is deliberate and matches the engine — the pool
            adjusts, reserves and pays a ceded claim in full and only then
            recovers, so ceding transfers the loss and not the handling cost.
            See linePricing.ts. */}
        {/* ⚠ THE OLD PANEL. It renders while NEW_RATE_STACK is off, which is
            every shipped build today. The new two-column panel above replaces
            every row from here to the underfunding sentence; the two are never
            on screen together. */}
        <DataRow label="Net Pure Premium Rate / $100" value={`$${c.netPurePremiumPer100.toFixed(2)}`} />
        <DataRow label="Pool Premium Rate / $100" value={`$${c.poolPremiumRatePer100.toFixed(2)}`} />
        <DataRow label="… Admin / $100" value={`$${c.adminRatePer100.toFixed(2)}`} />
        <DataRow label="… Reinsurance / $100" value={`$${c.reinsRatePer100.toFixed(2)}`} />
        {c.retainedCoverMarginRatePer100 > 0 && (
          <DataRow label="… Declined Cover, Kept / $100" value={`$${c.retainedCoverMarginRatePer100.toFixed(2)}`} />
        )}
        <DataRow label="Total Member Charge Rate / $100" value={`$${c.totalMemberChargeRatePer100.toFixed(2)}`} />
        <DataRow label="The Load (charge ÷ expected loss)" value={`${c.load.toFixed(2)}×`} />
        <DataRow label="Expected Combined Ratio" value={pct1(c.expectedCombinedRatio * 100)} />
        <DataRow
          label="Derived Rate Change vs Last Year"
          value={c.derivedRateChangePct === null ? 'N/A (no prior year)' : signed(c.derivedRateChangePct)}
        />
        <DataRow
          label="Marginal Cost of Next Step"
          value={c.isAtMax ? 'At maximum (95%)' : `${signed(c.marginalCostPct ?? 0)} pool premium`}
        />
      </div>

      <div className="border-t border-gray-200 pt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        <DataRow label="Reserve Margin Standard (fixed)" value={`90% confidence, CLF ${reserveMarginCLF.toFixed(3)}`} />
        <DataRow
          label="Excess Capital Ratio (as of last year)"
          value={lastLineResult ? `${(lastLineResult.excessCapitalRatio ?? 0).toFixed(2)} (${lastLineResult.capitalAdequacyStatus})` : '—'}
        />
      </div>

      {c.isAdequate ? (
        <p className="text-blue-700 bg-blue-50 border border-blue-100 rounded-md px-2.5 py-1.5 leading-relaxed">
          Adequate in ~{(c.confidenceLevel * 100).toFixed(0)}% of years; margin over expected {signed(c.marginPct)}.
        </p>
      ) : (
        <p className="text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5 leading-relaxed font-medium">
          UNDERFUNDING — this funds only {pct1(c.fundedPct)} of expected losses; expected combined ratio {pct1(c.expectedCombinedRatio * 100)}.
        </p>
      )}
    </div>
  );
}

// Inactive marker (Part 3). Both new underwriting controls render but are
// deliberately NOT wired to anything — see the module comment on why.

// Wrapper that visually greys out an inactive preview control and attaches
// the "why" as persistent helper text, rather than only a hover tooltip — a
// control that LOOKS live but is not is the failure this exists to prevent.
// ⚠ InactivePreview IS DELETED, NOT LEFT UNUSED. It wrapped New Business
// Appetite while that control was a preview, and its footer read "Activates
// once member loss history exists (Stage 4 of the marketplace-generation
// work)". The history exists and the control reads it, so the wrapper has no
// remaining consumer. Leaving it would leave the next inactive-looking control
// a ready-made way to ship dark. InactiveBadge went with it — it was the
// wrapper's own badge and had no other caller.

// ⚠ PreviewBox AND joinLabel ARE DELETED. They rendered the Renewal and New
// Business tiles, which are sliders now (RenewalUnderwriting, IntakeSlider), and
// had no other caller.

// ⚠ PROPERTY HAS NOTHING TO RATE ON, AND THE CONTROLS SAY SO RATHER THAN
// DISAPPEARING. Hiding the line would leave a player wondering whether
// Property has admission controls at all; showing them greyed with no reason
// would read as "not built yet", which is wrong — it IS built and it measured
// at nothing. Property's primary-layer credibility is 0.000 at every split
// point tried, so every Property member's modifier is exactly 1.000.
//
// The reason is written in the MEMBER'S terms, not ours. "Reliability 0.000
// over disjoint three-year windows" is the measurement; "a typical member has
// about one property claim every other year" is the same fact in a form a
// pool administrator can check against their own experience.
// ⚠ PROPERTY SHOWS NOTHING — NOT A RATIO WITH THE TIER GREYED OUT, AND THE
// DIFFERENCE MATTERS.
//
// Property has a ratio in the arithmetic sense: actual over expected exists for
// any member with a ledger. Three reasons it is not rendered.
//
//   IT IS NULL BY CONSTRUCTION, NOT BY A SWITCH. clampedRatioFor returns
//     rated: false whenever CREDIBILITY_Z is 0, and Property's Z is 0 because
//     its measured reliability was 0.000 at every split point tried. So
//     `rawRatio` is null on every Property member and there is no number to
//     render without computing one specially — which would mean writing code to
//     surface a quantity the measurement says carries no signal.
//
//   AT 1.9 CLAIMS PER WINDOW THE NUMBER IS NOISE WEARING A DECIMAL POINT. A
//     member with no claims reads 0.00 and one with a single average claim
//     reads about 2.0. Rendering that as "0.00x" against "2.03x" invites a
//     reader to conclude one member is infinitely better run than the other,
//     when the two are one claim apart.
//
//   A GREYED-OUT NUMBER STILL RANKS. Showing the ratio with the tier disabled
//     is worse than showing nothing, because the Membership table would sort on
//     it and a player would act on the ordering whether or not a control was
//     attached. Disabling the decision does not disable the inference.
//
// So: the note below, and no column. Renewal Underwriting renders this in place
// of its boxes, and New Business Appetite appends it.
function PropertyNoSignalNote() {
  return (
    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 leading-relaxed mt-1">
      Not available on Property, and no loss ratio is shown. A typical member has about one property claim
      every other year — about {EXPERIENCE_MOD.windowYears / 2} in a {EXPERIENCE_MOD.windowYears}-year record — so a quiet stretch cannot be told apart
      from a safe one. Every Property member is charged the same relativity for their size and location,
      whatever their recent claims. Workers&rsquo; Compensation and General Liability have enough claims to
      rate on.
    </p>
  );
}

// ============================================================================
// RENEWAL — THE SLIDER. Zero keeps every member; rising, the pool non-renews
// the worst X% of the book on each member's own multi-year loss ratio — the
// Loss Ratio column on Membership. See RENEWAL_CUT_STEPS for the steps and for
// what the slider teaches.
//
// ⚠ THE NUMBER SHOWN IS THE NUMBER THAT HAPPENS. The count and the list come
// from renewalDeclines, the SAME function the engine applies, on the current
// book, ledger and year — no forecast. A share of the book has no settling
// effect the screen would have to warn about (a threshold's count fell as the
// worst members went; a share's does not), so the label can carry the share.
//
// ⚠ AND IT SHOWS WHAT THE CHOICE DOES TO THE BOOK, because that is the part a
// player misjudges. The loss ratio barely persists (Z = 0.155 on WC), so the
// members this removes are mostly ones who had a bad three years, not bad
// risks: the slider shrinks the book faster than it cleans it. The line under
// the slider puts the book size beside the count so the shrinking is visible
// before any member reacts.
//
// ⚠ PER-MEMBER OVERRIDE (flag who it would decline, spare individuals) is still
// deferred for the reasons recorded above IntakeSlider — table time and the
// loss of the forecast.
// ============================================================================
// ============================================================================
// THE BOOK'S UNDERWRITING — MEMBER_LEVEL off. Two settings on one book: the
// share of it not renewed, and the share of it written new each year. Both
// read and act on exposure; no member is named or counted.
// ============================================================================
function BookRenewal({ value, onChange, disabled }: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const top = RENEWAL_CUT_STEPS[RENEWAL_CUT_STEPS.length - 1];
  const step = RENEWAL_CUT_STEPS[1] - RENEWAL_CUT_STEPS[0];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <SliderInput
        label="Renewal"
        value={value}
        min={0}
        max={top}
        step={step}
        onChange={onChange}
        formatValue={v => (v > 0 ? `Non-renew ${(v * 100).toFixed(0)}% of the book` : 'Renew all')}
        leftLabel="Renew all"
        rightLabel={`${(top * 100).toFixed(0)}% of the book`}
        disabled={disabled}
      />
      {/* No forecast line under the slider (UI tidy): the dollars it named came off. */}
    </div>
  );
}

function BookIntake({ value, onChange, disabled }: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <SliderInput
        label="New business"
        value={value}
        min={INTAKE_NONE}
        max={INTAKE_LOW}
        step={1}
        onChange={onChange}
        formatValue={intakeLabel}
        disabled={disabled}
      />
      <div className="grid grid-cols-4 text-[11px] text-gray-400 -mt-1">
        {INTAKE_POSITIONS.map((p, i) => (
          <span
            key={p.name}
            className={`${i === 0 ? 'text-left' : i === INTAKE_POSITIONS.length - 1 ? 'text-right' : 'text-center'} ${i === value ? 'font-semibold text-gray-700' : ''}`}
          >
            {p.name} {(intakeShare(i) * 100).toFixed(0)}%
          </span>
        ))}
      </div>
      {/* No forecast line under the slider (UI tidy): the dollars it named came off. */}
    </div>
  );
}

function RenewalUnderwriting({
  line, members, history, yearNumber, value, onChange, disabled,
}: {
  line: CoverageLine;
  members: Member[];
  history: MemberLossHistory;
  yearNumber: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const declines = React.useMemo(
    () => renewalDeclines(members, line, history, yearNumber, value).length,
    [members, line, history, yearNumber, value],
  );
  const rated = line !== 'Property';
  const top = RENEWAL_CUT_STEPS[RENEWAL_CUT_STEPS.length - 1];
  const step = RENEWAL_CUT_STEPS[1] - RENEWAL_CUT_STEPS[0];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      {rated ? (
        <>
          <SliderInput
            label="Renewal"
            value={value}
            min={0}
            max={top}
            step={step}
            onChange={onChange}
            formatValue={v => (v > 0 ? `Non-renew worst ${(v * 100).toFixed(0)}%` : 'Renew all')}
            leftLabel="Renew all"
            rightLabel={`Worst ${(top * 100).toFixed(0)}%`}
            disabled={disabled}
          />
          <p className="text-xs text-gray-600">
            {value > 0
              ? `${declines} of ${members.length} member${members.length === 1 ? '' : 's'} not renewed this year — `
                + `the book opens next year at ${members.length - declines} before anyone joins.`
              : `Every member is renewed — the book opens next year at ${members.length} before anyone joins.`}
          </p>
          <p className="flex items-start gap-1 text-[11px] text-gray-500 leading-relaxed">
            <Info size={12} className="mt-0.5 flex-shrink-0" />
            <span>
              Ranks members by how much their losses have run against their own expected cost over the
              last {EXPERIENCE_MOD.windowYears} years — the Loss Ratio column on Membership — and does not renew
              the worst. A member not renewed cannot rejoin for {REENROLLMENT_COOLDOWN_YEARS} years.
            </span>
          </p>
        </>
      ) : (
        <>
          <span className="text-sm font-semibold text-gray-700">Renewal</span>
          <PropertyNoSignalNote />
        </>
      )}
    </div>
  );
}

// ============================================================================
// INTAKE — ONE SLIDER, FOUR NAMED POSITIONS: No New Business, Strict, Moderate,
// Low. Each sets a bar on a NOISY INSPECTION of risk quality and a cap on how
// many join; the names sit on the slider, so a player reads "Strict" rather
// than a bar value. See intakeInspection.ts for the positions and the
// measurement they were set against, and INSPECTION_SIGMA for why it is an
// inspection and not the truth.
//
// ⚠ THE FORECAST IS AN EXPECTATION AND IS LABELLED AS ONE. The available pool,
// the application count and the intake room are exact; WHICH members apply is
// drawn (and skewed toward worse risks, APPLICANT_ADVERSE_SELECTION), and each
// applicant's inspection is drawn. So the page sums, over the available pool,
// each member's chance of applying (applicantInclusion) times their chance of
// clearing the bar (intakePassProbability), then takes E[min(cap, passing)]
// (intakeForecast) — no draw, and no per-member figure reaches the screen, only
// the sum. When more are expected to pass than the cap allows, it says the CAP
// is what limits intake this year, not the standard.
//
// ⚠ WHAT IT MOVES. Intake shapes the book's QUALITY, and with pricing
// cost-plus that shows in members' rates rather than in surplus — a better
// intake lowers the triangle's loss cost a few years later. What the slider
// can show before members react is how many join and the book they join; the
// rate consequence is on the funding panel, a few years on.
//
// ⚠ PER-APPLICANT ACCEPT/DECLINE IS DEFERRED, NOT PENDING. A dozen decisions a
// year, across ten years and five teams, is the whole session in a facilitated
// room, and per-applicant has nothing to forecast — the join count depends on
// choices not yet made. The slider is a POLICY, which is what makes the count
// above computable. Reopening it means arguing those two costs down. (The same
// reasoning covers per-member renewal overrides.)
// ============================================================================
function IntakeSlider({
  line, members, allMarketMembers, membershipHistory, yearNumber, value, onChange, disabled,
}: {
  line: CoverageLine;
  members: Member[];
  allMarketMembers: Member[];
  membershipHistory: MembershipHistory;
  yearNumber: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  // The applicant pool as the engine builds it: marketplace minus enrolled,
  // minus anyone inside their two-year cooldown — same source as
  // simulateMemberMovement so the counts cannot drift from the draw.
  const forecast = React.useMemo(() => {
    const enrolled = new Set(members.map(m => m.id));
    const available = allMarketMembers.filter(
      m => !enrolled.has(m.id) && canReenroll(membershipHistory, m.id, line, yearNumber),
    );
    const applications = Math.min(available.length, Math.round(available.length * APPLICATION_RATE));
    // The position's cap, on the same book the engine reads.
    const cap = intakeCap(value, members.length);
    // Expected applicants clearing the bar: each member's chance of applying
    // (applicantInclusion, the draw's own law) times their chance of passing.
    const inclusion = applicantInclusion(available, applications);
    let passing = 0;
    for (const m of available) passing += (inclusion.get(m.id) ?? 0) * intakePassProbability(m, value);
    const f = intakeForecast(applications, passing, cap);
    return {
      applications, cap, passing,
      joins: Math.round(f.expectedJoins),
      capLimits: passing > cap,
    };
  }, [members, allMarketMembers, membershipHistory, line, yearNumber, value]);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <SliderInput
        label="New business"
        value={value}
        min={INTAKE_NONE}
        max={INTAKE_LOW}
        step={1}
        onChange={onChange}
        formatValue={intakeLabel}
        disabled={disabled}
      />
      {/* THE NAMES ON THE SLIDER, one under each stop, the current one in bold. */}
      <div className="grid grid-cols-4 text-[11px] text-gray-400 -mt-1">
        {INTAKE_POSITIONS.map((p, i) => (
          <span
            key={p.name}
            className={`${i === 0 ? 'text-left' : i === INTAKE_POSITIONS.length - 1 ? 'text-right' : 'text-center'} ${i === value ? 'font-semibold text-gray-700' : ''}`}
          >
            {p.name}
          </span>
        ))}
      </div>
      <p className="text-xs text-gray-600">
        {value <= INTAKE_NONE
          ? `Nobody is written. About ${forecast.applications} entities will apply this year.`
          : `About ${forecast.joins} join this year — of about ${forecast.applications} applicants, about `
            + `${Math.round(forecast.passing)} expected to pass inspection, with room for ${forecast.cap} at this setting.`
            + (forecast.capLimits
              ? ' More are expected to pass than there is room for, so the room — not the standard — limits intake, and the best-inspected are taken.'
              : ' The standard, not the room, is what limits intake.')}
      </p>
      <p className="flex items-start gap-1 text-[11px] text-gray-500 leading-relaxed">
        <Info size={12} className="mt-0.5 flex-shrink-0" />
        <span>
          Applicants are inspected before they are written, and the inspection is imperfect — some good
          risks fail it and some poor ones pass. A stricter setting writes fewer members and better ones on
          average; a lower one writes more, including riskier ones. The entities keenest to join are often
          the ones the market has priced up.
        </span>
      </p>
    </div>
  );
}

// ============================================================================
// INVESTMENT IN RISK CONTROL INCENTIVES — ONE SLIDER PER LINE, SCREEN ONLY.
//
// Replaces the five-tile Risk Control Programs card that stood on the Pool tab
// (see the note where it was removed). The programme a line runs is now a
// property of the LINE, named here, and the only choice is how much of that
// line's premium goes into it: 0 to 5%, in 1% steps, default 0.
//
// ⚠ THE VALUE IS STORED AND NOT READ. The rate indication this spend is meant
// to feed is being redesigned, so wiring it now would mean wiring it twice.
// `LineDecisionSet.riskControlIncentivePct` persists with the rest of the
// line's decisions and reaches the server inside the opaque decisions blob, so
// it is ready for the one read site the new indication will need. The screen
// says this in as many words rather than leaving a live-looking control that
// quietly does nothing — a lever that moves and changes no figure is the kind
// of thing a player spends a game trying to explain.
//
// ⚠ AND THE SPEND COMES OUT OF THE LINE'S PREMIUM. It is not a surcharge added
// to members' bills: the same dollars that would have paid losses and expenses
// pay for the programme instead. That is the sentence under the slider, and it
// is the whole economic claim the control makes while it is unwired.
const RISK_CONTROL_PROGRAM_NAME: Record<CoverageLine, string> = {
  WC: 'Safety & Return-to-Work',
  GL: 'Training and Analytics',
  Property: 'Mitigation',
};

function RiskControlIncentives({ line, value, onChange, disabled }: {
  line: CoverageLine;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
  /** RISK_CONTROL off: the slider is shown at 0%, disabled, as coming soon. */
  comingSoon?: boolean;
}) {
  const r = SLIDER_RANGES.riskControlIncentivePct;
  return (
    <div className="space-y-3">
      <SliderInput
        label={RISK_CONTROL_PROGRAM_NAME[line]}
        value={value}
        min={r.min}
        max={r.max}
        step={r.step}
        onChange={onChange}
        formatValue={v => `${Math.round(v * 100)}% of premium`}
        leftLabel="None"
        rightLabel={`${Math.round(r.max * 100)}% of premium`}
        valueColor={value > 0 ? 'text-emerald-600' : 'text-gray-500'}
        disabled={disabled}
        helpText={`How much of ${lineDisplayName(line)}'s premium is spent on ${RISK_CONTROL_PROGRAM_NAME[line]}.`}
      />
      {/* ⚠ NO NOTES UNDER THE SLIDER (UI tidy). Both stood here — "The spend
          comes out of this line's premium…" and the "Coming soon — risk control
          is being redesigned…" box — and came off; the slider stays, disabled
          at 0% while RISK_CONTROL is off. */}
    </div>
  );
}

// ============================================================================
// WHAT THE DIVIDEND / ASSESSMENT SLIDER COSTS, IN DOLLARS.
//
//   Surplus: $52.4M   +10% ($5.2M)     green, for a dividend
//   Surplus: $52.4M   -10% ($5.2M)     red and signed, for an assessment
//   Surplus: $52.4M   0%               gray, and NO dollar amount
//
// ⚠ THE DOLLARS ARE THE ENGINE'S, NOT A SECOND SUM. `surplus` arrives already
// put through dividendAssessmentBasis — the same function simulationEngine
// multiplies — so `surplus * pct` here is arithmetic on the engine's own two
// inputs rather than a parallel model of the payment. That is the only reason
// the figure can be stated as what is paid or charged.
//
// ⚠ NO DOLLAR FIGURE AT ZERO, DELIBERATELY. "$0" is a quantity and invites the
// reading that something moved and netted out. Nothing moves at 0%: the row
// says what the surplus is and that the share of it is none.
//
// ⚠ THE MINUS SIGN IS KEPT ON THE ASSESSMENT and the dollars are not negated.
// The sign belongs to the DIRECTION of the percentage — money leaving members
// rather than reaching them — and the amount is an amount either way. Printing
// "-10% (-$5.2M)" would state the direction twice and read as a negative
// charge, which is what the basis clamp in dividendAssessment.ts exists to
// prevent in the engine.
function DividendAssessmentNote({ surplus, pct }: { surplus: number | null; pct: number }) {
  if (surplus === null) return null;
  const isDividend = pct > 0.0001;
  const isAssessment = pct < -0.0001;
  const amount = surplus * Math.abs(pct);
  const tone = isDividend ? 'text-emerald-600' : isAssessment ? 'text-red-600' : 'text-gray-500';
  const signedPct = `${isDividend ? '+' : isAssessment ? '−' : ''}${Math.round(Math.abs(pct) * 100)}%`;
  return (
    <p className="flex items-center gap-2 text-xs text-gray-500 -mt-3">
      <span>Surplus: {formatCurrency(surplus, true)}</span>
      <span className={`font-semibold ${tone}`}>
        {signedPct}
        {(isDividend || isAssessment) && ` (${formatCurrency(amount, true)})`}
      </span>
    </p>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2 bg-gray-50/50">
        <span className="text-blue-600">{icon}</span>
        <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
      </div>
      <div className="p-5 space-y-5">{children}</div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}:</span>
      <span className="font-semibold text-gray-800">{value}</span>
    </div>
  );
}

// ============================================================================
// THE REINSURANCE PACKAGE — ONE CHOICE PER LINE (loss engine commit 4a).
//
// A team picks one package from REINSURANCE_OPTIONS instead of placing each
// band. Every price here is the engine's own quote — occurrenceProgramCost on
// the line's book, over the package's layers — so the panel cannot show a
// figure the engine does not charge. The aggregate stop-loss is not offered.
//
// A peril with its own deductible is listed from PROPERTY_PERIL_DEDUCTIBLE, as
// the per-band panel listed it: the cession applies it, so a package attaching
// below it answers that peril only from the deductible up.
// ============================================================================
function PackageControls(props: {
  line: CoverageLine;
  d: LineDecisionSet;
  setMany: (patch: Partial<LineDecisionSet>) => void;
  disabled: boolean;
  book: Book;
  yearNumber: number;
}) {
  return AGGREGATE_STOP.enabled ? <StopControls {...props} /> : <OccurrencePackageControls {...props} />;
}

// ============================================================================
// THE AGGREGATE STOP — ONE CHOICE PER LINE (stable-scenarios commit 6).
//
// ⚠ EACH OPTION'S NAME, WHAT IT COVERS IN ONE SENTENCE, AND ITS PRICE — NEVER
// its expected recovery or how it was priced (docs/PENDING_MULTIPLAYER.md).
// The price is the engine's own quote (aggregateStop.stopQuote) on the line's
// book and year, so the panel cannot show a figure the engine does not charge.
// ============================================================================
function StopControls({ line, d, setMany, disabled, book, yearNumber }: {
  line: CoverageLine;
  d: LineDecisionSet;
  setMany: (patch: Partial<LineDecisionSet>) => void;
  disabled: boolean;
  book: Book;
  yearNumber: number;
}) {
  const exposure = bookExposureOf(book, line, yearNumber);
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600 leading-relaxed">
        Choose <strong>one cover</strong> for this line. Each protects the Pool against a year whose losses run
        well above what was expected.
      </p>
      <div className="space-y-1.5" data-testid={`reins-options-${line}`}>
        {AGGREGATE_STOP_OPTIONS.map(o => {
          const chosen = d.reinsuranceOption === o.id;
          const price = o.limit > 0 ? stopQuote(line, o.id, exposure, yearNumber, bookRiskOf(book)).premium : 0;
          return (
            <button
              key={o.id}
              type="button"
              data-testid={`reins-option-${line}-${o.id}`}
              disabled={disabled}
              onClick={() => !disabled && setMany({ reinsuranceOption: o.id })}
              className={`w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm text-left ${
                chosen ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <span>
                <span className={chosen ? 'font-semibold' : ''}>{o.name}</span>
                <span className="block text-xs text-gray-500">{stopWording(o.id)}</span>
              </span>
              <span className="text-xs text-gray-600 whitespace-nowrap">{formatCurrency(price)}/yr</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The per-claim packages, dormant behind AGGREGATE_STOP.
function OccurrencePackageControls({ line, d, setMany, disabled, book, yearNumber }: {
  line: CoverageLine;
  d: LineDecisionSet;
  setMany: (patch: Partial<LineDecisionSet>) => void;
  disabled: boolean;
  book: Book;
  yearNumber: number;
}) {
  const quotes = reinsuranceOptionsFor(line).map(o => ({
    o, q: occurrenceProgramCost(line as TowerLine, placementFor(line, o.id), book, yearNumber),
  }));
  const perilDeductibles = line === 'Property' ? Object.entries(PROPERTY_PERIL_DEDUCTIBLE) : [];
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600 leading-relaxed">
        Choose <strong>one package</strong> for this line. Each covers every occurrence above its attachment
        up to its limit.
      </p>
      {perilDeductibles.length > 0 && (
        <p className="text-xs text-gray-600 leading-relaxed" data-testid="reins-peril-deductibles">
          {perilDeductibles.map(([peril, ded]) =>
            `${peril.charAt(0).toUpperCase()}${peril.slice(1)} carries its own $${ded / 1e6}M retention per occurrence: `
            + 'a package attaching below it answers that peril from there up.').join(' ')}
        </p>
      )}
      <div className="space-y-1.5" data-testid={`reins-options-${line}`}>
        {quotes.map(({ o, q }) => {
          const chosen = d.reinsuranceOption === o.id;
          return (
            <button
              key={o.id}
              type="button"
              data-testid={`reins-option-${line}-${o.id}`}
              disabled={disabled}
              onClick={() => !disabled && setMany({ reinsuranceOption: o.id })}
              className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-sm text-left ${
                chosen ? 'border-blue-500 bg-blue-50 font-semibold' : 'border-gray-200 bg-white hover:bg-gray-50'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <span>{o.id === 'none' ? 'None — retain every loss' : o.id}</span>
              <span className="text-xs text-gray-600">
                {/* ⚠ THE PRICE ONLY — never the expected recovery or how it was priced. */}
                {o.id === 'none' ? '$0/yr' : `${formatCurrency(q.premium)}/yr`}
              </span>
            </button>
          );
        })}
      </div>
      {/* ⚠ PRICE ONLY (UI tidy). The note that aggregate cover is not offered and
          the Package / Reinsurance Cost / Retained Above Package block came off:
          players see each option's price, never its expected recovery or how it
          was priced (docs/PENDING_MULTIPLAYER.md). */}
    </div>
  );
}
