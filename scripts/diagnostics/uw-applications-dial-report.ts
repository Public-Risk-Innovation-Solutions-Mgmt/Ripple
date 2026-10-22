// ============================================================================
// THE APPLICATIONS DIAL — a REPORT, not a gate (uw-hybrid).
//
//   npx tsx scripts/diagnostics/uw-applications-dial-report.ts --set NEW_BUSINESS_APPLICATIONS=0.03
//
// Scenario 18, Property only, five years, funded at Expected, every other
// decision at its default — four underwriting arms:
//
//   none        renewals declined 0%,  rejection 0%
//   renew 5     renewals declined 5%,  rejection 0%
//   reject 15   renewals declined 0%,  rejection 15%
//   both        renewals declined 10%, rejection 15%   (both strictest)
//
// For each, at year 5: the book's exposure, the loss ratio (the year's, and
// cumulative over years 1-5), the combined ratio
// (the year's, and cumulative over years 1-5 as the header shows it) and the
// surplus — all the worlds' averages, as the player sees them. Run it once per
// NEW_BUSINESS_APPLICATIONS (--set) to read the dial.
// ============================================================================

// ⚠ FIRST IMPORT — see pricing-overrides-install.ts.
import { overridesBanner } from '../tools/pricing-overrides-install';
import { NEW_BUSINESS_APPLICATIONS } from '../../src/data/pricingParameters';
import { openSoloInstance } from '../../src/utils/soloGame';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { commitSettledYear, openWorlds, playWorldsYear, settleWorldsYear } from '../../src/utils/worlds';
import type { DecisionSet, GameSetupSettings, GameState, LineResultSet } from '../../src/types/simulation';

const SCENARIO = '18';
const YEARS = 5;
const ARMS = [
  { name: 'none', renewalsDeclined: 0, newBusinessRejection: 0 },
  { name: 'renew 5', renewalsDeclined: 0.05, newBusinessRejection: 0 },
  { name: 'reject 15', renewalsDeclined: 0, newBusinessRejection: 0.15 },
  { name: 'both', renewalsDeclined: 0.10, newBusinessRejection: 0.15 },
];

function play(arm: typeof ARMS[number]) {
  const { setup, instance } = openSoloInstance({
    poolName: 'Dial', gameLength: YEARS, startingYear: 2026, instanceId: SCENARIO, activeLines: ['Property'],
  } as GameSetupSettings);
  const { poolState, priorHistory, earlyPreGameHistory } = runPriorHistory(instance, setup);
  const decide = (y: number): DecisionSet => {
    const d = defaultDecisionSet(y);
    return {
      ...d,
      byLine: { ...d.byLine, Property: { ...d.byLine.Property, fundingAtExpected: true,
        renewalsDeclined: arm.renewalsDeclined, newBusinessRejection: arm.newBusinessRejection } },
    };
  };
  let gs: GameState = openWorlds({
    setup, instance, currentYearNumber: 1, isStarted: true, isComplete: false, poolState, lockedResults: [],
    currentDecisions: decide(1), priorHistory, earlyPreGameHistory,
  });
  const opening = priorHistory[priorHistory.length - 1]?.byLine.Property?.activeExposure ?? NaN;
  const rows: LineResultSet[] = [];
  for (let y = 1; y <= YEARS; y++) {
    const played = playWorldsYear(gs, decide(y));
    gs = { ...gs, ...commitSettledYear(gs, settleWorldsYear(gs, played, [])), currentYearNumber: y + 1 };
    rows.push(gs.lockedResults[gs.lockedResults.length - 1].byLine.Property!);
  }
  const last = rows[rows.length - 1];
  const charge = rows.reduce((a, r) => a + r.totalMemberCharge, 0);
  const cumulativeCr = rows.reduce((a, r) => a + r.actualCombinedRatio * r.totalMemberCharge, 0) / charge;
  const cumulativeLr = rows.reduce((a, r) => a + r.netIncurredLoss, 0) / charge;
  return {
    arm: arm.name, opening, exposure: last.activeExposure, lossRatio: last.actualLossRatio,
    combined: last.actualCombinedRatio, cumulativeCr, cumulativeLr, surplus: gs.poolState.lines.Property!.surplus,
  };
}

console.log(overridesBanner);
console.log(`APPLICATIONS DIAL — scenario ${SCENARIO}, Property, ${YEARS} years, at Expected; `
  + `NEW_BUSINESS_APPLICATIONS = ${(100 * NEW_BUSINESS_APPLICATIONS).toFixed(0)}%`);
console.log('arm        | exposure y5 ($M) | vs opening | loss ratio y5 | loss ratio cum | combined y5 | combined cum | surplus y5 ($M)');
for (const arm of ARMS) {
  const r = play(arm);
  console.log(`${r.arm.padEnd(10)} | ${r.exposure.toFixed(1).padStart(16)} | ${(100 * (r.exposure / r.opening - 1)).toFixed(1).padStart(9)}% `
    + `| ${(100 * r.lossRatio).toFixed(1).padStart(12)}% | ${(100 * r.cumulativeLr).toFixed(1).padStart(13)}% | ${(100 * r.combined).toFixed(1).padStart(10)}% `
    + `| ${(100 * r.cumulativeCr).toFixed(1).padStart(11)}% | ${(r.surplus / 1e6).toFixed(2).padStart(15)}`);
}
