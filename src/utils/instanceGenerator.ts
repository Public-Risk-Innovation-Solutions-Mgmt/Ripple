// Generates a deterministic game instance from a seed
// Exposure = payroll in millions of dollars
// Premium = Exposure($M) × Rate_per_$100_payroll × 10,000

import { scenarioOfId } from './scenarios';
import type { GameInstance, Member, MembershipHistory, PoolState, LinePoolState, StartingFinancials } from '../types/simulation';
import { SeededRandom, deriveSubRng } from './random';
import { getPredefinedMarketMembers } from '../data/memberCatalog';
import { getMemberExposure, emptyLinePoolState } from './lineHelpers';
import {
  STARTING_FINANCIALS,
  STARTING_EXPOSURE_SHARE,
  STARTING_CAPITAL_TO_PREMIUM,
  OPERATING_CASH_PCT_OF_PREMIUM,
  STARTING_RATE_PER_100,
  GL_STARTING_RATE_PER_100,
  GL_EXPECTED_LOSS_RATIO,
  GL_STARTING_FINANCIALS,
  PROPERTY_STARTING_RATE_PER_100,
  PROPERTY_EXPECTED_LOSS_RATIO,
  PROPERTY_STARTING_FINANCIALS,
} from '../data/defaultAssumptions';
import type { CoverageLine } from '../types/simulation';
import type { ScheduledShock } from '../types/shocks';
import { SHOCK_EVENTS } from './shockLosses';
import { FULL_MARKET_EXPOSURE, MEMBER_LEVEL, OPENING_BOOK_EXPOSURE, regionByShare } from '../data/pricingParameters';
import { exposureFactor } from '../data/exposureTrend';

// Each active line independently enrolls its own starting members. First it
// draws its own seeded TARGET share within the STARTING_EXPOSURE_SHARE band
// (25-35%) — so different seeds/lines land at different points across the band,
// not always at the 25% floor. Then it iterates the 100-member market in a
// seeded random order, accumulating that line's enrolled exposure (WC payroll /
// GL payroll / Property TIV) until it reaches that drawn target. A member whose
// exposure would push the running total past the target is skipped in favor of
// smaller members later in the order, so the landing is always at-or-just-below
// the target (hence inside the band) — single pass, no retries, deterministic
// per seed. The exposure target drives the member count; there is no separate
// count draw or quality screen at enrollment (underwriting strictness screening
// remains a live-year recruitment mechanic and can't apply before any decisions
// exist). The target draw and the shuffle share this line's own derived stream,
// so both are deterministic per seed and independent of the other lines.
function selectStartingLineMembers(
  allMembers: Member[],
  line: CoverageLine,
  rng: SeededRandom,
  // Threaded only so the two exposure reads below sit on ONE basis. The
  // selection is a RATIO (targetShare x totalExposure), so the wage factor
  // cancels exactly and the chosen book is year-invariant whatever is passed.
  yearNumber: number,
): Set<string> {
  const totalExposure = allMembers.reduce((s, m) => s + getMemberExposure(m, line, yearNumber), 0);
  const targetShare = rng.range(STARTING_EXPOSURE_SHARE.min, STARTING_EXPOSURE_SHARE.max);
  const targetExposure = targetShare * totalExposure;

  const order = rng.shuffle([...allMembers]);
  const selected = new Set<string>();
  let enrolled = 0;

  for (const member of order) {
    if (enrolled >= targetExposure) break;
    const exposure = getMemberExposure(member, line, yearNumber);
    if (exposure <= 0 || enrolled + exposure > targetExposure) continue;
    selected.add(member.id);
    enrolled += exposure;
  }

  return selected;
}

// Per-line RNG label for the enrollment stream — WC unsuffixed, matching the
// engine's lineRngLabel convention, so each line's roster is deterministic per
// seed AND independent of which other lines are active.
function enrollLabel(line: CoverageLine): string {
  return line === 'WC' ? 'enroll' : `enroll_${line}`;
}

// ⚠ NO SEED COHORTS: THE POOL'S HISTORY BEGINS IN 2021. The bootstrap used to
// apportion a drawn reserve total into three to five synthetic prior accident
// years (generateStartingReserveCohorts) — cohorts with no claim register, which
// the pre-game then replaced with bulk years older than 2021. There are no
// accident years before the pre-game's first, so the bootstrap holds no
// reserves and the pre-game starts on its paid-in capital alone.
// ============================================================================
// THE SHOCK SCHEDULE IS AN ARGUMENT OF THE CONSTRUCTOR, AND BOTH CALLERS PASS IT.
//
// Solo (App.tsx) passes what its setup screen holds — nothing today; the solo
// setup screen has no shock control, so it passes an empty list. The session
// (session/client/buildGame.ts) passes the room's list. One constructor, both
// callers: a session layer assembling the instance its own way is how two paths
// come to disagree, which is why this seam was left open until it could be
// closed HERE rather than there.
//
// ⚠ AN EMPTY SCHEDULE WRITES NO FIELD AT ALL. `scheduledShocks` stays absent,
// exactly as before this argument existed, so every unshocked game — every
// solo game, every room nobody scheduled a shock in — is byte-identical to one
// built before it. Both baselines are the check.
//
// ⚠ THE LIST IS COPIED AND CHECKED, NOT TRUSTED. It is copied so a caller's
// array cannot be mutated underneath the instance. It is checked because a
// room's schedule arrives from another machine: an id that is not one of the
// R model's twelve would otherwise throw inside the new engine in the year it
// fires — possibly years into a session, on every team at once. Here it fails
// when the game is BUILT, before year 1. Any of the twelve may be scheduled.
// No randomness is consumed: the schedule is data, drawn (if it was drawn at
// all) once, by the host, before the room existed.
// ============================================================================
export function generateGameInstance(
  instanceId: string,
  seed: number,
  scheduledShocks: readonly ScheduledShock[] = [],
): GameInstance {
  for (const s of scheduledShocks) {
    if (!SHOCK_EVENTS.some(e => e.id === s.shockId)) {
      throw new Error(`generateGameInstance: scheduled shock '${s.shockId}' is not one of the twelve`);
    }
    if (!Number.isInteger(s.yearNumber) || s.yearNumber < 1) {
      throw new Error(`generateGameInstance: scheduled shock '${s.shockId}' has fire year ${s.yearNumber}; it must be a game year, 1 or later`);
    }
  }
  // The scenario rides on the instance, so every copy of it plays the same one.
  const instance = { ...baseInstance(instanceId, seed), scenario: scenarioOfId(instanceId, seed) };
  return scheduledShocks.length > 0
    ? { ...instance, scheduledShocks: withRegions(seed, scheduledShocks) }
    : instance;
}

// ⚠ A REGIONAL EVENT'S REGION IS PART OF THE SCHEDULE, RESOLVED HERE, ONCE.
// It was drawn per world in the engine, from the world's own seed, so the
// worlds disagreed about where one earthquake struck and the averaged row named
// one world's region. Resolving it with the instance — from the GAME's seed,
// before any world exists — gives every world the same region, whoever drew
// the schedule: the solo start, the host's Randomise, or a hand-picked entry.
// Every team builds the same instance from the same seed and list, so they
// agree too, and the room record needs no new field. Each entry has its own
// labelled stream (event, year, ordinal among the same event that year), so
// one entry's region never moves another's. A region already given is kept.
function withRegions(seed: number, schedule: readonly ScheduledShock[]): ScheduledShock[] {
  const ordinals = new Map<string, number>();
  return schedule.map(s => {
    const key = `${s.shockId}_${s.yearNumber}`;
    const ordinal = ordinals.get(key) ?? 0;
    ordinals.set(key, ordinal + 1);
    const base = { shockId: s.shockId, yearNumber: s.yearNumber };
    if (!SHOCK_EVENTS.find(e => e.id === s.shockId)!.regional) return base;
    if (s.region) return { ...base, region: s.region };
    const rng = deriveSubRng(seed, s.yearNumber, `shock_region_${s.shockId}_${ordinal}`);
    // By exposure share (regionByShare), one uniform as before.
    return { ...base, region: regionByShare(rng.next()) };
  });
}

function baseInstance(instanceId: string, seed: number): GameInstance {
  const rng = new SeededRandom(seed);
  return {
    instanceId,
    seed,
    lossEnvironment: {
      baseLossRatio: rng.range(0.62, 0.78),
      lossTrend: rng.range(0.02, 0.07),
      volatility: rng.range(0.10, 0.25),
      shockProbability: rng.range(0.05, 0.15),
      shockSeverityMultiplier: rng.range(1.8, 3.5),
      heavyTailRisk: rng.range(0.05, 0.25),
    },
    investmentEnvironment: {
      baseReturn: rng.range(0.025, 0.055),
      volatility: rng.range(0.04, 0.10),
      downsideRisk: rng.range(0.05, 0.15),
    },
    marketEnvironment: {
      totalMarketGrowthRate: rng.range(0.01, 0.04),
      competitivePressure: rng.range(0.3, 0.8),
      memberSensitivity: rng.range(0.3, 0.8),
    },
  };
}

// THE OPENING STATE IS DEFINED IN YEAR-1 DOLLARS, and every exposure read in
// this file uses it rather than `firstYearNumber`.
//
// ⚠ NOT AN OVERSIGHT — using firstYearNumber (-2 for the pre-game bootstrap)
// deflates the opening book ~10% by wageFactor while STARTING_FINANCIALS'
// premium/surplus ranges stay fixed dollars, which silently re-rates the whole
// opening position and moves every seed's starting membership. Year 1 is the
// reference year of the trend system (every factor is exactly 1.0 there) and it
// is the vintage memberCatalog's payroll is authored in, so the dollar constants
// calibrated against that roster keep meaning what they meant.
//
// The pre-game years still deflate — processYear applies the factor per year on
// its own — so the past really is cheaper. Only the OPENING reference is pinned.
const OPENING_EXPOSURE_YEAR = 1;

export function generateStartingPoolState(
  instance: GameInstance,
  startingYear: number,
  activeLines: CoverageLine[],
  // The yearNumber of the first year the caller will simulate on this state
  // (-2 for the pre-game bootstrap). Opening enrollees' ledger intervals are
  // active from this year on.
  firstYearNumber: number
): { poolState: PoolState; startingFinancials: StartingFinancials } {
  const rng = new SeededRandom(instance.seed + 777);

  // ⚠ WITH MEMBER_LEVEL OFF THERE IS NO ROSTER TO DRAW. Each line opens as one
  // book at OPENING_BOOK_EXPOSURE, the market carries no members and the
  // membership ledger is empty. Every draw below on `rng` still happens, in
  // the same order — the enrolment draws are on their own labelled streams, so
  // skipping them moves nothing else.
  const bookMode = !MEMBER_LEVEL.enabled;
  const allMarketMembers = bookMode ? [] : getPredefinedMarketMembers();
  // ⚠ A LINE OPENS ON OPENING_BOOK_EXPOSURE, ONE FIGURE FOR ALL, AGAIN since
  // simple underwriting retired the book of units (which opened on its units'
  // sizes summed, different in every game). The pre-game grows into it.
  const openingExposure = (line: CoverageLine) => OPENING_BOOK_EXPOSURE[line];

  // Each active line draws its OWN starting roster (different but overlapping
  // sets) from its own derived stream — enrollment happens here, BEFORE the
  // pre-game years simulate on the enrolled books.
  const enrolledIdsByLine: Partial<Record<CoverageLine, Set<string>>> = {};
  for (const line of bookMode ? [] : activeLines) {
    enrolledIdsByLine[line] = selectStartingLineMembers(
      allMarketMembers,
      line,
      deriveSubRng(instance.seed, 0, enrollLabel(line)),
      OPENING_EXPOSURE_YEAR,
    );
  }

  const lineMembers = (line: CoverageLine): Member[] => {
    const ids = enrolledIdsByLine[line] ?? new Set<string>();
    return allMarketMembers.map(m => ({
      ...m,
      status: ids.has(m.id) ? ('active' as const) : ('prospect' as const),
      yearJoined: ids.has(m.id) ? 1 : 0,
      calendarYearJoined: ids.has(m.id) ? startingYear : 0,
    }));
  };

  // Shared market roster: a member is 'active' if it's enrolled in ANY active
  // line (only 'withdrawn' blocks recruitment elsewhere, so multi-line
  // membership keeps working exactly as in live years).
  const activeInAnyLine = new Set<string>(
    activeLines.flatMap(line => [...(enrolledIdsByLine[line] ?? [])])
  );
  const allMembersWithStatus: Member[] = allMarketMembers.map(m => ({
    ...m,
    status: activeInAnyLine.has(m.id) ? ('active' as const) : ('prospect' as const),
    yearJoined: activeInAnyLine.has(m.id) ? 1 : 0,
    calendarYearJoined: activeInAnyLine.has(m.id) ? startingYear : 0,
  }));

  const wcMembers = lineMembers('WC');
  const activeMembers = wcMembers.filter(m => m.status === 'active');

  let activeExposure = bookMode
    ? openingExposure('WC') * exposureFactor('WC', OPENING_EXPOSURE_YEAR)
    : activeMembers.reduce((sum, m) => sum + getMemberExposure(m, 'WC', OPENING_EXPOSURE_YEAR), 0);
  let totalMarketExposure = bookMode
    ? FULL_MARKET_EXPOSURE.WC * exposureFactor('WC', OPENING_EXPOSURE_YEAR)
    : allMarketMembers.reduce((sum, m) => sum + getMemberExposure(m, 'WC', OPENING_EXPOSURE_YEAR), 0);

  const targetPremium = rng.range(STARTING_FINANCIALS.annualPremium.min, STARTING_FINANCIALS.annualPremium.max);
  const annualPremium = targetPremium;

  const derivedRate = annualPremium / (activeExposure * 10_000);
  const ratePer100 = Math.max(STARTING_RATE_PER_100.min, Math.min(STARTING_RATE_PER_100.max, derivedRate));

  const expectedLossRatio = rng.range(STARTING_FINANCIALS.expectedLossRatio.min, STARTING_FINANCIALS.expectedLossRatio.max);
  const purePremiumPer100 = ratePer100 * expectedLossRatio;
  const memberSatisfaction = rng.range(STARTING_FINANCIALS.memberSatisfaction.min, STARTING_FINANCIALS.memberSatisfaction.max);
  const riskQuality = rng.range(STARTING_FINANCIALS.riskQuality.min, STARTING_FINANCIALS.riskQuality.max);

  const cash = rng.range(STARTING_FINANCIALS.cash.min, STARTING_FINANCIALS.cash.max);
  const investments = rng.range(STARTING_FINANCIALS.investments.min, STARTING_FINANCIALS.investments.max);
  // Retained solely to preserve RNG stream position. The reinsurance-recoverable
  // concept was removed (reserves are now net of reinsurance), but this draw
  // still consumes the bootstrap stream so that every subsequent draw — starting
  // cash, investments, reserves, cohort development factors, member generation —
  // lands on the same value as before. Deleting it would shift the whole sequence
  // and re-roll every seed's opening position.
  // The drawn value is used only locally: seededNetReserve = grossDraw - recoverableDraw.
  const wcRecoverableDraw = rng.range(STARTING_FINANCIALS.reinsuranceRecoverable.min, STARTING_FINANCIALS.reinsuranceRecoverable.max);
  // Retained solely to preserve RNG stream position. The otherAssets/
  // otherLiabilities concepts were removed (frozen bootstrap constants with no
  // mechanic), but these draws still consume the bootstrap stream so every
  // subsequent draw lands on the same value as before. Deleting them would
  // shift the sequence and re-roll every seed's opening position. The drawn
  // values are discarded.
  rng.range(STARTING_FINANCIALS.otherAssets.min, STARTING_FINANCIALS.otherAssets.max);
  const wcGrossReserveDraw = rng.range(STARTING_FINANCIALS.grossUnpaidReserve.min, STARTING_FINANCIALS.grossUnpaidReserve.max);
  // ⚠ DRAWN AND DISCARDED: no reserves before 2021 (see the note above
  // generateGameInstance). The draws stay so the rest of the stream lands where it did.
  void wcGrossReserveDraw; void wcRecoverableDraw;
  const netUnpaidReserve = 0;
  // Held at zero, matching every subsequent year: written premium is treated as collected
  // and earned in the year it's written, with no separate unearned-premium timing layer.
  const unearnedPremium = 0;
  // Retained solely to preserve RNG stream position (see the otherAssets draw above).
  rng.range(STARTING_FINANCIALS.otherLiabilities.min, STARTING_FINANCIALS.otherLiabilities.max);

  const totalAssets = cash + investments;
  const totalLiabilities = netUnpaidReserve + unearnedPremium;
  const surplus = totalAssets - totalLiabilities;

  const marketShare = activeExposure / Math.max(totalMarketExposure, 0.01);

  // GL bootstrap draws happen strictly after every WC draw above, so the WC-only
  // seed stream (and its regression baseline) is completely unaffected by GL's
  // presence or absence.
  const glLineState: LinePoolState = activeLines.includes('GL')
    ? (() => {
        const glRatePer100 = rng.range(GL_STARTING_RATE_PER_100.min, GL_STARTING_RATE_PER_100.max);
        const glExpectedLossRatio = rng.range(GL_EXPECTED_LOSS_RATIO.min, GL_EXPECTED_LOSS_RATIO.max);
        const glPurePremiumPer100 = glRatePer100 * glExpectedLossRatio;
        const glGrossReserveDraw = rng.range(GL_STARTING_FINANCIALS.grossUnpaidReserve.min, GL_STARTING_FINANCIALS.grossUnpaidReserve.max);
        // Retained solely to preserve RNG stream position. The reinsurance-recoverable
        // concept was removed (reserves are now net of reinsurance), but this draw
        // still consumes the bootstrap stream so that every subsequent draw — starting
        // cash, investments, reserves, cohort development factors, member generation —
        // lands on the same value as before. Deleting it would shift the whole sequence
        // and re-roll every seed's opening position.
        // The drawn value is used only locally: seededNetReserve = grossDraw - recoverableDraw.
        const glRecoverableDraw = rng.range(GL_STARTING_FINANCIALS.reinsuranceRecoverable.min, GL_STARTING_FINANCIALS.reinsuranceRecoverable.max);
        // Drawn and discarded: no reserves before 2021.
        void glGrossReserveDraw; void glRecoverableDraw;
        const glNetUnpaidReserve = 0;
        const glTotalMarketExposure = bookMode
          ? FULL_MARKET_EXPOSURE.GL * exposureFactor('GL', OPENING_EXPOSURE_YEAR)
          : allMarketMembers.reduce((sum, m) => sum + getMemberExposure(m, 'GL', OPENING_EXPOSURE_YEAR), 0);
        return {
          rateLevel: 100,
          ratePer100: glRatePer100,
          purePremiumPer100: glPurePremiumPer100,
          purePremium: glPurePremiumPer100,
          memberSatisfaction: parseFloat(memberSatisfaction.toFixed(1)),
          averageRiskQuality: parseFloat(riskQuality.toFixed(1)),
          riskControlEffectiveness: 0,
          reserveCohorts: [],
          members: lineMembers('GL'),
          ...(bookMode ? { bookExposure: openingExposure('GL') } : {}),
          netUnpaidReserve: glNetUnpaidReserve,
          // Placeholder — the redistribution block below assigns every active
          // line its weighted share of the opening surplus and investments.
          surplus: -glNetUnpaidReserve,
          investedAssets: 0,
          totalMarketExposure: glTotalMarketExposure,
        };
      })()
    : emptyLinePoolState();

  // Property bootstrap draws happen strictly after WC's and GL's above, so
  // neither of their seed streams (or regression baselines) are affected by
  // Property's presence or absence.
  const propertyLineState: LinePoolState = activeLines.includes('Property')
    ? (() => {
        const propertyRatePer100 = rng.range(PROPERTY_STARTING_RATE_PER_100.min, PROPERTY_STARTING_RATE_PER_100.max);
        const propertyExpectedLossRatio = rng.range(PROPERTY_EXPECTED_LOSS_RATIO.min, PROPERTY_EXPECTED_LOSS_RATIO.max);
        const propertyPurePremiumPer100 = propertyRatePer100 * propertyExpectedLossRatio;
        const propertyGrossReserveDraw = rng.range(PROPERTY_STARTING_FINANCIALS.grossUnpaidReserve.min, PROPERTY_STARTING_FINANCIALS.grossUnpaidReserve.max);
        // Retained solely to preserve RNG stream position. The reinsurance-recoverable
        // concept was removed (reserves are now net of reinsurance), but this draw
        // still consumes the bootstrap stream so that every subsequent draw — starting
        // cash, investments, reserves, cohort development factors, member generation —
        // lands on the same value as before. Deleting it would shift the whole sequence
        // and re-roll every seed's opening position.
        // The drawn value is used only locally: seededNetReserve = grossDraw - recoverableDraw.
        const propertyRecoverableDraw = rng.range(PROPERTY_STARTING_FINANCIALS.reinsuranceRecoverable.min, PROPERTY_STARTING_FINANCIALS.reinsuranceRecoverable.max);
        // Drawn and discarded: no reserves before 2021.
        void propertyGrossReserveDraw; void propertyRecoverableDraw;
        const propertyNetUnpaidReserve = 0;
        const propertyTotalMarketExposure = bookMode
          ? FULL_MARKET_EXPOSURE.Property * exposureFactor('Property', OPENING_EXPOSURE_YEAR)
          : allMarketMembers.reduce((sum, m) => sum + getMemberExposure(m, 'Property', OPENING_EXPOSURE_YEAR), 0);
        return {
          rateLevel: 100,
          ratePer100: propertyRatePer100,
          purePremiumPer100: propertyPurePremiumPer100,
          purePremium: propertyPurePremiumPer100,
          memberSatisfaction: parseFloat(memberSatisfaction.toFixed(1)),
          averageRiskQuality: parseFloat(riskQuality.toFixed(1)),
          riskControlEffectiveness: 0,
          reserveCohorts: [],
          members: lineMembers('Property'),
          ...(bookMode ? { bookExposure: openingExposure('Property') } : {}),
          netUnpaidReserve: propertyNetUnpaidReserve,
          // Placeholder — see the redistribution block below (same as GL).
          surplus: -propertyNetUnpaidReserve,
          investedAssets: 0,
          totalMarketExposure: propertyTotalMarketExposure,
        };
      })()
    : emptyLinePoolState();

  const wcLineState: LinePoolState = {
    rateLevel: 100,
    ratePer100,
    purePremiumPer100,
    purePremium: purePremiumPer100,
    memberSatisfaction: parseFloat(memberSatisfaction.toFixed(1)),
    averageRiskQuality: parseFloat(riskQuality.toFixed(1)),
    riskControlEffectiveness: 0,
    reserveCohorts: [],
    members: wcMembers,
    ...(bookMode ? { bookExposure: openingExposure('WC') } : {}),
    netUnpaidReserve,
    surplus,
    investedAssets: 0, // assigned by the redistribution block below
    totalMarketExposure,
  };

  // --- Per-line opening capital (seed-fix-per-line-opening) ---
  // Each active line's opening surplus = STARTING_CAPITAL_TO_PREMIUM[line] × its
  // OWN opening premium (its enrolled exposure × its rate). Invested assets are
  // the balance-sheet plug that realizes that surplus; operating cash is the
  // line's own 15%-of-premium target. This depends only on the line's own
  // premium/reserves — config-independent — replacing the old net-reserve-
  // weighted split of one shared pot (which made a line's opening depend on
  // which other lines were active). The shared cash/other-assets pool becomes
  // the SUM of each active line's own operating items; the live-year
  // contribution-share split then faithfully reproduces each line's stored
  // surplus (the split is constructed to do exactly that when the pool total is
  // internally consistent — see computeContributionShares), so Year 1 ties out
  // with cash still pooled.
  const lineStateByLine: Record<CoverageLine, LinePoolState> = {
    WC: wcLineState,
    GL: glLineState,
    Property: propertyLineState,
  };
  let poolCash = 0;
  activeLines.forEach(line => {
    const ls = lineStateByLine[line];
    const activeExp = ls.bookExposure !== undefined
      ? ls.bookExposure * exposureFactor(line, OPENING_EXPOSURE_YEAR)
      : ls.members
        .filter(m => m.status === 'active')
        .reduce((s, m) => s + getMemberExposure(m, line, OPENING_EXPOSURE_YEAR), 0);
    const linePremium = activeExp * ls.ratePer100 * 10_000;
    const targetSurplus = (STARTING_CAPITAL_TO_PREMIUM[line] ?? 1.0) * linePremium;
    const lineCash = OPERATING_CASH_PCT_OF_PREMIUM * linePremium;
    // surplus = cash + invested − netReserve
    // ⇒ invested = surplus + netReserve − cash
    ls.investedAssets = targetSurplus + ls.netUnpaidReserve - lineCash;
    ls.surplus = targetSurplus;
    poolCash += lineCash;
  });

  // Opening ledger: each line's enrollees are active from the first simulated
  // year. This is the authoritative per-line enrollment record (the shared
  // status field cannot answer per-line questions — see membershipHistory.ts).
  const membershipHistory: MembershipHistory = {};
  for (const line of activeLines) {
    for (const id of enrolledIdsByLine[line] ?? []) {
      const byLine = (membershipHistory[id] ??= {});
      byLine[line] = [{ startYear: firstYearNumber, endYear: null }];
    }
  }

  const poolState: PoolState = {
    cash: poolCash,
    unearnedPremium,
    allMarketMembers: allMembersWithStatus,
    lines: {
      WC: wcLineState,
      GL: glLineState,
      Property: propertyLineState,
    },
    interLineLoans: [],
    membershipHistory,
    // Empty at bootstrap by construction: no year has been simulated yet, so
    // there is nothing to record. The three pre-game years fill it as they run
    // through processYear (see priorHistoryEngine), which is why members carry
    // history at Year 1 rather than starting blank.
    memberLossHistory: {},
  };

  const startingFinancials: StartingFinancials = {
    cash,
    investments,
    totalAssets,
    netUnpaidReserve,
    unearnedPremium,
    totalLiabilities,
    surplus,
    annualPremium,
    expectedLossRatio,
    memberSatisfaction: parseFloat(memberSatisfaction.toFixed(1)),
    riskQuality: parseFloat(riskQuality.toFixed(1)),
    surplusToPremiumRatio: surplus / annualPremium,
    activeMembers: activeMembers.length,
    activeExposure: parseFloat(activeExposure.toFixed(2)),
    totalMarketExposure: parseFloat(totalMarketExposure.toFixed(2)),
    marketShare: parseFloat(marketShare.toFixed(4)),
    // The four rate fields are gone from StartingFinancials — see its note.
  };

  return { poolState, startingFinancials };
}
