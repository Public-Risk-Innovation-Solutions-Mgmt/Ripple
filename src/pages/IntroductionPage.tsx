import { useState } from 'react';
import type { CoverageLine, GameState, ResultSet } from '../types/simulation';
import { formatMillions, formatCurrency } from '../utils/formatters';
import { LINE_FULL_NAME } from '../utils/lineDisplay';
import { applyTemplate } from '../utils/renderMarkdown';
import DocumentReader, { type DocumentEntry } from '../components/DocumentReader';
import welcomeMemoRaw from '../data/documents/welcomeMemo.md?raw';
import howToPlayRaw from '../data/documents/howToPlay.md?raw';

interface IntroductionPageProps {
  gameState: GameState;
}

// "A", "A and B", or "A, B, and C" — Intl.ListFormat needs a newer lib target
// than this project's tsconfig carries, so joined by hand instead of pulling
// that in for one call site.
function formatConjunctionList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// The Welcome Memorandum is dated Year 1 and addressed to an incoming team —
// it must always describe the Pool's OPENING position, not whatever year the
// player has actually reached. priorHistory's last entry (year 0's ending
// state) IS that opening position (see Stage 2.10 in App.tsx), so this reads
// from priorHistory rather than lockedResults regardless of current year.
//
// ⚠ THE MEMO STATES EXPOSURE BY LINE, NOT A MEMBER COUNT. It used to open
// "serves N of 200 eligible public entities", with payroll and TIV summed over
// the roster. The game shows the pool in aggregate now, so {{EXPOSURE_BY_LINE}}
// replaces those four tokens with one bullet per ACTIVE line, built in code the
// way buildInvestmentMemo builds its asset-class table.
//
// ⚠ IT READS THE ENGINE'S OWN FIGURES AND RESTATES NEITHER. Each bullet takes
// `activeExposure` and `totalMarketExposure` straight off that line's opening
// row — the same two fields the Results card's market share divides — rather
// than re-summing the roster, which is what the four tokens it replaces did.
//
// ⚠ A LINE THE GAME DOES NOT USE IS ABSENT, not zero. The list is built from
// setup.activeLines and each entry is dropped again if the opening row is
// missing, so a one-line game produces exactly one bullet and no empty sentence.
//
// ⚠ THE ROSTER FIELDS READ `opening.memberList`, NOT `poolState`, AND THAT IS
// THE WHOLE POINT OF THIS FUNCTION. They used to come from
// poolState.allMarketMembers — LIVE state — so the three of them tracked
// attrition and joining while the six around them stayed pinned. A memo dated
// Year 1 then told an incoming team the Pool "currently serves 133 of 200" when
// 141 were enrolled at the opening: measured at 141 -> 133 members,
// $849.87M -> $813.58M payroll and $39.91B -> $36.88B TIV over eight years.
// priorHistory is frozen once written, so reading the roster from it makes the
// memo read identically in year 9 as in year 1.
//
// ⚠ NOT `opening.activeMembers`, which is a DIFFERENT QUANTITY. That field sums
// per-line enrolments, so a member carrying two lines counts twice — it read 191
// against a 131-member roster on the seed this was checked on. `memberList` is
// the distinct roster and is what the live computation it replaces agreed with.
//
// `totalMemberCount` stays on poolState because the marketplace is a fixed
// 200-member roster whose length never changes — members change STATUS, none are
// added or removed (verified constant at 200 across 12 years and three seeds).
// There is no equivalent field on ResultSet to move it to.
// WC and GL are written on payroll; Property on insured value. Naming the
// measure per line matters — "$39.9B of exposure" reads as payroll unless it
// says otherwise.
const EXPOSURE_MEASURE: Record<CoverageLine, string> = {
  WC: 'payroll',
  GL: 'payroll',
  Property: 'insured value',
};

function exposureByLine(opening: ResultSet, activeLines: CoverageLine[]): string {
  return activeLines
    .map(line => {
      const row = opening.byLine[line];
      // Absent, not zero — see the note above.
      if (!row) return null;
      return `- **${LINE_FULL_NAME[line]}** — ${formatMillions(row.activeExposure)} of `
        + `${formatMillions(row.totalMarketExposure)} ${EXPOSURE_MEASURE[line]} in the marketplace`;
    })
    .filter((x): x is string => x !== null)
    .join('\n');
}

function buildWelcomeMemoValues(gameState: GameState): Record<string, string> {
  const { setup, priorHistory } = gameState;
  const opening = priorHistory[priorHistory.length - 1];

  return {
    poolName: setup.poolName,
    startingYear: String(setup.startingYear),
    EXPOSURE_BY_LINE: exposureByLine(opening, setup.activeLines),
    latestEndingSurplus: formatCurrency(opening.endingSurplus, true),
    premiumToSurplusRatio: (opening.totalMemberCharge / opening.endingSurplus).toFixed(2),
    selectedCoverageLines: formatConjunctionList(setup.activeLines.map(l => LINE_FULL_NAME[l])),
  };
}

export default function IntroductionPage({ gameState }: IntroductionPageProps) {
  const [selectedId, setSelectedId] = useState('welcome');

  const welcomeMemoContent = applyTemplate(welcomeMemoRaw, buildWelcomeMemoValues(gameState));

  const documents: DocumentEntry[] = [
    {
      id: 'welcome',
      title: 'Welcome Memorandum',
      summary: `From the Board of Governors, Year ${gameState.setup.startingYear}`,
      content: welcomeMemoContent,
    },
    {
      id: 'howToPlay',
      title: 'How to Play',
      summary: 'The mechanical reference — decisions, reports, and the yearly cycle',
      content: howToPlayRaw,
    },
  ];

  return <DocumentReader documents={documents} selectedId={selectedId} onSelect={setSelectedId} />;
}
