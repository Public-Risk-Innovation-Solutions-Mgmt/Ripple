// ============================================================================
// ACTUARIAL MEMORANDUM CHECK — the reserve development exhibit, guarded.
//
// Modelled directly on audit-formula-check, and for a stated reason: that page
// reached exit 0 by fixing two classes of defect this exhibit is equally
// exposed to, and both were invisible to the checks that existed at the time.
//
//   A ROW WHOSE NUMBER IS RIGHT AND WHOSE SENTENCE IS WRONG. Reinsurance
//   Recovery's layer count passed the formula check, the hand check and all
//   four arms, because the number was correct and only its prose was not. So
//   every derivable number this memo states in a sentence is registered below
//   as a PROSE CLAIM and evaluated against the data the memo had.
//
//   A ROW CORRECT ONLY BECAUSE THE DEFAULT ZEROED THE TERM IT OMITTED. Six of
//   seven formula defects on that page were invisible at default decisions,
//   because the default pins every CLF to 1.000 and switches the booking bias
//   off. THIS EXHIBIT'S ENTIRE SUBJECT IS WHAT THE BIAS DOES, so a memo built
//   and eyeballed at defaults is a memo tested in the one configuration where
//   the interesting quantity does not exist. Hence the squeezed arm, and hence
//   the coverage assertions at the bottom that FAIL if an arm never produced a
//   matured row, a Prior row, adverse development or a non-zero deficiency.
//
// THREE KINDS OF CHECK, mirroring that page:
//   ARITHMETIC   the paid ratio and the Prior and pool ties, on the RENDERED strings
//   PRINTING     empty-vs-zero discipline
//   PROSE        removed passages must not render again (the memo states no
//                figure in prose while development is zero)
// ============================================================================

import { generateGameInstance } from '../../src/utils/instanceGenerator';
import { processYear } from '../../src/utils/simulationEngine';
import { runPriorHistory } from '../../src/utils/priorHistoryEngine';
import { defaultDecisionSet } from '../../src/utils/decisionDefaults';
import { SLIDER_RANGES, WC_FUNDING_CONFIDENCE_RANGE, FULL_COST_BOOKING } from '../../src/data/defaultAssumptions';
import {
  PRIOR_BOUNDARY, buildActuarialMemo, collapsePrior, exhibitRows, poolExhibitRows,
  unEmergedDeficiency, type ExhibitRow,
} from '../../src/utils/actuarialMemo';
import type { CoverageLine, DecisionSet, GameState } from '../../src/types/simulation';

const GAMES = Number(process.env.GAMES ?? 3);
const YEARS = Number(process.env.YEARS ?? 10);

// Each line's OWN minimum stop. Driving all three to 0.10 would squeeze
// Property to a booking bias the UI cannot produce, which overstates the
// exercise and tests nothing a player can reach — the same reasoning as
// audit-formula-check's MIN_STOP.
const MIN_STOP: Record<string, number> = {
  WC: WC_FUNDING_CONFIDENCE_RANGE.min,
  GL: SLIDER_RANGES.fundingConfidenceLevel.min,
  Property: SLIDER_RANGES.fundingConfidenceLevel.min,
};

interface Arm { name: string; why: string; decisions: (d: DecisionSet, lines: CoverageLine[]) => DecisionSet }
const ARMS: Arm[] = [
  {
    name: 'defaults',
    why: 'fundingAtExpected everywhere: bookingBias 0, so development is pure noise and the deficiency is nil',
    decisions: d => d,
  },
  {
    name: 'squeezed',
    why: 'every line at its own minimum stop: bookingBias live, so the unwind is what the exhibit shows',
    decisions: (d, lines) => ({
      ...d,
      byLine: Object.fromEntries(lines.map(l =>
        [l, { ...d.byLine[l], fundingConfidenceLevel: MIN_STOP[l], fundingAtExpected: false }],
      )) as never,
    }),
  },
];

const CONFIGS: { lines: CoverageLine[]; name: string }[] = [
  { lines: ['WC'], name: 'WC-solo' },
  { lines: ['GL'], name: 'GL-solo' },
  { lines: ['Property'], name: 'PR-solo' },
  { lines: ['WC', 'GL', 'Property'], name: 'tri' },
];

interface Finding { arm: string; config: string; scope: string; year: number; what: string; detail: string }
const findings: Finding[] = [];
function fail(ctx: { arm: string; config: string; scope: string; year: number }, what: string, detail: string) {
  findings.push({ ...ctx, what, detail });
}

// ============================================================================
// THE RENDERED TABLE, PARSED BACK AS A READER SEES IT.
//
// ⚠ CHECKS RUN ON THE PRINTED STRINGS, NOT ON THE STRUCTS THAT PRODUCED THEM.
// Re-deriving a cell from the same object the renderer used would be a value
// minus itself — the Expense Ratio Check tautology, which read exactly 0.0 on
// 480 of 480 scope-years while looking like a passing identity. Parsing the
// markdown back means the formatter, the empty-cell rule and the rounding are
// all inside the check rather than assumed by it.
// ============================================================================
interface ParsedRow { label: string; cells: string[] }

function parseTables(md: string): { heading: string; rows: ParsedRow[] }[] {
  const out: { heading: string; rows: ParsedRow[] }[] = [];
  let heading = '';
  let current: { heading: string; rows: ParsedRow[] } | null = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) { heading = h[1].trim(); current = null; continue; }
    // ⚠ NOT startsWith('| ') — the GFM alignment row is `|---|---:|...` with no
    // space, and testing for one silently ended every table at its second line.
    // The check then compared 0 parsed rows against a populated exhibit and
    // reported 224 findings that were all this bug.
    if (!line.startsWith('|')) { current = null; continue; }
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells[0] === 'Accident year' || /^:?-{3,}:?$/.test(cells[0])) {
      if (cells[0] === 'Accident year') { current = { heading, rows: [] }; out.push(current); }
      continue;
    }
    if (current) current.rows.push({ label: cells[0], cells: cells.slice(1) });
  }
  return out;
}

const EMPTY = '—';
const num = (s: string) => Number(s);

// A printed sum, to the precision the cells are printed at. Both operands carry
// up to half a cent of rounding in $M terms, so the bound is one printing
// quantum and nothing looser.
const PRINT_QUANTUM = 0.01;

function checkTable(
  ctx: { arm: string; config: string; scope: string; year: number },
  rows: ParsedRow[],
) {
  let sawEmptyPrior = 0, sawPrior = 0;

  for (const r of rows) {
    // ⚠ NO DEVELOPMENT COLUMNS. The exhibit dropped 1-yr and total development
    // while development is zero (see actuarialMemo's header), and the two row
    // identities that read them — initial + total === current, prior + 1yr ===
    // current — went with them. The paid ratio replaces them as the arithmetic
    // asserted on the printed cells, so this table is still checked by a sum a
    // reader could do.
    const [initial, prior, current, paid, ratio] = r.cells;
    const where = `accident year ${r.label}`;

    if (r.cells.length !== 5) {
      fail(ctx, 'column count', `${where}: ${r.cells.length} cells, the exhibit has five after the label`);
    }

    // --- ARITHMETIC: paid / current === the printed ratio ------------------
    // Both inputs are printed to $0.01M, so the bound is what that rounding can
    // move a one-decimal percentage, plus the percentage's own rounding.
    if (paid !== EMPTY && ratio !== EMPTY && num(current) > 0) {
      const want = 100 * num(paid) / num(current);
      const got = Number(ratio.replace('%', ''));
      const slack = 0.05 + 100 * PRINT_QUANTUM * (1 / num(current) + num(paid) / (num(current) ** 2));
      if (Math.abs(want - got) > slack) {
        fail(ctx, 'paid / ultimate !== paid / current', `${where}: ${paid} / ${current} = ${want.toFixed(2)}%, printed ${ratio}`);
      }
    }

    // --- PRINTING: one blank pattern is legal ------------------------------
    // The prior column is empty on the newest accident year only: there is no
    // earlier valuation to print. initial and current are never empty.
    if (initial === EMPTY || current === EMPTY) {
      fail(ctx, 'illegal blank', `${where}: initial/current = ${initial}/${current}`);
    }
    if (prior === EMPTY) sawEmptyPrior++;

    // --- PRINTING: the word "settled" must never reappear -------------------
    // It collapsed MATURITY into CLOSURE. Guarded by name so a future edit
    // cannot quietly reintroduce it.
    if (r.cells.some(c => /settled/i.test(c)) || /settled/i.test(r.label)) {
      fail(ctx, 'the word "settled" is back', `${where}: reaching the horizon stops DEVELOPMENT; the year is still open and still paying`);
    }

    // --- PRINTING: negative zero is never emitted -------------------------
    for (const [name, c] of [['initial', initial], ['prior', prior], ['current', current], ['paid', paid]] as const) {
      if (c === '-0.00') fail(ctx, 'negative zero printed', `${where}: ${name} printed -0.00, which implies a direction the precision cannot support`);
    }

    if (r.label.includes('Prior')) sawPrior++;
    // ⚠ THE DAGGER IS GONE WITH THE PARAGRAPH IT POINTED TO, so it must not
    // render anywhere. Was: "the dagger belongs to Prior alone".
    if (r.label.includes('†')) {
      fail(ctx, 'dagger rendered', `${where}: the dagger's explanation was removed with the development columns`);
    }
  }

  // Exactly one year — the newest — may carry an empty prior.
  if (sawEmptyPrior > 1) {
    fail(ctx, 'more than one year without a prior', `${sawEmptyPrior} rows carry an empty prior; only the newest accident year can`);
  }
  return { sawPrior };
}

// ============================================================================
// REMOVED TEXT MUST STAY REMOVED.
//
// ⚠ THE PROSE CLAIMS THIS FILE REGISTERED HAD NO SENTENCE LEFT TO GUARD. The
// memo used to state counts in prose (rows on the exhibit, rows past and within
// the IBNER horizon, years collapsed into Prior, occurrences that developed),
// and each was checked against the data. Those sentences were removed with the
// development columns, along with the sign paragraph, the horizon and empty-cell
// paragraphs, the dagger and the pointer to the hidden Claims Department. A
// claim with nothing to match would only ever report "did not render".
//
// So the guard is inverted: each removed passage is named, and the gate FAILS if
// any of them renders again. That keeps the exhibit honest the same way: a
// figure stated in prose beside the table is the defect the old claims caught.
// ============================================================================
const REMOVED_TEXT: { what: string; pattern: RegExp }[] = [
  { what: 'the 1-yr development column', pattern: /1-yr development/ },
  { what: 'the total development column', pattern: /Total development/ },
  { what: 'a rows-on-the-exhibit count', pattern: /row\(s\) on this exhibit/ },
  { what: 'the IBNER horizon', pattern: /IBNER horizon/ },
  { what: 'a collapsed-into-Prior count', pattern: /collapsed into Prior/ },
  { what: 'the developed-occurrence count', pattern: /occurrences across these lines/ },
  { what: 'the pointer to the hidden Claims Department', pattern: /Claims Department/ },
  { what: 'the sign-of-development paragraph', pattern: /positive development|estimate ROSE/i },
  { what: 'the empty-development-cell paragraph', pattern: /empty development cell/i },
  { what: 'the dagger', pattern: /†/ },
];
let removedTextChecked = 0;

function removedTextAudit(ctx: { arm: string; config: string; scope: string; year: number }, md: string) {
  removedTextChecked++;
  for (const { what, pattern } of REMOVED_TEXT) {
    if (pattern.test(md)) fail(ctx, 'removed text is back', `${what} renders again`);
  }
}

// ⚠ COUNTED FROM ExhibitRow, NOT FROM THE PRINTED TEXT, because the printed row
// no longer carries a development figure at all. Under full-cost booking no
// accident year may move at any age, and that is still asserted below.
let postHorizonShown = 0, postHorizonMoved = 0;
let movedRows = 0;

// ⚠ THE ACCIDENT-YEAR -3 CLAIM IS RETIRED, NOT SILENTLY DROPPED. The memo used to
// state that -3 exists on no line ever, and this checked it. Collapsing everything
// older than PRIOR_BOUNDARY put -3 inside Prior, so the absence became invisible —
// an assertion about something a reader can no longer see is not a claim worth
// guarding, it is a claim that can never fail informatively.
//
// ⚠ ITS REPLACEMENT WAS TRUE WHEN WRITTEN AND IS NOT TRUE NOW, AND THE REASON IS
// WORTH THE PARAGRAPH BECAUSE NOTHING HERE WAS CARELESS.
//
// c282a64 replaced it with "every row shown individually has a claim register
// behind it, and every cohort folded into Prior does not", and said why the
// boundary could carry that weight: "It traces exactly the line between cohorts
// that HAVE a claim register and cohorts that do not. Accident years -2, -1 and 0
// went through processLineYear and have real registers... Everything older is a
// seed cohort." With PRE_GAME_YEARS = 3 that was EXACT.
//
// 556cef5 then added MATURATION_YEARS = 7 — seven further simulated years before
// the declared pre-game — so the register line moved from -2 to -9 while
// PRIOR_BOUNDARY stayed at -2. Prior has contained played accident years with
// real registers ever since, and this assertion has failed on every evaluation of
// it: 420 of 420, in both arms, with PER_CLAIM_REVISION on and off alike.
//
// ⚠ IT WAS INVISIBLE BECAUSE THE GATE WAS ALREADY EXCUSED. actuarial-memo-check
// was entered in EXPECTED_RED five days BEFORE 556cef5, for an unrelated reason
// (the matured blank), and an excused gate is one nobody reads the output of. The
// entry recorded 48 findings; by the time it was retired the gate reported 1,179.
// That is the exact hazard EXPECTED_RED's own header warns about — a red nobody
// is looking at — occurring inside the mechanism built to prevent it.
//
// WHAT IT ASSERTS NOW is the age model the memo actually implements and has always
// documented: "Prior collects every accident year older than PRIOR_BOUNDARY". The
// register line is no longer where the cut is, so the cut is not held to it.
function checkPriorBoundary(
  ctx: { arm: string; config: string; scope: string; year: number },
  raw: ExhibitRow[],
  shown: ExhibitRow[],
) {
  for (const r of shown) {
    // COVERAGE, counted on every shown row including Prior: a row that is past
    // its IBNER horizon and still shows a 1-year figure is the thing the old
    // assertion forbade and the exhibit now displays. Required non-zero below.
    if (r.pastHorizon && r.oneYear !== null) {
      postHorizonShown++;
      if (Math.abs(r.oneYear) > 0.005) postHorizonMoved++;
    }
    if (r.oneYear !== null && Math.abs(r.oneYear) > 0.005) movedRows++;
    if (r.isPrior) continue;
    // The only boundary claim left about an individually-listed row, and it is
    // the one the memo makes: it is not older than the cut.
    if (r.yearNumber < PRIOR_BOUNDARY) fail(ctx, 'prior boundary', `accident year ${r.yearNumber} is older than ${PRIOR_BOUNDARY} and was not collapsed`);
  }

  // ⚠ PRIOR'S COLUMNS MUST TIE TO THE COHORTS IT REPLACES, EXACTLY. This is the
  // arithmetic claim the collapse introduces: a summary row that does not sum is
  // the register-disagrees-with-the-exhibit defect in a new place.
  const old = raw.filter(r => r.yearNumber < PRIOR_BOUNDARY);
  const priorRow = shown.find(r => r.isPrior);
  if (old.length === 0) {
    if (priorRow) fail(ctx, 'prior boundary', 'a Prior row was rendered with nothing to collapse');
    return;
  }
  if (!priorRow) { fail(ctx, 'prior boundary', `${old.length} year(s) older than ${PRIOR_BOUNDARY} but no Prior row`); return; }
  const tie = (name: string, got: number | null, want: number | null) => {
    if (got === null && want === null) return;
    if (got === null || want === null) { fail(ctx, 'prior tie', `${name}: one side is empty and the other is not`); return; }
    if (Math.abs(got - want) > 1) fail(ctx, 'prior tie', `${name}: Prior states ${got.toFixed(2)}, constituents sum to ${want.toFixed(2)}`);
  };
  const sum = (pick: (r: ExhibitRow) => number) => old.reduce((s, r) => s + pick(r), 0);
  const anyNull = (pick: (r: ExhibitRow) => number | null) => old.some(r => pick(r) === null);
  tie('initial', priorRow.initial, sum(r => r.initial));
  tie('current', priorRow.current, sum(r => r.current));
  tie('prior', priorRow.prior, anyNull(r => r.prior) ? null : sum(r => r.prior ?? 0));
  tie('1yr', priorRow.oneYear, anyNull(r => r.oneYear) ? null : sum(r => r.oneYear ?? 0));
  tie('total', priorRow.total, anyNull(r => r.total) ? null : sum(r => r.total ?? 0));
  return old.length;
}

// ============================================================================

console.log('=== ACTUARIAL MEMORANDUM CHECK ===');

let memosBuilt = 0;
const coverage = { deficiencyNonZero: 0, finalSections: 0, prior: 0 };
const perArmCoverage: Record<string, { moved: number; deficiency: number }> = {};
let boundaryChecked = 0;

for (const arm of ARMS) {
  perArmCoverage[arm.name] = { moved: 0, deficiency: 0 };
  for (const { lines, name } of CONFIGS) {
    for (let g = 0; g < GAMES; g++) {
      const id = `AMC${name}${g}`;
      const inst = generateGameInstance(id, 1_700_000 + g * 9173);
      const setup = { poolName: 'A', gameLength: YEARS, startingYear: 2026, instanceId: id, activeLines: lines };
      const { poolState, priorHistory } = runPriorHistory(inst, setup as never);
      let gs: GameState = {
        setup: setup as never, instance: inst, currentYearNumber: 1, isStarted: true, isComplete: false,
        poolState, lockedResults: [], currentDecisions: defaultDecisionSet(1), priorHistory,
      };
      for (let y = 1; y <= YEARS; y++) {
        const processed = processYear(gs, arm.decisions(defaultDecisionSet(y), lines));
        gs = {
          ...gs, currentYearNumber: y + 1, poolState: processed.updatedPoolState,
          lockedResults: [...gs.lockedResults, processed.result], isComplete: y === YEARS,
        };
      }

      // EVERY valuation year, not only the last. The year selector reaches all
      // of them, and a cohort that is settled in year 10 was developing in
      // year 4 — checking only the endpoint would never see a live row on a
      // short-tail line.
      for (let asAt = 1; asAt <= YEARS; asAt++) {
        const md = buildActuarialMemo({ gameState: gs, asAtYear: asAt });
        memosBuilt++;
        removedTextAudit({ arm: arm.name, config: name, scope: 'memo', year: asAt }, md);
        const movedBefore = movedRows;
        const tables = parseTables(md);
        const perLineRows = lines.map(l => exhibitRows(gs.poolState.lines[l]?.reserveDevelopment ?? [], asAt));

        for (let i = 0; i < lines.length; i++) {
          const ctx = { arm: arm.name, config: name, scope: lines[i], year: asAt };
          const table = tables.find(t => t.heading === lines[i]);
          if (!table) { fail(ctx, 'missing section', `no table under heading "${lines[i]}"`); continue; }
          const seen = checkTable(ctx, table.rows);
          coverage.prior += seen.sawPrior;

          const shown = collapsePrior(perLineRows[i]);
          if (table.rows.length !== shown.length) {
            fail(ctx, 'row count', `table has ${table.rows.length} rows, collapsePrior says ${shown.length}`);
          }
          if (checkPriorBoundary(ctx, perLineRows[i], shown)) boundaryChecked++;
        }

        if (lines.length > 1) {
          const ctx = { arm: arm.name, config: name, scope: 'pool', year: asAt };
          const table = tables.find(t => t.heading === 'Pool total');
          const poolRows = poolExhibitRows(perLineRows);
          if (!table) { fail(ctx, 'missing section', 'no Pool total table'); }
          else {
            checkTable(ctx, table.rows);
            const shownPool = collapsePrior(poolRows);
            if (table.rows.length !== shownPool.length) {
              fail(ctx, 'pool row count', `table has ${table.rows.length} rows, collapsePrior says ${shownPool.length}`);
            }
            // THE POOL IS THE SUM OF THE LINES, asserted on the PRINTED cells.
            // Summing is legitimate here and the check says so out loud: the
            // pool-scope aggregation defects this project fixed at 9ace082 were
            // all a scope reading one line's placeholder as a pool figure.
            for (const pr of table.rows) {
              // ⚠ THE PRIOR ROW IS MATCHED BY ITS RANGE, NOT BY A YEAR NUMBER,
              // because it no longer has one. Parsing '**Prior**' as a year gave
              // NaN, which matched nothing and silently skipped the one row the
              // collapse introduced — the row most in need of the check.
              const isPriorRow = pr.label.includes('Prior');
              const contributing = isPriorRow
                ? perLineRows.flat().filter(r => r.yearNumber < PRIOR_BOUNDARY)
                : perLineRows.flat().filter(r => r.yearNumber === Number(pr.label.split(' ')[0]));
              const expect = contributing.reduce((s, r) => s + r.current, 0) / 1e6;
              if (Math.abs(num(pr.cells[2]) - expect) > lines.length * PRINT_QUANTUM) {
                fail(ctx, 'pool current !== sum of lines', `${pr.label}: pool prints ${pr.cells[2]}, lines sum to ${expect.toFixed(2)}`);
              }
            }
            if (checkPriorBoundary(ctx, poolRows, shownPool)) boundaryChecked++;
          }
        }

        // ⚠ THE DEVELOPED-CLAIMS SCHEDULE MUST NOT NAME A YEAR THE EXHIBIT HAS
        // COLLAPSED, or the two disagree about what a row is. It cannot today —
        // seed cohorts carry no developingClaims, so only years -2 and later can
        // ever contribute — but that is a property of two separate files and the
        // memo now states it in prose, so it is guarded rather than trusted.
        const schedule = md.split('### Which claims developed')[1]?.split('###')[0] ?? '';
        for (const row of schedule.split('\n')) {
          if (!row.startsWith('| ') || row.includes('Accident year')) continue;
          const ay = Number(row.split('|')[2]?.trim());
          if (Number.isFinite(ay) && ay < PRIOR_BOUNDARY) {
            fail({ arm: arm.name, config: name, scope: 'schedule', year: asAt },
              'schedule names a collapsed year',
              `accident year ${ay} is inside Prior in the exhibit but listed individually in the claims schedule`);
          }
        }

        // ⚠ THE DEVELOPED-OCCURRENCE COUNT IS NO LONGER PRINTED — its sentence and
        // the pointer to the Claims Department went with the development columns,
        // and removedTextAudit fails if either comes back. The as-at-the-selected-
        // year defect it guarded can only recur by the sentence returning.
        perArmCoverage[arm.name].moved += movedRows - movedBefore;

        // The final-position block, at game end only.
        const ctxF = { arm: arm.name, config: name, scope: 'final', year: asAt };
        const hasFinal = md.includes('### Final position');
        const shouldHaveFinal = gs.isComplete && asAt === YEARS;
        if (hasFinal !== shouldHaveFinal) {
          fail(ctxF, 'final position gating', `section ${hasFinal ? 'present' : 'absent'} but game-end is ${shouldHaveFinal}`);
        }
        if (hasFinal) {
          coverage.finalSections++;
          const deficiency = lines.reduce((s, l) => s + unEmergedDeficiency(gs.poolState.lines[l]), 0);
          if (deficiency > 0) { coverage.deficiencyNonZero++; perArmCoverage[arm.name].deficiency++; }
          if (deficiency < 0) fail(ctxF, 'negative deficiency', `un-emerged deficiency is ${deficiency}`);
          // The three-line block must reconcile as printed.
          const surplus = Number(md.match(/\| Ending surplus \| (-?[\d.]+) \|/)?.[1]);
          const def = Number(md.match(/\| Reserve deficiency not yet emerged \| (-?[\d.]+) \|/)?.[1]);
          const net = Number(md.match(/\| Ending surplus, net of it \| (-?[\d.]+) \|/)?.[1]);
          if ([surplus, def, net].some(Number.isNaN)) {
            fail(ctxF, 'final position unparseable', 'one of the three lines did not render a number');
          } else if (Math.abs((surplus - def) - net) > 2 * PRINT_QUANTUM) {
            fail(ctxF, 'final position does not reconcile', `${surplus} - ${def} = ${(surplus - def).toFixed(2)}, printed ${net}`);
          }
          // The bias itself is never disclosed before this point, and the true
          // ultimate never at all.
          if (md.includes('registerSum') || /booking bias/i.test(md)) {
            fail(ctxF, 'disclosure', 'the memo names the booking bias or the register sum, which it must not');
          }
        }
      }
    }
  }
}

// ============================================================================
// REPORT
// ============================================================================
console.log(`${memosBuilt.toLocaleString()} memoranda built across ${ARMS.length} arms x ${CONFIGS.length} configs x ${GAMES} games x ${YEARS} valuation years.\n`);
for (const arm of ARMS) console.log(`  ${arm.name.padEnd(9)} ${arm.why}`);

console.log('\n--- COVERAGE: DID THE CHECK REACH THE INTERESTING STATES? ---');
console.log('  A green run over rows that never passed their horizon, never developed adversely');
console.log('  and never carried a deficiency would be a check passing while unable to fail.\n');
console.log(`  post-horizon rows         ${postHorizonShown.toLocaleString()}  (counted on ExhibitRow; the exhibit no longer prints development)`);
console.log(`  of those, moved          ${postHorizonMoved.toLocaleString()}`);
console.log(`  rows that moved at all   ${movedRows.toLocaleString()}`);
console.log(`  Prior rows seen          ${coverage.prior.toLocaleString()}`);
console.log(`  final-position sections  ${coverage.finalSections.toLocaleString()}`);
console.log(`  of those, deficiency > 0 ${coverage.deficiencyNonZero.toLocaleString()}`);
console.log(`  Prior boundary claim     ${boundaryChecked.toLocaleString()} evaluations`);
console.log(`  removed-text audits      ${removedTextChecked.toLocaleString()} memoranda, ${REMOVED_TEXT.length} passages each`);

console.log('\n  per arm:');
for (const arm of ARMS) {
  const c = perArmCoverage[arm.name];
  console.log(`    ${arm.name.padEnd(9)} rows moved ${String(c.moved).padStart(5)}   deficiency>0 ${c.deficiency}`);
}

// ⚠ THE ARMS MUST DIFFER, AND THIS IS ASSERTED RATHER THAN EYEBALLED. The whole
// argument for a squeezed arm is that the default switches the booking bias off.
// If the defaults arm ever produced a deficiency, or the squeezed arm produced
// none, the arms are not doing what their names say and every conclusion drawn
// from the split is void.
// ⚠ UNDER FULL-COST BOOKING THE TWO ARMS CANNOT DIFFER, AND THE COVERAGE THIS
// LOSES IS STATED RATHER THAN QUIETLY DROPPED.
//
// The squeezed arm exists because a funding level below break-even switches the
// booking bias on, which produces a deficiency and adverse development for the
// exhibit to render. Full-cost booking removes the bias AND the development, so
// BOTH arms now produce zero of each — not because the arms stopped working but
// because the quantity they were built to exercise no longer exists.
//
// ⚠ WHAT IS GENUINELY UNTESTED NOW: the exhibit's deficiency row, its adverse
// development rendering, and the post-horizon movement column. Those paths are
// live code with no input that reaches them, which is exactly the state the
// coverage block was written to refuse — so it is recorded here as a NAMED GAP
// rather than deleted. It closes when the host's prior development factors are
// wired and development has a source again. The flag-off arm still asserts the
// original contract in full.
const armErrors: string[] = [];
if (FULL_COST_BOOKING.enabled) {
  for (const arm of ARMS) {
    const c = perArmCoverage[arm.name];
    if (c.deficiency !== 0) armErrors.push(`${arm.name} arm produced a deficiency in ${c.deficiency} game(s) — under full-cost booking there is no booking bias on either arm`);
    if (c.moved !== 0) armErrors.push(`${arm.name} arm saw ${c.moved} accident year(s) move — prior years must not move at all until the prior development factors are wired`);
  }
  console.log('\n  ⚠ NAMED COVERAGE GAP: the deficiency row, the adverse-development rendering and');
  console.log('    the post-horizon movement column have no input that reaches them while');
  console.log('    FULL_COST_BOOKING is on. They are live and untested; the gap closes when the');
  console.log('    host\'s prior development factors become the source of development.');
} else {
  if (perArmCoverage['defaults'].deficiency !== 0) {
    armErrors.push(`defaults arm produced a non-zero deficiency in ${perArmCoverage['defaults'].deficiency} game(s) — bookingBias should be identically 0 there`);
  }
  if (perArmCoverage['squeezed'].deficiency === 0) {
    armErrors.push('squeezed arm produced NO deficiency anywhere — the arm is not squeezing, and the exhibit is untested where its subject exists');
  }
  for (const arm of ARMS) {
    const c = perArmCoverage[arm.name];
    if (c.moved === 0) armErrors.push(`${arm.name} arm saw no accident year move at all`);
  }
}
if (coverage.finalSections === 0) armErrors.push('the final-position section never rendered');
if (coverage.prior === 0) armErrors.push('no Prior row was ever rendered — the collapse is untested');
// The replacement for the retired "matured year moved" assertion. If this ever
// reads zero the exhibit has stopped showing post-horizon development, which is
// what this commit corrected it to show.
if (postHorizonMoved === 0 && !FULL_COST_BOOKING.enabled) {
  armErrors.push(`no row past its IBNER horizon was seen to move (${postHorizonShown} post-horizon rows rendered a 1-year figure) — either the blanking is back or the sample no longer reaches one`);
} else if (postHorizonMoved !== 0 && FULL_COST_BOOKING.enabled) {
  armErrors.push(`${postHorizonMoved} row(s) past their IBNER horizon MOVED — under full-cost booking no row moves at any age, in or out of the horizon`);
}
if (boundaryChecked === 0) armErrors.push('the Prior boundary claim was never evaluated');
if (removedTextChecked === 0) armErrors.push('the removed-text audit never ran');

console.log('\n--- FINDINGS ---');
if (findings.length === 0 && armErrors.length === 0) {
  console.log('\nEVERY PAID RATIO RECONCILES from its printed cells, in both arms; a blank prior appears');
  console.log('only on the newest year; the Prior row ties to the years it collapses; the pool total');
  console.log('is the sum of its lines; no removed passage renders; and no accident year moved.');
  process.exit(0);
}
for (const f of findings.slice(0, 40)) {
  console.log(`  [${f.arm}/${f.config}/${f.scope} y${f.year}] ${f.what}: ${f.detail}`);
}
if (findings.length > 40) console.log(`  ... and ${findings.length - 40} more`);
for (const e of armErrors) console.log(`  COVERAGE: ${e}`);
console.log(`\n${findings.length} finding(s), ${armErrors.length} coverage failure(s).`);
process.exit(1);
