import { useMemo, useState } from 'react';
import type { DecisionSet, GameState } from '../types/simulation';
import DocumentReader, { type DocumentEntry } from '../components/DocumentReader';
import investmentMemoRaw from '../data/documents/investmentMemo.md?raw';
import { buildActuarialMemo } from '../utils/actuarialMemo';
// ⚠ buildClaimsMemo IS NOT IMPORTED WHILE THE CLAIMS PANE IS HIDDEN — see the
// commented entry in `documents` below. src/utils/claimsMemo.ts, its template
// and claims-memo-check are all untouched; the import comes back with the pane.
//   import { buildClaimsMemo } from '../utils/claimsMemo';
import { buildInvestmentMemo } from '../utils/investmentMemo';
import { buildRiskControlMemo } from '../utils/riskControlMemo';
// ⚠ buildUnderwritingMemo IS NOT IMPORTED WHILE THE UNDERWRITING PANE IS HIDDEN —
// see the commented entry in `documents` below. src/utils/underwritingMemo.ts and
// its checks are untouched; the import comes back with the pane.
//   import { buildUnderwritingMemo } from '../utils/underwritingMemo';

interface DepartmentsPageProps {
  gameState: GameState;
  /** The decisions the player is editing NOW — not gameState.currentDecisions,
   *  which resets to defaults the moment a year locks. See buildUnderwritingMemo.
   *  Read only by the Underwriting memo, which is hidden; kept on the props so
   *  restoring the pane does not touch the call site. */
  currentDecisions: DecisionSet;
}

// Actuarial and Claims memos will be regenerated every year, so the year
// selector is built now even though Investment (this pass's only occupant) is
// static and does not yet vary by year — retrofitting a selector once those
// two exist would mean reworking this tab's shape, not just adding rows.
// ⚠ currentDecisions IS NOT DESTRUCTURED WHILE THE UNDERWRITING PANE IS HIDDEN —
// it is that memo's only reader. Restoring the pane puts it back here.
export default function DepartmentsPage({ gameState }: DepartmentsPageProps) {
  const [selectedYear, setSelectedYear] = useState(gameState.currentYearNumber);
  const [selectedId, setSelectedId] = useState('investment');

  const years = Array.from({ length: gameState.currentYearNumber }, (_, i) => i + 1);

  // Rebuilt only when the year or the underlying state moves. The exhibit walks
  // every accident year's whole valuation history for every line, so it is not
  // work to redo on an unrelated re-render.
  const actuarialMemo = useMemo(
    () => buildActuarialMemo({ gameState, asAtYear: selectedYear }),
    [gameState, selectedYear],
  );

  // ⚠ THE UNDERWRITING MEMO IS NOT BUILT WHILE ITS PANE IS HIDDEN — commented
  // rather than deleted, the same treatment the Claims memo has below, so
  // restoring the department is uncommenting this block, the entry in
  // `documents`, the import at the top and `currentDecisions` in the signature.
  // Its own note, kept verbatim:
  //
  //   Memoised on the same rule as the other two: it walks the whole marketplace
  //   and every member's stored history for each active line.
  //
  //   const underwritingMemo = useMemo(
  //     () => buildUnderwritingMemo(gameState, currentDecisions),
  //     [gameState, currentDecisions],
  //   );

  // ⚠ THE CLAIMS MEMO IS NOT BUILT WHILE ITS PANE IS HIDDEN. Commented rather
  // than deleted, with the entry below, so restoring the department is
  // uncommenting three blocks and nothing else. Its own note is kept verbatim
  // because it records a ruling, not an implementation detail:
  //
  //   ⚠ NOT KEYED TO selectedYear, AND IT USED TO BE. The listing is struck at
  //   a valuation and it resolves that valuation itself — see ClaimsMemoInput
  //   for why the selected year could not be honoured: claim status would move
  //   with the selection while Paid and Incurred, which come from live cohort
  //   state, would not. Passing the year in was what made the two disagree, so
  //   the year is no longer passed in. The selector still drives the actuarial
  //   memorandum, which keeps a real valuation history, and that document says
  //   so.
  //
  //   It rebuilds the whole book to split paid per accident year, which is
  //   41 ms on a reloaded game, so it is still memoised.
  //
  //   const claimsMemo = useMemo(
  //     () => buildClaimsMemo({ gameState }),
  //     [gameState],
  //   );

  const documents: DocumentEntry[] = [
    {
      id: 'actuarial',
      title: 'Actuarial',
      summary: 'Reserve development by accident year',
      content: actuarialMemo,
    },
    // ⚠ THE CLAIMS DEPARTMENT IS HIDDEN, NOT REMOVED — the same treatment the
    // Membership tab has in GameShell. The listing is per MEMBER and per claim,
    // which is the view the multiplayer game drops; the ENGINE keeps every
    // claim, so this hides the pane and leaves claimsMemo.ts, its template, the
    // claims workbook download and claims-memo-check untouched. Restoring it is
    // uncommenting this entry, the useMemo above and the import at the top.
    //   {
    //     id: 'claims',
    //     title: 'Claims',
    //     summary: 'Large loss listing by member and status',
    //     content: claimsMemo,
    //   },
    {
      // ⚠ GATED BY activeLines, WHICH IS WHY IT IS BUILT AND NOT A STATIC .md.
      // Its own second paragraph promises that line-specific programs appear
      // only if the pool writes that coverage, so the list has to honour it.
      id: 'riskControl',
      title: 'Risk Control',
      summary: 'Programs available for management consideration',
      content: buildRiskControlMemo(gameState.setup.activeLines),
    },
    // ⚠ THE UNDERWRITING DEPARTMENT IS HIDDEN, NOT REMOVED — the same treatment
    // as Claims above. Its memo lists applicants and members by name, which is
    // the per-member view the multiplayer game drops; the pool-level memo that
    // replaces it ships with pool-level underwriting and is recorded in
    // docs/PENDING_MULTIPLAYER.md. underwritingMemo.ts and its checks are
    // untouched. Restoring it is uncommenting this entry, the useMemo above,
    // the import at the top and `currentDecisions` in the signature.
    //   {
    //     // ⚠ THE ONLY DOCUMENT WHOSE CONTENT IS A FUNCTION OF THE YEAR. Risk
    //     // Control is prose; Actuarial and Claims are generated but describe the
    //     // pool. This lists a SET that turns over every year — different
    //     // candidates, different members over the bar — so its fingerprint differs
    //     // between year points by design, where the others mostly do not.
    //     id: 'underwriting',
    //     title: 'Underwriting',
    //     summary: 'Membership, applicants, and risk profile',
    //     content: underwritingMemo,
    //   },
    {
      id: 'investment',
      title: 'Investment',
      summary: 'Strategy, asset allocation, and liquidity',
      // ⚠ BUILT, NOT RAW. The asset table and the default allocation are filled
      // from the engine's constants — see buildInvestmentMemo. The raw file
      // carries tokens, so rendering it unfilled would show them to a player.
      content: buildInvestmentMemo(investmentMemoRaw),
    },
  ];

  const listHeader = (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Year</label>
      <select
        value={selectedYear}
        onChange={e => setSelectedYear(parseInt(e.target.value))}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
      >
        {years.map(y => (
          <option key={y} value={y}>Year {y}</option>
        ))}
      </select>
    </div>
  );

  return (
    <DocumentReader
      documents={documents}
      selectedId={selectedId}
      onSelect={setSelectedId}
      listHeader={listHeader}
    />
  );
}
