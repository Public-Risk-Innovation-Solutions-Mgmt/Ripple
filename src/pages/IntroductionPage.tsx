import { useState } from 'react';
import type { GameState } from '../types/simulation';
import { LINE_FULL_NAME } from '../utils/lineDisplay';
import { applyTemplate } from '../utils/renderMarkdown';
import DocumentReader, { type DocumentEntry } from '../components/DocumentReader';
import welcomeMemoRaw from '../data/documents/welcomeMemo.md?raw';
import howToPlayRaw from '../data/documents/howToPlay.md?raw';
import investmentMemoRaw from '../data/documents/investmentMemo.md?raw';
import underwritingMemoRaw from '../data/documents/underwritingMemorandum.md?raw';
import { buildInvestmentMemo, currentAllocation } from '../utils/investmentMemo';

interface IntroductionPageProps {
  gameState: GameState;
}

// "A", "A and B", or "A, B and C" — the memo's natural list, no serial comma.
function naturalList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ============================================================================
// THE WELCOME MEMORANDUM'S FIGURES — every one READ FROM THE GAME, never typed.
//
// ⚠ IT DESCRIBES THE POOL AS THE TEAM TAKES IT OVER: the policy year it enters is
// the game's first, and "closed last year" is the year before it — the last
// pre-game year, priorHistory's final entry, frozen once written. So the memo
// reads the same in year 9 as in year 1.
//
// ⚠ AND IT CARRIES NO ENGINE DETAIL (see the rule at the head of
// welcomeMemo.md): no funding level, cushion, market share or membership.
// ============================================================================
const MULTI_LINE_PARAGRAPH = 'Each coverage line behaves differently. Strength in one can hide weakness in another, '
  + 'so review each line as well as the Pool as a whole.';
const LOANS_PARAGRAPH = '**Loans between lines.** If a line ends a year with negative surplus, the Pool\'s other '
  + 'lines may be able to cover it with a loan, which you then choose how quickly to repay.';

function buildWelcomeMemoValues(gameState: GameState): Record<string, string> {
  const { setup, priorHistory } = gameState;
  const closedLastYear = priorHistory[priorHistory.length - 1];
  return {
    poolName: setup.poolName,
    year: String(setup.startingYear),
    lines: naturalList(setup.activeLines.map(l => LINE_FULL_NAME[l])),
    surplus: `${closedLastYear.endingSurplus < 0 ? '−' : ''}$${Math.abs(closedLastYear.endingSurplus / 1e6).toFixed(1)}M`,
    // Only when the game has more than one line.
    MULTI_LINE: setup.activeLines.length > 1 ? MULTI_LINE_PARAGRAPH : '',
  };
}

export default function IntroductionPage({ gameState }: IntroductionPageProps) {
  const [selectedId, setSelectedId] = useState('welcome');

  const welcomeMemoContent = applyTemplate(welcomeMemoRaw, buildWelcomeMemoValues(gameState));
  // How to Play: the loans paragraph only when the game has more than one line.
  const howToPlayContent = applyTemplate(howToPlayRaw, {
    LOANS_PARAGRAPH: gameState.setup.activeLines.length > 1 ? LOANS_PARAGRAPH : '',
  });

  const documents: DocumentEntry[] = [
    {
      id: 'welcome',
      title: 'Welcome Memorandum',
      summary: `From the Executive Committee, Program Year ${gameState.setup.startingYear}`,
      content: welcomeMemoContent,
    },
    {
      id: 'howToPlay',
      title: 'How to Play',
      summary: 'The yearly cycle, your decisions, and the reports',
      content: howToPlayContent,
    },
    {
      // Its figures are the game's: the asset classes' parameters and the
      // Pool's allocation in force (buildInvestmentMemo, currentAllocation).
      id: 'investment',
      title: 'Investment Memorandum',
      summary: 'From the Finance Department',
      content: buildInvestmentMemo(investmentMemoRaw, currentAllocation(gameState)),
    },
    {
      id: 'underwriting',
      title: 'Underwriting Memorandum',
      summary: 'From the Underwriting Department',
      content: underwritingMemoRaw,
    },
  ];

  return <DocumentReader documents={documents} selectedId={selectedId} onSelect={setSelectedId} />;
}
