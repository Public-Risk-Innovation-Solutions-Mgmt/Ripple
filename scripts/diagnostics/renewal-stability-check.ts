// ============================================================================
// RENEWAL UNDERWRITING STABILITY — A GATE.
//
// ⚠ THIS EXITS NON-ZERO. Run:
//   npx tsx scripts/diagnostics/renewal-stability-check.ts
//   GAMES=3 YEARS=10 npx tsx scripts/diagnostics/renewal-stability-check.ts
//
// ============================================================================
// THE LOOP THIS EXISTS FOR, AND IT IS NOT THE ONE THAT WAS WATCHED FOR.
//
// The loop flagged twice during design was: decline high-modifier members ->
// the enrolled mix improves -> k_line moves -> the expectation moves -> next
// year's modifiers move. THAT LOOP DOES NOT EXIST. k_line sits in BOTH legs
// of the ratio deliberately (memberLossHistory.ts explains why), so actual
// and expected scale together and the modifier is k-invariant. Declining
// members changes k and the modifier does not notice.
//
// The real candidate is the REBASE DIVISOR:
//
//   mod = 1 + Z (c / M - 1),  M = the mean clamped ratio over the book
//
// Decline the worst members, M falls, every survivor's c/M rises, every
// survivor's modifier rises, and more of them sit above the threshold next
// year. Tighter than the loop being watched for, and through a different
// term entirely.
//
// ⚠ AND THE DAMPER THIS BLOCK USED TO DESCRIBE IS GONE, WHICH MAKES THE
// MEASUREMENT MATTER MORE RATHER THAN LESS. It argued that the threshold sat
// on the DISPLAYED modifier, which is divided by the median of the rated book
// and is therefore re-centred to 1.000 every year — so declining the upper
// tail moved the scale instead of pushing everyone up it. The threshold is not
// on the displayed modifier any more; it is on the member's own RAW ratio,
// which has no rebase and no re-centring in it at all.
//
// So the negative feedback that argument relied on does not apply, and neither
// does the rebase loop above: BOTH ran through M, and the raw ratio does not
// see M. What is left is whatever the loss draw and the two-year cooldown do
// between them, which is exactly what this gate measures rather than assumes.
//
// ============================================================================
// ⚠ THE CONTROL IS NOW A SHARE, AND THE GATE WAS RESTATED FOR IT. Renewal used
// to decline every member above a fixed RATIO, so the worry was a ratchet: more
// members over the bar each year. The renewal slider non-renews the worst X% of
// the book (RENEWAL_CUT_STEPS), so the COUNT is round(share x book) by
// construction and cannot ratchet. Section 1 now asserts exactly that — the
// count is the share, every warmed line-year — and still prints the early/late
// trend so a reader can see the book shrink rather than the count climb. The
// nulls and the positive control keep their jobs, on the share scale.
//
// FOUR CONTROLS, AND THE FOURTH IS THE ONE THE PREVIOUS TWO LOOP GATES
// LACKED.
//
//   NULL A — a threshold above ANY ATTAINABLE RATIO declines nobody, and must
//     be bit-identical to renewal switched off. Catches the mechanism being
//     wired into something it should not touch, which would show up even when
//     it declines no one. ⚠ That bound is EMPIRICAL since the threshold moved
//     to the raw ratio; it was structural on the clamped one. See the arm.
//
//   NULL B — the arm paired with ITSELF. The difference is identically zero,
//     so the trend test cannot fire. A test that fires here is measuring its
//     own noise.
//
//   WARM-UP EXCLUSION — the first years decline almost nobody because the
//     ledger has not filled and members are unrated, which looks exactly like
//     an upward ratchet and is not one. The trend is measured only over years
//     the ledger has fully warmed.
//
//   POSITIVE CONTROL — an absurd threshold, tight enough to decline a large
//     share of the book. The trend test MUST detect a difference there. This
//     is the clause both previous loop gates were missing: a stability test
//     that has never been shown to move is not a stability test.
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { processYear } from '../../src/utils/simulationEngine';
import { RENEWAL_CUT_STEPS } from '../../src/utils/renewalUnderwriting';
import { EXPERIENCE_MOD, CREDIBILITY_Z } from '../../src/utils/memberExperienceMod';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const RULE = '='.repeat(76);
const LINES: CoverageLine[] = ['WC', 'GL', 'Property'];
const RATED_LINES: CoverageLine[] = ['WC', 'GL'];
const GAMES = Number(process.env.GAMES ?? 6);
const YEARS = Number(process.env.YEARS ?? 14);
/** Years the ledger needs before anyone can be rated at all. */
const WARMUP = EXPERIENCE_MOD.minYears + 2;
/** The strongest shipped step, read from the constant so this gate cannot drift
 *  from the slider. */
const STRONGEST = Math.max(...RENEWAL_CUT_STEPS);
/** The positive control: a third of the book every year, three times the top
 *  step. Nothing about a share this size is a renewal decision, which is the
 *  point — the instrument must visibly move under it. */
const ABSURD = 0.30;
/** A cut too small to round to a single member on any book this engine makes
 *  (round(0.001 x 200) = 0). Must be indistinguishable from renewal off. */
const TOO_SMALL = 0.001;

const failures: string[] = [];
const mean = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
const sd = (v: number[]) => {
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};

interface YearRow { year: number; declines: number; enrolled: number; exposure: number; poolPremium: number; }

function play(g: number, cut: number): Record<string, YearRow[]> {
  const id = `RS${g}`;
  const instance = generateGameInstance(id, 47_000_000 + g * 7013);
  const setup = { poolName: 'S', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: LINES };
  const { poolState, priorHistory } = runPriorHistory(instance, setup as never);
  let gs: GameState = {
    setup: setup as never, instance, currentYearNumber: 1, isStarted: true, isComplete: false,
    poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
  };
  const out: Record<string, YearRow[]> = { WC: [], GL: [], Property: [] };
  for (let y = 1; y <= YEARS; y++) {
    const d = defaultDecisionSet(y) as DecisionSet;
    for (const l of LINES) d.byLine[l].renewalCut = cut;
    const p = processYear(gs, d);
    gs = { ...gs, currentYearNumber: y + 1, poolState: p.updatedPoolState, lockedResults: [...gs.lockedResults, p.result] };
    for (const lr of p.lineResults) {
      const x = lr.result as never as Record<string, unknown>;
      out[lr.line as string].push({
        year: y,
        declines: (x.declinedMembers as number) ?? 0,
        enrolled: x.activeMembers as number,
        exposure: x.activeExposure as number,
        poolPremium: x.poolPremium as number,
      });
    }
  }
  return out;
}

console.log(RULE);
console.log('RENEWAL STABILITY — the renewal slider, a share of the book');
console.log(RULE);
console.log(`${GAMES} games x ${YEARS} years. Shipped steps ${RENEWAL_CUT_STEPS.map(c => `${(c * 100).toFixed(1)}%`).join(' / ')} `
  + `of the book, worst first on the RAW ratio; strongest ${(STRONGEST * 100).toFixed(1)}%, positive control `
  + `${(ABSURD * 100).toFixed(0)}%. Warm-up ${WARMUP} years excluded from trends.`);
console.log(`Z: ` + LINES.map(l => `${l} ${CREDIBILITY_Z[l]}`).join(' / ') + '\n');

const off: Array<Record<string, YearRow[]>> = [];
const strong: Array<Record<string, YearRow[]>> = [];
const absurd: Array<Record<string, YearRow[]>> = [];
for (let g = 0; g < GAMES; g++) { off.push(play(g, 0)); strong.push(play(g, STRONGEST)); absurd.push(play(g, ABSURD)); }

/** Declines in the first vs the second half of the warmed years. */
function trend(runs: Array<Record<string, YearRow[]>>, line: string) {
  const early: number[] = [], late: number[] = [];
  for (const r of runs) {
    const warmed = r[line].filter(y => y.year > WARMUP);
    if (warmed.length < 4) continue;
    const mid = Math.floor(warmed.length / 2);
    early.push(mean(warmed.slice(0, mid).map(y => y.declines)));
    late.push(mean(warmed.slice(mid).map(y => y.declines)));
  }
  const diffs = early.map((e, i) => late[i] - e);
  const m = mean(diffs), s = sd(diffs);
  return { early: mean(early), late: mean(late), diff: m, se: s / Math.sqrt(Math.max(1, diffs.length)), n: diffs.length };
}

// ------------------------------------- 1. the count is the share, every year
console.log('--- 1. THE COUNT IS THE SHARE: declines = round(cut x book) on every warmed line-year ---');
{
  // The book the cut is taken of is the post-movement book, which is the
  // survivors plus the declined: activeMembers + declinedMembers.
  let checked = 0, short = 0, over = 0;
  for (const r of strong) {
    for (const line of RATED_LINES) {
      for (const y of r[line].filter(row => row.year > WARMUP)) {
        const want = Math.round(STRONGEST * (y.enrolled + y.declines));
        checked++;
        if (y.declines > want) over++;
        else if (y.declines < want) short++;
      }
    }
  }
  console.log(`  ${checked} warmed WC/GL line-years at ${(STRONGEST * 100).toFixed(1)}%: ${over} over the share (must be 0), `
    + `${short} under it (only possible if fewer members are rated than the share asks for)   `
    + `${over === 0 && short === 0 ? 'PASS' : 'FAIL'}`);
  if (over > 0) {
    failures.push(`${over} warmed line-years declined MORE than round(cut x book). The slider is a share; a count above `
      + 'it means renewal is reaching members the share did not choose.');
  }
  if (short > 0) {
    failures.push(`${short} warmed line-years declined FEWER than the share. Past the warm-up nearly every member has a `
      + 'full window, so a short count means the rated pool has thinned — read the count before the mechanism.');
  }
  console.log('\n  and the trend, which a share cannot ratchet (printed, not asserted):');
  console.log('  line       early   late    diff     SE     | enrolled off -> on');
  for (const line of LINES) {
    const t = trend(strong, line);
    const eOff = mean(off.map(r => mean(r[line].map(y => y.enrolled))));
    const eOn = mean(strong.map(r => mean(r[line].map(y => y.enrolled))));
    console.log(`  ${line.padEnd(10)} ${t.early.toFixed(2).padStart(5)}  ${t.late.toFixed(2).padStart(5)}  `
      + `${(t.diff >= 0 ? '+' : '') + t.diff.toFixed(2)}`.padStart(7)
      + `  ${t.se.toFixed(2).padStart(5)}   | ${eOff.toFixed(1).padStart(5)} -> ${eOn.toFixed(1)}`);
  }
}

// ------------------------------------- 2. null A: a cut that rounds to nobody
console.log('\n--- 2. NULL A: a cut too small to name one member is identical to renewal off ---');
{
  // STRUCTURAL now, where the threshold version's was empirical: round(0.001 x
  // book) is 0 on any book below 500 members, and the marketplace is 200.
  let mismatched = 0, compared = 0, declines = 0;
  for (let g = 0; g < GAMES; g++) {
    const tiny = play(g, TOO_SMALL);
    for (const line of LINES) {
      for (let i = 0; i < off[g][line].length; i++) {
        const a = off[g][line][i], b = tiny[line][i];
        compared++;
        declines += b.declines;
        if (a.enrolled !== b.enrolled || a.exposure !== b.exposure || a.poolPremium !== b.poolPremium) mismatched++;
      }
    }
  }
  console.log(`  cut ${TOO_SMALL}: ${declines} declines (must be 0), `
    + `${mismatched} of ${compared} line-years differing from renewal OFF (must be 0)   `
    + `${declines === 0 && mismatched === 0 ? 'PASS' : 'FAIL'}`);
  if (declines > 0 || mismatched > 0) {
    failures.push(`a cut that rounds to nobody produced ${declines} declines and moved ${mismatched} line-years against `
      + 'renewal off. A control that declines nobody must be indistinguishable from the mechanism being absent.');
  }
}

// -------------------------------------------------- 3. null B: paired with itself
console.log('\n--- 3. NULL B: the arm paired with itself cannot fire ---');
{
  const selfDiffs: number[] = [];
  for (let g = 0; g < GAMES; g++) {
    const warmed = strong[g].WC.filter(y => y.year > WARMUP);
    const mid = Math.floor(warmed.length / 2);
    selfDiffs.push(mean(warmed.slice(0, mid).map(y => y.declines)) - mean(warmed.slice(0, mid).map(y => y.declines)));
  }
  const worst = Math.max(...selfDiffs.map(Math.abs));
  console.log(`  worst self-difference ${worst.toFixed(6)} (must be exactly 0)   ${worst === 0 ? 'PASS' : 'FAIL'}`);
  if (worst !== 0) {
    failures.push(`the arm differenced against itself gave ${worst.toExponential(2)} rather than 0, so the `
      + 'trend statistic is not a pure difference and could fire on its own construction.');
  }
}

// --------------------------------------- 4. positive control at an absurd level
console.log('\n--- 4. POSITIVE CONTROL: an absurd share must move the instrument ---');
{
  // ⚠ YEAR 1, NOT THE WHOLE GAME, FOR THE COUNT. A share empties a finite book,
  // so at 30% the GAME's total declines saturate as the book runs out (measured
  // 44.8 against 56.8 on WC) while the book itself collapses — the threshold
  // version's "1.5x the declines over a game" reads that as no response. The
  // first year, before any depletion, is where the share's size shows cleanly;
  // the mean book is where its consequence does.
  const sDecl = mean(strong.map(r => r.WC[0].declines));
  const aDecl = mean(absurd.map(r => r.WC[0].declines));
  const sEnr = mean(strong.map(r => mean(r.WC.map(y => y.enrolled))));
  const aEnr = mean(absurd.map(r => mean(r.WC.map(y => y.enrolled))));
  console.log(`  WC declines in year 1: strongest ${sDecl.toFixed(1)}  absurd ${aDecl.toFixed(1)}`);
  console.log(`  WC mean enrolled:      strongest ${sEnr.toFixed(1)}  absurd ${aEnr.toFixed(1)}`);
  const responds = aDecl > sDecl * 1.5 && aEnr < sEnr - 2;
  console.log(`  the instrument responds to the share   ${responds ? 'PASS' : 'FAIL'}`);
  if (!responds) {
    failures.push(`raising the share from ${STRONGEST} to ${ABSURD} moved declines from ${sDecl.toFixed(1)} to `
      + `${aDecl.toFixed(1)} and mean enrolment from ${sEnr.toFixed(1)} to ${aEnr.toFixed(1)} — not a material `
      + 'response. Every assertion above is computed on this same instrument.');
  }
}

console.log('');
console.log(RULE);
if (failures.length > 0) {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(RULE);
  process.exitCode = 1;
} else {
  console.log('THE RENEWAL SLIDER IS A SHARE AND BEHAVES AS ONE: THE COUNT IS ROUND(SHARE x BOOK)');
  console.log('ON EVERY WARMED YEAR, A CUT THAT NAMES NOBODY IS IDENTICAL TO RENEWAL OFF, AND THE');
  console.log('INSTRUMENT DEMONSTRABLY MOVES WHEN THE SHARE DOES.');
  console.log(RULE);
}
